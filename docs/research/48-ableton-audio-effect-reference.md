# Research 48 — Ableton's full stock audio-effect catalog vs. dotbeat's FX arsenal

*2026-07-12. Research-only pass mining Ableton Live 12's official Reference Manual, chapter 28
("Live Audio Effect Reference," manual pp. 513-651) for ideas/gaps relevant to dotbeat's own
effect roadmap. Commissioned as one of several parallel per-chapter research passes over the
manual (`prior_art/`, gitignored). This pass's specific job: check the conclusions of
`docs/research/17-track-fx-arsenal.md` — dotbeat's existing FX-arsenal research, written against
partial manual fetches + secondary sources — against this chapter's actual, complete, authoritative
text.*

## How to read this doc

- **[manual p.NNN]** — a claim read directly from the chapter text this pass, cited to the actual
  PDF page number. Page numbers are derived from the chapter's own printed footer numbers in the
  `pdftotext -layout` extract (the chapter starts at p.513; each section's footer number is used
  directly, not estimated) — not from web pages, since this pass reads the manual PDF text, not
  `ableton.com`.
- **[dotbeat]** — read directly from this repo's current source this pass, cited file:line.
- Unlike research 30 (which had web access for corroboration), this pass had only the extracted
  manual text plus this repo's own source — no live-Ableton or web cross-check. Treat manual
  citations as high-confidence (it's the primary source), and treat "is this still true in the
  *current* shipping Live 12.x GUI" as a small residual gap (manuals occasionally lag or lead a
  release by a point version).

## 0. Approach to a 39k-word reference chapter

Chapter 28 documents all 42 of Live's stock audio effects, one section each, roughly 3,000-8,000
words per major device (Roar, Hybrid Reverb, and Spectral Time are the longest; most are 500-1,500
words). Summarizing all 42 in comparable depth would produce a survey nobody reads and bury the
handful of findings that actually matter for dotbeat. Instead:

1. **§1** is a complete inventory — every stock effect, one line, one page cite — so nothing from
   the chapter is silently dropped, and so future passes have a fast index instead of needing to
   re-read all 39k words.
2. **§2** goes deep only on effects that are either (a) directly relevant to what dotbeat has
   already built or roadmapped, or (b) genuinely and surprisingly absent from both dotbeat's
   `EFFECT_TYPES` and research 17's original scoping — the two categories the task brief asked for.
3. **§3** is the actual payoff: a direct, current-state comparison against dotbeat's *now* (not
   research 17's *then* — a lot has shipped since research 17 was written on 2026-07-11), plus
   specific corrections to research 17's own claims now that the full, authoritative manual text is
   available instead of partial fetches.

## 1. The complete inventory — all 42 stock Ableton Live 12 audio effects

Chapter order (alphabetical, as the manual presents it), not reordered by importance — §3 does the
prioritization work.

