// The LAYERED clip source (research 138 §3 B4 / §5.3a, research 131 §5, research 133 §1) — the
// first dotbeat showdown source whose rendered clip is a MULTI-VOICE INSTRUMENT rather than one
// naked patch.
//
// WHY. Every existing showdown source renders exactly one voice: `soloForShowdown` takes the
// composed doc and MUTES every track but one. A Splice pack loop is the opposite by construction —
// 2-4 sound layers, each with its own register, its own frequency placement, its own treatment,
// summed into one "instrument" (133 §2, 132 §1). The measured consequences of the difference, all
// from 131's 1,612 owner preference pairs:
//   - bass: packs put 60.1% of their energy below 60 Hz (centroid ~74 Hz); dotbeat's engineplus
//     bass puts 0.22% there (centroid ~162 Hz, more than an octave high).
//   - chords/lead: engineplus concentrates 99.35% / 99.19% of energy in the 250-2000 Hz mids band;
//     packs sit at 78.4% / 81.2% with 9.5% / 5.0% of real bass-band body underneath.
//   - width is a per-role PLACEMENT, not a level: elite ref bass is dead mono (-43 to -51 dB) while
//     elite ref lead is wide (-4.6 dB); the frozen engineplus constant is -10..-12 dB everywhere,
//     measurably wrong in both directions.
// None of those are reachable by ONE voice with ONE filter and ONE pan position. They are reachable
// by three or four voices placed deliberately, which is what this module assembles.
//
// WHAT IT IS NOT. No new DSP: every move here is an ordinary `.beat` field on an ordinary synth
// track, and the engine has always rendered multi-track projects. The frozen `engineplusProfile` /
// `surgeplusProfile` constants are NOT touched (CLAUDE.md's frozen-science rule) — the production
// pass the `layeredplus` arm uses is a NEW named profile that lives on each layer spec below.
//
// THE TWO ARMS, and why they are two:
//   layered      — the layer ARCHITECTURE only: per-layer register, the frequency crossover, the
//                  dB balance, the layer-intrinsic voice design (a "detuned width layer" IS a width
//                  move, so its unison/detune belong to the architecture), mono discipline on the
//                  low layers. NO insert-chain production: no chorus, reverb, delay, saturation,
//                  air shelf or compression. This arm's single variable versus engineplus is
//                  LAYERING.
//   layeredplus  — the same stack plus a per-layer production pass (the role-true width map,
//                  parallel/NY compression — 138 row 4, the `compMix` dry/wet fan that ships at 0
//                  and no profile has ever touched — glue, space and air). Its comparison partner
//                  is engineplus: same production question, layered shape instead of solo shape.
//
// TWO PRECONDITIONS FOR LAYERING AT ALL, both checked before building this and both satisfied:
//   1. Onset alignment. The most-repeated rule in the mined transient corpus is that layers must be
//      sample-aligned at note starts or the transient smears. Here it holds BY CONSTRUCTION:
//      `layerNotes` may change a layer's register, its voice selection, its note LENGTH and its
//      velocity, but it never moves a `start`. Every layer fires on the same grid step.
//   2. Oscillator phase at trigger time. The mined layering corpus's sharpest mechanism-level
//      finding is that a free-running oscillator layer produces INCONSISTENT PERCEIVED VOLUME from
//      hit to hit (not merely one static cancellation), because its phase when the note fires is
//      uncontrolled — which in a measurement would look like random sloppiness. Verified read-only
//      against this repo's engine (2026-07-26): each dotbeat synth voice is a `Tone.PolySynth<
//      Tone.Synth>`, and Tone's `Synth._triggerEnvelopeAttack` calls `this.oscillator.start(time)`
//      on EVERY note attack (node_modules/tone/build/esm/instrument/Synth.js:62-71), which
//      re-creates the underlying OscillatorNode at its configured phase (0 by default). So dotbeat
//      already hard-syncs oscillator phase per note-on, on every layer, including the unison pair
//      and sub polys. No confound; no engine fix needed. Recorded here because the opposite would
//      have invalidated every level measurement this module makes.

import { addEffect, NOTE_FIELD_DEFAULTS, parse, type BeatDocument, type BeatSynth, type OscType } from '../core/index.js'
import { applyProducedDefaults, type ProductionProfile, type ProducedResult } from '../analysis/produce.js'
import { BeatBatchError } from '../vary/batch.js'
import type { ComposedNote, ComposedPhrase } from './phrase.js'
import type { MixMetrics } from '../metrics/index.js'
import { metricsToFeatures } from './features.js'

/** The pitched roles the layered source covers. drum-loop is deliberately out of scope: a kit is
 * ALREADY a multi-voice instrument (kick/snare/hat lanes), so "layer it" is a different question
 * (131 P6's density prescription), not this one. */
export type LayeredRole = 'bassline' | 'chords' | 'lead'

export const LAYERED_ROLES: readonly LayeredRole[] = ['bassline', 'chords', 'lead']

export function isLayeredRole(role: string): role is LayeredRole {
  return (LAYERED_ROLES as readonly string[]).includes(role)
}

// ---- layer specification -------------------------------------------------------------------

/** How one layer derives ITS notes from the instrument's single shared figure. The whole point of a
 * layered instrument is that every layer plays the SAME musical figure — a stack playing different
 * notes is an arrangement, not an instrument — so the only transforms allowed are register,
 * voice-selection and articulation. */
export interface LayerFigure {
  /** semitones from the anchored base register (whole octaves in practice: +/-12, +/-24). */
  transpose: number
  /** which note of each simultaneous group this layer plays.
   *   `lowest`   — the register rule (research 124 §C.2): under ~100 Hz a layer carries the ROOT,
   *                never a chord colour tone.
   *   `highest`  — the air/sparkle selection.
   *   `dropRoot` — ROOTLESS voicing: drop the group's bottom note and let the body/bass layer carry
   *                the root instead. Two independent practitioner sources (a Kerri Chandler
   *                analysis and a modern layered-stab tutorial, mined 2026-07-26) name this as THE
   *                load-bearing move for the deep-house chord identity, and it is the direct
   *                structural fix for our measured failure — engineplus chords put 99.35% of their
   *                energy in the mids and fight whatever is underneath. Falls back to keeping a
   *                single-note group intact (there is no root to drop from one note).
   */
  pick: 'all' | 'lowest' | 'highest' | 'dropRoot'
  /** clamp every note to at most this many 16th-note steps — how a stab/click layer is made out of
   * a sustained figure without changing WHEN it plays (the onsets stay identical, so the layers
   * cannot drift apart rhythmically). */
  maxDurationSteps?: number
  /** MONOPHONIC/legato voicing: truncate every note so it ends before the next onset on this layer.
   * Four independent sources in the mined bass corpus insist the "rolling" low-end feel REQUIRES a
   * monophonic voice — overlapping notes muddy the low end — and they are precise about voice mode
   * while hand-waving cutoff, which inverts the usual emphasis. Several composed bass archetypes
   * (sparse-sub especially) do emit overlapping notes, so this is a defect designed out rather than
   * a preference. */
  monophonic?: boolean
  /** scale every velocity (clamped to 0.05..1). */
  velocityScale?: number
}

