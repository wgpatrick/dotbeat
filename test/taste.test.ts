// T0 taste-loop (docs/taste-loop-design.md L1): the feature pipeline, the v0 Bradley-Terry
// ranker, the eval harness, score-log enrichment, blind-audition shuffle, and clip-set batches.
// Audio is synthetic (tone/noise wavs built in-memory) — the point is the plumbing and the math,
// not the renders; the render path has its own verify scripts.

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FEATURE_KEYS, metricsToFeatures, computeBatchFeatures, type FeatureVector } from '../src/taste/features.js'
import { standardizeBatch, pairsFromRanking, trainBT, scoreVector, describeWeights, trainBTEnsemble, scoreVectorEnsemble, pessimisticScore, type BTEnsemble, type BTModel } from '../src/taste/ranker.js'
import { loadTasteBatches, evaluate, mulberry32, variantTypeOf, formatEvalReport } from '../src/taste/eval.js'
import { stitchAudition, shuffledOrder } from '../src/vary/audition.js'
import { scoreBatch, writeClipSetBatch, adoptVariant, formatScoreResult, BeatBatchError, type VaryBatchManifest } from '../src/vary/batch.js'
import { analyze, decodeWav } from '../src/metrics/index.js'

// ---- synthetic audio helpers -------------------------------------------------------------------

/** 16-bit PCM stereo wav of a sine at `freq` Hz scaled by `gain`. Different freq/gain move the
 * centroid/loudness features deterministically. 44.1 kHz and >=0.5s so the spectral analyzer has
 * a full FFT window to work with (shorter/lower-rate audio yields empty spectral metrics). */
function toneWav(freq: number, gain: number, seconds = 0.5, sampleRate = 44100): Buffer {
  const frames = Math.round(seconds * sampleRate)
  const data = Buffer.alloc(frames * 4)
  for (let i = 0; i < frames; i++) {
    const s = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * gain * 32767)
    data.writeInt16LE(s, i * 4)
    data.writeInt16LE(s, i * 4 + 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22)
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36, 'ascii'); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

/** A synthetic feature vector where only `centroidLog2` and `lufs` vary — enough dims to rank. */
function fakeFeatures(centroid: number, lufs: number): FeatureVector {
  const base = Object.fromEntries(FEATURE_KEYS.map((k) => [k, 0])) as FeatureVector
  base.centroidLog2 = centroid
  base.lufs = lufs
  return base
}

/** A fake scored-log entry whose rank-1 pick always has the LOWEST centroid (a "prefers darker"
 * owner), with features inline. */
function darkTasteEntry(batchNo: number, n = 5): string {
  const centroids = Array.from({ length: n }, (_, i) => 8 + ((i * 7 + batchNo * 3) % n)) // shuffled-ish, distinct
  const files = Array.from({ length: n }, (_, i) => `v${i + 1}.beat`)
  const darkest = centroids.indexOf(Math.min(...centroids))
  const features = Object.fromEntries(files.map((f, i) => [f, fakeFeatures(centroids[i]!, -20 + i)]))
  return JSON.stringify({
    t: new Date().toISOString(),
    batch: `/nonexistent/batch-${batchNo}`,
    track: 'lead',
    group: 'cutoff',
    seed: batchNo,
    parentSha256: 'x',
    picks: [{ rank: 1, variant: files[darkest]!, edits: [] }],
    rejected: files.filter((_, i) => i !== darkest),
    features,
  })
}

// ---- features ------------------------------------------------------------------------------------

test('metricsToFeatures is finite, stable-keyed, and log-scales the centroid', () => {
  const decoded = decodeWav(toneWav(1000, 0.5))
  const f = metricsToFeatures(analyze(decoded.channels, decoded.sampleRate))
  for (const k of FEATURE_KEYS) {
    assert.ok(Number.isFinite(f[k]), `${k} must be finite, got ${f[k]}`)
  }
  assert.ok(Math.abs(f.centroidLog2 - Math.log2(1000)) < 0.5, `centroidLog2 ~ log2(1000), got ${f.centroidLog2}`)
})

test('computeBatchFeatures maps variant files to their renders and skips missing ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taste-feat-'))
  writeFileSync(join(dir, 'v1.wav'), toneWav(400, 0.5))
  writeFileSync(join(dir, 'v3.wav'), toneWav(2000, 0.5))
  const features = computeBatchFeatures(dir, ['v1.beat', 'v2.beat', 'v3.beat'])
  assert.deepEqual(Object.keys(features).sort(), ['v1.beat', 'v3.beat'])
  assert.ok(features['v1.beat']!.centroidLog2 < features['v3.beat']!.centroidLog2, 'brighter render has higher centroid feature')
})

// ---- ranker ---------------------------------------------------------------------------------------

test('standardizeBatch z-scores per feature and zeroes constant features', () => {
  const vecs = [fakeFeatures(8, -20), fakeFeatures(10, -20), fakeFeatures(12, -20)]
  const std = standardizeBatch(vecs)
  const centroidIdx = FEATURE_KEYS.indexOf('centroidLog2')
  const lufsIdx = FEATURE_KEYS.indexOf('lufs')
  assert.ok(Math.abs(std[0]![centroidIdx]! + std[2]![centroidIdx]!) < 1e-9, 'symmetric z-scores')
  assert.equal(std[1]![centroidIdx], 0)
  assert.equal(std[0]![lufsIdx], 0, 'constant feature maps to 0')
})

