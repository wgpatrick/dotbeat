// Surge factory-patch curation (decisions.md D26): the PURE half — the z-score composite blend,
// the two hard gates, top-quartile selection with deterministic order, and the curated-file <->
// pickSurgePatch glue (including the CI-safe absent-file fallback). No surgepy, no renders: the
// render+score marathon that PRODUCES the file lives in scripts/curate-surge-patches.mjs and is
// exercised by the owner-gated pilot, not here.

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  CURATION_GATES,
  CURATION_BLEND,
  passesGates,
  zScores,
  toCompositeRow,
  compositeScores,
  curateRole,
  curatedKey,
  curatedKeysForRole,
  loadCuratedFile,
  type CurationCandidate,
  type CurationRawScores,
} from '../src/taste/surgeCuration.js'
import { pickSurgePatch, type SurgePatch } from '../src/taste/showdown.js'

const scores = (o: Partial<CurationRawScores>): CurationRawScores => ({
  ringDb: -60,
  activeFraction: 0.9,
  ce: 6,
  cu: 6,
  pc: 6,
  pq: 6,
  criticPessimistic: 0,
  ...o,
})

// ---- gates -------------------------------------------------------------------------------------

test('passesGates: rejects a ringy render (> -32 dB) and a mostly-silent one (< 0.5 active)', () => {
  assert.ok(passesGates(scores({})), 'a clean, present render passes')
  assert.ok(!passesGates(scores({ ringDb: -20 })), 'ring above -32 dB is rejected')
  assert.ok(passesGates(scores({ ringDb: -32 })), 'exactly -32 dB is on the keep side')
  assert.ok(!passesGates(scores({ activeFraction: 0.4 })), 'below 0.5 active is rejected')
  assert.ok(passesGates(scores({ activeFraction: 0.5 })), 'exactly 0.5 active is on the keep side')
  assert.equal(CURATION_GATES.ringDbMax, -32)
  assert.equal(CURATION_GATES.activeFractionMin, 0.5)
})

// ---- composite math ----------------------------------------------------------------------------

test('zScores: mean 0 / sd 1, and a degenerate (equal) column collapses to zeros', () => {
  const z = zScores([1, 2, 3, 4])
  const mean = z.reduce((a, b) => a + b, 0) / z.length
  assert.ok(Math.abs(mean) < 1e-12, 'mean ~ 0')
  const sd = Math.sqrt(z.reduce((a, b) => a + b * b, 0) / z.length)
  assert.ok(Math.abs(sd - 1) < 1e-9, 'sd ~ 1')
  assert.deepEqual(zScores([5, 5, 5]), [0, 0, 0], 'no contrast → all zeros, no NaN')
  assert.deepEqual(zScores([]), [])
})

test('toCompositeRow: aesQuality = CE+PQ, ring HEADROOM = -ringDb (cleaner scores higher)', () => {
  const r = toCompositeRow(scores({ ce: 7, pq: 5, ringDb: -50, activeFraction: 0.8, criticPessimistic: 1.2 }))
  assert.equal(r.aesQuality, 12)
  assert.equal(r.critic, 1.2)
  assert.equal(r.ringHeadroom, 50)
  assert.equal(r.active, 0.8)
})

test('compositeScores: aesthetics-weighted blend, weights sum to 1, aes+critic dominate', () => {
  const sum = CURATION_BLEND.aesQuality + CURATION_BLEND.critic + CURATION_BLEND.ringHeadroom + CURATION_BLEND.active
  assert.ok(Math.abs(sum - 1) < 1e-12, 'blend weights sum to 1')
  assert.ok(CURATION_BLEND.aesQuality + CURATION_BLEND.critic >= 0.7, 'the two aesthetics terms carry the weight')

  // three rows where row A leads on aes+critic, C trails on both — A must outscore C
  const rows = [
    toCompositeRow(scores({ ce: 8, pq: 8, criticPessimistic: 1.0, ringDb: -50, activeFraction: 0.9 })), // A
    toCompositeRow(scores({ ce: 6, pq: 6, criticPessimistic: 0.0, ringDb: -50, activeFraction: 0.9 })), // B
    toCompositeRow(scores({ ce: 4, pq: 4, criticPessimistic: -1.0, ringDb: -50, activeFraction: 0.9 })), // C
  ]
  const comps = compositeScores(rows)
  assert.ok(comps[0]! > comps[1]! && comps[1]! > comps[2]!, 'monotonic in aes+critic when cleanliness ties')

  // cleanliness breaks a tie: identical aes/critic, one cleaner (more ring headroom) wins
  const tie = [
    toCompositeRow(scores({ ce: 6, pq: 6, criticPessimistic: 0, ringDb: -70, activeFraction: 0.95 })),
    toCompositeRow(scores({ ce: 6, pq: 6, criticPessimistic: 0, ringDb: -40, activeFraction: 0.6 })),
  ]
  const tc = compositeScores(tie)
  assert.ok(tc[0]! > tc[1]!, 'cleaner + more active render wins the aes/critic tie')
})

