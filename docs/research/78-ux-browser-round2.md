# Research 78 — UX deep dive round 2: the Content Browser, post-Phase-27

*2026-07-12. A second visual/interaction-implementation pass over dotbeat's content browser,
following [`docs/research/73-ux-browser.md`](73-ux-browser.md) (round 1) and
[`docs/phase-27-plan.md`](../phase-27-plan.md) Stream EJ, which built round 1's two P0
recommendations: a distinct per-content-type row icon and an in-place "currently previewing"
pulse indicator. This pass (a) looks at a fresh, larger sample of the Ableton Live 12 manual's
chapter-4 screenshots — different pages than round 1 viewed — for detail round 1's smaller sample
missed, and (b) drives dotbeat's real, post-Phase-27 running app with Playwright to confirm the
shipped fixes actually look right, and to look for anything newly visible now that they're live.*

## 0. What Phase 27 Stream EJ already shipped (so this pass doesn't re-flag it)

Read directly from `ui/src/components/ContentBrowser.tsx` and `ui/src/styles.css` before touching
a screenshot. Two things landed, both scoped to `ContentBrowser.tsx` alone (no other stream this
phase touched the file):

1. **A `TypeIcon` component** (`ContentBrowser.tsx:71-140`) rendering one of five distinct 12x12
   monochrome SVG glyphs — a wavy oscillator line (`preset-synth`), a drum/cylinder shape
   (`preset-drums`), a 2x2 grid (`kit`), three solid bars (`kit-lane`), a beamed note pair
   (`soundfont`) — ahead of the preview button on every row. `TYPE_ICON_LABEL` gives each an
   `aria-label`/`<title>` too.
2. **A real in-place "currently previewing" indicator**, not just the button's `▶`→`…` text swap.
   `PreviewButton` now takes `active`/`onStart`/`onEnd` (`ContentBrowser.tsx:170-205`) and a
   `durationMs` calibrated per preview path (synth preset ~1800ms, drum preset ~1400ms, soundfont
   ~1200ms, kit-lane one-shot ~900ms — matched to `engine.ts`'s own teardown timers, since the
   preview promise resolves as soon as the voice *fires*, not when it finishes sounding). While
   `active`, the row gets a `.lib-row-previewing` class: a CSS `@keyframes lib-row-pulse` animation
   (`styles.css:2942-2957`) cycling the row's background between `rgba(224,161,60,0.09)` and
   `rgba(224,161,60,0.24)` on an 1.1s loop, the row name goes accent-colored/bold, and the type
   icon itself picks up the accent color too (`.lib-row-previewing .lib-type-icon`,
   `styles.css:2931-2934` — the same rule that colors the icon on plain `:hover`).

Round 1's other six recommendations (rail resize, selected-row state, preview scrub/waveform
strip, kit-group fold/unfold, custom drag-image, dedicated preview-volume control) were **not** in
Stream EJ's scope and are unchanged — all six are already carried as their own rows in
`docs/product-roadmap.md`'s "Preset / content library" section, sourced back to research 73, so
none of them are re-flagged below as *new*.

## 1. Fresh Ableton detail (Part 1) — a different, larger page sample

Round 1 viewed 24 of chapter 4's 60 page images (pp. 60-63, 66, 69, 72, 75, 78, 80-81, 84, 90, 93,
96, 99, 108, 111, 114-119). This pass viewed **26 additional pages** not viewed in round 1 — pp.
64-65, 67-68, 70-71, 73-74, 76-77, 79, 82-83, 85-89, 92, 100, 109-110, 112-113 — cross-referenced
against the chapter's text extract for the sections those pages illustrate (§4.2 Search Bar, §4.3
Browser History, §4.4 Filters and Tags incl. §4.4.3 Tag Editor and §4.4.4 Quick Tags, §4.5
Collections, §4.7 Places incl. §4.7.1-2 Packs and §4.7.6 User Library subfolders, §4.7.7 Current
Project). Combined, 50 of the chapter's 60 page images have now been directly viewed across both
passes.

### 1.1 Search bar: hashtag syntax, multi-term AND, and a save-as-label workflow

