// `beat chop` — beat/bar/section-aware cutting (research 142 §2.1, build item 2).
//
// The whole verb is two pure functions plus file I/O, so almost all of it is testable here with no
// audio harness: `planChops` (artifact + options -> cut points) and `cutChops` (decoded channels +
// cut points -> chopped channels). What this file is really guarding is the FOUR musical design
// calls in src/analysis/chop.ts's header, each of which is easy to reverse by accident and each of
// which the mined corpus is explicit about:
//
//   grid-default (not transient)  ·  zero-crossing snap + seam fade  ·  NO normalize and NO
//   silence-trim  ·  register nothing
//
// The no-normalize/no-silence-trim pair gets the sharpest assertions in the file, because those
// are the ones that would silently destroy the information the owner is listening for: a quiet bar
// must come out quiet RELATIVE to a loud one, and a bar that starts with a rest must keep the rest.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CHOP_FADE_SECONDS,
  cutChops,
  buildChopSidecar,
  chopFileName,
  planChops,
  snapToZeroCrossing,
  type AnalysisArtifact,
} from '../src/analysis/index.js'
import { BeatAnalysisError } from '../src/analysis/index.js'

/** A 16 s, 120 bpm artifact: a beat every 0.5 s, a downbeat every 2 s, three labeled sections.
 * Deliberately hand-built (not a fixture file) so the expected cut points below can be read off
 * the numbers here with no indirection. */
function artifact(over: Partial<AnalysisArtifact> = {}): AnalysisArtifact {
  const beats: number[] = []
  for (let t = 0; t < 16; t += 0.5) beats.push(Number(t.toFixed(4)))
  const downbeats: number[] = []
  for (let t = 0; t < 16; t += 2) downbeats.push(Number(t.toFixed(4)))
  return {
    dotbeatAnalysis: 1,
    source: { file: 'song.wav', sha256: 'a'.repeat(64), durationSeconds: 16 },
    backend: { name: 'stub', version: '1', model: null },
    generatedAt: '2026-07-26T00:00:00.000Z',
    bpm: 120,
    bpmMethod: 'backend',
    beats,
    downbeats,
    sections: [
      { start: 0, end: 4, label: 'intro' },
      { start: 4, end: 12, label: 'loop' },
      { start: 12, end: 16, label: 'outro' },
    ],
    ...over,
  }
}

const spans = (plans: { startSeconds: number; endSeconds: number }[]) => plans.map((p) => [p.startSeconds, p.endSeconds])

// ---- the grid (golden cut points) ---------------------------------------------------------------

