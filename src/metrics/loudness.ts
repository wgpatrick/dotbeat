// Integrated loudness per ITU-R BS.1770-4 / EBU R128 — the ground-truth loudness measurement
// the whole critique loop rests on (docs/decisions.md D2: DSP is the judge, an LLM may only
// narrate). Pure TS, zero deps.
//
// Pipeline: per-channel K-weighting (two biquads: high-shelf + high-pass, designed from the
// spec's filter parameters so any sample rate works, not just 48 kHz) → mean-square over 400 ms
// blocks with 75% overlap → -70 LUFS absolute gate → relative gate at (ungated mean − 10 LU) →
// integrated loudness = −0.691 + 10·log10(mean power of surviving blocks).
//
// Reference point used by the tests: a full-scale 997 Hz sine in both stereo channels measures
// −0.69 LUFS (the K-filter is ~unity there and −0.691 is the spec's calibration offset).

interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

// BS.1770's stage-1 shelf and stage-2 high-pass, via the standard RLB filter design equations
// (the same derivation pyloudnorm uses); at fs=48000 these reproduce the spec's published
// coefficient tables.
function kWeightingFilters(fs: number): [Biquad, Biquad] {
  // stage 1: spherical-head high shelf
  const f0 = 1681.974450955533
  const G = 3.999843853973347
  const Q = 0.7071752369554196
  const K1 = Math.tan(Math.PI * f0 / fs)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.4996667741545416)
  const d1 = 1 + K1 / Q + K1 * K1
  const shelf: Biquad = {
    b0: (Vh + (Vb * K1) / Q + K1 * K1) / d1,
    b1: (2 * (K1 * K1 - Vh)) / d1,
    b2: (Vh - (Vb * K1) / Q + K1 * K1) / d1,
    a1: (2 * (K1 * K1 - 1)) / d1,
    a2: (1 - K1 / Q + K1 * K1) / d1,
  }
  // stage 2: RLB high-pass
  const f2 = 38.13547087602444
  const Q2 = 0.5003270373238773
  const K2 = Math.tan(Math.PI * f2 / fs)
  const d2 = 1 + K2 / Q2 + K2 * K2
  const highpass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K2 * K2 - 1)) / d2,
    a2: (1 - K2 / Q2 + K2 * K2) / d2,
  }
  return [shelf, highpass]
}

function applyBiquad(x: Float64Array, f: Biquad): Float64Array {
  const y = new Float64Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2
    y[i] = yi
    x2 = x1; x1 = xi
    y2 = y1; y1 = yi
  }
  return y
}

export interface LoudnessResult {
  /** Integrated loudness, LUFS. -Infinity for silence / nothing above the gates. */
  integratedLufs: number
  /** How many 400 ms blocks survived gating (0 = silence). */
  gatedBlocks: number
}

/** Channel weights: 1.0 for L/R/C — we only deal in mono/stereo, so all 1.0 (surrounds would
 * be 1.41 per the spec, out of scope). */
export function integratedLoudness(channels: Float64Array[], sampleRate: number): LoudnessResult {
  if (channels.length === 0 || channels[0]!.length === 0) return { integratedLufs: -Infinity, gatedBlocks: 0 }
  const [shelf, highpass] = kWeightingFilters(sampleRate)
  const weighted = channels.map((ch) => applyBiquad(applyBiquad(ch, shelf), highpass))

  const blockLen = Math.round(0.4 * sampleRate)
  const hop = Math.round(0.1 * sampleRate) // 75% overlap
  const n = weighted[0]!.length
  if (n < blockLen) return { integratedLufs: -Infinity, gatedBlocks: 0 }

  // per-block power (sum over channels of per-channel mean square)
  const blockPowers: number[] = []
  for (let start = 0; start + blockLen <= n; start += hop) {
    let power = 0
    for (const ch of weighted) {
      let sum = 0
      for (let i = start; i < start + blockLen; i++) sum += ch[i]! * ch[i]!
      power += sum / blockLen
    }
    blockPowers.push(power)
  }

  const toLufs = (power: number) => -0.691 + 10 * Math.log10(power)

  // absolute gate: -70 LUFS
  const absGated = blockPowers.filter((p) => toLufs(p) > -70)
  if (absGated.length === 0) return { integratedLufs: -Infinity, gatedBlocks: 0 }

  // relative gate: 10 LU below the absolute-gated mean
  const absMean = absGated.reduce((a, b) => a + b, 0) / absGated.length
  const relThreshold = toLufs(absMean) - 10
  const relGated = absGated.filter((p) => toLufs(p) > relThreshold)
  if (relGated.length === 0) return { integratedLufs: -Infinity, gatedBlocks: 0 }

  const mean = relGated.reduce((a, b) => a + b, 0) / relGated.length
  return { integratedLufs: toLufs(mean), gatedBlocks: relGated.length }
}
