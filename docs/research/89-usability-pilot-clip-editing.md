# Usability pilot 89: editing existing clip content (note editor vs. drum editor)

## Intro

This pilot deliberately avoided building anything new. Starting from `night-shift.beat` (copied to a
scratch project, loop-mode, 4 tracks: `lead` synth, `drums`, `bass` synth, `pad` synth, each with
pre-existing content), the goal was to exercise the *editing* toolset a returning user reaches for on
a revision pass: selection (click/marquee/select-all), move/resize, deletion (single/multi/clear-all),
the pitch-and-time transform tools, copy/paste/duplicate, undo/redo chains, clip properties, and
edge-of-range behavior — on both the `lead` synth track's piano-roll notes and the `drums` track's
hits, to see where the two editors' toolsets diverge. Driven with a real headless Chrome via
Playwright (`playwright-core`, 1440×900), screenshotting after every action and cross-checking the
UI against `window.__store.getState().doc` and the daemon's `GET /doc` as ground truth.

## Narrative walkthrough

Opened the app with `lead` already selected and its clip editor open at the bottom. The hint bar
turned out to be doing a lot of work I almost skimmed past — it documents marquee-select,
shift/cmd-click multi-select, drag-to-move, edge-drag-to-resize, arrow-nudge, Shift+←/→ resize,
Delete, double-click-delete, Alt/Cmd freehand placement, **Alt/Option-at-drag-start to duplicate**,
and **Cmd/Ctrl+C/V to paste at the playhead**. None of that is discoverable without reading it
carefully, which matches the task's explicit warning to check hint text for tool names.

Single-click selection was immediately satisfying: the note gets a crisp white outline, the hint bar
updates to "7 notes · 1 selected," and — nicely — a per-note detail row appears showing
`chance/cent/ratchet` for exactly that note. Marquee-select (a drag from empty grid across a cluster)
correctly picked up only the notes inside the rectangle, and Select-all (Cmd+A) correctly selected
all 7. Good start.

Then I tried to deselect by clicking empty grid space (the natural gesture) and immediately created
an unwanted note — the hint text says "click empty grid to add," and it means it unconditionally.
Escape doesn't clear a selection either. First confusing moment of the session.

Undo got interesting fast. I added that stray note, then went to click the toolbar **Undo** button —
it was greyed out, and clicking did nothing. Cmd+Z (keyboard), tried on a hunch, correctly removed
the note. I re-tested this cleanly on a fresh reload with a simple diagonal note-drag (pitch + start
both change in one gesture): button showed disabled immediately after the drag; clicking it did
nothing; Cmd+Z worked but only reverted the *pitch* component; a second Cmd+Z was needed to revert
the *start* component. So one user gesture became two undo-history entries, and the toolbar button
couldn't reach either of them reliably. I reproduced a related but distinct variant on a resize too:
button showed enabled, I clicked it once, the note didn't visibly change, but a follow-up Cmd+Z did
revert it — meaning the click silently consumed the undo-stack slot without applying the change.
This pattern (button state and click behavior both untrustworthy, keyboard reliable) held up under
three independent clean-reload repro attempts, so I'm confident it isn't a one-off race in my test
harness.

Deletion was straightforward and consistent: Delete key on a single selection, double-click on a note
right at the edge of the clip's visible 4-bar range (no edge-case bug), multi-select-then-Delete for
a group, and select-all-then-Delete as the de facto "clear all" (no dedicated button, but it works).
Multi-note delete/paste turned out to share the same one-entry-per-note undo granularity as the
diagonal move — restoring a 3-note delete took 3 separate Cmd+Z presses, not 1.