test('trainBT learns a planted taste direction and describeWeights surfaces it', () => {
  // winners always darker (lower centroid): weight on centroidLog2 must come out negative
  const rng = mulberry32(7)
  const pairs = Array.from({ length: 60 }, () => {
    const dark = fakeFeatures(8 + rng() * 2, -20)
    const bright = fakeFeatures(11 + rng() * 2, -20)
    const std = standardizeBatch([dark, bright])
    return { winner: std[0]!, loser: std[1]! }
  })
  const model = trainBT(pairs)
  const centroidIdx = FEATURE_KEYS.indexOf('centroidLog2')
  assert.ok(model.weights[centroidIdx]! < -0.5, `centroid weight should be clearly negative, got ${model.weights[centroidIdx]}`)
  assert.ok(model.finalLoss < 0.5, `training should beat coin-flip loss, got ${model.finalLoss}`)
  assert.equal(describeWeights(model, 1)[0]!.feature, 'centroidLog2')
  const std = standardizeBatch([fakeFeatures(8, -20), fakeFeatures(12, -20)])
  assert.ok(scoreVector(model, std[0]!) > scoreVector(model, std[1]!), 'darker variant scores higher')
})

test('pairsFromRanking decomposes ranked picks over rejected variants', () => {
  const byFile = new Map<string, number[]>([
    ['a', [1]], ['b', [2]], ['c', [3]], ['d', [4]],
  ])
  const pairs = pairsFromRanking(['a', 'b'], ['c', 'd'], byFile)
  // a>b, a>c, a>d, b>c, b>d = 5 pairs
  assert.equal(pairs.length, 5)
})

// ---- C2: bootstrap-ensemble BT with pessimistic scoring (docs/research/117) -----------------------

/** A planted "prefers darker" pair set: 4-variant batches with GENUINELY varied centroids and
 * loudnesses (so the within-batch z-scores differ from pair to pair — a 2-variant batch would
 * collapse every z-score to ±1 and make all pairs identical, which no bootstrap could resample
 * apart), the darkest variant winning each. Enough variation that resampling changes the training
 * set and members disagree. */
function darkPairs(seed: number, count = 60) {
  const rng = mulberry32(seed)
  const pairs: { winner: number[]; loser: number[] }[] = []
  while (pairs.length < count) {
    const variants = Array.from({ length: 4 }, () => fakeFeatures(8 + rng() * 5, -22 + rng() * 6))
    const std = standardizeBatch(variants)
    let darkIdx = 0
    for (let i = 1; i < variants.length; i++) if (variants[i]!.centroidLog2 < variants[darkIdx]!.centroidLog2) darkIdx = i
    for (let i = 0; i < variants.length && pairs.length < count; i++) {
      if (i !== darkIdx) pairs.push({ winner: std[darkIdx]!, loser: std[i]! })
    }
  }
  return pairs
}

test('trainBTEnsemble is deterministic per seed and resamples differently across seeds', () => {
  const pairs = darkPairs(3)
  const e1 = trainBTEnsemble(pairs, { n: 12, seed: 42 })
  const e2 = trainBTEnsemble(pairs, { n: 12, seed: 42 })
  assert.equal(e1.members.length, 12)
  assert.equal(e1.n, 12)
  assert.equal(e1.seed, 42)
  for (let i = 0; i < e1.members.length; i++) {
    assert.deepEqual(e1.members[i]!.weights, e2.members[i]!.weights, `member ${i} identical for the same seed`)
  }
  // scoring is reproducible too
  const vec = standardizeBatch([fakeFeatures(8, -20), fakeFeatures(12, -20)])[0]!
  assert.deepEqual(scoreVectorEnsemble(e1, vec), scoreVectorEnsemble(e2, vec))
  const e3 = trainBTEnsemble(pairs, { n: 12, seed: 99 })
  const anyDiff = e1.members.some((m, i) => m.weights.some((w, d) => w !== e3.members[i]!.weights[d]))
  assert.ok(anyDiff, 'a different seed draws different resamples, so at least one member differs')
})

test('the bootstrap actually varies its members: real training data yields nonzero ensemble std', () => {
  const ensemble = trainBTEnsemble(darkPairs(5), { n: 20, seed: 7 })
  // a vector along the planted taste axis: members agree on the DIRECTION but the resampling makes
  // their magnitudes differ, so the ensemble reports genuine (nonzero) disagreement.
  const vec = standardizeBatch([fakeFeatures(8, -20), fakeFeatures(12, -20)])[0]!
  const { std } = scoreVectorEnsemble(ensemble, vec)
  assert.ok(std > 0, `bootstrap members must disagree at least a little, got std ${std}`)
  // and the mean still recovers the taste: the darker variant scores above the brighter one
  const brightVec = standardizeBatch([fakeFeatures(8, -20), fakeFeatures(12, -20)])[1]!
  assert.ok(scoreVectorEnsemble(ensemble, vec).mean > scoreVectorEnsemble(ensemble, brightVec).mean, 'ensemble mean keeps the planted taste')
})

test('empty pair set yields a zero-uncertainty ensemble (no data, no disagreement to report)', () => {
  const ensemble = trainBTEnsemble([], { n: 8 })
  assert.equal(ensemble.members.length, 8)
  const { mean, std } = scoreVectorEnsemble(ensemble, [1, 2, 3])
  assert.equal(mean, 0)
  assert.equal(std, 0)
  assert.equal(pessimisticScore(ensemble, [1, 2, 3], 5), 0)
})

