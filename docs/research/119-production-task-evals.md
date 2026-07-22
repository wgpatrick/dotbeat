# Research 119 — production-task evals: blind-rating the agent at specific production jobs

*2026-07-21. The eval half of the coupled pair with
`docs/research/118-production-bag-of-tricks.md`. The showdown answered "which SOURCE produces
sound worth keeping" (first full-credibility scoreboard, 21 rated batches: ref 94% pairwise >>
gen 70% >> keymap 13% ≈ engine 4%; per-role, gen's bassline gap to ref is nearly closed while
drum-loop/lead are worst). This doc designs the next question: "can the agent do a specific
production TASK well?" — complement a groove, continue a loop, production-polish a clip. Reuses
the existing blind-rating infrastructure wholesale (`docs/source-showdown-eval.md`,
`docs/taste-loop-design.md`): clip-set batches, seeded shuffling, `beat rate`, the one
`beat-scores.jsonl`, per-type eval splits, `SPLIT_SMOKE_MIN_BATCHES = 5`. Designed against main @
b7d8d18 (checked: PR #26's per-batch archetype bank fixed showdown un-blinding; genSubjectVaried
landed for gen-prompt variety; old bad-data realsong-vary batches deleted).*

**Read first:** `docs/source-showdown-eval.md` (batch construction, ref-dir licensing stance,
honesty notes — all inherited here), `docs/taste-loop-design.md` (L1 harness, data-mix logic,
consistency probes), research 118 (task 3 below is its blind test).

## Headline

**Every production task becomes a showdown-shaped batch: fixed shared context, N candidate
completions from different sources, blind-ranked by the unchanged `beat rate` flow.** The one
structural idea that makes these evals honest is the same one SingSong used and the showdown
already embodies: **hold the context constant and rate only the completion — with the REAL
completion from a commercial record as the hidden ceiling and a mismatched/trivial completion as
the hidden floor.** Chance level is then not an abstraction: it is the measured rate at which the
agent's completion beats the floor and loses to the ceiling. Two tasks to build first:
**production-transform** (cheapest, zero new data needs, directly evaluates the bag of tricks,
and attacks the exact axis the showdown measured as the loss — mono/airless/static) and
**complement-generation: bass-given-drums** (the highest-information compositional task, with the
ground-truth-stem baseline the T3 Demucs pipeline already specs). Both fit the existing
`beat showdown`/`beat rate` plumbing with one new batch-builder command.

---

## 1. Task taxonomy

