#!/usr/bin/env node
// Phase 23 Stream BE verification — Auto Filter / Auto Pan / Tremolo / Utility + Redux's
// downsampling half (bitcrushRate). Drives the REAL live GUI engine (ui/src/audio/engine.ts) over
// a headless-Chromium tab, same harness/convention as ui/verify-phase22-stream-ac.mjs: params are
// set through window.__bridge.postEdit (the exact function every SynthPanel.tsx knob's onChange
// calls, itself POSTing to the daemon's real /edit route), and — new for this stream, since these
// four effects only exist in the audio graph once actually ADDED to a track's reorderable effect
// chain (unlike Stream AC's saturator/chorus/phaser/pingPong, which were always-wired fixed-tail
// nodes) — chain membership is set through window.__bridge.postEffectAdd, the exact function the
// GUI's "Effect Chain" add-effect button calls. Measures RECORDED AUDIO for each effect:
//
//   AUTO FILTER   held sawtooth (rich harmonics). Off (mix=0) vs on (mix=1, fast rate): expect the
//                 recorded spectral centroid (src/metrics' analyze()) to vary measurably MORE over
//                 time when engaged — the audible signature of a swept filter, same technique
//                 Stream AC's chorus/phaser checks use.
//   AUTO PAN      held tone. Off vs on (mix=1, depth=1): expect the per-window (L-R)/(L+R) "pan
//                 position" series to swing across a wide range when engaged (near-zero range when
//                 bypassed, since the base voice is centered) — a real alternating stereo position,
//                 not a level change.
//   TREMOLO       held tone. Off vs on (mix=1, depth=1, spread=180 — full L/R phase inversion,
//                 Tone.Tremolo's own documented behavior): expect (a) the OVERALL envelope to show
//                 periodic amplitude modulation (rising coefficient of variation) and (b) the L and
//                 R channel envelopes to become ANTI-correlated (spread=180 = opposite LFO phase
//                 per channel) — a specific, hard-to-fake signature real amplitude modulation alone
//                 wouldn't produce if it were e.g. a filter sweep instead.
//   UTILITY       a wide-unison patch (real pre-existing stereo content from osc2/osc3/unison-pair
//                 panning). utilityWidth=0 (all mid) vs utilityWidth=1 (all side): expect the
//                 recorded stereo correlation (src/metrics' analyze().stereo.correlation) to swing
//                 from strongly positive toward strongly negative — a real, measurable stereo-field
//                 change, not a level change.
//   REDUX         a pure sine well above the DOWNSAMPLED effective Nyquist (bitcrushRate=hold
//                 factor). Off vs on: Goertzel-measure energy at the ALIAS frequency the fold-back
//                 math predicts (computed from the ACTUAL recorded sample rate, not assumed) —
//                 expect a real new frequency-domain artifact to appear that wasn't there before,
//                 the textbook aliasing signature, not just a loudness/tone change.
//
// Usage: node ui/verify-phase23-stream-be.mjs

import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5932

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

// ---- shared measurement helpers -----------------------------------------------------------

// Short-window RMS envelope of ONE channel.
function envelope(samples, sampleRate, winSeconds) {
  const win = Math.max(4, Math.round(sampleRate * winSeconds))
  const hop = Math.max(1, Math.round(win / 4))
  const env = []
  for (let i = 0; i + win <= samples.length; i += hop) {
    let s = 0
    for (let j = 0; j < win; j++) s += samples[i + j] * samples[i + j]
    env.push(Math.sqrt(s / win))
  }
  return { env, hopSeconds: hop / sampleRate }
}

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

// Pearson correlation between two equal(ish)-length series (used on envelope series, NOT raw
// samples — this is a slower, amplitude-envelope-level correlation, distinct from src/metrics'
// sample-level stereo.correlation used for the Utility check below).
function pearson(a, b) {
  const n = Math.min(a.length, b.length)
  let ma = 0, mb = 0
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n
  let num = 0, da = 0, db_ = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb
    num += x * y
    da += x * x
    db_ += y * y
  }
  const den = Math.sqrt(da * db_)
  return den === 0 ? 1 : num / den
}

