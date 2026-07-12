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

import type { BeatAutomationLane, BeatDrumHit, BeatDocument, BeatEffect, BeatNote, BeatTrack, DrumLane } from './document.js'
import { DRUM_LANES, SYNTH_FIELDS, SYNTH_PARAM_ORDER } from './document.js'
import { formatNumber } from './format.js'

export type DiffEntry =
  | { kind: 'header'; field: 'bpm' | 'loop_bars' | 'selected_track' | 'format_version'; before: string | number; after: string | number }
  | { kind: 'track-added'; trackId: string; track: BeatTrack }
  | { kind: 'track-removed'; trackId: string; track: BeatTrack }
  | { kind: 'track-meta'; trackId: string; field: 'name' | 'color'; before: string; after: string }
  | { kind: 'track-moved'; trackId: string; before: number; after: number }
  | { kind: 'synth-param'; trackId: string; param: string; before: string | number | boolean | null; after: string | number | boolean | null }
  | { kind: 'note-added'; trackId: string; note: BeatNote }
  | { kind: 'note-removed'; trackId: string; note: BeatNote }
  | { kind: 'note-changed'; trackId: string; noteId: string; changes: { field: 'pitch' | 'start' | 'duration' | 'velocity'; before: number; after: number }[] }
  // v0.8 drum hits (match by id, like notes)
  | { kind: 'hit-added'; trackId: string; hit: BeatDrumHit }
  | { kind: 'hit-removed'; trackId: string; hit: BeatDrumHit }
  | { kind: 'hit-changed'; trackId: string; hitId: string; changes: { field: 'lane' | 'start' | 'velocity'; before: string | number; after: string | number }[] }
  // v0.4 song structure
  | { kind: 'clip-added'; trackId: string; clipId: string }
  | { kind: 'clip-removed'; trackId: string; clipId: string }
  | { kind: 'clip-changed'; trackId: string; clipId: string; noteDelta: number; hitDelta: number }
  | { kind: 'scene-added'; sceneId: string }
  | { kind: 'scene-removed'; sceneId: string }
  | { kind: 'scene-slot'; sceneId: string; trackId: string; before: string | null; after: string | null }
  | { kind: 'song-changed'; before: { scene: string; bars: number }[] | null; after: { scene: string; bars: number }[] | null }
  // v0.5 media + lane samples
  | { kind: 'media-added'; sampleId: string; path: string }
  | { kind: 'media-removed'; sampleId: string; path: string }
  | { kind: 'media-changed'; sampleId: string; field: 'sha256' | 'path'; before: string; after: string }
  | { kind: 'lane-sample'; trackId: string; lane: DrumLane; before: string | null; after: string | null }
  // v0.6 instrument tracks
  | { kind: 'instrument-param'; trackId: string; param: 'soundfont' | 'program' | 'volume' | 'pan'; before: string | number; after: string | number }
  // v0.9 clip automation (matched by (clipId, param, pointId) — points are stable ids, like notes/hits)
  | { kind: 'automation-point-added'; trackId: string; clipId: string; param: string; point: { id: string; time: number; value: number } }
  | { kind: 'automation-point-removed'; trackId: string; clipId: string; param: string; point: { id: string; time: number; value: number } }
  | { kind: 'automation-point-changed'; trackId: string; clipId: string; param: string; pointId: string; changes: { field: 'time' | 'value'; before: number; after: number }[] }
  // v0.10 effect chain (matched by id, like notes/hits — a reorder reads as "moved", not remove+add)
  | { kind: 'effect-added'; trackId: string; effect: BeatEffect }
  | { kind: 'effect-removed'; trackId: string; effect: BeatEffect }
  | { kind: 'effect-moved'; trackId: string; effectId: string; before: number; after: number }
  | { kind: 'effect-enabled'; trackId: string; effectId: string; before: boolean; after: boolean }

