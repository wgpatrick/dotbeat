// Rich per-clip DSP metrics — the axes research 131 measured as the top discriminators of the
// owner's own blind preferences, and which the 13-key critic vector literally could not see:
// spectral movement (flux), presence-region noisiness (flatness), spectral tilt, PER-BAND crest,
// envelope statistics, onset/attack-time statistics, and stereo field over time.
//
// PROVENANCE — this is a deliberate, line-by-line port of the analysis pipeline that produced
// research 131's numbers (`~/.claude/jobs/fc3bd856/tmp/gapanalysis/richfeat.py`, 973 clips,
// 1,612 owner pairwise preferences). Doc 140 §2-D16 names the hazard this port exists to close:
// a second feature extractor had been forked whose flux ran "~4-5x higher" and whose attack times
// ran "~2x slower" than 131's pipeline — "two feature extractors whose units disagree is a hazard
// that compounds every day it persists." So the STFT geometry, the window, the activity mask, the
// epsilon floors, and the percentile interpolation here all match scipy's, and the port is guarded
// by a numeric parity test against the Python pipeline's own cached outputs
// (test/metrics-rich.test.ts + test/fixtures/rich-parity.json). If you change a constant in this
// file you are changing the units of every number research 131 published; don't.
//
// Two deliberate DEVIATIONS from the Python, both because a FeatureVector must stay finite:
// - a clip with no detectable onset gets attackMedMs/attackP25Ms = ATTACK_WINDOW_MS (the search
//   window itself: "no measurable attack" reads as the slowest measurable one) and
//   attackCv/onsetLevelCv = 0, where the Python emitted null and the analysis dropped the clip
//   from that column. Measured impact: 6 of 973 clips (0.6%).
// - a mono render gets widthMeanDb = WIDTH_FLOOR_DB / widthStdDb = 0 rather than a missing key —
//   dead mono is the honest value for a mono file, not an absence.

import { fft } from './analyze.js'

/** STFT geometry — richfeat.py's `N_FFT, HOP = 2048, 512`. */
const N_FFT = 2048
const HOP = 512

/** Band edges for the per-band crest features. NOTE these are richfeat.py's `BANDS`, which are
 * NOT the same as MixMetrics' `SpectralBands` edges (whose presence is 2-6k and air is >6k). The
 * 131 numbers were measured on these edges; the two sets coexist on purpose. */
const CREST_BANDS = [
  { name: 'sub', lo: 20, hi: 60 },
  { name: 'bass', lo: 60, hi: 250 },
  { name: 'mids', lo: 250, hi: 2000 },
  { name: 'presence', lo: 2000, hi: 8000 },
  { name: 'air', lo: 8000, hi: 16000 },
] as const

/** Attack search window (richfeat.py: `s0 + int(0.12 * sr)`), in ms — also the "no attack" value. */
export const ATTACK_WINDOW_MS = 120
/** Width floor for a mono render (richfeat.py clips wdb to [-80, 20]). */
export const WIDTH_FLOOR_DB = -80

export interface RichMetrics {
  /** half-wave-rectified spectral flux on UNIT-NORMALIZED STFT frames — level-invariant movement */
  fluxMean: number
  fluxP95: number
  fluxStd: number
  /** spectral flatness (geometric/arithmetic mean of frame power), dB; higher = noisier */
  flatnessDb: number // 100 Hz - 16 kHz
  flatnessHiDb: number // 2-8 kHz, the presence region
  flatnessLoDb: number // 100-500 Hz
  /** magnitude tilt over 100 Hz - 10 kHz, dB per octave (negative = darker) */
  slopeDbPerOct: number
  /** p95 - p50 of per-band frame energy in dB — dynamics per frequency region */
  crestSubDb: number
  crestBassDb: number
  crestMidsDb: number
  crestPresenceDb: number
  crestAirDb: number
  /** frame-energy envelope statistics, dB */
  envStdDb: number
  envRangeDb: number
  /** % of active frames within 12 dB of the envelope's p95 */
  sustainPct: number
  envFluxDb: number
  onsetRatePerSec: number
  /** 10->90% rise time at detected onsets, ms */
  attackMedMs: number
  attackP25Ms: number
  /** coefficient of variation of attack times — attack-time VARIETY */
  attackCv: number
  /** coefficient of variation of onset peak levels — hit-to-hit consistency */
  onsetLevelCv: number
  /** stereo side/mid ratio over 50 ms frames, dB */
  widthMeanDb: number
  widthStdDb: number
  /** onsets actually used for the attack statistics (0 => the attack fields are the fallback) */
  onsetCount: number
}