Round 1 described the search field's *look* (a borderless pill, no icon, `Search (Cmd+F)`
placeholder) but not its full interaction model. Newly confirmed, screenshot-grounded [pp. 64, 65,
67, 68]:

- **Plain text search is multi-term AND, not fuzzy**: typing "keys" filters to items whose *name*
  contains "keys" [p.64]; typing "strings" narrows further when combined with tag clicks [p.65] —
  the chapter text confirms explicitly ("results will include files that match *all* search
  terms, as opposed to *any*").
- **A dedicated hashtag syntax searches tags directly**: typing `#` into the search bar triggers a
  tag-name autocomplete dropdown (`#Drums` shown matching `Drums`, `Clap`, `Cymbal`, `Crash`, `Misc
  Cymbal`, `Ride` — mixing top-level and nested tag matches in one list) [p.65]. This is a
  meaningfully different mechanic from clicking a filter chip — a keyboard-only path into the same
  tag graph.
- **Search results can be pinned as a permanent custom label**: the Results bar's right-side
  icon (previously described only as "an add-label icon button") is confirmed live as a two-step
  flow — click it, and the current search+filter state is saved as a new, permanently-listed
  sidebar entry with its own icon, sitting in the Library list of labels (`Digital Voice Choir`
  shown as a saved label, selected and highlighted exactly like `All`/`Sounds`/`Drums`) [pp. 67,
  68]. A saved label's own right-click context menu offers **rename** (for both factory and custom
  labels) and **pick a different icon** (custom labels only) [p.68] — a small but real "make your
  saved search feel like a first-class category" affordance.
- **Browser history has dedicated keyboard shortcuts**, not just the `<`/`>` chevron buttons:
  `Ctrl/Cmd+]` forward, `Ctrl/Cmd+[` back, and the history explicitly includes *both* past searches
  and past label/navigation states, not just clicks [p.68].

### 1.2 Filter groups: three-level nesting and multi-select

Round 1's description of the Filter View chip grid ("wrapped grid of pill chips," amber = selected)
undersold how deep the nesting goes. [pp. 70, 71] show a filter group can nest **three levels**:
`Sounds ▾` → `Mallets ▾` (a sub-category chip with its own trailing caret) → a third row of
leaf tags (`Bell Chromatic`, `Glockenspiel`, `Marimba`, `Misc Mallets`, `Synth Mallets`,
`Vibraphone`, `Xylophone`) — all three levels visible and clickable simultaneously once a
mid-level chip is expanded, not a modal drill-down. And **multiple tags within one group compose
as an explicit multi-select**, not one-at-a-time: holding `Ctrl`/`Cmd` while clicking a second tag
in the same group adds it to the filter rather than replacing the first [p.71] — round 1 didn't
have a page confirming this modifier gesture.

### 1.3 Tag Editor: the full authoring model, not just "it exists"

Research 73 explicitly scoped the Tag Editor out as backend/out-of-scope; this pass looked at its
actual screens anyway for completeness [pp. 73, 74, 76, 77], since round 1 never viewed a single
Tag Editor screenshot (pp. 75, 78 were viewed but bracket the section without showing the editor
itself):

- Opened via the **Filter View menu's "Open Tag Editor" entry**, which also holds **"Open Quick
  Tags"** and **"Enable Auto Tags"** as sibling toggles, plus **Show All Filter Groups / Hide All
  Filter Groups / Reset Filter Groups to Default** [p.73, p.77] — filter-group visibility is itself
  a user preference, not fixed.
- The editor is a **narrow right-docked panel**, layered *over* the existing sidebar+content view
  (not a replacement for it) — it shows the currently-selected browser item's assigned tags as
  checkboxes, grouped under the same bold group headers as the Filter View (`Guitar & Plucked`,
  `Mallets`, `Pad`, `Piano & Keys`, `Strings`...), each group foldable via its own arrow, with a
  **bolder-background arrow icon marking a folded group that contains an assigned tag** — a "there's
  something checked in here, even though it's collapsed" signal [p.74].
