// Velocity shaping (Phase 41 Stream E): `rampVelocity` (deterministic crescendo/decrescendo) and
// `randomizeVelocity` (seeded jitter), plus the GUI's hand-mirrored copy of the ramp formula.
//
// Why the ramp exists at all: humanize.ts already offered seeded Gaussian jitter, so the RANDOM
// half of velocity shaping was covered — but there was no deterministic SHAPE, i.e. no way to say
// "get louder across this phrase", which is the most common velocity edit there is. It matters most
// for loops: a 4-bar part repeated for hundreds of bars is the same notes over and over, and flat
// velocity is exactly what makes that read as a loop rather than a performance.
//
// The parity test at the bottom is the load-bearing one. `ui/` has no build-time dependency on
// src/core, so NoteView.tsx mirrors the ramp formula by hand; without a gate, `beat velocity ramp`
// and the GUI's Ramp button could silently draw different curves over the same notes.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse, serialize, rampVelocity, rampVelocityAt, randomizeVelocity, BeatPitchTimeError, type BeatDocument } from '../src/core/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root

const BASE = `format_version 0.11
bpm 125
loop_bars 1
selected_track lead

track lead Lead #61afef synth
  synth
    osc sawtooth
    volume -6
    cutoff 2000
    resonance 0.3
    attack 0.01
    decay 0.2
    sustain 0.7
    release 0.3
    pan 0
  note u1 61 0 2 0.5
  note u2 63 4 2 0.5
  note u3 66 8 2 0.5
  note u4 68 12 2 0.5
`
const doc = (): BeatDocument => parse(BASE)
const vels = (d: BeatDocument) => d.tracks[0]!.notes.slice().sort((a, b) => a.start - b.start).map((n) => n.velocity)

// ---- ramp -----------------------------------------------------------------------------------

test('ramp spreads velocities linearly across the scoped notes in start-time order', () => {
  const { doc: out, changed } = rampVelocity(doc(), 'lead', 0.2, 0.8)
  assert.deepEqual(vels(out), [0.2, 0.4, 0.6, 0.8])
  assert.equal(changed, 4)
})

test('ramp runs downward just as happily (a decrescendo is the same call, endpoints swapped)', () => {
  assert.deepEqual(vels(rampVelocity(doc(), 'lead', 0.8, 0.2).doc), [0.8, 0.6, 0.4, 0.2])
})

test('a single scoped note takes the ramp destination, not its origin', () => {
  // "Ramp to 0.9" over one note plainly means 0.9; taking `from` would make the control read as
  // broken on exactly the smallest selection a user is most likely to try first.
  const { doc: out } = rampVelocity(doc(), 'lead', 0.2, 0.9, { noteIds: ['u2'] })
  assert.equal(out.tracks[0]!.notes.find((n) => n.id === 'u2')!.velocity, 0.9)
  assert.equal(rampVelocityAt(0.2, 0.9, 0, 1), 0.9)
})

test('ramp respects a note-id scope and leaves everything else alone', () => {
  const { doc: out, changed } = rampVelocity(doc(), 'lead', 0, 1, { noteIds: ['u1', 'u3'] })
  const byId = new Map(out.tracks[0]!.notes.map((n) => [n.id, n.velocity]))
  assert.equal(byId.get('u1'), 0)
  assert.equal(byId.get('u3'), 1)
  assert.equal(byId.get('u2'), 0.5, 'an unscoped note must not move')
  assert.equal(byId.get('u4'), 0.5)
  assert.equal(changed, 2)
})

test('ramp orders by start time, not by document or id order', () => {
  // The notes are declared u1..u4 in ascending start order above, so shuffle the starts to prove
  // the ordering is really temporal. A ramp is a claim about the phrase's shape in TIME.
  const d = doc()
  const shuffled: BeatDocument = {
    ...d,
    tracks: d.tracks.map((t) => ({ ...t, notes: t.notes.map((n) => (n.id === 'u1' ? { ...n, start: 12 } : n.id === 'u4' ? { ...n, start: 0 } : n)) })),
  }
  const { doc: out } = rampVelocity(shuffled, 'lead', 0, 1)
  const byId = new Map(out.tracks[0]!.notes.map((n) => [n.id, n.velocity]))
  assert.equal(byId.get('u4'), 0, 'the note that now starts FIRST takes the ramp start')
  assert.equal(byId.get('u1'), 1, 'the note that now starts LAST takes the ramp end')
})

test('ramp rejects out-of-range endpoints and drum tracks', () => {
  assert.throws(() => rampVelocity(doc(), 'lead', -0.1, 1), BeatPitchTimeError)
  assert.throws(() => rampVelocity(doc(), 'lead', 0, 1.5), BeatPitchTimeError)
  assert.throws(() => rampVelocity(doc(), 'nope', 0, 1), BeatPitchTimeError)
})

test('ramp reports 0 changed when the notes are already at those values (a no-op is not an error)', () => {
  const once = rampVelocity(doc(), 'lead', 0.2, 0.8).doc
  assert.equal(rampVelocity(once, 'lead', 0.2, 0.8).changed, 0)
})

