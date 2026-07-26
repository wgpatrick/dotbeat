// Eval-integrity regressions (2026-07-26 adversarial hunt). Every test here is a port of a
// runnable repro that demonstrated a way the blind taste/showdown pipeline could quietly record a
// number it hadn't actually earned — a partially-gained batch, a failed batch that stayed
// rateable, a D25-excluded clip becoming training data, a retracted ranking still counting, a
// self-comparison counted as evidence, a hard-cut ref clip, a boosted silence entering a batch.
// They are grouped by the hunt's finding ids (H1/H2/H3/M3/M4/M5/M7/M1/L3) so a future reader can
// trace each assertion back to the failure it encodes.

import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyWavGain, assertWavGainable, normalizeBatchLoudness, markBatchComplete, isBatchComplete, discardIncompleteBatch, canonicalBatchKey, scoreBatch, recordNoneGood, BATCH_COMPLETE_MARKER, NORMALIZE_MAX_BOOST_DB } from '../src/vary/batch.js'
import { decodeWav, readWavFormat, integratedLoudness } from '../src/metrics/index.js'
import { matchClipDurations, writeShowdownBatch, tally, computeShowdownReport } from '../src/taste/showdown.js'
import { loadTasteBatches, trainable } from '../src/taste/eval.js'

const tmp = (name: string) => mkdtempSync(join(tmpdir(), `beat-evalint-${name}-`))

/** A sine wav in any of the encodings the shared reader supports. `extensible` writes the same
 * PCM payload behind a WAVE_FORMAT_EXTENSIBLE (0xFFFE) fmt chunk — how most modern 24-bit
 * encoders tag their files, and the exact shape of the real refs-packs clip in the H1 repro. */
function sineWav(opts: { seconds?: number; sampleRate?: number; amp?: number; channels?: number; bits?: number; freq?: number; float?: boolean; extensible?: boolean } = {}): Buffer {
  const { seconds = 0.25, sampleRate = 8000, amp = 0.3, channels = 1, bits = 16, freq = 220, float = false, extensible = false } = opts
  const bytesPer = bits / 8
  const frames = Math.round(seconds * sampleRate)
  const dataLen = frames * channels * bytesPer
  const fmtLen = extensible ? 40 : 16
  const buf = Buffer.alloc(20 + fmtLen + 8 + dataLen)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(buf.length - 8, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(fmtLen, 16)
  buf.writeUInt16LE(extensible ? 0xfffe : float ? 3 : 1, 20)
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * channels * bytesPer, 28)
  buf.writeUInt16LE(channels * bytesPer, 32)
  buf.writeUInt16LE(bits, 34)
  if (extensible) {
    buf.writeUInt16LE(22, 36) // cbSize
    buf.writeUInt16LE(bits, 38) // wValidBitsPerSample
    buf.writeUInt32LE(channels === 1 ? 0x4 : 0x3, 40) // dwChannelMask
    buf.writeUInt16LE(float ? 3 : 1, 44) // SubFormat GUID: first 2 bytes are the real format tag
    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71]).copy(buf, 46)
  }
  const dataOff = 20 + fmtLen
  buf.write('data', dataOff, 'ascii')
  buf.writeUInt32LE(dataLen, dataOff + 4)
  let p = dataOff + 8
  for (let i = 0; i < frames; i++) {
    const s = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate)
    for (let c = 0; c < channels; c++) {
      if (float && bits === 32) buf.writeFloatLE(s, p)
      else if (bits === 16) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), p)
      else if (bits === 24) {
        const v = Math.max(-8388608, Math.min(8388607, Math.round(s * 8388607)))
        const u = v < 0 ? v + 0x1000000 : v
        buf.writeUInt8(u & 0xff, p)
        buf.writeUInt8((u >> 8) & 0xff, p + 1)
        buf.writeUInt8((u >> 16) & 0xff, p + 2)
      } else if (bits === 32) buf.writeInt32LE(Math.round(s * 0x7fffffff), p)
      p += bytesPer
    }
  }
  return buf
}

const peakOf = (path: string) => {
  const ch = decodeWav(readFileSync(path)).channels[0]!
  let m = 0
  for (const v of ch) m = Math.max(m, Math.abs(v))
  return m
}

