import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  parse,
  serialize,
  diffDocuments,
  formatDiff,
  setValue,
  addNote,
  removeNote,
  describeDocument,
  sandboxPayloadToBeatDocument,
  BeatEditError,
  type ExternalSandboxPayload,
  type BeatDocument,
} from '../src/core/index.js'

const fixturePath = fileURLToPath(new URL('./fixtures/real-sandbox.beatlab.json', import.meta.url))
const realPayload = JSON.parse(readFileSync(fixturePath, 'utf8')) as ExternalSandboxPayload
const realDoc = () => sandboxPayloadToBeatDocument(realPayload).doc

test('identical documents diff to an empty edit list', () => {
  assert.deepEqual(diffDocuments(realDoc(), realDoc()), [])
  assert.equal(formatDiff([]), 'no musical changes\n')
})

test('a single synth-param edit diffs to a single, precise entry', () => {
  const a = realDoc()
  const b = setValue(a, 'lead.cutoff', '900')
  const entries = diffDocuments(a, b)
  assert.deepEqual(entries, [{ kind: 'synth-param', trackId: 'lead', param: 'cutoff', before: 3200, after: 900 }])
  assert.equal(formatDiff(entries), 'lead: cutoff 3200 -> 900\n')
})

test('note add/remove/move all read as musical edits', () => {
  const a = realDoc()
  const added = addNote(a, 'lead', { pitch: 76, start: 12, duration: 2, velocity: 0.9 })
  const entriesAdd = diffDocuments(a, added.doc)
  assert.equal(entriesAdd.length, 1)
  assert.equal(entriesAdd[0]!.kind, 'note-added')
  assert.match(formatDiff(entriesAdd), /^lead: note added u\d+ \(pitch 76, start 12, dur 2, vel 0\.9\)\n$/)

  const removed = removeNote(a, 'lead', a.tracks.find((t) => t.id === 'lead')!.notes[0]!.id)
  assert.match(formatDiff(diffDocuments(a, removed.doc)), /^lead: note removed /)

  // a "moved" note: same id, different start — must be reported as a change, not remove+add
  const lead = a.tracks.find((t) => t.id === 'lead')!
  const firstNote = lead.notes[0]!
  const moved: BeatDocument = {
    ...a,
    tracks: a.tracks.map((t) =>
      t.id === 'lead' ? { ...t, notes: t.notes.map((n) => (n.id === firstNote.id ? { ...n, start: n.start + 4 } : n)) } : t,
    ),
  }
  const entriesMove = diffDocuments(a, moved)
  assert.equal(entriesMove.length, 1)
  assert.equal(entriesMove[0]!.kind, 'note-changed')
  assert.match(formatDiff(entriesMove), new RegExp(`^lead: note ${firstNote.id} start ${firstNote.start} -> ${firstNote.start + 4}\\n$`))
})

test('v0.8: the step-toggle sugar diffs to one hit add/remove', () => {
  const a = realDoc()
  const b = setValue(a, 'drums.pattern.kick[3]', '0.7') // step 3 empty -> adds hit kick3
  const entries = diffDocuments(a, b)
  assert.deepEqual(entries, [{ kind: 'hit-added', trackId: 'drums', hit: { id: 'kick3', lane: 'kick', start: 3, velocity: 0.7 } }])
  assert.equal(formatDiff(entries), 'drums: kick hit added kick3 (step 3, vel 0.7)\n')
  // and removing it phrases as removed
  const c = setValue(b, 'drums.pattern.kick[3]', '0')
  assert.equal(formatDiff(diffDocuments(b, c)), 'drums: kick hit removed kick3 (step 3)\n')
})

test('track rename does NOT produce false-positive note/pattern diffs (ID matching)', () => {
  const a = realDoc()
  const b = setValue(a, 'lead.name', 'Lead2')
  const entries = diffDocuments(a, b)
  assert.deepEqual(entries, [{ kind: 'track-meta', trackId: 'lead', field: 'name', before: 'Lead', after: 'Lead2' }])
})

test('track reorder reports moves, not remove+add avalanches', () => {
  const a = realDoc()
  const b: BeatDocument = { ...a, tracks: [...a.tracks.slice(1), a.tracks[0]!] } // drums to the end
  const entries = diffDocuments(a, b)
  assert.ok(entries.every((e) => e.kind === 'track-moved'))
  assert.ok(entries.some((e) => e.kind === 'track-moved' && e.trackId === 'drums'))
})

test('track added/removed summarize rather than exploding into per-note entries', () => {
  const a = realDoc()
  const b: BeatDocument = { ...a, tracks: a.tracks.filter((t) => t.id !== 'chords') }
  const entries = diffDocuments(a, b)
  assert.equal(entries.length, 1)
  assert.equal(formatDiff(entries), 'chords: track removed (synth "Chords")\n')
})

