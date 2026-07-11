import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore, isEffectivelyMuted } from '../state/store'
import { postEdit, postSelection, daemonBase } from '../daemon/bridge'
import { DRUM_LANES, type BeatDocument, type BeatTrack, type DrumLane } from '../types'

// ── Arrangement length (Phase 19 Stream V) ───────────────────────────────────────────────────────
// Two length surfaces, matching the two document modes. Loop mode (doc.song === null) is a single
// region sized by loop_bars — changed through the ordinary optimistic {path,value} /edit path
// (postEdit), like every other one-line edit. Song mode's timeline IS the section list, which /edit
// can't express as one line — appending/deleting/resizing a section is a whole-list setSong
// statement — so those go through the daemon's additive POST /song route, then re-pull the
// authoritative document (the daemon doesn't broadcast its own writes; see bridge.ts's /edit note).
const LOOP_MIN = 1
const LOOP_MAX = 64
const clampBars = (n: number, lo = LOOP_MIN, hi = LOOP_MAX) => Math.max(lo, Math.min(hi, Math.round(n)))

/** Change loop-mode length via the already-supported `loop_bars` edit path (optimistic + debounced;
 * one canonical line on disk). */
function changeLoopBars(next: number): void {
  postEdit('loop_bars', String(clampBars(next)))
}

/** Issue one arrangement-length op to the daemon's /song route, then re-pull /document so the UI
 * reflects the new sections/scenes/clips (the daemon doesn't echo its own writes). */
async function postSong(body: { op: 'append' | 'resize' | 'delete'; index?: number; bars?: number }): Promise<void> {
  const base = daemonBase()
  try {
    const res = await fetch(`${base}/song`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn(`[daw] POST /song ${body.op}: HTTP ${res.status}`, await res.text().catch(() => ''))
      return
    }
    const docRes = await fetch(`${base}/document`)
    if (docRes.ok) useStore.getState().setDoc((await docRes.json()) as BeatDocument)
  } catch (err) {
    console.warn('[daw] could not POST /song:', err)
  }
}

// The arrangement / song view (D4, product-spec-desktop §5). Tracks as rows, bars as columns,
// real scenes/clips/section boundaries from the document's song arrangement. Canvas-rendered, one
// <canvas> per track row (docs/phase-11-song-view.md's validated approach: DOM/SVG node count
// scales with total notes, canvas draw calls scale with events actually drawn — the right cost
// model for a dense, zoomed-out timeline). Below a px/bar threshold each bar collapses to one
// opacity-encoded density block; above it, real note/hit ticks render — the audio-waveform
// min/max-per-pixel LOD idea generalized to notes. Nothing here updates per-frame, so canvases
// redraw on data/selection/size change (no rAF loop needed — matches Scope.tsx's convention but
// without the animation loop).

const ROW_H = 56 // taller than the pre-Phase-18 44px: the header now stacks a name row + an inline mixer strip
const HEADER_W = 264 // wide enough for the inline channel strip (mute/solo/volume/pan/sends) in the track header
const RULER_H = 26
const DETAIL_PX_PER_BAR = 32 // at or above this, draw real ticks; below, density blocks
const DENSITY_REF = 6 // events/bar that reads as full-opacity (soft normalization, not a hard cap)

