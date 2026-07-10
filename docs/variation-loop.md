# The variation-and-taste loop (concept, filed 2026-07-10)

> Idea from the project owner, verbatim intent: *"auto generating many, many variations of a
> synth, 4-bar beat, loop, or even just the sound of an instrument. Imagine making 20
> adjustments to a bass kick sound, I listen to them quick, give very fast scoring, and then you
> do another round... the AI system produces speed, the human focuses on taste."* Plus the
> second-order idea: the scoring exhaust may be trainable — in-context learning at minimum,
> possibly a preference model that gets better at producing sounds.

## Why this fits this project unusually well

1. **It sidesteps the project's own hardest constraint.** Research 03 (fully verified) says
   audio-LLMs can't be trusted to *hear* — that's why D2 makes DSP metrics the only machine
   judge. But metrics can't measure *taste*. The variation loop routes around both limits: the
   machine does what it's verifiably good at (systematic parameter exploration, fast rendering,
   bookkeeping), and the judgment call goes to the one listener in the loop with real ears.
   D2's triangle (metrics judge correctness, human judges taste, model narrates and proposes)
   gets its missing vertex.
2. **Every primitive already exists.** Variations are `beat set` grids or store-level patch
   overlays; rendering is browserless and CI-cheap; every variation is a one-line diff from its
   parent, so the whole exploration is a git tree of auditioned candidates; scores attach to
   exact parameter vectors by construction. No other DAW can express "the 20 kicks I tried and
   how I rated them" as reviewable text.
3. **The scoring exhaust is uniquely clean training data.** Each round yields
   (parameter vector, render, human score) triples with *controlled* variation — one knob-grid
   at a time, not found-in-the-wild confounds. Options, in ascending ambition:
   - **In-context steering** (no training): recent scores ride along in the agent's context;
     "you rated darker kicks higher in the last 3 rounds" shapes the next grid. Free, immediate.
   - **A taste prior** (classical ML, no neural net needed at small n): preference learning
     (Bradley-Terry / Gaussian-process preference models) over the parameter space, actively
     proposing the next round's grid — this is interactive Bayesian optimization, and there is
     decades of prior art on evolutionary/interactive synth-patch search to mine (research
     queued, below).
   - **A generative patch model** (speculative until data volume says otherwise): train on
     accumulated (context, high-scored patch) pairs. Explicitly a maybe; the first two rungs
     must prove the loop first.

## Interaction design constraints to respect (to be validated by research + real use)

- Listening fatigue is the budget: rounds of ~5-8 short candidates beat rounds of 20; scoring
  must be near-instant (rank or 1-5 tap, not essays).
- Candidates must differ *audibly*, not just numerically — perceptual spacing of the grid
  matters more than uniform parameter spacing.
- Every audition ships with provenance: the one-line diff that produced it.

## Tooling (rung 1 — BUILT 2026-07-10)

Design follows the verified prior art
([docs/research/08-variation-loop-prior-art.md](research/08-variation-loop-prior-art.md)) —
batch 9 (MutaSynth's population), one strength knob, mutation scoped to one parameter group at
a time through musically-nonlinear ranges, ranked pick of ≤3 (Edisyn's (3,16) pattern):

```bash
beat vary song.beat drums kick --seed 42          # 9 small-diff variants + manifest.json
beat vary song.beat drums kick --render           # ...and render each for auditioning
beat vary --groups                                # kick, snare, hats, filter, env, filterenv,
                                                  # osc, motion, fx, sends, mix
beat score batch1 3 7 1                           # ranked pick, best first -> beat-scores.jsonl
```

Every variant is a replayable `beat set` edit list; the scores log is append-only JSONL carrying
(parent hash, group, amount, seed, ranked picks with their exact diffs, rejected set) — the
scoring exhaust for rungs 2-3. `beat score` prints the one-liner that adopts the winner.
Implementation: `src/vary/vary.ts` (pure, seeded, deterministic), `cli/beat.mjs`. Caveat noted
in every manifest: offline renders are nondeterministic run-to-run (phase-5 finding), so only
compare renders within a batch.

## Status

- Concept filed; ROADMAP §7 and feature inventory updated.
- First live demo run the same day: 6 kick variations rendered and scored-by-owner over chat.
- Deep-research pass complete — `docs/research/08-variation-loop-prior-art.md`, 25/25 claims
  confirmed 3-0. The loop is a documented lineage (Eno → MutaSynth → Evosynth → Edisyn);
  design numbers above are its verified convergence points.
- Rung 1 (`beat vary` / `beat score`) built and tested the same day (105-test suite).
- Next rungs, gated on accumulated exhaust: preference surrogate + clustering (peer-reviewed
  precedent), then preferential BO / plane-search — unproven on audio, a genuine experiment.
