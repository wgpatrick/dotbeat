// Phase 37 Stream RA — section slicing + formatter, tested against known-answer boundaries on
// synthetic buffers (NO real render: real renders are timing-sensitive and belong in
// ui/verify-phase37-stream-ra.mjs, not the unit suite). The slice math is the load-bearing part —
// cumulative bars -> sample offsets, contiguity, last-section-absorbs-the-tail — so it gets
// exact-index assertions; the formatters get smoke coverage (they run, they mention each section).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sliceSections, analyzeSections, samplesPerBar, formatSectionFeedback, formatWholeSongFeedback, type SectionSpec } from '../src/metrics/sections.js'
import { analyze } from '../src/metrics/analyze.js'
import { lint } from '../src/metrics/lint.js'

const SR = 44100
const BPM = 120 // samplesPerBar = 240*44100/120 = 88200 (exactly 2s/bar at 120 bpm 4/4)

// A ramp buffer whose value at index i IS i — so a slice's first/last sample reveals its exact
// source offset, making boundary math directly assertable.
function indexRamp(n: number): Float64Array {
  const a = new Float64Array(n)
  for (let i = 0; i < n; i++) a[i] = i
  return a
}

test('samplesPerBar: 240*sr/bpm (2s/bar at 120 bpm)', () => {
  assert.equal(samplesPerBar(SR, BPM), 88200)
  assert.equal(samplesPerBar(48000, 120), 96000)
})

test('mono slice boundaries: cumulative bars -> exact sample offsets, contiguous, gap-free', () => {
  const spb = samplesPerBar(SR, BPM) // 88200
  const bars = [4, 4, 8] // boundaries at 0, 4*spb, 8*spb, 16*spb
  const total = 16 * spb
  const ch = indexRamp(total)
  const slices = sliceSections([ch], SR, BPM, bars)

  assert.equal(slices.length, 3)
  // section 1: [0, 4*spb)
  assert.equal(slices[0]![0]!.length, 4 * spb)
  assert.equal(slices[0]![0]![0], 0)
  // section 2 starts exactly where section 1 ended (contiguity): first sample index == 4*spb
  assert.equal(slices[1]![0]![0], 4 * spb)
  assert.equal(slices[1]![0]!.length, 4 * spb)
  // section 3: [8*spb, end)
  assert.equal(slices[2]![0]![0], 8 * spb)
  assert.equal(slices[2]![0]!.length, 8 * spb)
  // contiguity + coverage: the three lengths tile the whole buffer with no gap/overlap
  assert.equal(slices[0]![0]!.length + slices[1]![0]!.length + slices[2]![0]!.length, total)
})

test('last section absorbs the tail: extra samples past the nominal boundary land in the final slice', () => {
  const spb = samplesPerBar(SR, BPM)
  const bars = [2, 2] // nominal total 4*spb...
  const tail = 5000 // ...but the buffer runs 5000 samples longer (reverb/rounding drift)
  const total = 4 * spb + tail
  const ch = indexRamp(total)
  const slices = sliceSections([ch], SR, BPM, bars)

  assert.equal(slices[0]![0]!.length, 2 * spb) // first section is its nominal length
  assert.equal(slices[1]![0]![0], 2 * spb) // second starts at the boundary
  assert.equal(slices[1]![0]!.length, 2 * spb + tail) // ...and runs to the very end, tail included
  // the last sample of the last slice is the last sample of the buffer
  assert.equal(slices[1]![0]![slices[1]![0]!.length - 1], total - 1)
})

test('stereo: both channels sliced identically at the same boundaries', () => {
  const spb = samplesPerBar(SR, BPM)
  const bars = [1, 1]
  const total = 2 * spb
  const l = indexRamp(total)
  const r = indexRamp(total)
  const slices = sliceSections([l, r], SR, BPM, bars)
  for (const sec of slices) {
    assert.equal(sec.length, 2) // still stereo
    assert.equal(sec[0]!.length, sec[1]!.length) // channels equal length
    assert.equal(sec[0]![0], sec[1]![0]) // aligned start
  }
  assert.equal(slices[0]![0]!.length, spb)
  assert.equal(slices[1]![0]![0], spb)
})

