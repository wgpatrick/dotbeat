// Minimal WAV reader for the metrics engine — integer PCM (16 / 24 / 32-bit) plus IEEE float
// (32 / 64-bit). Pure, zero deps.
//
// 24-bit PCM support (Phase — pathology screens): the ref-pool packs ship overwhelmingly as
// 24-bit PCM (137 of 165 refs-packs files) and a 24-bit bassline pack was reported "mostly silent"
// by an audibility guard — the cause was this decoder rejecting anything but 16-bit PCM / 32-bit
// float outright, so every 24-bit file failed to decode. WAVE_FORMAT_EXTENSIBLE (0xFFFE) is also
// handled by reading the real sample format out of the extension's SubFormat GUID (its first two
// bytes are the underlying format tag), which is how most modern 24-bit encoders tag their files.
//
// ONE READER, ONE FORMAT-SUPPORT SURFACE (2026-07-26 eval-integrity hunt, H1): `applyWavGain`
// (src/vary/batch.ts) and `readWavData` (src/taste/showdown.ts) each used to re-implement a
// NARROWER chunk walk than this one — no WAVE_FORMAT_EXTENSIBLE, no 32-bit-int arm. A real pool
// file (refs-packs/lead/BOS_ISL_125_*_Fm.wav, 24-bit EXTENSIBLE) therefore passed every selection
// gate that goes through decodeWav and then threw mid-normalization, leaving a partially-gained
// blind batch on disk. `readWavFormat` + `wavSampleCodec` below are that shared surface: every
// wav-touching module parses headers and reads/writes samples through them, so a format either
// works everywhere or is rejected everywhere. Adding a format means editing THIS file only.

export interface DecodedWav {
  sampleRate: number
  /** One Float64Array per channel, samples in -1..1. */
  channels: Float64Array[]
  durationSeconds: number
}

export class WavDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WavDecodeError'
  }
}

/** Everything a wav-touching module needs to read OR rewrite a file's samples without re-walking
 * its chunks: the EFFECTIVE sample format (WAVE_FORMAT_EXTENSIBLE already resolved), the geometry,
 * and where the data chunk's payload sits in the original byte buffer. */
export interface WavFormatInfo {
  /** Effective format tag — 1 = integer PCM, 3 = IEEE float. WAVE_FORMAT_EXTENSIBLE is resolved
   * to the SubFormat GUID's underlying tag, so callers never special-case 0xFFFE. */
  format: number
  /** The tag exactly as stored in the fmt chunk (0xFFFE for EXTENSIBLE) — for diagnostics, and
   * for writers that must emit a plain 16-byte fmt chunk instead of the extensible one. */
  rawFormat: number
  channels: number
  sampleRate: number
  bitsPerSample: number
  bytesPerSample: number
  /** bytes per FRAME (all channels) */
  blockAlign: number
  /** byte offset of the data chunk's payload within the buffer this was parsed from */
  dataOffset: number
  /** payload length in bytes, clamped to what the buffer actually holds (truncated writes) */
  dataLength: number
  /** whole frames available: floor(dataLength / blockAlign) */
  frames: number
}

/** Byte-level sample accessors for ONE decoded format, bound to one buffer. `read` normalizes to
 * -1..1; `write` takes -1..1 and clamps into the format's representable range (integer PCM wraps
 * catastrophically otherwise — a boosted peak flips sign). */
export interface WavSampleCodec {
  read(byteOffset: number): number
  write(byteOffset: number, value: number): void
}

/** Parse a RIFF/WAVE header: chunk walk (tolerant of LIST/fact and any other extra chunks),
 * EXTENSIBLE resolution, and a support check against the ONE format list this module implements.
 * Throws WavDecodeError for anything unreadable — callers wrap it in their own error type. */
