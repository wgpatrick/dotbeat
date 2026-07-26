#!/usr/bin/env node
// Build presets/role-targets.json — the per-role audio targets `beat rolecheck` measures against.
//
// WHY THIS IS A SCRIPT AND NOT A HAND-TYPED TABLE. Research 138 B2 / 140 D26 asked for "a
// pre-batch pass/fail with named fixes" whose targets are MINED and PROVENANCE-CARRYING. Numbers
// transcribed from a doc's prose go stale silently and cannot be re-derived; numbers computed from
// the owner's own rated reference pool can be regenerated the moment the pool grows, and carry the
// n they were computed from. Every threshold in the output is a percentile of the packs-era Splice
// reference clips for that role — the pool the owner named as the bar (research 131 §1, D26).
//
// D25 / PRIVACY. The reference audio is licensed material and its filenames are private. This
// script reads the renders to compute features and writes ONLY aggregate percentiles plus an n per
// role — no filenames, no per-clip values, no audio. That is exactly the disclosure research 131
// operated under ("no audio content, no ref filenames, aggregate statistics only").
//
// Usage: node scripts/build-role-targets.mjs [--log <beat-scores.jsonl>] [--out <path>] [--print]

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const argOf = (flag, dflt) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt
}
const logPath = resolve(argOf('--log', join(repoRoot, 'examples', 'taste-t1', 'beat-scores.jsonl')))
const outPath = resolve(argOf('--out', join(repoRoot, 'presets', 'role-targets.json')))
const REF_POOL = 'refs-packs'

const { featuresForAudioFile } = await import(join(repoRoot, 'dist/src/metrics/features.js'))
const { FEATURE_SET_VERSION } = await import(join(repoRoot, 'dist/src/metrics/features.js'))

// ---- collect packs-era ref clips per role ------------------------------------------------------

/** Which ref pool a showdown batch drew from — recorded only in its manifest's source `from`. */
function refPoolOf(batchDir) {
  const mPath = join(batchDir, 'manifest.json')
  if (!existsSync(mPath)) return null
  try {
    const m = JSON.parse(readFileSync(mPath, 'utf8'))
    for (const v of m.variants ?? []) {
      if (v.source?.kind !== 'ref') continue
      const from = v.source.from ?? ''
      for (const pool of ['refs-packs', 'refs-familiar', 'refs-unfamiliar', 'refs-cc']) {
        if (from.includes(pool)) return pool
      }
    }
  } catch {
    /* unreadable manifest */
  }
  return null
}

const latest = new Map()
for (const line of readFileSync(logPath, 'utf8').split('\n')) {
  if (!line.trim()) continue
  let e
  try {
    e = JSON.parse(line)
  } catch {
    continue
  }
  if (typeof e.batch !== 'string' || !Array.isArray(e.picks)) continue
  latest.set(e.batch, e)
}

/** role -> feature -> values[], over ref clips from the packs pool only. */
const byRole = new Map()
/** role -> full feature vectors, kept so the OVERALL verdict can be calibrated on the same pool. */
const vectorsByRole = new Map()
let clipCount = 0
for (const e of latest.values()) {
  if (typeof e.group !== 'string' || !e.group.startsWith('showdown:') || !e.sources) continue
  const role = e.group.slice('showdown:'.length)
  if (refPoolOf(e.batch) !== REF_POOL) continue
  for (const [file, kind] of Object.entries(e.sources)) {
    if (kind !== 'ref') continue
    const wav = file.endsWith('.wav') ? file : file.replace(/\.beat$/, '.wav')
    const f = featuresForAudioFile(join(e.batch, wav), { cache: true })
    if (f === null) continue
    clipCount++
    const vecs = vectorsByRole.get(role) ?? []
    vecs.push(f)
    vectorsByRole.set(role, vecs)
    const perFeature = byRole.get(role) ?? new Map()
    for (const [k, v] of Object.entries(f)) {
      if (!Number.isFinite(v)) continue
      const arr = perFeature.get(k) ?? []
      arr.push(v)
      perFeature.set(k, arr)
    }
    byRole.set(role, perFeature)
  }
}

const pct = (sorted, q) => {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const pos = (q / 100) * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.min(lo + 1, sorted.length - 1)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}
const round = (x) => (x === null ? null : Math.round(x * 1000) / 1000)

