# Research 53 — Ableton Live 12 vs. dotbeat: Arrangement View feature/UI comparison

*2026-07-12. A direct, structured comparison — not a re-derivation of research 34/18/30, which cover
the manual's Arrangement-View content in depth; this doc cross-references them and adds the piece
they didn't do: a side-by-side feature table plus prioritized build recommendations. Grounded in the
manual's own screenshots (viewed directly, not just its extracted text) and a full read of dotbeat's
one arrangement surface, `ui/src/components/ArrangementView.tsx` (2,506 lines).*

**Citation convention**: `[manual p.NNN]` — Ableton Live 12 Reference Manual, Chapter 6
"Arrangement View," pp.150-171 (owner's local PDF, `prior_art/`, not tracked in git; page numbers from
the chapter's own embedded footers). `[dotbeat file:line]` — read directly from this repo this pass.

## How to read this comparison

dotbeat's arrangement is built on a **structurally different data model** than Ableton's, and a lot
of what follows traces back to that one difference, so it's worth stating up front rather than
re-discovering it item by item:

- **Ableton**: every clip on every track is an independently-positioned, independently-lengthed
  object. Two tracks' clips have no relationship to each other beyond sharing a timeline.
- **dotbeat**: the arrangement is a flat, ordered list of **sections** (`BeatSongSection { scene,
  bars }` — [`src/core/document.ts:567-570`]), each pointing at a **scene** (`BeatDocument.scenes`,
  matched by `scene.id`) that maps every track to (at most) one clip. A scene can legally be reused by
  more than one section — [`src/core/edit.ts:1001`]'s `setSong` only checks the referenced scene
  exists, not that it's unique — which is how a loop-mode groove becomes a full song's verse/chorus
  structure without re-authoring content per repeat. The consequence: a "clip" in dotbeat's arrangement
  is always exactly as long as the section it's slotted into (tiled/looped to fill it —
  [`ArrangementView.tsx:381-393`]'s `tileOffsets`), and resizing is a **section-wide** operation
  (every track in that scene grows or shrinks together — [`ArrangementView.tsx:59-80`]'s
  `previewResizeSections`), not a per-clip drag on one track's one region. This explains why several
  Ableton per-clip operations (independent resize, independent split, ordinary copy/paste) don't have
  a 1:1 dotbeat equivalent yet — the model has genuine holes there, tracked honestly below — while also
  explaining why dotbeat needed inventions Ableton never had to build (the overlap-resolution policy,
  §1c below).

## 1. Feature & UI/UX comparison

### a) Shared features / parity

- **Inline per-track header controls** — color swatch, inline rename, mute/solo, volume/pan, active
  sends. Ableton calls this **Arrangement Track Controls**, user-customizable via the View menu
  [manual p.152 item 10, p.170-171 §6.15]; dotbeat's `InlineStrip` renders a fixed (non-configurable)
  subset — mute/solo/volume/pan/send-badges — directly in every track header
  [`ArrangementView.tsx:181-242`, header markup `:762-816`]. Functionally equivalent; Ableton's is
  user-configurable, dotbeat's isn't (not flagged as a gap — a fixed, always-visible strip is a
  reasonable simplification for a smaller control surface).
- **Timeline zoom in/out/fit-to-view, pointer-anchored Cmd/Ctrl+scroll-wheel zoom** — Ableton's
  progressive `+`/`-` and Ctrl/Cmd+scroll, zooming around the current selection [manual p.153 §6.2];
  dotbeat's `zoomIn`/`zoomOut`/`zoomFit` toolbar buttons plus `onWheelZoom`, anchored to the pointer
  position under the cursor [`ArrangementView.tsx:1644-1674`, Phase 24 Stream CD]. Real parity, though
  see §1b for the piece Ableton has that dotbeat doesn't (zoom-to-*selection* as a one-key action with
  a zoom-history stack).
