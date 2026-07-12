# Research 68 — Ableton Live 12 instrument catalog vs. dotbeat's single synth-chain: a direct feature/UI comparison

*2026-07-12. Companion to [`docs/research/49-ableton-instrument-reference.md`](49-ableton-instrument-reference.md)
(the grounded primer + full 13-instrument inventory of manual ch.30, pp.665-784 — read first if you
haven't). That pass built the inventory and went deep on individual conventions; this pass is
narrower and more decision-oriented: a direct, structured comparison table between Ableton's
per-instrument catalog and dotbeat's one-chain-fits-all architecture, grounded in a second visual
pass over 20 of the chapter's actual instrument-UI screenshots (`ableton-images/ch30/*.jpg`,
p.665/671/677/683/689/695/701/707/713/719/725/731/737/743/749/755/761/767/773/779 — every stock
instrument's Global/Filter/Envelope/Matrix/Unison section is represented at least once), plus a
fresh full read of `ui/src/audio/engine.ts` (`buildSynthChain`/`applyParams` at
`engine.ts:2146-2327`, `EngineSynth`/`coerce` at `engine.ts:171-382`, drum voices at
`engine.ts:1904-1963`, instrument tracks at `engine.ts:2459-2548`) and `ui/src/components/synthParams.ts`
(all 20 `PARAM_GROUPS`, `engine.ts:122-462` — cross-file line numbers below are `synthParams.ts`
unless marked `[engine.ts]`). Nothing here contradicts `ROADMAP.md`, `docs/decisions.md`, or
`docs/product-roadmap.md` — every priority below is checked against `docs/product-roadmap.md`'s
existing "Synth sound design" / "Extended FX arsenal" / "Instrument / SoundFont tracks" rows so this
doc doesn't re-propose anything already Done, already Not-started-and-scoped, or already decided
against (e.g. filter-circuit modeling, a full modulation matrix — both explicitly out of scope per
research 49 §4 and D1's MIT-license/GPL-engine-closed constraint).

**Ground rule for this doc**: dotbeat is **one flexible synth chain** — a single `SynthChain` per
synth track (additive oscillator bank: `synth`/`osc2`/`osc3`/4 `uniPairs`/`sub`/`noise`/`fm`, one
shared `Tone.Filter`, one shared envelope set — `engine.ts:2146-2231`) shaped by `.beat`'s ~54
`SYNTH_FIELDS`. Ableton ships **13 separate instruments**, each its own synthesis method. The
comparison below is deliberately scoped to the three Ableton instruments that are dotbeat's actual
structural peers — **Drift** (2-osc subtractive), **Operator's FM layer** (dotbeat's FM voice is a
single-layer analog of one Operator algorithm), and **Wavetable** (dotbeat has the field names,
not the oscillator) — with the sample-playback family (Sampler/Simpler/Drum Sampler/Impulse) and
the physical-modeling family (Analog/Collision/Electric/Tension/Meld) referenced only where they
sharpen a specific gap or a specific do-not-chase call.

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity — dotbeat's single synth chain vs. Drift / Operator's FM layer / Wavetable

| Dimension | dotbeat (one chain) | Ableton instrument | Parity verdict |
|---|---|---|---|
| Oscillator topology | Main osc + osc2 + osc3 + 4 detuned unison pairs + sub + noise + FM layer, all summed into one filter — `engine.ts:2169-2205` | Drift: 2 oscillators + noise generator into one filter [manual p.685-686, screenshot p.683] | **Real parity at the core**: dotbeat's `synth`+`osc2`+`noise`→`filter` signal path (`engine.ts:2198-2203`) is structurally identical to Drift's Osc1+Osc2+Noise→Filter block. dotbeat's osc3/uniPairs/sub/fm are additive extensions Drift doesn't have as separate layers (it gets equivalent thickness from its Unison voice mode instead). |
| Filter | One `Tone.Filter` (native biquad), enum `lowpass`/`bandpass`/`highpass`, `cutoff`/`resonance` knobs plus a full filter ADSR (`filterEnvAmount/Attack/Decay/Sustain/Release`) — `synthParams.ts:157-169` | Drift: one dynamic filter, Type I/II circuit choice, `Freq`/`Reso` + envelope-amount knob [manual p.685-686, screenshot p.683] | **Parity on shape** (single filter + full ADSR + envelope amount), **gap on circuit modeling** (see 1b #8 — deliberately not chased). |
| Amp envelope | Standard ADSR, one-shot, no loop — `synthParams.ts:160-163` | Drift: Envelopes 1/2 section, same four-stage ADSR as the baseline case [manual p.683 screenshot] | **Parity at the simple case** — both are a plain one-shot ADSR when loop/sync modes aren't engaged. dotbeat has no loop mode at all (1b #10). |
| LFO | 2 LFOs, 15-destination enum (`pitch/cutoff/resonance/amp/pan/wtPos/sendReverb/sendDelay/eqLow/eqMid/eqHigh/compMix/distortionMix/bitcrushMix`), tempo-sync with 12 note divisions — `synthParams.ts:82-98, 172-190` | Drift's LFO section: 1 LFO, 9 waveform choices (incl. Sample & Hold, Wander, two envelope shapes), Retrig, Delay/Attack ramp-in [manual p.671 screenshot, p.689] | **Partial parity**: dotbeat wins on destination breadth (15 named targets incl. FX sends/mix knobs, vs. Drift routing through its separate 3-slot Mod section); Drift wins on LFO *shape* variety (9 waveforms incl. S&H/Wander/envelope-shapes vs. dotbeat's `sine`/`custom` only, `synthParams.ts:183`) and per-LFO delay/attack ramp-in, which dotbeat has no equivalent of. |
| FM | One always-on FM layer (`Tone.FMSynth`), 2 knobs (`fmHarmonicity`, `fmModIndex`) plus a level fader mixed alongside the oscillator bank — `synthParams.ts:142-144`, `[engine.ts:2186]` | Operator: 4 operators, 11 selectable algorithms, per-oscillator Coarse/Fine/Fixed/Feedback [manual p.716-717, screenshot context p.719/725/731] | **Parity only at "one modulator, one carrier"** — dotbeat's FM layer is roughly equivalent to Operator's simplest 2-operator algorithm with no Fixed/Feedback control. Full multi-algorithm FM is a real, acknowledged gap (1b #4). |
| Wavetable | Format fields exist (`wtTable` enum `analog/pwm/vocal/custom`, `wtPos` 0-1, LFO-targetable) — `synthParams.ts:130-131` | Wavetable: 2 scannable wavetable oscillators + sub + FM/Classic/Modern osc effects + dual filter + full mod matrix [manual p.775-779] | **Surface-level UI parity only — the knob exists, the oscillator doesn't.** `OSC_SET` is `sine/triangle/sawtooth/square` (`[engine.ts:311]`); `wtPos` has nothing to scan. This is dotbeat's single sharpest, lowest-ambiguity gap (1b #1) — already flagged in `docs/product-roadmap.md`'s "Synth sound design" row and `ROADMAP.md` §9's v1 inventory. |
| Unison/voice-stacking | Continuous `unisonVoices` (1-7) + `unisonWidth`, 4 fixed detune-ratio pairs, always on osc2's waveform — `synthParams.ts:145-146`, `[engine.ts:2176-2181]` | Drift: Voice Mode = Unison (1 of 4 named modes), fixed 4 voices, Unison Strength [manual p.690]; Wavetable: 6 *named* unison algorithms (Classic/Shimmer/Phase Sync/etc.) [manual p.783] | **Parity in spirit, different shape** — dotbeat is *more granular* on voice count (continuous 1-7 vs. Ableton's small-discrete choices) but has no named-algorithm variety (1b #7). |
| Insert effects on the voice | 12 reorderable chain-member effect types (EQ3/comp/distortion/bitcrush/eq7/autoFilter/autoPan/tremolo/utility/grainDelay/vinylDistortion/resonator) plus 5 fixed inserts (saturator/chorus/phaser/pingPong/beatRepeat) — `synthParams.ts:208-434` | No Ableton instrument bundles this much processing *inside the instrument itself* — Drift/Operator/Wavetable's own onboard sections stop at osc/filter/env/LFO/mod; EQ/comp/delay/etc. are separate devices in Live's chain. Drum Sampler is the outlier with 9 bundled "playback effects" [manual p.691-694] | **dotbeat is ahead here, not behind** — see 1c. Worth naming under "shared features" only to make clear this isn't a gap to close. |
| Velocity → amp | `Tone.PolySynth`'s built-in velocity-to-gain scaling, automatic on every note — `[engine.ts:3040-3048]` | Every Ableton instrument scales amp by velocity by default too (Vel > Vol shell field appears on nearly all 13, e.g. Simpler's `Vel>Vol` [manual p.761 screenshot]) | **Parity at the default case.** The gap is *depth* (per-parameter velocity, not just amp) — see 1b #11. |

### b) In Ableton, not in dotbeat

Every row here was checked against `.beat`'s actual `SYNTH_FIELDS` (`synthParams.ts`) and
`ui/src/audio/engine.ts`'s real signal graph — confirmed absent by reading the code, not inferred.

| # | Feature | Ableton citation | Confirmed absent in dotbeat |
|---|---|---|---|
| 1 | Real wavetable oscillator (2D lookup-table + scan position, oscillator effects: FM/Classic-PWM-sync/Modern-warp-fold) | Wavetable §30.13 [manual p.775-778] | `wtTable`/`wtPos` exist as fields (`synthParams.ts:130-131`) but `OSC_SET` has no wavetable type — `[engine.ts:311]` |
| 2 | FM fixed-frequency oscillator mode (per-osc "ignore note pitch, play a constant Hz" — inharmonic/metallic/drum FM) | Operator §30.9.2.3, §30.9.10.6 [manual p.719, p.731] | No `fixed`/`fixedFreq` field anywhere in `EngineSynth` (`[engine.ts:171-309]`) or `SYNTH_FIELDS` |
| 3 | Oscillator self-feedback (an unmodulated FM operator modulates itself for noisier/richer single-op tones) | Operator §30.9.2.3, §30.9.10.6 [manual p.719-720, p.731] | dotbeat's FM layer exposes only `fmHarmonicity`/`fmModIndex`/`fmLevel` — `synthParams.ts:142-144` |
| 4 | Multi-operator FM with selectable algorithms (4 operators, 11 routings determining modulator/carrier relationships) | Operator §30.9 [manual p.716-717] | dotbeat's FM is one fixed layer mixed additively into the osc bank — `[engine.ts:2186, 2301, 2306]` — no algorithm concept exists |
| 5 | True monophonic voice mode with legato (Mono/Voices=1 — overlapping notes retrigger pitch only, envelope doesn't restart) | Drift Mode chooser [manual p.690]; Operator Voices=1 legato note [manual p.725] | Every dotbeat oscillator layer (`synth`, `osc2`, `osc3`, all 4 `uniPairs`, `sub`, `noise`, `fm`) is independently a `Tone.PolySynth` — `[engine.ts:2169, 2170, 2173, 2181, 2182, 2186]`. No mono/legato anywhere (confirmed: no `mono`/`legato`/`voiceMode` field in `engine.ts` or `document.ts`). |
| 6 | Dedicated Stereo voice mode (2 fixed voices hard-panned L/R, no detune, cheaper than unison) | Drift Mode chooser [manual p.690] | dotbeat's stereo width for a voice only comes from continuous `unisonVoices`≥3 panning (`synthParams.ts:145-146`) — no zero-detune stereo-only mode |
| 7 | Named unison algorithms (Classic/Shimmer/Noise/Phase Sync/Position Spread/Random Note — each a qualitatively different stacking behavior) | Wavetable Unison [manual p.783] | dotbeat's unison is one fixed algorithm (4 hardcoded detune-ratio pairs, `[engine.ts:2176-2181]`) that only scales in voice count/width |
| 8 | Filter circuit modeling (Cytomic Clean/OSR/MS2/SMP/PRD — licensed DSP models reused across 5 instruments) | Drift §30.3.3 [manual p.686]; also Operator p.723, Sampler p.748, Simpler p.758, Wavetable p.777-778 | dotbeat's filter is a plain `Tone.Filter` native biquad, no circuit/drive stage — `synthParams.ts:157-159` |
| 9 | Dual/parallel/split filter routing (2 filters per voice, oscillators independently routable) | Wavetable §30.13.4 [manual p.778-779]; Analog Quick Routing [manual p.672-673]; Meld [manual p.713 screenshot] | dotbeat has exactly one filter shared unconditionally by every oscillator layer — `[engine.ts:2198-2205]` |
| 10 | Envelope loop modes (Loop/Trigger/Beat/Sync, or AD-R/ADR-R/ADS-R) — rhythmic/looping envelope behavior while a key is held | Analog §30.1.7 [manual p.671 screenshot]; Operator [manual p.732]; Sampler [manual p.743, 749]; Wavetable [manual p.780-781] — appears on 5+ instruments, the chapter's single most-repeated convention | dotbeat's ADSR (`attack`/`decay`/`sustain`/`release` + parallel `filterEnv*`) is a strict one-shot every time — `synthParams.ts:160-168`, no loop-mode enum |
| 11 | Per-parameter Velocity/Key modulation sliders (nearly every knob, not just filter/amp, carries its own Vel/Key slider) | Universal — Analog [manual p.667-669]; Operator, 9 instances in one instrument [manual p.729-731]; Tension [manual p.765-769] | dotbeat has exactly 2 hardcoded single-destination knobs: `velToFilterAmount` (filter cutoff only) and `keytrackAmount` (filter cutoff only) — `[engine.ts:3049-3055]` |
| 12 | Full N×M modulation matrix (any envelope/LFO source to any parameter target, additive or multiplicative) | Wavetable Matrix Tab [manual p.779 screenshot]; Meld Expanded View [manual p.707 screenshot] | dotbeat has 2 LFOs each with one destination enum slot (`synthParams.ts:82-98`) — no general source×target grid |
| 13 | Physical-modeling instrument family (real-time solved-DSP resonators/strings/electric-piano mechanics, no sampling/wavetables at all) | Analog [manual p.665-666]; Collision [manual p.674-677]; Electric [manual p.696-701]; Tension [manual p.763-773] | Architecturally absent — dotbeat's engine is Tone.js/Web-Audio additive-oscillator, not solved-differential-equation DSP |
| 14 | Macro-oscillator hybrid engine (2 independent 24-type oscillator engines, scale-aware oscillators, per-type macro knobs) | Meld §30.8 [manual p.706-707, 713] | No equivalent — dotbeat's oscillator "types" are the fixed 4-waveform `OSC_SET` |
| 15 | Full multisampling instrument: key/velocity/round-robin zones, dedicated Zone Editor view | Sampler §30.10 [manual p.734-738 screenshots] | dotbeat's instrument tracks are plain SF2 GM program playback — `programChange` only, no zones — `[engine.ts:2459-2492]` |
| 16 | Round Robin sample playback (cycle through N samples per repeated trigger, for de-robotifying repetitive patterns) | Sampler §30.10.5.1 [manual p.737 screenshot] | No equivalent at any layer (drum lanes, instrument tracks, or the variation-loop) |
| 17 | Complex/Complex-Pro time-stretch warping + transient-detected Slicing playback mode | Simpler §30.11 [manual p.755] | dotbeat's audio clips ship repitch-only warping (`rate` field via `Tone.Player.playbackRate`) — already an honest, tracked gap: `docs/product-roadmap.md`'s "Warp markers + Complex-mode stretch" and "Beats-mode transient slicing" rows, both ⬜ Not started, both already scoped in research 25/26 |
| 18 | Drum-instrument-grade per-sample shaping: AHD envelope + one filter + 9 dedicated playback effects (Stretch/Pitch Env/Punch/8-Bit/FM/Ring Mod/Sub Osc/Noise) bundled with every one-shot | Drum Sampler §30.4 [manual p.691-695 screenshots] | dotbeat's drum lanes are procedural synths (`MembraneSynth`/`NoiseSynth`/`MetalSynth`) — `[engine.ts:1908-1928]` — no sample-slot lane exists at all yet; already tracked as ⬜ Not started in `docs/product-roadmap.md`'s "One-shot sampler instrument track kind" row |
| 19 | MPE (MIDI Polyphonic Expression) support | Analog shell explicitly labeled "MPE" [manual p.665 screenshot]; Drift "fully MPE-capable" [manual p.683] | No `MPE` string anywhere in `engine.ts` or `document.ts` (checked directly) — no per-note pitch-bend/pressure/timbre channel model |
| 20 | Per-voice analog-modeling randomization ("Drift" knob — subtle per-voice pitch/cutoff jitter, distinct from unison detune) | Drift's signature control [manual p.690] | dotbeat's oscillators are perfectly deterministic; no jitter/randomization field in `SYNTH_FIELDS` |
| 21 | External Instrument (MIDI-out/audio-return routing to hardware synths or multitimbral plug-ins, with latency compensation) | External Instrument §30.6 [manual p.702] | No hardware MIDI I/O routing anywhere — out of scope for the current web/Tauri-local architecture, not a synth-chain gap |

### c) In dotbeat, not in Ableton

- **One document, one diff, every instrument's worth of parameters.** Because dotbeat has no
  separate-instrument concept, `.beat set trk_lead.fmModIndex 12` and
  `.beat set trk_lead.cutoff 900` are the *same kind of edit* — a one-line diff on the same track.
  Ableton's equivalent ("swap Operator for Wavetable on this track") is a structurally different,
  much larger operation (device replacement, patch loss) with no Ableton text-diff analog at all.
  This is dotbeat's actual competitive axis (per `ROADMAP.md` §1's thesis) — not a feature to add,
  the reason the format exists.
- **12-slot reorderable insert-effect chain wired directly into the same panel as the oscillator/
  filter/LFO controls**, with per-track bypass and CLI/MCP parity — `synthParams.ts:208-428`,
  `docs/product-roadmap.md`'s "Extended FX arsenal" section (11 of 12 rows ✅ Done). No single
  Ableton *instrument* bundles this much processing internally; Drum Sampler's 9 playback effects
  come closest but are drum-one-shot-scoped, not general-purpose (EQ7/Grain Delay/Vinyl
  Distortion/Resonators/Ping Pong/Beat Repeat/Chorus-Ensemble/Phaser-Flanger/Saturator/Auto
  Filter/Auto Pan/Tremolo/Utility — none of which live inside Wavetable, Operator, or Drift's own
  device).
- **CLI + MCP parity on every synth param, always.** Every knob in `PARAM_GROUPS` is reachable via
  `beat set <track>.<key>` / `beat_set` through the exact same code path a GUI knob-turn uses
  (`synthParams.ts`'s own header comment: "the actual edit path is `<track>.<key>` via POST
  /edit... adding a param here needs no other change"). Ableton has no scriptable/text equivalent
  for its instrument parameters at all (the `01-landscape.md` finding that `.als` isn't cleanly
  text-native even decompressed, `ROADMAP.md` §1).
- **Canonical elision — the file only states params that differ from default** (D9,
  `docs/decisions.md`). A dotbeat init patch is 9 lines; every present line is a deliberate sound
  decision. Ableton's `.als` has no equivalent readable-diff property even in principle (§1's table).
- **Deterministic, git-diffable variation.** `beat vary --scope selection` generates parameter-grid
  variants of the *exact same* synth-chain params covered in 1(a)/1(b) as one-line diffs, auditioned
  and kept/undone (`docs/product-roadmap.md`'s "Vary / audition loop" row, ✅ Done). Ableton has no
  batch-variation tooling for an instrument's own parameters at all.
- **Tempo-synced LFO destinations that include FX-chain mix/gain knobs**
  (`sendReverb`/`sendDelay`/`eqLow`/`eqMid`/`eqHigh`/`compMix`/`distortionMix`/`bitcrushMix` are
  all real `LFO_DESTS` entries, `synthParams.ts:82-98`) — routing an LFO into a compressor's wet
  mix or a bitcrusher's crush amount is a first-class destination in dotbeat's enum, not something
  any single Ableton instrument's own LFO section reaches (Ableton's per-instrument LFOs target
  osc/filter/amp; reaching a *separate effect device's* mix knob needs Live's own device-level
  modulation/macro system, a different layer entirely).

---

## 2. Prioritized recommendations

Priorities: **P0** = build next, highest leverage / lowest ambiguity. **P1** = clear value, real but
bounded cost. **P2** = real, lower urgency or bigger lift. **Do-not-recreate** = deliberately out of
scope (architecture mismatch, licensing wall, or contradicts an existing product decision).

| # | Feature | Priority | Build recommendation |
|---|---|---|---|
| 1 | Real wavetable oscillator | **P0** | Already scoped in `docs/research/49-ableton-instrument-reference.md` §4 rec #1 and flagged in `docs/product-roadmap.md`'s "Synth sound design" row — this pass concurs and doesn't re-derive it. Minimum spec: a small table-per-category library matching the existing 4-value `wtTable` enum (`synthParams.ts:130`), linear-interpolated scan across `wtPos`, as a `PolySynth`-compatible custom oscillator (a `Tone.ToneOscillatorNode` subclass reading a `Float32Array` table per frame) or an `AudioWorkletProcessor` if `PeriodicWave`-per-frame proves too CPU-heavy for live scanning. Land it as a new `OscType` value (`osc`/`osc2Type` gain a `'wavetable'` option, `[engine.ts:311]`) rather than a parallel osc bank, so it inherits the existing envelope/unison/LFO plumbing for free. |
| 2 | FM fixed-frequency mode | **P1** | One `fmFixed` bool + `fmFixedFreq` Hz field on the FM layer, mirroring the pattern dotbeat's own drum-voice params already use for hardcoded Hz values (`kickTune`, `synthParams.ts:452`). In `engine.ts:2301` (`chain.fm.set({...})`), branch: if `fmFixed`, call `chain.fm.set({ frequency: p.fmFixedFreq })` and skip the note-pitch-driven frequency Tone.PolySynth normally applies (needs a small custom trigger path, since `Tone.FMSynth` inside a `PolySynth` normally derives frequency from the MIDI note — likely means moving the FM layer off `PolySynth`'s automatic pitch handling for this one case, e.g. via `set()` on `detune`/`frequency` right before each `triggerAttack`). |
| 3 | FM self-feedback | **P1** | `Tone.FMSynth` doesn't expose a native feedback param, but a 1-2 line addition works: patch a small feedback gain from the FM layer's own output back into its modulator input (a `Tone.Gain` inserted between `fm`'s modulator stage and its own output — needs either dropping to `Tone.FMOscillator`'s lower-level API or approximating feedback via a `Tone.FeedbackDelay` with near-zero delay time as a cheap stand-in). Cheapest real version: one new `fmFeedback` knob (0-1) in the `osc` `ParamGroup` (`synthParams.ts:122-150`) next to `fmModIndex`. |
| 4 | Multi-operator FM / algorithm routing (Operator-style) | **P2** | Real value but a genuine rewrite of the FM layer, not a param addition — would mean 2-4 independently-tunable FM operators with a selectable routing graph, replacing the current single `Tone.FMSynth` (`[engine.ts:2186]`) with a custom operator graph (likely hand-built oscillator+gain nodes rather than `Tone.FMSynth`, since Tone's built-in only does 2-operator FM). Sequence after the wavetable oscillator (#1) — don't compete for the same design-and-review cycle. |
| 5 | Mono/Legato voice mode | **P1** | Add a `voiceMode` enum (`poly`/`mono`/`legato`) to `SYNTH_FIELDS`. Implementation is a real architectural change to `buildSynthChain` (`[engine.ts:2146]`): every oscillator layer is currently an independent `Tone.PolySynth` (`[engine.ts:2169-2186]`), so mono mode needs either (a) capping `Tone.PolySynth`'s `maxPolyphony` to 1 per layer (cheapest, but loses true legato — envelope still retriggers) or (b) a real monophonic voice-stealing note tracker in the scheduler (`tick()`, around `[engine.ts:3040-3055]`) that suppresses envelope retrigger when a new note arrives while another is held, matching Operator's documented "notes are played legato... envelopes will not be retriggered" behavior [manual p.725]. Worth doing properly (b) — this is the single most-requested-feeling gap for lead/bass patch character per research 49 §4 rec #6. |
| 6 | Stereo voice mode | **P2** | Smaller than #5: a `voiceMode: 'stereo'` value using the *existing* `osc2Pan`/`osc3Pan` panner infrastructure (`[engine.ts:2199-2200, 2292-2293]`) at fixed hard-L/R with zero detune, reusing plumbing rather than adding new nodes. Sequence after #5 since they likely share the same enum field. |
| 7 | Named unison algorithm variety | **P2** | Lower priority — dotbeat's continuous `unisonVoices`/`unisonWidth` already covers most of the practical ground (research 49 §4 rec #6 agrees: "not urgent"). If picked up, cheapest first target is Wavetable's "Shimmer" (randomized per-voice pitch jitter) since it's a small addition to the existing `uniPairs` detune-ratio table (`[engine.ts:2176-2181]`) — a per-voice random-walk on `mul` rather than the fixed ±1.6/±2.4 constants. |
| 8 | Filter circuit modeling (Cytomic Clean/OSR/MS2/SMP/PRD) | **Do-not-recreate** | Confirmed out of scope by research 49 §4 rec #7 and this pass: licensed, bespoke DSP Ableton built once and reused 5×; `docs/decisions.md`'s D1 (MIT license, GPL engines closed) makes an equivalent bespoke filter circuit a real DSP-research project, not a param-table addition. dotbeat's native `Tone.Filter` biquad stays the baseline. |
| 9 | Dual/parallel/split filter routing | **P2** | Bigger lift than the wavetable oscillator itself (research 49 §4 explicitly flags this as not-near-term). If ever built: add a second `Tone.Filter` instance to `SynthChain` (`[engine.ts:2226-2230]`'s return object) and a `filterRouting` enum (`series`/`parallel`/`split`) controlling whether osc3/uniPairs feed filter 1 or filter 2 — straightforward once the wavetable oscillator (#1) and multi-osc layer count are stable, not before. |
| 10 | Envelope loop modes (Loop/Trigger/Beat/Sync) | **P1** | Already scoped concretely by research 49 §4 rec #4: `envLoopMode` enum (`off`/`loop`/`trigger`/`syncBeat`) + `envLoopRate` reusing the existing `LFO_SYNC_RATES` tempo-division list (`synthParams.ts:108`) and its Hz-conversion helper (`lfoSyncDivisionSeconds`, `[engine.ts:~150-161]`). Cheap because the tempo-sync machinery already exists for the LFOs — this is mostly wiring the amp/filter envelope's own retrigger-after-N-beats logic into `tick()`'s note-scheduling loop, not new DSP. |
| 11 | Per-parameter Velocity/Key modulation (generalized destinations) | **P0** | The single largest modulation-flexibility gap per research 49 §4 rec #3, and architecturally cheap: dotbeat already has the "flat enum of named destinations + one amount slider" pattern working twice for `LFO_DESTS` (`synthParams.ts:82-98`, `172-190`). Extend the identical pattern to a `velDest`/`velAmount` pair (and `keyDest`/`keyAmount`) reusing the *same* destination list, replacing today's two single-hardcoded-target fields (`velToFilterAmount`, `keytrackAmount` — `[engine.ts:3049-3055]`). Implementation lands in the same per-note dispatch block that already computes `keytrackMult`/`velMult` (`[engine.ts:3053-3054]`), generalized to a destination switch instead of a fixed cutoff multiply. |
| 12 | Full N×M modulation matrix UI | **Do-not-recreate (near-term)** | Explicitly out of scope per research 49 §4 and consistent with `ROADMAP.md` §9's own framing of dotbeat's LFO system as "deliberately literal/enumerated, not a free-routing matrix." #11 captures most of the practical value (velocity/key as real modulation sources) without the UI complexity of a general-purpose grid editor. Revisit only if #11 ships and users hit its ceiling. |
| 13 | Physical-modeling instrument family (Analog/Collision/Electric/Tension) | **Do-not-recreate** | Architecturally a different bet — real-time solved-differential-equation DSP, not a param table on Tone.js oscillators. No incremental path from `SYNTH_FIELDS`. Confirmed non-goal in research 49 §4's own "What NOT to chase." |
| 14 | Macro-oscillator hybrid engine (Meld-style) | **Do-not-recreate** | Same reasoning as #13 plus #12 (needs its own mod matrix) — a whole second synthesis paradigm, not a bounded feature. No roadmap pressure for it. |
| 15 | Full multisampling instrument (Sampler-style zones/round-robin/Zone Editor) | **P2** | `docs/product-roadmap.md` already has a scoped, smaller alternative ("One-shot sampler instrument track kind," ⬜ Not started, research 21) that deliberately targets a leaner shape than this. Don't build Sampler's full zone-editor stack — if multisampling depth is ever wanted, extend the leaner one-shot sampler with key-range zones incrementally rather than building a Zone Editor view from scratch. |
| 16 | Round Robin sample playback | **P2** | Low cost once any sample-slot drum voice exists (#18): cycle through N registered samples per lane keyed by a simple hit counter, no new format concept beyond an array of sample refs per lane instead of one. Not worth building standalone before #18 lands — there's nothing to round-robin *between* yet. |
| 17 | Complex/Complex-Pro warp + transient Slicing | **P1** (already scoped, not re-derived here) | `docs/product-roadmap.md`'s "Warp markers + Complex-mode stretch" and "Beats-mode transient slicing" rows are both ⬜ Not started but already have concrete build plans (`docs/research/25-audio-warp-markers-stretch.md`'s `signalsmith-stretch` WASM binding + marker grammar; `docs/research/26-beats-mode-transient-slicing.md`'s dependency-free TS energy-detector MVP). This doc's contribution is just confirming the Ableton-manual framing lines up (Simpler's Complex/Complex Pro modes, `[manual p.755]`) — defer to those two docs for the actual build spec. |
| 18 | Drum-sampler voice type (real sample + AHD envelope + filter + playback effects per lane) | **P0** | Already flagged in `docs/decisions.md`'s Tier 2 sound-quality strategy as "the biggest single 'video game music' tell left," and research 49 §4 rec #5 scopes the target concretely: Drum Sampler's surface (Start/Length/Gain, one AHD-ish envelope, one filter, a short list of cheap playback effects — `[manual p.691-695]`), NOT Sampler's full multisampling stack. Maps directly onto dotbeat's existing per-lane drum-voice param groups (`kickTune`/`kickDecay` etc., `synthParams.ts:447-460`) — add a `sample`-backed lane type alongside the existing `synth`/`sample`/`sf` backings the v0.10 open lane model already declares (`docs/product-roadmap.md`'s "Open per-track lane model" row), with envelope/filter/playback-effect fields riding the same `setLaneParam` primitive that lane's synth params already use. |
| 19 | MPE support | **P2** | Real Ableton parity item (Drift/Analog both MPE-capable per the manual) but needs per-note pitch-bend/pressure/timbre channels — a scheduling-layer change (`tick()`'s note dispatch, `[engine.ts:~3200-3250]`) plus a MIDI-input capture path dotbeat doesn't have yet at all (no hardware MIDI I/O exists in the codebase currently). Gate behind real MPE-hardware usage showing up as a request — speculative build otherwise. |
| 20 | Per-voice analog-modeling randomization ("Drift" knob) | **P2** | Cheap once picked up: one `voiceDrift` knob (0-1) applying small per-voice-instance pitch/cutoff jitter at note-on, seeded like the existing seeded-RNG conventions (`beatRepeatChance`'s per-position seed, `src/core/chance.ts`'s `mulberry32`) so renders stay reproducible. Real character-adding value for analog-feel patches, but purely a "nice to have" — no roadmap pressure naming it. |
| 21 | External Instrument (hardware MIDI-out/audio-return routing) | **Do-not-recreate** | Out of scope for the current architecture — this is native MIDI hardware I/O with latency compensation, squarely M4/Tauri-native territory (`docs/decisions.md`'s D3, `ROADMAP.md` §6) and not a synth-chain param at all. Revisit only alongside M4's native audio work, never as a web-tier feature. |

---

## Sources

Ableton Live 12 Reference Manual, Chapter 30 "Live Instrument Reference," pp. 665-784 — visual pass
over 20 rendered page images (`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch30/`:
p-665, p-671, p-677, p-683, p-689, p-695, p-701, p-707, p-713, p-719, p-725, p-731, p-737, p-743,
p-749, p-755, p-761, p-767, p-773, p-779.jpg) plus targeted text lookups against `ch30.txt` for page
citations. dotbeat internal (read directly this pass): `ui/src/audio/engine.ts`
(`buildSynthChain`/`applyParams` 2146-2327, `EngineSynth`/`coerce` 171-382, `EffectType` union
525-537, drum voices 1904-1963, instrument-track build/sync 2455-2548, velocity/keytrack dispatch
3040-3055), `ui/src/components/synthParams.ts` (full `PARAM_GROUPS`, all 20 groups), `ROADMAP.md`
§9, `docs/product-roadmap.md` ("Synth sound design," "Extended FX arsenal," "Instrument / SoundFont
tracks," "Audio-region clip editing" sections), `docs/decisions.md` (D1, D9, D15), and
`docs/research/49-ableton-instrument-reference.md` (prior grounded primer this pass builds on
without re-deriving).