// Per-window (L-R)/(L+R) "pan position" series, -1 (hard L) .. +1 (hard R), from two envelope
// series (already windowed/hopped identically).
function panPositionSeries(envL, envR) {
  const n = Math.min(envL.length, envR.length)
  const out = new Array(n)
  for (let i = 0; i < n; i++) {
    const s = envL[i] + envR[i]
    out[i] = s > 1e-9 ? (envL[i] - envR[i]) / s : 0
  }
  return out
}

// Goertzel single-bin magnitude estimate.
function goertzelMag(samples, sampleRate, freq) {
  const n = samples.length
  const k = Math.round((freq * n) / sampleRate)
  const w = (2 * Math.PI * k) / n
  const cosine = Math.cos(w)
  const coeff = 2 * cosine
  let q0 = 0, q1 = 0, q2 = 0
  for (let i = 0; i < n; i++) {
    q0 = coeff * q1 - q2 + samples[i]
    q2 = q1
    q1 = q0
  }
  const real = q1 - q2 * cosine
  const imag = q2 * Math.sin(w)
  return Math.sqrt(real * real + imag * imag) / (n / 2)
}

// Fold a frequency into [0, fs/2] by reflecting off Nyquist multiples of `fs` — the standard
// aliasing fold-back formula, used here with `fs` = the EFFECTIVE (downsampled) rate rather than
// the recording's native rate, to predict where a too-high input frequency will alias to.
function foldFrequency(f, fs) {
  let m = f % fs
  if (m < 0) m += fs
  if (m > fs / 2) m = fs - m
  return m
}

// ---- doc builders ---------------------------------------------------------------------------

let BASE_SYNTH
let DEFAULT_EFFECT_CHAIN
async function baseSynth() {
  if (!BASE_SYNTH) {
    const { INIT_SYNTH, defaultEffectChain } = await import(join(repoRoot, 'dist/src/core/index.js'))
    BASE_SYNTH = { ...INIT_SYNTH, osc: 'sine', volume: -8, cutoff: 8000, resonance: 0.7, attack: 0.001, decay: 0.05, sustain: 0, release: 0.05, pan: 0 }
    DEFAULT_EFFECT_CHAIN = defaultEffectChain()
  }
  return BASE_SYNTH
}
function defaultEffectChain() {
  return DEFAULT_EFFECT_CHAIN
}

// Held sawtooth, whole 4-bar loop — rich harmonics (Auto Filter needs them to show spectral
// movement) and enough sustain for AutoPan/Tremolo's periodic-modulation window to be measured
// cleanly mid-note.
async function heldSawDoc() {
  const base = await baseSynth()
  return {
    formatVersion: '0.9', bpm: 120, loopBars: 4, selectedTrack: 't1', media: [], scenes: [], song: null, groups: [],
    tracks: [{
      id: 't1', name: 't1', color: '#61afef', kind: 'synth',
      synth: { ...base, osc: 'sawtooth', volume: -6, cutoff: 9000, resonance: 0.3, attack: 0.01, decay: 0.05, sustain: 1, release: 0.1, pan: 0 },
      notes: [{ id: 'n1', pitch: 57, start: 0, duration: 62, velocity: 0.85, chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 }],
      clips: [], laneSamples: {}, hits: [], effects: defaultEffectChain(), lanes: [], shuffleAmount: 0, shuffleGrid: 1,
    }],
  }
}

// A wide-unison patch: the BASE voice (synth.connect(filter), no panner) stays centered, but
// osc2/osc3/the unison pairs are each independently panned by unisonWidth — real, pre-existing
// stereo content feeding INTO the effect chain, which is what Utility's StereoWidener needs to
// have anything to widen/narrow (see docs/phase-23-stream-be.md for why a mono source is an
// honest, documented no-op for this insert, same as real DAWs).
async function wideUnisonDoc() {
  const base = await baseSynth()
  return {
    formatVersion: '0.9', bpm: 120, loopBars: 4, selectedTrack: 't1', media: [], scenes: [], song: null, groups: [],
    tracks: [{
      id: 't1', name: 't1', color: '#98c379', kind: 'synth',
      synth: { ...base, osc: 'sawtooth', osc2Type: 'sawtooth', osc2Level: 0.9, unisonVoices: 7, unisonWidth: 1, volume: -6, cutoff: 9000, attack: 0.01, decay: 0.05, sustain: 1, release: 0.1, pan: 0 },
      notes: [{ id: 'n1', pitch: 57, start: 0, duration: 62, velocity: 0.85, chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 }],
      clips: [], laneSamples: {}, hits: [], effects: defaultEffectChain(), lanes: [], shuffleAmount: 0, shuffleGrid: 1,
    }],
  }
}

