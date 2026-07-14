#!/usr/bin/env node
// beat render — render a .beat file to a real WAV by driving dotbeat's OWN canonical audio engine
// (ui/src/audio/engine.ts), headless. This is the D15 consolidation: there is exactly one engine
// now, the one the live GUI plays through, and this command points at it — no BeatLab checkout,
// no --beatlab-dir, no separate repo anywhere on the machine.
//
// How it works (the same pattern ui/verify*.mjs already establish):
//   1. boot the daemon on the target .beat file (the GUI's data source over HTTP/SSE)
//   2. serve a production build of ui/ (vite preview; auto-built if ui/dist is missing)
//   3. load it in headless Chromium at ?daw=<daemon-port> so the store fills from the daemon
//   4. engine.recordWav(seconds) armed first, then engine.play() — captures the live post-limiter
//      master output (MediaRecorder -> opus -> decode -> WAV, the real-audio path the parity
//      harness uses) from the downbeat onward, trims the recorder-spin-up silence, and writes the
//      bytes to disk. Real-time capture: takes about as long as the audio is long.
//
// Usage:
//   node cli/render.mjs <project.beat> [-o out.wav] [--tail <sec>] [--daemon-port N] [--preview-port N]
//
// Requires `npm run build` (compiled ../dist/src). The ui/ build is produced on demand.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'

// Phase 39 Stream UA (pilot 105): the first EXISTING bundled-Playwright-chromium binary, or
// undefined if none is found. `chromium.executablePath()` is playwright-core's programmatic path to
// the chromium revision IT expects — the primary, correct source. But when browsers are
// pre-provisioned (as in locked-down/proxied CI images) their revision can predate this
// playwright-core, so executablePath() names a build that was never installed; we then scan
// PLAYWRIGHT_BROWSERS_PATH for whatever chromium build IS present (the stable `chromium` symlink
// first, then any chromium-<rev> dir). All candidates are existsSync-gated, so a wholly missing
// bundle simply yields undefined and the caller degrades to its actionable CHROME_PATH hint.
function bundledChromiumPath() {
  const candidates = []
  try {
    const p = chromium.executablePath()
    if (p) candidates.push(p)
  } catch {
    /* no bundled chromium registered with playwright-core */
  }
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (base) {
    candidates.push(join(base, 'chromium')) // stable symlink some provisioned images provide
    try {
      for (const d of readdirSync(base)) {
        if (/^chromium-\d+$/.test(d)) {
          candidates.push(join(base, d, 'chrome-linux', 'chrome'), join(base, d, 'chrome-linux64', 'chrome'))
        }
      }
    } catch {
      /* PLAYWRIGHT_BROWSERS_PATH unreadable — skip the scan */
    }
  }
  return candidates.find((p) => existsSync(p))
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const uiDir = join(repoRoot, 'ui')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-o' || a === '--out') args.out = argv[++i]
    else if (a === '--tail') args.tail = argv[++i]
    else if (a === '--daemon-port') args.daemonPort = argv[++i]
    else if (a === '--preview-port') args.previewPort = argv[++i]
    // legacy no-ops: the engine is dotbeat's own now, so these are accepted-and-ignored rather
    // than errored, so old scripts/invocations don't break on an unknown flag.
    else if (a === '--beatlab-dir') i++ // swallow its value
    else if (a === '--port') i++ // old BeatLab dev-server port; irrelevant now
    else args._.push(a)
  }
  return args
}

// Serve a production build of ui/ and resolve the URL vite actually bound (parsed from its output
// so a busy port auto-increments cleanly instead of failing). Returns { proc, url }.
async function serveUi(preferredPort) {
  const proc = spawn('npm', ['run', 'preview', '--', '--port', String(preferredPort)], { cwd: uiDir, stdio: ['ignore', 'pipe', 'pipe'] })
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite preview did not announce a URL within 30s')), 30000)
    let buf = ''
    const onData = (chunk) => {
      buf += chunk.toString()
      const clean = buf.replace(/\x1B\[[0-9;]*m/g, '')
      const m = clean.match(/Local:\s+(http:\/\/localhost:\d+\/?)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1].replace(/\/$/, ''))
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('exit', (code) => reject(new Error(`vite preview exited early (code ${code}): ${buf.slice(-300)}`)))
  })
  return { proc, url }
}

