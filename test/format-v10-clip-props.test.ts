// v0.10 grammar tests — clip-level loop range + time signature (Phase 22 Stream AG,
// docs/phase-22-stream-ag.md). The contract under test: both fields are optional per clip
// (canonical elision — a clip with neither emits no lines and v0.9-and-earlier files parse
// unchanged), the grammar round-trips byte-identically, values are validated (fail loudly), the
// edit primitives (setClipLoop/setClipSignature, and the <track>.clip.<id>.loop/.signature
// setValue paths) mirror the automation primitives' add/clear shape, saveClip preserves an
// override on re-snapshot (like automation), and diffs read as musical facts.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parse,
  serialize,
  diffDocuments,
  formatDiff,
  addTrack,
  saveClip,
  setClipLoop,
  setClipSignature,
  setValue,
  describeDocument,
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

const CLIP_PROPS_EXAMPLE = `format_version 0.10
bpm 120
loop_bars 4
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    loop 0 4
    signature 3 4
    note n1 57 0 4 0.8
`

function docWithClip() {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead', loopBars: 4 }), { id: 'lead2', kind: 'synth' })
  const { doc } = saveClip(withTrack, 'lead', 'verse-a')
  return doc
}

// ---- grammar / round-trip ----------------------------------------------------------------------

test('the clip-properties example round-trips byte-identically', () => {
  const doc = parse(CLIP_PROPS_EXAMPLE)
  assert.equal(serialize(doc), CLIP_PROPS_EXAMPLE)
})

test('loop/signature parse into the expected shape', () => {
  const doc = parse(CLIP_PROPS_EXAMPLE)
  const clip = doc.tracks[0]!.clips[0]!
  assert.deepEqual(clip.loop, { start: 0, end: 4 })
  assert.deepEqual(clip.signature, { numerator: 3, denominator: 4 })
})

test('loop/signature lines come before note/hit/auto content (canonical order)', () => {
  const doc = parse(CLIP_PROPS_EXAMPLE)
  const text = serialize(doc)
  const loopIdx = text.indexOf('loop 0 4')
  const sigIdx = text.indexOf('signature 3 4')
  const noteIdx = text.indexOf('note n1')
  assert.ok(loopIdx < sigIdx && sigIdx < noteIdx, 'properties precede content')
})

// ---- elision: v0.9-and-earlier files parse unchanged --------------------------------------------

test('a clip with no loop/signature emits neither line (elision)', () => {
  const doc = docWithClip()
  const text = serialize(doc)
  assert.ok(!text.includes('loop '), 'no loop override was set, so no loop line should appear')
  assert.ok(!text.includes('signature '), 'no signature override was set, so no signature line should appear')
  const clip = doc.tracks.find((t) => t.id === 'lead')!.clips[0]!
  assert.equal(clip.loop, null)
  assert.equal(clip.signature, null)
})

test('v0.9 files (clips with no loop/signature grammar) parse unchanged', () => {
  const v09 = `format_version 0.9
bpm 124
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  clip verse-a
    note n1 60 0 4 0.8
  note u1 64 0 2 0.7
`
  const doc = parse(v09)
  const clip = doc.tracks[0]!.clips[0]!
  assert.equal(clip.loop, null)
  assert.equal(clip.signature, null)
  assert.equal(serialize(doc), v09)
})

// ---- grammar validation: fail loudly -------------------------------------------------------------

test('loop end must be > start', () => {
  const text = CLIP_PROPS_EXAMPLE.replace('loop 0 4', 'loop 4 4')
  assert.throws(() => parse(text), /loop end must be > start/)
})

test('loop start must be >= 0', () => {
  const text = CLIP_PROPS_EXAMPLE.replace('loop 0 4', 'loop -1 4')
  assert.throws(() => parse(text), /loop start must be >= 0/)
})

test('loop expects exactly 2 values', () => {
  const text = CLIP_PROPS_EXAMPLE.replace('loop 0 4', 'loop 0')
  assert.throws(() => parse(text), /loop expects exactly 2 values/)
})

test('a clip may not declare more than one loop line', () => {
  const text = CLIP_PROPS_EXAMPLE.replace('loop 0 4\n', 'loop 0 4\n    loop 1 5\n')
  assert.throws(() => parse(text), /more than one loop line/)
})

test('signature denominator must be one of the enumerated set', () => {
  const text = CLIP_PROPS_EXAMPLE.replace('signature 3 4', 'signature 3 3')
  assert.throws(() => parse(text), /signature denominator must be one of/)
})

