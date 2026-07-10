# beatlab-daw *(working name)*

> A git-native, agent-native DAW. Your song is a **diff-friendly text file** you — and an AI
> agent — can edit in a real GUI, render from the command line, `git diff`, and get sound-design
> critique on.

This repository holds the research/planning behind the direction, **plus a working Phase 0
prototype** proving the core thesis end-to-end: a real `.beat` text format (parser + serializer +
converter), tested against a real exported BeatLab project, rendered to a real WAV by a `beat
render` CLI that drives the actual [BeatLab](https://github.com/wgpatrick/beatlab) app (a working
Tone.js + React web DAW / production trainer, which this project forks in spirit).

```bash
npm install
npm test                # 21 tests: format round-trips + conversion against real project data
npm run render examples/real-groove.beat -o out.wav --beatlab-dir /path/to/beatlab
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
| [`docs/phase-0-plan.md`](docs/phase-0-plan.md) | **Start here for what's built.** The vertical-slice plan, status COMPLETE, with the actual result. |
| [`ROADMAP.md`](ROADMAP.md) | **Start here for the big picture.** Thesis, format design, architecture, milestones, risks. |
| `src/core/` | The `.beat` format: types, parser, serializer, converter. Pure TS, zero deps on beatlab/React/Tone.js. |
| `test/` | 21 tests — format round-trips (synthetic + property-style) and conversion fidelity against a real exported project (`test/fixtures/`). |
| `cli/render.mjs` | `beat render` — drives the real BeatLab app in headless Chromium to render a `.beat` file to a WAV. |
| `examples/real-groove.beat` | A real project, converted to `.beat` text — hand-inspectable, the file the CLI's proof run used. |
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

**Phase 0 complete.** The core thesis is proven, not just argued: a hand-inspectable `.beat` file
converted from a real BeatLab project renders to a real WAV via `beat render`, and changing one
synth parameter produces a diff of exactly one line — the specific property the whole project
bets on. See [`docs/phase-0-plan.md`](docs/phase-0-plan.md)'s "Result" section for what this
proved and what it means for scoping M1 (the daemon + two-way file sync) next.
