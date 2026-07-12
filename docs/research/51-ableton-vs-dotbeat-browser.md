# Research 51 — Ableton Live 12 vs. dotbeat: browser/content-library feature comparison

*2026-07-12. Builds directly on `docs/research/32-ableton-browser.md` (text-only primer on
manual chapter 4, pp.60-119). That pass explicitly flagged its own limitation: it never looked at
the chapter's screenshots. This pass closes that gap — 17 of the chapter's rendered page images
were viewed directly (`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch04/`, pages
060, 063, 066, 069, 072, 075, 078, 081, 084, 087, 090, 093, 096, 099, 108, 114, 117) — and produces
a direct, structured feature/UI comparison against dotbeat's shipped Content Browser (Phase 22
Stream AH), grounded in both the manual's prose and its actual screenshots. Research-only; no code
was written or modified.*

**Grounding checked against current status before writing a word of this**: `ROADMAP.md`,
`docs/decisions.md` (D1 document-only, D9 presets-as-tooling, D13 local-machine-only distribution),
`docs/product-roadmap.md`'s "Preset / content library" row group (3 features, all shipped) — nothing
below proposes anything that contradicts a decision already made or duplicates something already
shipped. dotbeat-side claims are read directly from `ui/src/components/ContentBrowser.tsx`,
`ui/src/daemon/library.ts`, `src/daemon/daemon.ts`'s `/library*` routes, and `src/core/preset.ts`
this pass — not inferred or carried over unverified from research 32.

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

| Capability | Ableton | dotbeat |
|---|---|---|
| Drag preset/sample onto a track applies it directly | Mechanism 1, drag onto existing track [manual p.118] | `ContentBrowser.tsx`'s `draggable` rows (`PresetRow` line 93, `KitLaneRow` line 112, `SoundfontRow` line 154) → `ArrangementView.tsx`'s `handleLibraryDrop` |
| Content grouped by a fixed type taxonomy | Library sidebar: `Sounds/Drums` by content-type, `Instruments/Audio Effects/MIDI Effects` by device [manual p.81-82, screenshot p-081] | `SYNTH_CATEGORY_ORDER`/`DRUM_CATEGORY_ORDER` (`ContentBrowser.tsx:43-44`) driving `groupByCategory` (`ContentBrowser.tsx:46-53`), sourced from Phase 18 Stream S's taxonomy |
| Collapsible/foldable groups in the browser tree | Library labels foldable; Packs unfold to reveal contents [manual p.84, screenshot p-084] | `Section` component (`ContentBrowser.tsx:58-70`, collapsible top-level groups) and `KitGroup` (`ContentBrowser.tsx:134-152`, kit unfolds to its lane rows) |
| Preview before committing, no project mutation | Preview tab: scrubbable waveform, dedicated Preview/Cue volume knob [manual p.115-117, screenshot p-117] | `PreviewButton` (`ContentBrowser.tsx:72-91`) → `engine.previewSynthPreset`/`previewDrumPreset`/`previewBuffer`/`previewSoundfont` — zero writes to the `.beat` file, matches the "audition without committing" philosophy exactly |
| "No target track exists yet" has its own affordance | Drag into empty space creates a new track of the right kind [manual p.118] | `SoundfontRow`'s `+` button (`ContentBrowser.tsx:176-190`) mints a brand-new instrument track — **partial parity**: only soundfonts have this today, not presets/kits (tracked as gap 5 below) |
| Hot-swap without leaving the editing surface | (Device chooser inside a device, implicit throughout the manual) | Phase 23 Stream BB: an in-panel preset/soundfont picker inside `SynthPanel`/`InstrumentPanel`, reusing the same `/library` daemon routes |

### b) In Ableton, not in dotbeat

Checked directly against `ContentBrowser.tsx` (281 lines total — one `useEffect` fetch, four row
components, one `Section` wrapper; no `<input>` element, no `onKeyDown` handler, no tag/color state
anywhere in the file) and confirmed against `src/daemon/daemon.ts`'s six `/library*` routes and
`src/core/preset.ts`'s `BeatPreset` interface (no `tags` field; only `filterPresetsByCategory`,
`src/core/preset.ts:137-142`, exact-match on one fixed `category` string).

1. **Text search bar, AND-logic across multiple terms.** "electric bass" only matches items
   containing *both* words [manual p.63, screenshot p-063 shows the `Search (Cmd+F)` field docked
   above the sidebar]. `Ctrl/Cmd F` also force-switches to the `All` label so search spans every
   location at once [manual p.63]. No search input exists anywhere in dotbeat's browser.
