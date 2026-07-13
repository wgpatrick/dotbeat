# Phase 29 — fixing what the usability pilots found

Source: `docs/research/80` through `86`, seven exploratory usability pilots (no scripted checklist,
an agent driving the real app and reading its own screenshots) run across two rounds this session.
Between them they surfaced ~30 real findings dotbeat's scripted verify suite structurally cannot
catch, because every verify script is written by someone who already knows the "correct" answer.
This phase fixes the real bugs AND the recurring friction/discoverability points — not just the
hard correctness bugs. Six streams, GA-GF, each independently mergeable.

**Not in scope for this phase** (bigger feature asks the pilots surfaced, not confined bugs — belong
on the roadmap, not in a bug-fix phase): right-click context menus anywhere in the app; a rhythmic
(not just timbral) "vary pattern" tool; multi-region-per-clip audio placement (one audio region per
clip is a documented v0.10 scope cut, see `docs/format-spec.md`); CLI-vs-daemon hot-reload
conflicts. Noted here so they aren't lost, not assigned to a stream.

## Streams

| Stream | Feature area | Primary files | Source research |
|---|---|---|---|
| GA | Scene/clip-editor targeting — the editor can only ever show/place the FIRST song section's clip for a track, with no way to view or place into any other section | `ui/src/components/NoteView.tsx` (`placeInArrangement`, ~line 681), `ui/src/components/ClipPropertiesPanel.tsx` (`primaryClipFor`, line 30), `ui/src/components/ArrangementView.tsx` (clip-block click handling), `ui/src/state/store.ts` | 83, 84, 86 |
| GB | Macro knob display desyncs from real state after a preset switch (and gets worse on reload) | `ui/src/components/SynthPanel.tsx` (`MacroKnob`, line 396; `PresetPicker`, line 288); mirror any fix in `ui/src/components/InstrumentPanel.tsx` if it has its own `MacroKnob` copy | 81, 86 |
| GC | Note/drum grid interaction & precision bugs: click-to-add off-by-one, view auto-recenter/jump on edit, click-eaten-by-deselect, sticky multi-selection, drag-resize octave drift, sticky title bar covering content rows | `ui/src/components/NoteView.tsx` | 80, 81, 83, 84 |
| GD | Data integrity & daemon resilience: rapid grid edits silently lose data; daemon dies with zero log output | `ui/src/daemon/bridge.ts` (edit-posting path), `ui/src/components/NoteView.tsx` (grid pointer handlers), `src/daemon/daemon.ts` | 82, 84, 86 |
| GE | Dialogs/toasts/discoverability copy: Mixer scrim blocks the topbar Undo button; ~25 `window.alert()` call sites instead of in-app feedback; automation popup won't dismiss on outside click; Version History's misleading empty-state copy + no GUI checkpoint button; Content Browser has zero drag-and-drop hint (every other panel over-explains, this one under-explains); "vary hats/feel" button labels don't signal they change timbre, not rhythm | `ui/src/components/MixerView.tsx`, `ui/src/components/ArrangementView.tsx` (~25 alert() sites), `ui/src/components/NoteView.tsx` (alert sites + automation popup), `ui/src/components/HistoryPanel.tsx`, `ui/src/components/ContentBrowser.tsx` | 80, 81, 82, 83, 85, 86 |
| GF | Layout/visual/small-correctness polish sweep | `ui/src/styles.css`, `ui/src/components/ArrangementView.tsx`, `ui/src/components/NoteView.tsx` | 80, 81, 82, 83, 85, 86 |

## GA — Scene/clip-editor targeting

**The single highest-impact finding across all seven pilots.** Once a song has more than one
section, there is no way — from the GUI — to view or edit any section's clip content except the
first. `primaryClipFor` (`ClipPropertiesPanel.tsx:30-40`) always iterates `doc.song` from index 0
and returns the first match; `NoteView.tsx`'s `placeInArrangement` (line 681) hardcodes
`doc.song![0]!.scene`. Neither function has any notion of "which section is the user currently
looking at." Confirmed independently in pilots 83, 84, and 86 via three different symptoms of the
same root cause:
- Clicking a later section's clip block in the arrangement selects the track but never retargets
  the bottom clip editor away from the first section's clip (pilot 84 — verified via precise
  `data-clip-block` targeting, not approximate coordinates).
