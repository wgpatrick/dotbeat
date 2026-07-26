// Preset-retargeting feature set — the SCALAR discriminators research/131 measured, computed in
// TypeScript so the retarget loop can score a render without a python round trip.
//
// WHY A NEW MODULE and not `src/taste/features.ts`: FEATURE_KEYS is the critic's *frozen* training
// vector (13 keys, append-only, guarded by tests) and 131 §4's headline is that those 13 literally
// cannot see the top discriminators — flux, per-band crest, attack statistics, flatness. Rather
// than mutate a frozen eval surface from a prototype stream, this module computes the extra axes
// standalone; a future B0 critic upgrade can import them.
//
// DEFINITIONS follow research/131 §1's descriptions of its scratch pipeline (`richfeat.py`):
//   - fluxMean/P95 — half-wave-rectified spectral flux over UNIT-NORMALIZED STFT magnitude frames
//     (level-invariant "movement"),
//   - flatness{,Hi,Lo}Db — geometric/arithmetic mean power ratio, overall / 2-8 kHz / 100-500 Hz,
//   - slopeDbPerOct — least-squares tilt of dB magnitude vs log2(f) over 100 Hz-10 kHz,
//   - crest_<band>Db — p95 minus p50 of that band's per-frame energy, in dB,
//   - envStdDb / sustainPct — statistics of the log-RMS envelope,
//   - onsetRatePerSec / attackMedMs / attackP25Ms / attackCv / onsetLevelCv — 10->90% rise times at
//     flux-picked onsets on a 2 ms envelope,
//   - widthMeanDb — mean of per-50 ms-frame 20*log10(rms(S)/rms(M)).
//
// HONEST CAVEAT, stated where it bites: these are RE-IMPLEMENTATIONS from prose, not ports of
// 131's python. Absolute values need not agree with the numbers quoted in that doc. That is why
// `targets.ts` derives its role targets by running THIS code over the owner's own pack-ref pool
// (docs/research/138 B2's "regenerated from data, never hand-tuned") instead of transcribing
// 131's medians — the target and the measurement then live in the same units by construction.
//
// Everything here is pure: (channels, sampleRate) in, numbers out. No fs, no spawn.

import { analyze } from '../metrics/analyze.js'
import { integratedLoudness } from '../metrics/loudness.js'
import { fft } from '../metrics/analyze.js'

/** The LUFS every clip is gained to before features are computed. Level-dependent axes (truePeak,
 * crest) are only comparable at a common loudness — 131's clips came from loudness-normalized
 * batches, so the retarget pipeline normalizes too. The value is arbitrary; only commonality
 * matters. No true-peak ceiling is applied: a ceiling would clip exactly the transient life the
 * truePeak target is trying to measure. */
export const RETARGET_REF_LUFS = -16

const FFT_SIZE = 2048
const HOP = 512
/** Envelope resolution for attack-time extraction (131 §8: "a 2 ms envelope"). */
const ENV_MS = 2
/** Width analysis frame (131 §1: "50 ms S/M frames"). */
const WIDTH_MS = 50

export interface RetargetFeatures {
  durationSeconds: number
  lufs: number
  // --- level / transients ---
  truePeakDb: number
  crestDb: number
  // --- register ---
  bandSubPct: number
  bandBassPct: number
  bandMidsPct: number
  bandPresencePct: number
  bandAirPct: number
  centroidHz: number
  // --- per-band steadiness (p95 - p50 of band frame energy) ---
  crestSubDb: number
  crestBassDb: number
  crestMidsDb: number
  crestPresenceDb: number
  // --- movement ---
  fluxMean: number
  fluxP95: number
  // --- texture ---
  flatnessDb: number
  flatnessHiDb: number
  flatnessLoDb: number
  slopeDbPerOct: number
  // --- articulation ---
  onsetRatePerSec: number
  attackMedMs: number
  attackP25Ms: number
  attackCv: number
  onsetLevelCv: number
  // --- envelope ---
  envStdDb: number
  sustainPct: number
  // --- placement ---
  widthMeanDb: number
}

