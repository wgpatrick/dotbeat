# Research 70 — Arrangement View: implementation-level UI/UX, Ableton vs. dotbeat

*2026-07-12. Not a feature-presence comparison — research 34 and 53 already did that in depth (34:
the manual's content in full; 53: a structured feature/build-recommendation table cross-referencing
34/18/30). This pass assumes the underlying data/feature already exists or is explicitly out of
scope, and asks a narrower, more concrete question: exactly how does each pixel/gesture look and
feel? Layout widths, spacing, control types, color, cursor behavior, drag affordances — grounded in
BOTH Ableton's actual manual screenshots (19 of chapter 6's 21 page images viewed directly this
pass: pp.150-156, 158-159, 161-167, 169-171) AND fresh screenshots of dotbeat's own current
Arrangement View, captured live against a real `beat daemon` this session (not mocked, not
described from memory of the code). This is meant to hand directly to a developer scoping a UI-polish
phase — every recommendation in §4 names the exact CSS class, TSX line range, or literal pixel/color
value to change.*

**Citation convention**: `[manual p.NNN]` — Ableton Live 12 Reference Manual, Chapter 6
"Arrangement View," pp.150-171, page images at
`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch06/p-NNN.jpg` (viewed directly this
pass). `[dotbeat file:line]` — read directly from this repo. `[screenshot NN]` — this pass's own
captures, left at `/tmp/dotbeat-ux-arr/*.png` (not committed; regenerate via the recipe in §3's
intro if needed).

---

## 1. Scope and method

**Ableton side**: 19 of chapter 6's 21 page images viewed directly (pp.150-156, 158-159, 161-167,
169-171; skipped 157/160/168, which are pure prose with no new screenshot). Cross-referenced against
`docs/research/34-ableton-arrangement-view.md`'s text extraction only where a control's exact name
needed confirming — every visual claim below is read off the image, not the text.

**dotbeat side**: `examples/night-shift.beat` (the stable, non-live-editing example — deliberately
*not* `examples/night-shift-song.beat`, which is the owner's actively-edited project, currently
showing `M` in `git status`) copied to a scratch dir and driven via a real `beat daemon` + `vite
preview`, screenshotted with `playwright-core` (chromium) at 1680×1000, matching the pattern in
`ui/verify-phase24-stream-ci.mjs`. Two fixtures were used: the plain loop-mode copy (`/tmp/dotbeat-
ux-arr/loop/song.beat`, unmodified example — 4 bars, 4 tracks, no `song` block) and a second scratch
copy (`/tmp/dotbeat-ux-arr/songmode/song.beat`) into which this pass added a small song arrangement
via `beat clip`/`beat scene`/`beat song` (verse×4, chorus×4, verse×4, chorus×8) purely so
song-mode's clip-block chrome — invisible in loop mode, see §3.4 — could be captured too. Neither
touches any file the owner is working in. `ui/src/components/ArrangementView.tsx` (2,741 lines) and
`ui/src/styles.css` were read in full for the parts a screenshot alone can't show (exact class names,
pixel constants, color variables, event handlers).

---

## 2. Ableton's Arrangement View — visual and interaction detail

### 2.1 Overall layout and chrome

The whole view sits on a **light gray/white theme** (not dark) — a real, first-order visual
difference from dotbeat (§3) worth naming up front rather than re-discovering per-item. Reading
top to bottom in the full screenshot `[manual p.150]`:

1. **Overview strip** (~14px tall) — a full-arrangement thumbnail rendered at tiny scale (clip
   blocks a few px tall, colored, no text legible), with a **black-outlined rectangle** marking the
   currently-visible viewport. Click-drag scrolls; drag vertically zooms; double-click resets to
   full view `[manual p.150 item 1, p.151 §2]`.
2. **Beat-time ruler** — bars-beats-sixteenths, numbered tick marks at a regular interval that
   doesn't visibly re-space with zoom in the screenshots shown (contrast with dotbeat's explicit
   zoom-adaptive tick-thinning, §3.3).
