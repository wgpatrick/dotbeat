// v0.11 grammar tests — multi-region audio placement (Phase 36 Stream PA; decisions.md D16;
// docs/multi-region-audio-design.md Option A is the normative spec). A scene's slot for a track
// is now a LIST of placements — repeated `slot <track> <clip> [at <steps>]` lines — with `at 0`
// elided and placements canonically ordered (at, then clip id), which is exactly what keeps every
// pre-v0.11 document round-tripping byte-identically (the D4 bar this whole stream is held to).

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  parse,
  serialize,
  setScene,
  placeClip,
  unplaceClip,
  splitAudioClip,
  diffDocuments,
  formatDiff,
  audioRegionTimelineSteps,
  BeatParseError,
  BeatEditError,
} from '../src/core/index.js'

const SHA = 'a'.repeat(64)

// bpm 120 -> one 16th step = 0.125 s. Region lengths on the timeline:
//   riser  (0..1 s,   rate 1) -> 8 steps      impact (0..0.5 s, rate 1) -> 4 steps
//   riser2 (0..1 s,   rate 2) -> 4 steps (repitch: twice the source per timeline second)
const V11_EXAMPLE = `format_version 0.11
bpm 120
loop_bars 2
selected_track lead

media
  sample smp sha256:${SHA} media/smp.wav

track lead Lead #c678dd synth
  synth
    osc square
    volume -14
    cutoff 4500
    resonance 0.8
    attack 0.01
    decay 0.3
    sustain 0.2
    release 0.4
    pan 0
  clip melody
    note n1 60 0 2 0.8
  clip melody2
    note n1 64 0 2 0.8

track fx FX #56b6c2 audio
  clip riser
    audio smp 0 1 0 off 1
  clip impact
    audio smp 0 0.5 0 off 1
  clip riser2
    audio smp 0 1 0 repitch 2

scene s1
  slot lead melody
  slot fx riser
  slot fx impact at 8
  slot fx riser at 24.5
`

test('multi-placement scene parses into placement lists and round-trips byte-identically', () => {
  const doc = parse(V11_EXAMPLE)
  const s1 = doc.scenes[0]!
  assert.deepEqual(s1.slots.lead, [{ clip: 'melody', at: 0 }])
  assert.deepEqual(s1.slots.fx, [
    { clip: 'riser', at: 0 },
    { clip: 'impact', at: 8 },
    { clip: 'riser', at: 24.5 }, // the same clip placed twice — placements are references (D16)
  ])
  assert.equal(serialize(doc), V11_EXAMPLE)
})

test('liberal in, strict out: explicit `at 0` and out-of-order slot lines re-serialize canonically (one canonical form per state)', () => {
  const messy = V11_EXAMPLE.replace(
    '  slot fx riser\n  slot fx impact at 8\n  slot fx riser at 24.5\n',
    '  slot fx riser at 24.5\n  slot fx impact at 8\n  slot fx riser at 0\n',
  )
  assert.notEqual(messy, V11_EXAMPLE)
  assert.equal(serialize(parse(messy)), V11_EXAMPLE)
})

test('byte-identical round-trip for EVERY existing .beat file in examples/ (the zero-diff bar)', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples') // dist/test -> repo root
  const files = readdirSync(dir).filter((f) => f.endsWith('.beat'))
  assert.ok(files.length >= 5, `expected the five example projects, found ${files.length}`)
  for (const f of files) {
    const text = readFileSync(`${dir}/${f}`, 'utf8')
    const roundTripped = serialize(parse(text))
    if (roundTripped === text) continue // byte-identical, the normal case (every v0.8+ file)
    // The one legal exception, and it predates v0.11 entirely: night-shift.beat is a v0.3 file
    // whose legacy `pattern` lines migrate to `hit` events at parse (the v0.8 grammar migration —
    // see roundtrip.test.ts's own migration tests). Verified against origin/main during Phase 36
    // Stream PA: its migrated output is byte-for-byte IDENTICAL to what pre-v0.11 code produced,
    // so v0.11 is still a zero-diff change for it. Pin that down structurally: the migration must
    // be a fixed point, and every changed line must be pattern->hit — never a slot/scene/header
    // line (a placement-shaped change here would mean v0.11 broke the zero-diff bar).
    assert.equal(f, 'night-shift.beat', `${f} must round-trip byte-identically`)
    assert.equal(serialize(parse(roundTripped)), roundTripped, 'the migrated form is canonical (a fixed point)')
    const inLines = new Set(text.split('\n'))
    const outLines = new Set(roundTripped.split('\n'))
    for (const line of text.split('\n')) {
      if (!outLines.has(line)) assert.match(line, /^ {2}pattern /, `only legacy pattern lines may disappear, saw: ${line}`)
    }
    for (const line of roundTripped.split('\n')) {
      if (!inLines.has(line)) assert.match(line, /^ {2}hit /, `only migrated hit lines may appear, saw: ${line}`)
    }
  }
})

