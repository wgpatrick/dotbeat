# 117 — Critic-guided search in practice: who has actually run it, and what happened

*Run 2026-07-21 for the T5 build/wait decision. Single-agent search-and-fetch pass; key numbers
verified against primary sources where fetchable (exact quotes marked). Builds on
`107-taste-model-program.md` (theory + adjacent evidence) and the raw quad-scan
(`raw/2026-07-21-daw-automation-quad-scan.md`), whose directly-relevant hits are re-used and
extended here rather than re-found. Confidence labels: **(high)** primary source fetched or
multiply corroborated, **(medium)** corroborated search extracts / well-established knowledge
with unverified URL, **(low/S)** single-source. Companion design under review:
`docs/taste-loop-design.md` T5 (CVT archive, CMA-ME emitters, DSA-ME surrogate pattern,
pessimistic scoring, morning audits).*

## The question 107 left open

107 established that personal preference models are learnable from small data (Part 1) and that
quality-diversity beats pure fitness loops in creative domains (Part 3). It did **not** answer:
has anyone actually *run* extended search against a learned individual-preference model, and did
the search find genuinely better artifacts or critic-fooling ones? This doc is the implemented-
systems record, and the verdict for T5 given dotbeat's current critic (n≈85 rated batches;
`dsp+aes-bt` at **36.6% held-out top-1 vs 21% chance, 64.4% pairwise vs 50%**; strong on showdown
batches at 76% pairwise; **0% top-1 on gen splits** — a known blind spot).

The one-sentence answer: **nobody has run dotbeat's exact loop (long offline QD search against a
single person's learned music taste) — but every ingredient has been run somewhere, the failure
mode is quantitatively well-characterized, and the successes cluster into two regimes dotbeat can
choose between: huge-data offline critics (MusicRL) or tiny-data short-leash loops (the
human-in-the-loop BO family). T5 as designed is deliberately the second regime; the evidence says
build it as a constrained pilot with the leash even shorter than drafted.**

## Part 1 — Implemented systems, by class

### 1.1 Real-human-fitness deployments (no learned critic — the Goodhart-free ceiling case)

These systems used *actual human preferences* as fitness, so they bound what search-with-a-
perfect-critic achieves.

- **DarwinTunes** (MacCallum, Leroi et al., PNAS 2012) — audio loops evolved for **2,513
  generations under 6,931 public raters** (5-point scale → selection for "sexual" recombination).
  Loops demonstrably evolved from noise toward music (independent listeners ranked later
  generations higher), **then progress plateaued**; a Price-equation decomposition attributed the
  stasis mostly to **decreasing transmission fidelity** (good material being destroyed by
  recombination/mutation faster than selection could fix it), not to satisfied preferences.
  (high) https://www.pnas.org/content/109/30/12081 ,
  https://pmc.ncbi.nlm.nih.gov/articles/PMC3409751/
  **Lesson for T5:** even with a *perfect* critic (real humans), a generate-score-breed music loop
  plateaus — and the binding constraint was the *variation operator*, not the fitness signal. This
  rhymes with dotbeat's own showdown finding that the generator/engine, not the critic, is the
  current quality bottleneck (engine 0-of-15 pairwise wins vs refs).
- **Picbreeder** (Secretan et al.; objective-paradox analysis Woolley & Stanley, arXiv:1207.6682)
  — collaborative human-selection image evolution; the famous negative result (107 §3.2): its best
  artifacts **could not be re-evolved when made an explicit objective**. Direct-objective search
  fails where human-guided stepping-stone search succeeded. (high)
- **Galactic Arms Race** (Hastings, Guha, Stanley, CIG 2009 best paper) — cgNEAT evolved particle
  weapons in a deployed multiplayer game with **implicit** preference fitness (which weapons
  players actually kept using); players never knew they were the fitness function, and evolution
  produced content players kept engaging with. The strongest evidence that *passively harvested*
  individual preference can drive content search in production. Outcomes are engagement-based, not
  blind-rated. (high)
  https://www.semanticscholar.org/paper/51fdf94e347c97271aa6fe1cbb0635a1d5c81885
