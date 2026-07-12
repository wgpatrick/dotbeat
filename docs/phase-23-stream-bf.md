# Phase 23 Stream BF — Custom DSP FX bundle: Grain Delay, Vinyl Distortion, Resonators

*2026-07-11.* Closes research 17 §5's "meaningfully bigger lift" list — the three effects Phase 22
Stream AC's build-next-four deferred (`docs/phase-22-stream-ac.md`): Grain Delay, Vinyl Distortion,
Resonators. Real custom DSP, not thin Tone.js wraps — the explicit framing of this stream. Corpus
(research 17: "no Tone.js primitive gets close, AudioWorklet-tier") stays not-started, per scope.

## Starting state: a stale worktree

This worktree's branch was seeded from a synthetic 60-commit history disjoint from real `main` (no
common ancestor — `git merge-base` returned nothing) and predated `docs/phase-23-plan.md` and all of
Phase 22 entirely. Working tree was clean with zero unique commits, so the branch was reset to real
`main` at `bf8cb3c` before any of this stream's work began. Recorded here in case a sibling stream's
worktree shows the same symptom — the fix is a plain `git reset --hard <main-tip>` once you've
confirmed (via `git status`) there's no uncommitted work to lose.

## Design decision: these three are REAL `EffectType` chain members, unlike Stream AC's four

The task brief was explicit: "Your 3 new effect types are ADDITIVE entries to the existing
`EffectType` enum" (`src/core/document.ts`). This is a deliberate step past Stream AC's own
precedent, not a copy of it. Stream AC's four (saturator/chorus/phaser/pingPong) are **fixed,
always-wired inserts** living outside Stream AA's reorderable `effects` list — AC's own doc
explains why: `EffectType` didn't cover them at the time, and reconciling them into AA's new
architecture was left as "a real follow-up." This stream IS that follow-up, at least for the three
new types it owns: `grainDelay`/`vinylDistortion`/`resonator` are genuine `EffectType` values, only
ever wired into a track's live audio graph when its `effects` list actually contains one — same
`buildEffectRuntime`/`reconcileEffectChain` machinery every original type already uses. No new
subsystem: `EFFECT_TYPES` gained three entries, `buildEffectRuntime`/`applyEffectParams` gained
three `switch`/`if` branches, and that's the whole integration surface into Stream AA's chain.

**Consequence for `defaultEffectChain()`.** `EFFECT_TYPES` used to double as both "every legal
chain-member type" AND "the four types the implicit default chain contains" (`defaultEffectChain()`
used to be `EFFECT_TYPES.map(...)` directly). Widening `EFFECT_TYPES` to seven members without
separating those two concerns would have silently changed what "a synth track that never mentions
`effect` lines" means — every pre-existing `.beat` file's migration target, and Stream AA's whole
byte-identical-round-trip guarantee, would have picked up three new always-enabled effects nobody
asked for. Fixed by introducing `LEGACY_DEFAULT_EFFECT_TYPES` (the original four, unexported,
internal to `document.ts`) as the sole source `defaultEffectChain()` reads from; `EFFECT_TYPES`
stays the full seven-member validation/UI list. `test/format-v10-effects-bf.test.ts`'s first two
tests pin this down directly — regressing it would have been the single easiest way to quietly
break every existing project in the repo.