// ── Inline channel-strip helpers (Phase 18): the arrangement track header carries a compact subset
// of the full mixer, reusing MixerView's exact data-flow — volume/pan write `<id>.volume`/`<id>.pan`
// (one-line diffs) and mute/solo drive the SAME store flags the engine reads per-tick to gate audio
// (isEffectivelyMuted, Phase 14 Stream E). These four tiny formatters mirror MixerView's (kept local
// so MixerView stays untouched — it remains the full-strip overlay). ──────────────────────────────
const VOL_MIN = -60
const VOL_MAX = 6
function trackVolume(t: BeatTrack): number {
  return t.kind === 'instrument' && t.instrument ? t.instrument.volume : t.synth.volume
}
function trackPan(t: BeatTrack): number {
  return t.kind === 'instrument' && t.instrument ? t.instrument.pan : t.synth.pan
}
const fmtDb = (v: number) => (v <= VOL_MIN ? '-∞' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`)
const fmtPan = (v: number) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)

// Built-in sends (research 18: dotbeat's fixed reverb/delay/mod buses, not arbitrary return tracks).
// Shown as glanceable badges for the sends that are actually dialed in — the same "read the real
// synth-block field" approach MixerView's FxBadges uses. Instrument tracks carry a synth block the
// engine ignores for playback, so (like FxBadges) we don't show sends there.
const SEND_KEYS: { key: string; label: string }[] = [
  { key: 'sendReverb', label: 'Rv' },
  { key: 'sendDelay', label: 'Dl' },
  { key: 'sendMod', label: 'Md' },
]

/** The compact inline channel strip embedded in each arrangement track header. Subscribes to the
 * store's mute/solo flags (so it reflects and drives the real audio gate) and writes volume/pan via
 * the same edit path the full MixerView uses. */
function InlineStrip({ track }: { track: BeatTrack }) {
  const muted = useStore((s) => !!s.mutes[track.id])
  const soloed = useStore((s) => !!s.solos[track.id])
  const toggleMute = useStore((s) => s.toggleMute)
  const toggleSolo = useStore((s) => s.toggleSolo)

  const vol = trackVolume(track)
  const pan = trackPan(track)
  const sends = track.kind === 'instrument' ? [] : SEND_KEYS.filter((s) => Number(track.synth[s.key] ?? 0) > 0)

  return (
    <div className="arr-strip">
      <button
        className={`arr-strip-btn mute ${muted ? 'on' : ''}`}
        onClick={() => toggleMute(track.id)}
        title="mute (session-only, gates real audio)"
        data-mute={track.id}
      >
        M
      </button>
      <button
        className={`arr-strip-btn solo ${soloed ? 'on' : ''}`}
        onClick={() => toggleSolo(track.id)}
        title="solo (session-only, gates real audio)"
        data-solo={track.id}
      >
        S
      </button>
      <label className="arr-strip-vol" title={`volume ${fmtDb(vol)} dB`}>
        <input
          type="range"
          min={VOL_MIN}
          max={VOL_MAX}
          step={0.1}
          value={vol}
          data-vol={track.id}
          onChange={(e) => postEdit(`${track.id}.volume`, e.target.value)}
        />
        <span className="arr-strip-db">{fmtDb(vol)}</span>
      </label>
      <label className="arr-strip-pan" title={`pan ${fmtPan(pan)}`}>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={pan}
          data-pan={track.id}
          onChange={(e) => postEdit(`${track.id}.pan`, e.target.value)}
        />
        <span className="arr-strip-panval">{fmtPan(pan)}</span>
      </label>
      <span className="arr-strip-sends" title="active built-in sends (reverb / delay / mod)">
        {sends.map((s) => (
          <span key={s.key} className="arr-send-badge">
            {s.label}
          </span>
        ))}
      </span>
    </div>
  )
}

type FlatNote = { start: number; duration: number; pitch: number } // start/duration in 16th steps, absolute over the song
type FlatHit = { start: number; lane: DrumLane }
interface TrackFlat {
  track: BeatTrack
  notes: FlatNote[]
  hits: FlatHit[]
  pitchMin: number
  pitchMax: number
}
interface Section {
  scene: string
  bars: number
  startBar: number
}

/** Round a clip's content up to a whole number of bars (min one), so tiling a clip across a
 * longer section lands on bar boundaries — matches how the clip actually loops within a section. */
function clipStepLen(maxEnd: number): number {
  return Math.max(16, Math.ceil(maxEnd / 16) * 16)
}

/** Flatten one track's playable content across the whole song timeline into absolute-step events.
 * Song mode: each section's scene maps this track to a clip (or not — an unmapped track is silent
 * in that section); the clip's events tile across the section's bars. Loop mode (no song block):
 * the track's live notes/hits play across loop_bars as a single section. */
function flattenTrack(track: BeatTrack, sections: Section[], doc: BeatDocument): TrackFlat {
  const notes: FlatNote[] = []
  const hits: FlatHit[] = []

  for (const section of sections) {
    const sectionStartStep = section.startBar * 16
    const sectionSteps = section.bars * 16
    const sectionEndStep = sectionStartStep + sectionSteps

    // Resolve this section's content for this track.
    let srcNotes = track.notes
    let srcHits = track.hits
    if (doc.song) {
      const scene = doc.scenes.find((s) => s.id === section.scene)
      const clipId = scene?.slots[track.id]
      if (!clipId) continue // track not in this scene → silent this section
      const clip = track.clips.find((c) => c.id === clipId)
      if (!clip) continue
      srcNotes = clip.notes
      srcHits = clip.hits
    }

    if (track.kind === 'drums') {
      const maxEnd = srcHits.reduce((m, h) => Math.max(m, h.start + 1), 0)
      const len = clipStepLen(maxEnd)
      for (let off = 0; off < sectionSteps; off += len) {
        for (const h of srcHits) {
          const abs = sectionStartStep + off + h.start
          if (abs >= sectionEndStep) continue
          hits.push({ start: abs, lane: h.lane })
        }
      }
    } else {
      const maxEnd = srcNotes.reduce((m, n) => Math.max(m, n.start + n.duration), 0)
      const len = clipStepLen(maxEnd)
      for (let off = 0; off < sectionSteps; off += len) {
        for (const n of srcNotes) {
          const abs = sectionStartStep + off + n.start
          if (abs >= sectionEndStep) continue
          notes.push({ start: abs, duration: n.duration, pitch: n.pitch })
        }
      }
    }
  }

  let pitchMin = Infinity
  let pitchMax = -Infinity
  for (const n of notes) {
    if (n.pitch < pitchMin) pitchMin = n.pitch
    if (n.pitch > pitchMax) pitchMax = n.pitch
  }
  if (!Number.isFinite(pitchMin)) {
    pitchMin = 48
    pitchMax = 72
  }
  if (pitchMin === pitchMax) {
    pitchMin -= 6
    pitchMax += 6
  }
  return { track, notes, hits, pitchMin, pitchMax }
}

type Band = { start: number; end: number } | null

/** One track row: a fixed header + a canvas note/density renderer. Its own canvas, redrawn when
 * its data, the viewport width, the LOD mode, or its selection band changes. */
function TrackRow({
  flat,
  totalBars,
  pxPerBar,
  detail,
  sections,
  band,
  selected,
  onHeaderClick,
  onRowPointerDown,
}: {
  flat: TrackFlat
  totalBars: number
  pxPerBar: number
  detail: boolean
  sections: Section[]
  band: Band
  selected: boolean
  onHeaderClick: () => void
  onRowPointerDown: (e: React.PointerEvent) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { track } = flat
  // Dim the whole row when the track is effectively silenced (explicitly muted, or another track is
  // soloed) — the same signal the engine's real audio gate reads (Phase 14 Stream E).
  const dimmed = useStore((s) => isEffectivelyMuted(s, track.id))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const wCss = Math.max(1, totalBars * pxPerBar)
    canvas.width = Math.round(wCss * dpr)
    canvas.height = Math.round(ROW_H * dpr)
    canvas.style.width = `${wCss}px`
    canvas.style.height = `${ROW_H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, wCss, ROW_H)

    // Row backdrop + section dividers.
    ctx.fillStyle = 'rgba(255,255,255,0.015)'
    ctx.fillRect(0, 0, wCss, ROW_H)
    ctx.strokeStyle = 'rgba(255,255,255,0.09)'
    ctx.lineWidth = 1
    for (const s of sections) {
      const x = Math.round(s.startBar * pxPerBar) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, ROW_H)
      ctx.stroke()
    }
    // Faint per-bar gridlines when detailed enough to be legible.
    if (pxPerBar >= DETAIL_PX_PER_BAR) {
      ctx.strokeStyle = 'rgba(255,255,255,0.035)'
      for (let b = 1; b < totalBars; b++) {
        const x = Math.round(b * pxPerBar) + 0.5
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, ROW_H)
        ctx.stroke()
      }
    }

    if (detail) {
      if (track.kind === 'drums') {
        // Five stacked lane rows; a hit is a tick at its lane.
        const laneH = ROW_H / DRUM_LANES.length
        ctx.fillStyle = track.color
        for (const h of flat.hits) {
          const li = DRUM_LANES.indexOf(h.lane)
          const x = (h.start / 16) * pxPerBar
          const y = li * laneH + 2
          ctx.fillRect(x, y, Math.max(2, pxPerBar / 16), laneH - 3)
        }
      } else {
        // Synth notes positioned by pitch within the row, width by duration.
        const range = flat.pitchMax - flat.pitchMin
        ctx.fillStyle = track.color
        for (const n of flat.notes) {
          const x = (n.start / 16) * pxPerBar
          const w = Math.max(2, (n.duration / 16) * pxPerBar)
          const norm = (n.pitch - flat.pitchMin) / range
          const y = (1 - norm) * (ROW_H - 6) + 2
          ctx.fillRect(x, y, w, 3)
        }
      }
    } else {
      // Density LOD: one opacity-encoded block per bar, opacity ∝ event count in that bar.
      const counts = new Array<number>(totalBars).fill(0)
      const events = track.kind === 'drums' ? flat.hits.map((h) => h.start) : flat.notes.map((n) => n.start)
      for (const st of events) {
        const bar = Math.floor(st / 16)
        if (bar >= 0 && bar < totalBars) counts[bar]++
      }
      for (let b = 0; b < totalBars; b++) {
        if (counts[b] === 0) continue
        const alpha = Math.min(1, counts[b] / DENSITY_REF)
        ctx.globalAlpha = 0.15 + alpha * 0.85
        ctx.fillStyle = track.color
        ctx.fillRect(Math.round(b * pxPerBar) + 1, 6, Math.max(1, pxPerBar - 2), ROW_H - 12)
      }
      ctx.globalAlpha = 1
    }

    // Selection band overlay for this row.
    if (band) {
      const x0 = band.start * pxPerBar
      const x1 = band.end * pxPerBar
      ctx.fillStyle = 'rgba(224,161,60,0.22)'
      ctx.fillRect(x0, 0, x1 - x0, ROW_H)
      ctx.strokeStyle = 'rgba(224,161,60,0.8)'
      ctx.beginPath()
      ctx.moveTo(x0 + 0.5, 0)
      ctx.lineTo(x0 + 0.5, ROW_H)
      ctx.moveTo(x1 - 0.5, 0)
      ctx.lineTo(x1 - 0.5, ROW_H)
      ctx.stroke()
    }
  }, [flat, totalBars, pxPerBar, detail, sections, band, track])

  return (
    <div className={`arr-row ${dimmed ? 'dimmed' : ''}`} style={{ height: ROW_H }}>
      <div className={`arr-track-header ${selected ? 'selected' : ''}`} style={{ width: HEADER_W }}>
        <button className="arr-track-select" onClick={onHeaderClick} title={`select track ${track.name}`}>
          <span className="arr-track-swatch" style={{ background: track.color }} />
          <span className="arr-track-name">{track.name}</span>
          <span className={`arr-track-kind kind-${track.kind}`}>{track.kind[0]}</span>
        </button>
        <InlineStrip track={track} />
      </div>
      <div className="arr-lane" data-track={track.id} onPointerDown={onRowPointerDown} style={{ touchAction: 'none' }}>
        <canvas ref={canvasRef} className="arr-canvas" />
      </div>
    </div>
  )
}

