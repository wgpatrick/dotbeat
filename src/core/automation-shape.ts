// Phase 37 Stream RC — predefined automation SHAPES as a pure sampler (the "Predefined automation
// shapes" roadmap row, made a generator). A shape is sampled into N uniformly-spaced breakpoints
// across a clip's span; `applyAutomationShape` (src/core/edit.ts) then writes each point through the
// existing setAutomationPoint primitive — NO new grammar, just a lane full of ordinary points. All
// five shapes emit exactly `points` points (default 16), so `--points` applies uniformly and
// known-answer tests are trivial: the geometry is decided here, in one small pure function, with no
// I/O, no document, and no engine.

/** The five predefined shapes. ramp = linear from->to; sine/triangle = `cycles` oscillations
 * between from and to (each STARTS at `from`, rises to `to`, returns — one clean cycle); exp = an
 * eased (exponential) from->to curve; adsr = a fixed-proportion attack/decay/sustain/release
 * envelope whose peak is `to`, floor is `from`. */
export type AutomationShape = 'ramp' | 'sine' | 'triangle' | 'exp' | 'adsr'
export const AUTOMATION_SHAPES: readonly AutomationShape[] = ['ramp', 'sine', 'triangle', 'exp', 'adsr']

export interface AutomationShapeOptions {
  /** Lane value at phase 0 (and, for sine/triangle/adsr, the value the shape returns to). */
  from: number
  /** The shape's target/peak value. */
  to: number
  /** sine/triangle only: how many full oscillations across the span. Default 1. Ignored by
   * ramp/exp/adsr (they are single-gesture shapes). */
  cycles?: number
  /** How many breakpoints to emit, uniformly spaced across [0, spanSteps]. Default 16, min 2
   * (a shape needs at least a start and an end point to move). */
  points?: number
  /** The clip's span in fractional 16th steps — points are sampled across [0, spanSteps], so the
   * first point sits at time 0 and the last at time `spanSteps`. */
  spanSteps: number
}

export interface AutomationShapePoint {
  time: number
  value: number
}

export class AutomationShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AutomationShapeError'
  }
}

// exp's easing steepness (e^3 curve) and adsr's fixed segment/level proportions live here as named
// constants so the known-answer tests and any future tuning read the same numbers. adsr: attack
// 20% of span (from->to), decay 20% (to->sustain level), sustain hold 40%, release 20% (sustain
// level->from). Sustain sits at 60% of the from..to range — a conventional-looking envelope.
const EXP_K = 3
const ADSR_ATTACK = 0.2
const ADSR_DECAY = 0.2
const ADSR_SUSTAIN_HOLD = 0.4 // (release is the remaining 0.2)
const ADSR_SUSTAIN_LEVEL = 0.6

/** value at normalized phase p in [0,1] for the given shape (from/to/cycles closed over by the
 * caller). Split out so the sampling loop (which owns time placement) stays shape-agnostic. */
function shapeValue(shape: AutomationShape, p: number, from: number, to: number, cycles: number): number {
  const span = to - from
  switch (shape) {
    case 'ramp':
      return from + span * p
    case 'sine':
      // starts at `from` (cos 0 = 1 -> (1-1)/2 = 0), peaks at `to` a quarter-cycle in, returns.
      return from + span * ((1 - Math.cos(2 * Math.PI * cycles * p)) / 2)
    case 'triangle': {
      const q = (cycles * p) % 1
      const tri = q < 0.5 ? 2 * q : 2 - 2 * q // 0 -> 1 -> 0 triangle, starting at 0
      return from + span * tri
    }
    case 'exp':
      // eased from->to: a normalized e^(EXP_K*p) curve; exact at both endpoints (p=0 -> from,
      // p=1 -> to) so it composes with the same known-answer discipline as the linear shapes.
      return from + span * ((Math.exp(EXP_K * p) - 1) / (Math.exp(EXP_K) - 1))
    case 'adsr': {
      const sustain = from + span * ADSR_SUSTAIN_LEVEL
      const decayEnd = ADSR_ATTACK + ADSR_DECAY
      const sustainEnd = decayEnd + ADSR_SUSTAIN_HOLD
      if (p < ADSR_ATTACK) return from + (to - from) * (p / ADSR_ATTACK)
      if (p < decayEnd) return to + (sustain - to) * ((p - ADSR_ATTACK) / ADSR_DECAY)
      if (p < sustainEnd) return sustain
      return sustain + (from - sustain) * ((p - sustainEnd) / (1 - sustainEnd))
    }
  }
}

/** Sample one predefined `shape` into `points` uniformly-spaced automation breakpoints across a
 * clip span of `spanSteps` 16th steps. Pure: no document, no I/O — the geometry only. The caller
 * (applyAutomationShape) turns these into a real lane via setAutomationPoint. */
export function automationShapePoints(shape: AutomationShape, opts: AutomationShapeOptions): AutomationShapePoint[] {
  if (!(AUTOMATION_SHAPES as readonly string[]).includes(shape)) {
    throw new AutomationShapeError(`unknown shape "${shape}" (have: ${AUTOMATION_SHAPES.join(', ')})`)
  }
  const points = opts.points ?? 16
  const cycles = opts.cycles ?? 1
  if (!Number.isFinite(opts.from) || !Number.isFinite(opts.to)) throw new AutomationShapeError(`from/to must be finite numbers, got from=${opts.from} to=${opts.to}`)
  if (!Number.isInteger(points) || points < 2) throw new AutomationShapeError(`points must be an integer >= 2 (a shape needs a start and an end), got ${points}`)
  if (points > 256) throw new AutomationShapeError(`points must be <= 256 (a lane that dense is almost certainly a mistake), got ${points}`)
  if (!Number.isFinite(cycles) || cycles <= 0) throw new AutomationShapeError(`cycles must be > 0, got ${cycles}`)
  if (!Number.isFinite(opts.spanSteps) || opts.spanSteps <= 0) throw new AutomationShapeError(`spanSteps must be > 0, got ${opts.spanSteps}`)

  const out: AutomationShapePoint[] = []
  for (let i = 0; i < points; i++) {
    const p = i / (points - 1) // 0..1 inclusive
    out.push({ time: opts.spanSteps * p, value: shapeValue(shape, p, opts.from, opts.to, cycles) })
  }
  return out
}