test('signature numerator must be 1-32', () => {
  const text = CLIP_PROPS_EXAMPLE.replace('signature 3 4', 'signature 0 4')
  assert.throws(() => parse(text), /signature numerator must be 1-32/)
})

test('a clip may not declare more than one signature line', () => {
  const text = CLIP_PROPS_EXAMPLE.replace('signature 3 4\n', 'signature 3 4\n    signature 5 8\n')
  assert.throws(() => parse(text), /more than one signature line/)
})

test('BeatParseError is the thrown type on grammar violations', () => {
  const text = CLIP_PROPS_EXAMPLE.replace('loop 0 4', 'loop 4 4')
  assert.throws(() => parse(text), BeatParseError)
})

// ---- diff phrasing: musical, not textual --------------------------------------------------------

test('setting a clip loop diffs as a musical "clip-loop" entry', () => {
  const a = parse(CLIP_PROPS_EXAMPLE.replace('loop 0 4\n    ', ''))
  const b = parse(CLIP_PROPS_EXAMPLE)
  const entries = diffDocuments(a, b)
  assert.deepEqual(entries, [{ kind: 'clip-loop', trackId: 'lead', clipId: 'verse-a', before: null, after: { start: 0, end: 4 } }])
  assert.match(formatDiff(entries), /^lead: clip "verse-a" loop \(none\) -> 0-4\n$/)
})

test('changing a clip signature diffs as a musical "clip-signature" entry', () => {
  const a = parse(CLIP_PROPS_EXAMPLE)
  const b = parse(CLIP_PROPS_EXAMPLE.replace('signature 3 4', 'signature 6 8'))
  const entries = diffDocuments(a, b)
  assert.deepEqual(entries, [{ kind: 'clip-signature', trackId: 'lead', clipId: 'verse-a', before: { numerator: 3, denominator: 4 }, after: { numerator: 6, denominator: 8 } }])
  assert.match(formatDiff(entries), /^lead: clip "verse-a" signature 3\/4 -> 6\/8\n$/)
})

test('identical clip properties diff to no entries', () => {
  const a = parse(CLIP_PROPS_EXAMPLE)
  const b = parse(CLIP_PROPS_EXAMPLE)
  assert.deepEqual(diffDocuments(a, b), [])
})

// ---- edit primitives: setClipLoop / setClipSignature ---------------------------------------------

test('setClipLoop sets, updates, and clears the override', () => {
  let doc = docWithClip()
  doc = setClipLoop(doc, 'lead', 'verse-a', { start: 0, end: 4 })
  assert.deepEqual(doc.tracks[0]!.clips[0]!.loop, { start: 0, end: 4 })
  doc = setClipLoop(doc, 'lead', 'verse-a', { start: 1, end: 5 })
  assert.deepEqual(doc.tracks[0]!.clips[0]!.loop, { start: 1, end: 5 })
  doc = setClipLoop(doc, 'lead', 'verse-a', null)
  assert.equal(doc.tracks[0]!.clips[0]!.loop, null)
})

test('setClipLoop rejects end <= start, an unknown clip, and an unknown track', () => {
  const doc = docWithClip()
  assert.throws(() => setClipLoop(doc, 'lead', 'verse-a', { start: 2, end: 2 }), /loop end must be > start/)
  assert.throws(() => setClipLoop(doc, 'lead', 'verse-a', { start: -1, end: 2 }), /loop start must be >= 0/)
  assert.throws(() => setClipLoop(doc, 'lead', 'ghost', { start: 0, end: 1 }), /no clip "ghost"/)
  assert.throws(() => setClipLoop(doc, 'ghost', 'verse-a', { start: 0, end: 1 }), /no track "ghost"/)
})

test('setClipSignature sets, updates, and clears the override, validating the enumerated denominator set', () => {
  let doc = docWithClip()
  doc = setClipSignature(doc, 'lead', 'verse-a', { numerator: 3, denominator: 4 })
  assert.deepEqual(doc.tracks[0]!.clips[0]!.signature, { numerator: 3, denominator: 4 })
  doc = setClipSignature(doc, 'lead', 'verse-a', { numerator: 7, denominator: 8 })
  assert.deepEqual(doc.tracks[0]!.clips[0]!.signature, { numerator: 7, denominator: 8 })
  doc = setClipSignature(doc, 'lead', 'verse-a', null)
  assert.equal(doc.tracks[0]!.clips[0]!.signature, null)
  assert.throws(() => setClipSignature(doc, 'lead', 'verse-a', { numerator: 4, denominator: 3 }), /signature denominator must be one of/)
  assert.throws(() => setClipSignature(doc, 'lead', 'verse-a', { numerator: 0, denominator: 4 }), /signature numerator must be an integer 1-32/)
})

