// Edit telemetry — the "log-don't-train" JSONL from research/116 §4, operationalized by
// research/128 §2.4. An opt-in, append-only record of every document edit across all three write
// surfaces (GUI daemon, CLI, MCP), written to a sidecar OUTSIDE any project repo so a working
// tree never carries it. Off by default (BEAT_EDIT_LOG unset); when off, every entry point below
// returns before doing any work — zero overhead on the hot GUI knob-drag path.
//
// WHY THIS SHAPE (the hook-design decision, research/128 §2.4): src/core/edit.ts is a PURE library
// whose setValue()/addNote()/etc. are called MANY times per user action — a 60 ms-debounced knob
// drag fires dozens of setValue calls for one gesture, and gesture boundaries are a DAEMON concept
// (the undo stack's coalescing), unknowable inside the pure functions. An observer registered
// inside edit.ts would therefore log 60/sec for one drag, and would still miss the CLI verbs and
// MCP tools that call addNote/quantizeNotes/humanize directly rather than through setValue. So we
// hook at each surface's WRITE MOMENT instead, where the before- and after- documents are both in
// hand, and derive the edit list from diffDocuments(before, after) — the project's own canonical
// changeset representation (the same one `beat diff` and checkpoint messages use). One mechanism,
// all three surfaces, and the logged op/path/param vocabulary matches the GUI/CLI naming for free.
//
// GUI gestures ride the daemon's EXISTING gestureId/undo coalescing boundary (noteDaemonEdit,
// below) — we do not invent a second gesture concept: one entry per drag, before = the value at
// gesture start, after = the value when the drag settled.

import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BeatDocument, DiffEntry } from '../core/index.js'
import { diffDocuments } from '../core/index.js'
import { formatNumber } from '../core/format.js'

/** The surfaces an edit can honestly be attributed to. 'gui' = through the daemon from a browser
 * (a knob turn, a piano-roll drag); 'cli' = a `beat` subcommand; 'mcp' = an agent tool call. */
export type EditSurface = 'gui' | 'cli' | 'mcp'

/** One logged edit — research/116 §4's schema, made concrete. `path` is the same dotted address
 * `beat set` uses when the edit is expressible that way (so a knob turn reads `bass.cutoff`),
 * `op` is the semantic diff kind (`synth-param`, `note-changed`, …). */
export interface EditLogEntry {
  t: string // ISO timestamp
  session: string // a per-process random id — groups one run's edits without identifying anything
  surface: EditSurface
  op: string // the DiffEntry kind — the project's own edit vocabulary
  path: string // dotted `beat set`-style address when expressible, else an entity locator
  before: unknown
  after: unknown
  file: string // basename of the .beat file the edit landed in
}

// ---- config (all lazy so importing this module is free) -----------------------------------

/** Opt-in gate. Off unless BEAT_EDIT_LOG is set to a truthy value ("1"/"true"/"yes"). Read live
 * (not cached) so a test — or `beat daemon --edit-log` flipping the env — takes effect at once. */
export function editLogEnabled(): boolean {
  const v = process.env.BEAT_EDIT_LOG
  return v === '1' || v === 'true' || v === 'yes'
}

/** Where the JSONL lives: BEAT_EDIT_LOG_FILE if set, else ~/.dotbeat/edit-log.jsonl — the same
 * outside-any-project-repo posture as beat-scores.jsonl's home, so no working tree ever carries
 * telemetry. The directory is made lazily on first write. */
export function editLogPath(): string {
  return process.env.BEAT_EDIT_LOG_FILE ?? join(homedir(), '.dotbeat', 'edit-log.jsonl')
}

// A per-process id. Lazily minted so a process that never logs never pays for it.
let sessionId: string | null = null
function session(): string {
  if (sessionId === null) sessionId = randomUUID()
  return sessionId
}

// ---- the write ----------------------------------------------------------------------------

function append(entries: EditLogEntry[]): void {
  if (entries.length === 0) return
  const path = editLogPath()
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
  } catch {
    // Telemetry must never break an edit. A failed write is silently dropped — this log is a
    // research convenience, not a correctness-bearing artifact (research/116: log-don't-train).
  }
}

