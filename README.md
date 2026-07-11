# dotbeat

> A git-native, agent-native DAW. Your song is a **diff-friendly text file** you — and an AI
> agent — can edit in a real GUI, render from the command line, `git diff`, and get sound-design
> critique on.

This repository holds the research/planning behind the direction, **plus the working code for
Phases 0-5**: a real `.beat` text format (parser + serializer + converter, drums included — and
since **v0.3** the full sound-design surface: osc layers, unison, sub, filter envelope, LFOs,
EQ/comp/distortion/bitcrush inserts, reverb/delay sends, sidechain duck, drum-voice shaping,
with canonical elision so defaults never clutter the file), a
**daemon** that keeps the file and a live GUI in two-way sync (GUI knob-turn → one-line
`git diff` in 262 ms; `vim` edit → GUI hot-reloads in 117 ms, playback uninterrupted), an
**agent-native CLI** (`inspect`/`set`/semantic `diff`/**presets**/render/**DSP metrics**/**mix
lint**) with an **MCP server** over all of it, and a closed render→measure→edit→re-measure loop
proven to hit a loudness target to 0.01 LU — all driving the actual
[BeatLab](https://github.com/wgpatrick/beatlab) app (a working Tone.js + React web DAW /
production trainer, which this project forks in spirit).

