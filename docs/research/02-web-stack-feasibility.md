# Research 02 — Pro-Depth Feature Surface & Web-Stack Feasibility Ceiling

> Deep-research pass. **115 claims** extracted from **23 sources** across 5 search angles. Verification stage rate-limited mid-run: **0 adversarially verified**, 1 refuted, the rest single-source (quoted but not triangulated).

## Research question

> Produce a technical specification and feature inventory for building a professional-depth (explicitly not a toy) open-source DAW — feature parity ambitions comparable to Ableton Live — as an evolution of a Tone.js + React web DAW (BeatLab), whose project files are human-readable git-diffable text documents with full CLI/headless access and AI-agent integration. Research questions: (1) FEATURE INVENTORY: What is the complete feature surface of a modern professional DAW (Ableton Live 12 as reference, plus Bitwig Studio 5, FL Studio, Reaper, Logic)? Enumerate deeply: arrangement + session/clip-launch views, audio recording/comping/editing, warping & time-stretch algorithms, MIDI editing (MPE, probability, note expression), instruments & effects suites, racks/chains/macros, modulation systems (Bitwig's modulators, Live's Max for Live), sidechain/routing/groups/returns, automation vs modulation lanes, browser/library/preset management, mixer features, tempo/time-signature changes, freeze/flatten/bounce, export (stems, LUFS-normalized masters), CPU management (multicore, plugin sandboxing), latency compensation. Which of these do users report as make-or-break vs rarely used (forum/survey evidence)? (2) WEB-STACK FEASIBILITY CEILING: For each major subsystem, what is achievable in browser/Electron/Tauri with AudioWorklet + WASM DSP (Rust/C++) vs requires native audio (round-trip latency numbers, plugin hosting — CLAP/VST3 via native shell or WASM ports like WAM2, time-stretch libs like Rubber Band/signalsmith-stretch WASM availability, multicore audio via Workers/SharedArrayBuffer)? What did serious web-DAW efforts (Soundtrap, BandLab, Amped Studio, Wavacity, OpenDAW) prove possible or hit walls on? (3) ARCHITECTURE: How do pro DAW audio engines structure their processing graphs, and what do modern open-source engines (Reaper's architecture write-ups, Ardour, LMMS, Zrythm, GridSound, OpenDAW core, tracktion_engine — especially tracktion_engine since it's an embeddable DAW engine with its own edit file format) teach about engine/document separation, undo systems, and real-time safety? Is tracktion_engine or a Rust engine (e.g. dawlib efforts) a viable backend behind a web UI via Tauri? (4) DSP building blocks: best-in-class open-source libraries for EQ, compression, convolution/algorithmic reverb, limiter, pitch-shift, analysis meters (LUFS/EBU R128), available or portable to WASM. (5) Scaling the text-document format to pro feature depth: how do DAWproject (Bitwig/PreSonus interchange XML) and tracktion .tracktionedit represent this full feature surface, and what schema lessons transfer to a git-diffable format with audio-file references (content-addressed sample storage, project portability)? Deliver: a cited tech spec — tiered feature list (MVP / v1 / parity / explicitly-out-of-scope with rationale), per-subsystem feasibility verdicts on the web stack with fallback paths (Tauri native audio, WASM DSP), engine architecture recommendation, and the top 10 technical risks ranked.

## Sources

- <https://www.ableton.com/en/live/all-new-features/> — *primary*, 5 claims
- <https://www.soundonsound.com/reviews/ableton-live-12> — *secondary*, 5 claims
- <https://musictech.com/guides/buyers-guide/bitwig-studio-6-vs-ableton-live-12-which-daw-should-you-choose/> — *secondary*, 5 claims
- <https://www.musicradar.com/news/ableton-live-vs-bitwig-studio> — *secondary*, 5 claims
- <https://musictech.com/reviews/digital-audio-workstations/ableton-live-12-review/> — *secondary*, 5 claims
- <https://www.ableton.com/en/release-notes/live-12/> — *primary*, 5 claims
- <https://www.w3.org/2021/03/media-production-workshop/talks/ulf-hammarqvist-audio-latency.html> — *primary*, 5 claims
- <https://dl.acm.org/doi/fullHtml/10.1145/3487553.3524225> — *primary*, 5 claims
- <https://github.com/WebAudio/web-audio-api/issues/2632> — *forum*, 5 claims
- <https://emscripten.org/docs/api_reference/wasm_audio_worklets.html> — *primary*, 5 claims
- <https://lists.w3.org/Archives/Public/public-audio/2020AprJun/0015.html> — *primary*, 5 claims
- <https://dlnext.acm.org/doi/10.1145/3543873.3587987> — *primary*, 5 claims
- <https://news.ycombinator.com/item?id=42988913> — *forum*, 5 claims
- <https://github.com/andremichelle/openDAW> — *primary*, 5 claims
- <https://news.ycombinator.com/item?id=37356497> — *forum*, 5 claims
- <https://www.youtube.com/watch?v=Mkz908eP_4g> — *primary*, 5 claims
- <https://github.com/Tracktion/tracktion_engine/blob/develop/docs/Engine_2.0_Transition.md> — *primary*, 5 claims
- <https://github.com/drowaudio/presentations> — *primary*, 5 claims
- <https://ardour.org/news/6.0.html> — *primary*, 5 claims
- <https://github.com/bitwig/dawproject> — *primary*, 5 claims
- <https://github.com/Signalsmith-Audio/signalsmith-stretch> — *primary*, 5 claims
- <https://github.com/Daninet/rubberband-wasm> — *primary*, 5 claims
- <https://github.com/jiixyj/libebur128> — *primary*, 5 claims

## All extracted claims (with source quotes)

Each claim is tagged with its verification status. `VERIFIED` = survived 2–3 skeptic votes. `SINGLE-SOURCE` = quoted from the page but the verifier vote was rate-limited. `—` = extracted but not queued for verification.

### 1. [SINGLE-SOURCE (not triangulated)]

Ableton Live 12 includes built-in MIDI Transformation and Generation tools (with per-note probability rules and group-trigger probability), meaning a parity-targeting DAW's MIDI editor must cover generative/transform operations and note-chance features, not just piano-roll editing.

> Create a variety of simple or complex variations to your MIDI clips: add ornaments and articulations, draw acceleration and deceleration curves, connect successive notes and chords, or simulate the strum of a guitar.

### 2. [SINGLE-SOURCE (not triangulated)]

Live 12 supports MPE across editing and instruments, including LFO/glissando curve editing for MPE parameters and MPE-capable devices such as Meld and Granulator III, establishing MPE as part of the modern pro-DAW feature baseline.

> Meld: A "bi-timbral, MPE-capable instrument designed for deep sound shaping" ... Glissando and LFO curve creation for MPE parameters.

### 3. [SINGLE-SOURCE (not triangulated)]

Live 12's browser/library system includes automatic and manual tagging, machine-learning sound-similarity search, and browser history — indicating preset/sample library management with search and tagging is a first-class subsystem in the reference DAW, not an afterthought.

> Sound Similarity Search: Machine learning-powered discovery finding comparable sounds; Drum Rack swapping for texture exploration.

### 4. [SINGLE-SOURCE (not triangulated)]

Live 12 changed its modulation architecture so modulation sources no longer override parameter values, allowing simultaneous manual control and LFO modulation — a concrete design point for how automation vs. modulation lanes should compose in a new DAW engine.

> New Modulation Behavior: Modulation sources no longer override parameter values, enabling simultaneous manual adjustment and LFO control.

### 5. [—]

Live 12 adds workflow features that a parity spec must inventory: bounce clips/groups in place with processing, stacked device+clip detail views, a mixer available in Arrangement View, stem separation (Suite-only, via Music.AI), and support for tuning systems beyond 12-TET.

