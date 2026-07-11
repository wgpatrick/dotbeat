// v0.8+ instrument clips/timeline (docs/phase-8-plan.md's "Remaining": "clips/timeline
// participation" for instrument tracks). Instrument tracks already have top-level notes (v0.6);
// this extends the note-based clip grammar synth tracks already have (docs/phase-6-plan.md) to
// instrument tracks, and their participation in scenes/song. Under test: grammar (clip blocks on
// instrument tracks, notes-only content), round-trip, the generic edit primitives (saveClip/
// setScene/setSong — these already worked for any track kind; this proves it end-to-end for
// instrument), and the beatlab-partial's additive PartialInstrument.clips field.
//
// (Scene/song note-resolution for rendering now lives in dotbeat's own engine, ui/src/audio/
// engine.ts, exercised end-to-end by ui/verify-engine-parity.mjs — the retired offline renderer's
// `instrumentNoteEvents` pure-function tests were removed with that path in Phase 17 / D15.)

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parse,
  serialize,
  addTrack,
  setMediaSample,
  initDocument,
  saveClip,
  setScene,
  setSong,
  diffDocuments,
  formatDiff,
  beatDocumentToPartialTracks,
  BeatParseError,
} from '../src/core/index.js'

const SHA = 'd'.repeat(64)

const INSTRUMENT_SONG = `format_version 0.8
bpm 100
loop_bars 2
selected_track keys

media
  sample piano sha256:${SHA} media/piano.sf2

track keys Keys #98c379 instrument
  soundfont piano 0
  clip verse
    note c1 60 0 4 0.8
  clip chorus
    note c2 67 0 4 0.9
    note c3 72 4 4 0.7
  note u1 64 0 8 0.7

scene verse-scene
  slot keys verse

scene chorus-scene
  slot keys chorus

song
  section verse-scene 4
  section chorus-scene 4
`

test('clip blocks parse on instrument tracks (notes-only) and round-trip byte-identically', () => {
  const doc = parse(INSTRUMENT_SONG)
  assert.equal(serialize(doc), INSTRUMENT_SONG)
  const keys = doc.tracks[0]!
  assert.equal(keys.kind, 'instrument')
  assert.deepEqual(keys.clips.map((c) => c.id), ['verse', 'chorus'])
  assert.equal(keys.clips[0]!.notes.length, 1)
  assert.equal(keys.clips[1]!.notes.length, 2)
  // instrument clips carry no hits — the notes-only rule (same contract as synth clips)
  assert.deepEqual(keys.clips[0]!.hits, [])
  assert.equal(keys.notes.length, 1, 'live loop content stays separate from clips')
  assert.deepEqual(doc.scenes.map((s) => s.id), ['verse-scene', 'chorus-scene'])
  assert.deepEqual(doc.song, [
    { scene: 'verse-scene', bars: 4 },
    { scene: 'chorus-scene', bars: 4 },
  ])
})

test('hit lines are still rejected inside an instrument-track clip (notes only, like the live track)', () => {
  const bad = INSTRUMENT_SONG.replace('    note c1 60 0 4 0.8', '    hit h1 kick 0 0.8')
  assert.throws(() => parse(bad), /hit lines only belong in drum-track clips/)
})

test('a document without instrument clips/scenes/song is unchanged (empty structure)', () => {
  const plain = `format_version 0.6
bpm 100
loop_bars 2
selected_track keys

media
  sample piano sha256:${SHA} media/piano.sf2

track keys Keys #98c379 instrument
  soundfont piano 0
  note u1 60 0 8 0.7
`
  const doc = parse(plain)
  assert.deepEqual(doc.tracks[0]!.clips, [])
  assert.equal(serialize(doc), plain)
})

function docWithPianoTrack() {
  let doc = initDocument({ trackId: 'lead' })
  doc = setMediaSample(doc, 'piano', SHA, 'media/piano.sf2')
  const { doc: withKeys } = addTrack(doc, { id: 'keys', kind: 'instrument', soundfont: { sample: 'piano', program: 0 } })
  return withKeys
}

test('saveClip/setScene/setSong (the generic edit primitives beat_song uses) work on instrument tracks', () => {
  let doc = docWithPianoTrack()
  const withNote = { ...doc, tracks: doc.tracks.map((t) => (t.id === 'keys' ? { ...t, notes: [{ id: 'u1', pitch: 60, start: 0, duration: 4, velocity: 0.8 }] } : t)) }
  doc = withNote

  const saved = saveClip(doc, 'keys', 'take-1')
  assert.equal(saved.created, true)
  doc = saved.doc
  const keys = doc.tracks.find((t) => t.id === 'keys')!
  assert.deepEqual(keys.clips.map((c) => c.id), ['take-1'])
  assert.deepEqual(keys.clips[0]!.notes, keys.notes)

  const before = doc
  doc = setScene(doc, 'a', { keys: 'take-1' })
  doc = setSong(doc, [{ scene: 'a', bars: 4 }])
  assert.equal(serialize(parse(serialize(doc))), serialize(doc), 'canonical round trip')

  const text = formatDiff(diffDocuments(before, doc))
  assert.match(text, /scene added "a"/)
  assert.match(text, /song: \(no song\) -> a\(4\)/)
})

test('beatDocumentToPartialTracks carries instrument clips on the additive PartialInstrument.clips field', () => {
  const doc = parse(INSTRUMENT_SONG)
  const partial = beatDocumentToPartialTracks(doc)
  assert.equal(partial.tracks.length, 0, 'beatlab still has no instrument kind (browser leg, out of scope)')
  assert.equal(partial.instruments.length, 1)
  const inst = partial.instruments[0]!
  assert.equal(inst.id, 'keys')
  assert.ok(inst.clips, 'clips field present when the track has clips')
  assert.deepEqual(
    inst.clips!.map((c) => ({ id: c.id, name: c.name, notes: c.notes.length })),
    [
      { id: 'verse', name: 'verse', notes: 1 },
      { id: 'chorus', name: 'chorus', notes: 2 },
    ],
  )
  // scenes/song convert exactly as they do for synth/drum tracks (generic, no kind gating)
  assert.deepEqual(partial.scenes.map((s) => s.id), ['verse-scene', 'chorus-scene'])
  assert.deepEqual(partial.song, [
    { sceneId: 'verse-scene', bars: 4 },
    { sceneId: 'chorus-scene', bars: 4 },
  ])
})

test('beatDocumentToPartialTracks omits the clips field when an instrument track has none (additive, not always-present)', () => {
  const doc = docWithPianoTrack()
  const partial = beatDocumentToPartialTracks(doc)
  assert.equal(partial.instruments[0]!.clips, undefined)
})

test('a clip referencing a scene slot on an instrument track fails loudly on unknown refs (same as synth/drums)', () => {
  assert.throws(() => parse(INSTRUMENT_SONG.replace('slot keys verse', 'slot keys ghost')), BeatParseError)
})