- **Tags nest as parent/child ("subtags")**: right-click a tag → "Add Subtag in *X*" nests a new
  tag under it (`Bass` → `Add Subtag in "Bass"`); the same context menu offers **Delete**,
  **Rename** (`⌘R`), and **Reset Tag Order**, but the chapter text is explicit that **default
  filter groups/tags cannot be edited or removed** — only custom ones [p.76, p.77]. New top-level
  groups come from a dedicated **"+ Add Group…"** control pinned at the bottom of the list [p.76].
- A separate, always-available **Quick Tags strip** sits at the bottom of the content pane
  (distinct from the Tag Editor panel): `Tags: Basic Bright Digital Distorted × Modulated × Punchy
  Synth Bass Add…` — a flat pill row for the *currently selected* item, each already-assigned tag
  individually removable inline (the `×`), with a `Add…` control that autocompletes existing tags
  or offers "Create new tag…" (which then prompts for a parent group) [p.77]. This is the fast
  per-item path; the Tag Editor panel is the slower, structural one — two different surfaces for
  two different jobs, not one tool with two views.

### 1.4 Collections: assignment mechanics and the Edit-mode toggle UI

Round 1 read the Collections *palette* (7 fixed colors) correctly off p.81's edit screenshot but
didn't view the assignment interaction itself. Newly confirmed [p.79, p.82, p.83]:

- Colors assign via **either a context menu or number keys `1`-`7`** directly on a selected browser
  item (or a multi-item selection — one keypress colors everything selected at once); **`0`
  resets** the assignment. Ableton explicitly calls out that the *same* color can be assigned
  across heterogeneous item types in one pass — "the same color label to a drum sound, a MIDI
  effect, and a plug-in" [p.79].
- **Show/hide per-label is a dedicated Edit mode**, not a settings dialog: hovering right of the
  `Library`/`Collections` header reveals a small **`Edit`** button; clicking it turns every label
  row into a checkbox list (`All ✓`, `Sounds ✓`, `Drums ✓`...) with a **`Done`** button replacing
  the header text to exit [p.82, p.83] — the same in-place edit-mode pattern for both the Library
  and Collections sections, not two different mechanisms.
- The column-header `…` (Content Options) menu, when a Collections label is the active view, adds
  **`Clear All Colors`** plus a **live count per color** (`Favorites 1`, `Orange 2`, ...) right in
  the menu itself [p.89] — a detail neither research 32 nor round 1 surfaced.

### 1.5 Packs: a full download/pause/install state machine (confirmed not to apply to dotbeat)

[pp. 85-89] show Packs has real depth — separate **Updates** and **Available Packs** sections
under the `Packs` Places label, each row a download icon that swaps to a **yellow-ringed pause
icon showing live download progress** while fetching, a right-click context menu
(`Delete`/`Download Pack`/`Pause Download`/`Resume Download`/`Install Pack`/`Cancel
Download`/`Learn about this Pack on ableton.com`), and a separate **Install** button once a
download completes, triggering a modal progress dialog. This is a real, detailed piece of Ableton's
UI this pass hadn't looked at directly before — but it's **not a dotbeat gap**: dotbeat has no
third-party content-pack ecosystem or marketplace (its bundled `presets/factory.json` +
`presets/kit-*/` + `presets/sf2/*.sf2` are the whole catalog, versioned in-repo), so there's no
"download/pause/install" state to build toward. Noted for completeness, not added to the
prioritized list below.

### 1.6 Current Project: browsing your own live Set's structure and auto-backups in-browser

[pp. 112, 113] show the `Current Project` Places label expands the *currently open* Set itself as
a foldable tree — every track, clip, device, Return/Main track, and loaded groove, browsable the
same way a Pack's contents are — plus, once a project has been saved twice, an automatic
**`Backup`** folder holding the **last ten timestamped auto-saves** (`80x [2024-01-23
121759].als`...), oldest deleted (to trash, not permanently) once the count exceeds ten, with
right-click **"Show in Explorer/Finder"** on the Current Project label itself. This is a genuinely
interesting point of contrast rather than a gap: dotbeat's answer to "browse my own project's
history" is its git-native checkpoint system (`beat checkpoint`/`beat restore`, a real version
graph, not a rolling window of ten) — arguably a stronger mechanism already, just not surfaced
*inside* the content browser the way Ableton surfaces it inside *its* browser. Not added to the
prioritized list below (dotbeat already has a dedicated `History` topbar panel for this, confirmed
in `shot-02-browser-open.png` sitting right next to the `Browser` button) — worth a one-line flag
only in case a future pass considers whether History and Browser should ever cross-link.