/** One layer's frequency placement. The engine gives each synth voice exactly ONE filter, so a
 * layer claims its territory with one crossover slope: the bottom layer is LOWPASSED (it owns
 * everything below its cutoff and nothing above), every layer above it is HIGHPASSED (it adds
 * nothing below its cutoff, so it cannot muddy the bottom layer's band). That single rule is what
 * makes the sum a mix instead of four voices fighting. */
export interface LayerBand {
  mode: 'lowpass' | 'highpass' | 'bandpass'
  cutoffHz: number
  resonance?: number
}

/** Parallel ("New York") compression on one layer — 138 free-win row 4. `compMix` ships at 0 and no
 * dotbeat profile has ever set it, so the engine's comp insert is a true dry/wet fan sitting
 * completely unused; at a hard threshold/ratio with a 30-40% mix it adds density WITHOUT flattening
 * the transient (the crest holds), which is exactly the reconciled prescription of 131 §6. */
export interface LayerComp {
  threshold: number
  ratio: number
  attack: number
  release: number
  mix: number
}

/** The `layeredplus` production for one layer: the shared ProductionProfile vocabulary (width /
 * glue / space / air / motion, applied through the one `applyProducedDefaults` primitive) plus the
 * parallel compressor, which the shared profile type does not model. */
export interface LayerProduction {
  profile: ProductionProfile
  comp?: LayerComp
}

export interface LayerSpec {
  /** the track id in the assembled doc (also the layer's identity in every report). */
  id: string
  /** display name — one word, so it round-trips the `track <id> <Name> <#color> <kind>` line. */
  label: string
  color: string
  figure: LayerFigure
  band: LayerBand
  /** the layer's level in the stack, dB. The balance IS the instrument. */
  gainDb: number
  /** layer-intrinsic voice design: oscillators, envelopes, and — only where width is the layer's
   * REASON to exist — unison/detune/pan. Never inserts; those are `production`. */
  patch: Partial<BeatSynth>
  /** this layer must render mono: pan 0, no unison spread, no chorus, no widener, no auto-pan, no
   * reverb send. Enforced by `assertMonoDiscipline` on BOTH arms — the sub is the one thing that
   * must never be widened (research 115 §2.2, and 131 §5: elite ref bass is -43 to -51 dB). */
  mono: boolean
  production?: LayerProduction
}

export interface LayeredArchitecture {
  role: LayeredRole
  /** what the stack is, in one line — carried into the manifest `from` so a rated clip is
   * traceable to its architecture without opening the doc. */
  summary: string
  /** the octave window the whole stack is normalized into: the whole-octave shift that puts the
   * figure's MEDIAN pitch inside this window is applied to every layer, so the instrument sits in
   * its measured register no matter which archetype/register the composer drew. MUST be a full
   * octave wide (hiMidi - loMidi >= 12) — otherwise a median can fall in a gap no whole-octave
   * shift can reach, and the register target silently becomes a coin flip on some figures. */
  anchor: { loMidi: number; hiMidi: number }
  layers: readonly LayerSpec[]
}

// ---- the three architectures ---------------------------------------------------------------
// Registers, crossovers and balances below are read off the measured per-role rows in 131 §2.2/§5,
// 133 §1 and 138 §2. Every number is a target, not taste: the `verifyLayeredTargets` gate at the
// bottom of this file checks the RENDER against those same rows, so a wrong number here shows up as
// a failed feature rather than as an opinion.

const MONO_PATCH: Partial<BeatSynth> = { pan: 0, unisonVoices: 1, unisonWidth: 0, chorusMode: 'off', chorusMix: 0, utilityWidth: 0.5, autoPanMix: 0, sendReverb: 0, sendDelay: 0 }

/** bassline: sub + mid/growl + top/click — three layers, each with a named job and a band it owns.
 *
 * The mined bass corpus (2026-07-26: bass-house / bass-techno / bass-basseries / layering veins,
 * 4 independent sources) converges on a 3-4 layer sub / mid / growl / air stack with a **75-100 Hz
 * sub-to-mid crossover** (three independent numeric figures: 75, 79, 90-100 Hz). This takes the
 * middle of that band: the sub is lowpassed at 90 and the mid highpassed at 80, a real crossover
 * rather than two voices summing. Stopping at three layers is deliberate — the same corpus's
 * strongest cross-source consensus is that layering without a named reason produces mud, and the
 * stated rule is to REMOVE a layer before adding one.
 *
 * SUB — a pure sine (corroborated: sub is always a sine or triangle, never harmonically rich)
 * playing ROOT NOTES ONLY, monophonic/legato, in the G1-C2 window (49-65 Hz) — the register 131
 * measured on pack bass (centroid ~74 Hz, 60.1% of energy under 60 Hz) and more than an octave
 * below where engineplus's bass actually sits (162 Hz, 0.22% sub). Carries `subLevel` (138 row 1:
 * 0 today; no profile has ever set it) for weight an octave lower still. Dead mono.
 * MID/GROWL — an octave up (98-131 Hz), saw + square with the osc2 -1200 body move, highpassed at
 * 80 so it cannot muddy the sub. This is the CHARACTER, the thing a single-voice bass patch is
 * trying and failing to be simultaneously with the sub, and the corpus's "harmonically richer
 * waveform, driven harder, often saturated" layer.
 * CLICK — a 1-step square/noise transient two octaves up, highpassed at 1600 (the corpus's 1-5 kHz
 * click band), -20 dB: pure definition, the part that reads on earbuds.
 *
 * BALANCE, and an honest disagreement: MusicRadar's worked example puts the sub at -3 dB and the
 * transient layer at -10 dB (sub HOTTER by ~7 dB), which is what is implemented here (-4 / -9 / -20).
 * A summary that reached this stream mid-build reported the opposite (sub 9 dB UNDER the mid); the
 * primary source says sub-hotter, and our own measured target — bandSubPct >= 30% — only reaches
 * with the sub carrying the stack. Recorded rather than averaged.
 *
 * NOT REACHABLE, stated: the 808 vein's signature attack move is a 24-semitone pitch dive over
 * 40-60 ms at note-on. dotbeat has no pitch envelope, so the click layer substitutes for it. */