> Bounce clips to new tracks with processing included; bounce Group tracks in place; paste bounced audio into any track.

### 6. [—]

Bitwig Studio 6 provides over 40 modulator types, whereas Ableton Live 12 offers roughly six modulators (in Standard/Suite), making Bitwig's per-parameter modulation system substantially deeper — directly relevant to the modulation-systems line item in the DAW feature inventory.

> Bitwig offers "over 40" modulator types versus Ableton's six available in Standard/Suite versions. The article states: "Parameter modulation is where Bitwig steals the show."

### 7. [—]

Bitwig Studio 6 hosts VST2/VST3 and CLAP plugins and runs them with plugin sandboxing for crash isolation, while Ableton Live 12 supports VST2/VST3 and AU without an equivalent sandboxing feature — evidence that CLAP hosting and plugin sandboxing are shipping features in at least one reference pro DAW.

> Ableton: VST2/3 and AU plugins; Bitwig: VST2/3 and CLAP plugins with "plugin sandboxing for greater stability"

### 8. [—]

The two DAWs' extensibility models differ: Ableton Live's extension surface is Max for Live (Cycling '74's visual programming environment) while Bitwig's is The Grid, a built-in modular environment for building instruments and effects — both are part of the feature-parity surface a competing DAW would be measured against.

> Ableton features Max for Live, described as "Cycling '74's visual programming language"; Bitwig includes The Grid, characterized as "modular system for creating your own instruments and effects"

### 9. [—]

Bitwig Studio runs on Linux in addition to macOS and Windows, while Ableton Live 12 is macOS/Windows only — relevant to cross-platform expectations for an open-source DAW project.

> Bitwig supports Linux; "Ableton Live only runs on macOS and Windows"

### 10. [—]

Ableton Live 12 is sold in three editions from $99 to $749 (Intro capped at 16 tracks), versus Bitwig Studio 6's three editions from $99 to $399 with no track limit in the cheapest tier.

> Ableton Live 12 Pricing: Ranges from $99 to $749 across three editions; Intro version has a 16-track limit. Bitwig Studio 6 Pricing: Ranges from $99 to $399 across three editions; No track limit in cheapest tier

### 11. [—]

Ableton Live 12 adds native scale-awareness and microtuning: clips, MIDI effects, and some devices can constrain notes to a scale, with support for arbitrary tuning systems including Scala file import — but Max for Live devices are not scale-aware, showing that even Ableton could not retrofit scale/tuning across its whole modulation/extension ecosystem.

> Live is now scale‑aware, in that clips and MIDI effects, as well as some devices, can have their notes constrained to a particular scale. ... Max For Live also has no awareness of the scale system, at least for now.

### 12. [—]

Live 12 introduces destructive clip-level MIDI generator and transformer tools (Arpeggiator, Quantise, Rhythm, Euclidian, Strum) that modify notes in place, a distinct feature category from real-time MIDI effects that a feature-parity inventory must include.

> New destructive clip-level editing tools (generators and transformers) including Arpeggiator, Quantise, Rhythm, Euclidian, and Strum. These "alter the pitch, placement and duration of notes in‑place in the clip."

### 13. [—]

Live 12 upgrades Max for Live from automation-writing to true parameter modulation (offsetting parameters from their base values, shown as green dots), confirming that a modulation system distinct from automation lanes is part of the modern DAW feature surface.

> Max For Live can now perform "proper modulation" rather than automation, offsetting parameters from base values (indicated by green dots).

### 14. [—]

Live 12's browser was substantially reworked around tagging and filtering (by sample type, sound category, plugin format), indicating that library/preset management with metadata tagging is a first-class subsystem in a pro DAW.

> The browser received a "big revamp" with tagging/filtering system allowing users to organize content by characteristics like sample type, sound category, and plugin format.

### 15. [—]

Live 12's flagship new instruments/effects (Meld two-voice-path MPE synth with 24 oscillator types, Roar three-path waveshaper, Granulator III granular player with MPE) are Suite-only, and Live is sold in three tiers (Intro $99, Standard $439, Suite $749) — evidence that a large bundled instrument/effect suite is a major, tiered part of the commercial feature surface.

> New Devices (Suite only): Meld instrument: "two voice paths layered in parallel" with 24 oscillator types and modulation matrix; Roar effect: waveshaper with three configurable signal paths; Granulator III: granular sample player with MPE support. Edition Pricing: Intro: £69/$99, Standard: £259/$439, Suite: £539/$749

### 16. [—]

Ableton Live 12 adds MIDI note probability control and four generative MIDI generators (Rhythm, Seed, Shape, Stacks), confirming that per-note probability and MIDI generation belong in a Live-12-parity feature inventory.

> A MIDI Note Probability function provides hands-on control of how likely notes or groups of notes are to play back

### 17. [—]

Live 12 expands MPE (MIDI Polyphonic Expression) support, with the new Meld synth designed to take advantage of it, so MPE support is part of the Live 12 reference feature surface.

> Live's MIDI Polyphonic Expression (MPE) support has been expanded too, with the Meld synth in particular able to take advantage

### 18. [—]

Live 12 introduces Scale Awareness tools that can conform individual clips, effects, and devices to specific musical scales, i.e., project-wide and per-clip scale/tuning integration is a flagship-DAW feature.

> Live 12 now has improved Scale Awareness tools, with the ability to conform individual clips, effects and devices to specific musical scales

### 19. [—]

Live 12 ships two new first-party devices — the Meld synth (two macro oscillator engines) and the Roar saturation effect — as part of its built-in instrument/effect suite.

> a dynamic saturation effect for everything from subtle warming to fierce sound mangling

### 20. [—]

Live 12 reworks its browser/library with tags, filters, and a similarity search for sounds, and allows viewing the Session mixer inside Arrangement view, indicating browser/preset management and view unification are active areas of flagship-DAW workflow investment.

> ability to view the Session mixer in Arrangement view so you no longer have to switch to Session

### 21. [—]

Both Ableton Live and Bitwig Studio provide two sequencing areas — a clip launcher (Session View) and a linear arrangement timeline — but only Bitwig can display the clip launcher and arrangement side-by-side simultaneously.

> both DAWs have two sequencing areas, a clip launcher (aka the Session View in Ableton Live) and a more traditional linear arrangement timeline... You can, for example, use the clip launcher and arrangement timeline side-by-side in Bitwig, which isn't possible in Live.

### 22. [—]

Bitwig Studio has a unified modulation system that lets a large number of modulation generators be attached to any device, whereas Ableton Live's equivalent extensibility comes via Max for Live's ecosystem of user-made devices.

> Bitwig's unified modulation system...allows for a vast number of modulation generators to be added to any device. ... Max gives the user access to a wealth of user-made devices, both free and paid, that can be found online.

### 23. [—]

Both Ableton Live and Bitwig Studio support MPE, including editing multiple per-note expression dimensions inside MIDI clips.

> Both DAWs are MPE capable, and allow users to edit multiple levels of expression within MIDI clips.

### 24. [—]

Bitwig Studio sandboxes plugins in walled-off host processes for crash protection, a stability feature the article singles out versus Ableton Live.

> Bitwig Studio is worthy of special mention when it comes to stability...the DAW's system of plugin hosting and crash protection...keeps plugins 'walled-off' from the main DAW.

### 25. [—]

Ableton Live's signature audio capability is automatic time-stretching via Warp Markers, while Bitwig's differentiator is audio containers that allow slicing and rearranging audio within a clip.

> one of Live's most distinctive features has always been its ability to automatically time-stretch audio using Warp Markers. ... Bitwig's use of audio containers...allows the user to slice and rearrange audio within a clip.

### 26. [SINGLE-SOURCE (not triangulated)]

