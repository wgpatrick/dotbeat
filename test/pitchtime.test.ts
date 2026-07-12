// Pitch & Time operation tests (Phase 22 Stream AD; docs/research/18-ableton-ui-architecture.md's
// Clip View "Pitch & Time" row). Under test: transpose (shift + clamp), time-scale (x2/÷2,
// anchored), fit-to-scale (nearest tone + tie-break), invert (mirror + default axis), reverse
// (tape-reverse a span), legato (extend to next note), the note-id scoping every op shares, and
// consolidateRatchet (bake a ratchet back into exact discrete notes — the verification bar's
// "consolidate produces the exact expected discrete notes" requirement).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  addNote,
  addTrack,
  addHit,
  initDocument,
  setValue,
  transposeNotes,
  timeScaleNotes,
  fitToScaleNotes,
  invertNotes,
  reverseNotes,
  legatoNotes,
  consolidateRatchet,
  ratchetSlots,
  BeatPitchTimeError,
} from '../src/core/index.js'

function docWithNotes(notes: { pitch: number; start: number; duration: number; velocity?: number; id?: string }[]) {
  let doc = initDocument({ trackId: 'lead' })
  for (const n of notes) doc = addNote(doc, 'lead', { velocity: 0.8, ...n }).doc
  return doc
}

const lead = (doc: ReturnType<typeof initDocument>) => doc.tracks.find((t) => t.id === 'lead')!

// ---- transpose ----------------------------------------------------------------------------

test('transpose shifts every note by N semitones', () => {
  const doc = docWithNotes([{ pitch: 60, start: 0, duration: 1 }, { pitch: 64, start: 1, duration: 1 }])
  const { doc: t, changed } = transposeNotes(doc, 'lead', 3)
  assert.equal(changed, 2)
  assert.deepEqual(lead(t).notes.map((n) => n.pitch).sort((a, b) => a - b), [63, 67])
})

test('transpose clamps at MIDI 0 and 127 instead of erroring', () => {
  const doc = docWithNotes([{ pitch: 2, start: 0, duration: 1 }, { pitch: 125, start: 1, duration: 1 }])
  const { doc: t } = transposeNotes(doc, 'lead', -10)
  const down = lead(t).notes.find((n) => n.start === 0)!
  assert.equal(down.pitch, 0)
  const { doc: t2 } = transposeNotes(doc, 'lead', 10)
  const up = lead(t2).notes.find((n) => n.start === 1)!
  assert.equal(up.pitch, 127)
})

test('transpose scopes to noteIds and rejects an unknown id', () => {
  const doc = docWithNotes([{ pitch: 60, start: 0, duration: 1, id: 'a' }, { pitch: 64, start: 1, duration: 1, id: 'b' }])
  const { doc: t, changed } = transposeNotes(doc, 'lead', 5, { noteIds: ['a'] })
  assert.equal(changed, 1)
  assert.equal(lead(t).notes.find((n) => n.id === 'a')!.pitch, 65)
  assert.equal(lead(t).notes.find((n) => n.id === 'b')!.pitch, 64)
  assert.throws(() => transposeNotes(doc, 'lead', 1, { noteIds: ['ghost'] }), BeatPitchTimeError)
})

test('transpose refuses drum tracks and non-integer semitones', () => {
  let doc = addTrack(initDocument({ trackId: 'lead' }), { id: 'drums', kind: 'drums' }).doc
  doc = addHit(doc, 'drums', { lane: 'kick', start: 0, velocity: 0.8 }).doc
  assert.throws(() => transposeNotes(doc, 'drums', 2), BeatPitchTimeError)
  assert.throws(() => transposeNotes(docWithNotes([{ pitch: 60, start: 0, duration: 1 }]), 'lead', 1.5), BeatPitchTimeError)
})

// ---- time-scale ----------------------------------------------------------------------------

test('time-scale x2 doubles start/duration, anchored at the earliest scoped note', () => {
  const doc = docWithNotes([{ pitch: 60, start: 4, duration: 1 }, { pitch: 60, start: 6, duration: 2 }])
  const { doc: s } = timeScaleNotes(doc, 'lead', 2)
  const notes = lead(s).notes.sort((a, b) => a.start - b.start)
  // anchor = 4: note1 stays at 4 (dur 1->2); note2 starts at 4+(6-4)*2=8 (dur 2->4)
  assert.deepEqual(notes.map((n) => [n.start, n.duration]), [[4, 2], [8, 4]])
})

test('time-scale ÷2 halves start/duration, anchored the same way', () => {
  const doc = docWithNotes([{ pitch: 60, start: 0, duration: 4 }, { pitch: 60, start: 4, duration: 4 }])
  const { doc: s } = timeScaleNotes(doc, 'lead', 0.5)
  const notes = lead(s).notes.sort((a, b) => a.start - b.start)
  assert.deepEqual(notes.map((n) => [n.start, n.duration]), [[0, 2], [2, 2]])
})

