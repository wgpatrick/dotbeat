# Research 33 — Ableton Live 12 Reference Manual, chapter 5: "Managing Files and Sets"

*2026-07-12. Owner-commissioned parallel research pass: one chapter of the official Ableton Live 12
Reference Manual (999 pages, dropped into `prior_art/`, gitignored) per stream, mined for ideas/gaps
relevant to dotbeat's design and roadmap. This pass covers manual pages 120-149. Research-only — no
code was written or modified.*

## How to read this doc

- **[manual p.NNN]** — a claim read directly from the chapter extract
  (`ableton-chapters/ch05.txt`, `pdftotext -layout` output), with the PDF page number derived from
  the chapter's known start page (120) plus position relative to the form-feed page-footer markers
  in the raw text. High confidence — this is primary-source reading, not web search.
- **[dotbeat]** — read directly from this repo's current source this pass, cited with exact
  file:line so a future stream can jump straight to the code, not inferred from the roadmap docs
  alone.

## 0. Why this chapter matters more than most for dotbeat

Every other Ableton chapter is about *what you can do inside a Set*. This one is about **the thing
around the Set** — how a `.als` file relates to the audio it references, how it survives being
copied, renamed, moved, shared, and partially lost. That is close to dotbeat's entire reason for
existing: `.beat` is a diff-friendly text file specifically so that "what changed" and "where does
this project's data actually live" are legible and git-native, not a black box a proprietary File
Manager has to reverse-engineer. This chapter is the single best point of comparison in the whole
manual for dotbeat's founding thesis (`ROADMAP.md` §1, §4) — and, as it turns out, dotbeat's
content-addressed `media` block (`docs/format-spec.md` v0.5, `src/core/document.ts:576-580`)
already independently arrived at several of the same ideas Ableton's File Manager exists to
paper over, by construction rather than by tooling.

## 1. Sample files — direct-from-disk playback, decoding cache, analysis files

- Live plays samples directly from disk rather than loading them fully into RAM, which is why large
  sample libraries don't hit memory limits — the tradeoff named explicitly is disk throughput/
  fragmentation, not RAM [manual p.120].
- Live accepts both uncompressed (WAV/AIFF/SDII) and compressed (MP3/AAC/Ogg Vorbis/Ogg FLAC/FLAC)
  sample formats; compressed samples are transcoded on import into a **Decoding Cache** — a
  temporary, size-and-free-space-bounded folder of decoded copies, auto-pruned by Live, with a
  manual "Cleanup" button that deletes anything not used by the current Set [manual p.120-121].
- **Analysis files (`.asd`)**: a small sidecar Live writes the first time it sees a sample, storing
  data to speed up waveform display, improve stretch quality, and detect tempo — and, distinctly,
  it can also cache **default clip settings** (warp/gain/pitch) if you explicitly click Clip View's
  Save button [manual p.121]. The manual is explicit that these are two different things: analysis
  data (recreatable, just slow for long files) vs. saved default clip settings (not recreatable —
  lost if the `.asd` is deleted) [manual p.121]. Critically, Ableton spells out that **different
  clips referencing the same underlying sample can carry entirely different settings** — the
  `.asd` default is just what a *newly dragged-in* instance starts from, not a shared, live-linked
  parameter set [manual p.121].

## 2. MIDI files — import bakes in, export is a one-way conversion

Importing a MIDI file is architecturally different from importing a sample: **the resulting MIDI
clip's data is copied into the Set and the reference to the original file is severed entirely**
[manual p.127-128] — unlike an audio clip, which stays a pointer to the sample on disk. Exporting a
clip back out as a Standard MIDI file is a distinct, explicit one-way action (File → Export MIDI
Clip), and the manual explicitly flags that this is *not* the same operation as saving a Live Clip
[manual p.128].

## 3. Live Clips — exportable, reusable clip+device-chain bundles

A **Live Clip** is a clip (audio or MIDI) exported to its own file on disk via drag-to-browser, for
reuse across projects [manual p.129]. Two properties worth pulling out:

- **Audio Live Clips store only a reference to the sample, not the audio data itself** — so they
  stay tiny even though they point at large files, "making it easy to develop and maintain your own
  collection" [manual p.129].
- **A Live Clip captures more than the clip's own note/audio content — it also captures the
  originating track's full device chain**, but *only* if dropped onto an empty track or empty
  timeline space; dropped onto a track that already has clips/devices, only the clip's own settings
  land, not the devices [manual p.129]. This is explicitly framed as a way to reuse a whole
  "instrument + FX" idea (e.g., a bassline Live Clip carrying its bass patch), not just note data.
