# Research 21 — openDAW's instrument/effect/device feature surface, for dotbeat's FX/instrument roadmap

*2026-07-11. Reads `/private/tmp/dotbeat-scratch2/opendaw` (shallow clone, commit `de7565a`) directly —
Rust/WASM DSP crates, the engine's audio-unit routing, and the studio UI's device-panel source. This
pass deliberately does **not** re-cover openDAW's data model, undo system, or bundle format —
`docs/opendaw-notes.md` already did that. It also does not re-recommend anything
`docs/research/17-track-fx-arsenal.md` already scoped (Ping Pong Delay, Beat Repeat, Chorus/Phaser
exposure, Saturator, and the deferred Auto Filter/Auto Pan/Tremolo/Redux/Utility/Grain Delay/Vinyl
Distortion/Resonators/Corpus list). This is the delta: **what openDAW's actual instrument/effect
inventory and device-chaining architecture look like**, and what's genuinely new relative to both of
those docs.*

> **License note (repeat of `opendaw-notes.md`):** openDAW is AGPL v3/LGPL-3.0-or-later. Everything
> below is vocabulary, parameter lists, and architecture — facts and ideas, not copyrightable, safe to
> reuse. No source is copied; every citation is a file path so the claim can be re-verified, not a
> quote of implementation.

---

## 1. openDAW's device model: a typed graph of swappable, reorderable devices — not a fixed insert set

### 1.1 The chain shape, per track/bus ("audio unit")

Read in full: `crates/engine/src/audio_unit/mod.rs:1-16` (module doc) and its field-key table
(`mod.rs:79-89`). Every `AudioUnitBox` (a track *or* a bus — see §2) hosts, as ordered
`IndexedCollection`s keyed by a device `index` field:

```
midi-effects chain (host key 21)  →  ONE instrument slot (host key 22)  →  audio-effects chain (host key 23)
                                                                              → channel strip → output (25)
```

Each collection can hold **an arbitrary number of devices, in arbitrary user-chosen order** — not a
fixed set of named inserts. `crates/engine/src/audio_unit/wiring.rs`'s reconcile logic rebuilds the
wired processor cluster whenever a chain reports dirty (add/remove/reorder), and every device box
carries an `enabled` boolean (`DEVICE_ENABLED_KEY = 4`, `mod.rs:97`) — a disabled effect is skipped in
wiring, i.e. a real per-device bypass toggle. In the studio UI this shows up as literal drag-and-drop
reordering: `packages/app/studio/src/ui/devices/DeviceDragging.ts` and
`DevicePanelDragAndDrop.ts` exist as dedicated modules, and the instrument slot itself is swappable
(any instrument box type can replace another — confirmed by the `InstrumentFactories.ts` /
`InstrumentBox.ts` factory pattern referenced from `packages/studio/adapters/src/factories/`).

**This is the single biggest architectural gap relative to dotbeat's current surface.** Per the task
brief, dotbeat has one implicit synth device per track and a fixed insert set (EQ3 → compressor →
distortion → bitcrush, per `ui/src/audio/engine.ts`'s `buildSynthChain()`, confirmed in research 17
§4.1) — no swappable instrument, no reorderable/addable effect list. openDAW proves the fully general
version of that idea (arbitrary devices, arbitrary order, per-unit) is what "modern DAW device chain"
actually means. See the candidate table (§3) for how much of this is actually worth adapting.

### 1.2 Instrument devices — five real synthesis/sample engines, plus two "escape hatches"

Read every `crates/stock-devices/device-*/src/lib.rs` header comment directly (all are `AudioEffect`/
`Instrument`/`MidiEffect` trait impls behind a common `abi` FFI, one crate = one `.wasm` device
plugin — see `crates/stock-devices/device-sine/src/lib.rs:1-12` for the plainest example of the
pattern).

