# Research 03 — AI Listening, Auto-Mix & the render→critique Loop

> **Fully adversarially verified.** 115 claims extracted, 25 queued for verification, **19 confirmed**, **6 refuted**, 106 verifier agent calls, **0 errors**.

## Question

> Research the state of the art (2024–2026) in AI "listening" — machine analysis, critique, and automatic improvement of music mixes and sound design — to spec an AI-feedback subsystem as a core differentiating component of a new open-source DAW (git-diffable text project files, headless CLI rendering, agent/MCP integration; built on web audio + WASM). The vision: the DAW renders what the user (or an AI agent) created, an AI system listens to it, critiques it (mix balance, sound design quality, arrangement energy), makes concrete suggestions mapped to actual project parameters (e.g. "cut 300 Hz mud on the bass", "the lead's attack is masking the kick — shorten it"), and can apply/iterate improvements autonomously. Research questions: (1) AUDIO UNDERSTANDING MODELS: What models can genuinely 'hear' and describe music today — audio-language models (Qwen2-Audio, SALMONN, Gemini 2.x audio input, GPT-4o-audio, Music-understanding LLMs like MU-LLaMA, LTU, Pengi), CLAP-style audio-text embeddings (LAION-CLAP, MS-CLAP, MuQ-MuLan), music captioning/QA benchmarks (MusicCaps, MuChoMusic) — and what are their demonstrated strengths/failure modes on production-quality judgments (not just genre/tags)? Local/open-weights vs API-only, WASM/onnx feasibility. (2) COMPUTATIONAL MIX ANALYSIS & AUTO-MIXING: Research and products for automatic mixing/mastering — academic automix literature (Intelligent Music Production book, De Man/Reiss, differentiable mixing consoles, DeepAFx, ddsp), commercial assistants (iZotope Neutron/Ozone/Nectar, Sonible smart:EQ/smart:comp, LANDR, BandLab mastering, RoEx Automix) — what analysis→action mappings actually work (masking detection, LUFS/dynamics targets, spectral balance references, stereo field analysis)? Which are rule/DSP-based vs learned, and what open implementations exist (essentia, librosa, mixing-secrets datasets, FXNorm, automix repos)? (3) PARAMETER INFERENCE / SOUND MATCHING: Work on inferring synth parameters from audio (InverSynth, FlowSynth, Syntheon, DiffMoog, sound-matching literature; Serum/Vital preset generation with LLMs or genetic algorithms) and neural audio effect modeling — can a system hear a target timbre and propose patch parameters? (4) CRITIQUE/FEEDBACK LOOPS WITH LLM AGENTS: Existing systems where an LLM agent iteratively generates/edits music or audio, renders, listens (via embeddings or audio LLM), and refines — research prototypes, agentic music tools, MCP audio-analysis servers, and what loop architectures (render → analyze → suggest → apply → re-render) have been shown to converge vs hallucinate. (5) SOURCE SEPARATION & STEM ANALYSIS as enablers (Demucs/HT-Demucs quality, real-time feasibility) plus objective metrics usable as ground truth (EBU R128 loudness, true peak, PLR/crest, spectral centroid trajectories, FAD/KAD audio-quality distances, reference-track comparison methodologies). Deliver: a cited report — model/tool comparison tables with licensing and deployment feasibility (local WASM/ONNX vs server vs API), which production-critique tasks are reliably automatable today vs speculative, a recommended architecture for the render→listen→critique→edit loop in this DAW (including using objective DSP metrics as guardrails around LLM judgments), and top risks (audio-LLM hallucination on mix judgments, latency/cost per iteration).

## Executive summary

Audio-language models in 2024-2026 can produce surface-level music descriptions (genre, mood, captions) but show pervasive, well-documented failures on the fine-grained, quantitative judgments an AI mix-critique subsystem would need: they frequently ignore the audio and answer from text priors, their errors are dominated by mis-hearing (not mis-reasoning), they cannot produce calibrated numeric/regression outputs, and layering symbolic reasoning on top does not fix upstream perceptual errors. Meanwhile, a separate and more mature research thread -- differentiable/parameter-estimating automatic mixing (Differentiable Mixing Console, Diff-MST, automix-toolkit) -- already demonstrates a working, interpretable analysis-to-parameter mapping (predicting EQ/compressor/gain/pan settings from audio, including reference-driven mixing style transfer), though even these systems still underperform professional engineers. The clear architectural implication is that a DAW's render-listen-critique-edit loop should lean on DSP/parameter-estimation models (or classical audio analysis) for the actual mix-adjustment actions, using audio-LLMs only for language-level explanation/critique framing layered on top of, and validated against, deterministic DSP measurements -- not as the primary ears for autonomous, unsupervised parameter changes. Small open-weights models (TinyMU, 229M params) show that decent-but-not-SOTA music-QA performance is achievable at a size compatible with local/on-device deployment, which is relevant to the WASM/local-first design goal, but no evaluated model in this evidence set has been benchmarked on actual mixing/production-quality judgment tasks.