// ---- selection ---------------------------------------------------------------------------------

const cand = (name: string, category: string, s: Partial<CurationRawScores>): CurationCandidate => ({
  name,
  category,
  relPath: `${category}/${name}.fxp`,
  scores: scores(s),
})

test('curateRole: gates first, then top quartile of survivors in deterministic order', () => {
  const candidates: CurationCandidate[] = [
    cand('Best', 'Basses', { ce: 9, pq: 9, criticPessimistic: 2 }),
    cand('Good', 'Basses', { ce: 7, pq: 7, criticPessimistic: 1 }),
    cand('Mid', 'Basses', { ce: 6, pq: 6, criticPessimistic: 0 }),
    cand('Meh', 'Basses', { ce: 5, pq: 5, criticPessimistic: -0.5 }),
    cand('Weak', 'Basses', { ce: 4, pq: 4, criticPessimistic: -1 }),
    cand('Poor', 'Basses', { ce: 3, pq: 3, criticPessimistic: -1.5 }),
    cand('Bad', 'Basses', { ce: 2, pq: 2, criticPessimistic: -2 }),
    cand('Worst', 'Basses', { ce: 1, pq: 1, criticPessimistic: -2.5 }),
    // gated out — never a survivor regardless of aesthetics
    cand('Ringy', 'Basses', { ce: 10, pq: 10, criticPessimistic: 3, ringDb: -10 }),
    cand('Silent', 'Basses', { ce: 10, pq: 10, criticPessimistic: 3, activeFraction: 0.1 }),
  ]
  const { survivors, kept } = curateRole(candidates)
  assert.equal(survivors, 8, 'the two gated patches are excluded from the survivor count')
  assert.equal(kept.length, 2, 'ceil(8 * 0.25) = 2 kept')
  assert.equal(kept[0]!.name, 'Best', 'best composite first')
  assert.equal(kept[1]!.name, 'Good')
  assert.ok(!kept.some((k) => k.name === 'Ringy' || k.name === 'Silent'), 'gated patches never survive')
  // deterministic: same input → same order
  const again = curateRole(candidates)
  assert.deepEqual(again.kept.map((k) => k.name), kept.map((k) => k.name))
})

test('curateRole: empty when nothing clears the gates; keeps >=1 when any survive', () => {
  const allGated = [cand('R', 'Basses', { ringDb: -5 }), cand('S', 'Basses', { activeFraction: 0 })]
  assert.deepEqual(curateRole(allGated), { survivors: 0, kept: [] })
  const one = curateRole([cand('Solo', 'Basses', {})])
  assert.equal(one.survivors, 1)
  assert.equal(one.kept.length, 1, 'ceil(1 * 0.25) = 1 — never curates a non-empty pool to zero')
})

// ---- curated-file <-> pick glue -----------------------------------------------------------------

test('curatedKey: stable, case-insensitive (category, name) identity', () => {
  assert.equal(curatedKey('Basses', 'Deep Sub'), curatedKey('basses', 'deep sub'))
  assert.notEqual(curatedKey('Basses', 'Deep Sub'), curatedKey('Leads', 'Deep Sub'))
})