// ---- H1: ONE wav reader, one format-support surface --------------------------------------------
// applyWavGain (vary/batch.ts) and readWavData (taste/showdown.ts) each re-implemented a NARROWER
// reader than metrics/wav.ts's decodeWav — no WAVE_FORMAT_EXTENSIBLE, no 32-bit-int arm. A real
// pool file (refs-packs/lead/BOS_ISL_125_*_Fm.wav: 24-bit extensible) therefore passed every
// selection gate (which decode through decodeWav) and then threw mid-normalization.

test('H1: every wav-touching path accepts the same formats — 24-bit WAVE_FORMAT_EXTENSIBLE', () => {
  const dir = tmp('h1ext')
  const path = join(dir, 'v1.wav')
  writeFileSync(path, sineWav({ bits: 24, extensible: true, amp: 0.4 }))
  // the shared reader resolves the SubFormat GUID to plain PCM
  const info = readWavFormat(readFileSync(path))
  assert.equal(info.rawFormat, 0xfffe)
  assert.equal(info.format, 1)
  assert.equal(info.bitsPerSample, 24)
  // reader 1: metrics decodeWav
  assert.ok(decodeWav(readFileSync(path)).channels[0]!.length > 0)
  // reader 2: the gain path — used to throw "unsupported wav encoding (format 65534, 24-bit)"
  applyWavGain(path, -6)
  assert.ok(Math.abs(peakOf(path) - 0.4 * Math.pow(10, -6 / 20)) < 0.01)
  // reader 3: the showdown duration matcher — used to throw "unsupported wav encoding (format 65534)"
  writeFileSync(join(dir, 'v2.wav'), sineWav({ bits: 24, extensible: true, seconds: 0.1 }))
  const r = matchClipDurations(dir, ['v1.wav', 'v2.wav'])
  assert.equal(r.clips[0]!.action, 'trimmed')
})

test('H1: applyWavGain handles 32-bit int PCM (decodeWav always did)', () => {
  const dir = tmp('h1int32')
  const path = join(dir, 'a.wav')
  writeFileSync(path, sineWav({ bits: 32, amp: 0.4 }))
  assert.ok(decodeWav(readFileSync(path)).channels[0]!.length > 0)
  applyWavGain(path, -6) // used to throw: the 32-bit-int arm did not exist
  assert.ok(Math.abs(peakOf(path) - 0.4 * Math.pow(10, -6 / 20)) < 0.01)
})

test('H1: integer gain SATURATES at full scale, never wraps', () => {
  const dir = tmp('h1clip')
  for (const bits of [16, 24, 32]) {
    const path = join(dir, `b${bits}.wav`)
    writeFileSync(path, sineWav({ bits, amp: 0.9 }))
    const before = decodeWav(readFileSync(path)).channels[0]!
    applyWavGain(path, 12)
    const after = decodeWav(readFileSync(path)).channels[0]!
    let flips = 0
    for (let i = 0; i < after.length; i++) {
      if (before[i]! > 0.5 && after[i]! < 0) flips++
      if (before[i]! < -0.5 && after[i]! > 0) flips++
    }
    assert.equal(flips, 0, `${bits}-bit gain wrapped around instead of clipping`)
    assert.ok(Math.max(...after.map(Math.abs)) <= 1.0000001, `${bits}-bit gain exceeded full scale`)
  }
})

