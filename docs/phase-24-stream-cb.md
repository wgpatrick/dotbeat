# Phase 24 Stream CB — drag a section left/right to reorder it

*2026-07-11.* Adds a real reorder primitive for the song timeline's section list (`doc.song:
BeatSongSection[]`, `src/core/document.ts`), so moving a section is a genuine "this section moved"
edit instead of a delete-then-reinsert pair. See `docs/phase-24-plan.md`'s CB section for the
original scope.

## Why a dedicated `move` op, given `setSong` already replaces the whole list

`setSong` (existing, `src/core/edit.ts`) replaces the entire section list in one call — the right
shape for *authoring* a song from scratch, but a poor shape for *reordering*, for the same reason
`moveEffect`/`moveLane` exist alongside `addEffect`/`addLane`'s "just replace the array" option:
a caller (the GUI drag handler, an agent) shouldn't have to reconstruct the whole array just to
say "move index 2 to index 0." `songMove(doc, fromIndex, toIndex)` is that dedicated primitive,
built on top of `setSong` (splice out, splice back in, delegate to `setSong` for validation and the
actual doc update) — same layering `moveEffect`/`moveLane` use relative to their own "replace the
whole list" siblings.

## Where it lives, and why (a real inconsistency in the existing song ops worth naming)

`songAppend`/`songResize`/`songDelete` — the three existing high-level section ops — live in
`src/daemon/daemon.ts`, not `src/core/edit.ts`, because they're composed operations (append
bootstraps a scene from live content on the loop→song transition; resize branches on an overlap
policy) that only the daemon route needs. `songMove` is different: it's a **pure, low-level
splice**, exactly like `moveEffect`/`moveLane`, which do live in `src/core/edit.ts` and are exported
through `src/core/index.ts` so the CLI (which only imports from `dist/src/core/index.js`, never
`daemon.js`) can call it directly. `songMove` follows the `moveEffect`/`moveLane` precedent, not the
`songAppend`/`songResize`/`songDelete` one — it's in `src/core/edit.ts`, and `daemon.ts`'s `/song`
route's new `'move'` case is a thin one-line pass-through (`songMove(doc, from, to).doc`), the same
relationship the `/lane` route already has with `moveLane`.

## The diff question: does a reorder need a new `DiffEntry` kind?

The plan flagged this as open: either confirm the existing song-array diffing already handles
reorders sensibly, or add a `section-moved` kind analogous to `effect-moved`. Checked
`src/core/diff.ts`: the song list is already compared **as one whole statement**
(`songKey(a.song) !== songKey(b.song)` → one `'song-changed'` entry with `before`/`after` arrays),
not diffed per-entity like tracks/effects/lanes. That's deliberate and dates to the original v0.4
diff design — the comment at `diff.ts`'s song block says exactly why: *"The song is one ordered
statement — compare whole (order IS the data; per-index diffs of a reordered section list would
read as noise)."*

This turns out to be the right answer for `songMove` too, and for a structural reason
`effect-moved`/`lane-moved` don't share: **sections have no stable id.** `BeatSongSection` is just
`{scene, bars}` — duplicate sections (same scene, same bar count) are legal and common (e.g. an
intro reprised later), so there is no way to match a "moved" section across two states by identity
the way `effect-moved` matches by `effect.id` or `lane-moved` matches by `lane.name`. A whole-list
diff sidesteps that: `songKey` is a value, not an identity map, so it can't misreport a reorder as
delete+insert — there's no per-entity add/remove step at all, just one before/after comparison of
the whole ordered statement. Verified directly: `songMove(doc, 0, 2)` on a 3-section song produces
**exactly one** `DiffEntry` (`kind: 'song-changed'`), confirmed in both
`test/format-v04.test.ts` and the live verify script's CB1 step (`diffDocuments` on the real
before/after `.beat` text). No new diff kind was needed or added.

## What was built

**Core** (`src/core/edit.ts`, `src/core/index.ts`):
- `songMove(doc, fromIndex, toIndex): { doc, section, before, after }` — validates song mode and
  `fromIndex` range (`BeatEditError` otherwise), clamps `toIndex` to the list bounds (same
  `Math.max(0, Math.min(Math.trunc(toIndex), length - 1))` clamp `moveEffect`/`moveLane` use — note
  the clamp is against the **pre-removal** length, matching those two exactly, so moving to the
  last position always lands at the true end even after the source item is spliced out), splices,
  delegates to `setSong`.
- Exported from `src/core/index.ts` alongside `setSong`/`moveEffect`/`moveLane`.

**Daemon** (`src/daemon/daemon.ts`):
- `POST /song` gains a `'move'` op: `{ op: 'move', from: number, to: number }` → `songMove(doc,
  Number(b.from), Number(b.to)).doc`. Same route, same `written`/`song` response shape as
  `append`/`resize`/`delete`; the 400 error path (`BeatEditError`/`SyntaxError` → 400) is unchanged.

**CLI** (`cli/beat.mjs`):
- `beat song-move <file> <from-index> <to-index>` — same shape as `beat effect-move <file> <track>
  <effect-id> <new-index>`: reads, calls `songMove`, writes canonically, prints the edit list via
  `writeDoc`'s existing `formatDiff(diffDocuments(before, after))`.

**MCP** (`src/mcp/server.ts`):
- `beat_song_move` — `{file, from_index, to_index}` → `songMove` → write → return `formatDiff`.
  Sits next to the existing `beat_song` tool (which still owns whole-timeline authoring: clips,
  scenes, and the full song array in one call).

**GUI** (`ui/src/components/ArrangementView.tsx`, `ui/src/styles.css`):
- The section-chip row (`arr-section-chip`, inside the `songMode` ternary) is now a real
  reorderable list, modeled on `SynthPanel.tsx`'s `EffectRow` — the established in-app precedent
  for "drag one entry in an ordered list to reorder it," not the section-resize-handle's own
  pointer-drag code (that mechanic solves a different problem, changing a section's *length*, not
  its *list position* — the plan's own framing of why a third pattern shouldn't be invented pointed
  at `SynthPanel.tsx` once read, even though the task brief's context note only mentioned the
  resize handle by name).
  - Native HTML5 drag-and-drop: each chip is `draggable`, with `onDragStart`/`onDragOver`/`onDrop`/
    `onDragEnd` wired to a local `sectionDrag: {draggingIndex, overIndex}` state (sections have no
    stable id, so — unlike `EffectRow`'s `dragState.draggingId` — identity here is the chip's index
    at drag-start, which is safe because nothing reorders the array mid-drag; the move only
    commits on drop).
  - `.dragging` / `.drop-target` CSS classes, same visual language as `.effect-row.dragging`/
    `.drop-target` (dim the dragged chip, accent-outline the hover target).
  - A `⠿` drag handle (`arr-chip-drag-handle`) plus ◀/▶ move-by-one-position buttons
    (`data-section-move-left`/`data-section-move-right`) as a click/keyboard-reachable fallback for
    the same affordance — same reasoning `EffectRow`'s ▲/▼ buttons exist: accessible, and a far
    more reliable hook for automated verification than simulating native drag events (used for the
    live script's CB2 step; CB1 exercises the actual drag).
  - Both paths call the same `postSong({op: 'move', from, to})`, extending the existing local
    `postSong` helper's type (already handled `append`/`resize`/`delete`).

## Verification

- **`npm test`**: 551/551 passing. New coverage:
  - `test/format-v04.test.ts` — `songMove`'s splice/clamp logic (including the no-op identity
    case and the pre-removal-length clamp), its `BeatEditError` cases (bad `fromIndex`, non-integer,
    outside song mode), and a round-trip + single-diff-entry test asserting `diffDocuments` reports
    exactly one `'song-changed'` entry for a reorder (not a `clip-removed`/`clip-added` or
    `scene-removed`/`scene-added` pair).
  - `test/daemon.test.ts` — `POST /song {op:'move'}` end-to-end (reorders, persists to disk,
    scene count unchanged) and its 400/unchanged-doc rejection path for an out-of-range index.
  - `test/mcp.test.ts` — `beat_song_move` over the real MCP stdio protocol: sets up a 3-section
    song via `beat_song`, moves a section, asserts the returned edit-list text and the on-disk file
    both reflect the reorder, and that an out-of-range index comes back as `isError` (not a
    protocol error).
- **`ui/verify-phase24-stream-cb.mjs`** (new) — real `beat daemon` + the real built frontend in
  headless Chromium:
  - **CB1** — `page.dragAndDrop()` (the same Playwright API `ui/verify-phase22-content-browser.mjs`
    uses for its library-drop tests) drags the first chip onto its neighbor. Confirms: the GUI chip
    order updates, the on-disk `.beat` file's `song` block reflects the swap, and — parsing the
    real before/after file text — `diffDocuments` reports **exactly one** `song-changed` entry.
  - **CB2** — the ▶ fallback button moves a section two positions in two clicks, confirming a
    genuine multi-hop reposition (not just adjacent swaps).
  - **CB3** — runs the equivalent move through `beat song-move` (CLI) and directly through core's
    `songMove`, and asserts the resulting file bytes are identical — the GUI drag, the CLI, and the
    core primitive are three faces on one edit.
  - All three steps passed on a real run (log: `ALL PASS — Phase 24 Stream CB ... verified live`).
- **Typechecks**: `npx tsc --noEmit -p tsconfig.json` (root) and `cd ui && npx tsc --noEmit` both
  clean.

## Files touched

Core: `src/core/edit.ts`, `src/core/index.ts`. Daemon: `src/daemon/daemon.ts`. CLI:
`cli/beat.mjs`. MCP: `src/mcp/server.ts`. GUI: `ui/src/components/ArrangementView.tsx`,
`ui/src/styles.css`. Tests: `test/format-v04.test.ts`, `test/daemon.test.ts`, `test/mcp.test.ts`.
Verify script: `ui/verify-phase24-stream-cb.mjs` (new). Docs: this file.
