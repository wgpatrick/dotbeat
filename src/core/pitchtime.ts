// Pitch & Time operations — Phase 22 Stream AD (docs/research/18-ableton-ui-architecture.md's
// Clip View "Pitch & Time" row: Transpose, Stretch x2/÷2, Fit to Scale, Invert, Humanize,
// Reverse, Legato). Research 18's own recommendation: "Implement each as a CLI/MCP edit primitive
// that rewrites note/hit lines and produces a normal diff — not as clip metadata." That's exactly
// `beat quantize`'s shape (src/core/edit.ts's quantizeNotes) and this file matches it: pure
// document -> document, scoped to a track's notes (optionally narrowed to a `noteIds` selection,
// same vocabulary quantize/humanize already use), rewriting literal `note` lines. Nothing here is
// persisted as clip/track state — these are one-shot operations, not stored fields.
//
// `beat humanize` (src/core/humanize.ts) already covers the panel's "Humanize Amount" row, so
// this file covers the other six: transposeNotes, timeScaleNotes, fitToScaleNotes, invertNotes,
// reverseNotes, legatoNotes — plus consolidateRatchet, the note-ratchet "bake back into discrete
// notes" action (research 22 §3.3's Consolidate menu item), which is the same
// one-shot-rewrite-a-diff shape even though it isn't one of Ableton's six.

import type { BeatDocument, BeatNote, BeatScale, BeatTrack } from './document.js'
import { formatNumber } from './format.js'
// Seeded randomness comes from the ONE generator (CLAUDE.md's guardrail) — never a local copy.
import { mulberry32 } from './rng.js'

const canon = (n: number): number => Number(formatNumber(n))

export class BeatPitchTimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatPitchTimeError'
  }
}

function findNoteTrack(doc: BeatDocument, trackId: string): BeatTrack {
  const t = doc.tracks.find((x) => x.id === trackId)
  if (!t) throw new BeatPitchTimeError(`no track "${trackId}" (have: ${doc.tracks.map((x) => x.id).join(', ')})`)
  if (t.kind === 'drums') throw new BeatPitchTimeError(`track "${trackId}" is a drums track — Pitch & Time operations work on notes, not hits`)
  return t
}

function replaceTrack(doc: BeatDocument, next: BeatTrack): BeatDocument {
  return { ...doc, tracks: doc.tracks.map((t) => (t.id === next.id ? next : t)) }
}

export interface NoteScopeOptions {
  /** Restrict to these note ids (a selection's resolved ids). Omitted = every note on the track. */
  noteIds?: string[]
}

/** Resolves a track's scoped note ids, erroring loudly on any id that doesn't exist — the same
 * "an agent-issued selection that doesn't resolve is a bug worth surfacing" stance
 * quantizeNotes/humanize already take. */
function scopeNoteIds(track: BeatTrack, noteIds?: string[]): Set<string> {
  if (!noteIds) return new Set(track.notes.map((n) => n.id))
  const have = new Set(track.notes.map((n) => n.id))
  const missing = noteIds.filter((id) => !have.has(id))
  if (missing.length) throw new BeatPitchTimeError(`no note(s) ${missing.map((m) => `"${m}"`).join(', ')} on track "${track.id}"`)
  return new Set(noteIds)
}

// ---- Transpose ----------------------------------------------------------------------------

/** Shifts every scoped note's pitch by `semitones` (+/-), clamped to MIDI 0-127 rather than
 * erroring — Ableton's own Transpose clamps out-of-range notes at the ceiling/floor instead of
 * refusing the whole operation. `changed` excludes notes that were already clamped (no-op). */
export function transposeNotes(doc: BeatDocument, trackId: string, semitones: number, opts: NoteScopeOptions = {}): { doc: BeatDocument; changed: number } {
  const track = findNoteTrack(doc, trackId)
  if (!Number.isInteger(semitones)) throw new BeatPitchTimeError(`semitones must be an integer, got ${semitones}`)
  const wanted = scopeNoteIds(track, opts.noteIds)
  let changed = 0
  const notes = track.notes.map((n) => {
    if (!wanted.has(n.id)) return n
    const pitch = Math.max(0, Math.min(127, n.pitch + semitones))
    if (pitch === n.pitch) return n
    changed++
    return { ...n, pitch }
  })
  return { doc: replaceTrack(doc, { ...track, notes }), changed }
}

