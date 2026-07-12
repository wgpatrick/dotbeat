# Research 74 — UX deep dive: drag-and-drop as a cross-cutting interaction pattern

*2026-07-12. A visual/interaction pass specifically about drag-and-drop — not one surface, all of
them at once. Grounded in (a) actually viewing 32 of the Ableton Live 12 manual's screenshots
across four chapters and (b) actually driving dotbeat's own real GUI with Playwright, capturing
and reading mid-drag screenshots (not just before/after states) for four separate drag surfaces.
Research-only; no product code was changed.*

## 1. Scope, and how this differs from research 18/30/32/34/36/44/50-63/70-73

No prior doc in this repo treats drag-and-drop as its own topic across the whole app. Several
existing UX passes cover drag gestures *as part of* a surface-specific comparison — research 70
(Arrangement View: clip move/resize cursors), research 71 (Clip View/MIDI editing: note-drag,
velocity-marker drag, loop-brace drag), research 72 (Device View: effect-chain reorder, the knob
widget's own drag-only interaction), research 73 (the Content Browser: drag *source* affordance +
the one drop-target highlight it found). This pass does not re-derive their per-chapter findings
from scratch — it cites them where they already did the work — and instead asks a narrower,
genuinely different question: **do dotbeat's four real drag-and-drop implementations agree with
each other on what "you are dragging something" and "this is a valid place to drop it" look like?**
They turn out not to, in ways worth fixing as one shared pattern rather than four one-off ones —
and one of those four turns out to have a real functional bug (not just a cosmetic gap) that no
prior pass caught, because catching it required watching a live drag frame-by-frame rather than
reading code or a static screenshot.

## 2. Ableton's drag-and-drop conventions, screenshot-grounded, by pattern

Sources actually viewed this pass: ch03 *Live Concepts* (pp.33-52, 8 pages — general drag
conventions, the browser overview, sample preview), ch04 *Working with the Browser* (pp.60-118, 8
pages — browser layout, drag-out-of-browser prose), ch06 *Arrangement View* (pp.150-168, 8 pages —
clip move/resize, loop brace, track height, fades), ch08 *Clip View* (pp.185-216, 8 pages — clip
start/end markers, scrub areas, sample replace-by-drop). 32 pages total, at
`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/`.

### 2.1 Ghost/preview rendering: one strong example, and a wall of prose everywhere else

The single most useful pair of screenshots in the whole sample is ch06 p.161, **"Moving a Clip"**
and **"Changing a Clip's Length."** "Moving a Clip" is genuine direct manipulation: the dragged
clip's own waveform/MIDI-tick content is rendered translucently at its *new* position, overlapping
the destination track's gray background, while a small drag-cursor glyph (an arrow with a tiny
page/rectangle icon) sits at the pointer — there is no separate "ghost" floating independently of
the real content; the clip *is* its own preview, just relocated live. "Changing a Clip's Length"
shows the resize case: a black-bordered box frames the edge handle with a bracket-shaped (`]`)
resize cursor glyph, distinct from the plain arrow used for moving.

