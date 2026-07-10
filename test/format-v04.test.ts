// v0.4 grammar tests — clips, scenes, song (docs/phase-6-plan.md §6.2). The contract under
// test: all three blocks are optional (a document without them is unchanged v0.3), references
// are validated (fail loudly), and every state has exactly one canonical serialized form.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parse,
  serialize,
  diffDocuments,
  formatDiff,
  saveClip,
  setScene,
  setSong,
  removeTrack,
  BeatParseError,
  BeatEditError,
} from '../src/core/index.js'

const CORE_SYNTH = `  synth
    osc sine
    volume 0
    cutoff 1000
    resonance 1
    attack 0.01
    decay 0.1
    sustain 0.5
    release 0.1
    pan 0`

const DRUM_LANES_BLOCK = (indent: string, kick = '0.9 0 0 0') => `${indent}pattern kick ${kick}
${indent}pattern snare 0 0 0 0
${indent}pattern clap 0 0 0 0
${indent}pattern hat 0 0 0 0
${indent}pattern openhat 0 0 0 0`

const SONG_EXAMPLE = `format_version 0.4
bpm 124
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip quiet
    note a1 69 0 2 0.4
  clip busy
    note b1 69 0 2 0.9
    note b2 72 4 2 0.9
  note u1 60 0 4 0.5

track drums Drums #e35d5d drums
${CORE_SYNTH}
  clip four
${DRUM_LANES_BLOCK('    ')}
${DRUM_LANES_BLOCK('  ', '0 0 0 0')}

scene intro
  slot lead quiet

scene main
  slot lead busy
  slot drums four

song
  section intro 2
  section main 4
  section intro 2
`

test('the full v0.4 song example round-trips byte-identically', () => {
  const doc = parse(SONG_EXAMPLE)
  assert.equal(serialize(doc), SONG_EXAMPLE)
})

test('clips, scenes, and song parse into the expected shapes', () => {
  const doc = parse(SONG_EXAMPLE)
  const lead = doc.tracks[0]!
  assert.deepEqual(lead.clips.map((c) => c.id), ['quiet', 'busy'])
  assert.equal(lead.clips[1]!.notes.length, 2)
  assert.equal(lead.notes.length, 1, 'live loop content stays separate from clips')
  const drums = doc.tracks[1]!
  assert.equal(drums.clips[0]!.pattern!.kick[0], 0.9)
  assert.equal(drums.pattern!.kick[0], 0, 'live pattern separate from clip pattern')
  assert.deepEqual(doc.scenes.map((s) => s.id), ['intro', 'main'])
  assert.deepEqual(doc.scenes[1]!.slots, { lead: 'busy', drums: 'four' })
  assert.deepEqual(doc.song, [
    { scene: 'intro', bars: 2 },
    { scene: 'main', bars: 4 },
    { scene: 'intro', bars: 2 },
  ])
})

test('a document without clips/scenes/song is unchanged v0.3 behavior (empty structure)', () => {
  const plain = `format_version 0.3
bpm 120
loop_bars 1
selected_track a

track a A #ffffff synth
${CORE_SYNTH}
`
  const doc = parse(plain)
  assert.deepEqual(doc.tracks[0]!.clips, [])
  assert.deepEqual(doc.scenes, [])
  assert.equal(doc.song, null)
  assert.equal(serialize(doc), plain)
})

test('reference validation fails loudly', () => {
  // slot -> unknown clip
  assert.throws(
    () => parse(SONG_EXAMPLE.replace('slot lead quiet', 'slot lead ghost')),
    /unknown clip "ghost" on track "lead"/,
  )
  // slot -> unknown track
  assert.throws(
    () => parse(SONG_EXAMPLE.replace('slot lead quiet', 'slot ghost quiet')),
    /unknown track "ghost"/,
  )
  // section -> unknown scene
  assert.throws(
    () => parse(SONG_EXAMPLE.replace('section main 4', 'section ghost 4')),
    /unknown scene "ghost"/,
  )
  // bars out of range
  assert.throws(() => parse(SONG_EXAMPLE.replace('section main 4', 'section main 65')), /bars must be 1-64/)
  // empty song block
  assert.throws(() => parse(SONG_EXAMPLE.replace(/song\n(  section .*\n)+/m, 'song\n')), /at least one section/)
})

