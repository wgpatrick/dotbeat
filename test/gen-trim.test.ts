// Downbeat-aligned trim (research/127 §4.2, Part A2): the pure math, no network. A synthetic clip
// with a known transient must be cut to the requested bar count starting AT that transient; a clip
// with no transient (a pad) degrades to a head trim; encodeWav16 must round-trip through decodeWav.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { downbeatAlignedTrim, encodeWav16 } from '../src/analysis/gen-trim.js'
import { decodeWav } from '../src/metrics/wav.js'

const SR = 44100

/** A mono clip of `seconds`, near-silent, with a sharp transient burst at `hitSec`. */
function clipWithHit(seconds: number, hitSec: number): Float64Array {
  const frames = Math.round(seconds * SR)
  const ch = new Float64Array(frames)
  for (let i = 0; i < frames; i++) ch[i] = Math.sin(i * 0.01) * 0.0005 // quiet bed, no transients
  const hit = Math.round(hitSec * SR)
  for (let i = 0; i < 200; i++) if (hit + i < frames) ch[hit + i] = 0.9 * Math.exp(-i / 40) // decaying impulse
  return ch
}

test('downbeatAlignedTrim snaps the cut to the first-bar transient and takes the bar count', () => {
  // bpm 120, 1 bar = 4 beats = 2 s. Source 4 s, transient at 0.5 s (inside the first bar).
  const ch = clipWithHit(4, 0.5)
  const r = downbeatAlignedTrim({ channels: [ch], sampleRate: SR }, { bpm: 120, bars: 1 })
  assert.equal(r.snapped, true, 'a clear transient should snap')
  assert.ok(Math.abs(r.offsetSeconds - 0.5) < 0.01, `offset ~0.5s, got ${r.offsetSeconds}`)
  assert.ok(Math.abs(r.lengthSeconds - 2) < 0.01, `1 bar @120bpm = 2s, got ${r.lengthSeconds}`)
  assert.equal(r.channels[0]!.length, Math.round(2 * SR))
})

test('downbeatAlignedTrim length math tracks bpm and bar count exactly', () => {
  const ch = clipWithHit(20, 0.2)
  // 4 bars @ 96 bpm = 4*4*60/96 = 10 s
  const r = downbeatAlignedTrim({ channels: [ch], sampleRate: SR }, { bpm: 96, bars: 4 })
  assert.ok(Math.abs(r.lengthSeconds - 10) < 0.01, `4 bars @96 = 10s, got ${r.lengthSeconds}`)
})

test('downbeatAlignedTrim degrades to a head trim when there is no transient (pad/texture)', () => {
  const frames = Math.round(6 * SR)
  const pad = new Float64Array(frames)
  for (let i = 0; i < frames; i++) pad[i] = Math.sin(i * 0.02) * 0.3 // steady tone, no onset flux
  const r = downbeatAlignedTrim({ channels: [pad], sampleRate: SR }, { bpm: 120, bars: 2 })
  assert.equal(r.snapped, false, 'no transient -> no snap')
  assert.equal(r.offsetSeconds, 0, 'head trim starts at 0')
  assert.ok(Math.abs(r.lengthSeconds - 4) < 0.01, `2 bars @120 = 4s, got ${r.lengthSeconds}`)
})

test('downbeatAlignedTrim backs off so a late downbeat never returns a stub', () => {
  // transient at 3.8s in a 4s clip; a 2s target from there would overrun, so start backs off to fit.
  const ch = clipWithHit(4, 3.8)
  const r = downbeatAlignedTrim({ channels: [ch], sampleRate: SR }, { bpm: 120, bars: 1 })
  assert.ok(Math.abs(r.lengthSeconds - 2) < 0.01, 'still returns a full 2s window')
  assert.ok(r.offsetSeconds <= 2.001, 'start backed off to fit the window')
})

test('encodeWav16 round-trips through decodeWav (stereo, sample rate, values)', () => {
  const left = Float64Array.from({ length: 1000 }, (_, i) => Math.sin(i * 0.05) * 0.5)
  const right = Float64Array.from({ length: 1000 }, (_, i) => Math.cos(i * 0.05) * 0.25)
  const wav = encodeWav16([left, right], 48000)
  const dec = decodeWav(wav)
  assert.equal(dec.sampleRate, 48000)
  assert.equal(dec.channels.length, 2)
  assert.equal(dec.channels[0]!.length, 1000)
  // 16-bit quantization tolerance
  assert.ok(Math.abs(dec.channels[0]![10]! - left[10]!) < 1e-3)
  assert.ok(Math.abs(dec.channels[1]![10]! - right[10]!) < 1e-3)
})
