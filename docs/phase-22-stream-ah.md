# Phase 22 Stream AH — the content browser sidebar

*Per `docs/phase-22-plan.md`'s Stream AH and `docs/research/18-ableton-ui-architecture.md` §8
("Browser/sidebar"). Built against a live `main` — this worktree's own branch history turned out to
be an orphaned line rooted at a different, unrelated commit (same class of issue Phase 18 Stream S
documented for its own worktree), carrying zero unique commits versus `main`'s tip; it was reset to
`main` (`76e7806`, "Phase 22 plan") before any work began so this stream sits on the real, current
project history rather than a stale fork missing 169 commits of GUI/layout/roadmap work.*

## What was already there — read before building

- **The taxonomy** (`docs/phase-18-content-taxonomy.md`): `presets/factory.json`'s 36 presets each
  carry a `category` field (`SYNTH_PRESET_CATEGORIES`/`DRUM_PRESET_CATEGORIES`/`PRESET_CATEGORIES`
  in `src/core/preset.ts`), validated and filterable (`filterPresetsByCategory`) — the data layer
  this stream's sidebar consumes, deliberately deferred there ("needs a place to dock into that
  doesn't exist yet") until the Phase 18 layout landed.
- **Preset application** (`src/core/preset.ts`'s `applyPreset`): already the real mechanism, and
  already the one this stream reuses verbatim — a preset is "tooling, not grammar"
  (`docs/format-spec.md`): no reference, no include, applying one just runs `setValue` in a loop and
  produces a normal edit list.
- **Kits and SoundFonts had NO shared parser or listing surface at all.** `presets/kit-init/` and
  `presets/kit-audiophob/` are five `<lane>.wav` files each (kick/snare/clap/hat/openhat, matching
  `DRUM_LANES`) with `<file>.json` provenance sidecars; `presets/sf2/*.sf2` similarly. Phase 18
  Stream S explicitly flagged this as out of its file-ownership boundary ("real follow-up work").
  Registering a sample into a *project* (`beat sample`) and assigning it to a lane (`beat lane`)
  already existed as CLI primitives (`src/core/edit.ts`'s `setMediaSample`/`setLaneSample`), but
  nothing browsed `presets/` and fed them.
- **The GUI had no sample-registration surface at all** — `ArrangementView.tsx`'s `addTrackOfKind`
  says so directly in its own comment: an instrument track can only reuse an *already-registered*
  media sample, "register one with `beat sample` first." This stream's soundfont install route
  closes that gap for the bundled banks.
- **Layout**: `docs/phase-18-layout.md` — one permanent Arrangement main area + a selection-following
  bottom pane (Clip/Device), no tab switcher, overlays for Mixer/History. No sidebar existed.

## What was built

### Daemon — five new routes (`src/daemon/daemon.ts`, additive only)

All under a `presetsRoot` resolved from the daemon's own compiled location (`dist/src/daemon/
daemon.js` → three levels up → the repo's real `presets/`, not the `dist/presets/` copy the build
script makes for `factory.json` alone — kit/sf2 directories are read straight from source):

- `GET /library` — the whole catalog: presets (optional `?category=` filter, reusing
  `filterPresetsByCategory`), the enumerated category list, kit lane manifests (`presets/kit-*`
  scanned for the five recognized `<lane>.wav` names), soundfont banks (`presets/sf2/*.sf2`, license/
  source read best-effort from provenance sidecars).
- `GET /library/file?path=<rel>` — raw bytes of one library file, traversal-safe (mirrors
  `GET /media/<path>`'s declared-paths discipline) — for preview: fetch, decode, play, never write.
- `POST /library/apply-preset {track, name}` — wraps `applyPreset` verbatim. Rejects a kind
  mismatch (400), returns the fresh document (the daemon never SSE-echoes its own writes, same
  convention `/add-track`/`/remove-track` already established).
- `POST /library/install-kit {track, kit, lane?, targetLane?}` — copies the kit's wav(s) into the
  **project's own** `media/` directory (never referenced by their `presets/` path — the file must
  still stand alone), computes sha256 fresh from the copied bytes (same discipline `beat sample`
  uses, not trusted from the sidecar), registers via `setMediaSample`, assigns via `setLaneSample`.
  `lane` omitted installs every lane the kit has (drop a whole kit on a track); `lane` + `targetLane`
  installs one one-shot onto a *different* lane than its own (e.g. a clap sample onto the snare row).
- `POST /library/install-soundfont {file, track?, program?, newTrackId?}` — same copy+register,
  then either reassigns an **existing** instrument track's bank (the already-existing
  `<track>.soundfont`/`<track>.program` `setValue` paths) or, with `track` omitted, mints a **brand
  new** instrument track carrying it via core's `addTrack` — the sample-registration surface
  `addTrackOfKind`'s own comment says doesn't exist.

### Engine — four new preview methods (`ui/src/audio/engine.ts`, additive only)

Preview-before-load reuses the *DSP*, not a second audio pipeline:

- `previewSynthPreset(params)` — builds a throwaway chain via the same private
  `buildSynthChain()`/`applyParams()`/`disposeChain()` every live synth track's chain uses; `coerce()`
  already treats every `BeatSynth` field as optional with sane defaults, so a preset's partial param
  bag previews correctly with no merging step.
- `previewDrumPreset(params)` — a separate, throwaway set of the same Tone.js voice types
  `buildDrums()` uses (MembraneSynth kick, NoiseSynth snare, MetalSynth hat), deliberately NOT the
  live drums track's singleton `DrumKit` (that one is synced off the real document every tick and
  shared app-wide; previewing an unapplied preset must not perturb it). Plays a short kick/hat/
  snare/hat phrase.
- `previewBuffer(bytes)` — decode + play one kit one-shot, straight through the shared master bus
  (`Tone.connect`, the same bridging `buildInstrument()` uses for its native WorkletSynthesizer
  output) so it shows up on the master meter/scope and respects master volume, with no per-track
  mute/pan wiring (there's no track yet).
- `previewSoundfont(bytes, program)` — a throwaway `WorkletSynthesizer` (the same synthesis path
  `buildInstrument()` uses for a live instrument voice, minus the mute/vol/pan bus a real track
  needs), one note on the requested program, torn down after its tail.

All four are fire-and-forget: nothing reads or writes `useStore`'s document. Verified live (below):
the `.beat` file is byte-identical before and after every preview.

### Client (`ui/src/daemon/library.ts`, new) and UI (`ui/src/components/ContentBrowser.tsx`, new)

`library.ts` owns the daemon calls (`fetchLibrary`/`fetchLibraryFile`/`applyPresetToTrack`/
`installKitLane`/`installSoundfont` — the install helpers apply the daemon's returned document
straight to the store, the same "the write route returns the fresh doc" convention `postAddTrack`
already uses) and the drag-payload protocol (`LIBRARY_DND_MIME`, `DragPayload`, `setDragPayload`/
`readDragPayload`) shared between the drag source and the two drop targets, so the wire format has
exactly one definition instead of being duplicated across three components.

`ContentBrowser.tsx` is a self-contained, new component: collapsible sections (Presets — Synth,
grouped by the seven `SYNTH_PRESET_CATEGORIES`; Presets — Drums, grouped by the six
`DRUM_PRESET_CATEGORIES`; Kits; SoundFonts), each row draggable with its own ▶ preview button, plus
a "+" on each soundfont row to mint a new instrument track directly (no drag needed for that case,
since there's no existing instrument-track header to drop onto).

### GUI layout diff — additive only, per the plan's "small, additive" instruction

- `ui/src/App.tsx`: one new import, a `libraryOpen` read + a `Browser` topbar toggle button (next to
  Mixer/History, same pattern), and a new `.app-body` flex-row wrapper around the *existing*
  `.workspace` div (unchanged internals) plus the conditionally-rendered rail. `ArrangementView`/
  `BottomPane` were not touched by this wrapping.
- `ui/src/state/store.ts`: one new boolean (`libraryOpen`) + one toggle action — the same shape every
  other Phase 18 overlay/drawer flag already uses (`historyOpen`/`mixerOpen`).
- `ui/src/components/ArrangementView.tsx`: the track header (`TrackRow`) gained `onDragOver`/
  `onDragLeave`/`onDrop` + one `dropHover` state var and a ~25-line `handleLibraryDrop` callback —
  additive to the existing header, not a restructure. Handles preset-onto-track, kit-onto-drum-track
  (every lane), and soundfont-onto-instrument-track.
- `ui/src/components/StepSequencer.tsx`: the inline per-lane row JSX was extracted into a `LaneRow`
  sub-component (needed real per-row hook state for drop-hover) with the same drag handlers, so a
  single kit one-shot can land on a *specific* lane, independent of the track-header drop.
- `ui/src/styles.css`: one new layout block (`.app-body`, `.workspace` gained `min-width: 0`) plus a
  self-contained `.library-rail`/`.lib-*` block and a generic `.drop-target-hover` class reused by
  both drop targets.

No changes to `src/core/document.ts`, `src/core/edit.ts`'s existing functions, `presets/factory.json`,
or any other stream's likely file (`ui/src/audio/engine.ts`'s existing methods, `ArrangementView.tsx`'s
existing rendering/selection/automation logic, `StepSequencer.tsx`'s toggle-grid logic) — this really
was the most file-isolated of the eight streams, as the plan predicted.

## Verification

**`npm test`: 310/310/0/0** (298 pre-existing + 12 new in `test/content-library.test.ts`, which
exercises all five daemon routes against the REAL `presets/` tree — factory.json's actual 36 presets,
the real kit-init/kit-audiophob directories, the real sf2 banks — not a synthetic fixture, so a
renamed/stale preset would fail this suite the same way it'd break the CLI). `cd ui && npx tsc
--noEmit`: clean. `cd ui && npx vite build`: succeeds.

**Live verify** (`node ui/verify-phase22-content-browser.mjs`) drives the real frontend against a
real `beat daemon` on a real multi-track project (`examples/night-shift.beat`), using Playwright's
real `page.dragAndDrop()` (genuine `dragstart`→`dragover`→`drop` event sequence through Chromium,
not a hand-constructed `DragEvent`) — every check below is against the actual `.beat` file on disk
and/or the real master audio meter, not just in-memory store state:

- **W1**: opening the Browser rail loads the real catalog — 36 preset rows, 10 kit one-shot rows
  (2 kits × 5 lanes), 3 soundfont rows.
- **W2**: dragging `deep-sub-bass` onto the `bass` (synth) track header — file diff confirmed
  non-empty, contains no `preset` keyword anywhere (literal params only, per `format-spec.md`), and
  a literal `subLevel 0.6` line lands; `bass.synth.osc2Type === 'square'`, `glide === 0.02` (the
  preset's own values, not guessed).
- **W3**: dragging `techno-kit` onto the `drums` track header — `night-shift.beat`'s drums track
  turned out to already carry `driving-kit`'s exact params (it was built FROM that preset), so that
  was the wrong choice for a "did anything change" check; `techno-kit` (`hatTone` 6500 → 9000) gives
  a real, observable diff. Left as a note for future streams: a same-value preset drop is legitimately
  a no-op file diff, not a bug — don't assume "diff changed" is the right assertion for every preset.
- **W4**: dragging `kit-init`'s kick one-shot onto the drum track's kick lane row (in `StepSequencer`,
  not the track header) — the wav lands on disk at the project's own `media/kit-init-kick.wav`
  (confirmed via `existsSync`), the media entry's path does not contain `presets/`, and the lane is
  assigned (`laneSamples.kick.sample === 'kit-init-kick'`).
- **W5**: clicking ▶ on `acid-bass` (a preset) and on `kit-audiophob`'s snare (a sample) — the master
  meter (`engine.getMasterLevel()`) reaches -17.6 dB and -12.2 dB respectively during the ~1.2s
  window, **and** the `.beat` file is read byte-identical before and after each preview (real
  audio, zero writes — the "preview-before-load" bar exactly).
- **W6**: clicking the soundfont "+" on `upright-piano-kw-small.sf2` with no instrument track
  present — a brand-new instrument track (`instrument`) appears carrying
  `instrument.sample === 'upright-piano-kw-small'`, and the file changes (a real, persisted write,
  correctly distinct from a preview).

Screenshots: `ui/verify-p22ah-preset-drop.png`, `ui/verify-p22ah-sample-drop.png`,
`ui/verify-p22ah-browser.png`.

## Honest gaps — correctly out of scope, not silently dropped

- **Hot-swap preset browser *inside* Device View** (`SynthPanel.tsx`/`InstrumentPanel.tsx`) — a
  preset picker/prev-next control living in the panel itself, so a preset can be swapped without
  leaving Device View. This is a **distinct** feature from the sidebar (dropping a preset from
  *outside* Device View onto a track header) and was **not built** this stream — the roadmap keeps
  it `not-started`, separately from "Content browser sidebar" and "Preview-before-load," which
  really are done.
- **Group tracks / Collections / color-tagged favorites** — research 18 §8 marks these "Skip (for
  v1)"; untouched, correctly still `not-started` elsewhere in the roadmap.
- **A curated "Sound" tier** (a full `.beat` track/template as a multi-thing preset) — research 18's
  own noted-but-not-recommended-yet idea; `presets/factory.json` stays squarely device-preset-tier.
- **Dropping a soundfont to create a new instrument track via drag** — the daemon route
  (`POST /library/install-soundfont` with no `track`) supports this, but no *drop target* was wired
  for it (there's no "empty canvas"/"+" drop zone in `ArrangementView.tsx` today). The click-driven
  "+" button on each soundfont row covers the same outcome without needing one.
- **Collapsible sub-categories** (e.g., collapsing just the "bass" group within Presets — Synth) —
  only the four top-level sections (Presets — Synth / Presets — Drums / Kits / SoundFonts) collapse;
  category groups within a section are plain labeled dividers, not independently collapsible. A
  reasonable v2 refinement, not attempted here to keep the component's local state simple.
