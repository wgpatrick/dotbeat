// The deterministic, theory-aware composition layer (research 124 §C.7, "the `beat compose`
// shape"). Where the archetype bank in showdown.ts draws figures with per-note UNIFORM randomness
// inside each archetype, this module replaces those draws with the CRAFT rules research 124 Part C
// found the commercial "theory-aware assistant" category (Ableton 12 generators, Logic Session
// Players, Scaler, Captain Chords) actually ships — no ML, just conditional structure the uniform
// draw cannot express:
//
//   * a CHORD TRACK source of truth (the Logic lesson): one weighted, function-tagged progression
//     object at 1-2 bars per chord, with position-conditional cadence substitution and an optional
//     techno parallel-planing mode, that every downstream generator consumes (§C.1);
//   * theory-aware BASS / CHORD / LEAD generators built on that track — kick-relationship bass
//     recipes over 1-3 pitch classes with the register rule enforced (§C.2), minimal-motion
//     voice-leading for chords (§C.4), motif-first leads with a single peak note (§C.3);
//   * a MOTIF-VARIATION operator library (src/taste/motif.ts) the lead generator derives phrases
//     with, also usable as vary-style edits on existing material (§C.7 piece 3).
//
// Everything is deterministic in the caller's seed via the existing mulberry32 plumbing, and every
// pitched generator returns the SAME ComposedPhrase shape showdown.applyComposedPhrase already
// consumes — so `theory` slots in as a new figure source alongside the archetype bank ('bank') and
// commercial MIDI ('midi') with no change to the render/rate pipeline. Sourced numbers (the Myloops
// trance envelope, the Stussy tech-house pattern, the swing 56-58% window) are single-author craft
// recipes per Part C's own confidence flags — tunable defaults, not measured consensus.

import { scalePitchClasses, degreePitch, chooseSeeded, type PhraseKey, type ScaleMode, type ComposedNote, type ComposedPhrase } from './phrase.js'
import { mulberry32 } from './eval.js'
import { contourInversion, transposeToNextChord, rhythmicDisplacement, oneChangePerRepeat, euclidSteps, type MotifOperator } from './motif.js'

const rnd2 = (x: number): number => Math.round(x * 100) / 100
const clampVel = (v: number): number => rnd2(Math.min(0.95, Math.max(0.05, v)))

// ---- chord track: the harmonic source of truth (§C.1) -----------------------------------------

/** A progression's arrangement FUNCTION (research 124 §C.1) — where in a track it belongs. The
 * uniform bank draw has no such tag; a real producer picks the breakdown bed and the pre-drop rise
 * for different reasons. */
export type ChordFunction = 'workhorse' | 'breakdown-bed' | 'pre-drop-rise' | 'pads-loop'

export interface ProgressionBankEntry {
  name: string
  /** coarse tonality — selects the minor vs major slice of the bank; the chord track's precise
   * `mode` (Phrygian/Dorian) still colours the tones */
  minor: boolean
  /** chord roots as scale degrees (0 = tonic, diatonic in the key's mode) */
  degrees: number[]
  /** relative frequency within its tonality slice — the "which progressions are ACTUALLY common"
   * fix (§C.1: i-VI-III-VII is "the genre default", the others rarer) */
  weight: number
  fn: ChordFunction
}

/** The weighted, function-tagged progression bank (research 124 §C.1). Minor is the genre
 * workhorse tonality; the three named trance progressions (i-VI-III-VII the default, i-VII-VI-VII
 * the never-resolving pads loop, VI-VII-i the pre-drop rise) carry the weights and tags the doc
 * calls out, plus a couple of common companions. A small major slice keeps major-key seeds served. */
export const PROGRESSION_BANK: readonly ProgressionBankEntry[] = [
  // minor (i=0, ii=1, III=2, iv=3, v=4, VI=5, VII=6)
  { name: 'i-VI-III-VII', minor: true, degrees: [0, 5, 2, 6], weight: 6, fn: 'workhorse' },
  { name: 'i-VII-VI-VII', minor: true, degrees: [0, 6, 5, 6], weight: 3, fn: 'pads-loop' },
  { name: 'VI-VII-i', minor: true, degrees: [5, 6, 0], weight: 3, fn: 'pre-drop-rise' },
  { name: 'i-iv-VI-v', minor: true, degrees: [0, 3, 5, 4], weight: 2, fn: 'breakdown-bed' },
  { name: 'VI-III-VII-i', minor: true, degrees: [5, 2, 6, 0], weight: 2, fn: 'workhorse' },
  { name: 'i-VI-VII-v', minor: true, degrees: [0, 5, 6, 4], weight: 2, fn: 'breakdown-bed' },
  // major (I=0, ii=1, iii=2, IV=3, V=4, vi=5, vii=6)
  { name: 'I-V-vi-IV', minor: false, degrees: [0, 4, 5, 3], weight: 4, fn: 'workhorse' },
  { name: 'vi-IV-I-V', minor: false, degrees: [5, 3, 0, 4], weight: 3, fn: 'workhorse' },
  { name: 'I-IV-V-IV', minor: false, degrees: [0, 3, 4, 3], weight: 2, fn: 'pads-loop' },
]

/** One resolved chord of a chord track: its bar span and its tone content as semitone offsets
 * above the key root. `rootDegree` is the scale degree when the chord is diatonic, or null in
 * planing mode (parallel-planed stabs deliberately ignore diatonic membership). */
export interface ChordTrackChord {
  startBar: number
  bars: number
  /** scale degree of the root (diatonic chords), or null when parallel-planed */
  rootDegree: number | null
  /** root as semitones above the key root (may be non-diatonic in planing mode) */
  rootOffset: number
  /** chord tones as semitones above the key root, root-first: [root, third, fifth, (seventh)] —
   * already carrying any cadential leading-tone alteration or planed voicing */
  tones: number[]
  /** true when a harmonic-minor V leading tone was substituted in at a phrase-final position */
  cadential: boolean
  /** true when this chord is a parallel-planed stab rather than a diatonic chord */
  planed: boolean
}

export interface ChordTrack {
  key: PhraseKey
  /** total bars the track spans (4 for a showdown clip) */
  bars: number
  progressionName: string
  fn: ChordFunction
  /** harmonic rhythm: bars each chord is held (1 or 2 — never a fixed always-one-per-bar) */
  barsPerChord: number
  planing: boolean
  chords: ChordTrackChord[]
}

/** The m7 stab shape techno parallel-planing transposes as a fixed unit (§C.1, Attack Magazine):
 * a minor-7th voicing [root, b3, 5, b7] in semitones, moved by fixed chromatic offsets ignoring
 * diatonic membership. */
const PLANING_SHAPE: readonly number[] = [0, 3, 7, 10]
/** The fixed transposition offsets a planed stab cycles through (§C.1: "-2/+3/-5 semitones"). */
const PLANING_OFFSETS: readonly number[] = [0, -2, 3, -5]

const weightedPick = (rng: () => number, entries: readonly ProgressionBankEntry[]): ProgressionBankEntry => {
  const total = entries.reduce((s, e) => s + e.weight, 0)
  let r = rng() * total
  for (const e of entries) {
    r -= e.weight
    if (r <= 0) return e
  }
  return entries[entries.length - 1]!
}

/** Resolve a diatonic triad (or seventh) rooted on scale degree `d` to semitone offsets above the
 * key root, stacking thirds within the mode's scale. */
function diatonicTones(key: PhraseKey, d: number, seventh: boolean): number[] {
  const scale = scalePitchClasses(key)
  const deg = (n: number): number => {
    const idx = ((n % 7) + 7) % 7
    const oct = Math.floor(n / 7)
    return oct * 12 + scale[idx]!
  }
  const tones = [deg(d), deg(d + 2), deg(d + 4)]
  if (seventh) tones.push(deg(d + 6))
  return tones
}

/** The minor-key mode palette (§C.4, "mode as a one-parameter genre colorizer"), as a weighted
 * draw: natural minor is the genre workhorse, Phrygian is the melodic-techno/psytrance colour (the
 * b2 as featured neighbour tone) and Dorian the house/deep-house one. Weighted, not uniform —
 * natural minor stays the default sound; the other two are the "same progression, different colour"
 * axis that keeps a round of figures from all sharing one palette (owner ear-report 2026-07-26). */
