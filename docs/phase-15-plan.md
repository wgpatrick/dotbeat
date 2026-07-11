# Phase 15 — the two missing product-defining surfaces

*Kicked off 2026-07-11, immediately following Phase 14. Owner is away for an extended period;
continuing the take-stock-then-build loop. Phase 13 closed the "does the GUI work at all" gap;
Phase 14 closed "does it sound/feel right." This round targets two features that are core to the
project's own thesis (`ROADMAP.md` §1, §7, `docs/product-spec-desktop.md`) but have no GUI surface
at all yet, despite being fully built server-side.*

## Why these two, specifically

- **Versioning** (D3, `docs/decisions.md` D10) — checkpoints, named pins, collapsed history —
  shipped entirely as CLI/MCP surface (`beat history`/`beat pin`/`beat restore`). The product
  spec's own owner-quote requirement ("we make changes — we want to store the previous version so
  you can go back") has zero GUI presence. A user in the Mac app today has no way to see or use
  version history at all.
- **The vary-and-audition loop** (D5, D2's selection protocol) — this is the project's own named
  differentiator, the owner's exact demo scenario from `docs/product-spec-desktop.md` §1: *"I
  might highlight the drum track, or the hi-hats, and be like, hey, change this up."* The backend
  (`beat vary --scope selection`, reading the daemon's `/selection`) has existed since Phase 9. A
  Phase 11 attempt to build the GUI half was discarded under D12 (it was built inside BeatLab's
  React tree, before dotbeat had its own frontend) and never rebuilt in `ui/`. This is arguably the
  single most-differentiating feature of the whole product, and it currently has no GUI at all.

Neither the daemon (`src/daemon/daemon.ts`) exposes routes for either yet — both streams need one
small, additive daemon route plus the actual `ui/` surface.

## Stream H — history/checkpoint panel

1. **Daemon route(s)**: expose `beat history`'s data (checkpoint list, semantic one-line labels,
   pins) and a restore action over HTTP — read `src/history/history.ts` for the real underlying
   functions to call (reuse them, don't reimplement), and `cli/beat.mjs`'s `history`/`pin`/
   `unpin`/`restore` command handlers for the calling convention. Keep new routes additive; run
   the FULL `npm test` if you touch `src/daemon/daemon.ts` or `src/history/*`.
2. **GUI panel** in `ui/`: a new view or panel (your call whether it's a fourth tab alongside
   Editor/Arrangement/Mixer, or a slide-out panel — `docs/product-spec-desktop.md` §4 describes
   the target UX: "a linear list — timestamp, one-line semantic diff, play button, restore
   button," collapsed unnamed checkpoints between named pins). List real checkpoints from a real
   project's history repo, each with its semantic label; a restore button that actually calls the
   restore route and confirms the file/GUI updates. Naming pins (the `beat pin` equivalent) is in
   scope if time allows; restore is the must-have.
3. **Verify live**: build a real project with a few checkpoints (make some edits via the CLI or
   GUI first so there's real history to show, or use an existing project's history repo if one
   exists), load the panel in headless Chromium, confirm real checkpoint data renders (not empty/
   placeholder), click restore, confirm via `git log`/reading the `.beat` file that the restore
   actually happened and the GUI reflects it.

Owns: one new `ui/src/components/HistoryPanel.tsx` (or similar), minimal additive changes to
`ui/src/App.tsx` for navigation, `src/daemon/daemon.ts` (additive routes only).

## Stream I — selection + vary-and-audition affordance

The owner's own target scenario, rebuilt properly in `ui/` this time (not BeatLab's tree).

1. **Daemon route**: an HTTP equivalent of `beat vary --scope selection` — reuse `src/vary/
   vary.ts`'s actual functions (don't reimplement), reading the daemon's existing `/selection`
   state. Needs to return enough for the GUI to audition a batch (the variant renders/params) and
   a way to accept ("keep") or discard one. Read `docs/product-spec-desktop.md` §2/§3 for the
   target UX: applied *revertibly* — hear it, then Keep/Undo (VS Code's model per research 10).
2. **GUI**: a lightweight, inline trigger at the current selection (research 15's/10's validated
   pattern: Cursor Cmd+K-style, not a full modal) — the Arrangement view and the per-track editor
   both already have selection state (`ui/src/state/store.ts`), wire the affordance off that.
   Triggering it calls the new vary route; present results as a minimal but real audition strip
   ("variant 1 of N — Keep / Next / Undo"), not a polished mock that doesn't actually call the
   backend.
3. **Verify live**: select something real (a track, a lane, a bar range) in the GUI, trigger vary,
   confirm a real variant batch comes back, keep one, confirm via `git diff`/reading the `.beat`
   file that the kept variant is actually what's now on disk. This is the exact "highlight the
   hats, run vary" scenario — prove it end to end.

Owns: new `ui/src/components/VaryAffordance.tsx` (or similar), minimal additive changes wherever
selection is currently rendered (`ArrangementView.tsx`/editor views — coordinate mentally with
whatever exists, don't fight it), `src/daemon/daemon.ts` (additive route only, run full
`npm test` if touched).

## Process

Same worktree pattern. Both streams may touch `src/daemon/daemon.ts` additively — small,
acceptable collision risk, handled at merge same as every prior phase. Both are `ui/`-heavy but in
different, mostly-new files, low collision there. `npm test` must stay green throughout
(293+/287+/0/6).

## Result (2026-07-11)

Both streams shipped and are merged into `main`, both fast-forward with zero merge conflicts.
Final suite unchanged: **293 tests, 287 passing, 0 failing, 6 skipped**.

- **Stream H**: real history panel (`GET /history`, `POST /restore`, `POST /pin`/`/unpin`, all
  thin HTTP faces on `src/history/history.ts`'s existing functions). Verified against a real
  git-backed project: checkpoints match `beat history`'s own output 1:1, restore genuinely
  append-only (git log grew 4→5 commits, not a rewind — the restored-from commit stays intact),
  GUI reflects the change live. **Real finding worth remembering**: `beat set`/`beat add-note`
  do NOT auto-checkpoint as D3's design assumed — only explicit `beat checkpoint` does. Deferred:
  collapsed view, a play button, a GUI unpin control (route exists, no button yet).
- **Stream I**: the vary-and-audition affordance — the project's own named differentiator,
  finally with a real GUI. `POST /vary` resolves the daemon's live selection into a scoped variant
  batch (reusing `src/vary/vary.ts`'s real functions, enforcing scope — throws if aimed outside
  the selection), never writing to disk until Keep. The GUI audition strip actually plays each
  variant live through the running engine (not a static preview). Verified with a precise
  before/after diff: stepped through 3 variants, kept #3, confirmed the exact kept params (not
  variant 1, not the original) landed on disk. Deferred: lane-granular selection (currently
  track-level; the daemon-side group inference already supports lanes, the click gesture just
  isn't wired in `StepSequencer.tsx` yet), rung-2 `feel` variation over the affordance, wiring
  Keep into the `beat score` exhaust.
- **Both streams' daemon routes landed with zero conflicts** — Stream I branched from a base that
  already included Stream H's merged routes, so `daemon.ts` merged clean both times.
- **What this closes**: at this point, both of the two GUI-absent, product-defining surfaces
  identified at the top of this phase (versioning, the vary-and-audition loop) are real and
  live-verified, alongside Phase 13/14's engine parity, full editing, arrangement/mixer views, and
  a genuinely packaged Mac app. The remaining gaps across Phases 12-15 are now mostly smaller
  polish items (lane-granular vary selection, collapsed history display, instrument-track
  meters/FX, velocity-drag note editing, insert-chain reordering) rather than missing surfaces.
