# Research 124 — Composing MIDI: models, benchmarks, and craft beyond random assembly

*Web + codebase research pass, 2026-07-24, at the owner's request after the Sandstorm cover:
"we had all the MIDI, so the composition was solid... we've just been randomly putting together
melodies/basslines. What's a better approach? Has anyone trained a model specifically for MIDI?
Are there benchmarks?" Method: three parallel web passes (symbolic-generation models; evaluation/
benchmarks; composition craft + algorithmic traditions), each sourced with URLs and per-claim
confidence labels (high / medium / low / speculative), grounded against the repo's current
composition machinery (`src/taste/showdown.ts` archetype banks, `src/taste/seeds.ts`,
`python/midi_extract.py`) and the constraints in D24-D27. Single-agent synthesis, not
adversarially verified; treat medium and below as leads. Companion docs:
`docs/research/121-harness-engineering-for-music-agents.md` §1 (how the Sandstorm MIDI was mined),
`docs/source-showdown-eval.md` (the eval every recommendation must feed).*

## Headline answers

1. **Yes, people have trained models specifically on MIDI — a decade of them — and four fit
   dotbeat's constraints** (permissive license, downloadable weights, Mac-runnable, works *over
   existing MIDI* rather than blank-page): the **Anticipatory Music Transformer** (Stanford,
   Apache-2.0, purpose-built infilling/accompaniment — still the strongest system in the 2025
   MIREX symbolic track *as a baseline*), **Composer's Assistant 2** (MIT, trained only on
   public-domain/permissive MIDI — the cleanest provenance anywhere, and purpose-built for
   exactly dotbeat's four workflows), **MIDI-RWKV** (MIT, edge-friendly, LoRA-personalizable in
   minutes on the owner's own MIDI), and **MIDI-GPT** (best bar-infill controls, but NC-licensed
   weights). (High on licenses/capabilities; medium on Mac specifics — nothing was run.) §A
2. **No model is a solved composer, and text-to-MIDI is actively bad** (the best published
   text-to-MIDI lands in the wrong key 2 times out of 3). General LLMs write valid but musically
   shallow ABC/MIDI — trained symbolic models beat GPT-4 in 76-79% of pairwise listening
   comparisons, and GPT-4 scores at *chance* on music-theory reasoning (MusicTheoryBench 25.6%).
   The evidence supports LLM-as-orchestrator + small local model (or deterministic rules) as the
   note generator — not LLM-as-composer. (High on the cited numbers.) §A.2, §B.5-B.6
3. **Benchmarks barely exist, and the owner's blind eval is already the methodologically correct
   instrument.** No standing leaderboard for symbolic generation exists as of mid-2026; the one
   recurring venue (MIREX, revived 2024) drew 4 systems and 14 raters; the field's own surveys
   say objective metrics correlate poorly with human judgment; and the frontier (Music Arena,
   MusicRL, per-user reward models) is converging on blind pairwise preference from the actual
   listener — which is literally `beat rate`. Any new composition source validates the way
   gen/surge did: as a new figure-source kind in showdown batches. (High.) §B
4. **The highest-leverage move is deterministic craft, not a model.** The commercial
   "theory-aware assistant" category (Ableton 12's MIDI generators, Logic Session Players,
   Scaler, Captain Chords) ships *no ML* — it is exactly dotbeat's archetype system plus the
   craft rules the current code lacks: weighted/function-tagged progressions at 1-2 bars per
   chord, cadence-position substitutions (v→V), kick-relative bass templates over 1-3 pitch
   classes with gate/velocity/swing numbers, motif-first melodies with a single peak note and
   chord tones on strong beats, minimal-motion voice-leading, Phrygian/Dorian mode color. Most
   of these are one-file changes to `showdown.ts`'s generators. (High that the category is
   non-ML; medium on individual recipe numbers — single-author sources.) §C.1-C.5
5. **What random assembly misses is everything *conditional*** — the current banks draw
   uniformly where craft is position-, kick-, and register-dependent: progressions have
   functions (breakdown bed vs pre-drop rise), substitutions belong at phrase ends, sub-register
   basses take root/5th/octave only (the current `sparse-sub` puts a 6th in the sub — an audible
   wrongness a one-line rule fixes), and melodies are motifs plus variation operators, not
   independent per-bar draws. (High, read directly against the code.) §C
6. **Recommended build: `beat compose` as chord-track + theory-aware generators +
   motif-operators** (§C.7), validated as new showdown figure sources against the archetype bank
   and the D25 commercial-MIDI ceiling — "does theory-aware generation close the
   archetype-vs-commercial gap?" is one batch series away. Then, if the deterministic layer
   plateaus, bolt AMT or CA2 on as a fifth source over the same chord track; MIDI-RWKV's
   own-data LoRA is the long-shot personalization play. (Medium — design proposal.) §C.7

---

## Part A — Models trained on MIDI/symbolic music: yes, many; four fit dotbeat

The answer to "has anyone trained a model specifically for MIDI?" is emphatically yes — a
decade-deep lineage. What matters for dotbeat is the intersection of four filters: permissive
license, downloadable weights, runs on a Mac, and supports **co-writer-over-existing-MIDI**
workflows rather than blank-page generation. The four workflows dotbeat actually needs, used as
the scoring rubric below: **W1** continue a bassline in key · **W2** harmonize a melody ·
**W3** generate a variation of a motif · **W4** infill a missing bar.

### A.1 The shortlist (all four filters pass)

