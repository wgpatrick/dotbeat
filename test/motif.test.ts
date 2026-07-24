// Motif-variation operator library (research 124 §C.7 piece 3, src/taste/motif.ts): unit tests for
// each pure operator with fixed seeds. These are the melody-as-algebra operators the lead generator
// derives phrases with and that double as vary-style edits on existing material.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  euclid,
  euclidSteps,
  transposeBySemitones,
  transposeToNextChord,
  contourInversion,
  sameRhythmNewPitches,
  rhythmicDisplacement,
  oneChangePerRepeat,
} from '../src/taste/motif.js'

type N = { pitch: number; start: number; duration: number; velocity: number }
const notes = (...xs: [number, number, number, number][]): N[] => xs.map(([pitch, start, duration, velocity]) => ({ pitch, start, duration, velocity }))

// ---- Euclidean onsets (§C.5) -------------------------------------------------------------------

test('euclid E(k,n): k evenly-distributed onsets over n slots', () => {
  const e38 = euclid(3, 8)
  assert.equal(e38.length, 8)
  assert.equal(e38.filter(Boolean).length, 3)
  assert.equal(euclidSteps(3, 8).length, 3)
  // full and empty extremes
  assert.deepEqual(euclid(4, 4), [true, true, true, true])
  assert.deepEqual(euclid(0, 4), [false, false, false, false])
  // clamps k to n
  assert.equal(euclid(9, 8).filter(Boolean).length, 8)
})

test('euclid rotate cyclically shifts the pattern (guarantees a downbeat onset)', () => {
  const base = euclid(3, 8)
  const rot = euclid(3, 8, 1)
  assert.equal(rot.length, 8)
  assert.equal(rot.filter(Boolean).length, 3)
  // rotation is a pure cyclic shift, so the multiset of onset gaps is preserved
  assert.notDeepEqual(base, rot)
})

// ---- pitch operators ---------------------------------------------------------------------------

test('transposeBySemitones shifts pitch only, rhythm untouched', () => {
  const m = notes([60, 0, 2, 0.5], [64, 2, 2, 0.5])
  const up = transposeBySemitones(m, 5)
  assert.deepEqual(up.map((n) => n.pitch), [65, 69])
  assert.deepEqual(up.map((n) => [n.start, n.duration]), [[0, 2], [2, 2]])
})

test('transposeToNextChord shifts by the interval between chord roots', () => {
  const m = notes([60, 0, 2, 0.5], [63, 2, 2, 0.5])
  const moved = transposeToNextChord(m, 60, 65) // root C -> F, +5
  assert.deepEqual(moved.map((n) => n.pitch), [65, 68])
})

test('contourInversion mirrors pitch around the axis; applying it twice is identity', () => {
  const m = notes([60, 0, 1, 0.5], [64, 1, 1, 0.5], [67, 2, 1, 0.5])
  const inv = contourInversion(m) // axis defaults to the first pitch (60)
  assert.deepEqual(inv.map((n) => n.pitch), [60, 56, 53])
  const back = contourInversion(inv, 60)
  assert.deepEqual(back.map((n) => n.pitch), [60, 64, 67])
  // explicit axis
  assert.deepEqual(contourInversion(m, 62).map((n) => n.pitch), [64, 60, 57])
})

test('sameRhythmNewPitches keeps every start/duration, swaps in the new pitch content', () => {
  const m = notes([60, 0, 2, 0.4], [64, 2, 2, 0.6])
  const out = sameRhythmNewPitches(m, [67, 71])
  assert.deepEqual(out.map((n) => n.pitch), [67, 71])
  assert.deepEqual(out.map((n) => [n.start, n.duration, n.velocity]), [[0, 2, 0.4], [2, 2, 0.6]])
  // extra notes beyond newPitches keep their pitch
  assert.deepEqual(sameRhythmNewPitches(m, [67]).map((n) => n.pitch), [67, 64])
})

// ---- rhythm operators --------------------------------------------------------------------------

test('rhythmicDisplacement shifts starts (wrapping in the phrase), pitches unchanged', () => {
  const m = notes([60, 0, 1, 0.5], [64, 8, 1, 0.5], [67, 15, 1, 0.5])
  const shifted = rhythmicDisplacement(m, 2, 16) // shift by an 8th
  assert.deepEqual(shifted.map((n) => n.pitch).sort(), [60, 64, 67])
  const byStart = new Map(shifted.map((n) => [n.pitch, n.start]))
  assert.equal(byStart.get(60), 2)
  assert.equal(byStart.get(64), 10)
  assert.equal(byStart.get(67), 1) // 15 + 2 = 17 wraps to 1
})

// ---- variation scheduling ----------------------------------------------------------------------

test('oneChangePerRepeat: repeats+1 variations, each one operator applied to the previous, deterministic', () => {
  const base = notes([60, 0, 1, 0.5], [64, 4, 1, 0.5])
  const ops = [
    (ns: readonly N[]) => transposeBySemitones(ns, 2),
    (ns: readonly N[]) => rhythmicDisplacement(ns, 1, 16),
  ]
  const chain = oneChangePerRepeat(base, 3, ops, 7)
  assert.equal(chain.length, 4) // base + 3 variations
  assert.deepEqual(chain[0], base) // base preserved
  // deterministic in the seed
  const again = oneChangePerRepeat(base, 3, ops, 7)
  assert.deepEqual(chain, again)
  // some other seed yields a different operator schedule (search a few — two seeds can collide)
  const differs = [8, 9, 10, 11, 12].some((s) => JSON.stringify(oneChangePerRepeat(base, 3, ops, s)) !== JSON.stringify(chain))
  assert.ok(differs, 'the operator schedule varies with the seed')
  // each variation differs from the previous by exactly one op — i.e. it is reachable by one op
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1]!
    const cur = chain[i]!
    const matchesSome = ops.some((op) => JSON.stringify(op(prev)) === JSON.stringify(cur))
    assert.ok(matchesSome, `variation ${i} is one operator away from the previous`)
  }
})

test('empty ops list leaves oneChangePerRepeat variations equal to the base', () => {
  const base = notes([60, 0, 1, 0.5])
  const chain = oneChangePerRepeat(base, 2, [], 1)
  assert.equal(chain.length, 3)
  for (const v of chain) assert.deepEqual(v, base)
})
