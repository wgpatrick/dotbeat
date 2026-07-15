// Phase 40 Stream VA — what pitch IS this sample? (docs/phase-40-plan.md §VA, decisions.md D20.)
//
// dotbeat could always play a sample at a `tune` offset but had no idea what pitch the sample was,
// which is why building examples/recipe-song/ needed a numpy heredoc for every interesting choice.
// This is that missing middle, and per D20 it is pure TS with zero deps: src/metrics/ already
// carries a WAV decoder (`decodeWav`) and a radix-2 FFT (`fft`, exported for exactly this), and a
// one-shot's fundamental does not need torch. So it ships to every user with no venv and — the
// thing Phase 39 proved matters — it is testable in CI against synthesized known-frequency tones.
//
// The governing bias is HONESTY OVER FALSE PRECISION. This workflow's signature sounds are bells,
// plucks and found percussion, which is exactly where f0 detection is weakest: a bell's perceived
// pitch can be a strike tone that is not even in the spectrum, and examples/recipe-song's own
// bell_b has two partials a semitone apart. A confident wrong number is worse than a low
// confidence, because the whole point is that a user can trust the resulting keymap. So:
//   - two independent methods (YIN autocorrelation + FFT partial picking) that must AGREE,
//   - a harmonicity read that punishes inharmonic (clangy) and polyphonic (chord) spectra,
//   - and a partials table exported alongside the f0, because a low-confidence f0 on its own
//     leaves an agent stuck, while the table lets it reason (bell_b's ratio-1.06 pair is invisible
//     in any single-f0 summary — it is literally what made the bell_a-vs-bell_b call decidable).

import { fft } from '../metrics/index.js'
import { hzToMidi, midiToNote } from '../core/keymap.js'

/** One peak in the magnitude spectrum. `ratio` is deliberately relative to the lowest strong
 * partial rather than to the detected f0 — that is what keeps the table readable on a sound with
 * no trustworthy f0 at all, which is most of them here (a harmonic series reads 1, 2, 3…; a bell
 * reads 1, 1.82…; bell_b reads 1, 1.06). See `ratio` below. */
export interface SpectralPartial {
  hz: number
  /** Magnitude relative to the strongest partial, 0..1. */
  magnitude: number
  /** The same, in dB (0 for the strongest). */
  relDb: number
  /** This partial's frequency as a multiple of `PitchDetection.suggestedRootHz` (the lowest
   * PROMINENT partial). Ratio-to-lowest-prominent, not ratio-to-lowest-in-table: a -38 dB straggler
   * at the bottom of the table would otherwise become the denominator and bury the relationship the
   * table exists to show. Against this denominator the recipe-song's two bells read exactly as the
   * session that motivated this stream measured them by hand — bell_a x1.82 (an inharmonic clang),
   * bell_b x1.06 (two partials a semitone apart, which beat against each other). */
  ratio: number
}

export type PitchConfidenceLevel = 'high' | 'medium' | 'low'

export interface PitchDetection {
  /** The detected fundamental, or null when nothing periodic was found at all. */
  hz: number | null
  /** Fractional MIDI — a generated one-shot rarely lands on a semitone, and rounding here is
   * exactly the false precision this file exists to avoid. */
  midi: number | null
  /** Nearest equal-tempered semitone's name, e.g. "a6". */
  note: string | null
  /** Signed cents from `note` (-50..50). */
  cents: number | null
  /** 0..1. See `level` for the banding callers should actually branch on. */
  confidence: number
  level: PitchConfidenceLevel
  /** How the fundamental was arrived at, for the report line. */
  method: string
  /** YIN's periodicity, 0..1 — how self-similar the body is at the winning lag. */
  periodicity: number
  /** Magnitude share of the partials that sit on an integer multiple of f0, 0..1. Low for a bell
   * (inharmonic) and for a chord (several unrelated series). */
  harmonicity: number
  partials: SpectralPartial[]
  /** The note to put after `--root` when the detection is not trusted — the whole reason the
   * override is one copy-paste instead of a research project. Derived from the partials, so it is
   * meaningful even when `hz` is null or wrong. See `suggestedRootHz`. */
  suggestedRootNote: string | null
  /** The lowest PROMINENT partial (within 6 dB of the strongest). Not simply the strongest: a
   * struck/plucked sound's perceived pitch tracks its lowest strong partial, while its loudest can
   * be an upper one. Measured on examples/recipe-song/media/bell_a.wav, where the 3187 Hz partial
   * beats the 1748 Hz one by 0.8 dB but the song's hand-written keymap is rooted on the 1748 Hz
   * a6 — "loudest" would have suggested a root an octave and a fifth wrong. */
  suggestedRootHz: number | null
  sampleRate: number
  durationSeconds: number
  /** The body window actually measured (seconds into the source) — the attack transient is
   * skipped, so this is not the whole file, and saying so keeps the number auditable. */
  analyzedFromSeconds: number
  analyzedToSeconds: number
}

