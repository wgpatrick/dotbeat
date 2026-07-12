# Research 35 — Ableton Live 12 manual, ch. 7 "Session View": what's worth mining for an Arrangement-only tool

*2026-07-12. One pass of a parallel per-chapter research sweep over the owner's local copy of the
Ableton Live 12 Reference Manual (`prior_art/`, gitignored). This pass covers chapter 7, "Session
View," manual pp. 172-184. Research-only — no code changes.*

## 0. Scope, up front

This is the single Ableton chapter most likely to be irrelevant to dotbeat, and that's already a
settled call, not a live question this doc is reopening. `docs/research/18-ableton-ui-architecture.md`
already did the Session-vs-Arrangement analysis directly against dotbeat's product shape and
concluded, in its own words: *"dotbeat has no live clip-launching performance surface and doesn't
want one"* — clip-launch triangles, scene-launch, launch quantization, Follow Actions, and the
Extended Clip Properties "Launch" panel are all listed as **confirmed Session-only, explicitly
"Skip."** Nothing in this chapter changes that call: dotbeat is an arrangement-only, git-diffable
production tool, not a live-performance/DJ instrument, and Session View's entire reason for
existing — *"the order of pieces... is generally not known in advance"* **[manual p.172]** — is a
non-goal by product design (D1's document-only format, the whole `.beat`-file-as-source-of-truth
thesis).

So this doc does **not** propose building a clip-launch grid, scenes-as-a-performance-surface, or
Follow Actions. What it does is the thing the task brief asks for: mine the chapter for *concepts*
that outlive the performance-surface framing — clip-vs-placement as a data model, the track/scene
grid's authoring conventions, and a couple of named commands that turn out to be closer to unbuilt
dotbeat roadmap gaps than they first look. Roughly a third of the chapter (§§7.1, 7.3, 7.4,
7.4.1-7.4.2, most of 7.5) is genuinely, confidently out of scope and is treated that way below
rather than padded into false relevance. Two subsections (7.2.1-7.2.2 and 7.4.3) turn out to map
almost exactly onto gaps dotbeat's own docs have already flagged as open — those get the most
attention.

## 1. Session View's core model: clips, columns, scenes (§7.1-7.2)

- **The clip is the authoring unit; the grid position is just one of possibly several places it's
  referenced.** A track (column) "can play only one clip at a time," so "it therefore makes sense
  to put a set of clips that are supposed to be played alternatively in the same column[s]: parts
  of a song, variations of a drum loop, etc." **[manual p.174]** This is the chapter's foundational
  design idea: a clip is an object that exists independent of *where* it's referenced, and multiple
  candidate variations live stacked in the same column precisely because only one can be "live" for
  that column at a time. dotbeat already has the structural analog — `BeatClip` objects live in
  `track.clips[]`, and a `BeatScene.slots` is a `trackId -> clipId` map (`src/core/document.ts:544,
  560`) — this is *exactly* Ableton's track-column/clip-slot shape, just without the launch
  triangle. Nothing to add here; it's a confirmation that dotbeat's clip/scene split was the right
  call, already made (see §3 below for where the analogy stops holding up in practice).
- **Clips carry their own name, color, and free-text info independent of position** — rename via
  the Edit menu or context menu, batch-rename multiple selected clips at once, a separate "Edit
  Info Text" field, a color picker in the context menu **[manual p.174]**. All Session-clip-specific
  UI chrome, but the underlying idea — a clip's identity (name/color/notes) is a property of the
  clip object, not of any one placement of it — is already dotbeat's model (`BeatClip.id`, and
  tracks/groups already carry color per `docs/decisions.md` D-track-management rows). No gap here.
- **Random-access ordering is the explicit point of the grid**: "Clips can be played at any time and
  in any order. The layout of clips does not predetermine their order" **[manual p.173]**. This is
  the single sentence that most directly identifies Session View's actual value proposition
  (performance flexibility) — and confirms it really is orthogonal to what dotbeat is for. Skip.
- **The Arrangement Position clock keeps running independent of what Session clips are doing**
  **[manual p.172-173]** — a "continuous flow of musical time" so a performer always knows their
  position in song time regardless of individual clip states, with an explicit "press Stop twice to
  return to 1.1.1" affordance **[manual p.173]**. This is solving a problem (reconciling a
  free-triggered performance against an underlying song clock) that only exists because Session
  View lets clips run asynchronously from a fixed timeline. dotbeat's timeline *is* the only clock —
  there's no second, asynchronous performance layer to reconcile against. Not applicable.
