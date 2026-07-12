# Phase 22 Stream AA — ordered, reorderable per-track effect chain

*2026-07-11.* Replaces the hardcoded, fixed-order synth insert chain (EQ3 → compressor →
distortion → bitcrush, `ui/src/audio/engine.ts`'s old `buildSynthChain()`) with a real per-track
effect list: addable, removable, reorderable, per-instance bypassable — stated directly in the
`.beat` file as flat, ordered, literal text, per `docs/research/21-opendaw-devices-effects.md`
§3 row 1's "adapt, not adopt" verdict (get openDAW's outcome, not its box/pointer graph mechanism).

## What "no such file" means for this doc

The task brief pointed at `docs/phase-22-plan.md` for the full eight-stream plan; that file does
not exist in this worktree (checked — not on `main`, not on any other local branch, not created by
a sibling stream yet). This doc was written from the inline task brief plus
`docs/research/21-opendaw-devices-effects.md`, `docs/decisions.md`, and `docs/format-spec.md`
directly, without the cross-stream plan doc as backup context. If `phase-22-plan.md` surfaces later
(e.g. a sibling stream writes it), worth a quick reconciliation pass — nothing here should
contradict it (the scope discipline section of the task brief was followed exactly: no new effect
types, no drum-track changes, no `ArrangementView.tsx` changes beyond what's needed), but the
exact wording of shared conventions (stream names, doc cross-links) may drift.

## The format grammar (v0.10)

```
  effect <id> <type> [bypassed]
```

- **`type`** — one of `eq3|comp|distortion|bitcrush`, the four built-in inserts every synth track
  already carries knobs for (`eqLow`/`eqMid`/`eqHigh`, `comp*`, `distortion*`, `bitcrush*` —
  unchanged `SYNTH_FIELDS` in `src/core/document.ts`). An `effect` line only says **whether,
  where, and in what order** a type runs in the chain; the type's own parameter values still live
  in the synth block exactly as before this stream.
- **`id`** — a stable, track-scoped human slug (D6). This is what makes a reorder read as a MOVE
  (a line changes position) rather than a delete-and-reinsert-different-content pair — the same
  discipline note/hit/clip ids already use (D4/D7). Defaults use the type name as the id (`eq3`,
  `comp`, `distortion`, `bitcrush`); `addEffect` mints `<type>_2`, `_3`, ... on collision.
- **`bypassed`** — the enabled/disabled token, styled after `SYNTH_FIELDS`'s own elision
  convention (the task brief's explicit ask): enabled is the default and is elided (bare
  `effect <id> <type>`); a disabled instance carries the trailing `bypassed` token.
- **Whole-chain canonical elision**: `effect` lines serialize iff the track's chain differs from
  the canonical default (`eq3, comp, distortion, bitcrush`, all enabled, in that order —
  `defaultEffectChain()`). An untouched track — old file or freshly created — emits **zero**
  effect lines. An explicitly emptied chain (every insert removed) emits one `effects none`
  sentinel line, so "the user removed everything" and "this file predates the grammar" stay
  distinguishable on the next parse (there would otherwise be no way to tell them apart — both
  would parse to an empty in-memory list — so the sentinel is load-bearing, not decorative).
- **Position**: right after the `synth` block, before `lane`/`clip`/`note`/`hit` lines. Synth
  tracks only.

Worked example — reordering `bitcrush` to the front of an already-customized chain:

```diff
-  effect eq3 eq3
-  effect comp comp
-  effect distortion distortion
-  effect bitcrush bitcrush
+  effect bitcrush bitcrush
+  effect eq3 eq3
+  effect comp comp
+  effect distortion distortion
```

That's the "whole chain got explicit for the first time" case (every line is new because there
were zero lines before). Once a chain is already explicit, one more reorder is a genuinely small
diff — verified live in `ui/verify-phase22-stream-aa.mjs`'s AA2 step: moving one effect up by one
position changes **exactly two lines** (the swapped pair), confirmed against a real `git diff`.

## Migration decision: automatic, on-load, lossless

Chosen over "coexist with defaults" because it needs zero new state and produces the cleanest
byte-identical guarantee: **any synth track with no `effect`/`effects` lines at all — every
pre-v0.10 file, and any hand-written file that never mentions effects — parses into exactly the
old hardcoded chain** (`eq3 → comp → distortion → bitcrush`, all enabled). Since that's also the
serializer's canonical default, such a file re-serializes byte-identical to what it started as.
`test/format-v10-effects.test.ts`'s first test proves this directly: parsing a v0.9 file with no
effect lines produces the default chain, and `serialize(parse(x)) === x`.