test('the DEFAULT is the bar grid at one bar per chop — never a transient detector', () => {
  const plans = planChops(artifact())
  // 8 downbeats over 16 s: cut at every one, and the final bar (12s..14s..16s) is not dropped.
  assert.deepEqual(spans(plans), [[0, 2], [2, 4], [4, 6], [6, 8], [8, 10], [10, 12], [12, 14], [14, 16]])
  assert.deepEqual(plans.map((p) => p.downbeatIndex), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(plans.map((p) => p.sectionLabel), ['intro', 'intro', 'loop', 'loop', 'loop', 'loop', 'outro', 'outro'])
})

test('--bars N takes N grid units per chop (the corpus’s "fewer chops, let it breathe")', () => {
  assert.deepEqual(spans(planChops(artifact(), { bars: 2 })), [[0, 4], [4, 8], [8, 12], [12, 16]])
  assert.deepEqual(spans(planChops(artifact(), { bars: 4 })), [[0, 8], [8, 16]])
  // A span the file cannot fill even once is a loud failure, not an empty directory.
  assert.throws(() => planChops(artifact(), { bars: 32 }), BeatAnalysisError)
})

test('--grid beat cuts on the detected beat grid; --max stops early', () => {
  assert.deepEqual(spans(planChops(artifact(), { grid: 'beat', max: 3 })), [[0, 0.5], [0.5, 1], [1, 1.5]])
  assert.equal(planChops(artifact(), { grid: 'beat' }).length, 32)
  // downbeatIndex is honestly null when the grid isn't downbeat-derived.
  assert.equal(planChops(artifact(), { grid: 'beat', max: 1 })[0]!.downbeatIndex, null)
})

test('--grid section cuts on the detected section boundaries, and refuses loudly without them', () => {
  const plans = planChops(artifact(), { grid: 'section' })
  assert.deepEqual(spans(plans), [[0, 4], [4, 12], [12, 16]])
  assert.deepEqual(plans.map((p) => p.sectionLabel), ['intro', 'loop', 'outro'])
  // A beats-only backend reports an honest empty list; the fix is a different backend, so the
  // error names it rather than silently falling back to bars (which would be a different cut).
  assert.throws(
    () => planChops(artifact({ sections: [] }), { grid: 'section' }),
    /--grid section needs detected sections .* --backend allin1/s,
  )
})

test('a downbeat-less artifact degrades to a uniform bar grid from the reported bpm', () => {
  // 120 bpm 4/4 => 2 s per bar, the same `4 * 60 / bpm` fallback beat skeleton uses.
  const plans = planChops(artifact({ downbeats: [] }))
  assert.deepEqual(spans(plans).slice(0, 3), [[0, 2], [2, 4], [4, 6]])
  assert.equal(plans.every((p) => p.downbeatIndex === null), true, 'no detected downbeat => no downbeat index')
})

test('a ragged tail is never minted as a short chop', () => {
  // Downbeats stop at 12 s but the file runs to 16 s: 12..14 is a real bar and IS cut; the leftover
  // 14..16 would only be cut if a full bar's worth remained after it, and it does not.
  const plans = planChops(artifact({ downbeats: [0, 2, 4, 6, 8, 10, 12] }))
  const lengths = plans.map((p) => Number((p.endSeconds - p.startSeconds).toFixed(4)))
  assert.deepEqual(new Set(lengths), new Set([2]), 'every chop is exactly one bar long')
  assert.equal(plans[plans.length - 1]!.endSeconds, 14)
})

test('planChops validates its own options rather than producing nonsense', () => {
  assert.throws(() => planChops(artifact(), { grid: 'transient' as never }), /unknown --grid/)
  assert.throws(() => planChops(artifact(), { bars: 0 }), /--bars must be an integer 1-64/)
  assert.throws(() => planChops(artifact(), { bars: 1.5 }), /--bars must be an integer 1-64/)
  assert.throws(() => planChops(artifact(), { max: 0 }), /--max must be a positive integer/)
})

// ---- the cut ------------------------------------------------------------------------------------

const SR = 4000

/** A signal whose two halves have deliberately DIFFERENT levels and whose second half opens with
 * silence — the two things auto-normalize and silence-trim would each destroy. */
function twoHalves(): Float64Array {
  const n = SR * 4 // 4 s
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    if (t < 2) out[i] = 0.8 * Math.sin(2 * Math.PI * 100 * t) // loud bar
    else if (t < 2.5) out[i] = 0 // the second bar opens with a half-second rest
    else out[i] = 0.1 * Math.sin(2 * Math.PI * 100 * t) // quiet bar
  }
  return out
}

const peakOf = (ch: Float64Array) => ch.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

test('NO auto-normalize: the level relationship BETWEEN chops survives the cut', () => {
  const src = twoHalves()
  const cuts = cutChops([src], SR, [
    { index: 1, startSeconds: 0, endSeconds: 2, downbeatIndex: 0, sectionLabel: null },
    { index: 2, startSeconds: 2, endSeconds: 4, downbeatIndex: 1, sectionLabel: null },
  ])
  const loud = peakOf(cuts[0]!.channels[0]!)
  const quiet = peakOf(cuts[1]!.channels[0]!)
  assert.ok(loud > 0.75 && loud <= 0.8, `loud chop keeps its own peak (${loud.toFixed(3)})`)
  assert.ok(quiet > 0.09 && quiet <= 0.1, `quiet chop stays quiet (${quiet.toFixed(3)})`)
  // The load-bearing property: peak-normalizing would make this ratio 1.0, and the owner would be
  // auditioning a lie about which bar of the record is the loud one.
  assert.ok(loud / quiet > 7, `the ~8x level ratio survives (${(loud / quiet).toFixed(1)}x)`)
})

test('NO silence-trim: a chop that begins with a rest keeps the rest (its grid timing)', () => {
  const src = twoHalves()
  const [, second] = cutChops([src], SR, [
    { index: 1, startSeconds: 0, endSeconds: 2, downbeatIndex: 0, sectionLabel: null },
    { index: 2, startSeconds: 2, endSeconds: 4, downbeatIndex: 1, sectionLabel: null },
  ])
  const ch = second!.channels[0]!
  assert.equal(ch.length, SR * 2, 'full bar length — nothing trimmed off either end')
  // The first 0.4 s must still be silent; trimming it would pull this chop 0.5 s EARLY against the
  // grid every time it is placed, which is exactly the failure prepOneshot's trim would cause here.
  const restEnergy = ch.slice(0, Math.floor(SR * 0.4)).reduce((s, v) => s + Math.abs(v), 0)
  assert.equal(restEnergy, 0)
})

