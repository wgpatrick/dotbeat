# The constrained T5 overnight pilot (`beat pilot`)

*The owner's "circular process" (`docs/taste-loop-design.md` L4/T5 — "make variations → the critic
scores them → the best breed the next round → run this for a long time and it finds higher-scoring
things in my taste"), built deliberately SMALL. Companion to `docs/research/117-critic-guided-
search-in-practice.md` — its §Part-4 pilot spec IS this feature's spec — and to the C2 section of
`docs/taste-loop-design.md` (the pessimistic ensemble critic this loop consumes). Plan item C3.
Built 2026-07-22.*

## Why constrained, not full T5

research/117 is the implemented-systems record for critic-guided search. Its verdict: **build a
constrained pilot now, not full T5, and not wait.** The full overnight loop as originally drafted
sits in the *measured disaster regime* — dotbeat's critic trains on ~500 implied pairwise
comparisons, ~4× below the data floor where reward-model overoptimization is worst (Gao et al.
2023), and the SMART result shows diversity collapse from exactly the aesthetics features dotbeat's
critic weights most. Thousands of iterated selection steps per night against this critic is not yet
defensible. But *waiting* for a "reliable" critic is not what any tiny-data success (CoSpar, SLS,
ROMBO) did either — they ran the loop with weak models and let the loop *create* the labels.

So the pilot is the loop with the leash as short as the evidence demands:

| research/117 §Part-4 requirement | how `beat pilot` meets it |
|---|---|
| Cap pressure at **best-of-n-per-niche**, not deep ascent | ≤ `--generations` (default 6) generations, `--budget` (default 80) TOTAL renders, best-per-niche selection — no iterated hill-climbing |
| **Ensemble pessimism REQUIRED** (mean − β·std) | scores come from `criticWithUncertainty` (C2 bootstrap ensemble, β=1); the loop never uses a point estimate |
| **Fence off the gen subspace** (critic is 0% top-1 there) | the search only ever mutates **synth params of a hand-authored seed track** — it never touches a generated sample. Gen is fenced by construction. |
| **Neutralize the visible hacks up front** | batch loudness normalization (already shipped) + the **stereo-width fence** (below) |
| **Control items in every morning frontier** | every frontier batch ships critic-guided elites *and* random-mutation controls |
| **Gate scaling on the control comparison** | the run summary and `beat pilot --report` print the SCALING GATE: elites must beat controls in blind ratings before any scale-up |

Either outcome pays: elites beat controls → scale toward full T5 with evidence; controls tie or win
→ the critic gains exactly the labels it lacks at trivially low cost (research/117 §Part-4).

## The loop, precisely

`beat pilot run <collection-dir> [--budget 80] [--generations 6] [--niches 4] [--roles bassline,chords] [--seed N] [--controls 3]`

Per role (the population is per-role — a bassline and a pad occupy very different brightness/density
regions, so mixing them into one archive would just sort by role and defeat the diversity pressure):

1. **Initialize** a generation-0 population by range-spanning (`--spread`) mutations of the role's
   seed tracks across the legal synth-param vary groups (`src/vary/vary.ts` `VARY_GROUPS`).
2. **Per generation:**
   - **mutate** the best-per-niche elites (a gentle `--amount` neighborhood step) — the whole
     frontier breeds, round-robin across niches, so this is quality-DIVERSITY, not hill-climbing —
     plus an **ε fraction** (default 0.2) of pure-random immigrants from fresh seeds (forced
     exploration).
   - **render offline** (budget-bounded, one engine boot per generation — the `renderVaryBatch`
     path `prodtask`/`showdown` use), **feature-extract** DSP + the four Audiobox-Aesthetics axes.
   - **fence stereo width** (below), then **score** the whole generation *together with the current
     archive incumbents* (the critic z-scores within-population, so incumbents and challengers must
     share one scoring context to be comparable across generations) with the pessimistic ensemble
     critic, β=1.
   - **keep the best per niche** (the CVT-MAP-Elites-lite archive).
3. **Controls** (post-loop, NEVER critic-scored): random-mutation descendants of the final elites —
   the same starting point, one random move instead of a critic-guided one.
4. **Morning frontier** per role: the final elites (≤8) + the controls, assembled as an **ordinary
   blind rateable clip-set batch** (group `pilot:<role>`, seeded arm→v-number shuffle, duration-
   matched, loudness-normalized — the `writeShowdownBatch`/`prodtask` conventions), with a manifest
   that records elite-vs-control per variant honestly. `beat rate` finds it like any other batch.

The genomes are seeded `beat set` edit chains over a seed `.beat`, so every discovered sound carries
its full, diffable, reproducible lineage (the design's "provenance for free").

## The niche descriptors (v1: handcrafted, honestly coarse)

research/117 and the design doc both want **handcrafted, human-legible descriptors first**
("the bright sparse corner vs the dark busy corner"); learned-embedding descriptors come later. v1
reads two DSP axes straight off the feature vector:

- **brightness** = `centroidLog2` (the spectral centroid, log2 Hz — the feature's own brightness axis)
- **density** = `−crestDb` (crest factor inverted: a busy/sustained/compressed texture has a LOW
  crest factor, a sparse/transient one a HIGH crest). This is a **coarse proxy for onset density /
  busyness, NOT a true onset count** — the DSP feature vector carries no onset detection. Named a
  proxy in the code so nobody reads it as more than it is.

`--niches` (default 4) is factored into a near-square `density × brightness` grid (4→2×2, 6→2×3,
9→3×3; a prime falls back to a single density row). The grid **edges are quantiles frozen from the
generation-0 population** — a MAP-Elites archive needs stable niche boundaries, or a niche's meaning
drifts out from under its incumbent between generations. Niche 0 is the dark·sparse corner; the last
is bright·busy.

## The stereo-width fence (the #1 measured hack vector)

dotbeat's own feature-mining found **stereo width correlates 1.00 with preference rank** — so an
unconstrained optimizer learns "wider always wins" long before it learns taste (research/117
§verdict names this the #1 hack vector, alongside Audiobox production-complexity). Batch loudness
normalization already fences the twin "louder wins" confound; `fenceWidth` (`src/taste/pilot.ts`)
is its stereo-width analogue.

**The mechanism:** the critic z-scores each feature *within the scored population*
(`ranker.ts` `standardizeBatch`), so overwriting `stereoWidthDb` with a **constant** across all
candidates makes that column's within-population variance zero → every candidate z-scores to 0 on
it → the critic's learned width weight contributes exactly nothing to any candidate's score. Width
is removed as a *steering axis for the search* without touching the critic's honest width weight
learned from the owner's real ratings — **training is never fenced, only search candidates are.**
(Scope note: v1 fences `stereoWidthDb`, the axis 117 names; `stereoCorrelation` is a related channel
left in — the mono engine renders sit at correlation ≈ 1 regardless, so it carries little within-
batch variance to exploit yet. Revisit if a width move ever makes it a live gradient.)

## The run journal + the Goodhart tripwire

`pilot-journal-<seed>.jsonl` records, per generation across all roles: the population (per-candidate
niche + mean/std/pessimistic + origin), scores (mean pessimistic, mean ensemble std), niche
occupancy, and renders spent. The run summary prints each role's **archive-best pessimistic
trajectory** and mean-ensemble-std trajectory, and fires a **Goodhart tripwire** when pessimistic
score climbed while ensemble std ALSO exploded (>1.5×) over the run — the frontier may be
"improving" by marching into disagreement, not taste (research/117: "a monotone climb in [the
critic] with flat morning ratings is the Goodhart alarm going off"). Weight the blind morning
ratings accordingly.

## The report + the scaling gate

```
beat pilot --report <dir> [--json]   # (or --log <path>)
```

Per-arm **elite-vs-control win / top-half / pairwise** over every scored `pilot:<role>` batch,
overall and per role, with the same small-n "smoke, not evidence" label the showdown/prodtask evals
use — it reuses the showdown's `tally` verbatim (the scoreboard math is identical; only the kind
axis differs, elite/control instead of source/arm). It ends with the **SCALING GATE** verdict: do
the critic-guided elites beat the random-mutation controls on the blind ratings so far? Until they
do, the critic is not yet adding value over mutation + diversity alone — keep the budget small and
keep collecting labels. `taste-eval` classifies pilot frontier batches as their own `pilot` ablation
split (`variantTypeOf`).

The shared scores log records the arm **kind only** (elite/control) — the batch-local lineage (niche,
edit chain) stays in the batch dir's manifest, like a ref clip's path.

## How to run a night

```
beat taste-seeds ~/prod                              # once — seed songs (any collection dir works)
BEAT_PYTHON=python/.venv/bin/python3 \
  beat pilot run ~/prod --budget 80 --generations 6  # offline renders + the aes sidecar; ~30-60 min
