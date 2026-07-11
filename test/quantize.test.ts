// Quantize tests — the Ableton model on top of v0.7 fractional timing (owner direction
// 2026-07-11: "free reign of both [start and length] — but you can also quantize them to the
// grid"). Under test: full and partial (amount) start-snap, grid sizes, end-snap adjusting
// duration, the one-grid-cell floor when an end collapses onto its start, note-id scoping,
// and the fail-loudly edges (drums, bad grid/amount, unknown ids).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addNote, addTrack, initDocument, quantizeNotes, BeatEditError } from '../src/core/index.js'

function docWithNotes(notes: { pitch: number; start: number; duration: number; velocity?: number; id?: string }[]) {
  let doc = initDocument({ trackId: 'lead' })
  for (const n of notes) doc = addNote(doc, 'lead', { velocity: 0.8, ...n }).doc
  return doc
}

const lead = (doc: ReturnType<typeof initDocument>) => doc.tracks.find((t) => t.id === 'lead')!

test('full quantize snaps starts to the 16th grid and preserves length', () => {
  const doc = docWithNotes([
    { id: 'a', pitch: 60, start: 3.4, duration: 1.5 },
    { id: 'b', pitch: 62, start: 7.6, duration: 0.7 },
    { id: 'c', pitch: 64, start: 12, duration: 2 }, // already on grid
  ])
  const { doc: q, changed } = quantizeNotes(doc, 'lead')
  assert.equal(changed, 2)
  const byId = Object.fromEntries(lead(q).notes.map((n) => [n.id, n]))
  assert.deepEqual([byId.a!.start, byId.a!.duration], [3, 1.5])
  assert.deepEqual([byId.b!.start, byId.b!.duration], [8, 0.7])
  assert.deepEqual([byId.c!.start, byId.c!.duration], [12, 2])
})

test('amount < 1 moves notes only part of the way (keeps feel)', () => {
  const doc = docWithNotes([{ id: 'a', pitch: 60, start: 3.4, duration: 1 }])
  const { doc: q } = quantizeNotes(doc, 'lead', { amount: 0.5 })
  assert.equal(lead(q).notes[0]!.start, 3.2) // halfway from 3.4 toward 3
})

test('grid sizes: 8ths (grid 2) and 32nds (grid 0.5)', () => {
  const doc = docWithNotes([{ id: 'a', pitch: 60, start: 3.4, duration: 1 }])
  assert.equal(lead(quantizeNotes(doc, 'lead', { grid: 2 }).doc).notes[0]!.start, 4)
  assert.equal(lead(quantizeNotes(doc, 'lead', { grid: 0.5 }).doc).notes[0]!.start, 3.5)
})

test('end quantize adjusts duration so the end lands on the grid', () => {
  const doc = docWithNotes([{ id: 'a', pitch: 60, start: 2, duration: 1.7 }]) // end 3.7
  const { doc: q } = quantizeNotes(doc, 'lead', { starts: false, ends: true })
  assert.deepEqual([lead(q).notes[0]!.start, lead(q).notes[0]!.duration], [2, 2]) // end -> 4
})

test('an end that snaps onto its own start keeps one grid cell of length', () => {
  const doc = docWithNotes([{ id: 'a', pitch: 60, start: 2, duration: 0.2 }]) // end 2.2 -> 2
  const { doc: q } = quantizeNotes(doc, 'lead', { starts: false, ends: true })
  assert.deepEqual([lead(q).notes[0]!.start, lead(q).notes[0]!.duration], [2, 1])
})

test('note_ids scopes the edit to a selection', () => {
  const doc = docWithNotes([
    { id: 'a', pitch: 60, start: 3.4, duration: 1 },
    { id: 'b', pitch: 62, start: 7.6, duration: 1 },
  ])
  const { doc: q, changed } = quantizeNotes(doc, 'lead', { noteIds: ['b'] })
  assert.equal(changed, 1)
  const byId = Object.fromEntries(lead(q).notes.map((n) => [n.id, n]))
  assert.equal(byId.a!.start, 3.4)
  assert.equal(byId.b!.start, 8)
})

test('quantize round-trips: result stores canonical values', () => {
  const doc = docWithNotes([{ id: 'a', pitch: 60, start: 3.4444, duration: 1 }])
  const { doc: q } = quantizeNotes(doc, 'lead', { amount: 0.3333 })
  const start = lead(q).notes[0]!.start
  assert.equal(start, Number(start.toFixed(4)))
})

test('fail-loudly edges', () => {
  const doc = docWithNotes([{ id: 'a', pitch: 60, start: 3.4, duration: 1 }])
  assert.throws(() => quantizeNotes(doc, 'lead', { grid: 0 }), /grid must be > 0/)
  assert.throws(() => quantizeNotes(doc, 'lead', { amount: 1.5 }), /amount must be 0\.\.1/)
  assert.throws(() => quantizeNotes(doc, 'lead', { starts: false }), /nothing to quantize/)
  assert.throws(() => quantizeNotes(doc, 'lead', { noteIds: ['ghost'] }), /no note\(s\) "ghost"/)
  assert.throws(() => quantizeNotes(doc, 'nope', {}), BeatEditError)
})

test('fresh drum tracks open the bus filter (hats survive; found via silent-hat render)', () => {
  const doc = initDocument({ trackId: 'lead' })
  const { track } = addTrack(doc, { id: 'drums', kind: 'drums' })
  assert.equal(track.synth.cutoff, 12000)
})
