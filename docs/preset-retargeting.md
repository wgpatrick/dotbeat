# Preset retargeting

*Owner's idea, 2026-07-26 (verbatim): "take known presets that we already have in surge / engineplus
and then try to make them hit those parameters." This doc is the design, the measured feasibility
numbers, and the honest ceiling read. Code: `src/retarget/`, `scripts/retarget-presets.mjs`,
`scripts/retarget-surge-presets.mjs`. Companions: research/131 (the discriminators and their target
values), research/138 (the parity plan whose §2 free-wins table this rediscovers from audio),
`docs/t6-sound-matching.md` (the `beat match` harness this borrows its CMA-ES and its
inject-the-renderer shape from).*

## The thesis, and why it is not the search that already failed

A factory or curated preset is a **human-designed known-good point**. Research/131 measured the
handful of scalar features that actually predict the owner's preference. So instead of searching a
huge patch space, retargeting does LOCAL optimization from a good preset toward measured targets.

Two prior results define the shape of the problem, and this design is built around both:

- **The T5 scaling gate** (research/117, `docs/pilot.md`): critic-guided search over a large patch
  space from random inits LOST to random controls. The answer here is that there is no large space:
  every parameter starts at the preset's own value and may move at most one **trust radius**, and
  the loss charges for displacement on top of that.
- **The T6 ceiling study** (`docs/t6-sound-matching.md`): matching FULL SPECTRA of produced chops
  was found unreachable. This is a categorically easier problem — 9 SCALAR targets per role, not a
  multi-scale mel spectrogram. The T6 result is not evidence against it.

## Feasibility, measured before anything was built

All numbers from this machine, 2026-07-26, on the real render paths.

| | engine (offline Chromium) | surge (`python/surge_render.py`) |
|---|---|---|
| one render | **1.02 s** (8 s clip, 4 bars @ 120 BPM) | **0.52 s** (9.45 s clip) — *includes* process spawn, patch load, WAV write |
| feature extraction | **0.11 s** (`analyze`) / ~0.3 s with the full retarget feature set | same (shared code) |
| **one evaluation** | **~1.35 s** measured end to end in the real runner | ~0.8 s serial |
| session boot | 1.1 s (once per run; recycled every 350 renders) | none — one process per render |
| parallelism | one headless session; N sessions would be a straight multiplier, not built | 8-way: 8 renders in **1.57 s** wall = **0.20 s/render**; 12-way = 0.17 s |
| **one preset @ 300 evals** | **~6.8 min** | ~4 min serial, **~1 min at 8-way** |
| **6 presets** | **~41 min** | ~6 min at 8-way |
| **a role's worth (12 presets)** | ~82 min | ~12 min at 8-way |

**The prompt's assumption that surge would be the expensive backend is measurably backwards.**
Surge is roughly 2x cheaper per render and parallelizes trivially, because each render is an
independent OS process; the engine funnels every render through one headless browser page.

Budget sizing: 300 evaluations at population 12 (25 generations) over 22 dimensions. The measured
loss curves flatten between eval ~150 and ~250, so 300 is comfortably past the knee and 500 would
buy little (see the curves under `taste-dataset/retarget-check/*/​*--loss-curve.jsonl`).

### The surge blocker, and what it cost to clear

Surge retargeting was blocked on a real contract bug, not on cost. `surgepy.setParamVal` takes a
parameter's **native** value, but `python/surge_render.py`'s `overrides` path documents and
validates itself as "normalized 0..1" and rejects anything outside that range. On this build
`A Filter 1 Cutoff` spans −60..70 (13.75 Hz .. 14 kHz) and the 0..1 window reaches
**440.00 .. 466.16 Hz** — a 26 Hz sliver of a 14 kHz range. Parameters whose native range happens
to *be* 0..1 (resonance, EG sustain) were unaffected, which is how it survived unnoticed.

`overrides` was left exactly as it was — redefining it would silently reinterpret every render
cached against it (`cli/surge-render-prep.mjs` hashes the override list into its cache key). The
additive `nativeOverrides` field and a `--dump-params` mode were added alongside, with tests.

## The objective

