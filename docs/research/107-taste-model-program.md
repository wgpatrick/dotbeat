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

*Single-agent search pass, 2026-07-16. Not adversarially verified; most primary PDFs
proxy-blocked — numbers are from corroborated search extracts unless noted.*

### 2.1 The field exists and converged on a recipe

- Automatic synthesizer programming is an established line: SynthBot (GA + MFCC fitness, 2008);
  Yee-King et al. 2018 compared hill climber / GA / NSGA-III / neural nets on Dexed (~155 params)
  — best neural matched closely in ~25% of cases, GAs reached quality but too slow for
  interactive use *(high)*; PresetGen (NSGA-II on the OP-1) was judged human-competitive
  *(medium)*; SpiegeLib's reference GA uses ~30,000 renders/target *(high — docs)*.
- **INSTRUMENTAL** (arXiv:2603.15905, 2026) is the closest analogue to dotbeat: **CMA-ES over a
  28-param subtractive synth** against a composite loss (mel-STFT + centroid + MFCC). Reported:
  CMA-ES beats Adam (which traps in local minima); **90% of the improvement lands in the first
  ~10K evaluations**; spectral-analysis initialization accelerates convergence; adding **unison
  voices + a noise floor was the single biggest quality lever (−49% loss)**; at ~29 params the
  optimizer began exploiting extreme values instead of matching. *(medium — two independent
  summaries, PDF blocked)*
