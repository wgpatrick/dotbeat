# Research 49 — Ableton Live 12 Reference Manual, ch. 30 "Live Instrument Reference"

*2026-07-12. Owner-commissioned parallel research pass: one stream per manual chapter, mining
Ableton's own documented behavior for ideas/gaps relevant to dotbeat's design and roadmap. This
stream covers Chapter 30, manual pp. 665-784 — the reference chapter for every stock instrument
Live ships. Research-only; no code was written or modified.*

## 0. How to read this doc

- **[manual p.NNN]** — a claim read directly from the chapter text (`ch30.txt`, a `pdftotext
  -layout` extraction of just this chapter). Page numbers are derived from the chapter's stated
  start (p.665) plus each page-footer marker actually present in the extracted text (the chapter
  runs cleanly to p.784, page-for-page, with a footer number after every page — no gaps, no OCR
  ambiguity this pass). Where a specific fact sits mid-page rather than at a section head, the
  citation is the *page the surrounding paragraph physically falls on*, not necessarily the exact
  sentence's own page if a section spans two pages — treat citations as accurate to ±1 page.
- **[dotbeat]** — read directly from this repo's current source this pass (`ui/src/audio/engine.ts`,
  `ui/src/components/synthParams.ts`, `src/core/document.ts`), cited with file:line so a follow-up
  stream can jump straight to the code.
