# dotbeat — Claude Code project notes

## Git: always fetch and check before pushing

**Before running `git push` on this repo, always run `git fetch origin` first and check for
divergence** — don't assume a plain push will succeed or that a rejection means "just behind."

On 2026-07-12, `git push` was rejected as non-fast-forward, and investigation found `origin/main`
and local `main` had **no common ancestor at all** (`git merge-base HEAD origin/main` returned
empty) — not a simple "behind," genuinely unrelated commit graphs. Local's oldest commit and
origin's oldest commit had identical messages but different hashes, meaning at some point local's
entire history had been rebuilt/replayed as new commit objects rather than being a normal
continuation of origin. `origin/main` had been stuck at a stale pre-Phase-22 snapshot
(`d6b9aac`, "Sync: engine consolidation through Phase 20/21 streams") since 2026-07-11, while
local `main` kept moving forward through many more sessions of real work without ever being
pushed. Resolved by force-pushing local `main` (confirmed with the owner first) since local held
all the real, current content.

**If this happens again:**
1. `git fetch origin`, then `git merge-base HEAD origin/main` — if it prints nothing, the
   histories are disjoint, not just diverged.
2. `git rev-list --left-right --count HEAD...origin/main` to see how many commits are unique to
   each side.
3. **Stop and tell the owner before force-pushing.** Force-push is the only way to reconcile a
   disjoint history, and it's a destructive, hard-to-reverse action against shared remote state —
   summarize the divergence (dates, commit counts, what's on each side) and let the owner choose
   how to reconcile, same as any other force-push/history-rewrite situation. Don't decide
   unilaterally just because local obviously has "more" or "newer" work.

## Where to look first

Don't re-derive project status from `git log` alone — read `ROADMAP.md` (thesis/architecture) and
`docs/product-roadmap.md` (live feature-by-feature status, generated from
`scripts/roadmap-data.mjs`) before proposing or building anything nontrivial. See
`docs/decisions.md` for numbered design decisions before suggesting something that might
contradict one already made.

## Usability testing is a standing practice, not a one-off

See `docs/usability-testing.md` for the full methodology. Short version: alongside `ui/verify-*.mjs`
(scripted assertions of known-correct behavior), run exploratory usability PILOTS — an agent given
only a realistic end-user goal, no checklist, driving the real app and actually reading every
screenshot before deciding what to do next, the way a human tester thinks aloud. This has
repeatedly found real, high-impact bugs the scripted verify suite structurally cannot catch (see
`docs/research/80` through `86`), because a verify script is written by someone who already believes
the behavior it's asserting is correct.

**Run one whenever a phase or stream changes GUI-facing behavior**, targeting the area that just
shipped, as part of that work's own wrap-up — the same standing-habit footing as the
roadmap/README refresh (below). Don't wait to be asked.

**The same applies to the CLI and MCP surfaces** (`docs/usability-testing.md`'s "Variant: CLI/MCP
pilots" section) — run one whenever a phase adds or changes a `beat` subcommand or an MCP tool.
These pilots are dramatically cheaper than GUI ones (research/94: ~4 minutes, 26 tool calls, versus
15-50+ minutes for a GUI pilot) since there's no screenshot-and-read loop or browser to drive, just
commands and their output — cheap enough that there's no excuse to skip one. Owner's own framing,
2026-07-12, after the first CLI pilot came back fast: "it might make sense to... encourage usability
tests whenever new features have been added on the CLI... so whenever we add to the CLI we do
usability tests to help verify."

## Dispatching parallel agents in worktrees: push before you dispatch

`EnterWorktree`/`Agent(isolation: "worktree")` branch from `origin/<default-branch>` by default
(`worktree.baseRef: "fresh"`), NOT from local `HEAD`. On 2026-07-12, six Phase 29 bug-fix streams
were dispatched into worktrees right after writing an uncommitted plan doc and committing-but-not-
pushing five research reports the streams' own prompts told them to read — the worktrees branched
from stale `origin/main` and had none of it. **If you've committed anything local-only (or have
anything uncommitted) that a soon-to-be-dispatched worktree agent needs to see, commit AND push to
origin first**, then dispatch. If you discover this after the fact, fix already-created worktrees by
`cd`-ing into each and running `git fetch origin && git merge origin/main --no-edit` — safe as long
as the agent hasn't yet made local commits that would conflict.

## Usability findings that don't fit a fix phase go in the roadmap, not a separate doc

Not every pilot finding is fixable in the phase it's found. Bigger features (a real reverse-audio
action, section/scene naming) and genuinely cross-cutting gaps (no context menus anywhere) belong in
`scripts/roadmap-data.mjs` as ordinary `not-started` rows, citing the source research doc — there's
a "Known usability gaps (backlog)" area for findings that don't fit an existing feature area, but
prefer an existing area (e.g. reverse-audio under "Audio-region clip editing") when one fits. Decided
2026-07-12 rather than inventing a second tracking system: the roadmap already has done/not-started
status, research citations, and a published dashboard — a separate backlog doc would just fork that.
Review the backlog area alongside each new pilot batch and promote items into a real phase stream
once they're scoped down enough to fit one, rather than letting them sit indefinitely.