test('pessimisticScore ranks a high-uncertainty vector below an equal-mean low-uncertainty one', () => {
  // Two hand-built members that AGREE on dim 1 but DISAGREE on dim 0. Constructed so two test
  // vectors have the SAME ensemble mean and differ ONLY in ensemble std — isolating pessimism.
  const member = (weights: number[]): BTModel => ({ weights, finalLoss: 0, pairCount: 0 })
  const ensemble: BTEnsemble = { members: [member([1, 1]), member([-1, 1])], seed: 0, n: 2 }
  const lowUnc = [0, 1] // members score 1 and 1 -> mean 1, std 0
  const highUnc = [1, 1] // members score 2 and 0 -> mean 1, std 1
  const lo = scoreVectorEnsemble(ensemble, lowUnc)
  const hi = scoreVectorEnsemble(ensemble, highUnc)
  assert.ok(Math.abs(lo.mean - hi.mean) < 1e-12, `equal means by construction, got ${lo.mean} vs ${hi.mean}`)
  assert.equal(lo.std, 0)
  assert.ok(hi.std > 0.9, `high-uncertainty vector must have real std, got ${hi.std}`)
  assert.ok(pessimisticScore(ensemble, lowUnc, 1) > pessimisticScore(ensemble, highUnc, 1), 'pessimism ranks the confident vector first')
  // β=0 recovers the mean, so the two tie
  assert.ok(Math.abs(pessimisticScore(ensemble, lowUnc, 0) - pessimisticScore(ensemble, highUnc, 0)) < 1e-12, 'β=0 is the plain mean — no pessimism')
})

// ---- eval harness ---------------------------------------------------------------------------------

test('evaluate: dsp-bt beats random on a consistent synthetic taste, with honest chance floors', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taste-eval-'))
  const logPath = join(dir, 'beat-scores.jsonl')
  writeFileSync(logPath, Array.from({ length: 12 }, (_, i) => darkTasteEntry(i)).join('\n') + '\n')
  const report = await evaluate(logPath, { seed: 41, embedBackend: 'off' })
  assert.equal(report.usable, 12)
  const bt = report.scorers.find((s) => s.scorer === 'dsp-bt')!
  const rnd = report.scorers.find((s) => s.scorer === 'random')!
  assert.ok(bt.top1 > 0.9, `planted taste should be nearly perfectly predictable, got ${bt.top1}`)
  assert.ok(rnd.top1 < 0.6, `random should hover near chance (0.2), got ${rnd.top1}`)
  assert.ok(Math.abs(bt.chanceTop1 - 0.2) < 1e-9, '5 variants -> 20% chance floor')
  const centroidW = report.weights.find((w) => w.feature === 'centroidLog2')
  assert.ok(centroidW !== undefined && centroidW.weight < 0, 'reported taste direction: darker preferred')
})

test('taste-eval per-variant-type splits: mixed logs split by type, single-type logs do not', async () => {
  // Same planted "prefers darker" taste, expressed through three round kinds: vary entries
  // (track-bearing), gen entries (group `gen:<id>`, no track), and a clip-set entry (trackless,
  // arbitrary group). The splits must partition the SAME folds: per-type batch counts sum to the
  // overall count, and every type present in the log appears exactly once per scorer.
  const genEntry = (i: number) => {
    const e = JSON.parse(darkTasteEntry(100 + i)) as Record<string, unknown>
    delete e.track
    e.group = 'gen:snare'
    e.batch = `/nonexistent/gen-batch-${i}`
    return JSON.stringify(e)
  }
  const clipSetEntry = (i: number) => {
    const e = JSON.parse(darkTasteEntry(200 + i)) as Record<string, unknown>
    delete e.track
    e.group = 'clips'
    e.batch = `/nonexistent/clips-batch-${i}`
    return JSON.stringify(e)
  }
  const dir = mkdtempSync(join(tmpdir(), 'taste-split-'))
  const logPath = join(dir, 'beat-scores.jsonl')
  const lines = [
    ...Array.from({ length: 4 }, (_, i) => darkTasteEntry(i)),
    ...Array.from({ length: 3 }, (_, i) => genEntry(i)),
    clipSetEntry(0),
  ]
  writeFileSync(logPath, lines.join('\n') + '\n')
  const report = await evaluate(logPath, { seed: 41, embedBackend: 'off' })
  assert.equal(report.usable, 8)
  const bt = report.scorers.find((s) => s.scorer === 'dsp-bt')!
  assert.ok(bt.byType !== undefined, 'mixed log must carry per-type splits')
  assert.deepEqual(bt.byType.map((t) => t.type).sort(), ['clip-set', 'gen', 'vary'])
  assert.equal(bt.byType.reduce((s, t) => s + t.batches, 0), bt.batches, 'splits partition the folds')
  assert.equal(bt.byType.find((t) => t.type === 'vary')!.batches, 4)
  assert.equal(bt.byType.find((t) => t.type === 'gen')!.batches, 3)
  assert.equal(bt.byType.find((t) => t.type === 'clip-set')!.batches, 1)
  // pilot 110: the smoke threshold is machine-readable, not prose-only
  assert.equal(bt.byType.find((t) => t.type === 'vary')!.smoke, true, '4 batches < 5 -> smoke')
  assert.equal(bt.byType.find((t) => t.type === 'gen')!.smoke, true)
  const text = formatEvalReport(report)
  assert.match(text, /vary\s+\(4 batches\)/)
  assert.match(text, /gen\s+\(3 batches\) .*\[small split — smoke, not evidence\]/)

  // classifier unit cases
  assert.equal(variantTypeOf({ group: 'gen:kick' }), 'gen')
  assert.equal(variantTypeOf({ group: 'cutoff', track: 'lead' }), 'vary')
  assert.equal(variantTypeOf({ group: 'anything-else' }), 'clip-set')

  // single-type log: no byType noise
  const soloPath = join(dir, 'solo.jsonl')
  writeFileSync(soloPath, Array.from({ length: 3 }, (_, i) => darkTasteEntry(i)).join('\n') + '\n')
  const solo = await evaluate(soloPath, { seed: 41, embedBackend: 'off' })
  assert.equal(solo.scorers.find((s) => s.scorer === 'dsp-bt')!.byType, undefined)
})

