// The ONE seeded random generator for everything whose output has to be reproducible from a seed:
// figure composition, archetype/ask/patch/midi selection, prompt-bank draws, the blind clip
// assignment, and the ranker's bootstrap ensemble.
//
// Why this module exists (R3 finding 4): mulberry32 had been copied verbatim into src/taste/eval.ts,
// src/taste/ranker.ts and src/vary/audition.ts. The three closures were byte-identical, so nothing
// was broken — but note WHERE they sat. ranker.ts's copy seeds every bootstrap ensemble, i.e. the
// critic's uncertainty estimates and therefore the pessimistic scores; audition.ts's copy seeds
// `shuffledOrder`, which `assignClipOrder` calls, i.e. the FIRST blinding layer. So the blinding
// shuffle and the figure draws used different source copies of the same generator, with no shared
// definition and no test asserting they agreed. Now there is one definition and test/rng.test.ts
// pins its exact output sequences.
//
// This module is a LEAF on purpose: it imports nothing. That is what dissolves the stated reason for
// ranker.ts's private copy ("eval.ts imports ranker.ts, so importing back would cycle").
//
// Not folded in here: `src/core/chance.ts`'s same-named helper has a different signature (one number
// from a hashed seed, not a stream), and `src/core/humanize.ts` / `src/vary/vary.ts` carry a
// `makeRng` variant with a redundant `a |= 0` line. Those are a separate sweep; nothing about the
// eval layer's reproducibility depends on them.

/** mulberry32 — a 32-bit seeded PRNG returning a stream of floats in [0, 1).
 *
 * The exact arithmetic is a contract, not an implementation detail: every rated batch's figures,
 * prompt draws and clip order are reproducible only as long as a given seed yields this exact
 * sequence. test/rng.test.ts pins golden values for several seeds. Do not "improve" it. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates over a copy of `arr`, drawing from `rng` — a UNIFORM permutation consuming exactly
 * `arr.length - 1` draws, so the rng stream position afterwards is a pure function of the input
 * length. Both properties matter and neither is offered by the `sort(() => rng() - 0.5)` idiom this
 * replaces: a random comparator biases toward the input order, its result depends on V8's sort
 * implementation (TimSort's insertion-sort path for short arrays), and it consumes a data-dependent
 * number of draws, which silently shifts every downstream draw. */
export function seededShuffle<T>(rng: () => number, arr: readonly T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}