const BASSLINE_ARCH: LayeredArchitecture = {
  role: 'bassline',
  summary: 'mono sine sub (G1-C2, legato, lowpass 90) + saw/square growl (+12, highpass 80, osc2 -1200) + 1-step click (+24, highpass 1600)',
  anchor: { loMidi: 26, hiMidi: 38 },
  layers: [
    {
      id: 'sub',
      label: 'Sub',
      color: '#e06c75',
      figure: { transpose: 0, pick: 'lowest', monophonic: true },
      band: { mode: 'lowpass', cutoffHz: 90, resonance: 0 },
      gainDb: -4,
      mono: true,
      patch: {
        ...MONO_PATCH,
        osc: 'sine' as OscType,
        subLevel: 0.35,
        attack: 0.006,
        decay: 0.14,
        sustain: 0.95,
        release: 0.08,
        glide: 0.02, // near-zero glide + monophonic voicing = the corpus's "rolling" bass feel
      },
      production: {
        profile: { role: 'sub', saturator: { drive: 0.3, mix: 0.35 } },
        comp: { threshold: -30, ratio: 6, attack: 0.015, release: 0.12, mix: 0.3 },
      },
    },
    {
      id: 'mid',
      label: 'Growl',
      color: '#d19a66',
      figure: { transpose: 12, pick: 'all', monophonic: true, velocityScale: 0.95 },
      band: { mode: 'highpass', cutoffHz: 80, resonance: 0.1 },
      gainDb: -9,
      mono: true,
      patch: {
        ...MONO_PATCH,
        osc: 'sawtooth' as OscType,
        osc2Type: 'square' as OscType,
        osc2Level: 0.3,
        osc2Detune: -1200, // the body move (138 row 3): engineplus uses osc2 at +10 CENTS, a width
        // trick, never as an octave-down body layer — this is that lever used as intended.
        attack: 0.004,
        decay: 0.2,
        sustain: 0.62,
        release: 0.1,
        eqHigh: -2,
      },
      production: {
        profile: { role: 'bass', saturator: { drive: 0.4, mix: 0.45 }, eqHigh: 2 },
        comp: { threshold: -28, ratio: 8, attack: 0.015, release: 0.12, mix: 0.3 },
      },
    },
    {
      id: 'click',
      label: 'Click',
      color: '#e5c07b',
      figure: { transpose: 24, pick: 'lowest', maxDurationSteps: 1, velocityScale: 0.8 },
      band: { mode: 'highpass', cutoffHz: 1600, resonance: 0.25 },
      gainDb: -20,
      mono: true,
      patch: {
        ...MONO_PATCH,
        osc: 'square' as OscType,
        noiseLevel: 0.18,
        attack: 0.001, // 138 row 7: attacks <= 8-12 ms; a click layer is where a bass gets one
        decay: 0.05,
        sustain: 0,
        release: 0.03,
      },
      production: {
        // 5-10 ms on a transient layer (transients vein) — the one place a fast comp attack is
        // right, because the layer IS the transient; everywhere else 10-30 ms preserves punch.
        profile: { role: 'perc', eqHigh: 4 },
        comp: { threshold: -26, ratio: 6, attack: 0.008, release: 0.08, mix: 0.25 },
      },
    },
  ],
}

/** chords: body + pad + stab + air.
 *
 * 131 §6 measured engineplus chords at 99.35% mids occupancy against packs' 78.4% (with 9.5% real
 * bass-band body); 138 row 3's target is 18-28% bass-band. The BODY layer is that number: root notes
 * only, an octave under the voicing (130-250 Hz), lowpassed at 380, mono, with the osc2 -1200 body
 * move. The PAD is the sustained wide voice (unison 5 / width 0.75, slow 60 ms attack) highpassed at
 * 200 so it never reaches into the body's band. The STAB is the same voicing clamped to 2 steps with
 * a 2 ms attack, highpassed at 320 — it is what supplies the rhythm and the transient life (packs
 * chords fire 4.9 onsets/s and attack in ~7 ms; engineplus 2.3 onsets/s in ~31 ms). The AIR layer is
 * a noise-heavy top an octave up, highpassed at 2.5 kHz at -26 dB: the 2-8 kHz presence texture
 * `flatnessHiDb` measures and the one thing no dotbeat oscillator has ever supplied.
 *
 * ROOTLESS STAB. The stab plays a `dropRoot` voicing — the chord minus its bottom note — and the
 * BODY layer carries the root instead. Two independent practitioner sources name omitting the root
 * from the chord stab as the load-bearing move for this sound, and it is the structural fix for the
 * exact failure 131 measured: our chords are 99% mids because every voice, including the bottom one,
 * is crowded into the same band fighting whatever is underneath.
 *
 * HONEST GAP, per the mined corpus: chords/pads is the ONE role with no canonical numeric
 * pad+pluck+air recipe in the literature — the pattern (focus layer + support layer, stereo
 * placement rather than frequency ownership as the primary differentiator) is well attested, the
 * numbers are not. The frequencies and levels below are therefore extrapolated from the measured
 * dotbeat/pack rows, not quoted from a source, and should be read as this arm's hypothesis. The one
 * genuinely chord-SPECIFIC technique the corpus does name — interval layering, tuning osc2 to a
 * perfect fifth so a triad reads as a ninth — is deliberately NOT exercised in v1: nothing in the
 * available feature set can verify a harmonic change, so it would be an unmeasurable variable
 * riding along inside a measured arm. It is a knob for a later round. */
