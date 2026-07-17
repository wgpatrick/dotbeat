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

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { analyze, decodeWav } from '../metrics/index.js'
import type { MixMetrics } from '../metrics/index.js'

/** Clamp for -Infinity dB readings (true digital silence). */
const SILENCE_DB = -80

/** The stable feature-key order every consumer indexes by. Append-only: removing or reordering
 * keys silently breaks any model trained on earlier logs. */
export const FEATURE_KEYS = [
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

export type FeatureKey = (typeof FEATURE_KEYS)[number]
export type FeatureVector = Record<FeatureKey, number>

const finiteDb = (x: number) => (Number.isFinite(x) ? x : SILENCE_DB)

/** Flatten MixMetrics into the stable numeric vector. */
export function metricsToFeatures(m: MixMetrics): FeatureVector {
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

/** Decode + analyze one audio file into a feature vector, or null when the file is missing or
 * unreadable (a batch that was never rendered is normal, not an error). */
export function featuresForAudioFile(path: string): FeatureVector | null {
  if (!existsSync(path)) return null
  try {
    const decoded = decodeWav(readFileSync(path))
    return metricsToFeatures(analyze(decoded.channels, decoded.sampleRate))
  } catch {
    return null
  }
}

/** Feature vectors for a batch dir's variants, keyed by the variant's manifest `file` name.
 * The render for a variant `file` sits next to it with a .wav extension ("v3.beat" -> "v3.wav");
 * gen batches' variants already ARE .wav files. Only variants with a present, decodable render
 * get an entry — an empty result means "nothing rendered here". */
export function computeBatchFeatures(dir: string, files: string[]): Record<string, FeatureVector> {
  const out: Record<string, FeatureVector> = {}
  for (const file of files) {
    const wav = file.endsWith('.wav') ? file : file.replace(/\.beat$/, '.wav')
    const features = featuresForAudioFile(resolve(dir, wav))
    if (features !== null) out[file] = features
  }
  return out
}
