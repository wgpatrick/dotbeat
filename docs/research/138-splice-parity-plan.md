# Research 138 — The Splice-parity plan: one diagnosis, one checklist, one ladder

*Run 2026-07-26, commissioned by the owner's directive (verbatim): "I really want you to figure
out how you (the agent) can use dotbeat to generate clips that I rank as good as splice clips."
This doc is the synthesis of the five research passes that landed 2026-07-25/26 — 131 (the
empirical gap analysis: 177 rated batches, 1,612 owner pairwise preferences, 973 clips re-featured
with 25 new DSP features + Audiobox + roughness — the measured spine everything here hangs on),
132 (sound-source expansion / the surge diagnosis), 133 (production-chain depth), 134 (patch
design at scale), 135 (the producer knowledge layer) — reconciled into ONE plan: a unified causal
diagnosis, a free-wins checklist, a ranked build list, a pre-registered experiment ladder, and an
honest ceiling statement. No new measurement was run for this pass; every number cites its source
doc, and where two passes disagree the disagreement is stated and resolved, not averaged.
Constraints honored throughout: D24 (blindness outranks the controlled ablation; `--shared-figure`
is a deliberate opt-in), D25 (pack refs are rateable but NEVER critic-training data; commercial
MIDI stays private), D26 (the path is synthesis-toward-commercial), D27 (the north-star metric is
a genuine blind win over a ref, not an aggregate). Confidence: **High** = measured in 131's
1,612-pair analysis or verified by code read in 132–135; **Medium** = one pass's measurement with
a known confound or small n; **Low** = prediction/inference. Companions:
`docs/source-showdown-eval.md` (the arm machinery every experiment below rides),
`docs/decisions.md` D23–D27, research 114/115/117/120/121/123/124/127.*

## Headline answers

1. **A dotbeat clip loses to a Splice loop because the Splice loop is born produced and the
   dotbeat clip is rendered dry — decomposable into five measured causes, in order of measured
   contribution: (1) wrong register / unsteady low end, (2) dead transients, (3) no movement or
   articulation, (4) too-clean texture, (5) role-blind width — plus a sixth, meta-cause: the
   harness sabotages its own sources (surge never learns the tempo, the ring gate rejects 22% of
   the owner's own Splice leads, the patch generator explores 8 of ~58 fields, and the critic
   literally cannot see the top discriminators).** All five passes agree on this story from
   independent directions; the two apparent disagreements (crest, width) resolve cleanly (§1.3).
   (High.) §1
2. **Roughly a third of the measured gap costs a config change.** Fourteen free wins are
   implementable today with exact measured targets: `subLevel` 0→0.5 on bass, the bass figure an
   octave down (root E1–A1), `osc2Detune −1200` body on chords/lead, `compMix` 0→0.35 parallel
   compression (a real NY dry/wet fan sits unused in the engine), bass-mono discipline (the frozen
   profile currently widens bass to −11.8 dB against a −45 dB mono target), the role-true width
   map, envelope attacks ≤8–12 ms, the ghost-kick pump, the surge tempo binding (~3 lines of
   pybind), per-role ring-gate recalibration, and the `patches_3rdparty` enumeration (639→3,559).
   Full checklist with current/target values in §2. (High that each is unset/miscalibrated today;
   Medium that each moves ratings — that is what the ladder tests.) §2
3. **The build list is gated by one item: the critic feature upgrade (P0).** 131 measured the
   current 13-feature critic at 0.676 held-out pairwise on the owner's own preferences; the 25 new
   features take it to 0.795 (+0.12), and to 0.776 on synth-vs-synth pairs — the space every
   automated screen, curation pass, and search actually ranks. Every other build item's success is
   *scored* by this instrument, so it ships first. Then, by measured-effect × achievability:
   transient shaper node > role-targets/`rolecheck` plumbing > surge2's five fixes >
   composite-arm plumbing > match-to-loops factory > second tier (OTT, `duckRelease`, exciter,
   pedalboard probe, keymap-v2). §3
4. **The experiment ladder is six rungs, one variable each, every rung pre-registered.** Rung 0
   costs no owner time (critic upgrade, validated on the existing log). Rung 1 — the cheapest test
   of the biggest per-role measured effect — is the bass-register arm: subLevel + octave + mono +
   steady sub on bassline only, where engineplus already goes 17–4 in its wins and the D27 event
   is nearest. Rungs 2–5: punch/density (chords/lead), the crafted checklist arm, surge2, the
   composite arm. Rung 6 is the match-to-loops ceiling measurement. Rungs 1 and 2 touch disjoint
   roles and share rounds. §4
