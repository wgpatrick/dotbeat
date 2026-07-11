#!/usr/bin/env node
// Phase 18 Stream R verification — LFO depth: tempo-sync + widened enumerated destinations.
// Drives the REAL live GUI engine (ui/src/audio/engine.ts) over a headless-Chromium tab, same
// harness/convention as ui/verify-engine-parity.mjs, and measures its recorded audio output —
// not "the code path ran."
//
//   TEMPO-SYNC   a synth track holds one long note with lfoDest=amp, lfoSync=true,
//                lfoSyncRate='1/4' (one cycle per quarter note). Record it at bpm=90 and again at
//                bpm=180 (2x), measure the amplitude-envelope modulation frequency off the
//                recorded audio in both cases, and confirm it roughly doubles — i.e. the LFO's
//                REAL period tracks the transport's real tempo, not a fixed Hz.
//   LFO1->PAN    lfoDest='pan' used to be schema-illegal for LFO1 (LFO_DESTS only allowed
//                {off,pitch,cutoff,amp,wtPos}) — Phase 18 Stream R widened LFO_DESTS so both LFOs
//                share the full set. Record a static-pan take and an LFO1-panning take of the same
//                note, measure the per-window left/right balance, confirm the panning take swings
//                measurably more.
//   LFO2->RESONANCE  resonance was NEVER an LFO destination before (only reachable via clip
//                automation). Record a static-resonance take and an LFO2-resonance take of the
//                same filtered note; a resonance sweep boosts/cuts a NARROW band at a fixed
//                cutoff rather than moving broadband loudness, so measure the per-window spectral
//                centroid (src/metrics' own analyze(), same tool every prior engine stream's
//                verification uses) and confirm the swept take's centroid drifts measurably more.
//
// Usage: node ui/verify-phase18-lfo-depth.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8467
const PREVIEW_PORT = 5323

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

async function analyzeBase64Wav(b64) {
  const { decodeWav } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const bytes = Buffer.from(b64, 'base64')
  return decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
}

