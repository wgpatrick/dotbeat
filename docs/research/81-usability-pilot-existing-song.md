# 81 — Usability pilot: picking up an existing multi-track song

*2026-07-12. Exploratory usability session (not a verify script — no checklist, no pass/fail
assertions). Built app (`npm run build` at repo root + `ui/`), copied `examples/night-shift.beat`
to a disposable `/tmp/dotbeat-usability-existing/song.beat`, ran a real `beat daemon` on :9303 and
`vite preview` on :9304, and drove the actual running app with Playwright (`connectOverCDP` against
a long-lived headless Chrome, so each step could be screenshotted and read individually rather than
executed as one blind script) the way a returning owner would pick up their own project: tweak a
clip, adjust the mix, swap a sound, add automation, rearrange something, use undo. Read every
screenshot before deciding the next action. Skimmed `docs/phase-26-plan.md`, `phase-27-plan.md`,
`phase-28-plan.md` first so recently-shipped features (undo/redo, macros, drag-state visuals,
design tokens, curved automation, the clip title bar) aren't mistaken for bugs.*

## Walkthrough

**First look.** The fixture (`night-shift.beat`, loop mode, no `song` block, 4 bars) rendered
legibly at a glance: four tracks — lead (red), drums (cyan), bass (gold), pad (purple) — each with
a full-width, colored, bordered `(loop)` clip block and a mini note-content preview underneath. This
is Phase 27 Stream EA's bug-1 fix (loop-mode clip boundaries) working as intended — I confirmed via
DOM query that `.arr-clip-block` really does span the full lane width with a real border in the
track's own color, not just the bare canvas the old code produced. Good first impression: I could
tell what existed and roughly what was arranged where within a couple of seconds.

**Editing a note.** Selected the `lead` track, clicked a note in the piano roll. It selected
correctly (`.noteview-note.selected` + matching velocity/chance-bar selection), and the bottom panel
auto-scrolled to reveal three inspector panels — PITCH & TIME, NOTES, and NOTE `<id>` — each with its
own colored left-border accent (blue / gold / pink). That's Phase 27 Stream EG's differentiation
pass, and it works: the three panels read as visually distinct at a glance, not identical boxes.
Clicked "Transpose" (+1 semitone) — the note moved, the NOTES panel updated E5→F5, and a small
orange "1 note changed" label lit up next to Consolidate. Clicked the topbar Undo button: reverted
cleanly back to E5 in one step, note position restored. This is exactly the workflow I'd expect and
it worked without hesitation. One small miss: the "1 note changed" label stayed lit even after the
undo fully reverted the edit — a stale confirmation, not a real problem, but hints the label isn't
wired to the undo stack.