- **Vaporisateur** (`device-vaporisateur/src/lib.rs:1-16`) — a polyphonic 2-oscillator subtractive
  synth: two band-limited oscillators (waveform/octave/tune/volume each), a modulated multi-pole
  low-pass (cutoff + resonance + filter envelope + keyboard tracking), an ADSR VCA, glide/portamento,
  one LFO routable to tune/cutoff/volume, and — genuinely new relative to dotbeat's synth — **unison**:
  1, 3, or 5 detuned/spread sub-voices per note (`voicing::VoiceUnison`, shared across all openDAW
  instruments via a `voicing` crate), dispatched either polyphonically or **monophonically** via an
  explicit `voicing-mode` parameter (`voicing::VoicingMode`). 16 voice slots, 16-deep mono stack, output
  brick-wall-limited. dotbeat's `SYNTH_FIELDS` (per research 17) already covers oscillator/filter/ADSR/
  dual-LFO territory closely — **unison width and an explicit poly/mono voicing mode are the two real
  gaps**, not the whole synth.
- **Nano** (`device-nano/src/lib.rs:1-15`) — the simplest possible sampler: one loaded sample, a
  pitch-rate read head with linear interpolation, a squared attack/release envelope, volume, release
  time. Fixed 64-voice pool. This is the *entire* feature set — proof that a useful one-shot sampler
  instrument is a genuinely small surface (4 fields: volume, sample pointer, release, +implicit pitch
  tracking).
