# Architecture

Detail behind [`../ROADMAP.md`](../ROADMAP.md) §5. See the roadmap for the diagram and the
web-vs-native rationale.

## Component boundaries

```
core/     document model + serializer + musical diff   (pure, no audio, no DOM — the heart)
engine/   audio: Tone.js graph today, swappable        (web AudioWorklet → Tauri native later)
ui/       React GUI: piano roll, device panel, mixer   (talks to core, not to files)
daemon/   Node process: owns the file, 2-way sync      (bridges disk ↔ ui ↔ engine)
cli/      `beat` command: render/inspect/set/diff/mcp  (talks to core + engine, no ui)
```

The critical separation: **`core` knows nothing about audio or the DOM.** It's the document model
+ serializer + diff. Both the UI and the CLI depend on `core`; neither depends on the other. This
is the engine/document separation that tracktion_engine and other serious engines teach — and it's
what makes headless operation and agent editing possible at all.

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
2. Boots the render engine — **headless Chromium** (fidelity-guaranteed) or **node-web-audio-api**
   (faster) — loads the same `engine` code the GUI uses.
3. Renders offline (`OfflineAudioContext`) faster than real time to a buffer → WAV/stems.
4. No GUI, no daemon required.

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

## Why headless Chromium first, node-web-audio-api second

- Headless Chromium runs the *exact* browser code path → renders bit-identically to what users
  hear. Zero fidelity risk. Already proven by BeatLab's `scripts/smoke.mjs`.
- `node-web-audio-api` is faster (no browser) but is a *reimplementation* of Web Audio — subtle
  divergences are possible (Risk #6). Adopt it for speed once we have a Chromium reference to
  diff renders against.
