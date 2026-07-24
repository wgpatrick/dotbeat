# Engine preset curation & search — closing the engine's self-inflicted gap

*Plan drafted 2026-07-23 with the owner, immediately after the first D27 event
(`showdown-lead-76551`: produced engine, RANDOM seed patch, commercial figure — ranked above the
ref blind). Companion to docs/source-showdown-eval.md and docs/decisions.md D26/D27.*

## The evidence this plan rests on

Every engine clip ever blind-rated came from `generateSeedBeat`'s RANDOMLY ROLLED patches
(src/taste/seeds.ts synthBlock: random osc, random cutoff, random ADSR). The engine's historical
0-4% pairwise therefore measures "the engine playing dice," not the engine. Its competitors never
faced that handicap: surge arrived with 639 designed presets (then curated to the top quartile,
presets/surge-curated.json); gen is a trained model; refs are finished productions. Meanwhile the
repo has shipped `presets/factory.json` — 36 curated voicings in exactly the needed roles (6
bass, 5 lead, 5 pad, 4 pluck, 4 keys, 3 arp, 6 kits) — unused by the eval since the day showdown
was built. The one blind batch a dotbeat-rendered clip ever won, it won with a random patch: the
produced-engine ceiling is above everything measured so far.

## E0 — patch provenance in the log (S, immediate)

Engine/engineplus manifest `from` strings gain the patch source (`random-seed-patch` today;
`factory:<name>` / `curated:<id>` / `matched:<target>` later) so every future report can split
engine results by patch era. The same honesty mechanism as figure sources. No behavior change.

## E1 — factory presets into the eval (S, first build)

`beat showdown` engine clips draw a role-mapped factory preset instead of the seed's random
patch: bassline → category `bass`, chords → `pad`|`keys`, lead → `lead`|`pluck`|`arp`,
drum-loop → the kit presets (drum-kits.json). Seeded pick per batch, exclude-chained within a
run (the archetype-figure convention), preset name recorded per E0. engineplus inherits
automatically (it produces whatever patch the engine clip carries). Existing random-patch
behavior stays available (`--random-patches`) for era comparison.
**Gate:** one fal round; success = engine/engineplus pairwise lift over the era-split baseline
(engine ≈1%, engineplus ≈34-42%).

## E2 — the curated engine bank (M)

Port `scripts/curate-surge-patches.mjs` → `scripts/curate-engine-presets.mjs`:
- **Candidate pool:** all factory presets + ~2,000 seeded random rolls of the synth param space
  (sampling ranges from the musical bounds in src/vary/vary.ts VARY_GROUPS + seeds.ts, resonance
  capped at 0.85) + every E3 match-derived patch.
- **Probes/scoring:** identical to surge curation — per-role probe figures, offline engine
  renders in big single-boot batches (renderVaryBatch), gates (narrow-peak ring metric ported
  from scripts/debug-surge-ring.py, activeFraction ≥ 0.5), blend 0.45·z(CE+PQ) +
  0.30·z(criticPessimistic) + 0.15·z(ringHeadroom) + 0.10·z(activeFraction).
- **Output:** `presets/engine-curated.json`, top quartile per role, deterministic ordering.
- **Consumers:** showdown (E1 pick upgraded to the curated bank), taste-seeds (base patch drawn
  from the bank + seeded jitter — keeps byte-determinism per seed, keeps vary headroom), gen-kit
  synth roles, and the T5 pilot's initial population (mutation-space starts from good material —
  a plausible contributor to the failed scaling gate).
**Compute:** ~2k probe renders ≈ overnight-scale; cache outside the repo
(~/Documents/dotbeat/tools/engine-curation-cache), incremental re-runs.
**Gate:** blind round with curated picks; success = further lift over E1, and a T5 pilot re-run
from curated initial populations re-tests the scaling gate on better raw material.

## E3 — match-derived presets: T6 as a preset factory (M, partly blocked on pack refs)

`beat match`'s `best.beat` IS a preset. `scripts/harvest-match-presets.mjs` runs matches over the
role dirs of the ref pools — loved-track stable cuts (3 already exist in
taste-dataset/match-runs/), refs-cc0, and refs-packs when purchased — at budget 500-800 per
target, extracts each winning patch + provenance (`matched:<target-basename>`), and feeds them
into the E2 candidate pool. Targets are auto-selected with the pitch-stability scan (the
rebuild-ref-chops lesson: bad targets waste budget; the harness commits the scan report).
Licensing: matched patches are PARAMETER VECTORS, not audio — they carry no samples and live in
the repo; the target reference stays a local path in provenance, ref-posture.