That pair is the exception, not the rule. Every *other* drag interaction sampled this pass — the
browser drag-out interaction (ch04 pp.99-118, "you can drag it onto an audio or MIDI track," "drag
samples directly into devices such as Sampler, Simpler, Drum Rack"), the loop-brace drag (ch06
p.159), the sample-replace-by-drop interaction (ch08 p.216, "drop the new sample directly from the
browser into the Clip View") — is documented **entirely in prose**, with no mid-drag screenshot
anywhere in the sampled pages showing what a browser item looks like while it's being dragged over
a valid target. This is itself worth naming plainly: the manual's screenshot practice is to capture
static before/after states, and ch06's clip-move pair is a rare, deliberate exception rather than
the house style. Treat "Ableton visually ghosts a browser-drag" as *plausible from general
familiarity with the product* but **not confirmed by anything actually viewed this pass** —
research 73 independently reached the same "unconfirmed on the Ableton side" conclusion for this
exact interaction (§2.8 there), and this pass's own broader four-chapter sample agrees.

### 2.2 Drop-target highlighting: also not screenshotted, anywhere sampled

Same finding, restated for the drop side specifically: no image across all four chapters shows a
track header, a clip slot, or a lane with any kind of highlighted-while-a-drag-is-over-it treatment
(colored border, background tint, glow). The manual asserts the *behavior* in prose ("Items can be
dragged and dropped from the browser into tracks in the Session or Arrangement View... Dragging and
dropping content from the browser into the space to the right of Session View tracks or below
Arrangement View tracks will create a new track" — ch04 p.118) without a visual of the moment
itself. Combined with §2.1, the honest summary is: **this specific 32-page sample of the manual
documents drag-and-drop primarily through written instructions, with cursor/handle iconography as
the only reliably-screenshotted visual language**, not through captured mid-drag frames of
highlighting or ghosting for the browser-to-track case specifically. dotbeat's own drop-target
highlight (§3.1 below) therefore isn't chasing a documented Ableton visual at all — it's an
invention that happens to be a reasonable one, a point research 73 already made about the browser
surface specifically and this pass confirms holds for the other three surfaces too.

### 2.3 Cursor/handle iconography — the part that *is* consistently screenshotted

Where Ableton's screenshots are reliably informative is the **static, at-rest and during-drag
cursor glyph**, confirmed across chapters:

- A bracket-shaped resize cursor (`]`) at a draggable edge — clip length (ch06 p.161), and the
  same family reappears at the clip start/end markers in Clip View, rendered as filled **triangular
  flag handles** distinct from the surrounding ruler chrome (ch08 pp.212-213, "The Clip Start and
  End Markers").
- A vertical double-headed resize arrow at a track's unfold-height split line (ch06 p.164,
  "Adjusting an Unfolded Track's Height") — a completely different glyph family from the clip-edge
  bracket, correctly signaling "this drags height, not time."
- A generic move-cursor (arrow + small page icon) for clip-body dragging (ch06 p.161).

The throughline: **Ableton uses a different, purpose-specific cursor glyph per drag axis/action**
(move vs. resize-time vs. resize-height), and those glyphs are the one part of the interaction
consistently worth a screenshot. That's a real, cheap, transferable lesson independent of the
ghost/highlight question above.

### 2.4 Snap-to-grid visual feedback: prose only, in the sampled sections

ch06 p.160-161 states the behavior plainly — "Clips snap to the editing grid, as well as various
objects in the Arrangement including the edges of other clips, locators and time signature
changes" — but no screenshot in any of the four sampled chapters shows a highlighted snap line, a
magnetized-guide indicator, or any other live visual confirming *where* a drag will land before you
release. This is a genuine, confirmed gap in what's documented, not a claim that Ableton lacks the
feature (it plausibly renders one live, just not shown in this sample) — flagged the same honest
way §2.1-2.2 are.

### 2.5 Modifier-key cues: also prose-only, and this matters for dotbeat directly

ch06 p.161 documents real modifier-triggered behavior changes during a clip-content drag: hold
`Ctrl+Shift` (Win) / `Shift+Option` (Mac) to slide a clip's *contents* within its boundaries instead
of moving the clip itself; hold `Ctrl+Alt+Shift` (Win) / `Cmd+Option+Shift` (Mac) to bypass grid
snapping entirely. Neither modifier state gets an on-screen badge, icon, or cursor change in any
screenshot sampled — the user is expected to know and remember which chord does what. **This is the
one place this pass can say plainly "Ableton doesn't do better here either"** — which matters
because it reframes the corresponding dotbeat gap (§4, P1) as a genuine opportunity to exceed the
reference rather than merely close a parity gap.

## 3. dotbeat's own drag-and-drop implementations, inventoried

Found via `grep -rn "onDragStart\|onDrop\|onDragOver\|draggable\|dataTransfer" ui/src/components/`
plus a manual check for pointer-based (non-native-DnD) drag gestures, since two of the app's four
real drag surfaces move by tracking `onPointerMove`, not the HTML5 drag API. All four were driven
live this pass against a real `beat daemon` + built UI (`npm run build` at repo root and in `ui/`),
on a disposable copy of `examples/night-shift.beat` at `/tmp/dotbeat-ux-dnd/song.beat` — the
owner's own `examples/night-shift-song.beat` was never touched, per instruction. Screenshots at
`/tmp/dotbeat-ux-dnd/*.png`.

### 3.1 Library → track/lane drop (`ContentBrowser.tsx` source, `ArrangementView.tsx` +
`NoteView.tsx` targets)

Source: `ContentBrowser.tsx`'s `PresetRow`/`KitLaneRow`/`KitGroup`/`SoundfontRow` (lines 93-176)
are each `draggable`, calling `setDragPayload(e.dataTransfer, {...})` — a JSON payload under a
custom MIME type `application/x-dotbeat-library-item` (`ui/src/daemon/library.ts:198-208`). No
`setDragImage()` call anywhere — the browser's default translucent row-snapshot ghost is whatever
Chrome renders, unstyled.

Two independent drop targets exist for the *same* payload type, and they render two *different*
visual languages:

- **`ArrangementView.tsx`'s track header** (`handleLibraryDrop`, lines 567-610;
  `onDragOver`/`onDragLeave`/`onDrop`, lines 749-756) toggles a `dropHover` boolean into a real,
  named CSS class: `.drop-target-hover { outline: 2px dashed var(--accent); outline-offset: -2px;
  background: rgba(224, 161, 60, 0.12); }` (`styles.css:2779-2783`) — a dashed amber outline plus a
  faint amber tint. Confirmed live: `/tmp/dotbeat-ux-dnd/1-library-drop-mid-drag.png` shows exactly
  this on the "bass" track header mid-drag.
