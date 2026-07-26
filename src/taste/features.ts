// Per-variant feature extraction for the taste model (docs/taste-loop-design.md L1;
// docs/research/107-taste-model-program.md). A variant's feature vector is the flat, numeric
// projection of the deterministic mix metrics (src/metrics/analyze.ts) — the same ground-truth
// numbers `beat metrics` prints, shaped for a learner: every value finite, every key stable.
//
// Two shaping choices that matter downstream:
// - dB values of digital silence (-Infinity) clamp to SILENCE_DB so vectors stay finite.
// - The spectral centroid enters as log2(Hz) — pitch/brightness perception is logarithmic, and a
//   linear-Hz feature would let 8 kHz-vs-7 kHz dominate 100 Hz-vs-50 Hz, which is backwards.
//
// Feature VALUES are stored raw (per-batch standardization happens at training time in
// ranker.ts, not here) so the log stays an honest record of what was measured, and future
// models are free to normalize differently.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { analyze, analyzeRich, decodeWav } from '../metrics/index.js'
import type { MixMetrics, RichMetrics } from '../metrics/index.js'

/** Clamp for -Infinity dB readings (true digital silence). */
const SILENCE_DB = -80

// ================================================================================================
// THE APPEND-ONLY RULING (research 140 §4.4; resolved 2026-07-26 with the audit below)
// ================================================================================================
//
// The question two prior agents declined: "is FEATURE_KEYS append-only-safe?" The old docstring
// here ASSERTED it was. **It was not.** Appending a key to the v1 array would have silently
// degraded the critic rather than upgrading it, by three independent mechanisms — every one of
// them verified by reading the consumers, not inferred:
//
//   (1) THE MIXED-POPULATION ZERO. `standardizeBatch` (ranker.ts) maps FEATURE_KEYS over each
//       vector, so a record written before the append yields `undefined` in the new column.
//       `zScoreColumns` then computed mean -> NaN, std -> NaN, and `NaN > 1e-9` is FALSE, so the
//       guard skipped the write and the column kept its pre-filled 0 — FOR EVERY ROW, including
//       the freshly-computed vectors that DID carry a real value. One stale vector anywhere in a
//       z-scoring population silently deleted the new feature for the whole population. (Fixed in
//       this pass: zScoreColumns now takes its statistics over the finite entries only.)
//   (2) THE UNUPGRADEABLE LOG. `loadTasteBatches` uses a record's stored `features` verbatim and
//       only computes when the field is ABSENT (eval.ts), and `beat taste-eval --backfill`
//       explicitly refuses any record that already has `features` (cli/beat.mjs). So the 213
//       rated batches in examples/taste-t1/beat-scores.jsonl could never acquire a new key by any
//       shipped command — they would stay v1 forever while new batches were v2, permanently
//       triggering (1). (Fixed in this pass: version-aware upgrade-on-read + backfill.)
//   (3) THE STALE CURATION CACHE. scripts/curate-engine-presets.mjs caches a whole FeatureVector
//       per candidate and re-admits it on a truthiness check (`prev.dsp`) keyed to PROBE_VERSION,
//       which knew nothing about FEATURE_KEYS — so a curation run would mix cached v1 vectors with
//       fresh v2 ones and hit (1). (Fixed in this pass: PROBE_VERSION bumped, and the cache now
//       validates the stored vector's feature-set version.)
//
// What IS safe, and why the answer isn't simply "no": nothing persists model weights (ranker.ts
// retrains per invocation, by design), nothing stores vectors positionally (the log stores named
// JSON objects), nothing hashes or cache-keys on the key list, and zScoreColumns is strictly
// per-column so an added column provably cannot move an existing one. The danger was never
// *reordering*; it was *silent partial coverage*.
//
// THE RULING: option (a) of 140 §4.4 — append + retrain + re-baseline — but ONLY with the three
// fixes above plus an explicit VERSION and the key-set snapshot test that 140 §4.4 and 136 §5 both
// asked for and neither got (test/taste.test.ts). Order and membership of FEATURE_KEYS_V1 stay
// frozen forever: v1 vectors are still readable, and a v1-vs-v2 mismatch is now DETECTABLE
// (featureSetVersionOf) instead of collapsing to a zero column. Appending to FEATURE_KEYS in
// future is safe if and only if you bump FEATURE_SET_VERSION with it and update the snapshot test
// — the version is what makes stale coverage loud.