function emit(before: BeatDocument, after: BeatDocument, surface: EditSurface, file: string): void {
  const t = new Date().toISOString()
  const base = basename(file)
  const sess = session()
  const rows = recordsFromDiff(diffDocuments(before, after))
  append(rows.map((r) => ({ t, session: sess, surface, op: r.op, path: r.path, before: r.before, after: r.after, file: base })))
}

/** CLI/MCP write moment: a one-shot edit with a complete before/after in hand. Records
 * immediately — these surfaces have no gesture stream to coalesce. Cheap no-op when disabled. */
export function recordEdits(before: BeatDocument, after: BeatDocument, opts: { surface: EditSurface; file: string }): void {
  if (!editLogEnabled()) return
  emit(before, after, opts.surface, opts.file)
}

// ---- daemon gesture coalescing ------------------------------------------------------------

interface Pending {
  before: BeatDocument // the document at the START of the gesture
  after: BeatDocument // the latest document seen for this gesture
  surface: EditSurface
  file: string
}
let pending: Pending | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
const GESTURE_IDLE_MS = 800 // > the daemon's UNDO_COALESCE_MS (700): flush a drag once it settles

function scheduleIdleFlush(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(flushEditLog, GESTURE_IDLE_MS)
  // Never keep the process (or a test runner) alive on the telemetry timer's account.
  if (typeof idleTimer.unref === 'function') idleTimer.unref()
}

/**
 * The daemon write-moment hook, called from writeIfChanged AFTER a successful write. It rides the
 * SAME boundary the undo stack already computes — `coalesced` is writeIfChanged's own predicate:
 *
 *  - `gestureKey === undefined` (a one-shot structural route: add-track, song ops, …): flush any
 *    open gesture, then record this edit immediately — there's nothing to coalesce.
 *  - `!coalesced` (a NEW gesture began): flush the previous gesture and open a new one whose
 *    `before` is this write's pre-state.
 *  - `coalesced` (the same drag continuing): just advance `after`.
 *
 * The gesture flushes when the next gesture starts, on an idle timer (drag settled), or on an
 * explicit flushEditLog() (daemon shutdown / external file change). Net result: one entry per
 * knob-drag, before/after spanning the whole drag — never 60 lines. Cheap no-op when disabled.
 */
export function noteDaemonEdit(
  before: BeatDocument,
  after: BeatDocument,
  opts: { coalesced: boolean; gestureKey: string | undefined; surface: EditSurface; file: string },
): void {
  if (!editLogEnabled()) return
  if (opts.gestureKey === undefined) {
    flushEditLog()
    emit(before, after, opts.surface, opts.file)
    return
  }
  if (!opts.coalesced) {
    flushEditLog()
    pending = { before, after, surface: opts.surface, file: opts.file }
  } else if (pending) {
    pending.after = after
  } else {
    pending = { before, after, surface: opts.surface, file: opts.file }
  }
  scheduleIdleFlush()
}

/** Emit whatever gesture is currently buffered. Safe to call anytime (no-op when nothing is
 * pending). The daemon calls it on shutdown and on an external file change; tests call it to force
 * a deterministic flush without waiting on the idle timer. */
export function flushEditLog(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (!pending) return
  const p = pending
  pending = null
  emit(p.before, p.after, p.surface, p.file)
}

/** Test hook: drop any buffered gesture and forget the session id, so each test starts clean. */
export function resetEditLogForTest(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  pending = null
  sessionId = null
}

// ---- DiffEntry -> {op, path, before, after} -----------------------------------------------

interface Record {
  op: string
  path: string
  before: unknown
  after: unknown
}

const num = (n: number): number => Number(formatNumber(n))
const noteSummary = (n: { id: string; pitch: number; start: number; duration: number; velocity: number }) => ({
  id: n.id,
  pitch: n.pitch,
  start: num(n.start),
  duration: num(n.duration),
  velocity: num(n.velocity),
})
const hitSummary = (h: { id: string; lane: string; start: number; velocity: number }) => ({ id: h.id, lane: h.lane, start: num(h.start), velocity: num(h.velocity) })