test('time-scale rejects a non-positive factor', () => {
  const doc = docWithNotes([{ pitch: 60, start: 0, duration: 1 }])
  assert.throws(() => timeScaleNotes(doc, 'lead', 0), BeatPitchTimeError)
  assert.throws(() => timeScaleNotes(doc, 'lead', -1), BeatPitchTimeError)
})

// ---- fit-to-scale ----------------------------------------------------------------------------

test('fit-to-scale snaps out-of-scale pitches to the nearest tone (C major)', () => {
  // C# (61) is 1 semitone from both C (60) and D (62) — ties resolve to the LOWER pitch.
  const doc = docWithNotes([{ pitch: 61, start: 0, duration: 1 }, { pitch: 66, start: 1, duration: 1 }])
  const { doc: f, changed } = fitToScaleNotes(doc, 'lead', 0, 'major')
  assert.equal(changed, 2)
  const notes = lead(f).notes.sort((a, b) => a.start - b.start)
  assert.equal(notes[0]!.pitch, 60, 'C# ties toward C and D; the lower (C) wins')
  assert.equal(notes[1]!.pitch, 65, 'F# (66) is closer to F (65) than G (67)')
})

test('fit-to-scale leaves already-in-scale notes untouched (changed=0)', () => {
  const doc = docWithNotes([{ pitch: 60, start: 0, duration: 1 }, { pitch: 67, start: 1, duration: 1 }])
  const { changed } = fitToScaleNotes(doc, 'lead', 0, 'major')
  assert.equal(changed, 0)
})

test('fit-to-scale rejects an unknown scale name or out-of-range root', () => {
  const doc = docWithNotes([{ pitch: 60, start: 0, duration: 1 }])
  assert.throws(() => fitToScaleNotes(doc, 'lead', 0, 'not-a-scale'), BeatPitchTimeError)
  assert.throws(() => fitToScaleNotes(doc, 'lead', 12, 'major'), BeatPitchTimeError)
})

// ---- invert -----------------------------------------------------------------------------------

test('invert mirrors pitch around an explicit axis', () => {
  const doc = docWithNotes([{ pitch: 55, start: 0, duration: 1 }, { pitch: 65, start: 1, duration: 1 }])
  const { doc: inv } = invertNotes(doc, 'lead', 60)
  const notes = lead(inv).notes.sort((a, b) => a.start - b.start)
  assert.deepEqual(notes.map((n) => n.pitch), [65, 55])
})

test('invert defaults the axis to the scoped notes\' own mean pitch', () => {
  const doc = docWithNotes([{ pitch: 60, start: 0, duration: 1 }, { pitch: 64, start: 1, duration: 1 }])
  // mean = 62; 60 -> 2*62-60=64, 64 -> 2*62-64=60 (the pair swaps around its own center)
  const { doc: inv } = invertNotes(doc, 'lead', undefined)
  const notes = lead(inv).notes.sort((a, b) => a.start - b.start)
  assert.deepEqual(notes.map((n) => n.pitch), [64, 60])
})

test('invert clamps to MIDI 0-127', () => {
  const doc = docWithNotes([{ pitch: 5, start: 0, duration: 1 }])
  const { doc: inv } = invertNotes(doc, 'lead', 0)
  assert.equal(lead(inv).notes[0]!.pitch, 0)
})

// ---- reverse ------------------------------------------------------------------------------

test('reverse flips playback order within the scoped span (tape reverse)', () => {
  // span is [0, 6): note A [0,2), note B [4,6). Reversed: A now occupies what was B's end-aligned
  // slot and vice versa — durations preserved, positions mirrored around the span midpoint (3).
  const doc = docWithNotes([{ pitch: 60, start: 0, duration: 2, id: 'a' }, { pitch: 64, start: 4, duration: 2, id: 'b' }])
  const { doc: r, changed } = reverseNotes(doc, 'lead')
  assert.equal(changed, 2)
  const a = lead(r).notes.find((n) => n.id === 'a')!
  const b = lead(r).notes.find((n) => n.id === 'b')!
  assert.equal(a.start, 4, 'a (was first) now starts where b used to end')
  assert.equal(b.start, 0, 'b (was last) now starts at the span start')
  assert.equal(a.duration, 2)
  assert.equal(b.duration, 2)
})

test('reverse is its own inverse (reversing twice restores the original)', () => {
  const doc = docWithNotes([{ pitch: 60, start: 0, duration: 1, id: 'a' }, { pitch: 62, start: 1.5, duration: 0.5, id: 'b' }, { pitch: 64, start: 3, duration: 2, id: 'c' }])
  const once = reverseNotes(doc, 'lead').doc
  const twice = reverseNotes(once, 'lead').doc
  assert.deepEqual(
    lead(twice).notes.map((n) => [n.id, n.start, n.duration]).sort(),
    lead(doc).notes.map((n) => [n.id, n.start, n.duration]).sort(),
  )
})

