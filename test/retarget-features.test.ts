// src/retarget/features.ts against synthetic signals with KNOWN relationships — the same
// discipline test/match-loss.test.ts and test/metrics.test.ts use. These are the properties the
// role targets depend on being true; the absolute calibration against the owner's ref pool lives
// in scripts/mine-retarget-targets.mjs (needs private audio, so it can't be a CI gate).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  RETARGET_FEATURE_KEYS,
  bandCrestDb,
  computeRetargetFeatures,
  envelopeStats,
  magnitudeStft,
  median,
  normalizeToRefLufs,
  onsetStats,
  quantile,
  RETARGET_REF_LUFS,
  spectralFlatnessDb,
  spectralFlux,
  spectralSlopeDbPerOct,
  widthMeanDb,
} from '../src/retarget/features.js'
import { integratedLoudness } from '../src/metrics/loudness.js'

const FS = 44100

function tone(freq: number, seconds: number, amplitude = 0.3, shape: 'sine' | 'saw' = 'sine'): Float64Array {
  const out = new Float64Array(Math.round(seconds * FS))
  for (let i = 0; i < out.length; i++) {
    const phase = (freq * i) / FS
    out[i] = shape === 'sine' ? amplitude * Math.sin(2 * Math.PI * phase) : amplitude * (2 * (phase - Math.floor(phase + 0.5)))
  }
  return out
}

/** Deterministic white-ish noise (no rng module needed — a fixed LCG, seeded). */
function noise(seconds: number, amplitude = 0.3, seed = 12345): Float64Array {
  const out = new Float64Array(Math.round(seconds * FS))
  let s = seed >>> 0
  for (let i = 0; i < out.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    out[i] = amplitude * (s / 2147483648 - 1)
  }
  return out
}

/** A train of `n` decaying bursts of `freq`, each with a controllable attack time. */
function burstTrain(freq: number, seconds: number, n: number, attackSeconds: number, decaySeconds = 0.15): Float64Array {
  const out = new Float64Array(Math.round(seconds * FS))
  const period = out.length / n
  for (let k = 0; k < n; k++) {
    const start = Math.round(k * period)
    for (let i = 0; i < period && start + i < out.length; i++) {
      const t = i / FS
      const env = t < attackSeconds ? t / Math.max(1e-6, attackSeconds) : Math.exp(-(t - attackSeconds) / decaySeconds)
      out[start + i] = 0.5 * env * Math.sin((2 * Math.PI * freq * (start + i)) / FS)
    }
  }
  return out
}

test('the feature key list matches the computed vector exactly', () => {
  const f = computeRetargetFeatures([tone(220, 2)], FS)
  for (const key of RETARGET_FEATURE_KEYS) {
    assert.equal(typeof f[key], 'number', `${key} is missing from the computed features`)
    assert.ok(Number.isFinite(f[key]), `${key} is not finite (${f[key]})`)
  }
  // the two context fields are present but deliberately outside the key list
  assert.ok(f.durationSeconds > 1.9 && f.durationSeconds < 2.1)
  assert.ok(!(RETARGET_FEATURE_KEYS as readonly string[]).includes('durationSeconds'))
})

test('normalizeToRefLufs lands the clip on the reference loudness', () => {
  const quiet = [tone(220, 3, 0.01)]
  const loud = [tone(220, 3, 0.5)]
  for (const clip of [quiet, loud]) {
    const out = normalizeToRefLufs(clip, FS)
    const { integratedLufs } = integratedLoudness(out, FS)
    assert.ok(Math.abs(integratedLufs - RETARGET_REF_LUFS) < 0.5, `normalized to ${integratedLufs}, wanted ${RETARGET_REF_LUFS}`)
  }
})

test('features are level-invariant: the same sound at two gains measures the same', () => {
  const a = computeRetargetFeatures([tone(220, 3, 0.05, 'saw')], FS)
  const b = computeRetargetFeatures([tone(220, 3, 0.4, 'saw')], FS)
  assert.ok(Math.abs(a.truePeakDb - b.truePeakDb) < 0.3, `truePeak moved with level: ${a.truePeakDb} vs ${b.truePeakDb}`)
  assert.ok(Math.abs(a.centroidHz - b.centroidHz) < 1)
  assert.ok(Math.abs(a.flatnessHiDb - b.flatnessHiDb) < 0.5)
  assert.ok(Math.abs(a.fluxMean - b.fluxMean) < 0.02)
})

test('spectralFlux: a steady tone barely moves, a changing signal moves a lot', () => {
  const steady = spectralFlux(magnitudeStft(tone(440, 3), FS))
  // sweep 200 -> 4000 Hz
  const n = Math.round(3 * FS)
  const sweep = new Float64Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const f = 200 + (3800 * i) / n
    phase += (2 * Math.PI * f) / FS
    sweep[i] = 0.3 * Math.sin(phase)
  }
  const moving = spectralFlux(magnitudeStft(sweep, FS))
  assert.ok(moving.mean > steady.mean * 3, `sweep flux ${moving.mean} should dwarf steady flux ${steady.mean}`)
  assert.ok(moving.p95 >= moving.mean, 'p95 must be at least the mean')
})