- **`NoteView.tsx`'s per-lane drop target** (drum-lane rows only, lines 883-906) uses a *completely
  separate, ad hoc* mechanism: an inline style, `background: dropHoverRow === row ? '#2f5d3a' : ...`
  (line 915) — a hardcoded dark-green fill, no CSS class, no shared token, no relationship to
  `--accent` or to `.drop-target-hover` at all. Same conceptual interaction (a library item hovering
  a valid drop target), two unrelated visual signals depending on which panel you're looking at.

**A real bug found by watching this live, not by reading the code**: the track-header highlight is
*fragile* in ordinary use. `.arr-track-header` is densely packed with interactive children — a
group-pick checkbox, a color swatch, the track-select/rename button, a delete button, and an
`InlineStrip` of mute/solo/volume/pan sliders — and `onDragLeave={() => setDropHover(false)}` (line
755) is a bare boolean with no dragenter/dragleave counter and no `relatedTarget`/`contains()`
check. Native `dragenter`/`dragleave` target the *deepest* element under the cursor, the same way
`dragover` does; crossing from the header's bare background onto *any* child re-fires `dragleave`
on the header and cancels the highlight. Verified directly: an `elementFromPoint` scan of the
header's ~14,500px² area found only ~200 individual pixels where `elementFromPoint` resolves to the
header itself rather than a child — everywhere else, a cursor arriving there mid-drag will
momentarily un-highlight the target. This first surfaced as the screenshot capture script's target
point landing on a child (the InlineStrip's mute/solo slider), producing a plain, unhighlighted
`.arr-track-header` class in the DOM despite `dragover` firing correctly with the right payload
type (confirmed via an injected listener logging `dragover fired, types=
["application/x-dotbeat-library-item"]`). Only after re-targeting the mouse at one of the ~200 bare
pixels did the highlight render steadily. **This is a functional interaction bug, not a cosmetic
gap** — a real user's cursor naturally crosses the mute/solo strip while approaching a header from
below, and the highlight will visibly flicker or vanish exactly when they need it most (right before
release).

`NoteView.tsx`'s per-row target doesn't share this specific bug (each row is a flat leaf element
with no children under the cursor), but it inherits the same underlying design smell: no shared
drop-target primitive, so each new consumer reinvents the enter/leave bookkeeping from scratch.

Both drop targets *do* set `dropEffect = 'copy'` (`ArrangementView.tsx:752`, `NoteView.tsx:888`),
which gives the OS-level copy cursor (typically a small `+` badge) for free — a real, if minor,
positive: it's the one piece of "this drop creates something new, not moves it" feedback that
*isn't* fragile, since it's native browser chrome rather than app-rendered state.

### 3.2 Note drag (`NoteView.tsx`, pointer-based — not native HTML5 DnD)

Unlike §3.1, moving a note in the piano roll/drum-lane grid is **not** built on `draggable`/
`dataTransfer` at all — it's a hand-rolled pointer gesture: `startGesture('move', ev, e)` on
`onPointerDown` (line 1052) captures the pointer and computes a `group` of every selected event's
original `(start, row)`; `onPointerMove` (line 432) recomputes a live `preview` position per event,
snapped via `snapStep` (grid-snap by default, Alt/Cmd held *during* the move bypasses it —
"freehand"); `onPointerUp` commits via `commitMove`, which fans out one `postEdit` per changed
field. A rigid-group clamp (`clampGroupMove`, line 333) stops the *whole* selection at the grid
boundary the instant any one member would go out of bounds — the exact behavior research 71 already
confirmed as Ableton's own convention ("moves the whole selection as a rigid body and stops it when
any note hits an edge").

The rendered note itself *is* the live preview — line 1010, `const shown = preview?.[ev.id] ?? ev`
— directly analogous to Ableton's "Moving a Clip" direct-manipulation style (§2.1). But where
Ableton's clip-move screenshot shows a visually distinct state (translucent overlay + a special
cursor), dotbeat's dragged note gets **zero visual distinction from a static note**. Confirmed by
directly logging the DOM mid-drag: `document.querySelectorAll('[data-note-id]')[0].className` reads
`"noteview-note selected"` — identical to its resting selected state, no `dragging` token, no
opacity change, no outline, no elevated `z-index`. The only signal that anything is happening is the
note's own position changing. `/tmp/dotbeat-ux-dnd/4-note-drag-mid-drag.png` (a zoomed clip of the
grid) shows exactly this: a moved note renders as a plain colored bar, pixel-identical in style to
every other note in the clip.

