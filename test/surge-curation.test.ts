// Surge factory-patch curation (decisions.md D26): the PURE half — the z-score composite blend,
// the two hard gates, top-quartile selection with deterministic order, and the curated-file <->
// pickSurgePatch glue (including the CI-safe absent-file fallback). No surgepy, no renders: the
// render+score marathon that PRODUCES the file lives in scripts/curate-surge-patches.mjs and is
// exercised by the owner-gated pilot, not here.

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  CURATION_GATES,
  CURATION_GATES_BY_ROLE,
  gatesForRole,
  CURATION_BLEND,
  passesGates,
  zScores,
  toCompositeRow,
  compositeScores,
  curateRole,
  curatedKey,
  curatedKeysForRole,
  loadCuratedFile,
  SURGE_ROLE_CATEGORIES_V2,
  surgeRoleCategoriesV2,
  bandFit,
  paramFit,
  roleParamTargets,
  PARAM_FIT_WEIGHTS,
  SHOWDOWN_ROLE_TO_STAT_ROLE,
  type CurationCandidate,
  type CurationRawScores,
} from '../src/taste/surgeCuration.js'
import { pickSurgePatch, patchInCategories, SURGE_ROLE_CATEGORIES, type SurgePatch } from '../src/taste/showdown.js'

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
  // These two pins are a CHANGE-DETECTOR on a screen, not a frozen-science assertion. Research/140
  // §4.3 found that a bare `===` here had made the gate feel frozen — the same guardrail that
  // rightly protects engineplusProfile was being read onto a value that invalidates nothing
  // historical, and a measurably wrong threshold sat for a week because of it. Changing these is
  // allowed; changing them WITHOUT re-measuring is not. See CURATION_GATES_BY_ROLE for the
  // calibrated replacements and the pool measurement behind them.
  assert.equal(CURATION_GATES.ringDbMax, -32)
  assert.equal(CURATION_GATES.activeFractionMin, 0.5)
})

test('per-role gates loosen the ring threshold where the reference class demands it (134 §5)', () => {
  // 134 §2.2 measured the role-blind -32 dB gate rejecting 22% of the owner's own Splice lead loops
  // and 16% of chords — "the screens reject the quality bar itself". Re-measured 2026-07-26 over the
  // cleaned pools (lead 21.8%, chords 15.6%, bassline 0%), then recalibrated by 134 §5's own rule:
  // each role's threshold is max(-32, p95 of that role's pack-loop ringDb) — loosen, never tighten.
  assert.ok(
    CURATION_GATES_BY_ROLE.lead.ringDbMax > CURATION_GATES.ringDbMax,
    'lead must be looser than the role-blind gate — 134: "lead needs >> -32"',
  )
  assert.ok(CURATION_GATES_BY_ROLE.chords.ringDbMax > CURATION_GATES.ringDbMax, 'chords likewise')
  assert.equal(
    CURATION_GATES_BY_ROLE.bassline.ringDbMax,
    CURATION_GATES.ringDbMax,
    'bassline stays at -32 — 0% of pack basslines fail it, and 134 says "bass can stay"',
  )
  // activeFraction was explicitly left alone (134 §5 item 5).
  for (const role of ['bassline', 'chords', 'lead', 'drum-loop'] as const) {
    assert.equal(CURATION_GATES_BY_ROLE[role].activeFractionMin, CURATION_GATES.activeFractionMin)
  }
  // and a lead render that the old gate rejected now passes under its own role's gate
  const ringyForOldGate = scores({ ringDb: -20 })
  assert.ok(!passesGates(ringyForOldGate), 'still rejected by the role-blind fallback')
  assert.ok(
    passesGates(ringyForOldGate, gatesForRole('lead')),
    'a -20 dB lead sits inside the pack lead distribution and must survive its own role gate',
  )
})