const MINOR_MODE_WEIGHTS: readonly { mode: ScaleMode; weight: number }[] = [
  { mode: 'natural-minor', weight: 7 },
  { mode: 'phrygian', weight: 2 },
  { mode: 'dorian', weight: 2 },
]

const pickWeightedMode = (rng: () => number): ScaleMode => {
  const total = MINOR_MODE_WEIGHTS.reduce((s, e) => s + e.weight, 0)
  let r = rng() * total
  for (const e of MINOR_MODE_WEIGHTS) {
    r -= e.weight
    if (r <= 0) return e.mode
  }
  return 'natural-minor'
}

export interface ChordTrackOptions {
  /** total bars (default 4 — a showdown clip) */
  bars?: number
  /** force the mode; default is a seeded weighted draw over the minor palette (natural minor /
   * Phrygian / Dorian) for minor keys, and 'major' for major ones */
  mode?: ScaleMode
  /** force parallel-planing on/off; default is a seeded ~15% chance for minor keys */
  planing?: boolean
  /** force the harmonic rhythm (1 or 2); default is a seeded weighted pick favouring held chords */
  barsPerChord?: number
  /** add sevenths to every diatonic chord's tone content (m7 colour); default false */
  sevenths?: boolean
  /** enable position-conditional harmonic-minor V cadence substitution at the phrase end (default
   * true for NATURAL-minor keys only — the borrowed V is the natural-minor/trance move; Phrygian
   * cadences on its bII and Dorian on its natural-6 IV, so forcing a raised leading tone into
   * either mode just sprays out-of-scale tones the lint would rightly flag) */
  cadence?: boolean
}

/** Build the chord-track source of truth, deterministic in `seed`. Picks a weighted, function-tagged
 * progression, a 1-2-bar harmonic rhythm, and (for minor keys) either a parallel-planed stab track
 * or a diatonic track with a phrase-final harmonic-minor V cadence substitution. Every downstream
 * generator consumes THIS one object (the Logic Session Players lesson, §C.1). */
export function buildChordTrack(key: PhraseKey, seed: number, opts: ChordTrackOptions = {}): ChordTrack {
  const rng = mulberry32(seed + 971)
  const bars = opts.bars ?? 4
  const slice = PROGRESSION_BANK.filter((e) => e.minor === key.minor)
  const entry = weightedPick(rng, slice.length > 0 ? slice : PROGRESSION_BANK)
  const mode: ScaleMode = opts.mode ?? (key.minor ? pickWeightedMode(rng) : 'major')
  const trackKey: PhraseKey = { ...key, mode }
  // harmonic rhythm: 1, 2 or (rarely) 4 bars per chord — never a hardcoded always-one-per-bar
  // (§C.1). Held (2-bar) chords are the trance-breakdown norm, so weight toward them; the whole-
  // clip hold is the techno one-chord vamp, kept rare so it colours a round rather than defining it.
  const barsPerChord = opts.barsPerChord ?? ((): number => {
    const r = rng()
    return r < 0.4 ? 1 : r < 0.9 ? 2 : bars
  })()
  const planing = opts.planing ?? (key.minor && rng() < 0.15)
  const sevenths = opts.sevenths ?? false
  const cadence = opts.cadence ?? (key.minor && mode === 'natural-minor')

  // lay chords sequentially across the bar span, cycling the progression to fill
  const chords: ChordTrackChord[] = []
  let bar = 0
  let ci = 0
  while (bar < bars) {
    const span = Math.min(barsPerChord, bars - bar)
    if (planing) {
      const off = PLANING_OFFSETS[ci % PLANING_OFFSETS.length]!
      chords.push({
        startBar: bar,
        bars: span,
        rootDegree: null,
        rootOffset: off,
        tones: PLANING_SHAPE.map((t) => t + off),
        cadential: false,
        planed: true,
      })
    } else {
      const d = entry.degrees[ci % entry.degrees.length]!
      const tones = diatonicTones(trackKey, d, sevenths)
      chords.push({ startBar: bar, bars: span, rootDegree: d, rootOffset: tones[0]!, tones, cadential: false, planed: false })
    }
    bar += span
    ci += 1
  }

  // position-conditional cadence substitution (§C.1: the v->V move belongs at phrase-final
  // positions, NOT mid-phrase). At the LAST chord only, borrow the harmonic-minor V — raise the
  // chord's third to the leading tone — the strongest possible pull home. Always when the final
  // chord is already the v (turning a weak minor v into a real V); otherwise a seeded ~50% chance,
  // so the substitution is a genuine sometimes-move and progression endings keep some variety.
  if (cadence && !planing && chords.length > 0) {
    const last = chords[chords.length - 1]!
    if (last.rootDegree === 4 || rng() < 0.5) {
      // the borrowed V is spelled from NATURAL minor whatever the track's mode is — it is a
      // borrowed chord, and Phrygian's b2 / Dorian's natural 6 would otherwise bend its fifth
      const vTones = diatonicTones({ ...trackKey, mode: 'natural-minor' }, 4, sevenths)
      vTones[1] = vTones[1]! + 1 // raise the third: b7 (subtonic) -> leading tone
      chords[chords.length - 1] = { ...last, rootDegree: 4, rootOffset: vTones[0]!, tones: vTones, cadential: true }
    }
  }

  return { key: trackKey, bars, progressionName: entry.name, fn: entry.fn, barsPerChord, planing, chords }
}

/** The chord sounding at 16th-step `step` of the track (16 steps per bar). */
export function chordAtStep(track: ChordTrack, step: number): ChordTrackChord {
  const barOfStep = Math.floor(step / 16)
  for (const c of track.chords) if (barOfStep >= c.startBar && barOfStep < c.startBar + c.bars) return c
  return track.chords[track.chords.length - 1]!
}

// ---- register rule (§C.2) ----------------------------------------------------------------------
// "Below ~100 Hz stick to root/5th/octave; thirds and colour tones go an octave up" (research 124
// §C.2, cross-source consensus). ~100 Hz is roughly MIDI 43; the floor is set a little above it so
// the whole low-bass octave is covered. A note under the floor whose interval above its chord root
// is anything but a unison/octave or a perfect fifth is lifted an octave until it clears the floor —
// the rule's own "colour tones go an octave up" remedy.

export const REGISTER_RULE_FLOOR_MIDI = 48 // ~130 Hz — below this only root/5th/octave

/** True iff `pitch` sits in the sub register AND is a disallowed interval (not root/octave/5th)
 * above `chordRootPitch` — the register-rule VIOLATION predicate the lint reports. */
export function violatesRegisterRule(pitch: number, chordRootPitch: number): boolean {
  if (pitch >= REGISTER_RULE_FLOOR_MIDI) return false
  const rel = (((pitch - chordRootPitch) % 12) + 12) % 12
  return rel !== 0 && rel !== 7
}

/** Enforce the register rule on one bass note: a sub-register third/colour tone is lifted by whole
 * octaves until it either clears the floor or lands on root/octave/5th. Root/octave/5th pass
 * through untouched at any register. */
export function enforceBassRegister(pitch: number, chordRootPitch: number): number {
  let p = pitch
  let guard = 0
  while (violatesRegisterRule(p, chordRootPitch) && guard < 8) {
    p += 12
    guard += 1
  }
  return p
}

// ---- theory-aware bass generators (§C.2) -------------------------------------------------------
// Kick-relationship template x 1-3 pitch-class set x concrete gate/velocity/swing numbers, with the
// register rule enforced on every note. The two flagship recipes are the doc's precise, sourced
// codifications; the rest are register-safe general workhorses. A four-on-the-floor kick (quarters:
// steps 0/4/8/12) is assumed — these are house/trance idioms and the showdown clip solos the bass,
// so the kick is the implied grid the recipe places notes AGAINST, not a rendered voice.

export const THEORY_BASS_ARCHETYPES = ['trance-roller', 'stussy', 'offbeat-root', 'sub-pulse', 'octave-drive'] as const

/** Swing window for the Stussy tech-house recipe (§C.2: "56-58%, <54% stiff, >62% dragged").
 * Applied to offbeat 16ths as a fractional-step delay: shift = 2*(pct/100) - 1 steps. The recipe
 * gives a WINDOW, not a number — so the figure draws one, seeded, inside it. */
