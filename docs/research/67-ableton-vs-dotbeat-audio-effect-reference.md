# Research 67 — Ableton Live 12 audio effects vs. dotbeat's effect chain: a direct feature/UI comparison

*2026-07-12. Structured comparison pass, commissioned as a direct follow-up to research 48
(`docs/research/48-ableton-audio-effect-reference.md`), which already inventoried all 42 stock
Ableton Live 12 audio effects against dotbeat's roadmap and found Gate as the sharpest gap. This
pass's job is different: a **feature/UI-structured comparison table**, grounded directly in the
manual's own screenshots (not just its text), covering parity, one-way gaps in both directions,
and a single prioritized build table. Where a finding duplicates research 48's, it is cited and
not re-derived from scratch; new findings come from actually looking at 20 rendered manual pages
this pass viewed directly (`p-513` through `p-645`, listed in
`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch28/SAMPLE_MANIFEST.txt`) plus a full
read of dotbeat's `EFFECT_TYPES`/`SYNTH_FIELDS` (`src/core/document.ts`) and the live Tone.js graph
each maps to (`ui/src/audio/engine.ts`, `ui/src/components/synthParams.ts`).*

## How to read this doc

- **[manual p.NNN]** — read directly from the chapter text or a viewed screenshot this pass, cited
  to the printed page number (chapter starts p.513, ends p.651).
- **[dotbeat file:line]** — read directly from this repo's current source this pass.
- This pass does not repeat research 48's full 42-effect inventory (§1 there) or its page-cite
  index — see that doc for the complete list. This doc's own §1(b) below is scoped to gaps only.
- Nothing here contradicts a decision in `docs/decisions.md` or a shipped/roadmapped row in
  `docs/product-roadmap.md`; every recommendation below is checked against both.

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

dotbeat's current per-track reorderable chain (`EFFECT_TYPES`, `src/core/document.ts:642-655`) is
`eq3, comp, distortion, bitcrush, eq7, autoFilter, autoPan, tremolo, utility, grainDelay,
vinylDistortion, resonator` (12 members) plus five fixed/always-wired inserts — `saturator`,
`chorus`/`phaser` (`chorusMode`/`phaserRate` fields), `pingPong`, and the scheduling-layer
`beatRepeat` (`ui/src/audio/engine.ts` `SynthChain`; `tick()` for Beat Repeat). All twelve are real,
shipped, GUI-editable via `ui/src/components/synthParams.ts`'s `PARAM_GROUPS`.

