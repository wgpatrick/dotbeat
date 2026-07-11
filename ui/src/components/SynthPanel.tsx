import { Knob } from './Knob'
import { CORE_KNOBS, OSC_TYPES_LIST, type BeatTrack } from '../types'
import { postEdit } from '../daemon/bridge'

// A minimal device panel for one track's core 9 synth params (osc + the eight knobs). This is the
// "declarative metadata table drives generic control rendering" pattern from BeatLab's DevicePanel
// (docs/research/15 §4), scoped to the core params for this first slice — the full ~60-field
// SYNTH_FIELDS surface (layers, LFOs, filter env, sends, inserts) is a deferred follow-up stream.
// Each control POSTs `<track>.<param>` — a one-line git diff per edit.

export function SynthPanel({ track }: { track: BeatTrack }) {
  const p = track.synth
  return (
    <div className="synth-panel">
      <div className="editor-toolbar">
        <span className="editor-title" style={{ color: track.color }}>
          {track.name}
        </span>
        <span className="toolbar-tip">core synth params · drag a knob · full param surface is a later stream</span>
      </div>
      <div className="knob-row">
        <div className="osc-select">
          <div className="knob-label">Osc</div>
          <select value={p.osc} onChange={(e) => postEdit(`${track.id}.osc`, e.target.value)}>
            {OSC_TYPES_LIST.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        {CORE_KNOBS.map((spec) => (
          <Knob
            key={String(spec.key)}
            label={spec.label}
            value={Number(p[spec.key])}
            min={spec.min}
            max={spec.max}
            log={spec.log}
            format={spec.format}
            onChange={(v) => postEdit(`${track.id}.${String(spec.key)}`, String(v))}
          />
        ))}
      </div>
    </div>
  )
}
