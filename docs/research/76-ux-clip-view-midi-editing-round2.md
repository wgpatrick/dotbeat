# Research 76 — Clip View / MIDI editing, round 2: Phase 27's fixes verified live, plus fresh gaps

*2026-07-12. Round 2 of the UI/UX pass started by `docs/research/71-ux-clip-view-midi-editing.md` ("research
71"). Phase 27 (`docs/phase-27-plan.md`, streams ED/EE/EF/EG) shipped four of research 71's five P0 items
against the real running app:

- **ED** — a real colored Clip View title bar (`.noteview-titlebar`, `background: track.color`, sticky to the
  top of `.noteview`).
- **EE** — dropped velocity-as-opacity encoding on grid notes (constant fill now; only the chance dashed-dim
  survives as an opacity signal) and added live floating "vel N" / "N%" pill labels while dragging a
  velocity/chance marker.
- **EF** — a second, start-edge clip-loop handle (previously end-only), both handles thickened to a 4px grip
  bar with a triangular cap so the range reads as draggable at rest, not just on hover.
- **EG** — a distinct 3px left-border accent color per stacked bottom panel (amber/cyan/blue/green/gray).

This pass does two things research 71 didn't: (1) looks at **fresh** Ableton manual detail research 71 didn't
screenshot — Draw Mode, Fold, scale highlighting, the scrub area, multi-clip/Focus Mode, and the MIDI editor's
own zoom/navigation system, none of which appeared in research 71's 37-screenshot sample; and (2) captures
dotbeat's **current, post-Phase-27** running app live, to confirm the four fixes actually read correctly
*together* (not just individually, the way each stream's own verify script checked them) and to look for
anything the fixes themselves newly exposed. Nothing already fixed by Phase 27 is re-flagged below.

**Method.** Part 1: 11 additional Ableton Live 12 manual page images viewed this pass (ch08 pp.211-212, ch10
pp.240, 242, 266, 269, 270, 272, 274, 276, 277 — chosen by grepping `ableton-chapters/ch08.txt`/`ch10.txt` for
"draw mode," "fold," "scrub," "focus mode," "zoom," "highlight scale," "multi-clip" and mapping hits back to
page images not in research 71's own 37-page sample). Part 2: a fresh Playwright capture against a real `beat
daemon` + built frontend, `examples/night-shift.beat` copied to `/tmp/dotbeat-ux2-clip/song.beat` (the owner's
`night-shift-song.beat` never touched, never read), daemon on :9203, `vite preview` on :9204 — plus, this
round, the project was walked through **song mode** (`+ section`, then each track's own "Place in Arrangement"
button) so `ClipPropertiesPanel`'s real fields and the clip-loop strip actually render (research 71's own
fixture stayed in loop mode the whole pass, where both are gated off — confirmed live again this round: `beat`
CLI has no direct "create a clip" command, so the GUI's own placement flow was used, exercising a real,
previously-undriven code path in the process). Direct reads: `ui/src/components/NoteView.tsx` (full, 1,554
lines — grew ~115 lines this phase), `ui/src/styles.css` (targeted: titlebar/drag-label/cliploop/panel-accent
blocks). Screenshots captured to `/tmp/dotbeat-ux2-clip/*.png` (ephemeral, not committed, per the task).

---

## 1. Fresh Ableton detail (Part 1) — Draw Mode, Fold, scale highlight, scrub, multi-clip, zoom

None of this appeared in research 71's 37-page sample; it fills in five things the task specifically asked to
check for.

### 1.1 Draw Mode — a real cursor-mode toggle, not just an inferred gesture

`[manual p.242, "The Control Bar's Draw Mode Toggle"]`: a literal pencil-icon button living in the Control Bar
(next to the MIDI/Key/BPM readouts at the very top of Live's whole window, not inside Clip View at all), filled
solid amber when active, toggled by clicking it or pressing **B**. Once on, click-drag inside the MIDI Note
Editor paints notes; clicking an *existing* note **deletes** it (paint and erase share the same tool, symmetric
with how a pencil works) `[manual p.242, ch10.txt:213-235]`. Two drawing behaviors, chosen by a persistent
"Draw Mode with Pitch Lock" preference: freehand melodic drawing (the drawn line's contour becomes the notes'
pitch contour) by default, or pitch-locked (every drawn note lands on the pitch first clicked) — holding
**Alt/Option** while drawing inverts whichever mode is currently selected as the default. This is a real,
separate, discoverable UI element (a Control Bar button, own keyboard shortcut, own preference) — not merely
"the underlying gesture already works so no cursor needs to change," which is how research 71 P2 item 12 scoped
it. dotbeat's roadmap already tracks the cursor-mode gap; this pass's contribution is just the concrete shape
of what to build the affordance *toward*.

**Draw Mode also works inside the Velocity Editor** `[manual p.266, "10.5.12.1 Drawing Velocities"]` — a
second, distinct use of the same toggle: with Draw Mode active, click-dragging *inside the velocity lane*
paints a run of velocity values across every note under the pointer's x-position as it moves, instead of the
single-note-anchored drag Live's velocity lane otherwise supports. Holding **Alt/Option** while drawing paints
a straight ramp between two points instead of following the cursor's raw path; adding **Shift** forces the
ramp horizontal (a flat plateau). This is a genuinely different mechanism from Ableton's separately-documented
Ramp/Randomize/Deviation *toolbar* (research 71 §1.7, already on dotbeat's roadmap as "Velocity Randomize /
Ramp toolbar") — it's a live *drag* gesture, not a batch operation with typed parameters. See §3.3 below: this
one maps directly onto a gesture dotbeat has already built, just for the wrong lane.

### 1.2 Fold — two distinct mechanisms, not one

`[manual p.270-272, "10.6 Folding and Scales"]`. The roadmap's existing "Fold mode" row (product-roadmap.md,
citing ch.10 p.269-272) already correctly scopes this as two mechanisms; this pass confirms the visual/keyboard
detail for whenever it's built:

- **Fold to Notes** (**F** key, or a "Fold" button in the Clip View header) — hides every key track with zero
  notes in the clip. On a Drum Rack, folds to rows with an assigned device even if empty of notes (a
  drum-kit-aware variant, not just "used pitches"). Screenshot `[manual p.270, "The Fold Button Extracts Key
  Tracks Containing Notes"]`: a plain rectangular "Fold" toggle button, a header row shared with "Scale" and
  "Highlight Scale," sitting directly left of the Notes/Envelopes/MPE tabs — this is the literal shape of the
  header diagram research 71 only described from the numbered-callout text (research 71 §1.6 cites the diagram
  but the page image itself, p.238, wasn't in research 71's sample; **p.240's "MIDI Note Editor Navigation"**
  image, viewed fresh this pass, is the clean, uncropped version: `[Q] [Fold] [Scale] [Highlight Scale] ... 
  [Notes][Envelopes][MPE] ... [1/16 ▾]` — confirms the grid-resolution dropdown sits at the far right of this
  exact same header row, not the toolbar below it).
- **Fold to Scale** (**G** key, only available once Scale Mode is active for the clip) — hides every key track
  that doesn't belong to the active scale, *even tracks Fold-to-Notes wouldn't have hidden*. Critically: a key
  track that already has notes on it stays visible even if it's outside the scale and Fold-to-Scale is active
  `[manual p.272, "Key Tracks Belonging to the Current Scale Displayed After Pressing the Scale Button"]` — the
  screenshot shows a real folded clip: 9 rows (G4, F4, E4, D4, C4, Bb3, A3, G3, F3 — a scale, not a chromatic
  run) each with olive/yellow-green (not the more common orange/purple seen elsewhere) track-colored notes,
  confirming Fold to Scale collapses row *count*, not just row *height*.

### 1.3 Scale Mode + Highlight Scale — two separate toggles, two separate visual strengths

`[manual p.270, "A MIDI Clip's Scale Mode Settings"]`: the Main Clip Properties panel's own Scale row — a
flat/sharp glyph toggle button (rendered as a small "♭#" icon), a root-note dropdown ("C"), and a scale-name
dropdown ("Major"), boxed together under a "Scale" label. Turning Scale Mode on gives a **subtle** highlight on
the piano ruler's own keys only. **Highlight Scale** (checkbox in the same Clip View header row as Fold/Scale,
**K** key while the MIDI editor has focus) is a *second*, stronger effect layered on top: key tracks in the
active scale get highlighted **across the entire grid width**, not just the ruler, and the root note gets its
own distinguishing mark `[manual ch10.txt:1076-1084]`. This two-strength-levels detail (ruler-only vs.
full-grid-width) refines research 71's own §1.6 description ("a persistent background wash") without changing
its substance — the roadmap's existing "Scale-lock field + scale-tone highlighting" row already covers this.

### 1.4 Multi-clip editing + Focus Mode — genuinely new ground, not touched by research 71

`[manual p.274-277, "10.8 Multi-Clip Editing" / "10.8.1 Focus Mode"]` — not mentioned anywhere in research 71.

Up to **8** MIDI clips can be edited simultaneously: in Session View, across tracks and scenes (all clips must
be looped); in Arrangement View, across up to 8 tracks over a time selection. Each selected clip gets its own
colored **loop-bar strip** stacked vertically above the shared grid (ordered by track, then scene/time); the
strips' colors match each clip's own color. Clicking a clip's note *or* its loop bar switches which clip is
"active" for single-clip operations. Root/scale readout shows an asterisk if selected clips disagree.

**Focus Mode** (`[manual p.276, "The Focus Button Toggles Focus Mode"]`, a dedicated orange pill-button
labeled "Focus," momentary-hold variant too) narrows editing to exactly one clip while still *showing* the
others: the active clip's notes render in its own clip color, every other selected clip's notes render in
gray, in the same shared grid. The active clip's own loop bar shows in clip color (turns solid black when
actively clicked/dragged); hovering an *inactive* clip's gray loop bar reveals that clip's real color and notes
as a preview, before clicking it to make it the active one. With Focus Mode off, all clips' notes show in full
color simultaneously and notes can be drawn continuously *across* clip boundaries; with Focus Mode on, drawing
is constrained to the one active clip only.

dotbeat's `NoteView` is hard-scoped to exactly one `track: BeatTrack` prop (`ui/src/components/NoteView.tsx:272`)
— there is no multi-track/multi-clip simultaneous editing surface at all, and no roadmap row for it. This is a
real, substantial *feature*, not a look/feel polish item (it needs a fundamentally different top-level
component shape, not a CSS/gesture change) — flagged in §4 as forward-looking awareness only, not scoped for a
polish phase.

### 1.5 The MIDI editor's own zoom/navigation system — richer than research 71 described

`[manual p.240, "MIDI Note Editor Navigation"]` — the clean numbered-diagram version of what research 71 only
described from the header's own callout text:

1. **Time ruler**: vertical click-drag = smooth continuous time-zoom; horizontal click-drag = scroll. Holding
   **Ctrl/Cmd** while scrolling the wheel inside the editor also changes time zoom.
2. **Note ruler** (the piano-key gutter): vertical click-drag scrolls which octaves show; horizontal click-drag
   changes the *key-track zoom level* (row height) — i.e., Ableton's row height is a first-class, always-live
   zoom axis, not (as research 71 characterized it) something that only happens as a side effect of resizing
   the whole Clip View pane. Holding **Alt/Option** while scrolling the wheel also changes key-track zoom.
3. **Double-click** on the note ruler zooms to the pitch range of the current note selection (or, with nothing
   selected, to the clip's own lowest-to-highest note); double-click on the time ruler zooms to the current
   time selection (or, with nothing selected, zooms out to the full first-note-to-last-note span).
4. **Clip View Selector** (bottom-right of Live's whole window, not inside the piano roll pane itself): a
   persistent per-clip overview thumbnail, always showing the complete clip; a black rectangle outline marks
   what's currently visible in the MIDI Note Editor above it — click-drag inside the outline to scroll, drag the
   outline's own edges to resize (= zoom) `[manual p.211-212, "The Clip View Selector Zoomed In"]`. This is the
   same primitive dotbeat's roadmap already tracks as "Overview strip (minimap)" (product-roadmap.md line 145)
   for the *Arrangement* — this pass confirms Ableton also ships a **second**, clip-scoped instance of the same
   idea, permanently visible whenever *any* clip is open, independent of the Arrangement's own minimap.

Keyboard, confirmed from `ch10.txt:112-120`: **Page Up/Down** scroll one octave; **+Shift** narrows that to one
key track; **+/-** zoom around the current time selection; **Z** zooms fully into the selection; **X** zooms
back out to the full clip; **Alt/Option+/-** zooms the key-track (row-height) axis specifically. `Z`/`X` for
time already exists on dotbeat's roadmap for the *Arrangement* (`product-roadmap.md` line 141,
"Zoom-to-selection (Z/X) + zoom-history stack") — but that row is explicitly scoped to `ArrangementView`'s own
`zoomPxPerBar` state, which the MIDI editor's grid never reads (confirmed live, §3.4 below). None of the
piano-roll-local zoom axes above (time-drag-in-ruler, key-track-drag, double-click-to-fit, Page Up/Down octave
scroll) have any dotbeat equivalent or roadmap row at all — see §4, P1.

### 1.6 Scrub area + clip start/end markers

`[manual p.211-212]`, filling in detail research 71 cited (§1.1, "the whole view can be resized...") but didn't
screenshot: clip Start/End are draggable flag-shaped markers directly on the ruler/grid (▷ pointing right for
Start, ◁ pointing left for End), each independently arrow-key-nudgeable once selected; holding **Alt/Option**
while using the arrow keys moves *both* markers together (the whole clip region, preserving its length). The
**scrub area** is the strip directly below the time ruler (and the lower half of an audio waveform): clicking
it jumps playback there if "Permanent Scrub Areas" is on in Display & Input Settings, or via **Shift-click**
if that preference is off. Confirms dotbeat's roadmap already tracks this correctly as "Scrub area +
Follow-pause-on-edit during audition" (no changes needed to that row).

---

## 2. dotbeat's current Clip View — Phase 27's four fixes, verified together live

Captured against `examples/night-shift.beat` copied to `/tmp/dotbeat-ux2-clip/song.beat`, walked through
`+ section` → `Place in Arrangement` on both `lead` (synth, salmon `#e06c75`) and `drums` (cyan `#56b6c2`) so
`ClipPropertiesPanel` and the clip-loop strip render their real state instead of the loop-mode placeholder
hint research 71's fixture was stuck showing.

### 2.1 Title bar (ED) — reads correctly, on its own

`[dotbeat file: NoteView.tsx:863-870]`, confirmed live: `.noteview-titlebar` renders a full-width strip,
`background: track.color`, `readableTextOn(track.color)` correctly picks near-white text on `lead`'s salmon and
stays legible on `drums`'s cyan too. Once a clip is placed, the bar shows `track.name` bold + `clip "s1"` in a
lighter weight directly beside it — a real analog to Ableton's clip-name-on-colored-strip (§1.1 of research
71). Sticky positioning confirmed working: scrolling the panel stack leaves the title bar pinned at the top of
`.bottom-pane-body` while grid content scrolls underneath it.

### 2.2 Velocity/chance opacity + drag labels (EE) — both confirmed working

Grid notes render at flat, constant opacity now (`NoteView.tsx:1147`, `opacity: isChancy ? 0.6 : 1` — no
`ev.velocity` term at all). Dragging a velocity bar or painting the chance lane both produce a small black pill
following the cursor (`vel 1` / `13%` observed live, screenshots `h7`/`h8` in `/tmp/dotbeat-ux2-clip/`)
— confirmed round-tripping correctly into `NoteInspector`'s own `chance` field (dragged to 13%, inspector read
back `chance: 13`).

### 2.3 Two-sided clip-loop handle (EF) — both handles present, bracket the range correctly

`[dotbeat file: NoteView.tsx:1051-1064]`, styled at `styles.css:1119-1169`: both a
`.noteview-cliploop-handle-start` and `.noteview-cliploop-handle-end` render, each with a 4px amber grip bar
and an inward-pointing triangular cap (`▷ [amber range] ◁`), visibly bracketing the loop range at rest, not
only on hover — matches Ableton's loop-brace convention (§1.6 above). Dragging either handle shows the floating
"N bars" amber pill mid-drag (confirmed live, screenshot `h4-cliploop-end-dragging.png`). In this fixture the
clip's loop already spans the full 4-bar section, so drags past either edge clamp with no visible movement —
the clamping itself is correct behavior (research 71 §2.6 documents the same start≤end-1 / end≥start+1 clamps),
just not a dramatic screenshot; the "4 bars" label rendering *at all* mid-drag is the actual thing being
verified, and it does.

### 2.4 Five-panel accents (EG) — distinct and correctly applied

Confirmed live and in code (`styles.css:1193-1266`, `3031-3038`, `3188-3195`): `.clip-props` = amber
(`var(--accent)`, `#e0a13c`), `.pitch-time-panel` = blue (`#61afef`), `.note-name-readout` = green (`#98c379`),
`.note-inspector` = gray (`#6b7280`), `.lane-panel` (drums only) = cyan (`#56b6c2`). Screenshot `h9` (lead) and
`h11` (drums) show all applicable panels stacked with genuinely distinguishable left-border color, a real
improvement over research 71's five-identical-strips finding.

### 2.5 New, concrete issues — from the fixes interacting with each other or with real content

**A full-opacity long note can visually fuse with the title bar directly above it — a direct side effect of ED
+ EE landing together.** `lead`'s fixture clip has a note at C4 spanning nearly the full 4-bar loop. Scrolled to
where that note's row sits just below the sticky title bar, the two render as one continuous salmon block —
title bar (41px, `NoteView.tsx:863`) immediately followed by the note (11px tall but full-width and full
opacity, `NoteView.tsx:1139-1147`, same `track.color`), with no visible seam between them (screenshot
`04-lead-bottom-panels.png`, cropped tight at `crop-04-zoom.png`: the "C4" row label is the only thing that
reveals it's actually two separate elements). Before EE, a loud-but-not-max-velocity note in that same
position would have rendered at reduced opacity, providing *accidental* visual separation from the solid title
bar above it; EE's own fix (flat, full-opacity notes, matching Ableton's own convention — a real improvement on
its own) removes that accidental buffer. `.noteview-titlebar` already has a `box-shadow: 0 1px 0 rgba(0,0,0,0.3)`
(`styles.css:373`) meant to separate it from what's below, but a 1px 30%-black shadow reads as essentially
invisible against a same-hue neighbor directly beneath it.

**`.editor-toolbar`'s own `.editor-title` span is now fully redundant.** `NoteView.tsx:890-892` still renders
`track.name` a second time, in `track.color` text, immediately below the new title bar that already shows the
same name more prominently (bold, 15px, on a full-color background vs. this one's plain colored text on the
page background). It's not just redundant — it's competing for space in an already-dense single toolbar row
that also holds the Preview-clip button, the full keyboard-shortcut hint sentence (research 71 §2.2's own "wall
of small gray text" finding, still present, still not addressed by Phase 27), and the Place-in-Arrangement
button.

**`--accent` (amber) is overloaded within one NoteView.** Live in the same view simultaneously: the Preview-clip
button, the Place-in-Arrangement button, `ClipPropertiesPanel`'s own EG left-border accent, the entire
clip-loop range band + both handles + its floating drag label (EF), and every chance-lane bar with `chance<100`
(`styles.css:1090-1092`, `.noteview-chance-bar.active { background: #e0a13c }` — the literal same hex as
`--accent`) all render in the identical amber. EG's own stated goal was using left-border hue to tell panels
apart at a glance (`styles.css:1186-1191`'s own comment); one color simultaneously meaning "primary button,"
"clip-properties panel," "the loop range," and "this note might not fire" works against that goal specifically
inside this view, even though amber-as-the-app's-one-accent-color is completely normal and correct everywhere
else in dotbeat.

**For drums tracks, the title bar and `DrumLanePanel`'s own EG accent are the same hue by design, not by
accident.** `styles.css:3183-3187`'s own comment: "the SAME hue as `.kind-drums` ... since this panel only ever
appears on drum tracks." Confirmed live: `drums`'s `track.color` (`#56b6c2`) and `.lane-panel`'s left-border
(`#56b6c2`) are byte-identical hex (screenshot `h11-drums-clipprops-lanepanel.png`). This is a real,
structural (not coincidental) case where ED's track-identity color and EG's panel-identity color collapse into
one signal for exactly one track kind — worth a conscious call, not necessarily a bug (see §4, P2).

**NoteView has zero zoom, confirmed by direct code read.** `--note-step-w: 14px` (`styles.css:10`) is a fixed
CSS custom property; `ROW_H = 12` (`NoteView.tsx:43`) is a fixed JS constant. Neither responds to any gesture,
scroll-wheel modifier, or keyboard shortcut anywhere in the 1,554-line component — confirmed by reading the
whole file, not just grepping for "zoom." This is a materially different and larger gap than research 71's own
§2.4 framing ("row height is a hardcoded constant, not adjustable... Ableton's window-split-drag grows row
height as a side effect") suggested — Part 1 above (§1.5) shows Ableton's zoom system is not a side effect at
all but a first-class, multi-axis, heavily-keyboard-shortcut-backed navigation system, and dotbeat's own
Arrangement-level zoom (`zoomPxPerBar`, shipped and roadmap-tracked) never touches this component. See §4, P1.

---

## 3. Prioritized new findings

Cross-checked against `docs/product-roadmap.md`'s "Note editing (piano roll)" section (60+ rows read in full)
— every item below is either genuinely new or meaningfully sharper than an existing tracked row; items already
tracked there (Fold mode, Scale-lock + highlighting, cursor-mode Draw toggle, Velocity Randomize/Ramp toolbar,
multi-select value-range affordance, loop-brace-both-edges-draggable, Arrangement zoom/minimap/zoom-to-selection,
scrub area) are deliberately **not** repeated here even where this pass found supporting Ableton detail for
them (folded into §1/§2 instead, as refinements to cite when those rows are eventually scoped).

### P0 — cheap, directly caused by this phase's own fixes landing together

1. **Give `.noteview-titlebar` a harder visual seam from whatever's directly below it.** The 1px 30%-black
   `box-shadow` (`styles.css:373`) isn't enough when a full-opacity, full-width, same-hue note sits right under
   it post-EE (§2.5). *Concrete:* a 2-3px solid dark (`#05060a`-ish, matching the octave-line color already used
   elsewhere in this file) bottom border on the title bar itself, or a thin permanent drop-shadow with more
   opacity/spread — cheap, self-contained, doesn't touch EE's own (correct) opacity fix.
2. **Delete `.editor-title` (`NoteView.tsx:890-892`).** Fully superseded by the title bar EII added; removing
   it frees real width in the toolbar row for the hint text/buttons already competing for space there (§2.5).
   A one-line diff.

### P1 — meaningful, second-tier

3. **Extend the chance lane's existing draw-across-notes gesture to the velocity lane.** dotbeat already built
   exactly the mechanism Ableton's Draw-Mode-in-Velocity-Editor needs (`onChanceLanePointerDown/Move/Up`,
   `NoteView.tsx:805-836`, a paint-while-dragging-across-multiple-notes gesture) — it just only wires to the
   chance lane. The velocity lane's own `startVelocityGesture`/`onVelPointerMove` (`NoteView.tsx:749-780`) is
   anchored to a single note captured at press-time. Generalizing chance's paint logic to also drive velocity
   (reusing `paintChanceAt`'s shape, swapping `chanceValueFromY` for `velocityFromY`) is a smaller, more
   mechanical gap than the already-tracked "Velocity Randomize/Ramp toolbar" row — this is about the *drag
   gesture* itself, not a typed-parameter batch operation (§1.1).
4. **Give NoteView its own local zoom, independent of the Arrangement's `zoomPxPerBar`.** At minimum, make
   `--note-step-w` (currently a hardcoded 14px CSS var, `styles.css:10`) respond to *something* — a per-view
   +/- control or a scroll-wheel modifier — since Ableton's own MIDI editor treats time-zoom as the single most
   load-bearing navigation primitive in the whole view (§1.5). Not previously flagged (research 71 only noted
   `ROW_H`'s fixed value, not the complete absence of any zoom axis, horizontal or vertical); not covered by
   any existing roadmap row (both "Timeline zoom" and "Zoom-to-selection" rows are `ArrangementView`-scoped and
   confirmed, by direct code read, never touch this component).
5. **Reconsider `--accent` (amber) as the color for the clip-loop range/handles specifically.** Now that EG has
   established "one hue = one panel role" as a real convention in this same view, the clip-loop strip reusing
   the app's one global accent color for a *fifth* different meaning works against that convention locally,
   even though amber-as-primary-action-color is correct everywhere else in dotbeat (§2.5). A different,
   loop-strip-specific hue (not reused elsewhere in `NoteView`) would finish what EG started.

### P2 — lower urgency, worth a conscious decision rather than a fix

6. **For drums tracks, `DrumLanePanel`'s EG accent and the ED title bar are the same hue by deliberate code
   choice, not by accident** (`styles.css:3183-3187`'s own comment cites `.kind-drums`) — confirmed live,
   byte-identical hex. This may be fine (it *is* consistent with "hue = drums" as a signal), but it's worth a
   deliberate call rather than leaving it as an unexamined side effect of two different streams' independent
   design choices, since every *other* panel's EG accent was deliberately chosen to be distinct from anything
   else in the view (§2.5).
7. **Multi-clip editing / Focus Mode has zero dotbeat equivalent** — `NoteView` is hard-scoped to one `track`
   prop (`NoteView.tsx:272`); there's no way to view or edit more than one clip's notes at once, and no
   roadmap row for it (§1.4). This is a real feature requiring a different component shape, not a look/feel
   change appropriate for a UI-polish phase — flagged for roadmap awareness only.

---

## 4. Sources

- Ableton Live 12 manual, rendered page images, viewed fresh this pass (not reused from research 71's 37-page
  sample): `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch08/p-211.jpg`, `p-212.jpg`; `.../ch10/
  p-240.jpg`, `p-242.jpg`, `p-266.jpg`, `p-269.jpg`, `p-270.jpg`, `p-272.jpg`, `p-274.jpg`, `p-276.jpg`,
  `p-277.jpg` (11 pages). Raw chapter text cross-referenced at `.../ableton-chapters/ch08.txt` (lines
  729-800, 922-925) and `ch10.txt` (lines 46, 82-120, 162-235, 452, 873-874, 946, 1034-1338) to locate which
  pages to view, per the task's specific ask (Draw Mode, Fold, scale-highlighting, scrub area, multi-clip/Focus
  Mode, zoom/navigation).
- dotbeat, direct reads: `ui/src/components/NoteView.tsx` (full, 1,554 lines), `ui/src/styles.css` (targeted:
  lines 1-15, 355-410, 1040-1310, 3020-3200).
- dotbeat, live-captured screenshots this pass (Playwright via `playwright-core`, headless Chromium,
  1440×1000-1200, against a real daemon on a throwaway copy of `examples/night-shift.beat` at
  `/tmp/dotbeat-ux2-clip/song.beat`, `beat daemon` on :9203, `vite preview` on :9204, both torn down at the end
  of this pass): `/tmp/dotbeat-ux2-clip/{01-11,fp-,g1-g11,h0-h11}*.png` and `crop-04-zoom.png` (ephemeral, not
  committed).
- `docs/research/71-ux-clip-view-midi-editing.md` and `docs/phase-27-plan.md` — read in full first, per the
  task, so nothing already fixed or already tracked is re-flagged.
- `docs/product-roadmap.md`'s "Note editing (piano roll)" section (~60 rows) read in full to confirm every
  item in §3 above is genuinely new, not a duplicate of an already-tracked row.