**Consequence for scope: no drum-bus wiring.** Because these three are real chain members and the
`effects` field is synth-tracks-only (Stream AA: "drum tracks... never carry `effect` lines"), they
get **no** `DrumBus`/`getDrumBus()`/`applyDrumBusParams()` equivalent — a deliberate decision, not
an oversight. `grainDelay*`/`vinyl*`/`resonator*` fields still exist in every track's synth block
(including drum tracks', since `BeatSynth` is one shared shape all tracks carry) but sit inert
there, same as any other synth-only field a drum track's block also carries but the drum bus never
reads (e.g. `wtPos`). The alternative — building a fourth "always-on fixed insert" pair the way
Stream AC did — would have doubled this stream's engine surface for a track kind the brief didn't
ask about, and would have made these effects LESS consistent with the reorderable-chain model the
brief explicitly asked for, not more.

## Grain Delay — a hand-built network around `Tone.PitchShift`

Research 17 §5's own suggested shape was "`Tone.GrainPlayer` + custom capture." That's the wrong
primitive for a real-time INSERT effect: `GrainPlayer` plays a pre-loaded `AudioBuffer` with
granular controls — it is not built to grain its own *live* input, and adapting it into one would
need a rolling capture buffer with no Tone.js primitive to build it from (the same class of problem
Beat Repeat sidesteps at the *scheduling* layer, per research 17 §4.3 — but that shortcut only
works because Beat Repeat's character lives in note/hit re-triggering, not in the audio signal
itself; Grain Delay's character is the signal).

`Tone.PitchShift` is the more honest primitive available: it implements a **real granular
pitch-shifting algorithm internally** — overlapping windowed delay-line grains, with `windowSize`
exposed directly as a public property. That is, structurally, exactly what a hardware/plugin
"shimmer"/grain-delay pedal does: a delay line feeding a granular pitch-shifter, usually *inside*
the delay's own feedback loop so each successive repeat is pitched again. `buildGrainDelay()`
(`ui/src/audio/engine.ts`) hand-builds that topology from primitives — `Tone.Delay` + a feedback
`Tone.Gain` + `Tone.PitchShift`, wired `delay -> pitchShift -> feedback -> back into delay`, wet tap
taken *after* `pitchShift` (so even the first, pre-feedback repeat already carries the granular/
pitched character) — the same "hand-built network, not a single dropped-in class" discipline
Stream AC's ping-pong delay established, rather than either a naive `PitchShift`-as-effect
one-liner (no delay/feedback character at all) or chasing `GrainPlayer` into
live-buffer-capture territory research 17 explicitly scopes as its own, bigger, AudioWorklet-tier
problem (the same tier Corpus stays out of this stream for).

Five fields: `grainDelayTime` (base delay, seconds), `grainDelayFeedback` (0..1, clamped to **0.92**
not 1 — see below), `grainDelaySize` (the grain window, seconds — small = audibly choppy/grainy,
large = smooth), `grainDelayPitch` (semitones, applied *every* pass through the feedback loop, so
repeat *N* is pitched *N* × `grainDelayPitch` from the original — the classic ascending/descending
shimmer signature), `grainDelayMix`.

**Why feedback is capped at 0.92, not 1** (a real, deliberate choice, documented in code): unlike
Ping Pong Delay's plain delay-line feedback (no per-pass gain-adding side effect, safely allowed up
to 1 elsewhere in `engine.ts`), `Tone.PitchShift`'s own grain algorithm adds a small amount of
processing energy each pass. A feedback loop allowed to hit unity gain here can slowly build toward
a hot signal over a long render. 0.92 still reads as "near-infinite" repeats musically while keeping
every render numerically stable.

## Vinyl Distortion — WaveShaper saturation + a SEEDED noise bed, not `Tone.Noise`

Research 17 §5: "`Tone.WaveShaper` + `Tone.Noise`" — the harmonic-distortion half maps directly
(same authored-curve discipline as Saturator's `buildSaturatorCurve`, a mild asymmetric tanh
soft-clip standing in for "worn tape/record playback" character rather than a harsh digital clip).
The noise half does **not** use `Tone.Noise` directly, for a reproducibility reason specific to this
task: `Tone.Noise`'s buffer generation has no public seed API (it draws from `Math.random()` at
construction), so two renders of the exact same document would sound different — breaking the
contract every other stochastic element in this codebase honors (`seededRoll`/`chanceFires` in
`engine.ts`, `makeRng` in `src/vary`). Instead, `buildVinylNoiseBuffer()` hand-generates a mono
buffer (one-pole-lowpassed white noise for a softer "surface hiss" texture, plus sparse seeded
crackle pops) via `makeNoiseStream(seed)` — a proper **streaming** mulberry32 generator (state
advances across calls), distinct from the one-shot `mulberry32(seed)`/`hashSeed(...)` pair already
in this file for per-event dice-rolls (chance/ratchet/Beat Repeat). The seed is
`hashSeed(trackId, effectId, 'vinylNoise')`, threaded down through `buildEffectRuntime` (which
needed a `trackId` parameter added — previously only `applyParams`/`reconcileEffectChain` at the
call-site level knew the track id; now threaded through to `buildEffectRuntime` too, the one place
that actually needs it). The buffer loops continuously through a `Tone.Player`, independent of
whatever's on the track's input — real vinyl surface noise doesn't wait for a note to play, and
neither does this.

