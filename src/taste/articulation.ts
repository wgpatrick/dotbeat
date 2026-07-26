// The measurements `MixMetrics` structurally cannot make, and the 2026-07-26 owner ear report that
// forced them into existence.
//
// THE COMPLAINT. The layered arm passed 19 of 24 measured targets against single-voice engineplus's
// 3, the largest measured jump in the taste program, and the owner listened and said: "the bassline
// layering doesn't sound great from my POV... I liked the unlayered one better", plus "all the
// layering... makes everything sort of sound the same-ish."
//
// WHY NO EXISTING FEATURE COULD SEE IT. Every gate in `LAYERED_TARGETS` reads `MixMetrics`, which is
// whole-file and whole-band: five band SHARES, one crest, one centroid, one width. That vocabulary
// cannot distinguish
//     a bass with a strong sub layer      (what the targets were written to reward)
// from
//     a bass that is NOTHING BUT a sub layer, its character layer 14 dB down and its transient
//     layer 49 dB down                    (what was actually built, measured 2026-07-26 by
//                                          scripts/layered-diagnose.mjs)
// and it cannot see note boundaries at all, so a legato sine drone and an articulated rolling bass
// with the same spectrum are the same number. Both of those are what the owner heard.
//
// The three families below are exactly the ones `UNMEASURABLE_TARGETS` in layered.ts has been
// naming as this gate's blind spots since it was written:
//
//   PER-BAND CREST      peak minus RMS inside a band (131 P1's `crest_sub <= ~11 dB` target).
//   PER-BAND LEVEL      a band's RMS against the whole signal's — and, folded into one number,
//                       `characterLevelDb`: how loud everything above the sub is relative to the
//                       sub. For a bassline this is the "is the growl audible" number. Measured
//                       refs-packs bassline median: +0.43 dB. The layered bass: -13.04 dB.
//   ENVELOPE SWING      `modDepthDb` / `articulationDb`, the dB spread of the short-window RMS
//                       envelope: how far the sound moves between "note" and "between notes".
//                       Measured refs-packs bassline median articulation: 20.59 dB, p10 8.75.
//                       The layered bass: 8.74 and 6.64 — at or under the reference pool's tenth
//                       percentile, and BELOW engineplus on both clips, which is the owner's
//                       ranking and the exact ordering no band-share gate reproduces.
//
// Band filtering is a forward-only cascade of two RBJ biquads per edge (4th-order Butterworth,
// 24 dB/oct). Phase is not preserved and does not need to be: every statistic here is a level or a
// level spread, and a zero-phase pass would cost a second traversal for no change in the answer.
//
// Deliberately a NEW module rather than an addition to `src/taste/features.ts`: FEATURE_KEYS is
// append-only and load-bearing for every trained ranker and every historical score log, so growing
// it is a decision for the critic-feature upgrade, not a side effect of a bug fix. This module is
// pure and dependency-free so that upgrade can adopt it wholesale.

/** Band edges, matching `src/metrics/analyze.ts`'s `SpectralBands` exactly so a share and a level
 * are talking about the same band. `hi: 0` means "up to Nyquist". */
export const ARTICULATION_BANDS = [
  { name: 'sub', lo: 0, hi: 60 },
  { name: 'bass', lo: 60, hi: 250 },
  { name: 'mids', lo: 250, hi: 2000 },
  { name: 'presence', lo: 2000, hi: 6000 },
  { name: 'air', lo: 6000, hi: 0 },
] as const

export type ArticulationBandName = (typeof ARTICULATION_BANDS)[number]['name']

interface BiquadCoefficients {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

/** RBJ cookbook biquad, normalized by a0. */
function biquad(kind: 'lowpass' | 'highpass', sampleRate: number, freq: number, q: number): BiquadCoefficients {
  const w0 = (2 * Math.PI * freq) / sampleRate
  const cosw = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const a0 = 1 + alpha
  const a1 = -2 * cosw
  const a2 = 1 - alpha
  const [b0, b1, b2] =
    kind === 'lowpass'
      ? [(1 - cosw) / 2, 1 - cosw, (1 - cosw) / 2]
      : [(1 + cosw) / 2, -(1 + cosw), (1 + cosw) / 2]
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

function applyBiquad(x: Float64Array, c: BiquadCoefficients): Float64Array {
  const y = new Float64Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!
    const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    x2 = x1
    x1 = xi
    y2 = y1
    y1 = yi
    y[i] = yi
  }
  return y
}

/** The two section Qs of a 4th-order Butterworth — 24 dB/oct, the slope every mined layering source
 * assumes when it names a crossover. */
const BUTTERWORTH_Q4 = [0.5412, 1.3066] as const

function pass(x: Float64Array, kind: 'lowpass' | 'highpass', sampleRate: number, freq: number): Float64Array {
  let out = x
  for (const q of BUTTERWORTH_Q4) out = applyBiquad(out, biquad(kind, sampleRate, freq, q))
  return out
}

/** Sum to mono — the club-system view every layering source says to trust for level judgements. */
export function toMono(channels: readonly Float64Array[]): Float64Array {
  if (channels.length === 0) return new Float64Array(0)
  const n = channels[0]!.length
  const out = new Float64Array(n)
  for (const ch of channels) for (let i = 0; i < n; i++) out[i]! += ch[i]! / channels.length
  return out
}

const db = (x: number): number => (x <= 0 ? -Infinity : 20 * Math.log10(x))

/** Clamp for true digital silence, the same convention `src/taste/features.ts` uses. */
const SILENCE_DB = -80
const finiteDb = (x: number): number => (Number.isFinite(x) ? x : SILENCE_DB)

function rms(x: Float64Array): number {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!
  return x.length === 0 ? 0 : Math.sqrt(s / x.length)
}

function peak(x: Float64Array): number {
  let p = 0
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]!))
  return p
}

