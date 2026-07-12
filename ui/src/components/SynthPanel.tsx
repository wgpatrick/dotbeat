import { useState } from 'react'
import { Knob } from './Knob'
import { PARAM_GROUPS, type ParamGroup, type ParamSpec, type TrackKind } from './synthParams'
import { EFFECT_TYPES, EFFECT_LABELS, type BeatEffect, type BeatTrack, type EffectType } from '../types'
import { postEdit, postEffectAdd, postEffectRemove, postEffectMove, postEffectEnabled } from '../daemon/bridge'
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

  if (spec.kind === 'bool') {
    // lfoSync/lfo2Sync (Phase 18 Stream R): a plain checkbox. Edit values are the literal strings
    // "true"/"false" — edit.ts's 'bool' SYNTH_FIELD kind parses exactly those two tokens.
    const value = p[spec.key] === true
    return (
      <label className="param-enum" title={spec.hint}>
        <span className="knob-label">{spec.label}</span>
        <input type="checkbox" checked={value} onChange={(ev) => postEdit(path, ev.target.checked ? 'true' : 'false')} />
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

// Phase 22 Stream AA: the ordered, reorderable per-track effect chain. Array order in the file IS
// chain order (src/core/document.ts's BeatEffect) — so drag-to-reorder here is literally "move
// this entry to a new array index," the whole operation, no separate index field to keep in sync.
// Bypass is a REAL routing bypass (ui/src/audio/engine.ts's reconcileEffectChain splices a
// disabled effect out of the graph entirely), not just its own mix knob at 0 — meaningful for eq3,
// which has no mix control of its own. Each row also carries small ▲/▼ move buttons alongside the
// drag handle: real drag for the primary gesture, a keyboard/click-reachable fallback for the same
// affordance (and, not incidentally, a much more reliable hook for automated verification than
// simulating native HTML5 drag events).
function EffectRow({
  track,
  effect,
  index,
  count,
  dragState,
  setDragState,
}: {
  track: BeatTrack
  effect: BeatEffect
  index: number
  count: number
  dragState: { draggingId: string | null; overId: string | null }
  setDragState: (s: { draggingId: string | null; overId: string | null }) => void
}) {
  const isDragging = dragState.draggingId === effect.id
  const isDropTarget = dragState.overId === effect.id && dragState.draggingId !== null && dragState.draggingId !== effect.id
  const classes = ['effect-row', isDragging && 'dragging', isDropTarget && 'drop-target', !effect.enabled && 'bypassed'].filter(Boolean).join(' ')
  return (
    <div
      className={classes}
      data-effect-row={effect.id}
      data-effect-type={effect.type}
      data-effect-enabled={effect.enabled}
      data-effect-index={index}
      draggable
      onDragStart={(ev) => {
        ev.dataTransfer.effectAllowed = 'move'
        ev.dataTransfer.setData('text/plain', effect.id)
        setDragState({ draggingId: effect.id, overId: null })
      }}
      onDragOver={(ev) => {
        ev.preventDefault()
        if (dragState.draggingId && dragState.draggingId !== effect.id) setDragState({ ...dragState, overId: effect.id })
      }}
      onDrop={(ev) => {
        ev.preventDefault()
        const draggedId = dragState.draggingId
        setDragState({ draggingId: null, overId: null })
        if (!draggedId || draggedId === effect.id) return
        void postEffectMove(track.id, draggedId, index)
      }}
      onDragEnd={() => setDragState({ draggingId: null, overId: null })}
    >
      <span className="effect-drag-handle" title="drag to reorder">
        ⠿
      </span>
      <span className="effect-type">{EFFECT_LABELS[effect.type]}</span>
      <span className="effect-id">{effect.id}</span>
      <button type="button" data-effect-move-up={effect.id} disabled={index === 0} title="move up" onClick={() => void postEffectMove(track.id, effect.id, index - 1)}>
        ▲
      </button>
      <button type="button" data-effect-move-down={effect.id} disabled={index === count - 1} title="move down" onClick={() => void postEffectMove(track.id, effect.id, index + 1)}>
        ▼
      </button>
      <label className="effect-bypass">
        <input
          type="checkbox"
          data-effect-bypass={effect.id}
          checked={effect.enabled}
          onChange={(ev) => void postEffectEnabled(track.id, effect.id, ev.target.checked)}
        />
        on
      </label>
      <button type="button" className="effect-remove" data-effect-remove={effect.id} title="remove" onClick={() => void postEffectRemove(track.id, effect.id)}>
        ✕
      </button>
    </div>
  )
}

function EffectChain({ track }: { track: BeatTrack }) {
  const [addType, setAddType] = useState<EffectType>(EFFECT_TYPES[0]!)
  const [dragState, setDragState] = useState<{ draggingId: string | null; overId: string | null }>({ draggingId: null, overId: null })
  const effects = track.effects ?? []
  return (
    <div className="effect-chain" data-testid="effect-chain">
      <div className="effect-chain-title">Effect Chain — order is chain order</div>
      <div className="effect-chain-list">
        {effects.map((e, i) => (
          <EffectRow key={e.id} track={track} effect={e} index={i} count={effects.length} dragState={dragState} setDragState={setDragState} />
        ))}
        {effects.length === 0 && <div className="effect-id">(no inserts — dry signal)</div>}
      </div>
      <div className="effect-chain-add">
        <select data-effect-add-type value={addType} onChange={(ev) => setAddType(ev.target.value as EffectType)}>
          {EFFECT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EFFECT_LABELS[t]}
            </option>
          ))}
        </select>
        <button type="button" data-effect-add onClick={() => void postEffectAdd(track.id, addType)}>
          + Add effect
        </button>
      </div>
    </div>
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
      {kind === 'synth' && <EffectChain track={track} />}
      <div className="param-groups">
        {groups.map((g) => (
          <Group key={g.id} track={track} group={g} trackIds={trackIds} />
        ))}
      </div>
    </div>
  )
}
