import { useEffect, useRef, useState } from 'react'
import { Knob } from './Knob'
import { PARAM_GROUPS, type ParamGroup, type ParamSpec, type TrackKind } from './synthParams'
import { EFFECT_TYPES, EFFECT_LABELS, type BeatEffect, type BeatTrack, type EffectType } from '../types'
import { postEdit, postEffectAdd, postEffectRemove, postEffectMove, postEffectEnabled } from '../daemon/bridge'
import { fetchLibrary, applyPresetToTrack, type LibraryPreset } from '../daemon/library'
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

// Exported (Phase 26 Stream DC) so InstrumentPanel.tsx can reuse the exact same chain UI instead
// of reinventing it — instrument tracks now carry a real `effects` chain too (BeatTrack.effects).
export function EffectChain({ track, onAdded }: { track: BeatTrack; onAdded: (type: EffectType) => void }) {
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
        <button
          type="button"
          data-effect-add
          onClick={() => {
            // Owner feedback ("not clear if [the knobs are] actually doing anything"): now that a
            // group's knobs are hidden until its type is actually in the chain (synthParams.ts's
            // `effectType` gate), make the add action visibly reveal its own result — the newly
            // shown group scrolls into view and briefly flashes (below) — instead of leaving the
            // human to go hunting through the panel for what just appeared.
            void postEffectAdd(track.id, addType).then(() => onAdded(addType))
          }}
        >
          + Add effect
        </button>
      </div>
    </div>
  )
}

// Phase 23 Stream BB: the hot-swap preset browser INSIDE Device View — swap a track's preset
// without leaving the panel. Distinct from Phase 22 Stream AH's ContentBrowser sidebar (dragging a
// preset onto a track header from OUTSIDE Device View, docs/phase-22-stream-ah.md's own honest-gap
// note): this lives in the panel itself, with Prev/Next for quick auditioning-by-browsing.
// `applyPreset` (core's real mechanism, same one the sidebar drop and `beat preset` both call) is a
// literal one-shot param application — "presets are tooling, never in-file indirection"
// (format-spec.md) — so there is no "currently applied preset" to read back from the document; the
// browsing cursor below is local UI state only (which list entry Prev/Next currently points at),
// not a claim about what's live until the human actually picks one.
function PresetPicker({ track }: { track: BeatTrack }) {
  const [presets, setPresets] = useState<LibraryPreset[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchLibrary()
      .then((lib) => {
        if (cancelled) return
        const kind = track.kind === 'drums' ? 'drums' : 'synth'
        setPresets(lib.presets.filter((p) => p.kind === kind || p.kind === 'any'))
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [track.kind])

  if (track.kind !== 'synth' && track.kind !== 'drums') return null

  async function apply(name: string) {
    setApplying(true)
    setError(null)
    setApplied(null)
    try {
      await applyPresetToTrack(track.id, name)
      setApplied(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  if (error && !presets) return <div className="preset-picker preset-picker-error">preset browser: {error}</div>
  if (!presets) return <div className="preset-picker">loading presets…</div>
  if (presets.length === 0) return null

  const current = presets[cursor]

  return (
    <div className="preset-picker" data-testid="preset-picker">
      <span className="preset-picker-label">preset</span>
      <button
        type="button"
        data-preset-prev
        disabled={applying}
        onClick={() => {
          const next = (cursor - 1 + presets.length) % presets.length
          setCursor(next)
          void apply(presets[next]!.name)
        }}
        title="previous preset"
      >
        {'◀'}
      </button>
      <select
        data-preset-select
        value={current?.name ?? ''}
        disabled={applying}
        onChange={(e) => {
          const i = presets.findIndex((p) => p.name === e.target.value)
          if (i === -1) return
          setCursor(i)
          void apply(presets[i]!.name)
        }}
      >
        {presets.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name} — {p.category}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-preset-next
        disabled={applying}
        onClick={() => {
          const next = (cursor + 1) % presets.length
          setCursor(next)
          void apply(presets[next]!.name)
        }}
        title="next preset"
      >
        {'▶'}
      </button>
      {applied && <span className="preset-picker-applied">applied &quot;{applied}&quot;</span>}
      {error && <span className="preset-picker-error">{error}</span>}
    </div>
  )
}

// `highlight` is true for exactly one render right after this group's effect type was added via
// the Effect Chain panel above (SynthPanel's `justAdded` state) — force the <details> open (it may
// default closed, e.g. eq7/autoFilter/grainDelay) and scroll it into view, so "I added eq7" and "I
// can see eq7's knobs" are the same visible moment, not something the human has to go find.
// Exported (Phase 26 Stream DC) so InstrumentPanel.tsx can render the same effectType-gated groups
// (eq3/comp/distortion/bitcrush/eq7/autoFilter/... — see synthParams.ts's PARAM_GROUPS) instead of
// reinventing the renderer.
export function Group({ track, group, trackIds, highlight }: { track: BeatTrack; group: ParamGroup; trackIds: string[]; highlight: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (highlight && ref.current) {
      ref.current.open = true
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [highlight])
  return (
    <details ref={ref} className={`param-group${highlight ? ' param-group-flash' : ''}`} open={group.open} data-param-group={group.id}>
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
  const effects = track.effects ?? []
  // Phase 25 (owner feedback — see synthParams.ts's own header comment): a group whose
  // `effectType` is set is an opt-in reorderable-chain member — only render it when that type is
  // actually present in `track.effects`. Phase 26 Stream DC: this now applies unconditionally
  // (drum tracks used to be exempted here because they carried no `effects` chain at all — they
  // do now, folded in from the old fixed bus insert, see BeatTrack.effects in document.ts).
  const groups = PARAM_GROUPS.filter((g) => {
    if (!g.kinds.includes(kind)) return false
    if (g.effectType) return effects.some((e) => e.type === g.effectType)
    return true
  })

  // Tracks which effect type was JUST added via the Effect Chain panel, so the matching group can
  // force itself open and scroll into view for one moment — see Group's own comment. Cleared after
  // a short timer (also re-armed if a second add happens before the first flash finishes).
  const [justAdded, setJustAdded] = useState<EffectType | null>(null)
  useEffect(() => {
    if (justAdded === null) return
    const t = setTimeout(() => setJustAdded(null), 1600)
    return () => clearTimeout(t)
  }, [justAdded])

  return (
    <div className="synth-panel">
      <div className="editor-toolbar">
        <span className="editor-title" style={{ color: track.color }}>
          {track.name}
        </span>
        <span className="toolbar-tip">
          {kind === 'drums' ? 'drum bus + voice params + effect chain' : 'full synth surface'} · drag a knob · every edit is one line in the .beat file
        </span>
      </div>
      <PresetPicker track={track} />
      {/* Phase 26 Stream DC: drum tracks get the same reorderable Effect Chain UI synth tracks
          already had — their eq3/comp/distortion/bitcrush insert order is no longer fixed. */}
      {(kind === 'synth' || kind === 'drums') && <EffectChain track={track} onAdded={setJustAdded} />}
      <div className="param-groups">
        {groups.map((g) => (
          <Group key={g.id} track={track} group={g} trackIds={trackIds} highlight={g.effectType === justAdded} />
        ))}
      </div>
    </div>
  )
}
