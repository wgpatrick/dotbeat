// Minimal WAV reader for the metrics engine — integer PCM (16 / 24 / 32-bit) plus IEEE float
// (32 / 64-bit). Pure, zero deps.
//
// 24-bit PCM support (Phase — pathology screens): the ref-pool packs ship overwhelmingly as
// 24-bit PCM (137 of 165 refs-packs files) and a 24-bit bassline pack was reported "mostly silent"
// by an audibility guard — the cause was this decoder rejecting anything but 16-bit PCM / 32-bit
// float outright, so every 24-bit file failed to decode. WAVE_FORMAT_EXTENSIBLE (0xFFFE) is also
// handled by reading the real sample format out of the extension's SubFormat GUID (its first two
// bytes are the underlying format tag), which is how most modern 24-bit encoders tag their files.

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

export function decodeWav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (off: number, len: number) => String.fromCharCode(...bytes.subarray(off, off + len))
  if (bytes.length < 44 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') throw new WavDecodeError('not a RIFF/WAVE file')

  // walk chunks: fmt then data (a canonical 44-byte header is the common case, but be tolerant
  // of extra chunks like LIST/fact)
  let off = 12
  let fmt: { format: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null
  let dataOff = -1
  let dataLen = -1
  while (off + 8 <= bytes.length) {
    const id = ascii(off, 4)
    const size = view.getUint32(off + 4, true)
    if (id === 'fmt ') {
      let format = view.getUint16(off + 8, true)
      // WAVE_FORMAT_EXTENSIBLE: the real sample format lives in the SubFormat GUID (first 2 bytes
      // are the underlying tag). Its cbSize/extension starts at fmt data offset +16 (byte off+24),
      // the SubFormat GUID at +24 (byte off+32). Guard on the extension actually being present.
      if (format === 0xfffe && size >= 40) format = view.getUint16(off + 8 + 24, true)
      fmt = {
        format,
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
  dataLen = Math.min(dataLen, bytes.length - dataOff) // tolerate truncated writes

  const { format, channels: numCh, sampleRate, bitsPerSample } = fmt
  const isPcm = format === 1
  const isFloat = format === 3
  // Per-format sample readers, all normalizing to -1..1 float. Integer PCM is little-endian signed;
  // 24-bit is 3 bytes with an explicit sign-extend (DataView has no getInt24).
  let readSample: (p: number) => number
  if (isPcm && bitsPerSample === 16) readSample = (p) => view.getInt16(p, true) / 32768
  else if (isPcm && bitsPerSample === 24)
    readSample = (p) => {
      const u = bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16)
      return (u & 0x800000 ? u - 0x1000000 : u) / 0x800000 // sign-extend from bit 23, /2^23
    }
  else if (isPcm && bitsPerSample === 32) readSample = (p) => view.getInt32(p, true) / 0x80000000
  else if (isFloat && bitsPerSample === 32) readSample = (p) => view.getFloat32(p, true)
  else if (isFloat && bitsPerSample === 64) readSample = (p) => view.getFloat64(p, true)
  else throw new WavDecodeError(`unsupported wav encoding: format ${format}, ${bitsPerSample}-bit (need 16/24/32-bit PCM or 32/64-bit float)`)

  const bytesPerSample = bitsPerSample / 8
  const frames = Math.floor(dataLen / (bytesPerSample * numCh))
  const channels = Array.from({ length: numCh }, () => new Float64Array(frames))
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      channels[c]![i] = readSample(dataOff + (i * numCh + c) * bytesPerSample)
    }
  }
  return { sampleRate, channels, durationSeconds: frames / sampleRate }
}
