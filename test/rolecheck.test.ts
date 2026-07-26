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
import { FEATURE_KEYS, type FeatureVector } from '../src/metrics/features.js'
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

// The defect a 2026-07-26 usability pilot found: every INDIVIDUAL bound was clamped to its role's
// median reference clip, but the verdict was an AND over 8-11 of them, and per-check miss rates
// compound (0.75^10 = 5.6%). Measured result: 157 of 159 reference clips failed the verdict of the
// targets mined from those very clips — a gate with zero information content. The verdict is now a
// MISS BUDGET calibrated on the same pool, and this is the test that keeps it calibrated.
//
// CALIBRATION PROVENANCE (CLAUDE.md: a guard on a measured threshold carries the complaint date and
// the before/after numbers). Complaint 2026-07-26, hygiene audit: this test had a FLOOR
// (`refPassRate >= 0.7`) and a `maxMisses < checks.length` sanity check, and NOTHING bounding the
// verdict from above — so a regeneration that made the screen a no-op would still have passed it in
// full. BEFORE (targets v1, no ceiling): bassline 0.955, chords 0.900, lead 0.900, drum-loop
// **1.000** — drum-loop already cleared EVERY one of its own reference clips, against the
// generator's own stated calibration target of "~75%". AFTER: ceiling 0.96, set just above the
// highest genuinely-calibrated role (bassline, 0.955) and below drum-loop, which is carried in the
// ledger below so the number is admitted rather than accommodated.
const REF_PASS_RATE_CEILING = 0.96

/** Roles whose verdict clears MORE of their own reference pool than `REF_PASS_RATE_CEILING` allows
 *  — i.e. a screen that currently rejects almost nothing. A RATCHET, on the same pattern as
 *  `UNKNOWN_FLAG_HOLES` in test/cli-surface.test.ts: a role may only ever LEAVE this list, and the
 *  test fails if one leaves without the list being shortened. Do not add to it to make a
 *  regeneration green — recalibrate the generator instead (scripts/build-role-targets.mjs). */
const LOOSE_VERDICTS: string[] = ['drum-loop']

test('the overall verdict is calibrated so most reference clips clear it', () => {
  const t = load()
  const tooLoose: string[] = []
  for (const [role, spec] of Object.entries(t.roles)) {
    assert.ok(spec.verdict !== undefined, `role ${role} has no calibrated verdict bar`)
    assert.ok(spec.verdict.maxMisses >= 0 && spec.verdict.maxMisses < spec.checks.length,
      `role ${role}: a bar of ${spec.verdict.maxMisses} out of ${spec.checks.length} checks is not a bar`)
    // The CEILING on the budget itself: the bar may never be more forgiving than the worst
    // reference clip in the pool it was mined from. Without this, `maxMisses = checks.length - 1`
    // satisfies the line above while passing anything that clears a single check.
    assert.ok(spec.verdict.maxMisses <= spec.verdict.refMissCounts.max,
      `role ${role}: a bar of ${spec.verdict.maxMisses} misses is looser than the WORST of its own reference clips (${spec.verdict.refMissCounts.max}) — the budget stopped being calibrated on anything`)
    assert.ok(spec.verdict.refPassRate >= 0.7,
      `role ${role}: only ${(100 * spec.verdict.refPassRate).toFixed(0)}% of its own reference clips clear the verdict — a screen that rejects the bar is measuring the wrong thing (134 §5)`)
    assert.ok(spec.refLufs !== null, `role ${role} has no reference loudness distribution — the normalization guard cannot work`)
    if (spec.verdict.refPassRate > REF_PASS_RATE_CEILING) tooLoose.push(role)
  }

  // The CEILING on the pass rate, as a shrink-only ledger.
  const known = new Set(LOOSE_VERDICTS)
  assert.deepEqual(
    tooLoose.filter((r) => !known.has(r)).sort(),
    [],
    `these roles now pass more than ${(100 * REF_PASS_RATE_CEILING).toFixed(0)}% of their own reference clips and are NOT in the ` +
      'documented ledger — the verdict has quietly become a no-op for them, which is exactly the ' +
      'shape of the 2026-07-26 defect in the other direction (recalibrate scripts/build-role-targets.mjs)',
  )
  assert.deepEqual(
    LOOSE_VERDICTS.filter((r) => !tooLoose.includes(r)).sort(),
    [],
    'these roles are now inside the ceiling — delete them from LOOSE_VERDICTS so the ledger shrinks',
  )
})

test('a two-sided band gives direction-aware advice, not one string for both sides', () => {
  const t = load()
  const band = Object.values(t.roles).flatMap((r) => r.checks).filter((c) => c.min !== undefined && c.max !== undefined)
  assert.ok(band.length >= 3, 'expected several two-sided band checks')
  for (const c of band) {
    assert.ok(c.fixHigh !== undefined && c.fixHigh !== c.fix,
      `${c.feature} is a two-sided band with one fix string — it will be wrong on one side (it used to tell a too-noisy clip to add a noise oscillator)`)
  }
})