`src/retarget/targets.ts` holds one profile per pitched role (`bassline`, `chords`, `lead`).
`drum-loop` has none: research/131 P6's drum targets are composition/kit levers, not synth-patch
parameters.

Each scored axis is `{ key, kind: atLeast|atMost|band, edges, scale, weight, basis }`. Thresholds
come from one of two places, and every row says which:

1. a number research/131 §7 or research/138 §2 states in words (`bandSubPct >= 30%`,
   `centroid <= 90 Hz`, `crest_subDb <= 11 dB`, `attacks <= 12/8 ms`, `crest 15-18 dB`,
   `flatnessHiDb -16..-8`, `bandMidsPct <= 90`);
2. a quantile of the owner's **own pack-ref pool**, measured with `src/retarget/features.ts` via
   `scripts/mine-retarget-targets.mjs`.

(2) exists because `features.ts` re-implements 131's feature definitions from prose rather than
porting its python. **Most axes reproduced that pipeline closely**, which is the strongest
available evidence that the re-implementation is sound:

| axis | this pipeline (pack refs) | research/131 | verdict |
|---|---|---|---|
| bassline centroid | p50 **76.2 Hz** | 74 Hz | agree |
| bassline crest_sub | p50 **5.4 dB** | 7.2 dB | agree |
| bassline sub share | p50 **50.1 %** | 60.1 % | agree (different aggregation) |
| chords truePeak | p50 **−1.72 dB** | −1.7 dB | agree |
| chords crest | p25–p75 **15.1–18.8 dB** | 15.5–18.3 | agree |
| chords flatnessHi | p25–p75 **−20.5..−10.5 dB** | −16..−8 band | agree |
| chords slope | p50 **−12.9 dB/oct** | −10..−14 | agree |
| chords onset rate | p50 **4.46 /s** | 4.9 | agree |
| lead attackP25 | p25 **7.0 ms** | ≤8 ms | agree |
| chords/lead width | p50 **−3.3 / −6.9 dB** | −3..−8 / −5..−8 | agree |
| **fluxMean/fluxP95** | chords p50 **0.88** | 0.17–0.26 | **4–5x scale mismatch** |
| **attackMedMs** | chords p50 **43.9 ms** | ~24 ms implied | **~2x slower** |

The two disagreements are handled, not averaged: the flux rows use ref quantiles in *these* units
(quoting "fluxMean ≥ 0.17" here would be meaningless), and attack scoring uses `attackP25Ms` —
where the two extractors agree — with `attackMedMs` reported but never scored. Research/131 §8 puts
±30 % on its own ms thresholds for the same reason.

**Weights are measured effect sizes, not opinions**: mostly `|paired d|` from 131 §3.1's packs-era
ref-beat-engineplus head-to-head (truePeak 1.38, fluxMean 1.06, crest_sub 0.74, crest 0.69,
flatnessHi 0.66, attack 0.63, crest_bass 0.54, slope 0.47), with §2.2's per-role discriminators
where the head-to-head has no row.

**`widthMeanDb` is never scored.** 131 P5's role width map is real, but the engine renders a solo
synth voice in mono, so width is a production decision no patch parameter can move — scoring it
would hand the optimizer a free, meaningless axis. It is reported as informational. Surge renders
*are* stereo, so width is measurable there; it is still not scored, because the profiles are shared
and scoring an axis on one backend but not the other would make their losses incomparable. A
surge-specific width target is a stated follow-up.

### The loss: four terms, each aimed at a measured failure mode

```
total = gap + 0.5·regress + 0.35·preserve + 0.5·drift
```

- **`gap`** — a weighted **power mean with p = 3** over per-axis misses, each **clipped at zero**
  once the axis is satisfied and **capped at 3 scale units**.
  - *p = 3 is the anti-gaming half.* A plain weighted sum lets the optimizer buy a big win on one
    cheap axis and ignore an expensive one. 131 §5's finding is that the gap is "many medium-sized
    axes with role-specific signs" and that a single global knob "would provably help one role and
    hurt another", so the objective has to punish a lopsided miss harder than an even one. It does:
    two axes at (0, 2) score worse than two axes at (1, 1).
  - *Clipping at zero kills the width-hack shape of failure.* 131 §5 measured engineplus as already
    WIDER than the refs beating it — more of a satisfied axis is worth exactly nothing here.
  - *The cap keeps one hopeless axis from eating the budget.* 131 §5's ceiling finding says
    unreachable axes are real, so the loss must degrade gracefully around them rather than spend
    every generation on the one target a patch physically cannot reach.
