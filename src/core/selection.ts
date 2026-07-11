// The D2 "pointing" protocol (docs/product-spec-desktop.md §2): an ephemeral, machine-readable
// value for "what the human is pointing at" in the GUI. It is NEVER written to the .beat file —
// it lives in the daemon's memory and rides its own SSE channel — but it IS a first-class format
// citizen with one canonical text form, so an agent can read "bars 8-16 of track drums, lanes
// hat openhat" instead of "the user circled some pixels".
//
// Every axis is an independent FILTER: an absent axis is unfiltered ("all"), a present axis
// narrows. selectionToNoteIds intersects the axes into the concrete note ids they cover — the
// resolution that makes `beat vary --scope selection` possible.
//
// Canonical form (one form per value, like the rest of the format — see format-spec.md):
//
//   selection
//     tracks drums bass
//     lanes drums.hat drums.openhat
//     bars 8 16
//     notes lead.u3 lead.u7
//
// header line `selection`, axis lines indented exactly 2 spaces, axes in that FIXED order, each
// axis line omitted when its axis is absent, entries space-separated. Empty selection = just
// `selection\n`. Parsing rejects out-of-order/duplicate axes to keep the form canonical.

import type { BeatDocument } from './document.js'
import { DRUM_LANES } from './document.js'
import { formatNumber } from './format.js'

/** A lane reference: a drum lane of a specific drum track. */
export interface SelectionLane {
  track: string
  lane: string
}

/** A note reference: a note id scoped to a specific track. */
export interface SelectionNote {
  track: string
  note: string
}

/** An ephemeral pointing value. Every axis optional; an absent axis is an unfiltered "all". */
export interface BeatSelection {
  tracks?: string[]
  lanes?: SelectionLane[]
  bars?: { start: number; end: number }
  notes?: SelectionNote[]
}

export class BeatSelectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatSelectionError'
  }
}

// The canonical axis order. `parseSelection` walks it strictly; `serializeSelection` emits in it.
const AXIS_ORDER = ['tracks', 'lanes', 'bars', 'notes'] as const
type Axis = (typeof AXIS_ORDER)[number]

/** Serialize a selection to its one canonical text form (always ends in a trailing newline). */
export function serializeSelection(sel: BeatSelection): string {
  let out = 'selection\n'
  if (sel.tracks && sel.tracks.length > 0) {
    out += `  tracks ${sel.tracks.join(' ')}\n`
  }
  if (sel.lanes && sel.lanes.length > 0) {
    out += `  lanes ${sel.lanes.map((l) => `${l.track}.${l.lane}`).join(' ')}\n`
  }
  if (sel.bars) {
    out += `  bars ${formatNumber(sel.bars.start)} ${formatNumber(sel.bars.end)}\n`
  }
  if (sel.notes && sel.notes.length > 0) {
    out += `  notes ${sel.notes.map((n) => `${n.track}.${n.note}`).join(' ')}\n`
  }
  return out
}

/** Parse a `dotted` reference token (`track.entry`) into its two halves, failing loudly. */
function parseDotted(token: string, axis: string): { track: string; entry: string } {
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1 || token.indexOf('.', dot + 1) !== -1) {
    throw new BeatSelectionError(`${axis} entry "${token}" must be "track.${axis === 'lanes' ? 'lane' : 'note'}"`)
  }
  return { track: token.slice(0, dot), entry: token.slice(dot + 1) }
}

/** Parse canonical selection text into a BeatSelection. Rejects anything but the one canonical form. */
export function parseSelection(text: string): BeatSelection {
  const lines = text.split('\n')
  // Tolerate a single trailing newline (canonical) but nothing else after it.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length === 0 || lines[0] !== 'selection') {
    throw new BeatSelectionError('selection must begin with a "selection" header line')
  }

  const sel: BeatSelection = {}
  let lastAxisIndex = -1
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!
    if (!raw.startsWith('  ') || raw[2] === ' ') {
      throw new BeatSelectionError(`selection axis line ${i} must be indented exactly 2 spaces`)
    }
    const tokens = raw.slice(2).split(' ')
    const axis = tokens[0] as Axis
    const axisIndex = AXIS_ORDER.indexOf(axis)
    if (axisIndex === -1) throw new BeatSelectionError(`unknown selection axis "${tokens[0]}"`)
    if (axisIndex <= lastAxisIndex) {
      throw new BeatSelectionError(`selection axis "${axis}" is out of order or duplicated (canonical order: ${AXIS_ORDER.join(', ')})`)
    }
    lastAxisIndex = axisIndex
    const entries = tokens.slice(1)
    if (entries.length === 0) throw new BeatSelectionError(`selection axis "${axis}" needs at least one entry`)
    if (entries.some((e) => e === '')) throw new BeatSelectionError(`selection axis "${axis}" has empty entries (single-space separated only)`)

    if (axis === 'tracks') {
      sel.tracks = entries
    } else if (axis === 'lanes') {
      sel.lanes = entries.map((t) => {
        const { track, entry } = parseDotted(t, 'lanes')
        return { track, lane: entry }
      })
    } else if (axis === 'bars') {
      if (entries.length !== 2) throw new BeatSelectionError('bars needs exactly two numbers: start end')
      const start = Number(entries[0])
      const end = Number(entries[1])
      if (!Number.isFinite(start) || !Number.isFinite(end)) throw new BeatSelectionError(`bars expects two numbers, got "${entries.join(' ')}"`)
      sel.bars = { start, end }
    } else {
      sel.notes = entries.map((t) => {
        const { track, entry } = parseDotted(t, 'notes')
        return { track, note: entry }
      })
    }
  }
  return sel
}

