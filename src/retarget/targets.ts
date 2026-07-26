// Role-aware TARGET PROFILES for preset retargeting — "what does a good <role> clip measure like?"
//
// Every number below is one of two things, and each row says which:
//   (a) a threshold research/131 §7 / research/138 §2 states in words (e.g. "bandSubPct >= 30%",
//       "attacks <= 8 ms on lead", "crest 15-18 dB"), or
//   (b) a quantile of the OWNER'S OWN pack-ref pool measured with src/retarget/features.ts, via
//       `node scripts/mine-retarget-targets.mjs` (run 2026-07-26: bassline n=32, chords n=49,
//       lead n=59 clips from taste-dataset/refs-packs, median duration 7.6-7.7 s).
//
// (b) exists because features.ts re-implements 131's definitions from prose. Most axes reproduced
// that pipeline closely — bassline centroid p50 76.2 Hz vs 131's 74; chords truePeak p50 -1.7 vs
// its -1.7; chords flatnessHiDb p25..p75 -20.5..-10.5 vs its "-16..-8" band; chords slope p50
// -12.9 vs its "-10..-14"; lead attackP25 p25 7.0 ms vs its "<=8 ms"; bassline crest_sub p50 5.4
// vs its 7.2 — but TWO DID NOT, and those use (b) exclusively:
//   * fluxMean/fluxP95 run ~4-5x higher here than 131's numbers (a different frame-normalization
//     convention). "fluxMean >= 0.17" is meaningless in these units; the flux rows use ref
//     quantiles instead.
//   * attackMedMs reads roughly 2x slower here than 131's extractor. Both are heuristic (131 §8
//     puts +/-30% on its own ms thresholds). attackP25Ms — where the two agree — carries the
//     weight; attackMedMs is reported but not scored.
//
// WEIGHTS are 131's measured effect sizes, not opinions: mostly |paired d| from §3.1's packs-era
// ref-beat-engineplus head-to-head (the exact matchup this program is trying to win), with §2.2's
// per-role discriminators where the head-to-head has no row. Each target carries its `basis`.
//
// DELIBERATELY NOT SCORED: widthMeanDb. 131 P5's role width map is real, but dotbeat's engine
// renders a solo synth voice in MONO, so width is a production-profile decision, not something a
// patch parameter can move — scoring it would hand the optimizer a free, meaningless axis. It is
// carried as an INFORMATIONAL row so before/after tables still show it. (Same reasoning kills
// aesPQ/aesCE as targets: 131 §7 measured both inverting against the owner's preferences.)

import type { RetargetFeatureKey, RetargetFeatures } from './features.js'

export type TargetKind = 'atLeast' | 'atMost' | 'band'

export interface FeatureTarget {
  key: RetargetFeatureKey
  kind: TargetKind
  /** lower edge — required for 'atLeast' and 'band'. */
  lo?: number
  /** upper edge — required for 'atMost' and 'band'. */
  hi?: number
  /** feature units that count as ONE unit of miss (roughly the ref pool's IQR on that axis). */
  scale: number
  /** relative importance — 131's measured effect size for this axis in this role. */
  weight: number
  /** where the threshold and the weight came from. */
  basis: string
}

export interface RoleTargetProfile {
  role: string
  /** the scored axes. */
  targets: FeatureTarget[]
  /** axes that are NOT targets but define the preset's character — the "don't break what's already
   * right" set. Drift beyond PRESERVE_FREE_BAND scale units is penalized (see loss.ts). */
  preserve: readonly RetargetFeatureKey[]
  /** shown in before/after tables, never scored. */
  informational: readonly RetargetFeatureKey[]
  note: string
}

/** Feature-unit scales shared by the preserve term and by any target that doesn't override.
 * Set to the pack-ref pool's rough inter-quartile spread on that axis (mine-retarget-targets.mjs,
 * 2026-07-26) so "one unit of miss" means "one typical clip's worth of difference". */