// Shared boot sequence for anything that needs a live, headless dotbeat UI driving the real engine
// against a .beat file: `renderCommand` (one full-mix capture) and `renderTrackSolosCommand`
// (Phase 33 Stream MD item 2 — one capture per track, solo'd, reusing the SAME daemon/preview/
// browser session rather than paying the boot cost once per track). Returns everything the caller
// needs plus a `close()` to tear it all down; the caller owns the try/finally.
async function bootRenderSession(beatPath, { tail = 0, daemonPort = 0, previewPort = 5899 } = {}) {
  // Ensure the compiled repo (core + daemon) exists before importing it, so a fresh checkout that
  // hasn't run `npm run build` still works out of the box rather than throwing on a missing dist.
  if (!existsSync(join(repoRoot, 'dist/src/daemon/daemon.js')) || !existsSync(join(repoRoot, 'dist/src/core/index.js'))) {
    console.error('building repo (dist/ missing)...')
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  }
  // Ensure ui/ is built (vite preview serves ui/dist).
  if (!existsSync(join(uiDir, 'dist', 'index.html'))) {
    console.error('building ui/ (ui/dist missing)...')
    execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })
  }

  const { parse, unplacedContentTracks, unplacedContentWarning } = await import(pathToFileURL(join(repoRoot, 'dist/src/core/index.js')).href)
  const { startDaemon } = await import(pathToFileURL(join(repoRoot, 'dist/src/daemon/daemon.js')).href)

  const doc = parse(readFileSync(beatPath, 'utf8'))
  // Render length: a song block plays its full timeline (sum of section bars); otherwise one loop
  // pass. Same math the engine uses for transport.loopEnd (ui/src/audio/engine.ts play()).
  const renderBars = doc.song && doc.song.length > 0 ? doc.song.reduce((sum, s) => sum + s.bars, 0) : doc.loopBars
  const seconds = (renderBars * 16 * 60) / doc.bpm / 4 + tail
  console.error(`parsed ${beatPath}: ${doc.tracks.length} track(s), bpm ${doc.bpm}, ${renderBars} bar(s) -> ${seconds.toFixed(2)}s of audio`)

  // Phase 39 Stream UA (pilot 105 HIGH): in song mode a track with real content that's placed in no
  // scene the song plays renders SILENT with no other warning. Surface it before rendering so a
  // silent part is never a surprise — warn only; still render (the render is otherwise correct).
  for (const t of unplacedContentTracks(doc)) console.error(unplacedContentWarning(t))

  const daemon = await startDaemon({ filePath: beatPath, port: daemonPort })
  console.error(`daemon on :${daemon.port}`)

  const served = await serveUi(previewPort)
  console.error(`ui served at ${served.url}`)

  const launchOpts = {
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    // The throttling flags matter for real-time capture: a headless page counts as backgrounded,
    // and background throttling slows the audio graph's driving timers, worsening capture underrun.
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  }
  let browser
  try {
    browser = await chromium.launch(launchOpts)
  } catch (err) {
    // An explicit CHROME_PATH that fails to launch is a real, user-supplied error — surface it
    // as-is rather than silently ignoring their choice.
    if (process.env.CHROME_PATH) throw err
    // The default `channel: 'chrome'` needs a system Chrome install, which many locked-down /
    // proxied environments (incl. this one) can't get — `npx playwright install chrome` 403s.
    // Phase 39 Stream UA (pilot 105): before surfacing the CHROME_PATH hint, try Playwright's OWN
    // bundled chromium (the binary `npx playwright install chromium` downloads — which, unlike
    // `chrome`, this environment CAN fetch). Launch order end-to-end: explicit CHROME_PATH →
    // system `chrome` channel → bundled chromium → actionable error. The whole probe+relaunch is
    // guarded so a MISSING or unlaunchable bundle degrades to the hint below, never a raw throw.
    let bundled = bundledChromiumPath()
    if (bundled) {
      try {
        console.error(`system Chrome unavailable; falling back to Playwright's bundled chromium (${bundled})`)
        browser = await chromium.launch({ ...launchOpts, executablePath: bundled })
      } catch {
        bundled = undefined // bundled binary present but unlaunchable — surface the hint too
      }
    }
    if (!browser) {
      // Point at the fix instead of leaking Playwright's raw "distribution not found" error.
      throw new Error(
        `could not launch Chrome: ${err && err.message ? err.message.split('\n')[0] : err}\n` +
          `  set CHROME_PATH to an existing Chromium/Chrome binary and re-run, e.g.:\n` +
          `    CHROME_PATH=/opt/pw-browsers/chromium node cli/render.mjs ...\n` +
          `  (a Playwright chromium from \`npx playwright install chromium\` works too).`,
      )
    }
  }
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))
  // Surface the page's own warnings/errors on stderr — the engine reports media-load failures
  // via console.warn ("drum lane X sample failed to load"), which used to vanish in headless
  // renders, leaving a sample-backed lane to fall back to its synth voice with zero signal
  // anywhere (owner's dogfood session, 2026-07-13).
  page.on('console', (msg) => {
    const type = msg.type()
    if (type !== 'warning' && type !== 'error') return
    const text = msg.text()
    // Pilot 104 low: a benign resource-load 404 (a missing favicon/asset the headless render never
    // needs) logs to the console as an `error` and clutters render output, reading like a failure.
    // Drop ONLY that specific "Failed to load resource: ... 404" line. Genuine JS exceptions arrive
    // via 'pageerror' (thrown, not routed here); the engine's own media-load failures arrive as
    // console.warn ("... sample failed to load", type 'warning') and are not this pattern, so both
    // still surface untouched.
    if (type === 'error' && /Failed to load resource:.*\b404\b/.test(text)) return
    console.error(`[page ${type}] ${text}`)
  })

  console.error('loading dotbeat ui (headless)...')
  await page.goto(`${served.url}/?daw=${daemon.port}`, { waitUntil: 'load' })
  // wait for the engine to exist AND the store to have filled from the daemon
  await page.waitForFunction(() => window.__engine && window.__store && window.__store.getState().doc, { timeout: 15000 })
  // ...AND for in-flight media (drum one-shot samples, soundfonts, audio-clip buffers) to finish
  // loading. The GUI never needs this wait — media resolves long before a human presses play —
  // but a headless render plays ~immediately, and anything still pending sounds as its silent
  // fallback (synth voice / nothing) instead of the sample. Timeout = warn and render anyway (an
  // honest degraded render beats a hang; the console forwarding above names the failed load).
  try {
    await page.waitForFunction(() => typeof window.__engine.pendingMediaCount === 'function' && window.__engine.pendingMediaCount() === 0, { timeout: 30000 })
  } catch {
    const n = await page.evaluate(() => (typeof window.__engine.pendingMediaCount === 'function' ? window.__engine.pendingMediaCount() : -1)).catch(() => -1)
    console.error(`warning: ${n} media load(s) still pending after 30s — sample-backed lanes/clips may play their fallback voice or silence in this render`)
  }
  if (pageErrors.length) throw new Error('page error(s) before render:\n' + pageErrors.join('\n'))

  const close = async () => {
    await browser.close()
    served.proc.kill('SIGTERM')
    await daemon.close()
  }
  return { page, pageErrors, doc, seconds, close }
}

