import { useEffect, useRef, useState } from 'react'
import { declaredLaneNames, type BeatClip, type BeatDocument, type BeatDrumHit, type BeatNote, type BeatTrack } from '../types'
import { postEdit, postSelection, postPitchTime, postPlaceClip, postLoadClip, postDuplicateNotes, newGestureId, type PitchTimeOp } from '../daemon/bridge'
import { engine } from '../audio/engine'
import { useStore } from '../state/store'
import { installKitLane, readDragPayload, LIBRARY_DND_MIME } from '../daemon/library'
import { makeDropTargetHandlers, DROP_TARGET_HOVER_CLASS, DRAGGING_CLASS } from '../dragDrop'
import { ClipPropertiesPanel, primaryClipFor, selectedSceneId } from './ClipPropertiesPanel'
import { DrumLanePanel } from './DrumLanePanel'
import { showToast } from '../state/toastStore'

// The editable event editor for BOTH synth/instrument notes and drum hits — Phase 22 Stream AB
// (docs/research/20-drum-clip-editor-redesign.md Part 5) generalized what was originally a
// pitch-only piano roll into one shared editor parameterized by a ROW AXIS, mirroring Ableton's
// own architecture: "the same MIDI Note Editor is used for all MIDI tracks... the note ruler's
// vertical axis displays octaves, or a list of drum pads if a Drum Rack is loaded" (research 20
// Part 1). Melodic tracks get the ORIGINAL pitch adapter, unchanged in behavior; drum tracks get a
// NEW named-lane adapter whose rows are the kit's declared lanes (research 19's open lane list, or
// the implicit 5 DRUM_LANES for a legacy/migrated track). StepSequencer.tsx is retired — this is
// now the only drum-clip editor (see App.tsx's BottomPane).
//
// Every edit round-trips through the daemon's POST /edit {path,value} primitive:
//   click empty grid  -> add       `<track>.note "<pitch> <start> <dur> <vel>"` / `<track>.hit "<lane> <start> <vel>"`
//   drag an event      -> move      `<track>.note.<id>.start|pitch` / `<track>.hit.<id>.start|lane`
//   drag its edge       -> resize    `<track>.note.<id>.duration` / `<track>.hit.<id>.duration`
//   double-click event -> delete    `<track>.note.<id>` / `<track>.hit.<id>` (empty value)
//   drag a velocity bar -> velocity  `<track>.note.<id>.velocity` / `<track>.hit.<id>.velocity`
// Each is one canonical line in the .beat file.
//
// A HIT with no duration (the common, "one-shot trigger" case — research 20 Part 3) renders as a
// fixed-width MARKER, not a resizable bar; dragging its right edge CREATES a duration (marker ->
// bar), the drum analogue of research 20 Part 2's "drag a note's edge to gate/sustain it." A NOTE
// always has a duration (the format requires one), so it's always a bar.
//
// Grid snap (research 20 Part 1's "soft, per-drag-bypassable snap," Ableton's exact model): plain
// drags snap start/duration to the nearest whole 16th step; holding Alt/Cmd bypasses snapping for
// a fully freehand (fractional) placement, which the format already stores losslessly (v0.7).
//
// Phase 17 Stream M's Ableton-standard multi-note controls (marquee, multi-select, group move/
// resize, keyboard nudge, velocity lane) are UNCHANGED in mechanism — every gesture below just
// operates on a `row` (an opaque index the axis translates to/from a pitch or lane name) instead
// of a raw `pitch`.

const ROW_H = 12
const DEFAULT_DUR = 2 // steps (an eighth note) — melodic notes only; a fresh hit has NO duration (a marker)
const DEFAULT_VEL = 0.8
const VEL_LANE_H = 46 // px — the velocity-lane strip below the note grid
const CHANCE_LANE_H = 24 // px — the chance-paint strip below the velocity lane (Phase 23 Stream BA)
const DRAG_THRESHOLD = 3 // px a pointer must move before a grid press counts as a marquee (vs. a tap-to-add)
const MARKER_W = 7 // px — a durationless hit's fixed-width marker (a diamond)

// ---- local time-zoom (Phase 28 Stream FD, follow-through 2, research/76 §2.5/§3 P1 item 4) -------
// `--note-step-w` used to be a single fixed 14px CSS custom property with no gesture anywhere in the
// component able to change it (confirmed by research 76 reading the whole file) — a materially bigger
// gap than "row height is a hardcoded constant" (research 71's original framing): Ableton treats
// MIDI-editor time-zoom as its single most load-bearing navigation primitive (research 76 §1.5).
// This is a per-NoteView-instance zoom, deliberately NOT touching the global `--note-step-w` default
// in :root (styles.css:10) or ArrangementView's own independent `zoomPxPerBar` — mirrors that same
// "null = default, number = explicit override" shape (ArrangementView.tsx's `zoomPxPerBar`) and the
// same button/wheel idiom (`zoomIn`/`zoomOut`, Cmd/Ctrl+scroll, `ZOOM_FACTOR` step), scoped locally by
// setting the CSS var inline on `.noteview-scroll` (which every step-w consumer in this file is a
// descendant of) instead of promoting it to a shared/global token.
const DEFAULT_STEP_W = 14 // px — matches --note-step-w's own :root default (styles.css:10)
const MIN_STEP_W = 4
const MAX_STEP_W = 56
const STEP_ZOOM_FACTOR = 1.4 // same step size ArrangementView.tsx's own ZOOM_FACTOR uses

// ---- ratchet visual glyph (Phase 23 Stream BA) --------------------------------------------------
// A lightweight, DISPLAY-ONLY mirror of src/core/pitchtime.ts's ratchetSlots edge math (ui/ has no
// build-time dependency on src/core — see engine.ts's own hand-mirror of the exact same formula for
// live playback). Returns the fractional (0..1) INTERNAL division points for `count` ratchet
// repeats shaped by `curve`, used only to paint tick marks on a ratcheted note in the piano roll —
// not audio-accurate scheduling (that's ratchetSlots/engine.ts's job).
function ratchetTicks(count: number, curve: number): number[] {
  if (count <= 1) return []
  const k = curve >= 0 ? 1 + curve * 3 : 1 / (1 - curve * 3)
  const ticks: number[] = []
  for (let i = 1; i < count; i++) ticks.push(Math.pow(i / count, k))
  return ticks
}

// ---- piano-key strip / pitch reference (Phase 19 Stream U, docs/phase-19-piano-roll-keys.md) ----
const KEY_W = 36 // px — width of the left-gutter strip (piano keys, or lane-name labels)
const MIN_SPAN = 48 // semitones (4 octaves) — the minimum pitch window, even for a sparse clip
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const BLACK_PCS = new Set([1, 3, 6, 8, 10]) // pitch-classes that are black keys
const pc = (pitch: number) => ((pitch % 12) + 12) % 12
const isBlackKey = (pitch: number) => BLACK_PCS.has(pc(pitch))
/** Scientific pitch notation: MIDI 60 = C4 (middle C), 0 = C-1. Used for the key labels. */
const pitchName = (pitch: number) => `${NOTE_NAMES[pc(pitch)]}${Math.floor(pitch / 12) - 1}`

// ---- Clip View title bar (Phase 27 Stream ED, docs/research/71-ux-clip-view-midi-editing.md §3
// P0 item 1) — Ableton's colored clip title strip is "the single strongest 'what am I editing'
// visual anchor in the whole view" (research 71 §1.1); dotbeat had no colored anchor at all, just
// small colored text buried in .editor-title. Picks readable text (near-black or near-white)
// against the track's own color rather than hardcoding one, since track.color is user-set and can
// land anywhere on the lightness scale.
export function readableTextOn(hex: string): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return '#0b0c10'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) return '#0b0c10'
  // perceptual luminance (ITU-R BT.601 weights) — good enough for a binary light/dark text pick
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#0b0c10' : '#f5f6f8'
}

// ---- the row axis (research 20 Part 5) ------------------------------------------------------
// `row` is always TOP-TO-BOTTOM visual order (row 0 = the top row, `top: row * ROW_H`) — this is
// the one abstraction every pointer/keyboard computation below is written against, so the melodic
// "higher pitch = smaller row" inversion and the drum "declaration order = row order" mapping are
// both just details of how a concrete axis implements rowOfValue/valueOfRow, not two code paths.
interface RowAxis {
  rowCount: number
  rowLabel(row: number): string
  isBlackRow(row: number): boolean // decoration only; always false for the lane adapter
  rowOfValue(value: number | string): number
  valueOfRow(row: number): number | string
  /** Row delta for Shift+Up/Down (an octave, for pitch); 0 disables the shift-nudge entirely —
   * research 20 Part 5: drum rows have "no pitch clamp, no octave nudge." */
  octaveRows: number
  /** Click a row label: audition it, and (lanes only) narrow the vary-scope selection to it —
   * the exact behavior StepSequencer's lane-label click had (Phase 16 Stream J), preserved here. */
  preview(trackId: string, row: number): void
}

/** The pitch window's own [lo,hi] bounds (Phase 29 Stream GC bug 2, research 80/83) — factored out of
 * `buildPitchAxis` so the NoteView component can FREEZE it per-track (see `pitchWindowRef` below)
 * instead of recomputing it fresh from whatever `notes` happen to exist on every render. Recomputing
 * on every render was the actual root cause of "the visible pitch window silently shifts... each
 * time a note lands" (research 83): before the first note existed, `usedLo`/`usedHi` both fell back
 * to 60 (middle C); the moment the first note landed, they became that note's own pitch, snapping the
 * whole window to a different octave out from under the user — and this kept happening on every
 * later edit that changed the current min/max pitch in play, not just the first one. */
function computePitchWindow(notes: BeatNote[]): { lo: number; hi: number } {
  // A generous, octave-snapped range AROUND the clip's content — deliberately not clipped to the
  // used notes (Ableton shows a scrollable full-range ruler; we render a padded window that always
  // spans >= MIN_SPAN so a sparse clip still gets a real keyboard).
  const pitches = notes.map((n) => n.pitch)
  const usedLo = notes.length ? Math.min(...pitches) : 60
  const usedHi = notes.length ? Math.max(...pitches) : 60
  let lo = Math.floor((usedLo - 12) / 12) * 12 // pad an octave below, snap down to a C
  let hi = Math.ceil((usedHi + 13) / 12) * 12 - 1 // pad an octave above, snap up to a B (octave top)
  if (hi - lo + 1 < MIN_SPAN) {
    const center = Math.round((lo + hi) / 2)
    lo = Math.floor((center - MIN_SPAN / 2) / 12) * 12
    hi = lo + MIN_SPAN - 1
  }
  lo = Math.max(0, lo)
  hi = Math.min(127, hi)
  return { lo, hi }
}

function buildPitchAxis(window: { lo: number; hi: number }): RowAxis {
  const { lo, hi } = window
  const rowCount = hi - lo + 1
  return {
    rowCount,
    rowLabel: (row) => pitchName(hi - row),
    isBlackRow: (row) => isBlackKey(hi - row),
    rowOfValue: (value) => hi - (value as number),
    valueOfRow: (row) => hi - row,
    octaveRows: 12,
    preview: (trackId, row) => void engine.previewNote(trackId, hi - row, DEFAULT_VEL),
  }
}

function buildLaneAxis(track: BeatTrack): RowAxis {
  const lanes = declaredLaneNames(track)
  return {
    rowCount: lanes.length,
    rowLabel: (row) => lanes[row] ?? '',
    isBlackRow: () => false,
    rowOfValue: (value) => lanes.indexOf(value as string),
    valueOfRow: (row) => lanes[row] ?? lanes[0]!,
    octaveRows: 0, // no octave nudge for drum lanes (research 20 Part 5)
    preview: (trackId, row) => {
      const lane = lanes[row]
      if (!lane) return
      // Lane-granular selection (Phase 16 Stream J, preserved from StepSequencer): clicking a lane
      // label scopes vary to just this lane's own param group, and previews it.
      postSelection({ tracks: [trackId], lanes: [{ track: trackId, lane }] })
      void engine.previewDrum(lane)
    },
  }
}

// One editor event, whatever its source (BeatNote or BeatDrumHit) — `row` comes from the active
// RowAxis; `duration` is `undefined` only for a durationless hit (a marker; never for a note, the
// format requires one).
interface EditorEvent {
  id: string
  start: number
  duration: number | undefined
  velocity: number
  row: number
  // v0.10 note-only fields (Phase 23 Stream BA) — undefined for a drum hit (BeatDrumHit carries
  // none of these). Drive the piano-roll's at-a-glance chance/ratchet glyphs and the chance-paint
  // lane; the values themselves are edited via NoteInspector or the chance lane below, never here.
  chance?: number
  ratchetCount?: number
  ratchetCurve?: number
}