const STUSSY_SWING_WINDOW: readonly number[] = [56, 56.5, 57, 57.5, 58]
const swingShiftSteps = (pct: number): number => rnd2(2 * (pct / 100) - 1)

/** Seeded pick of one item (exactly one rng draw). */
const pickOne = <T>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!

interface BassContext {
  track: ChordTrack
  key: PhraseKey
  rng: () => number
}

/** Sub-register root pitch of the chord sounding at `step` (one octave below the key root). */
function bassRootAt(ctx: BassContext, step: number): number {
  const chord = chordAtStep(ctx.track, step)
  return ctx.key.root - 12 + chord.rootOffset
}

// ---- seeded rhythm-skeleton realization (owner ear-report, 2026-07-26) -------------------------
// The archetypes above were defined by FIXED 16th-slot lists, so every draw of one was the same
// groove with different pitches — measured at 8 distinct onset skeletons across 144 draws, i.e. ~10
// same-skeleton repeats per 15 figures, which is what the owner heard in blind rating. The fix is
// not more archetypes: it is a seeded FAMILY of rhythmic realizations inside each one, plus the
// per-bar variation schedule the research already prescribes but only Stussy implemented.

/** A rolling-bass bar as slot -> (interval above the chord root, gate, velocity), the representation
 * the variation schedule edits before pitches are resolved. `shift` is a fractional-step delay
 * (Chandler's groove-via-offset, §C.2). */
interface BassSlot {
  slot: number
  /** semitones above the chord's sub-register root — 0/7/12 are register-safe by construction, and
   * anything else (Stussy's b3) is lifted by `enforceBassRegister` at render time */
  interval: number
  gate: number
  velocity: number
  shift?: number
}

/** One bar's SINGLE change in a rolling-bass variation schedule (§C.2's literal Stussy schedule —
 * "bar 2: slot-7 octave→tonic; bar 3: skip slot 14; bar 4: full pattern" — generalized by §C.3's
 * "successful tracks change one element per repeat while holding the core"). */
export type BassBarChange =
  | { kind: 'full' }
  | { kind: 'skip'; slot: number }
  | { kind: 'tonic'; slot: number }
  | { kind: 'octave'; slot: number }
  | { kind: 'push'; slot: number }
  | { kind: 'ghost'; slot: number }

const BASS_CHANGE_KINDS = ['skip', 'tonic', 'octave', 'push', 'ghost'] as const

/** Build the seeded one-change-per-bar schedule for a `bars`-bar figure over `slots`: the FIRST bar
 * states the pattern and the LAST restates it in full (the Stussy schedule's own shape); each bar
 * between them carries exactly one change, drawn seeded. Changes land in the back half of the bar,
 * where a rolling bass's variations actually go. */
export function bassBarSchedule(rng: () => number, slots: readonly number[], bars: number): BassBarChange[] {
  const sched: BassBarChange[] = Array.from({ length: bars }, () => ({ kind: 'full' }) as BassBarChange)
  if (slots.length === 0 || bars < 3) return sched
  const late = slots.filter((s) => s >= 8)
  const pool = late.length > 0 ? late : slots
  const free: number[] = []
  for (let s = 1; s < 16; s++) if (!slots.includes(s) && s % 4 !== 0) free.push(s)
  for (let b = 1; b < bars - 1; b++) {
    const kind = pickOne(rng, BASS_CHANGE_KINDS)
    if (kind === 'ghost') {
      sched[b] = free.length > 0 ? { kind, slot: pickOne(rng, free) } : { kind: 'full' }
      continue
    }
    // a pushed note must stay inside its own bar
    const kindPool = kind === 'push' ? pool.filter((s) => s < 15) : pool
    sched[b] = kindPool.length > 0 ? { kind, slot: pickOne(rng, kindPool) } : { kind: 'full' }
  }
  return sched
}

/** Render one bar of a slot spec: apply that bar's single scheduled change, the figure's swing on
 * offbeat 16ths, and the register rule on every note. */
function renderBassBar(ctx: BassContext, bar: number, spec: readonly BassSlot[], change: BassBarChange, swing: number): ComposedNote[] {
  let slots: BassSlot[] = spec.map((s) => ({ ...s }))
  switch (change.kind) {
    case 'skip':
      slots = slots.filter((s) => s.slot !== change.slot)
      break
    case 'tonic':
      slots = slots.map((s) => (s.slot === change.slot ? { ...s, interval: 0 } : s))
      break
    case 'octave':
      // "this slot becomes the octave" — capped at the octave so the sub never climbs out of range
      slots = slots.map((s) => (s.slot === change.slot ? { ...s, interval: 12 } : s))
      break
    case 'push':
      slots = slots.map((s) => (s.slot === change.slot ? { ...s, shift: (s.shift ?? 0) + 1 } : s))
      break
    case 'ghost':
      if (!slots.some((s) => s.slot === change.slot)) slots.push({ slot: change.slot, interval: 0, gate: 0.9, velocity: 0.42 })
      break
    default:
      break
  }
  const o = bar * 16
  const out: ComposedNote[] = []
  for (const s of slots) {
    const step = o + s.slot
    const root = bassRootAt(ctx, step)
    const start = rnd2(step + (s.shift ?? 0) + (s.slot % 2 === 1 ? swing : 0))
    out.push({ pitch: enforceBassRegister(root + s.interval, root), start, duration: s.gate, velocity: clampVel(s.velocity) })
  }
  return out
}

/** Render a whole figure from one bar spec plus a seeded per-bar schedule. */
function renderBassFigure(ctx: BassContext, spec: readonly BassSlot[], swing = 0): ComposedNote[] {
  const sched = bassBarSchedule(ctx.rng, spec.map((s) => s.slot), ctx.track.bars)
  const notes: ComposedNote[] = []
  for (let bar = 0; bar < ctx.track.bars; bar++) notes.push(...renderBassBar(ctx, bar, spec, sched[bar] ?? { kind: 'full' }, swing))
  return notes
}

/** Seeded realizations of the Myloops rolling bass. The sourced pattern — all three 16th offbeats
 * "e-&-a" of every beat, 12 notes/bar — carries three of the five slots, so it stays the dominant
 * sound; the thinner sets are the same recipe at lower density (Attack's wider off-beat archetype,
 * §C.2: notes BETWEEN the kicks). */
const TRANCE_ROLLER_OFFBEATS: readonly (readonly number[])[] = [
  [1, 2, 3],
  [1, 2, 3],
  [1, 2, 3],
  [2, 3], // "&-a" — a more spacious roller
  [1, 3], // "e-a" — a 16th gap on every "&"
]

function tranceRoller(ctx: BassContext): ComposedNote[] {
  // Myloops uplifting-trance rolling bass: kick on quarters, bass on the 16th offbeats of every
  // beat, all chord root, cut short (~40 ms decay -> a sub-1-step gate), -8..-12 velocity on one
  // offbeat of each beat. Density, gate and WHICH offbeat carries the velocity dip are seeded; the
  // recipe fixes none of the three (it says "optional -8-12 velocity on the &s").
  const offbeats = pickOne(ctx.rng, TRANCE_ROLLER_OFFBEATS)
  const gate = pickOne(ctx.rng, [0.4, 0.5, 0.6])
  const dip = pickOne(ctx.rng, offbeats)
  const spec: BassSlot[] = []
  for (const beat of [0, 4, 8, 12]) {
    for (const k of offbeats) spec.push({ slot: beat + k, interval: 0, gate, velocity: k === dip ? 0.72 : 0.82 })
  }
  return renderBassFigure(ctx, spec)
}

/** "Quiet tonic fillers elsewhere" is the one part of the Stussy spec left open — the recipe pins
 * slots 1/9, 5/13 and 7/15 and then says only "elsewhere" for the fillers. These are the candidate
 * filler sets, all on weak 16ths so the pinned slots keep their weight. */
const STUSSY_FILLER_SETS: readonly (readonly number[])[] = [
  [2, 10],
  [2, 10, 13],
  [3, 11],
  [10],
  [2, 7, 10],
  [2, 10, 15],
]

