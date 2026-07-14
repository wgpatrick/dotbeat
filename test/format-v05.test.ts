// v0.5 grammar tests — media block + sample-backed drum lanes (docs/phase-7-plan.md). Under
// test: content addressing (sha256 pinned in the text), reference validation, canonical
// placement (media before tracks; lane lines in DRUM_LANES order), and the edit primitives the
// CLI wraps (setMediaSample / setLaneSample).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parse,
  serialize,
  setMediaSample,
  setLaneSample,
  beatDocumentToPartialTracks,
  addTrack,
  defaultDrumKitLanes,
  initDocument,
  BeatParseError,
  BeatEditError,
} from '../src/core/index.js'

const SHA = 'a'.repeat(64)
const SHB = 'b'.repeat(64)

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

const MEDIA_EXAMPLE = `format_version 0.5
bpm 126
loop_bars 1
selected_track drums

media
  sample kick-909 sha256:${SHA} media/kick.wav
  sample snare-x sha256:${SHB} media/snare.wav

track drums Drums #e35d5d drums
${CORE_SYNTH}
  lane kick kick-909 -2 -3
  lane snare snare-x 0 0
  hit kick0 kick 0 0.9
  hit snare2 snare 2 0.8
`

test('the media example round-trips byte-identically', () => {
  const doc = parse(MEDIA_EXAMPLE)
  assert.equal(serialize(doc), MEDIA_EXAMPLE)
})

test('media entries and lane assignments parse into the expected shapes', () => {
  const doc = parse(MEDIA_EXAMPLE)
  assert.deepEqual(doc.media, [
    { id: 'kick-909', sha256: SHA, path: 'media/kick.wav' },
    { id: 'snare-x', sha256: SHB, path: 'media/snare.wav' },
  ])
  const drums = doc.tracks[0]!
  assert.deepEqual(drums.laneSamples.kick, { sample: 'kick-909', gainDb: -2, tune: -3 })
  assert.deepEqual(drums.laneSamples.snare, { sample: 'snare-x', gainDb: 0, tune: 0 })
  assert.equal(drums.laneSamples.hat, undefined)
})

test('reference and format validation fail loudly', () => {
  // lane referencing an undeclared sample
  assert.throws(() => parse(MEDIA_EXAMPLE.replace('lane kick kick-909', 'lane kick ghost')), /unknown sample "ghost"/)
  // bad hash format
  assert.throws(() => parse(MEDIA_EXAMPLE.replace(`sha256:${SHA}`, 'sha256:zz')), /sha256:<64 lowercase hex chars>/)
  // absolute / traversal paths rejected
  assert.throws(() => parse(MEDIA_EXAMPLE.replace('media/kick.wav', '/etc/kick.wav')), /relative without/)
  assert.throws(() => parse(MEDIA_EXAMPLE.replace('media/kick.wav', '../kick.wav')), /relative without/)
  // duplicate sample id / duplicate lane line
  assert.throws(() => parse(MEDIA_EXAMPLE.replace('sample snare-x', 'sample kick-909')), /duplicate sample id/)
  assert.throws(() => parse(MEDIA_EXAMPLE.replace('lane snare snare-x 0 0', 'lane kick snare-x 0 0')), /duplicate lane line/)
  // lane on a synth track
  const synthLane = `format_version 0.5
bpm 120
loop_bars 1
selected_track a

media
  sample s sha256:${SHA} media/s.wav

track a A #ffffff synth
${CORE_SYNTH}
  lane kick s 0 0
`
  assert.throws(() => parse(synthLane), /lane lines only belong in drum tracks/)
  // tune out of range
  assert.throws(() => parse(MEDIA_EXAMPLE.replace('lane kick kick-909 -2 -3', 'lane kick kick-909 -2 -30')), /-24\.\.24/)
  // media block after tracks (canonical order)
  const late = MEDIA_EXAMPLE.replace(/media\n(  sample .*\n)+\n/, '') + `\nmedia\n  sample z sha256:${SHA} media/z.wav\n`
  assert.throws(() => parse(late), BeatParseError)
})

test('a v0.4 document (no media/lanes) is unchanged', () => {
  const plain = MEDIA_EXAMPLE.replace(/media\n(  sample .*\n)+\n/, '').replace(/  lane .*\n/g, '').replace('0.5', '0.4')
  const doc = parse(plain)
  assert.deepEqual(doc.media, [])
  assert.deepEqual(doc.tracks[0]!.laneSamples, {})
  assert.equal(serialize(doc), plain)
})

