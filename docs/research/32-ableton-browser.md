# Research 32 — Ableton Live 12 Manual, Chapter 4: "Working with the Browser"

*2026-07-12. One of a set of parallel chapter-by-chapter research passes over the owner's
Ableton Live 12 Reference Manual PDF (`prior_art/`, gitignored). This pass covers Chapter 4,
manual pages 60-119: Live's browser — the app-wide sidebar/search/filter/preview surface for
samples, presets, devices, plug-ins, and packs. Research-only; no code was written or modified.*

## How to read this doc

- **[manual p.NNN]** — the actual PDF page number, read directly off this chapter's own page
  footers in the `pdftotext -layout` extract (`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-chapters/ch04.txt`),
  not estimated. Page numbers are precise to the page; a claim spanning a page break may cite the
  page the sentence starts or ends on.
- **[dotbeat]** — read directly from this repo's current source this pass (`ContentBrowser.tsx`,
  `ArrangementView.tsx`, `daemon.ts`, `library.ts`, `docs/product-roadmap.md`), not inferred.
- **Honest limitation**: this pass is text-only. The chapter's own screenshots (Filter View
  layout, Collections color swatches, the Content Options menu, the Splice UI) were not
  machine-readable — `pdftotext -layout` extracts only image *captions*, never image content, the
  same limitation research 30 flagged for the manual's Arrangement/Clip View chapters. Every claim
  below rests on the chapter's prose, not on inspecting a rendered screenshot. Treat exact
  pixel/layout choices (e.g. exactly how many colors Collections offers, or the precise shape of
  the Filter View panel) as needing a live-Ableton or screenshot check before they drive an
  irreversible pixel decision — the *behavior* is solid, the *exact visual form* is not verified
  visually.

## Why this chapter matters for dotbeat

The owner's framing is right: this is cross-cutting UI, not a feature. Every DAW that ships more
than a handful of sounds ends up needing *some* answer to "how do I find the thing I want among
hundreds/thousands of assets and get it into my track with one gesture." dotbeat already has a
working answer at small scale (`ContentBrowser.tsx`, Phase 22 Stream AH — 36 presets, a couple of
drum kits, 3 SoundFont banks) but the sound-quality roadmap (`docs/research/07-sound-design-sources.md`)
explicitly plans to grow this content by an order of magnitude — sample-based instruments, a
second synth engine (DX7 `.syx` banks), more drum kits, community/curated presets from the
variation loop. Ableton's chapter 4 is 999 pages of what happens when a browser like dotbeat's
own is asked to scale from "three sections" to "a library with tens of thousands of items" —
which parts of that solution are worth pre-adopting now, and which are explicitly *not* dotbeat's
problem, is exactly what this pass is for.

## 1. Browser anatomy — the pieces Ableton considers load-bearing

The browser's own layout diagram names eight distinct pieces working together
[manual p.60-61]: a **sidebar** (Collections / Library / Places), **Browse Back/Forward**
history buttons, a **search field**, a **Show/Hide Filter toggle** + **Filter View menu**, the
**Filter View** itself (filter groups + tags), a **Results bar** (shows active filter count, has
an Add Label button), the **content pane** (the actual item list), and a **Preview tab**
(waveform + playback toggle). The browser is resizable (drag the middle divider, drag the outer
edges) and has a dedicated **Full-Height Browser** view-menu option [manual p.61] — notably, that
mode keeps Clip View/Device View open (a plain edge-drag resize closes them), i.e. Ableton
explicitly designed for "browse while looking at the thing you're about to change," not just
"browse in isolation."

The core interaction loop is stated plainly: pick a label from the sidebar, then filter/search/
select in the content pane [manual p.61]. Three parallel entry points (Collections, Library,
Places) organize the *same underlying content* by three different axes — user-curated grouping,
factory taxonomy-by-type, and physical/storage location — rather than one flat tree.

## 2. Content pane: columns, sorting, extensions

The content pane always shows a **Name** column; additional columns (author, tags, size, etc. —
not enumerated exhaustively in this chapter, referenced via the **Content Options menu**) are
opt-in and reorderable by drag [manual p.62]. Any column header is clickable to sort
ascending/descending; right-clicking a column header also opens the Content Options menu
[manual p.63]. The same menu toggles showing/hiding file extensions.