## E4 — critic-targeted patch search (S-M, LAST, gated)

Experimental: reuse src/match's CMA-ES with a new loss = −(aes CE+PQ blend + ensemble-critic
pessimistic score) — evolve patches the scoring stack loves, no target wav. All research/117
fences apply (stereo-width excluded from the objective, pessimism mandatory, outputs land ONLY
as blind rateable batches, never auto-adopted). Run only after E2's blind gate reads positive —
if curation via the same scores didn't lift blind ratings, searching those scores harder would
only Goodhart.

## Sequencing, effort, verification

E0+E1 together (a day, one build+round) → E2 (few days incl. overnight compute) → E3 rolling as
ref pools mature → E4 gated on E2's result. Every tier terminates in the same instrument: blind
rounds through `beat rate`, era-split report reads, D27-replication attempts. All tiers reuse
existing machinery (surge curation harness, T6 match, showdown, produce.ts) — this plan is
wiring and compute, not new architecture.

## Risks, stated

- **Curation may overfit the scoring stack** (aes+critic), whose gen-split blindness is
  documented — the blind-round gates exist precisely to catch that; E4 stays gated.
- **Seeds determinism**: E2's taste-seeds change must keep byte-stability per seed (test-asserted
  today; the jitter derives from the seed).
- **Era mixing**: E0's provenance tags are the guard — reports must split random-patch vs
  factory vs curated eras or the aggregate will blur exactly the comparison this plan exists to
  make.

## Build status (E0–E2 landed, branch `engine-presets`, 2026-07-23)

**E0 — DONE.** The engine/engineplus manifest `from` strings and the showdown work-batch recipes
carry a `[patch: <tag>]` provenance tag (`random-seed-patch` | `factory:<name>` | `curated:<id>`),
built/read by `withPatchProvenance`/`readPatchProvenance` in the new shared `src/taste/enginePresets.ts`.
Verified end-to-end: a stub showdown's manifest carries the tag on both the engine and engineplus
clips (engineplus inherits the engine's patch). No behavior change on its own.

**E1 — DONE.** `beat showdown` engine clips draw a role-mapped factory preset applied to the seed
track as an ordinary preset edit, before the figure composes, so engineplus inherits it for free:
bassline→`bass`, chords→`pad|keys`, lead→`lead|pluck|arp`, drum-loop→a factory **drums preset**.
Seeded per batch (`pickEnginePreset`), exclude-chained across a run. `--random-patches` restores the
historical random-seed-patch behavior for era comparison. **Deviation, noted:** drum-loop draws the
six `drums`-kind presets in factory.json (param-bag edits that apply cleanly to any seed) rather than
drum-kits.json — those kits replace the whole lane list and `kit-acoustic` references unregistered
samples, so they can't apply as "an ordinary edit" to a bare seed, which is the plan's stated
principle. Stub CI verified the chosen preset name lands in the manifest provenance
(`factory:fm-bass`, `factory:lofi-kit`, …).

**E2 — machinery DONE, curation run + committed bank pending its finish.** `scripts/curate-engine-presets.mjs`
scores each pitched role's candidate pool (factory synth presets + ~2 000 seeded random rolls of the
core-timbre space, resonance ≤ 0.85) on a per-role probe rendered through dotbeat's **own engine**
(`renderVaryBatch`, one-boot chunks, offline ~10× realtime, raw), gates + blends via the shared
`src/taste/surgeCuration.ts` (ring/activity gates, 0.45·aes + 0.30·critic + 0.15·ring + 0.10·active),
and writes `presets/engine-curated.json` — top quartile per role, each kept patch's full param vector.
The ring metric is `src/metrics/ring.ts`, a TS port of `python/surge_render.py` `_ring_db` (the engine
has no surge sidecar). Renders/scores cache under `~/Documents/dotbeat/tools/engine-curation-cache`
(incremental). **Consumers:** showdown's E1 pick prefers the curated bank → factory → random;
`beat taste-seeds` draws each synth track's base patch from the bank + seeded ±10% jitter (byte-stable
per seed — verified by diff against the pre-change output; absent bank = historical random roll), and
the T5 pilot inherits curated seeds by reading those files. gen-kit's tonal roles are sample-backed
keymap tracks (generated one-shots), not engine synth tracks, so the curated synth bank has no apply
point there. **Ring-gate note:** bright factory *leads* on the high C5–C6 probe ring by the narrow-peak
metric (their isolated harmonics tower over the 4–14 kHz neighborhood) and are gated out — which is
the metric doing its job (the owner's original "piercing ringy" complaint was exactly bright leads);
the 666 lead rolls include darker/filtered patches that survive.