2. **Filter View: clickable filter-group chips that compose with search.** The screenshot at
   [manual p.60, p-060] shows the full anatomy — `Type`, then faceted groups like `Sounds >
   Mallets > Pad`, then a free-standing `Character` group (`Acoustic/Analog/Bright/Dark/Digital...`)
   as toggleable pill-shaped tag chips, with a `Results` bar showing the live filter count and a
   `Clear` button. [manual p.72, screenshot p-072] additionally shows the Filter View **menu**
   itself — a checklist (`Content/Type/Sounds/Drums/Character/Devices/Function/Format/MIDI
   Tools/Clips/Genres/Key/Grooves/Tunings/Creator`) letting the user widen or narrow which facets
   even show up, and this selection is saved **per Library label**, not globally. dotbeat has no
   faceted filtering of any kind.
3. **Tag Editor: a dedicated authoring surface with parent/child tag groups.** [manual p.75,
   screenshot p-075] shows a folded group ("Sounds ▸") containing pre-checked tags, and a plain
   `Add Tag...` affordance at the bottom of every group. [manual p.78, screenshot p-078] shows the
   two-step *create* flow: typing an unrecognized name prompts a choice between "Create new parent
   tag..." or "Create new tag group...", and — the standout small detail — multi-item selections
   show the **union** of all tags present with an `*` marking any tag not shared by every selected
   item (`* Bright`, `* Snappy` in the screenshot, plain `Basic`/`Electric Guitar` unmarked).
   `BeatPreset` has no tag field at all (confirmed, `src/core/preset.ts:21-36`).
4. **Collections: color-coded, cross-type, user-curated labels.** [manual p.81, screenshot p-081]
   shows the actual edit-mode UI: a checkbox column (`Done` header) next to seven fixed color rows
   (`Favorites` red, `Orange`, `Yellow`, `Green`, `Blue`, `Purple`, `Gray`) letting the user toggle
   which colors even appear in the sidebar. Assignable via number keys `1`-`7` to *any* item type at
   once (a drum sound, a MIDI effect, a plug-in, all tagged the same color) [manual p.79]. No
   analog exists in dotbeat — there is no favoriting/starring/coloring mechanism for library
   content (track *header* recoloring exists, per `docs/product-roadmap.md`'s "Track management"
   row, but that colors a project track, not a browsable library item).
5. **Content Options menu: extra sortable/reorderable columns, extension visibility.**
   [manual p.63, screenshot p-063] shows the actual menu — `Size/Rank/Date Modified/Type/Place`,
   plus `Hide All Extra Columns` and a checked `Show File Extensions` toggle — opened via a `···`
   button next to the `Name` column header, itself click-to-sort ascending/descending. Every row in
   `ContentBrowser.tsx` renders a fixed `lib-row-name` + one fixed `lib-row-meta` string (e.g. `{N}p`
   parameter count, `ContentBrowser.tsx:107`) with no sort or column configuration whatsoever.
6. **Browser navigation history, independent of project undo.** [manual p.69, screenshot p-069]
   shows dedicated `‹ ›` Back/Forward buttons docked to the left of the search bar, plus
   `Ctrl/Cmd ]`/`[` shortcuts, traversing every prior search/label state — explicitly a *browsing*
   history, not the project's own undo stack. dotbeat has neither browser history nor (per
   `docs/product-roadmap.md`'s "Undo / redo" row) project undo yet.
7. **Saving a search as a permanent, icon-customizable custom label.** The `Add Label` button next
   to `Clear` [manual p.66, screenshot p-066] pins a filtered result set as a durable sidebar entry;
   [manual p.69, screenshot p-069] shows its context menu — `Rename`, `Remove from Sidebar`,
   `Default Icon`, and a full icon-picker grid (dozens of glyphs) for customizing how it appears.
   No equivalent — there is nothing to save, since there is no search/filter state yet (gaps 1-2).
8. **A real Pack download/install/update pipeline.** [manual p.84, screenshot p-084] shows installed
   Packs as an expandable folder tree in the content pane (`Chiral by Fors` → `Presets` →
   `Ambient & Evolving`/`Bass`/`Pads`/... with per-file sizes). [manual p.87, screenshot p-087]
   shows the context menu (`Download Pack`/`Pause Download`/`Resume Download`/`Install Pack`/
   `Cancel Download`) and the actual `Install` button + per-row size column + download-progress
   icon. dotbeat's entire catalog is a hardcoded, pre-bundled `presets/` tree on the daemon's own
   disk (`daemon.ts:1595` `GET /library`) — there is no concept of an installable, downloadable,
   versioned content bundle.
