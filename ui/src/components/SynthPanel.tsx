import { Knob } from './Knob'
import { PARAM_GROUPS, type ParamGroup, type ParamSpec, type TrackKind } from './synthParams'
import { type BeatTrack } from '../types'
import { postEdit } from '../daemon/bridge'
import { useStore } from '../state/store'

// The device panel for one track's FULL synth surface — the core 9 plus every optional
// SYNTH_FIELD (~54), organized into collapsible musical groups (osc / filter+env / LFO / amp /
// inserts / sends / sidechain / drum-voice). This is BeatLab's DevicePanel "metadata table drives
// a generic renderer" pattern (docs/research/15 §4): PARAM_GROUPS (synthParams.ts) is the data,
// this file is the one generic renderer. Every control POSTs `<track>.<key>` via /edit — a
// one-line git diff per edit. ParamStatus/grading is intentionally absent.

/** One control, dispatched by spec.kind. */
function Control({ track, spec, trackIds }: { track: BeatTrack; spec: ParamSpec; trackIds: string[] }) {
  const p = track.synth
  const path = `${track.id}.${spec.key}`

  if (spec.kind === 'enum') {
    const value = String(p[spec.key] ?? spec.values?.[0] ?? '')
    return (
      <label className="param-enum" title={spec.hint}>
        <span className="knob-label">{spec.label}</span>
        <select value={value} onChange={(ev) => postEdit(path, ev.target.value)}>
          {spec.values!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (spec.kind === 'trackref') {
    // duckSource: null/undefined -> "none"; otherwise the referenced track id.
    const raw = p[spec.key]
    const value = raw == null || raw === '' ? 'none' : String(raw)
    return (
      <label className="param-enum" title={spec.hint}>
        <span className="knob-label">{spec.label}</span>
        <select value={value} onChange={(ev) => postEdit(path, ev.target.value)}>
          <option value="none">none</option>
          {trackIds
            .filter((id) => id !== track.id)
            .map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
        </select>
      </label>
    )
  }

  // knob
  return (
    <Knob
      label={spec.label}
      value={Number(p[spec.key] ?? spec.min ?? 0)}
      min={spec.min!}
      max={spec.max!}
      log={spec.log}
      format={spec.format}
      hint={spec.hint}
      onChange={(v) => postEdit(path, String(v))}
    />
  )
}

function Group({ track, group, trackIds }: { track: BeatTrack; group: ParamGroup; trackIds: string[] }) {
  return (
    <details className="param-group" open={group.open}>
      <summary className="param-group-title">{group.title}</summary>
      <div className="knob-row">
        {group.params.map((spec) => (
          <Control key={spec.key} track={track} spec={spec} trackIds={trackIds} />
        ))}
      </div>
    </details>
  )
}

export function SynthPanel({ track }: { track: BeatTrack }) {
  // Select the stable tracks array reference (unchanged on per-tick currentStep/masterLevel
  // updates) and derive ids in render, so the panel doesn't re-render every playback tick.
  const tracks = useStore((s) => s.doc?.tracks)
  const trackIds = tracks?.map((t) => t.id) ?? []
  const kind = track.kind as TrackKind
  const groups = PARAM_GROUPS.filter((g) => g.kinds.includes(kind))

  return (
    <div className="synth-panel">
      <div className="editor-toolbar">
        <span className="editor-title" style={{ color: track.color }}>
          {track.name}
        </span>
        <span className="toolbar-tip">
          {kind === 'drums' ? 'drum bus + voice params' : 'full synth surface'} · drag a knob · every edit is one line in the .beat file
        </span>
      </div>
      <div className="param-groups">
        {groups.map((g) => (
          <Group key={g.id} track={track} group={g} trackIds={trackIds} />
        ))}
      </div>
    </div>
  )
}
