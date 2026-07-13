# Usability pilot 95: building a song through the MCP tool surface only

## Intro

Second pilot in the "CLI/MCP, no GUI at all" variant (`docs/usability-testing.md`), and the MCP
half specifically — pilot 94 covered the same goal purely through the `beat` CLI. The goal: build a
small, real piece of music using ONLY dotbeat's MCP server (`beat mcp`), speaking the JSON-RPC
protocol directly rather than reading `src/mcp/server.ts` to shortcut tool discovery. There is no
ready-made MCP client tool in this environment, so the pilot wrote its own small, disposable
Node.js stdio client (`mcp-client.mjs` + a series of `stepN-*.mjs` driver scripts, all under
`/tmp/dotbeat-usability-95-mcp-agent/`, deleted at the end of the session — never committed to the
repo). Work happened in a fresh scratch project (`beat init ... --bpm 120`, per the task's own setup
section, since project bootstrap has no MCP-only alternative — `beat_init` exists as a tool too, but
the task's prescribed setup used the CLI init directly). `examples/night-shift-song.beat` was never
touched.

## Narrative walkthrough

**`initialize` / `tools/list`.** Spawned `node cli/beat.mjs mcp` (no project-path argument — more on
that below) with stdio pipes, sent a JSON-RPC `initialize`, got back `serverInfo: { name: "beat",
version: "0.3.0" }` and empty capabilities beyond `tools: {}`. `tools/list` returned **48 tools**,
each with a name, a prose description, and a JSON Schema `inputSchema`. This is the pilot's
"screenshot" — read in full before any call. Overall impression: descriptions are unusually dense
and well-written for an MCP surface — most read like a paragraph of internal design-doc commentary
(citing "Phase 22 Stream AB", `docs/research/19-...md`, etc.), not boilerplate. That's a double-edged
sword: genuinely informative once read, but several tools (`beat_set`, `beat_effect_add`) have
600+ character descriptions that a smaller-context or less-patient agent client might truncate or
skim past the parts that matter.

**Setup surprise (not a bug, just an expectation mismatch).** I invoked
`node cli/beat.mjs mcp <path-to-scratch-project.beat>` exactly as the task's setup section
suggested, mirroring `beat daemon <file>`'s per-project scoping. Reading `cli/beat.mjs`'s `mcp` case
afterward (only to explain this, not to shortcut tool discovery) confirmed the extra argument is
silently ignored — `beat mcp` takes no project argument at all; every tool call carries its own
explicit `file` path. The top-level `--help` line for `beat mcp` (`MCP server over stdio (all of the
above as tools)`) shows no argument, so the CLI's own docs aren't wrong — it was the task's + my own
`beat daemon`-shaped assumption that was wrong. Still worth flagging: passing an unused positional
argument produces zero feedback (no warning, no error), which could hide a real mistake in other
contexts.

**`beat_inspect` on the fresh project.** Matched expectation exactly: bpm/bars/tracks/synth
params/notes in a compact ASCII summary, one starter "lead" synth track, "notes: none".

**`beat_add_track` x2 (bass, drums).** Expected: a new track appended per the schema's
`kind: enum[synth, drums, instrument, audio]`. Got clean one-line confirmations
(`"bass: track added (synth \"bass\", 0 notes)"`, `"drums: track added (drums \"drums\", 0 hits)"`).
`beat_inspect` afterward showed the drums track with the classic 5 lanes (kick/snare/clap/hat/
openhat), all empty. **This is where the pilot's headline finding surfaced** — see Finding 1 below:
reading the raw `.beat` file showed the drums track had **no `lane` declarations at all**, while
pilot 94 (CLI, same-day, same repo state) confirmed `beat add-track ... drums` via the CLI correctly
applies the documented 12-lane default kit. `beat_add_track`'s MCP handler and the CLI's `add-track`
handler diverge in actual behavior despite sharing near-identical descriptions/help text.

**Melody + bassline + drum pattern (`beat_add_note` x10, `beat_set` x12 for the pattern grid).**
Wrote an 8-note lead line (C4-D4-E4-G4-E4-D4-C4-G3, quarter notes over 2 bars) and a 2-note bassline
(C2 bar 1, G2 bar 2) via `beat_add_note` — each call returned an explicit, readable edit
confirmation (`"lead: note added u100001 (pitch 60, start 0, dur 3, vel 0.8)"`), enough information
on its own to know the call worked, no cross-check needed. Wrote a basic kick/snare/hat pattern via
`beat_set`'s grid-sugar path (`drums.pattern.<lane>[<step>]`) in one batched call with 12 edits — all
12 landed and were echoed back individually. Unlike the CLI (where `[`/`]` need shell quoting), the
MCP `edits` array sidesteps that shell-glob footgun entirely since paths are just JSON strings — a
genuine MCP-over-CLI ergonomic win worth calling out. `beat_inspect` confirmed the ASCII grid
(`kick X.......X.......`, etc.) matched intent exactly.

**`beat_presets` (category-filtered) → `beat_preset` x2.** `beat_presets({category: "bass"})` and
`{category: "lead"}` both returned well-written, specific one-line rationales per preset (e.g.
`deep-sub-bass ... Sub-anchored bass with a detuned square layer, plucky filter envelope, and glide;
add duckSource yourself for sidechain`). Picked `deep-sub-bass` for bass and `pluck-lead` for lead;
`beat_preset` returned an explicit before→after diff per param (13 and 12 params respectively) —
excellent transparency, matched `beat_inspect`'s post-state exactly (cutoff, ADSR, etc. all updated
as diffed).