export const RETARGET_FEATURE_SCALES: Record<RetargetFeatureKey, number> = {
  truePeakDb: 3.5,
  crestDb: 4,
  bandSubPct: 20,
  bandBassPct: 20,
  bandMidsPct: 25,
  bandPresencePct: 3,
  bandAirPct: 1,
  centroidHz: 300,
  crestSubDb: 10,
  crestBassDb: 8,
  crestMidsDb: 8,
  crestPresenceDb: 10,
  fluxMean: 0.5,
  fluxP95: 1.2,
  flatnessDb: 20,
  flatnessHiDb: 10,
  flatnessLoDb: 10,
  slopeDbPerOct: 5,
  onsetRatePerSec: 2.5,
  attackMedMs: 25,
  attackP25Ms: 20,
  attackCv: 0.35,
  onsetLevelCv: 0.2,
  envStdDb: 5,
  sustainPct: 25,
  widthMeanDb: 8,
}

const t = (
  key: RetargetFeatureKey,
  kind: TargetKind,
  edges: { lo?: number; hi?: number },
  weight: number,
  basis: string,
  scale?: number,
): FeatureTarget => ({ key, kind, ...edges, scale: scale ?? RETARGET_FEATURE_SCALES[key], weight, basis })

/** The identity axes every pitched role preserves unless it targets them. */
const PITCHED_PRESERVE: readonly RetargetFeatureKey[] = ['bandPresencePct', 'bandAirPct', 'flatnessLoDb', 'envStdDb', 'sustainPct', 'onsetLevelCv', 'attackCv']

const BASSLINE: RoleTargetProfile = {
  role: 'bassline',
  note:
    'Register + steady sub is 131 headline 4 ("the single biggest per-role hole") and 138 rung 1. ' +
    'Every threshold here is reachable by patch alone via subLevel/osc2Detune/cutoff — the octave-down ' +
    'figure lever (138 §2 row 2) is composition and out of this scope, so a preset that cannot reach ' +
    'bandSubPct from the patch space is a real ceiling finding, not a bug.',
  targets: [
    t('bandSubPct', 'atLeast', { lo: 30 }, 1.2, '131 §7 P1 "bandSubPct >= 30% (ref med 60.1)"; ref pool p25 10.2 / p50 50.1. Weight from 131 headline 4 + §5 (bassline shows 12 features |d|>1).'),
    t('centroidHz', 'atMost', { hi: 90 }, 1.0, '131 §7 P1 "centroid <= ~90 Hz (ref 74)"; ref pool p50 76.2 Hz — the two pipelines agree here.', 60),
    t('crestSubDb', 'atMost', { hi: 11 }, 0.74, '131 §7 P1 "crest_subDb <= ~11 dB (ref 7.2)"; ref pool p50 5.4 / p75 11.2. Weight = §3.1 paired d -0.74.'),
    t('crestBassDb', 'atMost', { hi: 8 }, 0.54, 'ref pool p75 7.1 dB. Weight = 131 §3.1 paired d -0.54 (crest_bassDb).'),
    t('fluxMean', 'atLeast', { lo: 0.15 }, 1.06, 'ref pool p25 0.150 (131 P3 in THESE units — see the module header on the flux scale mismatch). Weight = §3.1 paired d +1.06.'),
    t('truePeakDb', 'atLeast', { lo: -8 }, 1.38, 'ref pool p25 -8.0 dB. Weight = 131 §3.1 paired d +1.38 (the strongest head-to-head axis in the log).'),
    t('crestDb', 'band', { lo: 6, hi: 12 }, 0.69, 'ref pool p25 6.0 / p75 12.1 dB (bass is the one role whose broadband crest band sits low). Weight = §3.1 paired d +0.69.'),
    t('crestMidsDb', 'atLeast', { lo: 6 }, 0.5, '131 §2.2 bassline top discriminator crest_midsDb 0.689/+0.50 ("winners\' midrange MOVES"); ref pool p25 6.0 dB.'),
    t('bandMidsPct', 'atMost', { hi: 10 }, 0.4, 'ref pool p75 3.5%. Keeps the register fix from being bought by pushing energy up into the mids.'),
  ],
  preserve: PITCHED_PRESERVE,
  informational: ['widthMeanDb', 'attackMedMs', 'flatnessHiDb', 'slopeDbPerOct', 'onsetRatePerSec'],
}