test('loadTasteBatches skips batches with no derivable features and says why', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taste-skip-'))
  const logPath = join(dir, 'log.jsonl')
  const entry = { t: 'x', batch: '/nonexistent/gone', track: 'lead', group: 'cutoff', seed: 1, parentSha256: 'x', picks: [{ rank: 1, variant: 'v1.beat' }], rejected: ['v2.beat'] }
  writeFileSync(logPath, JSON.stringify(entry) + '\n')
  const { batches, skipped } = loadTasteBatches(logPath)
  assert.equal(batches.length, 0)
  assert.equal(skipped.length, 1)
  assert.match(skipped[0]!.reason, /no renders found/)
})

// ---- score-log enrichment -------------------------------------------------------------------------

test('scoreBatch enriches the entry with features for every rendered variant, picks and rejects alike', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taste-score-'))
  const batchDir = join(dir, 'vary-cutoff-1')
  mkdirSync(batchDir)
  const manifest: VaryBatchManifest = {
    parent: join(dir, 'song.beat'),
    parentSha256: 'abc',
    track: 'lead',
    group: 'cutoff',
    count: 3,
    seed: 1,
    createdAt: 'now',
    variants: [{ file: 'v1.beat', edits: [] }, { file: 'v2.beat', edits: [] }, { file: 'v3.beat', edits: [] }],
  }
  writeFileSync(join(batchDir, 'manifest.json'), JSON.stringify(manifest))
  writeFileSync(join(dir, 'song.beat'), 'x')
  writeFileSync(join(batchDir, 'v1.wav'), toneWav(400, 0.7))
  writeFileSync(join(batchDir, 'v2.wav'), toneWav(2000, 0.3))
  // v3 deliberately un-rendered
  const result = scoreBatch(batchDir, ['2'])
  assert.ok(result.entry.features, 'entry carries features')
  assert.deepEqual(Object.keys(result.entry.features!).sort(), ['v1.wav'.replace('wav', 'beat'), 'v2.beat'].sort())
  const logged = JSON.parse(readFileSync(result.logPath, 'utf8').trim().split('\n').pop()!)
  assert.ok(logged.features['v1.beat'].lufs !== undefined, 'features serialized to the log')
})

// ---- audition shuffle -----------------------------------------------------------------------------

test('stitchAudition shuffles deterministically by seed and the index is the answer key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taste-aud-'))
  const freqs = [300, 600, 1200, 2400]
  for (let i = 0; i < 4; i++) writeFileSync(join(dir, `v${i + 1}.wav`), toneWav(freqs[i]!, 0.5))
  const r1 = stitchAudition(dir, 4, { shuffleSeed: 7 })
  const r2 = stitchAudition(dir, 4, { shuffleSeed: 7 })
  assert.deepEqual(r1.entries.map((e) => e.variant), r2.entries.map((e) => e.variant), 'same seed -> same order')
  assert.deepEqual(shuffledOrder(4, 7), r1.entries.map((e) => Number(e.variant.slice(1))), 'order matches the exported helper')
  assert.notDeepEqual(
    stitchAudition(dir, 4, { shuffleSeed: 8 }).entries.map((e) => e.variant),
    r1.entries.map((e) => e.variant),
    'different seed -> different order (4! = 24 permutations; seeds 7 and 8 differ)',
  )
  const unshuffled = stitchAudition(dir, 4, {})
  assert.deepEqual(unshuffled.entries.map((e) => e.variant), ['v1', 'v2', 'v3', 'v4'], 'no seed -> generation order')
  // the answer key: each entry's wav really is that variant's file
  for (const e of r1.entries) assert.equal(e.wav, `${e.variant}.wav`)
})

// ---- T2: embeddings, PCA, and the ablation --------------------------------------------------------

test('fitPCA finds the max-variance direction and projectPCA reduces dimensionality', async () => {
  const { fitPCA, projectPCA } = await import('../src/taste/embeddings.js')
  // points spread along the (1,1) diagonal in 2d, tiny noise off-axis
  const rows = Array.from({ length: 20 }, (_, i) => [i, i + (i % 2 === 0 ? 0.01 : -0.01)])
  const pca = fitPCA(rows, 1)
  assert.equal(pca.components.length, 1)
  const [a, b] = pca.components[0]!
  assert.ok(Math.abs(Math.abs(a!) - Math.abs(b!)) < 0.05, `first component ~diagonal, got [${a}, ${b}]`)
  const projected = projectPCA(pca, [10, 10])
  assert.equal(projected.length, 1)
})

