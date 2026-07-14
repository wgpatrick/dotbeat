# Usability pilot 104: the Phase 37 surface (analyze-structure, automate-shape, automation-vary, source add, feedback --sections, render --stems) over CLI + MCP

## Intro

Phase 37 shipped a batch of new commands and their MCP mirrors: `beat analyze-structure` (symbolic
arrangement analysis, no render), `beat automate-shape` (fill a clip's automation lane with a
predefined ramp/sine/triangle/exp/adsr shape), `beat vary <track> automation:<param>` (automation as
a vary target in the taste loop), `beat source search/add` (Freesound CC0 ingest, plus an offline
`source add <local-wav>` path), `beat feedback [--sections]` (render once, report a per-section
energy arc), and `beat render --stems`. This pilot played a cold end-user working a realistic goal:
**build a short 2-section song, use `analyze-structure` to understand its arrangement, generate a
filter sweep on a synth clip with `automate-shape`, `vary` that automation and adopt a pick, register
a local sample with `source add`, and finally run `feedback --sections` to critique the arrangement's
energy** — discovering the command set cold from `--help`/`tools/list` the way a first-time user or a
fresh AI-agent integration would. All work in `/tmp/dotbeat-usability-pilot104/`;
`examples/night-shift-song.beat` untouched. Render budget was respected: exactly one `feedback
--sections` and one `render --stems` (the only two real renders); the vary/score/adopt loop was
exercised WITHOUT rendering. The MCP surface was driven by a ~30-line Node JSON-RPC stdio client
against a spawned `node cli/beat.mjs mcp`, per the MCP-pilot convention. The one local WAV needed for
`source add` was synthesized with a few lines of Node (a 0.5s 440 Hz decaying sine — noted as
legitimate pilot setup).

The headline: **the Phase 37 features all work and hold up under raw-file ground-truth checks — the
real gaps are in discoverability and error consistency, not correctness.** The goal's central step,
`vary automation:<param>`, is functionally solid but is documented on *neither* surface (not in CLI
help, `--groups`, per-track `--groups`, nor the beat_vary MCP description), so a cold user cannot
discover it. And `automate-shape`'s bad-shape error leaks a full stack trace on the CLI while the MCP
mirror catches the identical error cleanly.

## Narrative walkthrough

**Discovery.** `beat` (no args) dumps the full surface; the new commands are all present with decent
inline descriptions. `automate-shape --help`, `analyze-structure --help`, and `source --help` each
give scoped usage. But the very first friction: reading `vary --help` and `vary --groups` cold, I
found **no mention of `automation:<param>` as a legal target anywhere.** `--groups` lists
kick/snare/hats/filter/env/…/mix; per-track `vary <track> --groups` for a synth track lists
filter/env/filterenv/osc/motion/fx/sends/mix/feel. If the task prompt hadn't told me the
`automation:cutoff` syntax, I would have had no way to reach the goal's central step. Filed as the top
finding before writing a single edit.

**Building the song.** `beat init song.beat --bpm 120 --bars 4` → a starter `lead` synth track with
no notes. Added a sparse 4-note melody, added a `drums` track (12 declared lanes as documented), added
kick/snare hits. Snapshotted `lverse`/`dverse` clips, then densified both tracks (higher/faster lead
notes, hats + extra kicks) and snapshotted `lchorus`/`dchorus`. `beat clip`'s documented accumulation
behavior held (lchorus = 8 notes = verse+chorus, as its help warns). Two scenes, `beat song verse 4
chorus 4`, and `inspect` confirmed a clean 2-section arrangement.

**analyze-structure (goal step 1).** Excellent. Instant, no render, and the output directly conveys
the energy arc: verse `onset/bar 2, sync 0%` vs chorus `onset/bar 4.5, sync 28%`, plus per-section
pitch histograms and (with `--root 0 --scale major`) an in-scale readout (75% → 88%). Cross-checked
the onset math by hand: verse = 4 lead notes + 4 drum hits over 4 bars = 2/bar; chorus = 8 + 10 = 18
over 4 bars = 4.5/bar. Exactly right, and it reads the *arrangement's actual played content*, not just
raw clip counts. The `arc` column ("new"/"new") is symbolic novelty (no exact repeats), not energy —
correct but momentarily made me expect an energy label.

