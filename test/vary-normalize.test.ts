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
  // target = the MEDIAN variant's own LUFS (v2 here)
  assert.ok(Math.abs(r.targetLufs - pre[1]!.lufs) < 0.05, `target ${r.targetLufs} vs v2 ${pre[1]!.lufs}`)
  // the median variant itself is untouched — byte-identical, gain 0
  assert.equal(r.variants[1]!.gainDb, 0)
  assert.ok(v2Before.equals(readFileSync(join(dir, 'v2.wav'))), 'median variant must stay byte-identical')
  // gains point the right way and no cap fired
  assert.ok(r.variants[0]!.gainDb > 4, `v1 boosted (${r.variants[0]!.gainDb})`)
  assert.ok(r.variants[2]!.gainDb < -4, `v3 attenuated (${r.variants[2]!.gainDb})`)
  assert.ok(r.variants.every((v) => v.capped === false))
  // and the files actually land at the target
  for (const n of [1, 2, 3]) {
    const post = measure(join(dir, `v${n}.wav`))
    assert.ok(Math.abs(post.lufs - r.targetLufs) < 0.15, `v${n} post-LUFS ${post.lufs} vs target ${r.targetLufs}`)
  }
  // manifest record: batch-level normalization + per-variant loudness, D21 additive fields
  const m = readManifest(dir)
  assert.deepEqual(m.normalization, { targetLufs: r.targetLufs, truePeakCeilingDbtp: NORMALIZE_TRUE_PEAK_CEILING_DBTP })
  for (let i = 0; i < 3; i++) {
    const l = m.variants[i]!.loudness
    assert.ok(l, `v${i + 1} carries loudness`)
    assert.deepEqual(Object.keys(l).sort(), ['capped', 'gainDb', 'measuredLufs'])
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
  const desired = r.targetLufs - preV1.lufs
  assert.equal(v1.capped, true, 'cap must fire')
  assert.ok(v1.gainDb > 0 && v1.gainDb < desired, `capped gain ${v1.gainDb} must stay below desired ${desired}`)
  const post = measure(join(dir, 'v1.wav'))
  assert.ok(post.truePeakDb <= NORMALIZE_TRUE_PEAK_CEILING_DBTP + 0.25, `post true peak ${post.truePeakDb} must respect the ceiling`)
  assert.ok(post.lufs < r.targetLufs - 0.3, 'a capped variant honestly stays quieter than the target')
  // the already-at-target variants are untouched and uncapped
  assert.equal(r.variants[1]!.gainDb, 0)
  assert.equal(r.variants[2]!.gainDb, 0)
  assert.equal(readManifest(dir).variants[0]!.loudness!.capped, true)
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
  assert.ok(Math.abs(r.targetLufs - preV2.lufs) < 0.05)
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
  assert.ok(Math.abs(r.targetLufs - preV1.lufs) < 0.05)
  assert.equal(r.variants[0]!.gainDb, 0)
  assert.ok(r.variants[1]!.gainDb < -11, `v2 pulled down ~12 dB (${r.variants[1]!.gainDb})`)
  const post = measure(join(dir, 'v2.wav'))
  assert.ok(Math.abs(post.lufs - r.targetLufs) < 0.15, `v2 post-LUFS ${post.lufs}`)
})

test('nothing measurable (all silent / nothing rendered) -> null, files untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-normalize-test-'))
  writeFileSync(join(dir, 'v1.wav'), sineWav({ seconds: 1, amplitude: 0 }))
  const before = readFileSync(join(dir, 'v1.wav'))
  assert.equal(normalizeBatchLoudness(dir, 1), null)
  assert.ok(before.equals(readFileSync(join(dir, 'v1.wav'))))
  assert.equal(normalizeBatchLoudness(mkdtempSync(join(tmpdir(), 'beat-normalize-test-')), 3), null)
})
