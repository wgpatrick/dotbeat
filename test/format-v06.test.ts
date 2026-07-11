// v0.6 grammar tests — instrument tracks (docs/phase-8-plan.md). Under test: the soundfont
// voice line (media-referenced SF2 + program), volume/pan elision at defaults, notes-on-
// instruments, the deliberate exclusions (no synth block, no clips), and the beatlab-partials
// exclusion (beatlab has no instrument kind yet — they render via the spessasynth path).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parse,
  serialize,
  addTrack,
  addNote,
  setValue,
  setMediaSample,
  initDocument,
  diffDocuments,
  formatDiff,
  beatDocumentToPartialTracks,
  BeatEditError,
} from '../src/core/index.js'

const SHA = 'c'.repeat(64)

const INSTRUMENT_EXAMPLE = `format_version 0.6
bpm 100
loop_bars 2
selected_track keys

media
  sample piano sha256:${SHA} media/piano.sf2

track keys Keys #98c379 instrument
  soundfont piano 0
  volume -6
  pan 0.1
  note u1 60 0 8 0.7
  note u2 64 0 8 0.6
`

test('an instrument track round-trips byte-identically', () => {
  const doc = parse(INSTRUMENT_EXAMPLE)
  assert.equal(serialize(doc), INSTRUMENT_EXAMPLE)
  const keys = doc.tracks[0]!
  assert.equal(keys.kind, 'instrument')
  assert.deepEqual(keys.instrument, { sample: 'piano', program: 0, volume: -6, pan: 0.1 })
  assert.equal(keys.notes.length, 2)
})

test('volume/pan elide at their defaults (-10 dB, center)', () => {
  const doc = parse(INSTRUMENT_EXAMPLE)
  const atDefaults = {
    ...doc,
    tracks: doc.tracks.map((t) => ({ ...t, instrument: { ...t.instrument!, volume: -10, pan: 0 } })),
  }
  const text = serialize(atDefaults)
  assert.ok(!text.includes('  volume'), 'default volume elided')
  assert.ok(!text.includes('  pan'), 'default pan elided')
  assert.equal(serialize(parse(text)), text)
})

test('instrument validation fails loudly', () => {
  // missing soundfont line (volume/pan removed too — they independently require it first)
  assert.throws(
    () => parse(INSTRUMENT_EXAMPLE.replace('  soundfont piano 0\n', '').replace('  volume -6\n', '').replace('  pan 0.1\n', '')),
    /missing its soundfont line/,
  )
  // volume/pan before the soundfont line is also rejected (canonical order)
  assert.throws(() => parse(INSTRUMENT_EXAMPLE.replace('  soundfont piano 0\n', '').replace('  pan 0.1', '  soundfont piano 0')), /must come after the soundfont line/)
  // unknown sample ref
  assert.throws(() => parse(INSTRUMENT_EXAMPLE.replace('soundfont piano 0', 'soundfont ghost 0')), /unknown sample "ghost"/)
  // program out of range
  assert.throws(() => parse(INSTRUMENT_EXAMPLE.replace('soundfont piano 0', 'soundfont piano 128')), /program must be 0-127/)
  // duplicate soundfont line
  assert.throws(() => parse(INSTRUMENT_EXAMPLE.replace('  volume -6', '  soundfont piano 1')), /duplicate soundfont/)
  // synth block forbidden
  assert.throws(() => parse(INSTRUMENT_EXAMPLE.replace('  soundfont piano 0', '  synth')), /instrument tracks have no synth block/)
  // clips forbidden (v0.6)
  assert.throws(() => parse(INSTRUMENT_EXAMPLE.replace('  note u1 60 0 8 0.7', '  clip x\n    note c1 60 0 1 0.5')), /do not carry clips in v0\.6/)
  // soundfont line on a synth track forbidden
  const synthTrack = INSTRUMENT_EXAMPLE.replace('#98c379 instrument', '#98c379 synth')
  assert.throws(() => parse(synthTrack), /soundfont lines only belong in instrument tracks/)
})

function docWithPiano() {
  let doc = initDocument({ trackId: 'lead' })
  doc = setMediaSample(doc, 'piano', SHA, 'media/piano.sf2')
  return doc
}

test('addTrack builds instrument tracks and validates the soundfont ref', () => {
  const doc = docWithPiano()
  const { doc: withKeys } = addTrack(doc, { id: 'keys', kind: 'instrument', soundfont: { sample: 'piano', program: 3 } })
  const keys = withKeys.tracks.find((t) => t.id === 'keys')!
  assert.deepEqual(keys.instrument, { sample: 'piano', program: 3, volume: -10, pan: 0 })
  assert.equal(serialize(parse(serialize(withKeys))), serialize(withKeys))
  assert.throws(() => addTrack(doc, { id: 'k2', kind: 'instrument' }), /need a soundfont/)
  assert.throws(() => addTrack(doc, { id: 'k2', kind: 'instrument', soundfont: { sample: 'ghost', program: 0 } }), /register it with beat sample first/)
})

test('setValue drives instrument fields with instrument-param diff entries', () => {
  let doc = addTrack(docWithPiano(), { id: 'keys', kind: 'instrument', soundfont: { sample: 'piano', program: 0 } }).doc
  const before = doc
  doc = setValue(doc, 'keys.volume', '-4')
  doc = setValue(doc, 'keys.pan', '-0.2')
  doc = setValue(doc, 'keys.program', '5')
  const text = formatDiff(diffDocuments(before, doc))
  assert.match(text, /keys: program 0 -> 5/)
  assert.match(text, /keys: volume -10 -> -4/)
  assert.match(text, /keys: pan 0 -> -0\.2/)
  assert.throws(() => setValue(doc, 'keys.cutoff', '900'), /unknown field "cutoff" on instrument track/)
  assert.throws(() => setValue(doc, 'keys.program', '200'), BeatEditError)
  assert.throws(() => setValue(doc, 'keys.soundfont', 'ghost'), BeatEditError)
})

test('notes land on instrument tracks via addNote', () => {
  let doc = addTrack(docWithPiano(), { id: 'keys', kind: 'instrument', soundfont: { sample: 'piano', program: 0 } }).doc
  doc = addNote(doc, 'keys', { pitch: 60, start: 0, duration: 4, velocity: 0.8 }).doc
  assert.equal(doc.tracks.find((t) => t.id === 'keys')!.notes.length, 1)
})

test('instrument tracks are excluded from beatlab partials (media still rides)', () => {
  const doc = parse(INSTRUMENT_EXAMPLE)
  const partial = beatDocumentToPartialTracks(doc)
  assert.equal(partial.tracks.length, 0, 'beatlab has no instrument kind yet')
  assert.equal(partial.media.length, 1)
  // browser leg: they ride the additive instruments field instead (played by the daw bridge)
  assert.equal(partial.instruments.length, 1)
  assert.deepEqual(
    { ...partial.instruments[0], notes: partial.instruments[0]!.notes.length },
    { id: 'keys', name: 'Keys', sample: 'piano', program: 0, volume: -6, pan: 0.1, notes: 2 },
  )
})