5. **The global falsifier, stated up front:** if the rung-1–3 arms land their feature targets
   inside the ref bands and blind pairwise still moves < 10 points, the central thesis — that the
   gap is majority register+punch+movement+texture and reachable by matching measured targets with
   current synthesis — is false, the observational effect sizes were not causal, and the program
   redirects to new sound sources / sampled material per §5. §4
6. **The honest ceiling: the D27 event (occasional genuine blind wins) is reachable with current
   capabilities — on bassline and drum-loop, plausibly within a few rounds. Consistent all-role
   parity with the packs pool (its 87% pairwise class) is NOT supported by any measured path using
   single-voice rendering:** the best timbre+production arm reaches ~58%, and the residual axes
   (in-band texture, layered density, dark tilt — what "born produced" measures as) belong to the
   clip *shape*, not the patch. Parity requires the composite/layered arm as the default clip
   shape, the transient shaper, and at least one texture-capable source (plugin-host presets or
   sampled top layers) — all in-house-feasible, none a new synthesis paradigm. Even then the
   upgraded critic tops out at 0.795–0.817 vs the owner's 0.917 self-consistency, and no feature
   hears harmony or pocket: automated search cannot finish the job alone; the owner's blind ear
   remains the instrument, exactly as D27 already says. §5

---

## 1. The unified diagnosis

### 1.1 The causal story, reconciled across the five passes

