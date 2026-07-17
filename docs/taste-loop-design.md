# Taste-loop design: a personal music critic and the search loop it drives

*Companion to `docs/research/107-taste-model-program.md` (the evidence base — citations and
confidence labels live there, not here). Drafted 2026-07-16 with the owner; status: design, not
yet scheduled into phases.*

## The owner's vision (the requirement, verbatim intent)

> "Imagine the agent makes a bunch of variations. It's scored by this critic, then once you get to
> the highest ranking three, you use those to then make more... you sort of run this circular
> process that goes for a long time and eventually finds higher scoring things in the taste
> profile... enabling the agent to arrive at really interesting and compelling synths or drum
> beats that are more in my taste." — and, on data: real songs the owner loves are "the ultimate
> ground truth"; stems/chops of them should be part of the dataset. The end goal is dotbeat output
> that "actually sounds like a produced track."

## Design at a glance

Four layers, each independently useful, each feeding the next:

```
L4  critic-guided search      overnight generate → score → breed loops (quality-diversity),
                              owner blind-audits the frontier each morning
L3  personal taste model      BT/GP head over features; trained on the score log;
                              active-learning batch proposal
L2  taste prior from records  stems/chops of loved vs disliked songs → embedding-space
                              prior ("the destination"); also per-stem reference profiles
L1  instrumentation           score log enriched with per-variant features; blind-audition
                              tooling; embeddings; eval harness (held-out pick prediction)
```

The guiding split (inherited from decisions.md D2 and kept deliberately): **physics is measured,
taste is chosen, and now taste-choices are *learned from* — but the model stays advisory.** The
critic pre-ranks and proposes; it never auto-adopts. The owner's picks remain the only ground
truth, and the loop is engineered to keep collecting them where they're most informative.

## L1 — Instrumentation (the prerequisite for everything)

