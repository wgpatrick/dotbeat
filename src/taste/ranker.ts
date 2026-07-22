// The v0 taste model (docs/taste-loop-design.md L3): a regularized logistic Bradley-Terry
// ranker over per-variant feature vectors. Deliberately tiny — the research base
// (docs/research/107-taste-model-program.md Part 1) says the sample-efficient regime wants a
// low-capacity model over few features, trained on pairwise comparisons decomposed from the
// score log's ranked picks (Plackett-Luce top-k -> pairwise: each pick beats every lower pick
// and every rejected variant).
//
// Standardization is WITHIN-BATCH by design: render metrics are only comparable inside one
// batch (render nondeterminism, docs/render-determinism.md), and a taste judgment is itself a
// within-batch act — "the darkest of these nine", not "darker than last week's". z-scoring each
// batch also makes the learned weights read directly as taste directions ("negative on
// centroidLog2 = picks darker variants").

import { FEATURE_KEYS, type FeatureVector } from './features.js'

export interface TrainPair {
  /** standardized feature vector of the preferred variant */
  winner: number[]
  /** standardized feature vector of the non-preferred variant */
  loser: number[]
}

/** z-score each COLUMN across a set of row vectors; a column with zero variance (nothing to
 * distinguish) maps to 0 for every row. Generic — DSP features and PCA'd embeddings both pass
 * through here, so "standardized within the batch" means the same thing for every feature set. */
export function zScoreColumns(rows: number[][]): number[][] {
  const n = rows.length
  if (n === 0) return []
  const dims = rows[0]!.length
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(dims).fill(0))
  for (let d = 0; d < dims; d++) {
    let mean = 0
    for (const r of rows) mean += r[d]!
    mean /= n
    let variance = 0
    for (const r of rows) variance += (r[d]! - mean) ** 2
    const std = Math.sqrt(variance / n)
    if (std > 1e-9) {
      for (let i = 0; i < n; i++) out[i]![d] = (rows[i]![d]! - mean) / std
    }
  }
  return out
}

/** z-score each DSP feature across the batch's variants, in FEATURE_KEYS order. */
export function standardizeBatch(vectors: FeatureVector[]): number[][] {
  return zScoreColumns(vectors.map((v) => FEATURE_KEYS.map((k) => v[k])))
}

/** Decompose one scored batch into pairwise comparisons: picks (already rank-ordered, best
 * first) beat later picks and every rejected variant. `byFile` maps a variant's manifest file
 * name to its standardized vector — variants without features are simply skipped, so a
 * partially-rendered batch still yields the pairs it can support. */
export function pairsFromRanking(pickFiles: string[], rejectedFiles: string[], byFile: Map<string, number[]>): TrainPair[] {
  const pairs: TrainPair[] = []
  for (let i = 0; i < pickFiles.length; i++) {
    const winner = byFile.get(pickFiles[i]!)
    if (winner === undefined) continue
    for (let j = i + 1; j < pickFiles.length; j++) {
      const loser = byFile.get(pickFiles[j]!)
      if (loser !== undefined) pairs.push({ winner, loser })
    }
    for (const rej of rejectedFiles) {
      const loser = byFile.get(rej)
      if (loser !== undefined) pairs.push({ winner, loser })
    }
  }
  return pairs
}

export interface BTModel {
  weights: number[]
  /** mean per-pair negative log-likelihood at the end of training (0.693 = coin flip). */
  finalLoss: number
  pairCount: number
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))

/** Full-batch gradient descent on the Bradley-Terry logistic loss with L2 regularization.
 * 13 dims x a few hundred pairs trains in well under a millisecond — retrain-per-invocation is
 * the intended usage, no persistence layer needed yet. */
export function trainBT(pairs: TrainPair[], opts: { l2?: number; iterations?: number; learningRate?: number } = {}): BTModel {
  // dims come from the data — the same trainer serves the 13-dim DSP model, PCA'd embeddings,
  // and their concatenation (taste-eval's T2 ablation).
  const dims = pairs.length > 0 ? pairs[0]!.winner.length : FEATURE_KEYS.length
  const l2 = opts.l2 ?? 0.05
  const iterations = opts.iterations ?? 500
  const learningRate = opts.learningRate ?? 0.5
  const w = new Array<number>(dims).fill(0)
  if (pairs.length === 0) return { weights: w, finalLoss: Math.LN2, pairCount: 0 }
  const diffs = pairs.map((p) => p.winner.map((x, d) => x - p.loser[d]!))
  let loss = Math.LN2
  for (let it = 0; it < iterations; it++) {
    const grad = new Array<number>(dims).fill(0)
    loss = 0
    for (const diff of diffs) {
      let z = 0
      for (let d = 0; d < dims; d++) z += w[d]! * diff[d]!
      const p = sigmoid(z)
      loss += -Math.log(Math.max(p, 1e-12))
      const g = p - 1 // d(-log sigmoid(z))/dz
      for (let d = 0; d < dims; d++) grad[d] = grad[d]! + g * diff[d]!
    }
    for (let d = 0; d < dims; d++) {
      grad[d] = grad[d]! / diffs.length + l2 * w[d]!
      w[d] = w[d]! - learningRate * grad[d]!
    }
    loss = loss / diffs.length
  }
  return { weights: w, finalLoss: loss, pairCount: pairs.length }
}