A Splice pack loop is a **produced, layered, mix-placed program stem** — 2–4 sound layers,
registration decided, transients shaped, band energy steadied, one or two character moves, edges
finished (132 §1, 133 §2). Every dotbeat source except gen renders a **naked solo patch** and
competes in the wrong weight class (132's "born produced vs rendered dry"; gen sits at 72–83%
*because* its output arrives sounding finished, and it is the only non-ref source whose feature
row sits beside ref's). Concretely, when the owner blind-ranks a ref above a dotbeat clip, the
measured differences are (packs-era ref-beat-engineplus, 61 pairs, 131 §3.1 — High):

- **Register and low-end steadiness.** Ref bass: 60.1% of energy below 60 Hz, centroid ≈74 Hz,
  sub-band crest 7.2 dB. Engineplus bass: 0.22% sub, centroid ≈162 Hz (>1 octave high), sub crest
  24.3 dB — the low end is both missing and flapping. Ref chords/leads carry 10–24% bass-band
  body; engineplus concentrates ~99% of energy in the mids (133 §1, 135 §A.2, confirmed 131 §6).
- **Transient life at matched loudness.** Refs peak a median **5.5 dB hotter** at the same LUFS
  (truePeak paired d +1.38 — the strongest head-to-head discriminator in the log), with attacks a
  median **6.2 ms faster** and 3.4 dB more broadband crest. Nothing in any dotbeat profile
  shortens an envelope or shapes an attack (133 §1).
- **Movement and articulation.** fluxMean d +1.06 (refs move ~2× as much spectrally); ref chords
  fire 4.9 onsets/s vs engineplus 2.3 and surge 1.3 (the tempo-bug fingerprint, visible blind);
  attack-time *variety* (attackCv) discriminates at 0.631 globally. The entire per-note expression
  surface (velocity tiers, swing, chance, ratchets, humanize) is built and unused (135 §D).
- **Texture in the band.** Winning refs are *noisier* in the 2–8 kHz presence region
  (flatnessHiDb d +0.66) and rougher than the synth clips they beat — while gen's failure mode is
  overshooting into hiss. The target is a band, not a direction: flatnessHiDb ≈ −16…−8 dB, slope
  ≈ −10…−14 dB/oct (131 §3.3). Audiobox PC — the best single proxy for this whole family — is the
  strongest discriminator in the log (P(win|hi) 0.757).
- **Role-true width placement.** Elite ref bass is dead mono (−43 to −51 dB) while elite ref lead
  is wide (−4.6 dB); the frozen engineplus constant is −10…−12 everywhere — measurably wrong in
  both directions. Width is a *placement* variable now, not a more-is-better one (131 §5/§6).
- **The meta-cause: self-sabotage in the harness.** Surge renders every tempo-synced patch at a
  hard-coded 120 BPM (surgepy binds no tempo API — verified upstream, 132 §2.3); the eval draws
  from 18% of the patches on disk and excludes the loop-relevant categories; the ring gate
  (−32 dB) fails 22% of the owner's own Splice leads (134 §2.2 — the gate rejects the quality
  bar); the E2 generator rolls 8 of ~58 synth fields, so the screened pool structurally cannot
  contain a reese, a supersaw, a pluck, or any movement (134 §2.1); and the critic's 13 features
  do not include flux, attack statistics, per-band crest, or flatness — the top discriminators —
  so it scores 0.676 held-out where the owner's own test-retest is 0.917 (131 §4). Every past
  automated search was optimizing a proxy that couldn't see the target, and every cleanliness
  screen pointed away from it (aesPQ votes AGAINST the owner's winners at 0.415).

One more structural fact makes this a *plan* rather than five plans: **gen beats engineplus on
exactly the same axes ref does** (131 §3.2, d-values nearly identical, and gen wins while
narrower). One program closes both gaps. And the residual ref-vs-gen axis (refs darker, less
noisy, steadier) defines the target *band* the synth sources undershoot and gen overshoots.

### 1.2 The causes, ranked by measured contribution

Ranking blends 131's univariate paired-d table (robust) with its linear attribution over the 61
core pairs (Medium — collinear features; only family-level numbers are meaningful) and per-role
coverage. The percentages are attribution shares of the ref-beat-engineplus margin; treat as
rough.

| rank | cause | strongest evidence | attribution share | roles hit hardest | conf |
|---|---|---|---|---|---|
| 1 | Transient punch + peak life | truePeak d **+1.38** (+5.5 dB), attackMedMs −0.63, crest +0.69 | ~11% (truePeak) + part of tilt/steadiness | chords, lead, drums | High |
| 2 | Movement/articulation | fluxMean **+1.06**, fluxP95 +0.77, onsetRate ref 4.9 vs 2.3/s | ~17% (fluxP95) | chords, lead | High |
| 3 | Register + low-end steadiness | sub share 60.1 vs 0.22%, crest_subDb −0.74, centroid 74 vs 162 Hz | ~7% sub-crest + ~10% centroid | bassline (dominant), chords body | High |
| 4 | Texture in the band | flatnessHiDb +0.66, aesPC +1.11, slope −0.47 | ~15% flatness + ~18% tilt | lead, chords | High |
| 5 | Role-true width placement | bass −43 vs −12; lead −4.6 vs −10.7 | ~16% net (width family) | bass (mono), lead (wide) | High |
| 6 | Drum density/fullness | sustain 51 vs 27%, envRange 22 vs 44 dB, flatnessLoDb 0.782 | — (different matchup) | drum-loop | High |
| — | Harness sabotage (meta) | surge 1.3 onsets/s; ring gate 22% false-reject; 8/58 fields; critic 0.676 | multiplies everything above | surge + all searched pools | High |

Why rung 1 of the ladder is nonetheless **register, not punch**: punch's full fix needs a new
engine node (the transient shaper — a build item), while register's fix is entirely config
(§2 rows 1–3, 5), lands on the role where engineplus is already closest to winnable (bassline:
17–4 in its wins, the only role with multiple outright batch wins), and attacks the largest
single per-role feature gap in the eval (131 headline 4). Cheapest test × biggest per-role
effect = rung 1.

### 1.3 Where the passes disagreed, and the resolutions

- **The crest story (133 vs 131) — resolved by scale separation.** 133 measured pack loops as
  MORE dynamic (broadband crest 15.5–18.3 vs engineplus 10.6–14.0) and prescribed "articulation,
  not compression." 131 confirmed that at the transient scale AND found the opposite at the
  band-energy scale: refs are 2–4× *steadier* per band (sub crest 7–18 vs 21–43 dB; drum envRange
  22 vs 44 dB). Both are true at different time-frequency scales; sparse arrangements masquerade
  as dynamics in a broadband number. The reconciled prescription: **sharpen transients (shaper,
  short attacks, velocity contrast) AND steady the band energy (register, sustain, density). A
  compressor alone does neither** — and 135's drum-loop advice ("compress to crest 12–15") is the
  one place a downward move is right, because drums are the role where dotbeat under-compresses.
  (High.)
- **The ring gate (134 vs 131) — agreement from two directions, one conclusion.** 134 ran the
  gate over the owner's own Splice loops: 22% of leads and 16% of chords fail it. 131,
  independently, found every cleanliness metric inverts against preference across all 1,612 pairs
  (aesPQ 0.415, winners noisier and rougher). Same conclusion: **screens tuned for clean reject
  the owner's actual bar. Recalibrate the gate per role against the owned refs; never use an
  absolute cleanliness/roughness screen** (roughness stays pair-relative per research 123, now
  re-confirmed). (High.)
- **The width doctrine (133 vs 131) — sharpened, not contradicted.** 133 declared the width gap
  "closed" (engineplus already in pack range for chords/lead/drums); 131 agreed the ref-vs-synth
  width race is over but found width still discriminates *among synths* (0.704) and is grossly
  wrong on bass in the wide direction. Resolution: width is done as a global chase, live as a
  per-role placement map (§2 row 6). (High.)
- **Scoreboard absolute numbers (all passes)** differ by window and pairwise convention
  (engineplus quoted anywhere from 24% to ~53%; the commissioning notes' figures never exactly
  reproduced). The *ordering* replicates in every split: ref 87–88 > gen 72–83 > surgeplus ~35–58
  > surge 36–53 > engineplus 31–34 ≈ keymap ~30–31 > engine 1–3. This plan treats all point
  estimates as ±10 and pre-registers thresholds accordingly. (High on ordering.)

### 1.4 What remains unexplained

Honestly stated: the 42-feature space explains the owner's preferences at 0.795–0.817 held-out
against a 0.917 self-consistency ceiling. The residual — worst on gen-beats-ref pairs — is
**harmonic interest, groove/pocket, and phrase-level composition**, which no current feature
hears (131 §8). 134's decomposition says composition contributes ~0 at clip scale *for the
sources tested* (commercial MIDI figures didn't move raw engine off ~0%), but gen's 43 wins over
refs came on smoothness/composition when the ref chop was harsh. The plan does not pretend to
close this axis; it keeps the owner's blind rating as the only instrument that measures it
(D27), and flags it as the reason the critic remains a pre-filter, never a judge.

## 2. The free wins — the implementation checklist

Everything below costs a config change, a new named profile (never an edit to the frozen
`engineplusProfile`/`surgeplusProfile` — CLAUDE.md frozen-science rule), or a few lines. Each
row: the exact lever, today's value, the measured target (packs-ref medians/bands from 131 §7,
133 §1, 135 §A.2), and the expected metric move. "Conf" rates the *diagnosis* (the lever is
wrong today) — whether fixing it moves ratings is what §4 tests.

| # | lever (exact parameter) | current | measured target | expected move | conf | source |
|---|---|---|---|---|---|---|
| 1 | **Bass sub layer** — `subLevel` on the bassline patch | 0; no profile has ever set it | 0.5 | bandSubPct 0.2% → ≥30% (ref med 60.1, p25 ≈37) | High | 133 §1/§5, 131 P1 |
| 2 | **Bass octave** — figure root in theory.ts / the composed figure | `key.root − 12` ≈ 110 Hz | root E1–A1 (MIDI 28–33, 41–55 Hz); centroid ≤ ~90 Hz (ref 74) | centroid −1 octave; sub share up | High | 135 §A.2/§B.1, 131 §2.2 |
| 3 | **Octave body layer** (chords/lead) — `osc2Type` = main osc, `osc2Detune −1200`, `osc2Level 0.3–0.4` (± `subLevel 0.1` on chords) | engineplus uses osc2 at **+10 cents** (a width move, not a body move) | chords bass-band 18–28%, lead 5–12% | bandMidsPct 99 → ≤90 | High | 133 §4-gate-1/§5 |
| 4 | **Parallel (NY) compression** — `compThreshold −32`, `compRatio 8`, `compAttack ≤0.005`, `compRelease 0.12`, `compMix 0.3–0.4` | `compMix` ships at 0, untouched by every profile and trick — the comp insert is a true dry/wet fan sitting unused | density up while crest HOLDS in role band (chords/lead 14–17 dB) | rmsDb up, crest −≤2 | High (unused) / Medium (effect) | 133 §3/§4 |
| 5 | **Bass mono discipline** — new profile: `unisonWidth 0`, `chorusMix 0`, `sendReverb 0`, `pan 0` on bass | frozen role-blind profile widens bass to −11.8 dB, corr 0.88 | width ≤ −40 dB, corr ≥ 0.98 (elite refs −43 to −51) | the single largest width error, both passes | High | 135 §A.2, 131 §5 |
| 6 | **Role-true width map** (production profile constants) | −10…−12 dB everywhere | bass ≤−40, chords ≈ −3…−8, lead ≈ −5…−8, drums ≈ −13…−19 | placement, both directions | High | 131 P5, 133 §1, 135 §A.2 |
| 7 | **Envelope attacks** (chords/lead patches) — amp/filter env attack | attackMedMs chords 30.2, lead 26.6 | ≤12 ms chords, ≤8 ms lead (ref medians; ±30% — heuristic extraction) | attackMedMs down; crest up | High (gap) / Medium (thresholds) | 131 P2 |
| 8 | **Articulation/movement** (composition) — onset rate, velocity tiers, rests, filter-env depth | chords 2.3 onsets/s; near-uniform velocity; expression surface unused | onsetRate ≥4/s chords; fluxMean ≥0.17; onsetLevelCv ≥0.5; attackCv ≈0.7–0.8 | fluxMean toward ref (d +1.06 axis) | High (gap) / Medium (recipe) | 131 P3, 135 §D |
| 9 | **Ghost-kick pump** — add a `pump` drums track, kick on quarters, `volume −60` (floors to −∞), `duckSource pump`, `duckAmount 0.4` on bass/chords | never used; duck reads kick *hits*, not audio, so this works today (synth tracks only — the duck no-ops on sample hosts) | audible motion; Audiobox PC is the proxy (no static FEATURE_KEY sees it) | motion | High (expressible) / Medium (effect) | 133 §4/§5 |
| 10 | **Surge tempo binding** — bind `time_data.tempo` in the local surgepy build (~3-line pybind; upstream hard-codes 120), pass batch BPM; until it lands, screen out tempo-synced patches | every surge clip ever rated ran synced mods at 120 regardless of batch tempo | synced LFO/delay/arp on-groove; onset rate 1.3/s → ref-ward | fixes the measured tempo-bug fingerprint | High (diagnosis) | 132 §2.3 |
| 11 | **Ring-gate recalibration** — per-role thresholds set so ≥95% of that role's own pack loops pass; drop the lead probe an octave (C4–C5); screen the *produced* render, not the raw voice; loudness-normalize probes | one global −32 dB gate; fails 22% of owner's Splice leads, 16% of chords | role-calibrated or ref-relative gate | bright designed leads survive curation | High | 134 §2.2/§5 |
| 12 | **Enumerate `patches_3rdparty`** + extend role map (Polysynths/Chords → chords; Sequences → lead, post-tempo-fix) | eval sees 639 of 3,559 patches (18%), wrong categories for loops | full pool, re-curated vs §2 targets | timbral breadth ×5.6 | High | 132 §2.1 |
| 13 | **Drum kick rebalance** — kick lane gain −2…−3 dB or shorter `kickDecay`; velocity tiers + ghosts + swing 54–58% on hats | engineplus drum sub 60.2% (kick drowning kit); flat velocities | sub 25–40%, sustainPct ≥45, onsetLevelCv ≤0.6 | drum density toward ref | High | 131 P6, 135 §B.4 |
| 14 | **Ref-pool hygiene** — remove the drum loop found in `refs-packs/lead/` | at least one mislabeled ref pollutes the lead split | clean per-role pools | eval hygiene | High | 133 §1 |

**Explicitly NOT on the checklist** (measured dead ends, 131 §7): more loudness (lufs 0.525 —
the normalizer works), broadband width for its own sake, absolute roughness/cleanliness screens,
"add compression" as a crest fix on melodic roles, treating Audiobox PQ or CE as targets (PQ
inverts globally; CE inverts on bassline).

## 3. The build items — ranked by measured effect × achievability

| rank | item | size | measured basis | depends on | unblocks |
|---|---|---|---|---|---|
| **B0** | **Critic feature upgrade** — append 131 §4's list to `FEATURE_KEYS` (fluxMean/P95, flatnessHiDb/Db, slopeDbPerOct, per-band crest, attackMedMs/attackCv, onsetRatePerSec, onsetLevelCv, envStdDb, sustainPct, widthMeanDb); regularize or prune to top-10 on synth-only | S–M (deterministic DSP, existing `analyze()` shape; append-only) | held-out pairwise **0.676 → 0.795** (+0.12); synth-only 0.688 → **0.776** — the space the pilot must rank | nothing; D25 constraint: pack variants stay excluded from training (`trainable()` already does) | EVERY screen, curation pass, rolecheck, and future automated search — this is the instrument that re-scores all experiments below for free. Ship first. |
| B1 | **Transient shaper node** — SPL-style dual envelope-follower differential, 3 params | S (small EffectType) | attacks the #1 head-to-head discriminator (truePeak +1.38 d, attacks −0.63) — the one gap no current node addresses; slow-attack comp is only a partial stand-in | B0 to *measure* success (attack features) | rung 2's full form; the crest prescription's transient half |
| B2 | **Role-targets + `rolecheck` + `craftedProfile`** — `presets/role-targets.json` mined from the log (pack-pool rows only, manifest-joined), `beat rolecheck <wav> --role` pass/fail with named fixes, a NEW role-aware profile implementing 135's F1–F10 | S–M | 135 §E/§F; targets = 131/133/135's measured rows; regenerated from data, never hand-tuned | B0 (richer features in the gates) | the crafted arm (rung 3) nearly free; exit gates for every other arm; a future owner complaint becomes a range + fix line |
| B3 | **surge2's five fixes** — (1) tempo binding S, (2) 3rdparty enumeration S, (3) re-curation against ref targets M, (4) `surge2Profile` fit to measured ref rows (width −30 not −17, crest via comp not saturator crush, compressor added) M, (5) one `setParamVal` filter/macro ride per phrase M | S–M each | midi-figure split already proved the ceiling: surge-lead 69% ≈ gen 71% with composition controlled; each defect named and repo-verified | (11) ring-gate recalibration before re-curation | rung 4; the largest patch library in reach |
| B4 | **Composite-arm plumbing** — layered clip per role (engine sine/tri sub + surge/keymap mid + optional one-shot top; same figure across layers), produced to ref targets via the two-stage re-host | M | 132 §5: the only arm whose feature vector can sit *inside* the ref distribution; pack loops are layered by construction; 134's decomposition (layering ~25% of the gap) | free wins + B2 targets | rung 5; the "born produced" clip shape; the honest shot at D27 on chords/lead |
| B5 | **Match-to-loops patch factory** — M0 stable cuts from the 41 owner-endorsed winning pack loops → M1 ceiling run (budget 500–2000/target) → M2 assembly into produced stacks | M | T6: envelope solved (residual 0.06–0.20); spectrum number understated (noisy Demucs targets, no layering, no chord candidate); 59 loops already blind-rated, 41 batch winners | ring-gate recalibration; a chord-note candidate in `space.ts`; **owner's Splice-ToU ruling before any matched patch is committed** (private `taste-dataset/match-presets/` until then) | rung 6; doubles as the measurement that decides whether the engine's per-voice timbre ceiling is real |
| B6 | Second tier: OTT-style 3-band up/down comp (M), `duckRelease` (S — one SYNTH_FIELDS number), exciter scoped to drums/hats (S–M), pedalboard plugin-host probe → Dexed/DX7 then OB-Xf (S probe / M productionize), keymap-v2 multi-zone + root verification (S–M) | — | 133 §7 Phase B ordering; 132 §4.4/§5 (one probe unlocks five preset ecosystems) | B0–B4 results decide which fires | escalation paths if §4's falsifier trips |

## 4. The experiment ladder

Design rules, fixed for every rung: ordinary `writeShowdownBatch` arms; per-source figures by
default (D24 — when a rung needs same-figure control AND blindness, run two shared-figure
batches with disjoint figure draws, D24's own revisit clause); pack-ref pool as anchor
(`--ref-dir taste-dataset/refs-packs`); gen as the second anchor; theory/midi-tier figures (the
bank is known to drag, D26-era finding); every arm's clips pass their B2 feature gates BEFORE
entering a batch (never spend owner ratings on a clip that missed its own targets); all
thresholds read against ±10-point noise at n=8–12 batches (135's honest-gaps caveat); success
criteria pre-registered here, before any batch is built. The north star at every rung is D27:
the first genuine blind win over a pack ref.

**Rung 0 — the instrument (no owner time).** Ship B0; validate by grouped-10-fold on the
existing 1,612 pairs. *Pre-registered success:* held-out ≥0.78 all-pairs and ≥0.75 synth-only
(131 measured 0.795/0.776; margin for implementation drift). *If it fails:* the feature pipeline
has a bug (131's numbers came from a parallel scratch pipeline) — fix before proceeding; nothing
else in the ladder is interpretable without this.

**Rung 1 — bass register (the cheapest test of the biggest per-role effect).** One new arm
(`bass2`, a new named profile beside the frozen ones): checklist rows 1+2+5 ONLY — `subLevel
0.5`, figure root E1–A1, bass-mono — no parallel comp, no ghost kick, no other changes, so the
variable is exactly "register + steady sub + mono." Bassline batches only, ~8 batches alongside
engineplus, ref, gen. *Feature gates before rating:* bandSubPct ≥30%, centroid ≤90 Hz,
crest_subDb ≤ ~11 dB, width ≤ −40 dB. *Pre-registered success:* bass2 beats engineplus
head-to-head in ≥65% of implied pairs; stretch: a D27 event on bassline (the role where
engineplus already goes 17–4 and holds real batch wins). *Reading a failure:* if the features
land inside the ref band and ratings don't move, the strongest observational effect in the whole
log is not causal — see the global falsifier below.

**Rung 2 — punch + density (chords/lead; shares rounds with rung 1 — disjoint roles).** Arm
`punch2`: checklist rows 3+4+6+7+8 — octave body, parallel comp, role width, fast attacks,
velocity/onset articulation. Today's nodes only (no transient shaper yet — its absence is
informative). *Feature gates:* crest 14–17 dB, truePeak ≥ −5 dB post-normalization, attackMedMs
≤12/8 ms, bandMidsPct ≤90, fluxMean ≥0.15. *Pre-registered success:* ≥2× engineplus's role
pairwise (chords 11% → ≥25%, lead 17% → ≥35%) over ≥8 batches/role, and beats engineplus
head-to-head ≥65%. *Follow-up if crest gates prove unreachable with comp+envelopes alone:* build
B1 (transient shaper) and re-run — that ordering is itself the measurement of whether the shaper
is necessary.

**Rung 3 — the crafted checklist arm (does stacked knowledge close further?).** 135 §F as
specified: same figure/patch discipline as engineplus, full §B checklist (register + role-true FX
+ MIDI feel pass + verify loop = `rolecheck` headless). *Pre-registered success:* crafted ≥55–60%
pairwise (vs engineplus 32–47%). *Secondary read:* crafted vs rung-2's punch2 isolates the
MIDI-feel/motion layer's worth (invisible to every feature — only ears measure it). Wins
concentrated in bass+drums with chords/lead flat localizes the residual to voicing/timbre.

**Rung 4 — surge2 (the harness, exonerated or convicted).** B3's five fixes as one opt-in arm,
2 rounds (~8 pitched batches). *Pre-registered success (132's own prediction, kept):* surge2
≥65% pairwise overall and ≥50% on bassline; lead/chords into the gen band (70–80%). *Failure
isolates per role:* a lead/chords failure after all five fixes means genuine timbre residual →
the plugin-host probe (B6) is the escalation; a bass failure redirects bass to the composite
shape.

**Rung 5 — the composite arm (the born-produced shape).** B4's layered clips, produced to the
ref rows. *Pre-registered success:* composite beats its own best single-source sibling's
pairwise in the same batches; stretch: the D27 event against a pack ref — this is the first arm
whose feature vector can sit inside the ref distribution, so it is the best-equipped shot. *If
composite ≤ its best sibling:* layering as implemented adds nothing; the residual is per-layer
timbre → rung 6 decides.

**Rung 6 — the ceiling measurement (match-to-loops M1) + the matched arm.** B5's M1 run prices
the engine's per-voice timbre ceiling on CLEAN targets (the T6 number was measured against noisy
Demucs chops). *Decision gate:* best MFCC ≤ ~1.5× the 15.3 self-match floor → matching is a
viable per-layer patch factory; run 134 §7's pre-registered arm (matched-assembled vs curated
bank vs designed-family, target loop held out). Still ≥2× on clean near-solo targets → the
engine's timbre ceiling is real; say it plainly and redirect the top layer to keymap/sampled/
plugin-host sources (§5).

**The global falsifier.** The thesis under test across rungs 1–3: *the ref gap is majority
register + punch + movement + texture, measurable in the 42-feature space, and closable by
matching measured targets with current synthesis.* If rungs 1–3 all land their feature gates and
the combined blind pairwise movement is <10 points, the thesis is FALSE: the observational
effect sizes of 131 were source-identity proxies, not causes; the gap lives in what the features
can't hear (timbre depth, composition, feel); and the program redirects immediately to §5's
capability changes (composite shape + new sources) rather than further target-matching. Stating
this now is what makes the ladder an experiment rather than a ratchet.

## 5. The honest ceiling

**Question, per the owner: can the agent use dotbeat, as it stands, to generate clips ranked as
good as Splice clips?** Three answers at three bars, synthesized from 134's decomposition and
131's instrument limits rather than averaged into optimism:

1. **The D27 bar (a genuine blind win, occasionally): reachable with current capabilities.**
   Evidence: engineplus bassline already goes 17–4 with multiple outright batch wins while
   missing its two biggest measured levers (sub register, mono); gen already TIES the packs pool
   on drum loops (6–6); the produced-engine ceiling has touched the target class once (D27's own
   n=1 soft-ref event). Rung 1 + the drum free wins are the near-term shots. (Medium-High.)
2. **Consistent parity (living in the packs pool's 87% pairwise class) with single-voice
   rendering: NOT reachable on any measured path.** 134's ladder decomposition is the direct
   evidence: commercial timbre alone ~30%, production alone ~33%, designed timbre + production
   ~58% — and the remaining ~30 points are exactly the axes (layered density, in-band texture,
   dark tilt, transient life) that define "born produced," properties of the *clip shape and
   chain*, not of any single patch. 131 concurs from the feature side: the best-vs-best gap is
   many medium axes with role-specific signs — no knob closes it. A solo patch arm, however good
   its patch, is structurally competing against mini-mixes. (High.)
3. **What has to change for bar 2 — all of it in-house-feasible, none of it a new synthesis
   paradigm:** (a) the **composite/layered clip as the default rendered shape** (B4) — this is
   the single capability change that attacks the residual head-on; (b) **two small engine DSP
   nodes** — transient shaper, then OTT-style per-band dynamics — for the punch/steadiness halves
   no current node provides; (c) **at least one texture-capable source** for the 2–8 kHz band and
   bass character the current oscillators undershoot: the pedalboard plugin-host probe (Dexed/DX7
   banks, OB-Xf's 300 pro presets) or sampled top layers (sfizz + CC0 content), entering ONLY
   through the composite pipeline — 132's ranking stands: a dollar making existing sources render
   *finished* beats a dollar of new raw source; (d) **the critic upgrade** so any automated
   search sees the target at all. If rung 6 additionally confirms the engine's per-voice timbre
   ceiling on clean targets, the mid/top layers of unreachable stacks come from those new sources
   while the engine keeps the roles it measurably owns (sub, body, glue). (Medium — this is the
   synthesis of measured decompositions, not itself a measurement.)

Two permanent honesty clauses. First, **even the upgraded critic cannot certify parity**: 0.795–
0.817 held-out against the owner's 0.917 self-consistency, with harmony, groove, and phrase
composition entirely unmeasured — automated search narrows candidates; only the owner's blind
ear, through the unchanged showdown, declares a win (D27 is not just the goal, it is the only
valid measurement of the goal). Second, **"as good as Splice" is a moving bar the eval itself
enforces**: rejected refs (hot-peaked, sub-flooded chops) lose too, and the true bar — winning
refs only — sits slightly beyond every median target quoted here (131 §8). The plan aims at the
band, expects the band to tighten, and keeps every threshold regenerable from the log rather
than frozen lore.

## Honest gaps

- **Observational → causal is the load-bearing leap.** Every §2 target is a difference between
  things the owner ranked, confounded with source identity; §4's ladder exists to convert each
  into a causal claim or kill it. The global falsifier is real and could fire.
- **The passes' absolute scoreboard numbers never fully reconciled** (window/semantics
  differences; engineplus 24–53% depending on split). All thresholds here are set against the
  ±10-point convention; the ordinal story is window-invariant.
- **Small-n cells everywhere at the role level:** packs-era per-role cells are 13–22 batches;
  surgeplus's 58% is 43 comparisons; the midi-figure split is n=16 batches; top-5 ceiling groups
  are n=5. Rung thresholds account for this but cannot eliminate it — expect one rung to need a
  second round of batches before its read is trustworthy.
- **Blindness vs ablation tension (D24) is managed, not solved:** rungs 1–3's clean reads want
  same-figure control; the default stays distinct figures, with the disjoint-draw shared-figure
  design reserved for confirmation rounds. Twin-recognition risk (owner hears near-duplicates)
  recurs for any arm sharing figure+patch with engineplus — the surgeplus 0%-wins twin incident
  is the precedent.
- **Two legal gates are open owner decisions**, flagged not assumed: the Splice-ToU reading on
  CMA-ES-matched patches (B5 stays private-dir until ruled), and the Surge factory/3rdparty
  content license (#6741 still open — render-gitignore posture unchanged, re-verify before
  anything ships beyond the private eval).
- **Attack-time and per-onset metrics are heuristic** (±30% on ms thresholds); the ghost-kick
  pump and all MIDI-feel moves are invisible to every static feature — their rungs are judged by
  ears and Audiobox PC proxies only, and a crafted-arm win needs a follow-up ablation
  (`crafted-nofeel`) to attribute between FX and feel.
- **This doc ran no new measurements.** If any cited number conflicts with a future
  manifest-joined, era-tagged recomputation, prefer the recomputation (134's own rule) and
  regenerate the affected targets from the log.
