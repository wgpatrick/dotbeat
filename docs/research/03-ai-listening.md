# Research 03 — AI Listening, Auto-Mix & the render→critique Loop

> Deep-research pass. **119 claims** extracted from **24 sources** across 5 search angles. Verification stage rate-limited mid-run: **1 adversarially verified**, 1 refuted, the rest single-source (quoted but not triangulated).

## Research question

> Research the state of the art (2024–2026) in AI "listening" — machine analysis, critique, and automatic improvement of music mixes and sound design — to spec an AI-feedback subsystem as a core differentiating component of a new open-source DAW (git-diffable text project files, headless CLI rendering, agent/MCP integration; built on web audio + WASM). The vision: the DAW renders what the user (or an AI agent) created, an AI system listens to it, critiques it (mix balance, sound design quality, arrangement energy), makes concrete suggestions mapped to actual project parameters (e.g. "cut 300 Hz mud on the bass", "the lead's attack is masking the kick — shorten it"), and can apply/iterate improvements autonomously. Research questions: (1) AUDIO UNDERSTANDING MODELS: What models can genuinely 'hear' and describe music today — audio-language models (Qwen2-Audio, SALMONN, Gemini 2.x audio input, GPT-4o-audio, Music-understanding LLMs like MU-LLaMA, LTU, Pengi), CLAP-style audio-text embeddings (LAION-CLAP, MS-CLAP, MuQ-MuLan), music captioning/QA benchmarks (MusicCaps, MuChoMusic) — and what are their demonstrated strengths/failure modes on production-quality judgments (not just genre/tags)? Local/open-weights vs API-only, WASM/onnx feasibility. (2) COMPUTATIONAL MIX ANALYSIS & AUTO-MIXING: Research and products for automatic mixing/mastering — academic automix literature (Intelligent Music Production book, De Man/Reiss, differentiable mixing consoles, DeepAFx, ddsp), commercial assistants (iZotope Neutron/Ozone/Nectar, Sonible smart:EQ/smart:comp, LANDR, BandLab mastering, RoEx Automix) — what analysis→action mappings actually work (masking detection, LUFS/dynamics targets, spectral balance references, stereo field analysis)? Which are rule/DSP-based vs learned, and what open implementations exist (essentia, librosa, mixing-secrets datasets, FXNorm, automix repos)? (3) PARAMETER INFERENCE / SOUND MATCHING: Work on inferring synth parameters from audio (InverSynth, FlowSynth, Syntheon, DiffMoog, sound-matching literature; Serum/Vital preset generation with LLMs or genetic algorithms) and neural audio effect modeling — can a system hear a target timbre and propose patch parameters? (4) CRITIQUE/FEEDBACK LOOPS WITH LLM AGENTS: Existing systems where an LLM agent iteratively generates/edits music or audio, renders, listens (via embeddings or audio LLM), and refines — research prototypes, agentic music tools, MCP audio-analysis servers, and what loop architectures (render → analyze → suggest → apply → re-render) have been shown to converge vs hallucinate. (5) SOURCE SEPARATION & STEM ANALYSIS as enablers (Demucs/HT-Demucs quality, real-time feasibility) plus objective metrics usable as ground truth (EBU R128 loudness, true peak, PLR/crest, spectral centroid trajectories, FAD/KAD audio-quality distances, reference-track comparison methodologies). Deliver: a cited report — model/tool comparison tables with licensing and deployment feasibility (local WASM/ONNX vs server vs API), which production-critique tasks are reliably automatable today vs speculative, a recommended architecture for the render→listen→critique→edit loop in this DAW (including using objective DSP metrics as guardrails around LLM judgments), and top risks (audio-LLM hallucination on mix judgments, latency/cost per iteration).

## Sources

- <https://arxiv.org/html/2408.01337v1> — *primary*, 5 claims
- <https://arxiv.org/html/2506.12285v1> — *primary*, 5 claims
- <https://arxiv.org/html/2510.22455v1> — *primary*, 5 claims
- <https://arxiv.org/pdf/2409.09601> — *primary*, 5 claims
- <https://arxiv.org/pdf/2410.19168> — *primary*, 5 claims
- <https://arxiv.org/pdf/2604.15849> — *primary*, 5 claims
- <https://dl4am.github.io/tutorial> — *primary*, 5 claims
- <https://arxiv.org/abs/2407.08889> — *primary*, 5 claims
- <https://github.com/csteinmetz1/automix-toolkit> — *primary*, 5 claims
- <https://arxiv.org/abs/2010.10291> — *primary*, 4 claims
- <https://github.com/sony/FxNorm-automix> — *primary*, 5 claims
- <https://www.sonible.com/smarteq4/> — *primary*, 5 claims
- <https://arxiv.org/abs/2401.12570> — *primary*, 5 claims
- <https://github.com/gudgud96/syntheon> — *primary*, 5 claims
- <https://arxiv.org/html/2407.16643v1> — *primary*, 5 claims
- <https://www.ijcai.org/proceedings/2025/1129.pdf> — *primary*, 5 claims
- <https://jhurliman.org/post/804323197731373056/experiments-with-ableton-mcp-dec-2025> — *blog*, 5 claims
- <https://arxiv.org/pdf/2511.13987> — *primary*, 5 claims
- <https://arxiv.org/abs/2509.00132> — *primary*, 5 claims
- <https://github.com/ahujasid/ableton-mcp> — *primary*, 5 claims
- <https://arxiv.org/abs/2408.01337> — *primary*, 5 claims
- <https://arxiv.org/abs/2604.19300> — *primary*, 5 claims
- <https://arxiv.org/html/2502.15602v1> — *primary*, 5 claims
- <https://github.com/timcsy/demucs-web> — *primary*, 5 claims

## All extracted claims (with source quotes)

Each claim is tagged with its verification status. `VERIFIED` = survived 2–3 skeptic votes. `SINGLE-SOURCE` = quoted from the page but the verifier vote was rate-limited. `—` = extracted but not queued for verification.

### 1. [VERIFIED (2-0)]

MuChoMusic is a human-validated benchmark of 1,187 multiple-choice music-understanding questions on 644 tracks (from MusicCaps and the Song Describer Dataset), validated by 222 Prolific annotators, providing a standardized way to measure whether audio-language models genuinely understand music audio.

> MuChoMusic comprises 1,187 multiple-choice questions across 644 music tracks ... All questions underwent human validation via 222 Prolific annotators who provided 3-5 annotations per question, with questions excluded if fewer than 50% of annotators selected the intended correct answer.

### 2. [SINGLE-SOURCE (not triangulated)]

Open audio-language models perform poorly on music understanding: the best evaluated model (Qwen-Audio) scored only 51.4% accuracy, while MuLLaMa (32.4%) was barely above the 25% random baseline and MusiLingo (21.1%) scored below random — evidence that current open music-LLMs cannot yet be trusted for nuanced listening judgments.

> Qwen-Audio | 51.4% ... MuLLaMa | 32.4% ... MusiLingo | 21.1% ... Random baseline | 25.0%

### 3. [SINGLE-SOURCE (not triangulated)]

Evaluated models exhibit a strong language bias and often do not actually rely on the audio input: when audio was replaced with noise or wrong tracks, most models' performance barely degraded, with only SALMONN and Qwen-Audio showing a significant drop — a direct risk for any AI mix-critique loop that assumes the model is 'hearing' the render.

> Models demonstrate "a strong language bias, leading to poor performance in tasks that are more audio-dependent." When audio was replaced with noise or random tracks, most models showed minimal performance degradation—only SALMONN and Qwen-Audio "display a significant drop in performance when provided with incorrect audio inputs."

### 4. [—]

The paper identifies concrete failure modes directly relevant to audio-LLM hallucination risk in a critique loop: auditory hallucination (claiming instruments not present in the audio), language hallucination (off-topic statements), and training-data bias (memorized uninformative response patterns).

> Three specific failure categories identified: Auditory hallucination (inventing instruments not in audio); Language hallucination (off-topic statements); Training data bias (memorized uninformative patterns)

### 5. [—]