- **Numbered bar-time ruler with zoom-adaptive tick density** — Ableton's beat-time ruler
  (bars-beats-sixteenths) [manual p.150-151]; dotbeat's ruler draws numbered bar ticks whose interval
  halves/doubles with zoom level via `tickIntervalFor` [`ArrangementView.tsx:136-145, 2354-2370`].
- **Selection-based editing model**: click a clip/block to select it, click empty space to select a
  point (and seek), drag to select a time range. Ableton's own framing: "Arrangement editing is
  selection-based: you select something and then execute a command" [manual p.164 §6.9]; dotbeat's
  `beginDrag`/click-to-seek effect implements the same three-way split (drag → bar-range selection,
  click → seek, clip-block click → select-and-drag-move) [`ArrangementView.tsx:1546-1625,
  1723-1786`].
- **Drag a clip to move it** — Ableton: only the clip's title bar is draggable, snaps to grid and to
  other clips'/locators' edges [manual p.161-162 §6.7]; dotbeat: `beginClipDrag` drags one or many
  selected clip-occurrence blocks at once, snapping to the nearest **section** boundary (not an
  arbitrary bar, per the model note above) [`ArrangementView.tsx:1576-1625`]. Same gesture, coarser
  grid (section-snapped, not bar-snapped) — a direct consequence of the data-model difference, not an
  oversight.
- **Resize by dragging an edge handle** — Ableton drags one clip's independent edge [manual p.161];
  dotbeat drags a **section's** right-edge handle, resizing every track in that scene together
  [`ArrangementView.tsx:1630-1638`]. Parity of *gesture*, not of *scope* — flagged here rather than
  claimed as identical.
- **Automation Mode toggle** shows/hides per-track automation lanes — Ableton's toggle in the upper
  area [manual p.151 item 7]; dotbeat's per-track "A" button in the header opens/closes that track's
  automation-lane stack [`ArrangementView.tsx` `AutomationPicker`/`AutomationLane`, toggle at
  `~2443-2451`].
- **Drop content onto an existing track populates it** — Ableton drags a device/sample onto a track
  [implied throughout the manual, and explicit for track *creation*, manual p.152 item 12]; dotbeat's
  `handleLibraryDrop` accepts a preset/kit-sample/soundfont dropped on a track header and installs it
  through the same daemon routes the sidebar browser uses [`ArrangementView.tsx:556-599`]. Parity for
  populating an *existing* track; see §1b for the piece missing (drop-to-*create*-a-track).
- **Cross-track, multi-object selection driving edits together** — Ableton's marquee/Shift-click
  selection spanning multiple clips and tracks [manual p.164-165 §6.9]; dotbeat's marquee-select of
  clip-occurrence blocks across track rows, with a group drag-move that preserves relative offsets
  [`ArrangementView.tsx:1318-1341`, Phase 24 Stream CC]. See §1c for a safety mechanism dotbeat had to
  add here that Ableton's model doesn't need.

### b) In Ableton, not in dotbeat

Grounded in the manual's chapter 6 walkthrough and a full read of `ArrangementView.tsx`; every item
below was checked directly against the current source (not inferred from the roadmap alone) — several
were confirmed genuinely absent via targeted greps, not just "not mentioned in the roadmap."

1. **Follow (auto-scroll during playback)** — Ableton's Control Bar switch auto-scrolls the
   Arrangement to the playhead, with a precise pause/resume state machine: pauses on any edit, manual
   scroll, or ruler click; resumes on stop/restart or a click back in the Arrangement/scrub area
   [manual p.153 §6.2]. dotbeat has a live playhead div (`showPlayhead`/`playheadLeft`,
   [`ArrangementView.tsx:2011-2012`]) but nothing scrolls the viewport to follow it — confirmed via
   research 34's repo-wide check.
2. **Zoom-to-selection (`Z`/`X`) with a zoom-history stack** — one key fills the viewport with exactly
   the current bar-range selection; a second key reverts, repeatably, through prior zoom levels
   [manual p.153 §6.2]. dotbeat's `zoomPxPerBar` state already has everything *except* this specific
   action and a history stack [`ArrangementView.tsx:1297, 1644-1650`].
