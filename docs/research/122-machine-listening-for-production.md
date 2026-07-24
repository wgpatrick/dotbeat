# Research 122 — Machine listening for production: giving the agent producer better ears

*Web + codebase research pass, 2026-07-24. Single-agent, not adversarially verified; confidence
labels inline (high / medium / low / speculative). Companion docs: `docs/taste-loop-design.md`
(the critic program and the CLAP-retirement lesson), `docs/research/107-taste-model-program.md`
§4 (embedding evidence base), `docs/research/surge-right-ear-ring-rootcause.md` (the ring case),
`docs/research/120-high-quality-eval-refs.md` (negative-control audio pool). Doc 121
(dynamics-from-source harness) is referenced by the owner as in-flight; cross-links below are by
name and should be firmed up once it lands.*

## Headline

dotbeat's ears today are deterministic DSP (`src/metrics`: LUFS/true-peak/crest, five-band
spectrum, centroid, stereo width/correlation, per-section slicing, render-run variance floors, a
narrow-peak `ringDb` detector) plus Audiobox-Aesthetics as the best learned scorer. They catch
loudness, width, air, and ring — and **missed two owner-flagged failures**: a "grindy/noisy" bass
patch (resonance+drive intermodulation, no roughness metric existed) and arrangement flatness
("everything on all the time" — per-section metrics existed but nothing *flagged* flatness).

The organizing move of this doc: dotbeat now owns a small, owner-labeled benchmark — matched
pre/post-fix audio for both misses, a reproducible ring case, and 160+ blind-ranked batch entries
— so every candidate "ear" can be scored on one question: **does it hear what the owner heard?**
Design that benchmark first (§2), then buy/build only what passes.

Three structural findings from the survey:

1. **Audio-native LLMs are now plausible mix critics but the published evidence for
   production-quality critique is thin** — benchmarks measure music QA/captioning/temporal
   grounding, not "is this bass grindy." Anecdotal evidence (Gemini flagging low-mid masking on
   real mixes) is encouraging; nothing peer-reviewed measures critique *accuracy*. (§3.4)
2. **Every audio-LLM candidate is effectively a mono, band-limited listener** (Gemini: audio
   "downsampled to 16 Kbps", "multi-channel combined to single channel" per its own docs; the
   Whisper-lineage encoders in the open models are 16 kHz mono). Stereo width, the right-ear ring
   localization, and the 8-16 kHz air band are *physically invisible* to them. Division of labor
   is therefore forced: DSP keeps owning width/air/ring/loudness; LLM ears add semantics
   (grind, mud, arrangement, "does the drop hit"). (§3.1, high confidence for Gemini, medium for
   the others)
3. **The specific "grindy" miss has a 30-year-old psychoacoustics literature with maintained
   open-source implementations** — auditory roughness (Daniel & Weber 1997; Sethares/Vassilakis
   spectral-peak dissonance) in MoSQITo, Essentia, and AudioCommons `timbral_models` — free,
   local, and directly testable against the labeled pair before any API is bought. (§4.1)

Benchmark-first plan (§7): (1) local roughness/dissonance stack vs the grind pair, (2) Gemini
Flash time-stamped critique vs all four case families (free tier exists; needs a GEMINI_API_KEY
signup), (3) MOSS-Music-8B-Thinking (Apache-2.0, timestamped structure output) if a GPU path is
cheap enough — plus a ~50-line arrangement-flatness lint that needs no research at all.

---

## 1. What the current ears catch, and exactly what they missed

