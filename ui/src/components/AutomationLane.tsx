import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { postAutomation } from '../daemon/bridge'
import { type AutomationInterpolation, type BeatAutomationPoint, type BeatTrack, type TrackKind } from '../types'
import { PARAM_GROUPS, type ParamSpec } from './synthParams'

// The GUI's whole automation surface, extracted verbatim out of ArrangementView.tsx (Phase 41
// Stream C) — the picker, the sub-lane curve canvas, and every gesture that writes a breakpoint.
// It had grown to ~530 lines inside a 3340-line file whose other 2800 lines are about clips,
// sections, groups and track rows; automation shares nothing with them but `HEADER_W` (now the
// `headerWidth` prop below) and the occurrence list (now the structural `LaneOccurrence` type).
// ArrangementView imports what it needs back — AUTO_H/PICKER_H for its own row-height math and
// autoOptionsFor for "can this track be automated at all". Nothing about the extraction changed
// behavior; the features layered on top of it afterwards are noted at their own call sites.

// ── Automation lanes (Phase 20 Stream Z) ─────────────────────────────────────────────────────────
// Per-track parameter picker + inline draggable breakpoint curve, over dotbeat's v0.9 clip
// automation (BeatAutomationLane). Automation is CLIP-SCOPED and only plays in song mode (the engine
// returns an empty automation map in loop mode — ui/src/audio/engine.ts contentFor), so the picker
// is only offered when a track's clip actually plays in a scene. Each shown param renders as its own
// dedicated sub-lane below the track row — research 18 §7's "move an envelope into its own dedicated
// lane below the clip … a track can show many parameter lanes stacked at once", the multi-lane
// presentation that fits the +/- picker (the same-row red-line overlay is the single-lane alternate,
// deferred). Curve drags redraw the canvas imperatively and POST only on pointer-up (research 15 §2:
// no React state / no network per pointer move); the write goes through the daemon's /automate route
// wrapping the SAME core setAutomationPoint/removeAutomationPoint `beat automate` uses.
export const AUTO_H = 46 // height of one automation sub-lane
const AUTO_PAD = 6 // vertical inset for the curve inside a sub-lane
export const PICKER_H = 30 // height of the expanded add-a-lane strip
const MARKER_HIT = 8 // px radius to grab a breakpoint
const SEGMENT_HIT = 6 // px distance to grab a segment (Phase 26 Stream DI: alt/option-drag-to-bow)

/** Every knob param, keyed — the value ranges (min/max) that map a raw automation value to the
 * sub-lane's y-axis. Reuses synthParams.ts's declarative table (the same one SynthPanel renders),
 * so a param's automation y-range always matches its knob range. Knob params are exactly the
 * numeric fields, i.e. the automatable set (AUTOMATABLE_SYNTH_PARAMS excludes only enums/bools). */
const SPEC_BY_KEY: Map<string, ParamSpec> = new Map()
for (const g of PARAM_GROUPS) for (const p of g.params) if (p.kind === 'knob') SPEC_BY_KEY.set(p.key, p)

/** The automatable params offered for a track kind, in synthParams group order. Phase 22 Stream
 * AE: 'audio' tracks aren't in synthParams.ts's PARAM_GROUPS table at all (they carry no synth
 * block) — their one automatable param is the clip's own 'gain' (AUDIO_AUTOMATABLE_PARAMS in
 * document.ts), so it's listed directly rather than derived from the loop below. */
const AUTO_OPTIONS_BY_KIND: Record<TrackKind, { key: string; label: string }[]> = {
  synth: [],
  drums: [],
  instrument: [],
  audio: [{ key: 'gain', label: 'Clip Gain' }],
  surge: [],
}
for (const g of PARAM_GROUPS) {
  for (const kind of g.kinds) {
    for (const p of g.params) {
      if (p.kind === 'knob' && !AUTO_OPTIONS_BY_KIND[kind].some((o) => o.key === p.key)) {
        AUTO_OPTIONS_BY_KIND[kind].push({ key: p.key, label: p.label })
      }
    }
  }
}
// A surge track carries a FULL synth block alongside its `surge` block — document.ts:961, "present
// iff kind === 'surge' (the synth block is ALSO present, as production)". That block is the
// surgeplus hosting layer's production stage (filter/env/effects/sends applied to the sidecar's
// rendered audio), so every param automatable on a synth track is automatable here too. It can't
// come from the loop above: synthParams.ts's ParamGroup.kinds is its own narrower 3-kind TrackKind
// ('synth'|'drums'|'instrument') and no group declares 'surge'. Mirroring synth's list is the
// honest answer — not `[]`, which would silently deny surge tracks automation they support.
AUTO_OPTIONS_BY_KIND.surge = AUTO_OPTIONS_BY_KIND.synth.map((o) => ({ ...o }))

