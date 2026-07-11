import { type BeatTrack } from '../types'
import { useStore } from '../state/store'

// A minimal piano-roll-ish view of a synth track's notes — read-only for this first slice (note
// EDITING round-trips through addNote/removeNote and is a deferred follow-up; the step-toggle and
// knob edit paths already prove both sync directions). Notes are absolutely-positioned blocks over
// a pitch × step field; a grid-quantized playhead line marks currentStep. Discrete/coarse, so it
// stays on React + Zustand (not the canvas path) per docs/research/15 §2.

const ROW_H = 10

export function NoteView({ track }: { track: BeatTrack }) {
  const loopBars = useStore((s) => s.doc?.loopBars ?? 1)
  const currentStep = useStore((s) => s.currentStep)
  const totalSteps = loopBars * 16
  const notes = track.notes

  if (notes.length === 0) {
    return (
      <div className="noteview">
        <div className="editor-toolbar">
          <span className="editor-title" style={{ color: track.color }}>
            {track.name}
          </span>
          <span className="toolbar-tip">no notes on this track</span>
        </div>
      </div>
    )
  }

  const pitches = notes.map((n) => n.pitch)
  const minPitch = Math.min(...pitches) - 1
  const maxPitch = Math.max(...pitches) + 1
  const rows = maxPitch - minPitch + 1
  const gridH = rows * ROW_H

  return (
    <div className="noteview">
      <div className="editor-toolbar">
        <span className="editor-title" style={{ color: track.color }}>
          {track.name}
        </span>
        <span className="toolbar-tip">
          {notes.length} note{notes.length === 1 ? '' : 's'} · pitch {minPitch + 1}–{maxPitch - 1} · read-only (editing is a later stream)
        </span>
      </div>
      <div className="noteview-scroll">
        <div className="noteview-grid" style={{ height: gridH, width: `calc(${totalSteps} * var(--note-step-w))` }}>
          {Array.from({ length: loopBars }, (_, b) => (
            <div key={b} className="noteview-barline" style={{ left: `calc(${b * 16} * var(--note-step-w))` }} />
          ))}
          {notes.map((n) => (
            <div
              key={n.id}
              className="noteview-note"
              style={{
                left: `calc(${n.start} * var(--note-step-w))`,
                width: `calc(${n.duration} * var(--note-step-w) - 1px)`,
                top: (maxPitch - n.pitch) * ROW_H,
                height: ROW_H - 1,
                background: track.color,
                opacity: 0.4 + n.velocity * 0.6,
              }}
              title={`pitch ${n.pitch} · start ${n.start} · dur ${n.duration} · vel ${n.velocity}`}
            />
          ))}
          {currentStep >= 0 && currentStep < totalSteps && (
            <div className="noteview-playhead" style={{ left: `calc(${currentStep} * var(--note-step-w))` }} />
          )}
        </div>
      </div>
    </div>
  )
}
