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

// ---- FX-chain indicator (Phase 16 Stream K) ------------------------------------------------
// A compact "what's actually processing this track" readout, reading the SAME synth-block fields
// SynthPanel/synthParams.ts already render in full (src/core/document.ts SYNTH_FIELDS) — no new
// per-track state, just a glance-able summary of live data. Only synth/drums tracks carry an
// insert chain the engine actually applies (buildSynthChain/getDrumBus's EQ3 -> comp -> distortion
// -> bitcrush, see engine.ts); instrument tracks DO carry a synth block on disk (BeatTrack.synth is
// non-optional) but the engine never reads it for instrument playback (Phase 14 Stream F — level/
// pan only), so showing insert badges there would be decorative, not real per-track data. Each
// badge's "active" heuristic mirrors what the engine treats as audible: EQ if any band is off 0 dB,
// Comp/Distortion/Bitcrush by their *Mix (wet) fraction — the same field the engine wires to the
// insert's `.wet`/dry-wet blend, so mix=0 is genuinely a bypassed (inaudible) insert regardless of
// the insert's other params (e.g. distortionAmount with distortionMix 0 does nothing audible).
const FX_BADGES: { key: string; label: string; active: (p: Record<string, unknown>) => boolean }[] = [
  { key: 'eq', label: 'EQ', active: (p) => num(p.eqLow) !== 0 || num(p.eqMid) !== 0 || num(p.eqHigh) !== 0 },
  { key: 'comp', label: 'Comp', active: (p) => num(p.compMix) > 0 },
  { key: 'dist', label: 'Dist', active: (p) => num(p.distortionMix) > 0 },
  { key: 'crush', label: 'Crush', active: (p) => num(p.bitcrushMix) > 0 },
]

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function FxBadges({ track }: { track: BeatTrack }) {
  // Instrument tracks: no insert chain the engine applies (see the block comment above) — nothing
  // honest to show, so render an empty row (keeps every strip's layout aligned) rather than a row
  // of always-inactive/misleading badges.
  if (track.kind === 'instrument') return <div className="mixer-strip-fx" />
  const active = FX_BADGES.filter((b) => b.active(track.synth))
  return (
    <div className="mixer-strip-fx" title="active insert-chain processing (EQ / comp / distortion / bitcrush)">
      {active.length === 0 ? (
        <span className="mixer-fx-badge mixer-fx-none">—</span>
      ) : (
        active.map((b) => (
          <span key={b.key} className={`mixer-fx-badge mixer-fx-${b.key}`}>
            {b.label}
          </span>
        ))
      )}
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

      <FxBadges track={track} />

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
        <span className="toolbar-tip">
          level + pan write to the .beat (one-line diff) · mute/solo are session-only but now gate audio (incl. instrument tracks) · live per-track
          meters (incl. instrument tracks) · badges show each strip's active insert chain
        </span>
      </div>
      <div className="mixer-strips">
        {doc.tracks.map((t) => (
          <ChannelStrip key={t.id} track={t} />
        ))}
      </div>
    </div>
  )
}