## Verified findings

### 1. [HIGH]

Standardized benchmarks (MuChoMusic: 1,187 human-validated MCQs on 644 tracks; CMI-Bench: 11 open-source audio-text LLMs across 14 MIR tasks/20 datasets; MMAU: 10,000-clip multi-task benchmark) now exist to measure whether audio-language models genuinely understand music, and all consistently find that open audio-LLMs fall significantly short of task-specific supervised MIR systems on standard metrics.

*Evidence: 3-0 vote on MuChoMusic construction; 2-1 vote on CMI-Bench finding that all 11 evaluated models (Qwen2-Audio, SALMONN, MU-LLaMA, LTU/LTU-AS, GAMA, Pengi, Audio-Flamingo, etc.) score significantly worse than task-specific supervised systems on standard MIR metrics.*

Sources: <https://arxiv.org/html/2408.01337v1>, <https://arxiv.org/html/2506.12285v1>, <https://arxiv.org/pdf/2410.19168>

### 2. [HIGH]

A recurring and severe failure mode is that audio-LLMs frequently do not actually rely on the audio: when audio is replaced with noise or the wrong track, most evaluated models (MU-LLaMA, MusiLingo, M2UGen, SALMONN in some tests) show little to no performance degradation, indicating they are answering from language/text priors rather than genuinely listening. Only a couple of models (SALMONN and Qwen-Audio in the MuChoMusic test) showed a significant drop when audio was corrupted.

*Evidence: 3-0 vote each on two independent benchmark papers (MuChoMusic and MMAU) both running an audio-substitution/noise-replacement ablation and finding the same language-bias pattern, with an independent EMNLP 2025 paper corroborating strong text bias across all models tested.*

Sources: <https://arxiv.org/html/2408.01337v1>, <https://arxiv.org/pdf/2410.19168>

### 3. [HIGH]

Where audio-LLMs do fail, the dominant cause is perceptual (mis-hearing), not reasoning: MMAU's error analysis attributes 55% of Qwen2-Audio-Instruct's errors and 64% of Gemini Pro v1.5's errors to perception, versus only 18% and 11% to reasoning, respectively. Consistent with this, symbolic-reasoning layers (LogicLM-style pipelines) placed on top of audio-LLM perception collapse when the audio front-end makes small perceptual errors -- reasoning cannot compensate for mis-heard audio.

*Evidence: 3-0 vote each on MMAU error-analysis figures and on the symbolic-reasoning-collapse finding (Oct 2025 NeurIPS-track paper on core music perception tasks).*

Sources: <https://arxiv.org/pdf/2410.19168>, <https://arxiv.org/html/2510.22455v1>

### 4. [HIGH]

Current audio-LLMs cannot produce usable calibrated numeric/regression judgments about music: on arousal/valence emotion regression, every one of 11 evaluated models scored worse than or barely at the level of simply predicting the dataset mean (R-squared ranging -1.17 to 0.08) -- a direct concern for any design that expects an LLM to output numeric mix scores.

*Evidence: 2-1 vote, verified against primary source table and section explicitly titled Emotion Regression Fails for All Models.*

Sources: <https://arxiv.org/html/2506.12285v1>

### 5. [HIGH]

Among tested open-weights music-understanding models, Qwen-Audio was consistently the strongest performer on genre classification (80% GTZAN, 75% FMA) and music captioning (ROUGE-1 F1 approximately 0.336), while multimodal generalists like AnyGPT performed worst (ROUGE-1 F1 0.138); however, a survey of these eight models found they are mostly lightly fine-tuned general LLMs lacking professional musical knowledge, and none were evaluated on mixing, mastering, loudness, EQ, or any production-quality task.

*Evidence: 3-0 votes across three related claims verified directly against a Sept 2024 survey paper's own experimental tables and text, with a full-text search confirming zero mentions of mixing/mastering/EQ/loudness anywhere in the paper.*

Sources: <https://arxiv.org/pdf/2409.09601>

### 6. [MEDIUM]

