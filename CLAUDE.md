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
