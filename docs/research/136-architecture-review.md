# 136 — Architecture review: is the shape right?

*A level above research/130. That review measured duplication and file-size structure and
produced the four-wave consolidation plan; this one asks whether the ARCHITECTURE those waves are
consolidating toward is the right one. Written 2026-07-26 against `bf263cc1` (post-wave-0/1
merges), on branch `arch-readme`. Every import edge, line count, and code claim below was
measured directly this session unless cited to research/130; judgments are marked as judgments.*

**Headline: the architecture is right in its bones — a pure core, a text file as the source of
truth, surfaces around it — and wrong in three specific, fixable ways: the middle layers form
cycles instead of a stack (§1), no single artifact owns "an operation" so four surfaces
re-describe every verb (§2, the worst structural problem), and the GUI still speaks a shadow
dialect of the format instead of the format (§3). A fourth issue is directional rather than
broken: the taste program has quietly become a second product whose tendrils reach INTO the DAW,
and the import direction should be reversed before it calcifies (§4).**

---

## 1. Layering: the intended stack vs the measured one

Intended (README/architecture.md): `core` (pure) → `metrics`/`analysis` → `vary`/`taste` →
surfaces (`cli`/`mcp`/`daemon`/`ui`). Measured import matrix (`grep` over `src/*/`, this
session — arrows point at the imported module):

| module | imports from | verdict |
|---|---|---|
| `core` | *(nothing internal)* | **pure — the crown jewel holds** |
| `history` | core | clean |
| `telemetry` | core | clean |
| `match` | core, metrics, analysis | clean (downward only) |
| `metrics` | **analysis** (1 edge) | **inversion** |
| `analysis` | core, metrics, **taste** (4 edges) | **cycle with taste** |
| `vary` | core, metrics, **taste** (1 edge) | **cycle with taste** |
| `taste` | core, metrics, analysis (7), vary (8) | hub — imports everything |
| `mcp`, `daemon`, `board` | downward only | clean surfaces |

The good news first: the known inversion the review was asked about — *metrics imports from
vary/batch* — **no longer exists**; W1.3/W2.6-adjacent work already broke it (today
`vary/batch.ts` imports `metrics`, the right direction). What remains is three knots, each with a
specific, small cut:

1. **`metrics → analysis`**: `src/metrics/roughness.ts:13` imports the sidecar scaffold from
   `src/analysis/spawn-sidecar.ts`. The scaffold is *infrastructure*, not analysis — it sits at
   the wrong altitude. Move it to `src/sidecar/` (or `src/infra/`), below both. One-file move,
   eight import-line edits, zero behavior change.
2. **`analysis ↔ taste`**: `analysis/genkit.ts:21` imports `mulberry32` from `taste/eval.js` —
   a **stale edge**: `src/core/rng.ts` is now the sanctioned home (W1.2) and eval merely
   re-exports. Same file imports `stylePromptsFor` from `taste/seeds` (the prompt bank —
   arguably *data*, not taste logic); `analysis/surge.ts` imports `SurgePatch`/`SurgeNote`
   *types* from `taste/showdown` (they belong with the surge module that renders them);
   `analysis/trick.ts` imports `featuresForAudioFile` from `taste/features`. Fixes: retarget
   genkit's rng import (5 minutes); move the type declarations to `analysis/surge.ts` and have
   showdown import them (type-only, safe); move `features.ts` — a DSP feature-vector extractor,
   i.e. *measurement* — into `metrics/`, where `vary/batch.ts`'s one taste-import
   (`computeBatchFeatures`) also stops being an inversion.
3. **`vary ↔ taste`**: `taste/*` importing `vary` (manifest type, `BeatBatchError`,
   `varyTrack`, `shuffledOrder`) is fine — taste sits above vary. The single reverse edge is the
   `features.js` import above; the `features → metrics` move dissolves this cycle too.

