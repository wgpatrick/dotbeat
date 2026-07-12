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

import type { BeatDocument, BeatNote, BeatTrack } from './document.js'
import { formatNumber } from './format.js'

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
}
export const SCALE_NAMES: readonly string[] = Object.keys(SCALES)

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
      })
    }
  }
  return { doc: replaceTrack(doc, { ...track, notes: [...kept, ...added] }), changed: toConsolidate.length }
}
