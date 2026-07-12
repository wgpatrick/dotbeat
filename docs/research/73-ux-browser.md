# Research 73 — UX deep dive: the Content Browser, Ableton's screenshots vs. dotbeat's real screen

*2026-07-12. A visual/interaction-implementation pass over dotbeat's content browser, grounded in
(a) actually viewing 24 of the Ableton Live 12 manual's chapter-4 screenshots (not just its prose)
and (b) actually driving dotbeat's own real GUI with Playwright and reading the resulting
screenshots. Research-only; no product code was changed.*

## 1. What this covers, and how it differs from research 32

[`docs/research/32-ableton-browser.md`](32-ableton-browser.md) is a **feature-presence**
comparison: it read chapter 4's *text* only (`pdftotext -layout` doesn't extract image content)
and produced an (a)/(b)/(c) table of which *capabilities* Ableton's browser has that dotbeat's
does or doesn't — search, tags, Collections, keyboard nav, and so on. It says outright: "exact
pixel/layout choices... need a live-Ableton or screenshot check before they drive an irreversible
pixel decision." This pass is that check.

This document does **not** re-litigate feature presence — research 32's absence list (no search
bar, no tags, no Collections, no keyboard nav, etc.) still stands and is treated as ground truth
here. Instead, this pass asks a narrower, complementary question: for the pieces dotbeat **already
has** (a sidebar rail, section headers, draggable rows, a preview button), exactly how do they look
and behave at the pixel/gesture level, compared to how Ableton's equivalent pieces look and behave
— row height, icon placement, indentation, hover states, drag cursor, spacing rhythm, typography
weight. The goal is a punch list specific enough to hand to a developer for a UI-polish phase, on
the assumption that missing backend features (search index, tag storage, etc.) are a separate,
already-tracked body of work.

