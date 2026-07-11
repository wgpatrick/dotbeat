// v0.8+ instrument clips/timeline (docs/phase-8-plan.md's "Remaining": "clips/timeline
// participation" for instrument tracks). Instrument tracks already have top-level notes (v0.6);
// this extends the note-based clip grammar synth tracks already have (docs/phase-6-plan.md) to
// instrument tracks, and their participation in scenes/song. Under test: grammar (clip blocks on
// instrument tracks, notes-only content), round-trip, the generic edit primitives (saveClip/
// setScene/setSong — these already worked for any track kind; this proves it end-to-end for
// instrument), the beatlab-partial's additive PartialInstrument.clips field, and the offline
// renderer's scene/song note resolution (cli/render-offline.mjs's `instrumentNoteEvents`, tested
// as a pure function — no spessasynth/Tone/beatlab bundle needed).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
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

// --- cli/render-offline.mjs's instrumentNoteEvents: pure scene/song resolution logic, tested
// directly against the same .beat document shape parse() produces, no audio engine involved.
// render-offline.mjs's top-level module code unconditionally imports node-web-audio-api (to
// patch its context classes) even though instrumentNoteEvents itself doesn't touch audio at all
// — so loading it can fail in an environment without that native binding built (same caveat as
// test/master-bus.test.ts). Feature-detect and skip rather than fail red. ---

type InstrumentNoteEventsFn = (track: unknown, doc: unknown, opts: { stepSeconds: number; rate: number; totalSamples: number; renderSteps: number }) => { at: number; on: boolean; pitch: number }[]

async function loadInstrumentNoteEvents(): Promise<InstrumentNoteEventsFn | null> {
  try {
    const mod = await import(pathToFileURL(join(repoRoot, 'cli', 'render-offline.mjs')).href)
    return (mod as { instrumentNoteEvents: InstrumentNoteEventsFn }).instrumentNoteEvents
  } catch {
    return null
  }
}

test('instrumentNoteEvents: loop mode tiles live top-level notes across the whole render', async (t) => {
  const instrumentNoteEvents = await loadInstrumentNoteEvents()
  if (!instrumentNoteEvents) {
    t.skip('node-web-audio-api not available in this environment — skipping')
    return
  }
  const doc = docWithPianoTrack() // loopBars: 2 (default), no song block
  const withNote = { ...doc, tracks: doc.tracks.map((t) => (t.id === 'keys' ? { ...t, notes: [{ id: 'n1', pitch: 60, start: 0, duration: 2, velocity: 0.8 }] } : t)) }
  const track = withNote.tracks.find((t) => t.id === 'keys')!
  const rate = 44100
  const stepSeconds = 60 / withNote.bpm / 4
  const loopSteps = withNote.loopBars * 16 // 32 steps
  const renderSteps = loopSteps * 3 // three loop passes
  const totalSamples = Math.ceil(renderSteps * stepSeconds * rate)
  const events = instrumentNoteEvents(track, withNote, { stepSeconds, rate, totalSamples, renderSteps })
  const onEvents = events.filter((e) => e.on)
  assert.equal(onEvents.length, 3, 'one note-on per loop pass across 3 passes')
  // note-on positions land at 0, loopSteps, 2*loopSteps (in samples)
  const expectedStarts = [0, loopSteps, 2 * loopSteps].map((steps) => Math.floor(steps * stepSeconds * rate))
  assert.deepEqual(onEvents.map((e) => e.at).sort((a, b) => a - b), expectedStarts)
})

test('instrumentNoteEvents: song mode resolves scene -> slot -> clip per section, tiling within the section', async (t) => {
  const instrumentNoteEvents = await loadInstrumentNoteEvents()
  if (!instrumentNoteEvents) {
    t.skip('node-web-audio-api not available in this environment — skipping')
    return
  }
  const doc = parse(INSTRUMENT_SONG)
  const track = doc.tracks.find((t) => t.id === 'keys')!
  const rate = 44100
  const stepSeconds = 60 / doc.bpm / 4
  const totalBars = doc.song!.reduce((sum, s) => sum + s.bars, 0) // 8 bars
  const renderSteps = totalBars * 16
  const totalSamples = Math.ceil(renderSteps * stepSeconds * rate)
  const events = instrumentNoteEvents(track, doc, { stepSeconds, rate, totalSamples, renderSteps })
  const onEvents = events.filter((e) => e.on).sort((a, b) => a.at - b.at)
  // section 1 (verse-scene, 4 bars = 64 steps, loopBars=2 -> 32-step clip cycle): clip "verse"
  // has one note at step 0 -> two loop passes within the section -> 2 onsets (steps 0 and 32).
  // section 2 (chorus-scene, 4 bars, same 32-step cycle): clip "chorus" has notes at steps 0 and
  // 4 -> two loop passes -> 4 onsets (steps 64, 68, 96, 100 — section 2 starts at step 64).
  const toStep = (at: number) => Math.round(at / stepSeconds / rate)
  const steps = onEvents.map((e) => toStep(e.at))
  assert.deepEqual(steps, [0, 32, 64, 68, 96, 100])
})

test('instrumentNoteEvents: an instrument track unmapped in a section\'s scene is silent for that section', async (t) => {
  const instrumentNoteEvents = await loadInstrumentNoteEvents()
  if (!instrumentNoteEvents) {
    t.skip('node-web-audio-api not available in this environment — skipping')
    return
  }
  let doc = parse(INSTRUMENT_SONG)
  // drop the slot for "keys" in chorus-scene -> keys plays nothing during that section
  doc = { ...doc, scenes: doc.scenes.map((s) => (s.id === 'chorus-scene' ? { ...s, slots: {} } : s)) }
  const track = doc.tracks.find((t) => t.id === 'keys')!
  const rate = 44100
  const stepSeconds = 60 / doc.bpm / 4
  const totalBars = doc.song!.reduce((sum, s) => sum + s.bars, 0)
  const renderSteps = totalBars * 16
  const totalSamples = Math.ceil(renderSteps * stepSeconds * rate)
  const events = instrumentNoteEvents(track, doc, { stepSeconds, rate, totalSamples, renderSteps })
  const onEvents = events.filter((e) => e.on)
  // only the verse section's 2 onsets remain; chorus section contributes none
  assert.equal(onEvents.length, 2)
  const toStep = (at: number) => Math.round(at / stepSeconds / rate)
  for (const e of onEvents) assert.ok(toStep(e.at) < 64, 'no onsets land in the silent (unmapped) chorus section')
})

test('a clip referencing a scene slot on an instrument track fails loudly on unknown refs (same as synth/drums)', () => {
  assert.throws(() => parse(INSTRUMENT_SONG.replace('slot keys verse', 'slot keys ghost')), BeatParseError)
})
