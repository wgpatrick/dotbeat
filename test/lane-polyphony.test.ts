// Per-lane polyphony — the DATA-CONTRACT half (research 142 D6, build item 4).
//
// THE BUG. Every sample-backed lane is one `Tone.Player`. `Source.start()` on an already-started
// source calls `restart()`, and `Player._restart` stops the most recently created source — so a
// repeated hit on one lane CUTS ITS OWN TAIL. There is no legato and no overlap. On a kick that is
// what you want and is how every existing project sounds; on a KEYMAP lane, which is a pitched
// instrument built out of drum lanes, a line that revisits a pitch inside the sample's own decay
// comes out chopped and mechanical — on exactly the bells, plucks and pads that workflow generates.
//
// THE FIX, and the thing this file guards: `voices`, a per-lane pool size, DEFAULT 1. Default 1 is
// load-bearing — it means every committed drum kit, every golden render and every existing file is
// bit-for-bit unchanged, and self-choking stays the default where it belongs. `beat keymap` mints
// its lanes with a real pool instead.
//
// The RENDER assertion (two overlapping notes on one lane produce more energy than one — i.e. the
// tail survives) lives in ui/verify-lane-polyphony.mjs, since the engine needs a browser.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BeatDocument, BeatLaneSampleBacking } from '../src/core/document.js'
import {
  SAMPLE_LANE_PARAM_DEFAULTS,
  SAMPLE_LANE_PARAM_KEYS,
  SAMPLE_LANE_VOICES_MAX,
  SAMPLE_LANE_VOICES_MIN,
  addLane,
  setLaneSample,
  addTrack,
  defaultDrumKitLanes,
  initDocument,
  parse,
  sampleLaneParamError,
  serialize,
  setLaneParam,
  setMediaSample,
  setValue,
} from '../src/core/index.js'
import { BeatEditError } from '../src/core/edit.js'
import { BeatParseError } from '../src/core/parse.js'
import { KEYMAP_LANE_VOICES, buildKeymap, noteToMidi } from '../src/core/keymap.js'