test('H1: normalization is all-or-nothing — a file that cannot be gained leaves the batch untouched', (t) => {
  const dir = tmp('h1atomic')
  writeFileSync(join(dir, 'v1.wav'), sineWav({ seconds: 1, amp: 0.3 }))
  writeFileSync(join(dir, 'v2.wav'), sineWav({ seconds: 1, amp: 0.6 }))
  writeFileSync(join(dir, 'v3.wav'), sineWav({ seconds: 1, amp: 0.1 }))
  chmodSync(join(dir, 'v3.wav'), 0o444)
  // env gate with a named reason (CLAUDE.md: no silent skips): root ignores the mode bits, so the
  // unwritable-file precondition this test needs cannot exist there.
  try {
    writeFileSync(join(dir, 'v3.wav'), readFileSync(join(dir, 'v3.wav')))
    t.skip('running as root (or on a permissionless filesystem): a read-only file is still writable, so the mid-batch-failure precondition cannot be created')
    return
  } catch {
    /* good — the file really is unwritable */
  }
  const before = [1, 2, 3].map((i) => readFileSync(join(dir, `v${i}.wav`)))
  assert.throws(() => normalizeBatchLoudness(dir, 3), /v3\.wav/)
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(readFileSync(join(dir, `v${i + 1}.wav`)), before[i], `v${i + 1}.wav was gained before the batch failed — partial normalization is a level confound`)
  }
  chmodSync(join(dir, 'v3.wav'), 0o644)
})

// ---- L3: a zero-length data chunk is an error, not a silent no-op -------------------------------

test('L3: applyWavGain refuses a zero-size data chunk instead of recording a gain it never applied', () => {
  const dir = tmp('l3zero')
  const path = join(dir, 'a.wav')
  const buf = sineWav({ seconds: 0.05 })
  buf.writeUInt32LE(0, 40) // data chunk size 0 (streamed / truncated header)
  writeFileSync(path, buf)
  const before = readFileSync(path)
  assert.throws(() => applyWavGain(path, -20), /data chunk is empty/)
  assert.deepEqual(readFileSync(path), before)
  assert.throws(() => assertWavGainable(path), /data chunk is empty/)
})

// ---- M5: the trim fade must cover every format the reader accepts -------------------------------
// applyFadeOut handled 16-bit PCM and 32-bit float only while readWavData accepted 24-bit, so
// every trimmed 24-bit clip got a hard cut. The ref pool is overwhelmingly 24-bit: 70 of 950
// already-rated clips carried the artifact, in the ref arm only.

test('M5: a trimmed clip is faded out in every supported encoding (24-bit included)', () => {
  for (const [bits, float] of [
    [16, false],
    [24, false],
    [32, true],
  ] as const) {
    const dir = tmp(`m5-${bits}`)
    writeFileSync(join(dir, 'v1.wav'), sineWav({ seconds: 1, sampleRate: 44100, bits, float, amp: 0.6, freq: 200 }))
    writeFileSync(join(dir, 'v2.wav'), sineWav({ seconds: 0.5, sampleRate: 44100, bits, float, amp: 0.6, freq: 200 }))
    const r = matchClipDurations(dir, ['v1.wav', 'v2.wav'])
    assert.equal(r.clips[0]!.action, 'trimmed')
    const ch = decodeWav(readFileSync(join(dir, 'v1.wav'))).channels[0]!
    const tail = Math.max(...Array.from(ch.slice(ch.length - 64)).map(Math.abs))
    const mid = Math.max(...Array.from(ch.slice(ch.length >> 1, (ch.length >> 1) + 64)).map(Math.abs))
    assert.ok(tail < 0.1 * mid, `${bits}-bit${float ? ' float' : ''} clip ends in a hard cut (tail peak ${tail.toFixed(3)} vs mid ${mid.toFixed(3)})`)
  }
})

// ---- M7: floor the normalization boost ----------------------------------------------------------

test('M7: a near-silent variant is not boosted into the batch at full level', () => {
  const dir = tmp('m7')
  writeFileSync(join(dir, 'v1.wav'), sineWav({ seconds: 2, amp: 0.3 }))
  writeFileSync(join(dir, 'v2.wav'), sineWav({ seconds: 2, amp: 0.25 }))
  writeFileSync(join(dir, 'v3.wav'), sineWav({ seconds: 2, amp: 0.35 }))
  writeFileSync(join(dir, 'v4.wav'), sineWav({ seconds: 2, amp: 0.0005 })) // ~-66 dBFS
  const r = normalizeBatchLoudness(dir, 4)!
  const v4 = r.variants[3]!
  assert.ok(v4.wantedGainDb! > NORMALIZE_MAX_BOOST_DB, 'fixture is not quiet enough to exercise the floor')
  assert.equal(v4.gainDb, NORMALIZE_MAX_BOOST_DB)
  assert.equal(v4.capped, true, 'a floored boost must be flagged like any other limited gain')
  const after = decodeWav(readFileSync(join(dir, 'v4.wav')))
  const lufs = integratedLoudness(after.channels, after.sampleRate).integratedLufs
  assert.ok(lufs < r.targetLufs! - 10, `a -70 LUFS variant reached ${lufs.toFixed(1)} LUFS against a ${r.targetLufs} target — it entered the batch as an ordinary clip`)
  // the other three are normalized as usual: the floor is per-variant, not a batch-wide bail-out
  assert.equal(r.variants[0]!.capped, false)
})

