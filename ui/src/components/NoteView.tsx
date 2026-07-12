import { useEffect, useRef, useState } from 'react'
import { declaredLaneNames, type BeatDocument, type BeatDrumHit, type BeatNote, type BeatTrack } from '../types'
import { postEdit, postSelection, postPitchTime, postPlaceClip, type PitchTimeOp } from '../daemon/bridge'
import { engine } from '../audio/engine'
import { useStore } from '../state/store'
import { installKitLane, readDragPayload, LIBRARY_DND_MIME } from '../daemon/library'
import { ClipPropertiesPanel, primaryClipFor } from './ClipPropertiesPanel'
import { DrumLanePanel } from './DrumLanePanel'

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

function buildPitchAxis(notes: BeatNote[]): RowAxis {
  // Pitch window: a generous, octave-snapped range AROUND the clip's content — deliberately not
  // clipped to the used notes (Ableton shows a scrollable full-range ruler; we render a padded
  // window that always spans >= MIN_SPAN so a sparse clip still gets a real keyboard).
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
}

// A live marquee (rubber-band) drag on empty grid space. `base` is the selection captured at
// pointer-down so a shift-drag adds to it; without a modifier the enclosed notes replace it.
type Marquee = { rect: DOMRect; stepW: number; downX: number; downY: number; curX: number; curY: number; base: string[]; additive: boolean; moved: boolean }

type Preview = { start: number; row: number; duration: number | undefined }
type VelGesture = { id: string; rect: DOMRect }

/** Map a pointer's clientY within the velocity lane's rect to a 0..1 velocity (top = loudest,
 * bottom = softest — same convention as a DAW velocity lane). Floored at 0.05, not 0: a note at
 * velocity 0 wouldn't sound, and this gesture edits an existing (already-sounding) note. */
function velocityFromY(rect: DOMRect, clientY: number): number {
  const y = Math.max(0, Math.min(rect.height, clientY - rect.top))
  return Math.round(Math.max(0.05, Math.min(1, 1 - y / rect.height)) * 100) / 100
}

/** Snap toward the nearest 16th step unless freehand-bypassed (Alt/Cmd held) — research 20 Part 1's
 * "soft, per-drag-bypassable snap." */