// v0.9: diffs one clip's automation lanes. Lanes match by param name; points within a lane match
// by id (like notes/hits) — a point moved in time or re-valued reports as one changed entry, not
// a remove+add pair, so the diff reads as "this point moved," not "a point vanished and another
// appeared nearby."
function diffClipAutomation(trackId: string, clipId: string, aLanes: BeatAutomationLane[], bLanes: BeatAutomationLane[], out: DiffEntry[]) {
  const aByParam = new Map(aLanes.map((l) => [l.param, l]))
  const bByParam = new Map(bLanes.map((l) => [l.param, l]))
  const params = new Set([...aByParam.keys(), ...bByParam.keys()])
  for (const param of params) {
    const aPoints = new Map((aByParam.get(param)?.points ?? []).map((p) => [p.id, p]))
    const bPoints = new Map((bByParam.get(param)?.points ?? []).map((p) => [p.id, p]))
    for (const [pid, p] of aPoints) {
      if (!bPoints.has(pid)) out.push({ kind: 'automation-point-removed', trackId, clipId, param, point: p })
    }
    for (const [pid, p] of bPoints) {
      const before = aPoints.get(pid)
      if (!before) {
        out.push({ kind: 'automation-point-added', trackId, clipId, param, point: p })
        continue
      }
      const changes: { field: 'time' | 'value'; before: number; after: number }[] = []
      if (before.time !== p.time) changes.push({ field: 'time', before: before.time, after: p.time })
      if (before.value !== p.value) changes.push({ field: 'value', before: before.value, after: p.value })
      if (changes.length) out.push({ kind: 'automation-point-changed', trackId, clipId, param, pointId: pid, changes })
    }
  }
}

