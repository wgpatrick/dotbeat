// Phase 40 Stream VA — pitch-mapping a ONE sample across a scale (docs/phase-40-plan.md §VA).
//
// dotbeat has always been able to play a sample at a `tune` offset; what it could not do was say
// what pitch the sample IS, or work out the offsets that land it on a scale. This file owns the
// second half of that (the first is src/analysis/pitch.ts, which measures a root): the pure,
// audio-free arithmetic from a root pitch to a set of declared lanes.
//
// Deliberately zero audio here. Everything below is a function of MIDI numbers, so it is testable
// with no WAV, and — per the plan's "keymap-as-lanes is the v1, not the endgame" decision — the
// (rootMidi, targetMidi) primitives are the piece a future sampler-INSTRUMENT track (piano roll,
// any MIDI note, tune computed per note) reuses unchanged. Lanes are v1's vocabulary; the
// arithmetic is not lane-shaped, on purpose.

import type { BeatDocument, BeatDrumLaneDecl } from './document.js'
import { BeatEditError, addLane, setLaneSample } from './edit.js'
import { formatNumber } from './format.js'
import { SCALES, SCALE_NAMES } from './pitchtime.js'

const canon = (n: number): number => Number(formatNumber(n))

/** Mirrors the `-24..24` semitone clamp `edit.ts` enforces on a sample lane's `tune`. Duplicated
 * as a named constant only so keymap can REFUSE a span up front with a musical message ("A3..A7 is
 * reachable") instead of letting the 7th lane throw a bare per-lane error halfway through. edit.ts
 * remains the enforcer — this is a guard, not a second source of truth. */
export const LANE_TUNE_MIN = -24
export const LANE_TUNE_MAX = 24

// ---- Note names <-> MIDI -----------------------------------------------------------------------

