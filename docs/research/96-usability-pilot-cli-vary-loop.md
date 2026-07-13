# Usability pilot 96: the vary/score/suggest "taste loop" via only the `beat` CLI

## Intro

The goal: run dotbeat's distinctive variation-and-taste loop — `beat vary` → render/inspect →
`beat score` → `beat suggest` → a second informed round — entirely through `node cli/beat.mjs ...`,
discovering `vary`/`score`/`suggest` syntax cold from the top-level help dump, never reading
`cli/beat.mjs`'s source except after hitting a genuine wall. Basic track/note/hit syntax (velocity
0-1, `add-note`/`add-hit` argument order) was carried over as known-good from `docs/research/94`
rather than rediscovered. Work happened entirely in a disposable scratch project at
`/tmp/dotbeat-usability-96-vary-loop/song.beat`; `examples/night-shift-song.beat` was never touched.
No daemon was ever started — every command in this session, including render, worked as a plain
one-shot CLI invocation with its own ephemeral internal daemon.

## Narrative walkthrough

**Building the starting pattern.** Applied the `pluck-lead` preset to the starter `lead` synth
track, then added a real 7-note melodic phrase (`add-note`, pitches 60/64/67/72/67/64/60 across 2
bars). Added a `drums` track, applied the `kit-909` drum-kit, and hand-built a basic kick/snare/hat
groove (4 kicks, 4 snares, 16 hats via `add-hit`). `inspect` confirmed both — a real 7-note melody
and a populated ASCII hit grid — before touching `vary` at all.

**Discovering `vary`.** The no-arg help dump (re-read fresh this session) already showed three
`vary` forms: `vary <file> <track> <group> [...]` for param-group batches, `vary <file> <track> feel
[...]` for humanized content variants, and a `--scope selection --port <p>` daemon-backed form. `beat
vary --groups` listed 12 mutation groups (`kick`, `snare`, `hats`, `filter`, `env`, `filterenv`,
`osc`, `motion`, `fx`, `sends`, `mix`) — drum-synthesis groups and synth-voice groups all in one
flat list, which turned out to matter (see finding 1).

**Round 1, filter group.** `beat vary song.beat lead filter --count 6 --amount 0.3 --seed 42`
produced a `vary-filter-42/` dir with `v1.beat`...`v6.beat` and a `manifest.json`. Cross-checked via
`inspect` on each variant: real, distinct `cutoff`/`resonance` edits, confirmed against the base
(cutoff 3500→2403-6363 Hz, resonance 0.8→0.36-1.36). One surprise: `v6`'s printed summary and
manifest both showed only a `cutoff` edit, no `resonance` line — confirmed via `inspect` that
resonance was genuinely untouched (still 0.8) on that variant. Not every variant touches every param
in the group; undocumented but consistent between the CLI summary, the manifest, and the file itself
— self-consistent, just non-obvious from the help text alone.

**Round 1, feel group (drums).** `beat vary song.beat drums feel --count 4 --seed 7 --timing 0.12
--velocity 0.08 --swing 0.15` produced 4 variants with auto-incrementing seeds (7,8,9,10) recorded
per-variant in the manifest as a `recipe` string rather than an `edits` list. Grepped the raw hit
lines directly (ground truth, since the coarse ASCII grid in `inspect` can't show fractional
timing): base had exact-grid starts (`hit h1 kick 0`, `hit h5 snare 4`, ...), `v1` had real jittered
fractional starts and velocities (`hit h1 kick 0.3311 0.9446`, `hit h5 snare 3.9126 0.7527`, ...).
Genuine, real humanization, not cosmetic.

**Listening via render+metrics (round 1).** Rendered `base.wav` plus three filter variants
(`v1`/`v2`/`v6`) and one feel variant. All rendered clean with zero manual daemon setup, matching
`docs/research/94`'s finding. `metrics` gave real, distinct numbers per file. Notably `v2` (resonance
pushed to 1.36) stood out clearly — sample peak -3.6 dBFS vs. -5.7 to -5.9 dBFS for the others, crest
24.3 dB vs. ~22.2 dB elsewhere — a self-oscillating-filter peak signature that's genuinely audible-
sized, not noise. The other filter variants and the feel variant differed only by fractions of a dB,
which turned out to matter (see finding 6, the render-noise-floor check below).