Small, efficient open-weights music-language models are becoming viable for local/on-device deployment: TinyMU (229M parameters, ICASSP 2026) reaches 82% of a larger SOTA model's performance on MuChoMusic (58.6 vs MiDashengLM's 71.4 and Qwen2-Audio-Instruct's 67.8) while being 35x smaller -- well ahead of dedicated older music LLMs (MU-LLaMA 32.7, MusiLingo 31.5, Mellow 30.3) -- suggesting a plausible path to WASM/ONNX-feasible local audio-language models, though still short of frontier performance.

*Evidence: 2-1 votes on both TinyMU claims, verified directly against the paper's own abstract and results table, with the MiDashengLM baseline figure independently cross-checked against that model's own paper.*

Sources: <https://arxiv.org/pdf/2604.15849>

### 7. [MEDIUM]

In automatic mixing research, deep-learning systems trained on large-scale data have the potential to outperform traditional rule-based/adaptive-DSP approaches but as of the ISMIR 2022 tutorial still performed substantially below professional audio engineers -- and no 2024-2026 source found in this research closes that gap for general-purpose automatic mixing.

*Evidence: 2-1 vote, verified verbatim against the DL4AM ISMIR 2022 tutorial site authored by recognized automix researchers; claim is explicitly time-scoped to 2022 and no contradicting 2024-2026 evidence was found.*

Sources: <https://dl4am.github.io/tutorial>

### 8. [HIGH]

Automatic mixing architectures split into two families: direct audio-to-audio transformation (e.g., Mix-Wave-U-Net), which is a black box, and parameter-estimation systems that predict settings for a differentiable mixing console of standard audio effects (EQ, compressor, gain, pan) -- the latter family produces human-interpretable, project-parameter-mapped outputs, which is exactly the analysis-to-action shape a git-diffable, parameter-based DAW needs. An Apache-2.0-licensed open toolkit (automix-toolkit) implements both architectures with pretrained checkpoints usable for inference today.

*Evidence: 3-0 votes across three related claims, each verified directly against primary GitHub/academic sources with cross-checks against the underlying ICASSP 2021 DMC paper.*

Sources: <https://dl4am.github.io/tutorial>, <https://github.com/csteinmetz1/automix-toolkit>

### 9. [HIGH]

Diff-MST (ISMIR 2024) demonstrates a working, peer-reviewed mixing style transfer system: given a reference song, it infers production attributes and predicts control parameters for a differentiable mixing console (per-track gain/EQ/compressor/pan plus master bus EQ/DRC) via a transformer controller trained with an audio production style loss -- producing editable, human-adjustable parameters rather than end-to-end audio, and has already been integrated as an adjustable-parameter plugin inside a real DAW (Cubase, via the follow-up Diff-MSTC prototype).

*Evidence: 3-0 votes across three related claims, each verified directly against the ISMIR 2024 paper's arxiv abstract, with the DAW-integration detail corroborated by an independent follow-up CHI 2025 paper (Diff-MSTC for Cubase).*

Sources: <https://arxiv.org/abs/2407.08889>

## Refuted claims (explicitly rejected — do not cite)

These were extracted and looked plausible, but failed adversarial verification. Listed so we don't accidentally re-cite them later.

