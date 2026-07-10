# Roadmap — a git-native DAW

> **Working name:** `beatlab-daw` (placeholder — see [Naming](#naming)).
> **One line:** a real GUI DAW whose project file is diff-friendly text, driveable from a
> CLI, and editable by an AI agent — with sound-design critique built into the core.

This roadmap is grounded in **four deep-research passes**, all now **fully adversarially
verified** (search → fetch → extract → 3-vote verify, zero infrastructure errors on the final
run), archived under [`docs/research/`](docs/research/) — plus a fifth pass of direct **source
code archaeology** (cloning and reading openDAW/DAWproject/automix-toolkit/node-web-audio-api
rather than web search) in [`docs/opendaw-notes.md`](docs/opendaw-notes.md). Every claim below is
either confirmed (cite freely) or explicitly flagged as single-source/open (treat as a lead, not
a fact). A number of claims drafted into an earlier version of this roadmap **did not survive**
full verification — corrected inline, with the correction noted so we don't regress.

---

## 1. The thesis

Three properties, held simultaneously, that no shipping tool currently combines well:

1. **A real GUI** — piano roll, knobs, mixer, step sequencer. Not a code editor with a
   visualizer bolted on.
2. **Text project files, diff-friendly by design** — the working file *is* human-readable,
   git-diffable text. Not an export, not a zip you decompress with a hook.
3. **Full CLI + agent access** — render to WAV/stems, inspect, mutate, and *musically* diff a
   project from the command line; an MCP server exposes the same operations to an AI agent.

### Is the quadrant actually empty? **Yes — confirmed, not just plausible.**

The fully-verified landscape report's own summary: *"no existing system occupies the target
quadrant... the evidence positively refutes the idea that this space is already filled."*
✅ **CONFIRMED**, `docs/research/01-landscape.md`.

| System | GUI | Text file at rest | Diff-friendly *by design* | CLI / headless | The gap |
|---|---|---|---|---|---|
| **openDAW** | ✅ | ❌ zipped binary bundle (`.odb`) | ❌ | ⚠️ internal test harness only, no shipped CLI/SDK | Project is opaque; "headless" isn't a public feature |
| **REAPER** | ✅ | ✅ `.rpp` is text | ⚠️ text but not ID-stable; own practitioners say git "cannot meaningfully diff or merge" it | ⚠️ scripting | Text alone doesn't make diffs meaningful |
| **Ableton `.als`** | ✅ | ⚠️ gzipped XML, **not confirmed cleanly human-readable even decompressed** | ❌ needs bolt-on decompress hooks (`maxdiff`, Automator scripts) | ❌ | Text only via external tooling |
| **DAWproject** | ❌ format only | ⚠️ XML inside a ZIP | ⚠️ | ⚠️ library | Interchange format; **explicitly declares "native DAW format" a non-goal** |
| **Strudel / TidalCycles** | ❌ code editor | ✅ | ✅ | ✅ | No GUI editing — the round-trip trap |
| **→ this project** | ✅ | ✅ | ✅ | ✅ | *— occupies the gap —* |

**Corrections from the fully-verified pass** (an earlier draft of this table overstated a few
things):

- ~~".als is gzipped XML, human-readable once decompressed"~~ — **REFUTED** on reverification.
  Don't repeat this; `.als` is not confirmed to be cleanly text-native even decompressed.
- ~~openDAW "ships a headless SDK"~~ — **REFUTED**, and independently corrected by direct source
  reading (§ code archaeology below): there is no separate `opendaw-headless` package. Headless
  capability exists as an internal test/perf harness (`packages/app/wasm/test/`,
  `offline-render.ts`), not a published SDK.
- **NEW, confirmed, high-value evidence**: DAWproject has an **open GitHub issue (#40, filed
  January 2023, still unresolved)** explicitly requesting version-control/diff support — a
  direct, citable demand signal from DAWproject's own community for exactly the gap we're
  targeting. ✅ CONFIRMED, `01-landscape.md`.
- **Confirmed in detail**: musical-diff tooling for DAW projects exists today only as *external
  workarounds bolted onto binary/gzip formats after the fact* — `alsdiff` (OCaml, parses gzip-XML
  `.als`, matches tracks/clips/devices by internal ID, wires into git via `.gitattributes` + a
  `prepare-commit-msg` hook), Ableton's own official `maxdiff`/`textconv` scripts, and
  Automator-based decompression workflows. **None of it is native to a DAW that saves text by
  default.** ✅ CONFIRMED, `01-landscape.md`. (A narrower claim that alsdiff's ID-matching
  specifically *prevents false diffs on rename/reorder* did not survive verification as stated —
  the *mechanism* of ID-based matching is confirmed to exist; the specific causal guarantee is
  not independently confirmed. Treat "match by ID, not position" as the right instinct, backed by
  real precedent, without over-claiming what it guarantees.)
- `musicdiff` (the tool referenced as prior art for "musical diff") is **not DAW-specific** — it
  diffs *notation* (via music21/converter21: MusicXML, Humdrum `**kern`, MEI), explicitly
  detecting *notational* differences (e.g. tied-eighths vs a quarter note count as different, even
  though acoustically identical) rather than only audible ones. Useful design lesson: "diff" for
  music can mean *structural/notational* diff, not just literal text diff. ✅ CONFIRMED,
  `01-landscape.md`.

The sharpest competitor remains **REAPER**: genuinely text, genuinely git-versioned by real
practitioners — but even they say git "cannot meaningfully diff or merge" `.rpp`, because it
lacks stable IDs and canonical ordering. So the differentiator was never "we have a text file" —
it's a format **engineered for clean diffs** (stable IDs, canonical ordering, one event per line)
plus the render→critique loop on top. §4 now has real prior art for exactly this engineering.

### Why now

- **Producers who code already exist** — TidalCycles users making pop music "for almost 10
  years", algorave as an established practice, hybrid Tidal→Ableton MIDI workflows.
  *(`01-landscape.md`, still single-source — this specific research angle was never queued for
  verification in either pass. The harness's own open-questions list flags this explicitly as
  needing a dedicated follow-up.)*
- **Agent-native music tooling is already a category** — `ableton-mcp` (~2.8k stars),
  `ableton-mcp-extended`, `strudel-mcp-server`, `midi-mcp-server`. **But every one of them pokes
  an existing DAW's GUI over a socket.** If the source of truth is already text, the agent edits
  the *file* directly — no live-app puppetry, no desync. *(Also single-source — same caveat as
  above, flagged by the harness as an open question, not refuted.)*

---

## 2. What we inherit from BeatLab

Unchanged from the original draft — this section rests on our own repo, not third-party research,
so nothing here was affected by verification.

- **A serializable project model** — tracks, notes, patterns, patches, automation, arrangement
  live as a plain JS object in a Zustand store. **The crown jewel** — the hard part of "projects
  as code" already works.
- **A synth + FX engine** — subtractive + FM + wavetable oscillators, per-track filter/ADSR,
  3-band EQ, compressor, distortion/bitcrush (reorderable chain), sidechain, reverb/delay sends,
  master limiter + level meter.
- **Editing surfaces** — piano roll, step sequencer, automation lanes, device panel with knobs,
  mobile-responsive.
- **A headless harness** — `scripts/smoke.mjs` already boots the real app in headless Chromium and
  drives the audio engine end-to-end. **The prototype of the CLI renderer**, and now confirmed to
  be the *right* proven pattern (§5).
- **A validator framework** — lesson checkers that inspect project state and return pass/fail with
  specific feedback. **The prototype of the mix-critique "lint" engine.**

---

## 3. Positioning & non-goals

**What this is:** a git-native, agent-native groovebox/production environment for people who code
and produce with AI.

**What this is not** (say no on purpose):

- **A Pro Tools / recorded-audio replacement.** The web stack has hard, confirmed walls there
  (§6). Compete on the niche, not the feature checklist.
- **An in-browser VST/AU host.** Structurally impossible; that's the Tauri tier's job. Web
  plugins = WAM2 only (confirmed real standard, §6).
- **A tool that trusts an AI as the autonomous mix judge.** Confirmed unsafe (§7). Metrics stay in
  the loop.
- **A generator-code layer (for now).** Document-only for v1 (`docs/decisions.md` D1).

---

## 4. The document format (`.beat`)

The keystone — and the section most changed by the new research pass. We now have **real,
decades-old prior art** for a diff-friendly musical text format, not just a from-scratch design.

### The prior art (new: `docs/research/04-format-prior-art.md`, fully verified)

- **Csound `.sco`** ✅ CONFIRMED as the closest existing analog to "one musical event per line,
  literal p-field data, diff-friendly": a line begins with a type character (`i` for
  instrument/note events), followed by space/tab-separated parameter fields — `p1`/`p2`/`p3`
  hardwired to instrument/start-time/duration, `p4+` free-form. Decades-stable, real production
  use. **Validates the line-format instinct directly.**
- **Humdrum `**kern`** ✅ CONFIRMED — and this is the standout finding. It's a pure-ASCII,
  tab-delimited grid: time flows down as rows, **simultaneous parts are tab-separated columns
  (spines)** — directly reusable for representing chords/stacked notes/multi-track alignment as
  diffable text. More importantly: **Humdrum's own spec explicitly names the diff problem** —
  differing-but-musically-equivalent orderings of signifiers within a token cause `diff`/`cmp` to
  falsely report identical files as different — and **prescribes a canonical, fixed signifier
  ordering specifically to prevent this.** This is the only format surveyed whose own
  documentation reasons about text-diff tooling. It's the strongest available precedent for our
  own "deterministic canonical serialization" requirement (`docs/decisions.md` D4) — we're not
  inventing that requirement, Humdrum already discovered and solved the same problem.
- **LilyPond & ABC notation** ✅ CONFIRMED as genuinely git-versioned *at scale in the real
  world*, not just theoretically diffable: the Mutopia Project is 93.6% `.ly` by byte count with
  4,174 real commits (note corrections, version migrations, merged PRs) over time; TheSession-data
  mirrors thesession.org's ABC tune database with ~weekly commits over roughly a decade.
- **SuperCollider Score** ⚠️ CONFIRMED but with an important caution: a Score is *logically* a
  literal timestamped event list (`[[time,[oscCmd]], ...]`) expressible as text, but its **actual
  on-disk format for the synthesis server is binary** (raw OSC + byte-size-prefixed). Undercuts
  its value as text prior art — a cautionary tale: don't let "logically text-shaped in memory"
  substitute for "actually persisted as text." Whether Scores are typically hand-authored vs.
  programmatically generated was **inconclusive** (a claim for the latter was refuted 0-3).
- **ORCA** ✅ CONFIRMED as proof of the extreme end of the design space: a grid of plain ASCII
  characters that *is itself* the running sequencer program, no separate compile/interpret layer.
  Proves the paradigm works. (Refuted: that it does synthesis/production directly — confirmed it
  outputs MIDI/OSC/UDP to *external* tools, i.e. it's sequencing/trigger logic, not a synthesis
  format.)
- **The confirmed gap**: no prior art was found marrying notation-style event representation
  (pitch/rhythm/dynamics) with synthesis/production parameters (filter cutoff, envelope, effects
  automation) in one diff-friendly document. This combination is **genuinely novel ground** — not
  something to copy from elsewhere, something to design carefully.
- No verified evidence either way on tracker-format plain-text serialization or MML — open
  questions, not resolved either direction.

### From code archaeology (`docs/opendaw-notes.md`) — internal model, not the wire format

- Adopt a **graph-of-typed-nodes-with-pointer-fields** mental model internally (openDAW's `Box`/
  `BoxGraph` pattern) — stable UUID per entity, typed/validated references, cascade-delete via
  dependency graph — even though our *serialized* form stays flat readable text.
- **Borrow DAWproject's parameter vocabulary wholesale** (MIT-licensed, safe to copy verbatim):
  `Threshold/Ratio/Attack/Release/Knee/InputGain/OutputGain` for compressor,
  `Band/Freq/Gain/Q/type` for EQ, `time/duration/contentTimeUnit/playStart/loopStart/loopEnd` for
  clips. No reason to invent our own names when a cross-DAW-agreed set already exists.
- **Human-readable slugs over raw UUIDs at the text boundary** — validated *twice independently*:
  DAWproject uses `xs:ID`/`xs:IDREF` human-assignable string IDs; openDAW's own `AddressIdEncoder`
  converts internal UUIDs into short sequential IDs purely for its (secondary) XML export. Keep
  UUIDs canonical internally; mint short, diff-legible identifiers at the serialization boundary.
- **Content-addressed audio, SHA-256-derived** — independently confirmed as openDAW's own approach
  for deduping identical sample files. Validates our existing plan (`docs/format-spec.md`).
- **openDAW's undo system (inverse-update-log, not snapshots)** is a strong candidate to
  reuse conceptually — a captured `Modification{forward, inverse}` object is *already* a computed
  diff, a natural basis for our own `beat diff`/`--dry-run`.
- **openDAW deliberately chose an opaque binary bundle for a reason that doesn't apply to us**: a
  code comment confirms the binary `project.od` format exists so a Rust engine and a TypeScript
  engine can byte-checksum each other — a cross-language-parity requirement, not a rejection of
  diff-friendliness. **No design doc anywhere argues against text.** This is the strongest single
  piece of evidence that nobody has actually tried our approach, not that it doesn't work.

### Format choice — **resolved, not open anymore**

Previously listed as an M0-blocking open question (bespoke line-format vs restricted YAML vs
TOML). **Resolved by the prior-art research**: go with a **bespoke, line-oriented text format**
in the spirit of Csound `.sco` (one event per line, typed statements) combined with Humdrum's
**canonical-ordering discipline** (fixed field order, deterministic serialization, explicitly
designed to defeat the diff-false-positive problem) and **DAWproject's parameter vocabulary**
(borrow field names, don't invent). This beats YAML (foot-guns, no real precedent for musical
diffability) and JSON (noisy diffs, no comments, and openDAW's own `toJSON()` escape hatch proves
the "just use JSON" instinct is a trap unless field names — not numeric keys — are canonical).
See the refined sketch in [`docs/format-spec.md`](docs/format-spec.md).

---

## 5. Architecture

```
        ┌──────────────────────────────────────────────┐
        │                   .beat file                  │  ← source of truth, on disk, in git
        └───────────────┬───────────────────┬───────────┘
                        │                   │
             ┌──────────┴─────────┐   ┌─────┴────────────┐
             │   daemon (Node)    │   │   CLI  (`beat`)  │
             │  owns file, 2-way  │   │ render/inspect/  │
             │  sync, hot-reload  │   │ set/diff/mcp     │
             └──────────┬─────────┘   └─────┬────────────┘
                        │                   │
             ┌──────────┴─────────┐   ┌─────┴────────────┐
             │  UI (React/web)    │   │  render engine   │
             │  piano roll, knobs │   │  headless Chrome │
             └────────────────────┘   │  → node-web-audio│
                                       └──────────────────┘
                     audio backend (swappable):
              web (Tone.js/AudioWorklet)  ──►  Tauri + native audio
```

### The daemon

A browser tab can't own files on disk, so a small local Node daemon does: owns the `.beat` file,
serves the UI, applies GUI edits to the file, watches for external edits. `vim song.beat`
hot-reloads the open GUI; a GUI knob-turn shows up in `git diff`.

### Engine/UI separation — now backed by a proven real-world pattern

`docs/opendaw-notes.md` confirms (by reading the actual source, not describing it) that openDAW's
engine/UI separation is **real and enforced at the package-dependency level**, not just
convention: the engine package has zero React/DOM dependencies, and even *inside the browser* the
UI (main thread) and the audio engine (AudioWorklet) communicate only via a typed RPC layer over
`MessagePort` — never shared objects. **This is exactly why their headless testing is nearly
free** — the test harness just swaps a same-process `MessageChannel` for the real worklet port.
**Adopt this pattern**: make `core`/`engine` a published, typed-interface boundary from day one,
not a "the engine happens not to import React" convention.

### The render path — **de-risked, and now with an exact code recipe**

Two independent working paths:

- **Headless Chromium** (start here) — boots the real app, renders bit-identically to what users
  hear. Already proven by BeatLab's smoke suite.
- **`node-web-audio-api`** (IRCAM) ✅ CONFIRMED, high confidence — Rust Web Audio implementation
  with a Node polyfill running real Tone.js code outside a browser; implements
  `OfflineAudioContext` for faster-than-real-time render. The exact incantation, confirmed by
  reading the actual example file (`examples/tone.js`) during archaeology:
  ```js
  import '#node-web-audio-api-polyfill';   // must be first — patches globalThis
  import * as Tone from 'tone';
  const audioContext = new window.AudioContext();  // from the polyfilled global
  Tone.setContext(audioContext);                    // before creating any Tone nodes
  // ...build the graph, drive Tone.getTransport()...
  process.exit(0);   // Tone.js has no clean Node teardown — plan for this explicitly
  ```
  Note the last line isn't optional color — Tone.js's own maintainers say (per the archaeology
  read) they "don't understand how to properly stop tone.js," so the CLI needs an explicit
  exit/timeout, not a graceful-shutdown expectation.
- ✅ CONFIRMED (high confidence): Tone.js has first-class offline rendering
  (`OfflineContext`/`Tone.Offline()`, wrapping the standard `OfflineAudioContext`,
  `.render()` returns a `Promise<ToneAudioBuffer>`) — not single-source anymore, this is now
  solid.
- Caveat, still standing: `standardized-audio-context` (a Tone.js dependency) doesn't run in
  plain Node — hence the polyfill/Chromium route is required, not incidental.

`beat render project.beat -o mix.wav --stems` is a weeks-not-months task.

### The web-vs-native decision

Audio backend swappable behind the same file + CLI. Ship pure-web for MIDI/synth; plan a Tauri
shell as the "pro audio" tier. See §6.

### MCP server

`beat mcp` exposes CLI operations to an AI agent — the agent edits the file and renders, a
structurally cleaner integration than "puppet the live DAW over a socket" (ableton-mcp et al.).

---

## 6. The web-stack ceiling (why there's a Tauri tier)

Evidence draws a clean line: **the browser is fine for MIDI/synth, hits real walls on recorded
audio.** Several specific claims here were corrected on full verification — the *direction* holds,
several *specific numbers/quotes* don't.

| Subsystem | Pure web (AudioWorklet + WASM) | Fallback |
|---|---|---|
| Synth / MIDI / sequencing | ✅ ships today (openDAW: 27 devices; per archaeology it does have an experimental parallel Rust/WASM engine with parity tests, just not the *default* shipped one) | — |
| Stock FX (EQ/comp/reverb) | ✅ WASM DSP via Emscripten (C/C++/Faust) — CONFIRMED, high confidence | — |
| Third-party plugins | ⚠️ WAM2 only — CONFIRMED real, MIT-licensed, peer-reviewed standard | Tauri → native CLAP/VST3 |
| Audio recording latency | ❌ ~30 ms floor (CONFIRMED, high confidence) vs ~10 ms target | native audio needs Tauri |
| Latency compensation | ⚠️ magnitude of the gap confirmed; the *specific mechanism* (which API fails to expose what) is **not** independently confirmed — treat as "still a real gap, cause not fully pinned down" | native driver reports true latency |
| Warping / time-stretch | ⚠️ WASM libs, unproven at quality | Rubber Band / signalsmith (WASM or native) |
| Multicore audio | ⚠️ multi-graph + SharedArrayBuffer ring buffers (medium confidence — Adenot's recommendation) | native threads |

✅ **Confirmed, high confidence** (`02-web-stack-feasibility.md`):

- Browser DAWs floor around **~30 ms round-trip** vs a **~10 ms** native target (Soundtrap/W3C
  workshop data, 2021 — flagged by the report itself as now 5 years old; whether it's narrowed by
  2026 is an open question, not confirmed either way).
- **AudioWorklet is the sole real-time-thread entrypoint** in browsers — the mandatory foundation
  for any professional-grade web DAW engine.
- **WAM2** (Web Audio Modules 2.0) is a real, MIT-licensed, peer-reviewed plugin/host standard —
  C/C++/FAUST/Csound DSP compiles to WASM and hosts as instruments/effects/MIDI processors.
  Deliberately bypasses the native `AudioParam` automation API (too heavy for hundreds of
  WASM-resident parameters) in favor of its own `WamParameter` API.
- **Emscripten's Wasm Audio Worklets** let compiled C/C++/Rust DSP run directly on the real-time
  audio thread, with glue code engineered to generate **zero JS garbage** (no GC-pause risk from
  that layer).
- **Two independent working proofs-of-concept** confirm a professional-adjacent web DAW is
  buildable on standardized browser APIs today: WAM Studio (2023, peer-reviewed, explicitly framed
  by its own authors as a "technology demonstrator," not production software) and openDAW.

**Corrections — these specific claims did NOT survive verification, don't repeat them:**

- ~~"Live 12.3 added Bounce Track in Place... pre-mixer/post-FX signal-path semantics"~~ —
  **REFUTED.** Drop the specific bounce/freeze semantics claim; Live 12's actual bounce behavior
  needs separate sourcing if we want to cite it.
- ~~"MediaStreamSourceNode adds latency that is 'not exposed anywhere'"~~ — **REFUTED** as the
  *specific mechanism*. The ~30ms-vs-10ms *magnitude* is still solid; the *why* is not.
- ~~"The WAM-studio authors name the sandbox and latency compensation as their hardest
  problems"~~ — **REFUTED** as a direct quote/attribution. Don't cite this specific claim.
- ~~openDAW's specific 2026-quarter roadmap dates (fades Q1, tempo-automation Q1-Q2, warping Q4,
  1.0 in Q3)~~ — **REFUTED**, and independently the "headless SDK" framing this sat alongside was
  also wrong per direct source reading. openDAW *does* have several recorded-audio-adjacent
  features still pending (confirmed generally by the archaeology pass reading its actual roadmap
  docs), just don't cite specific committed dates.

⚠️ **Confirmed gap, not resolved by either research pass**: **zero surviving evidence** on engine
architecture prior art — tracktion_engine, Ardour, Reaper's own architecture write-ups, Zrythm,
LMMS — and **zero surviving evidence** on WASM-portable DSP library specifics (Rubber Band,
signalsmith-stretch, EQ/compression/reverb/LUFS-metering libraries). Both were explicit original
research questions; both came back empty after adversarial verification, twice. **This is a real,
acknowledged blind spot**, not something quietly glossed over — a dedicated research pass on
"open-source DAW engine architecture" would need to happen before M4 engine decisions get made.

**Conclusion (holds):** the toy/serious line is drawn by the *backend*, not the file format. Ship
the web tier; the Tauri tier is what makes "not a toy" true for recorded audio.

---

## 7. The AI-listening subsystem

The differentiating feature you asked for. Research **strongly confirms the core architectural
conclusion** (metrics-first, LLM narrates) but several of the *specific statistics* originally
cited to justify it were refuted on full verification. The conclusion survives on what's actually
confirmed — which is still plenty.

### The reality check — confirmed at high confidence, with corrected specifics

✅ **Confirmed, high confidence** (`03-ai-listening.md`):

- Standardized benchmarks now exist (MuChoMusic: 1,187 human-validated questions; CMI-Bench: 11
  open audio-LLMs across 14 MIR tasks; MMAU: 10,000-clip multi-task benchmark) and **all
  consistently find open audio-LLMs fall significantly short of task-specific supervised MIR
  systems.**
- **Text-prior bias is real and severe**: when audio is replaced with noise or the wrong track,
  most evaluated models (MU-LLaMA, MusiLingo, M2UGen, some SALMONN tests) show **little to no
  performance degradation** — meaning they're answering from language priors, not actually
  listening. (Only SALMONN and Qwen-Audio showed a significant drop in the specific test that
  measured this.)
- **Errors are dominated by mis-hearing, not mis-reasoning**: MMAU's error analysis attributes
  **55% of Qwen2-Audio-Instruct's errors and 64% of Gemini Pro v1.5's errors to perception**
  (vs. only 18%/11% to reasoning). Consistent with this: layering symbolic reasoning on top of
  audio-LLM perception (LogicLM-style pipelines) **collapses when the audio front-end mis-hears**
  — reasoning cannot compensate for bad ears.
- **Audio-LLMs cannot produce calibrated numeric judgments**: on arousal/valence emotion
  regression, every one of 11 evaluated models scored worse than or barely at the level of
  predicting the dataset mean (R² from −1.17 to 0.08) — **a direct concern for any design that
  expects an LLM to output numeric mix scores.**
- Among tested models, **Qwen-Audio** was consistently strongest (80% GTZAN genre accuracy, best
  captioning ROUGE), but a survey of 8 such models found they're "mostly lightly fine-tuned
  general LLMs lacking professional musical knowledge," and — importantly — **none were evaluated
  on mixing, mastering, loudness, EQ, or any production-quality task.**

⚠️ **The single most important epistemic caveat, straight from the verified report**: *"No claim
in this evidence set directly benchmarks any audio-LLM on actual mix-critique tasks (masking
detection, frequency-conflict identification, loudness/dynamics judgment, stereo-field
assessment) — every finding here is inferred from adjacent evidence."* The "audio-LLMs are bad
ears for mix critique" conclusion is a **reasonable, well-evidenced inference** from general
music-understanding failures — not a direct test of the specific task we care about. That
inference is strong enough to justify the metrics-first architecture below, but it's an
inference, and we should say so if anyone asks.

**Corrections — these specific numbers were refuted, do not reuse them:**

- ~~"Best models score ~52% on MMAU vs 82% human; music is their single weakest domain"~~ —
  **REFUTED.** The general finding that audio-LLMs underperform on music specifically may still be
  true, but this specific headline stat did not survive reverification.
- ~~"Chord-ID accuracy drops to 6-53% from audio vs 97-100% from MIDI; syncopation counting
  25-65% vs 95-100%"~~ — **REFUTED.**
- ~~"Beat/downbeat tracking F-measures near zero; melody extraction below 1%; lyrics WER
  96-2311"~~ — **REFUTED.**
- ~~"Gemini models score 95-100% on MIDI/symbolic input, drop 30-70+ points on raw audio"~~ —
  **REFUTED.**
- Treat the *direction* of all four (fine-grained/time-localized listening is weak; symbolic vs.
  audio input shows a real gap) as plausible but not established by this evidence set.

### The architecture that works: measure first, model second

```
   render ──► [1] DSP METRICS  ──► [2] LEARNED AUTO-MIX ──► [3] LLM NARRATOR ──► diff ──► apply?
              (ground truth)       (interpretable params)   (explains + proposes)   (user/agent accepts)
                    ▲                                                                     │
                    └─────────────────────────── re-render, re-measure ◄─────────────────┘
```

1. **Guardrail layer — deterministic DSP (source of truth).** LUFS / true-peak / crest factor
   (EBU R128), per-band spectral balance vs a reference, cross-stem masking, stereo width. Cheap,
   exact, no hallucination.
2. **Action layer — learned but interpretable.** ✅ CONFIRMED, high confidence: automatic-mixing
   research splits into direct audio-to-audio (black box) vs. **parameter-estimation systems**
   that predict settings for a differentiable console of standard effects — the latter produces
   human-interpretable, `.beat`-mappable output, which is exactly the shape we need.
   - **Diff-MST** (ISMIR 2024) ✅ CONFIRMED — a working, peer-reviewed mixing-style-transfer
     system: given a reference song, it predicts control parameters (per-track gain/EQ/comp/pan
     **plus master-bus EQ/DRC**) via a transformer controller trained with an audio-production
     style loss. **New, notable detail**: it has already been integrated as an adjustable-parameter
     plugin inside a real DAW (Cubase, via a follow-up "Diff-MSTC" prototype) — real precedent for
     shipping this class of tool inside an actual DAW, not just as a research demo.
   - **automix-toolkit** (Apache-2.0) implements both architectures with pretrained checkpoints
     usable for inference today. **Scope correction from direct code reading**
     (`docs/opendaw-notes.md`): its actual Differentiable Mixing Console model
     (`automix/models/dmc.py`) predicts **only 2 parameters per stem — gain and pan** (proper
     equal-power panning, not linear) — not a rich EQ/comp vector. Don't over-scope our own
     mix-critique ambitions around "DMC already does EQ-aware critique" — the honest baseline
     from the reference implementation is loudness balance + stereo placement. Diff-MST (above)
     is the more ambitious system if we want EQ/comp in scope.
3. **Language layer — the LLM narrates, never judges alone.** Turns metric deltas into readable
   suggestions and a concrete diff. The number is real; the model explains and proposes.

**New, relevant to local-first/WASM goals**: ✅ CONFIRMED, medium confidence — **TinyMU** (229M
params, ICASSP 2026) reaches 82% of a much larger SOTA model's performance on MuChoMusic while
being 35x smaller, well ahead of older dedicated music-LLMs. Small audio-language models capable
of on-device deployment are becoming real — relevant if we ever want a local narration layer
rather than an API call, though still short of frontier performance.

This is the BeatLab validator idea grown up: **"check my mix against a target"** instead of
**"check my work against a lesson."**

---

## 8. Milestones

Unchanged in structure — the research corrected *content* within milestones, not the sequencing.

### M0 — Extract & format *(the keystone)*
- [ ] Split the BeatLab repo into `core` (document model), `engine` (Tone.js), `ui` (React).
- [ ] Design and freeze v0 of the `.beat` format: Csound-style one-event-per-line statements +
      Humdrum-style canonical field ordering + DAWproject vocabulary for device/parameter names +
      human slugs at the text boundary over raw UUIDs.
- [ ] Property-test round-trip (serialize→parse→serialize = identity) in CI.
- [ ] Load/save `.beat` from the existing store. **Exit criteria:** the current BeatLab sandbox
      saves and reloads as a `.beat` file with zero state loss.

### M1 — Files on disk + daemon
- [ ] Node daemon owns the file, serves the UI, two-way sync + hot-reload, engine/UI split as a
      published typed-interface boundary (openDAW pattern).
- [ ] **Exit criteria:** edit a note in the GUI → see a one-line diff; edit the file → see the
      note move in the GUI.

### M2 — CLI + headless render
- [ ] `beat render` (headless Chromium first, `node-web-audio-api` for speed once validated
      against it), `beat inspect`, `beat set`, `beat diff` (semantic/musical).
- [ ] **Exit criteria:** render a project to WAV from the command line with no GUI open; a
      `beat diff` between two commits reads like an edit list.

### M3 — Agent-native + the listening loop
- [ ] `beat mcp` server over the CLI ops.
- [ ] Metrics engine (LUFS/true-peak/crest/spectral-balance/masking) — the guardrail layer.
- [ ] Metric-grounded AI critique delivered as project diffs; opt-in "mix lint rules."
- [ ] Real arrangement timeline (arbitrary length, tempo/time-sig changes) — biggest pure-eng lift.
- [ ] **Exit criteria:** Claude, given only the repo + MCP, can render a project, read its
      metrics, and propose an accepted-or-rejected diff that measurably moves LUFS toward a target.

### M4 — The "not a toy" / parity push *(Tauri native tier)*
- [ ] Tauri shell: native-latency recording, latency compensation, CLAP/VST3 hosting.
- [ ] Warping / time-stretch (Rubber Band or signalsmith; WASM in web, native in Tauri).
- [ ] Comping, audio-region editing, freeze/flatten/bounce with defined signal-path semantics
      (needs fresh sourcing — the Live 12.3 bounce-semantics claim we'd have copied was refuted).
- [ ] Learned auto-mix (Diff-MST — real DAW-integration precedent exists — or DMC for a
      gain/pan-only baseline) producing parameter suggestions.
- [ ] Modulation system (Bitwig-style modulators), macro racks, MPE, note probability.
- [ ] **Precondition:** run the dedicated engine-architecture research pass this roadmap flags as
      missing (tracktion_engine, Ardour, Reaper, Zrythm) before committing to an engine design here.

---

## 9. Feature inventory (tiered)

| Tier | Features |
|---|---|
| **MVP** | Synths + sampler + FX chains (inherited); piano roll / step seq / automation; `.beat` format; daemon + 2-way sync; `render`/`inspect`/`set`/`diff` CLI |
| **v1** | MCP server; DSP metrics engine; metric-grounded AI critique as diffs; real arrangement timeline; tempo/time-sig changes |
| **Parity** | Native recording + latency comp (Tauri); warping/time-stretch; comping; plugin hosting (CLAP/VST3); freeze/flatten/bounce; modulators + macro racks; MPE; note probability; browser/preset library; LUFS-normalized export |
| **Out of scope** | In-browser VST/AU hosting; recorded-audio parity with Pro Tools; autonomous AI mix judge without metric guardrails; generator-code layer (deferred, not cancelled) |

*(This section still rests on thin, largely single-vendor evidence — the tech-spec research found
zero surviving claims on Bitwig/FL Studio/Reaper/Logic feature specifics or forum/survey evidence
on which features are make-or-break. Treat the tier assignments as reasonable defaults, not
research-backed rankings.)*

---

## 10. Top risks (ranked)

1. **Audio-LLM hallucination on mix judgments** — *high.* Confirmed at high confidence (text-prior
   bias, perception-dominated errors, no calibrated numeric output) even after several specific
   supporting statistics were refuted — the underlying risk is real and well-evidenced on its own
   surviving merits. Mitigation: DSP metrics are ground truth, model narrates, never sole judge.
   Remember also: **no benchmark has directly tested mix-critique tasks** — treat our own
   architecture as a precaution against a well-evidenced adjacent risk, not a response to a
   directly proven one. (§7)
2. **Recording latency & compensation on the web** — *high.* Magnitude confirmed (~30ms vs
   ~10ms); the specific mechanism is not, so treat the underlying *cause* as still somewhat open.
   Mitigation unchanged: Tauri native tier. (§6)
3. **Format churn as features deepen** — *high.* Now better mitigated than before: we have real
   prior art (Humdrum's canonical-ordering discipline, DAWproject's vocabulary) rather than a
   from-scratch guess. Still version the schema from commit one. (§4)
4. **GUI↔file round-trip fidelity** — *med.* Property-based round-trip tests in CI from the start.
5. **Scope: "Ableton parity" is a decade for a team** — *med.* Mitigation: win the niche, treat
   parity as a direction not a milestone. Underscored by the confirmed finding that we have *zero*
   verified evidence on engine architecture or DSP library portability — parity work can't even be
   properly scoped yet.
6. **Node/browser audio divergence** — *med, more confidently understood now.* `node-web-audio-api`
   is confirmed to run real Tone.js code; the exact wiring pattern is documented (§5). Still keep
   headless Chromium as the fidelity-guaranteed reference.
7. **Learned auto-mix below pro quality** — *med.* Confirmed at "medium" — as of the (2022,
   explicitly dated) ISMIR tutorial, deep-learning automix still trails professional engineers,
   and no 2024-2026 source in this research closes that gap. Mitigation unchanged: ship as
   accept/reject diffs, never silent auto-apply.
8. **Competitive: the MCP-DAW category is already forming** — *med.* A dozen Ableton MCP servers
   exist, puppeting live DAWs. **New evidence sharpens the timing risk**: DAWproject's own
   community has an *open, unresolved* GitHub issue (#40) asking for exactly the diff/version-control
   support we're building — meaning the demand is visible and could attract a competing effort.
   Our moat only holds if the format is genuinely better to edit than poking a live app, which
   makes Risk #4 doubly load-bearing.
9. **Engine-architecture blind spot** — *med, new.* Two independent, fully-verified research
   passes both came back with **zero surviving evidence** on tracktion_engine, Ardour, Reaper's
   architecture, Zrythm, or LMMS — an explicit original research question, answered both times by
   silence after adversarial verification. M4's engine decisions should not be made without a
   dedicated follow-up pass on this specifically.

---

## 11. Open questions (need a decision)

- **Name.** `beatlab-daw` is a placeholder.
- ~~Format syntax~~ — **resolved**, see §4: bespoke line-oriented, Csound/Humdrum/DAWproject-informed.
- **License.** MIT keeps the door open to reusing DAWproject's/automix-toolkit's schemas/code
  (both permissively licensed). Reminder: openDAW itself is **AGPL v3/LGPL** — fine to learn from,
  not to copy code from verbatim.
- **Relationship to BeatLab.** Hard fork, or does BeatLab become the "learn" mode inside this?
- **Web-first vs Tauri-first.** Ship the web tier alone first, or build Tauri earlier?
- **New, from this research round**: should we run a dedicated follow-up pass on (a) engine
  architecture (tracktion_engine/Ardour/Reaper/Zrythm — zero coverage twice now), (b) live-coding
  language comparison (Strudel/Tidal/Sonic Pi/Glicol — zero coverage twice now, despite being an
  explicit original research question both times), and (c) direct demand-signal/survey evidence
  (producers-who-code market signals, feature make-or-break data)? All three are honest,
  acknowledged gaps, not just unwritten sections.

---

## Naming

`beatlab-daw` is a working directory name only. Decide before M0 ships publicly.

---

## References

- [`docs/research/01-landscape.md`](docs/research/01-landscape.md) — prior art, empty quadrant
  (21 confirmed, 4 refuted, 23 sources)
- [`docs/research/02-web-stack-feasibility.md`](docs/research/02-web-stack-feasibility.md) —
  feature surface + web feasibility ceiling (17 confirmed, 8 refuted, 23 sources)
- [`docs/research/03-ai-listening.md`](docs/research/03-ai-listening.md) — AI listening, auto-mix,
  the critique loop (19 confirmed, 6 refuted, 24 sources)
- [`docs/research/04-format-prior-art.md`](docs/research/04-format-prior-art.md) — text-based
  music format prior art for `.beat` (22 confirmed, 3 refuted, 24 sources)
- [`docs/opendaw-notes.md`](docs/opendaw-notes.md) — source-code archaeology (openDAW, DAWproject,
  automix-toolkit, node-web-audio-api) — direct reading, not web search
- [`docs/research-summary.html`](docs/research-summary.html) — visual synthesis (**predates this
  update** — reflects the pre-verification single-source draft; treat this roadmap as current)
- [`docs/decisions.md`](docs/decisions.md) — key design decisions & rationale
- [`docs/format-spec.md`](docs/format-spec.md) — `.beat` format sketch, updated with Csound/Humdrum
  lessons
- [`docs/architecture.md`](docs/architecture.md) — component architecture detail

> **Verification status**: all four deep-research passes are now fully adversarially verified
> (zero infrastructure errors on the final run; every queued claim resolved to confirmed or
> refuted). Three specific areas remain genuinely under-researched even after two full attempts —
> engine architecture, live-coding-language comparison, and demand-signal/survey data — flagged
> throughout rather than papered over. This roadmap is safe to treat as a real spec for the areas
> it does cover; the three gaps above need a dedicated follow-up before being treated as settled.
