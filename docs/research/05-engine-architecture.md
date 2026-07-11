# Research 05 — Open-Source DAW Engine Architecture (the twice-flagged blind spot, resolved)

> **Fully adversarially verified** (deep-research harness: fan-out search → fetch → extract →
> 3-vote adversarial verify). {"angles": 5, "sourcesFetched": 21, "claimsExtracted": 101, "claimsVerified": 25, "confirmed": 23, "killed": 2, "unverified": 0, "afterSynthesis": 11, "urlDupes": 4, "budgetDropped": 5, "agentCalls": 103} — run 2026-07-10, 103 agents, 0 errors.
>
> This is the follow-up pass `ROADMAP.md` §11 and Risk #9 flagged twice: two earlier research
> rounds returned **zero surviving evidence** on engine architecture. This round had a concrete
> motivating measurement from Phase 4: beatlab's ~120-node Tone.js graph renders at 0.73×
> realtime on node-web-audio-api while a ~10-node graph hits 22×.

## Question

> Open-source DAW audio-engine architecture — the twice-flagged research blind spot for the dotbeat project (a git-native DAW). Research questions: (1) How do production open-source DAW engines structure and schedule their DSP graphs — specifically tracktion_engine (Tracktion/Waveform), Ardour (its parallel process graph and butler/disk threads), REAPER (anticipative FX processing / multiprocessing), Zrythm (its documented DSP graph), and LMMS? Threading models, topological ordering, lock-free techniques, how work is split across cores per audio cycle. (2) Why do large audio node graphs get slow, and what are the known scaling techniques (graph compilation/flattening, per-chain parallelism, SIMD, block size trade-offs)? Include JUCE's AudioProcessorGraph and its known single-threaded RenderSequence limits. (3) Web Audio implementation performance specifically: Chromium Blink WebAudio internals (audio thread, per-node overhead, denormals) and the ircam-ismm node-web-audio-api / rust web-audio-api implementation — published benchmarks, GitHub issues about large-graph performance, rendering-loop design. Motivating context: we measured a ~120-node Tone.js graph rendering at only 0.73× realtime on node-web-audio-api while a ~10-node graph hit 22× — we want verified architectural knowledge to decide (a) whether/how to make offline rendering faster and (b) what engine architecture an eventual native (M4/Tauri) tier should use. Prefer primary sources (repos, official docs, maintainer talks/posts, ADC talks, academic papers). Adversarially verify claims; flag anything single-source.

## Executive summary

Production open-source DAW engines converge on the same architecture: a pre-computed (topologically ordered) DSP graph executed by a pool of real-time worker threads with lock-free scheduling, plus dedicated non-real-time threads for disk I/O — Tracktion's tracktion::graph module explicitly plays its node graph "using multiple threads in a lock-free way" (author-reported ~20% CPU improvement and PDC fixes over the old engine), and Ardour splits UI, real-time process, and butler/disk threads. Web Audio implementations, by contrast, inherit a two-thread control/render split in which the entire graph is rendered on a single real-time thread in 128-frame quanta, so they get no per-cycle multicore parallelism; per-node overhead is managed via engineered mitigations (denormal disabling, buffer-reuse allocators, auto-vectorization) rather than parallelism. The beatlab-relevant engine, node-web-audio-api, is a thin napi-rs binding over orottier/web-audio-api-rs, whose maintainer's own profiling showed 58% of execution time in Graph::order_nodes on a 1,500-node benchmark (issue still open), whose 2022 benchmarks showed the worst gaps vs Chrome/Firefox precisely on many-node workloads, and which exhibits a verified, independently-reproduced 2–8x offline-render cliff when finished sources are disconnected in onended handlers — a direct, actionable explanation candidate for the 0.73x measurement. For a native tier, the verified state of the art is Tracktion-graph-style compiled node lists executed by lock-free multi-threaded players, sized to any block length, with a butler-style thread for disk streaming.

## Verified findings

