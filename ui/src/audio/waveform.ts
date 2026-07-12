// Phase 23 Stream BC — a tiny standalone decode-and-cache utility for the audio-clip inspector's
// waveform render (ui/src/components/ArrangementView.tsx's AudioClipInspector). Deliberately
// independent of engine.ts's own `audioBuffers` cache (Phase 22 Stream AE's decode-for-PLAYBACK
// path): that cache is private, populated lazily off the engine's tick-driven sync(), and has no
// "decode this specific media right now, regardless of whether the engine currently has any track
// wired to it" entry point a UI component can poll cleanly. This module fetches+decodes
// independently — the same `GET /media/<path>` route, the same `decodeAudioData` call — and caches
// by media id so re-rendering the inspector (e.g. every trim-field edit) doesn't re-fetch/re-decode.
//
// Scope (task brief): a BASIC static waveform that makes in/out trim points visually legible — a
// min/max-per-pixel-column render, no zoom/scroll, no drag-to-trim (that's the same "region-level
// fade/drag-handle" future stream docs/phase-22-stream-ae.md already flagged as out of scope here).

import { daemonBase } from '../daemon/bridge'

export interface WaveformData {
  /** Mono (channel 0) samples in -1..1, the full decoded buffer. */
  channelData: Float32Array
  duration: number // seconds
}

const cache = new Map<string, WaveformData>()
const pending = new Map<string, Promise<WaveformData>>()
let sharedCtx: AudioContext | null = null

function ctx(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext()
  return sharedCtx
}

export function getCachedWaveform(mediaId: string): WaveformData | null {
  return cache.get(mediaId) ?? null
}

/** Fetch+decode one media sample (by its document media id + path) into the cache, deduplicating
 * concurrent callers for the same id (same discipline engine.ts's audioBufferPending guard uses). */
export async function loadWaveform(mediaId: string, mediaPath: string): Promise<WaveformData> {
  const cached = cache.get(mediaId)
  if (cached) return cached
  const inflight = pending.get(mediaId)
  if (inflight) return inflight
  const promise = (async () => {
    const res = await fetch(`${daemonBase()}/media/${mediaPath}`)
    if (!res.ok) throw new Error(`fetch media "${mediaPath}": HTTP ${res.status}`)
    const bytes = await res.arrayBuffer()
    const decoded = await ctx().decodeAudioData(bytes)
    const data: WaveformData = { channelData: decoded.getChannelData(0), duration: decoded.duration }
    cache.set(mediaId, data)
    return data
  })()
  pending.set(mediaId, promise)
  try {
    return await promise
  } finally {
    pending.delete(mediaId)
  }
}

/** Draws a static min/max-per-pixel-column waveform onto `canvas`'s full CSS-sized box, dimming
 * whatever falls outside [inSec, outSec] (the region's current trim points) and marking the two
 * boundaries with a vertical line — the task brief's explicit ask ("make trim points visually
 * legible"), not a full editable waveform. Safe to call repeatedly (e.g. every trim-field edit);
 * it's a cheap synchronous redraw once the buffer is already decoded. */
export function drawWaveform(canvas: HTMLCanvasElement, wf: WaveformData, inSec: number, outSec: number, color: string): void {
  const dpr = window.devicePixelRatio || 1
  const cssW = Math.max(1, canvas.clientWidth || 600)
  const cssH = Math.max(1, canvas.clientHeight || 48)
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  const g = canvas.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, cssW, cssH)
  g.fillStyle = 'rgba(255,255,255,0.03)'
  g.fillRect(0, 0, cssW, cssH)

  const { channelData, duration } = wf
  const n = channelData.length
  const mid = cssH / 2
  const inX = duration > 0 ? (Math.max(0, Math.min(inSec, duration)) / duration) * cssW : 0
  const outX = duration > 0 ? (Math.max(0, Math.min(outSec, duration)) / duration) * cssW : cssW
  const samplesPerPx = n / cssW

  for (let x = 0; x < cssW; x++) {
    const start = Math.floor(x * samplesPerPx)
    const end = Math.max(start + 1, Math.floor((x + 1) * samplesPerPx))
    let min = 1
    let max = -1
    for (let i = start; i < end && i < n; i++) {
      const v = channelData[i]!
      if (v < min) min = v
      if (v > max) max = v
    }
    if (min > max) {
      min = 0
      max = 0
    }
    const insideTrim = x >= inX && x <= outX
    g.strokeStyle = insideTrim ? color : 'rgba(255,255,255,0.16)'
    g.beginPath()
    g.moveTo(x + 0.5, mid + min * mid * 0.92)
    g.lineTo(x + 0.5, mid + max * mid * 0.92)
    g.stroke()
  }

  g.strokeStyle = 'rgba(224,161,60,0.9)'
  g.lineWidth = 1
  for (const x of [inX, outX]) {
    g.beginPath()
    g.moveTo(Math.round(x) + 0.5, 0)
    g.lineTo(Math.round(x) + 0.5, cssH)
    g.stroke()
  }
}