// ---- validation matrix (fail-loudly, in the design doc's own language) -------------------------

test('negative / non-numeric `at` is rejected at the slot line', () => {
  assert.throws(() => parse(V11_EXAMPLE.replace('slot fx impact at 8', 'slot fx impact at -1')), /slot at must be >= 0 steps, got -1/)
  assert.throws(() => parse(V11_EXAMPLE.replace('slot fx impact at 8', 'slot fx impact at abc')), /"slot at" expected a number/)
  assert.throws(() => parse(V11_EXAMPLE.replace('slot fx impact at 8', 'slot fx impact at Infinity')), /"slot at" expected a number/)
  assert.throws(() => parse(V11_EXAMPLE.replace('slot fx impact at 8', 'slot fx impact 8')), /slot expects <track> <clip> \[at <steps>\]/)
})

test('at > 0 or multiple placements on a non-audio track are rejected (D16 scope guard, design-doc wording)', () => {
  const audioOnly = /multi-placement is audio-only for now — synth\/drum clips tile from the section start/
  assert.throws(() => parse(V11_EXAMPLE.replace('slot lead melody', 'slot lead melody at 4')), audioOnly)
  assert.throws(() => parse(V11_EXAMPLE.replace('slot lead melody', 'slot lead melody\n  slot lead melody2')), audioOnly)
})

test('overlapping placements on one audio track are a validation error, computed from region in/out/rate and doc bpm', () => {
  // riser spans steps 0..8 (1 s at 120 bpm, rate 1) — impact at 4 lands inside it.
  assert.throws(() => parse(V11_EXAMPLE.replace('slot fx impact at 8', 'slot fx impact at 4')), /placements overlap on track "fx"/)
  // exactly back-to-back is legal (Ableton's no-overlap rule is exclusive of the end point)…
  const backToBack = parse(V11_EXAMPLE) // impact at 8 === riser's end
  assert.deepEqual(backToBack.scenes[0]!.slots.fx![1], { clip: 'impact', at: 8 })
  // …and the SAME clip placed twice at the same at is an overlap, not a legal duplicate.
  assert.throws(() => parse(V11_EXAMPLE.replace('slot fx riser at 24.5', 'slot fx riser at 0')), /placements overlap on track "fx"/)
})

test('overlap honors repitch rate: rate 2 halves a region\'s timeline length', () => {
  assert.equal(audioRegionTimelineSteps({ in: 0, out: 1, rate: 2 }, 120), 4)
  // riser2 (rate 2) spans steps 0..4 — impact at 4 is legal, at 3.9 overlaps.
  const base = V11_EXAMPLE.replace('  slot fx riser\n  slot fx impact at 8\n  slot fx riser at 24.5\n', '  slot fx riser2\n  slot fx impact at 4\n')
  assert.equal(serialize(parse(base)), base)
  assert.throws(() => parse(base.replace('slot fx impact at 4', 'slot fx impact at 3.9')), /placements overlap on track "fx"/)
})

test('a placement must reference an existing clip on that track (unchanged fail-loudly reference validation)', () => {
  assert.throws(() => parse(V11_EXAMPLE.replace('slot fx impact at 8', 'slot fx ghost at 8')), /unknown clip "ghost" on track "fx"/)
  assert.throws(() => parse(V11_EXAMPLE.replace('slot fx impact at 8', 'slot ghost impact at 8')), /unknown track "ghost"/)
})

// ---- diff: placement-granular, moves are moves --------------------------------------------------

test('adding / removing a placement diffs as one +clip@at / -clip@at entry, not a whole-slot change', () => {
  const a = parse(V11_EXAMPLE)
  const b = parse(V11_EXAMPLE.replace('  slot fx impact at 8\n', ''))
  const entries = diffDocuments(a, b)
  assert.deepEqual(entries, [{ kind: 'scene-slot', sceneId: 's1', trackId: 'fx', at: 8, before: 'impact', after: null }])
  assert.equal(formatDiff(entries), 'scene s1: fx -impact@8\n')
  const back = diffDocuments(b, a)
  assert.deepEqual(back, [{ kind: 'scene-slot', sceneId: 's1', trackId: 'fx', at: 8, before: null, after: 'impact' }])
  assert.equal(formatDiff(back), 'scene s1: fx +impact@8\n')
})