As of late 2021, browser-based DAWs (per Soundtrap's production experience) achieve at best around 30 ms round-trip audio latency, which is usable for monitoring while recording but falls short of professional expectations.

> 30ms best case round-trip latency, which is passable for monitoring purposes, but not great.

### 27. [SINGLE-SOURCE (not triangulated)]

To compete with native DAWs, a browser DAW would need roughly 10 ms round-trip latency, which the web platform did not deliver at the time of the talk.

> 10ms is a good target, that really is decent

### 28. [SINGLE-SOURCE (not triangulated)]

Accurate recording-latency compensation (aligning recorded takes with playback) is blocked in browsers because latency introduced at various pipeline stages is not exposed through web APIs — e.g., MediaStreamSourceNode adds latency that is 'not exposed anywhere' and AudioContext.outputLatency semantics are unclear.

> we don't have good accurate numbers ... [MediaStreamSourceNode latency is] not exposed anywhere ... [outputLatency] does seem to indicate that is the block size as well as the output path combined, but it's not immediately clear

### 29. [—]

MediaRecorder provides no timing guarantee that recording starts immediately when invoked, which undermines sample-accurate alignment of recorded audio in a web DAW.

> no spec-wise or guarantees that when you start it, it's going to start immediately

### 30. [—]

The fixes Soundtrap asked for from the web platform are exposing input/output latencies at every translation point between standards, adding timing callbacks to media recording, and implementers lowering and reporting actual driver latencies — implying these were unmet gaps circa 2021.

> get the input and output latencies low

### 31. [SINGLE-SOURCE (not triangulated)]

Ableton Live 12 on Windows exposes a debug option ('EnableRealTimeWorkQueue') that raises the audio processing thread cap from the OS-limited 32 to 64 threads, and Ableton itself cautions that more threads do not necessarily improve performance due to thread-management overhead — directly informing the CPU-management/multicore subsystem of the spec.

> Real-time work queue option on Windows: "EnableRealTimeWorkQueue" debug option allows up to 64 audio processing threads instead of OS-limited 32 ... "does not necessarily improve performance, as a higher number of threads can increase thread management overhead"

### 32. [SINGLE-SOURCE (not triangulated)]

Live 12.3 added dedicated bounce commands — Bounce Track in Place, Bounce to New Track, group-track bounce variants, and Paste Bounced Audio — with defined signal-path semantics (track bounces are pre-mixer/post-FX; group bounces include return tracks), making freeze/flatten/bounce a first-class, precisely-specified feature area a parity-targeting DAW must replicate.

> Bounce Track in Place: renders entire track as new audio track ... Processing: pre-mixer, post-FX (includes source track effects) ... Bounce Group to New Track: includes all processing and return tracks

### 33. [—]

Live 12.3 shipped built-in stem separation that splits audio into four stems (Vocals, Drums, Bass, Others), runs locally on CPU with optional GPU acceleration on recent Apple Silicon macOS, and offers High Speed vs High Quality modes — an ML-based audio-editing feature now part of the mainstream pro-DAW feature surface.

> Splits audio into four stems: Vocals, Drums, Bass, Others ... Two quality modes: High Speed (single pass) vs. High Quality (multiple passes per stem) ... Runs locally on CPU; GPU acceleration on macOS

### 34. [—]

Live 12's browser integrates the Splice cloud sample library directly (transport-synced previews, 'Search with Sound', key filtering, ~2,500 free samples on a free account), plus a redesigned tag/filter system with user tags and custom icons — indicating browser/library/preset management in a modern DAW extends to cloud content integration, not just local file browsing.

> Industry sample library integrated directly in browser ... "Search with Sound" widget finds complementary samples by style/rhythm ... Free account includes "around 2,500 free samples"

### 35. [—]

Live 12's Max for Live extensibility API is being actively deepened, with Live Object Model additions for programmatic device insertion at an index, rack chain insertion, drum-chain note mapping, sample replacement by absolute file path, and take-lane creation — an existing precedent for the programmatic/agent-driven project manipulation the BeatLab spec targets.

> Track.insert_device and Chain.insert_device: insert devices at optional index ... SimplerDevice.replace_sample: replaces loaded sample via absolute file path ... create_audio_clip and create_midi_clip functions support Take Lanes

### 36. [—]

The Web Audio API's AudioWorklet mandates a fixed 128-sample render quantum with no developer-adjustable buffer size, which the author (developer of the GoldWave audio editor's web app) reports causes audible distortion/glitching across mobile devices and browsers — a direct constraint on the reliability ceiling of browser-based DAW audio engines.

> The mandated low 128 sample latency is causing massive distortion across all mobile devices and browsers

### 37. [—]

As of April 2025, the author reports that clean audio recording via AudioWorklet is impossible in Chrome on Android for their production app.

> It is now impossible for my app to get any clean recordings using Chrome on Android

### 38. [—]

On iOS, AudioWorklet playback exhibits crackling during ordinary user interaction (e.g., screen rotation), and on Firefox on Android any recording degrades both playback and recording into crackling — evidence that real-time-safe audio in the browser is not dependable on mobile platforms.

> iOS now has crackle during user interaction when audio plays (just rotating the screen causes distorted audio)

### 39. [—]

The author asserts the deprecated ScriptProcessorNode (which allowed larger, adjustable buffer sizes) did not exhibit these glitching problems in real-world use, implying the fixed low-latency quantum rather than JS audio processing per se is the failure mode.

> None of these problems occurred when using ScriptProcessorNode. Despite all the theoretical rhetoric about it being inadequate in the real world, ScriptProcessorNode worked!

### 40. [—]

The author's proposed remedy is that browsers should never default to a 128-sample quantum unless explicitly requested, i.e., developers need a latency/buffer-size hint mechanism (relevant to the renderSizeHint addition in Web Audio API 1.1) for a pro DAW to trade latency for glitch-free playback.

> Under no circumstances should 128 samples be used unless explicitly requested by the developer

### 41. [SINGLE-SOURCE (not triangulated)]

Emscripten provides a Wasm Audio Worklets API that lets C/C++ code compiled to WebAssembly run as AudioWorklet processing nodes directly on the browser's real-time audio rendering thread, meaning WASM DSP (e.g. ported Rust/C++ libraries) can execute in the audio callback path of a web DAW rather than only in JavaScript.

> Wasm Audio Worklets enables developers to implement AudioWorklet processing nodes in C/C++ code that compile down to WebAssembly, rather than using JavaScript for the task.

### 42. [SINGLE-SOURCE (not triangulated)]

The Emscripten Wasm Audio Worklets runtime is engineered so its glue code generates no JavaScript garbage, eliminating GC pauses as a source of audio glitches in the worklet thread — a key real-time-safety property for a professional-depth web DAW engine.

> the Emscripten Wasm Audio Worklets system runtime has been carefully developed to guarantee that no temporary JavaScript level VM garbage will be generated, eliminating the possibility of GC pauses from impacting audio synthesis performance.

### 43. [—]

Wasm Audio Worklets are built on Emscripten's Wasm Workers mechanism rather than pthreads: even if -pthread is enabled, the audio worklet always runs as a Wasm Worker, which constrains how multicore/threaded WASM audio engines integrate with the audio thread.

> Audio Worklets API is based on the Wasm Workers feature. It is possible to also enable the -pthread option while targeting Audio Worklets, but the audio worklets will always run in a Wasm Worker, and not in a Pthread.

### 44. [—]

Code running in the Wasm audio worklet callback must be non-blocking and return quickly — busy-wait loops are impossible — so a web DAW's WASM engine cannot use blocking synchronization or long-running work on the audio thread.

> the audio callback code should execute as quickly as possible and be non-blocking. In other words, spinning a custom for(;;) loop is not possible.

### 45. [—]