test('cuts are gapless and seam-faded: adjacent chops reconstruct the source length exactly', () => {
  const src = twoHalves()
  const cuts = cutChops([src], SR, [
    { index: 1, startSeconds: 0, endSeconds: 1, downbeatIndex: 0, sectionLabel: null },
    { index: 2, startSeconds: 1, endSeconds: 2, downbeatIndex: 1, sectionLabel: null },
    { index: 3, startSeconds: 2, endSeconds: 3, downbeatIndex: 2, sectionLabel: null },
  ])
  assert.equal(cuts.reduce((n, c) => n + c.channels[0]!.length, 0), SR * 3, 'no samples lost or duplicated at the seams')
  for (let i = 1; i < cuts.length; i++) {
    assert.equal(cuts[i]!.startSeconds, cuts[i - 1]!.endSeconds, 'one chop ends exactly where the next begins')
  }
  // The seam fade is applied unconditionally (the corpus's documented click fallback) — so the very
  // first sample of a chop is zero even where the source was not.
  assert.equal(cuts[1]!.channels[0]![0], 0)
  const fadeSamples = Math.floor(CHOP_FADE_SECONDS * SR)
  assert.ok(fadeSamples >= 1, 'the fade is at least one sample at this rate')
})

test('every channel is cut at the SAME sample (no stereo smear at the seam)', () => {
  const n = SR * 2
  const l = new Float64Array(n)
  const r = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    l[i] = Math.sin((2 * Math.PI * 100 * i) / SR)
    r[i] = Math.sin((2 * Math.PI * 137 * i) / SR + 1.1) // a different phase/frequency per channel
  }
  const [cut] = cutChops([l, r], SR, [{ index: 1, startSeconds: 0.5, endSeconds: 1.5, downbeatIndex: 0, sectionLabel: null }])
  assert.equal(cut!.channels[0]!.length, cut!.channels[1]!.length)
})

test('snapToZeroCrossing moves a cut to the nearest crossing, or leaves it alone', () => {
  // A ramp crossing zero BETWEEN samples 50 and 51 (offset by half a step so no sample is exactly
  // zero — the ordinary case for real audio).
  const mono = new Float64Array(100)
  for (let i = 0; i < 100; i++) mono[i] = (i - 50.5) / 50
  assert.equal(snapToZeroCrossing(mono, 48, 10), 51)
  assert.equal(snapToZeroCrossing(mono, 55, 10), 51)
  assert.equal(snapToZeroCrossing(mono, 55, 2), 55, 'no crossing inside the window => the target is kept (the fade does the work)')
  // A DC-offset signal never crosses; the cut must not wander.
  const dc = new Float64Array(100).fill(0.5)
  assert.equal(snapToZeroCrossing(dc, 40, 10), 40)
})

test('cutChops refuses an empty file rather than writing zero-length chops', () => {
  assert.throws(() => cutChops([new Float64Array(0)], SR, [{ index: 1, startSeconds: 0, endSeconds: 1, downbeatIndex: null, sectionLabel: null }]), BeatAnalysisError)
})

// ---- provenance ---------------------------------------------------------------------------------

test('chop file names sort in cut order', () => {
  assert.deepEqual([1, 2, 10, 100].map(chopFileName), ['c001.wav', 'c002.wav', 'c010.wav', 'c100.wav'])
  const sorted = [chopFileName(10), chopFileName(2), chopFileName(1)].sort()
  assert.deepEqual(sorted, ['c001.wav', 'c002.wav', 'c010.wav'])
})

test('the per-chop sidecar records the ACTUAL window, the source, and refuses to guess a key', () => {
  const art = artifact()
  const [cut] = cutChops([twoHalves()], SR, [{ index: 1, startSeconds: 0, endSeconds: 2, downbeatIndex: 3, sectionLabel: 'loop' }])
  const sc = buildChopSidecar({
    cut: cut!,
    artifact: art,
    sourcePath: '/music/song.wav',
    sha256: 'b'.repeat(64),
    grid: 'bar',
    bars: 1,
    license: 'unspecified',
    preparedAt: '2026-07-26T00:00:00.000Z',
  })
  assert.equal(sc.derivedFrom.file, '/music/song.wav')
  assert.equal(sc.derivedFrom.sha256, art.source.sha256, 'the SOURCE bytes, so a chop is traceable to the exact file it came from')
  assert.deepEqual([sc.derivedFrom.startSeconds, sc.derivedFrom.endSeconds], [cut!.startSeconds, cut!.endSeconds])
  assert.equal(sc.bpm, 120)
  assert.equal(sc.downbeatIndex, 3)
  assert.equal(sc.sectionLabel, 'loop')
  assert.equal(sc.backend, 'stub')
  // "You assert the license, we don't guess it" — the same posture as every other ingest path.
  assert.equal(sc.license, 'unspecified')
  // The frozen analysis contract has no key field, and per-chop pitch detection would be exactly
  // the "confident wrong number" src/analysis/pitch.ts exists to avoid.
  assert.equal(sc.key, null)
})