const CHORDS_ARCH: LayeredArchitecture = {
  role: 'chords',
  summary: 'body root octave-down (mono, lowpass 380) + wide sustained pad (highpass 200) + ROOTLESS 2-step stab (highpass 320, 2 ms attack) + noise air (+12, highpass 2.5k)',
  anchor: { loMidi: 59, hiMidi: 71 },
  layers: [
    {
      id: 'body',
      label: 'Body',
      color: '#98c379',
      figure: { transpose: -12, pick: 'lowest', monophonic: true },
      band: { mode: 'lowpass', cutoffHz: 380, resonance: 0 },
      gainDb: -12,
      mono: true,
      patch: {
        ...MONO_PATCH,
        osc: 'triangle' as OscType,
        osc2Type: 'sine' as OscType,
        osc2Level: 0.25,
        osc2Detune: -1200,
        subLevel: 0.12,
        attack: 0.008,
        decay: 0.3,
        sustain: 0.82,
        release: 0.25,
      },
      production: {
        profile: { role: 'bass', saturator: { drive: 0.25, mix: 0.3 } },
        comp: { threshold: -30, ratio: 6, attack: 0.015, release: 0.15, mix: 0.3 },
      },
    },
    {
      id: 'pad',
      label: 'Pad',
      color: '#61afef',
      figure: { transpose: 0, pick: 'all' },
      band: { mode: 'highpass', cutoffHz: 200, resonance: 0.05 },
      gainDb: -11,
      mono: false,
      patch: {
        osc: 'sawtooth' as OscType,
        osc2Type: 'sawtooth' as OscType,
        osc2Level: 0.35,
        // detune is the most CONTESTED number in the mined corpus (sub-4 cents = "warmth" in deep
        // house, the same amount called a defect in string pads, ~7.5 for trance aggression, and
        // "+/-7 to +/-61 all called classic" in the bass vein). Treated as a style dial, set at the
        // warm end for a pad, and deliberately NOT claimed as a sourced constant.
        osc2Detune: 6,
        unisonVoices: 5,
        unisonWidth: 0.75,
        attack: 0.06,
        decay: 0.6,
        sustain: 0.85,
        release: 0.6,
        pan: -0.15,
      },
      production: {
        profile: { role: 'pad', chorusMix: 0.35, utilityWidth: 0.72, saturator: { drive: 0.2, mix: 0.28 }, sendReverb: 0.3, sendDelay: 0.08, eqHigh: 2.5 },
        comp: { threshold: -28, ratio: 6, attack: 0.02, release: 0.2, mix: 0.25 },
      },
    },
    {
      id: 'stab',
      label: 'Stab',
      color: '#c678dd',
      figure: { transpose: 0, pick: 'dropRoot', maxDurationSteps: 2, velocityScale: 0.95 },
      band: { mode: 'highpass', cutoffHz: 320, resonance: 0.15 },
      gainDb: -10,
      mono: false,
      patch: {
        osc: 'square' as OscType,
        osc2Type: 'sawtooth' as OscType,
        osc2Level: 0.3,
        osc2Detune: 12,
        attack: 0.002,
        decay: 0.16,
        sustain: 0.05,
        release: 0.12,
        pan: 0.15,
      },
      production: {
        profile: { role: 'chords', chorusMix: 0.2, utilityWidth: 0.66, saturator: { drive: 0.25, mix: 0.3 }, sendReverb: 0.14, sendDelay: 0.12, eqHigh: 3 },
        comp: { threshold: -28, ratio: 8, attack: 0.012, release: 0.1, mix: 0.35 },
      },
    },
    {
      id: 'air',
      label: 'Air',
      color: '#56b6c2',
      figure: { transpose: 12, pick: 'highest', maxDurationSteps: 3, velocityScale: 0.7 },
      band: { mode: 'highpass', cutoffHz: 2500, resonance: 0.1 },
      gainDb: -26,
      mono: false,
      patch: {
        osc: 'triangle' as OscType,
        noiseLevel: 0.5,
        attack: 0.004,
        decay: 0.25,
        sustain: 0.15,
        release: 0.3,
        unisonVoices: 3,
        unisonWidth: 0.9,
        pan: 0,
      },
      production: {
        profile: { role: 'hats', utilityWidth: 0.85, sendReverb: 0.4, eqHigh: 5, autoPan: { rate: 0.12, depth: 0.4, mix: 0.3 } },
      },
    },
  ],
}

/** lead: body + main + octave + width.
 *
 * The task's architecture is main + octave-up + detuned width layer; the BODY layer is the fourth,
 * added because the measured target demands it — 138 row 3 puts pack lead at 5-12% bass-band body
 * against engineplus's 99.19% mids, and no amount of octave-up layering produces low end. It plays
 * roots two octaves down at -17 dB, lowpassed at 400, mono, monophonic.
 *
 * The OCTAVE layer is the single most precisely quantified secondary layer in the whole mined
 * corpus — MusicTech's numbers, corroborated by two further sources: drop to **3-5 voice unison**
 * with tighter detune, **highpass around 500 Hz**, sit **6-10 dB below the main layer**. All three
 * are implemented literally (4 voices, HP 500, -7 dB under main). MAIN is a 5-voice saw stack with a
 * 3 ms attack (131 P2: pack leads attack in ~8 ms, engineplus in 26.6) at +7 cents — near Hyperbits'
 * +/-10-cent general thickening figure, and well under the "past ~50% of range turns dissonant"
 * warning. WIDTH is the same notes through a 7-voice unison at 18 cents, highpassed at 400 and
 * panned opposite the octave layer — width as a LAYER, which is how elite ref leads reach -4.6 dB
 * while a single voice's stereo trick tops out around -11.
 *
 * Panning is used sparingly and never as the primary separator: the corpus's flat warning is that
 * club systems sum to mono, so pan-based separation is mix-only. Frequency ownership does the work. */