| # | Effect | Page | One-line description |
|---|---|---|---|
| 28.1 | **Amp** | [p.513] | Physical-modeled guitar-amp emulation — 7 classic amp models (Clean/Boost/Blues/Rock/Lead/Heavy/Bass) sharing one Gain/Volume/Bass/Middle/Treble/Presence control set. |
| 28.2 | **Auto Filter** | [p.515] | Resonant multi-type filter (LP/HP/BP/Notch/Morph/DJ/Comb/Resampling/Notch+LP/Vowel) driven by an LFO and/or an envelope follower with external sidechain input. |
| 28.3 | **Auto Pan-Tremolo** | [p.523] | Live 12's merger of the old separate Auto Pan and Tremolo devices — one LFO-driven device switchable between stereo-panning and amplitude-tremolo modes. |
| 28.4 | **Auto Shift** | [p.527] | Real-time pitch-correction / vibrato / formant-shift device (Autotune-class, new to Live 12) — scale-aware or MIDI-track-driven, with a built-in modulation LFO. |
| 28.5 | **Beat Repeat** | [p.535] | Captures and re-triggers a slice of live audio on a tempo-synced interval — Grid/Gate/Chance/Pitch/Variation controls, three mix modes (Mix/Insert/Gate). |
| 28.6 | **Cabinet** | [p.537] | Physical-modeled guitar speaker-cabinet simulation (5 cabinets × mic position/type), designed to pair with Amp. |
| 28.7 | **Channel EQ** | [p.539] | Simple mixing-desk-style 3-band EQ — fixed-frequency low/high shelf (100 Hz / adaptive) + one sweepable mid peak (120 Hz-7.5 kHz), plus an 80 Hz high-pass switch. |
| 28.8 | **Chorus-Ensemble** | [p.541] | Two/three-delay-line chorus with Chorus/Ensemble/Vibrato modes, feedback (with invert), width, and warmth controls. |
| 28.9 | **Compressor** | [p.545] | Standard downward compressor — threshold/ratio/knee/attack/release/lookahead (0/1/10ms), Peak/RMS/Expand modes, Lin/Log envelope shape, full internal + external + EQ'd sidechain. |
| 28.10 | **Corpus** | [p.550] | Physical-modeling resonator (beam/marimba/string/membrane/plate/pipe/tube) with an LFO section, band-pass filter, and MIDI-frequency sidechain. |
| 28.11 | **Delay** | [p.556] | The base tempo-synced/free-time stereo delay — independent L/R lines, band-pass filter, LFO modulation of time + filter, three time-change smoothing modes (Repitch/Fade/Jump), a Ping Pong toggle. |
| 28.12 | **Drum Buss** | [p.560] | Analog-style drum-bus glue processor — fixed compressor, 3-stage distortion (Soft/Medium/Hard), mid-high Crunch/Transients shaping, a resonant low-end "Boom" enhancer. |
| 28.13 | **Dynamic Tube** | [p.562] | Tube-saturation emulator (3 tube models, A/B/C) with an envelope follower modulating the Bias/distortion amount. |
| 28.14 | **Echo** | [p.563] | Modulation delay with Stereo/Ping-Pong/Mid-Side channel modes, LFO + envelope-follower modulation, and a built-in "Character" tab (Gate, Ducking, Noise, Wobble). |
| 28.15 | **EQ Eight** | [p.567] | Up to 8 fully parametric bands per channel (low/high cut, low/high shelf, peak, notch), Stereo/L-R/M-S processing modes, Adaptive Q, 2× oversampling option. |
| 28.16 | **EQ Three** | [p.569] | The classic 3-band DJ-mixer-style EQ — adjustable crossover frequencies (FreqLo/FreqHi), per-band on/off, 24/48 dB slope switch. |
| 28.17 | **Erosion** | [p.570] | Digital-degradation effect — modulates a short delay with a sine wave and/or filtered noise for downsampling-like artifacts. |
| 28.18 | **External Audio Effect** | [p.571] | Routes a track through outboard hardware processors, with gain and manual latency-compensation controls. |
| 28.19 | **Filter Delay** | [p.572] | Three independent filtered delay lines (L / L+R / R routing), linked low/high-pass filters per line, independent feedback per line. |
| 28.20 | **Gate** | [p.573] | Standard noise gate — threshold/return (hysteresis)/attack/hold/release/floor, 3 lookahead times, a Flip (duck) mode, full external + EQ'd sidechain. |
| 28.21 | **Glue Compressor** | [p.576] | Analog-modeled "bus glue" compressor (Cytomic collaboration) — fixed knee-sharpens-with-ratio curve, a Range control, a Soft Clip output stage, sidechain. |
| 28.22 | **Grain Delay** | [p.579] | Granular pitch-shifting delay — slices the delayed signal into grains with independent Pitch/Frequency/Spray/Size controls. |
| 28.23 | **Hybrid Reverb** | [p.580] | Convolution reverb (importable impulse responses, 10 categories) + a 5-algorithm digital reverb engine, routable serial/parallel/either-alone, with its own EQ section. |
| 28.24 | **Limiter** | [p.587] | Mastering brickwall limiter — Ceiling, Link (L/R vs M/S), Input Gain, a Maximize mode, Auto Release, 3 lookahead times, Standard/Soft-Clip/True-Peak ceiling modes. |
| 28.25 | **Looper** | [p.589] | Real-time performance looper — record/overdub/undo/redo/reverse/×2/÷2, tempo-detecting or tempo-setting, feedback-routable to other tracks. |
| 28.26 | **Multiband Dynamics** | [p.593] | Up to 3-band mastering dynamics processor supporting all four processing types (upward/downward compression, upward/downward expansion) simultaneously per band. |
| 28.27 | **Overdrive** | [p.598] | Pedal-style distortion with a pre-distortion band-pass filter and a Dynamics control balancing internal compression vs. raw drive. |
| 28.28 | **Pedal** | [p.599] | 3-type (Overdrive/Distortion/Fuzz) guitar-pedal distortion with an adaptive post-distortion 3-band EQ + a sub-bass shelf switch. |
| 28.29 | **Phaser-Flanger** | [p.602] | Live 12's merger of the old separate Phaser and Flanger devices, plus a new Doubler mode — dual LFOs, an envelope follower, a Safe Bass high-pass filter. |
| 28.30 | **Redux** | [p.605] | Bitcrusher with two independent halves — downsampling (Rate/Jitter/pre+post filter) and bit reduction (Bits/Shape/DC Shift). |
| 28.31 | **Resonators** | [p.607] | 5 parallel tuned resonant filters (scale/tuning-system aware) — plucked-string to vocoder-like tonal textures. |
| 28.32 | **Reverb** | [p.608] | Full algorithmic reverb — input filter, early reflections (with Spin modulation), a diffusion network, an internal chorus stage, freeze, density/CPU tradeoff. |
| 28.33 | **Roar** | [p.612] | Live 12's newest, deepest saturation/distortion device — up to 3 gain stages, 7 routing topologies (incl. Multiband, Mid/Side, Feedback, Delay), 12 shaper curves, a full mod matrix (2 LFOs/envelope/4 noise types), an internal feedback loop with its own compressor. |
| 28.34 | **Saturator** | [p.621] | Waveshaping saturation — 8 curve types + a dedicated 6-parameter Waveshaper mode, frequency-selective "color" filters (Amt Lo/Hi), a post-clip stage. |
| 28.35 | **Shifter** | [p.624] | Pitch-shift / frequency-shift / ring-modulation in one device, with delay+feedback, a stereo-spreading LFO, an envelope follower, MIDI pitch control. |
| 28.36 | **Spectral Resonator** | [p.629] | MIDI-driven (up to 16-voice) spectral resonance effect tuning a signal's harmonics to played/scale pitches — Chorus/Wander/Granular modulation modes. |
| 28.37 | **Spectral Time** | [p.634] | Spectral freeze (manual / onset-retrigger / sync-retrigger) + spectral delay (per-partial time/frequency shift, Tilt, Spray) in one device. |
| 28.38 | **Spectrum** | [p.638] | Real-time FFT analyzer/visualizer — **explicitly not an audio effect** [manual p.638]: "does not alter the incoming signal in any way." |
| 28.39 | **Tuner** | [p.639] | Monophonic pitch-tuner display — **also explicitly not an audio effect** [manual p.639-640] — Classic/Histogram views, Target/Strobe modes. |
| 28.40 | **Utility** | [p.644] | Mixing-hygiene toolbox — per-channel phase invert, channel mode (L/R/mono), stereo width, Mid/Side control, mono/bass-mono, gain trim (-∞..+35 dB), balance/pan, mute, DC filter. |
| 28.41 | **Vinyl Distortion** | [p.646] | Emulates vinyl-playback distortion — even-harmonic "Tracing Model" + odd-harmonic "Pinch Effect," plus a crackle-noise generator. |
| 28.42 | **Vocoder** | [p.648] | Classic carrier/modulator vocoder ("talking synth" / robot voice) — Noise/External/Modulator/Pitch-Tracking carrier sources, Enhance + Unvoiced-noise resynthesis, up to ~40 bands. |

