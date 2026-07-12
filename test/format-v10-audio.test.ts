// v0.10 grammar tests — Phase 22 Stream AE, audio-region clip format foundation
// (docs/phase-22-stream-ae.md, docs/research/16-audio-clip-editing.md §8 items 1-4). The
// contract under test: a new 'audio' track kind whose clips carry exactly one BeatAudioRegion
// (media ref + in/out + gain + warp + rate, all six fields always serialized — the note/hit
// discipline, not the SYNTH_FIELDS elision discipline), repitch-mode `rate` normalized to 1
// whenever warp isn't 'repitch' (one canonical form per state), split-at-point as a pure edit
// primitive, and clip gain automation reusing the v0.9 BeatAutomationLane machinery unchanged.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parse,
  serialize,
  diffDocuments,
  formatDiff,
  addTrack,
  setValue,
  setMediaSample,
  addAudioClip,
  setClipAudioRegion,
  splitAudioClip,
  addAutomationPoint,
  setAutomationPoint,
  removeAutomationPoint,
  describeDocument,
  initDocument,
  BeatParseError,
  BeatEditError,
} from '../src/core/index.js'

const HASH_A = 'a'.repeat(64)

function docWithMedia() {
  const base = initDocument({ trackId: 'lead', bpm: 120, loopBars: 4 })
  const withMedia = setMediaSample(base, 'smp_drumloop', HASH_A, 'media/drumloop.wav')
  const { doc } = addTrack(withMedia, { id: 'atrk', kind: 'audio' })
  return doc
}

const AUDIO_EXAMPLE = `format_version 0.10
bpm 120
loop_bars 4
selected_track lead

media
  sample smp_drumloop sha256:${HASH_A} media/drumloop.wav

track lead Lead #c678dd synth
  synth
    osc sawtooth
    volume 0
    cutoff 0
    resonance 0
    attack 0
    decay 0
    sustain 0
    release 0
    pan 0

track atrk atrk #56b6c2 audio
  clip solo-take
    audio smp_drumloop 0 8 -3 repitch 1.5
    auto atrk.gain
      point p1 0 -3
      point p2 4 0
`

// ---- grammar / round-trip -----------------------------------------------------------------------

test('the audio-region example round-trips byte-identically', () => {
  const doc = parse(AUDIO_EXAMPLE)
  assert.equal(serialize(doc), AUDIO_EXAMPLE)
})

test('an audio-region clip parses into the expected shape', () => {
  const doc = parse(AUDIO_EXAMPLE)
  const track = doc.tracks.find((t) => t.id === 'atrk')!
  assert.equal(track.kind, 'audio')
  const clip = track.clips[0]!
  assert.equal(clip.id, 'solo-take')
  assert.deepEqual(clip.audio, { media: 'smp_drumloop', in: 0, out: 8, gainDb: -3, warp: 'repitch', rate: 1.5, markers: [] })
  assert.equal(clip.automation.length, 1)
  assert.equal(clip.automation[0]!.param, 'gain')
})

test('an audio-region clip with default fields (off, 0 dB, rate 1) round-trips', () => {
  const { doc } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 4 })
  const text = serialize(doc)
  assert.match(text, /audio smp_drumloop 0 4 0 off 1\n/)
  assert.equal(serialize(parse(text)), text)
})

test('all six audio fields are always serialized (no elision, note/hit discipline)', () => {
  const { doc } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 4 })
  const line = serialize(doc).split('\n').find((l) => l.trim().startsWith('audio '))!
  assert.equal(line.trim().split(/\s+/).length, 7) // "audio" + 6 fields
})