Two real, non-cosmetic gaps this creates:

1. **The Alt/Option "duplicate instead of move" mode** (checked once, at gesture *start* — the
   code's own comment explains why `Cmd/Ctrl` can't fill this role, since those are reserved for
   multi-select) has no on-screen indicator of which mode is currently armed. A user who presses Alt
   a beat too late, or releases it mid-drag expecting it to still count, gets a silent wrong result.
2. **The freehand/bypass-grid modifier** (Alt/Cmd, checked continuously) likewise gives no visual
   cue — no cursor change, no "off-grid" badge — so a note landing slightly askew of the grid reads,
   at a glance, as a bug rather than an intentional freehand placement.

Per §2.5, Ableton's own manual doesn't screenshot equivalent modifier cues either — so neither gap
is a regression versus the reference. But they're both cheap, concrete opportunities to do better
than the reference, not just catch up to it (see §4, P1).

### 3.3 Effect-chain reorder (`SynthPanel.tsx`'s `EffectRow`)

Full native HTML5 DnD (`draggable`, `onDragStart`/`onDragOver`/`onDrop`/`onDragEnd`, lines 178-195).
Local `dragState` (`{draggingId, overId}`) drives two classes: `.effect-row.dragging { opacity: 0.4
}` on the source, `.effect-row.drop-target { border-color: var(--accent) }` on whichever row is
currently hovered (`styles.css:703-708`). Confirmed live —
`/tmp/dotbeat-ux-dnd/2-effect-reorder-mid-drag.png` shows the Compressor row picking up a clean
amber border the instant the dragged EQ3 row passes over it, no flicker (this target has no packed
children the way §3.1's track header does — `EffectRow` itself is the leaf drag/drop surface, so
the dragleave-on-child bug from §3.1 doesn't apply here).

Notably, this is the **only** surface in the inventory with a persistent, at-rest "this is
draggable" affordance: a `⠿` (braille-pattern) drag-handle glyph (`.effect-drag-handle`,
`cursor: grab`) rendered *before any drag starts*, plus explicit `▲`/`▼` move-up/move-down buttons
as a non-drag fallback (the code comment names this as deliberate — "a much more reliable hook for
automated verification than simulating native HTML5 drag events," and, not incidentally, a real
accessibility win). Neither of §3.1's or §3.2's surfaces offer any equivalent — a library row or a
piano-roll note give no visual cue that they're draggable until you've already tried.