- **Playfield** (`device-playfield-sample/src/lib.rs:1-40` + `crates/engine/src/composite.rs:1-16` +
  `plans/wasm-audio/playfield-composite.md`) — openDAW's multi-pad sampler ("Drum Rack" equivalent).
  Architecturally the most interesting device in the whole codebase: it is a **composite device**, a
  generic engine mechanism (not hardcoded to Playfield — `composite.rs:1-9` says explicitly "no box
  name or field key is hardcoded here") that hosts a child collection of full instrument slots, each
  with its **own** MIDI-effects chain, audio-effects chain, and voice model (windowed `start`/`end`
  sample region, **reversed playback automatically when `end < start`** — no separate reverse flag,
  `device-playfield-sample/src/lib.rs:2-3`; gate mode Off/On/Loop; per-slot mono-retrigger via
  `polyphone`; note-index assignment; choke groups via `EVENT_CHOKE`), all summed into one bus before
  the *parent* unit's own audio-effects chain and channel strip run. So a Playfield pad isn't just "a
  sample slot" — it's a nested instance of the entire device-chain machinery, one level down.
- **Soundfont** (`device-soundfont/src/lib.rs:1-15`) — a preset-based multi-sample player. Doesn't
  parse raw `.sf2`; the host pre-resolves it into a simplified blob (sample table + region table +
  preset table + normalized f32 PCM — SF2 "generators" already flattened on the main thread,
  `blob.rs`), then the device matches note+velocity against regions and **layers** every matching
  region as a separate voice. 128-voice pool. Notable mainly as "a real path to a huge free sample-
  library ecosystem" (General MIDI / SF2 soundfonts are a mature, freely-licensed format).
- **Sine** (`device-sine/src/lib.rs`) — a trivial fixed-ADSR test tone; not user-facing, listed for
  completeness (it's the "hello world" instrument the plugin ABI is demoed against).
- **Tape** (`packages/studio/forge-boxes/src/schema/devices/instruments/TapeDeviceBox.ts:1-11`) — not
  a device you pick from a menu; this is the instrument every **audio** track implicitly runs (mirrors
  dotbeat's own audio-clip tracks). Notably it isn't just "play back the region" — it carries four
  always-on unipolar knobs: **flutter, wow, noise, saturation** — literal tape-machine coloration baked
  into the audio-clip player itself, not a separate effect you have to add.
- **Two scriptable "escape hatches"**: **Apparat** (instrument, `device-apparat/src/lib.rs:1-10`) and
  its MIDI/audio-effect siblings **Spielwerk** (`device-spielwerk/src/lib.rs:1-9`) and **Werkstatt**
  (`device-werkstatt/src/lib.rs:1-9`) are all "thin Rust bridge, real DSP is user-authored JavaScript
  run in the host's AudioWorklet" — a user (or, notably for dotbeat, an *agent*) can write a custom
  instrument/MIDI-transform/audio-effect as a script that runs in the real-time audio thread. See §3
  for why this is tempting but in tension with dotbeat's format thesis.

### 1.3 MIDI-effect devices (pull-source, wired *before* the instrument)

All five read from `crates/stock-devices/device-{arpeggio,pitch,velocity,zeitgeist,spielwerk}/src/lib.rs`:

- **Arpeggio** — mode (Up/Down/UpDown), octave range 1-5, rate (one of 17 note-division fractions,
  whole-note to 1/128), gate (0-2× the rate, i.e. can overlap or leave gaps), repeat (1-16 grid steps
  per arp step), and a velocity "magnet" toward 1.0.
- **Pitch** — transpose semitones (±36), octaves (±7), cents (±50); a note-off replays the *same*
  shift its own note-on used, so a mid-note parameter change never detunes the release
  (`device-pitch/src/lib.rs:5-6`).
- **Velocity** — rewrites note-on velocity: pulled toward a "magnet" target/strength, jittered by a
  **per-note seeded random** (reseeded from `random-seed + note position`, so replay is deterministic
  and position-locked, `device-velocity/src/lib.rs:6-8`), offset, and blended by mix against the
  original.
- **Zeitgeist** — algorithmic groove/shuffle: warps note positions live via a per-cell "Moebius ease"
  curve (`device-zeitgeist/src/lib.rs:1-9`) — just two parameters, `amount` (unipolar swing amount) and
  `duration` (the swing grid size, one of 9 fixed note-division values). No groove-template file at
  all; the entire "make it swing" feature is two numbers and a closed-form curve.
- **Spielwerk** — the MIDI-side scriptable escape hatch (user JS note generator/transformer).

### 1.4 Audio-effect devices — the ones not already covered by research 17

Research 17 already covers (Ableton-vocabulary) Compressor/EQ/bitcrush/distortion/delay/chorus/
phaser/auto-filter/auto-pan/tremolo/beat-repeat/grain-delay/utility/vinyl-distortion/corpus/
resonators in detail. openDAW's audio-effect set overlaps heavily with that list under different
names (its Compressor at `device-compressor/src/lib.rs` is essentially the same CTAGDRC-style
feed-forward compressor already described in `docs/opendaw-notes.md` §1; its Crusher is a bitcrusher+
downsampler *combined into one device* — unlike dotbeat's plan to keep them separate fields, worth a
one-line note in §3). The genuinely new-to-both-docs items:

- **Revamp** — a **7-band parametric EQ** (`device-revamp/src/lib.rs:1-10`): high-pass, low-shelf,
  low-bell, mid-bell, high-bell, high-shelf, low-pass, each independently enable-able. The HP/LP bands
  have a selectable **order** (1-4 cascaded biquad sections = 1-4 poles of slope) plus Q; the three
  bell bands have gain+Q; the two shelf bands have gain only. This is a materially richer EQ than
  dotbeat's fixed 3-band `EQ3` (low/mid/high shelf-ish) or openDAW's own simpler devices — a real
  "parametric EQ" tier above what either currently has.
- **Delay** (`device-delay/src/lib.rs:1-10` + `fractions.rs`) — tempo-syncable stereo delay, richer
  than a plain ping-pong: **independent left/right pre-delay** (each its own sync-or-milliseconds
  choice), the main delay time (sync-or-milliseconds), feedback, a continuously-variable **cross-
  feedback** control (not a binary ping-pong toggle — lets you dial any amount of left/right bleed),
  a filter in the feedback path, and an **LFO that modulates the delay time itself** (wobble/tape-echo
  chorus-on-the-repeats), tempo-locked. Meaningfully richer than the `Tone.PingPongDelay` research 17
  scoped as the cheap build-first option.
- **Dattorro plate reverb** (`device-dattorro-reverb/src/lib.rs:1-10`) — a second, higher-quality
  reverb algorithm (pre-delay, bandwidth, two-stage input/decay diffusion, damping, and an
  **excursion rate/depth** — LFO-modulated diffusion-network delay lengths, the classic "shimmer" plate
  trick) alongside a simpler `Reverb` device (`device-reverb/src/lib.rs`, a Freeverb-family comb+
  allpass — decay/pre-delay/damp/wet/dry only). openDAW ships **two reverb quality tiers**, not one.
- **StereoTool** (`device-stereo-tool/src/lib.rs:1-10`) — volume/panning/stereo-width/per-channel
  invert/L-R swap, plus a selectable **pan law** (linear vs. equal-power). Close to Ableton's Utility
  (already noted as "Absent, deferred" in research 17) but with the pan-law choice added.
- **Tidal** (`device-tidal/src/lib.rs:1-10`) — auto-pan/tremolo, but the LFO shape is parametric
  (`slope` bipolar + `symmetry` unipolar continuously reshape the waveform) rather than a fixed
  waveform picker, and its phase is **locked to song position**, not free-running — tempo-accurate
  even after a transport jump. Richer than the `Tone.AutoPanner`/`Tone.Tremolo` research 17 scoped as
  near-free.
- **Vocoder** (`device-vocoder/src/lib.rs:1-9`) — carrier = main input; modulator is selectable:
  synthesized noise (white/pink/brown), **"self"** (the carrier used as its own modulator via a
  multi-band gate — classic "talking synth" trick with no external input needed), or **"external"**
  (a real sidechain input). Band count 8/12/16, per-band Q that varies across the spectrum (`Q-start`/
  `Q-end`), envelope attack/release, gain, mix. Not in research 17 at all.
- **NeuralAmp** (`device-neural-amp/src/lib.rs:1-13`) — a neural-network guitar/bass amp/cab model
  (`.nam` file format, the same inference core the TS engine also uses — `NeuralAmpModelerCore`),
  content-addressed model file as a graph pointer, input/output gain, mono downmix, mix. Real ML
  inference in the render path.
- **Fold** — a wavefolder (drive, 2×/4×/8× oversampling, output volume) — a different distortion
  family from Saturator/Waveshaper, not covered by research 17's 13-item Ableton list.
- **Gate** — noise gate with sidechain, floor (a 3-point decibel curve, not linear), hold, invert.
  Same generic "any effect can declare a sidechain port" mechanism as Compressor (§2).

---

## 2. Mixer / bus / send architecture

Read `crates/engine/src/audio_unit/mod.rs` (field keys), `routing.rs` (send/output/sidechain
resolution), `crates/engine-env/src/channel_strip.rs`, and `crates/engine-env/src/aux_send.rs` in full.

- **A "unit" is either a track or a bus — the same box type, `AudioUnitBox`** (`type` field, values
  Instrument/Bus/Aux/Output per `docs/opendaw-notes.md` §1, re-confirmed here in
  `crates/studio-boxes/src/registry.rs:44`). A bus is not a special fixed thing — it's a unit whose
  `input` device happens to be an `AudioBusBox`, which becomes a summing point (`wiring.rs`'s
  `reconcile_bus` comment, "the RETURN/submix-bus path... build a summing bus, register it so sources
  route in, run the bus's own audio-effect chain over it, then a channel strip").
- **Buses can feed other buses, arbitrarily, with cycle detection.** `routing.rs:158` and `:319` both
  call `self.context.would_cycle(...)` before wiring a strip or a send into its target — a real
  submix-tree mixer, not a fixed track→return→master hierarchy. No user-created-bus concept exists in
  dotbeat today (per the task brief); this is a large generalization, flagged but not recommended
  near-term (§3).
- **Channel strip = volume(dB) + panning + mute only** (`channel_strip.rs:1-5`, `StripParams`). Its
  pan law is explicitly **linear balance** (center = unity on both channels), *not* equal-power/
  constant-power (`channel_strip.rs:118-128`'s `retarget`: `(1.0 - panning.max(0.0)) * gain` — no
  square-root/sine curve). **Solo is resolved centrally by the engine across the whole mixer**
  (`forced_silent: Cell<bool>`, `channel_strip.rs:30-33` — "SOLO is a cross-strip MIXER fact... the
  strip node never reads this [directly for its own solo state]"), not handled inside any one strip.
- **Aux sends are parallel, tap POST-effects/PRE-fader** (`aux_send.rs:1-2`: "taps a unit's
  POST-effects / PRE-fader buffer"). Concretely: signal flows unit's `audio-effects chain → [send taps
  here] → channel strip (fader/pan/mute) → output`. This means moving a track's volume fader does
  **not** change how much of it reaches a reverb/delay bus — the send level is fixed relative to the
  post-insert-FX signal, independent of the fader. This is the conventional choice across most DAWs
  (Ableton, Cubase, Logic all default sends pre-fader-of-the-*bus*-but-post-insert too) — worth stating
  explicitly as a deliberate convention dotbeat should also commit to, not an openDAW-specific quirk.
  Each send has its own gain(dB) + pan (`aux_send.rs:27-30`, `SendParams`).
- **Sidechain routing is generic, not hardcoded per-effect.** Any device that declares a sidechain
  port (Compressor `[30]`, Gate `[30]`, Vocoder `[30]`) resolves it the same way: follow a pointer to
  a target box, prefer that target's own *raw* output if it was built as a device, else fall back
  through the target's `host` pointer to the owning unit's strip output
  (`routing.rs:60-75`, `resolve_one_sidechain`). So sidechain sources can be another track, a bus, or
  even a specific device's raw pre-chain signal — one mechanism reused by every sidechain-capable
  device, not three separate hand-wired paths.
- **Automation resolves at a fixed "update clock" grid (every 10 pulses), not per-sample**, for
  channel-strip volume/pan/mute *and* aux-send gain/pan (`channel_strip.rs:265-291`,
  `aux_send.rs:203-228` — both split each render block at the same grid and re-resolve). A paused
  (non-transporting) block **holds** the last resolved automated value rather than re-evaluating the
  curve at the free-running paused position (explicitly tested,
  `channel_strip.rs:321-353`) — a specific, easy-to-miss correctness detail for anyone building
  sample-accurate automation later.

---

## 3. Candidate features for dotbeat — adopt / adapt / skip

Mirrors the judgment style of `docs/research/18-ableton-ui-architecture.md` Part II (own-idea
sections + the Macros/Racks table): every row states dotbeat's actual format-thesis tension, not just
"this would be nice." Rows are roughly ordered by how load-bearing the idea is, most consequential
first.

| # | Feature | One-line description | Verdict | Reasoning |
|---|---|---|---|---|
| 1 | **Ordered, reorderable, per-track effect list** | Instead of a fixed EQ→comp→dist→bitcrush insert order, a track states an explicit ordered list of effect blocks. | **Adapt** | openDAW's full version needs pointer-addressed `IndexedCollection`s + an `index` field + runtime reconciliation — real indirection, disproportionate to dotbeat's text-file format. But the *outcome* (order matters, effects are addable/removable/reorderable) is achievable with **zero indirection**: make effect-block order in the file *be* the chain order (a literal ordered list of `effect <type> <params...>` lines under a track, same discipline as note/hit lines today). This is actually *more* diff-friendly than openDAW's own scheme (reordering two effects = a 2-line move, not a numeric `index` field edit) — worth building, but as flat ordered text, never as boxes+pointers. |
| 2 | **Explicit instrument-type selector per track (synth / one-shot sampler / audio-tape)** | A track states which instrument engine it uses instead of dotbeat's implicit "every track is a synth" assumption. | **Adapt** | dotbeat's brief says instrument tracks exist today "beyond basic instrument tracks" only weakly. openDAW's Nano (4 fields: volume, sample, release, pitch-tracking) proves a useful one-shot sampler instrument is genuinely small — a `kind: sampler` track with 3-4 literal fields is proportionate. Vaporisateur-style unison/voicing-mode is a smaller, bounded addition to the existing synth field set, not a new instrument. |
| 3 | **7-band parametric EQ (Revamp) replacing/extending EQ3** | HP/LP with selectable slope order + Q, 3 bell bands (freq/gain/Q), 2 shelf bands (freq/gain), each independently enabled. | **Adopt** | Same shape as dotbeat's existing per-field-set devices (EQ3, compressor) — no architecture change, just more fields with an `enabled` bit per band. Genuine capability gap: EQ3 can't do a real bell/parametric cut. Natural next tier after research 17's build-next-four; not owner-named yet, but a clean, proportionate win. |
| 4 | **Continuously-variable delay cross-feedback + delay-time LFO wobble** | Add `crossFeedback` (0..1, not a binary ping-pong toggle) and delay-time LFO rate/depth to the Ping Pong Delay research 17 already scoped as build-first. | **Adapt** | Same insert-node pattern research 17 §4.1 already validated (`Tone.PingPongDelay` + a couple more fields); fold into that same build rather than opening a second delay device. Cheap, proportionate, meaningfully richer sound than plain L/R alternation. |
| 5 | **Per-note-position-seeded deterministic randomization** | Velocity device's `random-seed + note position` reseed pattern, so probabilistic effects replay byte-identically. | **Adopt (as a technique, not a device)** | Directly relevant to research 17's Beat Repeat `beatRepeatChance` field (§5.2 there) and any future humanize/velocity-jitter feature: seed the RNG from note position, not a global stream, so re-rendering the same document is bit-for-bit reproducible — matches dotbeat's diff/determinism goals better than a global seed would. Cross-cutting implementation note, cheap to apply wherever randomness appears. |
| 6 | **Algorithmic groove/shuffle (Zeitgeist)** | Two literal fields (`shuffleAmount`, `shuffleGrid`) drive a closed-form per-cell timing warp — no groove-template file/import. | **Adopt** | If dotbeat doesn't already have a swing/groove mechanism, this is a far cheaper, more format-native path than importing groove-template assets (which would need their own asset type and reference indirection): two numbers, one small pure function, fully literal in the file. Worth checking against current format-spec before scoping, but architecturally trivial to fit. |
| 7 | **Tape-emulation knobs on audio-clip tracks (flutter/wow/noise/saturation)** | Bake 4 unipolar "tape character" fields into the audio-clip/region player itself, not as a separate effect. | **Adopt** | Cheap (4 fields, one small DSP block), on-brand ("small, evocative, literal knobs" matches dotbeat's existing `SYNTH_FIELDS` style exactly), and adds real character to any audio-clip track with no new architecture. Good near-term pairing with research 17's Saturator (build-next #4) — could even share the saturation curve code. |
| 8 | **Generic, pointer-free sidechain (any device, any target)** | Instead of hardcoding sidechain to compressor only, let any dynamics-family device (gate, future vocoder) reference another *track* as its detector, by human slug not opaque UUID pointer. | **Adapt** | The *principle* (one resolution mechanism reused by every sidechain-capable device) is worth adopting; the *mechanism* (graph pointer walked at engine-reconcile time) is not — dotbeat should spell the reference as a literal track-slug field (`sidechainFrom: kick`), consistent with `docs/decisions.md` D4's "human slug over raw UUID at the text boundary," already validated once in `opendaw-notes.md` §6. |
| 9 | **Pre-fader, post-insert-FX send semantics, stated explicitly** | Confirm/commit dotbeat's existing reverb/delay sends tap the signal after per-track inserts but before the volume fader — the conventional choice, not an accident. | **Adopt (as a documentation/verification item, not new code)** | Cheap to get right, easy to silently get wrong (a send that moves with the fader surprises anyone who's used another DAW). Worth a one-line check against `ui/src/audio/engine.ts`'s current send wiring and an explicit note in the format/engine docs either way. |
| 10 | **Composite/nested per-pad effect chains (Playfield-style drum rack)** | Each drum-lane sample gets its own independent mini device chain (not just gain/tune), summed before the track's own chain. | **Skip (mostly) — see research 18's existing verdict** | Research 18 already ruled: "dotbeat's five fixed drum lanes already are a minimal drum rack... lean on that, don't rebuild it." This pass doesn't find new information that overturns that — the *nested full device chain per pad* is real added scope (recursion into the same swappable-chain machinery item #1 already flags as disproportionate), so it inherits that same "not now" verdict. The one narrow exception worth flagging separately: a small **fixed** per-lane insert (e.g. one distortion/filter field pair per lane, no reordering, no swapping) would fit dotbeat's existing flat-field-set discipline — but that's "grow the drum lane's field set," not "adopt composites." |
| 11 | **Two-tier reverb (simple Freeverb-style + a higher-quality Dattorro plate)** | Ship both a cheap algorithmic reverb and a richer plate algorithm with LFO-modulated diffusion ("shimmer"). | **Skip for now** | dotbeat doesn't yet have a *per-track configurable* reverb at all (only a shared bus send, per the task brief) — offering two quality tiers is a refinement on a feature that doesn't exist yet. Worth a one-line callback ("consider two tiers") whenever reverb becomes a real per-track device, not before. |
| 12 | **Vocoder (carrier/modulator, incl. self-modulation and external sidechain)** | Full multi-band vocoder with selectable modulator source. | **Skip** | Real DSP effort (multi-band filter bank + per-band envelope followers), not on research 17's radar, and a distinctly genre-signature/exotic effect (same tier as Corpus/Resonators, which research 17 already deferred for the same reason). Revisit only after the research-17 top-four and the EQ upgrade (#3) ship. |
| 13 | **Neural amp modeling (.nam-file-based guitar/bass amp sim)** | Load a neural-network amp/cab model file, run real-time inference in the render path. | **Skip** | Requires an ML inference runtime in the audio path plus a content-addressed external-model-file ecosystem — large, out-of-proportion infrastructure lift for a niche (guitar-amp-sim) use case relative to dotbeat's current scope. The *content-addressed model asset* idea is mildly interesting for a future sample-library design, but not worth pursuing for this alone. |
| 14 | **Scriptable user/agent-authored devices (Werkstatt/Apparat/Spielwerk)** | A device whose real DSP is user (or agent-generated) JavaScript executed in the real-time audio thread; the box graph only stores script text + params. | **Skip, with the strongest reasoning in this table** | This looks tempting for an *agent-native* DAW — "let the agent write a custom effect" — but it is the audio-DSP-tier version of exactly the anti-pattern research 18 already flagged for Ableton's macros: **the file would no longer state the sound, it would state a program that computes it.** A `.beat` file with an embedded script device means the diff shows the *code* changed, not what the *sound* did — the opposite of "a single-parameter change produces a single-line diff" (`format-spec.md` Goal 1). It also reopens the "opaque address you must walk the schema/interpreter to resolve" problem `opendaw-notes.md` §5 already flagged as the wrong direction for dotbeat's bundle format, now at the DSP-code level instead of the field-storage level. If agent-generated sound design is wanted, the format-consistent version is what dotbeat already does for presets and what research 18 recommended for macros: an agent computes and writes literal field values (a new effect device with real fields, or a preset), never a stored program. |
| 15 | **Modular "front-panel" macro-knob device (arbitrary knob → pointer to any parameter, anywhere)** | A device that hosts user-placed knobs, each bound via a graph pointer to a target parameter on any other device in the project. | **Skip, exactly per research 18's existing macro verdict — this is independent confirmation, not new information** | openDAW's `ModularDeviceBox`/`DeviceInterfaceKnobBox` (`packages/studio/forge-boxes/src/schema/devices/modular.ts:12-41`) is a real, shipped implementation of precisely the indirection-layer pattern research 18 §"Macros" already examined for Ableton and ruled: adopt the *ergonomics* as tooling that emits literal edits, skip it as in-file/in-graph indirection, because it breaks "every value is directly in the file." Seeing it actually built in a competitor doesn't change that reasoning — if anything it's a second, independent data point that this is a common request (Ableton *and* openDAW both grew one), which strengthens the case for solving it at the tooling layer (a macro-preset system, per research 18) rather than deferring it forever. |
| 16 | **Arbitrary bus-to-bus submix tree with cycle detection** | User-created buses that can themselves feed other buses, not a fixed track→return→master hierarchy. | **Skip for now** | Large mixer-architecture generalization; dotbeat has no user-created-bus concept yet at all (only fixed shared reverb/delay/mod sends, per the task brief). Worth keeping openDAW's `would_cycle` check (`routing.rs:158`) in mind as "the one correctness trap" *if* dotbeat ever builds user buses, but not a near-term ask. |
| 17 | **Combined bitcrush+downsample as one "Crusher" device** | openDAW's Crusher unifies bit-depth reduction and sample-rate reduction (crush/bits/boost/mix) in one box, vs. dotbeat's plan (research 17) to add a separate downsampling field pair alongside the existing `bitcrushBits`. | **Adapt (naming/grouping note only)** | Not a new capability — research 17 §5 already flags Redux's downsampling half as a "quick look whenever Redux comes up again." Worth folding the two into one `crush`-style field group (unified mix, shared enable) rather than two independently-toggled devices, purely for UX/field-count economy — a scoping note for whoever builds it, not a new feature. |

### Net read

The one idea in this table big enough to change dotbeat's roadmap shape is **#1 (ordered per-track
effect chains)** — everything else here is either a bounded field-set addition in dotbeat's existing
style (rows 2-9, 17) or explicitly out of proportion and flagged as such with the same reasoning
research 18 already established for Ableton's Racks/Macros (rows 10, 14, 15 especially). If dotbeat
builds #1 as flat ordered text (no pointer/index indirection), it unlocks most of the rest of this
table "for free" as an *arrangement* question rather than a new mechanism each time.

---

## Sources

Direct reads of `/private/tmp/dotbeat-scratch2/opendaw` (shallow clone, commit `de7565a`):
`crates/stock-devices/device-{apparat,arpeggio,compressor,crusher,dattorro-reverb,delay,fold,gate,
maximizer,nano,neural-amp,pitch,playfield-sample,revamp,reverb,sine,soundfont,spielwerk,stereo-tool,
tidal,vaporisateur,velocity,vocoder,waveshaper,werkstatt,zeitgeist}/src/lib.rs`; `crates/engine/src/
audio_unit/{mod,wiring,routing}.rs`; `crates/engine/src/composite.rs`; `crates/engine-env/src/
{channel_strip,aux_send}.rs`; `crates/studio-boxes/src/registry.rs`; `plans/wasm-audio/
playfield-composite.md`; `packages/studio/forge-boxes/src/schema/devices/modular.ts`;
`packages/studio/forge-boxes/src/schema/devices/instruments/TapeDeviceBox.ts`;
`packages/app/studio/src/ui/devices/{DeviceDragging.ts,DevicePanelDragAndDrop.ts,panel/
DevicePanel.tsx,audio-effects/ModularDeviceEditor.tsx}`. Cross-read against
`docs/opendaw-notes.md` (prior archaeology pass, data model/engine-UI split/undo/bundle format —
not repeated here), `docs/research/17-track-fx-arsenal.md` (Ableton FX arsenal, already-scoped
build order), and `docs/research/18-ableton-ui-architecture.md` Part II (the Macros/Racks
adopt-as-tooling verdict this doc's rows 10/14/15 explicitly build on rather than re-litigate).