## 3. Search: AND-logic, tag search, keyboard-only workflow

The search bar's matching rule is explicit and deliberate: **multi-term search is AND, not OR**
— "electric bass" only matches items containing *both* "electric" and "bass" [manual p.63]. `Ctrl
F`/`Cmd F` both places the cursor in the search field *and* switches focus to the **All** label
so the search spans every library location at once [manual p.63].

Search and the Filter View compose: type a text term, then click filter tags to narrow further
[manual p.64] — text search and tag-filtering are not two separate mechanisms, they intersect on
the same result set. Tags are also searchable directly as text via a `#tagname` prefix, with
autocomplete on the tag name as you type [manual p.65].

Two different "clear" actions exist and are **not the same operation**: the `x` in the search
bar clears only the typed text, leaving any selected filter tags in place; the **Clear** button in
the Results bar resets both the tags *and* the text together [manual p.65]. This distinction (a
narrow "undo my typing" vs. a broad "reset the whole query") is a small but real UX lesson.

Ableton documents a full mouse-free search sequence as a first-class workflow, not an
accessibility afterthought [manual p.66]: `Ctrl/Cmd F` → type → `↓` to jump into results → `↑/↓`
to scroll → `Esc` to clear search *and* filters and return to the full All list.

### Saving searches as custom labels