const CHORDS: RoleTargetProfile = {
  role: 'chords',
  note:
    'Punch + movement + in-band texture (138 rung 2). 131 §2.2 makes chords the role where aesPC ' +
    'discriminates hardest (0.835/+0.91) and where fast attacks win outright (attackP25Ms 0.361/-0.51).',
  targets: [
    t('truePeakDb', 'atLeast', { lo: -5 }, 1.38, '131 §7 P2 "truePeakDb >= -5 dB after normalization"; ref pool p25 -3.9. Weight = §3.1 paired d +1.38.'),
    t('fluxMean', 'atLeast', { lo: 0.63 }, 1.06, 'ref pool p25 0.630 (131 P3 in these units). Weight = §3.1 paired d +1.06.'),
    t('attackP25Ms', 'atMost', { hi: 12 }, 0.63, '131 §7 P2 "attackMedMs <= 12 ms chords"; ref pool p25 6.0 ms on the quartile where the two extractors agree. Weight = §3.1 paired d -0.63.'),
    t('crestDb', 'band', { lo: 14, hi: 19 }, 0.69, '131 §7 P2 "crestDb 15-18 dB"; ref pool p25 15.1 / p75 18.8. Weight = §3.1 paired d +0.69.'),
    t('flatnessHiDb', 'band', { lo: -20, hi: -10 }, 0.66, '131 §7 P4 "flatnessHiDb -16..-8 dB" (a BAND — 131 §3.3: gen overshoots into hiss); ref pool p25 -20.5 / p75 -10.5. Weight = §3.1 paired d +0.66.'),
    t('bandMidsPct', 'atMost', { hi: 90 }, 0.6, '138 §2 row 3 "bandMidsPct 99 -> <= 90"; ref pool p75 91.9%.'),
    t('bandBassPct', 'atLeast', { lo: 15 }, 0.6, '138 §2 row 3 "chords bass-band 18-28%"; ref pool p50 23.1%.'),
    t('slopeDbPerOct', 'band', { lo: -16, hi: -8 }, 0.47, '131 §3.3 "slope -10..-14 dB/oct on melodic roles"; ref pool p25 -15.9 / p75 -8.7. Weight = §3.1 paired d -0.47.'),
    t('crestSubDb', 'atMost', { hi: 22 }, 0.4, 'ref pool p75 21.7 dB — a chord patch should not flap in a band it barely occupies.'),
    t('onsetRatePerSec', 'atLeast', { lo: 4 }, 0.3, '131 §7 P3 "onsetRatePerSec >= 4 on chords"; ref pool p50 4.5. LOW weight on purpose: onset rate is dominated by the composed figure, not the patch (131 P3 names composition as the lever).'),
  ],
  preserve: PITCHED_PRESERVE,
  informational: ['widthMeanDb', 'attackMedMs', 'centroidHz', 'crestMidsDb'],
}

