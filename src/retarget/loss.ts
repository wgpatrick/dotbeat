// The preset-retargeting loss: how far is this render from the role's measured target profile,
// WITHOUT wrecking the preset it started from?
//
// Four terms, each answering a failure mode this project has already measured:
//
//   gap       — weighted distance to the role's targets, aggregated as a WORST-AXIS-EMPHASIZING
//               power mean (p=3) over per-axis misses that are CLIPPED AT ZERO once satisfied.
//               This is the anti-gaming construction. A plain weighted sum lets the optimizer buy
//               a big win on one cheap axis and ignore an expensive one; 131 §5's finding is that
//               the gap is "many medium-sized axes with role-specific signs" and that a single
//               global knob "would provably help one role and hurt another". Clipping at zero
//               additionally kills the width-hack shape of failure (131 §5: engineplus was already
//               WIDER than the refs beating it — more of a satisfied axis is worth exactly nothing).
//
//   regress   — a QUADRATIC surcharge on any target the ORIGINAL preset already satisfied and the
//               candidate does not. "Don't break what's already right", stated as an asymmetry:
//               losing a property the preset had costs more than failing to gain one it never had.
//
//   preserve  — drift of the role's non-target IDENTITY axes (presence/air share, low-mid density,
//               envelope spread, sustain, hit-level and attack variety) beyond a free band. This is
//               what keeps a retarget from turning a warm pad into a different instrument that
//               happens to hit nine numbers.
//
//   drift     — squared displacement in genome space from the preset's own starting point. The
//               trust region's soft half (the hard half is the per-parameter box in space.ts).
//               research/117 + docs/pilot.md's T5 gate is the reason: unconstrained critic-guided
//               search over a large patch space LOST to random controls. This search is local by
//               construction — a preset is a human-designed known-good point and the optimizer's
//               job is to nudge it, not to leave.
//
// Pure functions of (features, profile, baseline, genome). No fs, no rendering, no global state.

import type { RetargetFeatures, RetargetFeatureKey } from './features.js'
import { RETARGET_FEATURE_SCALES, targetMiss, targetSatisfied, type RoleTargetProfile } from './targets.js'

/** Bump when any term below changes — invalidates cached evaluations. */
export const RETARGET_LOSS_VERSION = 1

/** Worst-axis emphasis of the gap term. p=1 would be a plain weighted mean (gameable); p->inf
 * would optimize only the single worst axis (brittle, and 131 §5 says the gap is many axes). 3 is
 * the compromise: an axis 2x worse than another contributes 8x, not 2x. */
export const GAP_POWER = 3

/** Per-axis miss ceiling, in scale units. Without it a single unreachable axis (e.g. sub-band
 * energy a patch physically cannot produce) dominates the whole loss and the search spends its
 * budget there instead of banking the reachable wins. 131 §5's ceiling finding says unreachable
 * axes are REAL, so the loss has to degrade gracefully around them. */
export const MISS_CAP = 3

/** Identity drift smaller than this many scale units is free — presets are being nudged, and
 * every render carries real DSP variance (docs/render-determinism.md: band shares move ~1.6 pt,
 * width ~1.3 dB between identical renders). */
export const PRESERVE_FREE_BAND = 0.75

export const W_REGRESS = 0.5
export const W_PRESERVE = 0.35
export const W_DRIFT = 0.5

export interface AxisDetail {
  key: RetargetFeatureKey
  value: number
  /** the target region, for reports */
  region: string
  miss: number
  weight: number
  satisfied: boolean
  /** true when the ORIGINAL preset satisfied this target and the candidate no longer does */
  regressed: boolean
}

export interface RetargetLossDetail {
  total: number
  gap: number
  regress: number
  preserve: number
  drift: number
  axes: AxisDetail[]
  /** how many scored targets are satisfied, out of how many */
  hit: number
  of: number
}

