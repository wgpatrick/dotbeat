import { useEffect, useState } from 'react'
import { Knob } from './Knob'
import { type BeatTrack, type EffectType } from '../types'
import { postEdit, daemonBase } from '../daemon/bridge'
import { fetchLibrary, installSoundfont, type LibrarySoundfont } from '../daemon/library'
import { EffectChain, Group, MacroRow } from './SynthPanel'
import { PARAM_GROUPS } from './synthParams'
import { useStore } from '../state/store'

// Phase 14 Stream F: the device panel for an instrument (SoundFont) track. Instrument tracks carry
// a tiny param set (BeatInstrument: sample/program/volume/pan) rather than the 55-field synth block,
// so this is a dedicated small panel instead of SynthPanel's generic knob-grid. Program selection
// is populated from the daemon's `/soundfont-presets` route (which parses the bank's actual .sf2
// programs, the same list `beat inspect` prints); volume/pan reuse the shared Knob. Every control
// POSTs `<track>.<field>` via /edit — one line in the .beat file, same as every other edit.
//
// Phase 26 Stream DC: instrument tracks now carry the SAME reorderable insert-effect chain synth/
// drum tracks do (BeatTrack.effects in document.ts) — reuses SynthPanel's own EffectChain/Group
// components rather than reinventing the add/reorder/bypass UI or the effectType-gated knob-group
// renderer (docs/effects-panel-redesign.md's pattern). The knobs behind each group are the ~12
// EffectType chain members' own params (document.ts's INSTRUMENT_EFFECT_FIELD_KEYS) — the ONLY
// SYNTH_FIELDS an instrument track can carry; everything else (oscillator/filter/envelope/LFO)
// still has no meaning on a SoundFont voice, unchanged from this file's original design.

interface Preset {
  program: number
  bankMSB: number
  bankLSB: number
  name: string
}

