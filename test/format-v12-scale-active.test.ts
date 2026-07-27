// v0.12 (Phase 41 Stream E) format additions: a track's declared `scale` line and a note's
// `active=0` deactivate token. Both follow the canonical-elision contract v0.10's note fields
// established — absent from the text iff at the default — which is what makes every pre-v0.12
// file round-trip byte-identically, asserted directly below rather than assumed.
//
// The scale table gains two THIRD-LESS sets plus a `custom` explicit-pitch-class form. The
// motivating case is a real measurement, and it is tested as one: a reference track whose tonic
// is unambiguous but whose chroma has both thirds as its two RAREST pitch classes. No named
// major/minor/modal scale can express that; `susPentatonic` and `custom` can, and the tests below
// pin exactly that claim rather than merely checking a table lookup works.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parse, serialize, setValue, addNote, setTrackScale, parseScaleValue,
  SCALES, isPitchInScale, scaleHasThird, resolveScalePitchClasses, canonicalPitchClasses,
  BeatParseError, BeatEditError, BeatPitchTimeError,
  type BeatDocument, type BeatScale,
} from '../src/core/index.js'

const parseBeat = (t: string): BeatDocument => parse(t)
const serializeBeat = (d: BeatDocument): string => serialize(d)

const BASE = `format_version 0.11
bpm 125
loop_bars 4
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
  note u1 61 0 2 0.8
  note u2 68 4 2 0.8
`

const roundTrip = (text: string) => serializeBeat(parseBeat(text))

// ---- backward compatibility: the whole point of canonical elision -------------------------

test('a pre-v0.12 file with no scale line and no active token round-trips byte-identically', () => {
  assert.equal(roundTrip(BASE), BASE)
})

test('parsing a pre-v0.12 file gives every note active=true and every track scale=null', () => {
  const doc = parseBeat(BASE)
  assert.deepEqual(doc.tracks[0]!.notes.map((n) => n.active), [true, true])
  assert.equal(doc.tracks[0]!.scale, null)
})

// ---- note `active` -------------------------------------------------------------------------

test('a deactivated note serializes `active=0` and round-trips', () => {
  const doc = parseBeat(BASE)
  const muted = { ...doc, tracks: doc.tracks.map((t) => ({ ...t, notes: t.notes.map((n) => (n.id === 'u1' ? { ...n, active: false } : n)) })) }
  const text = serializeBeat(muted)
  assert.match(text, /note u1 61 0 2 0\.8 active=0/)
  // and the untouched note gains nothing
  assert.match(text, /note u2 68 4 2 0\.8\n/)
  assert.equal(roundTrip(text), text)
})

test('active=1 parses (a hand edit may spell the default out) but re-serializes elided', () => {
  const text = BASE.replace('note u1 61 0 2 0.8\n', 'note u1 61 0 2 0.8 active=1\n')
  const doc = parseBeat(text)
  assert.equal(doc.tracks[0]!.notes.find((n) => n.id === 'u1')!.active, true)
  assert.equal(serializeBeat(doc), BASE) // canonical form has one spelling, and it's the elided one
})

test('a non-boolean active token is rejected loudly', () => {
  const text = BASE.replace('note u1 61 0 2 0.8\n', 'note u1 61 0 2 0.8 active=maybe\n')
  assert.throws(() => parseBeat(text), BeatParseError)
})

test('active rides the same <track>.note.<id>.<field> path as chance/cent, accepting 0/1 and off/on', () => {
  const doc = parseBeat(BASE)
  for (const falsey of ['0', 'false', 'off', 'no']) {
    const next = setValue(doc, `lead.note.u1.active`, falsey)
    assert.equal(next.tracks[0]!.notes.find((n) => n.id === 'u1')!.active, false, falsey)
  }
  const off = setValue(doc, 'lead.note.u1.active', '0')
  assert.equal(setValue(off, 'lead.note.u1.active', 'on').tracks[0]!.notes.find((n) => n.id === 'u1')!.active, true)
  assert.throws(() => setValue(doc, 'lead.note.u1.active', 'sometimes'), BeatEditError)
})

test('deactivating is NOT deleting — the note keeps its id and every other field', () => {
  const doc = parseBeat(BASE)
  const before = doc.tracks[0]!.notes.find((n) => n.id === 'u1')!
  const after = setValue(doc, 'lead.note.u1.active', '0').tracks[0]!.notes.find((n) => n.id === 'u1')!
  assert.equal(doc.tracks[0]!.notes.length, setValue(doc, 'lead.note.u1.active', '0').tracks[0]!.notes.length)
  assert.deepEqual({ ...after, active: true }, before)
})

