// Post-render loudness normalization (src/vary/batch.ts normalizeBatchLoudness): median-target
// selection, the pure-gain math, the -1 dBTP upward cap, silence handling, and the manifest
// fields — proven on synthetic known-answer WAVs, same posture as test/metrics.test.ts and
// test/audition.test.ts (no real renders in CI: the normalizer is pure decode -> measure ->
// scale byte math, so a sine of known amplitude IS the ground truth).

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  normalizeBatchLoudness,
  measureBatchLoudness,
  refreshBatchLoudnessAfterRender,
  formatNormalizationResult,
  writeClipSetBatch,
  NORMALIZE_TRUE_PEAK_CEILING_DBTP,
  type VaryBatchManifest,
} from '../src/vary/batch.js'
import { decodeWav, integratedLoudness, truePeak } from '../src/metrics/index.js'

const FS = 8000

/** Stereo wav of a 997 Hz sine at `amplitude` (16-bit PCM, or 32-bit float with float: true). */
function sineWav(opts: { seconds: number; amplitude: number; float?: boolean }): Buffer {
  const frames = Math.round(opts.seconds * FS)
  const bytesPerSample = opts.float ? 4 : 2
  const channels = 2
  const blockAlign = bytesPerSample * channels
  const dataLen = frames * blockAlign
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataLen, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(opts.float ? 3 : 1, 20)
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(FS, 24)
  buf.writeUInt32LE(FS * blockAlign, 28)
  buf.writeUInt16LE(blockAlign, 32)
  buf.writeUInt16LE(bytesPerSample * 8, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataLen, 40)
  for (let i = 0; i < frames; i++) {
    const v = opts.amplitude * Math.sin((2 * Math.PI * 997 * i) / FS)
    for (let c = 0; c < channels; c++) {
      const off = 44 + (i * channels + c) * bytesPerSample
      if (opts.float) buf.writeFloatLE(v, off)
      else buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), off)
    }
  }
  return buf
}

function measure(path: string): { lufs: number; truePeakDb: number } {
  const d = decodeWav(readFileSync(path))
  return {
    lufs: integratedLoudness(d.channels, d.sampleRate).integratedLufs,
    truePeakDb: 20 * Math.log10(truePeak(d.channels)),
  }
}

function readManifest(dir: string): VaryBatchManifest {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as VaryBatchManifest
}

