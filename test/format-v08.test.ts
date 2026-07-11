// v0.8 grammar tests — fully general drum hits (docs/format-v08-drums-design.md, research 12:
// every mature DAW stores drum events, the grid is a view). Under test: the hit grammar and
// validation, addHit/removeHit, drum-hit quantize, and the step-toggle sugar over hits.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse, serialize, addTrack, addHit, removeHit, quantizeNotes, setValue, initDocument, BeatEditError } from '../src/core/index.js'

function drumDoc() {
  return addTrack(initDocument({ trackId: 'lead', loopBars: 1 }), { id: 'drums', kind: 'drums' }).doc
}
const drumsOf = (d: ReturnType<typeof initDocument>) => d.tracks.find((t) => t.id === 'drums')!

test('addHit accepts free timing and mints h-ids; removeHit drops by id', () => {
  let doc = drumDoc()
  const a = addHit(doc, 'drums', { lane: 'kick', start: 0, velocity: 0.9 })
  doc = a.doc
  assert.equal(a.hit.id, 'h1')
  const b = addHit(doc, 'drums', { lane: 'snare', start: 4.5, velocity: 0.8 }) // off-grid
  doc = b.doc
  assert.equal(b.hit.id, 'h2')
  assert.equal(drumsOf(doc).hits.length, 2)
  assert.ok(drumsOf(doc).hits.some((h) => h.start === 4.5), 'off-grid start stored verbatim')
  doc = removeHit(doc, 'drums', 'h1').doc
  assert.deepEqual(drumsOf(doc).hits.map((h) => h.id), ['h2'])
})

test('hit validation fails loudly', () => {
  const doc = drumDoc()
  assert.throws(() => addHit(doc, 'drums', { lane: 'cowbell' as never, start: 0, velocity: 0.5 }), /unknown drum lane/)
  assert.throws(() => addHit(doc, 'drums', { lane: 'kick', start: -1, velocity: 0.5 }), /start must be/)
  assert.throws(() => addHit(doc, 'drums', { lane: 'kick', start: 0, velocity: 0 }), /velocity must be in \(0, 1\]/)
  assert.throws(() => addHit(initDocument({ trackId: 'lead' }), 'lead', { lane: 'kick', start: 0, velocity: 0.5 }), /hits only belong on drum tracks/)
  // grammar: hit start >= 0, velocity in (0,1]
  const text = `format_version 0.8\nbpm 120\nloop_bars 1\nselected_track drums\n\ntrack drums Drums #e06c75 drums\n  synth\n    osc sawtooth\n    volume -10\n    cutoff 12000\n    resonance 0.1\n    attack 0.01\n    decay 0.2\n    sustain 0.6\n    release 0.3\n    pan 0\n  hit k kick 0 1.5\n`
  assert.throws(() => parse(text), /hit velocity must be in \(0, 1\]/)
})

test('drum-hit quantize snaps starts toward the grid with an amount knob', () => {
  let doc = drumDoc()
  doc = addHit(doc, 'drums', { lane: 'snare', start: 4.5, velocity: 0.9, id: 'sn' }).doc
  // full quantize -> nearest grid step (4 or 5; 4.5 rounds to 5 via Math.round)
  const full = quantizeNotes(doc, 'drums', {})
  assert.equal(drumsOf(full.doc).hits.find((h) => h.id === 'sn')!.start, 5)
  // half amount -> halfway to the grid
  const half = quantizeNotes(doc, 'drums', { amount: 0.5 })
  assert.equal(drumsOf(half.doc).hits.find((h) => h.id === 'sn')!.start, 4.75)
  // ends quantize is meaningless for durationless hits
  assert.throws(() => quantizeNotes(doc, 'drums', { ends: true }), /no duration/)
})

test('the step-toggle sugar upserts/removes on-grid hits and rejects out-of-loop steps', () => {
  let doc = drumDoc() // loop_bars 1 -> 16 steps
  doc = setValue(doc, 'drums.pattern.kick[4]', '0.8')
  assert.deepEqual(drumsOf(doc).hits, [{ id: 'kick4', lane: 'kick', start: 4, velocity: 0.8 }])
  doc = setValue(doc, 'drums.pattern.kick[4]', '0') // 0 removes
  assert.equal(drumsOf(doc).hits.length, 0)
  assert.throws(() => setValue(doc, 'drums.pattern.kick[16]', '1'), /out of range/)
})
