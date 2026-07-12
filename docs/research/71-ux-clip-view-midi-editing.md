# Research 71 — Clip View / MIDI editing: implementation-level UI/UX, Ableton manual screenshots vs. dotbeat's own screenshots

*2026-07-12. Owner-commissioned deep UI/UX pass, explicitly distinct from `docs/research/36-ableton-clip-view.md`,
`docs/research/55-ableton-vs-dotbeat-clip-view.md`, and `docs/research/57-ableton-vs-dotbeat-editing-midi.md`.
Those three passes answer **"does dotbeat have the feature?"** (a structured presence/absence table — Transpose:
yes, loop brace drag: half-yes, velocity randomization toolbar: no). This pass answers a different question:
**"what does the control actually look like, exactly how many pixels does it take, what widget type is it, and
what gesture drives it?"** — the level of detail a developer needs to actually redesign a panel, not just decide
whether to build one.

**Method.** Part 1 is grounded in 37 rendered manual-page screenshots viewed directly this pass (17 from ch08
"Clip View" pp.185-218, 20 from ch10 "Editing MIDI" pp.237-277 — a superset of the ~20 pages research 55/57
already used, chosen for maximum layout/widget coverage rather than re-using the same sample). Part 2 is grounded
in **fresh screenshots of dotbeat's own running app**, captured this pass via Playwright against a real daemon +
built UI (`examples/night-shift.beat`, copied to `/tmp/dotbeat-ux-clip/song.beat` so the owner's live
`night-shift-song.beat` was never touched), plus direct reads of `ui/src/components/NoteView.tsx` (1,439 lines)
and `ui/src/components/ClipPropertiesPanel.tsx` (152 lines) for the exact pixel constants, CSS, and gesture code
a screenshot alone can't show. Screenshots for both sides live in `/tmp/dotbeat-ux-clip/` (not committed — ephemeral,
per the task).

**Citation convention:** `[manual p.NNN]` = read off the rendered page image; `[dotbeat file:line]` = read directly
from this repo; `[dotbeat screenshot: name.png]` = one of this pass's own captures, referenced by filename only
(not committed, so treat as "verifiable by re-running the capture," not a permanent link).

---

## 1. Ableton's Clip View + MIDI Note Editor, in genuine visual/interaction terms

### 1.1 Overall Clip View shell

The Clip View is a two-pane shell docked below the Session/Arrangement grid, opened by double-clicking a clip,
toggling `Ctrl+Alt+3`, or clicking the Clip View Selector `[manual p.185]`. Left pane = **clip panels** (~280px
wide in the rendered screenshots); right pane = a **tabbed editor** (Sample Editor / MIDI Note Editor / Envelopes /
MPE). The whole view can be resized by dragging its top border, and the split between panels and editor is itself
click-draggable `[manual p.186, screenshot: "The Clip View for a MIDI Clip"]`.

The **clip title bar** is a full-width colored strip matching the clip's own color (independent of track color —
clips can be recolored per-clip via a palette in the title bar's context menu) `[manual p.188]`, with the clip
name in bold black text directly on the color, and (for audio clips only) a small circular "Save Default Clip"
icon button pinned to the top-right corner of the strip `[manual p.189, screenshot]`. This colored strip is the
single strongest "what am I editing" visual anchor in the whole view — it's the first thing establishing which
clip's properties the rest of the panel describes.

Below the title bar, the panels are reached via **five icon tabs in a horizontal strip**: Clip (▶), Launch (▸|),
Pitch & Time (a slider glyph), Transform (a scatter/dice-like glyph), Generate (a target glyph) `[manual p.191,
screenshot: "Clip View Arranged Vertically"]`. Only one panel is visible at a time; the currently active tab is
highlighted with a black border, inactive tabs read grayed. Audio clips get Clip/Launch/Warp(Sample Editor's own
utilities)/Pitch&Time-as-Transform-only; MIDI clips get the full five.

### 1.2 The Clip (main properties) panel — widget-by-widget

`[manual p.193, "Use the Clip Start and End Controls to Change Clip Length"]` is the canonical screenshot:

- **Start / End**: each is a label + a small pill-shaped **"Set" button** beside it (captures the current playhead
  position into that field during playback) + a numeric field below, formatted `bars.beats.sixteenths` (e.g.
  `1. 1. 1`) for warped/MIDI clips, or minutes:seconds:milliseconds for unwarped audio `[manual p.193, p.207]`.
  The numeric field is a plain rectangular box but reads as a *position*, not a generic number — no unit suffix
  needed because the format itself (three dot-separated groups) signals "bar.beat.tick."