/** Utility score of one standardized vector under a trained model (higher = more preferred). */
export function scoreVector(model: BTModel, vector: number[]): number {
  let z = 0
  for (let d = 0; d < vector.length; d++) z += model.weights[d]! * vector[d]!
  return z
}

/** The taste directions a trained model implies, largest-magnitude first — the explainability
 * payoff of a linear model over interpretable features ("you keep picking darker, wider
 * variants"). */
export function describeWeights(model: BTModel, top = 5): { feature: string; weight: number }[] {
  return FEATURE_KEYS.map((feature, d) => ({ feature, weight: model.weights[d]! }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, top)
}

// ---- Bootstrap-ensemble BT with pessimistic scoring (docs/research/117; T5 step-3) -----------
//
// The v0 logistic BT above is a POINT estimate — one weight vector, no notion of how much the
// data actually pins it down. T5's designed pessimistic scoring ("mean − β·std", the one
// Goodhart-containment safeguard research/117 rates load-bearing AND currently unbuildable) needs
// a real uncertainty estimate: disagreement across an ensemble, per Coste et al. (ICLR 2024),
// whose uncertainty-weighted objective "practically eliminates overoptimization". A bootstrap
// ensemble supplies exactly that — N models each trained on a resample (with replacement) of the
// pair set; where the pairs constrain the taste direction the members agree (low std), and where
// they don't (the gen subspace the critic is blind on — 0% top-1) they scatter (high std), so
// pessimism automatically discounts those regions.

/** A deterministic bootstrap ensemble of BT heads. `members` are trained on independent
 * with-replacement resamples of the pair set; `seed` and `n` are recorded so the ensemble is
 * fully reproducible from the training pairs alone. */
export interface BTEnsemble {
  members: BTModel[]
  seed: number
  n: number
}

/** Local mulberry32 — the same generator eval.ts exports, duplicated here so the ranker stays a
 * leaf module (eval.ts imports ranker.ts, not the reverse; importing back would cycle). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Train an N-member bootstrap ensemble of BT heads. Each member resamples the pair set WITH
 * replacement (a bootstrap, not a subsample — same size, ~63% distinct pairs per member), seeded
 * deterministically so the same pairs+opts always yield the same ensemble. Trainer opts (l2,
 * iterations, learningRate) pass straight through to trainBT, so an ensemble member is exactly a
 * v0 model fit on a resample. An empty pair set yields N zero-weight members (std 0 everywhere —
 * honest: no data, no disagreement to report). */
export function trainBTEnsemble(
  pairs: TrainPair[],
  opts: { n?: number; seed?: number; l2?: number; iterations?: number; learningRate?: number } = {},
): BTEnsemble {
  const n = opts.n ?? 20
  const seed = opts.seed ?? 12345
  const { l2, iterations, learningRate } = opts
  const trainOpts = {
    ...(l2 !== undefined ? { l2 } : {}),
    ...(iterations !== undefined ? { iterations } : {}),
    ...(learningRate !== undefined ? { learningRate } : {}),
  }
  const members: BTModel[] = []
  // One RNG advanced across all members so member resamples never collide, yet the whole ensemble
  // is a pure function of (pairs, n, seed).
  const rng = mulberry32(seed)
  const m = pairs.length
  for (let i = 0; i < n; i++) {
    if (m === 0) {
      members.push(trainBT([], trainOpts))
      continue
    }
    const resample: TrainPair[] = new Array<TrainPair>(m)
    for (let k = 0; k < m; k++) resample[k] = pairs[Math.floor(rng() * m)]!
    members.push(trainBT(resample, trainOpts))
  }
  return { members, seed, n }
}

/** Score one standardized vector under every ensemble member; return the mean utility and the
 * population standard deviation of the members' scores (the uncertainty estimate). std is 0 when
 * the members agree exactly (an empty ensemble, or a vector every member scores identically). */
export function scoreVectorEnsemble(ensemble: BTEnsemble, vector: number[]): { mean: number; std: number } {
  const scores = ensemble.members.map((mem) => scoreVector(mem, vector))
  if (scores.length === 0) return { mean: 0, std: 0 }
  const mean = scores.reduce((s, x) => s + x, 0) / scores.length
  const variance = scores.reduce((s, x) => s + (x - mean) ** 2, 0) / scores.length
  return { mean, std: Math.sqrt(variance) }
}

/** Pessimistic score: ensemble mean − β·std (Coste et al. uncertainty-weighted objective, T5
 * step 3). β=0 recovers the plain ensemble mean; β>0 penalizes vectors the ensemble disagrees on,
 * so a high-uncertainty candidate must have a clearly higher mean to outrank a confident one —
 * "don't sprint into regions the critic knows nothing about" (docs/taste-loop-design.md L4). */
export function pessimisticScore(ensemble: BTEnsemble, vector: number[], beta = 1): number {
  const { mean, std } = scoreVectorEnsemble(ensemble, vector)
  return mean - beta * std
}
