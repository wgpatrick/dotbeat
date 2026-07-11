#!/usr/bin/env node
// Phase 14 Stream F verification — proves the live GUI engine now produces REAL audio for an
// instrument (SoundFont) track driven by the actual document data, and that different SoundFont
// programs sound measurably different.
//
//   AUDIBLE  build a real project (beat init/sample/add-track/add-note) whose instrument track
//            points at the real trimmed FluidR3 GM bank (presets/sf2/fluidr3-gm-small.sf2),
//            boot the daemon + serve the built UI, drive it in headless Chrome, play + capture the
//            master output (engine.recordWav — the SAME MediaRecorder->opus->decode path the parity
//            harness uses), and confirm the master analyser sees a real signal (peak well above the
//            noise floor), NOT the silence Phase 12 Stream 2 found the offline Node path produces.
//   DISTINCT  record two different programs (Flute vs Trumpet) at the same notes and confirm their
//            spectral centroids differ — the selected program is actually shaping the timbre, not a
//            single hardcoded voice. Same evidence style Phase 12 Stream 2 used for its presets.
//   ROUTE    also hits the new daemon GET /soundfont-presets route and confirms it lists the bank's
//            real GM program names (the list the instrument panel's program picker consumes).
//
// Usage: node ui/verify-instrument.mjs

import { mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8471
const PREVIEW_PORT = 5327
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function beat(args) {
  return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 20000, everyMs = 40) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}
async function analyzeBase64Wav(b64) {
  const { decodeWav, analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const bytes = Buffer.from(b64, 'base64')
  const decoded = decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  return { metrics: analyze(decoded.channels, decoded.sampleRate), decoded }
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  // ---- a real project: instrument track -> real FluidR3 GM bank, a held chord ----
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-instr-'))
  const beatPath = join(proj, 'song.beat')
  copyFileSync(join(repoRoot, 'presets', 'sf2', 'fluidr3-gm-small.sf2'), join(proj, 'gm.sf2'))
  beat(['init', beatPath])
  beat(['sample', beatPath, 'gm', 'gm.sf2'])
  beat(['add-track', beatPath, 'flute', 'instrument', '--soundfont', 'gm', '--program', '73']) // Flute
  beat(['set', beatPath, 'loop_bars', '1'])
  // a sustained triad across the whole 1-bar loop (16 steps) — steady tone for a clean centroid
  for (const pitch of [60, 64, 67]) beat(['add-note', beatPath, 'flute', String(pitch), '0', '15', '0.9'])
  console.log(`project at ${beatPath}`)

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon on :${daemon.port}`)

  const results = {}

  // ---- ROUTE: the new /soundfont-presets daemon endpoint ----
  const presetsResp = await (await fetch(`http://localhost:${daemon.port}/soundfont-presets?sample=gm`)).json()
  const names = presetsResp.presets.map((p) => p.name)
  console.log(`\n[ROUTE] GET /soundfont-presets?sample=gm -> ${presetsResp.presets.length} presets: ${names.join(', ')}`)
  for (const need of ['Flute', 'Trumpet', 'Yamaha Grand Piano']) {
    if (!names.includes(need)) throw new Error(`[ROUTE] expected GM preset "${need}" missing from /soundfont-presets`)
  }
  results.route = { count: presetsResp.presets.length, names }
  console.log('  [ROUTE] PASS: daemon lists the real GM program names the panel consumes')

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try { return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok } catch { return false }
  }, 'vite preview to serve', 25000)
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      const t = m.text()
      if (/\[engine\]|\[daw\]|spessa|worklet|soundfont|instrument|error/i.test(t)) console.log(`  [page:${m.type()}] ${t}`)
    })
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 15000 })

    // record `secs` of the master output after setting the instrument track's program. Waits a
    // generous settle so the WorkletSynthesizer has fetched + loaded the soundfont; the loop
    // repeats, so a program's notes are captured on a later loop even if the first was mid-load.
    const recordProgram = async (program, secs) => {
      const b64 = await page.evaluate(async ({ program, secs }) => {
        const doc = window.__store.getState().doc
        const tracks = doc.tracks.map((t) => (t.kind === 'instrument' && t.instrument ? { ...t, instrument: { ...t.instrument, program } } : t))
        window.__store.getState().setDoc({ ...doc, tracks })
        await window.__engine.play()
        await new Promise((r) => setTimeout(r, 2200)) // let the worklet + soundfont load, then settle
        const blob = await window.__engine.recordWav(secs)
        window.__engine.stop()
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        return btoa(bin)
      }, { program, secs })
      return analyzeBase64Wav(b64)
    }

    // ---------- AUDIBLE: Flute (program 73) produces real, non-silent output ----------
    console.log('\n[AUDIBLE] playing instrument track (FluidR3 GM, program 73 = Flute) + recording master...')
    const flute = await recordProgram(73, 1.6)
    const fb = flute.metrics.spectral.bandsPct
    console.log(`  Flute: peak ${flute.metrics.samplePeakDbfs.toFixed(1)}dBFS  centroid ${flute.metrics.spectral.centroidHz.toFixed(0)}Hz  bands% sub ${fb.sub.toFixed(1)}/bass ${fb.bass.toFixed(1)}/mids ${fb.mids.toFixed(1)}/pres ${fb.presence.toFixed(1)}/air ${fb.air.toFixed(1)}`)
    results.flute = flute.metrics
    if (!(flute.metrics.samplePeakDbfs > -40)) throw new Error(`[AUDIBLE] instrument produced no real output (peak ${flute.metrics.samplePeakDbfs}dBFS = silence — the Phase-12 offline-render failure mode)`)
    console.log('  [AUDIBLE] PASS: the SoundFont instrument track produces real audio through the master bus')

    // ---------- DISTINCT: Trumpet (program 56) differs from Flute ----------
    console.log('\n[DISTINCT] switching to program 56 = Trumpet, recording the same notes...')
    const trumpet = await recordProgram(56, 1.6)
    const tb = trumpet.metrics.spectral.bandsPct
    console.log(`  Trumpet: peak ${trumpet.metrics.samplePeakDbfs.toFixed(1)}dBFS  centroid ${trumpet.metrics.spectral.centroidHz.toFixed(0)}Hz  bands% sub ${tb.sub.toFixed(1)}/bass ${tb.bass.toFixed(1)}/mids ${tb.mids.toFixed(1)}/pres ${tb.presence.toFixed(1)}/air ${tb.air.toFixed(1)}`)
    results.trumpet = trumpet.metrics
    if (!(trumpet.metrics.samplePeakDbfs > -40)) throw new Error(`[DISTINCT] program 56 produced no output (peak ${trumpet.metrics.samplePeakDbfs}dBFS)`)
    const cF = flute.metrics.spectral.centroidHz
    const cT = trumpet.metrics.spectral.centroidHz
    const relDiff = Math.abs(cF - cT) / ((cF + cT) / 2)
    console.log(`  centroid Flute ${cF.toFixed(0)}Hz vs Trumpet ${cT.toFixed(0)}Hz — relative difference ${(relDiff * 100).toFixed(1)}%`)
    results.centroidRelDiff = relDiff
    if (!(relDiff > 0.05)) throw new Error(`[DISTINCT] two programs' centroids too close (${cF.toFixed(0)} vs ${cT.toFixed(0)}Hz) — program may not be shaping the voice`)
    console.log('  [DISTINCT] PASS: different SoundFont programs are audibly, measurably different timbres')

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL INSTRUMENT-TRACK CHECKS PASSED ================')
    console.log(JSON.stringify(results, (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nINSTRUMENT VERIFY FAILED:', err.message)
  process.exit(1)
})