/** The original 13 keys (2026-07-17 .. 2026-07-26). FROZEN — every historical `features` object in
 * every beat-scores.jsonl has exactly these. Never reorder, never remove, never add. */
export const FEATURE_KEYS_V1 = [
  'lufs',
  'samplePeakDb',
  'truePeakDb',
  'crestDb',
  'rmsDb',
  'bandSubPct',
  'bandBassPct',
  'bandMidsPct',
  'bandPresencePct',
  'bandAirPct',
  'centroidLog2',
  'stereoCorrelation',
  'stereoWidthDb',
] as const

/** The 23 axes research 131 §4 measured as the real discriminators — spectral movement, per-band
 * crest, attack statistics, presence-region texture, spectral tilt, envelope steadiness, stereo
 * field over time. Held-out pairwise accuracy on the owner's 1,612 preferences: v1 alone 0.676,
 * these alone 0.730, together 0.796 (owner self-consistency ceiling 0.917). Units are pinned to
 * research 131's own extractor by test/metrics-rich.test.ts. Roughness is deliberately NOT here:
 * 131 §4 measured it at P(win|hi) 0.486 and found winning refs ROUGHER than the clips they beat,
 * so it stays a pair-relative diagnostic exactly as research 123 concluded. */
export const FEATURE_KEYS_V2_ADDED = [
  'fluxMean',
  'fluxP95',
  'fluxStd',
  'flatnessDb',
  'flatnessHiDb',
  'flatnessLoDb',
  'slopeDbPerOct',
  'crestSubDb',
  'crestBassDb',
  'crestMidsDb',
  'crestPresenceDb',
  'crestAirDb',
  'envStdDb',
  'envRangeDb',
  'sustainPct',
  'envFluxDb',
  'onsetRatePerSec',
  'attackMedMs',
  'attackP25Ms',
  'attackCv',
  'onsetLevelCv',
  'widthMeanDb',
  'widthStdDb',
] as const

/** The stable feature-key order every consumer indexes by. Append-only AND version-bumped — see
 * the ruling above. */
export const FEATURE_KEYS = [...FEATURE_KEYS_V1, ...FEATURE_KEYS_V2_ADDED] as const

/** Bump this WITH any change to FEATURE_KEYS. It is what makes a stale stored vector detectable
 * instead of silently zeroing its column for a whole population. */
export const FEATURE_SET_VERSION = 2

export type FeatureKey = (typeof FEATURE_KEYS)[number]
export type FeatureVector = Record<FeatureKey, number>

/** Which feature-set version a stored vector satisfies: 2 = complete, 1 = the frozen original 13
 * only, 0 = neither (corrupt or partially written). Used to decide whether a logged record needs
 * recomputing before it can train or score anything. */
export function featureSetVersionOf(vector: Record<string, unknown> | undefined | null): 0 | 1 | 2 {
  if (vector === undefined || vector === null) return 0
  const has = (k: string) => typeof vector[k] === 'number' && Number.isFinite(vector[k] as number)
  if (!FEATURE_KEYS_V1.every(has)) return 0
  return FEATURE_KEYS_V2_ADDED.every(has) ? 2 : 1
}

const finiteDb = (x: number) => (Number.isFinite(x) ? x : SILENCE_DB)

/** The FEATURE_KEYS_V1 subset, which derives from MixMetrics alone. Consumers that only reason
 * about loudness / bands / centroid / stereo (the layered target gate, recipe gate checks) call
 * this instead of running a second rich DSP pass they'd discard — but there is exactly ONE
 * mapping from metrics to each v1 key, so the two can never drift. */
export function metricsToBaseFeatures(m: MixMetrics): Pick<FeatureVector, (typeof FEATURE_KEYS_V1)[number]> {
  return {
    lufs: finiteDb(m.integratedLufs),
    samplePeakDb: finiteDb(m.samplePeakDbfs),
    truePeakDb: finiteDb(m.truePeakDbtp),
    crestDb: finiteDb(m.crestDb),
    rmsDb: finiteDb(m.rmsDbfs),
    bandSubPct: m.spectral.bandsPct.sub,
    bandBassPct: m.spectral.bandsPct.bass,
    bandMidsPct: m.spectral.bandsPct.mids,
    bandPresencePct: m.spectral.bandsPct.presence,
    bandAirPct: m.spectral.bandsPct.air,
    centroidLog2: Math.log2(Math.max(20, m.spectral.centroidHz)),
    // mono renders: perfectly correlated, no width — the honest degenerate values
    stereoCorrelation: m.stereo?.correlation ?? 1,
    stereoWidthDb: finiteDb(m.stereo?.widthDb ?? -Infinity),
  }
}