## 2. dotbeat's current content browser — confirming the Phase 27 fixes, live

Screenshots this pass, all against a real `beat daemon` on `/tmp/dotbeat-ux2-browser/song.beat` (a
disposable copy of `examples/night-shift.beat`, git-initialized in its own temp dir; the owner's
`examples/night-shift-song.beat` was never opened or touched): `shot-01-app-before.png`,
`shot-02-browser-open.png` (full app), `shot-03-rail-closeup.png` (Presets — Synth, all 30 rows,
idle state), `shot-04-kits-section.png` (Drum presets + both kits' lanes + SoundFonts, idle),
`shot-05/06-preview-pulse-t{150,650}ms.png` (mid-pulse, `acid-bass` previewing), `shot-08-row-hover
.png` (a zoomed single-row crop, also mid-preview), `shot-09-soundfonts.png` (the `+`-button row
type), plus five isolated 96x96 upscaled per-type-icon crops (`icon1x-<type>-big.png`) taken at
device-pixel-ratio 1 to see exactly what a real, non-Retina render looks like at native size.

### 2.1 The type icons: the fix works, and reads clearly even at native size

All five glyphs render distinctly and correctly-typed on real data: 30 synth-preset rows all show
the wavy oscillator line, all 6 drum-preset rows (`driving-kit`, `808-trap-kit`, etc.) show the
drum/cylinder shape, both kit-head rows (`kit-audiophob`, `kit-init`) show the 2x2 grid, all 10 kit
lanes (`Kick`/`Snare`/`Clap`/`Hat`/`Open` × 2) show the three-bar glyph, all 3 SoundFont rows show
the beamed-note glyph — confirmed against `catalog` counts in `screenshot-03/04`, matching what
`docs/research/73-ux-browser.md` §3.2 recorded as the current counts. The
`icon1x-<type>-big.png` crops (native 12px render, upscaled 8x with smoothing to approximate
"looking closely at a real screen") confirm the shapes stay legible at true size, not just at the
4x-scale crops a Retina screenshot would flatter — the cylinder genuinely reads as a drum, the bars
genuinely read as a mini-waveform, distinct from the grid and the note-pair. **Round 1's P0 #1 is
real and it works.**

One nuance round 1 couldn't have predicted (it never saw the shipped code): **the icon's rest-state
color is `var(--text-dim)`** (`styles.css:2924-2930`) — the same dim gray as the row's meta text
(`14p`, `5 lanes`) and the section-header labels. That's a deliberate, consistent choice, but it
means the *type differentiation* only gets real visual contrast during `:hover` or
`.lib-row-previewing`, i.e. exactly the two states a user is *already* looking at that specific row
for other reasons. In the row's default, most-common state — scanning a long idle list, the actual
job type icons were added to help with — the shape is legible on close inspection
(`icon1x-*-big.png` confirms this) but low-contrast at a glance, closer to "quiet texture" than
"scannable glyph." Not a regression from round 1's ask (which only asked for *distinct* icons, and
these are genuinely distinct), but a real, freshly-visible calibration question.

### 2.2 The preview pulse: works, is clearly noticeable, runs a little hotter than its own code comment claims