// ---- legato -------------------------------------------------------------------------------

test('legato extends each note to the next note\'s start, leaves the last note alone', () => {
  const doc = docWithNotes([{ pitch: 60, start: 0, duration: 1, id: 'a' }, { pitch: 62, start: 4, duration: 1, id: 'b' }, { pitch: 64, start: 8, duration: 3, id: 'c' }])
  const { doc: l, changed } = legatoNotes(doc, 'lead')
  assert.equal(changed, 2)
  assert.equal(lead(l).notes.find((n) => n.id === 'a')!.duration, 4)
  assert.equal(lead(l).notes.find((n) => n.id === 'b')!.duration, 4)
  assert.equal(lead(l).notes.find((n) => n.id === 'c')!.duration, 3, 'last note is untouched')
})

test('legato honors a gap, leaving a small silence before the next note', () => {
  const doc = docWithNotes([{ pitch: 60, start: 0, duration: 1, id: 'a' }, { pitch: 62, start: 4, duration: 1, id: 'b' }])
  const { doc: l } = legatoNotes(doc, 'lead', { gap: 0.5 })
  assert.equal(lead(l).notes.find((n) => n.id === 'a')!.duration, 3.5)
})

// ---- consolidate (ratchet -> discrete notes) -----------------------------------------------

test('ratchetSlots divides a note\'s duration into count equal slots at curve=0', () => {
  const slots = ratchetSlots(4, 0, 1, 4)
  assert.deepEqual(slots.map((s) => [s.start, s.duration]), [
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
  ])
})

test('consolidateRatchet bakes a ratcheted note into exactly count discrete notes matching ratchetSlots', () => {
  let doc = docWithNotes([])
  doc = addNote(doc, 'lead', { pitch: 60, start: 2, duration: 4, velocity: 0.9, id: 'r1', ratchetCount: 4, ratchetCurve: 0, ratchetLength: 1 }).doc
  const { doc: c, changed } = consolidateRatchet(doc, 'lead')
  assert.equal(changed, 1)
  const notes = lead(c).notes.sort((a, b) => a.start - b.start)
  assert.equal(notes.length, 4, 'the original note is replaced by exactly ratchetCount notes')
  assert.ok(!notes.some((n) => n.id === 'r1'), 'the source note is removed')
  const expectedSlots = ratchetSlots(4, 0, 1, 4)
  assert.deepEqual(
    notes.map((n) => [n.start, n.duration]),
    expectedSlots.map((s) => [2 + s.start, s.duration]),
  )
  for (const n of notes) {
    assert.equal(n.pitch, 60)
    assert.equal(n.velocity, 0.9)
    assert.equal(n.ratchetCount, 1, 'consolidated notes are plain — no nested ratchet')
  }
})

test('consolidateRatchet copies chance/cent onto every resulting note', () => {
  let doc = docWithNotes([])
  doc = addNote(doc, 'lead', { pitch: 60, start: 0, duration: 2, velocity: 0.8, id: 'r1', ratchetCount: 2, chance: 70, cent: 12 }).doc
  const { doc: c } = consolidateRatchet(doc, 'lead')
  for (const n of lead(c).notes) {
    assert.equal(n.chance, 70)
    assert.equal(n.cent, 12)
  }
})

test('consolidateRatchet leaves non-ratcheted notes alone (changed=0, no-op)', () => {
  const doc = docWithNotes([{ pitch: 60, start: 0, duration: 1 }])
  const { doc: c, changed } = consolidateRatchet(doc, 'lead')
  assert.equal(changed, 0)
  assert.equal(c, doc, 'a true no-op returns the same document reference')
})

test('a note.<id>.ratchetCount/ratchetCurve/ratchetLength edit round-trips through beat set\'s note grammar', () => {
  const doc = docWithNotes([{ pitch: 60, start: 0, duration: 4, id: 'r1' }])
  let d = setValue(doc, 'lead.note.r1.ratchetCount', '3')
  d = setValue(d, 'lead.note.r1.ratchetCurve', '0.4')
  d = setValue(d, 'lead.note.r1.ratchetLength', '0.5')
  const n = lead(d).notes.find((x) => x.id === 'r1')!
  assert.equal(n.ratchetCount, 3)
  assert.equal(n.ratchetCurve, 0.4)
  assert.equal(n.ratchetLength, 0.5)
  // editing one field never resets the others (the addNote round-trip preserves siblings)
  const d2 = setValue(d, 'lead.note.r1.pitch', '64')
  const n2 = lead(d2).notes.find((x) => x.id === 'r1')!
  assert.equal(n2.ratchetCount, 3)
  assert.equal(n2.ratchetCurve, 0.4)
  assert.equal(n2.ratchetLength, 0.5)
})