3. **Overview strip (minimap) + secondary wall-clock ruler** — a whole-arrangement thumbnail with a
   draggable viewport rectangle, distinct from the beat-time ruler [manual p.150 item 1]; plus an
   independent minutes-seconds-milliseconds ruler below the track list [manual p.151 item 2, p.152
   item 15]. Confirmed absent from dotbeat by direct search (`grep -i minimap|overview` across
   `ui/src`, zero hits) — there's zoom+scroll, but no whole-song thumbnail and no wall-clock time axis
   at all (bars-only).
4. **Reorder tracks by dragging** — "tracks can be reordered by selecting and dragging them above or
   below other tracks" [manual p.152 item 11]. Confirmed absent: `edit.ts` has reorder primitives for
   effect chains (`moveEffect`), drum lanes (`moveLane`), and song sections (`songMove`) but none for
   `doc.tracks` order, and `ArrangementView.tsx`'s only drag-reorder implementation is for section
   chips, not track headers.
5. **Drag-to-create a track** from the content browser — dropping an instrument/MIDI device creates a
   MIDI track, an audio effect creates an audio track [manual p.152 item 12]. dotbeat requires the
   explicit "+ track" toolbar button first; dropping content only *populates* an existing track
   (§1a above).
6. **Locators** — named, freely-positioned rehearsal marks in the scrub area, independent of any
   clip/section boundary, with their own Previous/Next navigation, rename, and "loop between two
   locators" [manual pp.155-157 §6.4]. dotbeat's closest analog (a named song section) is structural,
   not a free-floating point marker — confirmed no marker concept exists anywhere in the document
   model.
7. **Time-signature markers, engine-interpreted** — `Insert Time Signature Change`, placeable anywhere
   (including "impossible," off-barline positions, which create a *fragmentary bar* — a crosshatched
   region with two named recovery operations, Delete Fragmentary Bar Time / Complete Fragmentary Bar,
   both reflowing every track) [manual pp.157-159 §6.5]. dotbeat's `BeatTimeSignature` is explicitly
   **clip-local metadata only** — its own doc comment states the playback engine is "still
   constant-tempo 4/4 only... modeled and round-tripped but NOT yet interpreted"
   [`document.ts:469-479`]. Worth flagging precisely: `ROADMAP.md` §8's M3 exit criteria lists
   "tempo/time-sig changes" as done — the arbitrary-length/named-section part is real, the
   meter-*changes* part is not actually implemented.
8. **Tempo changes over time** — not itself described in chapter 6 (it lives in the automation
   chapter), but a distinct, deeper gap worth naming next to item 7 since they look similar and aren't:
   dotbeat's `bpm` is a single global scalar with no ramp or marker at all
   [`document.ts:741`].
9. **A real keyboard-shortcut & editing-grid vocabulary at the arrangement level** — Ableton specifies
   an extensive, precise set: spacebar play/stop [manual p.153-154 §6.3], `Ctrl/Cmd+E` split
   [p.166 §6.12], `Ctrl/Cmd+J` consolidate [p.167 §6.13], `R` reverse [p.165 §6.9], `0` deselect
   [p.165], arrow-key nudge of a selection [p.165], and a 5-shortcut editing-grid vocabulary
   (`Ctrl/Cmd+1`…`+5` for narrow/widen/triplet/snap-toggle/fixed-vs-adaptive) with snap-to-locators
   and snap-to-clip-edges [manual p.165 §6.10]. Confirmed by direct search: `ArrangementView.tsx` has
   **no** global keydown listener at all (only local `Enter`/`Escape` inside rename inputs); the only
   real keyboard layer in the whole UI lives in `NoteView.tsx` (`Cmd/Ctrl+A`, Delete, arrow-key
   nudge/resize) and `App.tsx` (`Shift+Tab` for the bottom pane). Play/stop today is a button-only
   affordance with no spacebar binding — a real, basic gap.