/** Every key a target profile may reference. `durationSeconds`/`lufs` are context, not axes. */
export const RETARGET_FEATURE_KEYS = [
  'truePeakDb',
  'crestDb',
  'bandSubPct',
  'bandBassPct',
  'bandMidsPct',
  'bandPresencePct',
  'bandAirPct',
  'centroidHz',
  'crestSubDb',
  'crestBassDb',
  'crestMidsDb',
  'crestPresenceDb',
  'fluxMean',
  'fluxP95',
  'flatnessDb',
  'flatnessHiDb',
  'flatnessLoDb',
  'slopeDbPerOct',
  'onsetRatePerSec',
  'attackMedMs',
  'attackP25Ms',
  'attackCv',
  'onsetLevelCv',
  'envStdDb',
  'sustainPct',
  'widthMeanDb',
] as const satisfies readonly (keyof RetargetFeatures)[]

/** A scored/reported feature axis (excludes the `durationSeconds`/`lufs` context fields). */
export type RetargetFeatureKey = (typeof RETARGET_FEATURE_KEYS)[number]

// ---- small helpers -----------------------------------------------------------------------------

const SILENT_DB = -120

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]!
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q))
  const lo = Math.floor(pos)
  const hi = Math.min(sorted.length - 1, lo + 1)
  const frac = pos - lo
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac
}

/** Median of an UNSORTED list (copies). */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0
  return quantile([...xs].sort((a, b) => a - b), 0.5)
}

const mean = (xs: readonly number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}

function monoMix(channels: Float64Array[]): Float64Array {
  if (channels.length === 1) return channels[0]!
  const n = channels[0]!.length
  const out = new Float64Array(n)
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] = out[i]! + ch[i]! / channels.length
  return out
}

/** Gain every channel so the clip sits at RETARGET_REF_LUFS. Unmeasurable/silent clips pass
 * through untouched (their features will speak for themselves). */
export function normalizeToRefLufs(channels: Float64Array[], sampleRate: number): Float64Array[] {
  const { integratedLufs } = integratedLoudness(channels, sampleRate)
  if (!Number.isFinite(integratedLufs)) return channels
  const g = Math.pow(10, (RETARGET_REF_LUFS - integratedLufs) / 20)
  return channels.map((ch) => {
    const out = new Float64Array(ch.length)
    for (let i = 0; i < ch.length; i++) out[i] = ch[i]! * g
    return out
  })
}

const hannCache = new Map<number, Float64Array>()
function hann(n: number): Float64Array {
  let w = hannCache.get(n)
  if (!w) {
    w = new Float64Array(n)
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
    hannCache.set(n, w)
  }
  return w
}

/** Magnitude STFT frames (linear magnitude, fftSize/2+1 bins each). */
export function magnitudeStft(mono: Float64Array, sampleRate: number, fftSize = FFT_SIZE, hop = HOP): Float64Array[] {
  void sampleRate
  const w = hann(fftSize)
  const bins = fftSize / 2 + 1
  const frames: Float64Array[] = []
  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  const nFrames = Math.max(1, Math.floor((mono.length - fftSize) / hop) + 1)
  for (let f = 0; f < nFrames; f++) {
    const start = f * hop
    for (let i = 0; i < fftSize; i++) {
      re[i] = (mono[start + i] ?? 0) * w[i]!
      im[i] = 0
    }
    fft(re, im)
    const mag = new Float64Array(bins)
    for (let b = 0; b < bins; b++) mag[b] = Math.hypot(re[b]!, im[b]!)
    frames.push(mag)
  }
  return frames
}

// ---- movement: half-wave-rectified spectral flux over unit-normalized frames --------------------

export interface FluxResult {
  /** per-frame flux (frame 0 excluded) */
  values: number[]
  mean: number
  p95: number
}

