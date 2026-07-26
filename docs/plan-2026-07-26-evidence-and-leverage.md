# Plan — 2026-07-26: turn what we built into evidence, and what we mined into a system

## The situation, in three numbers

| | pairwise vs the field |
|---|---|
| ref (real commercial loops) | **88%** |
| gen (Stable Audio 3 Medium) | **72%** |
| **engineplus** (our engine + production) | **31%** |
| engine (ours, raw) | **2%** |

185 rated batches. The generation backend is not the bottleneck — **our own synthesis is**.

And a second split that changes strategy, from the same ratings:

| role | our engine (engineplus) | Surge XT patches |
|---|---|---|
| **bassline** | **55%** | 21% |
| chords | 12% | **49%** |
| lead | 15% | **57%** |

Our engine is genuinely competitive at bass and hopeless at the melodic roles. Surge is the
inverse. We have been treating "close the timbre gap" as one problem with one answer.

Meanwhile almost nothing built in the last two days has been heard: the layered arm, the 12
retargeted presets and the 13-recipe library have **zero clips in any rated batch**. And the mined
corpus — 12 vein files, 3,735 sourced lines — is applied only by a human reading markdown, which is
why the layering implementation contradicted its own prior in five places.

## The through-line

Two failures keep repeating, and every track below is aimed at one of them:

1. **We build faster than we measure.** Fix: get things rated, one variable at a time.
2. **Evidence we already have goes unused.** Fix: make it mechanically consultable, not prose.

---

## Track A — Layering: finish, then hear it *(in flight)*

The owner rated the layered arm 1 win in 9. Cause is diagnosed and sourced: character layers were
raw saw/square, highpassed (stripping the fundamental), driven with symmetric saturation that
generates only odd harmonics — *"rough or harsh, gritty or edgy"* per Sound On Sound — on roles the
professional corpus does not drive (waveshaping is 62.8% of bass patches, 14.3% of chords).

Already landed on `layering-timbre-fix`: ambience restored (every layer of all 36 architectures
rendered bone dry — the owner heard it), modulation coherence across the stack, mono-discipline
split from dry-discipline, chords made dark and octave-split so `pad` and `stab` are two jobs, and
three latent bugs found in passing — the de-harsh EQ shipped inert, `fuseAttacks` was a no-op on
exactly the two chord seeds flagged for "pop pop", and doubled summary lines on every rated receipt.

**Exit:** all gates green, A/B set rendered covering the same nine cases the owner already rated,
old layered included as an arm. Merge, then hand over.

## Track B — One paired round that settles four open questions at once

Every arm below is **one variable against a shared seed**. Round 6 failed because three arms ran
under three different seeds, so source doc, patch, reference clip and prompt all moved with the arm.
That is fixed: draws now come from a sub-stream keyed on `(seed, round, role)` that takes no arm
parameter by construction.

Questions this round answers:

1. **Composition.** theory vs ca2 vs bank. Current evidence: theory **42%** pairwise vs bank's
   **26%** on our own engine, n=59 — the largest composition-side signal we have, from a
   deterministic layer that costs nothing per clip. CA2 has 6 confounded batches and a 716 MB
   dependency.
2. **Retargeting.** The 6 CMA-ES presets have never been rated. `--retargeted-patches` exists as of
   today. Known ceiling: flux/movement is structurally unreachable by any patch retarget, so this
   tests whether static-spectrum matching alone moves the owner.
3. **The role split.** Surge for chords/lead against our engine, deliberately, rather than as a
   by-product.
4. **Generation.** Stable Audio 3 Medium is 24% win / 78% top-half; lyria2 is 0 for 10. Keep the
   default, drop lyria unless it earns a place.

Cost is small — roughly $0.04 per generated clip.

**Exit:** batches in the rating queue, and `beat showdown --report` showing the figure-source axis
that was built weeks ago and wired only today.

## Track C — Make the mined corpus executable

The corpus is real and already paying off — the entire layering diagnosis came out of it. But the
path from claim to clip runs through a human reading a file, and that path has now demonstrably
failed once.

**C1. Claims store (research 143's central proposal, never built).** A claim becomes a record with
a **falsifiable predicate** — not "chords should be dark" but `chords: centroidHz < 600 at rest` —
so any render can be checked against every claim automatically. A claim our own audio violates
becomes a finding instead of prose nobody consulted. This is precisely what would have caught the
buzzy chords before the owner heard them.

**C2. Two-way, not one-way.** We now have 7 listen-bench cases, each a matched fail/pass pair with
the owner's own words. A claim that predicts he would prefer the clip he actually rejected is
*wrong*, and we should know. Today claims only flow mined → applied; the corpus accumulates but
never improves.

**C3. Own the 33 failing recipe gates.** 77 pass, 33 fail, 24 pending — and **no test gate-checks a
single real recipe**; `test/recipe.test.ts` is entirely synthetic, and the script that did check all
13 was renamed specifically because it asserts no invariant. Before mining more veins, make the 13
encoded recipes survive build → render → gate → ears. Until one does, we do not know the format is
right.

## Track D — Stop shipping guards that do not guard *(one landed today)*

The highest-yield thread of the last two days was not a feature. It was finding things that looked
protective and were not: an environment-fault guard whose tests asserted a classifier against
hand-typed strings but never that real errors reach it; seed pairing that held by accident; a
rolecheck that claimed to withhold its verdict and printed a confident PASS; a calibration with a
floor and no ceiling.

Landed today: `beat ab` was dead on a clean build (`ERR_MODULE_NOT_FOUND`) and **1797 tests went
green anyway**, because `npm run build` never cleaned `dist/` and the compiled artifact of a deleted
source file kept resolving. Build now cleans; a new guard scans every dynamic `dist/...` import the
CLI makes, since tsc cannot see them and `--help` smoke tests return before reaching them.

**Standing rule this establishes:** when a guard is added, prove it fails on the real defect before
trusting it.

---

## Order and rationale

1. **A** — in flight, and it is the one thing the owner is waiting to hear.
2. **B** — cheapest large information gain in the project; four questions, one round.
3. **C** — highest leverage on everything after this week, but worthless without B's evidence to
   calibrate predicates against.
4. **D** — opportunistic, and the standing rule applies to every track above.

## What is deliberately NOT in this plan

- **More vein mining.** 90 recipes mined, 13 encoded. Encoding is the constraint, not supply.
- **A bigger generation model.** There is no `stable-audio-3/large` (verified: HTTP 404). Stability
  2.5 exists at ~5.3× the cost under a different rights posture. Our second-best source is not
  where the gap is.
- **The piano roll**, despite being the largest open roadmap area at 34 rows. It does not serve the
  north star this week.
