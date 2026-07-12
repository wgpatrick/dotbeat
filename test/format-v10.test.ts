// v0.10 grammar tests (Phase 22 Stream AD): the note optional fields (chance/cent/ratchet*) and
// the track-level `groove` line. Under test: canonical elision (default = no token/no line, so
// every pre-v0.10 file parses unchanged — "existing files are unaffected" per the phase brief),
// byte-identical round-trips, out-of-order/duplicate/unknown-field parse errors, and range
// validation.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse, serialize, addNote, addTrack, initDocument, setValue, BeatParseError, BeatEditError } from '../src/core/index.js'

const lead = (doc: ReturnType<typeof initDocument>) => doc.tracks.find((t) => t.id === 'lead')!

// ---- canonical elision: a note at every default serializes with NO optional tokens ----------

test('a note with every v0.10 field at its default serializes with no optional tokens', () => {
  const doc = addNote(initDocument({ trackId: 'lead' }), 'lead', { pitch: 60, start: 0, duration: 2, velocity: 0.8 }).doc
  const text = serialize(doc)
  const noteLine = text.split('\n').find((l) => l.trim().startsWith('note'))!
  assert.equal(noteLine.trim(), `note ${lead(doc).notes[0]!.id} 60 0 2 0.8`, 'no chance=/cent=/ratchet* tokens at defaults')
})

test('a pre-v0.10 file (no optional note tokens) parses with every field at its default', () => {
  const text = `format_version 0.9
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
  synth
    osc sine
    volume 0
    cutoff 1000
    resonance 1
    attack 0.01
    decay 0.1
    sustain 0.5
    release 0.1
    pan 0
  note n1 60 0 2 0.8
`
  const doc = parse(text)
  assert.deepEqual(lead(doc).notes[0], { id: 'n1', pitch: 60, start: 0, duration: 2, velocity: 0.8, chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 })
  // and a track with no `groove` line gets the canonical "off" default
  assert.equal(lead(doc).shuffleAmount, 0)
  assert.equal(lead(doc).shuffleGrid, 1)
})

// ---- each field, individually elided, round-trips byte-identically --------------------------

test('chance/cent/ratchet* each serialize independently, in canonical order, and round-trip', () => {
  let doc = addNote(initDocument({ trackId: 'lead' }), 'lead', { pitch: 60, start: 0, duration: 2, velocity: 0.8, id: 'n1' }).doc
  doc = setValue(doc, 'lead.note.n1.chance', '70')
  const text1 = serialize(doc)
  assert.match(text1, /note n1 60 0 2 0\.8 chance=70\n/)
  assert.equal(serialize(parse(text1)), text1)

  doc = setValue(doc, 'lead.note.n1.cent', '-12.5')
  const text2 = serialize(doc)
  assert.match(text2, /note n1 60 0 2 0\.8 chance=70 cent=-12\.5\n/)
  assert.equal(serialize(parse(text2)), text2)

  doc = setValue(doc, 'lead.note.n1.ratchetCount', '3')
  doc = setValue(doc, 'lead.note.n1.ratchetCurve', '0.5')
  doc = setValue(doc, 'lead.note.n1.ratchetLength', '0.75')
  const text3 = serialize(doc)
  assert.match(text3, /note n1 60 0 2 0\.8 chance=70 cent=-12\.5 ratchetCount=3 ratchetCurve=0\.5 ratchetLength=0\.75\n/)
  assert.equal(serialize(parse(text3)), text3)
})

test('note fields parse in any order (liberal in) but always re-serialize canonically (strict out)', () => {
  const text = `format_version 0.10
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
  synth
    osc sine
    volume 0
    cutoff 1000
    resonance 1
    attack 0.01
    decay 0.1
    sustain 0.5
    release 0.1
    pan 0
  note n1 60 0 2 0.8 ratchetLength=0.5 chance=80 ratchetCurve=0.2 cent=5 ratchetCount=2
`
  const doc = parse(text)
  const n = lead(doc).notes[0]!
  assert.equal(n.chance, 80)
  assert.equal(n.cent, 5)
  assert.equal(n.ratchetCount, 2)
  assert.equal(n.ratchetCurve, 0.2)
  assert.equal(n.ratchetLength, 0.5)
  assert.match(serialize(doc), /note n1 60 0 2 0\.8 chance=80 cent=5 ratchetCount=2 ratchetCurve=0\.2 ratchetLength=0\.5\n/)
})

// ---- parse-time validation --------------------------------------------------------------------

