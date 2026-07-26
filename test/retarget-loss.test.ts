// The retarget target profiles + loss, tested as PROPERTIES rather than golden numbers: every
// assertion below is a claim about how the objective must behave, and each one names the measured
// failure mode it exists to prevent.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RetargetFeatures } from '../src/retarget/features.js'
import { RETARGET_FEATURE_KEYS } from '../src/retarget/features.js'
import {
  RETARGET_FEATURE_SCALES,
  RETARGET_ROLES,
  describeTarget,
  profileKeys,
  targetMiss,
  targetProfileFor,
  targetSatisfied,
} from '../src/retarget/targets.js'
import {
  GAP_POWER,
  MISS_CAP,
  W_PRESERVE,
  W_REGRESS,
  formatLossLine,
  powerMean,
  retargetLoss,
} from '../src/retarget/loss.js'
import { presetGenome, retargetSpace, trustBounds, paramDiff, genomeToParams, fieldDefault } from '../src/retarget/space.js'
import { presetZ, zToGenome } from '../src/retarget/harness.js'

/** A neutral feature vector; tests override the axes they care about. */
function features(over: Partial<RetargetFeatures> = {}): RetargetFeatures {
  const base: RetargetFeatures = {
    durationSeconds: 8,
    lufs: -16,
    truePeakDb: -9,
    crestDb: 12,
    bandSubPct: 0.2,
    bandBassPct: 30,
    bandMidsPct: 99,
    bandPresencePct: 0.5,
    bandAirPct: 0.05,
    centroidHz: 160,
    crestSubDb: 24,
    crestBassDb: 12,
    crestMidsDb: 9,
    crestPresenceDb: 10,
    fluxMean: 0.09,
    fluxP95: 0.26,
    flatnessDb: -50,
    flatnessHiDb: -30,
    flatnessLoDb: -14,
    slopeDbPerOct: -6,
    onsetRatePerSec: 2.3,
    attackMedMs: 30,
    attackP25Ms: 28,
    attackCv: 0.4,
    onsetLevelCv: 0.26,
    envStdDb: 8,
    sustainPct: 40,
    widthMeanDb: -11,
  }
  return { ...base, ...over }
}

// ---- target profiles ----------------------------------------------------------------------------

test('every role has a profile whose targets reference real feature keys and sane regions', () => {
  for (const role of RETARGET_ROLES) {
    const p = targetProfileFor(role)
    assert.equal(p.role, role)
    assert.ok(p.targets.length >= 8, `${role} should score at least 8 axes, has ${p.targets.length}`)
    for (const t of p.targets) {
      assert.ok((RETARGET_FEATURE_KEYS as readonly string[]).includes(t.key), `${role}: unknown feature key ${t.key}`)
      assert.ok(t.scale > 0, `${role}/${t.key}: scale must be positive`)
      assert.ok(t.weight > 0, `${role}/${t.key}: weight must be positive`)
      assert.ok(t.basis.length > 20, `${role}/${t.key}: every threshold must cite where it came from`)
      if (t.kind === 'atLeast') assert.equal(typeof t.lo, 'number', `${role}/${t.key}: atLeast needs lo`)
      if (t.kind === 'atMost') assert.equal(typeof t.hi, 'number', `${role}/${t.key}: atMost needs hi`)
      if (t.kind === 'band') {
        assert.ok(typeof t.lo === 'number' && typeof t.hi === 'number', `${role}/${t.key}: band needs both edges`)
        assert.ok(t.lo! < t.hi!, `${role}/${t.key}: band edges are inverted`)
      }
    }
    // no axis may be BOTH scored and preserved — the two terms would fight
    const scored = new Set(p.targets.map((t) => t.key))
    for (const k of p.preserve) assert.ok(!scored.has(k), `${role}: ${k} is both a target and a preserve axis`)
    for (const k of p.informational) assert.ok(!scored.has(k), `${role}: ${k} is both a target and informational`)
  }
})