test('curateRole uses the role gates when given a role, and explicit gates still win', () => {
  const ringy = (n: string) => cand(n, 'Leads', { ringDb: -20 })
  // role-blind: the -20 dB candidates are all rejected, so nothing survives
  assert.equal(curateRole([ringy('a'), ringy('b')]).survivors, 0)
  // with the role named, they clear the calibrated lead gate
  assert.equal(curateRole([ringy('a'), ringy('b')], { role: 'lead' }).survivors, 2)
  // an explicit gates object still overrides the role
  assert.equal(
    curateRole([ringy('a'), ringy('b')], { role: 'lead', gates: { ringDbMax: -60, activeFractionMin: 0.5 } }).survivors,
    0,
  )
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

// ---- the corrected role -> category mapping (research 141 §7.3) -----------------------------------
// The old `SURGE_ROLE_CATEGORIES.chords = ['Pads','Keys']` sent every chords draw to a shelf whose
// measured amp-EG attack median is 537.8 ms across the installed corpus (829.5 ms in the factory
// pool alone, 4.6% within the <= 12 ms target 131 measured for chords) — and all 16 curated chords
// picks in presets/surge-curated.json did come from Pads, zero from Keys. These assertions pin the
// correction so it cannot silently regress back.

test('SURGE_ROLE_CATEGORIES_V2: chords no longer draws from Pads, and CAN draw from Chords/Polysynths', () => {
  const chords = surgeRoleCategoriesV2('chords')
  assert.ok(chords, 'chords is a surge-eligible role')
  const lower = chords!.map((c) => c.toLowerCase())
  assert.ok(!lower.includes('pads'), 'Pads (median attack 537.8 ms, 18% <= 12.5 ms) must NOT be a chords source')
  assert.ok(lower.includes('chords'), "Surge's own Chords category (median 3.9 ms) must be eligible")
  assert.ok(lower.includes('polysynths'), 'Polysynths (median 3.9 ms) must be eligible')
  assert.ok(lower.includes('keys'), 'Keys (median 4.8 ms) stays eligible')
})

test('SURGE_ROLE_CATEGORIES_V2: lead gains Sequences (unblocked by the tempo fix)', () => {
  const lead = surgeRoleCategoriesV2('lead')!.map((c) => c.toLowerCase())
  assert.ok(lead.includes('leads') && lead.includes('plucks'), 'the original lead sources stay')
  assert.ok(lead.includes('sequences'), 'Sequences is only safe once the sidecar renders at the project tempo (D6)')
})

test('SURGE_ROLE_CATEGORIES_V2: covers the third-party pool synonym vocabulary via substring match', () => {
  // patchInCategories is case-insensitive substring, so 'Bass' catches both 'Bass' and 'Basses'.
  const cases: [string, string, boolean][] = [
    ['bassline', 'Basses', true],
    ['bassline', 'Bass', true],
    ['chords', 'Polysynths', true],
    ['chords', 'Synths', true],
    ['chords', 'Pads', false],
    ['chords', 'Ambiances', false],
    ['lead', 'Arps', true],
    ['lead', 'Rhythms', true],
    ['lead', 'Pads', false],
  ]
  for (const [role, category, expected] of cases) {
    const cats = surgeRoleCategoriesV2(role)!
    assert.equal(patchInCategories(patch('X', category), cats), expected, `${role} x ${category}`)
  }
})

test('SURGE_ROLE_CATEGORIES_V2: drum-loop still skips surge, unknown roles degrade to null', () => {
  assert.equal(surgeRoleCategoriesV2('drum-loop'), null)
  assert.equal(surgeRoleCategoriesV2('nonsense'), null)
})

test('SURGE_ROLE_CATEGORIES_V2 covers exactly the roles showdown knows about', () => {
  // Stable across the coordinator's one-line swap: whichever mapping showdown.ts points at, the two
  // must agree on WHICH roles are surge-eligible — only on which categories each draws from.
  assert.deepEqual(Object.keys(SURGE_ROLE_CATEGORIES_V2).sort(), Object.keys(SURGE_ROLE_CATEGORIES).sort())
  for (const role of Object.keys(SURGE_ROLE_CATEGORIES)) {
    assert.equal(
      SURGE_ROLE_CATEGORIES_V2[role] === null,
      SURGE_ROLE_CATEGORIES[role] === null,
      `${role}: a role that skips surge must skip it in both mappings`,
    )
  }
})

// ---- target-aware selection (research 141 §8) -----------------------------------------------------

test('bandFit: 1.0 inside the band, decaying outside, neutral on a missing measurement', () => {
  const b = { lo: 0, hi: 10, scale: 'log' } as const
  assert.equal(bandFit(5, b), 1)
  assert.equal(bandFit(10, b), 1)
  assert.equal(bandFit(null, b), 0.5, 'unknown is neutral — never a free pass, never a veto')
  assert.equal(bandFit(undefined, b), 0.5)
  assert.equal(bandFit(NaN, b), 0.5)
  assert.ok(bandFit(20, b) < 1 && bandFit(20, b) > 0, 'one octave out is penalised, not zeroed')
  assert.ok(bandFit(40, b) < bandFit(20, b), 'further out scores worse')
  assert.equal(bandFit(80, b), 0, 'three octaves out scores zero')
  const lin = { lo: 0.6, hi: 0.9, scale: 'linear' } as const
  assert.equal(bandFit(0.7, lin), 1)
  assert.ok(Math.abs(bandFit(0.4, lin) - 0.8) < 1e-9, 'linear params are penalised by absolute distance')
})

test('paramFit: the professional profile scores near 1, our measured banks score much lower', () => {
  // lead targets, straight from research 141 §3: attack <= p75 9.77 ms, release p10..p75 6..332 ms
  const targets = {
    attackMs: { lo: 0, hi: 9.77, scale: 'log' as const },
    releaseMs: { lo: 6.19, hi: 331.51, scale: 'log' as const },
    sustain: { lo: 0.659, hi: 1, scale: 'linear' as const },
    cutoffHz: { lo: 147, hi: 1258, scale: 'log' as const },
  }
  // the corpus's own median lead
  const professional = { attackMs: 3.91, releaseMs: 31.25, sustain: 1, cutoffHz: 419, activeOscCount: 2, effectSlots: 2 }
  // engine-curated's measured lead median (141 §7.1): 13 ms attack, 1,213 ms release, 1 oscillator
  const ours = { attackMs: 13, releaseMs: 1213, sustain: 0.67, cutoffHz: 1172, activeOscCount: 1, effectSlots: 0 }
  const good = paramFit(professional, targets)
  const bad = paramFit(ours, targets)
  assert.ok(good > 0.99, `the corpus median should score ~1, got ${good}`)
  assert.ok(bad < 0.8, `our measured lead profile should score well below it, got ${bad}`)
  assert.ok(good - bad > 0.2, 'the screen must actually separate the two profiles')
})

test('paramFit: weights sum to 1 so the score stays a 0..1 quantity', () => {
  const sum = Object.values(PARAM_FIT_WEIGHTS).reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`)
})

test('roleParamTargets: reads the real stats artifact, and throws rather than inventing defaults', () => {
  const stats = JSON.parse(readFileSync(new URL('../presets/role-parameter-stats.json', import.meta.url), 'utf8')) as { roles?: Record<string, unknown> }
  for (const role of ['bassline', 'chords', 'lead']) {
    const t = roleParamTargets(stats, role)
    assert.ok(t.attackMs.hi > 0 && t.attackMs.hi < 100, `${role}: attack band top ${t.attackMs.hi} ms should be a transient-role number`)
    assert.ok(t.releaseMs.hi > t.releaseMs.lo)
    assert.ok(t.cutoffHz.hi > t.cutoffHz.lo)
  }
  // chords now targets Surge's own chords role, NOT pads — the §7.3 fix restated as data
  assert.equal(SHOWDOWN_ROLE_TO_STAT_ROLE.chords, 'chords')
  assert.ok(roleParamTargets(stats, 'chords').attackMs.hi <= 12.5, 'chords targets a <= 12 ms attack band')
  assert.throws(() => roleParamTargets(stats, 'drum-loop'), /no parameter targets/)
  assert.throws(() => roleParamTargets({ roles: {} }, 'lead'), /has no "lead" role/)
  assert.throws(() => roleParamTargets({ roles: { lead: {} } }, 'lead'), /missing ampEnv/)
})
