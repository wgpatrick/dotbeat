# Research 02 — Pro-Depth Feature Surface & Web-Stack Feasibility Ceiling

> **Fully adversarially verified.** 115 claims extracted, 25 queued for verification, **17 confirmed**, **8 refuted**, 105 verifier agent calls, **0 errors**.

## Question

> Produce a technical specification and feature inventory for building a professional-depth (explicitly not a toy) open-source DAW — feature parity ambitions comparable to Ableton Live — as an evolution of a Tone.js + React web DAW (BeatLab), whose project files are human-readable git-diffable text documents with full CLI/headless access and AI-agent integration. Research questions: (1) FEATURE INVENTORY: What is the complete feature surface of a modern professional DAW (Ableton Live 12 as reference, plus Bitwig Studio 5, FL Studio, Reaper, Logic)? Enumerate deeply: arrangement + session/clip-launch views, audio recording/comping/editing, warping & time-stretch algorithms, MIDI editing (MPE, probability, note expression), instruments & effects suites, racks/chains/macros, modulation systems (Bitwig's modulators, Live's Max for Live), sidechain/routing/groups/returns, automation vs modulation lanes, browser/library/preset management, mixer features, tempo/time-signature changes, freeze/flatten/bounce, export (stems, LUFS-normalized masters), CPU management (multicore, plugin sandboxing), latency compensation. Which of these do users report as make-or-break vs rarely used (forum/survey evidence)? (2) WEB-STACK FEASIBILITY CEILING: For each major subsystem, what is achievable in browser/Electron/Tauri with AudioWorklet + WASM DSP (Rust/C++) vs requires native audio (round-trip latency numbers, plugin hosting — CLAP/VST3 via native shell or WASM ports like WAM2, time-stretch libs like Rubber Band/signalsmith-stretch WASM availability, multicore audio via Workers/SharedArrayBuffer)? What did serious web-DAW efforts (Soundtrap, BandLab, Amped Studio, Wavacity, OpenDAW) prove possible or hit walls on? (3) ARCHITECTURE: How do pro DAW audio engines structure their processing graphs, and what do modern open-source engines (Reaper's architecture write-ups, Ardour, LMMS, Zrythm, GridSound, OpenDAW core, tracktion_engine — especially tracktion_engine since it's an embeddable DAW engine with its own edit file format) teach about engine/document separation, undo systems, and real-time safety? Is tracktion_engine or a Rust engine (e.g. dawlib efforts) a viable backend behind a web UI via Tauri? (4) DSP building blocks: best-in-class open-source libraries for EQ, compression, convolution/algorithmic reverb, limiter, pitch-shift, analysis meters (LUFS/EBU R128), available or portable to WASM. (5) Scaling the text-document format to pro feature depth: how do DAWproject (Bitwig/PreSonus interchange XML) and tracktion .tracktionedit represent this full feature surface, and what schema lessons transfer to a git-diffable format with audio-file references (content-addressed sample storage, project portability)? Deliver: a cited tech spec — tiered feature list (MVP / v1 / parity / explicitly-out-of-scope with rationale), per-subsystem feasibility verdicts on the web stack with fallback paths (Tauri native audio, WASM DSP), engine architecture recommendation, and the top 10 technical risks ranked.

## Executive summary

Verified evidence clusters into two solid pillars — a partial feature-inventory sketch drawn entirely from Ableton Live 12's own marketing/release notes, and a stronger web-stack feasibility picture built on WAM2 (Web Audio Modules 2.0), Emscripten's Wasm Audio Worklets, and W3C mailing-list/workshop testimony. The feasibility evidence is consistent and fairly rigorous: AudioWorklet is confirmed as the sole real-time-thread entrypoint in browsers, C/C++/Rust DSP can be compiled to WASM and run inside it via Emscripden's Wasm Audio Worklets with no GC-garbage generation, WAM2 provides a VST-like interoperable plugin/host standard with its own parameter and sample-accurate-scheduling API (deliberately bypassing native AudioParam), and multicore scaling is only achievable via multiple communicating audio graphs over SharedArrayBuffer ring buffers, not intra-graph parallelism. Two independent working systems (WAM Studio, openDAW) demonstrate a real multitrack DAW is buildable on this stack today, but round-trip latency data from Soundtrap (~30ms best case vs. a ~10ms professional target, circa 2021) marks the ceiling that still separates web DAWs from native ones. Critically, this evidence base does NOT cover engine architecture (tracktion_engine, Ardour, Reaper, Zrythm), DSP library portability (EQ/compression/reverb/pitch-shift/LUFS), the DAWproject/.tracktionedit schema question, or forum/survey evidence on which features are make-or-break — those research questions remain open.