test('normalizeBatchLoudness: pure gain lands every variant at the batch-median LUFS, recorded in the manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-normalize-test-'))
  // Amplitudes a factor of 2 apart -> ~6 dB LUFS spread; the median variant is v2.
  writeFileSync(join(dir, 'v1.wav'), sineWav({ seconds: 1, amplitude: 0.1 }))
  writeFileSync(join(dir, 'v2.wav'), sineWav({ seconds: 1, amplitude: 0.2 }))
  writeFileSync(join(dir, 'v3.wav'), sineWav({ seconds: 1, amplitude: 0.4 }))
  writeClipSetBatch(dir, ['v1.wav', 'v2.wav', 'v3.wav'])
  const pre = [1, 2, 3].map((n) => measure(join(dir, `v${n}.wav`)))
  const v2Before = readFileSync(join(dir, 'v2.wav'))

  const r = normalizeBatchLoudness(dir, 3)
  assert.ok(r, 'three measurable variants must normalize')
  assert.equal(r.normalized, true)
  assert.equal(r.basis, 'batch median')
  // target = the MEDIAN variant's own LUFS (v2 here)
  assert.ok(Math.abs(r.targetLufs! - pre[1]!.lufs) < 0.05, `target ${r.targetLufs} vs v2 ${pre[1]!.lufs}`)
  // the median variant itself is untouched — byte-identical, gain 0
  assert.equal(r.variants[1]!.gainDb, 0)
  assert.ok(v2Before.equals(readFileSync(join(dir, 'v2.wav'))), 'median variant must stay byte-identical')
  // gains point the right way and no cap fired
  assert.ok(r.variants[0]!.gainDb > 4, `v1 boosted (${r.variants[0]!.gainDb})`)
  assert.ok(r.variants[2]!.gainDb < -4, `v3 attenuated (${r.variants[2]!.gainDb})`)
  assert.ok(r.variants.every((v) => v.capped === false))
  // uncapped: the wanted gain IS the applied gain, and the pre-gain true peak is recorded
  for (let i = 0; i < 3; i++) {
    assert.equal(r.variants[i]!.wantedGainDb, r.variants[i]!.gainDb, `v${i + 1} wanted == applied when uncapped`)
    assert.ok(Math.abs(r.variants[i]!.truePeakDbtp! - pre[i]!.truePeakDb) < 0.05, `v${i + 1} truePeakDbtp`)
  }
  // and the files actually land at the target
  for (const n of [1, 2, 3]) {
    const post = measure(join(dir, `v${n}.wav`))
    assert.ok(Math.abs(post.lufs - r.targetLufs!) < 0.15, `v${n} post-LUFS ${post.lufs} vs target ${r.targetLufs}`)
  }
  // manifest record: batch-level normalization + per-variant loudness, D21 additive fields
  const m = readManifest(dir)
  assert.deepEqual(m.normalization, { targetLufs: r.targetLufs, truePeakCeilingDbtp: NORMALIZE_TRUE_PEAK_CEILING_DBTP, normalized: true })
  for (let i = 0; i < 3; i++) {
    const l = m.variants[i]!.loudness
    assert.ok(l, `v${i + 1} carries loudness`)
    assert.deepEqual(Object.keys(l).sort(), ['capped', 'gainDb', 'measuredLufs', 'truePeakDbtp', 'wantedGainDb'])
    assert.ok(Math.abs((l.measuredLufs as number) - pre[i]!.lufs) < 0.05, `v${i + 1} measuredLufs`)
    assert.equal(l.gainDb, r.variants[i]!.gainDb)
    assert.equal(l.capped, false)
  }
})

test('true-peak safety: an upward gain is capped at the -1 dBTP ceiling and flagged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-normalize-test-'))
  // v1 needs ~+5.6 dB to reach the median (v2/v3 at 0.95), but its true peak (~-6 dBTP) only
  // allows ~+5 dB before crossing -1 dBTP — the cap must fire and leave it short of target.
  writeFileSync(join(dir, 'v1.wav'), sineWav({ seconds: 1, amplitude: 0.5 }))
  writeFileSync(join(dir, 'v2.wav'), sineWav({ seconds: 1, amplitude: 0.95 }))
  writeFileSync(join(dir, 'v3.wav'), sineWav({ seconds: 1, amplitude: 0.95 }))
  writeClipSetBatch(dir, ['v1.wav', 'v2.wav', 'v3.wav'])
  const preV1 = measure(join(dir, 'v1.wav'))

  const r = normalizeBatchLoudness(dir, 3)
  assert.ok(r)
  const v1 = r.variants[0]!
  const desired = r.targetLufs! - preV1.lufs
  assert.equal(v1.capped, true, 'cap must fire')
  assert.ok(v1.gainDb > 0 && v1.gainDb < desired, `capped gain ${v1.gainDb} must stay below desired ${desired}`)
  // pilot 113: the record shows what was WANTED, so the capped line is readable on its own
  assert.ok(Math.abs(v1.wantedGainDb! - desired) < 0.05, `wantedGainDb ${v1.wantedGainDb} vs desired ${desired}`)
  const post = measure(join(dir, 'v1.wav'))
  assert.ok(post.truePeakDb <= NORMALIZE_TRUE_PEAK_CEILING_DBTP + 0.25, `post true peak ${post.truePeakDb} must respect the ceiling`)
  assert.ok(post.lufs < r.targetLufs! - 0.3, 'a capped variant honestly stays quieter than the target')
  // the already-at-target variants are untouched and uncapped
  assert.equal(r.variants[1]!.gainDb, 0)
  assert.equal(r.variants[2]!.gainDb, 0)
  const l = readManifest(dir).variants[0]!.loudness!
  assert.equal(l.capped, true)
  assert.ok(Math.abs((l.wantedGainDb as number) - desired) < 0.05, 'manifest carries the wanted gain')
  // a partially-capped boost names the ceiling, with wanted and applied both printed
  assert.match(formatNormalizationResult(r), /v1 \+\d+\.\d dB applied \(wanted \+\d+\.\d, capped at the -1 dBTP ceiling\)/)
})

