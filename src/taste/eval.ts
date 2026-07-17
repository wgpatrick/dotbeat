// The taste-eval harness (docs/taste-loop-design.md L1): the ONE evaluation every taste-model
// claim must reduce to. Leave-one-batch-out over the scores log: train a scorer on every other
// batch's comparisons, ask it to rank the held-out batch, compare with the human's actual picks.
// Reference scorers ship built in — `random` (the honesty floor) and `dsp-bt` (the v0
// Bradley-Terry model over DSP features) — so "the taste model works" is always a statement
// relative to chance on the same data.
//
// Feature sourcing is two-tier: entries written after the T0 enrichment carry per-variant
// features inline (durable — batch dirs get deleted); older entries are backfilled lazily from
// their batch dir's renders when those still exist. Batches with fewer than 2 featured variants
// or no featured pick can't support a held-out test and are reported as skipped, never silently
// dropped.

import { readFileSync, existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { computeBatchFeatures, type FeatureVector } from './features.js'
import { pairsFromRanking, standardizeBatch, trainBT, scoreVector, describeWeights, type TrainPair, type BTModel } from './ranker.js'

export interface TasteBatch {
  /** batch dir as recorded in the log entry */
  dir: string
  group: string
  track?: string
  /** manifest `file` names of the ranked picks, best first */
  picks: string[]
  rejected: string[]
  /** feature vectors keyed by variant file, for every variant that has one */
  features: Record<string, FeatureVector>
  /** true when features came from the log entry itself rather than a lazy backfill */
  featuresStored: boolean
}

export interface LoadResult {
  batches: TasteBatch[]
  /** batches present in the log but unusable, with the reason */
  skipped: { dir: string; group: string; reason: string }[]
  /** Pilot 108: earlier entries superseded by a later re-score of the same batch dir — one human
   * judgment per batch, the LATEST wins. Counting a contradictory re-score as an extra eval fold
   * silently corrupted the harness (a 4-batch log reported 5 usable batches). */
  superseded: number
}

interface RawEntry {
  batch?: string
  group?: string
  track?: string
  picks?: { rank: number; variant: string }[]
  rejected?: string[]
  features?: Record<string, FeatureVector>
}

/** Parse the scores log and resolve per-variant features (stored, else lazily derived from the
 * batch dir's renders). Tolerant of the log's other entry shapes — anything without picks is
 * ignored, matching parseScoresLog's stance. */
export function loadTasteBatches(logPath: string): LoadResult {
  const batches: TasteBatch[] = []
  const skipped: LoadResult['skipped'] = []
  let superseded = 0
  let text: string
  try {
    text = readFileSync(logPath, 'utf8')
  } catch {
    return { batches, skipped, superseded }
  }
  // Pilot 108: one judgment per batch — a re-score supersedes earlier entries for the same batch
  // dir (the append-only log keeps them; the harness must not count them as extra folds).
  const rawEntries: RawEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      rawEntries.push(JSON.parse(trimmed) as RawEntry)
    } catch {
      continue
    }
  }
  const latestByBatch = new Map<string, RawEntry>()
  for (const raw of rawEntries) {
    if (typeof raw.batch !== 'string' || !Array.isArray(raw.picks) || raw.picks.length === 0) continue
    if (latestByBatch.has(raw.batch)) superseded += 1
    latestByBatch.set(raw.batch, raw)
  }
  for (const [batchDir, raw] of latestByBatch) {
    const picks = [...raw.picks!].sort((a, b) => a.rank - b.rank).map((p) => p.variant)
    const rejected = Array.isArray(raw.rejected) ? raw.rejected : []
    const allFiles = [...picks, ...rejected]
    let features = raw.features
    let featuresStored = true
    if (features === undefined) {
      featuresStored = false
      features = existsSync(batchDir) ? computeBatchFeatures(batchDir, allFiles) : {}
    }
    const featured = allFiles.filter((f) => features![f] !== undefined)
    const batch: TasteBatch = {
      dir: batchDir,
      group: raw.group ?? '?',
      ...(raw.track !== undefined ? { track: raw.track } : {}),
      picks,
      rejected,
      features,
      featuresStored,
    }
    if (featured.length < 2) {
      skipped.push({ dir: batchDir, group: batch.group, reason: featuresStored ? 'fewer than 2 variants carry features' : 'no renders found to derive features from (batch dir deleted or never rendered)' })
      continue
    }
    if (features[picks[0]!] === undefined) {
      skipped.push({ dir: batchDir, group: batch.group, reason: 'the rank-1 pick has no features (its render is missing)' })
      continue
    }
    batches.push(batch)
  }
  return { batches, skipped, superseded }
}

/** A scorer ranks one held-out batch given every other batch as training data. Returns a score
 * per variant file (higher = predicted more preferred). */
export type Scorer = (heldOut: TasteBatch, trainingBatches: TasteBatch[], rng: () => number) => Record<string, number>

/** Deterministic RNG (mulberry32) so eval runs are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standardized vectors for one batch, keyed by variant file. */
function standardizedByFile(batch: TasteBatch): Map<string, number[]> {
  const files = Object.keys(batch.features)
  const standardized = standardizeBatch(files.map((f) => batch.features[f]!))
  return new Map(files.map((f, i) => [f, standardized[i]!]))
}

function trainingPairs(batches: TasteBatch[]): TrainPair[] {
  const pairs: TrainPair[] = []
  for (const b of batches) pairs.push(...pairsFromRanking(b.picks, b.rejected, standardizedByFile(b)))
  return pairs
}

/** Train the v0 DSP Bradley-Terry model on a set of batches (the whole log, for reporting the
 * current taste directions; a leave-one-out subset inside the harness). */
