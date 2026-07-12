# dotbeat

> A git-native, agent-native DAW. Your song is a **diff-friendly text file** you — and an AI
> agent — can edit in a real GUI, render from the command line, `git diff`, and get sound-design
> critique on.

Solo project, built in paired sessions with Claude. The `.beat` text format is the product: a
real GUI (dotbeat's own, not a wrapped teaching tool), a CLI (`beat`), and an MCP server for AI
agents all edit the **same file**, and every edit is a one- or two-line `git diff` — not a binary
blob you hope merges.

```bash
npm install
npm test                          # 603 tests: format, conversion, daemon sync, CLI, vary/humanize, DSP metrics, MCP
node cli/beat.mjs init song.beat --bpm 124 && node cli/beat.mjs add-track song.beat drums drums
node cli/beat.mjs inspect examples/real-groove.beat
node cli/beat.mjs set examples/real-groove.beat bass.cutoff 900   # prints "bass: cutoff 700 -> 900"
node cli/beat.mjs quantize examples/real-groove.beat bass --grid 1 --amount 0.6   # partial-strength snap to 16ths
node cli/beat.mjs vary examples/real-groove.beat drums kick --render             # small-diff variants to audition...
node cli/beat.mjs score vary-kick-42 3 7 1                        # ...ranked picks -> git-tracked taste log
node cli/beat.mjs diff --git HEAD~1 HEAD song.beat                # a musical edit list, not line noise
node cli/beat.mjs render examples/real-groove.beat -o out.wav     # dotbeat's own engine, headless
node cli/beat.mjs metrics out.wav                                 # LUFS (BS.1770), true peak, crest, spectrum, stereo
node cli/beat.mjs checkpoint song.beat --label "rough mix"        # a restorable version, git-backed
node cli/beat.mjs macro apply song.beat bass space 50              # a knob that resolves to real literal edits, no indirection
node cli/beat.mjs mcp                                             # the whole toolchain as MCP tools for an AI agent
node cli/beat.mjs daemon examples/real-groove.beat                # two-way sync backend for the GUI

cd ui && npm install && npm run dev   # dotbeat's own frontend (Vite + React), talks to the daemon above
```

Run `node cli/beat.mjs` with no arguments for the full command list — it's grown a lot (track
groups, drum kits, audio-clip splitting, effect chains, checkpoint/restore/pin history, selection
sync with the GUI) since the walkthrough above.

## The idea in one picture

```
   song.beat  (plain text, in git)
      │
      ├─►  GUI            edit notes/knobs/arrangement → one-line diffs
      ├─►  CLI            beat render / inspect / set / diff / vary / checkpoint
      ├─►  AI agent        edits the file, renders, critiques, proposes diffs (MCP)
      └─►  git             branch, diff, merge, review — like code
```

Nobody currently holds all of **GUI + diff-friendly-text-file + CLI/agent** at once — openDAW has
the GUI and a headless engine but zips its projects into an opaque binary bundle; REAPER has
genuinely text project files but even its own practitioners say git "cannot meaningfully diff or
merge" them; Ableton's `.als` is gzipped XML with no native diff story at all; Strudel/Tidal are
text-native but have no GUI. This project aims at that gap. See [`ROADMAP.md`](ROADMAP.md) for
the full thesis and prior-art comparison.

## What's here

