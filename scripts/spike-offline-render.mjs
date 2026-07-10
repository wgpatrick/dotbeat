#!/usr/bin/env node
// Offline-render spike — docs/phase-2-plan.md §2.6.
//
// Validates, in THIS environment, the exact recipe the source-code archaeology found in
// node-web-audio-api's own examples (docs/opendaw-notes.md §9): polyfill first, real Tone.js on
// top, OfflineAudioContext for faster-than-real-time rendering. This is NOT the production
// render path (that's still headless Chromium, the fidelity reference per docs/decisions.md D5)
// — it's the measurement that tells us what the engine-extraction work would buy.
//
// Workload: a deliberately BeatLab-shaped patch — filtered sawtooth synth (osc -> lowpass filter
// -> envelope), a bassline of 16th-note events over 4 bars at 126 bpm (same length/bpm as
// examples/real-groove.beat), rendered offline and timed against the wall-clock length the
// realtime MediaRecorder path needs for the same audio.

import 'node-web-audio-api/polyfill.js' // must be first — patches globalThis (AudioContext, OfflineAudioContext, ...)
import { writeFileSync } from 'node:fs'
import * as Tone from 'tone'

const BPM = 126
const BARS = 4
const seconds = (BARS * 16 * (60 / BPM)) / 4 // 16 steps/bar, 4 steps/beat — same math as beatlab

const t0 = performance.now()

const buffer = await Tone.Offline(
  ({ transport }) => {
    const synth = new Tone.PolySynth(Tone.MonoSynth, {
      oscillator: { type: 'sawtooth' },
      filter: { type: 'lowpass', Q: 1 },
      filterEnvelope: { baseFrequency: 700, attack: 0.005, decay: 0.25, sustain: 0.3, release: 0.15 },
      envelope: { attack: 0.005, decay: 0.25, sustain: 0.3, release: 0.15 },
    }).toDestination()
    synth.volume.value = -8

    // a 4-bar 16th-note bassline, BeatLab-groove-shaped
    const steps = []
    for (let bar = 0; bar < BARS; bar++) {
      for (const [step, pitch] of [[0, 'A1'], [4, 'A1'], [7, 'C2'], [10, 'A1'], [12, 'E2'], [14, 'G2']]) {
        steps.push([bar * 16 + step, pitch])
      }
    }
    const stepDur = 60 / BPM / 4
    for (const [step, pitch] of steps) {
      transport.schedule((time) => synth.triggerAttackRelease(pitch, stepDur * 2, time, 0.85), step * stepDur)
    }
    transport.start(0)
  },
  seconds,
  2,
  44100,
)

const renderMs = performance.now() - t0
const audioSeconds = buffer.duration
const realtimeMs = audioSeconds * 1000

// peak, to prove this produced real audio and not silence
let peak = 0
for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
  const data = buffer.getChannelData(ch)
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
}

console.log(`rendered ${audioSeconds.toFixed(2)}s of audio in ${Math.round(renderMs)}ms`)
console.log(`realtime capture of the same audio: ${Math.round(realtimeMs)}ms (+ browser/vite boot on top)`)
console.log(`speedup vs realtime: ${(realtimeMs / renderMs).toFixed(1)}x`)
console.log(`peak amplitude: ${peak.toFixed(3)} (real audio: ${peak > 0.1})`)

// write a WAV so the output is inspectable/listenable, same encoder logic as beatlab's wavEncode
function toWav(buf) {
  const ch = buf.numberOfChannels
  const len = buf.length
  const bytesPerSample = 2
  const dataSize = len * ch * bytesPerSample
  const out = Buffer.alloc(44 + dataSize)
  out.write('RIFF', 0); out.writeUInt32LE(36 + dataSize, 4); out.write('WAVE', 8)
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(ch, 22)
  out.writeUInt32LE(buf.sampleRate, 24); out.writeUInt32LE(buf.sampleRate * ch * bytesPerSample, 28)
  out.writeUInt16LE(ch * bytesPerSample, 32); out.writeUInt16LE(16, 34)
  out.write('data', 36); out.writeUInt32LE(dataSize, 40)
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i))
  let o = 44
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i]))
    out.writeInt16LE(Math.round(v * 32767), o); o += 2
  }
  return out
}

const outPath = process.argv[2] ?? '/tmp/spike-offline.wav'
writeFileSync(outPath, toWav(buffer))
console.log(`wrote ${outPath}`)

process.exit(0) // Tone.js has no clean Node teardown — planned for, per the archaeology notes
