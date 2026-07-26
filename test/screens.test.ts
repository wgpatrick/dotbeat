// Pathology-screen tests — synthetic buffers whose defect (or cleanliness) is known a priori.
// Each screen is exercised on a signal built to trip exactly it, plus a clean control that must
// stay silent. Calibration against real audio (ref pools, sandstorm pair) lives in the branch
// report; these lock the detector logic.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { screen, type PathologyFinding } from '../src/metrics/screens.js'
import type { SectionSpec } from '../src/metrics/sections.js'

const FS = 44100

function sine(freq: number, seconds: number, amp: number): Float64Array {
  const out = new Float64Array(Math.round(seconds * FS))
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / FS)
  return out
}
/** A clean multi-tone bed: partials chosen to AVOID the mud octave (250–500 Hz) and the resonance
 * band (2–5.5 kHz) so a healthy signal trips no screen, and low enough in frequency to be smooth
 * (no per-sample outliers that read as clicks). Normalized so peak ≈ amp. */
function bed(seconds: number, amp: number): Float64Array {
  const n = Math.round(seconds * FS)
  const out = new Float64Array(n)
  const freqs = [110, 165, 700, 900, 1500]
  for (let i = 0; i < n; i++) {
    let v = 0
    for (const f of freqs) v += Math.sin((2 * Math.PI * f * i) / FS)
    out[i] = (amp / freqs.length) * v
  }
  return out
}
const has = (fs: PathologyFinding[], kind: string) => fs.some((f) => f.kind === kind)
const get = (fs: PathologyFinding[], kind: string) => fs.find((f) => f.kind === kind)

test('clean broadband stereo signal trips no screen', () => {
  const l = bed(4, 0.2)
  const r = bed(4, 0.2)
  assert.deepEqual(screen([l, r], FS), [])
})

test('arrangement-flatness: flat sections flag, contrasting sections pass', () => {
  const sections: SectionSpec[] = [
    { bars: 4, name: 'intro' },
    { bars: 4, name: 'a' },
    { bars: 4, name: 'b' },
    { bars: 4, name: 'c' },
    { bars: 4, name: 'd' },
    { bars: 4, name: 'outro' },
  ]
  const bpm = 120
  const spb = (240 * FS) / bpm
  const build = (amps: number[]): Float64Array[] => {
    const total = Math.round(amps.length * 4 * spb)
    const ch = new Float64Array(total)
    let o = 0
    for (const a of amps) {
      const seg = bed((4 * spb) / FS, a)
      ch.set(seg.subarray(0, Math.min(seg.length, total - o)), o)
      o += Math.round(4 * spb)
    }
    return [ch, ch.slice()]
  }
  // interior (drop intro/outro) all at the same amplitude → flat
  const flat = build([0.05, 0.2, 0.2, 0.2, 0.2, 0.05])
  const flatFind = screen(flat, FS, { sections, bpm })
  assert.ok(has(flatFind, 'arrangement-flatness'), 'flat interior should flag')

  // interior with a real breakdown dip (section b much quieter) → has an arc
  const arc = build([0.05, 0.2, 0.03, 0.12, 0.25, 0.05])
  const arcFind = screen(arc, FS, { sections, bpm })
  assert.ok(!has(arcFind, 'arrangement-flatness'), 'interior with a dip/arc should pass')
})

test('arrangement-flatness only runs with a section map', () => {
  const flat = [bed(8, 0.2), bed(8, 0.2)]
  assert.ok(!has(screen(flat, FS), 'arrangement-flatness'))
})

test('click: an isolated inter-sample discontinuity flags with a timestamp', () => {
  // a smooth low sine so the injected spike is an unambiguous single-sample outlier
  const l = sine(200, 3, 0.3)
  const r = l.slice()
  const at = Math.round(1.5 * FS)
  l[at] = l[at]! + 0.6 // a single-sample spike
  r[at] = r[at]! + 0.6
  const f = screen([l, r], FS)
  assert.ok(has(f, 'click'), 'click should flag')
  const c = get(f, 'click')!
  assert.ok(Math.abs((c.start ?? -1) - 1.5) < 0.01, `click time ${c.start}`)
})

