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
// by two to four voices placed deliberately, which is what this module assembles.
//
// WHAT THE OWNER'S EAR CHANGED (2026-07-26). The first version of this module shipped three FROZEN
// architectures gated by ONE-SIDED thresholds, scored 19 of 24 measured targets against engineplus's
// 3 — the largest measured jump in the program — and the owner listened and said: "the bassline
// layering doesn't sound great from my POV... I liked the unlayered one better", plus "all the
// layering... makes everything sort of sound the same-ish." Both halves were right, and both are
// diagnosable with numbers the gate did not have:
//   * OVERSHOOT. A floor of `bandSubPct >= 30` cannot fail 96.1%, and the reference class's own
//     median is 50.1%. Worse, the floor CAUSED the sound: this file used to resolve a real source
//     disagreement about bass balance with "our own measured target only reaches with the sub
//     carrying the stack." Every target is now the reference pool's INTERQUARTILE RANGE, two-sided,
//     reported against the pool median.
//   * INAUDIBLE LAYERS. Rendered per layer (scripts/layered-diagnose.mjs), the growl arrived 14 dB
//     under the mix and the click 49 dB under, at nominal offsets of -5 and -16 dB; sub-alone RMS
//     came within 0.05 dB of the whole instrument. Balance is now drawn against MEASURED
//     contribution, with the loudest character layer floored at the sub's own level.
//   * SAME-NESS. Three frozen architectures meant every layered clip in every round was the same
//     instrument. They are now seeded SWEEPS over the mined ranges — the same fix, one level up,
//     that src/taste/theory.ts made at the note layer.
//   * A MISSING SENSE. `MixMetrics` is whole-file and whole-band, so no gate could see note
//     boundaries or per-layer audibility at all. src/taste/articulation.ts adds both, and
//     `layeredFeatures` now REQUIRES the audio so they cannot be skipped.
// The case is banked at listen-bench/cases/2026-07-26-layered-bass-preferred-unlayered.json.
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
import { mulberry32 } from '../core/rng.js'
import type { ComposedNote, ComposedPhrase } from './phrase.js'
import type { MixMetrics } from '../metrics/index.js'
import { metricsToBaseFeatures } from '../metrics/features.js'
import { articulationFeatures } from './articulation.js'

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
  /** the seeded choices this architecture was drawn from — carried so a rated clip's manifest can
   * name its exact variant and so the diversity guard has something to count. */
  draw: ArchitectureDraw
}

// ---- the seeded architecture sweep -------------------------------------------------------------
//
// WHY THIS IS A SWEEP AND NOT THREE CONSTANTS (owner ear report, 2026-07-26):
//   "One thing I noticed with all the layering... is it makes everything sort of sound the same-ish.
//    Something to watch out for."
// The first version of this module shipped exactly three frozen `LayeredArchitecture` objects, so
// every layered bassline in a round was the same three voices at the same three cutoffs at the same
// three levels, differing only in which notes the composer drew. That is the identical failure the
// note layer had before src/taste/theory.ts replaced its uniform draws with seeded variation INSIDE
// each archetype, and it is fixed the same way here: an architecture is now DRAWN, seeded, from a
// sweep space whose bounds are the mined ranges in docs/priors/layering.md and docs/priors/bass-*.md
// and the patch-file distributions in presets/role-parameter-stats.json (research 141).
//
// The axes that vary, all named by the mined corpus as legitimately variable:
//   LAYER COUNT + SET  2, 3 and 4 are all attested ("2 to 3 kicks", "3-4 layer sub/mid/high/top",
//                      the corpus's own strongest rule being "only layer when there is a good
//                      reason" — so a 2-layer stack is a first-class draw, not a degraded one).
//   CROSSOVER          the sub/mid crossover is a BAND in the sources, not a number: 75, 79 and
//                      90-100 Hz from three independent figures.
//   BALANCE            the one axis the sources openly disagree on (MusicRadar's worked example
//                      puts the sub hotter; the bass-house vein's Recipe 2 puts the sub 9 dB UNDER
//                      the mid layer). A sweep is the honest encoding of a real disagreement.
//   REGISTER           sub proper is 20-60 Hz (theghostproduction), 30-100 Hz (Subaqueous) — an
//                      octave of legitimate placement.
//   ENVELOPE           presets/role-parameter-stats.json, bass role, n=494: sustain p10 0.00 /
//                      p25 0.33 / median 1.00, decay p10 186 ms / p25 250 / median 621, release
//                      p25 31 ms / median 39. A range, not a value.
//   CHARACTER          osc pair and detune: unison detune p25 4.6 / median 10.0 / p75 20.0 cents.
//
// WHAT THE SWEEP FIXED, measured (scripts/layered-diagnose.mjs, 2026-07-26). The frozen bass stack
// nominally balanced sub -4 / growl -9 / click -20 dB. Rendered and measured per layer, the growl
// arrived 12.7-14.1 dB under the full mix and the click 46.8-49.1 dB under, and sub-alone RMS was
// within 0.15 dB of the whole stack: the "three-layer bass" was measurably a ONE-layer sine sub,
// which is both why every clip sounded alike and why the owner preferred the unlayered one. Balance
// is therefore drawn RELATIVE TO THE SUB across a range calibrated against the measured contribution
// of each voice, not against its nominal fader value.

/** One seeded architecture draw, carried on the architecture so a rated clip's manifest records the
 * exact variant and the diversity guard has something to count. */
export interface ArchitectureDraw {
  /** the layer SET drawn — the coarsest axis, and the one the owner's "sound the same-ish" is about. */
  family: string
  /** every seeded choice by name, for the fingerprint and the receipt. */
  choices: Record<string, number | string | boolean>
}

/** Seeded pick of one item (exactly one rng draw), the same helper shape theory.ts uses. */
const pickOne = <T>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)]!

/** Seeded weighted pick over `[item, weight]` pairs (exactly one rng draw). */
function pickWeighted<T>(rng: () => number, entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0)
  let r = rng() * total
  for (const [item, w] of entries) {
    r -= w
    if (r <= 0) return item
  }
  return entries[entries.length - 1]![0]
}

/** Seeded value in `[lo, hi]`, rounded to `step` (exactly one rng draw). Rounding keeps the drawn
 * numbers readable in a summary line and keeps the fingerprint from being noise. */
const pickRange = (rng: () => number, lo: number, hi: number, step: number): number =>
  Math.round((lo + rng() * (hi - lo)) / step) * step

const rnd3 = (x: number): number => Math.round(x * 1000) / 1000

const MONO_PATCH: Partial<BeatSynth> = { pan: 0, unisonVoices: 1, unisonWidth: 0, chorusMode: 'off', chorusMix: 0, utilityWidth: 0.5, autoPanMix: 0, sendReverb: 0, sendDelay: 0 }