/** 131's `fluxMean/P95`: each STFT magnitude frame is L2-normalized (so level cannot buy movement),
 * then flux_t = sum_b max(0, m_t[b] - m_{t-1}[b]). Silent frames contribute 0 rather than noise. */
export function spectralFlux(frames: Float64Array[]): FluxResult {
  const unit: Float64Array[] = frames.map((m) => {
    let sq = 0
    for (let b = 0; b < m.length; b++) sq += m[b]! * m[b]!
    const norm = Math.sqrt(sq)
    if (norm < 1e-12) return new Float64Array(m.length)
    const out = new Float64Array(m.length)
    for (let b = 0; b < m.length; b++) out[b] = m[b]! / norm
    return out
  })
  const values: number[] = []
  for (let f = 1; f < unit.length; f++) {
    const cur = unit[f]!
    const prev = unit[f - 1]!
    let sum = 0
    for (let b = 0; b < cur.length; b++) {
      const d = cur[b]! - prev[b]!
      if (d > 0) sum += d
    }
    values.push(sum)
  }
  const sorted = [...values].sort((a, b) => a - b)
  return { values, mean: mean(values), p95: quantile(sorted, 0.95) }
}

// ---- texture: flatness + tilt -------------------------------------------------------------------

/** Spectral flatness in dB (10*log10(geometric mean / arithmetic mean of power)) over [loHz,hiHz],
 * averaged over frames. 0 dB = white-ish noise, very negative = a pure tone. */
export function spectralFlatnessDb(frames: Float64Array[], sampleRate: number, loHz: number, hiHz: number, fftSize = FFT_SIZE): number {
  const binHz = sampleRate / fftSize
  const lo = Math.max(1, Math.floor(loHz / binHz))
  const hi = Math.min(frames[0]?.length ?? 1, Math.ceil(hiHz / binHz))
  if (hi <= lo) return SILENT_DB
  const perFrame: number[] = []
  for (const m of frames) {
    let logSum = 0
    let arith = 0
    let n = 0
    for (let b = lo; b < hi; b++) {
      const p = m[b]! * m[b]! + 1e-20
      logSum += Math.log(p)
      arith += p
      n++
    }
    if (n === 0 || arith <= 1e-19 * n) continue
    const geo = Math.exp(logSum / n)
    perFrame.push(10 * Math.log10(geo / (arith / n)))
  }
  return perFrame.length > 0 ? mean(perFrame) : SILENT_DB
}

/** Least-squares dB-per-octave tilt of the mean magnitude spectrum over [loHz, hiHz]. */
export function spectralSlopeDbPerOct(frames: Float64Array[], sampleRate: number, loHz = 100, hiHz = 10000, fftSize = FFT_SIZE): number {
  const binHz = sampleRate / fftSize
  const bins = frames[0]?.length ?? 0
  if (bins === 0 || frames.length === 0) return 0
  const avg = new Float64Array(bins)
  for (const m of frames) for (let b = 0; b < bins; b++) avg[b] = avg[b]! + (m[b]! * m[b]!) / frames.length
  const xs: number[] = []
  const ys: number[] = []
  const lo = Math.max(1, Math.floor(loHz / binHz))
  const hi = Math.min(bins, Math.ceil(Math.min(hiHz, sampleRate / 2) / binHz))
  for (let b = lo; b < hi; b++) {
    const hz = b * binHz
    xs.push(Math.log2(hz))
    ys.push(10 * Math.log10(avg[b]! + 1e-20))
  }
  if (xs.length < 4) return 0
  const mx = mean(xs)
  const my = mean(ys)
  let num = 0
  let den = 0
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my)
    den += (xs[i]! - mx) ** 2
  }
  return den > 0 ? num / den : 0
}

// ---- per-band crest ------------------------------------------------------------------------------

export const RETARGET_BANDS = {
  sub: [0, 60],
  bass: [60, 250],
  mids: [250, 2000],
  presence: [2000, 6000],
  air: [6000, 20000],
} as const