**`beat_checkpoint` (first call of the session) → `beat_history`.** Expected, per the tool's own
description ("Without a label the checkpoint auto-labels itself from the semantic diff"), a label
summarizing the ~24 edits made so far (2 tracks, 10 notes, 12 hits, 2 presets). Got the literal
string `"checkpoint"` — no diff content at all. Reading `src/history/history.ts` confirmed why: the
auto-label diffs the working file against the *previous checkpoint*, and on the very first
checkpoint of a project there is no previous checkpoint to diff against, so it silently falls back to
the generic label regardless of how much has actually changed. This is core `src/history` behavior
(confirmed identical in the underlying `checkpoint()` function used by both CLI and MCP — not
MCP-specific), but the **tool description doesn't mention the first-checkpoint case at all**, and a
first checkpoint is an extremely common moment to hit it. See Finding 2.

**Deliberately wrong/ambiguous calls (4 tried).**
1. `beat_vary` (the CLI's own `--help` text for `beat mcp` claims "all of the above as tools" —
   tested whether that's literally true). Got a clean JSON-RPC protocol-level error:
   `{"code": -32602, "message": "unknown tool \"beat_vary\""}"`. Recoverable by re-reading
   `tools/list`, but the error itself gives no hint that a CLI fallback exists — an agent taking the
   top-level `beat mcp` help text at face value would have no signal to go look at the CLI instead.
2. `beat_add_note` missing the required `duration` field. Got
   `{"content": [{"text": "missing required number argument \"duration\""}], "isError": true}` —
   names the exact missing field, unambiguous, file was left untouched (verified: still exactly 10
   notes in the raw file afterward). Excellent, autonomously recoverable.
3. `beat_preset` with a made-up preset name. Got `isError: true` with the full valid-name list
   inline in the error text (36 names). Also excellent — better than "not found," gives the agent
   everything needed to self-correct on the next call with zero extra round-trips.
4. `beat_restore` with a bogus ref (`"0000000"`). Got `"unknown checkpoint \"0000000\""` — clean,
   recoverable (agent would call `beat_history` next).
   Bonus (accidental, not deliberate): `beat_pin({ref: "HEAD", ...})` — I expected this might fail
   since the tool description says "a checkpoint ref from beat_history" (implying a short sha), but
   it happily resolved `HEAD` via git and pinned successfully. A pleasant, undocumented flexibility.

**Render → metrics → lint → fix → re-render (the proven loop, exercised for real).**
`beat_render` matched its description precisely (headless Chromium, dotbeat's own engine, "about as
long as the audio is long, plus a few seconds of startup") and produced a real 794,924-byte WAV.
`beat_metrics` confirmed genuinely non-silent audio on the first render: -26.8 LUFS, -10.0 dBTP true
peak, crest 16.3 dB, real spectral/stereo numbers — not the "silent WAV with no error" failure mode
this project's `--offline` render path was known for; D15/Stream L (dotbeat's own engine replacing
BeatLab) has clearly landed. `beat_lint` correctly flagged the mix as 12.8 LU below the -14 LUFS
target, low-end heavy (94% of energy below 250 Hz — expected, given a sub-bass preset and no EQ
balancing), and dull top-end, each with a copy-pasteable `beat set` fix. Acted on the loudness fix
(+13 dB across all three tracks via one `beat_set` call), re-rendered, re-measured: landed at -13.9
LUFS but now clipping (0.2 dBTP, a new WARN). Trimmed back 2 dB, re-rendered again: -15.8 LUFS,
-0.45 dBTP (still technically above the -1 dBTP safety margin — a real, honest tension between the
loudness target and clip headroom for this arrangement's ~15 dB crest factor without a limiter in
the chain; a legitimate mixing tradeoff, not a tooling bug, and a fine place to stop for this
pilot). This whole loop — numbers in, edit out, numbers confirm the edit did what was claimed — is
exactly the discipline the project's own `render-metrics-loop` reference describes, and it worked
identically over MCP as it does over the CLI.

**The vary/score/suggest loop — the one place MCP structurally can't finish the job.** No
`beat_vary` or `beat_score` MCP tool exists (confirmed live above, not just from prior docs). Fell
back to the CLI for both, as the project's own skill/docs predict: `beat vary song.beat drums feel
--count 3 --seed 42 --lanes hat --timing 0.1 --velocity 0.08 --out-dir vary-drums` produced 3
variant `.beat` files with readable per-variant recipes. `beat score vary-drums 2 1` (picking v2
over v1) — note: `score`'s positional `pick` args are 1-based **numeric indices**, not the "v1"/"v2"
labels the same tool prints everywhere else in its own output (`"v1: humanize seed=42 ..."` on
screen, but `pick "v2"` errors with `not a variant number 1-3`) — a real CLI-surface inconsistency
encountered en route, but squarely pilot 94's territory (CLI ergonomics), not MCP's; flagged here
only because I hit it while using the only entry point this workflow has. Adopted the winning
variant (`cp vary-drums/v2.beat song.beat`), then called **`beat_suggest` over MCP** — this tool DOES
exist over MCP and correctly read the CLI-written `beat-scores.jsonl`, reporting "feel: 2/3 variants
picked (pick rate 67%)" with a full Bradley-Terry-odds explanation and a copy-pasteable next `beat
vary` command. `beat_inspect` confirmed the adopted variant's off-grid humanized hat timings actually
landed in the live file (`hat 8 hits, 7 off-grid`). A final render/metrics pass after adopting the
variant and taking a last checkpoint confirmed a coherent, non-silent, still-real final mix (-15.8
LUFS, near-zero true peak).

## Findings summary

- **[bug] MCP-specific: `beat_add_track` does not apply the documented 12-lane drum-kit default.**
  `cli/beat.mjs`'s `add-track` handler passes `lanes: defaultDrumKitLanes()` for
  `kind === 'drums'` unless `--legacy-lanes` is given (confirmed by pilot 94's independent CLI
  session, which got the full 12-lane kit as documented). `src/mcp/server.ts`'s `beat_add_track`
  handler calls `addTrack(before, {...})` directly with no `lanes` field at all — so an MCP-built
  drums track silently falls back to the old implicit-5-lane behavior (kick/snare/clap/hat/openhat
  only), with no `--legacy-lanes`-equivalent flag even offered in the MCP tool's schema to opt into
  it deliberately. The tool's description doesn't mention lanes at all for the drums case (it only
  talks about `soundfont_sample`/`soundfont_program` for instrument tracks). A fresh agent following
  only the MCP tool descriptions has no way to know it's getting a different, more limited drum kit
  than the CLI's own documented default — and would only discover the gap by noticing `beat_inspect`
  shows 5 lanes instead of 12, or by diffing the raw file. Root cause: `src/mcp/server.ts`'s
  `beat_add_track` handler (line ~213), not core — the core `addTrack`/`defaultDrumKitLanes`
  functions are fine and are what the CLI correctly calls into.

- **[confusing] Not MCP-specific (core `src/history/history.ts`): first-ever checkpoint always
  auto-labels as the bare string `"checkpoint"`, regardless of how much changed.** The
  `beat_checkpoint` description promises a semantic-diff label ("lead: cutoff 3200 -> 900") but
  silently degrades to a content-free generic label specifically on the first checkpoint of a
  project's history — the single most common moment a real user/agent would call it, right after
  building something up from scratch. Confirmed second checkpoint of the same session correctly
  produced a full diff-based label. The tool description should say so explicitly (e.g. "the first
  checkpoint of a project always labels as 'checkpoint' since there's nothing prior to diff
  against — pass an explicit `label` if you want a first checkpoint to be self-describing").

- **[worked well] Error messages across every deliberately-wrong call were autonomously
  recoverable without a human.** Missing required field named the exact field; unknown preset name
  listed all 36 valid names inline; unknown checkpoint ref was unambiguous; unknown tool name
  returned a standard JSON-RPC error. None of the four failed calls left the file in a partial/dirty
  state (verified via raw-file grep after the missing-`duration` failure — note count unchanged).
  This is the single most important thing for real agent autonomy and dotbeat's MCP surface clears
  the bar comfortably.

- **[worked well] `beat_set`'s `edits` array sidesteps the CLI's documented `[`/`]` shell-quoting
  footgun for `<track>.pattern.<lane>[<step>]` paths entirely** — since paths are JSON strings, not
  shell arguments, there's no glob-expansion risk. A concrete, unprompted MCP-over-CLI ergonomic win
  worth keeping in mind when comparing surfaces.

- **[worked well] The render→metrics→lint→fix→re-render loop works over MCP exactly as documented,
  and produced genuinely non-silent, plausible audio on every render** (4 renders total, LUFS/peak/
  crest/spectral numbers moved in the expected direction after each edit). D15/Stream L's own-engine
  render path has clearly landed — no BeatLab dependency, no silent-WAV failure mode encountered.

- **[worked well] `beat_suggest` correctly consumed a CLI-written `beat-scores.jsonl` with no
  friction** — a real cross-surface handoff (CLI writes the scores, MCP reads them) worked
  transparently, which matters because `beat_vary`/`beat_score` have no MCP equivalent at all and a
  real agent would routinely need to bridge the two surfaces this way.

- **[slow-to-discover] The CLI's own `beat mcp --help` line ("all of the above as tools") overstates
  the actual MCP surface.** `beat_vary`, `beat_score`, `beat_sample`, `beat_lane`, `beat_daemon`, and
  standalone `beat_clip`/`beat_scene` (folded into `beat_song` instead) have no MCP tool at all — a
  fresh agent taking the top-level help text at face value would only discover this by trying the
  call and getting `unknown tool`, as this pilot did deliberately. Not a schema/description bug on
  any individual tool (nothing here was actively misleading about ITS OWN behavior), but a
  discoverability gap at the "what does this whole surface cover" level — the MCP tool list itself
  has no meta-description explaining what's deliberately CLI-only.

- **[confusing, not MCP's fault] `beat score`'s positional `pick` arguments are 1-based numeric
  indices, but the same command's own output prints variants as `"v1"`/`"v2"` labels** — `pick
  "v2"` errors (`not a variant number 1-3`); `pick 2` works. Hit while using the CLI fallback for the
  vary/score step (no MCP equivalent exists), squarely pilot 94's CLI-ergonomics territory, included
  here only because this pilot had to go through it too.

## Where the pilot gave up on the "ideal" workflow

Two points where MCP alone was structurally insufficient and the CLI had to fill the gap, both
already documented as known gaps rather than new discoveries: `beat_vary`/`beat_score` (the
variation-and-audition loop has no MCP tool at all — `beat_suggest` exists on the MCP side and reads
the CLI-written log fine, but generating and scoring the variants themselves required shelling out).
Everything else in the goal — project/track creation, note/hit authoring, presets, checkpointing,
rendering, metrics/lint, and the suggest half of the vary loop — was reachable through MCP tool calls
alone, with no CLI fallback needed.

## Could a fresh AI agent, given only the MCP tools' own descriptions, accomplish a realistic music-production task without a human filling in gaps?

**Mostly yes, with one real trap.** For the core authoring/mixing loop (create a project, build
real musical content, apply presets, checkpoint, render, measure, iterate on the mix from lint
feedback) the MCP tool descriptions were sufficient on their own — every call this pilot made behaved
as its description predicted, error messages were consistently good enough to self-correct without a
human, and the render/metrics loop produced genuinely useful, actionable numbers. A fresh agent
handed only `tools/list`'s output could complete this pilot's whole goal (minus the vary/score
half, which the descriptions correctly don't claim to cover) with zero human intervention.

The one place a fresh agent would get actively misled, not just slowed down, is
**`beat_add_track` on a drums-kind track**: its description reads as complete (covers the
instrument-track soundfont case in detail) but silently omits that it produces a materially
different, more limited drum kit than the CLI command with the same name and near-identical help
text — and there's no schema field to even ask for the better default. An agent relying purely on
the MCP description would build every drums track with 5 lanes instead of the intended 12, with
no error, no warning, and no way to know unless it happened to diff against CLI behavior (as this
pilot did, by comparing notes with pilot 94's independent session). That's the pilot's one clear
verdict of "this needs a human, or at minimum a source-level fix, before it's trustworthy" — every
other rough edge found here (the first-checkpoint label, the overstated `beat mcp --help` line, the
CLI's own v1/v2-vs-numeric score-pick inconsistency) was either self-correctable from the tool's own
error output or a minor, non-blocking discoverability cost.