/** Short-window RMS envelope in dB, one frame per `hopMs`. 20 ms / 5 ms resolves a 16th note at any
 * tempo the composer emits while still averaging over a full cycle at 50 Hz. */
export function envelopeDb(x: Float64Array, sampleRate: number, windowMs = 20, hopMs = 5): number[] {
  const w = Math.max(1, Math.round((windowMs / 1000) * sampleRate))
  const h = Math.max(1, Math.round((hopMs / 1000) * sampleRate))
  const out: number[] = []
  for (let i = 0; i + w <= x.length; i += h) {
    let s = 0
    for (let j = i; j < i + w; j++) s += x[j]! * x[j]!
    out.push(db(Math.sqrt(s / w)))
  }
  return out
}

/** The envelope, floored 60 dB under its own loudest frame and sorted, ready for quantiles.
 *
 * The floor is load-bearing, not cosmetic. Frames of TRUE digital silence read -Infinity, and the
 * first version of this dropped them — which meant a figure with real gaps between its notes
 * measured as LESS articulated than one that droned, the exact inversion this feature exists to
 * catch (found by the synthetic gated-tone case in test/layered.test.ts, 2026-07-26: a 55 Hz sine
 * gated to 60% duty read 5.97 dB of articulation because every silent frame had been discarded).
 * Silence is the deepest articulation there is; -60 dB relative is where it stops mattering to a
 * listener, and it bounds the feature so one silent frame cannot dominate a whole clip. */
function envelopeQuantiles(x: Float64Array, sampleRate: number): number[] {
  const raw = envelopeDb(x, sampleRate)
  let maxDb = -Infinity
  for (const v of raw) if (Number.isFinite(v) && v > maxDb) maxDb = v
  if (!Number.isFinite(maxDb)) return []
  const floor = maxDb - 60
  return raw.map((v) => (Number.isFinite(v) ? Math.max(v, floor) : floor)).sort((a, b) => a - b)
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}

export interface ArticulationFeatures {
  /** peak - RMS inside the band, dB. */
  crestSubDb: number
  crestBassDb: number
  crestMidsDb: number
  /** band RMS relative to the whole signal's RMS, dB — how much of the sound the band IS. */
  levelSubDb: number
  levelBassDb: number
  levelMidsDb: number
  levelPresenceDb: number
  /** p95 - p20 of the full-band envelope: the everyday swing between note and gap. */
  modDepthDb: number
  /** p95 - p05 of the full-band envelope: the same idea at the extremes. A sustained drone reads
   * near zero; an articulated figure reads 15-30 dB on the reference pools. */
  articulationDb: number
  /** RMS of everything above the sub band, minus the sub band's RMS. Negative = sub-dominated;
   * refs-packs bassline median is +0.43 dB. This is the "is the character layer audible" number. */
  characterLevelDb: number
}

export const ARTICULATION_KEYS = [
  'crestSubDb',
  'crestBassDb',
  'crestMidsDb',
  'levelSubDb',
  'levelBassDb',
  'levelMidsDb',
  'levelPresenceDb',
  'modDepthDb',
  'articulationDb',
  'characterLevelDb',
] as const satisfies readonly (keyof ArticulationFeatures)[]

/** Measure one render. Every value is finite (digital silence clamps to -80 dB) so the result can
 * be gated, logged and diffed exactly like a `FeatureVector`. */
export function articulationFeatures(channels: readonly Float64Array[], sampleRate: number): ArticulationFeatures {
  const mono = toMono(channels)
  const fullRms = rms(mono)
  const bandRms: Record<string, number> = {}
  const bandCrest: Record<string, number> = {}
  for (const band of ARTICULATION_BANDS) {
    let x = mono
    if (band.lo > 0) x = pass(x, 'highpass', sampleRate, band.lo)
    if (band.hi > 0 && band.hi < sampleRate / 2) x = pass(x, 'lowpass', sampleRate, band.hi)
    const r = rms(x)
    bandRms[band.name] = r
    bandCrest[band.name] = finiteDb(db(peak(x)) - db(r))
  }
  const env = envelopeQuantiles(mono, sampleRate)
  const character = Math.sqrt(bandRms.bass! ** 2 + bandRms.mids! ** 2 + bandRms.presence! ** 2)
  const rel = (r: number): number => finiteDb(db(r) - db(fullRms))
  return {
    crestSubDb: bandCrest.sub!,
    crestBassDb: bandCrest.bass!,
    crestMidsDb: bandCrest.mids!,
    levelSubDb: rel(bandRms.sub!),
    levelBassDb: rel(bandRms.bass!),
    levelMidsDb: rel(bandRms.mids!),
    levelPresenceDb: rel(bandRms.presence!),
    modDepthDb: env.length === 0 ? 0 : quantile(env, 0.95) - quantile(env, 0.2),
    articulationDb: env.length === 0 ? 0 : quantile(env, 0.95) - quantile(env, 0.05),
    characterLevelDb: finiteDb(db(character) - db(bandRms.sub!)),
  }
}
