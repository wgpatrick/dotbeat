// The retargeter: local CMA-ES from a preset's own parameters toward a role's measured target
// profile, inside a trust region, scored by src/retarget/loss.ts.
//
// Engine-agnostic by injection, exactly like src/match/harness.ts: the caller supplies a
// `RetargetRenderer` that turns a param bag into decoded audio. The CLI-side runner
// (scripts/retarget-presets.mjs) supplies the real offline engine session; tests supply a pure-TS
// stand-in, which is how the search loop is exercised without a browser.
//
// SEARCH GEOMETRY. CMA-ES runs in a "trust cube" z in [0,1]^n, where each dimension is affinely
// mapped onto that param's own trust interval [start - trust, start + trust] (clipped to the
// param's legal range). So a single scalar step size is correct for every dimension even though
// the trust radii differ by 4x, and the preset itself always sits inside the cube. The preset's
// own z is evaluated FIRST and seeds the search, so a retarget can never report a result worse
// than the preset it started from (the anchor discipline match's stage-2 learned the hard way).

import { createHash } from 'node:crypto'
import { CmaEs } from '../match/cmaes.js'
import { computeRetargetFeatures, type RetargetFeatures } from './features.js'
import { retargetLoss, RETARGET_LOSS_VERSION, type RetargetLossDetail } from './loss.js'
import { targetProfileFor, type RoleTargetProfile } from './targets.js'
import {
  genomeToParams,
  paramDiff,
  presetGenome,
  retargetSpace,
  trustBounds,
  type ParamMove,
  type RetargetParamDef,
} from './space.js'

export class RetargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetargetError'
  }
}

export interface DecodedAudio {
  channels: Float64Array[]
  sampleRate: number
}

/** Render this param bag as the role's evaluation clip. The caller owns the figure, the document,
 * and the engine session; the harness only knows "params in, audio out". */
export type RetargetRenderer = (params: Record<string, number>) => Promise<DecodedAudio>

export interface RetargetPoint {
  /** 1-based evaluation index (renders + cache hits) */
  eval: number
  render: number
  loss: number
  best: number
  gap: number
  hit: number
  cached?: boolean
}

export interface RetargetOptions {
  role: string
  /** the preset being retargeted — id + its param bag, exactly as a preset bank stores it. */
  presetId: string
  presetParams: Record<string, unknown>
  render: RetargetRenderer
  /** total evaluation budget (renders + cache hits). Default 300. */
  budget?: number
  /** CMA-ES population per generation. Default 12. */
  population?: number
  seed?: number
  log?: (line: string) => void
  /** override the loss's term weights (tests + ablations). */
  weights?: { regress?: number; preserve?: number; drift?: number }
}

export interface RetargetResult {
  role: string
  presetId: string
  lossVersion: number
  budget: number
  population: number
  seed: number
  renders: number
  cacheHits: number
  /** the preset as it went in (only the fields the space can move, resolved against engine defaults) */
  beforeParams: Record<string, number>
  afterParams: Record<string, number>
  before: { features: RetargetFeatures; loss: RetargetLossDetail }
  after: { features: RetargetFeatures; loss: RetargetLossDetail }
  moved: ParamMove[]
  curve: RetargetPoint[]
  /** targets the search never satisfied — the ceiling finding, per preset. */
  unreachable: { key: string; region: string; value: number; miss: number }[]
  elapsedSeconds: number
  /** the best candidate's audio, so the caller can write a render without a second pass. */
  afterAudio: DecodedAudio
  beforeAudio: DecodedAudio
}

const round4 = (x: number) => Math.round(x * 10000) / 10000

function paramsKey(params: Record<string, number>): string {
  const keys = Object.keys(params).sort()
  return createHash('sha256').update(`${RETARGET_LOSS_VERSION}:${keys.map((k) => `${k}=${params[k]}`).join(';')}`).digest('hex')
}

/** z in [0,1]^n (the trust cube) -> genome in [0,1]^n (the param space). */
export function zToGenome(z: readonly number[], lower: readonly number[], upper: readonly number[]): number[] {
  return z.map((v, i) => {
    const lo = lower[i] ?? 0
    const hi = upper[i] ?? 1
    return lo + Math.min(1, Math.max(0, v)) * (hi - lo)
  })
}

