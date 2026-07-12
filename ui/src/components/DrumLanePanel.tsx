import { useState } from 'react'
import { postLaneOp } from '../daemon/bridge'
import { useStore } from '../state/store'
import {
  DRUM_VOICE_PARAM_DEFAULTS,
  DRUM_VOICE_TYPES,
  EFFECT_LABELS,
  EFFECT_TYPES,
  SAMPLE_LANE_FILTER_TYPES,
  SAMPLE_LANE_PARAM_DEFAULTS,
  SAMPLE_LANE_PARAM_KEYS,
  declaredLaneNames,
  type BeatDrumLaneDecl,
  type BeatLaneSampleBacking,
  type BeatMediaSample,
  type BeatTrack,
  type DrumVoiceType,
  type EffectType,
  type SampleLaneFilterType,
} from '../types'

// Phase 26 Stream DK: reconstructs a sample-backed lane's FULL `sample <id> <gainDb> <tune>
// [key=value ...] [filter=...] [fx=...]` backing line from its current state plus a patch — needed
// because setLaneBacking (the `op: 'backing'` route) REPLACES the whole backing, so changing just
// filterType or the fx list must still carry every other already-set field forward (the numeric
// Start/Length/AHD/filter knobs below use `op: 'param'` instead — setLaneParam merges one key at a
// time, the same primitive synth-backed lanes' own per-param inputs already ride).
function sampleBackingLine(
  b: BeatLaneSampleBacking,
  patch: { sample?: string; gainDb?: number | string; tune?: number | string; filterType?: SampleLaneFilterType; effects?: EffectType[] },
): string {
  const parts = ['sample', patch.sample ?? b.sample, String(patch.gainDb ?? b.gainDb), String(patch.tune ?? b.tune)]
  for (const key of SAMPLE_LANE_PARAM_KEYS) {
    const value = b.params[key]
    if (value === undefined || value === SAMPLE_LANE_PARAM_DEFAULTS[key]) continue
    parts.push(`${key}=${value}`)
  }
  const filterType = patch.filterType ?? b.filterType
  if (filterType !== 'lowpass') parts.push(`filter=${filterType}`)
  const effects = patch.effects ?? b.effects.map((e) => e.type)
  if (effects.length > 0) parts.push(`fx=${effects.join(',')}`)
  return parts.join(' ')
}

// Phase 23 Stream BB — the drum-lane management affordance the open per-track lane model (Phase
// 22 Stream AB, docs/phase-22-stream-ab.md) shipped with no GUI surface for: "author via a kit
// preset or hand-edit today" was the honest gap that doc's §5 left open. This panel lets a human
// add/reorder/retype a declared lane and tune its synth/sample/sf backing params, all through the
// daemon's POST /lane route (src/daemon/daemon.ts) wrapping core's addLane/removeLane/moveLane/
// setLaneBacking/setLaneParam (src/core/edit.ts) — the exact fine-grained primitives that doc
// flagged as future work ("no dedicated setValue path for lanes[].backing.params was added").
//
// A LEGACY track (lanes: [] — plays through the untouched 5-lane switch) can't be edited lane-by-
// lane directly; it needs one explicit, one-way "Enable lane editing" click first (materializeLanes
// — see edit.ts's doc comment for exactly how it maps the old kickTune/kickPunch/... fields onto
// the new per-lane params so the migrated kit sounds the same).

function backingSummary(b: BeatDrumLaneDecl['backing']): string {
  if (b.type === 'synth') {
    const parts = Object.entries(b.params).map(([k, v]) => `${k}=${v}`)
    return `synth:${b.voice}${parts.length ? ' ' + parts.join(' ') : ''}`
  }
  if (b.type === 'sample') {
    const extras = SAMPLE_LANE_PARAM_KEYS.filter((k) => b.params[k] !== undefined && b.params[k] !== SAMPLE_LANE_PARAM_DEFAULTS[k])
      .map((k) => `${k}=${b.params[k]}`)
      .join(' ')
    const filter = b.filterType !== 'lowpass' ? ` filter=${b.filterType}` : ''
    const fx = b.effects.length > 0 ? ` fx=${b.effects.map((e) => e.type).join(',')}` : ''
    return `sample "${b.sample}" ${b.gainDb}dB ${b.tune}st${extras ? ' ' + extras : ''}${filter}${fx}`
  }
  return `sf "${b.sample}" pgm ${b.program} note ${b.note}`
}

