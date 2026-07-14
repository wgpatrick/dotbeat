# Usability pilot 101: the taste loop over MCP (beat_vary/beat_score/beat_suggest), beat_sample/beat_lane, and per-command help

## Intro

Phase 34 Streams NA+NB shipped (1) four new MCP tools — `beat_vary`, `beat_score`, `beat_sample`,
`beat_lane` — completing the vary→score→suggest taste loop over MCP, and (2) per-command CLI help
(`beat <cmd> --help` / `beat help <cmd>`). This pilot played a fresh AI agent connected to a brand-new
dotbeat project **over MCP only**: build a small drum groove, vary the kick, record ranked picks, ask
for a suggested next round, run round 2 and adopt the winner — discovering everything cold from
`tools/list` output and (twice, as the goal required) the new CLI per-command help. The protocol was
spoken directly: a ~70-line Node stdio client (`initialize` / `tools/list` / `tools/call` over
JSON-RPC) against a spawned `node cli/beat.mjs mcp`, per the methodology's MCP-pilot convention.
Work happened entirely in `/tmp/dotbeat-usability-pilot101/`; `examples/night-shift-song.beat` was
never touched; no daemon or GUI was started. Rendering was skipped by design (each render is ~2 min
in this container and pilot 96 already established the render noise floor) — ground truth here is
raw `.beat` diffs, manifests, the scores log, and, once, the engine source to classify a bug.

The headline: **the loop's mechanics are polished and almost every input-validation complaint from
pilot 96 is fixed — but the pilot's literal goal, "audibly vary the kick," is structurally
impossible over MCP.** The `kick`/`snare`/`hats` vary groups mutate track-wide legacy params that
the engine provably never plays on a declared-lane drums track, and every drums track MCP can
create is a declared-lane track.

## Narrative walkthrough

