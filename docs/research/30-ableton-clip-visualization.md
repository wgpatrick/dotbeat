# Research 30 — how Ableton visualizes/authors clips between Session View and Arrangement View

*2026-07-11. Owner-commissioned research stream (RF) for Phase 24 (`docs/phase-24-plan.md`), feeding
Stream CC's clip-visualization GUI work. The owner's own framing, verbatim: "I'd like you to be able
to see the clips in the arrangement view... It should be clear where these clips begin and end in the
arrangement view... often people work on these clips while working in the 'live view' where it's just
being looped." This is research-only — no code was written or modified.*

## How to read this doc

Same confidence tagging as `docs/research/18-ableton-ui-architecture.md`, which this doc extends
rather than duplicates:

- **[manual]** — confirmed from the official Ableton Live 12 Reference Manual (fetched this pass;
  URLs in Sources).
- **[general]** — well-established Ableton behavior, corroborated across multiple independent
  secondary sources (Ableton's own forum, tutorial sites, MusicRadar/Soundfly/Sound on Sound) but not
  pinned to a single manual sentence — either because the manual describes the mechanism only in
  passing, or because the manual's own screenshots (not machine-readable through a text fetch) are
  the real source of truth for pixel-level detail. Treat as lower-confidence than [manual]; worth a
  five-second live-Ableton confirm before it drives an irreversible pixel decision, but solid enough
  to design against.
- **[dotbeat]** — read directly from this repo's current source this pass (`git log -1`:
  `ab2acba`, current `main`), not researched — cited with exact file:line so Stream CC can jump
  straight to the code.

## 0. What research 18 already covers, and the real gap this doc fills

`docs/research/18-ableton-ui-architecture.md` §1 already nails the big-picture framing dotbeat needed
for Phase 18's layout redesign: Session View and Arrangement View are "two representations of the
same set," Arrangement is "dotbeat's target," and clip-launch/scene-launch/Follow-Actions are
Session-only and explicitly out of scope. §2 ("Arrangement View anatomy") states clips "sit in track
lanes at fixed song positions" and are "dragged to reposition... edge-dragged to resize," but it does
**not** answer the specific question this stream was commissioned to answer: **what does a clip's
own internal content actually look like once it's rendered inside its Arrangement-View block?**
Research 18 was written for a layout/information-architecture redesign and correctly scoped that
question out; this doc answers it, from first principles against real Ableton behavior, for the
narrower purpose of Stream CC's per-clip rendering.

## 1. How a clip's content renders once placed in Arrangement View

**Not a solid color block. Both clip kinds render a schematic miniature of their own content, live,
inside the block — this is a real, named surface in Ableton's own manual, not a inferred/guessed
detail.**

- **Audio clips show a waveform.** [manual] The Reference Manual's own clip-view section discusses
  "fade handles" positioned against "the clip's waveform" directly on the Arrangement clip (not only
  inside the zoomed Sample Editor) — the waveform is the block's own content, not something you have
  to open Clip View to see. [general, corroborated across multiple Ableton-forum threads on
  clip-splitting/selection] the amplitude trace fills the block's height, scales with zoom, and is
  drawn at whatever fidelity the current zoom level affords (a coarse min/max envelope when zoomed
  out across a whole song, filling in detail as you zoom toward sample-level).
- **MIDI clips show a note preview**, and — this is the specific fact worth pinning down — the
  manual's own vocabulary treats this as a first-class rendering distinct from "waveform": clip
  editing/selection behavior is described as operating "in the clip's waveform **or MIDI display**"
  [manual, phrasing appears verbatim across both the clip-splitting and clip-selection sections of
  the Reference Manual] — i.e. Ableton names a MIDI clip's in-block rendering "the MIDI display" as
  a parallel concept to the waveform, not an absence of one.