`shot-05`/`shot-06` (150ms and 650ms into a synth-preset preview) both show `acid-bass`'s row with
an unmistakably warm amber-brown fill against every neighboring row's neutral dark background, bold
accent-colored row name, and an accent-colored type icon — the indicator is **not** too subtle; it
is immediately obvious which row is playing without focusing on the tiny 20px button, closing the
exact gap research 73 §3.5 flagged ("no persistent 'currently previewing' indicator... not merely
less polished, dotbeat's browser has no equivalent surface at all"). **Round 1's P0 #2 is real and
it works.**

The one recalibration worth flagging: the CSS comment above `@keyframes lib-row-pulse`
(`styles.css:2936-2941`) describes the effect as "a *soft* pulsing amber wash," but the keyframe's
peak alpha (`rgba(224,161,60,0.24)`, `styles.css:2948`) combined with the amber's own high
saturation reads, in the actual screenshots, closer to a solid warm fill than a soft wash — visibly
stronger than Ableton's own equivalent (a flat, non-animated, much paler blue selected-row fill,
per research 73 §2.2/§2.5, with no pulsing anywhere in the browser chrome). This is a legitimate,
debatable design choice, not a bug — dotbeat's browser has no persistent "selected" state to
contrast against (round 1's P1 #5 remains unbuilt), so the pulse is doing double duty as the only
strong-highlight affordance in the whole rail, which arguably justifies the extra intensity. Flagged
as a small, low-urgency tuning knob (§4 P2), not a fix.

### 2.3 A fresh legibility issue at the button itself: the active-state glyph

`PreviewButton` swaps its 9px label from `▶` (idle) to `…` (busy — true only for the handful of
milliseconds the preview promise takes to fire) to `❚❚` (active — true for the whole
`durationMs` window) [`ContentBrowser.tsx:202`]. At the button's actual 20x20px circular size and
9px font (`styles.css:2958-2967`), `❚❚` does not resolve as two distinct bars in the screenshots —
it renders as a single blurred block, effectively indistinguishable from a solid dot. Functionally
harmless (the row-level pulse is already carrying the "this is playing" signal, per §2.2), but it
means the button's own glyph swap — the *original*, pre-Phase-27 mechanism research 73 called "the
button's own busy-spinner text" — still doesn't read as intended up close, just less critically now
that the row itself compensates.

### 2.4 Everything else: unchanged, and correctly so

The rail is still a fixed 260px column with no resize handle, rows are still not individually
selectable/clickable (only draggable + previewable), kit-head rows still have no fold/unfold and no
preview button of their own (only the drag-whole-kit gesture — `KitGroup`, `ContentBrowser.tsx:
282-309`), there is still no scrub/waveform strip and no dedicated preview-volume control, and
SoundFont rows are still the only row type with a second action button (`+`, add-as-track). All of
these match research 73's record exactly and are already tracked as their own rows in
`docs/product-roadmap.md`'s "Preset / content library" section — correctly untouched by a stream
scoped only to icons + the pulse indicator.

## 3. Prioritized NEW findings

Checked against `docs/product-roadmap.md`'s "Preset / content library" section before listing —
every item below is either (a) about calibrating something Phase 27 itself just shipped (not yet
represented anywhere, since it didn't exist to research before this pass), or (b) a small,
genuinely new Ableton-side interaction detail with no existing tracked row. Nothing here duplicates
the rail-resize / selected-row / scrub-strip / kit-fold / drag-image / preview-volume rows already
in the roadmap from research 73.

| # | Finding | Priority | Why / what it touches |
|---|---|---|---|
| 1 | **Give the type icon a hair more rest-state contrast.** `.lib-type-icon`'s idle color is identical to the row's dim meta text (`var(--text-dim)`), so shape differentiation — the whole point of Phase 27 Stream EJ — only gets real visual pop on hover/preview, not during an ordinary idle scan. A small bump (e.g. a slightly lighter fixed gray, or `var(--text)` at ~65% opacity) would keep the "quiet, not loud" restraint dotbeat's design system already favors (research 73 §3.7) while making the shapes register faster at a glance. Purely a CSS value change in `styles.css:2924-2930`. | **P1** | Directly affects whether Phase 27's own P0 fix delivers its full intended value; cheap, zero risk, no layout change. |
| 2 | **Recalibrate the preview-pulse's peak alpha to match its own "soft wash" intent**, or update the code comment to reflect the (arguably fine) stronger effect actually shipped. Currently `rgba(224,161,60,0.24)` peak reads as a fairly solid warm fill in real screenshots (`shot-05/06`), stronger than the comment at `styles.css:2936-2941` describes and stronger than Ableton's own restrained, non-animated selected-row fill. Either dial back to ~0.14-0.16 peak alpha for a genuinely "soft" wash, or keep it as the rail's only strong-highlight affordance (since there's no selected-row state yet to share that job) and just fix the comment. | **P2** | Debatable/aesthetic, not broken — the indicator unambiguously succeeds at its job (§2.2). Worth a deliberate call, not an accident to leave uncommented-on. |
| 3 | **`PreviewButton`'s active-state glyph (`❚❚`) doesn't resolve at its actual 20px/9px size** — reads as a single blob in real screenshots, not two bars (§2.3). Swap for a glyph that survives that size unambiguously (a filled square `▪`, a solid ring, or simply reuse the row-level accent-color treatment and drop the button glyph change entirely, since the row pulse already carries the signal). Small, isolated to `PreviewButton`'s render (`ContentBrowser.tsx:202`). | **P2** | Cosmetic-only now that the row-level indicator (item landed this phase) already carries the actual "is this playing" signal; the button glyph is a secondary, now largely redundant cue. |
| 4 | **Adopt Ableton's number-key (`1`-`7`, `0`=reset) + multi-selection assignment gesture as the concrete interaction spec**, if/when the already-tracked "Collections / favoriting" roadmap row (`docs/product-roadmap.md` line 338) gets built — newly confirmed this pass (§1.4) that Ableton's Collections assignment is keyboard-driven and batchable across a multi-item selection, not just a context-menu click-through, which the existing tracked row doesn't currently specify. Not a new row — a design-detail amendment to the existing one. | **P2, design-note only, no new roadmap row** | Saves a future build stream from re-deriving the interaction model from scratch or copying only the "7 fixed colors" half of Ableton's design and missing the faster keyboard path. |

**Explicitly not added to the roadmap:** Packs' full download/pause/install state machine (§1.5 —
not applicable, dotbeat has no third-party pack ecosystem); Current Project in-browser Set/backup
browsing (§1.6 — dotbeat's git-native checkpoint system is a different, already-shipped answer to
the same need, surfaced via the separate `History` panel rather than the `Browser` one); the Tag
Editor's full parent/child/fold authoring model (§1.3 — richer than the already-tracked "flat tag
field" roadmap row intentionally scopes for, per research 51's own explicit call that porting the
full editor is "NOT worth it at dotbeat's scale"); the search bar's hashtag syntax and saved-label
workflow (§1.1 — detail for the already-tracked "Text search bar" and "Browser navigation history"
rows, not a new capability).

