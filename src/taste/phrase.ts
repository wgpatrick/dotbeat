// The shared vocabulary every figure source speaks (R3 finding 1b / the single highest-leverage
// extraction in the taste-layer review).
//
// There are four figure sources — the archetype bank (in showdown.ts), theory.ts, ca2.ts and
// midifig.ts — and all four need the same handful of things: a key, a scale, degree->pitch, the
// ComposedNote/Phrase shapes the showdown's applyComposedPhrase consumes, one seeded shuffle, and
// one "first unexcluded label of a seeded shuffle" selector. Before this module they got them by
// importing showdown.ts, a 1557-line god-module that drags in node:fs, a private WAV codec and the
// whole reporting layer — for four type aliases and one pure function. Each of the four had also
// re-implemented the selector and (three of them) the shuffle, with comments explaining that each
// copy matched the others' contract, which is exactly the smell.
//
// This module is a near-leaf: core/rng.ts only. showdown.ts re-exports everything below, so every
// existing `from './showdown.js'` import — including cli/beat.mjs's dynamic imports — keeps working
// unchanged.

import { seededShuffle } from '../core/rng.js'

export { seededShuffle }

/** Genre-palette modes (research 124 §C.4): the base major/natural-minor pair plus Phrygian
 * (melodic techno / psytrance, featured b2) and Dorian (house / deep house). `minor` stays the
 * coarse tonality flag every existing caller sets; `mode`, when present, is the precise scale and
 * overrides `minor`. Absent `mode` keeps the historical major/natural-minor behavior byte-for-byte. */
export type ScaleMode = 'major' | 'natural-minor' | 'phrygian' | 'dorian'

export interface PhraseKey {
  /** midi root of the key, folded into 48..59 (the taste-seed generator's own range) */
  root: number
  minor: boolean
  /** optional precise mode; overrides `minor` when set (natural-minor/major mirror the flag) */
  mode?: ScaleMode
}

export const MAJOR_SCALE: readonly number[] = [0, 2, 4, 5, 7, 9, 11]
export const NATURAL_MINOR_SCALE: readonly number[] = [0, 2, 3, 5, 7, 8, 10]
export const PHRYGIAN_SCALE: readonly number[] = [0, 1, 3, 5, 7, 8, 10] // natural minor with a b2
export const DORIAN_SCALE: readonly number[] = [0, 2, 3, 5, 7, 9, 10] // natural minor with a natural 6

export function scalePitchClasses(key: PhraseKey): readonly number[] {
  switch (key.mode) {
    case 'phrygian':
      return PHRYGIAN_SCALE
    case 'dorian':
      return DORIAN_SCALE
    case 'major':
      return MAJOR_SCALE
    case 'natural-minor':
      return NATURAL_MINOR_SCALE
    default:
      return key.minor ? NATURAL_MINOR_SCALE : MAJOR_SCALE
  }
}

/** `degree` is any integer scale degree (0 = the key root; ±7 wraps an octave). Every figure source
 * resolves scale degrees through this one function, which is why a figure is diatonic in the seed's
 * key no matter which source composed it. */
export const degreePitch = (key: PhraseKey, degree: number, octaveShift: number): number => {
  const scale = scalePitchClasses(key)
  const idx = ((degree % 7) + 7) % 7
  const oct = Math.floor(degree / 7)
  return Math.min(127, Math.max(0, key.root + octaveShift + oct * 12 + scale[idx]!))
}

export interface ComposedNote {
  pitch: number
  start: number
  duration: number
  velocity: number
}

export interface ComposedPhrase {
  /** the figure's LABEL — both the manifest record and the token in the CLI's shared per-role
   * exclude chain. Namespaced per source (bare bank name / 'theory:' / 'ca2:' / 'midi:'); the four
   * namespaces MUST stay disjoint, which test/figure-labels.test.ts is what enforces. */
  archetype: string
  notes: ComposedNote[]
}

export type ComposedDrumLane = 'kick' | 'snare' | 'hat'

export interface ComposedDrumHit {
  lane: ComposedDrumLane
  start: number
  velocity: number
}

export interface ComposedDrumPhrase {
  archetype: string
  hits: ComposedDrumHit[]
}

/** The one seeded selector all four figure sources use: the first item of a seeded Fisher-Yates
 * shuffle whose LABEL isn't already in `exclude`; if every label is used, the shuffle's first item
 * anyway (a 7th batch in a session may repeat a figure — never a realization, since the rest of the
 * rng stream still differs).
 *
 * `labelOf` is the source's own namespacing (identity for the bank, `theory:`/`ca2:`/`midi:` for the
 * others) and is the ONLY thing that differs between the four call sites. It exists because the CLI
 * threads ONE exclude list per role through every source, so the labels must never collide across
 * namespaces — see the header of test/figure-labels.test.ts before changing this signature.
 *
 * Consumes exactly `items.length - 1` rng draws (Fisher-Yates), so a caller's subsequent draws are
 * a pure function of the bank size. Replacing the four copies with this call is byte-for-byte
 * behavior-preserving: each copy was this, inlined. */
export function chooseSeeded<T>(
  rng: () => number,
  items: readonly T[],
  labelOf: (item: T) => string,
  exclude: readonly string[],
): T {
  const shuffled = seededShuffle(rng, items)
  return shuffled.find((item) => !exclude.includes(labelOf(item))) ?? shuffled[0]!
}