10. **Ordinary Cut/Copy/Paste/Duplicate of a clip/time selection** (distinct from item 12's
    arrangement-wide "…Time" commands) — Ableton's baseline selection-scoped editing verbs [manual
    p.164 §6.9, p.166 §6.11]. Confirmed absent: no `duplicateClip`/`copyClip`/`pasteClip`/`cutClip`
    primitive exists anywhere in `src/core/edit.ts`, `document.ts`, or `daemon.ts` — the only thing
    resembling "duplicate" is the "+ section" button, which duplicates a whole section's content, not
    an arbitrary clip/time selection.
11. **Split works on both audio and MIDI clips** via one uniform command, `Ctrl/Cmd+E` [manual p.166
    §6.12]. dotbeat's only split primitive, `splitAudioClip` [`edit.ts:1271`], is audio-region-only —
    there's no equivalent for a `BeatClip` on a synth/drum track (research 34 §6 already flagged this
    precisely).
12. **Arrangement-wide "…Time" commands**: Cut Time / Paste Time / Duplicate Time / Delete Time /
    Insert Silence — insert-or-remove-a-bar-range operations that shift **every track** simultaneously,
    reflowing any time-signature markers inside the affected span too [manual p.166 §6.11]. No dotbeat
    equivalent at any grain finer than a whole section (`postSong`'s append/resize/delete/move ops,
    [`ArrangementView.tsx:86-103`]).
13. **Audio clip fades and crossfades** — Fade In Start/Fade Out End duration handles plus a Fade Curve
    shape handle, hard constraints (a fade can't cross a clip's own loop boundary; start/end fades on
    one clip can't overlap each other), and an auto-4ms-fade-on-edges default [manual pp.162-165
    §6.8]. Confirmed: no `fadeIn`/`fadeOut`/`crossfade` field exists anywhere on `BeatAudioRegion`
    [`document.ts:517-525`, six fields: `media, in, out, gainDb, warp, rate, markers`] — this is
    already an explicit, unbuilt roadmap row ("Region-level fade in/out handles") with a sketch; the
    chapter supplies the concrete acceptance criteria to build against.
14. **Reverse Clip(s)** (`R`) reverses a selection of audio material, including across multiple clips
    at once — explicitly not possible for MIDI [manual p.165 §6.9]. Confirmed absent for audio: the
    only "reverse" in the codebase is `reverseNotes` [`pitchtime.ts:186`], which reverses note/hit
    *positions* on a track, not audio-buffer samples — no audio-buffer reversal exists anywhere in
    `ui/src/audio`.
15. **Content-slide-within-fixed-boundary drag** — `Ctrl+Shift`/`Shift+Option`+drag on a clip's
    waveform/MIDI display slides its *contents* within fixed clip edges, distinct from moving the clip
    itself [manual p.162 §6.7]. dotbeat's `AudioClipInspector` only exposes `in`/`out` as plain numeric
    fields [`ArrangementView.tsx:1238-1268`] — no drag gesture on the waveform at all yet (a known,
    already-documented Stream AE gap this predates).
16. **"Consolidate" name collision** — Ableton's `Consolidate` (`Ctrl/Cmd+J`) combines several adjacent
    clips, per track or across tracks, into one new saved clip [manual p.167 §6.13]. dotbeat already
    ships a **differently-scoped** feature under the same name: the note editor's Pitch & Time panel
    button that bakes a note's ratchet/repeat pattern into discrete notes (`consolidateRatchets`,
    `pitchtime.ts`, research 22 §3.3). Two unrelated operations, one borrowed name — worth fixing
    before the real Ableton-style Consolidate is ever built.
17. **Consolidating clips is a real, unbuilt Ableton feature on its own merits** — turning "a loop that
    sounds good" into one clean saved clip, per track or across tracks [manual p.167 §6.13], pairing
    naturally with research 30's already-flagged live-vs-saved-clip divergence problem.
