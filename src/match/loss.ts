// The `beat match` loss — how close does a candidate render sound to the target chop?
// (taste-loop T6, docs/taste-loop-design.md; recipe from research/107 §2.3.)
//
// Composite of the three ingredients the sound-matching literature converged on:
//   - log-mel MULTI-SCALE spectral distance (mel-STFT at three FFT sizes — the INSTRUMENTAL
//     objective's core; multi-scale so both transients and sustained spectra register),
//   - MFCC distance (competitive with deep embeddings against human timbre ratings —
//     ISMIR 2025, arXiv:2507.07764 — and the report's headline metric),
//   - envelope distance (log-RMS frames; DTW-free but frame-aligned, which is enough because
//     candidate and target are both note-onset-at-zero one-shots by construction).
//
// What is deliberately NOT in the loss: pitch (frozen from f0 detection before the search starts —
// spectral losses are provably bad at pitch params, Turian & Henry 2020) and loudness (target and
// every candidate are gain-normalized to a common LUFS via the BS.1770 module before any feature
// is computed, so the optimizer cannot buy loss with level).
//
// Everything is computed at a common ANALYSIS_RATE mono representation; inputs at other sample
// rates are linearly resampled. Pure TS, zero deps; the only imports are the repo's own FFT and
// loudness modules.

import { fft } from '../metrics/analyze.js'
import { integratedLoudness } from '../metrics/loudness.js'

/** Common analysis sample rate. 22050 covers 0-11 kHz — where timbre lives — and halves the FFT
 * work per render vs 44.1k. */
export const ANALYSIS_RATE = 22050

/** The common loudness every signal is gained to before feature extraction, LUFS. The value is
 * arbitrary (only commonality matters); -20 keeps float headroom for hot transients. */
export const MATCH_TARGET_LUFS = -20

/** The three STFT scales of the mel loss: fft size, hop, mel bands. */
const MEL_SCALES = [
  { fftSize: 2048, hop: 512, mels: 64 },
  { fftSize: 1024, hop: 256, mels: 48 },
  { fftSize: 512, hop: 128, mels: 32 },
] as const

const MFCC_COUNT = 13
const MFCC_MELS = 40
const MFCC_FFT = 1024
const MFCC_HOP = 256

const ENV_WIN = 1024
const ENV_HOP = 256

const LOG_EPS = 1e-10
/** Mel powers are floored at this many dB below the spectrogram's own peak band before the log —
 * the loss matches audible content, not noise floors: without a RELATIVE floor, inaudible junk
 * (-60..-90 dB resampler images, capture/dither noise) dominates every empty band's log
 * difference and drowns the audible spectrum. */
const MEL_FLOOR_DB = 60

// Loss component weights — chosen so each component lands in the same rough magnitude on typical
// mismatches (see test/match-loss.test.ts's separation assertions), not tuned per target.
const W_MEL = 1.0
const W_MFCC = 0.02
const W_ENV = 0.3

export interface MatchLossDetail {
  total: number
  mel: number
  mfcc: number
  envelope: number
  /** Raw mean per-frame MFCC euclidean distance — the report's headline number (unweighted). */
  mfccDistance: number
}

/** Precomputed target-side features, so the per-candidate cost is one feature pass, not two. */
export interface PreparedTarget {
  samples: Float64Array
  melSpecs: Float64Array[][] // per scale: frames of mel bands
  mfccFrames: Float64Array[]
  envelope: Float64Array
  lengthSamples: number
}

// ---- signal prep ------------------------------------------------------------------------------

/** Mean-mix to mono. */
export function monoMix(channels: Float64Array[]): Float64Array {
  if (channels.length === 1) return channels[0]!
  const n = channels[0]!.length
  const out = new Float64Array(n)
  for (const ch of channels) {
    for (let i = 0; i < n; i++) out[i] = out[i]! + ch[i]! / channels.length
  }
  return out
}

/** Linear-interpolation resampler. Fine for analysis features (we are not making audio). */
export function resampleLinear(x: Float64Array, fromRate: number, toRate: number): Float64Array {
  if (fromRate === toRate) return x
  const outLen = Math.max(1, Math.round((x.length * toRate) / fromRate))
  const out = new Float64Array(outLen)
  const ratio = fromRate / toRate
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(i0 + 1, x.length - 1)
    const frac = pos - i0
    out[i] = x[i0]! * (1 - frac) + x[i1]! * frac
  }
  return out
}

/** Gain a mono signal to MATCH_TARGET_LUFS (BS.1770 integrated, via the repo's own loudness
 * module). Signals too short/quiet to measure (< 400 ms of gated blocks) fall back to RMS
 * normalization; digital silence is returned untouched (its loss will speak for itself). */
