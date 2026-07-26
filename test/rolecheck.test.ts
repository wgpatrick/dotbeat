// `beat rolecheck` (research 138 §3-B2, 140 D26): the pre-batch screen every future arm uses to
// self-check before the owner ever listens. What these tests actually gate:
//   - the shipped presets/role-targets.json parses, covers the four showdown roles, and every
//     check carries the three things D26 asked for — a bound, a NAMED FIX, and a source;
//   - a clip that sits at the reference median passes, and one pushed outside a bound misses on
//     that axis and only that axis;
//   - the verdict is a screen, not a quality claim: the caveats that say so are IN the artifact.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FEATURE_KEYS, type FeatureVector } from '../src/taste/features.js'
import {
  loadRoleTargets,
  rolecheckFeatures,
  rolecheckFile,
  formatRoleCheck,
  knownRoles,
  BeatRoleCheckError,
  type RoleTargets,
} from '../src/taste/rolecheck.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const TARGETS = join(repoRoot, 'presets', 'role-targets.json')

const load = (): RoleTargets => {
  assert.ok(existsSync(TARGETS), `missing ${TARGETS} — regenerate with: node scripts/build-role-targets.mjs`)
  return loadRoleTargets(TARGETS)
}

/** A vector sitting exactly on the reference median for every axis this role checks. */
function atRefMedian(targets: RoleTargets, role: string): FeatureVector {
  const v = Object.fromEntries(FEATURE_KEYS.map((k) => [k, 0])) as FeatureVector
  for (const c of targets.roles[role]!.checks) (v as Record<string, number>)[c.feature] = c.ref.median
  return v
}

test('role targets cover the four showdown roles and carry provenance', () => {
  const t = load()
  assert.deepEqual(knownRoles(t), ['bassline', 'chords', 'drum-loop', 'lead'])
  assert.equal(t.provenance.refPool, 'refs-packs', 'targets must come from the pool D26 names as the bar')
  assert.ok(t.provenance.refClipsTotal >= 50, `only ${t.provenance.refClipsTotal} reference clips behind the targets`)
  assert.ok(t.provenance.docs.length >= 3)
  // The screen-not-a-verdict warning must live in the artifact, not only in a doc someone may not read.
  assert.ok(t.provenance.caveats.some((c) => /not a quality verdict|screen/i.test(c)), 'targets must carry the screen-vs-bar caveat')
  assert.ok(t.provenance.caveats.some((c) => /roughness/i.test(c)), 'targets must record why roughness is absent (123, 131 §4)')
  assert.ok(t.provenance.caveats.some((c) => /normaliz/i.test(c)), 'targets must record that level-dependent checks assume batch normalization')
})

test('every check names a bound, a fix, a lever and a source — D26\'s whole point', () => {
  const t = load()
  let checks = 0
  for (const [role, spec] of Object.entries(t.roles)) {
    assert.ok(spec.checks.length >= 6, `role ${role} has only ${spec.checks.length} checks`)
    assert.ok(spec.refClips >= 10, `role ${role} rests on only ${spec.refClips} reference clips`)
    for (const c of spec.checks) {
      assert.ok(FEATURE_KEYS.includes(c.feature as never), `${role}/${c.feature} is not a FEATURE_KEYS member — the targets and the critic disagree`)
      assert.ok(c.min !== undefined || c.max !== undefined, `${role}/${c.feature} has no bound`)
      if (c.min !== undefined && c.max !== undefined) assert.ok(c.min < c.max, `${role}/${c.feature} has an empty band`)
      assert.ok(c.fix.length > 40, `${role}/${c.feature} has no NAMED FIX — a miss with no fix is a complaint, not an instrument`)
      assert.ok(/13[0-9]|14[0-9]/.test(c.source), `${role}/${c.feature} cites no research doc: ${c.source}`)
      assert.ok(c.lever.length > 0)
      assert.ok(c.ref.n >= 10)
      checks++
    }
  }
  assert.ok(checks >= 30, `expected >= 30 checks across the four roles, got ${checks}`)
})