A search/filter result set can be pinned as a **permanent custom label** via an "Add Label"
button next to Clear [manual p.66-67] — it then behaves exactly like any built-in Library label,
persists, is renamable, has a choosable icon, and is removable via context menu [manual p.68].
The manual explicitly frames this as functionally overlapping with Collections ("similar to using
the Collections labels") [manual p.68] — Ableton itself treats "a saved search" and "a manually
curated color-tagged group" as two paths to the same destination: a durable, named subset of your
library.

## 4. Browser history

Independent of undo/redo, the browser keeps its own **navigation history** — every search and
every label-navigation state — traversable with dedicated Back/Forward buttons and
`Ctrl ]`/`Ctrl [` (`Cmd ]`/`Cmd [` on Mac) [manual p.69-70]. This is a browsing-session
convenience, unrelated to the project's own undo stack.

## 5. Filters and tags — the deepest part of the chapter

### 5.1 Filter groups are per-label, not global

The single most structurally interesting fact in this chapter: **which filter groups are visible,
and which tags are selected within them, is saved and recalled per Library label**
[manual p.72] — the Drums label remembers its own filter state independently of the Sounds
label's. Multi-select within one group uses `Ctrl`/`Cmd`-click [manual p.72]. Filter groups can be
individually hidden per-label via right-click, with a "reset to default" escape hatch
[manual p.72], and the Filter View menu can widen which groups show at all [manual p.73].

### 5.2 Tags: factory tags are immutable, user tags are freely additive

All factory content ships pre-tagged (from the "Sounds" filter-group vocabulary for third-party
Pack content specifically) [manual p.72], and **factory tags cannot be removed** — but arbitrary
additional tags, including entirely new user-defined tags, can always be layered on top
[manual p.72]. Two automated tagging sources exist: a **sound-analysis pass** that auto-tags
user samples up to 60 seconds long with a best-guess descriptive tag [manual p.72-73], and
**VST3-metadata-derived tags** for third-party plug-ins whose declared VST Sub Category maps to
one of Live's own categories [manual p.73].

### 5.3 Tag Editor: user-extensible taxonomy, not a fixed enum

The **Tag Editor** lets a user create entirely new tag groups (not just new tags within existing
groups) [manual p.75], batch-tag multiple selected items at once (Shift-select, then check boxes)
[manual p.75], and nest tags via **subtags/parent tags** — a two-level hierarchy, foldable in the
UI [manual p.76]. Default/factory groups and tags cannot be renamed or deleted, only added to
[manual p.77].

### 5.4 Quick Tags: a fast per-item companion panel

A separate, always-visible-by-default **Quick Tags** panel shows/edits the current selection's
tags without opening the full Tag Editor [manual p.77-78], including inline creation of brand-new
tags (with a forced choice of parent group at creation time, so tags never end up ungrouped)
[manual p.77-78]. Multi-item selections show the *union* of tags with an asterisk marking
tags not shared by every selected item [manual p.78] — a clean small solution to "what does this
mixed selection have in common."

## 6. Collections — color labels as a cross-cutting, type-agnostic grouping

**Collections** are user-assignable color labels (number keys `1`-`7` to assign, `0` to clear)
[manual p.79], assignable to **any item type simultaneously** — the manual's own example: "the
same color label to a drum sound, a MIDI effect, and a plug-in" [manual p.79] — and to folders,
not just leaf items [manual p.79]. Multiple colors can be assigned to one item, though the content
pane caps the visible swatches per row at three [manual p.79-80]. Each Collection label is
independently renamable, and which labels show in the sidebar at all is editable (Show/Hide per
label) [manual p.80] — with one subtle default-behavior asymmetry worth noting: a *hidden* color
becomes auto-shown the moment something gets tagged with it, but a *visible* color is **not**
auto-hidden when its last item is untagged [manual p.81] — favors discoverability over tidiness by
default.

## 7. Library — factory taxonomy, organized by content type

The **Library** sidebar section is Ableton's fixed, factory taxonomy: `All / Sounds / Drums /
Instruments / Audio Effects / MIDI Effects / Modulators / Max for Live / Plug-Ins / Clips /
Samples / Grooves / Templates / Tunings` [manual p.81-82]. Two organizing principles coexist
in this one list: **Sounds/Drums are organized by content type** (any instrument preset tagged
appropriately, regardless of which device it's built on) while **Instruments/Audio Effects/MIDI
Effects are organized by device** (grouped by which processor produces them, not by sonic
character) [manual p.81]. Every label's visibility is independently toggleable via an Edit mode
[manual p.82].

## 8. Places — where content physically lives

**Places** is explicitly the "where is this file" axis, distinct from Library's "what kind of
thing is this" axis: **Packs** (installed content bundles + available downloads/updates),
**Splice** (cloud marketplace, opt-in), **Cloud** (Ableton Cloud sync from Move/Note, opt-in),
**Push** (standalone-mode file transfer, opt-in), **User Library** (your own saved content, has
a fixed on-disk shape), **Current Project** (files belonging to the open project), and arbitrary
**User Folders** (any folder on disk, added manually) [manual p.83-84].

### 8.1 Packs: a real download/update/install pipeline

Installed Packs unfold as browsable folders whose contents *also* surface in the matching Library
labels automatically [manual p.84]. The **Updates** and **Available Packs** sections show
not-yet-installed content with per-item download progress (pausable/resumable), a bulk-select +
bulk-download flow, and a Content-Options toggle to show Pack file sizes before committing to a
download [manual p.85-87]. Deleting an installed Pack returns it to "available" rather than
losing it permanently [manual p.88]. Each Pack can carry its own **Pack Info** page (creator
credit, summary, sometimes a tutorial) [manual p.88-89].

### 8.2 Splice: the deepest single feature in the chapter

Splice is a full third-party cloud sample marketplace integrated directly into the browser
sidebar [manual p.89], gated behind login (browsing/previewing works logged-out; adding to a Set,
saving to a library, or the "Search with Sound" feature requires an account) [manual p.91], with
device-code OAuth-style pairing [manual p.91]. Distinct search surfaces: a text search bar with
autocomplete suggestions [manual p.93], a faceted filter set (instrument type, genre, key, tempo,
one-shot-vs-loop) [manual p.95], sort by popularity/relevance/recency or randomized shuffle
[manual p.95], and browsing by fixed top-level categories (Instruments / Genres / Cinematic FX)
[manual p.96].

The standout feature: **"Search with Sound"** — drag a clip from your own project (or capture a
time-selection) into a drop area, and Splice returns **50 audio-similarity-matched samples**
[manual p.97]. This is genuine audio-content-based retrieval, not tag/metadata matching.

Two integration details worth noting as *design lessons*, not features to copy: (1) previewing
defaults to **tempo-synced looped playback** regardless of whether the file is a one-shot or a
loop, with an explicit "Raw" toggle to hear it at its original, unstretched tempo instead
[manual p.99] — i.e. the *default* preview experience answers "how will this sound in my song,"
not "what is this file objectively." (2) Any clip built from a dragged-in Splice sample has its
**Warp Mode force-set to Complex** automatically [manual p.99] — the system actively prevents the
imported sound from surprising you by playing back differently than it previewed.

### 8.3 Ableton Cloud & Push transfer

**Ableton Cloud** syncs up to eight Sets from the Move/Note hardware line into the Places sidebar
[manual p.103], one-directional (Move/Note → Live, not the reverse) [manual p.104] — Ableton's own
manual recommends "Collect All and Save" immediately after opening a synced Set to pull all its
referenced samples into a proper local Project folder [manual p.104], because synced-Set samples
otherwise live only in the User Library and can go missing if that location isn't reachable
(e.g. an unmounted external drive) [manual p.104]. **Push** standalone-mode file transfer is a
parallel mechanism: pair over local Wi-Fi with a six-digit confirmation code, then browse and pull
Standalone-Mode-authored Sets and the Push's own User Library directly into Live
[manual p.105-107].

### 8.4 User Library: a portable, fixed-shape personal content folder

The **User Library** has a fixed default location (`~/Music/Ableton/User Library` on Mac)
[manual p.108], relocatable, and a fixed default folder shape: `Clips / Defaults / Grooves /
Presets / Samples / Templates`, plus two special subfolders (`ABL Assets` for Cloud-synced
assets, `Chord Banks` for the Stacks MIDI tool) [manual p.108-109]. Its whole point, stated
directly, is portability: "because the User Library has its own unique location... it can easily
be backed up or shared between different Live installations" [manual p.108]. Saving a clip or
preset that references audio automatically pulls the referenced samples along with it
[manual p.109-110] (governed by a "Collect Files on Export" setting, default Always
[manual p.110]) — i.e. Ableton treats "save this item" as "save this item **and everything it
needs to sound the same elsewhere**" by default, not as a reference that can silently break.

### 8.5 Current Project: an auto-versioned backup folder, no git required

Notable for dotbeat specifically: once a Project has been saved twice, Ableton auto-populates a
**Backup folder inside Current Project** containing the **last ten saved versions**, timestamped,
with the oldest auto-pruned on overflow (deleted backups go to the OS trash, not gone instantly)
[manual p.112-113]. This is Ableton's entire answer to "I want an earlier version of this file
back" — no git, no diff, just numbered snapshots capped at ten.

### 8.6 User Folders: arbitrary external content, explicitly scanned/indexed

Any folder anywhere on disk can be added to Places (drag from Finder/Explorer, or an explicit "Add
Folder" browser action) [manual p.113-114]. Adding a folder triggers a **scan/index pass**
("teaches the browser about its contents"), shown as a spinner next to the Places label while
running [manual p.114]. Moved/renamed/disconnected folders show up **grayed out but still
present** in the sidebar rather than silently vanishing, with an explicit "Locate Folder" repair
action and a separate "Remove from Sidebar" forget action [manual p.114]. The manual explicitly
warns against pointing this at an entire hard drive or a very large folder, citing re-indexing
cost on every launch [manual p.114] — a direct, first-party acknowledgment that "index everything
on disk" doesn't scale and shouldn't be the default UX.

## 9. Navigation & previewing

Keyboard navigation (arrow keys to scroll/open-close folders/move between sidebar and content
pane, `Ctrl/Cmd`-held-while-opening to keep prior folders open) is a first-class, fully specified
input mode [manual p.114-115], not an incidental afterthought.

**Previewing** has its own toggle, separate from selection [manual p.115]: with Preview armed,
simply arrow-key-navigating the list auditions each item; without it armed, `Shift Enter` or the
right-arrow key previews on demand [manual p.115-116]. The Preview tab shows a scrubbable
waveform (scrubbing disallowed on Warp-off-saved clips) [manual p.116]. The **Raw** toggle governs
whether previews snap to the next bar boundary and tempo-sync-loop (Raw off, the default) or play
unlooped at original tempo (Raw on) [manual p.116-117] — same tempo-sync-by-default philosophy as
the Splice preview behavior above. Preview volume has its own dedicated knob on the Main track,
and can be routed to a separate physical output pair for headphone cueing while the mix continues
on the main outs [manual p.117].

## 10. Getting content into a Set

Four documented mechanisms [manual p.118-119]:

1. **Drag onto an existing track** — applies to that track directly.
2. **Drag into empty space** to the right of Session tracks / below Arrangement tracks — creates
   a **brand-new track** of the appropriate kind and places the item there.
3. **Double-click or `Enter`** on a device/sample — loads onto the *currently selected* track
   (Session or Arrangement); for samples specifically, this loads into a **Simpler device** on
   MIDI tracks or directly into a **clip slot** on audio tracks — i.e. the same gesture resolves
   to a different concrete action depending on track type, without the user having to think about
   it.
4. **OS-level drag from Finder/Explorer** works exactly like a browser drag — the browser isn't a
   privileged surface, external files are first-class too.

---

## Feature comparison: Ableton's browser vs. dotbeat's `ContentBrowser.tsx`

*Grounded directly in `ui/src/components/ContentBrowser.tsx`, `ui/src/daemon/library.ts`,
`src/daemon/daemon.ts` (the `/library*` routes), `ui/src/components/ArrangementView.tsx`
(`handleLibraryDrop`), and `docs/product-roadmap.md`'s "Preset / content library" row group —
read this pass, not assumed.*

### (a) Shared — dotbeat already has a working equivalent

| Ableton concept | dotbeat equivalent |
|---|---|
| Drag preset/sample/device onto a track [manual p.118] | `ContentBrowser.tsx`'s `draggable` rows + `ArrangementView.tsx`'s `handleLibraryDrop` — presets, kit lanes/kits, soundfonts, all drag-onto-track-header |
| Content organized by taxonomy (Sounds filter-group categories) [manual p.81] | Phase 18 Stream S's category taxonomy (`SYNTH_CATEGORY_ORDER`/`DRUM_CATEGORY_ORDER`), grouped sections in `ContentBrowser.tsx` |
| Preview before loading, real audio, no file mutation [manual p.115-116] | `engine.previewSynthPreset`/`previewDrumPreset`/`previewBuffer`/`previewSoundfont` — zero writes, matches Ableton's Preview-toggle philosophy exactly |
| Hot-swap a preset without leaving the device editor | Shipped (Phase 23 Stream BB) — a preset picker inside `SynthPanel`/`InstrumentPanel` |
| Packs unfold to reveal contents, also surface in matching type-labels [manual p.84] | Kit groups (`KitGroup`) expand to show per-lane one-shots (`KitLaneRow`), same "container unfolds to leaves" shape |
| "Add as new track" for content with no existing target track | `SoundfontRow`'s `+` add-instrument-track button (though only for soundfonts today — see gap list) |

### (b) Ableton has it, dotbeat does not

Every row below is a confirmed absence — checked directly against `ContentBrowser.tsx` (280
lines, no search input, no keydown handlers, no tag/color state) and `ArrangementView.tsx`'s
`handleLibraryDrop` (drop target is the track header only, never the empty-space area below/right
of tracks).

1. **No search bar at all.** Ableton's AND-logic text search + `#tag` search [manual p.63-65] has
   no dotbeat analog; browsing is scroll-and-look only.
2. **No tags or Filter View.** No cross-cutting, user-extensible tagging (Ableton's Tag
   Editor/Quick Tags, [manual p.72-79]) beyond the single fixed `category` field baked into each
   preset's JSON.
3. **No Collections (favorites/color labels).** No user-curated cross-type grouping
   [manual p.79-81].
4. **No keyboard navigation.** No arrow-key list traversal, no `Shift+Enter`-to-preview
   [manual p.114-116] — mouse/drag-only today.
5. **No "drag into empty space creates a new track."** Ableton's mechanism 2 [manual p.118] has no
   dotbeat equivalent for presets or kits — only the soundfont row's dedicated `+` button covers
   "no target track exists yet," and only for instrument tracks.
6. **No "Current Project" content view.** Ableton's Places section surfaces the *project's own*
   already-imported files [manual p.84, p.111]; `GET /library` only returns the bundled
   `presets/factory.json` + `presets/kit-*/` + `presets/sf2/*.sf2` catalog — a sample or soundfont
   already registered into *this* project's own `media/` folder (via a prior drag) is not
   re-browsable/reusable from the sidebar for a second track.
7. **No arbitrary User Folders.** No "point the browser at a folder on my disk" mechanism
   [manual p.113-114] — the catalog is hardcoded to the daemon's bundled `presets/` tree.
8. **No sortable/configurable columns.** Ableton's Content Options menu (extra columns, sort,
   extension visibility) [manual p.62-63] has no equivalent; rows show name + a fixed one-line
   meta string.