/** Percentile summary of one feature over one role's ref clips. */
function dist(values) {
  const s = [...values].sort((a, b) => a - b)
  return { n: s.length, p10: round(pct(s, 10)), p25: round(pct(s, 25)), median: round(pct(s, 50)), p75: round(pct(s, 75)), p90: round(pct(s, 90)) }
}

// ---- the checks: which axes gate which role, and the NAMED FIX for each miss -------------------
//
// `bound` is read against the role's own ref distribution:
//   atLeast:<p>  measured must be >= that percentile of the refs
//   atMost:<p>   measured must be <= that percentile
//   band:<a>,<b> measured must sit between two percentiles (research 131 §3.3's finding that
//                texture and tilt are BANDS — overshooting lands in gen's hiss regime, and
//                undershooting in the synths' clean-static one)
// Every entry cites the doc that says this axis matters for this role.

const PUNCH = [
  {
    feature: 'truePeakDb', assumesNormalized: true, bound: 'atLeast:25', lever: 'patch + engine', source: '131 §7-P2 (packs head-to-head d +1.38, the strongest discriminator in the log). ASSUMES the clip is loudness-normalized like a showdown batch — on a raw stem this row reads level, not punch.',
    fix: 'Shorten the amp-EG attack and add a transient shaper — NOT more compression (131 §6: a compressor fixes neither half of the crest story). Research 141 §3: 65% of professional lead/bass/pluck patches leave attack at Surge\'s 3.91 ms floor, so ask for 0 and accept <= 12 ms.',
  },
  {
    feature: 'attackMedMs', bound: 'atMost:75', lever: 'patch', source: '131 §7-P2; 141 §3 (3,559-patch attack distribution)',
    fix: 'Set the amp-EG attack to its floor and do the shaping in the filter EG — the professional idiom (141 §3.3: 65-68% of leads/plucks/basses/sequences leave amp attack at the INIT minimum, while only 8-33% leave decay at default).',
  },
  {
    feature: 'crestDb', assumesNormalized: true, bound: 'atLeast:25', lever: 'engine', source: '131 §6 (broadband crest ref 15.2-20.2 dB vs engineplus 12.1-14.0)',
    fix: 'Sharpen transients (transient shaper node). Note the two-scale rule: broadband crest must go UP while per-band crest goes DOWN — see the crestSubDb check.',
  },
]

const MOVEMENT = [
  {
    feature: 'fluxMean', bound: 'atLeast:25', lever: 'composition + patch', source: '131 §7-P3 (fluxMean d +1.06 in the core matchup)',
    fix: 'Give notes somewhere to go: filter-env / LFO depth so the timbre evolves, plus more onsets and velocity contrast. The per-note expression surface (velocity tiers, swing, chance, ratchets, humanize) is built and unused (135 §D).',
  },
  {
    feature: 'onsetRatePerSec', bound: 'atLeast:25', lever: 'composition', source: '131 §7-P3 (ref chords 4.9/s vs engineplus 2.3, surge 1.3)',
    fix: 'Add onsets — ghost notes, ratchets, a busier figure. If the source is surge, check the tempo binding FIRST: surge renders every tempo-synced patch at a hard-coded 120 BPM (132 §2.3), whose fingerprint is exactly this number collapsing to ~1.3/s.',
  },
  {
    feature: 'attackCv', bound: 'atLeast:25', lever: 'composition (MIDI expression)', source: '131 §2.1 (attackCv P(win|hi) 0.631 globally)',
    fix: 'Vary the articulation: velocity tiers and humanize, so not every note has the same attack. Uniform attacks are what a rendered-dry patch sounds like.',
  },
]

const TEXTURE = [
  {
    feature: 'flatnessHiDb', bound: 'band:25,90', lever: 'sound source', source: '131 §7-P4 (winning refs are NOISIER at 2-8 kHz, d +0.66)',
    fix: 'TOO CLEAN in the presence region. Add in-band texture: a second layer, a noise oscillator, saturation or an exciter (133 §5).',
    fixHigh: 'TOO NOISY in the presence region — this is gen\'s failure mode, not the synths\' (131 §3.3). Back OFF saturation/exciter/noise, or low-pass the top layer. Overshooting the texture target loses for the opposite reason to undershooting it.',
  },
  {
    feature: 'slopeDbPerOct', bound: 'band:10,90', lever: 'production', source: '131 §3.1 (ref tilt 2.1 dB/oct darker) and §3.3 (the band)',
    fix: 'TOO DARK — the spectrum falls off faster than the reference band. Lift the top with a gentle high shelf, or open the filter cutoff.',
    fixHigh: 'TOO BRIGHT — the spectrum is flatter than the reference band. Darken it: a gentle high shelf DOWN, or a lower filter cutoff. Winning refs are spectrally darker than the clips they beat (131 §3.1, ~2 dB/oct).',
  },
]

