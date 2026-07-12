# Research 54 — Ableton Live 12 Session View vs. dotbeat: a direct feature/UI comparison

*2026-07-12. Follow-up to `docs/research/35-ableton-session-view.md` (the text-only primer on
manual ch. 7, pp.172-184). That doc already did the scoping call and this one doesn't relitigate
it: `docs/research/18-ableton-ui-architecture.md` and D1 (document-only format) settle that
dotbeat is **arrangement-only** — no live clip-launching performance surface, ever. This doc's job
is different and narrower: lay Ableton's actual screenshots (`p-172.jpg` through `p-184.jpg`,
viewed directly) against dotbeat's actual GUI/source and produce one structured, decisive
feature/UI table, ending in a prioritized build list for the handful of items that survive the
"is this actually in-scope" filter.*

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

These are cases where Ableton's Session View and dotbeat's Arrangement View solve the *same*
underlying authoring problem, just through different surfaces — genuine parity, not a gap.

| Concept | Ableton (Session View) | dotbeat |
|---|---|---|
| Clip as an independent authoring object | A clip has its own name/color/info-text, exists independent of grid position; "a set of clips that are supposed to be played alternatively" stack in one column [manual p.174]. | `BeatClip` (`src/core/document.ts:544-552`) — id, notes/hits/automation/loop/signature, lives in `track.clips[]` independent of any scene reference. |
| Track → clip mapping via a scene/section grid | A scene is a horizontal row across all track columns; only one clip per track can be "live" per scene [manual p.174, screenshot p.175 "A Scene in the Session View"]. | `BeatScene.slots: Record<trackId, clipId>` (`document.ts:560-563`) is the exact same mapping shape; `BeatSongSection { scene, bars }` (`document.ts:567-570`) sequences scenes into a timeline — structurally the same track-column/clip-slot idea, minus the launch triangle. |
| Renaming / recoloring a clip or scene | Rename command, batch-rename multiple selected, Edit Info Text, context-menu color palette [manual p.174, p.179]. | Tracks/groups carry `color`; clips are addressed and editable via the note/clip editor and CLI (`beat set`); scenes are named by their `id`. Not pixel-identical UI chrome, but the same underlying "identity is a property of the object, not its placement" model. |
| Reordering by drag-and-drop | Scenes reordered by drag-and-drop; multi-select via Shift/Ctrl-click [manual p.176]. | `ArrangementView.tsx:2126-2148` — native HTML5 drag-and-drop on section chips, backed by the `songMove` core primitive (`src/core/edit.ts:1014`, `beat song-move`/`beat_song_move` CLI/MCP) — a real reorder splice, not delete+insert. Shipped Phase 24 Stream CB (`docs/product-roadmap.md`'s "Drag a section to reorder it" row). |
| Group-track collapse | Group Tracks can be collapsed; slots show shaded summary content [manual p.174] (see gap discussion below — the *summary* half is missing in dotbeat). | `GroupHeaderRow` (`ArrangementView.tsx:1121-1173`) collapses a `BeatGroup`'s member tracks into one row with a toggle, swatch, rename, ungroup — the collapse mechanic itself is shared; the content-summary half is not (see 1b/2). |
| Drag-drop file import onto the grid | Drag audio/MIDI files onto Session slots; Ctrl/Cmd-drag spreads multiple files across tracks instead of stacking [manual p.180]. | `ContentBrowser.tsx` + `ArrangementView.tsx` drag-drop: a kit sample onto a drum lane, a soundfont onto an instrument track, an audio one-shot onto an audio track region (Phase 23 Stream BC). Same "drag content from a browser onto the grid" interaction pattern. |
| Snapshot live content into a durable, reusable unit | "Capture and Insert Scene" snapshots whatever's currently playing into a new scene with no audible interruption, explicitly framed as an iterative-development tool, not a performance one [manual p.182]. | "Place in Arrangement" (`NoteView.tsx:768-783`, `place-clip-btn`) snapshots a track's live notes/hits into a `BeatClip` via `saveClip` and slots it into a scene (Phase 24 Stream CI) — the same "snapshot what's live into a durable, addressable object" idea, one track at a time rather than all tracks at once (no Ableton-style whole-scene capture yet — see 1c/2). |
| Audition/preview content independent of the main transport | Session clips play independent of the Arrangement Position clock, which keeps running regardless [manual p.172-173]. | "Preview clip" (`NoteView.tsx:736-751`, `engine.auditionClip`/`stopAudition`) plays a track's own live notes/hits directly regardless of song position, true-soloing every other track for the duration (Phase 24 Stream CH). Narrower (one track, not concurrent per-column playback) but the same "audition without disturbing the main timeline" need. |

### b) In Ableton, not in dotbeat

Per the task brief's own expectation: most of this is genuinely out of scope for an
arrangement-only tool, and is recorded here for completeness rather than as a backlog.

1. **Clip-launch triangles / launch-on-click / Enter-key launch / arrow-key clip navigation**
   [manual p.173, screenshot p.173 "The Controls for a Session View Clip"]. The entire
   trigger-any-clip-any-time interaction.
2. **Scene Launch buttons** (fire every clip in a row simultaneously) and **auto-advance to the
   next scene on launch** [manual p.175].
3. **Clip Stop buttons**, **Stop All Clips button** [manual p.175, p.184 screenshot], and
   **Add/Remove Clip Stop Buttons** per-slot configuration (opt a track out of a given scene's
   stop behavior) [manual p.181].
4. **Group Track slot shading with its own launch/stop button** — the *summary indicator* half of
   group-collapse Ableton ships that dotbeat doesn't (screenshot p.174 "Group Slots and Group
   Launch Buttons": a shaded cell, colored by the left-most contained clip, with its own
   launch/stop control). dotbeat's `GroupHeaderRow` collapse hides member content with zero
   summary signal (`ArrangementView.tsx:1170`, `arr-group-lane` renders empty).