export interface DetectPitchOptions {
  /** Lowest fundamental considered (default 20 Hz — the recipe-song's bass is 25.3). */
  fmin?: number
  /** Highest fundamental considered (default 4200 Hz — above the recipe-song bell's 1748.6). */
  fmax?: number
  /** How many partials the RETURNED table carries (default 8). Display only: the confidence,
   * harmonicity and suggested root are always computed over a fixed internal set, so asking for a
   * bigger or smaller table never moves the measurement. */
  partialCount?: number
}

const DEFAULT_FMIN = 20
const DEFAULT_FMAX = 4200
const DEFAULT_PARTIALS = 8

/** Confidence bands. `high` = both methods agree on a harmonic series; `medium` = usable but check
 * the partials; `low` = do not build a keymap on this without an explicit --root. Tuned against
 * the real recipe-song assets (a clean synth sine reads ~1.0; bell_a, a real inharmonic bell,
 * reads low) — see test/pitch.test.ts. */
export const PITCH_CONFIDENCE_HIGH = 0.8
export const PITCH_CONFIDENCE_MEDIUM = 0.5

export function pitchConfidenceLevel(confidence: number): PitchConfidenceLevel {
  return confidence >= PITCH_CONFIDENCE_HIGH ? 'high' : confidence >= PITCH_CONFIDENCE_MEDIUM ? 'medium' : 'low'
}

/** Channel-mean, because a one-shot's pitch is not a stereo property. */
function toMono(channels: Float64Array[]): Float64Array {
  const n = channels[0]?.length ?? 0
  const mono = new Float64Array(n)
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i]! += ch[i]! / channels.length
  return mono
}

/** The BODY of a one-shot: past the attack transient (which is broadband noise and would drag
 * every method toward garbage) and before the sample has decayed into the noise floor. Returns
 * sample indices [from, to). */
function bodyWindow(mono: Float64Array, sampleRate: number): { from: number; to: number } {
  const hop = Math.max(1, Math.round(sampleRate * 0.005)) // 5 ms envelope resolution
  const env: number[] = []
  for (let i = 0; i + hop <= mono.length; i += hop) {
    let sum = 0
    for (let j = i; j < i + hop; j++) sum += mono[j]! * mono[j]!
    env.push(Math.sqrt(sum / hop))
  }
  if (env.length === 0) return { from: 0, to: mono.length }
  let peak = 0
  for (const e of env) if (e > peak) peak = e
  if (peak <= 0) return { from: 0, to: mono.length }
  // The attack is the FIRST frame to reach ~the peak, not the argmax of the envelope. On a decaying
  // one-shot the two are the same; on a SUSTAINED sound they are not, and the argmax is wherever
  // floating-point noise put it — measured: a steady 2 s sine had its "peak" at 1.934 s, leaving a
  // 66 ms body, and a perfectly detectable tone came back as unpitched. Any sustained sample (pads,
  // held bass) hit the same trap.
  let attackFrame = 0
  for (let i = 0; i < env.length; i++) {
    if (env[i]! >= peak * 0.9) {
      attackFrame = i
      break
    }
  }
  // Start a little after it: the transient is over by then and the tone is at its strongest. End
  // where the tail has fallen 40 dB (0.01x) below the peak — past that it is decay noise, and
  // including it only lowers the periodicity of a perfectly good sound.
  const from = Math.min(mono.length - 1, (attackFrame + 2) * hop)
  let endFrame = env.length
  for (let i = attackFrame; i < env.length; i++) {
    if (env[i]! < peak * 0.01) {
      endFrame = i
      break
    }
  }
  const to = Math.max(from + 1, Math.min(mono.length, endFrame * hop))
  return { from, to }
}

/** YIN (de Cheveigné & Kawahara 2002) steps 1-4: difference function, cumulative mean normalized
 * difference, absolute threshold, parabolic interpolation. Returns the winning lag in (fractional)
 * samples and its CMND value, where ~0 = perfectly periodic and ~1 = noise. */