const LOWEND = [
  {
    feature: 'crestSubDb', bound: 'atMost:75', lever: 'patch + production', source: '131 §1(c), §7-P1 (engineplus sub crest 24.3 dB vs ref 7.2)',
    fix: 'Steady the low end: bass-mono the sub, cut filter-env depth on the sub oscillator, and let the sustain sit. A flapping sub is measurably worse than no sub — this axis runs BACKWARDS from broadband crest.',
  },
]

const WIDTH = [
  {
    feature: 'widthMeanDb', bound: 'band:10,90', lever: 'production', source: '131 §7-P5 (elite ref bass -43 dB mono, elite ref lead -4.6 dB; the frozen engineplus constant is -10..-12 everywhere)',
    fix: 'TOO NARROW for this role. Widen it in the production profile (the `width` field of the role profile in src/analysis/produce.ts, or `beat set <track>.width`).',
    fixHigh: 'TOO WIDE for this role. Narrow it in the production profile (the `width` field of the role profile, or `beat set <track>.width`); for bass, go to mono. Width is a PLACEMENT variable, not a more-is-better one, and the frozen engineplus constant (-10..-12 everywhere) is wrong in both directions.',
  },
]


// The absolute targets research 131 §7 states in prose, per role. The EFFECTIVE bound is the
// STRICTER of these and the ref percentile, and the JSON records both plus which one won.
//
// Why both: the percentiles are the empirical bar (what the owner's own reference clips actually
// do) and are self-updating, but some are degenerate — the 22 packs bassline refs are bimodal on
// sub content, so their p25 for bandSubPct is 1.1%, which would gate nothing. The doc targets are
// the owner's stated bar and are stable. Taking the stricter of the two keeps a check that means
// something without letting either source silently soften it.
const DOC_TARGETS = {
  bassline: {
    bandSubPct: { min: 30, source: '131 §7-P1 ("bandSubPct >= 30%", ref med 60.1)' },
    centroidLog2: { max: 6.5, source: '131 §7-P1 ("centroid <= ~90 Hz", log2 6.2-6.5)' },
    crestSubDb: { max: 11, source: '131 §7-P1 ("crest_subDb <= ~11 dB"; ref 7.2, engineplus 24.3)' },
    widthMeanDb: { max: -40, source: '131 §7-P1/P5 ("width <= -40 dB"; elite ref bass -43 to -51)' },
    truePeakDb: { min: -5, source: '131 §7-P2 ("truePeakDb >= -5 dB after batch normalization")' },
    fluxMean: { min: 0.17, source: '131 §7-P3 ("fluxMean >= 0.17")' },
  },
  chords: {
    truePeakDb: { min: -5, source: '131 §7-P2' },
    crestDb: { min: 15, source: '131 §7-P2 ("crestDb 15-18 dB on chords/lead/drums")' },
    attackMedMs: { max: 12, source: '131 §7-P2 ("attackMedMs <= 12 ms chords", now 30.2)' },
    fluxMean: { min: 0.17, source: '131 §7-P3' },
    onsetRatePerSec: { min: 4, source: '131 §7-P3 ("onsetRatePerSec >= 4 on chords"; ref 4.9 vs 2.3)' },
    attackCv: { min: 0.7, source: '131 §7-P3 ("attackCv ~0.7-0.8")' },
    onsetLevelCv: { min: 0.5, source: '131 §7-P3 ("onsetLevelCv >= 0.5 on chords/lead")' },
    flatnessHiDb: { min: -16, max: -8, source: '131 §7-P4 ("flatnessHiDb -16..-8 dB")' },
    slopeDbPerOct: { min: -14, max: -10, source: '131 §7-P4 ("slope at -10..-14 dB/oct on melodic roles")' },
    crestSubDb: { max: 20, source: '131 §7-P6 / §1(c) (low-end steadiness)' },
    widthMeanDb: { max: -0.5, source: '131 §7-P5 (chords ~-5 dB)' },
  },
  lead: {
    truePeakDb: { min: -5, source: '131 §7-P2' },
    crestDb: { min: 15, source: '131 §7-P2' },
    attackMedMs: { max: 8, source: '131 §7-P2 ("<= 8 ms lead", now 26.6)' },
    fluxMean: { min: 0.17, source: '131 §7-P3' },
    attackCv: { min: 0.7, source: '131 §7-P3' },
    flatnessHiDb: { min: -16, max: -8, source: '131 §7-P4' },
    slopeDbPerOct: { min: -14, max: -10, source: '131 §7-P4' },
    crestSubDb: { max: 20, source: '131 §7-P6 / §1(c); lead crest_subDb is the role\'s single strongest discriminator (131 §2.2, P(win|hi) 0.281)' },
  },
  'drum-loop': {
    sustainPct: { min: 45, source: '131 §7-P6 ("sustainPct >= 45%"; ref 51 vs 27)' },
    envRangeDb: { max: 25, source: '131 §7-P6 ("envRangeDb <= ~25"; vs 44)' },
    onsetLevelCv: { max: 0.6, source: '131 §7-P6 ("onsetLevelCv <= 0.6"; ref 0.59 vs 0.87)' },
    crestSubDb: { max: 20, source: '131 §7-P6 ("crest_subDb <= ~20 dB")' },
    truePeakDb: { min: -5, source: '131 §7-P2' },
    crestDb: { min: 15, source: '131 §7-P2' },
  },
}