Consequence: every existing `.beat` file in the repo (`examples/*.beat`, test fixtures) needed
zero migration/rewrite, and `beat render`/the live GUI sound identical to before this stream for
every project that hasn't touched the chain.

## Deliberate scope cut: no independently-parameterized multi-instance

The task brief's problem statement lists "cannot add a second instance of anything" as a current
limitation. This stream's concrete build list (a)-(d) doesn't require fixing that, and fixing it
fully would mean moving `eqLow`/`compMix`/etc. out of the flat `SYNTH_FIELDS` synth block and into
per-instance storage on each `effect` line — a much larger blast radius touching LFO destinations
(`lfoDest`/`lfo2Dest` target `eqLow`/`compMix`/`distortionMix`/`bitcrushMix` by name), clip
automation (`AUTOMATABLE_SYNTH_PARAMS`), the GUI's "Inserts" knob group, and every existing test
that touches those fields. Given the scope discipline ("don't build new effect types" — the
sibling AC stream owns that) and the size of this stream already, I chose the smaller, safer
design: `effect` lines carry **id + type + enabled** only; parameters stay type-keyed in the
existing synth block, shared by any instance of that type. A track can have zero, one, or (rare,
allowed but not especially useful) multiple instances of the same type — multiple instances of one
type just share that type's one set of params. This is honestly a real, documented gap, not an
oversight; closing it is a reasonable follow-up but a materially bigger, riskier change than this
stream needed to make its actual ask (arbitrary order, add/remove/reorder, real bypass) true.

## What was built

**Format** (`src/core/document.ts`, `parse.ts`, `serialize.ts`, `edit.ts`, `diff.ts`,
`inspect.ts`, `convert.ts`, `docs/format-spec.md`):
- `EffectType`, `EFFECT_TYPES`, `BeatEffect`, `defaultEffectChain()`, `isDefaultEffectChain()` in
  `document.ts`; `BeatTrack.effects: BeatEffect[]`.
- Parser: `effect`/`effects none` grammar, migration-on-close for synth tracks with no explicit
  declaration, strict validation (synth-tracks-only, no mixing `effect` with `effects none`,
  duplicate-id rejection).
- Serializer: whole-chain canonical elision (above).
- Edit primitives: `addEffect`, `removeEffect`, `moveEffect`, `setEffectEnabled` — plus
  `setValue`'s `<track>.effect.<id>.enabled` path for bypass (fits the flat `path=value` grammar;
  add/remove/move don't, same reasoning clip/scene/song/automation already established for
  structural edits).