export function readWavFormat(bytes: Uint8Array): WavFormatInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (off: number, len: number) => String.fromCharCode(...bytes.subarray(off, off + len))
  if (bytes.length < 44 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') throw new WavDecodeError('not a RIFF/WAVE file')

  // walk chunks: fmt then data (a canonical 44-byte header is the common case, but be tolerant
  // of extra chunks like LIST/fact)
  let off = 12
  let fmt: { format: number; rawFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null
  let dataOff = -1
  let dataLen = -1
  while (off + 8 <= bytes.length) {
    const id = ascii(off, 4)
    const size = view.getUint32(off + 4, true)
    if (id === 'fmt ') {
      const rawFormat = view.getUint16(off + 8, true)
      let format = rawFormat
      // WAVE_FORMAT_EXTENSIBLE: the real sample format lives in the SubFormat GUID (first 2 bytes
      // are the underlying tag). Its cbSize/extension starts at fmt data offset +16 (byte off+24),
      // the SubFormat GUID at +24 (byte off+32). Guard on the extension actually being present.
      if (format === 0xfffe && size >= 40) format = view.getUint16(off + 8 + 24, true)
      fmt = {
        format,
        rawFormat,
        channels: view.getUint16(off + 10, true),
        sampleRate: view.getUint32(off + 12, true),
        bitsPerSample: view.getUint16(off + 22, true),
      }
    } else if (id === 'data') {
      dataOff = off + 8
      dataLen = size
    }
    off += 8 + size + (size % 2) // chunks are word-aligned
  }
  if (!fmt) throw new WavDecodeError('no fmt chunk')
  if (dataOff === -1) throw new WavDecodeError('no data chunk')
  dataLen = Math.max(0, Math.min(dataLen, bytes.length - dataOff)) // tolerate truncated writes

  const { format, bitsPerSample, channels } = fmt
  const supported =
    (format === 1 && (bitsPerSample === 16 || bitsPerSample === 24 || bitsPerSample === 32)) || (format === 3 && (bitsPerSample === 32 || bitsPerSample === 64))
  if (!supported) {
    throw new WavDecodeError(
      `unsupported wav encoding: format ${format}${fmt.rawFormat === 0xfffe ? ' (WAVE_FORMAT_EXTENSIBLE)' : ''}, ${bitsPerSample}-bit (need 16/24/32-bit PCM or 32/64-bit float)`,
    )
  }
  if (channels < 1) throw new WavDecodeError(`wav declares ${channels} channels`)
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = bytesPerSample * channels
  return { ...fmt, bytesPerSample, blockAlign, dataOffset: dataOff, dataLength: dataLen, frames: Math.floor(dataLen / blockAlign) }
}

/** Per-format sample read/write for `bytes`, normalizing to -1..1. Integer PCM is little-endian
 * signed; 24-bit is 3 bytes with an explicit sign-extend (DataView has no getInt24/setInt24). */
export function wavSampleCodec(bytes: Uint8Array, info: Pick<WavFormatInfo, 'format' | 'bitsPerSample'>): WavSampleCodec {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const { format, bitsPerSample } = info
  // Integer writers clamp to the format's range: a pure gain that pushes a sample past full scale
  // must saturate, never wrap (a wrapped peak flips sign and is audible as a click).
  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
  if (format === 1 && bitsPerSample === 16) {
    return {
      read: (p) => view.getInt16(p, true) / 32768,
      write: (p, v) => view.setInt16(p, clamp(Math.round(v * 32768), -32768, 32767), true),
    }
  }
  if (format === 1 && bitsPerSample === 24) {
    return {
      read: (p) => {
        const u = bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16)
        return (u & 0x800000 ? u - 0x1000000 : u) / 0x800000 // sign-extend from bit 23, /2^23
      },
      write: (p, v) => {
        const s = clamp(Math.round(v * 0x800000), -0x800000, 0x7fffff)
        bytes[p] = s & 0xff
        bytes[p + 1] = (s >> 8) & 0xff
        bytes[p + 2] = (s >> 16) & 0xff
      },
    }
  }
  if (format === 1 && bitsPerSample === 32) {
    return {
      read: (p) => view.getInt32(p, true) / 0x80000000,
      write: (p, v) => view.setInt32(p, clamp(Math.round(v * 0x80000000), -0x80000000, 0x7fffffff), true),
    }
  }
  if (format === 3 && bitsPerSample === 32) {
    return { read: (p) => view.getFloat32(p, true), write: (p, v) => view.setFloat32(p, v, true) }
  }
  if (format === 3 && bitsPerSample === 64) {
    return { read: (p) => view.getFloat64(p, true), write: (p, v) => view.setFloat64(p, v, true) }
  }
  throw new WavDecodeError(`unsupported wav encoding: format ${format}, ${bitsPerSample}-bit (need 16/24/32-bit PCM or 32/64-bit float)`)
}

export function decodeWav(bytes: Uint8Array): DecodedWav {
  const info = readWavFormat(bytes)
  const codec = wavSampleCodec(bytes, info)
  const { channels: numCh, sampleRate, bytesPerSample, dataOffset, frames } = info
  const channels = Array.from({ length: numCh }, () => new Float64Array(frames))
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      channels[c]![i] = codec.read(dataOffset + (i * numCh + c) * bytesPerSample)
    }
  }
  return { sampleRate, channels, durationSeconds: frames / sampleRate }
}