## Refresh the roadmap artifact on phase completion

Whenever a phase/stream finishes, update `scripts/roadmap-data.mjs` and `docs/product-roadmap.md`,
then republish the HTML dashboard artifact (splice a fresh `rows` array into it, reuse the existing
artifact URL) — not just the markdown doc.

## Code-quality guardrails (distilled from the 2026-07-25 six-stream review, research/130)

**Parity is structural, never disciplinary.** When one operation is exposed on two or more
surfaces (CLI + MCP + daemon route + GUI), the shared logic lives in ONE `src/` helper both
surfaces import (D21's own words; `runVaryBatch` is the pattern), and the operation gets a row in
the CLI↔MCP parity table test. Never copy a handler and vow to keep it in sync — that vow has
been broken at least six measured times (pilot-111's silent-lanes twin, the effect-bypass
polarity inversion, three vary-tail drifts, the humanize seed divergence).

**Frozen eval constants are never edited.** `engineplusProfile`/`surgeplusProfile` (and any block
commented "frozen science") pin the exact treatments whose effects were measured in blind
ratings; editing them silently invalidates every historical comparison. They are guarded by
`===` exact-value tests — a new treatment gets a NEW named profile alongside, never a tweak.

**Sidecars go through the shared scaffold.** New Python sidecars build on
`src/analysis/spawn-sidecar.ts` (one spawn/timeout/resolver/doctor contract — never re-declare
`spawnPython`/`SPAWN_TIMEOUT_MS`), ship a `--doctor`, and register in `python/README.md`'s table.

**Seeded randomness comes from `src/core/rng.ts` only** (mulberry32 + Fisher-Yates).
`sort(() => rng() - 0.5)` is banned: biased, V8-version-dependent, and it consumes a
data-dependent number of draws so every downstream draw shifts.

**No raw control bytes in source.** NUL sentinels are written as the `\x00` escape — a literal
byte makes the file binary to grep/ripgrep, and four files were silently unsearchable for weeks
(one produced a confidently wrong review conclusion).

**A test that can silently skip is not a gate.** Missing fixtures/goldens FAIL LOUDLY with a
regenerate hint. Only explicitly env-gated dependencies (venvs, surgepy, network) may skip, each
with a named reason. Guards on measured thresholds carry calibration provenance in a comment
(complaint date + the before/after numbers that set them).

**Coordinator merge discipline.** After ANY branch merge: `npm run build`, then run the merged
area's named test files, THEN push. On 2026-07-25 a merge with unresolved conflict markers
reached origin because this order was skipped; a second merge "verified" tests on a file that
didn't exist because only pass/fail totals were grepped — confirm the specific test file ran.

**Agent survival in worktrees.** Work in tiny increments; commit each step; push the branch to
origin after EVERY commit (`git push -u origin HEAD`). Harness stalls are routine; pushed commits
are the only work that survives. Never park on a background watcher — they die with the agent;
poll artifacts in short foreground checks instead.