// v0.10: diffs one track's effect chain. Entries match by id (like notes/hits/automation points),
// never by position — so a reorder reads as "effect X moved from position i to j," not a
// remove-and-re-add pair (the alsdiff lesson, same as track-moved above). Order comparison runs
// only over ids present on BOTH sides, for the same reason track order comparison does: adding or
// removing one entry shouldn't make every later entry look like it "moved."
function diffEffects(trackId: string, aEffects: BeatEffect[], bEffects: BeatEffect[], out: DiffEntry[]) {
  const aById = new Map(aEffects.map((e) => [e.id, e]))
  const bById = new Map(bEffects.map((e) => [e.id, e]))
  for (const [id, e] of aById) if (!bById.has(id)) out.push({ kind: 'effect-removed', trackId, effect: e })
  for (const [id, e] of bById) if (!aById.has(id)) out.push({ kind: 'effect-added', trackId, effect: e })

  const commonIds = [...aById.keys()].filter((id) => bById.has(id))
  const aOrder = aEffects.filter((e) => bById.has(e.id)).map((e) => e.id)
  const bOrder = bEffects.filter((e) => aById.has(e.id)).map((e) => e.id)
  if (aOrder.join('\n') !== bOrder.join('\n')) {
    for (const id of commonIds) {
      const ai = aOrder.indexOf(id)
      const bi = bOrder.indexOf(id)
      if (ai !== bi) out.push({ kind: 'effect-moved', trackId, effectId: id, before: ai, after: bi })
    }
  }
  for (const id of commonIds) {
    const before = aById.get(id)!.enabled
    const after = bById.get(id)!.enabled
    if (before !== after) out.push({ kind: 'effect-enabled', trackId, effectId: id, before, after })
  }
}

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

    if (ta.kind === 'instrument' && tb.kind === 'instrument' && ta.instrument && tb.instrument) {
      if (ta.instrument.sample !== tb.instrument.sample) out.push({ kind: 'instrument-param', trackId: id, param: 'soundfont', before: ta.instrument.sample, after: tb.instrument.sample })
      if (ta.instrument.program !== tb.instrument.program) out.push({ kind: 'instrument-param', trackId: id, param: 'program', before: ta.instrument.program, after: tb.instrument.program })
      if (ta.instrument.volume !== tb.instrument.volume) out.push({ kind: 'instrument-param', trackId: id, param: 'volume', before: ta.instrument.volume, after: tb.instrument.volume })
      if (ta.instrument.pan !== tb.instrument.pan) out.push({ kind: 'instrument-param', trackId: id, param: 'pan', before: ta.instrument.pan, after: tb.instrument.pan })
    }
    if (ta.kind !== 'instrument') {
      for (const param of [...SYNTH_PARAM_ORDER, ...SYNTH_FIELDS.map((f) => f.key)]) {
        if (ta.synth[param] !== tb.synth[param]) {
          out.push({ kind: 'synth-param', trackId: id, param, before: ta.synth[param], after: tb.synth[param] })
        }
      }
    }

    // v0.10 effect chain: match/order-compare by id (alsdiff lesson again).
    diffEffects(id, ta.effects, tb.effects, out)

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

    // v0.8 drum hits: match by id (like notes). Added/removed/changed(lane|start|velocity).
    const aHits = new Map(ta.hits.map((h) => [h.id, h]))
    const bHits = new Map(tb.hits.map((h) => [h.id, h]))
    for (const [hid, h] of aHits) if (!bHits.has(hid)) out.push({ kind: 'hit-removed', trackId: id, hit: h })
    for (const [hid, h] of bHits) {
      const before = aHits.get(hid)
      if (!before) {
        out.push({ kind: 'hit-added', trackId: id, hit: h })
        continue
      }
      const changes: { field: 'lane' | 'start' | 'velocity'; before: string | number; after: string | number }[] = []
      if (before.lane !== h.lane) changes.push({ field: 'lane', before: before.lane, after: h.lane })
      if (before.start !== h.start) changes.push({ field: 'start', before: before.start, after: h.start })
      if (before.velocity !== h.velocity) changes.push({ field: 'velocity', before: before.velocity, after: h.velocity })
      if (changes.length) out.push({ kind: 'hit-changed', trackId: id, hitId: hid, changes })
    }

    // Clips match by ID (like everything else). Content changes report as counts — a clip is a
    // snapshot, so "what changed inside" is usually re-snapshot noise; the load-bearing musical
    // facts are which clips exist and which scenes use them.
    const aClips = new Map(ta.clips.map((c) => [c.id, c]))
    const bClips = new Map(tb.clips.map((c) => [c.id, c]))
    for (const [cid] of aClips) if (!bClips.has(cid)) out.push({ kind: 'clip-removed', trackId: id, clipId: cid })
    for (const [cid, cb] of bClips) {
      const ca = aClips.get(cid)
      if (!ca) {
        out.push({ kind: 'clip-added', trackId: id, clipId: cid })
        continue
      }
      const noteKey = (n: { id: string; pitch: number; start: number; duration: number; velocity: number }) => `${n.id}|${n.pitch}|${n.start}|${n.duration}|${n.velocity}`
      const aNoteSet = new Set(ca.notes.map(noteKey))
      const bNoteSet = new Set(cb.notes.map(noteKey))
      let noteDelta = 0
      for (const k of aNoteSet) if (!bNoteSet.has(k)) noteDelta++
      for (const k of bNoteSet) if (!aNoteSet.has(k)) noteDelta++
      const hitKey = (h: BeatDrumHit) => `${h.id}|${h.lane}|${h.start}|${h.velocity}`
      const aHitSet = new Set(ca.hits.map(hitKey))
      const bHitSet = new Set(cb.hits.map(hitKey))
      let hitDelta = 0
      for (const k of aHitSet) if (!bHitSet.has(k)) hitDelta++
      for (const k of bHitSet) if (!aHitSet.has(k)) hitDelta++
      if (noteDelta || hitDelta) out.push({ kind: 'clip-changed', trackId: id, clipId: cid, noteDelta, hitDelta })

      // v0.9 clip automation: unlike notes/hits above (reported as a delta count — a clip is a
      // snapshot, re-snapshot noise is common), automation points are itemized per-point, matched
      // by (param, id) — a knob move mid-clip is a specific musical fact worth naming, not noise.
      diffClipAutomation(id, cid, ca.automation, cb.automation, out)
    }
  }

  // v0.4: scenes match by ID; slots compare per track.
  const aScenes = new Map(a.scenes.map((s) => [s.id, s]))
  const bScenes = new Map(b.scenes.map((s) => [s.id, s]))
  for (const [sid] of aScenes) if (!bScenes.has(sid)) out.push({ kind: 'scene-removed', sceneId: sid })
  for (const [sid, sb] of bScenes) {
    const sa = aScenes.get(sid)
    if (!sa) {
      out.push({ kind: 'scene-added', sceneId: sid })
      continue
    }
    const trackIds = new Set([...Object.keys(sa.slots), ...Object.keys(sb.slots)])
    for (const tid of trackIds) {
      const before = sa.slots[tid] ?? null
      const after = sb.slots[tid] ?? null
      if (before !== after) out.push({ kind: 'scene-slot', sceneId: sid, trackId: tid, before, after })
    }
  }

  // v0.5 media: match by id; report re-pins (hash/path changes) per field.
  const aMedia = new Map(a.media.map((m) => [m.id, m]))
  const bMedia = new Map(b.media.map((m) => [m.id, m]))
  for (const [mid, m] of aMedia) if (!bMedia.has(mid)) out.push({ kind: 'media-removed', sampleId: mid, path: m.path })
  for (const [mid, mb] of bMedia) {
    const ma = aMedia.get(mid)
    if (!ma) {
      out.push({ kind: 'media-added', sampleId: mid, path: mb.path })
      continue
    }
    if (ma.sha256 !== mb.sha256) out.push({ kind: 'media-changed', sampleId: mid, field: 'sha256', before: ma.sha256, after: mb.sha256 })
    if (ma.path !== mb.path) out.push({ kind: 'media-changed', sampleId: mid, field: 'path', before: ma.path, after: mb.path })
  }

  // v0.5 lane samples: per common track, per lane; described as "sample(gain,tune)" strings.
  const laneDesc = (ls: { sample: string; gainDb: number; tune: number } | undefined) =>
    ls ? `${ls.sample} (${formatNumber(ls.gainDb)} dB, ${formatNumber(ls.tune)} st)` : null
  for (const id of commonIds) {
    const ta = aTracks.get(id)!.t
    const tb = bTracks.get(id)!.t
    for (const lane of DRUM_LANES) {
      const before = laneDesc(ta.laneSamples[lane])
      const after = laneDesc(tb.laneSamples[lane])
      if (before !== after) out.push({ kind: 'lane-sample', trackId: id, lane, before, after })
    }
  }

  // The song is one ordered statement — compare whole (order IS the data; per-index diffs of a
  // reordered section list would read as noise).
  const songKey = (s: { scene: string; bars: number }[] | null) => (s ? s.map((x) => `${x.scene}:${x.bars}`).join(',') : '')
  if (songKey(a.song) !== songKey(b.song)) out.push({ kind: 'song-changed', before: a.song, after: b.song })

  return out
}