test('setMediaSample and setLaneSample validate and round-trip', () => {
  let doc = parse(MEDIA_EXAMPLE)
  // register a new sample, re-pin an existing one
  doc = setMediaSample(doc, 'hat-x', SHB, 'media/hat.wav')
  doc = setMediaSample(doc, 'kick-909', SHB, 'media/kick2.wav') // overwrite = re-pin
  assert.equal(doc.media.length, 3)
  assert.equal(doc.media.find((m) => m.id === 'kick-909')!.path, 'media/kick2.wav')
  // assign + clear a lane
  doc = setLaneSample(doc, 'drums', 'hat', { sample: 'hat-x', gainDb: -1, tune: 2 })
  assert.deepEqual(parse(serialize(doc)).tracks[0]!.laneSamples.hat, { sample: 'hat-x', gainDb: -1, tune: 2 })
  doc = setLaneSample(doc, 'drums', 'hat', null)
  assert.equal(doc.tracks[0]!.laneSamples.hat, undefined)
  // validation
  assert.throws(() => setMediaSample(doc, 'bad id', SHA, 'media/x.wav'), BeatEditError)
  assert.throws(() => setMediaSample(doc, 'x', 'nothex', 'media/x.wav'), BeatEditError)
  assert.throws(() => setMediaSample(doc, 'x', SHA, '../x.wav'), BeatEditError)
  assert.throws(() => setLaneSample(doc, 'drums', 'kick', { sample: 'ghost', gainDb: 0, tune: 0 }), /register it with beat sample first/)
})

test('a lane re-assignment is a one-line text diff', () => {
  const a = parse(MEDIA_EXAMPLE)
  const b = setLaneSample(a, 'drums', 'kick', { sample: 'snare-x', gainDb: -2, tune: -3 })
  const aLines = serialize(a).split('\n')
  const bLines = serialize(b).split('\n')
  assert.equal(aLines.length, bLines.length)
  assert.deepEqual(bLines.filter((l, i) => l !== aLines[i]), ['  lane kick snare-x -2 -3'])
})

test('media and laneSamples ride the partials for the bridge/renderer', () => {
  const partial = beatDocumentToPartialTracks(parse(MEDIA_EXAMPLE))
  assert.deepEqual(partial.media, [
    { id: 'kick-909', sha256: SHA, path: 'media/kick.wav' },
    { id: 'snare-x', sha256: SHB, path: 'media/snare.wav' },
  ])
  assert.deepEqual(partial.tracks[0]!.laneSamples, {
    kick: { sample: 'kick-909', gainDb: -2, tune: -3 },
    snare: { sample: 'snare-x', gainDb: 0, tune: 0 },
  })
})

// 2026-07-13 (owner dogfood session): on a DECLARED-lane track, setLaneSample must edit the
// lane DECLARATION's backing — the only thing declared-mode playback reads — not the legacy
// laneSamples bag, which is invisible to it. Before this fix, `beat lane` on every modern
// drums track "succeeded" while the render silently kept the synth voice.
test('setLaneSample on a declared-lane track edits the declaration backing (not legacy laneSamples)', () => {
  let doc = initDocument({ bpm: 120 })
  doc = addTrack(doc, { id: 'drums', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  doc = setMediaSample(doc, 'vox', SHA, 'media/vox.wav')

  doc = setLaneSample(doc, 'drums', 'kick', { sample: 'vox', gainDb: -2, tune: 3 })
  const track = doc.tracks.find((t) => t.id === 'drums')!
  const kick = track.lanes.find((l) => l.name === 'kick')!
  assert.equal(kick.backing.type, 'sample')
  assert.deepEqual(track.laneSamples, {}, 'legacy bag stays untouched on a declared-lane track')
  assert.match(serialize(doc), /^ {2}lane kick sample vox -2 3$/m)

  // round-trips as a declaration, not a legacy line
  const rt = parse(serialize(doc)).tracks.find((t) => t.id === 'drums')!
  assert.equal(rt.lanes.find((l) => l.name === 'kick')!.backing.type, 'sample')

  // re-backing keeps declared shaping fields structure (fresh backing from synth has clean defaults)
  const backing = kick.backing as { type: 'sample'; params: Record<string, number>; filterType: string; effects: unknown[] }
  assert.deepEqual(backing.params, {})
  assert.equal(backing.filterType, 'lowpass')
  assert.deepEqual(backing.effects, [])

  // "none" restores the default kit's synth voice for that lane name
  doc = setLaneSample(doc, 'drums', 'kick', null)
  const reverted = doc.tracks.find((t) => t.id === 'drums')!.lanes.find((l) => l.name === 'kick')!
  assert.deepEqual(reverted.backing, { type: 'synth', voice: 'membrane', params: {} })
  assert.match(serialize(doc), /^ {2}lane kick synth:membrane$/m)

  // unknown declared lane fails loudly with the real lane list
  assert.throws(() => setLaneSample(doc, 'drums', 'nope', { sample: 'vox', gainDb: 0, tune: 0 }), /no lane "nope" declared on track "drums" \(have: kick, snare/)
})
