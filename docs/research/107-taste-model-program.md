# 107 — The taste-model program: personal preference learning, real-music priors, and critic-guided search

*Run 2026-07-16 for the owner's taste-model initiative ("I'd love you to do some comprehensive
research on this idea"). Part 1 is a 5-angle deep-research pass run through the 3-vote adversarial
verification harness (107 agents; 25 sources fetched, 116 claims extracted, top 25 verified: 23
confirmed, 2 refuted). Parts 2-4 are follow-up single-agent passes (search + fetch, self-reported
confidence, NOT adversarially verified — treat per-claim confidence labels accordingly). The
companion design doc is `docs/taste-loop-design.md`; the vision statement is the owner's own,
quoted there.*

## The question

Can dotbeat learn a specific person's musical taste — a model that predicts which of a batch of
variants they will pick — from small amounts of their own preference data, and then use that model
as the fitness function of a long-running generate → score → breed search loop that arrives at
sounds genuinely in their taste?

## Part 1 — verified findings (adversarial 3-vote harness)

### 1.1 The problem is preference learning of a latent utility; dotbeat's score log is already the right data

dotbeat's `beat score` records ranked picks (up to 3 of ~9) per batch — in the literature's terms,
**Plackett-Luce top-k ranking data**, decomposable into pairwise comparisons (each pick beats each
non-pick). The Bradley-Terry (BT) model is the standard machinery. Verified nuances that matter:

- Real preference data may violate the BT assumption, and what BT training recovers is then
  unclear; recent theory gives precise conditions and identifies **margin** and **comparison-graph
  connectivity** as the factors governing sample efficiency (Pukdee, Balcan, Ravikumar,
  arXiv:2602.10286 — preprint). Actionable: keep the comparison graph connected across batches
  (periodically re-include a past winner as an anchor), and distinguish model-uncertain pairs
  (informative) from true near-ties (coin-flip labels that teach nothing). *(3-0, 2-1)*

### 1.2 Small personal datasets suffice — with the right model class

- **GP preference learning** (Bıyık et al., RSS 2020 / IJRR 2024, arXiv:2005.02575) fits a
  nonlinear, nonparametric utility from only pairwise comparisons, with active query selection;
  positioned explicitly against both inflexible linear models and data-hungry neural reward models.
  Same-lab user studies operated at **100-150 queries per participant, ~70 sufficing** for sensible
  behavior. Demonstrated in robotics over low-dimensional handcrafted features — the audio
  extension is inference, not evidence. *(3-0, 3-0)*
- **POP-BO** (Xu et al., ICML 2024 oral, arXiv:2402.05367) proved the first information-theoretic
  cumulative regret bound for preferential Bayesian optimization — the number of auditions needed
  to approach a taste optimum is boundable in principle. dotbeat's top-3-of-9 picks must be
  decomposed into pairwise duels to apply it directly. *(3-0, 3-0)*

### 1.3 Active selection of comparisons is load-bearing, not an optimization

- Under BT with a small budget, **uniform sampling can provably stall** with a constant Ω(1)
  suboptimality gap; APO's uncertainty-driven rule achieves near-optimal suboptimality, and in the
  one head-to-head empirical test matched a 40%-budget random baseline **with 5% of the labels**
  (Das et al., ECML PKDD 2025; arXiv:2402.10500). Caveats: worst-case construction; synthetic
  preferences in the empirical test. *(3-0 ×3)*
- **Optimal design exists for exactly dotbeat's feedback format** — a human ranking items within a
  presented list: Dope (Mukherjee et al., NeurIPS 2024, arXiv:2404.13895) generalizes
  Kiefer-Wolfowitz to lists-as-matrices under Plackett-Luce ranking feedback, with prediction-error
  bounds. Non-adaptive (computed upfront); top-3 partial rankings use the canonical PL top-k
  truncation. *(3-0 ×3)*
- REFUTED (0-3), do not cite: "Ω(d/√T) is a universal information-theoretic floor on preference
  learning" — the lower bound is a specific hypercube construction, not universal.

