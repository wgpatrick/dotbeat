// Eval-integrity regressions (2026-07-26 adversarial hunt). Every test here is a port of a
// runnable repro that demonstrated a way the blind taste/showdown pipeline could quietly record a
// number it hadn't actually earned — a partially-gained batch, a failed batch that stayed
// rateable, a D25-excluded clip becoming training data, a retracted ranking still counting, a
// self-comparison counted as evidence, a hard-cut ref clip, a boosted silence entering a batch.
// They are grouped by the hunt's finding ids (H1/H2/H3/M3/M4/M5/M7/M1/L3) so a future reader can
// trace each assertion back to the failure it encodes.

import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyWavGain, assertWavGainable, normalizeBatchLoudness } from '../src/vary/batch.js'
import { decodeWav, readWavFormat } from '../src/metrics/index.js'
import { matchClipDurations } from '../src/taste/showdown.js'

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
