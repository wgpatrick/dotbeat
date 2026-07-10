# Roadmap — a git-native DAW

> **Working name:** `beatlab-daw` (placeholder — see [Naming](#naming)).
> **One line:** a real GUI DAW whose project file is diff-friendly text, driveable from a
> CLI, and editable by an AI agent — with sound-design critique built into the core.

This roadmap is grounded in three deep-research passes archived under
[`docs/research/`](docs/research/). Claims are tagged there as `VERIFIED` (survived adversarial
verification) or `SINGLE-SOURCE` (quoted from a primary source but not yet triangulated, because
the verification stage was rate-limited mid-run). Where a decision leans on an unverified claim,
this document says so. **Re-run verification before treating any single-source claim as settled.**

---

## 1. The thesis

Three properties, held simultaneously, that no shipping tool currently combines well:

1. **A real GUI** — piano roll, knobs, mixer, step sequencer. Not a code editor with a
   visualizer bolted on.
2. **Text project files, diff-friendly by design** — the working file *is* human-readable,
   git-diffable text. Not an export, not a zip you decompress with a hook.
3. **Full CLI + agent access** — render to WAV/stems, inspect, mutate, and *musically* diff a
   project from the command line; an MCP server exposes the same operations to an AI agent.

### Is the quadrant actually empty? (honest version)

Mostly — but not perfectly, and the nuance is the whole strategy.

| System | GUI | Text file at rest | Diff-friendly *by design* | CLI / headless | The gap |
|---|---|---|---|---|---|
| **openDAW** | ✅ | ❌ zipped bundle (jszip) | ❌ | ✅ headless SDK | Project is a binary bundle |
| **REAPER** | ✅ | ✅ `.rpp` is text | ⚠️ text but "opaque", no semantic diff | ⚠️ scripting | People git it, but git can't meaningfully diff/merge it |
| **Ableton `.als`** | ✅ | ⚠️ gzipped XML | ❌ needs bolt-on decompress hooks | ❌ | Text only after external tooling |
| **DAWproject** | ❌ format only | ⚠️ XML inside a ZIP | ⚠️ | ⚠️ library | Interchange format, not a working file |
| **Strudel / TidalCycles** | ❌ code editor | ✅ | ✅ | ✅ | No GUI editing — the round-trip trap |
| **→ this project** | ✅ | ✅ | ✅ | ✅ | *— occupies the gap —* |

The sharpest competitor is **REAPER**: its `.rpp` is genuinely text, and there's a real
community versioning it in git (one cited source: 376-star `git`-with-Reaper tooling, plus
practitioner write-ups). But even those practitioners "treat DAW project files as opaque to
version control" and say "git cannot meaningfully diff or merge them." So the differentiator is
**not** "we have a text file" — REAPER has that. It's:

- a format **engineered for clean diffs** (stable IDs, one-musical-event-per-line, canonical
  ordering) so a knob-turn is a one-line diff, and
- a **first-class musical diff + the render→listen→critique loop** on top.

*(REAPER-as-text and the git-with-Reaper demand signal: `docs/research/01-landscape.md`,
claims ~89–92, SINGLE-SOURCE.)*

### Why now

Two demand signals, both stronger than expected in the research:

- **Producers who code already exist.** TidalCycles users making pop music "for almost 10
  years", algorave as an established practice, people routing Tidal→Ableton over MIDI for a
  hybrid code+GUI workflow. *(`01-landscape.md`, SINGLE-SOURCE.)*
- **Agent-native music tooling is already a category.** `ableton-mcp` (~2.8k stars),
  `ableton-mcp-extended`, `strudel-mcp-server`, `midi-mcp-server`, and "at least a dozen
  derivative" Ableton MCP servers exist as of 2025–26. **But every one of them pokes an existing
  DAW's GUI over a socket.** Our bet: if the DAW's source of truth is already text, the agent
  edits the *file* directly and renders it — no live-app puppetry, no desync. That's a
  structurally better substrate for AI production, and nobody occupies it.
  *(`01-landscape.md`, SINGLE-SOURCE.)*

---

## 2. What we inherit from BeatLab

The fork starts from a working, deployed, ~4,800-line React + TypeScript + Tone.js DAW-like app
(`wgpatrick/beatlab`). It already provides:

- **A serializable project model** — tracks, notes, patterns, patches, automation, arrangement
  live as a plain JS object in a Zustand store. This is 90% of a text file format, minus the
  file on disk. **This is the crown jewel** — the hard part of "projects as code" already works.
- **A synth + FX engine** — subtractive + FM + wavetable oscillators, per-track filter/ADSR,
  3-band EQ, compressor, distortion/bitcrush (reorderable chain), sidechain, reverb/delay sends,
  a master limiter + level meter.
- **Editing surfaces** — piano roll, step sequencer, automation lanes, device panel with knobs,
  now mobile-responsive.
- **A headless harness** — the `scripts/smoke.mjs` suite already boots the real app in headless
  Chromium and drives the audio engine end-to-end. **This is the prototype of the CLI renderer.**
- **A validator framework** — lesson checkers that inspect project state and return pass/fail
  with specific feedback. **This is the prototype of the mix-critique "lint" engine.**

Everything below is about growing these seeds into a real tool.

---

## 3. Positioning & non-goals

**What this is:** a git-native, agent-native groovebox/production environment for people who
code and produce with AI. The whole product is "your song is a text file you (and Claude) can
edit, render, diff, and critique."

**What this is not** (say no on purpose):

- **A Pro Tools / recorded-audio replacement.** Winning DAW-parity on recorded-audio workflows
  is a decade of work for a team, and the web stack has hard walls there (§6). Compete on the
  niche, not the feature checklist.
- **An in-browser VST/AU host.** Structurally impossible in a browser; that's the Tauri tier's
  job (§5). Web plugins = WAM2 only.
- **A tool that trusts an AI as the autonomous mix judge.** The research forbids it (§7). Metrics
  stay in the loop.
- **A generator-code layer (for now).** We chose *document-only* for v1 — the file is literal
  data, the GUI edits it losslessly, no code-that-generates-clips. The two-layer model
  (see [`docs/decisions.md`](docs/decisions.md)) stays on the shelf until the document format is
  proven.

---

## 4. The document format (`.beat`)

The keystone. Everything else hangs off getting this right.

### Design principles (each traceable to research)

- **Literal data, not code.** Every note, every knob value stated. No loops, no functions. The
  GUI reads and writes this losslessly, so every GUI edit has an obvious place to land.
- **Diff-friendly by construction:**
  - **Stable IDs on every entity** (track / clip / note / device). Match by ID, never by
    position — the single most important lesson from `alsdiff`, so a rename or reorder doesn't
    explode the diff. *(`01-landscape.md`, alsdiff, SINGLE-SOURCE.)*
  - **One musical event per line**, canonical field order, canonical sort — so a moved note is a
    one-line diff a human can read.
  - **Deterministic serialization** — serialize→parse→serialize must be the identity function
    (enforced by property tests in CI from day one).
- **Content-addressed audio.** Samples referenced by hash, stored in a sidecar `media/`
  directory (git-LFS-friendly), never inline. Keeps the text file text and makes projects
  portable. *(Pattern drawn from git-with-Reaper LFS practice + DAWproject's ZIP-of-refs model.)*
- **Versioned schema from commit one.** A format that's clean at MVP will calcify against
  timelines, warping, and automation curves later (Risk #3). Borrow vocabulary from **DAWproject**
  (Bitwig, MIT-licensed XML schema, shipping in Studio One / Cubase / Bitwig) and tracktion's
  `.tracktionedit` rather than inventing from scratch. *(`01/02`, SINGLE-SOURCE.)*

### Format choice — open question

TOML-ish / a restricted YAML / a bespoke line format? Leaning **bespoke line-oriented text**
(maximally diff-legible) with a strict serializer, over YAML (foot-guns) or JSON (noisy diffs,
no comments). To be decided in M0 — see [`docs/format-spec.md`](docs/format-spec.md) for the
current sketch.

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

A browser tab can't own files on disk, so a small local Node daemon does: it owns the `.beat`
file, serves the UI, applies GUI edits to the file, and watches for external edits. Result:
`vim song.beat` hot-reloads the open GUI, and a GUI knob-turn shows up in `git diff`. This is the
mechanism that makes "GUI and text file are the same thing" true rather than aspirational.

### The render path — **already de-risked** ✅

Two independent working paths, both confirmed in research:

- **Headless Chromium** (start here) — boots the real app, renders bit-identically to what users
  hear. Already proven by BeatLab's smoke suite.
- **`node-web-audio-api`** (IRCAM) — Rust Web Audio impl with a Node polyfill that runs Tone.js
  headlessly; ships a working `examples/tone.js` and implements `OfflineAudioContext` for
  faster-than-real-time render. Migrate hot paths here for speed once it matters.
  *(`01-landscape.md`, SINGLE-SOURCE. Caveat: `standardized-audio-context`, a Tone dependency,
  doesn't run in plain Node — hence the polyfill/Chromium route.)*

`beat render project.beat -o mix.wav --stems` is a weeks-not-months task.

### The web-vs-native decision

The audio backend is **swappable behind the same file + CLI**. Ship pure-web for the MIDI/synth
DAW; plan a **Tauri shell as the "pro audio" tier** for native-latency recording, real plugin
hosting, and native time-stretch. The document format and CLI are the constant. See §6 for why
this split is forced by the web platform's ceiling.

### MCP server

`beat mcp` exposes the CLI operations to an AI agent. Because the source of truth is text, the
agent edits the file and renders — a structurally cleaner integration than the existing
"puppet the live DAW over a socket" MCP servers (ableton-mcp et al.).

---

## 6. The web-stack ceiling (why there's a Tauri tier)

The "not a toy" question. The evidence draws a clean line: **the browser is fine for a
MIDI-and-synth DAW, and hits real walls on recorded-audio production.**

| Subsystem | Pure web (AudioWorklet + WASM) | Fallback |
|---|---|---|
| Synth / MIDI / sequencing | ✅ ships today (openDAW: 27 devices, no WASM core yet) | — |
| Stock FX (EQ/comp/reverb) | ✅ WASM DSP via Emscripten (C/C++/Faust) | — |
| Third-party plugins | ⚠️ WAM2 only | Tauri → native CLAP/VST3 |
| Audio recording latency | ❌ ~30 ms floor | native audio (~10 ms) needs Tauri |
| Latency compensation | ❌ APIs don't expose pipeline latency | native driver reports true latency |
| Warping / time-stretch | ⚠️ WASM libs, unproven at quality | Rubber Band / signalsmith (WASM or native) |
| Multicore audio | ⚠️ multi-graph + SharedArrayBuffer ring buffers | native threads |

Load-bearing evidence *(all `02-web-stack-feasibility.md`, SINGLE-SOURCE — W3C workshop + ACM
papers + openDAW roadmap)*:

- Browser DAWs floor around **~30 ms round-trip** where native needs **~10 ms**.
- Recording-latency compensation is **structurally blocked** — `MediaStreamSourceNode` latency
  "is not exposed anywhere."
- The **WAM-studio** authors (who shipped a full browser DAW) name the sandbox and latency
  compensation as their hardest problems — explicitly *not* raw DSP power.
- **openDAW's own roadmap** is the tell: it shipped a 27-device multitrack DAW, but audio fades,
  tempo-map automation, and pitch/stretch are all still 2026 roadmap items — precisely the
  recorded-audio features, and they're last for a reason.

**Conclusion:** the toy/serious line is drawn by the *backend*, not the file format. Ship the
web tier; the Tauri tier is what makes "not a toy" true for recorded audio.

---

## 7. The AI-listening subsystem

The differentiating feature you asked for — and the research changes how it must be built.

### The reality check (unusually consistent, unusually sobering)

Today's audio-LLMs are **bad ears**. *(All `03-ai-listening.md`, SINGLE-SOURCE ×5, but the
findings converge across five independent papers.)*

- Best models score **~52%** on expert audio understanding (MMAU) vs **82%** human; **music is
  their single weakest domain**, below speech and environmental sound.
- The dominant error is **perceptual, not reasoning** — 55–64% of errors are the model
  *mis-hearing* the audio.
- Several open models (MU-LLaMA, SALMONN) **barely change their answer when the audio is replaced
  with noise** — they answer from text priors, not by listening.
- Fine-grained, time-localized judgments — exactly *"the lead's attack is masking the kick"* —
  are the **worst-performing** category.

So a naive "render → let an audio-LLM critique → apply" loop, trusted blindly, would confidently
hallucinate problems that aren't there. **Do not build that.**

### The architecture that works: measure first, model second

```
   render ──► [1] DSP METRICS  ──► [2] LEARNED AUTO-MIX ──► [3] LLM NARRATOR ──► diff ──► apply?
              (ground truth)       (interpretable params)   (explains + proposes)   (user/agent accepts)
                    ▲                                                                     │
                    └─────────────────────────── re-render, re-measure ◄─────────────────┘
```

1. **Guardrail layer — deterministic DSP (source of truth).** LUFS / true-peak / crest factor
   (EBU R128), per-band spectral balance vs a reference track, cross-stem masking metric, stereo
   width. Cheap, exact, no hallucination. This layer alone powers commercial assistants
   (iZotope, Sonible).
2. **Action layer — learned but *interpretable*.** Prefer systems that predict effect
   **parameters, not black-box audio**. **Diff-MST** (ISMIR 2024) and the Apache-2.0
   **automix-toolkit**'s Differentiable Mixing Console infer a mix from a reference and output
   human-adjustable EQ/comp/gain — which map straight onto `.beat` fields.
   *(`03-ai-listening.md`, SINGLE-SOURCE.)*
3. **Language layer — the LLM narrates, never judges alone.** Turns metric deltas into readable
   suggestions and a concrete diff ("bass is +4 dB in 200–400 Hz vs the reference → cut here").
   The number is real; the model explains it and proposes the edit.

This is the BeatLab validator idea grown up: **"check my mix against a target"** instead of
**"check my work against a lesson."** Every suggestion lands as a reviewable diff — which the
text-native format makes uniquely natural.

---

## 8. Milestones

Sequenced so each milestone ships something whole, and the two hard commitments (native audio,
learned auto-mix) come *after* the format and CLI have proven themselves.

### M0 — Extract & format *(the keystone)*
- [ ] Split the BeatLab repo into `core` (document model), `engine` (Tone.js), `ui` (React).
- [ ] Design and freeze v0 of the `.beat` format (IDs, canonical serialization, media refs).
- [ ] Property-test round-trip (serialize→parse→serialize = identity) in CI.
- [ ] Load/save `.beat` from the existing store. **Exit criteria:** the current BeatLab sandbox
      saves and reloads as a `.beat` file with zero state loss.

### M1 — Files on disk + daemon
- [ ] Node daemon owns the file, serves the UI, two-way sync + hot-reload.
- [ ] `git diff` shows readable musical changes from GUI edits; `vim` edits hot-reload the GUI.
- [ ] **Exit criteria:** edit a note in the GUI → see a one-line diff; edit the file → see the
      note move in the GUI.

### M2 — CLI + headless render
- [ ] `beat render` (headless Chromium → WAV/stems), `beat inspect`, `beat set`, `beat diff`
      (semantic/musical).
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
- [ ] Comping, audio-region editing, freeze/flatten/bounce with defined signal-path semantics.
- [ ] Learned auto-mix (Diff-MST / DMC) producing parameter suggestions.
- [ ] Modulation system (Bitwig-style modulators), macro racks, MPE, note probability.

---

## 9. Feature inventory (tiered)

Condensed from the Ableton/Bitwig/Reaper feature-surface research (`02-web-stack-feasibility.md`).

| Tier | Features |
|---|---|
| **MVP** | Synths + sampler + FX chains (inherited); piano roll / step seq / automation; `.beat` format; daemon + 2-way sync; `render`/`inspect`/`set`/`diff` CLI |
| **v1** | MCP server; DSP metrics engine; metric-grounded AI critique as diffs; real arrangement timeline; tempo/time-sig changes |
| **Parity** | Native recording + latency comp (Tauri); warping/time-stretch; comping; plugin hosting (CLAP/VST3); freeze/flatten/bounce; modulators + macro racks; MPE; note probability; browser/preset library; LUFS-normalized export |
| **Out of scope** | In-browser VST/AU hosting; recorded-audio parity with Pro Tools; autonomous AI mix judge without metric guardrails; generator-code layer (deferred, not cancelled) |

---

## 10. Top risks (ranked)

1. **Audio-LLM hallucination on mix judgments** — *high.* Best-evidenced risk in the whole
   report. Mitigation is architectural: DSP metrics are ground truth, the model narrates. Never
   the sole judge. (§7)
2. **Recording latency & compensation on the web** — *high.* Structurally unsolved in-browser.
   Only mitigation is the Tauri native tier — so "serious recording" is gated behind a second
   runtime from day one of planning. (§6)
3. **Format churn as features deepen** — *high.* A format beautiful at MVP can calcify against
   timelines/warping/automation. Mitigation: version the schema from commit one; study
   DAWproject/tracktionedit *before* locking v1. (§4)
4. **GUI↔file round-trip fidelity** — *med.* Every GUI edit must serialize losslessly and every
   hand-edit must load, or trust collapses. Mitigation: property-based round-trip tests in CI
   from the start.
5. **Scope: "Ableton parity" is a decade for a team** — *med.* Mitigation is the positioning
   itself — win the niche, treat parity as a direction not a milestone.
6. **Node/browser audio divergence** — *med.* `node-web-audio-api` may not render bit-identically
   to the browser. Mitigation: keep headless Chromium as the fidelity-guaranteed path; treat Node
   bindings as a speed optimization validated against it.
7. **Learned auto-mix below pro quality** — *med.* Even the best deep-learning mixers trail human
   engineers. Mitigation: ship as accept/reject suggestions (diffs), never silent auto-apply.
8. **Competitive: the MCP-DAW category is already forming** — *med, new.* A dozen Ableton MCP
   servers exist. They puppet existing DAWs; our moat is the text-native source of truth. That
   moat only holds if the format genuinely is better to edit than poking a live app — which
   makes Risk #4 (fidelity) doubly load-bearing.

---

## 11. Open questions (need a decision)

- **Name.** `beatlab-daw` is a placeholder. (Product identity, not urgent, but bake-in cost grows.)
- **Format syntax.** Bespoke line-format vs restricted YAML vs TOML. (M0 blocker.)
- **License.** BeatLab's license + which permissive license for the new project (MIT, like
  DAWproject/automix-toolkit, keeps the door open to reusing their schemas/code).
- **Relationship to BeatLab.** Hard fork, or does BeatLab become the "learn" mode inside this?
  (The lesson framework → mix-lint reuse suggests they could share a core.)
- **Web-first vs Tauri-first.** Ship the web tier alone first, or build the Tauri shell earlier
  to make "not a toy" true sooner? (Trades reach for depth.)

---

## Naming

`beatlab-daw` is a working directory name only. Candidate directions once chosen: something that
signals *text/plain* + *sound*. Decide before M0 ships publicly.

---

## References

- [`docs/research/01-landscape.md`](docs/research/01-landscape.md) — prior art, empty quadrant,
  demand signals, MCP tools (113 claims, 23 sources)
- [`docs/research/02-web-stack-feasibility.md`](docs/research/02-web-stack-feasibility.md) —
  feature surface + web feasibility ceiling (115 claims, 23 sources)
- [`docs/research/03-ai-listening.md`](docs/research/03-ai-listening.md) — AI listening,
  auto-mix, the critique loop (119 claims, 24 sources)
- [`docs/research-summary.html`](docs/research-summary.html) — visual one-page synthesis
- [`docs/decisions.md`](docs/decisions.md) — key design decisions & rationale
- [`docs/format-spec.md`](docs/format-spec.md) — `.beat` format sketch
- [`docs/architecture.md`](docs/architecture.md) — component architecture detail

> **Verification caveat:** most research claims are single-source (the adversarial verification
> stage was rate-limited mid-run). Re-run verification on the load-bearing claims — especially the
> web-latency numbers (§6) and the audio-LLM benchmarks (§7) — before committing engineering to them.