/** Flattens the semantic diff into loggable records, giving each a `beat set`-style dotted path
 * when the edit is expressible that way (knob turns, note-field moves) and an entity locator
 * otherwise. Kept deliberately faithful to the diff vocabulary so the log reads like the GUI. */
function recordsFromDiff(entries: DiffEntry[]): Record[] {
  const out: Record[] = []
  for (const e of entries) {
    switch (e.kind) {
      case 'header':
        out.push({ op: e.kind, path: e.field, before: e.before, after: e.after })
        break
      case 'track-added':
        out.push({ op: e.kind, path: e.trackId, before: null, after: { kind: e.track.kind, name: e.track.name } })
        break
      case 'track-removed':
        out.push({ op: e.kind, path: e.trackId, before: { kind: e.track.kind, name: e.track.name }, after: null })
        break
      case 'track-meta':
        out.push({ op: e.kind, path: `${e.trackId}.${e.field}`, before: e.before, after: e.after })
        break
      case 'track-moved':
        out.push({ op: e.kind, path: e.trackId, before: e.before, after: e.after })
        break
      case 'track-groove':
        out.push({ op: e.kind, path: `${e.trackId}.${e.field}`, before: e.before, after: e.after })
        break
      case 'synth-param':
        out.push({ op: e.kind, path: `${e.trackId}.${e.param}`, before: e.before, after: e.after })
        break
      case 'instrument-param':
        out.push({ op: e.kind, path: `${e.trackId}.${e.param === 'soundfont' ? 'soundfont' : e.param}`, before: e.before, after: e.after })
        break
      case 'surge-param':
        out.push({ op: e.kind, path: `${e.trackId}.surge.${e.param}`, before: e.before, after: e.after })
        break
      case 'surge-override':
        out.push({ op: e.kind, path: `${e.trackId}.surge.override.${e.param}`, before: e.before, after: e.after })
        break
      case 'note-added':
        out.push({ op: e.kind, path: `${e.trackId}.note`, before: null, after: noteSummary(e.note) })
        break
      case 'note-removed':
        out.push({ op: e.kind, path: `${e.trackId}.note.${e.note.id}`, before: noteSummary(e.note), after: null })
        break
      case 'note-changed':
        for (const c of e.changes) out.push({ op: e.kind, path: `${e.trackId}.note.${e.noteId}.${c.field}`, before: c.before, after: c.after })
        break
      case 'hit-added':
        out.push({ op: e.kind, path: `${e.trackId}.hit`, before: null, after: hitSummary(e.hit) })
        break
      case 'hit-removed':
        out.push({ op: e.kind, path: `${e.trackId}.hit.${e.hit.id}`, before: hitSummary(e.hit), after: null })
        break
      case 'hit-changed':
        for (const c of e.changes) out.push({ op: e.kind, path: `${e.trackId}.hit.${e.hitId}.${c.field}`, before: c.before ?? null, after: c.after ?? null })
        break
      case 'clip-added':
        out.push({ op: e.kind, path: `${e.trackId}.clip.${e.clipId}`, before: null, after: e.clipId })
        break
      case 'clip-removed':
        out.push({ op: e.kind, path: `${e.trackId}.clip.${e.clipId}`, before: e.clipId, after: null })
        break
      case 'clip-changed':
        out.push({ op: e.kind, path: `${e.trackId}.clip.${e.clipId}`, before: null, after: { noteDelta: e.noteDelta, hitDelta: e.hitDelta } })
        break
      case 'clip-loop':
        out.push({ op: e.kind, path: `${e.trackId}.clip.${e.clipId}.loop`, before: e.before, after: e.after })
        break
      case 'clip-signature':
        out.push({ op: e.kind, path: `${e.trackId}.clip.${e.clipId}.signature`, before: e.before, after: e.after })
        break
      case 'automation-point-added':
        out.push({ op: e.kind, path: `${e.trackId}.clip.${e.clipId}.automation.${e.param}.${e.point.id}`, before: null, after: { time: num(e.point.time), value: num(e.point.value) } })
        break
      case 'automation-point-removed':
        out.push({ op: e.kind, path: `${e.trackId}.clip.${e.clipId}.automation.${e.param}.${e.point.id}`, before: { time: num(e.point.time), value: num(e.point.value) }, after: null })
        break
      case 'automation-point-changed':
        for (const c of e.changes) out.push({ op: e.kind, path: `${e.trackId}.clip.${e.clipId}.automation.${e.param}.${e.pointId}.${c.field}`, before: c.before, after: c.after })
        break
      case 'effect-added':
        out.push({ op: e.kind, path: `${e.trackId}.effect.${e.effect.id}`, before: null, after: { type: e.effect.type, enabled: e.effect.enabled } })
        break
      case 'effect-removed':
        out.push({ op: e.kind, path: `${e.trackId}.effect.${e.effect.id}`, before: { type: e.effect.type }, after: null })
        break
      case 'effect-moved':
        out.push({ op: e.kind, path: `${e.trackId}.effect.${e.effectId}`, before: e.before, after: e.after })
        break
      case 'effect-enabled':
        out.push({ op: e.kind, path: `${e.trackId}.effect.${e.effectId}.enabled`, before: e.before, after: e.after })
        break
      case 'lane-decl':
        out.push({ op: e.kind, path: `${e.trackId}.lane.${e.lane}`, before: e.before, after: e.after })
        break
      case 'lane-sample':
        out.push({ op: e.kind, path: `${e.trackId}.lane.${e.lane}`, before: e.before, after: e.after })
        break
      case 'media-added':
        out.push({ op: e.kind, path: `media.${e.sampleId}`, before: null, after: e.path })
        break
      case 'media-removed':
        out.push({ op: e.kind, path: `media.${e.sampleId}`, before: e.path, after: null })
        break
      case 'media-changed':
        out.push({ op: e.kind, path: `media.${e.sampleId}.${e.field}`, before: e.before, after: e.after })
        break
      case 'audio-region-added':
        out.push({ op: e.kind, path: `${e.trackId}.clip.${e.clipId}.audio`, before: null, after: { media: e.region.media, in: num(e.region.in), out: num(e.region.out) } })
        break
      case 'audio-region-removed':
        out.push({ op: e.kind, path: `${e.trackId}.clip.${e.clipId}.audio`, before: { media: e.region.media }, after: null })
        break
      case 'audio-region-changed':
        for (const c of e.changes) out.push({ op: e.kind, path: `${e.trackId}.clip.${e.clipId}.audio.${c.field}`, before: c.before, after: c.after })
        break
      case 'scene-added':
        out.push({ op: e.kind, path: `scene.${e.sceneId}`, before: null, after: e.sceneId })
        break
      case 'scene-removed':
        out.push({ op: e.kind, path: `scene.${e.sceneId}`, before: e.sceneId, after: null })
        break
      case 'scene-meta':
        out.push({ op: e.kind, path: `scene.${e.sceneId}.name`, before: e.before, after: e.after })
        break
      case 'scene-slot':
        out.push({ op: e.kind, path: `scene.${e.sceneId}.${e.trackId}@${num(e.at)}`, before: e.before, after: e.after })
        break
      case 'scene-slot-moved':
        out.push({ op: e.kind, path: `scene.${e.sceneId}.${e.trackId}.${e.clip}`, before: e.before, after: e.after })
        break
      case 'song-changed':
        out.push({ op: e.kind, path: 'song', before: e.before, after: e.after })
        break
      case 'group-added':
        out.push({ op: e.kind, path: `group.${e.groupId}`, before: null, after: { name: e.name, tracks: e.tracks } })
        break
      case 'group-removed':
        out.push({ op: e.kind, path: `group.${e.groupId}`, before: e.name, after: null })
        break
      case 'group-meta':
        out.push({ op: e.kind, path: `group.${e.groupId}.${e.field}`, before: e.before, after: e.after })
        break
      case 'group-tracks':
        out.push({ op: e.kind, path: `group.${e.groupId}.tracks`, before: e.before, after: e.after })
        break
    }
  }
  return out
}
