// The retarget search loop, end to end, through a pure-TS stand-in synthesizer — the same
// browser-free discipline test/match-harness.test.ts uses for `beat match`. The stand-in is crude
// but RESPONSIVE in the right directions (subLevel adds sub-octave energy, cutoff darkens,
// filterEnvAmount adds movement, attack shapes the onset), which is all the search needs to be
// exercised. Nothing here asserts audio quality; it asserts the harness's contract.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatRetargetReport, runRetarget, type DecodedAudio } from '../src/retarget/harness.js'
import { retargetSpace, presetGenome, trustBounds } from '../src/retarget/space.js'

const FS = 22050
const SECONDS = 4

/** A deliberately simple parametric voice: 8 saw partials over a note pattern, one-pole lowpass at
 * `cutoff` swept by the filter envelope, a sub-octave sine at `subLevel`, noise at `noiseLevel`,
 * and an AD amp envelope. Deterministic. */
function stubSynth(params: Record<string, number>, f0 = 55): DecodedAudio {
  const n = Math.round(SECONDS * FS)
  const out = new Float64Array(n)
  const noteLen = Math.round(FS * 0.5)
  const cutoff = Math.min(FS / 2 - 100, Math.max(40, params.cutoff ?? 2000))
  const attack = Math.max(0.0005, params.attack ?? 0.01)
  const decay = Math.max(0.005, params.decay ?? 0.2)
  const sustain = Math.min(1, Math.max(0, params.sustain ?? 0.6))
  const sub = Math.min(1, Math.max(0, params.subLevel ?? 0))
  const noiseAmt = Math.min(1, Math.max(0, params.noiseLevel ?? 0))
  const fenv = Math.min(1, Math.max(0, params.filterEnvAmount ?? 0))
  let seed = 987654321
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2147483648 - 1
  }
  let lp = 0
  for (let i = 0; i < n; i++) {
    const t = (i % noteLen) / FS
    const amp = t < attack ? t / attack : sustain + (1 - sustain) * Math.exp(-(t - attack) / decay)
    let s = 0
    for (let h = 1; h <= 8; h++) s += Math.sin((2 * Math.PI * f0 * h * i) / FS) / h
    s += sub * 1.4 * Math.sin((2 * Math.PI * (f0 / 2) * i) / FS)
    s += noiseAmt * rnd()
    // one-pole lowpass whose corner is swept upward by the filter envelope on each note
    const fc = Math.min(FS / 2 - 100, cutoff * (1 + fenv * 6 * Math.exp(-t / Math.max(0.01, decay))))
    const a = 1 - Math.exp((-2 * Math.PI * fc) / FS)
    lp += a * (s - lp)
    out[i] = 0.25 * amp * lp
  }
  return { channels: [out], sampleRate: FS }
}

const BASS_PRESET = { osc: 'square', volume: -8.2, cutoff: 1288, resonance: 0.765, attack: 0.003, decay: 0.035, sustain: 0.52, release: 1.245 }

test('the retargeter never reports worse than the preset it started from', async () => {
  const r = await runRetarget({
    role: 'bassline',
    presetId: 'stub-bass',
    presetParams: BASS_PRESET,
    render: async (p) => stubSynth(p),
    budget: 60,
    population: 8,
    seed: 7,
  })
  assert.ok(r.after.loss.total <= r.before.loss.total + 1e-9, `after ${r.after.loss.total} must not exceed before ${r.before.loss.total}`)
  assert.ok(r.after.loss.hit >= r.before.loss.hit, 'the retarget must not lose targets on net')
  assert.ok(r.renders + r.cacheHits <= r.budget + 1, `budget overrun: ${r.renders + r.cacheHits} evals of ${r.budget}`)
  assert.ok(r.renders >= 2)
  assert.match(formatRetargetReport(r), /stub-bass \(bassline\)/)
})