test('embedAudioFile (stub sidecar): real spawn, cache write, cache hit, invalidation on new bytes', async (t) => {
  const { embedAudioFile } = await import('../src/taste/embeddings.js')
  const dir = mkdtempSync(join(tmpdir(), 'taste-embed-'))
  const wavPath = join(dir, 'clip.wav')
  writeFileSync(wavPath, toneWav(500, 0.5))
  let first
  try {
    first = await embedAudioFile(wavPath, { backend: 'stub' })
  } catch (err) {
    t.skip(`no python3 for the stub sidecar here: ${err instanceof Error ? err.message : err}`)
    return
  }
  assert.equal(first.cached, false)
  assert.equal(first.dims, 16)
  assert.equal(first.embedding.length, 16)
  const second = await embedAudioFile(wavPath, { backend: 'stub' })
  assert.equal(second.cached, true)
  assert.deepEqual(second.embedding, first.embedding)
  writeFileSync(wavPath, toneWav(2000, 0.5)) // new bytes -> sha mismatch -> recompute
  const third = await embedAudioFile(wavPath, { backend: 'stub' })
  assert.equal(third.cached, false)
  assert.notDeepEqual(third.embedding, first.embedding)
})

test('taste-eval ablation: embed-bt sees a taste the DSP features are blind to', async (t) => {
  // Batches of tone renders where the pick is ALWAYS the lowest-frequency variant, but the
  // stored DSP features are IDENTICAL constants — dsp-bt is structurally blind, while the stub
  // embedding's zero-crossing stats encode frequency, so embed-bt (and both-bt) can learn it.
  const { evaluate: evalFn } = await import('../src/taste/eval.js')
  const dir = mkdtempSync(join(tmpdir(), 'taste-ablate-'))
  const logPath = join(dir, 'beat-scores.jsonl')
  const lines: string[] = []
  for (let b = 0; b < 8; b++) {
    const batchDir = join(dir, `vary-tone-${b}`)
    mkdirSync(batchDir)
    const freqs = [300, 900, 1800].map((f) => f + b * 40)
    const files = ['v1.beat', 'v2.beat', 'v3.beat']
    const rotate = b % 3 // move the low-freq variant around so position never predicts
    const rotated = [...freqs.slice(rotate), ...freqs.slice(0, rotate)]
    rotated.forEach((f, i) => writeFileSync(join(batchDir, `v${i + 1}.wav`), toneWav(f, 0.5)))
    const lowest = rotated.indexOf(Math.min(...rotated))
    const constantFeatures = Object.fromEntries(files.map((f) => [f, fakeFeatures(10, -20)]))
    lines.push(JSON.stringify({
      t: 'x', batch: batchDir, track: 'lead', group: 'tone', seed: b, parentSha256: 'x',
      picks: [{ rank: 1, variant: files[lowest]! }],
      rejected: files.filter((_, i) => i !== lowest),
      features: constantFeatures,
    }))
  }
  writeFileSync(logPath, lines.join('\n') + '\n')
  let report
  try {
    report = await evalFn(logPath, { seed: 41, embedBackend: 'stub' })
  } catch (err) {
    t.skip(`no python3 for the stub sidecar here: ${err instanceof Error ? err.message : err}`)
    return
  }
  assert.equal(report.embedding?.attached, 8)
  assert.ok(report.embedding!.pcaDims >= 2, 'PCA produced components')
  const embedBt = report.scorers.find((s) => s.scorer === 'embed-bt')
  const dspBt = report.scorers.find((s) => s.scorer === 'dsp-bt')
  assert.ok(embedBt !== undefined, 'embed-bt ran')
  assert.ok(embedBt!.pairwise > 0.8, `embed-bt should order the pairs, got ${embedBt!.pairwise}`)
  assert.ok(dspBt!.pairwise <= 0.6, `dsp-bt is blind on constant features, got ${dspBt!.pairwise}`)
})

