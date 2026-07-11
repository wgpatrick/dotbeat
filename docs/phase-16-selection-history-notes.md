# Phase 16 Stream J — selection granularity + history display + note editing polish

*Built 2026-07-11. Closes three deferred items called out by their own originating streams:
Phase 15 Stream I's lane-granular selection, Phase 15 Stream H's collapsed history view, and
Phase 13 Stream B's velocity-drag gesture. Stream K (instrument meters + insert-chain UI) ran
concurrently in `ui/src/audio/engine.ts` / `ui/src/components/MixerView.tsx` — disjoint files,
no merge conflicts expected or encountered.*

## Worktree note

This worktree, like Phase 15 Stream H's before it, was created from `origin/main` (stale, no
`ui/`, no `src/history`, no `src/daemon`, pre-D1) rather than local `main` (which already had
Phase 16's plan, Phase 15 in full, and everything back through Phase 9). The working tree was
clean at start, so the branch was reset onto local `main` (`git reset --hard main`) before any
work began — no work was lost, this only replaced the stale base. All subsequent work is on top
of the real current tree.

## Item 1 — lane-granular selection for the vary affordance

**What was built.** `StepSequencer.tsx`'s lane label button (`.seq-label`, previously only a
`engine.previewDrum(lane)` audition trigger) now also calls `postSelection({tracks:[track.id],
lanes:[{track:track.id, lane}]})` on click — the exact `BeatSelection` shape
`resolveVaryTarget` (`src/daemon/daemon.ts`) already reads to infer a param group from a
selected drum lane (hat/openhat→`hats`, kick→`kick`, snare/clap→`snare`). Preview still fires on
the same click, so the gesture reads as "audition + select this lane," not a new, separate
action. The toolbar tip was updated to say so.

No daemon change was needed for this item — `resolveVaryTarget` and the `/vary` route's group
inference from a lane selection have existed since Phase 15 Stream I; only the GUI-side selection
POST was missing, exactly as that stream's deferred-items note said.

**Verification** — `ui/verify-phase16-lane-vary.mjs`, headless Chromium against a real daemon on
a real git-backed project (`examples/night-shift.beat`). Deliberately selects the **kick** lane,
not hats — hats is already the drums track's per-kind vary default, so a correctly-labelled "vary
hats" trigger wouldn't prove the lane selection did anything. Only kick proves it:

- **L1**: clicking the kick lane label posts `{tracks:["drums"], lanes:[{track:"drums",
  lane:"kick"}]}` (confirmed both in the store *and* by reading it straight back from
  `GET /selection` on the daemon), and the vary trigger reads `"≈ vary kick"`.
- **L2**: `POST /vary` was fetched **directly** (not eyeballed off the UI) and its batch inspected
  — all 21–25 edit paths across the 9 variants (real run-to-run count varies with the RNG) are
  `drums.kickTune` / `drums.kickPunch` / `drums.kickDecay` only. None touch `hatTone`/`hatDecay`/
  `openHatDecay`/`snareTone`/`snareDecay`.
- **L3**: drove the full audition→Keep loop through the GUI; the resulting `git diff`'s changed
  lines (`+`/`-`, filtered from unchanged context) mention only kick fields:
  ```diff
  -    kickPunch 0.08
  -    kickDecay 0.5
  +    kickTune 34.7731
  +    kickPunch 0.1629
  +    kickDecay 0.2994
       hatDecay 0.04
       openHatDecay 0.3
  ```
  (the `hatDecay`/`openHatDecay` lines above are unchanged context, not part of the diff —
  the script's first pass at this check flagged that false positive and was corrected to only
  inspect `+`/`-` lines, not full-diff text.)

Screenshot: `ui/verify-p16-lane-vary.png`.

## Item 2 — collapsed history view

**What was built.**

- **Daemon** (`src/daemon/daemon.ts`, additive): `GET /history` now accepts `?collapsed=true`.
  Without it, behavior is byte-for-byte unchanged (`{entries: HistoryEntry[]}` from `history()`).
  With it, the route calls `collapsedHistory()` (which has existed in `src/history/history.ts`
  since Phase 15 Stream H, and was already wired into `beat history --collapsed` / MCP's
  `beat_history{collapsed:true}` — only the daemon/GUI path was missing) and returns
  `{rows: HistoryRow[]}` instead — a mix of real checkpoint rows and `{kind:'collapsed', count}`
  fold-summary rows. `?limit=N` composes with either mode.