One straggler: `src/vary/vary.ts:254` still carries its **own private `mulberry32`** with the
old comment, despite `src/core/rng.ts` existing and being guarded by cross-copy equality tests.
Harmless today (the equality test pins it), but it is exactly the "copy that outlives the
consolidation" pattern research/130 documented; retarget it.

**Logic at the wrong altitude** (confirming and extending 130-T6):

- `cli/beat.mjs` (6,135 lines, 89 dispatch cases) holds the taste program's *policy*: the
  blinding/fairness contract, figure-source precedence, BPM-conform tree, ref-audibility retry —
  untestable without spawning the CLI. (130's W2.5/W3.3 already own this; nothing new to add
  except urgency: this is the only place where *science policy* lives in *presentation code*.)
- `src/daemon/daemon.ts` (2,641 lines) holds ~665 lines of pure arrangement domain logic that
  its own header says belongs in core (130 R5-F5).
- `cli/render.mjs` (762 lines) is the render *orchestrator* — harness boot, batch loop,
  fallback policy — living in the CLI layer, which is why MCP's `beat_render` literally spawns
  `node cli/render.mjs` as a subprocess (`src/mcp/server.ts:1989`). One surface shelling out to
  another surface's script is the clearest single symptom that a `src/render/` orchestration
  module is missing. It works, and the comment explains why (Chromium), but the *policy* (batch
  loop, offline-vs-live fallback, normalization re-application) should be importable, with the
  Chromium spawn as its one impure edge.

**Verdict:** the layering is ~85% honest and the dishonest 15% is four small, mechanical cuts
plus two extractions research/130 already plans. This is a weekend of work, not a rearchitecture
— but do it *before* wave 2's big splits, because every split that lands inside today's cycles
inherits them.

---

## 2. The four-surface problem: the case for an operations layer

The measured surface area: **89** CLI dispatch cases (`cli/beat.mjs`), **71** MCP tools
(`src/mcp/server.ts`, 2,465 lines), **~39** daemon HTTP routes (`daemon.ts`), and the GUI bridge
(`ui/src/daemon/bridge.ts`, 1,125 lines including a ~250-line local mirror of `setValue`).
Execution is genuinely shared — all four call the same core functions. What is quadruplicated is
everything *around* execution: the operation's **name**, **arg decoding**, **validation**,
**defaults**, **documentation**, and **result shaping**.

The canonical live specimen, verified this session (`cli/beat.mjs:4897-4906` vs
`src/mcp/server.ts:822-834`):

```
CLI     beat effect-bypass <file> <track> <id> <true|false>   true  = BYPASSED (silenced)
MCP     beat_effect_bypass {enabled: boolean}                 true  = ENABLED
daemon  POST /effect-enabled                                  a third name for the same verb
core    setEffectEnabled(doc, track, id, enabled)             the one real implementation
```

Same operation, three names, two boolean polarities, and the CLI handler now carries a comment
explaining the inversion — comment discipline doing structure's job again, one layer up from
where research/130 found it. W0.8's tests pin this so it can't silently *drift further*, but
nothing prevents the next verb from being born the same way.

Doc 130's endgame (W3.1/W3.2) generates MCP schemas from CLI arg specs. The stronger version —
which I recommend — is an **operation record** as the unit of architecture, with all four
surfaces (not just CLI/MCP) as bindings:

```ts
// src/ops/effects.ts — sketch, not a spec
export const setEffectEnabled = defineOp({
  name: 'effect.setEnabled',              // ONE canonical name
  args: {
    file:    arg.beatFile(),
    track:   arg.trackId(),
    effectId:arg.effectId(),
    enabled: arg.boolean({ doc: 'true = the insert runs; false = wired out of the graph' }),
  },
  run: ({ doc, args }) => coreSetEffectEnabled(doc, args.track, args.effectId, args.enabled),
  describe: 'Bypass or re-enable one insert (real routing bypass, not a mix-knob zero).',
  surfaces: {
    cli:    { verb: 'effect-bypass', map: (a) => ({ ...a, enabled: a.state === 'false' }),
              deprecate: 'state means bypassed; prefer --enabled' },   // honest legacy shim
    mcp:    { tool: 'beat_effect_bypass' },        // schema + description GENERATED from args
    daemon: { route: 'POST /effect-enabled' },      // handler generated; session concerns stay in daemon
    gui:    'via daemon',                           // bridge posts the op name, no local re-parse
  },
})
```

