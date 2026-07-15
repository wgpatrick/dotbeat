// The deterministic ground-truth metrics (docs/phase-3-plan.md §3.1): peak / true peak, crest
// factor (PLR), spectral balance + centroid, stereo correlation/width. Pure TS, zero deps.

import { integratedLoudness } from './loudness.js'

export interface SpectralBands {
  sub: number // < 60 Hz        (dB share, relative full-band energy — see analyze())
  bass: number // 60-250 Hz
  mids: number // 250-2000 Hz
  presence: number // 2-6 kHz
  air: number // > 6 kHz
}

export interface MixMetrics {
  durationSeconds: number
  sampleRate: number
  channels: number
  integratedLufs: number
  samplePeakDbfs: number
  truePeakDbtp: number // 4x windowed-sinc oversampled — an estimate, honest to ~0.1 dB
  crestDb: number // sample peak minus RMS, a.k.a. PLR at the sample level
  rmsDbfs: number
  spectral: { bandsPct: SpectralBands; centroidHz: number }
  stereo: { correlation: number; widthDb: number } | null // null for mono
}

const db = (x: number) => (x <= 0 ? -Infinity : 20 * Math.log10(x))

function samplePeak(channels: Float64Array[]): number {
  let peak = 0
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]!))
  return peak
}

function rms(channels: Float64Array[]): number {
  let sum = 0
  let n = 0
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) sum += ch[i]! * ch[i]!
    n += ch.length
  }
  return n === 0 ? 0 : Math.sqrt(sum / n)
}

/** True-peak estimate per BS.1770's method: oversample (here 4x, 48-tap windowed-sinc
 * interpolation) and take the max. Catches inter-sample peaks a sample-peak read misses. */
function truePeak(channels: Float64Array[]): number {
  const FACTOR = 4
  const HALF_TAPS = 12 // 24 input taps per phase — plenty for a ±0.1 dB estimate
  // precompute polyphase kernels: phase p interpolates at fractional offset p/FACTOR
  const kernels: Float64Array[] = []
  for (let p = 1; p < FACTOR; p++) {
    const frac = p / FACTOR
    const k = new Float64Array(2 * HALF_TAPS)
    for (let i = 0; i < 2 * HALF_TAPS; i++) {
      const t = i - (HALF_TAPS - 1) - frac // distance from interpolation point to input sample
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)
      const window = 0.5 * (1 + Math.cos((Math.PI * t) / HALF_TAPS)) // Hann over the kernel span
      k[i] = sinc * window
    }
    kernels.push(k)
  }
  let peak = samplePeak(channels) // phase 0 = the input samples themselves
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      for (const k of kernels) {
        let v = 0
        for (let j = 0; j < k.length; j++) {
          const idx = i + j - (HALF_TAPS - 1)
          if (idx >= 0 && idx < ch.length) v += ch[idx]! * k[j]!
        }
        const a = Math.abs(v)
        if (a > peak) peak = a
      }
    }
  }
  return peak
}

/** Iterative radix-2 FFT, in-place, real input in re / zeros in im. `re.length` must be a power
 * of two. Exported (Phase 40 Stream VA) so `src/analysis/pitch.ts` can reuse the one FFT this
 * repo has instead of carrying a second copy — the dependency direction stays analysis → metrics,
 * and it is re-exported through `src/metrics/index.js` like everything else here. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j]!
        const uIm = im[i + j]!
        const vRe = re[i + j + len / 2]! * curRe - im[i + j + len / 2]! * curIm
        const vIm = re[i + j + len / 2]! * curIm + im[i + j + len / 2]! * curRe
        re[i + j] = uRe + vRe
        im[i + j] = uIm + vIm
        re[i + j + len / 2] = uRe - vRe
        im[i + j + len / 2] = uIm - vIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

const BAND_EDGES: { name: keyof SpectralBands; lo: number; hi: number }[] = [
  { name: 'sub', lo: 0, hi: 60 },
  { name: 'bass', lo: 60, hi: 250 },
  { name: 'mids', lo: 250, hi: 2000 },
  { name: 'presence', lo: 2000, hi: 6000 },
  { name: 'air', lo: 6000, hi: Infinity },
]

function spectral(channels: Float64Array[], sampleRate: number): { bandsPct: SpectralBands; centroidHz: number } {
  const N = 4096
  const hop = 2048
  // average magnitude-squared spectrum over hops of the channel-mean signal, Hann-windowed
  const mono = new Float64Array(channels[0]!.length)
  for (const ch of channels) for (let i = 0; i < mono.length; i++) mono[i]! += ch[i]! / channels.length
  const acc = new Float64Array(N / 2)
  let frames = 0
  const hann = new Float64Array(N)
  for (let i = 0; i < N; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)))
  for (let start = 0; start + N <= mono.length; start += hop) {
    const re = new Float64Array(N)
    const im = new Float64Array(N)
    for (let i = 0; i < N; i++) re[i] = mono[start + i]! * hann[i]!
    fft(re, im)
    for (let k = 0; k < N / 2; k++) acc[k]! += re[k]! * re[k]! + im[k]! * im[k]!
    frames++
  }
  if (frames === 0) return { bandsPct: { sub: 0, bass: 0, mids: 0, presence: 0, air: 0 }, centroidHz: 0 }

  const binHz = sampleRate / N
  let total = 0
  let centroidNum = 0
  const bands: SpectralBands = { sub: 0, bass: 0, mids: 0, presence: 0, air: 0 }
  for (let k = 1; k < N / 2; k++) {
    const f = k * binHz
    const e = acc[k]!
    total += e
    centroidNum += f * e
    for (const b of BAND_EDGES) {
      if (f >= b.lo && f < b.hi) {
        bands[b.name] += e
        break
      }
    }
  }
  if (total > 0) {
    for (const b of BAND_EDGES) bands[b.name] = (bands[b.name] / total) * 100
  }
  return { bandsPct: bands, centroidHz: total > 0 ? centroidNum / total : 0 }
}

function stereoStats(channels: Float64Array[]): { correlation: number; widthDb: number } | null {
  if (channels.length < 2) return null
  const [l, r] = [channels[0]!, channels[1]!]
  let sumLR = 0, sumLL = 0, sumRR = 0
  let midE = 0, sideE = 0
  for (let i = 0; i < l.length; i++) {
    const li = l[i]!
    const ri = r[i]!
    sumLR += li * ri
    sumLL += li * li
    sumRR += ri * ri
    const mid = (li + ri) / 2
    const side = (li - ri) / 2
    midE += mid * mid
    sideE += side * side
  }
  const denom = Math.sqrt(sumLL * sumRR)
  const correlation = denom === 0 ? 1 : sumLR / denom
  // width as side/mid energy ratio in dB: -Inf = pure mono, 0 dB = side as loud as mid
  const widthDb = midE === 0 ? (sideE === 0 ? -Infinity : Infinity) : db(Math.sqrt(sideE / midE))
  return { correlation, widthDb }
}

export function analyze(channels: Float64Array[], sampleRate: number): MixMetrics {
  const peak = samplePeak(channels)
  const r = rms(channels)
  return {
    durationSeconds: channels[0]!.length / sampleRate,
    sampleRate,
    channels: channels.length,
    integratedLufs: integratedLoudness(channels, sampleRate).integratedLufs,
    samplePeakDbfs: db(peak),
    truePeakDbtp: db(truePeak(channels)),
    crestDb: db(peak) - db(r),
    rmsDbfs: db(r),
    spectral: spectral(channels, sampleRate),
    stereo: stereoStats(channels),
  }
}