function project() {
  let doc = initDocument({ trackId: 'lead' })
  doc = addTrack(doc, { id: 'kit', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  doc = setMediaSample(doc, 'bell', 'a'.repeat(64), 'media/bell.wav')
  doc = setLaneSample(doc, 'kit', 'kick', { sample: 'bell', gainDb: 0, tune: 0 })
  return doc
}

/** The sample backing of a named lane, or a failed assertion. */
function backing(doc: BeatDocument, trackId: string, name: string): BeatLaneSampleBacking {
  const track = doc.tracks.find((t) => t.id === trackId)
  assert.ok(track && track.kind === 'drums')
  const lane = track.lanes.find((l) => l.name === name)
  assert.ok(lane, `no lane "${name}"`)
  assert.equal(lane.backing.type, 'sample')
  return lane.backing as BeatLaneSampleBacking
}

test('voices DEFAULTS to 1 — today’s monophonic, self-choking behavior, so nothing existing moves', () => {
  assert.equal(SAMPLE_LANE_PARAM_DEFAULTS.voices, 1)
  assert.ok((SAMPLE_LANE_PARAM_KEYS as readonly string[]).includes('voices'))
  const doc = project()
  assert.equal(backing(doc, 'kit', 'kick').params.voices, undefined, 'an ordinary lane carries no override at all')
  // Canonical elision: the default emits no token, so every pre-existing .beat is byte-identical.
  assert.equal(serialize(doc).includes('voices='), false)
  assert.match(serialize(doc), /lane kick sample bell 0 0$/m)
})

test('voices round-trips as an ordinary sample-lane param token', () => {
  const doc = setLaneParam(project(), 'kit', 'kick', 'voices', 4).doc
  const text = serialize(doc)
  assert.match(text, /lane kick sample bell 0 0 voices=4/)
  assert.equal(serialize(parse(text)), text)
  assert.equal(backing(parse(text), 'kit', 'kick').params.voices, 4)
})

test('voices is validated, not silently clamped — identically on both surfaces', () => {
  // A `voices 0` lane would be SILENT and a `voices 2.5` lane a rounding surprise; both are user
  // errors with obvious fixes, so both fail loudly. One rule (sampleLaneParamError) shared by
  // parse.ts and edit.ts so a hand edit and a `beat set` can never disagree.
  assert.equal(sampleLaneParamError('voices', 1), null)
  assert.equal(sampleLaneParamError('voices', SAMPLE_LANE_VOICES_MAX), null)
  assert.match(sampleLaneParamError('voices', 0)!, /integer 1-8/)
  assert.match(sampleLaneParamError('voices', 2.5)!, /integer 1-8/)
  assert.match(sampleLaneParamError('voices', SAMPLE_LANE_VOICES_MAX + 1)!, /integer 1-8/)
  assert.equal(sampleLaneParamError('cutoff', 0.5), null, 'the rule is voices-specific')

  const doc = project()
  assert.throws(() => setLaneParam(doc, 'kit', 'kick', 'voices', 0), BeatEditError)
  assert.throws(() => setLaneParam(doc, 'kit', 'kick', 'voices', 12), BeatEditError)
  assert.throws(() => setValue(doc, 'kit.lane.kick.voices', '2.5'), BeatEditError)
  assert.equal(backing(setValue(doc, 'kit.lane.kick.voices', '3'), 'kit', 'kick').params.voices, 3)

  const bad = serialize(doc).replace('lane kick sample bell 0 0', 'lane kick sample bell 0 0 voices=0')
  assert.throws(() => parse(bad), BeatParseError)
  assert.throws(() => parse(bad), /voices must be an integer 1-8/)
  assert.equal(SAMPLE_LANE_VOICES_MIN, 1)
})

test('beat keymap mints lanes with a real pool — the fix reaching the workflow that needed it', () => {
  let doc = initDocument({ trackId: 'lead' })
  doc = addTrack(doc, { id: 'bells', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  doc = setMediaSample(doc, 'bell_a', 'b'.repeat(64), 'media/bell_a.wav')
  const { doc: mapped, lanes } = buildKeymap(doc, 'bells', 'bell_a', {
    rootMidi: noteToMidi('a6'), scaleRootMidi: noteToMidi('a5'), scale: 'minorPentatonic', fromMidi: noteToMidi('a5'), toMidi: noteToMidi('a6'),
  })
  assert.ok(lanes.length >= 5)
  for (const lane of lanes) {
    assert.equal(backing(mapped, 'bells', lane.name).params.voices, KEYMAP_LANE_VOICES, `${lane.name} is polyphonic`)
  }
  assert.ok(KEYMAP_LANE_VOICES > 1 && KEYMAP_LANE_VOICES <= SAMPLE_LANE_VOICES_MAX)
  assert.equal(serialize(parse(serialize(mapped))), serialize(mapped))
})

test('re-running keymap over EXISTING monophonic lanes upgrades them (the normal way to fix a keymap)', () => {
  let doc = initDocument({ trackId: 'lead' })
  doc = addTrack(doc, { id: 'bells', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  doc = setMediaSample(doc, 'bell_a', 'b'.repeat(64), 'media/bell_a.wav')
  // A lane that predates `voices` — no override, i.e. monophonic.
  doc = addLane(doc, 'bells', 'a5', ['sample', 'bell_a', '0', '-12']).doc
  assert.equal(backing(doc, 'bells', 'a5').params.voices, undefined)

  const { doc: after, rebacked } = buildKeymap(doc, 'bells', 'bell_a', {
    rootMidi: noteToMidi('a6'), scaleRootMidi: noteToMidi('a5'), scale: 'minorPentatonic', fromMidi: noteToMidi('a5'), toMidi: noteToMidi('a6'),
  })
  assert.deepEqual(rebacked, ['a5'])
  assert.equal(backing(after, 'bells', 'a5').params.voices, KEYMAP_LANE_VOICES, 're-backing keeps lane shaping, but must not leave the choking behind')
})

test('a DRUM lane is untouched: no pool unless it asks for one', () => {
  // The whole reason the default is 1. A kit built the ordinary way carries no voices token, so
  // every existing drum render, golden and showdown arm is bit-for-bit what it was.
  let doc = initDocument({ trackId: 'lead' })
  doc = addTrack(doc, { id: 'kit', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  doc = setMediaSample(doc, 'kick', 'c'.repeat(64), 'media/kick.wav')
  doc = setLaneSample(doc, 'kit', 'kick', { sample: 'kick', gainDb: -3, tune: 0 })
  assert.equal(serialize(doc).includes('voices='), false)
})
