#!/usr/bin/env node
// Phase 13 Stream A engine-parity verification — measures that dotbeat's OWN live GUI engine
// (ui/src/audio/engine.ts) now makes a .beat file sound like what `beat render` already produces,
// and that the newly-ported drum voices / sidechain duck are measurably doing their jobs.
//
//   PARITY  drive the live GUI engine over the real daemon on examples/night-shift.beat, capture
//           its master output to WAV (engine.recordWav — the SAME MediaRecorder->opus->decode path
//           BeatLab's exportSandboxWav / cli/render.mjs use), analyze it with src/metrics, and
//           compare spectral balance / crest / LUFS / stereo against the CLI reference render.
//           Both captures go through the identical lossy opus stage, so the comparison is fair;
//           they still won't be bit-identical (independent engines), so the bar is "same ballpark."
//   SIDECHAIN  inject a kick(4-on-floor, silenced) + long-bass doc with duckSource wired, record it
//           with the duck ON and OFF, and confirm the bass amplitude envelope modulates markedly
//           more with the duck on — i.e. the bass level actually dips on each kick, measured off
//           the recorded audio, not "the code path executed."
//   DRUMVOICE inject a kick-only doc and confirm the synthesized kick lands its energy in sub/bass
//           (per-lane drum-voice synthesis is producing a real kick, not silence/noise).
//
// Requires the CLI reference render to exist first (a sibling wrote it):
//   node cli/render.mjs examples/night-shift.beat -o <ref.wav> --beatlab-dir <beatlab> --port <p>
// Pass its path as REF_WAV (default /tmp/streamA-ref-nightshift.wav).
//
// Usage: node ui/verify-engine-parity.mjs

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8466
const PREVIEW_PORT = 5322
const REF_WAV = process.env.REF_WAV ?? '/tmp/streamA-ref-nightshift.wav'
const GUI_WAV = '/tmp/streamA-gui-nightshift.wav'

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