### 1.4 Music-specific prior art: thin, encouraging, and confirming the gap

- **ROMBO** (Marcos, Mur-Labadia, Martinez-Cantin, PLOS ONE Nov 2025) — the closest published
  analogue: per-user Bayesian optimization over a generative music model's latent space (random
  rotational embedding of a low-dim search space). In a 16-participant real-feedback study, users
  found new favorite pieces **40% more often, 16% faster**, spending 18% less time on disliked
  pieces vs random querying, within one 30-min / 64-sample session. Caveats: self-described pilot,
  n=16 between-subjects, 0-10 ratings (not pairwise), full text proxy-blocked so significance
  unverifiable; the rotational trick is specific to Gaussian latent spaces. *(3-0 ×3, one verifier
  graded evidence medium)*
- **Audiobox Aesthetics** (Tjandra et al., Meta, arXiv:2502.05139) — off-the-shelf, no-reference,
  per-item aesthetics predictor: four axes (Content Enjoyment, Content Usefulness, Production
  Complexity, Production Quality), trained on ~97k crowd-annotated clips; code + weights openly
  released (majority CC-BY 4.0), CLI takes a JSONL of audio paths. Population-level — usefulness as
  a personal-taste feature/prior is an unproven inference. *(3-0 ×3)*
- **MusicRL** (Cideron et al., ICML 2024, arXiv:2402.04229) calibrates the RLHF route: its
  human-preference reward model used **~300,000 pairwise preferences** from deployed users — 3-4
  orders of magnitude beyond a single owner. dotbeat cannot copy the RLHF recipe; the
  sample-efficient GP/BO/active-learning route is the viable one. *(3-0, 3-0)* REFUTED (0-3), do
  not cite: "MusicRL's ablations prove generic quality metrics can't substitute for personal
  preference data."
- **Auto-mixing does not learn per-person taste** — Diff-MST (ISMIR 2024, arXiv:2407.08889) encodes
  "taste" entirely via a reference song, trained with zero human preference labels; the field's own
  challenge survey (Steinmetz, ISMIR-MDX 2021) names low artifact tolerance, interpretability
  needs, and limited multitrack data. A truly personal production-taste model is unbuilt territory.
  *(3-0 ×3)*

### 1.5 Verified-gap ledger (from Part 1)

- **Paid listening studies**: no claims survived verification (MUSHRA/Prolific costs,
  expert-vs-crowd reliability, population-prior + personal-fine-tune). Revisited in Part 4 below
  (unverified single-agent pass).
- **Goodhart risk for learned critics**: no surviving music-specific claims; the canonical
  adjacent result is reward-model overoptimization scaling laws in text RLHF (Gao, Schulman,
  Hilton, arXiv:2210.10760 — fetched as a source, claims not put through the harness).

## Part 2 — automatic synthesizer programming / sound matching (single-agent pass)

*Placeholder — findings from the sound-matching research agent land here.*

## Part 3 — quality-diversity search for creative audio (single-agent pass)

*Placeholder — findings from the QD research agent land here.*

## Part 4 — audio embeddings and paid listening data (single-agent pass)

*Placeholder — findings from the embeddings/paid-data research agent land here.*

## Open questions (carried from all passes)

1. How many labeled batches does a personal taste model need on **audio-production** variants?
   The 70-150-query figures are domain-transferred; only a dotbeat self-experiment (held-out top-1
   pick prediction vs the ~11% chance floor) answers this.
2. Does a population aesthetics prior (Audiobox axes; crowd ratings) help or hurt a single-owner
   model — is prior + fine-tune better than tiny-data from scratch?
3. Does a **cross-domain taste prior** (from stems/chops of records the owner loves) transfer to
   ranking dotbeat's own variants? Nobody has published this.
4. How severe is Goodhart drift when the variant generator optimizes against the learned critic,
   and which containment (uncertainty-penalized acquisition, forced-exploration batches, critic
   retrain cadence, human frontier audits) is sufficient in practice?
5. What is dotbeat's engine expressiveness ceiling, measured — how close can parameter search get
   to reference stem chops, per sound class?