test('duplicate clip ids per track, duplicate scenes, duplicate slots are rejected', () => {
  assert.throws(() => parse(SONG_EXAMPLE.replace('clip busy', 'clip quiet')), /duplicate clip id "quiet"/)
  assert.throws(() => parse(SONG_EXAMPLE.replace('scene main', 'scene intro')), /duplicate scene id "intro"/)
  assert.throws(
    () => parse(SONG_EXAMPLE.replace('slot lead busy', 'slot lead busy\n  slot lead quiet')),
    /already has a slot for track "lead"/,
  )
})

test('a drum clip missing a lane is rejected (same completeness rule as track patterns)', () => {
  const bad = SONG_EXAMPLE.replace('    pattern openhat 0 0 0 0\n  pattern kick', '  pattern kick')
  assert.throws(() => parse(bad), /clip "four" in drum track "drums" is missing pattern lane\(s\): openhat/)
})

test('canonical order is enforced: tracks before scenes before song', () => {
  // a track after a scene
  const trackAfterScene = `format_version 0.4
bpm 120
loop_bars 1
selected_track a

track a A #ffffff synth
${CORE_SYNTH}

scene s1

track b B #ffffff synth
${CORE_SYNTH}
`
  assert.throws(() => parse(trackAfterScene), /track blocks must come before scene\/song blocks/)
  // a scene after the song
  const sceneAfterSong = SONG_EXAMPLE + '\nscene late\n'
  assert.throws(() => parse(sceneAfterSong), /scene blocks must come before the song block/)
})

test('saveClip snapshots live content; setScene and setSong validate and round-trip', () => {
  let doc = parse(SONG_EXAMPLE)
  // snapshot lead's live note into a new clip
  const saved = saveClip(doc, 'lead', 'live-take')
  assert.equal(saved.created, true)
  doc = saved.doc
  const lead = doc.tracks[0]!
  assert.deepEqual(lead.clips.map((c) => c.id), ['quiet', 'busy', 'live-take'])
  assert.deepEqual(lead.clips[2]!.notes, lead.notes)
  // wire it into a new scene and extend the song
  doc = setScene(doc, 'outro', { lead: 'live-take' })
  doc = setSong(doc, [...doc.song!, { scene: 'outro', bars: 2 }])
  assert.equal(serialize(parse(serialize(doc))), serialize(doc), 'canonical round trip')
  // validation
  assert.throws(() => setScene(doc, 'bad', { lead: 'ghost' }), BeatEditError)
  assert.throws(() => setSong(doc, [{ scene: 'ghost', bars: 2 }]), BeatEditError)
  assert.throws(() => setSong(doc, [{ scene: 'outro', bars: 0 }]), BeatEditError)
  // clearing the song
  assert.equal(setSong(doc, []).song, null)
})

test('removeTrack drops the removed track from scene slots (no dangling refs)', () => {
  const doc = parse(SONG_EXAMPLE)
  const { doc: without } = removeTrack(doc, 'drums')
  assert.deepEqual(without.scenes.find((s) => s.id === 'main')!.slots, { lead: 'busy' })
  // and the result re-parses (the canonical form is self-consistent)
  assert.equal(serialize(parse(serialize(without))), serialize(without))
})

test('semantic diff reports clip/scene/song changes musically', () => {
  const a = parse(SONG_EXAMPLE)
  let b = saveClip(a, 'lead', 'extra').doc
  b = setScene(b, 'main', { lead: 'quiet', drums: 'four' })
  b = setSong(b, [{ scene: 'main', bars: 8 }])
  const text = formatDiff(diffDocuments(a, b))
  assert.match(text, /lead: clip added "extra"/)
  assert.match(text, /scene main: lead busy -> quiet/)
  assert.match(text, /song: intro\(2\) main\(4\) intro\(2\) -> main\(8\)/)
})

test('a slot re-map is a one-line text diff', () => {
  const a = parse(SONG_EXAMPLE)
  const b = setScene(a, 'main', { lead: 'quiet', drums: 'four' })
  const aLines = serialize(a).split('\n')
  const bLines = serialize(b).split('\n')
  assert.equal(aLines.length, bLines.length)
  const changed = bLines.filter((l, i) => l !== aLines[i])
  assert.deepEqual(changed, ['  slot lead quiet'])
})