- "Place in Arrangement" always writes into `doc.song[0]`'s scene regardless of which section is in
  view (pilot 86 — confirmed against the live document).
- The only working path to edit a later section's content is the raw `.beat` file or CLI (pilots
  83, 84, 86 all independently gave up on the GUI for this).

**Fix shape:** add a "currently selected section" concept to the store (alongside the existing
`selectedTrack`), wire the arrangement's clip-block click (and/or section-chip click) to set it,
and make `primaryClipFor`/`placeInArrangement` prefer the selected section's scene for the current
track when one is selected, falling back to the existing first-occurrence behavior when nothing is
selected (loop mode, or a track with no clip in the selected section). Also while in this area:
- `"+ section"` silently shares the previous section's scene id (correct, intentional, but there's
  no visual indicator in the arrangement distinguishing "these sections share a scene" from
  "these are independent" — a real footgun pilot 86 called out explicitly). Add a visual cue (e.g.
  matching color chip, or a small "linked" glyph) when two or more visible sections share a scene.
- Sections/scenes have no human-readable name — only the auto-generated scene id (`s1`, `s2`, ...)
  — despite the arrangement's own hint text ("double-click a name to rename") sitting directly
  above the section toolbar, which double-clicking a section does NOT honor (it starts playback
  instead). Either wire up section rename on double-click, or scope the hint text so it doesn't
  read as applying to sections.
- Deleting a section leaves its scene object orphaned in `doc.scenes` (pilot 83, confirmed via
  `beat inspect`). When a section is deleted, prune any scene no longer referenced by any remaining
  section.

## GB — Macro/preset display desync

`MacroKnob` (`SynthPanel.tsx:396`) re-estimates its displayed position only when `track.id`
changes (`useEffect(..., [track.id])`), by design — so a user's own in-progress knob drag stays
authoritative. But switching a track's PRESET (`PresetPicker`, line 288) changes the underlying
synth params just as drastically as switching tracks does, and the macro row doesn't refresh:
pilot 81 found the six macro knobs showing identical numbers before/after a preset swap despite
`cutoff`/envelope changing significantly; pilot 86 found it worse under a page reload — the preset
LABEL itself can revert to the wrong kit name while the underlying (correct) params stay put, and
the macro knobs then show a THIRD, unrelated set of numbers matching neither preset. Root cause
confirmed: neither "current preset" nor "macro dial position" is a real field in the `.beat`
document (grepped, confirmed absent) — both are inferred client-side from raw params, and that
inference currently only fires on a track-switch, not a preset-switch.