**One structural note before §2/§3**: Live 12 has been actively consolidating devices — three
separate merges are directly visible in this chapter alone: Auto Pan + Tremolo → **Auto
Pan-Tremolo** [manual p.523: "Live 12 merged device; was two separate devices... through Live
11"], Phaser + Flanger → **Phaser-Flanger** [manual p.602: "combines the functionalities of
flanger and phaser effects into one device with separate modes"], and — the one this pass had to
verify carefully, see §3.1 — **there is no standalone "Ping Pong Delay" device left in this
chapter at all**; ping-pong behavior lives as a toggle inside the base **Delay** device [manual
p.558] and as a channel mode inside **Echo** [manual p.563]. This matters directly for how
research 17 named things (§3.1).

## 2. Deep dives — effects most relevant to dotbeat's roadmap and current build

dotbeat's current per-track reorderable effect chain (`EFFECT_TYPES`, `src/core/document.ts:642`)
is: `eq3, comp, distortion, bitcrush, eq7, autoFilter, autoPan, tremolo, utility, grainDelay,
vinylDistortion, resonator` — plus four always-wired fixed inserts (`saturator`, `chorus`,
`phaser`, `pingPong`, `ui/src/audio/engine.ts`'s `SynthChain`) and one scheduling-layer effect
(`beatRepeat`, in `tick()`, not an audio-graph node). Per `docs/product-roadmap.md`'s "Extended FX
arsenal" section, **every single one of research 17's original 13 recommended effects has already
shipped** except Corpus (explicitly deferred as AudioWorklet-tier). That's the essential context
for this section: the deep-dive targets below are chosen because they're either **directly
comparable to something dotbeat already built** (so the manual's fuller spec shows exactly where
dotbeat's version is scoped down) or **genuinely, surprisingly absent** from both research 17's
13-item list and dotbeat's shipped chain.

### 2.1 Gate — the one everyday dynamics tool that's missing entirely

[manual p.573-575] Ableton's Gate is deliberately the mirror image of Compressor, sharing most of
its plumbing: **Threshold**, **Return** (hysteresis — the gap between the level that opens the gate
and the level that closes it, reducing chatter), **Attack**, **Hold**, **Release**, **Floor**
(attenuation amount when closed, down to -∞ for full mute), a **Flip** toggle (inverts the gate so
signal passes *below* threshold instead of above — a ducking primitive), 3 **Lookahead** times
(0/1/10ms, identical to Compressor's), and a full **external + EQ'd sidechain** section
[manual p.574-575] — including the classic "trigger a pad with a drum loop's rhythm" sidechain-gate
technique the manual names explicitly.

**Why this is the sharpest single finding in this pass**: Gate sits in the exact same
"fundamental, everyday, alongside Compressor" tier as EQ Three and Compressor — both of which
dotbeat built early and considers `Full`/done. Gate is conspicuously **not** in research 17's
original 13-item list at all [`docs/research/17-track-fx-arsenal.md`], and it's not in dotbeat's
`EFFECT_TYPES` either — meanwhile niche, harder-to-justify-as-"everyday" effects like Corpus's
sibling Resonators, Vinyl Distortion, and Grain Delay all shipped. This isn't research 17 getting
something *wrong* exactly — Gate wasn't on the owner's original "beat repeat, ping pong delay"
framing — but it's a real, actionable gap that a chapter-28-level pass is well-positioned to
surface: a noise gate is one of the half-dozen tools a working producer reaches for on nearly every
drum bus and vocal chain, and dotbeat's `Tone.Compressor`-based insert pattern (§4.1 of research
17, still the load-bearing architecture note) already gives it a near-free implementation path — a
gate is structurally a compressor with the threshold logic flipped and infinite ratio below
threshold, buildable from the same envelope-follower primitives already driving `compAttack`/
`compRelease`, with no new Tone.js class required (Tone.js has no `Tone.Gate` effect class, but the
underlying `Tone.Follower`/threshold-comparison pattern is standard and small).

### 2.2 The base Delay device — dotbeat has grainDelay + pingPong, but no plain synced delay insert

[manual p.556-559] Ableton's plain **Delay** — not Grain Delay, not Ping Pong Delay (which doesn't
exist standalone, §3.1) — is the single most reached-for delay in a working Ableton session: Sync/
Time toggle, per-16th-note tempo-synced time with an **Offset** slider for swing, independent L/R
delay lines (or Stereo Link), **Feedback**, a **Freeze** button, a built-in band-pass filter on the
delay path, LFO modulation of both delay time and filter frequency, and — the detail worth calling
out specifically — **three named smoothing modes for what happens when the delay time changes
while playing**: *Repitch* (tape-style pitch warble, the default), *Fade* (crossfade, described in
the manual as "similar to a granular synthesis effect"), and *Jump* (instant, can click)
[manual p.557-558]. A **Ping Pong** toggle and a **Dry/Wet - Equal-Loudness** context-menu option
round it out.

dotbeat has real granular delay (Grain Delay) and a genuinely enhanced ping-pong delay (per
`docs/product-roadmap.md`'s row: "a hand-built two-delay-line network... plus continuously-variable
pingPongCrossFeed and delay-time LFO wobble... rather than a binary ping-pong toggle" — actually
*exceeds* Ableton's own Ping Pong toggle in configurability) — but has **no plain, general-purpose,
per-track tempo-synced delay insert** with adjustable time/feedback/filter as a first-class chain
member. The existing shared `delayBus` (`ui/src/audio/engine.ts`, per research 17 §2) is a
project-global `Tone.FeedbackDelay` with hardcoded time/feedback, reachable only via the generic
`sendDelay` amount — not a per-track insert, and not tempo-synced to note divisions in a
document-driven way. Given how central "plain delay with a filter and a feedback knob" is to
day-to-day Ableton use, this is a real gap between two much-more-specialized delay effects
(Grain Delay, Ping Pong Delay) that dotbeat already built.

### 2.3 Compressor and EQ Three — dotbeat's "Full 1:1" claims are optimistic against the actual spec

Research 17's cross-reference table (`docs/research/17-track-fx-arsenal.md` §2) marks both
**EQ Three** and **Compressor** as `Full` / "1:1" matches. Reading the actual manual sections shows
both claims hold at the *sonic-concept* level but not at the *parameter-surface* level:

- **EQ Three** [manual p.569]: the real device exposes **adjustable crossover frequencies**
  (`FreqLo`/`FreqHi` — e.g. 500 Hz / 2000 Hz splitting low/mid/high) and a **24/48 dB slope
  switch** for how sharply the crossovers cut, plus per-band on/off buttons and LED signal-presence
  indicators, "optimized to sound more like a good, powerful analog filter cascade than a clean
  digital filter" (i.e. the 48 dB mode is deliberately non-linear/colored, part of the device's
  character) [manual p.569]. dotbeat's `eqLow`/`eqMid`/`eqHigh` (`Tone.EQ3`,
  `ui/src/audio/engine.ts`) expose only the three gain knobs — no crossover-frequency control, no
  slope switch. Musically usable, but "1:1" overstates it.
- **Compressor** [manual p.545-549]: beyond Threshold/Ratio/Attack/Release/Mix (which dotbeat has),
  the real device adds an adjustable **Knee** (with a dedicated Transfer Curve display), **3
  lookahead times**, a **Peak/RMS/Expand** mode selector (Expand mode is a genuinely different
  processing type — upward expansion, not compression at all), a **Lin/Log envelope-follower
  shape** switch, an **Auto Release** toggle, and a full sidechain section with its **own EQ**
  (not just gain) [manual p.548]. dotbeat's `compThreshold`/`compRatio`/`compAttack`/
  `compRelease`/`compMix` cover the load-bearing half but not the mode/knee/lookahead half.

**Concrete, cheap opportunity**: the underlying Web Audio `DynamicsCompressorNode` (which
`Tone.Compressor` wraps) already exposes a native `.knee` parameter — this is a genuinely
near-free addition (one new `SynthFieldDef`, one line in `applyParams()`) unlike most of this
doc's other findings, and directly closes part of the Compressor gap above without new DSP.

### 2.4 Utility — dotbeat's version is missing Bass Mono, arguably the most-used sub-feature

[manual p.644-646] Ableton's Utility bundles: per-channel **Phase** invert, a **Channel Mode**
chooser (process only L or only R), **Width** (0-400%), a **Mid/Side** mode as an alternate to
Width, a plain **Mono** switch, **Bass Mono** (converts frequencies below a settable 50-500 Hz
cutoff to mono, with a dedicated **Bass Mono Audition** solo-the-lows toggle), **Gain** (-∞ to +35
dB), **Balance** (pan), **Mute**, and a **DC** offset filter. dotbeat's `utility` insert
(`docs/product-roadmap.md`: "Near-free via Tone.StereoWidener... plus a static utilityGain dB
trim") covers Width and Gain — the two most format-cheap of the eight — but not **Bass Mono**,
which is arguably the single most commonly-reached-for sub-feature of Utility in real mixing
practice (correcting phase-cancellation/thin-bass problems from wide stereo processing upstream is
a near-universal mastering-bus and low-end-track technique). Cheap to add on top of the existing
insert: a `Tone.Filter` (low-pass) summing path below `utilityBassMonoFreq`, mixed to mono,
recombined with the unaffected highs — the same primitive pattern (`Tone.Filter`) already used
throughout `engine.ts`.

### 2.5 Vocoder and Shifter — genuinely missing creative categories, not niche-DSP-tier

Two effects from this chapter represent entire *categories* of sound design with zero coverage in
either research 17 or dotbeat's shipped chain, and unlike Corpus (correctly deferred as
AudioWorklet-tier custom DSP), neither is architecturally out of reach:

- **Shifter** [manual p.624-628] unifies pitch-shift, frequency-shift, and **ring modulation** in
  one device. Ring modulation specifically — "the user-specified frequency amount in Hertz is added
  to and subtracted from the input" [manual p.627] — is one of the cheapest, most distinctive
  creative effects in the whole chapter to build: a `Tone.Gain` node whose gain is driven by an
  audio-rate oscillator (multiplying two signals) is the entire DSP, no dedicated Tone.js class
  needed, no custom AudioWorklet. It produces bell-like/metallic/robotic tones nothing currently in
  dotbeat's chain can approximate (autoFilter/tremolo/phaser are all *amplitude* or *filter*
  modulation, never true ring modulation). Worth flagging as underpriced relative to its creative
  value.