Run against three real operations:

1. **`effect.setEnabled`** (above) — the smallest possible proof, and W3.1 already nominates the
   effects family first. The op record *is* the R5-F3 fix: the polarity inversion becomes a
   declared, deprecated CLI-binding quirk instead of a live semantic trap.
2. **`set`** — the biggest win. `setValue`'s path grammar becomes the op's arg validator via the
   W3.2 path-grammar table; `PATHS_NOTE` (currently a hand-maintained help string at
   `cli/beat.mjs:144`, two-thirds incomplete per 130 R2-F0b), the `beat_set` MCP description, and
   the GUI bridge's mirror all become *renderings of or imports from* that table. Three
   documented drift sites collapse into one artifact.
3. **`vary`** — the pattern is already half-proven here: `runVaryBatch` (`src/vary/run.ts`, 150
   lines) is the op *body*, imported by both `cli/beat.mjs:3511` and `src/mcp/server.ts:2082`
   since W1.3. What's missing is only the declarative arg spec (count/amount/seed/spread/
   exclude/normalize…) so the CLI flag parsing and the `beat_vary` JSON schema derive from one
   table. Vary is therefore the cheapest *full-stack* pilot: body done, spec next.

**Honest costs and breakage:**

- **The MCP descriptions are load-bearing prose.** The 71 tool descriptions are long,
  pedagogical, and tuned to agent behavior (the `beat_add_track` description alone is ~350
  words of accumulated pilot findings). Generating them naively from one `describe` string would
  destroy real value. The design must allow per-surface description *overrides* layered on the
  generated skeleton — generate the schema (args, types, required), hand-write the pedagogy.
- **CLI output is UX.** Result shaping must stay per-surface (human text vs JSON-RPC result vs
  SSE); the op returns a structured result (the `DiffEntry` list is already the house
  changeset, D8) and each binding renders it. Don't unify the *text*.
- **Daemon session concerns don't move.** Undo coalescing, gesture IDs, SSE fan-out, echo
  suppression are session-layer, above ops. The op is what a route *calls*, not what it *is*.
- **Migration is ~89 commands.** Family-by-family or it will never finish; the W0.9 parity
  harness and W0.2 surface test are the safety net and both now exist. Realistic cost: S per
  family after the first (effects) proves the `defineOp` shape; the first one is M-L because it
  builds the framework. Total: the largest single investment this review recommends.
- **What breaks:** the CLI usage golden regenerates per family (already routine); any script
  scraping exact CLI error strings; the `==== Phase N Stream X ====` merge-fence workflow
  (dispatch moves to per-family files — 130 W2.5 already plans this and says delete the fences).

**Verdict:** yes — a coherent ops layer exists and is the right endgame; doc 130's W3.1+W3.2
are its skeleton and should be treated as one program, with two amendments: (a) scope it to all
FOUR surfaces (daemon routes and the GUI bridge consume the same records — 130 framed it mostly
as CLI↔MCP), and (b) adopt canonical op *names* now, because the naming drift
(`effect-bypass` / `/effect-enabled` / `beat_effect_bypass`) is itself a bug factory no schema
generation fixes.

---

## 3. The `.beat` format as the API — where the abstraction leaks

The thesis is "the text document is the only contract." Measured leaks, worst first:

1. **`ui/src/daemon/bridge.ts` — a shadow `setValue`.** `applyLocalEdit` (~250 lines) is a
   hand-mirrored interpreter of the path grammar, self-described in its own comments as
   replicating "core's setValue GRAMMAR but not its VALIDATION" (line 248). Unknown paths return
   `null` and silently wait for the SSE re-pull — optimistic-UI correctness rests on a mirror
   nothing drift-tests (130 R6-4).
2. **`ui/src/components/synthParams.ts` — a 566-line fork of `SYNTH_FIELDS`** with its own
   legality gate: the D9 single-table principle breached by its own GUI (130 T1).
3. **`ui/src/types.ts` — 422 lines re-declaring the document model.** Every format change is a
   two-place change; one mirror (audio-region timeline math) has already forked (130 R6).
4. **The daemon protocol is a second grammar.** ~39 JSON routes, most of which (`/effect-add`,
   `/automate`, `/lane`, `/clip-move`, …) are re-encodings of edits the format's own path/verb
   vocabulary already expresses. The GUI never touches `.beat` text at all — it speaks
   route-JSON in, document-JSON out. The format is the contract *between daemon and disk*, not
   between daemon and GUI.
5. **Engine coercion tables** (`ui/src/audio/engine.ts`, 4,320 lines) mirror core defaults "in
   sync by inspection" (130 R6's headline quote).

None of these is hypothetical debt — 130's register ties each mirror class to a shipped bug.

**"The format is the only contract," fully realized:**

- **Core runs in the browser.** `setValue`, `SYNTH_FIELDS`, the document types, and the parser
  are pure TS with no node dependencies at the leaf level; R6-13 established the "standalone
  Vite app" blocker is one line of config. The end state: `applyLocalEdit` is *deleted* and the
  bridge calls the real `setValue` for optimistic updates (same input, same output as the daemon
  will produce — echo suppression already compares canonical text, so agreement is verifiable);
  `synthParams.ts` and `types.ts` become imports. This goes one step beyond 130's W2.7/W3.2
  (which import leaves and add drift tests): import the *interpreter itself*, and the drift
  class isn't tested against — it's gone. ~1,500 LOC of the most dangerous mirrors deleted.
- **Edits travel as the format's own vocabulary.** The daemon keeps its session routes (undo,
  selection, focus, events, history) but the ~25 edit-shaped routes collapse onto the ops layer
  (§2) — most of them onto plain `{path, value}` `/edit`, which already exists and already
  produces the one-line-diff guarantee. Target: ~12 session routes + `/op` + `/edit`.
- **The document travels canonically.** Today `GET /document` ships JSON. A stricter reading of
  the thesis ships canonical `.beat` text (+ parsed form for convenience), making "what the GUI
  has" and "what git sees" byte-comparable at any moment. Cheap to add, high diagnostic value.