**Sources for this pass**: 24 rendered page images from the Live 12 manual's chapter 4 (pp. 60,
61, 62, 63, 66, 69, 72, 75, 78, 80, 81, 84, 90, 93, 96, 99, 108, 111, 114, 115, 116, 117, 118, 119
— `/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch04/p-0NN.jpg`, actually viewed,
not inferred from captions), cross-referenced against the chapter's prose
(`.../ableton-chapters/ch04.txt`) for terminology; and six fresh screenshots of dotbeat's own
browser taken this pass against a real `beat daemon` on a disposable copy of
`examples/night-shift.beat` (never the owner's live `night-shift-song.beat`), at
`/tmp/dotbeat-ux-browser/screenshot-0{1,2,3,4,5,6}.png`, plus a direct read of
`ui/src/components/ContentBrowser.tsx` and its CSS block in `ui/src/styles.css`
(`.library-rail` through `.lib-kit-lane`, lines 2602-2784).

## 2. Ableton's Browser — visual and interaction detail, screenshot-grounded

### 2.1 Overall anatomy (p.60's annotated diagram)

The manual's own numbered layout diagram [p.60] is the single most useful image in the chapter —
it labels eight pieces as a checklist Ableton itself considers load-bearing: **(1)** sidebar
(Collections/Library/Places), **(2)** Browse Back/Forward, **(3)** search field, **(4)** Show/Hide
Filter toggle + Filter View menu, **(5)** Filter View (filter groups + tags), **(6)** Results bar
(filter count + Add Label + Clear), **(7)** content pane, **(8)** Preview tab. Visually, this is a
**two-column layout inside one resizable panel**: a narrow (~110px in the screenshot) sidebar on
the left, a wider content area on the right, split by a **manually draggable middle divider**
[p.61] — not two independent panels, one panel with an internal splitter. The whole browser
docks as a **left-hand panel of the main window**, resizable by dragging its right edge, and has a
dedicated **Full-Height Browser** view-menu mode that keeps Clip/Device View open (a plain
edge-drag resize closes them) [p.61].

### 2.2 Sidebar structure, spacing, indentation

Screenshots [p.60, p.66, p.69, p.80, p.84, p.90, p.114] show the sidebar as **flat, unindented
label lists grouped under bold section headers** — no tree lines, no chevrons on top-level items.
Structure, top to bottom:

- **Collections** — a fixed list of color-name rows (`Green`, `Blue`, `Purple`, `Gray` in most
  screenshots; a 7-color set — `Favorites` (red), `Orange`, `Yellow`, `Green`, `Blue`, `Purple`,
  `Gray` — appears in the Edit-mode screenshot [p.81]). Each row is a small solid-color square
  (~10x10px) immediately left of the label text, both left-aligned at the same x-position as every
  other sidebar row — **no visual nesting**, Collections is a flat palette, not a hierarchy.
- **Library** — a second flat list, plain monochrome glyph icons per row (`All`, `Sounds`, `Drums`,
  `Instruments`, `Audio Effects`, `MIDI Effects`, `Modulators`, `Max for Live`, `Plug-Ins`, `Clips`,
  `Samples`, `Grooves`, `Tunings`, `Templates`) — each icon is a distinct pictogram (a stack of
  bars for `All`, a note glyph for `Sounds`, a drum-shape for `Drums`, a piano-roll grid for
  `Instruments`, an FX-box for `Audio/MIDI Effects`) rather than a generic folder icon reused
  everywhere — icon-per-content-type is real and consistent.
- **Places** — a third flat list (`Packs`, `Splice`, `Cloud`, `Push`, `User Library`,
  `Current Project`, then any **User Folders** added via `Add Folder...` at the bottom [p.69,
  p.114]) — user folders get a plain closed-folder icon, indistinguishable from each other except
  by name.

Section headers (`Collections`, `Library`, `Places`) are small, gray, unbolded label text with
extra vertical whitespace above them (roughly 1.5-2 row-heights) — visually a **soft break**, not
a heavy divider line. Each row itself is compact: roughly 22-24px tall going by the screenshot
proportions, icon-then-label, no visible per-row hover highlight distinct from the *selected* row's
solid pale-blue background fill (`Sounds` selected in [p.60], `Instruments` selected in [p.62]).
Only the *selected* sidebar row gets a background fill; unselected rows have no border, no
alternating shade, nothing — the list reads as plain text until you click.

**Nested folders inside a Places location** (e.g. an installed Pack's contents, or the content pane
when browsing `Instrument Rack` devices) *do* indent, but this happens in the **content pane**, not
the sidebar — see p.84's Pack-contents shot: each level of `Chiral by Fors → Presets → Bass` adds
one ~16-18px indent step, with a disclosure triangle (▶/▼) at the start of each foldable row and
the file/folder icon immediately after it, before the name.

### 2.3 Search bar: placement and visual style

The search field sits directly **above the sidebar/content-pane split**, spanning nearly the full
browser width, flanked on the left by the two Browse Back/Forward chevron buttons (`<` `>`, small,
tightly grouped, no gap between them) and on the right by the Filter toggle + a small dropdown
caret [p.60, p.66, p.69]. Visually it's a **single flat pill-shaped input**, placeholder text
`Search (Cmd + F)` in gray, no visible border in the idle state (matches the panel's own
background) — it only visually distinguishes as an input once you look for the placeholder text or
the `x`-to-clear icon that appears once text is typed [p.66]. There's no icon (no magnifying glass)
inside the field itself in the *main* Live browser search bar — contrast with the **Splice** label's
search field two sections down, which does have a leading magnifying-glass icon and a much more
conventional "pill with icon" look [p.90, p.93, p.99].

### 2.4 Filter View: the chip/tag layout

[p.60, p.66, p.72] show the Filter View as a **stack of labeled filter groups**, each group a
bold, small-caps-weight group name (`Type`, `Sounds`, `Character`) followed by a **wrapped grid of
pill-shaped tag chips** — not a single row, chips wrap to as many lines as needed. Chip visual
states, distinguishable directly in the screenshots:
- **Unselected tag**: flat gray-on-darker-gray pill, no border, low contrast with the panel
  background.
- **Selected tag**: solid **amber/gold fill** with dark text (`Mallets`, `Digital`, `Rhythmic` in
  [p.60, p.66]) — the single strongest color accent anywhere in the browser chrome besides the
  Collections swatches.
- A **category-with-subcategories** chip shows a trailing `›` chevron (`Bass ›`, `Brass ›`) rather
  than being a leaf tag itself [p.60, p.66].

Each group has its own chevron/expand affordance (`▾`) next to its bold name to fold/unfold the
whole group [p.60]. Between the Filter View and the content pane sits the **Results bar** — a
single-row, pale-yellow-tinted strip reading `Results` + `N Filters` (also amber-chip-styled) with
right-aligned `Clear` and a small "add label" icon button [p.66]. This bar **only appears when a
search/filter is active** — it's not permanently reserved space.

### 2.5 Content pane: row design, icons, columns

Every content-pane screenshot [p.60, p.62, p.63, p.72, p.80, p.84, p.116] shows the same row
anatomy, left to right: an optional **disclosure triangle** (only on foldable items — Racks,
folders, Instrument Rack presets) at ~18px indent, then a **small monochrome type icon** (~14x14px,
distinct per content type — device-rack icon, waveform-file icon, preset-file icon), then the
**item name** in the primary text color, then (right-aligned, only when relevant) up to **three
small solid Collections-color dots** stacked close together if the item carries multiple color
labels [p.80], then a trailing overflow `…` menu button on the *column header* only, not per-row.
Row height reads as tight — roughly 20-22px — with **no visible per-row separator lines**; rows are
distinguished purely by the selected-row's pale-blue fill and, on hover, presumably a subtler
highlight (not directly visible in a static screenshot, but the selected-state fill in every shot
confirms *some* row-level background-fill convention is core to the design).

The **Name** column is always present and pinned leftmost; extra columns (`Size`, `Rank`,
`Date Modified`, `Type`, `Place`) are opt-in via the **Content Options** `…` menu at the column
header's right edge [p.63] and, once added, are user-reorderable by dragging the column header,
and independently sortable by clicking any column header (ascending/descending, indicated by a
small triangle in the header) — the same overflow menu also toggles `Show File Extensions`. A
`Size` column, right-aligned, appears already active in the Packs screenshot [p.84]
(`Chiral.amxd  2.4 MB`).

### 2.6 Preview panel: waveform + play placement

The Preview Tab lives at the very **bottom of the content pane**, below the row list, as a single
slim strip [p.116, p.117]: a round **Preview toggle button** (a headphone-ish glyph in a circle,
leftmost) directly followed by a **horizontal scrub/waveform area** filling the remaining width — a
flat gray bar with a lighter gray waveform silhouette and a **vertical playhead line** marking
scrub position [p.117] — and a **`Raw` toggle button** pinned at the far right. Directly above this
strip, when an item is selected, is a **`Tags:` row** listing that item's tags as small flat chips
plus an inline `Add…` affordance [p.116, p.117, p.118] — tags-of-current-selection and the preview
scrubber are visually stacked as a single two-row footer, not separate panels. The **Preview/Cue
Volume knob** is a separate, dedicated round knob living in the **Master track's own strip**, not
inside the browser panel itself [p.118] — previewing shares the mixer's own gain stage/metering
chrome rather than the browser drawing its own volume control.

### 2.7 Collections color swatches

Two distinct color-swatch conventions appear:
1. **Sidebar swatches** — solid, saturated ~10px squares, one per Collections row, immediately
   left of the label [p.60, p.66, p.80].
2. **Content-pane swatches** — smaller, right-aligned, up-to-**three** stacked dots per row when
   an item carries multiple color assignments [p.80] — capped at three even if more are assigned,
   per the chapter text.
The default 7-color palette, read directly off the Edit-mode screenshot [p.81]: **Favorites**
(red/crimson), **Orange**, **Yellow**, **Green**, **Blue**, **Purple**, **Gray** — each with its
own checkbox to show/hide that label in the sidebar independent of whether anything is currently
assigned to it.

### 2.8 Drag-out affordance — a genuine screenshot gap

None of the 24 images viewed this pass show an **in-flight drag** (cursor mid-drag with a ghost
icon, or a drop-target highlight state) — Ableton's manual illustrates browser *states* (idle,
selected, menu-open, edit-mode) but never a drag gesture captured mid-motion. The chapter's *prose*
confirms the drop targets and outcomes precisely (drag onto a track = load onto it; drag into the
empty space right of Session tracks or below Arrangement tracks = create a new track [p.118];
double-click or `Enter` = load onto the currently selected track [p.118-119]) but is silent on the
cursor's own visual treatment during the drag. Treat "Ableton shows a custom ghost-icon cursor
during a browser drag" as **unconfirmed** — a real, correctly-flagged limitation of the manual as a
source, inherited from research 32's own caveat about this chapter's images generally, now
specifically re-confirmed by directly looking rather than assuming.