function isSoundfont(m: BeatMediaSample): boolean {
  return /\.(sf2|sf3)$/i.test(m.path)
}

function LaneRow({ track, lane, index, count }: { track: BeatTrack; lane: BeatDrumLaneDecl; index: number; count: number }) {
  const media = useStore((s) => s.doc?.media ?? [])
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const b = lane.backing

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function retype(type: 'synth' | 'sample' | 'sf') {
    if (type === 'synth') {
      void run(() => postLaneOp({ op: 'backing', track: track.id, name: lane.name, backing: 'synth:membrane' }))
      return
    }
    const pool = media.filter((m) => (type === 'sf' ? isSoundfont(m) : !isSoundfont(m)))
    const first = pool[0]
    if (!first) {
      setError(`no ${type === 'sf' ? 'soundfont' : 'sample'} registered in this project yet — drag one in from the content browser first`)
      return
    }
    const backing = type === 'sample' ? `sample ${first.id} 0 0` : `sf ${first.id} 0 60`
    void run(() => postLaneOp({ op: 'backing', track: track.id, name: lane.name, backing }))
  }

  return (
    <div className="lane-row" data-lane-row={lane.name}>
      <div className="lane-row-head">
        <span className="lane-row-name">{lane.name}</span>
        <span className="lane-row-backing" title={backingSummary(b)}>
          {backingSummary(b)}
        </span>
        <button
          type="button"
          data-lane-move-up={lane.name}
          disabled={index === 0 || busy}
          title="move up"
          onClick={() => void run(() => postLaneOp({ op: 'move', track: track.id, name: lane.name, index: index - 1 }))}
        >
          {'▲'}
        </button>
        <button
          type="button"
          data-lane-move-down={lane.name}
          disabled={index === count - 1 || busy}
          title="move down"
          onClick={() => void run(() => postLaneOp({ op: 'move', track: track.id, name: lane.name, index: index + 1 }))}
        >
          {'▼'}
        </button>
        <button type="button" data-lane-edit-toggle={lane.name} title="edit backing" onClick={() => setEditing((o) => !o)}>
          {editing ? '▾' : '▸'} edit
        </button>
        <button
          type="button"
          className="lane-row-remove"
          data-lane-remove={lane.name}
          disabled={busy}
          title="remove lane (fails if a hit still uses it)"
          onClick={() => void run(() => postLaneOp({ op: 'remove', track: track.id, name: lane.name }))}
        >
          {'✕'}
        </button>
      </div>
      {editing && (
        <div className="lane-row-edit">
          <label className="lane-edit-field">
            type
            <select data-lane-retype={lane.name} value={b.type} onChange={(e) => retype(e.target.value as 'synth' | 'sample' | 'sf')} disabled={busy}>
              <option value="synth">synth</option>
              <option value="sample">sample</option>
              <option value="sf">sf</option>
            </select>
          </label>
          {b.type === 'synth' && (
            <>
              <label className="lane-edit-field">
                voice
                <select
                  data-lane-voice={lane.name}
                  value={b.voice}
                  disabled={busy}
                  onChange={(e) => void run(() => postLaneOp({ op: 'backing', track: track.id, name: lane.name, backing: `synth:${e.target.value}` }))}
                >
                  {DRUM_VOICE_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              {Object.keys(DRUM_VOICE_PARAM_DEFAULTS[b.voice as DrumVoiceType]).map((key) => (
                <label className="lane-edit-field" key={key}>
                  {key}
                  <input
                    type="number"
                    step={0.01}
                    disabled={busy}
                    data-lane-param={`${lane.name}.${key}`}
                    defaultValue={b.params[key] ?? DRUM_VOICE_PARAM_DEFAULTS[b.voice as DrumVoiceType][key]}
                    onBlur={(e) => {
                      const raw = e.target.value.trim()
                      const value = raw === '' ? undefined : Number(raw)
                      void run(() => postLaneOp({ op: 'param', track: track.id, name: lane.name, key, value }))
                    }}
                  />
                </label>
              ))}
            </>
          )}
          {b.type === 'sample' && (
            <>
              <label className="lane-edit-field">
                sample
                <select
                  data-lane-sample={lane.name}
                  value={b.sample}
                  disabled={busy}
                  onChange={(e) => void run(() => postLaneOp({ op: 'backing', track: track.id, name: lane.name, backing: sampleBackingLine(b, { sample: e.target.value }) }))}
                >
                  {media
                    .filter((m) => !isSoundfont(m))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                </select>
              </label>
              <label className="lane-edit-field">
                gain dB
                <input
                  type="number"
                  step={0.5}
                  disabled={busy}
                  defaultValue={b.gainDb}
                  onBlur={(e) => void run(() => postLaneOp({ op: 'backing', track: track.id, name: lane.name, backing: sampleBackingLine(b, { gainDb: e.target.value }) }))}
                />
              </label>
              <label className="lane-edit-field">
                tune
                <input
                  type="number"
                  step={0.5}
                  min={-24}
                  max={24}
                  disabled={busy}
                  defaultValue={b.tune}
                  onBlur={(e) => void run(() => postLaneOp({ op: 'backing', track: track.id, name: lane.name, backing: sampleBackingLine(b, { tune: e.target.value }) }))}
                />
              </label>
              {/* Phase 26 Stream DK: the lean drum-sampler surface — Start/Length trim, AHD
                  envelope, filter cutoff/resonance, all riding setLaneParam (op: 'param') exactly
                  like a synth-backed lane's own per-param inputs just above. */}
              {SAMPLE_LANE_PARAM_KEYS.map((key) => (
                <label className="lane-edit-field" key={key}>
                  {key}
                  <input
                    type="number"
                    step={key === 'cutoff' ? 100 : key === 'resonance' ? 0.1 : 0.01}
                    disabled={busy}
                    data-lane-param={`${lane.name}.${key}`}
                    defaultValue={b.params[key] ?? SAMPLE_LANE_PARAM_DEFAULTS[key]}
                    onBlur={(e) => {
                      const raw = e.target.value.trim()
                      const value = raw === '' ? undefined : Number(raw)
                      void run(() => postLaneOp({ op: 'param', track: track.id, name: lane.name, key, value }))
                    }}
                  />
                </label>
              ))}
              <label className="lane-edit-field">
                filter
                <select
                  data-lane-filter={lane.name}
                  value={b.filterType}
                  disabled={busy}
                  onChange={(e) => void run(() => postLaneOp({ op: 'backing', track: track.id, name: lane.name, backing: sampleBackingLine(b, { filterType: e.target.value as SampleLaneFilterType }) }))}
                >
                  {SAMPLE_LANE_FILTER_TYPES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <div className="lane-edit-field lane-edit-fx">
                fx
                {EFFECT_TYPES.map((type) => {
                  const on = b.effects.some((e) => e.type === type)
                  return (
                    <label key={type} className="lane-fx-toggle">
                      <input
                        type="checkbox"
                        data-lane-fx={`${lane.name}.${type}`}
                        checked={on}
                        disabled={busy}
                        onChange={(e) => {
                          const nextTypes = e.target.checked ? [...b.effects.map((eff) => eff.type), type] : b.effects.filter((eff) => eff.type !== type).map((eff) => eff.type)
                          void run(() => postLaneOp({ op: 'backing', track: track.id, name: lane.name, backing: sampleBackingLine(b, { effects: nextTypes }) }))
                        }}
                      />
                      {EFFECT_LABELS[type]}
                    </label>
                  )
                })}
              </div>
            </>
          )}
          {b.type === 'sf' && (
            <>
              <label className="lane-edit-field">
                bank
                <select
                  data-lane-sf-sample={lane.name}
                  value={b.sample}
                  disabled={busy}
                  onChange={(e) => void run(() => postLaneOp({ op: 'backing', track: track.id, name: lane.name, backing: `sf ${e.target.value} ${b.program} ${b.note}` }))}
                >
                  {media
                    .filter(isSoundfont)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                </select>
              </label>
              <label className="lane-edit-field">
                program
                <input
                  type="number"
                  step={1}
                  min={0}
                  max={127}
                  disabled={busy}
                  defaultValue={b.program}
                  onBlur={(e) => void run(() => postLaneOp({ op: 'backing', track: track.id, name: lane.name, backing: `sf ${b.sample} ${e.target.value} ${b.note}` }))}
                />
              </label>
              <label className="lane-edit-field">
                note
                <input
                  type="number"
                  step={1}
                  min={0}
                  max={127}
                  disabled={busy}
                  defaultValue={b.note}
                  onBlur={(e) => void run(() => postLaneOp({ op: 'backing', track: track.id, name: lane.name, backing: `sf ${b.sample} ${b.program} ${e.target.value}` }))}
                />
              </label>
            </>
          )}
        </div>
      )}
      {error && <div className="lane-row-error">{error}</div>}
    </div>
  )
}

function AddLaneForm({ track }: { track: BeatTrack }) {
  const [name, setName] = useState('')
  const [voice, setVoice] = useState<DrumVoiceType>('membrane')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      await postLaneOp({ op: 'add', track: track.id, name: trimmed, backing: `synth:${voice}` })
      setName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lane-add-form">
      <input data-lane-add-name placeholder="new lane name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
      <select data-lane-add-voice value={voice} disabled={busy} onChange={(e) => setVoice(e.target.value as DrumVoiceType)}>
        {DRUM_VOICE_TYPES.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      <button type="button" data-lane-add-submit disabled={busy || !name.trim()} onClick={() => void add()}>
        + Add lane
      </button>
      {error && <span className="lane-row-error">{error}</span>}
    </div>
  )
}

export function DrumLanePanel({ track }: { track: BeatTrack }) {
  // Collapsible but defaults OPEN (unlike ContentBrowser's sections) — this is the primary way to
  // manage a drum kit's voicing, not an occasional drawer; a first-time user (or a live-verification
  // script) should see it without an extra click, the same "always visible" treatment SynthPanel's
  // EffectChain already gets.
  const [expanded, setExpanded] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (track.kind !== 'drums') return null
  const isOpen = track.lanes.length > 0
  const laneNames = declaredLaneNames(track)

  async function materialize() {
    setBusy(true)
    setError(null)
    try {
      await postLaneOp({ op: 'materialize', track: track.id })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lane-panel" data-testid="lane-panel">
      <button type="button" className="lane-panel-title" data-lane-panel-toggle onClick={() => setExpanded((o) => !o)}>
        {expanded ? '▾' : '▸'} Lanes ({laneNames.length}) {isOpen ? '· open' : '· implicit 5-lane kit'}
      </button>
      {expanded && (
        <>
          {!isOpen && (
            <div className="lane-panel-materialize">
              <span className="lane-panel-hint">
                This track still plays the built-in 5-lane kit (kick/snare/clap/hat/openhat). Enable lane editing once
                to add/reorder/retype lanes and tune per-lane synth params — the current sound carries over unchanged.
              </span>
              <button type="button" data-lane-materialize disabled={busy} onClick={() => void materialize()}>
                Enable lane editing
              </button>
            </div>
          )}
          {isOpen && (
            <>
              <div className="lane-panel-list">
                {track.lanes.map((lane, i) => (
                  <LaneRow key={lane.name} track={track} lane={lane} index={i} count={track.lanes.length} />
                ))}
              </div>
              <AddLaneForm track={track} />
            </>
          )}
          {error && <div className="lane-row-error">{error}</div>}
        </>
      )}
    </div>
  )
}
