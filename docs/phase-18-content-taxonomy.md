# Phase 18 Stream S — content taxonomy: the data layer

*Per `docs/phase-18-plan.md`'s Stream S and `docs/research/18-ableton-ui-architecture.md`'s
content-taxonomy section ("borrow Ableton's categorization logic, keep dotbeat's text/hash
mechanics"). Data layer only this round — the browser-sidebar UI that consumes this taxonomy is
deliberately deferred to the round after Stream Q lands (it needs a place to dock in the new
layout that doesn't exist yet).*

## What was actually there before this stream

Read `presets/factory.json` directly before changing anything, per the plan's instruction not to
assume. Confirmed: **no explicit category field existed anywhere** — the 36 presets (6 drum-voice
kits, 30 synth presets) had only `{ name, kind: "synth"|"drums", description, params }`. The
Bass/Lead/Pad/Pluck/Keys/Arp/FX grouping from `docs/phase-12-presets.md` existed only as a
convention inside each preset's `description` string (e.g. every Pad preset's description starts
with `"Pad — ..."`) and, for drum kits, inside the `name` slug (`808-trap-kit`, `techno-kit`,
`lofi-kit`...). A browser or CLI filter built on the pre-existing shape would have had to parse
free text — real, sortable metadata didn't exist.

## The taxonomy landed on

Research 18's content-taxonomy section (`docs/research/18-ableton-ui-architecture.md`, "Content
taxonomy — Ableton's asset 'kinds'") explicitly recommends introducing a `category` field using
`bass, lead, pad, pluck, keys, arp, fx, and for drums the kit-genre` — i.e. it converges on
exactly the Phase 12 taxonomy rather than proposing something more precise, so no refinement was
needed beyond formalizing it as an enumerated, validated set:

**Synth categories** (`SYNTH_PRESET_CATEGORIES` in `src/core/preset.ts`):
`bass`, `lead`, `pad`, `pluck`, `keys`, `arp`, `fx`

**Drum categories** (`DRUM_PRESET_CATEGORIES`, kit-genre, matching each kit's researched lineage
in `docs/phase-12-presets.md` and each kit's own name/description):
`house`, `808-trap`, `techno`, `boom-bap`, `lofi`, `acoustic-rock`

Both sets are exported together as `PRESET_CATEGORIES` (13 values total) and as a `PresetCategory`
union type, all from `src/core/preset.ts` and re-exported via `src/core/index.ts`.

The category-to-kind mapping is enforced structurally, not just by convention: `parsePresetLibrary`
rejects a `drums`-kind preset whose category isn't one of the six drum genres, and rejects a
`synth`-kind preset whose category isn't one of the seven synth categories — so the taxonomy can't
silently drift out of sync with the two-class split research 18 describes (device-preset-tier
param bags, no `.adg`-style curated "Sound" tier, per the doc's explicit recommendation to skip
that layer since dotbeat has no rack/macro bundling).

## What was built

1. **`presets/factory.json`**: every one of the 36 entries gained an explicit `"category"` field
   (inserted right after `"kind"`), assigned by reading each preset's own description prefix
   (synths) or genre lineage (drum kits) — not inferred programmatically, since the mapping is
   small and the descriptions already state the category in prose. No preset's `params` or
   `description` changed.

2. **`src/core/preset.ts`** (the shared implementation both `cli/beat.mjs` and
   `src/mcp/server.ts` already depended on for parsing/formatting):
   - New exports: `SYNTH_PRESET_CATEGORIES`, `DRUM_PRESET_CATEGORIES`, `PRESET_CATEGORIES`,
     `PresetCategory` (type), `filterPresetsByCategory(presets, category)`.
   - `BeatPreset` gained a required `category: PresetCategory` field.
   - `parsePresetLibrary` now validates `category` structurally (must be a known category,
     must belong to the class matching the preset's `kind`) — the same "fail loudly, not
     silently" convention the rest of the parser already uses for `kind`/`params`.
   - `formatPresetList` (what `beat presets` and `beat_presets` both render) now prints a
     category column, so a listing is self-describing.
   - `filterPresetsByCategory` is the single shared filter implementation, so the CLI and the MCP
     tool can't disagree about what counts as a valid category or how filtering behaves.

3. **`cli/beat.mjs`** (additive only — `presetCmd`/`applyPreset`'s edit-application path is
   untouched):
   - `beat presets --category <cat>` filters the listing to one category.
   - `beat presets --list-categories` prints the enumerated taxonomy (discoverability without
     reading source).
   - Usage text updated to document both.

4. **`src/mcp/server.ts`** (additive only — `beat_preset`'s apply-to-track handler is untouched):
   - `beat_presets`'s `inputSchema` gained an optional `category` property; the handler filters
     via the same `filterPresetsByCategory` the CLI uses when `category` is passed.
   - Both `beat_presets` and `beat_preset`'s `description` strings were rewritten to state the
     real, current behavior (enumerated category list included inline, generated from
     `PRESET_CATEGORIES` so the description can't drift out of sync with the actual taxonomy).

5. **`test/preset.test.ts`**: six new tests (11 -> 17 total in this file):
   - Structural coverage: every factory preset has a `category` in `PRESET_CATEGORIES`, and that
     category belongs to the correct class for its `kind` — the direct analog of Phase 12 Stream
     2's "no two presets share identical params" tripwire, but for the taxonomy itself.
   - `filterPresetsByCategory` returns exactly the bass presets and nothing else (asserted by
     exact name-set equality, not just "some results came back").
   - `filterPresetsByCategory` rejects an unknown category.
   - A preset with an out-of-taxonomy category is rejected at load time.
   - A synth preset carrying a drum-only category (cross-class) is rejected at load time.
   - Three pre-existing bad-library fixtures (unknown param, trackref param, duplicate names)
     were updated to include a valid `category` field so they still test what they originally
     tested, now that `category` is a required field validated before those other checks run.

## Verification — real command output, not aspirational text

`beat presets --category bass` against the actual `presets/factory.json`:

```
$ node cli/beat.mjs presets --category bass
deep-sub-bass  synth  bass  14 params  Sub-anchored bass with a detuned square layer...
sub-sine-bass  synth  bass  10 params  Bass — clean, flat sustained sine sub...
reese-bass     synth  bass  16 params  Bass — thick detuned dual-saw Reese...
wobble-bass    synth  bass  15 params  Bass — dubstep wobble: fast deep filter-cutoff LFO...
acid-bass      synth  bass  14 params  Bass — TB-303-style acid...
fm-bass        synth  bass  12 params  Bass — DX-style FM bass...
```

Exactly the 6 bass presets, nothing else — confirmed against the unfiltered 36-preset listing
(`beat presets | wc -l` → 36) and against a `--category techno` run that returns exactly
`techno-kit` and nothing else.

`beat presets --list-categories` prints all 13 values (`bass, lead, pad, pluck, keys, arp, fx,
house, 808-trap, techno, boom-bap, lofi, acoustic-rock`).

`beat presets --category bogus` fails loudly (exit 2) with
`error: unknown category "bogus" — must be one of bass, lead, ...` rather than silently returning
nothing.

The MCP path was verified independently by piping raw JSON-RPC into `beat mcp` (not just unit
tests): `tools/call beat_presets {category: "bass"}` returns the identical 6-preset text block the
CLI produces (both go through `filterPresetsByCategory` + `formatPresetList`), and
`{category: "bogus"}` returns an MCP error result with the same message. `tools/list` was used to
confirm the live `beat_presets`/`beat_preset` tool descriptions match this doc exactly — they were
generated from `PRESET_CATEGORIES` rather than hand-typed, so they can't silently go stale.

A full `beat init` + `beat preset <file> lead deep-sub-bass` + `beat inspect` round trip confirmed
preset application itself is unmodified — still exactly a bag of `synth-param` edits, category
plays no role in `applyPreset`.

`npm test`: **292/292/0/0** (full suite green; `test/preset.test.ts` alone: 17/17/0/0, up from 11
before this stream). The plan's baseline for this phase was 290+/287+/0/3 — this checkout's local
history-test skip count differs from that baseline for reasons unrelated to this stream (see
`memory/dotbeat_test_env_quirk.md`); what matters is 0 failures and every new test passing.

## Environment note, unrelated to the taxonomy work itself

This worktree's branch was originally rooted at a commit (`deba7c1`) that turned out to be from an
history line unrelated to the current `main` (`git merge-base --is-ancestor` returned false;
`main`'s root commit differs from this branch's root commit). `main` already contained Phase 17's
merged result plus the Phase 18 planning/research commits this stream's required reading depends
on. Since this branch carried no commits of its own yet, it was reset to `main`'s tip
(`bbe3f15`, "Phase 18 plan addendum") before any Stream S work began, so this stream's history sits
cleanly on top of the real, current project history rather than an orphaned line. No content was
lost — the pre-reset branch had zero unique commits.

## Deferred (per the plan, correctly out of scope this round)

- **The browser sidebar UI** consuming this `category` taxonomy — needs Stream Q's new layout to
  have a place to dock into first.
- **A curated "Sound" tier** (research 18's `.adg`-equivalent idea: a full `.beat` track/template
  as a curated multi-thing preset) — noted as a plausible future increment in research 18, not
  attempted here; today's `factory.json` entries are squarely the "device preset" tier only.
- **Unifying `kit-*/` sample-kit directories and `sf2/` SoundFont banks under the same category
  taxonomy** — research 18 recommends this for the eventual sidebar's "Drums"/"Instruments"
  headings, but those two mechanisms don't go through `parsePresetLibrary` at all today (no shared
  parser/schema to attach a `category` field to yet), so it's real follow-up work, not something
  this stream's file-ownership boundary (`presets/factory.json`, CLI, MCP, one test file) covered.