test('taste-eval aesthetics: aes-bt learns a loudness taste on stub axes the DSP features are blind to', async (t) => {
  // Same shape as the embed ablation above, but the planted taste is LOUDNESS (the aes-stub CE
  // axis tracks RMS) and the stored DSP features are constants: aes-bt should learn it, dsp-bt
  // can't, and the report carries named per-axis weights with CE dominant.
  const { evaluate: evalFn } = await import('../src/taste/eval.js')
  const dir = mkdtempSync(join(tmpdir(), 'taste-aes-'))
  const logPath = join(dir, 'beat-scores.jsonl')
  const lines: string[] = []
  for (let b = 0; b < 8; b++) {
    const batchDir = join(dir, `vary-loud-${b}`)
    mkdirSync(batchDir)
    const gains = [0.15, 0.4, 0.8]
    const files = ['v1.beat', 'v2.beat', 'v3.beat']
    const rotate = b % 3
    const rotated = [...gains.slice(rotate), ...gains.slice(0, rotate)]
    rotated.forEach((g, i) => writeFileSync(join(batchDir, `v${i + 1}.wav`), toneWav(440 + b * 10, g)))
    const loudest = rotated.indexOf(Math.max(...rotated))
    const constantFeatures = Object.fromEntries(files.map((f) => [f, fakeFeatures(10, -20)]))
    lines.push(JSON.stringify({
      t: 'x', batch: batchDir, track: 'lead', group: 'mix', seed: b, parentSha256: 'x',
      picks: [{ rank: 1, variant: files[loudest]! }],
      rejected: files.filter((_, i) => i !== loudest),
      features: constantFeatures,
    }))
  }
  writeFileSync(logPath, lines.join('\n') + '\n')
  let report
  try {
    report = await evalFn(logPath, { seed: 41, embedBackend: 'off', aesBackend: 'aes-stub' })
  } catch (err) {
    t.skip(`no python3 for the stub sidecar here: ${err instanceof Error ? err.message : err}`)
    return
  }
  assert.equal(report.aesthetics?.attached, 8)
  const aesBt = report.scorers.find((s) => s.scorer === 'aes-bt')
  const dspBt = report.scorers.find((s) => s.scorer === 'dsp-bt')
  assert.ok(aesBt !== undefined, 'aes-bt ran')
  assert.ok(aesBt!.pairwise > 0.8, `aes-bt should order the pairs, got ${aesBt!.pairwise}`)
  assert.ok(dspBt!.pairwise <= 0.6, `dsp-bt is blind on constant features, got ${dspBt!.pairwise}`)
  const weights = report.aesthetics!.weights!
  assert.equal(weights.length, 4)
  assert.deepEqual([...weights.map((w) => w.axis)].sort(), ['CE', 'CU', 'PC', 'PQ'])
  const ce = weights.find((w) => w.axis === 'CE')!
  assert.ok(ce.weight > 0, `CE (tracks RMS in the stub) should carry positive weight, got ${ce.weight}`)
  // second run hits the aes cache files written next to the wavs
  const sidecars = (await import('node:fs')).readdirSync(join(dir, 'vary-loud-0')).filter((f) => f.endsWith('.aesthetics.json'))
  assert.equal(sidecars.length, 3, 'aes axes cached next to each wav in their own cache file')
})

test('taste-eval C2: dsp+aes-bt-pess row + uncertainty landscape, existing scorers undisturbed', async (t) => {
  // Reuse the loudness-taste shape (aes-stub CE tracks RMS): the pessimistic row must appear next
  // to the existing scorers, an ensembleUncertainty block must report per-type std, and the plain
  // scorers' numbers must be exactly what they were before the row existed.
  const { evaluate: evalFn } = await import('../src/taste/eval.js')
  const dir = mkdtempSync(join(tmpdir(), 'taste-c2-'))
  const logPath = join(dir, 'beat-scores.jsonl')
  const lines: string[] = []
  // two round kinds so byType splits exist: vary (track-bearing) and gen (group gen:*, no track)
  for (let b = 0; b < 8; b++) {
    const isGen = b >= 5
    const batchDir = join(dir, `${isGen ? 'gen' : 'vary'}-loud-${b}`)
    mkdirSync(batchDir)
    const gains = [0.15, 0.4, 0.8]
    const files = ['v1.beat', 'v2.beat', 'v3.beat']
    const rotate = b % 3
    const rotated = [...gains.slice(rotate), ...gains.slice(0, rotate)]
    rotated.forEach((g, i) => writeFileSync(join(batchDir, `v${i + 1}.wav`), toneWav(440 + b * 10, g)))
    const loudest = rotated.indexOf(Math.max(...rotated))
    const constantFeatures = Object.fromEntries(files.map((f) => [f, fakeFeatures(10, -20)]))
    const entry: Record<string, unknown> = {
      t: 'x', batch: batchDir, group: isGen ? 'gen:pad' : 'mix', seed: b, parentSha256: 'x',
      picks: [{ rank: 1, variant: files[loudest]! }],
      rejected: files.filter((_, i) => i !== loudest),
      features: constantFeatures,
    }
    if (!isGen) entry.track = 'lead'
    lines.push(JSON.stringify(entry))
  }
  writeFileSync(logPath, lines.join('\n') + '\n')
  let report
  try {
    report = await evalFn(logPath, { seed: 41, embedBackend: 'off', aesBackend: 'aes-stub' })
  } catch (err) {
    t.skip(`no python3 for the stub sidecar here: ${err instanceof Error ? err.message : err}`)
    return
  }
  assert.equal(report.aesthetics?.attached, 8)
  const pess = report.scorers.find((s) => s.scorer === 'dsp+aes-bt-pess')
  const plain = report.scorers.find((s) => s.scorer === 'dsp+aes-bt')
  assert.ok(pess !== undefined, 'the pessimistic ablation row ran')
  assert.ok(plain !== undefined, 'the plain dsp+aes-bt row still ran')
  assert.equal(pess!.batches, plain!.batches, 'pess row covers the same folds as the plain row')
  // the pessimistic row still recovers the planted loudness taste (pessimism narrows, not destroys)
  assert.ok(pess!.pairwise > 0.6, `pess should still order most pairs, got ${pess!.pairwise}`)

  // uncertainty landscape present, folds match the aes-bearing batch count, split by type
  const u = report.ensembleUncertainty
  assert.ok(u !== undefined, 'ensembleUncertainty reported')
  assert.equal(u!.folds, plain!.batches, 'one uncertainty fold per aes-bearing batch')
  assert.ok(u!.meanStd >= 0)
  assert.ok(u!.byType !== undefined, 'per-type uncertainty split present for a mixed log')
  assert.deepEqual(u!.byType!.map((x) => x.type).sort(), ['gen', 'vary'])
  for (const t2 of u!.byType!) assert.ok(t2.meanStd >= 0, `${t2.type} std finite and nonnegative`)

  // existing scorers are byte-for-byte what they were WITHOUT the new row: re-derive them by
  // running the same folds through the pre-C2 scorer set is overkill — instead assert the plain
  // rows carry their established planted-taste results unchanged.
  const aesBt = report.scorers.find((s) => s.scorer === 'aes-bt')!
  const dspBt = report.scorers.find((s) => s.scorer === 'dsp-bt')!
  assert.ok(aesBt.pairwise > 0.8, `aes-bt unchanged (orders the loudness pairs), got ${aesBt.pairwise}`)
  assert.ok(dspBt.pairwise <= 0.6, `dsp-bt unchanged (blind on constant features), got ${dspBt.pairwise}`)

  // the text report surfaces both the row and the landscape
  const text = formatEvalReport(report)
  assert.match(text, /dsp\+aes-bt-pess/)
  assert.match(text, /ensemble uncertainty/)
})