MuChoMusic does not evaluate production-quality or mix-quality judgments; the authors deliberately excluded low-recording-quality tracks, so the benchmark says little about models' ability to critique mix balance or sound design specifically.

> The paper does not include direct analysis of models' ability to assess audio quality or production aspects specifically. However, the authors note they "exclude all tracks for which the labels indicate a low recording quality, to prevent differences in audio quality from affecting the results."

### 6. [SINGLE-SOURCE (not triangulated)]

CMI-Bench evaluates 11 open-source audio-text LLMs (including Qwen2-Audio, SALMONN, MU-LLaMA, LTU/LTU-AS, GAMA, Pengi, Audio-Flamingo) across 14 MIR tasks on 20 datasets, and finds all of them perform significantly worse than task-specific supervised MIR systems when scored with standard MIR metrics.

> a comprehensive music instruction following benchmark designed to evaluate audio-text LLMs on a diverse set of music information retrieval (MIR) tasks... All models "fall significantly short of the performance achieved by task-specific supervised systems when evaluated using standard MIR metrics."

### 7. [SINGLE-SOURCE (not triangulated)]

Current audio-LLMs cannot produce usable continuous-value (regression) predictions about music: on arousal/valence emotion regression every evaluated model scored worse than or barely at the level of predicting the dataset mean (R² from -1.17 to 0.08), which bears directly on whether such models can output calibrated numeric mix judgments.

> All models fail to provide usable predictions for arousal and valence... R² scores all negative, ranging -1.17 to 0.08

### 8. [SINGLE-SOURCE (not triangulated)]

