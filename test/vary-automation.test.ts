// Phase 37 Stream RC — automation as a VARY TARGET. Under test: varyAutomation produces N variant
// docs each with a DIFFERING generated lane, is deterministic/reproducible under a seed, carries a
// replayable `automate-shape` recipe per variant (so it flows through the existing writeVaryBatch ->
// score -> adopt harness exactly like feel), and guards its inputs (no clips / bad count).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addNote, saveClip, initDocument, serialize } from '../src/core/index.js'
import { varyAutomation, BeatVaryError } from '../src/vary/vary.js'

function synthWithClip(loopBars = 2) {
  let doc = initDocument({ trackId: 'lead', loopBars })
  doc = addNote(doc, 'lead', { pitch: 60, start: 0, duration: 4, velocity: 0.8, id: 'n1' }).doc
  doc = addNote(doc, 'lead', { pitch: 64, start: 8, duration: 4, velocity: 0.8, id: 'n2' }).doc
  doc = saveClip(doc, 'lead', 'c1').doc
  return doc
}

test('varyAutomation makes N distinct variant docs, each with a generated cutoff lane', () => {
  const doc = synthWithClip()
  const variants = varyAutomation(doc, 'lead', 'cutoff', { count: 6, seed: 100 })
  assert.equal(variants.length, 6)
  // each variant's clip carries a cutoff automation lane
  for (const v of variants) {
    const lane = v.doc.tracks.find((t) => t.id === 'lead')!.clips.find((c) => c.id === 'c1')!.automation.find((l) => l.param === 'cutoff')
    assert.ok(lane && lane.points.length >= 2, 'variant has a cutoff lane')
    assert.match(v.recipe, /^automate-shape c1 cutoff (ramp|sine|triangle|exp|adsr) --from /)
  }
  // distinct: no two variant docs are byte-identical
  const texts = new Set(variants.map((v) => serialize(v.doc)))
  assert.equal(texts.size, 6, 'all six lanes differ')
})

test('varyAutomation is reproducible under a seed', () => {
  const doc = synthWithClip()
  const a = varyAutomation(doc, 'lead', 'cutoff', { count: 5, seed: 42 })
  const b = varyAutomation(doc, 'lead', 'cutoff', { count: 5, seed: 42 })
  for (let i = 0; i < 5; i++) {
    assert.equal(serialize(a[i]!.doc), serialize(b[i]!.doc), `variant ${i} byte-identical under same seed`)
    assert.equal(a[i]!.recipe, b[i]!.recipe)
  }
  // a different seed yields a different batch
  const c = varyAutomation(doc, 'lead', 'cutoff', { count: 5, seed: 999 })
  assert.notEqual(
    a.map((v) => v.recipe).join('|'),
    c.map((v) => v.recipe).join('|'),
    'different seed -> different movements',
  )
})

test('recipes carry --points and --bars when given', () => {
  const doc = synthWithClip()
  const variants = varyAutomation(doc, 'lead', 'cutoff', { count: 3, seed: 7, points: 24, bars: 4 })
  for (const v of variants) {
    assert.match(v.recipe, /--points 24/)
    assert.match(v.recipe, /--bars 4/)
    // 24-point lanes actually landed
    const lane = v.doc.tracks.find((t) => t.id === 'lead')!.clips.find((c) => c.id === 'c1')!.automation.find((l) => l.param === 'cutoff')!
    assert.equal(lane.points.length, 24)
  }
})

test('varyAutomation guards: no clips, missing track, count range, bad param', () => {
  // a track with no clips has nothing to automate
  const noClip = initDocument({ trackId: 'lead', loopBars: 2 })
  assert.throws(() => varyAutomation(noClip, 'lead', 'cutoff', { count: 3 }), /no clips/)
  const doc = synthWithClip()
  assert.throws(() => varyAutomation(doc, 'ghost', 'cutoff', {}), /no track "ghost"/)
  assert.throws(() => varyAutomation(doc, 'lead', 'cutoff', { count: 99 }), /count must be 1-32/)
  // a non-automatable param surfaces through applyAutomationShape's gate
  assert.throws(() => varyAutomation(doc, 'lead', 'osc', { count: 3 }), /not an automatable/)
})
