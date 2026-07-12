# Phase 24 plan — arrangement view usability gaps

Follows Phase 23 (`docs/phase-23-plan.md`, 11 streams — 6 build, 5 research — all merged; see
`docs/product-roadmap.md` for current status). This batch is owner-driven: ten concrete gaps found by
actually using the live GUI against a real multi-section song project
(`examples/night-shift-song.beat`), not sourced from the roadmap's own not-started rows, surfaced
across two rounds of live testing feedback. All streams are pure GUI/session-state work — none
require a format grammar change (unlike most of Phase 22/23) except CB's small `move` op addition to
the existing song-section edit primitives.

## Already fixed directly, no stream needed

- **Drums "groove" clip only played bar 1**: a real DATA bug (not code) — the clip in
  `examples/night-shift-song.beat` only captured 11 hits (bar 1 of the intended 4-bar pattern) while
  the track's own live/loop-mode content had the full 44-hit groove, apparently never
  re-snapshotted. Fixed via `beat clip examples/night-shift-song.beat drums groove`.
- **Transport bar showed "Bars 4" nonsensically on a 29-bar song**: `ui/src/components/
  TransportBar.tsx` unconditionally rendered `doc.loopBars` (a field that only means anything in
  plain loop mode) regardless of song mode. Fixed to show the real total (sum of section bars in
  song mode) with a label that says which ("Song" vs "Loop").
- **Non-4/4 time signature**: already exists, just easy to miss — `ui/src/components/
  ClipPropertiesPanel.tsx` (Phase 22 Stream AG) already exposes a per-clip signature override.
  Deliberately NOT wired into playback yet (`docs/phase-6-plan.md`'s own exclusion: "tempo changes /
  time signatures — no engine support"), so setting it today only changes stored metadata, not what
  you hear or how the grid renders. That's a real, previously-deferred engine feature, not a quick
  GUI fix — flagged to the owner rather than silently scoped into this batch.

## Streams

### CA — Resizable divider between the arrangement and the bottom pane
`ui/src/App.tsx`'s layout is `.main-area` (ArrangementView) stacked above `.bottom-pane` (the clip
editor — NoteView — and device editor — SynthPanel/InstrumentPanel/DrumLanePanel — docked together,
`data-testid="bottom-pane"`). `ui/src/styles.css`'s `.bottom-pane` is currently a fixed `height: 42vh`
(`min-height: 200px`) with no drag handle — the owner wants to drag it taller to see clip/device
content more easily.