// ---- Time-scale (the Stretch knob's x2/÷2 buttons, generalized to any positive factor) ------

/** Scales every scoped note's start/duration by `factor` (2 = Ableton's x2 "Stretch" button, 0.5
 * = ÷2), anchored at the EARLIEST scoped note's start so a selected phrase stretches in place
 * rather than sliding away from the loop start. */
export function timeScaleNotes(doc: BeatDocument, trackId: string, factor: number, opts: NoteScopeOptions = {}): { doc: BeatDocument; changed: number } {
  const track = findNoteTrack(doc, trackId)
  if (!Number.isFinite(factor) || factor <= 0) throw new BeatPitchTimeError(`factor must be > 0, got ${factor}`)
  const wanted = scopeNoteIds(track, opts.noteIds)
  const scoped = track.notes.filter((n) => wanted.has(n.id))
  if (scoped.length === 0) return { doc, changed: 0 }
  const anchor = Math.min(...scoped.map((n) => n.start))
  let changed = 0
  const notes = track.notes.map((n) => {
    if (!wanted.has(n.id)) return n
    const start = canon(anchor + (n.start - anchor) * factor)
    const duration = canon(n.duration * factor)
    if (duration <= 0) throw new BeatPitchTimeError(`factor ${factor} would collapse note "${n.id}" to zero duration`)
    if (start === n.start && duration === n.duration) return n
    changed++
    return { ...n, start, duration }
  })
  return { doc: replaceTrack(doc, { ...track, notes }), changed }
}

// ---- Fit to Scale -----------------------------------------------------------------------------

/** A deliberately small, useful scale table (pitch classes, root-relative) — not exhaustive, but
 * covers the common modes plus the two pentatonics and blues. `root` is a pitch class 0-11 (0=C). */
export const SCALES: Readonly<Record<string, readonly number[]>> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10], // natural minor (Aeolian)
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  // ---- v0.12 (Phase 41 Stream E): the two THIRD-LESS sets. Every scale above this line contains
  // either a minor third (3) or a major third (4) — i.e. every one of them commits the melody to
  // major or minor. A large, coherent lane of music (the suspended/modal sound: sus2, sus4, add9,
  // ♭7) is defined by NOT making that commitment, and against that harmony both thirds read as
  // wrong notes. The motivating measurement, taken off a reference track's own chroma: with the
  // tonic established at r=0.865/0.890 (Krumhansl-Schmuckler, harmonic and bass stems), the two
  // thirds were the two RAREST pitch classes in the track (4/40 and 9/40 weight) while the colour
  // tones dominated — tonic 40, fifth 34, second 21, fourth 17, ♭seventh 15. Normalized to the
  // root that is exactly {0, 2, 5, 7, 10}, which is `susPentatonic` below: not an invented set, a
  // transcribed one. (It is a real named mode — the second mode of the major pentatonic, also
  // called Egyptian — which is why it earns a table entry rather than needing the `custom` form.)
  susPentatonic: [0, 2, 5, 7, 10], // no third at all: root, 2nd, 4th, 5th, ♭7 — the sus/modal core
  susHexatonic: [0, 2, 5, 7, 9, 10], // the same, plus the 6th — a little more melodic room, still third-less
}
export const SCALE_NAMES: readonly string[] = Object.keys(SCALES)

/** The literal `name` a BeatScale uses when its pitch classes are given explicitly rather than
 * looked up in SCALES. Not a key of SCALES (deliberately — a lookup must never silently succeed
 * for it). */
export const CUSTOM_SCALE_NAME = 'custom'

/** The root-relative pitch classes of a scale name, or undefined for an unknown name. `custom` is
 * NOT resolvable here by design — it has no table entry; use `resolveScalePitchClasses` with the
 * full BeatScale (which carries its own explicit set) instead. */
export function scaleByName(name: string): readonly number[] | undefined {
  return SCALES[name]
}

/** Canonicalizes an explicit pitch-class set: deduplicated, ascending, every entry an integer
 * 0-11, and containing 0 (see BeatScale's comment — a scale without its own root is a mistake).
 * Throws BeatPitchTimeError rather than silently repairing, the same loud-failure stance the rest
 * of the format takes. Exported so parse/edit/GUI all canonicalize identically. */
