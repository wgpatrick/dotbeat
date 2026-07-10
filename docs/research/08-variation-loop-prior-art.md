# Research pass 08 — Variation-and-taste loop: prior art & method design

*Run 2026-07-10 via the deep-research harness. 5 angles, 23 sources fetched, 113 claims
extracted, 25 verified: **25 confirmed (all 3-0), 0 refuted, 0 unverified.** 105 agents.
Triggered by the owner's concept (docs/variation-loop.md): "the ai system produces speed, human
focuses on taste… we might be able to use it for training."*

## Headline

The loop the owner sketched is a **mature, documented lineage** — from Brian Eno's 1996
sixteen-variations thought experiment through Dahlstedt's MutaSynth (ICMC 2001), Yee-King's
browser-based Evosynth (2016), and Luke's Edisyn Hill-Climber (2019) — and the literature
converges on specific, load-bearing design numbers:

- **Batch size 9-16 per round** (three decades of systems independently converged here; 9 when
  auditioning is strictly serial, 16 with a grid/pad UI for fast switching).
- **Ranked pick of up to 3 favorites per round**, not per-item numeric scores (Edisyn's
  ~(3,16) evolution strategy; absolute human ratings are inconsistent, rankings are cheap).
- **A hard human budget of at most a few hundred auditions per session** (the classic IEC
  "fitness bottleneck"); classical practice ≈ 20×20. But convergence is fast: usable sounds in
  **2-12 generations** (Dahlstedt, ~18-108 auditions at population nine).
- **One "variation amount" knob only** — Edisyn removed recombination-weight control because it
  confused users.
- **Design for exploration, not target-matching**: preferences are noisy and non-stationary;
  users value serendipity. Empirically (Luke 2019, n=28): exploratory methods scored
  **7.1-7.5/10 vs 5.9/10** for direct parameter programming (p=0.05, ANOVA/Holm-Bonferroni).

## Verified findings (selection)

1. **Batch size + interaction pattern** *(3-0 ×3)*: MutaSynth used exactly 9 sounds/generation
   mapped to the numeric keypad for one-key listening, with a "repeat same operation on same
   parents" re-roll; Edisyn uses 16 (optionally 32) children with rank-3 parent selection; Eno's
   1996 proposal was 16 variations per randomize.
2. **The fitness bottleneck is hard** *(3-0 ×3)*: "a human cannot be asked to assess more than a
   few hundred candidates before he gives up" (Luke); ~20 individuals × ~20 generations is the
   classical IEC envelope (Pallez et al. 2008, tracing Takagi 2001).
3. **Operator design and gene→param mapping are the hit-rate levers** *(3-0 ×2)*: MutaSynth is
   literally a small-parameter-diff toolkit (mutation with separate probability + range,
   insemination = asymmetric crossover "close in character" to one parent, per-gene morphing,
   manual edits that persist through breeding, freezing of parameter groups). Key quote: genes
   map through **nonlinear translation curves "to make the most musically useful values more
   probable"**, and "the more universal I make the sound engine, the smaller the portion of
   useful sounds" — i.e. constrain mutation to musically-mapped ranges and evolve **one
   parameter group at a time**.
4. **Real-world engagement numbers exist** *(3-0 ×4)*: Evosynth's month online: 3,552 breed
   events from 229 unique IPs, 90 saved sounds — ~15 breed events/user and **~2.5% of breed
   events yielded a save**. Expect sparse positive labels. (Caveat: Evosynth mutates topology;
   we mutate fixed-architecture params — pattern transfers, substrate differs.)
5. **The failure modes and their mitigations are canon** *(3-0 ×3)*: inconsistent ratings,
   slowness, fatigue (Takagi 2001 via Pallez). Proven mitigations = **learned preference
   surrogate + clustering so humans only rate representatives** (Machwe & Parmee 2009 —
   peer-reviewed precedent for rung 2 of our ladder; caveat: their domain was visual design).