### 1. [HIGH] — vote 3-0 (three merged claims, each 3-0)

Tracktion Engine 2.0's playback runs on a dedicated low-level graph module (tracktion::graph) that executes a topologically-processed node graph across multiple threads in a lock-free manner; its author Dave Rowland states it replaced the old engine internals, fixed plugin delay compensation in complex situations, improved CPU performance ~20%, and was explicitly designed so multi-threaded processing 'scales independently of graph complexity', supports arbitrary block sizes up to the prepared maximum, and a full 64-bit pipeline.

*Evidence: Engine docs state the graph module plays nodes back 'using multiple threads in a lock-free way'; verifiers confirmed the current develop branch's TracktionNodePlayer wraps tracktion::graph::LockFreeMultiThreadedNodePlayer with pluggable thread-pool strategies. Rowland's ADC20 slides state verbatim: 'Replaces the internal processing of tracktion_engine • Fixes PDC in complex situations • Improved CPU performance (20% faster)' and the design aims quoted above. Caveat: the 20% figure is author-self-reported with no published methodology; some thread-pool strategies use blocking primitives for worker suspension.*

Sources: <https://github.com/Tracktion/tracktion_engine/blob/develop/docs/Engine_2.0_Transition.md>, <https://www.youtube.com/watch?v=Mkz908eP_4g>, <https://github.com/drowaudio/presentations (ADC 2020 - Introducing Tracktion Graph.pdf)>, `modules/tracktion_graph/tracktion_graph/tracktion_LockFreeMultiThreadedNodePlayer.{h,cpp}`

### 2. [HIGH] — vote 3-0

Ardour separates transport handling across three threads: a UI thread (GUI/OSC/MIDI control), a real-time process thread (created by JACK, where all audio processing occurs), and a butler/transport thread handling disk I/O and non-real-time transport work.

*Evidence: Ardour's official transport-threading page documents all three threads verbatim, and the butler thread persists in the current codebase. Caveat: the page reflects the JACK-callback era and does not describe Ardour's parallel process graph; modern Ardour also runs ALSA/PortAudio backends and (per 8.12/9.0 release notes) parallelizes disk I/O across cores — the parallel process graph itself was not covered by any surviving claim.*

Sources: <https://ardour.org/transport_threading.html>, <https://github.com/Ardour/ardour/blob/master/libs/ardour/butler.cc>

### 3. [HIGH] — vote 3-0 (two merged claims, each 3-0)

All Web Audio API implementations inherit a two-thread architecture — a control thread where API calls are issued and a separate real-time rendering thread that renders the graph. Gecko uses message passing with two synchronized graph copies; Blink/WebKit use shared memory (often try-locks). Gecko recomputes its DSP ordering (Pearce's variant of Tarjan's SCC) only on topology changes, while Blink-lineage engines perform a depth-first traversal with cycle detection every 128-frame quantum.

*Evidence: Paul Adenot (Mozilla Web Audio implementer, W3C spec co-editor) documents both facts verbatim; verifiers confirmed current Chromium main still uses per-quantum pull-model traversal (ProcessIfNecessary/PullInputs 'once per rendering time quantum'). Important caveat flagged by verifiers: per-quantum traversal is a per-node overhead contributor, not a demonstrated dominant cost, and it does NOT transfer to the ircam/orottier Rust engine, which caches ordering and recomputes only on graph change — so this browser-engine detail cannot explain the beatlab measurement.*

Sources: <https://padenot.github.io/web-audio-perf/>, <https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/modules/webaudio/audio_handler.h>, <https://hal.science/hal-03957504 (WAC 2022 paper, corroborating the model's extension to non-browser engines)>

### 4. [HIGH] — vote 3-0 (six merged claims, each 3-0)