const LEAD_ARCH: LayeredArchitecture = {
  role: 'lead',
  summary: 'body roots two octaves down (mono, lowpass 400) + 5-voice main saw (3 ms attack, highpass 220) + 4-voice octave-up (+12, highpass 500, -7 dB) + 7-voice detuned width layer (highpass 400)',
  anchor: { loMidi: 71, hiMidi: 83 },
  layers: [
    {
      id: 'body',
      label: 'Body',
      color: '#98c379',
      figure: { transpose: -24, pick: 'lowest', monophonic: true },
      band: { mode: 'lowpass', cutoffHz: 400, resonance: 0 },
      gainDb: -17,
      mono: true,
      patch: {
        ...MONO_PATCH,
        osc: 'triangle' as OscType,
        osc2Type: 'sine' as OscType,
        osc2Level: 0.2,
        osc2Detune: -1200,
        attack: 0.01,
        decay: 0.25,
        sustain: 0.6,
        release: 0.2,
      },
      production: {
        profile: { role: 'bass', saturator: { drive: 0.3, mix: 0.35 } },
        comp: { threshold: -30, ratio: 6, attack: 0.015, release: 0.15, mix: 0.3 },
      },
    },
    {
      id: 'main',
      label: 'Main',
      color: '#e06c75',
      figure: { transpose: 0, pick: 'all' },
      band: { mode: 'highpass', cutoffHz: 220, resonance: 0.2 },
      gainDb: -10,
      mono: false,
      patch: {
        osc: 'sawtooth' as OscType,
        osc2Type: 'sawtooth' as OscType,
        osc2Level: 0.3,
        osc2Detune: 7,
        unisonVoices: 5,
        unisonWidth: 0.5,
        attack: 0.003,
        decay: 0.2,
        sustain: 0.55,
        release: 0.18,
        pan: 0,
      },
      production: {
        profile: { role: 'lead', chorusMix: 0.2, utilityWidth: 0.66, saturator: { drive: 0.28, mix: 0.35 }, sendReverb: 0.2, sendDelay: 0.14, eqHigh: 3.5 },
        comp: { threshold: -28, ratio: 8, attack: 0.012, release: 0.1, mix: 0.35 },
      },
    },
    {
      id: 'octave',
      label: 'Octave',
      color: '#e5c07b',
      // MusicTech's numbers, corroborated twice: 3-5 unison voices, HP ~500 Hz, 6-10 dB under main.
      figure: { transpose: 12, pick: 'all', velocityScale: 0.8 },
      band: { mode: 'highpass', cutoffHz: 500, resonance: 0.1 },
      gainDb: -17,
      mono: false,
      patch: {
        osc: 'triangle' as OscType,
        osc2Type: 'sawtooth' as OscType,
        osc2Level: 0.2,
        osc2Detune: 4,
        unisonVoices: 4,
        unisonWidth: 0.45,
        attack: 0.004,
        decay: 0.18,
        sustain: 0.4,
        release: 0.15,
        pan: 0.2,
      },
      production: {
        profile: { role: 'lead', utilityWidth: 0.7, sendReverb: 0.26, sendDelay: 0.16, eqHigh: 4 },
        comp: { threshold: -28, ratio: 6, attack: 0.015, release: 0.1, mix: 0.25 },
      },
    },
    {
      id: 'width',
      label: 'Width',
      color: '#c678dd',
      figure: { transpose: 0, pick: 'all', velocityScale: 0.85 },
      band: { mode: 'highpass', cutoffHz: 400, resonance: 0.05 },
      gainDb: -15,
      mono: false,
      patch: {
        osc: 'sawtooth' as OscType,
        osc2Type: 'sawtooth' as OscType,
        osc2Level: 0.45,
        osc2Detune: 18,
        unisonVoices: 7,
        unisonWidth: 0.95,
        attack: 0.012,
        decay: 0.3,
        sustain: 0.6,
        release: 0.3,
        pan: -0.2,
      },
      production: {
        profile: { role: 'lead', chorusMix: 0.5, utilityWidth: 0.9, saturator: { drive: 0.2, mix: 0.25 }, sendReverb: 0.35, sendDelay: 0.1, autoPan: { rate: 0.1, depth: 0.35, mix: 0.25 }, eqHigh: 3 },
      },
    },
  ],
}

const ARCHITECTURES: Record<LayeredRole, LayeredArchitecture> = {
  bassline: BASSLINE_ARCH,
  chords: CHORDS_ARCH,
  lead: LEAD_ARCH,
}

export function layeredArchitecture(role: string): LayeredArchitecture {
  if (!isLayeredRole(role)) throw new BeatBatchError(`no layered architecture for role "${role}" (have: ${LAYERED_ROLES.join(', ')})`)
  return ARCHITECTURES[role]
}

// ---- crossover discipline --------------------------------------------------------------------

export interface CrossoverCheck {
  ok: boolean
  problems: string[]
  /** the ladder, low to high: each layer's claimed lower edge in Hz (0 for the lowpassed bottom). */
  ladder: { id: string; mode: LayerBand['mode']; cutoffHz: number; lowerEdgeHz: number }[]
}

/** Is this architecture a real crossover, or four voices fighting? The three invariants:
 *   1. Exactly ONE bottom layer, and it is lowpassed — something has to own the low end alone.
 *   2. Every other layer is highpassed at or above HALF the bottom's lowpass cutoff, so nothing
 *      else pours energy into the bottom layer's band.
 *   3. The bottom's lowpass and the LOWEST highpass meet within one octave of each other — closer
 *      than that leaves a hole in the spectrum, further than that is an octave of two layers
 *      summing in the same band (the mud a single-voice patch cannot avoid). */
export function checkCrossover(arch: LayeredArchitecture): CrossoverCheck {
  const problems: string[] = []
  const lows = arch.layers.filter((l) => l.band.mode === 'lowpass')
  const highs = arch.layers.filter((l) => l.band.mode === 'highpass')
  if (arch.layers.length < 2) problems.push('a layered instrument needs at least two layers')
  if (lows.length !== 1) problems.push(`expected exactly one lowpassed bottom layer, found ${lows.length} (${lows.map((l) => l.id).join(', ') || 'none'})`)
  if (highs.length !== arch.layers.length - lows.length) problems.push('every layer above the bottom must be highpassed (bandpass layers are not a crossover)')
  const bottom = lows[0]
  if (bottom && highs.length > 0) {
    const lowestHp = Math.min(...highs.map((l) => l.band.cutoffHz))
    for (const h of highs) {
      if (h.band.cutoffHz < bottom.band.cutoffHz / 2) {
        problems.push(`layer "${h.id}" highpasses at ${h.band.cutoffHz} Hz, below half the bottom layer's ${bottom.band.cutoffHz} Hz lowpass — it would pour into "${bottom.id}"'s band`)
      }
    }
    const ratio = bottom.band.cutoffHz / lowestHp
    if (ratio > 2) problems.push(`bottom lowpass ${bottom.band.cutoffHz} Hz overlaps the lowest highpass ${lowestHp} Hz by more than an octave (ratio ${ratio.toFixed(2)})`)
    if (ratio < 1) problems.push(`bottom lowpass ${bottom.band.cutoffHz} Hz sits below the lowest highpass ${lowestHp} Hz — a hole in the spectrum (ratio ${ratio.toFixed(2)})`)
  }
  if (bottom && !bottom.mono) problems.push(`the bottom layer "${bottom.id}" must be mono (research 115 §2.2 / 131 §5: elite ref bass is -43..-51 dB wide)`)
  const ladder = [...arch.layers]
    .map((l) => ({ id: l.id, mode: l.band.mode, cutoffHz: l.band.cutoffHz, lowerEdgeHz: l.band.mode === 'lowpass' ? 0 : l.band.cutoffHz }))
    .sort((a, b) => a.lowerEdgeHz - b.lowerEdgeHz || a.id.localeCompare(b.id))
  return { ok: problems.length === 0, problems, ladder }
}