## 3. dotbeat's current content browser — the same detail, from real screenshots + code

Screenshots referenced below: `/tmp/dotbeat-ux-browser/screenshot-01-app-before.png` (browser
closed, for baseline), `-02-browser-open.png` (full app, browser open), `-03-rail-closeup.png`
(just the rail), `-04-kits-section.png` (Kits, scrolled), `-05-row-hover.png` (a single row,
zoomed), `-06-soundfonts-section.png` (SoundFonts, with the `+` button visible). All captured
against a real `beat daemon` on `/tmp/dotbeat-ux-browser/song.beat` (a disposable copy of
`examples/night-shift.beat`), never the owner's own live `night-shift-song.beat`.

### 3.1 Overall anatomy

There is no "Browser panel with an internal sidebar+content split" — dotbeat's browser **is** a
single flat rail. Toggled by a `Browser` button in the top bar (`data-action="toggle-library"`,
`App.tsx`), sitting among `Export` / `Mixer` / `History` — a peer of those, not visually
distinguished as opening something more complex. Once open, it's a fixed **260px-wide** column
(`.library-rail`, `styles.css:2604`) docked to the far left of the whole window, full height, with
a **hard 1px right border** (`var(--line)`, `#2e3138`) separating it from the arrangement view —
confirmed directly in `screenshot-02-browser-open.png`: the rail pushes the entire arrangement
view right rather than overlaying it. There is no resize handle — the 260px width is fixed in CSS,
not draggable (contrast: Ableton's whole panel and its internal divider are both draggable).

The rail header (`screenshot-03-rail-closeup.png`, top) is a single row: bold uppercase
`BROWSER` label, gray (`var(--text-dim)`), letter-spaced, with a plain `✕` close button
right-aligned — no search field, no back/forward, no filter toggle exist in this header at all
(consistent with research 32's absence list).

### 3.2 Section structure — one level of hierarchy, not three

Where Ableton has three parallel sidebar entry points (Collections/Library/Places) plus a separate
content pane, dotbeat has **one flat list of four collapsible sections** occupying the entire rail
width, each a clickable header row: `▸ Presets — Synth (30)`, `Presets — Drums (6)`, `Kits (2)`,
`SoundFonts (3)` (counts confirmed live in the screenshots). Each section header
(`.lib-section-head`, `styles.css:2648`) is a **full-width button**, 8px/10px padding, with a
small `▸` disclosure glyph that rotates 90° when open (`.lib-disclosure.open`, `transform:
rotate(90deg)`, a CSS transition — this is a real animated affordance, confirmed in code even
though a static screenshot can't show the motion) and a right-aligned item count in dim gray.
Sections are separated by a **1px bottom border** per section (`.lib-section`, not per-row) —
visually equivalent to Ableton's section-header whitespace-break, but drawn as a hard rule rather
than soft spacing.

Inside a section, **category sub-headers** appear as small uppercase gray labels
(`.lib-category-label` — `BASS`, `LEAD`, `PAD`, `PLUCK`, `KEYS`, `ARP` inside Presets — Synth;
`HOUSE`, `808-TRAP`, `TECHNO`, `BOOM-BAP`, `LOFI`, `ACOUSTIC-ROCK` inside Presets — Drums, all
visible in `screenshot-03/04`) — these are **not collapsible**, just static grouping dividers, one
indent level shallower than the rows beneath them. This is dotbeat's only "grouping" concept;
there is nothing that plays the Collections role (a user-assignable, type-agnostic, cross-cutting
color tag) at all.

### 3.3 Row design

A `.lib-row` (`styles.css:2692`) is: a round **20x20px preview button** (`▶` glyph, circular,
1px border, `var(--panel-2)` fill) flush-left, then the item name (flex-grow, ellipsis-truncated
on overflow), then a small right-aligned meta string in dim gray — for presets this is a literal
**parameter count** (`14p`, `12p`, `16p` — visible throughout `screenshot-03.png`), which is
dotbeat's *only* per-row metadata today; there is no size, date, or type-icon column, and no
distinct icon-per-content-type — every row's only visual "icon" is the identical round preview
button, never a file-type glyph. Row padding is `4px 10px 4px 18px` — the left 18px is a fixed
indent baked into the base row style, not conditional on nesting depth the way Ableton's
disclosure-triangle indent is; kit-lane rows add a further indent on top (`.lib-kit-lane`,
`padding-left: 26px`) confirmed visually in `screenshot-04.png` (`Kick`/`Snare`/`Clap`/`Hat`/`Open`
sit clearly indented under each `kit-*` head row, which itself is only lightly bolded, no
disclosure triangle at all — kit groups are **always expanded**, there's no fold/unfold gesture
for them, unlike Ableton's foldable Pack/Rack rows).

Hover state (`screenshot-05-row-hover.png`, zoomed): `.lib-row:hover` gets a flat `var(--panel-2)`
background fill across the *entire row width*, a soft `border-radius: 4px` — a much more
conventional "hovered list item" look than Ableton's screenshots show (which only ever show a
*selected*-row fill, never demonstrate a hover-only state distinct from selection, since Ableton
selection is click-based and persistent while dotbeat's rows aren't selectable/clickable at all —
only draggable). There is **no selected-row state** in dotbeat's browser — clicking a row does
nothing; the only two live affordances per row are the preview button and the drag handle (the
whole row is `draggable`).

### 3.4 SoundFont rows: the one row type with a second action button

`screenshot-06-soundfonts-section.png` shows the one place dotbeat's row design diverges: each
SoundFont row has a second small square button (`+`, 18x18px, `.lib-add-track-btn`) right-aligned
after the name, for "add as new instrument track" — confirmed live (`fluidr3-gm-small`,
`muldjordkit-small`, `upright-piano-kw-small`, each with its own `+`). This is the *only* per-row
action besides preview+drag anywhere in the current browser; every other content type (presets,
kit lanes) has exactly one button (preview) plus the drag gesture.

### 3.5 Preview: button only, no scrub/waveform panel at all

dotbeat's preview is a **stateful icon button per row** (`▶` → `…` while `busy`,
`PreviewButton` component, `ContentBrowser.tsx:72-91`) that calls straight into the audio engine
(`engine.previewSynthPreset` / `previewDrumPreset` / `previewBuffer` / `previewSoundfont`) with
**zero visual feedback beyond the button's own busy-spinner text** — no waveform render anywhere
in the browser, no scrub bar, no persistent "currently previewing" indicator, no dedicated preview
volume control (previews go through whatever the master bus is already doing). This is the
starkest visual gap versus Ableton's dedicated two-row Preview Tab footer (waveform + tags) — it's
not merely "less polished," dotbeat's browser has **no equivalent surface at all**, not a
simplified one.

### 3.6 Drag affordance

`setDragPayload` (`ui/src/daemon/library.ts:207-210`) does `dt.setData(...)` and sets
`dt.effectAllowed = 'copy'` — dotbeat relies entirely on the **browser's native HTML5
drag-and-drop cursor** (the OS-default "copy" cursor, typically a small `+` badge on the pointer)
with **no custom drag image** set via `setDragImage`. In practice this means, unlike Ableton (whose
manual doesn't show this either, so no comparison claim either way — see §2.8), dotbeat's drag
gesture shows the browser's generic translucent-row-snapshot ghost that Chrome/Firefox render by
default for any `draggable` element, not a purpose-built icon. The drop side *does* have a real,
visible affordance: `ArrangementView.tsx`'s track header carries `data-drop-target="track-header"`
and a `dropHover` state that toggles a `.drop-target-hover` class — a **dashed amber outline** +
faint amber background tint (`outline: 2px dashed var(--accent)`, `background: rgba(224, 161, 60,
0.12)`, `styles.css:2779-2783`) while a payload is dragged over a valid target. This is dotbeat's
one drag-related visual polish item that's already as good as (arguably more legible than) anything
in Ableton's chapter — Ableton's chapter never illustrates a drop-target highlight state either.

### 3.7 Color palette and typography, for contrast

dotbeat's whole UI (browser included) runs one **fixed dark theme**: panel `#1e2026`, secondary
panel `#23262e`, hairline `#2e3138`, primary text `#d8dbe2`, dim text `#8a8f9a`, single accent
`#e0a13c` (amber/gold) — used for the drop-target outline, active topbar buttons, and (per
`screenshot-02.png`) selected-track highlighting elsewhere in the app. There is no light theme, no
per-item color coding, and only one accent hue total — versus Ableton's much richer palette
(neutral chrome + amber tag-selection chips + a full 7-hue Collections palette + per-content-type
icon glyphs). dotbeat's restraint reads as intentional minimalism, not an oversight, but it does
mean **there is currently no visual vocabulary available for a future "Collections"-style
cross-cutting tag feature** without adding at least a small color palette to the design system
first.

## 4. Prioritized UI/UX changes

Rated for a **UI-polish-focused phase** — assumes underlying data/features (search backend, tag
storage, etc.) may genuinely not exist yet per research 32; where a recommendation depends on one
of those missing backend pieces, that dependency is called out explicitly rather than hidden.

| # | Change | Priority | Why / what it touches |
|---|---|---|---|
| 1 | **Add a hover-vs-selected visual distinction is already right; add a real per-row type icon** (waveform glyph for kit lanes, a distinct glyph for presets vs. soundfonts) in place of the identical preview-circle for every row type. | **P0** | Purely visual, zero backend dependency — `PresetRow`/`KitLaneRow`/`SoundfontRow` in `ContentBrowser.tsx` already know their own type; this is a ~20-line CSS+markup change. Ableton's icon-per-type convention (§2.2, §2.5) is the single highest-value "looks professional" signal in the whole chapter and dotbeat currently has zero type differentiation beyond the section headers. |
| 2 | **Give the preview action a lightweight in-place progress/playing indicator** (e.g. the row's preview button swaps to a filled/pulsing state, or a thin progress underline on the row) instead of only the `▶`→`…` text swap. | **P0** | Cheap, no backend change — `PreviewButton` already tracks `busy` state (`ContentBrowser.tsx:73`), this is styling the existing state, not adding one. Closes part of the "no visual feedback for what's playing" gap in §3.5 without building Ableton's full waveform+scrub panel. |
| 3 | **Make the rail width user-resizable** (drag the right border, like Ableton's own divider, §2.1) instead of the fixed 260px. | **P1** | Real value once preset/kit names get longer or counts grow (research 32's own growth premise) — currently `.lib-row-name` truncates with ellipsis at 260px, which will worsen as content scales. Needs a resize-handle component (likely shared with any other resizable panel dotbeat already has, e.g. the bottom pane) — check for reuse before building new. |
| 4 | **A minimal preview scrub/waveform strip** at the bottom of the rail for the currently-previewing item (static waveform render + a thin playhead), mirroring Ableton's Preview Tab footer (§2.6) at a fraction of the complexity — no scrubbing-to-seek required initially, just visual confirmation of what's playing and roughly where it is. | **P1** | Real interaction value (§3.5's gap is the starkest one found this pass) but nontrivial: needs a waveform-render utility (check if the audio-region/clip view already has one to reuse — `ArrangementView.tsx` almost certainly renders waveforms for audio clips already) before building a new one from scratch. |
| 5 | **Selected-row state** — clicking a row (not just dragging it) should visibely select it and keep it selected, matching Ableton's core click-then-act model (§2.2, §2.5) and providing an anchor point for future keyboard nav (research 32 rec #5) even before arrow-key traversal itself is built. | **P1** | Small, self-contained: add `selected` local/store state + a `.lib-row.selected` background-fill rule reusing the existing `:hover` treatment's visual language. Sets up, but does not require, keyboard navigation. |
| 6 | **Section-header micro-polish**: increase whitespace above each top-level section slightly and lighten the current hard 1px border-per-section to something closer to Ableton's softer whitespace-break (§2.2) — a purely visual rhythm tweak. | **P2** | Very low cost, low urgency — current design isn't wrong, just slightly denser than Ableton's. Good "spare cycle" item during a polish pass, not worth scheduling on its own. |
| 7 | **A real per-row Collections-style color dot** — *design-system groundwork only*: reserve a small palette (5-7 hues) and a dot-slot in the row layout now, even before any tagging backend exists, so a future cross-cutting color-tag feature (research 32 rec #4/#9) doesn't require a full row-layout rework later. | **P2, design-system prep, not a feature.** | This is explicitly *not* "build Collections" (that's research 32's P1/P2, backend-dependent) — it's reserving the ~14px of right-aligned row real estate and picking the palette now, since §3.7 confirmed dotbeat's current design system has literally zero spare hues to draw from if tagging ships later. Cheap now, expensive to retrofit into every row component later. |
| 8 | **Kit-group fold/unfold** — give `.lib-kit-head` a disclosure triangle and collapsed-by-default state, matching every other section's fold affordance, instead of kit lanes always being fully expanded (§3.3). | **P2** | Small, self-contained, consistent with the section-level pattern already built (`Section`'s `open` state is directly reusable). Low urgency at 2 kits / 10 lanes total, becomes a real scanability win once kit count grows (research 07's roadmap). |
| 9 | **Custom drag-image (ghost icon)** in place of the browser's default translucent-row snapshot (§3.6), e.g. a small icon+name chip following the cursor via `setDragImage`. | **P2** | Real polish, but Ableton's own manual doesn't demonstrate a stronger pattern to copy here (§2.8 — genuinely unconfirmed on the Ableton side), so this is "make it look deliberate" rather than "close a documented gap." The existing drop-target dashed-outline treatment (§3.6) is already solid and shouldn't be touched. |
| 10 | **Fixed preview-volume path** — route preview audio through a small, dedicated gain control (even a single shared knob, not per-row) rather than implicitly sharing the master bus, matching Ableton's dedicated Preview/Cue Volume knob (§2.6). | **P2, and only worth doing alongside item 4.** | Currently previewing at full master level can be jarring mid-mix-review; low cost as a single global control, but sequencing it after the waveform-strip work (item 4) means it lands in the same footer element rather than as a separate bolt-on. |

**Explicitly out of scope for this doc** (belongs to research 32's backend-feature track, not this
visual/interaction pass): search bar, tag storage/Tag Editor, Collections *data model*, keyboard
navigation, sortable columns, "Current Project" browsing, arbitrary user folders. Items 7 and 10
above touch the *visual seams* those features will eventually need, without building the feature
itself — everything else in this table is achievable with zero new daemon routes or document-model
changes.

## 5. Sources

Ableton Live 12 Reference Manual, Chapter 4, "Working with the Browser," pp. 60-119 (owner-supplied
PDF, `prior_art/`, gitignored) — **24 rendered page images actually viewed this pass**: pp. 60, 61,
62, 63, 66, 69, 72, 75, 78, 80, 81, 84, 90, 93, 96, 99, 108, 111, 114, 115, 116, 117, 118, 119
(`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch04/p-0NN.jpg`), cross-referenced
against the chapter's `pdftotext -layout` text extract
(`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-chapters/ch04.txt`) for terminology only.
dotbeat internal, read/captured directly this pass: `ui/src/components/ContentBrowser.tsx` (full
file), `ui/src/styles.css` lines 2602-2784 (`.library-rail` through `.drop-target-hover`),
`ui/src/daemon/library.ts` (`setDragPayload`), `ui/src/components/ArrangementView.tsx`
(`handleLibraryDrop`, `data-drop-target`, `.drop-target-hover`), `ui/src/App.tsx` (topbar
`toggle-library` button); six fresh Playwright screenshots of the real running app (built via
`npm run build` at repo root + `ui/`, driven against a real `beat daemon` on
`/tmp/dotbeat-ux-browser/song.beat`, a disposable copy of `examples/night-shift.beat` — the owner's
own `examples/night-shift-song.beat` was never touched), at
`/tmp/dotbeat-ux-browser/screenshot-0{1-6}-*.png`, using the existing daemon/preview-server launch
pattern from `ui/verify-phase22-content-browser.mjs` (not itself modified). Cross-referenced against
[`docs/research/32-ableton-browser.md`](32-ableton-browser.md) for the feature-presence baseline
this pass deliberately does not repeat.