Five task families, ordered by how much new machinery each needs. Shared conventions for all:
batches are ordinary clip-set batches (empty parent — score works, adopt refuses), group
`prodtask:<task>[:<subtask>]` so `beat rate` queues them, the log splits by task forever, and
taste-eval classifies them as their own variant type; every batch is duration-matched and
loudness-normalized by the same `normalizeBatchLoudness` path (cross-source loudness is exactly
the confound the program already controls); presentation is double-shuffled (builder permutation +
`beat rate`'s own). Ref-derived audio inherits the showdown's licensing posture verbatim
(read-only source dir, per-batch `.gitignore`, kind-only in the scores log).

### T-A. Complement generation ("given these drums, write the bassline")

- **Agent gets:** a context clip — a drum loop (from a seed song, a gen drum phrase, or a ref
  drum stem chop) as audio PLUS its symbolic form when it exists (`.beat` file); tempo/key.
- **Agent produces:** a complementary part (bassline as a `.beat` track rendered through the
  engine, or gen/keymap variants — the source axis composes with the task axis).
- **Rated how:** each candidate is MIXED with the identical context (context at a fixed level,
  complement gain-staged, then batch-normalized) — the rater hears `drums+bassA` vs
  `drums+bassB` vs ..., and ranks. This is SingSong's protocol: pairs where "the vocals were
  identical between the two mixtures," raters pick which instrumental "seemed more musically
  compatible" (arXiv:2301.12662). Rating the complement solo would measure sound quality, not
  compatibility — the mix-with-context presentation is the load-bearing choice.
- **Baselines in every batch:** (1) **real** — the actual bass stem chop from the SAME song as a
  ref drum-stem context (requires stem-paired chops: Demucs separation of the owner's refs, which
  is precisely T3's pipeline; drums and bass stems from the same bars). The ceiling. (2)
  **mismatch** — a real bass stem from a DIFFERENT song (tempo-compatible pool), SingSong's
  "Retrieval/Random" floor. (3) the agent's engine complement; optionally (4) a gen (fal)
  bassline prompted with the context's tempo/key.
- **Chance:** if raters can't hear compatibility, agent-vs-mismatch pairwise = 50%. SingSong's
  calibration numbers are the realistic anchor: their model beat random accompaniment 74% and
  lost to ground truth (34% vs GT) — so "meaningfully above 50% vs mismatch, honest distance
  from real" is what success looks like, not "beats the record."
- **Variants:** chords-given-bass, drums-given-bassline — same shape, different role pair. Start
  with bass-given-drums: the showdown says basslines are the strongest generation role
  (gen 81% vs ref 83% pairwise), so the task isolates *fit* rather than being swamped by timbre
  quality.
- **Literature:** SingSong (vocals→accompaniment, the protocol source; arXiv:2301.12662);
  STEMGEN (mixture-conditioned stem generation, non-autoregressive; arXiv/ICASSP 2024 — weights
  unavailable, so it's a method precedent not a baseline); Diff-A-Riff (context-conditioned
  accompaniment via latent diffusion, Sony CSL, arXiv:2406.08384); MusicGen-Stem /
  Multi-Track MusicLDM (multi-stem generation). Objective-metric option for later: COCOLA
  (contrastive stem-coherence score, arXiv:2404.16969) and Sony's Accompaniment Prompt Adherence
  metric — both validated against listening tests; candidates for an automatic pre-screen, never
  a replacement for the owner's ears. *(all high confidence that these exist/do what's claimed;
  none directly benchmark symbolic-engine complements — dotbeat's setting is its own)*

### T-B. Continuation ("extend this 4-bar loop to 8")

- **Agent gets:** bars 1-4 (audio + symbolic when engine-side).
- **Agent produces:** bars 5-8.
- **Rated how:** the full 8 bars, bars 1-4 byte-identical across candidates — raters rank which
  continuation "goes somewhere" without breaking. Presenting only bars 5-8 solo is a worse
  design: continuation quality is relational (does 5-8 belong to 1-4?), same logic as T-A's
  mix-with-context.
- **Baselines:** (1) **real** — an 8-bar ref chop split 4+4, its own bars 5-8 as ceiling; (2)
  **loop-copy** — bars 1-4 repeated verbatim. Loop-copy is the honest, embarrassingly strong
  floor: in loop-based genres an exact repeat is musically *valid*, so the interesting number is
  how often a generated continuation beats plain repetition. If it can't, the agent adds nothing
  over `ctrl-C ctrl-V`. (3) the agent's continuation (engine edits: variation, fills, added
  layers — this task rewards exactly the research-118 arrangement tricks).
- **Chance:** agent-vs-loop-copy pairwise 50% = "no value over repetition."
- **Literature:** Anticipatory Music Transformer — symbolic infilling/continuation with human
  evals finding accompaniments "similar musicality to human-composed over a 20-second clip"
  (arXiv:2306.08620) — the closest published protocol for symbolic continuation quality;
  MusicGen's audio-prompted continuation mode is the audio-domain analog. *(high)*

### T-C. Production-transform ("make this clip sound produced") — evals research 118 directly

- **Agent gets:** an existing engine clip (a showdown-style soloed role phrase, or a full seed
  mix) that measures mono/dry/static — the documented loss mode.
- **Agent produces:** the same musical content, production-transformed: width/air/motion/glue via
  `beat trick apply` moves (or free-form edits — the eval doesn't care how, which is what makes
  it a fair test of the catalog rather than of one command).
- **Rated how:** original and transformed in one blind batch, same notes, same loudness (LUFS
  matching is critical and already default — width/air must win on quality, not level). Optionally
  a third arm: **random-transform** (same number of edits, randomly chosen params at comparable
  magnitudes) — the control that distinguishes "the right production moves" from "any change
  sounds different/better." Batch = {original, tricked, random-control}, ranked.
- **Chance:** tricked-vs-original pairwise 50%; tricked must also beat random-control or the
  catalog's content is doing no work.
- **Sanity receipts for free:** every clip already gets the DSP feature vector in the scores log —
  so each rated batch *also* records whether `stereoWidthDb`/`bandAirPct` moved into the produced
  range, tying the blind result to the mechanical one (118 §3.5's two-receipt design).
- **Literature:** none direct — automatic-mixing literature (e.g. AI mastering A/B tests) is
  adjacent but evaluates full mastering chains, not targeted transforms. Honest gap; the design
  stands on the showdown's own measured axes instead. *(low external / high internal grounding)*

### T-D. Arrangement ("turn this loop into intro → build → drop")

- **Agent gets:** an 8-bar loop project. **Produces:** a 32-64-bar arrangement (scenes/sections,
  automation, transitions — the research-118 arrangement tricks are the toolkit).
- **Rated how:** this one does NOT fit the 10-second-clip rating flow — a drop only means
  something after its build. Clips would be 60-120 s; rater fatigue and the pairwise format both
  strain (taste-loop notes the 10-20-batch session ceiling). Defer to a lighter protocol:
  single-stimulus 1-5 scoring, or rate only the 8 bars AROUND the drop boundary against ref
  transition chops. Structure metrics (`beat analyze-structure`: per-section density/novelty
  curves vs ref-track section profiles) are the cheap advisory precursor.
- **Chance/baselines:** loop-repeated-N-times as floor; a ref track's real arrangement as
  ceiling. **Not in the first build round** — the batch format itself needs design. *(honest
  deferral)*
- **Literature:** essentially none for blind-rating generated arrangements at this scale;
  song-structure literature is analysis-side. *(gap)*

### T-E. Fill / transition generation ("write the turnaround into bar 8")

- **Agent gets:** an 8-bar drum loop with a static bar 8. **Produces:** bar-8 fill (hit edits:
  snare builds, drum-pulls, tom runs — tricks 21/22).
- **Rated how:** full 8 bars per candidate, bars 1-7 identical (the T-B presentation applied at
  bar scale). Baselines: no-fill (the loop as-is — the floor, and again a musically valid one),
  real fill (ref drum-stem chop covering a phrase boundary — needs T3 stems with bar-boundary
  detection, already in the T3 pipeline via Beat This), agent fill.
- **Chance:** agent-vs-no-fill 50%.
- **Literature:** GrooVAE's Drum Infilling task (condition on the kit minus one part, generate
  the rest; Magenta, arXiv:1905.06118) and "Generating Coherent Drum Accompaniment With Fills
  And Improvisations" (arXiv:2209.00291) — precedent that fill generation is a learnable,
  evaluable task; both symbolic, close to dotbeat's native representation. *(high)*

### Why this taxonomy carves where it does

Each family isolates one capability the end goal ("agent makes produced tracks") needs:
**T-A** = writes parts that fit; **T-B** = develops material over time; **T-C** = production
surface (the measured showdown loss); **T-E** = phrase punctuation; **T-D** = composes the
capabilities. And each maps to a different fix if it fails: T-C failure → research 118's catalog
is wrong; T-A failure → composition/theory tooling; T-B/T-E failure → variation/arrangement
tooling. One pooled "is the agent good" number would average those stories away — the same
argument `source-showdown-eval.md` §"Why per-role" already makes.

---

## 2. Build order: the two first tasks, concretely

### 2.1 First: production-transform (`beat prodtask transform`)

Why first: zero new data dependencies (no stems, no fal spend required), directly closes the loop
on research 118 the week it ships, and targets the axis where the measured gap is largest and the
mechanism (defaults never touched) is proven.

```
beat prodtask transform <dir> [--seeds <taste-seeds-dir>] [--roles bassline,chords,lead,drum-loop]
                        [--tricks auto|<name,name,...>] [--control random|none]
                        [--rounds 1] [--seed 61]
```

Per role, per round: pick a seed song (the showdown's own seed/archetype machinery — inherit the
PR-#26 per-batch archetype bank so recognition can't un-blind), solo the role's track, render the
**original**; apply the trick set (`--tricks auto` = `beat trick suggest`'s passing set under the
stacking policy; explicit names for ablations), render **tricked**; with `--control random`,
apply the magnitude-matched random edit set, render **control**. Assemble as a clip-set batch,
seeded shuffle to `v1..vN.wav`, manifest `sources` map records
`{ kind: original | tricked | control, tricks: [names], seed }`, group
`prodtask:transform:<role>`, batch-LUFS-normalize. Rate via `beat rate`, report via:

```
beat prodtask --report [--json]     # per-task, per-role: win/top-half/pairwise per arm,
                                    # smoke label under 5 batches/split (same convention),
                                    # plus the mean metric delta (widthDb, airPct) per arm
```

Almost all of this is `src/taste/showdown.ts` with a different source axis — the honest estimate
is "one stream," not a phase. Ablation for free: `--tricks width-only` vs `width+air` vs `full`
is exactly the P1/P2/P3 ablation 115 §"Honest gaps" asked for, now blind-rated per arm.

### 2.2 Second: complement bass-given-drums (`beat prodtask complement`)

```
beat prodtask complement <dir> --give drums --make bassline
                         [--context seed|ref] [--ref-stem-dir <path>]
                         [--rounds 1] [--seed 62] [--gen-backend fal|stub]
```

- `--context seed`: the drum context is a seed song's drum loop (4 bars, the showdown convention);
  candidate complements = engine (agent-composed bassline via the archetype bank — later, the
  actual interactive agent), gen (fal bassline phrase, tempo/key in the prompt), mismatch (a
  DIFFERENT seed's bassline rendered the same way — the cheap floor available without stems).
- `--context ref` (the full version, gated on T3 stem-separation running over the private refs):
  context = a ref drum-stem chop; adds the **real** arm (the same song's bass stem, same bars) as
  ceiling and draws mismatch from other songs' bass stems. Stem pairs come from the T3 pipeline
  (Demucs → Beat This bar chopping) with one addition: chop drums and bass at the SAME bar spans
  and keep the pairing in the (private) chop manifest.
- Mixing: context at a fixed anchor level; each complement mixed in; whole batch LUFS-normalized.
  Manifest records per-variant `{ contextKind, complementKind }`; scores log records kinds only
  (ref posture inherited).
- Group `prodtask:complement:bass-given-drums`; same report plumbing.

Stub backend (`--gen-backend stub`, deterministic tone beds) keeps the whole pipeline CI-testable
with zero fal spend and zero ref exposure — the established plumbing-truth convention.

### 2.3 What "the agent" means in v1 — stated honestly

In v1 both commands script the candidate construction (trick auto-set; archetype-bank basslines).
That evaluates the *toolkit ceiling*, not yet the interactive agent's judgment. The upgrade path
is real but separate: hand the context to an actual agent session ("here is drums.beat — add a
bassline," "produce this clip up") and drop its output file into the same batch dir before
assembly. The batch format doesn't care where a candidate came from — that's the point of
manifest `sources` maps. Do the scripted version first; it's the baseline the agentic version
must beat.

## 3. Honesty notes (inherited + new)

- **Phrase confound, inherited:** in complement batches, gen invents its own notes while engine
  plays archetype notes — a gen win conflates fit and timbre. Accepted for v1 exactly as the
  showdown accepted it, and the mismatch arm partially controls it (mismatch has real-record
  timbre AND wrong fit).
- **Recognition risk on ref contexts:** the owner may recognize a loved song's drums and know
  which bass is "real." Mitigations: prefer `refs-unfamiliar` for complement contexts, record
  the familiar/unfamiliar pool in the manifest (the split the showdown report doesn't do yet),
  and treat familiar-pool results as tainted for the real-arm comparison — same discipline as
  PR #26's recognition-taint call.
- **Small-n discipline:** every split keeps the smoke label under 5 batches; per-task-per-role
  splits multiply fast, so start with 2 tasks × 2-4 roles and let rounds accumulate before adding
  task families.
- **Owner rating time is the binding budget** (the taste program's own conclusion: "the critical
  path runs through the owner's ears"). Two new task groups at ~4 batches/round each is the right
  addition rate; T-D/T-E wait until T-C/T-A have shed their smoke labels.
- **Objective pre-screens (COCOLA/APA) are unvalidated on this material** — worth a later
  experiment scored against the owner's own picks via the existing taste-eval harness, never
  assumed.

## Sources

Internal: `docs/source-showdown-eval.md`; `docs/taste-loop-design.md`; `src/taste/showdown.ts`
(batch assembly, `showdownRole`, sources map); `src/taste/features.ts`; memory of the 2026-07-21
scoreboard (21 rated batches) and PR #26/#26-follow-on state; git log checked at main @ b7d8d18.
Literature (URLs, all fetched/searched this pass): SingSong — Donahue et al., "SingSong:
Generating musical accompaniments from singing," arXiv:2301.12662 (identical-vocals pairwise
protocol; 74% vs random, 34% vs ground truth; arxiv.org/pdf/2301.12662, supplement
storage.googleapis.com/sing-song); Anticipatory Music Transformer — Thickstun et al.,
arXiv:2306.08620 (infilling/accompaniment; human evals ~human-musicality over 20 s clips); JASCO —
Tal et al., "Joint Audio and Symbolic Conditioning for Temporally Controlled Text-to-Music
Generation," arXiv:2406.10970 + huggingface.co/facebook/jasco-chords-drums-400M (chords/drums/
melody-conditioned generation — precedent for symbolic-context conditioning); STEMGEN — Parker et
al., ICASSP 2024 (mixture-conditioned stem generation; weights unreleased); Diff-A-Riff — Nistal
et al., Sony CSL, arXiv:2406.08384 + sonycslparis.github.io/diffariff-companion (context- and
reference-conditioned accompaniment; subjective listening tests because prior systems are
closed); COCOLA — arXiv:2404.16969 (stem-coherence contrastive metric); Accompaniment Prompt
Adherence (Sony CSL, validated vs listening tests); GrooVAE — Gillick et al., "Learning to
Groove with Inverse Sequence Transformations," arXiv:1905.06118 + magenta.tensorflow.org/groovae
(Drum Infilling, Tap2Drum); "Generating Coherent Drum Accompaniment With Fills And
Improvisations," arXiv:2209.00291. Confidence: protocol/results claims for SingSong/AMT/GrooVAE
are paper-stated (high); the reading that none of them cover engine-rendered symbolic complements
against commercial stem ceilings is this doc's own (medium — no counterexample found this pass).