- **Approach to a 120-page reference chapter**: Chapter 30 is one section per stock instrument
  (30.1 Analog through 30.13 Wavetable — 13 instruments total, and this *is* the complete list;
  there's no 30.14, the chapter ends cleanly at Wavetable on p.784 exactly as scoped). Rather than
  summarize all 13 in equal depth, §2 gives every instrument a real inventory entry (one-line
  description, synthesis type, page), and §3-4 go deep only on the handful whose synthesis
  *conventions* — not their skinned UI — are actually comparable to dotbeat's own single flexible
  synth-chain design: Drift and Operator (subtractive/FM, dotbeat's own core model), Wavetable
  (dotbeat has a literal dead stub for this — see §3.3), and the sample-playback family (Simpler/
  Sampler/Drum Sampler/Impulse, relevant to dotbeat's much thinner instrument-track and drum-voice
  models). Analog, Collision, Electric, Tension, and Meld are physical-modeling or macro-oscillator
  instruments dotbeat has no near-term reason to port (no sampling/wavetable dependency, all
  CPU-real-time DSP, out of scope for a Tone.js/Web-Audio engine) — they're inventoried fully in §2
  but not re-derived in depth in §3.

---

## 1. What this chapter covers

Ableton Live 12 ships exactly 13 built-in instruments (Max for Live devices like the separate "Drum
Synths" pack are not part of this Reference Manual chapter and are out of scope here). The chapter's
own framing [manual p.665]: instruments span "physical modeling, FM synthesis, and wavetable
synthesis, among others" — Ableton's own instrument catalog is genuinely synthesis-method-diverse,
not one engine with 13 skins. That diversity is itself the first finding relevant to dotbeat: dotbeat's
`ui/src/audio/engine.ts` is architecturally the opposite — **one flexible synth-chain design** (a
single `SynthChain` per synth track, built from a fixed additive oscillator bank + one shared filter +
one shared envelope set — [dotbeat] `engine.ts:2146-2231`) that a `.beat` file's ~46 optional
`SYNTH_FIELDS` params shape into very different sounds, rather than 13 separate synthesis engines a
user picks between. Both are legitimate designs; §4 works out where dotbeat's single-chain approach
already covers Ableton's per-instrument conventions and where it's missing whole categories of
control Ableton exposes on nearly everything.

---

## 2. Full instrument inventory

| Instrument | One-line description | Synthesis type | Page |
|---|---|---|---|
| **Analog** | Two physically-modeled oscillators + noise into two multi-mode filters (series/parallel) into two amps, four ADSR envelopes, 2 LFOs | Physical modeling (virtual analog, AAS) | [manual p.665] |
| **Collision** | Mallet/noise exciters strike physically-modeled resonators (beam, marimba, string, membrane, plate, pipe, tube) | Physical modeling (mallet/percussion, AAS) | [manual p.674] |
| **Drift** | Two-oscillator subtractive synth (7 curated waveforms incl. Shark Tooth/Saturated), one dynamic dual-type filter, Cycling Envelope, MPE-capable, low-CPU | Subtractive synthesis | [manual p.683] |
| **Drum Sampler** | One-shot sample player for Drum Racks: start/length, AHD envelope, 9 dedicated "playback effects" (Stretch/Loop/Pitch Env/Punch/8-Bit/FM/Ring Mod/Sub Osc/Noise) | Sample playback (one-shot, drum-pad-scoped) | [manual p.691] |
| **Electric** | Physically-modeled electric piano: hammer strikes a tine/tone fork, magnetic pickup, damper model | Physical modeling (electric piano, AAS) | [manual p.696-697] |
| **External Instrument** | Not a synth — a MIDI-out/audio-return routing utility for hardware synths or multitimbral plug-ins, with latency compensation | Routing utility (no synthesis) | [manual p.702] |
| **Impulse** | 8-slot one-shot drum sampler with per-slot stretch, filter, saturator, envelope, pan/vol, mostly velocity/random-modulated | Sample playback (8-slot drum sampler) | [manual p.703-704] |
| **Meld** | Two independent "macro oscillator" engines (24 oscillator types each, 2 macro knobs per type), dedicated filter/envelopes/LFOs per engine, full mod matrix | Macro-oscillator / hybrid synthesis | [manual p.706] |
| **Operator** | Four multi-waveform oscillators in 11 FM algorithms, drawable-harmonic "User" waveforms, filter, 7 envelopes | FM + subtractive/additive hybrid | [manual p.716] |
| **Sampler** | Full multisampling instrument: key/velocity/round-robin zones, modulation oscillator (FM/AM), pitch/filter envelopes, 3 LFOs, 29-destination aux envelope | Sample playback (multisample) | [manual p.734] |
| **Simpler** | Lighter one-sample-at-a-time sampler with warping; three playback modes (Classic/One-Shot/Slicing incl. transient-detected slices) | Sample playback (single-sample, warp-capable) | [manual p.752] |
| **Tension** | Physically-modeled string instrument: 4 exciter types (bow/hammer/hammer-bouncing/plectrum), string/damper/termination/pickup/body models | Physical modeling (strings, AAS) | [manual p.763] |
| **Wavetable** | Two wavetable oscillators (scannable position) + sub-oscillator, oscillator effects (FM/PW-Sync/Warp-Fold), two Cytomic-modeled filters, full mod matrix | Wavetable synthesis | [manual p.775] |

Five of these (Analog, Collision, Electric, Tension — all Applied Acoustics Systems collaborations —
and, differently, Meld's macro-oscillator engines) are genuine real-time physical-modeling DSP, not
sample- or table-based at all [manual p.666, "Analog uses no sampling or wavetables... calculated in
real time by the CPU"; p.763, same claim verbatim for Tension]. That's a meaningfully different
engineering bet than dotbeat's Web-Audio/Tone.js additive-oscillator-bank model and not something
worth chasing — noted for completeness, not recommended.

---

## 3. Deep dive: conventions dotbeat's single synth chain already matches, or is missing

### 3.1 The shared subtractive core (Drift) — dotbeat's closest analog

Drift is explicitly framed as Ableton's baseline subtractive synth: "Subtractive synthesis is a
technique that generally starts with a waveform that is then shaped using filters... Drift offers many
modulation options for tweaking and customizing the sound" [manual p.683]. Its shape is almost
exactly dotbeat's own `SynthChain`: two oscillators + noise generator into a mixer into one dynamic
filter into an amp envelope [manual p.685-686], with a signature "Drift" knob that "adds slight
variation to each voice, affecting different aspects of the voice's sound, such as pitch and filter
cutoff" [manual p.690] — a single knob for cross-voice analog-style drift/jitter, a control dotbeat's
chain has no equivalent of (dotbeat's oscillators are perfectly stable/deterministic; there's no
per-voice randomization knob anywhere in `SYNTH_FIELDS`).

Two Drift-specific conventions worth flagging:

- **Voice Modes as a first-class chooser, not just polyphony**: Drift's Mode chooser is Poly / Mono
  (4-voice unison under the hood, blended by a Thickness slider) / Stereo (2 voices panned hard L/R,
  width via Spread) / Unison (4 voices detuned) [manual p.690]. dotbeat's unison model
  (`unisonVoices` 1-7, `unisonWidth`) is a single continuous knob-pair that already covers something
  similar to Drift's Unison mode, but dotbeat has **no Mono mode at all** — every dotbeat synth voice
  is `Tone.PolySynth`, so there's no monophonic-with-glide behavior, no Legato option, and
  critically no **Stereo mode** (2 voices, hard-panned, no detune) as a distinct, cheaper-than-unison
  option for width. [dotbeat] `engine.ts:2169-2230` confirms every oscillator layer (`synth`,
  `osc2`, `osc3`, all 4 `uniPairs`, `sub`, `noise`, `fm`) is independently a `PolySynth` with no mono
  mode anywhere in the chain.
- **Filter Type toggle is a circuit choice, not just a slope choice**: Drift's Type I/Type II toggle
  isn't 12dB-vs-24dB in the abstract — it's "Type I uses a DFM-1 filter which feeds back more of its
  distortion internally... Type II has the Cytomic MS2 filter which uses a Sallen-Key design and soft
  clipping to limit resonance" [manual p.686]. This exact Cytomic circuit-model set (Clean / OSR /
  MS2 / SMP / PRD) reappears **verbatim, word-for-word**, in Operator [manual p.723], Sampler
  [manual p.748], Simpler [manual p.758], and Wavetable [manual p.777-778] — five different
  instruments share one licensed filter-circuit module. dotbeat's filter is a single `Tone.Filter`
  (native Web Audio biquad) with a plain type enum (`lowpass`/`bandpass`/`highpass`) and no circuit
  modeling, no drive stage baked into the filter itself, no slope choice [dotbeat]
  `synthParams.ts:157-170`. See §4 for the concrete recommendation.

### 3.2 FM (Operator) vs dotbeat's 2-op FM

dotbeat's FM is a single always-on layer: `chain.fm = new Tone.PolySynth(Tone.FMSynth)` mixed in
alongside the additive oscillator bank, with exactly two exposed params (`fmHarmonicity`,
`fmModIndex`) plus a level fader [dotbeat] `synthParams.ts:142-144`. Operator, by contrast, is a full
4-operator FM engine with **11 selectable algorithms** determining which oscillators modulate which
[manual p.717] — "Operator offers eleven predefined algorithms that determine how the oscillators
are connected... signals will flow from top to bottom." Two Operator conventions worth naming
explicitly because they're cheap, well-scoped additions rather than a full FM-algorithm rewrite:

- **Fixed Frequency mode per-oscillator** [manual p.719]: "This allows the creation of sounds in
  which only the timbre will vary when different notes are played, but the tuning will stay the same.
  Fixed Mode would be useful, for example, in creating live drum sounds." dotbeat's FM/osc layers
  have no equivalent — every oscillator always tracks note pitch. A single `fixed`/`fixedFreq` bool +
  Hz field on the FM layer (mirroring dotbeat's own drum-voice params, which *do* hardcode fixed
  Hz values like `kickTune`) would unlock inharmonic/metallic FM timbres that currently require
  detuning tricks.
- **Self-feedback per oscillator** [manual p.719-720]: "Any oscillator that is not modulated by
  another oscillator can modulate itself, via the Feedback parameter" — classic FM self-feedback for
  noisier/richer single-operator tones (this is literally how a 1-operator "FM" patch on a DX7-style
  engine gets more harmonically complex without adding a second operator). dotbeat's FM layer has
  no feedback control at all; `fmHarmonicity`/`fmModIndex` are the only two knobs.

Operator's envelope **loop modes** (Loop / Trigger / Beat / Sync — [manual p.732], "If set to Beat
Mode, an envelope will restart after the beat time selected... In Sync Mode... the first repetition is
quantized to the nearest 16th note") are the single most-repeated convention in the whole chapter —
the *identical* Loop/Trigger/Beat/Sync vocabulary reappears for Analog's amp/filter envelopes
[manual p.670-671, described as AD-R/ADR-R/ADS-R modes], Meld's envelopes [manual p.710, Trigger/
Loop/AD Loop], Sampler's volume envelope [manual p.749], and Wavetable's envelopes [manual
p.780-781, None/Trigger/Loop]. dotbeat's ADSR (`attack`/`decay`/`sustain`/`release`, plus the
parallel `filterEnv*` set) has **no loop mode of any kind** — it's a strict one-shot ADSR every time,
the same shape across every Ableton instrument's *simplest* case but missing the looping/rhythmic
mode nearly all of them add on top. See §4.

### 3.3 Wavetable synthesis — dotbeat already has the field name, not the oscillator

This is the sharpest, most concrete finding in the whole pass, because dotbeat's own format already
half-committed to it. `SYNTH_FIELDS` has carried `wtTable` (enum: `analog`/`pwm`/`vocal`/`custom`)
and `wtPos` (0-1 knob, even LFO-modulatable via `LFO_DESTS`) since Phase 5 [dotbeat]
`synthParams.ts:130-131`, but per the engine's own header comment, **there is no wavetable
oscillator implemented anywhere in `engine.ts`** — `OscType` is sine/triangle/sawtooth/square only
[dotbeat] `engine.ts:39-41`, and this is independently confirmed as a known, named gap in
`ROADMAP.md`'s v1 feature inventory ("real wavetable oscillator synthesis... `wtPos` is currently a
dead control"). `wtTable`'s four values (analog/pwm/vocal/custom) are a plausible, reasonable
starter set of wavetable *categories* — Ableton's own Wavetable instrument organizes its factory
tables the same way, by category-then-specific-table chooser [manual p.776, "The first chooser
selects a category of wavetable, while the second chooser selects a specific wavetable from within
that category"].

What Ableton's actual implementation looks like, concretely, for whenever this gets built:

- **A wavetable is "an arbitrary collection of short, looping samples arranged together"** [manual
  p.775] — i.e. a 2D array of single-cycle waveforms; `wtPos` scans across that array. This is a
  well-understood, cheap-to-implement DSP primitive (a lookup table + linear/cubic interpolation
  between adjacent frames), not something that needs a new synthesis paradigm bolted onto Tone.js —
  it slots in as a `PeriodicWave`-per-frame or a custom `AudioWorkletProcessor` reading from a
  Float32Array table, either compatible with the existing `PolySynth`-per-layer architecture or a
  worklet-based replacement for just this one oscillator type.
- **Oscillator effects layered on top of the raw wavetable read** [manual p.777-778]: FM (a hidden
  modulator oscillator, tune-able across harmonic/inharmonic ratios), Classic (pulse-width + hard
  sync), Modern (Warp — PWM-like — and Fold — wavefolding distortion). Fold in particular is a cheap,
  high-payoff addition: wavefolding is a simple waveshaper (a periodic folding function applied to
  the oscillator's raw samples before the filter) that dramatically increases harmonic richness for
  almost no CPU cost, and dotbeat has no waveshaping anywhere in the oscillator stage today (only
  post-chain `distortion`/`saturator` effects, which act on the *summed* voice, not per-oscillator).
- **Filter routing as a first-class choice, not implicit**: Wavetable's Serial/Parallel/Split filter
  routing [manual p.778-779] ("Split — Routes Oscillator 1 to Filter 1, and Oscillator 2 to Filter
  2... useful for cases where you want to create layered synth sounds") is the same idea Analog
  exposes via its "Quick Routing" buttons [manual p.672-673]. dotbeat has exactly one filter per
  synth chain, shared by every oscillator layer unconditionally [dotbeat] `engine.ts:2198-2205` — a
  second filter with a routing chooser is a bigger lift than the wavetable oscillator itself and not
  recommended as a near-term addition (see §4's prioritization).

### 3.4 Sample playback family vs dotbeat's instrument tracks and drum voices

dotbeat's two sample-adjacent surfaces are architecturally thin next to any of Ableton's four
sample-playback instruments:

- **Instrument tracks** are pure SoundFont (SF2) GM program playback via `spessasynth_lib`'s
  `WorkletSynthesizer` [dotbeat] `engine.ts:2459-2492` — load a bank, `programChange`, done. No
  per-instrument ADSR, no filter, no LFO, no pitch/detune beyond what's baked into the soundfont
  itself; the only exposed params are `volume`/`pan`/`program` [dotbeat] `engine.ts:2478-2486`. Even
  Ableton's *simplest* sample instrument, Drum Sampler, exposes a full AHD envelope, filter section,
  and 9 dedicated "playback effects" per sample (Stretch/Loop/Pitch Env/Punch/8-Bit/FM/Ring
  Mod/Sub Osc/Noise — [manual p.693-694]) on top of whatever the source audio already sounds like.
- **Drum voices** (kick/snare/hat/clap) are each a dedicated procedural Tone.js synth
  (`MembraneSynth` for kick, `NoiseSynth` for snare/clap, `MetalSynth` for hats — [dotbeat]
  `engine.ts:1908-1921`), which is closer in spirit to a classic analog drum-machine circuit (808/909
  style — a pitched-decay oscillator for the kick, filtered noise for snare/hat) than to any of
  Ableton's sample-based drum instruments (Drum Sampler, Impulse). This is a reasonable, low-CPU,
  zero-licensing-risk design choice for a synth-first product and not something to abandon — but it
  means dotbeat's drum sound is permanently bounded by what a MembraneSynth/NoiseSynth/MetalSynth
  can do, with no path to "load a real kick sample and shape it" the way even Ableton's *cheapest*
  drum instrument (Drum Sampler) offers by default. `docs/decisions.md`'s Tier 2 sound-quality
  strategy already flags this ("Real drum transients are the biggest single 'video game music' tell
  left") — this manual pass adds concrete evidence for *what shape* that sampler should take when
  built: Ableton's Drum Sampler's parameter surface (Start/Length/Gain, AHD envelope, one filter,
  9 cheap playback effects) is a smaller, more achievable target than Sampler's full multisampling
  stack, and maps directly onto dotbeat's existing per-lane drum-voice param groups
  (`kickTune`/`kickDecay` etc. — [dotbeat] `synthParams.ts:447-460`) if/when those lanes get a
  real sample slot instead of (or alongside) their current synth voice.
- **Round Robin** [manual p.737-738, "triggers a different sample each time a note is played... to
  add subtle nuances to repetitive drum or note patterns"] is a well-established, cheap
  humanization technique with no dotbeat equivalent at any layer (drum lanes, instrument tracks, or
  the variation-loop tooling in `docs/variation-loop.md`) — worth a mention in a future
  drum-sampler design, low priority on its own.

### 3.5 The universal modulation convention dotbeat is missing the most

Across all 13 instruments, nearly every parameter — not just filter cutoff — carries **dedicated Vel
(velocity) and Key (note-pitch) modulation sliders right next to the knob itself**, independent of any
global LFO/envelope routing:

- Analog: "Stiffness... can also be modulated by pitch and velocity via the Key and Vel sliders"
  [manual p.675, Collision's Mallet section — same pattern; also Analog's own oscillator/filter/amp
  sections, p.667-669].
- Operator: nearly every oscillator/filter/LFO/pitch parameter has its own `< Vel` and/or `< Key`
  slider [manual p.729-731] — nine separate instances of the same convention within one instrument.
- Tension: Finger Mass, Decay, Damping, Position — all independently Vel/Key-modulatable [manual
  p.765-769].

dotbeat's velocity handling, by contrast, is close to the minimum viable: note velocity feeds
`Tone.PolySynth`'s built-in velocity-to-gain scaling automatically (every `triggerAttackRelease` call
passes `n.velocity` straight through — [dotbeat] `engine.ts:3040-3048`) and one explicit param,
`velToFilterAmount`, scales filter cutoff by velocity at note-on [dotbeat] `engine.ts:3049-3055`.
Key-tracking is similarly narrow: `keytrackAmount` only ever modulates filter cutoff [dotbeat]
`engine.ts:3053`, never oscillator level, pan, envelope time, or anything else. There is no
per-parameter Vel/Key slider convention anywhere in `SYNTH_FIELDS` — velocity and key-tracking are
each a *single* hardcoded destination (amp via PolySynth default, cutoff via one param each) rather
than a general modulation source usable against arbitrary targets. This is the single largest
modulation-flexibility gap between dotbeat's engine and every Ableton instrument surveyed — see §4.

### 3.6 Unison/voice-stacking conventions, compared side by side

Every subtractive/FM/wavetable instrument in the chapter ships some form of "stack N detuned voices
per note," but the concrete shape varies in ways worth cataloging since dotbeat will eventually need
to pick one:

| Instrument | Unison shape | Voice count | Page |
|---|---|---|---|
| Analog | Global Uni switch + Detune, 2 or 4 voices, per-voice activation Delay | 2 or 4 | [manual p.672] |
| Drift | Voice Mode = Unison (one of 4 modes), Unison Strength | 4 (fixed) | [manual p.690] |
| Operator | Spread parameter, 2 voices L/R, CPU-flagged as expensive | 2 (fixed) | [manual p.725] |
| Meld | Stacked Voices dropdown, duplicates both engines per note | configurable | [manual p.715] |
| Wavetable | Unison dropdown, 6 named modes (Classic/Shimmer/Noise/Phase Sync/Position Spread/Random Note) | configurable via Voices slider | [manual p.783] |
| **dotbeat** | `unisonVoices` (1-7) + `unisonWidth`, 4 fixed detune-ratio pairs (±1.6/±2.4 semitone-ish multipliers), always on osc2's waveform | up to 7 | [dotbeat `synthParams.ts:145-146`, `engine.ts:2176-2181`] |

dotbeat's model is actually **more granular on voice count** (continuous 1-7 vs. Ableton's mostly
binary/small-discrete choices) but has **no named-mode variety** — Wavetable's 6 unison modes each
do something qualitatively different (Shimmer jitters pitch at random intervals for a reverb-like
smear; Phase Sync syncs phases for a sweeping phaser effect) where dotbeat's unison is one fixed
algorithm (evenly-spaced detune pairs) that only scales in voice count and width. Not an urgent gap,
but worth knowing the ceiling exists if unison ever gets revisited.

---

## 4. Relevance to dotbeat: concrete recommendations

Ranked by (estimated implementation cost) vs (how directly it closes a gap the roadmap already
named). All recommendations target `ui/src/audio/engine.ts` (the one canonical engine per D15) and
`ui/src/components/synthParams.ts` (the panel/param-metadata layer), consistent with `SYNTH_FIELDS`'
existing pattern of "add a field, `applyParams` reads it, `synthParams.ts` renders a knob for it."

1. **Ship the wavetable oscillator dotbeat already has fields for (§3.3).** This is the highest-value,
   lowest-ambiguity item: `wtTable`/`wtPos` are already frozen into the format
   (`docs/format-spec.md`), already have a UI knob (`synthParams.ts:130-131`), and are already
   named as a v1 roadmap gap. The manual gives a concrete minimum spec: a small library of
   single-cycle waveform tables per category (Ableton's own categories — analog, PWM/digital,
   vocal/formant, "custom"/user-imported — line up almost exactly with dotbeat's existing 4-value
   `wtTable` enum, [manual p.776] vs [dotbeat `synthParams.ts:130`]), linear-interpolated scanning
   across `wtPos`, implemented as a `PolySynth`-compatible custom oscillator or a small
   `AudioWorkletProcessor`. Skip Ableton's oscillator-effects layer (FM/Classic/Modern, §3.3) and
   Serial/Parallel/Split filter routing for v1 — those are real but second-order refinements once the
   base oscillator exists.
2. **Add a `fmFeedback` param to the existing FM layer (§3.2).** One knob, no new signal-flow
   plumbing (`Tone.FMSynth` already exposes a `modulationIndex`; feedback is a comparably small
   addition to the layer's own envelope/level params already in `applyParams`). Directly answers
   "how do I get a noisier/richer FM tone without a second operator," which is currently not
   reachable at all with dotbeat's 2-knob FM.
3. **Generalize velocity/key-tracking beyond the two hardcoded destinations (§3.5).** Currently
   `velToFilterAmount` and `keytrackAmount` are each a single fixed target. The cheapest version that
   captures most of the value without a full N×M modulation matrix: extend the existing `LFO_DESTS`-
   style enum pattern dotbeat already uses for LFO routing (`synthParams.ts:82-98`) to a second,
   parallel `velDest`/`velAmount` pair (and optionally `keyDest`/`keyAmount`) reusing the *same*
   destination list. This is architecturally cheap because dotbeat already has the "flat enum of
   named destinations + one amount slider" pattern working for two LFOs — velocity/key-tracking as a
   third and fourth modulation source through the identical mechanism is incremental, not a rewrite.
4. **Envelope loop modes on the amp/filter envelope (§3.2).** Loop/Trigger/Beat/Sync is the single
   most-repeated convention in the chapter (appears on 5+ instruments) and dotbeat's ADSR has none
   of it. A `envLoopMode` enum (`off`/`loop`/`trigger`/`syncBeat`) plus a `envLoopRate` (reusing the
   existing `LFO_SYNC_RATES` tempo-division list dotbeat already built for LFO sync,
   `synthParams.ts:108`) would unlock rhythmic/looping envelope textures (arpeggiator-adjacent
   sounds without an arpeggiator) cheaply, since dotbeat already has the tempo-sync division
   machinery built for the LFOs.
5. **A real drum-sampler voice type, scoped to Ableton's Drum Sampler (not Sampler's full
   multisampling stack) (§3.4).** Already flagged in `docs/decisions.md`'s Tier 2 sound-quality
   strategy as the "biggest single 'video game music' tell left." This pass's contribution is scope:
   target Drum Sampler's parameter surface (Start/Length/Gain, one AHD-ish envelope, one filter, a
   short list of cheap playback effects) rather than Sampler's zone-editor/multisampling machinery —
   it's a smaller, more achievable target that still maps directly onto dotbeat's existing per-lane
   drum-voice param groups.
6. **A Drift-style "voice mode" chooser (Poly/Mono/Stereo), not just continuous unison (§3.1).**
   Lower priority than the above — dotbeat's continuous `unisonVoices`/`unisonWidth` already covers
   most of what Drift's Unison mode does. The genuinely missing piece is **Mono mode with Legato**
   (no dotbeat synth voice can currently behave monophonically at all — every voice is
   `Tone.PolySynth`), which matters for lead/bass patch character more than filter-circuit modeling
   does. Worth a design note, not urgent.
7. **Filter circuit modeling (Cytomic Clean/OSR/MS2/SMP/PRD) — explicitly NOT recommended near-term.**
   Flagging this because it's the most *repeated* convention in the chapter (5 instruments share the
   identical filter module) and might look high-priority on frequency alone, but it's a licensed,
   bespoke DSP model Ableton built once and reused — there's no equivalent open building block, and
   dotbeat's native `Tone.Filter`/Web Audio biquad is a reasonable, zero-licensing-risk baseline.
   `docs/decisions.md` D1/license notes (MIT, GPL engines closed) make an equivalent bespoke filter
   circuit a real DSP-research project, not a param-table addition — out of scope for this pass's
   recommendations.

**What NOT to chase**: the physical-modeling instruments (Analog, Collision, Electric, Tension) are
architecturally a different bet than dotbeat's Tone.js/Web-Audio additive-oscillator engine — real-time
solved-differential-equation DSP, not a param table on top of existing oscillators. None of their
specific conventions (mallet/resonator modeling, string/exciter/damper physics) translate into
incremental `SYNTH_FIELDS` additions the way Drift/Operator/Wavetable's conventions do. Full Modulation
Matrix UIs (Wavetable's/Meld's N-source × M-target grid, [manual p.779, p.711]) are also explicitly
out of scope near-term — recommendation #3 above gets most of the practical value (velocity/key as
real modulation sources) without building a general-purpose matrix editor.

---

## Sources

Ableton Live 12 Reference Manual, Chapter 30 "Live Instrument Reference," pp. 665-784 (extracted
text: `ch30.txt`, `pdftotext -layout` of the owner's local, gitignored copy in `prior_art/`). dotbeat
internal (read directly this pass): `ui/src/audio/engine.ts` (`buildSynthChain`/`applyParams`
`engine.ts:2146-2327`, drum voices `engine.ts:1908-1963`, instrument tracks `engine.ts:2459-2548`,
velocity/keytrack handling `engine.ts:3040-3055`); `ui/src/components/synthParams.ts` (full
`PARAM_GROUPS` table); `ROADMAP.md` §9 (v1 feature inventory's wavetable/undo flags); `docs/decisions.md`
(D1 license constraints, D15 canonical-engine decision, Tier 2 sound-quality strategy).
