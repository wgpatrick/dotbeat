# Research 123 — Listening benchmark results: which candidate ears hear what the owner heard

*Benchmark execution pass, 2026-07-24. Runs the doc-122 §2 protocol ("does it hear what the
owner heard?") against the two candidates doc-122 §7 ranked first: the $0 local
roughness/dissonance stack and Gemini Flash structured critique. Companion docs:
`docs/research/122-machine-listening-for-production.md` (blueprint and case definitions),
`docs/research/surge-right-ear-ring-rootcause.md` (R1 provenance),
`taste-dataset/covers/NOTES.md` (owner labels — private). Benchmark assets live in
`~/Documents/dotbeat/taste-dataset/listen-bench/` (private, midi-derived; cases under neutral
names `case-01..case-18`, answer key in `answers.json`, all raw model outputs under `results/`).
Confidence labels inline. T1 (taste replay) skipped this pass per scope.*

## Headline

**The Daniel & Weber psychoacoustic roughness model (MoSQITo) is the only candidate that tracks
the owner's "grindy" complaint — but only pair-relative, never as an absolute threshold.** On the
matched G1 pair it separates fail from pass by +25% (2.09 vs 1.67 asper), and its time-resolved
curve localizes the G2 grind to the right 14 s of a 30 s full-mix excerpt (delta +0.131 asper
in-region vs +0.006 outside, a ~20× contrast). But commercial-grade N1 loops score up to 3.71
asper — 77% *above* the fail clip — so "roughness > X" as a gate is dead on arrival; the signal
only exists between matched renders of the same material. `timbral_models` and Sethares
dissonance failed to discriminate at all (wrong direction on G1).

**Gemini Flash (gemini-3.6-flash) failed the benchmark almost everywhere it could fail.**
Single-clip critique scored the grindy stem, the flat arrangement, and both bugged ring renders
8-9/10 with zero issues; its only confirmed (≥2-of-3) finding across all 18 cases was a false
positive on a commercial reference bass loop. A synthetic probe empirically confirmed the §3.1
caveat: a 10 kHz tone went entirely unreported and hard-right-panned clicks came back as
"center" — the model listens in mono below ~8 kHz. One genuine bright spot: in pairwise A/B
framing it identified the G1 fail clip 3-of-4 times with a consistent, correct finding
("excessive low-end saturation/boomy sub-bass", 20-250 Hz — the exact params the fix changed),
but a strong prefer-first-clip position bias contaminates every other pairwise family.

**Verdict for `beat listen`:** wire the DW roughness curve in as a *pair-relative regression
lint* (gate-capable, matched-render workflows only); do not wire Gemini in at all yet — it did
not earn even the advisory novelty-scout slot on this evidence. Thresholds in §5.

## 1. What was run

18 blind cases (neutral filenames, answer key private, prompts contain no expected findings,
owner language, or real filenames):

| family | cases | contents |
|---|---|---|
| G1 grindy bass (stems) | fail + pass | pre-fix vs post-fix bass solo stems, matched except patch params |
| G2 grind in context | fail + pass | 30 s excerpt (abs 60-90 s) around the exposed-bass section from both full mixes |
| A1 arrangement flatness | fail + pass | both full mixes (~3:19) |
| A1-shift (recognition control) | fail + pass | both full mixes pitch −2 st / tempo ×0.944 |
| R1 ring (solved control) | 2 fail + 3 pass | same two Surge factory patches rendered through the buggy interleaved `getOutput()` path vs the fixed `processMultiBlock` path (regenerated via `listen-bench/tools/render_ring_cases.py`; artifact verified: R-channel narrow peaks −19.3 dB @4.5 kHz and −17.5 dB @4.9 kHz vs ≤−40 dB post-fix), plus one post-fix pipeline render |
| N1 negative controls | 6 | 5 commercial loops from the doc-120 ref pool (3 bass, 1 drum, 1 lead) + the finished full mix |

Candidates: (1) roughness stack — MoSQITo 1.2.1 Daniel-Weber time-varying roughness,
`timbral_models` roughness/hardness, `dissonant` Sethares model (Essentia skipped: AGPL +
install friction, per doc-122 flag); (2) `gemini-3.6-flash` (current-gen Flash confirmed via
models list; 2.5-flash available as fallback, unused) — frozen mastering-engineer prompt
requesting structured JSON (MM:SS spans, severity 1-5, band, description), tuned on G1 only
(tuning log: `listen-bench/results/gemini/tuning-log.md`), 3 runs/case, findings count at
≥2-of-3; plus an order-balanced pairwise A/B protocol (4 runs/pair, 2 per order) added after
tuning exposed position bias.

## 2. Roughness stack results

### G1 — matched stem pair (fail / pass, direction correct = fail scores rougher)

| metric | fail | pass | margin | direction |
|---|---|---|---|---|
| MoSQITo DW mean (asper) | **2.091** | **1.670** | +25% | correct |
| MoSQITo DW p95 (asper) | 3.331 | 2.635 | +26% | correct |
| DW mean, bass-band variant (LP 500 Hz, RMS-normalized) | 0.316 | 0.264 | +20% | correct |
| timbral_models roughness | 48.7 | 49.9 | −2% | **wrong** |
| timbral_models hardness | 41.0 | 43.6 | −6% | **wrong** |
| Sethares dissonance mean | 0.105 | 0.122 | −14% | **wrong** |

The +20% margin surviving RMS normalization matters: the fix also lowered sub level, and DW
roughness is level-dependent, so part of the raw margin is a level effect — but not all of it.
Medium-high confidence the DW margin is real; n=1 matched pair (honest gap §7).

### N1 — do controls stay low? **No.**

DW mean asper: commercial bass loops 0.79 / 0.98 / **3.71**, drum loop 1.00, lead loop 1.42,
finished full mix 0.32 — vs fail stem 2.09. One commercial loop scores 77% above the fail clip
(intentional AM/wobble reads as roughness, exactly the doc-122 §8 concern). **The doc-122
success criterion ("fail clearly rougher than pass AND controls stay low") is NOT met.**
Absolute roughness thresholds cannot gate. High confidence.

### G2 — does the time-resolved curve localize the grind? **Pair-relative, yes.**

3s-binned DW curves over the 30 s excerpts (fail vs pass, full-band; curves in
`listen-bench/results/curve-case-01.csv` / `curve-case-11.csv`):

| region of excerpt | fail mean | pass mean | delta |
|---|---|---|---|
| exposed-bass region (10.6-24.7 s) | 0.433 | 0.302 | **+0.131** |
| outside region | 0.384 | 0.378 | +0.006 |

The fail-minus-pass delta is ~20× larger inside the owner-flagged window than outside — the
curve difference localizes the grind to the right bars with zero ML. The *absolute* fail curve
alone does not spike decisively (0.43 vs 0.38 background). Localization is a matched-pair
capability, consistent with everything above. High confidence on these numbers.

## 3. Gemini Flash results

Model: `gemini-3.6-flash`, 3 runs/case × 18 cases (54 calls, all raw JSON in
`listen-bench/results/gemini/run-{1,2,3}/`), findings counted at ≥2-of-3.

### Scorecard

| case family | doc-122 pass criterion | result |
|---|---|---|
| G1 (single-clip) | flags roughness on fail AND rates pass cleaner | **FAIL** — q 8/8/8 vs 8/8/8, zero issues on both; fail stem called "clean, well-crafted" |
| G1 (pairwise A/B) | — (supplementary) | **weak pass** — correct clip named 3/4 runs, consistent finding "excessive low-end saturation / boomy sub-bass, 20-250 Hz" (matches the actual fix: sat 0.30→0.12, sub 0.65→0.45); order-sensitive |
| G2 | localizes issue to bass + right time window | **FAIL** — q 8/8/8 vs 9/9/9 (direction right, 3/3 consistent) but zero issues on either clip; nothing to localize. Timestamp accuracy: N/A, no findings produced |
| A1 | fail described static/flat, pass described dynamic | **FAIL** — fail mix: "well-balanced and polished", "exceptionally clean" (q 8/9/8); zero arrangement language in 12 runs across original+shifted; pairwise A/B = pure position bias (prefers first clip 4/4, "B has a high-frequency problem" template flips direction to match position) |
| A1-shift | critique survives pitch/tempo shift | no critique to test — same nothing on shifted copies, so no evidence of song-recognition either way |
| R1 (solved control) | flags narrow HF ring on pre-fix only | **FAIL** — both buggy renders q 9/9/9, zero issues; the only R1-family issue emitted was a 1/3-run false positive on a *clean* control. (The right-ear cue is invisible to it by construction — but the tonal comb itself survives 16 kHz mono and was still missed. In A/B with the buggy render in second position it did describe "clipping/harsh HF saturation on transients" 2/2 — the artifact is audible to it, but position bias swamps the signal) |
| N1 | does not invent problems on commercial material | **partial fail** — 1 confirmed FP of 6 controls (a commercial reference bass loop: "excessive sub-bass... uncontrolled rumble", 2/3 runs, quality driven to 4 — it criticizes a solo bass loop for being a solo bass loop); 3 further 1/3-run unconfirmed FPs; 0 FPs on the produced full mix |

### The band-limit probe (§3.1 caveat, now measured)

Synthetic clip: 1 kHz tone (centered), 10 kHz tone (centered), hard-right-panned clicks.
Gemini reported the 1 kHz tone (frequency correct, stereo position wrong), reported the clicks
as **center**, and **did not report the 10 kHz tone at all**
(`listen-bench/results/gemini/probe-01.json`). The doc-122 inference is now empirical: mono,
≤8 kHz effective. Anything above ~8 kHz or in the stereo field is physically outside this
model's hearing. High confidence.

Also symptomatic: every render of the Sandstorm cover — a produced trance mix with 909 drums —
was described as "chiptune / 8-bit" in 100% of runs, i.e., the band-limited signal path
audibly changes the *genre* the model perceives. Medium confidence on cause, high on the
observation.

### Cost and caveats

54 single-clip calls = 93.6k prompt + 6.4k output tokens; with tuning, 16 A/B calls, and the
probe, total ≈ 160k in / ~10k out ≈ **$0.30 for the whole benchmark** (order-of-magnitude; at
doc-122's fetched ~$1.50/1M Flash audio-input rate). Tier caveat: whether this key is paid-tier
or free-tier could not be determined from the API; if free-tier, Google AI Studio terms allow
using inputs for product improvement — the owner explicitly approved the upload on 2026-07-24
with that caveat acknowledged. Three large files were uploaded as FLAC (lossless) rather than
WAV for bandwidth reasons; all others WAV.

## 4. Full scorecard

| case | DSP stack (DW roughness / ringDb-style) | Gemini 3.6 Flash |
|---|---|---|
| G1 stems | **pass** (pair-relative, +25%/+20% normalized) | fail single-clip; weak pass pairwise |
| G2 in-context | **pass** (pair-delta curve localizes, 20× contrast) | fail (directional 1-pt quality gap only) |
| A1 flatness | not a roughness question (doc-122 §4.2 lint owns it; not run this pass) | fail |
| R1 ring | **pass** (narrow-peak detector: −19.3/−17.5 dB fails vs ≤−40 dB passes — calibration control, known answer) | fail |
| N1 controls | **fail as absolute gate** (controls up to 3.71 asper); n/a as pair-relative lint (needs no absolute bar) | partial fail (1/6 confirmed FP) |

## 5. Verdict for `beat listen` and recommended thresholds

- **Adopt: MoSQITo Daniel-Weber time-varying roughness as a pair-relative regression lint**,
  same sidecar schema as doc-122 §7. Gate-capable *only* when a matched baseline render of the
  same material exists (patch tweaks, produce-pass iterations, T-search candidates — dotbeat's
  main workflows, so this is less restrictive than it sounds). Recommended rule from the
  measured margins (medium confidence, n=1 pair — revisit as pairs accumulate):
  - flag `roughness-regression` when mean DW roughness rises **≥15%** (and ≥0.2 asper absolute)
    vs the baseline render of the same material;
  - localize via 3s-binned curve delta; report bins where delta **≥0.1 asper**;
  - severity 3 at +25% (the measured owner-flagged level), severity 4-5 beyond +50%;
  - never emit on unmatched material (no absolute threshold exists — N1 proves it).
- **Keep: the existing `ringDb` narrow-peak detector** — it cleanly re-separates the
  regenerated R1 cases (−19.3/−17.5 dB vs ≤−40 dB); stays the calibration bar for candidates.
- **Drop: `timbral_models` and the Sethares/`dissonant` package** for grind — wrong direction
  on the one labeled pair; no reason to carry them.
- **Do not wire Gemini Flash into `beat listen`.** It missed every planted defect in
  single-clip mode (the mode the sidecar would use), produced its only confirmed finding as a
  false positive on commercial material, and cannot hear stereo or >8 kHz. It did not clear the
  doc-122 advisory bar (beat N1 while flagging any fail). The pairwise G1 result is the one
  live thread: a future *comparison-shaped* advisory ("which of these two renders is cleaner
  and why") with mandatory order-balancing (run both orders, count only order-stable findings)
  is worth one more benchmark pass — but as designed today, no slot.
- Unchanged from doc-122: the arrangement-flatness lint over `sections.ts` should ship
  regardless (A1's fix-side numbers already define thresholds); nothing measured here changes
  that, and no learned candidate came close to owning A1.

## 6. What the next benchmark cases should be

1. **More matched pairs, banked as they happen** — the single most valuable asset. Every future
   owner-flagged miss should immediately get its pre/post-fix render pair banked into
   `listen-bench/` (G1's +25% margin is one data point; the regression-lint thresholds are soft
   until n≥3 pairs).
2. **Order-balanced pairwise Gemini re-test** (and Gemini Pro one-shot on G1/A1) — establishes
   whether the G1 pairwise signal survives debiasing and whether critique ability is
   tier-limited before spending on any hosted critic again.
3. **T1 taste replay** (skipped this pass) — the generalization tiebreaker; also where the DW
   roughness feature should be added to the dsp+aes feature set and re-ablated.
4. **MOSS-Music-8B on A1 + the Sandstorm bar map** (doc-122 §7 slot 3) — structure-map accuracy
   is testable against a known answer and double-serves the doc-121 harness; nothing in this
   pass tested the open-model route.
5. **A masking case** when the owner first flags one (doc-122 §4.5 parked it) — the benchmark
   currently has no inter-stem masking family.

## 7. Honest gaps

- **n=1 matched pair for the grind family.** All DW thresholds derive from one A/B; the +25%
  margin could be patch-specific. The lint should log-not-gate until 2-3 more pairs confirm.
- **Level confound in G1:** the fix lowered sub level; DW asper is level-dependent. The
  RMS-normalized bass-band variant still discriminates (+20%), which bounds but does not
  eliminate the confound.
- **Gemini nondeterminism and n=3:** 3 runs/case is thin; the 8-vs-9 G2 quality gap (3/3) is
  the kind of signal that could wash out at n=10. Not worth chasing given the misses elsewhere.
- **Prompt ceiling not proven:** tuning explored 3 single-clip variants + 1 pairwise on G1 only
  (frozen per protocol). A better prompt might exist; the probe result (10 kHz/panning
  physically inaudible) caps how much prompting can recover for ring/width families regardless.
- **Tier/ToS ambiguity** on the Gemini key (§3 caveat) — flagged, owner-approved.
- **Essentia dissonance untested** (AGPL skip); unlikely to differ from `dissonant` (same model
  family), low priority.
- **A1-shift control produced no evidence** about song-recognition priors because there was no
  critique to test on either version — the control worked, the candidate didn't reach it.
- The FLAC-vs-WAV upload split (3 large cases) is a minor protocol inconsistency; Gemini
  transcodes to 16 kbps mono regardless, so impact is almost certainly nil (low risk, noted for
  reproducibility).