18. **Per-track height / unfold, plus Optimize Height/Width** — manual resize of a track's row to
    reveal more waveform/MIDI detail, `H`/`W` shortcuts to fit all tracks to the view
    [manual p.152 item 13, p.164 §6.9]. `ROW_H` in dotbeat is a single fixed 56px constant applied to
    every row [`ArrangementView.tsx:115`] — no per-track resize exists (distinct from the *piano-roll*
    "Fold mode" row already in `docs/product-roadmap.md`, which is a different feature entirely —
    don't conflate the two when scoping).
19. **Linked-track editing (comping)** — bind tracks so moving/resizing/splitting/fading one applies to
    every linked track simultaneously, built for multi-take audio comping [manual pp.167-170 §6.14].
    No dotbeat equivalent, and no dotbeat use case yet either — comping is already correctly gated
    behind the M4 native-recording engine (`docs/product-roadmap.md`'s "Multi-take comping,
    freeze/flatten/bounce" row, `⬜ Not started`, pointing at `docs/m4-native-engine-design.md`).
20. **Dedicated-mixer-only controls: crossfader, per-track delay** — the manual's own final section
    names exactly two controls that exist *only* in Ableton's separate Mixer panel, not inline in
    Arrangement Track Controls [manual p.171 §6.15]. Confirmed absent from `MixerView.tsx` and
    repo-wide (`grep -i crossfad|delay.compensation`, zero hits in any `src/`/`ui/src` code file) —
    dotbeat has neither concept anywhere.
21. **Waveform Vertical Zoom Level** — a slider scaling every audio track's waveform display height at
    once, applying to new recordings too [manual p.152 item 14]. No dotbeat equivalent; dotbeat's
    waveform render is a deliberately static min/max-per-pixel image (`ui/src/audio/waveform.ts`), not
    an interactively resizable one.

### c) In dotbeat, not in Ableton

- **Every arrangement edit is a legible, git-diffable text change** — section resize, clip move, group
  create, automation-point drag: all of it round-trips through `.beat`'s canonical text serialization,
  producing a one-or-few-line diff a human (or an agent) can read directly, not a gzipped-XML blob
  needing external tooling (`alsdiff`, `maxdiff`) to make sense of. This is dotbeat's entire premise
  (`ROADMAP.md` §1's landscape table; `decisions.md` D4/D7/D15) and it's true of literally every
  primitive this file calls (`postEdit`, `postSong`, `postGroupOp`, `postClipMove`,
  `postAutomation`).
- **CLI + MCP drivability of the whole arrangement surface** — `beat song`, the section-move/resize/
  delete ops this component's `postSong` wraps, group create/rename, clip moves: every one of them is
  also a CLI verb and an MCP tool, so an agent edits the *document* directly rather than puppeting a
  live GUI over a socket (`decisions.md` D14/D15). Ableton's MCP ecosystem (`ableton-mcp` et al.,
  `ROADMAP.md` §1) works the opposite way round.
- **git-backed checkpoint/history/pin/restore, GUI-integrated** — append-only local history, named pins
  as immutable git tags, a real restore-verified GUI panel (`docs/product-roadmap.md`'s "Versioning /
  history" row, `decisions.md` D10). Ableton has no native project-history browser; version control is
  entirely bring-your-own.
- **The vary/audition loop, wired into the arrangement's own selection protocol** — `beat vary --scope
  selection` generates audible parameter variants scoped to whatever's currently selected in this exact
  view (the D2 selection-as-shared-context work), auditions them live, and commits or discards —
  generative variation tooling with no Ableton Arrangement-View analog.
- **Density-LOD canvas rendering** — below a px/bar threshold, a track row collapses to
  opacity-encoded density blocks (one per bar, alpha ∝ event count); above it, real note/hit ticks
  render [`ArrangementView.tsx:119-120` `DETAIL_PX_PER_BAR`/`DENSITY_REF`, render logic `:698-714`].
  Ableton always shows literal waveform/MIDI-content miniatures regardless of zoom (research 30) —
  dotbeat's LOD strategy is a genuinely different (and, for a dense, zoomed-out canvas-rendered
  timeline, cheaper) rendering approach, not a copy of Ableton's.
- **Cross-track batch clip-move with automatic private-scene cloning** — moving a multi-track selection
  clones a private per-section scene when the source section's scene is *shared* with untouched
  siblings, so a move never silently bleeds into content it shouldn't touch
  [`ArrangementView.tsx` `beginClipDrag`, `:1576-1625`; `docs/product-roadmap.md`'s "Visualize clips…
  cross-track select/move" row]. This is a safety mechanism dotbeat's own scene-reuse model *forced it
  to invent* — Ableton's independently-positioned clips never create this hazard in the first place, so
  it has no equivalent to build.
- **Overlap-resolution policy as a live, user-selectable preference** (`clip` / `push-existing` /
  `keep-existing`) for what happens when a section resize would grow into its neighbor
  [`ArrangementView.tsx:43-79`, `docs/product-roadmap.md`'s row]. Again: a direct, necessary response
  to the section-list model's own structure, not a feature Ableton's independent-clip model needs.

## 2. Prioritized recommendations

| Feature | Priority | Build recommendation |
|---|---|---|
| Follow (auto-scroll during playback) | **P1** | Add `followEnabled: boolean` next to `loopRegion` in `ui/src/state/store.ts`; read it in the playhead-position effect in `ArrangementView.tsx` (near `showPlayhead`/`playheadLeft`, `:2011-2012`) and scroll `scrollRef.current` to keep the playhead in view. Pause on `beginDrag`/`beginResize`/any `postEdit`/`postSong` call; resume on transport stop/restart or a ruler click — mirrors the exact state machine in [manual p.153]. |
| Zoom-to-selection (`Z`/`X`) + zoom-history stack | **P1** | Extend the existing `zoomIn`/`zoomOut`/`zoomFit` trio (`ArrangementView.tsx:1644-1650`) with a `zoomToSelection()` that computes `pxPerBar` from `selection.bars` and `laneWidth`, and a small array-backed undo stack in local component state, pushed before each zoom change. Bind `Z`/`X` in the new keydown listener recommended below (item 9). |
| Overview strip (minimap) + secondary wall-clock ruler | **P2** | New `OverviewStrip.tsx`: a fixed-width scaled rendering of `sections`/`totalBars` above `.arr-ruler-row`, with a draggable viewport rectangle bound to `scrollRef.current.scrollLeft`/`zoomPxPerBar`. Wall-clock ruler: a second `<div>` under the bar ruler computing bar→seconds from `doc.bpm`, scroll-only (no independent zoom, matching Ableton). Lower priority than items above — zoom+scroll already covers most of the real need. |
| Reorder tracks by dragging | **P1** | New `moveTrack(doc, fromIndex, toIndex)` in `src/core/edit.ts`, same shape as `songMove` (`edit.ts:1014`) but operating on `doc.tracks`. Wire a `postTrackMove` daemon route + CLI verb/MCP tool for parity with every other reorder primitive in this codebase. GUI: a drag handle on `.arr-track-header`, reusing the native-HTML5-DnD pattern the section chips already use (`ArrangementView.tsx:2130-2148`). |
| Drag-to-create-track from content-browser drop | **P2** | Extend `handleLibraryDrop`'s pattern (`ArrangementView.tsx:556-599`) to a persistent drop target below the last track row; on drop, infer kind from payload type (instrument/soundfont → `instrument`, kit-lane → `drums`, preset → its declared kind) and call `addTrackOfKind` (`ArrangementView.tsx:1835-1865`) before installing the dropped content. |
| Locators (lightweight point-marker subset) | **P2** | Do **not** build the full Session-launch-quantization machinery research 34 already ruled out — just a plain named point + jump. New `BeatMarker { id, name, bar }[]` on `BeatDocument`, a thin row below the ruler (reusing the tick-row idiom at `ArrangementView.tsx:2354-2370`), click-to-seek via the existing `engine.seek` call (`:1754`). `beat marker add/rm/list` CLI + MCP tools for parity. |
| Time-signature markers (engine-interpreted mid-song meter changes) | **P2** | Needs a document-level marker list (today `BeatTimeSignature` is clip-local-only, `document.ts:469-479`) plus real interpretation in `ui/src/audio/engine.ts`'s scheduler, plus the two fragmentary-bar "reflow every track" recovery operations [manual pp.157-159]. Sequence together with the "…Time" commands below — both need the same "does this bar boundary fall inside an existing clip" primitive. Correct the M3 exit-criteria overclaim in `ROADMAP.md` §8 once this actually lands. |
| Tempo changes over time (tempo ramp/automation) | **P2** | Separate root cause from the item above — `doc.bpm` (`document.ts:741`) is a bare scalar. Natural fit: reuse the existing `BeatAutomationLane`/`point` grammar with `bpm` as an automatable target, read by `engine.ts`'s tempo path. Not blocked on the time-signature-marker work; sequence independently. |
| Arrangement-level keyboard-shortcut & editing-grid vocabulary | **P1** | New keydown listener scoped to `ArrangementView`, same idiom `NoteView.tsx:559-629` already uses (guard against focus in inputs). Minimum viable set: spacebar (play/stop via `engine`), `0` (clear `selectedOcc`/`selection`), arrow-key nudge of the selected bar range, `Ctrl/Cmd+E` (split, item below), `Ctrl/Cmd+J` (consolidate). Editing-grid subdivision/triplet/snap-to-object vocabulary is a larger, separable follow-on — today clip-drag only snaps to whole sections (`nearestSectionIndex`, `ArrangementView.tsx:339-350`), with no sub-bar grid concept at all. |
| Clip Cut/Copy/Paste/Duplicate (ordinary, selection-scoped) | **P1** | New `duplicateClip`/`copyClipToClipboard`/`pasteClip` primitives in `src/core/edit.ts` alongside `saveClip` (`:964`)/`setScene` (`:984`); clipboard state lives in the daemon or the GUI store (not the file — it's ephemeral). Bind `Cmd/Ctrl+C`/`+V`/`+D` in the new keydown listener above. Given the section-shared-scene model (§0), scope this to "duplicate/copy this clip's *content* into a new clip, slotted into a chosen section" rather than pretending it's an arbitrary free-floating region move. |
| Split generalized to synth/drum clips | **P1** | New `splitClip` in `src/core/edit.ts`, generalizing `splitAudioClip`'s existing pattern (`:1271`) for `BeatClip`s on synth/drum tracks — trim the first clip's bar range, mint a second with an adjusted start, partition any clip-scoped automation points by time (same shape `splitAudioClip` already uses for gain automation). Research 34 §6 already scoped this precisely. |
| Arrangement-wide "…Time" commands (Cut/Paste/Duplicate/Delete Time, Insert Silence) | **P2** | New `insertTime`/`deleteTime` primitives in `src/core/edit.ts`, scoped to `doc.song`, shifting every affected track's clip occurrences and in-range automation points. Bigger lift than the items above — sequence right after `splitClip` lands, since both need the same "does this bar boundary fall inside an existing clip" logic. |
| Region fades / crossfades | **P1** | Two normalized 0..1 fields (`fadeIn`, `fadeOut`) on `BeatAudioRegion` (`document.ts:517-525`); drag handles rendered on `AudioClipInspector`'s existing waveform canvas (`ArrangementView.tsx:1189-1271`, reusing `drawWaveform`); engine-side linear gain ramp in the region player. Enforce the two hard constraints from [manual pp.162-165]: a fade can't cross the clip's own loop boundary, and start/end fades on one clip can't overlap. Already an explicit `⬜ Not started` roadmap row with a sketch — this chapter supplies the acceptance criteria, promoted to P1 since the rest of audio-region editing is otherwise mature and this is the visible remaining gap. |
| Reverse audio clip | **P2** | New `reverseAudioClip` in `src/core/edit.ts` (a clip-level flag, mirroring `reverseNotes`'s pattern at `pitchtime.ts:186` but for the referenced audio buffer, not note positions) plus actual buffer-reversal support in `ui/src/audio/waveform.ts`/`engine.ts`'s `Tone.Player` playback path. |
| Content-slide-within-fixed-boundary drag | **P2** | A drag gesture on `AudioClipInspector`'s waveform canvas (`ArrangementView.tsx:1230-1237`) that shifts `in`/`out` together (same window width, different offset into the source media). Sequence after basic drag-to-trim lands (already a known Stream AE gap predating this doc) — this is a refinement on top of that, not a substitute for it. |
| Consolidate — naming collision fix | **P0** | Rename the note editor's ratchet-baking button (currently "Consolidate" in the Pitch & Time panel, `pitchtime.ts`'s `consolidateRatchets`) to something like "Bake Ratchets" in any user-facing copy. Copy-only change, essentially free — do this before the real Ableton-style Consolidate (next row) is ever built, to avoid two same-named, unrelated commands shipping in the same product. |
| Consolidate — real arrangement-level multi-clip fold | **P2** | New `consolidateClips` primitive in `src/core/edit.ts`, built on the existing `saveClip` (`:964`)/`setScene` (`:984`) pair: fold N adjacent section occurrences on one or more tracks into one new saved `BeatClip`. Pairs naturally with research 30's already-flagged live-vs-saved-clip divergence problem — worth scoping together. |
| Per-track height / unfold + Optimize Height/Width | **P2** | A per-track `rowHeight` map in local `ArrangementView` state (same shape as `zoomPxPerBar`); a drag handle on `.arr-track-header`'s bottom edge; `ROW_H` (`ArrangementView.tsx:115`) becomes a per-row lookup read by `TrackRow`'s canvas-sizing effect (`:601-730`) instead of a flat constant. Distinct from the existing "Fold mode" roadmap row (piano-roll pitch folding) — don't conflate when scoping. |
| Linked-track editing / comping | **Do-not-recreate** (for now) | No dotbeat use case exists without native multi-take recording. Correctly already gated behind `docs/m4-native-engine-design.md`'s butler-thread disk-streaming work via the existing "Multi-take comping, freeze/flatten/bounce" roadmap row — don't build this ahead of that. |
| Dedicated-mixer-only controls (crossfader, per-track delay) | **Do-not-recreate** | Crossfader is a Session-View DJ-style performance concept with no fit in dotbeat's non-performance, agent/producer-focused arrangement-only product. Per-track delay compensation matters for multi-mic'd recording dotbeat doesn't do yet — revisit only if/when M4 native recording ships, not before. |
| Waveform Vertical Zoom Level slider | **Do-not-recreate** | dotbeat's waveform render is deliberately a static min/max-per-pixel image (`ui/src/audio/waveform.ts`), not an interactively resizable one — adding this would mean changing that rendering model for a display-only convenience of low value relative to the items above. |

## Sources

Ableton Live 12 Reference Manual, Chapter 6 "Arrangement View," pp.150-171 (owner-provided PDF,
`prior_art/`, not tracked in git) — text read via `docs/research/34-ableton-arrangement-view.md`'s
extraction, and 20 of the chapter's own page images viewed directly this pass (pp.150-153, 155-156,
158-159, 161-162, 164-165, 167, 169-170) to verify UI layout/controls the text alone doesn't fully
convey. `ui/src/components/ArrangementView.tsx` (full 2,506-line read), `src/core/document.ts`,
`src/core/edit.ts`, `ui/src/state/store.ts`, `ui/src/components/NoteView.tsx`,
`ui/src/components/MixerView.tsx`, `ROADMAP.md`, `docs/decisions.md`, `docs/product-roadmap.md` — all
read directly this pass. Cross-referenced (not re-derived): `docs/research/34-ableton-arrangement-view.md`,
`docs/research/18-ableton-ui-architecture.md`, `docs/research/30-ableton-clip-visualization.md`.