// ---- helpers for the log-side findings ----------------------------------------------------------

/** A showdown batch of `kinds`, each a distinct sine, with the manifest written. */
function makeShowdownBatch(dir: string, kinds: ('engine' | 'gen' | 'ref')[], opts: { from?: Record<string, string> } = {}): string {
  mkdirSync(dir, { recursive: true })
  const clips = kinds.map((k, i) => {
    writeFileSync(join(dir, `v${i + 1}.wav`), sineWav({ seconds: 1, amp: 0.2 + 0.05 * i, freq: 180 + 40 * i }))
    return { file: `v${i + 1}.wav`, source: { kind: k, ...(opts.from?.[k] !== undefined ? { from: opts.from[k]! } : {}) } }
  })
  writeShowdownBatch(dir, 'bassline', clips, { seed: 41 })
  return dir
}

// ---- M3: a none-good verdict supersedes an earlier ranking ---------------------------------------
// Both loaders skipped empty-picks entries at PARSE time, so a none-good could never become the
// "latest" entry for its batch — the retracted ranking still counted in the win rates AND trained
// the taste model, under a report line claiming none-good batches are excluded.

test('M3: a later none-good retracts the earlier ranking in BOTH loaders', () => {
  const root = tmp('m3')
  const log = join(root, 'beat-scores.jsonl')
  const dir = makeShowdownBatch(join(root, 'showdown-bassline-1'), ['engine', 'gen', 'ref'])
  scoreBatch(dir, ['2'], log)
  recordNoneGood(dir, log)

  const rep = computeShowdownReport(log)
  assert.equal(rep.totalBatches, 0, 'the retracted ranking still counts in the showdown scoreboard')
  assert.equal(rep.noneGood.total, 1)
  assert.deepEqual(rep.overall, [])

  const t = loadTasteBatches(log)
  assert.equal(t.batches.length, 0, 'the retracted ranking is still training data')
  assert.equal(t.superseded, 1, 'the retraction must be counted as a supersede, not dropped at parse time')
})

test('M3: a ranking recorded AFTER a none-good wins — supersede is by order, not by verdict', () => {
  const root = tmp('m3b')
  const log = join(root, 'beat-scores.jsonl')
  const dir = makeShowdownBatch(join(root, 'showdown-bassline-2'), ['engine', 'gen', 'ref'])
  recordNoneGood(dir, log)
  scoreBatch(dir, ['1'], log)
  assert.equal(computeShowdownReport(log).totalBatches, 1)
  assert.equal(computeShowdownReport(log).noneGood.total, 0)
  assert.equal(loadTasteBatches(log).batches.length, 1)
})

// ---- M1: one physical batch dir is one batch, however it was spelled ------------------------------

test('M1: ./x, x, /abs/x and x/ are the same batch, not four phantom ones', () => {
  const root = tmp('m1')
  const log = join(root, 'beat-scores.jsonl')
  const dir = makeShowdownBatch(join(root, 'showdown-bassline-3'), ['engine', 'gen', 'ref'])
  scoreBatch(dir, ['3'], log)
  const cwd = process.cwd()
  try {
    process.chdir(root)
    const r2 = scoreBatch('showdown-bassline-3', ['1'], log)
    assert.ok(r2.previousPicks !== undefined, 'a re-score by relative path was reported as a first score')
    const r3 = scoreBatch('./showdown-bassline-3/', ['2'], log)
    assert.ok(r3.previousPicks !== undefined, 'a re-score by trailing-slash path was reported as a first score')
  } finally {
    process.chdir(cwd)
  }
  assert.equal(computeShowdownReport(log).totalBatches, 1)
  const t = loadTasteBatches(log)
  assert.equal(t.batches.length, 1)
  assert.equal(t.superseded, 2)
  // the entry itself carries the resolved path, so the log is portable-by-convention
  assert.equal(t.batches[0]!.dir, canonicalBatchKey(dir))
})