// A held PURE sine at 7000 Hz — well above where it'll alias once downsampled, but well within
// the native (undownsampled) Nyquist, so the "off" take carries it cleanly with no energy at the
// predicted alias frequency at all (a pure sine has energy at exactly one bin).
const REDUX_F0 = 7000
async function reduxDoc() {
  const base = await baseSynth()
  return {
    formatVersion: '0.9', bpm: 120, loopBars: 4, selectedTrack: 't1', media: [], scenes: [], song: null, groups: [],
    tracks: [{
      id: 't1', name: 't1', color: '#e5c07b', kind: 'synth',
      synth: { ...base, osc: 'sine', volume: -6, cutoff: 18000, resonance: 0.1, attack: 0.01, decay: 0.05, sustain: 1, release: 0.1, pan: 0 },
      // pitch 127 is out of a normal keyboard's musical range, but this engine maps note pitch to
      // Hz via standard MIDI equal-temperament (A4=69=440Hz) with no upper clamp on synthesis, and
      // this test only cares about a precise, known frequency reaching the bitcrush insert — using
      // the note's frequency directly would fight for exact-Hz precision, so instead the synth's
      // own `cutoff` is left wide open and osc pitch is chosen so f0 lands close to REDUX_F0, then
      // refined via detune below for exactness. See setup below (osc2Detune unused; pitch math is
      // computed once at doc-build time).
      notes: [{ id: 'n1', pitch: reduxPitchFor(REDUX_F0).pitch, start: 0, duration: 62, velocity: 0.85, chance: 100, cent: reduxPitchFor(REDUX_F0).cent, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 }],
      clips: [], laneSamples: {}, hits: [], effects: defaultEffectChain(), lanes: [], shuffleAmount: 0, shuffleGrid: 1,
    }],
  }
}
// MIDI pitch (nearest semitone, A4=69=440Hz) + a `cent` micro-tuning offset (v0.10 per-note field,
// exact to well under 1 Hz at 7kHz) that together produce EXACTLY `hz`.
function reduxPitchFor(hz) {
  const midi = 69 + 12 * Math.log2(hz / 440)
  const pitch = Math.max(0, Math.min(127, Math.round(midi)))
  const actualHz = (p) => 440 * Math.pow(2, (p - 69) / 12)
  const cents = 1200 * Math.log2(hz / actualHz(pitch))
  return { pitch, cent: Math.max(-50, Math.min(50, Math.round(cents))) }
}

// ---- daemon/browser plumbing ------------------------------------------------------------------