function yin(seg: Float64Array, sampleRate: number, fmin: number, fmax: number): { tau: number; dPrime: number } | null {
  const tauMin = Math.max(2, Math.floor(sampleRate / fmax))
  const tauMaxWanted = Math.ceil(sampleRate / fmin)
  // The analysis window and the lag range have to fit inside the segment together: d(tau) compares
  // seg[0..W) against seg[tau..tau+W).
  const W = Math.min(4096, Math.floor(seg.length / 2))
  const tauMax = Math.min(tauMaxWanted, seg.length - W - 1)
  if (W < 64 || tauMax <= tauMin) return null

  const d = new Float64Array(tauMax + 1)
  for (let tau = tauMin; tau <= tauMax; tau++) {
    let sum = 0
    for (let j = 0; j < W; j++) {
      const diff = seg[j]! - seg[j + tau]!
      sum += diff * diff
    }
    d[tau] = sum
  }
  // cumulative mean normalized difference — this is the step that stops tau=0 winning everything
  const dPrime = new Float64Array(tauMax + 1)
  dPrime[0] = 1
  let running = 0
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau]!
    dPrime[tau] = running === 0 ? 1 : (d[tau]! * tau) / running
  }

  const THRESHOLD = 0.15
  let best = -1
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (dPrime[tau]! < THRESHOLD) {
      // walk to the bottom of this dip — the first crossing is not the minimum
      while (tau + 1 <= tauMax && dPrime[tau + 1]! < dPrime[tau]!) tau++
      best = tau
      break
    }
  }
  if (best === -1) {
    // Nothing crossed the threshold. Fall back to the global minimum rather than giving up: the
    // confidence this produces will be poor, which is the honest answer, and the caller still gets
    // a candidate to cross-check against the spectrum.
    best = tauMin
    for (let tau = tauMin; tau <= tauMax; tau++) if (dPrime[tau]! < dPrime[best]!) best = tau
  }

  // parabolic interpolation around the minimum for sub-sample (i.e. sub-cent) lag accuracy
  let tau = best
  if (best > tauMin && best < tauMax) {
    const a = dPrime[best - 1]!
    const b = dPrime[best]!
    const c = dPrime[best + 1]!
    const denom = 2 * (2 * b - a - c)
    if (denom !== 0) tau = best + (c - a) / denom
  }
  return { tau, dPrime: dPrime[best]! }
}

/** Magnitude spectrum of the body, Hann-windowed and zero-padded (the padding buys interpolation
 * accuracy, not resolution — the mainlobe width is still set by the real window length). */
function spectrum(seg: Float64Array, sampleRate: number): { mag: Float64Array; binHz: number; windowLength: number } {
  const L = Math.min(seg.length, 32768) // ~0.74 s at 44.1 kHz: enough resolution for a 25 Hz bass
  let N = 1
  while (N < L * 2) N <<= 1
  N = Math.min(N, 65536)
  const re = new Float64Array(N)
  const im = new Float64Array(N)
  for (let i = 0; i < L; i++) re[i] = seg[i]! * (0.5 * (1 - Math.cos((2 * Math.PI * i) / (L - 1))))
  fft(re, im)
  const mag = new Float64Array(N / 2)
  for (let k = 0; k < N / 2; k++) mag[k] = Math.hypot(re[k]!, im[k]!)
  return { mag, binHz: sampleRate / N, windowLength: L }
}

/** The lowest partial within `PROMINENCE_DB` of the strongest — see PitchDetection.suggestedRootHz
 * for why "lowest prominent" and not "loudest". */
const PROMINENCE_DB = 6
function suggestRootHz(partials: SpectralPartial[]): number | null {
  const prominent = partials.filter((p) => p.relDb >= -PROMINENCE_DB)
  if (prominent.length === 0) return null
  return prominent.reduce((lo, p) => (p.hz < lo.hz ? p : lo)).hz
}

/** The strongest spectral peaks, parabolically interpolated on a log magnitude (which is what
 * makes the interpolation of a Hann-windowed peak near-exact). Peaks too close to a stronger peak
 * are suppressed, so one partial reports as one row and not as three — see the width comment. */
