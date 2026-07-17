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
import { pairsFromRanking, standardizeBatch, zScoreColumns, trainBT, scoreVector, describeWeights, type TrainPair, type BTModel } from './ranker.js'
import { embedAudioFile, BeatEmbedError, fitPCA, projectPCA, type EmbedBackend } from './embeddings.js'

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
  /** T2: raw audio embeddings keyed by variant file (attachEmbeddings; only for batches whose
   * renders still exist — embeddings are cached next to the wavs, not in the log). */
  embeddings?: Record<string, number[]>
  /** transient: PCA-projected embeddings, filled by evaluate() once the PCA is fitted */
  embedProjected?: Map<string, number[]>
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

// ---- T2: embeddings (docs/taste-loop-design.md L1/T2) ------------------------------------------

export interface AttachEmbeddingsResult {
  /** batches that now carry embeddings for >=2 variants incl. the top pick */
  attached: number
  /** batches whose renders are gone or insufficient for embedding */
  missing: number
  /** set when the sidecar is unusable (missing deps/interpreter) — embed scorers are skipped */
  error?: string
}

/** Attach cached-or-computed audio embeddings to every batch whose renders still exist. A sidecar
 * dependency failure aborts the whole attachment with its message (one actionable note beats N
 * identical failures); per-file decode problems just leave that variant out. */
export async function attachEmbeddings(batches: TasteBatch[], opts: { backend?: EmbedBackend; model?: string } = {}): Promise<AttachEmbeddingsResult> {
  let attached = 0
  let missing = 0
  for (const b of batches) {
    if (!existsSync(b.dir)) {
      missing += 1
      continue
    }
    const embeddings: Record<string, number[]> = {}
    for (const file of Object.keys(b.features)) {
      const wav = file.endsWith('.wav') ? file : file.replace(/\.beat$/, '.wav')
      const wavPath = resolve(b.dir, wav)
      if (!existsSync(wavPath)) continue
      try {
        embeddings[file] = (await embedAudioFile(wavPath, opts)).embedding
      } catch (err) {
        if (err instanceof BeatEmbedError) return { attached, missing, error: err.message }
        throw err
      }
    }
    if (Object.keys(embeddings).length >= 2 && embeddings[b.picks[0]!] !== undefined) {
      b.embeddings = embeddings
      attached += 1
    } else {
      missing += 1
    }
  }
  return { attached, missing }
}

/** Fit the shared PCA on EVERY embedding in the log (unsupervised — no pick information touches
 * it, so fitting across folds is not label leakage; the design doc's "PCA on unlabeled variants")
 * and project each batch's embeddings. kMax caps the projected dimensionality. */
export function projectAllEmbeddings(batches: TasteBatch[], kMax = 16): number {
  const pooled: number[][] = []
  for (const b of batches) if (b.embeddings) pooled.push(...Object.values(b.embeddings))
  if (pooled.length < 2) return 0
  const pca = fitPCA(pooled, kMax)
  for (const b of batches) {
    if (!b.embeddings) continue
    b.embedProjected = new Map(Object.entries(b.embeddings).map(([f, vec]) => [f, projectPCA(pca, vec)]))
  }
  return pca.components.length
}

/** Per-batch model-input vectors for one feature set, z-scored within the batch. */
function vectorsFor(batch: TasteBatch, kind: 'dsp' | 'embed' | 'both'): Map<string, number[]> {
  if (kind === 'dsp') return standardizedByFile(batch)
  const files = [...(batch.embedProjected?.keys() ?? [])]
  const embedZ = zScoreColumns(files.map((f) => batch.embedProjected!.get(f)!))
  const embedByFile = new Map(files.map((f, i) => [f, embedZ[i]!]))
  if (kind === 'embed') return embedByFile
  // both: dsp z-scores concatenated with embed z-scores, only for files present in both sets
  const dspByFile = standardizedByFile(batch)
  const out = new Map<string, number[]>()
  for (const [f, embedVec] of embedByFile) {
    const dspVec = dspByFile.get(f)
    if (dspVec !== undefined) out.set(f, [...dspVec, ...embedVec])
  }
  return out
}

function btScorerFor(kind: 'dsp' | 'embed' | 'both'): Scorer {
  return (heldOut, training) => {
    const pairs: TrainPair[] = []
    for (const b of training) pairs.push(...pairsFromRanking(b.picks, b.rejected, vectorsFor(b, kind)))
    const model = trainBT(pairs)
    return Object.fromEntries([...vectorsFor(heldOut, kind)].map(([f, vec]) => [f, scoreVector(model, vec)]))
  }
}