test('an audio track with no clips serializes with no clip content', () => {
  const doc = docWithMedia()
  const text = serialize(doc)
  assert.match(text, /track atrk atrk #56b6c2 audio\n/)
  assert.ok(!text.includes('audio smp_drumloop'))
})

// ---- grammar validation: fail loudly -------------------------------------------------------------

test('audio lines only belong on audio-track clips', () => {
  // swap only the track kind, leaving the `audio` line under what's now a synth-track clip
  const bad = AUDIO_EXAMPLE.replace('track atrk atrk #56b6c2 audio', 'track atrk atrk #56b6c2 synth')
  assert.throws(() => parse(bad), /audio lines only belong in audio-track clips/)
})

test('an audio-track clip with no audio line is rejected', () => {
  const text = `format_version 0.10
bpm 120
loop_bars 1
selected_track atrk

media
  sample smp_drumloop sha256:${HASH_A} media/drumloop.wav

track atrk atrk #56b6c2 audio
  clip empty-take
`
  assert.throws(() => parse(text), /clip "empty-take" on audio track "atrk" has no audio line/)
})

test('out-point must be greater than in-point', () => {
  const bad = AUDIO_EXAMPLE.replace('audio smp_drumloop 0 8 -3 repitch 1.5', 'audio smp_drumloop 8 8 -3 repitch 1.5')
  assert.throws(() => parse(bad), /out-point must be > in-point/)
})

test('warp must be a recognized enum value', () => {
  const bad = AUDIO_EXAMPLE.replace('repitch 1.5', 'turntable 1.5')
  assert.throws(() => parse(bad), /audio warp must be one of off\|repitch\|complex/)
})

test('rate must be exactly 1 when warp is not repitch (one canonical form per state)', () => {
  const bad = AUDIO_EXAMPLE.replace('-3 repitch 1.5', '-3 off 1.5')
  assert.throws(() => parse(bad), /audio rate must be 1 when warp is "off"/)
})

test('rate must stay within the documented bounds', () => {
  const bad = AUDIO_EXAMPLE.replace('repitch 1.5', 'repitch 50')
  assert.throws(() => parse(bad), /audio rate must be 0\.1-8/)
})

test('an audio line must reference a declared media sample', () => {
  const bad = AUDIO_EXAMPLE.replace('audio smp_drumloop 0 8', 'audio smp_ghost 0 8')
  assert.throws(() => parse(bad), /audio references unknown sample "smp_ghost"/)
})

test('note/hit lines are rejected on audio tracks', () => {
  const withNote = AUDIO_EXAMPLE.replace('    audio smp_drumloop 0 8 -3 repitch 1.5\n', '    audio smp_drumloop 0 8 -3 repitch 1.5\n    note n1 60 0 4 0.8\n')
  assert.throws(() => parse(withNote), /note lines only belong in synth\/instrument-track clips/)
})

test('audio tracks have no synth block', () => {
  const withSynth = AUDIO_EXAMPLE.replace('track atrk atrk #56b6c2 audio\n', 'track atrk atrk #56b6c2 audio\n  synth\n    osc sine\n')
  assert.throws(() => parse(withSynth), /audio tracks have no synth block/)
})

test('only "gain" is automatable on an audio-track clip', () => {
  const bad = AUDIO_EXAMPLE.replace('auto atrk.gain', 'auto atrk.cutoff')
  assert.throws(() => parse(bad), /"cutoff" is not an automatable param for an audio-track clip/)
})

// ---- edit primitives: addAudioClip / setClipAudioRegion -----------------------------------------

test('addAudioClip creates a clip with defaults for omitted fields', () => {
  const { doc, clip } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 4 })
  assert.deepEqual(clip.audio, { media: 'smp_drumloop', in: 0, out: 4, gainDb: 0, warp: 'off', rate: 1, markers: [] })
  assert.equal(doc.tracks.find((t) => t.id === 'atrk')!.clips.length, 1)
})

test('addAudioClip upserts an existing clip id', () => {
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 4 })
  const { doc: d2, clip } = addAudioClip(d1, 'atrk', 'c1', { media: 'smp_drumloop', in: 1, out: 5 })
  assert.equal(d2.tracks.find((t) => t.id === 'atrk')!.clips.length, 1)
  assert.equal(clip.audio!.in, 1)
})

test('addAudioClip rejects a non-audio track', () => {
  assert.throws(() => addAudioClip(docWithMedia(), 'lead', 'c1', { media: 'smp_drumloop', in: 0, out: 4 }), /audio-region clips only belong on audio tracks/)
})

test('addAudioClip rejects an unregistered media id', () => {
  assert.throws(() => addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_ghost', in: 0, out: 4 }), /no sample "smp_ghost"/)
})

test('addAudioClip rejects out <= in', () => {
  assert.throws(() => addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 4, out: 4 }), /out-point must be > in-point/)
})

test('setClipAudioRegion trims in/out independently', () => {
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 8 })
  const { doc: d2, region } = setClipAudioRegion(d1, 'atrk', 'c1', { in: 1, out: 6 })
  assert.equal(region.in, 1)
  assert.equal(region.out, 6)
  assert.equal(d2.tracks.find((t) => t.id === 'atrk')!.clips[0]!.audio!.gainDb, 0) // untouched field unchanged
})

test('setClipAudioRegion sets static gain', () => {
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 8 })
  const { region } = setClipAudioRegion(d1, 'atrk', 'c1', { gainDb: -6 })
  assert.equal(region.gainDb, -6)
})

test('setClipAudioRegion switching to repitch requires an explicit rate', () => {
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 8 })
  const { region } = setClipAudioRegion(d1, 'atrk', 'c1', { warp: 'repitch', rate: 2 })
  assert.equal(region.warp, 'repitch')
  assert.equal(region.rate, 2)
})

test('setClipAudioRegion switching away from repitch normalizes rate back to 1', () => {
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 8, warp: 'repitch', rate: 2 })
  const { region } = setClipAudioRegion(d1, 'atrk', 'c1', { warp: 'off' })
  assert.equal(region.warp, 'off')
  assert.equal(region.rate, 1)
})