9. **Splice: an embedded cloud sample marketplace, including audio-similarity search.**
   [manual p.90, screenshot p-090] shows the actual Splice home panel docked inside the browser
   sidebar — Login/Try Free buttons, a `Search with Sound` drop zone, four category buttons
   (`Vocals/Drums/Synth/Bass`). [manual p.96, screenshot p-096] shows real search-result rows with
   per-pack thumbnail art, an `Included`/paid toggle, faceted filter dropdowns (`Genres/Key/BPM`),
   and inline tag chips (`grooves`, `drums`, `hip hop`, `dance`) on each result. [manual p.99,
   screenshot p-099] shows the sample-category browsing view (`Wood` category, 1,209 results, its
   own local tag cloud: `game audio`/`drop`/`organic`/`shell`) plus the tempo-sync-by-default /
   `Raw`-toggle preview behavior and the automatic force-set of Warp Mode to Complex on import
   [manual p.99]. Nothing resembling this exists or is planned in dotbeat.
10. **Ableton Cloud & Push hardware sync.** Syncs Sets from Move/Note hardware one-directionally
    into Places [manual p.103-104]; Push standalone-mode pairs over Wi-Fi with a six-digit code
    [manual p.105-107]. No dotbeat analog — no companion hardware exists or is planned.
11. **User Library: a fixed-shape, portable, personal content folder distinct from any one
    project.** [manual p.108, screenshot p-108] shows the actual Settings toggle row (`Show
    Downloadable Packs`/`Show Cloud`/`Show Push`/`Show Splice`, all `On`) and states the fixed
    on-disk path (`~/Music/Ableton/User Library` on Mac) and its default folder shape (`Clips/
    Defaults/Grooves/Presets/Samples/Templates`). Its entire point is content a user builds up
    *across every project*, portable by copying one folder. dotbeat has no equivalent — every
    preset/kit currently lives either in the daemon's bundled `presets/` tree (read-only, shared by
    every project) or gets copied *into one specific project's own* `media/` folder on install
    (`installKitLane`, `daemon.ts:1677`) — there is no "save this patch I just tweaked so I can
    reuse it in a *different* project" path.
12. **Current Project auto-backup (last 10 saves, auto-pruned).** [manual p.112-113] — a plain
    numbered-snapshot folder, no diff, no git. **Not a gap** — see recommendation table, dotbeat's
    git-backed checkpoint/history/pin system (`docs/decisions.md` D3/D10, shipped) is strictly
    stronger; listed here only for completeness against the manual's own inventory.
13. **User Folders: arbitrary disk locations added to the browser, scanned/indexed, with
    graceful-degradation UI for moved/missing folders.** [manual p.114, screenshot p-114] shows the
    actual sidebar state — real added folders (`a b x x`, `s m p x`) sitting alongside the fixed
    `Packs/Splice/Cloud/Push/User Library/Current Project` rows, plus the `Add Folder...` button.
    The text confirms a scan/index pass on add (spinner next to the label), and that
    moved/disconnected folders show up **grayed out but still listed**, with a `Locate Folder`
    repair action separate from a `Remove from Sidebar` forget action. dotbeat's catalog is
    hardcoded to the daemon's bundled tree — no way to point the browser at an arbitrary folder on
    disk at all.
14. **First-class keyboard-only browsing.** Arrow keys scroll/open/close folders and move between
    sidebar and content pane; a Preview-armed toggle auto-auditions on arrow-key navigation, or
    `Shift Enter`/right-arrow previews on demand without arming it [manual p.114-116]. No keyboard
    handler exists anywhere in `ContentBrowser.tsx` — every interaction (drag, click-preview,
    click-add) is mouse/pointer-only.