export function ArrangementView() {
  const doc = useStore((s) => s.doc)
  const selection = useStore((s) => s.selection)
  const setSelectedTrack = useStore((s) => s.setSelectedTrack)
  const setBottomPaneOpen = useStore((s) => s.setBottomPaneOpen)
  // Playback position for the moving playhead. currentStep is the SAME grid-quantized song position
  // the step-sequencer/NoteView playheads already read (engine's Tone.getDraw() handoff, ported in
  // Phase 12 Stream 1) — reused here, not a second position-tracking mechanism. It ticks at most
  // 16x/bar, so it's allowed in reactive state (docs/research/15 §2); only the lightweight playhead
  // div re-renders on it — the memoized row canvases don't (their effect deps exclude currentStep).
  const currentStep = useStore((s) => s.currentStep)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [laneWidth, setLaneWidth] = useState(800)
  // Active drag band (bars), plus which axis is dragging (the ruler → all tracks, or a track id).
  const [drag, setDrag] = useState<{ axis: 'ruler' | string; start: number; cur: number } | null>(null)
  const dragRectLeft = useRef(0)
  // Active length-resize drag on a section's right-edge handle (Phase 19). `bars` is the live,
  // previewed length; it commits on pointer-up (loop_bars for loop mode, POST /song for song mode).
  const [resize, setResize] = useState<{ index: number; startBar: number; startBars: number; startX: number; bars: number } | null>(null)
  const resizePxPerBar = useRef(1)

  // Track the width available to the timeline lanes (total minus the fixed header column).
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setLaneWidth(Math.max(1, el.clientWidth - HEADER_W))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const sections: Section[] = useMemo(() => {
    if (!doc) return []
    if (doc.song && doc.song.length > 0) {
      let bar = 0
      return doc.song.map((s) => {
        const out = { scene: s.scene, bars: s.bars, startBar: bar }
        bar += s.bars
        return out
      })
    }
    // Loop mode: one implicit section over loop_bars.
    return [{ scene: '(loop)', bars: doc?.loopBars ?? 4, startBar: 0 }]
  }, [doc])

  const totalBars = useMemo(() => sections.reduce((n, s) => n + s.bars, 0), [sections])
  const pxPerBar = totalBars > 0 ? laneWidth / totalBars : 0
  const detail = pxPerBar >= DETAIL_PX_PER_BAR
  const songMode = !!doc?.song?.length

  const flats: TrackFlat[] = useMemo(() => {
    if (!doc) return []
    return doc.tracks.map((t) => flattenTrack(t, sections, doc))
  }, [doc, sections])

  const barFromClientX = useCallback(
    (clientX: number) => {
      const b = Math.floor((clientX - dragRectLeft.current) / pxPerBar)
      return Math.max(0, Math.min(totalBars - 1, b))
    },
    [pxPerBar, totalBars],
  )

  const beginDrag = useCallback(
    (axis: 'ruler' | string, e: React.PointerEvent) => {
      e.preventDefault()
      const laneEl = (e.currentTarget as HTMLElement).querySelector('.arr-canvas') ?? e.currentTarget
      dragRectLeft.current = (laneEl as HTMLElement).getBoundingClientRect().left
      const b = barFromClientX(e.clientX)
      setDrag({ axis, start: b, cur: b })
    },
    [barFromClientX],
  )

  // Start a length-resize drag from a section's right-edge handle. stopPropagation keeps the ruler's
  // own bar-range select from also firing; the actual length change is previewed live and committed
  // on pointer-up (see the effect below).
  const beginResize = useCallback(
    (index: number, startBar: number, startBars: number, e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      resizePxPerBar.current = pxPerBar || 1
      setResize({ index, startBar, startBars, startX: e.clientX, bars: startBars })
    },
    [pxPerBar],
  )

  // Window-level move/up for the resize handle: preview the new bar count while dragging, commit once
  // on release. Loop mode writes loop_bars (optimistic /edit); song mode resizes that section (/song).
  useEffect(() => {
    if (!resize) return
    const onMove = (e: PointerEvent) =>
      setResize((r) => {
        if (!r) return r
        const delta = (e.clientX - r.startX) / (resizePxPerBar.current || 1)
        return { ...r, bars: clampBars(r.startBars + delta) }
      })
    const onUp = () => {
      setResize((r) => {
        if (r && r.bars !== r.startBars) {
          if (songMode) void postSong({ op: 'resize', index: r.index, bars: r.bars })
          else changeLoopBars(r.bars)
        }
        return null
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [resize, songMode])

  // Window-level move/up so a drag that leaves the element still tracks and always commits.
  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => setDrag((d) => (d ? { ...d, cur: barFromClientX(e.clientX) } : d))
    const onUp = () => {
      setDrag((d) => {
        if (d) {
          const start = Math.min(d.start, d.cur)
          const end = Math.max(d.start, d.cur) + 1 // inclusive bar → exclusive end; selection needs start < end
          const bars = { start, end }
          postSelection(d.axis === 'ruler' ? { bars } : { tracks: [d.axis], bars })
        }
        return null
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, barFromClientX])

  const clickHeader = useCallback(
    (t: BeatTrack) => {
      setSelectedTrack(t.id)
      postEdit('selected_track', t.id)
      postSelection({ tracks: [t.id] })
      // Selecting a track (re)opens the bottom detail pane on it — Ableton's "selection drives the
      // bottom pane" idiom, and the way a collapsed pane comes back.
      setBottomPaneOpen(true)
    },
    [setSelectedTrack, setBottomPaneOpen],
  )

  if (!doc) return null

  // Resolve the band to show per axis: an in-progress drag wins; otherwise the committed selection.
  const dragBand: Band = drag ? { start: Math.min(drag.start, drag.cur), end: Math.max(drag.start, drag.cur) + 1 } : null
  const committedBand: Band = selection.bars ?? null
  const selTracks = selection.tracks
  function bandForTrack(id: string): Band {
    if (drag) return drag.axis === 'ruler' || drag.axis === id ? dragBand : null
    if (!committedBand) return null
    return !selTracks || selTracks.includes(id) ? committedBand : null
  }
  const rulerBand: Band = drag ? (drag.axis === 'ruler' ? dragBand : null) : committedBand

  const modeLabel = detail ? 'detail view' : `density view (${pxPerBar.toFixed(1)}px/bar)`

  // Playhead x in scroll-content coordinates: header column + fractional bar position. Step-precise
  // (finer than the requested bar granularity, at no extra cost). Shown only while the transport is
  // running and the position is within the song. It scrolls horizontally with the lanes (absolutely
  // positioned inside the scroll container) and spans just the track rows, below the sticky ruler.
  const totalSteps = totalBars * 16
  const showPlayhead = currentStep >= 0 && currentStep < totalSteps && pxPerBar > 0
  const playheadLeft = HEADER_W + (currentStep / 16) * pxPerBar

  return (
    <div className="arrangement">
      <div className="editor-toolbar">
        <span className="editor-title">arrangement</span>
        <span className="toolbar-tip">
          {totalBars} bars · {sections.length} section{sections.length === 1 ? '' : 's'} · {modeLabel} · drag the ruler or a track to select bars · click a track name to select it
        </span>
      </div>

      {/* Length controls (Phase 19). Loop mode: shrink/grow loop_bars, or split into sections. Song
          mode: per-section resize/delete + append (the section's right-edge handle in the ruler drags
          the same lengths). */}
      <div className="arr-length-bar">
        {songMode ? (
          <>
            <span className="arr-length-label">sections</span>
            {doc.song!.map((s, i) => (
              <span className="arr-section-chip" key={i}>
                <span className="arr-chip-name" title={`scene "${s.scene}"`}>{s.scene}</span>
                <button
                  className="arr-chip-btn"
                  data-section-minus={i}
                  title="one bar shorter"
                  disabled={s.bars <= LOOP_MIN}
                  onClick={() => postSong({ op: 'resize', index: i, bars: s.bars - 1 })}
                >
                  −
                </button>
                <span className="arr-chip-bars" data-section-bars={i}>{s.bars}</span>
                <button
                  className="arr-chip-btn"
                  data-section-plus={i}
                  title="one bar longer"
                  disabled={s.bars >= LOOP_MAX}
                  onClick={() => postSong({ op: 'resize', index: i, bars: s.bars + 1 })}
                >
                  +
                </button>
                <button
                  className="arr-chip-btn del"
                  data-section-delete={i}
                  title="delete section"
                  disabled={doc.song!.length <= 1}
                  onClick={() => postSong({ op: 'delete', index: i })}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              className="arr-add-section"
              data-add-section="1"
              title="append a section (duplicates the last section's content)"
              onClick={() => postSong({ op: 'append', bars: doc.song![doc.song!.length - 1]!.bars })}
            >
              + section
            </button>
          </>
        ) : (
          <>
            <span className="arr-length-label">loop length</span>
            <button
              className="arr-chip-btn"
              data-loop-minus="1"
              title="one bar shorter"
              disabled={doc.loopBars <= LOOP_MIN}
              onClick={() => changeLoopBars(doc.loopBars - 1)}
            >
              −
            </button>
            <span className="arr-chip-bars" data-loop-bars>{doc.loopBars} bars</span>
            <button
              className="arr-chip-btn"
              data-loop-plus="1"
              title="one bar longer"
              disabled={doc.loopBars >= LOOP_MAX}
              onClick={() => changeLoopBars(doc.loopBars + 1)}
            >
              +
            </button>
            <button
              className="arr-add-section"
              data-add-section="1"
              title="split into arrangement sections (keeps this loop as the first section)"
              onClick={() => postSong({ op: 'append', bars: doc.loopBars })}
            >
              + section
            </button>
          </>
        )}
      </div>

      <div className="arr-scroll" ref={scrollRef}>
        {/* Ruler: section labels + boundaries; dragging it selects a bar range across all tracks. */}
        <div className="arr-ruler-row" style={{ height: RULER_H }}>
          <div className="arr-ruler-corner" style={{ width: HEADER_W }} />
          <div
            className="arr-ruler"
            style={{ width: totalBars * pxPerBar, touchAction: 'none' }}
            onPointerDown={(e) => beginDrag('ruler', e)}
          >
            {sections.map((s, i) => (
              <div
                key={i}
                className="arr-section-label"
                style={{ left: s.startBar * pxPerBar, width: s.bars * pxPerBar }}
                title={`${s.scene} · ${s.bars} bars`}
              >
                <span className="arr-section-name">{s.scene}</span>
                <span className="arr-section-bars">{s.bars}</span>
              </div>
            ))}
            {rulerBand && (
              <div
                className="arr-ruler-band"
                style={{ left: rulerBand.start * pxPerBar, width: (rulerBand.end - rulerBand.start) * pxPerBar }}
              />
            )}
            {/* A resize handle occupying the last few px of each section (just inside its right
                boundary) — drag to change its bar count (loop_bars in loop mode). Positioned inside
                the boundary, not centered on it, so the rightmost section's handle stays clickable at
                the timeline's fit-to-width right edge. Sits above the ruler's own bar-select drag; its
                pointerdown stops propagation so a resize never also starts a selection. */}
            {sections.map((s, i) => (
              <div
                key={`resize-${i}`}
                className="arr-section-resize"
                data-section-resize={i}
                style={{ left: Math.max(0, (s.startBar + s.bars) * pxPerBar - 6) }}
                title={`drag to resize (${s.bars} bars)`}
                onPointerDown={(e) => beginResize(i, s.startBar, s.bars, e)}
              />
            ))}
            {resize && (
              <div className="arr-resize-guide" style={{ left: (resize.startBar + resize.bars) * pxPerBar }}>
                <span className="arr-resize-label">{resize.bars} bars</span>
              </div>
            )}
          </div>
        </div>

        {flats.map((flat) => (
          <TrackRow
            key={flat.track.id}
            flat={flat}
            totalBars={totalBars}
            pxPerBar={pxPerBar}
            detail={detail}
            sections={sections}
            band={bandForTrack(flat.track.id)}
            selected={!!selTracks && selTracks.includes(flat.track.id)}
            onHeaderClick={() => clickHeader(flat.track)}
            onRowPointerDown={(e) => beginDrag(flat.track.id, e)}
          />
        ))}

        {showPlayhead && (
          <div
            className="arr-playhead"
            style={{ left: playheadLeft, top: RULER_H, height: flats.length * ROW_H }}
          />
        )}
      </div>
    </div>
  )
}
