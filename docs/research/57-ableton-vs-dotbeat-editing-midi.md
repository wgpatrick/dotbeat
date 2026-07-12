# Research 57 — Ableton Live 12 vs dotbeat: MIDI note editing, feature/UI comparison

*2026-07-12. Direct follow-on to `docs/research/38-ableton-editing-midi.md` (which already mined
Ableton Live 12 Reference Manual chapter 10, "Editing MIDI," pp.237-277, for documented behavior).
That pass was a grounded primer; this one is a structured, decisive feature/UI comparison against
dotbeat's actual note editor, cross-checked against 20 of the chapter's own rendered screenshots
(not just its text) so every claim about panel layout, control shape, and default values is
verified against what the manual actually shows, not just what it says.*

**Sources**: Ableton Live 12 Reference Manual ch.10, cited `[manual p.NNN]`, both the
`pdftotext -layout` extract and 20 rendered page images
(`p-237/239/241/243/245/247/249/251/253/255/257/259/261/263/265/267/269/271/273/275.jpg`) read
directly this pass. dotbeat: `ui/src/components/NoteView.tsx` (full, 1304 lines) and
`src/core/edit.ts` (full, 1313 lines) read directly this pass; `docs/research/38-...md`'s own
`document.ts`/`pitchtime.ts`/`humanize.ts`/`chance.ts` citations are reused where noted, since
that pass read those files directly and this session didn't need to re-verify unchanged code.
Grounded also against `ROADMAP.md`, `docs/decisions.md`, `docs/product-roadmap.md` (current status
as of 2026-07-12 — 92 features tracked, 64 done).

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

- **Grid snapping with a freehand bypass modifier.** Ableton: "the grid acts as if it is
  magnetic... snap to grid lines rather than move freely," bypassed with Alt/Cmd, which also
  works in reverse if the grid is off [manual p.241]. dotbeat: `snapStep()`
  (`ui/src/components/NoteView.tsx:186-188`) snaps to the nearest whole 16th step by default,
  bypassed on Alt/Cmd. Genuine behavioral difference noted already by research 38: Ableton's curve
  is "free until the first grid line, then snapped"; dotbeat's is a plain round-to-nearest. Not
  worth chasing (see §2).
- **Add / move / resize / delete via direct manipulation.** Ableton: double-click or Draw Mode to
  add, drag to move/resize, double-click (Draw Mode off) or click-then-`0`/delete to remove
  [manual p.242-243, 247-248]. dotbeat: `onGridPointerUp` (add, `NoteView.tsx:363-383`),
  `startGesture`/`onPointerMove`/`onPointerUp` (move/resize, `NoteView.tsx:386-461`),
  `deleteEvent` (`NoteView.tsx:463-467`, also on double-click).
- **Multi-select: click, shift-click, marquee, select-all.** Ableton: click, shift-click to
  add/remove, marquee-drag, `Ctrl/Cmd+A` [manual p.244-245]. dotbeat: `toggleSel`, marquee
  (`onGridPointerMove:337-361`), `Ctrl/Cmd+A` handler (`NoteView.tsx:575-579`).
- **Keyboard nudge and resize.** Ableton: arrow keys move (grid-snapped), `Shift+arrow` resizes,
  `Shift+Up/Down` = octave [manual p.247-248, 253]. dotbeat: the same four-way behavior in the
  `onKey` handler (`NoteView.tsx:589-625`), including the octave-jump on `Shift+Up/Down` via
  `axis.octaveRows`.
- **Rigid-body group move, clamped at selection edges.** Ableton moves a multi-note selection as
  one block and stops at whichever note first hits a boundary [manual p.247, implicit in the
  drag model]. dotbeat: `clampGroupMove` (`NoteView.tsx:316-322`) — confirmed correct by research
  38.
- **Velocity lane: drag-to-edit, numeric readout, per-note markers.** Ableton: the Velocity
  Editor lane, click-drag a marker, numeric value shown [manual p.262-263, screenshot p.263].
  dotbeat: the `noteview-vel-lane` block (`NoteView.tsx:996-1024`), `startVelocityGesture`/
  `onVelPointerMove`/`onVelPointerUp` (`NoteView.tsx:632-658`).
