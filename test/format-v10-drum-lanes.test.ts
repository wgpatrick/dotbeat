// v0.10 grammar tests — the open per-track drum lane list + optional hit duration (Phase 22
// Stream AB, docs/research/19-drum-voice-expansion.md + docs/research/20-drum-clip-editor-
// redesign.md, docs/phase-22-stream-ab.md). Under test:
//   - backward compatibility: every pre-v0.10 5-lane file parses AND re-serializes byte-identically
//   - the three new `lane` backing forms (synth:/sample/sf) parse, validate, and round-trip
//   - hit lines gain an optional trailing duration, elided when absent (old hits stay untouched)
//   - a hit referencing an undeclared lane is a parse error
//   - addHit/addTrack/setValue support the open lane model and duration
//   - diff surfaces lane-decl and hit duration changes

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parse,
  serialize,
  addTrack,
  addHit,
  removeHit,
  setValue,
  initDocument,
  defaultDrumKitLanes,
  DEFAULT_DRUM_KIT,
  BeatParseError,
  BeatEditError,
  diffDocuments,
  formatDiff,
  materializeLanes,
  addLane,
  removeLane,
  moveLane,
  setLaneBacking,
  setLaneParam,
  setMediaSample,
} from '../src/core/index.js'

const SHA = 'c'.repeat(64)

function drumDoc() {
  return addTrack(initDocument({ trackId: 'lead', loopBars: 1 }), { id: 'drums', kind: 'drums' }).doc
}
const drumsOf = (d: ReturnType<typeof initDocument>) => d.tracks.find((t) => t.id === 'drums')!

// ---- backward compatibility: v0.8/v0.9 files parse and re-serialize byte-identically ----

const LEGACY_5LANE = `format_version 0.9
bpm 120
loop_bars 1
selected_track drums

track drums Drums #e06c75 drums
  synth
    osc sawtooth
    volume -10
    cutoff 12000
    resonance 0.1
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
  hit h1 kick 0 0.9
  hit h3 hat 2 0.5
  hit h2 snare 4 0.8
`

test('a legacy 5-lane file (no lane declarations) parses with lanes: [] and re-serializes byte-identically', () => {
  const doc = parse(LEGACY_5LANE)
  const drums = drumsOf(doc)
  assert.deepEqual(drums.lanes, [])
  assert.equal(drums.hits.length, 3)
  assert.equal(serialize(doc), LEGACY_5LANE)
  // second round trip is a no-op too (idempotent canonical form)
  assert.equal(serialize(parse(serialize(doc))), LEGACY_5LANE)
})

const LEGACY_WITH_LANE_SAMPLE = `format_version 0.5
bpm 126
loop_bars 1
selected_track drums

media
  sample kick-909 sha256:${SHA} media/kick.wav

track drums Drums #e35d5d drums
  synth
    osc sawtooth
    volume 0
    cutoff 12000
    resonance 0.1
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
  lane kick kick-909 -2 -3
  hit h1 kick 0 0.9
`

test('a legacy v0.5 sample-lane file parses into laneSamples (NOT the new lanes list) and round-trips byte-identically', () => {
  const doc = parse(LEGACY_WITH_LANE_SAMPLE)
  const drums = drumsOf(doc)
  assert.deepEqual(drums.lanes, [])
  assert.deepEqual(drums.laneSamples.kick, { sample: 'kick-909', gainDb: -2, tune: -3 })
  assert.equal(serialize(doc), LEGACY_WITH_LANE_SAMPLE)
})

// ---- new open lane declarations ----

test('lane synth: declarations parse, canonically elide default params, and round-trip', () => {
  const text = `format_version 0.10
bpm 120
loop_bars 1
selected_track drums

track drums Drums #e06c75 drums
  synth
    osc sawtooth
    volume -10
    cutoff 12000
    resonance 0.1
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
  lane kick synth:membrane tune=30 punch=0.08
  lane snare synth:noise
  lane hat synth:metal
  hit h1 kick 0 0.9
  hit h2 snare 4 0.8 2
`
  const doc = parse(text)
  const drums = drumsOf(doc)
  assert.deepEqual(drums.lanes, [
    { name: 'kick', backing: { type: 'synth', voice: 'membrane', params: { tune: 30, punch: 0.08 } } },
    { name: 'snare', backing: { type: 'synth', voice: 'noise', params: {} } },
    { name: 'hat', backing: { type: 'synth', voice: 'metal', params: {} } },
  ])
  assert.equal(drums.hits.find((h) => h.id === 'h2')!.duration, 2)
  assert.equal(serialize(doc), text)
})