9. **No browser history (back/forward).** [manual p.69-70] — not applicable yet since there's no
   search/filter state to navigate between, but will matter once (2) exists.
10. **No tempo-synced/Raw preview distinction.** [manual p.99, 116-117] — dotbeat's preview always
    plays the raw buffer; not yet a gap in practice since current content is one-shots/presets, not
    loops, but will matter the moment loop-based sample content (Beats-mode/loop browsing) exists.
11. **No auto-tagging via sound analysis or plug-in metadata.** [manual p.72-73] — not relevant
    without a plugin host (WAM2 is still a roadmap item, not shipped) and a heavier lift than
    dotbeat's current content scale justifies.

### (c) dotbeat has it, Ableton's chapter does not describe an equivalent

- **Zero-licensing-risk-by-construction content provenance.** Every soundfont row shows its
  `license`/`source` fields inline in the row's `title` tooltip (`SoundfontRow`,
  `ContentBrowser.tsx:162`) — a direct product of `docs/research/09-sample-source-licenses.md`'s
  license-audit discipline. Ableton's chapter never surfaces licensing metadata to the user in the
  browser itself (Splice's own licensing is handled entirely server-side, invisible until you dig
  into Splice Settings, [manual p.102]).
- **Presets as literal, git-diffable edit lists, never in-file references.** Dragging a dotbeat
  preset writes ordinary `.beat` param lines (D9, "presets are tooling, never grammar") — the
  *result* of a drag is indistinguishable in the file from hand-typed edits. Ableton's Presets
  Folder / Defaults Folder model [manual p.110] is a reference-based system (the Set stores which
  device/preset was loaded, resolved against the User Library at load time) — closer to what D9
  explicitly rejected for dotbeat's own format.