- **Per-note probability (chance) editing, 0-100%, with an at-a-glance glyph on low-probability
  notes.** Ableton: the Chance Editor lane, a small triangle glyph on notes below 100% [manual
  p.266-267, screenshot p.267]. dotbeat: the `chance` field
  (`src/core/edit.ts:154` field regex; `NOTE_FIELD_DEFAULTS`), the dimmed/dashed `.chancy` glyph
  (`NoteView.tsx:945-946, 953`).
- **Pitch & Time one-shot batch operations: Transpose, ×2/÷2 stretch, Fit to Scale, Invert,
  Reverse, Legato.** Ableton's Pitch and Time Utilities panel [manual p.252-260, screenshots
  p.253-259] vs. dotbeat's `PitchTimePanel` (`NoteView.tsx:1105-1223`), backed by
  `src/core/pitchtime.ts` (confirmed shipped and GUI-wired by research 38). Semantics match closely
  — e.g. Ableton's Invert explicitly *not* the same as Invert Selection [manual p.254] is preserved
  in dotbeat's own doc comments per research 38.
- **Humanize as a one-shot op with an Amount control.** Ableton: a single Amount-percent slider,
  start-time jitter only [manual p.258, screenshot p.259]. dotbeat: `humanize()`
  (research 38's citation: `src/core/humanize.ts:62-90`), exposed as a button in the same panel.
  dotbeat's version is *broader* (see §1c) but the basic "one slider, one Humanize button" surface
  is shared.
- **Quantize as a concept exists identically at the core-model level** — grid size + partial
  `amount` (0..1) + independent starts/ends snapping, matching Ableton's Quantize MIDI Tool +
  Amount slider almost field-for-field [manual p.261-262]. dotbeat: `quantizeNotes`
  (`src/core/edit.ts:390-466`), fully wired to `beat quantize` (CLI) and `beat_quantize` (MCP).
  **This is core-model parity only** — see §1b/§2 item 1 for the real gap (zero GUI affordance).

### b) In Ableton, not in dotbeat

Ordered roughly by how load-bearing the gap is for a working musician, not by diff size. Every
row below was checked against `NoteView.tsx` and `edit.ts` in full; "missing" means no primitive
exists in `src/core/edit.ts`/`pitchtime.ts` AND no GUI affordance, unless noted otherwise.

1. **GUI Quantize — zero affordance despite a complete backend.** `quantizeNotes`
   (`src/core/edit.ts:390-466`) is a faithful port of Ableton's model (grid, `amount`,
   independent starts/ends, per-id scoping) and is fully wired through `beat quantize`/
   `beat_quantize`, but grepping `NoteView.tsx` confirms no button, shortcut, or panel control
   calls it. Ableton dedicates *four* distinct entry points to quantize — record-time,
   drag-to-grid, the dedicated Quantize MIDI Tool panel, and `Ctrl/Cmd+U` which just runs the
   tool's current settings [manual p.261-262] — more surface area than any other single operation
   in the chapter. (Already the headline finding of research 38; restated here because it's still
   the sharpest gap after cross-checking the screenshots.)
2. **Copy / duplicate notes — no primitive at all.** Ableton: `Ctrl/Option`-drag copies instead of
   moving, and the copy-modifier can be added *mid-drag* after a plain move has already started;
   standard Cut/Copy/Paste pastes at the insert marker [manual p.247]. dotbeat: a full read of
   `edit.ts` finds `addNote`/`removeNote` but no duplicate-in-place or clipboard concept anywhere,
   and `NoteView.tsx`'s `startGesture` only ever calls `commitMove` (a move), never a copy variant.
   This wasn't called out in research 38 (which focused on Split/Chop/Join) — it's a distinct,
   more basic gap: dotbeat's piano roll cannot duplicate a note or phrase today without manually
   re-typing coordinates via the CLI.
