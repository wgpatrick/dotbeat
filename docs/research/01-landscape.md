# Research 01 — Prior Art & the Empty-Quadrant Hypothesis

> Deep-research pass. **113 claims** extracted from **23 sources** across 5 search angles. Verification stage rate-limited mid-run: **5 adversarially verified**, 1 refuted, the rest single-source (quoted but not triangulated).

## Research question

> Survey the current landscape (2024–2026) of programmatic / code-based / text-file-native DAWs and music production systems, to inform the design of a new open-source DAW forked from a Tone.js + React web app (BeatLab). The target product: a GUI DAW (piano roll, knobs, mixer) whose project files are human-readable, git-diffable text documents (document-only, no generator-code layer for v1), with full CLI access (headless render to WAV/stems, inspect/modify project files, musical diff) and agent/MCP integration so AI assistants can edit and render projects. Research questions: (1) What existing systems are closest to this — live-coding environments (Strudel, TidalCycles, Sonic Pi, Glicol, Faust, SuperCollider), tracker DAWs, web DAWs (OpenDAW, GridSound, Signal, wam-studio), "DAW-as-code" or git-friendly music project tools, DAWproject/Ableton .als/MIDI file formats — and what can be learned from each about format design, GUI↔file sync, and CLI/headless rendering? (2) Is there prior art for git-diffable DAW project formats or musical diff tools? (3) What are the proven approaches for headless Web Audio rendering in Node (node-web-audio-api, OfflineAudioContext, headless Chromium) and their Tone.js compatibility? (4) Any existing MCP servers / agent-native music tools? (5) What niche/community demand signals exist (producers who code, AI-assisted production)? Deliver: a cited report with a comparison of prior art, gaps confirming or refuting the "empty quadrant" hypothesis (GUI + text-native files + CLI), format-design recommendations, and concrete build recommendations for the BeatLab fork.

## Sources

- <https://github.com/andremichelle/openDAW> — *primary*, 5 claims
- <https://creativecodingtech.com/music/live-coding/comparison/2024/10/22/sonic-pi-vs-tidalcycles-vs-strudel.html> — *blog*, 3 claims
- <https://www.soniare.net/blog/live-coding-systems-comparison> — *blog*, 5 claims
- <https://news.ycombinator.com/item?id=36967413> — *forum*, 5 claims
- <https://github.com/Tonejs/Tone.js/> — *primary*, 5 claims
- <https://hackaday.com/2025/10/16/live-coding-techno-with-strudel/> — *blog*, 5 claims
- <https://github.com/bitwig/dawproject> — *primary*, 5 claims
- <https://github.com/krfantasy/alsdiff> — *primary*, 5 claims
- <https://github.com/Ableton/maxdevtools/blob/main/maxdiff/README.md> — *primary*, 5 claims
- <https://github.com/danielbayley/Ableton-Live-tools> — *primary*, 5 claims
- <https://github.com/gregchapman-dev/musicdiff> — *primary*, 5 claims
- <https://grechin.org/2023/05/06/git-and-reaper.html> — *blog*, 5 claims
- <https://github.com/ircam-ismm/node-web-audio-api> — *primary*, 5 claims
- <https://github.com/chrisguttandin/standardized-audio-context> — *primary*, 5 claims
- <https://tonejs.github.io/docs/15.0.4/classes/OfflineContext.html> — *primary*, 5 claims
- <https://github.com/ahujasid/ableton-mcp> — *primary*, 5 claims
- <https://github.com/uisato/ableton-mcp-extended> — *primary*, 5 claims
- <https://github.com/williamzujkowski/strudel-mcp-server> — *primary*, 5 claims
- <https://github.com/tubone24/midi-mcp-server> — *primary*, 5 claims
- <https://news.ycombinator.com/item?id=46699441> — *forum*, 5 claims
- <https://news.ycombinator.com/item?id=45092895> — *forum*, 5 claims
- <https://www.kvraudio.com/forum/viewtopic.php?t=429799> — *forum*, 5 claims
- <https://news.ycombinator.com/item?id=47999656> — *forum*, 5 claims

## All extracted claims (with source quotes)

Each claim is tagged with its verification status. `VERIFIED` = survived 2–3 skeptic votes. `SINGLE-SOURCE` = quoted from the page but the verifier vote was rate-limited. `—` = extracted but not queued for verification.

### 1. [VERIFIED (3-0)]

openDAW is an actively developed, open-source, browser-based DAW written primarily in TypeScript (~76%) and Rust (~21%), positioned as a next-generation web DAW focused on accessibility, education, and privacy — making it direct prior art for a GUI web DAW like the proposed BeatLab fork.

> openDAW is a next-generation web-based Digital Audio Workstation (DAW) designed to democratize music production

### 2. [VERIFIED (3-0)]

openDAW already ships a headless mode/SDK: the README documents an 'npm run dev:headless' server mode and links a separate 'openDAW-headless (SDK)' repository (github.com/andremichelle/opendaw-headless), providing proven prior art for headless operation of a web-audio DAW engine.

> The project maintains "[openDAW-headless (SDK)](https://github.com/andremichelle/opendaw-headless)" as a separate repository ... Development includes "npm run dev:studio | npm run dev:headless" commands

### 3. [VERIFIED (3-0)]

openDAW project files are stored as zipped bundle files (using jszip), not as human-readable plain-text documents — so despite being open-source and headless-capable, it does NOT occupy the git-diffable text-native-project-file quadrant, supporting the 'empty quadrant' hypothesis.