test('setClipSignature rejects a non-integer numerator/denominator instead of silently rounding (same stance as instrument tracks\' program field)', () => {
  const doc = docWithClip()
  assert.throws(() => setClipSignature(doc, 'lead', 'verse-a', { numerator: 3.5, denominator: 4 }), /signature numerator must be an integer/)
  assert.throws(() => setClipSignature(doc, 'lead', 'verse-a', { numerator: 3, denominator: 4.5 }), /signature denominator must be one of/)
})

// ---- setValue paths (the GUI /edit channel — <track>.clip.<id>.loop / .signature) ----------------

test('setValue <track>.clip.<id>.loop sets "<start> <end>" and clears on an empty value', () => {
  let doc = docWithClip()
  doc = setValue(doc, 'lead.clip.verse-a.loop', '0 4')
  assert.deepEqual(doc.tracks[0]!.clips[0]!.loop, { start: 0, end: 4 })
  doc = setValue(doc, 'lead.clip.verse-a.loop', '')
  assert.equal(doc.tracks[0]!.clips[0]!.loop, null)
})

test('setValue <track>.clip.<id>.signature sets "<num> <den>" and clears on an empty value', () => {
  let doc = docWithClip()
  doc = setValue(doc, 'lead.clip.verse-a.signature', '3 4')
  assert.deepEqual(doc.tracks[0]!.clips[0]!.signature, { numerator: 3, denominator: 4 })
  doc = setValue(doc, 'lead.clip.verse-a.signature', '')
  assert.equal(doc.tracks[0]!.clips[0]!.signature, null)
})

test('setValue clip loop/signature paths fail loudly on a malformed value', () => {
  const doc = docWithClip()
  assert.throws(() => setValue(doc, 'lead.clip.verse-a.loop', '0'), /expects "<start> <end>"/)
  assert.throws(() => setValue(doc, 'lead.clip.verse-a.signature', '3'), /expects "<numerator> <denominator>"/)
})

test('a stored document (via the edit primitives) deep-equals parse(serialize(doc))', () => {
  let doc = docWithClip()
  doc = setClipLoop(doc, 'lead', 'verse-a', { start: 0.5, end: 4.25 })
  doc = setClipSignature(doc, 'lead', 'verse-a', { numerator: 5, denominator: 8 })
  assert.deepEqual(parse(serialize(doc)), doc)
})

// ---- saveClip preserves loop/signature on re-snapshot --------------------------------------------

test('re-snapshotting a clip (saveClip) preserves its loop/signature overrides', () => {
  let doc = docWithClip()
  doc = setClipLoop(doc, 'lead', 'verse-a', { start: 0, end: 4 })
  doc = setClipSignature(doc, 'lead', 'verse-a', { numerator: 3, denominator: 4 })
  doc = saveClip(doc, 'lead', 'verse-a').doc // re-snapshot the same live content
  const clip = doc.tracks.find((t) => t.id === 'lead')!.clips[0]!
  assert.deepEqual(clip.loop, { start: 0, end: 4 }, 'loop override survives a re-snapshot')
  assert.deepEqual(clip.signature, { numerator: 3, denominator: 4 }, 'signature override survives a re-snapshot')
  const brandNew = saveClip(doc, 'lead', 'chorus-a').doc
  const fresh = brandNew.tracks.find((t) => t.id === 'lead')!.clips[1]!
  assert.equal(fresh.loop, null, 'a brand-new clip starts with no loop override')
  assert.equal(fresh.signature, null, 'a brand-new clip starts with no signature override')
})

// ---- inspect --------------------------------------------------------------------------------

test('describeDocument shows loop/signature summaries per clip', () => {
  const doc = parse(CLIP_PROPS_EXAMPLE)
  const text = describeDocument(doc)
  assert.match(text, /clips: verse-a \(1 note, loop 0-4, sig 3\/4\)/)
})

test('describeDocument omits the loop/signature summary for clips with neither', () => {
  const doc = docWithClip()
  const text = describeDocument(doc)
  assert.match(text, /clips: verse-a \(0 notes\)/)
  assert.ok(!text.includes('loop ') && !text.includes('sig '))
})
