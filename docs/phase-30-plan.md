# Phase 30 — fixing what usability pilots 87-89 found

Source: three core-area usability pilots (`docs/research/87` arrangement view, `88` clip creation
across all track kinds, `89` clip editing) run in the same batch as Phase 29's bug-fix streams.
**Caveat worth stating up front**: pilots 87-89 ran without worktree isolation, directly against the
shared main checkout, *while* Phase 29's six streams were being merged into that same checkout over
roughly ninety minutes. Several of their findings describing already-known GA/GD-class bugs
(left-click not retargeting the clip editor, the linked-scene indicator's presence/absence) are very
likely artifacts of testing against a moving target — a live-reloading dev server picking up a
partial merge mid-session — not real gaps in the current, fully-merged main. Before writing this
plan each surprising claim was independently re-verified against the current stable main (see the
"Already resolved, no action" section) rather than taken at face value. What remains below is
findings confirmed real on current main, either by direct testing or because they describe an area
Phase 29 never touched.

## Already resolved by Phase 29 — verified, no action needed

- **Left-click retargeting the clip editor to a non-first section's clip.** GA's own live-verify
  script (`ui/verify-phase29-stream-ga.mjs`) explicitly drives this via a plain (left) click against
  a clean production build and passes — not a dev-server artifact. Re-checked the click handler
  itself (`ArrangementView.tsx`'s `beginClipDrag`, the `if (!moved)` branch) — it calls
  `setSelectedSection(sectionIndex)` unconditionally on a plain click/tap, with no button-type gate,
  so left-click and right-click both already retarget identically. Pilot 87's "only right-click
  works" finding does not reproduce against current main.
- **"Linked scene" visual indicator and orphaned-scene pruning on section delete.** Both are GA
  deliverables (`.arr-chip-linked` badge, `songDelete`'s scene-pruning), confirmed passing in GA's
  own verify script (T6/T7). Pilot 87 found the indicator "already" present — it landed mid-pilot.
- **Rapid drum-grid click data loss.** GD's fix targets the append-grammar path generically (any
  `<track>.note`/`<track>.hit` add, not gated by track kind), and GD's own verify script fires 18
  rapid clicks on the **drums** lane specifically and confirms all persist. Pilot 88's higher-severity
  repro (13/14 lost) predates that fix reaching the checkout it was testing against.
- **Content Browser audio-vs-preset row distinction.** GF added `.lib-audio-badge` to real
  sample-bearing rows; pilot 88's "genre-named kit sections look like loops" finding is the same gap
  GF closed.

## Not in scope — architecture, not a bug

- **"One clip per track, shared by reference across every section"** (pilots 88's goal-#4 wall, both
  Synth and Audio track kinds). Documented, deliberate v1 scope cut (`ArrangementView.tsx:317`,
  `ClipPropertiesPanel.tsx:15`) — building real multi-clip-per-track support is a genuine feature,
  not a fix-phase item. The *discoverability* gap (no warning before an edit retroactively changes
  every section sharing a clip) is in scope, tracked under Stream JD below.
- **Full first-class Audio-track editing** (multi-region placement, a from-scratch audio-editor
  panel). Stream JE below only fixes the bottom panel showing an actively wrong/irrelevant note-grid
  for Audio tracks — it does not attempt to build out Audio's editing surface further.
- **Arrangement-level Delete/Cmd+D on a clip block, LOOP↔SONG mode reversal.** Real gaps, but small
  enough that they're folded into Stream JD as "if time allows" rather than guaranteed deliverables —
  see that stream's notes.

## Streams

| Stream | Feature area | Primary files | Source research |
|---|---|---|---|
| JA | Drum-hit editor: edits don't reach the daemon, plus a hitbox/marquee bug pair | `ui/src/components/NoteView.tsx` (hit-specific `eventKind === 'hit'` branches) | 89 |
| JB | Global Undo button reliability + non-atomic multi-entity undo history | `ui/src/state/store.ts` (`canUndo`/`canRedo` derivation), `ui/src/daemon/bridge.ts` (`postUndo`), `src/daemon/daemon.ts` (undo-stack coalescing) | 89 |
| JC | Note editor UX gaps: deselect, copy/paste-no-playhead, Quantize feedback, transform-overflow warning | `ui/src/components/NoteView.tsx` | 89 |
| JD | Track/section management polish: rename, Instrument-disabled hint, Place-in-Arrangement failure hint, clip-drag scene-fork toast, shared-clip overwrite warning | `ui/src/components/ArrangementView.tsx`, `ui/src/components/NoteView.tsx` | 87, 88 |
| JE | Audio track bottom-panel coherence | `ui/src/App.tsx` (bottom-pane switch), `ui/src/components/ArrangementView.tsx` | 88 |

## JA — Drum-hit editor: edits don't reach the daemon

**Highest-priority finding in this phase, independently confirmed real** (not a pilot artifact):
tested directly against a clean `night-shift.beat` daemon — `POST /edit {"path":"drums.hit.kick0",
"value":""}` correctly deletes the hit server-side (`GET /document` confirms it's gone). So the core
edit machinery works fine for hit deletion on an implicit-kit (unmaterialized-lanes) drum track. The
bug is specifically in the GUI's own drum-editor code path: pilot 89 found deleting, moving, or
gating/resizing a hit through the drum clip editor updates the client-side store (`window.__store`'s
`hits` array visibly changes) but the daemon's document never reflects it — confirmed with a
full-reload test (44→41→44 hits, the edits silently discarded) and a minimal single-hit-delete repro
checked immediately against `GET /doc`. The `lead` track's NOTE edits in the same session, checked
the identical way, persisted correctly every time — this is specific to the drum-hit path.

Investigate `NoteView.tsx`'s `eventKind === 'hit'` branches (delete, move, resize/gate) — likely
either a malformed `postEdit` path/value for hit-specific operations, or a request that's being sent
but rejected/dropped somewhere between the client and `POST /edit` with the rejection swallowed
client-side (the optimistic local update would explain why the UI never shows an error even though
nothing persists). Test specifically against a track still on the implicit 5-lane kit (`lanes: []` —
`night-shift.beat`'s `drums` track, no "Enable lane editing" click), since that's the exact
reproducing condition; also test after materializing lanes to see whether the bug is
implicit-kit-specific or general.

**Also in this stream** (same component, drum-hit-specific interaction bugs, confirmed in the same
pilot session):
- **A drum-hit marker's move-hitbox is ~1px out of a 7px-wide marker** — the resize/gate handle
  occupies the center-to-right ~5px, leaving only the extreme left edge safe to grab for a plain
  move; dragging almost anywhere else on a hit produces an unwanted gate/resize instead. Rebalance
  the hit-testing so a reasonable middle portion of the marker triggers a move and only the actual
  edge triggers resize, matching how note markers in the pitch editor already work.
- **Marquee (drag) select does not work at all in the drum-hit editor**, despite being advertised in
  the same hint-bar copy the note editor uses ("drag to marquee-select"). A drag rectangle spanning
  several populated hit cells selects nothing and draws no visible marquee box. Shift-click
  multi-select works as a fallback but marquee should work identically to the note editor's.

## JB — Undo button reliability + non-atomic multi-entity undo history

Two related findings from repeated, clean-reload-verified testing (3 independent repro cycles):

1. **The toolbar Undo button's displayed state doesn't reliably reflect the real undo stack.**
   Observed twice, distinctly: (a) immediately after a fresh, undoable edit (a note add, a diagonal
   drag), the button shows `disabled` and clicking it is a no-op — Cmd+Z correctly reverts. (b) On a
   resize, the button showed `enabled`, a click visibly flipped it to disabled, but the edit was
   **not actually reverted** — a follow-up Cmd+Z was needed to apply the real undo. Cmd+Z was
   reliable in every single case tested across the whole pilot session; the button was not. Find
   wherever `canUndo`/`canRedo` (see `store.ts`, mirrored from `GET /undo-state` + the `undo-state`
   SSE event per Phase 26 Stream DB's own comment) is derived and compare its timing/triggering
   against the keyboard shortcut's own path (`postUndo` in `bridge.ts`) — the two currently diverge
   in ways real users will hit constantly (any note-editing session involves lots of small edits).
2. **A single user gesture that touches multiple properties or multiple entities produces multiple
   undo-history entries, not one.** A diagonal note move (pitch + start changed together) needs 2
   separate Undo presses to fully revert; a 3-note delete needs 3; a 2-note paste needs 2. A real
   user expects one Undo to revert the one thing they just did. Look at how the daemon's undo stack
   coalesces a burst of edits into one entry (if it does this at all today for anything) and extend
   that grouping to cover "edits that land within one user gesture" — likely keying off the same kind
   of gesture-boundary signal `postEdit`'s debounce/queue logic (Phase 29 Stream GD territory) uses
   to tell a drag's final value from a burst of independent adds.

## JC — Note editor UX gaps

Four independent, confirmed findings, all in `NoteView.tsx`:

1. **No neutral way to deselect.** Clicking empty grid space unconditionally adds a new note/hit
   there (correct, intentional, per the hint text) rather than ever offering a plain deselect, and
   Escape does not clear selection either. Add Escape-to-deselect at minimum (a real, expected
   keyboard convention this app is otherwise good about — see the Shortcuts panel).
2. **Copy/paste silently stacks exact duplicates when there's no active playhead.** With the
   transport stopped (`currentStep === -1`), pasting lands notes at the *identical* pitch+start as
   the originals — perfectly overlapping, invisible on screen, only detectable via note count. The
   hint text promises "paste at the playhead"; fix the no-playhead case to paste with a sensible
   small offset (e.g. the same nudge Alt-drag-duplicate already uses) instead of degrading to a
   silent, invisible stack.
3. **Quantize gives zero feedback when its grid resolution already matches the clip's native step
   size** (the default "16ths" setting). Every other transform (Transpose, Invert, Reverse, Fit to
   Scale, Legato, ×2/÷2) shows an inline "N notes changed" message even for small N; Quantize at the
   default setting against already-aligned notes shows nothing at all — not even "0 notes changed" —
   making it look broken. Always show the confirmation message, including the zero case.
4. **Pitch/time transforms can push notes past the clip's own declared loop length with no
   warning.** `×2` on a 4-bar/64-step clip left notes ending as far as step 112 with no clamping, no
   visual distinction between in-loop and overhanging content, and no warning before or after the
   operation. Add at minimum a warning (toast, using GE's new component) when a transform would push
   content past the clip's loop boundary; clamping is a reasonable stretch goal but not required if
   it turns out musically wrong to silently truncate a transform's math.

## JD — Track/section management polish

Five independent, confirmed findings:

1. **Track rename silently strips spaces.** Renaming to "vox sample" produces "voxsample" with zero
   warning or explanation. Either allow spaces in track display names (if the underlying id/slug
   generation is the actual constraint, keep the internal id space-free but let the *display* name
   carry the space — check how `.beat`'s track-name field is actually stored) or show an inline
   explanation at the point of stripping.
2. **"Instrument" track kind is disabled in the `+ track` menu with only a hover-tooltip
   explanation** ("needs a registered SoundFont sample (beat sample)") — a browser-native title
   tooltip, not inline UI text, and worded in CLI vocabulary a GUI-only user won't recognize. Add a
   proactive inline hint (e.g. directly under the disabled option, or a one-line note pointing at the
   Content Browser's SoundFonts section, which pilot 88 confirmed is the real, pleasant unlock path).
3. **"Place in Arrangement" is a silent no-op in loop mode with no explanation at the point of
   failure.** The only nearby hint text describes an unrelated precondition. Show an inline message
   (or a toast, via GE's new component) at the moment the button is clicked-but-does-nothing,
   explaining "add a song section first."
4. **Dragging a clip block between sections silently forks anonymous new scenes with zero
   feedback.** A very natural "rearrange this" gesture performs a real structural edit — moving a
   track's clip assignment across sections and, if the source/destination shared a scene, minting two
   new opaque scene ids to represent the result. Undo cleanly reverts it (confirmed, no change
   needed there), but the operation should surface a toast (GE's component) explaining what happened
   ("moved clip to section N — this section's content is now independent") rather than leaving the
   user to notice a clip vanished from one place and a mysterious new scene id appeared.
5. **Editing an already-placed, shared clip gives no warning that the edit will retroactively
   change every other section using that same clip.** This is correct, documented v1 behavior (see
   "Not in scope" above) — the fix here is purely the warning, not the architecture. When "Place in
   Arrangement"'s button reads "Placed (clip "X") — update" (i.e. this track already has a clip
   placed elsewhere), and that clip is referenced by more than one section, show a confirmation or
   inline warning before the update lands, naming how many other sections share it.

**If time allows** (not required deliverables for this stream): `Delete`/`Cmd+D` on a selected
arrangement clip block currently no-op silently outside the note editor's own documented scope —
either wire up a real "remove this occurrence" action for Delete, or add an explicit line to the
Shortcuts panel's arrangement-relevant scope stating these don't apply yet, so the silence isn't
mistaken for a bug. Similarly, LOOP-mode → SONG-mode is currently one-directional (no way back even
at exactly one section) — a "revert to loop mode" affordance when down to a single section would
close a minor dead end, but skip it if it doesn't fit cleanly alongside the other JD items.

## JE — Audio track bottom-panel coherence

The bottom "Clip"/"Device" panel — the one consistent, prominent editing surface every other track
kind uses — shows an empty, meaningless note-grid ("0 notes · click a key to preview") for Audio
tracks, even after a real clip is placed with working controls. The actual audio editing controls
(waveform, in/out/gain/warp) live in a separate, smaller, unlabeled strip (`.arr-audio-inspector`)
wedged between the arrangement grid and the bottom panel — both render simultaneously and both stay
playhead-synced during playback, so a user looking at the big labeled panel first (the natural
instinct, since it's the same chrome used for every other track kind) sees what looks like a broken
or empty editor. Fix: when the selected track is Audio-kind, either (a) have the bottom panel itself
render the real audio-editing controls instead of the note-grid component, folding
`.arr-audio-inspector`'s functionality into the panel proper for consistency with every other track
kind, or (b) if that's too large a restructure for this phase, at minimum suppress the irrelevant
note-grid for Audio tracks and replace it with a clear pointer to where the real controls live. Prefer
(a) if it's a reasonably contained change; fall back to (b) and note why if not.

## Merge order

JA, JB, JC all touch `NoteView.tsx` in different, mostly non-overlapping areas (drum-hit event
handlers vs. undo-state wiring vs. deselect/paste/quantize/transform logic) — merge JA first (highest
severity), then JB, then JC, expecting light conflict resolution given three streams in one file. JD
touches `ArrangementView.tsx` broadly (toasts, hints) plus a small `NoteView.tsx` corner (the
shared-clip warning) — merge after JA-JC land. JE is the most isolated (bottom-panel routing in
`App.tsx`) and safest last.

## Verification approach

Same discipline as Phase 29: after each merge, independently re-run core typecheck, UI typecheck,
full `npm test`, the just-merged stream's own live-verify script, and 1-2 prior streams' verify
scripts as cross-stream regression checks. For JA specifically, verification must include a direct
daemon-side check (`GET /document` or `beat inspect`) after a GUI-driven hit delete/move/resize —
matching in the UI is not sufficient given this bug's exact nature (client state was already
confirmed wrong-but-plausible-looking in the pilot that found it).
