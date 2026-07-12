# Research 52 — Ableton Live 12 vs. dotbeat: Files & Sets, a direct feature/UI comparison

*2026-07-12. Builds directly on `docs/research/33-ableton-files-and-sets.md` (the text-only primer on
manual chapter 5, pp.120-149). This pass adds: (1) direct viewing of ~16 rendered chapter screenshots
(`prior_art/` chapter images, not tracked in git) to ground UI claims in what the File Manager actually
looks like, not just its prose description, and (2) a structured, decision-ready comparison table
against dotbeat's actual shipped surface, cross-checked against `ROADMAP.md`, `docs/decisions.md`, and
`docs/product-roadmap.md` so nothing proposed here contradicts an already-made call or duplicates
already-shipped work. Research-only — no code changed.*

## How to read this doc

- **[manual p.NNN]** — a claim read from the chapter text and/or its screenshots (both viewed directly
  this pass: `ableton-chapters/ch05.txt` and 16 pages of `ableton-images/ch05/*.jpg`).
- **dotbeat citations** — `file:line`, read directly from this repo this pass.

---

## 1. Feature & UI/UX comparison

### a) Shared features / parity

| # | Feature | Ableton | dotbeat |
|---|---|---|---|
| 1 | Media referenced by path, not embedded | Audio clips store a pointer to the sample on disk, not the audio bytes [manual p.120, p.129 — "Audio Live Clips store only a reference to the sample, not the audio data itself"] | `BeatMediaSample { id, sha256, path }` — the document stores a path, never inlines audio bytes (`src/core/document.ts:576-580`) |
| 2 | New / Open / Save a project | File → New/Open/Save Live Set [manual p.130, screenshot p.130] | `beat init`, daemon file load, plain write-back (`cli/beat.mjs:1243`, daemon `/new-project` route, `src/daemon/daemon.ts:1247-1290`) |
| 3 | Branch a project without mutating the original ("Save As" / "Save a Copy") | Two distinct commands: Save Live Set As (rename/relocate) and Save a Copy [manual p.130] | `POST /save-as-template` copies the current on-disk bytes to a new path, never mutating the original (`src/daemon/daemon.ts:1307-1320`); because `.beat` is plain text, any `cp project.beat v2.beat` is already a valid "Save a Copy" too |
| 4 | New project from a template | Templates category, "Set Default Live Set" [manual p.134-135, screenshot p.135] | `POST /new-project` accepts `from: <template.beat>`, validated by parsing it before copy (`src/daemon/daemon.ts:1258-1274`); GUI "New project…" and "Save as Template" actions ship (`product-roadmap.md` → Project/folder management, both ✅ Done) |
| 5 | A project folder owns a document's own files | Live Project = the folder auto-created around a Set the first time it's saved outside an existing project [manual p.137, screenshot p.138] | A dotbeat project folder (`.beat` + `media/`) plays the identical organizing role; enforced structurally, not by convention (see 1c #2) |
| 6 | Preset/device-chain reuse across projects | Device presets, drag-and-drop reuse [manual p.141] | `beat preset` applies a named param bundle through the same edit path as `beat set` (D9, `docs/decisions.md`) — different mechanism (literal edit list vs. binary preset file) but the same reuse goal |
| 7 | External-tool round-trip on the project's own file | "Edit" button opens a *sample* in a configured external app; Warp Markers survive if length is unchanged [manual p.136, screenshot p.136] | Broader: the daemon watches the *whole project folder* and hot-reloads the GUI on any external edit to the `.beat` file itself, from any tool — vim, an agent, `sed` (`src/daemon/daemon.ts:567-576`) — see 1c #10 for why this is actually a divergence, not pure parity |

### b) In Ableton, not in dotbeat

1. **Decoding Cache** — a bounded, auto-pruned transcode cache for compressed sample formats (MP3/AAC/Ogg/FLAC), with a manual Cleanup button [manual p.120-121, screenshot p.121].
2. **Analysis files (`.asd`)** — a per-sample sidecar caching waveform/stretch-quality/tempo-detection data, and optionally a "default clip settings" snapshot (warp/gain/pitch) saved explicitly via Clip View's Save button [manual p.121, screenshot p.121].
3. **MIDI file interop (`.mid` import/export)** — importing a `.mid` bakes its data into a MIDI clip and severs the file reference entirely; exporting a clip as Standard MIDI is a separate, explicit action [manual p.127-128]. Confirmed dotbeat has **no MIDI file import or export pipeline at all** (no `.mid`/`smf` handling anywhere in `src/core`, `cli/`, or `src/daemon`) — `.beat` is a native format with no path in or out to the universal MIDI interchange format.
4. **Live Clips** — an audio/MIDI clip exported to its own standalone, reusable, cross-project file, optionally also carrying the originating track's *entire device chain* if dropped onto empty space [manual p.129-130, screenshot p.129].
5. **Session-scoped, multi-level Undo History** — a full, flat, clickable list of every action since the Set was opened (not saved with the document, refreshed on open, jump to any point, not just linear step undo/redo) [manual p.130-131, screenshot p.130].
6. **Merging Sets** — drag a whole Set from the browser onto a track/empty space to reconstruct all its tracks/clips/devices/automation; unfold a Set in the browser exactly like a folder and drag out one track, one clip, one device chain, or a Group Track without opening it [manual p.131-134, screenshots p.133].
7. **File Reference List UI** ("View Files") — one row per file the project references, expandable to every clip/slot using it, with per-row **Replace** (drag a new file onto the entry), **Hot-swap** (quick-browse alternatives), **Edit** (open in external app), and a **Location** column (User Library / Project / External / Missing) [manual p.135-137, screenshots p.135-136].
8. **Locating Missing Files** — a Status Bar warning the moment any referenced file is absent, offline clips play silence in place, and a tiered repair flow: manual drag-to-fix, or automatic search across a chosen folder/the Project/the Library with three explicit outcomes (no candidate / exactly one, auto-accepted / several, user picks via Hot-Swap) [manual p.142-144, screenshots p.144].
9. **Collecting External Files (opt-in aggregate sweep)** — a dedicated step that copies files from other locations into the current project folder, broken down per source category with file-count/disk-space readouts and per-category toggles, plus `File → Collect All and Save` and a `Collect Files on Export` global preference [manual p.145-146, screenshot p.145].
10. **Finding Unused Files** — scans every file physically in a project folder and flags anything not referenced by *this* project's own Sets/Clips/presets, browsable/previewable/deletable [manual p.147, screenshot p.147].
11. **Packing a Project into a Pack (`.alp`)** — a lossless-compressed, non-destructive archive of a whole project folder for handoff/backup (manual claims up to ~50% size reduction) [manual p.148, screenshot p.148].
12. **Rich Export Audio/Video rendering matrix** — Main / All Individual Tracks (stems) / Selected Tracks Only / single-track chooser, Include Return and Master Effects toggle, two-pass Render as Loop (silently primes reverb/delay tails), Normalize, Convert to Mono, Create Analysis File, sample-rate downsampling as a distinct high-quality pass, and four-mode dithering with explicit "apply once, never before mastering" guidance [manual p.122-127, screenshots p.123-124]. Confirmed: `cli/render.mjs`'s actual arg parser accepts only `-o/--out`, `--tail`, `--daemon-port`, `--preview-port` (`cli/render.mjs:31-45`) — no stems, no normalize, no mono, no dither.
13. **Aggregated locating/collecting scope** — the same locate/collect tooling scales from "this Set" up to the whole User Library, the whole current Project, any right-clicked Project, or any multi-selection in the browser [manual p.147].
14. **Project-scoped preset storage** — by default, new instrument/effect presets save *into the current Project*, draggable out to the User Library afterward [manual p.141, "By default, new instrument and effect presets are stored in your current Project"].
15. **"Set Default Live Set"** — designate any template Set as what `File → New` opens with [manual p.135, screenshot p.135].

### c) In dotbeat, not in Ableton

dotbeat's git-native, content-addressed model doesn't just lack some of Ableton's file-management
tooling — a meaningful share of *that same tooling exists in Ableton specifically to compensate for*
properties `.beat`'s format gets for free. Naming these explicitly, not just as "our format is nicer":

1. **Integrity-checked media, not trust-on-drop.** Ableton's own manual admits, almost in passing, that
   Replace/Hot-Swap/automatic-search repair do **no verification that a replacement file is actually
   related to the one it's replacing** — "Live will not care if the file you offer is really the file
   that was missing" [manual p.143]. dotbeat's daemon verifies bytes against the declared `sha256` on
   every media read and returns a hard `409` on mismatch (`src/daemon/daemon.ts:694-696`) — a wrong
   file can never silently become the "right" one.
2. **No cross-project "will break if the other project moves" failure class.** The chapter's own
   worked example (Tango Project → "Electro with Piano.als" saved outside it, still pointing back at
   Tango's sample) is presented as a real, named footgun: **"There is nothing wrong with this except
   for when the Tango Project is moved away or deleted; then 'Electro with Piano.als' will be missing
   samples"** [manual p.140-141, screenshot p.141]. dotbeat's parser structurally forbids this class of
   reference: any media path that is absolute or contains `..` is rejected at parse time
   (`src/core/parse.ts:498`) — every `BeatMediaSample.path` must resolve inside the project's own
   folder tree, by construction, not by opt-in "collect" tooling after the fact.
3. **Cross-file sample sharing is free, not a computed feature.** Ableton's own FAQ (§5.11.3, manual
   p.148) treats "a Project with multiple Sets only collects one copy of shared samples" as something
   the File Manager has to actively enforce. Because dotbeat's media block is content-addressed by
   `sha256` and paths are project-relative, two `.beat` files in the same folder referencing
   `media/<hash>.wav` share it automatically — no dedup pass, just identical relative paths.
4. **The project file itself is the diff/version-control surface — no bolt-on tooling required.**
   `.als` is not confirmed to be cleanly human-readable even decompressed and needs external hooks
   (`alsdiff`, `maxdiff`/`textconv`, Automator scripts) to be git-diffable at all (`ROADMAP.md` §1's
   landscape table). `.beat` is stable-ID, canonically-ordered text by design (D4, D7) — `git diff`
   on a project file is a first-class, zero-tooling operation, and a single edit produces a single
   readable line-diff (D8's `DiffEntry`).
5. **Persistent, cross-session version history — not just a session-scoped Undo History.** Ableton's
   own Undo History is explicit that it is **not saved with the document and resets on every open**
   [manual p.130-131]. dotbeat's checkpoint/history/pin/restore is git-backed, persists indefinitely,
   survives closing and reopening the app, and supports named, permanent pins as real git tags (D10) —
   an entire versioning tier Ableton's chapter has no equivalent of.
6. **File-management operations are CLI- and agent-drivable, not GUI-only.** Every operation this
   manual chapter documents (View Files, Replace, Locate Missing, Collect, Pack) is exclusively a
   File Manager dialog with no scripting surface described anywhere in the chapter. dotbeat's
   equivalent surface (`beat init`, `beat sample`, `beat lane`, `POST /new-project`,
   `POST /save-as-template`, and the whole MCP tool set in `src/mcp/server.ts`) is CLI- and
   agent-drivable by construction — an agent can create, branch, or re-point a project without a
   mouse.
7. **Presets are literal, diffable edits, never an opaque in-project reference.** Ableton's device
   presets are files that live inside (or are dragged out of) a Project folder and are *referenced*
   by the Set [manual p.141]. dotbeat's presets are tooling external to the format entirely — applying
   one (`beat preset`) writes a normal, readable edit list through the same path as `beat set` (D9) —
   a `.beat` file never depends on a preset library's contents or version to render correctly.
8. **Provenance sidecars, not just DSP analysis sidecars.** Ableton's `.asd` stores waveform/stretch/
   tempo data and optional default clip settings — nothing about licensing or sourcing [manual p.121].
   dotbeat's media provenance sidecar (`<path>.json`, `src/core/document.ts:501` convention notes)
   carries source, license, and credit lines per sample, deliberately kept outside the music file.
9. **The external-edit loop is format-wide, not sample-only.** Ableton's "Edit" round-trip is scoped
   to one sample in one configured external editor [manual p.136]. dotbeat's directory watcher
   hot-reloads the GUI from *any* external change to the project's `.beat` text — an agent, a shell
   script, or a second editor window all count (`src/daemon/daemon.ts:567-576`) — this is a strictly
   larger surface than Ableton's bespoke escape hatch.
10. **A whole distributed-collaboration substrate "for free."** git branches/merges, `git-lfs` for
    binary media (D11), and tag-based named pins (D10) give dotbeat multi-machine sync, history
    sharing, and conflict resolution machinery Ableton's chapter has no answer to beyond manual
    Save-As copies and Packs — Ableton Packs are a one-way archival snapshot [manual p.148], not a
    collaboration mechanism.
11. **"Save as Template" collapsed a whole Ableton subsystem into a file copy.** Ableton's Template
    Sets need a dedicated User Library location (auto-created on first save), a naming ritual
    (loads as `Untitled.als`), and dedicated browser UI [manual p.134-135]. dotbeat's shipped
    equivalent is, by `product-roadmap.md`'s own description, "already just `cp project.beat
    template.beat` from a shell or agent" — the GUI route exists for discoverability, not because
    the underlying operation needed new machinery.

---

## 2. Prioritized recommendations

Covers every item in **1(b)**. Priority is decisive: **P0** = clear, scoped, ship-next; **P1** =
real gap, sequence after P0; **P2** = real but low-urgency or niche; **Do-not-recreate** = the
Ableton mechanism exists to solve a problem dotbeat's architecture doesn't have, or would directly
conflict with an already-made decision.

| Feature | Priority | Build recommendation |
|---|---|---|
| Decoding Cache | **Do-not-recreate** | dotbeat's sample pipeline is WAV-only today — every duration/registration path calls `decodeWav` directly (`src/daemon/daemon.ts:100`, `cli/beat.mjs`), no compressed-format decode step exists anywhere. No action. If MP3/FLAC import is ever scoped, mirror Ableton's bounded/auto-pruned cache pattern in the daemon's media layer at that point — not before. |
| Analysis files (`.asd`) | **P2** | Split the two halves Ableton itself treats as distinct [manual p.121]. The "default clip settings" half is unnecessary — D9's frozen-default elision already gives every clip type one canonical starting state without a sidecar. The "derived DSP data" half (waveform peaks, detected tempo) has real value for GUI responsiveness: cache it keyed by `sha256` (stronger than Ableton's filename-keyed `.asd` — survives a rename) as `media/<hash>.analysis.json`, computed once on first daemon read, consumed by the GUI's waveform renderer. |
| MIDI file interop (`.mid` import/export) | **P1** | No pipeline exists today. Build `beat import-midi <file.mid> <dest.beat> <track>` (parse SMF, bake into literal `note` lines per D1's document-only philosophy — matches Ableton's own precedent of severing the source reference on import [manual p.127-128], independently validating D1) and `beat export-midi <file.beat> <track> <clip-id> -o out.mid` as the inverse, one-way conversion Ableton itself treats as distinct from saving a clip [manual p.128]. |
| Live Clips (exportable clip + device chain) | **P1** | `beat clip export <file> <track> <clip-id> -o snippet.beat` serializing the clip's note/hit content plus the track's synth/FX-chain fields as a standalone document, and `beat clip import snippet.beat <dest.beat> <dest-track>` re-applying it via existing edit primitives. Near-free given `.beat` is already text with stable IDs (D6) — genuinely on-brand: a droppable "clip" stays diff-friendly text, unlike Ableton's binary-ish `.alc`. No roadmap row exists for this yet — add one under "Preset / content library." |
| Session-scoped multi-level Undo History | **P0** | Already fully scoped and blocking: `product-roadmap.md`'s "Multi-level in-session undo/redo" row is explicit that Ctrl+Z currently does nothing (research 28, not started). Implement research 28's design (session-only full-document-snapshot stack in the daemon, coalesced by user gesture) and reuse the *persistent* History panel's flat-list-with-jump-to-point UI component for the new ephemeral stack rather than inventing a second interaction model — this pass's own screenshot of Ableton's Undo History (p.130) confirms Ableton independently converged on the identical "list, not just buttons" UX for the same problem. |
| Merging Sets / unfold-and-cherry-pick | **P1** | Two tiers, sequence together. Whole-project: `beat merge --explain` (research 23, not started) narrating a git merge conflict in D8's musical phrasing. Narrower, currently uncovered even by that row: `beat import-track <source.beat> <track-id> --into <dest.beat> [--as <new-id>]` to lift one track (or, paired with the Live-Clips row above, one clip) from another project's text file — a well-defined text operation given both files share one grammar and D6's stable slugs, more precise than Ableton's drag-target ambiguity [manual p.132-133]. |
| File Reference List UI ("View Files") | **P1** | `beat media list <file.beat>` (CLI) enumerating id / path / sha256 / on-disk status / referencing tracks-clips-lanes, backed by a new `GET /media-refs` daemon route, plus a "Media" panel in `ContentBrowser.tsx` surfacing the same with a per-row Replace action. Natural pairing with the relink row below — both walk media-block-vs-disk-reality. |
| Locating Missing Files / repair | **P0** | Today a missing/moved media file is a silent 404 with zero repair path anywhere (`src/daemon/daemon.ts:666`, `690`) — a real, user-facing regression versus Ableton's UX even though dotbeat's underlying integrity guarantee (1c #1) is stronger. Build `beat relink <file.beat> [--search <dir>]`: walk candidate files, compute `sha256`, and match **exactly** against any `BeatMediaSample` whose declared path 404s — this can never hit Ableton's "several candidates, please choose" ambiguity [manual p.144] for an already-known file, since a hash match is unambiguous by definition. Surface a "N media files missing" banner in the GUI wired to the same route. Directly extends the existing, unstarted "Reference-counted git-lfs asset GC" roadmap row — scope together. |
| Collecting External Files (opt-in aggregate sweep) | **P2** | Mostly **do-not-recreate**: `parse.ts:498` already forecloses the structural gap (external references) Ableton's Collect exists to patch, and content-browser drops already auto-collect into `media/` at drop time (`src/daemon/daemon.ts:1711`, `1780-1782`, `1895`), not as a later opt-in step. The one narrow remaining case — a hand-edited `.beat` referencing a file not yet copied into `media/` — is a small addition: a `beat sample --collect <path>` variant of the existing `beat sample` command reusing the same `sha256`-compute-and-register plumbing. |
| Finding Unused Files / GC | **P0** | Directly maps onto the existing, unstarted `product-roadmap.md` row "Reference-counted git-lfs asset GC" (research 23) — this pass just confirms Ableton names the identical feature (§5.9) and documents its own honest scoping caveat worth carrying over: a per-project scan flags a file as unused even if another project on disk still needs it [manual p.147]. Build `beat gc <file.beat>` diffing `media/` against the document's own media block; state the same per-project-scope caveat in the CLI's own help text rather than silently over-promising. |
| Packing a Project into a Pack (`.alp`) | **P2** | git already solves this: a thin `beat pack`/`beat unpack` wrapper around `git bundle create` (full history) or `git archive` (snapshot-only) plus a `git lfs fetch` for LFS-tracked binaries (D11) — no bespoke archive format, consistent with D10's "this is just git" precedent for pins. |
| Rich Export Audio/Video rendering matrix | **P0** for stems; **P2** for normalize/mono/dither | `--stems` first: `ROADMAP.md` §5 already floats `beat render project.beat -o mix.wav --stems` as a near-term capability, but it doesn't exist (`cli/render.mjs:31-45`). Add a per-track solo-render loop (mute every other track, render, repeat) over the existing render path — small, and it directly feeds the D2 metrics/lint loop with per-stem signal, not just mix-bus. Normalize / Convert to Mono / dithering are smaller, independent follow-ons once stems land; if/when bit-depth options are added, port Ableton's own explicit guidance verbatim (apply dithering once, never before further mastering, Pow-r modes final-output-only [manual p.125]) into the CLI help text rather than silently picking a default. |
| Aggregated locating/collecting scope | **P2** | Bundle into the `beat relink`/`beat gc` rows above once built: extend both to accept a directory of `.beat` files (not just one) for a machine-wide sweep, mirroring Ableton's "whole User Library / any Project" scope escalation [manual p.147] — no separate feature, just a `--all` flag on the two commands above. |
| Project-scoped preset storage | **Do-not-recreate** | Directly conflicts with D9's explicit, deliberate decision: presets are tooling (global files applied through the ordinary edit path), never in-project storage or reference — a per-project preset folder would reopen exactly the "does this document's sound depend on a library version" ambiguity D9 was written to close. No action; note as a considered-and-rejected alternative in `docs/decisions.md` only if this resurfaces. |
| "Set Default Live Set" | **P2** | Bundle with the Templates-discoverability gap noted in 1(c) #11's counterpoint: a small `defaultTemplate` field in a local (gitignored) CLI/daemon config, read by `beat init` / `POST /new-project` when no `--from`/`from` is supplied. Low value relative to everything above — sequence last. |

---

## Sources

Ableton Live 12 Reference Manual, chapter 5 "Managing Files and Sets," pp. 120-149 (local copy in
`prior_art/`, not tracked in git); this pass additionally viewed 16 rendered page images
(`ableton-images/ch05/p-{120,121,123,124,129,130,133,135,136,138,141,142,144,145,147,148}.jpg`).
dotbeat internal sources read directly this pass: `src/core/document.ts` (`BeatMediaSample`,
lines 576-580, provenance-sidecar convention note at line 501), `src/core/parse.ts` (path-traversal
rejection, line 498), `src/daemon/daemon.ts` (media serving/sha256-verification, lines 653-696;
`/new-project`, lines 1247-1290; `/save-as-template`, lines 1307-1320; media registration on
content-browser drop, lines 1711/1780-1782/1895; directory watcher, lines 567-576; missing-media
404s, lines 666/690), `cli/render.mjs` (arg parser, lines 31-45), `cli/beat.mjs` (`clipCmd`,
lines 866-873 — confirms `beat clip` is an in-project snapshot, not a Live-Clip-style export),
`src/mcp/server.ts` (full `beat_*` tool inventory, confirms no merge/relink/clip-export/pack tools
exist today), `docs/format-spec.md` (v0.5 media block, lines 291-317), `docs/decisions.md` (D1, D4,
D6, D7, D8, D9, D10, D11), `docs/product-roadmap.md` (File format & core engine, Render/export,
Versioning/history, Project/folder management, Preset/content library, Undo/redo sections),
`ROADMAP.md` §1 (landscape table), and this pass's predecessor,
`docs/research/33-ableton-files-and-sets.md`.
