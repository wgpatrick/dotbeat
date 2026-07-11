# Phase 15 Stream H — version-history panel

*Built 2026-07-11. Gives D3/D10 versioning (checkpoints, restore, pins) its first GUI surface. Until
now it shipped only as `beat history`/`beat restore`/`beat pin` CLI/MCP verbs — a user in the Mac app
had no way to see or use version history at all (`docs/product-spec-desktop.md` §4).*

## What was built

### Daemon routes (`src/daemon/daemon.ts`, additive)

An HTTP face on `src/history/history.ts`'s existing git-backed functions — the daemon adds **no**
versioning logic, it reuses the same verbs the CLI does:

- `GET /history[?limit=N]` → `{ entries: HistoryEntry[] }`, newest first, each with its semantic
  one-line diff `label`, `ref` (short sha), `when`, and `pin`/`intent` when set. Reuses `history()`.
- `POST /restore` `{ ref }` → the new checkpoint (or `{ skipped: true }`). Reuses `restore()` —
  **append-only** (writes the old bytes + a fresh checkpoint, never a destructive rewind).
- `POST /pin` `{ ref, name }` → the `PinEntry`. Reuses `pin()` (nice-to-have; done).
- `POST /unpin` `{ name }` → `{ ok: true }`. Reuses `unpin()`.

`HistoryError` (unknown ref, bad/duplicate pin name, etc.) and malformed JSON map to HTTP 400;
anything else to 500. A restore/pin writes the `.beat` file on disk, which the daemon's existing
directory watcher picks up and broadcasts as a `doc` SSE event — so the GUI hot-reloads through the
exact same external-edit path a hand edit or `beat set` uses. No bespoke echo channel.

### GUI panel (`ui/`)

- New **fourth tab** ("History") alongside Editor/Arrangement/Mixer (`ui/src/App.tsx`,
  `ui/src/types.ts` — added `'history'` to `AppView` plus a `HistoryEntry` type mirroring the
  daemon's JSON contract).
- New `ui/src/components/HistoryPanel.tsx`: a linear list (spec §4) — timestamp, one-line semantic
  diff label, pin badge when present, intent when present — each row with a **"Go back"** (restore)
  button and a lightweight inline **"Pin"** affordance. It re-fetches `/history` whenever the store's
  `doc` identity changes (any edit/restore mints a checkpoint) plus on open, riding the same reactive
  document the rest of the app does. Styling appended to `ui/src/styles.css`, theme variables reused.

## Verification evidence

`ui/verify-phase15.mjs` (Playwright headless Chrome against a real daemon over a real git project,
following the established `ui/verify-phase14.mjs` pattern). Ran green — screenshot at
`ui/verify-p15-history.png`.

**Setup — real history, real CLI:** copied `examples/night-shift.beat` into a temp project, then made
three real edits each followed by `beat checkpoint`, producing four genuine checkpoints with genuine
semantic labels, then pinned one:

```
e904612  bass: note added u100040 (pitch 48, start 0, dur 4, vel 0.8)
8921108  lead: cutoff 5200 -> 900
9b62f9c  bpm: 124 -> 128            [pin: rough mix v1]
e4b42df  checkpoint
```

> **Note on D3 auto-checkpoint:** the plan/spec assume `beat set`/`beat add-note` auto-checkpoint per
> D3. **They do not** — checkpointing is an explicit `beat checkpoint` command; `beat set` writes the
> file but mints no checkpoint (confirmed by reading `cli/beat.mjs`, no `checkpoint()` call in the
> `set`/`add-note` paths). So this verification checkpoints explicitly after each edit, which is the
> same `src/history` codepath the daemon reuses — the history shown is fully real either way. D3's
> "auto-checkpoint on every edit batch / GUI save" remains aspirational and unwired at the edit layer.

**H1 — real data renders:** the panel showed 4 rows whose refs matched `beat history` **1:1** in
order, with the pinned checkpoint displaying "📌 rough mix v1". Not empty, not placeholder.

**H2 — append-only restore confirmed via git + disk:** clicked "Go back" on the earliest checkpoint
`e4b42df` (baseline, bpm 124, no bass note). Confirmed:
- `.beat` file on disk reverted to `bpm 124` (added note gone).
- `git log` went **4 → 5 commits** — exactly one NEW commit, subject `go back to e4b42df (checkpoint)`.
- The restored-to commit `e4b42df` still exists (`git cat-file -e` passed) — nothing rewound/deleted.
- The GUI reflected it: store `doc.bpm === 124`, and the panel refreshed to 5 rows with the new
  "go back to" checkpoint on top.

This is the exact non-destructive-rewind property D3/research-11 require: restore creates a new
checkpoint, the pre-restore state stays recoverable, redo is free.

## Test result

Full `npm test` from repo root: **293 tests / 287 pass / 0 fail / 6 skipped** — unchanged baseline,
green. (No tests added: `test/` was outside this stream's file ownership.)

## Deferred

- **Collapsed view** — `collapsedHistory()` exists server-side (folds unnamed runs between pins), but
  the panel renders the flat linear list. Wiring the collapse toggle into the panel is deferred; the
  flat list is the spec's must-have and reads cleanly at these lengths.
- **Play button per checkpoint** (spec §4: "checkpoints are renderable") — auditioning an old
  checkpoint's audio without restoring is non-trivial (needs rendering a historical document through
  the engine) and is deferred; "Go back" (restore) is the must-have and is done.
- **Unpin from the GUI** — the `/unpin` route exists and is reachable, but the panel has no unpin
  button yet (pinned rows just show the badge). Cheap follow-up.

## Worktree note

This worktree was created from `origin/main` (commit `3f96edf`), which was far behind local `main`
(`7a844e1`, where the Phase 15 plan and all Phase 9–14 work live). Reset the branch onto local `main`
before starting so the work bases on the current daemon/UI (the `/document`, `/edit`, `/selection`
routes and the three-tab UI this stream extends).