**1. Anticipatory Music Transformer (AMT)** — Stanford CRFM, Thickstun et al. 2023.
Paper https://arxiv.org/abs/2306.08620; code https://github.com/jthickstun/anticipation;
weights https://huggingface.co/stanford-crfm/music-small-ar-100k / music-medium-800k /
music-large-800k (9 checkpoints). GPT-style model over arrival-time-encoded multi-instrument MIDI
events; "anticipation" training interleaves future control events so it can generate *conditioned
on events that come later* — principled infilling and accompaniment. **Apache-2.0 code and
weights** (high — verified on the model cards). Sizes 128M/360M/780M — all run on an M-series Mac
via plain HF Transformers (high on sizes; medium on MPS specifics — it's a standard causal LM,
no official MPS docs). Workflows: W1 yes, W2 yes (the flagship demo is accompaniment under a
given melody), W3 yes (resample a span, surroundings fixed — medium), W4 yes (span infilling is
the core capability). No text/style/chord-symbol conditioning — controls are event-level only.
Quality: its human eval found accompaniments near human-composed at 20-second timescales, and it
*still led* MIREX 2025's symbolic track on coherence/structure as a baseline (Part B.4).
Provenance note: the -100k/-200k checkpoints are Lakh-only; the -800k ones add MetaMIDI + ~450k
transcribed commercial recordings — murkier (high, from the model card). Use Lakh-only if
provenance matters.

**2. Composer's Assistant 2 (CA2)** — Malandro, ISMIR 2024.
https://github.com/m-malandro/composers-assistant-REAPER; CA2 paper
https://arxiv.org/abs/2407.14700; CA1 https://arxiv.org/abs/2301.12525. Multi-track MIDI
infilling with the best *controllability* in the survey: vertical/horizontal note density, pitch
range, leap propensity, and **rhythm preservation** ("same rhythm, new notes" — exactly the W3
motif-variation operator). **MIT license, and the models were trained ONLY on public-domain and
permissively-licensed MIDI — the cleanest provenance in the entire survey** (high). Runs as a
local CPU-friendly python server, no internet. Workflows: W1/W2/W3/W4 all yes — it is
purpose-built as the four-workflow tool. Cost: it ships welded to REAPER (Lua/python scripts);
the model server + tokenizer are separable with modest effort (medium). Quality is "useful
sketch collaborator," not virtuoso. Latest release v2.1.0; no CA3 as of 2026-07 (medium).

**3. MIDI-RWKV** — Zhou-Zheng & Pasquier 2025. https://arxiv.org/abs/2506.13001;
https://github.com/christianazinn/MIDI-RWKV. RWKV-7 small foundation model on GigaMIDI (1.05M
files): multi-track, long-context, controllable infilling explicitly aimed at computer-assisted
composition on edge devices. **MIT; base weights in the repo; rwkv.cpp/GGML conversion supported**
— the most Apple-Silicon-native option (high). The unique feature: **personalization via
LoRA/state-tuning in minutes on consumer hardware** (a 2.7M-param adapter trained in ~6 min, per
the paper) — the only candidate realistically fine-tunable on the owner's own MIDI/loop library
(high on the claim; the tuning-on-own-data workflow is untested here — medium). Newest, least
battle-tested; quality evidence is paper metrics + demo page only (medium). GigaMIDI provenance
is research-grade, not commercially clean.