- **Vocoder** [manual p.648-650] is the classic carrier/modulator "talking synthesizer" effect.
  Architecturally harder than Shifter — a vocoder fundamentally needs **two simultaneous audio
  sources** (a modulator track's audio driving the amplitude envelope of a carrier track's or
  internal generator's audio through parallel band-pass filter banks), which doesn't fit dotbeat's
  current one-signal-in-one-signal-out per-track insert model as cleanly as anything else in this
  doc — it needs the same kind of cross-track internal-routing concept External Audio Effect and
  Auto Filter's external sidechain already lean on, just applied continuously rather than as a
  trigger. Not a near-term build, but worth naming explicitly as a known, deliberate gap rather
  than an silent omission, since it's one of the most genre-recognizable effects in electronic
  music and nothing currently in dotbeat's roadmap even gestures at cross-track audio-rate
  routing.

### 2.6 Reverb, Limiter, Multiband Dynamics, Roar, Auto Shift — the mastering/deep-creative tier, correctly out of scope for now

Reading `ui/src/audio/engine.ts` directly this pass confirms dotbeat's reverb and limiter are
deliberately minimal:

- `this.reverbBus = new Tone.Reverb({ decay: 2.2, wet: 1 })` [dotbeat,
  `ui/src/audio/engine.ts:1768`] — one hardcoded shared algorithmic reverb instance, decay only.
  Ableton's **Reverb** [manual p.608-611] has an input filter, early-reflections section (with
  Spin/Shape modulation), a full diffusion network (high/low shelving decay, Diffusion, Scale), an
  internal chorus stage, Freeze/Flat/Cut controls, and a density/CPU tradeoff — and **Hybrid
  Reverb** [manual p.580-586] goes further still (convolution IRs + 5 distinct digital algorithms).
  dotbeat's reverb is real but shallow by comparison.