6. **Rung 3 exists at SIGGRAPH level**: Sequential Gallery (Koyama et al. 2020) — preferential
   Bayesian optimization that decomposes high-dim search into 2D plane-search galleries,
   explicitly "to keep necessary queries to users as few as possible". **Critical caveat
   (verified): validated only on visual tasks** — galleries scan in parallel for images but
   audio auditioning is serial; never tested on audio or at 74 dims. Structural analogy, not
   demonstrated transfer.
7. **The (params, audio, score) triple is the field's own framing** *(3-0 ×4)*: McDermott et
   al. 2008 map genome/phenotype/fitness onto control params / output sound / comparison;
   Dahlstedt 2007 is the canonical machine-varies/human-selects statement. (Their fitness is
   distance-to-target; ours is taste — structure same, semantics differ.)

## What did NOT survive

- **Neural sound matching / inverse synthesis** (InverSynth, FlowSynth, Sound2Synth, DDX7,
  DDSP): zero surviving claims — nothing can be asserted about training-data regimes or
  small-data/in-context approaches from this pass. Only EC-based sound matching is verified
  prior art.
- **Shipped product precedent** (Synplant 2 genopatch, XO similarity map, Ableton macro
  variations, Vital/Serum randomize history): zero surviving claims.
- **PBO sample-efficiency numbers for audio**: not verified anywhere (Sequential Gallery's
  numbers are from visual/synthetic tasks).
- Single-listener overfitting: documented as a *concern* only via the adjacent
  noisy/non-stationary findings; no method results.

## The design this dictates for `beat vary` / `beat score`

*(synthesis finding, medium confidence — each component is anchored to a verified claim; the
combination and the transfer to a 74-param engine is inference)*

- `beat vary`: **9 variations per round** (keys 1-9 audition pattern), **mutation-only within
  one parameter group at a time**, one `--amount` knob, a re-roll ("same parents, more
  alternatives"), nonlinear per-param ranges (log for frequencies/times), seeded/reproducible,
  manifest with parent hash + per-variant diffs.
- `beat score`: **ranked pick of up to 3**, not sliders; append-only git-tracked log capturing
  (parent params, diff, render hash, rank, round) — the scoring exhaust.
- Session discipline: ~10 rounds default cap, never design for more than a few hundred
  auditions; expect ~2.5%-ish save rates; design for exploration/re-anchoring, not convergence.
- Learning ladder for the exhaust: **rung 1** hand-tuned operators + musical mappings (zero
  data, works now) → **rung 2** preference surrogate + clustering to pre-filter (once a few
  hundred triples exist; Machwe & Parmee precedent) → **rung 3** preferential BO / plane-search
  (unproven on audio — that's *our* experiment to run, and a potential contribution).
- First experiment: kick-drum task, one group at a time, batch 9, rank-3, 10 rounds max,
  satisfaction rating vs direct-editing control (replicates Edisyn's study design).

## Open questions (carried forward)

1. Does gallery/plane-search PBO transfer to serial audio auditioning, and what are real
   judgments-to-converge numbers for perceptual audio targets (hearing-aid-fitting PBO
   literature not captured this pass)?
2. Training-data volumes for modern neural sound matching on a fixed 74-param engine; any
   small-data / in-context (LLM-steered) regime that could consume the exhaust early?
3. Shipped-product interaction patterns (Synplant 2 genopatch, XO map, macro variations) — did
   anything ship a *persistent* scoring/history loop rather than one-shot randomize?
4. Handling non-stationary / multi-listener taste (time-decaying preference models, per-session
   re-anchoring, per-user surrogates) — problem documented, methods unverified.

## Consequences

- `beat vary`/`beat score` (ROADMAP §7, v1 tier) is now design-complete on verified numbers —
  build the rung-1 tool; the render nondeterminism found in Phase 5 (±0.4 LU run-to-run)
  matters here and should be noted in every scoring manifest (same-render comparisons only).
- The training-flywheel half of the owner's idea (rungs 2-3) has real precedent but real
  unknowns; revisit after the exhaust exists.