/** p95 - p50 of one band's per-frame energy, in dB — 131's `crest_<band>Db`. High = the band pumps;
 * low = the band sits. */
export function bandCrestDb(frames: Float64Array[], sampleRate: number, loHz: number, hiHz: number, fftSize = FFT_SIZE): number {
  const binHz = sampleRate / fftSize
  const bins = frames[0]?.length ?? 0
  const lo = Math.max(0, Math.floor(loHz / binHz))
  const hi = Math.min(bins, Math.ceil(hiHz / binHz))
  if (hi <= lo || frames.length === 0) return 0
  const energies: number[] = []
  for (const m of frames) {
    let e = 0
    for (let b = lo; b < hi; b++) e += m[b]! * m[b]!
    energies.push(e)
  }
  const peak = Math.max(...energies)
  if (peak <= 0) return 0
  // Frames more than 80 dB below the band's own peak are silence, not dynamics — including them
  // makes any clip with a gap read as infinitely "crest-y".
  const floor = peak * Math.pow(10, -80 / 10)
  const kept = energies.filter((e) => e > floor)
  if (kept.length < 2) return 0
  const sorted = kept.sort((a, b) => a - b)
  const p95 = quantile(sorted, 0.95)
  const p50 = quantile(sorted, 0.5)
  return 10 * Math.log10(Math.max(p95, 1e-20) / Math.max(p50, 1e-20))
}

// ---- envelope / onsets / attacks -----------------------------------------------------------------

/** Short-window RMS envelope at ENV_MS resolution (linear amplitude). */
export function fineEnvelope(mono: Float64Array, sampleRate: number): { env: Float64Array; hopSeconds: number } {
  const hop = Math.max(1, Math.round((sampleRate * ENV_MS) / 1000))
  const win = hop * 2
  const n = Math.max(1, Math.floor((mono.length - win) / hop) + 1)
  const env = new Float64Array(n)
  for (let f = 0; f < n; f++) {
    const start = f * hop
    let sq = 0
    for (let i = 0; i < win; i++) {
      const v = mono[start + i] ?? 0
      sq += v * v
    }
    env[f] = Math.sqrt(sq / win)
  }
  return { env, hopSeconds: hop / sampleRate }
}

export interface OnsetStats {
  onsetRatePerSec: number
  attackMedMs: number
  attackP25Ms: number
  attackCv: number
  onsetLevelCv: number
  count: number
}

/** Flux-picked onsets + 10->90% rise times on the fine envelope.
 *
 * Onset picking: a frame is an onset when its flux exceeds (median + 1.5 * (p75 - p25)) of the flux
 * distribution AND is a local maximum, with a 50 ms refractory window. Attack: from the onset's
 * envelope trough, the time to climb from 10% to 90% of the following local peak. Heuristic by
 * construction — 131 §8 says the same of its own extractor and puts +/-30% on the ms numbers. */
