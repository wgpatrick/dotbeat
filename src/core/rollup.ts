// Diff rollup — research/128 §2.3, the agent's "morning read" of an owner GUI session. A 20-minute
// GUI session writes hundreds of one-line edits; a resuming agent needs the session's STORY, not
// the log. This collapses a semantic DiffEntry[] into a grouped, magnitude-ordered summary:
//
//   - per track+param: NET before -> after, plus a tweakCount (how many entries collapsed into it
//     — 1 for a plain two-state `diff --since`, higher when fed a gesture/telemetry stream, where a
//     knob the owner wiggled 14 times and struggled with surfaces as the one to look at first);
//   - note/hit edits clustered per track and musical bar ("lead m2: 3 moved, 1 added");
//   - clip automation summarized per (clip, param) ("cutoff lane reshaped: 4 points, +3 changed");
//   - structural facts (tracks/clips/effects/scenes/groups added/removed/moved) as prose lines;
//   - tracks ordered by edit mass (most-worked first), params within a track by tweaks then delta.
//
// Vocabulary is deliberately the GUI/CLI's own — the same track ids and param keys SynthPanel and
// `beat set` show — so the owner reads a rollup right after a GUI session with no translation.

import type { DiffEntry } from './diff.js'
import { formatNumber } from './format.js'

const STEPS_PER_BAR = 16 // v0.8 grid: 16 sixteenth-steps per bar (see edit.ts maxStep = loopBars*16)
const barOf = (step: number): number => Math.floor(step / STEPS_PER_BAR) + 1 // 1-indexed musical bar

/** A collapsed scalar edit (a synth/instrument/surge param, groove, meta, header, clip loop/sig,
 * effect enable/move). `tweakCount` is how many raw entries folded into this net change. */
export interface ParamRoll {
  path: string // `${trackId}.${param}` or a header/global key — GUI/CLI vocabulary
  op: string // the DiffEntry kind it came from
  before: unknown
  after: unknown
  tweakCount: number
}

export interface NoteRoll {
  scope: 'note' | 'hit'
  added: number
  removed: number
  moved: number // an entry that changed position/timing (start, or lane for a hit)
  changed: number // an entry that changed only non-positional fields (velocity, pitch, …)
  bars: number[] // 1-indexed musical bars touched, ascending (best-effort from available positions)
}

export interface AutomationRoll {
  clipId: string
  param: string
  pointsAdded: number
  pointsRemoved: number
  pointsChanged: number
  peak: number | null // largest absolute value delta among changed points (for "peak +X" phrasing)
}

export interface TrackRoll {
  trackId: string
  params: ParamRoll[]
  notes: NoteRoll[] // at most one per scope (note/hit)
  automation: AutomationRoll[]
  structural: string[] // clip/effect add/remove/move/enable, track add/remove/move — prose
  editMass: number // total raw entries touching this track — the track ordering key
}

export interface Rollup {
  header: ParamRoll[] // bpm / loop_bars / selected_track / format_version
  tracks: TrackRoll[] // ordered by editMass desc
  global: string[] // scene / song / group / media structural summaries
  totalEntries: number
}

const isNum = (v: unknown): v is number => typeof v === 'number'
function delta(before: unknown, after: unknown): number {
  return isNum(before) && isNum(after) ? Math.abs(after - before) : 0
}

// The kinds that collapse into a per-path net ParamRoll, and the path they key on.
function paramKey(e: DiffEntry): { path: string; trackId?: string } | null {
  switch (e.kind) {
    case 'header':
      return { path: e.field }
    case 'synth-param':
      return { path: `${e.trackId}.${e.param}`, trackId: e.trackId }
    case 'instrument-param':
      return { path: `${e.trackId}.${e.param}`, trackId: e.trackId }
    case 'surge-param':
      return { path: `${e.trackId}.surge.${e.param}`, trackId: e.trackId }
    case 'surge-override':
      return { path: `${e.trackId}.surge.override.${e.param}`, trackId: e.trackId }
    case 'track-groove':
      return { path: `${e.trackId}.${e.field}`, trackId: e.trackId }
    case 'track-meta':
      return { path: `${e.trackId}.${e.field}`, trackId: e.trackId }
    case 'clip-loop':
      return { path: `${e.trackId}.clip.${e.clipId}.loop`, trackId: e.trackId }
    case 'clip-signature':
      return { path: `${e.trackId}.clip.${e.clipId}.signature`, trackId: e.trackId }
    case 'effect-enabled':
      return { path: `${e.trackId}.effect.${e.effectId}.enabled`, trackId: e.trackId }
    case 'effect-moved':
      return { path: `${e.trackId}.effect.${e.effectId}.position`, trackId: e.trackId }
    default:
      return null
  }
}