> It only mentions that [jszip](https://www.npmjs.com/package/jszip) is used "for openDAW project bundle file" but doesn't specify the underlying format.

### 4. [—]

openDAW is dual-licensed under AGPL v3 (or later) with a paid commercial alternative, which constrains how its code could be reused or forked into another open-source DAW project.

> "openDAW is available under two alternative license terms" — AGPL v3 or Commercial. "AGPL v3 (or later) © 2025 André Michelle"

### 5. [—]

openDAW is pre-1.0 but has substantial traction and momentum: roughly 1.9k GitHub stars, 146 forks, ~3,489 commits, an active Discord community, and a 1.0 launch targeted for Q3 2026 — a demand signal for open web DAWs.

> 1.9k stars, 146 forks, 56 open issues, Discord community ... Version 1.0 launch targeted Q3 2026.

### 6. [—]

Sonic Pi uses Ruby as its programming language, TidalCycles uses Haskell, and Strudel uses JavaScript.

> Sonic Pi uses Ruby; TidalCycles uses Haskell; Strudel uses JavaScript.

### 7. [—]

Strudel is browser-based and runs in a JavaScript/web environment (the article frames it as the option for people 'who accidentally opened the Chrome Developer Console'), implying it targets the browser rather than a desktop runtime.

> Strudel: "For people who accidentally opened the Chrome Developer Console"

### 8. [—]

Sonic Pi is positioned primarily as an education-friendly, beginner-accessible live-coding environment relative to TidalCycles and Strudel.

> Sonic Pi: "For teachers and people who like to sleep at night"

### 9. [—]

Strudel is a browser-based JavaScript port of TidalCycles that requires no installation and is usable immediately at strudel.cc, whereas TidalCycles requires a local install of Haskell plus SuperCollider — relevant prior art on zero-install, web-native live-coding UX for a web DAW project.

> You can jump into live coding immediately at strudel.cc, experiment with patterns, and share your creations.

### 10. [—]

The article claims Strudel uses the Web Audio API and Tone.js for sound generation (note: this is checkable and likely inaccurate — Strudel's engine is its own 'superdough' Web Audio layer, not Tone.js — but if true it would bear directly on BeatLab's Tone.js compatibility question).

> Uses Web Audio API and Tone.js for sound generation

### 11. [—]

TidalCycles is built on Haskell with SuperCollider as the sound engine, was created by Alex McLean (who coined 'algorave'), and represents patterns not as literal note sequences but as functions generating repeating cycles — a text-native pattern-representation design point for format design.

> Patterns aren't just sequences of notes - they're recipes for creating infinitely repeating cycles.

### 12. [—]

ChucK (created by Ge Wang and Perry Cook at Princeton) uses 'strongly-timed' semantics where time advances explicitly under program control, enabling sample-accurate scheduling — a deterministic-timing model relevant to headless/offline rendering design.

> Time in Chuck advances explicitly when you tell it

### 13. [—]

Sonic Pi, created by Sam Aaron at the University of Cambridge, is built on Ruby with SuperCollider synthesis and was designed as a teaching tool that grew into a live performance instrument, with MIDI/OSC support.

> Designed to teach programming through music but quickly grew into a powerful live performance tool.

### 14. [—]

The largest adoption barrier to TidalCycles is its installation friction: users must install a Haskell toolchain, an editor plugin, and SuperCollider before making any sound — a design lesson favoring zero-install (browser/CLI-native) programmatic music tools.

> install a bunch of Haskell stuff + install an editor plugin + install supercollider is the largest blocker

### 15. [—]

TidalCycles is not a self-contained audio system: it depends on SuperCollider as its backend for both MIDI output and sample playback, i.e., it is a pattern/sequencing layer rather than a full DAW with its own rendering engine.

> TidalCycles...depends on supercollider for both Midi and Sample playback

### 16. [—]

Practitioners already combine code-based sequencing with conventional GUI DAWs — routing TidalCycles into Ableton Live over MIDI — demonstrating real demand for hybrid code+GUI production workflows (the quadrant BeatLab targets).

> Tidal Cycles communicating with Ableton through MIDI makes for an extremely fun composition experience

### 17. [—]

Strudel, the JavaScript/browser port of TidalCycles, ran in the browser as of mid-2023 but with uneven Web Audio behavior across browsers (better in Chrome than Safari), relevant to Web Audio engine portability for a Tone.js-based DAW.

> works better with Chrome than Safari

### 18. [—]

There is a long-standing community of producers using code-based tools for mainstream genres (one commenter reports nearly a decade of pop-music production in TidalCycles), and a broader ecosystem of similar systems (Glicol, FoxDot, Orca) — evidence of niche demand for programmatic music production.

> I've been making pop music with Tidal for almost 10 years

### 19. [—]

Strudel is a JavaScript port of TidalCycles, an algorithmic pattern-based music generator that supports live coding, meaning music is defined as editable code rather than a fixed GUI project — direct prior art for a code/text-native music system.

> Strudel is "a JavaScript port of TidalCycles, which is an algorithmic music generator which supports live coding." The platform enables musicians to modify music in real-time as code changes, with "no compilation steps, hardly any debugging and instant results."

### 20. [—]

Strudel runs entirely in the browser as a web application with a built-in synthesizer, demonstrating that a JavaScript/Web Audio stack is sufficient for a working code-driven music production tool.

> Built-in synthesizer: Provides basic sound generation for composition sketches ... Browser-based: Runs as a web application

### 21. [—]

Strudel blends code with GUI-style visualization and controls — highlighted notes/time periods, piano roll and oscilloscope views, and sliders embedded directly in the code — which is a proven pattern for code↔GUI sync relevant to BeatLab's text-file-plus-GUI design.

> the notes and time periods are highlighted, with piano rolls and oscilloscope views adding to the visuals. Users can adjust parameters using "embedded sliders directly in the code."

### 22. [—]

Strudel can drive external audio engines via Open Sound Control (OSC), sending notes to SuperCollider or Sonic Pi, showing an established pattern for decoupling the text/code layer from the rendering engine.

> External integration: Supports Open Sound Control (OSC) to send notes to SuperCollider or Sonic Pi

### 23. [—]

There is an active community of producers who code — the article cites 'algorave' performance events as an established practice and a working artist (Switch Angel) who publishes custom Strudel function libraries — a demand signal for code-native music tools.

> The article references "algorave" events and notes this represents an established performance practice in electronic music communities. ... [Switch Angel], an electronic music artist with YouTube demonstrations, who has created custom function libraries for Strudel.

### 24. [REFUTED (0-3)]

Tone.js positions itself as a browser-targeted Web Audio framework; its README describes browser use only and does not document Node.js support or offline/headless rendering (no mention of Tone.Offline or OfflineAudioContext), meaning headless rendering for the BeatLab fork must come from separate tooling (e.g., node-web-audio-api or headless Chromium) rather than from Tone.js's documented surface.

> Tone.js is a Web Audio framework for creating interactive music in the browser

### 25. [VERIFIED (3-0)]

Tone.js provides a DAW-like scheduling model: a global Transport timekeeper that, unlike the raw AudioContext clock, can be started, stopped, looped and adjusted on the fly, with the docs explicitly analogizing it to a DAW arrangement view — a natural mapping target for a text-native project format's timeline/clip data.

> Tone.getTransport() returns the main timekeeper. Unlike the AudioContext clock, it can be started, stopped, looped and adjusted on the fly. You can think of it like the arrangement view in a Digital Audio Workstation.

### 26. [—]

Tone.js has no native MIDI file support and no built-in project serialization; MIDI must first be converted to a JSON representation via the companion @tonejs/midi library, implying any human-readable BeatLab project format would need its own note/event schema layered on top of Tone.js API calls.

> To use MIDI files, you'll first need to convert them into a JSON format which Tone.js can understand using Midi.

### 27. [—]

Tone.js ships a substantial built-in instrument and effect library (FM/AM/noise synths, polyphonic voice allocation via Tone.PolySynth, effects like Distortion/Filter/FeedbackDelay), which constrains and enables what device/parameter vocabulary a BeatLab text format can reference out of the box.

> There are numerous synths to choose from including Tone.FMSynth, Tone.AMSynth and Tone.NoiseSynth.

### 28. [—]

Tone.js is an actively maintained, MIT-licensed TypeScript project with roughly 14.7k GitHub stars (GitHub API: 14,671 stars, repo updated 2026-07-09; latest npm release 15.1.22), making it a viable long-term dependency for an open-source DAW fork. Note: the fetched README snapshot's '14.7.39 (July 2020)' release figure is stale — the npm registry shows v15.1.22 as current.

> MIT license ... 14.7k stars ... TypeScript 99.1%

### 29. [SINGLE-SOURCE (not triangulated)]

alsdiff is an existing open-source tool (written mainly in OCaml) that performs semantic diffs of Ableton Live Set (.als) files by decompressing the gzip-compressed XML and comparing the parsed structure, directly demonstrating prior art for musical diff of DAW project files.

> The tool decompresses .als files (which are "gzip-compressed XML") and parses the XML to perform semantic diffing... "standard git diff treats them as binary blobs, using version control to track changes in music projects is nearly impossible."

### 30. [SINGLE-SOURCE (not triangulated)]

alsdiff uses identity-based matching (tracks, clips, and devices matched by internal IDs rather than position) so that renaming or reordering elements does not produce false diffs — a concrete format/diff design lesson for a git-diffable DAW format.

> it uses "Identity-based matching" where "Tracks, clips, and devices are matched by their internal IDs, not by position." This means "Renaming or reordering doesn't create false diffs."

### 31. [SINGLE-SOURCE (not triangulated)]

alsdiff integrates with git via a setup script that configures .gitattributes and an optional prepare-commit-msg hook that auto-generates commit message summaries from the diff stats, showing a working pattern for wiring musical diffs into git workflows.

> Includes setup script (setup-git.sh) for automatic .gitattributes configuration and optional prepare-commit-msg hook that "auto-generates commit message summaries using alsdiff --mode stats."

### 32. [—]

A fundamental limitation of diffing binary-plugin-based DAW projects is that third-party plugin state is opaque: alsdiff can only detect that VST/AU state changed, not which parameters changed — supporting the case that a text-native project format should store parameters as readable values.

> "Plugin state is opaque binary data"—cannot interpret individual VST/AU parameter changes; only detects that state changed

### 33. [—]

alsdiff is actively developed but has essentially no community traction (0 stars, 0 forks, latest release v0.5.3 dated June 25, 2026, 377 commits), suggesting the diff-your-DAW-project niche exists as prior art but has not yet demonstrated mass demand.

> Latest release: v0.5.3 (June 25, 2026). Repository shows 0 stars, 0 forks. 377 total commits on master branch.

### 34. [VERIFIED (2-0)]

DAWproject is an open, vendor-backed exchange format for transferring user project data between DAWs, created and maintained by Bitwig, and released under the permissive MIT License — making it directly reusable prior art for an open-source DAW project format.

> open exchange format for user data between Digital Audio Workstations (DAWs) ... MIT License

### 35. [SINGLE-SOURCE (not triangulated)]

A .dawproject file is a ZIP container holding human-readable, UTF-8 XML documents (project.xml and metadata.xml) with published XSD schemas (Project.xsd, MetaData.xsd) — i.e., the text payload exists but is not directly git-diffable at rest because it is wrapped in a binary ZIP archive.

> Container: ZIP archive ... Content: XML-based (project.xml, metadata.xml) ... Text Encoding: UTF-8 ... Schema Definitions: Project.xsd and MetaData.xsd provided

### 36. [SINGLE-SOURCE (not triangulated)]

DAWproject 1.0 is stable and is supported by multiple shipping commercial DAWs — Bitwig Studio 5.0.9, PreSonus Studio One 6.5, Steinberg Cubase 14, Cubasis 3.7.1, VST Live 2.2, and n-Track Studio 10.2.2 — demonstrating that a cross-vendor, XML-based project format can represent real DAW sessions in practice.

> Version 1.0 is stable ... Bitwig Studio 5.0.9, PreSonus Studio One 6.5, Steinberg Cubase 14, Steinberg Cubasis 3.7.1, Steinberg VST Live 2.2, n-Track Studio v10.2.2

### 37. [—]

The format's scope covers audio, note (MIDI-like), and automation timeline data plus plugin states, aiming to preserve as much user-created data as feasible — a useful checklist of what a BeatLab project schema must represent.

> preserving as much user created data as feasible ... audio timeline data, note timeline data, automation timeline data

### 38. [SINGLE-SOURCE (not triangulated)]

DAWproject explicitly declares non-goals that exclude being a native DAW format, binary-optimized storage, low-level MIDI storage, and non-session data such as preferences — so it is designed as an interchange format, not a git-native working format, leaving the 'text-native project file as the DAW's primary format' quadrant unoccupied by this project.

> Explicitly excludes: native DAW format, binary optimization, low-level MIDI storage, and non-session data like preferences

### 39. [SINGLE-SOURCE (not triangulated)]

Ableton officially publishes a git-diff tool (maxdiff) whose purpose is to produce readable diffs of Max patches and Max for Live devices under git, establishing first-party prior art for 'musical diff' tooling on binary/JSON DAW-adjacent file formats.

> a way to diff condensed representations of Max patches and Max for Live devices, so the diff is more readable when working with the version control tool git.

### 40. [SINGLE-SOURCE (not triangulated)]

maxdiff can diff Ableton Live set (.als) files by exposing their XML content, and handles the fact that .als files are stored gzipped — confirming .als is gzipped XML and that git-diffable .als workflows already exist.

> allows diffing the XML content of `.als` files, regardless of whether they are gzipped.

### 41. [—]

The tool integrates via git's textconv mechanism: users add entries to .gitattributes and a custom converter in git config (e.g. [diff "maxpat"] textconv = python3 ~/maxdevtools/maxdiff/maxpat_textconv.py), so 'git diff' shows condensed text for otherwise unreadable files.

> textconv = python3 ~/maxdevtools/maxdiff/maxpat_textconv.py

### 42. [—]

textconv-based diffing is read-only: maxdiff explicitly cannot support merge-conflict resolution or partial staging, meaning git-native workflows still require a truly text-native project format rather than a diff-time conversion layer.

> Resolving merge conflicts

### 43. [—]

For readability, maxdiff suppresses noise by omitting properties at their default values in its condensed output — a format-design lesson (omit defaults) applicable to designing a git-diffable DAW project format.

> only shows object properties that don't have a default value

### 44. [SINGLE-SOURCE (not triangulated)]

Ableton Live's .als project file format is internally just gzipped XML, which becomes human-readable (and thus git-diffable) once decompressed — confirming prior art exists for treating a mainstream GUI DAW's project file as a text document.

> a Live set is actually just gzipped XML

### 45. [SINGLE-SOURCE (not triangulated)]

Ableton-Live-tools achieves git-friendliness via an external workaround layer — a macOS Automator service and a pre-commit Git hook that automatically decompress .als files — rather than the DAW natively saving text, illustrating that GUI-DAW/text-file sync had to be bolted on from outside.

> Save Live Set as XML.workflow will automatically uncompress `.als` files in the current project so that they play nice with Git

### 46. [—]

The tool addresses only storage-level diffability (decompressing XML); it provides no musical diff visualization or merge-conflict resolution, indicating a gap between raw text-diffable project files and semantically meaningful musical diffs.

> The README does not make explicit claims about diffing or merging capabilities. It focuses on decompression to make files "play nice with Git"

### 47. [—]

There is measurable community demand for git-versioned DAW projects: the repo has 376 stars and 28 forks despite being a small shell-script collection with no releases.

> 376 stars ... 28 forks ... Language: Shell (100%) ... No release versions published

### 48. [—]

The project is effectively abandoned prior art, not part of the 2024–2026 landscape: it was created in February 2015 and last pushed in September 2017.

> Created: February 10, 2015 ... Last Pushed: September 16, 2017

### 49. [SINGLE-SOURCE (not triangulated)]

There is existing prior art for musical diff tooling: musicdiff is a Python3 package with a CLI that computes and visualizes notation differences between two music scores, directly confirming that 'musical diff' tools exist outside of git textual diffing.

> A Python3 package (and command-line tool) for computing and visualizing (or describing) the notation differences between two music scores.

### 50. [SINGLE-SOURCE (not triangulated)]

musicdiff operates on score notation formats (anything music21 or converter21 can parse, e.g. MusicXML and Humdrum kern), not on DAW project files — so it is prior art for score diffing rather than DAW-project diffing, leaving that part of the 'empty quadrant' open.

> any format music21 or converter21 can parse

### 51. [—]

musicdiff builds on peer-reviewed academic work: it is derived from Francesco Foscarin's music-score-diff (2019 conference paper on score diffing), meaning tree/edit-distance-based music diff algorithms are published and reusable.

> musicdiff is derived from: music-score-diff by Francesco Foscarin.

### 52. [—]

musicdiff is invoked as a CLI with configurable comparison detail (e.g. include lyrics/style, exclude beams), demonstrating a working UX pattern for a configurable 'musical diff' command line tool.

> python3 -m musicdiff -i decoratednotesandrests lyrics style -x beams -- file1.musicxml file2.krn

### 53. [—]

musicdiff is actively maintained and permissively licensed as of 2026 (MIT license, latest release v5.2.0 on February 16, 2026, ~64 GitHub stars), so its algorithms or code could plausibly be reused or ported for a BeatLab musical-diff feature.

> License: MIT ... Latest Release: v5.2.0 (February 16, 2026) ... GitHub Stars: 64

### 54. [—]

A practicing Reaper user versions only the .rpp project file in git (via a .gitignore that excludes media and peak files), demonstrating real-world producer demand for git-based version control of DAW projects.

> I simply initialize a git repository in the project folder and put the file under version control. ... I also create a .gitignore file and that this is this particular project file that I want to track, and not any other, such as media or peak files

### 55. [—]

Even in a git-with-Reaper workflow, the author treats DAW project files as opaque to version control, asserting that git cannot meaningfully diff or merge them — evidence that no established musical-diff/merge tooling existed for DAW projects as of 2023-2024, despite .rpp being a text format.

> the project files are normally opaque and we should not expect git or any other version control system to be able to merge/diff them.

### 56. [—]

Git is considered poorly suited to large binary audio assets (WAV samples, stems), so the workflow deliberately versions only the project document and excludes audio media — a format-design precedent for separating a small text project file from bulky binary assets.

> Git is not super suited for managing big binary files (such as WAV samples and stems), but this is not a problem for me since I only manage the main project file.

### 57. [—]

The described workflow uses git purely as a snapshot/undo history with descriptive commit messages (e.g., after tweaking plugin settings) and git gui for browsing history, not for branching, merging, or semantic diffing of musical content.

> bass vst settings adjusted

### 58. [—]

Sharing a git-versioned DAW project is insufficient for collaboration or backup because collaborators still need the DAW, the plugins, and all media files, which live outside the repository.

> Collaborators need "the DAW, the plugins and all the media files"; remote repositories cannot serve as complete backups due to missing media files.

### 59. [—]

standardized-audio-context is a cross-browser Web Audio API wrapper (a ponyfill, not a polyfill) that aims to closely follow the Web Audio standard without modifying the global scope; Tone.js's use of it is therefore the layer that determines Tone.js's environment compatibility.

> A cross-browser wrapper for the Web Audio API which aims to closely follow the standard. ... It's what's known as a ponyfill.

### 60. [SINGLE-SOURCE (not triangulated)]

standardized-audio-context explicitly does not work in Node.js, meaning any headless Node rendering path for a Tone.js-based DAW (BeatLab fork) must either shim/replace this dependency (e.g. with node-web-audio-api) or run in headless Chromium instead of plain Node.

> This package doesn't work with Node.js.

### 61. [SINGLE-SOURCE (not triangulated)]

The library ships an almost complete OfflineAudioContext implementation, so offline (faster-than-realtime) rendering to a buffer is supported in browsers — including headless Chromium — which is the mechanism a browser-based headless render-to-WAV pipeline would rely on.

> This is an almost complete implementation of the OfflineAudioContext interface.

### 62. [—]

Its officially supported environments are browsers only: Chrome v105+, Firefox v113+, and Safari v17.3+, with its test suite run in those browsers (via BrowserStack/Sauce Labs), not in Node.

> The list of currently supported browsers includes Chrome v105+, Firefox v113+ and Safari v17.3+.

### 63. [—]

The project is actively maintained open source under an MIT license (hundreds of releases, ~776 stars), so relying on or patching around it in a fork is viable from a licensing and maintenance standpoint.

> MIT license

### 64. [SINGLE-SOURCE (not triangulated)]

node-web-audio-api provides Node.js bindings to a Rust implementation of the W3C Web Audio API spec (orottier/web-audio-api-rs via napi-rs), aiming for both efficiency and spec compliance — making it a native (non-browser) path to Web Audio in Node.

> Node.js bindings for the Rust implementation of the Web Audio API specification. The library aims to provide an implementation that is both efficient and compliant with the specification.

### 65. [SINGLE-SOURCE (not triangulated)]

The library ships a polyfill entry point that installs Web Audio globals on globalThis specifically so browser-oriented libraries like Tone.js can run in Node, and the repo includes a working examples/tone.js demonstrating Tone.js (FM/AM synths, Tone.Loop, Transport) running on node-web-audio-api via `import '#node-web-audio-api-polyfill'` followed by `Tone.setContext(audioContext)`.

> For existing browser oriented codebases or libraries that rely on globally available entities or explicit calls to window (e.g. `window.AudioParam`, cf. `examples/tone.js`) we provide a polyfill entry point that extends `globalThis` and create a `windows` namespace

### 66. [SINGLE-SOURCE (not triangulated)]

OfflineAudioContext is implemented (js/OfflineAudioContext.js: `export class OfflineAudioContext extends BaseAudioContext` with async startRendering, suspend, and resume wrapping the native binding), enabling headless offline rendering to an AudioBuffer in Node — the core requirement for CLI render-to-WAV.

> async startRendering() { ... napiAudioBuffer = await this[kNapiObj].startRendering();

### 67. [—]

Prebuilt binaries cover the major desktop platforms (Windows x64/arm64, macOS x64/aarch64, Linux x64/arm/arm64 with jack or pipewire-jack), so `npm install node-web-audio-api` works without a local Rust toolchain on those targets.

> We provide prebuilt binaries for the following platforms: Windows x64, Windows arm64, macOS x64, macOS aarch64, Linux x64 gnu (jack / pipewire-jack), Linux arm gnueabihf (jack / pipewire-jack), Linux arm64 gnu (jack / pipewire-jack)

### 68. [—]

The implementation has documented gaps relevant to compatibility testing: AudioBuffer#getChannelData is flagged as unreliable in some situations, and MediaStream support is minimal (only a basic audio input stream and MediaStreamSourceNode); spec compliance is checked against the Web Platform Tests suite (`npm run wpt`).

> AudioBuffer#getChannelData is implemented but not reliable in some situations. Streams: only a minimal audio input stream and MediaStreamSourceNode are provided. All other MediaStream features are left on the side for now.

### 69. [SINGLE-SOURCE (not triangulated)]

Tone.js provides an OfflineContext class that is a wrapper around the Web Audio API's OfflineAudioContext, meaning Tone.js has built-in first-class support for offline (non-realtime) rendering — a prerequisite for headless render-to-WAV in a BeatLab fork.

> Wrapper around the OfflineAudioContext

### 70. [SINGLE-SOURCE (not triangulated)]

OfflineContext.render() returns a Promise resolving to a ToneAudioBuffer, so an entire Tone.js project can be rendered to an audio buffer programmatically rather than played in real time.

> The primary method for offline audio generation is `render(asynchronous?)`, which "returns Promise<ToneAudioBuffer>".

### 71. [—]

OfflineContext rendering can run asynchronously (the default), trading slightly slower rendering for not blocking the main thread — relevant to CLI/headless render ergonomics.

> The `asynchronous` parameter (defaulting to true) allows non-blocking rendering that "will not block the main thread, but be slightly slower."

### 72. [—]

OfflineContext is constructed with explicit channels, duration (seconds), and sampleRate parameters (e.g. new Tone.OfflineContext(1, 0.5, 44100)), and can alternatively wrap an existing OfflineAudioContext instance — meaning a Node-side OfflineAudioContext (e.g. from node-web-audio-api) could potentially be passed in.

> The class also accepts an existing `OfflineAudioContext` directly as an alternative constructor parameter.

### 73. [—]

Tone.js nodes can be bound to a specific offline context by passing { context } at construction (e.g. new Tone.Oscillator({ context })), enabling a full synthesis graph to target the offline renderer.

> const context = new Tone.OfflineContext(1, 0.5, 44100);
const osc = new Tone.Oscillator({ context });
context.render().then(buffer => {

### 74. [—]

An MCP server (AbletonMCP) already exists that lets Claude directly control Ableton Live via the Model Context Protocol, demonstrating prior art for agent-native DAW control.

> AbletonMCP connects Ableton Live to Claude AI through the Model Context Protocol (MCP), allowing Claude to directly interact with and control Ableton Live.

### 75. [—]

AbletonMCP's architecture bridges the AI agent to the DAW at runtime via a live socket connection — a MIDI Remote Script inside Ableton runs a TCP socket server speaking a JSON protocol to a Python MCP server — rather than by reading/writing project files, meaning it offers no text-native or git-diffable project representation.

> A MIDI Remote Script for Ableton Live that creates a socket server to receive and execute commands ... a simple JSON-based protocol over TCP sockets

### 76. [—]

The exposed agent capabilities cover core DAW editing operations — session/track info, MIDI and audio track creation, clip creation/editing/triggering, adding notes to MIDI clips, loading instruments/effects from the browser, and tempo changes — defining a useful baseline tool surface for BeatLab's MCP integration.

> Create and modify MIDI and audio tracks ... Create, edit, and trigger clips ... Load instruments and effects from Ableton's browser ... Add notes to MIDI clips ... Change tempo and other session parameters

### 77. [—]

The project has substantial community traction (~2.8k GitHub stars and 365 forks), which is a demand signal for AI-assisted music production tooling.

> 2.8k stars ... 365 forks

### 78. [—]

The README acknowledges practical limits of agent-driven arrangement through a live-control API — complex arrangements must be decomposed into small stepwise commands — and that the tool is unofficial.

> creating complex musical arrangements might need to be broken down into smaller steps ... a third-party integration and not made by Ableton

### 79. [—]

ableton-mcp-extended is an existing MCP server (Python, MIT-licensed, created May 2025, still actively updated as of July 2026) that lets AI assistants such as Claude and Cursor control Ableton Live through natural language, demonstrating that agent-native/MCP music tooling already exists for a mainstream GUI DAW.

> Control Ableton Live using natural language via AI assistants like Claude or Cursor.

### 80. [—]

The MCP server exposes note-level MIDI editing tools to AI agents — creating clips and adding/deleting/transposing/quantizing notes — plus track, device-parameter, and browser control, i.e., agents can compositionally edit a running Ableton session.

> Create and name MIDI clips with specified lengths. Add, delete, transpose, and quantize notes

### 81. [—]

The integration works by driving a live running instance of Ableton via a Remote Script and the Live API (AI assistant -> MCP Server -> Ableton Remote Script -> Live API), not by reading or writing Ableton's .als project files — so it offers no headless rendering or text-file/git-diffable project access, leaving that quadrant open for a text-native DAW like the proposed BeatLab fork.

> Quick five-minute setup involves cloning the repository, installing Python dependencies, copying the remote script to Ableton's folder, configuring the control surface, and connecting via Claude Desktop or Cursor's MCP configuration.

### 82. [—]

The project shows measurable community demand for AI-assisted music production: the repo has roughly 233 stars and 55 forks, and GitHub search returns at least a dozen derivative or competing Ableton MCP servers (e.g., jon-wrennall/ableton-mcp-extended, thomas0barand/ableton-mcp-expanded, mumumedia/studioworks-core with '50+ tools') created through 2025-2026.

> 233 stars and 55 forks (visible on page) ... The project acknowledges inspiration from "The original ableton-mcp project" while expanding functionality significantly with voice integration and advanced control features.

### 83. [—]

Beyond DAW control, the server integrates generative audio (ElevenLabs text-to-speech) and a UDP-based real-time control protocol, indicating that agent-facing music tools are expanding toward audio generation and low-latency parameter control rather than project-file manipulation.

> Audio Generation: ElevenLabs TTS integration for "Generate narration, vocal samples, or spoken" content; Real-time Control: UDP-based high-performance protocol for custom controllers

### 84. [—]

An open-source MCP server (williamzujkowski/strudel-mcp-server, now 'live-coding-music-mcp') already exists that lets Claude control the Strudel.cc live-coding environment for AI-assisted music composition, establishing direct prior art for agent/MCP integration with music tools.

> This is live-coding-music-mcp (formerly @williamzujkowski/strudel-mcp-server), an MCP server enabling Claude to control Strudel.cc for AI-assisted music composition.

### 85. [—]

The server controls the web-based music environment via Playwright-driven Chromium browser automation, injecting code directly into the CodeMirror editor rather than simulating keystrokes — a proven (if heavyweight) architecture for driving Web Audio apps from an agent, with 120–150 MB resident memory and 1.5–2 s browser init.

> The system uses Playwright to automate Chromium, but with a crucial optimization—rather than keyboard simulation, it writes patterns directly to the CodeMirror editor via editor.__view.dispatch(...), described as "about 80% faster."

### 86. [—]

The MCP server exposes 27 tools spanning pattern editing, playback/tempo control, pattern generation across 8 genres, music theory, transforms/effects, FFT-based audio analysis, MIDI import/export, and audio capture — a concrete reference feature set for what an agent-native DAW toolkit can look like.

> The project exposes 27 tools across 14 categories ... Pattern Generation: The system generates complete patterns across 8 genres (techno, house, drum & bass, ambient, trap, jungle, jazz, experimental).

### 87. [—]

The project shows measurable community demand/traction for AI-assisted live-coding music tools: 218 GitHub stars, npm publication, 1,709 passing tests, and active releases through v4.0.0 in May 2026.

> Current Status: Beta | 1,709 passing tests | 86.32% statement coverage | 218 GitHub stars | Published to npm ... v4.0.0 (released May 15, 2026) removed deprecated single-verb tool aliases.

### 88. [—]

Because it imports and redistributes AGPL-licensed Strudel packages (@strudel/core, @strudel/mini, @strudel/tonal, @strudel/transpiler), the project is forced to AGPL-3.0-or-later — a licensing constraint relevant to any BeatLab fork considering Strudel dependencies.

> Since we import from those packages and redistribute the combined work via npm, this project must be distributed under the same copyleft terms.

### 89. [—]

A macOS-native DAW called ScratchTrack Audio with git-like branching version control was released as a prerelease in January 2026, free for local use and paid for cloud syncing/collaboration — direct prior art in the 'version-controlled DAW' space, though it is an early-stage recorder-style app (AU-only, basic MIDI, initially shipped at 16-bit audio) rather than a text-file-native DAW.

> I am working on building (and have made my first prerelease) for a Digital Audio Workstation with git like branching version control. It's free for local use and paid for cloud syncing or collaboration.

### 90. [—]

REAPER's project files are already git-friendly (text-based .RPP), and practitioners report successfully using plain git (add/commit/push, branching, tagging, with LFS for audio assets) on REAPER projects today — meaning the 'git-diffable DAW project' quadrant is at least partially occupied by REAPER.

> You can already use git with REAPER right now, plain and simple. REAPER’s project files are all very git friendly. Simple add/commit/push, etc. Of course, if you’re going to be sharing a REAPER project in a repo, you should enable LFS, and have a smart project structure for your works.

### 91. [—]

There is an explicit demand signal from technical users for open, text-based DAW project formats as the core feature, with built-in git integration seen as unnecessary if the format itself is text-native — supporting BeatLab's 'document-only text format + external git' design over a bespoke VCS.

> Honestly, as long as it's based on open, text-based formats, I could handle the Git part myself.

### 92. [—]

Splice.com previously offered a git + Dropbox-style version-control interface for existing DAW project files (reportedly Ableton and FL Studio) before pivoting to selling samples/instruments, and commenters view that abandoned capability as worth reviving — prior art showing a versioning layer over binary DAW formats was tried commercially and dropped.

> It was kind of a git + dropbox type interface for actual DAW projects (Ableton and Fruity were supported IIRC). This was really cool and something that someone should bring back.

### 93. [—]

Practitioner skepticism in the thread holds that users will not switch DAWs for versioning alone, and that versioning is more viable as a layer around existing DAW formats than as a replacement DAW — a caution against positioning a new DAW primarily on git-friendliness.

> I cannot imagine anyone who works with audio regularly would realistically consider replacing Ableton/Logic/ProTools/Reaper/etc with whatever recording experience this provides... It might be more effective to approach this as version tracking / collaboration layer around existing DAW formats rather than a full replacement.

### 94. [—]

An MCP server exists (tubone24/midi-mcp-server, MIT-licensed, TypeScript) that lets AI models generate MIDI files from structured text/JSON music data via the Model Context Protocol, confirming prior art for agent-native music composition tooling.

> MIDI MCP Server is a Model Context Protocol (MCP) server that enables AI models to generate MIDI files from text-based music data. This tool allows for programmatic creation of musical compositions through a standardized interface.

### 95. [—]

The server's create_midi tool returns a base64-encoded MIDI file and renders an interactive piano-roll preview with audio playback inside supporting MCP clients, demonstrating a working pattern for pairing agent-driven text-based composition with an in-conversation GUI (piano roll) view.

> Generate a MIDI file from structured composition data. Returns base64-encoded MIDI and renders an interactive piano-roll preview with audio playback in supported MCP clients.

### 96. [—]

The server ships 7 music theory reference documents (harmony, chord progressions, counterpoint, modes/scales, orchestration, rhythm, voice-leading) as MCP resources so AI agents can compose in a theory-aware way — a design pattern directly reusable for a BeatLab MCP integration.

> The server exposes 7 music theory reference documents as MCP resources

### 97. [—]

The implementation is built on the Tone.js ecosystem (@tonejs/midi for parsing, midi-writer-js for generation, soundfont-player for preview audio, Zod for schema validation) and supports three MCP transports (stdio, HTTP, Cloudflare Workers), showing these libraries are viable for headless/serverless music tooling compatible with a Tone.js-based DAW.

> Three transport modes: stdio, HTTP, or Cloudflare Workers (remote).

### 98. [—]

As a demand signal, the project was created 2025-04-06, remained actively developed through at least April 2026 (last push 2026-04-12), and has modest but real traction (45 stars, 10 forks, 3 open issues) — evidence of an emerging but still small niche for MCP/agent music tools.

> "created_at":"2025-04-06T17:41:09Z","pushed_at":"2026-04-12T12:51:54Z" ... "forks_count":10 ... "stargazers_count":45

### 99. [—]

Ableton Live's native .als project format is a gzipped XML file, so it can in principle be decompressed (e.g., via a git hook or smudge filter) into diffable text before committing to git.

> An Ableton live set file is just a gzipped xml, so I can imagine some git hook that would unzip it before committing it to git.

### 100. [—]

Practitioners (including Ardour's lead developer Paul Davis) argue XML is a poor serialization choice for git-based versioning of DAW projects because git's diff/merge is line-oriented, making merge conflicts unnecessarily likely — a direct format-design consideration for a git-diffable project format.

> XML is generally a very poor choice to use in combination with git, which is heavily line-oriented...unnecessarily increased [merge conflict] likelihood.

### 101. [—]

Splice Studio operated as a version-control service specifically for music software projects from roughly 2013 to 2021 before pivoting to sample sales, constituting prior art (and a market-failure data point) for git-like versioning of DAW projects.

> Splice Studio used to be version control for music software (from about 2013-2021)...They pivoted into the more profitable sample discovery and sales business later.

### 102. [—]

Many working producers version projects by manual filename conventions (numeric suffixes or date prefixes) rather than git, and some explicitly see no need for real version control — a demand-signal caveat for the target product.

> I simply prepend the session file name with the date (YYMMDD)...That's all of the version control that I need.

### 103. [—]

Compressed binary audio assets are a fundamental barrier to git-based music workflows because small changes cascade through the whole file, defeating git's delta/diff model; large-file tools like git-annex (with distributed storage and partial checkouts) are proposed as the complement for audio assets alongside text project files.

> git-annex is not git-lfs, which also uses git smudge filters, and appears to lack git-annex's widely distributed storage and partial checkouts.

### 104. [—]

Reaper's project file format (.rpp) is human-readable text, making it an exception among DAW formats and amenable to version control tools like SVN/git.

> Reaper's project files are essentially human-readable text-files so that works in this case... probably an exception for DAW formats.

### 105. [—]

Most DAW project files are binary, which prevents version control systems from storing efficient diffs; standard VCS tools work best only with text files.

> subversion or whatever VCS are well suited for DAW files as they work best with text files because only diffs are saved. At least subversion cannot do that with binary files.

### 106. [—]

Binary DAW project files cannot be meaningfully compared/diffed, forcing producers to open each saved version in the DAW to identify what changed — evidence of an unmet need for musical diff tooling.

> You can't compare the projects and their parts (binary compare makes no sense!), so you have to open the version and look if it's the right one.

### 107. [—]

In the absence of workable VCS integration, producers use manual workarounds: timestamp-named incremental saves synced via Dropbox, or dated filenames plus file-sync backup tools.

> I use Reaper as my DAW, so I had ability to configure saving projects in timestamp-named files. Every save = separate file

### 108. [—]

Practitioner sentiment in this thread (18 posts, 2 pages) was largely skeptical of formal VCS for DAW work, arguing SCM adds little over backups when file contents can't be compared, and citing storage costs of versioning large audio assets.

> Without the ability to know and compare the contents of your files, an SCM system isn't going to buy you anything that a good backup system can't give you.

### 109. [—]

An open-source MCP server (bschoepke/ableton-live-mcp) exists that lets AI coding agents (e.g. Codex) control Ableton Live end-to-end — creating tracks, MIDI, device patches, sidechaining, and arrangement edits — via Ableton's Live Object Model rather than a text project format.

> I made this MCP server so I could just ask Codex to do anything in Ableton Live for me... [markalby] is this using M4L or the LOM? [fassssst] Object model

### 110. [—]

Ardour, a cross-platform open-source DAW, merged MCP support more than a month before May 2026 (contributor 'zabooma', commit d582a0b in Ardour/ardour), with the stated goal of alternate interaction modes including accessibility for visually impaired users rather than AI-generated music.

> MCP for Ardour was added more than a month ago, thanks to contributor zabooma: https://github.com/Ardour/ardour/commit/d582a0b042a68ccb22c0... When we recently added MCP to Ardour (a cross-platform FLOSS DAW), the goal wasn't to get the machine to make the music for you, it was to provide alternate ways of interacting with the DAW (particularly for those with visual impairments that make voice control preferable).

### 111. [—]

Multiple independent Ableton MCP implementations already exist as of late 2025/early 2026 — this project is not the first; another HN user (jhurliman) built experiments iterating on a pre-existing Ableton MCP (HN item 46428922), indicating a small but active ecosystem of agent-native DAW control tools.

> Very cool! I posted my own experiments in this area a few months back, which were an iteration on an existing Ableton MCP. ... https://news.ycombinator.com/item?id=46428922

### 112. [—]

There is expressed practitioner demand for AI/MCP integration across other DAWs and music tools — commenters requested equivalents for Logic Pro X, FL Studio, MainStage, Sonic Pi, Strudel, and Orca — and one commenter reverse-engineered the MainStage concert file format to build a CLI for automated setup, a direct demand signal for CLI/text-level project-file access.

> Does anyone know of other MCP servers for similar music creative tools? I'm interested in things like sonic-pi, strudel.cc and orcas. ... [Footprint0521] We should talk! I have a cli that does exactly this, I was able to reverse engineer the MainStage concert format

### 113. [—]

Practitioner sentiment favors AI as targeted point-solutions inside the DAW (MIDI generation, track layout, sidechain automation, semantic sample search) over full agentic 'vibe-producing'; the MCP author confirmed track layout, MIDI generation, and workflow automation work, and implemented semantic sample search by querying Ableton's internal sqlite database directly.

> That being said, I don't think I want a full agentic workflow for vibe-producing. Point solutions seems like a better fit for me, personally. ... [bschoepke] I just pushed another tool for that! It wasn't exposed in the Live API but the implementation just issues the same queries to the underlying sqlite db that the Live GUI queries for the "Find Similar Sounds" feature.


---

## Research process log

```
Q: Survey the current landscape (2024–2026) of programmatic / code-based / text-fil…
Decomposed into 5 angles: prior-art systems (live-coding and web DAWs), git-diffable project formats and musical diff, headless Web Audio rendering in Node, MCP servers and agent-native music tools, community demand and practitioner sentiment
prior-art systems (live-coding and web DAWs): 6 results
git-diffable project formats and musical diff: 6 results
headless Web Audio rendering in Node: 6 results
headless Web Audio rendering in Node: 3 novel (3 filtered)
MCP servers and agent-native music tools: 6 results
MCP servers and agent-native music tools: 4 novel (2 filtered)
community demand and practitioner sentiment: 6 results
community demand and practitioner sentiment: 4 novel (2 filtered)
Fetched 23 sources → 113 claims → verifying top 25
"openDAW is an actively developed, open-source, bro…": 3-0 ✓
"openDAW already ships a headless mode/SDK: the REA…": 3-0 ✓
"openDAW project files are stored as zipped bundle …": 3-0 ✓
"Tone.js positions itself as a browser-targeted Web…": 0-3 ✗
"Tone.js provides a DAW-like scheduling model: a gl…": 3-0 ✓
[v2:DAWproject is an open, vendor-backed exc] failed: You've hit your session limit · resets 7:10am (UTC)
"DAWproject is an open, vendor-backed exchange form…": 2-0 (1 errored) ✓
[v1:A .dawproject file is a ZIP container ho] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:A .dawproject file is a ZIP container ho] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:DAWproject 1.0 is stable and is supporte] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:DAWproject 1.0 is stable and is supporte] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:A .dawproject file is a ZIP container ho] failed: You've hit your session limit · resets 7:10am (UTC)
"A .dawproject file is a ZIP container holding huma…": 0-0 (3 errored) ?
[v2:DAWproject 1.0 is stable and is supporte] failed: You've hit your session limit · resets 7:10am (UTC)
"DAWproject 1.0 is stable and is supported by multi…": 0-0 (3 errored) ?
[v0:DAWproject explicitly declares non-goals] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:DAWproject explicitly declares non-goals] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:alsdiff is an existing open-source tool] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:DAWproject explicitly declares non-goals] failed: You've hit your session limit · resets 7:10am (UTC)
"DAWproject explicitly declares non-goals that excl…": 0-0 (3 errored) ?
[v1:alsdiff is an existing open-source tool] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:alsdiff uses identity-based matching (tr] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:alsdiff is an existing open-source tool] failed: You've hit your session limit · resets 7:10am (UTC)
"alsdiff is an existing open-source tool (written m…": 0-0 (3 errored) ?
[v1:alsdiff uses identity-based matching (tr] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:alsdiff integrates with git via a setup] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:alsdiff uses identity-based matching (tr] failed: You've hit your session limit · resets 7:10am (UTC)
"alsdiff uses identity-based matching (tracks, clip…": 0-0 (3 errored) ?
[v1:alsdiff integrates with git via a setup] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:alsdiff integrates with git via a setup] failed: You've hit your session limit · resets 7:10am (UTC)
"alsdiff integrates with git via a setup script tha…": 0-0 (3 errored) ?
[v0:Ableton officially publishes a git-diff] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Ableton officially publishes a git-diff] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Ableton officially publishes a git-diff] failed: You've hit your session limit · resets 7:10am (UTC)
"Ableton officially publishes a git-diff tool (maxd…": 0-0 (3 errored) ?
[v0:maxdiff can diff Ableton Live set (.als)] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:maxdiff can diff Ableton Live set (.als)] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:maxdiff can diff Ableton Live set (.als)] failed: You've hit your session limit · resets 7:10am (UTC)
"maxdiff can diff Ableton Live set (.als) files by …": 0-0 (3 errored) ?
[v1:Ableton Live's .als project file format] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:Ableton Live's .als project file format] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Ableton Live's .als project file format] failed: You've hit your session limit · resets 7:10am (UTC)
"Ableton Live's .als project file format is interna…": 0-0 (3 errored) ?
[v0:Ableton-Live-tools achieves git-friendli] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Ableton-Live-tools achieves git-friendli] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:There is existing prior art for musical] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:There is existing prior art for musical] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Ableton-Live-tools achieves git-friendli] failed: You've hit your session limit · resets 7:10am (UTC)
"Ableton-Live-tools achieves git-friendliness via a…": 0-0 (3 errored) ?
[v2:There is existing prior art for musical] failed: You've hit your session limit · resets 7:10am (UTC)
"There is existing prior art for musical diff tooli…": 0-0 (3 errored) ?
[v0:musicdiff operates on score notation for] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:musicdiff operates on score notation for] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:musicdiff operates on score notation for] failed: You've hit your session limit · resets 7:10am (UTC)
"musicdiff operates on score notation formats (anyt…": 0-0 (3 errored) ?
[v0:node-web-audio-api provides Node.js bind] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:node-web-audio-api provides Node.js bind] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:node-web-audio-api provides Node.js bind] failed: You've hit your session limit · resets 7:10am (UTC)
"node-web-audio-api provides Node.js bindings to a …": 0-0 (3 errored) ?
[v0:The library ships a polyfill entry point] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:The library ships a polyfill entry point] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:The library ships a polyfill entry point] failed: You've hit your session limit · resets 7:10am (UTC)
"The library ships a polyfill entry point that inst…": 0-0 (3 errored) ?
[v0:OfflineAudioContext is implemented (js/O] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:OfflineAudioContext is implemented (js/O] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:OfflineAudioContext is implemented (js/O] failed: You've hit your session limit · resets 7:10am (UTC)
"OfflineAudioContext is implemented (js/OfflineAudi…": 0-0 (3 errored) ?
[v1:standardized-audio-context explicitly do] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:standardized-audio-context explicitly do] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:standardized-audio-context explicitly do] failed: You've hit your session limit · resets 7:10am (UTC)
"standardized-audio-context explicitly does not wor…": 0-0 (3 errored) ?
[v0:The library ships an almost complete Off] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:The library ships an almost complete Off] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:The library ships an almost complete Off] failed: You've hit your session limit · resets 7:10am (UTC)
"The library ships an almost complete OfflineAudioC…": 0-0 (3 errored) ?
[v0:Tone.js provides an OfflineContext class] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Tone.js provides an OfflineContext class] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Tone.js provides an OfflineContext class] failed: You've hit your session limit · resets 7:10am (UTC)
"Tone.js provides an OfflineContext class that is a…": 0-0 (3 errored) ?
[v0:OfflineContext.render() returns a Promis] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:OfflineContext.render() returns a Promis] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:OfflineContext.render() returns a Promis] failed: You've hit your session limit · resets 7:10am (UTC)
"OfflineContext.render() returns a Promise resolvin…": 0-0 (3 errored) ?
Verify done: 25 claims → 5 confirmed, 1 refuted, 19 unverified
[synthesize] failed: You've hit your session limit · resets 7:10am (UTC)
```