**automate-shape (goal step 2).** Probed errors first: missing `--from/--to` → clean `error:` line
(exit 2); **bad shape `wobble` → a full uncaught `AutomationShapeError` stack trace** (exit 2);
nonexistent clip → clean `error: no clip "nope" … (have: lverse, lchorus)`. The stack-trace path is a
clear inconsistency against its own siblings. Then the real sweep: `automate-shape song.beat lead
lverse cutoff sine --from 300 --to 4000 --cycles 2 --points 12` → 12 breakpoints. Ground truth in the
raw file: `auto lead.cutoff` block with all 12 points, and `inspect` shows `lverse (4 notes, auto:
cutoff(12))`. Command claim == file == inspect. (Minor: the summary says "300 -> 4000" but the sampled
sine peak/trough are 3925/593 — the discrete points miss the continuous extremes except at the
endpoints. Mathematically fine, mildly surprising.)

**vary automation (goal step 3).** `vary song.beat lead --groups` still doesn't list `automation:` —
reconfirmed. Ran `vary song.beat lead automation:cutoff --count 5 --seed 42`: 5 real `v*.beat` files
+ `manifest.json` (with `parentSha256`), each a distinct `automate-shape lverse cutoff <shape>` recipe
(exp/ramp/adsr, varied from/to). Verified genuine content: `beat diff song.beat v1.beat` shows the
12-point sine replaced by a 16-point exp curve 862→3138. A probe — `vary automation:resonance` on a
param with **no** existing lane anywhere — didn't error; it invented a resonance lane on the first
clip. And a structural note: with cutoff automation later present on *both* lverse and lchorus, vary
still targeted **lverse only** (the track's first clip) — no clip selector exists, so a second clip's
automation is unreachable via vary.

**score + adopt (no render).** Bad pick `v9` → clean `pick "v9" is not a variant number 1-5`. Real
`score vary-automation-cutoff-42 v2 v5` → logged, and the reply's adopt line carries the human recipe
(`automate-shape lverse cutoff ramp --from 768.0889 --to 3231.9111 …`). `adopt … v2` → landed; raw
file now shows the 16-point linear ramp 768→3231, `inspect` shows `auto: cutoff(16)`. The whole taste
loop extends to automation targets flawlessly.

**source add (goal step 5).** Synthesized `blip.wav` (0.5s 440 Hz sine). Bad path → clean `error: no
audio file at …`. `source add song.beat smp_blip blip.wav --license CC-BY-4.0 --note "…"` → copied to
`media/smp_blip.wav`, computed sha256, wrote an enforced provenance sidecar
(`media/smp_blip.wav.json`: source, license, sha256, note, duration). Media block written to the
`.beat`. Solid.

**feedback --sections (goal step 6, render #1).** ~21s for a 16s song. Real per-section energy arc:
verse −27.3 LUFS / centroid 638 Hz vs chorus −21.7 LUFS / centroid 1749 Hz, and a movement line
("+5.6 LU louder · +11pt brighter · −12pt low-end · narrower · more dynamic") flagged only for changes
clearing the variance floor. Matches the arrangement I built (denser, brighter chorus) and cross-checks
analyze-structure's onset arc. The honest-limits disclaimer ("does NOT hear masking, arrangement,
transitions") is exactly right. One blemish: a `[page error] Failed to load resource: 404 (Not Found)`
during headless UI load (also appears in render --stems) — harmless, render succeeds, but noisy.

**render --stems (render #2).** ~39s (two solo renders). Wrote `stems-song/lead.wav` +
`stems-song/drums.wav`. Verified they're genuinely different: distinct sha256, distinct amplitude
(lead peak 3402 / avg 126 vs drums peak 22241 / avg 155). Correct one-solo-render-per-track behavior.

**MCP mirror.** Spawned `beat mcp`, spoke JSON-RPC. `tools/list` = 63 tools, all 5 Phase 37 tools
present with rich schemas. `beat_analyze_structure` output is **byte-identical** to the CLI.
`beat_automate_shape` triangle on lchorus persisted (raw file now has 2 `auto lead.cutoff` blocks).
`beat_source_add` (offline) registered `smp_mcp` + sidecar. `beat_vary` with `group:"automation:cutoff"`
produced the same variant structure as the CLI (and again targeted lverse only). `beat_source_search`
(egress-blocked here) failed cleanly on the missing API key *before* attempting network, and pointed
to the offline `source add` path. And the tell: **`beat_automate_shape` with bad shape `wobble`
returned a clean `isError` one-liner** — the exact input that dumped a stack trace on the CLI. So the
core throws, the MCP server catches, and the CLI command handler doesn't. Also confirmed: the
beat_vary MCP `group` description enumerates every target form (lanes, bus groups, kick/snare/hats,
feel) but — like the CLI — **never mentions `automation:<param>`.**

## Findings summary

- **[bug] [CLI + MCP discoverability] (medium-high) The `automation:<param>` vary target — the
  goal's central step — is documented on neither surface.** It appears in `beat vary --help`,
  `beat vary --groups`, per-track `beat vary <track> --groups`, and the `beat_vary` MCP `group`
  description *nowhere*, even though `vary <track> --groups` bills itself as "list THAT track's real
  targets (lanes + live groups)" and automation is a live target once a clip has an `auto` lane. A
  cold user or a fresh AI agent given only help/`tools/list` cannot discover it. The feature itself
  works perfectly; the surfacing is the whole gap. Fix: add `automation:<param>` to the vary help,
  the static/per-track `--groups` output, and the beat_vary tool description. Repro: `beat vary
  song.beat lead --groups` after `automate-shape … cutoff …` — the cutoff automation lane is not
  listed as a vary target.

- **[bug] [CLI-specific] (medium) `automate-shape` with an unknown shape name throws an uncaught
  `AutomationShapeError` with a full stack trace, while every sibling error is a clean one-liner.**
  Missing `--from/--to`, bad clip, and bad track all print `error: …` (exit 2); `automate-shape …
  cutoff wobble --from 200 --to 4000` prints the raw exception + stack from
  `dist/src/core/automation-shape.js:62` through `cli/beat.mjs:1497 automateShapeCmd`. The MCP mirror
  (`beat_automate_shape`, same core) catches the identical error and returns a clean `isError`
  one-liner — so this is purely the CLI command handler not wrapping core exceptions the way the MCP
  server does. Repro: `beat automate-shape song.beat lead lverse cutoff wobble --from 200 --to 4000`.

- **[confusing] [core] (low-medium) `vary automation:<param>` is hardwired to the track's FIRST clip
  and offers no clip selector.** With cutoff automation present on both `lverse` and `lchorus`, both
  `beat vary` and `beat_vary` silently target `lverse` only; `lchorus`'s automation cannot be varied.
  Relatedly, `vary automation:resonance` on a param with no existing lane *anywhere* doesn't error —
  it invents a lane on the first clip. Reasonable as a generator, but combined with the first-clip
  hardwiring it means "vary the automation" has a hidden, unstated, uncontrollable target. The recipe
  line does name the clip post-hoc (`automate-shape lverse cutoff …`), so it's at least visible.

- **[confusing] [core, render] (low) Both render paths emit a `[page error] Failed to load resource:
  404 (Not Found)` during headless UI load.** Appears in `feedback` and `render --stems`; render
  succeeds regardless, but a user reading the output would reasonably think something's wrong. Likely
  a favicon/asset 404 in `ui/`. Cosmetic, persisting (prior render pilots would have seen it too).

- **[worked well] [core] `analyze-structure` is a standout.** Instant, no render, and the onset-density
  arc (verse 2/bar → chorus 4.5/bar), syncopation, per-section pitch histogram, and in-scale readout
  cleanly convey the arrangement's energy shape; it reads the actually-played arrangement content, not
  just raw clip counts. Exactly the "understand the song before rendering" tool the goal needed.

- **[worked well] [core] `automate-shape` math is correct and fully ground-truth-verifiable.** All
  five shapes emit well-formed, uniformly-spaced breakpoints that persist exactly to the raw `.beat`
  `auto` block; `inspect` surfaces `auto: <param>(N)`; the documented REPLACE-the-whole-lane semantics
  hold. (Only nit: the summary's stated from→to range isn't literally hit at every sampled
  peak/trough for oscillating shapes — correct sampling, mildly surprising copy.)

- **[worked well] [core] The vary → score → adopt taste loop extends cleanly to automation targets.**
  `vary automation:cutoff` writes real `v*.beat` files + a `manifest.json` with a `parentSha256`
  guard; `beat diff` reads the automation delta cleanly; `score`'s adopt line carries the
  human-readable recipe; `adopt` lands the exact ramp into the parent, confirmed in the raw file and
  `inspect`. Exercised entirely without rendering — the `.beat` variants are self-sufficient ground
  truth.

- **[worked well] [core] `source add` (offline) is solid on both surfaces.** Copies into `media/`,
  computes sha256, writes an enforced provenance sidecar with source/license/note/duration, writes the
  media block, clean `error:` on a missing file. `source search`/`beat_source_search` (egress-blocked
  here) fail helpfully on the missing `FREESOUND_API_KEY` *before* attempting network, and redirect to
  the offline `source add` path.

- **[worked well] [core] `feedback --sections` delivers a genuinely useful, honest energy arc.**
  Per-section LUFS / spectral balance / width / crest + a movement line that only flags changes
  clearing the render-run variance floor, with an explicit "does NOT hear masking, arrangement,
  transitions" disclaimer. Cross-checks analyze-structure's symbolic arc. ~21s for a 16s song.

- **[worked well] [MCP-specific] The MCP mirrors match the CLI and error cleanly.** `beat_analyze_structure`
  is byte-identical to the CLI; `beat_automate_shape`/`beat_vary`/`beat_source_add` produce identical
  file mutations; every deliberate wrong call (bad shape, missing key) returned a one-line `isError`,
  no stack traces. The beat_vary description is notably thorough (drum-lane vs group vs feel, render
  cost, out_dir semantics) — its one omission is the `automation:` target (finding 1).

- **[minor] [core] (low) `source add` registers identical content under two ids with no dedup note.**
  `smp_blip` and `smp_mcp` share a sha256 (same source file) and both appear in the media block. Not
  wrong (distinct ids/intents), just an un-flagged duplicate a user might not expect.

## Where the pilot gave up on the "ideal" workflow

Nowhere on correctness — every goal step completed and verified against the raw file. The one place a
*cold* user (without the task prompt's hint) would have stalled is goal step 3: `vary
automation:<param>` is unreachable from any help/`--groups`/tool-description surface (finding 1), so
the workflow "generate a sweep, then vary it" has a broken discovery path even though the machinery
behind it is complete. The natural workaround a stuck user would reach for — re-running
`automate-shape` by hand with different from/to/cycles values — works but bypasses the whole
score/adopt taste loop the feature was built to feed.

## CLI vs MCP vs core, at a glance

- Finding 1 (undocumented `automation:` target): **both CLI and MCP** (help + tool description).
- Finding 2 (stack-trace on bad shape): **CLI-specific** (MCP catches it; the fix is in the CLI
  command handler, not core).
- Finding 3 (first-clip-only automation vary), finding 4 (render 404), finding 6-9 (the wins):
  **core** — same behavior on both surfaces.
