# Usability pilot 98: revising an existing project via the CLI (no GUI)

## Intro

This pilot picks up an **existing, multi-track project cold** — the opposite of pilot 94, which
built a song from scratch. The goal: copy `examples/night-shift.beat` to a disposable scratch
project, use `beat inspect` to understand what's already there with zero prior familiarity, then
make a real revision pass using the CLI verbs pilot 94 never touched (`quantize`, `humanize`,
`transpose`, `time-scale`, `fit-scale`, `set`, `effect-add/-rm/-move/-bypass`, `group`/`rm-group`/
`group-set`), reviewing every edit with `beat diff --git` the way a human would review an agent's
changes, and deliberately trying wrong paths. `examples/night-shift-song.beat` (the owner's live
project) was never touched; work happened entirely in `/tmp/dotbeat-usability-98-existing-project/`
with its own scratch git repo for `diff --git` to compare against.

## Narrative walkthrough

**Cold discovery.** `node cli/beat.mjs` with no args gave the full ~70-line command dump (same as
pilot 94 found — dense but complete). `beat inspect song.beat` cold showed 4 tracks (lead synth,
drums using 5 of its 12 available lanes, bass synth, pad synth), 124 bpm, 4 bars/64 steps — a
plausible small song, immediately legible without opening the raw file.

**Baseline metrics before touching anything.** `beat render` worked with zero manual daemon setup
(confirmed: dotbeat's own `ui/`-engine render path, no BeatLab needed, matching the skill's D15
note). `beat metrics`/`beat lint` on the baseline immediately surfaced three real, unprompted
issues: true-peak clipping (0.3 dBTP, above the -1 dBTP safe line), low-end-heavy (91% of energy
below 250 Hz), and dull-top-end (0.8% above 2 kHz). This gave the whole editing pass a real,
motivated target instead of arbitrary busywork — exactly the "ground truth over vibes" loop the
project's own docs describe.