The Pitch & Time transform toolbar (only visible after scrolling the bottom pane) was the best part
of the note editor: Transpose, Invert (mirrors pitch around the selection's mean — confirmed via the
math, not just eyeballing), Reverse (mirrors note order in time, durations preserved correctly),
Quantize, Legato (extends each note to the next note's onset, gap-free — verified per-note), Fit to
Scale (snaps out-of-key notes to nearest scale tone in the chosen key), ×2/÷2 (scales both timing
offsets and durations), and Consolidate. All of them gave an inline "N notes changed" confirmation.
Quantize was the one exception: with the grid dropdown defaulted to "16ths" (the clip's native step
resolution), clicking it against already-grid-aligned notes did nothing and showed *no* confirmation
message at all (not even "0 notes changed") — I only got a real repro after manually switching the
grid to "quarters." A first-time user who doesn't touch that dropdown would reasonably think Quantize
is broken.

×2 surfaced an edge case worth flagging: it doubles note timing/duration relative to the earliest
selected note, and on a 4-bar (64-step) clip this pushed 5 of the 7 notes' end times past step 64 —
confirmed both in the store and in the daemon's persisted document (`start:108, duration:4`, i.e.
ending at step 112). No clamping, no warning, no visual boundary marker distinguishing in-loop from
out-of-loop content.

Copy/paste produced the session's best "ground truth caught it, screen didn't" moment. With the
transport stopped (`currentStep === -1`), pasting two copied notes landed them at the *exact same*
pitch and start as the originals — perfectly overlapping duplicates, invisible on screen, only
detectable by asking the store for the note count (7 → 9) or noting the new IDs. The hint text
promises "paste at the playhead," but with no live playhead position it silently stacks instead.
Alt/Option-drag duplicate, by contrast, worked exactly as advertised and was visually obvious (new
note appears at the drag destination, original stays put).

Clip properties: the bottom pane consistently showed "clip properties: add this track to a scene
(song mode) to edit a saved clip's loop range / signature" for both `lead` and `drums`. This loop-mode
fixture has no song/scene structure, so I could not reach loop-range or time-signature editing from
the GUI in this session — flagged below as where I gave up on that part of the map.

Switching to `drums` (44 hits across a kick/snare/clap/hat/openhat 5-lane kit) showed a genuinely
different toolset. The hint bar for drums documents marquee-select, shift/cmd-click, drag-to-move,
**drag-right-edge-to-gate/sustain** (a marker becomes a bar), arrow-nudge, Shift+←/→ resize, Delete,
double-click-delete, and Alt/Cmd freehand placement — notably *no* mention of copy/paste, and there is
no Pitch & Time-equivalent toolbar at all: no Transpose, Quantize, Invert, Reverse, Legato, Fit to
Scale, or per-hit chance/velocity editing UI. There is, however, a "Lanes (5) · implicit 5-lane kit"
panel with an "Enable lane editing" button that, once clicked, turns the fixed kit into explicit,
reorderable, per-lane-synth-editable rows — a capability with no note-editor equivalent.

Trying to drag-move a single kick hit repeatedly triggered a *resize* (gate/sustain) instead: a hit
marker is only 7px wide, and its resize handle covers 5 of those 7px, centered — only the leftmost
~1px is safe to grab for a move. Confirmed by bounding-box inspection and a clean before/after test:
grabbing at the marker's exact left edge produced a real lane+start move; grabbing 1-2px further in
produced an unwanted gate/resize every time.