| Path | What |
|---|---|
| [`docs/product-roadmap.md`](docs/product-roadmap.md) | **Start here for what's built.** Every tracked feature (271 and counting), each rated done/in-progress/not-started across the core format, CLI/MCP, and GUI layers — the live source of truth, not a snapshot. |
| [`ROADMAP.md`](ROADMAP.md) | **Start here for the big picture.** Thesis, format design, architecture, prior-art comparison, research provenance. |
| `src/core/` | The `.beat` format: types, parser, serializer, converter, semantic diff, edit primitives (quantize/humanize/transpose/fit-to-scale/groove/…), inspect. Pure TS, no GUI deps. |
| `src/daemon/` | The `beat daemon` — owns a `.beat` file, two-way sync with the GUI over HTTP/SSE, echo suppression by canonical-text comparison. |
| `src/history/` | Checkpoint/restore/pin — a git-backed, append-only version history (`beat checkpoint`/`history`/`restore`/`pin`). |
| `src/metrics/` | The guardrail layer: integrated LUFS (ITU-R BS.1770), true peak, crest, spectral balance, stereo field, plus deterministic mix-lint rules. Zero deps. |
| `src/vary/` | The variation-and-taste loop: `beat vary` generates small-diff variants, `beat score` records ranked picks, `beat suggest` proposes the next round from that history. |
| `src/mcp/` | `beat mcp` — zero-dep stdio MCP server exposing the whole toolchain to AI agents. |
| `ui/` | dotbeat's own GUI (Vite + React + Tone.js) — arrangement view, piano-roll/drum-lane clip editing, mixer, effects chain, content browser. Its own product design, not a wrapped teaching app (see `docs/decisions.md` D12). |
| `desktop/` | Tauri desktop shell — early-stage, working toward a native Mac app (`docs/product-spec-desktop.md`). |
| `cli/beat.mjs` | The unified `beat` CLI — run with no args for the full, current command list. |
| `test/` | 603 tests — format round-trips, conversion fidelity, daemon sync, CLI, DSP metrics vs known-answer signals, MCP protocol, vary/humanize/groove determinism. |
| `presets/` | Factory sound + drum-kit libraries — curated voicings applied as ordinary edits, never referenced by the format itself. |
| `ui/verify*.mjs` | Measured, Playwright-driven proofs against the real running app — not mocked assertions. |
| `examples/` | Real projects as `.beat` text, incl. a multi-track song with full arrangement/automation (`night-shift-song.beat`). |
| [`docs/research/`](docs/research/) | 79 research passes — landscape/prior-art, engine architecture, and three full passes against Ableton Live's own reference manual: one feature-by-feature (chapters 50-69), one implementation-level UI/UX detail grounded in the manual's own screenshots (70-74), one round-2 follow-up re-verifying those fixes live and finding what's newly gapped (75-79). |
| [`docs/decisions.md`](docs/decisions.md) | 15 numbered design decisions with rationale and "revisit when" — check before proposing something that might contradict one. |
| [`docs/format-spec.md`](docs/format-spec.md) | The `.beat` format grammar. |
| [`docs/architecture.md`](docs/architecture.md) | Component architecture (daemon, engine, CLI, MCP, GUI/desktop tiers). |

## Status

Well past the original v0 proof-of-concept: dotbeat now has its own GUI (arrangement view, clip
authoring, mixer, effects chain, content browser — not a wrapped version of the BeatLab teaching
app it started from), a 603-test suite, a session-local undo/redo stack alongside the git-backed
checkpoint/restore history system, and a growing library of adversarially-researched design docs.
Three research passes against Ableton Live 12's own reference manual have directly shaped recent
work. A feature-by-feature comparison drove a batch of P0 shipments: in-session undo/redo, a real
wavetable oscillator, Macro Controls, a drum-sampler voice, curved automation, generalized
velocity/key modulation, instrument-track effect-chain parity, and two real audio correctness bugs
fixed along the way. A follow-up implementation-level UI/UX pass — grounded in the manual's own
screenshots plus live screenshots of dotbeat's own GUI, not text alone — then reshaped the
arrangement view (real clip chrome in every mode, full-column bar-range selection, a genuine
"currently dragging" state shared across every drag surface in the app), the clip view (a colored
title bar, redesigned velocity/chance lanes, a two-sided loop handle, a local zoom control), the
device panel (working macros on every track kind, a leading Activator-style bypass toggle,
click-to-type knobs), the content browser (per-type icons, in-place preview feedback), and a
cross-cutting design-token/typography pass plus a keyboard-shortcut reference panel. A round-2
follow-up re-verified all of it live and caught real regressions between independently-shipped
fixes before they could ship broken. `docs/product-roadmap.md` tracks every feature's real status;
`ROADMAP.md` has the thesis and architecture. The core loop is still the same one this project was
built to prove: a hand-inspectable `.beat` file is the source of truth for a live GUI session, a
CLI, and an AI agent, all at once — turn a knob in the GUI and `git diff` shows exactly one changed
line; edit the file by hand and the GUI hot-reloads without stopping playback.
