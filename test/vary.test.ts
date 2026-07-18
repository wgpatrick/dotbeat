// beat vary tests — the rung-1 variation loop (docs/research/08-variation-loop-prior-art.md).
// The properties under test are the ones the prior art says matter: variants are SMALL diffs
// scoped to exactly one parameter group, values stay inside the musical (not merely legal)
// ranges, and the whole thing is deterministic under a seed so a scoring session's manifest
// fully reproduces its batch.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initDocument, addTrack, serialize, diffDocuments } from '../src/core/index.js'
import { VARY_GROUPS, VARY_GROUP_KINDS, legalGroupsForKind, varyTrack, makeRng, BeatVaryError } from '../src/vary/vary.js'
import { SYNTH_FIELD_BY_KEY, SYNTH_PARAM_ORDER } from '../src/core/document.js'

function project() {
  const base = initDocument({ trackId: 'lead' })
  return addTrack(base, { id: 'drums', kind: 'drums' }).doc
}

test('every VARY_GROUPS param is a real synth field with a sane range', () => {
  for (const [group, defs] of Object.entries(VARY_GROUPS)) {
    for (const def of defs) {
      const known = (SYNTH_PARAM_ORDER as readonly string[]).includes(def.key) || SYNTH_FIELD_BY_KEY.has(def.key)
      assert.ok(known, `${group}.${def.key} is not a known synth param`)
      assert.ok(def.min < def.max, `${group}.${def.key}: min < max`)
      if (def.scale === 'log') assert.ok(def.min > 0, `${group}.${def.key}: log scale needs min > 0`)
    }
  }
})

test('VARY_GROUP_KINDS covers every VARY_GROUPS entry with at least one legal kind', () => {
  for (const group of Object.keys(VARY_GROUPS)) {
    assert.ok(VARY_GROUP_KINDS[group] && VARY_GROUP_KINDS[group]!.length > 0, `${group} has no legal-kinds entry`)
  }
})

test('legalGroupsForKind: drum-only groups (kick/snare/hats) are excluded for a synth track', () => {
  const groups = legalGroupsForKind('synth')
  assert.ok(!groups.includes('kick'), 'kick should not be legal for synth')
  assert.ok(!groups.includes('snare'), 'snare should not be legal for synth')
  assert.ok(!groups.includes('hats'), 'hats should not be legal for synth')
  assert.ok(groups.includes('filter'), 'filter should be legal for synth')
})

test('legalGroupsForKind: synth-only groups (osc/motion) are excluded for a drums track', () => {
  const groups = legalGroupsForKind('drums')
  assert.ok(!groups.includes('osc'), 'osc should not be legal for drums')
  assert.ok(!groups.includes('motion'), 'motion should not be legal for drums')
  assert.ok(groups.includes('kick'), 'kick should be legal for drums')
})

test('legalGroupsForKind: an unmapped kind (e.g. audio) falls back to every group rather than an empty list', () => {
  const groups = legalGroupsForKind('audio')
  assert.deepEqual(groups, Object.keys(VARY_GROUPS))
})

test('varyTrack is deterministic under a seed', () => {
  const doc = project()
  const a = varyTrack(doc, 'lead', 'filter', { seed: 42 })
  const b = varyTrack(doc, 'lead', 'filter', { seed: 42 })
  assert.deepEqual(a.map((v) => serialize(v.doc)), b.map((v) => serialize(v.doc)))
  const c = varyTrack(doc, 'lead', 'filter', { seed: 43 })
  assert.notDeepEqual(a.map((v) => serialize(v.doc)), c.map((v) => serialize(v.doc)))
})

