# Raw scan: DAW automation / taste-model hill-climbing / production RAG / sub-task evals

*Raw findings dump from a single research-agent pass, 2026-07-21, saved verbatim for the
numbered docs (116-119) to draw on. Labels: **[C]** = confirmed (primary source or multiple
corroborating sources), **[S]** = single-source, **[I]** = inconclusive/negative finding.*

## 1) State of the art in automating DAW use

**LLM agents operating DAWs (exists, but young and narrow):**

- **DAWZY** (arXiv, Dec 2025) — the closest thing to a published "LLM operates a real DAW" SOTA.
  Natural language/voice/humming → LLM code generation + 3 MCP tools (live state query, parameter
  adjustment, beat generation) executing as reversible atomic ReaScripts in REAPER. Search-snippet
  claims 100% task success with GPT-5 on multi-instruction FX/automation/GUI tasks vs 25–50% for
  open-source models; abstract confirms positive user ratings but the 100% figure is from a search
  snippet only. **[C]** for existence/architecture (https://arxiv.org/abs/2512.03289); **[S]** for
  the exact success-rate numbers.
- **AbletonMCP** — open-source MCP server giving Claude two-way control of Ableton Live; widely
  used in practice, not a paper. **[C]** (https://www.flowhunt.io/mcp-servers/ableton-live/)
- **JAMMIN-GPT** (arXiv 2312.03479) — text-based improvisation inside Ableton Live via clip-name
  polling + ChatGPT. **[C]**
- **WavCraft** (arXiv 2403.09527) — LLM agent decomposing audio editing/creation instructions into
  calls to expert audio models; audio-content editing, not DAW operation. **[C]**
- **FilmComposer** (arXiv 2503.08147) — LLM agent drives REAPER to arrange/mix music for silent
  film clips. **[S]**
- **ReaperAI** — LLM-driven REAPER automation project. **[S]**
  (https://www.emergentmind.com/topics/reaperai)
- **MIDI Agent** — commercial VST generating MIDI in Ableton via ChatGPT/Claude. **[S]**
  (https://www.midiagent.com/ai-midi-generator-for-ableton-live)

**Next-production-action models trained on edit logs: none found.** Searches for action-sequence
prediction on DAW edit histories return only business-process-mining "next activity prediction"
(the "DAW-Transformer" hit is an unrelated acronym) and generic HCI next-action prediction (arXiv
2603.05923). No paper mining DAW project files or edit histories to model production action
sequences surfaced. Adjacent artifacts: **dawtool** (reverse-engineered Ableton/FL project
parsers, https://github.com/offlinemark/dawtool) and a synthetic CoT DAW-instruction dataset on HF
(https://huggingface.co/datasets/mattwesney/CoT_Music_Production_DAW). **[I]** — an open gap
(relevant whitespace for dotbeat).

**AI mixing/mastering (the mature commercial+academic corner):**

- Steinmetz et al., "Deep learning for automatic mixing" — ISMIR 2022 tutorial/book +
  automix-toolkit; challenges: artifact intolerance, limited multitrack data, controllability.
  **[C]** (https://dl4am.github.io/tutorial/landing-page.html,
  https://csteinmetz1.github.io/automix-toolkit/)
- Differentiable mixing console (arXiv 2010.10291); Sony FxNorm-Automix (ISMIR 2022,
  https://marco-martinez-sony.github.io/FxNorm-automix/); generative effect-embedding mixing
  (arXiv 2511.08040). **[C]**
- Commercial SOTA: iZotope Neutron 5 / Ozone Master Assistant; RoEx stem-based auto-mixing.
  **[C]** (https://www.izotope.com/en/learn/ai-mastering)
- DAW-native AI is mostly **generation/separation, not action prediction**: Ableton Live 12.3 =
  stem separation (Moises-powered) + Splice integration **[C]**; Logic Pro Session Players +
  Stem Splitter **[C]** (https://horiamc.com/blog/logic-pro-12-ai-features-review).
- **Hookpad Aria** (arXiv 2502.08122) — best-documented "copilot" deployment: Anticipatory Music
  Transformer fine-tuned on Hooktheory's TheoryTab (~50k analyses); continuation/infill/
  harmony-from-melody; real usage: 318k suggestions, 3k users, 74k accepted. **[C]**
  (https://www.hooktheory.com/hookpad/aria)

## 2) Hill-climbing against a learned taste/reward model in audio

- **MusicRL** (arXiv 2402.04229, Google DeepMind) — first large-scale RLHF for music: MusicLM
  finetuned on 300k pairwise user preferences plus designed rewards; RLHF-tuned models preferred
  over baseline. Directly the "learned taste model as optimization target" precedent. **[C]**
- **TangoFlux / CLAP-Ranked Preference Optimization** (arXiv 2412.21037) — generates candidates,
  ranks by CLAP score, DPO-trains on the ranking: literally hill-climbing a learned audio-text
  critic. **[C]**
- **SMART** (arXiv 2504.16839) — tunes a symbolic music generator against an audio-domain
  aesthetic reward; explicitly notes diversity collapse from over-optimization (Goodhart) and
  mitigations: KL penalty, entropy bonus, early stopping at reward saturation. Closest published
  analog to dotbeat's vary/rate loop failure modes. **[S]**
- **DRAGON** (arXiv 2504.15217) — distributional reward optimization for music diffusion,
  including FAD-style distributional targets as rewards. **[S]**
- **SCORE** (arXiv 2509.19831) — composite standardized rewards; motivates multiple reward models
  to resist single-critic hacking. **[S]**
- **Evolutionary synth-patch search vs perceptual metrics** — GA sound matching on FM synths with
  MFCC/spectral/perceptual composite fitness (composite beats single-criterion); PresetGen;
  coevolutionary CGP evolving whole Pd synthesizers; QD variants. **[C]**
  (https://dl.acm.org/doi/10.1145/2576768.2598303, https://arxiv.org/pdf/2506.22628 — the latter
  also evaluates which similarity metrics are safe to iterate against)
- **Reward hacking evidence:** image-domain analysis in arXiv 2601.03468 **[S]**; in audio, the
  documented failure is diversity collapse / Goodhart under aesthetic-reward optimization (SMART)
  and CLAP-score gaming concerns motivating multi-reward setups (SCORE, MR-FlowDPO arXiv
  2512.10264). No canonical "audio reward hacking" case-study paper yet. **[I]**

## 3) In-context "bag of production tricks" — retrievable knowledge bases

- **Sound on Sound "Synth Secrets"** — Gordon Reid, 63 parts; community GitHub repo has it in
  markdown (ideal for RAG). **[C]** (https://www.soundonsound.com/series/synth-secrets-sound-sound,
  https://github.com/micjamking/synth-secrets)
- **Attack Magazine, "The Secrets of Dance Music Production"** — 312-page structured walkthrough
  (synthesis, EQ, compression, layering, bass splitting, mastering). **[C]**
- **Mike Senior, "Mixing Secrets for the Small Studio"** — the standard general mixing text. **[C]**
- **Academic ontologies** (machine-readable production knowledge): Studio Ontology Framework
  (Fazekas & Sandler), Audio Effects Ontology (Wilmering et al., ISMIR 2013), AUFX-O. **[C]**
  (https://archives.ismir.net/ismir2013/paper/000041.pdf)
- **RAG for music-domain LLMs:** MusT-RAG (arXiv 2507.23334) — +15% factual gain over GPT-4o on
  music QA. **[C]** Also RAG for symbolic generation (arXiv 2311.10384) **[S]**, ArtistMus/
  MusWikiDB 3.2M passages (arXiv 2512.05430) **[S]**. No published work retrieves
  *production-technique* knowledge for LLM agents — another gap. **[I]**

## 4) Evaluating accompaniment/production sub-tasks

- **SingSong** (arXiv 2301.12662) — vocals→instrumental. Eval: FAD on MUSDB18 + pairwise
  listening vs baselines (preferred over random accompaniment 74%, key/tempo-matched retrieval
  66%, ground-truth instrumental 34%). The retrieval-baseline ladder is a useful eval design
  pattern. **[C]**
- **Bass Accompaniment Generation via Latent Diffusion** (Sony CSL, arXiv 2402.01412) —
  mix-conditioned bass stem generation with timbre grounding; exactly the dotbeat sub-task.
  **[C]** (https://sonycslparis.github.io/bass_accompaniment_demo/)
- **Diff-A-Riff** (Sony CSL, ISMIR 2024, arXiv 2406.08384) — general single-stem accompaniment;
  objective + subjective eval; follow-up arXiv 2410.23005. **[C]**
- **JukeDrummer** (ISMIR 2022, arXiv 2210.06007) — drumless audio→drum track; rhythmic/stylistic
  consistency eval. **[C]**
- Related: FastSAG (IJCAI 2024), Multi-Track MusicLDM (arXiv 2409.02845). **[S]**
- **FAD caveats** (matters for a taste-model critic): correlation with human perception is
  embedding-dependent (arXiv 2403.17508); Microsoft's FAD adaptation (arXiv 2311.01616) shows
  sample-size bias and reference-set sensitivity — recommends FAD-inf and per-song FAD; blind to
  long-range temporal structure. **[C]**
- **No "music production task" benchmark suite for agents found**; closest is DAWZY's ad-hoc
  REAPER task battery. **[I]**

## Bottom-line gaps relevant to dotbeat

No next-production-action model on edit logs, no production-technique RAG corpus paper, no
standardized DAW-agent benchmark — while the pieces dotbeat composes (RLHF/CLAP hill-climbing
with documented Goodhart mitigations, accompaniment eval protocols with retrieval baselines +
FAD caveats, MCP DAW control) each have citable precedent.
