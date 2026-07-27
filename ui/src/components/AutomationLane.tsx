import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { postAutomation } from '../daemon/bridge'
import { type AutomationInterpolation, type BeatAutomationPoint, type BeatTrack, type TrackKind } from '../types'
import { PARAM_GROUPS, type ParamSpec } from './synthParams'
// The GUI reaches straight into core for the two PURE, dependency-free automation helpers rather
// than re-deriving their geometry (CLAUDE.md: "the shared logic lives in ONE src/ helper both
// surfaces import"). ui/ normally hand-mirrors core's TYPES (see types.ts's header) because those
// arrive as JSON over the daemon and a mirror is guarded by a parity test — but these are
// algorithms, not shapes, and a second copy of a sine sampler or a Douglas-Peucker pass is exactly
// the drift CLAUDE.md's parity rule exists to forbid. Both modules import nothing at all, so
// nothing Node-only is dragged into the bundle; verified by `vite build` and `tsc -p ui`.
import { automationShapePoints, AUTOMATION_SHAPES, type AutomationShape } from '../../../src/core/automation-shape'
import { simplifyAutomationPoints } from '../../../src/core/automation-simplify'

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

// ── Draw Mode: paint a run of breakpoints (Phase 41 Stream C) ────────────────────────────────────
// Sample the pointer once per PAINT_QUANTUM of clip-local time while it sweeps, then reduce the
// result before committing. 1 = one 16th step: fine enough that a hand-drawn sweep reads as a
// curve rather than a staircase, and the reduction below is what stops that resolution from
// costing 64 file lines per gesture.
const PAINT_QUANTUM = 1
// Simplify tolerance as a fraction of the LANE'S HEIGHT — i.e. applied in normalized axis space,
// after valueToNorm, never in the param's raw units. It has to be normalized rather than a fraction
// of min..max because a log-axis param's raw units are not uniform across the lane: 1% of cutoff's
// 20..18000 range is 180 Hz, which is most of the bottom third of the axis and nothing at all at
// the top, so a painted arc came back with its lower half flattened and its upper half carrying
// every sample. Set just under one pixel: the drawable height is AUTO_H - 2*AUTO_PAD = 34px, so one
// pixel is 1/34 = 2.9% and 2% is ~0.68px — nothing anyone could see or aim at is discarded, while
// sub-pixel hand jitter and collinear runs are.
const PAINT_SIMPLIFY_FRACTION = 0.02
// Two points at the same clip-local time are not representable as a curve, so a run is keyed by
// quantized time; this is the slack used when matching EXISTING points against the painted span.
const RUN_SPAN_EPS = 1e-6

// ── Log-scale y-axis (Phase 41 Stream C) ─────────────────────────────────────────────────────────
// The params the ENGINE interpolates in log space, and therefore the params this lane must draw in
// log space. This is a mirror of one specific fact in ui/src/audio/engine.ts: `interpolateAutomation
// (points, step, log)` is called with log=true at exactly one call site, the cutoff branch
// ("cutoff only — frequency perception is logarithmic"); every other call passes false. Grep
// `interpolateAutomation(` there before adding to this set.
//
// The roadmap filed this as readability ("frequency-style params read better on a log axis than
// linear") and it is — a 20..4000 Hz sweep occupies the bottom 22% of a linear 20..18000 lane, which
// a pilot on the owner's own project made unmissable. But it is first a CORRECTNESS bug: on a
// linear axis the straight line the lane draws between two cutoff breakpoints is not the curve the
// engine plays between them, so the picture disagreed with the sound. On a log axis the engine's own
// `a * (b/a)^t` IS a straight line, so the drawing becomes exact.
const LOG_AXIS_PARAMS = new Set(['cutoff'])

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

/** Which lane a write targets — the (track, clip, param) tuple the daemon's /automate route takes. */
interface LaneTarget {
  track: string
  clip: string
  param: string
}