export interface RetargetLossOptions {
  /** genome (unit cube) of the candidate and of the preset's own starting point — the drift term.
   * Omit both to score a render with no drift penalty (e.g. the before/after table). */
  genome?: readonly number[]
  startGenome?: readonly number[]
  weights?: { regress?: number; preserve?: number; drift?: number }
}

const describe = (kind: string, lo?: number, hi?: number) =>
  kind === 'atLeast' ? `>= ${lo}` : kind === 'atMost' ? `<= ${hi}` : `${lo} .. ${hi}`

/** Weighted power mean of clipped misses: ( sum w_i m_i^p / sum w_i )^(1/p). */
export function powerMean(values: readonly number[], weights: readonly number[], p: number): number {
  let num = 0
  let den = 0
  for (let i = 0; i < values.length; i++) {
    const w = weights[i] ?? 0
    if (w <= 0) continue
    num += w * Math.pow(Math.max(0, values[i] ?? 0), p)
    den += w
  }
  if (den <= 0) return 0
  return Math.pow(num / den, 1 / p)
}

/**
 * Score one candidate render against a role profile.
 *
 * @param features  the candidate's measured features
 * @param profile   the role's target profile
 * @param baseline  the ORIGINAL preset's features (the "don't break what's right" reference)
 */
export function retargetLoss(
  features: RetargetFeatures,
  profile: RoleTargetProfile,
  baseline: RetargetFeatures,
  opts: RetargetLossOptions = {},
): RetargetLossDetail {
  const wRegress = opts.weights?.regress ?? W_REGRESS
  const wPreserve = opts.weights?.preserve ?? W_PRESERVE
  const wDrift = opts.weights?.drift ?? W_DRIFT

  const axes: AxisDetail[] = []
  const misses: number[] = []
  const weights: number[] = []
  let regressNum = 0
  let regressDen = 0
  let hit = 0
  for (const target of profile.targets) {
    const value = features[target.key]
    const raw = targetMiss(target, value)
    const miss = Math.min(raw, MISS_CAP)
    const wasOk = targetSatisfied(target, baseline[target.key])
    const isOk = raw <= 0
    if (isOk) hit++
    axes.push({
      key: target.key,
      value,
      region: describe(target.kind, target.lo, target.hi),
      miss: raw,
      weight: target.weight,
      satisfied: isOk,
      regressed: wasOk && !isOk,
    })
    misses.push(miss)
    weights.push(target.weight)
    if (wasOk) {
      regressNum += target.weight * miss * miss
      regressDen += target.weight
    }
  }
  const gap = powerMean(misses, weights, GAP_POWER)
  const regress = regressDen > 0 ? regressNum / regressDen : 0

  let preserveNum = 0
  let preserveDen = 0
  for (const key of profile.preserve) {
    const scale = RETARGET_FEATURE_SCALES[key] || 1
    const a = features[key]
    const b = baseline[key]
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    const d = Math.max(0, Math.abs(a - b) / scale - PRESERVE_FREE_BAND)
    preserveNum += Math.min(d, MISS_CAP) ** 2
    preserveDen += 1
  }
  const preserve = preserveDen > 0 ? preserveNum / preserveDen : 0

  let drift = 0
  if (opts.genome && opts.startGenome && opts.genome.length === opts.startGenome.length && opts.genome.length > 0) {
    let sq = 0
    for (let i = 0; i < opts.genome.length; i++) sq += (opts.genome[i]! - opts.startGenome[i]!) ** 2
    drift = sq / opts.genome.length
  }

  return {
    total: gap + wRegress * regress + wPreserve * preserve + wDrift * drift,
    gap,
    regress,
    preserve,
    drift,
    axes,
    hit,
    of: profile.targets.length,
  }
}

/** A compact one-line summary for logs. */
export function formatLossLine(d: RetargetLossDetail): string {
  return (
    `loss ${d.total.toFixed(4)} (gap ${d.gap.toFixed(4)}, regress ${d.regress.toFixed(4)}, ` +
    `preserve ${d.preserve.toFixed(4)}, drift ${d.drift.toFixed(4)}) — ${d.hit}/${d.of} targets hit`
  )
}