**Catch (verified in repo):** loudness/true peak (`analyze.ts`), five-band balance + centroid,
stereo width/correlation, per-section energy arc (`sections.ts`, when invoked with section
specs), narrow 4-14 kHz tonal ring (`ring.ts`, the detector that root-caused the surgepy stride
bug), all padded by measured render-run variance (`variance.ts`). Audiobox-Aesthetics
(CC-BY-4.0, four axes trained on human ratings —
https://github.com/facebookresearch/audiobox-aesthetics) is the strongest learned scorer on the
taste log: `dsp+aes-bt` 36% top-1 / 65% pairwise at n=66, aes alone 81% pairwise on showdown
batches (taste-loop-design.md T2 status).

**Miss 1 — "grindy/noisy" bass** (`~/Documents/dotbeat/taste-dataset/covers/solo-bass-stabs.wav`,
owner: bass at ~1:11-1:16 "grindy/noisy"). Post-hoc DSP said: crest 9.6 (flattest stem), 96% of
energy <250 Hz, centroid 77 Hz — drive/resonance intermodulation on an E1 square+sub with no
pitch definition. No existing metric maps to "grind": crest and band shares are necessary-not-
sufficient, and nothing measures *roughness* (fast amplitude-modulation beating from closely
spaced partials — the psychoacoustic correlate of "gritty/grindy", §4.1). The fix
(resonance 1.1→0.5, saturator 0.30/0.35→0.12/0.15, subLevel 0.5→0.45) is captured in
`solo-bs2.beat`, giving a **matched A/B pair differing only in the offending patch params**
(verified by diffing the two .beat files).

**Miss 2 — arrangement flatness** (`covers/sandstorm-serious.wav`, owner: "everything on all the
time"). Sobering detail from the build notes (`taste-dataset/covers/NOTES.md`): the pipeline HAD
measured it — pass 2 recorded "per-8-bar rms nearly flat from groove to drop (−15.2 → −12.7,
adjacent contrasts 1-2 dB)" — but no lint rule turned that number into a flag. This miss is an
**integration gap, not a research gap**: `sections.ts` computes per-section LUFS already, the
.beat file knows the section map, and the post-fix render (`sandstorm-serious-final.wav`) shows
what pass looks like (gap→drop step 11.8 dB, groove→strip 8.5 dB). High confidence.

**Also relevant:** the ring case was caught *by building a bespoke detector after the owner
complained* — the pattern this doc wants to break. The owner heard it first; the machine
confirmed. Better ears = machine hears it first.

## 2. The benchmark: "does it hear what the owner heard?"

The asset: owner-labeled failure cases with matched fixed versions, plus a large blind-ranked
preference log. Any candidate listener — DSP metric, psychoacoustic model, LLM, embedding — gets
scored the same way. This is the same discipline that retired CLAP: the n=37 pre-bugfix reading
said "embeddings unlock gen taste"; the eval harness at n=66 said CLAP was *below chance* and
actively misleading (taste-loop-design.md T2). No candidate ear gets adopted on vibes.

### Test cases

| id | case | fail clip | pass clip | pass criterion |
|---|---|---|---|---|
| G1 | grindy bass | `covers/solo-bass-stabs.wav` (res 1.1, sat 0.30) | `covers/solo-bs2.wav` (res 0.5, sat 0.12) | flags roughness/distortion/harshness on fail clip AND rates pass clip cleaner (directional discrimination, not just criticism) |
| G2 | grind in context | `covers/sandstorm-serious.wav` strip section (~1:11-1:16) | `covers/sandstorm-serious-final.wav` same section | localizes the issue to the bass **and to roughly the right time window** in a full mix |
| R1 | narrow HF ring (solved control) | pre-fix surge renders — regenerate via the buggy `getOutput()` path with `scripts/debug-surge-ring.py` | post-fix `processMultiBlock` renders (e.g. `covers/surge-candidates/*`) | flags a narrow high-frequency tonal ring on pre-fix only. `ringDb` already passes this — it calibrates candidates against a case with a known answer |
| A1 | arrangement flatness | `covers/sandstorm-serious.wav` (full, adjacent-section contrast 1-2 dB) | `covers/sandstorm-serious-final.wav` (gap→drop 11.8 dB) | describes the fail mix as static/flat/undifferentiated AND the pass mix as having a dynamic arc; bonus: section observations that line up with the known bar map |
| T1 | taste replay (held-out) | — | — | candidate's quality score, applied to `examples/taste-t1` batch variants, predicts owner picks above the 50% pairwise floor; reference bar: dsp+aes-bt = 65%, aes-on-showdown = 81% |
| N1 | negative controls | — | commercial-grade loops from the doc-120 ref pool + `sandstorm-serious-final.wav` | does NOT rate controls as bad as fail clips. Guards the known LLM failure of criticizing everything (§3.4) |

Pass for a candidate = G1 + (G2 or A1, whichever family it targets) + N1, with T1 as the
generalization tiebreaker. A tool that only ever says "add sidechain compression and cut mud" will
pass nothing, which is the point.

### Contamination cautions (all load-bearing)

- **The answers are written down in this repo.** NOTES.md, this doc, and the surge doc contain the
  labels and even the fixes. Never paste them — or any owner language ("grindy") — into a
  candidate's prompt. Run blind, grade after. Prompts may describe the *task* ("critique this mix
  as a mastering engineer; list issues with timestamps, severities, and frequency ranges"), never
  the expected finding.
- **Neutral filenames.** Filenames enter LLM context; upload as `case-01.wav` etc., not
  `solo-bass-stabs.wav`.
- **Recognized-song priors.** The A1 mixes are a Sandstorm cover; frontier models have certainly
  seen commentary on the original. A model may "critique" from song recognition rather than
  listening. Mitigation: stems (G1) are unrecognizable; for A1, also test a pitch-shifted/
  tempo-shifted copy and check the critique survives. Medium confidence this matters, cheap to
  control.
- **Prompt-tuning leakage.** Iterating prompts against the same four cases then reporting
  pass-rate is self-deception. Rule: tune freely on G1 only; freeze the prompt; run G2/R1/A1/T1/N1
  once. (T1 additionally inherits the taste-eval held-out protocol.)
- **LLM nondeterminism.** Run each case 3×; a finding counts only if it appears in ≥2 runs.
- **Private data.** Everything under `~/Documents/dotbeat/taste-dataset/` is midi-derived/private
  (NOTES.md header) — sending clips to a paid API is the owner's call to make explicitly per
  provider ToS; nothing goes into training-data-opt-in endpoints. The doc-120 ref-pool licensing
  analysis applies to N1 controls.

## 3. Audio-native LLMs as production critics

### 3.1 Gemini (the strongest hosted candidate)

Per Google's audio docs (https://ai.google.dev/gemini-api/docs/audio, fetched 2026-07-24; high
confidence, primary source):