function stussy(ctx: BassContext): ComposedNote[] {
  // The tech-house "Stussy 3-note pattern" (§C.2, the producer's school): pitch set 1-5-8 (root,
  // fifth, octave) or 1-b3-5; tonic on slots 1/9 (steps 0/8), fifth on 5/13 (steps 4/12), octave on
  // 7/15 (steps 6/14), quiet tonic fillers elsewhere; gate 60% on downbeats / 90-100% offbeats;
  // velocities ~110/90/75 (of 127); swing 56-58%.
  //
  // The recipe's OWN one-change-per-bar schedule (bar 2: slot-7 octave->tonic; bar 3: skip slot 14;
  // bar 4: full pattern) is kept verbatim — so this archetype does NOT take the generic seeded
  // schedule. Its seeded axes are the ones the recipe leaves open: the pitch-set variant, the swing
  // percentage inside the stated 56-58 window, the gate values inside the stated ranges, and which
  // weak 16ths carry the "quiet tonic fillers".
  const useMinorThird = ctx.rng() < 0.4 // the 1-b3-5 colour variant
  const swing = swingShiftSteps(pickOne(ctx.rng, STUSSY_SWING_WINDOW))
  const downGate = pickOne(ctx.rng, [0.55, 0.6, 0.65])
  const offGate = pickOne(ctx.rng, [0.9, 0.95, 1])
  const fillers = pickOne(ctx.rng, STUSSY_FILLER_SETS)
  const OCT = 12
  const FIFTH = 7
  const B3 = 3
  const octInterval = useMinorThird ? B3 : OCT
  const notes: ComposedNote[] = []
  for (let bar = 0; bar < ctx.track.bars; bar++) {
    const barIx = bar % 4 // the schedule is a 4-bar cycle
    const spec: BassSlot[] = [
      { slot: 0, interval: 0, gate: downGate, velocity: 0.87 }, // tonic on the downbeat (with the kick)
      { slot: 8, interval: 0, gate: downGate, velocity: 0.87 },
      { slot: 4, interval: FIFTH, gate: offGate, velocity: 0.71 },
      { slot: 12, interval: FIFTH, gate: offGate, velocity: 0.71 },
      // bar 2 turns slot-7 (step 6) octave into a tonic
      { slot: 6, interval: barIx === 1 ? 0 : octInterval, gate: offGate, velocity: 0.59 },
    ]
    if (barIx !== 2) spec.push({ slot: 14, interval: octInterval, gate: offGate, velocity: 0.59 }) // bar 3 skips slot 14
    for (const slot of fillers) spec.push({ slot, interval: 0, gate: 0.9, velocity: 0.47 })
    notes.push(...renderBassBar(ctx, bar, spec, { kind: 'full' }, swing))
  }
  return notes
}

/** Seeded off-beat root patterns (§C.2, Attack: notes BETWEEN the kicks). The plain 8th offbeats
 * stay dominant; the rest add a 16th anticipation or a dropped/displaced onset without ever landing
 * a note ON a quarter, which is what makes the archetype off-beat. */
const OFFBEAT_ROOT_SETS: readonly (readonly number[])[] = [
  [2, 6, 10, 14],
  [2, 6, 10, 14],
  [2, 6, 10, 13, 14],
  [2, 6, 9, 10, 14],
  [2, 7, 10, 14],
  [2, 6, 10, 15],
  [2, 6, 10, 11, 14],
]

function offbeatRoot(ctx: BassContext): ComposedNote[] {
  const slots = pickOne(ctx.rng, OFFBEAT_ROOT_SETS)
  const lifted = ctx.rng() < 0.4 ? slots[slots.length - 1]! : -1 // an occasional octave lift on the tail
  const spec: BassSlot[] = slots.map((slot, i) => ({
    slot,
    interval: slot === lifted ? 12 : 0,
    gate: Math.max(0.5, Math.min(2, (slots[i + 1] ?? slot + 2) - slot)),
    velocity: 0.8,
  }))
  return renderBassFigure(ctx, spec)
}

/** Seeded sparse-sub shapes (§C.2's DnB posture: roots and octaves "with breathing space"). Each is
 * a long root plus at most two answers; only root/octave intervals appear, so the register rule is
 * satisfied by construction rather than by correction. */
const SUB_PULSE_SHAPES: readonly (readonly BassSlot[])[] = [
  [{ slot: 0, interval: 0, gate: 6, velocity: 0.9 }, { slot: 10, interval: 0, gate: 3, velocity: 0.72 }],
  [{ slot: 0, interval: 0, gate: 8, velocity: 0.9 }, { slot: 12, interval: 0, gate: 3, velocity: 0.7 }],
  [{ slot: 0, interval: 0, gate: 4, velocity: 0.9 }, { slot: 6, interval: 0, gate: 2, velocity: 0.66 }, { slot: 11, interval: 12, gate: 4, velocity: 0.6 }],
  [{ slot: 2, interval: 0, gate: 6, velocity: 0.86 }, { slot: 10, interval: 0, gate: 4, velocity: 0.72 }], // pushed off the downbeat
  [{ slot: 0, interval: 0, gate: 10, velocity: 0.9 }], // one long root, nothing else
  [{ slot: 0, interval: 0, gate: 5, velocity: 0.9 }, { slot: 7, interval: 12, gate: 2, velocity: 0.62 }, { slot: 14, interval: 0, gate: 2, velocity: 0.68 }],
]

function subPulse(ctx: BassContext): ComposedNote[] {
  return renderBassFigure(ctx, pickOne(ctx.rng, SUB_PULSE_SHAPES))
}

/** Seeded onset grids for the bass-as-lead driver: straight 8ths (the §C.2 recipe, weighted to stay
 * dominant) plus three Euclidean timelines E(k,16) rotated so a downbeat onset is guaranteed — the
 * §C.5 Toussaint generator, which the operator library has always exported and nothing used. */
const OCTAVE_DRIVE_GRIDS: readonly (readonly number[])[] = [
  [0, 2, 4, 6, 8, 10, 12, 14],
  [0, 2, 4, 6, 8, 10, 12, 14],
  [0, 2, 4, 6, 8, 10, 12, 14],
  euclidSteps(5, 16, 1),
  euclidSteps(6, 16, 1),
  euclidSteps(7, 16, 1),
  euclidSteps(9, 16, 1),
]

function octaveDrive(ctx: BassContext): ComposedNote[] {
  // bass-as-lead: root/octave alternation over the grid (§C.2), register safe by construction
  const grid = pickOne(ctx.rng, OCTAVE_DRIVE_GRIDS)
  const phase = ctx.rng() < 0.3 ? 1 : 0 // which half of the alternation opens the bar
  const spec: BassSlot[] = grid.map((slot, i) => {
    const high = (i + phase) % 2 === 1
    return { slot, interval: high ? 12 : 0, gate: 1, velocity: high ? 0.62 : 0.82 }
  })
  return renderBassFigure(ctx, spec)
}

/** One theory-aware bass figure over a chord track, deterministic in `rng`. Every note is passed
 * through the register rule as a final guard, so a sub-register figure carries only root/5th/octave. */
export function composeTheoryBass(archetype: string, track: ChordTrack, seed: number): ComposedNote[] {
  const ctx: BassContext = { track, key: track.key, rng: mulberry32(seed + 1301) }
  let notes: ComposedNote[]
  switch (archetype) {
    case 'trance-roller':
      notes = tranceRoller(ctx)
      break
    case 'stussy':
      notes = stussy(ctx)
      break
    case 'offbeat-root':
      notes = offbeatRoot(ctx)
      break
    case 'sub-pulse':
      notes = subPulse(ctx)
      break
    default:
      notes = octaveDrive(ctx)
      break
  }
  // final register-rule guard: a low third/colour tone anywhere is lifted an octave
  const guarded = notes.map((n) => {
    const root = bassRootAt(ctx, Math.floor(n.start))
    return { ...n, pitch: enforceBassRegister(n.pitch, root) }
  })
  guarded.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  return guarded
}