- **MutaSynth** (Dahlstedt, Organised Sound 2001) and the IEC-for-sound lineage — interactive
  evolution of synth patches (Nord Modular etc.), practice-based; users "valued unexpected output"
  and used it exploratively; a later automated-fitness version was exhibited (Gaudeamus 2002).
  **No quantitative outcome measures exist** in this lineage — it validates the workflow's
  creative value, not any critic-quality claim. (medium)
  https://www.cambridge.org/core/journals/organised-sound/article/abs/mutasynth-in-parameter-space-interactive-composition-through-evolution/EC5207907A5B017E390EC5B8A6326E59
- **Takagi's IEC survey** (Proc. IEEE 2001) is the canonical record that people have tried
  training a model of the user *to replace* the user in IEC since the 1990s (to beat the
  10-20-evaluations-per-session fatigue ceiling); the recurring reported problem is that the
  learned predictor degrades as evolution moves out of the distribution it was trained on —
  the same extrapolation failure T5's coarse-amount training batches are designed against.
  (medium — well-established survey, specific predictor-degradation framing from secondary
  literature, URL not fetched this pass)

### 1.2 Learned-critic optimization in music/audio (the direct analogues)

- **MusicRL** (Google DeepMind, ICML 2024, arXiv:2402.04229) — the only large-scale deployed
  "optimize a music generator against a learned human-preference model": MusicLM finetuned with
  RL (KL-regularized) against a reward model trained on **300,000 pairwise preferences** from
  deployed users. Outcomes (human raters): MusicRL-R (designed rewards) preferred over baseline
  **65%**, MusicRL-U (user-preference RM alone) **58.6%**, sequential MusicRL-RU **87%** win rate
  vs baseline and beats both single-reward variants. Genuine improvement, no reported degenerate
  collapse — at 3-4 orders of magnitude more preference data than dotbeat has, plus KL
  regularization. (high) https://arxiv.org/abs/2402.04229
- **SMART** (Jonason, Casini, Sturm, arXiv:2504.16839) — **the closest published run to T5's
  risk profile, and it optimizes dotbeat's own strongest feature**: a piano-MIDI generator
  GRPO-tuned against **Audiobox-Aesthetics** scores of rendered audio. Verified from the
  abstract: a 14-participant listening study showed **improved average subjective ratings** —
  and "**over-optimization dramatically reduces diversity** of model outputs." (high for both
  findings) The quad-scan additionally reports the mitigations as KL penalty, entropy bonus, and
  early stopping at reward saturation (S — not re-verified from the full text). So: pushing on
  the aesthetics axes dotbeat's critic leans on produces *real* human-rated gains at moderate
  pressure and *diversity collapse* when pushed — both halves of the T5 question, answered in
  miniature. https://arxiv.org/abs/2504.16839
- **TangoFlux / CRPO** (arXiv:2412.21037) — text-to-audio model that each epoch generates
  candidates, ranks them with CLAP, and DPO-trains on the fresh ranking: literal iterated
  hill-climbing on a learned audio critic. Its structural finding is that **regenerating the
  preference data online every cycle** is what keeps optimization from going stale/off-policy —
  the training-loop mirror of T5's "morning picks retrain the critic before the next night."
  (high for design; performance claims not re-verified) https://arxiv.org/abs/2412.21037
- **DRAGON** (arXiv:2504.15217) — reward-guided music diffusion supporting *distributional*
  rewards (match a reference distribution, not maximize a scalar) — one structural anti-Goodhart
  idea: a distribution target can't be maxed out by a single degenerate point. (S)
- **SCORE** (arXiv:2509.19831) and **MR-FlowDPO** (arXiv:2512.10264) — multi-reward composites
  motivated explicitly by single-critic gaming concerns in audio. (S) The field's revealed
  belief: nobody trusts one learned audio critic under optimization pressure.
- **DITTO** (Novack et al., ICML 2024) — inference-time optimization of music-diffusion latents
  against differentiable objectives (intensity, melody, structure). Steering machinery, but the
  objectives are handcrafted features, not a learned personal critic — cited to mark the boundary
  of what exists. (medium; arXiv:2401.12179, id from memory)
