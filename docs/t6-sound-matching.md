# T6 — sound matching / the expressiveness ceiling, measured (`beat match`)

*Companion to `docs/taste-loop-design.md` §T6 and `docs/research/107-taste-model-program.md`
Part 2 (the evidence base). Status: harness DONE and self-match-verified; real-target ceiling
runs pending (owner picks 5-10 stem chops).*

"Can dotbeat's synth engine even make sounds like the records I love?" stops being a debate and
becomes an experiment: point `beat match` at a 1-2s chop, let CMA-ES search the engine's own
parameter space for the closest reachable sound, and read the residual. A small gap means the
search recipe doubles as auto-preset-from-reference; a large gap is a measured, per-sound-class
feature-request list for the engine. Either answer is valuable — that is why the owner deferred
"make the synths better" until this number exists.

## Command

```
beat match <target.wav> [--track-kind synth|drum-sampler] [--budget N] [--population N]
           [--out <dir>] [--seed N] [--no-clap]
```

- `--track-kind synth` (default): a one-note synth track; the search moves the full source
  surface (osc mix/sub/noise/unison/FM, filter + envelopes, note gate) then the insert chain.
- `--track-kind drum-sampler`: the target chop itself is registered as a sample-backed drum
  lane and the search moves the Phase-26 drum-sampler surface (start/length trim, AHD envelope,
  filter) plus the insert chain — auto-preset-from-reference for the sampler.
- `--budget` (default 50): total evaluations. **The default is smoke-scale on purpose** — it
  proves plumbing, not the ceiling. Real runs: see budget guidance below.
