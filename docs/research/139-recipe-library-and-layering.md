# Research 139 — The recipe library and the layered clip: encoding priors the harness can execute and verify

*Run 2026-07-26, commissioned by the owner's strategic frame (verbatim): "Think of all the
possibilities of different synths, layering different synths on each other, notes, rhythm, midi
fx, audio fx, and more. This extremely wide parameter space is mostly unexplored — but randomly
searching that space and then cutting down the options via metrics is probably not going to work,
because the space is too high-dimensional and our metrics probably aren't that great. I tend to
think we might need to work from learned priors/context by picking up tricks/rules/ideas from
internet sources — the YouTube video that says 'create this synth this way' — that seems like a
path to build a set of 'things that work' and maybe branch from there." Mid-pass owner addition
(verbatim): "one interesting thing might be attempting to take known presets that we already have
in surge / engineplus and then trying to make them hit those parameters" — incorporated as the
retargeting strategy (§4.3). Method: (a) repo reads — 138 (the plan of record), 131 (the measured
discriminators), 133/134/135 (the prior-mining passes), 117 + docs/pilot.md (the failed-search
record), 115 (layering consensus), presets/tricks.json + docs/tricks-reference.md +
presets/engine-curated.json (format precedents); (b) a definitive code read of
`src/taste/showdown.ts` + `cli/beat.mjs` + `src/analysis/produce.ts` for the layering-
expressibility question; (c) two single-agent web passes (recipe corpus; layering craft) — NOT
adversarially verified, per-claim confidence labels, URLs in Sources; (d) on-disk re-verification
of the owned-loop counts. A sibling stream is prototyping preset-retargeting mechanics — this doc
owns the conceptual/format side and does not duplicate that implementation. Confidence: **High** =
measured in the cited repo analyses or verified by code read / primary fetch this pass; **Medium**
= corroborated secondary sources or one measurement with a confound; **Low** = single-source or
design inference. Research only — no code changes; this doc proposes, 138's ladder disposes.*

> **Completion note, 2026-07-26.** The original pass was cut short mid-run: five section bodies
> (§2.2, §2.3, §2.4, §3.1, §3.3) and the trailing sources block shipped as empty
> `<!-- WEBPASS:* -->` placeholders that a planned second web pass never filled. They are filled
> here, the same day, and **not by re-running the web pass** — because by the time anyone came
> back, the content had already shipped through other streams. The mined corpus this doc was
> going to transcribe is `docs/priors/` (10 vein files, ~90 recipes, 165 URL citations — landed
> 08:33–08:52); the executable half is `presets/recipes.json` + `src/recipes/` + `beat recipe
> list|show|build|check` (merged to main as `recipe-library`, 09:26); the layered arm is
> `src/taste/layered.ts` + `beat showdown --with-layered`, and its owner-ear correction is branch
> `layered-fix` (not yet merged at the time of writing). So §2.2 and §2.3 now **point** rather
> than duplicate, and §3.1/§3.3 are rewritten from **measured** evidence — code, renders and one
> banked listening case — rather than from the tutorial prose they were originally scoped to
> summarise. Parts of this doc's plan were overtaken by what actually shipped, and where that
> happened the section says so instead of quietly presenting the plan as current. Downstream:
> **143** (prior-mining system) supersedes §5.3's mining pipeline and §6.3's growth loop; **144**
> (critic instruments) supersedes the standing "gates wait on B0" caveat — B0 shipped. Everything
> outside those brackets stands as written on the morning of 2026-07-26.

## Headline answers

