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

## Proposed tooling shape (not yet built)

`beat vary <file> <track> --param kickTune=28..45 --param kickDecay=0.25..0.7 -n 8` → renders
n candidates + a manifest; `beat score <manifest> 3,1,4,...` → appends to a scores log
(`.beat-scores.jsonl`, git-tracked); the agent (or the taste prior) proposes the next round.

## Status

- Concept filed; ROADMAP §7 and feature inventory updated.
- First live demo run the same day: 6 kick variations rendered and scored-by-owner over chat.
- Deep-research pass queued (interactive/evolutionary synth-patch search, preference-based
  Bayesian optimization for audio, human-in-the-loop scoring UX, sound-matching literature) —
  will be `docs/research/08-*` when it lands (07 = sound-design/presets pass, in flight).
