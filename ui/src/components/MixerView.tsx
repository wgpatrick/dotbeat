import { useCallback, useEffect, useRef } from 'react'
import { Knob } from './Knob'
import { engine } from '../audio/engine'
import { onAnimationFrame } from '../audio/animationFrame'
import { postEdit } from '../daemon/bridge'
import { useStore, isEffectivelyMuted } from '../state/store'
import type { BeatTrack } from '../types'

// The mixer: every track's channel strip visible together (not one-at-a-time like SynthPanel).
// Level (volume, dB) and pan read/write through the same GET /document + POST /edit primitives the
// rest of ui/ uses — a fader drag is a one-line `<id>.volume` diff, exactly like a SynthPanel knob.
// Mute/solo are GUI-only session state (the .beat format carries no mute/solo field) — see the
// store note; they drive the strip's visual state AND real audio gating: the engine reads
// isEffectivelyMuted per tick and gates each track's muteGain (Phase 14 Stream E). Each strip also
// shows a live post-fader meter (TrackMeter) tapped straight off the engine via the shared rAF loop.

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

// A per-channel level meter. Follows Scope.tsx's canvas-escape-hatch discipline exactly: it owns a
// <canvas>, subscribes to the shared throttled rAF driver (audio/animationFrame.ts — NOT a private
// loop), and reads this track's live post-fader level straight off the engine each frame
// (engine.getTrackLevel). It never routes continuous per-frame data through Zustand — the level is a
// direct engine tap, not React state (docs/research/15 §2). A muted track's post-mute meter reads
// silent, so this doubles as visual confirmation the mute gate is real.
const METER_W = 8
const METER_H = 150
const METER_MIN_DB = -60

function TrackMeter({ trackId }: { trackId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const w = canvas.width
      const h = canvas.height
      ctx.fillStyle = '#151515'
      ctx.fillRect(0, 0, w, h)

      const level = engine.getTrackLevel(trackId)
      if (level !== null && Number.isFinite(level) && level > METER_MIN_DB) {
        const norm = Math.max(0, Math.min(1, (level - METER_MIN_DB) / (0 - METER_MIN_DB)))
        const barH = norm * h
        // green under -12 dB, amber into -3, red above — classic level-meter zones.
        const color = level > -3 ? '#e05a3c' : level > -12 ? '#e0a13c' : '#4caf6a'
        ctx.fillStyle = color
        ctx.fillRect(0, h - barH, w, barH)
      }
    }

    return onAnimationFrame(draw)
  }, [trackId])

  return <canvas ref={canvasRef} width={METER_W} height={METER_H} className="mixer-meter" title="live level (post-fader, post-mute)" />
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
        <div className="mixer-fader-row">
          <Fader value={vol} onChange={(v) => postEdit(`${track.id}.volume`, String(v))} />
          <TrackMeter trackId={track.id} />
        </div>
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
        <span className="toolbar-tip">level + pan write to the .beat (one-line diff) · mute/solo are session-only but now gate audio · live per-track meters</span>
      </div>
      <div className="mixer-strips">
        {doc.tracks.map((t) => (
          <ChannelStrip key={t.id} track={t} />
        ))}
      </div>
    </div>
  )
}