**Enrich the score log.** Today `beat score` records batch dir + ranked picks. Every entry must
also capture, per variant: the DSP metric vector (`beat metrics --json` of the variant's render),
the vary target/seed/amount (already in the batch's provenance), and — once L1.2 lands — an audio
embedding reference. Backfill is possible for batches whose renders still exist; otherwise this
starts the clock, so it lands first.

**Embeddings.** Frozen **LAION-CLAP `larger_clap_music`** (Apache-2.0 weights, 512-d per clip,
plain HF transformers; the best license-clean human-timbre-alignment evidence per research/107
§4.1) run over every variant render, cached next to the batch, plus **Audiobox-Aesthetics' four
scores** (CC-BY-4.0) as explicit production-quality features. Dimensionality reduction (PCA to
~30-50 dims) is fit on *unlabeled* variants — dotbeat can render unlimited unlabeled audio, so
the projection costs zero preference labels. (MERT/MuQ score higher on music benchmarks but ship
CC-BY-NC weights — acceptable only if that component stays personal-use-only.)

**Blind audition.** `vary --audition` already stitches variants into one WAV with a timecode
index. Two additions: (a) presentation-order shuffling with the mapping stored, so picks are
position-debiased; (b) the same audition/pick flow pointed at arbitrary clip sets (needed for L2's
blind chop ratings — rating stems without knowing the source song).

**Eval harness.** One command evaluates any candidate scorer against the log: held-out-batch
top-1 accuracy (chance floor ≈ 1/9 ≈ 11%), top-3 hit rate, and rank correlation. Every later claim
("the taste model works", "embeddings beat DSP features") reduces to this number. Ships with three
reference scorers: random, DSP-feature BT, embedding BT.

## L2 — Taste prior from real music ("the destination")

Pipeline (tooling verified permissive in research/102: Demucs MIT, Beat This MIT):

1. Owner curates playlists: loved / neutral / disliked. Target ~50-200 songs per bucket.
2. Stem-separate (Demucs, local) → drums / bass / vocals / other.
3. Chop at detected bar boundaries (Beat This) into 4-8-bar loops.
4. Embed every chop; compute DSP metrics too (the same feature pipeline as L1 — one code path).
5. Labels, two tiers: **weak** = the source song's bucket (free, plentiful, confounded);
   **strong** = blind chop-level picks through the L1 audition flow (small, clean). Where strong
   disagrees with weak — a sound the owner rates poorly from a song they love — is signal, not
   noise: it isolates *sound* preference from *song* attachment.
6. Train the prior: start with the simplest thing that can work — per-stem-class centroids of
   loved chops in embedding space; "prior score" = negative distance. Upgrade to a classifier /
   shallow metric-learning model only if the eval harness says the centroid isn't enough.

**Two traps this design explicitly avoids** (both from research/107): the *circularity trap* —
chops must be rated blind or labels measure recognition, not sound; and the *domain-shift trap* —
the prior is trained only on real-music chops and enters L3 as a feature/prior-mean, never by
mixing real-song comparisons into the variant-ranking training set (a jointly-trained model would
learn "sounds like a finished record = good", which ranks all dotbeat variants identically low).

**Immediate no-ML payoff:** per-stem reference profiles (`beat metrics --save-profile`) from loved
songs' drum/bass stems give `lint --ref` genre-aware targets right away.

**Licensing note:** separated stems and chops of commercial records are for the owner's private
model only — never redistributed, never in the repo, never in generated output. Keep the dataset
and its derivatives out of anything shared.

## L3 — The personal taste model (the critic)

- **Features:** DSP metric vector ⊕ reduced embedding ⊕ Audiobox-Aesthetics four axes ⊕ L2 prior
  score. Ablate per variant type (knob / feel / automation / sample batches) — expectation from
  research/107: DSP features suffice for level/filter batches; embeddings needed for feel/sample/
  generated batches.
- **Model:** Bradley-Terry / Plackett-Luce top-k likelihood over the log's ranked picks.
  v0 = regularized logistic BT (a ranker in ~50 lines, trivially retrainable per batch).
  v1 = GP utility (posterior uncertainty enables active learning and pessimistic search).
- **Sample-budget hypothesis (to be tested, not assumed):** usable signal within ~10-30 batches
  (~100-300 implied pairwise comparisons), extrapolated from the 70-150-query regimes in adjacent
  domains. The eval harness decides.
- **Active batch proposal:** `beat suggest --taste` proposes the *next batch composition* by
  acquisition value under the current posterior (uncertainty/information gain), not random seeds
  alone, while maintaining comparison-graph connectivity: each proposed batch includes one past
  winner as an anchor.

## L4 — Critic-guided search (the "circular process")

The overnight loop the owner described, with the three safeguards the literature demands:

```
repeat for G generations:
  1. propose population: mutate current archive elites (vary's existing seeded mutation),
     + BO-style acquisition picks, + an ε fraction of pure-random immigrants
  2. render + feature-extract each candidate (the slow step — budget-bound)
  3. score = taste-model posterior mean − β·posterior std   (pessimism: don't sprint into
     regions the critic knows nothing about)
  4. update a quality-diversity archive: best candidate per niche (niches = regions of
     embedding/descriptor space), not a single global best
each morning:
  5. owner blind-audits the current frontier (~9 items drawn across niches)
  6. picks append to the score log → critic retrains → next night's loop uses the new critic
```

- **Quality-diversity, not hill-climbing** (evidence in research/107 Part 3): a pure fitness loop
  converges to one local optimum — nine near-identical "best hats" — and the Picbreeder result
  shows the interesting artifact often *cannot* be reached by optimizing for it directly. Concrete
  choices from the literature: **CVT-MAP-Elites** archive (k centroids ≈ the number of frontier
  items reviewed each morning), **CMA-ME-style emitters** with the **iso+line operator**
  (σ_iso≈0.01, σ_line≈0.2 on [0,1]-normalized genomes) for continuous synth-param/automation
  genomes, plain per-slot mutation for discrete groove genomes (which the literature has NOT
  covered — grooves are unexplored QD territory). **Descriptors start handcrafted and
  human-legible** (centroid/brightness, onset density, swing, width) so morning review reads as
  "the bright sparse corner vs the dark busy corner"; learned-embedding descriptors come later
  with the known mechanics (archive re-projection on descriptor retrain; collapse checks). QDAIF
  (ICLR 2024) is the direct precedent that a learned-critic-scored QD loop produces elite sets
  humans rate as both more diverse AND better than fitness-only search.
- **The surrogate pattern (DSA-ME) is the highest-leverage structural choice:** the taste model IS
  the surrogate. The overnight loop evaluates thousands of candidates against the critic (instant)
  and spends real renders only on archive-frontier candidates — the same candidates whose morning
  labels retrain the critic. SAIL-line results suggest roughly an order of magnitude fewer true
  evaluations; the archive's diversity is itself what keeps the surrogate accurate across the
  space.
- **Goodhart containment** is layered, not optional: pessimistic scoring (step 3), forced
  exploration (ε-immigrants, step 1), critic retraining on the frontier (step 6 — the frontier is
  exactly where the critic is least trustworthy and a human label most informative), and the
  standing rule that the critic never auto-adopts into a real project.
- **Provenance for free:** variants are seeded text edits, so every discovered sound carries its
  full lineage (generations of `beat set` recipes) — checkpointable, diffable, reproducible.

## The expressiveness ceiling, measured (sound matching)

"Can the engine even make sounds like the records I love?" becomes an experiment instead of a
debate: run the L4 loop with a different objective — minimize embedding distance to a target chop
from a loved record (method details per research/107 Part 2). Outcomes, both valuable:

- **Gap small** → the search recipe *is* an auto-preset-from-reference feature (point dotbeat at a
  sound, get a patch).
- **Gap large** → a measured, per-sound-class list of what the engine cannot reach — an
  evidence-backed feature-request list for the engine (e.g. "no transient shaper / saturator
  quality caps brightness match at X").

## Evaluation ladder (what "the critic got good" means — from the Option-Machine artifact)

1. Never wrong about physics (deterministic metrics — already true, keep verified).
2. Catches seeded defects an engineer would (detection/false-alarm on injected flaws).
3. **Predicts the owner** — held-out top-1 above the 11% floor, the L1 harness's headline number.
4. Shortens the road — iterations-to-adopt trending down on comparable tasks, from existing logs.
5. Transfers — blind listeners prefer loop-shaped results (the only test of the whole system).

## Execution plan (step by step, with owner tasks called out)

Each phase is independently shippable and gated on evidence, not faith. "Owner" tasks are things
only the owner can do; everything else is agent/dev work.

### T0 — Groundwork (agent; ~1 session; no owner tasks)
- Enrich the score-log schema: every entry stores each variant's DSP metric vector + vary
  provenance (target/seed/amount); backfill from batch dirs whose renders still exist.
- Eval harness command: held-out-batch top-1 / top-3 / rank correlation for any scorer, with
  random + DSP-BT reference scorers built in. This number gates everything after.
- Blind-audition upgrade: shuffle presentation order (mapping stored), and allow pointing the
  audition/pick flow at arbitrary clip sets (needed for T3's blind chop rating).

### T1 — First signal (owner: just make music; agent: measure)
- **Owner:** use dotbeat normally; rank vary batches as usual. Target ~20 scored batches over
  normal use — no extra workflow, the loop rides existing habits.
- Agent: at 10 and 20 batches, train the v0 Bradley-Terry ranker, report held-out top-1 vs the
  ~11% chance floor.
- **Gate:** meaningfully above chance at 20 batches → T4. Near chance → T2 first (features, not
  labels, are the bottleneck).

### T2 — Embeddings (agent; no owner tasks)
- Integrate the chosen frozen encoder (per research/107 Part 4), cache embeddings per render,
  PCA fit on unlabeled variants (free — render as many as needed).
- Ablate via the harness: DSP-only vs embedding-only vs both, split by variant type.

### T3 — Real-music dataset and taste prior (owner-led data, agent-led pipeline)
- **Owner:** curate three playlists — loved / neutral / disliked — as local audio files
  (~50 songs each to start; more later). These files and everything derived from them stay out
  of the repo and out of anything shared (private-model use only).
- Agent: stem-separate (Demucs) → chop at detected bars (Beat This) → embed + metrics; also emit
  per-stem reference profiles from loved songs (immediate `lint --ref` payoff, zero ML).
- **Owner:** blind-rate chop batches through the audition flow — 10-20 items per session (the
  fatigue ceiling from the IEC literature), a handful of sessions.
- Agent: train the prior (loved-centroid distance first); test transfer by scoring historical
  dotbeat batches — does the prior alone beat chance on past picks?
- **Gate:** prior transfers → it becomes a T4 feature. It doesn't → keep it for reference
  profiles only, and say so in this doc.

### T4 — `suggest --taste` (agent; owner uses it passively)
- Advisory pre-rank of new batches + next-batch proposal by acquisition value, with a
  connectivity anchor (one past winner per batch). Never auto-adopts.
- Measure: iterations-to-adopt on comparable tasks, before vs after.

### T5 — Overnight QD loop (agent builds; owner spends 10 min/morning)
- CVT archive (k ≈ 12-20), CMA-ME-style emitters with iso+line mutation, DSA-ME surrogate
  pattern (critic screens thousands; render only the frontier), pessimistic scoring
  (mean − β·std), ε pure-random immigrants per generation.
- **Owner:** blind-audit the morning frontier (≤ 10-20 items); picks retrain the critic.
- Compute note: renders are ~real-time (a 1,000-render night ≈ hours); if throughput binds,
  resurrect a faster-than-realtime offline render on dotbeat's own engine (decisions.md D15's
  closing note anticipated exactly this need).

### T6 — Sound matching / expressiveness ceiling (agent; owner picks targets)
- **Owner:** choose 5-10 target stem chops from loved records ("I want sounds like THIS").
- Agent: **CMA-ES** per target (the method the closest published analogue, INSTRUMENTAL, proved
  out on a 28-param subtractive synth — research/107 §2): population ~24 rendered in parallel,
  budget 2-5K renders/target (90% of gain lands early), on 1-2s loudness-normalized chops.
  Pitch frozen from f0 detection (spectral losses are provably bad at pitch); discrete params
  (osc/filter types) enumerated as separate short runs; staged search (source params, then
  inserts); spectral-analysis initialization. Optimize log-mel MSS + MFCC + envelope distance;
  **report** the ceiling in MFCC + CLAP cosine (the human-validated metrics). Guard the
  INSTRUMENTAL failure mode: clamp parameters to sane ranges — past ~30 dims the optimizer
  exploits extremes instead of matching.
- Foreknowledge for the ceiling study: INSTRUMENTAL's single biggest quality lever was adding
  **unison voices + a noise floor** to the engine (−49% loss) — if "thickness" dominates
  dotbeat's match error, that's the first engine feature to consider. Also honest: no published
  work has matched against *stem chops from commercial mixes* (published targets are single
  notes/one-shots) — dotbeat's targets are harder than anything benchmarked.

### T7 (optional, later) — Paid listener validation
- Only if/when the critic clears the personal bar and rung-5 transfer is worth testing: Prolific
  pairwise-preference screens (~$12/hr + 33% fee ≈ **$0.10-0.15 per clip rating**; ~$100-150 per
  1,000 ratings), headphone-screened, anchored by a small expert panel. The literature validates
  crowd MUSHRA against experts for *speech quality* (r≈0.95 on Prolific); crowd *music preference*
  validity is undemonstrated — start with a small validation batch. Note research/107's standing
  caution: cross-person data helping a *personal* taste model is an open question; this phase
  evaluates transfer, it does not feed training by default.

T0-T1 use only existing infrastructure and start the data clock immediately — everything later
gets stronger the earlier T1 begins.

## Open risks (honest register)

- Every component is proven only in an adjacent domain; the end-to-end stack is unbuilt anywhere
  (that's the opportunity and the risk).
- Taste may be non-stationary and context-dependent (what the *track* needs, not what the clip is)
  — delta-features and in-context renders are the designed mitigations, unproven here.
- Render throughput is the binding constraint on L4; the retired faster-than-realtime offline
  render path may need resurrecting on dotbeat's own engine (see decisions.md D15's closing note).
- The n needed for audio-production preferences is a guess until step 3 reports.