Audio-LLMs fail badly at fine-grained temporal tasks: beat/downbeat tracking F-measures are near zero, melody extraction accuracy is below 1%, and lyrics transcription WER is 96-2311 vs a supervised SOTA of 13 — implying time-localized critiques (e.g., 'the lead's attack masks the kick') are beyond current open audio-LLMs.

> Beat/downbeat tracking F-measures near zero across models; melody extraction accuracy consistently below 1%... Word Error Rates ranged 96-2311 versus SOTA of 13

### 9. [—]

Audio-LLM instruction following is fragile: models copy input exemplars instead of performing the task and return narrative text when numeric outputs are requested, so an agentic critique loop cannot assume schema-conformant structured outputs from these models.

> Without clearly defined prompting schemas, their ability to interpret instructions can be fragile and fail to generalize... models sometimes "disobey the instruction commonly," providing narrative explanations instead of numeric scores

### 10. [—]

Good captioning scores mask weak musical understanding: models achieve strong text-similarity metrics on music description (~85+ BERTScore) while failing structured MIR tasks (e.g., key detection 8.55 vs 74.3 SOTA Gmean), so caption quality is a misleading proxy for production-critique competence.

> Captioning metrics (BLEU, METEOR) show reasonable performance (best ~85+ BERTScore), but this "fails to reflect the complexity of real-world music analysis"... Key detection (Gmean): best model scored 8.55 vs. SOTA 74.3

### 11. [SINGLE-SOURCE (not triangulated)]

Multimodal LLMs (Gemini 2.5 Pro/Flash, Qwen2.5-Omni 7B) show a large modality gap on core music perception tasks: Gemini models score near-ceiling (95-100%) on MIDI/symbolic input but drop 30-70+ percentage points on the same tasks from raw audio, indicating waveform perception is the primary bottleneck.

> MIDI input yielded near-ceiling scores for Gemini models, whereas audio reduced accuracy across tasks, highlighting perception from waveform as the primary bottleneck.

### 12. [SINGLE-SOURCE (not triangulated)]

State-of-the-art audio LLMs still fail to reliably 'listen' to audio: chord quality identification from audio drops to 6-53% accuracy (vs 97-100% from MIDI), and syncopation counting from audio drops to 25-65% (vs 95-100% from MIDI), with apparent audio successes sometimes reflecting shallow heuristics rather than genuine perception.

> current multimodal LLMs reason effectively over symbolic music data, yet still fail to 'listen' reliably ... apparent successes can reflect superficial heuristics rather than genuine listening.

### 13. [SINGLE-SOURCE (not triangulated)]

Pipelines that layer symbolic reasoning/solvers on top of audio LLM perception (LogicLM-style) collapse when the audio front-end makes small perceptual errors, because those errors cascade into complete downstream failure — a direct risk for render→listen→critique→edit loops that trust LLM audio judgments.

> In the current state-of-the-art, symbolic reasoning layers collapse on small perceptual errors.

### 14. [—]

Few-shot prompting does not fix audio perception failures in these models (no significant effect of number of shots), suggesting the limitation is perceptual rather than a prompting/calibration issue.

> No significant main effects of shot were observed (all p's >.05)

### 15. [—]

Even where audio performance appears strong (transposition detection ~90% from audio), models used degenerate strategies — e.g., Gemini Pro preserved sequence length while failing to capture intervallic structure and contour — so headline accuracy can overstate genuine hearing ability.

> Gemini Pro often preserved sequence length while failing to capture intervallic structure and contour.

### 16. [SINGLE-SOURCE (not triangulated)]

The survey empirically tested eight open-source audio/music foundation models (Qwen-Audio, LTU, SALMONN, AnyGPT, ModaVerse, ChatMusician, M²UGen, MU-LLaMA) on music understanding tasks (genre classification, mood classification, music captioning), providing a direct capability comparison relevant to selecting a 'listening' model for a DAW feedback loop.

> We conducted tests on eight existing open-source large foundation models to evaluate their music understanding capabilities.

### 17. [SINGLE-SOURCE (not triangulated)]

Qwen-Audio was the strongest open-weights model in the authors' evaluation, achieving 80% accuracy on GTZAN and 75% on FMA genre classification, and the best ROUGE F1 scores on MusicCaps captioning (ROUGE-1 F ≈ 0.336), while multimodal generalists like AnyGPT scored worst (0.138).

> Qwen-Audio excelled in the genre classification task, achieving an accuracy of 80% and 75% on the GTZAN and FMA datasets, respectively. ... The model with the best overall performance was Qwen-Audio, with the highest Rouge-R1 and RL F1 scores.

### 18. [SINGLE-SOURCE (not triangulated)]

A documented failure mode: current music-understanding LLMs are mostly lightly fine-tuned general language models and lack professional-level musical knowledge, implying production-quality/mix-critique judgments are beyond their demonstrated competence (the survey evaluates only genre, mood, and captioning — no mixing or production-quality tasks appear).

> The language models used in existing music understanding are typically either directly adopted or only slightly fine-tuned from existing language models. These models inherently lack the specialized musical knowledge that professional musicians possess.

### 19. [—]

Adding more input/output modalities degrades music understanding: models with many modalities (AnyGPT, M²UGen) underperformed, attributed to parameter budget dilution or cross-modal weight interference — a caution against choosing broad any-to-any models for the DAW's listening subsystem.

> Models with more input and output modalities, such as AnyGPT and M²UGen, do not perform well in music understanding. This may be due to the increase in modalities without a corresponding increase in the number of parameters, or because the weights of different modalities interfere with each other.

### 20. [—]

Progress is bottlenecked by scarce high-quality annotated music-text data, which bears on the feasibility of training/fine-tuning a model for fine-grained mix critique.

> There is a scarcity of high-quality, manually annotated datasets.

### 21. [SINGLE-SOURCE (not triangulated)]

Even the strongest audio-language models score barely above 50% on the MMAU expert-level audio understanding benchmark: Gemini Pro v1.5 reaches 52.97% and the best open-source model Qwen2-Audio reaches 52.50%, far below human accuracy of 82.23% — implying current audio LLMs are unreliable for expert-level listening judgments of the kind a mix-critique subsystem needs.

> Gemini Pro v1.5: "only 52.97% accuracy" ... Qwen2-Audio (state-of-the-art open-source): "only 52.50%" ... Human performance: "82.23%" accuracy on test-mini split

### 22. [SINGLE-SOURCE (not triangulated)]

Music is the weakest domain for audio-language models on MMAU: models perform worse on music than on speech or environmental sound, with the best music-subset accuracy being Qwen2-Audio-Instruct at 53.26% and some models (Pengi) near-random at 3.05% — directly relevant to whether audio LLMs can be trusted to critique music mixes.

> Best on music: Qwen2-Audio-Instruct with "53.26%" accuracy ... Worst on music: Pengi with "03.05%" accuracy ... models "struggle the most with music"

### 23. [SINGLE-SOURCE (not triangulated)]

The dominant failure mode of audio LLMs is perceptual (mis-hearing the audio) rather than reasoning: error analysis attributes 55% of Qwen2-Audio-Instruct's errors and 64% of Gemini Pro v1.5's errors to perception versus only 18% and 11% respectively to reasoning — suggesting a DAW critique loop should not assume the model accurately hears fine-grained mix details.

> Qwen2-Audio-Instruct: "55%" perceptual errors vs. "18%" reasoning errors; Gemini Pro v1.5: "64%" perceptual errors vs. "11%" reasoning errors ... "improving perceptual understanding is crucial for better performance"

### 24. [SINGLE-SOURCE (not triangulated)]

Some open music-understanding models (MU-LLaMA, SALMONN) show almost no performance change when the input audio is replaced with noise, indicating they answer from text priors rather than actually listening — a concrete hallucination risk for using such models as the 'ears' of an autonomous mix-improvement loop.

> Models like MuLLaMa and SALMONN showed "little change in performance" when audio was replaced with noise, suggesting they don't reliably attend to audio inputs

### 25. [—]

MMAU is a large-scale benchmark (from University of Maryland and Adobe, submitted 24 Oct 2024) comprising 10,000 audio clips across speech, environmental sounds, and music, testing 27 distinct skills spanning information extraction and reasoning — providing a usable yardstick for selecting/validating an audio-understanding model for the DAW's listening subsystem.

> The benchmark comprises 10,000 audio clips across three domains: speech, environmental sounds, and music. It includes "information extraction and reasoning questions, requiring models to demonstrate 27 distinct skills"

### 26. [SINGLE-SOURCE (not triangulated)]

As of the ISMIR 2022 tutorial, deep-learning automatic mixing systems trained on large-scale data still perform substantially below professional audio engineers, despite their potential to outperform traditional rule-based/adaptive-DSP approaches.

> while deep learning approaches that leverage large-scale datasets have the potential to outperform traditional approaches, their performance is still far from professional audio engineers.

### 27. [SINGLE-SOURCE (not triangulated)]

The automatic-mixing literature divides into two architecture families: direct audio-to-audio transformation systems (e.g. Mix-Wave-U-Net) versus systems that estimate parameters of a mixing console of audio effects (e.g. Differentiable Mixing Console) — the latter being the family that produces human-interpretable, project-parameter-mapped actions.

> existing approaches for automatic mixing are categorized into those that perform a direct mapping from the input recordings to the final mixture and those that instead manipulate the parameters of a mixing console composed of a set of audio effects.

### 28. [—]

The principal bottleneck for building powerful automatic mixing systems is the lack of high-quality annotated multitrack mixing datasets; using music source separation datasets as a workaround has known limitations.

> one of the main challenges in building powerful automatic mixing systems remains the lack of high-quality annotated datasets.

### 29. [—]

Framing mixing as a deterministic one-to-one mapping is an oversimplification because mixing is subjective and admits many valid outputs — implying an AI mix critic/fixer should model or tolerate multiple valid targets rather than converge on a single 'correct' mix.

> due to the subjective and largely artistic nature of audio engineering, there always exists multiple valid mixtures for any given set of input recordings.

### 30. [—]

The tutorial ships open-source implementations (via GitHub) covering four named deep automix systems — Mix-Wave-U-Net, Differentiable Mixing Console, Fx-Normalization, and Differentiable Mixing Style Transfer — including training and evaluation code, making these directly reusable reference implementations.

> code to build, train, and evaluate these systems

### 31. [SINGLE-SOURCE (not triangulated)]

TinyMU is a 229M-parameter music-language model that achieves performance comparable to much larger large audio-language models (LALMs), specifically reaching 82% of the state-of-the-art LALM's performance on the MuChoMusic benchmark while being 35x smaller — directly relevant to whether music-understanding models can run locally/on-device rather than API-only.

> we present TinyMU, a lightweight (229M) Music-Language Model (MLM) that achieves performance comparable to much larger LALMs while remaining efficient and compact... Notably, on the MuChoMusic benchmark, it achieves 82% of SOTA LALM's performance despite being 35x smaller

### 32. [SINGLE-SOURCE (not triangulated)]

On the MuChoMusic music-understanding benchmark, TinyMU scores 58.6 overall versus 71.4 for MiDashengLM and 67.8 for Qwen2-Audio-Instruct, while dedicated music LLMs score far lower (MU-LLaMA 32.7, MusiLingo 31.5, Mellow 30.3) — giving a concrete 2026 ranking of audio-LLMs on music QA.

> TinyMU achieves 58.6 overall, reaching 82% of the performance of MiDashengLM while being 35× smaller. [Table 2 baselines:] Qwen2-Audio-Instruct: 67.8; MiDashengLM: 71.4; MU-LLaMA: 32.7; MusiLingo: 31.5; Mellow: 30.3

### 33. [—]

TinyMU was trained on MusicSkills-3.5M, a newly introduced curated music-grounded question-answering dataset of 3.5 million samples spanning multiple-choice, binary, and open-ended formats.

> we introduce MusicSkills-3.5M, a carefully curated, music-grounded question-answering dataset with 3.5M samples. Spanning multiple-choice, binary, and open-ended formats, this dataset provides fine-grained supervision across diverse musical concepts.

### 34. [—]

TinyMU's architecture pairs the MATPAC++ self-supervised audio encoder with a lightweight linear projector feeding into the SmolLM2 small language model — a recipe for compact music-understanding models potentially amenable to local/ONNX deployment.

> TinyMU leverages MATPAC++, the SOTA self-supervised audio encoder for fine-grained feature extraction. Paired with a lightweight linear projector, it efficiently aligns audio embeddings with the language model.

### 35. [—]

The paper argues that existing large audio-language models' billion-parameter scale makes them expensive to train, slow at inference, and poorly deployable on edge devices, but TinyMU itself reports no actual latency, throughput, or on-device deployment benchmarks and no explicit failure-mode analysis.

> However, their massive scale, often billions of parameters, results in expensive training, slow inference, and limited deployability on edge devices. [Per the paper body:] no actual latency metrics, throughput numbers, or deployment benchmarks are reported.

### 36. [SINGLE-SOURCE (not triangulated)]

Diff-MST (Vanka, Steinmetz, Rolland, Reiss, Fazekas; accepted at ISMIR 2024) is a mixing style transfer framework that automatically generates a multitrack mix by inferring production attributes from a reference song, directly demonstrating that reference-track-driven automatic mixing is a working research technique.

> Mixing style transfer automates the generation of a multitrack mix for a given set of tracks by inferring production attributes from a reference song.

### 37. [SINGLE-SOURCE (not triangulated)]

Diff-MST predicts control parameters for standard audio effects inside a differentiable mixing console rather than producing audio end-to-end, meaning its outputs map to interpretable, human-adjustable effect parameters — exactly the analysis-to-action mapping (parameters, not black-box audio) the proposed DAW feedback loop needs.

> estimates control parameters for audio effects within a differentiable mixing console, producing high-quality mixes and enabling post-hoc adjustments

### 38. [SINGLE-SOURCE (not triangulated)]

The system architecture consists of three components — a differentiable mixing console, a transformer controller, and an audio production style loss function — providing a concrete blueprint for a learned analyze-then-set-parameters mixing system.

> comprises a differentiable mixing console, a transformer controller, and an audio production style loss function

### 39. [—]

Prior end-to-end mixing style transfer systems are limited: they often handle only a fixed number of tracks, introduce artifacts, and lack grounding in traditional audio effects, which prohibits interpretability and controllability — a key failure mode to avoid in an AI-mixing subsystem.

> existing systems for mixing style transfer are limited in that they often operate only on a fixed number of tracks, introduce artifacts, and produce mixes in an end-to-end fashion, without grounding in traditional audio effects, prohibiting interpretability and controllability

### 40. [—]

Diff-MST supports an arbitrary number of input tracks without requiring source labeling, and was evaluated against baselines showing the architecture and tailored loss function are effective — suggesting the approach can generalize to real DAW projects with variable track counts.

> Supports arbitrary input track counts without source labeling ... Evaluated against robust baselines, demonstrating effectiveness of the architecture and tailored loss function

### 41. [—]

Steinmetz et al. (2020) propose a differentiable mixing console architecture that learns multitrack mixing conventions directly from raw audio waveforms without needing ground-truth mixing parameters, addressing the scarcity of structured mixing data.

> Applications of deep learning to automatic multitrack mixing are largely unexplored. This is partly due to the limited available data, coupled with the fact that such data is relatively unstructured and variable... [the model learns] multitrack mixing conventions from real-world data at the waveform level, without knowledge of the underlying mixing parameters

### 42. [—]

The system outputs human-readable mixing parameters rather than opaque audio transformations, so users can manually inspect, adjust, or refine the automatically generated mix — directly supporting the DAW vision of mapping AI suggestions to actual project parameters.

> Production of "human-readable mixing parameters, allowing users to manually adjust or refine the generated mix"

### 43. [—]

A perceptual listening evaluation with professional audio engineers found the deep-learning mixes outperformed baseline automatic mixing approaches, providing evidence that learned auto-mixing can exceed rule-based baselines.

> Results from a perceptual evaluation involving audio engineers indicate that our approach generates mixes that outperform baseline approaches.

### 44. [—]

The architecture uses pre-trained sub-networks with weight sharing and a sum/difference (mid/side) stereo loss function, and is permutation-invariant with no fixed limit on the number of input source tracks.

> pre-trained sub-networks and weight sharing, as well as with a sum/difference stereo loss function... Permutation invariance regarding input ordering with no limits on source count

### 45. [SINGLE-SOURCE (not triangulated)]

An open-source toolkit (automix-toolkit, Apache-2.0 licensed) exists that provides models and datasets specifically for training deep learning automatic mixing systems, including pretrained checkpoints usable for inference on multitrack recordings.

> Models and datasets for training deep learning automatic mixing models ... Licensed under "Apache-2.0 license."

### 46. [SINGLE-SOURCE (not triangulated)]

The toolkit implements two learned automix architectures: the Differentiable Mixing Console (DMC), which predicts interpretable mixing-console parameters, and Mix-Wave-U-Net, a direct waveform-to-waveform model — demonstrating that both parameter-predicting and end-to-end approaches to neural automatic mixing have open implementations.

> The toolkit includes two model architectures: Differentiable Mixing Console (DMC) [and] Mix-Wave-U-Net. Pretrained checkpoints available include enst-drums-dmc.ckpt and enst-drums-mixwaveunet.ckpt.

### 47. [—]

Publicly available training data for learned automatic mixing is small: the toolkit's supported datasets total only a few hundred mixes (ENST-Drums: 210 mixes / 20 GB; MedleyDB: 197 mixes / 82+71 GB; DSD100: 100 mixes / 14 GB), which constrains how general learned automix models can be.

> ENST-Drums | 210 | 20 GB ... MedleyDB | 197 | 82 + 71 GB ... DSD100 | 100 | 14 GB ... DSD100subset | 4 | 0.1 GB

### 48. [—]

Pretrained automix models distributed with the toolkit are trained on the drum-focused ENST-Drums dataset (checkpoints enst-drums-dmc.ckpt and enst-drums-mixwaveunet.ckpt), so out-of-the-box inference quality is demonstrated mainly on drum multitracks rather than full arbitrary productions.

> First you need to download the pretrained models into the `automix/checkpoints/` directory" using provided wget links for enst-drums-dmc.ckpt and enst-drums-mixwaveunet.ckpt files.

### 49. [—]

The toolkit is a companion to a deep-learning-for-automatic-mixing tutorial (dl4am), supports batch training scripts across ENST-Drums, MedleyDB, and DSD100, and includes evaluation via objective metrics — indicating a reproducible academic training/evaluation pipeline rather than a production mixing product.

> The repository references "dl4am.github.io/tutorial" for additional context. ... The toolkit enables inference on drum multitrack recordings, batch training across multiple datasets, and evaluation "via objective metrics."

### 50. [—]

smart:EQ 4 performs cross-channel spectral unmasking across grouped tracks (up to 10), directly reducing masking between channels — a commercial implementation of the masking-detection→EQ-action mapping the DAW research question asks about.

> intelligent cross-channel processing for spectral unmasking ... manage up to 10 tracks ... 'Group' (reduces masking between channels without affecting the channel itself)

### 51. [—]

The plugin's AI EQ curve (smart:filter) is driven by target Profiles, including instrument, vocal, and genre-based profiles, rather than free-form audio understanding.

> automatically balances the signal based on a target Profile you choose ... includes instrument and vocal Profiles plus genre-based profiles

### 52. [—]

smart:EQ 4 can learn a spectral target from a user-supplied reference track and match the processed track to it, with user-configurable analysis/learning time.

> emulate its spectral character and balance ... load reference tracks to create a custom profile ... specify the maximum learning time that smart:EQ 4 should use to analyze the input signal

### 53. [—]

The smart:filter offers three processing modes — Track (single-channel balancing), Group (inter-channel unmasking only), and Track and Group (both) — showing per-track vs cross-track correction are separable operations.

> The smart:filter operates in three modes: 'Track' (channel balancing), 'Group' (reduces masking between channels without affecting the channel itself), and 'Track and Group' (applies both functions).

### 54. [—]

smart:EQ 4 ships only as native desktop plugin formats (VST/VST3/AU/AAX, Win 10+/macOS 10.14+, Apple Silicon native) at $129 list — no web/WASM deployment path.

> Formats: VST, VST3, AU, AAX ... OS: Windows 10+ (64-bit), macOS 10.14+ ... Apple Silicon: Native support ... $129.00

### 55. [—]

FxNorm-Automix is Sony's official open-source implementation (MIT-licensed) of the ISMIR 2022 paper 'Automatic music mixing with deep learning and out-of-domain data', demonstrating that a learned (non-rule-based) automatic mixing system exists with public code and pretrained models.

> "Automatic music mixing with deep learning and out-of-domain data" ... 23rd International Society for Music Information Retrieval Conference (ISMIR), December, 2022 ... Trained models can be found at `training/results`

### 56. [—]

The system's key technical contribution is an effect-normalization data preprocessing method that lets supervised deep-learning mixing models be trained on wet/processed multitrack recordings instead of scarce dry stems, addressing the main data bottleneck in learned auto-mixing.

> the lack of dry or clean instrument recordings limits the performance of such models ... whether we can use out-of-domain data such as wet or processed multitrack music recordings and repurpose it to train supervised deep learning models

### 57. [—]

The system was evaluated via subjective listening tests with professional mixing engineers, using a redesigned listening-test methodology for evaluating automatic mixing systems — indicating that expert human perceptual evaluation (not just objective metrics) is the accepted validation standard in learned auto-mixing research.

> redesigned a listening test method for evaluating music mixing systems ... validate our results through such subjective tests using highly experienced mixing engineers as participants

### 58. [—]

The repository compares the proposed FxNorm-Automix architecture (variants S_La, S_Lb, S_pretrained) against a Wave-U-Net baseline, and uses MUSDB18-derived average features (features_MUSDB18.npy) for the normalization step, making it reproducible with a standard public dataset.

> Two architectures are compared: FxNorm-Automix (proposed approach with variants: S_La, S_Lb, S_pretrained) [and] Wave-U-Net (baseline comparison, variant: WUN_S_Lb) ... Average features computed on this dataset are included ("features_MUSDB18.npy")

### 59. [—]

Deployment is Python/PyTorch-based (PyTorch 1.9.0, librosa >=0.8.1) with an inference script, but the impulse responses used in training/evaluation/inference are withheld for copyright reasons, which limits exact reproduction and constrains direct reuse in other systems.

> Due to copyright issues, the IRs used during training, evaluation and inference of our models cannot be made public ... requires PyTorch 1.9.0 and librosa ≥0.8.1

### 60. [—]

In December 2025, an LLM agent (Claude Opus 4.5 via Claude Code) controlling Ableton Live through the ableton-mcp server could autonomously extend its own tooling — looking up documentation, adding new MCP tools, and testing them in a mostly closed loop.

> modern LLMs are capable enough to look up docs, add new MCP tools, test them, and iterate in a mostly closed loop.

### 61. [—]

The agent gave itself audio 'listening' capability by combining a Max4Live WAV-recording patch with two Replicate-hosted analysis endpoints: a fork of mir-aidj/all-in-one for structural analysis (jhurliman/allinone-targetbpm) and a music-understanding audio-LLM endpoint (jhurliman/music-flamingo).

> Replicate endpoints: jhurliman/allinone-targetbpm (structural analysis, fork of mir-aidj/all-in-one) and jhurliman/music-flamingo (audio + prompt analysis with music theory knowledge)

### 62. [—]

Fully closed-loop agentic iteration (render → listen → critique → re-edit) was NOT deeply validated in these experiments; the audio-analysis endpoints were characterized only as useful building blocks, so convergence of such loops remains unproven in this source.

> I haven't gone deep testing closed loop agentic iteration with these, but they've proven to be helpful building blocks.

### 63. [—]

For Ableton features not exposed by the MCP server, Opus 4.5 reverse-engineered parts of the .als project file format well enough to inject tempo/volume automation and warp markers directly, supporting the DAW-as-editable-file paradigm.

> Opus 4.5 managed to reverse engineer enough of the .als file format to inject tempo/volume automation and warp markers.

### 64. [—]

The agent workflow produced a concrete finished musical output — a mashup of Deft & Lewis James's 'Octo' with vocal samples, involving 70+ automation tool calls, published to SoundCloud — demonstrating end-to-end agentic music editing (though not autonomous mix critique).

> 70+ automation tool calls created; Successfully produced a mashup of Deft & Lewis James's "Octo" with vocal samples; Track uploaded to SoundCloud

### 65. [—]

CoComposer is a multi-agent LLM music composition system composed of five collaborating agents whose roles mirror the traditional music composition workflow, demonstrating that decomposed agent pipelines are a working architecture for LLM-driven music creation.

> We introduce CoComposer, a multi-agent system that consists of five collaborating agents, each with a task based on the traditional music composition workflow.

### 66. [—]

CoComposer uses an automatic audio-quality judge (Meta's AudioBox-Aesthetics model) rather than human listeners as the primary evaluator of generated music, scoring outputs on four compositional criteria — evidence that learned aesthetic scorers are being used as the 'listening' component in LLM music-agent loops.

> Using the AudioBox-Aesthetics system, we experimentally evaluate CoComposer on four compositional criteria.

### 67. [—]

In experiments with three backbone LLMs (GPT-4o, DeepSeek-V3-0324, Gemini-2.5-Flash), the multi-agent CoComposer outperformed prior multi-agent LLM music systems on music quality and outperformed a single-agent baseline on production complexity.

> We test with three LLMs (GPT-4o, DeepSeek-V3-0324, Gemini-2.5-Flash), and find (1) that CoComposer outperforms existing multi-agent LLM-based systems in music quality, and (2) compared to a single-agent system, in production complexity.

### 68. [—]

LLM-agent composition trades raw audio quality for interpretability/editability: CoComposer is claimed to be more interpretable and editable than the non-LLM generative model MusicLM, but MusicLM still produces better-sounding music — a concrete data point that agentic symbolic/parameterized approaches currently lag end-to-end audio generation in quality.

> Compared to non-LLM MusicLM, CoComposer has better interpretability and editability, although MusicLM still produces better music.

### 69. [—]

The abstract does not describe an iterative render-listen-critique-revise loop; AudioBox-Aesthetics is presented as an offline evaluation tool, not an in-loop feedback signal, so this paper is weak evidence for convergent critique loops specifically.

> The abstract does not describe a generate-critique-refine loop or provide quantitative metrics.

### 70. [—]

A deployed multi-agent LLM system (Structural, Harmonic, Stylistic agents orchestrated by a coordinator, compatible with LangGraph) analyzing a 50-work 18th-century symbolic corpus produced mostly consistent outputs but a documented minority of hallucinations, concentrated in over-segmentation of ambiguous passages, stylistic misattribution of transitional works, and harmonic mislabelling under complex modulations.

> Despite this overall consistency, occasional discrepancies—labelled as “hallucinations” in Table 3—arose. These typically reflected either over-segmentation by the Structural agent in ambiguous passages, stylistic misattribution in transitional works, or harmonic mislabelling in pieces with complex modulations.

### 71. [—]

The paper's agentic music workflow is explicitly structured as a generate-evaluate loop with a dedicated Evaluation Agent that checks rule compliance and aggregates feedback — an existence proof of the render→analyze→critique→apply architecture pattern, but operating on symbolic (MIDI/MusicXML) data, not rendered audio mixes.

> 1.Input Processing Agent:Transcribes and segments symbolic or audio input to extract musical phrases. 2.Analysis Agent:Identifies harmonic, rhythmic, and formal patterns, and generates an annotated report in MusicXML. 3.Generation Agent:Uses extracted features to generate new material using style transfer models, imposing compositional constraints. 4.Evaluation Agent:Assesses compliance with musical rules and aggregates expert and user feedback.

### 72. [—]

Open multi-agent frameworks for iterative music analysis/generation across text, symbolic, and audio modalities already exist as of 2023–2025: WeaveMuse (open source, Karystinaios 2025, arXiv:2509.11183) and MusicAgent (Yu et al. 2023, arXiv:2310.11954), the latter using LLM-orchestrated decomposition of complex music requests into subtasks.

> WeaveMuse offers an open source multi-agent framework that supports iterative analysis, synthesis, and rendering processes across diverse modalities, including text, symbolic notation, and audio (Karystinaios, 2025). Similarly, MusicAgent utilizes powered workflows powered by large language model to orchestrate a wide array of music-related tools, allowing the automatic decomposition of complex user requests into manageable subtasks (Yu et al., 2023).

### 73. [—]

The authors conclude that automated agent-based music analysis fails predictably on stylistically transitional or harmonically atypical material and therefore still requires human expert supervision — a directly relevant caution for autonomous AI mix-critique loops.

> However, specific limitations emerge, particularly in works that exhibit transitional stylistic characteristics or atypical harmonic structures. These “hallucinations” —while few—illuminate the boundaries of current automated analysis and underscore the continuing importance of expert musicological interpretation.

### 74. [—]

The paper argues that reliable evaluation of AI music systems requires pairing subjective human feedback with objective quantitative metrics (they used DTW melodic similarity, harmonic coherence scores, and rhythmic entropy via Music21), supporting the proposed DAW architecture of DSP metrics as guardrails around LLM judgments.

> Human feedback provides invaluable insight into expressive and aesthetic aspects, often capturing nuances that computational methods may overlook. In contrast, quantitative indicators, such as accuracy, precision, recall, or diversity metrics, ensure reproducibility and objectivity when comparing systems. Integrating both perspectives enables comprehensive assessments and supports the development of robust, user-oriented music analysis tools.

### 75. [—]

AbletonMCP is an existing open-source (MIT-licensed) MCP server that connects Claude AI to Ableton Live, demonstrating that the DAW-agent integration pattern proposed for the new DAW already has a working precedent in a commercial DAW.

> AbletonMCP connects Claude AI to Ableton Live through the Model Context Protocol, enabling AI-assisted music production. It consists of two components: an Ableton Remote Script (socket server) and an MCP Server (Python implementation).

### 76. [—]

The MCP tools exposed cover project manipulation only — track/clip creation and editing, MIDI note entry, transport control, tempo, and loading instruments/effects from Ableton's browser — i.e., the 'apply edits' half of a render-listen-critique loop.

> Load instruments and effects from Ableton's browser

### 77. [—]

AbletonMCP has no audio analysis or listening capability: the agent can write and edit music but cannot hear the rendered result, so any critique loop built on it lacks audio feedback and relies entirely on the LLM's symbolic reasoning.

> The documentation does not mention audio analysis or listening capabilities—only manipulation of existing tracks and structures.

### 78. [—]

The project has substantial community traction (approximately 2.8k GitHub stars and 365 forks), indicating real demand for agentic LLM control of DAWs.

> 2.8k stars | 365 forks | 32 issues | 30 pull requests ... License: MIT

### 79. [—]

The architecture uses a socket-based Remote Script inside Ableton Live (10+) bridged to a Python 3.8+ MCP server, a pattern the new DAW could avoid by exposing MCP natively over its headless CLI and text project files.

> Ableton Live 10 or newer ... Python 3.8+ ... Installable via Smithery, Claude Desktop, or Cursor with configuration in claude_desktop_config.json.

### 80. [—]

DiffMoog is an open-source differentiable modular synthesizer that includes the module types found in commercial instruments (FM/AM modulation, LFOs, filters, envelope shapers) and supports user-defined custom signal chains, enabling gradient-based automated sound matching to replicate a given audio input.

> This paper presents DiffMoog - a differentiable modular synthesizer with a comprehensive set of modules typically found in commercial instruments. Being differentiable, it allows integration into neural networks, enabling automated sound matching, to replicate a given audio input. Notably, DiffMoog facilitates modulation capabilities (FM/AM), low-frequency oscillators (LFOs), filters, envelope shapers, and the ability for users to create custom signal chains.

### 81. [—]

DiffMoog's sound-matching framework pairs a novel 'signal-chain loss' with an encoder network that predicts synthesizer parameters conditioned on the user-defined modular architecture, and the platform is released as open source (code at github.com/aisynth/diffmoog).

> We introduce an open-source platform that comprises DiffMoog and an end-to-end sound matching framework. This framework utilizes a novel signal-chain loss and an encoder network that self-programs its outputs to predict DiffMoogs parameters based on the user-defined modular architecture.

### 82. [—]

Even with a differentiable synthesizer, accurately imitating typical synth sounds remains unsolved: the authors report that high-precision sound matching is still a 'formidable challenge', which bounds expectations for a DAW feature that infers synth patch parameters from a target timbre.

> achieving high precision in imitating typical sounds remains a formidable challenge.

### 83. [—]

Gradient-based frequency estimation via spectrogram losses is an open intrinsic problem: optimizing frequency and FM-modulation-index parameters by minimizing spectral distances produces abrupt, poorly-behaved gradients, and complex FM signal chains failed to converge in their experiments.

> the sub-task of frequency estimation through gradient descent techniques via minimizing spectrogram-based losses is an intrinsic challenge that remains open ... more complex chains utilizing FM modulations refused to converge

### 84. [—]

Training with the spectral signal-chain loss alone systematically failed; it only helped as a fine-tuning stage after parameter-loss pretraining, where it showed hints of better generalization to out-of-domain sounds.

> Using the signal-chain loss solely failed systematically ... training with the spectral signal-chain loss after using the parameter loss hinted superior performance over the sole usage of parameters loss on out-of-domain data

### 85. [—]

Syntheon is an open-source (Apache-2.0) Python library that performs deep-learning-based synthesizer parameter inference: given an audio sample, it infers a synth preset intended to recreate that sound.

> Parameter inference for music synthesizers using deep learning models. Given an audio sample, Syntheon infers the best parameter preset for a given synthesizer that can recreate the audio sample.

### 86. [—]

Syntheon supports the Vital wavetable synthesizer for parameter inference, with Dexed support only work-in-progress, and it can output a preset file usable by the plugin (installable via pip, with an infer_params API taking a WAV file and synth name).

> Parameter inference of music synthesizers to simplify sound design process. Supports Vital.

### 87. [—]

Syntheon's architecture separates a per-synth 'converter' (preset serialization/parsing to plugin file format) from an 'inferencer' (model load -> inference -> convert_to_preset), a pattern directly relevant to mapping heard audio back to actual project/plugin parameters.

> Inferencer: Manages model inference through convert workflow: "load_model -> inference -> convert_to_preset"

### 88. [—]

The project publishes no accuracy or evaluation metrics in its README and lists 'improving current model performance' and 'replicating state-of-the-art approaches' as open TODOs, indicating audio-to-Vital-preset inference is not yet a solved, benchmarked capability in this tool.

> No accuracy metrics or evaluation results are provided in the documentation... The project lists these development priorities: Replicating state-of-the-art approaches; Improving current model performance; Incorporating new synthesizers; Code refactoring

### 89. [—]

Development appears stalled at an early stage: the latest release is v0.1.0 from September 5, 2023, with only 32 total commits (177 stars, 10 forks), so it predates the 2024-2026 window and should be treated as a proof-of-concept rather than production-ready.

> Latest release: v0.1.0 (September 5, 2023); 32 total commits

### 90. [—]

An Audio Spectrogram Transformer can be trained to infer synthesizer patch parameters directly from audio: the authors trained on 1 million randomly generated samples from the NI Massive synthesizer, predicting 16 continuous parameters (oscillator positions/amps, filter cutoff/resonance, envelope times, FX dry/wet) via MSE regression.

> We created a dataset of 1 million paired samples using a set of 16 parameters.

### 91. [—]

The AST-based sound-matching model substantially beats MLP and CNN baselines on both parameter accuracy and audio reconstruction: reported MSE 0.031 and spectral convergence 0.616 for AST vs 0.077/4.608 (MLP) and 0.094/5.372 (CNN).

> our AST model significantly outperforms both baselines in both parameter prediction accuracy (MSE) and audio reconstruction accuracy (SC)

### 92. [—]

The model generalizes beyond its training distribution, approximating out-of-domain targets such as vocal imitations and sounds from other synthesizers and instruments — evidence that a system can 'hear a target timbre and propose patch parameters' even for sounds the synth never produced.

> The AST is also able to reconstruct timbre and envelope for out-of-domain input sounds, suggesting this approach can be used to approximate arbitrary audio examples effectively

### 93. [—]

The approach requires no differentiable implementation of the synthesizer — parameter inference works with any black-box synth given a rendered dataset, which matters for a DAW wanting sound matching against arbitrary (e.g., WASM) plugins.

> sound matching systems could be created for further synthesizers with minimal architectural modifications, and without requiring them to be implemented differentiably

### 94. [—]

A documented failure mode is oscillator pitch estimation: parameter-space MSE loss does not capture pitch-dependent perceptual error, and the training data did not vary MIDI pitch, so pitch-related parameters are poorly matched.

> One failure mode of the model seems to be in the modelling of oscillator pitch.

### 95. [—]

SynthRL is the first reinforcement-learning approach to synthesizer sound matching, using a sound-similarity reward (spectrogram MAE + spectral convergence + MFCC MAE) so a non-differentiable synthesizer (Dexed, 144 parameters) can be optimized without ground-truth parameter labels, enabling fine-tuning on out-of-domain sounds.

> We propose SynthRL, a novel reinforcement learning (RL)-based approach for cross-domain synthesizer sound matching. By incorporating sound similarity into the reward function, SynthRL effectively optimizes synthesis parameters without ground-truth labels, allowing fine-tuning on out-of-domain sounds.

### 96. [—]

On out-of-domain sounds (Surge XT presets matched with the Dexed FM synth), SynthRL-o outperforms the prior state-of-the-art Sound2Synth by 37.7% and PresetGenVAE by 17.2% on average across spectrogram MAE, spectral convergence, and MFCC MAE metrics.

> Compared to the baselines, SynthRL-o outperforms PresetGenV AE by an average 17.2% and Sound2Synth by 37.7%.

### 97. [—]

Even the best cross-domain sound-matching result remains perceptually mediocre: in the out-of-domain MOS listening test SynthRL-o scores 3.01 out of 5 (vs 1.94 for Sound2Synth and 2.09 for PresetGenVAE), versus 4.29 for the best in-domain model — indicating hearing a target timbre and proposing patch parameters works only partially across synthesis domains.

> In the out-of-domain MOS test, SynthRL-o scores 3.01 with a 95% CI of 0.26, considerably outperforming SynthRL-i (2.28)

### 98. [—]

A single objective audio-similarity metric can badly mislead automated optimization: training with only spectrogram MAE as the reward made the model output transient sounds for sustained low-energy targets because the metric scored a clearly wrong match (0.182) lower than a nearly indistinguishable pair (0.292) — a caution for using single DSP metrics as guardrails in render-listen-critique loops.

> using a reward solely based on spectrogram MAE in RL can lead to undesired learning outcomes ... Consequently, using only spectrogram MAE as the reward leads the model to consistently output transient sounds for diverse target sounds with overall low energy.

### 99. [—]

The paper's combined three-metric reward function correlates strongly with human judgments of sound similarity (Pearson r = 0.85, p < 0.001, from 120 MTurk raters), supporting the use of composite objective DSP metrics as a proxy for perceptual listening in automated feedback loops.

> It demonstrates a clear positive relationship between the rewards and MOS, with a Pearson correlation of 0.85 (p < 0.001).

### 100. [—]

MuChoMusic is a human-validated benchmark for music understanding in audio-language models consisting of 1,187 multiple-choice questions over 644 music tracks drawn from two public datasets.

> MuChoMusic comprises 1,187 multiple-choice questions, all validated by human annotators, on 644 music tracks sourced from two publicly available music datasets, and covering a wide variety of genres.

### 101. [—]

Evaluation of five open-source audio-language models on MuChoMusic found that they over-rely on the language modality rather than genuinely attending to the audio input — a key documented failure mode for AI systems intended to 'listen' to music.

> we evaluate five open-source models and identify several pitfalls, including an over-reliance on the language modality, pointing to a need for better multimodal integration.

### 102. [—]

The authors argue that existing evaluation methods are inadequate for verifying whether multimodal models correctly interpret music audio, motivating the benchmark's creation.

> their evaluation poses considerable challenges, and it remains unclear how to effectively assess their ability to correctly interpret music-related inputs with current methods.

### 103. [—]

MuChoMusic tests knowledge and reasoning across fundamental musical concepts and their cultural/functional contexts — i.e., it covers general music understanding, not production/mix-quality judgments specifically.

> Questions in the benchmark are crafted to assess knowledge and reasoning abilities across several dimensions that cover fundamental musical concepts and their relation to cultural and functional contexts.

### 104. [—]

The MuChoMusic data and code are open-sourced, making the benchmark usable for locally evaluating candidate listening models for the DAW's AI-feedback subsystem.

> Data and code are open-sourced.

### 105. [—]

HalluAudio is presented as the first large-scale benchmark specifically for evaluating hallucinations in large audio-language models across speech, environmental sound, and music, containing over 5,000 human-verified question-answer pairs.

> the first large-scale benchmark for evaluating hallucinations across speech, environmental sound, and music... HalluAudio comprises over 5K human-verified QA pairs and spans diverse task types.

### 106. [—]

Benchmarking a broad range of open-source and proprietary audio-language models reveals significant deficiencies in acoustic grounding, temporal reasoning, and music attribute understanding — directly relevant to the reliability of audio LLMs for mix/production critique.

> Results reveal "significant deficiencies in acoustic grounding, temporal reasoning, and music attribute understanding," underscoring "the need for reliable and robust LALMs."

### 107. [—]

Audio-language models hallucinate by generating responses that are semantically incorrect or acoustically unsupported, and this failure mode has been under-explored in audio compared to text and vision domains.

> models generate responses that are semantically incorrect or acoustically unsupported

### 108. [—]

The benchmark's evaluation protocol quantifies fine-grained failure modes via hallucination rate, yes/no bias, error-type analysis, and refusal rate, and stress-tests models using adversarial prompts and mixed-audio conditions.

> hallucination rate, yes/no bias, error-type analysis, and refusal rate, enabling a fine-grained analysis of LALM failure modes... adversarial prompts and mixed-audio conditions

### 109. [—]

The abstract does not report per-model quantitative hallucination rates or name the specific models evaluated (e.g., Qwen2-Audio, SALMONN, GPT-4o), so specific numbers must be sourced from the full paper.

> The abstract does not name individual audio-language models tested. It only states generally that "we benchmark a broad range of open-source and proprietary models."

### 110. [—]

FAD (Frechet Audio Distance), the de-facto audio-generation quality metric, relies on a Gaussian assumption over audio embeddings that real-world audio data often violates, and suffers finite-sample bias scaling as O(1/N), which can be gamed by increasing sample count.

> FAD relies on the assumption that audio embeddings follow a Gaussian distribution, which often does not apply to real-world audio data... FAD suffers from an inherent bias in finite-sample estimation... increasing N can artificially reduce bias, leading to better FAD scores.

### 111. [—]

KAD (Kernel Audio Distance) is based on Maximum Mean Discrepancy (MMD), making it distribution-free, unbiased, and robust to smaller sample sizes — relevant for use as an objective audio-quality distance in a render-listen-critique loop where per-iteration sample counts are small.

> based on Maximum Mean Discrepancy (MMD), a non-parametric measure that makes no assumptions about the underlying distribution... KAD is independent of sample size

### 112. [—]

KAD is computationally much cheaper than FAD: O(dN²) vs FAD's O(dN² + d³) complexity, roughly three orders of magnitude faster at d=2048 with N=10k, plus over an order of magnitude additional speedup on GPU — supporting low-latency per-iteration evaluation.

> at d=2048 with N=10k, KAD runs ~3 orders of magnitude faster than FAD... more than an order of magnitude speedup [on GPU]

### 113. [—]

KAD correlates better with human perceptual judgments than FAD: on DCASE 2023 Task 7 (Foley sound generation, 9 models), KAD reaches Spearman correlation of -0.93 with human ratings versus -0.80 for FAD, with PANNs-WGLM embeddings performing best among VGGish, PANNs, CLAP, PaSST, OpenL3, and MERT.

> KAD achieves Spearman correlation of -0.93 versus FAD's -0.80 with human ratings using PANNs-WGLM embeddings

### 114. [—]

An open-source MIT-licensed implementation, kadtk (Kernel Audio Distance Toolkit), is available on GitHub with support for 13+ embedding models including CLAP, VGGish, PANNs, MERT, and WavLM — deployable server-side in the proposed DAW's evaluation pipeline.

> Toolkit: kadtk (Kernel Audio Distance Toolkit)... Repository: https://github.com/YoonjinXD/kadtk... License: MIT License

### 115. [—]

HTDemucs 4-stem source separation can run entirely client-side in a browser (no backend server) using ONNX Runtime Web, directly relevant to the DAW's web-audio/WASM stem-analysis subsystem.

> music source separation using Demucs AI model with WebGPU/WASM acceleration ... purely on the frontend without requiring a backend server.

### 116. [—]

The project uses Meta's HTDemucs model exported to ONNX (~172MB, hosted on Hugging Face Hub) and separates audio into four stems: drums, bass, other, and vocals.

> Meta's HTDemucs model ... 4-track separation: drums, bass, other, vocals

### 117. [—]

In-browser Demucs inference via ONNX Runtime Web requires SharedArrayBuffer and therefore Cross-Origin Isolation HTTP headers, a deployment constraint for any web DAW embedding this capability.

> ONNX Runtime Web requires SharedArrayBuffer

### 118. [—]

Acceleration uses WebGPU where available (e.g. Chrome, macOS Safari) with WASM as the fallback execution provider, and offers low-memory ONNX Runtime settings (enableCpuMemArena: false, enableMemPattern: false) for mobile devices.

> WebGPU acceleration (supported on macOS Safari, Chrome) ... WASM as fallback acceleration ... low memory settings

### 119. [—]

The project is MIT licensed but is a very small, early-stage repository (only 4 commits) with no published latency/throughput benchmarks, so real-time feasibility claims remain undemonstrated.

> MIT license ... No specific latency or throughput benchmarks are provided in the README


---

## Research process log

```
Q: Research the state of the art (2024–2026) in AI "listening" — machine analysis, …
Decomposed into 5 angles: Audio-language models & music understanding benchmarks, Automatic mixing/mastering research & products, Synth parameter inference / sound matching, LLM agent iterative music generation-critique loops, Stem separation, objective metrics & audio-LLM reliability limits
Audio-language models & music understanding benchmarks: 6 results
Automatic mixing/mastering research & products: 6 results
LLM agent iterative music generation-critique loops: 6 results
LLM agent iterative music generation-critique loops: 4 novel (2 filtered)
Synth parameter inference / sound matching: 6 results
Synth parameter inference / sound matching: 4 novel (2 filtered)
Stem separation, objective metrics & audio-LLM reliability limits: 6 results
Stem separation, objective metrics & audio-LLM reliability limits: 4 novel (2 filtered)
Fetched 24 sources → 119 claims → verifying top 25
[v2:MuChoMusic is a human-validated benchmar] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:Open audio-language models perform poorl] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Open audio-language models perform poorl] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Open audio-language models perform poorl] failed: You've hit your session limit · resets 7:10am (UTC)
"Open audio-language models perform poorly on music…": 0-0 (3 errored) ?
[v0:Evaluated models exhibit a strong langua] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Evaluated models exhibit a strong langua] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Evaluated models exhibit a strong langua] failed: You've hit your session limit · resets 7:10am (UTC)
"Evaluated models exhibit a strong language bias an…": 0-0 (3 errored) ?
[v0:CMI-Bench evaluates 11 open-source audio] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:CMI-Bench evaluates 11 open-source audio] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:CMI-Bench evaluates 11 open-source audio] failed: You've hit your session limit · resets 7:10am (UTC)
"CMI-Bench evaluates 11 open-source audio-text LLMs…": 0-0 (3 errored) ?
[v0:Current audio-LLMs cannot produce usable] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Current audio-LLMs cannot produce usable] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Current audio-LLMs cannot produce usable] failed: You've hit your session limit · resets 7:10am (UTC)
"Current audio-LLMs cannot produce usable continuou…": 0-0 (3 errored) ?
[v0:Audio-LLMs fail badly at fine-grained te] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Audio-LLMs fail badly at fine-grained te] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Audio-LLMs fail badly at fine-grained te] failed: You've hit your session limit · resets 7:10am (UTC)
"Audio-LLMs fail badly at fine-grained temporal tas…": 0-0 (3 errored) ?
[v0:Multimodal LLMs (Gemini 2.5 Pro/Flash, Q] failed: You've hit your session limit · resets 7:10am (UTC)
"MuChoMusic is a human-validated benchmark of 1,187…": 2-0 (1 errored) ✓
[v1:Multimodal LLMs (Gemini 2.5 Pro/Flash, Q] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Multimodal LLMs (Gemini 2.5 Pro/Flash, Q] failed: You've hit your session limit · resets 7:10am (UTC)
"Multimodal LLMs (Gemini 2.5 Pro/Flash, Qwen2.5-Omn…": 0-0 (3 errored) ?
[v0:State-of-the-art audio LLMs still fail t] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:State-of-the-art audio LLMs still fail t] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:Pipelines that layer symbolic reasoning/] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:State-of-the-art audio LLMs still fail t] failed: You've hit your session limit · resets 7:10am (UTC)
"State-of-the-art audio LLMs still fail to reliably…": 0-0 (3 errored) ?
[v1:Pipelines that layer symbolic reasoning/] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Pipelines that layer symbolic reasoning/] failed: You've hit your session limit · resets 7:10am (UTC)
"Pipelines that layer symbolic reasoning/solvers on…": 0-0 (3 errored) ?
[v0:The survey empirically tested eight open] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:The survey empirically tested eight open] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:The survey empirically tested eight open] failed: You've hit your session limit · resets 7:10am (UTC)
"The survey empirically tested eight open-source au…": 0-0 (3 errored) ?
[v0:Qwen-Audio was the strongest open-weight] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Qwen-Audio was the strongest open-weight] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Qwen-Audio was the strongest open-weight] failed: You've hit your session limit · resets 7:10am (UTC)
"Qwen-Audio was the strongest open-weights model in…": 0-0 (3 errored) ?
[v1:A documented failure mode: current music] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:A documented failure mode: current music] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:A documented failure mode: current music] failed: You've hit your session limit · resets 7:10am (UTC)
"A documented failure mode: current music-understan…": 0-0 (3 errored) ?
[v0:Even the strongest audio-language models] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:Even the strongest audio-language models] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:Music is the weakest domain for audio-la] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Even the strongest audio-language models] failed: You've hit your session limit · resets 7:10am (UTC)
"Even the strongest audio-language models score bar…": 0-0 (3 errored) ?
[v1:Music is the weakest domain for audio-la] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Music is the weakest domain for audio-la] failed: You've hit your session limit · resets 7:10am (UTC)
"Music is the weakest domain for audio-language mod…": 0-0 (3 errored) ?
[v0:The dominant failure mode of audio LLMs] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:The dominant failure mode of audio LLMs] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:Some open music-understanding models (MU] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:The dominant failure mode of audio LLMs] failed: You've hit your session limit · resets 7:10am (UTC)
"The dominant failure mode of audio LLMs is percept…": 0-0 (3 errored) ?
[v1:Some open music-understanding models (MU] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Some open music-understanding models (MU] failed: You've hit your session limit · resets 7:10am (UTC)
"Some open music-understanding models (MU-LLaMA, SA…": 0-0 (3 errored) ?
[v0:TinyMU is a 229M-parameter music-languag] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:TinyMU is a 229M-parameter music-languag] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:TinyMU is a 229M-parameter music-languag] failed: You've hit your session limit · resets 7:10am (UTC)
"TinyMU is a 229M-parameter music-language model th…": 0-0 (3 errored) ?
[v0:On the MuChoMusic music-understanding be] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:On the MuChoMusic music-understanding be] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:On the MuChoMusic music-understanding be] failed: You've hit your session limit · resets 7:10am (UTC)
"On the MuChoMusic music-understanding benchmark, T…": 0-0 (3 errored) ?
[v0:As of the ISMIR 2022 tutorial, deep-lear] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:As of the ISMIR 2022 tutorial, deep-lear] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:As of the ISMIR 2022 tutorial, deep-lear] failed: You've hit your session limit · resets 7:10am (UTC)
"As of the ISMIR 2022 tutorial, deep-learning autom…": 0-0 (3 errored) ?
[v0:The automatic-mixing literature divides] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:The automatic-mixing literature divides] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:The automatic-mixing literature divides] failed: You've hit your session limit · resets 7:10am (UTC)
"The automatic-mixing literature divides into two a…": 0-0 (3 errored) ?
[v1:Diff-MST (Vanka, Steinmetz, Rolland, Rei] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:Diff-MST (Vanka, Steinmetz, Rolland, Rei] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:Diff-MST predicts control parameters for] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Diff-MST (Vanka, Steinmetz, Rolland, Rei] failed: You've hit your session limit · resets 7:10am (UTC)
"Diff-MST (Vanka, Steinmetz, Rolland, Reiss, Fazeka…": 0-0 (3 errored) ?
[v1:Diff-MST predicts control parameters for] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:The system architecture consists of thre] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:Diff-MST predicts control parameters for] failed: You've hit your session limit · resets 7:10am (UTC)
"Diff-MST predicts control parameters for standard …": 0-0 (3 errored) ?
[v2:The system architecture consists of thre] failed: You've hit your session limit · resets 7:10am (UTC)
[v0:An open-source toolkit (automix-toolkit,] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:The system architecture consists of thre] failed: You've hit your session limit · resets 7:10am (UTC)
"The system architecture consists of three componen…": 0-0 (3 errored) ?
[v1:An open-source toolkit (automix-toolkit,] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:An open-source toolkit (automix-toolkit,] failed: You've hit your session limit · resets 7:10am (UTC)
"An open-source toolkit (automix-toolkit, Apache-2.…": 0-0 (3 errored) ?
[v0:The toolkit implements two learned autom] failed: You've hit your session limit · resets 7:10am (UTC)
[v1:The toolkit implements two learned autom] failed: You've hit your session limit · resets 7:10am (UTC)
[v2:The toolkit implements two learned autom] failed: You've hit your session limit · resets 7:10am (UTC)
"The toolkit implements two learned automix archite…": 0-0 (3 errored) ?
Verify done: 25 claims → 1 confirmed, 0 refuted, 24 unverified
[synthesize] failed: You've hit your session limit · resets 7:10am (UTC)
```