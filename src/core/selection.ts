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
// AXIS SEMANTICS — DECIDED (was docs/product-spec-desktop.md §7 open question "does bars 8 16
// with no tracks mean all tracks?"; answer is yes, and it generalizes to every axis, not just
// tracks). Resolved 2026-07-11 in docs/phase-9-selection-vary-plan.md; this is now settled
// product behavior, not a live question — don't re-litigate it as open in future spec edits.
//
//   - Each of {tracks, lanes, bars, notes} is independently optional.
//   - An ABSENT axis matches everything on that axis (unfiltered) — it is not "nothing".
//     `{ bars: { start: 8, end: 16 } }` with no `tracks` key = bars 8-16 across every track.
//   - A PRESENT axis narrows to exactly its listed entries (or window, for bars).
//   - Multiple present axes AND together (intersection), not OR: `{ tracks: ['lead'], bars: ... }`
//     means lead's notes AND within that bar window, not lead's notes OR that bar window.
//   - The wholly-empty selection `{}` therefore means "everything, unfiltered on every axis" —
//     which in practice reads the same as "no selection is scoping this operation", i.e. an
//     operation falls back to its own default (whole document / whole track). This is why the
//     daemon and CLI display `{}` as "no selection": not a different code path, just the
//     degenerate case of "every axis absent".
//   - `lanes` and `notes` are themselves scoped to a `track` per entry (`SelectionLane`/
//     `SelectionNote`), so they narrow per-track even when the `tracks` axis is absent.
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

/** A note reference: a note (or, for a drum track, a hit) id scoped to a specific track. */
export interface SelectionNote {
  track: string
  note: string
}

/** An ephemeral pointing value. Every axis optional; an absent axis is an unfiltered "all" — see
 * the AXIS SEMANTICS note at the top of this file for the full (now-decided) resolution rules. */
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
      // Drum tracks carry hits, not notes (BeatTrack.notes is always [] for kind 'drums') — the
      // `notes` axis is the one place the grammar names individual events, so on a drum track it
      // addresses hit ids instead. Same axis, same wire form (`track.id`), track-kind-dependent pool.
      const pool = track.kind === 'drums' ? track.hits : track.notes
      if (!pool.some((e) => e.id === n.note)) {
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

/** What `beat vary --scope selection` resolves down to: exactly the shapes vary/humanize already
 * accept (`FeelVaryOptions.lanes` / `.ids` in src/vary/vary.ts) — no vary/humanize code needed to
 * change for the wiring, only the CLI glue that calls this and passes the result straight through. */
export interface VaryScope {
  lanes?: string[]
  ids?: string[]
}

/**
 * Resolve a selection into a vary/humanize scope for ONE target track — the pure resolution
 * behind `beat vary --scope selection` (docs/phase-9-selection-vary-plan.md). Uses the axis
 * semantics above: an absent axis is unfiltered, present axes intersect.
 *
 *   - `tracks`, `lanes`, and `notes` each name a track per entry (`lanes`/`notes` entries carry
 *     their own `track` field). If ANY of the three is present, their track names are unioned
 *     into "the tracks this selection is about" — if that union is non-empty and excludes
 *     `trackId`, this throws: the selection points at a different track/region entirely (the
 *     guard `beat vary --scope selection` needs so it never silently varies the wrong track).
 *     A selection with none of the three present (only `bars`, or fully empty) is about every
 *     track equally, per the axis semantics above.
 *   - once `trackId` clears that gate: if `lanes` has entries for `trackId` (drum tracks only)
 *     and nothing else narrows further (no `bars`, no `notes`) -> passed straight through as
 *     `{ lanes }`, vary's own `--lanes`.
 *   - otherwise, if anything narrows this track's events (a `bars` window, an explicit `notes`
 *     list, or `lanes` combined with `bars`/`notes`) -> resolved to concrete event ids (hits for
 *     drum tracks, notes for synth/instrument tracks), intersecting whichever of {lanes, bars,
 *     notes} are present — generalizes selectionToNoteIds's intersection rule to hits and lanes.
 *   - nothing at all narrows this track beyond the gate above (e.g. `{}`, or `{ tracks: [id] }`
 *     naming it with nothing more specific) -> `{}`, i.e. no scope, the whole track — vary's own
 *     default when no scope is given.
 *   - the selection IS non-empty but resolves to zero ids/lanes on this track (a bars window with
 *     no events in it, or a `notes` list that names `trackId` but lists none of its actual events)
 *     -> throws.
 */
export function selectionToVaryScope(sel: BeatSelection, doc: BeatDocument, trackId: string): VaryScope {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatSelectionError(`no track "${trackId}" (have: ${doc.tracks.map((t) => t.id).join(', ')})`)

  const hasTracks = sel.tracks !== undefined
  const hasLanes = sel.lanes !== undefined
  const hasNotes = sel.notes !== undefined
  const hasBars = sel.bars !== undefined

  if (hasTracks || hasLanes || hasNotes) {
    const involved = new Set<string>()
    if (hasTracks) for (const t of sel.tracks!) involved.add(t)
    if (hasLanes) for (const l of sel.lanes!) involved.add(l.track)
    if (hasNotes) for (const n of sel.notes!) involved.add(n.track)
    if (!involved.has(trackId)) {
      throw new BeatSelectionError(`selection does not cover track "${trackId}" (selection covers: ${[...involved].join(', ')})`)
    }
  }

  const lanesForTrack = hasLanes ? sel.lanes!.filter((l) => l.track === trackId).map((l) => l.lane) : []

  // Nothing narrows this track any further than the tracks-axis gate above -> whole track.
  if (!hasBars && !hasNotes && lanesForTrack.length === 0) return {}

  // Pure lane scope: nothing else narrows it further, so it passes straight through.
  if (lanesForTrack.length > 0 && !hasBars && !hasNotes) {
    if (track.kind !== 'drums') throw new BeatSelectionError(`lane scope targets a ${track.kind} track "${trackId}" — lanes exist only on drum tracks`)
    return { lanes: lanesForTrack }
  }

  const isDrums = track.kind === 'drums'
  const laneFilter = lanesForTrack.length > 0 ? new Set(lanesForTrack) : null
  // Can't happen for a selection that passed validateSelection (lane refs are rejected against
  // non-drum tracks there) — guarded here too since this function doesn't re-run validation.
  if (laneFilter && !isDrums) throw new BeatSelectionError(`lane scope targets a ${track.kind} track "${trackId}" — lanes exist only on drum tracks`)

  const noteFilter = hasNotes ? new Set(sel.notes!.filter((n) => n.track === trackId).map((n) => n.note)) : null
  const lo = hasBars ? sel.bars!.start * 16 : null
  const hi = hasBars ? sel.bars!.end * 16 : null

  const ids: string[] = []
  if (isDrums) {
    for (const h of track.hits) {
      if (laneFilter && !laneFilter.has(h.lane)) continue
      if (lo !== null && (h.start < lo || h.start >= hi!)) continue
      if (noteFilter && !noteFilter.has(h.id)) continue
      ids.push(h.id)
    }
  } else {
    for (const n of track.notes) {
      if (lo !== null && (n.start < lo || n.start >= hi!)) continue
      if (noteFilter && !noteFilter.has(n.id)) continue
      ids.push(n.id)
    }
  }

  if (ids.length === 0) {
    throw new BeatSelectionError(`selection has nothing on track "${trackId}" to vary (no ${isDrums ? 'hits' : 'notes'} in the selected lanes/bars/ids)`)
  }
  return { ids }
}
