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

**Embeddings.** A frozen pretrained audio encoder (selection per research/107 Part 4 —
license-clean, locally runnable; CLAP/MERT family) run over every variant render, cached next to
the batch. Dimensionality reduction (PCA to ~30-50 dims) is fit on *unlabeled* variants — dotbeat
can render unlimited unlabeled audio, so the projection costs zero preference labels.

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

- **Quality-diversity, not hill-climbing** (method details per research/107 Part 3): a pure
  fitness loop converges to one local optimum — nine near-identical "best hats." A MAP-Elites-style
  archive keeps the best of *each region* (bright/dark, sparse/busy...), which is what makes long
  runs surface interesting-and-compelling rather than converged-and-boring. Descriptor axes come
  from the embedding space.
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

## Build order (each step independently shippable)

| step | what | depends on | proves |
|---|---|---|---|
| 1 | L1 log enrichment + eval harness | nothing | baseline scorers vs 11% floor |
| 2 | L1 embeddings + blind-audition shuffle | 1 | embedding features beat/lose to DSP |
| 3 | L3 v0 BT ranker + `suggest --taste` (advisory pre-rank only) | 1-2 | taste model beats chance |
| 4 | L2 stems/chops pipeline + prior | 2 | cross-domain prior transfers (or not) |
| 5 | L4 overnight QD loop, morning frontier audits | 3 | loop finds keepers faster than random |
| 6 | Sound-matching mode (ceiling measurement / auto-preset) | 5's loop | engine ceiling, per class |

Steps 1-3 are small and use only existing infrastructure (score log, metrics, vary, audition).
Step 5 is where compute spend starts to matter (renders are ~real-time; a 1,000-candidate
overnight run at ~8s/render ≈ 2.2 GPU-free hours — feasible tonight, worth the offline-render
investment later).

## Open risks (honest register)

- Every component is proven only in an adjacent domain; the end-to-end stack is unbuilt anywhere
  (that's the opportunity and the risk).
- Taste may be non-stationary and context-dependent (what the *track* needs, not what the clip is)
  — delta-features and in-context renders are the designed mitigations, unproven here.
- Render throughput is the binding constraint on L4; the retired faster-than-realtime offline
  render path may need resurrecting on dotbeat's own engine (see decisions.md D15's closing note).
- The n needed for audio-production preferences is a guess until step 3 reports.