function pickPartials(mag: Float64Array, binHz: number, windowLength: number, fftSize: number, fmin: number, count: number): SpectralPartial[] {
  const loBin = Math.max(2, Math.ceil(fmin / binHz))
  const mainlobeHz = Math.max(2, Math.round((4 * fftSize) / windowLength)) * binHz // Hann mainlobe ~4 bins of the REAL window
  const peaks: { hz: number; mag: number }[] = []
  for (let k = loBin; k < mag.length - 1; k++) {
    if (!(mag[k]! > mag[k - 1]! && mag[k]! >= mag[k + 1]!)) continue
    const a = Math.log(Math.max(mag[k - 1]!, 1e-20))
    const b = Math.log(Math.max(mag[k]!, 1e-20))
    const c = Math.log(Math.max(mag[k + 1]!, 1e-20))
    const denom = 2 * (2 * b - a - c)
    const delta = denom === 0 ? 0 : (c - a) / denom
    peaks.push({ hz: (k + delta) * binHz, mag: mag[k]! })
  }
  peaks.sort((x, y) => y.mag - x.mag)
  const kept: { hz: number; mag: number }[] = []
  for (const p of peaks) {
    if (kept.length >= count) break
    // Suppression width is a MUSICAL interval (a quartertone), not just the mainlobe: a real
    // partial is not a pure sine — bell_a's 1748 Hz partial spreads into lumps tens of Hz wide,
    // and a bin-width merge reported it three times, crowding the table it exists to inform. A
    // quartertone still resolves bell_b's semitone-apart pair (the case that must stay visible).
    const width = Math.max(mainlobeHz, p.hz * (Math.pow(2, 0.5 / 12) - 1))
    if (kept.some((q) => Math.abs(q.hz - p.hz) < width)) continue
    kept.push(p)
  }
  if (kept.length === 0) return []
  const strongest = kept[0]!.mag
  // `ratio` needs a root, and the root is chosen from the prominences computed here — so fill it
  // in a second pass rather than threading a half-built table around.
  const table: SpectralPartial[] = kept.map((p) => ({
    hz: p.hz,
    magnitude: p.mag / strongest,
    relDb: 20 * Math.log10(Math.max(p.mag / strongest, 1e-10)),
    ratio: 1,
  }))
  const root = suggestRootHz(table) ?? table[0]!.hz
  for (const p of table) p.ratio = p.hz / root
  return table
}

/** How close to an exact integer multiple of f0 a partial must sit to count as a harmonic of it,
 * in units of harmonic NUMBER (not percent). Fixed rather than scaled by the harmonic number on
 * purpose, and this is the single most load-bearing constant in the file: a tolerance that grows
 * with h makes agreement meaningless up high — at ±3%-of-h, a hi-hat's noise floor scored a
 * harmonicity of 1.00 against a spurious 761 Hz "fundamental" and the whole thing reported HIGH
 * confidence on unpitched noise. */
const HARMONIC_TOLERANCE = 0.04

/** …and, at the same time, no further than this many cents from the exact harmonic. The Hz rule
 * above is loose exactly where it matters most: at h=1 it permits 69 cents, so bell_b's two
 * partials A SEMITONE APART both "confirmed" a fundamental sitting between them and the textbook
 * ambiguous case reported HIGH. Requiring BOTH gives a tolerance that is musical at the bottom
 * (30 cents) and tight up top (~6 cents at h=11, which is what keeps a hi-hat's random peaks from
 * scoring as a harmonic series). */
const HARMONIC_TOLERANCE_CENTS = 30

/** Is `hz` the `nearest`-th harmonic of `f0`, by both rules above? */
function isHarmonicOf(hz: number, f0: number, nearest: number): boolean {
  if (nearest < 1) return false
  if (Math.abs(hz / f0 - nearest) > HARMONIC_TOLERANCE) return false
  return Math.abs(1200 * Math.log2(hz / (nearest * f0))) <= HARMONIC_TOLERANCE_CENTS
}

/** The highest harmonic the strongest partial may be and still be taken as CONFIRMING a
 * fundamental. Above this, "the strongest partial is an exact multiple of f0" stops being
 * evidence: with a low enough f0 candidate, nearly any partial is near some integer multiple of
 * it. Measured: the recipe-song pad (a CHORD, which must not report a single pitch) "agreed" at
 * harmonic 16, and the hi-hat at harmonic 11. A real fundamental's strongest partial is one of the
 * first few harmonics. */
const MAX_CONFIRMING_HARMONIC = 8

/** The magnitude share of the partial table that lands on an integer multiple of `f0`. A harmonic
 * tone scores ~1; a bell (partials at 1.8x, 2.4x…) and a chord (three unrelated series) both score
 * low, which is precisely the distinction this file has to make. */