test('setClipAudioRegion rejects a clip with no audio region', () => {
  const { doc } = addTrack(docWithMedia(), { id: 'atrk2', kind: 'audio' })
  // no clip at all yet
  assert.throws(() => setClipAudioRegion(doc, 'atrk2', 'ghost', { gainDb: -3 }), /no clip "ghost"/)
})

// ---- setValue path grammar (the beat set / POST /edit surface) ----------------------------------

test('setValue can create an audio-region clip via <track>.clip.<id>.audio', () => {
  const doc = setValue(docWithMedia(), 'atrk.clip.c1.audio', 'smp_drumloop 0 4 -6 repitch 2')
  const clip = doc.tracks.find((t) => t.id === 'atrk')!.clips[0]!
  assert.deepEqual(clip.audio, { media: 'smp_drumloop', in: 0, out: 4, gainDb: -6, warp: 'repitch', rate: 2, markers: [] })
})

test('setValue can trim one field via <track>.clip.<id>.audio.<field>', () => {
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 8 })
  const d2 = setValue(d1, 'atrk.clip.c1.audio.out', '6')
  assert.equal(d2.tracks.find((t) => t.id === 'atrk')!.clips[0]!.audio!.out, 6)
  const d3 = setValue(d2, 'atrk.clip.c1.audio.gainDb', '-4.5')
  assert.equal(d3.tracks.find((t) => t.id === 'atrk')!.clips[0]!.audio!.gainDb, -4.5)
})

// ---- split-at-point -------------------------------------------------------------------------------

test('splitAudioClip splits one region into two with adjusted in/out, referencing the same media', () => {
  // 120 bpm, 4 steps = one quarter note = 0.5s of unwarped (rate=1) source material
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 8 })
  const { doc, first, second } = splitAudioClip(d1, 'atrk', 'c1', 4)
  assert.equal(first.id, 'c1')
  assert.equal(first.audio!.in, 0)
  assert.equal(first.audio!.out, 0.5)
  assert.equal(second.id, 'c1-2')
  assert.equal(second.audio!.in, 0.5)
  assert.equal(second.audio!.out, 8)
  assert.equal(second.audio!.media, 'smp_drumloop')
  const clips = doc.tracks.find((t) => t.id === 'atrk')!.clips
  assert.deepEqual(clips.map((c) => c.id), ['c1', 'c1-2'])
})

test('splitAudioClip accounts for the repitch rate when converting timeline steps to source seconds', () => {
  // rate=2 means twice as much source material elapses per second of playback
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 8, warp: 'repitch', rate: 2 })
  const { first, second } = splitAudioClip(d1, 'atrk', 'c1', 4)
  assert.equal(first.audio!.out, 1) // 0.5s of timeline * rate 2 = 1s of source
  assert.equal(second.audio!.in, 1)
})

test('splitAudioClip mints c1-2, c1-3, ... when the default name collides', () => {
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 16 })
  const { doc: d2 } = splitAudioClip(d1, 'atrk', 'c1', 4) // makes c1, c1-2
  const { second } = splitAudioClip(d2, 'atrk', 'c1', 2) // c1-2 already taken -> c1-3
  assert.equal(second.id, 'c1-3')
})

test('splitAudioClip accepts an explicit newClipId', () => {
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 8 })
  const { second } = splitAudioClip(d1, 'atrk', 'c1', 4, { newClipId: 'tail' })
  assert.equal(second.id, 'tail')
})

test('splitAudioClip partitions gain-automation points by time, retiming the second half', () => {
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 8 })
  const { doc: d2 } = addAutomationPoint(d1, 'atrk', 'c1', 'gain', { time: 0, value: -6, id: 'p1' })
  const { doc: d3 } = addAutomationPoint(d2, 'atrk', 'c1', 'gain', { time: 8, value: 0, id: 'p2' })
  const { first, second } = splitAudioClip(d3, 'atrk', 'c1', 4)
  assert.deepEqual(first.automation[0]!.points, [{ id: 'p1', time: 0, value: -6 }])
  assert.deepEqual(second.automation[0]!.points, [{ id: 'p2', time: 4, value: 0 }]) // 8 - 4 = 4, relative to its own new start
})

test('splitAudioClip rejects a split position outside the region', () => {
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 0.5 }) // 0.5s = 4 steps at 120bpm
  assert.throws(() => splitAudioClip(d1, 'atrk', 'c1', 100), /out of range/)
})

test('splitAudioClip rejects a non-positive split position', () => {
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 8 })
  assert.throws(() => splitAudioClip(d1, 'atrk', 'c1', 0), /must be > 0/)
})