/** Every field a `mono: true` layer must hold, and the value it must hold. A layer that widens the
 * low end is the single largest measured width error in the log (138 row 5: the frozen role-blind
 * profile widens bass to -11.8 dB against a -45 dB target), so this is asserted on the assembled
 * doc — after production — not merely intended in the spec. */
export const MONO_DISCIPLINE: { field: keyof BeatSynth; value: number | string }[] = [
  { field: 'pan', value: 0 },
  { field: 'unisonVoices', value: 1 },
  { field: 'unisonWidth', value: 0 },
  { field: 'chorusMode', value: 'off' },
  { field: 'chorusMix', value: 0 },
  { field: 'utilityWidth', value: 0.5 },
  { field: 'autoPanMix', value: 0 },
  { field: 'sendReverb', value: 0 },
  { field: 'sendDelay', value: 0 },
]

/** Assert mono discipline on the assembled doc. Returns the violations rather than throwing so a
 * caller can report all of them at once; `buildLayeredClip` throws on a non-empty result. */
export function monoViolations(doc: BeatDocument, arch: LayeredArchitecture): string[] {
  const out: string[] = []
  for (const layer of arch.layers) {
    if (!layer.mono) continue
    const track = doc.tracks.find((t) => t.id === layer.id)
    if (!track || track.kind !== 'synth') {
      out.push(`mono layer "${layer.id}" is missing from the assembled doc`)
      continue
    }
    for (const { field, value } of MONO_DISCIPLINE) {
      const have = track.synth[field]
      if (have !== value) out.push(`mono layer "${layer.id}": ${String(field)} is ${String(have)}, must be ${String(value)}`)
    }
  }
  return out
}

// ---- figure derivation -----------------------------------------------------------------------

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 === 1 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}

/** The whole-octave shift that puts the figure's median pitch in (or nearest to) the architecture's
 * anchor window. The composed banks draw their own register per archetype — bassNotes rolls the sub
 * register only 70% of the time, chordNotes is fixed at +12, leadNotes at +24 — so without this a
 * "layered bass" would land an octave high on 30% of batches and the register target (the largest
 * single per-role gap in the log) would be a coin flip. Deterministic; whole octaves only, so the
 * figure's musical content is untouched. */
export function anchorShift(phrase: ComposedPhrase, anchor: { loMidi: number; hiMidi: number }): number {
  if (phrase.notes.length === 0) throw new BeatBatchError('cannot anchor an empty figure')
  const med = median(phrase.notes.map((n) => n.pitch))
  const centre = (anchor.loMidi + anchor.hiMidi) / 2
  let best = 0
  let bestDist = Infinity
  for (let k = -5; k <= 5; k++) {
    const shifted = med + 12 * k
    const dist = shifted < anchor.loMidi ? anchor.loMidi - shifted : shifted > anchor.hiMidi ? shifted - anchor.hiMidi : 0
    const tie = Math.abs(shifted - centre)
    if (dist < bestDist - 1e-9 || (Math.abs(dist - bestDist) < 1e-9 && tie < Math.abs(med + 12 * best - centre))) {
      best = k
      bestDist = dist
    }
  }
  return 12 * best
}

/** Derive one layer's notes from the instrument's shared figure. Onsets are NEVER moved — only
 * register, voice selection, note length and velocity — so the layers cannot drift apart. */
export function layerNotes(phrase: ComposedPhrase, figure: LayerFigure, baseShift: number): ComposedNote[] {
  const byStart = new Map<number, ComposedNote[]>()
  for (const n of phrase.notes) {
    const group = byStart.get(n.start)
    if (group) group.push(n)
    else byStart.set(n.start, [n])
  }
  const out: ComposedNote[] = []
  for (const [, group] of byStart) {
    const sorted = [...group].sort((a, b) => a.pitch - b.pitch)
    const picked =
      figure.pick === 'all' ? sorted
      : figure.pick === 'lowest' ? [sorted[0]!]
      : figure.pick === 'highest' ? [sorted[sorted.length - 1]!]
      : sorted.length > 1 ? sorted.slice(1) // dropRoot — rootless voicing; a lone note has no root to drop
      : sorted
    for (const n of picked) {
      const duration = figure.maxDurationSteps === undefined ? n.duration : Math.min(n.duration, figure.maxDurationSteps)
      const velocity = Math.round(Math.min(1, Math.max(0.05, n.velocity * (figure.velocityScale ?? 1))) * 100) / 100
      out.push({ pitch: n.pitch + baseShift + figure.transpose, start: n.start, duration: Math.max(1, duration), velocity })
    }
  }
  out.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  if (figure.monophonic === true) {
    // legato/monophonic voicing: nothing on this layer may still be sounding when the next onset
    // arrives. Onsets are untouched (the layers stay sample-aligned); only tails are shortened.
    for (let i = 0; i < out.length - 1; i++) {
      const gap = out[i + 1]!.start - out[i]!.start
      if (gap > 0 && out[i]!.duration > gap) out[i] = { ...out[i]!, duration: Math.max(1, gap) }
    }
  }
  return out
}

// ---- assembly ---------------------------------------------------------------------------------

/** The multi-track scratch: one synth track per layer, base fields only. Emitted as TEXT and
 * parse-validated (same discipline as keymapScratchText / surgeSampleHostText) so a layer stack that
 * does not survive the format fails here, not at render time; the per-layer patch and production
 * are applied to the parsed doc afterwards through the ordinary typed edits. */
export function layeredScratchText(arch: LayeredArchitecture, bpm: number): string {
  const lines = [
    'format_version 0.11',
    `bpm ${Math.round(bpm)}`,
    'loop_bars 4',
    `selected_track ${arch.layers[0]!.id}`,
    '',
  ]
  for (const layer of arch.layers) {
    lines.push(
      `track ${layer.id} ${layer.label} ${layer.color} synth`,
      '  synth',
      `    osc ${String(layer.patch.osc ?? 'sawtooth')}`,
      `    volume ${layer.gainDb}`,
      `    cutoff ${layer.band.cutoffHz}`,
      `    resonance ${layer.band.resonance ?? 0}`,
      '    attack 0.01',
      '    decay 0.2',
      '    sustain 0.6',
      '    release 0.2',
      '    pan 0',
      '',
    )
  }
  return lines.join('\n')
}

