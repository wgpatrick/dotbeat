# Production tricks (`beat trick`)

*The system doc. For the per-trick cards, see the generated `docs/tricks-reference.md`; for the
design rationale, `docs/research/118-production-bag-of-tricks.md` (the operational half of
`docs/research/115-production-layer-techniques.md`).*

## Why this exists

The blind source-showdown eval found dotbeat's synth loses to commercial chops on production
**richness**, not cleanliness: the engine renders literally mono (stereo width ≈ -52 dB vs ≈ -11 dB
for real records), near-zero air-band energy, and the lowest production-complexity scores. The
format already owns all the DSP — unison, chorus, width, sends, auto-pan, LFOs, sidechain duck —
and `src/analysis/produce.ts` (produced-defaults) applies a role-aware baseline at generation time.
Tricks are the rung above that: a validated catalog of named production **moves** an agent (or a
person) pulls from mid-task, against a project that generation or hand-editing left mono/dry/static.

## The ladder

dotbeat already had two lower rungs and the house discipline for both (tooling-not-grammar, D9 —
resolve to literal `set` lines, validate eagerly against the live `SYNTH_FIELDS`/
`AUTOMATABLE_SYNTH_PARAMS` tables):

| rung | what it is | where |
|---|---|---|
| **preset** | a bag of `set` edits, no conditions | `src/core/preset.ts`, `presets/presets.json` |
| **macro** | a knob resolved to N `set` edits, kind-checked | `src/core/macro.ts`, `presets/macros.json` |
| **trick** | a preset **with preconditions and a receipt** | `src/analysis/trick.ts`, `presets/tricks.json` |

A trick adds exactly three things over a macro:

1. **Machine-readable preconditions** (`when`) over the metric vector the eval loop already computes
   (`FEATURE_KEYS`: `stereoWidthDb`, `bandAirPct`, `crestDb`, …) AND over document state
   (`unisonVoices == 1`, `sendReverb == 0`, song mode, per-lane hit count) — so "this track is mono
   and shouldn't be" is a computable fact, not vibes.
2. **A multi-verb recipe** — not just `set`, but also `effect-add`, `macro`, `automate`, and drum
   `addHits`. Every step resolves through an **existing edit primitive**; the file afterwards
   contains only ordinary lines. The trick engine composes, it never invents grammar.
3. **A declared metric delta** (`expect`) — which metrics should move, which direction, roughly how
   much. The verification contract for a future `beat trick verify` (render → apply → re-render →
   assert) and for research 119's blind production-transform eval. Carried in the catalog now;
   the CI render loop is v2.

## Anatomy of a trick

Every entry in `presets/tricks.json` carries: `name` (slug), `axis` (width/air/motion/glue — the
four measured gaps), `slots` (a `track` with a kind + optional role allow/deny list, optionally a
`clip`, optionally numeric knobs), `when` (precondition clauses), `recipe` (ordered steps), `expect`
(declared delta), `counter` (counter-indications — prose the agent reads, some with a
machine-readable clause that blocks apply), and a sourced `why` (the research citation + confidence
label that keeps the catalog auditable).

### The recipe vocabulary (closed)

| step | resolves through | example |
|---|---|---|
| `set` | `setValue` (same path grammar as `beat set`) | `{ "set": "$track.unisonVoices", "value": 5 }` |
| `effectAdd` | `addEffect` (no-op with a note if already present) | `{ "effectAdd": "$track", "type": "utility" }` |
| `macro` | `applyMacro` from `presets/macros.json` | `{ "macro": "filter-sweep", "track": "$track", "knob": 70 }` |
| `automate` | `setAutomationPoint` (needs a `$clip` slot) | `{ "automate": "$track.cutoff", "clip": "$clip", "points": [[0, 400], ["$clipEndStep", 4500]] }` |
| `addHits` | `addHit` (drum-lane tricks) | `{ "addHits": "$track", "lane": "openhat", "steps": "offbeat-8ths", "velocity": 0.5 }` |