/** Commit a whole RUN of breakpoints — a painted sweep, or an inserted shape — as one gesture.
 *
 * The run REPLACES whatever the lane held inside the clip-local span it covers: existing points in
 * range are removed first, then the new ones are added id-less so the daemon mints p1, p2, … off
 * the now-shorter lane, exactly as core's own `applyAutomationShape` does. Ids are deliberately NOT
 * supplied: bridge.ts's optimistic mirror and core's addAutomationPoint mint by the identical
 * `p<max+1>` rule, so leaving it to the server keeps the two in step, whereas guessing an id that
 * the server thinks already exists is a hard error.
 *
 * Deliberately built on the existing per-point route rather than a new batched one. /automate lives
 * in src/daemon/daemon.ts, which this stream does not own, and a per-point loop is honest and
 * correct today — every write goes through the same core primitive `beat automate` uses, in order,
 * on bridge.ts's single serialized send queue. It is not free: N points cost N daemon round-trips
 * and, because /automate passes no `coalesceKey` to writeIfChanged, N separate undo entries, so one
 * painted sweep currently needs N Ctrl+Z to fully undo. That is the reason the run is simplified
 * before it gets here (~10-20 points for a 4-bar sweep instead of 64) and the reason a batched
 * `op:'run'` — one write, one undo entry — is filed as the follow-up for whoever owns the daemon. */
