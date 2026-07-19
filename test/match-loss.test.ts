// The match loss tested against synthetic signals with known relationships (same discipline as
// test/metrics.test.ts): identical audio scores ~0, level differences are invisible (loudness
// normalization), and closer timbres score closer than distant ones.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ANALYSIS_RATE,
  prepareTarget,
  matchLoss,
  monoMix,
  resampleLinear,
  normalizeLoudness,
  cosineSimilarity,
  amplitudeEnvelope,
} from '../src/match/loss.js'

const FS = 44100

function tone(freq: number, seconds: number, amplitude: number, shape: 'sine' | 'saw' = 'sine'): Float64Array {
  const out = new Float64Array(Math.round(seconds * FS))
  for (let i = 0; i < out.length; i++) {
    const phase = (freq * i) / FS
    out[i] =
      shape === 'sine'
        ? amplitude * Math.sin(2 * Math.PI * phase)
        : amplitude * (2 * (phase - Math.floor(phase + 0.5)))
  }
  return out
}

/** Exponentially decaying pluck-ish envelope applied in place. */
function withDecay(x: Float64Array, tau: number): Float64Array {
  const out = new Float64Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = x[i]! * Math.exp(-i / (tau * FS))
  return out
}

test('identical audio has ~zero loss', () => {
  const sig = withDecay(tone(440, 1.5, 0.5), 0.3)
  const target = prepareTarget([sig], FS)
  const loss = matchLoss(target, [sig.slice()], FS)
  assert.ok(loss.total < 1e-9, `self loss ${loss.total}`)
  assert.ok(loss.mfccDistance < 1e-9)
})

test('loudness differences are normalized away (level must not buy loss)', () => {
  const sig = withDecay(tone(440, 1.5, 0.6), 0.3)
  const quiet = new Float64Array(sig.length)
  for (let i = 0; i < sig.length; i++) quiet[i] = sig[i]! * 0.1 // -20 dB
  const target = prepareTarget([sig], FS)
  const loss = matchLoss(target, [quiet], FS)
  assert.ok(loss.total < 0.02, `gained-copy loss ${loss.total} should be ~0`)
})

test('closer pitch/timbre scores lower: 440 sine target prefers 466 sine over 880 saw', () => {
  const target = prepareTarget([withDecay(tone(440, 1.2, 0.5), 0.4)], FS)
  const near = matchLoss(target, [withDecay(tone(466, 1.2, 0.5), 0.4)], FS)
  const far = matchLoss(target, [withDecay(tone(880, 1.2, 0.5, 'saw'), 0.4)], FS)
  assert.ok(near.total < far.total, `near ${near.total} !< far ${far.total}`)
  assert.ok(near.total > 0.001, 'different audio must not score zero')
})

test('envelope term separates a pluck from a pad at the same spectrum', () => {
  const pluck = withDecay(tone(440, 1.5, 0.5), 0.12)
  const pad = tone(440, 1.5, 0.5)
  const target = prepareTarget([pluck], FS)
  const padLoss = matchLoss(target, [pad], FS)
  const pluckLoss = matchLoss(target, [withDecay(tone(440, 1.5, 0.5), 0.14)], FS)
  assert.ok(pluckLoss.envelope < padLoss.envelope, `pluck env ${pluckLoss.envelope} !< pad env ${padLoss.envelope}`)
  assert.ok(pluckLoss.total < padLoss.total)
})

test('candidate at a different sample rate is resampled, not garbage', () => {
  const sig48 = (() => {
    const seconds = 1.2
    const out = new Float64Array(Math.round(seconds * 48000))
    for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000) * Math.exp(-i / (0.3 * 48000))
    return out
  })()
  const sig44 = withDecay(tone(440, 1.2, 0.5), 0.3)
  const target = prepareTarget([sig44], FS)
  const loss = matchLoss(target, [sig48], 48000)
  assert.ok(loss.total < 0.15, `cross-rate same-sound loss ${loss.total}`)
})

test('helpers: monoMix averages, resample keeps duration, normalizeLoudness hits the target zone', () => {
  const l = tone(440, 1, 0.8)
  const r = tone(440, 1, 0.0)
  const mono = monoMix([l, r])
  assert.ok(Math.abs(mono[100]! - l[100]! / 2) < 1e-12)
  const res = resampleLinear(l, FS, ANALYSIS_RATE)
  assert.ok(Math.abs(res.length / ANALYSIS_RATE - l.length / FS) < 0.01)
  const norm = normalizeLoudness(resampleLinear(l, FS, ANALYSIS_RATE), ANALYSIS_RATE)
  let peak = 0
  for (const v of norm) peak = Math.max(peak, Math.abs(v))
  assert.ok(peak > 0.01 && peak < 1.0, `normalized peak ${peak}`)
})

test('silence stays finite (no NaN loss)', () => {
  const target = prepareTarget([withDecay(tone(440, 1, 0.5), 0.3)], FS)
  const loss = matchLoss(target, [new Float64Array(FS)], FS)
  assert.ok(Number.isFinite(loss.total) && loss.total > 0, `silence loss ${loss.total}`)
})

test('cosineSimilarity basics', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1)
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
  assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [2, 4, 6]) - 1) < 1e-12)
})

test('amplitudeEnvelope tracks decay monotonically-ish', () => {
  const env = amplitudeEnvelope(resampleLinear(withDecay(tone(440, 1, 0.5), 0.1), FS, ANALYSIS_RATE))
  assert.ok(env.length > 10)
  assert.ok(env[0]! > env[env.length - 1]!, 'decaying signal should end quieter than it starts')
})