function fmtVal(v: string | number | boolean | null): string {
  if (v === null) return 'none'
  return typeof v === 'number' ? formatNumber(v) : String(v)
}

function noteDesc(n: BeatNote): string {
  return `${n.id} (pitch ${n.pitch}, start ${formatNumber(n.start)}, dur ${formatNumber(n.duration)}, vel ${formatNumber(n.velocity)})`
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
            e.track.kind === 'drums' ? `${e.track.hits.length} hit${e.track.hits.length === 1 ? '' : 's'}` : `${e.track.notes.length} note${e.track.notes.length === 1 ? '' : 's'}`
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
      case 'hit-added':
        lines.push(`${e.trackId}: ${e.hit.lane} hit added ${e.hit.id} (step ${formatNumber(e.hit.start)}, vel ${formatNumber(e.hit.velocity)})`)
        break
      case 'hit-removed':
        lines.push(`${e.trackId}: ${e.hit.lane} hit removed ${e.hit.id} (step ${formatNumber(e.hit.start)})`)
        break
      case 'hit-changed':
        lines.push(`${e.trackId}: hit ${e.hitId} ${e.changes.map((c) => `${c.field} ${typeof c.before === 'number' ? formatNumber(c.before) : c.before} -> ${typeof c.after === 'number' ? formatNumber(c.after) : c.after}`).join(', ')}`)
        break
      case 'clip-added':
        lines.push(`${e.trackId}: clip added "${e.clipId}"`)
        break
      case 'clip-removed':
        lines.push(`${e.trackId}: clip removed "${e.clipId}"`)
        break
      case 'clip-changed':
        lines.push(`${e.trackId}: clip "${e.clipId}" changed (${e.noteDelta} note change${e.noteDelta === 1 ? '' : 's'}, ${e.hitDelta} hit change${e.hitDelta === 1 ? '' : 's'})`)
        break
      case 'scene-added':
        lines.push(`scene added "${e.sceneId}"`)
        break
      case 'scene-removed':
        lines.push(`scene removed "${e.sceneId}"`)
        break
      case 'scene-slot':
        lines.push(`scene ${e.sceneId}: ${e.trackId} ${e.before ?? '(empty)'} -> ${e.after ?? '(empty)'}`)
        break
      case 'media-added':
        lines.push(`media: sample added "${e.sampleId}" (${e.path})`)
        break
      case 'media-removed':
        lines.push(`media: sample removed "${e.sampleId}" (${e.path})`)
        break
      case 'media-changed':
        lines.push(`media: ${e.sampleId} ${e.field} ${e.field === 'sha256' ? `${e.before.slice(0, 12)}... -> ${e.after.slice(0, 12)}...` : `${e.before} -> ${e.after}`}`)
        break
      case 'lane-sample':
        lines.push(`${e.trackId}: ${e.lane} lane ${e.before ?? 'synth voice'} -> ${e.after ?? 'synth voice'}`)
        break
      case 'instrument-param':
        lines.push(`${e.trackId}: ${e.param} ${fmtVal(e.before)} -> ${fmtVal(e.after)}`)
        break
      case 'automation-point-added':
        lines.push(`${e.trackId}: clip "${e.clipId}" ${e.param} automation point added ${e.point.id} (step ${formatNumber(e.point.time)}, value ${formatNumber(e.point.value)})`)
        break
      case 'automation-point-removed':
        lines.push(`${e.trackId}: clip "${e.clipId}" ${e.param} automation point removed ${e.point.id} (step ${formatNumber(e.point.time)}, value ${formatNumber(e.point.value)})`)
        break
      case 'automation-point-changed':
        lines.push(`${e.trackId}: clip "${e.clipId}" ${e.param} automation point ${e.pointId} ${e.changes.map((c) => `${c.field} ${formatNumber(c.before)} -> ${formatNumber(c.after)}`).join(', ')}`)
        break
      case 'effect-added':
        lines.push(`${e.trackId}: effect added ${e.effect.id} (${e.effect.type}${e.effect.enabled ? '' : ', bypassed'})`)
        break
      case 'effect-removed':
        lines.push(`${e.trackId}: effect removed ${e.effect.id} (${e.effect.type})`)
        break
      case 'effect-moved':
        lines.push(`${e.trackId}: effect ${e.effectId} moved from position ${e.before} to ${e.after}`)
        break
      case 'effect-enabled':
        lines.push(`${e.trackId}: effect ${e.effectId} ${e.after ? 'enabled' : 'bypassed'}`)
        break
      case 'song-changed': {
        const fmt = (s: { scene: string; bars: number }[] | null) => (s ? s.map((x) => `${x.scene}(${x.bars})`).join(' ') : '(no song)')
        lines.push(`song: ${fmt(e.before)} -> ${fmt(e.after)}`)
        break
      }
    }
  }
  return lines.join('\n') + '\n'
}