Chromium Blink WebAudio internals: in default ('operating system') mode the entire graph is rendered on the real-time-priority AudioOutputDevice thread within a fixed budget of ~2.67 ms per 128-frame quantum at 48 kHz; a RAII DenormalDisabler (flush-to-zero via MXCSR/FPSCR) is scoped once per render quantum at the destination because denormals 'can very seriously impact performance on x86'. Historically (2017), rendering was moved to blink::WebThread to let AudioWorklet run V8 on the rendering thread, dropping from REALTIME_AUDIO to ordinary worker priority — a regression Chromium later fixed by giving realtime AudioWorklet threads RT priority.

*Evidence: Hongchan Choi's (Chrome WebAudio owner) web.dev article and mailing-list posts state each fact verbatim; verifiers confirmed DenormalDisabler in the live tree, instantiated in both realtime and offline destination handlers to cover 'all AudioNode processes'. Caveats: the render budget is amortized through a FIFO (brief overruns absorbed); renderSizeHint now makes the 128-frame quantum configurable; the worklet-thread-priority claims are explicitly historical (2017–2020) and must not be presented as current behavior.*

Sources: <https://web.dev/articles/profiling-web-audio-apps-in-chrome>, <https://chromium.googlesource.com/chromium/blink/+/refs/heads/main/Source/platform/audio/DenormalDisabler.h>, <https://groups.google.com/a/chromium.org/g/platform-architecture-dev/c/EnlQMTRwyrw/m/XGLm5tt3CAAJ>, `Chromium issue 40563687 / crbug 813825`, `third_party/blink/renderer/modules/webaudio/{realtime,offline}_audio_destination_handler.cc`

### 5. [HIGH] — vote 3-0

node-web-audio-api is only a napi-rs binding layer; the DSP/rendering engine is the separate Rust crate orottier/web-audio-api-rs, so large-graph performance behavior is determined by the upstream crate's rendering-loop and graph design.

*Evidence: README: 'Node.js bindings for the Rust implementation of the Web Audio API specification... see orottier/web-audio-api-rs for the "real" audio guts'; Cargo.toml depends on web-audio-api = 1.6 plus napi 3.8. Qualifier: the binding can add its own overhead (napi boundary crossings for node creation/param automation, JS AudioWorklets), so a small fraction of observed cost could be wrapper-side.*

Sources: <https://github.com/ircam-ismm/node-web-audio-api (README + Cargo.toml)>

### 6. [HIGH] — vote 3-0 (two merged claims, each 3-0)

web-audio-api-rs architecture: a user-facing control thread plus a real-time render thread (cpal callback) connected by a single lock-free FIFO message queue (single bus deliberately, so topology and parameter messages cannot apply out of order). The render loop executes the whole graph on ONE thread in 128-sample blocks via a topological sort that is cleared and lazily recalculated whenever nodes/connections change (cycles without a DelayNode are muted) — no per-cycle multicore parallelism, O(graph) re-sort on mutation.

*Evidence: WAC 2022 maintainer paper states the design verbatim; verifiers confirmed against current (2026) main-branch source: add_edge/remove_edge call ordered.clear(), order_nodes() is a DFS topo sort recomputed lazily before the next quantum, and rendering iterates self.ordered sequentially. Nuance: re-sorts are lazy, so batched mutations share one re-sort; extra helper threads exist (media decoding, post-2023 GC sidecar).*

Sources: <https://hal.science/hal-03957504/file/WAC_2022_a_rust_implementation_of_the_web_audio_api.pdf (also Zenodo record 6767674)>, <https://github.com/orottier/web-audio-api-rs/blob/main/src/render/graph.rs>, `src/context/concrete_base.rs`

### 7. [HIGH] — vote 3-0

web-audio-api-rs render-thread optimizations are: a custom allocator reusing channel sample vectors (copy-on-write reference-counted AudioRenderQuantum buffers), lock-free message passing/atomics instead of mutexes, and code written for compiler auto-vectorization to SIMD — but allocations may still occur on the audio thread whenever nodes are added/removed or AudioParam automation events are handled, which is directly relevant to Tone.js-style per-note node creation.