**Cost/risk:** bundle discipline is the real one — `macro.ts → edit.js` style imports would drag
node-only core into the browser (130's own warning); the sanctioned isomorphic barrel (W2.7) is
the gate. Migration is M-sized and GUI-testable with the existing verify fleet. The payoff is
qualitative: the GUI stops being the one surface whose edits are *believed* rather than
*validated*.

---

## 4. The eval/taste subsystem: a second product living inside the DAW

Scale check: `src/taste` is 6.7k lines (vs `src/core` 8.3k); add `src/vary`, `src/board`,
`cli/{rate,board,match}.mjs` (869 lines), the taste families inside `beat.mjs`, four Python
sidecars, `taste-data/`, and the private datasets outside the repo. Its users are the owner and
the agent (deliberately not MCP-exposed); its interface is CLI + two localhost web UIs; its
change control is scientific (frozen `===`-guarded constants, blind/non-blind log separation,
D24-D27, rating-round scheduling gates from 130 §5). That is research infrastructure with a
different clock, different users, and different invariants than the DAW.

**Should it be separated? Repo/package split: no** — solo project, shared engine and render
harness, and a split would tax the daily loop for governance nobody needs yet. **Boundary
formalization: yes, now.** The concrete rule:

> **The DAW may not import the taste program. The taste program consumes the DAW through four
> named interfaces:** (1) document construction/edit (`core`), (2) the batch render harness,
> (3) metrics/features, (4) the vary batch contract (manifest / score / adopt).

Today that rule is violated in exactly the four places §1 measured (`genkit`, `trick`, `surge`
types, `vary/batch → features`) — every one already has a home on the DAW side of the line
identified above, so honoring the rule costs only those moves. Enforce it the way this codebase
already enforces such things: a cheap import-boundary test (grep-shaped, like the
verify-manifest test) asserting `src/{core,metrics,analysis,vary,daemon,mcp}` and `ui/` never
import `src/taste`.

**What it buys:** (1) the §1 cycles dissolve as a side effect; (2) eval-integrity gating stops
taxing the whole repo — 130 §5.2 gates *any* taste-layer move on rating-round scheduling, and
today's tendrils spread that gate into `analysis` and `vary`; with the boundary, DAW refactors
never need the taste gate; (3) the taste program can grow fast (T5 overnight pilots, new figure
sources, bigger training) with a compiler-checked blast radius; (4) if it ever *should* become a
separate package — plausible: it's the part with independent research value — the extraction
becomes an afternoon. The cost is near zero because the moves are the same ones §1 wants for
layering honesty. This is the highest leverage-per-risk item in this review.

---

## 5. Extension points: N files today, and the registry that makes it 1-2

| Extension | N today (measured) | What the N is | Proposed seam | N after |
|---|---|---|---|---|
| New sound source (track kind) | **~15** non-test files for `surge` (core: document/parse/serialize/edit/diff; analysis: surge/produce/spawn; cli: beat/render/surge-render-prep; plus taste hooks, metrics/ring, telemetry) | grammar arms, render-prep hook, help, curation | `SoundSource` registry: `{kind, parseBlock, serializeBlock, editPaths, prepareRender(doc), describe}` — surge's cache-or-sidecar-before-engine-boot is already the shape; formalize it | **2-3** (module + registry row + tests) — but only *after* W2.1/W3.2 give core its table-driven grammar; before that the core arms are irreducible |
| New gen provider | **2** (`PROVIDER_ADAPTERS` entry in `src/analysis/gen-fal.ts` + tests) | one adapter object with an injectable transport | **already solved** — this table is the house's best registry and the template for the rest (130 §4.3 agrees: leave alone) | 2 |
| New figure source | **~5** (own module; `showdown.ts` wiring; `beat.mjs` flag + glue; label-namespace registration; sidecar + wrapper if ML) — 130-T6's own count for D26's "obvious next lever" | selection, precedence, labels, CLI plumbing | W3.3's `FigureSource` interface + priority registry in one testable place; the I2b label-disjointness test (now green) is the hard gate | **2** |
| New metric / screen / feature | lint rule: 2; pathology screen: **~4** (`screens.ts` + thresholds + feedback wiring + help); taste `FEATURE_KEY`: **~3** *and silently changes the critic* | compute fn, thresholds, schema, exposure | one `MetricDescriptor` registry `{key, compute, units, thresholds, sweepable, surfaces}` feeding lint/screens/features alike — prerequisite: W3.4's single finding schema; new FEATURE_KEYs additionally need the frozen-constants discipline (a key-set snapshot) | **1-2** |

The pattern worth naming: the codebase already *knows* the answer — `PROVIDER_ADAPTERS` is a
clean registry, `runVaryBatch` is a clean shared orchestrator — the work is applying its own
best inventions to the other three axes.

---

## 6. Ranked architectural moves

1. **Layering knots + the taste import boundary** (§1 + §4: move `spawn-sidecar` below
   metrics, `features.ts` into metrics, surge types into analysis, retarget two stale
   `mulberry32` imports; add the no-DAW-imports-taste boundary test).
   *Buys:* an honestly acyclic graph; eval-gating contained to `src/taste`; extraction option
   value. *Costs:* ~a day, mechanical, type-safe. *Risks:* near zero (pure moves; existing
   tests cover every touched module). *Doc 130:* ~half covered (W2.6 breaks metrics↔vary;
   the analysis↔taste knots, the boundary rule, and its test are NEW). **Do first — before
   wave 2's splits land inside today's cycles.**
2. **The ops layer, scoped to all four surfaces, effects family first** (§2).
   *Buys:* kills the whole hand-parity drift class — including the naming drift and the live
   `effect-bypass` polarity trap — at the root; MCP schemas, CLI flags, daemon handlers and
   help all derived per family. *Costs:* the framework (M-L) then S per family × ~11 families.
   *Risks:* flattening the load-bearing MCP prose (mitigate: generated schema + hand-written
   description overrides); CLI UX regressions (mitigate: W0.2 usage golden + W0.9 byte-parity,
   both landed). *Doc 130:* W3.1/W3.2 are the skeleton; the four-surface scope and canonical op
   names are this review's extension.
3. **Core-in-the-browser: delete the GUI's shadow grammar** (§3: real `setValue`,
   `SYNTH_FIELDS`, and document types imported via the isomorphic barrel; `applyLocalEdit` and
   `synthParams.ts` deleted).
   *Buys:* ~1.5k LOC of the most dangerous mirrors gone; GUI edits become validated, not
   believed; heals the D9 breach. *Costs:* M; bundle discipline. *Risks:* dragging node-only
   core into the bundle (the barrel is the gate); optimistic-update timing edge cases —
   verifiable because echo suppression already compares canonical text. *Doc 130:* W2.7/W3.2/
   W3.5 cover ~80%; importing the interpreter itself (not just leaves + drift tests) is the
   extension.