test('DC offset: a constant bias flags', () => {
  const l = sine(220, 3, 0.2)
  for (let i = 0; i < l.length; i++) l[i]! += 0.08 // large DC
  const f = screen([l, l.slice()], FS)
  assert.ok(has(f, 'dc-offset'))
})

test('mono-collapse: anti-phase L/R flags', () => {
  const l = bed(3, 0.2)
  const r = l.map((x) => -x) // perfectly inverted
  const f = screen([l, r], FS)
  assert.ok(has(f, 'mono-collapse'))
  assert.ok((get(f, 'mono-collapse')!.measured ?? 0) < -0.6)
})

test('crest-collapse: a hard-limited (square) signal flags', () => {
  const n = 3 * FS
  const l = new Float64Array(n)
  for (let i = 0; i < n; i++) l[i] = 0.9 * (Math.sign(Math.sin((2 * Math.PI * 220 * i) / FS)) || 1)
  const f = screen([l, l.slice()], FS)
  assert.ok(has(f, 'crest-collapse'), 'square wave has ~0 crest → over-compressed')
})

test('mud: 250-500 Hz dominance (with a top end present) flags', () => {
  const n = 3 * FS
  const l = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    // dominant low-mid octave (350/400 Hz) plus a real, if small, top end so the mix-context
    // guard (needs >3% above 2 kHz) is satisfied — i.e. a broadband mix, not a lone low tone
    l[i] = 0.5 * Math.sin((2 * Math.PI * 350 * i) / FS) + 0.5 * Math.sin((2 * Math.PI * 400 * i) / FS) + 0.14 * Math.sin((2 * Math.PI * 4000 * i) / FS)
  }
  const f = screen([l, l.slice()], FS)
  assert.ok(has(f, 'mud'), 'low-mid-dominated broadband → mud')
})

test('sub-rumble: strong sub-30 Hz energy flags', () => {
  const n = 4 * FS
  const l = new Float64Array(n)
  for (let i = 0; i < n; i++) l[i] = 0.6 * Math.sin((2 * Math.PI * 18 * i) / FS) + 0.15 * Math.sin((2 * Math.PI * 500 * i) / FS)
  const f = screen([l, l.slice()], FS)
  assert.ok(has(f, 'sub-rumble'))
})

test('resonance: a narrow sustained 3 kHz spike over a bed flags', () => {
  const n = 3 * FS
  const l = bed(3, 0.15)
  for (let i = 0; i < n; i++) l[i]! += 0.5 * Math.sin((2 * Math.PI * 3000 * i) / FS) // a loud narrow tone
  // scale the bed down so the 3 kHz tone is a secondary spike, not the outright peak
  const f = screen([l, l.slice()], FS)
  assert.ok(has(f, 'resonance'), 'narrow 3 kHz resonance should flag')
})

test('dead-air: a silent gap between two loud sections flags mid-song', () => {
  const seg = bed(1.5, 0.2)
  const gap = new Float64Array(Math.round(1.0 * FS)) // 1s of silence
  const n = seg.length * 2 + gap.length
  const l = new Float64Array(n)
  l.set(seg, 0)
  l.set(gap, seg.length)
  l.set(seg, seg.length + gap.length)
  const f = screen([l, l.slice()], FS)
  assert.ok(has(f, 'dead-air'))
  const d = get(f, 'dead-air')!
  assert.ok((d.start ?? 0) > 1.0 && (d.end ?? 0) < 2.7, `gap window ${d.start}-${d.end}`)
})

test('every finding carries the unified schema (kind, severity, source, detail)', () => {
  const l = sine(220, 2, 0.2)
  for (let i = 0; i < l.length; i++) l[i]! += 0.08
  for (const f of screen([l, l.slice()], FS)) {
    assert.equal(typeof f.kind, 'string')
    assert.ok(f.severity >= 1 && f.severity <= 5)
    assert.equal(typeof f.source, 'string')
    assert.ok(f.detail.length > 0)
  }
})

