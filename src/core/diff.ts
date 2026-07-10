// Semantic (musical) diff between two BeatDocuments — docs/phase-2-plan.md §2.1.
//
// This is what the format's stable IDs and canonical ordering were FOR (docs/decisions.md D4):
// entities match by ID, not position, so a renamed or reordered track never produces
// false-positive note diffs (the alsdiff lesson), and the output says what changed *musically*
// (the musicdiff lesson: "note moved", not "line 37 changed").
//
// The DiffEntry shape follows openDAW's inverse-update-log insight (docs/opendaw-notes.md §7):
// a typed list of per-entity, per-field changes is simultaneously a human-readable edit list, a
// machine-applicable changeset, and — later — the natural undo / --dry-run representation. Each
// entry carries `before`/`after`, so inverting a diff is structurally trivial when we need it.

import type { BeatDocument, BeatNote, BeatTrack, DrumLane } from './document.js'
import { DRUM_LANES, SYNTH_PARAM_ORDER } from './document.js'
import { formatNumber } from './format.js'

export type DiffEntry =
  | { kind: 'header'; field: 'bpm' | 'loop_bars' | 'selected_track' | 'format_version'; before: string | number; after: string | number }
  | { kind: 'track-added'; trackId: string; track: BeatTrack }
  | { kind: 'track-removed'; trackId: string; track: BeatTrack }
  | { kind: 'track-meta'; trackId: string; field: 'name' | 'color'; before: string; after: string }
  | { kind: 'track-moved'; trackId: string; before: number; after: number }
  | { kind: 'synth-param'; trackId: string; param: string; before: string | number; after: string | number }
  | { kind: 'note-added'; trackId: string; note: BeatNote }
  | { kind: 'note-removed'; trackId: string; note: BeatNote }
  | { kind: 'note-changed'; trackId: string; noteId: string; changes: { field: 'pitch' | 'start' | 'duration' | 'velocity'; before: number; after: number }[] }
  | { kind: 'pattern-step'; trackId: string; lane: DrumLane; step: number; before: number; after: number }
  | { kind: 'pattern-length'; trackId: string; lane: DrumLane; before: number; after: number }

export function diffDocuments(a: BeatDocument, b: BeatDocument): DiffEntry[] {
  const out: DiffEntry[] = []

  if (a.formatVersion !== b.formatVersion) out.push({ kind: 'header', field: 'format_version', before: a.formatVersion, after: b.formatVersion })
  if (a.bpm !== b.bpm) out.push({ kind: 'header', field: 'bpm', before: a.bpm, after: b.bpm })
  if (a.loopBars !== b.loopBars) out.push({ kind: 'header', field: 'loop_bars', before: a.loopBars, after: b.loopBars })
  if (a.selectedTrack !== b.selectedTrack) out.push({ kind: 'header', field: 'selected_track', before: a.selectedTrack, after: b.selectedTrack })

  const aTracks = new Map(a.tracks.map((t, i) => [t.id, { t, i }]))
  const bTracks = new Map(b.tracks.map((t, i) => [t.id, { t, i }]))

  for (const [id, { t }] of aTracks) {
    if (!bTracks.has(id)) out.push({ kind: 'track-removed', trackId: id, track: t })
  }
  for (const [id, { t }] of bTracks) {
    if (!aTracks.has(id)) out.push({ kind: 'track-added', trackId: id, track: t })
  }

  // Order comparison among tracks present on BOTH sides (an insertion shifting indices of
  // everything after it should not read as "every following track moved").
  const commonIds = [...aTracks.keys()].filter((id) => bTracks.has(id))
  const aOrder = a.tracks.filter((t) => bTracks.has(t.id)).map((t) => t.id)
  const bOrder = b.tracks.filter((t) => aTracks.has(t.id)).map((t) => t.id)
  if (aOrder.join('\n') !== bOrder.join('\n')) {
    for (const id of commonIds) {
      const ai = aOrder.indexOf(id)
      const bi = bOrder.indexOf(id)
      if (ai !== bi) out.push({ kind: 'track-moved', trackId: id, before: ai, after: bi })
    }
  }

  for (const id of commonIds) {
    const ta = aTracks.get(id)!.t
    const tb = bTracks.get(id)!.t
    if (ta.name !== tb.name) out.push({ kind: 'track-meta', trackId: id, field: 'name', before: ta.name, after: tb.name })
    if (ta.color !== tb.color) out.push({ kind: 'track-meta', trackId: id, field: 'color', before: ta.color, after: tb.color })

    for (const param of SYNTH_PARAM_ORDER) {
      if (ta.synth[param] !== tb.synth[param]) {
        out.push({ kind: 'synth-param', trackId: id, param, before: ta.synth[param], after: tb.synth[param] })
      }
    }

    // Notes match by ID — never by position (the alsdiff lesson).
    const aNotes = new Map(ta.notes.map((n) => [n.id, n]))
    const bNotes = new Map(tb.notes.map((n) => [n.id, n]))
    for (const [nid, n] of aNotes) {
      if (!bNotes.has(nid)) out.push({ kind: 'note-removed', trackId: id, note: n })
    }
    for (const [nid, n] of bNotes) {
      if (!aNotes.has(nid)) {
        out.push({ kind: 'note-added', trackId: id, note: n })
        continue
      }
      const before = aNotes.get(nid)!
      const changes: { field: 'pitch' | 'start' | 'duration' | 'velocity'; before: number; after: number }[] = []
      for (const field of ['pitch', 'start', 'duration', 'velocity'] as const) {
        if (before[field] !== n[field]) changes.push({ field, before: before[field], after: n[field] })
      }
      if (changes.length) out.push({ kind: 'note-changed', trackId: id, noteId: nid, changes })
    }

    if (ta.pattern && tb.pattern) {
      for (const lane of DRUM_LANES) {
        const la = ta.pattern[lane]
        const lb = tb.pattern[lane]
        if (la.length !== lb.length) {
          out.push({ kind: 'pattern-length', trackId: id, lane, before: la.length, after: lb.length })
          continue // step-by-step comparison across different lengths would be noise
        }
        for (let i = 0; i < la.length; i++) {
          if (la[i] !== lb[i]) out.push({ kind: 'pattern-step', trackId: id, lane, step: i, before: la[i]!, after: lb[i]! })
        }
      }
    }
  }

  return out
}