/** The preset's own position inside the trust cube (0.5 unless a bound clipped). */
export function presetZ(start: readonly number[], lower: readonly number[], upper: readonly number[]): number[] {
  return start.map((s, i) => {
    const lo = lower[i] ?? 0
    const hi = upper[i] ?? 1
    return hi > lo ? Math.min(1, Math.max(0, (s - lo) / (hi - lo))) : 0.5
  })
}

export async function runRetarget(opts: RetargetOptions): Promise<RetargetResult> {
  const t0 = Date.now()
  const log = opts.log ?? (() => {})
  const budget = opts.budget ?? 300
  const population = opts.population ?? 12
  const seed = opts.seed ?? 41
  if (budget < 20) throw new RetargetError(`budget ${budget} is too small to search anything (need >= 20)`)

  const profile: RoleTargetProfile = targetProfileFor(opts.role)
  const defs: RetargetParamDef[] = retargetSpace(opts.role)
  const start = presetGenome(defs, opts.presetParams)
  const { lower, upper } = trustBounds(defs, start)
  const z0 = presetZ(start, lower, upper)

  const cache = new Map<string, { loss: RetargetLossDetail; features: RetargetFeatures }>()
  const curve: RetargetPoint[] = []
  let renders = 0
  let cacheHits = 0
  let evals = 0

  // ---- the baseline: the preset itself ---------------------------------------------------------
  const beforeParams = genomeToParams(defs, start)
  const beforeAudio = await opts.render(beforeParams)
  renders++
  const beforeFeatures = computeRetargetFeatures(beforeAudio.channels, beforeAudio.sampleRate)
  const beforeLoss = retargetLoss(beforeFeatures, profile, beforeFeatures, {
    genome: start,
    startGenome: start,
    ...(opts.weights ? { weights: opts.weights } : {}),
  })
  log(`baseline ${opts.presetId} (${opts.role}): ${beforeLoss.hit}/${beforeLoss.of} targets hit, loss ${beforeLoss.total.toFixed(4)}`)

  let best: { z: number[]; genome: number[]; loss: RetargetLossDetail; features: RetargetFeatures; audio: DecodedAudio } = {
    z: [...z0],
    genome: [...start],
    loss: beforeLoss,
    features: beforeFeatures,
    audio: beforeAudio,
  }
  cache.set(paramsKey(beforeParams), { loss: beforeLoss, features: beforeFeatures })
  evals++
  curve.push({ eval: evals, render: renders, loss: round4(beforeLoss.total), best: round4(beforeLoss.total), gap: round4(beforeLoss.gap), hit: beforeLoss.hit })

  // ---- the search ------------------------------------------------------------------------------
  const evaluate = async (z: readonly number[]): Promise<number> => {
    const genome = zToGenome(z, lower, upper)
    const params = genomeToParams(defs, genome)
    const key = paramsKey(params)
    const cached = cache.get(key)
    let loss: RetargetLossDetail
    let features: RetargetFeatures
    let audio: DecodedAudio | null = null
    evals++
    if (cached) {
      cacheHits++
      // the drift term depends on the genome, not the render — recompute it against the cached
      // features so two genomes that round to the same params still score honestly
      loss = retargetLoss(cached.features, profile, beforeFeatures, {
        genome,
        startGenome: start,
        ...(opts.weights ? { weights: opts.weights } : {}),
      })
      features = cached.features
    } else {
      audio = await opts.render(params)
      renders++
      features = computeRetargetFeatures(audio.channels, audio.sampleRate)
      loss = retargetLoss(features, profile, beforeFeatures, {
        genome,
        startGenome: start,
        ...(opts.weights ? { weights: opts.weights } : {}),
      })
      cache.set(key, { loss, features })
    }
    if (loss.total < best.loss.total) {
      best = { z: [...z], genome, loss, features, audio: audio ?? best.audio }
      if (audio === null) best.audio = beforeAudio // will be re-rendered below; never left stale
      log(`  eval ${evals} (render ${renders}): new best loss ${loss.total.toFixed(4)}, ${loss.hit}/${loss.of} hit, gap ${loss.gap.toFixed(4)}`)
    }
    curve.push({
      eval: evals,
      render: renders,
      loss: round4(loss.total),
      best: round4(best.loss.total),
      gap: round4(loss.gap),
      hit: loss.hit,
      ...(cached ? { cached: true } : {}),
    })
    return loss.total
  }

  const es = new CmaEs(z0, 0.2, {
    populationSize: population,
    seed,
    lowerBounds: new Array(defs.length).fill(0),
    upperBounds: new Array(defs.length).fill(1),
  })
  log(`search: CMA-ES over ${defs.length} trust-cube dims, population ${population}, budget ${budget}`)
  // `spent` counts ASKED points so a converged run that keeps hitting the cache still terminates.
  const spentCap = budget * 3 + 50
  let spent = 0
  let bestZBeforeGen = -1
  while (evals + es.lambda <= budget && spent + es.lambda <= spentCap) {
    const pts = es.ask()
    const losses: number[] = []
    for (const x of pts) losses.push(await evaluate(x))
    es.tell(pts, losses)
    spent += pts.length
    if (best.loss.total === bestZBeforeGen) {
      // no improvement this generation — keep going; CMA-ES restarts are out of scope for a local
      // search this small, and the budget is the stop condition.
    }
    bestZBeforeGen = best.loss.total
  }

  // The winner may have come from the cache with no bytes in hand (two genomes rounding to one
  // param bag). Re-render it once so the report's audio is really the winner's audio. A report
  // artifact, not a search evaluation: it does not count against the budget.
  const afterParams = genomeToParams(defs, best.genome)
  let afterAudio = best.audio
  if (afterAudio === beforeAudio && paramsKey(afterParams) !== paramsKey(beforeParams)) {
    log('best candidate came from the evaluation cache — rendering it once for the report')
    afterAudio = await opts.render(afterParams)
  }
  const afterFeatures = computeRetargetFeatures(afterAudio.channels, afterAudio.sampleRate)
  const afterLoss = retargetLoss(afterFeatures, profile, beforeFeatures, {
    genome: best.genome,
    startGenome: start,
    ...(opts.weights ? { weights: opts.weights } : {}),
  })

  const unreachable = afterLoss.axes
    .filter((a) => !a.satisfied)
    .map((a) => ({ key: a.key, region: a.region, value: round4(a.value), miss: round4(a.miss) }))
    .sort((a, b) => b.miss - a.miss)

  return {
    role: opts.role,
    presetId: opts.presetId,
    lossVersion: RETARGET_LOSS_VERSION,
    budget,
    population,
    seed,
    renders,
    cacheHits,
    beforeParams,
    afterParams,
    before: { features: beforeFeatures, loss: beforeLoss },
    after: { features: afterFeatures, loss: afterLoss },
    moved: paramDiff(defs, start, best.genome),
    curve,
    unreachable,
    elapsedSeconds: Math.round((Date.now() - t0) / 100) / 10,
    afterAudio,
    beforeAudio,
  }
}