5. **Select Next Scene on Launch** toggle and remote/MIDI/computer-keyboard clip and scene
   triggering [manual p.175, p.173].
6. **Scene Tempo / Scene Time Signature overrides**, the Main-track title-bar drag-reveal
   controls, and the dedicated **Scene View** panel (Tempo/Signature sliders,
   Follow Action controls) [manual p.176-178, screenshots p.176-178]. The tempo/time-sig half of
   this is *not* purely a performance-surface concept — see the recommendation below.
7. **Follow Actions** (`Other`/`Any` dropdowns, percentage-split action-time sliders,
   `Action Time` field) [manual p.178, screenshot p.178 "Follow Action Controls"] — already
   confirmed out of scope by `docs/research/18-ableton-ui-architecture.md`.
8. **Track Status field live-transport icon vocabulary**: pie-chart looping-clip indicator with
   loop-length-in-beats and play-count, progress-bar one-shot remaining-time readout, mic/keyboard
   input-monitoring icons, miniature Arrangement-clip preview when a track plays from the
   Arrangement instead of Session [manual p.179-180, four screenshots].
9. **Resizable Session View track columns** (narrow to just launch buttons + essential controls,
   Alt/Option to resize all at once) [manual p.175, screenshot "Resized Session View Tracks"].
10. **Session ↔ Arrangement reconciliation apparatus**: Arrangement Record button logging clip
    launches/property changes/automation/tempo-and-time-sig-via-scene-name into the Arrangement
    [manual p.182, screenshot "The Control Bar's Arrangement Record Button"]; the strict
    mutual-exclusivity per track between Session and Arrangement playback; the **"Back to
    Arrangement" button** that lights up to flag divergence [manual p.183-184]; copy-vs-reference
    semantics when a Session clip is dragged into the Arrangement.
11. **Second-Window mode** and **drag clips between Session and Arrangement via the view
    selectors** [manual p.184].