export function onsetStats(mono: Float64Array, sampleRate: number, flux: FluxResult, hop = HOP): OnsetStats {
  const durationSeconds = mono.length / sampleRate
  const vals = flux.values
  if (vals.length < 4 || durationSeconds <= 0) {
    return { onsetRatePerSec: 0, attackMedMs: 0, attackP25Ms: 0, attackCv: 0, onsetLevelCv: 0, count: 0 }
  }
  const sorted = [...vals].sort((a, b) => a - b)
  const thresh = quantile(sorted, 0.5) + 1.5 * (quantile(sorted, 0.75) - quantile(sorted, 0.25))
  const refractoryFrames = Math.max(1, Math.round((0.05 * sampleRate) / hop))
  const onsetFrames: number[] = []
  for (let i = 1; i < vals.length - 1; i++) {
    const v = vals[i]!
    if (v <= thresh) continue
    if (v < vals[i - 1]! || v < vals[i + 1]!) continue
    const last = onsetFrames[onsetFrames.length - 1]
    if (last !== undefined && i - last < refractoryFrames) {
      if (v > vals[last]!) onsetFrames[onsetFrames.length - 1] = i
      continue
    }
    onsetFrames.push(i)
  }
  const { env, hopSeconds } = fineEnvelope(mono, sampleRate)
  const attacksMs: number[] = []
  const levels: number[] = []
  const searchFrames = Math.max(2, Math.round(0.25 / hopSeconds)) // look at most 250 ms past an onset
  for (const of_ of onsetFrames) {
    // flux frame f covers samples [f*hop, f*hop+FFT); the onset is near its start (+1 because
    // flux index 0 compares STFT frames 0 and 1).
    const sampleIdx = (of_ + 1) * hop
    const e0 = Math.max(0, Math.round(sampleIdx / (hopSeconds * sampleRate)) - 2)
    let peakIdx = e0
    let peak = 0
    for (let i = e0; i < Math.min(env.length, e0 + searchFrames); i++) {
      if (env[i]! > peak) {
        peak = env[i]!
        peakIdx = i
      }
    }
    if (peak <= 1e-9) continue
    levels.push(peak)
    const lo = 0.1 * peak
    const hi = 0.9 * peak
    let iLo = -1
    let iHi = -1
    for (let i = e0; i <= peakIdx; i++) {
      if (iLo < 0 && env[i]! >= lo) iLo = i
      if (iLo >= 0 && env[i]! >= hi) {
        iHi = i
        break
      }
    }
    if (iLo < 0 || iHi < 0 || iHi < iLo) continue
    attacksMs.push((iHi - iLo) * hopSeconds * 1000)
  }
  const attackMed = attacksMs.length > 0 ? median(attacksMs) : 0
  const attackP25 = attacksMs.length > 0 ? quantile([...attacksMs].sort((a, b) => a - b), 0.25) : 0
  const attackCv = attacksMs.length > 1 && mean(attacksMs) > 0 ? stdev(attacksMs) / mean(attacksMs) : 0
  const levelCv = levels.length > 1 && mean(levels) > 0 ? stdev(levels) / mean(levels) : 0
  return {
    onsetRatePerSec: onsetFrames.length / durationSeconds,
    attackMedMs: attackMed,
    attackP25Ms: attackP25,
    attackCv,
    onsetLevelCv: levelCv,
    count: onsetFrames.length,
  }
}

/** Log-RMS envelope statistics over 23 ms frames: spread (envStdDb) and the share of frames within
 * 20 dB of the clip's own loud level (sustainPct — "is this thing playing, or is it holes"). */
export function envelopeStats(mono: Float64Array, sampleRate: number): { envStdDb: number; sustainPct: number } {
  const win = Math.max(64, Math.round(sampleRate * 0.023))
  const hop = Math.max(32, Math.round(win / 2))
  const n = Math.max(1, Math.floor((mono.length - win) / hop) + 1)
  const db: number[] = []
  for (let f = 0; f < n; f++) {
    const start = f * hop
    let sq = 0
    for (let i = 0; i < win; i++) {
      const v = mono[start + i] ?? 0
      sq += v * v
    }
    db.push(10 * Math.log10(sq / win + 1e-20))
  }
  const sorted = [...db].sort((a, b) => a - b)
  const loud = quantile(sorted, 0.95)
  const kept = db.filter((v) => v > loud - 60) // ignore true digital silence
  const sustain = db.filter((v) => v > loud - 20).length / db.length
  return { envStdDb: stdev(kept.length > 1 ? kept : db), sustainPct: sustain * 100 }
}

// ---- width ---------------------------------------------------------------------------------------

/** Mean per-frame side/mid ratio in dB over 50 ms frames. Mono renders return -120 (the honest
 * degenerate value: there IS no side signal). */
