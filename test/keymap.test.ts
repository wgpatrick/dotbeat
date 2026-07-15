// Phase 40 Stream VA — the tune arithmetic and lane minting (docs/phase-40-plan.md §VA).
//
// The headline known-answer test is at the bottom: `beat keymap` on examples/recipe-song's bell_a
// must produce EXACTLY the six lanes that song's author hand-wrote with numpy. If that ever drifts,
// the phase's premise ("the by-hand workflow becomes one command") has quietly stopped being true.
//
// Everything here is pure arithmetic over MIDI numbers — no audio, by design. Per the plan's
// keymap-as-lanes decision, the (rootMidi, targetMidi) primitives are what a future sampler
// INSTRUMENT track reuses unchanged, so they are tested as functions, not through a lane.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildKeymap,
  hzToMidi,
  midiToHz,
  midiToNote,
  noteToMidi,
  planKeymap,
  rateForPitch,
  tuneForPitch,
  LANE_TUNE_MAX,
  LANE_TUNE_MIN,
} from '../src/core/keymap.js'
import { BeatEditError } from '../src/core/edit.js'
import { initDocument, addTrack, setMediaSample, defaultDrumKitLanes, parse, serialize } from '../src/core/index.js'
import type { BeatDocument, BeatLaneSampleBacking } from '../src/core/document.js'
import { detectPitch } from '../src/analysis/pitch.js'
import { decodeWav } from '../src/metrics/wav.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root

// ---- note names <-> MIDI --------------------------------------------------------------------

test('scientific pitch notation round-trips, with c4 = middle C = 60', () => {
  assert.equal(noteToMidi('c4'), 60)
  assert.equal(noteToMidi('a4'), 69)
  assert.equal(noteToMidi('a6'), 93) // the recipe-song bell's root
  assert.equal(noteToMidi('a5'), 81)
  assert.equal(noteToMidi('c-1'), 0)
  for (const midi of [0, 21, 60, 69, 93, 127]) assert.equal(noteToMidi(midiToNote(midi)), midi)
})

test('note-name input is liberal (case, #/s/b) but output is canonical and LANE-NAME LEGAL', () => {
  assert.equal(noteToMidi('C#4'), 61)
  assert.equal(noteToMidi('cs4'), 61)
  assert.equal(noteToMidi('db4'), 61)
  assert.equal(noteToMidi('A6'), 93)
  // A lane name must match edit.ts's /^[a-zA-Z0-9_-]+$/ — "#" is not in it, so sharps spell "s".
  assert.equal(midiToNote(61), 'cs4')
  for (let midi = 0; midi <= 127; midi++) assert.match(midiToNote(midi), /^[a-zA-Z0-9_-]+$/)
})

test('a bad note name says what a good one looks like', () => {
  assert.throws(() => noteToMidi('h9'), (e: Error) => e instanceof BeatEditError && /not a note name/.test(e.message))
  assert.throws(() => noteToMidi('a'), /not a note name/)
  assert.throws(() => noteToMidi('c99'), /outside the 0-127 range/)
})

test('midi <-> Hz is equal temperament at a4 = 440', () => {
  assert.equal(midiToHz(69), 440)
  assert.ok(Math.abs(midiToHz(93) - 1760) < 1e-9) // a6
  assert.ok(Math.abs(hzToMidi(440) - 69) < 1e-9)
  assert.ok(Math.abs(hzToMidi(1748.6) - 92.888) < 0.01) // bell_a's hand-measured dominant partial
  assert.throws(() => hzToMidi(0), /must be positive/)
})

// ---- the primitives a future sampler track reuses ---------------------------------------------

test('tuneForPitch is the interval — and takes a FRACTIONAL root, which is the normal case', () => {
  assert.equal(tuneForPitch(93, 81), -12) // a6 sample played at a5
  assert.equal(tuneForPitch(93, 93), 0)
  assert.equal(tuneForPitch(60, 72), 12)
  // A generated one-shot rarely lands on a semitone; the tune that lands it on a note is fractional
  // and that is CORRECT, not an error to round away (the recipe-song bass's -6.5).
  assert.equal(tuneForPitch(39.5, 33), -6.5)
  assert.equal(tuneForPitch(92.87, 81), -11.87)
})

