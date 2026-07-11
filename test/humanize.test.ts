// humanize tests — the generative-feel operator (docs/product-spec-desktop.md §5.5). Under
// test: deterministic seeded jitter on notes and hits, scope by ids, constant drag (push_late),
// swing on odd 16ths, round-trip safety (canonical values, starts >= 0), and the round-trip that
// quantize can undo what humanize did.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { humanize, quantizeNotes, addTrack, addHit, addNote, initDocument, serialize, parse, BeatHumanizeError } from '../src/core/index.js'

const drumsOf = (d: ReturnType<typeof initDocument>) => d.tracks.find((t) => t.id === 'drums')!

function gridDrums() {
  let doc = addTrack(initDocument({ trackId: 'lead', loopBars: 1 }), { id: 'drums', kind: 'drums' }).doc
  for (const step of [0, 4, 8, 12]) doc = addHit(doc, 'drums', { lane: 'hat', start: step, velocity: 0.7, id: `hat${step}` }).doc
  return doc
}

test('humanize is deterministic under a seed and moves events off the grid', () => {
  const doc = gridDrums()
  const a = humanize(doc, 'drums', { timing: 0.2, seed: 7 })
  const b = humanize(doc, 'drums', { timing: 0.2, seed: 7 })
  assert.equal(serialize(a.doc), serialize(b.doc), 'same seed -> identical result')
  assert.ok(a.changed > 0)
  assert.ok(drumsOf(a.doc).hits.some((h) => !Number.isInteger(h.start)), 'at least one hit is now off-grid')
  // a different seed gives a different result
  assert.notEqual(serialize(humanize(doc, 'drums', { timing: 0.2, seed: 8 }).doc), serialize(a.doc))
})

test('results are canonical and re-parse (starts stay >= 0)', () => {
  const doc = gridDrums()
  const { doc: h } = humanize(doc, 'drums', { timing: 0.5, pushLate: 0.3, seed: 3 })
  assert.equal(serialize(parse(serialize(h))), serialize(h), 'round-trips')
  assert.ok(drumsOf(h).hits.every((x) => x.start >= 0 && x.velocity > 0 && x.velocity <= 1))
})

test('push_late drags every event later; quantize can snap it back', () => {
  const doc = gridDrums()
  const { doc: dragged } = humanize(doc, 'drums', { timing: 0, velocity: 0, pushLate: 0.3, seed: 1 })
  for (const h of drumsOf(dragged).hits) assert.equal(h.start % 4 === 0 ? h.start : (h.start - 0.3), Math.round((h.start - 0.3) / 4) * 4)
  // full quantize returns them to the grid
  const { doc: snapped } = quantizeNotes(dragged, 'drums', {})
  assert.deepEqual(drumsOf(snapped).hits.map((h) => h.start).sort((a, b) => a - b), [0, 4, 8, 12])
})

test('swing pushes odd-step events later, leaves even ones', () => {
  let doc = addTrack(initDocument({ trackId: 'lead', loopBars: 1 }), { id: 'drums', kind: 'drums' }).doc
  doc = addHit(doc, 'drums', { lane: 'hat', start: 2, velocity: 0.7, id: 'even' }).doc // even step
  doc = addHit(doc, 'drums', { lane: 'hat', start: 3, velocity: 0.7, id: 'odd' }).doc // odd step
  const { doc: sw } = humanize(doc, 'drums', { timing: 0, velocity: 0, swing: 0.5, seed: 1 })
  assert.equal(drumsOf(sw).hits.find((h) => h.id === 'even')!.start, 2, 'even step unmoved')
  assert.equal(drumsOf(sw).hits.find((h) => h.id === 'odd')!.start, 3.25, 'odd step pushed by swing*0.5')
})

test('ids scope humanize to a selection', () => {
  const doc = gridDrums()
  const { doc: h, changed } = humanize(doc, 'drums', { timing: 0.3, seed: 5, ids: ['hat0', 'hat8'] })
  const byId = Object.fromEntries(drumsOf(h).hits.map((x) => [x.id, x]))
  assert.ok(changed <= 2)
  assert.equal(byId.hat4!.start, 4, 'unselected hit untouched')
  assert.equal(byId.hat12!.start, 12, 'unselected hit untouched')
})

test('humanize works on synth notes and fails loudly on empty options', () => {
  let doc = initDocument({ trackId: 'lead', loopBars: 1 })
  doc = addNote(doc, 'lead', { pitch: 60, start: 0, duration: 2, velocity: 0.8 }).doc
  const { changed } = humanize(doc, 'lead', { timing: 0.2, seed: 2 })
  assert.ok(changed >= 0)
  assert.throws(() => humanize(doc, 'lead', { timing: 0, velocity: 0 }), /nothing to humanize/)
  assert.throws(() => humanize(doc, 'nope', { timing: 0.1 }), BeatHumanizeError)
})