12. **"Consolidate Time to New Scene"** — select an Arrangement time range, consolidate to one new
    clip per track, deposit into a new Session scene [manual p.184, screenshot "The Stop All Clips
    Button" page also covers this text]. The *destination* half (a Session scene) is moot for
    dotbeat; the underlying "snapshot every track across a bar range into a fresh, reusable
    clip set" operation is a candidate worth a mention (see recommendation table).
13. **Insert Scene** (blank, independent, empty scene inserted below the current selection)
    [manual p.182] — the *non-capture* half of item 6 in research 35's original recommendation
    list; distinct from Capture and Insert Scene (item 14 below).
14. **Capture and Insert Scene** (snapshot whatever's currently live into a brand-new scene,
    inserted with no audible interruption) [manual p.182].

### c) In dotbeat, not in Ableton

Ableton's Session View has no direct analog to these — either because they only make sense once
the *document itself* is the source of truth (git-native premise), or because Session View's
async, non-linear performance model has no timeline-position concept to anchor them to.

- **File-level diff/version control of the entire Session state.** A `git diff` on a `.beat` file
  shows exactly which scene/clip/section changed, in readable text (`docs/decisions.md` D4, D8).
  Ableton's `.als` is not diff-friendly by design (`ROADMAP.md` §1 table) — there is no Ableton
  analog to "see exactly what changed in this arrangement between two saves."
  `docs/research/30-ableton-clip-visualization.md` §4 independently confirms dotbeat's
  save/snapshot model is "if anything stricter and more honest than Ableton's" on exactly this
  point.
- **CLI/MCP-addressable scenes and sections.** `beat song`, `beat song-move`, `beat_song_move`,
  and the generic `beat set`/`beat_set` path let an agent script arrangement changes headlessly —
  Ableton's Session/scene model has no CLI or agent-drivable equivalent at all (`ROADMAP.md` §1,
  the whole "no existing system occupies the target quadrant" finding).
- **Cross-track marquee-select and drag-move of clip occurrences together, preserving relative
  section offsets**, including automatic private-scene cloning when a moved selection would
  otherwise bleed into untouched siblings sharing the same scene (`ArrangementView.tsx:1318-1352`,
  Phase 24 Stream CC, `docs/research/30-ableton-clip-visualization.md`). Session View has no
  concept of "move several clip occurrences across the timeline together" because clips aren't
  positioned on a timeline at all.
- **Timeline zoom + numbered bar-ruler with pointer-anchored Cmd/Ctrl+scroll zoom**
  (Phase 24 Stream CD) and **click-ruler-to-seek** (Phase 24 Stream CE) — both premised on there
  being one continuous, positional timeline to zoom/seek along, which is the Arrangement View's
  job in Ableton, not Session View's.
- **Loop a selected arbitrary bar range within the single linear timeline**, including a
  section-chip "loop this section" toggle (`ArrangementView.tsx:1804`, Phase 24 Stream CE) — this
  is Arrangement-side functionality in Ableton too (loop braces on the Arrangement ruler), but
  dotbeat's version is unified with section identity in a way Ableton's isn't, since dotbeat has
  no separate Session clock to reconcile against.
- **True single-track solo audition regardless of arrangement position, with zero risk of leaving
  session-only state in the saved document** ("Preview clip") — Ableton's nearest equivalent
  (launching a Session clip) *does* leave session-divergence state that needs the "Back to
  Arrangement" reconciliation UI (1b item 10); dotbeat's version is stateless by construction
  (silences other tracks for the duration, writes nothing, `NoteView.tsx:736-751`).

---

## 2. Prioritized recommendations

