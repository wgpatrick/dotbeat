// Narrow high-frequency ring metric — a TypeScript port of python/surge_render.py's `_ring_db`
// (itself the detector scripts/debug-surge-ring.py root-caused the "right-ear ringing" bug with).
// The surge showdown path gets ringDb for free from the surge sidecar; the ENGINE curation
// (docs/engine-presets.md E2) renders through dotbeat's own engine, which has no such sidecar, so
// this computes the identical metric on an engine-rendered WAV in-process (no extra python spawn).
//
// A bin counts as a RING when, in the 4–14 kHz band, it towers over its ±~300 Hz neighborhood by
// >6×; ringDb is that worst peak in dB relative to the channel's spectrum max (per-channel, worst
// across channels). ~-120 when nothing rings. The showdown/curation gate rejects ringDb > -32.

import { fft } from './analyze.js'

const N_FFT = 8192
const RING_LO_HZ = 4000
const RING_HI_HZ = 14000
const NEIGHBORHOOD_BINS = 56 // ±~300 Hz at 44.1 kHz (binHz ≈ 5.38): mirrors _ring_db's fixed window
const RING_RATIO = 6 // a bin > 6× its neighborhood median is a narrow tonal peak
const FLOOR_DB = -120

/** Median of `xs[lo..hi)` (a copy is sorted; the windows are small so this is cheap enough). */
function windowMedian(xs: Float64Array, lo: number, hi: number): number {
  const slice = Array.prototype.slice.call(xs, lo, hi) as number[]
  slice.sort((a, b) => a - b)
  const n = slice.length
  if (n === 0) return 0
  return n % 2 ? slice[(n - 1) / 2]! : (slice[n / 2 - 1]! + slice[n / 2]!) / 2
}

/** The mean magnitude spectrum (linear) of one channel over non-overlapping Hann-windowed N_FFT
 * frames — the same framing as _ring_db (step == N_FFT, no overlap). Returns the first N_FFT/2+1
 * bins (rfft length). Null when the signal is shorter than one frame. */
function meanMagnitudeSpectrum(y: ArrayLike<number>): Float64Array | null {
  const len = y.length
  if (len < N_FFT) return null
  const hann = new Float64Array(N_FFT)
  for (let i = 0; i < N_FFT; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N_FFT - 1)))
  const half = N_FFT / 2 + 1
  const acc = new Float64Array(half)
  let frames = 0
  for (let start = 0; start + N_FFT <= len; start += N_FFT) {
    const re = new Float64Array(N_FFT)
    const im = new Float64Array(N_FFT)
    for (let i = 0; i < N_FFT; i++) re[i] = y[start + i]! * hann[i]!
    fft(re, im)
    for (let k = 0; k < half; k++) acc[k]! += Math.hypot(re[k]!, im[k]!)
    frames++
  }
  if (frames === 0) return null
  for (let k = 0; k < half; k++) acc[k]! /= frames
  return acc
}

/** The worst narrow HF tonal peak (dB relative to spectrum max) across the given channels, or the
 * FLOOR_DB (~-120) when nothing rings / the render is too short. Channels are the decoded per-channel
 * float samples (Float32Array/Float64Array/number[] all accepted). */
export function ringDb(channels: ArrayLike<number>[], sampleRate: number): number {
  let worst = FLOOR_DB
  const binHz = sampleRate / N_FFT
  for (const y of channels) {
    const spectrum = meanMagnitudeSpectrum(y)
    if (spectrum === null) continue
    let smax = 1e-12
    for (let k = 0; k < spectrum.length; k++) if (spectrum[k]! > smax) smax = spectrum[k]!
    // indices of the 4–14 kHz band
    const loBin = Math.max(1, Math.ceil(RING_LO_HZ / binHz))
    const hiBin = Math.min(spectrum.length - 1, Math.floor(RING_HI_HZ / binHz))
    // the band as a compact array, so the ±NEIGHBORHOOD_BINS median matches _ring_db (which slices
    // the band first, then windows within it)
    const band = spectrum.slice(loBin, hiBin + 1)
    for (let i = 0; i < band.length; i++) {
      const neigh = windowMedian(band, Math.max(0, i - NEIGHBORHOOD_BINS), Math.min(band.length, i + NEIGHBORHOOD_BINS)) + 1e-15
      if (band[i]! > RING_RATIO * neigh) {
        const dbv = 20 * Math.log10(band[i]! / smax)
        if (dbv > worst) worst = dbv
      }
    }
  }
  return Math.round(worst * 10) / 10
}
