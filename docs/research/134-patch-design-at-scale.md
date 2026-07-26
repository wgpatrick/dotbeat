# 134 — Patch design at scale: from "better presets" to engine clips that tie Splice loops blind

*Run 2026-07-26 for the owner's idea (c) ("better synth presets"), refocused mid-pass by the
owner's directive of the same day, captured verbatim in intent: "I really want you to figure out
how you (the agent) can use dotbeat to generate clips that I rank as good as splice clips." That
is this doc's success criterion — not presets in the abstract, but a dotbeat-rendered 4-bar clip
tying a Splice pack loop in the owner's blind ranking. Companion to docs/engine-presets.md
(E0–E4), docs/t6-sound-matching.md, docs/source-showdown-eval.md, research/114 §5/§7, 115, 117,
120. New empirical work run this pass (all read-only, commands reproducible): a patch-era split of
the full scores log via batch manifests, an audit of presets/engine-curated.json, the E2 ring gate
run over the owner's own Splice loops, and a per-loop extraction of which pack loops the owner has
blind-ranked highly. Confidence labels as in 117: **(high)** = primary source fetched or measured
here, **(medium)** = corroborated search/knowledge, **(low/S)** = single-source or from memory.*

## Headline

**The E2 curation didn't fail because random-roll-plus-screen is weak in principle — it failed
because the generator explored 8 of the engine's ~58 synth fields and the screens then rewarded
the only thing that space can make: dark, static, near-sine tones.** Measured this pass: all 17
kept lead patches are 8-param rolls with cutoff 549–2034 Hz on a C5–C6 probe (i.e. barely more
than the fundamental), and the ring gate that removed every bright factory lead **also fails 22%
of the owner's own Splice lead loops** — the gate rejects the quality bar itself.

**The recommended generator is match-to-owned-loops as a per-layer timbre factory, wrapped in
authored layering + motion + the production pass** — because the blind record says no single dry
voice ties a pack loop no matter how good its patch: production alone moved the engine 1%→~33%
pairwise, commercial timbre alone (keymap) ~30%, and only timbre+production together (surgeplus,
recent window) reaches ~58%, against ref:packs at 87%. "A patch," for this program, must mean a
produced multi-layer track stack, not a synth param bag. Whether the engine's per-voice timbre
ceiling sits below pack quality is genuinely open — T6 measured "spectrum unreachable" against
noisy Demucs chops with motion params and layering excluded from the search — and the first
milestone below (M1) re-measures it against the clean loops we now own, with an explicit
redirect-the-program branch if the ceiling is confirmed.

## 1. The scoreboard this doc has to move

Verified against `examples/taste-t1/beat-scores.jsonl` via `beat showdown --report` (170 rated
showdown batches) and a manifest-joined patch-era split computed this pass **(high)**:

| arm | pairwise (all eras) | what it isolates |
|---|---|---|
| ref (all pools) | 88% | the ceiling |
| **ref:packs** (Splice loops) | **87%** (win 67%) | **the target this doc is aimed at** |
| gen | 72% | hosted generation |
| surge | 44% | pro engine + designed patches, no production |
| surgeplus (recent window) | ~58% | pro patches **+** production |
| engineplus | 32% (curated era 33%; recent window 34%) | our engine + production pass |
| keymap | 31% | commercial timbre, engine notes, no production |
| engine | 1% (curated era 3%) | our engine, one dry mono voice |

Two readings matter. First, **the curated bank produced no meaningful blind lift**: the
`[patch: curated:<id>]` era moved raw engine from ~1% to ~3% pairwise and engineplus stayed
~31–34% — the engine remains the bottom of the 7-way ladder. (The ~20%/~53% figures circulating
from the latest round are window/semantics-dependent; every split computed this pass tells the
same ordinal story.) Second, **the ladder decomposes the gap**: timbre-only and production-only
arms both land ~30%; the one arm combining designed timbre with a production pass (surgeplus)
roughly doubles that. Composition is not the binding constraint at clip scale — `--midi-dir`
rounds held composition at commercial quality and raw engine stayed ~0%.

## 2. Why the E2 curation underperformed — three diagnoses, all verified

### 2.1 The generator could not express a single canonical role design