| Effect | dotbeat | Parameter-level gap vs. the manual's actual UI |
|---|---|---|
| **EQ Three** (`eq3`) | `Tone.EQ3` [`ui/src/audio/engine.ts:634`], 3 gain knobs (`eqLow`/`eqMid`/`eqHigh`, `src/core/document.ts:251-253`) | Ableton's EQ Three exposes **adjustable crossover frequencies** (FreqLo/FreqHi) and a **24/48 dB slope switch** [manual p.569] — dotbeat's version has fixed crossovers, gain-only. Confirmed by research 48 §2.3; unchanged this pass. |
| **Compressor** (`comp`) | `Tone.Compressor` [`ui/src/audio/engine.ts:640`], `compThreshold/compRatio/compAttack/compRelease/compMix` (`src/core/document.ts:254-258`) | Viewing the actual Compressor UI [manual p.547, screenshot] confirms it beyond research 48's text-only read: a **Knee** knob with its own **Transfer Curve display** (shows the actual bend at the knee value live), **3 named Lookahead times** (0/1/10ms dropdown), a **Peak/RMS/Expand** three-way mode switch (Expand is upward expansion, a different processing type entirely — not compression), a **Log/Lin envelope-shape** toggle, an **Auto** release button, and a dedicated **Activity view** (input level in gray, output/GR overlaid) for visualizing gain reduction over time. dotbeat has none of these six; only the threshold/ratio/attack/release/mix core. `DynamicsCompressorNode` (`Tone.Compressor`'s underlying node) already exposes `.knee` — see §2 P0 row. |
| **Gate (sidechain half)** | *(gate itself missing — see 1b; sidechain mechanism compared here for completeness)* | dotbeat's only "sidechain" concept today is `duckSource`/`duckAmount` (`src/core/document.ts:299-300`) — a **scheduled volume dip synced to a source track's kick-lane hits** [`ui/src/audio/engine.ts:3389-3402`: "not an audio-analysis sidechain... dips this track's volume whenever duckSource's kick lane has a hit at this step"], not a real audio-triggered envelope follower. Ableton's Gate [manual p.575, screenshot] and Compressor both drive their sidechain from **actual audio level** of another track (with its own EQ'd filter section — Lo/Hi/Band/Notch buttons, Freq/Q knobs), continuously, not from a scheduled hit-list. This is a structural difference, not a knob-count gap: dotbeat's duck only works for scheduled note/hit tracks, never for e.g. an audio-clip track's live signal. |
| **EQ Eight** (`eq7`) | 7-band parametric (`eq7*` fields, `src/core/document.ts` `SYNTH_FIELDS`; `synthParams.ts:395-427`), built on `Tone.Filter` cascade [`ui/src/audio/engine.ts:828-835`] | dotbeat's version is a fixed HP+LoShelf+3×Bell+HiShelf+LP topology (7 bands, all present, individually on/off-able — good parity on band count and per-band enable). Missing vs. Ableton: **Stereo / L-R / M-S processing modes** and **Adaptive Q** [manual p.568, screenshot] — Ableton's Q auto-increases with boost/cut amount for a more analog-consistent curve; dotbeat's `eq7*Q` fields are static. Also missing the **2× oversampling** option and the **Audition** (solo-a-band) mode shown in the same screenshot. |
| **Auto Filter / Auto Pan-Tremolo** | `Tone.AutoFilter`/`AutoPanner`/`Tremolo` thin wrappers [`ui/src/audio/engine.ts:678-690`] | Genuinely thinner: Ableton's Auto Filter has a full **envelope-follower section** (Attack/Hold/Release, S&H quantize, sidechain input) driving the filter *in addition to* the LFO [manual p.519, screenshot] — dotbeat's `autoFilter*` fields are LFO-only, no envelope-follower path at all. Auto Pan-Tremolo's merged UI [manual p.526, screenshot] also has a **Shape** control reshaping the LFO waveform between ramp/sine/square continuously — dotbeat's `tremoloRate/Depth/Spread/Mix` has no waveform-shape knob (`synthParams.ts:330-342`). Research 48 called this "buys naming, not new sonic capability" — still true, this pass adds the envelope-follower/Shape specifics. |
| **Utility** | `Tone.StereoWidener` + `Tone.Volume` [`ui/src/audio/engine.ts:690-691`], `utilityWidth`/`utilityGain` (`synthParams.ts:344-349`) | Viewing the real device [manual p.645, screenshot] confirms research 48 §2.4's finding and adds detail: missing **Bass Mono** (with its own Audition solo-the-lows toggle), **Mid/Side mode** (an alternate to Width, not Width itself), **per-channel Phase invert (ØL/ØR)**, **Channel Mode** (process only L or only R), a plain **Mono** switch, **Balance** (pan), **Mute**, and a **DC** offset filter. dotbeat covers 2 of Ableton's 9 controls (Width, Gain). |
| **Saturator** | `Tone.WaveShaper` + curve family (`saturatorCurve`/`Drive`/`Mix`, `synthParams.ts:294-299`) | 4 curves (analog/warm/clip/fold) vs. Ableton's 8 built-in curves + a dedicated 6-parameter Waveshaper mode (Drive/Curve/Depth/Linear/Damp/Period) [manual p.624 text confirms the 6-param breakdown] + Hi-Quality/Pre-DC-Filter context-menu modes. Correctly prioritized per research 48; gap is real but intentionally scoped down. |
| **Ping Pong Delay / Grain Delay** | Hand-built two-delay-line network + wobble LFO (`pingPong*`, `ui/src/audio/engine.ts:1017-1031`); granular pitch-shift delay (`grainDelay*`, `:1135-1141`) | dotbeat's ping-pong is *more* configurable than either of Ableton's two current ping-pong implementations (a toggle inside base Delay [manual p.558], a channel mode inside Echo [manual p.563]) — confirmed correctly by research 48 §2.2/§3.1. No gap here; noted for completeness only. |
| **Resonators** | 5-filter bank (`Tone.Filter` bandpass ×5, `ui/src/audio/engine.ts:1306`) | Reasonable parity with Ableton's Resonators [manual p.607] on chord-set concept; Ableton's version is scale/tuning-system-aware (arbitrary microtonal tunings) where dotbeat's `resonatorChord` is a fixed enum (`fifths/major/minor/octaves/harmonic`, `synthParams.ts:104`) — acceptable scope cut, not flagged as a priority gap. |