export function trainOnBatches(batches: TasteBatch[]): BTModel {
  return trainBT(trainingPairs(batches))
}

export const SCORERS: Record<string, Scorer> = {
  random: (heldOut, _training, rng) => Object.fromEntries(Object.keys(heldOut.features).map((f) => [f, rng()])),
  'dsp-bt': (heldOut, training) => {
    const model = trainOnBatches(training)
    const byFile = standardizedByFile(heldOut)
    return Object.fromEntries([...byFile].map(([f, vec]) => [f, scoreVector(model, vec)]))
  },
}

export interface ScorerReport {
  scorer: string
  batches: number
  /** fraction of held-out batches whose rank-1 pick the scorer ranked first */
  top1: number
  /** fraction whose rank-1 pick landed in the scorer's top 3 */
  top3: number
  /** fraction of the held-out batches' implied pairwise comparisons ordered correctly */
  pairwise: number
  pairCount: number
  /** analytic chance floors given each batch's own variant count */
  chanceTop1: number
  chanceTop3: number
}

export interface EvalReport {
  logPath: string
  usable: number
  skipped: LoadResult['skipped']
  /** earlier entries superseded by re-scores of the same batch (latest wins) */
  superseded: number
  storedFeatureBatches: number
  scorers: ScorerReport[]
  /** taste directions from the model trained on ALL usable batches */
  weights: { feature: string; weight: number }[]
  trainedPairCount: number
}

/** Leave-one-batch-out evaluation of every scorer over the log. */
export function evaluate(logPath: string, opts: { seed?: number } = {}): EvalReport {
  const { batches, skipped, superseded } = loadTasteBatches(logPath)
  const rng = mulberry32(opts.seed ?? 41)
  const reports: ScorerReport[] = []
  for (const [name, scorer] of Object.entries(SCORERS)) {
    let top1 = 0
    let top3 = 0
    let pairsRight = 0
    let pairCount = 0
    let chanceTop1 = 0
    let chanceTop3 = 0
    for (let i = 0; i < batches.length; i++) {
      const heldOut = batches[i]!
      const training = batches.filter((_, j) => j !== i)
      const scores = scorer(heldOut, training, rng)
      const rankedFiles = Object.keys(scores).sort((a, b) => scores[b]! - scores[a]!)
      const target = heldOut.picks[0]!
      if (rankedFiles[0] === target) top1 += 1
      if (rankedFiles.slice(0, 3).includes(target)) top3 += 1
      const n = rankedFiles.length
      chanceTop1 += 1 / n
      chanceTop3 += Math.min(3, n) / n
      // pairwise: every implied comparison whose two sides both have scores
      for (let wi = 0; wi < heldOut.picks.length; wi++) {
        const w = heldOut.picks[wi]!
        if (scores[w] === undefined) continue
        const losers = [...heldOut.picks.slice(wi + 1), ...heldOut.rejected].filter((f) => scores[f] !== undefined)
        for (const l of losers) {
          pairCount += 1
          if (scores[w]! > scores[l]!) pairsRight += 1
        }
      }
    }
    const n = Math.max(1, batches.length)
    reports.push({
      scorer: name,
      batches: batches.length,
      top1: top1 / n,
      top3: top3 / n,
      pairwise: pairCount === 0 ? 0 : pairsRight / pairCount,
      pairCount,
      chanceTop1: chanceTop1 / n,
      chanceTop3: chanceTop3 / n,
    })
  }
  const fullModel = trainOnBatches(batches)
  return {
    logPath,
    usable: batches.length,
    skipped,
    superseded,
    storedFeatureBatches: batches.filter((b) => b.featuresStored).length,
    scorers: reports,
    weights: describeWeights(fullModel),
    trainedPairCount: fullModel.pairCount,
  }
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`

/** Human-facing report, honest about sample size and chance floors. */
export function formatEvalReport(r: EvalReport): string {
  let out = `taste-eval over ${basename(r.logPath)} (${dirname(resolve(r.logPath))})\n`
  out += `usable batches: ${r.usable} (${r.storedFeatureBatches} with stored features, ${r.usable - r.storedFeatureBatches} lazily derived)`
  out += r.skipped.length > 0 ? `; skipped: ${r.skipped.length}` : ''
  out += r.superseded > 0 ? `; ${r.superseded} earlier re-score${r.superseded === 1 ? '' : 's'} superseded (latest entry per batch wins)\n` : '\n'
  for (const s of r.skipped) out += `  skipped ${s.dir} (${s.group}): ${s.reason}\n`
  if (r.usable === 0) {
    out += 'nothing to evaluate yet — score some rendered batches first (beat vary ... --render, then beat score)\n'
    return out
  }
  out += `held-out prediction (leave-one-batch-out, ${r.usable} folds):\n`
  for (const s of r.scorers) {
    out += `  ${s.scorer.padEnd(8)} top-1 ${pct(s.top1)} (chance ${pct(s.chanceTop1)})  top-3 ${pct(s.top3)} (chance ${pct(s.chanceTop3)})  pairwise ${pct(s.pairwise)} of ${s.pairCount} (chance 50%)\n`
  }
  if (r.trainedPairCount > 0) {
    out += `taste directions (BT weights over all ${r.trainedPairCount} pairs; sign = preferred direction of the z-scored feature):\n`
    for (const w of r.weights) out += `  ${w.weight >= 0 ? '+' : ''}${w.weight.toFixed(2)}  ${w.feature}\n`
  }
  if (r.usable < 10) out += `note: ${r.usable} batches is far below the ~10-30 the research base expects for usable signal — treat these numbers as smoke, not evidence (docs/research/107-taste-model-program.md)\n`
  return out
}
