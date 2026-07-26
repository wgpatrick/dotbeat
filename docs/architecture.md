# Architecture

Detail behind [`../ROADMAP.md`](../ROADMAP.md) §5. See the roadmap for the diagram and the
web-vs-native rationale, and its §5 status note (2026-07-26) for what changed after this doc was
written.

## Component boundaries

```
src/core/      document model + serializer + musical diff  (pure, no audio, no DOM — the heart)
src/daemon/    Node process: owns the file, 2-way sync     (bridges disk ↔ ui ↔ engine)
src/history/   checkpoint/restore/pin — git-backed versions
src/metrics/   DSP guardrails: LUFS/peak/spectrum, lint, arc profiles, pathology screens
src/vary/      the variation loop: vary/score/suggest, one runVaryBatch orchestrator
src/analysis/  ML sidecars + production layer: analyze, gen (local + hosted), stems, tricks
src/taste/     the taste program: showdowns, figure sources, ranker, pilot (owner-side)
src/mcp/       `beat mcp` — 71 stdio MCP tools over the same operations
src/telemetry/ opt-in cross-surface edit log
cli/           `beat` command: render/inspect/set/diff/… (talks to dist/src, never ui/)
ui/            React GUI + THE canonical audio engine, ui/src/audio/engine.ts (D15) —
               Tone.js graph today, booted headlessly by the CLI render paths
desktop/       Tauri shell around the same GUI + daemon
```

The critical separation: **`core` knows nothing about audio or the DOM.** It's the document model
+ serializer + diff. Both the UI and the CLI depend on `core`; neither depends on the other.

This pattern is validated by direct source reading of **openDAW** (`docs/opendaw-notes.md` §2) —
its engine/UI separation is real and enforced at the *package-dependency* level, not convention:
the engine package has zero React/DOM deps, and even inside the browser, UI (main thread) and
engine (AudioWorklet) communicate only via a typed RPC layer over `MessagePort`, never shared
objects. That's exactly why their headless testing is nearly free — the test harness just swaps a
same-process `MessageChannel` for the real worklet port. We're copying that shape.

> Note: an earlier draft of this document cited `tracktion_engine` here. Two independent,
> fully-verified research passes both came back with **zero surviving evidence** on
> tracktion_engine specifically — an explicit original research question, unanswered both times.
> Don't cite it as a design influence until a dedicated research pass actually reads it (see
> `ROADMAP.md` §11's open questions). openDAW is what we've actually verified.

## Data flow: a GUI knob-turn

1. User drags Cutoff in the device panel.
2. UI dispatches a `core` mutation (`setParam(dev_9f, cutoff, 480)`).
3. `core` updates the in-memory document and notifies the daemon.
4. Daemon serializes the (canonical) document to `song.beat` on disk → a one-line diff.
5. Engine receives the same mutation and updates the live Tone.js node → you hear it.

## Data flow: a `vim` edit

1. User edits `cutoff 480` → `cutoff 900` in the file, saves.
2. Daemon's file watcher fires; re-parses the file.
3. Daemon diffs new document vs current in-memory → a single param change.
4. UI re-renders the knob; engine updates the node. Hot reload, no restart.

## Data flow: `beat render`

1. CLI parses `song.beat` via `core`.
2. Boots **headless Chromium** and loads the same canonical engine the GUI plays through
   (`ui/src/audio/engine.ts`, D15).
3. Captures the realtime mix by default; `--offline` computes the same graph through a native
   `OfflineAudioContext` in windows (D22/D23) — exact for oscillator content, and the default for
   vary/showdown **batch** renders where clips are short. `--stems` renders one solo WAV per track.
4. No GUI, no daemon required.
5. (The earlier node-web-audio-api engine path was retired after measured divergences — see
   ROADMAP §5 status note; the package survives only as an audio-decode utility in scripts.)

## Data flow: the AI critique loop (M3)

```
beat render → metrics(LUFS, spectral, masking) → [optional] learned auto-mix params
   → LLM narrates deltas + proposes a .beat diff → user/agent accepts → re-render → re-measure
```

Metrics are computed by deterministic DSP (the guardrail). The LLM only ever sees numbers +
context and proposes edits; it never silently applies. See ROADMAP §7.

## The web → Tauri migration

The audio backend sits behind an interface in `engine/`. The web tier uses Tone.js/AudioWorklet.
The Tauri tier swaps in a native audio backend (CLAP/VST3 hosting, native-latency I/O,
Rubber-Band/signalsmith time-stretch) behind the *same* interface, driven by the *same* `.beat`
file and `core`. Nothing above `engine/` changes.

## Why headless Chromium won (and node-web-audio-api was retired)

- Headless Chromium runs the *exact* browser code path → renders bit-identically to what users
  hear. Zero fidelity risk.
- `node-web-audio-api` was adopted for speed, then retired: real divergences were measured
  (PeriodicWave negative-frequency FM explosion; a constant 9.5 LU compressor-makeup offset), and
  full-graph DSP ran 0.73× realtime — the 22× simple-graph spike didn't extrapolate (ROADMAP
  Risk #6). Offline exactness now comes from the browser's own native `OfflineAudioContext`
  (D23) inside the same Chromium harness, so there is one engine and one fidelity story.