### b) In Ableton, not in dotbeat

Every stock Ableton Live 12 effect with no dotbeat equivalent at all (cf. research 48 §1 for the
complete 42-effect inventory this is filtered from):

| # | Ableton effect | Manual page | What it is | Why dotbeat lacks it |
|---|---|---|---|---|
| 1 | **Gate** | [p.573-575] | Threshold/Return/Attack/Hold/Release/Floor noise gate, Flip (duck) mode, full EQ'd external sidechain [screenshot: p.575] | Not in `EFFECT_TYPES`, not in research 17's original 13-item scope either — research 48's sharpest single finding, confirmed again this pass by viewing the actual sidechain-section screenshot |
| 2 | **Delay** (base device) | [p.556-559] | Plain tempo-synced/free stereo delay, per-line filter, LFO on time+filter, 3 time-change smoothing modes (Repitch/Fade/Jump), Ping Pong toggle | dotbeat only has the two specialized delays (Grain, Ping Pong) — no plain synced delay insert (research 48 §2.2) |
| 3 | **Glue Compressor** | [p.576-578] | Analog-modeled bus-glue compressor (Cytomic), fixed knee-sharpens-with-ratio, Range, Soft Clip output, sidechain | Mastering/bus-glue tier, correctly deferred |
| 4 | **Limiter** (real depth) | [p.587-588] | Link (L/R vs M/S), Maximize mode, Auto Release, 3 lookahead times, Standard/Soft-Clip/True-Peak ceiling modes | dotbeat's master limiter is `Tone.Limiter(-1)` [`ui/src/audio/engine.ts:1726`] — ceiling only, no per-track access at all |
| 5 | **Multiband Dynamics** | [p.593-597] | Up to 3-band, all 4 dynamics types (up/down comp, up/down expand) simultaneously per band, sidechain [screenshot: p.596] | Mastering tier, no dotbeat equivalent |
| 6 | **Reverb** (real depth) / **Hybrid Reverb** | [p.608-611], [p.580-586] | Input filter, early reflections w/ Spin, full diffusion network, internal chorus, Freeze/Flat/Cut [screenshot: p.610]; Hybrid adds convolution IR import across 10 categories [screenshot: p.582] | dotbeat's reverb is `Tone.Reverb({decay:2.2, wet:1})` [`ui/src/audio/engine.ts:1768`] — one hardcoded shared instance, decay only, no per-track insert, no IR import |
| 7 | **Roar** | [p.612-620] | 3 gain stages, 7 routing topologies, 12 shaper curves, full mod matrix (2 LFO/Env/4 noise types) [screenshot: p.617] | Ceiling reference for how far Saturator could go; correctly out of scope now |
| 8 | **Auto Shift** | [p.527-534] | Real-time pitch correction / vibrato / formant shift, scale-aware [screenshot: p.533] | Structurally blocked — no audio-input/recording path exists yet (M4/Tauri) |
| 9 | **Shifter** | [p.624-628] | Unified pitch-shift / frequency-shift / **ring modulation**, LFO+env-follower, stereo spread [screenshot: p.624] | Genuinely missing category; ring-mod mode is cheap (research 48 §2.5) |
| 10 | **Vocoder** | [p.648-650] | Carrier/modulator "talking synth," up to ~40 bands | Needs cross-track audio-rate routing dotbeat's per-track insert model doesn't support; named as known gap, not a near-term build |
| 11 | **Spectral Resonator / Spectral Time** | [p.629-637] | MIDI-driven spectral harmonic tuning; spectral freeze+delay [screenshot: p.631] | Live-12-newest, niche; correctly out of scope |
| 12 | **Amp / Cabinet** | [p.513-538] | Guitar amp/cabinet physical modeling [screenshot: p.513] | No fit for dotbeat's synth/drum-centric track model — no live guitar input |
| 13 | **Looper** | [p.589-592] | Real-time record/overdub/undo performance looper [screenshot: p.589] | Session-View-shaped performance tool, ruled out by dotbeat's document-first arrangement model |
| 14 | **Erosion / Filter Delay / Channel EQ / Echo (character half) / Dynamic Tube / Overdrive / Pedal / Drum Buss / Corpus / Vinyl Distortion (partial — shipped) / External Audio Effect / Tuner** | various | Niche or already-covered-by-generic-effect variants | Correctly low-priority per research 48 §3.2 (Corpus explicitly AudioWorklet-tier, deferred) |
| 15 | **Spectrum** (visualizer, not an effect) | [p.638-643] | Real-time FFT/level analyzer, Lin/Log/Semitone scaling, Bins/Max overlay [screenshot: p.638] | Maps directly to `docs/product-roadmap.md`'s "GUI spectrum / level visualization" row (⬜ Not started) — not an audio effect at all [manual p.638: "does not alter the incoming signal in any way"], so it's a GUI feature, not an `EffectType` gap |

