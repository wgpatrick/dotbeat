import { useEffect, useRef, useState } from 'react'
import { type BeatNote, type BeatTrack } from '../types'
import { postEdit } from '../daemon/bridge'
import { useStore } from '../state/store'

// An editable piano-roll view of a synth/instrument track's notes. Discrete/coarse (grid-quantized
// playhead, pointer-driven edits), so it stays on React + Zustand, not the canvas path (research 15
// §2). Every edit round-trips through the daemon's POST /edit {path,value} primitive, the note-side
// analog of the drum grid's `pattern.<lane>[step]`:
//   click empty grid  -> add       `<track>.note "<pitch> <start> <dur> <vel>"`  (mints a u-id)
//   drag a note        -> move      `<track>.note.<id>.start` / `.pitch`
//   drag a note's edge -> resize    `<track>.note.<id>.duration`
//   double-click note  -> delete    `<track>.note.<id>`  (empty value)
//   drag a bar in the velocity lane -> velocity  `<track>.note.<id>.velocity`  (Phase 16 Stream J)
// Each is one canonical line in the .beat file (verified in ui/verify.mjs against `beat add-note`).
//
// Phase 17 Stream M adds Ableton-standard multi-note controls on TOP of the single-note gestures
// above, matching Live 12's MIDI Note Editor conventions (docs/phase-17-arrangement-controls.md):
//   marquee    drag on empty grid draws a rubber-band; every note it touches is selected
//   multi-sel  shift/cmd-click a note toggles it in/out of the selection
//   group move drag any selected note -> the whole selection moves, relative offsets preserved
//   group resize drag one selected note's edge -> every selected note's duration changes by the
//              SAME delta (Ableton is uniform-delta, not proportional — see the doc's research)
//   group delete Delete/Backspace removes every selected note
//   nudge      arrow keys move the selection (±1 step in time, ±1 semitone); shift+left/right
//              resizes by ±1 step, shift+up/down transposes by an octave
//   select-all Cmd/Ctrl-A selects every note in the track
// Each group op is still a clean multi-line diff — one changed/removed .beat line per note, never a
// whole-document rewrite — because it just fans out the SAME per-note edit primitives postEdit
// already commits (the vary "keep" flow's batch-of-edits precedent, Phase 15 Stream I).

const ROW_H = 12
const DEFAULT_DUR = 2 // steps (an eighth note)
const DEFAULT_VEL = 0.8
const VEL_LANE_H = 46 // px — the velocity-lane strip below the note grid
const DRAG_THRESHOLD = 3 // px a pointer must move before a grid press counts as a marquee (vs. a tap-to-add)

type GroupNote = { id: string; origStart: number; origPitch: number; origDur: number }
type Gesture = {
  kind: 'move' | 'resize'
  primaryId: string
  rect: DOMRect
  stepW: number
  downX: number
  downY: number
  group: GroupNote[]
}

// A live marquee (rubber-band) drag on empty grid space. `base` is the selection captured at
// pointer-down so a shift-drag adds to it; without a modifier the enclosed notes replace it.
// cur{X,Y} track the live pointer so the overlay rectangle can be drawn.
type Marquee = { rect: DOMRect; stepW: number; downX: number; downY: number; curX: number; curY: number; base: string[]; additive: boolean; moved: boolean }

type Preview = { start: number; pitch: number; duration: number }
type VelGesture = { id: string; rect: DOMRect }

/** Map a pointer's clientY within the velocity lane's rect to a 0..1 velocity (top = loudest,
 * bottom = softest — same convention as a DAW velocity lane). Floored at 0.05, not 0: a note at
 * velocity 0 wouldn't sound, and this gesture edits an existing (already-sounding) note. */
function velocityFromY(rect: DOMRect, clientY: number): number {
  const y = Math.max(0, Math.min(rect.height, clientY - rect.top))
  return Math.round(Math.max(0.05, Math.min(1, 1 - y / rect.height)) * 100) / 100
}