const DRUM_LANE_SET: ReadonlySet<string> = new Set(DRUM_LANES)

/**
 * Fail loudly on a selection that doesn't resolve against `doc`: unknown track ids, unknown or
 * non-drum-track lane refs, unknown note ids, or an ill-formed bars window. Tolerant of arbitrary
 * input shape (it also guards a raw JSON POST from the GUI).
 */
export function validateSelection(sel: BeatSelection, doc: BeatDocument): void {
  const trackById = new Map(doc.tracks.map((t) => [t.id, t]))

  if (sel.tracks !== undefined) {
    if (!Array.isArray(sel.tracks)) throw new BeatSelectionError('selection.tracks must be an array of track ids')
    for (const id of sel.tracks) {
      if (!trackById.has(id)) throw new BeatSelectionError(`unknown track "${id}"`)
    }
  }

  if (sel.lanes !== undefined) {
    if (!Array.isArray(sel.lanes)) throw new BeatSelectionError('selection.lanes must be an array of {track, lane}')
    for (const l of sel.lanes) {
      const track = trackById.get(l.track)
      if (!track) throw new BeatSelectionError(`unknown track "${l.track}" in lane ref`)
      if (!DRUM_LANE_SET.has(l.lane)) throw new BeatSelectionError(`unknown drum lane "${l.lane}" (lanes: ${DRUM_LANES.join(', ')})`)
      if (track.kind !== 'drums') throw new BeatSelectionError(`lane ref "${l.track}.${l.lane}" targets a ${track.kind} track — lanes exist only on drum tracks`)
    }
  }

  if (sel.bars !== undefined) {
    const { start, end } = sel.bars
    if (!Number.isFinite(start) || !Number.isFinite(end)) throw new BeatSelectionError('bars start and end must be numbers')
    if (start < 0 || end < 0) throw new BeatSelectionError(`bars must be >= 0, got ${formatNumber(start)} ${formatNumber(end)}`)
    if (!(start < end)) throw new BeatSelectionError(`bars start must be less than end, got ${formatNumber(start)} ${formatNumber(end)}`)
  }

  if (sel.notes !== undefined) {
    if (!Array.isArray(sel.notes)) throw new BeatSelectionError('selection.notes must be an array of {track, note}')
    for (const n of sel.notes) {
      const track = trackById.get(n.track)
      if (!track) throw new BeatSelectionError(`unknown track "${n.track}" in note ref`)
      if (!track.notes.some((note) => note.id === n.note)) {
        throw new BeatSelectionError(`unknown note "${n.note}" on track "${n.track}"`)
      }
    }
  }
}

/**
 * Resolve a selection to the concrete note ids it covers, per track. A note is covered iff:
 *   - its track is in the `tracks` axis (or that axis is absent), AND
 *   - its start lies in [bars.start*16, bars.end*16) steps (or the `bars` axis is absent), AND
 *   - the `notes` axis is absent OR the note is explicitly listed in it.
 * Returns only tracks with >= 1 covered note, in document track order. (The `lanes` axis is about
 * drum lanes, which carry no notes, so it does not participate here.)
 */
export function selectionToNoteIds(sel: BeatSelection, doc: BeatDocument): { track: string; notes: string[] }[] {
  const trackFilter = sel.tracks ? new Set(sel.tracks) : null
  const noteFilter = sel.notes ? new Set(sel.notes.map((n) => `${n.track} ${n.note}`)) : null
  const lo = sel.bars ? sel.bars.start * 16 : null
  const hi = sel.bars ? sel.bars.end * 16 : null

  const out: { track: string; notes: string[] }[] = []
  for (const track of doc.tracks) {
    if (trackFilter && !trackFilter.has(track.id)) continue
    const covered: string[] = []
    for (const note of track.notes) {
      if (lo !== null && (note.start < lo || note.start >= hi!)) continue
      if (noteFilter && !noteFilter.has(`${track.id} ${note.id}`)) continue
      covered.push(note.id)
    }
    if (covered.length > 0) out.push({ track: track.id, notes: covered })
  }
  return out
}