function harmonicityOf(partials: SpectralPartial[], f0: number): number {
  if (partials.length === 0 || !(f0 > 0)) return 0
  let hit = 0
  let total = 0
  for (const p of partials) {
    const nearest = Math.round(p.hz / f0)
    total += p.magnitude
    if (isHarmonicOf(p.hz, f0, nearest)) hit += p.magnitude
  }
  return total === 0 ? 0 : hit / total
}

/** Detects the fundamental of a one-shot. See the file header for the honesty contract: an
 * unpitched, inharmonic or polyphonic sample must come back with a LOW confidence, not a
 * confident wrong number. */
export function detectPitch(channels: Float64Array[], sampleRate: number, opts: DetectPitchOptions = {}): PitchDetection {
  const fmin = opts.fmin ?? DEFAULT_FMIN
  const fmax = opts.fmax ?? DEFAULT_FMAX
  // Sanitize rather than trust: partialCount reaches here from a CLI flag, so a missing value
  // (`--partials` with nothing after it) arrives as NaN, and NaN silently poisons every slice
  // downstream. At least one row, always.
  const partialCount = Number.isFinite(opts.partialCount) ? Math.max(1, Math.trunc(opts.partialCount!)) : DEFAULT_PARTIALS
  const mono = toMono(channels)
  const durationSeconds = mono.length / sampleRate

  const empty = (method: string): PitchDetection => ({
    hz: null,
    midi: null,
    note: null,
    cents: null,
    confidence: 0,
    level: 'low',
    method,
    periodicity: 0,
    harmonicity: 0,
    partials: [],
    suggestedRootNote: null,
    suggestedRootHz: null,
    sampleRate,
    durationSeconds,
    analyzedFromSeconds: 0,
    analyzedToSeconds: durationSeconds,
  })
  if (mono.length === 0) return empty('empty file')

  const { from, to } = bodyWindow(mono, sampleRate)
  const seg = mono.subarray(from, to)
  if (seg.length < 256) return empty('too short to measure (< 256 samples of body past the attack)')

  const { mag, binHz, windowLength } = spectrum(seg, sampleRate)
  // Pick enough peaks to satisfy the caller's table AND the fixed set the decision uses, then
  // measure on the fixed set and slice for display. Without this, `--partials 3` and `--partials 8`
  // reported DIFFERENT confidences for the same file (harmonicity is a share of the table) — a
  // formatting flag silently moving a measurement, which is exactly the kind of quiet dishonesty
  // this file is supposed to be about.
  const all = pickPartials(mag, binHz, windowLength, mag.length * 2, fmin, Math.max(partialCount, DEFAULT_PARTIALS))
  const judged = all.slice(0, DEFAULT_PARTIALS)
  const partials = all.slice(0, partialCount)
  const suggestedRootHz = suggestRootHz(judged)
  const base = {
    partials,
    suggestedRootHz,
    suggestedRootNote: suggestedRootHz === null ? null : midiToNote(hzToMidi(suggestedRootHz)),
    sampleRate,
    durationSeconds,
    analyzedFromSeconds: from / sampleRate,
    analyzedToSeconds: to / sampleRate,
  }
  // Guard on the MEASUREMENT set, not the display slice: `judged` is what every reading below is
  // computed from, and keying this on `partials` meant a caller asking for a small table got told
  // its perfectly loud sample was "silence".
  if (judged.length === 0) return { ...empty('silence — no spectral peaks above the noise floor'), ...base }

  const y = yin(seg, sampleRate, fmin, fmax)
  const strongest = judged[0]!
  if (!y) {
    // Too short for the requested lag range: report the strongest partial as the only honest
    // reading, at a confidence that says "this is a partial, not a fundamental".
    const midi = hzToMidi(strongest.hz)
    return {
      ...base,
      hz: strongest.hz,
      midi,
      note: midiToNote(midi),
      cents: centsFrom(midi),
      confidence: 0.2,
      level: 'low',
      method: 'strongest partial only (too short for autocorrelation)',
      periodicity: 0,
      harmonicity: harmonicityOf(judged, strongest.hz),
    }
  }

  const yinHz = sampleRate / y.tau
  const periodicity = Math.max(0, Math.min(1, 1 - y.dPrime))
  const harmonicity = harmonicityOf(judged, yinHz)

  // Cross-check: does the strongest partial sit on an integer multiple of YIN's f0? On a clean
  // tone that is harmonic 1 (or 2, for a weak fundamental). When it does not, the two methods are
  // looking at different things and neither answer deserves confidence.
  const nearestHarmonic = Math.round(strongest.hz / yinHz)
  const agrees = nearestHarmonic <= MAX_CONFIRMING_HARMONIC && isHarmonicOf(strongest.hz, yinHz, nearestHarmonic)

  // Is the fundamental itself actually IN the spectrum? A periodic waveform can have a period no
  // partial corresponds to: 500+900+1200 Hz repeats at 100 Hz, so YIN calls it 100 Hz "correctly"
  // and every partial is an exact harmonic of it — a synthetic clang scored a confident 100 Hz that
  // is nowhere in the sound. A sample's ROOT has to be a pitch the sample actually contains, since
  // tuning it is what we are about to do, so a missing fundamental is treated as a subharmonic
  // artifact rather than a perceptual fundamental. Deliberately conservative, per this file's
  // honesty bias: the cost is a low confidence on a genuinely missing-fundamental one-shot (rare),
  // and the user's answer there is the same --root override the bells need anyway.
  const fundamentalPresent = judged.some((p) => isHarmonicOf(p.hz, yinHz, 1))

  // Where the two methods agree, prefer the SPECTRAL frequency of the matched harmonic, divided
  // down: a parabolically-interpolated peak on a long window beats a lag estimate for accuracy.
  const hz = agrees ? strongest.hz / nearestHarmonic : yinHz
  const midi = hzToMidi(hz)

  // The confidence formula, and the reason it is shaped this way: periodicity alone happily calls
  // a chord "pitched" (a chord IS periodic-ish), and harmonicity alone happily calls noise
  // harmonic (noise has peaks everywhere). Requiring BOTH, and gating on cross-method agreement,
  // is what makes bells and pads read low while a sine reads ~1.
  let confidence = periodicity * (0.35 + 0.65 * harmonicity)
  if (!agrees) confidence *= 0.4
  if (!fundamentalPresent) confidence *= 0.3
  confidence = Math.max(0, Math.min(1, confidence))

  return {
    ...base,
    hz,
    midi,
    note: midiToNote(midi),
    cents: centsFrom(midi),
    confidence,
    level: pitchConfidenceLevel(confidence),
    method:
      (agrees
        ? `yin autocorrelation + fft partial ${nearestHarmonic === 1 ? 'fundamental' : `harmonic ${nearestHarmonic}`} (agree)`
        : `yin autocorrelation (fft's strongest partial at ${strongest.hz.toFixed(1)} Hz is not a harmonic of it — disagree)`) +
      (fundamentalPresent ? '' : `; no partial at ${yinHz.toFixed(1)} Hz itself — likely a subharmonic of an inharmonic sound, not a root`),
    periodicity,
    harmonicity,
  }
}

