import { useEffect, useState } from 'react'
import { Knob } from './Knob'
import { type BeatTrack } from '../types'
import { postEdit, daemonBase } from '../daemon/bridge'

// Phase 14 Stream F: the device panel for an instrument (SoundFont) track. Instrument tracks carry
// a tiny param set (BeatInstrument: sample/program/volume/pan) rather than the 55-field synth block,
// so this is a dedicated small panel instead of SynthPanel's generic knob-grid. Program selection
// is populated from the daemon's `/soundfont-presets` route (which parses the bank's actual .sf2
// programs, the same list `beat inspect` prints); volume/pan reuse the shared Knob. Every control
// POSTs `<track>.<field>` via /edit — one line in the .beat file, same as every other edit.

interface Preset {
  program: number
  bankMSB: number
  bankLSB: number
  name: string
}

export function InstrumentPanel({ track }: { track: BeatTrack }) {
  const inst = track.instrument
  const sample = inst?.sample
  const [presets, setPresets] = useState<Preset[] | null>(null)
  const [error, setError] = useState<string | null>(null)

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
          {error && <div className="toolbar-tip" style={{ color: '#e06c75' }}>could not list programs: {error}</div>}
          {presets && presets.length > 0 && (
            <div className="toolbar-tip">{presets.length} program{presets.length === 1 ? '' : 's'} in this bank</div>
          )}
        </div>
      </div>
    </div>
  )
}