export function canonicalPitchClasses(pcs: readonly number[]): number[] {
  if (pcs.length === 0) throw new BeatPitchTimeError('a custom scale needs at least one pitch class')
  for (const p of pcs) {
    if (!Number.isInteger(p) || p < 0 || p > 11) throw new BeatPitchTimeError(`custom scale pitch classes must be integers 0-11 (root-relative), got ${p}`)
  }
  const out = [...new Set(pcs)].sort((a, b) => a - b)
  if (!out.includes(0)) throw new BeatPitchTimeError(`a custom scale must contain 0 (its own root), got ${out.join(',')}`)
  return out
}

/** THE one resolver every surface uses to turn a stored BeatScale into the pitch-class set it
 * means — CLI, MCP, daemon, and the piano roll's row shading all call this rather than re-deriving
 * it (the house "parity is structural, never disciplinary" rule). Returns root-relative classes;
 * pair with `isPitchInScale` to test an absolute MIDI pitch. */
export function resolveScalePitchClasses(scale: BeatScale): readonly number[] {
  if (scale.name === CUSTOM_SCALE_NAME) {
    if (!scale.pitchClasses) throw new BeatPitchTimeError('a custom scale must carry explicit pitchClasses')
    return scale.pitchClasses
  }
  const table = SCALES[scale.name]
  if (!table) throw new BeatPitchTimeError(`unknown scale "${scale.name}" (have: ${SCALE_NAMES.join(', ')}, ${CUSTOM_SCALE_NAME})`)
  return table
}

/** Whether an absolute MIDI pitch is in `scale`. The single predicate the piano roll's row shading
 * AND its note-entry lock both call, so "shaded" and "allowed" can never drift apart — a lock that
 * disagreed with its own highlighting would be worse than no lock. */
export function isPitchInScale(pitch: number, scale: BeatScale): boolean {
  const pcs = resolveScalePitchClasses(scale)
  return pcs.includes((((pitch - scale.root) % 12) + 12) % 12)
}

/** Whether a scale contains either third (minor=3 or major=4) relative to its root. Exposed
 * because "does this scale commit me to major or minor" is the question the sus/modal case is
 * actually asking, and the GUI labels a third-less scale as such. */
export function scaleHasThird(scale: BeatScale): boolean {
  const pcs = resolveScalePitchClasses(scale)
  return pcs.includes(3) || pcs.includes(4)
}

/** The nearest in-scale pitch to `pitch` (searching outward in both directions at once); ties
 * (equal distance up and down) resolve to the LOWER pitch — an arbitrary but deterministic and
 * documented rule, same "one canonical outcome" discipline the rest of the format uses. */
function nearestScaleTone(pitch: number, root: number, scale: readonly number[]): number {
  const inScale = (p: number) => scale.includes(((p - root) % 12 + 12) % 12)
  for (let d = 0; d <= 127; d++) {
    const down = pitch - d
    const up = pitch + d
    const downOk = down >= 0 && inScale(down)
    const upOk = up <= 127 && inScale(up)
    if (downOk) return down // down is checked first, so an equal-distance tie prefers it
    if (upOk) return up
  }
  return pitch // unreachable for any non-empty scale (chromatic always matches within 1 step)
}

/** Snaps every scoped note's pitch to the nearest tone in `root`/`scaleName` (Ableton's "Fit to
 * Scale"). `root` is a pitch class 0-11 (0=C, 1=C#, ...). */
export function fitToScaleNotes(doc: BeatDocument, trackId: string, root: number, scaleName: string, opts: NoteScopeOptions = {}): { doc: BeatDocument; changed: number } {
  const track = findNoteTrack(doc, trackId)
  if (!Number.isInteger(root) || root < 0 || root > 11) throw new BeatPitchTimeError(`root must be an integer pitch class 0-11 (0=C), got ${root}`)
  const scale = SCALES[scaleName]
  if (!scale) throw new BeatPitchTimeError(`unknown scale "${scaleName}" (have: ${SCALE_NAMES.join(', ')})`)
  const wanted = scopeNoteIds(track, opts.noteIds)
  let changed = 0
  const notes = track.notes.map((n) => {
    if (!wanted.has(n.id)) return n
    const pitch = nearestScaleTone(n.pitch, root, scale)
    if (pitch === n.pitch) return n
    changed++
    return { ...n, pitch }
  })
  return { doc: replaceTrack(doc, { ...track, notes }), changed }
}