function centsFrom(midi: number): number {
  return (midi - Math.round(midi)) * 100
}

/** The partials table as the fixed-width block `beat sample-info` prints and `beat keymap`'s
 * refusal quotes. Kept here, next to the measurement, so both surfaces render it identically. */
export function formatPartials(partials: SpectralPartial[]): string {
  if (partials.length === 0) return '  (no partials above the noise floor)'
  const rows = partials.map((p, i) => {
    const midi = hzToMidi(p.hz)
    return (
      `  ${String(i + 1).padStart(2)}  ${p.hz.toFixed(1).padStart(9)} Hz  ` +
      `${p.relDb.toFixed(1).padStart(6)} dB  ` +
      `${('x' + p.ratio.toFixed(3)).padStart(7)}  ${midiToNote(midi).padEnd(4)}`
    )
  })
  return ['   #  frequency      level    ratio  note', ...rows].join('\n')
}

/** The one-line honest summary of a detection, shared by sample-info and keymap's messages. */
export function formatPitchLine(p: PitchDetection): string {
  if (p.hz === null || p.midi === null) return `pitch      none detected (${p.method})`
  const cents = p.cents ?? 0
  const sign = cents >= 0 ? '+' : ''
  return (
    `pitch      ${p.hz.toFixed(1)} Hz = ${p.note} ${sign}${cents.toFixed(0)} cents (MIDI ${p.midi.toFixed(2)})\n` +
    `confidence ${p.level.toUpperCase()} ${p.confidence.toFixed(2)} — periodicity ${p.periodicity.toFixed(2)}, harmonicity ${p.harmonicity.toFixed(2)}\n` +
    `method     ${p.method}`
  )
}