export function NoteView({ track }: { track: BeatTrack }) {
  const loopBars = useStore((s) => s.doc?.loopBars ?? 1)
  const currentStep = useStore((s) => s.currentStep)
  const sel = useStore((s) => s.editNoteIds)
  const setSel = useStore((s) => s.setEditNoteIds)
  const totalSteps = loopBars * 16
  const notes = track.notes
  const editable = track.kind !== 'drums'

  const selSet = new Set(sel)
  // Preview overrides during a drag: a map keyed by note id (a group move/resize previews many at once).
  const [preview, setPreview] = useState<Record<string, Preview> | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const [marquee, setMarquee] = useState<Marquee | null>(null)
  const marqueeRef = useRef<Marquee | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [velPreview, setVelPreview] = useState<{ id: string; velocity: number } | null>(null)
  const velGesture = useRef<VelGesture | null>(null)

  const pitches = notes.map((n) => n.pitch)
  const hi = notes.length ? Math.min(127, Math.max(...pitches) + 3) : 72
  const lo = notes.length ? Math.max(0, Math.min(...pitches) - 3) : 48
  const rows = hi - lo + 1
  const gridH = rows * ROW_H

  function toggleSel(id: string) {
    setSel(selSet.has(id) ? sel.filter((s) => s !== id) : [...sel, id])
  }

  // ---- move/resize commit helpers: fan out per-note edit primitives (one .beat line per note) ----
  function commitMove(id: string, start: number, pitch: number, origStart: number, origPitch: number) {
    if (start !== origStart) postEdit(`${track.id}.note.${id}.start`, String(start))
    if (pitch !== origPitch) postEdit(`${track.id}.note.${id}.pitch`, String(pitch))
  }

  /** Clamp a (dStep, dPitch) translation so EVERY note in the group stays in bounds, preserving the
   * group's relative offsets (Ableton moves the whole selection as a rigid body and stops it when
   * any note hits an edge). */
  function clampGroupMove(group: { origStart: number; origPitch: number }[], dStep: number, dPitch: number): [number, number] {
    const starts = group.map((g) => g.origStart)
    const ptchs = group.map((g) => g.origPitch)
    const ds = Math.max(-Math.min(...starts), Math.min(totalSteps - 1 - Math.max(...starts), dStep))
    const dp = Math.max(-Math.min(...ptchs), Math.min(127 - Math.max(...ptchs), dPitch))
    return [ds, dp]
  }

  // ---- marquee (drag on empty grid) + tap-to-add ----
  function onGridPointerDown(e: React.PointerEvent) {
    if (!editable) return
    // Only fires for empty grid space — note/handle children stopPropagation their own pointerdowns.
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
    // Which notes does the marquee rect touch? (any overlap in both time and pitch, in grid px)
    const x0 = Math.min(m.downX, e.clientX) - m.rect.left
    const x1 = Math.max(m.downX, e.clientX) - m.rect.left
    const y0 = Math.min(m.downY, e.clientY) - m.rect.top
    const y1 = Math.max(m.downY, e.clientY) - m.rect.top
    const hit = notes
      .filter((n) => {
        const nx0 = n.start * m.stepW
        const nx1 = (n.start + n.duration) * m.stepW
        const ny0 = (hi - n.pitch) * ROW_H
        const ny1 = ny0 + ROW_H
        return nx0 < x1 && nx1 > x0 && ny0 < y1 && ny1 > y0
      })
      .map((n) => n.id)
    setSel(m.additive ? Array.from(new Set([...m.base, ...hit])) : hit)
  }

  function onGridPointerUp(e: React.PointerEvent) {
    const m = marqueeRef.current
    marqueeRef.current = null
    setMarquee(null)
    if (!m) return
    if (m.moved) return // marquee already set the selection live
    // No drag -> it was a tap on empty space: add a note here (keeps the existing click-to-add), and
    // (Ableton-style) collapse any multi-selection since the click landed on empty grid.
    const stepW = m.rect.width / totalSteps
    const step = Math.max(0, Math.min(totalSteps - 1, Math.floor((e.clientX - m.rect.left) / stepW)))
    const pitch = hi - Math.floor((e.clientY - m.rect.top) / ROW_H)
    if (pitch < 0 || pitch > 127) return
    setSel([])
    postEdit(`${track.id}.note`, `${pitch} ${step} ${DEFAULT_DUR} ${DEFAULT_VEL}`)
  }

  // ---- move / resize (drag a note or its right edge) ----
  function startGesture(kind: 'move' | 'resize', n: BeatNote, e: React.PointerEvent) {
    if (!editable) return
    e.stopPropagation()
    // Modifier + press on a note is a selection toggle, not a drag (Ableton shift/cmd-click).
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      toggleSel(n.id)
      return
    }
    e.preventDefault()
    const gridEl = e.currentTarget.closest('.noteview-grid') as HTMLElement
    const rect = gridEl.getBoundingClientRect()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    gridEl.focus()
    // Pressing an UNselected note selects just it (clearing others), then drags it. Pressing a note
    // already in the selection keeps the selection and drags the whole group.
    let groupIds: Set<string>
    if (selSet.has(n.id)) {
      groupIds = selSet
    } else {
      groupIds = new Set([n.id])
      setSel([n.id])
    }
    const group: GroupNote[] = notes
      .filter((no) => groupIds.has(no.id))
      .map((no) => ({ id: no.id, origStart: no.start, origPitch: no.pitch, origDur: no.duration }))
    gesture.current = { kind, primaryId: n.id, rect, stepW: rect.width / totalSteps, downX: e.clientX, downY: e.clientY, group }
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current
    if (!g) return
    const primary = g.group.find((x) => x.id === g.primaryId)!
    const next: Record<string, Preview> = {}
    if (g.kind === 'move') {
      const dStepsRaw = Math.round((e.clientX - (g.rect.left + primary.origStart * g.stepW)) / g.stepW)
      const dRowsRaw = Math.round((e.clientY - (g.rect.top + (hi - primary.origPitch) * ROW_H)) / ROW_H)
      const [ds, dp] = clampGroupMove(g.group, dStepsRaw, -dRowsRaw) // screen-down rows = pitch down
      for (const gn of g.group) next[gn.id] = { start: gn.origStart + ds, pitch: gn.origPitch + dp, duration: gn.origDur }
    } else {
      // Group resize is UNIFORM-DELTA (Ableton): every selected note's duration shifts by the same
      // number of steps the dragged edge moved, each clamped to >=1 and to the loop's end.
      const dDur = Math.round((e.clientX - (g.downX)) / g.stepW)
      for (const gn of g.group) {
        const duration = Math.max(1, Math.min(totalSteps - gn.origStart, gn.origDur + dDur))
        next[gn.id] = { start: gn.origStart, pitch: gn.origPitch, duration }
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
      if (g.kind === 'move') commitMove(gn.id, pv.start, pv.pitch, gn.origStart, gn.origPitch)
      else if (pv.duration !== gn.origDur) postEdit(`${track.id}.note.${gn.id}.duration`, String(pv.duration))
    }
  }

  function deleteNote(id: string) {
    if (!editable) return
    setSel(sel.filter((s) => s !== id))
    postEdit(`${track.id}.note.${id}`, '')
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

      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        setSel(t.notes.map((n) => n.id))
        return
      }
      const chosen = t.notes.filter((n) => ids.has(n.id))
      if (!chosen.length) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        for (const n of chosen) postEdit(`${track.id}.note.${n.id}`, '')
        setSel([])
        return
      }
      const isArrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown'
      if (!isArrow) return
      e.preventDefault()

      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        // Shift+left/right = resize the selection's durations by ±1 step (uniform delta).
        const dDur = e.key === 'ArrowRight' ? 1 : -1
        for (const n of chosen) {
          const duration = Math.max(1, Math.min(steps - n.start, n.duration + dDur))
          if (duration !== n.duration) postEdit(`${track.id}.note.${n.id}.duration`, String(duration))
        }
        return
      }
      // Otherwise a move: ±1 step in time (left/right) or ±1 semitone (up/down); shift = an octave.
      let dStep = 0
      let dPitch = 0
      if (e.key === 'ArrowLeft') dStep = -1
      else if (e.key === 'ArrowRight') dStep = 1
      else if (e.key === 'ArrowUp') dPitch = e.shiftKey ? 12 : 1
      else if (e.key === 'ArrowDown') dPitch = e.shiftKey ? -12 : -1
      const starts = chosen.map((n) => n.start)
      const ptchs = chosen.map((n) => n.pitch)
      const ds = Math.max(-Math.min(...starts), Math.min(steps - 1 - Math.max(...starts), dStep))
      const dp = Math.max(-Math.min(...ptchs), Math.min(127 - Math.max(...ptchs), dPitch))
      if (!ds && !dp) return
      for (const n of chosen) {
        if (ds) postEdit(`${track.id}.note.${n.id}.start`, String(n.start + ds))
        if (dp) postEdit(`${track.id}.note.${n.id}.pitch`, String(n.pitch + dp))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editable, track.id, setSel])

  // ---- velocity (pointer-down-and-drag on a note's bar in the velocity lane) ----
  function startVelocityGesture(n: BeatNote, e: React.PointerEvent) {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    const laneEl = e.currentTarget.closest('.noteview-vel-lane') as HTMLElement
    const rect = laneEl.getBoundingClientRect()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    velGesture.current = { id: n.id, rect }
    setSel([n.id])
    // Set immediately from the down position too, so a plain click (no drag) still commits a value.
    setVelPreview({ id: n.id, velocity: velocityFromY(rect, e.clientY) })
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
    postEdit(`${track.id}.note.${g.id}.velocity`, String(p.velocity))
  }

  const tip = editable
    ? 'click empty grid to add · drag to marquee-select · shift/cmd-click to multi-select · drag a note (or group) to move · drag its right edge to resize · arrows nudge · shift+←/→ resize · delete removes · double-click to delete'
    : 'drum track — edit hits in the step sequencer above'

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
    <div className="noteview">
      <div className="editor-toolbar">
        <span className="editor-title" style={{ color: track.color }}>
          {track.name}
        </span>
        <span className="toolbar-tip">
          {notes.length} note{notes.length === 1 ? '' : 's'}
          {sel.length > 0 && ` · ${sel.length} selected`} · {tip}
        </span>
        {sel.length > 0 && editable && (
          <button
            className="note-del-btn"
            onClick={() => {
              for (const id of sel) deleteNote(id)
            }}
          >
            Delete {sel.length > 1 ? `${sel.length} notes` : 'note'}
          </button>
        )}
      </div>
      <div className="noteview-scroll">
        <div
          ref={gridRef}
          className="noteview-grid"
          tabIndex={0}
          style={{ height: gridH, width: `calc(${totalSteps} * var(--note-step-w))` }}
          onPointerDown={onGridPointerDown}
          onPointerMove={onGridPointerMove}
          onPointerUp={onGridPointerUp}
        >
          {Array.from({ length: loopBars }, (_, b) => (
            <div key={b} className="noteview-barline" style={{ left: `calc(${b * 16} * var(--note-step-w))` }} />
          ))}
          {notes.map((n) => {
            const shown = preview?.[n.id] ?? n
            return (
              <div
                key={n.id}
                className={`noteview-note${selSet.has(n.id) ? ' selected' : ''}`}
                style={{
                  left: `calc(${shown.start} * var(--note-step-w))`,
                  width: `calc(${shown.duration} * var(--note-step-w) - 1px)`,
                  top: (hi - shown.pitch) * ROW_H,
                  height: ROW_H - 1,
                  background: track.color,
                  opacity: 0.45 + n.velocity * 0.55,
                }}
                title={`pitch ${shown.pitch} · start ${shown.start} · dur ${shown.duration} · vel ${n.velocity}`}
                data-note-id={n.id}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  deleteNote(n.id)
                }}
                onPointerDown={(e) => startGesture('move', n, e)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                {editable && <div className="noteview-resize" onPointerDown={(e) => startGesture('resize', n, e)} />}
              </div>
            )
          })}
          {mqStyle && <div className="noteview-marquee" style={mqStyle} />}
          {currentStep >= 0 && currentStep < totalSteps && (
            <div className="noteview-playhead" style={{ left: `calc(${currentStep} * var(--note-step-w))` }} />
          )}
        </div>
        {/* Velocity lane (Phase 16 Stream J): one bar per note, aligned under it. Drag (or click)
            vertically on a bar to set that note's velocity — writes through the existing
            `<track>.note.<id>.velocity` edit path (src/core/edit.ts's note grammar). */}
        <div className="noteview-vel-lane" style={{ height: VEL_LANE_H, width: `calc(${totalSteps} * var(--note-step-w))` }}>
          {Array.from({ length: loopBars }, (_, b) => (
            <div key={b} className="noteview-barline" style={{ left: `calc(${b * 16} * var(--note-step-w))` }} />
          ))}
          {notes.map((n) => {
            const velocity = velPreview && velPreview.id === n.id ? velPreview.velocity : n.velocity
            const barH = Math.max(2, Math.round(velocity * VEL_LANE_H))
            return (
              <div
                key={n.id}
                className={`noteview-vel-bar${selSet.has(n.id) ? ' selected' : ''}`}
                style={{
                  left: `calc(${n.start} * var(--note-step-w))`,
                  width: `calc(${n.duration} * var(--note-step-w) - 1px)`,
                  height: barH,
                  background: track.color,
                }}
                title={`velocity ${velocity}`}
                data-vel-note-id={n.id}
                onPointerDown={(e) => startVelocityGesture(n, e)}
                onPointerMove={onVelPointerMove}
                onPointerUp={onVelPointerUp}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