`scripts/curate-engine-presets.mjs` `rollParams()` rolls exactly **8 fields**: `osc` (3 types),
`volume`, `cutoff`, `resonance`, `attack/decay/sustain/release` **(high — read this pass)**. The
surface has ~58 fields (`ui/src/components/synthParams.ts`). What the roll space structurally
cannot make: a reese (`osc2Type/osc2Detune/unisonVoices`), a supersaw (`unisonVoices 7`), any
pluck (`filterEnvAmount/Decay` — the roll space has **no filter envelope at all**), the whole FM
family (`fmLevel/fmHarmonicity/fmModIndex`), a sub-anchored bass (`subLevel`), any movement
(`lfoDest/lfoRate/lfoDepth`), any width (`unisonWidth`, chorus), any space (`sendReverb/Delay`).
Every roll is a static, dry, mono, single-oscillator filtered tone. The audit of
`presets/engine-curated.json` confirms the bank is made of these: bassline 111/116 kept are rolls,
lead **17/17** are rolls (zero factory leads survived), chords 43/48. "Screened random rolls beat
the factory bank" therefore does *not* mean random generation beats design — it means the screens
preferred static-and-dark over designed-and-bright, within a pool where design was barely present.

### 2.2 The ring gate rejects the quality bar itself

`CURATION_GATES.ringDbMax = -32` (src/taste/surgeCuration.ts) was calibrated to catch the surgepy
comb-artifact whine and the owner's "piercing ringy" complaint. Applied to solo lead-probe renders
it removed 90% of lead candidates (67/678 survivors) including **every** bright factory lead —
documented in docs/engine-presets.md as "the metric doing its job." Measured this pass, it is not:
running `src/metrics/ring.ts` `ringDb` over the owner's own Splice pack loops
(`taste-dataset/refs-packs/`) gives **(high)**:

| role | loops (wav) | fail the −32 dB gate |
|---|---|---|
| lead | 59 | **13 (22%)** |
| chords | 49 | 8 (16%) |
| bassline | 32 | 0 (0%) |

A fifth of the commercial lead material the owner is blind-ranking *above everything we make*
would be rejected by our own curation gate. The metric (worst narrow tonal peak vs its 4–14 kHz
neighborhood) conflates "isolated upper harmonics of a clean bright note" with "defective
resonant whine" — and it is scale-mismatched across content: most produced loops bottom out at
the −120 dB floor (busy spectra have no isolated peak) while any solo synth note on a C5–C6
probe inherently presents isolated harmonics. The gate is also **role-blind**: one threshold for
a bass probe and a two-octave-higher lead probe. Net effect: E2 selected leads whose kept cutoffs
run 549–2034 Hz (median 1172 Hz) under a probe whose fundamentals are 523–1046 Hz — patches
passing one or two harmonics. The eval then rates those dull tones against loops like
`SS_ZMT_121_synth_discover_drop_lead` and the result is the 1–3% row above.

### 2.3 The screens measure "not broken + smooth," never "good for this role"

The composite (0.45·z(CE+PQ) + 0.30·z(criticPessimistic) + 0.15·z(ringHeadroom) +
0.10·z(activeFraction)) has no term for what §3 shows a role *needs* — movement, width,
role-appropriate brightness, layer-ability. Its two aesthetic terms are scored on **raw,
un-normalized, solo probe renders**, far outside the distribution the critic was trained on
(loudness-normalized full-ish clips; documented blind spots — 0% top-1 on gen splits,
research/117). Audiobox CE/PQ reward clean-and-pleasant, and 15% of the weight literally rewards
*more ring headroom*, i.e. darkness, twice. Under that blend a smooth dark drone beats a bright
designed lead every time. The screens did their stated job — reject broken, rank smooth — and
that job was the wrong one.

## 3. How professionals actually design these roles — the logic, in our parameter names

The craft literature dotbeat should mine is curriculum-grade, exactly as research/07 flagged
(blog-grade claims failed verification there; these are the sources it said to go to): Gordon
Reid's 63-part *Synth Secrets* series in Sound On Sound (1999–2004) — the standard subtractive
reference **(medium — series well-established; not re-fetched this pass)**; **Syntorial** (Joe
Hanley, Berklee 2003) — the point for us is its *method*: ~200 lessons training patch-recreation
**by ear** over ~64 parameters and ~700 patches **(high — fetched)**, i.e. a professional
curriculum considers a surface the size of ours *sufficient* and treats sound design as
listen-compare-adjust, which is precisely what a match loss automates; Adam Szabo's JP-8000
supersaw analysis and the Perfect Circuit history **(medium)**; the Reese lineage write-ups
(Native Instruments, Ali Jamieson, FAW) **(medium — fetched)**; Snoman's *Dance Music Manual* and
Attack Magazine's *Secrets of Dance Music Production* for genre defaults **(low/S — from
memory)**. Distilled per role, translated to `SYNTH_FIELDS`:

**Bass.** The commercial norm is **layers with a mono, unmodulated sine/triangle sub** and
character above it — the sub is separate *because* detune/width/chorus on low frequencies creates
beating and mono cancellation on club systems, so all movement lives in the mid layer
**(medium)**. dotbeat: sub = `osc sine, filterEnvAmount 0, sustain ~0.95` on its **own track**
(`subLevel` inside one voice is not a separable layer — it inherits the voice's filter and
effects); mid layer carries the design. Reese: two saws detuned against each other — the sound IS
the phase-beating, rate set by detune (0–50 cents; ~15–30 typical), lowpassed dark
(`osc2Type sawtooth, osc2Detune 15–30, unisonVoices 3–5, cutoff 400–900`), width on the mids
only. 808-style: sine + pitch drop + saturation for small-speaker harmonics (`glide`,
`saturatorDrive`, or the drum voice's `kickTune/kickPunch`). Pluck bass: `filterEnvAmount
0.4–0.6, filterEnvDecay 0.1–0.2, filterEnvSustain ≤0.15, sustain ≤0.4`. Acid: resonance high
*into* the filter envelope plus `glide 0.03–0.08` (factory `acid-bass` is correct).

**Chords/pads.** Warm analog: detuned saw/triangle pair (`osc2Detune 5–12`), slow attack
(0.3–0.8 s), long release, cutoff 1.2–3 k, and — non-negotiable — **slow movement**
(`lfoDest cutoff, lfoRate 0.1–0.3 Hz, lfoDepth 0.1–0.2`) plus width (`unisonVoices 4–5,
unisonWidth 0.5–0.8`, chorus). Glassy/bell: FM with a non-integer ratio (`fmHarmonicity 3.5–4`)
and shimmer on amplitude, not the filter. Keys/stabs: FM index ~3 for EP tine, short filter-env
swell for Wurli. The pad sin our bank commits: zero pads with LFO movement survived — a static
pad reads instantly as amateur **(medium)**.

**Leads.** Supersaw: 7 asymmetrically detuned saws (JP-8000 lineage), our `unisonVoices 7,
unisonWidth ~1` + `osc2` a few cents off; crucially **high-pass the result** (~150–400 Hz) so
its size doesn't eat the mix — reachable via `eq7HpOn/eq7HpFreq`, which no factory or curated
patch sets. Pluck lead: fast filter-env snap onto low sustain, delay-forward (`sendDelay 0.3+`)
so the arp builds its own rhythm. Distorted mono lead: single osc + `glide` legato +
`distortionAmount/saturator` + delay — movement from playing, not unison.

**What makes a patch sit in a mix vs impress soloed (medium):** controlled lows (HP everything
non-bass), moderated 2–5 kHz collisions, restrained sends, mono-compatible width, subtle not deep
LFO. But note what our eval actually rates: a **soloed** clip against a produced loop that is
itself a mini-mix with its own space and layers. So the deliverable is not "a patch that would
sit in a mix" — it is a produced mini-mix: layered voices + width + air + glue. That is §4's
assembly step and §6's verdict in miniature.

**The movement hierarchy** professionals compose (each mechanism a different time-scale):
unison/detune = micro-chorus (ms), filter envelope = per-note gesture (10–500 ms), LFO = periodic
(0.1–8 Hz), effects/automation = phrase-scale. Every kept E2 roll has none of the four. And the
per-note gesture — the filter envelope — is exactly the dimension T6 proved the match harness
recovers near-perfectly (envelope residual 0.06–0.20), which is why matching is a credible patch
factory for the layer level even though full-spectrum matching is not solved.

## 4. The centerpiece: matching patches to the loops the owner already ranked highly

### 4.1 The asset, verified

`taste-dataset/refs-packs/` holds **165 licensed pack loops** (140 pitched: 32 bassline / 49
chords / 59 lead; 25 drum-loop; the remaining dir entries are `.analysis.json` sidecars) **(high —
counted this pass)**. Better: the blind record already tells us which ones the owner loves.
Joining the scores log with local batch manifests (paths never leave the machine): **59 distinct
pack loops have been blind-rated in showdowns; 41 won their batch outright**, e.g.
`chords/BR_W_Synth_Loop_Bird_127` (4 wins/5 appearances),
`lead/SS_ZMT_121_synth_discover_drop_lead_Fmin` (2/2),
`bassline/GUY_GERBER_bass_loop_se_tribal_120_Emin` (2/2) **(high — computed this pass)**. That is
a ready-made, owner-endorsed target list — the reference material E3 was waiting for.

### 4.2 What T6 actually bounds — and why the measured ceiling is probably understated

T6 v2 (800 evals/target): envelope residual 0.06–0.20 everywhere ("solved"); best MFCC vs
commercial chops 31.5 (lead) / 47.4 (chords) / 57.9 (bass) against a 15.3 self-match floor —
"spectrum unreachable," ~90% of residual is timbre **(high — docs/t6-sound-matching.md +
memory)**. Four reasons that number is a lower bound on what matching against *these* targets can
do, all mechanical:

1. **The targets were Demucs stem chops** — the noisy/artifacty class the owner personally
   flagged as degrading the benchmark (the reason refs-packs was purchased). A match cannot beat
   its target's own noise floor.
2. **One-note candidates vs multi-note/polyphonic targets** (the chords caveat is logged in the
   memory record). `src/match/space.ts` builds a single note; a chord loop is unreachable by
   construction, independent of timbre.
3. **Motion and space are excluded from the search** (LFO params out of stage 1 by design; sends
   excluded) — so the search couldn't reproduce exactly the movement §3 says defines these roles.
4. **No layering.** A pack loop is typically 2–4 layered voices plus bus processing; the search
   fits ONE voice. The 2–4× MFCC residual partly *is* the missing layers (the same
   mono/airless/simple deficit the feature-mining measured: engine width −52 dB vs ref −11,
   air-band 0.22% vs 1.89%, Audiobox-PC the cleanest separator).

The match surface itself is not the problem: stage 1 already covers 21 dims including
`osc2Level/Detune, subLevel, noiseLevel, unisonVoices/Width, fm*, filterEnv*` plus osc×filter
enumeration — the full §3 vocabulary except motion. **(high — read this pass)**

### 4.3 The program: match the layer, author the stack

- **M0 — targets (a day).** Pitch-stability scan (the rebuild-ref-chops lesson) over the 41
  winning loops + top non-winners; keep ~8–10 stable 1–2 s cuts per role. For chords targets,
  additionally cut a *single-chord* window (polyphony handled in M1, not wished away).
- **M1 — the real ceiling run (the decision gate).** `beat match` at budget 500→2000 per target
  (cache-resumable), synth kind; for chords, extend the harness with a chord-note candidate (the
  probe triad instead of one note — a small `space.ts` change) before concluding anything about
  pads. Deliverable: per-role table of best MFCC/CLAP vs the 15.3 self-match floor on **clean**
  targets. Read: ≤ ~1.5× floor → matching is a viable per-layer patch factory (proceed M2);
  still ≥ 2× on clean single-voice-ish targets (many pack lead loops are close to solo synth
  lines) → the engine's per-voice timbre ceiling is real — jump to §6's redirect.
- **M2 — assembly into produced patch stacks.** Each winning `patch.txt` becomes the **mid/lead
  layer** of a named, seeded family: authored sub layer under bass (per §3), authored motion
  (role-rule LFO settings — matching can't find them, design rules supply them), optional noise/
  top layer, then the existing production pass (`produce.ts` role profiles / engineplus
  treatment) applied as ordinary edits. Provenance `matched:<loop-basename>` per E0. **This step
  is where the +30-point production term and the layer-complexity term get added to the matched
  timbre — skipping it re-runs the raw-engine arm with better patches and predicts ~single-digit
  results.**
- **M3 — the blind gate (§7).**

**Licensing, stated honestly:** matched patches are parameter vectors, not audio (E3's posture),
but they are *derived by optimizing against Splice audio*, and Splice's ToU prohibits AI-training
use — the same wrinkle that already keeps pack-pool variants out of critic training. CMA-ES
matching is optimization, not model training, but the reading is not obviously safe. Until the
owner rules: matched-to-Splice patches live in `taste-dataset/match-presets/` (private, like the
midi transcriptions), never committed; patches matched to refs-cc0 or the owner's loved-track
stable cuts (3 already in `taste-dataset/match-runs/`) are the commit-clean subset **(medium —
ToU reading is a judgment call, flag to owner)**.

## 5. The generator alternatives, weighed

| generator | verdict | why |
|---|---|---|
| Random-roll + screen (E2 as built) | **Retire the roll space; keep nothing but the pipeline plumbing** | §2 — 8/58 dims, structurally can't express any §3 design |
| **Designed families, seed-jittered** (agent/LLM-authored from §3 rules) | **Yes — the cheap breadth generator (S)** | The factory bank *is* this at n=36 and was never fairly screened (§2.2). Families ("reese-bass(detune, width, cutoff)", "supersaw-lead(voices, hpf)", …) parameterized over full-surface jitter give E2-scale candidate pools where every candidate is a real design. taste-seeds keeps its jitter mechanism unchanged |
| **Match-to-reference** (§4) | **Yes — the precision generator, and the ceiling instrument (M)** | Owner-endorsed targets exist; envelope dimension proven; per-target ~20–50 min; doubles as the measurement that decides the whole program |
| QD / perceptual archive (brightness × attack-time × movement × width niches) | **Later, as coverage not optimization (M)** | The T5 scaling gate FAILED (controls beat elites 89% vs 50) — the critic cannot rank elites, so never use it as the archive's fitness. An archive over *descriptor* axes with best-of-n per niche and owner-rated champions is the Innovation-Engines shape 117 endorses; worthwhile once M1–M3 say the engine is worth searching |
| E4 critic-objective CMA-ES | **Still gated, now more firmly** | Curation via these scores produced no blind lift (§1); searching the same scores harder is the textbook Goodhart move (117) |

Screen changes, regardless of generator **(all follow directly from §2)**: (1) **calibrate the
ring gate against the owned refs per role** — set each role's threshold so ≥95% of that role's
pack loops pass (lead needs ≫ −32; bass can stay), or make it relative ("worse than the worst
passing ref"); (2) **drop the lead probe an octave** (C4–C5) and **screen the produced render,
not the raw voice** — score candidates through the same M2 assembly the eval will rate, killing
the solo-raw distribution mismatch; (3) loudness-normalize probes before aes/critic scoring;
(4) replace the ring-headroom composite term (it double-rewards darkness) with a **role-target
brightness/movement term**: distance of spectral centroid + modulation-spectrum energy to the
role's *pack-loop* distribution — screens should pull candidates toward the reference
distribution, not away from every sharp feature; (5) keep activeFraction as-is.

## 6. Honest verdict: can patch design alone close the gap?

**No — and the blind record says so quantitatively.** Holding composition commercial (midi
figures) doesn't move the raw engine off ~0%. Giving the engine's own figures commercial timbre
(keymap) buys ~30%. Giving them production without better timbre (engineplus) buys ~33%. Only
designed timbre *plus* production (surgeplus) reaches ~58%, and the remaining ~30-point gap to
ref:packs (87%) is exactly the layered-complexity/air/width territory the feature-mining keeps
measuring. Best supported proportions of the engine→pack gap, stated with appropriate humility
**(medium — ordinal confidence high, percentages rough)**: **production ~40%, per-voice timbre
(the patch proper) ~35%, layering/arrangement-of-sound ~25%, composition ~0 at clip scale.**
The program deliverable must therefore be the produced stack (M2), with the patch as its core.
The showdown's own arms are the proof this decomposition is measurable at all — keep them.

**Is the engine's per-voice timbre ceiling below pack quality?** Open, and M1 exists to answer
it on clean targets. If M1 confirms ≥2× the self-match floor: say it plainly and redirect —
(a) the top layer of unreachable stacks comes from keymap/sample one-shots (the hybrid the
showdown already validates at ~30% *without* production — a produced keymap+engine stack is an
unexplored arm), and (b) the engine grows the evidence-ordered additions from 114 §5.1
(parametric EQ is already in; wavetable content breadth, ladder-filter character, transient
shaper) rather than chasing spectra the oscillator set cannot emit. Either way the loops remain
the yardstick: the D27 event (produced engine ranked above a ref, n=1, soft ref) already shows
the produced-engine ceiling touches the target class.

## 7. First experiment — a pre-registered blind showdown arm

**Arms, per pitched role** (6–8 batches/role, the smoke threshold with margin), all through the
existing machinery — this is a patch-source change inside the engineplus slot plus one new tag:

1. `engineplus` drawing **curated-v1** bank (control — the bank this doc indicts);
2. `engineplus` drawing **M2 matched-assembled stacks** (`[patch: matched:<loop>]`), target loop
   **held out** of the batch (never rate a clip against its own timbre parent — twin recognition
   un-blinds);
3. `engineplus` drawing **designed-family** patches (`[patch: designed:<family>]`) — separates
   "matching found it" from "the design rules found it";
4. `gen` and a held-out `ref:packs` loop as the fixed ladder anchors.

**Pre-registered readings.** Primary: pairwise of arm 2 vs arm 1 (matched-assembled must beat the
curated bank; if it can't, patch generation isn't the lever and §6's redirect fires early).
Secondary: arm 2 vs arm 3 (is optimization buying anything over authored design?); arm 2's gap
to gen (≥ half closed = on track). North star, unchanged from D27: **the first batch where an
arm-2 clip outranks the pack ref.** Era tags make every read splittable forever (E0). Screens:
ship §5's gate recalibration *before* generating the M2 pool, or the pool inherits §2's bias.

## Honest gaps

- The ~20%/~53% engine/engineplus figures quoted into this task could not be reproduced from the
  log under any split tried (all-eras 1%/32%, curated-era 3%/33%, since-07-25 0%/34%); possibly a
  single-round or different-semantics read. The ordinal conclusions are window-invariant.
- The ring measurement over pack loops uses full produced loops vs the gate's solo probe renders
  — an imperfect apples-to-apples (that mismatch is itself part of the §2.2 diagnosis); the 22%
  fail rate is if anything an *under*-estimate of the gate's bias against solo bright renders.
- §3's craft claims are curriculum-grade but largely **(medium)**: Syntorial's method and the
  Reese/supersaw lineage were verified by fetch this pass; Synth Secrets scope, Szabo's detune
  analysis, and the genre-manual defaults are from corroborated knowledge, not re-fetched.
  Research/07's warning stands: treat specific numeric recipes as starting points for blind
  testing, never as verified facts.
- The Splice-ToU reading in §4.3 is a judgment call needing the owner's ruling before any
  matched-to-Splice patch is committed to the repo.
- M1's chord-note candidate is a small but real harness change; until it lands, every chords
  ceiling number carries the polyphony caveat.
- research/131 (a parallel session's empirical gap analysis) had not landed at write time; if its
  numbers differ, prefer whichever splits are manifest-joined and era-tagged.

## Sources

- Repo/measured (high): docs/engine-presets.md; presets/engine-curated.json + factory.json;
  scripts/curate-engine-presets.mjs; src/taste/surgeCuration.ts + enginePresets.ts;
  src/match/space.ts; docs/t6-sound-matching.md; docs/source-showdown-eval.md;
  `beat showdown examples/taste-t1 --report`; ring/era/per-loop computations run 2026-07-26
  (commands inline above, all read-only).
- Research docs: 07 (sound-design sources — craft claims failed blog-level verification, this doc
  goes to the curriculum sources it named), 114 §5/§7, 115, 117 (T5/Goodhart record), 120
  (pack-ref purchase), 129.
- Fetched this pass (medium-high): [Syntorial](https://www.syntorial.com/) +
  [Wikipedia](https://en.wikipedia.org/wiki/Syntorial) (train-by-ear method, ~200 lessons /
  ~700 patches / ~64 params); [Perfect Circuit — Super Saw history](https://www.perfectcircuit.com/signal/super-saw-history)
  and [Roland JP-8000](https://en.wikipedia.org/wiki/Roland_JP-8000) (7 asymmetrically detuned
  saws, detune/mix control); [NI — Reese bass](https://blog.native-instruments.com/reese-bass/),
  [Ali Jamieson — Reese's Pieces](https://alijamieson.co.uk/2021/08/14/reeses-pieces-how-to-create-kevin-saundersons-legendary-bass-patch/),
  [FAW — The Reese Bass Explained](https://futureaudioworkshop.com/the-reese-bass-explained/)
  (detuned-saw pair, 0–50 cent beating behavior).
- From knowledge, not re-fetched (medium/low): Gordon Reid, *Synth Secrets*, Sound On Sound
  63-part series; Adam Szabo, "How to Emulate the Super Saw" (2010); Snoman, *Dance Music
  Manual*; Attack Magazine, *Secrets of Dance Music Production*; Mike Senior, *Mixing Secrets*
  (mono-compatibility / low-end layering conventions).