// ---- bassline ----------------------------------------------------------------------------------
//
// SUB — sine or triangle (corroborated: the sub is always a sine or triangle, never harmonically
// rich), ROOT NOTES ONLY, monophonic, dead mono, lowpassed inside the mined 75-100 Hz crossover
// band. Its amp envelope is the single biggest change from the frozen version: sustain 0.95 with
// legato note-filling made the sub one continuous tone whose only variation was pitch, which is
// what collapsed articulation to 6.6-8.7 dB against a refs-packs bassline median of 20.3. The
// mined bass-house vein is unambiguous and was being contradicted: "short/near-zero sustain,
// moderate-to-short decay and release on the amp envelope is universal across every recipe that
// specifies envelope shape at all... nobody uses a long sustain for this bass family; it's
// consistently 'pluck', not 'held tone'."
// BODY — the corpus's 100-500 Hz "power/warmth" layer, the one that "keeps the sound from going
// hollow on small speakers". Optional.
// GROWL — the 500-2000 Hz character layer, "the main characteristics of the stack", a harmonically
// richer waveform driven harder. Optional, but a stack always carries at least one of body/growl.
// CLICK — the 1-5 kHz definition layer, the part that reads on earbuds. Optional.
//
// NOT REACHABLE, stated: the 808 vein's signature 24-semitone pitch dive over 40-60 ms at note-on.
// dotbeat has no pitch envelope; the click layer substitutes for it.

/** Which optional layers each bass family carries. Weighted so 3-layer stacks stay the norm and the
 * 2- and 4-layer ends both appear — the corpus's own rule is "remove a layer before adding one",
 * which makes a 2-layer stack a legitimate draw rather than a failure. */
const BASS_FAMILIES: readonly (readonly [{ name: string; optional: readonly ('body' | 'growl' | 'click')[] }, number])[] = [
  [{ name: 'sub+growl', optional: ['growl'] }, 3],
  [{ name: 'sub+body', optional: ['body'] }, 2],
  [{ name: 'sub+growl+click', optional: ['growl', 'click'] }, 4],
  [{ name: 'sub+body+growl', optional: ['body', 'growl'] }, 4],
  [{ name: 'sub+body+click', optional: ['body', 'click'] }, 2],
  [{ name: 'sub+body+growl+click', optional: ['body', 'growl', 'click'] }, 3],
]

/** The anchor window's low edge, in whole octaves of legitimate sub placement. 26 = D1 (36.7 Hz),
 * 33 = A1 (55 Hz) — inside the corpus's 20-60 / 30-100 Hz sub band at both ends. Always 12 wide, or
 * a median can fall in a gap no whole-octave shift can reach (caught by the 24-seed sweep in
 * test/layered.test.ts on 2026-07-26). */
const BASS_ANCHOR_LO = [26, 28, 31, 33] as const