function snapStep(raw: number, freehand: boolean): number {
  return freehand ? Math.round(raw * 10000) / 10000 : Math.round(raw)
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
 * should render at all (stopped, or the open clip isn't the one actually playing right now). */
function resolveClipPlayhead(track: BeatTrack, doc: BeatDocument | null, currentStep: number, loopBars: number): number | null {
  if (!doc || currentStep < 0) return null
  const song = doc.song && doc.song.length > 0 ? doc.song : null
  const loopSteps = loopBars * 16
  if (!song) {
    // Loop mode (no song block): engine.ts's tick() computes `step` as `rawStep % (loopBars*16)`
    // directly whenever there's no song array, so `currentStep` IS already clip-relative — same
    // condition this playhead always used before song mode existed.
    return currentStep < loopSteps ? currentStep : null
  }
  const openClip = primaryClipFor(track, doc)
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
  const totalSteps = loopBars * 16
  const playheadStep = resolveClipPlayhead(track, doc, currentStep, loopBars)
  // Phase 24 Stream CJ: the SAME "primary clip" ClipPropertiesPanel.tsx's numeric loop fields
  // target — null in loop mode or when this track isn't mapped to a saved clip in any scene yet
  // (same gating the properties panel already applies; the drag handle below is hidden in that
  // case too, since there's no clip.loop to write).
  const primaryClip = doc ? primaryClipFor(track, doc) : null
  const isDrums = track.kind === 'drums'
  const editable = true // every track kind (synth/instrument/drums) edits through this one view now
  const eventKind: 'note' | 'hit' = isDrums ? 'hit' : 'note'
  const editPrefix = eventKind // "<track>.note.*" / "<track>.hit.*" — matches core's edit.ts exactly

  const axis = isDrums ? buildLaneAxis(track) : buildPitchAxis(track.notes)
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

  const selSet = new Set(sel)
  // Preview overrides during a drag: a map keyed by event id (a group move/resize previews many at once).
  const [preview, setPreview] = useState<Record<string, Preview> | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const marqueeRef = useRef<Marquee | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [velPreview, setVelPreview] = useState<{ id: string; velocity: number } | null>(null)
  // Content-browser drop target for drum lanes (ported from the retired StepSequencer.tsx, Phase
  // 22 Stream AH originally, Stream AB's row-axis merge here): dropping a kit one-shot onto a
  // lane's label cell loads it onto THIS lane, even if the sample's own kit slot names a different
  // one (installKitLane's targetLane override).
  const [dropHoverRow, setDropHoverRow] = useState<number | null>(null)
  const velGesture = useRef<VelGesture | null>(null)
  // Chance-paint lane (Phase 23 Stream BA, research 22 §1.4's PropertyDrawModifier reference): a
  // draw-ACROSS-notes gesture, unlike the velocity lane above (which anchors to the one note
  // pressed). `chancePreview` accumulates every note the pointer has painted so far this drag, keyed
  // by note id, so multiple notes update live as the pointer sweeps across them; commit fans out one
  // postEdit per touched note on release. Note-only (drum hits carry no chance field).
  const [chancePreview, setChancePreview] = useState<Record<string, number> | null>(null)
  const chanceGesture = useRef<{ rect: DOMRect } | null>(null)

  const rows = axis.rowCount
  const gridH = rows * ROW_H

  function toggleSel(id: string) {
    setSel(selSet.has(id) ? sel.filter((s) => s !== id) : [...sel, id])
  }

  // ---- move/resize commit helpers: fan out per-event edit primitives (one .beat line per event) ----
  function commitMove(id: string, start: number, row: number, origStart: number, origRow: number) {
    if (start !== origStart) postEdit(`${track.id}.${editPrefix}.${id}.start`, String(start))
    if (row !== origRow) {
      const field = eventKind === 'note' ? 'pitch' : 'lane'
      postEdit(`${track.id}.${editPrefix}.${id}.${field}`, String(axis.valueOfRow(row)))
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
    gridRef.current?.focus()
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
    const step = Math.max(0, Math.min(totalSteps - 1, snapStep((e.clientX - m.rect.left) / stepW, freehand)))
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
    gridEl.focus()
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
    gesture.current = { kind, primaryId: ev.id, rect, stepW: rect.width / totalSteps, downX: e.clientX, downY: e.clientY, group }
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current
    if (!g) return
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
    if (!g || !p) return
    for (const gn of g.group) {
      const pv = p[gn.id]
      if (!pv) continue
      if (g.kind === 'move') commitMove(gn.id, pv.start, pv.row, gn.origStart, gn.origRow)
      else {
        const dur = pv.duration ?? 0
        if (eventKind === 'note') {
          // A note's duration is always > 0 (the format requires it); freehand drags may leave a
          // fine fractional length, a snapped drag lands on a whole step either way.
          const clamped = Math.max(dur, 0.0001)
          if (clamped !== gn.origDur) postEdit(`${track.id}.note.${gn.id}.duration`, String(clamped))
        } else if (dur !== (gn.origDur ?? 0)) {
          // A hit: dur === 0 clears back to a marker (empty value = clear, per core's setValue);
          // dur > 0 sets/updates the duration (marker -> bar, or resizing an existing bar).
          postEdit(`${track.id}.hit.${gn.id}.duration`, dur > 0 ? String(dur) : '')
        }
      }
    }
  }

  function deleteEvent(id: string) {
    if (!editable) return
    setSel(sel.filter((s) => s !== id))
    postEdit(`${track.id}.${editPrefix}.${id}`, '')
  }

  // ---- clip-loop resize handle (Phase 24 Stream CJ) ----------------------------------------------
  // Drags the primary clip's own `loop.end` (bars, clip-local) via a handle drawn over the grid at
  // the clip's current effective length — `clip.loop?.end ?? loopBars` when no override exists yet,
  // i.e. the handle starts at the SAME position the clip already effectively tiles at today (the
  // canonical-elision default engine.ts's contentOf now falls back to), so a drag always starts from
  // where the clip visibly already ends. Calls the SAME `setClipLoop` primitive
  // (src/core/edit.ts) the numeric fields in ClipPropertiesPanel.tsx use, via the same
  // `<track>.clip.<id>.loop` edit path — this is a second INPUT METHOD for the identical fact, not a
  // second mechanism. Only the END is drag-resizable (start stays wherever it already was, 0 for a
  // fresh override) — matches Stream AG's own precedent of a single right-edge drag handle
  // (ArrangementView.tsx's section-resize) rather than inventing a two-handle range-select gesture.
  const clipLoopGesture = useRef<{ rect: DOMRect; stepW: number; origStart: number; origEnd: number; downX: number } | null>(null)
  const [clipLoopPreviewEnd, setClipLoopPreviewEnd] = useState<number | null>(null)

  function startClipLoopResize(e: React.PointerEvent) {
    if (!primaryClip) return
    e.stopPropagation()
    e.preventDefault()
    const stripEl = e.currentTarget.closest('.noteview-cliploop-strip') as HTMLElement
    const rect = stripEl.getBoundingClientRect()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const origStart = primaryClip.loop?.start ?? 0
    const origEnd = primaryClip.loop?.end ?? loopBars
    clipLoopGesture.current = { rect, stepW: rect.width / totalSteps, origStart, origEnd, downX: e.clientX }
    setClipLoopPreviewEnd(origEnd)
  }

  function onClipLoopPointerMove(e: React.PointerEvent) {
    const g = clipLoopGesture.current
    if (!g) return
    const stepsFromLeft = (e.clientX - g.rect.left) / g.stepW
    const barsFromLeft = Math.round(stepsFromLeft / 16)
    // Clamp to [start+1, loopBars] — can't shrink to zero/negative length, and the grid itself
    // (totalSteps = loopBars*16) is the natural upper bound on how far right the handle can reach.
    const end = Math.max(g.origStart + 1, Math.min(loopBars, barsFromLeft))
    setClipLoopPreviewEnd(end)
  }

  function onClipLoopPointerUp(e: React.PointerEvent) {
    const g = clipLoopGesture.current
    const end = clipLoopPreviewEnd
    clipLoopGesture.current = null
    setClipLoopPreviewEnd(null)
    if (!g || end === null || !primaryClip) return
    if (Math.abs(e.clientX - g.downX) < DRAG_THRESHOLD) return // a tap, not a real drag — no-op
    const path = `${track.id}.clip.${primaryClip.id}.loop`
    if (end === loopBars && g.origStart === 0) {
      // Dragged back out to the full document-wide length — clear the override rather than writing
      // an explicit "0 loopBars" that means the exact same thing (canonical elision: no override IS
      // the full-length default, same discipline setClipLoop's own null branch already documents).
      if (primaryClip.loop) postEdit(path, '')
      return
    }
    postEdit(path, `${g.origStart} ${end}`)
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
  // mint a new clip and slot it into the FIRST song section's scene" precedent exactly:
  // `primaryClipFor` is the SAME first-occurrence lookup ClipPropertiesPanel already uses to find
  // "the" clip this editor's live content corresponds to once placed.
  const [placing, setPlacing] = useState(false)
  const existing = doc ? primaryClipFor(track, doc) : null
  const inSongMode = !!doc?.song && doc.song.length > 0
  function placeInArrangement() {
    if (!doc || placing) return
    if (!inSongMode) {
      window.alert('Add a song section first ("+ section") — clips only play once slotted into a song-mode scene.')
      return
    }
    const sceneId = doc.song![0]!.scene
    setPlacing(true)
    postPlaceClip(track.id, { ...(existing ? { clipId: existing.id } : {}), sceneId })
      .catch((err) => window.alert(`Could not place clip: ${(err as Error).message}`))
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
      if (!chosen.length) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        for (const ev of chosen) postEdit(`${track.id}.${editPrefix}.${ev.id}`, '')
        setSel([])
        return
      }
      const isArrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown'
      if (!isArrow) return
      e.preventDefault()

      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        // Shift+left/right = resize the selection's durations by ±1 step (uniform delta).
        const dDur = e.key === 'ArrowRight' ? 1 : -1
        for (const ev of chosen) {
          const base = ev.duration ?? 0
          const duration = Math.max(0, Math.min(steps - ev.start, base + dDur))
          if (duration === base) continue
          if (eventKind === 'note') postEdit(`${track.id}.note.${ev.id}.duration`, String(Math.max(duration, 1)))
          else postEdit(`${track.id}.hit.${ev.id}.duration`, duration > 0 ? String(duration) : '')
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
      for (const ev of chosen) {
        if (ds) postEdit(`${track.id}.${editPrefix}.${ev.id}.start`, String(ev.start + ds))
        if (dr) {
          const field = eventKind === 'note' ? 'pitch' : 'lane'
          postEdit(`${track.id}.${editPrefix}.${ev.id}.${field}`, String(axis.valueOfRow(ev.row + dr)))
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editable, track.id, setSel, isDrums, eventKind, axis, rows])

  // ---- velocity (pointer-down-and-drag on an event's bar in the velocity lane) ----
  function startVelocityGesture(ev: EditorEvent, e: React.PointerEvent) {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    const laneEl = e.currentTarget.closest('.noteview-vel-lane') as HTMLElement
    const rect = laneEl.getBoundingClientRect()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    velGesture.current = { id: ev.id, rect }
    setSel([ev.id])
    // Set immediately from the down position too, so a plain click (no drag) still commits a value.
    setVelPreview({ id: ev.id, velocity: velocityFromY(rect, e.clientY) })
  }

  function onVelPointerMove(e: React.PointerEvent) {
    const g = velGesture.current
    if (!g) return
    setVelPreview({ id: g.id, velocity: velocityFromY(g.rect, e.clientY) })
  }

  function onVelPointerUp() {
    const g = velGesture.current
    const p = velPreview
    velGesture.current = null
    setVelPreview(null)
    if (!g || !p) return
    postEdit(`${track.id}.${editPrefix}.${g.id}.velocity`, String(p.velocity))
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
  }

  function onChanceLanePointerMove(e: React.PointerEvent) {
    const g = chanceGesture.current
    if (!g) return
    setChancePreview((prev) => {
      const acc = { ...(prev ?? {}) }
      paintChanceAt(g.rect, e.clientX, e.clientY, acc)
      return acc
    })
  }

  function onChanceLanePointerUp() {
    const g = chanceGesture.current
    const p = chancePreview
    chanceGesture.current = null
    setChancePreview(null)
    if (!g || !p) return
    for (const [id, value] of Object.entries(p)) postEdit(`${track.id}.note.${id}.chance`, String(value))
  }

  const tip = editable
    ? isDrums
      ? 'click a lane label to preview + select · click empty grid to add a hit (a marker — no duration) · drag to marquee-select · shift/cmd-click to multi-select · drag a hit (or group) to move · drag its right edge to gate/sustain it (marker -> bar) · arrows nudge · shift+←/→ resize · delete removes · double-click to delete · hold Alt/Cmd while dragging for freehand (off-grid) placement'
      : 'click a key to preview · click empty grid to add · drag to marquee-select · shift/cmd-click to multi-select · drag a note (or group) to move · drag its right edge to resize · arrows nudge · shift+←/→ resize · delete removes · double-click to delete · hold Alt/Cmd while dragging for freehand placement · dashed/dim = chance<100 · ticks = ratchet · drag the chance lane across notes to paint probability'
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
      <div className="editor-toolbar">
        <span className="editor-title" style={{ color: track.color }}>
          {track.name}
        </span>
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
                : 'slot this clip into the first song section\'s scene so it plays in the arrangement'
            }
            onClick={placeInArrangement}
          >
            {placing ? 'Placing…' : existing ? `Placed (clip "${existing.id}") — update` : 'Place in Arrangement'}
          </button>
        )}
      </div>
      <ClipPropertiesPanel track={track} />
      {isDrums && <DrumLanePanel track={track} />}
      <div className="noteview-scroll">
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
              return (
                <div
                  key={row}
                  data-row={row}
                  data-row-value={axis.valueOfRow(row)}
                  data-drop-target={isDrums ? `lane-${label}` : undefined}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    if (editable) axis.preview(track.id, row)
                  }}
                  onDragOver={
                    isDrums
                      ? (e) => {
                          if (!e.dataTransfer.types.includes(LIBRARY_DND_MIME)) return
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'copy'
                          setDropHoverRow(row)
                        }
                      : undefined
                  }
                  onDragLeave={isDrums ? () => setDropHoverRow(null) : undefined}
                  onDrop={
                    isDrums
                      ? (e) => {
                          e.preventDefault()
                          setDropHoverRow(null)
                          const payload = readDragPayload(e.dataTransfer)
                          if (!payload || payload.type !== 'kit-lane') return
                          installKitLane(track.id, payload.kit, { lane: payload.lane ?? label, targetLane: label }).catch((err) =>
                            window.alert(`Could not install sample: ${(err as Error).message}`),
                          )
                        }
                      : undefined
                  }
                  title={isDrums ? `${label} — drop a kit sample here to load it onto this lane` : pitchName(axis.valueOfRow(row) as number)}
                  style={{
                    position: 'absolute',
                    top: row * ROW_H,
                    left: 0,
                    right: 0,
                    height: ROW_H,
                    boxSizing: 'border-box',
                    background: dropHoverRow === row ? '#2f5d3a' : black ? '#232630' : isDrums ? '#1a1c22' : '#c3c7cf',
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
            {/* Phase 24 Stream CJ: this clip's own loop-length drag handle — only rendered when a
                real saved clip exists to resize (same gating as ClipPropertiesPanel's numeric
                fields). The shaded range shows [loop.start, loop.end) bars (or the full document
                loopBars width when no override is set — today's default tiling engine.ts now
                falls back to); dragging the handle at its right edge shortens/lengthens it, live-
                previewed, committed via setClipLoop on pointer-up. */}
            {primaryClip && (
              <div
                className="noteview-cliploop-strip"
                data-clip-loop-strip={track.id}
                style={{ width: `calc(${totalSteps} * var(--note-step-w))` }}
                onPointerMove={onClipLoopPointerMove}
                onPointerUp={onClipLoopPointerUp}
              >
                {(() => {
                  const start = primaryClip.loop?.start ?? 0
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
                        className="noteview-cliploop-handle"
                        data-clip-loop-handle={track.id}
                        title={`drag to resize this clip's own loop length (currently ${end} bar${end === 1 ? '' : 's'}) — matches "${track.id}.clip.${primaryClip.id}.loop"`}
                        style={{ left: `calc(${end * 16} * var(--note-step-w))` }}
                        onPointerDown={startClipLoopResize}
                      />
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
            return (
              <div
                key={ev.id}
                className={`noteview-note${selSet.has(ev.id) ? ' selected' : ''}${isMarker ? ' marker' : ''}${isChancy ? ' chancy' : ''}${isRatcheted ? ' ratcheted' : ''}`}
                style={{
                  left: `calc(${shown.start} * var(--note-step-w))`,
                  width: isMarker ? `${MARKER_W}px` : `calc(${shown.duration} * var(--note-step-w) - 1px)`,
                  top: shown.row * ROW_H,
                  height: ROW_H - 1,
                  background: track.color,
                  opacity: (0.45 + ev.velocity * 0.55) * (isChancy ? 0.6 : 1),
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
            {/* Velocity lane (Phase 16 Stream J): one bar per event, aligned under it. Drag (or click)
                vertically on a bar to set that event's velocity — writes through the existing
                `<track>.note.<id>.velocity` / `<track>.hit.<id>.velocity` edit paths. */}
            <div className="noteview-vel-lane" style={{ height: VEL_LANE_H, width: `calc(${totalSteps} * var(--note-step-w))` }}>
              {Array.from({ length: loopBars }, (_, b) => (
                <div key={b} className="noteview-barline" style={{ left: `calc(${b * 16} * var(--note-step-w))` }} />
              ))}
              {events.map((ev) => {
                const velocity = velPreview && velPreview.id === ev.id ? velPreview.velocity : ev.velocity
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
                    onPointerDown={(e) => startVelocityGesture(ev, e)}
                    onPointerMove={onVelPointerMove}
                    onPointerUp={onVelPointerUp}
                  />
                )
              })}
            </div>
            {/* Chance lane (Phase 23 Stream BA, research 22 §1.4's PropertyDrawModifier reference):
                the draw-across-notes gesture — drag horizontally and every note the pointer sweeps
                over gets painted to the current Y's chance value (top = 100%, bottom = 0%), unlike
                the velocity lane above which only ever edits the one bar originally pressed. Note-
                only (drum hits carry no chance field). */}
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
      {!isDrums && <PitchTimePanel track={track} noteIds={sel} />}
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

function PitchTimePanel({ track, noteIds }: { track: BeatTrack; noteIds: string[] }) {
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

  async function run(body: PitchTimeOp) {
    setBusy(true)
    setMsg(null)
    try {
      const changed = await postPitchTime(body)
      setMsg(changed > 0 ? `${changed} note${changed === 1 ? '' : 's'} changed` : 'no change (already at rest)')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pitch-time-panel" title="Pitch &amp; Time — one-shot ops (research 18's Clip View row); each is a normal diff, nothing is stored as clip state">
      <span className="pitch-time-title">Pitch &amp; Time</span>
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
      <span className="note-inspector-title">notes</span>
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
      <span className="note-inspector-title">note {note.id}</span>
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