const ROLE_CHECKS = {
  bassline: [
    {
      feature: 'bandSubPct', bound: 'atLeast:25', lever: 'composition + patch', source: '131 §7-P1 (ref bass 60.1% sub vs engineplus 0.22% — the single biggest per-role hole)',
      fix: 'Put the figure an octave down (root E1-A1) and raise the patch\'s `subLevel` from 0 to ~0.5; `osc2Detune -1200` adds body. All three knobs exist today (133 §4).',
    },
    {
      feature: 'centroidLog2', bound: 'atMost:75', lever: 'composition', source: '131 §2.2, §7-P1 (ref bass centroid ~74 Hz vs engineplus ~162 Hz, over an octave high)',
      fix: 'The bass is written too high, not filtered wrong. Drop the figure an octave before reaching for the filter.',
    },
    ...LOWEND, ...PUNCH, ...MOVEMENT, ...WIDTH,
  ],
  chords: [...PUNCH, ...MOVEMENT, ...TEXTURE, ...LOWEND, ...WIDTH,
    {
      feature: 'onsetLevelCv', bound: 'atLeast:25', lever: 'composition (MIDI expression)', source: '131 §7-P3 (ref chords onsetLevelCv 0.51 vs engineplus 0.26)',
      fix: 'Vary hit-to-hit level — velocity tiers and accents. Every note at the same level is the machine-gun signature.',
    },
  ],
  lead: [...PUNCH, ...MOVEMENT, ...TEXTURE, ...LOWEND, ...WIDTH],
  'drum-loop': [
    {
      feature: 'sustainPct', bound: 'atLeast:25', lever: 'composition + kit', source: '131 §7-P6 (ref 51% vs engineplus 27%)',
      fix: 'Fill the holes: fills, ghost hits, layered percussion, longer tails. Winning drum loops are fuller and STEADIER, not spikier (131 §2.2 — envStdDb and crest_mids both run backwards here).',
    },
    {
      feature: 'envRangeDb', bound: 'atMost:75', lever: 'composition + kit', source: '131 §7-P6 (ref envRange 22 dB vs engineplus 44)',
      fix: 'Same fix as sustainPct: the range is wide because the pattern has holes, not because the hits are dynamic.',
    },
    {
      feature: 'onsetLevelCv', bound: 'atMost:75', lever: 'kit', source: '131 §5 (refs\' hits are consistent at 0.59; the synth kit\'s are all-or-nothing at 0.87)',
      fix: 'Even out hit levels — the synth kit is all-or-nothing where a real kit is consistent. Note this bound runs OPPOSITE to chords/lead, where level variety wins.',
    },
    ...PUNCH, ...LOWEND, ...WIDTH,
  ],
}

// ---- emit --------------------------------------------------------------------------------------