export interface LayeredClip {
  doc: BeatDocument
  arch: LayeredArchitecture
  /** whole-semitone shift applied to every layer to hit the architecture's anchor window. */
  baseShift: number
  /** per-layer note counts and MIDI span — the honest receipt of what was assembled. */
  layers: { id: string; notes: number; loMidi: number; hiMidi: number; gainDb: number; band: string; mono: boolean }[]
  /** the production moves that actually landed, per layer (empty for the plain `layered` arm). */
  applied: string[]
}

export interface BuildLayeredOptions {
  /** apply the per-layer production pass — the `layeredplus` arm. Default false = `layered`. */
  produced?: boolean
}

/** Assemble one layered clip: a multi-track `.beat` where the tracks TOGETHER are one instrument.
 * Every layer plays the same figure at its own register with its own patch, its own crossover slot
 * and its own level; `produced` additionally runs each layer's own production profile. */
export function buildLayeredClip(role: string, phrase: ComposedPhrase, bpm: number, opts: BuildLayeredOptions = {}): LayeredClip {
  const arch = layeredArchitecture(role)
  const cross = checkCrossover(arch)
  if (!cross.ok) throw new BeatBatchError(`the ${role} layered architecture is not a valid crossover: ${cross.problems.join('; ')}`)
  if (phrase.notes.length === 0) throw new BeatBatchError('a layered clip needs at least one note')
  const baseShift = anchorShift(phrase, arch.anchor)

  let doc = parse(layeredScratchText(arch, bpm))
  const receipts: LayeredClip['layers'] = []
  const applied: string[] = []

  for (const layer of arch.layers) {
    const notes = layerNotes(phrase, layer.figure, baseShift)
    if (notes.length === 0) throw new BeatBatchError(`layer "${layer.id}" derived no notes from the figure`)
    doc = {
      ...doc,
      tracks: doc.tracks.map((t) => {
        if (t.id !== layer.id || t.kind !== 'synth') return t
        return {
          ...t,
          notes: notes.map((n, i) => ({ id: `l${i + 1}`, pitch: n.pitch, start: n.start, duration: n.duration, velocity: n.velocity, ...NOTE_FIELD_DEFAULTS })),
          synth: {
            ...t.synth,
            ...layer.patch,
            volume: layer.gainDb,
            cutoff: layer.band.cutoffHz,
            filterType: layer.band.mode,
            resonance: layer.band.resonance ?? 0,
          },
        }
      }),
    }
    receipts.push({
      id: layer.id,
      notes: notes.length,
      loMidi: Math.min(...notes.map((n) => n.pitch)),
      hiMidi: Math.max(...notes.map((n) => n.pitch)),
      gainDb: layer.gainDb,
      band: `${layer.band.mode} ${layer.band.cutoffHz} Hz`,
      mono: layer.mono,
    })
  }

  if (opts.produced === true) {
    for (const layer of arch.layers) {
      if (!layer.production) continue
      const result = applyLayerProduction(doc, layer)
      doc = result.doc
      for (const a of result.applied) applied.push(`${layer.id}: ${a}`)
    }
  }

  const violations = monoViolations(doc, arch)
  if (violations.length > 0) throw new BeatBatchError(`layered ${role} broke mono discipline: ${violations.join('; ')}`)
  return { doc, arch, baseShift, layers: receipts, applied }
}

/** One layer's production: the shared `applyProducedDefaults` primitive for width / glue / space /
 * air / motion, then the parallel compressor the shared ProductionProfile type does not model.
 * Intensify-only in both halves, exactly like the primitive. */
export function applyLayerProduction(doc: BeatDocument, layer: LayerSpec): ProducedResult {
  if (!layer.production) return { doc, applied: [] }
  const base = applyProducedDefaults(doc, layer.id, layer.production.profile)
  let out = base.doc
  const applied = [...base.applied]
  const comp = layer.production.comp
  if (comp) {
    const track = out.tracks.find((t) => t.id === layer.id)
    if (!track || track.kind !== 'synth') throw new BeatBatchError(`no synth layer "${layer.id}" to compress`)
    if (track.synth.compMix < comp.mix) {
      const synth: BeatSynth = {
        ...track.synth,
        compThreshold: Math.min(track.synth.compThreshold, comp.threshold),
        compRatio: Math.max(track.synth.compRatio, comp.ratio),
        compAttack: Math.min(track.synth.compAttack, comp.attack),
        compRelease: comp.release,
        compMix: Math.max(track.synth.compMix, comp.mix),
      }
      out = { ...out, tracks: out.tracks.map((t) => (t.id === layer.id ? { ...t, synth } : t)) }
      const withComp = out.tracks.find((t) => t.id === layer.id)!
      if (!withComp.effects.some((e) => e.type === 'comp' && e.enabled)) out = addEffect(out, layer.id, 'comp').doc
      applied.push(`parallel comp ${comp.ratio}:1 @ ${comp.threshold} dB, mix ${comp.mix}`)
    }
  }
  return { doc: out, applied }
}

// ---- target verification ----------------------------------------------------------------------
// The measured per-role rows this source exists to hit, and the check that says whether the RENDER
// hit them. Everything here reads the EXISTING metrics (src/metrics/analyze.ts's MixMetrics, the
// same `analyze()` every other dotbeat surface uses) — no new DSP, no new feature pipeline. Which
// also fixes the honest limit of this gate: the log's 42-feature gap analysis leans on per-band
// crest, attack-time statistics and spectral flux, and NONE of those are computable from MixMetrics
// today, so they are reported as `unmeasurable` rather than silently dropped.

export interface TargetRange {
  min?: number
  max?: number
  /** the measured row this range comes from — printed with every pass/fail line. */
  source: string
}

export type LayeredFeatureKey =
  | 'bandSubPct'
  | 'bandBassPct'
  | 'bandMidsPct'
  | 'bandPresencePct'
  | 'bandAirPct'
  | 'centroidHz'
  | 'stereoWidthDb'
  | 'stereoCorrelation'
  | 'crestDb'
  | 'truePeakDb'

