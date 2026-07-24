// WAV decoder tests — the integer-PCM bit depths (16 / 24 / 32) and IEEE float, plus the
// WAVE_FORMAT_EXTENSIBLE tag. The 24-bit case is the regression guard for the "24-bit basslines
// decode as mostly silent" bug: the old decoder rejected format-1/24-bit outright, so a whole
// pack of 24-bit loops failed to decode (and downstream read as silence). See src/metrics/wav.ts.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeWav, WavDecodeError } from '../src/metrics/wav.js'

const FS = 44100

/** Build a mono WAV of a -6 dBFS (amp 0.5) sine at the given int/float encoding. `extensible`
 * wraps it in a WAVE_FORMAT_EXTENSIBLE fmt chunk carrying the real format in its SubFormat GUID. */
function makeWav(opts: { format: 1 | 3; bits: 16 | 24 | 32 | 64; extensible?: boolean; seconds?: number }): Uint8Array {
  const { format, bits, extensible } = opts
  const seconds = opts.seconds ?? 1
  const n = Math.round(seconds * FS)
  const bytesPer = bits / 8
  const dataSize = n * bytesPer
  const fmtSize = extensible ? 40 : 16
  const buf = Buffer.alloc(12 + (8 + fmtSize) + (8 + dataSize))
  let o = 0
  buf.write('RIFF', o); o += 4
  buf.writeUInt32LE(buf.length - 8, o); o += 4
  buf.write('WAVE', o); o += 4
  buf.write('fmt ', o); o += 4
  buf.writeUInt32LE(fmtSize, o); o += 4
  buf.writeUInt16LE(extensible ? 0xfffe : format, o); o += 2
  buf.writeUInt16LE(1, o); o += 2 // channels
  buf.writeUInt32LE(FS, o); o += 4
  buf.writeUInt32LE(FS * bytesPer, o); o += 4
  buf.writeUInt16LE(bytesPer, o); o += 2 // block align
  buf.writeUInt16LE(bits, o); o += 2
  if (extensible) {
    buf.writeUInt16LE(22, o); o += 2 // cbSize
    buf.writeUInt16LE(bits, o); o += 2 // valid bits per sample
    buf.writeUInt32LE(0, o); o += 4 // channel mask
    buf.writeUInt16LE(format, o); o += 2 // SubFormat GUID: first 2 bytes = real format tag
    o += 14 // rest of the GUID (unused by the decoder)
  }
  buf.write('data', o); o += 4
  buf.writeUInt32LE(dataSize, o); o += 4
  for (let i = 0; i < n; i++) {
    const v = 0.5 * Math.sin((2 * Math.PI * 440 * i) / FS)
    if (format === 3) {
      if (bits === 32) { buf.writeFloatLE(v, o); o += 4 }
      else { buf.writeDoubleLE(v, o); o += 8 }
    } else if (bits === 16) {
      buf.writeInt16LE(Math.round(v * 0x8000), o); o += 2
    } else if (bits === 24) {
      const s = Math.round(v * 0x800000) & 0xffffff
      buf.writeUInt8(s & 0xff, o); buf.writeUInt8((s >> 8) & 0xff, o + 1); buf.writeUInt8((s >> 16) & 0xff, o + 2); o += 3
    } else {
      buf.writeInt32LE(Math.round(v * 0x80000000), o); o += 4
    }
  }
  return new Uint8Array(buf)
}

function peak(channels: Float64Array[]): number {
  let p = 0
  for (const ch of channels) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]!))
  return p
}

test('24-bit PCM decodes to full amplitude, not silence (the 24-bit-bassline regression)', () => {
  const { channels, sampleRate } = decodeWav(makeWav({ format: 1, bits: 24 }))
  assert.equal(sampleRate, FS)
  assert.equal(channels.length, 1)
  // a -6 dBFS sine must read back at ~0.5 peak — the bug had this decoding as ~0 (silent)
  assert.ok(Math.abs(peak(channels) - 0.5) < 0.01, `24-bit peak ${peak(channels)} (want ~0.5, not silent)`)
})

test('24-bit sign-extension is correct: negative samples round-trip', () => {
  // a value near -0.5 must come back negative, not as a large positive (missing sign extension)
  const { channels } = decodeWav(makeWav({ format: 1, bits: 24 }))
  const min = Math.min(...channels[0]!)
  assert.ok(min < -0.4, `24-bit min sample ${min} — expected a genuine negative (sign-extended) value`)
})

test('16 / 32-bit PCM and 32 / 64-bit float all decode to ~0.5 peak', () => {
  for (const opts of [
    { format: 1, bits: 16 },
    { format: 1, bits: 32 },
    { format: 3, bits: 32 },
    { format: 3, bits: 64 },
  ] as const) {
    const { channels } = decodeWav(makeWav(opts))
    assert.ok(Math.abs(peak(channels) - 0.5) < 0.01, `${opts.format}/${opts.bits} peak ${peak(channels)}`)
  }
})

test('WAVE_FORMAT_EXTENSIBLE 24-bit PCM decodes via its SubFormat tag', () => {
  const { channels } = decodeWav(makeWav({ format: 1, bits: 24, extensible: true }))
  assert.ok(Math.abs(peak(channels) - 0.5) < 0.01, `extensible-24 peak ${peak(channels)}`)
})

test('a genuinely unsupported encoding still throws WavDecodeError', () => {
  // format 2 (ADPCM) is not something we decode — must be an explicit, typed error
  const w = makeWav({ format: 1, bits: 16 })
  w[20] = 2 // clobber the format tag to 2 (MS ADPCM)
  assert.throws(() => decodeWav(w), WavDecodeError)
})