test('loadCuratedFile: null on absent/malformed; parsed object otherwise (CI-safe fallback)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surge-curated-'))
  try {
    assert.equal(loadCuratedFile(join(dir, 'nope.json')), null, 'absent file → null')
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, '{ not json')
    assert.equal(loadCuratedFile(bad), null, 'malformed JSON → null')
    const noRoles = join(dir, 'noroles.json')
    writeFileSync(noRoles, JSON.stringify({ version: 1 }))
    assert.equal(loadCuratedFile(noRoles), null, 'missing roles map → null')
    const good = join(dir, 'good.json')
    writeFileSync(good, JSON.stringify({ version: 1, roles: { bassline: { pool: 10, survivors: 4, kept: [] } } }))
    assert.ok(loadCuratedFile(good)?.roles.bassline, 'well-formed file parses')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('curatedKeysForRole: null when the role has no curated entries, a Set otherwise', () => {
  assert.equal(curatedKeysForRole(null, 'bassline'), null, 'no file → null')
  const file = {
    version: 1,
    generatedAt: '',
    probe: {},
    blend: CURATION_BLEND,
    gates: CURATION_GATES,
    roles: {
      bassline: { pool: 5, survivors: 2, kept: [{ name: 'Deep Sub', category: 'Basses', relPath: 'Basses/Deep Sub.fxp', scores: scores({}), composite: 1.2 }] },
      lead: { pool: 5, survivors: 0, kept: [] },
    },
  }
  const keys = curatedKeysForRole(file, 'bassline')
  assert.ok(keys && keys.has(curatedKey('Basses', 'Deep Sub')))
  assert.equal(curatedKeysForRole(file, 'lead'), null, 'empty kept → null')
  assert.equal(curatedKeysForRole(file, 'chords'), null, 'missing role → null')
})

// ---- pickSurgePatch curated draw ---------------------------------------------------------------

const patch = (name: string, category: string): SurgePatch => ({ name, category, path: `/f/patches_factory/${category}/${name}.fxp` })

test('pickSurgePatch: curatedKeys narrows the draw to the curated pool, falls back when absent', () => {
  const patches: SurgePatch[] = [
    patch('Deep Sub', 'Basses'),
    patch('Acid Line', 'Basses'),
    patch('Fat Reese', 'Basses'),
    patch('Warm Pad', 'Pads'),
  ]
  // curate to a single bassline patch → every seed must land on it
  const only = new Set([curatedKey('Basses', 'Fat Reese')])
  for (const seed of [1, 2, 3, 100, 777, 99999]) {
    assert.equal(pickSurgePatch(patches, 'bassline', seed, { curatedKeys: only })!.name, 'Fat Reese', `seed ${seed} respects the curated pool`)
  }
  // empty Set → full pool (unchanged from the no-opts behavior)
  const emptyKeys = new Set<string>()
  assert.equal(
    pickSurgePatch(patches, 'bassline', 777, { curatedKeys: emptyKeys })!.name,
    pickSurgePatch(patches, 'bassline', 777)!.name,
    'empty curated Set is the same as no curation',
  )
  // null → full pool
  assert.equal(
    pickSurgePatch(patches, 'bassline', 777, { curatedKeys: null })!.name,
    pickSurgePatch(patches, 'bassline', 777)!.name,
  )
  // curated keys that match NO role patch (file built against other factory content) → full pool,
  // never null
  const foreign = new Set([curatedKey('Basses', 'Does Not Exist')])
  const picked = pickSurgePatch(patches, 'bassline', 777, { curatedKeys: foreign })
  assert.ok(picked && picked.category === 'Basses', 'no curated match → full role pool, not null')
})

test('pickSurgePatch: a curated pick is still deterministic and enumeration-order-independent', () => {
  const patches: SurgePatch[] = [patch('A', 'Basses'), patch('B', 'Basses'), patch('C', 'Basses')]
  const keys = new Set([curatedKey('Basses', 'A'), curatedKey('Basses', 'C')])
  const a = pickSurgePatch(patches, 'bassline', 55, { curatedKeys: keys })
  const b = pickSurgePatch([...patches].reverse(), 'bassline', 55, { curatedKeys: keys })
  assert.ok(a && b && a.name === b.name, 'stable across enumeration order')
  assert.ok(a!.name === 'A' || a!.name === 'C', 'the pick is inside the curated pool')
})