- **Synth-patch search against perceptual metrics** (107 Part 2; quad-scan §2) — GA/CMA-ES
  matching with MFCC/spectral composite fitness works, and arXiv:2506.22628 explicitly evaluates
  *which similarity metrics are safe to iterate against* — the same "is this scorer
  optimization-proof?" question, answered metric-by-metric for sound matching. INSTRUMENTAL's
  observation that past ~30 params the optimizer "exploits extreme values instead of matching"
  is a small-scale Goodhart specimen in exactly dotbeat's genome type. (medium)

**Gap confirmed:** no published system runs extended search against a *single individual's*
learned music taste. ROMBO (107 §1.4, 16-user BO over a generative-music latent space) remains
the nearest relative, and it keeps the human in the loop every query. T5 would be first-of-kind.

### 1.3 The image-domain record (the clean before/after experiment)

- **Fooling images** (Nguyen, Yosinski, Clune, CVPR 2015, arXiv:1412.1897) — the canonical
  critic-fooling result: evolutionary hill-climbing on a trained classifier's confidence produces
  images **unrecognizable to humans that the model scores >99% confident**; retraining the model
  on fooling examples labeled as such did not durably fix it (new foolers were re-evolvable).
  This is what "search against a fixed learned critic at high pressure" does by default. (high)
- **Innovation Engines** (Nguyen, Yosinski, Clune, GECCO 2015 best paper) — the same lab, the
  same kind of critic, but MAP-Elites across *all* classes simultaneously (diversity pressure +
  per-niche competition) instead of single-objective ascent: output flipped from adversarial
  garbage to **human-recognizable images** (some accepted into juried art shows). Same critic,
  different search topology, opposite outcome — the single strongest piece of evidence that the
  QD structure in T5 is load-bearing rather than decorative. (medium-high — result is
  well-established; cited from knowledge + the CVPR companion, GECCO URL not fetched this pass)
- **QDAIF** (Bradley et al., ICLR 2024; 107 §3.2) — learned-model-scored QD over creative text:
  elite sets rated by humans as more diverse AND higher quality than fitness-only baselines.
  (high, carried from 107)
- **Image reward-model hacking** — over-saturation/artifact collapse when diffusion models are
  RL-tuned against aesthetic scorers is widely reported (quad-scan cites the analysis at
  arXiv:2601.03468). (S — not re-verified; the qualitative phenomenon is common knowledge in the
  eval literature)
- **ViPer** (EPFL, ECCV 2024, arXiv:2407.17365) — personalization from *one* session of
  free-text comments on a small image set; guided generation then wins the user's own top-1 pick
  **86.1%** of the time (≈6.9× chance). Impressive per-user alignment from tiny data — but it is
  *conditioning*, not iterated optimization: no search pressure ever bears on the preference
  model, so no Goodhart test. (high)
- **Personalized image aesthetics (PIAA)** — per-user models from ~10-100 rated images exist
  since Ren et al. ICCV 2017 (FLICKR-AES, 210 users; residual-on-generic adaptation) with
  meta-learning follow-ups (Zhu et al. 2020). Gains over the generic model are consistently
  *modest* — the personal residual is real but small — and **nobody runs search loops against
  PIAA models** (gap). (medium) https://ieeexplore.ieee.org/document/8237338/

### 1.4 Tiny-data successes: the human-in-the-loop BO family

The systems that *worked* with dataset sizes in dotbeat's range share one design: the human
labels every iteration, so optimization pressure between human contacts is ~one step.

- **Sequential Line Search** (Koyama et al., SIGGRAPH 2017) — preferential BO where each query
  is one slider drag; converged on 6-D photo-enhancement parameters in a handful of queries,
  faster than standard BO; deployed via crowdsourcing. (high)
  https://koyama.xyz/project/sequential_line_search/
- **CoSpar / LineCoSpar** (Tucker, Novoseller et al., ICRA 2020 best paper, arXiv:1909.12316) —
  pairwise-preference optimization of exoskeleton gaits on real users: **tens of comparisons**
  sufficed to consistently converge on user-preferred gaits, including in 6-D. Learned utility
  + Thompson-style sampling, human answers every duel. (high)