- **What the MIDI display actually shows** [general — well-established from direct product
  familiarity and consistent across tutorial/forum descriptions, not pinned to one manual sentence]:
  small horizontal marks, one per note, positioned **vertically by relative pitch within that clip's
  own used pitch range** (schematic, not against a fixed absolute keyboard reference — a clip using
  only a one-octave range fills the block's height the same as a four-octave clip would) and
  **horizontally by start time and duration**, scaled to the block's width at the current zoom.
  Density is genuinely proportional to what's inside — a sparse 4-note clip and a busy 64-note
  arpeggio read as visually different at a glance, which is the entire point (visual density as
  content, not decoration). It is **not** velocity-shaded or colored per-note in the compact
  Arrangement block (velocity nuance is reserved for the zoomed Clip View's own velocity sub-lane,
  §4 of research 18) — the Arrangement block is a coarse "where and roughly what" preview, not a full
  editor. Marks are typically rendered in a shade of the clip/track's own color (or a near-white/
  light tint against the colored block background), not a separate palette.
- **Drum-rack clips**: same MIDI-display mechanism, but since a Drum Rack clip's "pitch" axis is
  really a fixed pad/lane list rather than a continuous keyboard, the note marks read as short
  horizontal bands stacked by pad rather than a freely-varying pitch curve — visually busier/more
  "striped" than a melodic clip, which (per research 18 §4) is exactly the same shape dotbeat's own
  fixed five-lane drum model already produces.
- **At low zoom** (many bars visible, block only a few pixels wide) [general], the manual and
  forum threads agree the block-level detail degrades gracefully rather than disappearing — the
  waveform becomes a coarse envelope, the note marks become an undifferentiated denser/lighter
  smear, but the block never silently reverts to a flat, contentless rectangle; density-as-color
  remains legible even when individual note positions aren't. **This is the exact same design
  problem dotbeat's `ArrangementView.tsx` already solved independently** — see §5.

**Bottom line for the "solid color or literal preview" question the plan asked**: it is a **real,
schematic, live preview of the actual note/hit data**, not a solid color placeholder, but it is also
**not** literally-to-scale against a fixed reference (no absolute pitch axis, no velocity color) —
it's a compact, density-legible miniature, closer to a sparkline than to a shrunk full piano roll.

## 2. What distinguishes "this section has content" from "this track is empty/silent"

Three independent visual signals stack, and the combination is what makes an empty region
unambiguous at a glance [manual + general]:

1. **Presence vs. absence of the block itself.** A clip occupies its own bounded rectangle with a
   visible top/bottom border and a background fill (its track/clip color); the track lane's own
   background (uncolored, usually a flat neutral) shows through everywhere a clip isn't. There is no
   ambiguity between "quiet content" and "no content" at the block level — a near-silent clip (one
   quiet note) still gets the full colored block; true silence gets no block at all.
