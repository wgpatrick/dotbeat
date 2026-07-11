# Phase 9 — `beat suggest`: variation-loop rung 3 (preference surrogate over the scores exhaust)

*Started 2026-07-11. docs/variation-loop.md names this explicitly as the next rung, "gated on
accumulated exhaust: preference surrogate + clustering (peer-reviewed precedent), then
preferential BO / plane-search." This phase builds the first half — the preference surrogate —
and is honest that clustering and preferential BO remain future work.*

## Problem

Rung 1 (`beat vary` / `beat score`, shipped 2026-07-10) gives a human a batch of 9 candidates to
rank, and appends the ranked picks + rejects to an append-only `beat-scores.jsonl`. After a
handful of rounds, that log is real signal about what a given track's owner likes — but nothing
reads it back. Every round still starts from a blank slate: the human (or the agent driving
`beat vary` on their behalf) has to remember which mutation group scored well last time and
re-type the same guess. Rung 3 closes that loop: read the log, say what won and why, print the
next command.

## What's actually in the log (verified against the real writer, not assumed)

`cli/beat.mjs`'s `scoreCmd` appends one JSON object per line:

```json
{
  "t": "2026-07-11T07:31:29.069Z",
  "batch": "vary-filter-5",
  "track": "drums",
  "group": "filter",
  "amount": 0.25,
  "seed": 5,
  "parentSha256": "45e54af9...",
  "picks": [
    { "rank": 1, "variant": "v1.beat", "edits": ["drums.cutoff 11000", "drums.resonance 0.2"] },
    { "rank": 2, "variant": "v2.beat", "edits": ["drums.cutoff 11000", "drums.resonance 0.2"] },
    { "rank": 3, "variant": "v3.beat", "edits": ["drums.cutoff 2372.2136", "drums.resonance 0.2"] }
  ],
  "rejected": ["v4.beat", "v5.beat", "v6.beat", "v7.beat", "v8.beat", "v9.beat"]
}
```

Two things this pass got wrong on the first draft and fixed after running it against a real log:
`edits` is an array of **plain `"<track>.<param> <value>"` strings** (exactly what `varyCmd`
writes into `manifest.json`), not `{path, value}` objects — and `feel` rounds (rung 2) carry a
`recipe` string per pick instead of `edits`, since humanize isn't a set-replayable diff. Both
shapes are handled.

**The load-bearing structural fact**: every `beat vary` round mutates exactly ONE mutation
group (rung 1's design — "one parameter group at a time" per the prior-art research). So
mutation groups never appear together in the same batch and never face off head-to-head. This
shapes the whole method below.

## Design

### Per-group strength: Bradley-Terry odds-form, honestly scoped

The docs name Bradley-Terry as the reference model for turning pairwise win/loss counts into a
per-item strength. A textbook BT fit needs items to play each other directly. Because groups
never share a batch, there is no group-vs-group trial anywhere in this data — full multi-way BT
is not available here, by construction, not by omission.

What the log does contain, per round: picked variants (wins) and rejected variants (losses) from
that round's one group, against a shared implicit baseline ("didn't make the cut"). That is
exactly the degenerate case of Bradley-Terry where every player only ever faces one common
reference opponent — the closed-form strength update for that case collapses to
`strength ∝ wins / losses` (the picked-vs-rejected odds). `computeGroupStats` in
`src/vary/suggest.ts` computes exactly that, pooled across all of a track's rounds per group,
with Laplace smoothing (+0.5/+0.5) so a single-round group doesn't produce infinite or zero odds
— essential given the expected n (a handful of rounds, not thousands; docs/research/08 says
usable sounds land in 2-12 generations).

**This is a real, principled use of the BT odds-form — not an ad-hoc score — but it is not a
full head-to-head fit**, and every reasoning string the tool prints says so explicitly (see the
"honesty note" atop `src/vary/suggest.ts`). It ranks groups; it does not prove one group is
inherently better than another, since a decisive human mood and an inherently good direction are
indistinguishable from the same win/loss counts.

### Direction-within-group: a separate, simpler heuristic (not Bradley-Terry)

Where a winning group's picks carry numeric edits that overlap on a param (e.g. `cutoff`), each
picked value is normalized into that param's `VARY_GROUPS` range from `vary.ts` (log-space for
log-scale params, matching the mutation space itself) to a position in `[0, 1]`. If at least 3
samples exist and their mean position sits at least 0.15 away from the 0.5 midpoint, the tool
reports a trend ("picks trend brighter on cutoff, mean position 88% of range, n=3"). Below that
bar it says so plainly rather than inventing a direction. `cutoff`, `hatTone`, `kickTune`, and
`osc2Detune` get frequency-flavored labels (brighter/darker); everything else gets neutral
higher/lower.