**Known simplification, documented rather than silently accepted**: the seed is *not* also derived
from anything render-invocation-specific, so it's deterministic per (track id, effect id) — the
same document always renders the same noise character (the actual bar), but two DIFFERENT tracks
that both add a `vinylDistortion` instance with the SAME effect id (unusual — ids are track-scoped,
so this only happens if a user names them identically on purpose) would get identical noise
buffers. A real, minor, low-priority gap; not the reproducibility property that matters (same
document, same render).

Four fields: `vinylDrive` (waveshaper pre-gain), `vinylNoiseLevel` (0 = no noise bed, canonical
elision default), `vinylTone` (a lowpass tilt over the combined wet signal — dull/muffled at 0,
brighter at 1), `vinylMix`. `vinylNoiseLevel`'s downstream gain is headroom-capped at 0.35 so even
`noiseLevel=1` sits under typical signal level, not over it — a real noise *floor*, matching what
"surface noise" means on an actual record rather than a noise wall.

## Resonators — a bank of 5 tuned bandpass `Tone.Filter`s

No dedicated Tone.js class exists (that tier of problem is Corpus's, explicitly out of scope), but
a parallel bank of narrow bandpass filters is a reasonable, honestly-approximate physical-resonance
model: each filter rings at its own tuned frequency when excited by a broadband transient, and Q
sets how narrow — and therefore how long-ringing — that resonance is, the closest a plain biquad
filter bank gets to a physical resonator's own decay time. `buildResonatorBank()` wires 5 parallel
`Tone.Filter({type:'bandpass'})` nodes fed from one input, summed into one wet path.

Four fields: `resonatorFreq` (Hz, the bank's root), `resonatorChord` (which interval set the 5
filters sit at, relative to the root — `fifths`/`major`/`minor`/`octaves`/`harmonic`, semitone
offset tables in `RESONATOR_CHORD_OFFSETS`; `harmonic` approximates the first 5 real harmonic-series
partials in equal temperament: 0, 12, 19, 24, 28 semitones), `resonatorQ` (0.5..200, the
ring/decay proxy), `resonatorMix`. Frequencies are clamped to `[40Hz, nyquist-200Hz]` per filter so
an aggressive root + `octaves` chord (offsets up to +48 semitones = 4 octaves) can't alias.

## Format / edit / diff / inspect: zero changes needed beyond the enum

Every non-`document.ts` layer of the v0.10 effect-chain grammar (`parse.ts`'s `isEffectType`/
`EFFECT_TYPES.join('|')` error message, `serialize.ts`'s `serializeEffectLines`, `edit.ts`'s
`addEffect`/`removeEffect`/`moveEffect`/`setEffectEnabled`, `diff.ts`'s `diffEffects`,
`inspect.ts`'s chain summary) already reads `EFFECT_TYPES` generically — none of it needed a single
line changed. Same on the GUI side: `SynthPanel.tsx`'s Effect Chain panel (add-type dropdown, rows,
drag/move/bypass/remove) iterates `EFFECT_TYPES`/`EFFECT_LABELS` generically too. This is the
concrete payoff of Stream AA's original design choice to make the chain grammar fully data-driven —
adding three effect types touched exactly the two places that actually needed to know what a
`grainDelay` *is* (`document.ts`'s field declarations, `engine.ts`'s DSP), and nothing that only
needed to know *that* it's a legal chain member.

## What this stream did NOT do

- **No Corpus.** Explicitly out of scope per the task brief and research 17's own AudioWorklet-tier
  framing; left not-started.
- **No drum-bus equivalent** for any of the three — a documented scope decision (see above), not an
  oversight.
- **No LFO-destination additions** for the new `*Mix` params — same precedent Stream AC set for its
  four (automation lanes already cover it for free via `AUTOMATABLE_SYNTH_PARAMS`, since every new
  field is `kind: 'number'`).
- **No second, independently-parameterized instance of the same type** — the same pre-existing
  Stream AA scope cut every original type already has (multiple `grainDelay` instances on one track
  would share the one `grainDelayTime` etc.).

## Result / Verification

`npm run build` (root) and `ui/`'s `tsc --noEmit` both clean. `npm test`: 499/499 passing (up from
490 at session start; `test/format-v10-effects-bf.test.ts` is new — 9 tests covering the
`defaultEffectChain()` non-regression, migration non-contamination, add/remove/move/bypass on the
new types, diff/inspect reporting, canonical elision of the new `SYNTH_FIELDS`, and enum validation).

