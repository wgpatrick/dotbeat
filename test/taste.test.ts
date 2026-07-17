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
import { standardizeBatch, pairsFromRanking, trainBT, scoreVector, describeWeights } from '../src/taste/ranker.js'
import { loadTasteBatches, evaluate, mulberry32 } from '../src/taste/eval.js'
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