/** Every read of AUTO_OPTIONS_BY_KIND goes through here. `track.kind` is whatever the daemon's
 * JSON says — core's TrackKind, not necessarily this file's — so a kind added to core before the
 * GUI mirrors it (research 137 §2.3: exactly what 'surge' did) must degrade to "no automatable
 * params" rather than throwing a TypeError that takes the whole arrangement render down. The
 * parity test makes the mirror drift loud; this keeps the failure mode soft in the meantime. */
export function autoOptionsFor(kind: string): { key: string; label: string }[] {
  return AUTO_OPTIONS_BY_KIND[kind as TrackKind] ?? []
}

// Phase 22 Stream AE: 'gain' isn't a synth field (it's not in PARAM_GROUPS/SPEC_BY_KEY at all —
// it only exists on audio-track clips, AUDIO_AUTOMATABLE_PARAMS in document.ts), so it needs its
// own range here rather than falling through to the generic 0..1 default — a clip gain automation
// point is a dB value, same shape as the synth volume field's range.
function specFor(param: string): ParamSpec {
  if (param === 'gain') return { key: 'gain', label: 'Clip Gain', kind: 'knob', min: -60, max: 6, format: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}` }
  return SPEC_BY_KEY.get(param) ?? { key: param, label: param, kind: 'knob', min: 0, max: 1, format: (v: number) => v.toFixed(2) }
}
function laneLabel(track: BeatTrack, param: string): string {
  const spec = specFor(param)
  if (param === 'volume') return 'Track Vol'
  if (param === 'pan') return 'Track Pan'
  if (param === 'gain') return 'Clip Gain'
  return `${track.name} / ${spec.label}`
}

const NO_POINTS: BeatAutomationPoint[] = []

/** The only three fields of ArrangementView's `ClipOccurrence` a lane actually reads: which clip
 * this block plays, and the block's absolute song-timeline extent in 16th steps. Declared
 * structurally here rather than imported so this module has no dependency (not even a type one)
 * back on ArrangementView — a `ClipOccurrence[]` satisfies it by ordinary structural assignment. */
export interface LaneOccurrence {
  clipId: string
  startStep: number
  lengthSteps: number
}

/** One automation sub-lane: the draggable breakpoint curve for (track, clipId, param), drawn across
 * every section occurrence that plays that clip (tiled every loopSteps, matching engine playback).
 * Canvas-rendered; a drag redraws imperatively and commits once on pointer-up (research 15 §2). */
export function AutomationLane({
  track,
  clipId,
  param,
  occurrences,
  totalBars,
  pxPerBar,
  loopSteps,
  headerWidth,
  onRemoveLane,
}: {
  track: BeatTrack
  clipId: string
  param: string
  occurrences: LaneOccurrence[]
  totalBars: number
  pxPerBar: number
  loopSteps: number
  /** ArrangementView's own track-header column width — the lane's head must line up with it. A
   * prop, not an import, so this module stays independent of the arrangement's layout constants. */
  headerWidth: number
  onRemoveLane: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spec = specFor(param)
  const min = spec.min ?? 0
  const max = spec.max ?? 1
  const fmt = spec.format ?? ((v: number) => v.toFixed(2))
  // Subscribe to just this lane's points. `find` returns the store's own array reference (stable
  // across unrelated state changes), so Object.is equality keeps this from re-rendering per tick.
  const points = useStore(
    useCallback(
      (s) => s.doc?.tracks.find((t) => t.id === track.id)?.clips.find((c) => c.id === clipId)?.automation.find((l) => l.param === param)?.points ?? NO_POINTS,
      [track.id, clipId, param],
    ),
  )
  const markersRef = useRef<{ x: number; y: number; id: string }[]>([])
  // Phase 26 Stream DI: every rendered segment this draw pass, in CANVAS-LOCAL pixel coords (one
  // entry per tile occurrence a segment is drawn in, since a looped lane repeats the same segment
  // at multiple x offsets) — lets pointer gestures hit-test "near a line between two points," not
  // just "on a point," for the alt/option-drag-to-bow gesture below.
  const segmentsRef = useRef<{ ax: number; ay: number; bx: number; by: number; aId: string; bId: string }[]>([])
  type DragState =
    | { mode: 'move'; id: string; time: number; value: number }
    | { mode: 'new'; time: number; value: number }
    | { mode: 'bow'; aId: string; bId: string; midY: number; dy: number }
  const dragRef = useRef<DragState | null>(null)
  const dragLabelRef = useRef<HTMLDivElement>(null)
  const [popup, setPopup] = useState<{ id: string; x: number; y: number; time: number; value: number; interpolation: AutomationInterpolation } | null>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // Phase 29 Stream GE item 3 (docs/research/81 §"one more rough edge on that popup"): the popup
  // used to close only via Escape (and only while the numeric <input> itself had keyboard focus) or
  // a further click inside this SAME automation lane — clicking anywhere else on the page (another
  // panel, the topbar, a different lane) left it sitting open indefinitely. Standard outside-click
  // (+ Escape from anywhere, not just the focused input) dismissal, scoped to while a popup is open.
  useEffect(() => {
    if (!popup) return
    const onPointerDownOutside = (e: PointerEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setPopup(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopup(null)
    }
    document.addEventListener('pointerdown', onPointerDownOutside)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDownOutside)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [popup])

  const valueToY = useCallback((v: number) => {
    const norm = Math.max(0, Math.min(1, (v - min) / (max - min || 1)))
    return AUTO_PAD + (1 - norm) * (AUTO_H - 2 * AUTO_PAD)
  }, [min, max])
  const yToValue = useCallback((y: number) => {
    const norm = Math.max(0, Math.min(1, 1 - (y - AUTO_PAD) / (AUTO_H - 2 * AUTO_PAD)))
    return min + norm * (max - min)
  }, [min, max])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const wCss = Math.max(1, totalBars * pxPerBar)
    canvas.width = Math.round(wCss * dpr)
    canvas.height = Math.round(AUTO_H * dpr)
    canvas.style.width = `${wCss}px`
    canvas.style.height = `${AUTO_H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, wCss, AUTO_H)
    // Phase 29 Stream GF item 6: a freshly-added, empty lane used to render as two ~6%-opacity
    // rail lines on the dark background fill — no baseline, no current-value marker, nothing that
    // read as "click here to add a point" (pilot 81). Raised the fill/rail opacity and, for the
    // genuinely-empty case, added a dashed center baseline plus small "click to automate" text —
    // a real visual invitation instead of a near-blank rectangle. Once the lane has real points the
    // baseline/label are skipped entirely (the curve itself is the content, same as before).
    ctx.fillStyle = 'rgba(255,255,255,0.035)'
    ctx.fillRect(0, 0, wCss, AUTO_H)
    // top / bottom rails
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1
    for (const yy of [AUTO_PAD, AUTO_H - AUTO_PAD]) {
      ctx.beginPath()
      ctx.moveTo(0, yy + 0.5)
      ctx.lineTo(wCss, yy + 0.5)
      ctx.stroke()
    }
    if (points.length === 0) {
      const midY = AUTO_H / 2
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(0, midY + 0.5)
      ctx.lineTo(wCss, midY + 0.5)
      ctx.stroke()
      ctx.setLineDash([])
      if (wCss > 90) {
        ctx.fillStyle = 'rgba(255,255,255,0.32)'
        ctx.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'
        ctx.textBaseline = 'middle'
        ctx.fillText('click to add a point', 8, midY)
      }
      ctx.restore()
    }

    // Effective points = committed points with the active drag applied (move overrides one id; new
    // adds a provisional point). Sorted by time — the canonical curve order.
    const drag = dragRef.current
    let eff = points.map((p) => ({ ...p }))
    if (drag?.mode === 'move') eff = eff.map((p) => (p.id === drag.id ? { ...p, time: drag.time, value: drag.value } : p))
    if (drag?.mode === 'new') eff = [...eff, { id: '__draft__', time: drag.time, value: drag.value }]
    eff.sort((a, b) => a.time - b.time)
    const draggedId = drag?.mode === 'move' ? drag.id : undefined
    const bow = drag?.mode === 'bow' ? drag : null

    const markers: { x: number; y: number; id: string }[] = []
    const segments: { ax: number; ay: number; bx: number; by: number; aId: string; bId: string }[] = []
    ctx.strokeStyle = track.color
    ctx.lineWidth = 1.5
    for (const occ of occurrences) {
      // v0.11 (Phase 36 PD): tile from the occurrence's own block extent (startStep/lengthSteps) —
      // for an audio placement the curve rides the placement's real start (placement-relative gain
      // automation, matching the engine's own lookup), not the section boundary; for non-audio
      // occurrences startStep/lengthSteps ARE the section bounds, so nothing changes there.
      for (let off = 0; off < occ.lengthSteps; off += loopSteps) {
        const tileStartStep = occ.startStep + off
        const tileEndStep = Math.min(occ.startStep + occ.lengthSteps, tileStartStep + loopSteps)
        const xAt = (localStep: number) => ((tileStartStep + localStep) / 16) * pxPerBar
        if (eff.length === 0) continue
        ctx.beginPath()
        // hold the first value from the tile start
        ctx.moveTo((tileStartStep / 16) * pxPerBar, valueToY(eff[0]!.value))
        ctx.lineTo(xAt(eff[0]!.time), valueToY(eff[0]!.value))
        // Phase 26 Stream DI: each segment renders per the shape its START point carries —
        // 'hold' steps (a horizontal run, then a vertical jump right at the next point's time),
        // 'curve' eases via curveEase-equivalent sampling (kept in visual sync with the engine's
        // own curveEase in ui/src/audio/engine.ts — see that file's comment), anything else (incl.
        // an in-progress bow-drag on THIS exact segment, which gets a live bezier-toward-the-
        // pointer preview instead) draws a straight line, same as before this stream.
        for (let i = 0; i < eff.length - 1; i++) {
          const a = eff[i]!
          const b = eff[i + 1]!
          const ax = xAt(a.time)
          const ay = valueToY(a.value)
          const bx = xAt(b.time)
          const by = valueToY(b.value)
          segments.push({ ax, ay, bx, by, aId: a.id, bId: b.id })
          if (bow && a.id === bow.aId && b.id === bow.bId) {
            const mx = (ax + bx) / 2
            const my = (ay + by) / 2 + bow.dy
            ctx.quadraticCurveTo(mx, my, bx, by)
          } else if (a.interpolation === 'hold') {
            ctx.lineTo(bx, ay)
            ctx.lineTo(bx, by)
          } else if (a.interpolation === 'curve') {
            const STEPS = 16
            for (let s = 1; s <= STEPS; s++) {
              const t = s / STEPS
              const shaped = t * t // quadratic ease-in — mirrors engine.ts's curveEase exactly
              ctx.lineTo(ax + (bx - ax) * t, valueToY(a.value + (b.value - a.value) * shaped))
            }
          } else {
            ctx.lineTo(bx, by)
          }
        }
        // hold the last value to the tile end
        ctx.lineTo((tileEndStep / 16) * pxPerBar, valueToY(eff[eff.length - 1]!.value))
        ctx.stroke()
        // markers (skip the provisional draft — it isn't grabbable until committed)
        for (const p of eff) {
          const x = xAt(p.time)
          const y = valueToY(p.value)
          ctx.beginPath()
          ctx.arc(x, y, 3.2, 0, Math.PI * 2)
          ctx.fillStyle = p.id === draggedId ? '#fff' : track.color
          ctx.fill()
          ctx.lineWidth = 1
          ctx.strokeStyle = 'rgba(0,0,0,0.6)'
          ctx.stroke()
          ctx.strokeStyle = track.color
          ctx.lineWidth = 1.5
          if (p.id !== '__draft__') markers.push({ x, y, id: p.id })
          // 'hold' points get a small flat cap so the step is recognizable even without hovering
          if (p.interpolation === 'hold') {
            ctx.fillStyle = 'rgba(0,0,0,0.65)'
            ctx.fillRect(x - 1, y - 1, 2, 2)
          }
        }
      }
    }
    markersRef.current = markers
    segmentsRef.current = segments
  }, [points, totalBars, pxPerBar, occurrences, loopSteps, track.color, valueToY])

  useEffect(() => {
    draw()
  }, [draw])

  // Map a canvas-local x to the clip-local time of the occurrence it falls in (points are stored in
  // clip-local 16th steps; the tile the pointer is over sets the reference frame). Returns null when
  // x is outside every occurrence.
  const clipTimeFromX = useCallback(
    (localX: number): { time: number; occ: LaneOccurrence } | null => {
      const absStep = (localX / pxPerBar) * 16
      let occ = occurrences.find((o) => absStep >= o.startStep && absStep < o.startStep + o.lengthSteps)
      if (!occ) occ = occurrences[0]
      if (!occ) return null
      let t = ((absStep - occ.startStep) % loopSteps + loopSteps) % loopSteps
      t = Math.max(0, Math.min(loopSteps, Number(t.toFixed(2))))
      return { time: t, occ }
    },
    [occurrences, pxPerBar, loopSteps],
  )

  // Phase 26 Stream DI: point-to-segment distance hit-test, using the segments draw() just laid
  // out (canvas-local coords, one entry per rendered tile occurrence — see segmentsRef above).
  // Feeds the alt/option-drag-to-bow gesture: "near (not on) a line between two breakpoints."
  const hitTestSegment = useCallback((localX: number, localY: number) => {
    let bestD = SEGMENT_HIT * SEGMENT_HIT
    let best: { ax: number; ay: number; bx: number; by: number; aId: string; bId: string } | null = null
    for (const s of segmentsRef.current) {
      const dx = s.bx - s.ax
      const dy = s.by - s.ay
      const len2 = dx * dx + dy * dy || 1
      let t = ((localX - s.ax) * dx + (localY - s.ay) * dy) / len2
      t = Math.max(0, Math.min(1, t))
      const px = s.ax + t * dx
      const py = s.ay + t * dy
      const d = (px - localX) ** 2 + (py - localY) ** 2
      if (d <= bestD) {
        bestD = d
        best = s
      }
    }
    return best
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 2) return // right-click is handled entirely by onContextMenu below
      setPopup(null)
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const localX = e.clientX - rect.left
      const localY = e.clientY - rect.top
      // hit-test existing markers
      let hit: string | null = null
      let best = MARKER_HIT * MARKER_HIT
      for (const m of markersRef.current) {
        const d = (m.x - localX) ** 2 + (m.y - localY) ** 2
        if (d <= best) {
          best = d
          hit = m.id
        }
      }
      // alt-click deletes a breakpoint
      if (hit && e.altKey) {
        postAutomation({ op: 'remove', track: track.id, clip: clipId, param, id: hit })
        return
      }
      // Phase 26 Stream DI: alt/option-drag on a SEGMENT (not a point) bows it into a curve —
      // live preview is a quadratic bezier toward the drag point; on release this commits
      // `interpolation: 'curve'` on the segment's start point (the persisted format is a flag, not
      // a bow amount — see AutomationInterpolation's doc comment in document.ts — so the engine and
      // the settled render both use a fixed ease, curveEase, once the drag ends).
      if (e.altKey && !hit) {
        const seg = hitTestSegment(localX, localY)
        if (seg) {
          e.preventDefault()
          const midY = (seg.ay + seg.by) / 2
          dragRef.current = { mode: 'bow', aId: seg.aId, bId: seg.bId, midY, dy: 0 }
          draw()
          const onMove = (ev: PointerEvent) => {
            const drag = dragRef.current
            if (!drag || drag.mode !== 'bow') return
            drag.dy = ev.clientY - rect.top - drag.midY
            draw()
          }
          const onUp = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            const drag = dragRef.current
            dragRef.current = null
            if (drag && drag.mode === 'bow') {
              const aPoint = points.find((p) => p.id === drag.aId)
              if (aPoint) postAutomation({ op: 'set', track: track.id, clip: clipId, param, id: aPoint.id, time: aPoint.time, value: aPoint.value, interpolation: 'curve' })
            }
            draw()
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
          return
        }
      }
      e.preventDefault()
      if (hit) {
        const p = points.find((pt) => pt.id === hit)!
        dragRef.current = { mode: 'move', id: hit, time: p.time, value: p.value }
      } else {
        const t = clipTimeFromX(localX)
        if (!t) return
        dragRef.current = { mode: 'new', time: t.time, value: yToValue(localY) }
      }
      draw()
      // Phase 26 Stream DI: surface the live drag value (already computed below, just never
      // rendered before this stream) as a small floating label near the cursor — an imperative DOM
      // write, not React state, matching draw()'s own no-React-per-move discipline (research 15 §2).
      const showLabel = (lx: number, ly: number, value: number) => {
        const label = dragLabelRef.current
        if (!label) return
        label.style.display = 'block'
        label.style.left = `${lx + 10}px`
        label.style.top = `${ly - 18}px`
        label.textContent = fmt(value)
      }
      const hideLabel = () => {
        const label = dragLabelRef.current
        if (label) label.style.display = 'none'
      }
      // (dragRef.current here is always 'move' | 'new' — the 'bow' branch above already returned.)
      const initial = dragRef.current
      if (initial) showLabel(localX, localY, initial.value)

      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current
        if (!drag || drag.mode === 'bow') return
        const lx = ev.clientX - rect.left
        const ly = ev.clientY - rect.top
        const t = clipTimeFromX(lx)
        if (t) drag.time = t.time
        drag.value = Number(yToValue(ly).toFixed(4))
        draw()
        showLabel(lx, ly, drag.value)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        hideLabel()
        const drag = dragRef.current
        dragRef.current = null
        if (!drag || drag.mode === 'bow') {
          draw()
          return
        }
        if (drag.mode === 'move') {
          postAutomation({ op: 'set', track: track.id, clip: clipId, param, id: drag.id, time: drag.time, value: drag.value })
        } else if (drag.mode === 'new') {
          postAutomation({ op: 'set', track: track.id, clip: clipId, param, time: drag.time, value: drag.value })
        }
        // leave the imperative draft on screen; the optimistic store update (postAutomation) triggers
        // the effect redraw from the real points on the next render.
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [points, clipTimeFromX, yToValue, draw, hitTestSegment, fmt, track.id, clipId, param],
  )

  // Phase 26 Stream DI: right-click a breakpoint -> a small popup with an exact numeric value
  // <input> AND a linear/hold/curve toggle for the segment it starts (both features "touch the
  // same component," research/65's recommendation to ship them together). Right-click empty space
  // just closes any open popup.
  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const localX = e.clientX - rect.left
      const localY = e.clientY - rect.top
      let hit: string | null = null
      let best = MARKER_HIT * MARKER_HIT
      for (const m of markersRef.current) {
        const d = (m.x - localX) ** 2 + (m.y - localY) ** 2
        if (d <= best) {
          best = d
          hit = m.id
        }
      }
      if (!hit) {
        setPopup(null)
        return
      }
      const p = points.find((pt) => pt.id === hit)
      if (!p) return
      setPopup({ id: p.id, x: localX, y: localY, time: p.time, value: p.value, interpolation: p.interpolation ?? 'linear' })
    },
    [points],
  )

  return (
    <div className="arr-auto-row" style={{ height: AUTO_H }}>
      <div className="arr-auto-head" style={{ width: headerWidth }}>
        <span className="arr-auto-label" title={laneLabel(track, param)}>
          {laneLabel(track, param)}
        </span>
        <span className="arr-auto-range" title={`${fmt(min)} … ${fmt(max)}`}>
          {fmt(max)}
        </span>
        <button className="arr-auto-remove" title="remove this automation lane" data-auto-remove={`${track.id}.${param}`} onClick={onRemoveLane}>
          ×
        </button>
      </div>
      <div
        className="arr-auto-lane"
        data-auto-track={track.id}
        data-auto-param={param}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        style={{ touchAction: 'none' }}
      >
        <canvas ref={canvasRef} className="arr-auto-canvas" />
        <div ref={dragLabelRef} className="arr-auto-drag-label" style={{ display: 'none' }} />
        {popup && (
          <div
            ref={popupRef}
            className="arr-auto-popup"
            style={{ left: popup.x, top: popup.y }}
            data-auto-popup={`${track.id}.${param}.${popup.id}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <input
              type="number"
              step="any"
              className="arr-auto-popup-input"
              defaultValue={popup.value}
              autoFocus
              data-auto-value-input={`${track.id}.${param}.${popup.id}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = Number((e.target as HTMLInputElement).value)
                  if (Number.isFinite(v)) postAutomation({ op: 'set', track: track.id, clip: clipId, param, id: popup.id, time: popup.time, value: v, interpolation: popup.interpolation })
                  setPopup(null)
                } else if (e.key === 'Escape') {
                  setPopup(null)
                }
              }}
            />
            <div className="arr-auto-popup-modes">
              {(['linear', 'hold', 'curve'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`arr-auto-popup-mode${popup.interpolation === m ? ' on' : ''}`}
                  data-auto-interp={`${track.id}.${param}.${popup.id}.${m}`}
                  onClick={() => {
                    postAutomation({ op: 'set', track: track.id, clip: clipId, param, id: popup.id, time: popup.time, value: popup.value, interpolation: m })
                    setPopup((prev) => (prev ? { ...prev, interpolation: m } : prev))
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** The expandable "add an automation lane" strip that drops below a track row when its automation
 * picker is open — a param <select> + add button, spanning the timeline width. */
export function AutomationPicker({
  track,
  available,
  headerWidth,
  onAdd,
}: {
  track: BeatTrack
  available: { key: string; label: string }[]
  headerWidth: number
  onAdd: (param: string) => void
}) {
  const [pick, setPick] = useState(available[0]?.key ?? '')
  // Phase 29 Stream GF item 7: `available` shrinks by exactly one entry every time a lane is
  // added (the just-picked param drops out, since it's now "visible"/already added) — the OLD
  // code recomputed `chosen` by falling back straight to `available[0]` whenever `pick` fell out
  // of the list, which is EVERY add, so the ~100-option dropdown snapped back to the top after
  // every single lane (pilot 84: "making multi-lane setup tedious"). Track the previous list and,
  // when `pick` disappears, land on whatever's now at roughly the same INDEX instead — keeps the
  // selection (and therefore the native <select>'s own scroll-into-view-on-open behavior) in the
  // same neighborhood the user was just browsing, rather than jumping to the top of the list.
  const prevAvailableRef = useRef(available)
  useEffect(() => {
    const prev = prevAvailableRef.current
    prevAvailableRef.current = available
    if (available.some((a) => a.key === pick)) return
    const prevIdx = prev.findIndex((a) => a.key === pick)
    const idx = prevIdx === -1 ? 0 : Math.min(prevIdx, available.length - 1)
    setPick(available[idx]?.key ?? '')
  }, [available, pick])
  return (
    <div className="arr-auto-picker" style={{ height: PICKER_H }}>
      <div className="arr-auto-picker-head" style={{ width: headerWidth }}>
        automation
      </div>
      <div className="arr-auto-picker-body">
        <select className="arr-auto-select" value={pick} data-auto-select={track.id} onChange={(e) => setPick(e.target.value)}>
          {available.map((a) => (
            <option key={a.key} value={a.key}>
              {laneLabel(track, a.key)}
            </option>
          ))}
        </select>
        <button className="arr-auto-add" data-auto-add={track.id} onClick={() => pick && onAdd(pick)} disabled={!pick}>
          + add lane
        </button>
      </div>
    </div>
  )
}