test('note field parsing rejects out-of-range values, duplicates, and unknown keys', () => {
  const base = (extra: string) => `format_version 0.10
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
  synth
    osc sine
    volume 0
    cutoff 1000
    resonance 1
    attack 0.01
    decay 0.1
    sustain 0.5
    release 0.1
    pan 0
  note n1 60 0 2 0.8 ${extra}
`
  assert.throws(() => parse(base('chance=101')), BeatParseError)
  assert.throws(() => parse(base('chance=-1')), BeatParseError)
  assert.throws(() => parse(base('cent=51')), BeatParseError)
  assert.throws(() => parse(base('cent=-51')), BeatParseError)
  assert.throws(() => parse(base('ratchetCount=0')), BeatParseError)
  assert.throws(() => parse(base('ratchetCount=17')), BeatParseError)
  assert.throws(() => parse(base('ratchetCurve=1.5')), BeatParseError)
  assert.throws(() => parse(base('ratchetLength=0')), BeatParseError)
  assert.throws(() => parse(base('ratchetLength=1.5')), BeatParseError)
  assert.throws(() => parse(base('chance=70 chance=80')), BeatParseError, 'duplicate field')
  assert.throws(() => parse(base('bogus=1')), BeatParseError, 'unknown field')
  assert.throws(() => parse(base('chance')), BeatParseError, 'not key=value')
})

test('addNote/setValue reject out-of-range v0.10 note fields the same way the parser does', () => {
  const doc = initDocument({ trackId: 'lead' })
  assert.throws(() => addNote(doc, 'lead', { pitch: 60, start: 0, duration: 1, velocity: 0.8, chance: 101 }), BeatEditError)
  assert.throws(() => addNote(doc, 'lead', { pitch: 60, start: 0, duration: 1, velocity: 0.8, cent: 60 }), BeatEditError)
  assert.throws(() => addNote(doc, 'lead', { pitch: 60, start: 0, duration: 1, velocity: 0.8, ratchetCount: 0 }), BeatEditError)
  const withNote = addNote(doc, 'lead', { pitch: 60, start: 0, duration: 1, velocity: 0.8, id: 'n1' }).doc
  assert.throws(() => setValue(withNote, 'lead.note.n1.chance', '200'), BeatEditError)
})

// ---- groove line --------------------------------------------------------------------------

test('a track with shuffleAmount 0 (the default) serializes with no groove line', () => {
  const doc = initDocument({ trackId: 'lead' })
  assert.doesNotMatch(serialize(doc), /groove/)
})

test('groove is set via beat set\'s <track>.shuffleAmount/<track>.shuffleGrid grammar and round-trips', () => {
  let doc = initDocument({ trackId: 'lead' })
  doc = setValue(doc, 'lead.shuffleAmount', '0.6')
  doc = setValue(doc, 'lead.shuffleGrid', '2')
  assert.equal(lead(doc).shuffleAmount, 0.6)
  assert.equal(lead(doc).shuffleGrid, 2)
  const text = serialize(doc)
  assert.match(text, /  groove 0\.6 2\n/)
  assert.equal(serialize(parse(text)), text)
})

test('groove validates amount 0..1 and a positive grid', () => {
  const doc = initDocument({ trackId: 'lead' })
  assert.throws(() => setValue(doc, 'lead.shuffleAmount', '1.5'), BeatEditError)
  assert.throws(() => setValue(doc, 'lead.shuffleAmount', '-0.1'), BeatEditError)
  assert.throws(() => setValue(doc, 'lead.shuffleGrid', '0'), BeatEditError)
  assert.throws(() => setValue(doc, 'lead.shuffleGrid', '-1'), BeatEditError)
})

test('groove line parse-time validation and structure', () => {
  const withGroove = (line: string) => `format_version 0.10
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
  synth
    osc sine
    volume 0
    cutoff 1000
    resonance 1
    attack 0.01
    decay 0.1
    sustain 0.5
    release 0.1
    pan 0
  ${line}
`
  assert.throws(() => parse(withGroove('groove 1.5 1')), BeatParseError, 'amount out of range')
  assert.throws(() => parse(withGroove('groove 0.5 0')), BeatParseError, 'grid must be > 0')
  assert.throws(() => parse(withGroove('groove 0.5')), BeatParseError, 'wrong arity')
  const doc = parse(withGroove('groove 0.5 2'))
  assert.equal(lead(doc).shuffleAmount, 0.5)
  assert.equal(lead(doc).shuffleGrid, 2)
})

test('groove applies to drum tracks too (a track-level field, not synth-kind-specific)', () => {
  let doc = addTrack(initDocument({ trackId: 'lead' }), { id: 'drums', kind: 'drums' }).doc
  doc = setValue(doc, 'drums.shuffleAmount', '0.3')
  assert.equal(doc.tracks.find((t) => t.id === 'drums')!.shuffleAmount, 0.3)
  assert.match(serialize(doc), /track drums[\s\S]*?\n  groove 0\.3 1\n/)
})
