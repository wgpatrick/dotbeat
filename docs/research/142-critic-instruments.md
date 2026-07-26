# Research 142 — The measurement instruments 138 and 140 said to ship first: critic upgrade, rolecheck, grind detector, and the two gates that never fired

*Run 2026-07-26. Commissioned to build the instruments docs 138 and 140 name as rung 0 — the
things every later experiment is scored BY, which were all still unbuilt. Four items, all from
the 140 audit: **D16** (the critic feature upgrade 131 measured and 138 gated the whole build list
on), **D26** (`beat rolecheck`), **D18** (the bass-grind detector for the founding owner
complaint), **D23** (two pre-registered decision gates that were designed and never fired).
Plus the ruling 140 §4.4 says two prior agents declined to give: is `FEATURE_KEYS`
append-only-safe? Everything here is measured on the owner's existing rated log
(`examples/taste-t1/beat-scores.jsonl`, 243 usable batches / 170 showdown / 1,581 preference
pairs) and the four reference pools; no new owner ratings were spent. Private-data rules
respected throughout: aggregate statistics only, no reference filenames, no audio (D25).
Branch: `critic-instruments`.*

## Headline answers

1. **`FEATURE_KEYS` was NOT append-only-safe, despite its own docstring saying it was.** A blind
   append would have silently *degraded* the critic rather than upgrading it, by three independent
   mechanisms verified by reading every consumer (§1). The blocker that stalled D16 for two agents
   was real. It is now resolved the way 140 §4.4 option (a) describes — append + version + retrain
   + the key-set snapshot test that 136 §5 and 140 §4.4 both asked for and neither got.
2. **The critic upgrade reproduces research 131's numbers.** Held-out pairwise accuracy on the
   owner's own preferences, 131's exact methodology re-run with the new TS extractor: log-13
   **0.677** (131: 0.676), new-features-only **0.727** (131: 0.727), synth-only log-13 **0.685**
   (131: 0.688), synth-only new-only **0.752** (131: 0.757). The combined set lands at **0.774**
   against 131's 0.795 — a +9.7-point lift where 131 predicted +11.9 (§2.3 investigates the
   residual and rules out the two obvious causes). Through the shipped harness's own leave-one-
   batch-out method, `dsp-bt` moves **0.660 → 0.731** overall and **0.690 → 0.771** on the
   showdown split, with every per-type split improving. (High.) §2
3. **The two feature extractors whose units disagreed now agree to 8×10⁻⁵.** 140 §2-D16 called
   this "a hazard that compounds every day it persists." `src/metrics/rich.ts` is a line-by-line
   port of 131's own pipeline, pinned to it by a fixture test; 19 of 23 features agree to 1e-11 or
   better. The port shipped with a convolution-centring off-by-one that moved every attack time by
   1.6%; the parity test caught it, which is the argument for having one. (High.) §2.1
4. **`beat rolecheck` exists, and building it found a live calibration defect in 131 itself.**
   Three of research 131 §7's targets are stated GLOBALLY while the doc's own per-role table shows
   the range varies by role — `fluxMean >= 0.17` against a bassline reference median of 0.166,
   `attackMedMs <= 12` against a chords reference median of 12.5, `slope <= -10` against a lead
   reference median of -9.9. Applied literally, each would fail **more than half of the owner's
   winning references for that role**: research 134 §5's "the screens reject the quality bar
   itself", reproduced from a different direction. Every bound is now clamped to its role's median
   reference clip, and the clamp is a test. (High.) §3
5. **The bass-grind detector as research 121 §3.7 specified it would have condemned 37.5% of the
   owner's own commercial bass references.** Its three clauses do separate the owner's matched A/B
   pair, but they are not selective: shipped verbatim the rule fires on 37.5% of packs bass refs
   and 19.7% of all in-scope reference clips. The missing fourth clause is the one the research had
   already named and nobody had built — 122 §4.1's per-band spectral flatness, i.e. the "no pitch
   definition" the complaint was actually about. Adding it takes the false-positive rate to **0 of
   61 in-scope reference clips (0 of 24 packs)** while still flagging the bad stem and passing its
   fix. Every clause is load-bearing (§4.2 ablation). (High on the FP numbers; the pair is still
   n=1.) §4