```bash
npm install
npm test                          # 105 tests: format, conversion vs real data, daemon sync, CLI, presets, vary, DSP metrics, MCP
node cli/beat.mjs init song.beat --bpm 124 && node cli/beat.mjs add-track song.beat drums drums
node cli/beat.mjs inspect examples/real-groove.beat
node cli/beat.mjs set examples/real-groove.beat lead.cutoff 900   # prints "lead: cutoff 3200 -> 900"
node cli/beat.mjs presets                                         # the factory sound library
node cli/beat.mjs preset song.beat drums driving-kit              # a preset = a readable bag of set edits
node cli/beat.mjs vary song.beat drums kick --render              # 9 small-diff variants to audition...
node cli/beat.mjs score vary-kick-42 3 7 1                        # ...ranked picks -> git-tracked taste log
node cli/beat.mjs diff --git HEAD~1 HEAD song.beat                # a musical edit list, not line noise
node cli/beat.mjs render examples/real-groove.beat -o out.wav --beatlab-dir /path/to/beatlab
node cli/beat.mjs render --offline examples/real-groove.beat -o out.wav   # the REAL engine, no browser
bash scripts/build-patched-webaudio.sh   # one-time: builds the audio engine against upstream's fixed main
node cli/beat.mjs metrics out.wav                                 # LUFS (BS.1770), true peak, crest, spectrum, stereo
node cli/beat.mjs lint out.wav                                    # deterministic mix findings + .beat edits to try
node cli/beat.mjs mcp                                             # all of the above as MCP tools for an AI agent
node cli/beat.mjs daemon examples/real-groove.beat                # two-way sync: open beatlab with ?daw=8420
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
| [`docs/phase-5-plan.md`](docs/phase-5-plan.md) | **Start here for what's built.** Format v0.3 — the file carries the *sound*, not just the notes (~55 params, canonical elision, presets-as-tooling; exit test: a real 4-track mix reproduced from pure text with exact engine-state equivalence). Prior slices: [`phase-4-plan.md`](docs/phase-4-plan.md) (real engine offline, no browser), [`phase-3-plan.md`](docs/phase-3-plan.md) (metrics/lint/MCP), [`phase-2-plan.md`](docs/phase-2-plan.md) (CLI + semantic diff), [`phase-1-plan.md`](docs/phase-1-plan.md) (daemon + sync), [`phase-0-plan.md`](docs/phase-0-plan.md) (format + render). |
| [`ROADMAP.md`](ROADMAP.md) | **Start here for the big picture.** Thesis, format design, architecture, milestones, risks. |
| `src/core/` | The `.beat` format: types, parser, serializer, converter (synth + drum tracks), **semantic diff**, edit primitives, inspect. Pure TS, zero deps on beatlab/React/Tone.js. |
| `src/daemon/` | The `beat daemon` — owns a `.beat` file, two-way sync with the GUI over a 3-endpoint HTTP/SSE protocol, echo suppression by canonical-text comparison. |
| `src/metrics/` | The guardrail layer (D2): integrated LUFS per ITU-R BS.1770, true peak, crest, spectral balance, stereo field — plus the deterministic mix-lint rules. Zero deps, validated against the spec's calibration cases. |
| `src/mcp/` | `beat mcp` — zero-dep stdio MCP server exposing the whole toolchain (inspect/set/notes/diff/metrics/lint/render) to AI agents. |
| `test/` | 105 tests — format round-trips (v0.2 and v0.3 elision/enums/trackrefs), conversion fidelity against a real exported project, presets, daemon sync, CLI (incl. diff-between-real-git-commits), DSP metrics vs known-answer signals, MCP protocol. |
| `cli/beat.mjs` | The unified `beat` CLI: `init`, `add-track`/`rm-track`, `inspect`, `set`, `add-note`/`rm-note`, `diff` (files or git revs), `presets`/`preset`, `vary`/`score` (the variation-and-taste loop), `metrics`, `lint`, `render` (Chromium or `--offline`), `daemon`, `mcp` — enough to compose from a blank file. |
| `presets/factory.json` | The factory sound library — curated voicings (seeded from a real approved mix), applied as ordinary edits, never referenced by the format itself. |
| `scripts/verify-m1.mjs`, `verify-m3.mjs`, `verify-phase5.mjs`, `spike-offline-render.mjs` | The measured proofs: M1 sync latencies, M3's closed loop (render→measure→edit→re-render, target hit to 0.01 LU), Phase 5's sound-reproduction exit test, M2's 22×-realtime offline-render spike. |
| `examples/real-groove.beat`, `examples/night-shift.beat` | Real projects as `.beat` text — the groove the proof runs use, and the 4-track Night Shift mix whose entire sound design lives in the file. |
| [`docs/research/`](docs/research/) | Eight deep-research reports, **all fully adversarially verified** — every research gap the roadmap ever flagged is now resolved (engine architecture, live-coding landscape, demand signal). |
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

**Phases 0-5 (ROADMAP M0/M1/M2 + both M3 slices minus arrangement, plus the v0.3 sound
surface) complete.** As of Phase 5 the format carries the *sound*, not just the notes: a real
4-track mix (drums/bass/pad/lead with sidechain ducking, unison pads, filter-env plucks, sends)
lives entirely in `examples/night-shift.beat` — built with four preset applications plus five
`beat set` edits, verified to produce the exact same engine state as the hand-patched original
(`scripts/verify-phase5.mjs`). The core loop is real, not argued: a
hand-inspectable `.beat` file — the *whole* groove, drums included — is the source of truth for
a live GUI session. Turn a knob in the GUI and `git diff` shows exactly one changed line
(262 ms, measured). Edit the file in an editor and the GUI hot-reloads without stopping playback
(117 ms, measured). And the CLI is now agent-native: `beat inspect` / `set` / `add-note` /
`diff`, where `beat diff --git HEAD~1 HEAD song.beat` prints a *musical* edit list
(`lead: cutoff 3200 -> 900`, `bass: note added ...`) — verified by an automated test against a
real git repo. The guardrail layer is real: a zero-dep DSP metrics
engine (integrated LUFS per ITU-R BS.1770, true peak, crest, spectral balance, stereo field)
measured a real render round trip to **0.01 LU of its target**, `beat lint` turns those numbers
into deterministic findings that name the `.beat` edit to try, and `beat mcp` exposes the whole
toolchain to AI agents — with every number coming from DSP, never a model (decision D2, built
exactly as the verified research demanded). And the real engine now renders
**offline with no browser at all** (`beat render --offline`): beatlab's unmodified engine+store
bundled headlessly, the full closed loop self-consistent to 0.00 LU in 23 s of wall clock — with
the honest measurements attached (full-graph DSP is 0.73× realtime, not the 22× a simple-graph
spike suggested, and two real Chromium-vs-Rust Web Audio divergences were found, mitigated, and
documented). See [`docs/phase-4-plan.md`](docs/phase-4-plan.md)'s "Result".