**But:** that same note-click auto-scroll has a real cost. It scrolled the bottom panel down ~156px
to reveal the inspector, which pushed the "Preview clip / Place in Arrangement" toolbar row and the
"clip properties" hint text — both directly useful right after selecting a note — up out of view with
zero indication there was anything above. I had to know to scroll back up. Worse: at one point during
this same interaction, the same auto-scroll-into-view behavior escaped the inner panel and scrolled
the **entire page** horizontally by 17px. I caught it on screenshot: the "dotbeat" logo, the
"BROWSER" panel title (rendered as "ROWSER"), and "ARRANGEMENT" (rendered as "RRANGEMENT") were all
clipped at the left edge of the viewport. I measured it directly — `window.scrollX` was 17,
`document.body.scrollWidth` was 1617 against a 1600px viewport. I could not get the horizontal
window-scroll to fire on a clean, isolated repro afterward (several careful replays of the same
click sequence all stayed at `scrollX: 0`), but the underlying 17px overflow (`body.scrollWidth`
exceeding the viewport by exactly the width of the bottom panel's own vertical scrollbar) reproduced
reliably every single time I selected a note that made the inspector tall enough to need one. That's
a real, always-present layout bug; whether it becomes visible as an actual clipped viewport looks
timing-dependent, but I have hard photographic and numeric evidence it does happen in ordinary use,
not synthetic conditions.

**Mixing.** Opened the Mixer (a full-screen modal-with-scrim, distinct from Browser/History's
non-blocking side-panel pattern — worth remembering for the next finding). All four channel strips
were clear: pan knob, EQ/Comp/Dist "active chain" badges, shuffle/grid groove knobs, a real vertical
fader with live dB readout, mute/solo. Clicked the "Dist" badge on the bass strip expecting maybe a
jump to that effect — nothing happened, which is correct: I checked the CSS and confirmed the badges
carry no `cursor: pointer` and no click handler, so there's no false affordance, just an inert status
chip. Tried the new click-to-type numeric entry (Phase 27 Stream EI) on the bass pan knob: clicked
"C", got a real text input, typed `0.35`, hit Enter — display updated to "R35" and, nicely, the
arrangement view's own inline per-track pan control synced live to match. Dragged the pad channel's
fader down ~26dB: the dB readout updated live and the change was written straight to the `.beat`
file (confirmed on disk: `volume -26.75`), matching the mixer's own stated contract ("level + pan
write to the .beat file, one-line diff").

**Then I tried to undo it, and the Undo button didn't respond.** It's not disabled — `button.disabled`
reads `false`, the title tooltip is present and correct — but with the Mixer modal open,
`document.elementFromPoint()` at the Undo button's exact coordinates returns `.overlay-scrim`, the
modal's full-page dimming layer, not the button. Playwright's click literally times out waiting for
the scrim to stop intercepting pointer events. The only way to undo while the Mixer is open is the
Ctrl/Cmd+Z keyboard shortcut, which does work correctly. This is a real trap: a user who drags a
fader too far, doesn't know the shortcut, and reaches for the visible, seemingly-live Undo button
right there in the topbar will click it and nothing will happen — no error, no shake, no feedback,
just silence. I checked whether this is systemic: it isn't. The Browser side-panel and the History
side-panel both leave the topbar fully clickable (confirmed `elementFromPoint` returns the real
button in both cases) — only the Mixer uses the blocking modal+scrim pattern. The fix precedent
already exists elsewhere in the same app.

**Swapping a sound.** Opened the pad track's Device panel. First attempt: picked "lush-pad" from the
in-panel PRESET dropdown, got a clean "applied 'lush-pad'" confirmation next to it — but the actual
knob values in the panel looked completely unchanged before and after. Initially read as a bug (does
"apply" not actually apply?), but checking the `.beat` file and then the preset's own JSON
definition explained it: `lush-pad`'s description literally says "(Night Shift v3 pad)" — it's the
exact preset this fixture's pad track already used, so a real no-op. Picking a genuinely different
preset (`dark-pad`) proved the picker really works: cutoff 2600→900, attack 0.4s→0.7s, release
1.2s→2.0s, resonance 0.8→1.2, three new filter-envelope fields appeared — all written to the `.beat`
file, and a single Ctrl+Z reverted the entire multi-parameter swap as one atomic undo step, not one
step per parameter. Genuinely good UX.

**But the Macro row didn't follow.** The six macro knobs (Filter-Sweep, Grit, Space, Warmth, Motion,
Width) showed identical numbers before and after the preset swap, despite cutoff and the envelope
changing drastically. I checked the source: this is deliberate, documented behavior —
`MacroKnob`'s own comment says a macro's displayed position is "a best-effort display estimate,"
re-derived only when `track.id` changes (switching tracks), explicitly not on every param change, so
the human's own drag stays authoritative once started. Reasonable as a technical tradeoff, but from
the seat of someone browsing presets, the Macro row visibly lies about the current filter state until
you click away to a different track and back — there's no cue that it's stale.

**Also:** switching from the Clip tab (scrolled down while note-editing) to a different track's
Device tab landed already scrolled ~512px down, hiding that panel's own title bar, PRESET picker,
and Macro row entirely with no indication there was more content above. The bottom panel's scroll
position simply isn't reset on tab/track switches.

**Automation.** The per-track "A" toggle was correctly disabled in loop mode with a clear tooltip
("add this track to a scene to automate its clip"), matching the documented clip-scoped/song-mode-
only automation model — not a bug, just gated, and the tooltip explains why. Clicked "+ section" to
enter song mode (now "SONG 8," 2 identical scenes), and the "A" toggle for `pad` became enabled.
Added a `Cutoff` automation lane — and the lane rendered as functionally blank: just two ~6%-opacity
rail lines on a dark background, no baseline, no current-value marker, nothing that reads as
"click here." Once I clicked into it anyway, it worked well: three points went in cleanly, tiled
correctly across both scene occurrences of the loop, connected by a visible curve line in the
track's own color. Right-clicking a point opened a clean popup (Phase 26 Stream DI) — precise
numeric entry (`9629.7151`) plus Linear/Hold/Curve buttons — and clicking "Curve" visibly bowed the
segment into a smooth arc immediately. This is a well-built, precise feature; the only real
discoverability gap is the empty-lane's near-total lack of visual invitation to click it in the first
place.

**One more rough edge on that popup:** it doesn't close on Escape (only works if the numeric input
itself has keyboard focus) and doesn't close on clicking elsewhere on the page — only a further click
inside that *same* automation lane dismisses it. Clicking down into the Device panel below left it
sitting open on screen indefinitely.

**Two deliberately "wrong path" tries.** Right-clicked a clip block in the arrangement, half-
expecting a context menu (cut/duplicate/rename) the way most DAWs offer one. Nothing like that exists
anywhere in this app — it just performed an ordinary select (confirmed via the `.arr-clip-block`
gaining a `selected` class). Not broken, but likely to surprise anyone coming from Ableton/Logic/FL
muscle memory. Separately, tried dragging a clip occurrence to a new position within its own 4-bar
scene slot — a completely ordinary "rearrange this" gesture. It showed a brief drag-outline, then
snapped back to its exact original position on release with zero feedback: no rejection toast, no
cursor change, nothing to tell me whether the drop was invalid, unsupported in this context, or just
silently ignored. I genuinely don't know, from the UI alone, whether I did something wrong or the app
is just not responsive to that gesture here.