test('widthMeanDb is never scored — engine renders are mono, so it would be a free axis', () => {
  for (const role of RETARGET_ROLES) {
    const p = targetProfileFor(role)
    assert.ok(!p.targets.some((t) => t.key === 'widthMeanDb'), `${role} must not score width`)
    assert.ok(p.informational.includes('widthMeanDb'), `${role} should still REPORT width`)
  }
})

test('the roles disagree — 131 §5: role-specific signs, not one global quality knob', () => {
  const bass = targetProfileFor('bassline')
  const lead = targetProfileFor('lead')
  const bassMids = bass.targets.find((t) => t.key === 'bandMidsPct')!
  const leadMids = lead.targets.find((t) => t.key === 'bandMidsPct')!
  assert.ok(bassMids.hi! < leadMids.hi!, 'a bassline may occupy far less midrange than a lead')
  const bassCentroid = bass.targets.find((t) => t.key === 'centroidHz')
  assert.ok(bassCentroid, 'bassline targets its centroid')
  assert.ok(!lead.targets.some((t) => t.key === 'centroidHz'), 'lead does not — its register is not the problem')
})

test('targetMiss is zero inside the region and grows in scale units outside it', () => {
  const atLeast = { key: 'bandSubPct' as const, kind: 'atLeast' as const, lo: 30, scale: 20, weight: 1, basis: 'test' }
  assert.equal(targetMiss(atLeast, 30), 0)
  assert.equal(targetMiss(atLeast, 90), 0, 'overshoot earns no credit and no penalty')
  assert.equal(targetMiss(atLeast, 10), 1)
  const atMost = { key: 'centroidHz' as const, kind: 'atMost' as const, hi: 90, scale: 60, weight: 1, basis: 'test' }
  assert.equal(targetMiss(atMost, 60), 0)
  assert.equal(targetMiss(atMost, 150), 1)
  const band = { key: 'crestDb' as const, kind: 'band' as const, lo: 14, hi: 19, scale: 4, weight: 1, basis: 'test' }
  assert.equal(targetMiss(band, 16), 0)
  assert.equal(targetMiss(band, 10), 1)
  assert.equal(targetMiss(band, 23), 1)
  assert.ok(targetSatisfied(band, 15) && !targetSatisfied(band, 25))
  assert.equal(targetMiss(band, Number.NaN), 0, 'an unmeasurable axis must not poison the loss')
  assert.equal(describeTarget(band), '14 .. 19')
})

// ---- the loss's shape ---------------------------------------------------------------------------

test('powerMean emphasizes the worst axis (the anti-gaming construction)', () => {
  // two axes: one perfect, one 2.0 out — vs both 1.0 out. The SUM is identical; the loss must not be.
  const lopsided = powerMean([0, 2], [1, 1], GAP_POWER)
  const even = powerMean([1, 1], [1, 1], GAP_POWER)
  assert.ok(lopsided > even, `p=${GAP_POWER} must punish a lopsided miss (${lopsided}) more than an even one (${even})`)
  assert.equal(powerMean([0, 0], [1, 1], GAP_POWER), 0)
  assert.equal(powerMean([1, 1], [0, 0], GAP_POWER), 0, 'zero total weight is a zero loss, not a divide-by-zero')
})

test('a perfect candidate scores zero gap, and a missing candidate scores more', () => {
  const p = targetProfileFor('bassline')
  const good = features({ bandSubPct: 60, centroidHz: 74, crestSubDb: 6, crestBassDb: 4, fluxMean: 0.3, truePeakDb: -6, crestDb: 8, crestMidsDb: 9, bandMidsPct: 2 })
  const bad = features()
  const lg = retargetLoss(good, p, good)
  const lb = retargetLoss(bad, p, bad)
  assert.equal(lg.gap, 0, `a candidate inside every target region must have zero gap, got ${lg.gap}`)
  assert.equal(lg.hit, lg.of)
  assert.ok(lb.gap > 0.5, `an engineplus-shaped bassline should be far out, got ${lb.gap}`)
  assert.ok(lb.hit < lb.of)
})