1. **The owner's frame is not intuition — it is the measured record, with one refinement.**
   Search-then-cut has failed twice under blind measurement: the T5 pilot's scaling gate
   (critic-guided elites LOST to random-mutation controls; 134 §5 records the gate as failed,
   controls 89% vs elites 50%) and the E2 curation (random rolls + screens selected static dark
   near-sines while the ring gate rejected 22% of the owner's own Splice leads — the screens
   rejected the quality bar itself, 134 §2). Meanwhile every prior-mining pass produced numbers
   that survived: 133's pack-loop craft, 134's role-design rules, 135's checklists. The
   refinement: "our metrics probably aren't that great" is true of metrics as *rankers* (0.676
   held-out vs the owner's 0.917 self-consistency; aesPQ literally inverts) but false of metrics
   as *verifiers* — the 131 discriminators are few, large (d ≈ 0.6–1.4), and band-shaped, which
   is exactly the shape a verification gate wants and a maximizer can't Goodhart. The working
   division of labour is four-way: **priors place, metrics verify, the owner ranks, search
   refines locally from known-good points.** (High.) §1
2. **Layering is expressible in dotbeat today, by construction — the definitive code answer.**
   A `.beat` doc is multi-track; the render sums every audible track through its own synth+chain,
   the shared reverb/delay buses, and the master limiter. The single-voice showdown clip is
   purely a pipeline choice: every arm's builder calls `soloForShowdown` (mutes all but one
   track at −60 dB, `cli/beat.mjs:2698/2706/3087`) or `isolateTrack`, and `writeShowdownBatch`
   takes finished wavs without caring how many tracks made them. A layered arm needs one new doc
   builder + arm tag (138's B4, S–M work), no format change. Two real glue caveats: there is no
   group bus (BeatGroup is visual-only — 115 §1.2), so cross-track bus compression/saturation
   needs the two-stage re-host (133 §4d); and the scheduled duck triggers from synth-track kick
   hits only. Synth-internal layering (subLevel/osc2/noise in one voice) is the cheap 80% and is
   also almost never used. (High.) §3
3. **The recipe corpus is real, minable, and mostly expressible.** §2 extracts ~20 named recipes
   with concrete parameters from curriculum-tier sources (Synth Secrets, Syntorial's method,
   Attack Magazine's tutorial/Beat Dissected corpus, the Reese/supersaw lineage write-ups,
   pack-production guides, designer interviews). The sources agree on **structure** (layer
   architecture, chain order, register discipline, articulation) and disagree on **numbers** —
   and research 07/133 already measured that public numbers lose to our own ref measurements. So
   a recipe's numeric values enter as starting hypotheses; its verification gates come from the
   owned refs. Expressibility audit: the large majority of named parameters map to real
   `SYNTH_FIELDS`/effect fields; the recurring gaps are OTT/multiband, transient shaper,
   wavetable/growl timbre, reverb pre-delay, and band-split chorus — each with a named nearest
   substitute (§2.3). (High on the audit; Medium on individual dosages.) §2
4. **The recipe format (§4): `presets/recipes.json` + a generated `docs/recipes-reference.md`,
   one altitude above tricks.** Schema: identity+tags, source citations with per-claim
   confidence, a figure spec (archetype, register, feel), a **layers[] array** (per-layer patch
   in real field names — literal, or a patch *source* like `factory:`/`curated:`/`surge:`/
   `matched:`/`retarget:` — plus per-layer produce block and per-layer gates), a clip-level
   chain in the tricks step vocabulary, **clip-level verification gates in features the repo
   already computes** (the current 13 FEATURE_KEYS now; 131 §4's B0 keys as they land), and a
   provenance block with status `sourced → verified → validated` and an append-only blind
   record. Frozen-science discipline: a recipe's measured targets are regenerated-with-
   provenance, never hand-edited; new numbers mint a new version. Four complete examples in
   §4.4. (Design proposal — Medium.) §4
5. **Preset retargeting — the owner's mid-pass addition — is the cheapest recipe generator and
   the purest instance of the division of labour.** A factory/curated/Surge preset is a
   human-designed known-good point; the 131 discriminators are 5–8 scalars; so the move is LOCAL
   optimization from that point until the scalars sit in the role band — not global search.
   This is decisively not T6: T6 chased full spectra (unreachable at 2–4× the self-match floor);
   hitting a handful of scalar features is a low-dimensional objective, and most of the scalars
   are quasi-monotone in one or two knobs (`subLevel`→bandSubPct, env `attack`→attackMedMs,
   width stack→widthMeanDb, comp/envelopes→crest), so much of the "search" is closed-form — the
   trick catalog's `expect` fields are literally the Jacobian sign structure. In the schema,
   retargeting is a patch source (`{"from": "surge:…", "retarget": {…targets}}`), and it
   composes with layering: retarget each layer against its own band-role target, which
   decomposes the objective into easier pieces. (High on the framing; the sibling stream
   measures whether the local searches converge.) §4.3
6. **The owned Splice loops are existence proofs, minable into recipe templates — 165 wavs on
   disk this pass (32 bassline / 49 chords / 25 drum-loop / 59 lead; the commission's 197 was
   not reproduced on disk), 59 blind-rated, 41 batch winners.** Extractable by measurement: the
   full feature-vector target profile (sidecars already exist), register via pitch tracking,
   onset/velocity-tier/swing structure from onset analysis. Partially extractable: layer
   evidence (per-band envelope decorrelation, band-split stereo, harmonic/percussive split) and
   the sidechain-pump fingerprint. Not extractable: the actual patch (T6's measured verdict),
   polyphonic MIDI, chain order. Mined winner-cluster bands become recipe gates; 134's
   match-to-loops program remains the per-layer *timbre* factory — complementary, wired together
   through the `matched:` patch source, no duplication. (High on what's extractable; Medium on
   the layer-evidence heuristics.) §5
7. **Build proposal (§6): ten first recipes, one layered arm, one growth loop.** The first ten
   recipes ride 138's rungs (rolling-sub-bass and reese-bass ride rung 1's register arm;
   stab-chords and supersaw-lead ride rung 2's punch arm). The first layered showdown arm —
   `stack` — is 138's rung 5 made concrete with ONE variable: the current best single-voice
   clip PLUS recipe-defined sub/top layers, everything else held constant; pre-registered
   success = stack beats its own single-voice sibling in ≥65% of implied head-to-head pairs
   over ≥8 batches AND its feature vector enters the ref band on ≥2 axes the sibling missed.
   Growth: agents append `sourced` recipes; a deterministic self-gate receipt promotes to
   `verified`; ≥N blind batches against a pre-registered control promote to `validated`;
   failures are parked with the record intact, never silently re-tuned. §6

---

## 1. Why priors-first — the assembled evidence and the division of labour

### 1.1 The two failed searches

- **T5 (the constrained pilot).** Built exactly to 117's containment spec — QD archive,
  pessimistic ensemble scoring, width fence, random-mutation controls in every frontier — and
  the scaling gate still failed: the owner's blind ratings preferred the random-mutation
  controls to the critic-guided elites (134 §5 records controls 89% vs elites 50%). This is the
  cleanest possible measurement that the critic cannot steer search in this space at current
  data scale, because everything else about the loop was built to give it the best chance.
  (High.)
- **E2 (random-roll + screen curation).** The generator rolled 8 of ~58 fields — a space that
  structurally cannot contain a reese, supersaw, pluck, or any movement — and the screens then
  selected the only thing that space makes well: dark static near-sines (all 17 kept leads are
  rolls with cutoff 549–2034 Hz). The ring gate fails 22% of the owner's own Splice leads; every
  cleanliness metric inverts against preference across 1,612 pairs (aesPQ 0.415). Curation
  produced no blind lift (engine 1→3%). The screens did their stated job; the job was wrong.
  (High — 134 §2, 131 §2.1.)

The generalized reading, which the owner's frame states correctly: in a space this
high-dimensional, undirected sampling concentrates probability mass on structureless regions
(static tones, incoherent stacks), and metric-based cutting then selects for what the metrics
can see rather than what the owner hears. Both failures follow from geometry + instrument
limits, not from implementation bugs — the fix is to move the *generator* onto human-designed
structure, not to sharpen the knife.

### 1.2 The three successful prior-mining passes

Each pass that mined structured knowledge produced numbers that survived contact with
measurement: 133 mined pack-production craft and converged with 131's independent empirical
analysis on register, occupancy, and the width doctrine; 134 mined role-design rules (reese,
supersaw, pluck, pad-movement) whose absence exactly explains the E2 bank's failure; 135 turned
both into per-role checklists whose exit gates are measured ref rows. And the strongest prior of
all is already in-house: the production pass itself — a six-line profile encoding standard craft
— was worth +30 pairwise points (engine 1→32%), the largest single lever ever measured here
(135 §A.1). Priors, when they carry structure, move blind ratings; searched noise has never
moved them. (High.)

### 1.3 The division of labour, stated precisely — and where this doc pushes back

| job | instrument | why it holds the job (evidence) |
|---|---|---|
| **Place** — decide where in the space to be | recipes (mined priors: tutorials, craft literature, the owned refs, existing presets) | §1.1–1.2; 134 §5's generator verdict (designed families + match, never rolls) |
| **Verify** — did the render land where the recipe says? | the measured feature gates (131 discriminators as p25–p75 bands) | gates are band-membership checks, not maximization targets — the anti-Goodhart shape (117's DRAGON note: a distribution target can't be maxed by a degenerate point) |
| **Rank** — which verified clip is good? | the owner's blind ear, through the unchanged showdown | 0.917 self-consistency vs 0.795 critic ceiling; harmony/pocket/phrase unmeasured (131 §8, D27) |
| **Refine** — improve a known-good point | short-leash local search (retargeting §4.3; seed-jittered designed families 134 §5) | every tiny-data search success kept a one-step leash (117 §1.4); local moves from human-designed starts are the regime where weak critics still help |

Where this doc agrees completely: the ranking job never goes to metrics (T5 is the proof), and
the placing job never goes to random sampling (E2 is the proof).

Three pushbacks, so the frame doesn't over-rotate:

1. **Metrics are not weak — they are miscast.** Used as gates ("is bandSubPct in [30,60]?
   attackMedMs ≤ 12?"), the 131 features are strong instruments: the discriminators are large,
   stable, and role-specific, and a gate consumes them without optimization pressure. The rule:
   **metrics may reject and verify; they may pre-filter at low pressure (best-of-n); they may
   never rank the survivors.** This is 138's design rule ("never spend owner ratings on a clip
   that missed its own targets") promoted to the recipe library's core contract.
2. **Internet priors are themselves noisy — the calibration must come from the owned refs.**
   Research 07 found blog-grade sound-design claims fail verification; 133 found no public
   source publishes per-role crest/LUFS numbers and concluded its own measured table "is better
   calibration data than anything public"; 135's web dosages are explicitly starting points.
   So the library's split is: **structure from the tutorial corpus, numbers from the measured
   refs.** A recipe cites both, and where they disagree the measurement wins (135's lead
   air-vs-presence precedent).
3. **Search is not dead — it shrinks and moves.** "Branch from there" in the owner's frame is
   exactly right, and it has a measured shape: local refinement around known-good points
   (retargeting, jittered families), with blind rating as the selection event, and QD-style
   archives later as *coverage* bookkeeping rather than optimization (134 §5's verdict). The
   leash length is the load-bearing parameter (117 Part 2), and recipes are what make short
   leashes productive: each recipe is a known-good basin worth a few local steps, instead of an
   open space worth none.

## 2. The recipe corpus (Part 1)

### 2.1 What a recipe is here

A **recipe** is a named, executable, verifiable procedure for one produced clip role: layer
structure + per-layer patch values + effect chain with dosages + figure/articulation
requirements + measured exit gates. It is one altitude above a **trick** (a single
preconditioned move), two above a **preset** (a parameter bag with no procedure or gate), and it
*consumes* both: tricks are its step vocabulary, presets are its patch sources. The existing
repo already contains proto-recipes — 133 §5's per-role minimum-viable chains, 135 §B's
checklists, the theory.ts archetypes — but scattered across prose docs an agent only follows
when a prompt names them (121's law). The library makes them data.

### 2.2 The mined recipes, per role — where the library actually lives

**This section was scoped to BE the recipe corpus: ~20 named recipes transcribed inline with
their parameters and citations. It never got written, and it should not be written now, because
the library shipped as data on 2026-07-26 instead — in two halves, in two places.** Pasting
ninety recipes into a research doc would fork them from the copies an agent can actually execute,
which is precisely the failure 121's law and 143 §1 both name. So this section states what the
library is, where each half lives, and how they connect; the recipes themselves are one `beat
recipe list` away.

**The prose half — `docs/priors/`.** Ten mined vein files (3,355 lines, `README.md` indexing
them; see `docs/priors/README.md` for the vein table). Written by a nine-agent mining fleet the
same morning, one narrow vein each, against the owner's frame quoted at the head of this doc.
Each file marks cross-source **CONSENSUS** separately from **CONTRADICTIONS** (style dials, not
physics — the README's own example: "classic" Reese detune spans ±7 to ±61 cents across sources),
carries source URLs per claim, and states outright where a technique needs a parameter dotbeat
cannot express. Research 143 measured the corpus: **~90 recipes, 402 lines carrying a number with
a unit, 165 URL citations across 44 domains** (143 headline 1). Roughly: `bass-house.md` 10,
`bass-techno.md` 18, `bass-basseries.md` 15, `chords-pads.md` 13, `leads.md` 12, `drums.md` 12,
plus four structural veins that are not recipe-counted (`layering.md`, `transients.md`,
`pack-production.md`, `sample-manipulation.md`).

**The executable half — `presets/recipes.json` + `src/recipes/`.** Thirteen recipes encoded to
§4.2's schema (`src/recipes/schema.ts`), built by `src/recipes/build.ts`, gate-checked by
`src/recipes/verify.ts`, rendered as `docs/recipes-reference.md` by
`scripts/gen-recipes-reference.mjs`, and driven by `beat recipe list|show|build|check`
(`cli/beat.mjs:336–343`). 13 recipes, 4 roles, **25 layers total, 10 of the 13 genuinely
multi-layer** (`docs/recipes-reference.md:15`):

| recipe | role | layers | tags | clip gates |
|---|---|---|---|---|
| `rolling-sub-bass` | bassline | 2 | techno / tech-house / warehouse / dark / rolling | 8 |
| `reese-bass` | bassline | 2 | dnb / jungle / neurofunk / dark | 7 |
| `acid-303` | bassline | 1 | acid / techno / house / 303 | 6 |
| `808-glide-bass` | bassline | 2 | trap / hip-hop / footwork / 808 | 6 |
| `three-layer-bass-stack` | bassline | 3 | layered / techno / dnb / architecture | 8 |
| `warm-pad-with-air` | chords | 2 | house / deep-house / ambient / warm | 8 |
| `house-chord-stab` | chords | 2 | house / deep-house / stab / octave-split | 6 |
| `techno-stab` | chords | 1 | techno / stab / dark / percussive | 5 |
| `supersaw-trance-lead` | lead | 2 | trance / uplifting / euphoric / supersaw | 8 |
| `pluck-delay-lead` | lead | 2 | house / melodic / pluck / delay | 7 |
| `hoover-lead` | lead | 2 | rave / hardcore / hard-dance / hoover | 6 |
| `layered-lead-stack` | lead | 3 | layered / trance / melodic / architecture | 8 |
| `layered-house-kit` | drum-loop | 1 | house / tech-house / swing / kit | 8 |

(Counts read from `presets/recipes.json` this pass. All 13 ship at status `sourced` — none has
been through a blind batch, so none is `verified` or `validated` in §6.3's sense. The first-ten
list in §6.1 survives almost intact: `dark-techno-stab` became `techno-stab` and lost its
mined-cluster provenance, `hoover-lead` and the two explicit `*-stack` architecture recipes were
added, and the mined-first "no corpus match" path §5.3 step 3 designed was therefore **not**
exercised. That is a real gap, not a rename.)

**How the halves connect — prose vein → encoded recipe → gate.** The pipeline is the §1.3 split
made literal, and `docs/recipes-reference.md:18–25` states it as the reading instruction:
*structure* comes from the prose corpus (`docs/priors/*.md`, consensus marked separately from
contradictions), *numbers* come from measurement (141's 3,559 Surge patch files; where a tutorial
and the patch corpus disagree, the patch corpus wins), and *gates* are `[lo, hi]` bands over
features the repo computes — never scalar maxima, because a band cannot be maximized. A
disagreement the corpus genuinely has is preserved rather than averaged: `RecipeDial`
(`src/recipes/schema.ts:82`) encodes the value the recipe actually uses, the full span the corpus
supports, and the dotbeat field a sweep would move. And a failing gate is a **finding** — "either
the recipe is wrong for our engine or the engine cannot express what the corpus describes — never
a reason to widen the band" (`docs/recipes-reference.md:25`).

**The first full verification run** (every recipe built, rendered through dotbeat's engine, and
checked against its own gates — clip render plus one solo render per layer):
**77 gates passed, 33 failed, 24 pending** on B0 (`docs/recipes-reference.md:58`). Not one band
was widened. Four of the failures are schema findings rather than recipe bugs, and they are the
most valuable output of the whole exercise:

1. **Per-layer band-share gates are the wrong SHAPE.** Every layer gate written as a two-sided
   share band failed high on its solo render (mid 92.7% against a 25–75 band, body 96.4% against
   12–75, reese 82.6%, growl/air 91–95%), while every gate written as a one-sided **leakage**
   bound (`bandSubPct: [0, 25]` on a mid layer) passed. On a solo render a correctly-designed
   layer is ~100% inside its own band — that is the goal — so per-layer gates belong in leakage
   form; clip-level share gates stay two-sided, because there the number means "how much of the
   whole does this own."
2. **Mono low end and unison detune are mutually exclusive in this engine.** `reese-bass`
   measures −20.97 dB width against its own ≤ −30 gate: unison voices widen the *whole* spectrum,
   and the corpus's rule is a band split (mono below 100–150 Hz, stereo only above ~400 Hz).
   dotbeat has no band-split stereo and no M/S crossover, so the detuned-beating Reese and the
   dead-mono low end cannot both be had in one voice. The layered form is the only workaround and
   even it cannot place the crossover.
3. **Role-level gate bands do not transfer to a recipe whose procedure leaves the role's band.**
   `acid-303` fails sub share 0.03% against 5–55 because the recipe itself high-passes at 150 Hz
   on its source's instruction, while the gate was transcribed from 131's generic bassline row.
   Per-recipe gate mining (§5.3's cluster step) is the missing instrument — not a looser band.
4. **A quiet noise layer does not close the texture axis.** `warm-pad-with-air`'s air layer
   contributes 0.04% air-band energy under the pad and `pluck-delay-lead`'s shimmer solos at
   0.68% presence, while `layered-lead-stack`'s louder air layer solos at 95% presence and lands
   its clip air gate. Texture is a level-and-masking problem before it is a source problem, which
   sharpens 138 §5's prediction rather than confirming it. `supersaw-trance-lead` is the only
   recipe clean on every computable gate (10 pass / 0 fail); `three-layer-bass-stack` is next at
   11/1 — both layered.

(High — every count above read off `presets/recipes.json`, `docs/recipes-reference.md` or
`docs/priors/README.md` this pass.)

### 2.3 The expressibility audit

**Answered, and answered better than a prose audit could have been: by building the recipes and
watching which parameters had nowhere to go.** §2.2's headline in this doc's opening claimed "the
large majority of named parameters map to real `SYNTH_FIELDS`/effect fields; the recurring gaps
are OTT/multiband, transient shaper, wavetable/growl timbre, reverb pre-delay, and band-split
chorus." That claim survived encoding, and the gap list is now a table with a named recipe per
row: `docs/recipes-reference.md` §"The expressibility gaps — what the corpus asks for that
dotbeat cannot do" (line 79 onward), regenerated from `presets/recipes.json` so it cannot drift.
Read it there rather than here. The load-bearing rows, because they change what the library can
promise:

- **No pitch envelope — two identity-level losses.** Every 808 source specifies a downward pitch
  dive at note-on (Unison: 24 semitones over 40–60 ms, exponential); dotbeat has none, and
  `lfoDest: 'pitch'` is a cyclic LFO, not a one-shot decay. `808-glide-bass` therefore ships the
  sine, the glide and the long decay **without the dive** — "an audible, identity-level difference
  from every 808 in the corpus, and the single strongest engine-gap finding in this library."
  `hoover-lead` loses its signature the same way (both sources route a pitch envelope for the
  upward "yawn"; what ships is a PWM swirl, "recognisably hoover-adjacent, and missing the move
  that names the sound"). `src/taste/layered.ts` records the identical gap independently for its
  bass click layer.
- **Reverb is a shared return bus with one send scalar.** No pre-delay (named in three pad
  recipes — this doc's own §2.3 prediction, confirmed); no band-limited send (HPF 500 / LPF 8k on
  the send input, independently repeated in three lead sources); and no reverb-before-drive
  ordering, which `techno-stab`'s source asks for deliberately.
- **One filter per voice, no slope control.** `acid-303`'s sources disagree about the 303's slope
  (Roland 18 dB/oct, MusicRadar 24, the Sylenth recipe deliberately 12) — moot rather than
  resolved, since `filterType` selects a mode and not a slope. `pluck-delay-lead`'s bandpass and
  its pluck envelope must share the one filter, so they cannot be independent as they are in the
  source.
- **The drums track is one voice bus over five lanes.** The corpus's actual kit construction is
  2–5 stacked *samples* per hit with complementary EQ carving (Attack's tech-house kick is three
  tuned layers; its snare stack five). `layered-house-kit` can express per-lane voice tuning, not
  per-hit sample stacking — the biggest structural gap in that recipe.
- **Not a format gap but a builder one:** the schema deliberately does not implement `automate`
  (renders only in song mode), `macro`, `addHits`, `humanize`, `scaleVelocity` or `rehost` in v1
  (`src/recipes/schema.ts:149–153`), and `build.ts` **refuses** to execute a `retarget` patch
  source rather than silently rendering the un-retargeted preset (`schema.ts:94–98`). Both are
  recorded as gaps where a recipe wants them, which is the right behaviour and also the reason
  §4.3's retargeting contract is still a contract and not a capability.

**The one open question this section owes and does not answer.** The audit above is per-recipe,
generated from the 13 encoded recipes. The other ~77 mined recipes in `docs/priors/` have never
been run through it, so "which mined techniques are inexpressible" is answered for 13/90 of the
corpus and estimated for the rest. Its named home is 143's claims store: an expressibility verdict
per *claim* is exactly the field a machine-readable corpus can carry and prose cannot. Until then,
treat the gap table as a floor on the gap list, not a census. (High on the 13 audited rows —
each is a measured render or a read of the field vocabulary; Low on any claim about the
unaudited remainder.)

### 2.4 What the tutorial culture assumes, and how designers actually work

**Scoped as a prose essay about tutorial culture; answered instead by measuring both populations.
The answer is sharper than the essay would have been, and it inverts the question.** Research 141
read **3,559 installed Surge patch files** and asked the tutorials' questions of the artifacts;
research 143 measured the tutorial corpus itself. Between them the "assumes vs actually does"
gap has numbers, so this section reports them and points at the two docs rather than
paraphrasing a culture.

**Where the tutorials are wrong in a direction, not merely imprecise.** 141's finding on attack
is the cleanest: the median amp-EG attack of 448 lead patches is **3.91 ms — Surge's minimum**,
and **65.0% of lead patches sit exactly on that floor**. So 131's 6.1 ms commercial-loop benchmark
is not a number designers aim at; it is what you measure from audio when the author asked for zero
and the oscillator, filter and converter added the rest. The defensible instruction is *"ask for
0, accept ≤ 12 ms,"* not *"set 6 ms"* (141 headline 1). Same shape for the supersaw: across 1,450
unison-on patches the professional centre is **3–7 voices at ±10–20 cents**, and the tutorial
corpus's "±61 cents is classic" is the **97th percentile** — the tutorial range is real but wildly
uncentred (141 headline 4). This is §1.3 pushback 2 promoted from a discipline to a measurement:
structure from the corpus, numbers from the artifacts.

**Where the tutorials are right about structure — the thing they are for.** 141 headline 5: two or
more audible oscillators in **54.9% of leads, 56.7% of basses, 56.6% of pads, 85.7% of chords**,
and *most* multi-oscillator patches are **octave splits** (lead 37.9%, chords 78.6%) rather than
chorus-detune pairs. Waveshaper on 53.8% of leads / 62.8% of basses; a second filter on 61.2% /
56.1%. "A professional patch is a **stack**, not a voice" — which is the layering literature's
central claim, corroborated from artifacts by a completely independent method. The culture's
structural teaching survives measurement; its dosages do not.

**What the tutorial corpus assumes about the reader, which shows up as a systematic bias.** 143
measured the mined fleet's own output: 2,735 lines yielded **402 lines carrying a number with a
unit** — i.e. roughly one line in seven is quantitative, and the rest is procedure and rationale.
The veins themselves report where the culture simply has no answer: `docs/priors/layering.md`'s
summary names chords/pads as "this vein's weakest-covered role" with "no canonical numeric
recipe," and `src/taste/layered.ts`'s chords architecture repeats the finding independently, which
is why its numbers are labelled the arm's hypothesis rather than a citation.

**And what our own generator assumed, which was worse than any tutorial.** The most damaging prior
in the log turned out to be in-house, not mined: `scripts/curate-engine-presets.mjs:rollParams`
emits **8 of the format's 9 core synth params and none of its 136 optional fields**, and samples
attack log-uniform over [2 ms, 800 ms] — a prior whose median is 40 ms against a corpus median of
3.91 ms (141 headline 6). E2's failure (§1.1) was not the screens selecting badly from a fair
space; it was a generator whose assumptions were an order of magnitude off the professional
distribution in a measurable direction. (High — all figures from 141's headline answers, which
are measurements over the installed patch corpus.)

## 3. Layering as a first-class citizen (Part 2)

### 3.1 The standard layer architectures

**Scoped as a summary of what the tutorial corpus says the standard architectures are. That
corpus now lives in `docs/priors/layering.md` (§1 bass, §2 drums/kick, §3 leads, §4 chords/pads,
§5 the cross-role crossover cheat-sheet), so this section answers the better version of the
question instead: what architectures does dotbeat actually build, and what does the code say when
it disagrees with a source?** All of it reads `src/taste/layered.ts` — the module the mined
architectures were compiled into — plus `test/layered.test.ts`. The seeded-sweep form described
below is branch `layered-fix`, which was **not yet merged to main at the time of writing**; main
still carries the earlier three-frozen-architectures form. Both are described, because the
difference between them is §3.3's second measured problem.

**Three roles, and one deliberate exclusion.** `LayeredRole` is `bassline | chords | lead`.
`drum-loop` is out of scope on purpose: a kit is already a multi-voice instrument (kick/snare/hat
lanes), so "layer it" is 131 P6's density question, not this one.

**What a layer is, structurally.** Every layer plays the **same figure** — "a stack playing
different notes is an arrangement, not an instrument" — so `LayerFigure` permits only register
(`transpose`), voice selection (`pick: all | lowest | highest | dropRoot`), note length
(`maxDurationSteps`, `monophonic`) and velocity. **`layerNotes` never moves a `start`**, so onset
alignment — the most-repeated rule in the mined transient corpus — holds by construction rather
than by discipline. The second precondition, oscillator phase at trigger time, was verified
read-only against the engine: Tone's `Synth._triggerEnvelopeAttack` calls `oscillator.start(time)`
on every note attack, so dotbeat already hard-syncs phase per note-on, on every layer. Recorded in
the module header because the opposite would have invalidated every level measurement the module
makes.

**The crossover is the architecture.** Each voice gets exactly one filter, so a layer claims its
territory with one slope: the bottom layer is lowpassed and owns everything beneath its cutoff;
every layer above it is highpassed and adds nothing below its own. `checkCrossover` enforces three
invariants — exactly one lowpassed bottom layer; no highpass below **half** the bottom's lowpass
(nothing pours into the bottom's band); and the bottom lowpass and the lowest highpass meet
**within one octave** (closer leaves a hole, further leaves an octave of two layers summing, which
is the mud a single voice cannot avoid). The bottom layer must additionally be mono, and
`MONO_DISCIPLINE` asserts nine fields (`pan`, `unisonVoices`, `unisonWidth`, `chorusMode`,
`chorusMix`, `utilityWidth`, `autoPanMix`, `sendReverb`, `sendDelay`) on the **assembled doc,
after production** — not merely intended in the spec, because 138 row 5 measured the frozen
role-blind profile widening bass to −11.8 dB against a −45 dB target.

**Two arms, one variable each.** `layered` is the architecture alone — register, crossover, dB
balance, layer-intrinsic voice design, mono discipline — with *no* insert-chain production, so its
single variable against engineplus is layering. `layeredplus` adds a per-layer production pass
(role-true width, parallel/NY compression through the `compMix` dry/wet fan that ships at 0 and no
dotbeat profile had ever touched, glue, space, air), and its comparison partner is engineplus. The
frozen `engineplusProfile`/`surgeplusProfile` constants are untouched (CLAUDE.md's frozen-science
rule); the layered production lives on each layer spec. CLI arm: `beat showdown --with-layered`
(`cli/beat.mjs:2533`, `:2713`, `:2928`).

**The layer families the code implements.** In the branch form, an architecture is no longer a
constant but a seeded **draw** — `layeredArchitecture(role, seed)` builds `mulberry32(seed +
ARCH_SEED_SALT)` and hands it to the role's builder, then runs `checkCrossover` and throws loudly
if the drawn stack broke the ladder (a sweep-bounds bug must never render into a rated round
unlabelled). Deterministic in the seed; seed 0 is the canonical draw used for docs and the CLI's
summary line. The salt exists so an architecture draw is decorrelated from the *figure* draw made
on the same seed — otherwise a batch would couple "which notes" to "which stack" and halve the
effective variety.

**Six families per role, each a weighted layer SET**, so layer counts of 2, 3 and 4 are all
first-class draws (the corpus's own strongest rule is "remove a layer before adding one," which
makes a 2-layer stack a legitimate outcome rather than a degraded one):

| role | families (weight) | layer counts |
|---|---|---|
| bassline | `sub+growl` (3), `sub+body` (2), `sub+growl+click` (4), `sub+body+growl` (4), `sub+body+click` (2), `sub+body+growl+click` (3) | 2, 3, 4 |
| chords | `body+pad` (2), `body+stab` (2), `body+pad+stab` (4), `body+stab+air` (3), `body+pad+air` (3), `body+pad+stab+air` (3) | 2, 3, 4 |
| lead | `body+main` (2), `body+main+octave` (4), `body+main+width` (3), `body+main+air` (2), `body+main+octave+width` (4), `body+main+octave+air` (2) | 2, 3, 4 |

The named jobs, with the mined bands they own: **bassline** — sub (sine or triangle, root notes
only, monophonic, dead mono, lowpassed inside the mined **75–100 Hz** crossover band triangulated
from three independent figures: 75, 79, 90–100), body (100–500 Hz "power/warmth"), growl
(500–2000 Hz character), click (1–5 kHz definition, "the part that reads on earbuds").
**chords** — body (root octave-down, lowpassed, mono, carrying the root so the stab can play a
**rootless** `dropRoot` voicing, which two independent practitioner sources name as the
load-bearing move for the deep-house chord identity and which is the structural fix for the
measured 99.35%-mids failure), pad (sustained, wide), stab (clamped duration, fast attack — packs'
chords fire 4.9 onsets/s attacking in ~7 ms against engineplus's 2.3/s in ~31 ms), air (noise-heavy
top). **lead** — body (roots two octaves down; 138 row 3 puts pack lead at 5–12% bass-band body
against engineplus's 99.19% mids, and no amount of octave-up layering produces low end), main
(unison saw stack, ~3 ms attack), octave (**the most precisely quantified secondary layer in the
whole corpus** — MusicTech corroborated twice: 3–5 voice unison, highpass ~500 Hz, **6–10 dB
below** the main layer, all three swept inside their stated ranges), width (7-voice detuned layer
panned opposite; width as a *layer* is how elite ref leads reach −4.6 dB where a single voice's
stereo trick tops out around −11).

**The axes the sweep varies**, each because the sources genuinely vary rather than because
variation is nice: layer count and set; the crossover (a band in the sources, not a number);
**balance** — "the one axis the sources openly disagree on... a sweep is the honest encoding of a
real disagreement"; register (sub proper is 20–60 Hz in one source, 30–100 in another — an octave
of legitimate placement); envelope (`presets/role-parameter-stats.json`, bass role, n=494:
sustain p10 0.00 / p25 0.33 / median 1.00; decay p10 186 ms / p25 250 / median 621); and character
(unison detune p25 4.6 / median 10.0 / p75 20.0 cents).

**The diversity result, and exactly what is and is not verified.** Before the fix there was
**one distinct architecture per role for the entire program** — "every layered clip ever rendered
was the same three voices at the same three cutoffs at the same three levels"
(`test/layered.test.ts:555–557`). The regression guard `a simulated round does not repeat layered
architectures` (`test/layered.test.ts:553`) draws 72 architectures per role (3 base seeds × 6
batches × 4 offsets) and asserts, over every sliding 15-draw window: **fewer than 3.0
identical-architecture repeats per 15 draws, where the pre-fix value was 14.0** (`:588`); fewer
than 11.0 identical layer-*set* repeats per 15 (`:594`); all three layer counts 2, 3 and 4 present
and **at least 4 distinct families** per role (`:597–598`). A companion claim reached this stream
as "40/40 distinct architectures across 40 seeds" — **unverified**; no 40-seed measurement exists
in the code, the tests or the branch's commit messages, and the gate numbers above are what is
actually asserted. What *was* measured end-to-end is the variety render
(`scripts/layered-variety.mjs`, commit `406ca4bf`): six bass families rendering **one identical
figure** (seed 41, "rolling-8ths", 126 BPM) spread **49 points of sub share, 200 Hz of centroid,
30 dB of width and 11 dB of character balance** — "before the sweep every one of these would have
been the identical file." (High on everything cited to a file and line; the 40/40 figure is
unverified and should not be repeated.)

### 3.2 What each layer contributes, measurably

The layering literature's perceptual claims map almost one-to-one onto 131's measured
discriminators — which is the strongest argument that layering attacks the *residual* gap, not a
random one:

| layer | craft claim | the 131 discriminator it moves | measured gap it closes |
|---|---|---|---|
| sub layer (sine/tri, mono, LP'd) | "foundation," club translation | bandSubPct, centroid, crest_subDb (steady sustain), widthMeanDb (mono) | ref bass 60.1% sub vs engineplus 0.22%; sub crest 7.2 vs 24.3 dB (131 §3.1) |
| body/octave layer (chords/lead) | "warmth," "fullness" | bandBassPct on melodic roles | ref chords 18–28% bass-band body vs ~0 (133 §1) |
| attack/pluck/click layer | "punch," "cut" | truePeakDb, attackMedMs, crestDb | the #1 head-to-head discriminator (+1.38 d, +5.5 dB peaks; 131 §3.1) |
| detune/width layer | "size" | widthMeanDb placed per role | the role-true width map (bass mono, lead −4.6; 131 §5) |
| noise/texture/air layer | "sheen," "analog dirt" | flatnessHiDb (2–8 kHz), aesPC | winners noisier in presence (+0.66 d); PC the strongest single discriminator (0.757) |
| movement across layers (LFO/env per layer) | "alive" | fluxMean/P95, attackCv | refs move ~2× (d +1.06); attack *variety* 0.631 |
| bus glue on the sum | "one instrument" | crest into the role band while rms rises; envelope steadiness | refs steadier per band 2–4× (131 §6) |

This is also why 134's decomposition assigns layering ~25% of the engine→pack gap and why 138 §5
concludes single-voice rendering cannot reach consistent parity: **the unreachable axes (layered
density, in-band texture, simultaneous punch+steadiness) are properties of a stack, not of any
patch.** A layered clip is the only clip shape whose feature vector can sit inside the ref
distribution (132 §5). (High — all cited numbers measured.)

### 3.3 The problems layering creates

<!-- WEBPASS:PROBLEMS -->

### 3.4 Is a layered clip expressible in dotbeat today? Yes — definitively, by construction

The code answer, verified this pass:

- **The format and engine already render layered clips.** A `.beat` doc is a flat list of
  tracks; the engine renders every audible track through its own synth voice + insert chain +
  fixed tail, sums them with the shared reverb/delay return buses, and passes the sum through
  the master limiter (−1 dBTP) (`ui/src/audio/engine.ts` topology, read in 133 §3). Multi-track
  songs render this way every day. Nothing anywhere restricts a render to one voice.
- **The single-voice clip is a pipeline choice, localized to three call sites.** Every showdown
  arm builder reduces the doc to one audible track: `soloForShowdown` (all other tracks to
  −60 dB ≈ silence) at `cli/beat.mjs:2698` (engine), `:2706` (engineplus), `:3087` and the
  pilot/prodtask paths (`:3245`, `:3353`); `isolateTrack` for the kit clip; and the surgeplus
  host carries exactly one sample lane (`buildSurgeSampleHost`). `writeShowdownBatch`
  (`src/taste/showdown.ts:1090`) takes finished wav files and records sources — it is
  layer-count-blind. **A layered arm therefore needs: one doc builder that adds N layer tracks
  sharing the batch figure, one `ShowdownSourceKind` tag, and the CLI wiring — 138's B4, S–M.**
  No format work, no engine work. (High — code read.)
- **Three tiers of layering are expressible today, cheapest first:**
  1. **Synth-internal (one track):** `subLevel` (mono sub layer), `osc2Type/Level/Detune`
     (second layer — a *body* layer at −1200 cents or a *width* layer at +7–15 cents),
     `noiseLevel` (texture layer), `unisonVoices/Width` (width stack), `fm*` (character). The
     3-layer bass is expressible in one voice (115 §1.2) — with the caveat that all layers
     share one filter, one envelope set, and one insert chain, so per-layer envelopes/FX (the
     pluck-over-pad architecture) are NOT expressible in this tier. 134 §3's sharper caveat:
     `subLevel` inherits the voice's filter and effects, so a *clean* sub under a filtered/
     effected mid wants tier 2.
  2. **Cross-track (N synth/drums tracks):** each layer its own track = its own patch,
     envelopes, insert chain, sends, width, automation — the real per-layer architecture.
     Glue available today: shared reverb/delay buses, the master limiter, the scheduled duck
     (kick-hit-triggered, works from a silent ghost track — 133 §4c; synth-target only), and
     *composition-level* glue (same figure, aligned envelopes). Glue NOT available: a group
     bus — `BeatGroup` is a visual fold with no volume/chain/sends (115 §1.2), so cross-track
     layers cannot share a compressor/saturator in one render pass.
  3. **Cross-source + bus glue (the two-stage re-host):** render the layered doc, `beat source
     add` the wav onto a drums-kind host track, apply the bus chain (eq7/comp/utility/
     saturator) there, re-render — the surgeplus pattern generalized (133 §4d). This is also
     how non-engine layers enter a stack today: a surge render or gen one-shot hosted as a
     sample lane beside engine tracks. So even the composite arm's "engine sub + surge mid +
     sampled top" (132 §5) is expressible with zero new machinery — at the cost of a second
     render pass and the duck no-op on sample hosts.
- **What layering costs in the current harness, honestly:** note edits duplicated per layer (no
  shared-note mechanism — acceptable at 2–3 layers, and the builder writes them from one
  figure); the group-bus gap above (two-stage re-host is the workaround; group bus semantics
  are 115 §6 P6's real format design, still the right long-term fix); clip automation renders
  only in song mode (wrap the clip in a 1-scene song block — 133 §3's standing caveat); and
  batch render time scales with voice count (unison stacks × layers — measurable, not
  prohibitive at 4-bar clips).

**Verdict: layering is already expressible by construction; it has simply never been done in
the showdown pipeline.** The biggest structurally-unexplored region the owner named is one doc
builder away from being an arm. (High.)

## 4. The recipe format (Part 3)

### 4.1 Design requirements

From the repo's own precedents and laws: (1) **machine-executable** — every step an existing
edit primitive, in the tricks step vocabulary (`set` / `effectAdd` / `addHits` / `automate` /
`macro`), extended minimally (below), because 118 proved preconditioned receipt-carrying moves
work; (2) **machine-verifiable** — exit gates over features the repo computes
(`src/taste/features.ts` FEATURE_KEYS today; 131 §4's appended keys as B0 lands), because 135's
law is "never ship a clip that fails its role gate"; (3) **provenance-carrying and frozen** —
targets regenerate from the log/refs by script with the regeneration command recorded (the
`role-targets.json` pattern, 135 §E), and a validated recipe's gates are never silently edited
(CLAUDE.md frozen-science rule: new numbers = new version beside the old, exactly like
`engineplusProfile`); (4) **prompt-addressable at the right altitude** — one verb surfaces it
(121's law: agents apply what the prompt names), so the library ships with `beat recipe
list|show|build|check` in the tricks-CLI pattern; (5) **citation-honest** — every recipe records
where its structure came from and at what confidence, so a failed recipe indicts its source and
a validated one upgrades it.

Step-vocabulary extensions needed (small, named here so the builder stream can price them):
`trackAdd` (declare a layer track with kind/patch — the one verb tricks deferred as
`sidechain-pump`'s blocker), `humanize` (the existing CLI verb as a step), `scaleVelocity` /
velocity-tier application (135's deferred note-level verb), and `rehost` (the two-stage
finishing pass as a declared step). Everything else exists.

### 4.2 The schema

```jsonc
{
  "name": "rolling-sub-bass",            // identity: unique, kebab-case
  "version": 1,                           // frozen-science: numbers change ⇒ version++
  "role": "bassline",                     // bassline | chords | lead | drum-loop
  "tags": ["techno", "house", "dark", "rolling"],
  "sources": [                            // the prior's provenance, per-claim confidence
    { "cite": "Attack Magazine — warehouse rolling techno bass", "url": "…",
      "claim": "two-layer sub+mid split, sub LP ~80 Hz, mid saturated ~35% wet",
      "confidence": "high" },
    { "cite": "research/131 §7 P1", "claim": "gate numbers", "confidence": "measured" }
  ],
  "figure": {                             // MIDI/articulation requirements
    "archetype": "rolling-8ths",          // theory.ts archetype or 'any'
    "register": [28, 33],                 // MIDI root window (E1–A1)
    "feel": { "swing": 0.56, "velocityTiers": [0.9, 0.7, 0.5], "gate": 0.85,
              "rests": "leave beat-1 16th to the kick" }
  },
  "layers": [                             // ordered; layer 0 is the identity layer
    { "id": "sub", "kind": "synth", "octave": 0,
      "patch": { "osc": "sine", "filterEnvAmount": 0, "sustain": 0.95, "attack": 0.004 },
      "produce": { "role": "bass" },      // ProductionProfile fields (mono discipline)
      "gates": { "bandSubPct": [40, 80], "stereoWidthDb": [-100, -40] } },
    { "id": "mid", "kind": "synth", "octave": 12,
      "patch": { "from": "surge:Basses", "retarget": {          // §4.3 — a patch SOURCE
          "centroidLog2": [7.0, 8.0], "attackMedMs": [0, 10] } },
      "produce": { "saturator": { "drive": 0.35, "mix": 0.35 } },
      "gates": { "bandBassPct": [35, 60], "bandSubPct": [0, 10] } }
  ],
  "chain": [                              // clip-level steps, tricks vocabulary + extensions
    { "trackAdd": "pump", "kind": "drums", "hits": "kick-quarters", "volume": -60 },
    { "set": "$sub.duckSource", "value": "pump" }, { "set": "$sub.duckAmount", "value": 0.4 },
    { "set": "$mid.duckSource", "value": "pump" }, { "set": "$mid.duckAmount", "value": 0.4 }
  ],
  "gates": {                              // clip-level verification, on the summed render
    "bandSubPct": [30, 60], "centroidLog2": [5.5, 6.6],        // computable today
    "stereoWidthDb": [-100, -40], "crestDb": [10, 14],
    "crest_subDb": [0, 12], "attackMedMs": [0, 15], "fluxMean": [0.08, 0.35]  // B0 keys
  },
  "provenance": {
    "status": "sourced",                  // sourced → verified → validated (| parked)
    "gatesMinedFrom": { "refs": "taste-dataset/refs-packs/bassline", "stat": "p25–p75 of batch winners",
                        "regenerate": "node scripts/gen-recipe-gates.mjs", "asOf": "2026-07-26" },
    "verifyReceipt": null,                // features of the seeded reference build, when verified
    "blindRecord": []                     // append-only: {batchGroup, result} per rated batch
  }
}
```

Reading notes: **gates are bands, never scalar maxima** (§1.3); a gate key the feature pipeline
doesn't compute yet (B0 keys) is marked `pending` by the checker rather than silently passing —
recipes can encode targets ahead of the instrument, but `verified` status requires every gate
computable. Per-layer gates are checked on the layer's solo render (one `soloForShowdown` call —
already exists); clip gates on the summed render. `$<layerId>` resolves to the layer's track,
exactly as `$track` resolves in tricks. The `figure.feel` block is honest about metrics'
blindness: feel moves are gate-invisible (135's caveat), so they are REQUIREMENTS the builder
applies, not gates — the owner's ear is their only judge.

### 4.3 Retargeting: known presets as recipe starting points (the owner's addition)

The strategy, named: **`retarget` — take a preset that is already a human-designed known-good
point (factory, curated, `patches_3rdparty`, a matched patch) and run a bounded local search
until 5–8 measured scalars sit inside the recipe's bands.** This is the concrete instance of the
§1.3 division: the preset is the prior (place), the scalars are the gates (verify), the search
is local refinement — and the blind batch stays the only ranking.

Why this is cheap where T6 was hard, stated precisely: T6's objective was a full MFCC/spectral
*match* to a target sound — effectively hundreds of coupled dimensions, where the engine's
timbre ceiling itself binds (best 2–4× the self-match floor; envelope dimension solved). A
retarget objective is **membership in 5–8 scalar bands**, and the map from knobs to those
scalars is largely known and monotone: `subLevel`/octave → bandSubPct and centroid; env
`attack` → attackMedMs; the width stack → widthMeanDb; comp/envelope/velocity → crest family;
LFO/filter-env depth → fluxMean; cutoff → centroidLog2. The tricks catalog already encodes this
map as `expect` fields, and 135 §E's `fixes` table is its inverse. So a retarget run is: apply
the deterministic fix-map first (often sufficient), then a short local search (coordinate steps
or small-σ CMA-ES over the few free knobs) for the residual — a fundamentally easier,
lower-dimensional problem than spectrum matching, with band-membership stopping (no
maximization, no Goodhart pressure). Two honest limits: band membership does not guarantee the
preset's *character* survives the moves (large retargets can walk out of the design's basin —
bound the step size, and let the per-layer decomposition keep retargets small); and scalars are
coupled through energy normalization (band shares sum to ~100 — move them jointly, 133's
caveat).

Format integration: `retarget` is a **patch source**, not a separate artifact — `{"from":
"<preset-ref>", "retarget": {<gate subset>}}` — executed at build time, cached with provenance
`retargeted:<preset>@<targets-hash>` so the same recipe builds identically until its version
changes. Composition with layering is where it gets strong: each layer retargets against its
own band-role slice (sub layer → sub/mono gates; mid layer → bass-band/attack gates; top layer
→ flatnessHi/air gates), so no single voice is asked to hit a whole-loop profile — the layered
decomposition is exactly what makes the local searches small. A sibling stream is prototyping
the mechanics; this schema is the contract it should land against.

### 4.4 Example recipes

Three more, drawn from §2, complete enough to execute (sources abbreviated — full cites in §2.2):

**reese-bass** (v1, bassline, tags dnb/garage/dark — NI/Jamieson/FAW lineage + 134 §3, gates
from owned-ref bands):

```jsonc
{ "name": "reese-bass", "role": "bassline",
  "figure": { "archetype": "sparse-sub", "register": [28, 33],
              "feel": { "gate": 0.9, "velocityTiers": [0.85, 0.7], "swing": 0.5 } },
  "layers": [
    { "id": "sub", "patch": { "osc": "sine", "sustain": 0.95, "filterEnvAmount": 0 },
      "produce": { "role": "bass" },
      "gates": { "bandSubPct": [40, 80], "stereoWidthDb": [-100, -40] } },
    { "id": "reese", "octave": 12,
      "patch": { "osc": "sawtooth", "osc2Type": "sawtooth", "osc2Level": 0.8,
                 "osc2Detune": 22,            // 15–30¢ — the beating IS the sound
                 "unisonVoices": 4, "unisonWidth": 0.6, "cutoff": 700, "resonance": 0.2,
                 "attack": 0.01, "sustain": 0.85 },
      "produce": { "saturator": { "drive": 0.3, "mix": 0.3 } },
      "gates": { "bandBassPct": [30, 60], "fluxMean": [0.08, 0.4], "bandSubPct": [0, 12] } } ],
  "chain": [ { "set": "$reese.eq7HpOn", "value": true }, { "set": "$reese.eq7HpFreq", "value": 90 } ],
  "gates": { "bandSubPct": [30, 60], "centroidLog2": [5.5, 6.8], "stereoWidthDb": [-100, -35],
             "crest_subDb": [0, 12], "fluxMean": [0.08, 0.35] } }
```

**supersaw-trance-lead** (v1, lead, tags trance/euphoric — JP-8000/Szabo lineage + 134 §3;
punch gates from 131 P2):

```jsonc
{ "name": "supersaw-trance-lead", "role": "lead",
  "figure": { "archetype": "arp-16ths", "register": [57, 81],
              "feel": { "velocityTiers": [0.95, 0.75, 0.6], "swing": 0.5 } },
  "layers": [
    { "id": "saws", "patch": { "osc": "sawtooth", "unisonVoices": 7, "unisonWidth": 0.9,
                 "osc2Type": "sawtooth", "osc2Detune": 9, "osc2Level": 0.6,
                 "attack": 0.003, "decay": 0.25, "sustain": 0.55, "release": 0.2,
                 "cutoff": 9000, "velToFilterAmount": 0.35 },
      "produce": { "saturator": { "drive": 0.25, "mix": 0.3 } },
      "gates": { "attackMedMs": [0, 8], "flatnessHiDb": [-20, -6] } },
    { "id": "body", "octave": -12,
      "patch": { "osc": "sawtooth", "osc2Level": 0, "unisonVoices": 3, "unisonWidth": 0.4,
                 "cutoff": 2000, "volume": -10 },
      "gates": { "bandBassPct": [3, 15] } } ],
  "chain": [
    { "set": "$saws.eq7HpOn", "value": true }, { "set": "$saws.eq7HpFreq", "value": 200 },
    { "set": "$saws.sendDelay", "value": 0.14 }, { "set": "$saws.sendReverb", "value": 0.15 } ],
  "gates": { "bandMidsPct": [70, 90], "bandBassPct": [4, 14], "attackMedMs": [0, 8],
             "stereoWidthDb": [-10, -4], "truePeakDb": [-5, 0], "flatnessHiDb": [-16, -8] } }
```

**warm-pad-with-air** (v1, chords, tags house/deep — Synth Secrets pad conventions + 134 §3
movement rule + 135 §B.2 register/strum; gates from 131/135 chord rows):

```jsonc
{ "name": "warm-pad-with-air", "role": "chords",
  "figure": { "archetype": "sustained-pad", "register": [43, 48],   // bottom voice G2–C3
              "feel": { "strumMs": 15, "velocityTiers": [0.75, 0.6], "topVoiceAccent": 0.75 } },
  "layers": [
    { "id": "pad", "patch": { "osc": "sawtooth", "osc2Type": "triangle", "osc2Detune": 8,
                 "osc2Level": 0.6, "unisonVoices": 5, "unisonWidth": 0.7,
                 "attack": 0.4, "release": 0.6, "cutoff": 2200,
                 "lfoDest": "cutoff", "lfoSync": true, "lfoSyncRate": "1/1", "lfoDepth": 0.3 },
      "produce": { "chorusMix": 0.25, "sendReverb": 0.25 },
      "gates": { "fluxMean": [0.1, 0.4], "stereoWidthDb": [-11, -3] } },
    { "id": "airnoise", "patch": { "osc": "triangle", "noiseLevel": 0.12, "cutoff": 8000,
                 "attack": 0.5, "volume": -14 },
      "gates": { "flatnessHiDb": [-20, -8] } } ],
  "chain": [ { "set": "$pad.compThreshold", "value": -32 }, { "set": "$pad.compRatio", "value": 8 },
             { "set": "$pad.compAttack", "value": 0.003 }, { "set": "$pad.compMix", "value": 0.35 } ],
  "gates": { "bandBassPct": [18, 28], "bandMidsPct": [60, 75], "crestDb": [14, 17],
             "stereoWidthDb": [-11, -3], "fluxMean": [0.12, 0.4], "onsetRatePerSec": [2, 6] } }
```

(These three plus §4.2's rolling-sub-bass are the four complete sketches; §6.1 names the rest of
the first ten. Note what the format makes visible: every recipe that reaches for `attackMedMs`,
`fluxMean`, `flatnessHiDb`, or `crest_subDb` is gating on a B0 key — the critic feature upgrade
is not just the ladder's P0, it is the recipe library's instrument too.)

## 5. The owned Splice loops as existence proofs (Part 4)

### 5.1 The asset, re-verified

On disk this pass: **165 wavs** in `taste-dataset/refs-packs/` (bassline 32, chords 49,
drum-loop 25, lead 59), each with an `.analysis.json` sidecar; the commission's "197" was not
reproduced on disk (possibly counts un-filed purchases — flagged, and the program below is
count-invariant). Per 134 §4.1's manifest join: **59 distinct loops blind-rated, 41 batch
winners** — an owner-endorsed target list with named champions per role. These are not
tutorials: they carry no procedure. But they are *measurable known-good points* — the only
priors in the library whose numbers need no confidence label. (High.)

### 5.2 What measurement can and cannot extract

**Fully extractable (High):**
- **The target profile**: the full current feature vector per loop (sidecars exist), extended
  with 131's 25 new features the moment B0 lands — per-loop rows, per-role winner bands. This
  is the gate factory.
- **Register and root**: `src/analysis/pitch.ts` over the pitched loops pins the octave the
  band-share inference only estimates (135's own honest-gap suggestion, still unrun — cheapest
  single mining step, ~30 min).
- **Onset/articulation structure**: onset times vs the tempo grid give onset rate, swing (16th
  offset histogram), and velocity *tiers* (onset-level clustering — onsetLevelCv already
  discriminates at 0.5+); attack statistics per onset. This turns 135 §D's web-sourced feel
  numbers into measured per-role distributions — internet priors calibrated by owned ground
  truth.
- **The pump fingerprint**: kick-periodic gain modulation on bass/sustained content (envelope
  autocorrelation at beat period) — measurable, and it decides whether a bass recipe carries
  the ghost-kick chain block.

**Partially extractable (Medium — heuristics, lower bounds only):**
- **Layer evidence**: (a) per-band envelope decorrelation — a sub band sustaining while mids
  pluck implies ≥2 envelope-distinct layers; (b) band-split stereo — mono below a crossover,
  wide above, implies a split architecture and estimates the crossover; (c) HPSS
  harmonic/percussive energy split for texture-layer presence. These yield "at least N layers,
  split near X Hz," never an exact count — blind source counting on produced loops is not
  reliable, and the doc should never pretend otherwise.
- **Chain hints**: saturation shows as harmonic series enrichment vs a clean synth reference;
  glue compression as band-envelope steadiness (crest/envRange rows already measure its
  *effect*). Order and identity of effects: not recoverable.

**Not extractable (High confidence in the negative):**
- **The patch** — T6's measured verdict stands (spectrum matching 2–4× floor); rung 6 re-prices
  it on clean targets, and until then patch recovery belongs to 134's match program, not
  mining.
- **Polyphonic MIDI** (chords transcription noisy; 134's chord-candidate caveat) and anything
  the features can't hear (harmony quality, pocket — 131 §8).

### 5.3 The mining pipeline: from winners to recipe templates

1. **Per-loop target cards** (script, no owner time): feature row + pitch/register + onset/
   velocity/swing structure + layer-evidence flags + pump fingerprint, for the 41 winners
   first, then all 165. Aggregate statistics only — commit-clean under the standing posture
   (133 §6's pack-ranges proposal; audio never redistributed, filenames stay local).
2. **Cluster per role** into 3–5 character groups (e.g. bassline: rolling-dark vs sparse-sub vs
   mid-forward; the champions in 134 §4.1 seed the clusters). Each cluster's p25–p75 becomes a
   **gate band**; each cluster's articulation profile becomes a **figure.feel spec**.
3. **Attach clusters to corpus recipes**: the tutorial recipe supplies the *procedure*, the
   cluster supplies the *numbers* — a `sources[]` entry of kind `measured` pointing at the
   cluster, and the gates regenerated from it (`gatesMinedFrom`). Where a cluster matches no
   corpus recipe, that IS the finding: an owner-taste region the tutorial culture doesn't
   describe — name it, reverse-engineer a procedure hypothesis, mark it Low-confidence.
4. **Regeneration discipline**: `scripts/gen-recipe-gates.mjs` re-mines bands as new loops are
   rated; changed bands mint recipe versions (frozen science), so every historical blind result
   stays attributable to the numbers it was rated under.

### 5.4 Non-duplication with 134's match-to-loops program

Clean split, stated so the two programs compose instead of colliding: **matching recovers
per-layer TIMBRE** (a patch vector optimized against a loop's audio — CMA-ES, budgeted, ToU-
gated private until the owner rules; 134 M0–M2); **mining recovers RECIPE STRUCTURE and gates**
(aggregate statistics, procedure hypotheses, commit-clean). They meet in the schema: a mined
recipe's layer may name `"from": "matched:<loop>"` as its patch source, and a matched patch is
only ever *rated* inside a produced stack (134's own M2 rule). Mining feeds gates to the match
program too — M1's decision gate reads against the same cluster bands. Neither replaces the
other: a matched patch without a recipe re-runs the raw-engine arm; a recipe without timbre
sources is capped by the engine's per-voice ceiling that rung 6 prices.

## 6. The build proposal

### 6.1 The first ten recipes

Chosen to (a) cover the four roles, (b) ride 138's ladder rungs rather than compete with them,
(c) span the owner's measured taste clusters (dark/rolling per 134's champions), and (d) include
both corpus-sourced and mined-template entries so the graduation loop is exercised end-to-end:

| # | recipe | role | layers | primary source | key gates (band) | rides |
|---|---|---|---|---|---|---|
| 1 | rolling-sub-bass (§4.2) | bassline | sub + mid, ghost-kick pump | Attack warehouse-bass + 131 P1 | sub 30–60%, centroid ≤6.6, width ≤−40, crest_sub ≤12 | rung 1 |
| 2 | reese-bass (§4.4) | bassline | sub + detuned-saw mid | NI/Jamieson/FAW + 134 §3 | + fluxMean 0.08–0.35 | rung 1 |
| 3 | 808-glide-bass | bassline | sine + drop/glide + saturation | 134 §3, producersociety | sub 35–70%, glide on 1–2 changes | rung 1 |
| 4 | acid-303 | bassline | single voice + accent/glide grammar | SOS/Roland 303 docs (135 §B.1) | crest 11–14, accents 2–4/bar | rung 1/3 |
| 5 | warm-pad-with-air (§4.4) | chords | pad + noise/air | Synth Secrets + 135 §B.2 | body 18–28%, flux ≥0.12, crest 14–17 | rung 2 |
| 6 | house-chord-stab | chords | stab (fast env) + body octave + pad bed | M1-house conventions + 133 §5 | attackMed ≤12, onsetRate ≥4/s, body 18–28% | rung 2 |
| 7 | supersaw-trance-lead (§4.4) | lead | 7-saw + HPF + body octave | Szabo/JP-8000 | attackMed ≤8, width −10..−4, flatnessHi −16..−8 | rung 2 |
| 8 | pluck-delay-lead | lead | filter-env pluck + delay space + width | 134 §3 pluck + 135 F9 | attackMed ≤8, presence 2.5–5% | rung 2 |
| 9 | layered-house-kit | drum-loop | kick + top-loop (hats/perc tiers, swing 54–58) | 135 §B.4 + Linn | sub 35–50%, crest 12–15, air 3–5%, sustain ≥45% | free wins |
| 10 | dark-techno-stab | chords | mined template from the owner's champion cluster (BR_W_Bird lineage) | §5.3 step 3 — measured, procedure Low | cluster bands verbatim | rung 5 |

Rules of engagement: recipes 1–4 land BEFORE rung 1's batches so the bass2 arm draws from them
(they ARE the checklist rows 1+2+5 in executable form); 5–8 the same for rung 2; 10 is
deliberately mined-first to exercise §5.3's "no corpus match" path. Every recipe ships
`sourced`, must pass its own gates deterministically to reach `verified` before any batch spends
owner ratings on it.

### 6.2 The first layered-clip showdown arm: `stack`

One variable, everything else held constant — the cleanest possible test of the owner's biggest
named unexplored region, and 138's rung 5 made concrete:

- **Design**: per pitched-role batch, the current best single-voice arm's clip (its exact
  figure, patch, and production) PLUS the recipe's additional layers (e.g. recipe 1's sub layer
  under the existing mid voice for bassline; recipe 5's body-octave + air layers for chords) —
  additive construction, so `stack` − sibling = the layers, nothing else. Both clips in the
  same batches beside ref and gen anchors; per-source figures by default (D24), disjoint-draw
  shared-figure reserved for a confirmation round. Twin-recognition risk is real (the surgeplus
  0%-wins twin precedent, 138 honest-gaps) — the additive design courts it, so the confirmation
  design should vary the figure between siblings and lean on head-to-head pairwise, and the
  first round should watch for "I can tell these are siblings" in the owner's notes.
- **Gates before rating** (the library's contract): the stack clip must pass its recipe's clip
  gates, and specifically must sit inside the ref band on ≥2 axes its single-voice sibling
  measurably missed (bassline: bandSubPct + crest_subDb; chords: bandBassPct + fluxMean).
- **Pre-registered success**: `stack` beats its own single-voice sibling in ≥65% of implied
  head-to-head pairs over ≥8 batches/role (read against ±10-point noise); stretch: a D27 event
  — this is the arm 138 §5 already names best-equipped, because it is the first whose feature
  vector can sit inside the ref distribution.
- **Pre-registered failure reading**: gates passed but ratings flat ⇒ layering *as assembled*
  adds nothing at clip scale ⇒ the residual is per-layer timbre — rung 6 (match-to-loops
  ceiling) decides, and the recipe library pivots its layer patch sources toward
  keymap/sampled/plugin-host material per 138 §5(c). Gates unreachable (e.g. flatnessHi never
  enters band with current oscillators) ⇒ that is itself the texture-source finding, priced
  before any owner time is spent.

### 6.3 How the library grows

- **Who adds**: any agent session may append a `sourced` recipe (schema-validated; eager
  validation in the tricks pattern — the recipe must *execute* end-to-end on a scratch project
  at add time, even if its gates don't yet pass). The owner adds leads by reference ("make me
  X like Y") — which the mining pipeline (§5.3) turns into a template. Mined templates enter
  the same way, with `measured` sources. Append via script to survive the standing
  parallel-session hazard; `docs/recipes-reference.md` regenerates, never hand-edited
  (tricks-reference discipline).
- **Graduation**: `sourced` → `verified` when a seeded reference build renders
  deterministically and passes every (computable) gate — receipt stored in
  `provenance.verifyReceipt`; `verified` → `validated` when the recipe's arm beats its
  pre-registered control in blind rating (≥8 batches, ≥65% head-to-head, or the recipe's own
  pre-registered variant) — record appended per batch. A recipe that fails validation twice is
  **parked** with its record intact, never silently re-tuned (a re-mine or redesign is a new
  version; the failure stays attached to the old one — that's what makes the library
  evidence rather than lore).
- **What regenerates vs what freezes**: gates regenerate from the growing rated log by script
  (minting versions); procedures and sources freeze per version; the blind record only ever
  appends. The library thus inherits both repo disciplines at once — tricks' receipts and the
  frozen-science provenance chain.
- **Sequencing against 138**: nothing here jumps the ladder. B0 (critic features) is also the
  recipe library's instrument — most §4.4 gates are B0 keys. Recipes 1–4 feed rung 1, 5–8 feed
  rung 2, `stack` IS rung 5 with its layer definitions supplied, and §5's mining feeds rung 6's
  target selection. 139's deliverable to the ladder is the knowledge container; the ladder's
  deliverable to 139 is the validation events that graduate recipes.

## Honest gaps

- **The corpus numbers are tutorial-grade.** Research 07's warning stands measured: specific
  numeric values from the web corpus are starting points for the verify loop, never verified
  facts — this doc's own design (structure from corpus, numbers from refs) is the mitigation,
  not a solved problem. Web passes were single-agent, non-adversarial.
- **The 197-loop count was not reproduced**: 165 wavs on disk in refs-packs this pass. If 32
  more loops exist un-filed, the mining pipeline absorbs them without design change; the
  discrepancy should be resolved before freezing cluster bands.
- **Gate bands assume B0.** Of the gates the example recipes reach for, only the current 13
  FEATURE_KEYS are computable today; attackMedMs/fluxMean/flatnessHiDb/crest_subDb/widthMeanDb
  wait on the critic feature upgrade (138 B0). The checker's `pending` semantics keep this
  honest, but no recipe can reach `verified` on those gates until B0 ships.
- **Feel is gate-invisible.** Every `figure.feel` requirement (swing, tiers, strum, chance) is
  invisible to the static features; a recipe can pass all gates with a dead feel. The owner's
  ear remains the only instrument there (135's caveat, unchanged), and a validated-recipe win
  cannot be attributed between patch/chain and feel without a nofeel ablation.
- **Layer-evidence mining is heuristic** (§5.2's lower-bound framing) — no method here counts
  layers in a produced loop reliably, and none should be claimed. The crossover estimates from
  band-split stereo are the most trustworthy of the family.
- **The additive `stack` design courts twin recognition** (owner hears the shared figure/patch
  under the added layers) — flagged in §6.2 with the surgeplus precedent; the confirmation
  round's distinct-figure design is the mitigation, at the cost of a less pure ablation (D24's
  standing tension, managed not solved).
- **Retargeting's basin-escape risk is unmeasured**: how far a preset can be pushed toward
  band membership before its designed character dies is exactly what the sibling prototyping
  stream should measure; this doc only bounds the step size by construction.
- **Render-cost scaling for layered clips is unpriced** (unison × layers × batch size) —
  measure it in the B4 build before committing to stack-by-default.

## Sources

Repo (all verified this pass unless noted): `docs/research/138-splice-parity-plan.md` (plan of
record; B4, rungs, ceiling), `131-quality-gap-empirical.md` (discriminators, targets, critic
numbers), `133-production-chain-depth.md` (pack craft, chain topology, two-stage re-host, pack
medians), `134-patch-design-at-scale.md` (E2/ring-gate diagnosis, role design rules, match
program, T5 gate result, decomposition), `135-producer-knowledge-layer.md` (checklists,
role-target schema precedent, feel numbers), `117-critic-guided-search-in-practice.md` +
`docs/pilot.md` (search containment record), `115-production-layer-techniques.md` (layering
consensus §1, group-bus gap), `132-sound-source-expansion.md` §5 (composite arm),
`presets/tricks.json` + `docs/tricks-reference.md` (step vocabulary, receipts),
`presets/engine-curated.json` (patch-bank precedent), `src/taste/showdown.ts` (+`cli/beat.mjs`
call sites; `soloForShowdown`/`isolateTrack`/`writeShowdownBatch` — the layering verdict),
`src/analysis/produce.ts` (ProductionProfile), `src/taste/features.ts` (FEATURE_KEYS);
`taste-dataset/refs-packs/` counts re-verified on disk.

<!-- WEBPASS:SOURCES -->
