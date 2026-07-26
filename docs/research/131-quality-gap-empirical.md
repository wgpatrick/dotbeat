# Research 131 — The quality gap, measured: what the owner's own ratings say separates ref/gen from the synth sources

*Run 2026-07-25/26, commissioned by the owner's question: "there's still a gap between what ref
(Splice) and gen can do vs surge/engineplus/etc — how do we close it?" Everyone has theorized;
this doc measures. Method: every rated showdown batch in `examples/taste-t1/beat-scores.jsonl`
(177 batches with `sources`, 973 clips, 1,612 owner pairwise preferences; 75 batches are the
current Splice-pack-ref era, 2026-07-24→26) was decoded and re-analyzed with the log's 13 DSP
features PLUS 25 newly computed ones (spectral flux, onset/attack-time statistics, per-band
crest, spectral flatness by region, spectral slope, envelope statistics, stereo-field-over-time,
MoSQITo Daniel-Weber roughness) PLUS the 4 Audiobox-aesthetics axes (computed fresh for the 637
clips that lacked sidecars, same `facebook/audiobox-aesthetics` model; cached OUTSIDE the repo —
batch dirs untouched). Two effect sizes per claim: **P(win|hi)** = probability the pair-winner had
the higher value (0.50 = no signal; equivalently a per-feature pairwise accuracy) and **paired d**
= mean(winner−loser)/sd of that difference. Discrimination numbers are held-out (grouped 10-fold
by batch, L2 pairwise logistic). Confidence: **High** = n>100 pairs, direction stable across
subsets; **Medium** = n 20–100 or one plausible confound; **Low** = n<20 or known-confounded.
Private-data rules respected: no audio content, no ref filenames, aggregate statistics only.
Scratch pipeline: `~/.claude/jobs/fc3bd856/tmp/gapanalysis/` (extract.py, richfeat.py, aes.py,
rough.py, analyze.py, model.py + cached features for all 973 clips). Companions: research 132–135
(the theory docs this cross-checks — §6), `docs/source-showdown-eval.md`, `src/taste/features.ts`.*

## Headline answers

1. **The gap is real, large, and NOT one axis — it is four measurable families, weighted
   differently per role.** (a) *Production complexity/texture*: Audiobox PC is the single
   strongest discriminator in the whole log — P(win|hi) **0.757**, paired d **+0.61**, n=1,612
   pairs; spectral movement (`fluxMean` 0.638/+0.34) and 2–8 kHz noisiness (`flatnessHiDb`
   0.626/+0.37) are its DSP-computable shadows. (b) *Transient life at matched loudness*: winners
   peak hotter (`truePeakDb` 0.592/+0.27) with more varied attacks (`attackCv` 0.631/+0.33).
   (c) *Low-end steadiness*: winners have LESS per-band crest in sub/bass (`crest_subDb`
   0.403/−0.28, `crest_bassDb` 0.411/−0.31) — the low end sits, it doesn't pump. (d) *Role-true
   register/width placement* (§2, §5). Cross-role cosine similarity of the best-vs-best gap
   vectors is ≈0 (−0.06 to +0.29; only chords↔lead correlate at +0.52) — there is no single knob.
   (High.) §2, §5
2. **Against Splice refs specifically, engineplus loses on punch, movement, and texture — not
   width, not loudness.** Across the 61 packs-era ref-beat-engineplus pairs: `truePeakDb` paired
   d **+1.38** (refs peak a median **5.5 dB** hotter at the same LUFS), Audiobox PC **+1.11**,
   `fluxMean` **+1.06**, `fluxP95` +0.77, broadband crest +0.69, `flatnessHiDb` +0.66 (refs are
   *noisier* in the presence region), attack times **−0.63** (ref median attacks 6.2 ms *faster*),
   `crest_subDb` **−0.74** (engineplus sub crest 11.6 dB higher = unsteady). Width is now a wash
   or backwards: engineplus is often WIDER than the ref that beat it. (High.) §3.1