test('a multi-edit session diffs to a complete, readable edit list', () => {
  const a = realDoc()
  let b = setValue(a, 'bpm', '124')
  b = setValue(b, 'lead.cutoff', '900')
  b = setValue(b, 'drums.pattern.snare[7]', '0.6')
  b = addNote(b, 'bass', { pitch: 36, start: 0, duration: 4, velocity: 0.85, id: 'test1' }).doc
  const text = formatDiff(diffDocuments(a, b))
  assert.equal(
    text,
    ['bpm: 126 -> 124', 'drums: snare hit added snare7 (step 7, vel 0.6)', 'bass: note added test1 (pitch 36, start 0, dur 4, vel 0.85)', 'lead: cutoff 3200 -> 900'].join('\n') + '\n',
  )
})

// ---- edit primitives ------------------------------------------------------------------------

test('setValue is pure and canonical-serialization-compatible', () => {
  const a = realDoc()
  const b = setValue(a, 'lead.cutoff', '900')
  assert.equal(a.tracks.find((t) => t.id === 'lead')!.synth.cutoff, 3200, 'input document must be untouched')
  // the edited doc serializes with exactly one changed line vs the original
  const before = serialize(a).split('\n')
  const after = serialize(b).split('\n')
  assert.deepEqual(after.filter((l, i) => l !== before[i]), ['    cutoff 900'])
})

test('setValue rejects unknown tracks, params, lanes, out-of-range values', () => {
  const a = realDoc()
  assert.throws(() => setValue(a, 'nope.cutoff', '900'), BeatEditError)
  assert.throws(() => setValue(a, 'lead.wobble', '1'), BeatEditError)
  assert.throws(() => setValue(a, 'lead.osc', 'sinesquared'), BeatEditError)
  assert.throws(() => setValue(a, 'drums.pattern.cowbell[0]', '1'), BeatEditError)
  assert.throws(() => setValue(a, 'drums.pattern.kick[999]', '1'), BeatEditError)
  assert.throws(() => setValue(a, 'drums.pattern.kick[0]', '2'), BeatEditError)
  assert.throws(() => setValue(a, 'lead.pattern.kick[0]', '1'), BeatEditError, 'pattern edit on a synth track must fail')
  assert.throws(() => setValue(a, 'selected_track', 'ghost'), BeatEditError)
})

test('addNote mints non-colliding u-prefixed ids and validates ranges', () => {
  const a = realDoc()
  const one = addNote(a, 'lead', { pitch: 60, start: 0, duration: 1, velocity: 0.5 })
  const two = addNote(one.doc, 'lead', { pitch: 61, start: 1, duration: 1, velocity: 0.5 })
  assert.notEqual(one.note.id, two.note.id)
  assert.match(one.note.id, /^u\d+$/)
  assert.throws(() => addNote(a, 'drums', { pitch: 60, start: 0, duration: 1, velocity: 0.5 }), BeatEditError)
  assert.throws(() => addNote(a, 'lead', { pitch: 200, start: 0, duration: 1, velocity: 0.5 }), BeatEditError)
  assert.throws(() => addNote(one.doc, 'lead', { pitch: 60, start: 0, duration: 1, velocity: 0.5, id: one.note.id }), BeatEditError, 'explicit duplicate id must fail')
})

test('removeNote returns the removed note and rejects unknown ids', () => {
  const a = realDoc()
  const lead = a.tracks.find((t) => t.id === 'lead')!
  const { doc, note } = removeNote(a, 'lead', lead.notes[0]!.id)
  assert.equal(note.id, lead.notes[0]!.id)
  assert.equal(doc.tracks.find((t) => t.id === 'lead')!.notes.length, lead.notes.length - 1)
  assert.throws(() => removeNote(a, 'lead', 'ghost'), BeatEditError)
})

// ---- setValue note grammar (Phase 13 Stream B's `<track>.note` piano-roll primitive) ---------
// GUI note-add/move/resize/delete all round-trip through setValue's note grammar rather than a
// separate route; these mirror the equivalent addNote/removeNote-based assertions above but drive
// them through the string {path,value} surface the daemon's /edit route actually exposes.

test('setValue note-add grammar mints the same note addNote would, byte-for-byte', () => {
  const a = realDoc()
  const viaGrammar = setValue(a, 'lead.note', '76 12 2 0.9')
  const viaAddNote = addNote(a, 'lead', { pitch: 76, start: 12, duration: 2, velocity: 0.9 }).doc
  assert.deepEqual(viaGrammar, viaAddNote)
  const added = viaGrammar.tracks.find((t) => t.id === 'lead')!.notes.find((n) => !a.tracks.find((t) => t.id === 'lead')!.notes.some((orig) => orig.id === n.id))!
  assert.match(added.id, /^u\d+$/)
  assert.deepEqual(added, { id: added.id, pitch: 76, start: 12, duration: 2, velocity: 0.9, chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 })
})

