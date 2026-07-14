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
npm test                          # 773 tests: format, conversion, daemon sync, CLI, vary/humanize, DSP metrics, MCP
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
| [`docs/product-roadmap.md`](docs/product-roadmap.md) | **Start here for what's built.** Every tracked feature (317 and counting), each rated done/in-progress/not-started across the core format, CLI/MCP, and GUI layers — the live source of truth, not a snapshot. |
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
| `test/` | 773 tests — format round-trips, conversion fidelity, daemon sync, CLI, DSP metrics vs known-answer signals, MCP protocol, vary/humanize/groove determinism. |
| `presets/` | Factory sound + drum-kit libraries — curated voicings applied as ordinary edits, never referenced by the format itself. |
| `ui/verify*.mjs` | Measured, Playwright-driven proofs against the real running app — not mocked assertions. |
| `examples/` | Real projects as `.beat` text, incl. a multi-track song with full arrangement/automation (`night-shift-song.beat`). |
| [`docs/research/`](docs/research/) | 104 research passes — landscape/prior-art, engine architecture, three full passes against Ableton Live's own reference manual (feature-by-feature 50-69, implementation-level UI/UX 70-74, round-2 live re-verification 75-79), and twenty-five exploratory usability pilots (80-104, see `docs/usability-testing.md`) — an agent driving the real app (or, for the CLI/MCP variant, its own command output) with no pre-scripted checklist, reacting like a human tester. Covers realistic musical workflows, focused GUI audits, following real published Ableton tutorials step by step in dotbeat instead of Ableton, and — the newest variant — testing the `beat` CLI and MCP tool surface directly, no GUI at all, since that's dramatically cheaper (~4 minutes per pilot vs. 15-50+ for a GUI one) and tests dotbeat's actual agent-native thesis. |
| [`docs/decisions.md`](docs/decisions.md) | 15 numbered design decisions with rationale and "revisit when" — check before proposing something that might contradict one. |
| [`docs/usability-testing.md`](docs/usability-testing.md) | The exploratory usability-pilot methodology — no checklist, an agent reads its own screenshots (or, for the CLI/MCP variant, every command's real output) and reacts like a human tester. A standing practice, run alongside `ui/verify-*.mjs`'s scripted assertions whenever GUI-facing behavior changes — and, since CLI/MCP pilots run in minutes rather than tens of minutes, whenever a `beat` subcommand or MCP tool changes too. |
| [`docs/format-spec.md`](docs/format-spec.md) | The `.beat` format grammar. |
| [`docs/architecture.md`](docs/architecture.md) | Component architecture (daemon, engine, CLI, MCP, GUI/desktop tiers). |

## Status

Well past the original v0 proof-of-concept: dotbeat now has its own GUI (arrangement view, clip
authoring, mixer, effects chain, content browser — not a wrapped version of the BeatLab teaching
app it started from), a 773-test suite, a session-local undo/redo stack alongside the git-backed
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
fixes before they could ship broken. A newer, complementary thread — exploratory usability pilots
with no pre-scripted checklist, an agent driving the real app and reading its own screenshots
like a human tester (`docs/usability-testing.md`) — surfaced ~30 real bugs and friction points the
scripted verify suite structurally can't catch: a grid-click off-by-one, macro knobs desyncing from
actual state after a preset swap, a clip editor that got stuck on a song's first scene once it had
more than one, rapid grid clicks silently losing data, and a Mixer modal that quietly ate the
topbar Undo button, among others. Phase 29 fixed all of it in six parallel streams, independently
re-verified, catching one real cross-stream regression along the way (two streams' fixes to the
same file shipped correctly in isolation but collided once merged). A follow-up round of pilots
(87-89) audited core feature areas in breadth rather than end-to-end workflows; Phase 30 fixed what
was real from those too — an unreliable Undo button, non-atomic multi-entity undo, a drum-hit-marker
click target, several note-editor UX gaps, and Audio tracks' bottom panel showing an empty note-grid
instead of real controls — while also catching that some of those pilots' findings were artifacts of
testing against a checkout mid-merge, not real gaps, and leaving those alone rather than "fixing"
something that wasn't broken. A third pilot round (90-93) added two detailed musical builds and a
new variant — following real, independently-published Ableton beginner tutorials step by step in
dotbeat instead of Ableton — which surfaced a genuine "Place in Arrangement" mistargeting bug, a
client/daemon desync on rejected edits, and `+ capture scene` silently skipping Audio tracks; Phase
31 fixed all of it, verifying two "sounds serious" findings against a stable checkout before touching
anything (one turned out real, one didn't reproduce and got a regression guard instead of a guess).
Bigger findings that don't fit a fix phase go straight into the roadmap as ordinary not-started rows
rather than a second tracking system — and get promoted into a real stream once independently
rediscovered enough times to be worth it rather than deferred again. Section/scene naming and
right-click context menus (found by four and two separate pilots respectively) crossed that bar and
shipped in Phase 32. A fourth pilot round (94-100) tried something new: testing the `beat` CLI and
MCP tool surface directly instead of the GUI, cheap enough (~4 minutes per pilot) to run in volume —
it found a genuine data-loss bug in `beat restore` (contradicting its own "never destroys work"
guarantee), an MCP/CLI parity gap in drum-kit defaults, and several smaller correctness and
error-handling gaps — Phase 33 fixed all of it, including one fix (`beat lint` naming the real
offending track) that needed genuine per-track audio isolation rather than a heuristic, since a
shallow guess would have reproduced the exact bug it was meant to fix. Phase 34 then closed the
agent-surface gap those pilots mapped: the vary/score taste loop is now fully drivable over MCP
(`beat_vary`/`beat_score`/`beat_sample`/`beat_lane`, with the batch logic extracted to one shared
module both surfaces import so CLI/MCP parity is structural rather than reviewed-in — only
`daemon`, a long-running process, remains CLI-only), the CLI got real per-command help
(`beat <cmd> --help`), and render non-determinism was finally measured instead of guessed at:
the capture-alignment hypothesis was refuted, the real cause is voice/LFO phase re-quantizing
onto 128-sample render-quantum boundaries, and the measured variance is now encoded as named
tolerance constants that `beat lint` pads its thresholds with so a finding can't flip between
identical renders (`docs/render-determinism.md`). The pilot run against that new surface
(research/101) promptly caught the next layer down: the drum param-group vary path silently
mutates legacy params the engine never plays on modern declared-lane drum tracks — a
high-severity no-op now tracked as a roadmap row, with its two contained MCP-side bugs (silent
unknown-argument drops, a `beat_suggest` validation drift) fixed the same day. A multi-region
audio placement schema (the one-clip-per-track-per-section ceiling, pilot 99) has a full design
proposal awaiting an owner decision in `docs/multi-region-audio-design.md`. Phase 35 then went
after where the silent no-ops cluster — the modern drum-lane surface — plus the owner's own
dogfood asks: vary/suggest are lane-aware (targeting the params the engine actually plays,
with byte-identical `beat set` replay), inspect finally shows per-lane truth and full-loop
grids, a second drums track actually sounds (the engine was silently wiring only the first —
found mid-song by the owner's music agent, fixed with a committed two-track render proof),
the taste loop got one-WAV auditions (`--audition`) and a first-class `beat adopt` with a
parent-hash safety check, `beat mcp-init` scaffolds a music-session CLAUDE.md so a helper
agent produces music instead of repo hygiene, mix critique can run against a saved reference
profile (`beat lint --ref`), and research/102 scoped the "learn from real tracks" pipeline
(separation/structure/chords/melody) down to a recommended `beat analyze` first slice. Phase 37
then turned the taste loop from "vary knobs" into a produce-and-critique loop: `beat feedback
--sections` renders a song once and reports its energy arc per section (LUFS/brightness/width per
section + the biggest movers), `beat analyze-structure` reads arrangement structure with no render
at all (onset density, scale-degree, "§3 is the drop, §4-6 repeat the intro"), `beat automate-shape`
generates movement (ramp/sine/adsr automation) and `beat vary <track> automation:<param>` feeds that
movement into the same audition/score/adopt loop, `beat render --stems` writes per-track WAVs, and
`beat source` wires the Freesound CC0 pipeline into the loop (offline ingest with enforced provenance
sidecars; live search egress-gated). Research/103 mapped the generative-audio direction and — with an
owner-supplied primary-source correction on the ElevenLabs Music terms — landed on Stable Audio Open
(local) as the licensing-clean path, deferred to sit alongside `beat analyze` in a later phase.
`docs/product-roadmap.md` tracks every feature's real status;
`ROADMAP.md` has the thesis and architecture. The core loop is still the same one this project was
built to prove: a hand-inspectable `.beat` file is the source of truth for a live GUI session, a
CLI, and an AI agent, all at once — turn a knob in the GUI and `git diff` shows exactly one changed
line; edit the file by hand and the GUI hot-reloads without stopping playback.