- **ROMBO** (107 §1.4) — same pattern in music latent space, 64 samples/session. (carried)
- **GP preference learning / APO / Dope** (107 §§1.2-1.3) — the theory base for exactly this
  regime. (carried)

**The pattern:** tiny-data preference models are *reliable one step at a time and unreliable
many steps out*. Every tiny-data success keeps the model on a one-step leash; every documented
disaster (fooling images; reward hacking) let search run thousands of steps against a frozen
critic. T5's overnight loop is, by design, thousands of critic queries per human contact — the
disaster regime — *unless* its containment does the work. So the containment evidence is the
whole ballgame:

## Part 2 — The quantitative failure-and-containment record

**Gao, Schulman, Hilton, "Scaling Laws for Reward Model Overoptimization" (ICML 2023,
arXiv:2210.10760)** — the reference experiment: optimize a policy against proxy RMs of varying
size/data while a fixed gold RM plays "true" preferences. Verified directly from the paper
(high):

- **Data floor, exact quote:** "For all RM sizes, we observe that for amounts of data less than
  around **2,000 comparisons**, there is very little improvement over near-chance loss." More RM
  data → higher gold scores and less Goodharting throughout the sweep.
- **KL penalty is early stopping, exact quote:** "The KL penalty only causes the gold RM score to
  converge earlier, but does not affect the KL-gold reward frontier... the effect of the penalty
  on the gold score is akin to early stopping." A distance penalty alone does not buy a better
  optimum — only a *sooner stop*. (They note hyperparameter sensitivity.)
- **Best-of-n is gentler than RL** per unit of distribution shift ("RL is far less KL-efficient
  than BoN") — mild selection over a candidate pool extracts real gains long before the
  overoptimization peak that iterated policy ascent hits.

**Coste et al., "Reward Model Ensembles Help Mitigate Overoptimization" (ICLR 2024,
arXiv:2310.02743)** (high):

- Conservative ensemble objectives — worst-case optimization and **uncertainty-weighted
  optimization (mean − λ·intra-ensemble variance)** — "practically eliminate overoptimization,"
  improving best-of-n outcomes up to 70%; for PPO, ensemble-conservatism + a small KL penalty
  prevented overoptimization at no performance cost. **This is T5's step-3 pessimistic scoring
  (mean − β·std), validated in the domain where overoptimization is best measured.** WARM
  (weight-averaged RMs, ICML 2024) reports the same direction. One sharp implication: the
  penalty needs a *real* uncertainty estimate — disagreement across an ensemble (or a GP
  posterior), not a decoration on a single point-estimate model.

**RLHF's own critic-quality bar** — Stiennon et al., "Learning to summarize from human feedback"
(NeurIPS 2020, arXiv:2009.01325) (high): their 6.7B reward model agreed with labelers **66.5%**
of the time, against an **inter-labeler agreement ceiling of 66.9%**. The RM that powered one of
RLHF's flagship successes was a ~66%-pairwise-accuracy model — *at ceiling*. The bar that
mattered was never an absolute accuracy number; it was **accuracy relative to the labeler's own
consistency**, plus KL-constrained optimization and periodic fresh labels.

**Structural containment from the QD side** (medium-high, carried + extended):

- Innovation Engines / QDAIF (above): archive diversity flips the outcome at fixed critic.
- **SMART** is the counterfactual: no archive, pure reward ascent → diversity collapse.
- **DSA-ME / SAIL** (arXiv:2112.03534, arXiv:1702.03713): surrogate-driven QD works when the
  surrogate is *only trusted to nominate*, with true evaluations reserved for nominated frontier
  candidates that then retrain the surrogate — and the archive's spread is itself what keeps the
  surrogate honest across the space. No fetched source this pass frames "surrogate exploitation"
  as a headline failure; the containment is baked into the algorithm's trust structure. (medium)
- **TangoFlux/CRPO**: regenerate preference data every cycle — cadence as containment. (high)

## Part 3 — The transferable verdict for T5

### (a) Will search against the current critic find genuinely-better or critic-fooling variants?

**Both, in a predictable order.** At low optimization pressure (few selection steps per human
contact), a ~64%-pairwise critic behaves like the tiny-data BO successes and like SMART's
pre-collapse phase: real gains are likely, especially on the showdown-like distribution where
the critic is strongest (76% pairwise). At high pressure (thousands of iterated steps against
the frozen critic), the fooling-images/Gao record says degenerate optima are the *default*
outcome — and dotbeat's training data sits *below* Gao's 2,000-comparison floor (~85 batches ≈
**roughly 500 implied pairwise comparisons**, extrapolating from 398 pairs at n=66), the regime
where overoptimization is most severe. Two dotbeat-specific hack vectors are already visible in
the feature-mining: stereo width correlates 1.00 with preference rank and Audiobox
production-complexity is the cleanest separator — an unconstrained optimizer will find "wider
and busier always wins" long before it finds taste. And the critic's **0% top-1 on gen splits**
means any search over gen-adjacent material is steered by a blind critic — that subspace is
currently uncontained by definition.

### (b) The minimum critic quality bar others found necessary

No one has published an absolute threshold. The working precedents are: (i) RM at the labeler's
own consistency ceiling (Stiennon 66.5% vs 66.9%) with constrained optimization; (ii) huge data
(MusicRL 300k) with KL; (iii) any accuracy at all, if the human labels every step (CoSpar,
SLS, ROMBO). The transferable bar is therefore **relative, not absolute**: the critic should be
near the owner's own test-retest agreement *on the distribution the search will visit*, and the
optimization pressure per human contact must shrink as that gap grows. dotbeat has not yet
measured the owner's self-agreement (the designed ~5% repeat probes haven't been reported) —
**64.4% is uninterpretable as a readiness number until that ceiling exists.** If self-agreement
is ~70%, the critic is nearly at ceiling and T5-at-low-pressure is well supported; if ~90%,
there is a real 25-point gap and the leash must be very short.

