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

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs'
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

// Phase 40 Stream VC: newest mtime under `dir` (recursive), or 0 if it can't be read. Used only for
// the ui/dist staleness heuristic, so an unreadable tree degrades to "not stale" and layer (b)
// still catches a bundle too old to probe.
function newestMtimeMs(dir) {
  let newest = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) newest = Math.max(newest, newestMtimeMs(p))
    else {
      try { newest = Math.max(newest, statSync(p).mtimeMs) } catch { /* vanished mid-scan */ }
    }
  }
  return newest
}

/** Why ui/dist needs a (re)build, or null if it looks current. Compares the built bundle's newest
 * file against ui/src + the build inputs that change what vite emits (package.json, index.html,
 * the vite config). Returns a human reason so the build line says WHY it's building. */
function uiDistStaleReason() {
  const distDir = join(uiDir, 'dist')
  if (!existsSync(join(distDir, 'index.html'))) return 'ui/dist missing'
  const distMtime = newestMtimeMs(distDir)
  if (distMtime === 0) return 'ui/dist unreadable'
  let newestSrc = newestMtimeMs(join(uiDir, 'src'))
  for (const f of ['package.json', 'index.html', 'vite.config.ts', 'vite.config.js']) {
    const p = join(uiDir, f)
    if (!existsSync(p)) continue
    try { newestSrc = Math.max(newestSrc, statSync(p).mtimeMs) } catch { /* unreadable — skip */ }
  }
  return newestSrc > distMtime ? 'ui/dist is older than ui/src — stale bundle' : null
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-o' || a === '--out') args.out = argv[++i]
    else if (a === '--tail') args.tail = argv[++i]
    else if (a === '--daemon-port') args.daemonPort = argv[++i]
    else if (a === '--preview-port') args.previewPort = argv[++i]
    else if (a === '--batch') args.batch = argv[++i]
    else if (a === '--offline') args.offline = true
    else if (a === '--live') args.live = true
    else if (a === '--no-normalize') args.noNormalize = true // --batch only; renderCommand rejects it
    // legacy no-ops: the engine is dotbeat's own now, so these are accepted-and-ignored rather
    // than errored, so old scripts/invocations don't break on an unknown flag.
    else if (a === '--beatlab-dir') i++ // swallow its value
    else if (a === '--port') i++ // old BeatLab dev-server port; irrelevant now
    else if (a.startsWith('--')) {
      // Pilot 109 (MEDIUM): a typo'd flag used to be silently swallowed into the positional list
      // — `--offlin` ran a full LIVE render with exit 0, silently downgrading the one flag whose
      // entire point is exactness. Unknown flags are an immediate, loud error.
      console.error(`error: unknown flag "${a}" (known: -o/--out, --tail, --daemon-port, --preview-port, --batch, --offline, --live, --no-normalize)`)
      process.exit(2)
    } else args._.push(a)
  }
  return args
}