- **Every install action returns the fresh document, applied straight to the store** (`postLibrary`
  in `library.ts`) — a direct product of dotbeat's daemon-owns-the-file architecture; Ableton's
  browser has no analogous "the file is the single source of truth, every UI action is provably a
  diff" property to describe, because `.als` isn't diff-friendly to begin with (`ROADMAP.md` §1).

---

## Prioritized recommendations

Rated **P0** (do next, cheap and clearly load-bearing at current or near-term scale), **P1**
(worth scoping once a concrete trigger condition hits), **P2** (real idea, not urgent, revisit
opportunistically), or **Do not build** (Ableton's own solution to a problem dotbeat doesn't have,
or one D1/D9/D13 already ruled out on purpose).

| # | Recommendation | Priority | Why / build approach |
|---|---|---|---|
| 1 | **Add a search bar to `ContentBrowser.tsx`** — plain substring/AND-term match over preset name + category + description, kit lane names, soundfont filename. | **P0** | Cheapest possible win: it's client-side filtering over data `fetchLibrary()` already has in memory, no daemon route needed. Even at today's 36 presets + a few kits, scrolling-and-scanning is already slower than typing 3 letters; becomes actively painful the moment Tier 2/3 sound-quality content (research 07) lands. Model the AND-not-OR semantics [manual p.63] exactly — it's a well-tested, low-surprise rule. |
| 2 | **Surface the project's own already-registered media as a browsable "This Project" section** (Ableton's Current Project label, [manual p.84, 111]). | **P0** | The daemon already knows every sample/soundfont registered under the open project's `media/` folder (that's how `installKitLane`/`installSoundfont` work today) — this is a read-only `GET /library` extension (add a `project: {samples, soundfonts}` field sourced from the doc's own media references), not new infrastructure. Closes a real, concrete workflow gap: today, reusing a sample already imported for one drum track on a second track has no browser path at all. |
| 3 | **"Drag onto empty track-list space creates a new track"** for presets and kits, not just soundfonts. | **P1** | `addTrackOfKind` already exists (used by the soundfont `+` button and the toolbar); the only missing piece is a drop target below/right of the track list in `ArrangementView.tsx` that infers track kind from the payload type (`preset.kind` / drum vs audio kit-lane) and calls `addTrackOfKind` + the matching install function in sequence. Scope trigger: do this once (1) ships and search makes "audition many things quickly" common enough that "drop onto nothing" becomes a real friction point, not before. |
| 4 | **A lightweight tag field on presets/kits (`presets/factory.json`), with tag-based filtering in `ContentBrowser.tsx`.** | **P1** | Cross-cutting tags (a bass patch tagged both `bass` and `warm` and `analog`) solve a real limit of the current single fixed `category` field the moment the library grows past ~50-100 items — Ableton's own chapter treats "tags as a way to discover content you're not familiar with" [manual p.72] as a core value, not a nice-to-have. Fits D9's "presets are tooling" philosophy cleanly: tags live in `presets/factory.json` metadata (not the `.beat` grammar), never touch a project file. Scope trigger: once preset/kit/sample count crosses roughly 100 items (concretely, once Tier 2 sample-based instruments or the variation loop's curated output start landing in the library) — building it now for 36 items is premature. |
| 5 | **Keyboard navigation in `ContentBrowser.tsx`** (arrow-key list traversal + a preview-on-select toggle, [manual p.114-116]). | **P2** | Real and well-specified in the manual, but lower leverage than (1)-(4) given dotbeat's GUI is already mouse/drag-centric elsewhere (piano roll, mixer). Worth a half-day once the browser has enough rows that scrolling by hand is the bottleneck. |
| 6 | **Backup-folder-style numbered snapshots as a browser feature.** | **Do not build.** | Ableton's Current-Project Backup folder (last 10 saves, auto-pruned, [manual p.112-113]) is explicitly what a DAW without real version control has to build instead. dotbeat already has the strictly stronger answer — git-backed checkpoints, named pins, and full history (`docs/decisions.md` D3/D10, shipped, `phase-15-history-panel.md`). Re-deriving Ableton's weaker mechanism inside the content browser would be regression, not a gap. Cite this comparison as validation of the existing versioning bet, not a to-do. |
| 7 | **A Splice-style cloud sample marketplace / "Search with Sound" audio-similarity search.** | **Do not build (for now).** | Real, well-built feature — genuinely the most technically interesting thing in this chapter (drag a clip in, get 50 audio-similarity matches back) — but it requires a hosted content marketplace, licensing infrastructure, and a network dependency, none of which fit dotbeat's local-machine-only distribution decision (`docs/decisions.md` D13) or its document-only/no-hidden-service philosophy (D1). If a genuinely local-first version ever makes sense (e.g. "find samples similar to this one *within my own `presets/`/`media/` library*" using an embeddings model running locally), that's a distinct, much narrower feature worth its own research pass — not a reason to build cloud infrastructure now. |
| 8 | **Ableton Cloud / Push standalone-hardware sync.** | **Do not build.** | No dotbeat analog exists or is planned — no companion hardware, no cloud sync service (D13). Zero relevance. |
| 9 | **A full Tag Editor UI (nested parent/subtag hierarchy, per-item batch tagging modal, [manual p.75-77]).** | **P2, and only after (4).** | The *data model* (flat tags on presets/kits) is P1; the *rich editor chrome* Ableton builds around it (subtags, custom groups, a whole modal) is real over-engineering risk for dotbeat's current scale — a flat multi-select tag list per item is enough until there's evidence the two-level hierarchy is actually needed. Don't build the hierarchy speculatively. |
| 10 | **Sortable/configurable content-pane columns.** | **P2.** | Low cost, low urgency at 36-100 items; revisit once library size or per-item metadata (added via #4/#9) makes "sort by X" a real ask rather than a hypothetical one. |

---

## Sources

Ableton Live 12 Reference Manual, Chapter 4, "Working with the Browser," pp. 60-119 (owner-supplied
PDF, `prior_art/`, gitignored; extracted this pass via `pdftotext -layout` to
`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-chapters/ch04.txt`). dotbeat internal (read
directly this pass): `ui/src/components/ContentBrowser.tsx`, `ui/src/daemon/library.ts`,
`ui/src/components/ArrangementView.tsx` (`handleLibraryDrop`, `addTrackOfKind`), `src/daemon/daemon.ts`
(`/library*` routes), `docs/product-roadmap.md` ("Preset / content library" section),
`docs/decisions.md` (D1, D9, D13), `docs/research/07-sound-design-sources.md`,
`docs/research/09-sample-source-licenses.md`, `docs/research/18-ableton-ui-architecture.md`,
`docs/research/30-ableton-clip-visualization.md` (cross-checked for the "manual images aren't
text-extractable" caveat, not re-derived).