test('short buffer (render came up shorter than nominal): slices clamp to the buffer, never past it', () => {
  const spb = samplesPerBar(SR, BPM)
  const bars = [2, 2, 2] // nominal 6*spb
  const total = 3 * spb // buffer only has 3 bars of audio
  const ch = indexRamp(total)
  const slices = sliceSections([ch], SR, BPM, bars)
  // no slice extends past the buffer; sections beyond the audio collapse to empty (start==end)
  let covered = 0
  for (const sec of slices) {
    assert.ok(sec[0]!.length >= 0)
    covered += sec[0]!.length
  }
  assert.equal(covered, total) // still exactly tiles the available audio
})

// ---- analyzeSections + formatters (smoke) ---------------------------------------------------

// A quiet dark section (low-amp low-freq) then a loud bright section (high-amp high-freq), so the
// analyzed metrics have a known DIRECTION even without a real render.
function tone(freq: number, n: number, amp: number): Float64Array {
  const a = new Float64Array(n)
  for (let i = 0; i < n; i++) a[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR)
  return a
}

test('analyzeSections: quiet/dark section vs loud/bright section reads as louder + brighter', () => {
  const spb = samplesPerBar(SR, BPM)
  const quietDark = tone(120, spb, 0.05)
  const loudBright = tone(4000, spb, 0.9)
  const ch = new Float64Array(2 * spb)
  ch.set(quietDark, 0)
  ch.set(loudBright, spb)
  const specs: SectionSpec[] = [
    { bars: 1, scene: 'intro' },
    { bars: 1, scene: 'drop', name: 'the drop' },
  ]
  const secs = analyzeSections([ch], SR, BPM, specs)
  assert.equal(secs.length, 2)
  assert.equal(secs[0]!.label, 'intro') // scene id when no name
  assert.equal(secs[1]!.label, 'the drop') // name wins over scene id
  // loud section is louder
  assert.ok(secs[1]!.metrics.integratedLufs > secs[0]!.metrics.integratedLufs + 6, `expected drop louder: ${secs[0]!.metrics.integratedLufs} -> ${secs[1]!.metrics.integratedLufs}`)
  // bright section has a much higher spectral centroid
  assert.ok(secs[1]!.metrics.spectral.centroidHz > secs[0]!.metrics.spectral.centroidHz + 1000, `expected drop brighter: ${secs[0]!.metrics.spectral.centroidHz} -> ${secs[1]!.metrics.spectral.centroidHz}`)
})

test('formatSectionFeedback: mentions each section, the movement, and the honest-limits footer', () => {
  const spb = samplesPerBar(SR, BPM)
  const ch = new Float64Array(2 * spb)
  ch.set(tone(120, spb, 0.05), 0)
  ch.set(tone(4000, spb, 0.9), spb)
  const secs = analyzeSections([ch], SR, BPM, [
    { bars: 1, scene: 'intro' },
    { bars: 1, scene: 'drop' },
  ])
  const out = formatSectionFeedback(secs)
  assert.match(out, /section feedback: 2 sections, 2 bars total/)
  assert.match(out, /intro/)
  assert.match(out, /drop/)
  assert.match(out, /1 -> 2/) // the movement line
  assert.match(out, /louder/) // drop is louder than intro
  assert.match(out, /honest limits/)
  assert.match(out, /does NOT hear masking/)
})

test('formatWholeSongFeedback: metrics block + lint findings, mentions loudness + lint', () => {
  const spb = samplesPerBar(SR, BPM)
  const ch = tone(220, 4 * spb, 0.3)
  const m = analyze([ch], SR)
  const out = formatWholeSongFeedback(m, lint(m))
  assert.match(out, /whole-song feedback/)
  assert.match(out, /loudness/)
  assert.match(out, /lint:/)
})
