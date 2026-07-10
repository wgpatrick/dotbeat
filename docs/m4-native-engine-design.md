# M4 design: the native tier ("not a toy")

> **STATUS: DESIGN DRAFT (2026-07-10).** Written the moment its research precondition was met
> (`research/05-engine-architecture.md`, fully verified). Nothing here is built; this exists so
> M4's size and shape are decided by evidence, before any code.

## What M4 is for (and what it is not)

The web tier is complete for what it is: synth/MIDI production with a git-native file, agent
tools, and a metrics loop. The confirmed walls it cannot pass (`research/02`, D3): ~30 ms
recording round-trip vs ~10 ms native; no third-party plugin hosting beyond WAM2; single
render thread by construction (`research/05`, finding: ALL Web Audio implementations inherit a
two-thread control/render split — no per-cycle multicore parallelism, ever).

M4 is NOT Ableton parity (Risk #5: a decade for a team). It is the minimum native engine that
makes three specific things true: **record audio at native latency, host CLAP plugins, and
render/play large projects using all cores** — behind the same `.beat` file, `core`, CLI, and
MCP that already exist. Nothing above the engine changes; that was the point of the
architecture split (architecture.md, validated by openDAW's package-boundary discipline).

## The architecture, as the research verified it

Every production engine surveyed converges on the same shape (findings 1-2, all 3-0):

1. **Compiled node list, not live-graph traversal.** The edit-time graph (our `.beat` document,
   via `core`) compiles into a topologically-ordered list of render nodes. Recompile on
   topology change only — never per quantum (the exact failure mode that costs Web Audio
   engines: per-node overhead managed by mitigation instead of avoided by design).
   Tracktion's `tracktion::graph` is the reference implementation shape.
2. **Lock-free multi-threaded player.** A pool of real-time worker threads executes the node
   list; independent chains (our per-track chains are naturally independent until the send/
   master buses) process in parallel; lock-free queues move messages from the control thread —
   never mutexes on the audio path. Tracktion states the design goal verbatim: multithreaded
   processing that "scales independently of graph complexity."
3. **A butler thread** (Ardour's term) for everything non-real-time: disk streaming for
   recorded audio, file writes, waveform caching. The audio thread never touches a file.
4. **Arbitrary block sizes** up to a prepared maximum (Tracktion), not a hardwired 128-frame
   quantum — offline render then uses big blocks for throughput, live uses small ones for
   latency. This alone is a structural advantage over anything Web-Audio-shaped.

## Concrete proposal

- **Language: Rust.** We now have direct experience in the exact ecosystem (built
  web-audio-api-rs from source this session), the audio-crate ecosystem is real (cpal for
  device I/O — the same layer web-audio-api-rs uses — plus symphonia for decode), and
  `clack`/`clap-sys` exist for CLAP hosting. C++/JUCE is the traditional answer but drags a
  framework whose graph (AudioProcessorGraph) is exactly the single-threaded design we're
  avoiding.
- **Shell: Tauri** (D3, unchanged): the existing React GUI rides along; the daemon keeps owning
  the file; the native engine replaces the browser audio backend behind the same protocol.
- **Engine boundary = the `.beat` document + a small typed command protocol** — the same
  boundary the daemon and offline renderer already speak. The engine consumes
  `beatDocumentToPartialTracks`-shaped state and emits meters/position; transport commands go
  down the same channel. This is the openDAW MessagePort lesson at process scale.
- **DSP source of truth problem** (the one real fidelity question): the web tier's sound IS
  Tone.js. A native engine re-implements those voices, which WILL diverge (we've now measured
  what "two implementations of the same spec" costs: a 9.5 LU makeup offset and an FM
  explosion). Mitigation, per D5 discipline: the metrics engine is the referee — every native
  voice lands with a fidelity harness comparing renders against the web reference within
  stated tolerances, from the first oscillator on. Budget fidelity work as ~equal to DSP
  writing work; Phase 4's experience says that's realistic.
- **Plugin format: CLAP first** (MIT-licensed spec, no licensing gate, modern extensions), VST3
  later if demand shows up. Plugin *state* goes into `.beat` as content-addressed opaque blobs
  (the format-spec media plan) — diffs show "plugin state changed," which is the honest best
  any text format can do for third-party binaries.
- **Recorded audio in `.beat`**: content-addressed WAV/FLAC in `media/` (SHA-256-derived names,
  the openDAW-validated plan), referenced by hash from clip lines. The text file stays text.

## Staging (each stage independently shippable, same discipline as Phases 0-4)

| Stage | Slice | Falsifiable exit test |
|---|---|---|
| M4.0 | Engine skeleton: cpal duplex I/O + compiled-node-list player (gain/mix nodes only) + butler thread | measured round-trip latency < 12 ms on real hardware; a 500-node gain graph renders offline faster than realtime on N cores, scaling ≥ 0.6×N |
| M4.1 | First real voices: port the subtractive synth + drum voices; fidelity harness vs web renders | full default groove renders within metric tolerances of the web reference |
| M4.2 | Audio tracks: record → content-addressed media → clip lines in `.beat`; playback with butler streaming | record a take, `git status` shows one new media file + one clip line; loop plays gaplessly |
| M4.3 | CLAP hosting + plugin state blobs | load a real CLAP synth, automate a param from a `.beat` line, state survives round-trip |
| M4.4 | Tauri shell integration: GUI ↔ daemon ↔ native engine | the existing GUI drives the native engine with no GUI code changes beyond the backend flag |

## Open questions (carried honestly)

- **WASM-portable DSP library specifics** — the one research gap still open (twice-flagged,
  still zero verified evidence): Rubber Band vs signalsmith for time-stretch, metering library
  choices. Needs its own pass before M4.2's warping cousin gets scoped. Until then, no
  warping in any M4 stage above — it's the least-evidenced item in the whole plan.
- **Reuse web-audio-api-rs as the M4 base?** Tempting (we can build it, know its internals) but
  it inherits the single-render-thread architecture by spec conformance — the thing M4 exists
  to escape. Verdict for now: use its *ecosystem* (cpal, the device layer), not its graph.
- **When**: M4 starts only after real use (the current phase) proves people want the web tier's
  workflow enough to justify a native engine. The research's demand finding cuts both ways —
  verified appetite for agent control, unproven appetite for git-native DAWs broadly. M4 is a
  bet-sizing decision, not a scheduling decision.