## Verified findings

### 1. [MEDIUM (2-1 (both sub-claims))]

Ableton Live 12's MIDI editor goes well beyond piano-roll editing to include generative MIDI Transformations/Generators and expanded probability — including group-trigger probability (a single probability rule applied to a group of notes, or random note selection from a chord) alongside earlier per-note Note Chance — establishing generative/transform tooling and note-chance as baseline pro-DAW MIDI features. Live 12 also supports MPE end-to-end: MPE-capable instruments (Meld, Granulator III), MPE-aware drum packs, an MPE Max for Live device, and dedicated LFO/glissando curve editing for MPE parameters.

*Evidence: Primary Ableton marketing page confirms MIDI Transformations/Generators, group-trigger probability, MPE-capable Meld/Granulator III, and MPE curve editing verbatim. Corroborated by Sound on Sound, Attack Magazine, help.ableton.com FAQs, and Ableton's Granulator III product page. Sourced from a single vendor (Ableton) describing its own flagship product, so treat as reference-DAW feature description rather than independently audited fact.*

Sources: <https://www.ableton.com/en/live/all-new-features/>

### 2. [MEDIUM (2-1)]

Ableton Live 12's browser/library system treats preset and sample management as a first-class subsystem: automatic and manual tagging (including a dedicated Tag Editor / Quick Tags panel), ML-powered Sound Similarity Search, and browser navigation history (back/forward like a web browser).

*Evidence: Confirmed via Ableton's marketing page plus corroborating help.ableton.com documentation ('Browser and Tags in Live 12 FAQ', reference manual). Single-vendor source; no independent user-survey evidence on how heavily these are actually used.*

Sources: <https://www.ableton.com/en/live/all-new-features/>

### 3. [HIGH (3-0)]

Live 12 changed its modulation architecture so modulation sources no longer overwrite/lock parameter values — manual adjustment and LFO/modulation control can coexist simultaneously on the same parameter. This is a concrete, implementable design point for how an automation-lane system should compose with a modulation-lane system in a new DAW engine.

*Evidence: Verbatim-matching primary source quote, corroborated by CDM's Live 12 feature roundup and forum discussion confirming this changed from prior (Live 11) locked-parameter behavior.*

Sources: <https://www.ableton.com/en/live/all-new-features/>

### 4. [HIGH (3-0)]

Live 12.4 exposes a Windows debug option ('EnableRealTimeWorkQueue') raising the audio-processing thread cap from an OS-limited 32 to 64 threads, with Ableton's own documentation cautioning that more threads do not necessarily improve performance due to thread-management overhead — a concrete data point for a CPU-management/multicore subsystem design.

*Evidence: Verbatim match to official Ableton release notes; the diminishing-returns caveat is stated by the vendor itself, not inferred.*

Sources: <https://www.ableton.com/en/release-notes/live-12/>

### 5. [HIGH (3-0 (both sub-claims))]

Browser-based DAWs, per direct production experience (Soundtrap/Spotify, W3C workshop, late 2021), achieved at best ~30ms round-trip audio latency — usable for monitoring while recording but not professional-grade — while the stated target to compete with native DAWs is ~10ms, which the web platform did not deliver at that time. This is the central quantified feasibility ceiling for real-time audio in the browser.

*Evidence: Verbatim primary-source quotes from a named engineer at a production browser DAW company, presented to the W3C/SMPTE professional media production workshop. Time-scoped to late 2021; no verified claim about whether this gap has closed as of 2026 survived adversarial review (a related claim about the specific technical cause — unexposed MediaStreamSourceNode/outputLatency — was refuted 0-3).*

Sources: <https://www.w3.org/2021/03/media-production-workshop/talks/ulf-hammarqvist-audio-latency.html>

### 6. [HIGH (3-0 (all sub-claims))]