| Feature | Priority | Build recommendation |
|---|---|---|
| Clip-launch triangles / launch-on-click / Enter/arrow-key clip navigation | **Do-not-recreate** | Session-only performance mechanic; dotbeat has no live clip-triggering surface by product design (D1, research 18). |
| Scene Launch buttons + auto-advance-to-next-scene-on-launch | **Do-not-recreate** | Same reason — presupposes a launchable grid dotbeat doesn't have. |
| Clip Stop buttons / Stop All Clips / Add-Remove Clip Stop Buttons | **Do-not-recreate** | Solves "silence a live-triggered clip without disturbing others," a problem that only exists under async per-track triggering. dotbeat's timeline has no such state to stop. |
| Group Track slot shading (collapsed-group content summary) | **P1** | Not a Session-only mechanic — it's a plain "what's inside this collapsed thing" affordance, and dotbeat's own `GroupHeaderRow` (`ArrangementView.tsx:1121-1173`) already has the collapse mechanic with zero summary today (confirmed: `arr-group-lane` at line 1170 renders empty). Add a lightweight per-section indicator on the collapsed group row: filled/colored whenever any member track has a clip occurrence in that section, colored by the first (in track order) populated member's track color — reuse the per-occurrence block geometry `docs/research/30-ableton-clip-visualization.md` §5 already established for ungrouped tracks. Small, cheap, closes a concretely-verified blind spot. |
| Select Next Scene on Launch + remote/MIDI/keyboard clip triggering | **Do-not-recreate** | Performance-surface remote-control feature for a launch mechanic dotbeat doesn't have. |
| Scene Tempo / Scene Time Signature overrides + Scene View tempo/signature sliders | **P1** | This is the one item in 1(b) that is *not* actually a performance-surface artifact — it's a per-section-of-timeline data override, and dotbeat's own code already names the exact gap without a design pattern: `BeatTimeSignature`'s doc comment in `src/core/document.ts` says the engine is "still constant-tempo 4/4 only," and `docs/product-roadmap.md`'s Arrangement row confirms "Time signature remains metadata-only." Add an optional `tempo?: number` to `BeatSongSection` (`document.ts:567-570`), following the exact canonical-elision pattern D9 already uses everywhere (absence = inherit the document's `bpm`); wire it into the engine's section-transition logic; surface it as a per-section-chip field the same way `BeatClipLoop`'s drag-handle already exposes clip-level loop range (Phase 24 Stream CJ). Leave per-clip time-signature as metadata-only for this pass — tempo is the more consequential, more tractable half; Ableton's own chapter treats them as two independently-settable controls, not one bundled feature [manual p.176]. |
| Follow Actions (Other/Any dropdowns, action-time percentage split) | **Do-not-recreate** | Already ruled out by `docs/research/18-ableton-ui-architecture.md`; presupposes randomized/conditional scene advancement in a live-triggered grid dotbeat doesn't have. |
| Track Status field icon vocabulary (pie-chart loop count, one-shot remaining-time, mic/keyboard monitoring icons, mini Arrangement-clip preview) | **Do-not-recreate** | Every one of these answers "which of several async, independently-triggered things is this track doing right now" — a question that doesn't exist when a track only ever plays "whatever the current song position resolves to." dotbeat's "Preview clip" already answers its own, much narrower version of "what's audible on this track" without needing the vocabulary. |
| Resizable Session View track columns (narrow to essentials, resize-all-at-once) | **Do-not-recreate** | A density control for a grid of launchable slots; dotbeat's Arrangement rows aren't a launch grid, so there's nothing analogous to narrow. (Timeline zoom, which dotbeat already has via Phase 24 Stream CD, is the real analog to "see more at once" and is already shipped.) |
| Session↔Arrangement reconciliation (Arrangement Record, mutual-exclusivity, "Back to Arrangement" button, copy-vs-reference on drag) | **Do-not-recreate** | This entire apparatus exists solely to reconcile two asynchronous playback sources that can diverge. dotbeat has one linear timeline and no second live surface — there is nothing to reconcile. `docs/research/30-ableton-clip-visualization.md` §4 already confirmed dotbeat's snapshot semantics are copy-based (arguably stricter/more honest than Ableton's) with no further work needed. |
| Second-Window mode / drag clips between Session and Arrangement views | **Do-not-recreate** | Presupposes two independent views of two independent clip populations; dotbeat has one. |
| "Consolidate Time to New Scene" (snapshot an arbitrary bar range across all tracks into one new clip per track) | **P2** | The *destination* half (a Session scene) is moot, but the underlying primitive — "snapshot every track's content across a bar range into a fresh, independently-editable clip set" — is a generically useful authoring convenience even without a grid to deposit into (e.g., turning an improvised passage into a reusable, re-placeable pattern). Not blocking anything currently flagged in `docs/product-roadmap.md`. Needs a naming pass before scoping — `beat consolidate` is already taken (ratchet-to-discrete-notes verb, per the Note editing table), so the new command needs a different name. Lower urgency than the two P1 items above. |
| Insert Scene (blank, independent scene inserted at a position) | **P0** | Directly closes an already-flagged, already-status-"Not started" gap: `docs/product-roadmap.md`'s Arrangement row states plainly "Today, appended sections share the source scene; editing one edits them all. Give each section its own scene." Confirmed in code: `songAppend` (`src/daemon/daemon.ts:215`) and `setSong` (`src/core/edit.ts:999`) offer only whole-list replace and reorder (`songMove`, `edit.ts:1014`) — no primitive exists for inserting a brand-new, independent, empty `BeatScene` at a chosen position. This is a small, well-scoped core primitive (a new `BeatScene` with empty `slots`, spliced into `doc.song` at a position) plus a CLI/MCP verb and one new toolbar/context-menu action next to the existing section-chip controls (`ArrangementView.tsx:2118-2170`). P0 because it's pure removal of friction on an already-shipped, already-used feature (song sections) with zero new format risk. |
| Capture and Insert Scene (snapshot current live content into a new independent scene, insert immediately) | **P0** | Same gap as above, the other half. dotbeat already has both load-bearing pieces built independently — `sceneFromLiveContent` (`src/daemon/daemon.ts:200`, currently invoked automatically exactly once, at loop→song conversion) and "Place in Arrangement"'s per-track `saveClip` (`NoteView.tsx:768-783`, Phase 24 Stream CI) — this is generalizing `sceneFromLiveContent` into a repeatable, user-triggered GUI action rather than a one-shot internal conversion step. Directly closes two independently-flagged gaps in `docs/research/30-ableton-clip-visualization.md` §3-4 ("no GUI equivalent of getting a specific authored clip into a specific section," "no GUI affordance to even trigger a re-snapshot"). Bundle with Insert Scene above as one stream — they share the "new section at a position" plumbing and differ only in whether the new scene starts empty or pre-populated from current live content. P0 for the same reason: closes a named, tracked, "Not started" roadmap row with existing building blocks, no new format design needed. |