3. **Scrub area / locator row**, directly below the ruler — this is where **section-name tags**
   live: rounded-corner rectangular chips with a small `>` triangle prefix glyph and the section
   name (`Intro`, `Verse 1`, `Chorus`, ...), each spanning exactly its own bar range with a thin
   vertical divider at its boundary `[manual p.150 overview screenshot, p.155-156]`. A **selected**
   time range in this same strip renders as a **solid mid-gray rounded rectangle with a crisp black
   1px outline**, sitting as an distinct object layered above the ruler ticks `[manual p.155,
   "Use the Scrub Area to Launch Playback"]` — this is the closest Ableton equivalent to a
   "selection highlight," and it's confined to the scrub strip, not painted across the track lanes
   below it.
4. **Track headers**, ~170-190px wide in the screenshots (not a fixed documented number, but
   consistently proportioned relative to the ~700px lane area shown), stacked vertically, each
   track's row height matching its clip lane's row height exactly (no separate "extra" header
   chrome height).
5. **Track lanes**, one per track, holding the actual clip blocks.
6. **Mixer Drop Area** — a **blank horizontal strip directly below the last track row**, explicitly
   for the drag-to-create-a-track gesture (dropping an instrument/device there mints a whole new
   track) `[manual p.152 item 12]` — visually just empty background, no border or label distinguishing
   it from ordinary blank canvas below the last row (you infer its existence from the manual text,
   not a design affordance in the pixels).
7. **A second, independent mixer panel** can dock at the bottom (`Ctrl/Cmd+Alt+M` or the View menu),
   showing full vertical-fader channel strips per track PLUS a separate **Arrangement Track
   Controls** column at the right edge of the main track-header area (In/Out routing, sends, a
   compact volume/pan pair) `[manual p.170, "The Mixer (Bottom) and Arrangement Track Controls
   (Right)"]` — i.e. Ableton genuinely has **two different, simultaneously-visible mixer surfaces**
   for the same tracks, user-configurable per-control via View → Mixer Controls / Arrangement Track
   Controls submenus `[manual p.171]`.

### 2.2 The ruler, insert marker, and playhead

- The **insert marker** (Ableton's term for the point playback starts from, distinct from the
  playhead during playback) renders as a **thin cyan/light-blue vertical line running the full
  height of the visible track stack**, with the **entire bar-cell it sits in tinted a darker shade**
  as a secondary highlight — not just a hairline `[manual p.154, "Arrangement Playback Begins from
  the Insert Marker"]`. It's genuinely a full-column highlight, not a 1-2px line.
- The transport/position readout in the Control Bar is a **boxed, monospaced digital-clock style
  field** (`1 . 1 . 1` in a bordered gray box) directly next to Play/Stop/Record circular-icon
  buttons `[manual p.153, p.154]`.
- The **Arrangement Loop** brace: a **rounded-pill toggle icon** (loop arrows inside a rounded
  square, turns solid yellow/amber when active) flanked on both sides by **boxed numeric fields**
  (loop start bars-beats-sixteenths on the left, loop length on the right), all inside one
  continuous bordered control group `[manual p.159, "The Arrangement Loop Toggle"]`.

### 2.3 Locators and time-signature markers

- **Locators** are small **flag-shaped tags** (rounded rect, left edge has a small triangular
  point) sitting directly in the scrub row, each showing its typed name (`Chorus`, `Verse 2`)
  `[manual p.156]`. The **Set Locator** button is a large, individually bordered pill labeled `Set`
  next to a chain-link icon and a lock icon, with separate `◀`/`▶` Previous/Next buttons below it
  `[manual p.156]`.
- **Time-signature markers** are a **third, distinct row directly under the beat-time ruler** —
  small bordered tags reading e.g. `7/8`, `4/4`, `5/4`, positioned exactly at the bar they take
  effect `[manual p.158]`. An **off-barline** meter change produces a **diagonal crosshatch-filled
  region** in the scrub area (a genuinely distinct visual pattern, not just a color change) with a
  right-click context menu offering `Delete Fragmentary Bar Time` / `Complete Fragmentary Bar
  (Insert Time)` `[manual p.158, "A Fragmentary Bar and its Context Menu Options"]`.

### 2.4 Clips: color, body, and edge handles

