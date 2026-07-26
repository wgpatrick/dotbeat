// src/core/rng.ts is the single seeded generator behind every reproducible thing in the taste
// layer: figure composition, archetype/ask/patch/midi selection, prompt-bank draws, the blind clip
// assignment, and the ranker's bootstrap ensemble. Until this file existed, mulberry32 was copied
// verbatim into three modules (eval.ts, ranker.ts, vary/audition.ts) — byte-identical, so nothing
// was broken, but the blinding shuffle and the figure draws had no shared definition and no test
// asserting they were the same generator.
//
// The exact output sequence is a CONTRACT: every rated batch's figures, prompts and clip order are
// reproducible only as long as a given seed yields these exact numbers. The goldens below are
// therefore not a snapshot of an implementation detail — a failure here means historical batch
// provenance just became irreproducible.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mulberry32, seededShuffle } from '../src/core/rng.js'
import { mulberry32 as evalMulberry32 } from '../src/taste/eval.js'
import { shuffledOrder } from '../src/vary/audition.js'
import { assignClipOrder } from '../src/taste/showdown.js'

const take = (rng: () => number, n: number): number[] => Array.from({ length: n }, () => rng())

test('mulberry32: GOLDEN sequences — the seed -> stream contract every rated batch depends on', () => {
  assert.deepEqual(take(mulberry32(0), 5), [
    0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111, 0.46732782293111086,
  ])
  assert.deepEqual(take(mulberry32(1), 5), [
    0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849,
  ])
  assert.deepEqual(take(mulberry32(41), 5), [
    0.8510142471641302, 0.5088475255761296, 0.6344115899410099, 0.5411878905724734, 0.8519706330262125,
  ])
  assert.deepEqual(take(mulberry32(12345), 5), [
    0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203, 0.5094283693470061,
  ])
  assert.deepEqual(take(mulberry32(2 ** 31), 5), [
    0.8205775609239936, 0.4481089550536126, 0.7836112855002284, 0.5120457962621003, 0.8388098266441375,
  ])
})

test('mulberry32: same seed -> same stream, different seeds -> different streams, always in [0,1)', () => {
  for (const seed of [0, 1, 41, 12345, 2 ** 31, -7, 1.5]) {
    assert.deepEqual(take(mulberry32(seed), 20), take(mulberry32(seed), 20), `seed ${seed} is reproducible`)
    for (const v of take(mulberry32(seed), 500)) assert.ok(v >= 0 && v < 1, `${v} out of range for seed ${seed}`)
  }
  assert.notDeepEqual(take(mulberry32(41), 20), take(mulberry32(42), 20))
  // the seed is coerced with >>> 0, so these alias deliberately — worth pinning so nobody "fixes" it
  assert.deepEqual(take(mulberry32(-1), 5), take(mulberry32(2 ** 32 - 1), 5))
  assert.deepEqual(take(mulberry32(1.5), 5), take(mulberry32(1), 5))
})

test('every re-export is the SAME generator (the consolidation is provably behavior-preserving)', () => {
  // eval.ts is the import path a dozen taste modules already use; it must stay identical to core's.
  for (const seed of [0, 1, 41, 12345, 2 ** 31]) {
    assert.deepEqual(take(evalMulberry32(seed), 25), take(mulberry32(seed), 25), `eval.ts alias matches at seed ${seed}`)
  }
  // audition.ts's shuffledOrder — the FIRST blinding layer, previously seeded by its own private
  // copy — is exactly a Fisher-Yates over the shared generator. This is the assertion that used to
  // be missing: "the blinding shuffle's RNG" and "the figure RNG" are now one definition.
  for (const seed of [0, 3, 41, 999]) {
    for (const count of [2, 5, 8, 13]) {
      const reference = seededShuffle(mulberry32(seed), Array.from({ length: count }, (_, i) => i + 1))
      assert.deepEqual(shuffledOrder(count, seed), reference, `shuffledOrder(${count}, ${seed})`)
    }
  }
  // ranker.ts's copy seeded every bootstrap ensemble; it has no exported RNG surface of its own, so
  // its equality is pinned through trainBTEnsemble's existing determinism test in taste.test.ts.
  assert.deepEqual(shuffledOrder(8, 41), [1, 5, 2, 6, 3, 8, 4, 7], 'golden blind order')
})

