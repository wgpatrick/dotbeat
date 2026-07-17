// Contact-sheet audition WAV (Phase 35 Stream OC — the owner's #1 ergonomic ask from the first
// real dogfood session): after a rendered vary batch, stitch v1.wav..vN.wav into ONE audition.wav
// in pick order with a short silence between variants, plus a timecode index (printed by the
// caller and written as audition.json) so "the one at 0:27" is a usable way to talk about a
// variant. Pure PCM concatenation — the vN.wavs come from the same render path on the same
// project, so sample rate / channel count / bit depth match by construction (verified anyway,
// fail-loudly), and a silence gap is just zero bytes in both 16-bit PCM and 32-bit float. No
// decoding, no resampling, no DSP: frame math on the raw data chunks.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BeatBatchError } from './batch.js'

/** Silence between stitched variants, in seconds. */
export const AUDITION_GAP_SECONDS = 0.5

interface WavChunks {
  formatTag: number // 1 = PCM, 3 = IEEE float
  channels: number
  sampleRate: number
  bitsPerSample: number
  blockAlign: number
  /** Raw data-chunk bytes, truncated to whole frames. */
  data: Uint8Array
}

/** Minimal RIFF walk (same tolerance as src/metrics/wav.ts: fmt + data, extra chunks skipped),
 * but keeping the data chunk as raw bytes — concatenation never needs the samples decoded. */
