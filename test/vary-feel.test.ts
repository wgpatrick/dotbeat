// varyFeel tests — rung 2 of the variation loop: batch humanized *feels* for auditioning
// (docs/product-spec-desktop.md §5.5). Under test: deterministic reproducible batches, distinct
// variants, lane scoping, recipe strings, and the count guard.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addTrack, addHit, initDocument, serialize } from '../src/core/index.js'
import { varyFeel } from '../src/vary/vary.js'

function gridDrums() {
  let doc = addTrack(initDocument({ trackId: 'lead', loopBars: 1 }), { id: 'drums', kind: 'drums' }).doc
  for (const step of [0, 2, 4, 6, 8, 10, 12, 14]) doc = addHit(doc, 'drums', { lane: 'hat', start: step, velocity: 0.6, id: `hat${step}` }).doc
  doc = addHit(doc, 'drums', { lane: 'kick', start: 0, velocity: 0.9, id: 'k0' }).doc
  return doc
}

test('varyFeel batches distinct, reproducible humanized variants', () => {
  const doc = gridDrums()
  const a = varyFeel(doc, 'drums', { count: 6, seed: 100, timing: 0.15 })
  const b = varyFeel(doc, 'drums', { count: 6, seed: 100, timing: 0.15 })
  assert.equal(a.length, 6)
  // reproducible: same options + seed -> byte-identical batch
  for (let i = 0; i < 6; i++) assert.equal(serialize(a[i]!.doc), serialize(b[i]!.doc))
  // distinct: no two variants are identical (each uses seed+i)
  const texts = new Set(a.map((v) => serialize(v.doc)))
  assert.equal(texts.size, 6, 'all six feels differ')
  // recipes name the seed
  assert.match(a[0]!.recipe, /humanize seed=100 timing=0\.15/)
  assert.match(a[5]!.recipe, /seed=105/)
})

test('varyFeel scopes to lanes (only the hats move)', () => {
  const doc = gridDrums()
  const variants = varyFeel(doc, 'drums', { count: 3, seed: 1, timing: 0.3, lanes: ['hat'] })
  for (const v of variants) {
    const kick = v.doc.tracks.find((t) => t.id === 'drums')!.hits.find((h) => h.id === 'k0')!
    assert.equal(kick.start, 0, 'kick untouched when scoped to hats')
    assert.match(v.recipe, /lanes=hat/)
  }
})

test('varyFeel validates count and lane scope', () => {
  const doc = gridDrums()
  assert.throws(() => varyFeel(doc, 'drums', { count: 99 }), /count must be 1-32/)
  assert.throws(() => varyFeel(doc, 'nope', {}), /no track/)
  assert.throws(() => varyFeel(doc, 'drums', { lanes: ['openhat'] }), /no hits on lane/)
})
