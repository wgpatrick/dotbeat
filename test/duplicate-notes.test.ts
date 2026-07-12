// duplicateNotes tests — Phase 26 Stream DG (docs/phase-26-plan.md, research 57 item #2: "no
// duplicate-in-place or clipboard concept anywhere" in edit.ts). Under test: fresh-id minting
// (addNote's own `u<n>` scheme), the (offsetStart, offsetPitch) rigid-body delta, note-id
// scoping, originals-untouched, pitch clamping, and the fail-loudly edges (drums, unknown ids).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addNote, addTrack, initDocument, duplicateNotes, BeatEditError } from '../src/core/index.js'

function docWithNotes(notes: { pitch: number; start: number; duration: number; velocity?: number; id?: string }[]) {
  let doc = initDocument({ trackId: 'lead' })
  for (const n of notes) doc = addNote(doc, 'lead', { velocity: 0.8, ...n }).doc
  return doc
}

const lead = (doc: ReturnType<typeof initDocument>) => doc.tracks.find((t) => t.id === 'lead')!

test('duplicates every note on the track with fresh ids when unscoped', () => {
  const doc = docWithNotes([
    { id: 'a', pitch: 60, start: 0, duration: 2 },
    { id: 'b', pitch: 64, start: 4, duration: 2 },
  ])
  const { doc: next, added } = duplicateNotes(doc, 'lead', { offsetStart: 8 })
  assert.equal(added.length, 2)
  assert.equal(lead(next).notes.length, 4)
  // originals untouched
  const byId = Object.fromEntries(lead(next).notes.map((n) => [n.id, n]))
  assert.equal(byId.a!.start, 0)
  assert.equal(byId.b!.start, 4)
  // copies minted fresh (non-colliding) ids, offset by 8 steps, same pitch/duration
  for (const copy of added) {
    assert.notEqual(copy.id, 'a')
    assert.notEqual(copy.id, 'b')
  }
  const copyStarts = added.map((n) => n.start).sort((x, y) => x - y)
  assert.deepEqual(copyStarts, [8, 12])
})

test('note_ids scopes the duplicate to a selection', () => {
  const doc = docWithNotes([
    { id: 'a', pitch: 60, start: 0, duration: 2 },
    { id: 'b', pitch: 64, start: 4, duration: 2 },
  ])
  const { doc: next, added } = duplicateNotes(doc, 'lead', { noteIds: ['b'], offsetStart: 10 })
  assert.equal(added.length, 1)
  assert.equal(added[0]!.start, 14)
  assert.equal(added[0]!.pitch, 64)
  assert.equal(lead(next).notes.length, 3)
})

test('offsetPitch shifts pitch, clamped to MIDI 0-127', () => {
  const doc = docWithNotes([{ id: 'a', pitch: 120, start: 0, duration: 2 }])
  const { added } = duplicateNotes(doc, 'lead', { offsetStart: 2, offsetPitch: 20 })
  assert.equal(added[0]!.pitch, 127) // clamped, not an error
})

test('default offsets (both 0) duplicate exactly on top of the originals', () => {
  const doc = docWithNotes([{ id: 'a', pitch: 60, start: 3, duration: 2, velocity: 0.6 }])
  const { added } = duplicateNotes(doc, 'lead')
  assert.equal(added[0]!.start, 3)
  assert.equal(added[0]!.pitch, 60)
  assert.equal(added[0]!.velocity, 0.6)
})

test('copies preserve chance/cent/ratchet fields from the source note', () => {
  let doc = initDocument({ trackId: 'lead' })
  doc = addNote(doc, 'lead', { id: 'a', pitch: 60, start: 0, duration: 2, velocity: 0.8, chance: 40, cent: 12, ratchetCount: 3, ratchetCurve: 0.5, ratchetLength: 0.9 }).doc
  const { added } = duplicateNotes(doc, 'lead', { offsetStart: 4 })
  assert.equal(added[0]!.chance, 40)
  assert.equal(added[0]!.cent, 12)
  assert.equal(added[0]!.ratchetCount, 3)
  assert.equal(added[0]!.ratchetCurve, 0.5)
  assert.equal(added[0]!.ratchetLength, 0.9)
})

test('fail-loudly edges', () => {
  const doc = docWithNotes([{ id: 'a', pitch: 60, start: 0, duration: 2 }])
  assert.throws(() => duplicateNotes(doc, 'lead', { noteIds: ['ghost'] }), /no note\(s\) "ghost"/)
  assert.throws(() => duplicateNotes(doc, 'nope', {}), BeatEditError)

  const withDrums = addTrack(doc, { id: 'drums', kind: 'drums' }).doc
  assert.throws(() => duplicateNotes(withDrums, 'drums', {}), /drums track — duplicateNotes works on notes/)
})
