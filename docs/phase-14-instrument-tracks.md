# Phase 14 Stream F — instrument (SoundFont) track playback in the live engine

*Built 2026-07-11. Closes the one piece Phase 13 Stream A deliberately deferred: the GUI engine
`ui/src/audio/engine.ts` skipped instrument tracks entirely (`if (track.kind !== 'synth')
continue`), so none of Phase 12 Stream 2's SoundFont content (`presets/sf2/*` — the real FluidR3 GM
and MuldjordKit banks) could be heard anywhere in the live GUI. Now an instrument track produces
real audio, driven by the document's own `instrument.sample`/`program`, mixed through the master
bus alongside synth/drum tracks, with a program/level/pan editing panel.*

## Research findings (done first, as the brief required)

1. **The offline reference (`cli/render-offline.mjs`, lines ~343-403).** Instrument tracks are
   rendered by `spessasynth_core`'s `SpessaSynthProcessor` *outside* the Tone graph — a batch,
   sample-position-sequenced processor whose Float32 output is baked (volume + constant-power pan)
   into a buffer and injected into the offline mix. Confirmed this is **not** portable to a live
   engine (it's an offline block processor), but it told me exactly what data has to reach the
   browser: the soundfont bytes (`rawMedia`, the sha256-verified `.sf2`) and per-track
   `instrument.sample`/`program`/`volume`/`pan`.

2. **`spessasynth_lib` was entirely unused.** `grep -rn spessasynth_lib` (excluding `node_modules`)
   hits **only** `package.json`/`package-lock.json` — it sat as a root dependency for exactly this
   job, never imported. It is the browser/real-time WebAudio wrapper around `spessasynth_core`
   (which the offline path and `beat inspect`/`src/mcp/server.ts` already use for the pure binary
   `SoundBankLoader` parse). Its `WorkletSynthesizer(context)` runs the synth in an AudioWorklet on
   a live `AudioContext`, with `noteOn/noteOff(channel, midi, vel, { time })` — `{ time }` is an
   **absolute AudioContext-seconds** schedule point, i.e. sample-accurate scheduling from the
   existing tick loop. This made the integration a genuine wiring job, not a from-scratch DSP port.

3. **BeatLab's live engine has no SoundFont playback to port.** Phase 8 shipped "master-bus routing
   for instrument audio in the *offline render*" (`docs/phase-8-plan.md`) — that lives in dotbeat's
   `cli/render-offline.mjs`, not in a live engine. dotbeat's `instrument` track kind doesn't even
   exist in BeatLab (`test/format-v06.test.ts`: "beatlab has no instrument kind yet"). So there was
   nothing to port from BeatLab's `engine.ts`; the right path was to wire `spessasynth_lib` fresh
   into dotbeat's own Tone-based engine. This is still "use the intended library, don't rebuild a
   synth" — `WorkletSynthesizer` *is* the reuse.

## What was built

### 1. Live instrument playback in `ui/src/audio/engine.ts` (additive)

- **One `WorkletSynthesizer` per instrument track**, managed in a `Map<trackId, InstrumentVoice>`
  reconciled every tick by `syncInstruments(doc)` (called from `sync()`, mirroring how synth
  `chains` are reconciled): dispose vanished tracks, (re)build new or sample-changed ones, and
  apply cheap `programChange` / volume / pan updates on existing ones.
- **Async build guarded against the per-tick call.** `buildInstrument()` awaits the worklet module
  registration, fetches the `.sf2` bytes from the daemon's existing `GET /media/<path>` route (the
  same route the drum one-shots use — no new bytes plumbing needed), `addSoundBank` + `isReady`,
  then wires output. `instrumentPending` prevents a second load kicking off while the first is in
  flight; a track whose voice isn't ready yet is simply silent for those ticks (loops repeat, so a
  program's notes are heard on the next loop).
- **Master-bus routing with level/pan.** The synth's output → a native passthrough `GainNode` →
  `Tone.Volume(instrument.volume)` → `Tone.Panner(instrument.pan)` → the shared master bus (→
  limiter → destination, with the side-tapped meter/analysers). So instrument audio is in exactly
  the same master path as synth/drum tracks and shows up on the master analyser and in `recordWav`.
- **Sample-accurate note scheduling** in the tick's new instrument branch: for each note due this
  step, `noteOn(0, midi, vel, { time: noteTime })` and `noteOff(0, midi, { time: noteTime + dur })`,
  with `noteTime` computed identically to the synth branch (fractional-step offsets honored) and
  velocity mapped 0..1 → 1..127. Instrument tracks resolve loop-vs-song content through the same
  `contentOf()` the synth/drum tracks use, so they participate in scenes/song exactly like the
  offline path.

**The one non-obvious fix — a native AudioContext.** `spessasynth_lib`'s `WorkletSynthesizer`
constructs a native `AudioWorkletNode`, which requires a native `BaseAudioContext`. Tone 15 wraps
its context in `standardized-audio-context`, whose `rawContext` is **not** a native
`BaseAudioContext` — constructing the worklet on it throws *"parameter 1 is not of type
'BaseAudioContext'"* (caught live in the first verification run). The fix: pin Tone itself to a
native `AudioContext` (`ensureNativeContext()` → `Tone.setContext(new AudioContext())`), created
once before any node is built (guarded at the top of `getMaster()` and `ensureStarted()`), and
share that exact context with every `WorkletSynthesizer`. Both engines now live on one native
context, so the graph connects natively. Verified this did **not** regress the existing synth/drum
engine — `ui/verify.mjs`'s "audio actually plays" check still reads a real master level (−13.0 dB).

### 2. `GET /soundfont-presets?sample=<mediaId>` — one additive daemon route