// ---- M4: self-arm pairs are not evidence ---------------------------------------------------------

test('M4: tally() skips pairs whose two sides are the same arm', () => {
  // one batch, two clips from the SAME arm plus one from another: the duplicated arm must not
  // beat itself into the pairwise record
  const stats = tally([{ picks: ['v1.wav', 'v2.wav', 'v3.wav'], rejected: [], sources: { 'v1.wav': 'ref', 'v2.wav': 'ref', 'v3.wav': 'engine' } }])
  const ref = stats.find((s) => s.kind === 'ref')!
  const engine = stats.find((s) => s.kind === 'engine')!
  assert.equal(ref.pairCount, 2, 'ref should face engine twice, never itself')
  assert.equal(ref.pairsWon, 2)
  assert.equal(engine.pairCount, 2)
  assert.equal(engine.pairsWon, 0)
})

test('M4: topHalf is counted per variant SLOT, so it can never exceed batches', () => {
  const stats = tally([
    { picks: ['v1.wav', 'v2.wav'], rejected: ['v3.wav', 'v4.wav'], sources: { 'v1.wav': 'ref', 'v2.wav': 'ref', 'v3.wav': 'engine', 'v4.wav': 'engine' } },
    { picks: ['v1.wav', 'v2.wav'], rejected: ['v3.wav', 'v4.wav'], sources: { 'v1.wav': 'ref', 'v2.wav': 'ref', 'v3.wav': 'engine', 'v4.wav': 'engine' } },
  ])
  for (const s of stats) assert.ok(s.topHalf <= s.batches, `${s.kind} placed top-half in ${s.topHalf} of ${s.batches} batches ("${Math.round((100 * s.topHalf) / s.batches)}%")`)
})

// ---- H3: the D25 holdout must survive batch-dir deletion ------------------------------------------
// trainingExcluded lived ONLY in the batch manifest while the trainable features lived in the log.
// Deleting the dirs is the documented lifecycle, and it silently turned purchased-loop clips into
// training data.

test('H3: a purchased-pool ref stays out of training after its batch dir is deleted', () => {
  const root = tmp('h3')
  const log = join(root, 'beat-scores.jsonl')
  const dir = makeShowdownBatch(join(root, 'showdown-bassline-4'), ['engine', 'gen', 'ref'], {
    from: { ref: '/somewhere/taste-dataset/refs-packs/bassline/PURCHASED_LOOP.wav' },
  })
  scoreBatch(dir, ['3', '2'], log)
  const before = loadTasteBatches(log).batches[0]!
  assert.ok(before.trainingExcluded.has('v3.wav'))
  const beforeTrainable = trainable(before)

  rmSync(dir, { recursive: true, force: true })
  const after = loadTasteBatches(log).batches[0]!
  assert.ok(after.trainingExcluded.has('v3.wav'), 'the D25 holdout evaporated with the batch dir')
  assert.deepEqual(trainable(after), beforeTrainable)
  // the entry still carries the clip's features (it is still ranked held-out) — only training pairs
  // are withheld, which is the whole point of the holdout
  assert.ok(Object.keys(after.features).includes('v3.wav'))
})

