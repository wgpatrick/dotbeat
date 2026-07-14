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

test('--clip targets a named clip; omitting it defaults to the track\'s first clip (pilot 104)', () => {
  // A track with TWO clips: c1 (first) and c2. Before the --clip selector, automation vary was
  // hardwired to the first clip, leaving c2's lane unreachable (pilot 104 finding 3).
  let doc = initDocument({ trackId: 'lead', loopBars: 2 })
  doc = addNote(doc, 'lead', { pitch: 60, start: 0, duration: 4, velocity: 0.8, id: 'n1' }).doc
  doc = saveClip(doc, 'lead', 'c1').doc
  doc = addNote(doc, 'lead', { pitch: 67, start: 8, duration: 4, velocity: 0.8, id: 'n2' }).doc
  doc = saveClip(doc, 'lead', 'c2').doc

  const laneOn = (v: { doc: typeof doc }, clipId: string) =>
    v.doc.tracks.find((t) => t.id === 'lead')!.clips.find((c) => c.id === clipId)!.automation.find((l) => l.param === 'cutoff')

  // default: first clip (c1) gets the lane, c2 stays untouched — prior behavior preserved.
  const dflt = varyAutomation(doc, 'lead', 'cutoff', { count: 2, seed: 5 })
  for (const v of dflt) {
    assert.ok(laneOn(v, 'c1'), 'default targets the first clip c1')
    assert.equal(laneOn(v, 'c2'), undefined, 'default leaves c2 alone')
    assert.match(v.recipe, /^automate-shape c1 cutoff /)
  }

  // --clip c2: the SECOND clip gets the lane, c1 stays untouched.
  const onC2 = varyAutomation(doc, 'lead', 'cutoff', { count: 2, seed: 5, clip: 'c2' })
  for (const v of onC2) {
    assert.ok(laneOn(v, 'c2'), '--clip c2 targets c2')
    assert.equal(laneOn(v, 'c1'), undefined, '--clip c2 leaves c1 alone')
    assert.match(v.recipe, /^automate-shape c2 cutoff /)
  }

  // a clip that isn't on the track errors cleanly (BeatVaryError), listing the real clips.
  assert.throws(() => varyAutomation(doc, 'lead', 'cutoff', { clip: 'nope' }), (err: unknown) => {
    assert.ok(err instanceof BeatVaryError)
    assert.match((err as Error).message, /no clip "nope" on track "lead" \(have: c1, c2\)/)
    return true
  })
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