3. **gen beats engineplus on exactly the same axes ref does — so one program closes both gaps.**
   packs gen-beat-engineplus (50 pairs): `flatnessHiDb` +1.02, `fluxP95` +0.90, PC +1.00, crest
   +0.76, truePeak +0.65, `crest_subDb` −0.82, and gen wins while being NARROWER (width d −0.78).
   The residual ref-vs-gen axis is *different in kind*: winning refs are LESS noisy overall
   (`flatnessDb` −0.73), spectrally darker (`slopeDbPerOct` −0.72 ≈ 4 dB/oct steeper), ~1 dB
   louder (a true-peak-ceiling artifact — 12 gen clips were gain-capped), and when gen beats a
   ref it does it with LESS roughness (−0.45) — gen's failure mode is overshoot into hiss/bright
   mush, the synths' is undershoot into clean static simplicity. (High for the direction; Medium
   for the gen-beats-ref decomposition, n=43.) §3.2–3.3
4. **The single biggest per-role hole: bassline register.** Packs-era medians — ref bass puts
   **60.1%** of energy below 60 Hz with centroid ≈**74 Hz**; engineplus bass has **0.22%** sub
   share, centroid ≈**162 Hz** (>1 octave high), and 24.3 dB sub-band crest vs ref 7.2 dB. This
   is also where engineplus is closest overall (17–4 vs ref by pairs, its only role with multiple
   outright batch wins) — fixing register is measured, cheap (octave/`subLevel`/`osc2Detune
   −1200`), and the role is nearly winnable. (High.) §2.2, §5, §7-P1