### (c) Load-bearing vs decorative safeguards, per the evidence

| T5 safeguard (as designed) | Verdict | Evidence |
|---|---|---|
| QD archive (CVT niches) instead of single-objective ascent | **Load-bearing** | Innovation Engines flip; QDAIF; SMART's collapse as counterfactual |
| Pessimistic scoring (mean − β·std) | **Load-bearing — but currently unimplementable**: v0 logistic BT has no posterior. Needs a bootstrap ensemble of BT heads or the GP v1 first | Coste (uncertainty-weighted objective "practically eliminates" overoptimization) |
| Morning audit → retrain → next night | **Load-bearing**, and the cadence is the main dial: it is what separates the tiny-data successes from the fooling regime | CoSpar/SLS/ROMBO; TangoFlux online re-ranking; Gao (fresh data > any penalty) |
| Bounded per-night optimization pressure (small generations, selection close to best-of-n) | **Load-bearing — should be added explicitly to the design**; currently implicit in "budget-bound" | Gao (BoN gentler than RL; KL penalty ≈ early stopping, so *stopping early is the real mechanism*) |
| ε random immigrants | Helpful, secondary — diversity maintenance, not Goodhart containment | QD practice; no direct containment evidence |
| KL-style distance penalty alone | **Decorative** as a quality mechanism (it only stops sooner — which the bounded budget already does) | Gao exact quote above |
| Critic never auto-adopts | Load-bearing for *cost containment*, not for search quality: worst case is 10 wasted morning minutes — which are themselves maximally informative labels | design property |
| Loudness normalization (already shipped) | Load-bearing, and the model for handling the *next* obvious hack (stereo width): normalize or clamp known monotone confounds before the optimizer finds them | dotbeat's own feature-mining; INSTRUMENTAL's extreme-value exploitation |

## Part 4 — Recommendation: build a constrained pilot now

Not full T5, and not wait. The evidence chain:

1. **Waiting for a "reliable" critic is not what any tiny-data success did.** CoSpar, SLS, and
   ROMBO ran the loop with weak-to-nonexistent models and let the loop *create* the data; DSA-ME's
   central insight is that the archive's spread is exactly the training distribution the surrogate
   needs. T5's morning audit is active learning at the frontier — the place research/107 open
   question #4 says labels are worth most. A low-pressure T5 is dotbeat's best data-collection
   engine *even while the critic is weak*, and it directly generates the coarse/edge-region labels
   the target data distribution (taste-loop-design) says T5 needs.
2. **The failure mode is cheap and informative by construction.** Nothing auto-adopts; a
   degenerate frontier costs one 10-minute audit and hands the critic labeled examples of its own
   blind spots — the only fix that worked even partially in the fooling-images line (retraining on
   foolers), here applied every single day rather than post hoc.
3. **But the full-scale overnight loop as drafted sits in the measured disaster regime**: ~500
   pairwise comparisons is 4× below Gao's near-chance data floor for RMs (different domain and far
   smaller feature space — dotbeat's critic *is* above chance — but the data-scaling direction is
   the best available guide), and SMART shows diversity collapse from exactly the aesthetics
   features dotbeat's critic weights most. Thousands of iterated selection steps per night against
   this critic is not defensible yet.

**Pilot spec (deltas against the T5 section of taste-loop-design.md):**

- **Cap pressure at best-of-n-per-niche, not deep ascent**: per night, ~200-500 critic-screened
  candidates, ~50-100 renders, ≤5-10 QD generations. Scale pressure only with critic evidence
  (below). (Gao: BoN extracts gains far before the overoptimization peak.)
- **Implement uncertainty before the loop runs**: bootstrap ensemble (k≈10) of BT heads over the
  existing feature pipeline; score = ensemble mean − β·ensemble std. This is the one designed
  safeguard with the strongest evidence that is not currently buildable as specified. (Coste)
- **Fence off the gen subspace** until the 0%-top-1 gen blind spot improves — search only
  synth-param/feel/drum genomes where the critic has measured signal, or route gen candidates
  straight to morning audit unscored.
- **Neutralize the visible hacks up front**: batch loudness normalization is done; add stereo
  width to the normalized-or-clamped list and monitor Audiobox-PC drift per generation (a
  monotone climb in PC with flat morning ratings is the Goodhart alarm going off).
- **Report the self-consistency ceiling first**: run/score the repeat probes and publish
  owner test-retest agreement next to the critic's 64.4% — the single number that turns critic
  accuracy into a readiness measure (Stiennon's precedent: the bar is the ceiling, not 90%).
- **Gate scaling on a control comparison**: each morning frontier includes 2-3 control items
  (random-mutation, no-critic descendants of the same elites). If critic-guided items beat
  controls in the owner's blind picks over ~2 weeks of nights, raise the budget; if controls tie,
  the critic isn't yet adding value over mutation + diversity alone — which the archive still
  makes a productive variation engine (DarwinTunes' lesson that variation, not selection, binds
  first), while the labels keep accruing.

Either pilot outcome pays: frontier beats controls → scale toward full T5 with evidence; frontier
is degenerate or ties → the critic gains exactly the labels it lacks, at trivially low cost.

## Honest gaps

- No published system = a personal-music-taste QD loop; T5 remains first-of-kind, and every
  transfer here (LLM RMs, image classifiers, MIDI-piano GRPO) crosses a domain boundary.
- Gao's 2,000-comparison floor is for large neural RMs on text; dotbeat's ~50-dim BT critic
  beating chance at ~500 pairs already shows the floor doesn't transfer literally — only the
  *direction* (less data → worse Goodharting) is safe to lean on.
- SMART's mitigation details, DRAGON, SCORE, MR-FlowDPO, and the image reward-hacking analysis
  (arXiv:2601.03468) are single-source/unverified beyond abstracts this pass.
- IEC-deployment outcomes (MutaSynth, GAR) are engagement/practice-based, not blind-rated; the
  Innovation Engines GECCO citation and DITTO arXiv id are from knowledge, URLs not fetched.
- Owner self-agreement — the number this doc's verdict most depends on — is still unmeasured.