export function normalizeLoudness(mono: Float64Array, sampleRate: number): Float64Array {
  const { integratedLufs } = integratedLoudness([mono], sampleRate)
  let gainDb: number
  if (Number.isFinite(integratedLufs)) {
    gainDb = MATCH_TARGET_LUFS - integratedLufs
  } else {
    let sq = 0
    for (let i = 0; i < mono.length; i++) sq += mono[i]! * mono[i]!
    const rms = Math.sqrt(sq / Math.max(1, mono.length))
    if (rms < 1e-9) return mono // silence — nothing to normalize
    gainDb = MATCH_TARGET_LUFS - (20 * Math.log10(rms) + 0.691) // rough LUFS-ish anchor
  }
  const g = Math.pow(10, gainDb / 20)
  const out = new Float64Array(mono.length)
  for (let i = 0; i < mono.length; i++) out[i] = mono[i]! * g
  return out
}

/** Decode-side prep shared by target and candidates: mono -> resample to ANALYSIS_RATE ->
 * loudness-normalize -> fix length (truncate/zero-pad to `lengthSamples` when given). */
export function prepareSignal(
  channels: Float64Array[],
  sampleRate: number,
  lengthSamples?: number,
): Float64Array {
  let mono = resampleLinear(monoMix(channels), sampleRate, ANALYSIS_RATE)
  mono = normalizeLoudness(mono, ANALYSIS_RATE)
  if (lengthSamples !== undefined && mono.length !== lengthSamples) {
    const out = new Float64Array(lengthSamples)
    out.set(mono.subarray(0, Math.min(mono.length, lengthSamples)))
    return out
  }
  return mono
}

// ---- features ---------------------------------------------------------------------------------

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

const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700)
const melToHz = (mel: number) => 700 * (Math.pow(10, mel / 2595) - 1)

const filterbankCache = new Map<string, Float64Array[]>()
/** Triangular mel filterbank over fftSize/2+1 magnitude bins. */
function melFilterbank(fftSize: number, mels: number, sampleRate: number): Float64Array[] {
  const key = `${fftSize}:${mels}:${sampleRate}`
  const cached = filterbankCache.get(key)
  if (cached) return cached
  const bins = fftSize / 2 + 1
  const fMin = 30
  const fMax = sampleRate / 2
  const melPoints = Array.from({ length: mels + 2 }, (_, i) => hzToMel(fMin) + ((hzToMel(fMax) - hzToMel(fMin)) * i) / (mels + 1))
  const hzPoints = melPoints.map(melToHz)
  const binOf = (hz: number) => (hz * fftSize) / sampleRate
  const bank: Float64Array[] = []
  for (let m = 0; m < mels; m++) {
    const filt = new Float64Array(bins)
    const left = binOf(hzPoints[m]!)
    const center = binOf(hzPoints[m + 1]!)
    const right = binOf(hzPoints[m + 2]!)
    for (let b = Math.max(0, Math.floor(left)); b < Math.min(bins, Math.ceil(right) + 1); b++) {
      if (b < center) {
        const v = (b - left) / Math.max(center - left, 1e-9)
        if (v > 0) filt[b] = v
      } else {
        const v = (right - b) / Math.max(right - center, 1e-9)
        if (v > 0) filt[b] = v
      }
    }
    bank.push(filt)
  }
  filterbankCache.set(key, bank)
  return bank
}

/** Log-mel spectrogram frames (natural log of mel power + eps). */
export function logMelSpectrogram(
  mono: Float64Array,
  fftSize: number,
  hop: number,
  mels: number,
  sampleRate = ANALYSIS_RATE,
): Float64Array[] {
  const window = hann(fftSize)
  const bank = melFilterbank(fftSize, mels, sampleRate)
  const frames: Float64Array[] = []
  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  const nFrames = Math.max(1, Math.floor((mono.length - fftSize) / hop) + 1)
  let maxPower = 0
  for (let f = 0; f < nFrames; f++) {
    const start = f * hop
    for (let i = 0; i < fftSize; i++) {
      re[i] = (mono[start + i] ?? 0) * window[i]!
      im[i] = 0
    }
    fft(re, im)
    const bins = fftSize / 2 + 1
    const power = new Float64Array(bins)
    for (let b = 0; b < bins; b++) power[b] = re[b]! * re[b]! + im[b]! * im[b]!
    const mel = new Float64Array(mels)
    for (let m = 0; m < mels; m++) {
      const filt = bank[m]!
      let sum = 0
      for (let b = 0; b < bins; b++) sum += filt[b]! * power[b]!
      mel[m] = sum // raw power for now; floored + logged below once the peak is known
      if (sum > maxPower) maxPower = sum
    }
    frames.push(mel)
  }
  const floor = Math.max(LOG_EPS, maxPower * Math.pow(10, -MEL_FLOOR_DB / 10))
  for (const frame of frames) {
    for (let m = 0; m < mels; m++) frame[m] = Math.log(Math.max(frame[m]!, floor))
  }
  return frames
}

/** MFCC frames: DCT-II of a 40-band log-mel, first MFCC_COUNT coefficients (c0 kept — inputs are
 * loudness-normalized, so c0 carries spectral flatness, not level). */