function fmtVal(v: string | number): string {
  return typeof v === 'number' ? formatNumber(v) : v
}

function noteDesc(n: BeatNote): string {
  return `${n.id} (pitch ${n.pitch}, start ${n.start}, dur ${n.duration}, vel ${formatNumber(n.velocity)})`
}

/** One musical edit per line, track-scoped — reads like an edit list, not like line noise. */
export function formatDiff(entries: DiffEntry[]): string {
  if (entries.length === 0) return 'no musical changes\n'
  const lines: string[] = []
  for (const e of entries) {
    switch (e.kind) {
      case 'header':
        lines.push(`${e.field}: ${fmtVal(e.before)} -> ${fmtVal(e.after)}`)
        break
      case 'track-added':
        lines.push(
          `${e.trackId}: track added (${e.track.kind} "${e.track.name}", ${
            e.track.kind === 'synth' ? `${e.track.notes.length} note${e.track.notes.length === 1 ? '' : 's'}` : 'drum pattern'
          })`,
        )
        break
      case 'track-removed':
        lines.push(`${e.trackId}: track removed (${e.track.kind} "${e.track.name}")`)
        break
      case 'track-meta':
        lines.push(`${e.trackId}: ${e.field} "${e.before}" -> "${e.after}"`)
        break
      case 'track-moved':
        lines.push(`${e.trackId}: moved from position ${e.before} to ${e.after}`)
        break
      case 'synth-param':
        lines.push(`${e.trackId}: ${e.param} ${fmtVal(e.before)} -> ${fmtVal(e.after)}`)
        break
      case 'note-added':
        lines.push(`${e.trackId}: note added ${noteDesc(e.note)}`)
        break
      case 'note-removed':
        lines.push(`${e.trackId}: note removed ${noteDesc(e.note)}`)
        break
      case 'note-changed':
        lines.push(`${e.trackId}: note ${e.noteId} ${e.changes.map((c) => `${c.field} ${formatNumber(c.before)} -> ${formatNumber(c.after)}`).join(', ')}`)
        break
      case 'pattern-step':
        lines.push(
          `${e.trackId}: ${e.lane} step ${e.step} ${e.before === 0 ? `added (vel ${formatNumber(e.after)})` : e.after === 0 ? `removed (was ${formatNumber(e.before)})` : `${formatNumber(e.before)} -> ${formatNumber(e.after)}`}`,
        )
        break
      case 'pattern-length':
        lines.push(`${e.trackId}: ${e.lane} pattern length ${e.before} -> ${e.after} steps`)
        break
    }
  }
  return lines.join('\n') + '\n'
}