type GroupEv = { id: string; origStart: number; origRow: number; origDur: number | undefined }
type Gesture = {
  kind: 'move' | 'resize'
  primaryId: string
  rect: DOMRect
  stepW: number
  downX: number
  downY: number
  group: GroupEv[]
  // Phase 26 Stream DG: Alt/Option held at the START of a 'move' drag (captured once, here, not
  // read continuously like the freehand-snap-bypass check below) — Ableton's own "hold the
  // modifier, drag copies instead of moves" model [research 57 item #2]. Cmd/Ctrl can't serve this
  // role: holding it at press-time already means "toggle selection, don't start a drag" (see
  // startGesture's early-return above this flag's own assignment), so Alt is the only modifier
  // free to mean "duplicate" at gesture-start. Notes only (eventKind — drum hits have no
  // duplicateNotes equivalent yet); always false for a 'resize' gesture.
  duplicate: boolean
  // Phase 29 Stream GC bug 4 (research 83): tracks whether the pointer has moved past DRAG_THRESHOLD
  // since gesture-start — the SAME "was this a tap or a real drag" distinction Marquee's own `moved`
  // flag makes. Lets `onPointerUp` tell a plain click on an already-selected note (which should
  // narrow the selection to just that one note) apart from an actual drag (which should leave a
  // multi-selection intact and move/resize the whole group).
  moved: boolean
}

// Phase 26 Stream DG: a basic clipboard — remembers WHICH notes (by id, on which track) were last
// copied, not a snapshot of their data. Paste re-resolves those ids against the live track and
// calls the SAME duplicateNotes primitive the Alt-drag gesture uses, so "copy then paste" and
// "Alt-drag" are two call sites sharing one core operation, per research 57 item #2's own
// recommendation. Module-level (not component state): the clipboard is GUI/daemon-local, never
// written to the .beat file, and should survive switching which track's NoteView is mounted.
type NoteClipboard = { trackId: string; noteIds: string[]; anchorStart: number }
let noteClipboard: NoteClipboard | null = null

// A live marquee (rubber-band) drag on empty grid space. `base` is the selection captured at
// pointer-down so a shift-drag adds to it; without a modifier the enclosed notes replace it.
type Marquee = { rect: DOMRect; stepW: number; downX: number; downY: number; curX: number; curY: number; base: string[]; additive: boolean; moved: boolean }

type Preview = { start: number; row: number; duration: number | undefined }
// Phase 28 Stream FD, follow-through 1 (research/76 §1.1/§3 P1 item 3): the velocity lane used to
// anchor its drag gesture to the single note pressed (`{ id, rect }`). It's now a paint-ACROSS-notes
// gesture, the same mechanism the chance lane already shipped (`chanceGesture`/`paintChanceAt`) — so
// it only needs the lane's own rect, not a captured note id; which note(s) are under the pointer is
// re-evaluated every move, same as chance's.
type VelGesture = { rect: DOMRect }

/** Map a pointer's clientY within the velocity lane's rect to a 0..1 velocity (top = loudest,
 * bottom = softest — same convention as a DAW velocity lane). Floored at 0.05, not 0: a note at
 * velocity 0 wouldn't sound, and this gesture edits an existing (already-sounding) note. */
function velocityFromY(rect: DOMRect, clientY: number): number {
  const y = Math.max(0, Math.min(rect.height, clientY - rect.top))
  return Math.round(Math.max(0.05, Math.min(1, 1 - y / rect.height)) * 100) / 100
}

/** Snap toward the nearest 16th step unless freehand-bypassed (Alt/Cmd held) — research 20 Part 1's
 * "soft, per-drag-bypassable snap." Used for MOVE/RESIZE drags, where "nearest gridline" is the
 * right question (an event's `start`/`duration` boundary IS a gridline). */
function snapStep(raw: number, freehand: boolean): number {
  return freehand ? Math.round(raw * 10000) / 10000 : Math.round(raw)
}

/** Click-to-add cell resolution (Phase 29 Stream GC bug 1, research 80 — exact repro at the old
 * NoteView.tsx:462): which STEP CELL contains this click, NOT "which gridline is nearest." A step
 * N's visual cell spans gridline N to gridline N+1, but `snapStep`'s round-to-nearest-gridline gives
 * a click-target region for step N centered ON gridline N (spanning N-0.5..N+0.5) — offset by half a
 * cell from the visible grid. Clicking the right half of what looks like "step N" silently landed the
 * note on N+1. Flooring instead of rounding makes the click-target region exactly match the visible
 * cell (N..N+1). Freehand bypass (Alt/Cmd) is unaffected — it already returns the raw fractional
 * position, same as `snapStep`'s own freehand branch, since there's no "nearest cell" question once
 * grid-snapping itself is bypassed. */
function cellStep(raw: number, freehand: boolean): number {
  return freehand ? Math.round(raw * 10000) / 10000 : Math.floor(raw)
}

// ---- clip-view playhead resolution (Phase 24 Stream CG bug fix) --------------------------------
// `currentStep` from the store is the ABSOLUTE song-timeline step once a real `song` array exists
// (engine.ts's tick(): `step = rawStep % totalSteps` where `totalSteps` is the whole song's length,
// not one clip's). Rendering the playhead directly against `currentStep` (the old bug) made the
// line disappear almost immediately in song mode, since it only stayed inside `[0, loopBars*16)`
// for the first section. Fixed by mirroring engine.ts's own `contentOf` resolution: find which
// section is playing right now, check whether ITS scene maps this track to the SAME clip NoteView
// is displaying, and if so convert the absolute step to a clip-relative, tiled position with the
// exact same modulo math `contentOf` uses for real playback.
//
/** Returns the clip-relative, tiled step to render the playhead at, or `null` if no playhead
 * should render at all (stopped, or the open clip isn't the one actually playing right now).
 * `preferredSceneId` (Phase 29 Stream GA) is store.ts's `selectedSectionIndex`, pre-resolved to a
 * scene id by the caller — same "which clip is actually open" resolution primaryClip below uses. */
function resolveClipPlayhead(
  track: BeatTrack,
  doc: BeatDocument | null,
  currentStep: number,
  loopBars: number,
  preferredSceneId: string | null,
): number | null {
  if (!doc || currentStep < 0) return null
  const song = doc.song && doc.song.length > 0 ? doc.song : null
  const loopSteps = loopBars * 16
  if (!song) {
    // Loop mode (no song block): engine.ts's tick() computes `step` as `rawStep % (loopBars*16)`
    // directly whenever there's no song array, so `currentStep` IS already clip-relative — same
    // condition this playhead always used before song mode existed.
    return currentStep < loopSteps ? currentStep : null
  }
  const openClip = primaryClipFor(track, doc, preferredSceneId)
  if (!openClip) return null
  // Which section is playing right now, from the absolute step — the same cumulative-bars walk
  // engine.ts's contentOf does from `bar`.
  const bar = Math.floor(currentStep / 16)
  let cursor = 0
  let sectionStartBar = 0
  let sceneId: string | null = null
  for (const section of song) {
    if (bar < cursor + section.bars) {
      sectionStartBar = cursor
      sceneId = section.scene
      break
    }
    cursor += section.bars
  }
  if (sceneId === null) return null
  const scene = doc.scenes.find((s) => s.id === sceneId)
  const clipId = scene?.slots[track.id]
  if (!clipId || clipId !== openClip.id) return null // this track isn't playing the open clip right now
  const rel = currentStep - sectionStartBar * 16
  return ((rel % loopSteps) + loopSteps) % loopSteps
}

// ---- live-buffer <-> clip sync (Phase 29 Stream GA) ----------------------------------------------
// This editor always renders `track.notes`/`track.hits` — the track's ONE live buffer — never a
// clip's own `.notes`/`.hits` directly (see this file's header comment). `primaryClipFor` resolving
// to the selected section's clip is necessary but not sufficient to make clicking a later section's
// clip block actually "open" it here: the live buffer itself has to be swapped to match. `sortById`
// normalizes order before comparing so two arrays that happen to have been rebuilt in a different
// order (e.g. after a round-trip through the daemon) still compare equal by content.
function sortById<T extends { id: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => a.id.localeCompare(b.id))
}
function eventsEqual<T extends { id: string }>(a: T[], b: T[]): boolean {
  return a.length === b.length && JSON.stringify(sortById(a)) === JSON.stringify(sortById(b))
}
/** Does `clip`'s saved content already match what's live on `track` right now? True also means "no
 * load needed" — the editor is already showing this clip's content. */
function clipMatchesLive(track: BeatTrack, clip: BeatClip): boolean {
  return track.kind === 'drums' ? eventsEqual(track.hits, clip.hits) : eventsEqual(track.notes, clip.notes)
}
/** Is the track's current live content NOT backed by any existing clip? If so, loading a different
 * clip over it would silently discard real, never-saved composition — the one case worth an
 * explicit confirm before swapping (an empty live buffer, or one that already matches some clip,
 * loads over silently — same "nothing at risk" bar saveClip's own re-snapshot already assumes). */
function liveContentIsUnsaved(track: BeatTrack): boolean {
  const live = track.kind === 'drums' ? track.hits : track.notes
  if (live.length === 0) return false
  return !track.clips.some((c) => clipMatchesLive(track, c))
}