// Serve a production build of ui/ and resolve the URL vite actually bound (parsed from its output
// so a busy port auto-increments cleanly instead of failing). Returns { proc, url }.
async function serveUi(preferredPort) {
  // detached => its own process group. Killing only the spawned pid kills the npm wrapper while
  // the actual vite server it spawned lives on — pilot 109 found ~24 orphaned `vite preview`
  // servers accumulated on one box (~90MB RSS each), one leaked per render. close() kills the
  // whole group (negative pid) so the server actually dies with the session.
  const proc = spawn('npm', ['run', 'preview', '--', '--port', String(preferredPort)], { cwd: uiDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  proc.killTree = () => {
    try {
      process.kill(-proc.pid, 'SIGTERM')
    } catch {
      try { proc.kill('SIGTERM') } catch { /* already gone */ }
    }
  }
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
  // Ensure ui/ is built AND current (vite preview serves ui/dist verbatim).
  // Phase 40 Stream VC: this used to build only when ui/dist/index.html was MISSING, so after any
  // `git pull`/branch switch that changed the engine, render silently served a stale bundle. That's
  // exactly how examples/recipe-song's first render came back pure silence: the served bundle
  // predated sample-lane playback entirely. Layer (a) of the fix — rebuild when ui/dist is older
  // than its sources. It's a heuristic and it CAN false-negative (a branch switch can restore old
  // content with fresh mtimes), which is acceptable only because layer (b) below — the hard error
  // on an un-runnable readiness probe — is a real backstop rather than a second heuristic.
  const staleReason = uiDistStaleReason()
  if (staleReason) {
    // Pilot 113: a fresh checkout's very first --render used to die HERE in a bare
    // "Error: Command failed: npm run build" stack trace — the actual cause was ui/node_modules
    // missing (npm install has never run in ui/), and the build's own output can be swallowed
    // when render runs as a child with ignored stdio. Detect the known cause up front and print
    // the actual fix; wrap a genuinely failing build in a pointer to where the full output is.
    if (!existsSync(join(uiDir, 'node_modules'))) {
      throw new Error(
        `ui/ needs building (${staleReason}) but ui/node_modules is missing — install the UI's dependencies first:\n` +
          `    cd ui && npm install\n` +
          `  then re-run this command (the build itself runs automatically).`,
      )
    }
    console.error(`building ui/ (${staleReason})...`)
    try {
      execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })
    } catch (err) {
      throw new Error(
        `the ui/ build failed (${err && err.message ? err.message.split('\n')[0] : err})\n` +
          `  run it by hand to see the full compiler output: cd ui && npm run build`,
      )
    }
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
    // Pilot 108 leftover (research/108, "not fixed, tracked"): two KNOWN-BENIGN engine internals
    // fire on effectively every render and mean nothing to a musician — Chromium's
    // ScriptProcessorNode deprecation notice (the Redux decimator is deliberately a
    // ScriptProcessorNode, see engine.ts buildDownsampler) and Tone's scheduling-accuracy hint
    // (an advisory about Draw-time scheduling, not an audio problem). Filter EXACTLY these; a
    // genuine warning (e.g. "sample failed to load") still surfaces untouched.
    if (/The ScriptProcessorNode is deprecated/.test(text)) return
    if (/Events scheduled inside of scheduled callbacks should use the passed in scheduling time/.test(text)) return
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
    // Phase 40 Stream VC — layer (b), the safety net. `-1` means the served bundle has no
    // pendingMediaCount() AT ALL: the probe didn't time out, it never ran. That is not a slow media
    // load to warn about, it's proof the bundle predates the readiness probe itself — i.e. a stale
    // ui/dist that layer (a)'s mtime heuristic failed to catch. The recipe-song's silent render
    // printed exactly this as "-1 media load(s) still pending", which reads like a real (if odd)
    // measurement and let a fully silent render pass for a successful one. A probe that COULDN'T
    // RUN must never look like a probe that ran and found something — so this is a hard error.
    if (n === -1) {
      throw new Error(
        'the served ui/dist bundle has no engine.pendingMediaCount() — it predates the media-readiness probe,\n' +
          '  so this render CANNOT be checked for sample-backed lanes/clips and would likely be silent.\n' +
          '  ui/dist is stale (a build from an older engine; render auto-rebuilds on mtime, which a branch\n' +
          '  switch or a restored checkout can defeat). Rebuild it and re-run:\n' +
          '    cd ui && npm run build',
      )
    }
    console.error(`warning: ${n} media load(s) still pending after 30s — sample-backed lanes/clips may play their fallback voice or silence in this render`)
  }
  if (pageErrors.length) throw new Error('page error(s) before render:\n' + pageErrors.join('\n'))

  const close = async () => {
    await browser.close()
    served.proc.killTree() // group kill — see serveUi (pilot 109's vite-leak finding)
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

/** Offline capture (renderer slice 2): compute the mix through Tone.Offline via the page's
 * __renderOffline hook (ui/src/audio/offline.ts) — same engine class, offline context, as fast
 * as the CPU allows. The buffer is exact-length by construction (no recorder spin-up, no trim,
 * no underrun class of bug). Refusals (soundfont tracks, undecoded media) throw with the page's
 * own reason so callers can fall back to live capture deliberately. */
async function captureOfflineWav(page, seconds, pageErrors) {
  console.error("rendering (offline compute through dotbeat's own engine)...")
  const result = await page.evaluate(async (secs) => {
    const { blob, caveats, renderMs } = await window.__renderOffline(secs)
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return { base64: btoa(binary), caveats, renderMs }
  }, seconds)
  if (pageErrors.length) throw new Error('page error(s) during offline render:\n' + pageErrors.join('\n'))
  for (const caveat of result.caveats) console.error(`offline caveat: ${caveat}`)
  const ratio = (seconds * 1000) / Math.max(1, result.renderMs)
  console.error(`offline compute: ${(result.renderMs / 1000).toFixed(2)}s for ${seconds.toFixed(2)}s of audio (${ratio.toFixed(1)}x realtime)`)
  // Honesty note, not an error: offline compute is CPU-bound and Tone's schedule-then-render
  // architecture keeps every one-shot voice node alive for the whole render (see
  // ui/src/audio/offline.ts header), so long/dense songs on a slow machine can compute SLOWER
  // than the live capture would have taken. The output is still exact — this is purely a
  // wall-clock heads-up so nobody assumes --offline is unconditionally the fast path.
  if (ratio < 1) console.error(`note: offline computed slower than realtime on this machine — plain live capture may be faster for this project`)
  return Buffer.from(result.base64, 'base64')
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

/** Parse-time `--offline` refusal (pilot 109 HIGH): instrument tracks and sf-backed lanes are
 * detectable from the parsed doc alone, so refuse in the first second instead of after ~30s of
 * daemon + headless-Chromium spin-up delivering the same message as a raw page.evaluate stack.
 * Best-effort — a missing dist/ build means no parser yet; the in-page refusal still backstops. */
async function offlinePreflightRefusal(beatPath) {
  try {
    const { parse } = await import(pathToFileURL(join(repoRoot, 'dist/src/core/index.js')).href)
    const doc = parse(readFileSync(beatPath, 'utf8'))
    const instrumentTracks = doc.tracks.filter((t) => t.kind === 'instrument').map((t) => t.id)
    if (instrumentTracks.length > 0) {
      return `instrument (soundfont) tracks need a native realtime context (worklet) — offline render does not support them yet: ${instrumentTracks.join(', ')}`
    }
    const sfLanes = []
    for (const t of doc.tracks) {
      for (const lane of t.lanes ?? []) {
        if (lane.backing?.type === 'sf') sfLanes.push(`${t.id}.${lane.name}`)
      }
    }
    if (sfLanes.length > 0) return `sf-backed drum lanes need a native realtime context (worklet) — offline render does not support them yet: ${sfLanes.join(', ')}`
    return null
  } catch {
    return null // no build / unparseable here — bootRenderSession and the in-page check own those errors
  }
}

export async function renderCommand(argv) {
  const args = parseArgs(argv)
  const beatPath = args._[0]
  if (!beatPath) {
    console.error('usage: node cli/render.mjs <project.beat> [-o out.wav] [--tail <sec>] [--daemon-port N] [--preview-port N] [--offline]')
    process.exit(1)
  }
  if (!existsSync(beatPath)) {
    // Pilot 109 (LOW): this used to surface as a raw ENOENT stack trace from the parser.
    console.error(`error: no file at ${beatPath}`)
    process.exit(2)
  }
  if (args.offline && args.live) {
    console.error('error: --offline and --live are mutually exclusive')
    process.exit(2)
  }
  if (args.noNormalize) {
    console.error('error: --no-normalize only applies to --batch (a single render is never loudness-normalized)')
    process.exit(2)
  }
  if (args.offline) {
    const refusal = await offlinePreflightRefusal(beatPath)
    if (refusal) {
      console.error(`error: offline render refused: ${refusal}`)
      process.exit(2)
    }
  }
  const outPath = args.out ?? beatPath.replace(/\.beat$/, '') + '.wav'
  const tail = Number(args.tail ?? 0)
  const daemonPort = args.daemonPort !== undefined ? Number(args.daemonPort) : 0 // 0 => OS picks a free port
  const previewPort = args.previewPort !== undefined ? Number(args.previewPort) : 5899

  // Errors are printed friendly and the process EXITS here. Before pilot 109, a mid-render error
  // (e.g. an in-page --offline refusal) propagated to beat.mjs's catch — which prints and sets
  // exitCode but never calls process.exit — while the leaked chromium/daemon/vite handles kept
  // the event loop alive: the CLI printed a stack trace and then hung FOREVER (killed manually
  // after 7+ minutes). Teardown is raced against a timeout so a wedged browser can't re-hang it.
  const session = await bootRenderSession(beatPath, { tail, daemonPort, previewPort })
  let failure = null
  try {
    const wavBytes = args.offline
      ? await captureOfflineWav(session.page, session.seconds, session.pageErrors)
      : await captureWav(session.page, session.seconds, session.pageErrors)
    writeFileSync(outPath, wavBytes)
    console.error(`wrote ${outPath} (${wavBytes.length} bytes)`)
  } catch (err) {
    failure = err
  } finally {
    await Promise.race([session.close(), sleep(5000)])
  }
  if (failure) {
    // Pilot 111 found the original first-line-only formatter DISCARDED the payload of multi-line
    // errors: 'page error(s) during render:' printed with an empty list because the real errors
    // sat on the following lines. Keep every meaningful line; drop only stack frames (the
    // playwright/minified-bundle noise).
    const lines = String(failure.message ?? failure)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('at '))
    const text = (lines.length ? lines : ['render failed']).join('\n  ')
    console.error(`error: ${text.replace(/^page\.evaluate:\s*Error:\s*/, '')}`)
    process.exit(1)
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

/**
 * Batch mode (`--batch <dir>`, taste-loop groundwork / D15's "fast batch render" note): render
 * every .beat variant in a vary-batch dir through ONE boot of the whole harness. The per-variant
 * cost used to include a fresh daemon + vite preview + headless Chromium (~10-15s of pure
 * overhead each); here the session boots once against a scratch copy of variant 1, and each
 * subsequent variant is swapped in by overwriting the daemon's watched file — the daemon's
 * directory watcher broadcasts the new doc over SSE and the page's store hot-reloads, exactly
 * the mechanism `beat adopt` already relies on for a running GUI.
 */
export async function renderBatchCommand(argv) {
  const args = parseArgs(argv)
  const dir = args.batch
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  } catch (err) {
    console.error(`--batch needs a vary-batch directory with a manifest.json (${err.message})`)
    process.exit(1)
  }
  const beatVariants = manifest.variants.filter((v) => v.file.endsWith('.beat'))
  if (beatVariants.length === 0) {
    console.error('nothing to render: this batch has no .beat variants (gen batches are already audio)')
    process.exit(1)
  }
  if (args.offline && args.live) {
    console.error('error: --offline and --live are mutually exclusive')
    process.exit(2)
  }
  // Batch renders default to OFFLINE (D22/D23): a vary batch is short clips — exactly where the
  // offline path is both faster than the realtime clock and exact (no recorder spin-up, no opus
  // step) — and D23 made its compute linear. The mode is decided ONCE for the whole batch and
  // printed loudly (pilot 109: silent mode changes are the worst failure shape): a project the
  // offline path refuses (soundfont tracks / sf lanes — detectable at parse time, and shared by
  // every variant of the same parent) falls back to live capture automatically; --live forces
  // live; --offline forces offline and errors on refusal instead of falling back.
  let offlineMode = false
  if (!args.live) {
    const refusal = await offlinePreflightRefusal(join(dir, beatVariants[0].file))
    if (refusal === null) {
      offlineMode = true
      console.error('batch rendering offline (exact compute through the engine; pass --live to force realtime capture)')
    } else if (args.offline) {
      console.error(`error: offline render refused: ${refusal}`)
      process.exit(2)
    } else {
      console.error(`batch rendering via live capture (offline refused: ${refusal})`)
    }
  } else {
    console.error('batch rendering via live capture (--live)')
  }
  // The daemon watches ONE file for the whole session; variants take turns being that file.
  // Dotfile name so the scratch copy can never be mistaken for a tenth variant.
  const currentPath = join(dir, '.render-current.beat')
  copyFileSync(join(dir, beatVariants[0].file), currentPath)
  const session = await bootRenderSession(currentPath, {
    daemonPort: args.daemonPort !== undefined ? Number(args.daemonPort) : 0,
    previewPort: args.previewPort !== undefined ? Number(args.previewPort) : 5899,
  })
  const { parse } = await import(pathToFileURL(join(repoRoot, 'dist/src/core/index.js')).href)
  try {
    for (let i = 0; i < beatVariants.length; i++) {
      const v = beatVariants[i]
      console.error(`rendering ${v.file.replace(/\.beat$/, '')} (${i + 1}/${beatVariants.length})...`)
      if (i > 0) {
        // Swap the next variant in and wait until the page's store actually reflects it —
        // consecutive vary variants always differ (that is what a variant is), so a doc-JSON
        // fingerprint change is a reliable reload signal.
        const prevFingerprint = await session.page.evaluate(() => JSON.stringify(window.__store.getState().doc))
        copyFileSync(join(dir, v.file), currentPath)
        await session.page.waitForFunction(
          (prev) => JSON.stringify(window.__store.getState().doc) !== prev,
          prevFingerprint,
          { timeout: 15000 },
        )
        await sleep(200) // let the engine's sync() tick absorb the new doc before capture
      }
      const doc = parse(readFileSync(join(dir, v.file), 'utf8'))
      const renderBars = doc.song && doc.song.length > 0 ? doc.song.reduce((sum, s) => sum + s.bars, 0) : doc.loopBars
      const seconds = (renderBars * 16 * 60) / doc.bpm / 4
      const wavBytes = offlineMode
        ? await captureOfflineWav(session.page, seconds, session.pageErrors)
        : await captureWav(session.page, seconds, session.pageErrors)
      session.pageErrors.length = 0 // captured errors are per-variant, not cumulative
      const outPath = join(dir, v.file.replace(/\.beat$/, '.wav'))
      writeFileSync(outPath, wavBytes)
      console.error(`wrote ${outPath} (${wavBytes.length} bytes)`)
    }
    // Pilot 113 HIGH: re-rendering a NORMALIZED batch used to silently strip its normalization
    // and leave the manifest describing audio that no longer exists. Re-apply it to the
    // manifest's recorded target (refreshing every loudness field), measure-only refresh a batch
    // recorded as raw, or honestly re-record as raw under --no-normalize; a manifest with no
    // normalization record (a batch's FIRST render — vary's child call) is left to its caller.
    const { refreshBatchLoudnessAfterRender, formatNormalizationResult } = await import(pathToFileURL(join(repoRoot, 'dist/src/vary/batch.js')).href)
    const loudness = refreshBatchLoudnessAfterRender(dir, beatVariants.length, args.noNormalize ? { normalize: false } : {})
    if (loudness) console.error(formatNormalizationResult(loudness).trimEnd())
  } finally {
    await session.close()
    try { rmSync(currentPath) } catch { /* best-effort scratch cleanup */ }
  }
}

// Runs directly (node cli/render.mjs ...) or via the `beat` dispatcher (cli/beat.mjs), which
// imports renderCommand instead.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  ;(argv.includes('--batch') ? renderBatchCommand(argv) : renderCommand(argv))
    .then(() => process.exit(0)) // browser.close()/preview.kill() alone don't reliably drain the
    // event loop (chromium pipes, vite's esbuild service) — same fix scripts/smoke.mjs needed.
    .catch((err) => {
      console.error(err.stack ?? String(err))
      process.exit(1)
    })
}
