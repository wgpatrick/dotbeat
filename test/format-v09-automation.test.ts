// v0.9 grammar tests — clip automation (docs/phase-9-automation-plan.md). The contract under
// test: automation is clip-scoped only, points have stable ids and canonical time ordering, the
// grammar round-trips byte-identically, a clip with no automation emits zero `auto` lines
// (v0.8 files parse unchanged), diffs read as musical facts (not textual noise), and the edit
// primitives mirror addNote/addHit's shape (add/remove/move, fail loudly on bad input).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parse,
  serialize,
  diffDocuments,
  formatDiff,
  addTrack,
  saveClip,
  addAutomationPoint,
  moveAutomationPoint,
  removeAutomationPoint,
  setAutomationPoint,
  describeDocument,
  sandboxPayloadToBeatDocument,
  beatDocumentToPartialTracks,
  initDocument,
  BeatParseError,
  BeatEditError,
  type ExternalSandboxPayload,
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

// The exact shape sketched in the phase-9 plan / task brief: a clip with a note and one
// automation lane carrying two points.
const AUTOMATION_EXAMPLE = `format_version 0.9
bpm 120
loop_bars 2
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    note n1 57 0 4 0.8
    auto lead.cutoff
      point p1 0 900
      point p2 2 3200
`

function docWithClip() {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead', loopBars: 2 }), { id: 'lead2', kind: 'synth' })
  const { doc } = saveClip(withTrack, 'lead', 'verse-a')
  return doc
}

// ---- grammar / round-trip ----------------------------------------------------------------------

test('the automation example round-trips byte-identically', () => {
  const doc = parse(AUTOMATION_EXAMPLE)
  assert.equal(serialize(doc), AUTOMATION_EXAMPLE)
})

test('automation parses into the expected shape: one lane, points in file order', () => {
  const doc = parse(AUTOMATION_EXAMPLE)
  const clip = doc.tracks[0]!.clips[0]!
  assert.equal(clip.id, 'verse-a')
  assert.equal(clip.automation.length, 1)
  assert.equal(clip.automation[0]!.param, 'cutoff')
  assert.deepEqual(clip.automation[0]!.points, [
    { id: 'p1', time: 0, value: 900 },
    { id: 'p2', time: 2, value: 3200 },
  ])
})

test('automation points serialize in canonical (time, id) order regardless of source order', () => {
  const text = `format_version 0.9
bpm 120
loop_bars 2
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    auto lead.cutoff
      point p2 2 3200
      point p1 0 900
`
  const doc = parse(text)
  const lane = doc.tracks[0]!.clips[0]!.automation[0]!
  // parsed order mirrors file order (like notes/hits — sorting is a SERIALIZE-time property)
  assert.deepEqual(lane.points.map((p) => p.id), ['p2', 'p1'])
  // re-serializing puts p1 (time 0) first, canonically
  const reserialized = serialize(doc)
  assert.match(reserialized, /point p1 0 900\n\s*point p2 2 3200/)
})

test('a clip may carry multiple automation lanes, one per param, in first-seen order', () => {
  const text = `format_version 0.9
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    auto lead.cutoff
      point p1 0 900
    auto lead.resonance
      point p1 0 0.2
`
  const doc = parse(text)
  const clip = doc.tracks[0]!.clips[0]!
  assert.deepEqual(clip.automation.map((l) => l.param), ['cutoff', 'resonance'])
  assert.equal(serialize(doc), text)
})

// ---- elision: v0.8 files parse unchanged -------------------------------------------------------

test('a clip with no automation emits zero auto lines (elision)', () => {
  const doc = docWithClip()
  const text = serialize(doc)
  assert.ok(!text.includes('auto '), 'no automation lane was added, so no auto line should appear')
  assert.equal(doc.tracks.find((t) => t.id === 'lead')!.clips[0]!.automation.length, 0)
})

test('v0.8 files (clips with notes/hits, no automation grammar) parse unchanged', () => {
  const v08 = `format_version 0.8
bpm 124
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    note n1 60 0 4 0.8
  note u1 64 0 2 0.7

track drums Drums #e35d5d drums
${CORE_SYNTH}
  clip beat-main
    hit h1 kick 0 0.9
`
  const doc = parse(v08)
  assert.equal(doc.tracks[0]!.clips[0]!.automation.length, 0)
  assert.equal(doc.tracks[1]!.clips[0]!.automation.length, 0)
  // byte-identical round trip — the v0.8 file is untouched by the v0.9 addition
  assert.equal(serialize(doc), v08)
})