async function startProject(doc) {
  const { serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p23be-'))
  const beatPath = join(proj, 'project.beat')
  writeFileSync(beatPath, serialize(doc))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')
  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  return daemon
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

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

  async function withGroup(doc, run) {
    const daemon = await startProject(doc)
    const page = await browser.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine && window.__bridge, { timeout: 12000 })
    try {
      await run(page)
    } finally {
      await page.close()
      await daemon.close()
    }
  }

  // Adds an effect to the track's chain via the REAL GUI code path (window.__bridge.postEffectAdd
  // — the exact function the "Effect Chain" panel's add button calls), and waits for the store to
  // reflect it before returning (postEffectAdd applies the daemon's response directly, no SSE
  // echo — see bridge.ts).
  async function addEffect(page, track, type, id) {
    await page.evaluate(({ track, type, id }) => window.__bridge.postEffectAdd(track, type, { id }), { track, type, id })
    await page.waitForFunction(
      ({ track, id }) => {
        const doc = window.__store.getState().doc
        const t = doc && doc.tracks.find((t) => t.id === track)
        return t && t.effects.some((e) => e.id === id)
      },
      { track, id },
      { timeout: 8000 },
    )
  }

  async function setParam(page, path, value) {
    await page.evaluate(({ path, value }) => window.__bridge.postEdit(path, value), { path, value })
    await page.waitForFunction(
      ({ path, value }) => {
        const doc = window.__store.getState().doc
        if (!doc) return false
        const [trackId, key] = path.split('.')
        const t = doc.tracks.find((t) => t.id === trackId)
        return t && String(t.synth[key]) === String(value)
      },
      { path, value },
      { timeout: 8000 },
    )
    await sleep(150) // let postEdit's debounce actually flush the POST /edit to the daemon
  }

  async function record(page, secs) {
    const b64 = await page.evaluate(async (secs) => {
      window.__engine.stop()
      await window.__engine.play()
      await new Promise((r) => setTimeout(r, 250))
      const blob = await window.__engine.recordWav(secs)
      window.__engine.stop()
      const buf = await blob.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      return btoa(bin)
    }, secs)
    return analyzeBase64Wav(b64)
  }

  // Trims the attack/settle region so measurements only see the held, steady-state part of the note.
  function steadyChunk(decoded, startSec, lenSec) {
    const a = Math.round(startSec * decoded.sampleRate)
    const b = Math.min(decoded.channels[0].length, Math.round((startSec + lenSec) * decoded.sampleRate))
    return decoded.channels.map((ch) => ch.slice(a, b))
  }

  try {
    // ============================================================================================
    console.log('\n[AUTO FILTER] held sawtooth, chain has autoFilter mix=0 vs mix=1 (fast sweep) — expect measurably more spectral-centroid movement...')
    await withGroup(await heldSawDoc(), async (page) => {
      await addEffect(page, 't1', 'autoFilter', 'af1')
      const off = await record(page, 2.5) // mix defaults to 0 (elided) — present in chain but bypassed
      await setParam(page, 't1.autoFilterRate', '3')
      await setParam(page, 't1.autoFilterDepth', '1')
      await setParam(page, 't1.autoFilterOctaves', '4')
      await setParam(page, 't1.autoFilterBaseFrequency', '300')
      await setParam(page, 't1.autoFilterMix', '1')
      const on = await record(page, 2.5)
      const cvOff = seriesCV(await centroidSeries(off))
      const cvOn = seriesCV(await centroidSeries(on))
      console.log(`  spectral-centroid CV: off ${cvOff.toFixed(4)}  ->  autoFilter-on ${cvOn.toFixed(4)}`)
      if (!(cvOn > cvOff * 1.5 && cvOn - cvOff > 0.02)) throw new Error(`[AUTO FILTER] did not measurably increase spectral-centroid movement (off ${cvOff.toFixed(4)}, on ${cvOn.toFixed(4)})`)
      console.log('  [AUTO FILTER] PASS: engaging the swept filter measurably increases spectral modulation over the static take')
    })

    // ============================================================================================
    console.log('\n[AUTO PAN] held tone, mix=0 vs mix=1 (depth=1, rate=1.2Hz) — expect the stereo pan position to swing across a wide range...')
    await withGroup(await heldSawDoc(), async (page) => {
      await addEffect(page, 't1', 'autoPan', 'ap1')
      const off = await record(page, 3.0)
      await setParam(page, 't1.autoPanRate', '1.2')
      await setParam(page, 't1.autoPanDepth', '1')
      await setParam(page, 't1.autoPanMix', '1')
      const on = await record(page, 3.0)

      const winSec = 0.03
      const panRange = (decoded) => {
        const [L, R] = steadyChunk(decoded, 0.4, 2.4)
        const eL = envelope(L, decoded.sampleRate, winSec)
        const eR = envelope(R, decoded.sampleRate, winSec)
        const series = panPositionSeries(eL.env, eR.env)
        return { range: Math.max(...series) - Math.min(...series), series }
      }
      const offP = panRange(off)
      const onP = panRange(on)
      console.log(`  pan-position range: off ${offP.range.toFixed(3)}  ->  autoPan-on ${onP.range.toFixed(3)} (max possible 2.0, hard L to hard R)`)
      if (!(onP.range > 1.0 && onP.range > offP.range * 3)) throw new Error(`[AUTO PAN] did not measurably alternate stereo position (off range ${offP.range.toFixed(3)}, on range ${onP.range.toFixed(3)})`)
      console.log('  [AUTO PAN] PASS: engaging Auto Pan measurably alternates the recorded stereo position over time')
    })

    // ============================================================================================
    console.log('\n[TREMOLO] held tone, mix=0 vs mix=1 (depth=1, rate=6Hz, spread=180) — expect periodic amplitude modulation AND anti-correlated L/R envelopes...')
    await withGroup(await heldSawDoc(), async (page) => {
      await addEffect(page, 't1', 'tremolo', 'tr1')
      const off = await record(page, 2.5)
      await setParam(page, 't1.tremoloRate', '6')
      await setParam(page, 't1.tremoloDepth', '1')
      await setParam(page, 't1.tremoloSpread', '180')
      await setParam(page, 't1.tremoloMix', '1')
      const on = await record(page, 2.5)

      const winSec = 0.006
      // Per-CHANNEL envelope CV (NOT the mono/L+R sum): at spread=180, L and R are modulated in
      // exactly opposite phase (see the L/R correlation check below), so a mono sum of the two
      // exactly CANCELS the amplitude modulation (L rising while R falls by the same amount, sum
      // constant) — real DSP, not a test bug, but it means the "periodic amplitude modulation"
      // claim has to be checked on one channel at a time, not the sum.
      const channelEnvCV = (decoded) => {
        const [L, R] = steadyChunk(decoded, 0.4, 1.9)
        const cvL = seriesCV(envelope(L, decoded.sampleRate, winSec).env, 0)
        const cvR = seriesCV(envelope(R, decoded.sampleRate, winSec).env, 0)
        return Math.max(cvL, cvR)
      }
      const lrCorrelation = (decoded) => {
        const [L, R] = steadyChunk(decoded, 0.4, 1.9)
        const eL = envelope(L, decoded.sampleRate, winSec)
        const eR = envelope(R, decoded.sampleRate, winSec)
        return pearson(eL.env, eR.env)
      }
      const cvOff = channelEnvCV(off)
      const cvOn = channelEnvCV(on)
      const corrOff = lrCorrelation(off)
      const corrOn = lrCorrelation(on)
      console.log(`  per-channel envelope CV (max of L,R): off ${cvOff.toFixed(4)}  ->  tremolo-on ${cvOn.toFixed(4)}`)
      console.log(`  L/R envelope correlation: off ${corrOff.toFixed(3)}  ->  tremolo-on ${corrOn.toFixed(3)} (expect strongly negative — spread=180 inverts LFO phase per channel)`)
      if (!(cvOn > cvOff * 2 && cvOn > 0.05)) throw new Error(`[TREMOLO] did not show measurable periodic amplitude modulation (off CV ${cvOff.toFixed(4)}, on CV ${cvOn.toFixed(4)})`)
      if (!(corrOn < -0.3 && corrOn < corrOff - 0.5)) throw new Error(`[TREMOLO] L/R envelopes did not become anti-correlated (off ${corrOff.toFixed(3)}, on ${corrOn.toFixed(3)})`)
      console.log('  [TREMOLO] PASS: engaging Tremolo produces real periodic amplitude modulation, with L/R channels anti-correlated as spread=180 predicts')
    })

    // ============================================================================================
    console.log('\n[UTILITY] wide-unison patch, utilityWidth=0 (mono) vs utilityWidth=1 (max stereo) — expect stereo correlation to swing from positive to negative...')
    await withGroup(await wideUnisonDoc(), async (page) => {
      await addEffect(page, 't1', 'utility', 'ut1')
      await setParam(page, 't1.utilityWidth', '0')
      const mono = await record(page, 2.5)
      await setParam(page, 't1.utilityWidth', '1')
      const wide = await record(page, 2.5)

      const { analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
      const chunkMono = steadyChunk(mono, 0.4, 1.9)
      const chunkWide = steadyChunk(wide, 0.4, 1.9)
      const corrMono = analyze(chunkMono, mono.sampleRate).stereo.correlation
      const corrWide = analyze(chunkWide, wide.sampleRate).stereo.correlation
      console.log(`  stereo correlation: width=0 ${corrMono.toFixed(3)}  ->  width=1 ${corrWide.toFixed(3)} (expect a large drop toward negative)`)
      if (!(corrMono > 0.9)) throw new Error(`[UTILITY] width=0 (all mid) should be strongly positively correlated (mono), got ${corrMono.toFixed(3)}`)
      if (!(corrWide < corrMono - 0.5)) throw new Error(`[UTILITY] widening did not measurably change stereo correlation (width=0 ${corrMono.toFixed(3)}, width=1 ${corrWide.toFixed(3)})`)
      console.log('  [UTILITY] PASS: StereoWidener measurably changes recorded stereo correlation between its two extremes')
    })

    // ============================================================================================
    console.log(`\n[REDUX] held pure sine @ ${REDUX_F0}Hz, off vs bitcrushRate=12 (mix=1) — expect a real aliasing artifact at the predicted fold-back frequency...`)
    await withGroup(await reduxDoc(), async (page) => {
      const off = await record(page, 2.5)
      await setParam(page, 't1.bitcrushBits', '16') // isolate rate reduction from bit-depth crushing
      await setParam(page, 't1.bitcrushRate', '12')
      await setParam(page, 't1.bitcrushMix', '1') // shared dry/wet gate — required for EITHER dimension to be audible
      const on = await record(page, 2.5)

      const chunkOff = steadyChunk(off, 0.4, 1.9).map((ch) => ch)[0]
      const chunkOn = steadyChunk(on, 0.4, 1.9).map((ch) => ch)[0]
      const fs = off.sampleRate
      const hold = 12
      const effRate = fs / hold
      const alias = foldFrequency(REDUX_F0, effRate)
      console.log(`  recorded sample rate: ${fs}Hz; effective rate after hold=${hold}: ${effRate.toFixed(0)}Hz; predicted alias of ${REDUX_F0}Hz: ${alias.toFixed(0)}Hz`)

      const f0MagOff = goertzelMag(chunkOff, fs, REDUX_F0)
      const f0MagOn = goertzelMag(chunkOn, fs, REDUX_F0)
      const aliasMagOff = goertzelMag(chunkOff, fs, alias)
      const aliasMagOn = goertzelMag(chunkOn, fs, alias)
      console.log(`  magnitude @ ${REDUX_F0}Hz (fundamental): off ${f0MagOff.toExponential(2)}  ->  on ${f0MagOn.toExponential(2)}`)
      console.log(`  magnitude @ ${alias.toFixed(0)}Hz (predicted alias): off ${aliasMagOff.toExponential(2)}  ->  on ${aliasMagOn.toExponential(2)}`)
      if (!(aliasMagOff < f0MagOff * 0.05)) throw new Error(`[REDUX] the "off" take should have negligible energy at the alias frequency (got ${aliasMagOff.toExponential(2)} vs fundamental ${f0MagOff.toExponential(2)})`)
      if (!(aliasMagOn > aliasMagOff * 5 && aliasMagOn > f0MagOff * 0.1)) throw new Error(`[REDUX] downsampling did not produce a measurable aliasing artifact at the predicted fold-back frequency (off ${aliasMagOff.toExponential(2)}, on ${aliasMagOn.toExponential(2)}, fundamental-off ${f0MagOff.toExponential(2)})`)
      console.log('  [REDUX] PASS: bitcrushRate downsampling produces a real, predicted-frequency aliasing artifact — a genuine bandwidth/aliasing effect, not just a level or tone change')
    })

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL PHASE 23 STREAM BE CHECKS PASSED ================')
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error('\nPHASE 23 STREAM BE VERIFY FAILED:', err)
  process.exit(1)
})