// Phase 23 Stream BB: the hot-swap SOUNDFONT browser inside Device View — the instrument-track
// analog of SynthPanel's PresetPicker. Swaps which bank this track plays (reassigns via
// installSoundfont, the same daemon route Phase 22 Stream AH's sidebar drag/+ button uses) without
// leaving the panel. A real, persisted write (not a preview) — same distinction AH's own honest-gap
// note draws between the sidebar's outside-the-panel drop and this inside-the-panel swap.
function SoundfontPicker({ track }: { track: BeatTrack }) {
  const [fonts, setFonts] = useState<LibrarySoundfont[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [busy, setBusy] = useState(false)
  const [applied, setApplied] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchLibrary()
      .then((lib) => {
        if (!cancelled) setFonts(lib.soundfonts)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function swap(file: string) {
    setBusy(true)
    setError(null)
    setApplied(null)
    try {
      await installSoundfont(file, { track: track.id })
      setApplied(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (error && !fonts) return <div className="preset-picker preset-picker-error">soundfont browser: {error}</div>
  if (!fonts) return <div className="preset-picker">loading soundfonts…</div>
  if (fonts.length === 0) return null

  const current = fonts[cursor]

  return (
    <div className="preset-picker" data-testid="soundfont-picker">
      <span className="preset-picker-label">soundfont</span>
      <button
        type="button"
        data-soundfont-prev
        disabled={busy}
        onClick={() => {
          const next = (cursor - 1 + fonts.length) % fonts.length
          setCursor(next)
          void swap(fonts[next]!.file)
        }}
        title="previous soundfont"
      >
        {'◀'}
      </button>
      <select
        data-soundfont-select
        value={current?.file ?? ''}
        disabled={busy}
        onChange={(e) => {
          const i = fonts.findIndex((f) => f.file === e.target.value)
          if (i === -1) return
          setCursor(i)
          void swap(fonts[i]!.file)
        }}
      >
        {fonts.map((f) => (
          <option key={f.file} value={f.file}>
            {f.file}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-soundfont-next
        disabled={busy}
        onClick={() => {
          const next = (cursor + 1) % fonts.length
          setCursor(next)
          void swap(fonts[next]!.file)
        }}
        title="next soundfont"
      >
        {'▶'}
      </button>
      {applied && <span className="preset-picker-applied">swapped in &quot;{applied}&quot;</span>}
      {error && <span className="preset-picker-error">{error}</span>}
    </div>
  )
}

export function InstrumentPanel({ track }: { track: BeatTrack }) {
  const inst = track.instrument
  const sample = inst?.sample
  const [presets, setPresets] = useState<Preset[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Select the stable tracks array reference (unchanged on per-tick currentStep/masterLevel
  // updates), same discipline SynthPanel's own trackIds derivation uses.
  const tracks = useStore((s) => s.doc?.tracks)
  const trackIds = tracks?.map((t) => t.id) ?? []
  const effects = track.effects ?? []
  // Same effectType gate SynthPanel applies — only render a chain-member's knob group once that
  // type is actually present in `track.effects` (docs/effects-panel-redesign.md).
  const groups = PARAM_GROUPS.filter((g) => g.kinds.includes('instrument') && g.effectType && effects.some((e) => e.type === g.effectType))
  const [justAdded, setJustAdded] = useState<EffectType | null>(null)
  useEffect(() => {
    if (justAdded === null) return
    const t = setTimeout(() => setJustAdded(null), 1600)
    return () => clearTimeout(t)
  }, [justAdded])

  useEffect(() => {
    if (!sample) return
    let cancelled = false
    setPresets(null)
    setError(null)
    fetch(`${daemonBase()}/soundfont-presets?sample=${encodeURIComponent(sample)}`)
      .then(async (res) => {
        const body = (await res.json()) as { presets?: Preset[]; error?: string }
        if (cancelled) return
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
        setPresets(body.presets ?? [])
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [sample])

  if (!inst) return null

  return (
    <div className="synth-panel">
      <div className="editor-toolbar">
        <span className="editor-title" style={{ color: track.color }}>
          {track.name}
        </span>
        <span className="toolbar-tip">instrument (SoundFont) track · pick a program · set level/pan · each edit is one line in the .beat file</span>
      </div>
      {/* Phase 27 Stream EA bug 4 (docs/phase-27-plan.md): SoundfontPicker (below) already IS this
          track kind's own preset-picker — a hot-swap browser over "what presets exist for
          instrument/soundfont tracks today" (its own doc comment: "the instrument-track analog of
          SynthPanel's PresetPicker"), reusing the same `.preset-picker` shell/CSS and the same
          apply-immediately gesture. SynthPanel's own `PresetPicker` swaps a bag of ~58 synth params
          (osc/filter/envelope/...) that have no meaning on a SoundFont voice at all (see this file's
          header comment) — "the exact same preset shape doesn't apply" here, so it's deliberately
          NOT duplicated; SoundfontPicker is the adapted, sensible equivalent, not a placeholder for
          a second, separate PresetPicker. */}
      <SoundfontPicker track={track} />
      {/* Phase 28 Stream FE (docs/phase-28-plan.md, docs/research/77 §2.5/§3 P2 item 3): MacroRow now
          sits directly after the picker, matching SynthPanel.tsx's own picker -> macros -> chain
          rhythm, instead of being wedged after a whole soundfont knob block the other two panel kinds
          don't have at that position. The soundfont program/volume/pan controls move down below,
          folded in as their own group alongside the Effect Chain (part of "chain" in that rhythm, not
          a fourth thing between "picker" and "macros"). */}
      <MacroRow track={track} />
      <div className="param-groups">
        <div className="param-group" style={{ display: 'block' }}>
          <div className="param-group-title">soundfont</div>
          <div className="knob-row" style={{ alignItems: 'flex-end' }}>
            <label className="param-enum" title={`bank "${sample}"`}>
              <span className="knob-label">program</span>
              <select
                value={inst.program}
                onChange={(ev) => postEdit(`${track.id}.program`, ev.target.value)}
                disabled={!presets || presets.length === 0}
              >
                {/* Always show the current program even before the list loads, so the control is never empty. */}
                {(!presets || presets.length === 0) && <option value={inst.program}>program {inst.program}</option>}
                {presets?.map((p) => (
                  <option key={`${p.bankMSB}/${p.bankLSB}/${p.program}`} value={p.program}>
                    {p.program} — {p.name}
                    {p.bankMSB || p.bankLSB ? ` (bank ${p.bankMSB}/${p.bankLSB})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <Knob
              label="volume"
              value={inst.volume}
              min={-60}
              max={6}
              format={(v) => `${v.toFixed(1)} dB`}
              hint="instrument track level (dB)"
              onChange={(v) => postEdit(`${track.id}.volume`, String(v))}
            />
            <Knob
              label="pan"
              value={inst.pan}
              min={-1}
              max={1}
              format={(v) => (Math.abs(v) < 0.01 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)}
              hint="instrument track pan (-1 L .. 1 R)"
              onChange={(v) => postEdit(`${track.id}.pan`, String(v))}
            />
          </div>
          {error && <div className="toolbar-tip error">could not list programs: {error}</div>}
          {presets && presets.length > 0 && (
            <div className="toolbar-tip">{presets.length} program{presets.length === 1 ? '' : 's'} in this bank</div>
          )}
        </div>
      </div>
      {/* Phase 26 Stream DC: reuses SynthPanel's own EffectChain/Group — same add/reorder/bypass
          UI and effectType-gated knob-group rendering synth/drum tracks already have. */}
      <EffectChain track={track} onAdded={setJustAdded} />
      <div className="param-groups">
        {groups.map((g) => (
          <Group key={g.id} track={track} group={g} trackIds={trackIds} highlight={g.effectType === justAdded} />
        ))}
      </div>
    </div>
  )
}