test('spectralFlatnessDb: noise is flat (near 0 dB), a tone is not', () => {
  const noisy = spectralFlatnessDb(magnitudeStft(noise(2), FS), FS, 2000, 8000)
  const tonal = spectralFlatnessDb(magnitudeStft(tone(3000, 2), FS), FS, 2000, 8000)
  assert.ok(noisy > -6, `white noise flatness should be near 0 dB, got ${noisy}`)
  assert.ok(tonal < noisy - 20, `a tone (${tonal}) must be far less flat than noise (${noisy})`)
})

test('spectralSlopeDbPerOct: a dark signal tilts more negative than a bright one', () => {
  const dark = spectralSlopeDbPerOct(magnitudeStft(tone(100, 2, 0.3, 'saw'), FS), FS)
  const bright = spectralSlopeDbPerOct(magnitudeStft(noise(2), FS), FS)
  assert.ok(dark < bright, `saw-at-100Hz tilt ${dark} should be darker than white noise ${bright}`)
  assert.ok(Math.abs(bright) < 6, `white noise should be roughly flat per octave, got ${bright}`)
})

test('bandCrestDb: a steady band sits (low crest), a pumping band flaps (high crest)', () => {
  const steady = tone(120, 3)
  const pumping = new Float64Array(steady.length)
  for (let i = 0; i < pumping.length; i++) {
    // on a quarter of the time: p50 lands in the gap, p95 on the note — the shape a note-gapped
    // bass makes, and the reason 131 measured engineplus at 24 dB sub crest vs the refs' 7
    const gate = Math.floor((i / FS) * 4) % 4 === 0 ? 1 : 0.02
    pumping[i] = steady[i]! * gate
  }
  const cSteady = bandCrestDb(magnitudeStft(steady, FS), FS, 60, 250)
  const cPump = bandCrestDb(magnitudeStft(pumping, FS), FS, 60, 250)
  assert.ok(cSteady < 3, `a steady tone's band crest should be tiny, got ${cSteady}`)
  assert.ok(cPump > cSteady + 10, `a gated tone (${cPump}) should show far more band crest than a steady one (${cSteady})`)
})

test('onsetStats: counts the bursts and reads a fast attack as faster than a slow one', () => {
  const fast = burstTrain(440, 4, 8, 0.002)
  const slow = burstTrain(440, 4, 8, 0.06)
  const sFast = onsetStats(fast, FS, spectralFlux(magnitudeStft(fast, FS)))
  const sSlow = onsetStats(slow, FS, spectralFlux(magnitudeStft(slow, FS)))
  assert.ok(sFast.count >= 5 && sFast.count <= 11, `expected ~8 onsets, got ${sFast.count}`)
  assert.ok(sFast.attackP25Ms < sSlow.attackP25Ms, `fast attacks (${sFast.attackP25Ms} ms) must read faster than slow (${sSlow.attackP25Ms} ms)`)
  assert.ok(sFast.onsetRatePerSec > 1, `onset rate ${sFast.onsetRatePerSec} should be about 2/s`)
})

test('envelopeStats: a continuous tone sustains, a sparse one does not', () => {
  const full = envelopeStats(tone(300, 4), FS)
  const sparse = burstTrain(300, 4, 4, 0.005, 0.05)
  const gappy = envelopeStats(sparse, FS)
  assert.ok(full.sustainPct > 95, `a continuous tone should sustain ~100%, got ${full.sustainPct}`)
  assert.ok(gappy.sustainPct < full.sustainPct - 20, `sparse bursts (${gappy.sustainPct}%) should sustain far less than a held tone (${full.sustainPct}%)`)
  assert.ok(gappy.envStdDb > full.envStdDb, 'a gappy envelope must have more spread')
})

test('widthMeanDb: mono is degenerate, decorrelated channels are wide', () => {
  const mono = tone(440, 2)
  assert.ok(widthMeanDb([mono], FS) < -100, 'a single channel has no width to measure')
  assert.ok(widthMeanDb([mono, mono], FS) < -100, 'two identical channels are dead mono')
  const wide = widthMeanDb([noise(2, 0.3, 1), noise(2, 0.3, 999)], FS)
  assert.ok(wide > -3, `two independent noise channels should read near 0 dB wide, got ${wide}`)
})

test('quantile/median behave on known inputs', () => {
  const xs = [1, 2, 3, 4, 5]
  assert.equal(quantile(xs, 0), 1)
  assert.equal(quantile(xs, 0.5), 3)
  assert.equal(quantile(xs, 1), 5)
  assert.equal(median([5, 1, 3]), 3)
  assert.equal(median([]), 0)
  assert.equal(quantile([7], 0.9), 7)
})

test('a sub-heavy clip reads as sub-heavy and a mid-heavy one does not', () => {
  const sub = computeRetargetFeatures([tone(40, 3, 0.3, 'sine')], FS)
  const mid = computeRetargetFeatures([tone(800, 3, 0.3, 'sine')], FS)
  assert.ok(sub.bandSubPct > 80, `40 Hz sine should be almost all sub, got ${sub.bandSubPct}%`)
  assert.ok(mid.bandSubPct < 1, `800 Hz sine should have no sub, got ${mid.bandSubPct}%`)
  assert.ok(sub.centroidHz < 60 && mid.centroidHz > 600, `centroids: ${sub.centroidHz} / ${mid.centroidHz}`)
})