// A short-window RMS envelope of the channel-mean signal, 4x-overlapped for decent time
// resolution relative to the sub-Hz-to-few-Hz LFO periods under test, THEN smoothed with a
// second boxcar pass long enough to average out the note's own oscillator waveform (a ~110Hz
// sawtooth's harmonics would otherwise leak through a too-short RMS window as spurious
// mean-crossings, inflating the measured modulation frequency well above the real LFO rate).
function envelope(decoded, winSeconds, smoothSeconds = 0.04) {
  const n = decoded.channels[0].length
  const mono = new Float64Array(n)
  for (const ch of decoded.channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / decoded.channels.length
  const win = Math.max(4, Math.round(decoded.sampleRate * winSeconds))
  const hop = Math.max(1, Math.round(win / 4))
  const raw = []
  for (let i = 0; i + win <= n; i += hop) {
    let s = 0
    for (let j = 0; j < win; j++) s += mono[i + j] * mono[i + j]
    raw.push(Math.sqrt(s / win))
  }
  const hopSeconds = hop / decoded.sampleRate
  const k = Math.max(1, Math.round(smoothSeconds / hopSeconds))
  const env = raw.map((_, i) => {
    const lo = Math.max(0, i - k), hi = Math.min(raw.length, i + k + 1)
    let s = 0
    for (let j = lo; j < hi; j++) s += raw[j]
    return s / (hi - lo)
  })
  return { env, hopSeconds }
}

// Estimate a periodic envelope's modulation frequency by counting rising mean-crossings over the
// steady-state middle 80% (trims the note's own attack/decay edges).
function estimateModHz(env, hopSeconds, trimFrac = 0.1) {
  const a = Math.floor(env.length * trimFrac)
  const core = env.slice(a, env.length - a)
  if (core.length < 8) return 0
  const mean = core.reduce((x, y) => x + y, 0) / core.length
  let crossings = 0
  for (let i = 1; i < core.length; i++) if (core[i - 1] < mean && core[i] >= mean) crossings++
  const durationSeconds = core.length * hopSeconds
  return crossings / durationSeconds
}

// Per-window spectral centroid (reusing src/metrics' own analyze(), same tool every prior engine
// stream's verification uses) — a resonance sweep boosts/cuts a NARROW peak at a fixed cutoff,
// which barely moves overall RMS loudness but pulls the spectral centroid toward that peak when Q
// is high and lets it drift back when Q is low. 4096-sample (~85ms @ 48kHz) windows, 50% overlap.
async function centroidSeries(decoded) {
  const { analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const N = 4096
  const hop = 2048
  const series = []
  for (let start = 0; start + N <= decoded.channels[0].length; start += hop) {
    const chunk = decoded.channels.map((ch) => ch.slice(start, start + N))
    series.push(analyze(chunk, decoded.sampleRate).spectral.centroidHz)
  }
  return series
}
function seriesCV(series, trimFrac = 0.1) {
  const a = Math.floor(series.length * trimFrac)
  const core = series.slice(a, series.length - a).filter((v) => v > 1e-6)
  if (core.length < 4) return 0
  const mean = core.reduce((x, y) => x + y, 0) / core.length
  const varr = core.reduce((x, y) => x + (y - mean) * (y - mean), 0) / core.length
  return Math.sqrt(varr) / mean
}

// Per-window left/right balance CV — how much the stereo image swings over time.
function panBalanceCV(decoded, winSeconds) {
  if (decoded.channels.length < 2) return 0
  const [L, R] = decoded.channels
  const win = Math.max(4, Math.round(decoded.sampleRate * winSeconds))
  const hop = Math.max(1, Math.round(win / 4))
  const bal = []
  for (let i = 0; i + win <= L.length; i += hop) {
    let sl = 0, sr = 0
    for (let j = 0; j < win; j++) { sl += L[i + j] * L[i + j]; sr += R[i + j] * R[i + j] }
    const l = Math.sqrt(sl / win), r = Math.sqrt(sr / win)
    if (l + r > 1e-6) bal.push((l - r) / (l + r))
  }
  const a = Math.floor(bal.length * 0.1)
  const core = bal.slice(a, bal.length - a)
  if (core.length < 4) return 0
  const mean = core.reduce((x, y) => x + y, 0) / core.length
  const varr = core.reduce((x, y) => x + (y - mean) * (y - mean), 0) / core.length
  return Math.sqrt(varr)
}

const baseTrack = (overrides) => ({
  id: 't1', name: 't1', color: '#e06c75', kind: 'synth',
  synth: {
    osc: 'sawtooth', volume: -8, cutoff: 3000, resonance: 0.8, attack: 0.01, decay: 0.05, sustain: 1, release: 0.1, pan: 0,
    lfoRate: 4, lfoDepth: 0, lfoDest: 'off', lfoSync: false, lfoSyncRate: '1/4', lfoShape: 'sine',
    lfo2Rate: 3, lfo2Depth: 0, lfo2Dest: 'off', lfo2Sync: false, lfo2SyncRate: '1/8',
    ...overrides,
  },
  notes: [{ id: 'n1', pitch: 45, start: 0, duration: 96, velocity: 0.9 }], // holds the whole 6-bar loop
  clips: [], laneSamples: {}, hits: [],
})
const mkDoc = (bpm, synthOverrides) => ({
  formatVersion: '0.9', bpm, loopBars: 6, selectedTrack: 't1', media: [], scenes: [], song: null,
  tracks: [baseTrack(synthOverrides)],
})

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-lfo18-'))
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
  const errors = []
  // A fresh page (and therefore a fresh Tone.js context/engine graph) per test GROUP: the engine
  // keeps its audio node graph alive across setDoc() calls (so live knob edits are heard on the
  // next tick — by design), which means a scheduled-but-not-yet-elapsed automation ramp from one
  // recording (e.g. a continuous pan sweep) can bleed into the very next recording's captured
  // audio if they share a page. Isolating each group in its own page/engine sidesteps that
  // entirely rather than relying on stop() to have fully quiesced every AudioParam's schedule.
  const freshPage = async () => {
    const page = await browser.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })
    return page
  }
  const recordOn = (page) => async (doc, secs) => {
    const b64 = await page.evaluate(async ({ doc, secs }) => {
      window.__engine.stop()
      window.__store.getState().setDoc(doc)
      await window.__engine.play()
      await new Promise((r) => setTimeout(r, 250)) // let the graph settle before capture
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

  try {
    // ---------- TEMPO-SYNC: same synced LFO, bpm=90 vs bpm=180 (2x) ----------
    console.log('\n[TEMPO-SYNC] recording an amp-LFO(sync=1/4) held note at bpm=90 and bpm=180...')
    const pageA = await freshPage()
    const recordDocA = recordOn(pageA)
    const synced = { lfoDest: 'amp', lfoDepth: 1, lfoSync: true, lfoSyncRate: '1/4' }
    const rec90 = await recordDocA(mkDoc(90, synced), 4.0)
    const rec180 = await recordDocA(mkDoc(180, synced), 4.0)
    await pageA.close()
    const winSec = 0.01
    const e90 = envelope(rec90, winSec)
    const e180 = envelope(rec180, winSec)
    const hz90 = estimateModHz(e90.env, e90.hopSeconds)
    const hz180 = estimateModHz(e180.env, e180.hopSeconds)
    const expected90 = 90 / 60 / 1 // "1/4" = one quarter note = bpm/60 Hz
    const expected180 = 180 / 60 / 1
    console.log(`  bpm=90:  measured ${hz90.toFixed(2)}Hz (theoretical ${expected90.toFixed(2)}Hz)`)
    console.log(`  bpm=180: measured ${hz180.toFixed(2)}Hz (theoretical ${expected180.toFixed(2)}Hz)`)
    const ratio = hz180 / (hz90 || 1e-9)
    console.log(`  ratio ${ratio.toFixed(2)} (expect ~2.0, matching the bpm ratio)`)
    if (!(ratio > 1.5 && ratio < 2.7)) throw new Error(`[TEMPO-SYNC] modulation rate did not ~double with bpm (ratio ${ratio.toFixed(2)})`)
    if (!(Math.abs(hz90 - expected90) < 0.6 && Math.abs(hz180 - expected180) < 1.0))
      throw new Error(`[TEMPO-SYNC] measured rates too far from theoretical (90->${hz90.toFixed(2)}, 180->${hz180.toFixed(2)})`)
    console.log('  [TEMPO-SYNC] PASS: the LFO period tracks real tempo — same sync setting, different bpm, different measured Hz, ~2x with bpm')

    // ---------- LFO1 -> PAN (previously schema-illegal for LFO1) ----------
    console.log('\n[LFO1->PAN] recording a static-pan take vs an LFO1-pan take of the same note...')
    const pageB = await freshPage()
    const recordDocB = recordOn(pageB)
    const panOff = await recordDocB(mkDoc(120, { pan: 0, lfoDest: 'off' }), 2.0)
    const panOn = await recordDocB(mkDoc(120, { pan: 0, lfoDest: 'pan', lfoDepth: 0.9, lfoRate: 2.5, lfoSync: false }), 2.0)
    await pageB.close()
    const cvPanOff = panBalanceCV(panOff, 0.02)
    const cvPanOn = panBalanceCV(panOn, 0.02)
    console.log(`  stereo-balance CV: static ${cvPanOff.toFixed(3)}  ->  LFO1-pan ${cvPanOn.toFixed(3)}`)
    if (!(cvPanOn > cvPanOff * 3 && cvPanOn > 0.05)) throw new Error(`[LFO1->PAN] pan LFO did not measurably swing the stereo image (off ${cvPanOff.toFixed(3)}, on ${cvPanOn.toFixed(3)})`)
    console.log('  [LFO1->PAN] PASS: LFO1 on pan (newly schema-legal) measurably swings the stereo balance')

    // ---------- LFO2 -> RESONANCE (never an LFO destination before) ----------
    // Base resonance kept LOW (0.7) so the static take's spectral centroid stays put; the LFO2
    // take sweeps the SAME base up toward a strong resonant peak (~8.7) and back every cycle. A
    // resonance sweep barely moves overall loudness (it boosts a NARROW band, not broadband
    // energy) so this measures spectral centroid drift, not RMS — the right observable for a
    // filter-shape change (see centroidSeries above).
    console.log('\n[LFO2->RESONANCE] recording a static-resonance take vs an LFO2-resonance take...')
    const pageC = await freshPage()
    const recordDocC = recordOn(pageC)
    const resOff = await recordDocC(mkDoc(120, { cutoff: 1400, resonance: 0.7, lfo2Dest: 'off' }), 2.0)
    const resOn = await recordDocC(mkDoc(120, { cutoff: 1400, resonance: 0.7, lfo2Dest: 'resonance', lfo2Depth: 1, lfo2Rate: 2.5, lfo2Sync: false }), 2.0)
    await pageC.close()
    const cvResOff = seriesCV(await centroidSeries(resOff))
    const cvResOn = seriesCV(await centroidSeries(resOn))
    console.log(`  spectral-centroid CV: static ${cvResOff.toFixed(3)}  ->  LFO2-resonance ${cvResOn.toFixed(3)}`)
    if (!(cvResOn > cvResOff * 1.4 && cvResOn - cvResOff > 0.02)) throw new Error(`[LFO2->RESONANCE] resonance LFO did not measurably move the spectral centroid (off ${cvResOff.toFixed(3)}, on ${cvResOn.toFixed(3)})`)
    console.log('  [LFO2->RESONANCE] PASS: LFO2 on resonance (a brand-new LFO destination) measurably moves the spectral centroid')

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL PHASE 18 STREAM R CHECKS PASSED ================')
    console.log(JSON.stringify({ hz90, hz180, ratio, cvPanOff, cvPanOn, cvResOff, cvResOn }, (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nPHASE 18 STREAM R VERIFY FAILED:', err)
  process.exit(1)
})