Live verification (`node ui/verify-phase23-stream-bf.mjs`, real `beat daemon` + the real built
frontend in headless Chromium, real recorded/analyzed audio via `src/metrics`' `analyze()`):

- **GUI**: the Effect Chain panel's add-type dropdown lists all three new types
  (`eq3, comp, distortion, bitcrush, grainDelay, vinylDistortion, resonator`); adding `resonator`
  through the real dropdown+button click grows the file to 5 `effect` lines (the last being
  `effect resonator resonator`) and the DOM shows the new row with `data-effect-type="resonator"`.
- **GRAIN DELAY**: a single A3 (220Hz) blip, delay off vs on (`time=0.3s`, `feedback=0`,
  `pitch=+7` semitones — one isolated repeat). Measured: a second energy peak lands **0.336-0.342s**
  after the original (grainDelayTime=0.3s), well above the pre-note silence floor — a real repeat,
  not a no-op. Goertzel-measured energy ratio at the pitch-shifted frequency (220×2^(7/12)≈329.6Hz)
  vs the original fundamental (220Hz): the clean, undelayed blip (measured from the OFF take)
  shows ratio **0.077-0.087** (almost no energy at 329.6Hz, as expected for a pure A3), while the
  ON take's repeat window shows ratio **1.72-1.80** — a >20x jump, real granular pitch-shift
  character, not a plain unpitched echo. Stable across two independent runs.
- **VINYL DISTORTION — noise floor**: silence (no note at all), `vinylNoiseLevel=0` vs `0.8`.
  Measured RMS: **1.51e-5 -> 2.14-2.15e-2**, a >1400x rise, even with nothing "playing" — the
  seeded noise bed is a genuine continuous background layer, not gated by note activity.
- **VINYL DISTORTION — harmonic distortion**: quiet held pure sine (A3), `vinylDrive=0` vs `1`.
  Goertzel harmonic-to-fundamental ratio (the same THD-style proxy Stream AC's Saturator test
  established): **0.090 -> 0.35-0.38**, roughly a 4x rise — real added harmonic content, not a
  level change.
- **RESONATORS**: broadband noise excitation (the synth's own `noiseLevel=1` layer) through the
  bank, off vs on (`freq=220`, `chord=fifths`, `Q=40`, `mix=1`). Measured tuned/control energy
  ratio (5 tuned frequencies at 220/329.6/440/659.3/880Hz vs geometric-midpoint off-tuned control
  frequencies): **~90-150 (off) -> 500-1020 (on)**, a 5-7x further concentration on top of an
  already-uneven noise spectrum — real spectral energy concentration at the tuned frequencies when
  the bank engages, not just a level change.

Both runs (rerun twice per this project's flakiness-check convention) passed with consistent,
stable numbers — see the script's own console output for the exact figures on any given run.

## Files touched

Core: `src/core/document.ts` (`EffectType`/`EFFECT_TYPES`/`LEGACY_DEFAULT_EFFECT_TYPES`,
`ResonatorChord`/`RESONATOR_CHORDS`, 14 new `SYNTH_FIELDS`). Engine: `ui/src/audio/engine.ts`
(`GrainDelayNodes`/`VinylNodes`/`ResonatorNodes` + their `build*`/`apply*`/`*NodeList` functions,
`makeNoiseStream`, `EffectRuntime`/`EngineSynth`/`coerce()` extensions, `trackId` threaded through
`applyParams`/`reconcileEffectChain`/`buildEffectRuntime`), `ui/src/types.ts`,
`ui/src/components/synthParams.ts` (three new `PARAM_GROUPS`), `ui/src/components/MixerView.tsx`
(three new `FX_BADGES`). CLI: `cli/beat.mjs` (usage line only — `effect-add`'s own validation was
already generic). MCP: `src/mcp/server.ts` (`beat_effect_add`/`beat_set` docstrings). Docs:
`docs/format-spec.md`, `scripts/roadmap-data.mjs` (the combined row split into three `done` rows),
`docs/product-roadmap.md` (regenerated), this file. Tests: `test/format-v10-effects-bf.test.ts`
(new). Verify script: `ui/verify-phase23-stream-bf.mjs` (new).
