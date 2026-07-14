# Phase 36 — multi-region audio placement (format v0.11, decisions.md D16)

Source: owner approval 2026-07-14 of `docs/multi-region-audio-design.md` Option A with all three
§5 questions as recommended (repeated `slot` lines with optional `at <steps>`; unit = fractional
16th steps; `audio-split` auto-places the second half). This is a format-version bump (v0.11) —
the last decided-but-unbuilt schema change on the books.

Sequencing is NOT fully parallel: Stream PA (core) lands first and pushes; PB/PC/PD then fan
out against it. The design doc's Option A section is the normative spec — streams implement it,
not a paraphrase of it.

## Streams

| Stream | Work | Depends on | Primary files |
|---|---|---|---|
| PA | Core: types, parser, serializer, validation, diff, edit primitives, format-spec | — | `src/core/*`, `docs/format-spec.md` |
| PB | CLI + MCP surface: scene grammar, place/unplace verbs, help | PA on main | `cli/beat.mjs`, `src/mcp/server.ts` |
| PC | Engine: placement scheduling + render proof | PA on main | `ui/src/audio/engine.ts`, `ui/verify-*` |
| PD | Daemon + GUI: placement-aware payloads, arrangement blocks per placement | PA on main (PC helpful, not required) | `src/daemon/`, `ui/src/components/` |

## PA — core (the keystone)

Per the design doc's Option A spec, precisely:

1. **Types**: `BeatScene.slots: Record<trackId, clipId>` → `Record<trackId, BeatPlacement[]>`,
   `BeatPlacement = { clip: string; at: number }` (`at` in fractional 16th steps, ≥ 0).
2. **Parser/serializer**: optional trailing `at <steps>` on `slot` lines; multiple slot lines
   per track legal; canonical order = track order, then placements by `at` (ties: clip id);
   `at 0` elided. **Byte-identical round-trip for every existing file** — prove it against all
   three examples/ projects and the full round-trip property tests.
3. **Validation (fail-loudly)**: placement's clip must exist on that track; `at > 0` or >1
   placement per track only on audio-kind tracks (error text per the design doc: "multi-
   placement is audio-only for now — synth/drum clips tile from the section start"); overlap on
   one track = error (timeline length from region in/out/rate and doc bpm); negative/non-finite
   `at` = error.
4. **Diff**: placement-granular `scene-slot` entries (`scene s1: fx +impact1@48`,
   `-riser1@56.5`, and `@` moves reported as moves, not remove+add).
5. **Edit primitives**: `setScene` accepts placements (back-compat shape for single-clip
   callers); new `placeClip(doc, sceneId, trackId, clipId, at)` / `unplaceClip(...)`;
   `splitAudioClip` auto-places the second half at `<placement.at + split steps>` in every
   scene that placed the original clip (D16 q3) — including multi-placement parents.
6. **Format bump** to 0.11 (parser accepts 0.11; older files parse as before), format-spec.md
   section written in the house style (grammar, canonical form, validation rules, worked
   example), migration note: none needed.
7. Tests: round-trip property + byte-identity on examples; validation matrix; diff shapes;
   split-auto-place (single and multi placement, and a scene that did NOT place the parent
   stays untouched).

## PB — CLI + MCP

1. `beat scene <file> <scene> <track>=<clip>[@<steps>] ...` — repeatable per track.
2. New verbs: `beat place <file> <scene> <track> <clip> <at>` / `beat unplace <file> <scene>
   <track> <clip>[@<at>]` (unambiguous when a clip is placed once; requires `@<at>` when placed
   twice — fail-loudly on ambiguity). MCP: `beat_place` / `beat_unplace`, and `beat_scene`
   accepts the placement shape. Same core calls both surfaces (batch.ts discipline).
3. Help text + `beat_audio_split` / `audio-split` output now reports the auto-placements it
   made. Per-command help entries; family: clip/scene/place/unplace/song.
4. Tests: subprocess-level CLI + MCP protocol tests; cross-surface parity.

## PC — engine

1. Audio scheduling honors placements: region starts at `sectionStart + at` (per-placement
   retrigger bookkeeping instead of the single `contentStep === cycleStart` check); truncate at
   section end unchanged; a clip placed twice plays twice (shared buffer, per-placement
   trigger).
2. Placement-relative gain automation (lane lookup keyed to the placement's own start).
3. Committed verify script (house pattern, CHROME_PATH=/opt/pw-browsers/chromium): a project
   with one audio track, two placements of two different-pitched regions at 0 and mid-section —
   render, assert both audible at the right offsets (onset detection at expected times,
   spectral identity per window). Plus: an existing single-placement project renders
   byte-comparable metrics to pre-change (no regression).

## PD — daemon + GUI

1. Daemon `/scene`-family payloads carry placement lists; `captureAndInsertScene` and friends
   keep working (they produce single placements at 0).
2. Arrangement view: one block per placement within the section row (offset-proportional x
   position/width); clip editor targeting (track, scene, placement); the loop-mode view is
   unaffected.
3. Drag-to-place deferred if it inflates the stream — landing *display* correctness (blocks
   where the audio actually sounds) is the required half; say plainly in the result which half
   shipped. GUI-facing behavior changes ⇒ a GUI usability pilot in wrap-up targets this.

## Wrap-up (standing habits)

- CLI/MCP pilot on the new scene/place surface; a GUI pilot if/when PD ships display changes.
- Roadmap rows (flip the multi-region row through progress→done), product-roadmap.md +
  dashboard, README arrangement paragraph, format-spec cross-references, `.claude/skills/dotbeat`
  refresh (scene/place examples).
- `first-light.beat` is NOT migrated by us mid-phase — the owner's session owns that file; the
  fix it wants (riser placement, split halves) becomes available to it on next pull.