test('an `at` change diffs as ONE scene-slot-moved entry — a move, never remove+add', () => {
  const a = parse(V11_EXAMPLE)
  const b = parse(V11_EXAMPLE.replace('slot fx impact at 8', 'slot fx impact at 12'))
  const entries = diffDocuments(a, b)
  assert.deepEqual(entries, [{ kind: 'scene-slot-moved', sceneId: 's1', trackId: 'fx', clip: 'impact', before: 8, after: 12 }])
  assert.equal(formatDiff(entries), 'scene s1: fx impact moved @8 -> @12\n')
})

test('a single-clip swap at `at 0` still reads exactly as it did pre-v0.11', () => {
  const a = parse(V11_EXAMPLE)
  const b = parse(V11_EXAMPLE.replace('slot lead melody', 'slot lead melody2'))
  const entries = diffDocuments(a, b)
  assert.deepEqual(entries, [{ kind: 'scene-slot', sceneId: 's1', trackId: 'lead', at: 0, before: 'melody', after: 'melody2' }])
  assert.equal(formatDiff(entries), 'scene s1: lead melody -> melody2\n')
})

// ---- setScene: back-compatible input shapes + the same validation ------------------------------

test('setScene still accepts the pre-v0.11 Record<trackId, clipId> shape (one placement at 0)', () => {
  const doc = parse(V11_EXAMPLE)
  const next = setScene(doc, 's2', { lead: 'melody2', fx: 'impact' })
  assert.deepEqual(next.scenes[1]!.slots, { lead: [{ clip: 'melody2', at: 0 }], fx: [{ clip: 'impact', at: 0 }] })
  assert.equal(serialize(parse(serialize(next))), serialize(next))
})

test('setScene accepts placement lists, canonicalizes their order, and validates them', () => {
  const doc = parse(V11_EXAMPLE)
  const next = setScene(doc, 's2', { fx: [{ clip: 'impact', at: 8 }, { clip: 'riser', at: 0 }] })
  assert.deepEqual(next.scenes[1]!.slots.fx, [
    { clip: 'riser', at: 0 },
    { clip: 'impact', at: 8 },
  ])
  assert.throws(() => setScene(doc, 's2', { lead: [{ clip: 'melody', at: 4 }] }), /multi-placement is audio-only for now/)
  assert.throws(() => setScene(doc, 's2', { fx: [{ clip: 'riser', at: 0 }, { clip: 'impact', at: 4 }] }), /placements overlap on track "fx"/)
  assert.throws(() => setScene(doc, 's2', { fx: [{ clip: 'riser', at: -2 }] }), /at must be a finite number >= 0|invalid at/)
  assert.throws(() => setScene(doc, 's2', { fx: [{ clip: 'ghost', at: 0 }] }), /has no clip "ghost"/)
  // an empty placement list means "no slot for this track" — the key is simply absent
  const empty = setScene(doc, 's2', { fx: [] })
  assert.deepEqual(empty.scenes[1]!.slots, {})
})

// ---- placeClip / unplaceClip --------------------------------------------------------------------

test('placeClip adds one placement (canonically ordered) and fails loudly on every bad input', () => {
  const doc = parse(V11_EXAMPLE)
  const { doc: next, placement } = placeClip(doc, 's1', 'fx', 'impact', 12)
  assert.deepEqual(placement, { clip: 'impact', at: 12 })
  assert.deepEqual(next.scenes[0]!.slots.fx, [
    { clip: 'riser', at: 0 },
    { clip: 'impact', at: 8 },
    { clip: 'impact', at: 12 },
    { clip: 'riser', at: 24.5 },
  ])
  assert.equal(serialize(parse(serialize(next))), serialize(next))
  assert.throws(() => placeClip(doc, 'nope', 'fx', 'impact', 0), /no scene "nope"/)
  assert.throws(() => placeClip(doc, 's1', 'fx', 'ghost', 0), /has no clip "ghost"/)
  assert.throws(() => placeClip(doc, 's1', 'fx', 'impact', -1), /at must be a finite number >= 0/)
  assert.throws(() => placeClip(doc, 's1', 'fx', 'impact', Number.NaN), /at must be a finite number >= 0/)
  assert.throws(() => placeClip(doc, 's1', 'fx', 'impact', 10), /placements overlap on track "fx"/) // inside impact@8's 4-step span
  assert.throws(() => placeClip(doc, 's1', 'lead', 'melody2', 4), /multi-placement is audio-only for now/)
})