**Summary of the decisive calls**: of the 14 items in 1(b), 11 are **Do-not-recreate** — Session
View's actual reason for existing (async, order-unknown-in-advance live triggering [manual p.172])
is categorically absent from dotbeat's product, so most of the chapter doesn't transfer. The 3
that do (group-content-summary, scene tempo override, Insert/Capture-and-Insert Scene) all share
one property worth naming explicitly: none of them are performance-surface mechanics at all once
you strip Ableton's launch-grid framing off — they're generic authoring/organization affordances
that happen to live inside Session View's chapter of the manual, and every one of them maps onto a
gap dotbeat's own docs had already flagged before this research pass started.

---

## Sources

Ableton Live 12 Reference Manual, chapter 7 "Session View," pp.172-184 — text read via
`docs/research/35-ableton-session-view.md`; screenshots viewed directly this pass: `p-172.jpg`
through `p-180.jpg`, `p-182.jpg`, `p-184.jpg` (11 of 13 pages; `p-181.jpg`/`p-183.jpg` covered
fully by the adjacent pages' text and prior research 35's citations, no unique screenshot content
skipped). dotbeat source read directly: `src/core/document.ts` (`BeatClip`, `BeatScene`,
`BeatSongSection`, `BeatGroup`, lines 544-570), `ui/src/components/ArrangementView.tsx`
(`GroupHeaderRow` lines 1121-1173, section-chip drag-reorder lines 2118-2170, marquee/drag-move
comments lines 1318-1352), `ui/src/components/NoteView.tsx` (audition/"Preview clip" lines
225-260, 730-784), `src/daemon/daemon.ts` (`songAppend`, `sceneFromLiveContent`), `src/core/edit.ts`
(`setSong`, `songMove`). Cross-referenced against `docs/research/18-ableton-ui-architecture.md`,
`docs/research/30-ableton-clip-visualization.md`, `docs/decisions.md` (D1, D4, D8, D9),
`docs/product-roadmap.md`, `ROADMAP.md`.