// ---- theory-aware chord generator: voice-leading + register separation (§C.4) ------------------
// Voicing is chosen by a minimal-total-semitone-motion cost function over inversions/octaves (keep
// common tones in the same voice, move the rest stepwise) instead of a uniform draw over root-
// position shapes. The pad is register-separated from the sub bass (voiced an octave-plus above the
// key root, so it never doubles the sub's root at its bottom). Style voicings — m7/m9 colour and the
// omit-5 Chandler house voicing — are options chosen per figure.

export const THEORY_CHORD_ARCHETYPES = ['lush-pad', 'offbeat-stabs', 'house-pulse', 'charleston'] as const
export type ChordVoicingStyle = 'triad' | 'm7' | 'm9' | 'omit5'

/** Base octave the pad is voiced in — an octave above the key root, keeping the whole pad clear of
 * the sub bass at key.root-12 (register separation, §C.4). */
const PAD_REGISTER = 12

/** Diatonic scale-degree -> semitone offset above the key root, stacking within the mode. */
function degToOffset(key: PhraseKey, n: number): number {
  const scale = scalePitchClasses(key)
  const idx = ((n % 7) + 7) % 7
  const oct = Math.floor(n / 7)
  return oct * 12 + scale[idx]!
}

/** The chord's tone content (semitone offsets above the key root) for a given voicing style —
 * preserving any cadential leading-tone alteration held in `chord.tones`. Planed stabs keep their
 * fixed m7 shape regardless of style (parallel planing is the point). */
function styleToneOffsets(key: PhraseKey, chord: ChordTrackChord, style: ChordVoicingStyle): number[] {
  if (chord.planed || chord.rootDegree === null) return chord.tones
  const d = chord.rootDegree
  const [root, third, fifth] = [chord.tones[0]!, chord.tones[1]!, chord.tones[2]!]
  const seventh = degToOffset(key, d + 6)
  const ninth = degToOffset(key, d + 7 + 1) // a ninth above the root (octave + a second)
  switch (style) {
    case 'm7':
      return [root, third, fifth, seventh]
    case 'm9':
      return [root, third, fifth, seventh, ninth]
    case 'omit5':
      return [root, third, seventh, ninth] // Chandler house: drop the 5th, add colour
    default:
      return [root, third, fifth]
  }
}

/** Candidate voicings of one chord: every inversion, each also tried an octave down/up, filtered to
 * the pad register window so the search never drifts into the sub or the lead's octave. */
function candidateVoicings(offsets: readonly number[], keyRoot: number): number[][] {
  const base = offsets.map((o) => keyRoot + PAD_REGISTER + o).sort((a, b) => a - b)
  const inversions: number[][] = []
  let v = [...base]
  for (let i = 0; i < offsets.length; i++) {
    inversions.push([...v].sort((a, b) => a - b))
    v = [...v.slice(1), v[0]! + 12] // move the lowest voice up an octave
  }
  const floor = keyRoot + PAD_REGISTER - 3
  const ceil = keyRoot + PAD_REGISTER + 28
  const out: number[][] = []
  for (const c of inversions) {
    for (const shift of [0, -12, 12]) {
      const s = c.map((p) => p + shift)
      if (Math.min(...s) >= floor && Math.max(...s) <= ceil) out.push(s.sort((a, b) => a - b))
    }
  }
  return out.length > 0 ? out : [base]
}

/** Total minimal semitone motion from `prev` to `cand` (each candidate voice to its nearest previous
 * voice) — the voice-leading cost. With no previous voicing, prefer the most compact spread so the
 * first chord opens in a tidy close position. */
export function voiceLeadingCost(cand: readonly number[], prev: readonly number[] | null): number {
  if (prev === null) return Math.max(...cand) - Math.min(...cand)
  let cost = 0
  for (const p of cand) {
    let best = Infinity
    for (const q of prev) best = Math.min(best, Math.abs(p - q))
    cost += best
  }
  // a light bonus for holding the top voice stationary (the pad "hovers", §C.4)
  const topMove = Math.abs(Math.max(...cand) - Math.max(...prev))
  return cost + topMove * 0.25
}

/** Pick the minimal-motion voicing of `chord` given the previous voicing (deterministic; ties to the
 * first candidate, which is the lowest inversion). */
export function chooseVoicing(key: PhraseKey, chord: ChordTrackChord, style: ChordVoicingStyle, prev: number[] | null): number[] {
  const cands = candidateVoicings(styleToneOffsets(key, chord, style), key.root)
  let best = cands[0]!
  let bestCost = voiceLeadingCost(best, prev)
  for (const c of cands) {
    const cost = voiceLeadingCost(c, prev)
    if (cost < bestCost) {
      best = c
      bestCost = cost
    }
  }
  return best
}

const CHORD_STYLES: readonly ChordVoicingStyle[] = ['triad', 'm7', 'm9', 'omit5']

/** Pick the OPENING voicing seeded from the most compact candidates, rather than always the single
 * most compact one (owner ear-report 2026-07-26: every figure over the same chord opened on the
 * same inversion in the same octave, so the whole pad part was pinned by chord choice alone). The
 * candidates are sorted by spread and the draw is confined to the compact end, so the opening is
 * still a tidy close-position voicing — just not always the SAME one. Voice-leading from the second
 * chord on is unchanged: minimal motion from wherever the figure opened. */
export function chooseOpeningVoicing(key: PhraseKey, chord: ChordTrackChord, style: ChordVoicingStyle, rng: () => number): number[] {
  const cands = candidateVoicings(styleToneOffsets(key, chord, style), key.root)
    .slice()
    .sort((a, b) => voiceLeadingCost(a, null) - voiceLeadingCost(b, null))
  return pickOne(rng, cands.slice(0, Math.min(4, cands.length)))
}

/** One bar's SINGLE change in a chord figure's variation schedule — the chord analogue of
 * `bassBarSchedule`'s menu (a stab dropped, delayed a 16th behind the beat in Chandler's
 * groove-via-offset move, or answered by an extra hit). */
export type ChordBarChange = { kind: 'full' } | { kind: 'skip'; slot: number } | { kind: 'push'; slot: number } | { kind: 'add'; slot: number }

const CHORD_CHANGE_KINDS = ['skip', 'push', 'add'] as const

/** The seeded one-change-per-bar schedule for a chord figure: first bar states the rhythm, last bar
 * restates it, each bar between carries exactly one change. */
export function chordBarSchedule(rng: () => number, slots: readonly number[], bars: number): ChordBarChange[] {
  const sched: ChordBarChange[] = Array.from({ length: bars }, () => ({ kind: 'full' }) as ChordBarChange)
  if (slots.length === 0 || bars < 3) return sched
  const late = slots.filter((s) => s >= 8)
  const pool = late.length > 0 ? late : slots
  const free: number[] = []
  for (let s = 1; s < 16; s++) if (!slots.includes(s)) free.push(s)
  for (let b = 1; b < bars - 1; b++) {
    const kind = pickOne(rng, CHORD_CHANGE_KINDS)
    if (kind === 'add') {
      sched[b] = free.length > 0 ? { kind, slot: pickOne(rng, free) } : { kind: 'full' }
      continue
    }
    const kindPool = kind === 'push' ? pool.filter((s) => s < 15) : pool
    sched[b] = kindPool.length > 0 ? { kind, slot: pickOne(rng, kindPool) } : { kind: 'full' }
  }
  return sched
}

/** Seeded off-beat stab placements. The plain 8th offbeats keep two of the seven slots so the
 * archetype still sounds like itself; the rest thin it, double it, or push it onto the 3-against-4
 * grid — all placements a house/techno stab part actually uses. */
const STAB_PATTERNS: readonly (readonly number[])[] = [
  [2, 6, 10, 14],
  [2, 6, 10, 14],
  [2, 6, 14],
  [2, 5, 8, 11, 14],
  [2, 10],
  [2, 6, 10, 13, 14],
  [3, 7, 11, 15],
]

/** Seeded house-pulse grids: straight 8ths (dominant) plus Euclidean timelines E(k,16) rotated to a
 * downbeat onset (§C.5). */
const PULSE_PATTERNS: readonly (readonly number[])[] = [
  [0, 2, 4, 6, 8, 10, 12, 14],
  [0, 2, 4, 6, 8, 10, 12, 14],
  [0, 2, 4, 6, 8, 10, 12],
  [0, 2, 4, 6, 8, 10, 14],
  euclidSteps(6, 16, 1),
  euclidSteps(7, 16, 1),
  euclidSteps(9, 16, 1),
]

