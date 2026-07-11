# Research 17 — instrument/track FX arsenal: Ableton's standard toolkit, scoped for dotbeat

*2026-07-11. Stream P of `docs/phase-17-plan.md`, run in parallel with Stream L's engine-
consolidation surgery — research and format design only this round, no `ui/src/audio/engine.ts`,
`src/core/document.ts`, or CLI render-path edits (see that plan's Stream P and "explicitly out of
scope" sections). Owner's framing, verbatim: "instrument-track FX parity... sound effects/sound
modifications for tracks... things like beat repeat, ping pong delays, etc. Just that type of
pre-set FX. We'll want to add more and more of this as well." Owner is an Ableton user — this pass
matches Ableton's actual device names and behavior, not generic effect labels.*

## Headline

dotbeat's `SYNTH_FIELDS` (`src/core/document.ts`) already covers Ableton's **dynamics/EQ/lo-fi**
tier in full (EQ Three, Compressor, the bit-reduction half of Redux) and, less obviously,
**already has the Chorus and Phaser DSP nodes running in `engine.ts` today** — just not exposed as
format fields or configurable per track. What's genuinely and completely absent is exactly what
the owner named: **Beat Repeat and Ping Pong Delay**, plus the whole physical-modeling/granular
tier (Corpus, Resonators, Grain Delay) and the utility/character tier (Saturator, Vinyl
Distortion, Utility). Tone.js (already a dependency, v15.1.22) ships direct, near-free
constructor-level equivalents for **Ping Pong Delay, Auto Filter, Auto Pan, Tremolo, Chorus, and
Phaser** — six of the thirteen researched effects need essentially no new DSP, just wiring and
format fields. Beat Repeat, Grain Delay, Saturator, Vinyl Distortion, Utility, Corpus, and
Resonators have no Tone.js equivalent and need real (if varyingly-sized) building.

**Recommended Phase 18 build order:** (1) Ping Pong Delay, (2) Beat Repeat, (3) expose the
already-running Chorus/Phaser buses per-track, (4) Saturator. Detail and format-field sketches in
the final section.

---

## 1. Ableton's standard built-in audio-effects rack

Researched against Ableton's official Live 12 manual (`ableton.com/en/manual/live-audio-effect-
reference/`) and cross-checked with independent write-ups (Sound On Sound, MusicTech, Loopmasters,
homemusicmaker.com) where the manual fetch returned partial content. Grouped by how often a
working producer actually reaches for them, not alphabetically — that ordering matters as much as
the inventory per the task brief.

### Everyday / reached-for-constantly

- **Auto Filter** — a resonant filter (10 filter types: LP/HP/BP/notch/morph variants) with **two
  independent modulation sources**: an LFO (rate, depth, waveform, stereo phase offset) and an
  **envelope follower** driven by the input signal's amplitude (with its own attack/release and a
  sidechain-input option). The single most commonly automated/modulated filter effect in Ableton
  because it's the standard "filter sweep" and "filter follows the beat" tool.
- **Utility** — not a "sound" effect at all: gain trim, stereo width (0-400%), mono-below-a-
  frequency (bass-mono correction), phase invert (per channel or both), and a DC-offset/"Mute" bus
  strip. Nearly every serious Ableton project has a Utility on many tracks; it's invisible but
  ubiquitous — closer to a mixing-hygiene tool than a "preset FX," which matters for how it should
  be prioritized against the owner's framing (below).
- **Saturator** — waveshaping distortion/warmth via 6 selectable curve types (soft/analog clip,
  digital clip, waveshaper, sinoid fold, and variants), plus Drive, a frequency-selective
  Base/Width control (so saturation can target just the low end, a classic "add weight without
  mud" move), DC, and an envelope-driven Depth modulation. The default "make it sound less
  digital" tool.
- **Ping Pong Delay** — a single delay buffer, mixed to mono going in, alternately routed left/
  right coming out, with an adjustable band-pass filter on the signal entering the buffer, sync-
  to-grid or free time, feedback, a Freeze button (turns it into a basic looper), and (per Live
  12) an Invert switch that turns a ramp-LFO-shaped modulation into ducking vs. gating. The default
  "stereo bounce" delay — reached for far more often than the plain mono Delay/Echo devices for
  anything rhythmic.
- **Chorus-Ensemble** — "classic two-delay-line chorus with an optional third delay line," offering
  three modes: **Chorus** (2-voice), **Ensemble** (3-voice, wider/thicker), and **Vibrato** (pitch
  modulation only, no dry blend). Rate, depth (width/depth of the delay-time modulation), and mix.
  Extremely common on synth/pad tracks for stereo width and movement.

### Frequently used, often genre-signature

- **Beat Repeat** — captures a slice of the live incoming audio (size set by **Grid**, one of a
  fixed set of note divisions) and re-triggers it on a **repeat Interval**, for a total active
  window set by **Gate** (in 16th notes — if Gate isn't at least as long as Grid, the device is a
  no-op, per the manual). **Chance** (0-100%) makes each individual repeat probabilistic rather
  than deterministic. **Variation** randomizes the grab size around Grid rather than keeping it
  fixed. **Pitch** transposes each successive repeat. Three **mix modes**: *Mix* (original + repeats
  both play), *Insert* (original muted only while a repeat is active, otherwise passes), *Gate*
  (only repeats ever play, original never passes). This is the classic "buffer glitch"/stutter
  effect that defines a lot of EDM, hip-hop, and glitch-genre fills — genre-signature rather than
  universal, but reached for constantly *within* those genres, and it's the specific example the
  owner named.
- **Auto Pan-Tremolo** (Live 12 merged device; was two separate devices — Auto Pan and Tremolo —
  through Live 11) — an LFO modulating either stereo position (pan mode) or amplitude (tremolo
  mode), with selectable waveform shapes and a stereo phase-offset control. Common on rhythmic
  arps/plucks and for adding movement to static pads.
- **Grain Delay** — a delay line that instead of simple taps, resamples the delayed signal into
  short **grains** with independently controllable grain **Pitch**, **Frequency** (grain rate),
  **Spray** (randomized grain-start jitter), and **Size**, on top of the usual delay time/feedback.
  Produces a distinctive granular/glitchy pitched-delay texture — a deliberate "weird" tool, not a
  default reach.
- **Redux** — Ableton's bitcrusher, with two independent sides: **Downsampling** (Rate 0-40kHz,
  Jitter, and a pre/post anti-aliasing Filter) and **Bit Reduction** (Bits 1-16, a linear-vs-
  logarithmic **Shape** control, DC Shift), plus a dry/wet added in Live 11. Common in electronic/
  lo-fi production, less so elsewhere.
- **Phaser-Flanger** — a Live 11+ multi-effect combining a phaser, a flanger, and a "doubler" mode
  in one device (rather than Ableton's older, still-present separate Phaser and Flanger devices).
  Rate, depth/amount, feedback, and a mode selector. Used situationally for movement/width, less
  universal than Chorus.

### Exotic / sound-design-specific (rarely the first reach)

- **Vinyl Distortion** — combines even-harmonic and odd-harmonic distortion models (Tracing Model
  dropdown) with a separate **Crackle** generator (density control) to emulate worn-vinyl
  playback. A deliberate lo-fi/vintage character tool, not a general-purpose distortion — Ableton
  ships Saturator/Overdrive/Dynamic Tube/Erosion as the more commonly reached-for distortion
  family, with Vinyl Distortion specifically for the "old record" effect.
- **Corpus** — physical-modeling resonator: simulates the acoustic resonance of one of seven
  object types (beam, marimba, string, membrane, plate, pipe, tube), each with its own material/
  decay/tuning model, plus an LFO section and a filter section. A genuine sound-design tool for
  turning percussive/noisy input into pitched, instrument-like resonance — niche, used
  deliberately, not a everyday insert.
- **Resonators** — up to 5 independently-tuned resonant (bandpass-like) filters with pitch, decay,
  and note-mode (chromatic/just-intonation-ish) controls, layered for chord-like pitched
  resonance from any input. Related to Corpus in effect (turns noise into pitched tone) but via
  tuned filters rather than a physical-modeling engine — architecturally much simpler to
  approximate, still a niche sound-design tool rather than a default reach.

*(Not separately covered per the task's 13-item list, but worth a one-line note since they came up
during research: **Echo** (Live 10+) and the older **Delay**/**Simple Delay** devices are Ableton's
non-ping-pong delay family — dotbeat's existing shared "delay send" bus, a plain `Tone.
FeedbackDelay`, already approximates **Simple Delay**'s basic case; **Erosion**/**Overdrive**/
**Dynamic Tube** are additional members of the distortion family alongside Saturator/Vinyl
Distortion, not separately scoped here.)*

---

## 2. Cross-reference: what's already in dotbeat's `SYNTH_FIELDS`

Read in full (`src/core/document.ts:242-297`, the `SYNTH_FIELDS` table) before this section was
written. Status legend: **Full** = a dedicated field set exists and matches the Ableton device
reasonably closely. **Partial** = some real coverage exists but via a *generic, shared* mechanism
(not a dedicated device) or covers only part of the device's behavior. **Absent (engine-only)** =
the underlying DSP node already runs in `engine.ts` today but has zero document/format surface.
**Absent** = nothing exists, format or engine.

| Ableton effect | Status | What actually exists in dotbeat |
|---|---|---|
| EQ Three | **Full** | `eqLow`/`eqMid`/`eqHigh` → `Tone.EQ3`, 1:1 |
| Compressor | **Full** | `compThreshold`/`compRatio`/`compAttack`/`compRelease`/`compMix` → `Tone.Compressor` with a parallel wet/dry fan, 1:1 |
| Redux (bit-reduction half) | **Full** (bit half only) | `bitcrushBits`/`bitcrushMix` → `Tone.BitCrusher`. The **downsampling** half (Rate/Jitter/pre-post Filter) has no field or engine node at all |
| Saturator / Overdrive family | **Partial** | `distortionAmount`/`distortionMix` → `Tone.Distortion` — one generic waveshaper knob, no curve-type selection, no frequency-selective Base/Width, no DC/Depth-envelope. Functionally closer to Ableton's plain Overdrive than the multi-curve Saturator |
| Auto Filter (LFO half) | **Partial** | `lfoDest === 'cutoff'` + `lfoRate`/`lfoDepth` sweeps `cutoff` — but LFO1 is a **shared** modulation source also usable for pitch/amp/wtPos, not a dedicated Auto Filter LFO; no envelope-follower mode exists (the closest analog, `filterEnvAmount`/`filterEnvAttack/Decay/Sustain/Release`, is a fixed ADSR triggered per note-on, not a continuous envelope follower on the mixed audio) |
| Auto Pan / Tremolo | **Partial** | `lfo2Dest === 'pan'` (auto-pan) and `lfoDest === 'amp'` (tremolo) both exist, but again through the **shared, general-purpose** dual-LFO matrix (`lfoDest`/`lfo2Dest` also route to sends, EQ, distortion mix) rather than a dedicated, independently-labeled device. No waveform-shape picker beyond `sine`/`custom`, no stereo phase-offset control |
| Chorus-Ensemble | **Absent (engine-only)** | `engine.ts`'s `getBuses()` already builds a `Tone.Chorus({frequency:1.5, delayTime:3.5, depth:0.7, wet:1}).start()` — but it's one hardcoded, project-global instance, reachable only via the generic `sendMod` (0..1) field, with **zero** per-track rate/depth/mode control and no SYNTH_FIELDS entries at all |
| Phaser-Flanger | **Absent (engine-only)** | Same bus: `Tone.Phaser({frequency:0.5, octaves:3, baseFrequency:1000, wet:1})`, wired in series *after* the chorus (chorus → phaser → master) — same "already running, zero format surface" situation |
| Ping Pong Delay | **Absent** | The shared `delayBus` is a plain mono `Tone.FeedbackDelay({delayTime:'8n', feedback:0.3, wet:1})`, reachable via `sendDelay` — not stereo-alternating, and none of its own time/feedback params are document-driven (hardcoded at construction) |
| Beat Repeat | **Absent** | No field, no buffer-capture/re-trigger concept anywhere in the engine |
| Grain Delay | **Absent** | No granular DSP anywhere |
| Utility | **Absent** | `volume` (dB) covers gain trim; `pan` covers position. No stereo-width, phase-invert, or mono-below-frequency field |
| Vinyl Distortion | **Absent** | No even/odd-harmonic split or crackle generator; distinct from the generic `distortionAmount`/`distortionMix` pair |
| Corpus | **Absent** | No physical-modeling/resonant-body concept |
| Resonators | **Absent** | No tuned-filter-bank concept |

**Confirms the owner's own read exactly**: Beat Repeat and Ping Pong Delay are both fully absent —
not partially covered by anything. The more interesting finding beyond that confirmation is that
**Chorus and Phaser are not actually absent at the DSP level** — they're running in every session
today, just invisible to the format and un-configurable per track. Exposing them properly is
closer to "finish a half-built feature" than "build a new one" (see §4/§5).

---

## 3. What Tone.js already provides for free

dotbeat's engine is built on Tone.js (`tone: ^15.1.22`, confirmed in `ui/package.json`; verified
against Tone's own docs, since this worktree has no installed `node_modules` to introspect
directly). Tone.js's effects module ships these built-in classes:

`AutoFilter`, `AutoPanner`, `AutoWah`, `BitCrusher`, `Chebyshev`, `Chorus`, `Distortion`,
`FeedbackDelay`, `Freeverb`, `FrequencyShifter`, `JCReverb`, `Phaser`, `PingPongDelay`,
`PitchShift`, `Reverb`, `StereoWidener`, `Tremolo`, `Vibrato`.

| Ableton effect | Tone.js equivalent | Verdict |
|---|---|---|
| Ping Pong Delay | `Tone.PingPongDelay` | **Direct 1:1 built-in.** Constructor takes `delayTime`/`feedback`; inherits `.wet` from the base `Effect` class exactly like `Tone.Distortion`/`Tone.BitCrusher` already used in `engine.ts`. Near-free. |
| Auto Filter | `Tone.AutoFilter` | Direct built-in (LFO-modulated filter, has its own rate/depth/type/octaves — no envelope-follower mode, matching Ableton's LFO half only). Near-free as a *dedicated* device, though it duplicates the generic LFO-on-cutoff capability already in the engine (see §2). |
| Auto Pan / Tremolo | `Tone.AutoPanner` + `Tone.Tremolo` | Both direct built-ins (Ableton 12 merged what Tone.js still keeps as two nodes — trivial to unify behind one `mode` enum). Near-free, same duplication caveat as Auto Filter. |
| Chorus-Ensemble | `Tone.Chorus` | **Already instantiated in `engine.ts` today** (see §2) — the node itself is proven working; only the format/per-track-wiring is missing. Near-free to finish. |
| Phaser-Flanger (phaser half) | `Tone.Phaser` | Same as Chorus — already running. The **Flanger** half has no dedicated Tone.js class; `Tone.Chorus` with a very short `delayTime` + feedback is the standard flanger approximation, or a small custom `FeedbackDelay`+LFO patch (still cheap, just not a single drop-in class). |
| Utility (width) | `Tone.StereoWidener` | Direct built-in for the width control. Phase-invert and mono-below-frequency aren't dedicated classes but are a few lines each on top of primitives already used elsewhere in `engine.ts` (a `Tone.Gain`/inverting `WaveShaper`, a `Tone.Filter` sum). Near-free overall. |
| Redux (downsample half) | *none* | No downsampler class. `Tone.BitCrusher` only covers the bit-depth half (already wired). A true Rate/Jitter downsampler needs a small custom `AudioWorkletNode` or a sample-and-hold trick — real, but small, DSP work. |
| Saturator | *none directly* | No `Tone.Saturator`, but `Tone.WaveShaper` is a base primitive Tone.js exposes directly — a Saturator is "author a handful of curve functions, feed them into a `WaveShaper`." Low-moderate: needs authored math, not novel audio-graph plumbing. |
| Vinyl Distortion | *none* | Same `WaveShaper` primitive for the harmonic-distortion half; the crackle generator is a `Tone.Noise` + envelope — both primitives the drum kit code in `engine.ts` already uses (`Tone.NoiseSynth`). Buildable from existing primitives, moderate effort. |
| Beat Repeat | *none* | No buffer-capture-and-loop class, and Tone.js has no "audio effect that listens to the last N seconds of its own input" primitive at all. See §4 for why dotbeat specifically doesn't need Ableton's literal implementation. |
| Grain Delay | *none directly relevant* | `Tone.GrainPlayer` exists but is a **buffer player** (plays a pre-loaded `AudioBuffer` with granular controls), not an insert effect that grains its live input. Adapting it into a live granular delay needs a rolling capture buffer + custom scheduling — real work. |
| Corpus | *none* | No physical-modeling primitive of any kind in Tone.js. Would need genuine custom DSP (tuned comb/resonant filter banks with material-specific damping), realistically AudioWorklet-tier. |
| Resonators | *none directly*, but approximable | No dedicated class, but a bank of up to 5 `Tone.Filter` (bandpass) nodes tuned to pitched frequencies with feedback — built entirely from the same `Tone.Filter` primitive already used throughout `engine.ts` — is a reasonable approximation. Meaningfully cheaper than Corpus despite having "no equivalent" either. |

**Six of thirteen** researched effects (Ping Pong Delay, Auto Filter, Auto Pan, Tremolo, Chorus,
Phaser) map to a Tone.js built-in or an already-running engine node. That's the single biggest
scoping lever in this research: it inverts naive intuition that "Beat Repeat and Ping Pong Delay
are both named by the owner, so they're similar-sized asks" — they are not. Ping Pong Delay is
close to a copy-paste of the existing distortion/bitcrush wiring pattern; Beat Repeat is not.

---

## 4. How a new effect plugs into `engine.ts` — architecture notes that set difficulty

Read in full (`ui/src/audio/engine.ts`) specifically for this. Three findings shape every
difficulty estimate below:

1. **The per-track insert chain has an established, reusable pattern.** `buildSynthChain()` (and
   its `DrumBus` twin) wires `filter → eq3 → parallel-comp → distortion → bitcrush → muteGain →
   panner`, and every one of those stages after the filter follows the *same* convention: a Tone
   node with a native `.wet` (or a hand-built wet/dry gain pair, only needed for the compressor's
   parallel topology) driven straight from one `*Mix` field in `applyParams()`/
   `applyDrumBusParams()`. Any new effect whose Tone.js class extends the base `Effect` class
   (true for `PingPongDelay`, `Chorus`, `Phaser`, `AutoFilter`, `AutoPanner`, `StereoWidener`, and
   `Distortion`-family additions) slots into this exact chain with a few lines in four places
   (`SynthChain`/`DrumBus` interface, `buildSynthChain()`/`getDrumBus()`, `applyParams()`/
   `applyDrumBusParams()`, `disposeChain()`), duplicated once for drums. This is genuinely
   low-effort, proven-safe plumbing — not a guess.
2. **The shared return buses (reverb/delay/mod) have a real, easy-to-miss constraint: their own
   character is engine-code constants, never document-driven.** `getBuses()` builds
   `reverbBus`/`delayBus`/`chorusBus`/`phaserBus` once, with hardcoded decay/delayTime/feedback/
   rate/depth values, and nothing in `sync()` or `tick()` ever touches those params again — only
   the per-track *send amount* (`sendReverb`/`sendDelay`/`sendMod`, 0..1) is document-driven, and
   the buses are shared by every track in the project. This means the "obvious" move for Ping Pong
   Delay — just swap the shared `delayBus`'s class from `FeedbackDelay` to `PingPongDelay` — would
   only ever give the *whole project* one delay-time/feedback setting, which doesn't match how
   Ableton users actually reach for Ping Pong Delay (usually inserted directly on one track). The
   same tension applies to giving Chorus/Phaser real per-track control. **The format-consistent
   fix is to treat these as new per-track INSERT stages (§1's pattern) rather than trying to make
   the shared-bus model per-track-configurable** — every other configurable effect in dotbeat
   already lives one-instance-per-track (EQ3, compressor, distortion, bitcrush), so this is
   consistent with existing precedent, not a new architectural idea.
3. **dotbeat already knows every note/hit ahead of the audio callback — this is the load-bearing
   fact for Beat Repeat's difficulty estimate.** `tick()` resolves `content.notes`/`content.hits`
   for the current step from `contentOf()` before scheduling anything, because dotbeat is a fully
   sequenced synthesis engine, not a live-audio-input effect processor. Ableton's real Beat Repeat
   captures N samples of *whatever audio is actually arriving* into a rolling buffer and loops
   that buffer — a genuine audio-DSP problem requiring circular-buffer capture (no Tone.js
   primitive for this). dotbeat can produce the same *musical* result far more cheaply by
   re-scheduling the actual note/hit triggers dotbeat already has full knowledge of — repeating
   the last `beatRepeatGrid`-sized window of `content.notes`/`content.hits` at the repeat cadence,
   for `beatRepeatGate` steps, gated by `beatRepeatChance` — directly inside `tick()`'s existing
   `chain.synth.triggerAttackRelease(...)`/`this.triggerDrum(...)` calls. That's scheduling logic
   living in `tick()`, not a new Tone audio-graph node. Real new code, but a materially cheaper
   difficulty class than "build a live buffer-capture DSP effect" would suggest.

---

## 5. Recommended new effects — format sketch + difficulty, in build order

All new fields follow `SYNTH_FIELDS`' existing conventions exactly: camelCase keys, canonical
elision (a "0"/"off" default that round-trips to *no line emitted*, same discipline as
`distortionMix`/`compMix`), units documented inline, and — because `AUTOMATABLE_SYNTH_PARAMS`
(`document.ts:306`) auto-derives from every `kind: 'number'` row in `SYNTH_FIELDS` — every numeric
field proposed below becomes automation-lane-capable for free, no extra format work.

### 1. Ping Pong Delay — build first

**Why first:** owner-named, Ableton-everyday, and the *cheapest* of the two owner-named asks by a
wide margin — `Tone.PingPongDelay` is a direct built-in with a native `.wet`, and the per-track
insert pattern (§4.1) already exists for `Tone.Distortion`/`Tone.BitCrusher` to copy.

**Format sketch** (3 fields, mirrors the `distortionAmount`/`distortionMix` and
`bitcrushBits`/`bitcrushMix` pairing convention):
```
{ key: 'pingPongTime', kind: 'number', default: 0.19 },     // seconds, per-side delay time
{ key: 'pingPongFeedback', kind: 'number', default: 0.3 },  // 0..1
{ key: 'pingPongMix', kind: 'number', default: 0 },         // 0..1; 0 = insert bypassed
```

**Engine wiring — near-free Tone.js wrapper.** New `Tone.PingPongDelay(pingPongTime,
pingPongFeedback)` per `SynthChain`/`DrumBus`, inserted after `bitcrush`, before `muteGain`
(`bitcrush.connect(pingPong); pingPong.connect(muteGain)`), `pingPong.wet.value =
p.pingPongMix` in `applyParams()`. ~10 lines × 2 (synth chain + drum bus) + `coerce()` defaults +
`disposeChain()` entries. No new architectural concept — literal repetition of the existing
distortion/bitcrush pattern with a different Tone class.

### 2. Beat Repeat — build second

**Why second:** the other owner-named ask, and genre-signature enough (EDM/hip-hop/glitch fills)
to be worth the extra scheduling work. Real new logic, but §4.3's insight caps the difficulty well
below "build audio-buffer DSP."

**Format sketch** (4 fields; deliberately scoped down from Ableton's full parameter set —
`Variation` and per-repeat `Pitch` are named as explicit follow-ups, not part of this first cut):
```
{ key: 'beatRepeatGrid', kind: 'number', default: 1 },       // 16th-steps per captured/repeated slice (1 = 16th, 0.5 = 32nd, 2 = 8th)
{ key: 'beatRepeatGate', kind: 'number', default: 0 },       // 16th-steps the effect stays active; 0 = off (canonical elision)
{ key: 'beatRepeatChance', kind: 'number', default: 1 },     // 0..1, probability each individual repeat fires
{ key: 'beatRepeatMode', kind: 'enum', default: 'insert', values: ['mix', 'insert', 'gate'] }, // matches Ableton's 3 mix modes exactly
```

**Engine wiring — moderate, scheduling-layer logic, not a new audio node.** Lives in `tick()`'s
per-track loop: when `beatRepeatGate > 0` and the current step falls inside an active gate window,
re-derive which note(s)/hit(s) fell in the most recent `beatRepeatGrid`-sized slice and re-trigger
them at the grid cadence instead of (or alongside, per `beatRepeatMode`) the track's normally
scheduled content for that window; roll a seeded RNG per repeat against `beatRepeatChance`. This is
the one recommended effect that **doesn't** follow §4.1's insert-node pattern — flag that
explicitly for whoever picks this up in Phase 18, since it's easy to reflexively reach for "new
Tone node" and get stuck trying to solve live-buffer capture Ableton didn't need to solve for a
pre-sequenced engine.

### 3. Expose the already-running Chorus-Ensemble / Phaser-Flanger — build third

**Why third:** the cheapest possible win by a different measure — the DSP has been running in
every session since whenever the mod-send bus was ported in, proven and unchanged; this is "wire
up what's already paid for," not new capability. Converts it from a shared, invisible,
un-configurable bus into a proper per-track insert (§4.2's reasoning for why shared-bus doesn't fit
the ask).

**Format sketch** (7 fields — larger than Ping Pong Delay's 3, but each maps 1:1 onto an existing
Tone.js constructor option already proven live in `engine.ts` today):
```
{ key: 'chorusMode', kind: 'enum', default: 'off', values: ['off', 'chorus', 'ensemble', 'vibrato'] },
{ key: 'chorusRate', kind: 'number', default: 1.5 },    // Hz
{ key: 'chorusDepth', kind: 'number', default: 0.7 },   // 0..1
{ key: 'chorusMix', kind: 'number', default: 0 },       // 0..1; 0 = insert bypassed
{ key: 'phaserRate', kind: 'number', default: 0.5 },    // Hz
{ key: 'phaserDepth', kind: 'number', default: 3 },     // octaves swept (Tone.Phaser's `octaves`)
{ key: 'phaserMix', kind: 'number', default: 0 },       // 0..1; 0 = insert bypassed
```
`chorusMode: 'vibrato'` reuses `Tone.Chorus` at `wet: 1` fixed with only the pitch-modulated
signal reaching the output (no dry blend) — matches Ableton's Vibrato mode's actual behavior, not
a new node.

**Engine wiring — low-moderate.** Same §4.1 insert pattern, ×2 nodes per chain. The only real
decision is retiring the current global `chorusBus`/`phaserBus`/`sendMod` machinery in favor of
per-track instances — a bigger diff than Ping Pong Delay's purely-additive change because it
*removes* code, but the removed code is small (a dozen lines in `getBuses()`) and nothing else
depends on `sendMod` existing in its current shared form. If Phase 18 wants to scope this smaller,
it splits cleanly into "chorus first" (4 fields) then "phaser second" (3 fields) — noted so it
isn't treated as an atomic must-ship-together unit.

### 4. Saturator — build fourth

**Why fourth:** everyday-tier character effect (§1), zero existing coverage beyond the generic
`distortionAmount`/`distortionMix` pair, and buildable entirely from `Tone.WaveShaper` — a
primitive Tone.js exposes directly, not a from-scratch audio node.

**Format sketch** (3 fields, deliberately scoped to a curve-family enum rather than Ableton's full
6-curve set + Base/Width/DC/Depth-envelope, which is real scope the doc flags rather than assumes
trivial):
```
{ key: 'saturatorCurve', kind: 'enum', default: 'analog', values: ['analog', 'warm', 'clip', 'fold'] },
{ key: 'saturatorDrive', kind: 'number', default: 0 },   // 0..1, input gain into the shaper
{ key: 'saturatorMix', kind: 'number', default: 0 },     // 0..1; 0 = insert bypassed
```

**Engine wiring — low-moderate.** One `Tone.WaveShaper` per chain (§4.1 pattern for insertion/
wet), fed by a small pre-gain for `saturatorDrive`; `saturatorCurve` selects among a handful of
hand-authored `Float32Array` curve functions (tanh-based soft clip for `analog`/`warm`, a
three-segment hard clip for `clip`, a `sin()`-based fold for `fold`) computed once per curve
change, not per sample. The one item on this list that needs authored DSP math rather than pure
node-wrapping — bounded (tens of lines), but real, unlike items 1 and 3.

### Deferred, with reasons (not part of the first four)

- **Auto Filter, Auto Pan, Tremolo** — Tone.js makes each individually near-free (`AutoFilter`/
  `AutoPanner`/`Tremolo`), but §2 found real (if generic) coverage already exists via the shared
  `lfoDest`/`lfo2Dest` matrix. Building dedicated devices mainly buys Ableton-authentic naming and
  independent-of-other-LFO-uses control, not new sonic capability — real value, but behind the
  four effects above that fill genuine gaps.
- **Redux's downsampling half** — cheapest possible follow-up (bit-reduction already ships), but
  needs a small custom downsampler since Tone.js has no built-in Rate/Jitter node; worth a quick
  look whenever Redux comes up again rather than its own build slot.
- **Utility** — genuinely near-free (`Tone.StereoWidener` + a couple of primitives), but per §1
  it's a mixing-hygiene tool more than the "sound effects/sound modifications" the owner's framing
  emphasized; good next-tier pick, not top-4.
- **Grain Delay, Vinyl Distortion, Resonators** — real DSP work (§3), each buildable from Tone.js
  primitives (`GrainPlayer`+custom capture, `WaveShaper`+`Noise`, a `Filter` bank respectively) but
  meaningfully bigger lifts than anything in the top four; good Phase 19+ candidates once the
  insert-chain pattern has a couple more proven additions behind it.
- **Corpus** — no Tone.js primitive gets close; realistically AudioWorklet-tier custom DSP.
  Exotic per §1's own ranking; lowest priority of everything researched.

---

## Sources

Ableton's official Live 12 manual (`ableton.com/en/manual/live-audio-effect-reference/`, partial
fetch — some device pages 404'd or weren't reachable directly and were cross-checked against
independent write-ups below); Sound On Sound ("Ableton Beat Repeat Plug-in",
`soundonsound.com/techniques/ableton-beat-repeat-plugin`); OBEDIA Beat Repeat walkthrough; the
Ableton user forum (Ping Pong Delay ducking/freeze behavior, Beat Repeat pitch/grid discussion);
homemusicmaker.com and Ask.Audio (Redux/bitcrusher parameter detail); Piano For Producers
(Saturator); MusicTech ("How to use Ableton Live's Phaser-Flanger device"); Tone.js's own docs
(`tonejs.github.io/docs`) for the effects-module class list and `PingPongDelay`'s constructor
options. This pass used targeted web search/fetch to ground specific parameter claims rather than
the full adversarial multi-source-verification harness research/07 and research/15 used — treat
device-parameter specifics as reasonably well-sourced but not independently 3-vote-verified.