test('editing another field on a muted note does not silently re-activate it', () => {
  // The exact regression the v0.10 fields' own carry-over rule exists to prevent, re-asserted for
  // the new field: nudging a start must not un-mute a note the user deliberately silenced.
  const doc = setValue(parseBeat(BASE), 'lead.note.u1.active', '0')
  const moved = setValue(doc, 'lead.note.u1.start', '1')
  const n = moved.tracks[0]!.notes.find((x) => x.id === 'u1')!
  assert.equal(n.active, false)
  assert.equal(n.start, 1)
})

test('addNote defaults active to true and accepts an explicit false', () => {
  const doc = parseBeat(BASE)
  assert.equal(addNote(doc, 'lead', { pitch: 63, start: 8, duration: 2, velocity: 0.5 }).note.active, true)
  assert.equal(addNote(doc, 'lead', { pitch: 63, start: 8, duration: 2, velocity: 0.5, active: false }).note.active, false)
})

// ---- track `scale` -------------------------------------------------------------------------

test('a named scale line serializes, parses, and round-trips', () => {
  const doc = setTrackScale(parseBeat(BASE), 'lead', { root: 1, name: 'susPentatonic', pitchClasses: null })
  const text = serializeBeat(doc)
  assert.match(text, /^ {2}scale 1 susPentatonic$/m)
  assert.equal(roundTrip(text), text)
  assert.deepEqual(parseBeat(text).tracks[0]!.scale, { root: 1, name: 'susPentatonic', pitchClasses: null })
})

test('a custom scale line carries its explicit pitch classes and round-trips', () => {
  const doc = setTrackScale(parseBeat(BASE), 'lead', { root: 1, name: 'custom', pitchClasses: [0, 2, 5, 7, 10] })
  const text = serializeBeat(doc)
  assert.match(text, /^ {2}scale 1 custom 0,2,5,7,10$/m)
  assert.equal(roundTrip(text), text)
})

test('parse rejects a non-canonical custom pitch-class list rather than silently rewriting the file', () => {
  // Reader and writer must agree on what canonical looks like — the asymmetry the groove line's
  // own comment records having been bitten by. An unsorted list is a loud error, not a quiet fix.
  const text = BASE.replace('  note u1', '  scale 1 custom 0,7,2,5,10\n  note u1')
  assert.throws(() => parseBeat(text), BeatParseError)
})

test('parse rejects a custom scale without its own root, an out-of-range root, and an unknown name', () => {
  const withLine = (line: string) => BASE.replace('  note u1', `  ${line}\n  note u1`)
  assert.throws(() => parseBeat(withLine('scale 1 custom 2,5,7,10')), BeatParseError) // no 0
  assert.throws(() => parseBeat(withLine('scale 12 major')), BeatParseError) // root out of range
  assert.throws(() => parseBeat(withLine('scale 1 klingon')), BeatParseError) // unknown name
  assert.throws(() => parseBeat(withLine('scale 1 major 0,2,4')), BeatParseError) // named + explicit pcs
  assert.throws(() => parseBeat(withLine('scale 1 custom')), BeatParseError) // custom without pcs
})

test('a scale line is rejected on a drums track', () => {
  const drumFile = `format_version 0.11
bpm 120
loop_bars 1
selected_track d

track d D #e35d5d drums
  scale 1 major
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
`
  assert.throws(() => parseBeat(drumFile), BeatParseError)
})

test('<track>.scale sets both forms and an empty value clears the declaration', () => {
  const doc = parseBeat(BASE)
  assert.deepEqual(setValue(doc, 'lead.scale', '1 susPentatonic').tracks[0]!.scale, { root: 1, name: 'susPentatonic', pitchClasses: null })
  assert.deepEqual(setValue(doc, 'lead.scale', '1 custom 0,2,5,7,10').tracks[0]!.scale, { root: 1, name: 'custom', pitchClasses: [0, 2, 5, 7, 10] })
  const set = setValue(doc, 'lead.scale', '1 susPentatonic')
  assert.equal(setValue(set, 'lead.scale', '').tracks[0]!.scale, null)
  assert.throws(() => setValue(doc, 'lead.scale', '1 klingon'), BeatEditError)
})