- **GUI** (`HistoryPanel.tsx`): added a `collapsed` boolean (**default `true`**, per
  `product-spec-desktop.md` §4's "a long timeline still skims") with a "Show all" / "Collapse"
  toggle button in the panel header. The row list now walks `HistoryRow[]` — real rows render
  exactly as before (restore/pin actions intact), and `{kind:'collapsed'}` rows render as a
  centered, dashed, non-interactive "N more checkpoints" line (`.history-row-collapsed`). Flat
  mode fetches `/history` and wraps each `HistoryEntry` as `{kind:'checkpoint', ...e}` client-side
  so both modes share one render path.
- `ui/src/types.ts` gained the mirrored `HistoryRow` union type.

**Verification** — `ui/verify-phase16-history-collapse.mjs`. Built a **real** 8-checkpoint project
via the actual `beat` CLI (`beat checkpoint` / `beat set` / `beat checkpoint` × 7 more), then
pinned two interior checkpoints (`beat pin ... chorus`, `beat pin ... verse`) so there's a genuine
**leading**, **interior**, and **trailing** run of unnamed checkpoints to fold — not a
one-pin toy case:

- **Route cross-check**: `GET /history?collapsed=true` returns 5 rows
  (`collapsed(2), checkpoint(chorus), collapsed(2), checkpoint(verse), collapsed(2)`), matching
  `beat history --collapsed`'s own output exactly; plain `GET /history` still returns
  `{entries: [...8]}` unchanged — confirming the change is additive.
- **C1**: the panel's *default* render is collapsed — 3 fold rows + the 2 pinned checkpoint rows,
  each fold reading "2 more checkpoints", both pins' badges (`📌 chorus`, `📌 verse`) showing.
- **C2**: clicking "Show all" re-fetches flat and renders all 8 real checkpoints, refs matching
  `beat history` 1:1 in order (same ground-truth cross-check pattern as Phase 15 Stream H's H1).
- **C3**: toggling back to collapsed reproduces the identical 5-row fold shape.

Screenshot: `ui/verify-p16-history-collapse.png`.

## Item 3 — velocity-drag in the piano roll

**What was built.** A dedicated velocity-lane strip (`.noteview-vel-lane`, `VEL_LANE_H = 46px`)
below the note grid in `NoteView.tsx`, not a modifier-key overload on the existing move gesture —
kept as a separate strip so it can't be confused with a move/resize drag and needs no modifier
key to discover. One bar per note, x-aligned under its note in the grid, height proportional to
velocity. Pointer-down-and-drag (or a plain click, which also sets a value immediately) on a bar
computes velocity from the vertical position within the lane (`velocityFromY`: top = 1.0, bottom
= 0.05, floored above 0 since this edits an already-sounding note) and, same as move/resize,
posts through the existing edit path — `<track>.note.<id>.velocity` — via `postEdit`, unchanged
in `src/core/edit.ts`. Selecting a note also highlights its velocity bar (`.selected`), and the
toolbar tip and CSS were extended to match the existing note-view visual language.

**Verification** — `ui/verify-phase16-velocity.mjs`. One caveat found during development: the
velocity lane sits below the note grid, off the initial 800px-viewport fold, and Playwright's
`page.mouse` coordinates are viewport-relative — a drag computed from `boundingBox()` without
scrolling first silently lands on nothing. Fixed by `scrollIntoView({block:'center'})` before
computing drag coordinates; documented inline in the script since it's a real trap for anyone
extending piano-roll gesture tests.

- **V1**: dragging fixture note `u100033` (from `examples/night-shift.beat`'s `lead` track,
  `pitch 76 start 20 dur 2 vel 0.7`)'s velocity bar toward the top of the lane raised its velocity
  0.7 → 0.95 (live in the store immediately), landing on disk as **exactly one changed file
  line**: `-  note u100033 76 20 2 0.7` / `+  note u100033 76 20 2 0.95`.
- **V2**: dragging the same bar toward the bottom lowered velocity 0.95 → 0.05 — proving a real
  bidirectional analog drag, not a fixed toggle — again exactly one changed line.
- **V3** (checked inline in both V1/V2): pitch/start/duration are asserted unchanged after each
  drag, both in the live store and in the on-disk diff (only the trailing velocity number differs
  on the note's line).

Screenshot: `ui/verify-p16-velocity.png`.

## What's deferred

- **Item 1**: the affordance's trigger-label preview logic (`VaryAffordance.tsx`'s own
  `previewScope`) is a client-side mirror of the daemon's `DRUM_LANE_GROUP` map, kept in sync by
  hand (as it already was before this stream) — a shared-constants module is a small, non-urgent
  follow-up if the two ever drift. Multi-lane selection (selecting two lanes at once) still falls
  through to `resolveVaryTarget`'s existing "ambiguous, specify group" error path, unchanged and
  correct — no new UI was added for it since a single click only ever selects one lane.
- **Item 2**: no "unpin from the GUI" affordance in either view (already deferred pre-existing,
  untouched by this stream — the `/unpin` route works, the panel has no button for it). The
  collapsed view's summary rows are not clickable/expandable (no "show these N" drill-down); given
  the panel already provides a one-click full flat view, this reads as sufficient for now rather
  than a missing feature, but could be added later.
- **Item 3**: no numeric velocity readout while dragging (the bar's `title` tooltip shows the
  live value, but there's no on-canvas number the way some DAWs show a floating value badge during
  the drag) — a small follow-up if it turns out to matter in practice. No keyboard-accessible way
  to nudge velocity (arrow keys) — mouse/touch-only, matching the existing move/resize gestures'
  own scope.

## Files touched

- `ui/src/components/StepSequencer.tsx` — lane-label click posts a lane-scoped selection.
- `ui/src/components/HistoryPanel.tsx` — collapsed/flat toggle, renders `HistoryRow[]`.
- `ui/src/components/NoteView.tsx` — velocity-lane strip + drag gesture.
- `ui/src/types.ts` — added `HistoryRow` type.
- `ui/src/styles.css` — `.history-toggle`/`.history-row-collapsed`, `.noteview-vel-lane`/
  `.noteview-vel-bar`.
- `src/daemon/daemon.ts` — additive `GET /history?collapsed=true` (imports `collapsedHistory`
  alongside the existing `history` import; full `npm test` run per the touched-daemon-file rule).
- New: `ui/verify-phase16-lane-vary.mjs`, `ui/verify-phase16-history-collapse.mjs`,
  `ui/verify-phase16-velocity.mjs`, plus their `.png` evidence screenshots.

## Test result

Full `npm test` from repo root, before and after all changes: **293 tests / 287 pass / 0 fail /
6 skipped** — unchanged baseline (the 6 skips are the pre-existing macOS tmpdir-symlink
`history.test.js` skips, unrelated to this stream). All three `ui/verify-phase16-*.mjs` scripts
pass end to end against real daemons on real git-backed projects.