export function mfccFrames(mono: Float64Array, sampleRate = ANALYSIS_RATE): Float64Array[] {
  const mel = logMelSpectrogram(mono, MFCC_FFT, MFCC_HOP, MFCC_MELS, sampleRate)
  return mel.map((frame) => {
    const out = new Float64Array(MFCC_COUNT)
    for (let k = 0; k < MFCC_COUNT; k++) {
      let sum = 0
      for (let m = 0; m < MFCC_MELS; m++) sum += frame[m]! * Math.cos((Math.PI * k * (m + 0.5)) / MFCC_MELS)
      out[k] = sum
    }
    return out
  })
}

/** Log-RMS amplitude envelope, ENV_WIN windows at ENV_HOP. */
export function amplitudeEnvelope(mono: Float64Array): Float64Array {
  const nFrames = Math.max(1, Math.floor((mono.length - ENV_WIN) / ENV_HOP) + 1)
  const out = new Float64Array(nFrames)
  let maxRms = 0
  for (let f = 0; f < nFrames; f++) {
    const start = f * ENV_HOP
    let sq = 0
    for (let i = 0; i < ENV_WIN; i++) {
      const v = mono[start + i] ?? 0
      sq += v * v
    }
    const rms = Math.sqrt(sq / ENV_WIN)
    out[f] = rms
    if (rms > maxRms) maxRms = rms
  }
  // Same relative-floor discipline as the mel loss: the envelope compares audible level shape,
  // so anything below -60 dB of the envelope's own peak reads as silence.
  const floor = Math.max(LOG_EPS, maxRms * Math.pow(10, -MEL_FLOOR_DB / 20))
  for (let f = 0; f < nFrames; f++) out[f] = Math.log(Math.max(out[f]!, floor))
  return out
}

// ---- distances --------------------------------------------------------------------------------

function meanAbsFrames(a: Float64Array[], b: Float64Array[]): number {
  const frames = Math.min(a.length, b.length)
  if (frames === 0) return 0
  let sum = 0
  let count = 0
  for (let f = 0; f < frames; f++) {
    const fa = a[f]!
    const fb = b[f]!
    const len = Math.min(fa.length, fb.length)
    for (let i = 0; i < len; i++) {
      sum += Math.abs(fa[i]! - fb[i]!)
      count++
    }
  }
  return count > 0 ? sum / count : 0
}

function meanEuclidFrames(a: Float64Array[], b: Float64Array[]): number {
  const frames = Math.min(a.length, b.length)
  if (frames === 0) return 0
  let sum = 0
  for (let f = 0; f < frames; f++) {
    const fa = a[f]!
    const fb = b[f]!
    let sq = 0
    const len = Math.min(fa.length, fb.length)
    for (let i = 0; i < len; i++) sq += (fa[i]! - fb[i]!) ** 2
    sum += Math.sqrt(sq)
  }
  return sum / frames
}

/** Cosine similarity between two vectors (used for the CLAP-cosine report). */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom > 0 ? dot / denom : 0
}

// ---- the public loss --------------------------------------------------------------------------

/** Prepare the target once (features cached for every candidate evaluation). `channels` at
 * `sampleRate` as decoded; length defines the analysis window every candidate is cut/padded to. */
export function prepareTarget(channels: Float64Array[], sampleRate: number): PreparedTarget {
  const samples = prepareSignal(channels, sampleRate)
  return {
    samples,
    melSpecs: MEL_SCALES.map((s) => logMelSpectrogram(samples, s.fftSize, s.hop, s.mels)),
    mfccFrames: mfccFrames(samples),
    envelope: amplitudeEnvelope(samples),
    lengthSamples: samples.length,
  }
}

/** Loss of one candidate against a prepared target. `channels`/`sampleRate` as decoded from the
 * candidate's render; prep (mono/resample/normalize/length) happens in here. */
export function matchLoss(target: PreparedTarget, channels: Float64Array[], sampleRate: number): MatchLossDetail {
  const cand = prepareSignal(channels, sampleRate, target.lengthSamples)
  let mel = 0
  for (let s = 0; s < MEL_SCALES.length; s++) {
    const spec = logMelSpectrogram(cand, MEL_SCALES[s]!.fftSize, MEL_SCALES[s]!.hop, MEL_SCALES[s]!.mels)
    mel += meanAbsFrames(target.melSpecs[s]!, spec) / MEL_SCALES.length
  }
  const mfcc = meanEuclidFrames(target.mfccFrames, mfccFrames(cand))
  const envelope = meanAbsFrames([target.envelope], [amplitudeEnvelope(cand)])
  return {
    total: W_MEL * mel + W_MFCC * mfcc + W_ENV * envelope,
    mel,
    mfcc: W_MFCC * mfcc,
    envelope: W_ENV * envelope,
    mfccDistance: mfcc,
  }
}