test('upward-only cap (pilot 113): an already-hot variant gets +0.0 dB, and the line + summary say why', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-normalize-test-'))
  // v1: quiet sine (low LUFS) with one full-scale spike — true peak ~0 dBTP, already over the -1
  // dBTP ceiling AS RENDERED, while normalization wants a big boost toward the louder median.
  const spiky = sineWav({ seconds: 1, amplitude: 0.1 })
  spiky.writeInt16LE(32767, 44 + 2 * 2 * Math.round(FS / 2)) // one full-scale sample mid-file (L ch)
  writeFileSync(join(dir, 'v1.wav'), spiky)
  writeFileSync(join(dir, 'v2.wav'), sineWav({ seconds: 1, amplitude: 0.4 }))
  writeFileSync(join(dir, 'v3.wav'), sineWav({ seconds: 1, amplitude: 0.4 }))
  writeClipSetBatch(dir, ['v1.wav', 'v2.wav', 'v3.wav'])
  const v1Before = readFileSync(join(dir, 'v1.wav'))

  const r = normalizeBatchLoudness(dir, 3)
  assert.ok(r)
  const v1 = r.variants[0]!
  assert.equal(v1.capped, true)
  assert.equal(v1.gainDb, 0, 'the cap never boosts a variant already over the ceiling')
  assert.ok(v1.wantedGainDb! > 4, `it genuinely wanted a boost (${v1.wantedGainDb})`)
  assert.ok(v1.truePeakDbtp! > NORMALIZE_TRUE_PEAK_CEILING_DBTP, `recorded true peak ${v1.truePeakDbtp} is over the ceiling`)
  assert.ok(v1Before.equals(readFileSync(join(dir, 'v1.wav'))), 'a zero-gain cap leaves the file byte-identical')
  const line = formatNormalizationResult(r)
  // the capped line shows wanted gain, applied gain, and the measured true peak...
  assert.match(line, /v1 \+0\.0 dB applied \(wanted \+\d+\.\d, capped: already at [+-]\d+\.\d dBTP\)/)
  // ...and the summary says the batch still exceeds the ceiling instead of implying it held
  assert.match(line, /exceed -1 dBTP as rendered — the ceiling only caps normalization boosts/)
})

test('silent variant: immeasurable LUFS -> left byte-identical, noted as null in manifest and summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-normalize-test-'))
  writeFileSync(join(dir, 'v1.wav'), sineWav({ seconds: 1, amplitude: 0 }))
  writeFileSync(join(dir, 'v2.wav'), sineWav({ seconds: 1, amplitude: 0.2 }))
  writeFileSync(join(dir, 'v3.wav'), sineWav({ seconds: 1, amplitude: 0.4 }))
  writeClipSetBatch(dir, ['v1.wav', 'v2.wav', 'v3.wav'])
  const silentBefore = readFileSync(join(dir, 'v1.wav'))
  const preV2 = measure(join(dir, 'v2.wav'))

  const r = normalizeBatchLoudness(dir, 3)
  assert.ok(r)
  // the median is over MEASURABLE variants only (v2, v3 -> lower-middle = v2)
  assert.ok(Math.abs(r.targetLufs! - preV2.lufs) < 0.05)
  assert.deepEqual(r.variants[0], { file: 'v1.wav', measuredLufs: null, gainDb: 0, capped: false })
  assert.ok(silentBefore.equals(readFileSync(join(dir, 'v1.wav'))), 'silence must stay byte-identical')
  assert.equal(readManifest(dir).variants[0]!.loudness!.measuredLufs, null)
  assert.match(formatNormalizationResult(r), /v1 silent \(untouched\)/)
})

