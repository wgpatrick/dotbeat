import { useCallback, useRef } from 'react'
import { Knob } from './Knob'
import { postEdit } from '../daemon/bridge'
import { useStore, isEffectivelyMuted } from '../state/store'
import type { BeatTrack } from '../types'

// The mixer: every track's channel strip visible together (not one-at-a-time like SynthPanel).
// Level (volume, dB) and pan read/write through the same GET /document + POST /edit primitives the
// rest of ui/ uses — a fader drag is a one-line `<id>.volume` diff, exactly like a SynthPanel knob.
// Mute/solo are GUI-only session state (the .beat format carries no mute/solo field) — see the
// store note; they drive the strip's visual state and the effective-mute logic, and audio gating
// from them is deferred until the engine exposes a per-track mute hook (Stream A owns the engine).

const VOL_MIN = -60
const VOL_MAX = 6

/** volume/pan live on the instrument block for instrument tracks, the synth block otherwise —
 * but the edit path is `<id>.volume`/`<id>.pan` in both cases (setValue routes on track.kind). */
function trackVolume(t: BeatTrack): number {
  return t.kind === 'instrument' && t.instrument ? t.instrument.volume : t.synth.volume
}
function trackPan(t: BeatTrack): number {
  return t.kind === 'instrument' && t.instrument ? t.instrument.pan : t.synth.pan
}

const fmtDb = (v: number) => (v <= VOL_MIN ? '-∞' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`)
const fmtPan = (v: number) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)

/** A vertical level fader — pointer-drag to set dB (linear over the dB range, DAW-standard). */
function Fader({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const drag = useRef<{ startY: number; startNorm: number } | null>(null)
  const norm = Math.min(1, Math.max(0, (value - VOL_MIN) / (VOL_MAX - VOL_MIN)))

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      drag.current = { startY: e.clientY, startNorm: norm }
    },
    [norm],
  )
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return
      const dy = drag.current.startY - e.clientY
      const next = Math.min(1, Math.max(0, drag.current.startNorm + dy / 160))
      onChange(VOL_MIN + next * (VOL_MAX - VOL_MIN))
    },
    [onChange],
  )
  const onPointerUp = useCallback(() => {
    drag.current = null
  }, [])

  return (
    <div className="mixer-fader" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} style={{ touchAction: 'none' }}>
      <div className="mixer-fader-track">
        {/* 0 dB marker */}
        <div className="mixer-fader-zero" style={{ bottom: `${((0 - VOL_MIN) / (VOL_MAX - VOL_MIN)) * 100}%` }} />
        <div className="mixer-fader-fill" style={{ height: `${norm * 100}%` }} />
        <div className="mixer-fader-handle" style={{ bottom: `${norm * 100}%` }} />
      </div>
    </div>
  )
}

function ChannelStrip({ track }: { track: BeatTrack }) {
  const muted = useStore((s) => !!s.mutes[track.id])
  const soloed = useStore((s) => !!s.solos[track.id])
  const dimmed = useStore((s) => isEffectivelyMuted(s, track.id))
  const toggleMute = useStore((s) => s.toggleMute)
  const toggleSolo = useStore((s) => s.toggleSolo)

  const vol = trackVolume(track)
  const pan = trackPan(track)

  return (
    <div className={`mixer-strip ${dimmed ? 'dimmed' : ''}`}>
      <div className="mixer-strip-head">
        <span className="mixer-strip-swatch" style={{ background: track.color }} />
        <span className="mixer-strip-name" style={{ color: track.color }}>
          {track.name}
        </span>
        <span className={`mixer-strip-kind kind-${track.kind}`}>{track.kind}</span>
      </div>

      <Knob label="Pan" value={pan} min={-1} max={1} format={fmtPan} onChange={(v) => postEdit(`${track.id}.pan`, String(v))} />

      <div className="mixer-strip-fader">
        <Fader value={vol} onChange={(v) => postEdit(`${track.id}.volume`, String(v))} />
        <div className="mixer-strip-db">{fmtDb(vol)}</div>
      </div>

      <div className="mixer-strip-buttons">
        <button className={`mixer-btn mute ${muted ? 'on' : ''}`} onClick={() => toggleMute(track.id)} title="mute (session-only, not saved)">
          M
        </button>
        <button className={`mixer-btn solo ${soloed ? 'on' : ''}`} onClick={() => toggleSolo(track.id)} title="solo (session-only, not saved)">
          S
        </button>
      </div>
    </div>
  )
}

export function MixerView() {
  const doc = useStore((s) => s.doc)
  if (!doc) return null
  return (
    <div className="mixer">
      <div className="editor-toolbar">
        <span className="editor-title">mixer</span>
        <span className="toolbar-tip">level + pan write to the .beat (one-line diff) · mute/solo are session-only · per-track meters + FX are a later stream</span>
      </div>
      <div className="mixer-strips">
        {doc.tracks.map((t) => (
          <ChannelStrip key={t.id} track={t} />
        ))}
      </div>
    </div>
  )
}