Marquee-select silently failed in the drums view. A drag rectangle clearly spanning several
populated cells (verified against the store's `hits` array beforehand) selected nothing and drew no
visible marquee box — I confirmed this with a manual mousedown → move → screenshot-mid-drag →
mouseup sequence, so it isn't a timing artifact of a single synchronous drag call. Shift-click
multi-select worked fine as the alternative, and multi-delete via that path removed hits correctly
in the client store.

Then the pilot's highest-impact finding: none of the drum-hit edits from this whole segment — the
gate/resize, the lane+start move, the multi-hit delete — ever reached the daemon. `GET /doc` from the
daemon showed the original, untouched 16-step `pattern.kick` array throughout, even while the client
store's `hits` array had dropped from 44 to 41. A full page reload (`goto` back to the same URL)
snapped the UI straight back to 44 hits, discarding every drum edit from the session with zero
warning. I re-confirmed with the smallest possible repro — select one kick hit, press Delete, check
`GET /doc` immediately — and the daemon's `pattern.kick[0]` was still `0.9`, unchanged. The `lead`
track's note edits, checked the same way in the same session, persisted correctly and survived reload
every time, so this is specific to the drum-hit editing path, not a general daemon-sync problem.

## Findings summary

- **[bug] Drum-hit edits do not persist to the daemon/document at all.** Deleting, moving, or
  gating/resizing a hit in the `drums` clip editor updates the client-side `hits` array (visible in
  `window.__store`) but never reaches `GET /doc`'s `pattern` data — confirmed with a minimal repro
  (select one kick hit → Delete → daemon's `pattern.kick[0]` still shows the original velocity) and
  with a full-reload test that silently reverted 44→41→44 hits across the session. This is a
  hard data-loss bug: a user editing drum content and refreshing, reopening, or letting the daemon
  restart loses all their drum edits with no error, warning, or confirmation prompt. Highest-impact
  finding of this pilot by a wide margin.
- **[bug] The global toolbar Undo button is unreliable for note/hit edits, while Cmd+Z is not.**
  Repeatedly (3 clean reload-and-repro cycles) observed the button showing `disabled` immediately
  after a fresh, undoable edit (note-add-by-click, diagonal note-move, hit lane+time move) — clicking
  it in that state is a no-op. Separately observed the button showing *enabled*, accepting a click,
  visibly flipping to disabled, but **not applying the revert** — the note/hit stayed changed until a
  follow-up Cmd+Z actually reverted it. Cmd+Z was reliable in every case tested. Real users trusting
  the visible button state (the natural first instinct) will get silently dropped or partial undos.
- **[bug] Marquee (drag) select does not work in the drum-hit editor**, despite being advertised in
  the same hint-bar copy used for the note editor ("drag to marquee-select"). A drag rectangle spanning
  several populated hit cells (confirmed against the store beforehand) selects nothing and draws no
  visible selection box, verified via a manual mousedown/move/screenshot/mouseup sequence to rule out
  a synchronous-drag timing artifact. Shift-click multi-select is an effective workaround.
- **[bug] A drum-hit marker's move-hitbox is ~1px out of a 7px-wide marker** — the resize/gate handle
  occupies the center-to-right ~5px, leaving only the extreme left edge safe to grab for a plain move.
  Dragging almost anywhere on a hit produces an unwanted gate/sustain resize instead of a
  reposition. (Noted per the task brief: this is exactly the class of click-precision bug the
  concurrent Phase 29 effort is targeting in separate worktrees — this pilot independently confirms
  it's present on current `main`.)
- **[confusing] Multi-note/multi-hit operations and diagonal single-note moves are not atomic in
  undo history.** A 3-note delete needs 3 separate Undo presses to fully restore; a 2-note paste
  needs 2; a single diagonal drag (pitch+start, or lane+start, changed together) needs 2. A user
  pressing Undo once after any of these gets a partial, half-reverted state.
- **[confusing] No neutral way to deselect.** Clicking empty grid space unconditionally adds a new
  note/hit there (per hint text, "click empty grid to add") rather than clearing selection, and
  Escape does not clear selection either. The only reliable deselect path found was clicking a
  different note (replaces selection) — there's no click-away-to-deselect gesture.
- **[confusing] Copy/paste silently stacks exact duplicates when there's no active playhead.** With
  transport stopped (`currentStep === -1`), pasting copied notes places them at the *identical*
  pitch+start as the originals — perfectly overlapping, invisible on screen. Hint text promises
  "paste at the playhead"; with no live playhead this degrades to a silent no-visible-effect
  duplicate, only detectable via note count in the store.
- **[confusing / slow-to-discover] Quantize gives zero feedback when its grid resolution matches the
  clip's native step size** (the default). Every other transform (Transpose, Invert, Reverse, Fit to
  Scale, Legato) shows an inline "N notes changed" message even for small N; Quantize at the default
  "16ths" setting against already-aligned notes shows nothing at all — not even "0 notes changed" —
  making it look broken until the grid dropdown is manually changed to something coarser.
- **[confusing] Pitch/time transforms can push notes past the clip's own declared loop length with no
  warning.** `×2` on the 7-note `lead` clip (4 bars / 64 steps) left 5 notes ending beyond step 64
  (one as far as step 112) — persisted as-is to the daemon, no clamping, no visual distinction between
  in-loop and overhanging content in the note grid.
- **[worked well] Selection feedback is layered and clear in the note editor**: white-outline
  highlight, live "N notes · M selected" hint text, "(M selected)" note-list summary, and — for a
  single selection — a full per-note chance/cent/ratchet detail row.
- **[worked well] The full Pitch & Time transform suite in the note editor is musically correct.**
  Verified the actual math, not just visual plausibility: Invert mirrors around the selection's true
  mean pitch, Reverse mirrors note order in time with durations preserved, Legato extends each note
  exactly to the next note's onset (last note untouched, correctly), Fit to Scale snaps to the nearest
  in-key pitch, ×2 scales both offsets and durations consistently.
- **[worked well] Alt/Option-drag-to-duplicate** in the note editor works exactly as hinted — original
  stays in place, a new note appears at the drop point — and is visually unambiguous, in useful
  contrast to the copy/paste no-op-looking case above.
- **[worked well] Deletion is consistent and discoverable**: Delete key, double-click, and (drums
  only) an explicit red "Delete hit" button that appears once a single hit is selected. Tested a note
  at the very edge of the clip's visible range (double-click delete on the last note in bar 4) with
  no edge-case misbehavior.

## Note editor vs. drum editor: toolset comparison

| Capability | Note editor (`lead`) | Drum editor (`drums`) |
|---|---|---|
| Click / marquee / select-all | All work, clear feedback | Marquee **broken**; click and shift-click work |
| Move / resize | Both work (tight but usable click target) | Move works only via ~1px sliver; resize/gate hitbox dominates |
| Delete (single/multi/clear-all) | Works, all paths | Works in-session, but **doesn't persist** |
| Transform toolbar | Full: Transpose, Invert, Reverse, Quantize, Legato, Fit to Scale, ×2/÷2, Consolidate | None present |
| Per-note/hit detail (chance/velocity) | Full row for single selection | Not present in this session |
| Copy/paste | Present, but silently overlaps with no playhead | Not advertised in hint text at all |
| Duplicate (Alt-drag) | Works, visually clear | Not tested (persistence bug made further drum testing low-value) |
| Persistence to daemon | Reliable, survived reload every time | **Confirmed broken** — no edit type persisted |

## Where I gave up on the ideal workflow

- **Clip-level properties (loop range, time signature).** Both editors show a static
  "add this track to a scene (song mode)" message in this loop-mode fixture; there is no GUI path to
  loop-range/signature editing without first promoting the project into song/scene structure, which
  was out of scope for a session focused on note/hit-level editing tools. Not a bug against this
  fixture's mode, but a real reachability gap worth a note.
- **Drum editor's duplicate/copy-paste and undo/redo semantics.** Once the persistence bug was
  confirmed, I stopped trying to characterize drum-editor undo/redo and duplicate behavior with the
  same rigor as the note editor's — any result would conflate "does undo work" with "did the edit
  ever leave the browser tab," which are two different bugs. Recommend re-running that portion of the
  pilot once persistence is fixed.

## Cleanup

Daemon, Vite, and the Playwright driver process were all killed; `/tmp/dotbeat-usability-89-clip-editing/`
was removed; the temporary `ui/__pilot89_driver.mjs` test harness file was deleted from the tracked
repo before finishing.
