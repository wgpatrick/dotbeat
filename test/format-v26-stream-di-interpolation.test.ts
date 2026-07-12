// Phase 26 Stream DI — curved automation segments: BeatAutomationPoint.interpolation
// ('linear' | 'hold' | 'curve', docs/phase-26-plan.md, docs/research/65-ableton-vs-dotbeat-
// automation-envelopes.md). Contract under test: the field is canonically elided when it's the
// 'linear' default (same discipline as v0.10's NOTE_FIELD_DEFAULTS trailing key=value tokens),
// a v0.9 file with no `interpolation=` tokens at all still round-trips byte-identically (this
// stream adds nothing required), and the edit primitives (add/move/set) thread the field through
// the same way they thread time/value, including the "omit on a move preserves the existing
// shape" contract moveAutomationPoint/setAutomationPoint document.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parse,
  serialize,
  addTrack,
  saveClip,
  addAutomationPoint,
  moveAutomationPoint,
  setAutomationPoint,
  initDocument,
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

function docWithClip() {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead', loopBars: 2 }), { id: 'lead2', kind: 'synth' })
  const { doc } = saveClip(withTrack, 'lead', 'verse-a')
  return doc
}

// ---- grammar / elision ---------------------------------------------------------------------

test('a v0.9 file with no interpolation tokens at all parses unchanged and round-trips byte-identically', () => {
  const text = `format_version 0.9
bpm 120
loop_bars 2
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    auto lead.cutoff
      point p1 0 900
      point p2 2 3200
`
  const doc = parse(text)
  assert.equal(doc.tracks[0]!.clips[0]!.automation[0]!.points[0]!.interpolation, undefined)
  assert.equal(serialize(doc), text)
})

test('interpolation=hold and interpolation=curve round-trip as trailing tokens', () => {
  const text = `format_version 0.9
bpm 120
loop_bars 2
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    auto lead.cutoff
      point p1 0 900 interpolation=hold
      point p2 2 3200 interpolation=curve
      point p3 4 100
`
  const doc = parse(text)
  const points = doc.tracks[0]!.clips[0]!.automation[0]!.points
  assert.equal(points[0]!.interpolation, 'hold')
  assert.equal(points[1]!.interpolation, 'curve')
  assert.equal(points[2]!.interpolation, undefined)
  assert.equal(serialize(doc), text)
})

test('an explicit "interpolation=linear" (the canonical default) parses fine but is elided on re-serialize', () => {
  const text = `format_version 0.9
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    auto lead.cutoff
      point p1 0 900 interpolation=linear
`
  const doc = parse(text)
  const point = doc.tracks[0]!.clips[0]!.automation[0]!.points[0]!
  assert.equal(point.interpolation, undefined, 'the canonical default is never actually stored on the point')
  const reserialized = serialize(doc)
  assert.ok(!reserialized.includes('interpolation='), 'a redundant default token silently canonicalizes away')
  assert.match(reserialized, /point p1 0 900\n/)
})

test('point rejects an unknown interpolation value', () => {
  const text = `format_version 0.9
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    auto lead.cutoff
      point p1 0 900 interpolation=bounce
`
  assert.throws(() => parse(text), /point interpolation must be one of linear\|hold\|curve/)
  assert.throws(() => parse(text), BeatParseError)
})

test('point rejects an unknown trailing field name (same discipline as note fields)', () => {
  const text = `format_version 0.9
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    auto lead.cutoff
      point p1 0 900 curve=1
`
  assert.throws(() => parse(text), /unknown point field "curve"/)
})

// ---- edit primitives -------------------------------------------------------------------------

test('addAutomationPoint accepts interpolation and canonically elides "linear"', () => {
  let doc = docWithClip()
  const hold = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0, value: 900, interpolation: 'hold' })
  doc = hold.doc
  assert.equal(hold.point.interpolation, 'hold')
  const linear = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 2, value: 100, interpolation: 'linear' })
  doc = linear.doc
  assert.equal(linear.point.interpolation, undefined, "'linear' is elided, not stored")
})

test('addAutomationPoint rejects an unknown interpolation value', () => {
  const doc = docWithClip()
  assert.throws(
    () => addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0, value: 900, interpolation: 'bounce' as never }),
    /interpolation must be one of linear\|hold\|curve/,
  )
  assert.throws(() => addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0, value: 900, interpolation: 'bounce' as never }), BeatEditError)
})

test('moveAutomationPoint can retarget just the interpolation, leaving time/value untouched', () => {
  let doc = docWithClip()
  doc = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0, value: 900, id: 'p1' }).doc
  doc = moveAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', 'p1', { interpolation: 'curve' }).doc
  let point = doc.tracks.find((t) => t.id === 'lead')!.clips[0]!.automation[0]!.points[0]!
  assert.deepEqual(point, { id: 'p1', time: 0, value: 900, interpolation: 'curve' })
  // omitting interpolation on a further move (time/value only) preserves the existing curve-shape
  doc = moveAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', 'p1', { time: 1 }).doc
  point = doc.tracks.find((t) => t.id === 'lead')!.clips[0]!.automation[0]!.points[0]!
  assert.deepEqual(point, { id: 'p1', time: 1, value: 900, interpolation: 'curve' })
  // explicitly moving back to 'linear' elides the field again
  doc = moveAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', 'p1', { interpolation: 'linear' }).doc
  point = doc.tracks.find((t) => t.id === 'lead')!.clips[0]!.automation[0]!.points[0]!
  assert.deepEqual(point, { id: 'p1', time: 1, value: 900 })
})

test('setAutomationPoint (a drag-style move) preserves the existing curve-shape when interpolation is omitted', () => {
  let doc = docWithClip()
  doc = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0, value: 900, id: 'p1', interpolation: 'hold' }).doc
  // a plain drag: time/value change, interpolation not mentioned at all
  const moved = setAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 3, value: 500, id: 'p1' })
  assert.equal(moved.created, false)
  assert.deepEqual(moved.point, { id: 'p1', time: 3, value: 500, interpolation: 'hold' })
})

test('setAutomationPoint adding a brand-new point with interpolation stores it', () => {
  const doc = docWithClip()
  const added = setAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0, value: 900, interpolation: 'curve' })
  assert.equal(added.created, true)
  assert.equal(added.point.interpolation, 'curve')
})

test('a stored document (via the edit primitives, mixed interpolations) deep-equals parse(serialize(doc))', () => {
  let doc = docWithClip()
  doc = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0, value: 900, interpolation: 'hold' }).doc
  doc = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 2, value: 1800, interpolation: 'curve' }).doc
  doc = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 4, value: 100 }).doc
  assert.deepEqual(parse(serialize(doc)), doc)
})

test('moveAutomationPoint still rejects an unknown point id and an unknown interpolation value', () => {
  let doc = docWithClip()
  doc = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0, value: 900, id: 'p1' }).doc
  assert.throws(() => moveAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', 'ghost', { interpolation: 'hold' }), /no automation point "ghost"/)
  assert.throws(
    () => moveAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', 'p1', { interpolation: 'bounce' as never }),
    /interpolation must be one of linear\|hold\|curve/,
  )
})