test('ramped velocities round-trip through the file at canonical precision', () => {
  // 3 notes from 0 to 1 hits 0.5 exactly, but 4 notes from 0.1 to 0.9 does not divide evenly —
  // the canonical 4-decimal snap has to happen on the way IN, or serialize/parse would not be a
  // fixed point and the doc would differ from what was written.
  const { doc: out } = rampVelocity(doc(), 'lead', 0.1, 0.9)
  assert.deepEqual(parse(serialize(out)), out)
})

// ---- randomize ------------------------------------------------------------------------------

test('randomize is reproducible from its seed', () => {
  const a = rampVelocity(doc(), 'lead', 0.5, 0.5).doc
  const one = randomizeVelocity(a, 'lead', 0.2, { seed: 7 }).doc
  const two = randomizeVelocity(a, 'lead', 0.2, { seed: 7 }).doc
  assert.deepEqual(vels(one), vels(two))
  const other = randomizeVelocity(a, 'lead', 0.2, { seed: 8 }).doc
  assert.notDeepEqual(vels(one), vels(other), 'a different seed must actually give a different result')
})

test('randomize stays inside +/-amount and clamps to 0..1 rather than wrapping', () => {
  const { doc: out } = randomizeVelocity(doc(), 'lead', 0.2, { seed: 3 })
  for (const n of out.tracks[0]!.notes) {
    assert.ok(n.velocity >= 0 && n.velocity <= 1, `velocity ${n.velocity} left 0..1`)
    assert.ok(Math.abs(n.velocity - 0.5) <= 0.2 + 1e-9, `velocity ${n.velocity} moved more than the amount allowed`)
  }
  // At the extremes, clamping (not wrapping) is what keeps a loud part loud.
  const loud = parse(BASE.replace(/0\.5$/gm, '1'))
  for (const n of randomizeVelocity(loud, 'lead', 0.5, { seed: 2 }).doc.tracks[0]!.notes) {
    assert.ok(n.velocity <= 1)
  }
})

test("randomize's draws are consumed in (start, id) order, so a later note cannot shift an earlier one", () => {
  // The property that makes a seed worth having: extending a phrase must not re-roll the part of it
  // you already liked.
  const base = doc()
  const first = randomizeVelocity(base, 'lead', 0.2, { seed: 5 }).doc
  const extended: BeatDocument = {
    ...base,
    tracks: base.tracks.map((t) => ({ ...t, notes: [...t.notes, { ...t.notes[0]!, id: 'u9', start: 14 }] })),
  }
  const after = randomizeVelocity(extended, 'lead', 0.2, { seed: 5 }).doc
  for (const id of ['u1', 'u2', 'u3', 'u4']) {
    assert.equal(
      after.tracks[0]!.notes.find((n) => n.id === id)!.velocity,
      first.tracks[0]!.notes.find((n) => n.id === id)!.velocity,
      `note ${id} was re-rolled by appending a LATER note`,
    )
  }
})

test('randomize rejects a zero or out-of-range amount', () => {
  assert.throws(() => randomizeVelocity(doc(), 'lead', 0), BeatPitchTimeError)
  assert.throws(() => randomizeVelocity(doc(), 'lead', 1.5), BeatPitchTimeError)
})

// ---- CLI/GUI parity on the ramp formula ------------------------------------------------------

test("the GUI's mirrored rampVelocityAt is byte-identical to core's", () => {
  // Same technique as test/ui-scale-parity.test.ts: node --test cannot mount React, but the formula
  // is textual. Compare the function BODY, normalized for whitespace — if someone edits one copy,
  // this fails and names the file to fix.
  const src = readFileSync(join(repoRoot, 'ui', 'src', 'components', 'NoteView.tsx'), 'utf8')
  const m = src.match(/function rampVelocityAt\([^)]*\)[^{]*\{([\s\S]*?)\n\}/)
  assert.ok(m, 'ui/src/components/NoteView.tsx no longer declares rampVelocityAt — if the GUI ramp moved, point this parity test at its new home rather than deleting it')
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  assert.equal(
    norm(m![1]!),
    norm('if (n <= 1) return to\n  return from + (to - from) * (i / (n - 1))'),
    "the GUI's ramp formula drifted from src/core/pitchtime.ts's rampVelocityAt — `beat velocity ramp` and the GUI Ramp button would draw different curves",
  )
})

test("core's rampVelocityAt matches the values the GUI would compute, position by position", () => {
  // Belt and braces on top of the textual check: pin the actual numbers, so a refactor that changes
  // BOTH copies identically-but-wrongly still has to argue with an expectation.
  assert.deepEqual([0, 1, 2, 3].map((i) => rampVelocityAt(0.2, 0.8, i, 4)), [0.2, 0.4, 0.6000000000000001, 0.8])
  assert.deepEqual([0, 1, 2].map((i) => rampVelocityAt(1, 0, i, 3)), [1, 0.5, 0])
  assert.equal(rampVelocityAt(0.3, 0.7, 0, 1), 0.7)
})