**Scoring, wrong-path #1 (intentional): guessing the pick syntax wrong.** Tried
`beat score vary-filter-42 v2 v4 v1` (guessing file-name-style picks, since the manifest and printed
summary both label variants `v1`/`v2`/etc.) — actually no, caught this before running it by first
testing `beat score vary-filter-42 v99`, which errored `pick "v99" is not a variant number 1-6` —
revealing picks are bare integers (`1`-`6`), not `v1`-style strings, despite every other part of the
tool's own output (manifest, printed summary, `suggest`'s "adopt" line) consistently labeling
variants with the `vN` prefix. Real, if minor, naming mismatch between how variants are *displayed*
and how they must be *referenced*.

**Scoring for real.** `beat score vary-filter-42 2 1 6` → `scored vary-filter-42: v2 > v1 > v6 ->
beat-scores.jsonl`, plus a genuinely useful bonus line: `to adopt the winner: beat set song.beat
lead.cutoff 5298.441 lead.resonance 1.3557` — the exact command to promote the pick into the live
file. `beat-scores.jsonl` on disk confirmed full context per round: batch, track, group, amount,
seed, parent file's sha256, ranked picks with their edits, and an explicit `rejected` list of the
unranked variants. Scored the feel batch too (`beat score vary-feel-7 2 1 3`); its "adopt" line was
correctly a `cp vary-feel-7/v2.beat song.beat` rather than a `beat set` command, since humanize edits
span many hit fields that a scalar `set` couldn't express — a nice bit of adaptive output.

**`suggest`, wrong-path #2 (intentional): before any scores exist.** `beat suggest song.beat lead`
run before any scoring gave a clean, honest cold-start message: `no scored rounds found for "lead" —
cold start, nothing to bias toward yet. recommending the first group in vary.ts's declared order
(kick, snare, hats, ...): "kick"` plus a ready-to-run `beat vary song.beat lead kick --amount 0.25
--seed <n>` command. This is where the pilot's biggest real finding surfaced — see finding 1 below;
running that exact recommended command against the synth `lead` track "succeeded" but was a silent
no-op.

**`suggest` for real, after scoring.** Once both tracks had a scored round, `suggest` got noticeably
smarter: for `lead` it reported `filter: 3/6 variants picked (pick rate 50%)`, ranked `filter`
highest "by picked-vs-rejected odds (Bradley-Terry odds-form ... see suggest.ts's module doc)",
detected a directional trend ("picks trend brighter on cutoff, mean position 77% of its ... range")
and recommended a same-amount follow-up round with a fresh seed. Ran that round-2 batch
(`vary song.beat lead filter --amount 0.25 --seed 1513008672`, 9 variants by default count), rendered
and measured 3 of them, scored again (`4 1 7`). A third `suggest` call then escalated
`--amount` from 0.25 to 0.6, having now seen two consistent rounds trending the same direction — real
adaptive behavior, not a static template. Adopted the round-2 winner (`beat set song.beat lead.cutoff
9059.7144 lead.resonance 0.9539`), confirmed via `inspect`, and did a final `render`+`metrics`+`lint`
of the fully-adopted song — clean, non-silent, 4.14s of real stereo audio.