- The manual is careful to distinguish this from the `.asd` default-clip-settings mechanism (§1
  above): the `.asd` default is a single implicit "what a fresh drag-in looks like" annotation on
  *the sample itself*; a Live Clip is an intentional, separately-named, independently-sortable
  **musical idea** stored on disk, and multiple Live Clips can reference the exact same sample with
  totally different warp/pitch/envelope settings, browsable and previewable independently [manual
  p.130].

## 4. Live Sets — create/open/save, and a session-only Undo History

- Standard New/Open/Save, plus **Save Live Set As** (rename/relocate) and **Save a Copy** (branch
  without renaming the currently-open document) as two distinct commands [manual p.130].
- **The Undo History** (View menu, or Cmd/Ctrl+Alt+Z) is a full list of every action since the Set
  was opened, newest at top, and — this is the part worth internalizing — it is **explicitly not
  part of the saved document**: "the Undo History is not saved with a Set once it is closed and is
  refreshed each time the Set is opened. Creating or opening a Set is treated as the first action
  in the Undo History and therefore cannot be undone" [manual p.130-131]. You select any point in
  the list (not just single-step undo/redo) and everything above it greys out as undone; selecting
  a greyed-out entry reapplies it and everything below [manual p.131].

## 5. Merging Sets — drag one Set's contents into another, unfold like a folder

Live treats a Set on disk as browsable, not just openable [manual p.131-134]:

- Dragging a whole Set from the browser onto a track header or an empty drop-area in the *current*
  Set reconstructs all of its tracks (except returns) — clips (both Session and Arrangement),
  devices, and automation, fully rebuilt, not referenced [manual p.131].
- **You can unfold a Set in the browser exactly like a folder**, without opening it, and drag out
  individual tracks, individual Session clips, an isolated device chain, or even Group Tracks
  (including nested ones) from inside it [manual p.132-133]. The manual's own framing: "any Live
  Set can serve as a pool of sounds for any other" [manual p.133].

## 6. Live Projects — the folder that owns a Set's files

A **Live Project** is the folder Live auto-creates around a Set the moment you save it somewhere
new — unless you're saving into an *existing* project folder, in which case no new one is made
[manual p.137]. The chapter walks a concrete example that's worth summarizing because the specific
failure mode it documents is the whole reason this chapter is relevant to dotbeat:

- Save "Tango" on the Desktop → Live creates `Tango Project/` containing `Tango.als` and a
  `Samples/Recorded/` subfolder [manual p.137-138].
- Save-As a second version into the *same* project folder → `Tango Project/` now holds two `.als`
  files sharing one `Samples/Recorded/` folder; Live "will only collect one copy of any samples
  used by the various versions" [manual p.138-139, restated at p.148 §5.11.3].
- Save-As a derivative Set (`"Electro with Piano.als"`) **outside** the original project, on the
  Desktop → a brand-new, sample-less project folder is created, but the Set keeps referencing the
  piano sample back inside `Tango Project/`. The manual states the exact resulting fragility
  plainly: **"There is nothing wrong with this except for when the Tango Project is moved away or
  deleted; then 'Electro with Piano.als' will be missing samples"** [manual p.140-141].
- Live's own stated mitigation is "collecting external files" (§9 below) — an opt-in copy step, not
  a structural guarantee.

## 7. File reference management — replace, hot-swap, edit externally, view location

`File → Manage Files → Manage Set → View Files` lists every file the current Set references, one
line per file, expandable to show every clip/instrument slot using it [manual p.135-137]:

- **Replace** — drag a file from the browser onto an entry to repoint every clip that referenced
  the old file. For audio, Warp Markers are kept only if the new sample is the same length or
  longer, discarded otherwise [manual p.136]. The manual notes, almost in passing, that **Live does
  no verification that the replacement file is actually related to the one it's replacing** — "Live
  will not care if the file you offer is really the file that was missing" [manual p.143, in the
  missing-files-repair context, same underlying replace mechanism].
- **Hot-swap** — a quick-browse-alternatives mode, same underlying operation as Replace.
- **Edit** — opens the referenced sample in an external editor (configured in Settings); Warp
  Markers survive only if the edited file's length is unchanged [manual p.136].
- **Location column** — flags each file as inside the User Library, inside the current Project, or
  "external" (anywhere else), plus a dedicated "missing" state [manual p.137].

