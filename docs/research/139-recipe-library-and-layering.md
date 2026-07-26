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

### 2.2 The mined recipes, per role

Each entry: procedure with concrete values (in dotbeat field names where expressible), source +
confidence. Numbers are **starting hypotheses** (§1.3 pushback 2); the binding numbers are the
gates, which come from the owned-ref bands (131 §7, 133 §1, 135 §A.2). Entries marked ◆ are
already partially codified in repo docs; the web pass re-verified sources and added the rest.

<!-- WEBPASS:RECIPES -->

### 2.3 The expressibility audit

<!-- WEBPASS:AUDIT -->

### 2.4 What the tutorial culture assumes, and how designers actually work

<!-- WEBPASS:CULTURE -->

## 3. Layering as a first-class citizen (Part 2)

### 3.1 The standard layer architectures

<!-- WEBPASS:LAYERS -->

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