// ---- Node-side WAV -> analysis via the repo's own src/metrics ----
async function analyzeBase64Wav(b64) {
  const { decodeWav, analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const bytes = Buffer.from(b64, 'base64')
  const decoded = decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  const channels = decoded.channels
  return { metrics: analyze(channels, decoded.sampleRate), decoded }
}

// Coefficient of variation of the short-time amplitude envelope of the channel-mean signal — a
// simple, robust measure of "how much does the loudness pulse over time." A sidechain duck adds
// periodic dips, which RAISES this number vs. the same material with the duck off.
function envelopeCV(decoded) {
  const n = decoded.channels[0].length
  const mono = new Float64Array(n)
  for (const ch of decoded.channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / decoded.channels.length
  // 20ms RMS window: >1 cycle of the ~55Hz bass fundamental, so the raw sawtooth's per-cycle RMS
  // wobble averages out and what remains is the slower ~160ms sidechain dip we actually want to see.
  const win = Math.round(decoded.sampleRate * 0.02)
  const env = []
  for (let i = 0; i + win <= n; i += win) {
    let s = 0
    for (let j = 0; j < win; j++) s += mono[i + j] * mono[i + j]
    env.push(Math.sqrt(s / win))
  }
  // ignore the leading/trailing 10% (attack/release edges) so we measure steady-state modulation
  const a = Math.floor(env.length * 0.1)
  const core = env.slice(a, env.length - a).filter((v) => v > 1e-5)
  if (core.length < 4) return 0
  const mean = core.reduce((x, y) => x + y, 0) / core.length
  const varr = core.reduce((x, y) => x + (y - mean) * (y - mean), 0) / core.length
  return Math.sqrt(varr) / mean
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  if (!existsSync(REF_WAV)) throw new Error(`reference render missing at ${REF_WAV} — run cli/render.mjs first (see header)`)

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-parity-'))
  const beatPath = join(proj, 'night-shift.beat')
  writeFileSync(beatPath, serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon on :${daemon.port}`)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try { return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok } catch { return false }
  }, 'vite preview to serve', 20000)
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const results = {}
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })

    // Loop length of night-shift (4 bars @ 124bpm) in seconds.
    const loopSeconds = await page.evaluate(() => {
      const d = window.__store.getState().doc
      return (d.loopBars * 16 * 60) / d.bpm / 4
    })

    // ---------- PARITY: capture the live GUI engine rendering night-shift ----------
    console.log(`\n[PARITY] playing + recording ${loopSeconds.toFixed(2)}s of the live GUI engine...`)
    const guiB64 = await page.evaluate(async (secs) => {
      await window.__engine.play()
      await new Promise((r) => setTimeout(r, 250)) // let the graph settle before capture
      const blob = await window.__engine.recordWav(secs)
      window.__engine.stop()
      const buf = await blob.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      return btoa(bin)
    }, loopSeconds)
    const gui = await analyzeBase64Wav(guiB64)
    writeFileSync(GUI_WAV, Buffer.from(guiB64, 'base64'))

    const refBytes = readFileSync(REF_WAV)
    const { decodeWav, analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
    const refDec = decodeWav(new Uint8Array(refBytes.buffer, refBytes.byteOffset, refBytes.byteLength))
    const ref = analyze(refDec.channels, refDec.sampleRate)

    const b = (m) => m.spectral.bandsPct
    const fmtBands = (m) => `sub ${b(m).sub.toFixed(1)} / bass ${b(m).bass.toFixed(1)} / mids ${b(m).mids.toFixed(1)} / pres ${b(m).presence.toFixed(1)} / air ${b(m).air.toFixed(1)}`
    console.log(`  REF  LUFS ${ref.integratedLufs.toFixed(1)}  crest ${ref.crestDb.toFixed(1)}  centroid ${ref.spectral.centroidHz.toFixed(0)}Hz  bands% ${fmtBands(ref)}  stereoCorr ${ref.stereo.correlation.toFixed(2)}`)
    console.log(`  GUI  LUFS ${gui.metrics.integratedLufs.toFixed(1)}  crest ${gui.metrics.crestDb.toFixed(1)}  centroid ${gui.metrics.spectral.centroidHz.toFixed(0)}Hz  bands% ${fmtBands(gui.metrics)}  stereoCorr ${gui.metrics.stereo.correlation.toFixed(2)}`)
    results.parity = { ref, gui: gui.metrics }

    // Ballpark assertions (independent engines; opus on both sides). Spectral tilt is the load-
    // bearing one — if drum voices, sends, sidechain and filters weren't wired, the balance would
    // be wildly off (e.g. no sub/bass, or nothing but noise).
    const lowRef = b(ref).sub + b(ref).bass
    const lowGui = b(gui.metrics).sub + b(gui.metrics).bass
    if (Math.abs(lowRef - lowGui) > 20) throw new Error(`[PARITY] low-end share differs by >20pts: ref ${lowRef.toFixed(1)} vs gui ${lowGui.toFixed(1)}`)
    if (gui.metrics.spectral.centroidHz > ref.spectral.centroidHz * 3 || gui.metrics.spectral.centroidHz < ref.spectral.centroidHz / 3)
      throw new Error(`[PARITY] spectral centroid off by >3x: ref ${ref.spectral.centroidHz.toFixed(0)} vs gui ${gui.metrics.spectral.centroidHz.toFixed(0)}`)
    console.log('  [PARITY] PASS: spectral balance + centroid in the same ballpark as the reference')

    // ---------- SIDECHAIN: duck ON vs OFF, measured off the audio ----------
    const mkDoc = (duckAmount) => ({
      formatVersion: '0.9', bpm: 124, loopBars: 1, selectedTrack: 'bass', media: [], scenes: [], song: null,
      tracks: [
        {
          id: 'drums', name: 'drums', color: '#56b6c2', kind: 'drums',
          synth: { osc: 'sawtooth', volume: -60, cutoff: 12000, resonance: 0.8, attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3, pan: 0 },
          notes: [], clips: [], laneSamples: {},
          hits: [0, 4, 8, 12].map((s) => ({ id: `k${s}`, lane: 'kick', start: s, velocity: 1 })),
        },
        {
          id: 'bass', name: 'bass', color: '#f7c948', kind: 'synth',
          synth: { osc: 'sawtooth', volume: -6, cutoff: 1200, resonance: 0.8, attack: 0.005, decay: 0.2, sustain: 1, release: 0.1, pan: 0, duckSource: 'drums', duckAmount },
          notes: [{ id: 'b1', pitch: 33, start: 0, duration: 16, velocity: 0.9 }],
          clips: [], laneSamples: {}, hits: [],
        },
      ],
    })
    const recordDoc = async (doc, secs) => {
      const b64 = await page.evaluate(async ({ doc, secs }) => {
        window.__store.getState().setDoc(doc)
        await window.__engine.play()
        await new Promise((r) => setTimeout(r, 250))
        const blob = await window.__engine.recordWav(secs)
        window.__engine.stop()
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        return btoa(bin)
      }, { doc, secs })
      return analyzeBase64Wav(b64)
    }
    console.log('\n[SIDECHAIN] recording bass with duck OFF then ON (kick silenced; it still drives the duck)...')
    const off = await recordDoc(mkDoc(0), 2.0)
    const on = await recordDoc(mkDoc(0.7), 2.0)
    const cvOff = envelopeCV(off.decoded)
    const cvOn = envelopeCV(on.decoded)
    console.log(`  envelope modulation (CV of amplitude): duck OFF ${cvOff.toFixed(3)}  ->  duck ON ${cvOn.toFixed(3)}  (${(cvOn / (cvOff || 1e-9)).toFixed(1)}x)`)
    results.sidechain = { cvOff, cvOn }
    if (!(cvOn > cvOff * 1.4 && cvOn - cvOff > 0.08)) throw new Error(`[SIDECHAIN] duck-on envelope not markedly more modulated (off ${cvOff.toFixed(3)}, on ${cvOn.toFixed(3)})`)
    console.log('  [SIDECHAIN] PASS: the bass level measurably dips on each kick with the duck engaged')

    // ---------- DRUMVOICE: the synthesized kick lands its energy low ----------
    const kickDoc = {
      formatVersion: '0.9', bpm: 124, loopBars: 1, selectedTrack: 'drums', media: [], scenes: [], song: null,
      tracks: [{
        id: 'drums', name: 'drums', color: '#56b6c2', kind: 'drums',
        synth: { osc: 'sawtooth', volume: 0, cutoff: 12000, resonance: 0.8, attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3, pan: 0 },
        notes: [], clips: [], laneSamples: {},
        hits: [0, 4, 8, 12].map((s) => ({ id: `k${s}`, lane: 'kick', start: s, velocity: 1 })),
      }],
    }
    console.log('\n[DRUMVOICE] recording a kick-only pattern...')
    const kick = await recordDoc(kickDoc, 2.0)
    const kb = kick.metrics.spectral.bandsPct
    console.log(`  kick spectral bands%: sub ${kb.sub.toFixed(1)} / bass ${kb.bass.toFixed(1)} / mids ${kb.mids.toFixed(1)} / pres ${kb.presence.toFixed(1)} / air ${kb.air.toFixed(1)}  (peak ${kick.metrics.samplePeakDbfs.toFixed(1)}dBFS)`)
    results.drumvoice = kick.metrics
    if (!(kick.metrics.samplePeakDbfs > -40)) throw new Error(`[DRUMVOICE] kick produced no real output (peak ${kick.metrics.samplePeakDbfs})`)
    if (!(kb.sub + kb.bass > 45)) throw new Error(`[DRUMVOICE] kick energy not low-heavy (sub+bass ${(kb.sub + kb.bass).toFixed(1)}%)`)
    console.log('  [DRUMVOICE] PASS: the synthesized kick produces real, low-frequency-dominant output')

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL PARITY CHECKS PASSED ================')
    console.log(`GUI night-shift capture written to ${GUI_WAV}`)
    console.log(JSON.stringify(results, (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nPARITY VERIFY FAILED:', err)
  process.exit(1)
})