### 3.4 Section reorder (`ArrangementView.tsx`'s song-section chips)

Also full native DnD (lines 2338-2360), and the code's own comment says it deliberately mirrors
§3.3's treatment: `.arr-section-chip.dragging { opacity: 0.4 }`,
`.arr-section-chip.drop-target { border-color: var(--accent); box-shadow: inset 0 0 0 1px
var(--accent) }` (`styles.css:2473-2479`) — same opacity value, same accent-border idea, plus an
inset glow the effect row doesn't have. Confirmed live via a zoomed capture
(`/tmp/dotbeat-ux-dnd/3-section-reorder-mid-drag-zoom.png`): the dragged "s1" chip dims, the
hovered neighbor picks up a crisp amber border. Also carries its own `⠿` drag handle
(`.arr-chip-drag-handle`) and `◀`/`▶` fallback buttons — the same good pattern as §3.3, again
absent from §3.1/§3.2.

This is genuinely **the same pattern implemented twice, independently** — two separate pieces of
local component state (`dragState` vs. `sectionDrag`), two separate CSS blocks that happen to agree
on `opacity: 0.4` and `border-color: var(--accent)` by deliberate copy-paste (per the comment) but
aren't actually sharing code. Any future third reorderable list (e.g. the roadmap's already-scoped,
not-yet-built "Reorder tracks by dragging" — `docs/product-roadmap.md`, Track management) is the
obvious next candidate to either copy this pattern a third time or, better, extract it once (§4,
P0).

### 3.5 Bonus surface: cross-track clip-block move (`ArrangementView.tsx`'s `arr-clip-block`,
pointer-based)

Not in the prompt's original four, found while reading `ArrangementView.tsx`: moving a selected
clip occurrence between tracks/positions (research 70's "Visualize clips... cross-track
select/move") is **also** pointer-based, not native DnD — a third distinct implementation style
alongside §3.2's note-drag. Its `.arr-clip-block.dragging` treatment (`styles.css:1793-1798`) is
yet a **third, independently-invented** visual signal: `opacity: 0.65` (not 0.4, not fully
transparent), `border-style: dashed`, `cursor: grabbing`, and `z-index: 4` to lift it above
siblings during the drag. Different opacity value, different border treatment, different cursor
handling than either §3.3/§3.4's native-DnD pattern or §3.2's *no* treatment at all.

Counting all five: dotbeat currently has **four different visual answers** to "something is
currently being dragged" (opacity 0.4 + solid accent border on drop target / opacity 0.65 + dashed
border + grabbing cursor / a hardcoded green background swap / literally no change at all), across
five drag surfaces, with zero shared code between any of them.

## 4. Prioritized UI/UX changes

Rated for a **UI-polish-focused phase**. The core recommendation, stated once up front so the table
doesn't bury it: **build one shared "drag state" visual + interaction primitive (a hook or a small
set of CSS custom properties/classes) and migrate all five surfaces onto it**, rather than
patching each surface individually — consistency across drag gestures is a real, user-visible
coherence win on its own, distinct from any single surface's polish.