test('setValue note.<id>.<field> moves/resizes exactly one field, leaving the rest untouched', () => {
  const a = realDoc()
  const added = setValue(a, 'lead.note', '76 12 2 0.9')
  const before = added.tracks.find((t) => t.id === 'lead')!.notes.find((n) => n.pitch === 76 && n.start === 12)!

  const moved = setValue(added, `lead.note.${before.id}.start`, '20')
  const afterStart = moved.tracks.find((t) => t.id === 'lead')!.notes.find((n) => n.id === before.id)!
  assert.deepEqual(afterStart, { ...before, start: 20 })

  const resized = setValue(moved, `lead.note.${before.id}.duration`, '4')
  const afterDuration = resized.tracks.find((t) => t.id === 'lead')!.notes.find((n) => n.id === before.id)!
  assert.deepEqual(afterDuration, { ...before, start: 20, duration: 4 })

  const transposed = setValue(resized, `lead.note.${before.id}.pitch`, '81')
  const afterPitch = transposed.tracks.find((t) => t.id === 'lead')!.notes.find((n) => n.id === before.id)!
  assert.deepEqual(afterPitch, { ...before, start: 20, duration: 4, pitch: 81 })

  const revelocitized = setValue(transposed, `lead.note.${before.id}.velocity`, '0.4')
  const afterVelocity = revelocitized.tracks.find((t) => t.id === 'lead')!.notes.find((n) => n.id === before.id)!
  assert.deepEqual(afterVelocity, { ...before, start: 20, duration: 4, pitch: 81, velocity: 0.4 })
})

test('setValue note.<id> with an empty value deletes the note', () => {
  const a = realDoc()
  const lead = a.tracks.find((t) => t.id === 'lead')!
  const targetId = lead.notes[0]!.id
  const deleted = setValue(a, `lead.note.${targetId}`, '')
  const leadAfter = deleted.tracks.find((t) => t.id === 'lead')!
  assert.equal(leadAfter.notes.length, lead.notes.length - 1)
  assert.ok(!leadAfter.notes.some((n) => n.id === targetId))
})

test('setValue note grammar rejects malformed adds, unknown note ids, and non-empty deletes', () => {
  const a = realDoc()
  const lead = a.tracks.find((t) => t.id === 'lead')!
  const realId = lead.notes[0]!.id
  // malformed add: wrong arity and non-numeric fields
  assert.throws(() => setValue(a, 'lead.note', '76 12 2'), BeatEditError)
  assert.throws(() => setValue(a, 'lead.note', '76 12 2 loud'), BeatEditError)
  assert.throws(() => setValue(a, 'lead.note', 'not a valid note at all'), BeatEditError)
  // unknown note id, both for a field edit and for delete
  assert.throws(() => setValue(a, 'lead.note.ghost.start', '4'), BeatEditError)
  assert.throws(() => setValue(a, 'lead.note.ghost', ''), BeatEditError)
  // delete requires an empty value
  assert.throws(() => setValue(a, `lead.note.${realId}`, '3'), BeatEditError)
  // notes only belong on synth/instrument tracks, not drums
  assert.throws(() => setValue(a, 'drums.note', '60 0 1 0.5'), BeatEditError)
})

// ---- inspect ---------------------------------------------------------------------------------

test('describeDocument gives a compact, exact overview of the real project', () => {
  const text = describeDocument(realDoc())
  assert.match(text, /^format 0\.11 \| 126 bpm \| 4 bars \(64 steps\) \| selected: drums\n/)
  assert.match(text, /tracks: 4\n/)
  assert.match(text, /^lead {2}"Lead" {2}synth/m)
  assert.match(text, /cutoff 3200 Hz/)
  // Phase 35 Stream OB: drums show a bus line (not a bogus synth: line), per-lane backing truth,
  // and a grid spanning the WHOLE 4-bar loop (four 16-step bars, space-separated) — not a silent
  // 16-step truncation.
  const drumsBlock = text.split('\n\n').find((b) => b.startsWith('drums '))
  assert.ok(drumsBlock, 'drums track block present')
  assert.ok(!/^ {2}synth: /m.test(drumsBlock), 'no synth: header line on the drums track')
  assert.match(text, /^ {2}bus: -10 dB, cutoff 9000 Hz, res 0\.8, pan 0$/m)
  assert.match(text, /^ {2}lanes: \(implicit legacy 5-lane kit\)$/m)
  assert.match(text, /^ {4}kick {4}synth:membrane$/m)
  assert.match(text, /^ {2}kick {4}[.xX]{16} [.xX]{16} [.xX]{16} [.xX]{16} {2}\(\d+ hits?\)$/m)
})
