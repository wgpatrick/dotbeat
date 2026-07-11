# Phase 17 Stream M — Ableton-standard multi-note editing controls

*Built 2026-07-11. Scope: replicate Ableton Live's standard piano-roll interaction model —
marquee (rubber-band) selection, multi-select, group move, group resize, group delete, keyboard
nudge, select-all — in dotbeat's own `NoteView.tsx`. Every group operation stays a clean per-note
multi-line diff, never a document rewrite.*

Owner's direction (close to verbatim): *"replicate all the standard types of UI/UX controls in
Ableton — dragging the size of notes, moving notes around, click multiple notes to move/resize/
delete together, click-and-drag a selector rectangle to select multiple notes."*

## 1. Ableton research — what the actual conventions are

Sourced from Ableton's own Live 12 Reference Manual (the authoritative source), cross-checked
against community references. Findings:

- **Marquee / rubber-band selection.** *"Clicking and dragging in the MIDI Note Editor selects a
  timespan. If the dashed line of the selected timespan enclosed any notes, they will automatically
  also become selected."* — a click-drag on empty editor space draws a rectangle; every note it
  encloses/touches becomes selected. ([Editing MIDI, Live 12 manual](https://www.ableton.com/en/live-manual/12/editing-midi/))
- **Multi-select (shift-click).** *"You can add the Shift modifier to add more notes to your
  current selection. You can also remove a single note from your selection by holding down Shift and
  clicking on it."* Shift is a **toggle** (add if absent, remove if present). Non-adjacent
  multi-select is also documented as `Ctrl`-click (Win) / `Cmd`-click (Mac). ([Editing MIDI](https://www.ableton.com/en/live-manual/12/editing-midi/), [Live Keyboard Shortcuts](https://www.ableton.com/en/manual/live-keyboard-shortcuts/))
- **Group move.** With a multi-note selection, dragging any one selected note moves the **whole
  selection together, preserving relative offsets** (horizontal = time, vertical = transpose). The
  group behaves as a rigid body and stops when any note hits an edge.
- **Group resize — UNIFORM DELTA, not proportional.** This is the one the owner would notice if
  wrong. Ableton resizes a multi-note selection by a **uniform delta**: every selected note's
  duration changes by the *same amount*, not scaled proportionally to its length. The manual's
  keyboard equivalent makes it explicit: *"Shift plus the left or right arrow keys extends or
  shortens the duration of selected notes, according to the grid settings"* — one grid step added to
  **each** note, regardless of its current length. Dragging one selected note's edge applies the
  same uniform-delta rule. ([Editing MIDI Notes and Velocities, Live 11 manual](https://www.ableton.com/en/live-manual/11/editing-midi-notes-and-velocities/))
- **Group delete.** `Delete` / `Backspace` removes all selected notes. (Double-click deletes a
  single note when Draw Mode is off — dotbeat already had this.)
- **Keyboard nudge.** With Draw Mode off, *"you can move notes around with the arrow keys ... either
  vertically to transpose them, or horizontally to change their position in time."* Left/right = ±1
  grid step in time; up/down = ±1 semitone; **Shift+up/down = ±1 octave**; **Shift+left/right =
  resize duration by ±1 grid step**. (Ableton's shortcut table has some context-dependent overloads
  — e.g. `Alt/Opt`+arrows select the next/previous note, `Alt`+drag "nudges" at sub-grid resolution
  when the grid is off — but the primary MIDI-editor arrow behavior is move/transpose, which is what
  we implemented.) ([Editing MIDI](https://www.ableton.com/en/live-manual/12/editing-midi/), [Live Keyboard Shortcuts](https://www.ableton.com/en/manual/live-keyboard-shortcuts/))
- **Select all.** `Cmd`/`Ctrl`-A selects all notes in the clip. ([Live Keyboard Shortcuts](https://www.ableton.com/en/manual/live-keyboard-shortcuts/))

### Does this model apply to the drum step-grid (`StepSequencer.tsx`)?

**No — deliberately left untouched.** Ableton's *own* multi-note editing (marquee/group-move/
group-resize) lives in the **MIDI Note Editor** (the piano-roll), which dotbeat mirrors as
`NoteView.tsx`. dotbeat's `StepSequencer.tsx` is a fixed toggle-button **step grid** (one button per
step per lane, Push-hardware-style), where a cell has no free X-position to drag, no duration to
resize, and no draggable object to rubber-band — the interaction is a single click-to-toggle. The
Ableton conventions above are all about repositioning/resizing free-floating note objects, which has
no analog on a fixed toggle grid. Forcing marquee-select onto it would be inventing a non-Ableton
gesture (marquee-toggling cells), not replicating one. So the multi-note model is scoped to the
piano-roll, which is exactly where Ableton itself puts it. (Drum *notes* edited in the piano-roll —
i.e. a drum track shown in `NoteView` — would inherit all of this for free; dotbeat currently routes
drums through the step grid, so that's future work, noted under Deferred.)

## 2. What was built

All in `ui/`, additive, no engine changes:

- **`ui/src/state/store.ts`** — one additive field, `editNoteIds: string[]` + `setEditNoteIds`, the
  multi-note *editing* selection. Kept explicitly **distinct** from the pre-existing `selection`
  (the D2 pointing protocol — tracks/lanes/bars — that the daemon owns and `beat vary --scope
  selection` reads). This one is GUI-only "which notes the pointer/keyboard is about to act on".
- **`ui/src/components/NoteView.tsx`** — the full control set, layered on top of the existing
  single-note add/move/resize/velocity gestures (all preserved):
  - **Marquee**: `pointerdown` on empty grid starts a rubber-band; `pointermove` past a 3px
    threshold live-selects every note the rectangle touches (intersection test in grid px, both
    axes); a modifier makes it additive. A press with *no* drag falls through to the existing
    click-to-add (so add-by-click still works — verified).
  - **Multi-select**: shift/cmd/ctrl-click a note toggles it in/out of `editNoteIds`.
  - **Group move**: dragging a note that's in the selection moves the whole group by a clamped
    delta that preserves relative offsets; dragging an unselected note first collapses the selection
    to just it (standard DAW behavior).
  - **Group resize**: dragging one selected note's right edge applies a **uniform duration delta**
    to every selected note (matching the Ableton finding), each clamped to ≥1 step and the loop end.
  - **Group delete**: `Delete`/`Backspace`, and the toolbar's "Delete N notes" button.
  - **Keyboard nudge / select-all**: arrows move (±1 step / ±1 semitone), Shift+←/→ resize,
    Shift+↑/↓ octave, `Cmd`/`Ctrl`-A select-all. The window-level key handler bails when a form
    control has focus, so it never hijacks the BPM box or a panel `<select>`.
  - **Rubber-band overlay** styled in `ui/src/styles.css` (`.noteview-marquee`).

Every group operation fans out the **same** per-note `POST /edit {path,value}` primitives the code
already used for single-note edits (`<track>.note.<id>.start` / `.pitch` / `.duration`, and
`<track>.note.<id>` with an empty value to delete) — the direct analog of Phase 15 Stream I's
vary-"keep" batch-of-edits flow. So moving 3 notes is a 3-line diff, deleting 3 is 3 removed lines,
never a document rewrite.

## 3. Verification (`ui/verify-phase17-arrangement.mjs`)

Headless Chromium drives the real frontend against a real `beat daemon` on a real git project
(canonical `night-shift.beat`), asserting both in-memory state and the **on-disk git diff** for each
operation. All pass:

- **M1 marquee** — rubber-band over the top-left cluster selects **exactly** `[u100033, u100034,
  u100035]` (screenshot `ui/verify-p17-marquee.png` shows the blue rubber-band mid-drag).
- **M2 group move** — dragging one selected note +4 steps moves all three +4 in lockstep; diff is
  exactly three changed note lines and nothing else:
  ```
  -  note u100033 76 20 2 0.7      +  note u100033 76 24 2 0.7
  -  note u100034 72 24 2 0.65     +  note u100034 72 28 2 0.65
  -  note u100035 74 28 3 0.6      +  note u100035 74 32 3 0.6
  ```
  (screenshot `ui/verify-p17-group-move.png` shows "3 selected", the cluster shifted right, velocity
  bars moved with it).
- **M3 shift-click + delete** — shift-clicking builds `[u100036, u100037, u100038]`; `Delete`
  removes exactly those three; diff is three removed lines, zero added.
- **M4 group resize (the uniform-delta check)** — two notes of *different* durations (u100033 dur 2,
  u100035 dur 3); dragging u100035's edge +2 grows **both by exactly +2** (2→4 and 3→5), not
  proportionally; diff is two changed duration lines. This is the specific Ableton convention the
  owner cares about, pinned down by test.
- **M5 select-all + nudge** — `Cmd`/`Ctrl`-A selects all 4 remaining notes; `ArrowRight` nudges
  every one +1 step; diff is four changed lines.

Regression: existing `ui/verify.mjs` (note add/move/delete, param edits, drum toggle, live-sync,
audio) and `ui/verify-phase16-velocity.mjs` (velocity-drag) both still fully green — the single-note
gestures are unchanged. Repo suite `npm test`: **293 / 287 pass / 0 fail / 6 skipped** (unaffected;
`ui/` isn't in the repo's own suite).

## 4. Deferred / not done

- **Drum-grid multi-select**: intentionally not applied to `StepSequencer.tsx` (see §1 reasoning).
  If drums ever get a piano-roll representation in `NoteView`, they inherit all of this for free.
- **Copy / paste / duplicate** (`Cmd`-D, `Cmd`-C/V): Ableton has these; out of scope for this pass
  (the owner's list was marquee / multi-select / group move / resize / delete). The edit-primitive
  plumbing (add mints a fresh u-id) would make duplicate straightforward later.
- **`Alt`/`Opt`-drag to copy** and **sub-grid `Alt`-nudge**: documented in Ableton, not implemented;
  the grid-quantized model matches dotbeat's discrete note-grid design (research 15 §2).
- **Marquee time-span selection feeding the D2 pointing protocol**: this stream's selection is
  editing-only by design; wiring a note-marquee into `POST /selection` (so `beat vary` could target
  an arbitrary marquee'd set of notes) is a separate, larger integration and was left alone to avoid
  conflating the two selection concepts.