function paramValues(e: DiffEntry): { before: unknown; after: unknown } {
  // Every collapsible kind carries before/after directly (clip-loop/signature carry objects).
  const anyE = e as unknown as { before?: unknown; after?: unknown }
  return { before: anyE.before, after: anyE.after }
}

/** Collapse a semantic diff into the grouped, ordered rollup. Pure — no IO. Accepts a DiffEntry[]
 * that MAY contain repeats of the same path (a concatenated or telemetry-derived stream): repeated
 * same-path scalar edits fold into one net row whose tweakCount is the number folded, keeping the
 * FIRST before and the LAST after. */
export function rollupDiff(entries: DiffEntry[]): Rollup {
  const header = new Map<string, ParamRoll>()
  const tracks = new Map<string, TrackRoll>()
  const global: string[] = []

  const track = (id: string): TrackRoll => {
    let t = tracks.get(id)
    if (!t) {
      t = { trackId: id, params: [], notes: [], automation: [], structural: [], editMass: 0 }
      tracks.set(id, t)
    }
    return t
  }
  // Per-track param/note/automation accumulators keyed for collapse.
  const paramAcc = new Map<string, Map<string, ParamRoll>>() // trackId(or '' header) -> path -> roll
  const noteAcc = new Map<string, Map<'note' | 'hit', NoteRoll>>()
  const autoAcc = new Map<string, Map<string, AutomationRoll>>()

  const paramBucket = (tid: string) => {
    let m = paramAcc.get(tid)
    if (!m) {
      m = new Map()
      paramAcc.set(tid, m)
    }
    return m
  }
  const foldParam = (tid: string, path: string, op: string, before: unknown, after: unknown) => {
    const m = paramBucket(tid)
    const existing = m.get(path)
    if (existing) {
      existing.after = after // keep first before, latest after
      existing.tweakCount++
    } else {
      m.set(path, { path, op, before, after, tweakCount: 1 })
    }
  }
  const noteRoll = (tid: string, scope: 'note' | 'hit'): NoteRoll => {
    let m = noteAcc.get(tid)
    if (!m) {
      m = new Map()
      noteAcc.set(tid, m)
    }
    let r = m.get(scope)
    if (!r) {
      r = { scope, added: 0, removed: 0, moved: 0, changed: 0, bars: [] }
      m.set(scope, r)
    }
    return r
  }
  const addBar = (r: NoteRoll, step: number | undefined) => {
    if (step === undefined || !Number.isFinite(step)) return
    const b = barOf(step)
    if (!r.bars.includes(b)) r.bars.push(b)
  }
  const autoRoll = (tid: string, clipId: string, param: string): AutomationRoll => {
    let m = autoAcc.get(tid)
    if (!m) {
      m = new Map()
      autoAcc.set(tid, m)
    }
    const key = `${clipId}\0${param}`
    let r = m.get(key)
    if (!r) {
      r = { clipId, param, pointsAdded: 0, pointsRemoved: 0, pointsChanged: 0, peak: null }
      m.set(key, r)
    }
    return r
  }

  for (const e of entries) {
    // 1) scalar param-like edits collapse per path
    const pk = paramKey(e)
    if (pk) {
      const { before, after } = paramValues(e)
      if (pk.trackId === undefined) {
        const existing = header.get(pk.path)
        if (existing) {
          existing.after = after
          existing.tweakCount++
        } else header.set(pk.path, { path: pk.path, op: e.kind, before, after, tweakCount: 1 })
      } else {
        foldParam(pk.trackId, pk.path, e.kind, before, after)
        track(pk.trackId).editMass++
      }
      continue
    }

    switch (e.kind) {
      case 'note-added': {
        const r = noteRoll(e.trackId, 'note')
        r.added++
        addBar(r, e.note.start)
        track(e.trackId).editMass++
        break
      }
      case 'note-removed': {
        const r = noteRoll(e.trackId, 'note')
        r.removed++
        addBar(r, e.note.start)
        track(e.trackId).editMass++
        break
      }
      case 'note-changed': {
        const r = noteRoll(e.trackId, 'note')
        const moved = e.changes.some((c) => c.field === 'start')
        if (moved) r.moved++
        else r.changed++
        const startChange = e.changes.find((c) => c.field === 'start')
        if (startChange) addBar(r, startChange.after)
        track(e.trackId).editMass++
        break
      }
      case 'hit-added': {
        const r = noteRoll(e.trackId, 'hit')
        r.added++
        addBar(r, e.hit.start)
        track(e.trackId).editMass++
        break
      }
      case 'hit-removed': {
        const r = noteRoll(e.trackId, 'hit')
        r.removed++
        addBar(r, e.hit.start)
        track(e.trackId).editMass++
        break
      }
      case 'hit-changed': {
        const r = noteRoll(e.trackId, 'hit')
        const moved = e.changes.some((c) => c.field === 'start' || c.field === 'lane')
        if (moved) r.moved++
        else r.changed++
        const startChange = e.changes.find((c) => c.field === 'start')
        if (startChange && typeof startChange.after === 'number') addBar(r, startChange.after)
        track(e.trackId).editMass++
        break
      }
      case 'automation-point-added': {
        autoRoll(e.trackId, e.clipId, e.param).pointsAdded++
        track(e.trackId).editMass++
        break
      }
      case 'automation-point-removed': {
        autoRoll(e.trackId, e.clipId, e.param).pointsRemoved++
        track(e.trackId).editMass++
        break
      }
      case 'automation-point-changed': {
        const r = autoRoll(e.trackId, e.clipId, e.param)
        r.pointsChanged++
        const vc = e.changes.find((c) => c.field === 'value')
        if (vc) {
          const d = Math.abs(vc.after - vc.before)
          r.peak = r.peak === null ? d : Math.max(r.peak, d)
        }
        track(e.trackId).editMass++
        break
      }
      // structural, per-track
      case 'track-added':
        track(e.trackId).structural.push(`track added (${e.track.kind} "${e.track.name}")`)
        track(e.trackId).editMass++
        break
      case 'track-removed':
        track(e.trackId).structural.push(`track removed (${e.track.kind} "${e.track.name}")`)
        track(e.trackId).editMass++
        break
      case 'track-moved':
        track(e.trackId).structural.push(`reordered (position ${e.before} -> ${e.after})`)
        track(e.trackId).editMass++
        break
      case 'clip-added':
        track(e.trackId).structural.push(`clip "${e.clipId}" added`)
        track(e.trackId).editMass++
        break
      case 'clip-removed':
        track(e.trackId).structural.push(`clip "${e.clipId}" removed`)
        track(e.trackId).editMass++
        break
      case 'clip-changed':
        track(e.trackId).structural.push(`clip "${e.clipId}" content changed (${e.noteDelta} note, ${e.hitDelta} hit)`)
        track(e.trackId).editMass++
        break
      case 'effect-added':
        track(e.trackId).structural.push(`effect ${e.effect.id} (${e.effect.type}) added`)
        track(e.trackId).editMass++
        break
      case 'effect-removed':
        track(e.trackId).structural.push(`effect ${e.effect.id} (${e.effect.type}) removed`)
        track(e.trackId).editMass++
        break
      case 'audio-region-added':
        track(e.trackId).structural.push(`clip "${e.clipId}" audio region added (${e.region.media})`)
        track(e.trackId).editMass++
        break
      case 'audio-region-removed':
        track(e.trackId).structural.push(`clip "${e.clipId}" audio region removed`)
        track(e.trackId).editMass++
        break
      case 'audio-region-changed':
        track(e.trackId).structural.push(`clip "${e.clipId}" audio ${e.changes.map((c) => c.field).join(', ')} trimmed`)
        track(e.trackId).editMass++
        break
      case 'lane-decl':
        track(e.trackId).structural.push(`lane "${e.lane}" ${e.before === null ? 'added' : e.after === null ? 'removed' : 'rebacked'}`)
        track(e.trackId).editMass++
        break
      case 'lane-sample':
        track(e.trackId).structural.push(`lane "${e.lane}" sample ${e.before ?? 'none'} -> ${e.after ?? 'none'}`)
        track(e.trackId).editMass++
        break
      // global structural
      case 'scene-added':
        global.push(`scene "${e.sceneId}" added`)
        break
      case 'scene-removed':
        global.push(`scene "${e.sceneId}" removed`)
        break
      case 'scene-meta':
        global.push(`scene "${e.sceneId}" renamed ${e.before ?? '(none)'} -> ${e.after ?? '(none)'}`)
        break
      case 'scene-slot':
        global.push(`scene "${e.sceneId}" ${e.trackId}: ${e.before ?? '(none)'} -> ${e.after ?? '(none)'}`)
        break
      case 'scene-slot-moved':
        global.push(`scene "${e.sceneId}" ${e.trackId} ${e.clip} moved`)
        break
      case 'song-changed':
        global.push('arrangement (song) changed')
        break
      case 'group-added':
        global.push(`group "${e.name}" added`)
        break
      case 'group-removed':
        global.push(`group "${e.name}" removed`)
        break
      case 'group-meta':
        global.push(`group ${e.groupId} ${e.field} changed`)
        break
      case 'group-tracks':
        global.push(`group ${e.groupId} membership changed`)
        break
      case 'media-added':
        global.push(`media "${e.sampleId}" added`)
        break
      case 'media-removed':
        global.push(`media "${e.sampleId}" removed`)
        break
      case 'media-changed':
        global.push(`media "${e.sampleId}" ${e.field} changed`)
        break
    }
  }

  // Materialize accumulators onto tracks, sorting for the "where was the action" read.
  for (const [tid, m] of paramAcc) {
    const t = track(tid)
    t.params = [...m.values()].sort((a, b) => b.tweakCount - a.tweakCount || delta(b.before, b.after) - delta(a.before, a.after) || a.path.localeCompare(b.path))
  }
  for (const [tid, m] of noteAcc) {
    const t = track(tid)
    t.notes = [...m.values()].map((r) => ({ ...r, bars: [...r.bars].sort((a, b) => a - b) }))
  }
  for (const [tid, m] of autoAcc) {
    const t = track(tid)
    t.automation = [...m.values()].sort((a, b) => (b.peak ?? 0) - (a.peak ?? 0))
  }

  const headerRolls = [...header.values()].sort((a, b) => b.tweakCount - a.tweakCount || a.path.localeCompare(b.path))
  const trackRolls = [...tracks.values()].sort((a, b) => b.editMass - a.editMass || a.trackId.localeCompare(b.trackId))
  return { header: headerRolls, tracks: trackRolls, global, totalEntries: entries.length }
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return 'none'
  if (typeof v === 'number') return formatNumber(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('start' in o && 'end' in o) return `${formatNumber(o.start as number)}-${formatNumber(o.end as number)}`
    if ('numerator' in o && 'denominator' in o) return `${o.numerator}/${o.denominator}`
    return JSON.stringify(v)
  }
  return String(v)
}