function readWavChunks(path: string): WavChunks {
  let bytes: Uint8Array
  try {
    bytes = readFileSync(path)
  } catch {
    throw new BeatBatchError(`missing rendered wav: ${path} — audition needs every variant rendered first`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (off: number, len: number) => String.fromCharCode(...bytes.subarray(off, off + len))
  if (bytes.length < 44 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') throw new BeatBatchError(`${path} is not a RIFF/WAVE file`)
  let off = 12
  let fmt: { formatTag: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null
  let data: Uint8Array | null = null
  while (off + 8 <= bytes.length) {
    const id = ascii(off, 4)
    const size = view.getUint32(off + 4, true)
    if (id === 'fmt ') {
      fmt = {
        formatTag: view.getUint16(off + 8, true),
        channels: view.getUint16(off + 10, true),
        sampleRate: view.getUint32(off + 12, true),
        bitsPerSample: view.getUint16(off + 22, true),
      }
    } else if (id === 'data') {
      data = bytes.subarray(off + 8, off + 8 + Math.min(size, bytes.length - off - 8))
    }
    off += 8 + size + (size % 2) // chunks are word-aligned
  }
  if (!fmt) throw new BeatBatchError(`${path}: no fmt chunk`)
  if (!data) throw new BeatBatchError(`${path}: no data chunk`)
  if (fmt.formatTag !== 1 && fmt.formatTag !== 3) {
    throw new BeatBatchError(`${path}: unsupported wav encoding (format ${fmt.formatTag}; need 16-bit PCM or 32-bit float)`)
  }
  const blockAlign = (fmt.bitsPerSample / 8) * fmt.channels
  const wholeFrames = Math.floor(data.length / blockAlign) * blockAlign
  return { ...fmt, blockAlign, data: data.subarray(0, wholeFrames) }
}

/** "m:ss.t" — minutes unpadded, seconds two digits, tenths one digit, floored (0:00.0, 0:09.2,
 * 1:03.7). Floored so a printed timecode never points past the variant's actual start. */
export function formatTimecode(seconds: number): string {
  const tenths = Math.floor(seconds * 10)
  const m = Math.floor(tenths / 600)
  const s = Math.floor((tenths % 600) / 10)
  const t = tenths % 10
  return `${m}:${String(s).padStart(2, '0')}.${t}`
}

export interface AuditionEntry {
  variant: string // "v1"
  wav: string // "v1.wav"
  startSeconds: number
  timecode: string
  durationSeconds: number
}

export interface AuditionResult {
  wavPath: string
  jsonPath: string
  sampleRate: number
  gapSeconds: number
  totalSeconds: number
  entries: AuditionEntry[]
}

/** Deterministic seeded RNG for reproducible presentation shuffles. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates over 1..count, seeded — the presentation order for a blind audition. Exported so
 * tests (and any future GUI audition view) reproduce the exact order a given seed stitches. */
export function shuffledOrder(count: number, seed: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i + 1)
  const rng = mulberry32(seed)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  return order
}

export interface StitchOptions {
  gapSeconds?: number
  /** Presentation order as 1-based variant numbers (e.g. [3,1,2]). Overrides shuffleSeed. */
  order?: number[]
  /** T0 taste-loop (docs/taste-loop-design.md L1): shuffle presentation order with this seed so
   * listening position decouples from generation order — v1..vN are seed-monotone, and unshuffled
   * auditions bake position bias into every pick. The mapping stays fully recoverable: entries /
   * audition.json list which variant sits at which timecode, and scoring still uses variant ids. */
  shuffleSeed?: number
  /** Variant file names when they aren't v1.wav..vN.wav (arbitrary clip-set auditions). Length
   * must equal `count`; index i holds variant i+1's wav file name relative to outDir. */
  files?: string[]
}

/** Stitch outDir's variant renders into outDir/audition.wav (gapSeconds of silence between
 * variants, none before the first or after the last) and write the timecode index to
 * outDir/audition.json. Presentation order is v1..vN unless `order`/`shuffleSeed` says otherwise;
 * entries are listed in PRESENTATION order, each naming its variant, so the index is the
 * blind-listening answer key. Returns the index so callers can print it. */
export function stitchAudition(outDir: string, count: number, opts: StitchOptions = {}): AuditionResult {
  if (count < 1) throw new BeatBatchError('audition needs at least one rendered variant')
  if (opts.files !== undefined && opts.files.length !== count) {
    throw new BeatBatchError(`audition got ${opts.files.length} file names for ${count} variants`)
  }
  const gapSeconds = opts.gapSeconds ?? AUDITION_GAP_SECONDS
  const order = opts.order ?? (opts.shuffleSeed !== undefined ? shuffledOrder(count, opts.shuffleSeed) : Array.from({ length: count }, (_, i) => i + 1))
  if (order.length !== count || new Set(order).size !== count || order.some((n) => !Number.isInteger(n) || n < 1 || n > count)) {
    throw new BeatBatchError(`audition order must be a permutation of 1..${count}`)
  }
  const wavName = (variantNumber: number) => opts.files?.[variantNumber - 1] ?? `v${variantNumber}.wav`
  const wavs = order.map((n) => readWavChunks(resolve(outDir, wavName(n))))
  const first = wavs[0]!
  for (let i = 1; i < wavs.length; i++) {
    const w = wavs[i]!
    if (w.formatTag !== first.formatTag || w.channels !== first.channels || w.sampleRate !== first.sampleRate || w.bitsPerSample !== first.bitsPerSample) {
      throw new BeatBatchError(
        `${wavName(order[i]!)} differs from ${wavName(order[0]!)} (${w.sampleRate} Hz / ${w.channels} ch / ${w.bitsPerSample}-bit vs ${first.sampleRate} Hz / ${first.channels} ch / ${first.bitsPerSample}-bit) — audition only stitches same-format renders from one batch`,
      )
    }
  }

  const gapBytes = Math.round(gapSeconds * first.sampleRate) * first.blockAlign
  const entries: AuditionEntry[] = []
  let dataLength = 0
  for (let i = 0; i < wavs.length; i++) {
    if (i > 0) dataLength += gapBytes
    const startFrames = dataLength / first.blockAlign
    const frames = wavs[i]!.data.length / first.blockAlign
    const startSeconds = startFrames / first.sampleRate
    entries.push({
      variant: `v${order[i]!}`,
      wav: wavName(order[i]!),
      startSeconds,
      timecode: formatTimecode(startSeconds),
      durationSeconds: frames / first.sampleRate,
    })
    dataLength += wavs[i]!.data.length
  }

  // canonical 44-byte header + concatenated data (silence gaps are zero bytes in PCM16 and float32 alike)
  const out = new Uint8Array(44 + dataLength)
  const view = new DataView(out.buffer)
  const writeAscii = (off: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[off + i] = text.charCodeAt(i)
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, first.formatTag, true)
  view.setUint16(22, first.channels, true)
  view.setUint32(24, first.sampleRate, true)
  view.setUint32(28, first.sampleRate * first.blockAlign, true)
  view.setUint16(32, first.blockAlign, true)
  view.setUint16(34, first.bitsPerSample, true)
  writeAscii(36, 'data')
  view.setUint32(40, dataLength, true)
  let cursor = 44
  for (let i = 0; i < wavs.length; i++) {
    if (i > 0) cursor += gapBytes // the gap region is already zero-initialized
    out.set(wavs[i]!.data, cursor)
    cursor += wavs[i]!.data.length
  }

  const wavPath = resolve(outDir, 'audition.wav')
  const jsonPath = resolve(outDir, 'audition.json')
  const totalSeconds = dataLength / first.blockAlign / first.sampleRate
  writeFileSync(wavPath, out)
  writeFileSync(jsonPath, JSON.stringify({ gapSeconds, sampleRate: first.sampleRate, totalSeconds, entries }, null, 2) + '\n')
  return { wavPath, jsonPath, sampleRate: first.sampleRate, gapSeconds, totalSeconds, entries }
}

/** The one-line timecode index both surfaces print: "audition.wav (0:28.1): v1 @ 0:00.0, v2 @ 0:09.2, ...". */
export function formatAuditionIndex(r: AuditionResult): string {
  return `${r.wavPath} (${formatTimecode(r.totalSeconds)}): ${r.entries.map((e) => `${e.variant} @ ${e.timecode}`).join(', ')} — index in ${r.jsonPath}\n`
}