const roles = {}
for (const [role, checks] of Object.entries(ROLE_CHECKS)) {
  const perFeature = byRole.get(role)
  if (perFeature === undefined) {
    console.error(`no ${REF_POOL} reference clips for role "${role}" — skipping`)
    continue
  }
  const emitted = []
  const refDist = {}
  for (const check of checks) {
    const values = perFeature.get(check.feature)
    if (values === undefined || values.length < 5) {
      console.error(`role ${role}: only ${values?.length ?? 0} ref values for ${check.feature} — check dropped`)
      continue
    }
    const d = dist(values)
    refDist[check.feature] = d
    const [kind, arg] = check.bound.split(':')
    const at = (p) => d[`p${p}`] ?? d.median
    const entry = { feature: check.feature, bound: kind, lever: check.lever, source: check.source, fix: check.fix, ref: d }
    if (check.fixHigh !== undefined) entry.fixHigh = check.fixHigh
    if (check.assumesNormalized === true) entry.assumesNormalized = true
    const empirical = {}
    if (kind === 'atLeast') empirical.min = at(arg)
    else if (kind === 'atMost') empirical.max = at(arg)
    else {
      const [a, b] = arg.split(',')
      empirical.min = at(a)
      empirical.max = at(b)
    }
    entry.refPercentile = { bound: check.bound, ...empirical }
    const doc = (DOC_TARGETS[role] ?? {})[check.feature]
    if (doc !== undefined) entry.docTarget = doc
    // Effective bound = the STRICTER of the empirical percentile and the doc's stated target,
    // then CLAMPED so it can never exclude this role's own median reference clip.
    //
    // That clamp is the lesson of research 134 §5, learned the expensive way: the ring gate was
    // set from a global intuition and turned out to reject 22% of the owner's own Splice leads —
    // "the screens reject the quality bar itself". Several of 131 §7's targets are stated
    // GLOBALLY ("fluxMean >= 0.17") while the doc's own per-role table shows the range is
    // 0.17-0.26 BY ROLE; applied to bassline, whose ref median is 0.166, the global number would
    // fail more than half of the owner's winning bassline references. A screen that rejects the
    // median reference clip for its role is measuring the wrong thing, so the clamp is a hard
    // invariant, asserted in test/rolecheck.test.ts.
    const clampedFrom = []
    if (empirical.min !== undefined) {
      const stricter = doc?.min !== undefined ? Math.max(empirical.min, doc.min) : empirical.min
      entry.min = Math.min(stricter, d.median)
      entry.minFrom = entry.min < stricter ? 'refMedianClamp' : doc?.min !== undefined && doc.min > empirical.min ? 'doc' : 'refPercentile'
      if (entry.min < stricter) clampedFrom.push(`min ${round(stricter)} -> ref median ${d.median}`)
    }
    if (empirical.max !== undefined) {
      const stricter = doc?.max !== undefined ? Math.min(empirical.max, doc.max) : empirical.max
      entry.max = Math.max(stricter, d.median)
      entry.maxFrom = entry.max > stricter ? 'refMedianClamp' : doc?.max !== undefined && doc.max < empirical.max ? 'doc' : 'refPercentile'
      if (entry.max > stricter) clampedFrom.push(`max ${round(stricter)} -> ref median ${d.median}`)
    }
    if (clampedFrom.length > 0) {
      entry.clamped = clampedFrom
      console.error(`  clamped ${role}/${check.feature}: ${clampedFrom.join('; ')} (a screen must not reject its role's median reference clip)`)
    }
    emitted.push(entry)
  }
  // ---- calibrate the OVERALL verdict on the same reference pool ----------------------------
  //
  // A usability pilot (2026-07-26) found the defect this fixes, and it is the same defect in a new
  // costume. Clamping each bound to its role's median makes every INDIVIDUAL check pass most
  // reference clips — but the verdict was an AND over 8-11 of them, and even a 25%-per-check miss
  // rate compounds to 0.75^10 = 5.6% joint pass. Measured: 157 of 159 reference clips (98.7%)
  // failed the overall verdict of the targets mined from those very clips. A gate that rejects
  // 99% of the bar carries no information and costs the user nothing but time — research 134 §5
  // one more time.
  //
  // So the bar is a MISS BUDGET calibrated on the pool: `maxMisses` is the 75th percentile of how
  // many checks the role's own reference clips miss, so roughly three quarters of the owner's
  // winning references clear it. The realized pass rate is written into the artifact and printed
  // by `beat rolecheck`, because the number that makes the caveats concrete is exactly the one
  // that was missing.
  const refVectors = vectorsByRole.get(role) ?? []
  const missCounts = refVectors.map((v) => emitted.filter((c) => {
    const x = v[c.feature]
    if (typeof x !== 'number' || !Number.isFinite(x)) return false
    return (c.min !== undefined && x < c.min) || (c.max !== undefined && x > c.max)
  }).length).sort((a, b) => a - b)
  const maxMisses = missCounts.length > 0 ? Math.round(pct(missCounts, 75)) : 0
  const refPassRate = missCounts.length > 0 ? missCounts.filter((m) => m <= maxMisses).length / missCounts.length : 0
  const lufs = refVectors.map((v) => v.lufs).filter(Number.isFinite)
  console.error(`  ${role}: reference clips miss ${missCounts[0]}-${missCounts[missCounts.length - 1]} of ${emitted.length} checks (median ${Math.round(pct(missCounts, 50))}); verdict bar set at <= ${maxMisses} misses, cleared by ${(100 * refPassRate).toFixed(0)}% of them`)
  roles[role] = {
    refClips: refVectors.length,
    verdict: {
      maxMisses,
      refPassRate: Math.round(refPassRate * 1000) / 1000,
      refMissCounts: { min: missCounts[0] ?? 0, p25: round(pct(missCounts, 25)), median: round(pct(missCounts, 50)), p75: round(pct(missCounts, 75)), max: missCounts[missCounts.length - 1] ?? 0 },
      note: 'A clip FAILS only when it misses MORE checks than this role\'s own reference clips typically do. Calibrated so ~75% of the owner\'s winning references clear the bar; an AND over every check rejected 98.7% of them.',
    },
    refLufs: lufs.length > 0 ? dist(lufs) : null,
    checks: emitted,
    refDistribution: refDist,
  }
}

