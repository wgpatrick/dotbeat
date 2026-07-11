# Phase 14 Stream E — live playback feedback (mixer gating + per-track meters + arrangement playhead)

Closes three of the "honestly still open" gaps Phase 13 left in `ui/`: mute/solo that only
recolored buttons, a mixer with no per-channel metering, and an arrangement timeline with no
playback indicator. All three are now real, verified with headless-Chromium audio measurements.

## What was built

### 1. Mute/solo → real audio gating (`ui/src/audio/engine.ts`)

- Added a dedicated **`muteGain`** node to every synth chain and to the drum bus, inserted
  **upstream of the panner fan-out** (`bitcrush → muteGain → panner → {vol→master, reverb/delay/mod
  sends}`). Gating it to 0 silences both the dry path *and* the FX sends together — a gate placed on
  `vol` alone would have left the reverb/delay/mod sends audible. It is a separate node from `vol`,
  so the per-tick volume/duck ramps that write `chain.vol` never fight the mute state.
- `applyMuteGates()` reads the store's effective mute/solo state (`isEffectivelyMuted`, standard
  semantics: mute wins; if anything is soloed only soloed tracks pass) and sets each track's
  `muteGain` to 0 or 1. It's called from `sync()`, which already runs on every 16th-note tick, so a
  mute toggled mid-playback takes effect on the next step (< one beat) — the "per-tick read" hook
  point the plan sanctioned. Cheap and idempotent.
- The store note and `MixerView`'s "audio gating deferred" comments were updated to reflect that the
  gate is now real.

### 2. Per-track meters in the mixer (`ui/src/components/MixerView.tsx`, `engine.ts`)

- Each channel strip renders a `TrackMeter` canvas beside its fader, following `Scope.tsx`'s
  discipline exactly: it owns a `<canvas>`, subscribes to the **shared throttled rAF driver**
  (`audio/animationFrame.ts` — not a private loop), and reads its track's live level straight off the
  engine each frame (`engine.getTrackLevel`). No continuous per-frame data goes through Zustand.
- Each chain/bus got a **post-fader waveform `Analyser` tap** (`levelTap`) at its `vol` output.
  `getTrackLevel` computes **true RMS** from the raw samples. This was a deliberate choice over
  `Tone.Meter`: `Tone.Meter` peak-holds and decays only ~0.8 per `getValue()` call, so it lags to
  silence at a rate that depends on how often it's polled — wrong for a meter and useless for a
  silence test. RMS off raw samples reads true silence the instant the mute gate closes.

### 3. Arrangement-view playhead (`ui/src/components/ArrangementView.tsx`)

- A single absolutely-positioned `.arr-playhead` line over the track rows (below the sticky ruler),
  scrolling horizontally with the lanes. Position: `HEADER_W + (currentStep/16) * pxPerBar`
  (step-precise, finer than the required bar granularity, at no extra cost).
- Reuses the **same `currentStep`** the step-sequencer/NoteView playheads already read (the engine's
  `Tone.getDraw()` grid-quantized handoff ported in Phase 12) — not a second position mechanism. It
  ticks ≤16×/bar, so it's allowed in reactive state; only the lightweight playhead div re-renders on
  it — the memoized row canvases don't (their effect deps exclude `currentStep`).

## Verification evidence — real measurements

Driven end-to-end in headless Chrome against a real daemon by `ui/verify-phase14.mjs` (mirrors the
existing `ui/verify*.mjs` convention). Loop project (`night-shift.beat`, all four tracks play
together) for gating/meters; song project (`night-shift-song.beat`, intro/build/drop/intro) for the
playhead. All levels are decay-free RMS. Representative passing run:

- **M1 — per-track meters read real, differing levels.** Peak dB with all tracks playing:
  `drums -4.7, bass -2.7, pad -8.5` (lead silent this loop window). ≥2 audible tracks with distinct
  levels → the meters reflect real, differing per-track content, not a shared master value.
- **M2 — mute gates audio.** Muting `bass` via the actual mixer button: its own post-gate tap goes
  from **-2.7 dB → -120 dB (true silence)**. This is the rock-solid proof the contribution is gone
  at the DSP level. (Master RMS moves only slightly, -9.6 → -10.4 dB, because the master limiter
  refills the freed headroom — a real limiter effect, which is why the clean master evidence is M3.)
- **M3 — solo semantics through audio + clean master evidence.** Soloing the quietest track (`pad`)
  drives every other track's tap to **true silence** (`lead/drums/bass = -120 dB`) while `pad` stays
  audible (-7.7 dB), and the **master RMS drops -9.6 → -14.5 dB** — removing 3 of 4 tracks is a delta
  the limiter cannot mask, so the real master output demonstrably changed.
- **P1 — playhead advances.** Its x grows `127px → 163px` as `currentStep` goes `0 → 10` over ~1.2 s.
- **P2 — playhead lands in the right section.** At step 10 (bar 0) the active section is `intro`, and
  the playhead's x falls inside the `intro` section's ruler box (cross-checked against the section
  label geometry, not tautologically against its own formula).

Screenshots: `ui/verify-p14-mixer.png` (captured mid-solo — pad shows a live green meter, the
solo-silenced strips are dark) and `ui/verify-p14-arrangement.png` (orange playhead in the intro
section spanning all rows). Verified stable across repeated runs (the muted/soloed track is chosen
from measured peaks, so the specific track varies run-to-run but every run passes).

`npm test` (repo root): **289 tests, 283 pass, 0 fail, 6 skipped** — unchanged from baseline
(`ui/` is not in the root suite). `ui/` builds clean (`tsc && vite build`).

## Deferred / out of scope

- **Instrument (SoundFont) track meters/gating.** `getTrackLevel` returns `null` for instrument
  tracks (their live playback is Stream F). Their `TrackMeter` simply shows an empty meter; the mute
  gate has nothing to gate yet. Wires up for free once Stream F gives instrument tracks a live voice.
- **Mute state is session-only**, not persisted to the `.beat` file — unchanged and intended (the
  format carries no mute/solo field; real DAWs treat these as session state).
- **Meter ballistics** are plain RMS per frame (no peak-hold/decay ballistics or dB scale ticks) —
  functional and honest, not a polished studio meter.
- **Playhead granularity** is step-precise but not sample-smooth (it steps at ≤16×/bar, matching the
  editor playheads); the plan explicitly allowed bar granularity, so this exceeds the bar.