// ---- Invert (pitch mirror) ---------------------------------------------------------------------

/** Mirrors every scoped note's pitch around `axis` (a MIDI pitch): newPitch = 2*axis - pitch,
 * clamped to 0-127. When `axis` is omitted, defaults to the (rounded) mean pitch of the scoped
 * notes — Ableton's Invert has no separate axis control; it inverts around the selection's own
 * center, which this mirrors while still allowing an explicit axis for anything else. */
export function invertNotes(doc: BeatDocument, trackId: string, axis: number | undefined, opts: NoteScopeOptions = {}): { doc: BeatDocument; changed: number } {
  const track = findNoteTrack(doc, trackId)
  const wanted = scopeNoteIds(track, opts.noteIds)
  const scoped = track.notes.filter((n) => wanted.has(n.id))
  if (scoped.length === 0) return { doc, changed: 0 }
  if (axis !== undefined && !Number.isFinite(axis)) throw new BeatPitchTimeError(`axis must be a finite pitch, got ${axis}`)
  const resolvedAxis = axis ?? scoped.reduce((sum, n) => sum + n.pitch, 0) / scoped.length
  let changed = 0
  const notes = track.notes.map((n) => {
    if (!wanted.has(n.id)) return n
    const pitch = Math.max(0, Math.min(127, Math.round(2 * resolvedAxis - n.pitch)))
    if (pitch === n.pitch) return n
    changed++
    return { ...n, pitch }
  })
  return { doc: replaceTrack(doc, { ...track, notes }), changed }
}

// ---- Reverse (tape-reverse the scoped span) -----------------------------------------------------

/** Reverses playback order within the scoped notes' own time span (a tape reverse, not just
 * flipping start points): each note's [start, start+duration) interval is reflected around the
 * span's midpoint, so a note that used to end at the span's edge now starts there. Durations are
 * unchanged; only positions flip. */
export function reverseNotes(doc: BeatDocument, trackId: string, opts: NoteScopeOptions = {}): { doc: BeatDocument; changed: number } {
  const track = findNoteTrack(doc, trackId)
  const wanted = scopeNoteIds(track, opts.noteIds)
  const scoped = track.notes.filter((n) => wanted.has(n.id))
  if (scoped.length === 0) return { doc, changed: 0 }
  const spanStart = Math.min(...scoped.map((n) => n.start))
  const spanEnd = Math.max(...scoped.map((n) => n.start + n.duration))
  let changed = 0
  const notes = track.notes.map((n) => {
    if (!wanted.has(n.id)) return n
    const start = canon(spanStart + spanEnd - (n.start + n.duration))
    if (start === n.start) return n
    changed++
    return { ...n, start }
  })
  return { doc: replaceTrack(doc, { ...track, notes }), changed }
}

// ---- Legato (extend each note to the next note's start) ------------------------------------

/** Extends (or shortens) each scoped note's duration to reach the NEXT scoped note's start
 * (Ableton's Legato) — closing gaps and removing overlaps within the selection, ordered by start
 * time regardless of pitch (matching Ableton's own simple time-ordered behavior, not a per-pitch-
 * voice version). `gap` (steps, default 0) leaves a small silence before the next note instead of
 * touching it exactly. The last scoped note (nothing to extend to) is left alone. A pair that
 * would collapse to <= 0 duration is left unchanged rather than corrupted. */
export function legatoNotes(doc: BeatDocument, trackId: string, opts: NoteScopeOptions & { gap?: number } = {}): { doc: BeatDocument; changed: number } {
  const track = findNoteTrack(doc, trackId)
  const gap = opts.gap ?? 0
  if (!Number.isFinite(gap) || gap < 0) throw new BeatPitchTimeError(`gap must be >= 0, got ${gap}`)
  const wanted = scopeNoteIds(track, opts.noteIds)
  const scoped = track.notes.filter((n) => wanted.has(n.id)).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
  const nextDuration = new Map<string, number>()
  for (let i = 0; i < scoped.length - 1; i++) {
    const cur = scoped[i]!
    const next = scoped[i + 1]!
    const duration = canon(next.start - cur.start - gap)
    if (duration > 0) nextDuration.set(cur.id, duration)
  }
  let changed = 0
  const notes = track.notes.map((n) => {
    const duration = nextDuration.get(n.id)
    if (duration === undefined || duration === n.duration) return n
    changed++
    return { ...n, duration }
  })
  return { doc: replaceTrack(doc, { ...track, notes }), changed }
}

