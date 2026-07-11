import { useRef, useState } from 'react'
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
// Each is one canonical line in the .beat file (verified in ui/verify.mjs against `beat add-note`).

const ROW_H = 12
const DEFAULT_DUR = 2 // steps (an eighth note)
const DEFAULT_VEL = 0.8

type Gesture = {
  kind: 'move' | 'resize'
  id: string
  rect: DOMRect
  stepW: number
  origStart: number
  origPitch: number
  origDur: number
}

export function NoteView({ track }: { track: BeatTrack }) {
  const loopBars = useStore((s) => s.doc?.loopBars ?? 1)
  const currentStep = useStore((s) => s.currentStep)
  const totalSteps = loopBars * 16
  const notes = track.notes
  const editable = track.kind !== 'drums'

  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ id: string; start: number; pitch: number; duration: number } | null>(null)
  const gesture = useRef<Gesture | null>(null)

  const pitches = notes.map((n) => n.pitch)
  const hi = notes.length ? Math.min(127, Math.max(...pitches) + 3) : 72
  const lo = notes.length ? Math.max(0, Math.min(...pitches) - 3) : 48
  const rows = hi - lo + 1
  const gridH = rows * ROW_H

  // ---- add (click on empty grid) ----
  function onGridClick(e: React.MouseEvent) {
    if (!editable) return
    const rect = e.currentTarget.getBoundingClientRect()
    const stepW = rect.width / totalSteps
    const step = Math.max(0, Math.min(totalSteps - 1, Math.floor((e.clientX - rect.left) / stepW)))
    const pitch = hi - Math.floor((e.clientY - rect.top) / ROW_H)
    if (pitch < 0 || pitch > 127) return
    postEdit(`${track.id}.note`, `${pitch} ${step} ${DEFAULT_DUR} ${DEFAULT_VEL}`)
  }

  // ---- move / resize (drag a note or its right edge) ----
  function startGesture(kind: 'move' | 'resize', n: BeatNote, e: React.PointerEvent) {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    const gridEl = e.currentTarget.closest('.noteview-grid') as HTMLElement
    const rect = gridEl.getBoundingClientRect()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    gesture.current = { kind, id: n.id, rect, stepW: rect.width / totalSteps, origStart: n.start, origPitch: n.pitch, origDur: n.duration }
    setSelected(n.id)
    setPreview({ id: n.id, start: n.start, pitch: n.pitch, duration: n.duration })
  }

  function onPointerMove(e: React.PointerEvent) {
    const g = gesture.current
    if (!g) return
    const dSteps = Math.round((e.clientX - (g.rect.left + g.origStart * g.stepW)) / g.stepW)
    if (g.kind === 'move') {
      const dRows = Math.round((e.clientY - (g.rect.top + (hi - g.origPitch) * ROW_H)) / ROW_H)
      const start = Math.max(0, Math.min(totalSteps - 1, g.origStart + dSteps))
      const pitch = Math.max(0, Math.min(127, g.origPitch - dRows))
      setPreview({ id: g.id, start, pitch, duration: g.origDur })
    } else {
      const duration = Math.max(1, Math.min(totalSteps - g.origStart, g.origDur + dSteps))
      setPreview({ id: g.id, start: g.origStart, pitch: g.origPitch, duration })
    }
  }

  function onPointerUp() {
    const g = gesture.current
    const p = preview
    gesture.current = null
    setPreview(null)
    if (!g || !p) return
    if (g.kind === 'move') {
      if (p.start !== g.origStart) postEdit(`${track.id}.note.${g.id}.start`, String(p.start))
      if (p.pitch !== g.origPitch) postEdit(`${track.id}.note.${g.id}.pitch`, String(p.pitch))
    } else if (p.duration !== g.origDur) {
      postEdit(`${track.id}.note.${g.id}.duration`, String(p.duration))
    }
  }

  function deleteNote(id: string) {
    if (!editable) return
    setSelected((s) => (s === id ? null : s))
    postEdit(`${track.id}.note.${id}`, '')
  }

  const tip = editable
    ? 'click empty grid to add · drag a note to move · drag its right edge to resize · double-click to delete'
    : 'drum track — edit hits in the step sequencer above'

  return (
    <div className="noteview">
      <div className="editor-toolbar">
        <span className="editor-title" style={{ color: track.color }}>
          {track.name}
        </span>
        <span className="toolbar-tip">
          {notes.length} note{notes.length === 1 ? '' : 's'} · {tip}
        </span>
        {selected && editable && (
          <button className="note-del-btn" onClick={() => deleteNote(selected)}>
            Delete note
          </button>
        )}
      </div>
      <div className="noteview-scroll">
        <div
          className="noteview-grid"
          style={{ height: gridH, width: `calc(${totalSteps} * var(--note-step-w))` }}
          onClick={onGridClick}
        >
          {Array.from({ length: loopBars }, (_, b) => (
            <div key={b} className="noteview-barline" style={{ left: `calc(${b * 16} * var(--note-step-w))` }} />
          ))}
          {notes.map((n) => {
            const shown = preview && preview.id === n.id ? preview : n
            return (
              <div
                key={n.id}
                className={`noteview-note${selected === n.id ? ' selected' : ''}`}
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
                onClick={(e) => {
                  e.stopPropagation()
                  setSelected(n.id)
                }}
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
          {currentStep >= 0 && currentStep < totalSteps && (
            <div className="noteview-playhead" style={{ left: `calc(${currentStep} * var(--note-step-w))` }} />
          )}
        </div>
      </div>
    </div>
  )
}