### c) In dotbeat, not in Ableton

Things dotbeat's chain does that no single stock Ableton device does as such:

- **Ping Pong Delay as a genuinely more-configurable device than Ableton's own two ping-pong
  implementations** — continuously-variable `pingPongCrossFeed` (Ableton's toggle is binary) plus
  delay-time LFO wobble (`pingPongWobbleRate`/`Depth`) neither of Ableton's ping-pong modes has
  [`ui/src/audio/engine.ts:1017-1031`; confirmed by research 48 §2.2/§3.1].
- **A single reorderable, literal-text effect chain per track** (`BeatTrack.effects`,
  `src/core/document.ts:667-680`) — array order *is* chain order, diffable as a two-line move. This
  isn't a sonic feature but is a structural one with no Ableton analog worth comparing sonically:
  it's the `.beat`-format payoff (agent/CLI can `effect-add`/reorder/bypass via a plain edit,
  `docs/decisions.md` D4/D7's canonical-ordering discipline applied to the FX chain itself).
- **Everything downstream of the format**: every dotbeat effect param is `beat set`/`beat_set`-able
  from the CLI/MCP and git-diffable — Ableton's own device state lives in `.als`'s gzipped XML,
  confirmed not cleanly diffable (`ROADMAP.md` §1). Not a *device* feature, but a real dotbeat-only
  capability worth naming since this doc's audience cares about it.

---

## 2. Prioritized recommendations

| Feature | Priority | Build recommendation |
|---|---|---|
| **Add Gate as a new `EffectType`** | **P0** | New `EffectType` member `'gate'` in `src/core/document.ts` (alongside the existing 12, `:629-655`), plus a `gate` `ParamGroup` in `ui/src/components/synthParams.ts` mirroring the `comp` group's shape. DSP: no dedicated `Tone.Gate` class exists in Tone.js — build from `Tone.Follower` (envelope detection) driving a `Tone.Gain` via a threshold comparison, same pattern the codebase already uses for `duckAmount`'s scheduled envelope (`ui/src/audio/engine.ts:3389-3402`) but continuous/audio-rate rather than scheduled. Fields: `gateThreshold` (dB), `gateReturn` (hysteresis dB), `gateAttack`/`gateHold`/`gateRelease` (sec), `gateFloor` (dB, -Infinity-capable), `gateFlip` (bool, ducking mode) — directly modeled on the real device [manual p.573-575, screenshot p.575]. Real audio-triggered sidechain (vs. dotbeat's scheduled `duckSource`) is a stretch goal, not required for v1 — a self-sidechain-only Gate (using the gated signal's own level) already closes most of the everyday-use gap and is a much smaller lift. |
| **Add `compKnee` to the existing `comp` insert** | **P0** | Near-free: `DynamicsCompressorNode` (which `Tone.Compressor` wraps) already exposes a native `.knee` property. One new `SynthFieldDef` in `src/core/document.ts`'s `SYNTH_FIELDS` (near `compMix`, `:258`), one line wiring `compressor.knee.value = p.compKnee` in `applyParams()` (`ui/src/audio/engine.ts`, near `:640-641`), one `k('compKnee', 'Knee', 0, 40, fmt.db)` row in `synthParams.ts`'s `comp` group (`:217-229`). No new Tone.js primitive, confirmed against the real device's Knee display [manual p.547, screenshot]. |
| **Add a plain, tempo-synced Delay insert** (distinct from Grain Delay / Ping Pong Delay) | **P0** | New `EffectType` `'delay'`. Primitive: `Tone.FeedbackDelay` — already used and proven for the shared `delayBus` [`ui/src/audio/engine.ts:1769`], but wire it as a genuine per-track insert (own node instance per track, not the shared bus) with document-driven `delayTime`/`delayFeedback`/`delayFilterFreq`/`delaySync` fields, `delayTime` expressible as a tempo-synced division (reuse the `LFO_SYNC_RATES` enum pattern already in `synthParams.ts:108`). Research 48 §2.2/§3.3 already scoped this; this pass confirms via the real device screenshot's smoothing-mode detail [manual p.557-558] that Repitch/Fade/Jump time-change behavior is a nice-to-have refinement, not required for v1 parity. |
| **Add Bass Mono to the existing `utility` insert** | **P1** | `Tone.Filter` (lowpass) split path below a `utilityBassMonoFreq` cutoff (50-500 Hz range, per the real device [manual p.645, screenshot]), summed to mono via `Tone.Gain`-based mid channel merge, recombined with the unaffected (already-widened) highs. One new field, one new node pair (`Tone.Filter` + a mono-sum `Tone.Gain`) in the existing `utility` insert builder (`ui/src/audio/engine.ts:690-691`). Cheapest genuinely-new-DSP item on this list after Knee. |
| **Shifter's ring-modulation mode** | **P1** | New `EffectType` `'ringMod'` (name it standalone rather than folding into Shifter's 3-in-1 Pitch/Freq/Ring design — matches dotbeat's existing one-effect-one-job convention, e.g. `resonator`/`grainDelay` are already split out rather than merged). DSP: `Tone.Gain` whose `.gain` AudioParam is driven by an audio-rate `Tone.Oscillator` (true ring modulation — multiplying two signals; per the manual, "the user-specified frequency amount in Hertz is added to and subtracted from the input" [manual p.627]). No dedicated Tone.js class needed. Fields: `ringModFreq` (Hz, 1-5000), `ringModMix`. Distinct sonic territory — nothing in `autoFilter`/`tremolo`/`phaser` does true multiplicative ring mod. |
| **EQ Eight-style Adaptive Q on `eq7`** | **P2** | Requires per-band gain-to-Q coupling logic in `applyParams()` where `eq7*Q` is currently a static field (`ui/src/audio/engine.ts:828-835`) — compute effective Q as a function of live `eq7*Gain` rather than a stored value. Moderate lift (touches the live audio-param update path for all 5 gain-capable bands), real but secondary polish vs. the P0/P1 items above. |
| **EQ Eight-style Stereo/L-R/M-S processing modes on `eq7`** | **P2** | Needs per-channel-pair filter routing dotbeat's current mono-summed `Tone.Filter` cascade doesn't have — a bigger lift than Adaptive Q (splitting the signal path, not just a coefficient). Defer until eq7 usage in practice shows the mono-linked behavior is a real complaint. |
| **Auto Filter envelope-follower section** | **P2** | `autoFilter` is LFO-only today; adding `Tone.Follower`-driven modulation of `autoFilterBaseFrequency` alongside the existing LFO (per the real device's dual LFO+Envelope architecture [manual p.519, screenshot]) is a genuine DSP addition, not a knob — reuses the same `Tone.Follower` primitive the Gate build (above) would introduce, so sequence Gate first and share the envelope-follower code path. |
| **Real per-track Reverb (replacing the single shared hardcoded bus)** | **P1** | `this.reverbBus = new Tone.Reverb({decay:2.2, wet:1})` [`ui/src/audio/engine.ts:1768`] is one instance shared by every track's `sendReverb` amount. A real per-track Reverb insert (new `EffectType` `'reverb'`) using `Tone.Reverb`'s existing `decay`/`preDelay` params plus a new `reverbColor` (simple input-filter tilt via `Tone.Filter`) would close most of the "shallow reverb" gap from research 48 §2.6 without chasing Hybrid Reverb's convolution-IR complexity. Ranked P1 not P0: dotbeat's current reverb is real and usable, just shallow — Gate/Delay/Knee close more everyday gaps per build-hour. |
| **Deeper Limiter (per-track access, Auto Release, True-Peak mode)** | **P2** | `this.masterLimiter = new Tone.Limiter(-1)` [`ui/src/audio/engine.ts:1726`] is master-bus-only and ceiling-only. `Tone.Limiter` wraps a `DynamicsCompressorNode` internally with no true-peak oversampling — a real True-Peak mode needs either oversampled peak detection (custom AudioWorklet-tier work) or accepting Standard-mode-only parity. Defer to a dedicated mastering-tier pass (research 48 §2.6 already flagged this as correctly out of scope for now); listed here only so it isn't silently dropped when that tier is picked up. |
| **Vocoder** | **Do-not-recreate (for now)** | Needs a structurally different routing model — simultaneous carrier+modulator cross-track audio, which dotbeat's one-signal-in-one-signal-out per-track insert model doesn't support. Would require the same kind of cross-track internal-routing concept `duckSource` and External Audio Effect gesture at, generalized to continuous audio-rate signal flow, not a triggered scheduled event. Worth a line in the roadmap (research 48 §3.3 item 6) but not a build slot until/unless cross-track audio routing becomes a broader need (e.g. also wanted for a real audio-sidechain Gate/Compressor, above). |
| **Amp / Cabinet / Auto Shift / Looper / Tuner / External Audio Effect** | **Do-not-recreate** | Amp/Cabinet: no fit for dotbeat's synth/drum-centric track model (no live guitar input). Auto Shift: structurally blocked on native audio recording (M4/Tauri gate, `docs/product-roadmap.md`'s "Native audio recording" row). Looper: a Session-View-shaped performance tool, incompatible with dotbeat's document-first arrangement model (same reasoning `docs/product-roadmap.md` already applied to rule out Session-grid features). Tuner/External Audio Effect: no live-input or hardware-I/O use case exists in dotbeat at all. |
| **Roar-tier saturation depth (12 curves, mod matrix, feedback loop)** | **Do-not-recreate (for now)** | Useful ceiling reference for how far Saturator *could* eventually go (research 48 §2.6), but building it now would be speculative complexity with no forcing use case — revisit only if Saturator's current 4-curve scope becomes a specific, named complaint. |
| **GUI Spectrum device (visualizer)** | *(not an effect — tracked separately)* | Already an open, correctly-classified roadmap row: `docs/product-roadmap.md`'s "GUI spectrum / level visualization," ⬜ Not started, D2-safe (visualizes existing `beat metrics` spectral data, doesn't reopen the "LLM narrates, never judges" decision). When picked up, cite Ableton's Spectrum UI directly [manual p.638, screenshot]: Lin/Log/Semitone X-scale toggle, Bins-vs-interpolated-line Graph mode, a Max-hold overlay, and a Block-size/Refresh/Avg accuracy-vs-CPU tradeoff triplet — all concrete, transferable UI ideas for that exact feature. |