6. **Gate A (133 §7, the `packplus` arm): the arm was never built, but its question is answerable
   from data that already exists, and the answer triggers its ELSE branch.** Adding a production
   chain to the same figure and patch is worth 97.6% head-to-head (engineplus over raw engine, 42
   batches, all four roles) — and after buying all of that, ref still beats engineplus **87.3%**
   and gen beats it **83.1%**. A *second* production chain on a different source buys nothing
   (surgeplus over surge: **46.2%**, below chance). Production-chain depth is not where the
   remaining gap lives; the gate's contingent instruction — transient shaper + OTT jump the queue
   — is triggered, and independently corroborated by 131 §3.1 (truePeak d +1.38, the strongest
   head-to-head discriminator in the log). 133's secondary prediction is **inverted** by the data:
   it expected bassline to move least, and bassline is the role *closest* to the refs (75.6% vs
   chords 92.5%, drums 95.5%). (High.) §5.1
7. **Gate B (134 §4.3-M1, the match ceiling run): the threshold is crossed by every number that
   exists — 2.06× / 3.10× / 3.78× the self-match floor against a "≥2× ⇒ redirect" bar — but it
   fires on the pre-registration's own INPUT rather than the fresh run it specified.** M1 asked
   for budget 500→2000 on clean targets with a chord-note candidate added to the harness "before
   concluding anything about pads"; the runs on disk are budget 800, and the chord-note candidate
   does not exist in `src/match/`. No evidence points the other way, and 138 §5 already reached
   §6's redirect independently ("parity is NOT supported by any measured path using single-voice
   rendering"). Verdict: **redirect confirmed on lead** (the cleanest target, 2.06×), **confounded
   on chords** by the missing harness change, and the decision it gates has already been taken de
   facto — so it is now recorded rather than left as an unfired pre-registration. (Medium — the
   confound is 134's own.) §5.2

---

## 1. Is `FEATURE_KEYS` append-only-safe? The ruling, with evidence

Research 140 §4.4 names this the blocker behind the whole ladder: *"Two agents have independently
declined to resolve the collision, and one forked instead."* The old docstring on
`src/taste/features.ts` asserted the property. It was wrong.

**Verdict: NOT safe.** Appending a key to the 13-key array would have silently degraded the critic,
by three independent mechanisms — each verified by reading the consumer, not inferred:

1. **The mixed-population zero.** `standardizeBatch` maps `FEATURE_KEYS` over each vector, so a
   record written before the append yields `undefined` in the new column. `zScoreColumns` then
   computed `mean` → NaN, `std` → NaN, and `NaN > 1e-9` is **false**, so the guard skipped the
   write and the column kept its pre-filled `0` — **for every row, including the freshly computed
   vectors that did carry a real value.** One stale vector anywhere in a z-scoring population
   silently deleted the new feature for the whole population.
2. **The unupgradeable log.** `loadTasteBatches` uses a record's stored `features` verbatim and
   computes only when the field is *absent*; `beat taste-eval --backfill` explicitly refuses any
   record that already has `features`. So the rated batches could never acquire a new key by any
   shipped command — they would stay 13-key forever while new batches were N-key, permanently
   triggering (1).
3. **The stale curation cache.** `scripts/curate-engine-presets.mjs` caches a whole feature vector
   per candidate and re-admitted it on a truthiness check (`prev.dsp`) keyed to a `PROBE_VERSION`
   that knew nothing about `FEATURE_KEYS` — so a curation run would mix cached old vectors with
   fresh new ones and hit (1). Its sibling `curate-surge-patches.mjs` is safe: it recomputes.

**What genuinely was safe, and why the answer is not simply "no":** nothing persists model weights
(`ranker.ts` retrains per invocation, by design, and says so); nothing stores vectors positionally
(the log stores named JSON objects — verified across 1,107 stored vectors, all 13 keys present on
every one); nothing hashes or cache-keys on the key list; and `zScoreColumns` is strictly
per-column, so an added column provably cannot move an existing one. **The danger was never
reordering. It was silent partial coverage.**

**The ruling as implemented** (140 §4.4 option (a)): `FEATURE_KEYS_V1` is frozen as a prefix,
`FEATURE_KEYS_V2_ADDED` appends 131 §4's 23 axes, `FEATURE_SET_VERSION` makes staleness
*detectable*, `featureSetVersionOf` classifies any stored vector, `zScoreColumns` now takes its
statistics over finite entries only and imputes the rest at the batch mean, `loadTasteBatches`
upgrades stale records from their still-present renders (cached in a gitignored
`<wav>.features.json` sidecar, matching the existing `.embedding.json` convention), and
`PROBE_VERSION` is bumped with a real version check behind it.

**And the gate that was missing.** `test/taste.test.ts` now snapshots the key list, asserts v1
remains a frozen prefix, and regression-guards the mixed-population zeroing bug. 136 §5 named the
hazard ("new taste `FEATURE_KEY`: ~3 files and silently changes the critic") and proposed this
snapshot; 140 §4.4 asked for it again. **Its absence is the likeliest reason the retarget agent
forked rather than appended** — with no mechanical way to prove an append was safe, forking was
the rational choice. Appending in future is safe **if and only if** `FEATURE_SET_VERSION` moves
with it and the snapshot is updated; that is now enforced, not advised.

Roughness is deliberately **not** in the vector: 131 §4 measured P(win|hi) 0.486 and found winning
references *rougher* than the clips they beat. It stays a pair-relative diagnostic, exactly as
research 123 concluded.

## 2. D16 — the critic feature upgrade

### 2.1 Closing the units hazard first

140 §2-D16 records that a parallel extractor had been forked whose flux ran *"~4-5× higher"* and
whose attack times ran *"~2× slower"* than 131's pipeline: **two feature extractors whose units
disagree**, so no number published against one could be checked against the other.

`src/metrics/rich.ts` is therefore a deliberate line-by-line port of 131's own
`richfeat.py` — matching scipy's STFT geometry, periodic Hann window, `1/win.sum()` scaling (which
is *not* cosmetic: the flatness and slope features add absolute epsilon floors, so the magnitude
scale changes them), activity mask, epsilon floors, and numpy's percentile interpolation.