### Next-round proposal

- **Cold start** (no log, or no entries for the track / `--target`): recommends the first group
  in `vary.ts`'s declared `VARY_GROUPS` order (`kick` today) at the rung-1 default amount
  (0.25), and says plainly that there's nothing to bias toward yet.
- **Warm**: recommends the top-ranked group. `--amount` starts at the rung-1 default (0.25),
  steps up to 0.4 once a group has ≥2 rounds and a pooled pick rate ≥0.3 (roughly 3-of-9, the
  top of the default batch's pick budget — i.e. "usually get real winners here"), and steps up
  again (capped at 0.6) if a directional trend was also found — push further in a direction
  that's working. This is a simple monotone heuristic, not fit to any data; it exists so the
  recommended command matches the intuition "if it keeps working, push harder."
- `feel` rounds get a command without `--amount` (`varyFeel` has no amount knob).
- `--target <lane-or-id>` scopes the log to rounds whose group name, edit paths, or feel recipe
  mention the target string — a best-effort focus filter, since the log has no first-class
  lane/id field for param-group rounds.
- Every seed is freshly drawn (`Date.now()`-based, injectable as `now` for tests) so the printed
  command is immediately runnable, not a placeholder.

## What shipped

- `src/vary/suggest.ts`: `parseScoresLog` (tolerant of blank/malformed lines — the log is
  hand-append-only exhaust), `suggestNext` (pure function of parsed entries; no filesystem
  access, matching `vary.ts`'s own pure-core convention).
- CLI: `beat suggest <file> <track> [--target <lane-or-id>] [--log f]` (`cli/beat.mjs`,
  `suggestCmd` + USAGE entry + dispatch case).
- MCP: `beat_suggest` tool in `src/mcp/server.ts`, same reasoning-as-text contract as the CLI.
- `test/vary-suggest.test.ts`: cold start (no log; log exists but not for this track), a
  deliberate two-group win-pattern with exact count assertions, the honesty-labeled reasoning
  text, directional-trend detection and its absence (too few samples / no clear trend), the
  `--target` filter, `parseScoresLog`'s tolerance of blank/malformed lines, and the
  all-picked/zero-rejected edge case (Laplace smoothing doesn't blow up).

## Exit criteria

- [x] `beat suggest` reads a real `beat-scores.jsonl` (verified against actual `beat vary` /
      `beat score` output, not an assumed schema) and prints sample size + per-group counts +
      the recommended command — never a bare score.
- [x] Cold start (no scores yet) is handled explicitly, recommending a sensible first round.
- [x] Small n (2-4 rounds) produces a real recommendation, not a paralysis case.
- [x] MCP tool mirrors the CLI.
- [x] New tests green; `npm test` green modulo the pre-existing `history.test.js` macOS
      tmpdir/git flake (unrelated to this change).
- [ ] Not attempted, deliberately: clustering to pre-filter batches (rung 2 of the docs' ladder —
      "learned preference surrogate + clustering," Machwe & Parmee precedent) and preferential
      BO / plane-search (rung 3's other half, Sequential Gallery — "unproven on audio," per
      docs/research/08). Both need more accumulated exhaust than a fresh project has; this phase
      only builds the read side of what already exists.

## Result (2026-07-11)

Built and verified live against a real project: `beat vary song.beat drums filter --seed 5`,
`beat score vary-filter-5 1 2 3`, `beat vary song.beat drums kick --seed 6`,
`beat score vary-kick-6 1`, then `beat suggest song.beat drums` correctly ranked `filter` above
`kick` (3/9 vs 1/9 pooled pick rate) and reported a directional trend toward higher `cutoff`
("brighter") from the three filter picks. Confirmed the same round-trip through the MCP
`beat_suggest` tool over the real JSON-RPC stdio protocol (not just unit tests). `npm test`:
205 tests, 199 pass, 6 fail — all 6 are the pre-existing `history.test.js` macOS
tmpdir-symlink-vs-git-realpath flake (unrelated, present before this change); the 9 new
`vary-suggest.test.ts` tests and everything else pass.

Honest limitation, restated: the per-group ranking is a real application of the Bradley-Terry
odds-form, but only in the "vs. a shared implicit baseline" degenerate case — it cannot separate
"this mutation group finds good sounds" from "the human was more decisive that round," because
groups never compete head-to-head in this data by rung-1's own single-group-per-round design.
Treat `beat suggest`'s ranking as a steering signal for exploration, the way the docs frame the
whole loop — not as a proof that one group is musically better than another. The direction hint
is a plain descriptive average, not a statistical test, and is only reported once it clears a
deliberately conservative sample-size and deadband bar.