Cross-thread communication between the WASM audio worklet and the rest of the application is limited to a small set of patterns, including Web Audio AudioParams and Emscripten's post_function event-passing helpers, which shapes how a web DAW must marshal parameter changes and transport state to the DSP thread.

> To synchronize information between an Audio Worklet Node and other threads in the application, there are three options

### 46. [SINGLE-SOURCE (not triangulated)]

Web Audio Modules 2.0 (WAM2) is an open-source (MIT-licensed) plugin standard for browser-based audio plugins (instruments, realtime effects, MIDI processors) that lets DSP written in C, C++, FAUST, or Csound be compiled to WebAssembly and hosted in web DAWs — directly supporting the feasibility of a web-DAW plugin ecosystem without native VST/AU hosting.

> A group of academic researchers and developers from the computer music industry have joined forces for over a year to propose a new version of Web Audio Modules, an open source framework facilitating the development of high-performance Web Audio plugins (instruments, realtime audio effects and MIDI processors). ... it is now possible to compile them in WebAssembly, which means they can be integrated with the Web platform. Our work aims to create a continuum between native and browser based audio app development

### 47. [SINGLE-SOURCE (not triangulated)]

In the browser, AudioWorklet is the sole mechanism for running custom code on the high-priority realtime audio thread, making it the mandatory foundation for any professional-grade web DAW engine; realtime audio is a hard-realtime task with millisecond-scale deadlines where overruns cause audible glitches.

> Realtime audio processing is an example of a "hard realtime" task, meaning all computations must complete within a more or less fixed, finite amount of time ... usually on the order of several milliseconds. If the processing cannot finish in the allotted time, audible glitches will corrupt the output. ... At present, AudioWorklet is the only entrypoint for developers to access the high priority audio thread that runs the Web Audio API's processing graph, and thus it is a central component of our proposed plugin architecture.

### 48. [SINGLE-SOURCE (not triangulated)]

WAM2 provides sample-accurate scheduling of automation, MIDI, OSC, and transport events via a unified API mirrored on main and audio threads, but hosts running only on the main thread must schedule with lookahead to cross the thread barrier, whereas hosts with audio-thread presence can schedule events within the current rendering block — a key architectural constraint for a web DAW's automation/sequencing engine.

> Sample-accurate event scheduling is a critical requirement for professional audio applications. ... Hosts operating entirely on the main thread will still be required to schedule events with some lookahead to ensure that they are processed at the intended time, as these messages must still cross the thread barrier. However, hosts with a presence on the audio thread can schedule events at the beginning of the rendering block in which the events should occur.

### 49. [SINGLE-SOURCE (not triangulated)]

WAM2 deliberately bypasses Web Audio's AudioParam automation API (designed before audio-thread access existed and requiring asynchronous main-thread scheduling) in favor of its own WamParameter API, because exposing potentially hundreds of WASM-resident parameters as AudioParams is too heavy and incompatible with synchronous native-plugin-style host/plugin interaction on the audio thread.

> in many cases it would be too heavy and cumbersome to expose the potentially hundreds of parameters residing in WebAssembly code via that API. Furthermore, the parts of the Web Audio API having to do with AudioParams were conceived before developers had any direct access to the audio thread, forcing parameter updates to be scheduled asynchronously from the main thread ... This aspect of the Web Audio API is not compatible with our goal to support synchronous, "just in time" interaction between hosts and plugins on the audio thread as in native plugin environments.

### 50. [—]

