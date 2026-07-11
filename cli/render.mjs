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
//   4. engine.play() then engine.recordWav(seconds) — captures the live post-limiter master output
//      (MediaRecorder -> opus -> decode -> WAV, the real-audio path the parity harness uses) and
//      writes the bytes to disk. Real-time capture: takes about as long as the audio is long.
//
// Usage:
//   node cli/render.mjs <project.beat> [-o out.wav] [--tail <sec>] [--daemon-port N] [--preview-port N]
//
// Requires `npm run build` (compiled ../dist/src). The ui/ build is produced on demand.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn, execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'

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

  // Ensure the compiled repo (core + daemon) exists before importing it, so a fresh checkout that
  // hasn't run `npm run build` still works out of the box rather than throwing on a missing dist.
  if (!existsSync(join(repoRoot, 'dist/src/daemon/daemon.js')) || !existsSync(join(repoRoot, 'dist/src/core/index.js'))) {
    console.log('building repo (dist/ missing)...')
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  }
  // Ensure ui/ is built (vite preview serves ui/dist).
  if (!existsSync(join(uiDir, 'dist', 'index.html'))) {
    console.log('building ui/ (ui/dist missing)...')
    execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })
  }

  const { parse } = await import(pathToFileURL(join(repoRoot, 'dist/src/core/index.js')).href)
  const { startDaemon } = await import(pathToFileURL(join(repoRoot, 'dist/src/daemon/daemon.js')).href)

  const doc = parse(readFileSync(beatPath, 'utf8'))
  // Render length: a song block plays its full timeline (sum of section bars); otherwise one loop
  // pass. Same math the engine uses for transport.loopEnd (ui/src/audio/engine.ts play()).
  const renderBars = doc.song && doc.song.length > 0 ? doc.song.reduce((sum, s) => sum + s.bars, 0) : doc.loopBars
  const seconds = (renderBars * 16 * 60) / doc.bpm / 4 + tail
  console.log(`parsed ${beatPath}: ${doc.tracks.length} track(s), bpm ${doc.bpm}, ${renderBars} bar(s) -> ${seconds.toFixed(2)}s of audio`)

  const daemon = await startDaemon({ filePath: beatPath, port: daemonPort })
  console.log(`daemon on :${daemon.port}`)

  let preview
  let browser
  try {
    const served = await serveUi(previewPort)
    preview = served.proc
    console.log(`ui served at ${served.url}`)

    browser = await chromium.launch({
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required'],
    })
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    console.log('loading dotbeat ui (headless)...')
    await page.goto(`${served.url}/?daw=${daemon.port}`, { waitUntil: 'load' })
    // wait for the engine to exist AND the store to have filled from the daemon
    await page.waitForFunction(() => window.__engine && window.__store && window.__store.getState().doc, { timeout: 15000 })
    if (pageErrors.length) throw new Error('page error(s) before render:\n' + pageErrors.join('\n'))

    console.log("rendering (real-time capture through dotbeat's own engine)...")
    const base64 = await page.evaluate(async (secs) => {
      await window.__engine.play()
      await new Promise((r) => setTimeout(r, 250)) // let the graph settle before capture
      const blob = await window.__engine.recordWav(secs)
      window.__engine.stop()
      const buf = await blob.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      return btoa(binary)
    }, seconds)

    if (pageErrors.length) throw new Error('page error(s) during render:\n' + pageErrors.join('\n'))

    const wavBytes = Buffer.from(base64, 'base64')
    writeFileSync(outPath, wavBytes)
    console.log(`wrote ${outPath} (${wavBytes.length} bytes)`)
  } finally {
    await browser?.close()
    preview?.kill('SIGTERM')
    await daemon.close()
  }
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
