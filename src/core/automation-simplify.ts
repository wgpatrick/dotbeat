// Phase 41 Stream C — geometric breakpoint reduction for an automation lane (the "Simplify Envelope"
// roadmap row), as a pure function with no document and no I/O, the same shape as its sibling
// src/core/automation-shape.ts.
//
// The immediate consumer is the GUI's paint-a-run gesture: a drag sampled at one point per 16th
// step lays down 64 breakpoints across a 4-bar clip, most of them hand jitter riding a line the ear
// hears as straight. Committing all 64 costs 64 lines of diff, 64 daemon round-trips and 64 undo
// entries for ONE gesture, and the jitter is audible as stepping on a slow filter sweep. Reducing
// them first is what makes a painted curve clean rather than merely possible.
//
// The measure is VERTICAL deviation, not the perpendicular distance a textbook Douglas-Peucker
// uses. Perpendicular distance would have to mix two incommensurable units (16th steps against Hz,
// dB or 0..1), so its "tolerance" would mean something different for every param and every zoom
// level. Vertical deviation asks the only question that matters for an envelope — "if this point
// were dropped, how far off would the rendered value be at that instant?" — and answers it in the
// param's own units, so `tolerance` reads as "never move the curve by more than this much".

export interface SimplifiablePoint {
  time: number
  value: number
  /** A point carrying a non-linear segment shape is never dropped — the flag is authored intent
   * (an explicit hold or bow), not sampled data, and no vertical measurement can recover it. */
  interpolation?: string | undefined
}

export class AutomationSimplifyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AutomationSimplifyError'
  }
}

/** Largest vertical gap between the polyline through `pts[lo..hi]` and the straight chord from
 * `pts[lo]` to `pts[hi]`, plus the index where it occurs. Endpoints are excluded (they sit on the
 * chord by construction). Returns index -1 when there is nothing between the two ends. */
function worstDeviation(pts: readonly SimplifiablePoint[], lo: number, hi: number): { index: number; deviation: number } {
  const a = pts[lo]!
  const b = pts[hi]!
  const dt = b.time - a.time
  let index = -1
  let deviation = -1
  for (let i = lo + 1; i < hi; i++) {
    const p = pts[i]!
    // A zero-width span (two points at the same time) has no meaningful chord to measure against;
    // fall back to the straight value difference so a coincident stack still gets reduced.
    const onChord = dt === 0 ? a.value : a.value + ((b.value - a.value) * (p.time - a.time)) / dt
    const d = Math.abs(p.value - onChord)
    if (d > deviation) {
      deviation = d
      index = i
    }
  }
  return { index, deviation }
}

/** Reduce `points` to the fewest breakpoints that reproduce the same curve to within `tolerance`,
 * measured in the param's own value units (see the header: vertical deviation, not perpendicular).
 *
 * Guarantees, all covered by known-answer tests:
 *  - the first and last points always survive, so the curve's span never shrinks;
 *  - any point whose `interpolation` is set to something other than 'linear' always survives;
 *  - the result is in the same order as the input, and every surviving point is the ORIGINAL
 *    object (never a re-averaged or re-timed approximation) — simplification only ever deletes;
 *  - `tolerance <= 0` returns the input unchanged rather than doing anything surprising.
 *
 * The input must already be sorted by time — the caller owns ordering (lanes serialize sorted by
 * (time, id), and the paint gesture generates in time order), and silently re-sorting here would
 * hide a real bug in whichever caller handed over scrambled data. */
export function simplifyAutomationPoints<T extends SimplifiablePoint>(points: readonly T[], opts: { tolerance: number }): T[] {
  const { tolerance } = opts
  if (!Number.isFinite(tolerance)) throw new AutomationSimplifyError(`tolerance must be a finite number, got ${tolerance}`)
  if (points.length <= 2 || tolerance <= 0) return [...points]
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.time < points[i - 1]!.time) {
      throw new AutomationSimplifyError(`points must be sorted by time — index ${i} (t=${points[i]!.time}) precedes index ${i - 1} (t=${points[i - 1]!.time})`)
    }
  }

  // Points that must survive regardless of geometry: the two ends, plus every authored segment
  // shape. They partition the run into independent spans, each simplified on its own — which also
  // means a shaped point never gets to "protect" a neighbour that geometry says is redundant.
  const anchors = [0]
  for (let i = 1; i < points.length - 1; i++) {
    const interp = points[i]!.interpolation
    if (interp !== undefined && interp !== 'linear') anchors.push(i)
  }
  anchors.push(points.length - 1)

  const keep = new Set<number>(anchors)
  // Iterative Douglas-Peucker over an explicit stack: recursion depth would otherwise track point
  // count, and nothing upstream caps how long a lane can get.
  const stack: [number, number][] = []
  for (let i = 0; i < anchors.length - 1; i++) stack.push([anchors[i]!, anchors[i + 1]!])
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!
    if (hi - lo < 2) continue
    const { index, deviation } = worstDeviation(points, lo, hi)
    if (index === -1 || deviation <= tolerance) continue
    keep.add(index)
    stack.push([lo, index], [index, hi])
  }

  const out: T[] = []
  for (let i = 0; i < points.length; i++) if (keep.has(i)) out.push(points[i]!)
  return out
}
