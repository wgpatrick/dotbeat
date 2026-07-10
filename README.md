# beatlab-daw *(working name)*

> A git-native, agent-native DAW. Your song is a **diff-friendly text file** you — and an AI
> agent — can edit in a real GUI, render from the command line, `git diff`, and get sound-design
> critique on.

This repository is currently a **planning + research workspace**, not yet code. It captures the
direction and the deep research behind it, forked in spirit from
[BeatLab](https://github.com/wgpatrick/beatlab) (a working Tone.js + React web DAW / production
trainer).

## The idea in one picture

```
   song.beat  (plain text, in git)
      │
      ├─►  GUI            edit notes/knobs → one-line diffs
      ├─►  CLI            beat render / inspect / set / diff
      ├─►  AI agent       edits the file, renders, critiques, proposes diffs
      └─►  git            branch, diff, merge, review — like code
```

Nobody currently holds all of **GUI + diff-friendly-text-file + CLI/agent** at once. openDAW has
the GUI and headless engine but zips its projects; REAPER has text files but git can't meaningfully
diff them; Strudel/Tidal are text-native but have no GUI. This project aims at that gap. See
[`ROADMAP.md`](ROADMAP.md) §1 for the honest, nuanced version.

## What's here

| Path | What |
|---|---|
| [`ROADMAP.md`](ROADMAP.md) | **Start here.** Thesis, format design, architecture, milestones, risks. |
| [`docs/research/`](docs/research/) | The three deep-research reports (347 claims, 70 sources), fully preserved. |
| [`docs/research-summary.html`](docs/research-summary.html) | One-page visual synthesis (open in a browser). |
| [`docs/format-spec.md`](docs/format-spec.md) | Working sketch of the `.beat` text format. |
| [`docs/architecture.md`](docs/architecture.md) | Component architecture (daemon, engine, CLI, MCP, web/Tauri tiers). |
| [`docs/decisions.md`](docs/decisions.md) | Key design decisions and their rationale. |

## The three findings that shaped this

1. **The empty quadrant is real (with nuance).** The closest neighbors each miss one axis; the
   differentiator is a format *engineered* for clean diffs plus a musical-diff + AI-critique loop
   — not merely "a text file." *(`docs/research/01-landscape.md`)*
2. **Web-audio has a hard ceiling on recorded audio.** Fine for MIDI/synth; needs a native
   (Tauri) tier for low-latency recording, plugin hosting, and time-stretch. The toy/serious line
   is the backend, not the file format. *(`docs/research/02-web-stack-feasibility.md`)*
3. **AI can't be trusted to "hear" a mix — yet.** Audio-LLMs mis-hear music badly, so the
   critique loop must be **metrics-first** (LUFS/masking/spectral balance as ground truth), with
   the LLM narrating and proposing diffs, never judging alone. *(`docs/research/03-ai-listening.md`)*

## Research provenance & caveat

The research was produced by a fan-out/verify harness (search → fetch → extract → adversarially
verify). The **verification stage was rate-limited mid-run**, so most claims are *single-source*
(quoted from a primary source but not triangulated by skeptic votes). Each claim in
`docs/research/` is tagged `VERIFIED` or `SINGLE-SOURCE`. Raw JSON outputs are preserved under
`docs/research/raw/`. **Re-run verification on load-bearing claims before committing engineering.**

## Status

Planning. No build yet. Next concrete step is **M0** in the roadmap: extract BeatLab's core and
freeze v0 of the `.beat` format.
