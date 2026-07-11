---
name: dotbeat
description: This skill should be used when working inside a dotbeat project — any folder containing a .beat file (optionally a media/ directory beside it) — or when the user asks to "open a .beat project", "edit a beat file", "add a track/note/drum hit", "vary the hats/selection", "render and check the mix", "check LUFS/loudness", "checkpoint/save a version", "restore an earlier version", "pin a version", or otherwise produce or drive dotbeat's CLI (`beat` / `cli/beat.mjs`) or MCP tools (`beat_*`). Also use it before running any `beat` command for the first time in a session, to avoid rediscovering the command surface by trial and error.
---

# dotbeat: editing and driving a `.beat` project

dotbeat is a git-native, agent-native DAW. The `.beat` file is a plain-text, line-oriented,
diff-friendly document — every note, drum hit, and synth param is literal data in the file, not
state hidden in an app. Edit it with the `beat` CLI or, when connected over MCP, the equivalent
`beat_*` tools. Full grammar: `docs/format-spec.md` in the dotbeat repo checkout.

## Project layout

A dotbeat project is a folder containing:

- `<name>.beat` — the project file (source of truth: bpm, tracks, notes/hits, synth params,
  clips/scenes/song, media references).
- `media/` (only if the project uses samples/soundfonts) — the actual audio bytes the `media`
  block in the `.beat` file references by sha256. Never guess at files in here; the `.beat` file's
  `media` block is the only valid index.
- Optionally `.mcp.json` (see MCP section below) and a hidden local git repo used only for
  `beat checkpoint`/`history` (separate from any project-level git repo the user has of their own).

To open a project: find the `.beat` file (commonly the only one in the folder) and run
`beat inspect <file>` first, every time, before making any edit. It is the cheapest way to learn
current bpm, track ids/kinds, synth settings, and note/hit ranges — never assume track ids.

If no `.beat` file exists yet: `beat init <file> [--bpm 120] [--bars 2]`.

## MCP vs CLI — which to use

If this session is already MCP-connected to a `beat` server (check for available `beat_*` tools),
**prefer the MCP tools** (`beat_set`, `beat_inspect`, `beat_render`, etc.) over shelling out to the
CLI — same code path, structured results, no subprocess overhead. If there is a `.beat` file but no
MCP connection, either shell out to the CLI directly, or bootstrap MCP for this project first:

```
node <dotbeat-repo>/cli/beat.mjs mcp-init <file.beat>   # writes .mcp.json next to the project
```

then start a fresh Claude Code session in that project folder (MCP config is discovered at
startup, not hot-reloaded).

**The MCP server does NOT expose every CLI command.** Verified live against `src/mcp/server.ts`
(27 tools total, confirmed by driving a real `initialize` → `tools/list` round trip over stdio —
not just reading source). Concretely, these must go through the raw CLI even inside an MCP
session:

- `beat vary` / `beat score` — the variation-and-audition loop (no MCP equivalent yet).
- `beat sample` / `beat lane` — registering/assigning media.
- `beat daemon` — starting the daemon that the selection protocol and `--scope selection` need.
- `beat clip` / `beat scene` (the MCP tool `beat_song` covers clip-snapshot + scene + song
  together in one call, but there's no equivalent for `beat clip`/`beat scene` individually).

Everything else (inspect, set, add-note/add-hit, humanize, quantize, diff, presets, automate,
song, metrics, lint, selection read/set, render, suggest, checkpoint/history/restore/pin) has a
1:1 MCP tool — see `references/cli-reference.md` for the full, verified list.

## Editing: `beat set` and the path grammar

`beat set <file> <path> <value> [<path> <value> ...]` (MCP: `beat_set` with an `edits` array) is
the general-purpose surgical edit. Paths:

- `bpm`, `loop_bars`, `selected_track` — top-level document fields.
- `<track>.<synth-param>` — e.g. `lead.cutoff`, `bass.volume`. Core 9: `osc, volume, cutoff,
  resonance, attack, decay, sustain, release, pan`, plus ~46 optional shaped params (EQ, comp,
  distortion, bitcrush, LFOs, filter env, sends, sidechain `duckSource`/`duckAmount`, drum-voice
  shaping). Full param list in `references/format-grammar.md`.
- `<track>.name`, `<track>.color` — track metadata.
- `<track>.pattern.<lane>[<step>]` — **grid sugar** for drum hits: upserts/removes the on-grid hit
  at that integer 16th-step (0 = remove). Lanes: `kick|snare|clap|hat|openhat`, steps 0-15 (one
  bar). **Quote this path in a shell** — `[` and `]` are shell glob characters
  (`beat set song.beat "drums.pattern.hat[2]" 0.6`), confirmed to fail silently-wrong under zsh
  glob expansion if unquoted.

For anything off-grid or higher-level than a single param, use the dedicated verbs instead of
`beat set`: `beat add-note`/`beat rm-note` (synth/instrument tracks), `beat add-hit`/`beat rm-hit`
(free-timed drum hits, fractional `start` in 16th steps), `beat automate` (clip automation
points), `beat humanize`/`beat quantize` (batch timing/velocity operations), `beat add-track`/
`beat rm-track`. Every edit command prints the musical edit list of what changed (not raw text) —
read that output to confirm the edit landed as intended.

`beat diff <a.beat> <b.beat>` (or `--git <rev1> <rev2> <file>`) gives the same kind of musical diff
between two states — use it to review before committing/checkpointing, not `git diff` on the raw
text (though that also works, since the format is diff-friendly by design).

## Selection: "highlight the hats, vary it"

The GUI's selection is ephemeral (never written to the `.beat` file) and lives in a running
daemon's memory (`beat daemon <file> --port <p>`). It maps directly onto scoped operations:

1. Read the current selection: `beat selection --port <p>` (MCP: `beat_selection` with `port`).
2. A user request like "highlight the hats, vary it" becomes, once the GUI has pushed that
   selection to the daemon: `beat vary <file> <track> feel --scope selection --port <p>`
   (`--scope selection` resolves the daemon's live selection into vary's own `--lanes`/`--ids`
   scoping — confirmed end-to-end: a selection of `lanes drums.hat` resolves to `--lanes hat`).
3. `--scope selection` **only works with `feel`** (content variation / humanize batches). Whole-
   track param-group variants (`beat vary <file> <track> cutoff`, etc.) have no per-note/lane
   concept to scope by and reject `--scope selection` with a clear error.
4. To set a selection by hand (e.g. no GUI in the loop): `beat selection --port <p> --set "$(printf
   'selection\n  lanes drums.hat\n')"`. Grammar: header line `selection`, then any subset of
   `tracks`/`lanes`/`bars`/`notes` axis lines, each indented exactly 2 spaces, in that fixed order.
   Each axis is an independent filter; an absent axis is unfiltered, not empty — see
   `references/format-grammar.md` for the full axis semantics (multiple axes AND together).

## Versioning: checkpoints are NOT automatic

**No `beat set`/`beat add-note`/any edit command creates a checkpoint by itself.** This was
confirmed the hard way in this project's own history (Phase 15 Stream H) — the plan assumed
auto-checkpointing and it doesn't happen; verified again by reading `cli/beat.mjs` directly (no
`checkpoint()` call anywhere in the edit-command paths). Call `beat checkpoint <file> [--label L]
[--intent I]` explicitly after each batch of edits that fulfills one user request — pass the
user's own request as `--intent` so the version is later findable by what was asked for, not just
by its diff. Then: `beat history <file> [--collapsed]` to list versions, `beat pin <file> <ref>
<name>` to name one so it survives history noise, `beat restore <file> <ref>` to go back (this is
append-only — it never destroys work; the pre-restore state stays in history too).

## Render → metrics → critique → re-render

The proven loop (worked, real example: `references/render-metrics-loop.md`, mirroring
`docs/sessions/2026-07-10-claude-over-mcp.md`): render, read the deterministic DSP numbers, propose
a `.beat` edit from those numbers (never from "how it probably sounds"), re-render, re-measure,
accept or iterate. `beat metrics`/`beat lint` (or `beat_metrics`/`beat_lint`) are ground truth —
trust them over any impression of the audio. **Current environment caveat**: `beat render` (both
the Chromium and `--offline` paths) requires a BeatLab checkout (`--beatlab-dir`/`BEATLAB_DIR`) as
of this writing, and `--offline` is known to render **silence with no error** in environments
without a locally-patched `node-web-audio-api` build (confirmed: neither is present in this
checkout). `docs/decisions.md` D15 / `docs/phase-17-plan.md` Stream L is retargeting `beat render`
to dotbeat's own `ui/` engine (no BeatLab dependency) — check whether that has landed before
assuming render "just works" in a given environment; if it hasn't, treat a silent/short WAV or a
`--beatlab-dir` error as expected, not a mystery bug.

## Common mistakes — see `references/mistakes.md`

Highest-value ones: checkpoints aren't automatic (above); `vary --scope selection` only applies to
`feel`; bracket paths (`track.pattern.lane[step]`) need shell quoting; there's no MCP tool for
`beat vary`/`beat score`/`beat sample`/`beat lane`/`beat daemon` — fall back to the CLI for those
even in an MCP session; `beat render --offline` can silently render silence rather than erroring.

## Additional resources

- **`references/cli-reference.md`** — the full, verified `beat` CLI command surface (every verb,
  every flag) and the parallel MCP tool list, cross-checked against `cli/beat.mjs` and
  `src/mcp/server.ts` directly.
- **`references/format-grammar.md`** — the `.beat` path grammar in full (every `beat set` path
  shape, the full optional synth-param list, drum-hit/note grammar, selection grammar/axis
  semantics), condensed from `docs/format-spec.md`.
- **`references/render-metrics-loop.md`** — the worked render/metrics/critique example.
- **`references/mistakes.md`** — the full "don't do this" list, sourced from this project's own
  corrected mistakes.
