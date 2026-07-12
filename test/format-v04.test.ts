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
  songMove,
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

// v0.8: drum content is free-timed hits (was pattern lines through v0.7).
const SONG_EXAMPLE = `format_version 0.8
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
    hit kick0 kick 0 0.9

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
  assert.deepEqual(drums.clips[0]!.hits, [{ id: 'kick0', lane: 'kick', start: 0, velocity: 0.9 }])
  assert.equal(drums.hits.length, 0, 'live hits separate from clip hits')
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

test('a legacy (v<=0.7) drum clip pattern missing a lane is rejected on migration', () => {
  // v0.8 clips use hits, but a legacy pattern-based clip must still be complete to migrate cleanly
  const legacyClip = `format_version 0.4
bpm 124
loop_bars 1
selected_track drums

track drums Drums #e35d5d drums
${CORE_SYNTH}
  clip four
    pattern kick 0.9 0 0 0
    pattern snare 0 0 0 0
    pattern clap 0 0 0 0
    pattern hat 0 0 0 0
`
  assert.throws(() => parse(legacyClip), /clip "four" in drum track "drums" is missing pattern lane\(s\): openhat/)
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
  assert.throws(() => parse(trackAfterScene), /track blocks must come before group\/scene\/song blocks/)
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

// Phase 24 Stream CB: songMove reorders a section in the arrangement timeline. Sections carry no
// stable id (BeatSongSection is just {scene, bars}, and duplicate scene/bars pairs are legal — the
// SONG_EXAMPLE fixture itself has two "intro 2" sections), so identity is purely positional (the
// index passed in), same as effect/lane chains identify entries by id but reorder by index.
test('songMove reorders a section by index, clamped to list bounds', () => {
  const doc = parse(SONG_EXAMPLE) // sections: intro(2) main(4) intro(2)
  // move the last section (index 2) to the front
  const { doc: moved, section, before, after } = songMove(doc, 2, 0)
  assert.deepEqual(moved.song, [
    { scene: 'intro', bars: 2 },
    { scene: 'intro', bars: 2 },
    { scene: 'main', bars: 4 },
  ])
  assert.deepEqual(section, { scene: 'intro', bars: 2 })
  assert.equal(before, 2)
  assert.equal(after, 0)
  // moving to an out-of-range index clamps rather than throwing
  const { doc: clamped, after: clampedAfter } = songMove(doc, 0, 999)
  assert.equal(clampedAfter, 2)
  assert.deepEqual(clamped.song, [
    { scene: 'main', bars: 4 },
    { scene: 'intro', bars: 2 },
    { scene: 'intro', bars: 2 },
  ])
  // a no-op move (same index) is a harmless identity
  assert.deepEqual(songMove(doc, 1, 1).doc.song, doc.song)
})

test('songMove refuses out-of-range fromIndex and refuses outside song mode', () => {
  const doc = parse(SONG_EXAMPLE)
  assert.throws(() => songMove(doc, -1, 0), BeatEditError)
  assert.throws(() => songMove(doc, 3, 0), BeatEditError)
  assert.throws(() => songMove(doc, 1.5, 0), BeatEditError)
  const plain = `format_version 0.3
bpm 120
loop_bars 1
selected_track a

track a A #ffffff synth
${CORE_SYNTH}
`
  assert.throws(() => songMove(parse(plain), 0, 0), /not in song mode/)
})

test('songMove round-trips cleanly and diffs as a genuine reorder, not a delete+insert pair', () => {
  const a = parse(SONG_EXAMPLE)
  const { doc: b } = songMove(a, 0, 2) // move the first "intro" section to the end
  // canonical round trip: serialize -> parse -> serialize is stable
  assert.equal(serialize(parse(serialize(b))), serialize(b))
  assert.deepEqual(b.song, [
    { scene: 'main', bars: 4 },
    { scene: 'intro', bars: 2 },
    { scene: 'intro', bars: 2 },
  ])
  // the semantic diff is exactly one entry: the song statement moved as a whole (order IS the
  // data for a flat, unindexed section list — see diff.ts's songKey comment). Not a pair of
  // clip-removed/clip-added or scene-removed/scene-added entries, which would misreport a pure
  // reorder as content being deleted and re-created.
  const entries = diffDocuments(a, b)
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.kind, 'song-changed')
  const text = formatDiff(entries)
  assert.match(text, /^song: intro\(2\) main\(4\) intro\(2\) -> main\(4\) intro\(2\) intro\(2\)$/m)
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