## 8. Locating missing files — status-bar warning, manual repair, automatic search

If a Set/Clip/preset references files that are gone, the Status Bar shows a warning and affected
clips/slots render "Offline," playing silence in place of the missing sample [manual p.142].
Repair is two-tier:

- **Manual repair** — drag the correct file from the browser onto the missing-file line
  [manual p.143]. Same "no verification" caveat as §7.
- **Automatic repair** — a search across a chosen folder, the current Project, and/or the Library
  [manual p.143-144], with three explicit outcomes: no candidate (try another folder or go manual),
  exactly one candidate (silently accepted, "problem solved"), or multiple candidates (the user must
  pick, via a Hot-Swap-mode browse-while-it-plays interaction) [manual p.144]. Note the search is
  necessarily filename/heuristic-based — the manual never claims content verification here either.

## 9. Collecting external files, "Collect Files on Export," and aggregated sweeps

- **Collect External Files** copies files from other locations (other Projects, the User Library,
  installed Packs, or arbitrary "elsewhere" drives) into the current Set's project folder, broken
  down by source location with a per-category file count/disk-space readout and a per-category
  yes/no toggle, finalized by a "Collect and Save" button — changes are discarded if you don't click
  it [manual p.145-146]. `File → Collect All and Save` is a one-shot shortcut for the same operation
  across the whole Set, including Core Library/Pack content [manual p.146].
- **Collect Files on Export** (Library Settings, three-way: Always / Ask / Never) governs whether
  dragging a Live Clip, device preset, or track out to the browser also copies its referenced
  samples along with it — Always is the default [manual p.146].
- **Aggregated locating and collecting** — the same locate/collect tooling scales up from "this
  Set" to the whole User Library, the whole current Project, any right-clicked Project, or any
  multi-selection of Sets/Clips/Presets in the browser [manual p.147].

## 10. Finding unused files, and packing a Project into a Pack

- **Finding Unused Files** inspects every file physically present in a Project folder and flags any
  not referenced by any Set/Clip/preset *in that Project* — explicitly **scoped per-project**: a
  file another Project still needs is reported as "unused" here regardless [manual p.147]. The
  manual's own recommended workflow to avoid data loss from this scoping gap: collect files into
  their own Projects first, *then* purge [manual p.147].