Web Audio Modules 2.0 (WAM2) is an open-source (MIT-licensed), academically peer-reviewed plugin/host standard analogous to VST for the browser: DSP written in C/C++/FAUST/Csound compiles to WebAssembly and hosts as instruments, real-time effects, or MIDI/controller plugins. It provides sample-accurate scheduling of automation, MIDI, OSC, and transport events via a unified API mirrored on main and audio threads (main-thread-only hosts must schedule with lookahead across the thread barrier; audio-thread-resident hosts can schedule within the current rendering block), and it deliberately bypasses the native Web Audio AudioParam automation API — which predates audio-thread access and requires async main-thread scheduling — in favor of its own WamParameter API, because exposing hundreds of WASM-resident parameters via AudioParam is too heavy and incompatible with synchronous native-plugin-style host/plugin interaction.

*Evidence: Peer-reviewed ACM Web Conference 2022 paper by the WAM2 designers, verbatim-matched on all architectural claims (open-source/MIT, WASM compilation from multiple languages, sample-accurate scheduling and thread-barrier lookahead behavior, and the explicit AudioParam-bypass rationale). Corroborated by the companion WAM Studio paper (ACM Web Conf 2023) describing WAM as used by a real working host, and by webaudiomodules.com official docs and independent summaries (ResearchGate, HAL/Inria preprint).*

Sources: <https://dl.acm.org/doi/fullHtml/10.1145/3487553.3524225>, <https://dlnext.acm.org/doi/10.1145/3543873.3587987>

### 7. [MEDIUM (2-1)]

AudioWorklet is, at present, the only browser entrypoint for developer code to run on the high-priority real-time audio thread; real-time audio processing is a hard-realtime task with millisecond-scale deadlines where processing overruns cause audible glitches — making AudioWorklet the mandatory foundation for any professional-grade web DAW engine.

*Evidence: Verbatim-matched to the WAM2 ACM paper; corroborated by MDN AudioWorklet docs (checked current as of ~May 2026) and Chrome DevRel material confirming no newer competing API has emerged since 2022.*

Sources: <https://dl.acm.org/doi/fullHtml/10.1145/3487553.3524225>

### 8. [HIGH (3-0 (both sub-claims))]

C/C++ code (including ported Rust/C++ DSP libraries) can be compiled via Emscripten's Wasm Audio Worklets API to run directly as AudioWorkletProcessor nodes on the browser's real-time audio thread — not merely in JavaScript — and the Emscripten runtime's own glue code is engineered to generate zero JavaScript garbage, eliminating GC pauses as a source of audio glitches from that layer specifically.

*Evidence: Official Emscripten documentation, confirmed current across v4.x/5.x/6.x-dev, corroborated by Chrome for Developers audio-worklet design-pattern posts, CMU researcher Roger Dannenberg's WASM/Web Audio writeup, and working example repos. Real caveats apply (pull-mode callback, no general-purpose RT threads beyond the worklet, user WASM code must still avoid blocking) — the no-garbage guarantee is scoped to Emscripten's own interop glue, not to all possible audio-thread code.*

Sources: <https://emscripten.org/docs/api_reference/wasm_audio_worklets.html>

### 9. [MEDIUM (2-1)]

Per Paul Adenot (Mozilla, Web Audio API spec editor), the viable path to multicore audio DSP on the web is not parallelizing a single audio graph but running multiple communicating audio graphs (e.g., separate AudioContexts on separate threads) that exchange data via wait-free ring buffers over SharedArrayBuffer.