const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  generator: 'scripts/build-role-targets.mjs',
  note: 'Per-role audio targets for `beat rolecheck`. Every threshold is a PERCENTILE of the owner\'s own packs-era Splice reference clips for that role — the pool D26 names as the bar — measured with the same extractor the critic uses. Regenerate whenever the ref pool grows. Aggregates only: no filenames, no per-clip values, no audio (D25).',
  provenance: {
    log: logPath.replace(repoRoot + '/', ''),
    refPool: REF_POOL,
    refClipsTotal: clipCount,
    extractor: `src/metrics/analyze.ts + src/metrics/rich.ts, FEATURE_SET_VERSION ${FEATURE_SET_VERSION}`,
    docs: ['docs/research/131-quality-gap-empirical.md §2, §5, §7', 'docs/research/138-splice-parity-plan.md §2, §3-B2', 'docs/research/141-preset-parameter-ground-truth.md §3, §5', 'docs/research/140-research-action-audit.md D26'],
    caveats: [
      'Observational, not causal (131 §8): matching a target does not guarantee the rating moves. These are pre-batch screens, not a proof of quality.',
      'Percentile bounds mean roughly a quarter of the owner\'s own winning refs would themselves miss any given atLeast:25 check. rolecheck is a "did this clip land in the reference band" screen, not a quality verdict — 134 measured what happens when a screen is treated as the bar (the ring gate rejects 22% of the owner\'s own leads).',
      'Attack-time extraction is heuristic (131 §8): treat exact ms thresholds as +/-30%.',
      'Roughness is deliberately absent: 123 and 131 §4 both concluded it has no valid ABSOLUTE threshold.',
      'LEVEL-DEPENDENT CHECKS ASSUME BATCH NORMALIZATION. The reference clips were measured inside loudness-normalized showdown batches (common LUFS, -1 dBTP ceiling, 131 §1), so truePeakDb and crestDb targets only mean what they say on audio normalized the same way. Checking a raw un-normalized stem will report a truePeakDb miss that is an artifact of its level, not of its transients — normalize first, or read that row as advisory.',
    ],
  },
  roles,
}

writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`)
console.log(`wrote ${outPath.replace(repoRoot + '/', '')}: ${Object.keys(roles).length} roles, ${clipCount} ${REF_POOL} ref clips`)
for (const [role, r] of Object.entries(roles)) console.log(`  ${role.padEnd(10)} ${String(r.refClips).padStart(3)} ref clips, ${r.checks.length} checks, fail above ${r.verdict.maxMisses} misses (${(100 * r.verdict.refPassRate).toFixed(0)}% of refs pass)`)
if (argv.includes('--print')) console.log(JSON.stringify(out, null, 2))