test('32-bit float renders scale too, and a bare wav dir (no manifest) still normalizes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-normalize-test-'))
  writeFileSync(join(dir, 'v1.wav'), sineWav({ seconds: 1, amplitude: 0.1, float: true }))
  writeFileSync(join(dir, 'v2.wav'), sineWav({ seconds: 1, amplitude: 0.4, float: true }))
  const preV1 = measure(join(dir, 'v1.wav'))

  const r = normalizeBatchLoudness(dir, 2)
  assert.ok(r)
  // even count: the LOWER-middle measurable variant is the target (always an actual variant's level)
  assert.ok(Math.abs(r.targetLufs! - preV1.lufs) < 0.05)
  assert.equal(r.variants[0]!.gainDb, 0)
  assert.ok(r.variants[1]!.gainDb < -11, `v2 pulled down ~12 dB (${r.variants[1]!.gainDb})`)
  const post = measure(join(dir, 'v2.wav'))
  assert.ok(Math.abs(post.lufs - r.targetLufs!) < 0.15, `v2 post-LUFS ${post.lufs}`)
})

// ---- pilot 113: --no-normalize leaves a measured trail, and render --batch stops lying --------

test('measureBatchLoudness (--no-normalize): bytes untouched, levels recorded with gainDb 0 and normalized: false, line says so', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-normalize-test-'))
  writeFileSync(join(dir, 'v1.wav'), sineWav({ seconds: 1, amplitude: 0.1 }))
  writeFileSync(join(dir, 'v2.wav'), sineWav({ seconds: 1, amplitude: 0.4 }))
  writeClipSetBatch(dir, ['v1.wav', 'v2.wav'])
  const before = [1, 2].map((n) => readFileSync(join(dir, `v${n}.wav`)))
  const pre = [1, 2].map((n) => measure(join(dir, `v${n}.wav`)))

  const r = measureBatchLoudness(dir, 2)
  assert.ok(r)
  assert.equal(r.normalized, false)
  assert.equal(r.targetLufs, undefined, 'a raw batch has no target')
  for (const n of [1, 2]) {
    assert.ok(before[n - 1]!.equals(readFileSync(join(dir, `v${n}.wav`))), `v${n} must stay byte-identical`)
    assert.equal(r.variants[n - 1]!.gainDb, 0)
    assert.ok(Math.abs(r.variants[n - 1]!.measuredLufs! - pre[n - 1]!.lufs) < 0.05, `v${n} measuredLufs`)
  }
  // the manifest records the raw levels AND that this batch is deliberately not normalized —
  // distinguishable from a pre-normalization batch, with a measured-LUFS trail either way
  const m = readManifest(dir)
  assert.deepEqual(m.normalization, { truePeakCeilingDbtp: NORMALIZE_TRUE_PEAK_CEILING_DBTP, normalized: false })
  assert.equal(m.variants[0]!.loudness!.gainDb, 0)
  assert.ok(typeof m.variants[0]!.loudness!.measuredLufs === 'number')
  assert.match(formatNormalizationResult(r), /^not loudness-normalized .*: v1 -\d+\.\d LUFS, v2 -\d+\.\d LUFS/)
})