Agreement over a 120-clip sample, TS against the Python function's own outputs:

| | result |
|---|---|
| features agreeing to ≤1e-11 relative | 19 of 23 |
| worst residual, all 23 | **8.2×10⁻⁵** (attackCv — float accumulation order) |
| clips where the Python emitted a null the TS must substitute | 0 of 120 |

The port initially shipped an `np.convolve(mode='same')` centring off-by-one, which moved the whole
attack family by 1.6%. `test/metrics-rich.test.ts` caught it, and now pins the port at 1e-3 — three
orders of headroom over the residual, tight enough to catch any real change of definition.

Two documented deviations, both because a feature vector must stay finite: a clip with no
detectable onset gets `attackMedMs = 120 ms` (the search window itself) where the Python emitted
null; a mono render gets `widthMeanDb = -80` rather than a missing key.

### 2.2 Reproducing 131 §4's discrimination table

Method as in 131's `model.py`: within-batch z-score per feature, winner−loser z-diffs, symmetric
L2 logistic, **grouped 10-fold by batch**, over the showdown pairs. Two fitters are reported — my
own gradient descent and, to remove the optimizer as a variable, **research 131's own scipy
L-BFGS-B fitter imported verbatim** and run on the TS extractor's features.

| feature set | 131 published | this pass (131's own fitter) | pairs |
|---|---|---|---|
| log-13 (the 11 keys `model.py` indexed) | 0.676 | **0.677** | 1,581 |
| v1 `FEATURE_KEYS` (all 13) | — | 0.693 | 1,581 |
| new features only | 0.727 | **0.727** | 1,581 |
| v1 + new = the shipped v2 vector | 0.795 | **0.774** | 1,581 |
| *synth-only* log-13 | 0.688 | **0.685** | 375 |
| *synth-only* new only | 0.757 | **0.752** | 375 |
| *synth-only* v1 + new | 0.736 | **0.741** | 375 |

Five of the seven rows reproduce within 0.005; the synth-only pair count (375) matches 131's
exactly. **Owner self-consistency ceiling: 0.917.**

### 2.3 The one row that does not reproduce, and what it is not

The combined all-pairs row lands at 0.774 against 131's 0.795 — a **+9.7-point** lift over the v1
critic where 131 predicted +11.9. Two obvious explanations were tested and ruled out:

- **Not the optimizer.** Plain gradient descent gives 0.759; 131's own scipy L-BFGS-B on the same
  matrices gives 0.774. An L2 sweep (l2 = 1 … 3000) peaks at the weakest setting, and *longer*
  training makes it worse (0.759 → 0.715 at 40,000 iterations), so the model is overfitting, not
  underfitting — no regularization setting reaches 0.795.
- **Not width collinearity.** The suspicion was that giving mono renders a real `widthMeanDb`
  (−80) where the Python treated it as missing would add a source-identity proxy collinear with
  `stereoWidthDb`. Dropping either or both moves the result by ≤0.003.

The most likely residual is the pair population: this pass evaluates 1,581 pairs from 170 showdown
batches, while 131's combined row reports 1,538 — `extract.py`'s `dataset.json` applied a
per-feature coverage filter that was not replicated. **Stated as an unreproduced 2.1-point
discrepancy rather than papered over.** The direction, the magnitude class, and every other row
reproduce.

### 2.4 Through the shipped harness

The numbers above use 131's methodology so they are comparable to 131. The instrument that actually
ships uses leave-one-batch-out with the repo's own gradient-descent Bradley-Terry trainer. Same
batches, v1 key set versus v2:

| split | batches | v1 (13 keys) | v2 (36 keys) |
|---|---|---|---|
| **overall pairwise** | 243 | 0.660 | **0.731** |
| overall top-1 | 243 | 40% | **45%** |
| showdown | 170 | 0.690 | **0.771** |
| vary | 44 | 0.610 | 0.626 |
| gen | 18 | 0.426 | 0.475 |
| prodtask | 6 | 0.643 | 0.857 |
| pilot | 5 | 0.500 | 0.528 |

Every split improves. The learned taste directions are now led by axes the old critic could not
see at all: `slopeDbPerOct` −0.35, `flatnessDb` +0.35, `flatnessHiDb` +0.29.

**One caveat with teeth:** `origin/main`'s copy of the score log is **36 rated batches behind** the
working checkout's (147 vs 183 with-sources records). The numbers above are computed against the
current log. Anyone re-running these against `origin/main` will get 0.690 → 0.771 on a smaller
sample and should not read the difference as drift.

## 3. D26 — `beat rolecheck`

`beat rolecheck <file.wav> --role <bassline|chords|lead|drum-loop> [--json] [--targets <f>]`.
Prints measured / target / ref-median / verdict per axis; for every miss, the specific dotbeat
parameter to change, the lever that owns it, and the doc that says so; exits 1 on FAIL so a batch
script can gate on it. Logic lives in `src/taste/rolecheck.ts`, not in `showdown.ts`, so a future
MCP tool shares one implementation.

**Targets are generated, not transcribed** (`scripts/build-role-targets.mjs` →
`presets/role-targets.json`). Every threshold is a percentile of the owner's own 75 packs-era
reference clips for that role, measured with the same extractor the critic uses, carrying the n it
rests on. Where 131 §7 states an absolute target the effective bound is the stricter of the two and
both are recorded. Aggregates only — no filenames, no per-clip values (D25).

The independently computed medians match 131's published numbers, which is a useful check on the
whole pipeline: bassline `crestSubDb` 7.22 (131: 7.2), bassline width −47.5 dB (131: "−47 to −51"),
bassline centroid 77 Hz (131: ~74), chords onset rate 4.86/s (131: 4.9), lead `attackMedMs` 6.12 ms
(131: ~6.2), drum `sustainPct` 51.4% (131: 51), drum `envRangeDb` 23.6 (131: 22).

### 3.1 The defect this surfaced in 131 itself

Three of 131 §7's targets are stated as global numbers while the doc's own per-role table shows the
range varies by role:

| target as stated | role | that role's own reference median | fraction of winning refs it would fail |
|---|---|---|---|
| `fluxMean >= 0.17` | bassline | 0.166 | > 50% |
| `attackMedMs <= 12` | chords | 12.54 | > 50% |
| `slopeDbPerOct <= -10` | lead | −9.95 | > 50% |

This is research 134 §5 arriving from a new direction: *the screens reject the quality bar itself*.
The generator now **clamps every bound to its role's median reference clip**, records the clamp in
the artifact, and `test/rolecheck.test.ts` holds the invariant. It is a cheap rule with a real
history behind it: the ring gate was set from a global intuition and rejects 22% of the owner's own
Splice leads.

**What rolecheck is not.** Its thresholds are reference percentiles, so roughly a quarter of the
owner's own winning references would miss any given `atLeast:25` check. It answers one question:
*did this clip land inside the reference band on the axes measured to matter for this role, and if
not, which knob moves it?* The caveats saying so live in the artifact, not only here, and a test
asserts they are there. Level-dependent checks (`truePeakDb`, `crestDb`) assume batch
normalization — on a raw stem those rows read level, not punch.

## 4. D18 — the bass-grind detector

The founding complaint (2026-07-24: *"the bass at ~1:11–1:16 is grindy/noisy"*) is the case that
started the detector-per-complaint program, and 140 D18 found it still had no rule that fires.
Research 123 found a better *general* answer (MoSQITo roughness) which displaced the specific one —
but roughness is pair-relative by construction, so it cannot answer *"is this stem pathological on
its own"*, which is exactly what the complaint was.

### 4.1 The pair, re-measured

| | crestDb | sub % (<60 Hz) | definition % (60–250 Hz) | flatnessLoDb (100–500 Hz) |
|---|---|---|---|---|
| `solo-bass-stabs.wav` (BAD) | **9.65** | 67.71 | **28.58** | **−8.19** |
| `solo-bs2.wav` (the owner-accepted fix) | 11.39 | 59.36 | 36.83 | −11.56 |

These reproduce 121 §1.3 and 122 §1 exactly (crest 9.6/11.4, definition 28/37) — an independent
confirmation of the extractor.

### 4.2 Why 121 §3.7's three clauses could not ship, and the ablation

| rule | ref FP (all pools, in scope) | packs FP | synth clips flagged |
|---|---|---|---|
| 121 §3.7 verbatim: crest<10.5 ∧ sub>65 ∧ definition<30 | 12/61 = **19.7%** | 9/24 = **37.5%** | 18/301 |
| `flatnessLoDb > −9.9` alone | 23/61 = 37.7% | 8/24 = 33.3% | 76/301 |
| without the crest clause | 3/61 = 4.9% | 0/24 | 6/301 |
| **all four clauses (shipped)** | **0/61 = 0.0%** | **0/24 = 0.0%** | 1/301 |

The decisive clause is the one the research had already named and nobody had built: 122 §4.1
described the complaint as drive/resonance intermodulation *"with no pitch definition"* and
proposed per-band spectral flatness as the cheap complement to roughness; 140 D18 recorded that it
too was absent. `flatnessLoDb` **is** that measure, and it separates the pair by 3.4 dB.

Shipped as `bass-grind` in `src/metrics/screens.ts` (so `beat lint --screens` carries it), scoped
to bass-dominant material (≥85% of energy below 250 Hz) so it declines rather than guesses on a
mix, a lead or a drum loop. The finding names the fix that worked on the reference case.

**Honest limits, recorded in the constants.** n=1 matched pair, as with every threshold in the
grind family (123 §7). Three of the four clauses have margins (0.85 dB, 2.7 pt, 1.4 pt) at or
inside the measured render-run variance floor (1.0 dB peak-domain, 2.0 pt band-share), so they
cannot decide a case alone; `flatnessLoDb`, an energy-domain measure with ~1.7 dB margin either
side, carries the decision. **A second owner-flagged bass pair is worth more than any amount of
re-tuning against this one** — which is 140 D30's standing ask.

## 5. D23 — the two pre-registered gates

140 D23: *"Both docs pre-registered a gate whose outcome was supposed to re-order the build queue.
Neither ran. The queue is ordered on untested inference … Unrecorded pre-registrations are what
ratchets are made of."*

### 5.1 Gate A — the `packplus` arm (133 §7)

**As pre-registered:** *"packplus beats engineplus head-to-head ≥ 65% of implied pairs over ≥ 12
batches across all four roles, AND its band/crest medians land inside the §1 pack p25–p75 bands …
If packplus moves < 10 points, the gap is in sound design depth/timbre (T6 territory) or motion,
and Phase B's transient shaper + OTT jump the queue."*

**Status: the arm was never built.** `packplus` appears nowhere — no source kind, no rated clip, no
code. The gate as written cannot fire on any data that exists, and never will unless the arm is
built.

**But its hypothesis is answerable now**, because the log already contains two production-treatment
pairs: the same figure and patch, with and without a production chain.

| head-to-head | result | batches | roles |
|---|---|---|---|
| engineplus vs raw engine | **97.6%** (41/42) | 42 | all four |
| surgeplus vs raw surge | **46.2%** (12/26) | 26 | three |
| *and yet* — ref vs engineplus | 87.3% to ref | 142 | all four |
| gen vs engineplus | 83.1% to gen | 124 | all four |
| ref vs surgeplus | 82.4% to ref | 34 | three |

**Verdict.** The first production chain clears the gate's ≥65% bar overwhelmingly — and after
buying all of it, the reference still wins 87.3%. A *second* chain, on a different source, buys
nothing at all (46.2%, below chance). **Production-chain depth is not where the remaining gap
lives.** The gate's ELSE branch is therefore the operative one: the transient shaper and OTT jump
the queue. This is independently corroborated by 131 §3.1, where `truePeakDb` (paired d +1.38) is
the single strongest head-to-head discriminator in the entire log and *nothing in any dotbeat
profile shortens an envelope or shapes an attack.*

**133's secondary prediction is inverted by the data.** It expected chords/lead to move most and
bassline least. Against raw engine every role moves ~100%. Against the reference, **bassline is the
closest role** (75.6% to ref) and chords/drums the furthest (92.5% / 95.5%) — matching 131 §7-P1's
independent finding that bassline is the nearest winnable role, and contradicting the ordering 133
inferred.

*Confidence: High on the head-to-head numbers (n = 26–149 pairs, all from the owner's blind
ratings). Medium on reading engineplus-vs-engine as a proxy for packplus-vs-engineplus — packplus
was specified as engineplus PLUS more chain, so this measures the first dose, not the second. The
surgeplus result is the closest available read on a second dose, and it is flat.*

### 5.2 Gate B — the match ceiling run, M1 (134 §4.3)

**As pre-registered:** *"Deliverable: per-role table of best MFCC/CLAP vs the 15.3 self-match floor
on **clean** targets. Read: ≤ ~1.5× floor → matching is a viable per-layer patch factory (proceed
M2); still ≥ 2× on clean single-voice-ish targets → the engine's per-voice timbre ceiling is real —
jump to §6's redirect."*

**The numbers that exist**, from the three completed match runs (budget 800, population 24, seed
41, 784 renders each):

| role | best MFCC distance | × the 15.3 self-match floor | gate reading |
|---|---|---|---|
| lead | 31.50 | **2.06×** | ≥2× → redirect |
| chords | 47.43 | **3.10×** | ≥2× → redirect |
| bass | 57.90 | **3.78×** | ≥2× → redirect |

**Verdict: the redirect branch fires on every number that exists, and nothing points the other
way — but the gate is firing on its own INPUT rather than the fresh run it specified.** These are
the same 31.5 / 47.4 / 57.9 figures 134 §4.2 already cites as the *pre-M1* T6 v2 result. M1 asked
for budget 500→2000 (these are 800) and for the harness to be extended with a chord-note candidate
*"before concluding anything about pads"* — `src/match/` contains no triad/chord-note candidate, so
that precondition was never met. 134 §4.2 further lists four mechanical reasons its own number is a
**lower bound** (chiefly: the targets were Demucs stem chops, the noisy class the owner flagged).

So the honest reading, per role: **redirect confirmed on lead** — the cleanest, most
single-voice-like target, the exact case 134 said would be decisive, at 2.06× — and **confounded on
chords**, by a harness gap 134 itself named. Bass at 3.78× is far past the bar in any reading.

**And the decision has already been taken de facto**, which is precisely the failure mode D23
describes: 138 §5's honest ceiling states independently that *"consistent all-role parity … is NOT
supported by any measured path using single-voice rendering"* and that parity *"requires the
composite/layered arm as the default clip shape"* — that **is** 134 §6's redirect. The `layered-arm`
work was built on that assumption without the gate ever being marked as fired. It is now recorded.

*Confidence: Medium. The threshold is crossed by a wide margin on two of three roles and no
evidence contradicts it, but M1's own specified conditions (fresh clean targets at higher budget,
chord-note candidate) were not met, and 134 says the measurement understates what matching could
do. If the redirect is ever contested, running M1 as specified is the cheap way to settle it — and
that is now a live, unblocked task rather than an open pre-registration.*

## 6. Honest gaps

- **The 2.1-point residual in §2.3 is unexplained.** Optimizer and width collinearity are ruled
  out; the pair-population difference is a hypothesis, not a demonstration.
- **Every threshold in §3 and §4 is observational.** Landing inside a reference band does not make
  a clip good; 131 §8 says so about its own effect sizes, and none of these 36 features hears
  harmony, voicing or pocket.
- **The grind detector rests on one matched pair.** Its false-positive rate is measured against 61
  reference clips and 301 synth clips, which is real evidence about *specificity*; its
  *sensitivity* is n=1.
- **Gate A's verdict uses a proxy.** engineplus-vs-engine measures the first dose of production,
  not the second dose packplus was designed to test. Building the arm is still the direct answer.
- **Gate B fires on the pre-registration's own input**, as §5.2 states plainly.
- **`origin/main`'s score log is 36 batches stale** (§2.4). Every number here uses the current log;
  the divergence should be reconciled before anyone re-derives them.
- **Not measured here:** whether any of this moves an owner rating. These are instruments. The
  whole point of building them first is that the experiments they score have not been run yet.
