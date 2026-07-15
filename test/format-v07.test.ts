// v0.7 grammar tests — fractional note timing (owner requirement 2026-07-11: live/tapped input
// lands between grid lines). Under test: decimal start/duration on note lines, canonical number
// formatting round-trips, non-canonical spellings canonicalize, addNote snaps to the 4-decimal
// canonical precision, and the validation floor (start >= 0, duration > 0).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parse,
  serialize,
  addNote,
  initDocument,
  diffDocuments,
  formatDiff,
  BeatEditError,
} from '../src/core/index.js'

const FRACTIONAL_EXAMPLE = `format_version 0.7
bpm 120
loop_bars 2
selected_track lead

track lead Lead #c678dd synth
  synth
    osc sawtooth
    volume -10
    cutoff 9000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.7
    release 0.3
    pan 0
  note u1 60 0 4 0.8
  note u2 64 3.5 0.5 0.7
  note u3 67 4.0312 2.25 0.6
`

test('fractional note timing round-trips byte-identically', () => {
  const doc = parse(FRACTIONAL_EXAMPLE)
  assert.equal(serialize(doc), FRACTIONAL_EXAMPLE)
  const notes = doc.tracks[0]!.notes
  assert.deepEqual(notes.map((n) => [n.start, n.duration]), [[0, 4], [3.5, 0.5], [4.0312, 2.25]])
})

test('non-canonical decimal spellings parse and re-serialize canonically', () => {
  const sloppy = FRACTIONAL_EXAMPLE.replace('note u2 64 3.5 0.5 0.7', 'note u2 64 3.50 0.500 0.7')
  assert.equal(serialize(parse(sloppy)), FRACTIONAL_EXAMPLE)
})

test('note timing validation: start >= 0, duration > 0', () => {
  assert.throws(() => parse(FRACTIONAL_EXAMPLE.replace('note u2 64 3.5', 'note u2 64 -0.5')), /note start must be >= 0/)
  assert.throws(() => parse(FRACTIONAL_EXAMPLE.replace('64 3.5 0.5', '64 3.5 0')), /note duration must be > 0/)
  assert.throws(() => parse(FRACTIONAL_EXAMPLE.replace('64 3.5 0.5', '64 3.5 -1')), /note duration must be > 0/)
  assert.throws(() => parse(FRACTIONAL_EXAMPLE.replace('64 3.5 0.5', '64 x 0.5')), /expected a number/)
})

test('addNote accepts fractional timing and snaps to canonical precision', () => {
  let doc = initDocument({ trackId: 'lead' })
  const before = doc
  const res = addNote(doc, 'lead', { pitch: 60, start: 3.14159265, duration: 0.333333333, velocity: 0.66666666 })
  doc = res.doc
  // stored values are exactly what a serialize→parse round-trip produces (4-decimal canon)
  assert.deepEqual(
    [res.note.start, res.note.duration, res.note.velocity],
    [3.1416, 0.3333, 0.6667],
  )
  const reparsed = parse(serialize(doc))
  assert.deepEqual(reparsed, doc)
  // diff prints canonical numbers
  assert.match(formatDiff(diffDocuments(before, doc)), /start 3\.1416, dur 0\.3333, vel 0\.6667/)
})

test('addNote still rejects bad timing', () => {
  const doc = initDocument({ trackId: 'lead' })
  assert.throws(() => addNote(doc, 'lead', { pitch: 60, start: -0.1, duration: 1, velocity: 0.5 }), BeatEditError)
  assert.throws(() => addNote(doc, 'lead', { pitch: 60, start: 0, duration: 0, velocity: 0.5 }), BeatEditError)
  // duration that rounds to zero at canonical precision is rejected, not silently stored
  assert.throws(() => addNote(doc, 'lead', { pitch: 60, start: 0, duration: 0.00004, velocity: 0.5 }), /canonical precision/)
})

test('new documents are stamped v0.11 (Phase 36: multi-region audio placement)', () => {
  assert.equal(initDocument({}).formatVersion, '0.11')
})