*Evidence: Primary W3C public-audio mailing-list email from the named spec editor, verbatim-matched. Follow-up GitHub issues (WebAudio/web-audio-api #2409, #2500) show this remains the live, unresolved architectural direction years later, with no adopted spec for true intra-graph parallelism. A related but more specific claim about Chrome-vs-Firefox threading-model divergence was refuted (1-2) and one about bounded buffering-latency cost was refuted (0-3), so treat only the core multi-graph/ring-buffer architectural point as confirmed, not the more granular implementation details.*

Sources: <https://lists.w3.org/Archives/Public/public-audio/2020AprJun/0015.html>

### 10. [HIGH (3-0 (both sub-claims))]

Working proofs-of-concept confirm a professional-adjacent web DAW is buildable on standardized W3C browser APIs today. WAM Studio (2023, ACM peer-reviewed) is a multitrack recording/mixing/producing/playing DAW built entirely on Web Audio, WebAssembly, Web Components, Web MIDI, and Media Devices APIs, using the WAM standard for interoperable plugin hosting (effects, instruments, MIDI controllers) — explicitly framed by its authors as a 'technology demonstrator,' not production software. Separately, openDAW is an actively developed open-source web-based DAW (TypeScript ~76% / Rust ~21%, ~1.9k GitHub stars, ~3,489 commits as of July 2026) that stands out as the most substantial open-source web-DAW prior art currently available.

*Evidence: WAM Studio paper verbatim-matched (ACM Web Conf 2023 Companion); openDAW repo stats live-verified via direct GitHub fetch and DeepWiki mirror, distinguishing the active repo from a deprecated 'opendaw-studio' repo that some search snippets confused it with. Note: several more specific/aggressive claims about these two projects were refuted on reverification — WAM Studio's stated 'principal engineering difficulties' claim (0-3), and three separate openDAW claims about its WASM engine status, a headless SDK, and specific unimplemented-feature roadmap items (all 0-3) — so only the core 'these are real, working, actively-developed systems' claims should be treated as confirmed; do not cite the refuted specifics about their internal implementation status.*

Sources: <https://dlnext.acm.org/doi/10.1145/3543873.3587987>, <https://github.com/andremichelle/openDAW>

## Refuted claims (explicitly rejected — do not cite)

These were extracted and looked plausible, but failed adversarial verification. Listed so we don't accidentally re-cite them later.

- Live 12.3 added dedicated bounce commands — Bounce Track in Place, Bounce to New Track, group-track bounce variants, and Paste Bounced Audio — with defined signal-path semantics (track bounces are pre-mixer/post-FX; group bounces include return tracks), making freeze/flatten/bounce a first-class, precisely-specified feature area a parity-targeting DAW must replicate.
- Accurate recording-latency compensation (aligning recorded takes with playback) is blocked in browsers because latency introduced at various pipeline stages is not exposed through web APIs — e.g., MediaStreamSourceNode adds latency that is 'not exposed anywhere' and AudioContext.outputLatency semantics are unclear.
- As of April 2020, browsers made divergent implicit threading choices for Web Audio: Chrome allocated one real-time thread per AudioContext (more parallelism, added latency at graph boundaries), while Firefox multiplexed all AudioContexts onto a single real-time thread (zero inter-graph latency, less parallelism) — meaning a web DAW cannot rely on a standardized multicore audio-thread model.
- The added buffering cost of a multi-threaded (multi-graph) web audio architecture is bounded: with Firefox's default 128-frame buffers on macOS, doubling or tripling the buffer for resilience keeps latency well under 10 ms, per Adenot.
- The browser's sandboxed execution environment and latency compensation were the principal engineering difficulties the authors hit when building a DAW on the web stack — first-party evidence that these are the binding constraints (the feasibility ceiling) rather than raw DSP capability.
- openDAW currently runs its audio engine without a WASM DSP core: a WASM audio engine is only a roadmap item targeted for 2026/Q2, meaning a functioning multi-track web DAW with 27 stock devices has shipped on TypeScript/AudioWorklet-style processing alone.
- openDAW ships a headless SDK (openDAW-headless on npm) alongside the web studio, demonstrating engine/document separation and programmatic/headless access to a web DAW engine — directly relevant to BeatLab's CLI/headless and AI-agent integration goals.
- Professional-depth audio-editing features are still unimplemented in openDAW and scheduled on its roadmap: audio-region fades in 2026/Q1, tempo/time-signature automation tracks in 2026/Q1-Q2, pitch/stretch playback algorithms in 2026/Q4, and a 1.0 launch in 2026/Q3 — evidence of where the web-DAW feasibility ceiling currently sits for warping/time-stretch and tempo-map features.

## Caveats

This synthesis rests on 17 adversarially-verified claims but has substantial coverage gaps relative to the five research questions posed. (1) Feature inventory: all surviving claims are sourced from a single vendor (Ableton's own marketing pages and release notes) describing Live 12; none touch Bitwig Studio 5's modulator system, FL Studio, Reaper, or Logic, and no forum/survey evidence on make-or-break vs. rarely-used features survived verification — the make-or-break question from the brief is effectively unanswered. Several plausible-sounding claims about Live 12 bounce/freeze semantics were explicitly refuted (0-3), so freeze/flatten/bounce workflow claims should not be assumed from this evidence set. (2) Web-stack feasibility: the surviving evidence is strong on WAM2/Emscripten/AudioWorklet architecture but the headline latency figure (~30ms best case, 2021) is now 5 years old and time-scoped to Soundtrap's specific pipeline — no confirmed claim establishes whether this gap has narrowed by 2026. A claim about the specific technical cause of recording-latency-compensation problems (unexposed API latency) was refuted, so the *mechanism* behind the latency ceiling remains uncertain even though the *magnitude* is well-evidenced. (3) Engine architecture: zero surviving claims address tracktion_engine, Ardour, Reaper's engine write-ups, Zrythm, LMMS, GridSound, or Rust DAW engines — the core Q3 architecture-recommendation question is unaddressed by this evidence base. (4) DSP building blocks: zero surviving claims address EQ/compression/reverb/limiter/pitch-shift/LUFS-metering libraries or their WASM portability (Rubber Band, signalsmith-stretch, etc.) — Q4 is entirely unanswered. (5) Text-format schema lessons: zero surviving claims address DAWproject XML or .tracktionedit format structure — Q5 is entirely unanswered. Where a claim's vote was 2-1 rather than 3-0, treat it as medium confidence — a dissent existed even if the majority verification held.

## Open questions (not covered by surviving evidence)

- What do tracktion_engine, Ardour, Reaper's own architecture documentation, Zrythm, LMMS, and GridSound teach about processing-graph structure, engine/document separation, undo-system design, and real-time safety patterns for an open-source DAW engine — and is tracktion_engine or a Rust engine viable as a Tauri-embedded backend behind a web UI? (No verified evidence collected.)
- What open-source DSP libraries (EQ, compression, convolution/algorithmic reverb, limiter, pitch-shift, LUFS/EBU R128 metering) are best-in-class and WASM-portable today, and which are already ported vs. would require porting effort? (No verified evidence collected.)
- How do DAWproject (Bitwig/PreSonus interchange XML) and tracktion's .tracktionedit format represent the full professional feature surface (racks, modulation, automation, warping, comping), and what schema lessons transfer to a git-diffable text format with content-addressed sample storage? (No verified evidence collected.)
- Has the browser round-trip audio latency ceiling (~30ms best case per 2021 Soundtrap data) improved materially by 2026, and if so via what mechanism (AudioContext.outputLatency exposure, WebCodecs, improved worklet scheduling)? The refuted claim about the specific technical cause (unexposed MediaStreamSourceNode/outputLatency) leaves the underlying mechanism of the gap unresolved.
- What forum/survey evidence exists on which pro-DAW features (comping, warping algorithms, racks/macros, sidechain routing, etc.) users report as make-or-break vs. rarely used — none of the claims that reached verification addressed this directly, despite it being an explicit research question.

## Sources

- <https://www.ableton.com/en/live/all-new-features/> — *primary*
- <https://www.soundonsound.com/reviews/ableton-live-12> — *secondary*
- <https://musictech.com/guides/buyers-guide/bitwig-studio-6-vs-ableton-live-12-which-daw-should-you-choose/> — *secondary*
- <https://www.musicradar.com/news/ableton-live-vs-bitwig-studio> — *secondary*
- <https://musictech.com/reviews/digital-audio-workstations/ableton-live-12-review/> — *secondary*
- <https://www.ableton.com/en/release-notes/live-12/> — *primary*
- <https://www.w3.org/2021/03/media-production-workshop/talks/ulf-hammarqvist-audio-latency.html> — *primary*
- <https://dl.acm.org/doi/fullHtml/10.1145/3487553.3524225> — *primary*
- <https://github.com/WebAudio/web-audio-api/issues/2632> — *forum*
- <https://emscripten.org/docs/api_reference/wasm_audio_worklets.html> — *primary*
- <https://lists.w3.org/Archives/Public/public-audio/2020AprJun/0015.html> — *primary*
- <https://dlnext.acm.org/doi/10.1145/3543873.3587987> — *primary*
- <https://news.ycombinator.com/item?id=42988913> — *forum*
- <https://github.com/andremichelle/openDAW> — *primary*
- <https://news.ycombinator.com/item?id=37356497> — *forum*
- <https://www.youtube.com/watch?v=Mkz908eP_4g> — *primary*
- <https://github.com/Tracktion/tracktion_engine/blob/develop/docs/Engine_2.0_Transition.md> — *primary*
- <https://github.com/drowaudio/presentations> — *primary*
- <https://ardour.org/news/6.0.html> — *primary*
- <https://github.com/bitwig/dawproject> — *primary*
- <https://github.com/Signalsmith-Audio/signalsmith-stretch> — *primary*
- <https://github.com/Daninet/rubberband-wasm> — *primary*
- <https://github.com/jiixyj/libebur128> — *primary*