## 4. Sources

Ableton Live 12 Reference Manual, Chapter 4, "Working with the Browser" (owner-supplied PDF,
`prior_art/`, gitignored) — **26 additional rendered page images viewed this pass**, none repeated
from round 1: pp. 64, 65, 67, 68, 70, 71, 73, 74, 76, 77, 79, 82, 83, 85, 86, 87, 88, 89, 92, 100,
109, 110, 112, 113 (`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch04/p-0NN.jpg`),
cross-referenced against the chapter's `pdftotext -layout` extract
(`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-chapters/ch04.txt`, all ~1320 lines, for
section boundaries — §4.2 Search Bar through §4.7.8 User Folders). dotbeat internal, read/captured
directly this pass: `ui/src/components/ContentBrowser.tsx` (full file, post-Phase-27), `ui/src/
styles.css` lines 2880-3010 (`.lib-section-body` through `.lib-add-track-btn`), `docs/phase-27-
plan.md`, `docs/product-roadmap.md`'s "Preset / content library" section. Fresh Playwright
screenshots of the real running post-Phase-27 app, built via `npm run build` at repo root + `ui/`,
driven against a real `beat daemon` on `/tmp/dotbeat-ux2-browser/song.beat` (a disposable,
git-initialized copy of `examples/night-shift.beat` — the owner's own
`examples/night-shift-song.beat` was never opened) at `/tmp/dotbeat-ux2-browser/shot-0{1-9}-*.png`
and five native-size type-icon crops at `/tmp/dotbeat-ux2-browser/icon1x-<type>-big.png`, using the
same daemon/preview-server launch pattern `ui/verify-phase22-content-browser.mjs` established
(not itself modified). Cross-referenced throughout against
[`docs/research/73-ux-browser.md`](73-ux-browser.md) (round 1, not re-litigated where still
accurate) and `docs/product-roadmap.md` (to confirm no finding here duplicates an already-tracked
row).