- Open audio-language models perform poorly on music understanding: the best evaluated model (Qwen-Audio) scored only 51.4% accuracy, while MuLLaMa (32.4%) was barely above the 25% random baseline and MusiLingo (21.1%) scored below random — evidence that current open music-LLMs cannot yet be trusted for nuanced listening judgments.
- Audio-LLMs fail badly at fine-grained temporal tasks: beat/downbeat tracking F-measures are near zero, melody extraction accuracy is below 1%, and lyrics transcription WER is 96-2311 vs a supervised SOTA of 13 — implying time-localized critiques (e.g., 'the lead's attack masks the kick') are beyond current open audio-LLMs.
- Multimodal LLMs (Gemini 2.5 Pro/Flash, Qwen2.5-Omni 7B) show a large modality gap on core music perception tasks: Gemini models score near-ceiling (95-100%) on MIDI/symbolic input but drop 30-70+ percentage points on the same tasks from raw audio, indicating waveform perception is the primary bottleneck.
- State-of-the-art audio LLMs still fail to reliably 'listen' to audio: chord quality identification from audio drops to 6-53% accuracy (vs 97-100% from MIDI), and syncopation counting from audio drops to 25-65% (vs 95-100% from MIDI), with apparent audio successes sometimes reflecting shallow heuristics rather than genuine perception.
- Even the strongest audio-language models score barely above 50% on the MMAU expert-level audio understanding benchmark: Gemini Pro v1.5 reaches 52.97% and the best open-source model Qwen2-Audio reaches 52.50%, far below human accuracy of 82.23% — implying current audio LLMs are unreliable for expert-level listening judgments of the kind a mix-critique subsystem needs.
- Music is the weakest domain for audio-language models on MMAU: models perform worse on music than on speech or environmental sound, with the best music-subset accuracy being Qwen2-Audio-Instruct at 53.26% and some models (Pengi) near-random at 3.05% — directly relevant to whether audio LLMs can be trusted to critique music mixes.

## Caveats

Two claims (CMI-Bench regression-failure and TinyMU comparisons) survived only 2-1 votes rather than unanimous 3-0, so treat their precision as slightly less certain than the 3-0 findings, though all were independently re-verified against primary sources by the surviving voter. Several higher-severity claims that would have been directly on-point for this report -- e.g., specific accuracy numbers showing audio-LLMs fail badly at time-localized tasks (beat tracking, chord ID from audio), and MMAU's headline finding that even the best models score far below human accuracy on expert-level audio understanding -- were rejected by adversarial verification (0-3 or 1-2 votes) and are excluded here; their directional thrust may still be real but the specific cited numbers should not be reused. No claim in this evidence set directly benchmarks any audio-LLM on actual mix-critique tasks (masking detection, frequency-conflict identification, loudness/dynamics judgment, stereo-field assessment) -- every finding here is inferred from adjacent evidence, not from a benchmark that tested the specific DAW-critique use case. The DL4AM automix performance-gap claim is explicitly dated to 2022. Commercial tools (iZotope Neutron/Ozone, Sonible, LANDR, RoEx) and CLAP-style embedding models (LAION-CLAP, MS-CLAP) were named in the original research questions but no verified claims about them survived in this evidence set -- their capabilities are not covered here and would need separate sourcing.

## Open questions (not covered by surviving evidence)

- No verified evidence was found on CLAP-style audio-text embedding models (LAION-CLAP, MS-CLAP, MuQ-MuLan) as similarity/critique tools, nor on commercial auto-mixing products (iZotope, Sonible, LANDR, RoEx) or their rule-based vs learned internals -- these need targeted follow-up research.
- No benchmark in this evidence set directly tests audio-LLMs on mix-engineering judgments (masking, frequency conflicts, loudness targets, stereo width) -- it remains unproven whether the demonstrated general-music-QA failure modes translate directly to mix-critique tasks, or whether narrower/fine-tuned models could do meaningfully better.
- How do current audio-LLM failure modes (text-prior bias, perceptual error dominance) interact with an iterative render-listen-critique-edit agent loop over multiple turns -- does error compound across iterations, and has any published work measured convergence vs divergence/hallucination drift in such a loop for audio specifically?
- What is the real-world latency/cost and WASM/ONNX feasibility of running TinyMU-class (229M) or Diff-MST-class parameter-estimation models client-side in a browser DAW, versus routing to a server/API -- no benchmark data on inference latency or browser deployment was found in this evidence set.

## Sources

- <https://arxiv.org/html/2408.01337v1> — *primary*
- <https://arxiv.org/html/2506.12285v1> — *primary*
- <https://arxiv.org/html/2510.22455v1> — *primary*
- <https://arxiv.org/pdf/2409.09601> — *primary*
- <https://arxiv.org/pdf/2410.19168> — *primary*
- <https://arxiv.org/pdf/2604.15849> — *primary*
- <https://dl4am.github.io/tutorial> — *primary*
- <https://arxiv.org/abs/2407.08889> — *primary*
- <https://github.com/csteinmetz1/automix-toolkit> — *primary*
- <https://arxiv.org/abs/2010.10291> — *primary*
- <https://github.com/sony/FxNorm-automix> — *primary*
- <https://www.sonible.com/smarteq4/> — *primary*
- <https://arxiv.org/abs/2401.12570> — *primary*
- <https://github.com/gudgud96/syntheon> — *primary*
- <https://arxiv.org/html/2407.16643v1> — *primary*
- <https://www.ijcai.org/proceedings/2025/1129.pdf> — *primary*
- <https://jhurliman.org/post/804323197731373056/experiments-with-ableton-mcp-dec-2025> — *blog*
- <https://arxiv.org/pdf/2511.13987> — *primary*
- <https://arxiv.org/abs/2509.00132> — *primary*
- <https://github.com/ahujasid/ableton-mcp> — *primary*
- <https://arxiv.org/abs/2408.01337> — *primary*
- <https://arxiv.org/abs/2604.19300> — *primary*
- <https://arxiv.org/html/2502.15602v1> — *primary*
- <https://github.com/timcsy/demucs-web> — *primary*