// ---- Velocity shaping: Ramp and Randomize (Phase 41 Stream E) ---------------------------------
//
// The motivating case is a loop that repeats: a 4-bar melody played for 242 bars is the same eight
// notes 60 times, and uniform velocity is what makes that read as a loop rather than a part.
// humanize.ts already offers seeded Gaussian JITTER, which is the "randomize" half; there was no
// DETERMINISTIC shaped half at all — no way to say "get louder across this phrase", which is the
// single most common velocity edit there is.
//
// Deliberately NOT a breakpoint envelope: that is its own roadmap row with its own GUI widget. This
// is the two-endpoint case, which covers crescendo/decrescendo and costs a line of math.

/** THE ramp formula, shared by the CLI/MCP path and the piano roll's own toolbar (which computes
 * it client-side to paint the velocity lane in the same gesture — ui/ has no build-time dependency
 * on src/core, so it mirrors this and test/velocity-ramp-parity.test.ts pins both against the same
 * expected values). Position `i` of `n` maps linearly from `from` to `to`; a single note takes
 * `to`, the phrase's destination, since "ramp to 0.9" on one note plainly means 0.9. */
export function rampVelocityAt(from: number, to: number, i: number, n: number): number {
  if (n <= 1) return to
  return from + (to - from) * (i / (n - 1))
}

/** Linearly ramps the scoped notes' velocities from `from` to `to`, ordered by START TIME (ties by
 * id, the same total order legatoNotes uses) — a ramp is a statement about the phrase's shape in
 * time, so two notes in a chord at the same start get adjacent ramp positions rather than one
 * being arbitrarily skipped. Both endpoints are 0..1, the same unit `velocity` always uses. */
export function rampVelocity(doc: BeatDocument, trackId: string, from: number, to: number, opts: NoteScopeOptions = {}): { doc: BeatDocument; changed: number } {
  const track = findNoteTrack(doc, trackId)
  for (const [label, v] of [['from', from], ['to', to]] as const) {
    if (!Number.isFinite(v) || v < 0 || v > 1) throw new BeatPitchTimeError(`${label} must be a velocity 0..1, got ${v}`)
  }
  const wanted = scopeNoteIds(track, opts.noteIds)
  const ordered = track.notes.filter((n) => wanted.has(n.id)).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
  if (ordered.length === 0) return { doc, changed: 0 }
  const target = new Map<string, number>()
  ordered.forEach((n, i) => target.set(n.id, canon(rampVelocityAt(from, to, i, ordered.length))))
  let changed = 0
  const notes = track.notes.map((n) => {
    const velocity = target.get(n.id)
    if (velocity === undefined || velocity === n.velocity) return n
    changed++
    return { ...n, velocity }
  })
  return { doc: replaceTrack(doc, { ...track, notes }), changed }
}

/** Randomizes the scoped notes' velocities by up to +/-`amount` (0..1), seeded so the same seed
 * over the same notes always produces the same result — reproducibility is the whole reason this
 * isn't `Math.random()`, and it is what lets a variation be re-derived rather than stored.
 *
 * Draws come from src/core/rng.ts's mulberry32, the ONE generator (CLAUDE.md's own rule), and are
 * consumed in a fixed order — notes sorted by (start, id) — so adding a note later in the phrase
 * cannot shift every earlier note's draw. Results clamp to 0..1 rather than wrapping. */
export function randomizeVelocity(doc: BeatDocument, trackId: string, amount: number, opts: NoteScopeOptions & { seed?: number } = {}): { doc: BeatDocument; changed: number } {
  const track = findNoteTrack(doc, trackId)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1) throw new BeatPitchTimeError(`amount must be > 0 and <= 1, got ${amount}`)
  const wanted = scopeNoteIds(track, opts.noteIds)
  const ordered = track.notes.filter((n) => wanted.has(n.id)).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
  if (ordered.length === 0) return { doc, changed: 0 }
  const rng = mulberry32(opts.seed ?? 1)
  const target = new Map<string, number>()
  for (const n of ordered) {
    const delta = (rng() * 2 - 1) * amount
    target.set(n.id, canon(Math.max(0, Math.min(1, n.velocity + delta))))
  }
  let changed = 0
  const notes = track.notes.map((n) => {
    const velocity = target.get(n.id)
    if (velocity === undefined || velocity === n.velocity) return n
    changed++
    return { ...n, velocity }
  })
  return { doc: replaceTrack(doc, { ...track, notes }), changed }
}