test('an automation lane with zero point lines is rejected (no canonical form for an empty lane)', () => {
  const text = `format_version 0.9
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    auto lead.cutoff
`
  assert.throws(() => parse(text), /automation lane "cutoff" has no point lines/)
})

// ---- grammar validation: fail loudly -----------------------------------------------------------

test('auto target track must match the enclosing track', () => {
  const text = AUTOMATION_EXAMPLE.replace('auto lead.cutoff', 'auto other.cutoff')
  assert.throws(() => parse(text), /auto target track "other" must match the enclosing track "lead"/)
})

test('auto target must be <track>.<param>', () => {
  const text = AUTOMATION_EXAMPLE.replace('auto lead.cutoff', 'auto cutoff')
  assert.throws(() => parse(text), /auto target must be <track>\.<param>/)
})

test('auto rejects a non-automatable param (enum/bool/trackref fields, e.g. osc)', () => {
  const text = AUTOMATION_EXAMPLE.replace('auto lead.cutoff', 'auto lead.osc')
  assert.throws(() => parse(text), /"osc" is not an automatable synth param/)
})

test('duplicate automation lanes for the same param on one clip are rejected', () => {
  const text = `format_version 0.9
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    auto lead.cutoff
      point p1 0 900
    auto lead.cutoff
      point p2 2 3200
`
  assert.throws(() => parse(text), /duplicate automation lane "cutoff"/)
})

test('duplicate point ids within one lane are rejected', () => {
  const text = `format_version 0.9
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    auto lead.cutoff
      point p1 0 900
      point p1 2 3200
`
  assert.throws(() => parse(text), /duplicate automation point id "p1"/)
})

test('a level-2 "point" line (not inside an auto lane) is rejected as an unexpected clip keyword', () => {
  const text = `format_version 0.9
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    point p1 0 900
`
  assert.throws(() => parse(text), /unexpected keyword "point" inside a clip/)
})

test('a level-3 line with no open automation lane is rejected (BeatParseError)', () => {
  const text = `format_version 0.9
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    note n1 60 0 4 0.8
      point p1 0 900
`
  assert.throws(() => parse(text), /outside of an automation lane/)
  assert.throws(() => parse(text), BeatParseError)
})

// ---- diff phrasing: musical, not textual --------------------------------------------------------

test('adding an automation point diffs as a musical "point added" entry', () => {
  const a = parse(AUTOMATION_EXAMPLE)
  const b = parse(AUTOMATION_EXAMPLE.replace('      point p2 2 3200\n', '      point p2 2 3200\n      point p3 3 100\n'))
  const entries = diffDocuments(a, b)
  assert.deepEqual(entries, [{ kind: 'automation-point-added', trackId: 'lead', clipId: 'verse-a', param: 'cutoff', point: { id: 'p3', time: 3, value: 100 } }])
  assert.match(formatDiff(entries), /^lead: clip "verse-a" cutoff automation point added p3 \(step 3, value 100\)\n$/)
})

test('removing an automation point diffs as a musical "point removed" entry', () => {
  const a = parse(AUTOMATION_EXAMPLE)
  const b = parse(AUTOMATION_EXAMPLE.replace('      point p2 2 3200\n', ''))
  const entries = diffDocuments(a, b)
  assert.deepEqual(entries, [{ kind: 'automation-point-removed', trackId: 'lead', clipId: 'verse-a', param: 'cutoff', point: { id: 'p2', time: 2, value: 3200 } }])
  assert.match(formatDiff(entries), /point removed p2 \(step 2, value 3200\)/)
})

test('changing a point\'s value diffs as a value change, not a remove+add', () => {
  const a = parse(AUTOMATION_EXAMPLE)
  const b = parse(AUTOMATION_EXAMPLE.replace('point p2 2 3200', 'point p2 2 1800'))
  const entries = diffDocuments(a, b)
  assert.deepEqual(entries, [{ kind: 'automation-point-changed', trackId: 'lead', clipId: 'verse-a', param: 'cutoff', pointId: 'p2', changes: [{ field: 'value', before: 3200, after: 1800 }] }])
  assert.match(formatDiff(entries), /^lead: clip "verse-a" cutoff automation point p2 value 3200 -> 1800\n$/)
})

test('moving a point in time diffs as a time change', () => {
  const a = parse(AUTOMATION_EXAMPLE)
  const b = parse(AUTOMATION_EXAMPLE.replace('point p2 2 3200', 'point p2 3 3200'))
  const entries = diffDocuments(a, b)
  assert.deepEqual(entries, [{ kind: 'automation-point-changed', trackId: 'lead', clipId: 'verse-a', param: 'cutoff', pointId: 'p2', changes: [{ field: 'time', before: 2, after: 3 }] }])
})