- `this.masterLimiter = new Tone.Limiter(-1)` [dotbeat, `ui/src/audio/engine.ts:1726`] — a bare
  ceiling limiter. Ableton's **Limiter** [manual p.587-588] adds Link (L/R vs M/S), a Maximize
  mode, Auto Release, 3 lookahead times, and Standard/Soft-Clip/True-Peak ceiling modes
  specifically to catch inter-sample peaks.
- **Multiband Dynamics** [manual p.593-597] and **Glue Compressor** [manual p.576-578] are
  mastering-bus tools with no dotbeat equivalent at all.
- **Roar** [manual p.612-620] is Live 12's newest and by far most elaborate saturation device —
  3 gain stages, 7 routing topologies, 12 shaper curves, a full modulation matrix, an internal
  feedback loop with its own compressor — dwarfing not just dotbeat's Saturator but Ableton's own
  (simpler) Saturator too.
- **Auto Shift** [manual p.527-534] (real-time vocal pitch correction) is a new-in-Live-12 device
  representing an entire category — vocal/monophonic pitch processing — dotbeat has no path into
  at all, for the structural reason that dotbeat has no audio-input/recording capability yet
  (`docs/product-roadmap.md`'s "Native audio recording" row: "gated behind the confirmed ~30ms
  web-audio latency wall — explicitly Tauri/M4-native scope").

None of these are wrong to be missing right now — they're consistent with `ROADMAP.md` §8 M4's
"not started, deliberately" framing and the mastering/native-audio tier generally sitting behind
the Desktop track's priorities. Naming them here is so a future mastering-tier or M4 pass has this
doc as a ready-made shortlist rather than re-deriving it from scratch.

## 3. Relevance to dotbeat — corrections, gaps, and what's correctly prioritized

### 3.1 Three device-naming corrections to research 17

Research 17 explicitly framed its own goal as matching "Ableton's actual device names and
behavior, not generic effect labels" [`docs/research/17-track-fx-arsenal.md`, header]. Now that
the full, current (Live 12) manual text is available instead of partial fetches + secondary
sources, three of its device-identity claims don't hold up against this chapter:

1. **"Ping Pong Delay" is not a standalone Ableton Live 12 device.** Research 17 described it
   throughout as if it were one ("Ping Pong Delay — a single delay buffer, mixed to mono going
   in, alternately routed left/right... Freeze button... Invert switch"). This chapter has no
   `28.X Ping Pong Delay` section at all — ping-pong behavior is a **toggle inside the base Delay
   device** [manual p.558: "Activate the Ping Pong toggle to make the delay signal move back and
   forth between the left and right channels"] and a **channel mode inside Echo**
   [manual p.563: "Channel Mode buttons let you choose between three different modes: Stereo, Ping
   Pong and Mid/Side"]. (A standalone Ping Pong Delay device did exist in earlier Live versions —
   this is a real Live-12-era consolidation, not research 17 inventing something, but it means the
   *current* manual doesn't back the standalone-device framing.) This doesn't diminish dotbeat's
   built Ping Pong Delay insert as a *musically* good addition — if anything, per §2.2, dotbeat's
   version (continuously-variable cross-feed + LFO wobble) is more capable than either of Ableton's
   two current ping-pong implementations — but the "matches Ableton's actual device name" framing
   should be corrected to "matches a mode Ableton offers inside two other devices."
2. **"Simple Delay" is not a current Ableton Live 12 device either.** Research 17 mentioned "the
   older Delay/Simple Delay devices" as still-present prior art for dotbeat's shared delay bus.
   This chapter documents only **Delay** (28.11) — no separate Simple Delay section exists in the
   current manual. (Simple Delay was deprecated in favor of the unified Delay device in an earlier
   Live version; the manual reflects that.) Minor, but worth not repeating.
3. **Phaser and Flanger are not separate standalone devices.** Research 17 said Phaser-Flanger
   exists "rather than Ableton's older, still-present separate Phaser and Flanger devices." This
   chapter has no standalone `28.X Phaser` or `28.X Flanger` section — only the unified
   **Phaser-Flanger** (28.29) [manual p.602: "combines the functionalities of flanger and phaser
   effects into one device with separate modes"]. Same pattern as #1/#2: real devices in Live's
   history, not currently separate in Live 12's own manual. dotbeat's own build (per
   `docs/product-roadmap.md`: "chorusMode/chorusRate/Depth/Mix and phaserRate/Depth/Mix are now
   real per-track inserts") already treats Phaser as its own configurable insert distinct from
   Chorus, which is a reasonable design choice independent of this naming point — just don't cite
   "Ableton still ships them separately" as the reason.

None of these three corrections change any build decision retroactively — the shipped Ping Pong
Delay, Chorus, and Phaser inserts are all musically sound, Ableton-flavored additions regardless of
exactly which current device section they map to. They matter only for citation accuracy in future
research/roadmap docs that reference "Ableton's real device name."

### 3.2 Direct comparison: dotbeat's `EFFECT_TYPES` + fixed inserts vs. all 42 stock effects

| Ableton effect | dotbeat status | Assessment |
|---|---|---|
| EQ Three | ✅ shipped (`eq3`) | Correctly prioritized; parameter surface scoped down vs. real device (§2.3) |
| EQ Eight | ✅ shipped as `eq7` (7-band, additive to eq3) | Reasonable approximation; missing EQ Eight's L/R and M/S stereo-processing modes |
| Channel EQ | — (not separately built; `eq3` covers similar ground) | Low priority — Channel EQ and EQ Three are both simple 3-bands; not worth a third EQ type |
| Compressor | ✅ shipped (`comp`) | Correctly prioritized; missing Knee/Lookahead/mode-select/sidechain-EQ (§2.3) — Knee is a near-free follow-up |
| Glue Compressor | — | Correctly deferred — mastering-bus tier (§2.6) |
| **Gate** | ❌ **missing entirely, from `EFFECT_TYPES` and from research 17's original 13-item list** | **The sharpest gap this pass found (§2.1)** — as fundamental as Compressor/EQ Three, cheaper to build than several already-shipped niche effects |
| Limiter | 🔶 master-bus only, minimal (`Tone.Limiter(-1)`, §2.6) | Fine for now; real depth gap if/when a mastering tier is prioritized |
| Multiband Dynamics | — | Correctly deferred — mastering tier |
| Distortion / Overdrive / Pedal / Dynamic Tube / Drum Buss | ✅ generic `distortion` covers the ballpark | The character-specific variants (band-pass-pre-filtered Overdrive, tube-envelope Dynamic Tube, drum-bus-specific Drum Buss) are real but lower-priority refinements over the one generic waveshaper |
| Saturator | ✅ shipped, scoped down (4 curves vs. Ableton's 8 + Waveshaper mode) | Correctly prioritized; real headroom to deepen later, Roar (§2.6) shows how far this category can go |
| Vinyl Distortion | ✅ shipped | Correctly prioritized (research 17 called this right) |
| Erosion | — | Genuinely absent, low priority — distinct mechanism from bitcrush/Redux but a niche "digital grit" tool, not obviously more valuable than what's shipped |
| Redux (both halves) | ✅ shipped in full (bit-depth on `bitcrush`, downsampling on `bitcrushRate`) | Correctly prioritized and, per §2.3's methodology check, this is one research-17 claim that *does* hold up as accurately spec'd against the manual |
| Amp / Cabinet | — | Correctly out of scope — guitar-specific, no clear fit for dotbeat's synth/drum-centric track model |
| Auto Filter / Auto Pan-Tremolo | ✅ shipped as dedicated inserts | Correctly prioritized (research 17 explicitly noted this buys naming/independence, not new sonic capability — still accurate) |
| Chorus-Ensemble / Phaser-Flanger | ✅ shipped as fixed inserts | Correctly prioritized; §3.1's naming caveat noted, doesn't change the build call |
| Delay (base device) | ❌ **missing as a per-track insert** — only Grain Delay and Ping Pong Delay exist, no plain synced delay (§2.2) | A real gap between two more-specialized delays that *did* ship |
| Echo | — | Absent; Echo's specific "character" tools (Ducking, Wobble, built-in Gate/Noise) are real and distinctive but a bigger lift than base Delay |
| Filter Delay | — | Niche, low priority |
| Grain Delay | ✅ shipped | Correctly prioritized |
| Beat Repeat | ✅ shipped (scheduling-layer, not audio-graph) | Correctly prioritized and correctly architected per research 17 §4.3's own reasoning |
| Looper | — | Correctly out of scope — Session-View-shaped performance tool, ruled out by dotbeat's document-first model (same reasoning as research 30's Session-grid finding) |
| Reverb / Hybrid Reverb | 🔶 minimal shared bus (§2.6) | Real depth gap; lower priority than Gate/base-Delay but worth a dedicated future pass if reverb quality becomes a complaint |
| Utility | ✅ shipped, missing Bass Mono (§2.4) | Correctly prioritized; Bass Mono is a cheap, high-value follow-up |
| Corpus | ❌ explicitly deferred (AudioWorklet-tier) | Correctly deprioritized — the one item research 17 flagged as hardest and it remains hardest |
| Resonators | ✅ shipped | Correctly prioritized |
| Vocoder | ❌ absent, not in research 17 | Genuinely missing category, architecturally hard (cross-track routing, §2.5) — correctly not a near-term build, but should be named as a known gap |
| Shifter (incl. ring mod) | ❌ absent, not in research 17 | Genuinely missing, **architecturally cheap** (§2.5) — underpriced relative to creative value, worth a build slot before Gate's harder cousins |
| Spectral Resonator / Spectral Time | — | Live-12-newest, niche, correctly out of scope |
| Roar | — | Correctly out of scope for now (§2.6); useful ceiling reference for how far Saturator could eventually go |
| Auto Shift | — | Correctly out of scope — blocked on native audio recording (M4), not a prioritization miss |
| Spectrum | — (not an "effect" — a visualizer, per the manual's own framing) | **Directly maps to `docs/product-roadmap.md`'s "GUI spectrum / level visualization" row, currently ⬜ Not started** — Ableton's Spectrum device is effectively the reference UX for that exact roadmap item; worth citing when that row is picked up |
| Tuner | — (not an "effect") | No dotbeat use case without live instrument/mic input |
| External Audio Effect | — | Not applicable — dotbeat has no hardware I/O concept |

### 3.3 Concrete, actionable recommendations, ranked

1. **Add Gate as a new `EffectType`.** The single clearest gap (§2.1) — as fundamental as
   Compressor, absent from both research 17's scope and the shipped chain, buildable with the same
   envelope-follower primitives the existing `comp` insert already uses. No new Tone.js class
   needed.
2. **Add a plain, tempo-synced Delay insert distinct from Grain Delay/Ping Pong Delay.** (§2.2)
   dotbeat shipped the two more specialized delays but not the one Ableton users reach for most
   often. `Tone.FeedbackDelay` (already used for the shared bus) is the right primitive, wired as a
   genuine per-track insert with document-driven time/feedback/filter instead of the current
   hardcoded shared bus.
3. **Add `compKnee` to the existing Compressor insert.** (§2.3) Near-free — the underlying
   `DynamicsCompressorNode` already exposes `.knee` natively; this is one `SynthFieldDef` and one
   line in `applyParams()`, not new DSP.
4. **Add Bass Mono to the existing Utility insert.** (§2.4) Cheap (`Tone.Filter` + a mono-sum path
   below a cutoff, the same pattern already used throughout `engine.ts`), and closes the gap on
   Utility's most commonly-used real-world sub-feature.
5. **Consider Shifter's ring-modulation mode as a future creative-effect build.** (§2.5) Cheapest
   of the "genuinely missing category" findings — no dedicated Tone.js class needed, just an
   audio-rate-oscillator-driven `Tone.Gain`. Distinct sonic territory nothing else in the chain
   reaches.
6. **Name Vocoder as a known, deliberate gap, not a silent one.** (§2.5) Don't build it soon — it
   needs cross-track audio routing dotbeat's per-track insert model doesn't cleanly support yet —
   but it's genre-recognizable enough to be worth a line in the roadmap rather than staying
   unmentioned.
7. **Correct research 17's three device-naming claims if that doc is ever revised** (§3.1) — Ping
   Pong Delay, Simple Delay, and separate Phaser/Flanger are not standalone Live 12 devices per the
   current manual. Doesn't change any build decision, only future citation accuracy.
8. **When the roadmap's "GUI spectrum / level visualization" row (`docs/product-roadmap.md`, ⬜ Not
   started) gets picked up, cite Ableton's Spectrum device [manual p.638] as the reference UX** —
   linear/log/semitone frequency scaling, Block-size/Refresh/Avg accuracy-vs-CPU tradeoffs, and the
   max-hold overlay are all concrete, transferable ideas for that exact feature.
9. **Reverb depth (§2.6) is real but lower priority than 1-6** — flag for a dedicated future pass
   if/when reverb quality becomes a specific complaint, rather than speculatively building Hybrid
   Reverb-level complexity now.

## Sources

Ableton Live 12 Reference Manual, chapter 28 "Live Audio Effect Reference," pp. 513-651 (local
extract: `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-chapters/ch28.txt`, `pdftotext
-layout` output of `prior_art/`'s gitignored manual PDF — not web-sourced this pass). Cross-checked
against dotbeat's own source read directly this pass: `src/core/document.ts` (`EffectType`,
`EFFECT_TYPES`, `SYNTH_FIELDS`), `ui/src/audio/engine.ts` (`reverbBus`, `masterLimiter`,
`compThreshold`/`compRatio` wiring), `docs/product-roadmap.md` ("Extended FX arsenal" and other
sections), `ROADMAP.md`, `docs/decisions.md`, and `docs/research/17-track-fx-arsenal.md` (the prior
pass this doc checks).