**Discovering the surface (`tools/list`).** 54 tools, and the descriptions are genuinely excellent —
noticeably richer than the CLI's own help. `beat_add_hit`'s velocity is annotated "0..1, NOT MIDI
0-127 (e.g. 0.9, not 110)" (pilot 94's top finding, fixed at the description level), `beat_score`
says picks accept `"N" or "vN"` (pilot 96's naming-mismatch finding, fixed), and `beat_vary`
carries an honest render-cost warning ("a 9-variant batch of an 8-second loop is well over a
minute"). One eyebrow-raise filed for later: `beat_suggest.file` is described as "path *shown in
the recommended command*" — hinting it is never validated (pilot 96's unvalidated-track bug).

**Building the groove.** `beat_init` (112 bpm) → `beat_add_track` drums → `beat_drum_kits` →
`beat_drum_kit` kit-909 → 26 hits via `beat_add_hit` (kick 0/8/10/16/24/26, snare backbeat, 16
hats), opening deliberately with one wrong-units call (`velocity: 110`): clean `isError` text,
`hit velocity must be in (0, 1], got 110`. All hits verified present and exact in the raw file.
Two `inspect` oddities: the drums track still gets a `synth: sawtooth...` line (94's cosmetic
finding, persisting), and — new — **the drum grid printed 16 characters for a 32-step project**:
kick said "(6 hits)" but showed three X's. The raw file confirmed all six kicks; `inspect` silently
shows only steps 0-15 with no "bar 1 of 2" annotation, so the display contradicts its own hit
counts.

**Per-command help, use #1.** Before varying, `beat vary --help` (the new surface): scoped usage,
flag defaults inline, and a `related: beat score, beat suggest` line. Exactly what pilot 94 asked
for.

**Round 1 (`beat_vary` kick).** `{track: "drums", group: "kick", count: 6, amount: 0.3, seed: 101}`
→ `vary-kick-101/` with v1-v6 + manifest, plausible-looking `drums.kickTune/kickPunch/kickDecay`
edits. Ground truth (diff v1 vs base): the edits were written into the track's **synth block**;
the kit's `lane kick synth:membrane tune=28.5 punch=0.12 decay=0.35` line — the thing that actually
sounds — was untouched. And the mutation values center on 32.7 (the track-wide `kickTune` default),
not 28.5 (the lane's declared tune), so `vary` didn't even read the sounding value as its basis.
`inspect` was no help either way: it shows no lane params and no drum-voice params at all, so there
is no CLI/MCP-reachable surface that could reveal whether a kick variant changed anything. That was
a genuine wall; per the pilot-94 precedent I consulted source once to classify it.
`ui/src/audio/engine.ts:1795` is explicit: the legacy `kickTuneHz` fields are used **only** while
the drums track's `lanes` list is empty; declared lanes play their own per-lane params.
`src/vary/vary.ts:218` mutates `track.synth[key]`. So **all six variants were audio-identical
no-ops** — and `beat_add_track` over MCP always creates the declared 12-lane kit (its own
description: "there is no legacy-5-lane opt-out over MCP").

**Scoring round 1.** Probes first: pick `v99` → clean error that now even documents both accepted
forms (`pick "v99" is not a variant number 1-6 (accepts "N" or "vN")`); nonexistent batch dir →
clean one-liner (`no such batch directory or missing manifest.json: ...`) — pilot 96's raw ENOENT
stack trace is fixed. Real score with deliberately mixed pick forms `["v2", "5", "v6"]`: accepted,
logged, and the reply included the adopt line — which is a **CLI command string**
(`to adopt the winner: beat set groove.beat drums.kickTune 34.9255 ...`) even when scored over MCP.

**`beat_suggest`.** After round 1: real analysis (pick rate 50%, "picks trend darker on kickTune,
mean position 18% of its vary.ts range") and a recommendation to run kick again — the taste loop
confidently steering me deeper into the provably inaudible group, because nothing anywhere knows
drum param groups are dead on declared-lane tracks. The 96 regression probe: `beat_suggest` for
track `"ghosttrack"` returned a normal cold-start recommendation — **still no track validation**,
on either surface. The `vary.ts`/`suggest.ts` filename leaks in user-facing text also persist.

**Round 2 + adopt.** Ran the suggested round (seed 1548660425), scored `["4", "2"]`, translated the
adopt line by hand into `beat_set` (`drums.kickTune 36.6823` etc.) — mechanically flawless, and the
resulting file is the bug in one screenshot: dead `kickTune 36.6823 / kickPunch 0.1005 / kickDecay
0.3268` sitting in the synth block three lines above the live `lane kick ... tune=28.5 punch=0.12
decay=0.35` that actually plays. `beat_set`'s own description advertises the kickTune paths with no
declared-lane caveat, and — checked deliberately — **no `beat set` path or MCP tool can edit a
declared lane's backing params at all** (the GUI does it via a daemon-only `/lane` route;
`beat_lane` only swaps sample backing). So even a user who diagnoses the bug has no CLI/MCP way to
do what `vary kick` was supposed to do.

**The workaround that works: `feel`.** `beat_vary` `{group: "feel", lanes: ["kick"], timing: 0.1,
velocity: 0.1, seed: 77}` produced genuine, verifiable content variation — raw diff showed
fractional starts/velocities on kick hits only. Scored it (`v3 > v1`); the adopt line adapted
correctly to a `cp .../v3.beat groove.beat`. A third `beat_suggest` aggregated all three rounds and
ranked `feel` above `kick` — the cross-round reasoning is real. But note what the `cp` means for an
MCP-only agent: **there is no MCP tool that can execute it.** A file copy isn't in the tool set, so
a feel-batch winner is unadoptable over MCP alone (see below for the humanize-replay attempt).

**A probe that found a second real bug.** Alongside the feel batch I passed `lanes: ["hat"]` to a
*param* group (`hats`) — silently ignored, batch proceeded (also reconfirming the no-op family:
hats mutations centered on `hatTone` default 4000 while kit-909's hat lane plays `tone=7000`). Then
the bigger one: trying to adopt the feel winner MCP-natively by replaying its recorded recipe
(`humanize seed=79 timing=0.1 velocity=0.1 lanes=kick`) through `beat_humanize` — the call
**silently jittered every hit on every lane** and reported success. `beat_humanize`'s schema
declares no `lanes` property (CLI `humanize` has `--lanes`; the MCP tool only has `ids`), and the
server neither rejects nor warns about unknown arguments — it dropped the scope and applied a
full-track edit. The RNG mapping made it visible: the same draw that gave kick h2 `8.0006` in the
properly-scoped v3 landed on hat h11 as `0.0006` in the unscoped replay. And the `ids` fallback is
a dead end MCP-only: `beat_inspect` (schema: `file` only, no json mode) never surfaces hit ids.
Restored from backup.

**`beat_sample` + `beat_lane`.** Synthesized a 1 KB WAV into `media/` beside the project.
`beat_lane` with an unregistered id first: fails loudly and helpfully (`no sample "smp_click" in
the media block (have: none) — register it with beat sample first`). `beat_sample` computed the
sha256 and stored the project-relative path as documented; `beat_lane` applied gain/tune; `"none"`
reverted cleanly and symmetrically. One raw-file surprise: while sample-backed, the track block
held **two `lane kick` lines** — the declaration (`lane kick synth:membrane ...`) and the override
(`lane kick smp_click -3 2`). `docs/format-spec.md` documents both grammars, so it's by design, but
a raw-file reader (this project's own ground-truth doctrine) can easily misread which one plays.

**Per-command help, use #2 + error probes.** `beat help score`: scoped, and documents the pick
forms. `beat help frobnicate`: `unknown command "frobnicate"` + full dump, exit 2 — a reasonable
fallback. Final MCP probes: unknown group `"kicks"` → lists all valid groups; track `"bass"` →
`no track "bass" (have: lead, drums)`. Error discipline over MCP is uniformly clean: seven
deliberate wrong paths, seven helpful one-line `isError` texts, zero stack traces.

## Findings summary

- **[bug] [core] (high) The `kick`/`snare`/`hats` vary groups are audio no-ops on every
  declared-lane drums track — which over MCP is every drums track.** `vary` mutates the legacy
  track-wide synth-block params (`src/vary/vary.ts:218` reads/writes `track.synth.kickTune` etc.,
  basis = the 32.7 default, not the lane's declared value) while the engine uses those fields only
  when `lanes` is empty (`ui/src/audio/engine.ts:1795`); every kit and every MCP-created drums
  track has declared lanes (`beat_add_track`: "no legacy-5-lane opt-out over MCP"; CLI default is
  also 12-lane). The whole loop then compounds it: `beat_score` prints an adopt line promoting the
  dead params, `beat_suggest` reads the scored round and recommends more kick, and `beat_set`'s
  description advertises `kickTune/...` paths with no caveat. Worse, there is **no CLI/MCP edit
  primitive for declared-lane backing params** (GUI-only daemon `/lane` route; `beat_lane` swaps
  sample backing only), so a "fixed" vary has nothing to write through today, and no ground-truth
  surface short of the raw file can reveal the no-op (`inspect` shows neither lane params nor
  drum-voice params). Pilot 96 found the synth-track flavor of this (kick group on a `lead` track);
  this is worse — it fires on the *correct* track type, on the tool's flagship drum workflow.
  Repro: `beat_init` → `beat_add_track` drums → `beat_drum_kit` kit-909 → `beat_vary`
  `{group: "kick"}` → diff any variant against the base: edits land in the synth block, the
  `lane kick` line is untouched.

- **[bug] [MCP-specific] (medium) The MCP server silently drops unknown/inapplicable tool
  arguments, and it cost this pilot an unintended full-track edit.** `beat_humanize` with
  `lanes: ["kick"]` (a plausible guess — sibling tool `beat_vary` declares `lanes` for the same
  underlying humanize operation, and CLI `humanize` has `--lanes`) jittered **all 26 hits on every
  lane** and reported success; the schema has no `lanes` property and nothing rejected or warned.
  Same family: `beat_vary` with `lanes` on a param group (`hats`) silently ignores it. Arguments
  that don't apply should be an `isError`, not a dropped key — an agent has no other feedback
  channel. Repro: `beat_humanize` `{file, track: "drums", seed: 79, timing: 0.1, lanes: ["kick"]}`
  → read the edit list: every lane moved.

- **[bug] [core] (medium) `beat_suggest` still doesn't validate the track exists — pilot 96's
  finding, unfixed and now shipped onto the MCP surface.** `{file: "groove.beat", track:
  "ghosttrack"}` returns a normal cold-start recommendation (whose recommended command would then
  error). Every sibling tool validates (`beat_vary` on track `"bass"`: `no track "bass" (have:
  lead, drums)`). The `beat_suggest.file` description ("path shown in the recommended command")
  reads like the gap got documented rather than fixed.

- **[confusing] [core] (medium) `inspect`'s drum grid silently shows only the first 16 steps of a
  longer loop, contradicting its own hit counts.** 32-step project: kick lane printed
  `X.......X.X.....  (6 hits)` — three visible marks, no ellipsis, no "bar 1/2" annotation. An
  agent (or user) reading the grid as ground truth would conclude half the groove is missing.
  Repro: any 2-bar project with hits past step 15, `beat_inspect`.

- **[confusing] [core] (medium) `inspect` exposes no drum-lane detail at all — no lane backing
  params, no sample-vs-synth state, no hit ids.** Three separate walls in one session: couldn't
  verify the kick variant (finding 1) from any tool output; couldn't see the sample-backed state
  after `beat_lane`; and couldn't use `beat_humanize`'s `ids` scoping (the only scoping it has)
  because no MCP surface ever reveals a hit's id. CLI users fall back to reading the raw file; an
  MCP-only agent whose client doesn't also have filesystem access genuinely cannot do any of these.

- **[confusing] [MCP-specific] (medium) The loop's action outputs are CLI/shell command strings
  even over MCP, and the feel-adopt action has no MCP-executable equivalent.** `beat_score`'s adopt
  line for param groups is a `beat set ...` string (translatable, tediously, to `beat_set`), but a
  feel batch's is `cp <abs>/v3.beat groove.beat` — no MCP tool can perform a file copy, and the
  natural MCP-native replay (`beat_humanize` with the manifest's recorded recipe) is blocked by the
  two findings above (no `lanes` param; ids undiscoverable). An MCP-only agent can generate and
  score feel variants but cannot adopt the winner. `beat_suggest`'s recommendation is likewise a
  `beat vary ...` CLI string rather than tool-call-shaped arguments.

- **[confusing] [core] (low) A sample-backed declared lane produces two same-keyword `lane <name>`
  lines in one track block** — the declaration (`lane kick synth:membrane tune=28.5 ...`) and the
  override (`lane kick smp_click -3 2`) coexist, and which one plays is not inferable from the file
  alone. Both grammars are documented in `docs/format-spec.md` and `beat_lane`'s "none" revert
  handles them correctly, so it works — but under this project's own raw-file-as-ground-truth
  doctrine it's a legibility trap.

- **[confusing] [MCP-specific] (low) Batch dirs and the scores log default to paths relative to
  the MCP server's working directory**, which a typical MCP client (IDE-launched, cwd opaque) can't
  see or predict. The `beat_vary` description does say so, and in this pilot (server cwd = project
  dir) it behaved as documented — but a fresh integration whose server starts elsewhere will
  scatter `vary-*/` dirs and `beat-scores.jsonl` somewhere invisible. Explicit `out_dir`/`log`
  arguments avoid it; the defaults are the trap.

- **[worked well] [MCP-specific] Error discipline over MCP is uniformly excellent, and both of
  pilot 96's validation bugs that were fixable at the surface are fixed.** Seven deliberate wrong
  paths (MIDI velocity, pick `v99`, nonexistent batch dir, unknown group, unknown track,
  unregistered sample id, pre-registration `beat_lane`) all returned clean one-line `isError` texts
  naming the problem and the valid options; the 96 ENOENT stack trace is gone; picks accept `"N"`
  and `"vN"` and the error text says so.

- **[worked well] [CLI-specific] The new per-command help closes pilot 94's gap well.** `beat vary
  --help` and `beat help score` both give scoped usage with defaults inline and a "related:"
  cross-reference; unknown commands get a clear first line + the full dump (exit 2). The
  MCP-has-no-help asymmetry turns out to be a non-issue in practice: the tool descriptions are a
  *better* help surface than the CLI's (velocity units, render cost, out_dir semantics are all
  spelled out there first).

- **[worked well] [core] `beat_sample`/`beat_lane` are solid**: hash computed server-side,
  project-relative path semantics documented and honored, fail-loudly ordering enforced with a
  helpful pointer, `"none"` revert clean and symmetric.

- **[worked well] [core] The loop's data layer held up under every ground-truth check**: manifests
  match printed summaries match raw variant diffs; the scores log records batch/track/group/seed,
  replayable edits or feel recipes, picks *and* rejects; `beat_suggest` aggregates multiple rounds
  with honest method disclosure; feel variation is genuine, scoped (in `beat_vary`), and
  seed-deterministic.

- **[cosmetic, persisting from 94/96]** `inspect` still prints a `synth: sawtooth...` line for
  drums tracks; `vary.ts`/`suggest.ts` filenames still leak into user-facing suggest text.

Not exercised: `beat_vary`'s `render: true` flag (cost: one real-time headless-Chromium capture per
variant; pilot 96 already characterized the render path and its noise floor) and the checkpoint
family. A follow-up pilot could cover render-in-batch behavior.

## Where the pilot gave up on the "ideal" workflow

The stated goal — audibly vary the *kick* and adopt a winner — is unreachable over MCP (and, on any
declared-lane/kit track, over the CLI too): finding 1 means every kick param batch is a silent
no-op, and there's no lane-param edit primitive to route around it. The loop's *mechanics* (vary →
score → suggest → round 2 → adopt) all completed flawlessly against those no-op batches, which is
exactly the trap: nothing anywhere fails. The workaround that produces real kick variation is
`beat_vary` `{group: "feel", lanes: ["kick"]}` — genuine, verified, scorable — but its winner can't
be adopted MCP-only (the adopt action is a `cp`; the humanize-replay alternative is blocked by the
missing `lanes` param and undiscoverable hit ids). A second give-up: verifying *any* drum-voice
state required reading the raw `.beat` file, which an MCP-only agent may not be able to do.

## Could a fresh AI agent run the taste loop over MCP using only tools/list?

**Mechanically yes — musically no, for drums.** Discovery is the best of any surface tested so far
(the tool descriptions preempt every units/cost/path mistake pilots 94 and 96 hit), error handling
is exemplary, and the score/suggest data layer is consistent and honest. But the loop's flagship
drum use case silently does nothing on every drums track MCP can create, the surrounding tools
(score's adopt line, suggest's recommendations, set's path list) actively reinforce the illusion,
and the only tools that could reveal or repair it (inspect, set/lane) lack the lane-level surface
to do so. Fix priority follows that shape: (1) make vary's drum groups write per-lane params — or
refuse loudly on declared-lane tracks; (2) reject unknown MCP tool arguments; (3) give inspect a
lane-params/hit-id view; (4) validate suggest's track.