15. **Multiple distinct "get it into the Set" gestures, one of which dotbeat has no equivalent
    for.** Four documented mechanisms [manual p.118-119]: (1) drag onto an existing track — dotbeat
    has this; (2) drag into empty space right-of/below the track list to spawn a new track of the
    inferred kind — dotbeat has this **only** for soundfonts (`SoundfontRow`'s `+` button,
    `ContentBrowser.tsx:176-190`), not presets or kits; (3) double-click/`Enter` loads onto the
    *currently selected* track, resolving differently by track type (Simpler device vs. clip slot)
    — dotbeat has no double-click/keyboard-driven load path at all, drag is the only gesture; (4)
    OS-level Finder/Explorer drag treated identically to an in-browser drag — not applicable, since
    dotbeat's catalog isn't file-system-backed yet (see gap 13).

### c) In dotbeat, not in Ableton

- **Inline license/provenance metadata on every content row.** `SoundfontRow`'s `title` tooltip
  concatenates `[sf.file, sf.license, sf.source]` (`ContentBrowser.tsx:162`) — a direct product of
  `docs/research/09-sample-source-licenses.md`'s license-audit discipline. Ableton's chapter never
  surfaces licensing metadata in the browser UI itself; Splice's licensing lives entirely
  server-side, invisible until a user digs into Splice Settings [manual p.102].
- **Every content-browser action is a literal, git-diffable edit, never an in-file reference.**
  Dragging a preset writes ordinary `.beat` param lines through the exact same code path as
  `beat preset` / hand-typed edits (D9: "presets are tooling, never grammar") — the *result* is
  indistinguishable in the file from a manual edit. Ableton's Presets Folder / Defaults Folder model
  [manual p.110] is reference-based (a Set stores *which* device/preset was loaded, resolved
  against the User Library at load time) — the exact category of indirection D9 deliberately
  rejected for `.beat`.
- **One typed drag-payload protocol covers every destination, not four separate mechanisms.**
  `library.ts:137-165`'s single `LIBRARY_DND_MIME` + tagged `DragPayload` union (`preset`,
  `kit-lane`, `soundfont`) is read identically by `ArrangementView.tsx`'s track-header drop,
  `StepSequencer.tsx`'s lane-row drop, and (Phase 23 Stream BC) an audio-track drop that mints a
  clip via `installAudioClip` (`library.ts:98-129`) — one wire format, three landing zones, instead
  of Ableton's four independently-specified gestures (§15 above).
- **Every install route returns the fresh document and applies it straight to the store.**
  `postLibrary` (`library.ts:59-74`) — a direct product of the daemon-owns-the-file architecture
  (`docs/decisions.md`, M1). Ableton's browser has no analogous "every UI action is provably a
  diff you could review" property, because `.als` isn't diff-friendly to begin with (`ROADMAP.md`
  §1) — there's no comparable claim the manual could even make.
- **Preview-before-load with zero writes is enforced by construction, not convention.** Every
  preview call (`engine.previewSynthPreset`/`previewDrumPreset`/`previewBuffer`/`previewSoundfont`)
  is an ephemeral engine voice or raw decode-and-play with no path back into `postEdit`/`setDoc` —
  structurally cannot leave a diff. Ableton's preview is also non-destructive, but as an app-level
  behavioral guarantee, not one that falls directly out of the file-is-truth architecture.

---

## 2. Prioritized recommendations

Rated **P0** (do next — cheap, clearly load-bearing at current or near-term scale), **P1** (real
gap, worth building once a concrete trigger condition is hit), **P2** (real idea, not urgent), or
**Do-not-recreate** (Ableton's own answer to a problem dotbeat's architecture already solves better,
or one that conflicts with a standing decision — D1 document-only, D13 local-machine-only).

