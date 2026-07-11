#!/usr/bin/env node
// One-shot sample prep (docs/phase-7-plan.md §7.4): trim leading/trailing silence, short
// fade-out against clicks, peak-normalize with headroom, write 16-bit PCM WAV + a provenance
// sidecar. Defaults are sensible conventions pending research-09's prep checklist; every
// prepped file records the exact settings used.
//
//   node scripts/prep-oneshot.mjs <in.wav> <out.wav> --license <text> --source <text> [--peak-db -6]

import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const [inPath, outPath, ...rest] = process.argv.slice(2)
if (!inPath || !outPath) {
  console.error('usage: prep-oneshot.mjs <in.wav> <out.wav> --license <text> --source <text> [--peak-db -6]')
  process.exit(2)
}
const flag = (name, dflt) => {
  const i = rest.indexOf(name)
  return i !== -1 ? rest[i + 1] : dflt
}
const peakDb = Number(flag('--peak-db', '-6'))
const license = flag('--license', 'UNKNOWN')
const source = flag('--source', 'UNKNOWN')

// Decode with the SAME decoder the offline renderer uses (node-web-audio-api / symphonia) —
// handles WAV bit depths, AIFF, FLAC, and resamples to 44.1k, and guarantees that anything we
// bundle is decodable by our own render pipeline.
const { OfflineAudioContext } = await import('node-web-audio-api')
const ctx = new OfflineAudioContext(2, 44100, 44100)
const bytes = readFileSync(inPath)
const decoded = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
const sampleRate = decoded.sampleRate
const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i))

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
if (first === Infinity) {
  console.error(`${inPath}: silent input`)
  process.exit(2)
}
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
writeFileSync(outPath + '.json', JSON.stringify({
  source,
  license,
  preparedAt: new Date().toISOString(),
  prep: { trimThresholdDb: -60, leadInMs: 5, tailMs: 10, fadeOutMs: 5, peakNormalizeDb: peakDb, format: '16-bit PCM' },
  sha256,
  durationSeconds: Number((len / sampleRate).toFixed(4)),
}, null, 2) + '\n')
console.log(`${outPath}: ${(len / sampleRate).toFixed(3)}s, peak -> ${peakDb} dBFS, sha256 ${sha256.slice(0, 12)}...`)