function buildBasslineArch(rng: () => number): LayeredArchitecture {
  const family = pickWeighted(rng, BASS_FAMILIES)
  const anchorLo = pickOne(rng, BASS_ANCHOR_LO)
  // the mined 75-100 Hz sub/mid crossover, triangulated from three independent figures (75, 79, 90-100)
  const subLp = pickRange(rng, 75, 100, 5)
  const subOsc = pickOne(rng, ['sine', 'triangle'] as const)
  // presets/role-parameter-stats.json bass amp env: sustain p10 0.00 / p25 0.33 / median 1.00 —
  // capped at 0.85 because the whole point is that a bass is a pluck, not a held tone
  const subSustain = pickOne(rng, [0, 0.1, 0.25, 0.45, 0.7] as const)
  const subDecay = pickOne(rng, [0.12, 0.19, 0.25, 0.4, 0.62] as const)
  const subRelease = pickOne(rng, [0.03, 0.05, 0.09, 0.14] as const)
  const subGlide = pickOne(rng, [0, 0.01, 0.02, 0.03] as const)
  // a GATED sub leaves real silence between notes; a legato one fills to the next onset. Both are
  // attested (the "rolling" bass is legato, the plucked house bass is gated) and they sound
  // completely different, so this is one of the strongest same-ness axes available.
  const subGate = pickOne(rng, [0, 2, 2, 3, 4] as const)
  const subLevel = pickRange(rng, 0.1, 0.45, 0.05)

  // BALANCE, drawn relative to the sub. The sources disagree in DIRECTION (MusicRadar: sub hotter;
  // bass-house Recipe 2: sub 9 dB under the mid layer), so the sweep spans both readings. The
  // absolute numbers are calibrated against measured per-layer contribution, not fader values:
  // at the frozen -5 dB nominal offset the growl arrived 14 dB under the mix.
  const subGain = pickRange(rng, -13, -8, 1)

  const hasBody = family.optional.includes('body')
  const hasGrowl = family.optional.includes('growl')
  const hasClick = family.optional.includes('click')

  // THE FLOOR THAT KEEPS THE STACK A STACK. Every character layer is drawn relative to the sub, and
  // the loudest present one is then lifted to at least the sub's own level. The whole draw shifts
  // together, so the balance BETWEEN character layers is whatever was drawn — only the stack's
  // relationship to its sub is constrained. Without this a legitimate-looking draw (every relative
  // level negative) reproduces the 2026-07-26 failure exactly: measured per layer, the frozen stack
  // put its growl 14 dB under the mix at a nominal -5 dB offset, and sub-alone RMS came within
  // 0.15 dB of the whole instrument. Nominal fader values are not contributions.
  const drawnRels = { body: pickRange(rng, -1, 5, 1), growl: pickRange(rng, -3, 4, 1), click: pickRange(rng, -2, 6, 1) }
  const presentRels = [...(hasBody ? [drawnRels.body] : []), ...(hasGrowl ? [drawnRels.growl] : []), ...(hasClick ? [drawnRels.click] : [])]
  const lift = Math.max(0, -Math.max(...presentRels))
  const bodyRel = drawnRels.body + lift
  const growlRel = drawnRels.growl + lift
  const clickRel = drawnRels.click + lift

  // the lowest highpassed layer must meet the sub's lowpass within an octave (checkCrossover rule 3)
  const lowestHp = pickRange(rng, subLp * 0.8, subLp * 1.0, 5)
  // when a body layer is present it takes the low slot and the growl moves up into its own band
  const growlHp = hasBody ? pickRange(rng, 140, 320, 20) : lowestHp
  const bodyHp = lowestHp
  const clickHp = pickRange(rng, 1100, 2200, 100)

  // a saw growl is the corpus's default, but its harmonic tail is what drags the stack's centroid
  // far above the reference pool's 76 Hz median, so the darker waveforms carry real weight here
  const growlOsc = pickOne(rng, ['sawtooth', 'square', 'triangle', 'square'] as const)
  // -1200 is the octave-down BODY move; the cents values are the patch corpus's unison detune
  // distribution (p25 4.6 / median 10.0 / p75 20.0)
  const growlOsc2Detune = pickOne(rng, [-1200, -1200, 5, 10, 20] as const)
  const growlOsc2Level = pickRange(rng, 0.15, 0.35, 0.05)
  const growlSustain = pickOne(rng, [0.2, 0.35, 0.5, 0.62] as const)
  // the reference class has almost no bass energy above 250 Hz (refs-packs bassline bandMidsPct
  // median 0.22%, bandPresencePct p90 0.98%), so a saw growl gets its harmonics tamed rather than
  // celebrated — otherwise the stack's centroid lands 3-5x above the pool median of 76 Hz
  const growlEqHigh = pickRange(rng, -9, -3, 1)
  const bodyOsc = pickOne(rng, ['triangle', 'sawtooth'] as const)
  const clickNoise = pickRange(rng, 0.05, 0.3, 0.05)

  const layers: LayerSpec[] = [
    {
      id: 'sub',
      label: 'Sub',
      color: '#e06c75',
      figure: { transpose: 0, pick: 'lowest', monophonic: true, ...(subGate > 0 ? { maxDurationSteps: subGate } : {}) },
      band: { mode: 'lowpass', cutoffHz: subLp, resonance: 0 },
      gainDb: subGain,
      mono: true,
      patch: {
        ...MONO_PATCH,
        osc: subOsc as OscType,
        subLevel,
        attack: 0.006,
        decay: subDecay,
        sustain: subSustain,
        release: subRelease,
        glide: subGlide,
      },
      production: {
        profile: { role: 'sub', saturator: { drive: 0.2, mix: 0.25 } },
        comp: { threshold: -30, ratio: 6, attack: 0.015, release: 0.12, mix: 0.2 },
      },
    },
  ]

  if (hasBody) {
    layers.push({
      id: 'body',
      label: 'Body',
      color: '#98c379',
      figure: { transpose: 12, pick: 'lowest', monophonic: true, velocityScale: 0.95 },
      band: { mode: 'highpass', cutoffHz: bodyHp, resonance: 0.05 },
      gainDb: subGain + bodyRel,
      mono: true,
      patch: {
        ...MONO_PATCH,
        osc: bodyOsc as OscType,
        osc2Type: 'sine' as OscType,
        osc2Level: 0.25,
        osc2Detune: -1200,
        attack: 0.005,
        decay: rnd3(subDecay * 1.2),
        sustain: rnd3(Math.min(0.7, subSustain + 0.15)),
        release: 0.1,
      },
      production: {
        profile: { role: 'bass', saturator: { drive: 0.3, mix: 0.35 } },
        comp: { threshold: -28, ratio: 6, attack: 0.015, release: 0.12, mix: 0.2 },
      },
    })
  }

  if (hasGrowl) {
    layers.push({
      id: 'growl',
      label: 'Growl',
      color: '#d19a66',
      figure: { transpose: 12, pick: 'all', monophonic: true, velocityScale: 0.95 },
      band: { mode: 'highpass', cutoffHz: growlHp, resonance: 0.1 },
      gainDb: subGain + growlRel,
      mono: true,
      patch: {
        ...MONO_PATCH,
        osc: growlOsc as OscType,
        osc2Type: 'square' as OscType,
        osc2Level: growlOsc2Level,
        osc2Detune: growlOsc2Detune,
        attack: 0.004,
        decay: 0.2,
        sustain: growlSustain,
        release: 0.1,
        eqHigh: growlEqHigh,
      },
      production: {
        profile: { role: 'bass', saturator: { drive: 0.4, mix: 0.45 } },
        comp: { threshold: -28, ratio: 8, attack: 0.015, release: 0.12, mix: 0.2 },
      },
    })
  }

  if (hasClick) {
    layers.push({
      id: 'click',
      label: 'Click',
      color: '#e5c07b',
      figure: { transpose: 24, pick: 'lowest', maxDurationSteps: 1, velocityScale: 0.8 },
      band: { mode: 'highpass', cutoffHz: clickHp, resonance: 0.25 },
      gainDb: subGain + clickRel,
      mono: true,
      patch: {
        ...MONO_PATCH,
        osc: 'square' as OscType,
        noiseLevel: clickNoise,
        attack: 0.001, // 138 row 7: attacks <= 8-12 ms; a click layer is where a bass gets one
        decay: 0.05,
        sustain: 0,
        release: 0.03,
      },
      production: {
        // 5-10 ms on a transient layer (transients vein) — the one place a fast comp attack is
        // right, because the layer IS the transient; everywhere else 10-30 ms preserves punch.
        profile: { role: 'perc', eqHigh: 2 },
        comp: { threshold: -26, ratio: 6, attack: 0.008, release: 0.08, mix: 0.25 },
      },
    })
  }

  const summary =
    `${subOsc} sub (anchor ${anchorLo}, lowpass ${subLp}, sus ${subSustain}${subGate > 0 ? `, gate ${subGate}` : ', legato'}) @${subGain} dB` +
    layers.slice(1).map((l) => ` + ${l.id} (${l.band.mode} ${l.band.cutoffHz}) @${l.gainDb} dB`).join('')

  return {
    role: 'bassline',
    summary,
    anchor: { loMidi: anchorLo, hiMidi: anchorLo + 12 },
    layers,
    draw: {
      family: family.name,
      choices: { anchorLo, subLp, subOsc, subSustain, subDecay, subRelease, subGlide, subGate, subLevel, subGain, bodyRel, growlRel, clickRel, lowestHp, growlHp, clickHp, growlOsc, growlOsc2Detune, growlOsc2Level, growlSustain, growlEqHigh, bodyOsc, clickNoise },
    },
  }
}

// ---- chords ------------------------------------------------------------------------------------
//
// 131 §6 measured engineplus chords at 99.35% mids occupancy against packs' 78.4% (with 9.5% real
// bass-band body); 138 row 3's target is 18-28% bass-band. The BODY layer is that number: root notes
// only, an octave under the voicing, lowpassed, mono, with the osc2 -1200 body move. It is the one
// mandatory layer besides a voice, because the crossover ladder needs exactly one mono lowpassed
// bottom. The PAD is the sustained wide voice; the STAB is the same voicing clamped short with a
// fast attack (packs chords fire 4.9 onsets/s and attack in ~7 ms; engineplus 2.3 onsets/s in ~31
// ms); the AIR layer is a noise-heavy top, the 2-8 kHz presence texture no dotbeat oscillator has
// ever supplied.
//
// ROOTLESS STAB. The stab plays a `dropRoot` voicing — the chord minus its bottom note — and the
// BODY layer carries the root instead. Two independent practitioner sources name omitting the root
// from the chord stab as the load-bearing move for this sound.
//
// HONEST GAP, per the mined corpus: chords/pads is the ONE role with no canonical numeric
// pad+pluck+air recipe in the literature — the pattern (focus layer + support layer, stereo
// placement rather than frequency ownership as the primary differentiator) is well attested, the
// numbers are not. The sweep bounds below are therefore extrapolated from the measured dotbeat/pack
// rows, not quoted from a source, and should be read as this arm's hypothesis. The one genuinely
// chord-SPECIFIC technique the corpus does name — interval layering, tuning osc2 to a perfect fifth
// so a triad reads as a ninth — stays out: nothing in the feature set can verify a harmonic change,
// so it would be an unmeasurable variable riding inside a measured arm.

const CHORD_FAMILIES: readonly (readonly [{ name: string; optional: readonly ('pad' | 'stab' | 'air')[] }, number])[] = [
  [{ name: 'body+pad', optional: ['pad'] }, 2],
  [{ name: 'body+stab', optional: ['stab'] }, 2],
  [{ name: 'body+pad+stab', optional: ['pad', 'stab'] }, 4],
  [{ name: 'body+stab+air', optional: ['stab', 'air'] }, 3],
  [{ name: 'body+pad+air', optional: ['pad', 'air'] }, 3],
  [{ name: 'body+pad+stab+air', optional: ['pad', 'stab', 'air'] }, 3],
]