| # | Feature (from 1b) | Priority | Build recommendation |
|---|---|---|---|
| 1 | Text search bar, AND-logic | **P0** | Client-side only — `fetchLibrary()`'s catalog is already fully in memory in `ContentBrowser.tsx`. Add a controlled `<input>` above the `Section` list; split the query on whitespace, filter every row list (`synthPresets`/`drumPresets`/`catalog.kits`/`catalog.soundfonts`) by `.every(term => haystack.includes(term))` over name+category (+description). No daemon route needed. Model the AND-not-OR rule exactly [manual p.63] — it's a well-tested, low-surprise default. Half a day. |
| 2 | Filter View: clickable facet chips | **P1** | Depends on a tag/facet data source existing (#3) for anything beyond the existing single `category` field. As a first cut with *zero* new data: render `category` itself as a row of clickable chips above the list (a visual affordance over what `groupByCategory` already computes, `ContentBrowser.tsx:46-53`) — composes with #1's search the way Ableton's chips compose with its search bar [manual p.64]. Full per-label-remembered filter-group visibility (the `p-072` checklist menu) is real over-engineering at 36-100 items; skip that part. |
| 3 | Tag Editor (tags on presets/kits, incl. multi-select union+asterisk) | **P1** | Add an optional `tags?: string[]` field to `BeatPreset` (`src/core/preset.ts:21-36`) and populate it in `presets/factory.json`; extend `GET /library` (`daemon.ts:1595`) to pass tags through unchanged. In `ContentBrowser.tsx`, render tags as small pills under each row's name (reuse the `lib-row-meta` slot) and feed them into #2's filter chips. **Explicitly do not build** Ableton's nested parent/subtag hierarchy or a dedicated Tag Editor modal [manual p.75-77] — a flat tag list per item is sufficient until there's concrete evidence 100+ items need two-level grouping; the asterisk-on-partial-selection behavior [manual p.78] only matters once multi-select exists in the browser, which it doesn't today. Trigger to actually build: once Tier 2 sample-based instruments (`docs/research/07-sound-design-sources.md`) or curated variation-loop output push the catalog past ~100 items — building it now for 36 items is premature. |
| 4 | Collections (color-coded cross-type labels) | **P2** | Real idea, low urgency: dotbeat's browser has no favoriting concept at all today, and #1-#3 solve more of the actual "find the thing" problem per hour of work. If built, keep it flat (a `favorite: boolean` or a small fixed color enum stored client-side in `localStorage`, not the `.beat` file or `presets/factory.json` — this is browsing-session UI state, same category as `Section`'s local `open` state, `ContentBrowser.tsx:59`) rather than Ableton's full 7-color, per-item-multi-assignable, show/hide-per-color system [manual p.79-81]. |
| 5 | Content Options menu (sortable/extra columns, extension visibility) | **P2** | Low cost, low urgency at 36-100 items with no file-extension ambiguity (dotbeat's rows aren't raw filesystem browsing, they're typed catalog entries). Revisit once #13 (User Folders) ships and rows genuinely are raw files with extensions worth toggling. |
| 6 | Browser navigation history (Back/Forward) | **P2** | Not useful until #1/#2 give the browser actual navigable *state* to go back to — building this before search/filter exist would have nothing to traverse. Sequence directly after #1-#2 land, not before. |
| 7 | Saved-search custom labels | **P2** | Same dependency as #6 — there's no search/filter result to pin yet. Once #1-#3 ship, this is a small addition: a `localStorage`-persisted list of `{name, query, tags}` rendered as extra `Section`s at the top of the browser. Skip Ableton's icon-picker chrome [manual p.69] entirely — a plain name is enough. |
| 8 | Pack download/install/update pipeline | **Do-not-recreate** | dotbeat has no content-marketplace ecosystem, no third-party-publisher story, and D13 (local-machine-only distribution) plus D1 (document-only, no hidden services) both cut against building a download/versioning pipeline for bundled content. The right-sized dotbeat analog — "the sound-quality roadmap's Tier 2/3 content (research 07) ships as bigger bundled `presets/` trees" — needs zero pipeline, just bigger files in the repo (already the current model, already git-lfs-backed per D11). Revisit only if dotbeat content is ever distributed as separately-installable third-party bundles, which isn't scoped anywhere today. |
| 9 | Splice cloud marketplace + Search-with-Sound | **Do-not-recreate** | Conflicts directly with D13 (local-machine-only) and D1 (document-only, no hidden network service) — requires hosted infrastructure, licensing/rights management, and a live network dependency dotbeat's whole model avoids. The one narrow idea worth a future, separate research pass: **local-only "find samples similar to this one within my own `presets/`/`media/`"** using a small local embeddings model — genuinely different scope (no marketplace, no network, no licensing surface), not a build-now item. |
| 10 | Ableton Cloud / Push hardware sync | **Do-not-recreate** | Zero relevance — no companion hardware, no cloud sync service exists or is planned; nothing in the roadmap points this direction. |
| 11 | User Library (personal, cross-project content folder) | **P1** | Concrete, real gap distinct from #8/#9: today a user-tweaked patch lives only inside the one project's `.beat` file — there's no "save this synth patch so tomorrow's *different* project can drag it in too." Build as a new top-level `presets/user/` tree next to the existing bundled `presets/factory.json`, read the same way `GET /library` already reads factory content (`daemon.ts:1595`), plus a new `POST /library/save-preset` that snapshots a track's current live param state (the same shape `applyPreset` consumes in reverse) into `presets/user/<name>.json`. Keeps D9's "presets are tooling, never grammar" property intact — a save is still just producing a JSON file the exact same apply-path already knows how to read, not a new indirection. Trigger: as soon as the variation loop (`beat vary`/`beat score`) or ordinary sound design starts producing patches worth reusing across projects — arguably already true today, hence P1 not P2. |
| 12 | Current Project auto-backup (10-save cap) | **Do-not-recreate** | dotbeat's git-backed checkpoint/history/pin system (`docs/decisions.md` D3/D10, shipped, `docs/phase-15-history-panel.md`) is the strictly stronger existing answer to the same problem Ableton is solving here. Re-deriving Ableton's weaker numbered-snapshot mechanism inside the content browser would be a regression, not a gap — cite this comparison as validation of the existing versioning bet. |
| 13 | User Folders (arbitrary disk folder, scanned/indexed) | **P1** | Directly blocks the sound-quality roadmap's Tier 2 (`docs/research/07-sound-design-sources.md`: sample-based instruments, Freesound ingestion) the moment that content doesn't ship pre-bundled in `presets/`. Build as a new `GET /library/folders` (list of user-added absolute paths, persisted in a small daemon-local config file, not the `.beat` file — this is machine-local browsing config, same category as D13's "local-machine-only" framing) plus a recursive scan populating the same `LibraryCatalog` shape `fetchLibrary()` already returns (`library.ts:38-43`), so `ContentBrowser.tsx` needs no new row-rendering code, only a new "Add Folder" button and section. Skip the moved/missing-folder graceful-degradation UI [manual p.114] for a v1 — fail loud (remove from the list, log an error) rather than gray-out/repair; add repair UX only if it proves annoying in practice. |
| 14 | Keyboard-only navigation | **P2** | Real and well-specified in the manual, but lower leverage than #1/#3/#11/#13 given dotbeat's GUI is already mouse/drag-centric everywhere else (piano roll, mixer, arrangement view) — adding keyboard nav to just the browser would be an inconsistent surface, not a coherent accessibility push. Worth a half-day once #1's search makes "arrow through filtered results" a real, frequent motion. |
| 15 | "Drag into empty space creates a new track" for presets/kits (not just soundfonts) | **P1** | `addTrackOfKind` already exists (used today by `SoundfontRow`'s `+` button and the toolbar) — the only missing piece is a drop target below/right of the track list in `ArrangementView.tsx` that reads `DragPayload.type` (`preset`/`kit-lane`, not just `soundfont`) to infer track kind, then calls `addTrackOfKind` followed by the matching install function (`applyPresetToTrack`/`installKitLane`) in sequence. Cheap because the payload protocol (`library.ts:139-144`) and every install function it needs already exist — this is wiring, not new capability. |

---

## Sources

Ableton Live 12 Reference Manual, Chapter 4, "Working with the Browser," pp. 60-119 (owner-supplied
PDF, `prior_art/`, gitignored) — both the `pdftotext -layout` text extract
(`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-chapters/ch04.txt`, per research 32) and, new
this pass, 17 of the chapter's rendered page images viewed directly
(`/Users/willpatrick/.claude/jobs/32ed678c/tmp/ableton-images/ch04/p-{060,063,066,069,072,075,078,
081,084,087,090,093,096,099,108,114,117}.jpg`, per the sample manifest at
`.../ch04/SAMPLE_MANIFEST.txt`). dotbeat internal (read directly this pass, not carried over
unverified): `ui/src/components/ContentBrowser.tsx` (full file, 281 lines), `ui/src/daemon/library.ts`
(full file, 165 lines), `src/daemon/daemon.ts` (`/library*` routes, lines 1595-1877, confirmed via
direct read), `src/core/preset.ts` (`BeatPreset` interface lines 21-36, `filterPresetsByCategory`
lines 137-142 — confirmed no `tags` field and no search/filter machinery beyond the one `category`
match). Also consulted for status/decisions: `ROADMAP.md`, `docs/decisions.md` (D1, D9, D11, D13),
`docs/product-roadmap.md` ("Preset / content library" row group), and
`docs/research/32-ableton-browser.md` (the prior text-only pass this one extends — its own feature
comparison and recommendation table were read and deliberately not duplicated verbatim; overlapping
conclusions here were independently re-derived against the screenshots and current source, not
copy-pasted).