/** One real-time capture of whatever's currently soloed/muted in the page's own store — the full
 * mix when nothing's soloed. */
async function captureWav(page, seconds, pageErrors) {
  console.error("rendering (real-time capture through dotbeat's own engine)...")
  const base64 = await page.evaluate(async (secs) => {
    // Recorder first, playback second. recordWav captures wall-clock time off the live master
    // bus, so anything that sounds before the recorder is rolling is simply absent from the
    // file — the previous play-then-settle-then-record order lost the loop's first ~250ms
    // (the downbeat itself). ensureStarted() resumes the AudioContext without starting the
    // transport (recording from a suspended context captures silence); the extra 1.25s of
    // capture plus trimLeadingSilence() below absorb the recorder's spin-up latency (measured
    // at 300-800ms of wall clock between recordWav() arming and the downbeat landing on tape).
    await window.__engine.ensureStarted()
    const recording = window.__engine.recordWav(secs + 1.25)
    await new Promise((r) => setTimeout(r, 200)) // recorder rolling before the first note
    await window.__engine.play()
    const blob = await recording
    window.__engine.stop()
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }, seconds)
  if (pageErrors.length) throw new Error('page error(s) during render:\n' + pageErrors.join('\n'))
  return trimLeadingSilence(Buffer.from(base64, 'base64'), seconds)
}

/** Cut the recorder-spin-up silence off the front of a canonical 44-byte-header 16-bit PCM WAV
 * (what engine.recordWav()/audioBufferToWav produce) so the file starts on the loop's first
 * sound, then cap it at `seconds` so the deliberate over-capture doesn't lengthen the file.
 * MediaRecorder start latency is wall-clock and jittery, so onset detection (first frame above
 * a tiny threshold, backed off 5ms to keep the attack ramp) is the honest alignment. */
