// Phase 35 Stream OC: the contact-sheet audition WAV — stitchAudition's frame math, header
// writing, and index generation, proven on tiny synthetic wavs (no real renders in CI: a render
// is a real-time Chromium capture; the stitcher itself is pure byte/frame arithmetic, so
// synthetic PCM exercises every branch the real path uses).

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { stitchAudition, formatTimecode, formatAuditionIndex, AUDITION_GAP_SECONDS } from '../src/vary/audition.js'
import { BeatBatchError } from '../src/vary/batch.js'
import { decodeWav } from '../src/metrics/index.js'

/** Build a minimal canonical WAV: every sample in every channel set to `value`. */
function makeWav(opts: { sampleRate: number; channels: number; frames: number; value: number; float?: boolean }): Buffer {
  const bytesPerSample = opts.float ? 4 : 2
  const blockAlign = bytesPerSample * opts.channels
  const dataLen = opts.frames * blockAlign
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataLen, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(opts.float ? 3 : 1, 20)
  buf.writeUInt16LE(opts.channels, 22)
  buf.writeUInt32LE(opts.sampleRate, 24)
  buf.writeUInt32LE(opts.sampleRate * blockAlign, 28)
  buf.writeUInt16LE(blockAlign, 32)
  buf.writeUInt16LE(bytesPerSample * 8, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataLen, 40)
  for (let i = 0; i < opts.frames * opts.channels; i++) {
    if (opts.float) buf.writeFloatLE(opts.value, 44 + i * 4)
    else buf.writeInt16LE(opts.value, 44 + i * 2)
  }
  return buf
}

test('stitchAudition: pure PCM concat with 0.5s gaps — exact frame math, correct index, decodable result', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-audition-test-'))
  const sampleRate = 8000
  const frames = 800 // 0.1 s each
  for (let i = 1; i <= 3; i++) {
    writeFileSync(join(dir, `v${i}.wav`), makeWav({ sampleRate, channels: 2, frames, value: i * 1000 }))
  }

  const r = stitchAudition(dir, 3)
  assert.equal(r.gapSeconds, AUDITION_GAP_SECONDS)
  assert.equal(r.sampleRate, sampleRate)

  // index: v1 at 0, then each start = previous start + 0.1s variant + 0.5s gap
  assert.deepEqual(
    r.entries.map((e) => [e.variant, e.startSeconds, e.timecode, e.durationSeconds]),
    [
      ['v1', 0, '0:00.0', 0.1],
      ['v2', 0.6, '0:00.6', 0.1],
      ['v3', 1.2, '0:01.2', 0.1],
    ],
  )
  assert.equal(r.totalSeconds, 1.3)

  // the stitched wav decodes, has exactly sum(variants) + 2 gaps worth of frames, and the
  // samples sit at the indexed positions with pure silence in the gaps
  const decoded = decodeWav(readFileSync(r.wavPath))
  assert.equal(decoded.sampleRate, sampleRate)
  assert.equal(decoded.channels.length, 2)
  const gapFrames = Math.round(AUDITION_GAP_SECONDS * sampleRate)
  assert.equal(decoded.channels[0]!.length, 3 * frames + 2 * gapFrames)
  const at = (frame: number) => Math.round(decoded.channels[0]![frame]! * 32768)
  assert.equal(at(0), 1000)
  assert.equal(at(frames - 1), 1000)
  assert.equal(at(frames), 0, 'first gap starts right after v1')
  assert.equal(at(frames + gapFrames - 1), 0, 'gap is silent through its last frame')
  assert.equal(at(frames + gapFrames), 2000, 'v2 starts exactly one gap after v1 ends')
  assert.equal(at(2 * frames + 2 * gapFrames), 3000, 'v3 starts exactly where the index says')

  // audition.json carries the same map
  const json = JSON.parse(readFileSync(r.jsonPath, 'utf8'))
  assert.equal(json.gapSeconds, AUDITION_GAP_SECONDS)
  assert.equal(json.sampleRate, sampleRate)
  assert.deepEqual(json.entries, r.entries)

  // the printed line names every variant at its timecode
  const line = formatAuditionIndex(r)
  assert.match(line, /audition\.wav \(0:01\.3\): v1 @ 0:00\.0, v2 @ 0:00\.6, v3 @ 0:01\.2 — index in .*audition\.json/)
})

test('stitchAudition: 32-bit float renders concatenate too (gaps are zero bytes in either encoding)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-audition-float-'))
  writeFileSync(join(dir, 'v1.wav'), makeWav({ sampleRate: 4000, channels: 1, frames: 400, value: 0.25, float: true }))
  writeFileSync(join(dir, 'v2.wav'), makeWav({ sampleRate: 4000, channels: 1, frames: 400, value: -0.5, float: true }))
  const r = stitchAudition(dir, 2)
  const decoded = decodeWav(readFileSync(r.wavPath))
  assert.equal(decoded.channels[0]!.length, 800 + 2000)
  assert.equal(decoded.channels[0]![0], 0.25)
  assert.equal(decoded.channels[0]![500], 0, 'gap is silent')
  assert.equal(decoded.channels[0]![2400], -0.5)
  assert.deepEqual(r.entries.map((e) => e.timecode), ['0:00.0', '0:00.6'])
})

test('stitchAudition fails loudly on a missing render and on mismatched formats', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-audition-err-'))
  writeFileSync(join(dir, 'v1.wav'), makeWav({ sampleRate: 8000, channels: 2, frames: 100, value: 1 }))
  assert.throws(() => stitchAudition(dir, 2), (err: unknown) => err instanceof BeatBatchError && /missing rendered wav: .*v2\.wav/.test((err as Error).message))

  writeFileSync(join(dir, 'v2.wav'), makeWav({ sampleRate: 44100, channels: 2, frames: 100, value: 1 }))
  assert.throws(
    () => stitchAudition(dir, 2),
    (err: unknown) => err instanceof BeatBatchError && /v2\.wav differs from v1\.wav \(44100 Hz/.test((err as Error).message),
  )
})

test('formatTimecode floors to tenths and pads seconds', () => {
  assert.equal(formatTimecode(0), '0:00.0')
  assert.equal(formatTimecode(9.26), '0:09.2')
  assert.equal(formatTimecode(59.99), '0:59.9')
  assert.equal(formatTimecode(60), '1:00.0')
  assert.equal(formatTimecode(69.97), '1:09.9')
})