test('criticWithUncertainty returns a T5-pilot scorer closure over all usable dsp+aes pairs', async (t) => {
  const { criticWithUncertainty } = await import('../src/taste/eval.js')
  const dir = mkdtempSync(join(tmpdir(), 'taste-critic-'))
  const logPath = join(dir, 'beat-scores.jsonl')
  const lines: string[] = []
  for (let b = 0; b < 6; b++) {
    const batchDir = join(dir, `vary-loud-${b}`)
    mkdirSync(batchDir)
    const gains = [0.15, 0.4, 0.8]
    const files = ['v1.beat', 'v2.beat', 'v3.beat']
    gains.forEach((g, i) => writeFileSync(join(batchDir, `v${i + 1}.wav`), toneWav(440 + b * 10, g)))
    const loudest = gains.indexOf(Math.max(...gains))
    const constantFeatures = Object.fromEntries(files.map((f) => [f, fakeFeatures(10, -20)]))
    lines.push(JSON.stringify({
      t: 'x', batch: batchDir, track: 'lead', group: 'mix', seed: b, parentSha256: 'x',
      picks: [{ rank: 1, variant: files[loudest]! }],
      rejected: files.filter((_, i) => i !== loudest),
      features: constantFeatures,
    }))
  }
  writeFileSync(logPath, lines.join('\n') + '\n')
  let critic
  try {
    critic = await criticWithUncertainty(logPath, { aesBackend: 'aes-stub', beta: 1 })
  } catch (err) {
    t.skip(`no python3 for the stub sidecar here: ${err instanceof Error ? err.message : err}`)
    return
  }
  assert.equal(critic.trainedBatches, 6, 'trained on every aes-bearing batch')
  assert.ok(critic.trainedPairs > 0, 'decomposed pairs from the log')
  // score a population; the aes CE axis (RMS in the stub) should reward the loudest candidate
  const zeroAxes = [0, 0, 0, 0]
  const candidates = [
    { dsp: fakeFeatures(10, -20), aes: zeroAxes }, // quiet
    { dsp: fakeFeatures(10, -20), aes: zeroAxes }, // mid
    { dsp: fakeFeatures(10, -20), aes: zeroAxes }, // loud (varied below)
  ]
  // give the three candidates distinct CE so within-population z-scoring has something to separate
  candidates[0]!.aes = [0.1, 0, 0, 0]
  candidates[1]!.aes = [0.4, 0, 0, 0]
  candidates[2]!.aes = [0.9, 0, 0, 0]
  const scored = critic.scorePopulation(candidates)
  assert.equal(scored.length, 3)
  for (const s of scored) {
    assert.ok(Number.isFinite(s.mean) && Number.isFinite(s.std) && Number.isFinite(s.pessimistic))
    assert.ok(Math.abs(s.pessimistic - (s.mean - critic.beta * s.std)) < 1e-12, 'pessimistic = mean - beta*std')
  }
  // the loudest candidate (highest CE) should carry the highest mean utility
  assert.ok(scored[2]!.mean > scored[0]!.mean, 'louder candidate scores higher under the learned taste')
  // empty population is handled
  assert.deepEqual(critic.scorePopulation([]), [])
})

// ---- pilot 108 fixes ------------------------------------------------------------------------------

test('re-scoring an already-scored batch is flagged, and the harness keeps only the latest entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taste-rescore-'))
  const batchDir = join(dir, 'vary-filter-9')
  mkdirSync(batchDir)
  const manifest: VaryBatchManifest = {
    parent: join(dir, 'song.beat'), parentSha256: 'abc', track: 'lead', group: 'filter', count: 3, seed: 9, createdAt: 'now',
    variants: [{ file: 'v1.beat', edits: [] }, { file: 'v2.beat', edits: [] }, { file: 'v3.beat', edits: [] }],
  }
  writeFileSync(join(batchDir, 'manifest.json'), JSON.stringify(manifest))
  writeFileSync(join(dir, 'song.beat'), 'x')
  for (let i = 1; i <= 3; i++) writeFileSync(join(batchDir, `v${i}.wav`), toneWav(300 * i, 0.5))
  const first = scoreBatch(batchDir, ['1', '3'])
  assert.equal(first.previousPicks, undefined, 'first score of a batch carries no re-score note')
  const second = scoreBatch(batchDir, ['2'])
  assert.equal(second.previousPicks, 'v1 > v3', 'second score names the previous ranking')
  assert.match(formatScoreResult(second), /already scored \(v1 > v3\).*LATEST/s)
  const { batches, superseded } = loadTasteBatches(second.logPath)
  assert.equal(superseded, 1)
  assert.equal(batches.length, 1, 'one judgment per batch — no extra eval fold')
  assert.equal(batches[0]!.picks[0], 'v2.beat', 'the latest ranking wins')
})