test('rateForPitch gives the playback-rate multiplier an audio region wants', () => {
  assert.equal(rateForPitch(0, 0), 1)
  assert.equal(rateForPitch(0, 12), 2) // an octave up = double speed
  assert.equal(rateForPitch(0, -12), 0.5)
  // The recipe-song pad's hand-computed 0.9439 is exactly one semitone down.
  assert.equal(rateForPitch(0, -1), 0.9439)
  assert.equal(rateForPitch(60, 59), 0.9439)
})

// ---- planKeymap ---------------------------------------------------------------------------------

test('planKeymap walks the scale over the span and tunes each degree from the root', () => {
  const plan = planKeymap({ rootMidi: 93, scaleRootMidi: 81, scale: 'minorPentatonic', fromMidi: 81, toMidi: 93 })
  assert.deepEqual(plan.map((l) => l.name), ['a5', 'c6', 'd6', 'e6', 'g6', 'a6'])
  assert.deepEqual(plan.map((l) => l.tune), [-12, -9, -7, -5, -2, 0])
})

test('the scale root is independent of the sample root — a c-major span off an a4 sample', () => {
  // The recipe-song's bell happens to be an A6 sample mapped over an A scale; that coincidence must
  // not be baked in. Here an a4 sample plays a C-major span.
  const plan = planKeymap({ rootMidi: 69, scaleRootMidi: 60, scale: 'major', fromMidi: 60, toMidi: 72 })
  assert.deepEqual(plan.map((l) => l.name), ['c4', 'd4', 'e4', 'f4', 'g4', 'a4', 'b4', 'c5'])
  assert.deepEqual(plan.map((l) => l.tune), [-9, -7, -5, -4, -2, 0, 2, 3])
})

test('a fractional root produces fractional tunes that still land exactly on the notes', () => {
  const rootMidi = hzToMidi(1748.6) // 92.87 — bell_a's real dominant partial, not a round number
  const plan = planKeymap({ rootMidi, scaleRootMidi: 81, scale: 'minorPentatonic', fromMidi: 81, toMidi: 93 })
  for (const lane of plan) {
    // the whole promise: root + tune sounds the lane's own note
    assert.ok(Math.abs(rootMidi + lane.tune - lane.midi) < 1e-4, `${lane.name}: ${rootMidi} + ${lane.tune} != ${lane.midi}`)
  }
  assert.ok(plan.some((l) => !Number.isInteger(l.tune)), 'a between-notes sample should give fractional tunes')
})

test('a span wider than the -24..24 lane clamp errors, naming what IS reachable', () => {
  assert.throws(
    () => planKeymap({ rootMidi: 93, scaleRootMidi: 81, scale: 'minorPentatonic', fromMidi: 45, toMidi: 93 }),
    (e: Error) => {
      assert.ok(e instanceof BeatEditError)
      assert.match(e.message, /-24\.\.24 semitones/)
      assert.match(e.message, /only a4\.\.a8 is reachable/) // 93-24 = 69 = a4, 93+24 = 117 = a8
      assert.match(e.message, /needs -48/) // and names an offender
      return true
    },
  )
  // …and the boundary itself is allowed, not off-by-one.
  const edge = planKeymap({ rootMidi: 93, scaleRootMidi: 69, scale: 'chromatic', fromMidi: 69, toMidi: 117 })
  assert.equal(edge[0]!.tune, LANE_TUNE_MIN)
  assert.equal(edge[edge.length - 1]!.tune, LANE_TUNE_MAX)
})