test('unplaceClip removes one placement; ambiguity without `at` fails loudly; last placement drops the track key', () => {
  const doc = parse(V11_EXAMPLE)
  // riser is placed twice — unplacing it without `at` must refuse, naming the candidates
  assert.throws(() => unplaceClip(doc, 's1', 'fx', 'riser'), /placed 2 times on track "fx" in scene "s1" \(at 0, 24\.5\) — pass the placement's at/)
  const { doc: next, removed } = unplaceClip(doc, 's1', 'fx', 'riser', 24.5)
  assert.deepEqual(removed, { clip: 'riser', at: 24.5 })
  assert.deepEqual(next.scenes[0]!.slots.fx, [
    { clip: 'riser', at: 0 },
    { clip: 'impact', at: 8 },
  ])
  // impact is placed once — no `at` needed
  const { doc: after } = unplaceClip(next, 's1', 'fx', 'impact')
  assert.deepEqual(after.scenes[0]!.slots.fx, [{ clip: 'riser', at: 0 }])
  // removing the last placement removes the track key entirely (no canonical form for an empty slot)
  const { doc: bare } = unplaceClip(after, 's1', 'fx', 'riser', 0)
  assert.equal(bare.scenes[0]!.slots.fx, undefined)
  assert.equal(serialize(parse(serialize(bare))), serialize(bare))
  // wrong at / never placed
  assert.throws(() => unplaceClip(doc, 's1', 'fx', 'impact', 3), /not placed at 3 on track "fx"/)
  assert.throws(() => unplaceClip(doc, 's1', 'fx', 'riser2'), /not placed on track "fx"/)
})

// ---- splitAudioClip auto-placement (D16 q3) -----------------------------------------------------

const SPLIT_EXAMPLE = `format_version 0.11
bpm 120
loop_bars 2
selected_track fx

media
  sample smp sha256:${SHA} media/smp.wav

track fx FX #56b6c2 audio
  clip riser
    audio smp 0 1 0 off 1
  clip other
    audio smp 0 0.5 0 off 1

scene s1
  slot fx riser
scene s2
  slot fx riser
  slot fx riser at 24.5
scene s3
  slot fx other
`

test('splitAudioClip auto-places the second half at placement.at + split steps in EVERY scene that placed the parent — and reports what it placed', () => {
  const doc = parse(SPLIT_EXAMPLE)
  const { doc: next, first, second, placements } = splitAudioClip(doc, 'fx', 'riser', 4)
  assert.equal(first.id, 'riser')
  assert.equal(second.id, 'riser-2')
  // single-placement scene: second half lands at 0 + 4
  assert.deepEqual(next.scenes[0]!.slots.fx, [
    { clip: 'riser', at: 0 },
    { clip: 'riser-2', at: 4 },
  ])
  // multi-placement parent: one auto-placement PER parent placement (0+4 and 24.5+4)
  assert.deepEqual(next.scenes[1]!.slots.fx, [
    { clip: 'riser', at: 0 },
    { clip: 'riser-2', at: 4 },
    { clip: 'riser', at: 24.5 },
    { clip: 'riser-2', at: 28.5 },
  ])
  // a scene that did NOT place the parent stays untouched
  assert.deepEqual(next.scenes[2]!.slots.fx, [{ clip: 'other', at: 0 }])
  // the return value reports every auto-placement made (Phase 36 PB prints these)
  assert.deepEqual(placements, [
    { sceneId: 's1', clip: 'riser-2', at: 4 },
    { sceneId: 's2', clip: 'riser-2', at: 4 },
    { sceneId: 's2', clip: 'riser-2', at: 28.5 },
  ])
  // the result is valid and canonical: halves tile the parent's span exactly, no overlap possible
  assert.equal(serialize(parse(serialize(next))), serialize(next))
})

test('parse throws BeatParseError and edits throw BeatEditError for placement violations (error-type discipline)', () => {
  assert.throws(() => parse(V11_EXAMPLE.replace('slot fx impact at 8', 'slot fx impact at 4')), BeatParseError)
  assert.throws(() => setScene(parse(V11_EXAMPLE), 's2', { lead: [{ clip: 'melody', at: 4 }] }), BeatEditError)
})