test('splitAudioClip rejects a non-audio track and a missing clip', () => {
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 8 })
  assert.throws(() => splitAudioClip(d1, 'lead', 'c1', 4), /split-at-point only applies to audio-region clips/)
  assert.throws(() => splitAudioClip(d1, 'atrk', 'ghost', 4), /no clip "ghost"/)
})

// ---- gain automation reuses the v0.9 machinery unchanged -----------------------------------------

test('addAutomationPoint / setAutomationPoint / removeAutomationPoint work on an audio clip gain lane', () => {
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 8 })
  const { doc: d2, point } = addAutomationPoint(d1, 'atrk', 'c1', 'gain', { time: 0, value: -6 })
  assert.equal(point.id, 'p1')
  const { doc: d3 } = setAutomationPoint(d2, 'atrk', 'c1', 'gain', { id: 'p1', time: 0, value: -3 })
  assert.equal(d3.tracks.find((t) => t.id === 'atrk')!.clips[0]!.automation[0]!.points[0]!.value, -3)
  const { doc: d4 } = removeAutomationPoint(d3, 'atrk', 'c1', 'gain', 'p1')
  assert.equal(d4.tracks.find((t) => t.id === 'atrk')!.clips[0]!.automation.length, 0)
})

test('synth params are rejected on an audio-track clip; gain is rejected on a synth-track clip', () => {
  const { doc: d1 } = addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 8 })
  assert.throws(() => addAutomationPoint(d1, 'atrk', 'c1', 'cutoff', { time: 0, value: 900 }), /not an automatable param for an audio-track clip/)
  assert.throws(() => addAutomationPoint(docWithMedia(), 'lead', 'ghost', 'gain', { time: 0, value: 0 }), /not an automatable synth param/)
})

// ---- diff --------------------------------------------------------------------------------------

test('diff reports a brand-new clip as clip-added (same as notes/hits), and a field change on an existing clip itemized', () => {
  const base = docWithMedia()
  const { doc: withClip } = addAudioClip(base, 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 8 })
  // a whole new clip is "clip added" — same coarse signal notes/hits get for a fresh clip, not a
  // separate audio-region entry (matches the existing "a clip is a snapshot" diff discipline).
  const addedDiff = formatDiff(diffDocuments(base, withClip))
  assert.match(addedDiff, /atrk: clip added "c1"/)

  const { doc: trimmed } = setClipAudioRegion(withClip, 'atrk', 'c1', { out: 6, gainDb: -3 })
  const changedDiff = formatDiff(diffDocuments(withClip, trimmed))
  assert.match(changedDiff, /atrk: clip "c1" audio out 8 -> 6, gainDb 0 -> -3/)

  const removedDiff = formatDiff(diffDocuments(withClip, base))
  assert.match(removedDiff, /atrk: clip removed "c1"/)
})

test('diff itemizes an audio region appearing/disappearing on a clip id that persists on both sides', () => {
  // Constructed directly (no edit primitive today produces this exact transition — a clip that
  // keeps its id but loses/gains its region) to exercise diff.ts's audio-region-added/removed
  // branches directly, the same way the rest of this suite exercises the reachable paths.
  const base = docWithMedia()
  const { doc: withClip } = addAudioClip(base, 'atrk', 'c1', { media: 'smp_drumloop', in: 0, out: 8 })
  const stripped = {
    ...withClip,
    tracks: withClip.tracks.map((t) => (t.id === 'atrk' ? { ...t, clips: t.clips.map((c) => ({ ...c, audio: undefined })) } : t)),
  }
  const addedDiff = formatDiff(diffDocuments(stripped, withClip))
  assert.match(addedDiff, /atrk: clip "c1" audio region added \(smp_drumloop 0-8, off\)/)
  const removedDiff = formatDiff(diffDocuments(withClip, stripped))
  assert.match(removedDiff, /atrk: clip "c1" audio region removed \(smp_drumloop 0-8\)/)
})

// ---- inspect -------------------------------------------------------------------------------------

test('describeDocument summarizes an audio track and its region', () => {
  const doc = parse(AUDIO_EXAMPLE)
  const text = describeDocument(doc)
  assert.match(text, /atrk {2}"atrk" {2}audio/)
  assert.match(text, /solo-take \(smp_drumloop 0-8s, repitch x1\.5, -3 dB, auto: gain\(2\)\)/)
})

// ---- BeatEditError / BeatParseError sanity (both real classes, not generic Error) ---------------

test('audio-region errors use the same error classes as the rest of core', () => {
  assert.throws(() => addAudioClip(docWithMedia(), 'atrk', 'c1', { media: 'smp_ghost', in: 0, out: 4 }), BeatEditError)
  assert.throws(() => parse(AUDIO_EXAMPLE.replace('repitch 1.5', 'turntable 1.5')), BeatParseError)
})
