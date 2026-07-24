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

import { scalePitchClasses, degreePitch, type PhraseKey, type ScaleMode, type ComposedNote, type ComposedPhrase } from './showdown.js'
import { mulberry32 } from './eval.js'

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

export interface ChordTrackOptions {
  /** total bars (default 4 — a showdown clip) */
  bars?: number
  /** force the mode; default derives natural-minor/major from the picked progression's tonality */
  mode?: ScaleMode
  /** force parallel-planing on/off; default is a seeded ~15% chance for minor keys */
  planing?: boolean
  /** force the harmonic rhythm (1 or 2); default is a seeded weighted pick favouring held chords */
  barsPerChord?: number
  /** add sevenths to every diatonic chord's tone content (m7 colour); default false */
  sevenths?: boolean
  /** enable position-conditional harmonic-minor V cadence substitution at the phrase end
   * (default true for minor keys) */
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
  const mode: ScaleMode = opts.mode ?? (key.minor ? 'natural-minor' : 'major')
  const trackKey: PhraseKey = { ...key, mode }
  // harmonic rhythm: 1 or 2 bars per chord — never a hardcoded always-one-per-bar (§C.1). Held
  // (2-bar) chords are the trance-breakdown norm, so weight toward them.
  const barsPerChord = opts.barsPerChord ?? (rng() < 0.55 ? 2 : 1)
  const planing = opts.planing ?? (key.minor && rng() < 0.15)
  const sevenths = opts.sevenths ?? false
  const cadence = opts.cadence ?? key.minor

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
  // positions). At the LAST chord, borrow the harmonic-minor V — raise the chord's third to the
  // leading tone — turning a weak minor v into the strongest possible pull home. If the final
  // diatonic chord is not already the v, substitute one in (root = degree 4, raised third).
  if (cadence && !planing && chords.length > 0) {
    const last = chords[chords.length - 1]!
    const vTones = diatonicTones(trackKey, 4, sevenths)
    vTones[1] = vTones[1]! + 1 // raise the third: b7 (subtonic) -> leading tone
    chords[chords.length - 1] = { ...last, rootDegree: 4, rootOffset: vTones[0]!, tones: vTones, cadential: true }
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
 * Applied to offbeat 16ths as a fractional-step delay: shift = 2*(pct/100) - 1 steps. */
const STUSSY_SWING_PCT = 57
const swingShiftSteps = (pct: number): number => rnd2(2 * (pct / 100) - 1)

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

function tranceRoller(ctx: BassContext): ComposedNote[] {
  // Myloops uplifting-trance rolling bass: kick on quarters, bass on the 16th offbeats "e-&-a" of
  // every beat (12 notes/bar), all chord root, cut short (~40 ms decay -> ~0.5-step gate), -8..-12
  // velocity on the "&"s.
  const notes: ComposedNote[] = []
  for (let bar = 0; bar < ctx.track.bars; bar++) {
    for (const beat of [0, 4, 8, 12]) {
      for (const k of [1, 2, 3]) {
        const step = bar * 16 + beat + k
        const root = bassRootAt(ctx, step)
        const isAnd = k === 2 // the "&" — the 8th offbeat
        notes.push({ pitch: root, start: step, duration: 0.5, velocity: clampVel(isAnd ? 0.72 : 0.82) })
      }
    }
  }
  return notes
}

function stussy(ctx: BassContext): ComposedNote[] {
  // The tech-house "Stussy 3-note pattern" (§C.2, the producer's school): pitch set 1-5-8 (root,
  // fifth, octave) or 1-b3-5; tonic on slots 1/9 (steps 0/8), fifth on 5/13 (steps 4/12), octave on
  // 7/15 (steps 6/14), quiet tonic fillers elsewhere; gate 60% on downbeats / 90-100% offbeats;
  // velocities ~110/90/75 (of 127); swing 56-58%; a one-change-per-bar variation schedule.
  const useMinorThird = ctx.rng() < 0.4 // the 1-b3-5 colour variant
  const swing = swingShiftSteps(STUSSY_SWING_PCT)
  const notes: ComposedNote[] = []
  const add = (step: number, interval: number, gate: number, v: number): void => {
    const root = bassRootAt(ctx, step)
    // a b3 in the sub register is lifted an octave by enforceBassRegister below (register rule)
    const pitch = enforceBassRegister(root + interval, root)
    const start = step % 2 === 1 ? step + swing : step // swing the offbeat 16ths
    notes.push({ pitch, start: rnd2(start), duration: gate, velocity: clampVel(v) })
  }
  const OCT = 12
  const FIFTH = 7
  const B3 = 3
  for (let bar = 0; bar < ctx.track.bars; bar++) {
    const o = bar * 16
    const barIx = bar % 4 // the schedule is a 4-bar cycle
    // strong slots
    add(o + 0, 0, 0.6, 0.87) // tonic on the downbeat (with the kick), short gate
    add(o + 8, 0, 0.6, 0.87)
    add(o + 4, FIFTH, 0.95, 0.71) // fifth, offbeat, long gate
    add(o + 12, FIFTH, 0.95, 0.71)
    // octave slots (steps 6/14) — bar 2 turns slot-7 (step 6) octave into a tonic; bar 3 skips
    // slot 14; the b3 variant swaps the octave colour for a raised minor third
    const octInterval = useMinorThird ? B3 : OCT
    if (barIx === 1) add(o + 6, 0, 0.95, 0.59) // octave -> tonic
    else add(o + 6, octInterval, 0.95, 0.59)
    if (barIx !== 2) add(o + 14, octInterval, 0.95, 0.59) // bar 3 skips slot 14
    // quiet tonic fillers on the remaining offbeat 16ths
    for (const step of [2, 10]) add(o + step, 0, 0.9, 0.47)
  }
  return notes
}

function offbeatRoot(ctx: BassContext): ComposedNote[] {
  // root on the offbeat 8ths (between the kicks), root + an occasional octave lift — register safe
  const notes: ComposedNote[] = []
  for (let bar = 0; bar < ctx.track.bars; bar++) {
    for (const s of [2, 6, 10, 14]) {
      const step = bar * 16 + s
      const root = bassRootAt(ctx, step)
      const oct = s === 14 && ctx.rng() < 0.4 ? 12 : 0
      notes.push({ pitch: root + oct, start: step, duration: 2, velocity: clampVel(0.8) })
    }
  }
  return notes
}

function subPulse(ctx: BassContext): ComposedNote[] {
  // sparse sub with breathing space (§C.2 DnB posture): long roots, an octave tail — root/octave only
  const notes: ComposedNote[] = []
  for (let bar = 0; bar < ctx.track.bars; bar++) {
    const o = bar * 16
    const root = bassRootAt(ctx, o)
    notes.push({ pitch: root, start: o, duration: 6, velocity: clampVel(0.9) })
    notes.push({ pitch: root, start: o + 10, duration: 3, velocity: clampVel(0.72) })
    if (bar % 2 === 1 && ctx.rng() < 0.5) notes.push({ pitch: root + 12, start: o + 14, duration: 2, velocity: clampVel(0.6) })
  }
  return notes
}

function octaveDrive(ctx: BassContext): ComposedNote[] {
  // bass-as-lead: 8th-note root/octave alternation (§C.2), register safe by construction
  const notes: ComposedNote[] = []
  for (let bar = 0; bar < ctx.track.bars; bar++) {
    for (let s = 0; s < 16; s += 2) {
      const step = bar * 16 + s
      const root = bassRootAt(ctx, step)
      const high = (s / 2) % 2 === 1
      notes.push({ pitch: high ? root + 12 : root, start: step, duration: 1, velocity: clampVel(high ? 0.62 : 0.82) })
    }
  }
  return notes
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

/** One theory-aware chord figure over a chord track: a per-chord voicing chosen by minimal-motion
 * voice-leading, rendered with the archetype's rhythm and honouring the track's harmonic rhythm (the
 * voicing changes only at chord boundaries, never re-drawn per bar). Deterministic in `seed`. */
export function composeTheoryChords(archetype: string, track: ChordTrack, seed: number): ComposedNote[] {
  const rng = mulberry32(seed + 1487)
  const style = CHORD_STYLES[Math.floor(rng() * CHORD_STYLES.length)]!
  const notes: ComposedNote[] = []
  let prev: number[] | null = null
  for (const chord of track.chords) {
    const voicing = chooseVoicing(track.key, chord, style, prev)
    prev = voicing
    const o = chord.startBar * 16
    const len = chord.bars * 16
    const stack = (start: number, duration: number, v: number): void => {
      for (const pitch of voicing) notes.push({ pitch, start, duration, velocity: clampVel(v) })
    }
    switch (archetype) {
      case 'lush-pad':
        stack(o, len - (rng() < 0.3 ? 2 : 0), 0.6)
        break
      case 'offbeat-stabs':
        for (let s = 2; s < len; s += 4) stack(o + s, rng() < 0.5 ? 1 : 2, 0.62)
        break
      case 'house-pulse':
        for (let s = 0; s < len; s += 2) {
          if (s % 16 === 14 && rng() < 0.3) continue // seeded breath before a barline
          stack(o + s, 1, s % 8 === 0 ? 0.7 : 0.52)
        }
        break
      default: {
        // charleston: a downbeat hit + a syncopated "and", per bar of the chord's span
        for (let b = 0; b < chord.bars; b++) {
          const bo = o + b * 16
          stack(bo, 3, 0.66)
          stack(bo + 6, 2, 0.55)
          if (rng() < 0.4) stack(bo + 12, 2, 0.5)
        }
        break
      }
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  return notes
}
