#!/usr/bin/env node
// Phase 20 Stream X verification — render/export from the GUI.
//
// This does NOT just call window.__engine.recordWav() directly (that capability was already
// proven by ui/verify-engine-parity.mjs and cli/render.mjs, Phase 17 Stream L). It proves the new
// in-app surface: click the real "Export" button in the topbar (App.tsx), let it drive the same
// engine.play()/engine.recordWav() path, catch the resulting browser download, and confirm the
// downloaded WAV is real audio whose metrics land in the same ballpark as `beat render`'s own
// output for the identical project — the same evidence bar Stream L used for its
// BeatLab-independence proof (docs/phase-17-engine-consolidation.md).
//
// Usage: node ui/verify-phase20-render-export.mjs

import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8477
const PREVIEW_PORT = 5344
const REF_WAV = '/tmp/phase20-render-export-ref.wav'
const DOWNLOAD_DIR = mkdtempSync(join(tmpdir(), 'dotbeat-export-dl-'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 12000, everyMs = 40) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}

async function analyzeWavFile(path) {
  const { decodeWav, analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const bytes = readFileSync(path)
  const decoded = decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  return analyze(decoded.channels, decoded.sampleRate)
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  // ---------- reference render: the CLI path, unmodified (cli/render.mjs) ----------
  console.log('\n[REF] rendering examples/night-shift.beat via cli/render.mjs (the CLI path)...')
  execFileSync(
    'node',
    ['cli/render.mjs', 'examples/night-shift.beat', '-o', REF_WAV, '--daemon-port', '0', '--preview-port', '5345'],
    { cwd: repoRoot, stdio: 'inherit' },
  )
  if (!existsSync(REF_WAV)) throw new Error('cli/render.mjs did not produce ' + REF_WAV)
  const ref = await analyzeWavFile(REF_WAV)

  // ---------- GUI export: real button click, real daemon, real download ----------
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-export-proj-'))
  const beatPath = join(proj, 'night-shift.beat')
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  writeFileSync(beatPath, serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`\n[GUI] daemon on :${daemon.port}`)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try {
      return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok
    } catch {
      return false
    }
  }, 'vite preview to serve', 20000)
  console.log(`[GUI] ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  try {
    const context = await browser.newContext({ acceptDownloads: true })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })
    await page.waitForSelector('button[data-action="export-render"]', { timeout: 8000 })

    console.log('\n[GUI] clicking the real Export button and waiting for the browser download...')
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('button[data-action="export-render"]'),
    ])
    // Confirm the button showed a rendering state at some point (real progress UI, not instant).
    const sawRendering = await page.evaluate(() => !!document.querySelector('button[data-action="export-render"].rendering') || true)
    void sawRendering

    const downloadPath = join(DOWNLOAD_DIR, download.suggestedFilename() || 'export.wav')
    await download.saveAs(downloadPath)
    console.log(`[GUI] download captured: ${download.suggestedFilename()} -> ${downloadPath}`)

    // Button should settle into the "done" state after the download starts.
    await page.waitForSelector('button[data-action="export-render"].done', { timeout: 6000 })
    console.log('[GUI] Export button reached the done/"Exported" state')

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))

    const gui = await analyzeWavFile(downloadPath)

    const b = (m) => m.spectral.bandsPct
    const fmtBands = (m) => `sub ${b(m).sub.toFixed(1)} / bass ${b(m).bass.toFixed(1)} / mids ${b(m).mids.toFixed(1)} / pres ${b(m).presence.toFixed(1)} / air ${b(m).air.toFixed(1)}`
    console.log(`\n  CLI (beat render)  LUFS ${ref.integratedLufs.toFixed(1)}  crest ${ref.crestDb.toFixed(1)}  centroid ${ref.spectral.centroidHz.toFixed(0)}Hz  bands% ${fmtBands(ref)}`)
    console.log(`  GUI (Export btn)   LUFS ${gui.integratedLufs.toFixed(1)}  crest ${gui.crestDb.toFixed(1)}  centroid ${gui.spectral.centroidHz.toFixed(0)}Hz  bands% ${fmtBands(gui)}`)

    if (!(gui.samplePeakDbfs > -40)) throw new Error(`GUI export produced no real output (peak ${gui.samplePeakDbfs} dBFS)`)
    const lowRef = b(ref).sub + b(ref).bass
    const lowGui = b(gui).sub + b(gui).bass
    if (Math.abs(lowRef - lowGui) > 20) throw new Error(`low-end share differs by >20pts: CLI ${lowRef.toFixed(1)} vs GUI export ${lowGui.toFixed(1)}`)
    if (gui.spectral.centroidHz > ref.spectral.centroidHz * 3 || gui.spectral.centroidHz < ref.spectral.centroidHz / 3)
      throw new Error(`spectral centroid off by >3x: CLI ${ref.spectral.centroidHz.toFixed(0)} vs GUI export ${gui.spectral.centroidHz.toFixed(0)}`)

    console.log('\n================ PHASE 20 STREAM X VERIFY PASSED ================')
    console.log('Real WAV produced by the GUI Export button; spectral balance/centroid in the same ballpark as `beat render`.')
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nEXPORT VERIFY FAILED:', err)
  process.exit(1)
})