- **Group Track slot shading** **[manual p.174]**: a scene's slot under a collapsed Group Track
  shows a shaded area if *any* member track has a clip in that scene, colored by the left-most
  member's clip color, with its own launch/stop button that fires every contained clip at once;
  clicking the shaded slot selects every clip it represents. This is the one piece of §7.1-7.2 with
  a real dotbeat-shaped echo — see §4 (Relevance) below; dotbeat's own track-group collapse currently
  does the opposite (collapsing hides the members' content entirely, with zero summary signal).

## 2. Scene-level tempo & time signature overrides (§7.2.1-§7.2.2)

This is the chapter's most concrete, most directly reusable finding, and it lands on a gap dotbeat
has *already flagged in its own source comments* without connecting it back to this Ableton
mechanism.

- Dragging the Main track's title-bar edge reveals **per-scene Scene Tempo and Scene Time
  Signature controls**, hidden by default **[manual p.176]**. "The project will automatically
  adjust to these parameters when the scene is launched" **[manual p.176]** — i.e. this is not a
  cosmetic label, it's a real, engine-honored override that takes effect the moment that scene
  becomes the active one. Any tempo is legal within Live's global 20-999 BPM range; any time
  signature with numerator 1-99 and denominator in {1,2,4,8,16} **[manual p.176]**. A scene with an
  assigned tempo/time-sig override gets a visibly colored Scene Launch button **[manual p.177]** —
  a glance-able "this section changes the groove" signal. There's also a dedicated **Scene View**
  panel (§7.2.2, **[manual p.177-178]**) with Tempo/Signature sliders as an alternate editing
  surface to the inline Main-track controls, and the controls can be reset to "inherit" via a
  context-menu action or the Delete key **[manual p.176]** — i.e. explicit presence-vs-absence
  (override vs inherit), not a value that's always "set."
- **This maps directly onto two gaps dotbeat's own code already names but hasn't connected to a
  design pattern.** `src/core/document.ts:469-479` defines `BeatTimeSignature` as a **per-clip**
  override field and says outright in its own doc comment: *"The playback engine is still
  constant-tempo 4/4 only (docs/phase-6-plan.md §Exclusions: 'tempo changes / time signatures — no
  engine support'), so this is modeled and round-tripped but NOT yet interpreted by the audio
  engine."* And `BeatSongSection` (`document.ts:567-570`) is a bare `{ scene, bars }` pair — no
  tempo or time-signature field at all, at any level; `bpm` (`document.ts:741`) is a single
  document-wide number. `docs/product-roadmap.md`'s "Clip-level loop/length/time-signature
  properties" row independently confirms this as a live, known gap: *"Time signature remains
  metadata-only — the engine is still constant-tempo 4/4."*
- **The mismatch worth naming**: dotbeat modeled the override at the *clip* level (Ableton's
  Signature field is also per-clip, confirmed by research 18's Clip View table), but Ableton's
  *tempo* override — arguably the more consequential of the two for an arrangement-timeline tool —
  lives one level up, at the **scene** (which for dotbeat means the **section**), not the clip. A
  clip-level tempo override would be a strange fit for dotbeat's model anyway, since a scene/section
  can host several different clips across tracks simultaneously — Ableton's own design choice
  (tempo lives with the scene, not any one clip inside it) is the more portable lesson here, not an
  arbitrary Ableton-ism.

## 3. Track Status fields (§7.3)

Pie-chart icon = a looping Session clip, with loop length in beats and elapsed-play-count numbers;
progress-bar icon = a one-shot clip's remaining play time in `mm:ss`; a mic/keyboard icon marks
input-monitoring tracks; a miniature Arrangement-clip preview shows when a track is playing back
from the Arrangement instead of a Session clip **[manual p.179-180]**. Every one of these is a
live-transport status readout for a system (asynchronous, independently-triggered per-track
playback) dotbeat's engine doesn't have — a dotbeat track only ever plays "whatever the current
song position resolves to," so there's no "which of several possible things is this track doing
right now" question to answer. **Not much to take here.** The nearest thing dotbeat has — the
per-track playhead/position feedback during the "Preview clip" audition feature
(`docs/product-roadmap.md`'s "Audition a clip being authored, independent of song position," done
in Phase 24 Stream CH) — already solves its own, much narrower version of "what's currently
audible on this track" without needing Ableton's pie-chart/progress-bar vocabulary; that feature is
a true solo/preview toggle, not a per-slot status readout, so there's no real design gap this
section closes.

## 4. Grid population & scene-editing commands (§7.4)

Most of §7.4 is genuinely Session-grid-specific plumbing and is skip-worthy on its own merits:

- **Multi-clip drag-in defaults** (vertical stacking in one track unless Ctrl/Cmd is held to spread
  across tracks, audio/MIDI files only, not "Live Clips" with embedded devices) **[manual p.180]** —
  a file-import UX detail for a grid dotbeat doesn't have.
- **Select on Launch** (§7.4.1, **[manual p.181]**) — toggles whether clicking a clip's launch
  button also focuses it in Clip View. Presupposes a launch button. Skip.
- **Add/Remove Clip Stop Buttons** (§7.4.2, **[manual p.181]**) — per-slot configuration of whether
  a scene launch is allowed to silence a given track ("if you don't want scene 3 to affect track
  4, remove the scene 3/track 4 Stop button"). This is solving a problem specific to *simultaneous,
  independently-triggerable* scene/track combinations — not applicable to a linear timeline where
  "what plays in section N" is just read off the document. Skip.

But **§7.4.3, "Editing Scenes," names two commands that are worth pulling out on their own** —
this is the chapter's second concrete find:

- **"Insert Scene inserts an empty scene below the current selection."** **[manual p.182]** A
  deliberately blank, independent scene — the default way to get a *new*, uncoupled scene rather
  than one that shares state with its neighbor.
- **"Capture and Insert Scene inserts a new scene below the current selection, places copies of the
  clips that are currently running in the new scene and launches the new scene immediately with no
  audible interruption... very helpful when developing materials in the Session View. You can
  capture an interesting moment as a new scene and move on."** **[manual p.182]** This is a named,
  first-class "snapshot whatever's currently live, right now, into a durable new scene, without
  breaking flow" command — explicitly framed by Ableton's own manual as an *iterative-development*
  tool, not a performance one.

Both of these land squarely on an already-open dotbeat roadmap gap — see §5 below.

## 5. Recording Session into Arrangement, and the two views' independence (§7.5)

Arrangement Record logs every clip launch, clip-property change, mixer/device automation change,
and scene-name-encoded tempo/time-sig change into the Arrangement as you perform **[manual
p.182]**; the two Clip populations (Session vs. Arrangement) are strictly mutually exclusive per
track — triggering a Session clip silences that track's Arrangement playback until an explicit
"Back to Arrangement" button (which visibly lights up to flag the mismatch) is pressed **[manual
p.183-184]**; a dragged/copied Session clip becomes an **independent copy** in the Arrangement, not
a live reference — editing the Session original afterward does not retroactively update the
Arrangement copy **[manual p.183-184, inferred from the "exist independently... improvise into the
Arrangement over and over again" framing]**. This entire reconciliation apparatus — two
asynchronous playback sources that can diverge and need an explicit "which one is actually audible
right now" indicator — only exists *because* Session View exists as a second, live-triggerable
surface running in parallel with the Arrangement. dotbeat's own research pass on this exact
copy-vs-reference question (`docs/research/30-ableton-clip-visualization.md` §4) already confirmed
dotbeat's `saveClip`/live-content model reproduces the *copy semantics* half of this faithfully (a
saved `BeatClip` is a point-in-time snapshot, not a live reference — "if anything stricter and more
honest than Ableton's," per that doc, since a `git diff` shows exactly which side changed). There's
no reconciliation UI to build on dotbeat's side because there's no second live surface to
reconcile against in the first place. **Not much new here** beyond what research 30 already
established — this chapter is corroborating evidence, not a new finding.

One command from this section is worth a passing mention rather than a full recommendation:
**"Consolidate Time to New Scene"** **[manual p.184]** — selects an Arrangement time range and
"consolidates the material within the selected time range to one new clip per track," placed into a
new scene. Structurally this is dotbeat's existing "Place in Arrangement" (Phase 24 Stream CI, which
does the *opposite* direction: live content → clip → scene slot) run backwards: arrangement range →
one clip per track → reusable scene. Since dotbeat has no Session grid to deposit the result into,
the destination half is moot, but the underlying operation — "snapshot every track's content across
an arbitrary bar range into a fresh, independently-editable set of clips" — is a generically useful
authoring primitive even without a grid to put it in (e.g., turning an improvised passage into a
reusable, nameable pattern that can be re-placed elsewhere in the arrangement). Flagged as a small,
low-priority idea in §6, not a core recommendation — dotbeat's "Independent per-section scene
editing" gap (below) is the more direct hit from this chapter.

## 6. Relevance to dotbeat — concrete recommendations

Three things from this chapter map onto real, already-flagged, unbuilt dotbeat gaps. Ranked by how
directly each closes an existing gap vs. how much new design work it implies.

**A. Section/scene-level tempo (and, more cautiously, time-signature) override — fills a gap the
codebase already names but doesn't yet have a design pattern for.**
`src/core/document.ts`'s own comments on `BeatTimeSignature` and the "constant-tempo 4/4 only"
engine limitation, plus `docs/product-roadmap.md`'s "Time signature remains metadata-only" line, are
an open, self-documented gap, not a hypothesis this doc is introducing. Ableton's answer (§2 above)
is a clean, minimal pattern worth copying almost directly: an *optional* tempo (and/or time
signature) field on `BeatSongSection` (or `BeatScene`, whichever ends up the natural home once
per-section-scene independence lands, see B below) that, when present, the engine applies the moment
that section becomes active — absence means "inherit the document's `bpm`," exactly the same
canonical-elision discipline dotbeat already uses everywhere else (D9's frozen-default elision,
`BeatClipLoop`/`BeatTimeSignature`'s own "presence = override" comments). Concretely: add
`tempo?: number` to `BeatSongSection`, wire it into the engine's section-transition logic (today
just `bars`-driven tiling, per `edit.ts:999` and `document.ts:567`), and surface it as a per-section
field in the arrangement UI the same way the existing clip-level loop-range drag-handle
(`phase-24-stream-cj.md`) exposes `BeatClipLoop`. Leave the existing per-clip `BeatTimeSignature`
field as metadata-only for now (the roadmap's own framing) rather than trying to also wire time-sig
changes into the engine in the same pass — tempo is the more consequential, more tractable half,
and Ableton's own chapter suggests treating them as two separate controls (Scene Tempo *and* Scene
Time Signature are independently settable, independently resettable **[manual p.176]**) rather than
one bundled feature.

**B. An explicit "new empty section" vs. "capture current live state into a new section" choice —
directly closes the already-flagged "Independent per-section scene editing" gap.**
`docs/product-roadmap.md`'s Arrangement row states plainly: *"Today, appended sections share the
source scene; editing one edits them all. Give each section its own scene."* — status "Not
started," no research link yet. `songAppend` (`src/daemon/daemon.ts:215`) and `setSong`
(`src/core/edit.ts:999`) confirm this in code: there is no primitive for inserting a *new,
independent* scene at a chosen position, only whole-list replace (`setSong`) and reorder
(`songMove`, `edit.ts:1014`) — nothing shaped like Ableton's "Insert Scene." Ableton's §7.4.3 offers
two distinct, well-named answers that map cleanly onto dotbeat's exact situation:
- **"Insert empty section"** (Ableton's plain Insert Scene, **[manual p.182]**) — a brand-new,
  empty `BeatScene` with no slots set, inserted at a chosen position, so a user isn't forced to
  either share an existing scene or hand-build one via `beat scene`/MCP.
- **"Capture current state as new section"** (Ableton's Capture and Insert Scene, **[manual
  p.182]**) — a one-action GUI command that snapshots every track's *current live content*
  (`track.notes`/`track.hits`) into fresh `BeatClip`s and a fresh `BeatScene`, then inserts it as a
  new section — generalizing the one-shot, loop-mode-only `sceneFromLiveContent`
  (`daemon.ts:200`, currently invoked automatically exactly once, at loop→song conversion) into a
  repeatable authoring action available at any point while building a song. This is also the
  cleanest available fix for the GUI gap `docs/research/30-ableton-clip-visualization.md` §3-4
  already flagged twice independently — "no GUI equivalent of getting a specific authored clip into
  a specific section" and "no GUI affordance to even trigger a re-snapshot [`saveClip`]" — by
  giving both problems one shared, Ableton-precedented command shape rather than two separate ad hoc
  buttons. Ableton's own framing of *why* this command exists ("very helpful when developing
  materials... capture an interesting moment... and move on") matches dotbeat's actual authoring
  loop unusually well: build a groove live in loop mode, like it, capture it as a section, keep
  iterating on the live view for the next section — exactly the workflow research 30 already
  identified as under-served.

**C. A group-row content indicator when a track group is collapsed — small, cheap, concretely
verified as missing.** Ableton's Group Track slot shading (§1 above, **[manual p.174]**) answers "does
any track in this collapsed group have content in this scene, and whose color is it" at a glance.
Checked directly against dotbeat's source: `ArrangementView.tsx`'s row-list builder
(`if (!collapsedGroups[g.id]) rows.push(...)`, around line 1447) simply *omits* every member track's
row entirely when a group is collapsed — the group header row (`GroupHeaderRow`, line 1121) carries
no per-section summary of any kind today. A collapsed group in dotbeat's Arrangement View currently
gives zero visual signal about whether any of its hidden member tracks have content in a given
section — exactly the ambiguity Ableton's shading solves. Recommendation: when rendering
`GroupHeaderRow` in its collapsed state, draw a lightweight per-section indicator (reuse the same
per-occurrence block geometry `research/30-ableton-clip-visualization.md` §5 already recommends for
ungrouped tracks) that's filled/colored whenever *any* member track has a clip occurrence in that
section, using the first (in track order) populated member's track color — a direct, low-effort
port of Ableton's "shaded slot, colored by left-most clip" rule onto dotbeat's own group-collapse
row.

**Lower priority, noted but not recommended as a scoped stream**: the "Consolidate Time to New
Scene" idea from §5 (a generic "snapshot an arbitrary bar range across all tracks into a fresh set
of reusable clips" primitive) is a reasonable future authoring convenience but isn't blocking
anything currently flagged, and would need its own naming/scoping pass (dotbeat already has a
`beat consolidate` verb for a different purpose — ratchet-to-discrete-notes, per
`docs/product-roadmap.md`'s note-editing table — so the name would need to be resolved before this
became real work).

**Confirmed out of scope, no recommendation** (already settled by `docs/research/18-ableton-ui-
architecture.md` and reconfirmed by this pass, listed here only so this doc doesn't read as having
skipped them by accident): clip-launch triangles and launch-key mapping (§7.1), the
Arrangement-Position-clock-vs-async-clips reconciliation (§7.1), Select on Launch (§7.4.1),
Add/Remove Clip Stop Buttons (§7.4.2), Arrangement Record / performance capture and the
Session↔Arrangement mutual-exclusivity + "Back to Arrangement" UI (§7.5), and the Track Status
field's live-transport icon vocabulary — pie-chart loop count, one-shot remaining-time readout,
input-monitoring icons (§7.3). All of these solve problems that only exist because Session View is a
second, asynchronous, live-triggerable playback surface running in parallel with the Arrangement;
dotbeat deliberately has no such surface, and nothing in this chapter suggests reconsidering that.

## Sources

Ableton Live 12 Reference Manual, chapter 7 "Session View," pp. 172-184 (local PDF extract,
`prior_art/`, gitignored — not a web fetch). Cross-referenced against `docs/research/18-ableton-ui-
architecture.md` (prior, already-settled Session-vs-Arrangement scoping call) and
`docs/research/30-ableton-clip-visualization.md` (prior pass on clip/scene copy semantics and
arrangement-visualization gaps). dotbeat source read directly this pass: `src/core/document.ts`
(`BeatClip`, `BeatScene`, `BeatSongSection`, `BeatTimeSignature`, `BeatClipLoop`, `bpm`, lines
440-570, 741), `src/core/edit.ts` (`setSong`, `songMove`, lines 999-1014), `src/daemon/daemon.ts`
(`songAppend`, `sceneFromLiveContent`, lines 200-230), `ui/src/components/ArrangementView.tsx`
(group-collapse row logic and `GroupHeaderRow`, lines 1109-1170, 1355-1453), `docs/decisions.md`,
`docs/product-roadmap.md`.