function trimLeadingSilence(wav, seconds) {
  const numChannels = wav.readUInt16LE(22)
  const sampleRate = wav.readUInt32LE(24)
  const bitsPerSample = wav.readUInt16LE(34)
  if (bitsPerSample !== 16 || wav.toString('ascii', 36, 40) !== 'data') return wav // not the shape we wrote — leave it alone
  const dataStart = 44
  const frameBytes = 2 * numChannels
  const totalFrames = Math.floor((wav.length - dataStart) / frameBytes)
  const threshold = 40 // ≈0.0012 full scale — under any real signal, over dither/denormal noise
  let onset = 0
  for (; onset < totalFrames; onset++) {
    const base = dataStart + onset * frameBytes
    let audible = false
    for (let ch = 0; ch < numChannels; ch++) if (Math.abs(wav.readInt16LE(base + ch * 2)) > threshold) audible = true
    if (audible) break
  }
  if (onset >= totalFrames) return wav // all silence — nothing to align to
  const startFrame = Math.max(0, onset - Math.round(sampleRate * 0.005))
  const keepFrames = Math.min(totalFrames - startFrame, Math.round(seconds * sampleRate))
  const data = wav.subarray(dataStart + startFrame * frameBytes, dataStart + (startFrame + keepFrames) * frameBytes)
  const out = Buffer.concat([wav.subarray(0, dataStart), data])
  out.writeUInt32LE(36 + data.length, 4) // RIFF chunk size
  out.writeUInt32LE(data.length, 40) // data chunk size
  return out
}

export async function renderCommand(argv) {
  const args = parseArgs(argv)
  const beatPath = args._[0]
  if (!beatPath) {
    console.error('usage: node cli/render.mjs <project.beat> [-o out.wav] [--tail <sec>] [--daemon-port N] [--preview-port N]')
    process.exit(1)
  }
  const outPath = args.out ?? beatPath.replace(/\.beat$/, '') + '.wav'
  const tail = Number(args.tail ?? 0)
  const daemonPort = args.daemonPort !== undefined ? Number(args.daemonPort) : 0 // 0 => OS picks a free port
  const previewPort = args.previewPort !== undefined ? Number(args.previewPort) : 5899

  const session = await bootRenderSession(beatPath, { tail, daemonPort, previewPort })
  try {
    const wavBytes = await captureWav(session.page, session.seconds, session.pageErrors)
    writeFileSync(outPath, wavBytes)
    console.error(`wrote ${outPath} (${wavBytes.length} bytes)`)
  } finally {
    await session.close()
  }
}

/** Phase 37 Stream RA: one full-mix real-time capture returned IN MEMORY as WAV bytes (Buffer),
 * instead of written to disk — for callers that decode/slice/analyze the render rather than keeping
 * the file (e.g. `beat feedback`: render once, slice at section boundaries, analyze each slice).
 * Reuses the exact bootRenderSession + captureWav path `renderCommand` uses, so the bytes are the
 * same real-engine post-limiter master capture, just never touching the filesystem. Returns
 * `{ bytes, doc, seconds }` — `doc` (parsed) and `seconds` (render length) save the caller a
 * re-parse for the section bar math. */
export async function renderToBuffer(beatPath, opts = {}) {
  const session = await bootRenderSession(beatPath, opts)
  try {
    const bytes = await captureWav(session.page, session.seconds, session.pageErrors)
    return { bytes, doc: session.doc, seconds: session.seconds }
  } finally {
    await session.close()
  }
}

/** Phase 33 Stream MD item 2 (research/98): one real-time solo capture per track id, reusing a
 * single daemon/preview/browser session (booting that session is most of the fixed cost — paying
 * it once instead of once-per-track keeps this from being N full `renderCommand` invocations).
 * Drives the SAME mute/solo mechanism the mixer's own solo button uses (`window.__store`'s
 * `mutes`/`solos`, gated into real audio by engine.ts's `applyMuteGates()` every 16th-step tick —
 * see ui/src/state/store.ts's `isEffectivelyMuted`), so a "solo" capture here is genuinely what
 * that track alone sounds like in the mix, not a synthetic approximation. Returns
 * `Map<trackId, Buffer>` (WAV bytes); the caller decides what to do with them (e.g. `analyze()`
 * each for `beat lint --doc`'s per-track offender naming). */
export async function renderTrackSolosCommand(beatPath, trackIds, opts = {}) {
  const session = await bootRenderSession(beatPath, opts)
  const results = new Map()
  try {
    for (const id of trackIds) {
      await session.page.evaluate((trackId) => {
        window.__store.setState({ solos: { [trackId]: true }, mutes: {} })
      }, id)
      results.set(id, await captureWav(session.page, session.seconds, session.pageErrors))
    }
    await session.page.evaluate(() => {
      window.__store.setState({ solos: {}, mutes: {} })
    })
  } finally {
    await session.close()
  }
  return results
}

// Runs directly (node cli/render.mjs ...) or via the `beat` dispatcher (cli/beat.mjs), which
// imports renderCommand instead.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  renderCommand(process.argv.slice(2))
    .then(() => process.exit(0)) // browser.close()/preview.kill() alone don't reliably drain the
    // event loop (chromium pipes, vite's esbuild service) — same fix scripts/smoke.mjs needed.
    .catch((err) => {
      console.error(err.stack ?? String(err))
      process.exit(1)
    })
}