const LEAD: RoleTargetProfile = {
  role: 'lead',
  note:
    'Presence-region texture + fast attacks + movement. 131 §2.2 lead: crest_subDb 0.281/-0.59 ' +
    '(junk sub-band flapping loses hardest here) and flatnessHiDb 0.690/+0.59 (presence air/noise wins).',
  targets: [
    t('truePeakDb', 'atLeast', { lo: -5 }, 1.38, '131 §7 P2 "truePeakDb >= -5 dB"; ref pool p25 -4.5. Weight = §3.1 paired d +1.38.'),
    t('fluxMean', 'atLeast', { lo: 0.7 }, 1.06, 'ref pool p25 0.695 (131 P3 in these units). Weight = §3.1 paired d +1.06.'),
    t('crestSubDb', 'atMost', { hi: 15 }, 0.9, 'ref pool p50 14.8 dB. Weight from 131 §2.2 lead crest_subDb 0.281/-0.59 — raised over the §3.1 global -0.74 because this is the role where it discriminates hardest.'),
    t('attackP25Ms', 'atMost', { hi: 8 }, 0.63, '131 §7 P2 "attackMedMs <= 8 ms lead"; ref pool p25 7.0 ms — the two pipelines agree on this quartile. Weight = §3.1 paired d -0.63.'),
    t('flatnessHiDb', 'band', { lo: -24, hi: -8 }, 0.66, '131 §7 P4 band; ref pool p25 -24.4 / p75 -8.6, §5 elite lead -15.8. Weight = §3.1 paired d +0.66.'),
    t('crestDb', 'band', { lo: 14, hi: 19 }, 0.69, '131 §7 P2 "crestDb 15-18"; ref pool p25 13.9 / p75 19.2. Weight = §3.1 paired d +0.69.'),
    t('crestPresenceDb', 'atLeast', { lo: 9 }, 0.5, '131 §5 lead: elite refs crest_presence 19.8 vs engineplus 9.9 dB; ref pool p25 9.3.'),
    t('bandMidsPct', 'atMost', { hi: 90 }, 0.6, '138 §2 row 3 (engineplus lead sits at 99.2% mids); ref pool p50 83.9%.'),
    t('slopeDbPerOct', 'band', { lo: -12, hi: -4 }, 0.47, 'ref pool p25 -11.9 / p75 -4.7 (leads tilt brighter than chords). Weight = §3.1 paired d -0.47.'),
  ],
  preserve: PITCHED_PRESERVE,
  informational: ['widthMeanDb', 'attackMedMs', 'centroidHz', 'bandBassPct'],
}

const PROFILES: Record<string, RoleTargetProfile> = { bassline: BASSLINE, chords: CHORDS, lead: LEAD }

/** The roles a target profile exists for. drum-loop is absent on purpose: 131 P6's drum targets ' +
 * (sustain, envRange, onsetLevelCv) are composition/kit levers, not synth-patch parameters. */
export const RETARGET_ROLES: readonly string[] = ['bassline', 'chords', 'lead']

export function targetProfileFor(role: string): RoleTargetProfile {
  const p = PROFILES[role]
  if (!p) throw new Error(`no retarget target profile for role "${role}" (have: ${RETARGET_ROLES.join(', ')})`)
  return p
}

/** How far outside its target region a feature value sits, in SCALE units. 0 when satisfied —
 * there is never credit for overshooting, which is what stops the loss rewarding a single gamed
 * axis (the width-hack lesson: 131 §5 found engineplus already WIDER than the refs beating it). */
export function targetMiss(target: FeatureTarget, value: number): number {
  if (!Number.isFinite(value)) return 0
  const s = target.scale > 0 ? target.scale : 1
  switch (target.kind) {
    case 'atLeast':
      return Math.max(0, ((target.lo ?? 0) - value) / s)
    case 'atMost':
      return Math.max(0, (value - (target.hi ?? 0)) / s)
    case 'band':
      return Math.max(0, ((target.lo ?? 0) - value) / s, (value - (target.hi ?? 0)) / s)
  }
}

/** True when the value sits inside the target region. */
export function targetSatisfied(target: FeatureTarget, value: number): boolean {
  return targetMiss(target, value) <= 0
}

/** Human-readable target region, for report tables. */
export function describeTarget(target: FeatureTarget): string {
  switch (target.kind) {
    case 'atLeast':
      return `>= ${target.lo}`
    case 'atMost':
      return `<= ${target.hi}`
    case 'band':
      return `${target.lo} .. ${target.hi}`
  }
}

/** Every key a role's profile touches (scored + preserved + informational), in report order. */
export function profileKeys(profile: RoleTargetProfile): RetargetFeatureKey[] {
  const seen = new Set<RetargetFeatureKey>()
  const out: RetargetFeatureKey[] = []
  for (const k of [...profile.targets.map((x) => x.key), ...profile.preserve, ...profile.informational]) {
    if (seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

/** Convenience: read a feature by key (features carry two non-axis fields the profiles never use). */
export function featureValue(features: RetargetFeatures, key: RetargetFeatureKey): number {
  return features[key]
}