As of April 2022, WAM2 had real-world adoption evidence for the web stack: the commercial web DAW Amped Studio supported WAMs natively with fully audio-thread communication, dozens of community-developed WAMs existed (e.g. sequencer.party's open-source collection), and the standard was characterized as a stable beta providing most best features of native plugin standards.

> The developer's version of AmpedStudio.com supports WAMs natively ... Communication with WAM plugins can be done entirely in the audio thread as the Amped Studio DAW uses AudioWorklet. ... the open source WAM 2.0 standard is still considered a "beta version", but in a stable state. The framework provides most of the best features found in native plugin standards, adapted to the Web. ... there are also dozens of WAMs developed by the community

### 51. [SINGLE-SOURCE (not triangulated)]

As of April 2020, browsers made divergent implicit threading choices for Web Audio: Chrome allocated one real-time thread per AudioContext (more parallelism, added latency at graph boundaries), while Firefox multiplexed all AudioContexts onto a single real-time thread (zero inter-graph latency, less parallelism) — meaning a web DAW cannot rely on a standardized multicore audio-thread model.

> Adenot contrasts Chrome's approach (one thread per AudioContext, better parallelism but increased latency at graph boundaries) with Firefox's model (multiplexing graphs on a single real-time thread, zero latency between graphs but less parallelism).

### 52. [SINGLE-SOURCE (not triangulated)]

Paul Adenot (Mozilla, Web Audio API spec editor) states that the viable path to multicore audio DSP on the web is not parallel processing of a single graph but multiple communicating audio graphs exchanging data via wait-free ring buffers over SharedArrayBuffer.

> Rather than parallel graph processing, he envisions "multi-threaded audio processing using multiple communicating graphs" ... Developers need "code to communicate between different threads using the usual wait-free ring-buffers"

### 53. [SINGLE-SOURCE (not triangulated)]

The added buffering cost of a multi-threaded (multi-graph) web audio architecture is bounded: with Firefox's default 128-frame buffers on macOS, doubling or tripling the buffer for resilience keeps latency well under 10 ms, per Adenot.

> citing Firefox's default 128-frame buffers on macOS and noting that even "doubling or tripling this to get a resilient system should be well under 10ms latency."

### 54. [—]

As of April 2020, SharedArrayBuffer re-enablement (post-Spectre) was imminent and the Web Audio API specification already accounted for it, making SAB-based audio threading a spec-supported foundation rather than a hack.

> **SharedArrayBuffer re-enablement:** He states this is "coming soon" and that "the Web Audio API specification already handles this."

### 55. [—]

Adenot frames multi-threaded real-time low-latency audio as an unsolved problem even outside the browser, because multi-threading introduces non-determinism and priority-inversion hazards on general-purpose OSes — a caution applicable to any DAW engine design, web or native.

> "Rare are the general purpose audio processing systems running on 'normal' OSes that have solved it." He emphasizes the inherent conflict: "multi-threading implies non-determinism, if the threads have different scheduling classes you have priority inversions."

### 56. [—]

OpenDAW is built by the same developer who created Audiotool, a browser DAW that has existed for roughly 15 years — meaning OpenDAW inherits over a decade of prior web-DAW engineering experience.

> "the developer of audiotool literally is the creator of openDAW" (Polarity), following akx's note "We've had https://www.audiotool.com/ for 15 years..."

### 57. [—]

OpenDAW's own roadmap concedes the browser cannot host native plugins: VST support is deferred to a future offline native app, and the team plans a native wrapper such as Tauri.

> "Yes, the offline native app will have VST support at some point in future." (opendaw.org FAQ, cited by rock_artist); "They do plan to have a 'native wrapper like tauri' in the future." (jampekka)

### 58. [—]

Web Audio Modules (webaudiomodules.com) exists as a plugin standard for browser audio/MIDI and is characterized by commenters as relatively mature, offering a browser-native alternative to VST/CLAP hosting.

> "Have you seen web audio modules? https://webaudiomodules.com It is an audio/video/midi plugin standard for the web and it is rather mature." (Gravitronic)

### 59. [—]

As of February 2025, OpenDAW was pre-MVP, with a stated goal of releasing a public standalone version 1 by end of 2025 and building contribution/documentation infrastructure for open source.

> "Our current focus is to lay the foundation for an MVP and release a public standalone version 1 by the end of the year." (opendaw.org, cited by rock_artist)

### 60. [—]

Commenters dispute that browser latency is a hard ceiling for web DAWs: low latency is argued to matter mainly for live monitoring/performance, and BandLab's real-world capability exceeded skeptics' expectations.

> "Minimal latency is only really needed for live performance and monitoring, though these do tend to be crucial demands in most cases." (jampekka); "I was convinced that the web was a deadend for even middling complexity audio projects when I saw Bandlab at NAMM, and I was very wrong." (duped)

### 61. [SINGLE-SOURCE (not triangulated)]

openDAW is an actively developed open-source web-based DAW (TypeScript ~76%, Rust ~21%) with roughly 1.9k GitHub stars and ~3,489 commits, positioning it as the most serious open-source web-DAW prior art for the BeatLab evolution.

> openDAW is a next-generation web-based Digital Audio Workstation (DAW) designed to democratize music production

### 62. [SINGLE-SOURCE (not triangulated)]

openDAW currently runs its audio engine without a WASM DSP core: a WASM audio engine is only a roadmap item targeted for 2026/Q2, meaning a functioning multi-track web DAW with 27 stock devices has shipped on TypeScript/AudioWorklet-style processing alone.

> No WASM audio engine yet — listed as 2026/Q2 roadmap item

### 63. [SINGLE-SOURCE (not triangulated)]

openDAW ships a headless SDK (openDAW-headless on npm) alongside the web studio, demonstrating engine/document separation and programmatic/headless access to a web DAW engine — directly relevant to BeatLab's CLI/headless and AI-agent integration goals.

> The project offers "openDAW-headless (SDK)" as a separate repository for developers building on the platform.

### 64. [SINGLE-SOURCE (not triangulated)]

Professional-depth audio-editing features are still unimplemented in openDAW and scheduled on its roadmap: audio-region fades in 2026/Q1, tempo/time-signature automation tracks in 2026/Q1-Q2, pitch/stretch playback algorithms in 2026/Q4, and a 1.0 launch in 2026/Q3 — evidence of where the web-DAW feasibility ceiling currently sits for warping/time-stretch and tempo-map features.

> Upcoming milestones include implementing WASM audio processing, adding fade controls to audio regions, enabling tempo and signature automation, and launching version 1.0 in Q3 2026.

### 65. [—]

openDAW plans native/offline distribution via a Tauri desktop app and a PWA with offline support, and is dual-licensed AGPL v3 plus commercial — a licensing and packaging path relevant to BeatLab's Tauri fallback architecture.

> The software operates under a dual-licensing model: "AGPL v3 (or later)" for open-source use, or a commercial license for closed-source implementations.

### 66. [—]

Wavacity demonstrates that a full desktop audio editor (Audacity) can be ported to run in the browser via WebAssembly, including compiling the wxWidgets GUI toolkit itself to WASM using a custom fork (github.com/ahilss/wxWidgets-wasm), rather than rewriting the UI in web technologies.

> "It uses wxwidgets so they can just compile that to webassembly too" (thomond); the author (ahilss) confirmed the approach by linking the custom fork "https://github.com/ahilss/wxWidgets-wasm".

### 67. [—]

Multiple users reported real audio-pipeline problems with the WASM port at release: degraded microphone recording quality relative to plain Web Audio recording, and the page becoming unresponsive during export — evidence that browser-based audio editors hit walls on recording fidelity and long-running processing.

> "The sound quality when recording is however very bad for me, compared to just plain web mic recording" (z3t4); "recorded my thing and tried to export it and the page went unresponsive" (swyx); "Mic Recording on the Web still a little rough. Could just be my machine, M1 MBP" (wasm123).

### 68. [—]

The compiled web build is compact — approximately a 5.2 MB .wasm file plus a 2.3 MB .data file — reportedly smaller than native Audacity release artifacts, indicating WASM binary size is not a blocking constraint for porting a DAW-adjacent app to the web.

> The application loads "a 5.2MB .wasm file and 2.3MB .data file" (mrtksn); "Also impressive is that is smaller than every other release artifact" (lathiat).

### 69. [—]

Wavacity had already existed for about a year before this September 2023 announcement (originally named 'wavvy', renamed over a trademark conflict), so the project represents a sustained rather than one-off web-porting effort.

> "I released this a year ago under the name 'wavvy' but needed to rename the project because of a trademark conflict" (ahilss, the author).

### 70. [—]

The thread contains no substantive discussion by the author of plugin (VST/LADSPA/Nyquist) support, AudioWorklet/SharedArrayBuffer threading, or round-trip latency, so this source cannot support claims about the plugin-hosting or latency ceiling of the web stack.

> Review of the thread found no direct comments from ahilss addressing plugin support, threading/SharedArrayBuffer, AudioWorklet details, project saving, or file system access limitations.

### 71. [SINGLE-SOURCE (not triangulated)]

A working multitrack web DAW (recording, mixing, producing, playing) was built entirely on standardized W3C browser APIs — Web Audio, WebAssembly, Web Components, Web MIDI, and Media Devices — demonstrating that the browser stack suffices for a functional (though demonstrator-grade) DAW as of 2023.

> This paper presents WAM Studio, an open source, online Digital Audio Workstation (DAW) that takes advantages of several W3C Web APIs, such as Web Audio, Web Assembly, Web Components, Web Midi, Media Devices etc.

### 72. [SINGLE-SOURCE (not triangulated)]

Interoperable audio plugin hosting in the browser (effects, virtual instruments, and controllers loadable into a host DAW) is achieved via the Web Audio Modules (WAM) standard, i.e. a browser-native plugin-host architecture analogous to VST hosting exists and is used by WAM-studio.

> It also uses the Web Audio Modules proposal that has been designed to facilitate the development of inter-operable audio plugins (effects, virtual instruments, virtual piano keyboards as controllers etc.) and host applications.

### 73. [SINGLE-SOURCE (not triangulated)]

The browser's sandboxed execution environment and latency compensation were the principal engineering difficulties the authors hit when building a DAW on the web stack — first-party evidence that these are the binding constraints (the feasibility ceiling) rather than raw DSP capability.

> The paper highlights some of the difficulties we encountered (i.e limitations due to the sandboxed and constrained environments that are Web browsers, latency compensation etc.).

### 74. [—]

As of April 2023, very few commercial online DAWs existed, and the existing open-source web DAWs lacked interoperable plugin support and did not use AudioWorklet/WebAssembly — a falsifiable landscape assessment of prior web-DAW efforts (e.g. GridSound-era projects).

> Very few commercial online DAWs exist today and the only open-source examples lack features (no support for inter-operable plugins, for example) and do not take advantage of the recent possibilities offered by modern W3C APIs (e.g. Au-dioWorklets/Web Assembly).

### 75. [—]

WAM-studio is explicitly a technology demonstrator rather than a production DAW, with a public online demo and open-source code on GitHub (verified: github.com/Brotherta/wam-studio exists, JavaScript, 43 stars, still receiving updates in 2026) — it is directly studyable as a reference architecture for a Tone.js/React DAW evolution.

> WAM Studio was developed as an open-source technology demonstrator with the aim of showcasing the potential of the web platform, made possible by these APIs. ... An online demo, as well as a GitHub repository for the source code are available.

### 76. [—]

Tracktion Engine 2.0 restructured the framework into three separated modules — tracktion::core (time/beat primitive types), tracktion::graph (low-level audio processing graph), and tracktion::engine (the high-level Edit/application framework) — establishing an explicit engine/document separation where a standalone processing-graph library powers playback beneath the edit model.

> tracktion::graph: "Contains the low level audio processing library which powers playback inside tracktion::engine." ... tracktion::engine: "Contains the bulk of the framework and the higher level classes required to build an application quickly."

### 77. [—]

As of Engine 2.0, audio clips can decode compressed formats and pitch/time-stretch in real time inside the audio callback instead of pre-rendering WAV proxy files, enabled via setUsesProxy(false) — i.e., the engine supports real-time (non-offline) time-stretch playback.

> Audio clips no longer have to generate WAV proxies to be played back from compressed formats or to pitch/time-stretch. They can do this during the audio callback.

### 78. [—]

Tracktion Engine's real-time stretching offers selectable resampling quality modes backed by libsamplerate: lagrange (the legacy default) plus sincFast, sincMedium and sincBest.

> the available quality modes are "lagrange (the old and now default mode), sincFast, sincMedium and sincBest."

### 79. [—]

Engine 2.0 introduced strongly typed time vs. beat position/duration primitives (with literals _tp, _td, _bp, _bd and std::chrono-style syntax), and converting between time and beat domains requires a TempoSequence — a schema-design lesson for representing tempo-dependent positions in a DAW document format.

> There are literals that can be used to construct these. `_tp, _td, _bp, _bd` ... Converting between formats requires a `TempoSequence`.

### 80. [—]

Engine 2.0 added a MIDI playback mode that loops MIDI sequences during playback specifically to reduce audio-graph construction cost for long sequences, indicating graph (re)build time is a recognized performance concern in this architecture.

> A new mode generates "looped MIDI sequences during playback which can speed up graph creation of long sequences."

### 81. [—]

Dave Rowland (Tracktion) gave a talk 'Using JUCE ValueTrees and Modern C++ to Build Large Scale Applications' (ADC 2017), documenting that Tracktion's large-scale app/engine architecture (including Waveform/tracktion_engine) is built on JUCE ValueTrees — a tree-structured, serializable document model with built-in undo support, directly relevant to engine/document separation and undo-system design.

> Using JUCE ValueTrees and Modern C++ to Build Large Scale Applications (ADC 2017)

### 82. [—]

Tracktion Engine is the same audio engine that powers Tracktion's commercial DAW Waveform, and was presented publicly as an embeddable engine at the London Audio Developers Meetup in May 2019 — supporting the research question's premise that tracktion_engine is a production-proven embeddable DAW engine.

> "Tracktion Engine" (London Audio Developers Meetup, May 2019) - "the same engine behind their DAW Waveform"

### 83. [—]

Tracktion Graph, introduced at ADC 2020, is a new open-source library for building and processing complex topological graphs of audio and MIDI sources — i.e., tracktion_engine's processing-graph layer is factored out as a standalone graph library, informing how pro DAW engines structure processing graphs.

> "Introducing Tracktion Graph" (ADC 2020) - describes it as "a new open source library designed to build and process complex topological graphs of audio and MIDI sources"

### 84. [—]

Rowland's ADC 2023 talk 'Why you Shouldn't Write a DAW' catalogs the hidden technical problems DAWs must solve (often transparently to users), providing primary-source evidence of DAW complexity relevant to the 'not a toy' scoping and risk ranking.

> "Why you Shouldn't Write a DAW" (ADC 2023) - examines "problems they solve, often transparently to the user, and some of the technical concepts they have to navigate"

### 85. [—]

The repository contains a sustained body of real-time-safety material from the tracktion_engine author (Real-time 101 at ADC 2019, 'Can Audio Programming be Safe?' at ADC 2024, 'Catching Real-time Safety Violations' at C++ on Sea 2024, 'Lock-free queues in the multiverse of madness' at ADC 2025), spanning 2015-2026 and MIT-licensed, giving primary reference material on real-time safety constraints for a DAW engine.

> 6. Real-time 101 (ADC 2019; also Meeting C++ 2019) ... 15. Can Audio Programming be Safe? (ADC 2024) 16. Catching Real-time Safety Violations (C++ on Sea 2024) ... 18. Lock-free queues in the multiverse of madness (ADC 2025; C++ Online 2026)

### 86. [—]

Ardour 6.0's engine provides sample-accurate latency compensation across every signal pathway, including busses, tracks, plugins, sends, inserts, and returns, regardless of routing topology — demonstrating that full plugin-delay compensation in arbitrary routing graphs is achievable in an open-source DAW engine.

> Ardour 6.0 is now absolutely, fully compensated for latency along any signal pathway. Busses, tracks, plugins, sends, inserts, returns: no matter how you route signals within (and external to) Ardour, everything will be fully compensated and aligned with sample accuracy.

### 87. [—]

Ardour 6.0 moved varispeed handling into a high-quality resampling engine at the core of the audio engine, which simplified the codebase and made MIDI tracks' audio output behave correctly under speed changes — an architectural lesson that centralizing resampling simplifies engine design.

> Ardour 6.0 now contains a high quality resampling engine at its core to deal with varispeed, a design that makes the core of Ardour's code much simpler and ensures that MIDI tracks will have their audio output (if any) handled correctly.

### 88. [—]

Ardour completely rewrote its MIDI playback data handling in 6.0 to eliminate long-standing correctness bugs (stuck notes, looping anomalies, missing notes), indicating that robust MIDI playback under looping/transport changes is a nontrivial engine problem requiring dedicated architecture.

> completely changed the way we handle MIDI data during playback

### 89. [—]

Ardour 6.0 added the ability to record a track's signal from any position within its processing chain ('wet' recording), not only pre-processing, showing that flexible per-chain tap points are part of a professional DAW's routing feature surface.

> Recording capability from any position within a track's signal chain, not just pre-processing stages

### 90. [—]

Ardour 6.0 introduced cue monitoring, allowing simultaneous monitoring of disk playback and live input on a track — a monitoring feature relevant to the audio-recording/comping feature inventory.

> Cue Monitoring: Simultaneous monitoring of disk playback and input signals

### 91. [—]

Tracktion Graph is a new processing module that replaces the internal processing of tracktion_engine, fixes plugin delay compensation (PDC) in complex routing situations, and improved CPU performance by roughly 20% over the previous engine.

> New processing module based on the concepts discussed • Replaces the internal processing of tracktion_engine • Fixes PDC in complex situations • Improved CPU performance (20% faster)

### 92. [—]

tracktion_engine achieves strict engine/document separation: an EditNodeBuilder takes the Edit (the document model) and builds a graph of processing Nodes from it, so the model is completely separated from audio processing — a directly transferable pattern for a text-document DAW with a separate engine.

> Tracktion Engine: • EditNodeBuilder.h/cpp files • Takes an Edit and builds a graph of Nodes to process it • Completely separates model from processing

### 93. [—]

Tracktion Graph is designed so nodes can be processed multi-threaded in a way that scales independently of graph complexity, using a single real-time audio thread plus worker threads consuming a FIFO; a fully real-time-safe implementation must avoid all system calls (locks, condition variables, events), requiring workers to spin on the FIFO, while condition-variable-based sleeping is explicitly not real-time safe.

> Ensure nodes can be processed multi-threaded which scales independently of graph complexity ... Fully real-time implementation means no system calls (locks, CVs, events etc.) • Requires worker threads spinning on the FIFO waiting for available Nodes ... Non-real-time solution can use condition variables to sleep/wake worker threads • NOT REAL-TIME SAFE!

### 94. [—]

When the graph topology changes it must be rebuilt, and glitch-free playback requires persisting latency-node history buffers between old and new graphs, which forces every node to be uniquely identifiable and matched across graph rebuilds — a core continuity requirement for any DAW engine driven by a mutable document.

> If the topology changes, the graph will need to be rebuilt ... In order to avoid these discontinuities, any history buffers will need to be persisted between graphs • This means each node must be uniquely identifiable and the same between graphs

### 95. [—]

The graph processes in arbitrary block sizes (up to the prepared maximum), which reduces aliasing from fast-changing automation and handles looping more accurately, and it supports float or double processing with a full 64-bit pipeline for maximum headroom.

> Processing can happen in any sized block (up to the maximum prepared for) • Enables reduced aliasing due to fast changing automation and handles looping more accurately • Processing in float or double

### 96. [—]

Signalsmith Stretch is a C++11 polyphonic pitch-shift and time-stretch library released under the MIT License, making it license-compatible with an open-source DAW.

> Written in C++11 and "Released under the MIT License."

### 97. [—]

An official Web Audio version of signalsmith-stretch is available in WASM/AudioWorklet format on NPM, meaning browser-based time-stretch/warping can use this library without a custom port.

> Web Audio version in WASM/AudioWorklet format available on NPM

### 98. [—]

The library handles wide-range pitch shifts (multiple octaves), but time-stretching quality is best for modest ratios between 0.75x and 1.5x, which bounds achievable warp quality relative to commercial DAW warp engines.

> handles "a wide-range of pitch-shifts (multiple octaves)" though "time-stretching sounds best for more modest changes (between 0.75x and 1.5x)"

### 99. [—]

The library reports its latency split into input and output components, enabling a host DAW to implement plugin-delay/latency compensation and automation alignment around it.

> The library reports latency in two components: "inputLatency" and "outputLatency" for automation alignment.

### 100. [—]

Signalsmith Stretch supports a chunked-computation mode to spread computation evenly, and also ships Python (PyPI) and Rust (crates.io) bindings, supporting real-time audio-thread use and a Rust-engine backend path.

> Supports "chunked-computation mode" to spread computation evenly. ... Python binding published on PyPI; Rust wrapper available on crates.io

### 101. [—]

DAWproject is an open, MIT-licensed exchange format (not a native DAW format) created by Bitwig whose goal is to transfer all translatable project data — audio, notes, automation, and plug-in data plus surrounding structure — between DAWs in a single file; this makes it a proven reference schema for what a portable DAW project document must represent, directly relevant to designing BeatLab's text-based project format.

> Open exchange format for user data between Digital Audio Workstations (DAWs) ... export all translatable project data (audio/note/automation/plug-in) along with the structure surrounding it into a single DAWproject file.

### 102. [—]

The DAWproject container is a ZIP archive holding UTF-8 XML documents (project.xml and metadata.xml) with the .dawproject extension — i.e., the interchange payload itself is structured text, supporting the feasibility of a human-readable, diffable text representation of full DAW project state (though the ZIP wrapper itself is not directly git-diffable).

> Container: ZIP ... Format: XML (project.xml, metadata.xml)

### 103. [—]

DAWproject 1.0 covers a deep professional feature surface in XML: audio clips with fades/crossfades/amplitude/pan and time warping, note data with note expressions, clip-launcher clips and scenes, built-in devices (EQ, Compressor, Gate, Limiter), full plug-in state, and automation of tempo, time signature, MIDI messages, volume, pan, mute, sends, and plug-in parameters — demonstrating that this feature depth is representable in a declarative text schema.

> Stores full plug-in state and automation of parameters ... Automation: Tempo, Time Signature, MIDI Messages, Volume, Pan, Mute, Sends, Plug-in Parameters

### 104. [—]

The format is declared stable at version 1.0 and is implemented by at least six commercial DAWs — Bitwig Studio 5.0.9, PreSonus Studio One 6.5, Steinberg Cubase 14, Steinberg Cubasis 3.7.1, Steinberg VST Live 2.2, and n-Track Studio 10.2.2 — making it a viable import/export interoperability target for a new open-source DAW.

> The format is version 1.0 and is stable.

### 105. [—]

DAWproject explicitly excludes from scope being a DAW's native file format, optimal performance, storing low-level MIDI events directly, and storing non-session data such as view settings and preferences; its canonical schema is generated from annotated Java classes — schema-design lessons (semantic events over raw MIDI, session data only, single-source-of-truth schema generation) that transfer to BeatLab's format design.

> The DOM of DAWproject is defined by a set of Java classes which have XML-related annotations and HTML-induced Javadoc comments.

### 106. [—]

libebur128 is an MIT-licensed, portable ANSI C library implementing the EBU R 128 loudness standard, making it a legally and technically suitable open-source building block for LUFS metering in a DAW.

> A library that implements the EBU R 128 standard for loudness normalisation. ... All source code is licensed under the MIT license. ... Portable ANSI C code

### 107. [—]

libebur128 covers the full loudness-metering feature set needed for LUFS-normalized export and mixer metering: momentary (M), short-term (S), and integrated (I) loudness modes plus loudness range per EBU TECH 3342 and true-peak scanning.

> Implements M, S and I modes ... Implements loudness range measurement (EBU - TECH 3342)

### 108. [—]

libebur128 supports arbitrary sample rates by recalculating its filter coefficients, so it can operate at any DAW engine sample rate without external resampling for the K-weighting filters.

> Supports all samplerates by recalculation of the filter coefficients

### 109. [—]

Since v1.2.0 libebur128 has real-time monitoring functions (window-based loudness queries) and a dependency-free FIR resampler for true peak (the Speex dependency was removed), meaning the library is self-contained C with no external dependencies — a property that makes compiling it to WASM via Emscripten straightforward.

> New FIR resampler for true peak calculation. This removes the Speex dependency.

### 110. [—]

libebur128 incorporates channel definitions from ITU-R BS.1770-4 (added in v1.1.0), aligning its measurements with the ITU standard underlying streaming-platform loudness targets; its latest release is v1.2.6 (February 2021), indicating a mature but slowly updated codebase.

> Channel definitions from ITU R-REC-BS 1770-4

### 111. [—]

A WebAssembly build of the Rubber Band time-stretching/pitch-shifting library exists and is published on npm as 'rubberband-wasm' (latest version 3.3.0, published 2024-12-23), confirming that Rubber Band-quality time-stretch DSP is available to a browser/Electron/Tauri web DAW stack.

> WebAssembly build of the audio time-stretching and pitch-shifting Rubber Band Library.

### 112. [—]

rubberband-wasm is licensed GPLv2 (inheriting Rubber Band's GPL), so using it forces GPL-compatible licensing on an open-source DAW, and any commercial/non-GPL distribution requires purchasing a separate commercial license from the Rubber Band maintainers (Breakfast Quay).

> Rubber Band Library is open source software under the GNU General Public License.

### 113. [—]

The package version 3.3.0 indicates it wraps the Rubber Band 3.x line (the 'R3' higher-quality engine generation), per the npm registry description and package.json ('version': '3.3.0', 'license': 'GPLv2').

> WebAssembly version of the Rubber Band Library (high quality software library for audio time-stretching and pitch-shifting)

### 114. [—]

The project is a small third-party effort with modest adoption (49 GitHub stars, 8 forks, only two npm releases since 2022) and its README documents no real-time/streaming or AudioWorklet integration details, so a professional DAW would likely need to build and maintain its own Rubber Band WASM wrapper rather than rely on this package as-is.

> The project has 49 stars and 8 forks

### 115. [—]

A working browser demo of Rubber Band running in WASM is publicly hosted at https://daninet.github.io/rubberband-wasm/, providing an existence proof that the library compiles and runs in-browser.

> A demo application is available at https://daninet.github.io/rubberband-wasm/


---

## Research process log

```
Q: Produce a technical specification and feature inventory for building a professio…
Decomposed into 5 angles: Feature inventory / reference DAWs, Web-stack feasibility ceiling, Prior art: serious web DAWs, Open-source engine architecture, Project format + WASM DSP building blocks
Feature inventory / reference DAWs: 6 results
Web-stack feasibility ceiling: 6 results
Prior art: serious web DAWs: 6 results
Prior art: serious web DAWs: 3 novel (3 filtered)
Open-source engine architecture: 6 results
Open-source engine architecture: 4 novel (2 filtered)
Project format + WASM DSP building blocks: 6 results
Project format + WASM DSP building blocks: 4 novel (2 filtered)
Fetched 23 sources → 115 claims → verifying top 25
[v1:Ableton Live 12 includes built-in MIDI T] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Ableton Live 12 includes built-in MIDI T] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:Live 12 supports MPE across editing and] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Live 12 supports MPE across editing and] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Live 12 supports MPE across editing and] failed: You've hit your session limit · resets 7:10am (UTC)
"Live 12 supports MPE across editing and instrument…": 0-0 (3 errored) ?
[v0:Live 12's browser/library system include] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Live 12's browser/library system include] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Live 12's browser/library system include] failed: You've hit your session limit · resets 7:10am (UTC)
"Live 12's browser/library system includes automati…": 0-0 (3 errored) ?
[v0:Live 12 changed its modulation architect] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Live 12 changed its modulation architect] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Live 12 changed its modulation architect] failed: You've hit your session limit · resets 7:10am (UTC)
"Live 12 changed its modulation architecture so mod…": 0-0 (3 errored) ?
[v0:Ableton Live 12 on Windows exposes a deb] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Ableton Live 12 on Windows exposes a deb] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Ableton Live 12 on Windows exposes a deb] failed: You've hit your session limit · resets 7:10am (UTC)
"Ableton Live 12 on Windows exposes a debug option …": 0-0 (3 errored) ?
[v0:Ableton Live 12 includes built-in MIDI T] failed: You've hit your session limit · resets 7:10am (UTC)
"Ableton Live 12 includes built-in MIDI Transformat…": 0-0 (3 errored) ?
[v0:Live 12.3 added dedicated bounce command] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Live 12.3 added dedicated bounce command] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Live 12.3 added dedicated bounce command] failed: You've hit your session limit · resets 7:10am (UTC)
"Live 12.3 added dedicated bounce commands — Bounce…": 0-0 (3 errored) ?
[v1:As of late 2021, browser-based DAWs (per] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:As of late 2021, browser-based DAWs (per] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:As of late 2021, browser-based DAWs (per] failed: You've hit your session limit · resets 7:10am (UTC)
"As of late 2021, browser-based DAWs (per Soundtrap…": 0-0 (3 errored) ?
[v0:To compete with native DAWs, a browser D] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:To compete with native DAWs, a browser D] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:To compete with native DAWs, a browser D] failed: You've hit your session limit · resets 7:10am (UTC)
"To compete with native DAWs, a browser DAW would n…": 0-0 (3 errored) ?
[v0:Accurate recording-latency compensation] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Accurate recording-latency compensation] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Accurate recording-latency compensation] failed: You've hit your session limit · resets 7:10am (UTC)
"Accurate recording-latency compensation (aligning …": 0-0 (3 errored) ?
[v0:Web Audio Modules 2.0 (WAM2) is an open-] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Web Audio Modules 2.0 (WAM2) is an open-] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Web Audio Modules 2.0 (WAM2) is an open-] failed: You've hit your session limit · resets 7:10am (UTC)
"Web Audio Modules 2.0 (WAM2) is an open-source (MI…": 0-0 (3 errored) ?
[v0:In the browser, AudioWorklet is the sole] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:In the browser, AudioWorklet is the sole] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:In the browser, AudioWorklet is the sole] failed: You've hit your session limit · resets 7:10am (UTC)
"In the browser, AudioWorklet is the sole mechanism…": 0-0 (3 errored) ?
[v0:WAM2 provides sample-accurate scheduling] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:WAM2 provides sample-accurate scheduling] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:WAM2 provides sample-accurate scheduling] failed: You've hit your session limit · resets 7:10am (UTC)
"WAM2 provides sample-accurate scheduling of automa…": 0-0 (3 errored) ?
[v0:WAM2 deliberately bypasses Web Audio's A] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:WAM2 deliberately bypasses Web Audio's A] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:WAM2 deliberately bypasses Web Audio's A] failed: You've hit your session limit · resets 7:10am (UTC)
"WAM2 deliberately bypasses Web Audio's AudioParam …": 0-0 (3 errored) ?
[v0:Emscripten provides a Wasm Audio Worklet] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Emscripten provides a Wasm Audio Worklet] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Emscripten provides a Wasm Audio Worklet] failed: You've hit your session limit · resets 7:10am (UTC)
"Emscripten provides a Wasm Audio Worklets API that…": 0-0 (3 errored) ?
[v0:The Emscripten Wasm Audio Worklets runti] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:The Emscripten Wasm Audio Worklets runti] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:The Emscripten Wasm Audio Worklets runti] failed: You've hit your session limit · resets 7:10am (UTC)
"The Emscripten Wasm Audio Worklets runtime is engi…": 0-0 (3 errored) ?
[v0:As of April 2020, browsers made divergen] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:As of April 2020, browsers made divergen] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:As of April 2020, browsers made divergen] failed: You've hit your session limit · resets 7:10am (UTC)
"As of April 2020, browsers made divergent implicit…": 0-0 (3 errored) ?
[v0:Paul Adenot (Mozilla, Web Audio API spec] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Paul Adenot (Mozilla, Web Audio API spec] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Paul Adenot (Mozilla, Web Audio API spec] failed: You've hit your session limit · resets 7:10am (UTC)
"Paul Adenot (Mozilla, Web Audio API spec editor) s…": 0-0 (3 errored) ?
[v0:The added buffering cost of a multi-thre] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:The added buffering cost of a multi-thre] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:The added buffering cost of a multi-thre] failed: You've hit your session limit · resets 7:10am (UTC)
"The added buffering cost of a multi-threaded (mult…": 0-0 (3 errored) ?
[v0:A working multitrack web DAW (recording,] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:A working multitrack web DAW (recording,] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:A working multitrack web DAW (recording,] failed: You've hit your session limit · resets 7:10am (UTC)
"A working multitrack web DAW (recording, mixing, p…": 0-0 (3 errored) ?
[v0:Interoperable audio plugin hosting in th] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Interoperable audio plugin hosting in th] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Interoperable audio plugin hosting in th] failed: You've hit your session limit · resets 7:10am (UTC)
"Interoperable audio plugin hosting in the browser …": 0-0 (3 errored) ?
[v0:The browser's sandboxed execution enviro] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:The browser's sandboxed execution enviro] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:openDAW is an actively developed open-so] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:The browser's sandboxed execution enviro] failed: You've hit your session limit · resets 7:10am (UTC)
"The browser's sandboxed execution environment and …": 0-0 (3 errored) ?
[v1:openDAW is an actively developed open-so] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:openDAW currently runs its audio engine] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:openDAW is an actively developed open-so] failed: You've hit your session limit · resets 7:10am (UTC)
"openDAW is an actively developed open-source web-b…": 0-0 (3 errored) ?
[v1:openDAW currently runs its audio engine] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:openDAW ships a headless SDK (openDAW-he] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:openDAW currently runs its audio engine] failed: You've hit your session limit · resets 7:10am (UTC)
"openDAW currently runs its audio engine without a …": 0-0 (3 errored) ?
[v1:openDAW ships a headless SDK (openDAW-he] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:openDAW ships a headless SDK (openDAW-he] failed: You've hit your session limit · resets 7:10am (UTC)
"openDAW ships a headless SDK (openDAW-headless on …": 0-0 (3 errored) ?
[v0:Professional-depth audio-editing feature] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Professional-depth audio-editing feature] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Professional-depth audio-editing feature] failed: You've hit your session limit · resets 7:10am (UTC)
"Professional-depth audio-editing features are stil…": 0-0 (3 errored) ?
Verify done: 25 claims → 0 confirmed, 0 refuted, 25 unverified
```