| # | Change | Priority | Why / what it touches |
|---|---|---|---|
| 1 | **Fix the track-header/lane drop-target `dragleave` bug** (§3.1) — replace the bare `onDragLeave={() => setDropHover(false)}` with a proper enter/leave counter, or a `relatedTarget`-aware check (`if (!e.currentTarget.contains(e.relatedTarget)) setDropHover(false)`). Applies to both `ArrangementView.tsx`'s track header and (structurally, for future-proofing) `NoteView.tsx`'s lane rows. | **P0** | This is a *functional* bug, not cosmetic — the one drop-target highlight in the app that's supposed to reassure a user mid-drag flickers off across ~98% of the target's own surface area in ordinary use. Cheap, self-contained, no format/data change. |
| 2 | **One shared drop-target-highlight primitive**, replacing both `ArrangementView.tsx`'s `.drop-target-hover` (dashed outline) and `NoteView.tsx`'s hardcoded `#2f5d3a` inline background with the same class/hook. | **P0** | Directly closes the "two different visual answers to the same interaction" gap in §3.1. Small surface area (two call sites today), but every future drop target (track reorder, a future audio-region drop, etc.) should inherit this by construction rather than invent a fifth variant. |
| 3 | **Give the piano-roll note-drag *some* "currently being dragged" visual treatment** (§3.2) — reuse the exact opacity/outline token from item 4 below rather than inventing a new one. | **P0** | Right now this is the only drag surface in the app with zero visual distinction between static and dragging, which is a real regression relative to dotbeat's *own* other four surfaces (all of which dim/outline/shadow something), not just relative to Ableton. Mechanically trivial — the `preview` state driving position already exists; this is a className addition. |
| 4 | **Unify the app's three-to-four independent "dragging" opacity/border treatments** (§3.3 effect-row: opacity 0.4 + accent border; §3.5 clip-block: opacity 0.65 + dashed border + grabbing cursor; §3.1/§3.2: none) into one canonical token/class, then point every surface at it. | **P1** | This is the connective-tissue fix the whole pass is arguing for: five surfaces, four unrelated answers to the same visual question. Sequencing after items 1-3 so the canonical treatment is defined once those are already touching the relevant code. |
| 5 | **Add an at-rest drag-handle affordance** to `ContentBrowser.tsx` rows and piano-roll notes, matching the `⠿` handle + `cursor: grab` already used for effect rows and section chips (§3.3, §3.4). | **P1** | Right now two of five drag surfaces give no cue *before* a drag starts that the item is draggable at all — discoverability rests entirely on printed hint text below the grid (`NoteView.tsx`'s hint string) or nothing (`ContentBrowser.tsx`). Cheap, and directly reuses an existing, proven pattern rather than inventing a new one. |
| 6 | **Custom `setDragImage()` for library-item drags**, replacing the browser's default translucent full-row snapshot (preview button, param count and all) with a small, purpose-built icon+name chip. | **P1** | Grounded contrast: Ableton's own strongest example (§2.1, "Moving a Clip") is a content-accurate preview of the thing moving, not incidental UI chrome. Research 73 flagged this as P2 for the browser specifically; this pass keeps it P1 because it's now understood as part of a five-surface pattern, not a one-off browser nicety. |
| 7 | **On-screen cue for the note-drag's Alt/Option modifiers** (§3.2: duplicate-vs-move at gesture start, freehand-bypass-grid throughout) — a small badge or an OS-style `+`/off-grid cursor swap the instant the modifier is detected. | **P1** | Per §2.5, Ableton's own manual doesn't do this either, so this is explicitly a "go beyond the reference" item rather than a parity gap — but it's cheap (the modifier state is already read every `onPointerMove`) and removes a real "did that duplicate or move?" uncertainty that's easy for a user to hit. |
| 8 | **Live snap-to-grid visual feedback** during a drag (a highlighted grid column/row at the computed snap target) for the note-drag and clip-move surfaces. | **P2** | Missing everywhere in dotbeat, and — per §2.4 — not confirmed as an Ableton screenshot pattern either in this sample, so this is aspirational polish, not a documented gap to close. The snapped position is already computed live (`snapStep`, `ArrangementView.tsx`'s own grid snap) — this is a pure render addition, no new logic. |
| 9 | **A non-drag fallback for library→track/lane placement** (e.g., select a track, then click a preset row's own "apply" action), mirroring the `◀`/`▶` fallback pattern effect rows and section chips already have. | **P2** | Currently dragging is the *only* way to apply a preset/kit sample/soundfont from the browser — worse for accessibility, and it's exactly why `ui/verify-phase22-content-browser.mjs` has to fully simulate native DnD rather than click a button. Sequenced after items 1-2 land so the fallback and the drag path share the same underlying apply function (they already do — `applyPresetToTrack`/`installKitLane`/`installSoundfont` are called from `handleLibraryDrop`, not reinvented). |
| 10 | **Bake the unified pattern into the next new reorderable list before it ships** — the roadmap's already-scoped, not-yet-built "Reorder tracks by dragging" (`docs/product-roadmap.md`, Track management) should consume item 4's canonical token from day one instead of becoming a fifth bespoke implementation. | **P2, sequencing note, not new work.** | Free if items 1-4 land first; expensive to retrofit later once a fifth ad hoc treatment exists. Not a standalone task — a constraint on however that feature gets built. |

## 5. Sources

**Ableton Live 12 Reference Manual**, screenshots actually viewed this pass (owner-supplied PDF,
gitignored, rendered to per-page JPEGs at
`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/`): ch03 *Live Concepts* pp.33, 34,
35, 43, 44, 50, 51, 52; ch04 *Working with the Browser* pp.60, 61, 72, 99, 100, 114, 117, 118; ch06
*Arrangement View* pp.150, 153, 159, 160, 161, 164, 167, 168; ch08 *Clip View* pp.185, 190, 198,
200, 210, 212, 213, 216 — 32 pages total, cross-referenced against each chapter's `pdftotext
-layout` text extract at `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-chapters/ch0{3,4,6,8}.txt`
(searched for "drag", "snap", "cursor", "highlight", "ghost", "preview" specifically).

**dotbeat internal**, read directly this pass: `ui/src/components/ContentBrowser.tsx` (full file),
`ui/src/components/ArrangementView.tsx` (`handleLibraryDrop` lines 567-610, track-header drop
target lines 743-757, clip-block drag lines 839-848, section-chip reorder lines 2330-2385),
`ui/src/components/NoteView.tsx` (library-drop-onto-lane lines 860-930, note-drag gesture machinery
lines 294-490, note render lines 1009-1060), `ui/src/components/SynthPanel.tsx` (`EffectRow` lines
153-220), `ui/src/daemon/library.ts` (`setDragPayload`/`readDragPayload`/`LIBRARY_DND_MIME`),
`ui/src/styles.css` (`.effect-row`/`.drop-target` lines 695-734, `.arr-clip-block.dragging` lines
1785-1798, `.arr-section-chip` lines 2465-2487, `.drop-target-hover` lines 2777-2783).

**Live captures**, this pass: four mid-drag Playwright screenshots plus two zoomed crops of the
real running app, driven against a real `beat daemon` + a real built UI (`npm run build` at repo
root and in `ui/`) on `/tmp/dotbeat-ux-dnd/song.beat` (a disposable copy of
`examples/night-shift.beat` — the owner's own `examples/night-shift-song.beat` was never touched),
using the existing daemon/preview-server launch pattern from
`ui/verify-phase22-content-browser.mjs` (not itself modified) and the raw `page.mouse.down`/`move`/
`up` low-level drag pattern from `ui/verify-phase19-piano-keys.mjs`. Files:
`/tmp/dotbeat-ux-dnd/1-library-drop-mid-drag.png`, `2-effect-reorder-mid-drag.png`,
`3-section-reorder-mid-drag{,-zoom}.png`, `4-note-drag-mid-drag{,-zoom}.png`. The dragleave bug in
§3.1 was additionally confirmed via an `elementFromPoint` scan and a direct `dragover`-event
listener injected into the live page (not screenshotted — a console-log-based check), not from
reading the screenshot alone.

**Cross-referenced, not duplicated**: [`docs/research/70-ux-arrangement-view.md`](70-ux-arrangement-view.md)
(clip move/resize cursor detail), [`docs/research/71-ux-clip-view-midi-editing.md`](71-ux-clip-view-midi-editing.md)
(note-drag/velocity-marker/loop-brace gesture detail), [`docs/research/72-ux-device-view.md`](72-ux-device-view.md)
(effect-chain reorder mechanics, the knob widget's own drag interaction),
[`docs/research/73-ux-browser.md`](73-ux-browser.md) (the Content Browser's drag *source* affordance
and its own read of `.drop-target-hover`, which this pass extends with the dragleave-fragility
finding §3.1 turned up). Also: [`docs/research/18-ableton-ui-architecture.md`](18-ableton-ui-architecture.md)
(named "drag-and-drop is the universal creation idiom," cited in `ContentBrowser.tsx`'s own header
comment) and [`docs/research/30-ableton-clip-visualization.md`](30-ableton-clip-visualization.md)
(the clip-block cross-track move this pass adds as a fifth surface, §3.5) for the original design
rationale of the surfaces inventoried here.