test('an unknown scale lists the real ones; an inverted or empty span is refused', () => {
  assert.throws(() => planKeymap({ rootMidi: 93, scaleRootMidi: 81, scale: 'wonky', fromMidi: 81, toMidi: 93 }), /unknown scale "wonky" \(have: chromatic, major/)
  assert.throws(() => planKeymap({ rootMidi: 93, scaleRootMidi: 81, scale: 'minor', fromMidi: 93, toMidi: 81 }), /must run low to high/)
  // a span containing no scale tone at all
  assert.throws(() => planKeymap({ rootMidi: 93, scaleRootMidi: 81, scale: 'minorPentatonic', fromMidi: 82, toMidi: 83 }), /no minorPentatonic tones between/)
})

// ---- buildKeymap ---------------------------------------------------------------------------------

/** A minimal project shaped like what `beat add-track <id> drums` actually produces: the 12-lane
 * default kit, which is the open-lane model keymap needs. */
function project() {
  let doc = initDocument({ bpm: 96 })
  doc = addTrack(doc, { id: 'bells', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  doc = setMediaSample(doc, 'bell_a', 'a'.repeat(64), 'media/bell_a.wav')
  return doc
}

/** The sample backing of a named lane, or a failed assertion. */
function laneBacking(doc: BeatDocument, trackId: string, name: string): BeatLaneSampleBacking {
  const track = doc.tracks.find((t) => t.id === trackId)
  assert.ok(track && track.kind === 'drums', `no drums track "${trackId}"`)
  const lane = track.lanes.find((l) => l.name === name)
  assert.ok(lane, `no lane "${name}"`)
  assert.equal(lane.backing.type, 'sample')
  return lane.backing as BeatLaneSampleBacking
}

function laneNames(doc: BeatDocument, trackId: string): string[] {
  const track = doc.tracks.find((t) => t.id === trackId)
  assert.ok(track && track.kind === 'drums')
  return track.lanes.map((l) => l.name)
}

test('buildKeymap mints one sample-backed lane per scale degree', () => {
  const { doc, plan, added, rebacked } = buildKeymap(project(), 'bells', 'bell_a', {
    rootMidi: 93, scaleRootMidi: 81, scale: 'minorPentatonic', fromMidi: 81, toMidi: 93,
  })
  assert.equal(plan.length, 6)
  assert.deepEqual(added, ['a5', 'c6', 'd6', 'e6', 'g6', 'a6'])
  assert.deepEqual(rebacked, [])
  const a5 = laneBacking(doc, 'bells', 'a5')
  assert.equal(a5.sample, 'bell_a')
  assert.equal(a5.tune, -12)
  assert.equal(a5.gainDb, 0)
  // the point of the whole format: it is six diffable lines of text
  assert.match(serialize(doc), /lane a5 sample bell_a 0 -12/)
})

test('re-running with a better root RE-BACKS the same lanes instead of failing', () => {
  const first = buildKeymap(project(), 'bells', 'bell_a', { rootMidi: 92, scaleRootMidi: 81, scale: 'minorPentatonic', fromMidi: 81, toMidi: 93 })
  const second = buildKeymap(first.doc, 'bells', 'bell_a', { rootMidi: 93, scaleRootMidi: 81, scale: 'minorPentatonic', fromMidi: 81, toMidi: 93 })
  assert.deepEqual(second.added, [])
  assert.deepEqual(second.rebacked, ['a5', 'c6', 'd6', 'e6', 'g6', 'a6'])
  assert.equal(laneBacking(second.doc, 'bells', 'a5').tune, -12) // the BETTER root's tune won
  // no duplicate lanes piled up
  assert.equal(laneNames(second.doc, 'bells').filter((n) => n === 'a5').length, 1)
})

test('gainDb lands on every minted lane', () => {
  const { doc } = buildKeymap(project(), 'bells', 'bell_a', {
    rootMidi: 93, scaleRootMidi: 81, scale: 'minorPentatonic', fromMidi: 81, toMidi: 93, gainDb: -3,
  })
  assert.match(serialize(doc), /lane a5 sample bell_a -3 -12/)
})

test('an unregistered sample is refused before any lane is minted', () => {
  assert.throws(
    () => buildKeymap(project(), 'bells', 'nope', { rootMidi: 93, scaleRootMidi: 81, scale: 'minorPentatonic', fromMidi: 81, toMidi: 93 }),
    /no sample "nope" in the media block .* register it with beat sample first/,
  )
})

test('an out-of-range span leaves the document untouched — no half-built keymap', () => {
  const before = project()
  assert.throws(() => buildKeymap(before, 'bells', 'bell_a', { rootMidi: 93, scaleRootMidi: 81, scale: 'minorPentatonic', fromMidi: 45, toMidi: 93 }), /reachable/)
  assert.ok(!laneNames(before, 'bells').includes('a5'))
})

test('a keymap round-trips through serialize -> parse unchanged', () => {
  const { doc } = buildKeymap(project(), 'bells', 'bell_a', { rootMidi: hzToMidi(1748.6), scaleRootMidi: 81, scale: 'minorPentatonic', fromMidi: 81, toMidi: 93 })
  const text = serialize(doc)
  assert.equal(serialize(parse(text)), text)
})

// ---- the headline: reproduce examples/recipe-song's hand-written bell instrument -----------------

test('keymap reproduces examples/recipe-song\'s six hand-written bell lanes EXACTLY', () => {
  // These six lines are what the recipe-song's author hand-wrote after measuring bell_a with numpy
  // in a scratch heredoc. Reproducing them from one call is the entire premise of Stream VA.
  const recipe = readFileSync(join(repoRoot, 'examples', 'recipe-song', 'recipe.beat'), 'utf8')
  const handWritten = recipe.split('\n').filter((l) => /^\s+lane \w+ sample bell_a /.test(l)).map((l) => l.trim())
  assert.deepEqual(handWritten, [
    'lane a5 sample bell_a 0 -12',
    'lane c6 sample bell_a 0 -9',
    'lane d6 sample bell_a 0 -7',
    'lane e6 sample bell_a 0 -5',
    'lane g6 sample bell_a 0 -2',
    'lane a6 sample bell_a 0 0',
  ], 'the recipe-song\'s bells changed — this test\'s premise needs rechecking')

  // …and this is the one command: A minor pentatonic, a5..a6, rooted on the a6 the partial table
  // points at (bell_a reads LOW confidence, as a real bell should — hence --root, the first-class
  // path, not a fallback).
  const { doc } = buildKeymap(project(), 'bells', 'bell_a', {
    rootMidi: noteToMidi('a6'), scaleRootMidi: noteToMidi('a5'), scale: 'minorPentatonic', fromMidi: noteToMidi('a5'), toMidi: noteToMidi('a6'),
  })
  const minted = serialize(doc).split('\n').filter((l) => /^\s+lane \w+ sample bell_a /.test(l)).map((l) => l.trim())
  assert.deepEqual(minted, handWritten)
})

test('the root the refusal suggests for bell_a is the one that reproduces the song', () => {
  // The end-to-end honesty claim: detection does NOT trust itself on this bell, and the root it
  // hands the user is the one the song is actually built on. If these ever disagree, the copy-paste
  // the refusal advertises silently produces a wrong instrument.
  const { channels, sampleRate } = decodeWav(readFileSync(join(repoRoot, 'examples', 'recipe-song', 'media', 'bell_a.wav')))
  const pitch = detectPitch(channels, sampleRate)
  assert.equal(pitch.level, 'low')
  assert.equal(pitch.suggestedRootNote, 'a6')
  const { plan } = buildKeymap(project(), 'bells', 'bell_a', {
    rootMidi: noteToMidi(pitch.suggestedRootNote!), scaleRootMidi: noteToMidi('a5'), scale: 'minorPentatonic', fromMidi: noteToMidi('a5'), toMidi: noteToMidi('a6'),
  })
  assert.deepEqual(plan.map((l) => l.tune), [-12, -9, -7, -5, -2, 0])
})