**`beat set` (direct param tweak), driven by lint's own suggestion.** `beat set song.beat
bass.volume -1 bass.cutoff 900` applied cleanly with a before→after print. Diffed and confirmed via
`beat diff --git HEAD~1 HEAD song.beat` — output matched the `set` command's own print exactly, no
surprises. **But the payoff was disappointing**: re-rendering and re-linting at the very end of the
session showed true peak still pinned at exactly 0.3 dBTP and low-end-heavy still at 90% — my fix,
taken directly from lint's own remedy text, didn't move the needle, because lint's fix message
("lower track volumes ... `beat set song.beat <track>.volume <dB>`") never says *which* track is
actually the offender. See finding 1.

**`beat humanize`**, scoped to just the hat lane: `beat humanize song.beat drums --lanes hat --seed
42` produced 16 lines of real seeded timing+velocity jitter, correctly scoped (no other lane
touched). `inspect` afterward even added a `(16 hits, 16 off-grid)` annotation to the hat row —
genuinely helpful ground-truth confirmation without needing the raw file.

**`beat quantize` — found a real bug.** Quantizing `lead` to a quarter-note grid (`--grid 4`) moved
exactly the one note that wasn't already on that grid: step 62 → 64. Reasonable on its face, but
the project is a 4-bar/64-step loop (valid steps 0-63) — the note now sits at step 64, i.e.
**exactly one step past the loop's own end**, with zero warning from the command. Confirmed via
`inspect` (`steps 20-64 of 64`) and the raw file (`note u100039 76 64 2 0.5`). See finding 2.

**`beat transpose`** (+12 semitones on `pad`) and **`beat fit-scale`** (`bass 9 minor`) both worked
exactly as documented; `fit-scale` gave a genuinely nice UX touch — `no musical changes` /
`already in scale — no notes moved` instead of silently doing nothing, confirming the bass line was
already diatonic to A minor rather than leaving that ambiguous.

**`beat time-scale`** (`lead 0.5`, halving duration) anchored correctly at the earliest note (per
its own help text) and, as a side effect, pulled the out-of-loop note from quantize back in bounds
(64 → 42) — a nice illustration of why re-diffing after every step matters, not just at the end.

**`beat effect-add`/`effect-move`/`effect-bypass`.** Adding `grainDelay` to `lead`, moving it to
index 0, and bypassing it all worked and each printed a clear before/after. Isolating `effect-move`
in its own commit showed the **raw git diff really is the promised "two-line diff, not a rewrite"**
(one line relocated) — but `beat diff --git`'s own musical summary for the same edit was *four*
lines (every effect whose position number shifted got its own "moved from X to Y" line), which is
chattier than the raw text diff for this one operation. See finding 3.

**`beat group`/`group-set`/`rm-group` — found the pilot's second real bug.** `beat group song.beat
rhythm bass drums --name "Rhythm Section"` was correctly rejected (`group names are single tokens
(no whitespace)`) — retried as `RhythmSection`, succeeded, and `beat diff --git` correctly reported
`group added "rhythm" (...)`. But **`beat inspect`'s plain-text view showed absolutely no trace of
the group** — no group section, no per-track membership marker — even though `--json` and
`diff --git` both correctly reflected it. `group-set` (rename) and `rm-group` (confirmed bass/drums
left untouched after ungrouping) both worked cleanly and were correctly reported by `diff --git`.
See finding 4.

**Wrong paths.** Five deliberate bad commands:
- `set song.beat melody.cutoff 900` (no such track) → clean `error: no track "melody" (have: lead,
  drums, bass, pad)`, exit 2.
- `set song.beat bass.frobnicate 900` (no such param) → clean error naming the bad field and
  dumping the full valid-field list (~110 names) — thorough to the point of being a lot to read, but
  genuinely recoverable.
- `quantize song.beat bass --amount 5` → clean `error: amount must be 0..1, got 5`, exit 2.
- `quantize song.beat bass --grid -3` → clean `error: grid must be > 0 steps, got -3`, exit 2.
- `humanize song.beat bass --timing -1` → **raw uncaught exception** (`BeatHumanizeError: timing
  must be >= 0, got -1` plus a full Node stack trace through `dist/src/core/humanize.js`), not the
  clean `error: ...` format every other command used. File was NOT corrupted (confirmed via `git
  status` in the scratch repo — no changes written), so the failure was safe, just ugly. The same
  raw-stack-trace pattern also showed up earlier and independently in `beat diff --git` when given
  an invalid git rev (`working`/`WORKDIR` instead of a real ref) — two different commands, same
  underlying gap: some code paths in `cli/beat.mjs` aren't wrapped in the same clean error handler
  as the rest. See finding 5.

**Full-session diff as the closing check.** `beat diff --git 5b09a36 HEAD song.beat` (baseline vs.
final, spanning 10 commits and every command above) produced one clean, track-grouped summary of
every real net change — and correctly showed **nothing at all for the group/rm-group pair**, since
they canceled out to a no-op net state. That's a genuinely strong result: the diff engine does true
structural comparison against final state, not a replay log of commands, so it doesn't accumulate
noise from actions that were later undone.

## Findings summary

- **[bug] `beat lint`'s fix suggestions don't identify which track is the actual offender.** Both
  the true-peak-clipping and low-end-heavy warnings suggest a generic pattern (`beat set song.beat
  <track>.volume <dB>`) without saying *which* track's volume/cutoff is driving the problem. I
  applied the suggested fix to `bass` (the track with the most obviously reducible volume: 3 dB, the
  loudest) and after a full re-render, true peak was unchanged at exactly 0.3 dBTP and low-end-heavy
  barely moved (91%→90%). A user or agent following lint's own advice literally can pick the wrong
  track and see zero improvement with no signal that they picked wrong. **Core capability**
  (`src/core` lint logic), not CLI-specific — the same underspecified fix text would mislead a GUI
  user too.

- **[bug] `beat quantize` can silently push a note past the loop's own boundary with no warning.**
  Quantizing `lead --grid 4` moved a note from step 62 to step 64 in a 4-bar/64-step loop (valid
  steps 0-63) — the note now sits exactly one step outside the loop, confirmed via `inspect` (`steps
  20-64 of 64`) and the raw file. Whether this note still plays, gets clipped, or is silently dropped
  at render time wasn't verified further, but the command gave zero indication anything unusual
  happened. **Likely core capability** (`src/core` quantize logic) — the CLI just surfaces it
  silently; a GUI doing the identical operation would have the same underlying risk unless it has
  its own boundary-check UI the CLI lacks.

- **[bug] Two different commands leak raw Node stack traces instead of clean errors.**
  `beat humanize <file> <track> --timing -1` throws an uncaught `BeatHumanizeError` with a full
  stack trace through `dist/src/core/humanize.js`, and `beat diff --git <bad-rev> <rev> <file>`
  throws an uncaught git-show failure with its own stack trace — both very different from the clean
  `error: ...` + exit 2 pattern every other command in this session used (bad track name, bad param
  name, bad quantize amount/grid all had clean messages). Neither corrupted the file (confirmed via
  scratch-repo `git status`), so recovery is fine in practice, but the inconsistency suggests
  `cli/beat.mjs`'s error-handling wrapper isn't applied uniformly across all command handlers.
  **CLI-specific** (error formatting/catch-wrapping in `cli/beat.mjs`).

- **[bug] `beat inspect`'s plain-text view never displays track groups**, even though `--json` and
  `diff --git` both correctly reflect them. After `beat group song.beat rhythm bass drums --name
  RhythmSection` succeeded (confirmed via its own command output and via `--json`/`diff --git`),
  plain `inspect` — the tool's own documented "run this first, every time" ground-truth check —
  showed no group section and no per-track membership marker anywhere in its output. A user relying
  on the default `inspect` view (as pilot 94 did throughout, and as the project's own `dotbeat`
  skill instructs) would have no way to confirm a group exists at all. **CLI-specific** (display
  formatting gap, most likely in the same inspect-rendering code pilot 94 flagged for the drums
  `synth:` line, but here it's a total omission of a feature category rather than an extra line).

- **[confusing] `effect-move`'s musical diff is chattier than the raw text diff it's meant to
  improve on.** Isolating a single `effect-move` in its own commit showed the raw git diff really is
  the promised "two-line diff, not a rewrite" (one effect line relocated). But `beat diff --git`'s
  musical summary for the identical change printed four lines — one "moved from position X to Y" per
  *other* effect whose index number shifted, even though those effects didn't conceptually move.
  This inverts dotbeat's core pitch ("a musical edit list, not line noise") for this one operation:
  the line-noise diff was the more concise, easier read. **CLI-specific** (the diff-rendering logic
  for effect reorders, likely shared with `song-move`'s presumably-identical renumbering pattern,
  which wasn't separately tested this session).

- **[worked well] `beat diff --git` over a full multi-command session (10 commits, 6 different edit
  verbs) produced one clean, per-track-grouped summary matching exactly what happened — and
  correctly showed nothing for the `group`/`rm-group` pair since they canceled to a net no-op.** This
  is genuine structural diffing against final state, not a replay log, and it's the single strongest
  piece of evidence in this session that the diff output is "genuinely legible" per the pilot's
  stated question — I never once had to fall back to re-reading the raw file to understand what an
  edit (or the whole session) had actually done. **Core capability** (`src/core` diff engine).

- **[worked well] `fit-scale` gives an explicit "already in scale, no notes moved" message** instead
  of a silent no-op, when applied to a bass line already diatonic to the target scale — this is
  exactly the kind of positive-confirmation signal that prevents a user from wondering whether the
  command silently failed. **Core capability.**

- **[worked well] Ordinary validation errors (bad track, bad param, bad quantize amount/grid, bad
  group name) are uniformly clean, exit non-zero, and name valid alternatives where relevant** (e.g.
  `no track "melody" (have: lead, drums, bass, pad)`) — consistent with pilot 94's finding, and it
  held up across every new verb tested this session except the two stack-trace cases above.
  **Core/CLI shared pattern**, mostly working well.

- **[worked well] `render`/`metrics`/`lint` round-trip required zero manual daemon setup** at any
  point, confirming pilot 94's finding still holds and that `beat render`'s BeatLab dependency has
  indeed been retired in favor of dotbeat's own `ui/` engine (per `docs/decisions.md` D15). **Core/
  daemon capability.**

## Where the pilot gave up on the "ideal" workflow

Nowhere outright abandoned — every command in the goal list was reachable and every edit landed as
intended once the (mostly clean) error messages were read. The closest thing to a workaround: after
`beat lint`'s generic volume-fix advice didn't resolve the true-peak/low-end warnings, a real user
would need to iterate across each of the 4 tracks' volumes individually (or inspect the per-track
spectral contribution some other way dotbeat doesn't currently expose) rather than trusting the
first suggested fix — that iteration wasn't carried out further in this session since the goal was
breadth of command coverage, not fully resolving the mix.

## Verdict

**Yes — a new user or an AI agent could pick up someone else's existing dotbeat project cold and
make a real, legible editing pass using only the CLI**, and `beat diff --git` genuinely delivered on
its "musical edit list, not line noise" pitch for the session as a whole: not once did I need to
fall back to re-reading the raw `.beat` file to understand what an edit had done. The friction found
here is narrower and more surgical than pilot 94's (which had one big first-conversation-ending
gotcha, the velocity-scale convention) — this session's issues are two real bugs (silent
out-of-loop quantize, groups invisible in plain `inspect`), one real gap in lint's actionability
(names a fix pattern, not the offending track), one inconsistency in error handling (stack traces on
two of ~10 tested error paths), and one narrow diff-verbosity inversion on effect reordering. None
of these were session-ending; all were individually recoverable. The strongest result: a 10-commit,
6-verb editing session, diffed end-to-end in one command, produced output a human reviewer could
trust and act on without opening the file — which is the whole thesis this pilot was built to test.