beat rate ~/prod                                     # rate the blind frontier in the browser, as usual
beat pilot --report ~/prod                           # the elite-vs-control scoreboard + scaling gate
```

Renders are dotbeat's own engine, offline — **no fal, no network** (the aes sidecar is a local
model). Everything is deterministic in `--seed`: same seed → the same genomes, niches, and frontier.

## Honesty notes

- **The critic is the one from C2, unchanged.** This loop consumes `criticWithUncertainty` exactly
  as the C2 prerequisite built it — the pilot adds no new modeling, only the search + containment
  around it. The critic still never auto-adopts; the owner's blind picks remain the only ground
  truth.
- **v1 is per-role synth-param search only.** Feel/groove genomes and the gen subspace are out of
  scope by design (gen is fenced; feel is a clean next increment). Default roles are two synth roles
  (`bassline`, `chords`) so each archive stays fed under a small render budget; `--roles` opens the
  rest (`lead`, `drum-loop`).
- **Cross-generation scores are comparable by re-scoring incumbents.** Because the critic z-scores
  within-population, each generation re-scores the current archive alongside the new challengers (no
  extra renders — features are cached), so "best per niche across generations" is an honest
  comparison rather than a mix of incompatible scoring contexts.
- **Frontier renders are fresh.** Elites are re-rendered into the frontier batch (render
  nondeterminism ~1 dB, `docs/render-determinism.md`); the log records the frontier render's
  features, not the selection-time ones. Honest, and within the measured run-to-run tolerance.