// ---- bass-grind (research 121 §3.7 / 122 §4.1; D18) --------------------------------------------
//
// The founding owner complaint (2026-07-24, "the bass at ~1:11-1:16 is grindy/noisy") had no
// standing check for two years of docs. These tests pin its calibration.
//
// The calibration audio (taste-dataset/covers/solo-bass-stabs.wav vs solo-bs2.wav — a matched pair
// differing ONLY in the offending patch params) lives OUTSIDE the repo and is not committed, so
// the gate here is the MEASURED FEATURE VECTOR of each stem, which is what the rule actually reads.
// Both sets of numbers are published in research 121 §1.3 and 122 §1 and are reproduced exactly by
// src/metrics/rich.ts. The end-to-end run against the real wavs is in the branch report.

/** MixMetrics + RichMetrics stand-ins carrying only what the grind rule reads. */
function grindInputs(m: { crestDb: number; sub: number; bass: number; flatnessLoDb: number }) {
  const metrics = {
    durationSeconds: 8, sampleRate: FS, channels: 2, integratedLufs: -14,
    samplePeakDbfs: -1, truePeakDbtp: -1, crestDb: m.crestDb, rmsDbfs: -1 - m.crestDb,
    spectral: { bandsPct: { sub: m.sub, bass: m.bass, mids: Math.max(0, 100 - m.sub - m.bass), presence: 0, air: 0 }, centroidHz: 77 },
    stereo: { correlation: 1, widthDb: -60 },
  }
  const rich = { flatnessLoDb: m.flatnessLoDb } as unknown as import('../src/metrics/rich.js').RichMetrics
  return { metrics, rich }
}
const grindFindings = (m: Parameters<typeof grindInputs>[0]): PathologyFinding[] => {
  const { metrics, rich } = grindInputs(m)
  // A silent buffer keeps every other screen quiet; the grind rule reads only metrics+rich.
  return screen([new Float64Array(FS), new Float64Array(FS)], FS, { metrics: metrics as never, rich }).filter((f) => f.kind === 'bass-grind')
}

// The exact measured vectors of the owner's matched A/B pair (2026-07-26, src/metrics/rich.ts).
const GRINDY_BASS = { crestDb: 9.65, sub: 67.71, bass: 28.58, flatnessLoDb: -8.19 }
const FIXED_BASS = { crestDb: 11.39, sub: 59.36, bass: 36.83, flatnessLoDb: -11.56 }

test('bass-grind flags the owner-flagged stem and passes its fix', () => {
  const bad = grindFindings(GRINDY_BASS)
  assert.equal(bad.length, 1, 'the 2026-07-24 grindy bass must FLAG — this is the complaint the screen exists for')
  assert.equal(bad[0]!.kind, 'bass-grind')
  assert.ok(bad[0]!.severity >= 1 && bad[0]!.severity <= 5)
  assert.match(bad[0]!.detail, /resonance/, 'the finding must name the fix that worked, not just complain')
  assert.equal(bad[0]!.band, '100-500 Hz')

  assert.deepEqual(grindFindings(FIXED_BASS), [], 'solo-bs2 is the owner-accepted FIX and must PASS')
})

test('bass-grind needs all four clauses — each one alone lets the fixed stem through', () => {
  // Every clause is load-bearing; research 121's three-clause version (no flatness) fired on 37.5%
  // of the packs commercial bass references. Flipping any single clause of the bad stem toward the
  // good one must silence the rule.
  for (const [name, patch] of [
    ['crest', { crestDb: FIXED_BASS.crestDb }],
    ['sub share', { sub: FIXED_BASS.sub }],
    ['definition band', { bass: FIXED_BASS.bass }],
    ['bass-band flatness', { flatnessLoDb: FIXED_BASS.flatnessLoDb }],
  ] as const) {
    assert.deepEqual(grindFindings({ ...GRINDY_BASS, ...patch }), [], `clause "${name}" is not load-bearing — the rule still fires with it healthy`)
  }
})

test('bass-grind stays out of scope on anything that is not a bass-dominant stem', () => {
  // A full mix or a lead can carry a flat crest and a noisy low-mid band without being "grindy
  // bass"; the rule must decline rather than guess (research 134 §5 — a screen fired outside its
  // competence is how the ring gate came to reject 22% of the owner's own leads).
  assert.deepEqual(grindFindings({ ...GRINDY_BASS, sub: 40, bass: 20 }), [], 'a mix with only 60% below 250 Hz is out of scope')
  assert.deepEqual(grindFindings({ ...GRINDY_BASS, sub: 66, bass: 18 }), [], 'still out of scope at 84% low share')
})