export function widthMeanDb(channels: Float64Array[], sampleRate: number): number {
  if (channels.length < 2) return SILENT_DB
  const l = channels[0]!
  const r = channels[1]!
  const win = Math.max(64, Math.round((sampleRate * WIDTH_MS) / 1000))
  const n = Math.max(1, Math.floor(Math.min(l.length, r.length) / win))
  const vals: number[] = []
  for (let f = 0; f < n; f++) {
    let sSq = 0
    let mSq = 0
    for (let i = f * win; i < (f + 1) * win; i++) {
      const mid = (l[i]! + r[i]!) / 2
      const side = (l[i]! - r[i]!) / 2
      mSq += mid * mid
      sSq += side * side
    }
    if (mSq < 1e-16 && sSq < 1e-16) continue
    vals.push(10 * Math.log10((sSq + 1e-20) / (mSq + 1e-20)))
  }
  return vals.length > 0 ? mean(vals) : SILENT_DB
}

// ---- the public entry point -----------------------------------------------------------------------

/** Compute every retarget feature for one decoded clip. Loudness-normalizes first (see
 * RETARGET_REF_LUFS) so level-dependent axes are comparable across sources. */
export function computeRetargetFeatures(channelsIn: Float64Array[], sampleRate: number): RetargetFeatures {
  const channels = normalizeToRefLufs(channelsIn, sampleRate)
  const mono = monoMix(channels)
  const m = analyze(channels, sampleRate)
  const frames = magnitudeStft(mono, sampleRate)
  const flux = spectralFlux(frames)
  const onsets = onsetStats(mono, sampleRate, flux)
  const env = envelopeStats(mono, sampleRate)
  const nyquist = sampleRate / 2
  return {
    durationSeconds: mono.length / sampleRate,
    lufs: Number.isFinite(m.integratedLufs) ? m.integratedLufs : SILENT_DB,
    truePeakDb: Number.isFinite(m.truePeakDbtp) ? m.truePeakDbtp : SILENT_DB,
    crestDb: Number.isFinite(m.crestDb) ? m.crestDb : 0,
    bandSubPct: m.spectral.bandsPct.sub,
    bandBassPct: m.spectral.bandsPct.bass,
    bandMidsPct: m.spectral.bandsPct.mids,
    bandPresencePct: m.spectral.bandsPct.presence,
    bandAirPct: m.spectral.bandsPct.air,
    centroidHz: m.spectral.centroidHz,
    crestSubDb: bandCrestDb(frames, sampleRate, RETARGET_BANDS.sub[0], RETARGET_BANDS.sub[1]),
    crestBassDb: bandCrestDb(frames, sampleRate, RETARGET_BANDS.bass[0], RETARGET_BANDS.bass[1]),
    crestMidsDb: bandCrestDb(frames, sampleRate, RETARGET_BANDS.mids[0], RETARGET_BANDS.mids[1]),
    crestPresenceDb: bandCrestDb(frames, sampleRate, RETARGET_BANDS.presence[0], RETARGET_BANDS.presence[1]),
    fluxMean: flux.mean,
    fluxP95: flux.p95,
    flatnessDb: spectralFlatnessDb(frames, sampleRate, 50, Math.min(16000, nyquist)),
    flatnessHiDb: spectralFlatnessDb(frames, sampleRate, 2000, Math.min(8000, nyquist)),
    flatnessLoDb: spectralFlatnessDb(frames, sampleRate, 100, 500),
    slopeDbPerOct: spectralSlopeDbPerOct(frames, sampleRate, 100, Math.min(10000, nyquist)),
    onsetRatePerSec: onsets.onsetRatePerSec,
    attackMedMs: onsets.attackMedMs,
    attackP25Ms: onsets.attackP25Ms,
    attackCv: onsets.attackCv,
    onsetLevelCv: onsets.onsetLevelCv,
    envStdDb: env.envStdDb,
    sustainPct: env.sustainPct,
    widthMeanDb: widthMeanDb(channels, sampleRate),
  }
}