**4. MIDI-GPT / MMM lineage** — Metacreation Lab (Pasquier, SFU). MMM (2020,
https://arxiv.org/abs/2008.06048) pioneered track- and bar-level inpainting; **MIDI-GPT**
(2024/25, https://arxiv.org/abs/2501.17011, https://github.com/Metacreation-Lab/MIDI-GPT,
https://huggingface.co/Metacreation/MIDI-GPT) is the released follow-up: GPT-2-arch, ~20M params,
trained on GigaMIDI, `pip install "midigpt[inference]"`, bar-level infill with
density/polyphony/duration controls as the headline feature (high). Built with Steinberg
collaboration. The catch: **weights are CC-BY-NC-4.0** (high — verified on the HF card) — fine
for the owner's personal use today, a poison pill if dotbeat ever ships commercially. The
Ableton-native **MMM4Live** device (https://www.metacreation.net/projects/mmm4live) is closed
beta and Rosetta-only on Apple Silicon (high).

**Watch: Moonbeam** (QMUL 2025, https://arxiv.org/abs/2505.15559,
https://github.com/guozixunnicolas/Moonbeam-MIDI-Foundation-Model) — Apache-2.0 MIDI foundation
model (309M/839M, 81.6k hours) with finetuning recipes for conditional generation and AMT-style
infilling — but the conditional/infilling checkpoints were still listed as TODO when checked
(high). If they land, it could leapfrog AMT.

### A.2 Everything else surveyed, and why it isn't shortlisted

- **Magenta lineage** (Music Transformer, MusicVAE, GrooVAE, Magenta Studio —
  https://github.com/magenta/magenta, https://magenta.withgoogle.com/studio/): the main repo was
  **archived 2026-01-06, read-only** (high). Magenta Studio's five Ableton Max-for-Live devices
  (Generate/Continue/Interpolate/Groove/Drumify) still run locally and remain genuinely useful
  for W3-style drum-groove variation (Drumify/Groove, trained on the CC-BY Groove MIDI Dataset),
  but the melodic models are pre-transformer-era. Magenta RealTime (2025) is audio, not symbolic
  — evidence the team moved on from MIDI. (Medium.)
- **Microsoft Muzic family** (https://github.com/microsoft/muzic, MIT code, largely dormant):
  **Museformer** — no released checkpoint, blank-page only (medium). **GETMusic/GETScore** —
  on paper an excellent co-writer shape (track-given-other-tracks, chord guidance, hybrid
  infilling) but training data unreleased and no checkpoint location in the README (high);
  practically unusable. **MuseCoco** — text→attributes→MIDI, checkpoints on Google Drive with
  unspecified weight license (low), blank-page only. **PopMAG** — no released weights (low).
- **FIGARO** (ICLR 2023, https://github.com/dvruette/figaro): MIT, checkpoints downloadable,
  Lakh-trained; description conditioning gives real **chord conditioning** ("same chords, new
  notes" at section level) but no true bar infilling; research-grade quality. (High on
  license/weights.) The one non-shortlist model worth remembering if chord-conditioned
  regeneration becomes the specific need.
- **Text-to-MIDI**: **MidiCaps** (https://huggingface.co/datasets/amaai-lab/MidiCaps, CC-BY-SA,
  168k Lakh-derived caption pairs) and **text2midi** (AAAI 2025,
  https://github.com/AMAAI-Lab/Text2midi, Apache-2.0, explicit Mac/MPS support): honest and
  mediocre — listening study 4.62/7 vs 5.79/7 ground truth, **33.6% key accuracy** (high, from
  the paper). A text-to-MIDI model that lands in the wrong key two times out of three is worse
  than dotbeat's existing key-locked archetypes. **MIDI-LLM** (Llama-3.2-1B vocab-expanded,
  https://arxiv.org/abs/2511.03942) — blank-page, Llama-license-encumbered (low). Skip the
  category for now.
- **LLM-as-composer (ABC)**: **ChatMusician** (https://huggingface.co/m-a-p/ChatMusician,
  LLaMA2-7B on ABC; card says MIT but tension with the underlying LLaMA2 license — medium, verify)
  and **MuPT** (https://github.com/multimodal-art-projection/MuPT, weight license effectively
  unclear — high that it's unclear): both beat GPT-4 in pairwise listening (Part B.6) but output
  folk/hymn-flavored material — weak fit for electronic MIDI (low-medium). **NotaGen**
  (https://huggingface.co/ElectricAlexis/NotaGen, MIT, genuinely musical) writes *classical
  scores* — wrong idiom. **General frontier LLMs** produce >90% syntactically valid ABC but
  musically shallow free composition (https://arxiv.org/abs/2407.21531, medium) — consistent
  with what the owner already observes from agent-composed figures.
- **Aria** (EleutherAI, ISMIR 2025, https://github.com/EleutherAI/aria,
  https://huggingface.co/loubb/aria-medium-base, https://arxiv.org/abs/2504.15071): Apache-2.0,
  0.7B, best-in-class continuation — but trained on 1.19M transcribed **solo-piano**
  performances; wrong instrument domain for basslines/leads. Its contrastive sibling
  (aria-medium-embedding) is a candidate for the *critic* side someday — with eyes open that the
  corpus is transcribed commercial recordings (medium; collides with D25's hygiene bar).
- **Seed-Music** (ByteDance) has an internal symbolic stage, no released weights (medium); YuE
  is audio — out of scope.

### A.3 Dataset provenance (feeds D25 thinking)

- **Lakh MIDI** (https://colinraffel.com/projects/lmd/): distributed CC-BY-4.0, but the files
  are largely uncredited transcriptions of copyrighted pop songs — the effective status is much
  murkier than the label, acknowledged by Stanford CRFM themselves (high). Lakh-trained: AMT,
  FIGARO, MidiCaps/text2midi.
- **GigaMIDI** (https://huggingface.co/datasets/Metacreation/GigaMIDI, gated;
  https://arxiv.org/abs/2502.17726): 1.4M+ files framed as "for research purposes under fair
  dealing" — research-provenance, not commercially clean (high). GigaMIDI-trained: MIDI-GPT,
  MIDI-RWKV.
- **Cleanest available: Composer's Assistant** — public-domain/permissive-only training set
  (high).
- The D25 posture maps cleanly: models that merely *generate candidate MIDI* for the owner's own
  tracks (AMT, MIDI-RWKV) have latitude; anything whose embeddings/weights would be baked into
  the taste critic should meet the stricter bar (CA2's corpus, or features computed from
  dotbeat's own data — not Lakh/GigaMIDI embeddings).

### A.4 The architecture the evidence supports

General LLMs reliably produce valid but musically shallow free compositions; small specialized
models are strong note-generators but have no idea what the track needs. The strongest supported
architecture is **LLM-as-orchestrator calling a small local infilling model as the note
generator**: the agent decides *what* to ask for (key, chord track, register, density, which bars
to keep) — the exact skills the Sandstorm mining demonstrated — and AMT/CA2/MIDI-RWKV proposes
notes; candidates then flow into the existing render+rate loop. (Medium — synthesis, not a
published result.)

## Part B — Benchmarks and evaluation: the honest state is "thin, and pairwise human preference wins"

The owner asked "are there benchmarks?" The short answer: objective metrics exist and are
explicitly distrusted by the field's own surveys; **no standing leaderboard for symbolic music
generation exists as of mid-2026** (high — verified absence across multiple searches); the only
recurring head-to-head venue drew 4 systems and 14 raters in 2025; and the field's own trajectory
(arena-style pairwise voting, RLHF, per-user reward models) is converging on exactly what dotbeat
already does — blind pairwise preference from the actual listener.

### B.1 Objective symbolic metrics — what they are and what they miss

The canonical reference is Yang & Lerch, *On the evaluation of generative models in music*
(Neural Computing and Applications 2020, https://link.springer.com/article/10.1007/s00521-018-3849-7):
musically-informed descriptors — pitch count, pitch-class histogram + transition matrix, pitch
range, average interval, inter-onset interval, note-length histograms — compared *relatively*
(intra-set vs inter-set distance via KL divergence / overlapping area) rather than as absolute
scores. The authors themselves say subjective evaluation "should be the ultimate choice" and
position the metrics as the fallback. (High.) Toolkits:

- **mgeval** (https://github.com/RichardYang40148/mgeval) — the Yang/Lerch companion. (High it
  exists; medium that repo is still canonical.)
- **MusPy** (Dong et al., ISMIR 2020, https://arxiv.org/pdf/2008.01951,
  https://muspy.readthedocs.io/en/latest/metrics.html) — the standard library: pitch-class
  entropy, **scale consistency** (max pitch-in-scale rate over all root/mode candidates —
  literally the batch-level version of `inferSeedKey`'s scoring loop in `showdown.ts`), polyphony,
  empty-beat rate, **groove consistency** (1 − mean Hamming distance between adjacent bars' onset
  vectors). MIT-licensed python; trivially runnable locally. (High.)
- **Structure metrics**: the Jazz Transformer paper (Wu & Yang, ISMIR 2020,
  https://arxiv.org/pdf/2008.01307; toolkit https://github.com/slSeanWU/MusDr) introduced
  "structureness indicators" from fitness scape plots over the self-similarity matrix, at short
  (3-8 s), medium (8-15 s), long (≥15 s) scales — framed around the observation that AI music
  fails on *structure* in ways the descriptor metrics never catch. (High.) This is the symbolic
  cousin of the arrangement-flatness miss in research/121 §1.3.

**The criticism is explicit in the field's own surveys** (all high confidence, quotes from full
texts):

- Kader et al. 2025 (https://arxiv.org/html/2509.00051v1): "poor correlation between objective
  metrics and human perception... lack of standardization that hinders cross-model comparisons";
  subjective evaluation remains "the most direct and ecologically valid approach."
- ACM Computing Surveys 2025 (https://arxiv.org/pdf/2506.05104v2,
  https://dl.acm.org/doi/10.1145/3769106): evaluation is "largely neglected or treated as an
  afterthought"; "inter-study inconsistencies... make the comparison of research results
  essentially impossible"; "even a statistically significant difference in a metric does not
  necessarily imply a perceptually significant difference."
- Xiong et al. 2023 (https://arxiv.org/abs/2308.13736): objective metrics "often lack
  interpretability for musical evaluation."

Notably, **no published correlation coefficient between descriptor metrics and human ratings for
symbolic music was found at all** (medium-high — absence after targeted search); the correlation
studies that exist are audio-domain. The closest datapoint: a Nov 2025 piano-transformer study
(https://arxiv.org/html/2511.07268) found distribution metrics (FMD/KLD/OA) rank models the way
humans do while perplexity diverges — with a human panel of **five people**, itself a demonstration
of the field's evaluation thinness. (High on claims; n=5 caveat.)

### B.2 Distribution metrics: Fréchet Music Distance

**FMD** (Retkowski et al., Dec 2024, https://arxiv.org/abs/2412.07948,
https://github.com/jryban/frechet-music-distance) adapts FID/FAD to symbolic music over CLaMP/
CLaMP-2 embeddings; works on MIDI and ABC; separates known-good from known-bad models. (High.)
Its authors flag embedding-model dependence and small-sample covariance instability; and — fatal
for dotbeat's per-clip use case — distribution metrics **cannot score an individual piece**, only
a population (https://arxiv.org/html/2509.00051v1). (High.) Possible niche use: FMD of a generated
figure-bank against a taste-matched reference corpus as a *bank-level* sanity check, never a
per-figure score.

### B.3 How papers actually evaluate: tiny one-off listening tests

The de facto standard is a small unstandardized MOS or A/B study, typically 10-40 raters on
ad-hoc axes. Documented range: n=5 (https://arxiv.org/html/2511.07268); MIREX 2025 symbolic
track — 20 recruited, 14 completed (https://music-ir.org/mirex/wiki/2025:Symbolic_Music_Generation_Results);
MuSpike's 76 valid listeners is *large* by field standards (https://arxiv.org/pdf/2508.19251);
the Anticipatory Music Transformer used MTurk pairwise "which is more conventionally musical" on
20-second clips (https://johnthickstun.com/assets/pdf/anticipatory-music-transformer.pdf). The
one historical outlier is BachBot's public discrimination test, n=2,336, participants near chance
distinguishing generated chorales from Bach (via https://arxiv.org/pdf/2011.06801). (All high;
BachBot margin medium.) There is **no standardized protocol**: "there are no standardized
approaches to the subjective evaluation for almost any MIR task" (ACM survey, above). MUSHRA/
webMUSHRA (https://github.com/audiolabs/webMUSHRA) get borrowed from codec testing, but
reference-anchored designs penalize different-but-better outputs and barely make sense for
composition quality. (High.)

### B.4 Leaderboards: none for symbolic

- **MIREX**, revived 2024 after dormancy (https://www.music-ir.org/mirex/wiki/2024:Symbolic_Music_Generation,
  https://music-ir.org/mirex/wiki/2025:Symbolic_Music_Generation): an annual event, not a
  leaderboard. 2025 piano-continuation: 4 systems (2 real submissions + 2 baselines), 14 raters,
  cherry-picked samples (best-of-8 per prompt). The 2023 **Anticipatory Music Transformer — a
  baseline — still led coherence (3.70) and structure (3.69)** in 2025, which says a lot about the
  field's pace. (High.)
- **Music Arena** (CMU, July 2025, https://arxiv.org/abs/2507.20900,
  https://gclef-cmu.org/blog/posts/250919_MusicArena/): live pairwise Elo voting — the closest
  thing to an LMArena for music, but **audio-only text-to-music; no symbolic track and no stated
  plan for one**. First-month scale: 1,051 valid votes. (High.)
- **MusicEval** (ICASSP 2025, https://arxiv.org/html/2501.10811v1,
  https://huggingface.co/datasets/BAAI/MusicEval): 31 models × 13,740 expert ratings — audio TTM,
  and a dataset for training MOS predictors, not a leaderboard. (High.)
- **AI Song Contest** (https://www.aisongcontest.com/): human-judged, benchmarks *teams and
  process*, not models. (High.)
- Benchmark *papers* without maintained rankings: MuSpike (https://arxiv.org/pdf/2508.19251),
  ABC-Eval (https://arxiv.org/html/2509.23350). Nothing named "MidiBench"/"MidiEval" exists
  (medium-high, verified absence).

### B.5 Music-theory exams for LLMs: knowledge ≠ composing

- **MusicTheoryBench** (ChatMusician paper, https://arxiv.org/abs/2402.16153,
  https://huggingface.co/datasets/m-a-p/MusicTheoryBench): 372 four-choice questions (chance
  ≈ 25%). **GPT-4 zero-shot: 58.2% knowledge, 25.6% reasoning — chance-level on reasoning.**
  ChatMusician itself: 39.5% / 26.3%. (High.)
- **ZIQI-Eval** (https://arxiv.org/abs/2406.15885, https://github.com/zcli-charlie/ZIQI-Eval):
  14k items, 16 LLMs, nearly all "only marginally better than random selection"; best (GPT-4) F1
  63.0 comprehension / 54.3 generation. (High.)
- **"Can LLMs 'Reason' in Music?"** (https://arxiv.org/abs/2407.21531): GPT-4-class models fail
  song-level multi-step reasoning and can't sustain thematic development. (High.)

The transferable warning: declarative theory knowledge demonstrably does not transfer to
composing — which cuts both ways for dotbeat: an agent reciting functional harmony is not
evidence its figures are good (only the blind rating is), but equally, deterministic theory
*rules* (Part C) don't need a model to "understand" anything.

### B.6 Head-to-head evidence: who composes best?

- AMT's own study: strong preference over baselines, and a **mild, not statistically significant
  preference over human-composed accompaniments** at 20-second timescales
  (https://johnthickstun.com/assets/pdf/anticipatory-music-transformer.pdf). Combined with its
  2025 MIREX showing (as a baseline beating submissions on coherence/structure), AMT is a
  reasonable "current best available with weights" proxy for piano-style material. (High on
  sources; medium on the generalization.)
- **Trained symbolic models beat general LLMs**: ChatMusician preferred over GPT-4's ABC output
  in 76% of pairwise comparisons (https://arxiv.org/html/2402.16153v1); MuPT preferred over GPT-4
  in 79%, and significantly over the MIDI-based MMT (https://arxiv.org/html/2404.06393). (High.)
- The audio-side methodological gold standard the symbolic side lacks: 15k pairwise comparisons,
  2.5k participants, Elo (ICASSP 2025, https://arxiv.org/abs/2506.19085). No study at any scale
  pits AMT vs Music Transformer vs frontier LLMs in one controlled human-preference experiment.
  (Medium-high, verified absence.)

### B.7 The meta-point — dotbeat's eval already is the right benchmark

The literature's frontier is converging on preference-from-the-actual-listener:
*Aligning Generative Music AI with Human Preferences* (https://arxiv.org/html/2511.15038) — 
standard objectives "fundamentally fail to capture the deeper qualities that make music
aesthetically pleasing"; personalized preference evaluation named as an open problem. MusicRL
(300k human ratings, audio), Spotify's per-user preference optimization
(https://research.atspotify.com/2025/9/personalizing-agentic-ai-to-users-musical-tastes-with-scalable-preference-optimization),
P-GenRM (https://arxiv.org/pdf/2602.12116), CMI-RewardBench (https://arxiv.org/html/2603.00610v3)
— none production-ready for symbolic. (High that the niche exists; high that nothing solved
exists.)

**Implication.** dotbeat's blind showdown log — one listener, pairwise, blind, per-role — is
methodologically *ahead* of how symbolic-generation papers evaluate, and it answers the only
question that matters here (does the owner prefer it). The correct integration is the one the
eval was built for: any composition source from Part A or C enters showdown batches as a **new
figure-source kind** (exactly as `gen`/`surge` did per `docs/source-showdown-eval.md`), holding
sound-source constant so the rating isolates composition; MusPy-style stats (scale consistency,
groove consistency, empty-beat rate) serve as pre-render *lint* — cheap gross-error gates in the
research/121 "metrics catch gross errors, ears decide quality" division of labor — never as the
score.

---

## Part C — Craft and deterministic machinery: what "random assembly" actually misses

Probably the highest-leverage part. The current baseline (read directly from
`src/taste/showdown.ts` / `src/taste/seeds.ts`, high): figures are drawn from small archetype
banks with **per-note seeded randomness inside the archetype** — diatonic scale degrees, a
progression picked uniformly from 8 root sequences at one-chord-per-bar, chord-tone arps in
shuffled orders, velocities as uniform random ranges, a 1-bar motif repeated with optional
inversion. That is already better than random notes (diatonic, role-shaped, producer-plausible
rhythms — the D24 comment says so explicitly). What it misses is *everything conditional*: which
progressions are actually common, where in the phrase a substitution belongs, what the bass owes
the kick, chord tones on strong beats, a single peak note, one-change-per-repeat. Each of those
is a deterministic rule with a citable source. Confidence labels per claim; single-author recipes
are flagged — they are tunable defaults, not measured consensus.

### C.1 Chord progressions: a tiny weighted set, not the whole diatonic space

- Main-room/house harmony is overwhelmingly **natural-minor diatonic**; Attack Magazine's guide
  singles out opening a 4-bar progression on **VI** as the main emotional device
  (https://www.attackmagazine.com/technique/passing-notes/main-room-house-chord-progressions/).
  (High, genre consensus.)
- Trance's named workhorses (https://www.myloops.net/how-to-write-uplifting-trance-chord-progressions,
  corroborated by https://unison.audio/trance-chord-progressions/): **i-VI-III-VII** ("the genre
  default — the crowd has heard it a thousand times"), **i-VII-VI-VII** (never resolves; pads-only
  sections), **VI-VII-i** (the last-8-bars-before-the-drop rise). (High for i-VI-III-VII; medium
  for the others — one author.) The i-VI-III-VII entry ALREADY exists in `seeds.ts`'s
  PROGRESSIONS; what's missing is the *weighting* and the *function tags* (breakdown bed vs
  pre-drop rise).
- **Harmonic rhythm**: new producers change chords every bar; the trance-breakdown norm is **two
  bars per chord** (Myloops, medium, one author). Every current dotbeat progression is
  one-chord-per-bar — an audible amateurism marker that costs nothing to fix.
- **The v→V move**: natural minor's minor v pulls weakly; borrowing major V from harmonic minor
  (E major in A minor — contains G#, the leading tone) is the strongest possible pull home, and
  the craft sources place it specifically at **phrase-final positions** (bar 7-8, last bar before
  a drop) (https://www.musiccrashcourses.com/lessons/scales_minor_mel_har.html + Myloops; high
  theory / medium EDM placement). Position-conditional substitution is exactly what a uniform
  random draw cannot express.
- **Techno's alternative is non-functional**: parallel planing — one minor-7th stab voicing
  transposed as a fixed shape by -2/+3/-5 semitones, deliberately ignoring diatonic membership
  (https://www.attackmagazine.com/technique/tutorials/the-theory-of-techno-parallel-chord-stabs/).
  (High for the genre.) A "planing" archetype is a missing bank entry.
- **Progression frequency is a queryable dataset**: Hooktheory Trends over ~40k crowd-transcribed
  songs (https://www.hooktheory.com/blog/trends-tool/,
  https://www.hooktheory.com/theorytab/popular-chord-progressions) gives real progression
  frequencies and next-chord probabilities — a first-order Markov table for free, key-relative.
  (High that it exists/is usable.)

### C.2 Basslines: kick-relationship template + 1-3 pitches + envelope numbers

Attack's eight-archetype survey
(https://www.attackmagazine.com/technique/tutorials/low-end-theory-exploring-eight-common-bassline-styles/)
is a better-motivated version of the current bank: off-beat (notes *between* kicks), root-rhythm
(root on kicks + end-of-bar flourish), noodle, bass-as-lead (8th-note octave alternation),
no-bass, ostinato, modulated/Reese ("the melody is usually very simple, the modulation provides
the interest"), multi-patch. (High.) The generator-insight that most contradicts random assembly:
**for techno/DnB/dubstep the correct pitch model is 1-3 pitch classes — complexity belongs in the
envelope/automation, not note choice.** (High.)

The recipes are unusually codable, down to numbers:

- **Uplifting trance rolling bass** (https://www.myloops.net/how-to-make-an-uplifting-trance-bassline,
  high — unusually precise): kick on quarters; bass on the **16th offbeats "e-&-a" of every beat**
  (12 notes/bar), all chord root; notes cut to 1/32 with amp envelope 0 ms attack / ~40 ms decay /
  zero sustain; optional −8-12 velocity on the "&"s; sidechain 0.1 ms attack, 100-140 ms release.
- **Tech-house rolling bass, the "Stussy 3-note pattern"**
  (https://theproducerschool.com/blogs/featured-blogs/building-a-rolling-bassline-like-chris-stussy-the-3-note-pattern-that-defines-modern-tech-house,
  medium — one author, extremely concrete): pitch set **1-5-8** or **1-b3-5**; tonic on 16th slots
  1/9 with the kick, fifth on 5/13, octave on 7/15, quiet tonic fillers elsewhere; gate 60% on
  downbeats / 90-100% offbeats; velocity 110/90/70-80; **swing 56-58%** ("<54% stiff, >62%
  dragged"); and a literal one-change-per-bar variation schedule (bar 2: slot-7 octave→tonic;
  bar 3: skip slot 14; bar 4: full pattern).
- **Register rule** (high, cross-source consensus): below ~100 Hz stick to root/5th/octave;
  thirds and color tones go an octave up. The current `bassNotes` freely puts degree+4 (the 6th!)
  in the sub register — `'sparse-sub'` and `'pickup-sync'` both do it.
- **Groove-via-offset** (Kerri Chandler analysis,
  https://www.attackmagazine.com/technique/passing-notes/kerri-chandler-chords/, medium-high):
  occasionally delay the bass root a 16th behind the chord stab — syncopated tension a
  quantized-together generator never produces.
- **DnB**: sparse sub layer (roots/octaves/5ths "with breathing space") + a *separate* mid bass
  carrying the movement (https://www.dogsonacid.com/threads/writing-basslines.797961/, medium —
  forum consensus); Reese interest is timbral, not melodic
  (https://www.thedystopiancollective.com/tutorials-2/how-to-create-reese-bass-the-complete-guide-to-the-iconic-drum-amp-bass-sound).

### C.3 Melody: motif algebra, not note streams

- **Contour**: "good melodies often have a single peak note... the highest pitch occurs only
  once," on a strong beat, roughly at the phrase midpoint, arc up then down
  (https://makingmusic.ableton.com/creating-melodies-1-contour — Ableton's own guide; high,
  consensus). No current lead archetype has any cross-bar contour at all — every bar is an
  independent draw.
- **Motif economy** (https://www.edmprod.com/advanced-melodies-chord-tones-motifs/, medium — one
  author, concrete): max 2-3 distinct rhythm cells per melody; **60-80% stepwise motion**; three
  repetition types (exact / same-rhythm-new-pitches / same-contour-transposed). Plus the standard
  non-chord-tone rule: chord tones on strong beats, NCTs as passing/neighbor notes on weak
  subdivisions resolving quickly by step (high — standard theory restated for EDM).
- **Call-and-response** (https://www.edmprod.com/using-call-and-response/,
  https://basicwavez.com/8-tips-for-writing-catchy-melodies-edm-production/, medium-high): 4-bar
  unit = 2-bar call + gap + 1-bar response; "the call ends higher, the answer ends lower, like a
  question and answer"; differentiate response by register, keep the anchor tones. The current
  `'call-response'` archetype inverts contour but has no ending-pitch rule, no gap, no 8-bar
  period.
- **8-bar law + one-change-per-repeat**: dance music moves in 8-bar phrases; successful tracks
  change one element every 8-16 bars while holding the core (https://edmtips.com/edm-song-structure/,
  https://www.adsrsounds.com/arrangement-tutorials/track-structure-production-basics-2/; high,
  consensus). **Rhythmic displacement** — shift the pattern by an 8th/16th without changing
  pitches — is a pitch-free variation operator
  (https://www.sweetwater.com/insync/expand-your-backbeats-rhythmic-displacement-polyrhythm-syncopation/;
  high for the technique). Note dotbeat's phrases are 4 bars because the showdown clip is 4 bars —
  the *tension curve across 8/16* only matters once composition feeds full tracks, which is
  exactly the Sandstorm-shaped goal.
- A sourced-ingredient 16-bar tension template (speculative as a formula, each ingredient
  sourced): bars 1-4 state the motif low; 5-8 repeat with one change; 9-12 transpose up, place
  the single peak; 13-16 descend and cadence, densifying into the transition.

### C.4 Voice-leading and mode color: cheap deterministic optimizations

- **The consensus voice-leading kernel** (https://www.musicradar.com/news/smoother-chord-progressions-voice-leading,
  https://online.berklee.edu/takenote/voice-leading-paradigms-for-harmony-in-music-composition/;
  high): keep common tones in the same voice; move other voices by step, never more than a 3rd;
  choose inversions by **minimizing total semitone motion** — a ~20-line cost function replacing
  the current uniform draw over five root-position voicing shapes.
- **Register separation**: don't play the chord root in the pad if a sub-bass holds it; keep the
  pad's top voice nearly stationary so it "hovers" (Myloops; medium-high). Deep-house voicing
  color: m7/m9/m11, third-inversion 7ths common, **omit the 5th**, replace with 9/11/13 (Kerri
  Chandler analysis, Attack; high for the style). And the genre exception that keeps rules
  honest: parallel planing is *correct* for techno stabs and Chandler-style house — classical
  anti-parallel rules apply only to sustained pad writing (medium).
- **Mode as a one-parameter genre colorizer**: Phrygian → melodic techno / tech house / psytrance
  (multi-source: https://www.sonicacademy.com/courses/tech-tips-volume-94/tutorial-936-phrygian-mode,
  https://www.f9-audio.com/en-us/blogs/tutorials/do-you-know-this-trick-for-tech-melodic-house-melodies-phrygian-house,
  https://outerverse.fm/blogs/tutorials/understanding-scales-modes-in-psytrance; high), with the
  b2 as the featured neighbor tone; Dorian → house/deep house (https://unison.audio/dorian-mode/;
  medium, softer consensus); harmonic-minor V for trance cadences (medium). The current key
  model is strictly major/natural-minor (`scalePitchClasses`) — two modes short of the genre
  palette.

### C.5 Algorithmic traditions and what commercial assistants actually implement

The non-ML literature already contains dotbeat's architecture, twice over (all high):

- **Constraint solving**: Strasheela — "the user declaratively states a music theory and the
  computer generates music which complies" (https://strasheela.sourceforge.net/strasheela/doc/Publications.html);
  **Anton** does harmony+melody via a small answer-set-programming rule set *and diagnoses errors
  in human compositions* (https://arxiv.org/abs/1006.4948) — that diagnosis mode is literally
  research/121's "detector-per-complaint" applied to notes: the same rules that generate can lint.
- **Grammars**: Impro-Visor generates jazz solos from probabilistic grammars over chord changes,
  with grammars *machine-learned from transcription corpora*
  (http://ai.stanford.edu/~kdtang/papers/cmj10-jazzgrammar.pdf); the transferable idea is
  terminals as **chord-tone/color-tone/approach-tone categories, not absolute pitches**.
- **Species counterpoint** is solved-by-search with tiny open repos
  (https://github.com/topics/species-counterpoint, rules at
  https://openmusictheory.github.io/firstSpecies.html) — evidence that rule-set + search is
  tractable at dotbeat's scale, not that Fux belongs in techno.
- **Euclidean rhythms** (Toussaint, https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf):
  E(k,n) onset patterns reproduce 40+ traditional timelines — a one-function rhythm generator for
  percussion and bass onsets.
- **What the commercial category ships** (high, from docs/reviews): Ableton Live 12's MIDI
  generators are explicitly non-ML — Seed (scale-constrained random), **Shape (notes fitted to a
  drawn contour — §C.3's contour rule operationalized)**, Stacks, Euclidean
  (https://www.soundonsound.com/techniques/ableton-live-12-midi-generators). Logic's Session
  Players all follow a global **chord track** — one harmonic source of truth every generator
  consumes (https://support.apple.com/guide/logicpro/chords-and-session-players-lgcp70dd5af3/mac).
  Scaler 2's "Voice Grouping" is voice-leading-as-a-toggle
  (https://www.soundonsound.com/reviews/plugin-boutique-scaler-2); Captain Chords is progression
  bank + genre rhythm templates + root-following bass + chord-tone melody
  (https://mixedinkey.com/captain-plugins/captain-chords/). **The commercial state of the art is
  dotbeat's archetype system plus the craft rules of C.1-C.4 — there is no ML moat in this
  category.** That is very good news for a deterministic `beat compose`.

### C.6 Corpus mining: generalize the Sandstorm move, mind the provenance

The Sandstorm process (research/121 §1.2: activity matrix → per-voice extraction → chord-safe
substitution) is one-song corpus mining; `python/midi_extract.py` already generalizes the
extraction half. Scaling it into a *figure-statistics* source:

- **Hooktheory is the cleanest corpus**: crowd-transcribed key-relative *analyses* (melody +
  chords + mode), 18.8k annotated sections in the Lead Sheet Dataset, ~38k melody-chord pairs in
  the newer dataset (https://www.emergentmind.com/topics/hooktheory-dataset,
  https://arxiv.org/pdf/2212.01884) — user analyses rather than ripped MIDI, and already in the
  right representation (Roman-numeral-relative) for progression/figure statistics. (High.)
- **Lakh** (https://colinraffel.com/projects/lmd/): the compilation is labeled CC-BY-4.0 but the
  files are largely unattributed transcriptions of copyrighted songs — fine for private
  statistics, murky for shippable figure banks. **GigaMIDI**
  (https://transactions.ismir.net/articles/10.5334/tismir.203) is 1.4M+ files under an explicit
  research-only/fair-dealing posture — same conclusion — though its expressiveness heuristics
  (DNVR/NOMML) can filter *programmed* EDM-style tracks from performed ones, useful for mining
  the right sub-corpus. (High.) This lands exactly on the D25 posture: mined figures = private
  eval-side data, kind-only in the shared log, never committed.
- **Pattern discovery**: Meredith's SIA/SIATEC/COSIATEC gives a compressed figure dictionary per
  piece (https://www.researchgate.net/publication/30815279_Point-set_algorithms_for_pattern_discovery_and_pattern_matching_in_music),
  but the pragmatic 90% for 4-bar loop material is **skyline melody extraction + key-normalized
  interval n-grams** (speculative as a judgment; the algorithms are high).

### C.7 Recommendation: the `beat compose` shape

Synthesis (medium — design proposal, not a published result). A deterministic, theory-aware
composition layer, built as three small pieces that slot into machinery that already exists:

1. **A chord-track source of truth** (the Logic lesson). Progressions drawn from a *weighted,
   function-tagged* bank (Trends-informed frequencies; tags like breakdown-bed / pre-drop-rise;
   1-2 bars per chord; position-conditional v→V or bVII cadence substitution; optional planing
   mode for techno; mode parameter incl. Phrygian/Dorian). Everything downstream — bass, chords,
   lead — consumes this one object plus the kick pattern.
2. **Theory-aware figure generators** replacing per-note uniform draws inside the existing
   archetype banks: bass = kick-relationship template × 1-3-pitch-class set × gate/velocity/swing
   numbers (the Myloops and Stussy recipes verbatim as named archetypes, register rule enforced);
   chords = voicing chosen by the minimal-motion cost function, register-separated from the sub,
   style voicings (Chandler m9/omit-5) as options; lead = motif-first — generate one 1-2-bar
   motif (2-3 rhythm cells, 60-80% stepwise, chord tones on strong beats), then *derive* the
   phrase by operators.
3. **Motif-variation operators as a library**: transpose-to-next-chord, same-rhythm-new-pitches,
   contour-inversion with call-high/answer-low endings, rhythmic displacement, one-change-per-
   repeat scheduling, peak-note placement across the phrase, Euclidean onset patterns for
   percussion/bass. These double as `vary`-style edits on *existing* material — which is also
   the fallback co-writer if no Part A model is adopted.

Plus two optional arms: **corpus mining** (extend `midi_extract.py` from extract-one-part to
mine-figure-statistics over the private MIDI dir + Hooktheory-derived progression tables —
eval-side private per D25), and **one Part A model as a fifth source** (AMT or CA2 generating
figures over the same chord track).

**Validation is already built.** Each generator lands as a new figure source in the showdown
pipeline exactly as `gen`/`surge` did (`docs/source-showdown-eval.md`): same seed, same synth
patch, `composed-v2` vs `archetype` vs `midi` figures, blind, per-role. The D25 commercial-MIDI
arm is the perfect ceiling control — it held composition at commercial quality; the question
"does theory-aware generation close the gap between archetype figures and commercial figures?"
is one batch series away, and D27's north star (a blind win over a ref) is the graduation
criterion. Cheap pre-render lint from Part B: scale consistency, register-rule violations,
groove consistency — gross-error gates only, in the research/121 division of labor.

---

## Honest gaps

- **Nothing here was run.** No model was downloaded, no MPS inference tested, no license file
  read end-to-end; license and weights claims are from model cards/repos as fetched (flagged
  high only where the card was read directly). AMT-on-MPS and CA2-detached-from-REAPER are both
  "should work" (medium), not "worked."
- **Quality evidence for every Part A model is thin by construction** — that is Part B's whole
  finding. Nobody has published a head-to-head of AMT vs CA2 vs MIDI-RWKV vs an LLM on human
  preference, and *none* of the evaluation literature covers electronic-music figures
  specifically (it's piano continuation, chorales, and pop lead sheets). The first real evidence
  for dotbeat's genres will be the owner's own showdown batches.
- **Genre mismatch risk**: AMT is trained on Lakh (pop/rock/piano-heavy), Aria on solo piano,
  ChatMusician/MuPT on folk-flavored ABC. Whether any of them writes a credible rolling techno
  bassline is unknown — and plausibly the deterministic Part C recipes beat them all in-genre.
  (Speculative, testable in one batch series.)
- **Single-author craft recipes**: the most implementable numbers (Stussy pattern, Myloops
  envelope times, swing 56-58%) are one producer's codification — tunable defaults, not measured
  consensus. Hooktheory Trends numbers were partly read from secondary snapshots (the 1300-songs
  page 403'd on direct fetch).
- **Part C's rules are loop-scale.** Tension curves across a full arrangement (the "everything
  on all the time" lesson of research/121) are stated as a template here but unvalidated; the
  8/16-bar phrase machinery only pays off when composition feeds whole tracks, not 4-bar
  showdown clips.
- **Licensing was assessed from labels, not law**: Lakh's CC-BY-vs-underlying-works tension and
  GigaMIDI's fair-dealing posture are community consensus readings, not legal advice; the D25
  private-eval posture sidesteps this for now.
- Web passes were single-agent and not adversarially verified; 2025-2026 material (MIDI-RWKV,
  Moonbeam, Music Arena, the survey papers) is newest and least cross-checked.