**Wrong-path #3 (intentional): score/suggest against bad references.** `beat score
vary-filter-nonexistent 1` (nonexistent batch dir) threw a raw uncaught Node.js exception with a full
stack trace (`Error: ENOENT ... at scoreCmd (file:///.../cli/beat.mjs:877:31)`), not the clean
`error: ...` + exit-2 pattern every other command in this and the prior (94) pilot used. Separately,
`beat suggest song.beat bass` (a track that has never existed in this project) did **not** error at
all — it returned a normal-looking cold-start recommendation (`beat vary song.beat bass kick ...`),
as if `bass` were a valid track. Confirmed `vary` itself does correctly reject the nonexistent track
(`error: no track "bass" (have: lead, drums)`, exit 2) — so `suggest` alone skips the validation that
every other track-taking command in the CLI does.

**Render-noise sanity check.** To judge whether the small (sub-1dB) metric differences between filter
variants in round 1 were real or measurement noise, re-rendered the *unchanged* `song.beat` a second
time (`base-rerender.wav`). Not byte-identical to `base.wav`, and true peak swung from -4.8 to -3.9
dBTP, crest 22.2→22.5 dB, on the exact same input — confirming `render`'s "real-time capture through
dotbeat's own engine" banner text is literal: it's a live audio-engine capture, not a deterministic
offline bounce, so it has an inherent ~1-1.5 dB noise floor per render. This directly explains why
round-1's `kick`-group bug variant (below) still showed small metric deltas from base despite being a
confirmed no-op — those deltas were within the render's own noise floor, not real audio differences.

## Findings summary

- **[bug] `beat vary <file> <track> <group>` doesn't validate that the group applies to the track's
  type, and silently no-ops when it doesn't.** `beat suggest`'s own cold-start recommendation for the
  synth track `lead` was `beat vary song.beat lead kick --amount 0.25 --seed <n>` (because `kick` is
  simply first in `vary.ts`'s declared group order, with no track-type filtering). Running it exactly
  as suggested reported success and printed plausible-looking edits (`v1: lead.kickTune 40.1863,
  lead.kickDecay 0.503`), and the raw file gained real `kickTune`/`kickDecay` lines inside the `lead`
  track block — but `inspect`'s synth-param line for `lead` was byte-identical to the unmodified base
  (same cutoff/res/ADSR), and a full render+metrics comparison against base showed differences no
  larger than the render pipeline's own re-render noise floor (confirmed by re-rendering the
  *unchanged* base file and seeing a comparable spread). A real user following `suggest`'s own advice
  verbatim on any non-drum track's first-ever round gets a batch of functionally identical variants
  and could easily "pick a favorite" among audio that never actually changed. **Core capability bug**
  (the group/track-type mismatch and the resulting inert-field write live in `src/core`'s vary/set
  logic, not the CLI layer) **compounded by a CLI-adjacent `suggest` defect** (its cold-start
  group-ordering has no track-type awareness). Repro: fresh project, synth track, `beat suggest <f>
  <synth-track>` before any scores exist, then run the exact command it recommends.

- **[bug] `beat suggest <file> <track>` doesn't validate the track exists, unlike every other
  track-taking command.** `beat suggest song.beat bass` (no `bass` track in the project) returned a
  normal-looking cold-start recommendation instead of erroring, while `beat vary song.beat bass kick
  ...` (the very command `suggest` recommended) correctly errors `no track "bass" (have: lead,
  drums)`. Inconsistent with the otherwise-excellent "name the problem, list valid options" error
  pattern documented in `docs/research/94`. **CLI/core validation gap** — cheap fix, add the same
  track-existence check `vary` already has.

- **[bug] `beat score` against a nonexistent batch directory throws a raw uncaught exception**
  (`Error: ENOENT: no such file or directory, open '.../manifest.json'` with a full stack trace
  through `cli/beat.mjs:877`), unlike the clean `error: ...` + exit-2 pattern used everywhere else in
  this and the prior CLI pilot (bad track name, bad scene name, bad pick number). Leaks internal file
  paths and line numbers into user-facing output. **CLI-specific** — needs a try/catch around the
  manifest read with the same error-message convention as the rest of the tool.

- **[worked well] The score → suggest loop, once past the two bugs above, is genuinely adaptive and
  well-reasoned.** After two scored rounds on `lead`'s `filter` group, `suggest` correctly identified
  a directional trend ("picks trend brighter on cutoff, mean position 77-78% of range"), explained its
  ranking method in a sentence (Bradley-Terry odds vs. an implicit baseline), and escalated
  `--amount` from 0.25 to 0.6 on the third call after two consistent rounds — real signal-following
  behavior, not a static template. The "adopt the winner" line `beat score` prints is exactly right
  for the group type (a `beat set` command for scalar param groups like `filter`; a `cp` of the whole
  variant file for `feel`, since humanize edits can't be expressed as a handful of `set` paths).
  **Core capability**, and the standout strength of this session.

- **[slow-to-discover] `vary`'s pick/reference convention is inconsistent: variants are always
  *displayed* as `v1`/`v2`/... (in the printed summary, the manifest, and `suggest`'s "adopt" lines)
  but must be *referenced* to `score` as bare integers (`1`/`2`/...).** Discovered only by
  deliberately probing with an invalid pick (`v99`) and reading the resulting error (`pick "v99" is
  not a variant number 1-6`) — a real user typing the natural `v2` (matching everything else they've
  seen on screen) would hit this same wall first. **CLI-specific**, one-line help-text fix
  (`<pick 1-3>` instead of implying the `vN` form, or just accept both forms).

- **[confusing] `vary`'s `--amount` doesn't map to an intuitive bounded range, and this isn't
  explained anywhere in the help text.** `--amount 0.3` on `filter` (base cutoff 3500 Hz) produced
  variants from 2403 Hz to 6363 Hz — roughly -31% to +82%, not a symmetric ±30%. `--amount 0.25` in a
  later round produced an even wider 1588-9059 Hz spread. Not necessarily wrong (could be an
  intentional log-scale/skewed jitter appropriate for a frequency parameter), but a new user has no
  way to predict variant spread from the `--amount` value alone, and would need several trial batches
  to build intuition. **CLI-specific documentation gap** at minimum; possibly worth a one-line
  clarification in `vary --groups` or the usage string either way.

- **[worked well] `render` continues to need zero manual daemon setup**, matching `docs/research/94`
  — every `render` call in this session (7 renders total) bootstrapped and tore down its own pipeline
  cleanly. **Core/daemon capability.**

- **[confusing, useful-to-know] `render`'s output is not byte-deterministic between identical
  re-renders of the same unchanged file**, with true-peak swings up to ~1 dB and crest-factor swings
  up to ~0.5 dB observed between two back-to-back renders of the same `song.beat`. This isn't
  necessarily a bug (the tool's own banner text says "real-time capture through dotbeat's own
  engine," implying a live-capture pipeline rather than an offline deterministic bounce), but it
  matters directly for this pilot's own methodology: small metric deltas between variants (sub-1 dB)
  can't be trusted as real without either multiple-take averaging or a delta clearly larger than the
  observed noise floor (as `vf-v2`'s ~2 dB peak jump from pushed resonance was). Worth a one-line
  mention in `render --help` or `metrics --help` so a CLI-only user doesn't over-read small
  differences. **Core/daemon capability**, not CLI-specific.

- **[confusing, minor] CLI output twice references internal source filenames** (`vary.ts`'s declared
  order; `suggest.ts`'s module doc) **in normal user-facing text**, not just in a stack trace. Doesn't
  block understanding (the surrounding sentence is still clear without knowing what `vary.ts` is) but
  reads as leaked implementation detail in an otherwise polished CLI. **CLI-specific**, cosmetic.

- **[worked well] `beat vary <track> feel` produces genuine, verifiable content variation.** Grepping
  raw hit lines (not just trusting `inspect`'s coarse grid) confirmed real fractional-timing and
  velocity jitter per variant, with per-variant seeds auto-incrementing from the batch seed — a
  legitimately useful "batch of takes" workflow for drum feel. **Core capability.**

## Where the pilot gave up on the "ideal" workflow

Nowhere outright — the full loop (build → vary → render/metrics-informed listening → score → suggest
→ informed round 2 → score → adopt) completed successfully. The one real compromise: metrics-based
"listening" for the `filter` group variants was only clearly discriminating for the one variant with
a large, resonance-driven peak jump (`v2`, +2 dB over baseline); the rest of the filter variants
differed from base and each other by amounts at or below the render pipeline's own measured noise
floor, so picks among those were made partly on the parameter values themselves (cutoff/resonance
numbers) rather than purely on metrics, same as a real user squinting at small mix-level differences
would likely fall back on knowing the underlying knob positions. A true per-track soloed render (no
such flag was found in `render --help`'s usage line) would have made single-track parameter changes
far easier to judge from metrics alone in a drum-dominated mix.

## Could a new user run a real variation-and-taste-loop session using only this CLI's own help text?

**Yes, with the loop's mechanics fully discoverable and its adaptive core genuinely working** — but
with two real correctness bugs a first-time user would likely hit unprompted, not just edge cases a
tester had to go looking for. The `vary`/`score`/`suggest` syntax was all sitting in the plain
no-arg help dump, `--groups` cleanly enumerated the mutation groups, and once scoring history existed
`suggest`'s reasoning was clear, honest about its own method, and adapted correctly across rounds
(directional trend detection, amount escalation). The serious problem is that `suggest`'s own
cold-start recommendation is unaware of track type and, on this session's very first `suggest` call
for a synth track, handed back a command (`vary ... kick ...`) that silently produces a batch of
audio-identical "variants" — exactly the kind of trap a new user has no way to detect except by doing
the ground-truth `inspect`/render-diff work this methodology requires, which a less careful user
wouldn't do. Combined with `suggest` skipping track-existence validation (unlike every sibling
command) and one raw stack trace from `score` on a bad path, the taste-loop's "smart" half is solid
but its input-validation half lags noticeably behind the rest of the CLI's otherwise very good error
discipline documented in `docs/research/94`.