- Every clip renders inside a **two-part block**: a **darker, saturated title bar** (~14-16px tall,
  the clip's name in dark text) sitting directly above a **lighter pastel-tinted body** showing the
  clip's actual content — waveform peaks (dark navy/black wave shape on the pastel tint) for audio,
  or a **thin-line note-pitch preview** (horizontal gray line segments, stacked by pitch, no
  grid) for MIDI `[manual p.150 overview, p.161]`. Track color is consistently the SAME hue applied
  to both the header accent and every clip on that track — e.g. all "Coffee Lead" clips are pale
  yellow-green, all "Drums" clips pale green, all "Vocals" clips pale yellow.
- **Moving a clip**: only the clip's title bar is draggable (confirmed explicitly in the manual
  text) — dragging over another clip shows a **small pointing-hand cursor glyph** at the drop point
  `[manual p.161, "Moving a Clip"]`.
- **Resizing**: dragging an edge shows a **distinct bracket-shaped resize cursor** (`]`-like glyph)
  right at the edge being dragged, with a **black selection-outline box** surrounding the handle
  area during the drag `[manual p.161, "Changing a Clip's Length"]`.
- **Fade handles**: on hover, **small squares appear at the top two corners** of an audio clip. A
  selected fade handle shows a **shaded triangular overlay** (a translucent tan/gold wash from the
  corner inward, following the exact fade shape) directly on top of the waveform, plus a **diamond-
  shaped curve handle** mid-slope to bend the fade's curve `[manual p.162, "Fade Handles in an Audio
  Clip" / "Adjusted Fades in a Clip"]`. A dotted black line marks the hard limit a handle can't cross
  (own clip's loop boundary) when selected `[manual p.164]`.
- **Crossfades** render as an **hourglass/bowtie shape** spanning the boundary between two adjacent
  clips, with the same diamond curve-handle sitting at the crossing point `[manual p.163, "Crossfaded
  Clips"]`.
- **Selected clip**: a **solid black 1-2px outline box** around the whole clip (confirmed across
  every "selected" screenshot in the chapter, e.g. `[manual p.161, p.162, p.164]`) — no separate
  fill-tint change beyond the outline itself in most of these; the one screenshot showing a
  translucent blue wash over a selected clip is specifically the **fade-handle drag state**
  `[manual p.162]`, not plain click-selection.

### 2.5 Track header controls (mixer strip)

From the dedicated mixer screenshot `[manual p.170, "The Mixer (Bottom) and Arrangement Track
Controls (Right)"]` and the numbered-callout page `[manual p.152]`:

- Each channel strip, top to bottom: **Sends** (small circular knob per return track, labeled
  "Sends" as a group), a **Pan knob** (circular, small notch/pointer line), a **numeric gain
  readout** (e.g. `-11.5`, `-8.0`), a **vertical volume fader** (the dominant visual element,
  roughly half the strip's height) with an **orange-highlighted numeric track-number badge**
  directly below it, then **Mute/Solo** as two small square buttons.
- The **Arrangement Track Controls** column (separate from the full mixer, always available inline
  next to the track header) shows, per track: an instrument-name dropdown-look field, an
  **All-Channels MIDI-in selector**, **In/Auto/Off monitoring** as three small mutually-exclusive
  buttons (Auto highlighted amber when active), and a **Main output** dropdown `[manual p.156, the
  Set Locator screenshot happens to show one of these strips directly; p.170]`.
- **Linked-track indicator**: a small **chain-link icon button** at the right edge of a linked
  track's header, rendered with a **dark bordered box** when active; hovering highlights every
  track in that link group; linked tracks share a **soft light-blue background tint** across their
  whole row `[manual p.169, "A Track's Linked-Track Indicator Button"]`.
- **Track fold/unfold**: a **triangle-in-circle play-style icon** (▶) directly left of the track
  name toggles fold; an unfolded track shows a **draggable horizontal split-line** at its bottom
  edge (cursor becomes a vertical double-arrow ↕) to resize row height, revealing more
  waveform/note detail as it grows `[manual p.164, "Adjusting an Unfolded Track's Height"]`.

### 2.6 Selection, grid, and no persistent on-canvas help text

- Ableton's own framing: **"Arrangement editing is selection-based: you select something and then
  execute a command"** `[manual p.164, §6.9]` — but the selection UI itself is minimal: a clicked
  clip gets the black-outline treatment (§2.4); a clicked-and-dragged **time range** shows the same
  gray-rounded-rect-with-black-outline as the locator/section-tag row, but now spanning the actual
  track lanes it was dragged across (not confined to one row — dragging across multiple tracks
  selects that bar range on ALL of them by default unless explicitly time-selected within one
  track's unfolded content).
- **No permanent instructional text is rendered anywhere on the canvas.** Every gesture (drag-to-
  slide-contents, Ctrl+Shift+drag, grid-snap shortcuts) is documented only in the manual and
  discoverable via menus/tooltips/keyboard, never as literal on-screen copy competing with the
  timeline for space `[manual pp.161-165 throughout]`.
- The editing grid has its own dedicated numeric readout in the **lower-right corner of the ruler
  area** — just a plain small text label showing the current subdivision spacing, e.g. "1/16"
  `[manual p.165, §6.10, referenced in text — the grid-density readout sits in that exact corner
  position]`.

---

## 3. dotbeat's Arrangement View — visual and interaction detail

*Grounded in `[screenshot 01]`-`[screenshot 10]` (`/tmp/dotbeat-ux-arr/*.png`, captured this pass)
plus `ui/src/components/ArrangementView.tsx` and `ui/src/styles.css`.*

### 3.1 Overall theme and layout

dotbeat is a **dark theme throughout**: background `#16171b`, panel `#1e2026`/`#23262e` for headers
and the bottom pane, hairline borders `#2e3138`, body text `#d8dbe2`, dimmed/secondary text
`#8a8f9a`, and exactly **one accent color, amber/orange `#e0a13c`**, reused for literally every
"active" affordance in the app — the Play button fill, the selected-track left-edge bar, the
bar-range selection wash, the volume/pan slider thumbs, the playhead line, the "vary" buttons, the
Preview/Place-in-Arrangement buttons `[ui/src/styles.css:1-8; screenshot 01]`. Ableton's palette by
contrast is light-gray/white chrome with per-track pastel hues doing the "what belongs to what"
work — dotbeat does that same job with a single reused accent plus per-track hue on data (clips/
swatches) only, never on chrome.

Reading top to bottom `[screenshot 01, 10]`:

1. **Topbar** (`className="topbar"`, `App.tsx:231`): dotbeat wordmark + amber dot logo, a solid
   amber **Play** pill button, grayed-out **Undo/Redo** (icon+text pairs, inactive here since
   nothing was done yet this session), a plain **BPM** numeric field, a plain-text **LOOP `4`** or
   **SONG `20`** length readout, a plain-text **POSITION `1.1`** readout, a green dot + "daemon"
   connection-status label, and — genuinely distinctive versus Ableton — a **live oscilloscope
   widget baked directly into the main toolbar** (`<Scope/>`, `App.tsx:234-236`; 240×72px canvas,
   wave/spectrum toggle, glow intensity tied to master level, `ui/src/components/Scope.tsx`).
   Ableton keeps metering exclusively inside the Mixer panel; dotbeat surfaces a live-signal view
   at all times regardless of which panel is open. Right-aligned: Export/Browser/Mixer/History as
   plain gray pill buttons.
2. **Contextual hint line** directly under the topbar (`"arrangement · 4 bars · 1 section · detail
   view · drag the ruler or a track to select bars · click a track name to select it ·
   double-click a name to rename"`) plus right-aligned quick-action buttons (`+ track`, `+ group`,
   `open folder…`, `new project…`, `new from template…`, `save as template…`) — all same-styled
   small gray pill buttons, no visual hierarchy between "create a track" and "save as template."
3. **Arrangement toolbar row**: in loop mode, `LOOP LENGTH` stepper (`-` / `4 bars` / `+`), `+
   section`, an `overlap` policy `<select>` (`push-existing`), and at the far right a zoom control
   cluster: `-` / **`354px/bar`** (a plain text readout, not a slider or icon) / `+` / `fit` / `loop
   select` — five text-label buttons in a row with no icon language anywhere `[screenshot 01, 04]`.
   In song mode this row is replaced by a **SECTIONS chip row** — see §3.2.
4. Below that: the actual **track-header column + lane grid**, then a **bottom split pane** (Clip/
   Device tabs) that's *always present* once a track is selected, hosting the NoteView piano-roll
   directly below the arrangement — a permanently-docked second view, not a separate toggleable
   panel the way Ableton's Clip View is.

### 3.2 The ruler and section chips (song mode)

Song mode's `SECTIONS` row `[screenshot 06]` replaces Ableton's flag-shaped locator tags with much
denser **chips**: each one is `⁙ verse ◀ ▶ 4 - + ↺ ×` — a name, prev/next-scene chevrons, a
bar-count readout with its own `-`/`+` steppers, a reuse/rotate icon, and its own delete `×`, all in
one ~90px-wide row of tiny controls. Compare Ableton's locator tags, which show only a name in a
simple flag shape — everything else lives in a menu. dotbeat's chip is a compact power-user control
surface; Ableton's is a minimal label.

The **bar ruler** below the section chips draws numbered tick marks (`tickIntervalFor`,
`[ArrangementView.tsx:149-155]`) that thin out at low zoom (1/2/4/8/16-bar intervals) — this genuinely
matches Ableton's zoom-adaptive intent even though Ableton's own screenshots don't visibly demonstrate
re-spacing.

### 3.3 Track headers and the inline mixer strip

Fixed-width **264px** column (`HEADER_W`, `[ArrangementView.tsx:126]`), row height a fixed **56px**
(`ROW_H`, `:125`) for every track regardless of content — no fold/unfold, no per-track resize
handle anywhere in the DOM (confirmed: no resize-cursor CSS, no drag-split-line affordance exists
at all, vs. Ableton's draggable height + Optimize Height/Width). Per header, top to bottom
`[screenshot 01, 02]`:

- **Titlebar row** (`.arr-track-titlebar`): a small **9×9px flat square swatch** (`.arr-track-
  swatch`, `[styles.css:1645-1650]`, a hidden native `<input type=color>` sits behind it), the
  track name, a **single-letter kind badge** in a bordered pill (`s`/`d`/`i`/`a` for
  synth/drums/instrument/audio, `.arr-track-kind`), and a plain **`×`** delete button.
- **InlineStrip row** (`InlineStrip`, `[ArrangementView.tsx:191-252]`): an **`M`** and an **`S`**
  button, each an 18×16px bordered square with a bold 9px letter glyph (`.arr-strip-btn`,
  `[styles.css:1567-1590]`) — mute-active fills solid red `#c0503c`, solo-active fills solid accent
  amber. Directly beside them, a **horizontal `<input type="range">`** for volume (native browser
  slider styling, `accent-color: var(--accent)`, `[styles.css:1561-1566]`) with a live `-1.0`-style
  dB readout to its right, then a second native range slider for pan with an `L35`/`C`/`R35`-style
  readout, then up to two 8px **send badges** (`Rv`/`Dl`) shown only when that send is dialed above
  0 `[screenshot 01, 02]`.
- An **`A`** automation-lane toggle sits below-left of the strip, easy to miss (9px text, no icon,
  no border by default).

This is a genuinely flatter, less differentiated control language than Ableton's: every parameter
(volume AND pan) is the *same* native `<input type=range>` widget varying only in width, with no
center-detent tick for pan-zero, no filled-track-to-thumb visual, no circular-knob affordance
distinguishing "rotary" parameters (pan, sends) from "linear" ones (volume) the way Ableton's actual
knob-vs-fader iconography does.

### 3.4 Clip / content rendering in the lane

Everything in a track lane is **canvas-drawn** (`.arr-canvas`, one `<canvas>` per row,
`[ArrangementView.tsx:658-731]`), not DOM:

- **Synth tracks**: each note becomes a **3px-tall horizontal bar**, y-position mapped to pitch
  within the row's own min/max pitch range, x/width mapped to start/duration
  (`ctx.fillRect(x, y, w, 3)`, `[:697-701]`) — a flattened "note gutter," not a real piano-roll note
  shape and with no grid drawn under it. Compare Ableton's actual thin-line MIDI-content preview,
  which is visually similar in spirit (lines, not full notes) but sits inside a bounded clip block
  with a title bar (§2.4) — dotbeat's ticks currently render loose in the lane.
- **Drum tracks**: hits render as **per-lane vertical tick columns** — kick/snare/clap/hat/openhat
  each get an equal horizontal slice of the 56px row height, a hit is a short filled rect in its
  lane's slice (`[:685-693]`). This is dotbeat's own invention; Ableton has no lane-stacked
  micro-grid equivalent inside an Arrangement-View clip (that's a Session/Clip-View-only concept
  there).
- **Audio tracks**: a **flat, single-color fill** per occurrence at 85% opacity in the track's own
  color, with two **dark 3px-wide bars** at the left/right edges standing in for in/out point
  markers, and (if the block is wide enough) a small filename + warp-mode text label anchored to
  the *bottom* of the block (`[:664-679]`) — deliberately not a real waveform; `ui/src/audio/
  waveform.ts` renders actual peaks only in the separate `AudioClipInspector`, not here.
- **Low zoom (density LOD)**: below `DETAIL_PX_PER_BAR` (32px/bar), all of the above collapses to
  **one opacity-encoded block per bar** (alpha ∝ event count, `[:709-722]`) — cheap and legible at
  a glance, but a genuinely different visual language from Ableton, which always shows literal
  content miniatures regardless of zoom (already flagged as a deliberate, not-a-gap divergence in
  research 53).

**The single most visually significant finding of this pass**: in **loop mode** (no `song` block —
the state of `examples/night-shift.beat` itself, and therefore what a fresh/simple project looks
like), there is **no clip boundary rendered at all**. `occurrences` is unconditionally `[]` in loop
mode `[ArrangementView.tsx:839, comment at :837 confirms this explicitly]`, so the `.arr-clip-block`
DOM overlay that provides border/label/selection chrome (`[:846-858]`) never mounts — the canvas
content just fills the row edge-to-edge with **zero border, zero label, zero selectable-object
affordance** `[screenshot 01]`. Every clip in Ableton, by contrast, is *always* a bounded, colored,
named block, in every mode, at every zoom `[manual p.150, p.161]`. Only once a project enters song
mode does dotbeat grow the equivalent chrome — a **1px border colored to match the track**, a
top-left plain-white clip-id label with a text-shadow (`.arr-clip-label`, `[styles.css:1799-1809]`),
and on selection a **2px border + a whole-block translucent accent wash** (`rgba(224,161,60,0.16)`,
`.arr-clip-block.selected`, `[styles.css:1788-1792]`) `[screenshot 07]` — visually a "selection wash"
across the whole block, versus Ableton's crisp black corner-outline with no fill change (§2.4).

### 3.5 Selection band and playhead

- A **bar-range selection** (drag across a lane) draws a **translucent amber rectangle directly in
  that row's own canvas** (`rgba(224,161,60,0.22)` fill + solid amber left/right border lines,
  `[ArrangementView.tsx:727-740]`) — and critically, **only in the row(s) actually dragged across**,
  not as a full-column highlight spanning every track the way Ableton's insert-marker/time-selection
  does by default `[screenshot 05: only the "lead" row is tinted; drums/bass/pad rows are
  untouched]`. This is a real interaction-model difference, not just a color choice: in Ableton a
  plain click-drag in the scrub area or ruler selects that time range across the *whole*
  arrangement; in dotbeat, the same gesture inside a track's lane scopes the selection to that one
  track's row by construction (matches the "tracks + bars" selection-axis model documented in the
  dotbeat skill).
- The **playhead** is a flat **2px accent-colored vertical line with a soft box-shadow glow**
  (`.arr-playhead`, `box-shadow: 0 0 6px rgba(224,161,60,0.7)`, `[styles.css:1420-1428]`) — no flag,
  triangle, or top-anchored handle marker at all, unlike Ableton's insert-marker treatment (§2.2),
  which pairs the line with a distinct top marker and a full-column tint on the current bar-cell.

### 3.6 Cursors and drag affordances

Confirmed by direct CSS search: dotbeat's *only* cursor affordance anywhere in the Arrangement View
is `.arr-clip-block { cursor: grab }` swapping to `grabbing` while a clip drag is active
(`.arr-clip-block.dragging`, `[styles.css:1773-1797]`) plus a generic `crosshair` cursor on empty
lane space (`.arr-lane`, `[styles.css:1758-1761]`) and `ew-resize` on the ruler itself
(`.arr-ruler`, `[styles.css:1447-1451]`). There is **no dedicated resize-cursor at a clip's edge**
(Ableton's bracket-glyph cursor, §2.4) and **no pointing-hand cursor during a move-drag** (Ableton's
hand glyph) — dotbeat relies on the generic `grab`/`grabbing` pair for every drag gesture regardless
of what's actually being manipulated.

### 3.7 The bottom pane's on-canvas help text

Directly under the arrangement, once a track is selected, a persistent **dense, single-line
sentence of shortcuts and gesture hints** renders as literal copy (verified verbatim in
`[screenshot 01]`): *"7 notes · click a key to preview · click empty grid to add · drag to
marquee-select · shift/cmd-click to multi-select · drag a note (or group) to move · drag its right
edge to resize · arrows nudge · shift+←/→ resize · delete removes · double-click to delete · hold
Alt/Cmd while dragging for freehand placement · hold Alt/Option at the START of a drag to duplicate
instead of move · cmd/ctrl+c / cmd/ctrl+v to copy/paste at the playhead · dashed/dim = chance<100 ·
ticks = ratchet · drag the chance lane across notes to paint probability"* — seventeen distinct
gestures in one unbroken line of ~11px text. This is the polar opposite of Ableton's approach
(§2.6, zero persistent on-canvas instructional text anywhere) and is worth naming as a deliberate,
named design tension, not just an oversight — see §4.

---

## 4. Prioritized UI/UX changes

*Purely visual/interaction polish — every item below assumes the underlying feature/data already
exists (per research 53, or trivially derivable) and scopes ONLY how it looks/feels. P0 = must have
for a UI-polish phase; P1 = high value, should be in-phase; P2 = real but lower urgency/cheaper to
defer.*

| # | Change | Priority | Detail |
|---|---|---|---|
| 1 | Render a bounded clip block in loop mode too | **P0** | Today `occurrences` is hardcoded `[]` outside song mode (`ArrangementView.tsx:837-839`), so a fresh/simple project — the *default*, most common state — shows raw ticks with zero border, label, or selectable boundary (§3.4). Purely cosmetic fix: synthesize one synthetic occurrence per track spanning the full loop length (reuse the existing `.arr-clip-block` render path at `:839-858` with a loop-mode-derived `occ`), giving every dotbeat project the same "this is a clip, here's its name, you can click it" chrome Ableton provides unconditionally. No data-model change — occurrence is a derived/render concept already. |
| 2 | Selection band should span the full column when dragging on the ruler | **P0** | dotbeat's bar-range selection (`ArrangementView.tsx:727-740`) tints only the row(s) actually dragged across (`screenshot 05`); Ableton's equivalent gesture from the ruler/scrub area highlights the selected bar range across every track by default (§2.2, §2.6). At minimum, dragging on the **ruler itself** (not inside a specific track's lane) should paint the selection band across all rows, matching the mental model "I selected this time range," not "I selected this time range on this one track." Row-scoped selection (today's actual behavior) should remain available for the track-scoped gesture, just not be the *only* option. |
| 3 | Give the playhead a top marker, matching the insert-marker's visual weight | **P1** | `.arr-playhead` (`styles.css:1420-1428`) is a bare 2px glowing line. Add a small flag/triangle glyph anchored at the ruler's bottom edge (where the line originates) — cheap (one more absolutely-positioned `<div>`, a CSS triangle or 8×8px SVG), and gives the playhead the same "this is a real object, not just a color change" weight Ableton's insert marker has (§2.2). |
| 4 | Add edge-specific resize cursors on clip blocks | **P1** | `.arr-clip-block` only ever shows `grab`/`grabbing` (`styles.css:1773-1797`) — there's no `ew-resize` cursor when hovering the resize-handle region at a clip's right edge (the resize *gesture* exists per research 53's clip-drag notes, just not the cursor feedback). Add a `:hover` rule keyed to pointer x-position near the edge (or a dedicated thin resize-handle sub-element) swapping to `ew-resize`, matching Ableton's bracket-cursor convention (§2.4). |
| 5 | Differentiate volume vs. pan controls visually | **P1** | Both are the same native `<input type=range>` (`InlineStrip`, `ArrangementView.tsx:219-242`) varying only in width/min/max — no center-detent notch on the pan slider at 0, no filled-track-to-thumb affordance on volume. Add a CSS-only center tick mark (`background-image` gradient or a pseudo-element at 50%) for pan, and a filled-left-of-thumb track style for volume (`::-webkit-slider-runnable-track` gradient keyed to current value) so the two controls read as visually distinct parameter *types*, the way Ableton's knob-vs-fader iconography does (§2.5) — without needing a bespoke knob widget. |
| 6 | Replace the always-on gesture-legend sentence with progressive disclosure | **P1** | The 17-gesture single-line legend (§3.7, `NoteView.tsx`'s hint bar rendered under the arrangement) permanently consumes a full-width row of screen space regardless of whether the user needs it. Move it behind a small `?`/`i` affordance next to the Clip/Device tabs (`[screenshot 01]`'s tab row) that reveals the same text in a popover/tooltip on demand — matches Ableton's near-total reliance on menus/manual/tooltips over persistent on-canvas copy (§2.6), while keeping the actual documentation value dotbeat's approach has (Ableton's own discoverability is arguably worse for a new user — don't just delete this, relocate it). |
| 7 | Give the section chip row (song mode) a distinct "tag" visual identity | **P2** | Today's section chips (`SECTIONS` row, §3.2) are visually identical in weight to ordinary toolbar buttons — same gray background, same border-radius, same font size as `+ track`/`Export`/etc. Ableton's locator/section tags use a distinct flag shape (rounded rect + triangular left point) that reads as "a marker on the timeline," not "a button in a toolbar" (§2.3). A cheap CSS treatment (a clipped-corner or triangle-notch background) would give dotbeat's chips the same at-a-glance "this is timeline metadata" identity. |
| 8 | Add a fade-handle visual spec now, ahead of the fade feature landing | **P2** | Research 53 already scopes region fades as a P1 *feature* build. When it lands, match Ableton's exact visual grammar (§2.4) rather than inventing a new one: small 6×6px squares at the clip's top corners on hover, a translucent triangular wash following the actual fade curve, a diamond mid-slope curve handle. Filing this now as a visual spec so the eventual feature-build doesn't have to separately research the look. |
| 9 | Track kind badge and swatch: minor visual consistency pass | **P2** | The single-letter kind badge (`s`/`d`/`i`/`a`, `.arr-track-kind`) and the 9×9px flat swatch (`.arr-track-swatch`) both use the exact same border/radius/font treatment as half a dozen unrelated small pill buttons elsewhere in the header (mute/solo, send badges, group toggle) — nothing is wrong per se, but there's no visual grouping distinguishing "identity" controls (swatch, name, kind) from "action" controls (mute, solo, delete). A subtle background-tint difference (e.g. identity cluster on transparent, action cluster on `--panel-2`) would read the grouping at a glance without changing any control's function. |
| 10 | Scope readout ("354px/bar") deserves a lighter visual treatment | **P2** | The zoom-level readout (`[screenshot 01]`, `-` / `354px/bar` / `+` / `fit` / `loop select`) is plain body text at the same size/weight as every other toolbar label — it's a live HUD value, not a static label, and would benefit from `font-variant-numeric: tabular-nums` (already used elsewhere in this codebase, e.g. `.arr-strip-db`, `styles.css:1608`) plus a slightly dimmer color so it reads as "current state," not "another button." |

---

## Sources

Ableton Live 12 Reference Manual, Chapter 6 "Arrangement View," pp.150-171 — 19 page images viewed
directly this pass (`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch06/p-{150-156,
158-159,161-167,169-171}.jpg`); chapter text at `.../ableton-chapters/ch06.txt` used only to confirm
control names. `ui/src/components/ArrangementView.tsx` (2,741 lines, read in full),
`ui/src/styles.css` (targeted reads of every `.arr-*`/`.topbar*` rule), `ui/src/components/
Scope.tsx`, `ui/src/App.tsx` — all read directly this pass. dotbeat screenshots captured live this
session via `playwright-core` against a real `beat daemon` + `vite preview`, driving
`examples/night-shift.beat` (copied, never touched in place) plus a scratch song-mode fixture built
from it via `beat clip`/`beat scene`/`beat song`; screenshots left at `/tmp/dotbeat-ux-arr/*.png`.
Cross-referenced, not re-derived: `docs/research/34-ableton-arrangement-view.md`,
`docs/research/53-ableton-vs-dotbeat-arrangement-view.md`, `docs/research/18-ableton-ui-
architecture.md`, `docs/research/30-ableton-clip-visualization.md`. `ROADMAP.md`, `docs/
decisions.md`, `docs/product-roadmap.md` skimmed for project context per the dotbeat skill's
"read the real docs first" convention.
