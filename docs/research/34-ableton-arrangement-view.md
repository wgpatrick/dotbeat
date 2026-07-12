# Research 34 — Ableton Live 12 Reference Manual, Chapter 6 "Arrangement View" (pp. 150-171)

*2026-07-12. Research-only pass, one of a series mining the owner's locally-held Live 12 Reference
Manual PDF (`prior_art/`, gitignored) chapter by chapter for ideas/gaps relevant to dotbeat. No code
was written or modified.*

## How to read this doc

Same confidence convention as the other Ableton-manual passes in this series:

- **[manual p.NNN]** — a claim taken directly from the chapter text, cited by the actual PDF page
  number (chapter starts at p.150; page boundaries derived mechanically from the form-feed page
  markers embedded in the `pdftotext -layout` extract, not estimated).
- **[dotbeat]** — read directly from this repo's current source this pass (`ui/src/components/
  ArrangementView.tsx`, `src/core/document.ts`, `docs/product-roadmap.md`), cited with file:line
  where useful.

## 0. Scope, and how this relates to research 18 and 30

`docs/research/18-ableton-ui-architecture.md` covers Arrangement View at the *layout/information-
architecture* level — where it sits relative to Session View and the bottom detail pane, track
header anatomy, the mixer, racks/macros, automation's high-level shape. `docs/research/
30-ableton-clip-visualization.md` covers one narrow, deep question: what a clip's *content* actually
renders as once placed in an Arrangement block (waveform/MIDI-display miniatures, the "is this
occupied or empty" signal hierarchy), plus the Session→Arrangement clip-placement mechanism and the
live-vs-saved-clip divergence problem.

Chapter 6 of the manual is the primary source both of those passes drew their Arrangement-specific
claims from, but neither pass had reason to work through the chapter's own remaining territory:
**locators, time-signature markers, the loop brace's exact interaction model, clip fades/crossfades,
the full selection/editing-grid mechanics, the arrangement-wide "…Time" commands, splitting/
consolidating clips, and linked-track (comping) editing.** That's this doc's job — the parts of
Chapter 6 that are load-bearing for dotbeat's own editing-mechanics roadmap (automation lanes,
tempo/time-signature changes, selection, zoom/scroll) but haven't been mined yet. Where a topic
already has a home in 18 or 30, this doc cross-references rather than re-deriving it.

## 1. Layout — the parts of §6.1 not already covered

Research 18 already established the big-picture "one window, no Session View" framing and the
inline-vs-dedicated-mixer split. Worth adding from the chapter's own walkthrough of the Arrangement
View's furniture [manual p.150-152]:

- **The Overview strip** is a distinct navigation surface from the beat-time ruler: drag horizontally
  to scroll, drag *vertically* to zoom, and **double-click anywhere inside the black outline to zoom
  out to the full Arrangement** [manual p.150]. dotbeat has no Overview-strip analog at all — no
  minimap of the whole arrangement with a draggable viewport outline.
- **Two rulers, two purposes**: the beat-time ruler (bars-beats-sixteenths, drag-to-scroll/drag-to-
  zoom, double-click zooms to the current selection or reverts to the full Arrangement if nothing's
  selected) sits above the tracks; a *second*, independent time ruler in **minutes-seconds-
  milliseconds** sits below the track list and only scrolls, never zooms independently [manual
  p.151, p.152]. dotbeat has one ruler (bars only); a wall-clock-time ruler is a plausible small
  addition but not urgent — bars-and-beats is the more agent/composer-relevant unit for this product.
- **Adding a track by dropping a device** [manual p.152]: dragging an instrument/MIDI effect into the
  Mixer Drop Area beneath the tracks *creates* a MIDI track; dropping an audio effect creates an audio
  track. This is the browser-as-track-creation idiom research 18 §8 already flagged as worth adopting
  for presets/samples — the chapter confirms it's also literally how new tracks get born in Ableton,
  not just how existing tracks get populated.
- **Optimize Height / Optimize Width toggles (H / W)** [manual p.152] fit all tracks to the current
  view height/width. Distinct from per-track manual resize (§6.9 below).
- **Waveform Vertical Zoom Level** [manual p.152] is a single slider that scales *all* audio tracks'
  waveform display height at once (including new recordings) — a display-only zoom, independent of
  clip gain. No dotbeat analog; low priority (dotbeat's audio-region waveform rendering is already a
  static min/max-per-pixel render per the roadmap's audio-clip-editing rows, not an interactively
  resizable one).

## 2. Navigation and Zooming (§6.2) [manual p.153]

- **Progressive zoom**: `+`/`-` keys, or mouse-wheel/trackpad scroll while holding Ctrl(Win)/Cmd(Mac),
  zoom in/out *around the current selection*. `Ctrl+Alt`(Win)/`Cmd+Option`(Mac)+drag pans without
  zooming.
- **`Z` zooms in to completely fill the view with the current time selection; `X` reverts** —
  explicitly a **multi-step undo stack for zoom**, not a single toggle: "when zooming in multiple
  times using the Z key, the X key can be pressed multiple times to go back one step each time."
- **Selecting time inside a clip zooms the Clip View editor to that same range** — the bottom pane's
  zoom follows the Arrangement selection, not an independent state.
- **Vertical (per-track) zoom**: scroll a track's main lane with `Alt`(Win)/`Option`(Mac) held. If a
  time selection spans multiple tracks, *all tracks with selected content* zoom vertically together.
- **Follow**: a switch in the Control Bar (also `Options` menu) that auto-scrolls the Arrangement to
  track the playhead. It **pauses** on any edit, any manual horizontal scroll, or a click on the
  beat-time ruler, and **resumes** when playback stops/restarts or you click back in the Arrangement
  or clip scrub area. This is a precisely specified state machine, not just "always scroll while
  playing" — the pause conditions are what make it usable while editing during playback.

## 3. Transport and Playback (§6.3) [manual pp.153-155]

- **Play/Stop** via Control Bar buttons or spacebar; both are MIDI/key-mappable [manual p.153-154].
- **The insert marker is a distinct concept from the live playhead**: a flashing blue marker that
  determines *where playback will start next*, independent of where the transport currently is or
  last stopped. Clicking anywhere in a track moves it; `Home`(Win)/`Fn+←`(Mac) or double-clicking
  Stop returns it to the Arrangement start [manual p.154].
- **`Shift`+spacebar resumes from wherever playback last stopped, ignoring the insert marker**
  [manual p.154] — a second, distinct "resume" behavior alongside the marker-based one.
- **The Arrangement Position fields** (bars-beats-sixteenths, Control Bar) are a third way to set
  playback position — drag, type+Enter, or arrow keys — and **adjusting them moves the insert
  marker**, i.e. all three surfaces (click-in-track, Position fields, marker itself) write the same
  single piece of state [manual p.154].
- **The scrub area** (above the tracks, "Permanent Scrub Areas" on by default) launches playback from
  a click point; jumps between click points are **quantized to the Control Bar's Quantization Menu
  value**; holding the mouse down loops a repeated portion at the **global launch quantization**
  value. Even with Permanent Scrub Areas off, `Shift`-click anywhere in the scrub area or beat-time
  ruler still scrubs [manual p.154-155].
- **Chase MIDI Notes** (on by default, toggleable in the Options menu): if playback starts partway
  through a held note, Live "chases" it so the note still sounds rather than being silently skipped
  [manual p.155].

## 4. Locators (§6.4) [manual pp.155-157]

This is the chapter's most under-mined section for dotbeat's purposes, because research 18 correctly
ruled out *Session-View* clip-launch machinery as irrelevant to dotbeat — but locators are not a
Session-only concept. They are described entirely within the Arrangement View chapter, as
Arrangement-native objects:

- Added to the scrub area via the **Set Locator** button (becomes **Delete Locator** once a locator
  is selected), the scrub area's context menu, or the Create menu. If added via the button while
  transport is stopped, the locator lands at the insert marker or the start of the current time
  selection; during playback/recording it's added live, quantized to the global launch quantization
  [manual p.156].
- **Navigation**: click a locator, or use the Previous/Next Locator buttons — quantized jumps like
  the scrub area. Past the first/last locator, Previous/Next instead jump to the Arrangement
  start/end [manual p.156-157].
- **Editing**: drag or arrow-key to move a selected locator; `Ctrl+R`(Win)/`Cmd+R`(Mac) or the Edit
  menu to rename; a separate "Edit Info Text" for free-text notes; Delete key or the Delete Locator
  button to remove [manual p.157].
- **`Loop to Next Locator`** (a locator's context menu) is a one-click way to loop playback between
  two adjacent locators — the loop-brace equivalent of "audition just this section" scoped to
  locator pairs rather than song sections.
- **`Set Song Start Time Here`** overrides the default "playback starts at the current selection"
  rule so that playback instead always starts from a specific locator [manual p.157].

**What locators actually are, functionally**: named, arbitrarily-positioned, individually
navigable/loopable rehearsal marks, decoupled from any structural (clip/section) boundary — you can
drop one mid-clip to mark "the drop," "vocal entrance," or a mix-review checkpoint, independent of
where clips or sections happen to begin and end.

## 5. Time Signature Changes (§6.5) [manual pp.157-159]

- Added via **Insert Time Signature Change** (Create menu or scrub-area context menu) at the current
  insert-marker position, or by typing directly into the Control Bar's Numerator/Denominator fields
  — which changes the time signature **at the current play location**, working either stopped or
  during playback [manual p.157-158].
- **Value constraints**: numerator is 1-2 digits, denominator restricted to `{1, 2, 4, 8, 16}`;
  numbers can be separated by slash, comma, period, or spaces [manual p.157].
- **A visible signal for "this Set has meter changes at all"**: the Control Bar's time-signature
  fields show a small automation-LED indicator once any marker exists in the Set, and the marker row
  itself (just below the beat-time ruler) is **hidden entirely** if there are no meter changes
  [manual p.158].
- **Markers are not quantized** — placeable anywhere the editing grid allows, including positions
  that don't land on a clean barline. This deliberately creates a **fragmentary bar**, rendered as a
  **crosshatched region** in the scrub area — Live leaves it as-is by default, but a context menu
  offers two named "correcting" operations [manual p.158]:
  - **Delete Fragmentary Bar Time** — removes exactly the fragment's duration, sliding everything
    after it earlier so the next marker lands on a clean barline.
  - **Complete Fragmentary Bar** — inserts time to *pad out* the fragment into a full bar instead,
    also realigning the next marker.
  - **Both operations affect every track** — they change the Arrangement's total length, not just
    the track the marker's on [manual p.159].
- **MIDI import**: importing a MIDI file offers to import its embedded time-signature data, which
  Live turns directly into markers in the correct places [manual p.159].

## 6. The Arrangement Loop (§6.6) [manual pp.159-161]

- Toggled via the Control Bar; with nothing selected the loop brace defaults to covering the *entire*
  Arrangement. **Loop Start** and **Loop Length** fields set it numerically [manual p.159].
- **`Loop Selection`** (`Ctrl+L`/`Cmd+L`) sets the loop brace to the current time selection; the same
  shortcut also just toggles the loop on/off when a clip or time selection exists [manual p.160].
- **The loop brace has a fully worked keyboard-adjustment vocabulary**, distinct nudge vs. resize
  semantics [manual p.161]:
  - `←`/`→` — nudge the whole brace by the current grid setting.
  - `↑`/`↓` — shift it by **its own current length** (not the grid) — i.e. jump a whole loop-length
    at a time.
  - `Ctrl`/`Cmd` + `←`/`→` — shorten/lengthen by the grid setting.
  - `Ctrl`/`Cmd` + `↑`/`↓` — **double or halve the loop length** outright.
  - Dragging: an edge adjusts start/end; the bar body moves the whole brace without resizing.
- **`Set Song Start Time Here`** (loop-brace context menu) forces playback to always start from the
  loop brace's own start point, overriding the default insert-marker/selection rule — the same
  override mechanism locators offer (§4), applied to the loop brace instead.

## 7. Moving, Resizing, Fading, and Splitting Clips (§§6.7-6.8, 6.12) [manual pp.160-166]

- **Only the clip's title bar is draggable** — not the waveform or MIDI display directly; those are
  reserved for content-relative gestures [manual p.161-162].
- **Clips snap to the editing grid *and* to other objects**: other clips' edges, locators, and
  time-signature markers all act as snap targets [manual p.162].
- **`Ctrl+Shift`(Win)/`Shift+Option`(Mac)+drag on the waveform/MIDI display slides the clip's
  *contents* within its fixed boundaries** — distinct from moving the clip itself. `Ctrl+Alt+Shift`/
  `Cmd+Option+Shift` bypasses grid snap for that same content-slide gesture [manual p.162].
- **Fades and crossfades** [manual pp.162-165]: fade handles live at clip edges, visible on hover
  (only if the track is tall enough — small/folded tracks hide them). **Fade In Start**/**Fade Out
  End** handles set fade *duration* without moving the fade's peak; a separate **Fade Curve** handle
  shapes the curve. `Ctrl+Alt+F`/`Cmd+Option+F` (**Create Fade In/Out**) creates a fade from a time
  selection that includes a clip's start/end. Adjacent clips crossfade the same way (drag a fade
  handle over the neighbor's edge, or **Create Crossfade** on a selection spanning the boundary).
  Two hard constraints, worth keeping if dotbeat ever builds this: **fades cannot cross a clip's own
  loop boundary**, and **a clip's start and end fades cannot overlap each other**. A **"Create Fades
  on Clip Edges" setting** (Record, Warp & Launch Settings) changes Delete's behavior on a fade
  handle from "remove the fade" to "reset it to a default 4ms fade" (explicitly framed as pop/click
  prevention), and — as a side effect — makes adjacent clips auto-crossfade at 4ms by default,
  still hand-editable afterward. **Fades are a property of the clip, independent of both the track
  and any automation envelope** [manual p.164].
- **Splitting** (§6.12, `Ctrl+E`/`Cmd+E`) divides a clip at a click point, or carves out a dragged
  sub-range into its own new clip — works uniformly on **both** audio and MIDI clips, producing two
  independently-editable clips with their own edges [manual p.166].

## 8. Selecting Clips and Time (§6.9) [manual pp.164-165]

- Ableton's own framing: "Arrangement editing is selection-based: you select something and then
  execute a command." Clicking a clip selects it; clicking the *background* selects a **time point**
  (the same flashing insert marker from §6.3) — movable with `←`/`→`, switchable across tracks with
  `↑`/`↓`, and `Ctrl`(Win)/`Option`(Mac)+`←`/`→` **snaps the insert marker to locators and clip
  edges** in the selected track(s) [manual p.164].
- **Track unfolding is required to select/edit time *within* a clip**: the unfold button (or `U` on
  a selected track) expands a track to reveal its waveform/MIDI content for direct in-clip selection.
  Unfolded height is adjustable by dragging the split line, or `Alt`/`Option` `+`/`-`; `Alt`/`Option`
  while resizing *one* track resizes *all* of them; `Alt+U`/`Option+U` unfolds every track at once
  [manual p.164].
- **`0` deactivates a material selection** (even a multi-clip one) — or, if a *track header* is
  selected instead, deactivates that track [manual p.165].
- **Reverse Clip(s)** (`R`, or context menu) reverses a selection of **audio** material, including
  across multiple clips at once — explicitly **not possible for MIDI clips** [manual p.165].
- **Nudge a selection** of material (not just the insert marker) with `←`/`→` [manual p.165].

## 9. The Editing Grid (§6.10) [manual p.165]

- Snap targets are meter-subdivision gridlines; grid can be **zoom-adaptive or fixed**, set via
  context menu in either the Arrangement track lanes or the MIDI Note Editor (one shared setting
  surface, not two independent grids).
- A fully specified five-shortcut vocabulary: `Ctrl/Cmd+1` narrows (doubles density), `Ctrl/Cmd+2`
  widens (halves density), `Ctrl/Cmd+3` toggles triplets, `Ctrl/Cmd+4` toggles snap on/off entirely,
  `Ctrl/Cmd+5` toggles fixed vs. adaptive mode. Current spacing is displayed live above the time
  ruler's lower-right corner. `Alt`(Win)/`Cmd`(Mac) held during a drag bypasses snap (or temporarily
  *enables* it if the grid is currently off).

## 10. The "…Time" Commands (§6.11) [manual p.166]

The chapter draws an explicit distinction Ableton itself names: ordinary **Cut/Copy/Paste/Duplicate**
act only on the current selection (in place); their "**…Time**" counterparts act on **every track
simultaneously** by literally inserting or deleting time from the Arrangement's timeline — and any
time-signature markers inside the affected region move/are affected too.

- **Cut Time** — removes the selected span, pulling every track's later content closer, shortening
  the whole Arrangement.
- **Paste Time** — inserts previously-copied time, lengthening the Arrangement.
- **Duplicate Time** — inserts a copy of the current selection's span, lengthening the Arrangement.
- **Delete Time** — same effect as Cut Time without putting anything on the clipboard.
- **Insert Silence** — inserts a chosen amount of *empty* time starting at the insert marker.

## 11. Consolidating Clips (§6.13) [manual p.167]

**Combines several adjacent clips — on one track, or across multiple tracks at once — into a single
new clip** (`Ctrl+J`/`Cmd+J`). Framed explicitly as a way to turn "a set of clips that sound good in
Arrangement Loop mode" into one clean loop. The resulting clip behaves like any other afterward
(movable; a consolidated MIDI clip's edges can be dragged to create more repetitions).

For **audio** clips specifically, Consolidate renders a genuinely new sample per track — captured
from the **time-warping engine's output, prior to the track's effects chain and mixer**. So it bakes
in in-clip attenuation, warping, pitch-shift, and clip envelopes, but explicitly **not** track
effects; a *post*-effects render requires the separate Export Audio/Video command instead.
Consolidated samples land under the Set's own Project folder, `Samples/Processed/Consolidate` (or
the Temporary Folder if the Set hasn't been saved yet).

## 12. Linked-Track Editing (§6.14) [manual pp.167-170]

A mechanism for **comping and other phase-locked multi-track editing**: select tracks (including
within a Group Track) and use **Link Tracks** to bind them. Linked tracks show a link indicator in
their header; hovering it highlights every track in that instance, clicking selects them all. A
project can have multiple independent linked-track *instances*, but a track belongs to at most one.
Once linked, a long list of operations applies to **every linked track simultaneously**: moving/
resizing clips, selecting clips/time, the §6.11 "…Time" commands, splitting/consolidating, creating/
editing fades (only fades starting at the *same* time position adjust together), arming/disarming,
and take-lane management (rename/insert/delete/Audition Mode — even when take lanes are hidden on
some of the linked tracks) [manual p.167-170].

## 13. The Mixer in Arrangement View (§6.15) [manual pp.170-171]

Confirms, from the chapter's own final section, exactly what research 18 already concluded from the
Mixing chapter: **the dedicated Mixer and the inline Arrangement Track Controls are two views over
the same underlying values**, not two data models — editing either one edits the same track state.
The one asymmetry: a short list of controls exists **only** in the dedicated Mixer — Performance
Impact indicators, per-track delay, and the crossfader [manual p.171].

---

# Relevance to dotbeat

Grounded against `ui/src/components/ArrangementView.tsx`, `src/core/document.ts`, `src/core/edit.ts`,
and `docs/product-roadmap.md` (current as of this pass). Ordered roughly by cost-to-value.

### 1. Follow (auto-scroll during playback) — missing entirely, cheap, high value

A repo-wide check confirms dotbeat's Arrangement view has **no Follow toggle and no auto-scroll
during playback at all** — `ArrangementView.tsx` has zoom state (`zoomPxPerBar`, Phase 24 Stream CD)
and a live playhead, but nothing that scrolls the viewport to keep the playhead visible while
playing. Ableton's precise state machine [manual p.153] — auto-scroll while playing, **pause** on
edit/manual-scroll/ruler-click, **resume** on stop/restart or a click back in the Arrangement — is
directly reusable and non-trivial to get wrong (a naive "always scroll to playhead" would fight the
user mid-edit). Concretely: a boolean in the same store as `loopRegion`
(`ui/src/state/store.ts`), read by the existing playhead-position effect, gated by the same kinds of
interaction the pause conditions name. Recommend as a new roadmap row under "Arrangement / song
structure."

### 2. Zoom-to-selection (`Z`/`X`) — the plumbing already exists, the shortcut doesn't

`ArrangementView.tsx` already has `zoomIn`/`zoomOut`/`zoomFit`, `MIN_PX_PER_BAR`/`MAX_PX_PER_BAR`
clamps, and Cmd/Ctrl+scroll pointer-anchored zoom (Phase 24 Stream CD) — but no one-key "fill the
viewport with exactly the current bar-range selection" action, and no zoom-history stack for `X` to
revert through [manual p.153]. Since `selection.bars` already exists as a first-class selection axis
(the D2 selection-as-shared-context work), this is a small, well-scoped addition: compute the
`pxPerBar` that makes `selection.bars` span the container width, push the prior `zoomPxPerBar` onto a
small stack before applying it, and bind `Z`/`X`. Cheap, and closes a real muscle-memory gap for
Ableton users (research 18 §10 already flagged `Z`/`X` as a key worth matching).

### 3. Locators — a real Arrangement-native concept research 18 didn't rule out, but likely still out of scope

Research 18 (§1, "Confirmed Session-only, do NOT port") ruled out clip-launch triangles, scenes,
Follow Actions, and launch quantization as Session-specific. **Locators are not on that list, and
this chapter confirms why**: they're described entirely within the Arrangement chapter (§4 above),
as named marks droppable anywhere independent of clip/section boundaries, with their own
navigation (Previous/Next Locator), rename, and "loop between two locators" affordances. dotbeat's
closest existing analog is a named **song section** (`BeatSongSection`) plus the Phase 24 Stream CE
per-section "loop this section" toggle — but that's coarser than a locator in two ways: sections are
structural (they *are* the arrangement's bars, with their own scene content), while a locator is a
free-floating point marker that can sit *inside* a section (e.g., "the drop," "second verse start,"
a mix-review checkpoint) without implying any content boundary. **Recommendation: don't build full
locator machinery** (quantized-launch jumping, MIDI/key-mapping) — that reintroduces the
performance-surface territory research 18 correctly scoped out, and dotbeat has no use for
quantization since there's no live-launch use case. **A much smaller subset is worth flagging as a
low-priority nice-to-have** if section-level granularity ever feels too coarse during editing: a
plain named point + "jump playhead here" (reusing the existing click-to-seek machinery from Phase 24
Stream CE), no launch quantization, no MIDI mapping. Not urgent; not currently on the roadmap; fine
to leave there.

### 4. Time-signature *markers* are still a real gap, and the chapter sharpens exactly what "done" should look like

`src/core/document.ts`'s `BeatTimeSignature` is explicitly **clip-local metadata only** — its own
doc comment states "the playback engine is still constant-tempo 4/4 only... modeled and round-tripped
but NOT yet interpreted by the audio engine." There is no document-level time-signature *marker*
concept at all (nothing like Ableton's Insert Time Signature Change, no marker list, no fragmentary-
bar handling) — dotbeat currently has zero mechanism for meter to actually change anywhere in a song,
even as unenforced metadata beyond a single clip's display field. Worth being precise about this
against `ROADMAP.md` §8's M3 exit-criteria line, which lists "tempo/time-sig changes" as done
alongside "arbitrary length arrangement" — the arbitrary-length and named-section parts are real and
shipped; the time-signature-*changes* part is not actually implemented in the engine, only modeled as
inert per-clip metadata. When this gets picked up for real, §5's design is directly portable to
dotbeat's format style:

- A literal, canonically-ordered marker line (Csound/Humdrum-style, matching how `point` lines work
  for automation) — something like `timesig <bar> <num>/<denom>`, one per line, sorted by bar
  position — rather than an indirection layer.
- **Deliberately allow "impossible" placements** (a marker that doesn't land on a clean barline)
  rather than forbidding them, exactly as Ableton does — but dotbeat's own two named recovery
  operations (delete-the-fragment vs. complete-the-fragment) would need to be **whole-document edits
  that shift every track**, which is new territory: today's `edit.ts` primitives are scoped to one
  track or one clip; an operation that reflows every track's bar-relative content is closer in shape
  to the still-missing "…Time" commands (item 8 below) than to anything that exists today.
- A visible indicator (mirroring the automation-LED-on-the-BPM-field idea) the moment a doc has more
  than one marker, so a track/clip that assumes constant meter has a signal something unusual is
  going on.

### 5. Tempo changes over time — a distinct, deeper gap this chapter doesn't itself cover

Worth separating cleanly from item 4: `bpm` in `src/core/document.ts:741` is a single global integer
scalar, with no ramp, no per-bar marker, not even inert metadata the way `BeatTimeSignature` is. This
chapter doesn't actually describe Ableton's tempo-automation mechanics (that lives in the automation
chapter, not this one), so this is flagged honestly as *adjacent*, not *sourced from Chapter 6* — but
it's worth noting dotbeat already has the right machinery shape for it if this is ever prioritized:
the existing `auto`/`point` lane grammar (v0.9, already used for synth params) is a natural fit for
tempo-as-an-automatable-target, the same way research 18 §7 already flagged "practically all mixer
and device controls, including song tempo" as automatable in Ableton. Not actionable from this
chapter alone; noted for whoever eventually scopes it, so it isn't quietly conflated with item 4's
time-signature-marker gap (the two look similar but have separate root causes and separate fixes).

### 6. Split is audio-only; Ableton's Split is clip-kind-agnostic

`docs/product-roadmap.md`'s "Split-at-point" row is explicitly `splitAudioClip` — audio-region clips
only. Chapter 6.12 [manual p.166] describes Split as working identically on **both** audio and MIDI
clips via one command. dotbeat has no equivalent for a saved `BeatClip` on a synth/drum track — the
existing Pitch & Time operations rewrite note/hit *content* in place, but none of them split a clip's
own topology (bar range, `BeatClipLoop`, per-clip automation points) into two independent clips the
way `splitAudioClip` already does for audio. Recommend a `splitClip` primitive generalizing
`splitAudioClip`'s existing pattern (trim the first clip's bar range, mint a second clip with an
adjusted start, partition any clip-scoped automation points by time — same shape `splitAudioClip`
already uses for gain automation) for synth/drum `BeatClip`s. A real, scoped API asymmetry worth its
own roadmap row.

### 7. "Consolidate" already means something different in dotbeat — a naming collision worth flagging now

dotbeat already ships a feature called **Consolidate**, exposed as a button in the note editor's
Pitch & Time panel (`src/core/pitchtime.ts`'s `consolidateRatchets`, research 22 §3.3) — it bakes a
note's ratchet/repeat pattern into discrete individual notes. Ableton's **Consolidate** (§6.13
[manual p.167]) is an unrelated, arrangement-level operation: combining **several adjacent song
clips** (per track, or across tracks) into one new saved clip. These are two genuinely different
operations that happen to share a name dotbeat borrowed first. Two concrete recommendations:

- **Rename dotbeat's existing ratchet-baking action** in any future user-facing copy (e.g. "Bake
  Ratchets") before an actual arrangement-level Consolidate is ever built, to avoid two same-named,
  unrelated commands in the same product.
- **The real Ableton-style Consolidate is a genuinely useful, currently-unbuilt feature**, and it
  pairs naturally with a gap research 30 §4 already flagged: dotbeat's live-vs-saved-clip divergence
  problem (editing a track's live content while a saved clip is what actually plays, with no GUI
  affordance to re-sync). An arrangement-level Consolidate — "select N adjacent section occurrences
  on a track and fold them into one new saved `BeatClip`" — is close in spirit to that re-sync
  affordance research 30 recommended, and the primitives it would need (`saveClip`, `setScene`) both
  already exist per `src/core/edit.ts`. Worth scoping as its own small roadmap row rather than
  reinventing research 30's recommendation from scratch.

### 8. No arrangement-wide "…Time" commands (Cut/Paste/Duplicate/Delete Time, Insert Silence)

dotbeat has nothing matching §6.11 [manual p.166]: an operation that inserts or removes a bar range
**across every track simultaneously**, independent of section boundaries. The existing "Section CRUD
+ loop→song conversion" and "Drag the rightmost loop boundary" roadmap rows cover *whole-section*
resize/insert/delete, and that's a meaningfully different, coarser operation than "insert 2 bars in
the middle of section B, shifting every track's content after that point" — which today has no
primitive at all. Recommend an `insertTime`/`deleteTime` pair, scoped to `doc.song`, shifting every
affected track's clip occurrences and any in-range automation points. Natural to sequence right after
item 6 (clip-splitting) lands, since both need the same "does this bar boundary fall inside an
existing clip, and if so, how do we cut it cleanly" logic.

### 9. Fades/crossfades — already a known roadmap gap; this chapter is the concrete spec to build against

`docs/product-roadmap.md` already lists "Region-level fade in/out handles" as Not Started, with a
sketch (two normalized 0..1 fields per region). Chapter 6.8 [manual pp.162-165] supplies the concrete
acceptance criteria worth carrying into that work directly rather than re-deriving: fades can't cross
a clip's own loop boundary; a clip's start and end fades can't overlap each other; and a sensible
zero-config default — auto-apply a short (Ableton uses 4ms) fade at clip edges and at adjacent-clip
boundaries by default, editable afterward — matches dotbeat's own existing taste for small, evocative
defaults (the same posture the tape-emulation-knobs roadmap row already takes). Worth linking this
research doc from that roadmap row when it's picked up.

### 10. Insert marker vs. live playhead, and "resume from last stop" — small, low-priority polish

dotbeat's click-to-seek (Phase 24 Stream CE) already conflates "click while stopped starts playback
there" and "click while playing relocates," which covers most of what §6.3's insert-marker/Position-
fields machinery does. The one piece missing is `Shift`+space's distinct "resume from wherever
playback last stopped" behavior [manual p.154], independent of the current selection or marker
position — cheap if ever prioritized, low value on its own; mentioned for completeness rather than as
an actionable recommendation.

### 11. No per-track height / unfold / Optimize Height-Width — distinct from the existing "Fold mode" roadmap row

`ROW_H` in `ArrangementView.tsx:115` is a single fixed constant (56px) applied uniformly to every
track row — there is no per-track vertical resize, no "unfold to see more detail" affordance, and no
Optimize-Height/Optimize-Width equivalent [manual p.152, p.164]. **This is a different feature from
the "Fold mode" row already in `docs/product-roadmap.md`** (piano-roll pitch folding — collapsing the
*note editor* to only the pitches in use) — don't conflate the two when scoping. Ableton's version is
about track *header* height in the Arrangement timeline itself, used to reveal per-track detail
(waveform, automation lanes) that a compressed row hides. Given dotbeat's canvas-rendered rows already
carry real content (note/hit density, clip blocks per research 30), a taller row could show more
detail (e.g. a bigger waveform, more legible note marks) the same way Ableton's unfold does — worth a
small future roadmap row, lower priority than items 1-2 above since it's a display refinement rather
than a missing editing capability.

## Sources

Ableton Live 12 Reference Manual, Chapter 6 "Arrangement View," pp. 150-171 (owner-provided PDF,
`prior_art/`, not tracked in git). Page citations derived mechanically from the chapter's own
embedded page-footer markers in the `pdftotext -layout` extraction, not estimated.