// Sharp spellings use "s", not "#": a lane NAME must match edit.ts's LANE_NAME_RE
// (/^[a-zA-Z0-9_-]+$/), and "#" is not in it. So the canonical minted name is `cs6`, not `c#6`.
// Input parsing is liberal (accepts c#6/cs6/db6/C#6) and output is canonical — the same
// "liberal in, strict out" discipline the parser uses elsewhere.
const SEMITONE_NAMES = ['c', 'cs', 'd', 'ds', 'e', 'f', 'fs', 'g', 'gs', 'a', 'as', 'b'] as const
const LETTER_SEMITONES: Readonly<Record<string, number>> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
const NOTE_RE = /^([a-gA-G])([#sb]?)(-?\d+)$/

/** Scientific pitch notation -> MIDI (c4 = 60, a4 = 69, a6 = 93 — the recipe-song bell's root). */
export function noteToMidi(note: string): number {
  const m = NOTE_RE.exec(note.trim())
  if (!m) throw new BeatEditError(`"${note}" is not a note name — expected scientific pitch like a6, c#4, cs4, eb2 (c4 = middle C = MIDI 60)`)
  const [, letter, accidental, octave] = m
  const semitone = LETTER_SEMITONES[letter!.toLowerCase()]! + (accidental === '#' || accidental === 's' ? 1 : accidental === 'b' ? -1 : 0)
  const midi = 12 * (Number(octave) + 1) + semitone
  if (midi < 0 || midi > 127) throw new BeatEditError(`note "${note}" is MIDI ${midi}, outside the 0-127 range (c-1 .. g9)`)
  return midi
}

/** MIDI -> the canonical lane-legal name (`93` -> `a6`). Fractional input rounds to the nearest
 * semitone — callers that care about the leftover cents read them off the pitch detection. */
export function midiToNote(midi: number): string {
  const rounded = Math.round(midi)
  return `${SEMITONE_NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`
}

/** MIDI (fractional welcome) -> Hz, equal temperament, a4 = 440. */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** Hz -> MIDI (fractional — a sample that came back between notes is the normal case, not an
 * error; see the recipe-song bass's -6.5 tune). */
export function hzToMidi(hz: number): number {
  if (!(hz > 0)) throw new BeatEditError(`frequency must be positive, got ${hz}`)
  return 69 + 12 * Math.log2(hz / 440)
}

// ---- The arithmetic a future sampler track reuses -----------------------------------------------

/** THE keymap primitive: the `tune` (semitones) that makes a sample whose root is `rootMidi` sound
 * at `targetMidi`. Equal temperament, so it is just the interval — but stating it as a named
 * function of (rootMidi, targetMidi) is the point: it is what a sampler-instrument track would
 * call per NOTE, with no lane anywhere in sight (docs/phase-40-plan.md, keymap-as-lanes decision).
 * `rootMidi` is deliberately allowed to be fractional. */
export function tuneForPitch(rootMidi: number, targetMidi: number): number {
  return canon(targetMidi - rootMidi)
}

/** The same interval expressed as a playback-RATE multiplier — what an audio region's
 * `warp repitch` / `rate` pair wants (the recipe-song pad's hand-computed 0.9439 = one semitone
 * down). Speeding playback up raises pitch, so this is a plain 2^(semitones/12). */
export function rateForPitch(rootMidi: number, targetMidi: number): number {
  return canon(Math.pow(2, (targetMidi - rootMidi) / 12))
}

// ---- Keymap -------------------------------------------------------------------------------------

/** One lane the keymap will mint (or re-back): the note it sounds and the tune that gets it there. */
export interface KeymapLanePlan {
  name: string // canonical lane-legal note name, e.g. "a5"
  midi: number // the pitch this lane sounds
  tune: number // semitones, relative to the sample's root
}

export interface KeymapOptions {
  /** The SAMPLE's root — what it sounds like untuned. Fractional is normal (a generated one-shot
   * rarely lands on a semitone); it is what makes the tunes come out right anyway. */
  rootMidi: number
  /** The MUSICAL root the scale is built on. Kept separate from `rootMidi` on purpose: the
   * recipe-song's bell happens to be an A6 sample mapped over an A-minor scale, but the sample's
   * pitch and the song's key coinciding is a coincidence, not a rule. */
  scaleRootMidi: number
  scale: string // a name from pitchtime.ts's SCALES — the one scale vocabulary, not a second one
  fromMidi: number
  toMidi: number
}

/** The pitches of `scale` (rooted at `scaleRootMidi`'s pitch class) between `fromMidi` and
 * `toMidi` inclusive, and the tune each needs from a sample rooted at `rootMidi`. Pure — no
 * document, no audio, no I/O. */
export function planKeymap(opts: KeymapOptions): KeymapLanePlan[] {
  const scale = SCALES[opts.scale]
  if (!scale) throw new BeatEditError(`unknown scale "${opts.scale}" (have: ${SCALE_NAMES.join(', ')})`)
  if (opts.toMidi < opts.fromMidi) throw new BeatEditError(`--from ${midiToNote(opts.fromMidi)} is above --to ${midiToNote(opts.toMidi)} — the span must run low to high`)
  const rootPc = ((Math.round(opts.scaleRootMidi) % 12) + 12) % 12
  const plan: KeymapLanePlan[] = []
  for (let midi = Math.round(opts.fromMidi); midi <= Math.round(opts.toMidi); midi++) {
    if (!scale.includes((((midi - rootPc) % 12) + 12) % 12)) continue
    plan.push({ name: midiToNote(midi), midi, tune: tuneForPitch(opts.rootMidi, midi) })
  }
  if (plan.length === 0) {
    throw new BeatEditError(`no ${opts.scale} tones between ${midiToNote(opts.fromMidi)} and ${midiToNote(opts.toMidi)} — widen the span`)
  }
  // Refuse the whole span up front, naming what IS reachable, rather than minting lanes until one
  // trips edit.ts's per-lane clamp and leaves a half-built keymap behind.
  const unreachable = plan.filter((l) => l.tune < LANE_TUNE_MIN || l.tune > LANE_TUNE_MAX)
  if (unreachable.length > 0) {
    const lo = midiToNote(Math.ceil(opts.rootMidi + LANE_TUNE_MIN))
    const hi = midiToNote(Math.floor(opts.rootMidi + LANE_TUNE_MAX))
    throw new BeatEditError(
      `a lane's tune is limited to ${LANE_TUNE_MIN}..${LANE_TUNE_MAX} semitones, so from a root of ${midiToNote(opts.rootMidi)} ` +
      `only ${lo}..${hi} is reachable — ${unreachable.map((l) => `${l.name} needs ${formatNumber(l.tune)}`).join(', ')}. ` +
      `Narrow --from/--to into ${lo}..${hi}, or use a sample rooted closer to the span you want.`,
    )
  }
  return plan
}

export interface KeymapResult {
  doc: BeatDocument
  lanes: BeatDrumLaneDecl[]
  plan: KeymapLanePlan[]
  added: string[] // lane names that did not exist before
  rebacked: string[] // lane names that existed and were re-pointed at this sample
}

/** Mints one declared lane per scale degree, every one backed by `sampleId` at the tune that lands
 * it on that lane's note. An existing lane of the same name is RE-BACKED in place (setLaneSample's
 * "keeps its Start/Length/AHD shaping" semantics) rather than refused — re-running keymap with a
 * better root is a normal thing to want, and hits already on those lanes must survive it. */
export function buildKeymap(
  doc: BeatDocument,
  trackId: string,
  sampleId: string,
  opts: KeymapOptions & { gainDb?: number },
): KeymapResult {
  if (!doc.media.some((m) => m.id === sampleId)) {
    throw new BeatEditError(`no sample "${sampleId}" in the media block (have: ${doc.media.map((m) => m.id).join(', ') || 'none'}) — register it with beat sample first`)
  }
  const plan = planKeymap(opts)
  const gainDb = opts.gainDb ?? 0
  const track = doc.tracks.find((t) => t.id === trackId)
  const existing = new Set(track && track.kind === 'drums' ? track.lanes.map((l) => l.name) : [])
  const added: string[] = []
  const rebacked: string[] = []
  let next = doc
  for (const lane of plan) {
    if (existing.has(lane.name)) {
      next = setLaneSample(next, trackId, lane.name, { sample: sampleId, gainDb, tune: lane.tune })
      rebacked.push(lane.name)
    } else {
      next = addLane(next, trackId, lane.name, ['sample', sampleId, String(gainDb), String(lane.tune)]).doc
      added.push(lane.name)
    }
  }
  const after = next.tracks.find((t) => t.id === trackId)
  const names = new Set(plan.map((l) => l.name))
  const lanes = after && after.kind === 'drums' ? after.lanes.filter((l) => names.has(l.name)) : []
  return { doc: next, lanes, plan, added, rebacked }
}