- **Duplicate**: a full-width pill button directly below Start/End (MIDI clips only) — doubles the clip's own
  length by repeating its content, a single-click "grow the clip" action with no dialog.
- **Loop toggle**: a full-width, tall pill button labeled with a loop icon + "Loop" text, filled solid orange/amber
  when active, gray outline when off `[manual p.193]` — this is the single largest, most visually dominant control
  in the whole panel, deliberately so (it's the one property that changes what every other field below it means).
- **Position / Length**: identical Set-button + numeric-field pattern as Start/End, directly below the Loop
  toggle, for the loop region specifically (distinct from Start/End's *clip* region) `[manual p.193]`.
- **Signature**: two small numeric fields separated by a plain "/" character, no dropdown — free-typed numerator
  and denominator `[manual p.195, "The Clip Time Signature Fields"]`. Clip-local, deliberately decoupled from the
  project time signature.
- **Groove**: a dropdown showing the currently-assigned groove's name, plus two small circular icon buttons beside
  it — a hot-swap (circular-arrow) icon and a commit (→) icon `[manual p.196]`.
- **Scale**: a small flat/sharp-symbol icon toggle, a root-note dropdown, and a scale-name dropdown, all on one row
  under a "Scale" label `[manual p.193]`. Grayed out entirely unless Scale Mode is explicitly enabled.

### 1.3 Extended Clip Properties (Launch tab) — audio/MIDI-specific, boxed 2-column layout

`[manual p.198, "The Extended Clip Properties Panel"]`: a visually dense, **strict 2-column grid** inside a single
bordered box — Follow Action (orange full-width pill when active) + a next-clip dropdown + a numeric weight on the
left column; Launch mode dropdown, Quantize dropdown, Velocity field on the right; a horizontal divider; then
Bank/Sub/Pgm three-field MIDI row along the bottom. Every control sits in a fixed grid cell — no flex-wrap, no
control ever spans an unpredictable width.

### 1.4 Warp / Audio Utilities panel (audio clips) — vertical fader + knob widgets

`[manual p.200, "The Audio Utilities Panel"]`: **Warp** toggle (orange pill) + algorithm dropdown (Complex,
Complex Pro, Beats, etc.) + BPM numeric field with `/2`/`×2` round buttons beside it + Reverse/Edit pill buttons +
a three-way Fade/RAM/HiQ toggle row along the bottom of that column. The adjacent column has two genuinely
different widget types from anything on the Clip panel:
- **Gain**: a **vertical fader/slider** — a ruler from +24 dB at top to −70 dB at bottom with tick marks every
  ~10 dB, a triangular playhead-style handle, and the live dB value printed below it in monospace-ish digits
  `[manual p.207, "The Clip Gain and Pitch Controls"]`. Multi-clip selections with differing gain show a **split
  triangle handle** spanning the value range, not a single point.
- **Pitch**: a **circular knob** (a rotary dial with a filled arc from 12-o'clock) for semitone transpose, with a
  small numeric field below it for exact semitones and a second field for cents (100 cents = 1 semitone).

### 1.5 Pitch and Time Utilities panel (MIDI clips) — the direct dotbeat analog

`[manual p.207-217, p.253-261]` — the panel dotbeat's own `PitchTimePanel` is closest to. Ableton's version is a
**boxed, 2-column dark panel** (visually distinct from the page background — a slightly darker gray card) with:

- A prominent **pitch-range readout** at the top: `G#3 - A3` in bold orange-on-black text, occupying its own row
  — this doubles as the **Transpose slider** (drag up/down inside this same box, or type a number)
  `[manual p.253]`.
- **Fit to Scale** and **Invert** as separate full-width pill buttons in the right column, directly beside the
  transpose readout.
- **Interval Size** field (`0 sd`) + **Add Interval** button — chord-building.
- **Stretch**: a **circular knob** (×1.0 center label under it) in the left column, paired with **×2**/**÷2** pill
  buttons in the right column — three different ways to reach the same time-scale operation, deliberately
  redundant for different precision needs `[manual p.257]`.
- **Duration** dropdown (`Fit to Time R…`) + **Set Length** button.
- **Humanize**: a horizontal percentage **slider bar** (filled cyan portion) + numeric readout + **Humanize**
  button beside it `[manual p.259]`.
- **Reverse** / **Legato** as a final pill-button pair.

Every control in this panel is a **pill-shaped button or a knob/slider with a rounded-rect track** — no plain
rectangular HTML-style buttons anywhere, and every button reads at a consistent, generously-sized touch/click
target (roughly button-text-height + 10-12px vertical padding, eyeballed off the screenshots).

### 1.6 The MIDI Note Editor — grid, piano ruler, notes

`[manual p.238, the labeled "MIDI Note Editor Layout" diagram]` is the single best reference: a numbered
call-out diagram identifying 8 zones — the editor-mode tabs (1), the grid itself (2), the time ruler (3), the
Fold/Scale/Highlight-Scale toggle row (4), the note-selection-filter row (5), the piano ruler (6), and the
Velocity/Chance lanes (7), with the grid-resolution chooser (8) pinned to the far right of the header.

- **Piano ruler** (left gutter): real piano-key coloring — white-key rows light, black-key rows dark, drawn with
  enough width to show a **stylized piano-key shape**, not just a flat color swatch. Octave labels (`C3`, `C4`)
  appear at every C row, at a size clearly readable at default zoom `[manual p.243, "Adding New Notes Using Draw
  Mode"]`. Row height is **user-adjustable**: dragging the window split between the Session/Arrangement view and
  the Clip View vertically grows the Clip View — and with it, the MIDI Note Editor's row height — with a visible
  resize cursor and a highlighted drag-target strip `[manual p.241, "Enlarge the MIDI Note Editor by Dragging..."]`.
  There's no fixed row height to cite; the point is it's a first-class, discoverable resize gesture, not a fixed
  constant.
- **Grid shading**: black-key rows get a faint darker shade behind them across the whole grid width (not just the
  ruler), so a glance tells you which rows are "black keys" even far from the piano ruler; a heavier horizontal
  line marks each octave (C) boundary; vertical bar lines are heavier than the finer beat-subdivision lines
  `[manual p.243, p.267]`.
- **Notes**: solid, flat-colored rounded rectangles (track/clip-colored — often orange or green in these
  screenshots) at **full, constant opacity regardless of velocity** — velocity is never encoded as note
  transparency in the grid itself, only in the dedicated Velocity lane below. Selected notes get a distinctly
  brighter/highlighted fill, not just an outline.
- **Draw Mode**: switches the cursor to a pencil icon; freehand-drags paint a run of same-length notes at the
  drawn pitch (or, in "melodic" draw mode, following the freehand pitch contour) `[manual p.243]`.
- **Note Stretch markers**: when a multi-note/time selection exists, a pair of **downward-pointing triangle
  markers** appear in a dedicated strip directly below the scrub area/ruler, draggable independently to
  proportionally stretch everything between them — visually distinct from ordinary note editing, its own
  interaction layer floating above the grid `[manual p.249]`.
- **Scale highlighting**: toggling "Highlight Scale" paints a colored (purple-ish) tint across every ROW belonging
  to the active scale, all the way across the grid width — a persistent background wash, not a one-time transform
  `[manual p.271, "Key Tracks Belonging to the Selected Scale Are Highlighted"]`.
- **Accidentals**: right-clicking the piano ruler opens a context menu — Deactivate Note, then a radio group
  (Auto: Sharps, Sharps, Flats, Sharps and Flats), then a "MIDI Note Number" display-mode toggle `[manual p.271]`.

### 1.7 Velocity Editor and Chance/Probability Editor — dot markers, not bars

This is one of the sharpest, most concrete visual differences found this pass. Ableton's **Velocity lane** does
**not** render filled bars from a baseline. It renders one small **circular dot marker per note**, positioned at
the note's velocity height on a `1–64–127` reference scale printed on the left, with markers for adjacent notes
often connected by a thin line when they're part of a ramp — a "lollipop"/scatter-point convention, not a
histogram `[manual p.239, p.263, "Note Velocity Marker"]`. Dragging a marker shows the live numeric value in Live's
own Status Bar as you drag, and you can type an exact value after selecting one. A dedicated **toolbar strip**
lives directly below the lane: a Show/Hide-all toggle, a lane-swap dropdown, then **Velocity / Randomize / Ramp
(two fields: start value, end value) / Deviation** controls — a whole secondary control row for batch-shaping
velocity across a selection, distinct from the per-note drag gesture `[manual p.265]`.

The **Chance Editor** (probability, 0-100%) is the *same dot-marker convention* on a `0%–100%` scale, toggled
into view via a triangular Lane Selector dropdown (hidden by default) `[manual p.267]`. Grouped notes (a
"probability group" sharing one fired/not-fired outcome) render a single shared marker with a **diamond handle**
(Play All group) or a **triangle handle** (Play One group) instead of individual circles per note `[manual
p.269]`.

### 1.8 Drag/resize affordances, summarized

- **Loop brace**: a horizontal bar drawn directly on the Sample Editor's waveform/MIDI grid, both ends
  independently draggable, small triangular handles at each end `[manual p.213]`.
- **Note Stretch markers**: downward triangles, described above.
- **Clip loop bars in multi-clip editing**: when multiple clips with different lengths are selected, each clip's
  own loop-bar marker renders as a small colored tab directly above its content in the multi-clip strip, all
  independently draggable, or draggable together with `Ctrl`/`Cmd` held `[manual p.275]`.
- **Focus Mode**: a dedicated toggle (`N` key) narrows multi-clip editing down to exactly one clip at a time —
  visually, the non-focused clips' content dims/greys in the shared grid.

---

## 2. dotbeat's own current Clip View / piano roll, in the same terms

Captured live this pass against `examples/night-shift.beat` (screenshots in `/tmp/dotbeat-ux-clip/`). Two tracks
exercised: `lead` (synth, pitch axis) and `drums` (drum kind, lane axis, implicit 5-lane kick/snare/clap/hat/openhat
kit).

### 2.1 Overall page chrome — no separate "Clip View shell"

There is no modal/dockable Clip View analog at all. dotbeat is a **single continuous page**: a top transport bar
(`dotbeat` wordmark, Play, Undo/Redo, BPM field, LOOP field, POSITION readout, a daemon-status dot, Export/
Browser/Mixer/History buttons), directly above the **arrangement** grid (track rows with checkbox/color-dot/name/
mute/solo/volume-slider/pan-or-send-slider, each row also drawing a tiny abstracted "mini piano roll" of colored
horizontal line segments — density/register at a glance, not a real grid), and below *that*, a `BottomPane` that
opens when a track is selected `[dotbeat screenshot: screenshot-01-overview.png]`. Selecting a track for editing
is a **plain text click on the track name** (`ArrangementView.tsx`'s `clickHeader`, bound to `.arr-track-name`) —
clicking anywhere else in a track's row (the `.arr-lane` drag surface) instead does bar-range *selection*, a real
point of friction found live this pass: it's easy to click the row and change the "selection: X · bars N-M" banner
at the very top without changing which track's clip is open below at all, since those are two different state
slices (`selectedTrack` vs. the arrangement `selection`).

The `BottomPane` header is a thin strip: colored track name, a **Clip / Device** tab toggle (text pills, not icons)
labeled "Shift+Tab toggles," and a close ×. There is no colored title bar carrying the *clip's own* color the way
Ableton's Clip View title strip does — the only color cue is the small text label, and it's the track's color, not
a separately-assignable clip color (dotbeat has no per-clip color at all yet).

### 2.2 NoteView's editor-toolbar — one dense row, not tabs

`[dotbeat file: ui/src/components/NoteView.tsx:802-856]`. Everything Ableton spreads across a title bar + 5 icon
tabs + a Launch panel is instead one horizontal strip: colored track name, a `▶ Preview clip` / `■ Stop` button,
then a **single long inline sentence** listing every keyboard/mouse gesture available (click a key to preview ·
click empty grid to add · drag to marquee-select · … dashed/dim = chance<100 · ticks = ratchet · …), then the
live note/hit count + selection count, a conditional Delete button, and a `Place in Arrangement` button
`[dotbeat screenshot: screenshot-02-synth-full.png]`. This hint string is genuinely useful as a keyboard-shortcut
cheat-sheet but at 11px it reads as a wall of small gray text competing with actual controls for the same visual
weight.

### 2.3 ClipPropertiesPanel — one thin row, plain typed fields

`[dotbeat file: ui/src/components/ClipPropertiesPanel.tsx:60-152]`, styled at
`[dotbeat file: ui/src/styles.css:2786-2854]`. A single flex row, ~28px tall, dark background (`--panel-2`),
1px border, 6px/10px padding:

- `clip "<id>"` label in bold, followed by
- `loop` label + two plain `<input type="number">` boxes (46px wide) separated by an en-dash + `bars` unit text +
  a 16×16px `×` clear button — **no Set-from-playhead button anywhere**, purely typed numbers.
- `sig` label + a 34px numerator number-input + `/` + a plain HTML `<select>` for the denominator + another `×`
  clear button.

When the selected track has no saved clip (loop-mode project, no song section), the whole panel collapses to a
single italic hint sentence: *"clip properties: add this track to a scene (song mode) to edit a saved clip's loop
range / signature"* `[dotbeat screenshot: screenshot-04-clip-props.png]` — confirmed live: `night-shift.beat` has
no `song` block, so every track shows this hint rather than real fields in the default loop-mode project.

There is no Start/End (clip region) concept surfaced in the GUI at all — only the loop range — and no Groove or
Scale controls anywhere in the GUI (both exist in `src/core` per research 55, CLI/MCP-only).

### 2.4 The grid itself — dense, fixed 12px rows, opacity-encoded velocity

`[dotbeat file: ui/src/components/NoteView.tsx:42-49]` — the load-bearing constants:

```
ROW_H = 12          // px per pitch/lane row — fixed, not user-resizable
KEY_W = 36           // px — left gutter (piano keys or lane-name labels)
VEL_LANE_H = 46      // px — velocity lane
CHANCE_LANE_H = 24    // px — chance-paint lane (notes only)
MARKER_W = 7          // px — a durationless drum hit's marker width
```

Row height is a **hardcoded constant**, not adjustable by any drag gesture (Ableton's window-split-drag grows row
height as a side effect; dotbeat has no equivalent). Octave/pitch labels render **only at the C of each octave**
(`isOctaveTop`), at 8px font, bold; every other row is unlabeled, relying purely on color
`[dotbeat file: NoteView.tsx:872-933]`. Black-key rows render `#232630` (dark), white-key rows `#c3c7cf` (light)
— an inverted-color scheme that does mirror a real keyboard's black/white convention, but as a **flat, uniform
solid fill** with no beveled/3D key illustration the way Ableton's ruler graphic reads. Live capture confirms this
is legible but genuinely tiny at 1440×900 — a whole clip's worth of pitch range renders as a dense stack of
near-identical thin gray/dark stripes with sparse labels `[dotbeat screenshot: screenshot-03-synth-noteview.png]`.

**Notes** are flat-colored rectangles (track color) whose **opacity is directly driven by velocity**:
`opacity: (0.45 + ev.velocity * 0.55) * (isChancy ? 0.6 : 1)` `[dotbeat file: NoteView.tsx:1032]`. This is the
single sharpest visual-convention difference from Ableton found this pass: **Ableton never lets velocity affect
a note's opacity in the grid** (constant full color there; velocity lives only in the dedicated lane below) —
dotbeat conflates "how loud" with "how visible," and *also* multiplies in a second 0.6× dim for `chance<100`, and
*also* overlays ratchet tick marks on the same 11px-tall rectangle, and *also* a 1px white outline for selection,
and *also* a dashed border for chancy notes `[dotbeat file: styles.css:809-918]`. Up to four independent visual
encodings (fill opacity, dashed border, outline, tick marks) can be simultaneously active on one ~12px-tall,
sub-40px-wide rectangle.

**Resize handle**: `.noteview-resize`, a 5px-wide invisible pointer-target strip on a note's right edge, `cursor:
ew-resize`, with **zero visible affordance** — no nub, no highlight, nothing renders differently there until you
mouse over it and the cursor changes `[dotbeat file: styles.css:827-834]`. Ableton's own resize edges are
similarly cursor-only (no visible grip either), so this isn't a regression — but Ableton's *loop brace* does have
a visible triangular handle, and dotbeat's analogous clip-loop handle is closer to Ableton's non-obvious style
too (see 2.6).

**Drum hit markers** (durationless, one-shot triggers): small 7px-wide pills with `border-radius: (ROW_H-1)/2`
(fully round) and a `1px solid rgba(255,255,255,0.55)` border to read as "not yet a bar"
`[dotbeat file: styles.css:824-826]`, confirmed live as small teal circles in the drum lane grid
`[dotbeat screenshot: screenshot-13-drums-noteview-b.png]`.

### 2.5 Velocity and chance lanes — filled bars, not dot markers

`[dotbeat file: NoteView.tsx:1068-1134]`, styled at `[styles.css:884-946]`. Both lanes render **filled bars
anchored to the bottom of the lane** (a histogram convention), the opposite of Ableton's floating dot-marker
convention (§1.7). No numeric value is ever shown inline in the lane — only a browser-native `title` tooltip on
hover (`title={velocity ${velocity}}`), which requires a full pointer-stop-and-wait to read, unlike Ableton's
live Status Bar echo while dragging. There is **no Ramp/Randomize/Deviation batch-shaping toolbar** anywhere near
either lane — every velocity/chance edit in dotbeat's GUI is either a single-bar drag or the chance-lane's
draw-across-notes paint gesture; batch shaping exists only via CLI/MCP per research 55/57.

### 2.6 Clip-loop resize handle — thin, end-only, no visible bar until dragging

`[dotbeat file: NoteView.tsx:944-980]`, styled at `[styles.css:948-999]`. A 10px-tall strip (`.noteview-cliploop-
strip`) sits directly above the grid; the active loop range renders as a translucent amber band
(`.noteview-cliploop-range`) with top/bottom borders, and a 9px-wide invisible drag zone at the *end* only
(`.noteview-cliploop-handle`, with a 2px accent-colored line rendered via `::after` — the only pixel that visibly
marks "this is draggable"). **The start edge is not draggable at all** — confirmed in code (`startClipLoopResize`
only ever writes `loop.end`, `origStart` is read but never changed by any pointer gesture) — a real gap against
Ableton's both-edges-draggable brace. A floating amber label (`"N bars"`) appears only *during* an active drag,
pinned to the handle's current x position.

### 2.7 Pitch & Time panel — one flat row, no boxing, no knobs

`[dotbeat file: NoteView.tsx:1188-1358]`, styled at `[styles.css:1053-1122]`. `display: flex; flex-wrap: wrap;
gap: 10px` — every control (Transpose input+button, ×2, ÷2, root-select+scale-select+Fit-to-Scale, Invert,
Reverse, gap-input+Legato, quantize-grid-select+range-slider+percent-readout+starts-checkbox+ends-checkbox+
Quantize, Consolidate, and a result message) sits in **one continuous wrapped row**, all styled identically:
flat rectangular buttons (`border-radius: 3px`), plain number/select inputs, and — for the one continuous
parameter (quantize amount) — a **stock unstyled HTML `<input type="range">`**, not a knob or a custom-styled
slider `[dotbeat screenshot: screenshot-05-pitch-time-panel.png, screenshot-18-lead-pitch-time.png]`. Nothing
visually groups "the scale operations" vs. "the time operations" vs. "quantize" — they're only distinguishable by
reading the button labels. Compare Ableton's boxed 2-column card with dedicated knobs for Stretch and a big
pitch-range readout doubling as the transpose control (§1.5) — dotbeat's version is functionally equivalent
(same six ops + quantize + consolidate, confirmed already-shipped parity per research 55) but visually flat and
undifferentiated.

### 2.8 NoteInspector and NoteNameReadout — two more identical thin strips

`[dotbeat file: NoteView.tsx:1370-1431]`, both styled nearly identically to ClipPropertiesPanel and PitchTimePanel
(`background: #14151a`, `border: 1px solid var(--line)`, `border-radius: 4px`, `font-size: 11px`)
`[dotbeat screenshot: screenshot-08-note-inspector.png]`. NoteInspector (chance/cent/ratchet/curve/gate numeric
fields) shows only when exactly one note is selected; NoteNameReadout (a plain-text "C4, E4, G4" list) is always
visible for melodic tracks. Stacked top-to-bottom, the full NoteView panel order is: editor-toolbar →
ClipPropertiesPanel → DrumLanePanel (drums only) → [grid + velocity lane + chance lane, scrollable] →
PitchTimePanel → NoteNameReadout → NoteInspector — **six distinct panels, five of them styled with the exact same
dark-strip treatment**, so nothing but reading the text establishes which panel is "the important one you're
looking at" the way Ableton's colored title bar + boxed side panel + tabbed editor immediately does.

### 2.9 DrumLanePanel — the one place dotbeat already has a good collapse pattern

`[dotbeat file: ui/src/components/DrumLanePanel.tsx:387-437]`, confirmed live
`[dotbeat screenshot: screenshot-14-lane-panel.png]`: a `▾ Lanes (5) · implicit 5-lane kit` toggle header,
defaulting open, with an "Enable lane editing" call-to-action button when the track is still on the legacy
implicit 5-lane kit. This is a genuinely good, already-shipped small pattern (collapsible, clear default state,
one-click upgrade path) — worth reusing as the model for tightening the other five stacked panels above, rather
than redesigning from nothing.

---

## 3. Prioritized UI/UX changes

Scope: **look/feel/interaction only** — every item below assumes the underlying data/operation already exists
(confirmed by research 55/57) and is purely about how it's presented. Ratings for a dedicated UI-polish phase.

### P0 — foundational visual hierarchy, cheap, highest leverage

1. **Give the Clip View a real colored title/header bar.** Move a bar matching `track.color` (or, later, a
   per-clip color once that exists) to the very top of `NoteView`, above `editor-toolbar`, carrying the clip name
   in bold — Ableton's single strongest "what am I editing" anchor (§1.1). Currently the only color cue is small
   text inside `.editor-title` — easy to lose once the panel stack scrolls. *Concrete:* a `40px` tall div,
   `background: track.color`, dark text if the color's light / light text if dark, clip id/name at 14px bold,
   sticky to the top of `.noteview` the way `.noteview-keys` is already sticky horizontally.
2. **Stop encoding velocity as note-grid opacity.** Change `NoteView.tsx:1032`'s
   `opacity: (0.45 + ev.velocity * 0.55) * (isChancy ? 0.6 : 1)` to a flat, full-opacity fill for the base note
   color; keep the chance dashed-border and ratchet ticks, but drop velocity from the equation entirely, matching
   Ableton's convention that grid notes stay constant-color and velocity lives only in the lane below (§1.7,
   §2.4). This alone removes one of four simultaneously-stacked visual encodings on an 11px-tall rectangle.
3. **Live numeric readout while dragging velocity/chance.** Add a small floating tooltip (absolutely positioned,
   following `clientX/clientY`, e.g. `{value}` in a 10px pill) during `onVelPointerMove`/`onChanceLanePointerMove`
   instead of relying on the static `title` attribute — mirrors Ableton's Status Bar live-value echo (§1.7) and
   is a ~20-line addition given the gesture state (`velPreview`/`chancePreview`) already exists.
4. **Make the clip-loop handle two-sided and more visible.** `startClipLoopResize`/`onClipLoopPointerMove` already
   parametrize `origStart`; wire a second handle at the strip's left edge that writes `loop.start` the same way
   the existing one writes `loop.end` (§2.6). Thicken `.noteview-cliploop-handle::after` from 2px to ~4px and give
   it a small triangular cap (a 6px CSS triangle) so it reads as a drag handle at rest, not only on hover —
   matches Ableton's loop brace being visible and both-edges-draggable without a drag in progress (§1.8).
5. **Visually differentiate the five stacked bottom panels.** ClipPropertiesPanel, PitchTimePanel,
   NoteNameReadout, and NoteInspector currently share identical CSS (`#14151a` bg, `1px solid var(--line)`, `4px`
   radius, `11px` font) — nothing but text tells them apart (§2.8). *Concrete:* give each a distinct left-border
   accent color (e.g. clip props = accent amber, pitch/time = a cool blue, inspector = neutral gray) at `3px`
   width, OR adopt `DrumLanePanel`'s already-good collapsible-header pattern (§2.9) for all of them so the default
   state is "collapsed to one line, expand on click" instead of five always-open strips competing for space.

### P1 — meaningful, second-tier

6. **Box the Pitch & Time panel into labeled clusters.** Wrap the Transform group (Transpose/×2/÷2), Scale group
   (root+scale+Fit to Scale+Invert), and Quantize group in three visually separated sub-containers (a subtle
   `background: var(--panel-2)` chip with `4px` padding each) inside the existing flex-wrap row, rather than one
   undifferentiated 9-cluster line (§2.7, §1.5). Doesn't require adopting Ableton's knob widgets, just grouping.
7. **Replace the bare `<input type="range">` (quantize amount) with a styled slider matching the app's dark
   theme.** Currently renders as the OS/browser-default range control, which visually clashes with every other
   custom-styled control in the panel (§2.7). A ~40-line CSS-only track/thumb restyle (`appearance: none` +
   custom `::-webkit-slider-thumb`) gets this to parity with the rest of the UI without a new widget library.
8. **Show note names on every row at usable zoom, not just octave-C.** `isOctaveTop` currently gates all pitch
   labels (`NoteView.tsx:932`) — at `ROW_H=12px` this is defensible for space, but consider showing the label on
   `:hover` per-row (a lightweight tooltip or an inline fade-in), so identifying an exact pitch doesn't require
   counting rows up/down from the nearest C (§2.4, contrasted with Ableton's always-adjustable, always-labeled
   ruler in §1.6).
9. **Persistent scale-highlight tint.** dotbeat has `Fit to Scale` as a one-shot operation but no lightweight,
   persistent "these rows are in the active root/scale" background wash the way Ableton's Highlight Scale toggle
   paints the grid (§1.6, §2.7's root/scale selects already capture the needed state). Even without adding
   clip-level scale storage, the PitchTimePanel's already-selected `root`/`scale` local state could drive a
   client-only visual tint on matching rows while that panel is open — cheap, no format change.
10. **A batch velocity-shaping row under the velocity lane.** Ableton's Ramp (start/end) + Deviation (random
    range) toolbar (§1.7) has no dotbeat GUI equivalent at all today (CLI/MCP-only per research 55/57) — worth
    scoping as a GUI affordance once this phase reaches feature parity, not just visual polish, but flagged here
    because it also changes what visual real estate the velocity lane needs (a second control row beneath it,
    same slot `DrumLanePanel`'s collapse pattern could reuse).

### P2 — lower urgency, still concrete

11. **A "Set" (capture playhead) button beside the loop start/end number fields** in `ClipPropertiesPanel`,
    mirroring Ableton's Set-button pattern (§1.2) — currently purely typed numbers, no way to capture "wherever
    the playhead currently is" into a field with one click.
12. **A visible cursor-mode change for Draw vs. Select/Move**, even though the underlying gesture set already
    functions (click-empty-grid-to-add is Ableton's Draw Mode equivalent) — currently the grid always shows
    `cursor: crosshair` regardless of what a click will do (add vs. marquee-start vs. nothing), unlike Ableton's
    explicit pencil-cursor Draw Mode toggle (§1.6).
13. **Flats/sharps display preference.** `pitchName` (`NoteView.tsx:72`) hardcodes the sharps-only `NOTE_NAMES`
    array — Ableton exposes a sharps/flats/both/MIDI-number preference via a piano-ruler context menu (§1.6).
    Small, self-contained addition (a module-level display-preference plus a lookup-table swap).
14. **Multi-select value-range affordance for knobs/sliders once they exist.** Not urgent since dotbeat's own
    per-note controls are already gated to a single selection (`NoteInspector` renders only for `sel.length===1`),
    but worth remembering as prior art (Ableton's split-triangle handle, §1.2/§1.7) if/when multi-note batch
    editing of continuous values (not just chance-paint) gets a GUI surface.

---

## 4. Sources

- Ableton Live 12 manual, rendered page images: `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch08/`
  (pp. 185, 186, 188, 189, 191, 193, 195, 196, 198, 200, 202, 204, 207, 210, 213, 215, 217 — 17 pages viewed) and
  `.../ch10/` (pp. 237, 238, 239, 241, 243, 245, 247, 249, 251, 253, 255, 257, 259, 261, 263, 265, 267, 269, 271,
  275 — 20 pages viewed), all viewed directly this pass (not OCR'd, not reused wholesale from research 55/57's
  sample set). Raw chapter text cross-referenced at `.../ableton-chapters/ch08.txt` / `ch10.txt` where a
  screenshot's control name needed confirming.
- dotbeat, direct reads: `ui/src/components/NoteView.tsx` (full, 1,439 lines), `ui/src/components/
  ClipPropertiesPanel.tsx` (full, 152 lines), `ui/src/components/DrumLanePanel.tsx` (partial, structural read),
  `ui/src/styles.css` (targeted: lines 780-1122, 2780-2860).
- dotbeat, live-captured screenshots this pass (Playwright + Chrome, headless, 1440×900, against a real daemon on
  a throwaway copy of `examples/night-shift.beat` at `/tmp/dotbeat-ux-clip/song.beat`, `beat daemon` on :9103,
  `vite preview` on :9104): `/tmp/dotbeat-ux-clip/screenshot-{01-18}-*.png` (18 files; ephemeral, not committed).
- Prior passes not re-derived from, only differentiated against: `docs/research/36-ableton-clip-view.md`,
  `docs/research/55-ableton-vs-dotbeat-clip-view.md`, `docs/research/57-ableton-vs-dotbeat-editing-midi.md`.
- `docs/ROADMAP.md`, `docs/decisions.md`, `docs/product-roadmap.md` read for context (no roadmap/decision content
  contradicted or re-opened by this pass — this is a UI-detail addendum, not a scope or architecture call).