test('overshooting one axis cannot buy a lower loss (the width-hack lesson)', () => {
  const p = targetProfileFor('bassline')
  const base = features({ bandSubPct: 35, centroidHz: 85 })
  const gamed = features({ bandSubPct: 99, centroidHz: 85 }) // hugely overshoot the one cheap axis
  const lb = retargetLoss(base, p, base)
  const lg = retargetLoss(gamed, p, base)
  assert.ok(lg.gap >= lb.gap - 1e-9, `overshooting bandSubPct must not reduce the gap (${lg.gap} vs ${lb.gap})`)
})

test('breaking a target the preset already satisfied costs extra (the regress term)', () => {
  const p = targetProfileFor('lead')
  const preset = features({ crestSubDb: 8, attackP25Ms: 5, truePeakDb: -3, fluxMean: 1, flatnessHiDb: -15, crestDb: 16, crestPresenceDb: 12, bandMidsPct: 80, slopeDbPerOct: -8 })
  // candidate breaks crestSubDb, which the preset had
  const broke = features({ ...preset, crestSubDb: 35 })
  // a candidate that never had it and still doesn't: same miss, no regress
  const neverHad = features({ ...preset, crestSubDb: 35 })
  const withRegress = retargetLoss(broke, p, preset)
  const withoutRegress = retargetLoss(neverHad, p, features({ ...preset, crestSubDb: 35 }))
  assert.ok(withRegress.regress > 0, 'breaking a satisfied target must register')
  assert.equal(withoutRegress.regress, 0, 'failing a target the preset never had is not a regression')
  assert.ok(withRegress.total > withoutRegress.total, 'the same miss must cost MORE when it is a regression')
  assert.ok(withRegress.axes.find((a) => a.key === 'crestSubDb')!.regressed)
})

test('the preserve term charges identity drift beyond the free band, and only beyond it', () => {
  const p = targetProfileFor('chords')
  const preset = features()
  const nudged = features({ sustainPct: preset.sustainPct + 0.5 * RETARGET_FEATURE_SCALES.sustainPct })
  const wrecked = features({ sustainPct: preset.sustainPct + 3 * RETARGET_FEATURE_SCALES.sustainPct })
  assert.equal(retargetLoss(nudged, p, preset).preserve, 0, 'small drift is free (render nondeterminism alone moves these)')
  assert.ok(retargetLoss(wrecked, p, preset).preserve > 0, 'large identity drift must be charged')
  assert.ok(retargetLoss(wrecked, p, preset).total > retargetLoss(nudged, p, preset).total)
})

test('one hopeless axis is capped so the search still banks the reachable wins', () => {
  const p = targetProfileFor('bassline')
  const preset = features()
  const hopeless = features({ bandSubPct: 0 }) // 1.5 scale units out
  const absurd = features({ bandSubPct: -1000 }) // absurdly far — must clamp, not explode
  const a = retargetLoss(hopeless, p, preset).gap
  const b = retargetLoss(absurd, p, preset).gap
  assert.ok(b >= a)
  assert.ok(b < MISS_CAP + 1e-9, `the gap must stay bounded by MISS_CAP=${MISS_CAP}, got ${b}`)
})

test('the drift term rises with distance from the preset and is zero at the preset', () => {
  const p = targetProfileFor('chords')
  const f = features()
  const start = [0.5, 0.5, 0.5]
  assert.equal(retargetLoss(f, p, f, { genome: start, startGenome: start }).drift, 0)
  const near = retargetLoss(f, p, f, { genome: [0.55, 0.5, 0.5], startGenome: start }).drift
  const far = retargetLoss(f, p, f, { genome: [0.9, 0.9, 0.9], startGenome: start }).drift
  assert.ok(far > near && near > 0)
})

