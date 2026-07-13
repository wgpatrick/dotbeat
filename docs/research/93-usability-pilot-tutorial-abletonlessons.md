# Usability pilot 93: following a real, published Ableton beginner tutorial in dotbeat

## Intro

Exploratory pilot (no scripted checklist) with a twist on the usual method: instead of a goal we
invent, this session follows a **real, independently-published beginner tutorial** step by step —
["The Best Ableton Live Guide For Absolute
Beginners"](https://abletonlessons.com/the-best-ableton-live-guide-for-absolute-beginners/)
(abletonlessons.com) — performing every step in dotbeat instead of Ableton Live. Scope: the
tutorial's "Use Scenes for Song Structure" section, "Workflow Example 1: Build a Drum Loop in
Session View," and "Workflow Example 2: Reverse & Transpose a Vocal Sample in Arrangement View."
The point is not "can dotbeat do something musically similar" but specifically: where does
dotbeat's own GUI support, versus fail to support, the exact workflow an external, independently-
written source assumes a DAW provides. Driven with a real (non-headless) Chrome via
`playwright-core`'s `connectOverCDP`, 1440×900, screenshotting after every action and reading each
one before the next move, cross-checked against `GET /document` on the daemon as ground truth
throughout — this pilot leaned unusually hard on the ground-truth check, since several of its
biggest findings are cases where the screen and the document disagreed.

Fresh project via `beat init --bpm 120`. Since no vocal/loop content exists in dotbeat's library, a
drum one-shot (`kit-audiophob` → `Kick`, a real, decoded `.wav`) was substituted as the "vocal
sample" stand-in for Workflow Example 2, per the brief.

*Process note: the brief's suggested ports (9807/9808) collided with a concurrently-running
pilot's own driver script that had independently bound an IPv6 wildcard listener on 9807 — `curl`
was silently answered by the wrong process, and the GUI hung forever on "connecting to
daemon...". Moved to a fresh port block (9917 daemon / 9918 vite, CDP debug port 9904) and
confirmed a single listener before continuing — another data point for the existing docs' warning
about concurrent-pilot port collisions.*

## Narrative walkthrough

### Initial screen

Fresh `beat init` opened straight into loop mode, 2 bars, one starter Synth track ("lead"). Top
toolbar: Play/Undo/Redo/BPM/LOOP/POSITION/daemon indicator/Export/Browser/Mixer/History/Shortcuts.
The arrangement hint text ("2 bars · 1 section · detail view...") and a `+ section` button were the
first, most inviting things to try.

### Workflow Example 1: Build a Drum Loop in Session View

**Steps 1-2 (create MIDI track, drag a Drum Rack onto it).** `+ track` opened a clean dropdown:
Synth / Drums / Instrument (greyed out, "needs a registered SoundFont first") / Audio. Picking
"Drums" created a fully-formed drums track in one click — a 12-lane grid
(kick/snare/rimshot/clap/hat/openhat/tom_lo/tom_mid/tom_hi/crash/ride/cowbell), each lane backed by
a synth voice (`synth:membrane`, `synth:noise`, `synth:metal`), auto-selected with its own editor
already open. **This collapses the tutorial's two separate steps into one** — there's no "drag an
instrument from the Browser onto a blank MIDI track" step, because "Drums" is a track *kind* chosen
up front, not a device dropped on later. A "selection: drums" bar also appeared with two
one-click algorithmic variation buttons ("≈ vary hats (tone)," "≈ vary feel (timing)") the tutorial
never mentions — a pleasant, unprompted discovery.

**Steps 3-4 (program a 1-bar pattern).** Calibrated the drum grid's click-to-hit coordinate mapping
empirically against `GET /document` (14px = one 16th-note step, 12px = one lane row) after a first
blind click landed on the wrong of two visually-similar, vertically-stacked panels: an upper
"Lanes (12) · open" *lane-management* list (▲▼/edit/× per-lane controls, an "add lane" row) sits
directly above the actual clickable hit grid — the same shared `noteview` component
Synth/Instrument clips use, just with lane names substituted for piano keys. Reduced the project's
loop length from 2 bars to 1 (matching the tutorial's explicit "1-bar pattern"). Built a basic beat
— kick on beats 1/3, snare on 2/4, closed hat on every 8th note — confirming every hit via
`GET /document` before trusting the screen.

**Step 5 (close Clip View; clip loops continuously).** Closing the bottom panel left the
arrangement's drums clip block showing a small live pattern-preview strip baked into the
rectangle itself — legible confirmation that the clip is "still there," a reasonable analog for
Ableton's continuously-looping Session View clip.

**Step 6 (double-click the same clip again) — did not work as described.** Double-clicking the clip
*block* in the arrangement did nothing; a plain single click also did nothing. The dotbeat
arrangement's own hint text ("click a section's name or clip to view/edit its content below")
describes exactly the gesture that failed. The only thing that reopened the editor was clicking the
**track name text** in the track header. It turns out the hint text's promise is scoped to *song
mode* (once real sections exist) — in plain loop mode, which is what a brand-new project starts in
and what this exact tutorial step happens in, there is no documented way to reopen a clip by
clicking the clip.

**Step 7 (create a variation).** Added a 3-hit 16th-note hi-hat roll and a ghost snare hit to the
existing pattern — worked cleanly, 15 hits confirmed via the document.

**Step 8 ("create a second clip slot below the first one") — the tutorial's model stops mapping
here, as the brief predicted.** `+ section` (the single most prominent, first-tried control)
converted the project to song mode and reproduced, first try, the exact footgun documented in
pilots 86 and 88: it duplicates the current section **by reference**. `GET /document`'s `scenes[]`
confirmed both resulting sections point at the identical scene id `s1`; editing either edits both.
Three different approaches were tried to give the drums track a second, independent groove:

1. **`+ insert scene`** creates a genuinely separate, empty scene (`scenes[]` gets a real new
   `{id:"s2", slots:{}}`) — but there is no GUI path to populate it for a track that already has
   content: the empty arrangement cell is a silent no-op (tried both at the scene's original
   position and after moving it to song-index-0 via the section chip's `◀` reorder button, the
   documented pilot-86 workaround for "clip actions always target index 0"); right-click produces
   no context menu anywhere; the bottom-panel clip editor only ever shows/edits whichever clip the
   track already has, with no "new clip" affordance anywhere in it.
2. Re-tested pilot 88's specific claim that clicking "update" while an empty section sits at
   song-index-0 silently wires that section to the existing shared clip too — **did not reproduce
   it** this session (`GET /document` showed the empty scene's `slots` stayed `{}` after "update").
   Flagging as a discrepancy worth re-checking (session/precondition difference, or since fixed)
   rather than asserting either pilot wrong — either way, no independent clip resulted either way.
3. **`+ capture scene` is the real answer.** Using it instead of `+ insert scene` created a new
   section whose clip labels read the new scene id *for every track*, and `GET /document` confirmed
   each track now has **two independent clip objects** with separate `hits[]` arrays, seeded as a
   copy of current content — dotbeat's actual equivalent of "duplicate the clip, place on Scene 2,
   edit the duplicate." It just isn't the button a tutorial-following beginner would try first: `+
   section`'s label is the most generic and inviting of the three near-identical "+X" buttons, and
   is the one that produces the footgun; `+ capture scene` sounds like a *performance/recording*
   action, not an *authoring* one.

**Discovering how to edit the newly-captured clip was itself non-obvious.** Clicking the new
section's clip block in the arrangement grid — again, exactly what the top hint text implies should
work — did nothing, repeatedly, for both empty and populated scenes. The only gesture that switched
the bottom panel to the new clip was clicking the **section's own name chip inside the SECTIONS
toolbar row** — visually similar to, but a functionally distinct element from, the big clip
rectangle directly below it.

**A real, reproducible data/display desync bug surfaced editing the captured clip.** After
switching to the new (16-hit) clip, four grid clicks meant to add a crash accent, a syncopated
kick, and two rimshot fill hits produced visible dots on screen, but `GET /document` showed the hit
count completely unchanged after every retry, including a slow, freshly-recalibrated single click.
**Reloading the page from scratch still showed the phantom dot and a wrong "19 hits" count** for a
clip whose real, persisted content has 16 hits — reproduced twice, once immediately after a hard
reload with zero intervening clicks. This is the same bug family prior pilots named GD-1 (rapid-
edit data loss) and the transient note-count desync pilot 88 flagged, caught here in a cleaner,
more damning form: the desync survives a full page reload.

**Playback / "switch between scenes in real time."** Hitting Play advances the transport linearly
through the song's fixed section order with a visible playhead and ticking `POSITION` counter —
dotbeat's actual answer to this tutorial concept, but a fixed linear sequence, not independent,
click-to-launch-any-row-any-time Session View (full comparison below).

### Workflow Example 2: Reverse & Transpose a Vocal Sample in Arrangement View

**Steps 1-2 (drag a sample onto an audio track, place on timeline).** Added an Audio track (`+
track` → Audio); its empty clip panel showed a genuinely well-written empty state: *"No audio clip
here yet. Drag a sample from the Browser onto this track's header (not the arrangement row) to
create one."* — directly, proactively correct, confirming pilot 88's finding without needing to
discover it the hard way. `[worked well]`

Finding real audio content required opening the Browser and scrolling to a "Kits" section
(`kit-audiophob`, 5 lanes each tagged `AUDIO`) — the genre-named preset sections above it
(Techno-kit, Boom-bap-kit, etc.) are synthesized drum-kit *presets*, not decoded audio.

Dragging the Kick sample failed silently through several attempts before succeeding: these are
native HTML5 `draggable` elements (`.lib-kit-lane`), and neither simple mouse-move-based drag
simulation nor Playwright's built-in `dragAndDrop` triggered the app's real `dragstart`/`drop`
handlers — only manually dispatched `DragEvent`s with an explicit `DataTransfer` worked. (This is a
pilot-tooling note, not a dotbeat finding — a real mouse drag in a real browser works fine, as
prior pilots document — but worth flagging for future automated pilots against this exact
component.) Along the way, dropping onto the wrong track surfaced a good, correctly-scoped toast:
*"'lead' is a synth track — drop kit samples onto a drum or audio track."* `[worked well]` Dropped
correctly onto the audio track's header, a real clip with a real waveform appeared immediately.

**Steps 3-5 (open Clip View, find and use the Transpose control).** The clip panel shows
in/out/gain(dB)/**warp** controls. `warp` defaults to `off`; its other options are `repitch` and
`complex (not yet implemented)`. Selecting `repitch` revealed a `rate` numeric field — this is
dotbeat's transpose control. Setting it to `1.5` visibly pitched the clip's label
(`kit-audiophob-kick · repitch x1.5`) and persisted correctly (confirmed via `GET /document`). This
is functionally the tutorial's "Transpose knob," but it's a **raw playback-rate multiplier that
couples pitch and speed together**, surfaced as a plain number field, not a knob labeled
"Transpose" in semitones the way the tutorial (and Ableton) describes. A beginner reading "locate
the Transpose knob" would not obviously connect that instruction to a field labeled "rate" nested
inside a dropdown labeled "warp." `[confusing]`

**Steps 6-9 (duplicate, reverse, place next to the original) — this is where the workflow breaks
down hardest of the whole pilot.**

- **No reverse action exists anywhere in the GUI.** Checked exhaustively: right-click on the clip
  (no context menu, consistent with every other pilot's finding on this); the clip properties panel
  (only in/out/gain/warp/rate, nothing pitch- or direction-related beyond that); the Device tab
  (empty for audio tracks — "AUDIO full synth surface..." boilerplate that doesn't actually apply);
  and the full Keyboard Shortcuts reference panel, whose complete text was captured and searched —
  zero occurrences of "reverse" anywhere in it. `[missing-feature]`
- **No arrangement-level duplicate exists either.** The Shortcuts panel says so explicitly, in its
  own words: *"no arrangement-level shortcuts yet — selecting a clip block and pressing Delete or
  Cmd/Ctrl+D currently does nothing (works only inside the note/hit editor above)."* `[missing-
  feature]`
- **Dragging the same sample onto the track header a second time silently overwrote the existing
  clip's edited settings instead of creating a new one.** With the track's one existing clip set to
  `warp: repitch, rate: 1.5`, re-dropping the same Kick sample onto the header reset it back to
  `warp: off, rate: 1` — destroying the transpose edit — and did **not** add any content to the
  empty target section. Confirmed via `GET /document` before and after. `[bug]`
- **`+ capture scene`, the mechanism that worked cleanly for Synth/Drums tracks in Workflow Example
  1, does not work for Audio tracks at all.** Tried from multiple starting positions — including
  with the source section (holding the only real audio clip) explicitly reordered to song-index-0
  immediately before capturing — and every capture produced a new scene whose `slots` included
  `lead` and `drums` but never `audio`. This was reproduced five times across five newly-created
  scenes (`s2` through `s6` by the end of the session), zero of which ever got an audio slot.
  `[bug]`/`[missing-feature]` (functionally, audio tracks get exactly one clip for the whole song,
  full stop, with no GUI-discoverable way to add a second).
- **A quick, unscripted test:** typing a negative `rate` (`-1`, hoping for a happy accident where
  negative playback rate = reverse) was visibly accepted on screen — the input showed `-1` and the
  clip block's own label updated to `"repitch x-1"` — but `GET /document` showed the real,
  persisted value never changed from `1.5`, and reloading the page silently reverted the display
  back to `1.5` too. This is a **third, independent reproduction of the same display/document
  desync bug family** found in Workflow Example 1's drum-grid editing (there: grid clicks and a hit
  count; here: a plain numeric input field), across two structurally different UI components —
  strong evidence this is a systemic client/daemon round-trip issue, not one widget's bug.
  `[bug]` Whether negative rate would actually reverse playback at the engine level is untested and
  unknown, since the value never persisted to check.

**Where this pilot gave up on the ideal workflow.** After exhausting every reasonable GUI avenue —
right-click, keyboard shortcuts, the clip properties panel, re-dragging, section reordering plus
recapture from multiple positions — there is no way, today, to place two independently-editable
audio clips (an original and a "reversed" variant) side by side on the same audio track in
different song sections. The tutorial's Workflow Example 2 cannot be completed end-to-end through
dotbeat's current GUI; a real user attempting it would be stuck at step 6, with no error message
explaining why, and a second lost edit (the overwritten repitch) as an unpleasant surprise on the
way there.

## Findings summary (ordered by real-user impact)

- **`[bug]`** Numeric-input and grid-click edits to a clip can display successfully on screen (new
  dots, updated labels, updated field values) while silently failing to persist to the daemon —
  reproduced three independent times across two different UI components (drum grid hit clicks in
  Workflow Example 1; the audio clip's `rate` field in Workflow Example 2), and confirmed to
  survive a full page reload in both cases. This is the same bug family prior pilots called GD-1 /
  the transient note-count desync, caught here in its most damning form yet — a user has no way to
  tell, from the screen alone, whether their edit actually saved.
- **`[bug]`** Dragging a sample onto an audio track's header when that track already has a clip
  silently **overwrites** the existing clip's edited `warp`/`rate` settings back to defaults,
  rather than either creating an independent second clip or leaving the existing one untouched.
  Confirmed via `GET /document` before/after. No warning, confirmation, or undo hint is shown.
- **`[missing-feature]`** No reverse-audio action exists anywhere in the GUI (no button, shortcut,
  or context-menu entry) — confirmed by exhaustively checking the clip panel, right-click, the
  Device tab, and the complete Keyboard Shortcuts reference text.
- **`[missing-feature]`** Audio-kind tracks cannot get a second, independent clip via any GUI path.
  `+ capture scene` — the mechanism that correctly gives Synth/Drums tracks independent per-scene
  clips — was reproduced five separate times to never include the audio track in the captured
  scene's slots, from every source-section position tried.
- **`[confusing]`** The arrangement's own hint text ("click a section's name or clip to view/edit
  its content below") describes a gesture that only works in song mode; in loop mode (a brand new
  project's default state, and where Workflow Example 1's own "reopen the clip" step happens),
  clicking or double-clicking a clip block does nothing — only clicking the track name reopens the
  editor.
- **`[confusing]`** Of the three near-identical "+X" scene-creation buttons (`+ section`, `+ insert
  scene`, `+ capture scene`), the most prominent and inviting one (`+ section`) produces the
  documented duplicate-by-reference footgun, while the one that actually gives independent,
  editable content per track (`+ capture scene`) is labeled like a performance action, not an
  authoring one — nothing in the UI explains the distinction up front.
- **`[confusing]`** After creating a new section/scene, the arrangement's clip *block* is not
  clickable to switch the bottom editor to that section's clip — only the small section-name chip
  in the SECTIONS toolbar row works, a visually similar but functionally distinct element directly
  above the block that looks like the obvious target.
- **`[confusing]`** The audio clip's transpose control is a bare "rate" playback-speed multiplier
  nested inside a "warp" mode dropdown, not a knob labeled "Transpose" in semitones — functionally
  adequate but not discoverable from the tutorial's own wording ("locate the Transpose knob").
- **`[worked well]`** Creating a Drums track collapses the tutorial's two-step "create MIDI track,
  then drag a Drum Rack onto it" into one action, with a well-designed 12-lane grid distinct from
  the Synth piano roll, plus unprompted one-click groove-variation buttons.
- **`[worked well]`** The empty-state copy for a fresh Audio track's clip panel and the
  wrong-track-kind drag toast are both proactively correct and specific ("drag onto this track's
  header, not the arrangement row"; "'lead' is a synth track — drop kit samples onto a drum or
  audio track") — exactly the kind of just-in-time guidance a tutorial-following beginner needs and
  rarely gets from real software.
- **`[worked well]`** Once understood, `+ capture scene` reliably gives every track independent,
  separately-editable clip content per scene (for Synth/Drums tracks) — the real, working
  equivalent of "duplicate the clip and edit the copy," it's just mis-signposted.
- **`[slow-to-discover]`** Native HTML5 drag targets on the Content Browser's kit-lane rows only
  respond to genuine `DragEvent`s with a `DataTransfer` payload — worth knowing for anyone writing
  future Playwright-driven pilots against this component (a pilot-tooling note, not a UX finding).

## dotbeat's scene/section model vs. Ableton's Session View

This tutorial is built entirely on Session View's mental model — independent rows (scenes) and
columns (tracks), any cell independently clickable/launchable in real time, with a song assembled
loosely by ear rather than laid out as a fixed timeline up front. dotbeat has no such thing. What it
actually has is much closer to Arrangement View with borrowed vocabulary:

**What maps cleanly:**
- A "scene" bundling one clip reference per track *is* a real, recognizable concept, and the visual
  metaphor (a named row of clip blocks) looks enough like Ableton's scene rows that a beginner
  would probably guess right at first glance.
- `+ capture scene`'s snapshot-and-duplicate behavior is a genuine, working equivalent of
  Ableton's "duplicate a scene to create a variation" — once you find it.
- Playback advancing through sections in order, with the "same scene reused across sections" being
  visually legible (same clip content shown in every section using it), reasonably captures the
  spirit of "the same groove plays wherever this scene appears."

**What does not map, and would actively mislead a beginner coming from this tutorial:**
- **There is no independent real-time launch.** A "scene" in dotbeat is not a live-performance
  trigger — it's a named slot glued into one fixed position on a linear song timeline (a
  "section"). You cannot click scene 3 while scene 1 is still playing and have it fire at the next
  bar the way Ableton's Session View does; you can only reorder sections at edit time or seek the
  playhead. The tutorial's entire "Launch Scenes" subsection (click a row's launch button, switch
  between scenes in real time while playing) has no real equivalent — this is the single biggest
  conceptual gap, and it's not a matter of a missing button so much as a genuinely different
  runtime model.
- **Sections and scenes are two different, coupled concepts that Ableton doesn't have.** A "scene"
  is the reusable bundle of clips; a "section" is one placement of a scene into the timeline with a
  bar count. Ableton has no equivalent of "the same scene placed twice" — every scene row is just
  itself. This split is powerful (it's *why* `+ section`'s duplicate-by-reference exists at all —
  it's actually the *intended* behavior for "reuse the same groove in two places," not purely a
  footgun) but it is never explained anywhere in the UI, and a beginner would have no way to guess
  that "duplicate a section" and "duplicate a scene" are different operations with very different
  consequences until they'd already been burned by one.
- **Per-track clip identity doesn't survive the way Ableton's clip slots do.** In Ableton, every
  cell in the Session View grid is its own independent clip from the start. In dotbeat, a track
  effectively carries *one* editable clip until a scene-duplication action gives it more — and for
  Audio tracks specifically, this pilot found no GUI path to more than one, ever.

**Would a beginner following this tutorial understand dotbeat's model without being told it's
different?** No. Everything about the surface — the row-of-named-clips visual, the "scene" word
itself, the "click Play and watch the playhead move through named sections" playback — reads as
close enough to Session View that a beginner would reasonably expect Session-View behaviors
(independent launch, one-clip-slot-per-cell-always) that dotbeat doesn't provide, and would hit the
gap not as an obvious "this is a different kind of view" moment but as a series of specific,
unexplained dead ends (a button that silently duplicates by reference, a hint that promises a
click gesture that doesn't work in loop mode, an audio track that can only ever hold one clip). The
model is coherent and arguably better suited to song-arrangement thinking than performance
thinking — but nothing in the product currently tells a newcomer that up front, and this tutorial
in particular sets an expectation the product does not meet.