test('parseScaleValue canonicalizes an out-of-order custom set (the EDIT path may repair; the FILE path may not)', () => {
  // Deliberate asymmetry, and it is the right one: a user typing into a field shouldn't have to
  // sort by hand, but a file on disk must have exactly one canonical spelling.
  assert.deepEqual(parseScaleValue('1 custom 7,0,2,10,5').pitchClasses, [0, 2, 5, 7, 10])
  assert.deepEqual(parseScaleValue('1 custom 0,0,2,2').pitchClasses, [0, 2])
})

// ---- the third-less claim, which is the whole reason this row exists -----------------------

test('every pre-v0.12 scale commits to a third; the two new ones do not', () => {
  const third = (name: string) => scaleHasThird({ root: 0, name, pitchClasses: null })
  for (const name of ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian', 'harmonicMinor', 'melodicMinor', 'majorPentatonic', 'minorPentatonic', 'blues', 'chromatic']) {
    assert.equal(third(name), true, `${name} should contain a third`)
  }
  assert.equal(third('susPentatonic'), false)
  assert.equal(third('susHexatonic'), false)
})

test('susPentatonic on C# is exactly the measured Twin Souls pitch-class set, and excludes both thirds', () => {
  // The measurement: tonic C# (r=0.865 harmonic / 0.890 bass), colour tones C#(40) G#(34) D#(21)
  // F#(17) B(15) strong, E(4) and F(9) — the minor and major third — the two rarest classes.
  const scale: BeatScale = { root: 1, name: 'susPentatonic', pitchClasses: null }
  const named = { 'C#': 1, 'D#': 3, 'F#': 6, 'G#': 8, B: 11 }
  for (const [label, pc] of Object.entries(named)) {
    assert.equal(isPitchInScale(60 + pc, scale), true, `${label} should be in scale`)
  }
  // The two thirds are OUT — this is the assertion the whole feature exists to make true.
  assert.equal(isPitchInScale(64, scale), false, 'E (minor third of C#) must be out of scale')
  assert.equal(isPitchInScale(65, scale), false, 'F (major third of C#) must be out of scale')
  // Every octave of E, not just the one.
  for (const e of [40, 52, 64, 76, 88]) assert.equal(isPitchInScale(e, scale), false, `E${e} must be out of scale`)
})

test('the custom form can express any measured pitch-class set, including ones no named mode covers', () => {
  // C# with no third and no second either — a set with no name at all, which is exactly why
  // `custom` exists rather than an ever-growing SCALES table.
  const scale: BeatScale = { root: 1, name: 'custom', pitchClasses: [0, 5, 7, 10] }
  assert.deepEqual([...resolveScalePitchClasses(scale)], [0, 5, 7, 10])
  assert.equal(isPitchInScale(61, scale), true) // C#
  assert.equal(isPitchInScale(63, scale), false) // D# — excluded by this narrower set
  assert.equal(isPitchInScale(64, scale), false) // E
  assert.equal(isPitchInScale(65, scale), false) // F
  assert.equal(isPitchInScale(66, scale), true) // F#
})

test('resolveScalePitchClasses and canonicalPitchClasses fail loudly rather than guessing', () => {
  assert.throws(() => resolveScalePitchClasses({ root: 0, name: 'custom', pitchClasses: null }), BeatPitchTimeError)
  assert.throws(() => resolveScalePitchClasses({ root: 0, name: 'nope', pitchClasses: null }), BeatPitchTimeError)
  assert.throws(() => canonicalPitchClasses([]), BeatPitchTimeError)
  assert.throws(() => canonicalPitchClasses([1, 2]), BeatPitchTimeError) // no root
  assert.throws(() => canonicalPitchClasses([0, 12]), BeatPitchTimeError) // out of range
  assert.throws(() => canonicalPitchClasses([0, 1.5]), BeatPitchTimeError) // non-integer
})

test('adding the new scales did not disturb any existing table entry', () => {
  // Not frozen-eval-constant territory, but the same instinct: these tables are referenced by
  // stored files, so an accidental edit to an existing row silently re-interprets documents.
  assert.deepEqual([...SCALES.major!], [0, 2, 4, 5, 7, 9, 11])
  assert.deepEqual([...SCALES.minor!], [0, 2, 3, 5, 7, 8, 10])
  assert.deepEqual([...SCALES.minorPentatonic!], [0, 3, 5, 7, 10])
  assert.deepEqual([...SCALES.susPentatonic!], [0, 2, 5, 7, 10])
  assert.deepEqual([...SCALES.susHexatonic!], [0, 2, 5, 7, 9, 10])
})
