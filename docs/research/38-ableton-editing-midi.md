# Research 38 — Ableton Live 12 Reference Manual, Chapter 10 "Editing MIDI" (pp. 237-277)

*2026-07-12. Owner-commissioned, owner-flagged-by-name-as-key parallel research pass: one chapter
of the official 999-page Ableton Live 12 Reference Manual (dropped into `prior_art/`, gitignored)
per chapter, mined for documented behavior relevant to dotbeat's own design/roadmap. This is
research-only — no code was written or modified. Source text is the raw `pdftotext -layout`
extract of just this chapter; page numbers below are the manual's own printed page numbers
(derivable directly from the extract's page-footer markers, chapter starts at p.237).*

## How to read this doc

- **[manual p.NNN]** — read directly from the chapter text this pass, cited to the manual's own
  page number. High confidence; this is the primary source, not a secondary paraphrase.
- **[dotbeat]** — read directly from this repo's current source this pass (`ui/src/components/
  NoteView.tsx`, `src/core/edit.ts`, `src/core/pitchtime.ts`, `src/core/humanize.ts`,
  `src/core/chance.ts`, `src/core/document.ts`), cited with exact file:line so a follow-up stream
  can jump straight to the code.

## 0. Why this chapter matters for dotbeat specifically

`ui/src/components/NoteView.tsx` is dotbeat's single shared MIDI/drum editor (piano roll +
step/lane grid, generalized behind a row-axis abstraction in Phase 22 Stream AB) — genuinely one
of the most actively-evolving surfaces in the GUI, having grown a velocity lane, a chance-paint
lane, a Pitch & Time panel, a clip-loop resize handle, and a "Place in Arrangement" button across
Phases 16-24. Chapter 10 is Ableton's own documentation of the *exact same surface* — the "MIDI
Note Editor" — described at a level of mechanical detail (which modifier does what, what a drag
does before vs. after crossing a grid line, what a keyboard shortcut nudges) that a screenshot or
a marketing page never captures. This is the single most load-bearing chapter of the whole prior-
art drop for comparing dotbeat's actual editing feature set against Ableton's documented one,
feature-by-feature rather than impression-by-impression.

## 1. The MIDI Note Editor's layout and navigation model

**Layout** [manual p.237-239]: one shared editor (three tabs: Notes, Envelopes, MPE), reached via
Clip View. The Notes tab has: a time ruler (horizontal), a note ruler + piano-key strip
(vertical), the note grid itself, and — critically — **Velocity and Chance Editor lanes below the
grid, individually resizable, toggleable, and swappable**, plus a **Find and Select Notes**
filter toggle above the time ruler and **grid settings** in the header.

**Zoom/navigation** [manual p.239-241]: drag-to-zoom directly in the rulers (vertical drag in the
time ruler = zoom time; horizontal drag in the note ruler = zoom key tracks), a dedicated
clip-overview minimap in the corner, keyboard zoom (`+`/`-`, `Z` = zoom to selection, `X` = zoom
to full clip), and `PageUp`/`PageDown` (± octave) / `Shift+PageUp/Down` (± one key track) for
vertical navigation. None of this is unique to MIDI editing — it's Ableton's general "every
timeline gets rich zoom affordances" pattern — but it's worth noting as a *documented, deliberate*
feature set, not incidental.

**Grid snapping** [manual p.241] is described with real mechanical precision: "the grid acts as if
it is magnetic — when you first move a note, it will move freely up to the first grid line you
encounter and afterwards, if you continue to drag the note, it will snap to grid lines rather than
move freely." Notes also snap to their own **original offset from the grid**, not just the grid
itself — explicitly framed as "useful for preserving a groove... you do not necessarily want to
sound too quantized." Bypass: `Ctrl/Cmd 4`, the grid-settings button, or holding Alt/Cmd during a
drag (which also *toggles the opposite way* if grid is off).

## 2. Adding notes — Draw Mode

**Two ways to add notes** [manual p.242]: double-click a location, or draw with the mouse while
**Draw Mode** is active (toggle button or `B` key). Draw Mode has real, specific behavior worth
naming: clicking an *existing* note while in Draw Mode **deletes it**; there are two drawing
flavors — freehand melodic drawing (drag paints any pitch under the cursor) and **pitch-locked**
drawing (a preference, or the Alt/Option modifier as the momentary opposite) that constrains an
entire drag to one pitch, useful for rapidly laying in a repeated-note pattern (e.g. a hi-hat part
on a melodic track) [manual p.242-243]. When Draw Mode is *off*, single notes are still added by
double-click, and existing notes are deleted by double-click (not drag-erase) [manual p.243].

**Previewing** [manual p.243]: a Preview toggle that, when the track is armed, doubles as a live
step-record trigger — adding notes while auditioning them, not just after the fact.

## 3. Selection model

Ableton's selection model [manual p.244-245] has three distinct selectable things — a **point in
time** (an insert marker, moved with arrow keys, snapping to grid; `Ctrl/Option+arrow` jumps to
the next *note boundary* specifically, not just the next grid line), a **timespan** (click-drag,
or `Shift+arrow` from the insert marker), and **individual notes** (click, shift-click to
add/remove, shift-click a piano-ruler key to select/deselect a whole key track's worth of notes at
once). `Enter` toggles between "the timespan is selected" and "the notes inside the timespan are
selected" — a deliberately reversible distinction between "I selected a time range" and "I
selected the notes that happen to live there." `Ctrl/Cmd+Shift+A` inverts the selection (a genuine
command, separate from the *pitch*-inverting "Invert" tool covered in §6 — the manual explicitly
flags this as a common confusion, p.254).

**Find and Select Notes** [manual p.245-247] is a real filter/query system, not just a selection
gesture: eight independently-combinable filter types — **Pitch, Time, Chance, Condition (Active /
has-Chance / has-Velocity-Deviation), Count (every Nth note/chord, with an Offset and a
grid-quantized grouping mode), Duration, Scale, Velocity** — each with an **Invert** toggle and a
**Select** re-apply button. This is Ableton's answer to "select every third snare that's below
80% velocity" as a first-class, saved, adjustable query rather than a one-off marquee.

## 4. Moving, resizing, splitting, joining notes

**Move** [manual p.247]: drag or arrow keys; `Ctrl/Option`-drag copies instead of moving, and — a
nice detail — **you can add the copy-modifier mid-drag**, after starting a plain move, and it
retroactively becomes a copy. Overlap rule: a new/moved note dropped onto an existing one at its
*start* overwrites the original; dropped onto its *end*, it shortens the original rather than
deleting it (partial, not destructive, overlap resolution).

**Resize** [manual p.247-248]: drag an edge (grid-snapped past the first free step, same magnetic
behavior as move), or `Shift+arrow` from the keyboard. **Fit to Time Range** (`Ctrl/Cmd+Option+J`)
stretches every selected note's start/end to exactly match the current time/note selection — a
one-shot "make these notes fill this box" op with its own toolbar button in the Pitch and Time
Utilities panel.

**MIDI Note Stretch** [manual p.248-249] deserves its own mention: selecting multiple notes or a
timespan surfaces a **pair of drag handles below the scrub area** that proportionally stretch/
compress everything between them (with a third, "pseudo" handle appearing wherever the mouse sits
*between* the two fixed ones, for compressing/expanding just a sub-range without touching material
outside it). One handle can be dragged past the other, which **mirrors the note order** — a
real, if esoteric, editing move. This also propagates to any *linked* clip envelopes.

**Deactivating notes** [manual p.249]: `0` mutes a note in place (grayed out, doesn't play, stays
in the clip) rather than deleting it — a distinct third state (active / inactive / absent) that
none of the other three operations below approximate.

**Split** [manual p.250]: hold `E`, drag a line across notes to cut them at that point (optionally
grid-snapped with Ctrl/Cmd); or, with nothing selected, `Ctrl/Cmd+E` splits every note crossing the
insert marker or spanning past the current time selection.

**Chop** [manual p.250-251]: divides notes into N equal parts based on the grid — via keyboard
(`Ctrl/Cmd+E` then hold `Ctrl/Cmd` + up/down arrow to change the part count, `+Shift` for
power-of-two steps) or mouse (a modifier chord + vertical drag on a note). This is meaningfully
different from Split: Split cuts at one arbitrary point, Chop subdivides into a *chosen count* of
equal grid-aligned pieces in one gesture — the natural move for turning one long note into a
stutter/roll.

**Join** [manual p.252]: `Ctrl/Cmd+J` merges all selected same-pitch notes into one note spanning
their combined range — explicitly documented to preserve and merge MPE envelope content too.

## 5. Pitch and Time Utilities panel

A dedicated panel [manual p.252-260] of one-shot batch operations, scoped to the current selection
or (if nothing is selected) the whole clip:

- **Transpose** [p.253] — a slider, semitones or scale degrees if a clip scale is active; also
  directly on the up/down arrow keys (Shift+up/down = octave).
- **Fit to Scale** [p.253] — snaps every note to the nearest degree of the clip's active scale
  (ties round down); grayed out with no scale active.
- **Invert** [p.254] — swaps highest↔lowest, flips everything in between, scale-aware if a scale
  is active. (Distinct from Invert *Selection*, §3 — the manual calls this out explicitly.)
- **Intervals** [p.255] — an "Add Interval" button + size slider that **adds new notes** at a
  fixed offset from the current selection — explicitly framed as "useful for quickly creating
  chords." With a live selection, moving the slider immediately adds and selects the new notes;
  with none, it applies the interval to the *entire clip* on button-press.
- **Stretch** [p.256] — a factor control plus dedicated ×2/÷2 buttons that scale note length
  (distinct from the in-grid Note Stretch markers of §4 — same underlying idea, panel-driven).
- **Note Duration** [p.257] — set an exact length for every selected note in one shot (a
  "Duration" dropdown + "Set Length" button), including a fit-to-time-range mode.
- **Humanize** [p.258] — a single **Amount** percentage that jitters note *start times only*, up
  to a quarter of a grid division either way — deliberately narrow (timing only, no velocity, no
  seed control, no swing/push-late) compared to what a DAW *could* do here.
- **Reverse** [p.259] — swaps first↔last position and flips everything between (tape-reverse of
  the timeline, not per-note pitch); whole clip if nothing selected.
- **Legato** [p.260] — extends/shortens each selected note to exactly reach the next note's start
  (last note extends to the loop end); a dedicated "Span MIDI Tool" (a separate MIDI Tools chapter,
  not detailed here) offers a richer version of the same idea.

## 6. Quantizing

Four distinct routes to quantized timing, all converging on the same underlying grid math [manual
p.261-262]: quantize-on-record, drag-to-grid-directly, the dedicated **Quantize MIDI Tool** (a
"more granular" panel with a settable target division and an **Amount** slider so quantization can
be partial — "without giving them that 'quantized' feel"), and the **Quantize command**
(`Ctrl/Cmd+U`) which simply applies whatever the Quantize MIDI Tool's settings currently are.
Notably, the manual frames the tool's settings and the one-shot command as **the same underlying
state** — opening the tool (`Ctrl/Cmd+Shift+U`) shows you exactly what `Ctrl/Cmd+U` is about to do,
not a separate, disconnected dialog.

## 7. Editing velocities

The Velocity Editor lane [manual p.262-266] is a first-class per-note editing surface, not just a
readout: click-drag a note's velocity marker directly (values shown numerically in the lane
header, with hover-highlighting to help disambiguate stacked markers at the same time position);
`Alt/Cmd`-drag vertically on the note *in the main grid* also changes velocity without opening the
lane at all; typed numeric entry; `Ctrl/Cmd+up/down` for ±10 coarse steps, `+Shift` for fine steps.

**Velocity Controls** [manual p.263-265] below the lane add three generative tools, each worth
naming individually because none of them exist in dotbeat today (§10 below):
- **Randomize** — a button + Randomization Amount slider; velocities move randomly within ±N of
  their current value, applied to selection or (if none) every note.
- **Ramp** — Start/End sliders create a linear velocity gradient across the selected notes (a
  crescendo/decrescendo in one gesture, evenly distributing the notes in between).
- **Velocity Deviation** — a *per-note stored range* (not a one-shot randomize): each time the
  note plays, a fresh random value is drawn from within its stored ±range. This is architecturally
  identical to a per-pass reroll, not a one-time edit — the manual is explicit that multi-note
  selections with different existing velocities produce *different* max ranges per note, shown
  together in one slider.

**Drawing velocities** [manual p.265-266]: Draw Mode also works *inside* the Velocity Editor lane
— dragging paints velocity for every note under the grid division the pointer crosses (scoped to
the current selection if one exists), with `Alt/Cmd`+drag for a straight-line ramp (`+Shift` to
force it horizontal, i.e. "set everything to this exact value").

**Note Off (release) velocity** [manual p.266] gets its own swappable lane (Release Velocity
Editor) — "the speed at which the pressed-down key is released," supported only by certain
devices (Ableton's own Sampler uses it as a modulation source).

## 8. Editing probabilities (Chance) and probability groups

The Chance Editor [manual p.266-269] is architecturally the velocity lane's twin: a 0-100%
per-note marker, click-drag/typed-entry/arrow-key editing (±10 coarse, fine with Shift), a
**Randomization Amount** slider that re-rolls chance within a range relative to each note's
*current* value (not absolute — "if the original was 50% and Randomization Amount is 25%, results
range 25-75%"), and a small on-note triangle glyph indicating "this note is <100% likely to fire."

**Probability groups** [manual p.267-269] are the one mechanic in this chapter with **no dotbeat
analog at all**: selecting several notes and choosing **Play All** (all group members always play
together, gated as one unit by a single shared probability) or **Play One** (exactly one member of
the group is chosen at random each time, weighted by the shared probability) — a genuinely
different primitive from independent per-note chance, useful for e.g. "roll a d4 and only play one
of these four fills." Grouped notes share one visible probability marker (diamond handle = Play
All, triangle handle = Play One); `Ctrl/Cmd+G` re-applies whichever group type was last used,
`Ctrl/Cmd+Shift+G` ungroups.

## 9. Folding, scales, and clip-level structure

**Fold to Notes** [manual p.269-270] (`F` key) hides every key track/lane with zero notes in it —
explicitly framed around drum-kit editing, where only a handful of a full keyboard's worth of pads
are actually used.

**Scale Mode** [manual p.270-272] is a persistent, per-clip setting (root + scale name), toggled
independently of any one-shot Fit-to-Scale *operation* — it drives **piano-ruler highlighting**
(in-scale keys lit up) and, if **Highlight Scales** is separately enabled (`K` key), highlights
the corresponding *key-track rows in the grid itself*, with the root note getting its own
stronger highlight. A related **Fold to Scale** (`G` key) hides every key track outside the active
scale (but never hides a track that already has notes on it, even if they're outside the scale) —
explicitly pitched as a composition aid for users "not confident in your knowledge of music
theory." Note spelling (flats/sharps/both/auto/MIDI-numbers) is a separate piano-ruler preference,
scale-aware when Scale Mode is on (only *out-of-scale* notes are affected by the flat/sharp
choice; in-scale notes keep proper accidentals).

**Clip-level structural edits** [manual p.272-274]: **Crop Clip** deletes everything outside the
loop brace (or outside a time selection, via a separate "Crop to Time Selection"); the **…Time
commands** (**Duplicate Time**, **Delete Time**, **Insert Time**) operate on the *entire clip's
timeline* — duplicating/deleting/inserting a span of time and shifting everything after it,
distinct from the ordinary Cut/Copy/Paste which only ever touches the current note/time selection.
Looping has its own dedicated doubling shortcut, `Ctrl/Cmd+D` on the loop brace, which **doubles
the loop length, duplicates the notes inside it, and shifts everything after the loop point** to
preserve relative position — a single gesture combining loop-resize + content-duplicate that
neither Duplicate Time nor a manual copy-paste replicates exactly.

## 10. Multi-clip editing and Focus Mode

[manual p.274-277] — viewing/editing up to eight MIDI clips simultaneously (Session: ordered by
track then scene; Arrangement: ordered by track and by time), each with its own color-coded **loop
bar** above the grid. **Focus Mode** (`N`, or held momentarily) narrows editing to one active clip
while the others stay visible in gray, dimming everything not currently being worked on — useful
for comparing a variation against its neighbors without losing sight of them. Velocity/Chance lane
edits are explicitly scoped to **one clip at a time even in multi-clip view** — a real, named
limitation the manual states outright rather than leaving ambiguous.

---

## Relevance to dotbeat

`NoteView.tsx` and `src/core/edit.ts`/`pitchtime.ts`/`humanize.ts`/`chance.ts` already implement a
genuinely large fraction of this chapter — more than a first skim would suggest, since Phases
16-24 quietly built most of the mechanically-hard parts (row-axis generalization, grid snap with
freehand bypass, group move/resize, velocity lane, chance-paint lane, six Pitch & Time ops). The
gaps that remain are specific and, in a few cases, surprisingly cheap relative to their documented
value. Ordered by likely value to a working musician, not by how large the diff would be.

### High value, currently missing entirely

1. **No GUI Quantize at all — the single sharpest gap in this whole comparison.** `quantizeNotes`
   (`src/core/edit.ts:390-462`) is a complete, faithful implementation of Ableton's model — grid
   size, `amount` (0..1 partial-snap, matching [manual p.261]'s "without giving them that
   'quantized' feel" framing exactly), independent starts/ends snapping, per-note-id scoping — and
   it's wired all the way through the CLI (`beat quantize`) and MCP (`beat_quantize`,
   `src/mcp/server.ts:649`). But grepping `ui/src/components/NoteView.tsx` and `TransportBar.tsx`
   confirms **zero GUI affordance calls it** — no button, no keyboard shortcut, nothing in the
   Pitch & Time panel (`NoteView.tsx:1075-1223`) despite that panel already existing and already
   wired to the daemon's `/pitch-time` route for six sibling operations. A user editing MIDI in
   dotbeat's actual app today cannot quantize a note without dropping to the CLI. Given quantize is
   arguably the single most-used MIDI editing command in any DAW [manual p.261-262, "four ways" —
   the chapter dedicates more distinct entry points to quantize than to any other single
   operation], and the backend is fully done, this is the highest-value/lowest-cost fix in this
   entire doc: add a Quantize control (grid + amount + starts/ends) to the existing Pitch & Time
   panel, reusing its exact `postPitchTime`-style pattern against a new/extended daemon call.

2. **Split / Chop / Join have no dotbeat equivalent for MIDI notes at all** [manual p.250-252].
   `edit.ts` has `splitAudioClip` (line 1271) for *audio* regions but nothing analogous for
   `note`/`hit` lines — no split-at-point, no chop-into-N-parts, no join-same-pitch-notes. This is
   a real, common editing motion (turn one long pad note into a stutter via Chop; merge two
   half-notes an earlier edit accidentally split via Join) that dotbeat's current primitives
   (delete + re-add, or manual duration math) only approximate clumsily. Chop in particular
   composes naturally with dotbeat's existing `ratchetCount` field (`document.ts:422`) — a
   "chop into N equal parts" op could be implemented as literally minting N discrete notes, which
   is exactly what `consolidateRatchet` (`pitchtime.ts`, wired into the Pitch & Time panel already
   as "Consolidate," `NoteView.tsx:1207-1214`) already does for ratcheted notes. Worth scoping as
   a genuinely new `chopNotes`/`splitNoteAt`/`joinNotes` trio in `pitchtime.ts` or `edit.ts`,
   following the exact scoped-batch-op shape the six existing Pitch & Time ops already use.

3. **No clip-level time-structure operations** [manual p.272-274]: Crop Clip, Crop to Time
   Selection, Duplicate/Delete/Insert Time, and the loop-brace-double shortcut all operate on the
   *whole clip's timeline*, not individual notes — and dotbeat has none of them for MIDI/drum
   tracks. This is a different axis of missing functionality from #2 (per-note ops) — it's "make
   room for 4 more bars in the middle of this clip and slide everything after it," which today in
   dotbeat requires manually re-typing every note/hit's `start` field via the CLI. Given dotbeat's
   `.beat` format already stores notes/hits as literal position values (not references), this is
   mechanically a straightforward "add K to every start >= cut point" transform — genuinely one of
   the cheaper high-value additions here.

4. **Probability groups (Play All / Play One)** [manual p.267-269] have no dotbeat analog.
   `chance.ts`'s `chanceFires` (per-note, per-pass reroll, seeded) is the right *mechanism*, but
   there's no way to link N notes to one shared probability roll — "play exactly one of these four
   fill variations each time" is currently inexpressible in the format at all (would need a new
   `BeatNote` field, e.g. `probGroup: string` + a `groupMode: 'all'|'one'` stored somewhere, most
   naturally at the group's shared id rather than per-note duplication). This is a genuinely new
   *format* feature, not just a GUI gap — worth a scoped design pass (own decisions.md entry)
   rather than a quick GUI add, since it touches `document.ts`, the playback engine's scheduling
   loop, and the parser/serializer, not just `NoteView.tsx`.

### Medium value — dotbeat has the right mechanism already, just not applied to this field

5. **Velocity has no Randomize / Ramp / Deviation** [manual p.263-265], but dotbeat already has
   **every one of the underlying mechanisms**, just attached to different fields: `humanize()`
   (`src/core/humanize.ts:62-90`) does seeded Gaussian jitter on velocity (closer to "Deviation"
   than a one-shot randomize, but not per-pass-rerolled — humanize bakes its jitter into the
   stored value once, chance's model rerolls every pass). `chance.ts`'s per-pass reroll model
   (`chanceFires`, applied at playback in `engine.ts`) is architecturally exactly what Ableton's
   **Velocity Deviation** needs (a stored ±range, rerolled each playback pass) — it just isn't
   applied to the `velocity` field. A **Ramp** (linear interpolation of velocity across a
   selection, Start→End) has no existing mechanism at all and would be new, but it's a small,
   pure function (`pitchtime.ts`-shaped: scope selected notes by start-time order, lerp). Given
   the chance-paint lane in `NoteView.tsx` (lines 660-711) already proves out the exact
   "draw-across-notes" interaction Ableton's velocity-lane Draw Mode uses [manual p.265-266], a
   velocity Randomize/Ramp pair is one of the cheapest additions in this doc precisely because
   dotbeat already built (and shipped) the harder interaction problem for a sibling lane.

6. **Note Off / release velocity has no field at all** [manual p.266] — `BeatNote`
   (`document.ts:410-425`) and `BeatDrumHit` (`document.ts:195-202`) carry no release-velocity
   concept. The manual itself calls this "somewhat esoteric," and dotbeat's synth engine has no
   device that would consume it the way Ableton's Sampler does — reasonable to leave unscoped
   until/unless a specific instrument needs it. Low priority, noted for completeness only.

7. **Duration/Set-Length and Fit-to-Time-Range have no dedicated one-shot** [manual p.247-248,
   257]. dotbeat's `timeScaleNotes` (×2/÷2, `pitchtime.ts`) covers *relative* stretch, but
   Ableton's "set every selected note to exactly N steps long" (Note Duration panel) and "stretch
   selection to exactly fill this time range" (Fit to Time Range) are both *absolute*-target ops
   with no dotbeat equivalent yet. Cheap, small addition alongside #1/#2 if a Pitch & Time-panel
   pass is already in flight.

### Low value / already well-covered — confirmations, not gaps

8. **Grid snap with freehand bypass** [manual p.241] is already faithfully implemented:
   `snapStep()` (`NoteView.tsx:186-188`) snaps to the nearest whole 16th step by default and
   bypasses on Alt/Cmd, matching Ableton's "snap, unless the modifier flips it" model exactly
   (dotbeat's version is a plain round-to-integer rather than Ableton's "magnetic, free until the
   first line, snapped after" curve — a genuine, minor behavioral difference, not worth chasing;
   dotbeat's simpler model is arguably more predictable for an agent-driven edit anyway).

9. **Move/resize as a rigid group, clamped at the edges** [manual p.247, dotbeat's
   `clampGroupMove`, `NoteView.tsx:316-322`] — dotbeat's group-move clamping (stop the whole
   selection at whichever member hits a boundary first) is the same rigid-body behavior the manual
   describes, already correct.

10. **Deactivating notes** [manual p.249] has no dotbeat equivalent (mute-in-place, third state
    beyond active/deleted) — `removeNote`/`postEdit` with an empty value only deletes. This is a
    real, small gap: a `active: boolean` field on `BeatNote` (default true, canonically elided)
    would be a clean, low-risk v0.10-style addition, and composes well with the existing
    "chance < 100 renders dimmed/dashed" glyph convention (`NoteView.tsx:940-949`) — an inactive
    note could reuse the same dimming treatment. Worth a line in a future format-spec bump, not
    urgent on its own.

11. **Six Pitch & Time ops (Transpose, ×2/÷2, Fit to Scale, Invert, Reverse, Legato) are already
    shipped GUI-to-file**, faithfully matching the manual's own semantics (Invert's scale-awareness
    and "not the same as Invert Selection" caveat [p.254] is preserved correctly in dotbeat's own
    doc-comments; Legato's "extend to next note's start, last note extends to loop end" [p.260] is
    exactly what `legatoNotes` does). **Humanize is broader than Ableton's**, not narrower:
    Ableton's Humanize panel is a single Amount-percent on start time only [manual p.258];
    dotbeat's `humanize()` (`humanize.ts:62`) independently controls timing jitter, velocity
    jitter, constant behind-the-beat drag ("pushLate"), and swing, all under one reproducible
    seed — confirmed as a genuine capability *advantage* over the documented Ableton feature, not
    a gap.

12. **Fold to Notes and Scale Mode are both tracked, correctly, as known missing** in
    `docs/product-roadmap.md` (rows "Fold mode" and "Scale-lock field + scale-tone highlighting,"
    both ⬜ Not started) — this pass **confirms** rather than discovers those gaps, but adds real
    texture the roadmap row doesn't currently have: Ableton's Scale Mode is a genuinely
    three-layered feature (persistent per-clip root+scale storage → piano-ruler highlight → grid
    row highlight → Fold to Scale), not one flag, and Fold to Notes/Fold to Scale are two
    independently-toggleable, complementary fold modes (used-notes vs. in-scale), not one. Useful
    detail for whichever stream eventually scopes that roadmap row.

### Summary table

| Ableton feature [manual page] | dotbeat status | File:line |
|---|---|---|
| Quantize (grid+amount+starts/ends) | Backend done, **zero GUI** | `edit.ts:390-462` (no caller in `NoteView.tsx`) |
| Split | Missing (audio-only equivalent exists) | `edit.ts:1271` is audio-only |
| Chop | Missing | — |
| Join | Missing | — |
| Crop / …Time commands | Missing | — |
| Probability groups (Play All/One) | Missing — needs new format field | — |
| Velocity Randomize/Ramp/Deviation | Mechanism exists (chance/humanize), not applied to velocity | `chance.ts:43`, `humanize.ts:62` |
| Note Off velocity | Missing (no field), low priority | `document.ts:410-425`,`195-202` |
| Note Duration / Fit to Time Range (absolute) | Missing (only relative ×2/÷2) | `pitchtime.ts` |
| Deactivate/mute note | Missing (only delete) | — |
| Transpose/×2÷2/Fit-to-Scale/Invert/Reverse/Legato | **Done**, GUI-wired | `NoteView.tsx:1105-1223` |
| Humanize | **Done, broader than Ableton's** | `humanize.ts:62` |
| Grid snap + freehand bypass | **Done** | `NoteView.tsx:186-188` |
| Group move/resize, rigid-body clamp | **Done** | `NoteView.tsx:316-322` |
| Velocity lane (drag-to-edit) | **Done** | `NoteView.tsx:631-658` |
| Chance lane (draw-across paint) | **Done**, ahead of Ableton's per-pass reroll model | `NoteView.tsx:660-711`, `chance.ts` |
| Fold to Notes | Missing (tracked in roadmap) | — |
| Scale Mode / Fold to Scale | Missing (tracked in roadmap) | — |
| Multi-clip editing / Focus Mode | Out of scope — no Session-grid equivalent in dotbeat | — |

## Sources

Ableton Live 12 Reference Manual, chapter 10 "Editing MIDI," pp. 237-277 (owner-provided PDF,
`prior_art/`, gitignored). dotbeat internal (read directly this pass): `ui/src/components/
NoteView.tsx`, `src/core/edit.ts`, `src/core/pitchtime.ts`, `src/core/humanize.ts`,
`src/core/chance.ts`, `src/core/document.ts`, `src/mcp/server.ts`, `cli/beat.mjs`,
`docs/product-roadmap.md`, `docs/decisions.md`, `ROADMAP.md`.