3. **Split / Chop / Join for MIDI notes.** [manual p.250-252, screenshot p.251 for Chop].
   `edit.ts` has `splitAudioClip` (`edit.ts:1271`) for *audio* regions only — no equivalent exists
   for `note`/`hit` lines. (Confirmed by research 38, restated with the Chop screenshot as direct
   visual confirmation of the "N equal grid-aligned parts" semantics — distinct from Split's
   single arbitrary cut point.)
4. **Clip-level time-structure operations.** Crop Clip / Crop to Time Selection, Duplicate Time /
   Delete Time / Insert Time (whole-clip-timeline edits, distinct from ordinary note Cut/Copy/
   Paste), and the loop-brace-double shortcut (`Ctrl/Cmd+D`: doubles loop length, duplicates
   contained notes, shifts everything after) [manual p.272-274, screenshots p.273/275]. No dotbeat
   equivalent — today, "make room for 4 bars in the middle of a clip" requires manually re-typing
   every affected note/hit's `start` via the CLI.
5. **Probability groups (Play All / Play One).** [manual p.267-269, screenshot p.269 showing the
   diamond/triangle group markers and the Group/Ungroup toolbar row]. A genuinely different
   primitive from independent per-note chance: N notes linked to one shared roll, either "all fire
   together" or "exactly one fires, weighted." No dotbeat analog — `chance.ts`'s `chanceFires` is
   per-note only. This is a **format-level** gap, not just GUI (needs a new `BeatNote` field, e.g.
   `probGroup`/`groupMode`, plus scheduler and parser/serializer changes).