- Native audio input: WAV/MP3/AIFF/AAC/OGG/FLAC; up to **9.5 hours per prompt**; inline ≤20 MB,
  Files API above that.
- **32 tokens per second of audio** (1 min = 1,920 tokens).
- **Timestamps: supported and prompt-addressable** ("MM:SS" format; you must ask for them). So
  "harsh distortion at 1:16"-style critique is *representable*. Accuracy caveat: community
  reports say returned timestamps land "within a few seconds" and that start/end trimming
  references are sometimes ignored on 2.5-era models
  (https://discuss.ai.google.dev/t/gemini-2-5-timestamp-references-for-start-and-end-in-the-prompt-are-being-ignored/82375;
  medium confidence). Seconds-level slack is fine for section-level critique, marginal for
  bar-level.
- **The band-limit/mono caveat (the big one):** the docs state audio is "downsampled to 16 Kbps"
  and "multi-channel audio combined to single channel." Practical reading (medium-high
  confidence): Gemini cannot hear stereo width at all, and content above ~8 kHz is degraded or
  gone. The 4.6 kHz ring tone survives the downsample but its hard-right panning — the cue the
  owner actually reported — does not. Width (−11 dB commercial vs −52 dB raw-engine, the repo's
  own produced-loudness signature) and the air band stay DSP-only territory.