const CHORD_ANCHOR_LO = [55, 57, 59, 62] as const

function buildChordsArch(rng: () => number): LayeredArchitecture {
  const family = pickWeighted(rng, CHORD_FAMILIES)
  const anchorLo = pickOne(rng, CHORD_ANCHOR_LO)
  const bodyLp = pickRange(rng, 300, 460, 20)
  const lowestHp = pickRange(rng, bodyLp * 0.65, bodyLp * 0.95, 10)
  const bodyGain = pickRange(rng, -17, -12, 1)
  const padRel = pickRange(rng, 1, 6, 1)
  const stabRel = pickRange(rng, 2, 7, 1)
  const airRel = pickRange(rng, -20, -12, 1)
  const bodyOsc = pickOne(rng, ['triangle', 'sine', 'sawtooth'] as const)
  // detune is the most CONTESTED number in the mined corpus (sub-4 cents = "warmth" in deep house,
  // the same amount called a defect in string pads, ~7.5 for trance aggression, "+/-7 to +/-61 all
  // called classic" in the bass vein). Treated as a style dial swept across its attested span.
  const padDetune = pickRange(rng, 3, 14, 1)
  const padVoices = pickOne(rng, [3, 4, 5, 6] as const)
  const padWidth = pickRange(rng, 0.55, 0.95, 0.05)
  const padAttack = pickOne(rng, [0.03, 0.06, 0.12, 0.2] as const)
  const padPan = pickRange(rng, -0.8, -0.3, 0.1)
  const stabSteps = pickOne(rng, [1, 2, 3] as const)
  const stabHp = pickRange(rng, 260, 420, 20)
  const stabOsc = pickOne(rng, ['square', 'sawtooth'] as const)
  const stabPick = pickOne(rng, ['dropRoot', 'dropRoot', 'all'] as const)
  const airHp = pickRange(rng, 2000, 3500, 250)
  const airNoise = pickRange(rng, 0.3, 0.65, 0.05)

  const hasPad = family.optional.includes('pad')
  const hasStab = family.optional.includes('stab')
  const hasAir = family.optional.includes('air')
  // the LOWEST highpass must meet the body's lowpass within an octave; whichever voice sits lowest
  // takes that slot
  const padHp = hasPad ? lowestHp : stabHp
  const firstStabHp = hasPad ? stabHp : lowestHp

  const layers: LayerSpec[] = [
    {
      id: 'body',
      label: 'Body',
      color: '#98c379',
      figure: { transpose: -12, pick: 'lowest', monophonic: true },
      band: { mode: 'lowpass', cutoffHz: bodyLp, resonance: 0 },
      gainDb: bodyGain,
      mono: true,
      patch: {
        ...MONO_PATCH,
        osc: bodyOsc as OscType,
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
        // NO parallel comp on a sustained low layer: measured 2026-07-26, it pushed chords'
        // bass-band share from 38% (in target) to 62% (out), because compressing a sustained voice
        // raises its AVERAGE, which is the one thing the band-share targets read.
        profile: { role: 'bass', saturator: { drive: 0.25, mix: 0.3 } },
      },
    },
  ]

  if (hasPad) {
    layers.push({
      id: 'pad',
      label: 'Pad',
      color: '#61afef',
      figure: { transpose: 0, pick: 'all' },
      band: { mode: 'highpass', cutoffHz: padHp, resonance: 0.05 },
      gainDb: bodyGain + padRel,
      mono: false,
      patch: {
        osc: 'sawtooth' as OscType,
        osc2Type: 'sawtooth' as OscType,
        osc2Level: 0.35,
        osc2Detune: padDetune,
        unisonVoices: padVoices,
        unisonWidth: padWidth,
        attack: padAttack,
        decay: 0.6,
        sustain: 0.85,
        release: 0.6,
        pan: padPan,
      },
      production: {
        profile: { role: 'pad', chorusMix: 0.45, saturator: { drive: 0.2, mix: 0.28 }, sendReverb: 0.3, sendDelay: 0.08, eqHigh: 2.5 },
        comp: { threshold: -28, ratio: 6, attack: 0.02, release: 0.2, mix: 0.25 },
      },
    })
  }

  if (hasStab) {
    layers.push({
      id: 'stab',
      label: 'Stab',
      color: '#c678dd',
      figure: { transpose: 0, pick: stabPick, maxDurationSteps: stabSteps, velocityScale: 0.95 },
      band: { mode: 'highpass', cutoffHz: firstStabHp, resonance: 0.15 },
      gainDb: bodyGain + stabRel,
      mono: false,
      patch: {
        osc: stabOsc as OscType,
        osc2Type: 'sawtooth' as OscType,
        osc2Level: 0.3,
        osc2Detune: 12,
        attack: 0.002,
        decay: 0.16,
        sustain: 0.05,
        release: 0.12,
        pan: -padPan,
      },
      production: {
        profile: { role: 'chords', chorusMix: 0.3, saturator: { drive: 0.25, mix: 0.3 }, sendReverb: 0.14, sendDelay: 0.12, eqHigh: 3 },
        comp: { threshold: -28, ratio: 8, attack: 0.012, release: 0.1, mix: 0.35 },
      },
    })
  }

  if (hasAir) {
    layers.push({
      id: 'air',
      label: 'Air',
      color: '#56b6c2',
      figure: { transpose: 12, pick: 'highest', maxDurationSteps: 3, velocityScale: 0.7 },
      band: { mode: 'highpass', cutoffHz: airHp, resonance: 0.1 },
      gainDb: bodyGain + airRel,
      mono: false,
      patch: {
        osc: 'triangle' as OscType,
        noiseLevel: airNoise,
        attack: 0.004,
        decay: 0.25,
        sustain: 0.15,
        release: 0.3,
        unisonVoices: 3,
        unisonWidth: 0.9,
        pan: 0,
      },
      production: {
        profile: { role: 'hats', utilityWidth: 0.7, sendReverb: 0.4, eqHigh: 5, autoPan: { rate: 0.12, depth: 0.4, mix: 0.3 } },
      },
    })
  }

  const summary =
    `${bodyOsc} body root octave-down (anchor ${anchorLo}, lowpass ${bodyLp}) @${bodyGain} dB` +
    layers.slice(1).map((l) => ` + ${l.id} (${l.band.mode} ${l.band.cutoffHz}) @${l.gainDb} dB`).join('')

  return {
    role: 'chords',
    summary,
    anchor: { loMidi: anchorLo, hiMidi: anchorLo + 12 },
    layers,
    draw: {
      family: family.name,
      choices: { anchorLo, bodyLp, lowestHp, bodyGain, padRel, stabRel, airRel, bodyOsc, padDetune, padVoices, padWidth, padAttack, padPan, stabSteps, stabHp, stabOsc, stabPick, airHp, airNoise },
    },
  }
}

