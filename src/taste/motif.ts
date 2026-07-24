// Motif-variation operator library (research 124 §C.7, piece 3): pure functions over note arrays.
// These are the "melody is motif ALGEBRA, not a note stream" operators (§C.3) — the lead generator
// derives a phrase from one motif by applying them, and they double as `vary`-style edits on any
// existing material (the fallback co-writer if no Part A model is adopted). Every function is pure
// and deterministic: same input (and seed, where one is taken), same output. Notes are the plain
// ComposedNote shape the rest of the composition layer uses.

import { mulberry32 } from './eval.js'
import type { ComposedNote } from './showdown.js'

const rnd2 = (x: number): number => Math.round(x * 100) / 100
const clone = (n: ComposedNote): ComposedNote => ({ ...n })

// ---- Euclidean onset patterns E(k,n) (§C.5, Toussaint) ----------------------------------------

/** E(k,n): `k` onsets distributed as evenly as possible over `n` slots (Bresenham form — the same
 * maximally-even distribution as Bjorklund for the timeline patterns §C.5 cites). Returns a boolean
 * per slot; `rotate` cyclically rotates the pattern so a downbeat onset can be guaranteed. */
export function euclid(k: number, n: number, rotate = 0): boolean[] {
  if (n <= 0) return []
  const onsets = Math.max(0, Math.min(Math.round(k), n))
  const pattern: boolean[] = []
  let bucket = 0
  for (let i = 0; i < n; i++) {
    bucket += onsets
    if (bucket >= n) {
      bucket -= n
      pattern.push(true)
    } else {
      pattern.push(false)
    }
  }
  if (rotate === 0) return pattern
  const r = ((rotate % n) + n) % n
  return pattern.slice(n - r).concat(pattern.slice(0, n - r))
}

/** The onset slot indices of E(k,n) — the convenience form for placing bass/percussion hits. */
export function euclidSteps(k: number, n: number, rotate = 0): number[] {
  const pattern = euclid(k, n, rotate)
  const steps: number[] = []
  for (let i = 0; i < pattern.length; i++) if (pattern[i]) steps.push(i)
  return steps
}

// ---- pitch operators ---------------------------------------------------------------------------

/** Shift every note by a fixed number of semitones (pitches only; rhythm untouched). */
export function transposeBySemitones(notes: readonly ComposedNote[], semitones: number): ComposedNote[] {
  return notes.map((n) => ({ ...clone(n), pitch: n.pitch + semitones }))
}

/** transpose-to-next-chord (§C.7): move the motif so it sits on the next chord, by shifting every
 * pitch by the interval between the two chord roots. A same-quality chord change keeps chord tones
 * as chord tones; the rhythm is preserved exactly. */
export function transposeToNextChord(notes: readonly ComposedNote[], fromRootPitch: number, toRootPitch: number): ComposedNote[] {
  return transposeBySemitones(notes, toRootPitch - fromRootPitch)
}

/** contour-inversion (§C.3): mirror every pitch around `axis` (default = the first note's pitch), so
 * the melodic contour flips up-for-down. Rhythm is preserved — the basis of the call-and-response
 * answer that inverts the call's shape. */
export function contourInversion(notes: readonly ComposedNote[], axis?: number): ComposedNote[] {
  if (notes.length === 0) return []
  const a = axis ?? notes[0]!.pitch
  return notes.map((n) => ({ ...clone(n), pitch: 2 * a - n.pitch }))
}

/** same-rhythm-new-pitches (§C.3 repetition type 2): keep every start/duration/velocity, swap in
 * `newPitches` in order (the musical choice of WHICH pitches lives with the caller — this operator
 * just zips rhythm to new pitch content). Extra notes beyond `newPitches` keep their pitch. */
export function sameRhythmNewPitches(notes: readonly ComposedNote[], newPitches: readonly number[]): ComposedNote[] {
  return notes.map((n, i) => ({ ...clone(n), pitch: i < newPitches.length ? newPitches[i]! : n.pitch }))
}

// ---- rhythm operators --------------------------------------------------------------------------

/** rhythmic-displacement (§C.3, Sweetwater): shift the whole pattern by `shiftSteps` (an 8th = 2,
 * a 16th = 1) with pitches unchanged, wrapping within a `loopLen`-step phrase so it stays in the
 * clip. Fractional shifts are allowed (they ride the same fractional-start grid swing uses). */
export function rhythmicDisplacement(notes: readonly ComposedNote[], shiftSteps: number, loopLen: number): ComposedNote[] {
  if (loopLen <= 0) return notes.map(clone)
  return notes
    .map((n) => {
      let start = (n.start + shiftSteps) % loopLen
      if (start < 0) start += loopLen
      return { ...clone(n), start: rnd2(start) }
    })
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}

// ---- variation scheduling ----------------------------------------------------------------------

/** A pure note->note transform, the unit `oneChangePerRepeat` schedules. */
export type MotifOperator = (notes: readonly ComposedNote[]) => ComposedNote[]

/** one-change-per-repeat scheduling (§C.3/§C.7): from `base`, emit `repeats` further variations, each
 * differing from the PREVIOUS one by exactly one operator application drawn (seeded) from `ops` — the
 * "successful tracks change one element every 8-16 bars while holding the core" rule as a generator.
 * Returns [base, v1, v2, …] of length repeats+1. Deterministic in `seed`. */
export function oneChangePerRepeat(base: readonly ComposedNote[], repeats: number, ops: readonly MotifOperator[], seed: number): ComposedNote[][] {
  const rng = mulberry32(seed + 2027)
  const out: ComposedNote[][] = [base.map(clone)]
  let cur: ComposedNote[] = base.map(clone)
  for (let i = 0; i < repeats; i++) {
    if (ops.length === 0) {
      out.push(cur.map(clone))
      continue
    }
    const op = ops[Math.floor(rng() * ops.length)]!
    cur = op(cur)
    out.push(cur.map(clone))
  }
  return out
}