test('level-dependent rows go advisory on un-normalized audio instead of failing the clip', () => {
  const t = load()
  const role = 'bassline'
  const v = atRefMedian(t, role)
  ;(v as Record<string, number>).lufs = (t.roles[role]!.refLufs!.p10) - 20 // a raw stem, 20 dB down
  ;(v as Record<string, number>).truePeakDb = -30
  const r = rolecheckFeatures(v, role, t)
  const tp = r.rows.find((x) => x.feature === 'truePeakDb')!
  assert.equal(tp.verdict, 'advisory', 'truePeakDb on a 20 dB-down stem reads level, not punch — it must not count as a miss')
  assert.match(tp.advisoryReason ?? '', /LUFS/)
  assert.equal(r.verdict, 'pass', 'a clip at the reference median must not be failed by a row the tool itself says does not apply')
})

// Until 2026-07-26 "declined" was a banner over a fully-computed verdict: the comment at
// src/taste/rolecheck.ts said "the verdict is withheld", the D26 commit message said a --role typo
// "now declines", and the code computed `missed <= maxMisses` exactly as usual and printed "The
// rows below are still printed." A drum loop checked as a bassline therefore printed a confident
// PASS. The verdict is now genuinely withheld, and this test asserts the withholding rather than
// just the presence of the banner.
test('a clip that is nowhere near the role is declined, not confidently mis-reported', () => {
  const t = load()
  const v = atRefMedian(t, 'bassline')
  ;(v as Record<string, number>).centroidLog2 = 12.45 // ~5.6 kHz — a drum loop, not a bassline
  const r = rolecheckFeatures(v, 'bassline', t)
  assert.ok(r.applicability !== undefined, 'a 5.6 kHz-centroid clip checked as a bassline must say so')
  assert.match(r.applicability!, /does not look like a bassline/)

  // The whole point: every other axis is ON the bassline reference median, so the miss budget would
  // say PASS. It must not.
  assert.ok(r.missed <= r.maxMisses, 'fixture check: the budget alone would have called this a pass')
  assert.equal(r.verdict, 'declined', 'a clip the tool says it cannot judge must not carry a pass/fail verdict')

  const text = formatRoleCheck(r)
  assert.match(text, /!!/)
  assert.match(text, /DECLINED/)
  assert.doesNotMatch(text.split('\n')[0]!, /\bPASS\b|\bFAIL\b/, 'the headline must not state a verdict it withheld')
  assert.match(text, /NO VERDICT/)
  assert.doesNotMatch(text, /rows below are still printed/, 'the old wording invited the reader to trust the rows anyway')
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
    assert.ok(r.missed <= r.maxMisses)
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
  assert.equal(r.missed, 1, `only bandSubPct should miss, got ${r.rows.filter((x) => x.verdict === 'miss').map((x) => x.feature).join(', ')}`)
  // One miss is inside the budget — the DIAGNOSIS fires without the verdict crying wolf.
  assert.equal(r.verdict, 'pass')
  const miss = r.rows.find((x) => x.verdict === 'miss')!
  assert.equal(miss.feature, 'bandSubPct')
  assert.equal(miss.side, 'low')
  assert.ok(miss.severity > 0)
  assert.match(miss.fix, /subLevel|octave/i, 'the sub-content fix must name the actual dotbeat knob')
  const text = formatRoleCheck(r)
  assert.match(text, /bandSubPct/)
  assert.match(text, /fix:/)

  // Blow the budget and the verdict does fire.
  const wrecked = atRefMedian(t, role)
  for (const c of t.roles[role]!.checks) {
    if (c.min !== undefined) (wrecked as Record<string, number>)[c.feature] = c.min - Math.max(1, Math.abs(c.min))
    else if (c.max !== undefined) (wrecked as Record<string, number>)[c.feature] = c.max + Math.max(1, Math.abs(c.max))
  }
  // ...but leave the centroid on the role's median. Wrecking THAT axis too puts the clip outside
  // the applicability window, and since 2026-07-26 that withholds the verdict rather than failing
  // it — which would test the wrong branch. A bassline-shaped clip that is simply bad must FAIL.
  ;(wrecked as Record<string, number>).centroidLog2 = t.roles[role]!.refDistribution.centroidLog2!.median
  const bad = rolecheckFeatures(wrecked, role, t)
  assert.equal(bad.applicability, undefined, 'fixture check: this clip must still look like a bassline')
  assert.equal(bad.verdict, 'fail', `a clip outside every bound must FAIL, missed ${bad.missed} of ${bad.rows.length} with bar ${bad.maxMisses}`)
  assert.match(formatRoleCheck(bad), /FAIL/)
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