// ---- lead --------------------------------------------------------------------------------------
//
// 138 row 3 puts pack lead at 5-12% bass-band body against engineplus's 99.19% mids, and no amount
// of octave-up layering produces low end — so the BODY layer (roots two octaves down, mono,
// lowpassed) is mandatory and doubles as the crossover ladder's bottom. MAIN is the saw stack.
//
// The OCTAVE layer is the single most precisely quantified secondary layer in the whole mined
// corpus — MusicTech's numbers, corroborated by two further sources: drop to 3-5 voice unison with
// tighter detune, highpass around 500 Hz, sit 6-10 dB below the main layer. All three are swept
// inside their stated ranges rather than pinned at one point inside them.
//
// Panning is used sparingly and never as the primary separator: the corpus's flat warning is that
// club systems sum to mono, so pan-based separation is mix-only. Frequency ownership does the work.

const LEAD_FAMILIES: readonly (readonly [{ name: string; optional: readonly ('octave' | 'width' | 'air')[] }, number])[] = [
  [{ name: 'body+main', optional: [] }, 2],
  [{ name: 'body+main+octave', optional: ['octave'] }, 4],
  [{ name: 'body+main+width', optional: ['width'] }, 3],
  [{ name: 'body+main+air', optional: ['air'] }, 2],
  [{ name: 'body+main+octave+width', optional: ['octave', 'width'] }, 4],
  [{ name: 'body+main+octave+air', optional: ['octave', 'air'] }, 2],
]

const LEAD_ANCHOR_LO = [66, 69, 71, 74] as const

function buildLeadArch(rng: () => number): LayeredArchitecture {
  const family = pickWeighted(rng, LEAD_FAMILIES)
  const anchorLo = pickOne(rng, LEAD_ANCHOR_LO)
  const bodyLp = pickRange(rng, 320, 480, 20)
  const mainHp = pickRange(rng, bodyLp * 0.6, bodyLp * 0.95, 10)
  const bodyGain = pickRange(rng, -22, -16, 1)
  const mainRel = pickRange(rng, 6, 12, 1)
  // MusicTech, corroborated twice: the octave layer sits 6-10 dB under the main layer
  const octaveUnder = pickRange(rng, 6, 10, 1)
  const widthUnder = pickRange(rng, 1, 5, 1)
  const airUnder = pickRange(rng, 14, 22, 1)
  // FaderPro: 7-voice unison is the default and detune past ~50% of range turns dissonant;
  // Syntorial runs 9. The patch corpus's own detune distribution: p25 9.4 / median 16.6 / p75 24.2
  // cents at >= 5 voices.
  const mainVoices = pickOne(rng, [5, 6, 7, 9] as const)
  const mainDetune = pickRange(rng, 5, 20, 1)
  const mainWidth = pickRange(rng, 0.6, 0.95, 0.05)
  const mainAttack = pickOne(rng, [0.002, 0.003, 0.006, 0.01] as const)
  const mainOsc = pickOne(rng, ['sawtooth', 'sawtooth', 'square'] as const)
  // MusicTech: drop to 3-5 voices with tighter detune, highpass around 500 Hz
  const octaveVoices = pickOne(rng, [3, 4, 5] as const)
  const octaveHp = pickRange(rng, 420, 620, 20)
  const octaveOsc = pickOne(rng, ['triangle', 'sawtooth'] as const)
  const widthVoices = pickOne(rng, [6, 7, 9] as const)
  const widthDetune = pickRange(rng, 14, 30, 2)
  const widthHp = pickRange(rng, 350, 550, 25)
  const pan = pickRange(rng, 0.5, 0.85, 0.05)
  const airHp = pickRange(rng, 2500, 4500, 250)

  const hasOctave = family.optional.includes('octave')
  const hasWidth = family.optional.includes('width')
  const hasAir = family.optional.includes('air')

  const layers: LayerSpec[] = [
    {
      id: 'body',
      label: 'Body',
      color: '#98c379',
      figure: { transpose: -24, pick: 'lowest', monophonic: true },
      band: { mode: 'lowpass', cutoffHz: bodyLp, resonance: 0 },
      gainDb: bodyGain,
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
        // no parallel comp on the sustained low layer — see the chords body layer's note
        profile: { role: 'bass', saturator: { drive: 0.3, mix: 0.35 } },
      },
    },
    {
      id: 'main',
      label: 'Main',
      color: '#e06c75',
      figure: { transpose: 0, pick: 'all' },
      band: { mode: 'highpass', cutoffHz: mainHp, resonance: 0.2 },
      gainDb: bodyGain + mainRel,
      mono: false,
      patch: {
        osc: mainOsc as OscType,
        osc2Type: 'sawtooth' as OscType,
        osc2Level: 0.3,
        osc2Detune: mainDetune,
        unisonVoices: mainVoices,
        unisonWidth: mainWidth,
        attack: mainAttack, // 131 P2: pack leads attack in ~8 ms, engineplus in 26.6
        decay: 0.2,
        sustain: 0.55,
        release: 0.18,
        pan: 0,
      },
      production: {
        profile: { role: 'lead', chorusMix: 0.3, saturator: { drive: 0.28, mix: 0.35 }, sendReverb: 0.2, sendDelay: 0.14, eqHigh: 3.5 },
        comp: { threshold: -28, ratio: 8, attack: 0.012, release: 0.1, mix: 0.35 },
      },
    },
  ]

  if (hasOctave) {
    layers.push({
      id: 'octave',
      label: 'Octave',
      color: '#e5c07b',
      figure: { transpose: 12, pick: 'all', velocityScale: 0.8 },
      band: { mode: 'highpass', cutoffHz: octaveHp, resonance: 0.1 },
      gainDb: bodyGain + mainRel - octaveUnder,
      mono: false,
      patch: {
        osc: octaveOsc as OscType,
        osc2Type: 'sawtooth' as OscType,
        osc2Level: 0.2,
        osc2Detune: 4,
        unisonVoices: octaveVoices,
        unisonWidth: 0.45,
        attack: 0.004,
        decay: 0.18,
        sustain: 0.4,
        release: 0.15,
        pan,
      },
      production: {
        profile: { role: 'lead', sendReverb: 0.26, sendDelay: 0.16, eqHigh: 4 },
        comp: { threshold: -28, ratio: 6, attack: 0.015, release: 0.1, mix: 0.25 },
      },
    })
  }

  if (hasWidth) {
    layers.push({
      id: 'width',
      label: 'Width',
      color: '#c678dd',
      figure: { transpose: 0, pick: 'all', velocityScale: 0.85 },
      band: { mode: 'highpass', cutoffHz: widthHp, resonance: 0.05 },
      gainDb: bodyGain + mainRel - widthUnder,
      mono: false,
      patch: {
        osc: 'sawtooth' as OscType,
        osc2Type: 'sawtooth' as OscType,
        osc2Level: 0.45,
        osc2Detune: widthDetune,
        unisonVoices: widthVoices,
        unisonWidth: 0.95,
        attack: 0.012,
        decay: 0.3,
        sustain: 0.6,
        release: 0.3,
        pan: -pan,
      },
      production: {
        profile: { role: 'lead', chorusMix: 0.5, utilityWidth: 0.9, saturator: { drive: 0.2, mix: 0.25 }, sendReverb: 0.35, sendDelay: 0.1, autoPan: { rate: 0.1, depth: 0.35, mix: 0.25 }, eqHigh: 3 },
      },
    })
  }

  if (hasAir) {
    layers.push({
      id: 'air',
      label: 'Air',
      color: '#56b6c2',
      // Syntorial's recipe: white noise pitched up, high-passed to remove "frump" off the bottom,
      // mixed so it is "very audible, but blends" — explicitly not a subtle sheen.
      figure: { transpose: 12, pick: 'highest', velocityScale: 0.7 },
      band: { mode: 'highpass', cutoffHz: airHp, resonance: 0.1 },
      gainDb: bodyGain + mainRel - airUnder,
      mono: false,
      patch: {
        osc: 'triangle' as OscType,
        noiseLevel: 0.5,
        attack: 0.004,
        decay: 0.25,
        sustain: 0.2,
        release: 0.25,
        unisonVoices: 3,
        unisonWidth: 0.9,
        pan: 0,
      },
      production: {
        profile: { role: 'hats', utilityWidth: 0.7, sendReverb: 0.4, eqHigh: 5 },
      },
    })
  }

  const summary =
    `body roots two octaves down (anchor ${anchorLo}, lowpass ${bodyLp}) @${bodyGain} dB` +
    layers.slice(1).map((l) => ` + ${l.id} (${l.band.mode} ${l.band.cutoffHz}, ${l.patch.unisonVoices ?? 1}v) @${l.gainDb} dB`).join('')

  return {
    role: 'lead',
    summary,
    anchor: { loMidi: anchorLo, hiMidi: anchorLo + 12 },
    layers,
    draw: {
      family: family.name,
      choices: { anchorLo, bodyLp, mainHp, bodyGain, mainRel, octaveUnder, widthUnder, airUnder, mainVoices, mainDetune, mainWidth, mainAttack, mainOsc, octaveVoices, octaveHp, octaveOsc, widthVoices, widthDetune, widthHp, pan, airHp },
    },
  }
}