- Diff: `effect-added`/`effect-removed`/`effect-moved`/`effect-enabled`, matched by id (order
  comparison over common ids only — the same discipline `track-moved` already uses, so an
  add/remove elsewhere doesn't make unrelated entries look like they moved).
- `beat inspect` / `describeDocument`: always shows the chain (`effects: eq3(eq3) -> comp(comp,
  bypassed) -> ...`), even at the default order, so an agent can see it without diffing.
- Format version bumped to `0.10` for newly-created documents (`initDocument`, the BeatLab
  converter's `BEAT_FORMAT_VERSION`) — existing files keep whatever version they already declare
  (unchanged parser behavior; version bumps have never triggered a rewrite in this codebase).

**Engine** (`ui/src/audio/engine.ts`):
- `buildSynthChain()` no longer wires a fixed 4-node chain; it builds the shared spine (filter,
  panner, vol, sends, muteGain) and leaves the effect chain empty.
- `reconcileEffectChain()` (new) rebuilds the spine — `filter -> ...ordered, enabled effects... ->
  muteGain` — whenever the track's declared `effects` list's *shape* changed (a cheap string
  signature compare against the last-wired state), disposing runtimes for removed ids, building
  runtimes for new ones, reusing everything else (a live-playing voice's EQ/comp/etc. nodes
  survive a reorder — only their position in the graph changes).
- **Bypass is a real routing bypass**: a disabled effect's Tone node is built and kept
  parameter-current (so re-enabling it doesn't jump), but it is not spliced into the spine at all
  — the audio genuinely does not pass through it. This is necessary, not just nicer, for `eq3`,
  which has no wet/dry knob of its own; wet=0 wouldn't bypass it.
- `applyParams()`/`disposeChain()` updated to iterate the dynamic effect list; LFO and clip
  automation destinations that target `eqLow`/`compMix`/`distortionMix`/`bitcrushMix` now look up
  the live effect instance by TYPE (`findEffect`) and no-op if that type isn't currently in the
  track's chain (nothing to modulate) — unchanged behavior otherwise.
- Drum-track bus wiring (`getDrumBus`, `wireInsertChain`) is untouched — sibling stream AB owns
  drum tracks/kits, and drum tracks never carry `effect` lines in the format (see above).

**GUI** (`ui/src/components/SynthPanel.tsx`, `ui/src/styles.css`, `ui/src/types.ts`):
- A new "Effect Chain" panel above the knob groups, synth tracks only: one row per effect
  (type label, id, drag handle, ▲/▼ move buttons, bypass checkbox, remove button), an add-effect
  type picker + button.
- Reordering supports real HTML5 drag-and-drop (the task's literal ask) **and** ▲/▼ buttons on
  every row — both call the same `postEffectMove`. The buttons exist for accessibility and
  because they're a far more reliable hook for automated verification than simulating native drag
  events; real users get genuine drag as the primary gesture.
- Bypass toggles the underlying `enabled` flag via a real routing change in the engine (documented
  above), not a mix-knob-to-zero shortcut — the checkbox reflects the document's own `enabled`
  field.

**CLI/MCP/daemon**:
- CLI: `beat effect-add <file> <track> <type> [--id] [--index] [--bypassed]`, `beat effect-rm`,
  `beat effect-move`, `beat effect-bypass`.
- MCP: `beat_effect_add`, `beat_effect_rm`, `beat_effect_move`, `beat_effect_bypass`.
- Daemon: `POST /effect-add`, `/effect-remove`, `/effect-move`, `/effect-enabled` — same
  full-document-return convention as `/add-track`/`/remove-track` (the daemon never SSE-echoes its
  own writes, so the GUI applies the response directly).

## Verification

- **`npm test`**: 314/314 passing (up from the session-start baseline; `test/format-v10-effects.test.ts`
  is new — migration, elision, reorder/add/remove/bypass round-trips, diff entries, `beat set`
  path). No existing test needed behavior changes, only shape updates (`effects: []` /
  `defaultEffectChain()` added to a few hand-built `BeatTrack` fixtures, and two format-version
  string literals bumped from `0.9` to `0.10`).
- **`ui/verify-phase22-stream-aa.mjs`** (new, follows `ui/verify-phase20-tracks.mjs`'s pattern: a
  real `beat daemon` + the real built frontend in headless Chromium, driven via `page.click`):
  - **AA1 add** — file goes from 0 effect lines to 5 (the default 4 plus a new `eq3_2`), git diff
    adds exactly those 5 lines, GUI shows the new row appended last.
  - **AA2 reorder** — moving `bitcrush` up one position changes **exactly 2 lines** in a real git
    diff (the swapped pair) — the "small, local diff" property, measured, not assumed.
  - **AA3 bypass** — unchecks the GUI checkbox, confirms the file line gains ` bypassed`, confirms
    the store's document reflects it, **then records real audio** (`window.__engine.recordWav`)
    with an intentionally extreme setting (`bitcrushBits=1`, `bitcrushMix=1`) both bypassed and
    not, and analyzes both takes with `src/metrics`' `analyze()` (the same BS.1770-verified tool
    every prior engine-verification stream in this project uses). Measured: crest factor swings
    7.57 dB → 5.94 dB (Δ1.63 dB), spectral centroid 522 Hz → 209 Hz, confirming the bypass is a
    real routing change and not a checkbox that merely looks right.
  - **AA4 remove** — the added `eq3_2` line disappears from both the GUI and the file.
  - All four steps pass against the real `beat daemon`, the real built `ui/dist`, and a real git
    repo (matching the "verify real audio/file behavior" bar the task set).

## Files touched

Core: `src/core/document.ts`, `parse.ts`, `serialize.ts`, `edit.ts`, `diff.ts`, `inspect.ts`,
`convert.ts`, `index.ts`. Engine: `ui/src/audio/engine.ts`, `ui/src/types.ts`. GUI:
`ui/src/components/SynthPanel.tsx`, `ui/src/daemon/bridge.ts`, `ui/src/styles.css`. CLI:
`cli/beat.mjs`. MCP: `src/mcp/server.ts`. Daemon: `src/daemon/daemon.ts`. Tests:
`test/format-v10-effects.test.ts` (new), `test/roundtrip.test.ts`, `test/format-v07.test.ts`,
`test/diff.test.ts` (shape/version-literal updates only). Docs: `docs/format-spec.md`,
`scripts/roadmap-data.mjs`, `docs/product-roadmap.md` (regenerated), this file. Verify script:
`ui/verify-phase22-stream-aa.mjs` (new).
