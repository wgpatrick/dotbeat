// Phase 39 Stream UA — orphaned-content detector (src/core/coverage.ts). Known-answer fixtures for
// the silent-render trap: in SONG mode a track holding real content but placed in no scene the song
// plays renders silent, and this is what warns about it. Built with the ordinary edit primitives so
// the fixtures read as real projects. Loop mode plays live content directly, so it must never warn.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  initDocument,
  addTrack,
  addNote,
  addHit,
  saveClip,
  setScene,
  setSong,
  placeClip,
  setMediaSample,
  addAudioClip,
  unplacedContentTracks,
  describeDocument,
} from '../src/core/index.js'

const SHA = 'a'.repeat(64)

// A song-mode doc: 'lead' has a melody clip placed into scene 'a' (the song plays it); 'drums' has
// 8 live hits + a saved clip but is placed in NO scene → the silent-render trap.
function songWithOrphanedDrums() {
  let doc = initDocument({ loopBars: 1 }) // starter 'lead' synth track, empty
  doc = addNote(doc, 'lead', { pitch: 60, start: 0, duration: 1, velocity: 0.8 }).doc
  doc = saveClip(doc, 'lead', 'melody').doc
  doc = addTrack(doc, { id: 'drums', kind: 'drums' }).doc
  for (const start of [0, 2, 4, 6, 8, 10, 12, 14]) doc = addHit(doc, 'drums', { lane: 'kick', start, velocity: 1 }).doc
  doc = saveClip(doc, 'drums', 'beat').doc
  doc = setScene(doc, 'a', { lead: 'melody' }) // drums deliberately absent
  doc = setSong(doc, [{ scene: 'a', bars: 1 }])
  return doc
}

test('content-but-unplaced warns; the placed track does not', () => {
  const doc = songWithOrphanedDrums()
  const un = unplacedContentTracks(doc)
  assert.equal(un.length, 1)
  const drums = un[0]!
  assert.equal(drums.trackId, 'drums')
  assert.equal(drums.kind, 'drums')
  assert.equal(drums.hitCount, 8)
  assert.equal(drums.clipCount, 1) // the saved 'beat' clip also carries the hits
  assert.ok(!un.some((t) => t.trackId === 'lead')) // lead is placed → not flagged
})

test('the inspect view shows the silent-track ⚠ line for a silent track', () => {
  const out = describeDocument(songWithOrphanedDrums())
  assert.match(out, /⚠ track 'drums' has 8 hits but is placed in no scene — song mode won't play it/)
  // and its remediation hint, so the reader knows the way out
  assert.match(out, /beat clip.*beat scene.*beat place/)
})

test('a placed track (content in a placed clip) never warns', () => {
  let doc = initDocument({ loopBars: 1 })
  doc = addTrack(doc, { id: 'drums', kind: 'drums' }).doc
  for (const start of [0, 4, 8, 12]) doc = addHit(doc, 'drums', { lane: 'kick', start, velocity: 1 }).doc
  doc = saveClip(doc, 'drums', 'beat').doc
  doc = setScene(doc, 'a', { drums: 'beat' })
  doc = setSong(doc, [{ scene: 'a', bars: 1 }])
  assert.deepEqual(unplacedContentTracks(doc), [])
})

test('clip-only content (audio track) warns when unplaced and clears when placed', () => {
  // Audio tracks hold content only in clips (no live notes/hits) — the clean clipCount-only case.
  let doc = initDocument({ loopBars: 1 })
  doc = addNote(doc, 'lead', { pitch: 60, start: 0, duration: 1, velocity: 0.8 }).doc
  doc = saveClip(doc, 'lead', 'melody').doc
  doc = setMediaSample(doc, 'smp', SHA, 'media/smp.wav')
  doc = addTrack(doc, { id: 'aud', kind: 'audio' }).doc
  doc = addAudioClip(doc, 'aud', 'region', { media: 'smp', in: 0, out: 1 }).doc
  doc = setScene(doc, 'a', { lead: 'melody' }) // aud not placed
  doc = setSong(doc, [{ scene: 'a', bars: 1 }])

  const un = unplacedContentTracks(doc)
  assert.equal(un.length, 1)
  assert.equal(un[0]!.trackId, 'aud')
  assert.equal(un[0]!.kind, 'audio')
  assert.equal(un[0]!.noteCount, 0)
  assert.equal(un[0]!.hitCount, 0)
  assert.equal(un[0]!.clipCount, 1)
  // the inspect line for a clip-only track reads "content in 1 clip"
  assert.match(describeDocument(doc), /⚠ track 'aud' has content in 1 clip but is placed in no scene/)

  // placing it into the song-visited scene clears the warning
  doc = placeClip(doc, 'a', 'aud', 'region', 0).doc
  assert.deepEqual(unplacedContentTracks(doc), [])
})

test('loop mode (song: null) never warns even with unplaced content', () => {
  let doc = initDocument({ loopBars: 1 }) // no song block → loop mode
  doc = addTrack(doc, { id: 'drums', kind: 'drums' }).doc
  for (const start of [0, 4, 8, 12]) doc = addHit(doc, 'drums', { lane: 'kick', start, velocity: 1 }).doc
  doc = saveClip(doc, 'drums', 'beat').doc
  assert.equal(doc.song, null)
  assert.deepEqual(unplacedContentTracks(doc), [])
  assert.doesNotMatch(describeDocument(doc), /song mode won't play it/)
})

test('an empty (contentless) track never warns in song mode', () => {
  let doc = initDocument({ loopBars: 1 })
  doc = addNote(doc, 'lead', { pitch: 60, start: 0, duration: 1, velocity: 0.8 }).doc
  doc = saveClip(doc, 'lead', 'melody').doc
  doc = addTrack(doc, { id: 'bass', kind: 'synth' }).doc // empty, unplaced
  doc = setScene(doc, 'a', { lead: 'melody' })
  doc = setSong(doc, [{ scene: 'a', bars: 1 }])
  assert.deepEqual(unplacedContentTracks(doc), []) // bass has no content; lead is placed
})

test('a track placed only in a scene the song never visits still warns', () => {
  // "referenced" counts only scenes the song actually plays — a placement in an unused scene does
  // not save the track from silence.
  let doc = initDocument({ loopBars: 1 })
  doc = addNote(doc, 'lead', { pitch: 60, start: 0, duration: 1, velocity: 0.8 }).doc
  doc = saveClip(doc, 'lead', 'melody').doc
  doc = addTrack(doc, { id: 'drums', kind: 'drums' }).doc
  for (const start of [0, 4, 8, 12]) doc = addHit(doc, 'drums', { lane: 'kick', start, velocity: 1 }).doc
  doc = saveClip(doc, 'drums', 'beat').doc
  doc = setScene(doc, 'a', { lead: 'melody' })
  doc = setScene(doc, 'b', { drums: 'beat' }) // drums placed here...
  doc = setSong(doc, [{ scene: 'a', bars: 1 }]) // ...but the song only plays scene 'a'
  const un = unplacedContentTracks(doc)
  assert.equal(un.length, 1)
  assert.equal(un[0]!.trackId, 'drums')
})
