// Phase 26 Stream DH — a real wavetable oscillator's table library.
//
// The gap this closes (docs/research/68-ableton-vs-dotbeat-instrument-reference.md): `wtTable`/
// `wtPos` have been live, format-frozen fields since v0.3 (document.ts's SYNTH_FIELDS) and
// synthParams.ts's panel has shown WT/WTpos knobs the whole time, but engine.ts's OscType only
// ever supported sine/triangle/sawtooth/square — the knobs were wired to nothing. This module is
// the "nothing" they're now wired to.
//
// v1 scope: a small table-per-category library matching the existing 4-value wtTable enum
// (analog/pwm/vocal/custom), NOT an attempt at Ableton Wavetable's huge factory library. Each
// category is 5 hand-built single-cycle "frames"; wtPos (0..1) linear-interpolates across them.
//
// Representation choice: instead of raw sampled single-cycle waveforms (which would need an
// AudioBuffer/AudioWorklet playback path, or an FFT round-trip to band-limit for PeriodicWave),
// each frame IS a harmonic partial-amplitude spectrum — exactly the shape Tone.Oscillator's own
// `partials` field wants (see OscillatorInterface.d.ts: "partials describes the relative
// amplitude of each of the harmonics... setting this automatically sets type to 'custom'"),
// which under the hood becomes a real AudioContext.createPeriodicWave() (properly band-limited by
// the browser, no manual anti-aliasing needed). This is a legitimate, common way to define a
// wavetable frame (many wavetable synths' "additive" category is authored exactly this way) and
// keeps the whole feature inside Tone.PolySynth's existing plumbing (envelope/unison/LFO/effects
// all keep working unmodified) rather than a parallel oscillator bank or a raw-buffer scan.
//
// Scope cut: this is a stepped/regenerated scan (engine.ts's setWavetable recomputes the partials
// array and calls PolySynth.set() whenever wtTable/wtPos change beyond a small epsilon), not a
// sample-accurate continuous inter-frame crossfade within a single held note. Good enough for live
// knob-turning and wtPos automation/LFO to sound like real timbral movement (verified against
// measured audio in verify-phase26-stream-dh.mjs), not a claim of true continuous-phase scanning.

import type { WtTable } from '../types'

/** Harmonics per frame — enough detail across the audible range (up to the 24th harmonic of a
 * mid-register note lands well past the "presence" band) without being expensive to regenerate
 * live. Index 0 = the fundamental (1st harmonic), matching Tone's `partials` convention exactly. */
const N_PARTIALS = 24

type Frame = readonly number[]

/** Normalize a frame to unit L2 energy so scanning through a table doesn't itself change
 * loudness — whatever difference shows up between wtPos positions is genuine harmonic-content
 * movement, not a volume artifact riding along with it (this is exactly what
 * verify-phase26-stream-dh.mjs's spectral-vs-loudness check confirms against real rendered
 * audio). The browser's own createPeriodicWave also auto-normalizes to unit peak by default, but
 * normalizing here first keeps very sparse frames (e.g. 'custom's high-step frames, mostly zeros)
 * from feeding it near-degenerate values. */
function normalize(frame: number[]): Frame {
  let energy = 0
  for (const a of frame) energy += a * a
  const norm = Math.sqrt(energy) || 1
  return Object.freeze(frame.map((a) => a / norm))
}

function frame(fn: (harmonic: number) => number): Frame {
  return normalize(Array.from({ length: N_PARTIALS }, (_, i) => fn(i + 1)))
}

// ---- 'analog' — classic subtractive waveshapes, sine -> triangle -> saw -> square -> bright saw.
// Each frame is that waveform's own real Fourier series (truncated to N_PARTIALS), so wtPos here
// sweeps through timbres a subtractive player already knows by ear.
const ANALOG_FRAMES: Frame[] = [
  frame((n) => (n === 1 ? 1 : 0)), // sine: fundamental only
  frame((n) => (n % 2 === 1 ? 1 / (n * n) : 0)), // triangle: odd harmonics, 1/n^2 (soft)
  frame((n) => 1 / n), // sawtooth: all harmonics, 1/n (buzzy)
  frame((n) => (n % 2 === 1 ? 1 / n : 0)), // square: odd harmonics, 1/n (hollow)
  frame((n) => 1 / Math.pow(n, 0.6)), // bright saw: shallower rolloff (harsher/brighter)
]

