// The measurements the layered gate CANNOT make, implemented so the 2026-07-26 owner ear report
// ("the bassline layering doesn't sound great... I liked the unlayered one better") can be
// diagnosed with numbers rather than opinion.
//
// `MixMetrics` is whole-file and whole-band: band SHARES, one crest, one centroid. None of that can
// distinguish "a bass with a strong sub layer" from "a bass that is nothing but a sub layer with an
// inaudible character layer", and none of it can see note boundaries at all. This module adds the
// three families the layered arm's own UNMEASURABLE_TARGETS list names as its blind spots:
//
//   1. PER-BAND CREST — peak minus RMS inside each band, via cascaded RBJ biquads (24 dB/oct).
//      131 P1's bass target is crest_sub <= ~11 dB; a whole-file crest cannot express it.
//   2. ENVELOPE MODULATION DEPTH — the dB spread of the short-window RMS envelope. A bass with note
//      articulation swings; a sustained legato sine drone does not. This is the closest available
//      proxy for "can you hear where the notes are".
//   3. PER-BAND ENVELOPE CORRELATION / LEVEL — how loud each band's own envelope is relative to the
//      loudest band, which is what says whether a character layer is audible or buried.
//
// Deliberately NOT wired into src/taste/features.ts: that file is a sibling stream's, and the
// feature vector is append-only and load-bearing for trained models. This lives in scripts/ as a
// diagnostic until the critic-feature upgrade adopts it.

/** RBJ biquad coefficients, normalized by a0. */
function biquad(kind, sampleRate, freq, q) {
  const w0 = (2 * Math.PI * freq) / sampleRate
  const cosw = Math.cos(w0)
  const sinw = Math.sin(w0)
  const alpha = sinw / (2 * q)
  let b0, b1, b2
  const a0 = 1 + alpha
  const a1 = -2 * cosw
  const a2 = 1 - alpha
  if (kind === 'lowpass') {
    b0 = (1 - cosw) / 2
    b1 = 1 - cosw
    b2 = (1 - cosw) / 2
  } else {
    b0 = (1 + cosw) / 2
    b1 = -(1 + cosw)
    b2 = (1 + cosw) / 2
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

function applyBiquad(x, c) {
  const y = new Float64Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]
    const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    x2 = x1; x1 = xi; y2 = y1; y1 = yi
    y[i] = yi
  }
  return y
}

/** Two cascaded Butterworth-Q biquads = 24 dB/oct, forward only (phase is irrelevant to the level
 * and crest statistics measured here). */
function pass(x, kind, sampleRate, freq) {
  const qs = [0.5412, 1.3066] // 4th-order Butterworth section Qs
  let out = x
  for (const q of qs) out = applyBiquad(out, biquad(kind, sampleRate, freq, q))
  return out
}

export const BANDS = [
  { name: 'sub', lo: 0, hi: 60 },
  { name: 'bass', lo: 60, hi: 250 },
  { name: 'mids', lo: 250, hi: 2000 },
  { name: 'presence', lo: 2000, hi: 6000 },
  { name: 'air', lo: 6000, hi: 0 },
]

/** Sum channels to mono (the club-system view every layering source says to trust). */
export function toMono(channels) {
  const n = channels[0].length
  const out = new Float64Array(n)
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length
  return out
}

function bandSignal(mono, sampleRate, band) {
  let x = mono
  if (band.lo > 0) x = pass(x, 'highpass', sampleRate, band.lo)
  if (band.hi > 0 && band.hi < sampleRate / 2) x = pass(x, 'lowpass', sampleRate, band.hi)
  return x
}

const db = (x) => (x <= 0 ? -Infinity : 20 * Math.log10(x))

function rms(x) {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, x.length))
}

function peak(x) {
  let p = 0
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]))
  return p
}

/** Short-window RMS envelope in dB, one frame per `hopMs`. */
export function envelopeDb(x, sampleRate, windowMs = 20, hopMs = 5) {
  const w = Math.max(1, Math.round((windowMs / 1000) * sampleRate))
  const h = Math.max(1, Math.round((hopMs / 1000) * sampleRate))
  const out = []
  for (let i = 0; i + w <= x.length; i += h) {
    let s = 0
    for (let j = i; j < i + w; j++) s += x[j] * x[j]
    out.push(db(Math.sqrt(s / w)))
  }
  return out
}

const quantile = (sorted, q) => {
  if (sorted.length === 0) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/**
 * The extended feature set.
 *   crest_<band>        peak - RMS inside the band, dB (131 P1's crest_sub target lives here)
 *   level_<band>        band RMS relative to the full-band RMS, dB (how much of the sound it is)
 *   modDepthDb          p95 - p20 of the full-band envelope: how far the sound swings between
 *                       "note" and "between notes". A sustained drone reads near 0.
 *   modDepth_<band>     the same, per band
 *   articulationDb      p95 - p05 of the envelope, the harder version of the same idea
 *   characterLevelDb    (bass+mids+presence) RMS minus sub RMS — for a bassline, how audible the
 *                       character layers are against the sub. Negative = sub-dominated.
 */
export function extraFeatures(channels, sampleRate) {
  const mono = toMono(channels)
  const full = { rms: rms(mono), peak: peak(mono) }
  const out = { crestDbMono: db(full.peak) - db(full.rms) }
  const bandRms = {}
  for (const band of BANDS) {
    const x = bandSignal(mono, sampleRate, band)
    const r = rms(x)
    bandRms[band.name] = r
    out[`crest_${band.name}`] = db(peak(x)) - db(r)
    out[`level_${band.name}`] = db(r) - db(full.rms)
    const env = envelopeDb(x, sampleRate).filter(Number.isFinite).sort((a, b) => a - b)
    out[`modDepth_${band.name}`] = env.length === 0 ? NaN : quantile(env, 0.95) - quantile(env, 0.2)
  }
  const env = envelopeDb(mono, sampleRate).filter(Number.isFinite).sort((a, b) => a - b)
  out.modDepthDb = quantile(env, 0.95) - quantile(env, 0.2)
  out.articulationDb = quantile(env, 0.95) - quantile(env, 0.05)
  const character = Math.sqrt(bandRms.bass ** 2 + bandRms.mids ** 2 + bandRms.presence ** 2)
  out.characterLevelDb = db(character) - db(bandRms.sub)
  return out
}

export const EXTRA_KEYS = [
  'crest_sub', 'crest_bass', 'crest_mids',
  'level_sub', 'level_bass', 'level_mids', 'level_presence',
  'modDepthDb', 'modDepth_sub', 'modDepth_bass', 'modDepth_mids',
  'articulationDb', 'characterLevelDb',
]