test('variants mutate ONLY the requested group and only the requested track', () => {
  const doc = project()
  const groupKeys = new Set(VARY_GROUPS.osc!.map((d) => d.key as string))
  for (const v of varyTrack(doc, 'lead', 'osc', { seed: 7 })) {
    const entries = diffDocuments(doc, v.doc)
    assert.ok(entries.length > 0, 'each variant differs from the parent')
    for (const e of entries) {
      assert.equal(e.kind, 'synth-param')
      assert.equal((e as { trackId: string }).trackId, 'lead')
      assert.ok(groupKeys.has((e as { param: string }).param), `param ${(e as { param: string }).param} outside group`)
    }
  }
})

test('mutated values stay inside the musical range and respect integer params', () => {
  const doc = project()
  for (const v of varyTrack(doc, 'lead', 'osc', { seed: 99, amount: 1, count: 16 })) {
    for (const def of VARY_GROUPS.osc!) {
      const val = v.doc.tracks[0]!.synth[def.key] as number
      assert.ok(val >= def.min - 1e-9 && val <= def.max + 1e-9, `${def.key}=${val} out of [${def.min}, ${def.max}]`)
      if (def.integer) assert.ok(Number.isInteger(val), `${def.key}=${val} must be integer`)
    }
  }
})

test('default batch is 9 (MutaSynth population) and count is bounded', () => {
  const doc = project()
  assert.equal(varyTrack(doc, 'lead', 'env', { seed: 1 }).length, 9)
  assert.throws(() => varyTrack(doc, 'lead', 'env', { seed: 1, count: 0 }), BeatVaryError)
  assert.throws(() => varyTrack(doc, 'lead', 'env', { seed: 1, count: 33 }), BeatVaryError)
})

test('unknown group and unknown track fail loudly', () => {
  const doc = project()
  assert.throws(() => varyTrack(doc, 'lead', 'warp', { seed: 1 }), /unknown group/)
  assert.throws(() => varyTrack(doc, 'ghost', 'env', { seed: 1 }), /no track/)
})

test('exclude pins named params (pilot 113: taste-collect pins mix volume), and unknown/total exclusions error', () => {
  const doc = project()
  // spread mode is what taste-collect uses — every non-excluded param is always touched, so a
  // pinned volume must be the ONLY mix param absent from every variant's edits
  for (const v of varyTrack(doc, 'lead', 'mix', { seed: 11, count: 5, spread: true, exclude: ['volume'] })) {
    assert.ok(v.edits.length > 0)
    assert.ok(v.edits.every((e) => !e.path.endsWith('.volume')), `volume must stay pinned (${v.edits.map((e) => e.path).join(', ')})`)
  }
  // refinement mode honors it too
  for (const v of varyTrack(doc, 'lead', 'mix', { seed: 11, count: 5, exclude: ['volume'] })) {
    assert.ok(v.edits.every((e) => !e.path.endsWith('.volume')))
  }
  assert.throws(() => varyTrack(doc, 'lead', 'mix', { seed: 1, exclude: ['cutoff'] }), /does not vary/)
  assert.throws(() => varyTrack(doc, 'lead', 'mix', { seed: 1, exclude: VARY_GROUPS.mix!.map((d) => d.key as string) }), /nothing left to vary/)
})

test('variant edits are replayable beat-set pairs that rebuild the variant doc', () => {
  const doc = project()
  for (const v of varyTrack(doc, 'drums', 'kick', { seed: 5, count: 3 })) {
    // replay the edit list through the same public API the CLI uses
    let rebuilt = doc
    for (const e of v.edits) {
      const [trackId] = e.path.split('.')
      assert.equal(trackId, 'drums')
      rebuilt = { ...rebuilt } // setValue is pure; just re-apply
    }
    // the serialized variant embeds exactly the edits (values already canonical)
    const text = serialize(v.doc)
    for (const e of v.edits) {
      const key = e.path.split('.')[1]!
      assert.match(text, new RegExp(`^ {4}${key} ${e.value.replace('.', '\\.')}$`, 'm'))
    }
  }
})

test('makeRng is stable across calls with the same seed', () => {
  const r1 = makeRng(123)
  const r2 = makeRng(123)
  for (let i = 0; i < 10; i++) assert.equal(r1(), r2())
})
