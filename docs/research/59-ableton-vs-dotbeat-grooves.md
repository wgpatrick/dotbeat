# Research 59 — Ableton Live 12 grooves vs. dotbeat: feature/UI comparison + recommendations

*2026-07-12. Direct follow-on to `docs/research/40-ableton-grooves.md` (the grounded primer on
manual ch.14, pp.330-335). That pass already concluded the real gap is extraction/reuse, not
shuffle math or randomization — this pass turns that into a structured feature/UI comparison,
grounded additionally in the chapter's own screenshots (`p-330.jpg`–`p-335.jpg`), and a decisive,
per-item build plan. Nothing here proposes work that contradicts a shipped feature or a decision
in `docs/decisions.md`; `groove`/`humanize` are both ✅ Done in `docs/product-roadmap.md`
("Groove / shuffle as a reversible time-warp", line 58) — this doc scopes what's still missing
around them, not a redo.*

## 1. Feature & UI/UX comparison

### a) Shared features / parity

| Capability | Ableton Live 12 | dotbeat |
|---|---|---|
| Track/clip-scoped timing pull toward a grid, non-destructive at read time | Groove Pool's **Timing** (strength) + **Base** (grid resolution) [manual p.332] | `shuffleAmount`/`shuffleGrid` on `BeatTrack` (`src/core/document.ts:721-722`), computed live via `warpStep()` (`src/core/groove.ts:51-57`) — never baked into stored `start` |
| Partial-strength quantize (blend, not hard-snap) | Groove Pool's **Quantize** 0-100% dial, pre-groove [manual p.332] | `quantizeNotes`'s `amount` 0..1 param (`src/core/edit.ts:389-390`, doc comment explicitly names this "Ableton's Amount") — a separate one-shot op rather than folded into the groove device, functionally equivalent |
| Randomized timing/velocity jitter for "humanizing" quantized parts | Groove Pool's **Random** + **Velocity** sliders [manual p.332] | `humanize()` (`src/core/humanize.ts:62-106`) — Gaussian timing/velocity jitter, plus drag/swing Ableton's groove doesn't separately expose |
| A dedicated real-time knob surface in the mixer/channel view | Groove-related controls live in the Clip inspector + Groove Pool panel [manual p.331-332] | Shuffle/Grid knob pair on every channel strip (`ui/src/components/MixerView.tsx:222-236`), writing straight through `postEdit` to the same fields |
| Reversibility of the applied warp | Not literally reversible after Commit (see 1b) — but *before* commit, groove is a live, removable relationship | `warpStep`/`unwarpStep` are proven exact inverses (`groove.ts:63-69`, asserted in `test/groove.test.ts`) — always non-destructively reversible, no separate "live vs. committed" state to reason about |

### b) In Ableton, not in dotbeat

1. **Extraction from real performed content.** "The timing and volume information from any audio
   or MIDI clip can be extracted to create a new groove" [manual p.334], via drag-to-Groove-Pool or
   the clip's own right-click **Extract Groove(s)** command, sitting in the ordinary clip context
   menu next to Cut/Copy/Duplicate/Freeze Track [manual p.334, screenshot]. dotbeat's `groove.ts`
   and `humanize.ts` both *generate* deviation from a formula (a Möbius curve, a seeded Gaussian);
   neither *reads* timing/velocity data from an existing clip. Confirmed as the load-bearing gap by
   research 40 §5.2.
2. **The Groove Pool as a shared, named, multi-groove live object.** A dockable panel, not a
   per-track knob pair: a table of **Groove Name | Base | Quantize | Timing | Random | Velocity**
   rows, one per groove currently loaded or in use, each a horizontal slider live-editable in real
   time [manual p.332, screenshot]. Editing one row's parameters retroactively re-grooves *every
   clip currently assigned to that groove*, simultaneously [manual p.332]. dotbeat's
   `shuffleAmount`/`shuffleGrid` is a scalar pair inlined directly on one `BeatTrack` — there is no
   separate named object, and no one-to-many "many clips subscribe to one groove" relationship.