/** Flatten MixMetrics (+ the rich DSP pass) into the stable numeric vector. */
export function metricsToFeatures(m: MixMetrics, rich: RichMetrics): FeatureVector {
  return {
    ...metricsToBaseFeatures(m),
    fluxMean: rich.fluxMean,
    fluxP95: rich.fluxP95,
    fluxStd: rich.fluxStd,
    flatnessDb: rich.flatnessDb,
    flatnessHiDb: rich.flatnessHiDb,
    flatnessLoDb: rich.flatnessLoDb,
    slopeDbPerOct: rich.slopeDbPerOct,
    crestSubDb: rich.crestSubDb,
    crestBassDb: rich.crestBassDb,
    crestMidsDb: rich.crestMidsDb,
    crestPresenceDb: rich.crestPresenceDb,
    crestAirDb: rich.crestAirDb,
    envStdDb: rich.envStdDb,
    envRangeDb: rich.envRangeDb,
    sustainPct: rich.sustainPct,
    envFluxDb: rich.envFluxDb,
    onsetRatePerSec: rich.onsetRatePerSec,
    attackMedMs: rich.attackMedMs,
    attackP25Ms: rich.attackP25Ms,
    attackCv: rich.attackCv,
    onsetLevelCv: rich.onsetLevelCv,
    widthMeanDb: rich.widthMeanDb,
    widthStdDb: rich.widthStdDb,
  }
}

/** Sidecar cache path for one render's feature vector, matching the `<wav>.embedding.json` /
 * `<wav>.aesthetics.json` convention in src/taste/embeddings.ts. Unlike those two this cache is
 * derivable in milliseconds from the wav alone, so it is gitignored rather than committed — its
 * only job is to keep a whole-log re-feature pass (1,100 clips) from costing minutes on repeat. */
const featureCachePath = (audioPath: string) => `${audioPath}.features.json`

interface FeatureCacheEntry {
  sha256?: string
  version?: number
  features?: Record<string, number>
}

/** Decode + analyze one audio file into a feature vector, or null when the file is missing or
 * unreadable (a batch that was never rendered is normal, not an error). With `cache: true` the
 * result is memoized in a `<wav>.features.json` sidecar pinned to the audio's sha256 AND the
 * feature-set version — a version bump invalidates every entry, which is the whole point. */
export function featuresForAudioFile(path: string, opts: { cache?: boolean } = {}): FeatureVector | null {
  if (!existsSync(path)) return null
  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch {
    return null
  }
  const sha = opts.cache === true ? createHash('sha256').update(bytes).digest('hex') : ''
  const cachePath = featureCachePath(path)
  if (opts.cache === true && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as FeatureCacheEntry
      if (cached.sha256 === sha && cached.version === FEATURE_SET_VERSION && featureSetVersionOf(cached.features) === FEATURE_SET_VERSION) {
        return cached.features as FeatureVector
      }
    } catch {
      /* unreadable cache — recompute */
    }
  }
  let features: FeatureVector
  try {
    const decoded = decodeWav(bytes)
    features = metricsToFeatures(analyze(decoded.channels, decoded.sampleRate), analyzeRich(decoded.channels, decoded.sampleRate))
  } catch {
    return null
  }
  if (opts.cache === true) {
    try {
      writeFileSync(cachePath, `${JSON.stringify({ sha256: sha, version: FEATURE_SET_VERSION, features })}\n`)
    } catch {
      /* an unwritable batch dir is not a reason to fail the read */
    }
  }
  return features
}

/** Feature vectors for a batch dir's variants, keyed by the variant's manifest `file` name.
 * The render for a variant `file` sits next to it with a .wav extension ("v3.beat" -> "v3.wav");
 * gen batches' variants already ARE .wav files. Only variants with a present, decodable render
 * get an entry — an empty result means "nothing rendered here". */
export function computeBatchFeatures(dir: string, files: string[], opts: { cache?: boolean } = {}): Record<string, FeatureVector> {
  const out: Record<string, FeatureVector> = {}
  for (const file of files) {
    const wav = file.endsWith('.wav') ? file : file.replace(/\.beat$/, '.wav')
    const features = featuresForAudioFile(resolve(dir, wav), opts)
    if (features !== null) out[file] = features
  }
  return out
}