6. **Velocity Randomize / Ramp / Deviation.** [manual p.263-265, screenshots showing all three
   sliders live in the Velocity Editor's control row]. Confirmed by the screenshots: these are not
   buried settings, they're three always-visible sliders (`Randomize [amount]`, `Ramp [start]
   [end]`, `Deviation [range]`) directly under the lane. dotbeat has the *mechanisms* for two of
   the three (`humanize.ts`'s seeded jitter ≈ one-shot Randomize; `chance.ts`'s per-pass reroll
   model is architecturally exactly what Deviation needs) but neither is wired to `velocity`, and
   Ramp (linear interpolation across a selection) has no dotbeat mechanism at all yet.
7. **Absolute Note Duration / Fit to Time Range.** [manual p.247-248, 257, screenshot p.257]: a
   "Duration" dropdown + "Set Length" button sets every selected note to an *exact* length, and
   Fit to Time Range stretches selected notes to exactly fill a time selection. dotbeat's
   `timeScaleNotes` (×2/÷2 buttons in `PitchTimePanel`) is *relative* stretch only — no
   dotbeat op sets an absolute target length or range.
8. **Continuous Stretch factor + in-grid MIDI Note Stretch handles.** Two distinct Ableton
   features worth separating: (a) the Pitch and Time Utilities panel's **Stretch dial**
   [manual p.256, screenshot p.257] is a continuously-variable factor (`×1.0` shown in the
   screenshot, with dedicated ×2/÷2 buttons as shortcuts *on top of* the dial) — dotbeat's panel
   has only the ×2/÷2 buttons, no continuous factor input. (b) **MIDI Note Stretch**
   [manual p.248-249, screenshot p.249] is a separate in-grid gesture: drag handles appear below
   the scrub area on a multi-note/timespan selection, with a "pseudo" third handle for
   sub-range compression and the documented "drag one handle past the other to mirror note order"
   behavior. dotbeat has neither the continuous dial nor the in-grid handles.
9. **Deactivate/mute a note (third state).** [manual p.249]: `0` mutes a note in place — grayed
   out, doesn't play, stays in the clip — a distinct state from active/deleted. dotbeat's
   `removeNote`/`postEdit` with an empty value only ever deletes; there's no "keep it but silence
   it" state.
10. **Draw Mode as a persistent tool, plus pitch-locked drawing.** [manual p.242-243, screenshot
    p.243]: a dedicated toggle (button or `B`) that changes what a plain drag does — continuous
    freehand painting of new notes under the pointer, or (with Alt/Option) pitch-locked drawing
    that constrains an entire drag to one pitch/lane (called out as useful for hi-hat-style
    repeated patterns). dotbeat has click-to-add and a freehand-*placement* modifier
    (Alt/Cmd bypasses grid-snap, not a paint-many-notes mode), but no continuous "drag across
    empty grid to lay down a run of notes" gesture, and no pitch-lock variant.
11. **Find and Select Notes — a saved, adjustable filter/query system.** [manual p.245-247]: eight
    independently-combinable filter types (Pitch, Time, Chance, Condition, Count, Duration, Scale,
    Velocity), each with its own Invert toggle and re-applicable Select button — "select every
    third snare below 80% velocity" as a first-class, revisitable query, not a one-off marquee.
    dotbeat has no equivalent; today the only way to build such a selection is a manual marquee or
    shift-click sequence.
12. **Fold to Notes, Scale Mode, Fold to Scale, Highlight Scale, note-spelling preference.**
    [manual p.269-272, screenshots p.271]. Already tracked in `docs/product-roadmap.md` as two
    ⬜-status rows ("Fold mode", "Scale-lock field + scale-tone highlighting") — this pass confirms
    both are real gaps and adds texture the roadmap row doesn't have: it's a *layered* feature
    (persistent per-clip root+scale storage → piano-ruler highlight → grid-row highlight → a
    separate Fold-to-scale toggle that never hides a track that already has notes on it), not one
    flag, plus an independent flats/sharps/auto/MIDI-number spelling preference (screenshot
    p.271's context menu) that only affects out-of-scale notes once Scale Mode is on.
13. **Insert-marker point-in-time + explicit timespan selection, independent of note selection.**
    [manual p.244-245]: a movable "insert marker" (arrow-key point-in-time cursor, snaps to grid
    or, with a modifier, to the next *note boundary*) and a genuine timespan selection distinct
    from "the notes inside it," with `Enter` toggling between the two. dotbeat's selection model
    is note-id-based only (`editNoteIds`) plus an ephemeral marquee rectangle during a drag — there
    is no persistent time-range selection a user can leave active and re-target with a later
    operation, and no insert-marker concept at all (dotbeat's Pitch & Time ops already default to
    "whole track" when nothing is selected, which covers *some* of this need, but not an explicit
    sub-range with nothing selected inside it).
14. **Rich zoom/navigation affordances.** [manual p.239-241, screenshot p.241]: drag-to-zoom
    directly in the time/note rulers, a clip-overview minimap, `+`/`-`/`Z` (zoom to selection)/`X`
    (zoom to full clip), `PageUp`/`PageDown` (±octave). dotbeat's `NoteView` has a fixed
    `--note-step-w` driven by container width and no dedicated zoom controls or minimap at all.
15. **Preview switch doubling as step-record when the track is armed.** [manual p.243]: with
    Preview on and the track armed, adding/moving notes triggers live audition, and the same state
    enables step-recording new notes during playback. dotbeat has `axis.preview` (click a
    key/lane to audition it) and a track-level "▶ Preview clip" audition button
    (`NoteView.tsx:736-751`), but no armed/step-record concept — consistent with dotbeat's
    file-diff-per-edit architecture rather than a live-input model (see §2's rationale).
16. **Multi-clip editing (up to 8 clips) + Focus Mode.** [manual p.274-277, screenshots p.275]:
    view/edit several clips simultaneously (Session or Arrangement-ordered), each with its own
    color-coded loop bar, `N`/hold-`N` Focus Mode to narrow to one while dimming the rest. dotbeat
    has no Session-grid concept and `NoteView` only ever renders one track's content at a time —
    already flagged out-of-scope by research 38.

### c) In dotbeat, not in Ableton

Scoped to chapter 10's documented Note Editor — claims below are "not documented in this chapter,"
not a blanket claim about all of Ableton (e.g. Ableton's Groove Pool is real and well-known, it's
simply out of ch.10's scope, so it's *not* listed as a dotbeat-exclusive here).

- **Humanize is strictly broader than Ableton's documented version.** Ableton's Humanize panel is
  one Amount-percent slider, start-time jitter only [manual p.258]. dotbeat's `humanize()`
  independently controls timing jitter, velocity jitter, a constant behind-the-beat drag
  ("pushLate"), and swing, all under one reproducible seed (research 38's citation:
  `src/core/humanize.ts:62`) — a genuine capability advantage on a feature both tools ship.
- **The chance lane supports a draw-across-notes paint gesture; Ableton's documented Chance Editor
  is drag-one-marker-at-a-time.** `onChanceLanePointerMove`/`paintChanceAt`
  (`NoteView.tsx:668-711`) re-evaluates which note is under the pointer on every move, so one
  continuous drag sets probability across many notes in one gesture — the chapter's Chance Editor
  section describes only per-marker click-drag/typed-entry/arrow-key editing [manual p.266-267],
  with no draw-across behavior documented for chance (Draw Mode's paint gesture is documented only
  for the *velocity* lane [manual p.265-266]).
- **Per-note ratchet (repeat) with a shaped curve and gate length is not documented anywhere in
  this chapter.** dotbeat's `ratchetCount`/`ratchetCurve`/`ratchetLength` (3-field shape,
  scheduled live in `ui/src/audio/engine.ts` and bakeable to discrete notes via the panel's
  "Consolidate" button, `NoteView.tsx:1207-1214`) has no chapter-10 analog — Ableton's Note Repeat
  is a separate, live-performance-triggered feature, not a stored per-note clip field.
- **Per-note micro-tuning (cent offset) independent of semitone pitch** — no equivalent field is
  documented in this chapter (Ableton's per-note pitch-bend-style tuning lives in the separate MPE
  Editor tab, a different mechanism gated on MPE-capable devices). dotbeat exposes `cent` directly
  in the per-note inspector (`NoteInspector`, `NoteView.tsx:1261-1296`) for any synth-track note.
- **"Place in Arrangement" and "Preview clip" solve a dotbeat-specific architecture problem that
  doesn't exist for Ableton.** Because an Ableton MIDI clip is always already slotted into a
  Session or Arrangement track, chapter 10 never needs a "make this audible/placed" affordance —
  the clip already is both. dotbeat's note editor can be opened on a track's *live* (unplaced)
  content, so `placeInArrangement` (`NoteView.tsx:542-553`) and the audition-independent-of-song-
  position button (`NoteView.tsx:736-751`, engine's `auditionClip`) are dotbeat-only UX, not a
  feature Ableton is missing so much as a problem Ableton's model doesn't have in the first place.
- **Every edit is one canonical, git-diffable line — the meta-advantage underneath all of the
  above.** Every gesture in `NoteView.tsx` (move, resize, velocity drag, chance paint, quantize,
  the whole Pitch & Time panel) round-trips through `postEdit`/`postPitchTime` to a single
  `<track>.note.<id>.<field>` line in `.beat` (`src/core/edit.ts`'s note grammar,
  `edit.ts:139-184`). Ableton has no analog to cite here — it's not a documented chapter-10
  feature at all, it's dotbeat's entire premise (`ROADMAP.md` §4, `docs/decisions.md` D4/D8) —
  included because it's the lens every gap above should be read through: a new dotbeat feature is
  "done" only once it's *also* a clean one-line diff, which is a real, if invisible, constraint
  Ableton's engineers never had to satisfy.

---

## 2. Prioritized recommendations

For every item in §1(b). Priority is decisive: **P0** = highest-leverage/cheapest, do next; **P1**
= real value, real cost, worth a scoped stream soon; **P2** = real but smaller value or bigger
lift, sequence after P0/P1; **Do-not-recreate** = the gap is real but building it would fight
dotbeat's own architecture or product bet, not just cost effort.

| # | Feature | Priority | Build recommendation |
|---|---|---|---|
| 1 | GUI Quantize | **P0** | Add a Quantize control group to `PitchTimePanel` (`ui/src/components/NoteView.tsx:1105-1223`): grid-size dropdown, `amount` slider (0-100%), starts/ends checkboxes. Extend the daemon's `POST /pitch-time` route (`bridge.ts`'s `PitchTimeOp` union) with a `quantize` op that calls `quantizeNotes` (`src/core/edit.ts:390-466`) directly — the function already takes exactly this shape (`grid`, `amount`, `starts`, `ends`, `noteIds`). No new core primitive, no new format field. This is the single cheapest, highest-value item in this whole doc. |
| 2 | Copy / duplicate notes | **P0** | Add a new `copyNotes`/`duplicateNotes` primitive to `src/core/edit.ts` (thin wrapper around the existing `addNote`, minting fresh ids, offsetting `start` by a caller-given delta) alongside `removeNote`. In `NoteView.tsx`, extend `startGesture`'s move gesture: when `e.altKey`/`e.metaKey` is held at drag-start (mirroring the existing `freehand` modifier check pattern already used for grid-snap bypass), commit via the new duplicate primitive instead of `commitMove` on pointer-up — matches Ableton's "hold the modifier, drag copies instead of moves" model [manual p.247] with minimal new state. A basic `Ctrl/Cmd+C`/`Ctrl/Cmd+V` clipboard (store the selected notes' data in a module-level ref, paste at the insert step or old position + offset) can reuse the same primitive. |
| 3 | Split / Chop / Join (MIDI notes) | **P1** | New functions in `src/core/pitchtime.ts` (same file/shape as the six shipped ops): `splitNoteAt(doc, trackId, atStep, noteIds?)`, `chopNotes(doc, trackId, parts, noteIds?)`, `joinNotes(doc, trackId, noteIds)`. Chop should reuse `ratchetSlots`' spacing math (already proven via `consolidateRatchet`, `NoteView.tsx:1207-1214`) to place the N equal parts — it's the same "divide one note into N discrete notes" operation Consolidate already performs, just parameterized by a chosen N instead of `ratchetCount`. Wire into `PitchTimePanel` as three more buttons, same `run()`/`postPitchTime` pattern as the existing six. |
| 4 | Clip-level time-structure ops (Crop/Duplicate/Delete/Insert Time) | **P1** | New whole-clip-timeline primitives in `edit.ts`: given a cut/insert point and span, shift every `note.start`/`hit.start` on the track by the span (research 38's own framing: "add K to every start >= cut point" — mechanically straightforward given notes/hits already store literal `start` positions, not references). Needs a `loopBars`-aware clamp (can't insert past the loop length without also growing `loopBars`, which already has its own `setValue` path). Surface as toolbar buttons above the grid, next to the existing bar-line ruler. |
| 5 | Velocity Randomize / Ramp / Deviation | **P1** | Three separate builds, deliberately not one: (a) **Randomize** — a pure one-shot function in a new `velocityOps.ts` (or alongside `pitchtime.ts`) that jitters each selected note's `velocity` by ±amount, committed via the existing `<track>.note.<id>.velocity` `postEdit` path — cheapest of the three, no new field. (b) **Ramp** — linear interpolation of `velocity` across selected notes ordered by `start`; also a pure function, also no new field. (c) **Deviation** — needs a new `BeatNote` field (e.g. `velocityRange: number`, signed, canonically elided at 0) plus a per-pass reroll in the scheduler; this is architecturally identical to `chance.ts`'s `chanceFires` model (`src/core/chance.ts`, applied in `engine.ts`) — copy that pattern rather than inventing a new one. Ship (a)/(b) first (cheap, no format change); scope (c) as its own small format-spec addition. |
| 6 | Absolute Note Duration + Fit to Time Range | **P2** | New `setNoteDuration(doc, trackId, duration, noteIds?)` and `fitToTimeRange(doc, trackId, startStep, endStep, noteIds?)` in `pitchtime.ts`, same shape as the shipped six. Small, cheap, but lower musician-facing value than items 1-5 — sequence alongside item 3 if a Pitch & Time-panel stream is already in flight, per research 38's own note. |
| 7 | Continuous Stretch factor + in-grid Note Stretch handles | **P2** | Split the ask: replace `PitchTimePanel`'s fixed ×2/÷2 buttons with a numeric factor input (or a slider) feeding the *already-shipped* `timeScaleNotes` (just generalize the caller, not the core function — ×2/÷2 remain as quick-preset buttons alongside it, matching Ableton's own screenshot which shows the dial *and* the two buttons together [manual p.256-257]). The in-grid drag-handle gesture (b) is a materially bigger, more speculative UI build (new pointer-gesture class, a "pseudo third handle," mirror-on-cross behavior) — defer it independently; the panel-based version captures most of the value. |
| 8 | Deactivate/mute note (third state) | **P1** | Add `active: boolean` to `BeatNote` (default `true`, canonically elided — same discipline as every other v0.10 optional field, see `document.ts`'s `NOTE_FIELD_DEFAULTS` pattern research 38 cites). New `setValue` path `<track>.note.<id>.active`. In `NoteView.tsx`, reuse the existing `.chancy` dimmed-rendering CSS treatment (`NoteView.tsx:945-953`) for `active === false`, bind to the `0` key in the existing keyboard handler (`NoteView.tsx:559-629`) next to the Delete/Backspace case. Research 38 already scoped this as "small, low-risk" — confirmed here as genuinely cheap given the dimming CSS already exists for a different field. |
| 9 | Draw Mode toggle + pitch-locked drawing | **P2** | A new interaction mode flag (component state, not a format field) toggled by a toolbar button or `B` key. While active, `onGridPointerMove` (currently marquee-only) would also paint new notes at the row/step the pointer crosses when the button is held down on empty grid, via the existing add path (`onGridPointerUp`'s `postEdit(...note", ...)` call, `NoteView.tsx:377-382`) fired per-cell instead of once. Pitch-lock is a one-line addition: freeze `row` to the value at gesture-start when Alt/Option is held. Medium priority — dotbeat's existing click-to-add is already low-friction for sparse edits; this mainly helps rapid repeated-pitch patterns (e.g. hi-hats on a melodic track), a narrower use case than items 1-5. |
| 10 | Find and Select Notes (8-filter query system) | **P2** | The biggest single UI build in this list — a filter-builder panel (Pitch/Time/Chance/Condition/Count/Duration/Scale/Velocity, each with Invert + Select) that computes a note-id set and calls the existing `setSel`/`editNoteIds` store setter (`NoteView.tsx`'s `sel`/`setSel`, already the same selection surface every other op reads). Each filter is a pure predicate over `EditorEvent[]` (`NoteView.tsx:144-156`) — the hard part is the panel UI/UX (8 independently-combinable filters, live-updating), not the underlying selection mechanism, which already exists. Sequence after the more mechanical P0/P1 items; this is a genuinely new, larger surface. |
| 11 | Fold to Notes / Scale Mode / Fold to Scale / Highlight Scale / spelling preference | **P1** | Already scoped at the roadmap level (`docs/product-roadmap.md`'s "Fold mode" and "Scale-lock field + scale-tone highlighting" rows, research `18-ableton-ui-architecture.md`). Concretely: Fold to Notes is close to free given the row-axis abstraction already in place — a derived `rows` list filtering `buildPitchAxis`'s full range down to only pitches with `>=1` note (`NoteView.tsx:93-119`), no format change. Scale Mode is the bigger piece — needs a persistent per-clip `root`/`scale` (new `BeatClip` fields), piano-ruler highlight logic in the `noteview-keys` render block (`NoteView.tsx:793-864`), and a `Fit to Scale`-adjacent "Fold to Scale" filter over the same derived-rows mechanism Fold to Notes uses. Recommend shipping Fold to Notes first (cheap, high legibility win on drum tracks especially) and Scale Mode as its own follow-on stream. |
| 12 | Insert-marker + explicit timespan selection | **P2** | Narrower than it sounds once scoped: dotbeat's Pitch & Time ops already default to "whole track" when nothing is selected (`NoteView.tsx`'s own comment, line ~1083), which covers the *implicit* timespan case. The real gap is an explicit, left-active *sub-range* selection (e.g. "bars 3-5") a user can leave set and re-target with more than one operation without re-selecting notes each time. Lower priority than the P0/P1 items — dotbeat's agent-native editing model (CLI/MCP `noteIds`/`--notes` scoping) already gives an agent this capability without a GUI insert-marker concept; the GUI gap is real but has a working non-GUI escape hatch today, unlike items 1-2. |
| 13 | Rich zoom/navigation (drag-to-zoom rulers, minimap, Z/X, PageUp/Down) | **P2** | A real but purely-UX gap — no format or core-model change, all `NoteView.tsx`-local (a zoom-factor state driving `--note-step-w`, a small minimap component, keyboard bindings alongside the existing `onKey` handler). Worth doing once clips routinely exceed the visible width in practice; not urgent relative to the editing-primitive gaps above. |
| 14 | Preview switch doubling as step-record | **Do-not-recreate** | dotbeat's editing model is deliberately non-realtime and file-diff-per-edit (`docs/decisions.md` D4/D8) — a live step-record loop while a track is "armed" is a recording-input concept, and `ROADMAP.md` §6/`docs/product-roadmap.md`'s "Native audio recording" row already gates any real-time-input work behind the confirmed ~30ms web-audio latency wall and Tauri/M4-native scope. Building a step-record affordance now would either (a) be a toy that doesn't actually solve latency-sensitive input, or (b) require pulling M4-native forward for a MIDI-editor nicety. dotbeat's click-to-preview (`axis.preview`) and "Preview clip" (`NoteView.tsx:736-751`) already cover the *audition* half of this feature; the *input* half should wait for M4. |
| 15 | Multi-clip editing (up to 8 clips) + Focus Mode | **Do-not-recreate** | Requires a Session-grid concept (ordered-by-track-and-scene simultaneous clip view) that doesn't exist in dotbeat's architecture and isn't scoped anywhere in `docs/product-roadmap.md` or `ROADMAP.md` — dotbeat's arrangement model is a single linear song timeline (D4, `docs/phase-19-arrangement-length.md`), not parallel Session slots. Building this would mean inventing a second, competing arrangement paradigm for one editing convenience. If multi-track comparison ever becomes a real need, the cheaper dotbeat-native answer is more likely "open two `NoteView` panes side-by-side" than an Ableton-style Session-grid port — but that's a different, unscoped feature, not this one. |
| 16 | Probability groups (Play All / Play One) | **P2** | Real value, real format cost — flag as its own `docs/decisions.md` entry before building, per research 38. Needs: a new `BeatNote` field (e.g. `probGroup: string \| undefined`, `groupMode: 'all' \| 'one'` stored once per group, most naturally keyed by group id rather than duplicated per note), a scheduler change in `ui/src/audio/engine.ts` (today's `chanceFires` per-note reroll needs a group-aware variant — roll once per group per pass, not once per note), and parser/serializer support. Sequence after the P0/P1 items — this is the single largest format-level lift in the whole comparison, larger than any GUI-only item. |

### Summary — do-next order

**P0 (do first, both cheap and high-leverage):** #1 GUI Quantize, #2 Copy/duplicate notes.
**P1 (next scoped stream):** #3 Split/Chop/Join, #4 clip time-structure ops, #5 velocity
Randomize/Ramp (Deviation's field addition can trail), #8 Deactivate note, #11 Fold to Notes
(Scale Mode as its own follow-on).
**P2 (real but smaller or bigger, sequence after):** #6 absolute Note Duration, #7 continuous
Stretch, #9 Draw Mode, #10 Find and Select Notes, #12 insert-marker/timespan selection, #13 zoom/
navigation, #16 probability groups (format-level, largest lift here).
**Do-not-recreate:** #14 step-record (fights the file-diff architecture; input latency is M4
scope), #15 multi-clip Session-grid editing (no Session-grid concept exists or is planned).