/** The human summary the runner prints per preset. */
export function formatRetargetReport(r: RetargetResult): string {
  const lines: string[] = []
  lines.push(
    `${r.presetId} (${r.role}): ${r.before.loss.hit}/${r.before.loss.of} -> ${r.after.loss.hit}/${r.after.loss.of} targets hit, ` +
      `loss ${r.before.loss.total.toFixed(4)} -> ${r.after.loss.total.toFixed(4)} ` +
      `(gap ${r.before.loss.gap.toFixed(4)} -> ${r.after.loss.gap.toFixed(4)}) in ${r.renders} renders / ${r.elapsedSeconds}s`,
  )
  if (r.moved.length > 0) {
    lines.push(`  moved: ${r.moved.slice(0, 8).map((m) => `${m.field} ${m.from}->${m.to}`).join(', ')}${r.moved.length > 8 ? `, +${r.moved.length - 8} more` : ''}`)
  } else {
    lines.push('  moved: nothing — the preset was already the local optimum')
  }
  if (r.unreachable.length > 0) {
    lines.push(`  UNREACHED: ${r.unreachable.map((u) => `${u.key} ${u.region} (at ${u.value}, ${u.miss.toFixed(2)} scale units out)`).join('; ')}`)
  }
  return lines.join('\n')
}
