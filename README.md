# beatlab-daw *(working name)*

> A git-native, agent-native DAW. Your song is a **diff-friendly text file** you — and an AI
> agent — can edit in a real GUI, render from the command line, `git diff`, and get sound-design
> critique on.

This repository holds the research/planning behind the direction, **plus working Phase 0 + 1
code** proving the core loop end-to-end: a real `.beat` text format (parser + serializer +
converter, drums included), a **daemon** that keeps the file and a live GUI in two-way sync
(GUI knob-turn → one-line `git diff` in 262 ms; `vim` edit → GUI hot-reloads in 117 ms, playback
uninterrupted), and a `beat render` CLI that renders the file to a real WAV by driving the
actual [BeatLab](https://github.com/wgpatrick/beatlab) app (a working Tone.js + React web DAW /
production trainer, which this project forks in spirit).

```bash
npm install
npm test                # 36 tests: format round-trips, conversion against real project data, daemon sync
npm run render examples/real-groove.beat -o out.wav --beatlab-dir /path/to/beatlab
node cli/daemon.mjs examples/real-groove.beat   # then open the beatlab dev server with ?daw=8420
```

## The idea in one picture

```
   song.beat  (plain text, in git)
      │
      ├─►  GUI            edit notes/knobs → one-line diffs
      ├─►  CLI            beat render / inspect / set / diff
      ├─►  AI agent       edits the file, renders, critiques, proposes diffs
      └─►  git            branch, diff, merge, review — like code
```

Nobody currently holds all of **GUI + diff-friendly-text-file + CLI/agent** at once — **confirmed**,
not just plausible: openDAW has the GUI and a headless engine but zips its projects into an opaque
binary bundle; REAPER has genuinely text project files but even its own practitioners say git
"cannot meaningfully diff or merge" them; Strudel/Tidal are text-native but have no GUI (the
round-trip trap). This project aims at that gap. See [`ROADMAP.md`](ROADMAP.md) §1 for the full,
now fully-verified version.

## What's here

| Path | What |
|---|---|
| [`docs/phase-1-plan.md`](docs/phase-1-plan.md) | **Start here for what's built.** M1 (daemon + two-way sync), status COMPLETE, with measured latencies. [`docs/phase-0-plan.md`](docs/phase-0-plan.md) is the prior slice (format + render). |
| [`ROADMAP.md`](ROADMAP.md) | **Start here for the big picture.** Thesis, format design, architecture, milestones, risks. |
| `src/core/` | The `.beat` format: types, parser, serializer, converter (synth + drum tracks). Pure TS, zero deps on beatlab/React/Tone.js. |
| `src/daemon/` | The `beat daemon` — owns a `.beat` file, two-way sync with the GUI over a 3-endpoint HTTP/SSE protocol, echo suppression by canonical-text comparison. |
| `test/` | 36 tests — format round-trips, conversion fidelity against a real exported project (`test/fixtures/`), and daemon sync behavior. |
| `cli/render.mjs`, `cli/daemon.mjs` | `beat render` (headless-Chromium render to WAV) and `beat daemon` (file↔GUI sync). |
| `scripts/verify-m1.mjs` | The M1 exit-criteria proof: boots daemon + dev server + browser + git, measures both sync directions. |
| `examples/real-groove.beat` | A real project, converted to `.beat` text — hand-inspectable, the file the proof runs use. |
| [`docs/research/`](docs/research/) | Four deep-research reports (347 raw claims, 70 sources), **all fully adversarially verified**. |
| [`docs/opendaw-notes.md`](docs/opendaw-notes.md) | Source-code archaeology — openDAW/DAWproject/automix-toolkit/node-web-audio-api read directly, not summarized secondhand. |
| [`docs/format-spec.md`](docs/format-spec.md) | The `.beat` format spec — v0 grammar frozen and implemented, grounded in real prior art (Csound, Humdrum, DAWproject). |
| [`docs/architecture.md`](docs/architecture.md) | Component architecture (daemon, engine, CLI, MCP, web/Tauri tiers). |
| [`docs/decisions.md`](docs/decisions.md) | Key design decisions and their rationale, corrected where research findings changed. |
| [`docs/research-summary.html`](docs/research-summary.html) | Visual synthesis — **predates the final verification pass**; `ROADMAP.md` is the current source of truth. |

## The findings that shaped this

1. **The empty quadrant is confirmed, not just plausible.** The fully-verified landscape report's
   own conclusion: *"the evidence positively refutes the idea that this space is already
   filled."* Real, citable demand signal found: DAWproject's own community has an **open,
   unresolved GitHub issue (#40, since Jan 2023)** requesting exactly the diff/version-control
   support we're building. *(`docs/research/01-landscape.md`)*
2. **Real prior art resolves the format-syntax question.** Csound `.sco` is the closest analog to
   our line-per-event design; Humdrum `**kern`'s own spec explicitly names and solves the same
   diff-false-positive problem we're solving; DAWproject's schema gives us real vocabulary to
   borrow. Format style is no longer an open question — see `ROADMAP.md` §4.
   *(`docs/research/04-format-prior-art.md`)*
3. **Web-audio has a confirmed hard ceiling on recorded audio.** ~30ms vs ~10ms round-trip
   latency. Fine for MIDI/synth (which is what BeatLab already is); needs a native (Tauri) tier
   for low-latency recording and plugin hosting. *(`docs/research/02-web-stack-feasibility.md`)*
4. **AI can't be trusted to "hear" a mix — confirmed, with real nuance.** Audio-LLMs show severe
   text-prior bias and perception-dominated errors on general music understanding. Important
   honest caveat carried through: *no benchmark has directly tested mix-critique tasks* — this is
   a well-evidenced inference, not a direct proof, which is exactly why the critique loop is
   architected metrics-first (DSP measurements as ground truth, LLM narrates, never judges alone).
   *(`docs/research/03-ai-listening.md`)*
5. **openDAW itself validates the direction.** Direct source reading found no design rationale
   anywhere for its opaque project-bundle format beyond a cross-language (Rust/TypeScript) parity
   requirement that doesn't apply to us — the strongest evidence yet that diff-friendly text
   hasn't been tried and rejected, just never tried. *(`docs/opendaw-notes.md`)*

## Research provenance

Five research passes: four via a search→fetch→extract→**adversarially-verify** harness (all now
**fully verified**, zero infrastructure errors on the final run — an earlier attempt hit a
rate-limit mid-run and was resumed to completion), plus one **source-code archaeology** pass
(cloning and reading actual repos, not web search). 347 raw claims were extracted across the four
research reports; every claim queued for verification resolved cleanly to confirmed or refuted —
see [`docs/research/README.md`](docs/research/README.md) for the full methodology, including a
worked example of a claim that looked right in early research and was corrected on
reverification. Several specific statistics drafted into an earlier version of `ROADMAP.md` did
**not** survive full verification and have been corrected in place, with the correction visible
inline rather than silently fixed.

## Status

**Phase 0 and Phase 1 (ROADMAP M1) complete.** The core loop is real, not argued: a
hand-inspectable `.beat` file — the *whole* groove, drums included — is the source of truth for
a live GUI session. Turn a knob in the GUI and `git diff` shows exactly one changed line
(262 ms, measured). Edit the file in an editor and the GUI hot-reloads without stopping playback
(117 ms, measured). Add a track that exists only in the file and it appears in the app, a full
74-field synth reconstituted from a 9-field text patch. The same apply path drives `beat render`
to a real WAV. See [`docs/phase-1-plan.md`](docs/phase-1-plan.md)'s "Result" for the numbers and
what they mean for M2/M3 scoping.