- Pricing (https://ai.google.dev/gemini-api/docs/pricing, fetched 2026-07-24): audio input on
  Gemini 2.5 Flash **$1.00/1M tokens** → **~$0.002 per analyzed minute**; current-gen 3.x Flash
  ~$1.50/1M (no separate audio rate listed) → ~$0.003/min; output $2.50-9.00/1M (a 500-token
  critique ≈ $0.001-0.005). A full benchmark run over every case above costs **well under $1**.
  **Free tier exists** for Flash models — the benchmark can be run for $0.
- Anecdotal mix-critique evidence: a producer test
  (https://www.undergroundwave.life/post/ai-starts-listening-testing-gemini-as-a-mixing-tool-for-music-producers)
  found Gemini flagged "frequency masking in the low mids," a "dense buildup between roughly
  200 Hz and 1 kHz," and lack of low-end transient definition on a real bedroom mix — judged
  legitimate by the author — but it *also suggested improvements on a professionally mixed pop
  record*, i.e., it criticizes unconditionally (hence benchmark case N1). Also gearnews coverage
  of Gemini track feedback (https://www.gearnews.com/google-gemini-music-tech/). Low-medium
  confidence (blog anecdotes), but it is the only direct mix-critique evidence found for any
  model.

Not in the owner's env today: any GOOGLE/GEMINI key. Signup: Google AI Studio → `GEMINI_API_KEY`.

### 3.2 GPT-4o-audio and OpenAI

`gpt-4o-audio-preview` accepts audio in chat completions; audio input priced ~$40/1M audio tokens
(2024-12-17 version), working out to roughly **$1.55/hour ≈ $0.026/min** — ~10× Gemini
(https://developers.openai.com/api/docs/models/gpt-4o-audio-preview;
https://clemenssiebler.com/posts/azure-openai-gpt4o-audio-api-cost-analysis/; medium confidence
on the per-minute conversion). Published probing of 4o voice mode found it strong at detecting
music/speech/sfx but weak at pitch classification and even *audio duration estimation*
(https://arxiv.org/pdf/2502.09940) — duration-blindness bodes poorly for time-stamped critique.
No evidence found of mix-quality critique ability; input length limits are far tighter than
Gemini's. Verdict: second-line candidate; benchmark only if Gemini disappoints.

### 3.3 Open audio-LLMs

- **MOSS-Music-8B-Thinking** (owner-suggested;
  https://huggingface.co/OpenMOSS-Team/MOSS-Music-8B-Thinking) — ~9.1B: custom MOSS-Audio-Encoder
  with DeepStack cross-layer feature injection (explicitly aimed at preserving rhythm/timbre/
  transient detail) + Qwen3-8B backbone. **Apache-2.0 — the only license-clean model in this
  class** (vs Flamingo/MERT/MuQ noncommercial). **Timestamped outputs are first-class**:
  word-level lyric ASR, temporal chord ID, and structural segmentation
  (intro/verse/chorus/bridge/outro) — directly the shape needed for "grindy at 1:16" and for the
  A1 arrangement case, and a second harness use: automatic section maps of *reference tracks*
  for the doc-121 dynamics-from-source plan. Benchmarks (model card): 80.4% avg across 8 music-QA
  benchmarks (best tested), captioning 4.53/5 MusicCaps, lyric ASR beating Gemini-3.1-Pro.
  Honest caveats: card documents **no production/mix-quality analysis capability** — analytical
  (chords/structure/lyrics), not critical; whether its encoder even represents "grind" is exactly
  what G1 tests. Tooling is GPU-first (CUDA, SGLang/Gradio, Python 3.12, BF16 ≈ ~18 GB weights);
  Mac/MPS unmentioned and `trust_remote_code` custom stacks frequently break on MPS — assume a
  rented GPU (~$1-2/hr on a 24-48 GB card) or a Modal/Replicate-style deploy; no hosted endpoint
  found as of 2026-07-24. Medium confidence on all card claims (single source, not yet
  independently benchmarked for critique).
- **NVIDIA Music Flamingo** (owner-suggested;
  https://huggingface.co/nvidia/music-flamingo-2601-hf, paper
  https://arxiv.org/abs/2511.10289, project pages https://musicflamingo-nv-umd.github.io/ and
  https://research.nvidia.com/labs/adlr/MF/) — 8B AF-Whisper encoder + Qwen2.5-7B; SOTA-at-release
  on 10+ music understanding/reasoning benchmarks; up to 20-minute inputs processed in 30 s
  windows (whole-song comprehension — relevant to A1). **Its production-vocabulary case is the
  strongest of the open models**: the MF-Skills training pipeline explicitly labels
  "instrumentation, timbre, structural segmentation, harmonic analysis, **mix details, and
  dynamics**," QA includes "**mix decisions**," and project-page demo captions discuss mixing and
  mastering character ("crisp hi-hats," "clean, wide stereo-spread textures," "polished mastering
  chain emphasizing clarity and punch") — the closest any surveyed model card comes to
  mix-critique language (medium confidence; project-page demos are curated). Two honesty flags on
  exactly that evidence: (a) a Whisper-lineage encoder is 16 kHz mono (high confidence), so
  "wide stereo-spread" in a caption cannot be a measurement — it reads as a language-prior
  inference from genre, i.e., the model may *talk* production fluently without *hearing* it
  (precisely what G1/N1 discriminate); (b) robustness across mixing/mastering differences is
  explicitly noted as not fully tested. Remaining caveats: **NVIDIA OneWay Noncommercial
  license** (personal-use tier, like MERT), A100-class hardware expectations, **no timestamps
  documented**, and no NIM / hosted API found (HF card states none; search found none as of
  2026-07-24 — low confidence it stays that way, NVIDIA does eventually NIM-ify flagship models).
  Rank: below MOSS on license/timestamps/hosting, above it on documented production vocabulary —
  if a hosted endpoint appears, it jumps to the #3 benchmark slot.
- **Qwen2.5-Omni-7B / Qwen3.5-Omni** (https://github.com/QwenLM/Qwen2.5-Omni) — leads the MMAU
  music subset (~0.69; https://llm-stats.com/benchmarks/mmau-music); Apache-2.0; hosted
  inference exists on Replicate (https://replicate.com/lucataco/qwen2.5-omni-7b). Generalist,
  no music-production specialization; cheap third-line candidate.

### 3.4 The honest read on evidence for "production critique"

What the benchmark literature actually measures: multiple-choice music QA (MMAU; MMAR —
https://github.com/ddlBoJack/MMAR), music perception broadly ("Music I Care About,"
https://arxiv.org/abs/2607.06015 — notes Gemini 3.1 Pro performs well), temporal grounding
(MusTBENCH, https://arxiv.org/pdf/2605.29300), captioning quality, and MOS *prediction* of
generated music (AudioMOS Challenge 2025 / MusicEval;
https://arxiv.org/pdf/2504.21815). **No published benchmark was found that measures whether an
audio LLM can accurately critique mix/production quality** (masking, harshness, dynamics,
arrangement) against engineer ground truth. High confidence in the gap after multiple searches.
Two corollaries: (a) any adoption decision rests on dotbeat's own benchmark — which is fine,
that's what §2 is for; (b) the known failure mode is *unconditional critique* (§3.1's pro-mix
anecdote): these models are trained to be helpful, and "give feedback" elicits feedback whether
or not problems exist. N1 and directional pass criteria (fail-vs-fixed discrimination) exist
precisely because of this.

## 4. Music-understanding and psychoacoustic models (the non-LLM candidates)

### 4.1 Roughness / sensory dissonance — the "grindy" detector (best research fit of the doc)

"Grindy/gritty/harsh" has a real psychoacoustic correlate: **auditory roughness** — rapid
(~15-300 Hz) beating between closely spaced partials within a critical band, exactly what
resonance+saturation intermodulation on a low square+sub produces. Established models and
maintained implementations:

- **Daniel & Weber (1997)** modulation-based roughness — implemented in **MoSQITo**
  (https://github.com/Eomys/MoSQITo), an open-source (Apache-2.0) Python sound-quality-metrics
  toolbox used in industrial acoustics, validated against reference signals; computes
  **time-varying roughness** (asper) — i.e., a roughness-vs-time curve that could localize "grind
  at 1:11-1:16" with zero ML. Note from the ECMA-418-2 literature: Daniel-Weber does great on
  synthetic signals, less robust on complex ones
  (https://www.researchgate.net/publication/383983056_ECMA-418-2_roughness_a_challenging_implementation)
  — MoSQITo also carries the newer ECMA-418-2 hearing-model implementations. High confidence on
  availability; medium on fit to musical bass (that's G1's job).
- **Sethares / Vassilakis spectral-peak dissonance** (Plomp-Levelt curves;
  http://www.acousticslab.org/learnmoresra/moremodel.html) — implemented as Essentia's
  `Dissonance` descriptor (https://essentia.upf.edu — `lowlevel.dissonance.mean/stdev`;
  https://github.com/MTG/essentia/blob/master/src/algorithms/tonal/dissonance.cpp). Essentia is
  AGPL-3.0 — fine for local personal analysis, flag before ever shipping. An essentia.js build
  exists (https://mtg.github.io/essentia.js/docs/api/Essentia.html) — could run inside the
  Node/TS metrics pipeline directly. Also `dissonant`, a small MIT Python package of the same
  model family (https://github.com/bzamecnik/dissonant).
- **AudioCommons `timbral_models`** (https://github.com/AudioCommons/timbral_models, U. Surrey
  IoSR; pip-installable) — regression models predicting eight perceptual attributes including
  **roughness, hardness, brightness, warmth, boominess, sharpness, depth, reverb** from audio.
  Trained/validated largely on Freesound SFX-style content (medium relevance to synth bass), but
  the attribute vocabulary maps almost 1:1 onto owner language, which matters for critique
  legibility.
- Cheap in-house complement (no external dep): per-band **spectral flatness / harmonic-to-noise
  ratio in the bass band**. The grindy stem's own numbers (96% energy <250 Hz, "no pitch
  definition") suggest tonalness-in-bass is discriminative; ~50 lines against the existing FFT in
  `analyze.ts`. Speculative until measured against G1, but free.

### 4.2 Arrangement / structure — the "flatness" detector

- **Zero-research fix first:** a lint rule over the existing `sections.ts` output — full-song
  render, section map from the .beat file, flag when adjacent-section LUFS contrasts stay within
  ~2-3 dB across the whole arrangement (padded by `RENDER_RUN_VARIANCE_LU`) and when no section
  pair spans ≥ ~6 dB. The A1 pair's measured numbers (1-2 dB adjacent everywhere → fail;
  11.8 dB gap→drop → pass) already define sensible thresholds. High confidence; this is the
  single cheapest item in the whole doc.
- **For external/reference audio without a section map:** **All-In-One Music Structure Analyzer**
  (`allin1`, Kim & Nam WASPAA 2023 — https://pypi.org/project/allin1,
  https://arxiv.org/abs/2311.18604): tempo, beats, downbeats, functional section boundaries +
  labels (intro/verse/chorus/…) in one local model. Feeds two consumers: A1-style critique of
  arbitrary mixes, and automatic reference section maps for the doc-121 dynamics-from-source
  harness. Install caveat: depends on Demucs + NATTEN (NATTEN wheels on macOS can be painful;
  medium confidence). MSAF (https://github.com/urinieto/msaf) is the older classical framework.
  MOSS-Music (§3.3) is the LLM route to the same output.

### 4.3 Whole-track aesthetic scorers (Audiobox's competition)

- **SongEval toolkit** (ASLP-lab, https://github.com/ASLP-lab/SongEval, dataset+paper
  https://arxiv.org/abs/2505.10793): trained on 2,399 full songs × 16 professional annotators
  across five dimensions — including **clarity of song structure** and overall
  coherence/musicality — i.e., the first learned scorer with an *arrangement-shaped* axis
  (Audiobox's four axes are clip-level; its Production Quality axis is the current best scorer
  but hears no structure). ICASSP 2026 ran a challenge on it
  (https://arxiv.org/pdf/2601.07237), so tooling is active. License: repo license not confirmed
  in this pass — check before integrating (low confidence). Song-oriented (vocals-heavy
  training data) — transfer to instrumental EDM covers is untested; T1/A1 would measure it.
- **Audiobox-Aesthetics** stays the incumbent: already integrated, already the best measured
  scorer on the owner's log, CC-BY-4.0.

### 4.4 Captioners (LP-MusicCaps lineage) — skip for critique

LP-MusicCaps (https://arxiv.org/abs/2307.16372, https://github.com/seungheondoh/lp-music-caps),
MusiLingo, LLark (https://arxiv.org/abs/2310.07160) established audio→text music description, and
they are what audio-LLMs have since subsumed. Their captions describe genre/mood/instrumentation;
no evidence found of production-fault vocabulary. The modern successors ARE §3.3's models.
No published probing of MERT/MuQ representations specifically for production-quality attributes
was found (searched; honest gap) — the closest is MARBLE-task probing, which is genre/tagging/
key-shaped. Low priority.

### 4.5 Commercial mix analyzers

- **RoEx Tonn API** (https://tonn-portal.roexaudio.com/docs/, PyPI `roex-python`): the only
  found *API-first* commercial mix analyzer — mix analysis (loudness, dynamic range, stereo
  field, tonal profile), **mix comparison / reference benchmarking endpoints**, plus AI
  mixing/mastering. Credit-based pricing behind portal signup (numbers not public on the docs
  page; medium confidence). Their free Mix Check Studio
  (https://mixcheckstudio.roexaudio.com/) demonstrates the diagnosis vocabulary (clipping, mud,
  loudness issues). Unknown: per-band/time-stamped granularity of API responses — one benchmark
  credit's worth of G1/A1 runs answers it.
- **iZotope (Neutron masking meter, Ozone Master Assistant), Mastering The Mix (EXPOSE),
  Sonible**: the best-known interactive analyzers, but **no public developer APIs** (high
  confidence for iZotope/MTM after search; they ship as plugins/apps). Useful as vocabulary
  references only. No open-source masking-meter equivalent was found in this pass — inter-stem
  masking analysis (kick-vs-bass overlap per critical band) would be a build, and dotbeat has
  per-stem renders, making it cheaper than for most; parked unless owner flags a masking miss.

## 5. Embedding spaces for music (post-CLAP-retirement)

**Correction to the question as posed:** the assumption "Gemini's embedding API is text-only" is
now outdated. Per https://ai.google.dev/gemini-api/docs/embeddings (fetched 2026-07-24),
**`gemini-embedding-2` is multimodal — text, images, AND audio (max 180 s/input, MP3/WAV) —
mapped into one embedding space**, 128-3,072 dims; audio priced at **$0.00016/second
(~$0.0096/min)**. `gemini-embedding-001` remains text-only. So an audio→embedding path exists at
Google without the audio→LLM→text→embed detour. High confidence on the docs; **zero published
evidence on music-similarity quality** of its audio tower — it must go through the same T1 gate
that killed CLAP.

The CLAP lesson, restated as the selection rule (taste-loop-design.md T2): a *contrastive
retrieval* embedding optimizes for separating semantic content (genre/instrumentation), not
intra-batch production nuance — CLAP scored **below chance** on held-out owner picks and
actively misled at n=37. Candidate embeddings must be either perceptually/aesthetically
supervised or demonstrated on fine-grained similarity, and always eval-gated:

- **MuQ / MuQ-MuLan** (https://arxiv.org/abs/2501.01108) — beats MERT on MARBLE; CC-BY-NC
  weights (personal-use tier). Still retrieval/SSL-flavored; same structural concern as CLAP.
- **MERT** (CC-BY-NC) — untried in the ablation; same caveat.
- **The "aes embedding"**: Audiobox-Aesthetics' penultimate representation as a feature vector —
  the one *perceptually-supervised* embedding already on disk, and the taste-loop doc's own
  suggested direction ("differently-trained, perceptually-supervised"). Speculative but free to
  test in the existing ablation harness.
- **Perceptually-aligned similarity research is moving**: arXiv 2601.19109 (interpretable,
  perceptually-aligned music similarity with pretrained embeddings — already cited in 107) and
  **MAEB, the Massive Audio Embedding Benchmark** (https://arxiv.org/pdf/2602.16008, 2026) —
  MAEB is the right place to shop for the next candidate rather than re-litigating model cards.
  **CLaMP 3** (https://github.com/sanderwood/clamp3, ACL 2025) is the strongest new cross-modal
  music retrieval model — but it is again a retrieval objective; low prior for taste use.
- **What similarity buys the producer harness if an embedding ever passes T1:**
  reference-matching ("make my drop sit like this reference's drop") = minimize
  embedding-distance-to-reference-section as a T6-style search objective; nearest-loved-chop
  retrieval for L2's prior; and duplicate/niche detection in the T5 QD archive. All downstream
  of passing the gate, none a reason to skip it.

## 6. Cost / practicality table

Owner env today: **no GEMINI/GOOGLE key, no OPENAI key noted; FAL_KEY exists (fal.ai)**. Signups
listed per row. Prices fetched 2026-07-24; medium confidence they hold.

| candidate | per analyzed minute | latency | local/API | keys/signup | licenses & notes |
|---|---|---|---|---|---|
| Roughness stack (MoSQITo + Essentia dissonance + timbral_models) | $0 | seconds, local CPU | local (Python; essentia.js option for TS) | none | Apache-2.0 / AGPL-3.0 (flag) / Apache-2.0; time-varying roughness curve = free localization |
| Flatness lint over `sections.ts` | $0 | ~0 (already rendered) | local, in-repo TS | none | ~50 lines; thresholds from the A1 pair |
| `allin1` structure analyzer | $0 | ~tens of seconds/track (CPU; faster GPU) | local Python | none | MIT (medium conf.); NATTEN/Demucs install friction on macOS |
| Gemini 2.5/3.x Flash audio critique | ~$0.002-0.003 input + <$0.005 output | a few seconds | API | Google AI Studio → GEMINI_API_KEY (**free tier: $0 benchmark**) | mono + ~8 kHz ceiling; timestamps prompt-addressable, seconds-accurate |
| gemini-embedding-2 (audio) | ~$0.0096 | seconds | API | same key | 180 s/input cap; unproven for music similarity — T1 gate required |
| GPT-4o-audio | ~$0.026 | seconds | API | OpenAI signup | 10× Gemini price; duration-blindness evidence; second-line |
| MOSS-Music-8B-Thinking | $0 marginal + GPU ~$1-2/hr rented | ~1× realtime-ish on 24-48 GB GPU (est., low conf.) | local-GPU or self-hosted | none (HF download) | **Apache-2.0**; timestamped chords/structure/lyrics; mix-critique ability unproven; Mac/MPS unverified |
| Music Flamingo | GPU-bound as above | 30 s windows, ≤20 min inputs | self-hosted only (no NIM found) | none | **NVIDIA OneWay Noncommercial** — personal-use tier; no timestamps; A100-class expectations; best documented production/mix vocabulary of the open models (unverified by ear) |
| Qwen2.5-Omni-7B (Replicate) | ~cents/run | seconds-minutes cold-start | hosted | Replicate signup | Apache-2.0; generalist; third-line |
| SongEval toolkit | $0 | seconds-minutes local | local Python (GPU helps) | none | license unconfirmed — check; only scorer with a structure axis |
| RoEx Tonn API | credit-based, not public | seconds-minutes | API | RoEx portal signup | only commercial mix-diagnosis API found; granularity unknown — probe with one credit |
| Audiobox-Aesthetics (incumbent) | $0 | seconds | local, integrated | none | CC-BY-4.0; best measured scorer today |

## 7. Recommendation: benchmark first, then wire `beat listen`

**Benchmark these three first** (order = evidence-per-dollar):

1. **Local roughness/dissonance stack** (MoSQITo Daniel-Weber time-varying roughness + Essentia
   dissonance + timbral_models roughness/hardness) against **G1/G2** + N1. Zero cost, one
   afternoon, and it answers the sharpest question in the doc: does the psychoacoustics
   literature's "roughness" coincide with the owner's "grindy"? If yes, dotbeat gains a
   deterministic, time-localized grind detector that slots into `src/metrics` like `ringDb` did.
2. **Gemini Flash (current 3.x, fall back 2.5)** against **all six case families** on the free
   tier, with the §2 blind protocol, asking for structured JSON critique (issues with MM:SS
   spans, severity 1-5, frequency band, plain-language description). It is the only candidate
   that can, in principle, pass G2 *and* A1 *and* produce owner-legible language — and the only
   one with any (anecdotal) mix-critique evidence. Explicitly score its N1 false-positive rate.
3. **MOSS-Music-8B-Thinking** on a rented GPU (or MPS if it happens to run) against **A1 +
   structure-map accuracy on the Sandstorm bar map**, plus G1 as a stretch. Even if it fails
   critique, a pass on structure gives the doc-121 harness its automatic reference section maps
   under a clean Apache-2.0 license — double-duty that Flamingo (license, no timestamps, no
   hosting) can't match. Flamingo: the best documented production vocabulary of the open models
   (MF-Skills labels mix details/dynamics; §3.3) but self-hosting an A100-class noncommercial
   model to *maybe* beat $0.003/min Gemini is poor evidence-per-dollar — revisit immediately if
   NVIDIA ships a NIM/hosted endpoint, and pit it against Gemini on G1/G2/N1 that day.

**Ship regardless of benchmark outcomes:** the arrangement-flatness lint (§4.2) — it re-detects
the A1 miss with code and thresholds that already exist. Not a research question.

**Integration shape — `beat listen`:** a sidecar (same pattern as the surge/aes sidecars) that
takes a render + optional section map and emits structured critique to stdout/JSON:

```json
{ "source": "gemini-3.5-flash | roughness-dw | flatness-lint | moss-music",
  "issues": [ { "start": "1:11", "end": "1:16", "kind": "roughness",
                "severity": 4, "band": "40-250Hz", "track_hint": "bass",
                "detail": "harsh beating/intermodulation on low bass",
                "confidence": 0.7 } ] }
```

One schema across DSP detectors and LLM critics, so the harness (and the taste log) consumes
severity-ranked, time-stamped findings without caring which ear produced them. LLM-sourced
issues carry `confidence` and are advisory-only (the same never-auto-adopt rule as the critic);
DSP-sourced issues can gate like `ringDb` does today. Per-stem mode (dotbeat can render solos
cheaply) turns "track_hint" from a guess into a measurement — run the ear per stem, attribute
findings exactly.

**Local/free vs paid split:** width/air/ring/loudness/flatness/roughness — local, free,
deterministic, gate-capable. Semantic critique (mud/masking language, arrangement narrative,
"does the drop hit") — Gemini Flash at ~$0.005/track-minute, advisory. Embeddings — nothing
adopted until something passes the T1 gate that CLAP failed; gemini-embedding-2 and the aes
embedding are the two candidates worth that eval, at ~$0.01/min and $0 respectively.

## 8. Honest gaps

- **No published eval of LLM production-critique accuracy exists** — the central bet (Gemini can
  critique mixes usefully) rests on blog-grade anecdotes plus dotbeat's own benchmark-to-be.
- Roughness models are validated on industrial/synthetic sounds and isolated timbres, not
  produced synth-bass stems; G1 may fail, and "grindy" may turn out to be roughness + something
  else (noise-like tonalness, transient smear). The benchmark measures this; this doc doesn't.
- The Gemini "16 Kbps / mono" line is the docs' own wording but its exact signal path (sample
  rate vs bitrate, codec) is unspecified — the ≤8 kHz reading is inference (medium confidence).
  A cheap probe: synthesize a 10 kHz tone + hard-panned click and ask Gemini what it hears.
- MOSS/Flamingo mix-critique ability is completely unmeasured anywhere; MOSS Mac feasibility
  unverified; Flamingo hosted availability could change any week.
- SongEval toolkit license and instrumental-EDM transfer unconfirmed.
- RoEx API response granularity (time-stamped? per-band?) and pricing unverified beyond marketing
  copy.
- The benchmark has n=2 owner-flagged failure classes. Passing it means "hears what the owner
  heard *so far*," not "hears everything." Every future owner-flagged miss should be banked into
  the case table the way G1/A1 were — the benchmark is an accumulating asset, and that habit is
  worth more than any single tool choice.
- Doc 121 cross-references are by name; align the section-map interface once that doc lands.
