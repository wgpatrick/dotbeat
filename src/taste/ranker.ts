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