const ARCH_BUILDERS: Record<LayeredRole, (rng: () => number) => LayeredArchitecture> = {
  bassline: buildBasslineArch,
  chords: buildChordsArch,
  lead: buildLeadArch,
}

/** The offset that decorrelates an architecture draw from the FIGURE draw made on the same seed —
 * without it, a batch that composes and layers from one seed would couple "which notes" to "which
 * stack" and halve the effective variety. The value is arbitrary and only has to be stable. */
const ARCH_SEED_SALT = 5387

/** One layered architecture, drawn seeded from the role's sweep space. Deterministic: the same role
 * and seed always yield the same architecture, byte for byte. Seed 0 is the canonical draw, used
 * wherever a caller wants "an architecture" without varying (docs, the CLI's summary line). */
export function layeredArchitecture(role: string, seed = 0): LayeredArchitecture {
  if (!isLayeredRole(role)) throw new BeatBatchError(`no layered architecture for role "${role}" (have: ${LAYERED_ROLES.join(', ')})`)
  const arch = ARCH_BUILDERS[role](mulberry32(seed + ARCH_SEED_SALT))
  const cross = checkCrossover(arch)
  // a drawn architecture that broke the ladder would be a sweep-bounds bug, and silently rendering
  // it would put an unlabelled defect into a rated round — so it fails here, loudly, with the draw
  if (!cross.ok) {
    throw new BeatBatchError(`the ${role} architecture drawn for seed ${seed} (${arch.draw.family}) is not a valid crossover: ${cross.problems.join('; ')}`)
  }
  return arch
}

/** A stable string identity for one architecture — the layer set, each layer's band and level, and
 * the voice choices that change its timbre. Two clips with the same fingerprint are the same
 * instrument playing different notes, which is exactly what the owner heard as "sound the
 * same-ish"; the diversity guard in test/layered.test.ts counts these. */
export function architectureFingerprint(arch: LayeredArchitecture): string {
  const layers = arch.layers
    .map((l) => `${l.id}:${l.band.mode[0]}${l.band.cutoffHz}:${l.gainDb}:${String(l.patch.osc ?? '-')}:${l.patch.sustain ?? '-'}:${l.patch.unisonVoices ?? 1}`)
    .join('|')
  return `${arch.role}/${arch.draw.family}/${arch.anchor.loMidi}/${layers}`
}

/** The coarse identity: the layer SET only. Distinct shapes are what stop a whole round converging
 * on one timbre; distinct fingerprints inside one shape are the finer variation. */
export function architectureShape(arch: LayeredArchitecture): string {
  return `${arch.role}/${arch.layers.map((l) => l.id).join('+')}`
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
  /** the architecture seed. Defaults to 0, the canonical draw. PASS THE BATCH SEED: leaving this at
   * the default gives every clip in a round the identical stack, which is exactly the
   * homogenization the owner reported on 2026-07-26 ("all the layering... makes everything sort of
   * sound the same-ish"). */
  seed?: number
  /** use this pre-drawn architecture instead of drawing one — for a caller that already has the
   * architecture in hand (a report, a re-render of a logged variant). */
  arch?: LayeredArchitecture
}

/** Assemble one layered clip: a multi-track `.beat` where the tracks TOGETHER are one instrument.
 * Every layer plays the same figure at its own register with its own patch, its own crossover slot
 * and its own level; `produced` additionally runs each layer's own production profile. */
