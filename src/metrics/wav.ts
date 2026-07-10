// Minimal WAV reader for the metrics engine — 16-bit PCM (what beatlab's wavEncode.ts and our
// render path emit) plus 32-bit float for completeness. Pure, zero deps.

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
      fmt = {
        format: view.getUint16(off + 8, true),
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
  const isPcm16 = format === 1 && bitsPerSample === 16
  const isFloat32 = format === 3 && bitsPerSample === 32
  if (!isPcm16 && !isFloat32) throw new WavDecodeError(`unsupported wav encoding: format ${format}, ${bitsPerSample}-bit (need 16-bit PCM or 32-bit float)`)

  const bytesPerSample = bitsPerSample / 8
  const frames = Math.floor(dataLen / (bytesPerSample * numCh))
  const channels = Array.from({ length: numCh }, () => new Float64Array(frames))
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const p = dataOff + (i * numCh + c) * bytesPerSample
      channels[c]![i] = isPcm16 ? view.getInt16(p, true) / 32768 : view.getFloat32(p, true)
    }
  }
  return { sampleRate, channels, durationSeconds: frames / sampleRate }
}