// ---- small numeric helpers, matched to numpy's semantics ---------------------------------------

/** numpy.percentile with the default linear interpolation. `sorted` must already be ascending. */
function percentileSorted(sorted: number[], q: number): number {
  const n = sorted.length
  if (n === 0) return 0
  if (n === 1) return sorted[0]!
  const pos = (q / 100) * (n - 1)
  const lo = Math.floor(pos)
  const hi = Math.min(lo + 1, n - 1)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}

const percentile = (xs: number[], q: number) => percentileSorted([...xs].sort((a, b) => a - b), q)

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length)

/** numpy.std — POPULATION standard deviation (ddof=0). */
function std(xs: number[]): number {
  if (xs.length === 0) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length)
}

/** scipy.signal.medfilt(x, k) — odd kernel, ZERO-padded at both edges. */
function medfilt(x: Float64Array, k: number): Float64Array {
  const half = (k - 1) / 2
  const out = new Float64Array(x.length)
  const window = new Array<number>(k)
  for (let i = 0; i < x.length; i++) {
    for (let j = 0; j < k; j++) {
      const idx = i + j - half
      window[j] = idx >= 0 && idx < x.length ? x[idx]! : 0
    }
    window.sort((a, b) => a - b)
    out[i] = window[half]!
  }
  return out
}

// ---- the STFT ----------------------------------------------------------------------------------

interface Stft {
  /** magnitude, [frame][bin], one-sided (N_FFT/2 + 1 bins) */
  mag: Float64Array[]
  /** bin centre frequencies, Hz */
  freqs: Float64Array
  frames: number
}

/**
 * scipy.signal.stft(x, fs, nperseg=2048, noverlap=1536, window='hann') to the precision that
 * matters here: PERIODIC hann, `boundary='zeros'` (nperseg/2 zeros prepended and appended),
 * `padded=True` (tail zero-padded to a whole number of hops), one-sided, and scaled by
 * 1/win.sum(). The scaling looks cosmetic but is NOT: `flat()` and the slope fit both add an
 * absolute epsilon floor (1e-14 / 1e-9) to the power, so the absolute magnitude scale changes
 * those two features. Getting this wrong is exactly how two extractors' units drift apart.
 */
function stft(mono: Float64Array, sampleRate: number): Stft {
  const half = N_FFT / 2
  const bins = half + 1
  // periodic hann (scipy's get_window default, sym=False)
  const win = new Float64Array(N_FFT)
  let winSum = 0
  for (let i = 0; i < N_FFT; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT)
    winSum += win[i]!
  }
  const scale = 1 / winSum
  // boundary='zeros': extend by nperseg//2 on each side
  const extended = new Float64Array(mono.length + N_FFT)
  extended.set(mono, half)
  // padded=True: how many whole hops fit
  const step = N_FFT - (N_FFT - HOP)
  const nFrames = extended.length < N_FFT ? 1 : Math.ceil((extended.length - N_FFT) / step) + 1
  const mag: Float64Array[] = []
  const re = new Float64Array(N_FFT)
  const im = new Float64Array(N_FFT)
  for (let fIdx = 0; fIdx < nFrames; fIdx++) {
    const start = fIdx * step
    for (let i = 0; i < N_FFT; i++) {
      const s = start + i
      re[i] = (s < extended.length ? extended[s]! : 0) * win[i]!
      im[i] = 0
    }
    fft(re, im)
    const m = new Float64Array(bins)
    for (let k = 0; k < bins; k++) m[k] = Math.hypot(re[k]!, im[k]!) * scale
    mag.push(m)
  }
  const freqs = new Float64Array(bins)
  for (let k = 0; k < bins; k++) freqs[k] = (k * sampleRate) / N_FFT
  return { mag, freqs, frames: nFrames }
}

// ---- the feature pass --------------------------------------------------------------------------

/** Degenerate-but-finite metrics for a clip too short or too quiet to measure (richfeat.py
 * returned None here; a FeatureVector cannot). Every value is the honest "nothing there" reading. */