---

## Sources

Ableton Live 12 Reference Manual, chapter 28 "Live Audio Effect Reference," pp. 513-651. Text
extract: `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-chapters/ch28.txt`. **20 rendered
page screenshots viewed directly this pass** (`p-513, 519, 526, 533, 540, 547, 554, 561, 568, 575,
582, 589, 596, 603, 610, 617, 624, 631, 638, 645.jpg`,
`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch28/`) — covering Amp, Auto Filter
(envelope section), Auto Pan-Tremolo, Auto Shift (pitch section), Channel EQ, Compressor (transfer
curve + activity display), Corpus, Drum Buss, EQ Eight, Gate (sidechain), Hybrid Reverb
(convolution), Looper, Multiband Dynamics (sidechain), Phaser-Flanger (unfolded), Reverb (diffusion
+ chorus), Roar (mod sources), Shifter, Spectral Resonator, Spectrum, and Utility. Cross-checked
against dotbeat's own source read directly this pass: `src/core/document.ts` (`EffectType`,
`EFFECT_TYPES`, `SYNTH_FIELDS`, `:629-689`, `:251-271`, `:867-869`), `ui/src/audio/engine.ts` (every
`new Tone.*` construction site, `:634-691`, `:827-835`, `:998-1031`, `:1135-1141`, `:1251-1310`,
`:1725-1769`, `:1807-1825`, `:3389-3402`), `ui/src/components/synthParams.ts` (`PARAM_GROUPS`, full
file), `docs/product-roadmap.md`, `ROADMAP.md`, `docs/decisions.md`, and
`docs/research/48-ableton-audio-effect-reference.md` (the prior pass this doc builds on and cites
throughout rather than re-deriving).