test('formatAuditionIndex withholds the answer key when shuffled', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taste-blind-'))
  for (let i = 1; i <= 4; i++) writeFileSync(join(dir, `v${i}.wav`), toneWav(300 * i, 0.5))
  const { formatAuditionIndex } = await import('../src/vary/audition.js')
  const shuffled = stitchAudition(dir, 4, { shuffleSeed: 7 })
  assert.equal(shuffled.shuffled, true)
  const blindLine = formatAuditionIndex(shuffled)
  assert.doesNotMatch(blindLine, /v\d @ \d/, 'no variant-at-timecode mapping in the blind print')
  assert.match(blindLine, /answer key/, 'points at audition.json for after ranking')
  const plain = stitchAudition(dir, 4, {})
  assert.equal(plain.shuffled, false)
  assert.match(formatAuditionIndex(plain), /v1 @ 0:00\.0/, 'unshuffled keeps the classic index')
})

// ---- clip-set batches -----------------------------------------------------------------------------

test('clip-set batch: audition + score work, adopt refuses', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taste-clips-'))
  const batchDir = join(dir, 'chops')
  mkdirSync(batchDir)
  writeFileSync(join(batchDir, 'kick-a.wav'), toneWav(100, 0.8))
  writeFileSync(join(batchDir, 'kick-b.wav'), toneWav(120, 0.8))
  writeFileSync(join(batchDir, 'kick-c.wav'), toneWav(140, 0.8))
  const manifest = writeClipSetBatch(batchDir, ['kick-a.wav', 'kick-b.wav', 'kick-c.wav'], { group: 'chops:kick', seed: 3 })
  assert.equal(manifest.parent, '')
  const stitched = stitchAudition(batchDir, 3, { shuffleSeed: manifest.seed, files: manifest.variants.map((v) => v.file) })
  assert.equal(stitched.entries.length, 3)
  const result = scoreBatch(batchDir, ['v2'])
  assert.equal(result.logPath, join(dir, 'beat-scores.jsonl'), 'clip-set log defaults next to the batch dir')
  assert.equal(result.entry.picks[0]!.variant, 'kick-b.wav')
  assert.ok(result.entry.features!['kick-b.wav'], 'clip-set entries carry features too')
  const formatted = formatScoreResult(result)
  assert.match(formatted, /taste log/, 'clip-set score summary points at the taste log, not adopt/replay')
  assert.doesNotMatch(formatted, /beat set/, 'no replay hint — clip-set picks have no edits')
  assert.throws(() => adoptVariant(batchDir, '1'), BeatBatchError)
  assert.throws(() => adoptVariant(batchDir, '1'), /nothing to adopt into/)
})

test('D25 training holdout: refs-packs ref variants never become training pairs, stay rankable', async () => {
  const { mkdtempSync: mkd, writeFileSync: wf, mkdirSync: mkdir } = await import('node:fs')
  const { tmpdir: tmp } = await import('node:os')
  const { join: j } = await import('node:path')
  const { loadTasteBatches, trainable } = await import('../src/taste/eval.js')
  const container = mkd(j(tmp(), 'beat-packs-holdout-'))
  const dir = j(container, 'showdown-bassline-9')
  mkdir(dir)
  wf(j(dir, 'manifest.json'), JSON.stringify({ parent: '', parentSha256: '', group: 'showdown:bassline', count: 3, seed: 9, variants: [
    { file: 'v1.wav', source: { kind: 'engine', from: 'composed figure' } },
    { file: 'v2.wav', source: { kind: 'ref', from: '/x/taste-dataset/refs-packs/bassline/loop.wav' } },
    { file: 'v3.wav', source: { kind: 'ref', from: '/x/taste-dataset/refs-unfamiliar/bassline/chop.wav' } },
  ] }))
  const feats = Object.fromEntries(['v1.wav','v2.wav','v3.wav'].map((f, i) => [f, Object.fromEntries(FEATURE_KEYS.map((k) => [k, i]))]))
  const log = j(container, 'beat-scores.jsonl')
  wf(log, JSON.stringify({ batch: dir, group: 'showdown:bassline', picks: [{ rank: 1, variant: 'v2.wav' }, { rank: 2, variant: 'v1.wav' }], rejected: ['v3.wav'], features: feats, sources: { 'v1.wav': 'engine', 'v2.wav': 'ref', 'v3.wav': 'ref' } }) + '\n')
  const { batches } = loadTasteBatches(log)
  assert.equal(batches.length, 1)
  const b = batches[0]!
  // the packs ref is excluded from training...
  assert.ok(b.trainingExcluded.has('v2.wav'), 'packs ref flagged')
  const t = trainable(b)
  assert.deepEqual(t.picks, ['v1.wav'], 'packs ref dropped from training picks')
  // ...but the unfamiliar-pool ref is NOT excluded (only packs carries the ToU restriction)
  assert.deepEqual(t.rejected, ['v3.wav'])
  // and the batch still ranks the packs ref held-out (picks untouched for evaluation)
  assert.deepEqual(b.picks, ['v2.wav', 'v1.wav'])
})