5. **The 25 new features genuinely out-discriminate the current 13.** Held-out pairwise accuracy
   on the owner's 1,612 preferences: current log-13 **0.676** → new-features-only **0.727** →
   log+new **0.795** → +Audiobox **0.817** (owner's own test-retest ceiling: 0.917). On
   synth-vs-synth pairs only — what the taste pilot must rank — new-features-only is best:
   **0.776 vs 0.688** for the current set. The biggest single additions: `fluxMean`/`fluxP95`,
   `attackCv`/`attackMedMs`, `flatnessHiDb`, per-band crest. Roughness adds ~nothing globally
   (P(win|hi) 0.486) and winning refs are actually ROUGHER than the synths they beat — an
   absolute roughness screen would fire on the quality bar itself. (High; roughness verdict
   confirms research 123's pair-relative-only rule.) §4
6. **Cross-check verdict on docs 132–135: confirmed on register/occupancy/width-doctrine/ring-gate;
   the crest story needs one refinement.** Pack loops are more dynamic at the *transient* scale
   (broadband crest ref 15.5–18 dB vs engineplus 10.6–14) — but STEADIER at the *band-energy*
   scale (sub/bass crest and drum envelope range run 2–4× lower than engineplus). "More dynamic"
   and "denser" are simultaneously true at different time-frequency scales; sparse arrangements
   masquerade as dynamics in a broadband number. Surge's rhythmic inertness is visible here too:
   packs surge chords fire 1.3 onsets/s vs ref 4.9 (the tempo-bug's fingerprint). (High.) §6
7. **Shortest measured path to parity, in priority order (full table §7):** P1 bass register +
   steady sub (composition+patch); P2 transient punch — true peak within ~3 dB of ceiling, attacks
   ≤8–12 ms on chords/lead, transient shaper not compressor (patch+engine); P3 movement/
   articulation — fluxMean ≥0.17, onset rate ≥4/s on chords, velocity/attack variety (composition+
   MIDI-expression surface); P4 texture — raise 2–8 kHz flatness toward ref (−8 to −16 dB), via
   layering/saturation/exciter (sound source); P5 role-true width map (production, trivial);
   P6 drum density — sustain 51% vs 27, fills/ghosts (composition). Plus: upgrade the critic's
   feature set (P0 — it re-scores every experiment above for free). §7

---

## 1. Data and method

**Data.** All `showdown:*` entries in `examples/taste-t1/beat-scores.jsonl` carrying `sources`:
177 batches / 973 variants, roles bassline 50 · chords 52 · lead 47 · drum-loop 28. Ref pools:
refs-packs 75 (2026-07-24→26, the Splice era, post-surge-ring-fix, post-diversity-fixes),
refs-familiar 44, refs-unfamiliar 39, refs-cc 19. A ranking of k picks over m variants yields
winner→loser pairs (rank-1 beats rank-2 beats all rejected): **1,612 preference pairs** total,
674 in the packs era. Pairwise win rates for context (packs era): ref **87%**, gen **75%**,
surgeplus 38%, surge 36%, engineplus **31%**, keymap 30%, engine 2% — matching the
`beat showdown --report` table in research 135 §A.1.

**Features.** Three tiers per clip: (i) the log's 13 (`src/taste/features.ts`); (ii) 25 computed
fresh from the wavs — `fluxMean/P95/Std` (half-wave-rectified spectral flux on unit-normalized
STFT frames — level-invariant "movement"), `flatnessDb/HiDb/LoDb` (spectral flatness overall /
2–8 kHz / 100–500 Hz; higher = noisier, less tonally pure), `slopeDbPerOct` (100 Hz–10 kHz tilt),
`crest_{sub,bass,mids,presence,air}Db` (p95−p50 of per-band frame energy — dynamics per frequency
region), `envStdDb/envRangeDb/sustainPct/envFluxDb` (envelope statistics), `onsetRatePerSec`,
`attackMedMs/attackP25Ms/attackCv` (10→90% rise times at detected onsets), `onsetLevelCv`,
`widthMeanDb/widthStdDb` (50 ms S/M frames — stereo field over time), `roughMean/roughP95`
(MoSQITo Daniel-Weber, per research 123); (iii) Audiobox-aesthetics CE/CU/PC/PQ, full 973-clip
coverage after this pass. Clip durations are matched across kinds (median 7.2–7.4 s everywhere),
so rate-type features are comparable.

**Known confounds, stated up front.** (1) Batches are loudness-normalized to a common LUFS with a
−1 dBTP ceiling; gain-capping is rare (24/850 variants) but concentrated in gen (12) — the ~1 dB
LUFS residual in ref-vs-gen pairs is partly mechanical. (2) `stereoWidthDb` was a historical hack
vector and engine renders are literally mono; any width effect in all-pairs tables partly encodes
*source identity*, so the head-to-head sections (which condition on source) are the trustworthy
width read. (3) The all-pairs rank-vs-feature table also partly encodes source identity for every
feature; the per-kind and synth-only splits (§2.3) and head-to-heads (§3) are the controls.
(4) familiar-pool refs carry a recognition taint; the packs pool (the owner's actual stated
target) does not. (5) These are observational effect sizes, not causal: matching a feature target
does not guarantee the rating moves — §7's list is a set of *experiments*, each cheap to falsify
through the existing showdown.

## 2. Rank-vs-feature: what separates winners from losers

### 2.1 Global (1,612 pairs, all roles/sources)

| feature | P(win|hi) | paired d | median winner−loser |
|---|---|---|---|
| aesPC (Audiobox production complexity) | **0.757** | +0.61 | +0.80 |
| widthMeanDb *(source-confounded — see §1)* | 0.667 | +0.37 | +7.2 dB |
| aesCE (content enjoyment) | 0.653 | +0.33 | +0.62 |
| fluxMean (spectral movement) | 0.638 | +0.34 | +0.036 |
| attackCv (attack-time variety) | 0.631 | +0.33 | +0.17 |
| flatnessHiDb (2–8 kHz noisiness) | 0.626 | +0.37 | +2.5 dB |
| flatnessDb | 0.623 | +0.26 | +5.0 dB |
| crest_subDb (sub-band dynamics) | 0.403 | −0.28 | −3.0 dB |
| crest_bassDb | 0.411 | −0.31 | −1.9 dB |
| truePeakDb | 0.592 | +0.27 | +1.2 dB |
| onsetRatePerSec | 0.585 | +0.16 | +0.5/s |
| aesPQ (production *quality*) | **0.415** | −0.25 | −0.22 |

The last row is the log's most instructive inversion: the Audiobox axis literally named
"production quality" votes AGAINST the owner's winners. The losing clips are not dirty — they are
clean, static and simple, and every "cleanliness" metric (PQ, low flatness, low roughness) points
the wrong way. This is the measured version of 117/134's "the screens reward the wrong thing."
`lufs` sits at 0.525 — the normalization does its job; loudness is not driving these ratings.

### 2.2 Per role (the axis changes shape)

Top discriminators per role (packs+all pools, n = 463/480/202/467 pairs):

- **bassline**: `crest_midsDb` 0.689/+0.50 (winners' midrange *moves*), aesPC 0.659, `fluxP95`
  0.600, `bandSubPct` 0.591, centroid 0.409 (LOWER wins). Width is weak here (0.585 — and see
  §5: the best refs are dead mono).
- **chords**: aesPC **0.835/+0.91**, `flatnessLoDb` 0.708/+0.68 (winners' low-mids are dense,
  not pure), truePeak 0.692/+0.49, attackCv 0.686, `fluxP95` 0.675, `attackP25Ms` **0.361/−0.51**
  (FAST attacks win), onsetRate 0.624/+1.0/s.
- **lead**: aesPC 0.737, `crest_subDb` **0.281/−0.59** (junk sub-band flapping loses), `fluxMean`
  0.700/+0.51, `flatnessHiDb` 0.690/+0.59 (presence-region air/noise wins), aesPQ inverse 0.338.
- **drum-loop**: aesPC 0.842/+1.05, aesCE 0.827, `flatnessLoDb` 0.782/+0.76, `crest_midsDb`
  **0.282/−0.55** and `envStdDb` 0.312/−0.46 — winning drum loops are *fuller and steadier*, not
  spikier; losers are sparse patterns with holes.

### 2.3 Source-controlled views

**Synth-vs-synth pairs only** (375 pairs, engine/engineplus/keymap/surge/surgeplus — the space the
taste pilot actually searches): width IS still live here (widthMeanDb 0.704/+0.58 — among synths,
the wider one wins), then attackCv 0.653, aesPC 0.708, fluxMean 0.635, flatnessDb 0.619,
envStdDb 0.413 (steadier wins), crest_bassDb 0.429 (−0.33). So inside the synth family the
owner rewards exactly the same "produced density" axis, plus width that the ref comparison has
already saturated.

**Ranked vs rejected within one kind** (role-confounded — e.g. engineplus's wins ARE mostly bass
batches, `bandBassPct` d=+0.86 — so read as "where does this source survive," not "what to turn
up"): ranked engineplus clips are bass-heavy, low-centroid, high-flux (fluxP95 d=+0.78); ranked
gen clips avoid sub-mud (`bandSubPct` d=−0.46) and static sustain (sustainPct −0.50); REJECTED
refs (23 of 177) are the hot-peaked, sub-heavy chops (truePeak d=−0.59, bandSubPct −0.44) — even
the reference class loses when its low end is unmanaged. (Medium — n small, confounded.)

## 3. Head-to-head decompositions

Same-batch winner−loser feature differences, conditioned on source pair. W–L records for scale:
ref vs engineplus **126–18** overall / **61–8** packs-era; ref vs gen 127–43 / 50–19; gen vs
engineplus 105–21 / 50–9; ref vs surge 59–6; per packs role: ref-vs-eng+ bassline 17–4, chords
16–2, lead 17–1, drums 11–1; ref-vs-gen drums **6–6** (gen ties Splice on drum loops).

### 3.1 ref beat engineplus, packs era (61 pairs — the question's core) — High

| axis | paired d | P(win|hi) | concrete size |
|---|---|---|---|
| truePeakDb | **+1.38** | 0.90 | ref peaks median +5.5 dB hotter at same LUFS |
| aesPC | +1.11 | 0.84 | +0.91 points |
| fluxMean | +1.06 | 0.82 | +0.086 (≈2× engineplus's typical value) |
| fluxP95 | +0.77 | 0.80 | +0.097 |
| crest_subDb | **−0.74** | 0.30 | engineplus sub-band crest 11.6 dB HIGHER (unsteady) |
| crestDb | +0.69 | 0.79 | +3.4 dB broadband crest |
| flatnessHiDb | +0.66 | 0.75 | ref presence region +4.4 dB noisier |
| attackMedMs | −0.63 | 0.31 | ref attacks median 6.2 ms FASTER |
| crest_bassDb | −0.54 | 0.34 | −5.5 dB |
| slopeDbPerOct | −0.47 | 0.38 | ref tilt 2.1 dB/oct darker |
| stereoWidthDb | −0.31 *(sign-split)* | 0.69 | width no longer separates — engineplus often wider |

A pairwise logistic trained on all 1,612 pairs, decomposed over these 61 pairs, attributes the
margin mainly to: role-appropriate width placement ≈16% net (the +39%/−26% split between the two
collinear width features — refs are mono where mono is right and wide where wide is right, see
§5), spectral tilt 18%, fluxP95 17%, flatnessHiDb 15%, truePeak 11%, centroid 10%, envelope
steadiness 9%, sub-crest 7%. Engineplus is genuinely AHEAD only on `crest_airDb` and broadband
width. (Medium — linear attribution over collinear features; the univariate table above is the
robust read.)

### 3.2 gen beat engineplus (105 pairs; 50 packs) — High

Identical shape: flatnessHiDb +1.02, aesPC +1.00→+1.23, fluxMean +0.93, crestDb +0.87, truePeak
+0.86, crest_subDb −0.80, crest_bassDb −0.75 — and gen wins while NARROWER (widthMeanDb −0.75).
Whatever closes the ref gap closes the gen gap; there is no separate "beat gen" program.

### 3.3 The ref↔gen frontier (127–43) — the axis flips — Medium

packs ref-beat-gen (50): winning refs are LESS noisy (`flatnessDb` −0.73), DARKER (`slopeDbPerOct`
−0.72; median 4.0 dB/oct steeper), louder (+0.72; partly the gain-cap artifact), with more
midrange dynamics (`crest_midsDb` +0.45) and busier onsets (+0.44). gen-beat-ref (43): winning
gen clips carry LESS roughness (roughMean −0.45), slower/rounder attacks (+0.32), and win
DESPITE lower PC (−0.38) — i.e. gen takes batches on smoothness/composition when the ref chop is
harsh, not by out-producing it. The synth sources undershoot the texture target; gen overshoots
it; the refs sit in a band: `flatnessHiDb` ≈ −16…−8 dB, slope ≈ −14…−10 dB/oct (chords/bass).

### 3.4 surge, surgeplus, and the 18 upsets — Medium/Low

ref-beat-surge (59): aesPC +1.27, onsetRate +0.61 (packs: ref 4.9 vs surge 1.3 onsets/s — the
tempo-bug fingerprint from research 132 §2, measured blind), flatnessHiDb +0.74, truePeak +0.76,
width −1.11 (surge is too-wide-for-role). surgeplus-beat-surge (12 pairs, Low): production lifts
truePeak (+1.33 d among surgeplus's own wins). The 18 engineplus-beat-ref upsets (Low, n=18):
engineplus took them where the REF was defective on the usual axes — the beaten ref chops run
hot-peaked (engineplus won with truePeak 6.0 dB LOWER, P(win|hi)=0.06 — peak-punch did not decide
these) and sub-flooded (`bandSubPct` d −0.97, matching §2.3's rejected-ref profile: rejected refs
median 19.7% sub vs 0.1% for ranked ones). Upsets happen when the ref falls out of the §3.3
target band, which is evidence the band is real, not just source branding.

## 4. New features vs the current 13 — measured discrimination value

Grouped-10-fold held-out pairwise accuracy (train on z-scored within-batch diffs, symmetric
logistic; chance 0.500; owner test-retest ceiling 0.917 from the T1 probes):

| feature set | all pairs (n=1538–1612) | synth-only (n=375) |
|---|---|---|
| current log-13 | 0.676 | 0.688 |
| new-25 only | 0.727 | **0.776** |
| log-13 + new-25 | 0.795 | 0.749 |
| log + new + Audiobox | **0.817** | 0.725 |
| Audiobox alone | 0.756 | 0.741 |

Readings, in order of importance: (1) the new features are worth **+12 pairwise points** on the
full log and are the BEST set on synth-only pairs — where the current critic must rank the
pilot's candidates and where the gen-split failure lived; (2) Audiobox axes alone nearly match
the whole DSP stack — keep dsp+aes-bt's aes half; (3) on synth-only, bigger sets overfit (375
pairs, 42 features) — ship the new features with regularization or pruned to the §2 top-10;
(4) **roughness earns no place as a global feature** (P(win|hi) 0.486 overall; packs refs are
ROUGHER than the engineplus/gen clips they beat, +0.51/+0.52 paired d) — it stays a
pair-relative diagnostic exactly as research 123 concluded, never a screen. The concrete critic
upgrade: extend `FEATURE_KEYS` (append-only) with fluxMean, fluxP95, flatnessHiDb, flatnessDb,
slopeDbPerOct, crest_subDb, crest_bassDb, crest_midsDb, crest_presenceDb, attackMedMs, attackCv,
onsetRatePerSec, onsetLevelCv, envStdDb, sustainPct, widthMeanDb — all deterministic DSP,
computable in the existing `analyze()` pass shape. (High.)

## 5. Ceiling check: the top-5 refs vs the top-5 engineplus, per role

Best-vs-best (batch win-fraction selects the 5; packs era only). Bassline's top engineplus are
genuine winners (win-fracs 1.0/1.0/1.0/0.83/0.83); chords' and lead's "top 5" already include
0%-win clips (lead: one 0.83, then four 0.0) — for two roles there is no elite to compare, which
is itself the finding. Distances that survive at the top (|d|>1):

- **bassline** (12 features |d|>1): even elite engineplus keeps 2× the sub-band crest (22.6 vs
  10.9 dB), half the spectral movement (fluxMean 0.09 vs 0.20), and is 30 dB wider than the
  dead-mono elite refs (−12.0 vs −43.4 dB). Note aesCE *prefers* the engineplus clips here
  (5.12 vs 3.47) — Audiobox is not a bass judge.
- **chords** (21): movement and pace dominate — fluxP95 0.26 vs 0.47 (d=+6.4!), onsetRate 2.3 vs
  5.9/s, attackP25 30.9 vs 6.9 ms, centroid a full 1.4 octaves too bright, air-band crest 11.6
  vs 20.5 dB.
- **lead** (9): width map inverted vs bass — elite refs are WIDE (−4.6 vs −10.7 dB), darker tilt
  (−17.0 vs −6.8 dB/oct), noisier presence (flatnessHiDb −15.8 vs −28.6), crest_presence 19.8 vs
  9.9 dB.
- **drum-loop** (18): density — sub crest 16.5 vs 43.4 dB, sustain 51% vs 27%, envRange 22 vs
  44 dB, truePeak −0.8 vs −7.7 dB, onsetLevelCv 0.59 vs 0.87 (refs' hits are consistent; the
  synth kit's are all-or-nothing).

Cross-role cosine similarity of these gap vectors: bassline↔chords −0.06, bassline↔lead −0.06,
chords↔lead +0.52, drums↔others ≈0. **The distance is many medium-sized axes with role-specific
signs — a per-role target profile (135 §E) is the right container; a single global "quality
knob" would provably help one role and hurt another** (width: bass wants −43, lead wants −4.6).
(High on the numbers; Medium on interpretation — top-5 groups are n=5.)

## 6. Cross-check against research 132–135 (independent measurement, same log)

- **Bass sub-band gap (133 §1, 135 §2): CONFIRMED, larger here.** Packs medians: bandSubPct ref
  60.1% vs engineplus 0.22%; centroid 74 Hz vs 162 Hz. (Their 43.8%/0.46% used a different
  aggregation window; direction identical.)
- **~99%-mids occupancy (133): CONFIRMED exactly.** engineplus bandMidsPct chords 99.35 / lead
  99.19 vs ref 78.4 / 81.2, with ref bass-body 9.5% (chords) and 5.0% (lead).
- **Width doctrine partly obsolete (133): CONFIRMED and sharpened.** Ref bass mono at −47 to −51
  dB *median* while winning 87%; engineplus at −11 everywhere. Width still discriminates
  synth-vs-synth (0.704) — it's a *placement* variable now, not a "more is better" one.
- **Crest deficit (133 "packs are MORE dynamic… articulation not compression"): REFINED.**
  True at the broadband/transient scale (ref crest 15.2–20.2 vs engineplus 12.1–14.0 dB; truePeak
  +5.5 dB) — but at the per-band scale refs are 2–4× STEADIER (crest_sub 7–18 vs 21–43 dB;
  drum envRange 22 vs 44 dB). The correct prescription is both halves: sharpen transients AND
  steady the band energy. A transient shaper does the first; register/sustain/density does the
  second; a compressor alone does neither.
- **Ring gate fails the quality bar (134): CONSISTENT, generalized.** Every cleanliness metric
  inverts against preference (aesPQ P(win|hi) 0.415; flatnessHiDb +0.37 toward winners; packs
  refs rougher than the synths they beat). The owner's bar is *textured*, and screens tuned for
  cleanliness reject it — measured across 1,612 pairs, not just the gate's 22% false-reject rate.
- **Surge tempo bug (132): fingerprint visible blind.** Surge onset rate 1.3/s vs ref 4.9/s
  (packs chords), envelope near-static (envStdDb ranked 3.4 vs rejected 8.4 among surge's own
  outcomes) — the harness, not the synth.
- **Scoreboard (135 §A.1): identical numbers** (same log, independently recomputed: ref 87%
  packs / 89% overall, gen 72–75%, engineplus 31–32%, engine 1–2%).

## 7. The shortest measured path to parity (prioritized, with numeric targets)

Ranked by measured effect size × role-coverage × cheapness. Targets are packs-ref medians (the
owner's stated bar); "lever" names who can deliver it. Every item is falsifiable as a showdown
arm against these exact numbers.

**P0 — critic feature upgrade** *(lever: `src/taste/features.ts` + ranker)*. Append the §4 list;
expected held-out gain 0.676→~0.80 pairwise (0.69→0.75–0.78 on synth-only). Do this first — every
experiment below gets scored by it for free, and the current 13 literally cannot see the top
discriminators (flux, attack, per-band crest, flatness).

**P1 — bassline register + steady sub** *(levers: composition octave; patch `subLevel`,
`osc2Detune −1200`; production bass-mono)*. Targets: bandSubPct ≥30% (ref med 60.1, p25 ≈37),
centroid ≤ ~90 Hz (log2 ≈6.2–6.5), crest_subDb ≤ ~11 dB (ref 7.2; engineplus 24.3), width ≤
−40 dB. Bass is engineplus's best role already (17–4, real batch wins) — this is the closest
winnable full role, and 133 §4 shows every knob exists today.

**P2 — transient punch at matched loudness** *(levers: patch amp/filter env attack ≤8–12 ms;
engine transient shaper — 133's #1 build ask, this doc's numbers second it; NOT more
compression)*. Targets: truePeakDb ≥ −5 dB after batch normalization (ref medians −1.7…−4.9 by
role; engineplus −7.6…−9.9), crestDb 15–18 dB (chords/lead/drums), attackMedMs ≤12 ms chords
(now 30.2), ≤8 ms lead (now 26.6). Strongest packs head-to-head discriminator (+1.38 d).

**P3 — movement + articulation** *(levers: composition — onset rate, velocity contrast, ghost
notes via the unused MIDI-expression surface (135 §4); patch — filter-env/LFO depth so notes
evolve)*. Targets: fluxMean ≥0.17 (ref 0.17–0.26 by role; engineplus 0.08–0.12 on the melodic
roles), onsetRatePerSec ≥4 on chords (ref 4.9 vs 2.3), attackCv ≈0.7–0.8, onsetLevelCv ≥0.5 on
chords/lead (ref 0.51/0.53 vs 0.26/0.36). fluxMean alone is +1.06 d in the core matchup.

**P4 — texture: noise/complexity into the band, not past it** *(levers: sound source — layers,
noise osc, saturation/exciter (133 §5); this is the axis production constants alone haven't
closed)*. Targets: flatnessHiDb −16…−8 dB (engineplus sits at −14…−35; gen's failure shows the
ceiling: overall flatnessDb should stay BELOW ref+~5 dB and slope at −10…−14 dB/oct on melodic
roles, or you land in gen's hiss regime, §3.3). Watch it through aesPC, the single best overall
proxy (+0.91 packs target gap on chords).

**P5 — role-true width map** *(lever: production profiles — trivial)*. bass ≤−40 dB, chords ≈−5,
lead ≈−5…−8, drums ≈−13 (all packs-ref medians). The frozen role-blind engineplus constant
(−10…−12 everywhere) is measurably wrong in BOTH directions; 135 §2 found the same by code read.

**P6 — drum-loop density** *(levers: composition/kit — fills, ghost hits, layered percussion,
longer tails)*. Targets: sustainPct ≥45% (ref 51 vs 27), envRangeDb ≤ ~25 (vs 44), onsetLevelCv
≤0.6, crest_subDb ≤ ~20 dB. Note drums are the role where gen already TIES the refs (6–6) —
mine gen drum loops as free positive exemplars.

**Explicitly NOT on the path** (measured dead ends): more loudness (lufs 0.525), more broadband
width for its own sake (§5), absolute roughness/cleanliness screens (§4), "add compression" as
a crest fix (§6), and treating Audiobox PQ or CE as a target (PQ inverts globally; CE inverts
on bassline).

## 8. Honest gaps

- **Observational, not causal.** Every effect size is a difference between things the owner
  ranked, confounded with everything else that differs between sources. The path items are
  hypotheses priced for cheap falsification (one showdown arm each), not guarantees.
- **Attack-time extraction is heuristic** (onset-picked 10→90% rise on a 2 ms envelope);
  polyphonic/pad material can fool it. Directions are consistent across roles and with crest,
  but treat exact ms thresholds as ±30%.
- **Small-n cells flagged inline**: engineplus-beat-ref n=18, gen-beat-ref n=43, surgeplus
  anything n≤39, top-5 ceilings n=5/group. The packs era is 75 batches — per-role packs cells
  are 13–22 batches.
- **aesthetics backfill hardware**: the 637 backfilled Audiobox scores were computed with the
  same model/checkpoint as the 336 existing sidecars but on this machine today; no drift check
  was run between the two populations (spot medians line up).
- **The linear attribution in §3.1 splits collinear width features arbitrarily**; only the
  net-of-family number (≈16%) is meaningful.
- **What ISN'T measured here**: harmonic interest, groove/pocket feel, phrase-level composition
  quality — none of the 42 features hears chord voicings or swing. gen's 43 wins over ref
  (§3.3) are the residual this feature space explains worst; the composition axis stays open,
  consistent with 124/125's separate program.
- **Rejected-ref contamination**: 23 rejected ref chops (hot-peaked/sub-flooded) slightly
  soften every ref-vs-X effect size; the true bar (winning refs only) is a little further away
  than the medians here.

*Pipeline and caches: `~/.claude/jobs/fc3bd856/tmp/gapanalysis/` — `extract.py` (log+sidecar
join), `richfeat.py` (25 DSP features, 973 clips), `aes.py` (Audiobox backfill, cached outside
the repo), `rough.py` (MoSQITo), `analyze.py` (effect-size tables), `model.py` (held-out
discrimination, ceiling check, attribution). Nothing under `taste-dataset/` or the batch dirs
was written to.*