test('the search actually improves the objective on a responsive stand-in', async () => {
  const r = await runRetarget({
    role: 'bassline',
    presetId: 'stub-bass',
    presetParams: { ...BASS_PRESET, subLevel: 0, cutoff: 6000 },
    render: async (p) => stubSynth(p),
    budget: 120,
    population: 10,
    seed: 3,
  })
  assert.ok(r.after.loss.total < r.before.loss.total, `loss should fall: ${r.before.loss.total} -> ${r.after.loss.total}`)
  assert.ok(r.moved.length > 0, 'something must have moved')
})

test('every moved parameter stays inside its trust radius', async () => {
  const r = await runRetarget({
    role: 'chords',
    presetId: 'stub-chords',
    presetParams: { cutoff: 900, attack: 0.03, decay: 0.4, sustain: 0.8 },
    render: async (p) => stubSynth(p, 220),
    budget: 60,
    population: 8,
    seed: 11,
  })
  const defs = retargetSpace('chords')
  const start = presetGenome(defs, { cutoff: 900, attack: 0.03, decay: 0.4, sustain: 0.8 })
  const { lower, upper } = trustBounds(defs, start)
  for (const m of r.moved) {
    const i = defs.findIndex((d) => d.field === m.field)
    assert.ok(i >= 0, `unknown field ${m.field}`)
    assert.ok(Math.abs(m.trustFraction) <= 1 + 1e-6, `${m.field} moved ${m.trustFraction} of its trust radius`)
    assert.ok(upper[i]! - lower[i]! > 0)
  }
})

test('the loss curve is monotone in `best` and records every evaluation', async () => {
  const r = await runRetarget({
    role: 'lead',
    presetId: 'stub-lead',
    presetParams: { cutoff: 4000, attack: 0.02 },
    render: async (p) => stubSynth(p, 440),
    budget: 50,
    population: 8,
    seed: 5,
  })
  assert.equal(r.curve.length, r.renders + r.cacheHits)
  for (let i = 1; i < r.curve.length; i++) {
    assert.ok(r.curve[i]!.best <= r.curve[i - 1]!.best + 1e-9, `best rose at eval ${i}`)
    assert.equal(r.curve[i]!.eval, i + 1)
  }
  assert.equal(r.curve[r.curve.length - 1]!.best, Math.round(r.after.loss.total * 10000) / 10000)
})

test('the run is deterministic in its seed', async () => {
  const run = () =>
    runRetarget({
      role: 'bassline',
      presetId: 'stub-bass',
      presetParams: BASS_PRESET,
      render: async (p) => stubSynth(p),
      budget: 50,
      population: 8,
      seed: 99,
    })
  const a = await run()
  const b = await run()
  assert.deepEqual(a.afterParams, b.afterParams)
  assert.equal(a.after.loss.total, b.after.loss.total)
  assert.deepEqual(
    a.curve.map((p) => p.loss),
    b.curve.map((p) => p.loss),
  )
})

test('`unreachable` lists exactly the targets still missed, worst first — the ceiling read', async () => {
  const r = await runRetarget({
    role: 'bassline',
    presetId: 'stub-bass',
    presetParams: BASS_PRESET,
    render: async (p) => stubSynth(p),
    budget: 40,
    population: 8,
    seed: 2,
  })
  const missed = r.after.loss.axes.filter((a) => !a.satisfied).map((a) => a.key).sort()
  assert.deepEqual(r.unreachable.map((u) => u.key).sort(), missed)
  for (let i = 1; i < r.unreachable.length; i++) {
    assert.ok(r.unreachable[i - 1]!.miss >= r.unreachable[i]!.miss, 'unreachable targets must be worst-first')
  }
  for (const u of r.unreachable) assert.ok(u.miss > 0)
})

test('a budget below the floor fails loudly rather than searching nothing', async () => {
  await assert.rejects(
    () => runRetarget({ role: 'bassline', presetId: 'x', presetParams: {}, render: async (p) => stubSynth(p), budget: 5 }),
    /budget 5 is too small/,
  )
  await assert.rejects(
    () => runRetarget({ role: 'drum-loop', presetId: 'x', presetParams: {}, render: async (p) => stubSynth(p), budget: 40 }),
    /no retarget target profile for role "drum-loop"/,
  )
})