/** Seeded charleston placements — the downbeat hit plus a syncopated answer, at the several offsets
 * the figure is actually played at. */
const CHARLESTON_PATTERNS: readonly (readonly number[])[] = [
  [0, 6],
  [0, 6],
  [0, 6, 12],
  [0, 7],
  [0, 3, 6],
  [0, 6, 10],
  [0, 6, 11, 14],
]

/** Seeded pad shapes over ONE chord's span (a pad's identity is holding, so this stays chord-scoped
 * rather than per-bar): held, held with a release gap, a two-part swell, an anticipated entry a 16th
 * before the chord, and a breathing re-articulation near the end. */
type PadShape = 'held' | 'held-gap' | 'swell' | 'anticipated' | 'breathing'
const PAD_SHAPES: readonly PadShape[] = ['held', 'held', 'held-gap', 'swell', 'anticipated', 'breathing']

/** One theory-aware chord figure over a chord track: a per-chord voicing chosen by minimal-motion
 * voice-leading from a SEEDED opening voicing, rendered with a seeded realization of the archetype's
 * rhythm plus a one-change-per-bar variation schedule, honouring the track's harmonic rhythm (the
 * voicing changes only at chord boundaries, never re-drawn per bar). Deterministic in `seed`. */
export function composeTheoryChords(archetype: string, track: ChordTrack, seed: number): ComposedNote[] {
  const rng = mulberry32(seed + 1487)
  const style = pickOne(rng, CHORD_STYLES)

  // one voicing per CHORD: seeded opening, minimal motion thereafter
  const voicings: number[][] = []
  let prev: number[] | null = null
  for (const chord of track.chords) {
    const v: number[] = prev === null ? chooseOpeningVoicing(track.key, chord, style, rng) : chooseVoicing(track.key, chord, style, prev)
    voicings.push(v)
    prev = v
  }
  const voicingAtBar = (bar: number): number[] => {
    for (let i = 0; i < track.chords.length; i++) {
      const c = track.chords[i]!
      if (bar >= c.startBar && bar < c.startBar + c.bars) return voicings[i]!
    }
    return voicings[voicings.length - 1]!
  }

  const notes: ComposedNote[] = []
  const stack = (voicing: readonly number[], start: number, duration: number, v: number): void => {
    for (const pitch of voicing) notes.push({ pitch, start: rnd2(start), duration, velocity: clampVel(v) })
  }

  if (archetype === 'lush-pad') {
    const shape = pickOne(rng, PAD_SHAPES)
    const level = pickOne(rng, [0.54, 0.6, 0.66])
    track.chords.forEach((chord, i) => {
      const o = chord.startBar * 16
      const len = chord.bars * 16
      const voicing = voicings[i]!
      switch (shape) {
        case 'held-gap':
          stack(voicing, o, len - 2, level)
          break
        case 'swell':
          stack(voicing, o, Math.floor(len / 2), level - 0.06)
          stack(voicing, o + Math.floor(len / 2), len - Math.floor(len / 2), level + 0.06)
          break
        case 'anticipated':
          // a 16th early, except at the very top of the clip where there is nothing to anticipate
          if (i === 0) stack(voicing, o, len, level)
          else stack(voicing, o - 1, len + 1, level)
          break
        case 'breathing':
          stack(voicing, o, len - 4, level)
          stack(voicing, o + len - 3, 3, level - 0.08)
          break
        default:
          stack(voicing, o, len, level)
          break
      }
    })
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
    return notes
  }

  // the rhythmic archetypes are laid out per BAR, so the seeded variation schedule applies
  const slots = archetype === 'offbeat-stabs'
    ? pickOne(rng, STAB_PATTERNS)
    : archetype === 'house-pulse'
      ? pickOne(rng, PULSE_PATTERNS)
      : pickOne(rng, CHARLESTON_PATTERNS)
  const gate = archetype === 'offbeat-stabs'
    ? pickOne(rng, [1, 1.5, 2])
    : archetype === 'house-pulse'
      ? pickOne(rng, [0.75, 1, 1.5])
      : pickOne(rng, [2, 3])
  const accent = pickOne(rng, [0.66, 0.7, 0.74])
  const soft = accent - pickOne(rng, [0.1, 0.16, 0.22])
  const sched = chordBarSchedule(rng, slots, track.bars)

  for (let bar = 0; bar < track.bars; bar++) {
    const voicing = voicingAtBar(bar)
    const change = sched[bar] ?? { kind: 'full' }
    let events = slots.map((slot) => ({ slot, shift: 0, velocity: slot % 8 === 0 ? accent : soft, gate }))
    switch (change.kind) {
      case 'skip':
        events = events.filter((e) => e.slot !== change.slot)
        break
      case 'push':
        events = events.map((e) => (e.slot === change.slot ? { ...e, shift: 1 } : e))
        break
      case 'add':
        if (!events.some((e) => e.slot === change.slot)) events.push({ slot: change.slot, shift: 0, velocity: soft, gate })
        break
      default:
        break
    }
    for (const e of events) stack(voicing, bar * 16 + e.slot + e.shift, e.gate, e.velocity)
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  return notes
}

// ---- theory-aware lead generator: motif-first (§C.3) -------------------------------------------
// The lead is generated MOTIF-FIRST, not as an independent per-bar draw: build one 1-2 bar motif
// (<=3 distinct rhythm cells, 60-80% stepwise motion, chord tones on strong beats, NCTs as
// passing/neighbour tones resolving by step), then DERIVE the 4-bar phrase from it with the motif
// operators (transpose-to-next-chord, contour-inversion for the call/response answer, one-change-
// per-repeat). Two cross-phrase rules the uniform draw can't express are then enforced: a single
// peak note (the highest pitch occurs once, on a strong beat, near the phrase midpoint) and
// call-ends-high / answer-ends-low.

export const THEORY_LEAD_ARCHETYPES = ['motif-call-response', 'motif-repeat', 'arp-motif', 'sparse-motif'] as const

/** Lead register — two octaves above the key root (§ midifig register targets). */
const LEAD_REGISTER = 24
const STRONG_STEPS = new Set([0, 4, 8, 12])

/** 1-bar rhythm cells (onset steps), each using <=3 distinct inter-onset durations (motif economy,
 * §C.3). Denser cells first — the archetype picks a slice. */
const MOTIF_RHYTHMS: readonly (readonly number[])[] = [
  [0, 4, 8, 12], // quarter pulse
  [0, 3, 4, 8, 11, 12], // dotted-ish cell
  [0, 2, 4, 8, 10, 12], // 8ths with gaps
  [0, 4, 6, 8, 12, 14], // syncopated
  [0, 4, 7, 12], // sparse, off-grid middle
  [0, 2, 4, 6, 8, 10, 12, 14], // running 8ths
]

/** A note in scale-degree space (0 = key root), the representation the motif is built in so chord
 * tones on strong beats and stepwise motion are exact before pitches are resolved. */
interface DegNote {
  degree: number
  start: number
  duration: number
  velocity: number
}

/** Chord tones of `chord` as scale degrees relative to the key root (root/third/fifth). Planed
 * chords fall back to the key's tonic triad so the lead stays diatonic over a non-functional stab. */
function chordDegrees(chord: ChordTrackChord): number[] {
  if (chord.rootDegree === null) return [0, 2, 4]
  const d = chord.rootDegree
  return [d, d + 2, d + 4]
}

/** The chord-tone degree nearest `cur` (searching octave-equivalents of each chord tone) — the
 * stepwise pull toward a chord tone on strong beats. */
function nearestChordDegree(chordDegs: readonly number[], cur: number): number {
  let best = chordDegs[0]!
  let bestDist = Infinity
  for (const ct of chordDegs) {
    const cls = ((ct % 7) + 7) % 7
    // the degree congruent to this chord-tone class nearest cur
    const base = cur - (((cur % 7) + 7) % 7) + cls
    for (const cand of [base - 7, base, base + 7]) {
      const dist = Math.abs(cand - cur)
      if (dist < bestDist) {
        bestDist = dist
        best = cand
      }
    }
  }
  return best
}

/** Build one 1-bar motif in degree space over `chord`: start on a chord tone, place chord tones on
 * strong beats, and keep motion mostly stepwise with NCTs as single-step passing/neighbour tones on
 * weak subdivisions. Deterministic in `rng`. */
function buildMotif(chord: ChordTrackChord, rng: () => number, rhythm: readonly number[]): DegNote[] {
  const chordDegs = chordDegrees(chord)
  const notes: DegNote[] = []
  let cur = chordDegs[0]! // open on the chord root, mid-register
  for (let i = 0; i < rhythm.length; i++) {
    const step = rhythm[i]!
    const isStrong = STRONG_STEPS.has(step)
    let deg: number
    if (i === 0) {
      deg = cur
    } else if (isStrong) {
      deg = nearestChordDegree(chordDegs, cur) // chord tone on a strong beat
    } else if (rng() < 0.8) {
      deg = cur + (rng() < 0.5 ? -1 : 1) // stepwise passing/neighbour NCT (resolves by step next)
    } else {
      deg = nearestChordDegree(chordDegs, cur)
    }
    const dur = Math.max(1, (rhythm[i + 1] ?? 16) - step)
    const v = isStrong ? 0.6 : 0.48
    notes.push({ degree: deg, start: step, duration: dur, velocity: v })
    cur = deg
  }
  // NCT resolution guarantee: if the final note is a non-chord tone, resolve it to the nearest
  // chord tone by step so the motif closes on a stable degree.
  const last = notes[notes.length - 1]!
  const lastCls = ((last.degree % 7) + 7) % 7
  const chordClasses = new Set(chordDegs.map((d) => ((d % 7) + 7) % 7))
  if (!chordClasses.has(lastCls)) last.degree = nearestChordDegree(chordDegs, last.degree)
  return notes
}

/** Snap a pitch to the nearest pitch of the key's scale — the diatonic guard applied after the
 * pitch-space motif operators (contour inversion / chromatic transpose) so the phrase stays in key
 * and the scale-consistency lint passes regardless of how it was derived. */
export function snapToScale(pitch: number, key: PhraseKey): number {
  const scale = scalePitchClasses(key)
  const rootPc = ((key.root % 12) + 12) % 12
  for (let d = 0; d < 12; d++) {
    for (const cand of [pitch - d, pitch + d]) {
      if (scale.includes((((cand - rootPc) % 12) + 12) % 12)) return cand
    }
  }
  return pitch
}

/** Enforce the single-peak-note rule (§C.3): the highest pitch occurs exactly once, on a strong
 * beat, near the phrase midpoint. A strong-beat note nearest `targetStep` is raised just above every
 * other note (snapped to scale); any other note at or above it is dropped an octave until it clears. */
export function enforceSinglePeak(notes: ComposedNote[], targetStep: number, key: PhraseKey): ComposedNote[] {
  if (notes.length < 2) return notes
  const strong = notes.filter((n) => Math.round(n.start) % 4 === 0)
  const pool = strong.length > 0 ? strong : notes
  let peak = pool[0]!
  for (const n of pool) if (Math.abs(n.start - targetStep) < Math.abs(peak.start - targetStep)) peak = n
  const othersMax = Math.max(...notes.filter((n) => n !== peak).map((n) => n.pitch))
  peak.pitch = snapToScale(othersMax + 2, key)
  if (peak.pitch <= othersMax) peak.pitch = snapToScale(othersMax + 3, key)
  for (const n of notes) {
    if (n === peak) continue
    let guard = 0
    while (n.pitch >= peak.pitch && guard < 6) {
      n.pitch -= 12
      guard += 1
    }
  }
  return notes
}

/** Resolve a bar of degree-space motif notes to pitches over `chord`, diatonically transposed onto
 * the chord (transpose-to-next-chord in degree space keeps chord tones as chord tones), offset to
 * the bar's absolute step position. */
function barFromMotif(motif: readonly DegNote[], chord: ChordTrackChord, rootDeg0: number, barStart: number, key: PhraseKey): ComposedNote[] {
  const rootDeg = chord.rootDegree ?? 0
  const delta = rootDeg - rootDeg0
  return motif.map((n) => ({
    pitch: degreePitch(key, n.degree + delta, LEAD_REGISTER),
    start: barStart + n.start,
    duration: n.duration,
    velocity: clampVel(n.velocity),
  }))
}

/** One theory-aware lead figure over a chord track: a 1-bar motif derived into a 4-bar call-and-
 * response phrase via the motif operators, with the single-peak and call-high/answer-low rules
 * enforced. Deterministic in `seed`. */
export function composeTheoryLead(archetype: string, track: ChordTrack, seed: number): ComposedNote[] {
  const rng = mulberry32(seed + 1693)
  const key = track.key
  // archetype-driven rhythm slice: sparse -> the sparse cells, arp -> the running cells, else the
  // syncopated middle
  const rhythmPool = archetype === 'sparse-motif'
    ? MOTIF_RHYTHMS.slice(4)
    : archetype === 'arp-motif'
      ? MOTIF_RHYTHMS.slice(2)
      : MOTIF_RHYTHMS.slice(1, 5)
  const rhythm = rhythmPool[Math.floor(rng() * rhythmPool.length)]!
  const chord0 = chordAtStep(track, 0)
  const rootDeg0 = chord0.rootDegree ?? 0
  const motif = buildMotif(chord0, rng, rhythm)

  // The answer inverts the call's contour for call-response archetypes, else repeats it (motif-
  // repeat). Inversion is done in DEGREE space (mirror around the motif's opening degree) so it
  // stays diatonic; the pitch-space contourInversion operator is exercised too, below, on bar 3.
  const invert = archetype !== 'motif-repeat'
  const axisDeg = motif[0]!.degree
  const answerMotif: DegNote[] = invert ? motif.map((n) => ({ ...n, degree: 2 * axisDeg - n.degree })) : motif.map((n) => ({ ...n }))

  const notes: ComposedNote[] = []
  for (let bar = 0; bar < track.bars; bar++) {
    const chord = chordAtStep(track, bar * 16)
    const isAnswer = bar >= track.bars / 2
    const shape = isAnswer ? answerMotif : motif
    notes.push(...barFromMotif(shape, chord, rootDeg0, bar * 16, key))
  }

  // Derive the LAST bar with the operator library as a one-change-per-repeat variation of itself
  // (rhythmic displacement by a 16th OR a pitch-space contour inversion), then re-snap to scale — a
  // concrete demonstration that the phrase is derived by operators, not redrawn.
  const lastBarStart = (track.bars - 1) * 16
  const lastBar = notes.filter((n) => n.start >= lastBarStart)
  if (lastBar.length > 0) {
    const ops: MotifOperator[] = [
      (ns) => rhythmicDisplacement(ns, 1, 16).map((n) => ({ ...n, start: n.start + lastBarStart })),
      (ns) => contourInversion(ns.map((n) => ({ ...n, start: n.start - lastBarStart })), ns[0]!.pitch).map((n) => ({ ...n, start: n.start + lastBarStart })),
    ]
    const local = lastBar.map((n) => ({ ...n, start: n.start - lastBarStart }))
    const varied = oneChangePerRepeat(local, 1, ops.map((op) => (ns: readonly ComposedNote[]) => op(ns.map((n) => ({ ...n, start: n.start + lastBarStart })))), seed).at(-1)!
    // rebuild notes: keep everything before the last bar, replace the last bar with the varied copy
    const head = notes.filter((n) => n.start < lastBarStart)
    notes.length = 0
    notes.push(...head, ...varied.map((n) => ({ ...n, pitch: snapToScale(n.pitch, key) })))
  }

  // snap every pitch to scale (guards the chromatic operators), then enforce cross-phrase contour
  for (const n of notes) n.pitch = snapToScale(n.pitch, key)
  enforceSinglePeak(notes, Math.floor(track.bars * 16 / 2), key)

  // call ends high / answer ends low (§C.3): lift the last note of the call (phrase midpoint) to a
  // high chord tone; drop the final note of the answer to a low chord tone (the tonic).
  const callNotes = notes.filter((n) => n.start < track.bars * 8)
  const answerNotes = notes.filter((n) => n.start >= track.bars * 8)
  if (callNotes.length > 0) {
    const callEnd = callNotes.reduce((a, b) => (b.start > a.start ? b : a))
    callEnd.pitch = snapToScale(callEnd.pitch + 4, key)
  }
  if (answerNotes.length > 0) {
    const answerEnd = answerNotes.reduce((a, b) => (b.start > a.start ? b : a))
    answerEnd.pitch = degreePitch(key, rootDeg0, LEAD_REGISTER - 12) // low tonic
  }
  // re-assert the single peak in case the call-end lift introduced a new maximum
  enforceSinglePeak(notes, Math.floor(track.bars * 16 / 2), key)

  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  return notes
}

// ---- pre-render lint: gross-error gates only (§B.7 / §C.7) -------------------------------------
// Cheap MusPy-style checks in the research/121 "metrics catch gross errors, ears decide quality"
// division of labour: they FLAG, they never SCORE. A flagged figure is still rendered and rated —
// the flag is a warning that something is grossly wrong (out-of-key notes, a register-rule
// violation, adjacent bars with no shared groove), not a quality verdict.

export interface LintReport {
  /** fraction of notes whose pitch class is in the key's scale (MusPy scale consistency) */
  scaleConsistency: number
  /** sub-register notes that are not root/5th/octave of their chord (register-rule violations) */
  registerViolations: { pitch: number; start: number }[]
  /** 1 - mean Hamming distance of adjacent bars' 16-slot onset vectors (MusPy groove consistency) */
  grooveConsistency: number
  /** human-readable gross-error flags (empty when the figure is clean) */
  flags: string[]
}

/** Fraction of notes whose pitch class falls in the key's scale (MusPy scale consistency, computed
 * against the KNOWN key rather than searched). */
export function scaleConsistency(notes: readonly ComposedNote[], key: PhraseKey): number {
  if (notes.length === 0) return 1
  const scale = scalePitchClasses(key)
  const rootPc = ((key.root % 12) + 12) % 12
  let inScale = 0
  for (const n of notes) if (scale.includes((((n.pitch - rootPc) % 12) + 12) % 12)) inScale += 1
  return inScale / notes.length
}

/** Register-rule violations over a chord track: sub-register notes that are not the root/octave or
 * fifth of the chord sounding under them. Empty for a clean sub bass (and for chords/lead, which sit
 * above the register floor). */
export function registerRuleViolations(notes: readonly ComposedNote[], track: ChordTrack): { pitch: number; start: number }[] {
  const out: { pitch: number; start: number }[] = []
  for (const n of notes) {
    const chord = chordAtStep(track, Math.floor(n.start))
    const root = track.key.root - 12 + chord.rootOffset
    if (violatesRegisterRule(n.pitch, root)) out.push({ pitch: n.pitch, start: n.start })
  }
  return out
}

/** Groove consistency: 1 - mean Hamming distance between adjacent bars' 16-slot onset vectors
 * (MusPy). 1 = every bar hits the same slots, 0 = adjacent bars share no onsets. */
export function grooveConsistency(notes: readonly ComposedNote[], bars: number): number {
  if (bars < 2) return 1
  const vecs: boolean[][] = []
  for (let b = 0; b < bars; b++) {
    const v = new Array<boolean>(16).fill(false)
    for (const n of notes) {
      const s = Math.round(n.start)
      if (s >= b * 16 && s < (b + 1) * 16) v[s - b * 16] = true
    }
    vecs.push(v)
  }
  let sum = 0
  let cnt = 0
  for (let i = 1; i < vecs.length; i++) {
    let ham = 0
    for (let j = 0; j < 16; j++) if (vecs[i]![j] !== vecs[i - 1]![j]) ham += 1
    sum += ham / 16
    cnt += 1
  }
  return cnt === 0 ? 1 : 1 - sum / cnt
}

/** Run the three gross-error gates over a figure and its chord track. Thresholds are deliberately
 * loose — only a GROSSLY wrong figure flags (a handful of out-of-key notes is fine, real EDM has
 * chromatic passing tones). Flags, never scores. */
export function lintFigure(notes: readonly ComposedNote[], track: ChordTrack): LintReport {
  const sc = scaleConsistency(notes, track.key)
  const rv = registerRuleViolations(notes, track)
  const gc = grooveConsistency(notes, track.bars)
  const flags: string[] = []
  // 0.70 tolerates intentional chromaticism (a harmonic-minor cadential leading tone is chromatic
  // in natural minor, and real EDM leans on passing tones) — only a GROSSLY out-of-key figure flags
  if (sc < 0.7) flags.push(`scale-consistency ${sc.toFixed(2)} (<0.70: many out-of-key notes)`)
  if (rv.length > 0) flags.push(`register-rule: ${rv.length} sub-register non-root/5th/octave note(s)`)
  if (gc < 0.15) flags.push(`groove-consistency ${gc.toFixed(2)} (<0.15: adjacent bars share almost no onsets)`)
  return { scaleConsistency: sc, registerViolations: rv, grooveConsistency: gc, flags }
}

// ---- public entry point: one theory figure per role -------------------------------------------
// Mirrors showdown.composePitchedPhrase's contract (role, key, seed, exclude) and returns the same
// ComposedPhrase shape, so `theory` slots into the showdown figure-draw machinery beside the
// archetype bank with no change to applyComposedPhrase / the render pipeline. The archetype label is
// prefixed 'theory:' so it shares the per-role exclude chain with the bank/midi labels and can never
// collide with them.

export const THEORY_ROLE_BANKS = {
  bassline: THEORY_BASS_ARCHETYPES,
  chords: THEORY_CHORD_ARCHETYPES,
  lead: THEORY_LEAD_ARCHETYPES,
} as const

const THEORY_ROLE_SALTS = { bassline: 1301, chords: 1487, lead: 1693 } as const

/** The label a theory figure carries in the manifest and the per-role exclude chain. Prefixed
 * 'theory:' so it can never collide with a bank archetype, a 'ca2:' label, or a midi figure label —
 * the raw names genuinely overlap ('offbeat-stabs' and 'motif-repeat' are in the bank's banks too),
 * so the prefix is load-bearing (test/figure-labels.test.ts). */
export const theoryFigureLabel = (name: string): string => `theory:${name}`

/** First archetype of a seeded shuffle not excluded this run (every one used -> seeded pick anyway),
 * through the shared selector in phrase.ts so all four figure sources have ONE implementation of
 * the CLI's per-role exclude-chain contract. */
const chooseTheoryArchetype = (rng: () => number, names: readonly string[], exclude: readonly string[]): string =>
  chooseSeeded(rng, names, theoryFigureLabel, exclude)

/** One 4-bar theory-aware figure for a pitched role, deterministic in `seed`, over a freshly built
 * chord track in `key`. `opts.exclude` lists figure labels already used this run so consecutive
 * batches never repeat a figure (the CLI threads it per role). Returns the ComposedPhrase shape the
 * showdown already consumes; the archetype field is the 'theory:<name>' label. */
export function composeTheoryPhrase(
  role: 'bassline' | 'chords' | 'lead',
  key: PhraseKey,
  seed: number,
  opts: { exclude?: readonly string[]; chordTrack?: ChordTrackOptions } = {},
): ComposedPhrase & { lint: LintReport; chordTrack: ChordTrack } {
  const rng = mulberry32(seed + THEORY_ROLE_SALTS[role])
  const archetype = chooseTheoryArchetype(rng, THEORY_ROLE_BANKS[role], opts.exclude ?? [])
  const track = buildChordTrack(key, seed, opts.chordTrack)
  let notes: ComposedNote[]
  switch (role) {
    case 'bassline':
      notes = composeTheoryBass(archetype, track, seed)
      break
    case 'chords':
      notes = composeTheoryChords(archetype, track, seed)
      break
    default:
      notes = composeTheoryLead(archetype, track, seed)
      break
  }
  if (notes.length === 0) {
    const reg = role === 'bassline' ? -12 : role === 'chords' ? PAD_REGISTER : LEAD_REGISTER
    notes.push({ pitch: degreePitch(key, track.chords[0]!.rootDegree ?? 0, reg), start: 0, duration: 8, velocity: 0.7 })
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  return { archetype: `theory:${archetype}`, notes, lint: lintFigure(notes, track), chordTrack: track }
}