test('term weights are exposed and actually applied', () => {
  const p = targetProfileFor('lead')
  const preset = features({ crestSubDb: 8 })
  const broke = features({ crestSubDb: 40, sustainPct: 100 })
  const normal = retargetLoss(broke, p, preset)
  const off = retargetLoss(broke, p, preset, { weights: { regress: 0, preserve: 0, drift: 0 } })
  assert.ok(normal.total > off.total)
  assert.ok(W_REGRESS > 0 && W_PRESERVE > 0)
  assert.match(formatLossLine(normal), /loss .* targets hit/)
})

// ---- the space + trust region --------------------------------------------------------------------

test('the search space starts AT the preset and is bounded by the trust radii', () => {
  const defs = retargetSpace('bassline')
  const params = { cutoff: 1288, resonance: 0.765, attack: 0.003, decay: 0.035, sustain: 0.52, release: 1.245 }
  const start = presetGenome(defs, params)
  assert.equal(start.length, defs.length)
  // fields the preset never mentions resolve to the ENGINE's default, not to 0.5
  const subIdx = defs.findIndex((d) => d.field === 'subLevel')
  assert.equal(genomeToParams(defs, start).subLevel, fieldDefault('subLevel'))
  const { lower, upper } = trustBounds(defs, start)
  for (let i = 0; i < defs.length; i++) {
    assert.ok(lower[i]! <= start[i]! && start[i]! <= upper[i]!, `${defs[i]!.field}: the preset must sit inside its own trust interval`)
    assert.ok(upper[i]! - lower[i]! <= 2 * defs[i]!.trust + 1e-9, `${defs[i]!.field}: trust interval too wide`)
    assert.ok(lower[i]! >= 0 && upper[i]! <= 1)
  }
  // the deliberate register levers get the widest trust; cutoff the narrowest
  assert.ok(defs[subIdx]!.trust > defs.find((d) => d.field === 'cutoff')!.trust)
})

test('the trust cube round-trips: the preset is at its own z, and z stays inside the box', () => {
  const defs = retargetSpace('chords')
  const start = presetGenome(defs, { cutoff: 900, attack: 0.02 })
  const { lower, upper } = trustBounds(defs, start)
  const z0 = presetZ(start, lower, upper)
  const back = zToGenome(z0, lower, upper)
  for (let i = 0; i < start.length; i++) assert.ok(Math.abs(back[i]! - start[i]!) < 1e-9, `${defs[i]!.field} did not round-trip`)
  for (const z of [new Array(defs.length).fill(0), new Array(defs.length).fill(1)]) {
    const g = zToGenome(z, lower, upper)
    for (let i = 0; i < g.length; i++) assert.ok(g[i]! >= lower[i]! - 1e-9 && g[i]! <= upper[i]! + 1e-9)
  }
})

test('paramDiff reports what moved, biggest first, and nothing when nothing moved', () => {
  const defs = retargetSpace('lead')
  const start = presetGenome(defs, { cutoff: 2000 })
  assert.deepEqual(paramDiff(defs, start, start), [])
  const moved = [...start]
  const ci = defs.findIndex((d) => d.field === 'cutoff')
  const si = defs.findIndex((d) => d.field === 'subLevel')
  moved[ci] = start[ci]! + 0.05
  moved[si] = start[si]! + 0.4
  const diff = paramDiff(defs, start, moved)
  assert.equal(diff.length, 2)
  assert.equal(diff[0]!.field, 'subLevel', 'the biggest range move comes first')
  assert.ok(diff[0]!.to > diff[0]!.from)
  assert.ok(Math.abs(diff[0]!.trustFraction) <= 1 + 1e-9, 'a move can never exceed its own trust radius')
})

test('profileKeys lists scored, preserved and informational axes without duplicates', () => {
  for (const role of RETARGET_ROLES) {
    const keys = profileKeys(targetProfileFor(role))
    assert.equal(new Set(keys).size, keys.length, `${role}: duplicate key in the report order`)
    assert.ok(keys.length >= 12)
  }
})