// ---- Ratchet consolidate (research 22 §3.3's "Consolidate" menu action) ------------------------

/** The spacing/length of one ratchet repeat within its note's own duration — the SAME shape
 * consolidateRatchet (below) and the live engine (ui/src/audio/engine.ts, hand-mirrored per the
 * house convention documented there) must agree on, so a ratchet consolidates into exactly the
 * notes it would have sounded like. `curve` (-1..1) shapes repeat spacing: 0 = even; positive
 * bunches repeats toward the START of the note (front-loaded, faster then slower); negative
 * bunches them toward the END (back-loaded, slower then faster) — an exponent warp on the
 * repeat-index fenceposts, continuous through 1 (even) at curve=0. `repeatLength` (0..1] is each
 * repeat's sounding length as a fraction of its own slot (1 = fills the slot, legato-style
 * ratchet; < 1 leaves a gap, a staccato stutter). */
export function ratchetSlots(count: number, curve: number, repeatLength: number, noteDuration: number): { start: number; duration: number }[] {
  if (count <= 1) return [{ start: 0, duration: noteDuration }]
  // k=1 at curve=0 (even fenceposts); k>1 bunches early indices together (front-loaded), k<1
  // bunches late indices together (back-loaded) — continuous, invertible-in-spirit exponent warp.
  const k = curve >= 0 ? 1 + curve * 3 : 1 / (1 - curve * 3)
  const edges: number[] = []
  for (let i = 0; i <= count; i++) edges.push(Math.pow(i / count, k) * noteDuration)
  const slots: { start: number; duration: number }[] = []
  for (let i = 0; i < count; i++) {
    const slotStart = edges[i]!
    const slotSpan = edges[i + 1]! - slotStart
    slots.push({ start: slotStart, duration: Math.max(0.001, slotSpan * repeatLength) })
  }
  return slots
}

/** Bakes every scoped ratcheted note (ratchetCount > 1) back into `ratchetCount` discrete, plain
 * notes (research 22 §3.3's Consolidate action) — the inverse of setting ratchetCount. Scoped
 * notes that aren't ratcheted (ratchetCount === 1) are left alone (not an error, same
 * "already-at-rest is a no-op" stance quantize takes for on-grid notes). Each resulting note
 * copies pitch/velocity/chance/cent from the source and mints a fresh `u<n>` id (same minting
 * scheme addNote uses); the source note is removed. */
export function consolidateRatchet(doc: BeatDocument, trackId: string, opts: NoteScopeOptions = {}): { doc: BeatDocument; changed: number } {
  const track = findNoteTrack(doc, trackId)
  const wanted = scopeNoteIds(track, opts.noteIds)
  const toConsolidate = track.notes.filter((n) => wanted.has(n.id) && n.ratchetCount > 1)
  if (toConsolidate.length === 0) return { doc, changed: 0 }

  let nextIdNum = 100000
  for (const t of doc.tracks) for (const n of t.notes) {
    const m = n.id.match(/^u(\d+)$/)
    if (m) nextIdNum = Math.max(nextIdNum, Number(m[1]))
  }

  const consolidatedIds = new Set(toConsolidate.map((n) => n.id))
  const kept = track.notes.filter((n) => !consolidatedIds.has(n.id))
  const added: BeatNote[] = []
  for (const n of toConsolidate) {
    for (const slot of ratchetSlots(n.ratchetCount, n.ratchetCurve, n.ratchetLength, n.duration)) {
      nextIdNum++
      added.push({
        id: `u${nextIdNum}`,
        pitch: n.pitch,
        start: canon(n.start + slot.start),
        duration: canon(slot.duration),
        velocity: n.velocity,
        chance: n.chance,
        cent: n.cent,
        ratchetCount: 1,
        ratchetCurve: 0,
        ratchetLength: 1,
        // v0.12: consolidating a MUTED ratchet yields muted notes — the mute is a property of the
        // musical decision, not of the ratchet, so baking must not silently un-mute it.
        active: n.active,
      })
    }
  }
  return { doc: replaceTrack(doc, { ...track, notes: [...kept, ...added] }), changed: toConsolidate.length }
}