**Fix:** re-derive each `MacroKnob`'s displayed estimate whenever the track's PRESET changes (not
only when the selected track itself changes) — distinguish "a preset was just applied" from "the
user is dragging this knob" so the human's own in-progress drag still wins, but a preset swap
always wins over a stale macro-knob display. Check whether `InstrumentPanel.tsx` has its own
`MacroKnob`/`PresetPicker` copy that needs the identical fix (Phase 27/28 notes suggest
`SynthPanel.tsx` and `InstrumentPanel.tsx` intentionally mirror each other's rhythm).

Also while in this area: no visible confirmation appears anywhere in the default (Clip-tab) view
after a preset is successfully drag-applied from the Content Browser (pilot 80) — you have to know
to switch to the Device tab to see it took effect. Add a lightweight confirmation (toast, or an
inline flash on the Device tab button) when a drag-applied preset lands.

## GC — Note/drum grid interaction & precision bugs

All in `NoteView.tsx`. Fix each independently; they're related only by living in the same
component, not by a shared root cause.

1. **Click-to-add off-by-one** (`NoteView.tsx:462`, confirmed exact line in pilot 80): the grid's
   click-to-add math (`step = Math.round((e.clientX - rect.left) / stepW)`) snaps to the nearest
   GRIDLINE, not "which cell contains the click" — since a step's visual cell spans gridline N to
   N+1 but the click-target region resolving to step N is centered ON gridline N (spanning
   N−0.5 to N+0.5), clicking the right half of what looks like "step N" silently places the note on
   step N+1. Confirmed via 24 real `.beat`-file hits in pilot 80. Fix the snap math to floor to the
   containing cell (`Math.floor`), not round to the nearest line.
2. **View auto-recenters/jumps after adding a note or hit.** Observed independently in both the
   drum-lane grid (~19px shift, pilot 80) and the note/pitch grid (~1 full octave, pilots 80 and
   83 — "the visible pitch window silently shifts... each time a note lands"). The view should stay
   stable across an edit unless the user explicitly scrolls/zooms.
3. **Click on empty grid while a note is selected only deselects, instead of adding a note**
   (pilot 84) — the click is silently "eaten." A click on empty grid space should always add a note
   there, regardless of prior selection state.
4. **Selection doesn't narrow on a plain click.** After a marquee (multi-note) selection, clicking
   directly on one already-selected note does not narrow the selection down to just that note — all
   notes stay selected; an empty-cell click is needed first to deselect everything (pilot 83). Every
   other note editor treats a plain click on an item as "select just this one" regardless of prior
   selection state — match that.
5. **Drag-based note resize causes vertical scroll drift.** Dragging a note's right-edge resize
   handle can cause the piano roll's vertical scroll to drift by exactly one octave mid-drag,
   silently placing the note (and subsequent notes) an octave away from where the user is looking
   (pilot 84).
6. **Sticky title-bar re-docks over real content.** `.noteview-titlebar-name` uses `position:
   sticky` inside the scrollable lane/note list; at certain scroll offsets it re-docks directly on
   top of a real content row, fully obscuring that row's label and controls — reproduced in both
   the drum-lane list (landing on the "hat" lane) and the note editor's pitch-row list (pilot 80).
   Same underlying pattern in two places — fix with a scroll-margin or z-index adjustment that
   generalizes, not a one-off patch for one panel.

If time allows: add a small live readout (e.g. a step number in a hover tooltip) while placing a
drum hit or note — pilot 82 noted there's currently no way, even for a careful human, to confirm
"that's step 8, not step 9" while clicking.

## GD — Data integrity & daemon resilience

1. **Rapid successive grid edits silently lose data.** Pilot 82: clicking to add ~24 grid hits
   300-400ms apart resulted in only ~4 actually persisting, though every intermediate screenshot
   showed the UI rendering all of them. Confirmed genuine (not a fluke) by a controlled retest:
   3 hits 1.5s apart all persisted; rapid-fire loses data. This smells like an optimistic-update
   race — each edit likely computes its patch against a possibly-stale local copy and overwrites the
   daemon's actual current state instead of merging. Find wherever grid pointer handlers in
   `NoteView.tsx` call `postEdit`/`postAdd*` in `ui/src/daemon/bridge.ts` and make rapid-fire edits
   serialize/queue correctly against the daemon's actual current state rather than a stale snapshot
   captured at click-start.
2. **Daemon dies silently with zero log output.** Observed independently in pilots 82, 84, and 86 —
   the connection indicator flips to "○ offline" with nothing in the daemon's log beyond the startup
   banner. The GUI's auto-reconnect-on-restart already works well (good resilience); the gap is
   debuggability. Add `process.on('uncaughtException', ...)` and `process.on('unhandledRejection',
   ...)` handlers to `src/daemon/daemon.ts`'s process entrypoint that log the real error/stack
   before the process exits, so a crash leaves an actual diagnosable trace instead of silence.

## GE — Dialogs/toasts/discoverability copy

1. **Mixer modal's scrim blocks the topbar Undo button.** With the Mixer open, `document.
   elementFromPoint()` at the Undo button's coordinates returns `.overlay-scrim`, not the button —
   it's not disabled, just silently unclickable; only Ctrl/Cmd+Z works (pilot 81). The Browser and
   History side-panels already use a non-blocking pattern that doesn't have this problem — bring the
   Mixer's scrim (`MixerView.tsx`) in line with that precedent (or explicitly raise the topbar above
   the scrim's z-index/pointer-events).
2. **Replace `window.alert()`/`window.confirm()` with real in-app feedback.** There is no toast/
   banner component in the codebase today — every error and confirmation path in `ArrangementView.
   tsx` (~25 call sites) and a handful in `NoteView.tsx` and `ContentBrowser.tsx` uses a raw,
   unstyled native browser dialog. Two pilots hit this directly as a real usability issue: pilot 82's
   Playwright driver crashed on the first one because default dialog auto-dismiss ate the message,
   and pilot 85 called the loop-mode-drop refusal "jarring against the rest of dotbeat's polished
   dark-themed GUI." Build a lightweight toast/banner component (success + error variants is enough
   — this app doesn't need a full notification stack) and do a mechanical sweep replacing
   `window.alert(...)` call sites with it across `ArrangementView.tsx`, `NoteView.tsx`, and
   `ContentBrowser.tsx`. Keep `window.confirm()` for any destructive-action confirmations if present
   (that's still an appropriate use of a blocking native dialog) — this is specifically about
   `alert()`'s pure-notification uses.
3. **Automation popup doesn't dismiss on outside click.** The right-click breakpoint popup (numeric
   entry + Linear/Hold/Curve) only closes via Escape (and only if the input itself has focus) or a
   further click inside that same lane — clicking anywhere else on the page leaves it open
   indefinitely (pilot 81). Add a standard outside-click-to-dismiss handler.
4. **Version History's copy is misleading, and there's no GUI way to create a checkpoint.**
   `HistoryPanel.tsx:118` shows "No checkpoints yet — make an edit to save one" — literally false as
   stated (edits alone never create a checkpoint; this is documented, known behavior) after dozens
   of real edits in pilot 80's session. A GUI-only new user has no discoverable way inside the app to
   snapshot their work; they'd need to already know to reach for `beat checkpoint` via CLI/MCP. Fix
   the copy to not imply an edit alone creates a checkpoint, AND add an actual "save checkpoint"
   button to the History panel that calls whatever the daemon's checkpoint route is (check
   `src/daemon/daemon.ts` / `src/history/` for the existing HTTP surface `beat checkpoint` already
   uses — this should be a thin GUI wrapper around an existing capability, not new history-layer
   work).
5. **Content Browser has zero drag-and-drop hint text.** Every other panel in the app over-explains
   itself with inline gray hint text (the Arrangement header, the Clip editor); the Browser — one of
   the first panels a new user reaches for — has none, and its actual interaction model (drag onto a
   track; click alone does nothing but highlight the row) is invisible until discovered by accident
   or DOM inspection (pilot 80, confirmed again independently in pilot 83). Add a hint line matching
   the visual convention already established elsewhere (e.g. "drag a preset onto a track to apply
   it").
6. **"≈ vary hats" / "≈ vary feel" button labels don't signal what they actually do.** Both open a
   sound-design tool that varies synth TIMBRE (`hatTone`, `hatDecay`, etc.) via a 9-variant Prev/
   Next/Keep/Undo browser — genuinely useful, but pilot 82 (and the task brief that prompted these
   pilots) assumed "vary" meant "vary which steps are hit." Adjust the label or add a short
   qualifier (e.g. "≈ vary hats (tone)") so the distinction from a rhythmic variation is clear
   up front, without overselling — a real rhythmic-pattern vary tool is out of scope for this phase
   (see "not in scope" above).

## GF — Layout/visual/small-correctness polish sweep

Independent, mostly single-file CSS/JS fixes. Work through as a checklist; each item stands alone.

1. **Horizontal overflow on tall note selection.** Selecting a note (or otherwise making the bottom
   panel tall enough to need its own vertical scrollbar) reliably makes `document.body` 17px wider
   than the viewport — confirmed via `scrollWidth` vs `innerWidth`, reproduced on a fresh reload. At
   least once this surfaced as the whole app shell scrolling horizontally, clipping the logo and the
   left-pinned panel titles (pilot 81). The overflow amount (17px) matches the bottom panel's own
   vertical scrollbar width — find wherever that panel's width is computed and account for the
   scrollbar (`overflow-y: scroll` reserving a gutter, or a `scrollbar-gutter: stable` rule) instead
   of letting it silently push total width past 100vw.
2. **Arrangement clip block border is nearly invisible.** `.arr-clip-block`'s 1px border is thin,
   dark-on-dark, and essentially invisible at normal viewing scale — only the "(loop)" label chip
   reads as "the whole clip" at a glance, making every clip look like a ~30px sliver regardless of
   its real (correct) width (pilot 80, reproduced on multiple tracks, confirmed via
   `getBoundingClientRect()` that the element genuinely is full-width — purely a contrast problem).
   Raise the border contrast.
3. **Stale "selection: X" label after a track rename.** Renaming a track (e.g. "synth" → "bass")
   doesn't update the top-left "selection: synth" status-strip text, which keeps the pre-rename name
   for the rest of the session (pilot 83).
4. **Audio clip `loop [start]-[end] bars` fields are a dead no-op control.** They visibly resize the
   range bar in the trim/warp editor but never persist to the `.beat` file for audio-kind clips —
   confirmed by diffing the raw document before/after (pilot 85), likely a leftover from a shared
   note-clip-properties component not gated per track kind. Either wire it up for real, or hide/
   disable it for audio clips so it doesn't look functional when it isn't.
5. **`warp: complex` is selectable with zero indication it's unimplemented.** `beat inspect` prints
   "complex (unimplemented)" and `docs/format-spec.md` documents it as a deliberate, deferred scope
   cut — but the GUI dropdown gives no signal, so selecting it looks identical to a working mode
   (pilot 85). Add a "(not yet implemented)" annotation in the option label, or grey it out.
6. **A freshly-added, empty automation lane renders as near-invisible** — two ~6%-opacity rail lines
   on a dark background, no baseline, no current-value marker, nothing that reads as "click here to
   add a point" (pilot 81). Works well once discovered; the empty state gives no visual invitation.
   Separately, pilot 84 found a newly-added lane can render entirely BEHIND the clip-editor panel
   (a z-index/stacking issue) when the arrangement pane isn't tall enough — the lane genuinely exists
   in the document but looks indistinguishable from "the add-lane button doesn't work." Fix both:
   the empty-state visibility and the stacking-context bug.
7. **Automation-lane parameter dropdown resets to the top of its ~100-option list every time a lane
   is added**, making multi-lane setup tedious — re-open, re-scroll, every time (pilot 84).
8. **A `setState` during render warning surfaces in `ArrangementView` in normal use** (pilot 84,
   console-only, not user-visible, but a real code-quality flag worth tracking down and fixing
   properly rather than suppressing).
9. **Content Browser's genre-named drum-kit sections visually read as audio loops but aren't.**
   Sections like `808-TRAP`, `TECHNO`, `BOOM-BAP` show a single item with a cassette-style icon that
   reads as "a loop file" — they're actually synthesized-drum PRESET bundles with zero audio
   content, previewed through the drum synth engine (pilot 85). The real audio media lives one level
   deeper (`Kits → <kit> → <lane>` rows) with no distinct "this is real audio" affordance versus a
   preset row. Give audio-bearing rows (real `.wav`/sample content) a visually distinct icon/badge
   from synthesized-preset rows, so a user hunting for a sample doesn't waste a drag on a dead end.
10. Effect sends are buried at the bottom of a six-section collapsed accordion in the Device panel
    (Filter & Envelope, Amp & Output, Ping Pong Delay, Beat Repeat, Chorus/Phaser, Saturator, THEN
    Sends) with no search/jump control (pilot 86). If straightforward, consider defaulting Sends to
    an expanded/pinned state, or adding a quick-jump — but don't force a bigger effects-panel
    redesign to fit this phase; a small win here is enough.

## Merge order

Merge **GA first** — it's the highest-impact fix and touches `ArrangementView.tsx`'s clip-block
click handling plus `NoteView.tsx`'s `placeInArrangement`, both files several other streams also
touch. **GC and GD both live almost entirely inside `NoteView.tsx`** and are the most likely real
merge-conflict pair (interaction bugs vs. data-integrity bugs, different code paths in the same
file) — merge GC before GD and expect to hand-resolve overlapping hunks. **GE's alert()-sweep
touches `ArrangementView.tsx` broadly** (~20+ call sites) — merge it after GA so GA's edits to that
file land on a clean base, not the other way around. Suggested order: **GA → GB → GC → GD → GE →
GF**. GF is the least contended (mostly `styles.css` plus scattered small JS fixes) and safest to
merge last as a final sweep.

## Verification approach

Same discipline as every prior phase: after each merge, independently re-run (a) core typecheck,
(b) UI typecheck, (c) full `npm test`, (d) the just-merged stream's own live-verify script if it
wrote one, and (e) a couple of prior streams' verify scripts as cross-stream regression checks —
never trust a dispatched agent's own "all passing" self-report. Additionally, since this whole
phase originates from usability pilots rather than a spec, each stream should end with a short,
targeted MANUAL re-check against the real running app (not just a scripted assertion) confirming
the specific pilot-reported symptom is actually gone — e.g. for GA, click a second section's clip
block and confirm the note editor actually retargets; for GC's off-by-one, click the visual center
of a grid cell and confirm the resulting `.beat` file has the intended step, not step+1.