- `--population` (default 24): CMA-ES candidates per generation (research/107 §2.3's ~24).
- `--out` (default `match-<target-basename>` in the cwd): the run directory (see outputs).
- `--seed`: the whole trajectory is deterministic under (target, seed, budget).
- `--no-clap`: skip the CLAP-cosine report line (it spawns the python embed sidecar).

## Method (the research/107 §2.3 recipe, exactly)

1. **Target analysis.** Decode the chop; measure integrated LUFS; detect f0 (`detectPitch`, the
   same pure-TS detector `beat sample-info` uses). **Pitch is frozen** to the detected MIDI note
   (C3 fallback when unpitched) — spectral losses are provably bad at pitch params (Turian &
   Henry 2020), so the optimizer is never allowed to touch it. Targets longer than 10s are
   refused (matching wants a 1-2s chop).
2. **Candidate projects.** Each candidate is an ordinary one-note `.beat` file (bpm chosen so
   one loop pass ≈ the chop length), built through the real parser and edited with real
   `beat set` paths — so the winning patch is diffable, replayable, and carries zero
   harness-specific format.
3. **Loss** (loudness first, then three spectral/temporal terms):
   - target and every candidate render are **gain-normalized to a common LUFS** (BS.1770, the
     repo's own `src/metrics/loudness.ts`) before any feature — level can never buy loss;
   - **log-mel multi-scale spectral distance** (FFT 2048/1024/512, mel-banded, floored at
     -60 dB below each spectrogram's own peak so inaudible noise floors don't dominate);
   - **MFCC distance** (13 coeffs over a 40-band mel — competitive with deep embeddings against
     human timbre ratings, ISMIR 2025);
   - **envelope distance** (log-RMS frames, same -60 dB relative floor).
4. **Staged search** (`src/match/harness.ts`):
   - *screen*: the **discrete** params — osc type x filter type (15 combos for synth) — are
     enumerated as separate short runs (~25% of budget split across combos; at tiny budgets each
     combo gets one probe render at the initialization genome);
   - *source*: CMA-ES over the winning combo's continuous source params (~70% of what remains);
   - *inserts*: CMA-ES over the insert-effect params with the source winner frozen (the rest).
   Each stage's space stays well under ~30 dims and every range bounds the *musical* region
   (INSTRUMENTAL's failure mode: past ~29 params the optimizer exploits extremes instead of
   matching).
5. **Rendering** is the slow step, engineered accordingly: ONE offline-compute engine session
   (daemon + vite + headless Chromium, the same machinery `render --batch` boots per batch)
   serves the entire run via the daemon's file-watch hot-swap — recycled every ~350 renders
   (measured: the headless page degrades near render ~580; a fresh page every 350 costs one
   boot per ~6 minutes of rendering). Every evaluation is **cached** by candidate-content hash
   (`<out>/eval-cache.jsonl`), so re-running with a bigger `--budget` replays the identical
   trajectory for free and spends renders only on the extension — this also makes a killed or
   crashed run resumable by simply re-running the same command.
6. **CMA-ES itself** (`src/match/cmaes.ts`) is a dependency-free ~250-line implementation of the
   standard algorithm (Hansen's tutorial: CSA step-size, rank-one + rank-mu covariance, Jacobi
   eigendecomposition per generation), unit-tested on sphere/rosenbrock/bounded functions before
   it ever touched audio (`test/match-cmaes.test.ts`).

## Outputs (in `--out`)

| file | what |
|---|---|
| `best.beat` | the winning one-note project (render it, listen) |
| `best.wav` | its render (loudness-normalize before comparing by ear) |
| `patch.txt` | the patch as plain `beat set` path/value lines — replayable onto any synth (or drums) track by swapping the `match.` prefix for your track id |
| `loss-curve.jsonl` | one line per evaluation: `{eval, render, stage, label, loss, best, cached?}` |
| `report.json` | target info (frozen pitch, LUFS), per-stage renders + best loss, the best patch, and the **ceiling** block |
| `eval-cache.jsonl` | the resume cache (safe to delete; keyed by loss version + target + candidate hash) |
| `project/` | the scratch project the render session watches (`current.beat`, plus `media/` in drum-sampler mode) |

## What the ceiling report means

`report.json`'s `ceiling` block is the headline: **MFCC distance** and **CLAP cosine** between
the target chop and the best render — the two metrics with human-validation evidence
(research/107 §2.2). The optimization loss is NOT the ceiling number; it is only the search
signal. Reading the pair, per sound class across the owner's 5-10 chosen targets:

- **Both good** (CLAP cosine high, MFCC distance low): the engine can reach this sound class —
  and `patch.txt` is a free preset for it.
- **Both bad after a real budget**: a measured expressiveness gap. Diagnose from the loss
  components (`report.json .best.loss`): a stubborn `mel`/`mfcc` residual on thick/wide targets
  points at source-synthesis limits (INSTRUMENTAL's single biggest lever was unison + noise
  floor — dotbeat HAS both, so the next suspects are wavetable content, FM range, and a
  transient shaper); a stubborn `envelope` residual points at envelope shape limits.
- **Disagreement** (loss converged but CLAP cosine low): the composite loss is matching spectra
  the embedding doesn't care about — worth ears before conclusions.

CLAP cosine needs the python sidecar (`python/requirements-clap.txt`); without it the report
carries a named reason (and can fall back to the `stub` backend, which is labeled as NOT a real
similarity). **Torch is never required for the harness itself.**

Honesty note carried from research/107: no published system has matched against *stem chops of
commercial mixes* — published targets are single notes/one-shots. Polyphonic produced-audio
targets are harder than anything benchmarked; expect the drum-sampler kind (which starts from
the target's own audio) to look much better than the synth kind on such chops, and that is
itself information.

## Budget guidance (owner-side runs)

- Research base: **2,000-5,000 evaluations/target; ~90% of the gain lands early** (INSTRUMENTAL
  reports 90% inside the first ~10K on a comparable space — the curve flattens fast).
- Measured throughput (this machine, 1s chop, offline compute): **~0.5-1.5s per render** after
  the one-time ~15s session boot. A 2,000-render run ≈ 20-50 min; the population renders
  sequentially through one engine session, so wall time ≈ renders x per-render cost.
- Practical recipe: start every target at `--budget 500`; read `loss-curve.jsonl` — if `best`
  is still falling at the end, re-run with `--budget 2000` **using the same `--out` and
  `--seed`** (the cache makes the first 500 free). Stop when the curve is flat.
- Population: keep 24 (default). Tiny budgets auto-shrink stage populations rather than
  starving generations.
- Self-match first: before burning budget on a real chop, `beat render <patch>.beat --offline`
  a known engine patch and match against it (the harness's own correctness proof — see below).

## Verification

- **CI (browser-free):** `test/match-cmaes.test.ts` (optimizer on standard functions),
  `test/match-loss.test.ts` (loss vs synthetic signals with known relationships),
  `test/match-space.test.ts` (docs/edits through the real parser), and
  `test/match-harness.test.ts` — a full self-match through a fake pure-TS engine that reads the
  same candidate documents (staging, budget accounting, caching, artifacts, patch replayability,
  cutoff recovery within an octave).
- **Real-engine self-match** (run 2026-07-18, this machine): target = a known patch (sawtooth /
  lowpass, cutoff 1800, res 0.8, A 0.02 / D 0.25 / S 0.5 / R 0.3, note A3, gate 10/16 steps)
  rendered offline, then `beat match target2.wav --budget 800 --population 16`. Result:
  - pitch frozen at MIDI 57 = the exact target note (f0 detection, high confidence);
  - discrete screen recovered **sawtooth/lowpass** (with spectral init; without it the screen
    picked triangle/bandpass — that failure is what motivated the centroid-seeded cutoff);
  - loss 5.90 (first probe) -> **0.7684** (mel 0.40, mfcc 0.31, env 0.06), 87% reduction;
    ceiling MFCC distance 15.3; stub-CLAP cosine 0.956 (labeled not-real — no torch here);
  - param recovery: cutoff 1654 vs 1800 (~1/8 octave), release 0.40 vs 0.30, gate 9 vs 10
    steps, attack both effectively-instant; decay/sustain traded against each other
    (0.65/0.69 vs 0.25/0.5) and a same-pitch osc2 layer appeared — the expected
    parameter-non-identifiability (audio-space match, not param-space; Masuda & Saito);
  - throughput: ~0.4-0.6s/render; the 800-eval run ~9 min of rendering total, resumed twice
    from cache across harness fixes (581 cache hits on the final invocation, 87s wall).
  Two real bugs were found BY this run and fixed with regression cover: the stage-2 handoff
  dropped the winner's note gate, and the headless page wedges near ~580 offline renders
  (session now recycles every 350).

## Deliberate simplifications (and where they'd go next)

- **Initialization** is a declared per-param init genome (layers off) plus one measured seed:
  the filter cutoff starts near 2x the target's spectral centroid (`applySpectralInit` —
  research/107's spectral-analysis initialization, added after the first real self-match showed
  a fixed bright cutoff init makes the discrete screen rank combos in the wrong neighborhood).
  Envelope->ADSR estimation is the obvious next `MatchParamDef.init` filler.
- **Sends** (reverb/delay) are excluded: they are bus effects with tails that the fixed render
  window would truncate ambiguously. The insert chain is searched; sends are a listening
  decision.
- **LFO/motion params** are excluded from stage 1 (temporal-phase misalignment makes spectral
  losses noisy on LFO params — the JTFS/mesostructures literature); a third stage could add them
  under an envelope-heavy loss.
- **Population renders are sequential** through one engine session. True parallel rendering
  (N sessions) is a straightforward multiplier if wall time ever binds.