test('H3: a ref variant with no manifest and no logged holdout is excluded — unknown means exclude', () => {
  const root = tmp('h3b')
  const log = join(root, 'beat-scores.jsonl')
  // an entry as it was written BEFORE trainingExcluded rode in the log: sources say `ref`, but the
  // origin pool is unknowable once the dir is gone. Conservative by construction — it can only
  // withhold training pairs, never add them.
  const features = { 'v1.wav': { rms: 0.2, centroid: 0.4 }, 'v2.wav': { rms: 0.3, centroid: 0.5 }, 'v3.wav': { rms: 0.25, centroid: 0.45 } }
  writeFileSync(
    log,
    JSON.stringify({
      t: new Date().toISOString(),
      batch: join(root, 'gone-batch'),
      group: 'showdown:bassline',
      seed: 41,
      parentSha256: '',
      picks: [{ rank: 1, variant: 'v3.wav' }],
      rejected: ['v1.wav', 'v2.wav'],
      sources: { 'v1.wav': 'engine', 'v2.wav': 'gen', 'v3.wav': 'ref' },
      features,
    }) + '\n',
  )
  const b = loadTasteBatches(log).batches[0]!
  assert.ok(b.trainingExcluded.has('v3.wav'), 'an unattributable ref variant must not become training data')
  assert.deepEqual(trainable(b), { picks: [], rejected: ['v1.wav', 'v2.wav'] })
  // non-ref arms are unaffected — the conservative rule is scoped to ref variants
  assert.equal(b.trainingExcluded.has('v1.wav'), false)
})

// ---- H2: a failed batch must not stay rateable ---------------------------------------------------
// cli/beat.mjs wrote manifest.json BEFORE matchClipDurations/normalizeBatchLoudness, and its
// failure handler deleted the out-dir only `if (!existsSync(manifest.json))`. A throw in exactly
// those three confound-removing steps therefore left a dir with a manifest, clips of mismatched
// length and level, and nothing recording that assembly had failed — `beat rate` queues it and the
// owner rates a broken comparison as a real one.

test('H2: a manifest alone does not mean a batch is assembled', () => {
  const dir = tmp('h2')
  writeFileSync(join(dir, 'v1.wav'), sineWav({ seconds: 1, amp: 0.3 }))
  writeFileSync(join(dir, 'v2.wav'), sineWav({ seconds: 0.5, amp: 0.6 }))
  writeShowdownBatch(dir, 'bassline', [
    { file: 'v1.wav', source: { kind: 'engine' } },
    { file: 'v2.wav', source: { kind: 'gen' } },
  ])
  assert.ok(existsSync(join(dir, 'manifest.json')))
  assert.equal(isBatchComplete(dir), false, 'the manifest is written BEFORE the confound-removing steps — it cannot be the completion signal')
  matchClipDurations(dir, ['v1.wav', 'v2.wav'])
  normalizeBatchLoudness(dir, 2)
  markBatchComplete(dir)
  assert.equal(isBatchComplete(dir), true)
  assert.ok(readFileSync(join(dir, BATCH_COMPLETE_MARKER), 'utf8').length > 0, 'the marker explains itself to whoever finds it')
})

test('H2: cleanup discards a batch that never completed and keeps one that did', () => {
  const halfBuilt = tmp('h2half')
  writeFileSync(join(halfBuilt, 'v1.wav'), sineWav({ seconds: 1 }))
  writeFileSync(join(halfBuilt, 'v2.wav'), sineWav({ seconds: 0.5 }))
  writeShowdownBatch(halfBuilt, 'bassline', [
    { file: 'v1.wav', source: { kind: 'engine' } },
    { file: 'v2.wav', source: { kind: 'gen' } },
  ])
  // the old gate — `existsSync(manifest.json)` — would have KEPT this dir
  assert.equal(discardIncompleteBatch(halfBuilt), true)
  assert.equal(existsSync(halfBuilt), false, 'a batch that failed mid-assembly is still on disk for beat rate to queue')

  const complete = tmp('h2done')
  writeFileSync(join(complete, 'v1.wav'), sineWav({ seconds: 1 }))
  writeFileSync(join(complete, 'v2.wav'), sineWav({ seconds: 0.5 }))
  writeShowdownBatch(complete, 'bassline', [
    { file: 'v1.wav', source: { kind: 'engine' } },
    { file: 'v2.wav', source: { kind: 'gen' } },
  ])
  matchClipDurations(complete, ['v1.wav', 'v2.wav'])
  normalizeBatchLoudness(complete, 2)
  markBatchComplete(complete)
  assert.equal(discardIncompleteBatch(complete), false)
  assert.ok(existsSync(join(complete, 'manifest.json')))
})