function paramLine(p: ParamRoll): string {
  const tweaks = p.tweakCount > 1 ? `  (${p.tweakCount} tweaks)` : ''
  return `  ${p.path}: ${fmtVal(p.before)} -> ${fmtVal(p.after)}${tweaks}`
}

function barsPhrase(bars: number[]): string {
  if (bars.length === 0) return ''
  if (bars.length === 1) return ` m${bars[0]}`
  return ` m${bars[0]}-${bars[bars.length - 1]}`
}

function noteLine(trackId: string, r: NoteRoll): string {
  const parts: string[] = []
  if (r.moved) parts.push(`${r.moved} moved`)
  if (r.added) parts.push(`${r.added} added`)
  if (r.removed) parts.push(`${r.removed} removed`)
  if (r.changed) parts.push(`${r.changed} tweaked`)
  const noun = r.scope === 'hit' ? 'hits' : 'notes'
  return `  ${noun}${barsPhrase(r.bars)}: ${parts.join(', ')}`
}

function autoLine(r: AutomationRoll): string {
  const parts: string[] = []
  if (r.pointsAdded) parts.push(`+${r.pointsAdded}`)
  if (r.pointsRemoved) parts.push(`-${r.pointsRemoved}`)
  if (r.pointsChanged) parts.push(`~${r.pointsChanged}`)
  const peak = r.peak !== null && r.peak > 0 ? `, peak ${formatNumber(r.peak)}` : ''
  return `  automation ${r.clipId}.${r.param}: ${parts.join(' ')} point(s)${peak}`
}

/** Render a rollup as human-readable prose — the agent's (and owner's) morning read. */
export function formatRollup(r: Rollup): string {
  if (r.totalEntries === 0) return 'no changes\n'
  const lines: string[] = []
  if (r.header.length) {
    lines.push('song:')
    for (const p of r.header) lines.push(paramLine(p))
  }
  for (const t of r.tracks) {
    lines.push(`${t.trackId}:  (${t.editMass} edit${t.editMass === 1 ? '' : 's'})`)
    for (const s of t.structural) lines.push(`  ${s}`)
    for (const p of t.params) lines.push(paramLine(p))
    for (const n of t.notes) lines.push(noteLine(t.trackId, n))
    for (const a of t.automation) lines.push(autoLine(a))
  }
  if (r.global.length) {
    lines.push('arrangement / media:')
    for (const g of r.global) lines.push(`  ${g}`)
  }
  return lines.join('\n') + '\n'
}