test('identical automation diffs to no entries', () => {
  const a = parse(AUTOMATION_EXAMPLE)
  const b = parse(AUTOMATION_EXAMPLE)
  assert.deepEqual(diffDocuments(a, b), [])
})

// ---- edit primitives: add / remove / move (mirrors addNote/addHit) ------------------------------

test('addAutomationPoint mints p-ids scoped to the lane and creates the lane on first use', () => {
  let doc = docWithClip()
  const a = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0, value: 900 })
  doc = a.doc
  assert.equal(a.point.id, 'p1')
  const b = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 2, value: 3200 })
  doc = b.doc
  assert.equal(b.point.id, 'p2')
  const clip = doc.tracks.find((t) => t.id === 'lead')!.clips[0]!
  assert.equal(clip.automation.length, 1)
  assert.equal(clip.automation[0]!.points.length, 2)
})

test('addAutomationPoint rejects an unknown param, an unknown clip, a bad time/value, and a colliding id', () => {
  const doc = docWithClip()
  assert.throws(() => addAutomationPoint(doc, 'lead', 'verse-a', 'osc', { time: 0, value: 1 }), /not an automatable synth param/)
  assert.throws(() => addAutomationPoint(doc, 'lead', 'ghost', 'cutoff', { time: 0, value: 1 }), /no clip "ghost"/)
  assert.throws(() => addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: -1, value: 1 }), /time must be >= 0/)
  assert.throws(() => addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0, value: NaN }), /value must be a finite number/)
  const withPoint = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0, value: 900, id: 'p1' }).doc
  assert.throws(() => addAutomationPoint(withPoint, 'lead', 'verse-a', 'cutoff', { time: 1, value: 100, id: 'p1' }), /already exists/)
})

test('moveAutomationPoint updates time and/or value of an existing point', () => {
  let doc = docWithClip()
  doc = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0, value: 900, id: 'p1' }).doc
  doc = moveAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', 'p1', { time: 1 }).doc
  let point = doc.tracks.find((t) => t.id === 'lead')!.clips[0]!.automation[0]!.points[0]!
  assert.deepEqual(point, { id: 'p1', time: 1, value: 900 })
  doc = moveAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', 'p1', { value: 500 }).doc
  point = doc.tracks.find((t) => t.id === 'lead')!.clips[0]!.automation[0]!.points[0]!
  assert.deepEqual(point, { id: 'p1', time: 1, value: 500 })
  assert.throws(() => moveAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', 'ghost', { time: 2 }), /no automation point "ghost"/)
})

test('removeAutomationPoint drops the point, and drops the whole lane once it is the last point', () => {
  let doc = docWithClip()
  doc = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0, value: 900, id: 'p1' }).doc
  doc = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 2, value: 3200, id: 'p2' }).doc
  doc = removeAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', 'p1').doc
  let clip = doc.tracks.find((t) => t.id === 'lead')!.clips[0]!
  assert.equal(clip.automation.length, 1)
  assert.deepEqual(clip.automation[0]!.points.map((p) => p.id), ['p2'])
  doc = removeAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', 'p2').doc
  clip = doc.tracks.find((t) => t.id === 'lead')!.clips[0]!
  assert.deepEqual(clip.automation, [], 'an empty lane has no canonical form and is dropped entirely')
  assert.throws(() => removeAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', 'p2'), /no automation point "p2"/)
})

test('setAutomationPoint adds when the id is new and moves when the id already exists', () => {
  let doc = docWithClip()
  const added = setAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0, value: 900, id: 'p1' })
  doc = added.doc
  assert.equal(added.created, true)
  const moved = setAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 5, value: 1200, id: 'p1' })
  doc = moved.doc
  assert.equal(moved.created, false)
  const clip = doc.tracks.find((t) => t.id === 'lead')!.clips[0]!
  assert.deepEqual(clip.automation[0]!.points, [{ id: 'p1', time: 5, value: 1200 }])
})

test('a stored document (via the edit primitives) deep-equals parse(serialize(doc))', () => {
  let doc = docWithClip()
  doc = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0.12345, value: 900.00001 }).doc
  doc = addAutomationPoint(doc, 'lead', 'verse-a', 'resonance', { time: 1, value: 0.5 }).doc
  assert.deepEqual(parse(serialize(doc)), doc)
})

