# Phase 16 Stream K — instrument-track completeness + insert-chain reordering

*Built 2026-07-11. Closes Phase 14 Stream F's own deferred item (instrument-track meters/mute
gating) and Phase 13 Stream C's deferred FX-chain-visibility item in the mixer. Investigates and
correctly declines Phase 13 Stream A's deferred "reorderable insert order" — the data model doesn't
support it (see item 2 below).*

## 1. Instrument-track meters + mute/solo gating (`ui/src/audio/engine.ts`)

Before this stream, `getTrackLevel()` returned `null` for instrument tracks (no meter tap wired —
Phase 14 Stream F's own "honestly deferred" item), and `applyMuteGates()` only iterated
`this.chains` (synth tracks) and the drum bus, never `this.instruments`.

- **`InstrumentVoice` gained `muteGain: Tone.Gain` and `levelTap: Tone.Analyser`.** The voice's
  output chain is now `entry (native passthrough GainNode) → muteGain → vol → pan → master`, with
  `pan.connect(levelTap)` as a side-tap (not in the audible path) — the exact same pattern
  `SynthChain`/`DrumBus` already use (`buildSynthChain()`'s `muteGain`/`levelTap`, `wireInsertChain`
  gating before the panner). Instrument voices have no reverb/delay/mod sends to worry about (Phase
  14 Stream F never gave them one), so `muteGain`'s exact position in the serial chain is less load
  bearing than in the synth-chain fan-out case, but the dedicated-gate discipline (a separate node
  from `vol`, so the two never fight) is kept for consistency and because a voice may not exist yet
  (still loading its soundfont) — nothing to gate in that case, handled naturally.
- **`applyMuteGates()`** now also loops `this.instruments`, setting `muteGain.gain.value` from the
  same `isEffectivelyMuted(state, id)` read the synth/drum path already uses. Runs every tick via
  `sync()`, same as before — a mute toggled mid-playback takes effect within one 16th-note step.
- **`getTrackLevel()`** now checks `this.instruments.get(trackId)` after the synth-chain and
  drum-bus checks, returning `Engine.rmsDb(voice.levelTap.getValue())` — the same true-RMS-off-
  raw-samples computation the other two paths use (chosen over `Tone.Meter` originally for the same
  reason: RMS off raw waveform samples reads exact silence the instant the gate closes, with no
  decay-lag).
- **`disposeInstrument()`** now also disposes `muteGain`/`levelTap` (leak fix — the two new nodes
  need explicit teardown like every other Tone node in the voice).

### Verification — real measurement, not a button toggle

`ui/verify-phase16-stream-k.mjs` (headless Chromium against a real daemon, extending the established
`ui/verify-instrument.mjs`/`ui/verify-phase14.mjs` conventions) builds a real project — an
instrument track (`flute`, the real trimmed FluidR3 GM bank at `presets/sf2/fluidr3-gm-small.sf2`,
program 73) playing a sustained triad — and:

- **IM1** — plays the project, samples `engine.getTrackLevel('flute')` over a window: **-30.8 dBFS**
  peak (previously would have been `null`).
- **IM2** — clicks the real mixer mute button on the flute strip (not a direct store write), confirms
  the store reflects the mute, waits one tick, resamples: **-120 dB (true silence)**, down from
  -30.8/-30.7 dB.

```
[IM1] flute (instrument track) peak dB while playing: -30.8
[IM1] PASS: getTrackLevel() returns a real, audible reading for an instrument track
[IM2] muted flute. peak dB now: -120
[IM2] PASS: flute tap -30.8dB -> -120dB (true silence) — mute gate real for instrument tracks
```

Screenshot `ui/verify-p16k-instrument-mute.png`: the flute strip's **M** button is lit red and its
meter reads dark/empty while `leadA`/`leadB` (synth tracks, still playing) show live green meters —
visual confirmation alongside the DSP-level measurement.

Re-ran `ui/verify-instrument.mjs` (Phase 14 Stream F's own harness) and `ui/verify-phase14.mjs`
(Phase 14 Stream E's synth/drum mute/solo/meter harness) unmodified — both still pass, confirming
this additive change didn't regress synth/drum-track gating or the instrument-audibility path.

## 2. Insert-chain reordering — investigated, correctly declined

**Finding:** `src/core/document.ts`'s `SYNTH_FIELDS` (the format's optional-field table, the single
source of truth the parser/serializer/edit/diff/UI are all driven by) has no field modeling insert
*order* — no `insertOrder: string[]` or equivalent. It has per-effect params for EQ (`eqLow`/
`eqMid`/`eqHigh`), compressor (`compThreshold`/`compRatio`/.../`compMix`), distortion
(`distortionAmount`/`distortionMix`), and bitcrush (`bitcrushBits`/`bitcrushMix`) — but nothing that
says "comp before EQ" or lets the document express any order other than the one fixed sequence.

This matches what `ui/src/audio/engine.ts`'s own `wireInsertChain()` already documents in its
comment: *"dotbeat has no insertOrder field, so the order is fixed at BeatLab's default (['eq',
'comp','dist']); every insert is transparent at its default params... so an unedited track's signal
path is uncolored."* The engine wires `filter → eq3 → parallel-comp → distortion → bitcrush →
(panner)` unconditionally, for every track, with no per-track variation possible from the document.

**Decision: not buildable without a format change, so not built.** A reorderable-insert-chain UI
needs *something* in the document to reorder — without an `insertOrder` field (or equivalent), any
UI that let a user "drag EQ after comp" would have nothing to write: the edit would either be
silently discarded (the UI lies about having an effect) or would have to be faked client-side only
(a per-session reordering that never round-trips through `/edit`, never appears in the `.beat` file,
and vanishes on reload or for any other client/agent reading the same document) — exactly the
"invent client-side-only reordering that doesn't actually change what's saved/rendered" trap the
brief warned against. Either outcome is worse than not building the feature: it would look real in
the mixer/panel while doing nothing (or reverting on the next `sync()`/reload), which is a worse
experience than a stable, honestly-fixed chain order.

The right next increment, if this becomes a priority, is a format change: add an `insertOrder`
field to `SYNTH_FIELDS` (e.g. `kind: 'enum'` over the 24 permutations, or a small ordered-list type
if the format's edit grammar can express one), thread it through `wireInsertChain()`'s connection
graph (rebuilding the chain's node graph per-order rather than the current fixed `.connect()` calls
built once at chain-construction time), and only then build the reordering UI on top of real,
persisted data. Out of scope here — correctly declined rather than faked.

## 3. FX-chain visibility in the mixer (`ui/src/components/MixerView.tsx`)

Added a compact badge row (`FxBadges`) to each channel strip, between the track-kind label and the
pan knob, reading the exact same `SYNTH_FIELDS` data `SynthPanel.tsx`/`synthParams.ts` already
render in full — no new state, no new edit path, just a glance-able summary of live per-track data:

| badge | "active" heuristic | mirrors the engine's own bypass condition |
|---|---|---|
| **EQ** | `eqLow !== 0 \|\| eqMid !== 0 \|\| eqHigh !== 0` | `Tone.EQ3` bands are additive dB shelves/bell; 0 dB on all three is transparent |
| **Comp** | `compMix > 0` | `chain.compWet.gain.value = compMix` — 0 = fully dry, compressor inaudible regardless of threshold/ratio |
| **Dist** | `distortionMix > 0` | `chain.distortion.wet.value = distortionMix` — 0 wet = inaudible regardless of `distortionAmount` |
| **Crush** | `bitcrushMix > 0` | `chain.bitcrush.wet.value = bitcrushMix` — same wet/dry bypass logic |

Each heuristic is chosen to match what the engine actually treats as "on" (see `applyParams()`/
`applyDrumBusParams()` in `engine.ts`), not an arbitrary UI threshold — e.g. `distortionAmount` can
be nonzero while `distortionMix` is 0 and the insert is still silent, so the badge keys off `Mix`,
the field that actually gates audibility.

**Instrument tracks show no badges.** `BeatTrack.synth` is a non-optional field on every track kind
(including instrument, per `src/core/document.ts`), but the engine never applies an instrument
track's synth block to its audio path (Phase 14 Stream F: instrument voices only get volume/pan,
not the insert chain) — so badges reflecting that inert data would be decorative, not real, exactly
what the brief said not to build. `FxBadges` special-cases `kind === 'instrument'` to render an
empty (but layout-preserving) row instead.

`—` (an em dash) renders when a synth/drum track's chain is genuinely untouched — distinguishing
"checked, nothing active" from "not checked" (no badges at all would be ambiguous with the
instrument case).

### Verification — differentiated indicators, screenshotted

`ui/verify-phase16-stream-k.mjs`'s FX1 check builds a project with three tracks: `leadA` (synth,
`eqLow=6 eqHigh=-4 compMix=0.6` — edited via `beat set`, the real `.beat`-file edit path), `leadB`
(synth, left at every default), and `flute` (instrument). It switches to the mixer view, reads each
strip's rendered badges straight from the DOM, and asserts:

```
[FX1] per-strip badges: {"flute":[],"leadB":["—"],"leadA":["EQ","Comp"]}
[FX1] PASS: badges reflect real per-track insert-chain data — leadA differs from leadB, instrument track shows none
```

Screenshot `ui/verify-p16k-mixer-fx.png`: `leadA`'s strip visibly shows `EQ` and `Comp` badges,
`leadB`'s shows `—`, `flute`'s shows nothing — three tracks, three different outcomes, all reading
real per-track document data (not decorative/hardcoded).

## Files

- `ui/src/audio/engine.ts` — additive: `InstrumentVoice.muteGain`/`levelTap`, wiring in
  `buildInstrument()`, teardown in `disposeInstrument()`, the `applyMuteGates()`/`getTrackLevel()`
  extensions, updated header comment.
- `ui/src/components/MixerView.tsx` — new `FX_BADGES` table + `FxBadges` component, rendered per
  channel strip; updated toolbar tip.
- `ui/src/styles.css` — `.mixer-strip-fx`/`.mixer-fx-badge`/`.mixer-fx-none` styles.
- `ui/verify-phase16-stream-k.mjs` — new verification harness (IM1/IM2/FX1).
- `ui/verify-p16k-instrument-mute.png`, `ui/verify-p16k-mixer-fx.png` — verification screenshots.
- `docs/phase-16-instrument-mixer.md` — this doc.

## Verification summary

- `node ui/verify-phase16-stream-k.mjs` — **all checks pass** (IM1, IM2, FX1).
- `node ui/verify-instrument.mjs` — still passes (Phase 14 Stream F unregressed).
- `node ui/verify-phase14.mjs` — still passes (Phase 14 Stream E's synth/drum mute/solo/meter/
  playhead evidence unregressed).
- `ui/` typecheck (`npx tsc --noEmit -p ui`) — clean.
- `ui/` production build (`npm run build` in `ui/`) — clean.
- `npm test` (repo root): **293 tests, 287 pass, 0 fail, 6 skipped** — unchanged from the Phase 15
  baseline (the 6 skipped are the known macOS-tmpdir `node-web-audio-api`/history-test quirks;
  `ui/` is not in the root suite).

## Honestly deferred / out of scope

- **Item 2 (insert reordering) is not built** — see the finding above. A format change
  (`insertOrder` field) is the prerequisite, not a stream-K-scope task.
- **Full instrument-track FX parity** (EQ/comp/distortion/bitcrush/sends/sidechain/LFO/filter-env
  for instrument tracks) remains out of scope, same as Phase 14 Stream F left it — this stream only
  added the meter tap and mute gate on the existing volume/pan-only signal path, it did not give
  instrument tracks an insert chain to have order data about.
- **FX badges are boolean presence, not a value readout** (e.g. "Comp" doesn't show the mix
  percentage or threshold) — a deliberate "at-a-glance" scope match to the brief's "compact
  indicator," not a mixer-embedded mini synth panel. `SynthPanel.tsx` remains the full-detail view.