- Neural inversion (InverSynth, Sound2Synth, FlowSynth, DAFx24's AST-on-Massive) trades
  10⁴-10⁶ pre-rendered training examples for 1 forward pass per target; the AST work generated
  its whole training set in ~24h on one desktop *(high)*. CTAG (ICML 2024) showed evolution over
  a JAX modular synth (>90,000× real-time) maximizing **LAION-CLAP similarity** works — render
  speed is what makes search practical *(high)*.

### 2.2 Objectives: what actually correlates with ears

- MSS (multi-scale spectrogram) loss is the standard but **provably bad at pitch/frequency
  params** (Turian & Henry 2020; IEEE SPL 2023) — freeze pitch via f0 detection, don't optimize
  it *(high)*.
- **MFCC distance remains competitive with deep embeddings** against 2,614 human pairwise timbre
  ratings (ISMIR 2025, arXiv:2507.07764); CLAP-derived embeddings best-aligned overall but only
  marginally better *(medium-high)*. No universal winner across synth programs
  (arXiv:2506.22628); DTW-on-envelope surprisingly strong *(medium)*.
- Known failure modes: parameter non-identifiability (evaluate in audio space, never parameter
  space — Masuda & Saito); temporal/LFO-phase misalignment making losses noisy (JTFS/mesostructures
  work); optimizer reward-hacking at higher dimensionality (INSTRUMENTAL) *(high/medium)*.
- **Nobody has published matching against stem chops from commercial mixes** — published targets
  are single notes/one-shots. dotbeat's polyphonic produced-audio targets are harder than anything
  benchmarked. *(gap)*

### 2.3 Practical recipe for a ~50-param engine with slow rendering

CMA-ES (population ~24, parallel renders), 2-5K renders/target on 1-2s loudness-normalized
chops; freeze pitch from f0; enumerate discrete params (osc/filter types) as separate short runs;
stage the search (source params, then inserts); initialize from spectral analysis. Optimize
against log-mel MSS + MFCC + envelope distance; **report** ceilings in MFCC + CLAP cosine (the
human-validated metrics). Defer neural surrogates/warm-start nets until plain CMA-ES is measured
(the published "neural proxy" line's own authors call benefits "nuanced by resource
requirements"). *(synthesis; ingredients individually medium-high)*

## Part 3 — quality-diversity search for creative audio (single-agent pass)

*Single-agent search pass, 2026-07-16. Not adversarially verified; the agent could not fetch
primary PDFs (arxiv/openreview 403-blocked by the session proxy), so specific numbers are from
abstract/snippet extraction — verify against sources before citing them beyond this repo.*

### 3.1 The algorithm family fits the genome types dotbeat has

- **MAP-Elites** keeps the best solution per *niche* of a behavior-descriptor space (an archive),
  mutating existing elites — returning a diverse set of high performers, not one optimum. *(high)*
- **CVT-MAP-Elites** replaces the grid with k well-spread Voronoi centroids: archive size is chosen
  directly (k ≈ how many frontier items the owner reviews) and it scales to multi-dim descriptor
  spaces. *(high — quality-diversity.github.io)*
- **CMA-ME** (Fontaine et al., arXiv:1912.02400) drives the archive with CMA-ES emitters — the
  right variant for continuous synth-param/automation genomes. For mutation, the field-default
  **iso+line operator** (Vassiliades & Mouret, GECCO 2018): offspring = parent + small isotropic
  noise (σ_iso≈0.01) + a larger component along the line to another random elite (σ_line≈0.2, on
  [0,1]-normalized genomes). *(high; σ values snippet-sourced)*

### 3.2 Why not pure hill-climbing — the evidence

- **Novelty search** (Lehman & Stanley, ECJ 2011): objectives can be *deceptive* — they fail to
  reward the stepping stones that lead to the interesting result. **Picbreeder** is the concrete
  creative-domain data point: images humans evolved interactively (Skull, ~74 generations) could
  NOT be re-evolved when made the explicit fitness objective for the same algorithm
  (arXiv:1207.6682). *(high)*
- **QDAIF** (Bradley et al., ICLR 2024, qdaif.github.io) is the closest published analogue to the
  whole dotbeat thesis: a learned model both generates and scores quality+diversity in a QD loop
  over creative artifacts; humans rated its elite sets more diverse AND higher quality than
  fitness-only baselines, and the AI feedback aligned with human judgment. *(high)*
- **Audio-specific QD exists (2025-26)**: sound-generation innovation engines evolving synth
  patches (~300k iterations/run, YAMNet-classified behavior; arXiv:2606.09780), sonic
  measurement-space QD (arXiv:2512.02783), DEI (arXiv:2605.27130). Snippet-level detail only —
  worth full fetches later. Notably **no QD-over-drum-grooves paper was found**: the groove genome
  appears to be unexplored prior art. *(medium)*

### 3.3 Surrogates: how slow renders stop being the bottleneck

- **DSA-ME** (GECCO 2022): train a surrogate online; QD explores against the cheap surrogate; only
  the most promising candidates get true (expensive) evaluations, which retrain the surrogate.
  dotbeat mapping: the taste model IS the surrogate, renders are the expensive evaluation. Bonus
  insight: the archive's diversity is a *feature for surrogate accuracy* — it generates exactly
  the spread of training data a surrogate needs. *(high)*
- **SAIL** (Gaier/Asteroth/Mouret) reported roughly an order of magnitude fewer true evaluations
  using GP surrogates + MAP-Elites. *(medium)*

### 3.4 Behavior descriptors: start handcrafted, add learned carefully

- **AURORA** (arXiv:2106.05648): learned (autoencoder) descriptors, retrained online — with the
  critical mechanic that retraining the descriptor **invalidates the archive** (all members must be
  re-projected and re-inserted). *(high)*
- **Descriptor collapse** is a named failure mode (perceptually distinct sounds landing in one
  niche); mitigations: descriptor-conditioned variation (DCRL, arXiv:2401.08632), k-NN-threshold
  unstructured archives, VQ-Elites (arXiv:2504.08057). *(medium/high)*
- **Embedding choice caution**: VGGish-based FAD correlates poorly with human music judgments;
  CLAP/MERT report better alignment (hal-04603443, arXiv:2311.01616). Using the same embedding for
  critic AND diversity axes risks correlated blind spots — check for collapse. *(medium)*

### 3.5 Human-in-the-loop cadence

- Interactive-evolution literature puts human tolerance at **~10-20 rating iterations per session**
  ("user fatigue" / the fitness bottleneck) — small on-screen populations, machine does the volume.
  *(high)*
- **NA-IEC** (Woolley & Stanley): humans picking sparsely + novelty search filling stepping stones
  between picks beat both fully-automated and fully-manual search. This is the morning-audit
  pattern. *(high)*

## Part 4 — audio embeddings and paid listening data (single-agent pass)

*Single-agent search pass, 2026-07-16. Not adversarially verified; license claims were checked
against repos directly where fetchable.*

### 4.1 Embedding choice (license × evidence × cost)

| model | weights license | dims | evidence for music/timbre |
|---|---|---|---|
| **LAION-CLAP `larger_clap_music`** | Apache-2.0 *(medium — HF card via snippets)* | 512/clip | best human-timbre alignment among joint models (arXiv:2510.14249); strong on ABX music-similarity without fine-tuning (arXiv:2601.19109); beats traditional features in music recommenders (arXiv:2409.09026) |
| MERT-v1 (95M/330M) | **CC-BY-NC-4.0** (code Apache-2.0) | 768/1024 per frame | SOTA-near on 14 MIR tasks (MARBLE) — but NC weights block productization; personal use only |
| MuQ / MuQ-MuLan | **CC-BY-NC-4.0** (code MIT) | — | beats MERT on MARBLE (arXiv:2501.01108); same NC constraint |
| PANNs CNN14 | Apache-2.0 | 2048 | better-than-VGGish human correlation; general-audio, not music-specialized — the commercial-clean fallback |
| VGGish / OpenL3 | Apache-2.0 / MIT | 128 / 512 | repeatedly outperformed; VGGish-based FAD correlates poorly with human music judgments — skip |
| Audiobox-Aesthetics | CC-BY-4.0 | 4 scores | the only model trained directly on human aesthetic ratings — complement, not replacement |

**Pick:** LAION-CLAP `larger_clap_music` as the backbone (license-clean, 512-d, loads via plain
HF transformers), Audiobox's four scores appended as explicit features. MERT only if
personal-use-only is accepted for that component.

### 4.2 Paid listening data (recovering the Part-1 gap — single-source numbers, verify before budgeting)

- **Crowd MUSHRA validity**: Interspeech 2025 (Lechler et al., arXiv:2506.00950) reports crowd-vs-
  expert-lab Pearson **≈0.95 on Prolific**, ≈0.89-0.90 on MTurk, test-retest 0.98-0.99 — for
  *speech quality*. Transfer to music *preference* judgments is plausible and **undemonstrated**;
  run a small internal validation batch before trusting it. ITU P.808 has a validated open-source
  crowd pipeline (Microsoft, Interspeech 2020); webMUSHRA is the standard free framework.
- **Costs**: Prolific enforces $8/hr minimum, recommends ~$12/hr, +~33% service fee → back-of-
  envelope **$0.09-0.14 per short clip rating**; ~$100-150 per 1,000 ratings; MTurk is cheaper
  (~$2-2.83/hr median worker earnings per CHI 2018) and both ethically and quality-wise worse.
- **Expert vs crowd**: aggregate expert and non-expert music-aesthetics judgments correlate
  **r≈.79**; non-experts reach similar reliability only with larger samples (α≈0.83 for "quality"
  judgments); recent MIR datasets (MusicEval, MERIT) still use small expert panels for fine
  judgments. Practical read: crowds recover expert *rankings* at ~2-3× the raters; pairwise
  formats are more robust with non-experts than absolute scales.
- **Relevance check**: given Part 1's finding that ~70-150 of the *owner's own* comparisons may
  suffice — and that cross-person data helping a personal model is unproven (open question #2) —
  paid data is a later-stage option for validating the critic's transfer (evaluation ladder rung
  5), not a training prerequisite.

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