export function NoteView({ track }: { track: BeatTrack }) {
  const doc = useStore((s) => s.doc)
  const loopBars = doc?.loopBars ?? 1
  const currentStep = useStore((s) => s.currentStep)
  const sel = useStore((s) => s.editNoteIds)
  const setSel = useStore((s) => s.setEditNoteIds)
  // Phase 24 Stream CH: "audition this clip" — plays THIS track's own live notes/hits (what this
  // view edits) regardless of song position; see engine.ts's auditionClip/stopAudition doc comments
  // for why that's otherwise inaudible in song mode. `auditioning` is true only when THIS track is
  // the one being previewed (another track's audition, if that were ever possible concurrently,
  // wouldn't flip this button — though in practice only one audition ever runs at a time).
  const auditioningTrackId = useStore((s) => s.auditioningTrackId)
  const auditioning = auditioningTrackId === track.id
  // Phase 29 Stream GA: which song section the user is currently pointed at, alongside the track
  // selection above — resolved to a scene id once here and threaded through every "which clip"
  // lookup below (the playhead, the loop-drag handle/properties, Place in Arrangement, and the
  // live-buffer sync effect further down), so they all agree on the same answer. `null` (nothing
  // selected, or the index no longer resolves) falls back to the old first-occurrence behavior
  // everywhere, unchanged.
  const selectedSectionIndex = useStore((s) => s.selectedSectionIndex)
  const preferredSceneId = selectedSceneId(doc, selectedSectionIndex)
  const totalSteps = loopBars * 16
  const playheadStep = resolveClipPlayhead(track, doc, currentStep, loopBars, preferredSceneId)
  // Phase 24 Stream CJ: the SAME "primary clip" ClipPropertiesPanel.tsx's numeric loop fields
  // target — null in loop mode or when this track isn't mapped to a saved clip in any scene yet
  // (same gating the properties panel already applies; the drag handle below is hidden in that
  // case too, since there's no clip.loop to write). Phase 29 Stream GA: now prefers the selected
  // section's scene, same as everywhere else in this file.
  const primaryClip = doc ? primaryClipFor(track, doc, preferredSceneId) : null
  const isDrums = track.kind === 'drums'
  const editable = true // every track kind (synth/instrument/drums) edits through this one view now
  const eventKind: 'note' | 'hit' = isDrums ? 'hit' : 'note'
  const editPrefix = eventKind // "<track>.note.*" / "<track>.hit.*" — matches core's edit.ts exactly

  const pitchWindowRef = useRef<{ trackId: string; lo: number; hi: number } | null>(null)
  // Phase 29 Stream GC bug 2 (research 80/83): freeze the pitch window per-track, in a ref, instead
  // of recomputing it fresh from `track.notes` on every render — the recompute-every-render version
  // silently re-centered the visible pitch range on every note add/edit that changed the current
  // min/max pitch. Recomputes only when the SELECTED TRACK itself changes (same "recompute only on
  // track.id change" precedent `MacroKnob`'s own display estimate already uses elsewhere in the app),
  // which a user experiences as an intentional navigation, not an edit-triggered jump. Every pointer/
  // keyboard mutation in this file clamps new events to the CURRENTLY rendered `rows` (0..rowCount-1)
  // before writing them, so a frozen window can never leave an event unrepresentable.
  if (!isDrums && pitchWindowRef.current?.trackId !== track.id) {
    pitchWindowRef.current = { trackId: track.id, ...computePitchWindow(track.notes) }
  }
  const axis = isDrums ? buildLaneAxis(track) : buildPitchAxis(pitchWindowRef.current!)
  const events: EditorEvent[] = isDrums
    ? track.hits.map((h) => ({ id: h.id, start: h.start, duration: h.duration, velocity: h.velocity, row: axis.rowOfValue(h.lane) }))
    : track.notes.map((n) => ({
        id: n.id,
        start: n.start,
        duration: n.duration,
        velocity: n.velocity,
        row: axis.rowOfValue(n.pitch),
        chance: n.chance,
        ratchetCount: n.ratchetCount,
        ratchetCurve: n.ratchetCurve,
      }))

  // Phase 29 Stream GA: sync the live buffer to the selected section's clip whenever WHICH clip
  // we're supposed to be showing changes — i.e. when the user switches track or section, not on
  // every doc update (an in-progress edit to an already-placed clip re-saves identically each
  // keystroke; re-running this on every doc change would otherwise re-check, and worse, could
  // prompt, on every single edit). `lastSyncRef` remembers the last (track, section) pair actually
  // synced so the effect body only does real work when that pair changes; deps are deliberately
  // JUST [track.id, selectedSectionIndex] for the same reason — `doc` is read fresh from the store
  // inside instead of as a dependency.
  const lastSyncRef = useRef<string | null>(null)
  useEffect(() => {
    const key = `${track.id}::${selectedSectionIndex ?? 'none'}`
    if (lastSyncRef.current === key) return
    lastSyncRef.current = key
    if (selectedSectionIndex === null) return // nothing selected — old first-occurrence behavior stands
    const st = useStore.getState()
    const d = st.doc
    const section = d?.song?.[selectedSectionIndex]
    if (!d || !section) return
    const scene = d.scenes.find((s) => s.id === section.scene)
    const clipId = scene?.slots[track.id]
    if (!clipId) return // this track has no clip in the selected section — leave the live buffer alone
    const t = d.tracks.find((x) => x.id === track.id)
    const clip = t?.clips.find((c) => c.id === clipId)
    if (!t || !clip || clipMatchesLive(t, clip)) return // already showing it
    const proceed =
      !liveContentIsUnsaved(t) ||
      window.confirm(
        `This track's editor has content that hasn't been placed into any clip yet. Switching to this section's clip ("${clip.id}") will replace it. Continue?`,
      )
    if (proceed) void postLoadClip(track.id, clip.id).catch((err) => showToast(`Could not load clip: ${(err as Error).message}`))
  }, [track.id, selectedSectionIndex])

  const selSet = new Set(sel)
  // Preview overrides during a drag: a map keyed by event id (a group move/resize previews many at once).
  const [preview, setPreview] = useState<Record<string, Preview> | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const marqueeRef = useRef<Marquee | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  // Phase 28 Stream FD, follow-through 1: keyed by event id (like `chancePreview` below), not a
  // single `{ id, velocity }` — a paint-across-notes drag can touch more than one bar per gesture.
  const [velPreview, setVelPreview] = useState<Record<string, number> | null>(null)
  // Phase 27 Stream EE: live floating value labels while dragging a velocity/chance marker, the same
  // "small pill near the cursor, imperative viewport-relative positioning" pattern ArrangementView.tsx's
  // automation-lane drag already established (its `dragLabelRef`/`showLabel` next to `.arr-auto-drag-label`)
  // — reused here as plain conditional JSX since this component already re-renders per pointer move for
  // the preview bars themselves, so a second imperative DOM path would just be redundant. Static `title`
  // tooltips required a pointer-stop-and-wait; this echoes the value live, every move, like a DAW's status
  // bar readout during a drag.
  const [velDragLabel, setVelDragLabel] = useState<{ x: number; y: number; value: number } | null>(null)
  const [chanceDragLabel, setChanceDragLabel] = useState<{ x: number; y: number; value: number } | null>(null)
  // Content-browser drop target for drum lanes (ported from the retired StepSequencer.tsx, Phase
  // 22 Stream AH originally, Stream AB's row-axis merge here): dropping a kit one-shot onto a
  // lane's label cell loads it onto THIS lane, even if the sample's own kit slot names a different
  // one (installKitLane's targetLane override).
  const [dropHoverRow, setDropHoverRow] = useState<number | null>(null)
  const velGesture = useRef<VelGesture | null>(null)
  // Chance-paint lane (Phase 23 Stream BA, research 22 §1.4's PropertyDrawModifier reference): a
  // draw-ACROSS-notes gesture — Phase 28 Stream FD generalized the same mechanism onto the velocity
  // lane above (`velPreview`/`velGesture`/`paintVelocityAt`), so the two are now symmetric. `chancePreview`
  // accumulates every note the pointer has painted so far this drag, keyed by note id, so multiple
  // notes update live as the pointer sweeps across them; commit fans out one postEdit per touched
  // note on release. Note-only (drum hits carry no chance field) — the velocity lane's own version
  // below has no such restriction since both notes and drum hits carry a velocity.
  const [chancePreview, setChancePreview] = useState<Record<string, number> | null>(null)
  const chanceGesture = useRef<{ rect: DOMRect } | null>(null)

  // Local time-zoom (Phase 28 Stream FD, follow-through 2): null = the global --note-step-w default
  // (DEFAULT_STEP_W, 14px); a number pins an explicit override, same "null = default" shape as
  // ArrangementView.tsx's own `zoomPxPerBar`. Session-only — never written to the .beat file, same
  // treatment as that component's zoom state.
  const [stepZoom, setStepZoom] = useState<number | null>(null)
  const stepW = stepZoom ?? DEFAULT_STEP_W
  const zoomIn = () => setStepZoom((z) => Math.min(MAX_STEP_W, (z ?? DEFAULT_STEP_W) * STEP_ZOOM_FACTOR))
  const zoomOut = () => setStepZoom((z) => Math.max(MIN_STEP_W, (z ?? DEFAULT_STEP_W) / STEP_ZOOM_FACTOR))
  const zoomReset = () => setStepZoom(null)
  // Cmd/Ctrl+scroll over the note grid zooms, same modifier ArrangementView.tsx's own `onWheelZoom`
  // uses for its timeline (plain wheel still scrolls normally — only the modified case is intercepted).
  function onNoteGridWheelZoom(e: React.WheelEvent<HTMLDivElement>) {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    const cur = stepZoom ?? DEFAULT_STEP_W
    const next = Math.max(MIN_STEP_W, Math.min(MAX_STEP_W, cur * (e.deltaY < 0 ? STEP_ZOOM_FACTOR : 1 / STEP_ZOOM_FACTOR)))
    setStepZoom(next)
  }

  const rows = axis.rowCount
  const gridH = rows * ROW_H

  function toggleSel(id: string) {
    setSel(selSet.has(id) ? sel.filter((s) => s !== id) : [...sel, id])
  }

  // ---- move/resize commit helpers: fan out per-event edit primitives (one .beat line per event) ----
  // `gestureId` (Phase 30 Stream JB, research/89): a diagonal move changes BOTH `.start` and
  // `.pitch`/`.lane` — two separate /edit calls, two separate default undo-coalescing buckets (keyed
  // by path) unless stamped with the same gestureId so the daemon treats them as one commit. See
  // onPointerUp below, which mints one gestureId per commit and threads it through every call in the
  // whole group (covers a multi-note move too — one gestureId for every note's fields, not one per
  // note). bridge.ts's newGestureId doc comment has the full "why".
  function commitMove(id: string, start: number, row: number, origStart: number, origRow: number, gestureId?: string) {
    if (start !== origStart) postEdit(`${track.id}.${editPrefix}.${id}.start`, String(start), gestureId)
    if (row !== origRow) {
      const field = eventKind === 'note' ? 'pitch' : 'lane'
      postEdit(`${track.id}.${editPrefix}.${id}.${field}`, String(axis.valueOfRow(row)), gestureId)
    }
  }

  /** Clamp a (dStep, dRow) translation so EVERY event in the group stays in bounds, preserving the
   * group's relative offsets (Ableton moves the whole selection as a rigid body and stops it when
   * any note hits an edge). */
  function clampGroupMove(group: { origStart: number; origRow: number }[], dStep: number, dRow: number): [number, number] {
    const starts = group.map((g) => g.origStart)
    const rowsArr = group.map((g) => g.origRow)
    const ds = Math.max(-Math.min(...starts), Math.min(totalSteps - 1 - Math.max(...starts), dStep))
    const dr = Math.max(-Math.min(...rowsArr), Math.min(rows - 1 - Math.max(...rowsArr), dRow))
    return [ds, dr]
  }

  // ---- marquee (drag on empty grid) + tap-to-add ----
  function onGridPointerDown(e: React.PointerEvent) {
    if (!editable) return
    // Only fires for empty grid space — event/handle children stopPropagation their own pointerdowns.
    const rect = e.currentTarget.getBoundingClientRect()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    // Phase 29 Stream GC bug 5 (research 84): `.focus()` with no options lets the browser's default
    // "scroll the newly-focused element into view" behavior fire — for a tall grid that's only
    // partially in the visible viewport, that can silently jump the scroll position (observed as a
    // full-octave drift) as a pure side effect of grabbing keyboard focus, unrelated to anything the
    // user asked to scroll. `preventScroll: true` keeps the focus-for-keyboard-shortcuts behavior
    // without the scroll side effect.
    gridRef.current?.focus({ preventScroll: true })
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    const m: Marquee = { rect, stepW: rect.width / totalSteps, downX: e.clientX, downY: e.clientY, curX: e.clientX, curY: e.clientY, base: additive ? [...sel] : [], additive, moved: false }
    marqueeRef.current = m
    setMarquee(m)
  }

  function onGridPointerMove(e: React.PointerEvent) {
    const m = marqueeRef.current
    if (!m) return
    m.curX = e.clientX
    m.curY = e.clientY
    if (Math.abs(e.clientX - m.downX) > DRAG_THRESHOLD || Math.abs(e.clientY - m.downY) > DRAG_THRESHOLD) m.moved = true
    setMarquee({ ...m }) // re-render the rubber-band rectangle
    if (!m.moved) return
    // Which events does the marquee rect touch? (any overlap in both time and row, in grid px)
    const x0 = Math.min(m.downX, e.clientX) - m.rect.left
    const x1 = Math.max(m.downX, e.clientX) - m.rect.left
    const y0 = Math.min(m.downY, e.clientY) - m.rect.top
    const y1 = Math.max(m.downY, e.clientY) - m.rect.top
    const hit = events
      .filter((ev) => {
        const w = ev.duration !== undefined ? ev.duration : 0
        const ex0 = ev.start * m.stepW
        const ex1 = ex0 + Math.max(w * m.stepW, MARKER_W)
        const ey0 = ev.row * ROW_H
        const ey1 = ey0 + ROW_H
        return ex0 < x1 && ex1 > x0 && ey0 < y1 && ey1 > y0
      })
      .map((ev) => ev.id)
    setSel(m.additive ? Array.from(new Set([...m.base, ...hit])) : hit)
  }

  function onGridPointerUp(e: React.PointerEvent) {
    const m = marqueeRef.current
    marqueeRef.current = null
    setMarquee(null)
    if (!m) return
    if (m.moved) return // marquee already set the selection live
    // No drag -> it was a tap on empty space: add an event here (keeps the existing click-to-add),
    // and (Ableton-style) collapse any multi-selection since the click landed on empty grid.
    const stepW = m.rect.width / totalSteps
    const freehand = e.altKey || e.metaKey
    const step = Math.max(0, Math.min(totalSteps - 1, cellStep((e.clientX - m.rect.left) / stepW, freehand)))
    const row = Math.floor((e.clientY - m.rect.top) / ROW_H)
    if (row < 0 || row >= rows) return
    setSel([])
    if (eventKind === 'note') {
      postEdit(`${track.id}.note`, `${axis.valueOfRow(row)} ${step} ${DEFAULT_DUR} ${DEFAULT_VEL}`)
    } else {
      // A freshly-added hit has NO duration — a marker/one-shot trigger (research 20 Part 3).
      postEdit(`${track.id}.hit`, `${axis.valueOfRow(row)} ${step} ${DEFAULT_VEL}`)
    }
  }

  // ---- move / resize (drag an event or its right edge) ----
  function startGesture(kind: 'move' | 'resize', ev: EditorEvent, e: React.PointerEvent) {
    if (!editable) return
    e.stopPropagation()
    // Modifier + press on an event is a selection toggle, not a drag (Ableton shift/cmd-click).
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      toggleSel(ev.id)
      return
    }
    e.preventDefault()
    const gridEl = e.currentTarget.closest('.noteview-grid') as HTMLElement
    const rect = gridEl.getBoundingClientRect()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    // Phase 29 Stream GC bug 5 (research 84): same `preventScroll` fix as the grid's own tap/marquee
    // focus above — this is the exact call site pilot 84 traced the resize-drag octave drift to
    // (`gridEl.focus()`, no options, triggering the browser's default scroll-into-view for an
    // off/partially-off-screen grid element the instant a resize-handle drag starts).
    gridEl.focus({ preventScroll: true })
    // Pressing an UNselected event selects just it (clearing others), then drags it. Pressing an
    // event already in the selection keeps the selection and drags the whole group.
    let groupIds: Set<string>
    if (selSet.has(ev.id)) {
      groupIds = selSet
    } else {
      groupIds = new Set([ev.id])
      setSel([ev.id])
    }
    const group: GroupEv[] = events.filter((e2) => groupIds.has(e2.id)).map((e2) => ({ id: e2.id, origStart: e2.start, origRow: e2.row, origDur: e2.duration }))
    // Alt/Option held right now (gesture-start only — see the Gesture type's own doc comment for
    // why Cmd/Ctrl can't play this role) turns this into a duplicate-drag instead of a move.
    const duplicate = kind === 'move' && eventKind === 'note' && e.altKey
    gesture.current = { kind, primaryId: ev.id, rect, stepW: rect.width / totalSteps, downX: e.clientX, downY: e.clientY, group, duplicate, moved: false }
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current
    if (!g) return
    // Phase 29 Stream GC bug 4: same DRAG_THRESHOLD "was this a real drag" check Marquee's own
    // `moved` flag uses — read by `onPointerUp` to tell a plain click apart from an actual drag.
    if (!g.moved && (Math.abs(e.clientX - g.downX) > DRAG_THRESHOLD || Math.abs(e.clientY - g.downY) > DRAG_THRESHOLD)) g.moved = true
    const primary = g.group.find((x) => x.id === g.primaryId)!
    const freehand = e.altKey || e.metaKey
    const next: Record<string, Preview> = {}
    if (g.kind === 'move') {
      const dStepsRaw = snapStep((e.clientX - (g.rect.left + primary.origStart * g.stepW)) / g.stepW, freehand)
      const dRowsRaw = Math.round((e.clientY - (g.rect.top + primary.origRow * ROW_H)) / ROW_H)
      const [ds, dr] = clampGroupMove(g.group, dStepsRaw, dRowsRaw)
      for (const gn of g.group) next[gn.id] = { start: gn.origStart + ds, row: gn.origRow + dr, duration: gn.origDur }
    } else {
      // Group resize is UNIFORM-DELTA (Ableton): every selected event's duration shifts by the same
      // number of steps the dragged edge moved, each clamped to >=0 (a hit may end back at "no
      // duration" — see the commit step) and to the loop's end.
      const dDur = snapStep((e.clientX - g.downX) / g.stepW, freehand)
      for (const gn of g.group) {
        const base = gn.origDur ?? 0
        const duration = Math.max(0, Math.min(totalSteps - gn.origStart, base + dDur))
        next[gn.id] = { start: gn.origStart, row: gn.origRow, duration }
      }
    }
    setPreview(next)
  }

  function onPointerUp() {
    const g = gesture.current
    const p = preview
    gesture.current = null
    setPreview(null)
    if (!g) return
    // Phase 29 Stream GC bug 4 (research 83): a plain click (no real drag) on a note that was
    // already part of a larger selection should narrow the selection down to just that one note —
    // every conventional note editor treats "click an item, selected or not" this way. Previously
    // `startGesture` only narrowed when the PRESSED note was unselected; pressing an already-selected
    // note kept dragging the whole group, and since a non-moved gesture's move/resize deltas are all
    // zero anyway (nothing to commit), the selection just silently stayed as the full multi-select —
    // an empty-cell click was the only way to get back to a single-note selection. Checked BEFORE the
    // `!p` bail-out below: a true zero-movement click never fires `onPointerMove`, so `preview` (`p`)
    // stays null for the whole gesture — a check gated on `p` would never see this case at all. Skips
    // this for a real drag (`g.moved`) or a single-note group (nothing to narrow).
    if (!g.moved && g.group.length > 1) {
      setSel([g.primaryId])
      return
    }
    if (!p) return
    if (g.duplicate) {
      // Alt-drag: commit via duplicateNotes instead of commitMove — the ORIGINALS stay exactly
      // where they were, a fresh copy of the whole group lands wherever the pointer released. The
      // group moves as one rigid body (clampGroupMove), so every event shares the same delta —
      // read it once off the primary event rather than per-event.
      const primary = g.group.find((x) => x.id === g.primaryId)!
      const pv = p[primary.id]
      if (pv) {
        const offsetStart = Math.round((pv.start - primary.origStart) * 10000) / 10000
        const dRow = pv.row - primary.origRow
        const offsetPitch = dRow === 0 ? 0 : Number(axis.valueOfRow(primary.origRow + dRow)) - Number(axis.valueOfRow(primary.origRow))
        if (offsetStart !== 0 || offsetPitch !== 0) {
          void postDuplicateNotes(
            track.id,
            g.group.map((gn) => gn.id),
            offsetStart,
            offsetPitch,
          )
            .then((addedIds) => setSel(addedIds))
            .catch((err) => showToast(`Could not duplicate: ${(err as Error).message}`))
        }
      }
      return
    }
    // Phase 30 Stream JB (research/89): one gestureId for the WHOLE commit below, whether it's a
    // single diagonal move (start+pitch), a multi-note group move, or a multi-note group resize —
    // so the daemon's undo stack collapses it to one entry regardless of how many /edit calls (how
    // many distinct paths) it takes to express. See commitMove's own comment for the "why".
    const commitGestureId = newGestureId()
    for (const gn of g.group) {
      const pv = p[gn.id]
      if (!pv) continue
      if (g.kind === 'move') commitMove(gn.id, pv.start, pv.row, gn.origStart, gn.origRow, commitGestureId)
      else {
        const dur = pv.duration ?? 0
        if (eventKind === 'note') {
          // A note's duration is always > 0 (the format requires it); freehand drags may leave a
          // fine fractional length, a snapped drag lands on a whole step either way.
          const clamped = Math.max(dur, 0.0001)
          if (clamped !== gn.origDur) postEdit(`${track.id}.note.${gn.id}.duration`, String(clamped), commitGestureId)
        } else if (dur !== (gn.origDur ?? 0)) {
          // A hit: dur === 0 clears back to a marker (empty value = clear, per core's setValue);
          // dur > 0 sets/updates the duration (marker -> bar, or resizing an existing bar).
          postEdit(`${track.id}.hit.${gn.id}.duration`, dur > 0 ? String(dur) : '', commitGestureId)
        }
      }
    }
  }

  function deleteEvent(id: string) {
    if (!editable) return
    setSel(sel.filter((s) => s !== id))
    postEdit(`${track.id}.${editPrefix}.${id}`, '')
  }

  // ---- clip-loop resize handle (Phase 24 Stream CJ; both-edges drag added Phase 27 Stream EF) -----
  // Drags the primary clip's own `loop.start`/`loop.end` (bars, clip-local) via handles drawn over
  // the grid at the clip's current effective range — `clip.loop?.start ?? 0` /
  // `clip.loop?.end ?? loopBars` when no override exists yet, i.e. a handle starts at the SAME
  // position the clip already effectively tiles at today (the canonical-elision default engine.ts's
  // contentOf now falls back to), so a drag always starts from where the clip visibly already is.
  // Calls the SAME `setClipLoop` primitive (src/core/edit.ts) the numeric fields in
  // ClipPropertiesPanel.tsx use, via the same `<track>.clip.<id>.loop` edit path — this is a second
  // INPUT METHOD for the identical fact, not a second mechanism. Originally (Phase 24 Stream CJ)
  // only the END was drag-resizable; research/71 §2.6/§3.4 item 4 flagged the missing start handle
  // as a real gap against Ableton's both-edges-draggable loop brace, so Stream EF adds a second,
  // symmetric handle at the START edge, sharing this same `origStart`-aware gesture plumbing (the
  // `edge` field below just selects which side of the range a given pointer gesture is moving).
  const clipLoopGesture = useRef<{ rect: DOMRect; stepW: number; origStart: number; origEnd: number; downX: number; edge: 'start' | 'end' } | null>(null)
  const [clipLoopPreviewEnd, setClipLoopPreviewEnd] = useState<number | null>(null)
  const [clipLoopPreviewStart, setClipLoopPreviewStart] = useState<number | null>(null)

  function startClipLoopResize(e: React.PointerEvent, edge: 'start' | 'end') {
    if (!primaryClip) return
    e.stopPropagation()
    e.preventDefault()
    const stripEl = e.currentTarget.closest('.noteview-cliploop-strip') as HTMLElement
    const rect = stripEl.getBoundingClientRect()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const origStart = primaryClip.loop?.start ?? 0
    const origEnd = primaryClip.loop?.end ?? loopBars
    clipLoopGesture.current = { rect, stepW: rect.width / totalSteps, origStart, origEnd, downX: e.clientX, edge }
    // Only seed the preview for the edge actually being dragged — the other edge's rendered
    // position keeps reading straight from `primaryClip.loop` (via the `?? ` fallback below),
    // so only the handle/label under the pointer lights up during a single-edge drag.
    if (edge === 'end') setClipLoopPreviewEnd(origEnd)
    else setClipLoopPreviewStart(origStart)
  }

  function onClipLoopPointerMove(e: React.PointerEvent) {
    const g = clipLoopGesture.current
    if (!g) return
    const stepsFromLeft = (e.clientX - g.rect.left) / g.stepW
    const barsFromLeft = Math.round(stepsFromLeft / 16)
    if (g.edge === 'start') {
      // Clamp to [0, end-1] — can't push the start past (or onto) the end, and can't go negative.
      const start = Math.max(0, Math.min(g.origEnd - 1, barsFromLeft))
      setClipLoopPreviewStart(start)
    } else {
      // Clamp to [start+1, loopBars] — can't shrink to zero/negative length, and the grid itself
      // (totalSteps = loopBars*16) is the natural upper bound on how far right the handle can reach.
      const end = Math.max(g.origStart + 1, Math.min(loopBars, barsFromLeft))
      setClipLoopPreviewEnd(end)
    }
  }

  function onClipLoopPointerUp(e: React.PointerEvent) {
    const g = clipLoopGesture.current
    const previewEnd = clipLoopPreviewEnd
    const previewStart = clipLoopPreviewStart
    clipLoopGesture.current = null
    setClipLoopPreviewEnd(null)
    setClipLoopPreviewStart(null)
    if (!g || !primaryClip) return
    if (Math.abs(e.clientX - g.downX) < DRAG_THRESHOLD) return // a tap, not a real drag — no-op
    const start = g.edge === 'start' ? (previewStart ?? g.origStart) : g.origStart
    const end = g.edge === 'end' ? (previewEnd ?? g.origEnd) : g.origEnd
    const path = `${track.id}.clip.${primaryClip.id}.loop`
    if (start === 0 && end === loopBars) {
      // Dragged back out to the full document-wide length — clear the override rather than writing
      // an explicit "0 loopBars" that means the exact same thing (canonical elision: no override IS
      // the full-length default, same discipline setClipLoop's own null branch already documents).
      if (primaryClip.loop) postEdit(path, '')
      return
    }
    postEdit(path, `${start} ${end}`)
  }

  // ---- Place in Arrangement (Phase 24 Stream CI) ----
  // "I can't drag it into the arrangement" — the owner's own framing. Phase 23 Stream BC already
  // solved this for AUDIO clips (a content-browser drag onto a track header, ArrangementView.tsx's
  // handleLibraryDrop). Synth/drum clips aren't dragged in from anywhere external — they're
  // authored right here, in this editor — so a discoverable BUTTON that performs BC's exact same
  // "slot this clip into a scene" operation is the natural equivalent of a drag gesture for this
  // case (a cross-pane drag from NoteView onto ArrangementView's track rows would need a second,
  // parallel HTML5-drag-source implementation for one button's worth of value — not worth it in
  // dotbeat's single-page layout). See docs/phase-24-stream-ci.md.
  //
  // `existing` mirrors BC's own "reuse an existing occurrence if the track already has one, else
  // mint a new clip and slot it into the target scene" precedent exactly: `primaryClipFor` is the
  // SAME lookup ClipPropertiesPanel already uses to find "the" clip this editor's live content
  // corresponds to once placed. Phase 29 Stream GA: both `existing` and the scene it's placed into
  // now prefer the currently-selected section — before this, `placeInArrangement` was hardcoded to
  // `doc.song[0]`, so it was IMPOSSIBLE to place a track's content into any section but the first
  // from the GUI (docs/research/86's "Place in Arrangement always writes into doc.song[0]'s scene
  // regardless of which section is in view"). Falls back to `doc.song[0]` — the old, only-ever
  // behavior — when nothing is selected, exactly matching primaryClipFor's own fallback.
  const [placing, setPlacing] = useState(false)
  const existing = doc ? primaryClipFor(track, doc, preferredSceneId) : null
  const inSongMode = !!doc?.song && doc.song.length > 0
  function placeInArrangement() {
    if (!doc || placing) return
    if (!inSongMode) {
      showToast('Add a song section first ("+ section") — clips only play once slotted into a song-mode scene.')
      return
    }
    const sceneId = preferredSceneId ?? doc.song![0]!.scene
    setPlacing(true)
    postPlaceClip(track.id, { ...(existing ? { clipId: existing.id } : {}), sceneId })
      .catch((err) => showToast(`Could not place clip: ${(err as Error).message}`))
      .finally(() => setPlacing(false))
  }

  // ---- keyboard: group nudge / resize / delete / select-all (Ableton Live 12 MIDI-editor keys) ----
  // Attached to window (only one NoteView renders at a time — the selected track's editor) but
  // ignored while a form control has focus, so it never hijacks the BPM box or a panel select. Reads
  // live state from the store so the closure never goes stale across doc updates.
  useEffect(() => {
    if (!editable) return
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (el as HTMLElement)?.isContentEditable) return
      const st = useStore.getState()
      const doc = st.doc
      const t = doc?.tracks.find((x) => x.id === track.id)
      if (!t) return
      const steps = (doc!.loopBars || 1) * 16
      const ids = new Set(st.editNoteIds)
      const liveEvents: EditorEvent[] = isDrums
        ? t.hits.map((h) => ({ id: h.id, start: h.start, duration: h.duration, velocity: h.velocity, row: axis.rowOfValue(h.lane) }))
        : t.notes.map((n) => ({ id: n.id, start: n.start, duration: n.duration, velocity: n.velocity, row: axis.rowOfValue(n.pitch) }))

      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        setSel(liveEvents.map((ev) => ev.id))
        return
      }
      const chosen = liveEvents.filter((ev) => ids.has(ev.id))

      // Phase 30 Stream JC bug 1 (research 89, docs/phase-30-plan.md JC item 1): there was no
      // neutral way to deselect — clicking empty grid space unconditionally adds a new event
      // there (correct/intentional per the hint text, unchanged here) and Escape did nothing.
      // This is the one keyboard convention this otherwise-thorough shortcut set was missing.
      // Guarded by the same "no form control has focus" check every other shortcut in this
      // handler already gets (the early-return at the top of `onKey`), so it never fights a text
      // input's own Escape-to-blur behavior; a no-op (nothing selected) does nothing at all,
      // matching every other shortcut here that's a no-op on an empty selection.
      if (e.key === 'Escape') {
        if (ids.size > 0) {
          e.preventDefault()
          setSel([])
        }
        return
      }

      // Phase 26 Stream DG: a basic clipboard, notes only (mirrors the Alt-drag duplicate gesture
      // above — drum hits have no duplicateNotes equivalent yet). Copy just remembers WHICH ids
      // were selected (module-level `noteClipboard`, not written to the .beat file); paste
      // re-resolves those ids against the LIVE track and calls the same duplicateNotes primitive,
      // offset so the earliest copied note lands at the current playhead (clip-relative, wrapped
      // to this clip's own step space) — or, when transport is stopped (`currentStep === -1`, no
      // playhead to paste at). Phase 30 Stream JC bug 2 (research 89): that no-playhead case used
      // to fall back to offsetStart 0 — pasting exactly on top of the originals, a perfectly
      // overlapping, invisible-on-screen stack only detectable via note count in the store. The
      // hint text promises "paste at the playhead"; with none, the sensible fallback is a small,
      // definitely-nonzero offset instead of the invisible one — Alt-drag-duplicate itself has no
      // FIXED offset (it's whatever distance the pointer actually dragged), but it shares this
      // same "never land a duplicate at an exact zero-delta stack" principle (see its own
      // `offsetStart !== 0 || offsetPitch !== 0` guard above, in `onPointerUp`). Reuses this
      // file's existing DEFAULT_DUR (an eighth note, 2 steps) as that small, already-established
      // step magnitude — the same size a freshly-clicked-in note already gets by default, rather
      // than inventing a new arbitrary constant — so the pasted copy lands a visually obvious,
      // still-close-by 2 steps to the right of the originals.
      if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
        if (!isDrums && chosen.length) {
          e.preventDefault()
          noteClipboard = { trackId: track.id, noteIds: chosen.map((ev) => ev.id), anchorStart: Math.min(...chosen.map((ev) => ev.start)) }
        }
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'v' || e.key === 'V')) {
        if (!isDrums && noteClipboard && noteClipboard.trackId === track.id) {
          e.preventDefault()
          const pasteStep = st.currentStep >= 0 ? st.currentStep % steps : noteClipboard.anchorStart + DEFAULT_DUR
          const offsetStart = pasteStep - noteClipboard.anchorStart
          void postDuplicateNotes(track.id, noteClipboard.noteIds, offsetStart, 0)
            .then((addedIds) => setSel(addedIds))
            .catch((err) => showToast(`Could not paste: ${(err as Error).message}`))
        }
        return
      }

      if (!chosen.length) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        // Phase 30 Stream JB (research/89): a multi-select delete is one user gesture (one keypress)
        // but fans out one /edit call per selected note/hit (each its own path, `<track>.<kind>.<id>`)
        // — without a shared gestureId each becomes its own undo entry, so restoring a 3-note delete
        // took 3 separate Undo presses instead of 1. Same fix as the drag-commit path above.
        const gestureId = newGestureId()
        for (const ev of chosen) postEdit(`${track.id}.${editPrefix}.${ev.id}`, '', gestureId)
        setSel([])
        return
      }
      const isArrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown'
      if (!isArrow) return
      e.preventDefault()

      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        // Shift+left/right = resize the selection's durations by ±1 step (uniform delta). One
        // keypress, one gestureId (Phase 30 Stream JB) — same multi-select coalescing fix as Delete.
        const dDur = e.key === 'ArrowRight' ? 1 : -1
        const gestureId = newGestureId()
        for (const ev of chosen) {
          const base = ev.duration ?? 0
          const duration = Math.max(0, Math.min(steps - ev.start, base + dDur))
          if (duration === base) continue
          if (eventKind === 'note') postEdit(`${track.id}.note.${ev.id}.duration`, String(Math.max(duration, 1)), gestureId)
          else postEdit(`${track.id}.hit.${ev.id}.duration`, duration > 0 ? String(duration) : '', gestureId)
        }
        return
      }
      // Otherwise a move: ±1 step in time (left/right) or ±1 row (up/down); shift+up/down = the
      // axis's octaveRows (an octave for pitch; a no-op — 0 — for drum lanes).
      let dStep = 0
      let dRow = 0
      if (e.key === 'ArrowLeft') dStep = -1
      else if (e.key === 'ArrowRight') dStep = 1
      else if (e.key === 'ArrowUp') dRow = e.shiftKey ? -axis.octaveRows : -1
      else if (e.key === 'ArrowDown') dRow = e.shiftKey ? axis.octaveRows : 1
      if (dRow === 0 && dStep === 0) return
      const starts = chosen.map((ev) => ev.start)
      const rowsUsed = chosen.map((ev) => ev.row)
      const ds = Math.max(-Math.min(...starts), Math.min(steps - 1 - Math.max(...starts), dStep))
      const dr = Math.max(-Math.min(...rowsUsed), Math.min(rows - 1 - Math.max(...rowsUsed), dRow))
      if (!ds && !dr) return
      // One keypress, one gestureId (Phase 30 Stream JB) — same reasoning as the shift+arrow resize
      // and drag-commit fixes above: a diagonal arrow-nudge (shift+up/down moves a whole octave AND
      // this branch can fire from a single key that touches both `.start` and pitch/lane) or a
      // multi-note nudge would otherwise land as one undo entry per note/field.
      const gestureId = newGestureId()
      for (const ev of chosen) {
        if (ds) postEdit(`${track.id}.${editPrefix}.${ev.id}.start`, String(ev.start + ds), gestureId)
        if (dr) {
          const field = eventKind === 'note' ? 'pitch' : 'lane'
          postEdit(`${track.id}.${editPrefix}.${ev.id}.${field}`, String(axis.valueOfRow(ev.row + dr)), gestureId)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editable, track.id, setSel, isDrums, eventKind, axis, rows])

  // ---- velocity (draw-across-notes paint gesture on the velocity lane, Phase 28 Stream FD) ----
  // Follow-through 1 (research/76 §1.1/§3 P1 item 3): this used to be a single-note-anchored drag —
  // pointer-down on ONE bar captured that note's id for the whole gesture, so dragging sideways onto
  // other bars had no effect on them. Generalized onto the exact same paint-across-notes shape the
  // chance lane already shipped (`paintChanceAt`/`onChanceLanePointerDown/Move/Up` below): re-evaluate
  // which note(s) the pointer's x-position is over on every move, same convention as Ableton's own
  // "Draw Mode in the Velocity Editor" (research/76 §1.1) — the drag now paints a run of velocities
  // across every note under the pointer's path, not just the one under the initial press.
  /** Paints every event (note OR hit — unlike chance, velocity applies to both) whose x-range the
   * pointer is currently over into `acc` (mutated in place) at the current Y's velocity. */
  function paintVelocityAt(rect: DOMRect, clientX: number, clientY: number, acc: Record<string, number>) {
    const stepW = rect.width / totalSteps
    const value = velocityFromY(rect, clientY)
    const x = clientX - rect.left
    for (const ev of events) {
      const w = ev.duration ?? 0
      const x0 = ev.start * stepW
      const x1 = x0 + Math.max(w * stepW, MARKER_W)
      if (x >= x0 && x <= x1) acc[ev.id] = value
    }
  }

  function onVelLanePointerDown(e: React.PointerEvent) {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    velGesture.current = { rect }
    const acc: Record<string, number> = {}
    paintVelocityAt(rect, e.clientX, e.clientY, acc)
    setVelPreview(acc)
    setSel(Object.keys(acc))
    setVelDragLabel({ x: e.clientX, y: e.clientY, value: velocityFromY(rect, e.clientY) })
  }

  function onVelLanePointerMove(e: React.PointerEvent) {
    const g = velGesture.current
    if (!g) return
    setVelPreview((prev) => {
      const acc = { ...(prev ?? {}) }
      paintVelocityAt(g.rect, e.clientX, e.clientY, acc)
      return acc
    })
    setVelDragLabel({ x: e.clientX, y: e.clientY, value: velocityFromY(g.rect, e.clientY) })
  }

  function onVelLanePointerUp() {
    const g = velGesture.current
    const p = velPreview
    velGesture.current = null
    setVelPreview(null)
    setVelDragLabel(null)
    if (!g || !p) return
    for (const [id, value] of Object.entries(p)) postEdit(`${track.id}.${editPrefix}.${id}.velocity`, String(value))
  }

  // ---- chance (draw-across-notes paint gesture, Phase 23 Stream BA) ----
  // Y within the lane -> 0-100 chance (top = 100%/always fires, bottom = 0%/never) — same convention
  // as velocityFromY, just an int percent instead of a 0..1 float.
  function chanceValueFromY(rect: DOMRect, clientY: number): number {
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top))
    return Math.round(Math.max(0, Math.min(1, 1 - y / rect.height)) * 100)
  }

  /** Paints every NOTE whose x-range the pointer is currently over into `acc` (mutated in place) at
   * the current Y's chance value — the "draw across" part: unlike the velocity gesture (anchored to
   * one bar), this re-evaluates which note is under the pointer on every move. */
  function paintChanceAt(rect: DOMRect, clientX: number, clientY: number, acc: Record<string, number>) {
    const stepW = rect.width / totalSteps
    const value = chanceValueFromY(rect, clientY)
    const x = clientX - rect.left
    for (const ev of events) {
      const w = ev.duration ?? 0
      const x0 = ev.start * stepW
      const x1 = x0 + Math.max(w * stepW, MARKER_W)
      if (x >= x0 && x <= x1) acc[ev.id] = value
    }
  }

  function onChanceLanePointerDown(e: React.PointerEvent) {
    if (!editable || isDrums) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    chanceGesture.current = { rect }
    const acc: Record<string, number> = {}
    paintChanceAt(rect, e.clientX, e.clientY, acc)
    setChancePreview(acc)
    setChanceDragLabel({ x: e.clientX, y: e.clientY, value: chanceValueFromY(rect, e.clientY) })
  }

  function onChanceLanePointerMove(e: React.PointerEvent) {
    const g = chanceGesture.current
    if (!g) return
    setChancePreview((prev) => {
      const acc = { ...(prev ?? {}) }
      paintChanceAt(g.rect, e.clientX, e.clientY, acc)
      return acc
    })
    setChanceDragLabel({ x: e.clientX, y: e.clientY, value: chanceValueFromY(g.rect, e.clientY) })
  }

  function onChanceLanePointerUp() {
    const g = chanceGesture.current
    const p = chancePreview
    chanceGesture.current = null
    setChancePreview(null)
    setChanceDragLabel(null)
    if (!g || !p) return
    for (const [id, value] of Object.entries(p)) postEdit(`${track.id}.note.${id}.chance`, String(value))
  }

  const tip = editable
    ? isDrums
      ? 'click a lane label to preview + select · click empty grid to add a hit (a marker — no duration) · drag to marquee-select · shift/cmd-click to multi-select · drag a hit (or group) to move · drag its right edge to gate/sustain it (marker -> bar) · arrows nudge · shift+←/→ resize · delete removes · double-click to delete · hold Alt/Cmd while dragging for freehand (off-grid) placement'
      : 'click a key to preview · click empty grid to add · drag to marquee-select · shift/cmd-click to multi-select · drag a note (or group) to move · drag its right edge to resize · arrows nudge · shift+←/→ resize · delete removes · double-click to delete · hold Alt/Cmd while dragging for freehand placement · hold Alt/Option at the START of a drag to duplicate instead of move · cmd/ctrl+c / cmd/ctrl+v to copy/paste at the playhead · dashed/dim = chance<100 · ticks = ratchet · drag the chance lane across notes to paint probability'
    : ''

  // Rubber-band overlay geometry (grid-relative px), only while an actual drag is in progress.
  const mq = marquee && marquee.moved ? marquee : null
  const mqStyle = mq
    ? {
        left: Math.min(mq.downX, mq.curX) - mq.rect.left,
        top: Math.min(mq.downY, mq.curY) - mq.rect.top,
        width: Math.abs(mq.curX - mq.downX),
        height: Math.abs(mq.curY - mq.downY),
      }
    : null

  return (
    <div className="noteview" data-event-kind={eventKind}>
      {/* Clip View title bar (Phase 27 Stream ED) — a real colored anchor tying this editor back
          to its track, mirroring Ableton's own clip title strip (research 71 §1.1/§3 P0 item 1).
          Sticky to the top of .noteview so it survives scrolling the panel stack below (the actual
          scroll container is .bottom-pane-body — .noteview itself has no overflow of its own — but
          sticky positioning still pins correctly against that ancestor scrollport as long as this
          stays inside .noteview's own box, which it does since it never leaves the DOM). */}
      <div
        className="noteview-titlebar"
        data-testid="noteview-titlebar"
        style={{ background: track.color, color: readableTextOn(track.color) }}
      >
        <span className="noteview-titlebar-name">{track.name}</span>
        {existing && <span className="noteview-titlebar-clip">clip &quot;{existing.id}&quot;</span>}
      </div>
      {velDragLabel && (
        <div
          className="noteview-drag-label"
          data-drag-label="velocity"
          style={{ left: velDragLabel.x + 10, top: velDragLabel.y - 18 }}
        >
          vel {velDragLabel.value}
        </div>
      )}
      {chanceDragLabel && (
        <div
          className="noteview-drag-label"
          data-drag-label="chance"
          style={{ left: chanceDragLabel.x + 10, top: chanceDragLabel.y - 18 }}
        >
          {chanceDragLabel.value}%
        </div>
      )}
      <div className="editor-toolbar">
        {editable && (
          <button
            className={`clip-audition-btn ${auditioning ? 'active' : ''}`}
            data-action="audition-clip"
            title={
              auditioning
                ? 'stop auditioning this clip'
                : "preview this clip's own notes/hits directly, regardless of song position (silences every other track while auditioning)"
            }
            onClick={() => {
              if (auditioning) void engine.stopAudition()
              else void engine.auditionClip(track.id)
            }}
          >
            {auditioning ? '■ Stop' : '▶ Preview clip'}
          </button>
        )}
        {/* Phase 28 Stream FD, follow-through 2 (research/76 §2.5/§3 P1 item 4): a local time-zoom
            control for the note grid — same button/readout/reset shape and Cmd/Ctrl+scroll idiom as
            ArrangementView.tsx's own `.arr-zoom-controls` (ArrangementView.tsx:2592-2605), just scoped
            to `--note-step-w` instead of `zoomPxPerBar`. Freed real width in this row by deleting the
            redundant .editor-title span this same stream also removed (bug 3). */}
        <div className="noteview-zoom-controls" title="note grid zoom (or Cmd/Ctrl+scroll over the grid)">
          <button
            className="noteview-zoom-btn"
            data-action="note-zoom-out"
            disabled={stepW <= MIN_STEP_W + 0.01}
            title="zoom out"
            onClick={zoomOut}
          >
            −
          </button>
          <span className="noteview-zoom-readout" data-stepw={stepW.toFixed(2)}>
            {Math.round(stepW)}px/step
          </span>
          <button
            className="noteview-zoom-btn"
            data-action="note-zoom-in"
            disabled={stepW >= MAX_STEP_W - 0.01}
            title="zoom in"
            onClick={zoomIn}
          >
            +
          </button>
          <button
            className="noteview-zoom-btn"
            data-action="note-zoom-reset"
            disabled={stepZoom === null}
            title="reset zoom"
            onClick={zoomReset}
          >
            reset
          </button>
        </div>
        <span className="toolbar-tip">
          {events.length} {eventKind === 'note' ? 'note' : 'hit'}
          {events.length === 1 ? '' : 's'}
          {sel.length > 0 && ` · ${sel.length} selected`} · {tip}
        </span>
        {sel.length > 0 && editable && (
          <button
            className="note-del-btn"
            onClick={() => {
              for (const id of sel) deleteEvent(id)
            }}
          >
            Delete {sel.length > 1 ? `${sel.length} ${eventKind === 'note' ? 'notes' : 'hits'}` : eventKind}
          </button>
        )}
        {track.kind !== 'audio' && (
          <button
            className={`place-clip-btn${existing ? ' placed' : ''}`}
            data-place-clip={track.id}
            data-place-clip-state={existing ? 'placed' : 'unplaced'}
            disabled={placing}
            title={
              existing
                ? `already placed as clip "${existing.id}" — click to re-save this editor's current content into it`
                : preferredSceneId
                  ? `slot this clip into the selected section's scene so it plays in the arrangement`
                  : 'slot this clip into the first song section\'s scene so it plays in the arrangement (click a section to target a different one)'
            }
            onClick={placeInArrangement}
          >
            {placing ? 'Placing…' : existing ? `Placed (clip "${existing.id}") — update` : 'Place in Arrangement'}
          </button>
        )}
      </div>
      <ClipPropertiesPanel track={track} />
      {isDrums && <DrumLanePanel track={track} />}
      {/* Phase 28 Stream FD, follow-through 2: `--note-step-w` is set INLINE here, overriding the
          global :root default (styles.css:10) only within this subtree — every `var(--note-step-w)`
          consumer below (grid, vel/chance lanes, clip-loop strip, playhead, barlines) is a descendant
          of this div, so this one override point is the whole of the zoom feature's plumbing, same
          "decouple one variable" shape ArrangementView.tsx's own zoomPxPerBar uses for pxPerBar. */}
      <div
        className="noteview-scroll"
        style={{ '--note-step-w': `${stepW}px` } as React.CSSProperties}
        onWheel={onNoteGridWheelZoom}
      >
        <div className="noteview-body" style={{ display: 'flex', alignItems: 'flex-start' }}>
          {/* Left gutter: one row per pitch (piano keys) or one row per declared drum lane (name
              labels) — sticky to the left edge so it stays pinned while the grid scrolls
              horizontally. Each row aligns 1:1 with a grid row (row * ROW_H). Clicking a row
              auditions it through the track's live engine voice (axis.preview). */}
          <div
            className="noteview-keys"
            style={{ position: 'sticky', left: 0, zIndex: 6, flex: '0 0 auto', width: KEY_W, height: gridH, background: '#0f1014' }}
          >
            {Array.from({ length: rows }, (_, row) => {
              const black = axis.isBlackRow(row)
              const label = axis.rowLabel(row)
              const isOctaveTop = !isDrums && pc(axis.valueOfRow(row) as number) === 0
              // Phase 27 Stream EB: shared drop-target primitive (ui/src/dragDrop.ts) — same
              // `.drop-target-hover` class/handlers as ArrangementView.tsx's track header, replacing
              // the hardcoded `#2f5d3a` inline fill this row used to swap in ad hoc (research/74
              // §3.1). Each row is a flat leaf element (no children under the cursor), so it didn't
              // have the dragleave-on-child bug the header did, but it inherits the fix anyway by
              // sharing the same handler factory rather than reinventing enter/leave bookkeeping.
              const isRowHover = dropHoverRow === row
              const rowDrop = isDrums
                ? makeDropTargetHandlers<HTMLDivElement>(LIBRARY_DND_MIME, isRowHover, (v) => setDropHoverRow(v ? row : null), (e) => {
                    const payload = readDragPayload(e.dataTransfer)
                    if (!payload || payload.type !== 'kit-lane') return
                    installKitLane(track.id, payload.kit, { lane: payload.lane ?? label, targetLane: label }).catch((err) =>
                      showToast(`Could not install sample: ${(err as Error).message}`),
                    )
                  })
                : null
              return (
                <div
                  key={row}
                  data-row={row}
                  data-row-value={axis.valueOfRow(row)}
                  data-drop-target={isDrums ? `lane-${label}` : undefined}
                  className={`noteview-key-row${isDrums && isRowHover ? ` ${DROP_TARGET_HOVER_CLASS}` : ''}`}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    if (editable) axis.preview(track.id, row)
                  }}
                  onDragOver={rowDrop?.onDragOver}
                  onDragLeave={rowDrop?.onDragLeave}
                  onDrop={rowDrop?.onDrop}
                  title={isDrums ? `${label} — drop a kit sample here to load it onto this lane` : pitchName(axis.valueOfRow(row) as number)}
                  style={{
                    position: 'absolute',
                    top: row * ROW_H,
                    left: 0,
                    right: 0,
                    height: ROW_H,
                    boxSizing: 'border-box',
                    // Background left unset while hovered so the shared `.drop-target-hover` CSS
                    // class's own tint (not this inline style) is what actually shows — an inline
                    // style would otherwise win specificity over the class and hide it.
                    background: isDrums && isRowHover ? undefined : black ? '#232630' : isDrums ? '#1a1c22' : '#c3c7cf',
                    color: black ? '#9aa0ab' : isDrums ? '#c3c7cf' : '#2a2c33',
                    borderBottom: isOctaveTop ? '1px solid #05060a' : '1px solid rgba(0,0,0,0.28)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: isDrums ? 'flex-start' : 'flex-end',
                    paddingLeft: isDrums ? 3 : 0,
                    paddingRight: isDrums ? 0 : 3,
                    fontSize: 8,
                    fontWeight: isOctaveTop ? 700 : 400,
                    cursor: editable ? 'pointer' : 'default',
                    userSelect: 'none',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isDrums ? label : isOctaveTop ? pitchName(axis.valueOfRow(row) as number) : ''}
                </div>
              )
            })}
          </div>
          <div className="noteview-lanes" style={{ flex: '0 0 auto' }}>
            {/* Phase 24 Stream CJ: this clip's own loop-length drag handles — only rendered when a
                real saved clip exists to resize (same gating as ClipPropertiesPanel's numeric
                fields). The shaded range shows [loop.start, loop.end) bars (or the full document
                loopBars width when no override is set — today's default tiling engine.ts now
                falls back to); dragging either handle shortens/lengthens/shifts it, live-previewed,
                committed via setClipLoop on pointer-up. Phase 27 Stream EF added the START-edge
                handle (research/71 §2.6/§3.4 item 4: Ableton's loop brace is draggable at BOTH
                edges, dotbeat's was end-only) — both handles share the SAME gesture plumbing above,
                just targeting opposite edges of the range. */}
            {primaryClip && (
              <div
                className="noteview-cliploop-strip"
                data-clip-loop-strip={track.id}
                style={{ width: `calc(${totalSteps} * var(--note-step-w))` }}
                onPointerMove={onClipLoopPointerMove}
                onPointerUp={onClipLoopPointerUp}
              >
                {(() => {
                  const start = clipLoopPreviewStart ?? primaryClip.loop?.start ?? 0
                  const end = clipLoopPreviewEnd ?? primaryClip.loop?.end ?? loopBars
                  return (
                    <>
                      <div
                        className="noteview-cliploop-range"
                        style={{
                          left: `calc(${start * 16} * var(--note-step-w))`,
                          width: `calc(${(end - start) * 16} * var(--note-step-w))`,
                        }}
                      />
                      <div
                        className="noteview-cliploop-handle noteview-cliploop-handle-start"
                        data-clip-loop-handle-start={track.id}
                        title={`drag to resize this clip's own loop start (currently bar ${start}) — matches "${track.id}.clip.${primaryClip.id}.loop"`}
                        style={{ left: `calc(${start * 16} * var(--note-step-w))` }}
                        onPointerDown={(e) => startClipLoopResize(e, 'start')}
                      />
                      <div
                        className="noteview-cliploop-handle noteview-cliploop-handle-end"
                        data-clip-loop-handle={track.id}
                        title={`drag to resize this clip's own loop length (currently ${end} bar${end === 1 ? '' : 's'}) — matches "${track.id}.clip.${primaryClip.id}.loop"`}
                        style={{ left: `calc(${end * 16} * var(--note-step-w))` }}
                        onPointerDown={(e) => startClipLoopResize(e, 'end')}
                      />
                      {clipLoopPreviewStart !== null && (
                        <div className="noteview-cliploop-label noteview-cliploop-label-start" data-clip-loop-label-start={track.id} style={{ left: `calc(${start * 16} * var(--note-step-w))` }}>
                          {start} bar{start === 1 ? '' : 's'}
                        </div>
                      )}
                      {clipLoopPreviewEnd !== null && (
                        <div className="noteview-cliploop-label" data-clip-loop-label={track.id} style={{ left: `calc(${end * 16} * var(--note-step-w))` }}>
                          {end} bar{end === 1 ? '' : 's'}
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            )}
            <div
              ref={gridRef}
              className="noteview-grid"
              tabIndex={0}
              style={{ height: gridH, width: `calc(${totalSteps} * var(--note-step-w))` }}
              onPointerDown={onGridPointerDown}
              onPointerMove={onGridPointerMove}
              onPointerUp={onGridPointerUp}
            >
              {/* Row shading + section dividers, painted behind the events and pointer-transparent
                  so grid add/marquee are unaffected. Melodic: black-key shading + octave (C)
                  gridlines. Drums: alternating lane shading for legibility with many lanes. */}
              {Array.from({ length: rows }, (_, row) => {
                if (isDrums) {
                  if (row % 2 === 0) return null
                  return <div key={`sh${row}`} className="noteview-rowshade" style={{ position: 'absolute', left: 0, right: 0, top: row * ROW_H, height: ROW_H, background: 'rgba(255,255,255,0.028)', pointerEvents: 'none' }} />
                }
                if (!axis.isBlackRow(row)) return null
                return <div key={`sh${row}`} className="noteview-rowshade" style={{ position: 'absolute', left: 0, right: 0, top: row * ROW_H, height: ROW_H, background: 'rgba(255,255,255,0.028)', pointerEvents: 'none' }} />
              })}
              {!isDrums &&
                Array.from({ length: rows }, (_, row) => {
                  if (pc(axis.valueOfRow(row) as number) !== 0) return null
                  return <div key={`oct${row}`} className="noteview-octline" style={{ position: 'absolute', left: 0, right: 0, top: row * ROW_H, height: 0, borderTop: '1px solid #3a3f49', pointerEvents: 'none' }} />
                })}
              {Array.from({ length: loopBars }, (_, b) => (
                <div key={b} className="noteview-barline" style={{ left: `calc(${b * 16} * var(--note-step-w))` }} />
              ))}
          {events.map((ev) => {
            const shown = preview?.[ev.id] ?? ev
            const isMarker = shown.duration === undefined
            // v0.10 at-a-glance glyphs (Phase 23 Stream BA) — note-only (ev.chance/ratchetCount are
            // undefined for a drum hit): a note with chance<100 draws dimmed + dashed (it might not
            // fire this pass); a ratcheted note (ratchetCount>1) draws internal tick marks at its
            // repeat boundaries. Neither changes the underlying velocity-driven opacity math, just
            // multiplies/overlays it, so a quiet AND probabilistic note still reads as both.
            const chance = ev.chance
            const isChancy = chance !== undefined && chance < 100
            const ratchetCount = ev.ratchetCount ?? 1
            const isRatcheted = ratchetCount > 1
            const ticks = isRatcheted ? ratchetTicks(ratchetCount, ev.ratchetCurve ?? 0) : []
            // Phase 27 Stream EB: research/74 §3.2 found this was the only drag surface in the app
            // with ZERO visual distinction between static and dragging (confirmed live: dragging a
            // note's `className` read identically to its resting selected state, no token, no
            // opacity/outline change). `preview[ev.id]` is only populated for events in the active
            // move/resize gesture's group, so its presence IS "this note is currently being
            // dragged" — reuses the same `.dragging` class/convention every other drag source in
            // the app now shares (effect-chain reorder, section-chip reorder, arrangement clip-block
            // move) rather than inventing a fifth treatment.
            const isDraggingNote = !!preview?.[ev.id]
            return (
              <div
                key={ev.id}
                className={`noteview-note${selSet.has(ev.id) ? ' selected' : ''}${isMarker ? ' marker' : ''}${isChancy ? ' chancy' : ''}${isRatcheted ? ' ratcheted' : ''}${isDraggingNote ? ` ${DRAGGING_CLASS}` : ''}`}
                style={{
                  left: `calc(${shown.start} * var(--note-step-w))`,
                  width: isMarker ? `${MARKER_W}px` : `calc(${shown.duration} * var(--note-step-w) - 1px)`,
                  top: shown.row * ROW_H,
                  height: ROW_H - 1,
                  background: track.color,
                  // Phase 27 Stream EE: velocity is READ from the dedicated velocity lane below, not
                  // encoded redundantly here — a note's on-grid opacity used to be
                  // `(0.45 + ev.velocity * 0.55) * (isChancy ? 0.6 : 1)`, stacking velocity opacity on
                  // top of pitch position, duration width, AND chance dimming on one ~11px-tall
                  // rectangle (research/71 §2.4). Base color/opacity now stays constant regardless of
                  // velocity; the chance dim (a real "might not play" signal) is the only opacity
                  // encoding left, and stays legible on its own now that it's not fighting velocity.
                  opacity: isChancy ? 0.6 : 1,
                  // A marker (no duration — a one-shot trigger) is a small pill, not a bar; a bar
                  // has square corners like the melodic notes. No transform/rotation on the
                  // container itself, so the resize-handle child's pointer math stays screen-space.
                  borderRadius: isMarker ? `${(ROW_H - 1) / 2}px` : undefined,
                }}
                title={
                  eventKind === 'note'
                    ? `pitch ${axis.valueOfRow(shown.row)} · start ${shown.start} · dur ${shown.duration} · vel ${ev.velocity}` +
                      (isChancy ? ` · chance ${chance}%` : '') +
                      (isRatcheted ? ` · ratchet x${ratchetCount}` : '')
                    : `${axis.valueOfRow(shown.row)} · start ${shown.start}${shown.duration !== undefined ? ` · dur ${shown.duration}` : ' · one-shot'} · vel ${ev.velocity}`
                }
                data-note-id={ev.id}
                data-chance={isChancy ? chance : undefined}
                data-ratchet-count={isRatcheted ? ratchetCount : undefined}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  deleteEvent(ev.id)
                }}
                onPointerDown={(e) => startGesture('move', ev, e)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                {ticks.map((t, i) => (
                  <div key={`rt${i}`} className="noteview-ratchet-tick" style={{ left: `${t * 100}%` }} />
                ))}
                {editable && <div className="noteview-resize" onPointerDown={(e) => startGesture('resize', ev, e)} />}
              </div>
            )
          })}
          {mqStyle && <div className="noteview-marquee" style={mqStyle} />}
          {playheadStep !== null && (
            <div className="noteview-playhead" style={{ left: `calc(${playheadStep} * var(--note-step-w))` }} />
          )}
            </div>
            {/* Velocity lane (Phase 16 Stream J): one bar per event, aligned under it. Phase 28
                Stream FD, follow-through 1: drag ACROSS the lane and every event the pointer sweeps
                over gets painted to the current Y's velocity (top = loudest, bottom = softest) — the
                same paint-across-notes shape the chance lane below already established, just
                generalized to notes AND hits. Handlers live on the lane container (not per-bar) so a
                drag that starts on one bar and sweeps onto neighboring bars keeps painting them, the
                same "re-evaluate what's under the pointer every move" mechanism `paintChanceAt` uses
                — writes through the existing `<track>.note.<id>.velocity` / `<track>.hit.<id>.velocity`
                edit paths, one postEdit per touched event on release. */}
            <div
              className="noteview-vel-lane"
              style={{ height: VEL_LANE_H, width: `calc(${totalSteps} * var(--note-step-w))` }}
              onPointerDown={onVelLanePointerDown}
              onPointerMove={onVelLanePointerMove}
              onPointerUp={onVelLanePointerUp}
              title="drag across notes/hits to paint their velocity — top = loudest, bottom = softest"
            >
              {Array.from({ length: loopBars }, (_, b) => (
                <div key={b} className="noteview-barline" style={{ left: `calc(${b * 16} * var(--note-step-w))` }} />
              ))}
              {events.map((ev) => {
                const velocity = velPreview?.[ev.id] ?? ev.velocity
                const barH = Math.max(2, Math.round(velocity * VEL_LANE_H))
                const w = ev.duration !== undefined ? ev.duration : 0
                return (
                  <div
                    key={ev.id}
                    className={`noteview-vel-bar${selSet.has(ev.id) ? ' selected' : ''}`}
                    style={{
                      left: `calc(${ev.start} * var(--note-step-w))`,
                      width: ev.duration !== undefined ? `calc(${w} * var(--note-step-w) - 1px)` : `${MARKER_W}px`,
                      height: barH,
                      background: track.color,
                    }}
                    title={`velocity ${velocity}`}
                    data-vel-note-id={ev.id}
                  />
                )
              })}
            </div>
            {/* Chance lane (Phase 23 Stream BA, research 22 §1.4's PropertyDrawModifier reference):
                the draw-across-notes gesture — drag horizontally and every note the pointer sweeps
                over gets painted to the current Y's chance value (top = 100%, bottom = 0%), the same
                mechanism the velocity lane above uses (Phase 28 Stream FD generalized it there too).
                Note-only (drum hits carry no chance field). */}
            {!isDrums && (
              <div
                className="noteview-chance-lane"
                style={{ height: CHANCE_LANE_H, width: `calc(${totalSteps} * var(--note-step-w))` }}
                onPointerDown={onChanceLanePointerDown}
                onPointerMove={onChanceLanePointerMove}
                onPointerUp={onChanceLanePointerUp}
                title="drag across notes to paint their chance (probability of firing each playback pass) — top = 100%, bottom = 0%"
              >
                {Array.from({ length: loopBars }, (_, b) => (
                  <div key={b} className="noteview-barline" style={{ left: `calc(${b * 16} * var(--note-step-w))` }} />
                ))}
                {events.map((ev) => {
                  const chance = chancePreview?.[ev.id] ?? ev.chance ?? 100
                  const barH = Math.max(2, Math.round((chance / 100) * CHANCE_LANE_H))
                  const w = ev.duration ?? 0
                  return (
                    <div
                      key={ev.id}
                      className={`noteview-chance-bar${selSet.has(ev.id) ? ' selected' : ''}${chance < 100 ? ' active' : ''}`}
                      style={{
                        left: `calc(${ev.start} * var(--note-step-w))`,
                        width: `calc(${w} * var(--note-step-w) - 1px)`,
                        height: barH,
                      }}
                      title={`chance ${chance}%`}
                      data-chance-note-id={ev.id}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      {!isDrums && <PitchTimePanel track={track} noteIds={sel} totalSteps={totalSteps} />}
      {!isDrums && <NoteNameReadout track={track} noteIds={sel} />}
      {editable && eventKind === 'note' && sel.length === 1 && (
        <NoteInspector key={sel[0]} note={track.notes.find((n) => n.id === sel[0])} trackId={track.id} />
      )}
    </div>
  )
}

// ---- Pitch & Time operations panel (Phase 23 Stream BA) ----------------------------------------
// The six Ableton "Clip View > Pitch & Time" one-shot ops (transpose/×2÷2/fit-to-scale/invert/
// reverse/legato — src/core/pitchtime.ts) plus ratchet's Consolidate action, reachable from the
// note-selection context research 18 §2 describes: shipped CLI/MCP-only by Phase 22 Stream AD ("no
// daemon route... this matches quantize's own precedent" — but unlike quantize, each of these is a
// whole-track BATCH op with its own parameter shape, not a single {path,value} scalar, so it needed
// its own additive daemon route the same way /song and /audio-split did — see daemon.ts's POST
// /pitch-time and bridge.ts's postPitchTime). Always visible for a note (non-drum) track — NOT
// gated on a selection existing, since every op works over "the whole track" when nothing is
// selected (the exact same `--notes` optional-scoping vocabulary the CLI/MCP tools already use).

// Hand-mirrors src/core/pitchtime.ts's SCALES keys exactly (ui/ has no build-time dependency on
// src/core — the same convention groove/chance/ratchet's engine-side mirrors already use).
const SCALE_NAMES = [
  'chromatic',
  'major',
  'minor',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'locrian',
  'harmonicMinor',
  'melodicMinor',
  'majorPentatonic',
  'minorPentatonic',
  'blues',
] as const
const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

// Phase 26 Stream DF: the grid-step vocabulary quantizeNotes (src/core/edit.ts:390-466) actually
// takes — a plain "16th steps per grid cell" number (1 = 16ths, 2 = 8ths, 4 = quarters, 0.5 =
// 32nds), same units `beat quantize --grid` already accepts. Named options here are purely a GUI
// convenience over that one numeric knob, not a new vocabulary.
const QUANTIZE_GRID_OPTIONS = [
  { label: '32nds', value: 0.5 },
  { label: '16ths', value: 1 },
  { label: '8ths', value: 2 },
  { label: 'quarters', value: 4 },
] as const

function PitchTimePanel({ track, noteIds, totalSteps }: { track: BeatTrack; noteIds: string[]; totalSteps: number }) {
  const [semitones, setSemitones] = useState(1)
  const [gap, setGap] = useState(0)
  const [root, setRoot] = useState(0)
  const [scale, setScale] = useState<string>('major')
  // Phase 26 Stream DF: Quantize control state — grid in 16th-step units (default 1 = 16ths,
  // matching quantizeNotes' own default), amount as a 0-100 percent for the slider (converted to
  // quantizeNotes' 0..1 `amount` on submit), starts/ends mirroring the CLI's `--no-starts`/`--ends`
  // scoping (defaults match: starts on, ends off).
  const [grid, setGrid] = useState(1)
  const [amount, setAmount] = useState(100)
  const [qStarts, setQStarts] = useState(true)
  const [qEnds, setQEnds] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const scoped = noteIds.length > 0 ? noteIds : undefined
  const scopeLabel = noteIds.length > 0 ? `${noteIds.length} note${noteIds.length === 1 ? '' : 's'} selected` : 'whole track'

  // Phase 30 Stream JC bug 3 (research 89, docs/phase-30-plan.md JC item 4): none of these ops
  // clamp a note to the clip's own loop length (totalSteps = loopBars*16) — ×2 on a 4-bar clip was
  // observed leaving notes ending as far as step 112 with zero warning. Clamping the transform's
  // own math felt like the wrong call (e.g. ×2 silently truncating would distort what "double the
  // time" actually means for a note that starts in-bounds but was always going to run long); this
  // is the required "at minimum, warn" floor from the plan. Checks only the notes actually in this
  // op's own scope (mirrors `scoped` above) against the CURRENT doc post-op, so it fires exactly
  // when this specific run pushed (or left) something past the boundary — not a stale unrelated
  // overhang from an earlier, already-acknowledged operation.
  function warnIfOverflowing(opNoteIds: string[] | undefined) {
    const t = useStore.getState().doc?.tracks.find((x) => x.id === track.id)
    if (!t) return
    const scope = opNoteIds && opNoteIds.length ? t.notes.filter((n) => opNoteIds.includes(n.id)) : t.notes
    const overflowing = scope.filter((n) => n.start + n.duration > totalSteps)
    if (overflowing.length > 0) {
      showToast(
        `${overflowing.length} note${overflowing.length === 1 ? '' : 's'} now end${overflowing.length === 1 ? 's' : ''} past this clip's ${totalSteps}-step loop length — the overhang plays once but won't repeat each loop pass.`,
      )
    }
  }

  async function run(body: PitchTimeOp) {
    setBusy(true)
    setMsg(null)
    try {
      const changed = await postPitchTime(body)
      // Phase 30 Stream JC bug 2 (research 89, docs/phase-30-plan.md JC item 3): Quantize was the
      // one op here that showed literally nothing when `changed` came back 0 (the exact case a
      // first-time user hits by clicking Quantize at its own default "16ths" setting against
      // already-aligned notes) — every other op already had SOME message, just a differently
      // worded one for the zero case ("no change (already at rest)"). Unifying on the same
      // "N notes changed" shape for every op, including 0, is simpler than keeping two message
      // shapes AND satisfies the explicit "0 notes changed" wording the plan asks for.
      setMsg(`${changed} note${changed === 1 ? '' : 's'} changed`)
      if (changed > 0) warnIfOverflowing(body.noteIds)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pitch-time-panel" title="Pitch &amp; Time — one-shot ops (research 18's Clip View row); each is a normal diff, nothing is stored as clip state">
      <span className="pitch-time-title section-heading">Pitch &amp; Time</span>
      <span className="pitch-time-scope">{scopeLabel}</span>

      <label className="pitch-time-field" title="shift pitch by N semitones, clamped to MIDI 0-127">
        <input
          type="number"
          step={1}
          value={semitones}
          onChange={(e) => setSemitones(Number(e.target.value))}
          data-pitch-time-input="semitones"
        />
        <button disabled={busy} data-pitch-time-op="transpose" onClick={() => run({ op: 'transpose', track: track.id, semitones, noteIds: scoped })}>
          Transpose
        </button>
      </label>

      <button
        disabled={busy}
        data-pitch-time-op="time-scale-2"
        title="double every scoped note's start/duration, anchored at the earliest note"
        onClick={() => run({ op: 'timeScale', track: track.id, factor: 2, noteIds: scoped })}
      >
        ×2
      </button>
      <button
        disabled={busy}
        data-pitch-time-op="time-scale-half"
        title="halve every scoped note's start/duration, anchored at the earliest note"
        onClick={() => run({ op: 'timeScale', track: track.id, factor: 0.5, noteIds: scoped })}
      >
        ÷2
      </button>

      <label className="pitch-time-field" title="snap every scoped note's pitch to the nearest tone in root/scale">
        <select value={root} onChange={(e) => setRoot(Number(e.target.value))} data-pitch-time-input="root">
          {PITCH_CLASSES.map((n, i) => (
            <option key={n} value={i}>
              {n}
            </option>
          ))}
        </select>
        <select value={scale} onChange={(e) => setScale(e.target.value)} data-pitch-time-input="scale">
          {SCALE_NAMES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button disabled={busy} data-pitch-time-op="fit-scale" onClick={() => run({ op: 'fitToScale', track: track.id, root, scale, noteIds: scoped })}>
          Fit to Scale
        </button>
      </label>

      <button
        disabled={busy}
        data-pitch-time-op="invert"
        title="mirror pitch around the scoped notes' own mean pitch"
        onClick={() => run({ op: 'invert', track: track.id, noteIds: scoped })}
      >
        Invert
      </button>
      <button
        disabled={busy}
        data-pitch-time-op="reverse"
        title="tape-reverse the scoped notes' time span (playback order flips, durations unchanged)"
        onClick={() => run({ op: 'reverse', track: track.id, noteIds: scoped })}
      >
        Reverse
      </button>

      <label className="pitch-time-field" title="extend/shorten each scoped note to the next note's start; gap leaves a small silence instead">
        <input type="number" min={0} step={1} value={gap} onChange={(e) => setGap(Number(e.target.value))} data-pitch-time-input="gap" />
        <button disabled={busy} data-pitch-time-op="legato" onClick={() => run({ op: 'legato', track: track.id, gap, noteIds: scoped })}>
          Legato
        </button>
      </label>

      {/* Phase 26 Stream DF (research 57 §2 item 1, "the single cheapest, highest-value item"):
          quantizeNotes (src/core/edit.ts:390-466) was fully wired through CLI/MCP but had zero GUI
          affordance — this is that affordance, over the same /pitch-time route as the ops above. */}
      <div
        className="pitch-time-field pitch-time-quantize"
        title="snap note starts and/or ends toward a grid; amount blends how far toward the grid each note moves (100% = full snap)"
      >
        <select value={grid} onChange={(e) => setGrid(Number(e.target.value))} data-pitch-time-input="quantize-grid">
          {QUANTIZE_GRID_OPTIONS.map((g) => (
            <option key={g.label} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          data-pitch-time-input="quantize-amount"
          title={`amount: ${amount}%`}
        />
        <span className="pitch-time-amount-readout" data-pitch-time-amount-readout>
          {amount}%
        </span>
        <label className="pitch-time-checkbox" title="snap note starts to the grid">
          <input type="checkbox" checked={qStarts} onChange={(e) => setQStarts(e.target.checked)} data-pitch-time-input="quantize-starts" />
          starts
        </label>
        <label className="pitch-time-checkbox" title="also snap note ends (adjusts duration so the end lands on the grid)">
          <input type="checkbox" checked={qEnds} onChange={(e) => setQEnds(e.target.checked)} data-pitch-time-input="quantize-ends" />
          ends
        </label>
        <button
          disabled={busy}
          data-pitch-time-op="quantize"
          onClick={() => run({ op: 'quantize', track: track.id, grid, amount: amount / 100, starts: qStarts, ends: qEnds, noteIds: scoped })}
        >
          Quantize
        </button>
      </div>

      <button
        disabled={busy}
        data-pitch-time-op="consolidate"
        title="bake ratcheted notes (ratchetCount>1) back into discrete notes"
        onClick={() => run({ op: 'consolidate', track: track.id, noteIds: scoped })}
      >
        Consolidate
      </button>

      {msg && (
        <span className="pitch-time-msg" data-pitch-time-msg>
          {msg}
        </span>
      )}
    </div>
  )
}

// ---- note-name readout (Phase 24 Stream CF) ---------------------------------------------------
// The piano-roll grid only shows notes as ROW POSITIONS on the keyboard strip — reading actual
// pitches back off it means eyeballing key labels one row at a time. This gives an at-a-glance
// text readout of the real note NAMES (e.g. "C4, E4, G4"), reusing the SAME `pitchName` scientific-
// pitch-notation formatter the keyboard strip's own key labels already use (line ~72) rather than
// inventing a second pitch->name mapping. Scoped to the current selection when one exists (mirrors
// PitchTimePanel's own scopeLabel convention just below — "N selected" vs "whole track"); falls back
// to the whole visible clip's distinct pitches when nothing's selected, so the readout is always
// showing something useful. Always visible for melodic (non-drum) tracks — drum lanes are named, not
// pitched, so there's nothing for this readout to show there (DrumLanePanel already covers lanes).
function NoteNameReadout({ track, noteIds }: { track: BeatTrack; noteIds: string[] }) {
  const scoped = noteIds.length > 0 ? track.notes.filter((n) => noteIds.includes(n.id)) : track.notes
  const scopeLabel = noteIds.length > 0 ? `${noteIds.length} selected` : 'whole clip'
  const distinctPitches = Array.from(new Set(scoped.map((n) => n.pitch))).sort((a, b) => a - b)
  const names = distinctPitches.map(pitchName)
  return (
    <div className="note-name-readout" data-testid="note-name-readout" title="the actual note names present — not just grid position">
      <span className="note-inspector-title section-heading">notes</span>
      <span className="pitch-time-scope">({scopeLabel})</span>
      <span className="note-name-readout-names" data-note-names={names.join(',')}>
        {names.length ? names.join(', ') : '—'}
      </span>
    </div>
  )
}

// ---- per-note inspector (Phase 22 Stream AD) --------------------------------------------------
// A small panel for the v0.10 per-note fields that don't have a natural piano-roll gesture yet
// (chance/cent/ratchet* — see docs/phase-22-stream-ad.md's GUI section for what's deliberately
// CLI/MCP-only this pass: the six Pitch & Time operations and ratchet's Consolidate action).
// Shown only when exactly one note is selected (these are single-note controls, not a multi-select
// batch gesture). Uncontrolled inputs keyed by note id: `defaultValue` seeds from the current
// document, `onChange` commits straight through the existing `<track>.note.<id>.<field>` postEdit
// path (src/core/edit.ts's note grammar) — the same channel drag/resize/velocity already use — so
// typing a value is a one-line diff, same as everything else in this file.

function NoteInspector({ note, trackId }: { note: BeatNote | undefined; trackId: string }) {
  if (!note) return null
  const field = (name: 'chance' | 'cent' | 'ratchetCount' | 'ratchetCurve' | 'ratchetLength') => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value.trim() === '') return
    postEdit(`${trackId}.note.${note.id}.${name}`, e.target.value)
  }
  return (
    <div className="note-inspector" title="per-note fields (Phase 22): chance/cent/ratchet apply at playback, never baked into the stored note">
      <span className="note-inspector-title section-heading">note {note.id}</span>
      <label className="note-inspector-field">
        chance
        <input type="number" min={0} max={100} step={1} defaultValue={note.chance} onChange={field('chance')} title="0-100: probability this note fires on any given playback pass (100 = always)" data-note-field="chance" />
      </label>
      <label className="note-inspector-field">
        cent
        <input type="number" min={-50} max={50} step={0.5} defaultValue={note.cent} onChange={field('cent')} title="-50..50: micro-tuning offset in cents, independent of semitone pitch" data-note-field="cent" />
      </label>
      <label className="note-inspector-field">
        ratchet
        <input type="number" min={1} max={16} step={1} defaultValue={note.ratchetCount} onChange={field('ratchetCount')} title="1-16: repeat this note N times within its own duration (1 = no ratchet)" data-note-field="ratchetCount" />
      </label>
      {note.ratchetCount > 1 && (
        <>
          <label className="note-inspector-field">
            curve
            <input type="number" min={-1} max={1} step={0.1} defaultValue={note.ratchetCurve} onChange={field('ratchetCurve')} title="-1..1: shapes the spacing between ratchet repeats (0 = even)" data-note-field="ratchetCurve" />
          </label>
          <label className="note-inspector-field">
            gate
            <input type="number" min={0.01} max={1} step={0.05} defaultValue={note.ratchetLength} onChange={field('ratchetLength')} title="0..1: each repeat's sounding length as a fraction of its own slot (1 = fills it)" data-note-field="ratchetLength" />
          </label>
        </>
      )}
    </div>
  )
}

// Re-exported for tests/tools that want a plain data view of a track's events without the React
// tree — mirrors what a future "fold to used lanes" affordance would filter on.
export type { EditorEvent, RowAxis }
export function eventsOf(track: BeatTrack): (BeatNote | BeatDrumHit)[] {
  return track.kind === 'drums' ? track.hits : track.notes
}
