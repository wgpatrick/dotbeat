# Phase 5 build plan — the format learns to sound good (v0.3)

> **STATUS: in progress (started 2026-07-10).** Direct response to the owner's verdict on the
> first agent-composed track ("sorta shitty video game music") and the A/B experiment that
> diagnosed it: same notes with full-engine patches measurably and audibly better — but every
> improvement used parameters the `.beat` format cannot express. The sound-quality ceiling is
> the format's *reach*, not the engine.

## The evidence this responds to

- "Night Shift" v1 used the format's 9-parameter synth blocks — literally init patches.
- v3 (identical notes, store-level side channel): 5-voice unison supersaw pads, sub+octave
  bass with sidechain duck, shaped drum voices, reverb/delay sends → mids 19→25%, top-end ×3,
  stereo width +3.4 dB, and an audibly more produced result. None of it expressible in v0.2.
- The owner's diagnosis points at presets/samples/importable synths; the deep-research pass on
  that strategy is in flight (will land as `research/07`). **This phase builds the mechanism
  that any of those strategies needs: parameter reach + named patches.** Content (which
  presets, which samples) follows the research; the plumbing shouldn't wait for it.

## Design decisions

1. **Field table, not field code.** `SYNTH_FIELDS` in `document.ts`: every field with its kind
   (`number` | `enum` | `bool` | `trackref`), canonical default, and allowed values. Parser,
   serializer, `beat set`, semantic diff, and the converter all become table-driven — adding a
   field later is one table row.
2. **Canonical elision.** The original 9 params stay required (v0.2 files remain valid). The
   ~46 new fields serialize **iff ≠ default** and parse missing-as-default. This preserves the
   Humdrum one-canonical-form discipline (the elision rule is deterministic both ways), keeps
   files hand-editable (an init patch stays 9 lines, v3's supersaw pad is ~9+12), and keeps
   every param change a one-line diff.
3. **Format-level defaults are frozen copies of beatlab's `DEFAULT_SYNTH`** at freeze time,
   documented in the spec — the same importing-side contract as ever, now with the format
   carrying its own default table so `.beat` semantics don't drift if beatlab's defaults move.
4. **Presets are tooling + content, NOT grammar.** `beat preset <file> <track> <name>` applies a
   named parameter bundle from a repo-shipped library (`presets/factory.json`) as ordinary
   edits — the file stays literal data (D1), diffs stay honest (you see exactly what the preset
   set), and no canonical-form ambiguity enters the grammar. Seed library = the patches that
   made v3 sound good; the research pass refills it properly.
5. **Excluded from v0.3, deliberately** (each needs grammar design of its own): wavetable
   custom frames + LFO step arrays (large arrays), `insertOrder` (list), arp trio, LFO sync
   pairs (redundant with Hz rates for now). Documented in the spec's deferred list.

## The pieces

| # | What | Where |
|---|---|---|
| 5.1 | `SYNTH_FIELDS` table (~55 fields: layers, filter env, LFOs, inserts, sends, duck, glide, drum voices) with kinds/defaults/values | `src/core/document.ts` |
| 5.2 | Table-driven parse/serialize with canonical elision; `duckSource` as trackref (`none` = off, must reference an existing track) | `src/core/{parse,serialize}.ts` |
| 5.3 | Table-driven `beat set` (+ enum/bool/trackref validation) and semantic diff over the full field set | `src/core/{edit,diff}.ts` |
| 5.4 | Converter carries the full set; `droppedSynthParams` shrinks to the deliberate-exclusion list; fixture tests updated to assert the new exact loss set | `src/core/convert.ts`, tests |
| 5.5 | Preset op: `presets/factory.json` (seeded from the v3 patches), `beat presets` / `beat preset` CLI + `beat_preset` MCP tool, applied-as-edit-list | `presets/`, `cli/beat.mjs`, `src/mcp/server.ts` |
| 5.6 | Exit test, run for real: `examples/night-shift.beat` written with v0.3 params carrying the FULL v3 sound — offline render of the text file alone metric-matches the v3 store-overlay render | `examples/`, verification run |

## Exit criteria

- [x] A `.beat` file, alone, can express the v3 sound: render(`examples/night-shift.beat`)
      metric-matches the v3 side-channel render (see Result for the tolerance revision).
- [x] v0.2 files parse unchanged; an init-patch track still serializes to 9 synth lines.
- [x] One preset application = one readable edit-list, and the result round-trips.

## Sequencing

5.1 → 5.2 → 5.3/5.4 (parallel) → 5.5 → 5.6.

## Result (2026-07-10)

Shipped, all exit criteria met — 97/97 tests green, `scripts/verify-phase5.mjs` all checks pass.

- **The field table is the whole implementation.** `SYNTH_FIELDS` (~46 optional rows +
  the required core 9) drives parse, serialize, `beat set`, semantic diff, and both converter
  directions. Adding a future field is one table row plus one `BeatSynth` type line — every
  layer picks it up, including validation and canonical elision.
- **`examples/night-shift.beat` was built entirely with the new tooling** — four
  `beat preset` applications (`driving-kit`, `deep-sub-bass`, `lush-pad`, `bright-lead`, all
  seeded from the v3 patches) plus five `beat set` edits for the per-project bits (bass cutoff
  back to 550, duck routing to `drums`). The resulting file is 4 tracks / ~60 sound-bearing
  lines, and every non-default line in it is a deliberate, named sound decision.
- **Exit test, revised to be honest about what can be exact** (`scripts/verify-phase5.mjs`):
  - *State equivalence (exact):* store state built via the legacy pathway (core-9 partials +
    the literal v3 `setSynth` overlay) vs. one `applyDawState` from the parsed v0.3 file —
    every track's full ~74-field SynthParams deep-equal. This is the real claim, and it's
    bit-exact.
  - *Audio sanity (tolerant):* render metrics vs. the archived v3 wav — LUFS −17.14 vs −17.02,
    all bands within 3 pts, width within 1.2 dB.
  - The plan's original ±0.5 LU / ±3 pt / ±2 dB audio tolerances turned out to be tighter than
    the renderer itself: **the offline renderer is measurably nondeterministic run-to-run**
    (same file, two renders: ~0.4 LU, ~4 band points, ~2 dB width apart — the JS event loop
    races the render thread, so Tone's scheduled event times quantize onto different render
    quanta each run, changing phase relationships between detuned/unison voices). Even the
    original v3 two-step script no longer reproduces its own archived wav. Audio tolerances are
    therefore set to ~1.5× the observed variance envelope (±0.75 LU / ±6 pt / ±4 dB), with the
    exactness moved to the state check, where exactness is real. Filed as a known issue worth
    upstream investigation — single-render metrics carry ~±2-4 pt band jitter, which matters
    for tight lint thresholds and for the variation-loop idea (`docs/variation-loop.md`).
- **Preset apply is one code path.** `applyPreset` walks the params in canonical order and
  calls `setValue` per param — the same validation, the same edit-list output, the same diff
  as hand edits. Factory presets are validated against the live field table at test time
  (tripwire if a field is ever renamed), and trackref params are rejected in preset libraries
  by construction.
- v0.2 compatibility is structural: the parser treats missing optional fields as defaults and
  preserves the declared `format_version`, so v0.2 files round-trip byte-identically.