// The hard invariant from research 134 §5 ("the screens reject the quality bar itself"): three of
// research 131 §7's GLOBAL targets — fluxMean >= 0.17, chords attackMedMs <= 12, lead slope <= -10
// — are stricter than the corresponding role's own median reference clip, so applied literally
// they would fail more than half of the owner's winning refs for that role. The generator clamps
// every bound to the role's median; this is the test that keeps it clamped.
test('no bound excludes its own role\'s median reference clip', () => {
  const t = load()
  for (const [role, spec] of Object.entries(t.roles)) {
    for (const c of spec.checks) {
      if (c.min !== undefined) assert.ok(c.ref.median >= c.min, `${role}/${c.feature}: min ${c.min} rejects the ref median ${c.ref.median}`)
      if (c.max !== undefined) assert.ok(c.ref.median <= c.max, `${role}/${c.feature}: max ${c.max} rejects the ref median ${c.ref.median}`)
    }
  }
})

test('a clip at the reference median passes every role', () => {
  const t = load()
  for (const role of knownRoles(t)) {
    const r = rolecheckFeatures(atRefMedian(t, role), role, t)
    assert.equal(r.verdict, 'pass', `${role}: a clip at the ref median missed ${r.rows.filter((x) => x.verdict === 'miss').map((x) => `${x.feature} (${x.measured} vs ${x.min ?? ''}..${x.max ?? ''})`).join(', ')}`)
    assert.equal(r.missed, 0)
    assert.ok(r.rows.length >= 6)
  }
})

test('pushing one axis outside its bound misses on that axis alone, with its fix', () => {
  const t = load()
  const role = 'bassline'
  const check = t.roles[role]!.checks.find((c) => c.feature === 'bandSubPct')!
  const v = atRefMedian(t, role)
  ;(v as Record<string, number>).bandSubPct = check.min! - 10 // a bassline with no sub — the founding hole
  const r = rolecheckFeatures(v, role, t, 'synthetic.wav')
  assert.equal(r.verdict, 'fail')
  assert.equal(r.missed, 1, `only bandSubPct should miss, got ${r.rows.filter((x) => x.verdict === 'miss').map((x) => x.feature).join(', ')}`)
  const miss = r.rows.find((x) => x.verdict === 'miss')!
  assert.equal(miss.feature, 'bandSubPct')
  assert.equal(miss.side, 'low')
  assert.ok(miss.severity > 0)
  assert.match(miss.fix, /subLevel|octave/i, 'the sub-content fix must name the actual dotbeat knob')
  const text = formatRoleCheck(r)
  assert.match(text, /FAIL/)
  assert.match(text, /bandSubPct/)
  assert.match(text, /fix:/)
})

test('unknown role and unreadable audio fail loudly, never silently pass', () => {
  const t = load()
  assert.throws(() => rolecheckFeatures(atRefMedian(t, 'lead'), 'squelch', t), BeatRoleCheckError)
  assert.throws(() => rolecheckFile(join(repoRoot, 'no-such-render.wav'), 'lead', t), BeatRoleCheckError)
  assert.throws(() => loadRoleTargets(join(repoRoot, 'presets', 'no-such-targets.json')), /regenerate/)
})

test('rolecheck measures a real render end to end', () => {
  const t = load()
  const wav = join(repoRoot, 'examples', 'taste-t1', 'gen-kick1-50884', 'v1.wav')
  assert.ok(existsSync(wav), `missing committed fixture render ${wav}`)
  const r = rolecheckFile(wav, 'drum-loop', t)
  assert.equal(r.role, 'drum-loop')
  assert.ok(r.rows.length >= 6)
  for (const row of r.rows) assert.ok(Number.isFinite(row.measured), `${row.feature} measured non-finite`)
  assert.ok(['pass', 'fail'].includes(r.verdict))
  assert.equal(r.passed + r.missed, r.rows.length)
})