**Version History.** Opened the "History" panel (distinct from in-session Undo/Redo) — a clean,
non-blocking right-side drawer with good, honest copy: "newest first · restoring goes back without
erasing work" and "No checkpoints yet — make an edit to save one." Confirmed the topbar Undo button
stays fully clickable while this panel is open (unlike Mixer) — good, consistent precedent that the
Mixer's implementation should be brought in line with.

**Undo/redo overall.** Across the whole session I chained Ctrl+Z through wildly different edit types
in sequence — a note transpose, a mixer fader drag, a mixer pan knob type-edit, a full preset swap,
automation point additions, an interpolation-mode change — and repeated undos stepped back through
all of them coherently, one logical edit per step (not one raw param write per step), with Redo
available immediately after each. For a feature that shipped as recently as Phase 26, this held up
well under real, mixed-type usage, not just its own single-purpose verify script.

## Findings, prioritized

**[bug]** With the Mixer modal open, the topbar Undo button is visible and not disabled but is
covered by `.overlay-scrim` and silently does nothing when clicked — only Ctrl/Cmd+Z works. No visual
cue the button is inert. The Browser and History panels already use a non-blocking pattern that
doesn't have this problem; Mixer is the one holdout. High priority — this is exactly the moment
(mid-mix-tweak, want to undo) a user is most likely to reach for that button.

**[bug]** Selecting a note (or otherwise making the bottom panel tall enough to need its own vertical
scrollbar) reliably makes `document.body` 17px wider than the viewport. At least once during this
session that surfaced as the entire app shell scrolling horizontally, clipping the "dotbeat" logo and
the left-pinned "BROWSER"/"ARRANGEMENT" labels. I could not force a clean, deterministic repro of the
visible scroll on later attempts, but the underlying overflow condition reproduced every time,
including on a completely fresh page reload — this is a live, if intermittent, layout bug, not a
one-off fluke.

**[confusing]** The automation popup (right-click a breakpoint for exact numeric entry + Linear/Hold
/Curve) only dismisses via Escape if its input has keyboard focus, or via a further click inside the
*same* lane — clicking anywhere else on the page leaves it stuck open indefinitely.

**[confusing]** Bottom-panel scroll position isn't reset when switching tracks or Clip/Device tabs.
Landing on a Device panel already scrolled ~500px down, with its own title bar/preset picker/macro
row invisible above the fold and no affordance signaling more content exists upward, is a real "what
do I do next" moment for anyone who hasn't memorized the panel's total height.

**[confusing]** Clicking a note auto-scrolls the bottom panel to reveal the inspector, which as a
side effect hides the "Preview clip / Place in Arrangement" toolbar and the clip-properties hint
directly above it. Reasonable intent (show the thing you just selected), unwanted side effect
(hides other things you're likely to want next).

**[confusing]** After a preset swap changes underlying synth params drastically, the Macro row's
knobs don't visually update to match — by design (documented "no ground truth" tradeoff, only
re-estimated on track switch), but a user reading the Macro row as a live summary of the current
sound will be misled until they navigate away and back.

**[confusing]** Dragging a clip occurrence within its own scene slot silently snaps back to its
original position with no feedback about whether the gesture was rejected, unsupported, or ignored.

**[confusing]** No context menu exists anywhere in the app; right-clicking a clip block just performs
an ordinary select. Not broken, but a likely instinctive miss for anyone with other-DAW muscle memory.

**[worked well]** Loop-mode clip boundaries (Phase 27 EA fix) — full-width, bordered, colored clip
blocks made the fixture's structure legible at a glance, a clear improvement over the "bare canvas"
state the fix notes describe.

**[worked well]** NoteView's differentiated inspector panels (Phase 27 EG) — PITCH & TIME / NOTES /
NOTE `<id>` read as genuinely distinct panels via their colored left-border accents, not identical
boxes.

**[worked well]** Note transpose + undo, mixer fader/pan edits + undo, and a full preset swap + undo
(as one atomic step, not per-parameter) all worked exactly as expected, including live cross-view
sync (mixer pan edit instantly reflected in the arrangement's inline track header).

**[worked well]** Curved automation breakpoints (Phase 26 DI) — the right-click popup's exact numeric
entry and Linear/Hold/Curve buttons are precise and immediate; clicking "Curve" visibly bowed the
segment on the spot.

**[worked well]** Version History's non-blocking side-panel pattern, with clear copy distinguishing
it from in-session Undo/Redo, and (unlike Mixer) it doesn't block the topbar while open.

**[worked well]** Multi-step undo/redo held up coherently across a long, mixed sequence of very
different edit types in the same session, not just in isolation.

**[slow-to-discover]** A freshly-added automation lane with zero points renders as near-invisible
(two faint 6%-opacity rails on a dark background) — no baseline, no gridline, no hint that it's an
editable canvas or where the click-to-add gesture should start. Works great once discovered.