function silentRich(): RichMetrics {
  return {
    fluxMean: 0, fluxP95: 0, fluxStd: 0,
    flatnessDb: 0, flatnessHiDb: 0, flatnessLoDb: 0,
    slopeDbPerOct: 0,
    crestSubDb: 0, crestBassDb: 0, crestMidsDb: 0, crestPresenceDb: 0, crestAirDb: 0,
    envStdDb: 0, envRangeDb: 0, sustainPct: 0, envFluxDb: 0,
    onsetRatePerSec: 0,
    attackMedMs: ATTACK_WINDOW_MS, attackP25Ms: ATTACK_WINDOW_MS, attackCv: 0, onsetLevelCv: 0,
    widthMeanDb: WIDTH_FLOOR_DB, widthStdDb: 0,
    onsetCount: 0,
  }
}

/** The 23 rich DSP features for one decoded clip. Pure, deterministic, no sidecar. */
export function analyzeRich(channels: Float64Array[], sampleRate: number): RichMetrics {
  const len = channels[0]?.length ?? 0
  if (len < N_FFT || sampleRate <= 0) return silentRich()
  const mono = new Float64Array(len)
  for (const ch of channels) for (let i = 0; i < len; i++) mono[i]! += ch[i]! / channels.length
  const durationSec = len / sampleRate

  const { mag, freqs, frames } = stft(mono, sampleRate)
  const bins = freqs.length

  // per-frame total power + the activity mask every downstream statistic is taken over
  const frameEnergy = new Float64Array(frames)
  for (let t = 0; t < frames; t++) {
    let e = 0
    const m = mag[t]!
    for (let k = 0; k < bins; k++) e += m[k]! * m[k]!
    frameEnergy[t] = e
  }
  let maxEnergy = 0
  for (let t = 0; t < frames; t++) maxEnergy = Math.max(maxEnergy, frameEnergy[t]!)
  const active: boolean[] = []
  let activeCount = 0
  for (let t = 0; t < frames; t++) {
    const a = frameEnergy[t]! > maxEnergy * 1e-6
    active.push(a)
    if (a) activeCount++
  }
  if (activeCount < 8) return silentRich()

  const out = silentRich()

  // ---- spectral flux on unit-normalized magnitude frames (level-invariant "movement") ----------
  {
    const flux: number[] = []
    let prevNorm: Float64Array | null = null
    for (let t = 0; t < frames; t++) {
      const m = mag[t]!
      let norm = 0
      for (let k = 0; k < bins; k++) norm += m[k]! * m[k]!
      norm = Math.max(Math.sqrt(norm), 1e-12)
      const unit = new Float64Array(bins)
      for (let k = 0; k < bins; k++) unit[k] = m[k]! / norm
      if (prevNorm !== null) {
        let acc = 0
        for (let k = 0; k < bins; k++) {
          const d = unit[k]! - prevNorm[k]!
          if (d > 0) acc += d * d
        }
        // flux[i] describes the step INTO frame i+1, and richfeat.py masks it with active[1:]
        if (active[t]!) flux.push(Math.sqrt(acc))
      }
      prevNorm = unit
    }
    if (flux.length > 0) {
      out.fluxMean = mean(flux)
      out.fluxP95 = percentile(flux, 95)
      out.fluxStd = std(flux)
    }
  }

  // ---- spectral flatness (geometric/arithmetic mean of power) over active frames ---------------
  const flatness = (lo: number, hi: number): number => {
    const kLo = Math.max(0, Math.ceil((lo * N_FFT) / sampleRate))
    let kHi = Math.floor((hi * N_FFT) / sampleRate)
    if (kHi * (sampleRate / N_FFT) >= hi) kHi -= 1 // half-open [lo, hi)
    kHi = Math.min(kHi, bins - 1)
    if (kHi < kLo) return 0
    const per: number[] = []
    for (let t = 0; t < frames; t++) {
      if (!active[t]!) continue
      const m = mag[t]!
      let logSum = 0
      let arith = 0
      let n = 0
      for (let k = kLo; k <= kHi; k++) {
        const p = m[k]! * m[k]! + 1e-14
        logSum += Math.log(p)
        arith += p
        n++
      }
      if (n === 0) continue
      const geo = Math.exp(logSum / n)
      per.push(10 * Math.log10(geo / (arith / n)))
    }
    return mean(per)
  }
  out.flatnessDb = flatness(100, 16000)
  out.flatnessHiDb = flatness(2000, 8000)
  out.flatnessLoDb = flatness(100, 500)

  // ---- spectral slope, dB/octave, least squares of magnitude-dB on log2(f) ---------------------
  {
    const idx: number[] = []
    for (let k = 0; k < bins; k++) if (freqs[k]! >= 100 && freqs[k]! <= 10000) idx.push(k)
    if (idx.length >= 2) {
      const lf = idx.map((k) => Math.log2(freqs[k]!))
      const lfMean = mean(lf)
      let lfVar = 0
      for (const v of lf) lfVar += (v - lfMean) ** 2
      if (lfVar > 0) {
        const slopes: number[] = []
        for (let t = 0; t < frames; t++) {
          if (!active[t]!) continue
          const m = mag[t]!
          const mdb = idx.map((k) => 20 * Math.log10(Math.max(m[k]!, 1e-9)))
          const mdbMean = mean(mdb)
          let cov = 0
          for (let i = 0; i < idx.length; i++) cov += (lf[i]! - lfMean) * (mdb[i]! - mdbMean)
          slopes.push(cov / lfVar)
        }
        out.slopeDbPerOct = mean(slopes)
      }
    }
  }

  // ---- per-band crest: p95 - p50 of per-band frame energy, dB ---------------------------------
  {
    const crestKeys = ['crestSubDb', 'crestBassDb', 'crestMidsDb', 'crestPresenceDb', 'crestAirDb'] as const
    for (let b = 0; b < CREST_BANDS.length; b++) {
      const band = CREST_BANDS[b]!
      const vals: number[] = []
      for (let t = 0; t < frames; t++) {
        if (!active[t]!) continue
        const m = mag[t]!
        let e = 0
        for (let k = 0; k < bins; k++) {
          const f = freqs[k]!
          if (f >= band.lo && f < band.hi) e += m[k]! * m[k]!
        }
        vals.push(e)
      }
      const maxV = vals.reduce((s, x) => Math.max(s, x), 0)
      if (maxV <= 0 || vals.filter((v) => v > maxV * 1e-8).length < 4) continue
      const dbs = vals.map((v) => 10 * Math.log10(Math.max(v, maxV * 1e-8)))
      dbs.sort((x, y) => x - y)
      out[crestKeys[b]!] = percentileSorted(dbs, 95) - percentileSorted(dbs, 50)
    }
  }

  // ---- envelope statistics from the frame-energy curve ----------------------------------------
  const envDb = new Float64Array(frames)
  {
    const floor = maxEnergy * 1e-8
    for (let t = 0; t < frames; t++) envDb[t] = 10 * Math.log10(Math.max(frameEnergy[t]!, floor))
    const ea: number[] = []
    for (let t = 0; t < frames; t++) if (active[t]!) ea.push(envDb[t]!)
    out.envStdDb = std(ea)
    const sortedEa = [...ea].sort((a, b) => a - b)
    const p95 = percentileSorted(sortedEa, 95)
    out.envRangeDb = p95 - percentileSorted(sortedEa, 10)
    out.sustainPct = 100 * (ea.filter((v) => v > p95 - 12).length / Math.max(1, ea.length))
    let fluxAcc = 0
    for (let i = 1; i < ea.length; i++) fluxAcc += Math.abs(ea[i]! - ea[i - 1]!)
    out.envFluxDb = ea.length > 1 ? fluxAcc / (ea.length - 1) : 0
  }

  // ---- onsets + 10->90% attack times ------------------------------------------------------------
  {
    const oe = new Float64Array(Math.max(0, frames - 1))
    for (let t = 1; t < frames; t++) oe[t - 1] = Math.max(envDb[t]! - envDb[t - 1]!, 0)
    const oeArr = Array.from(oe)
    const med = medfilt(oe, 15)
    const bump = Math.max(1.5, 0.5 * std(oeArr))
    const hopSec = HOP / sampleRate
    const peaks: number[] = []
    for (let i = 1; i < oe.length - 1; i++) {
      if (oe[i]! > med[i]! + bump && oe[i]! >= oe[i - 1]! && oe[i]! >= oe[i + 1]!) {
        if (peaks.length === 0 || (i - peaks[peaks.length - 1]!) * hopSec > 0.05) peaks.push(i)
      }
    }
    out.onsetRatePerSec = peaks.length / durationSec

    // fine amplitude envelope: |x| smoothed with a 2 ms boxcar (numpy 'same' convolution)
    const k = Math.max(1, Math.floor(0.002 * sampleRate)) // richfeat.py's int(), which truncates
    const fine = new Float64Array(len)
    {
      // np.convolve(|x|, ones(k)/k, mode='same'): output i averages input [i-lead, i-lead+k-1],
      // where lead = ceil((k-1)/2). For the EVEN k that 2 ms at 44.1 kHz produces (k=88) the
      // window is asymmetric by one sample, and getting that off by one shifts every measured
      // attack time by ~1.6% — the exact kind of silent unit drift doc 140 §2-D16 flagged.
      const lead = Math.ceil((k - 1) / 2)
      let acc = 0
      const abs = (j: number) => (j >= 0 && j < len ? Math.abs(mono[j]!) : 0)
      for (let j = 0; j < k; j++) acc += abs(j - lead)
      for (let i = 0; i < len; i++) {
        fine[i] = acc / k
        acc += abs(i + 1 - lead + k - 1) - abs(i - lead)
      }
    }
    const attacks: number[] = []
    const levels: number[] = []
    const windowSamples = Math.floor((ATTACK_WINDOW_MS / 1000) * sampleRate)
    const backSamples = Math.floor(0.01 * sampleRate)
    for (const p of peaks) {
      const s0 = p * HOP
      const s1 = Math.min(len, s0 + windowSamples)
      if (s1 - s0 < 32) continue
      let pk = s0
      for (let i = s0; i < s1; i++) if (fine[i]! > fine[pk]!) pk = i
      const pv = fine[pk]!
      let base: number
      if (s0 > 0) {
        base = Infinity
        for (let i = Math.max(0, s0 - backSamples); i <= s0; i++) base = Math.min(base, fine[i]!)
      } else base = fine[s0]!
      if (pv <= base * 1.2 || pv < 1e-5) continue
      const loT = base + 0.1 * (pv - base)
      const hiT = base + 0.9 * (pv - base)
      let iHi = pk
      while (iHi > s0 && fine[iHi - 1]! >= hiT) iHi--
      let iLo = iHi
      while (iLo > s0 && fine[iLo - 1]! >= loT) iLo--
      attacks.push(((iHi - iLo) / sampleRate) * 1000)
      levels.push(pv)
    }
    out.onsetCount = attacks.length
    if (attacks.length > 0) {
      out.attackMedMs = percentile(attacks, 50)
      out.attackP25Ms = percentile(attacks, 25)
      const am = mean(attacks)
      out.attackCv = std(attacks) / Math.max(am, 1e-9)
      const lm = mean(levels)
      out.onsetLevelCv = std(levels) / Math.max(lm, 1e-9)
    }
  }

  // ---- stereo field over time (50 ms frames) ---------------------------------------------------
  if (channels.length >= 2) {
    const l = channels[0]!
    const r = channels[1]!
    const w = Math.floor(0.05 * sampleRate)
    const n = Math.floor(len / w)
    if (n > 4) {
      const midR: number[] = []
      const sideR: number[] = []
      for (let f = 0; f < n; f++) {
        let mAcc = 0
        let sAcc = 0
        for (let i = f * w; i < (f + 1) * w; i++) {
          const mid = (l[i]! + r[i]!) / 2
          const side = (l[i]! - r[i]!) / 2
          mAcc += mid * mid
          sAcc += side * side
        }
        midR.push(Math.sqrt(mAcc / w))
        sideR.push(Math.sqrt(sAcc / w))
      }
      const midMax = midR.reduce((s, x) => Math.max(s, x), 0)
      const wdb: number[] = []
      for (let f = 0; f < n; f++) {
        if (midR[f]! <= midMax * 1e-4) continue
        const v = 20 * Math.log10(Math.max(sideR[f]!, 1e-9) / Math.max(midR[f]!, 1e-9))
        wdb.push(Math.min(20, Math.max(WIDTH_FLOOR_DB, v)))
      }
      if (wdb.length > 0) {
        out.widthMeanDb = mean(wdb)
        out.widthStdDb = std(wdb)
      }
    }
  }

  return out
}