export function buildLayeredClip(role: string, phrase: ComposedPhrase, bpm: number, opts: BuildLayeredOptions = {}): LayeredClip {
  const arch = opts.arch ?? layeredArchitecture(role, opts.seed ?? 0)
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

// ---- target verification ------------------------------------------------------------------------
//
// THE FIX THIS SECTION EXISTS FOR (owner ear report, 2026-07-26). The first version of these targets
// was a set of one-sided thresholds copied from single quoted numbers in the research log —
// `bandSubPct >= 30`, `centroidHz <= 90`. A floor-only gate CANNOT FAIL FOR OVERSHOOT, and the
// layered bassline promptly overshot every one of them: 96.1% sub share against a reference MEDIAN
// of 50.1%, a 38.5 Hz centroid against a reference median of 76.2 Hz and a reference p10 of 44.1.
// It scored 4/4 while sounding, in the owner's words, worse than the unlayered arm it beat.
//
// The overshoot was not incidental — it was CAUSED by the one-sided gate. This module's own bass
// comment used to record an honest source disagreement about balance (MusicRadar puts the sub
// hotter than the transient layer; the mined bass-house vein's Recipe 2 puts the sub 9 dB UNDER the
// mid layer) and resolved it with: "our own measured target — bandSubPct >= 30% — only reaches with
// the sub carrying the stack." A floor with no ceiling picked the wrong side of a real disagreement.
//
// So every target here is now DERIVED, two-sided, from the measured reference DISTRIBUTION rather
// than from one number: `[p25, p75]` of the cleaned refs-packs pool for that role, with the pool
// MEDIAN carried alongside so a run reports how far it sits from the middle of the reference class
// rather than only whether it cleared a line. The interquartile range is deliberate — it is by
// construction the middle half of the class we are trying to sound like, it is centred on the
// median, and it is symmetric in the sense that matters: being too much of something fails exactly
// as being too little does.

/** p10/p25/median/p75/p90 of each cleaned refs-packs pool, measured 2026-07-26 over EVERY file in
 * the pool by `scripts/ref-pool-stats.mjs`, through the same `analyze()` path every other dotbeat
 * surface uses. Pool sizes after the 2026-07-26 hygiene sweep (research/140 D4): bassline 32,
 * chords 45, lead 55.
 *
 * These are a SCREEN, not a frozen eval constant (the same distinction `PRODUCED_RANGES_BY_ROLE` in
 * src/analysis/trick.ts draws, and for the same reason): they rank and gate candidate renders, so
 * re-measuring them invalidates nothing historical. Regenerate with
 *   node scripts/ref-pool-stats.mjs --out /tmp/refstats.json
 * and paste; the bassline row here reproduces trick.ts's independently-taken quartiles exactly,
 * which is the cross-check that the two tables are reading the same pool the same way. */
export interface RefQuantiles {
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

export const REF_POOL_QUANTILES: Record<LayeredRole, Partial<Record<LayeredFeatureKey, RefQuantiles>>> = {
  bassline: {
    bandSubPct: { p10: 0.34, p25: 10.17, p50: 50.14, p75: 94.08, p90: 96.58 },
    bandBassPct: { p10: 3.02, p25: 3.65, p50: 18.79, p75: 59.84, p90: 90.39 },
    bandMidsPct: { p10: 0.02, p25: 0.02, p50: 0.22, p75: 3.53, p90: 72.83 },
    centroidHz: { p10: 44.09, p25: 46.46, p50: 76.21, p75: 117.0, p90: 633.0 },
    stereoWidthDb: { p10: -80.0, p25: -80.0, p50: -56.76, p75: -27.3, p90: -13.69 },
    stereoCorrelation: { p10: 0.92, p25: 1.0, p50: 1.0, p75: 1.0, p90: 1.0 },
    crestDb: { p10: 5.21, p25: 5.98, p50: 7.83, p75: 12.11, p90: 15.48 },
    crestSubDb: { p10: 5.09, p25: 5.36, p50: 8.13, p75: 12.88, p90: 15.86 },
    modDepthDb: { p10: 5.05, p25: 5.87, p50: 11.24, p75: 17.88, p90: 34.86 },
    articulationDb: { p10: 8.75, p25: 9.33, p50: 20.59, p75: 33.98, p90: 56.63 },
    characterLevelDb: { p10: -9.96, p25: -8.18, p50: 0.43, p75: 6.38, p90: 18.92 },
  },
  chords: {
    bandBassPct: { p10: 0.06, p25: 2.69, p50: 23.15, p75: 47.19, p90: 58.68 },
    bandMidsPct: { p10: 33.87, p25: 50.35, p50: 66.55, p75: 93.78, p90: 97.14 },
    centroidHz: { p10: 304.0, p25: 344.0, p50: 448.0, p75: 630.0, p90: 1421.0 },
    stereoWidthDb: { p10: -16.0, p25: -8.75, p50: -4.51, p75: -1.75, p90: 0.13 },
    crestDb: { p10: 13.3, p25: 15.0, p50: 16.66, p75: 18.32, p90: 20.67 },
    crestMidsDb: { p10: 13.17, p25: 14.83, p50: 16.42, p75: 18.77, p90: 21.48 },
    modDepthDb: { p10: 5.55, p25: 8.95, p50: 16.88, p75: 22.18, p90: 31.2 },
    articulationDb: { p10: 8.5, p25: 16.29, p50: 24.08, p75: 32.32, p90: 51.91 },
    characterLevelDb: { p10: 17.95, p25: 26.27, p50: 36.42, p75: 46.09, p90: 59.84 },
  },
  lead: {
    bandBassPct: { p10: 0.0, p25: 0.06, p50: 0.47, p75: 18.59, p90: 57.74 },
    bandMidsPct: { p10: 35.58, p25: 67.6, p50: 83.93, p75: 96.63, p90: 99.74 },
    bandPresencePct: { p10: 0.0, p25: 0.33, p50: 2.97, p75: 7.09, p90: 18.59 },
    centroidHz: { p10: 378.0, p25: 504.0, p50: 698.0, p75: 1177.0, p90: 1625.0 },
    stereoWidthDb: { p10: -18.98, p25: -11.19, p50: -7.31, p75: -2.02, p90: 0.01 },
    crestDb: { p10: 12.66, p25: 13.6, p50: 16.49, p75: 19.17, p90: 21.9 },
    crestMidsDb: { p10: 12.07, p25: 12.98, p50: 16.0, p75: 19.32, p90: 23.28 },
    modDepthDb: { p10: 5.43, p25: 8.92, p50: 14.57, p75: 25.12, p90: 31.08 },
    articulationDb: { p10: 8.17, p25: 12.05, p50: 19.73, p75: 32.55, p90: 38.65 },
    characterLevelDb: { p10: 20.34, p25: 27.06, p50: 38.97, p75: 48.17, p90: 68.07 },
  },
}

export interface TargetRange {
  min?: number
  max?: number
  /** the reference median this range is centred on — reported with every line so a run says how far
   * from the middle of the class it sits, not merely whether it cleared a line. */
  median?: number
  /** what the range comes from — printed with every pass/fail line. */
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
  | 'crestSubDb'
  | 'crestBassDb'
  | 'crestMidsDb'
  | 'levelSubDb'
  | 'levelBassDb'
  | 'levelMidsDb'
  | 'levelPresenceDb'
  | 'modDepthDb'
  | 'articulationDb'
  | 'characterLevelDb'

/** Which features each role is gated on, and the two hand-set overrides. Everything not listed in
 * `OVERRIDES` is `[p25, p75]` of that role's pool, straight from `REF_POOL_QUANTILES`.
 *
 * The overrides exist because a quartile is the wrong answer in exactly two documented places:
 *   - bassline `stereoWidthDb`: the pool's p25 is the -80 dB silence clamp and its p75 is -27.3,
 *     but 131 §7-P5, 133 §1 and 138 row 6 independently converge on <= -40 dB, and 21 of the 32
 *     pack basslines measure at or below it. For bass the defect is being too WIDE and there is no
 *     such thing as too mono, so it stays a ceiling. Same call trick.ts's table makes, same reason.
 *   - bassline `stereoCorrelation`: p25 through p90 are all exactly 1.0, so an IQR of [1.0, 1.0]
 *     would fail every render on float noise. A floor is the honest encoding of "must be mono". */
const TARGET_OVERRIDES: Partial<Record<LayeredRole, Partial<Record<LayeredFeatureKey, TargetRange>>>> = {
  bassline: {
    stereoWidthDb: { max: -40, median: -56.76, source: '131 §7-P5 / 133 §1 / 138 row 6 — 21 of 32 pack basslines at or under -40 dB; a ceiling, because for bass there is no such thing as too mono' },
    stereoCorrelation: { min: 0.98, median: 1.0, source: '138 row 5 — bass mono discipline; the pool is 1.0 from p25 up, so a floor, not an IQR' },
  },
}

/** The gated features per role — a deliberate subset of what the pools measure. A feature is gated
 * when its pool distribution actually discriminates (bassline `bandAirPct` is 0.00 at every
 * quantile, so gating it would be theatre) and when the arm can act on it. */
const GATED_FEATURES: Record<LayeredRole, readonly LayeredFeatureKey[]> = {
  bassline: ['bandSubPct', 'centroidHz', 'stereoWidthDb', 'stereoCorrelation', 'crestSubDb', 'articulationDb', 'characterLevelDb'],
  chords: ['bandBassPct', 'bandMidsPct', 'centroidHz', 'stereoWidthDb', 'crestDb', 'articulationDb', 'characterLevelDb'],
  lead: ['bandBassPct', 'bandMidsPct', 'centroidHz', 'stereoWidthDb', 'crestDb', 'articulationDb', 'characterLevelDb'],
}

function deriveTargets(): Record<LayeredRole, Partial<Record<LayeredFeatureKey, TargetRange>>> {
  const out = {} as Record<LayeredRole, Partial<Record<LayeredFeatureKey, TargetRange>>>
  for (const role of LAYERED_ROLES) {
    const targets: Partial<Record<LayeredFeatureKey, TargetRange>> = {}
    for (const key of GATED_FEATURES[role]) {
      const override = TARGET_OVERRIDES[role]?.[key]
      if (override) {
        targets[key] = override
        continue
      }
      const q = REF_POOL_QUANTILES[role][key]
      if (!q) throw new Error(`layered targets: ${role}.${key} is gated but has no measured reference quantiles`)
      targets[key] = {
        min: q.p25,
        max: q.p75,
        median: q.p50,
        source: `refs-packs ${role} pool p25..p75 (median ${q.p50}), measured 2026-07-26 by scripts/ref-pool-stats.mjs`,
      }
    }
    out[role] = targets
  }
  return out
}

/** Feature targets per role: the middle half of the reference class, two-sided, centred on its
 * median. Derived, not hand-written, so a re-measurement of the pools moves every gate at once and
 * no number here can drift away from the distribution it claims to come from. */
export const LAYERED_TARGETS: Record<LayeredRole, Partial<Record<LayeredFeatureKey, TargetRange>>> = deriveTargets()

/** Targets named in 131/133/138 that this gate still cannot check. The list is much shorter than it
 * was: `crest_subDb`, `articulationDb`, `characterLevelDb` and the per-band levels moved OUT of it
 * on 2026-07-26 when src/taste/articulation.ts was written to close the exact gap the owner's ear
 * had found. What is left needs onset detection or an STFT, neither of which exists yet. */
export const UNMEASURABLE_TARGETS: { name: string; target: string; why: string }[] = [
  { name: 'attackMedMs', target: '<=12 ms chords / <=8 ms lead (131 P2)', why: 'onset attack-time extraction exists nowhere in the codebase' },
  { name: 'fluxMean', target: '>=0.17 (131 P3)', why: 'spectral flux needs an STFT; analyze() takes one whole-file spectrum' },
  { name: 'onsetRatePerSec', target: '>=4/s on chords (131 P3)', why: 'onset detection exists nowhere in the codebase' },
  { name: 'flatnessHiDb', target: '-16..-8 dB (131 P4)', why: 'spectral flatness is not in MixMetrics' },
]

export type LayeredFeatures = Record<LayeredFeatureKey, number>

/** The layered gate's feature view of a render: the frozen v1 13-feature vector, plus centroid in
 * Hz rather than log2 (which is what every target row is quoted in), plus the articulation family
 * from src/taste/articulation.ts.
 *
 * `channels`/`sampleRate` are REQUIRED, not optional. An optional audio argument would let a caller
 * silently skip the articulation gates, and a gate that can silently skip is not a gate (CLAUDE.md);
 * the whole reason those features exist is that the ones computable without audio missed what the
 * owner heard.
 *
 * The metrics half is `metricsToBaseFeatures`, not `metricsToFeatures`. Since D30 the full vector
 * is 36 keys — the frozen v1 13 plus research 131's 23 rich axes — and it takes a second
 * `analyzeRich` pass to build. Not one of those 23 appears in any LAYERED_TARGETS row (the ones
 * that came closest, crest_subDb / articulationDb / characterLevelDb, are computed HERE by
 * articulation.ts instead), so asking for the full vector would pay for an STFT pass and discard
 * all of it. `metricsToBaseFeatures` returns `Pick<FeatureVector, FEATURE_KEYS_V1>` — a distinct
 * type, never a FeatureVector with holes in it — so this cannot become the partial-coverage hazard
 * FEATURE_SET_VERSION exists to make detectable. */
export function layeredFeatures(metrics: MixMetrics, channels: readonly Float64Array[], sampleRate: number): LayeredFeatures {
  const f = metricsToBaseFeatures(metrics)
  const a = articulationFeatures(channels, sampleRate)
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
    crestSubDb: a.crestSubDb,
    crestBassDb: a.crestBassDb,
    crestMidsDb: a.crestMidsDb,
    levelSubDb: a.levelSubDb,
    levelBassDb: a.levelBassDb,
    levelMidsDb: a.levelMidsDb,
    levelPresenceDb: a.levelPresenceDb,
    modDepthDb: a.modDepthDb,
    articulationDb: a.articulationDb,
    characterLevelDb: a.characterLevelDb,
  }
}

export interface TargetResult {
  feature: LayeredFeatureKey
  value: number
  min?: number
  max?: number
  median?: number
  pass: boolean
  /** how far the value sits from the reference median, in the same units. NaN when the target has
   * no median (never, today — kept so a hand-set target without one degrades honestly). */
  fromMedian: number
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
    results.push({
      feature: key,
      value,
      ...(t.min !== undefined ? { min: t.min } : {}),
      ...(t.max !== undefined ? { max: t.max } : {}),
      ...(t.median !== undefined ? { median: t.median } : {}),
      pass,
      fromMedian: t.median === undefined ? NaN : value - t.median,
      source: t.source,
    })
  }
  const passed = results.filter((r) => r.pass).length
  return { role, results, passed, total: results.length, ok: passed === results.length, unmeasurable: UNMEASURABLE_TARGETS }
}

const fmt = (x: number) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)) : String(x))

/** Human-facing pass/fail table for one verification, including distance from the reference median
 * — the number that says "you are inside the band but hugging its top edge", which is what a
 * pass/fail column alone cannot say and what the 2026-07-26 overshoot needed. */
export function formatTargetVerification(v: TargetVerification, label: string): string {
  let out = `${label} — ${v.role} targets: ${v.passed}/${v.total} pass\n`
  for (const r of v.results) {
    const range = r.min !== undefined && r.max !== undefined ? `${fmt(r.min)}..${fmt(r.max)}` : r.min !== undefined ? `>= ${fmt(r.min)}` : `<= ${fmt(r.max!)}`
    const med = Number.isFinite(r.fromMedian) ? `${r.fromMedian >= 0 ? '+' : ''}${fmt(r.fromMedian)} vs med ${fmt(r.median!)}` : '—'
    out += `  ${r.pass ? 'PASS' : 'FAIL'}  ${r.feature.padEnd(18)} ${fmt(r.value).padStart(9)}  target ${range.padEnd(16)} ${med.padEnd(24)} [${r.source}]\n`
  }
  for (const u of v.unmeasurable) out += `  n/a   ${u.name.padEnd(18)} ${'—'.padStart(9)}  target ${u.target} — ${u.why}\n`
  return out
}