export const SCORERS: Record<string, Scorer> = {
  random: (heldOut, _training, rng) => Object.fromEntries(Object.keys(heldOut.features).map((f) => [f, rng()])),
  'dsp-bt': btScorerFor('dsp'),
  'embed-bt': btScorerFor('embed'),
  'both-bt': btScorerFor('both'),
}

/** T2 leftover (roadmap): which kind of round produced a batch. Ablation splits key on this —
 * a taste model can be predictive on synth-param vary rounds and at chance on gen rounds (or
 * vice versa), and one pooled number hides that. Classification uses the manifest conventions:
 * `gen:<id>` groups are generation rounds (D21); track-bearing entries are vary rounds; a
 * trackless non-gen batch is a stitched clip-set (`beat audition <dir>`, any group name). */
export type VariantType = 'vary' | 'gen' | 'clip-set'
export function variantTypeOf(b: { group: string; track?: string }): VariantType {
  if (b.group.startsWith('gen:')) return 'gen'
  if (b.track !== undefined) return 'vary'
  return 'clip-set'
}

export interface ScorerSplit {
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

/** Splits with fewer batches than this are labeled smoke in text AND carry `smoke: true` in JSON
 * (pilot 110: script consumers shouldn't have to re-derive the threshold from the prose). */
export const SPLIT_SMOKE_MIN_BATCHES = 5

export interface ScorerReport extends ScorerSplit {
  scorer: string
  /** per-variant-type split of the SAME folds (same trained models — each fold's outcome is
   * attributed to its held-out batch's type). Present only when the log spans >1 type. */
  byType?: (ScorerSplit & { type: VariantType; smoke: boolean })[]
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
  /** T2: embedding attachment outcome — absent when embeddings were turned off */
  embedding?: { backend: string; attached: number; missing: number; pcaDims: number; note?: string }
}

/** One held-out fold's raw outcome, attributed to its batch's variant type for the splits. */
interface FoldOutcome {
  type: VariantType
  top1Hit: boolean
  top3Hit: boolean
  pairsRight: number
  pairCount: number
  chanceTop1: number
  chanceTop3: number
}

function aggregateFolds(folds: FoldOutcome[]): ScorerSplit {
  const n = Math.max(1, folds.length)
  const pairCount = folds.reduce((s, f) => s + f.pairCount, 0)
  const pairsRight = folds.reduce((s, f) => s + f.pairsRight, 0)
  return {
    batches: folds.length,
    top1: folds.filter((f) => f.top1Hit).length / n,
    top3: folds.filter((f) => f.top3Hit).length / n,
    pairwise: pairCount === 0 ? 0 : pairsRight / pairCount,
    pairCount,
    chanceTop1: folds.reduce((s, f) => s + f.chanceTop1, 0) / n,
    chanceTop3: folds.reduce((s, f) => s + f.chanceTop3, 0) / n,
  }
}

/** One scorer's leave-one-batch-out pass over its eligible batches. Every fold's outcome is also
 * attributed to the held-out batch's variant type; the per-type splits aggregate the SAME folds
 * (same trained models), so overall numbers are exactly the weighted union of the splits. */
function runScorer(name: string, scorer: Scorer, batches: TasteBatch[], rng: () => number): ScorerReport {
  const folds: FoldOutcome[] = []
  for (let i = 0; i < batches.length; i++) {
    const heldOut = batches[i]!
    const training = batches.filter((_, j) => j !== i)
    const scores = scorer(heldOut, training, rng)
    const rankedFiles = Object.keys(scores).sort((a, b) => scores[b]! - scores[a]!)
    const target = heldOut.picks[0]!
    const n = Math.max(1, rankedFiles.length)
    let pairsRight = 0
    let pairCount = 0
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
    folds.push({
      type: variantTypeOf(heldOut),
      top1Hit: rankedFiles[0] === target,
      top3Hit: rankedFiles.slice(0, 3).includes(target),
      pairsRight,
      pairCount,
      chanceTop1: 1 / n,
      chanceTop3: Math.min(3, n) / n,
    })
  }
  const types = [...new Set(folds.map((f) => f.type))]
  const report: ScorerReport = { scorer: name, ...aggregateFolds(folds) }
  if (types.length > 1) {
    report.byType = types
      .sort()
      .map((type) => {
        const split = aggregateFolds(folds.filter((f) => f.type === type))
        return { type, ...split, smoke: split.batches < SPLIT_SMOKE_MIN_BATCHES }
      })
  }
  return report
}

export interface EvaluateOptions {
  seed?: number
  /** 'off' skips embeddings entirely; default 'clap' degrades to a note when the sidecar can't run */
  embedBackend?: EmbedBackend | 'off'
  embedModel?: string
}

/** Leave-one-batch-out evaluation of every scorer over the log. The embed/both scorers run only
 * over batches whose renders still exist (embeddings live next to the wavs, not in the log), so
 * their `batches` count can be smaller than dsp-bt's — the report says so rather than hiding it. */
export async function evaluate(logPath: string, opts: EvaluateOptions = {}): Promise<EvalReport> {
  const { batches, skipped, superseded } = loadTasteBatches(logPath)
  const rng = mulberry32(opts.seed ?? 41)
  const reports: ScorerReport[] = []

  let embedding: EvalReport['embedding']
  const embedBackend = opts.embedBackend ?? 'clap'
  if (embedBackend !== 'off' && batches.length > 0) {
    const attach = await attachEmbeddings(batches, { backend: embedBackend, model: opts.embedModel })
    const pcaDims = attach.error === undefined ? projectAllEmbeddings(batches) : 0
    embedding = { backend: embedBackend, attached: attach.attached, missing: attach.missing, pcaDims, ...(attach.error !== undefined ? { note: attach.error } : {}) }
  }

  const embedBatches = batches.filter((b) => b.embedProjected !== undefined)
  reports.push(runScorer('random', SCORERS.random!, batches, rng))
  reports.push(runScorer('dsp-bt', SCORERS['dsp-bt']!, batches, rng))
  if (embedBatches.length >= 2) {
    reports.push(runScorer('embed-bt', SCORERS['embed-bt']!, embedBatches, rng))
    reports.push(runScorer('both-bt', SCORERS['both-bt']!, embedBatches, rng))
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
    ...(embedding !== undefined ? { embedding } : {}),
  }
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`

/** Human-facing report, honest about sample size and chance floors. */
export function formatEvalReport(r: EvalReport): string {
  let out = `taste-eval over ${basename(r.logPath)} (${dirname(resolve(r.logPath))})\n`
  out += `usable batches: ${r.usable} (${r.storedFeatureBatches} with stored features, ${r.usable - r.storedFeatureBatches} lazily derived)`
  out += r.skipped.length > 0 ? `; skipped: ${r.skipped.length}` : ''
  out += r.superseded > 0 ? `; ${r.superseded} earlier re-score${r.superseded === 1 ? '' : 's'} superseded (latest entry per batch wins)\n` : '\n'
  if (r.embedding !== undefined) {
    if (r.embedding.note !== undefined) {
      out += `embeddings (${r.embedding.backend}): unavailable — ${r.embedding.note}\n`
    } else {
      out += `embeddings (${r.embedding.backend}): ${r.embedding.attached} batch${r.embedding.attached === 1 ? '' : 'es'} embedded (PCA -> ${r.embedding.pcaDims} dims)`
      out += r.embedding.missing > 0 ? `; ${r.embedding.missing} without renders to embed\n` : '\n'
    }
  }
  for (const s of r.skipped) out += `  skipped ${s.dir} (${s.group}): ${s.reason}\n`
  if (r.usable === 0) {
    out += 'nothing to evaluate yet — score some rendered batches first (beat vary ... --render, then beat score)\n'
    return out
  }
  out += `held-out prediction (leave-one-batch-out, ${r.usable} folds):\n`
  for (const s of r.scorers) {
    out += `  ${s.scorer.padEnd(8)} top-1 ${pct(s.top1)} (chance ${pct(s.chanceTop1)})  top-3 ${pct(s.top3)} (chance ${pct(s.chanceTop3)})  pairwise ${pct(s.pairwise)} of ${s.pairCount} (chance 50%)\n`
    for (const t of s.byType ?? []) {
      out += `    ${t.type.padEnd(9)} (${t.batches} batch${t.batches === 1 ? '' : 'es'}) top-1 ${pct(t.top1)} (chance ${pct(t.chanceTop1)})  top-3 ${pct(t.top3)} (chance ${pct(t.chanceTop3)})  pairwise ${pct(t.pairwise)} of ${t.pairCount}${t.smoke ? '  [small split — smoke, not evidence]' : ''}\n`
    }
  }
  if (r.trainedPairCount > 0) {
    out += `taste directions (BT weights over all ${r.trainedPairCount} pairs; sign = preferred direction of the z-scored feature):\n`
    for (const w of r.weights) out += `  ${w.weight >= 0 ? '+' : ''}${w.weight.toFixed(2)}  ${w.feature}\n`
  }
  if (r.usable < 10) out += `note: ${r.usable} batches is far below the ~10-30 the research base expects for usable signal — treat these numbers as smoke, not evidence (docs/research/107-taste-model-program.md)\n`
  return out
}
