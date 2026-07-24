// Phase 37 Stream RA — section slicing + formatter, tested against known-answer boundaries on
// synthetic buffers (NO real render: real renders are timing-sensitive and belong in
// ui/verify-phase37-stream-ra.mjs, not the unit suite). The slice math is the load-bearing part —
// cumulative bars -> sample offsets, contiguity, last-section-absorbs-the-tail — so it gets
// exact-index assertions; the formatters get smoke coverage (they run, they mention each section).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sliceSections, analyzeSections, samplesPerBar, formatSectionFeedback, formatWholeSongFeedback, arrangementFindings, type SectionSpec } from '../src/metrics/sections.js'
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

// ---- arrangement lint (research/122 §4.2: the flatness detector) ----------------------------

test('arrangementFindings: a same-amplitude arc everywhere fires arrangement-flat', () => {
  const spb = samplesPerBar(SR, BPM)
  const ch = new Float64Array(3 * spb)
  for (let i = 0; i < 3; i++) ch.set(tone(220, spb, 0.3), i * spb) // three identical sections
  const secs = analyzeSections([ch], SR, BPM, [
    { bars: 1, scene: 'a' },
    { bars: 1, scene: 'b' },
    { bars: 1, scene: 'c' },
  ])
  const findings = arrangementFindings(secs)
  assert.equal(findings.length, 1)
  assert.equal(findings[0]!.rule, 'arrangement-flat')
  assert.equal(findings[0]!.level, 'info') // taste defect, not a playback-safety one
  assert.ok(findings[0]!.measured < 1, `span should be ~0 LU, got ${findings[0]!.measured}`)
  assert.match(findings[0]!.message, /flat/)
  assert.ok(findings[0]!.suggestion, 'the finding should carry a concrete fix')
})

test('arrangementFindings: a real quiet->drop contrast does not fire', () => {
  const spb = samplesPerBar(SR, BPM)
  const ch = new Float64Array(2 * spb)
  ch.set(tone(220, spb, 0.05), 0) // quiet intro
  ch.set(tone(220, spb, 0.9), spb) // ~25 dB louder drop
  const secs = analyzeSections([ch], SR, BPM, [
    { bars: 1, scene: 'intro' },
    { bars: 1, scene: 'drop' },
  ])
  assert.equal(arrangementFindings(secs).length, 0)
})

test('arrangementFindings: a slow crescendo with small steps but a real span does not fire', () => {
  const spb = samplesPerBar(SR, BPM)
  // 6 sections stepping ~2 dB each: adjacent steps sit near the 2 LU nominal, but the SPAN
  // (~10 dB) alone must clear the rule — flat requires BOTH small steps AND a small span.
  const amps = [0.05, 0.063, 0.08, 0.1, 0.126, 0.16]
  const ch = new Float64Array(amps.length * spb)
  amps.forEach((a, i) => ch.set(tone(220, spb, a), i * spb))
  const secs = analyzeSections([ch], SR, BPM, amps.map(() => ({ bars: 1 })))
  assert.equal(arrangementFindings(secs).length, 0)
})

test('arrangementFindings: a silent section counts as contrast (-inf LUFS), not a bail-out', () => {
  const spb = samplesPerBar(SR, BPM)
  const ch = new Float64Array(2 * spb) // section 1 stays all-zero (silent)
  ch.set(tone(220, spb, 0.3), spb)
  const secs = analyzeSections([ch], SR, BPM, [{ bars: 1 }, { bars: 1 }])
  assert.equal(arrangementFindings(secs).length, 0)
})

test('arrangementFindings: fewer than two sections has no arrangement to judge', () => {
  const spb = samplesPerBar(SR, BPM)
  const secs = analyzeSections([tone(220, spb, 0.3)], SR, BPM, [{ bars: 1 }])
  assert.equal(arrangementFindings(secs).length, 0)
})

test('formatSectionFeedback: flat arc prints the arrangement-flat finding; contrasted arc prints pass', () => {
  const spb = samplesPerBar(SR, BPM)
  const flat = new Float64Array(2 * spb)
  flat.set(tone(220, spb, 0.3), 0)
  flat.set(tone(220, spb, 0.3), spb)
  const flatOut = formatSectionFeedback(analyzeSections([flat], SR, BPM, [{ bars: 1 }, { bars: 1 }]))
  assert.match(flatOut, /arrangement lint:/)
  assert.match(flatOut, /INFO \[arrangement-flat\]/)

  const arc = new Float64Array(2 * spb)
  arc.set(tone(220, spb, 0.05), 0)
  arc.set(tone(220, spb, 0.9), spb)
  const arcOut = formatSectionFeedback(analyzeSections([arc], SR, BPM, [{ bars: 1 }, { bars: 1 }]))
  assert.match(arcOut, /arrangement lint: pass/)
  assert.doesNotMatch(arcOut, /arrangement-flat/)
})