// ---- saveClip preserves automation on re-snapshot ------------------------------------------------

test('re-snapshotting a clip (saveClip) preserves its existing automation lanes', () => {
  let doc = docWithClip()
  doc = addAutomationPoint(doc, 'lead', 'verse-a', 'cutoff', { time: 0, value: 900 }).doc
  doc = saveClip(doc, 'lead', 'verse-a').doc // re-snapshot the same live content
  const clip = doc.tracks.find((t) => t.id === 'lead')!.clips[0]!
  assert.equal(clip.automation.length, 1, 'automation survives a re-snapshot')
  const brandNew = saveClip(doc, 'lead', 'chorus-a').doc
  assert.deepEqual(brandNew.tracks.find((t) => t.id === 'lead')!.clips[1]!.automation, [], 'a brand-new clip starts with no automation')
})

// ---- inspect --------------------------------------------------------------------------------

test('describeDocument shows automation lane/point counts per clip', () => {
  const doc = parse(AUTOMATION_EXAMPLE)
  const text = describeDocument(doc)
  assert.match(text, /clips: verse-a \(1 note, auto: cutoff\(2\)\)/)
})

test('describeDocument omits the auto summary for clips with no automation', () => {
  const doc = docWithClip()
  const text = describeDocument(doc)
  assert.match(text, /clips: verse-a \(0 notes\)/)
  assert.ok(!text.includes('auto:'))
})

// ---- convert.ts: beatlab clip automation now converts (was reported as dropped through v0.8) ----

function payloadWithAutomation(): ExternalSandboxPayload {
  return {
    v: 1,
    bpm: 120,
    loopBars: 1,
    selectedTrackId: 'lead',
    tracks: [
      {
        id: 'lead',
        name: 'Lead',
        color: '#c678dd',
        kind: 'synth',
        notes: [],
        synth: { osc: 'sawtooth', volume: -10, cutoff: 2000, resonance: 0.8, attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3, pan: 0 },
        clips: [
          {
            id: 'verse-a',
            notes: [],
            // unsorted on purpose — the converter must sort by time and mint stable ids
            automation: { cutoff: [{ time: 2, value: 3200 }, { time: 0, value: 900 }] },
          },
        ],
      },
    ],
  }
}

test('sandboxPayloadToBeatDocument converts clip automation instead of reporting it dropped', () => {
  const { doc, report } = sandboxPayloadToBeatDocument(payloadWithAutomation())
  const clip = doc.tracks.find((t) => t.id === 'lead')!.clips[0]!
  assert.equal(clip.automation.length, 1)
  assert.equal(clip.automation[0]!.param, 'cutoff')
  // sorted by time, ids minted in that order
  assert.deepEqual(clip.automation[0]!.points, [
    { id: 'p1', time: 0, value: 900 },
    { id: 'p2', time: 2, value: 3200 },
  ])
  assert.ok(!report.droppedFields.some((f) => f.includes('automation')), 'a known, automatable param must not be reported as dropped')
})

test('sandboxPayloadToBeatDocument reports automation for an unknown/non-automatable param as dropped', () => {
  const payload = payloadWithAutomation()
  payload.tracks[0]!.clips![0]!.automation = { arpRate: [{ time: 0, value: 1 }] }
  const { doc, report } = sandboxPayloadToBeatDocument(payload)
  const clip = doc.tracks.find((t) => t.id === 'lead')!.clips[0]!
  assert.equal(clip.automation.length, 0)
  assert.ok(report.droppedFields.includes('lead.verse-a.automation.arpRate'))
})

test('the converted document round-trips through .beat text byte-for-byte', () => {
  const { doc } = sandboxPayloadToBeatDocument(payloadWithAutomation())
  const text = serialize(doc)
  assert.equal(serialize(parse(text)), text)
})

test('beatDocumentToPartialTracks carries automation back out (ids stripped) for re-import', () => {
  const { doc } = sandboxPayloadToBeatDocument(payloadWithAutomation())
  const partial = beatDocumentToPartialTracks(doc)
  const clip = partial.tracks.find((t) => t.id === 'lead')!.clips![0]!
  assert.deepEqual(clip.automation, { cutoff: [{ time: 0, value: 900 }, { time: 2, value: 3200 }] })
})

test('beatDocumentToPartialTracks omits automation entirely for a clip that has none', () => {
  const doc = docWithClip()
  const partial = beatDocumentToPartialTracks(doc)
  const clip = partial.tracks.find((t) => t.id === 'lead')!.clips![0]!
  assert.equal('automation' in clip, false)
})
