# Phase 13 Stream A — real engine parity in `ui/`

*Built 2026-07-11. Closes the single biggest gap `docs/phase-13-plan.md` names: the GUI's engine
was 257 lines (one `PolySynth` + filter + vol + pan per synth track, a fixed drum kit, nothing
else) versus the ~1,500-line BeatLab engine the CLI already renders from — so **the GUI could not
make a `.beat` file sound like what `beat render` produces from the same file.** This stream ports
the rest of that engine into `ui/src/audio/engine.ts`, adapted to dotbeat's own document model, and
verifies parity by rendering the same project both ways and comparing metrics.*

## What it is

`ui/src/audio/engine.ts` grew from 257 → 945 lines (≈600 of them the ported DSP; the rest header, interfaces, and the coercion table). It is a port of BeatLab's `src/audio/engine.ts`
(fresh checkout of `origin/fix/clip-automation-units-and-timeline`, HEAD `ba29bee` — see the
automation note below for why that branch), cross-checked against `cli/render.mjs`'s Tone.js graph
(the D5 reference the CLI already renders from), and adapted to dotbeat's **own** document shape
(`src/core/document.ts`: free-timed `BeatDrumHit` events, `BeatNote`, the full `SYNTH_FIELDS` synth
block, clip-scoped `BeatAutomationLane`) rather than BeatLab's `Track`/`pattern`/`AutomationMap`.