test('lane sample/sf declarations parse and round-trip', () => {
  const text = `format_version 0.10
bpm 120
loop_bars 1
selected_track drums

media
  sample crash-1 sha256:${SHA} media/crash.wav
  sample gm-kit sha256:${'d'.repeat(64)} sf2/gm.sf2

track drums Drums #e06c75 drums
  synth
    osc sawtooth
    volume -10
    cutoff 12000
    resonance 0.1
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
  lane crash sample crash-1 -3 0
  lane rimshot sf gm-kit 0 37
  hit h1 crash 0 0.8
  hit h2 rimshot 4 0.6
`
  const doc = parse(text)
  const drums = drumsOf(doc)
  assert.deepEqual(drums.lanes, [
    { name: 'crash', backing: { type: 'sample', sample: 'crash-1', gainDb: -3, tune: 0, params: {}, filterType: 'lowpass', effects: [] } },
    { name: 'rimshot', backing: { type: 'sf', sample: 'gm-kit', program: 0, note: 37 } },
  ])
  assert.equal(serialize(doc), text)
})

test('a hit referencing an undeclared lane is a parse error', () => {
  const text = `format_version 0.10
bpm 120
loop_bars 1
selected_track drums

track drums Drums #e06c75 drums
  synth
    osc sawtooth
    volume -10
    cutoff 12000
    resonance 0.1
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
  lane kick synth:membrane
  hit h1 cowbell 0 0.9
`
  assert.throws(() => parse(text), /unknown drum lane "cowbell"/)
})

test('a duplicate lane declaration is a parse error', () => {
  const text = `format_version 0.10
bpm 120
loop_bars 1
selected_track drums

track drums Drums #e06c75 drums
  synth
    osc sawtooth
    volume -10
    cutoff 12000
    resonance 0.1
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
  lane kick synth:membrane
  lane kick synth:noise
`
  assert.throws(() => parse(text), /duplicate lane declaration "kick"/)
})

// ---- hit duration ----

test('hit duration is optional, elided when absent, and validated > 0', () => {
  let doc = drumDoc()
  doc = addHit(doc, 'drums', { lane: 'kick', start: 0, velocity: 0.9 }).doc
  doc = addHit(doc, 'drums', { lane: 'kick', start: 4, velocity: 0.8, duration: 1.5 }).doc
  const text = serialize(doc)
  assert.match(text, /hit h1 kick 0 0\.9\n/) // no duration -> 4-value line
  assert.match(text, /hit h2 kick 4 0\.8 1\.5\n/) // duration -> 5-value line
  assert.deepEqual(parse(text), doc)
  assert.throws(() => addHit(doc, 'drums', { lane: 'kick', start: 0, velocity: 0.5, duration: 0 }), /duration must be > 0/)
  assert.throws(() => addHit(doc, 'drums', { lane: 'kick', start: 0, velocity: 0.5, duration: -1 }), /duration must be > 0/)
})

test('setValue supports the hit grammar: add, move/resize/retarget fields, delete', () => {
  let doc = drumDoc()
  doc = setValue(doc, 'drums.hit', 'kick 0 0.9')
  assert.equal(drumsOf(doc).hits.length, 1)
  const id = drumsOf(doc).hits[0]!.id
  doc = setValue(doc, `drums.hit.${id}.duration`, '2')
  assert.equal(drumsOf(doc).hits[0]!.duration, 2)
  doc = setValue(doc, `drums.hit.${id}.start`, '4')
  assert.equal(drumsOf(doc).hits[0]!.start, 4)
  doc = setValue(doc, `drums.hit.${id}.duration`, '')
  assert.equal(drumsOf(doc).hits[0]!.duration, undefined)
  doc = setValue(doc, `drums.hit.${id}`, '')
  assert.equal(drumsOf(doc).hits.length, 0)
})

// ---- default 12-lane kit ----