4. **`src/render/` orchestration module** (§1: lift `cli/render.mjs`'s batch/fallback/
   normalization policy into `src/`, leaving the CLI file as its thin driver; MCP stops
   shelling out to a sibling surface's script).
   *Buys:* render policy becomes testable and importable; the last surface-calls-surface edge
   gone. *Costs:* S-M. *Risks:* low — the Chromium spawn stays exactly as-is, only the code
   around it moves. *Doc 130:* not covered (its render items were W0.1 goldens and the W1.5
   verify tier).
5. **Daemon edit-route collapse onto ops** (§3: ~25 edit-shaped routes → `/op` + `/edit`;
   ~12 session routes remain).
   *Buys:* the daemon becomes what architecture.md says it is — transport + session, zero
   grammar knowledge. *Costs:* M, GUI migration per family. *Risks:* churn in a live surface —
   keep old routes as generated aliases for a release. *Doc 130:* W2.3's single `route()` is a
   step; the collapse itself is new. **Sequenced strictly after move 2.**
6. **`SoundSource` registry** (§5).
   *Buys:* the next engine (the roadmap's own Tier-3 Dexed/DX7 plan, or another out-of-process
   factory under D23) costs 2-3 files instead of surge's ~15. *Costs:* M, and only sensible
   after W2.1/W3.2 table-ize the core grammar. *Risks:* abstraction designed from n=2 (synth,
   surge) — mitigated by the fact that sampler/soundfont lanes make it effectively n≈4. *Doc
   130:* not covered.
7. **`MetricDescriptor` registry** (§5).
   *Buys:* new measurements in 1-2 files; `SCREEN_THRESHOLDS` sweepable in one place. *Costs:*
   S-M. *Risks:* touches critic inputs — needs the frozen-key-set snapshot and owner
   re-baseline per D27. *Doc 130:* extends W3.4; land with or after it.

*Not recommended:* a taste repo/package split (§4 — boundary yes, split no, revisit if the
program grows its own contributors); unifying result/output text across surfaces (§2 — the
prose is per-surface UX, only the structure unifies); any of this before wave 0/1's gates —
which, as of this branch, are merged and green.