function writeRun(target: LaneTarget, existing: readonly BeatAutomationPoint[], run: readonly { time: number; value: number }[], span: { from: number; to: number }): void {
  const lo = Math.min(span.from, span.to) - RUN_SPAN_EPS
  const hi = Math.max(span.from, span.to) + RUN_SPAN_EPS
  for (const p of existing) {
    if (p.time >= lo && p.time <= hi) postAutomation({ op: 'remove', ...target, id: p.id })
  }
  for (const pt of run) postAutomation({ op: 'set', ...target, time: pt.time, value: pt.value })
}

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
    // Phase 41 Stream C: a paint sweep in progress. `pts` is clip-local quantized time -> value,
    // so re-crossing a time you already painted overwrites it (the natural "keep correcting the
    // stroke until you let go" behavior) instead of stacking two points at one instant.
    | { mode: 'paint'; pts: Map<number, number> }
    // Phase 41 Stream C: a whole SEGMENT being moved — its two flanking points travel together by
    // the same (dt, dv), so the segment keeps its slope and length while it slides.
    | { mode: 'segment'; aId: string; bId: string; dt: number; dv: number }
  const dragRef = useRef<DragState | null>(null)
  /** Previous paint sample position, so a fast sweep can be filled in rather than left as isolated
   * samples (see onPointerDown's paint branch). Null whenever no stroke is in progress. */
  const lastPaintRef = useRef<{ x: number; y: number } | null>(null)
  const dragLabelRef = useRef<HTMLDivElement>(null)
  // Phase 41 Stream C. research/65's roadmap row argued against Ableton's separate Draw Mode toggle
  // in favor of the per-note chance lane's plain-drag-paints gesture. That does not transfer: the
  // chance lane has no other meaning for a plain drag, while this lane's plain drag is already
  // bound to place-a-breakpoint-and-position-it — the single most important gesture here, which a
  // paint-by-default would destroy. The remaining options were an undiscoverable modifier or a
  // visible toggle, and a hidden modifier fails the only test that matters (someone opening the app
  // and trying to draw a filter sweep). So: a real toggle, per lane, session-only, sitting in the
  // lane header next to the controls it modifies, with the pointer changing to a crosshair-pencil
  // and the lane tinted while it is armed.
  const [drawMode, setDrawMode] = useState(false)

  // ── Segment selection (Phase 41 Stream C) ─────────────────────────────────────────────────────
  // research/65: "dotbeat has no concept of a segment as a selectable/draggable unit — only
  // individual points." Shift+pointerdown anywhere within SEGMENT_HIT of a segment selects the pair
  // of points that flank it and drags BOTH by the same delta, so the segment slides without
  // changing its own slope or length — which is the entire point of treating it as one object.
  //
  // Shift rather than the plain "click near, not on, a point" tier that row sketched: this lane's
  // plain click on empty space already means "add a breakpoint here", and a proximity tier would
  // make that gesture stop working within 6px of any existing curve — i.e. exactly where people
  // add points. Ableton offers Shift-click for the same reason and dotbeat has shift free here.
  const [selectedSegment, setSelectedSegment] = useState<{ aId: string; bId: string } | null>(null)

  // ── Predefined shapes (Phase 41 Stream C) ─────────────────────────────────────────────────────
  // `beat automate-shape` / `beat_automate_shape` have sampled these five shapes since Phase 37;
  // the GUI simply had no way to reach them, which is why the roadmap row stayed `gui: missing`
  // while a whole generator sat finished behind the CLI. The geometry is NOT re-implemented here:
  // automationShapePoints is imported from src/core and produces the byte-identical curve the CLI
  // writes, so a sine inserted from this panel and one inserted from the terminal are the same
  // points.
  const [shapePanel, setShapePanel] = useState(false)
  const [shape, setShape] = useState<AutomationShape>('sine')
  const [shapeCycles, setShapeCycles] = useState(1)
  const [shapePoints, setShapePoints] = useState(16)
  // A shape's default range is "from the bottom of this param up to where the patch already sits" —
  // a sweep that arrives at the sound the track currently makes, rather than at an arbitrary
  // extreme. Falls back to the param's own max when the track carries no usable static value
  // (audio-track `gain`, or a param absent from the synth block).
  const patchValue = (track.synth as unknown as Record<string, unknown> | undefined)?.[param]
  const defaultTo = typeof patchValue === 'number' && Number.isFinite(patchValue) && patchValue > min && patchValue <= max ? patchValue : max
  const [shapeFrom, setShapeFrom] = useState(min)
  const [shapeTo, setShapeTo] = useState(defaultTo)
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

  // A dragged segment must stay inside the lane it lives in: clip-local time within one tiling
  // period (points past it would never be drawn or played), value within the param's own range.
  // Shared by the live preview and the committed write so they cannot disagree.
  const clampTime = useCallback((t: number) => Number(Math.max(0, Math.min(loopSteps, t)).toFixed(2)), [loopSteps])
  const clampValue = useCallback((v: number) => Number(Math.max(min, Math.min(max, v)).toFixed(4)), [min, max])

  // A selection is a pair of point IDS, so it outlives ordinary redraws but not the points
  // themselves — alt-deleting an endpoint, or a shape insert replacing the lane, must not leave a
  // highlight pointing at breakpoints that no longer exist.
  useEffect(() => {
    if (!selectedSegment) return
    if (!points.some((p) => p.id === selectedSegment.aId) || !points.some((p) => p.id === selectedSegment.bId)) setSelectedSegment(null)
  }, [points, selectedSegment])

  // Log axis only where the ENGINE is also logarithmic (LOG_AXIS_PARAMS above) AND the range is
  // strictly positive — ln(0) has no answer, so a param whose min is 0 or negative silently stays
  // linear rather than producing NaN pixels.
  const logAxis = LOG_AXIS_PARAMS.has(param) && min > 0 && max > min
  const valueToNorm = useCallback(
    (v: number) => (logAxis ? (Math.log(Math.max(min, Math.min(max, v))) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (v - min) / (max - min || 1)),
    [logAxis, min, max],
  )
  const normToValue = useCallback((n: number) => (logAxis ? min * Math.pow(max / min, n) : min + n * (max - min)), [logAxis, min, max])

  const valueToY = useCallback((v: number) => {
    const norm = Math.max(0, Math.min(1, valueToNorm(v)))
    return AUTO_PAD + (1 - norm) * (AUTO_H - 2 * AUTO_PAD)
  }, [valueToNorm])
  const yToValue = useCallback((y: number) => {
    const norm = Math.max(0, Math.min(1, 1 - (y - AUTO_PAD) / (AUTO_H - 2 * AUTO_PAD)))
    return normToValue(norm)
  }, [normToValue])

  /** The value the ENGINE reads a fraction `t` of the way through the segment a->b, so the curve
   * this lane draws between two breakpoints is the curve that plays between them. Mirrors
   * interpolateAutomation in ui/src/audio/engine.ts: `a * (b/a)^t` for the log params, plain lerp
   * otherwise. (A plain LINEAR segment needs no sampling at all — on a log axis the engine's own
   * geometric interpolation is a straight line in screen space — so this is only reached by the
   * eased 'curve' segments, which is exactly where the two used to disagree.) */
  const segValue = useCallback(
    (a: number, b: number, t: number) => (logAxis && a > 0 && b > 0 ? a * Math.pow(b / a, t) : a + (b - a) * t),
    [logAxis],
  )

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
        ctx.fillText(drawMode ? 'drag to paint a run of points' : 'click to add a point, or ✏ to draw a run', 8, midY)
      }
      ctx.restore()
    }

    // Effective points = committed points with the active drag applied (move overrides one id; new
    // adds a provisional point). Sorted by time — the canonical curve order.
    const drag = dragRef.current
    let eff = points.map((p) => ({ ...p }))
    if (drag?.mode === 'move') eff = eff.map((p) => (p.id === drag.id ? { ...p, time: drag.time, value: drag.value } : p))
    if (drag?.mode === 'new') eff = [...eff, { id: '__draft__', time: drag.time, value: drag.value }]
    if (drag?.mode === 'paint' && drag.pts.size > 0) {
      // A paint stroke REPLACES the span it has covered so far, so the preview must too — otherwise
      // the old curve shows through the new one and the stroke looks like it did nothing. Same
      // span arithmetic writeRun() will use on release, so what is previewed is what is committed.
      const times = [...drag.pts.keys()]
      const lo = Math.min(...times)
      const hi = Math.max(...times)
      eff = eff.filter((p) => p.time < lo - RUN_SPAN_EPS || p.time > hi + RUN_SPAN_EPS)
      for (const [t, v] of drag.pts) eff.push({ id: '__draft__', time: t, value: v })
    }
    if (drag?.mode === 'segment') {
      eff = eff.map((p) => (p.id === drag.aId || p.id === drag.bId ? { ...p, time: clampTime(p.time + drag.dt), value: clampValue(p.value + drag.dv) } : p))
    }
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
              ctx.lineTo(ax + (bx - ax) * t, valueToY(segValue(a.value, b.value, shaped)))
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
    // Phase 41 Stream C: the selected segment (or the one being dragged) redrawn on top, thicker
    // and in white, with fatter caps on its two flanking points. Drawn as a SECOND pass over the
    // segments the loop above already laid out rather than branching inside it, so the ordinary
    // curve path stays one uninterrupted stroke and the highlight is never half-painted under a
    // later tile. Every tiled repeat of the segment highlights, matching how the curve itself tiles.
    const sel = drag?.mode === 'segment' ? { aId: drag.aId, bId: drag.bId } : selectedSegment
    if (sel) {
      ctx.save()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      for (const s of segments) {
        if (s.aId !== sel.aId || s.bId !== sel.bId) continue
        ctx.beginPath()
        ctx.moveTo(s.ax, s.ay)
        ctx.lineTo(s.bx, s.by)
        ctx.stroke()
        for (const [cx, cy] of [
          [s.ax, s.ay],
          [s.bx, s.by],
        ] as const) {
          ctx.beginPath()
          ctx.arc(cx, cy, 4.2, 0, Math.PI * 2)
          ctx.fillStyle = '#fff'
          ctx.fill()
        }
      }
      ctx.restore()
    }

    markersRef.current = markers
    segmentsRef.current = segments
  }, [points, totalBars, pxPerBar, occurrences, loopSteps, track.color, valueToY, segValue, drawMode, selectedSegment, clampTime, clampValue])

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
      // Phase 41 Stream C — shift+drag moves a whole SEGMENT. Checked before every other branch
      // (including draw mode) so the modifier always means the same thing on this lane. A shift
      // press that lands nowhere near a segment clears the selection rather than doing something
      // else, which keeps "shift is the segment key" true with no exceptions to remember.
      if (e.shiftKey) {
        e.preventDefault()
        const seg = hitTestSegment(localX, localY)
        if (!seg) {
          setSelectedSegment(null)
          return
        }
        setSelectedSegment({ aId: seg.aId, bId: seg.bId })
        const drag: DragState = { mode: 'segment', aId: seg.aId, bId: seg.bId, dt: 0, dv: 0 }
        dragRef.current = drag
        draw()
        const showLabel = (lx: number, ly: number, text: string) => {
          const label = dragLabelRef.current
          if (!label) return
          label.style.display = 'block'
          label.style.left = `${lx + 10}px`
          label.style.top = `${ly - 18}px`
          label.textContent = text
        }
        const onMove = (ev: PointerEvent) => {
          const d = dragRef.current
          if (!d || d.mode !== 'segment') return
          const lx = ev.clientX - rect.left
          const ly = ev.clientY - rect.top
          // Deltas straight from pixel deltas — NOT from clipTimeFromX, whose modulo-loopSteps wrap
          // would make a drag across a tile boundary jump a whole period backwards.
          d.dt = ((lx - localX) / pxPerBar) * 16
          d.dv = yToValue(ly) - yToValue(localY)
          draw()
          showLabel(lx, ly, `${d.dt >= 0 ? '+' : ''}${d.dt.toFixed(2)} steps, ${d.dv >= 0 ? '+' : ''}${fmt(d.dv)}`)
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          const label = dragLabelRef.current
          if (label) label.style.display = 'none'
          const d = dragRef.current
          dragRef.current = null
          if (d && d.mode === 'segment' && (d.dt !== 0 || d.dv !== 0)) {
            // Both endpoints move by the same delta, each written through the ordinary move path
            // (op 'set' WITH an id), so the segment keeps its slope, its length and its ids — and
            // so a segment drag reads in `beat diff` as two point moves, which is what it is.
            for (const id of [d.aId, d.bId]) {
              const p = points.find((pt) => pt.id === id)
              if (p) postAutomation({ op: 'set', track: track.id, clip: clipId, param, id, time: clampTime(p.time + d.dt), value: clampValue(p.value + d.dv) })
            }
          }
          draw()
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        return
      }
      // Phase 41 Stream C — Draw Mode: drag paints a run of breakpoints. Checked AFTER alt-delete
      // (so a mis-drawn point is still one alt-click away without leaving draw mode) and BEFORE the
      // marker-move / new-point branches (in draw mode a drag that starts on an existing point is
      // still a stroke — Ableton's Draw Mode behaves the same way). Alt+drag still bows a segment:
      // that gesture falls through below because this branch bails on altKey.
      if (drawMode && !e.altKey) {
        e.preventDefault()
        const pts = new Map<number, number>()
        dragRef.current = { mode: 'paint', pts }
        // One sample per PAINT_QUANTUM of clip-local time. Sampling in TIME rather than in pixels
        // means the stroke has the same resolution at every zoom level, and it is the unit the
        // points are stored in, so nothing is re-quantized later.
        const sampleAt = (lx: number, ly: number) => {
          const t = clipTimeFromX(lx)
          if (!t) return
          const q = Math.round(t.time / PAINT_QUANTUM) * PAINT_QUANTUM
          pts.set(Number(q.toFixed(4)), Number(yToValue(ly).toFixed(4)))
        }
        const showLabel = (lx: number, ly: number, value: number) => {
          const label = dragLabelRef.current
          if (!label) return
          label.style.display = 'block'
          label.style.left = `${lx + 10}px`
          label.style.top = `${ly - 18}px`
          label.textContent = fmt(value)
        }
        sampleAt(localX, localY)
        draw()
        showLabel(localX, localY, yToValue(localY))
        const onMove = (ev: PointerEvent) => {
          const drag = dragRef.current
          if (!drag || drag.mode !== 'paint') return
          const lx = ev.clientX - rect.left
          const ly = ev.clientY - rect.top
          // Interpolate across the gap since the last event. A fast sweep fires pointermove maybe
          // every 30-60px, which at PAINT_QUANTUM resolution would leave the stroke as a handful of
          // isolated samples with straight chords between them — visibly not what was drawn.
          const prevX = lastPaintRef.current
          if (prevX !== null && Math.abs(lx - prevX.x) > 1) {
            const steps = Math.min(256, Math.ceil(Math.abs(lx - prevX.x)))
            for (let i = 1; i < steps; i++) {
              const f = i / steps
              sampleAt(prevX.x + (lx - prevX.x) * f, prevX.y + (ly - prevX.y) * f)
            }
          }
          lastPaintRef.current = { x: lx, y: ly }
          sampleAt(lx, ly)
          draw()
          showLabel(lx, ly, yToValue(ly))
        }
        const onUp = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          lastPaintRef.current = null
          const label = dragLabelRef.current
          if (label) label.style.display = 'none'
          const drag = dragRef.current
          dragRef.current = null
          if (!drag || drag.mode !== 'paint' || drag.pts.size === 0) {
            draw()
            return
          }
          const stroke = [...drag.pts.entries()].map(([time, value]) => ({ time, value })).sort((a, b) => a.time - b.time)
          const from = stroke[0]!.time
          const to = stroke[stroke.length - 1]!.time
          // A single tap in draw mode is one point, not a "run" — no reduction to do, and calling
          // it a run would let the span logic wipe a neighbouring point for no reason.
          //
          // Reduce in NORMALIZED axis space, not in the param's raw units. On a log-axis param the
          // two are wildly different: a tolerance of 1% of cutoff's 20..18000 range is 180 Hz, which
          // erases everything below ~400 Hz (the whole bottom half of the lane) while removing
          // almost nothing above 2 kHz — a painted arc came back with its lower half flattened and
          // its upper half still carrying every sample. Caught by looking at the drawn result during
          // the pilot, not by any assertion. Normalized, `tolerance` means what its comment says:
          // 1% of the lane's HEIGHT, the same everywhere on the axis, linear params included.
          const run =
            stroke.length < 3
              ? stroke
              : simplifyAutomationPoints(
                  stroke.map((p, i) => ({ time: p.time, value: valueToNorm(p.value), i })),
                  { tolerance: PAINT_SIMPLIFY_FRACTION },
                ).map((k) => stroke[k.i]!)
          writeRun({ track: track.id, clip: clipId, param }, points, run, { from, to })
          draw()
        }
        lastPaintRef.current = { x: localX, y: localY }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
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
      // (dragRef.current here is always 'move' | 'new' — the 'bow' and 'paint' branches above have
      // already returned. The guards below say so to the type checker, not just to the reader.)
      const initial = dragRef.current
      if (initial) showLabel(localX, localY, initial.value)

      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current
        if (!drag || drag.mode === 'bow' || drag.mode === 'paint' || drag.mode === 'segment') return
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
        if (!drag || drag.mode === 'bow' || drag.mode === 'paint' || drag.mode === 'segment') {
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
    [points, clipTimeFromX, yToValue, valueToNorm, draw, hitTestSegment, fmt, track.id, clipId, param, drawMode, pxPerBar, clampTime, clampValue],
  )

  /** Sample the chosen shape across the clip's own tiling period and write it as one run.
   *
   * The span is `loopSteps` — the exact period this lane tiles at on screen and the engine repeats
   * at — rather than core applyAutomationShape's clip.loop-first resolution. They agree for every
   * clip without a loop override, and where they disagree the drawn curve must match what the user
   * is looking at: a shape that visually ran past the end of the tile would be a lie. */
  const insertShape = useCallback(() => {
    const from = Number.isFinite(shapeFrom) ? shapeFrom : min
    const to = Number.isFinite(shapeTo) ? shapeTo : max
    const run = automationShapePoints(shape, {
      from,
      to,
      cycles: Math.max(0.01, shapeCycles),
      points: Math.max(2, Math.min(256, Math.round(shapePoints))),
      spanSteps: loopSteps,
    })
    // A shape REPLACES the whole lane, the same rule core's applyAutomationShape follows ("a shape
    // REPLACES it, it doesn't add to it") — so the span covers every existing point, not just the
    // sampled range, and a lane that already held a hand-drawn curve does not end up with both.
    writeRun({ track: track.id, clip: clipId, param }, points, run, { from: 0, to: Math.max(loopSteps, ...points.map((p) => p.time)) })
    setShapePanel(false)
  }, [shape, shapeFrom, shapeTo, shapeCycles, shapePoints, loopSteps, min, max, points, track.id, clipId, param])

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
        <button
          className={`arr-auto-tool${drawMode ? ' on' : ''}`}
          title={drawMode ? 'draw mode ON — drag across the lane to paint a run of points (click to turn off)' : 'draw mode: drag across the lane to paint a run of points instead of placing one'}
          aria-pressed={drawMode}
          data-auto-draw={`${track.id}.${param}`}
          onClick={() => setDrawMode((v) => !v)}
        >
          ✏
        </button>
        <button
          className={`arr-auto-tool${shapePanel ? ' on' : ''}`}
          title="insert a shape (sine / triangle / ramp / exp / ADSR) across this clip"
          aria-pressed={shapePanel}
          data-auto-shape-open={`${track.id}.${param}`}
          onClick={() => setShapePanel((v) => !v)}
        >
          ∿
        </button>
        <button className="arr-auto-remove" title="remove this automation lane" data-auto-remove={`${track.id}.${param}`} onClick={onRemoveLane}>
          ×
        </button>
      </div>
      <div
        className={`arr-auto-lane${drawMode ? ' drawing' : ''}`}
        data-auto-track={track.id}
        data-auto-param={param}
        data-auto-draw-mode={drawMode ? 'on' : 'off'}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        style={{ touchAction: 'none' }}
      >
        <canvas ref={canvasRef} className="arr-auto-canvas" />
        <div ref={dragLabelRef} className="arr-auto-drag-label" style={{ display: 'none' }} />
        {shapePanel && (
          <div className="arr-auto-shape" data-auto-shape-panel={`${track.id}.${param}`} onPointerDown={(e) => e.stopPropagation()}>
            <select className="arr-auto-shape-select" value={shape} data-auto-shape-kind={`${track.id}.${param}`} onChange={(e) => setShape(e.target.value as AutomationShape)}>
              {AUTOMATION_SHAPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <label className="arr-auto-shape-field">
              <span>from</span>
              <input type="number" step="any" value={shapeFrom} data-auto-shape-from={`${track.id}.${param}`} onChange={(e) => setShapeFrom(Number(e.target.value))} />
            </label>
            <label className="arr-auto-shape-field">
              <span>to</span>
              <input type="number" step="any" value={shapeTo} data-auto-shape-to={`${track.id}.${param}`} onChange={(e) => setShapeTo(Number(e.target.value))} />
            </label>
            {/* cycles is meaningless for the single-gesture shapes — automationShapePoints ignores
                it for ramp/exp/adsr, so offering it there would be a control that does nothing. */}
            {(shape === 'sine' || shape === 'triangle') && (
              <label className="arr-auto-shape-field">
                <span>cycles</span>
                <input type="number" step="any" min={0.01} value={shapeCycles} data-auto-shape-cycles={`${track.id}.${param}`} onChange={(e) => setShapeCycles(Number(e.target.value))} />
              </label>
            )}
            <label className="arr-auto-shape-field">
              <span>pts</span>
              <input type="number" step={1} min={2} max={256} value={shapePoints} data-auto-shape-points={`${track.id}.${param}`} onChange={(e) => setShapePoints(Number(e.target.value))} />
            </label>
            <span className="arr-auto-shape-span" title="a shape spans the clip's own loop period, the same period this lane tiles at">
              over {loopSteps / 16} bar{loopSteps === 16 ? '' : 's'}
            </span>
            <button className="arr-auto-shape-go" data-auto-shape-insert={`${track.id}.${param}`} onClick={insertShape}>
              insert
            </button>
          </div>
        )}
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

  // ── Automation discovery (Phase 41 Stream C) ──────────────────────────────────────────────────
  // research/65: Ableton lights an LED next to any control carrying automation plus a "Show
  // Automated Parameters Only" filter; dotbeat had no glance-able signal at all.
  //
  // The row proposed a dot on the picker's own <option>s. On its own that is nearly a no-op here:
  // ArrangementView's visibleParamsFor already auto-opens a lane for every automated param on the
  // PRIMARY clip and then subtracts those from `available`, so an option carrying automation on the
  // clip you are looking at is never in the list to be dotted. What IS invisible — and what the row
  // was actually after — is automation on this track's OTHER clips, i.e. the sections you are not
  // currently looking at. That is the whole track scanned below, not one clip.
  const automated = useMemo(() => {
    const byParam = new Map<string, { clips: string[]; points: number }>()
    for (const c of track.clips) {
      for (const l of c.automation) {
        if (l.points.length === 0) continue
        const cur = byParam.get(l.param) ?? { clips: [], points: 0 }
        cur.clips.push(c.id)
        cur.points += l.points.length
        byParam.set(l.param, cur)
      }
    }
    return byParam
  }, [track.clips])

  return (
    <div className="arr-auto-picker" style={{ height: PICKER_H }}>
      <div className="arr-auto-picker-head" style={{ width: headerWidth }}>
        automation
      </div>
      <div className="arr-auto-picker-body">
        <select className="arr-auto-select" value={pick} data-auto-select={track.id} onChange={(e) => setPick(e.target.value)}>
          {available.map((a) => (
            <option key={a.key} value={a.key}>
              {/* A native <option> cannot carry markup, so the badge is a leading glyph — the same
                  trick every browser-native "already used" list uses. */}
              {automated.has(a.key) ? '● ' : ''}
              {laneLabel(track, a.key)}
            </option>
          ))}
        </select>
        <button className="arr-auto-add" data-auto-add={track.id} onClick={() => pick && onAdd(pick)} disabled={!pick}>
          + add lane
        </button>
        {automated.size > 0 && (
          <div className="arr-auto-automated" data-auto-automated={track.id}>
            <span className="arr-auto-automated-label">automated:</span>
            {[...automated.entries()].map(([p, info]) => (
              <button
                key={p}
                type="button"
                className="arr-auto-chip"
                data-auto-chip={`${track.id}.${p}`}
                title={`${info.points} point${info.points === 1 ? '' : 's'} across clip${info.clips.length === 1 ? '' : 's'} ${info.clips.join(', ')} — click to show this lane`}
                onClick={() => onAdd(p)}
              >
                {laneLabel(track, p)}
                <span className="arr-auto-chip-count">{info.points}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