- **`regress`** — a *quadratic* surcharge on any target the ORIGINAL preset satisfied and the
  candidate does not. "Don't break what's already right", as an asymmetry: losing a property costs
  more than failing to gain one.
- **`preserve`** — drift of the role's non-target identity axes (presence/air share, low-mid
  density, envelope spread, sustain, hit-level and attack variety) beyond a free band of 0.75 scale
  units. The free band exists because identical re-renders already move these (see
  `docs/render-determinism.md`: band shares ~1.6 pt, width ~1.3 dB).
- **`drift`** — mean squared genome displacement from the preset. The trust region's soft half.

### The trust region

`src/retarget/space.ts` declares 22 continuous engine synth fields, each with a **trust radius** in
genome units. `cutoff` gets 0.18 of a 7.6-octave range (≈1.4 octaves of travel); `subLevel` gets
0.7 and `osc2Detune` 0.6, deliberately wide, because those are the levers research/138 §2 rows 1
and 3 name by number. CMA-ES then searches a **trust cube** in which every dimension is affinely
mapped onto its own radius, so one scalar step size is correct across radii that differ by 4x, and
the preset always sits inside the cube. The preset itself is evaluated first and anchors the run:
a retarget can never report a result worse than what it started from.

Deliberately outside the space, each for a stated reason: `volume`/`pan` (features are
loudness-normalized, renders are mono), discrete fields (changing a preset's oscillator is not a
retarget of that preset), LFO rate/depth (the match harness excluded LFOs for a measured reason —
temporal-phase misalignment makes frame-statistic objectives noisy on them), and sends (bus tails
the fixed render window truncates ambiguously).

## Method notes

- **What is optimized**: the RAW soloed engine voice, no engineplus production pass. The patch is
  the only variable; production is a separate lever with frozen profiles (CLAUDE.md's frozen-science
  rule). Nothing in `src/retarget/` touches `engineplusProfile`/`surgeplusProfile`.
- **The held-out figure**: the search uses one composed figure per role, and every winner is
  re-measured on a SECOND composed figure the search never saw, so "did this overfit the figure"
  gets a number instead of a hope.
- **Privacy**: before/after wavs, `.beat` files and loss curves are written to
  `~/Documents/dotbeat/taste-dataset/retarget-check/` — outside the repo, never committed. Only
  parameters and aggregate features reach `presets/`. `scripts/mine-retarget-targets.mjs` reads the
  private pack-ref pool and prints aggregate statistics only, the same rule research/131 followed.

## Wiring the output

`presets/engine-retargeted.json` follows `presets/engine-curated.json`'s shape (a `roles` map of
patch rows carrying `id`, `source`, `category`, `params`) plus a `provenance` block per row: the
preset it came from, the loss version, budget, seed, the figure archetype, targets-hit before and
after, the held-out gap, exactly which parameters moved, and which targets were never reached. A
future showdown arm can draw from it the same way `beat showdown` draws from the curated bank.

`presets/surge-retargeted.json` names patches by `relPath` exactly as `presets/surge-curated.json`
does and carries a `nativeOverrides` list per row — no patch content is copied into the repo, so
the open Surge factory-content licence question (surge #6741) is unchanged by it.

## Reproducing

```
npm run build
node scripts/mine-retarget-targets.mjs --out /tmp/ref-targets.json     # needs the private ref pool
node scripts/retarget-presets.mjs --roles bassline,chords,lead --per-role 2 --budget 300
node scripts/retarget-surge-presets.mjs --roles bassline,chords,lead --per-role 1 --budget 200
```

Tests: `test/retarget-features.test.ts`, `test/retarget-loss.test.ts`,
`test/retarget-harness.test.ts` (all browser-free and pure), plus
`test/retarget-surge-sidecar.test.ts` (gated on a built surgepy, with a named skip reason).