test('seededShuffle: a uniform permutation consuming exactly n-1 draws', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f']
  // permutation-ness and determinism
  for (const seed of [0, 1, 41, 12345]) {
    const out = seededShuffle(mulberry32(seed), items)
    assert.deepEqual([...out].sort(), [...items].sort(), 'every element survives exactly once')
    assert.deepEqual(out, seededShuffle(mulberry32(seed), items), 'deterministic in the seed')
  }
  assert.notDeepEqual(seededShuffle(mulberry32(41), items), seededShuffle(mulberry32(42), items))
  // the input is never mutated
  const frozen = [...items]
  seededShuffle(mulberry32(3), items)
  assert.deepEqual(items, frozen)
  // edge cases
  assert.deepEqual(seededShuffle(mulberry32(3), []), [])
  assert.deepEqual(seededShuffle(mulberry32(3), ['only']), ['only'])

  // EXACTLY n-1 draws, independent of the data — this is the property `sort(() => rng() - 0.5)`
  // lacks, and why that idiom silently shifts every draw made after it.
  for (const n of [1, 2, 5, 17]) {
    let draws = 0
    const counted = (): number => {
      draws += 1
      return 0.5
    }
    seededShuffle(counted, Array.from({ length: n }, (_, i) => i))
    assert.equal(draws, Math.max(0, n - 1), `${n} items consume ${n - 1} draws`)
  }

  // uniformity: over many seeds every element reaches every position (a biased comparator-sort
  // leaves elements clustered near their input index)
  const counts = items.map(() => items.map(() => 0))
  for (let seed = 0; seed < 3000; seed++) {
    seededShuffle(mulberry32(seed), items).forEach((v, pos) => {
      const row = counts[items.indexOf(v)]!
      row[pos] = row[pos]! + 1
    })
  }
  const expected = 3000 / items.length
  for (const row of counts) for (const c of row) {
    assert.ok(Math.abs(c - expected) < expected * 0.25, `position histogram ${c} vs ~${expected} — shuffle looks biased`)
  }
})

test('assignClipOrder: the *7+3 seed derivation is APPLIED, not just a permutation (I3)', () => {
  // assignClipOrder(n, s) is shuffledOrder(n, s*7+3).map(n => n-1). The derivation exists precisely
  // so that the rate UI re-shuffling with the SAME batch seed never composes back to identity
  // systematically. Deleting `*7+3` during a refactor keeps every other assertion passing —
  // determinism, permutation-ness, and "a different seed gives a different order" all still hold.
  for (const seed of [1, 3, 41, 99, 12345]) {
    for (const count of [3, 5, 8]) {
      assert.deepEqual(
        assignClipOrder(count, seed),
        shuffledOrder(count, seed * 7 + 3).map((n) => n - 1),
        `assignClipOrder(${count}, ${seed}) derives its seed`,
      )
    }
    // ...and the derivation is observable: at a realistic batch size the derived order differs from
    // the underived one. (Kept off count 3, where only 6 permutations exist and a coincidence is
    // ordinary rather than evidence.)
    for (const count of [5, 8]) {
      assert.notDeepEqual(
        assignClipOrder(count, seed),
        shuffledOrder(count, seed).map((n) => n - 1),
        `assignClipOrder(${count}, ${seed}) must NOT be the underived shuffle`,
      )
    }
  }
  assert.deepEqual(assignClipOrder(6, 41), [1, 5, 0, 3, 4, 2], 'golden clip assignment')
})