*Evidence: Paper Section 5.1 states all three strategies and the caveat verbatim: 'whenever nodes are added or removed, or audio param automation events are handled, (de)allocations may still occur.' The v0.33 changelog added a GC sidecar thread 'to handle some deallocations' — partial post-paper mitigation confirming the problem was not eliminated.*

Sources: <https://hal.science/hal-03957504/file/WAC_2022_a_rust_implementation_of_the_web_audio_api.pdf>, `web-audio-api-rs CHANGELOG (v0.33, 2023-07)`

### 8. [HIGH] — vote 3-0

As of the 2022 paper, web-audio-api-rs benchmarked ~2.8x slower than Chrome and ~5.7x slower than Firefox overall (Adenot's webaudio-benchmark ported to Rust, OfflineAudioContext render time vs buffer duration, 2019 Intel MacBook Pro), with worst gaps on many-node/many-source workloads: granular synthesis 1.5x realtime (Chrome 7, Firefox 32), 100-buffer mixing 10.6x (Chrome 32.6, Firefox 49.4), Synth 21.3x (Chrome 82.8, Firefox 307.6); the authors state performance had not been a focus. This many-source weakness pattern matches the beatlab 0.73x-at-120-nodes observation.

*Evidence: All figures verified exactly against Table 1 and Section 5.2 of the paper PDF. Time-scoped: a 2024 progress report says granular/trigger benches later improved ~3x, so 2022 numbers understate current performance; the 2.8x/5.7x aggregate is the authors' own summary with unshown aggregation method, and the paper flags the comparison as 'not completely fair for all cases'.*

Sources: <https://hal.science/hal-03957504/file/WAC_2022_a_rust_implementation_of_the_web_audio_api.pdf>, <https://zenodo.org/record/10851782 (2024 progress report)>

### 9. [HIGH] — vote 3-0 (two merged claims, each 3-0)

Maintainer profiling of web-audio-api-rs (issue #129, still open as of 2026-07) on a 1,500-buffer-source granular-synthesis benchmark showed 58% of total execution time in Graph::order_nodes vs 29% in actual AudioNode processing — graph ordering, not DSP, dominated at scale. The maintainer attributed this to suspected quadratic complexity in order_nodes or repeated re-ordering.

*Evidence: Issue opened by orottier himself (2022-03-26, 'performance' label) with flamegraph: '58% Graph::order_nodes / 29% AudioNode processing / 12% Graph processing overhead' and verbatim 'Probably some terrible quadratic complexity is happening in the order_nodes function. (or maybe, we are ordering the nodes over and over again?)'. Caveats: profile is from March 2022 (graph storage moved HashMap→Vec in Oct 2023; reordering fixes landed May 2026), so the 58% figure is historical; current code caches ordering for topology-stable graphs, but every graph mutation (e.g. per-note node creation/teardown) still triggers an O(graph) re-sort — the plausible mechanism for the beatlab slowdown, pending re-profiling on v1.6.0.*

Sources: <https://github.com/orottier/web-audio-api-rs/issues/129>

### 10. [HIGH] — vote 3-0 (three merged claims, each 3-0; multi-environment reproduced)

In node-web-audio-api 2.0.0, disconnecting finished source subgraphs from AudioBufferSourceNode.onended handlers during OfflineAudioContext.startRendering() makes offline rendering dramatically slower (reporter: 6.4s→54.1s, ~8x, 2000 sources/60s on macOS arm64; verifier reproduction: 2.3–4.2x on Linux x64) than leaving finished graphs connected — so spec-idiomatic cleanup/pruning is currently counterproductive for offline-render performance, bearing directly on how dotbeat should manage its graph during offline rendering.

*Evidence: Issue #189 numbers (none: 6,439ms / noop onended: 6,630ms / disconnect: 54,124ms) verified verbatim; verifiers then independently reproduced the cliff from scratch twice in this environment on Node 22/Linux x64 (e.g. 14,276ms→59,345ms at the issue's scale). The no-op control isolates the cost to disconnect() itself; effect grows with source count. Caveats: no maintainer response yet (issue 6 days old at verification); magnitude is machine/graph-size dependent; version-specific (v2.0.0, unfixed as of 2026-07-10).*

Sources: <https://github.com/ircam-ismm/node-web-audio-api/issues/189>, <https://github.com/ircam-ismm/node-web-audio-api/issues/168 (corroborating 'ended'-listener memory leak)>, `Independent verifier reproduction: /tmp/claude-0/-home-user-wgpatrick-github-io/b9f605c9-cb70-5a1e-a908-b59cadc35415/scratchpad/nwaa-repro/bench.mjs and .../repro/bench.mjs`

### 11. [HIGH] — vote 3-0

node-web-audio-api's default render size is 128 frames; passing latencyHint: 'playback' at AudioContext creation raises it to 1024 frames — a maintainer-documented block-size knob recommended to fix glitchy ALSA output on Linux.

*Evidence: README quote verified verbatim. Caveats: this is the realtime output-callback block size (per-node internal quantum may remain 128), and it applies to AudioContext, not OfflineAudioContext — so it does not directly address the 0.73x offline measurement.*

Sources: <https://github.com/ircam-ismm/node-web-audio-api (README, fetched 2026-07-10)>

## Refuted claims (do not cite)

- Heavy use of AudioParam automation events (the pattern Tone.js relies on) causes measurable slowdowns in non-Gecko Web Audio engines because the per-quantum linear scan of the parameter event timeline becomes non-trivial as event counts grow.
- This issue contains no data on large-node-graph scaling, per-node overhead, offline-rendering speed relative to realtime, denormals, or rendering-loop design — so it cannot by itself explain or corroborate the observed 0.73x-realtime rendering of a ~120-node graph on node-web-audio-api.

## Caveats

Coverage gaps: no claims about REAPER's anticipative FX processing, Zrythm's documented DSP graph, LMMS, Ardour's parallel process graph internals, or JUCE AudioProcessorGraph's single-threaded RenderSequence survived verification — those parts of research question (1) and (2) remain unanswered by this report despite being explicitly requested. Time-sensitivity: the web-audio-api-rs 2022 benchmarks understate current performance (a 2024 progress report cites ~3x improvements on some benches); the Graph::order_nodes 58% profile predates 2023–2026 graph refactors; Chromium thread-priority claims (worklet thread non-RT, WebThread move) are historical and later fixed; the Ardour page reflects the JACK-callback era. Single-source/self-reported items: Tracktion's '20% faster' figure is author-claimed with no published methodology; the 2.8x/5.7x aggregate is the paper authors' own summary. Applicability warning: the Blink per-quantum graph-traversal finding does NOT apply to the Rust engine beatlab uses (it caches ordering). Two claims were refuted in verification and excluded: (a) that AudioParam event-timeline scanning causes measurable slowdowns in non-Gecko engines (unsupported by the cited source), and (b) an over-broad negative claim about issue #458. The onended-disconnect cliff (issues #189/#168) has no maintainer response yet, though it was independently reproduced twice in this session.

## Open questions

- What is the actual root cause of beatlab's 0.73x measurement on the current web-audio-api-rs v1.6.0 — residual order_nodes re-sorting under Tone.js's per-note graph mutation, audio-thread allocations on add/remove and AudioParam events, the onended-disconnect cliff, or napi binding overhead? A flamegraph re-profile of the real 120-node render is needed to apportion these.
- How exactly do REAPER's anticipative FX processing and Ardour's parallel process graph split work across cores per cycle, and what does JUCE's AudioProcessorGraph RenderSequence do that limits it to one thread? No claims on these survived verification.
- Does node-web-audio-api/web-audio-api-rs offer (or plan) a larger render quantum for OfflineAudioContext (renderSizeHint-style), which would amortize per-node overhead for offline bounces the way latencyHint:'playback' does for realtime output?
- Will the maintainers fix the onended-disconnect offline-render cliff (issue #189), and in the interim is 'never disconnect during offline renders, rebuild the context instead' the optimal beatlab strategy at larger project sizes?

## Sources

- <https://ardour.org/transport_threading.html>
- <https://github.com/Tracktion/tracktion_engine/blob/develop/docs/Engine_2.0_Transition.md>
- <https://padenot.github.io/web-audio-perf/>
- <https://hal.science/hal-03957504/file/WAC_2022_a_rust_implementation_of_the_web_audio_api.pdf>
- <https://forums.cockos.com/showthread.php?p=1840896>
- <https://forum.juce.com/t/audio-processor-graph-bottleneck/54358>
- <https://forum.juce.com/t/adc-tracktion-graph-talk/43052>
- <https://forum.juce.com/t/audioprocessorgraph-slow-manipulations/11067>
- <https://forum.juce.com/t/multithreaded-audioprocessorgraph-source-code/9891>
- <https://forum.juce.com/t/node-graph-clarifications/56170>
- <https://forum.juce.com/t/a-multi-threads-audioprocessorgraph-render/66644>
- <https://web.dev/articles/profiling-web-audio-apps-in-chrome>
- <https://chromium.googlesource.com/chromium/blink/+/refs/heads/main/Source/platform/audio/DenormalDisabler.h>
- <https://github.com/ircam-ismm/node-web-audio-api>
- <https://groups.google.com/a/chromium.org/g/platform-architecture-dev/c/EnlQMTRwyrw/m/XGLm5tt3CAAJ>
- <https://github.com/orottier/web-audio-api-rs/issues/129>
- <https://github.com/ircam-ismm/node-web-audio-api/issues/189>
- <https://github.com/orottier/web-audio-api-rs/issues/458>
- <https://www.youtube.com/watch?v=Mkz908eP_4g>
- <https://github.com/drowaudio/presentations>
- <https://www.soundonsound.com/techniques/running-multiple-plug-ins>

## What this means for dotbeat (the synthesis, ours not the harness's)

1. **Our 0.73× measurement now has a verified architectural explanation.** The Rust engine's own
   maintainer profiling (finding 9: 58% of time in `Graph::order_nodes` vs 29% in DSP on a
   many-source benchmark, issue open) plus the independently-reproduced onended-disconnect
   render cliff (finding 10) both point at **graph-topology churn**, and Tone.js's source-node
   model is churn-maximizing: every note start spawns a fresh native source node and every stop
   disconnects it. Our per-note voice traffic makes the offline render re-order the graph
   constantly. This is upstream-fixable (the issue is open) and also avoidable engine-side in
   the long run (persistent voice graphs rather than node-per-note).
2. **The browser comparison is now understood, not mysterious.** Chromium renders the whole
   graph single-threaded per 128-frame quantum too (finding 4) — its advantage over the Rust
   engine on our workload is engineering maturity (denormal handling, allocator reuse, a decade
   of tuning) plus a graph-ordering strategy that isn't the bottleneck, not a different
   architecture. The 2022 benchmark gap (2.8× vs Chrome, worst on many-node workloads,
   finding 8) matches what we measured four years later.
3. **The M4 native-tier architecture question now has a verified answer shape:** a compiled,
   topologically-ordered node list executed by a lock-free multi-threaded player (Tracktion's
   `tracktion::graph`, finding 1 — explicitly designed so "multi-threaded processing scales
   independently of graph complexity"), with a butler-style thread for disk I/O (Ardour,
   finding 2). This is what "not a toy" looks like at the engine level, and it is exactly the
   piece the single-render-thread Web Audio inheritance can never give us (finding 3).
4. **Near-term offline-render speed options, in order of cost:** (a) track the open upstream
   ordering issue; (b) test `latencyHint`-style larger render quanta where applicable
   (finding 11 — the knob exists for realtime contexts); (c) reduce topology churn from our
   side (e.g. steady-state voice pools) — an engine-level change to schedule for the real
   engine-extraction milestone, not a runner patch.