New file: `ui/src/audio/wavEncode.ts` (ported verbatim from BeatLab — a 16-bit-PCM WAV encoder used
only by the verification harness's capture path).

## Ported / adapted, feature by feature

Everything below reads from a strictly-typed `EngineSynth` view (`coerce()` reads the daemon's
permissive `BeatSynth` — which types every non-core field as `number | string | boolean | null` via
an index signature — and fills the exact `SYNTH_FIELDS` defaults). No changes to `ui/src/types.ts`
or `ui/src/state/store.ts` were needed, so there is **zero conflict surface with Stream B**.

- **Per-lane drum-voice synthesis** — `applyDrumVoiceParams` wires `kickTune`/`kickPunch`/
  `kickDecay` (a pitch-swept `MembraneSynth`), `snareTone`/`snareDecay` (noise + a tonal
  `MembraneSynth` shell layer, silent at `snareTone 0`), `hatDecay`/`openHatDecay`/`hatTone`
  (`MetalSynth` resonance). The old engine built fixed voices and ignored all eight fields.
- **Drum bus** — the whole kit now feeds a shared bus (`filter → EQ3 → parallel compressor →
  distortion → bitcrusher → panner → vol → master`, plus reverb/delay/mod sends), so the drums
  track's synth block (which the format has always carried) finally drives real drum-bus
  filter/EQ/comp/distortion/send params. night-shift's drums use `eqLow`/`eqHigh`/`compMix`/
  `distortionAmount`/`distortionMix` — audible now, inert before.
- **Full synth oscillator bank** — main `PolySynth` + `osc2` (detuned layer) + `osc3` (mirrored 3rd
  unison voice) + outer unison pairs (voices 4/5 at ±1.6×, 6/7 at ±2.4× detune, tapered level) with
  per-voice stereo-width panners, + sub (fixed sine one octave down) + white noise + a 2-op FM
  voice, all summed into the shared filter. This is what makes night-shift's `unisonVoices 3/5`,
  `osc2Level`, `subLevel`, `osc2Detune` actually sound. The old engine was a single oscillator.
- **Filter envelope + keytracking + velocity-to-cutoff** — per-note cutoff sweep
  (`filterEnvAmount`/`Attack`/`Decay`/`Sustain`/`Release`), shifted by `keytrackAmount` and
  `velToFilterAmount` at note-on. Plus `glide` (portamento) across the whole bank.
- **LFO 1 + LFO 2** — LFO 1 → pitch / cutoff / amp; LFO 2 → pan / sends / EQ / distortion. Sampled
  once per 16th-note step (control-rate), same resolution and documented tradeoff as BeatLab. The
  drum bus gets the cutoff/amp LFO sweep too.
- **Insert + send chains** — EQ3, parallel ("New York") compressor with a manual dry/wet mix,
  distortion → bitcrusher, and reverb / delay / (chorus→phaser) mod sends into shared return buses.
- **Scheduled sidechain duck** (`duckSource`/`duckAmount`) — dips a track's volume whenever the
  source drums track has a **kick hit** at the current step. **Adapted to dotbeat's free-timed
  hits**: BeatLab reads a 16-step pattern cell (`pattern.kick[step % 16]`); dotbeat instead checks
  `hits.some(h => h.lane === 'kick' && floor(h.start) === contentStep)`. night-shift's bass and pad
  both duck against the drums.
- **Clip automation playback** — song/timeline mode: each tick resolves `bar → section → scene →
  this track's clip`, and reads notes/hits/**automation** from the currently-playing clip (loop
  mode plays the live track's events with no automation, which is dotbeat's clip-scoped-only design
  per `format-spec.md` v0.9).
- **Master bus → limiter → destination** with side-tapped meter + waveform/FFT analysers — carried
  forward from Stream 1, unchanged; `getMasterLevel()` added for the harness.

### The clip-automation bug fixes (`wgpatrick/beatlab#5`, still open — checked, NOT merged)

Phase 10 Stream D found two real bugs in BeatLab's automation wiring; the fix is an **open** PR
(verified via `gh pr view 5`: `state OPEN`, `mergedAt null`), so this port takes the fixed logic
rather than reintroducing the bugs:

1. **Units mismatch** — dotbeat's automation model *designs this away*: `BeatAutomationPoint.time`
   is in **16th steps from clip start** and `.value` is in the param's **raw units** (Hz, dB,
   0..1). `interpolateAutomation()` therefore compares `contentStep` directly against `point.time`
   with **no 0..1 rescale**, and applies `point.value` as-is. (BeatLab's bug was mixing a 0..1
   fraction against raw values.)
2. **Timeline automation never switched per clip** — automation is read from the **currently-
   playing clip's** lanes (`contentOf` returns `clip.automation` in song mode), not the live track,
   so a song alternating clips with different automation actually hears them change.

## Explicitly deferred (out of Stream A scope)

- **Instrument / SoundFont tracks** — spessasynth integration is a separate, larger lift (the
  offline renderer runs it *outside* the Tone graph). Instrument tracks are skipped in the tick;
  noted for a future stream.
- **Wavetable oscillators** — dotbeat's `osc` is only sine/tri/saw/square (no `wavetable` value,
  no `wtCustomA/B`), so BeatLab's wavetable engine has nothing to bind to. `wtPos`/`lfoDest: wtPos`
  are inert.
- **Tempo-synced LFO rates + drawn LFO shapes** (`lfoSync`/`lfoSteps`), **reorderable insert
  order** (`insertOrder`), the **arpeggiator** (`arpOn`) — dotbeat's format models none of these
  fields, so they're not ported.
- **Sample slicing / per-lane one-shots** (v0.5 media), **live-MIDI monitoring** — no dotbeat GUI
  surface yet.
- **Full UI controls for the new params** — that's Stream B's job. This stream is "the engine can
  produce the sound if driven correctly," not "every knob exists."

## Verification evidence

`ui/verify-engine-parity.mjs` — boots the daemon on `examples/night-shift.beat`, serves the built
`ui/`, drives it in headless system Chrome, and measures three things with **real numbers**, using
the repo's own `src/metrics` for analysis. The GUI is captured via the new `engine.recordWav()`,
which uses the **identical** `MediaRecorder → opus → decode → WAV` path as BeatLab's
`exportSandboxWav` / `cli/render.mjs` — so both sides carry the same lossy stage and the comparison
is fair (D5's node-vs-Chromium divergence doesn't even apply here: both engines run in Chromium's
Web Audio).

### 1. Parity — GUI capture vs. the CLI reference render, same `.beat` file

Reference: `node cli/render.mjs examples/night-shift.beat -o ref.wav --beatlab-dir <beatlab>` (the
real BeatLab engine in Chromium), then `beat metrics`. GUI: the live dotbeat engine, `recordWav`.

| metric | CLI reference (BeatLab) | dotbeat GUI engine | Δ |
|---|---|---|---|
| integrated LUFS | −8.5 | −8.5 | 0.0 dB |
| crest (PLR) | 9.3 dB | 9.2 dB | 0.1 dB |
| spectral centroid | 298 Hz | 299 Hz | ~0.3% |
| sub (<60 Hz) | 42.4% | 41.7% | 0.7 pt |
| bass (60–250) | 35.9% | 36.4% | 0.5 pt |
| mids (250–2k) | 20.1% | 20.4% | 0.3 pt |
| presence (2–6k) | 1.1% | 1.1% | 0.0 pt |
| air (>6k) | 0.5% | 0.5% | 0.0 pt |
| stereo correlation | 0.93 | 0.93 | 0.00 |

The two independent engines land within **0.1 dB of loudness, 0.1 dB of crest, and ≤0.7 points on
every spectral band.** The brief only asked for "same ballpark, large gaps understood, not silently
accepted" — the actual result is near-identical spectral balance, which is strong evidence the
whole ported chain (drum voices, unison stack, sends, sidechain, filters) is collectively wired
right. A blank/half-wired engine would be wildly off (no sub/bass, or nothing but a single
oscillator's mids). Full captures at `/tmp/streamA-ref-nightshift.wav` and
`/tmp/streamA-gui-nightshift.wav`.

### 2. Sidechain duck — measured off the audio, not "the code path ran"

Injected a `kick(4-on-floor, silenced to −60 dB but still driving the duck) + sustained-bass` doc
with `duckSource: drums`, recorded it with the duck **off** then **on**, and measured the
coefficient of variation of the bass's amplitude envelope (20 ms RMS window, steady-state only):

- duck **OFF**: CV **0.333**
- duck **ON** (`duckAmount 0.7`): CV **0.665** — **2.0× more modulation.**

The bass level measurably dips on each kick with the duck engaged, exactly as designed.

### 3. Drum-voice synthesis — the kick is a real low-frequency kick

Injected a kick-only pattern and measured its spectrum: **sub 36.8% / bass 62.7% / mids 0.4% /
presence 0.0% / air 0.0%**, sample peak **−3.4 dBFS**. Real output, correctly low-frequency-
dominant — the per-lane `MembraneSynth` kick is producing a kick, not silence or broadband noise.

### Suite

`npm test` from repo root: **289 / 283 / 0 / 6** — unchanged baseline (this stream touches only
`ui/`, which the repo suite doesn't cover). The original Stream 1 exit bar (`ui/verify.mjs`: one-
line-diff step toggle, live file→GUI update, audio plays, real data on screen) still passes against
the new engine.

## Files

- `ui/src/audio/engine.ts` — rewritten (257 → 945 lines).
- `ui/src/audio/wavEncode.ts` — new (ported WAV encoder for the harness).
- `ui/verify-engine-parity.mjs` — new verification harness.
- `docs/phase-13-engine-parity.md` — this doc.

No changes to `ui/src/types.ts`, `ui/src/state/store.ts`, `ui/src/components/*`, or anything under
`src/` — engine-only, additive, self-contained.