2. **The name label.** Every clip block carries its own name (and, per research 18 §9, usually
   inherits its track's color) rendered as text in the block's corner/header — so even at a glance
   you're reading "verse-a" sitting there, not inferring it from position alone.
3. **The internal density preview itself** (§1) — a genuinely empty MIDI clip (a clip block that
   exists but currently has zero notes — rare but possible, e.g. right after `Ctrl+E`/split creates
   an empty region) still renders as a bounded, named, colored block with a blank interior, visually
   distinct from *both* a populated clip *and* true empty timeline (no block, no color, no name).

So the real signal hierarchy is **block boundary + color + name first, internal content density
second** — a user identifies "there is something here" from the bounded/colored/named block before
they read what's inside it, and only the content preview answers "and here's roughly what."

## 3. The interaction model for getting a clip from Session grid into the Arrangement timeline

Four real, distinct mechanisms [general, corroborated across the Ableton forum and multiple
independent tutorial sites — MusicRadar, Soundfly, Sound on Sound — describing the same four paths
consistently]:

1. **Direct drag with a view-switch mid-drag**: click-and-hold a Session clip (or a multi-selection),
   press `Tab` while still holding to flip the main area to Arrangement View without releasing the
   drag, then drop it at the desired track/bar position. The one mechanism that puts one specific,
   already-authored clip at one specific chosen position.
2. **"Record Session into Arrangement"** [manual, session-view]: with Arrangement's Cycle mode off,
   Shift+click Record — Live waits for the first clip trigger, then records every subsequent
   scene/clip launch as it's performed live into Arrangement regions. This is a *performance capture*
   — the resulting Arrangement content is exactly whatever sequence of clips you actually triggered,
   whenever you triggered them, not a placement decision made in Arrangement itself.
3. **Drag onto the view-selector button** ("Session"/"Arrangement" tab) as a drop target/portal — a
   quick way to send a clip to the other view without a Tab mid-drag.
4. **Copy/paste** — right-click copy a Session clip, paste at the playhead/selected position in
   Arrangement.

**Mapping onto dotbeat's own mechanism** — dotbeat is already structurally close to the *destination*
shape (a `BeatScene` mapping `trackId -> clipId`, exactly Ableton's clip-slot-per-scene concept; a
`BeatSongSection { scene, bars }` list, exactly Ableton's linear placement of "which scene plays for
how long"), but the **path that populates a scene's slots** is genuinely narrower than any of
Ableton's four:

- **What dotbeat has today** [dotbeat]: `saveClip` (`src/core/edit.ts:964`) snapshots one track's
  *current live content* (`track.notes`/`track.hits`) into a named `BeatClip`; `setScene`
  (`src/core/edit.ts:984`) sets a scene's whole `trackId -> clipId` slot map (own CLI verb, `beat
  scene <file> <scene-id> [<track>=<clip>...]`, `cli/beat.mjs:873`, and the bundled `beat_song` MCP
  tool, `src/mcp/server.ts:850`, which can call `saveClip`+`setScene`+`setSong` in one request). The
  one *automatic* insertion path is `sceneFromLiveContent` (`src/daemon/daemon.ts:200`), invoked by
  `songAppend` the first time a project goes from loop mode to song mode: it snapshots **every**
  track's live content into one new scene in a single shot, then slots it as the first section. This
  is dotbeat's closest analog to Ableton's mechanism 2 above ("capture what's live right now into the
  timeline") — coarser (one all-tracks snapshot event, not a continuous multi-trigger performance
  recording) but the same underlying idea: *the timeline's first content comes from whatever was
  playing live, captured once.*
- **The real gap**: there is **no GUI equivalent of Ableton's mechanism 1 or 3** (drag one specific,
  already-authored clip into one specific track/bar position) for synth or drum tracks. Grepping the
  entire `ui/src/` tree confirms `setScene`/the `/scene`-shaped daemon route are never called from any
  React component — the only GUI code path that writes a scene slot at all is
  `ArrangementView.tsx`'s audio-clip drag-and-drop handler (`handleLibraryDrop`, around line 456),
  which is audio-track-specific (`installAudioClip`, gated behind `track.kind === 'audio'`). For a
  synth or drum track, the *only* ways to get a clip into a scene's slot today are the CLI (`beat
  scene`/`beat clip`) or MCP (`beat_song`'s bundled `clips`/`scenes` arrays) — there is no button,
  drag target, or menu action in the GUI at all. This is a genuine, verified gap (not a guess): Stream
  CC's Part 2 (cross-track marquee-select-and-drag) is the natural place to close it, since it already
  plans to edit "which scene a section plays" per the phase-24 plan text — but CC's Part 1
  (visualization) doesn't strictly require it, and CC's own scope note says Part 2 should read
  `docs/phase-22-stream-ag.md` before choosing the exact edit primitive.
- **Recommendation**: do not try to build Ableton's mechanism 1 (a literal clip-slot grid to drag out
  of) — that reintroduces the Session-grid surface research 18 already ruled out (§1, "no
  performance surface, no clip-launch grid"). The dotbeat-appropriate version of "get a clip into the
  arrangement" is: (a) the existing automatic snapshot-on-song-conversion stays as the bootstrap path
  (mechanism-2-flavored, already shipped), and (b) a **new, explicit, GUI-driven "assign this clip to
  this track's slot in this section" action** — likely a right-click/dropdown on a track row within a
  section ("assign clip..." listing the track's existing `BeatClip`s, or "save current live content
  as a new clip here"), which is dotbeat's the-file-is-the-source-of-truth equivalent of Ableton's
  drag — a direct call to `setScene` with one slot changed, producing a normal one-line diff. This is
  a real, scoped gap worth flagging to CC/CB explicitly, not something Part 1's visualization work
  needs to solve itself.

## 4. Editing a looping Session clip vs. its Arrangement copy — and dotbeat's own version of the bug

**Ableton's real behavior** [general, well-established — this is a frequently-asked question on the
Ableton forum with a consistent answer across threads]: once a Session clip is dragged/copied into
Arrangement (mechanisms 1, 3, or 4 above), **the Arrangement region is an independent copy** — it is
*not* a live reference back to the Session slot. Editing the Session clip afterward (adding notes,
re-recording, changing loop points) does **not** retroactively update the Arrangement copy; they
diverge from the moment of the drag/copy onward. (Mechanism 2, "Record Session into Arrangement," is
different in kind — it isn't a copy of a clip at all, it's a recording of a *performance*, so there's
no "same clip in two places" relationship to diverge.) The only way to keep an Arrangement region in
sync with ongoing Session edits is to re-drag/re-copy it again after each meaningful change — Ableton
gives you no automatic re-sync.

**dotbeat's directly analogous concept — confirmed from source, not inferred**:

- **"Live" content** = `track.notes`/`track.hits` on a `BeatTrack` — what plays in loop mode
  (`doc.song === null`), and what `NoteView.tsx`/`StepSequencer.tsx` **always** edit, in every mode.
  Confirmed straight from the code's own comment in `ClipPropertiesPanel.tsx:12-13` [dotbeat]:
  *"dotbeat's Clip View edits a track's LIVE content (track.notes/track.hits), not a named BeatClip
  object directly — there's no per-clip 'which clip am I editing' selector in the GUI yet."* This is
  dotbeat's "working on a clip while it loops in the live view" surface, exactly the owner's framing.
- **"Saved" content** = a named `BeatClip` living in `track.clips[]`, referenced by a scene's slot.
  Once `doc.song` is set, `flattenTrack` (`ArrangementView.tsx:318-338`) and the real playback engine
  both resolve a section's content **only** from the clip a scene maps the track to — live
  `track.notes`/`track.hits` are read *only* in loop mode (`if (doc.song) { ...; if (!clipId)
  continue }`, i.e. no song-block track content ever falls back to live data). So in song mode, live
  edits in NoteView are **completely invisible to playback and to the arrangement's own rendering**
  until something re-syncs them.
- **The re-sync mechanism is `saveClip`** (`src/core/edit.ts:964`, CLI `beat clip <file> <track>
  <clip-id>`, or MCP `beat_song`'s `clips` array) — an explicit, one-shot re-snapshot of current live
  content into the named clip, overwriting its previous notes/hits (but preserving that clip's own
  automation/loop/signature overrides, `edit.ts:972-976`). This is structurally identical to
  Ableton's model: **no automatic sync, ever** — a saved clip is a point-in-time copy, exactly like an
  Ableton Arrangement region is a point-in-time copy of whatever the Session clip looked like at drag
  time. dotbeat's rule is if anything *stricter and more honest* than Ableton's: since the "copy" and
  the "live" content are stored in genuinely distinct places in the same file
  (`track.notes`/`track.hits` vs. `track.clips[].notes`/`.hits`), a `git diff` on the `.beat` file
  shows exactly which one changed and which one didn't — there's no ambiguity a text diff can't
  resolve.
- **The real bug this exact testing session found** (`docs/phase-24-plan.md`'s "Already fixed"
  section) is a textbook instance of this divergence: the `drums` track's `groove` clip in
  `examples/night-shift-song.beat` had only captured 11 hits (bar 1 of an intended 4-bar, 44-hit
  pattern) while the track's **live** content already had the full pattern — the clip was
  "apparently never re-snapshotted" after the live pattern grew from one bar to four. In the
  Ableton-behavior terms above: exactly the situation of extending/editing a Session clip after
  it had already been dragged into Arrangement once, and never re-dragging the updated version —
  the Arrangement copy silently keeps playing the stale bar-1-only version while the live/loop view
  correctly plays the full thing, and nothing in the UI flags the mismatch. It was fixed the same way
  Ableton would force you to fix it — an explicit re-snapshot (`beat clip
  examples/night-shift-song.beat drums groove`), not an automatic reconciliation.
- **The gap this exposes, worth flagging explicitly**: dotbeat currently has **no GUI affordance to
  even trigger a re-snapshot** — `saveClip` is CLI/MCP-only (confirmed: zero matches for `saveClip`,
  `beat_clip`, or a `/clip` route anywhere under `ui/src/`). A user editing a track's live content in
  NoteView while in song mode has **no visual indicator** that their edits aren't reaching playback,
  and no button to push them into the clip that actually plays. This is a sharper, more actionable
  version of the owner's "often people work on these clips while looping" framing: in dotbeat today,
  working on a clip in the "live view" (NoteView, in song mode, on a track that's mapped to a saved
  clip) silently edits data that **isn't being heard**, with the only fix being a CLI command the GUI
  never surfaces. **Recommended as its own small follow-up** (not necessarily in CC's scope, but
  worth a line in Stream CC or a new stream): (a) a visible "live edits differ from saved clip" badge
  when `track.notes`/`.hits` no longer match the primary clip's snapshot, and (b) a "save to clip"
  button next to `ClipPropertiesPanel` that calls `saveClip` directly, closing the loop the CLI
  already supports.

## 5. Concrete recommendation for dotbeat's own clip-visualization rendering (for Stream CC)

**Current state, read directly from source, not assumed** [dotbeat] — `ArrangementView.tsx` already
computes exactly the data CC needs (`trackOccurrences`/`ClipOccurrence`, line 273; `flattenTrack`,
line 318), and the per-track canvas render (`TrackRow`, line 384) already does real, content-aware
rendering — but **only for audio tracks**. Audio clips get a bounded, colored, labeled block with
in/out edge markers (lines 539-563) — i.e. audio tracks already do roughly what §1-2 above describe
for Ableton waveform clips. **Synth and drum tracks get no equivalent treatment**: their content
renders as flattened note/hit marks (detail LOD, lines 564-589) or opacity-encoded per-bar density
blocks (density LOD, lines 590-606) continuously across the *entire* track row, with only a faint
(`rgba(255,255,255,0.09)`, 1px) vertical line at each **song section** boundary (lines 518-526) and
zero indication of which specific `BeatClip` is playing, no block border, no fill, and no name label.
The per-section scene name is shown once, only in the ruler row (`arr-section-label`,
`ArrangementView.tsx:1857`, `styles.css:1236`) — never repeated per-track. So today, on a synth/drum
track, two adjacent sections that happen to map to *different* clips with *similar* note density are
visually indistinguishable from one continuous clip, and a section where this track is unmapped
(silent) is distinguishable from a populated section only by the *absence* of note marks — there is
no "this is empty" affirmative signal, exactly the ambiguity §2 above says Ableton avoids with a
bounded block. This matches the phase-24 plan's own hint ("check whether occurrences already paint a
boundary that's just visually weak... versus genuinely not rendered at all") — the honest answer is
**genuinely not rendered**, for synth/drum tracks specifically; audio tracks already got this right
in Phase 22 Stream AE.

**Recommendation — extend the audio-track treatment to synth/drum tracks, informed by §1-2**:

1. **Render each `ClipOccurrence` as its own bounded block**, not a continuous flattened stream
   across the section. Reuse `trackOccurrences` (already gives `{ clipId, startBar, bars }` per
   track) as the source of truth for block boundaries — one block per occurrence, `x = startBar *
   pxPerBar`, `w = bars * pxPerBar`, matching the audio-track code's own geometry exactly
   (`ArrangementView.tsx:547-548`).
2. **Give every block a visible border + fill**, not just a section divider line — border at
   meaningfully higher contrast than the current section-boundary line (that 0.09-alpha line is
   correctly identified by the plan as "visually weak"), fill in the track's own color at a similar
   alpha to the audio block's `globalAlpha = 0.85` fill, so a genuinely empty (unmapped) section
   shows the plain row background with **no** block at all — the same three-signal hierarchy §2
   describes (bounded-block presence first, label second, content density third).
3. **Label every block with its clip id** (`clip.id`, same as the audio block's media-name label,
   `ArrangementView.tsx:556-561`, width-gated so it only draws when the block is wide enough to be
   legible) — this directly answers "where these clips begin and end" from the owner's framing: the
   label plus the border edges together make the boundary unambiguous even before reading content.
4. **Render the existing note/hit marks *inside* each block, clipped to its own bounds**, rather than
   flattened across the whole row — this is the dotbeat-appropriate equivalent of Ableton's MIDI
   display (§1): the detail-LOD code (lines 578-589 for notes, 565-577 for hits) already does almost
   exactly the right per-note/per-hit positioning (`pitchMin`/`pitchMax`-normalized vertical position
   for notes, per-lane row position for hits) — the fix is scoping that draw loop to iterate per
   occurrence-block and clip its own content to `[occ.startBar, occ.startBar + occ.bars)`, rather than
   iterating the whole flattened `flat.notes`/`flat.hits` array unscoped. This preserves dotbeat's
   existing win over a naive port: `flattenTrack` already tiles a clip's content correctly across a
   longer section (§ dotbeat's `clipStepLen`, line 310) and already normalizes pitch range per track
   — CC's job is to draw a border/label/fill *around* that existing per-occurrence data, not to
   rebuild the note-positioning logic from scratch.
5. **Keep the existing density-LOD (opacity-per-bar) fallback for zoomed-out views**, per occurrence
   block rather than per raw bar — this is dotbeat's own version of §1's "detail degrades gracefully,
   never reverts to a flat rectangle" finding: at low zoom, a clip block should still read as a block
   (bordered, labeled if wide enough) with an opacity-varying fill standing in for density, rather
   than disappearing into the current continuous per-bar treatment.
6. **Do not build a fixed absolute-pitch axis or velocity-colored marks** inside the miniature (§1's
   "not literally proportional to an absolute axis, not velocity-shaded" finding) — dotbeat's current
   per-track `pitchMin`/`pitchMax` normalization (`flattenTrack`, lines 363-377) is already the
   Ableton-appropriate schematic-not-literal approach; keep it, just scope it to read per-occurrence
   rather than per-track-flattened once CC lands (a track with two clips of very different pitch
   range currently normalizes them against one shared min/max across the whole row, which very
   slightly overstates how far apart two clips visually "look" relative to how Ableton would show each
   clip normalized to its own range — a minor, second-order refinement worth a one-line note in CC's
   own implementation, not a blocking finding here).
7. **The label answers "which specific `BeatClip`", the block boundary answers "where it begins and
   ends"** — those are the two things the owner explicitly asked for, and per §2 they should be
   readable *before* the user parses the internal note/hit density, not the other way around. If
   Stream CC has to sequence its own work, get border+fill+label right first (directly serves the
   owner's literal ask); the per-occurrence-clipped content preview is the refinement on top.

## Honest gaps

- **§1's exact pixel-level rendering** (mark thickness, exact color/opacity of note marks vs. block
  fill, exactly how the waveform envelope is computed at low zoom) rests on [general] product
  familiarity and consistent secondary-source description, not a manual screenshot machine-read this
  pass (the Reference Manual's clip-appearance passages are thin on visual specifics — confirmed by
  three separate fetch attempts this pass, §1's "Live Concepts" page literally captions an image
  ("Clips in the Arrangement View (Left) and in the Session View (Right)") without describing its
  contents in text). Treat exact pixel choices as CC's own design call, informed by this doc's
  structural/behavioral findings rather than a pixel-perfect Ableton clone.
- **§3/§4's four-mechanism list and the copy-not-reference divergence behavior** are [general] but
  very well corroborated (consistent across the Ableton forum, three independent tutorial sites, and
  matches the author's own general product knowledge) — high confidence despite the tag.
- **This doc did not re-verify CG's `contentOf` function** (referenced in `docs/phase-24-plan.md`'s
  CG section as an existing `engine.ts` helper) — a repo-wide grep for `contentOf` found no match in
  the current `ui/src/audio/engine.ts` on this pass's `main` (`ab2acba`). This may mean CG's own
  worktree introduces it, the name differs from the plan text, or the plan text describes intended
  rather than existing code — out of scope for RF to resolve; flagged for whichever stream lands
  CG/CC to reconcile if it matters to their implementation.
- **dotbeat's `main` branch state**: this worktree started on a stale local `main` ref (60 commits,
  missing `docs/phase-24-plan.md` and everything through Phase 23) and was reset to the real `main`
  (199 commits, `ab2acba`) before starting — noted here in case other Phase 24 streams hit the same
  stale-ref issue (the phase plan's own process notes anticipate exactly this).

## Sources

- Ableton Live 12 Reference Manual — Arrangement View: https://www.ableton.com/en/manual/arrangement-view/ (and the parallel `/live-manual/12/` path)
- — Clip View: https://www.ableton.com/en/manual/clip-view/
- — Session View: https://www.ableton.com/en/manual/session-view/
- — Editing MIDI: https://www.ableton.com/en/live-manual/12/editing-midi/
- — Live Concepts: https://www.ableton.com/en/manual/live-concepts/
- MusicRadar, "How to arrange tracks in Ableton Live: going from Session to Arrangement View": https://www.musicradar.com/how-to/how-to-arrange-tracks-in-ableton-live-from-session-to-arrangement-view
- Soundfly/Flypaper, "Ableton Live: When and How to Go From Session to Arrangement View": https://flypaper.soundfly.com/produce/ableton-live-when-how-to-go-from-session-to-arrangement-view/
- Sound on Sound, "Ableton Live: Session & Arrangement Views": https://www.soundonsound.com/techniques/ableton-live-session-arrangement-views
- Ableton Forum thread, "Moving a clip from session to arrangement view & vice versa": https://forum.ableton.com/viewtopic.php?t=97019
- Ableton Forum thread, "Getting arrangement into session view": https://forum.ableton.com/viewtopic.php?t=172156
- Ableton Forum thread, "How do I place clips into arrangement view/timeline?": https://forum.ableton.com/viewtopic.php?t=225130
- dotbeat internal (read directly this pass): `docs/phase-24-plan.md` (the commissioning brief and
  the "Already fixed" bug writeup); `docs/format-spec.md` (v0.4/v0.9/v0.10 clip/scene/song grammar,
  lines 385-529); `src/core/document.ts` (`BeatClip`/`BeatScene`/`BeatSongSection`, lines 544-570,
  705-749); `src/core/edit.ts` (`saveClip` line 964, `setScene` line 984); `src/daemon/daemon.ts`
  (`sceneFromLiveContent`/`songAppend`, lines 186-224); `cli/beat.mjs` (`beat scene`/`beat clip`/`beat
  song`, lines 136-138, 864-891); `src/mcp/server.ts` (`beat_song`, lines 849-889);
  `ui/src/components/ArrangementView.tsx` (`ClipOccurrence`/`trackOccurrences`/`flattenTrack`/
  `TrackRow`, lines 270-622, 1845-1864); `ui/src/components/ClipPropertiesPanel.tsx` (the
  live-vs-saved-clip editing-model comment, lines 1-17); `ui/src/styles.css` (`.arr-section-label`,
  lines 1236-1256); `docs/research/18-ableton-ui-architecture.md` (the prior Ableton-comparison pass,
  cross-checked in §0 rather than re-derived).