Scope: a draggable horizontal divider between `.main-area` and `.bottom-pane`, pointer-drag to resize
(clamp to a sane min/max — don't let either pane collapse to zero), persisted as session-only UI state
(same treatment as mute/solo and group-collapse — never written to the `.beat` file, this is a view
preference not a musical fact). Smallest, most contained stream in this batch — no daemon/format
changes.

### CB — Drag a section left/right to reorder it
Today's song-section model (`doc.song: BeatSongSection[]`, `src/core/document.ts`) is a flat ORDERED
list — a section's position is implicit from cumulative `bars`, there's no explicit index/offset
field. `src/daemon/daemon.ts`'s `/song` route currently supports `append`/`resize`/`delete` ops
(`songAppend`/`songResize`/`songDelete` in `src/core/edit.ts`) — no `move`/reorder op exists yet.

Scope: add a `move` op (`songMove(doc, fromIndex, toIndex)` in `src/core/edit.ts`, splicing the
section to its new list position — same array-reorder discipline `moveEffect`/`moveLane` from Phase
22/23 already establish, produce a real `formatDiff` reporting the reorder as a musical fact, not a
delete+insert pair) plus the `/song` daemon route case and a CLI/MCP surface (`beat song-move`/
`beat_song_move`, matching `beat effect-move`'s shape). GUI: drag a section chip (or its block in the
ruler/timeline) left/right past a sibling to swap/reposition it — `ui/src/components/
ArrangementView.tsx`'s existing section-chip row (`arr-section-chip`, around the `songMode` ternary)
is the natural drag source; reuse whatever native HTML5 drag-and-drop or pointer-drag pattern
`ContentBrowser.tsx`'s library drag-payload protocol or the section-resize-handle's own pointer-drag
code already establishes in this file, don't invent a third pattern.

### CC — Make clips visible in the arrangement, then selectable/movable across tracks
Two-part stream, sequenced (part 1 is a prerequisite for part 2 — you can't meaningfully select or
drag something the user can't see the boundary of).

**Part 1 — clip visualization.** `ui/src/components/ArrangementView.tsx`'s `TrackRow`/
`trackOccurrences`/`ClipOccurrence` (see `flattenTrack`) already model "what clip plays on this
track's row, spanning which bars," but read the CURRENT rendering carefully before assuming it's
invisible — check whether occurrences already paint a boundary that's just visually weak/undiscoverable
(e.g. no border, low-contrast fill) versus genuinely not rendered at all. Either way: render each clip
occurrence as a clearly-bounded block on its track's row (start/end edges visible, a label showing the
clip's own id/name, distinguishable from a track that's simply empty during a section). Read
`docs/research/18-ableton-ui-architecture.md` for the existing Ableton-comparison research (Session
View vs Arrangement View, clip-slot model) before designing — if it doesn't already cover "how a clip
authored/looped in a live/session-style view visually appears once placed into the arrangement
timeline," treat that as this stream's own research question and answer it from first principles
against real Ableton behavior (a clip's arrangement-view block shows its own internal content
in miniature — notes/hits as small marks — not just a solid color rectangle), documented in
`docs/phase-24-stream-cc.md` before writing GUI code.

**Part 2 — cross-track selection and drag-move.** SELECTING AND MOVING CLIP OCCURRENCES across
MULTIPLE TRACK ROWS at once — analogous to Ableton's Arrangement View marquee-select-and-drag, NOT
note-level piano-roll editing inside NoteView (that already has its own per-track marquee/multi-select
and drag — this stream doesn't touch NoteView.tsx). A marquee/rubber-band drag across the arrangement's
track-row area, starting from empty space (not on an existing clip block, which should keep its own
single-clip drag behavior), selects every clip occurrence whose bar-range intersects the marquee
rectangle, across however many tracks it spans. Once a multi-clip selection exists, dragging any one
selected clip moves the WHOLE selection together, preserving each clip's relative bar offset from the
others. This is the most architecturally open part of this whole phase — expect new component state,
not just a UI tweak. Moving a clip/section content block edits which SCENE a section plays (or moves a
clip's own position if using per-clip loop/signature overrides from Phase 22 Stream AG) — read
`docs/phase-22-stream-ag.md` and the current scene/section/clip model in `format-spec.md` before
deciding the exact edit primitive a cross-track move should call.

### CD — Timeline zoom + a bar-number ruler
Two related, both about the ruler row (`.arr-ruler`/`.arr-ruler-row` in `ArrangementView.tsx`) —
build together since they touch the same rendering surface.

**Zoom**: `pxPerBar` is currently `laneWidth / totalBars` — always fit-to-container-width, no
independent zoom, feeding a `detail` boolean threshold that already switches rendering density at
`DETAIL_PX_PER_BAR`. There's no horizontal scroll today because the timeline always exactly fills its
container. Add a real zoom control (zoom in/out buttons, and/or scroll-wheel-zoom with a modifier key)
that sets `pxPerBar` independently of container width, with the timeline's horizontal scrollwrap
actually scrolling once `pxPerBar * totalBars` exceeds the visible width. Reuse the existing
`detail`/density-view threshold rather than inventing a second zoom-level concept.

**Bar numbers**: the ruler today (`arr-section-label`) shows each SECTION's scene name and bar count,
but no per-bar tick marks/numbers at all (owner: "something at the top of the arrangement view that
numbers the bars"). Add bar-number ticks along the ruler — every bar at low zoom, or every bar with
finer subdivision at high zoom once CD's own zoom control is in (reasonable to make the tick density
zoom-aware, same instinct `DETAIL_PX_PER_BAR` already uses for note/hit rendering).

Both are session-only UI state (not written to the file), same treatment as CA's pane height.

### CE — Loop only a highlighted section + click-to-seek/play-from-position
Two related transport features, both touching `ui/src/audio/engine.ts`'s `tick()`/transport logic and
the ruler's pointer-event surface — build together.

**Loop region**: today's playback loop always wraps over the FULL song (`songBars = song ?
song.reduce(...) : doc.loopBars`, `totalSteps = songBars * 16`, `step = rawStep % totalSteps`) — no
concept of looping a sub-range. The owner wants to select one (or more contiguous) section(s) and have
the transport loop just that range while auditioning/editing it, without changing the song structure
itself. This is transport/session state, NOT a format change — do not add a "loop region" field to
the `.beat` file (same "view/session state stays out of the file" discipline as mute/solo,
group-collapse, and CA/CD's session state above). Add a loop-region concept to `ui/src/state/
store.ts` (a bar range, or null = loop the whole song/doc.loopBars as today), a GUI affordance to set
it (select a section or drag a range on the ruler, then a "loop this" toggle — read
`ArrangementView.tsx`'s existing bar-range selection axis, the same one `docs/phase-13-editing.md`'s
selection protocol and `beat vary --scope selection` already use, before building a second selection
mechanism), and wire `engine.ts`'s `tick()` to wrap over the selected range instead of the full song
when a loop region is active.

**Click-to-seek**: Ableton-style — clicking a spot on the ruler jumps the playhead there (and, per the
owner's own framing, "start playing from that point" — clicking while stopped should start playback
from the clicked position, clicking while playing should just relocate the playhead without
interrupting the transport's running state). The ruler's `onPointerDown` today only starts a
bar-range SELECTION drag (`beginDrag('ruler', e)`) — add the click-without-drag case (a pointerdown/
pointerup pair with negligible movement) as a seek, distinct from the drag-to-select gesture, without
breaking the existing selection behavior.

Verify live: starting playback with a loop region set should audibly repeat only that range, not fall
through to the next section; clicking the ruler at a specific bar should make the transport's position
readout and the actually-audible content jump there immediately.

### CF — Clip view: show what notes are playing
`ui/src/components/NoteView.tsx` (the clip/note editor docked in the bottom pane) shows notes on a
pitch-row grid but — per the owner — doesn't make it easy to tell AT A GLANCE what pitches/notes are
actually present without reading positions off the keyboard strip. Add a readout (note NAMES, e.g.
"C4, E4, G4," not just numeric MIDI pitch — check whether a note-name formatter already exists
anywhere in the codebase, e.g. near the piano-roll keyboard-strip labels, before writing a new one)
for either the current selection or the whole visible clip, whichever reads more naturally given
NoteView's existing inspector-panel conventions (Phase 22/23 Streams AD/BA already added a per-note
inspector panel in this same file — this likely slots in next to it, not as a wholly separate UI
element).

### CG — Sync the clip-view playhead to actual song playback (real bug, not just a gap)
`ui/src/components/NoteView.tsx` already renders a playhead
(`currentStep >= 0 && currentStep < totalSteps && <div className="noteview-playhead" .../>`, around
line 770) — it's not missing, it's BROKEN in song mode. `totalSteps` there is computed as
`loopBars * 16` (the document's vestigial loop-mode length), but `currentStep` (read from the same
global store `ArrangementView.tsx` uses) is the ABSOLUTE song-timeline step once a real `song` array
exists — ranging over the FULL song's total steps (e.g. 464 for a 29-bar song), not just one clip's
local length. The playhead's visibility condition (`currentStep < totalSteps`) goes false almost
immediately into playback, so in song mode the line is only ever visible for a few seconds at the very
start of the whole song, never correctly tracking the clip actually being edited.

Scope: NoteView needs to (1) determine whether the clip currently open in the editor is actually the
one playing right now — does the current song section's scene map THIS track to THIS clip (same
scene/section resolution `engine.ts`'s `contentOf` already does for playback, and the same lookup
CC's clip-visualization work needs — coordinate with that stream if both land close together, they
touch overlapping logic) — and (2) if so, convert the absolute song step into a clip-relative,
tiled position using the SAME modulo logic `contentOf` already applies (`((rel % loopSteps) +
loopSteps) % loopSteps`, `rel = step - sectionStartBar * 16`) rather than comparing the raw absolute
step against the clip's own length directly. If the edited clip is NOT the one currently playing
(wrong section, or this track isn't in the current scene at all), don't render a playhead — showing
one at a nonsensical position would be worse than showing none. Verify live: start playback on a
song-mode project, open a clip in NoteView that IS part of the currently-playing section, confirm the
playhead line actually moves and wraps correctly as that clip's content tiles/repeats; switch to a
clip that ISN'T currently playing and confirm no playhead renders.

## Research stream

### RF (research/30) — How Ableton visualizes/authors clips between Session View and Arrangement View
The owner explicitly asked for this: "research more about how Ableton does this — where it has clips
that are then added into the arrangement section. Often people work on these clips while working in
the 'live view' where it's just being looped." Ground CC's clip-visualization design in real Ableton
behavior rather than guessing: how does a clip authored/looped in Session View actually render once
placed into Arrangement View (miniature note/hit content inside the block? solid color only? a
waveform for audio clips?), what visually distinguishes "this section of the timeline is playing clip
X" from an empty/silent track region, and what's the actual interaction model for dragging a clip from
the session grid into the arrangement timeline (dotbeat's own scene/section/clip model is already
close to Session View's clip-slots-per-scene concept — `docs/format-spec.md`'s v0.4 section — so this
research should also map Ableton's vocabulary onto dotbeat's existing one, not propose adopting
Ableton's mechanism wholesale). Deliverable: `docs/research/30-ableton-clip-visualization.md`,
research-only, no code — feeds directly into CC's Part 1 design, so ideally lands before or alongside
it (note in the doc if CC's own worktree has already started independently; that's fine, cross-check
after rather than blocking).

### CH — Audition a clip in isolation
A third round of live feedback surfaced this: "I put some notes down [in the clip editor]. How can I
hear it?" Confirmed by grep — there is NO clip-preview/audition mechanism anywhere in the codebase
(`previewClip`/`auditionClip`/`playClip` don't exist). Today, playback ONLY plays whatever the
current song position resolves to via `engine.ts`'s `contentOf` (song mode: the active section's
scene's clip for each track; loop mode: each track's live/non-clip content) — a clip open in
`NoteView.tsx` that isn't ALSO the one currently playing (wrong section, or not yet placed in any
scene at all) is completely inaudible, with no way to hear it while authoring.

Scope: an audition control (a "preview"/"solo this clip" play button, likely in `NoteView.tsx` near
the transport-adjacent controls already in that file) that plays the currently-open clip's content
directly — regardless of song position/current section — probably by temporarily overriding what
`contentOf` resolves for this one track while auditioning is active (or a simpler, self-contained
render/playback path scoped to just this clip's notes/hits, if that's cleaner than hijacking the main
transport's content resolution). Stop auditioning cleanly (either on its own transport-stop, or when
the user starts normal song playback). Verify live: open a clip that is NOT part of the currently
playing section, hit audition, confirm real audible output (measure via the render/analysis
infrastructure other streams' verify scripts already use, e.g. `src/core/metrics.ts`'s spectral
analysis) corresponding to that clip's own notes, not silence.

### CI — Place a clip into the arrangement for the first time (drag from the clip editor)
Distinct from Stream CC's scope — CC handles clips that ALREADY have at least one occurrence
somewhere in the song (selecting/moving existing placements); this stream is the FIRST placement of a
clip that doesn't appear in any scene/section yet. Confirmed by grep: Phase 23 Stream BC built exactly
this mechanism for AUDIO clips only (`ArrangementView.tsx`'s content-browser-drop handler on an
`audio`-kind track header, `installAudioClip` — read that code and its surrounding comment, around
"Phase 23 Stream BC" in this file, for the established pattern: reuse an existing occurrence if one
exists, else "mint a new clip and slot it into the FIRST song section's scene... refused with a clear
message in loop mode, where there's no scene to slot into yet"). Generalize the SAME mechanism to
synth/drum clips.

Scope: from `NoteView.tsx` (or wherever a clip is being authored/edited), a way to place the
currently-open clip into the arrangement — either a direct drag gesture from the clip editor onto a
track/section in the arrangement (matching the owner's own framing, "drag it into the arrangement"),
or, if a cross-window/cross-pane drag is awkward given dotbeat's single-page layout, an equally
discoverable button/action that does the same "slot this clip into a scene, placed in a section"
operation BC's pattern already establishes — read `docs/phase-24-plan.md`'s CC section and coordinate
scope in your own `docs/phase-24-stream-ci.md` write-up if there's any overlap risk (CC may also touch
this same drop-target code). Refuse clearly in loop mode (no scene exists to slot into), matching BC's
existing precedent. Verify live: author a new clip's content, place it via your new mechanism, confirm
the file's scene/section actually references it afterward and it's now part of what plays.

### CJ — Wire per-clip length (loop) override into actual playback + a drag handle to resize it
Phase 22 Stream AG already modeled `BeatClipLoop` (`clip.loop: {start, end} | null`, bars, clip-local)
and built a GUI editor for it (`ui/src/components/ClipPropertiesPanel.tsx`, numeric start/end fields)
— but per `docs/format-spec.md`'s own note, it's "modeled and round-tripped but NOT yet interpreted by
the audio engine" (confirmed by grep: `clip.loop`/`BeatClipLoop` is never referenced in
`ui/src/audio/engine.ts`). Today EVERY clip implicitly tiles/repeats at the SAME period —
`doc.loopBars` globally (see `contentOf`'s `loopSteps = loopBars * 16`) — there is no real per-clip
length independent of that document-wide field, which is why "resize a clip" has nothing to hook into
yet.

Scope: this is the deepest stream in this batch — real engine work, not just GUI. (1) Wire
`engine.ts`'s `contentOf` (and wherever else tiling is computed) to use a clip's own `clip.loop` range
when present, falling back to today's `doc.loopBars`-wide tiling when `clip.loop` is null (the
existing canonical-elision default). (2) Add a direct drag-handle affordance for resizing a clip's
length — in whichever view makes sense given where clips are visualized (`NoteView.tsx`'s own clip
canvas, and/or a clip block once Stream CC makes clip occurrences visible in the arrangement — check
if CC has landed and coordinate/reuse its rendering rather than duplicating clip-boundary UI) —
calling `setClipLoop` (`src/core/edit.ts`, already exists) rather than requiring the existing numeric
fields in `ClipPropertiesPanel.tsx`. Verify live: drag-resize a clip shorter, confirm the FILE's
`clip.loop` actually changed AND the rendered/measured audio now genuinely tiles at the new, shorter
length (not the old `doc.loopBars`-wide one) — this needs a real render+measure check, not just a
DOM/file assertion, since the whole point is proving the engine now actually reads this field.

## Process notes (carried forward from Phase 22/23)

- Dispatch RF plus CA-CG (one research, seven build) against current `main`. CA, CD, CE, and CC all
  touch `ArrangementView.tsx`'s ruler/track-row rendering and are likely to have real overlap with
  each other; CG touches `NoteView.tsx` which CF also touches. Expect cherry-pick conflicts in
  `ArrangementView.tsx`, `NoteView.tsx`, and `styles.css` across most of these — resolve using the
  established taxonomy (see Phase 22's own merge notes): mechanical concatenation for independent
  additions, careful reconstruction where a closing brace/JSX tag gets stranded by the
  conflict-marker cut.
- None of CA-CG need `scripts/roadmap-data.mjs` updates — none of them map to an existing roadmap row
  (they're owner-found usability/bug gaps, not previously-scoped roadmap features). Skip that step;
  don't invent new rows for session-only UI polish or bug fixes.
- Every build stream ships its own live verification script (Playwright-driven against the real
  daemon+GUI) proving the interaction actually works — drag the divider and measure the pane's real
  height change, drag a section and confirm the file's `song` array actually reordered, marquee-select
  across two tracks and confirm both clips moved together, zoom and confirm `pxPerBar`/scroll width
  actually changed, set a loop region and confirm playback position actually wraps early, click the
  ruler and confirm the transport position/audible content jumps, open a playing clip and confirm the
  playhead line actually tracks it.
- Every stream must `git add -A && git commit` its own work before finishing.
- Every worktree should verify its own base is current `main` (`git log -1`) before starting — if it's
  not, `git reset --hard main` in the worktree first (several Phase 22/23 streams needed this; it's
  now expected, not a surprise).