3. **A browsable groove library.** "Grooves" is a first-class category in Live's content browser,
   alongside Sounds/Drums/Instruments/Audio Effects/Samples, listing `.agr` files with a naming
   convention that embeds subdivision+percentage directly (`Swing 16ths 61.agr`, `Swing 32ths
   57.agr`) and its own preview/audition transport at the bottom of the list [manual p.330,
   screenshot]. dotbeat's `ContentBrowser.tsx` browses presets/kits/soundfonts (`docs/product-
   roadmap.md`, "Content browser sidebar" row) but has no groove category — there is no browsable
   groove content to put in one yet (follows directly from gap 1).
4. **Hot-Swap live audition.** A toggle above the clip's Groove chooser that lets you step through
   every groove in the browser while the clip keeps playing, live-previewing each candidate before
   committing to one [manual pp.330-331, screenshot]. dotbeat already has the *general* pattern for
   other content types — `engine.previewSynthPreset`/`previewDrumPreset`/`previewSoundfont`
   (`docs/product-roadmap.md`, "Preview-before-load" row, ✅ Done) — but nothing plays that role for
   grooves, again because there's no groove library to step through.
5. **Global Amount — a master intensity dial across every active groove at once.** Scales
   Timing/Random/Velocity for *all* grooves currently in use simultaneously (0-130%), and is
   important enough to be mirrored directly into Live's Control Bar/transport, not buried in the
   Groove Pool panel [manual p.333, screenshot]. dotbeat has no cross-track "turn the whole
   project's groove down 20%" control — every track's shuffle is independent.
6. **Velocity-invert.** The Groove Pool's Velocity slider runs -100 to +100: negative values
   *invert* the captured groove's velocity profile onto the target clip ("loud notes in the groove
   make clip notes play quiet, and vice versa") [manual pp.332-333]. This only makes sense once a
   groove carries a captured velocity profile at all (gap 1) — `humanize.ts`'s velocity jitter adds
   noise around the existing value, it has no concept of an external profile to invert.
7. **Commit — bake a live groove into permanent clip data.** The Commit button "writes" the pool's
   current parameter effect into the clip: MIDI notes actually move; audio clips get real Warp
   Markers written at the resulting positions. After Commit the clip's Groove chooser resets to
   None — the live relationship ends and the effect becomes literal clip content [manual p.333,
   screenshot]. dotbeat's shuffle is *always* computed at playback/read time (by design, per the
   `groove.ts` header comment) — there is no way to freeze a currently-shuffled shape into literal
   `note.start`/`hit.start` values, e.g. before further manual per-note dragging in the piano roll,
   or to hand a reader that doesn't apply `warpStep` a file that still sounds right.
8. **Groove on audio clips, via Warp Markers.** "In audio clips, grooves work by adjusting the
   clip's warping behavior, and thus only work on clips with Warp enabled" [manual p.331]. dotbeat's
   groove/shuffle machinery only touches note/hit (synth + drum) tracks — audio-region tracks have
   no groove/warp concept at all yet (`docs/product-roadmap.md`'s "Warp markers + Complex-mode
   stretch" row is already tracked separately, "Not started").

### c) In dotbeat, not in Ableton

1. **Per-voice scoping without a workaround.** Ableton's own manual names this as an awkward
   limitation: because a groove applies to an entire clip at once, grooving one instrument
   differently (e.g., snare slightly behind the hats) requires physically extracting that
   instrument's chain out of a Rack into its own clip and track first [manual p.335, §14.3.1].
   dotbeat's `humanize()` already takes an `ids` scope (`src/core/humanize.ts:55-56, 74`) resolved
   from a selection, and drum lanes are independently addressable per-hit by construction — "just
   the snare hits" is a single scoped call today, no extraction dance required.
2. **Reproducible, seeded randomization.** `humanize()`'s `seed` option (`humanize.ts:53-54, 75`)
   makes every jitter pass bit-for-bit reproducible for the same `(doc, track, opts, seed)` — the
   manual describes Live's Random groove parameter only as a live real-time effect, with no
   documented seed/reproducibility control. This matters concretely for dotbeat's CI (`beat vary`'s
   variation loop depends on reproducible renders) in a way Ableton's live-performance-first design
   doesn't need to solve.
3. **Groove as literal, diff-friendly text.** `<track>.shuffleAmount`/`<track>.shuffleGrid` are
   ordinary fields on a `.beat` line (`src/core/document.ts:721-722`), readable/writable via `beat
   set`, `beat_set` (MCP), or a plain text editor, and visible as a one-line `git diff` — versus a
   binary `.agr` file dragged onto a clip in a GUI. This is dotbeat's core thesis applied to this
   one feature, not a novel claim, but worth stating plainly here: nothing about grooving requires
   opening the app.
4. **Agent-callable by construction.** `beat humanize`/`beat_humanize` (`src/mcp/server.ts:615` et
   seq.) and `beat set <track>.shuffleAmount` are ordinary CLI/MCP primitives an agent can call
   directly — Live's groove parameters are reachable only through its own GUI or Max for Live
   scripting, not an external CLI.

## 2. Prioritized recommendations

| Feature (from 1b) | Priority | Build recommendation |
|---|---|---|
| 1. Extraction from real clips → named template | **P1** | New `src/core/groove.ts` functions `extractGroove(doc, trackId, name, opts)` / `applyGroove(doc, trackId, name, opts)`, same document→document one-shot shape as `humanize()` — read each note/hit's signed offset from its nearest `--base`-resolution grid cell plus a velocity delta from the track's own mean, write a named bundle to a new project-local `presets/grooves.json` (D9's exact precedent: "presets are tooling, never grammar" — apply through the existing edit path, never an in-file reference). CLI: `beat groove extract <file> <track> <name> [--base N] [--ids a,b]` / `beat groove apply <file> <track> <name> [--amount N]`, wired into `cli/beat.mjs` next to `humanizeCmd` (`cli/beat.mjs:419`); MCP tools `beat_groove_extract`/`beat_groove_apply` patterned directly on `beat_humanize` (`src/mcp/server.ts:615`). Scope to synth/drum tracks only — audio isn't ready (see row 8). |
| 2. Groove Pool as a shared, live multi-object panel | **Do-not-recreate** | The live one-to-many "many clips subscribe to one groove, edit once, all update in real time" mechanism only exists because Live's whole product is built around Session-View real-time clip triggering (research 40 §5.3, point 1) — building a second, parallel *live* linkage layer on top of an already-shipped *document-edit* shuffle model would reopen exactly the in-file-indirection question D9 already closed for presets ("never a live reference to an app version / library"). The practical need it solves — apply one captured feel to several tracks — is already served by calling `beat groove apply` in a loop, or a thin non-live convenience wrapper `beat groove apply-many <file> <name> <track1,track2,...>` if that proves annoying; still a one-shot diff each time, no live link. |
| 3. Browsable groove library in the content browser | **P2** | Once row 1 ships, add a `grooves` section to `ContentBrowser.tsx` reading `presets/grooves.json` the same way it already reads `presets/factory.json` (`docs/product-roadmap.md`'s "Content browser sidebar" row) — drag onto a track applies via `applyGroove`, same drag→edit-list pattern as presets/kit samples. Small, but has no reason to exist before row 1. |
| 4. Hot-Swap live audition | **P2** | Extend the existing preview-before-load family (`engine.previewSynthPreset`/`previewDrumPreset`/`previewSoundfont`) with `engine.previewGroove(doc, trackId, name)` — an ephemeral preview voice/loop, zero `.beat` writes, same pattern already proven for presets and soundfonts (`docs/product-roadmap.md`'s "Preview-before-load" row). Sequence after rows 1 and 3. |
| 5. Global Amount master intensity dial | **P2** | Matches research 40 §5.3 point 4's own call: "not worth building until multiple tracks are commonly sharing one extracted groove." When it is: a one-shot `beat groove scale-all <file> <factor>` that scales every track's current `shuffleAmount` by `factor` (clamped 0..1) — a batch edit over existing fields, not a new live parameter or a Control-Bar-level transport concept (dotbeat has no real-time transport-bar controls surface today, and shouldn't grow one just for this). |
| 6. Velocity-invert | **P2** | Bundle as a `--velocity-invert` flag on `beat groove apply` from row 1 (flips the sign of the captured velocity delta before applying) — a few-line addition once extraction carries a captured velocity profile at all; not worth a standalone primitive. |
| 7. Commit / bake groove into literal note positions | **P1** | New `beat groove bake <file> <track>` (and `beat_groove_bake` MCP tool): rewrite every `note.start`/`hit.start` on the track via the existing `warpStep()` (`src/core/groove.ts:51-57`, already exported, already unit-tested), then reset `shuffleAmount`/`shuffleGrid` to their defaults (0/1, eliding both per the format's own canonical-elision rule) — idempotent, reuses proven math, no new grammar. Cheap and resolves a real editing-surface question: a note dragged in the piano roll today shows its literal stored position, not its shuffled playback position, with no way to reconcile the two other than turning shuffle off. |
| 8. Audio-clip groove via Warp Markers | **P2, sequenced** | Do not build as standalone work — it is already the tracked, "Not started" roadmap item `docs/research/25-audio-warp-markers-stretch.md` ("Warp markers + Complex-mode stretch"). Once that lands (its own `BeatAudioRegion.markers` grammar, research stream RA), extend `applyGroove`/`extractGroove` from row 1 to operate on audio tracks against the same marker grammar rather than inventing a parallel audio-groove mechanism. |

## Sources

Ableton Live 12 Reference Manual, ch.14 "Using Grooves," pp.330-335, including direct visual
inspection of all six page images (`p-330.jpg` through `p-335.jpg`) — the Groove Files browser
panel and its preview transport (p.330), the Clip inspector's Groove chooser + Hot-Swap button and
the Groove Pool's view-control menu (p.331), the Groove Pool table itself (Base/Quantize/Timing/
Random/Velocity columns, multi-groove list, "Drop Clips or Grooves Here", Global Amount) (p.332),
the Global Amount transport-bar mirror and the Commit button (p.333), the Extract Groove(s)
context-menu entry (p.334), and the three Groove Tips (p.335). dotbeat internal (read directly this
pass): `src/core/groove.ts`, `src/core/humanize.ts`, `src/core/document.ts:700-722`,
`src/core/edit.ts:388-430`, `src/mcp/server.ts:340,615`, `cli/beat.mjs:419-449`,
`ui/src/components/MixerView.tsx:198-240`, `docs/decisions.md` D9, `docs/product-roadmap.md`,
`docs/research/40-ableton-grooves.md` (the direct predecessor to this pass).
