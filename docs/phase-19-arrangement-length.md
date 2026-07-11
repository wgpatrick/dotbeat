# Phase 19 Stream V — changing the song's length

The gap (found by using the Mac app for real, docs/phase-19-plan.md §"Stream V"): the underlying
capability to size an arrangement already existed and was agent-accessible — `loop_bars` is a
`POST /edit` path, and `beat song`/`beat scene` (core's `setSong`/`setScene`) build multi-section
arrangements — but **none of it was exposed in the GUI.** Loop mode had no control to extend/shrink
the loop; song mode had no way to add, delete, or resize a section. This stream wires all of that
into `ArrangementView`, reusing the existing core verbs (no arrangement logic was reimplemented).

Out of scope, per owner direction: a Session-View / "Live view" clip-launching grid. This is only
about the Arrangement timeline's own length.

## What was built

### Loop mode (`doc.song === null`)
A length control cluster under the arrangement toolbar (`.arr-length-bar`):
- **`−` / `+` buttons** (`[data-loop-minus]` / `[data-loop-plus]`) that shrink/grow `loop_bars` by
  one bar, wired straight through the already-supported optimistic edit path
  (`postEdit('loop_bars', …)` → one canonical line on disk). Clamped to 1–64.
- A **`+ section` button** (`[data-add-section]`) that converts the loop into a real song (below).
- A **drag handle** on the region's right edge in the ruler (`.arr-section-resize`) that resizes by
  dragging, committing through the same `loop_bars` edit on pointer-up, with a live bar-count guide.
  The handle occupies the last few px *inside* the boundary so the fit-to-width timeline's rightmost
  edge stays grabbable. Because the timeline is fit-to-width, the rightmost handle can only drag
  *inward* (shrink); extending is the job of the `+` button. Interior section boundaries (song mode)
  drag either way.

### Song mode (`doc.song` set)
Per-section controls, one chip per section, plus an append button:
- **Resize**: `−` / `+` per section (`[data-section-minus=i]` / `[data-section-plus=i]`), and the
  ruler drag handle on each section's boundary.
- **Delete**: `×` per section (`[data-section-delete=i]`); disabled on the last remaining section.
- **Append**: `+ section` duplicates the last section's scene as the new section's starting content
  (the "start simple — reuse the last slot map" approach the plan calls for), so the user doesn't
  configure every track's clip from scratch.

### Loop → song conversion (the first append from loop mode)
Appending a section while in loop mode converts the document into a real `BeatSongSection[]` without
discarding anything: it snapshots each track's live content into a clip (core's `saveClip`), builds
one scene mapping every track to those clips (core's `setScene`), and sets the song to
`[{scene, bars: loopBars}, {scene, bars: <new>}]` (core's `setSong`) — **section 0 is the existing
loop, unchanged; section 1 is the new one.**

### Daemon: one additive route (`POST /song`)
`loop_bars` already round-trips through `setValue`/`/edit`, so loop mode needed no daemon change. The
song ops can't be expressed as a single `{path,value}` line (append/delete/resize is a whole-list
`setSong` statement), so `src/daemon/daemon.ts` gains **one additive route, `POST /song`**, taking
`{op: 'append'|'resize'|'delete', index?, bars?}`. It is a thin HTTP face on `setSong`/`setScene`/
`saveClip` — the same "reuse the real core verb over HTTP" pattern as Phase 15's `/history` and
`/vary` — written the same canonical-to-canonical way `/edit` is (`writeIfChanged`). The GUI re-pulls
`GET /document` after each op (the daemon doesn't echo its own writes; matches `/edit`). Helpers
`songAppend`/`songResize`/`songDelete` are exported and unit-tested.

## Files touched
- `ui/src/components/ArrangementView.tsx` — the controls, the drag-handle resize, the `postSong`
  bridge call, the loop-bars edits.
- `ui/src/styles.css` — new, uniquely-named classes (appended; no existing rules changed).
- `src/daemon/daemon.ts` — the additive `POST /song` route + `songAppend`/`songResize`/`songDelete`
  helpers.
- `test/daemon.test.ts` — 3 new tests for the route (append/convert, resize/delete, bad input).
- `ui/verify-phase19-length.mjs` — the live end-to-end check (new).

## Verification evidence

`npm test`: **296 tests, 290 pass, 0 fail, 6 skipped** (the 6 skips are the pre-existing
`node-web-audio-api not available` engine-parity skips, unrelated). The 3 new `POST /song` tests
pass, including the loop→song conversion asserting section 0 keeps the loop length and every track
gets a snapshot clip + scene slot, plus `parse(fileOnDisk) === daemon.getDoc()`.

`ui/` typechecks clean (`tsc --noEmit`, 0 errors).

`node ui/verify-phase19-length.mjs` — headless Chromium against a real daemon on a real **loop-mode**
project (`examples/night-shift.beat`, `loop_bars 4`). **ALL CHECKS PASSED:**

- **[A] loop extend via `+`** — `loop_bars 4 → 5`, a clean one-line `git diff`:
  ```
  @@ -3 +3 @@ bpm 124
  -loop_bars 4
  +loop_bars 5
  ```
- **[A2] loop resize via the drag handle** — dragging the region's right edge left committed
  `loop_bars 5 → 3`, again a single changed line (`+loop_bars 3`).
- **[B] loop → song conversion** — `+ section` produced a real 2-section song
  `[s1(4), s1(4)]`; the timeline **doubled 4 → 8 bars** on screen (two section labels rendered), and
  the `.beat` file gained a populated scene + song block. The exact tail written:
  ```
  scene s1
    slot lead s1
    slot drums s1
    slot bass s1
    slot pad s1

  song
    section s1 4
    section s1 4
  ```
  (section 0 = the old loop, unchanged; each `s1` clip is a snapshot of that track's live content.)
- **[C] append in song mode** — timeline grew **8 → 12 bars** (3 sections, 3 labels).
- **[D] resize a section** — `+` on section 0 grew it `4 → 5`; timeline **12 → 13**.
- **[E] delete a section** — `×` on the middle section: timeline shrank **13 → 9**; the remaining
  sections and their bar counts stayed intact
  (`[s1(5), s1(4), s1(4)] → [s1(5), s1(4)]`).

Screenshot: `ui/verify-p19-arrangement.png` (the converted multi-section arrangement).

## Deferred / notes
- **Extending the rightmost region by dragging** isn't possible because the arrangement timeline is
  fit-to-width (px/bar shrinks to fit), so the last boundary is always at the container edge — the
  `+` / `+ section` controls cover extension. A future scrollable, fixed-px/bar timeline would let
  the outer edge drag outward.
- **Appended sections reuse the last section's scene** (shared slot map) as the deliberate "start
  simple" content. Editing that scene's clips currently affects every section pointing at it; giving
  a new section its *own* duplicated scene/clips (independently editable) is a natural fast-follow —
  the `/song` route is the place to add it.
- **Clearing a song back to loop mode** (deleting the last section) is intentionally refused; loop
  mode is reached by never converting, not by deleting down. `setSong([])` already models the clear
  if a future control wants to expose it.
- Session-View clip-launching grid: explicitly deferred by the owner, untouched.