- **Packing a Project into a Pack** (`.alp`) bundles a whole Project folder with lossless
  compression (manual claims up to ~50% size reduction) for archiving/transfer, non-destructively
  (packing doesn't touch or delete the source Project) [manual p.148].

## 11. Export Audio/Video — rendering options

`File → Export Audio/Video` [manual p.122-127]:

- **What to render**: Main (post-fader master), All Individual Tracks (one same-length file per
  track including returns and MIDI-with-instrument tracks, "making it easy to align them in other
  multitrack programs" — i.e. explicit stem export), Selected Tracks Only, or a single chosen track
  [manual p.123].
- **Render Start/Length**, settable directly or by pre-selecting a time range in Arrangement View —
  and a sharp caveat: **the render always reflects exactly what you'd hear during playback**,
  including whatever mix of Session-clip and Arrangement material was actually sounding, regardless
  of which view is currently active [manual p.123].
- **Render as Loop** — a genuinely clever two-pass mechanism for capturing effect tails cleanly at a
  loop boundary: pass one runs the render *without* writing to disk, just to prime delay/reverb
  state; pass two writes to disk and therefore includes the tail that would otherwise be cut off at
  the loop point [manual p.124].
- **Normalize**, **Convert to Mono**, **Create Analysis File** (writes an `.asd` for the rendered
  output itself) [manual p.124].
- **Sample rate**: exporting at or above the project's working rate is single-pass; exporting
  *below* it renders at project rate first, then downsamples in a separate high-quality pass
  [manual p.124-125].
- **Encoding**: PCM (WAV/AIFF/FLAC) and/or simultaneous CBR-320 MP3; **bit-depth dithering** with
  four modes (Triangular default/"safest," Rectangular, three tiers of Pow-r), plus an explicit
  warning that dithering should be applied **once**, ever, to a given file, and Pow-r modes are
  "never" appropriate before a further mastering stage [manual p.125].
- **Real-Time Rendering**: only triggered when the Set routes through an External Audio Effect/
  External Instrument (real hardware); everything else renders offline as fast as possible. Live
  automatically traces signal flow per track to decide which tracks need real-time rendering and
  which can stay offline, and offers a pre-roll wait ("let hardware go silent") plus auto-restart on
  audio dropouts during the real-time pass [manual p.125-127]. Not relevant to dotbeat — there's no
  external-hardware routing to trace.

---

## Relevance to dotbeat

### Where dotbeat's git-native/content-addressed approach already beats this chapter's mechanisms

This is the most important finding of this pass: **a meaningful fraction of this entire chapter is
Ableton building tooling to compensate for a `.als` file that references media by mutable filename/
path, with no integrity guarantee.** dotbeat's `BeatMediaSample { id, sha256, path }`
(`src/core/document.ts:576-580`) sidesteps several of these problems structurally rather than by
adding a File Manager:

1. **No silent bad-relink.** §7/§8 both note, almost as an aside, that Ableton's Replace/Hot-Swap/
   automatic-search repair mechanisms do **no content verification** — "Live will not care if the
   file you offer is really the file that was missing" [manual p.143]. dotbeat's daemon already
   verifies bytes against the declared hash on every soundfont read and returns a hard `409` on
   mismatch (`src/daemon/daemon.ts:694-696`) — a wrong file can't silently become the "right" one.
   This is a genuine, already-shipped differentiator worth stating plainly in product positioning:
   dotbeat's media references are *integrity-checked*, Ableton's are *trust-on-drop*.
2. **No "external file, will break if the other project moves" failure class.** §6's Tango/Electro
   example (p.140-141) is presented as a real, named footgun of Ableton's model — a Set silently
   depending on another project's folder surviving. dotbeat's parser **structurally forbids this**:
   `src/core/parse.ts:498` rejects any media path that is absolute or contains `..` — every
   `BeatMediaSample.path` must resolve *inside* the project's own folder tree, by construction, not
   by convention or opt-in "collect" tooling. Worth calling out explicitly in `docs/decisions.md` or
   the roadmap as a deliberate, already-made design choice, not an accidental omission of an
   "external file" feature.
3. **Cross-file sample sharing is free, not a manager feature.** §6's p.148 (§5.11.3) treats "if a
   Project holds multiple Sets, only collect one copy of shared samples" as something the File
   Manager has to actively compute and enforce. Because dotbeat's media block is content-addressed
   by sha256 and paths are project-folder-relative, two different `.beat` files in the same project
   folder can reference the identical `media/<hash>.wav` for free today — no dedup pass needed, it's
   just... the same relative path. No dotbeat feature currently exercises this (dotbeat doesn't yet
   have a "save alternate version as a second `.beat` file in the same folder" workflow — see
   below), but the substrate already supports it with zero additional engineering.
4. **"Save as Template" already collapsed a whole Ableton subsystem into a file copy.** §4/product-
   roadmap: Ableton's Template Sets need a dedicated storage location (User Library "Templates"
   folder, auto-created on first save), a naming ritual (`Untitled.als` on load), and browser UI
   [manual p.134-135]. dotbeat's already-shipped "Save project as template"
   (`product-roadmap.md` → Project/folder management → done, `docs/phase-22-stream-af.md`) is,
   by the doc's own honest description, "already just `cp project.beat template.beat` from a shell
   or agent" — the GUI route exists purely for discoverability. Worth citing this chapter as
   confirmation that this collapse is real and not accidental: an entire named Ableton feature
   became a non-feature once the project file is plain text in a plain folder.

### Concrete gaps and recommendations

1. **Build `beat relink` / a media-repair command that exploits content-addressing — something
   Ableton structurally cannot offer.** §8's "automatic search" is filename/heuristic-based and can
   return multiple ambiguous candidates requiring manual choice [manual p.144]. dotbeat already
   computes and stores the sha256 of every referenced file
   (`src/daemon/daemon.ts:1711,1780,1895`, `src/core/edit.ts:915-919`). A `beat relink <file.beat>
   [--search <dir>]` command that walks a directory computing sha256 of candidate files and matches
   them **exactly** against any `BeatMediaSample` entry whose declared path is 404/missing would
   never hit Ableton's "several candidates found, please choose" ambiguity (§8, p.144) for an
   already-known file — a hash match is unambiguous by definition. This is currently a pure gap:
   today a missing/moved media file just surfaces as a 404 from the daemon
   (`src/daemon/daemon.ts:666`) with no repair path at all, GUI or CLI. Directly maps onto the
   existing, unstarted `product-roadmap.md` row "Reference-counted git-lfs asset GC" — recommend
   scoping `beat relink` alongside it, since both walk the same media-block-vs-disk-reality
   comparison.
2. **`beat clip export` / `beat clip import` — dotbeat has no equivalent of a Live Clip (§3).**
   dotbeat's preset system (D9, `docs/decisions.md`) deliberately covers *parameter bundles*
   applied through the same edit path as `beat set` — but Ableton's Live Clip is a different thing
   entirely: an actual authored clip's **note/hit content plus its originating track's full device
   chain**, exported as a standalone, reusable, re-droppable asset across projects [manual p.129].
   dotbeat currently has no analog — a `BeatClip` only exists as `track.clips[]` inside one
   project's document (`src/core/document.ts`), with no export path to a standalone file. Because
   `.beat` is already plain text with stable IDs, this is close to free to build: a `beat clip
   export <file> <track> <clip-id> -o snippet.beat` that serializes the clip's note/hit content plus
   the track's synth/FX-chain fields as a tiny standalone document, and a `beat clip import
   snippet.beat <dest-file> <dest-track>` that re-applies it via the existing edit primitives. This
   is genuinely on-brand for dotbeat (a droppable "clip" is itself diff-friendly text, unlike
   Ableton's binary-ish Live Clip file) and fills a real, named feature gap with no roadmap row
   today — worth adding one under "Preset / content library."
3. **Ableton's session-scoped Undo History (§4) is directly usable prior art for the not-yet-built
   in-session undo/redo row.** `product-roadmap.md`'s "Multi-level in-session undo/redo" (research
   28, not started) already independently arrived at "session-only, separate from git checkpoints"
   — this chapter confirms that's exactly Ableton's own shipped model: **not saved with the
   document, refreshed on open, the opening/creation act itself is the fixed, un-undoable first
   entry** [manual p.130-131]. The one added detail worth folding into research 28's design: Ableton
   exposes this as a **flat, clickable list you can jump to any point in**, not just linear step
   undo/redo [manual p.131] — and dotbeat already has exactly that interaction pattern built and
   proven for the *persistent* layer (the git-backed History panel, `docs/phase-15-history-panel.md`
   — "verified restore append-only," per `product-roadmap.md`). Recommend reusing that same
   flat-list-with-jump-to-point UI component for the new ephemeral in-session stack rather than
   inventing a second interaction model — Ableton's chapter is evidence both the ephemeral and the
   persistent versioning concepts converge on the same "list, not just undo/redo buttons" UX
   independently.
4. **`beat merge --explain` (already an unstarted roadmap row) is dotbeat's answer to "Merging
   Sets" (§5) — and dotbeat can go further.** Ableton's drag-a-Set-onto-a-track / unfold-a-Set-like-
   a-folder mechanism [manual p.131-133] is a real, valuable UX pattern with no dotbeat equivalent
   at either the "merge two whole projects" or "cherry-pick one track/clip from another project"
   grain. The whole-project case is exactly what git merge/cherry-pick already does mechanically;
   `product-roadmap.md`'s existing "Musical-language git-merge conflict narration" row (research 23,
   not started) is the right place to land readable *conflict* output. But the chapter surfaces a
   second, narrower gap this doesn't cover: Ableton's "unfold a Set like a folder, drag out one
   track" (§5, p.132-133) has no dotbeat equivalent even in the no-conflict case — recommend a small
   companion CLI verb, `beat import-track <source.beat> <track-id> --into <dest.beat> [--as
   <new-id>]`, that lifts one track (or, combined with recommendation 2, one clip) from another
   project's text file into the current one. Because both files share the same grammar and D6's
   stable-slug IDs, this is a well-defined text operation dotbeat can make more precise than
   Ableton's drag gesture (no risk of an ambiguous device-chain-or-not drop-target rule, §3) — worth
   scoping alongside `beat merge --explain` rather than as a separate stream.
5. **Stems export (`--stems`) is a real, currently-missing gap, not just an aspirational ROADMAP
   note.** `ROADMAP.md` §5 floats `beat render project.beat -o mix.wav --stems` as a "weeks-not-
   months" future capability, but as of this pass `cli/render.mjs`'s actual arg parser only accepts
   `-o/--out`, `--tail`, `--daemon-port`, `--preview-port` (`cli/render.mjs:31-45`) — there is no
   `--stems` flag, and `product-roadmap.md`'s "Render / export" section lists only the GUI Export
   button as done. Ableton names exactly this capability, "All Individual Tracks," and gives the
   exact reason it matters: **"especially useful... when providing stems to a mixing engineer or
   remix artist"** [manual p.124, restated for the render dialog at p.123]. Since dotbeat's offline
   engine already renders the full graph per track internally, per-track solo-rendering (mute every
   other track, render, repeat) is a small addition on top of the existing render path, and it also
   directly serves the metrics/lint loop (`docs/decisions.md` D2) — per-stem LUFS/spectral metrics
   are a strictly richer signal than mix-bus-only. Recommend adding to the "Render / export"
   roadmap section as a scoped, unstarted row.
6. **`--tail` already exists — dotbeat has partial parity with "Render as Loop" (§11), worth
   noting, not a gap.** `cli/render.mjs:36` already accepts a `--tail <sec>` flag. This isn't
   Ableton's specific two-pass "prime state silently, then record" mechanism [manual p.124], but it
   solves the same underlying problem (reverb/delay tails getting cut at a render boundary) with a
   simpler brute-force approach (render extra time past the nominal end). Worth a one-line note in
   `product-roadmap.md`'s render section that this exists, since the table currently only lists the
   GUI Export button and doesn't mention the CLI render path's own options at all.
7. **No dither/normalize options on `beat render`.** Minor relative to 5-6, but real: Ableton's
   explicit, documented dithering guidance (apply once, never before further mastering, Pow-r modes
   are final-output-only [manual p.125]) is exactly the kind of "protect the user from a mistake
   that's invisible until it's baked in" design dotbeat's own mix-lint philosophy (D2) already
   values. If/when `beat render` grows a bit-depth option, port this guidance rather than silently
   picking a default.
8. **`beat pack` — likely doesn't need a bespoke format.** §10's Pack (`.alp`, compressed
   project-folder archive for handoff/backup, p.148) has no dotbeat equivalent, but git already
   solves the identical problem: `git bundle create` produces a single-file, portable, compressed
   snapshot of a repo's history, and with LFS objects already tracked (D11) a `git lfs
   fetch`-then-bundle (or simply `git archive` for a no-history snapshot) covers the same ground.
   Recommend, if this is ever prioritized, a thin `beat pack`/`beat unpack` wrapper for
   discoverability rather than inventing a new archive format — the underlying mechanism should stay
   "this is just git," consistent with D10's reasoning for pins-as-tags (`docs/decisions.md`).
9. **MIDI-import-bakes-in-immediately (§2) independently validates D1**, dotbeat's "document-only,
   no generator layer" decision (`docs/decisions.md` D1) — worth citing as corroboration next time
   D1 needs defending, not a new action item: even Ableton, a fully-featured commercial DAW with a
   generic file-import subsystem, treats an imported MIDI file as literal baked-in data with the
   source reference explicitly discarded [manual p.127-128], the same instinct D1 already commits
   `.beat` to.
10. **Decoding Cache (§1) is not relevant scope for dotbeat today, correctly.** dotbeat's sample
    pipeline is WAV-only in practice — every duration/registration path uses `decodeWav` directly
    (`src/daemon/daemon.ts:100,1785`, `cli/beat.mjs:1035,1060`), with no compressed-format decode
    step anywhere. No action needed; noting only so a future stream considering MP3/FLAC sample
    import knows Ableton's own precedent (a bounded, auto-pruned transcode cache with a manual
    cleanup button) exists if that scope ever opens up.

## Sources

Ableton Live 12 Reference Manual, chapter 5 "Managing Files and Sets," pp. 120-149 (local copy in
`prior_art/`, not tracked in git). Page numbers derived from the chapter's stated start page (120)
plus position relative to the page-footer markers in the `pdftotext -layout` extract at
`ableton-chapters/ch05.txt`. dotbeat internal sources read directly this pass: `src/core/document.ts`
(`BeatMediaSample`, lines 572-580), `src/core/parse.ts` (path-traversal rejection, line 498),
`src/core/edit.ts` (`setMediaSample`, lines 914-919), `src/daemon/daemon.ts` (media serving/
sha256-verification routes, lines 649-696, media registration, lines 1711/1780/1895),
`cli/render.mjs` (arg parser, lines 31-45), `cli/beat.mjs` (render/metrics commands),
`docs/format-spec.md` (v0.5 media block, lines 291-329), `docs/decisions.md` (D1, D9, D10, D11),
`docs/product-roadmap.md` (File format & core engine, Render/export, Versioning/history, Project/
folder management, Preset/content library sections), `docs/research/23-opendaw-collaboration-storage.md`.