// ---- 'pwm' — rectangular pulse trains at progressively narrower duty cycles. Real Fourier series
// of a duty-cycle-d pulse train: |sin(n*pi*d)| / (n*pi) — at d=0.5 this collapses to the square
// wave above (odd harmonics only); narrower duty cycles push energy into a comb of harmonics with
// nulls that move as d shrinks, the real acoustic signature of PWM.
function pulseFrame(duty: number): Frame {
  return frame((n) => {
    const x = Math.PI * n * duty
    return Math.abs(Math.sin(x)) / (n * Math.PI)
  })
}
const PWM_FRAMES: Frame[] = [0.5, 0.38, 0.25, 0.15, 0.08].map(pulseFrame)

// ---- 'vocal' — formant-shaped spectra: a fading sawtooth-ish carrier (keeps low harmonics
// present) plus two Gaussian "formant" bumps at roughly classic vowel-chart F1/F2 frequencies (in
// absolute Hz — a real vocal tract's resonances don't move with the singer's pitch, so neither do
// these). wtPos sweeps ah -> eh -> ee -> oh -> oo.
interface Formant {
  freq: number
  width: number
  gain: number
}
function formantFrame(formants: readonly Formant[]): Frame {
  return frame((n) => {
    const f = n * 220 // reference f0 the formant table itself is authored against (A3)
    let amp = 1 / n
    for (const fm of formants) {
      const d = (f - fm.freq) / fm.width
      amp += fm.gain * Math.exp(-0.5 * d * d)
    }
    return Math.max(0, amp)
  })
}
const VOCAL_FRAMES: Frame[] = [
  formantFrame([{ freq: 700, width: 120, gain: 3 }, { freq: 1220, width: 160, gain: 2 }]), // "ah"
  formantFrame([{ freq: 530, width: 100, gain: 3 }, { freq: 1840, width: 200, gain: 2 }]), // "eh"
  formantFrame([{ freq: 270, width: 80, gain: 3 }, { freq: 2290, width: 260, gain: 2.4 }]), // "ee"
  formantFrame([{ freq: 570, width: 110, gain: 3 }, { freq: 840, width: 130, gain: 2 }]), // "oh"
  formantFrame([{ freq: 300, width: 90, gain: 3 }, { freq: 870, width: 130, gain: 2 }]), // "oo"
]

// ---- 'custom' — sparse "digital" tables: only every Kth harmonic present, increasingly hollow/
// metallic as K rises (K=1 is a plain saw; K=5 leaves only the 5th/10th/15th/... harmonics, a
// thin, bell-ish, octave-displaced buzz). Deliberately the odd one out of the four categories —
// this is the bucket for tones with no clean analog/PWM/vocal analogue.
function sparseFrame(step: number): Frame {
  return frame((n) => (n % step === 0 ? step / n : 0))
}
const CUSTOM_FRAMES: Frame[] = [1, 2, 3, 4, 5].map(sparseFrame)

const LIBRARY: Record<WtTable, Frame[]> = {
  analog: ANALOG_FRAMES,
  pwm: PWM_FRAMES,
  vocal: VOCAL_FRAMES,
  custom: CUSTOM_FRAMES,
}

/** The actual wavetable scan: `pos` (0..1) selects a continuous position across `table`'s 5
 * frames, linear-interpolating PER-HARMONIC amplitude between the two nearest frames — the same
 * idea as a real wavetable oscillator's inter-frame crossfade, just expressed as a harmonic
 * spectrum instead of raw sample interpolation. Returns a plain number[] ready for
 * Tone.PolySynth.set({ oscillator: { type: 'custom', partials } }) (see engine.ts's
 * setWavetable). */
export function buildWavetablePartials(table: WtTable, pos: number): number[] {
  const frames = LIBRARY[table] ?? LIBRARY.analog
  const clamped = Math.max(0, Math.min(1, pos))
  const continuous = clamped * (frames.length - 1)
  const i0 = Math.floor(continuous)
  const i1 = Math.min(i0 + 1, frames.length - 1)
  const frac = continuous - i0
  const a = frames[i0]!
  const b = frames[i1]!
  return a.map((v, i) => v + (b[i]! - v) * frac)
}