The expression language is deliberately tiny: `$track`, `$clip`, knob-slot references (`"$width"` in
a value), and the automation time tokens `$clipStart` / `$clipEndStep` / `$phraseEndStep`. The
moment a recipe needs real logic ("pick the brightest hat sample"), it is not a trick — it is
gen-kit code. Staying declarative is what keeps the catalog validatable.

## Verifiability is the design center — eager validation

A trick is only in the catalog if applying it moves a number the eval loop measures. Enforcement,
cheapest first:

1. **Parse-time (the drift guard).** `parseTrickLibrary` checks **every** field/effect/param/macro/
   lane a trick names against the LIVE format vocabulary — `SYNTH_FIELDS` for `set` paths and value
   kinds, `EFFECT_TYPES` for `effectAdd`, `AUTOMATABLE_SYNTH_PARAMS` for `automate`, the parsed
   macro library for `macro`, the 12-lane kit set for `addHits`, `FEATURE_KEYS` for every metric
   clause. This is `test/trick.test.ts`'s first contract and it runs in the ordinary suite, so a
   `SYNTH_FIELDS` rename **cannot land** without touching the catalog — the same eager-validation
   posture as `showdownRole()`'s `genSubject` calls ("so a drifted prompt bank fails at spec time,
   not mid-run") and `parseMacroLibrary`'s structural checks.
2. **Apply-time.** `setValue`'s own per-value validation, plus the trick's slot-kind check (a drums
   trick on a synth track throws) and precondition evaluation.
3. **Render-time (v2).** `beat trick verify` — render a seed project, apply, re-render, assert every
   `expect` direction. Deferred to v2 with research 119's eval.

## Preconditions are advisory; counter-indications refuse

Two deliberate stances (research 118 §3.2):

- **`when` preconditions are advisory gates.** `beat trick apply` *warns* (and proceeds) when a
  `when` clause fails or can't be checked — the agent may know context the metrics don't (a
  deliberately mono lo-fi aesthetic). Where preconditions earn their keep is `beat trick suggest`,
  which only proposes tricks whose preconditions **pass**.
- **Counter-indications refuse.** A hard **kind** mismatch always throws (structural — the recipe
  can't resolve). A **role** violation (the "never widen a sub bass" guard) and any true
  machine-readable `counter` clause **refuse** unless `--force`.

## The CLI

```
beat trick list [--json] [--axis width|air|motion|glue]   the catalog, one line per trick
beat trick show <name>                                    the full card: when/recipe/expect/counter/why
beat trick apply <file> <track> <name> [--clip c] [--knob k] [--force] [--dry-run]
beat trick suggest <file> [<track>] [--json]              rank the tricks whose preconditions pass
```

- `apply` resolves the recipe to ordinary edits and prints the **honest applied list** (the same
  edit-list receipt `beat macro apply` gives). `--dry-run` previews without writing. It refuses on
  counter-indications unless `--force`, and warns (never blocks) on failed `when` preconditions.
- `suggest` **renders nothing itself**: it reads a sibling `<file>.wav` render for metrics when one
  sits next to the `.beat` (the cached/derivable path), else evaluates document-state preconditions
  only, marking metric-gated tricks *"needs a render to confirm."* It ranks the passing tricks by
  gap distance, **width first** (the measured showdown ordering, 115 §6). This is the same shape as
  `beat lint --ref`: measured state vs a target profile, suggestions not auto-edits.

## The generated reference

`docs/tricks-reference.md` is **generated** from `presets/tricks.json` by
`scripts/gen-tricks-reference.mjs` (`npm run build && node scripts/gen-tricks-reference.mjs`) — never
hand-edited, so it cannot drift from the validated library. This is the same
`scripts/roadmap-data.mjs → docs/product-roadmap.md` pattern, applied to production knowledge: the
library is the single source of truth, the doc is its human-readable projection.

## Relationship to produced-defaults

`src/analysis/produce.ts` applies a role-aware production baseline at **creation** time (every
gen-kit output and taste seed ships produced instead of dry/mono/static). `beat trick suggest`
catches what generation and hand-editing left mono/dry/static **afterwards**. Where they overlap
(width via unison/chorus/utility, air via shelf, glue via saturation) the trick recipes deliberately
mirror produce.ts's intensities rather than re-deriving them.