`src/daemon/daemon.ts` gained a single read-only route that lists a registered bank's programs,
mirroring `beat inspect`'s machinery (`cli/beat.mjs` / `src/mcp/server.ts`): find the media entry,
read the `.sf2`, sha256-verify it against the media block, and enumerate presets with
`spessasynth_core`'s `SoundBankLoader` (a pure binary parse, no audio context — the same dynamic
`import('spessasynth_core')` pattern `src/mcp/server.ts` already compiles with). Returns
`{ presets: [{ program, bankMSB, bankLSB, name }] }`. Additive; touches no existing route. Full
`npm test` re-run after this change: **289 / 283 / 0 / 6** (unchanged baseline).

### 3. Instrument-track editing panel — `ui/src/components/InstrumentPanel.tsx` (new)

Replaces App.tsx's `EditorView` placeholder ("editing surface is a later stream"). Instrument
tracks carry a tiny param set (`sample`/`program`/`volume`/`pan`), not the 55-field synth block, so
this is a dedicated small panel rather than `SynthPanel`'s generic knob-grid (SynthPanel untouched):
- **program picker** populated from `GET /soundfont-presets` — the bank's real GM program names;
- **volume** and **pan** knobs (reusing the shared `Knob`).

Every control POSTs `<track>.<field>` via `/edit` (one canonical line in the `.beat` file) using
`core`'s already-existing instrument routing (`src/core/edit.ts` handles `<track>.program/volume/
pan`). I also extended the bridge's optimistic mirror (`ui/src/daemon/bridge.ts`) so a `program`
edit is reflected into the instrument block immediately — the daemon doesn't echo its own writes, so
without this the live engine wouldn't hear a program change until an unrelated re-pull.

## Verification evidence — real audio, measured

`ui/verify-instrument.mjs` builds a **real** project (`beat init/sample/add-track/add-note`) whose
instrument track points at the real trimmed FluidR3 GM bank (`presets/sf2/fluidr3-gm-small.sf2`),
boots the daemon + serves the built UI, drives it in headless Chrome, and measures the master output
with the repo's own `src/metrics` (same evidence style Phase 12 Stream 2 used). Re-runnable:
`node ui/verify-instrument.mjs`.

| check | result |
|---|---|
| **ROUTE** — `GET /soundfont-presets?sample=gm` | 8 real GM presets listed (Yamaha Grand Piano, Nylon String Guitar, Acoustic Bass, Violin, Trumpet, Flute, Synth Drum, Standard) |
| **AUDIBLE** — program 73 (Flute), master capture | peak **−22.2 dBFS** (real signal, **not** silence), centroid **693 Hz**, bands 98.8% mids — a flute, correctly |
| **DISTINCT** — program 56 (Trumpet), same notes | peak −18.4 dBFS, centroid **1596 Hz**, **20.6%** presence-band energy (brassy) vs the flute's 0.5% |
| centroid Flute 693 Hz vs Trumpet 1596 Hz | **78.9%** relative difference — the selected program measurably shapes the timbre |

This specifically confirms the **browser** path does **not** hit the silent-output failure mode
Phase 12 Stream 2 documented for the offline Node render (unpatched `node-web-audio-api`): the live
WKWebView/Chromium Web Audio path produces genuine, correctly-voiced, program-dependent audio.

`npm test` (root): **289 / 283 / 0 / 6** — unchanged (the 6 skipped are the known macOS-tmpdir
history-test quirk). `ui/verify.mjs` (Phase-13 exit test) still passes on the native-context engine.

## Honestly deferred

- **Full FX-chain parity for instrument tracks.** Instrument tracks get level/pan into the master
  bus, but **not** the synth insert chain (EQ / parallel comp / distortion / bitcrush), the
  reverb/delay/mod sends, LFOs, filter envelope, or the sidechain duck — those are synth-chain-only
  this stream, as the brief allowed. `BeatInstrument` carries no such fields today anyway (by
  design: "the 55 synth params mostly don't apply to sampled instruments"); wiring instrument tracks
  through a shared insert/send chain is a clean next increment.
- **Bank (MSB/LSB) selection.** `BeatInstrument` stores only `program`; the picker lists every
  preset (bank shown in the label) but `programChange` sets program on channel 0 only — same
  limitation as the offline path (`proc.programChange(0, program)`). So e.g. the GM "Standard" drum
  kit (bank 128) selected on a melodic channel plays program 0 melodic. Modelling bank in the format
  is a format-spec change, out of scope here.
- **Mute/solo gating of instrument tracks.** Stream E is adding per-track mute/solo audio gating for
  synth/drum tracks in the same file (different function); extending it to instrument voices is a
  natural follow-on once both land.
- **`upright-piano`/`muldjordkit` banks** weren't separately exercised in the harness — the FluidR3
  GM path proves the mechanism generically (any registered `.sf2` loads through the same route).

## Files

- `ui/src/audio/engine.ts` — additive: `InstrumentVoice`, `instruments`/`instrumentPending`,
  `ensureNativeContext`, `ensureWorkletModule`, `buildInstrument`, `syncInstruments`,
  `disposeInstrument`; instrument branch in `tick()`; instrument `stopAll` in `stop()`.
- `ui/src/components/InstrumentPanel.tsx` — new instrument-track editing panel.
- `ui/src/App.tsx` — render `InstrumentPanel` for instrument tracks (placeholder removed).
- `ui/src/daemon/bridge.ts` — optimistic mirror extended to instrument `program`.
- `ui/src/vite-env.d.ts` — new (`vite/client` types for the `?url` worklet-asset import).
- `src/daemon/daemon.ts` — new additive `GET /soundfont-presets` route.
- `ui/verify-instrument.mjs` — new verification harness.
- `docs/phase-14-instrument-tracks.md` — this doc.
