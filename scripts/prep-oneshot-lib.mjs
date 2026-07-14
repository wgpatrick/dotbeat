// Shared one-shot sample-prep core (docs/phase-7-plan.md §7.4, extracted Phase 37 Stream RD).
// The trim/fade/peak-normalize/16-bit-WAV pipeline that scripts/prep-oneshot.mjs used to inline,
// now a library both that thin CLI wrapper AND scripts/source-lib.mjs (the `beat source` backend)
// import via runtime dynamic import, so there is exactly ONE prep implementation. Byte-for-byte
// the same output as the pre-extraction script: same trim thresholds, same fade, same WAV header,
// same sidecar shape — prep-oneshot.mjs's behavior is unchanged.

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

export class PrepError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PrepError'
  }
}

/** The default decoder: the SAME node-web-audio-api decoder the offline renderer uses (handles WAV
 * bit depths, AIFF, FLAC, MP3 and resamples), so anything prep-oneshot.mjs writes is guaranteed
 * decodable by our own render pipeline. Returns { sampleRate, channels: Float32Array[] }. */
export async function decodeViaWebAudio(inPath) {
  const { OfflineAudioContext } = await import('node-web-audio-api')
  const ctx = new OfflineAudioContext(2, 44100, 44100)
  const bytes = readFileSync(inPath)
  const decoded = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  return {
    sampleRate: decoded.sampleRate,
    channels: Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i)),
  }
}

/** Trim leading/trailing silence, apply a short fade-out against end-clicks, peak-normalize with
 * headroom, and write a 16-bit PCM WAV to outPath. Returns the metadata a caller needs (sha256,
 * duration, the raw buffer). By default it also writes the provenance sidecar at outPath + '.json'
 * exactly as the old script did; pass writeSidecar:false when the caller owns the sidecar (as
 * source-lib does, to enforce its own {source,license,query,sha256,preparedAt} shape). `decode` is
 * injectable — it defaults to node-web-audio-api (prep-oneshot.mjs's byte-identical behavior), but
 * the `beat source` offline path passes a pure-JS WAV decoder so ingesting a local .wav needs no
 * native decode dependency. Throws PrepError on a silent/undecodable input. */
export async function prepOneshot({ inPath, outPath, peakDb = -6, license = 'UNKNOWN', source = 'UNKNOWN', writeSidecar = true, decode = decodeViaWebAudio }) {
  let sampleRate, channels
  try {
    ;({ sampleRate, channels } = await decode(inPath))
  } catch (err) {
    throw new PrepError(`${inPath}: could not decode audio (${err instanceof Error ? err.message : String(err)})`)
  }

  // trim: first sample anywhere above -60 dBFS to last sample above -60 dBFS, plus 5ms lead-in
  const THRESH = Math.pow(10, -60 / 20)
  let first = Infinity
  let last = 0
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      if (Math.abs(ch[i]) > THRESH) {
        if (i < first) first = i
        if (i > last) last = i
      }
    }
  }
  if (first === Infinity) throw new PrepError(`${inPath}: silent input`)
  first = Math.max(0, first - Math.round(0.005 * sampleRate))
  last = Math.min(channels[0].length - 1, last + Math.round(0.01 * sampleRate))

  const FADE = Math.round(0.005 * sampleRate) // 5ms fade-out against end clicks
  const len = last - first + 1
  let peak = 0
  const trimmed = channels.map((ch) => {
    const out = ch.slice(first, last + 1)
    for (let i = 0; i < FADE && i < len; i++) out[len - 1 - i] *= i / FADE
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]))
    return out
  })
  const gain = Math.pow(10, peakDb / 20) / (peak || 1)

  // 16-bit PCM WAV writer
  const nCh = trimmed.length
  const dataBytes = len * nCh * 2
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(nCh, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * nCh * 2, 28)
  buf.writeUInt16LE(nCh * 2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      const v = Math.max(-1, Math.min(1, trimmed[c][i] * gain))
      buf.writeInt16LE(Math.round(v * 32767), 44 + (i * nCh + c) * 2)
    }
  }
  writeFileSync(outPath, buf)

  const sha256 = createHash('sha256').update(buf).digest('hex')
  const durationSeconds = Number((len / sampleRate).toFixed(4))
  if (writeSidecar) {
    writeFileSync(outPath + '.json', JSON.stringify({
      source,
      license,
      preparedAt: new Date().toISOString(),
      prep: { trimThresholdDb: -60, leadInMs: 5, tailMs: 10, fadeOutMs: 5, peakNormalizeDb: peakDb, format: '16-bit PCM' },
      sha256,
      durationSeconds,
    }, null, 2) + '\n')
  }
  return { sha256, durationSeconds, len, sampleRate, peakDb, buf }
}