/** Feature targets per role, straight off the measured rows. Cited inline so a future
 * recomputation can replace a number without archaeology (138's own rule: prefer the
 * recomputation). */
export const LAYERED_TARGETS: Record<LayeredRole, Partial<Record<LayeredFeatureKey, TargetRange>>> = {
  bassline: {
    bandSubPct: { min: 30, source: '131 P1 — packs-ref median 60.1%, p25 ~37%; engineplus 0.22%' },
    centroidHz: { max: 90, source: '131 P1 — ref bass centroid ~74 Hz; engineplus ~162 Hz' },
    stereoWidthDb: { max: -40, source: '131 §5 / 138 row 5 — elite ref bass -43..-51 dB; engineplus -11.8' },
    stereoCorrelation: { min: 0.98, source: '138 row 5 — bass mono discipline' },
  },
  chords: {
    bandBassPct: { min: 18, max: 40, source: '138 row 3 — chords bass-band body 18-28% (ref 9.5-24%); engineplus ~0' },
    bandMidsPct: { max: 90, source: '133 §1 / 131 §6 — engineplus chords 99.35% mids vs packs 78.4%' },
    crestDb: { min: 13, max: 18, source: '131 P2 / 138 rung 2 — chords/lead crest 14-17 dB (band widened to 13-18 for render variance)' },
    stereoWidthDb: { min: -9, max: -2, source: '131 P5 — packs chords width ~-5 dB (role-true map: -3..-8)' },
  },
  lead: {
    bandBassPct: { min: 5, max: 20, source: '138 row 3 — lead bass-band body 5-12% (upper bound loosened: the body layer also lifts 60-250 Hz harmonics)' },
    bandMidsPct: { max: 90, source: '133 §1 / 131 §6 — engineplus lead 99.19% mids vs packs 81.2%' },
    crestDb: { min: 13, max: 18, source: '131 P2 — crest 15-18 dB on melodic roles' },
    stereoWidthDb: { min: -9, max: -3, source: '131 §5 — elite ref lead -4.6 dB; engineplus -10.7' },
  },
}

/** Targets named in 131/133/138 that this gate CANNOT check, because the metric does not exist in
 * `MixMetrics` and inventing one here would fork the feature pipeline. Reported by name so a run's
 * output is honest about its own blind spots (they are exactly research 138's B0 critic upgrade). */
export const UNMEASURABLE_TARGETS: { name: string; target: string; why: string }[] = [
  { name: 'crest_subDb', target: 'bass <= ~11 dB (131 P1; engineplus 24.3)', why: 'per-band crest is not in MixMetrics' },
  { name: 'attackMedMs', target: '<=12 ms chords / <=8 ms lead (131 P2)', why: 'onset attack-time extraction is not in MixMetrics' },
  { name: 'fluxMean', target: '>=0.17 (131 P3)', why: 'spectral flux is not in MixMetrics' },
  { name: 'onsetRatePerSec', target: '>=4/s on chords (131 P3)', why: 'onset detection is not in MixMetrics' },
  { name: 'flatnessHiDb', target: '-16..-8 dB (131 P4)', why: 'spectral flatness is not in MixMetrics' },
]

export type LayeredFeatures = Record<LayeredFeatureKey, number>

/** The layered gate's feature view of a render — `metricsToFeatures` (the existing 13-feature
 * vector) plus centroid in Hz rather than log2, which is what every target row is quoted in. */
export function layeredFeatures(metrics: MixMetrics): LayeredFeatures {
  const f = metricsToFeatures(metrics)
  return {
    bandSubPct: f.bandSubPct,
    bandBassPct: f.bandBassPct,
    bandMidsPct: f.bandMidsPct,
    bandPresencePct: f.bandPresencePct,
    bandAirPct: f.bandAirPct,
    centroidHz: Math.pow(2, f.centroidLog2),
    stereoWidthDb: f.stereoWidthDb,
    stereoCorrelation: f.stereoCorrelation,
    crestDb: f.crestDb,
    truePeakDb: f.truePeakDb,
  }
}

export interface TargetResult {
  feature: LayeredFeatureKey
  value: number
  min?: number
  max?: number
  pass: boolean
  source: string
}

export interface TargetVerification {
  role: LayeredRole
  results: TargetResult[]
  passed: number
  total: number
  ok: boolean
  unmeasurable: typeof UNMEASURABLE_TARGETS
}

/** Verify a rendered layered clip against its role's measured targets. Reports pass/fail per
 * feature — never a single score — because 131 §5's whole finding is that the distance is many
 * medium axes with role-specific signs, so an aggregate would hide exactly the information the arm
 * exists to produce. */
export function verifyLayeredTargets(role: string, features: LayeredFeatures): TargetVerification {
  if (!isLayeredRole(role)) throw new BeatBatchError(`no layered targets for role "${role}" (have: ${LAYERED_ROLES.join(', ')})`)
  const targets = LAYERED_TARGETS[role]
  const results: TargetResult[] = []
  for (const key of Object.keys(targets) as LayeredFeatureKey[]) {
    const t = targets[key]!
    const value = features[key]
    const pass = (t.min === undefined || value >= t.min) && (t.max === undefined || value <= t.max)
    results.push({ feature: key, value, ...(t.min !== undefined ? { min: t.min } : {}), ...(t.max !== undefined ? { max: t.max } : {}), pass, source: t.source })
  }
  const passed = results.filter((r) => r.pass).length
  return { role, results, passed, total: results.length, ok: passed === results.length, unmeasurable: UNMEASURABLE_TARGETS }
}

const fmt = (x: number) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)) : String(x))

/** Human-facing pass/fail table for one verification. */
export function formatTargetVerification(v: TargetVerification, label: string): string {
  let out = `${label} — ${v.role} targets: ${v.passed}/${v.total} pass\n`
  for (const r of v.results) {
    const range = r.min !== undefined && r.max !== undefined ? `${r.min}..${r.max}` : r.min !== undefined ? `>= ${r.min}` : `<= ${r.max}`
    out += `  ${r.pass ? 'PASS' : 'FAIL'}  ${r.feature.padEnd(18)} ${fmt(r.value).padStart(9)}  target ${range}   [${r.source}]\n`
  }
  for (const u of v.unmeasurable) out += `  n/a   ${u.name.padEnd(18)} ${'—'.padStart(9)}  target ${u.target} — ${u.why}\n`
  return out
}