test('refreshBatchLoudnessAfterRender: a re-render of a normalized batch re-lands on the manifest\'s STORED target', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-normalize-test-'))
  writeFileSync(join(dir, 'v1.wav'), sineWav({ seconds: 1, amplitude: 0.1 }))
  writeFileSync(join(dir, 'v2.wav'), sineWav({ seconds: 1, amplitude: 0.2 }))
  writeFileSync(join(dir, 'v3.wav'), sineWav({ seconds: 1, amplitude: 0.4 }))
  writeClipSetBatch(dir, ['v1.wav', 'v2.wav', 'v3.wav'])
  const first = normalizeBatchLoudness(dir, 3)
  assert.ok(first)
  const storedTarget = readManifest(dir).normalization!.targetLufs!

  // simulate `beat render --batch` re-rendering the batch: fresh RAW wavs at different levels
  // (renders are nondeterministic) — this used to leave them raw while the manifest kept
  // describing the normalized audio (pilot 113 HIGH)
  writeFileSync(join(dir, 'v1.wav'), sineWav({ seconds: 1, amplitude: 0.05 }))
  writeFileSync(join(dir, 'v2.wav'), sineWav({ seconds: 1, amplitude: 0.15 }))
  writeFileSync(join(dir, 'v3.wav'), sineWav({ seconds: 1, amplitude: 0.3 }))
  const r = refreshBatchLoudnessAfterRender(dir, 3)
  assert.ok(r)
  assert.equal(r.normalized, true)
  assert.equal(r.basis, 'manifest target', 'a re-render honors the recorded target, not a fresh median')
  assert.equal(r.targetLufs, storedTarget)
  for (const n of [1, 2, 3]) {
    const post = measure(join(dir, `v${n}.wav`))
    assert.ok(Math.abs(post.lufs - storedTarget) < 0.15, `v${n} re-lands on the stored target (${post.lufs} vs ${storedTarget})`)
  }
  // and the manifest's loudness fields describe the NEW audio
  const m = readManifest(dir)
  assert.equal(m.normalization!.targetLufs, storedTarget)
  assert.notEqual(m.variants[0]!.loudness!.measuredLufs, first.variants[0]!.measuredLufs)
})

test('refreshBatchLoudnessAfterRender: normalize false re-records the batch honestly as raw; a raw batch stays raw; no record = untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-normalize-test-'))
  writeFileSync(join(dir, 'v1.wav'), sineWav({ seconds: 1, amplitude: 0.1 }))
  writeFileSync(join(dir, 'v2.wav'), sineWav({ seconds: 1, amplitude: 0.4 }))
  writeClipSetBatch(dir, ['v1.wav', 'v2.wav'])

  // a manifest with NO normalization record (first render — vary's child call) is left alone
  assert.equal(refreshBatchLoudnessAfterRender(dir, 2), null)
  assert.equal(readManifest(dir).normalization, undefined)

  // --no-normalize on a previously NORMALIZED batch: bytes untouched, record flips to raw
  normalizeBatchLoudness(dir, 2)
  writeFileSync(join(dir, 'v2.wav'), sineWav({ seconds: 1, amplitude: 0.4 })) // "re-render"
  const raw = refreshBatchLoudnessAfterRender(dir, 2, { normalize: false })
  assert.ok(raw)
  assert.equal(raw.normalized, false)
  const m = readManifest(dir)
  assert.equal(m.normalization!.normalized, false)
  assert.equal(m.normalization!.targetLufs, undefined, 'the stale target is dropped')
  const v2Raw = measure(join(dir, 'v2.wav'))
  assert.ok(Math.abs(v2Raw.lufs - (m.variants[1]!.loudness!.measuredLufs as number)) < 0.05, 'manifest records the raw level')

  // a batch RECORDED as raw stays raw on the default path (no flag needed)
  const v2Before = readFileSync(join(dir, 'v2.wav'))
  const again = refreshBatchLoudnessAfterRender(dir, 2)
  assert.ok(again)
  assert.equal(again.normalized, false)
  assert.ok(v2Before.equals(readFileSync(join(dir, 'v2.wav'))), 'default re-render of a raw batch applies no gain')
})

test('nothing measurable (all silent / nothing rendered) -> null, files untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-normalize-test-'))
  writeFileSync(join(dir, 'v1.wav'), sineWav({ seconds: 1, amplitude: 0 }))
  const before = readFileSync(join(dir, 'v1.wav'))
  assert.equal(normalizeBatchLoudness(dir, 1), null)
  assert.ok(before.equals(readFileSync(join(dir, 'v1.wav'))))
  assert.equal(normalizeBatchLoudness(mkdtempSync(join(tmpdir(), 'beat-normalize-test-')), 3), null)
})