test('defaultDrumKitLanes() matches DEFAULT_DRUM_KIT and is a superset of the old 5 DRUM_LANES', () => {
  const lanes = defaultDrumKitLanes()
  assert.equal(lanes.length, DEFAULT_DRUM_KIT.length)
  const names = lanes.map((l) => l.name)
  for (const legacy of ['kick', 'snare', 'clap', 'hat', 'openhat']) assert.ok(names.includes(legacy))
  for (const l of lanes) assert.equal(l.backing.type, 'synth')
})

test('addTrack only opts into the 12-lane kit when a caller passes lanes explicitly; the default stays []', () => {
  const bare = addTrack(initDocument({}), { id: 'd1', kind: 'drums' }).doc
  assert.deepEqual(bare.tracks.find((t) => t.id === 'd1')!.lanes, [])
  const kitted = addTrack(initDocument({}), { id: 'd2', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  assert.equal(kitted.tracks.find((t) => t.id === 'd2')!.lanes.length, 12)
  // a hit on a 12-lane-kit-only lane (e.g. cowbell) now validates
  const withCowbell = addHit(kitted, 'd2', { lane: 'cowbell', start: 0, velocity: 0.7 }).doc
  assert.equal(withCowbell.tracks.find((t) => t.id === 'd2')!.hits[0]!.lane, 'cowbell')
})

// ---- diff ----

test('diff reports lane-decl changes and hit duration changes', () => {
  const base = addTrack(initDocument({}), { id: 'd', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  const withHit = addHit(base, 'd', { lane: 'kick', start: 0, velocity: 0.9, id: 'h1' }).doc
  const withDuration = setValue(withHit, 'd.hit.h1.duration', '2')
  const entries = diffDocuments(withHit, withDuration)
  assert.ok(entries.some((e) => e.kind === 'hit-changed' && e.changes.some((c) => c.field === 'duration')))
  const text = formatDiff(entries)
  assert.match(text, /duration/)

  const retuned = setValue(withDuration, 'd.hit.h1.duration', '')
  const backing = { ...withDuration, tracks: withDuration.tracks.map((t) => (t.id === 'd' ? { ...t, lanes: t.lanes.map((l) => (l.name === 'kick' ? { ...l, backing: { type: 'synth' as const, voice: 'membrane' as const, params: { tune: 28 } } } : l)) } : t)) }
  const laneEntries = diffDocuments(withDuration, backing)
  assert.ok(laneEntries.some((e) => e.kind === 'lane-decl' && e.lane === 'kick'))
  void retuned
})

// ---- Phase 23 Stream BB: structural lane-editing primitives (add/remove/move/retype/param) ----

test('materializeLanes is a no-op on an already-open track, and opts a legacy track in using its current voice-shaping fields', () => {
  const kitted = addTrack(initDocument({}), { id: 'd', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  const { doc: same, lanes: unchanged } = materializeLanes(kitted, 'd')
  assert.equal(same, kitted) // referentially unchanged — genuinely a no-op
  assert.equal(unchanged.length, 12)

  let legacy = drumDoc()
  legacy = setValue(legacy, 'drums.kickTune', '40')
  legacy = setValue(legacy, 'drums.hatTone', '5000')
  const { doc: materialized, lanes } = materializeLanes(legacy, 'drums')
  assert.equal(lanes.length, 5)
  assert.deepEqual(
    lanes.map((l) => l.name),
    ['kick', 'snare', 'clap', 'hat', 'openhat'],
  )
  const kick = lanes.find((l) => l.name === 'kick')!
  assert.equal(kick.backing.type, 'synth')
  assert.equal((kick.backing as { voice: string }).voice, 'membrane')
  assert.equal((kick.backing as { params: Record<string, number> }).params.tune, 40) // carried the legacy field forward
  const hat = lanes.find((l) => l.name === 'hat')!
  assert.equal((hat.backing as { params: Record<string, number> }).params.tone, 5000)
  // declaredLaneNames is unchanged before/after — existing hits stay valid with no migration needed
  const beforeHit = addHit(legacy, 'drums', { lane: 'kick', start: 0, velocity: 0.9 }).doc
  const afterHit = addHit(materialized, 'drums', { lane: 'kick', start: 0, velocity: 0.9 }).doc
  assert.equal(beforeHit.tracks[1]!.hits[0]!.lane, afterHit.tracks[1]!.hits[0]!.lane)
})

test('addLane/removeLane/moveLane refuse to operate on a track still on the implicit 5-lane kit', () => {
  const legacy = drumDoc()
  assert.throws(() => addLane(legacy, 'drums', 'rim', ['synth:noise']), /materializeLanes first/)
  assert.throws(() => removeLane(legacy, 'drums', 'kick'), /materializeLanes first/)
  assert.throws(() => moveLane(legacy, 'drums', 'kick', 0), /materializeLanes first/)
})

test('addLane appends (or inserts at an index), validates the name and backing grammar, and round-trips', () => {
  let doc = addTrack(initDocument({}), { id: 'd', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  const before = doc.tracks[1]!.lanes.length
  doc = addLane(doc, 'd', 'rim2', ['synth:noise', 'decay=0.22']).doc
  const t = doc.tracks[1]!
  assert.equal(t.lanes.length, before + 1)
  assert.equal(t.lanes[t.lanes.length - 1]!.name, 'rim2')
  assert.deepEqual(t.lanes[t.lanes.length - 1]!.backing, { type: 'synth', voice: 'noise', params: { decay: 0.22 } })
  assert.deepEqual(parse(serialize(doc)), doc) // round-trips

  const inserted = addLane(doc, 'd', 'rim3', ['synth:noise'], { index: 0 }).doc
  assert.equal(inserted.tracks[1]!.lanes[0]!.name, 'rim3')

  assert.throws(() => addLane(doc, 'd', 'rim2', ['synth:noise']), /already exists/)
  assert.throws(() => addLane(doc, 'd', 'bad name', ['synth:noise']), /single alphanumeric/)
  assert.throws(() => addLane(doc, 'd', 'rim4', ['synth:bogus']), /unknown drum voice type/)
  assert.throws(() => addLane(doc, 'd', 'rim4', ['sample', 'nope', '0', '0']), /unregistered sample/)
})

test('removeLane drops a declared lane, and refuses when a hit still references it', () => {
  let doc = addTrack(initDocument({}), { id: 'd', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  doc = addHit(doc, 'd', { lane: 'cowbell', start: 0, velocity: 0.7 }).doc
  assert.throws(() => removeLane(doc, 'd', 'cowbell'), /remove or re-lane them first/)
  doc = removeHit(doc, 'd', doc.tracks[1]!.hits[0]!.id).doc
  const { doc: removed } = removeLane(doc, 'd', 'cowbell')
  assert.ok(!removed.tracks[1]!.lanes.some((l) => l.name === 'cowbell'))
  assert.throws(() => removeLane(doc, 'd', 'nope'), /no lane "nope"/)
})

test('moveLane reorders the declared lane list, which IS row/serialization order', () => {
  let doc = addTrack(initDocument({}), { id: 'd', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  const names = doc.tracks[1]!.lanes.map((l) => l.name)
  const { doc: moved, before, after } = moveLane(doc, 'd', names[names.length - 1]!, 0)
  assert.equal(before, names.length - 1)
  assert.equal(after, 0)
  assert.equal(moved.tracks[1]!.lanes[0]!.name, names[names.length - 1])
  assert.deepEqual(parse(serialize(moved)), moved)
})

test('setLaneBacking retypes a lane wholesale; the name (and any hits on it) are untouched', () => {
  let doc = addTrack(initDocument({}), { id: 'd', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  doc = addHit(doc, 'd', { lane: 'kick', start: 0, velocity: 0.9, id: 'h1' }).doc
  const { doc: retyped } = setLaneBacking(doc, 'd', 'kick', ['synth:noise', 'decay=0.4'])
  const kick = retyped.tracks[1]!.lanes.find((l) => l.name === 'kick')!
  assert.deepEqual(kick.backing, { type: 'synth', voice: 'noise', params: { decay: 0.4 } })
  assert.equal(retyped.tracks[1]!.hits.find((h) => h.id === 'h1')!.lane, 'kick') // hit is unaffected
  assert.throws(() => setLaneBacking(doc, 'd', 'nope', ['synth:noise']), /no lane "nope"/)
})

test('setLaneBacking to a sample/sf backing requires the sample already be registered in media', () => {
  let doc = addTrack(initDocument({}), { id: 'd', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  assert.throws(() => setLaneBacking(doc, 'd', 'kick', ['sample', 'boom', '-2', '0']), /unregistered sample/)
  doc = setMediaSample(doc, 'boom', 'a'.repeat(64), 'media/boom.wav')
  const { doc: withSample } = setLaneBacking(doc, 'd', 'kick', ['sample', 'boom', '-2', '3'])
  assert.deepEqual(withSample.tracks[1]!.lanes.find((l) => l.name === 'kick')!.backing, { type: 'sample', sample: 'boom', gainDb: -2, tune: 3, params: {}, filterType: 'lowpass', effects: [] })
  assert.deepEqual(parse(serialize(withSample)), withSample)
})

test('setLaneParam edits one param on a synth-backed lane in place, and clears back to the voice default when given no value', () => {
  let doc = addTrack(initDocument({}), { id: 'd', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  doc = setLaneParam(doc, 'd', 'kick', 'tune', 55).doc
  let kick = doc.tracks[1]!.lanes.find((l) => l.name === 'kick')!
  assert.equal((kick.backing as { params: Record<string, number> }).params.tune, 55)
  // canonical elision: a param equal to the voice's default doesn't serialize
  assert.doesNotMatch(serialize(doc), /tune=32\.7/)
  assert.match(serialize(doc), /lane kick synth:membrane tune=55/)

  doc = setLaneParam(doc, 'd', 'kick', 'tune', undefined).doc // clear -> reverts to default, elided
  kick = doc.tracks[1]!.lanes.find((l) => l.name === 'kick')!
  assert.equal((kick.backing as { params: Record<string, number> }).params.tune, undefined)
  assert.match(serialize(doc), /lane kick synth:membrane\n/) // no params at all now

  assert.throws(() => setLaneParam(doc, 'd', 'nope', 'tune', 1), /no lane "nope"/)
})

test('setLaneParam refuses an sf-backed lane — sf has no per-param shaping concept', () => {
  let doc = addTrack(initDocument({}), { id: 'd', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  doc = setMediaSample(doc, 'gm-kit', 'a'.repeat(64), 'sf2/gm.sf2')
  doc = setLaneBacking(doc, 'd', 'kick', ['sf', 'gm-kit', '0', '36']).doc
  assert.throws(() => setLaneParam(doc, 'd', 'kick', 'note', 1), /sf-backed — only synth- and sample-backed lanes take per-param edits/)
})

// Phase 26 Stream DK: the lean drum-sampler surface (research 68/decisions.md #145) generalizes
// setLaneParam off synth-only — Start/Length/AHD-envelope/filter knobs on a sample-backed lane
// ride the SAME primitive, elide against SAMPLE_LANE_PARAM_DEFAULTS the same way, and reject any
// key outside that fixed set (unlike a synth-backed lane, which accepts any key into its params
// bag — the sample lane's surface is deliberately closed, not open-ended).
test('setLaneParam edits Start/Length/AHD-envelope/filter params on a sample-backed lane, elides at defaults, and rejects unknown keys', () => {
  let doc = addTrack(initDocument({}), { id: 'd', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  doc = setMediaSample(doc, 'boom', 'a'.repeat(64), 'media/boom.wav')
  doc = setLaneBacking(doc, 'd', 'kick', ['sample', 'boom', '0', '0']).doc

  doc = setLaneParam(doc, 'd', 'kick', 'start', 0.05).doc
  doc = setLaneParam(doc, 'd', 'kick', 'decay', 0.2).doc
  const kick = doc.tracks[1]!.lanes.find((l) => l.name === 'kick')!
  assert.deepEqual((kick.backing as { params: Record<string, number> }).params, { start: 0.05, decay: 0.2 })
  assert.match(serialize(doc), /lane kick sample boom 0 0 start=0\.05 decay=0\.2/)

  // canonical elision: setting cutoff back to its own default (18000, "wide open") clears the
  // override rather than storing a redundant explicit default.
  doc = setLaneParam(doc, 'd', 'kick', 'cutoff', 18000).doc
  assert.doesNotMatch(serialize(doc), /cutoff=/)

  doc = setLaneParam(doc, 'd', 'kick', 'start', undefined).doc // clear -> reverts to default, elided
  assert.doesNotMatch(serialize(doc), /start=/)

  assert.throws(() => setLaneParam(doc, 'd', 'kick', 'tune', 1), /unknown sample lane param "tune"/)
})
