# 116 — State of the art in automating the USE of DAWs (and the next-edit-prediction question)

*Run 2026-07-21 at the owner's request. Single-agent web pass (search + targeted fetches),
NOT adversarially verified — per-claim confidence labels are self-reported; treat anything
marked (medium) or below as a lead, not a fact. The driving question: does anything like a
next-action-prediction model for DAWs exist — a model that, given a project state, predicts the
producer's likely next edit — and is that direction worth dotbeat's investment, given that
dotbeat's git-native format makes every project an ordered, semantic edit history?*

## Headline answers

1. **No shipping or published system predicts a producer's next edit from DAW project state.**
   Every AI-DAW product found automates content generation, point transforms, or
   instruction-following — none does proactive edit prediction. (High confidence as
   absence-of-evidence after this pass; a negative can't be proven.)
2. **The exact analogue is proven and shipping in code editing** — GitHub Copilot Next Edit
   Suggestions, Cursor Tab, Zed's open Zeta model — and the published recipes say precisely what
   data it takes: ordered intermediate edit sequences with session boundaries and
   accept/reject outcomes. Endpoint diffs (PR-style) were explicitly found insufficient. (High.)
3. **dotbeat is unusually well positioned on data shape but not on data volume.** The
   single shared apply path (GUI/CLI/MCP all funnel through the same semantic edit ops) is
   exactly the collection point the NES team had to build custom infrastructure for. But the
   proven recipes span ~500 curated examples (Zeta v1) to 400M+ predictions/day (Cursor online
   RL); a solo owner's organic use sits at the very bottom of that range for years.
4. **Recommendation: don't train now; log now, and ship the LLM-side version of the feature as
   the data-collection vehicle.** Details in §5.

---

## 1. Commercial / product landscape

### 1.1 Chat-copilot DAWs — instruction-following, not prediction

- **WavTool** was the canonical example: a browser DAW with an embedded GPT-4 chatbot ("the
  Conductor") that could "take action in the DAW, based on commands from GPT" — chat sidebar in,
  structured DAW actions out. Acquired by **Suno in June 2025**; the product itself was
  discontinued and its team folded into Suno.
  ([Suno blog](https://suno.com/blog/suno-acquires-wavtool),
  [AudioCipher's WavTool writeup](https://www.audiocipher.com/post/ai-daw),
  [TechCrunch](https://techcrunch.com/2025/06/26/suno-snaps-up-wavtool-for-its-ai-music-editing-tools-amid-ongoing-dispute-with-music-labels/)).
  Interaction pattern: **user asks → agent executes**. The user supplies intent every time;
  the system never anticipates. (High.)
- **Suno Studio** (launched Sept 2025, Premier-plan beta) is what that acquisition became: a
  "generative audio workstation" — multi-track timeline where the primitives are *generated
  stems* ("create infinite stem variations… vocals, drums, and synths that flow with existing
  audio"), exportable as audio and MIDI.
  ([Suno announcement](https://about.suno.com/blog/suno-studio),
  [Billboard](https://www.billboard.com/pro/ai-music-company-suno-launches-daw-rival-logic-ableton/)).
  Pattern: **generation-first DAW** — the model supplies material, the human arranges. Not
  edit prediction. (High.)
- **HitCraft (Session42)** — chat "virtual producer": upload a sketch, pick a style, get a
  polished track in minutes, download the project into your DAW. Explicitly built from
  human-created sound elements. ([hitcraft.ai](https://hitcraft.ai/),
  [MusicTech](https://musictech.com/news/music/israeli-ai-music-session42-new-production-tool/)).
  Pattern: one-shot production service with chat refinement. (Medium — vendor sources.)
- **TuneFlow** — open-source "next-gen DAW" whose differentiator is a Python plugin system for
  hanging AI models (songwriting, arrangement, mixing, transcription) off the DAW's project
  model. ([tuneflow GitHub](https://github.com/tuneflow/tuneflow),
  [tuneflow-py](https://github.com/tuneflow/tuneflow-py)). Architecturally the closest cousin
  to dotbeat's agent-native thesis (models as first-class editors of the project model), but the
  plugins are invoked, not anticipatory. (Medium.)
- **Soundverse Agent**, **GroovePilot** (chat about chords/voice-leading/arrangement), and
  **Feater** (an Ableton workflow assistant driving Live from natural language — single KVR
  forum source, treat as a lead) round out the copilot tier.
  ([Soundverse](https://www.soundverse.ai/blog/article/what-is-an-ai-music-copilot),
  [GroovePilot](https://groovepilot.co/),
  [KVR thread](https://www.kvraudio.com/forum/viewtopic.php?p=9156572)). (Low-medium.)
- **The MCP ecosystem** — `ableton-mcp` (~2.8k stars) and its dozen siblings puppet a live DAW
  over a socket for an external LLM agent. Already verified in this repo's own research
  (`docs/research/06-demand-and-adjacent-tools.md`); dotbeat's `beat mcp` is the
  file-native version of the same pattern. Again: instruction-following. (High, prior verified.)

### 1.2 Incumbent DAWs — ML as point tools, never as a next-action layer

- **Ableton Live 12 / 12.3**: MIDI Generators (the "Generators by Iftah" pack — constrained
  melody/rhythm generation), sound-similarity search in the browser, and in 12.3 **stem
  separation** licensed from Music AI/Moises, plus Splice integration.
  ([Ableton 12.3 blog](https://www.ableton.com/en/blog/live-12-3-is-coming/),
  [Live 12 features](https://www.ableton.com/en/live/all-new-features/),
  [Ableton stem separation](https://www.ableton.com/stem-separation-in-ableton-live/)).
  All are *invoked transforms on content*. No copilot, no prediction. (High.)
- **Logic Pro**: **Session Players** (AI bass/keyboard/drummer that "responds directly to user
  feedback" — parameterized virtual performers, the closest any incumbent gets to an
  agent-like collaborator), **Stem Splitter** (six stem categories as of 11.2), ChromaGlow.
  ([Apple newsroom](https://www.apple.com/newsroom/2024/05/logic-pro-takes-music-making-to-the-next-level-with-new-ai-features/),
  [Apple support — Stem Splitter](https://support.apple.com/guide/logicpro/extract-vocal-instrumental-stems-stem-lgcp61bae908/mac)).
  Session Players automate *performance* (what a hired player would play), not *production
  edits* (what the producer would do next). (High.)
- **RipX DAW** — markets itself as "the first AI DAW": stem separation plus note-level editing
  of audio in a proprietary "Rip" representation.
  ([MusicRadar](https://www.musicradar.com/news/ripx-ai-daw),
  [AudioCipher](https://www.audiocipher.com/post/ripx-daw)). The AI is representation
  extraction (audio → editable notes), not workflow automation. (Medium.)
- **Magenta Studio** — free Ableton plugin suite: Continue, Groove, Generate, Drumify,
  Interpolate — ML models applied to MIDI clips on demand.
  ([magenta.withgoogle.com/studio](https://magenta.withgoogle.com/studio/),
  [Ableton blog](https://www.ableton.com/en/blog/magenta-studio-free-ai-tools-ableton-live/)).
  "Continue" is next-*note* prediction — the content-level ancestor of what we're asking about,
  a decade of it, and still packaged as a button you press. (High.)
- **AIVA / Suno / Udio** — adjacent but categorically different: they generate finished music
  (or stems) from prompts; they don't touch the question of automating a DAW's use. Suno's
  Studio move (above) is the one that crosses over. (High, common knowledge tier.)

### 1.3 Synthesis: the interaction-pattern map

Every product found lands in one of three patterns — none in the fourth:

| Pattern | Examples | Who supplies intent |
|---|---|---|
| **Generate content** (notes/audio in) | Suno Studio, Magenta Studio, Live's MIDI Generators, Session Players, HitCraft | Human prompts, model fills |
| **Point transforms** (invoked tools) | Stem separation everywhere, RipX, Groove/Drumify | Human clicks, model computes |
| **Instruction-following agents** | WavTool Conductor, MCP ecosystem, Feater, dotbeat's own `beat mcp` | Human asks in language, agent executes |
| **Proactive next-edit prediction** | **— nobody —** | Model anticipates, human tab-accepts |

The tab-complete interaction that remade code editors (2021-2026) has **no shipping analogue in
any DAW**. That's the finding, and it cuts both ways: open ground, and zero market validation
that producers want it.

---

## 2. Academic / research landscape

### 2.1 LLM agents driving music tools

- **MusicAgent** (Microsoft, [arXiv:2310.11954](https://arxiv.org/abs/2310.11954)) — an LLM
  task-planner/tool-selector/executor over a toolbox of music models (HF, GitHub, APIs).
  HuggingGPT-for-music; decomposes a user request into subtasks. (High.)
- **ComposerX** ([arXiv:2404.18081](https://arxiv.org/abs/2404.18081)) — multi-agent GPT-4
  symbolic composition (ABC notation); multi-agent debate measurably improves output quality
  over single-shot GPT-4, ~$0.8/piece. **CoComposer**
  ([arXiv:2509.00132](https://arxiv.org/abs/2509.00132)) continues the line. (High that they
  exist and claim this; outputs are student-grade compositions, not production work.)
- These all *compose*; none models a human's workflow. Their relevance to dotbeat: they
  validate that LLMs can drive symbolic music representations competently — which `.beat` is.

### 2.2 Symbolic music models — next-note, infilling, and the first personalization signs

- **Anticipatory Music Transformer** (Thickstun et al.,
  [arXiv:2306.08620](https://arxiv.org/abs/2306.08620),
  [CRFM writeup](https://crfm.stanford.edu/2023/06/16/anticipatory-music-transformer.html)) —
  autoregressive generation *conditioned asynchronously on future controls* (interleaved
  event/control tokens over Lakh MIDI); human-competitive 20-second accompaniments. The
  strongest machinery for "complete this musical material given constraints." (High.)
- **MIDI-GPT** (Metacreation, AAAI 2025,
  [arXiv:2501.17011](https://arxiv.org/abs/2501.17011)) — track- and bar-level **infilling**
  with attribute conditioning (density, polyphony, duration), with a **Cubase integration
  prototype** — a generative model living inside a real DAW's editing workflow. (High.)
- **MIDI-RWKV** ([arXiv:2506.13001](https://arxiv.org/abs/2506.13001)) — "personalizable
  long-context symbolic music infilling": efficient fine-tuning to a specific user's material on
  consumer hardware. First signs of the *personal* symbolic model. (Medium — not yet widely
  replicated.)
- Framing: all of these predict **the next notes**, i.e. the *content*. None predicts **the next
  edit** — the producer's action (add a track, tweak a cutoff, quantize, duplicate a section).
  Content models could be a component of an edit predictor (proposing the payload of an
  `add-note` batch), but they are not one.

### 2.3 Next-edit prediction in code — the direct, transferable precedent

- **GitHub Copilot Next Edit Suggestions** ([githubnext
  project page](https://githubnext.com/projects/copilot-next-edit-suggestions/),
  [custom-model training
  blog](https://github.blog/ai-and-ml/github-copilot/evolving-github-copilots-next-edit-suggestions-through-custom-model-training/)) —
  predicts the next meaningful change across the codebase after an edit, presented as small
  tab-acceptable diffs. The training writeup is the single most transferable document for
  dotbeat: **PR data was insufficient** because it "shows only the final state, not the
  intermediate edits… [and] lacks temporal ordering"; they ran "a large-scale custom data
  collection effort that captured code editing sessions from internal volunteers"; **"a smaller
  volume of high-quality edit data led to better models than a larger volume less curated"**;
  and negative samples ("the correct action is making no edit") mattered. SFT then RL with an
  LLM grader. (High — first-party engineering blog.)
- **Zed Zeta** ([blog](https://zed.dev/blog/edit-prediction),
  [Zeta2 rebuild](https://zed.dev/blog/zeta2),
  [open dataset](https://huggingface.co/datasets/zed-industries/zeta)) — open-source edit
  prediction: Qwen2.5-Coder-7B fine-tuned (LoRA/Unsloth). Calibration points: **v1 shipped off
  ~400-500 curated examples** (bootstrapped from ~50 Claude-written synthetic ones); **Zeta2
  trained on ~100k examples** collected opt-in from users in open-source repos. (High —
  first-party, dataset public.)
- **Cursor Tab-RL** ([cursor.com/blog/tab-rl](https://cursor.com/blog/tab-rl)) — the ceiling of
  the recipe: **online RL from live accept/reject signals** (+0.75 accepted / −0.25 rejected /
  0 for silence ⇒ only suggest above ~25% estimated accept probability), checkpoints shipped
  multiple times daily over **400M+ daily predictions**; result 21% fewer suggestions, 28%
  higher accept rate. (High — first-party.)

### 2.4 Next-action prediction in other creative/professional software

- **CommunityCommands** (Autodesk, AAAI/TOCHI) — the classic: item-based collaborative
  filtering over **40M (user, command, time) tuples from 16k AutoCAD users** recommending
  commands you don't use yet; deployed to 1,100+ users for a year.
  ([Autodesk Research](https://www.research.autodesk.com/publications/deploying-communitycommands-a-software-command-recommender-system-case-study/),
  [TOCHI paper](https://www.tovigrossman.com/papers/2011%20TOCHI%20cc.pdf)). Note: it
  recommends *commands to learn*, not *the next action in this session* — a weaker task, and it
  still took millions of log rows. (High.)
- **Fusion 360 Gallery** (Autodesk,
  [arXiv:2010.02392](https://arxiv.org/pdf/2010.02392),
  [project page](https://www.research.autodesk.com/publications/fusion-360-gallery/)) — 8,625
  human CAD **design sequences** (ordered sketch/extrude operations) with an imitation-learned,
  neurally-guided-search policy that reconstructs models operation-by-operation. The closest
  structural analogue to "learn the producer's construction sequence from project histories."
  (High.)
- **LongNAP** (Shaikh et al., Stanford/HPI,
  [arXiv:2603.05923](https://arxiv.org/html/2603.05923v1)) — formalizes **Next Action
  Prediction** from naturalistic multimodal interaction logs (screenshots + input events): 20
  users, ~1,837 hours, 360k auto-labeled actions. Architecture: Qwen2.5-VL-7B trained with GRPO,
  plus a **per-user retrieval memory of its own past reasoning traces** — reasoning-to-retrieve,
  then reasoning-to-predict. Results are honest about difficulty: 0.38 mean LLM-judge
  similarity, ~26% pass@1 even restricted to its most confident decile. Two takeaways for
  dotbeat: (a) per-user retrieval over the user's own history beat both few-shot frontier
  baselines and plain SFT — **personalization ≠ big data**; (b) even so, absolute accuracy on
  open-ended "what will this human do next" is low. (Medium-high — recent preprint, not yet
  peer-validated.)
- **RL/imitation on software-use trajectories** — the agent world's fuel is the same data:
  **UI-TARS-2** (multi-turn RL over GUI trajectories at scale, 47.5% OSWorld;
  [arXiv:2509.02544](https://arxiv.org/pdf/2509.02544)), **VideoAgentTrek** (pretraining
  computer-use from unlabeled screen-recording video;
  [arXiv:2510.19488](https://arxiv.org/pdf/2510.19488)), **OSWorld-MCP** (benchmarking MCP tool
  invocation inside computer-use agents;
  [arXiv:2510.24563](https://arxiv.org/pdf/2510.24563)). These solve *task execution from
  instructions*, not proactive prediction — but they establish that ordered interaction
  trajectories are the universally load-bearing dataset, and that everyone building agents is
  scrambling to synthesize what dotbeat's format records natively. (High for existence/claims.)

### 2.5 The gap, stated precisely

Searches for DAW/music-production analogues of the above ("predict producer's next edit,"
"mixing workflow sequence model," "DAW telemetry learning") returned nothing — no dataset of
production *edit sequences*, no published model over them. The nearest neighbors are
content-side (next-note, infilling, auto-mixing parameter estimation — see research 03/107) or
process-side in *other* domains (code, CAD, general HCI). **A next-edit model for music
production appears to be unbuilt and unpublished territory.** (Confidence: medium-high that
it's truly absent — this pass was one agent, one day.)

---

## 3. Is a next-edit-prediction model for dotbeat plausible?

### 3.1 The data asset is real, and rarer than we'd assumed

The code-editor teams' hard-won lesson (§2.3) is that the needed data is **ordered,
intermediate, session-scoped semantic edits with outcomes** — and that repositories of *final
states* (PRs; for us, finished `.beat` files) don't cut it. Map dotbeat onto that:

- **Every edit is already a semantic op.** GUI knob-turns, CLI `beat set`, and MCP `beat_set`
  all resolve to the same edit primitives through one shared apply path (the daemon/CLI/MCP
  parity that pilots 94/95 exercised). The choke point the NES team had to build custom
  volunteer instrumentation for **already exists in our architecture**.
- **Git history + auto-checkpoints = ordered intermediate states**, and `beat diff` renders any
  interval as a musical edit list ("bass: cutoff 700 → 900"), i.e. pre-tokenized training
  targets — no screenshot parsing, no VLM labeling (contrast LongNAP's pipeline).
- **The score log and lint-fix loop are outcome labels.** `beat score` records ranked
  preferences; every lint finding that names a concrete edit, followed by whether that edit was
  applied, is a free (state, suggested-edit, accepted?) triple — exactly Cursor's reward signal
  shape.
- No other DAW can say any of this: Ableton's `.als` and openDAW's `.odb` are opaque at rest;
  REAPER's text isn't ID-stable. The format thesis and the training-data thesis turn out to be
  the same thesis. (High on the mechanics — they're our own code; the *value* claim is
  inference.)

### 3.2 The honest volume problem

Calibration from the proven recipes:

| System | Data | What it bought |
|---|---|---|
| Zeta v1 | ~500 curated examples (LoRA on 7B) | shippable first version |
| Copilot NES | "smaller volume, high quality" from internal volunteers | production feature |
| Zeta2 | ~100k opt-in user examples | the good version |
| Cursor Tab-RL | 400M+ predictions/day, online RL | state of the art |
| LongNAP | 360k actions / 20 users | 0.38 judge-similarity — hard task, modest ceiling |

A solo owner's organic dotbeat use plausibly generates 10²-10³ semantic edits per serious
session. Months of regular use → low-10⁴ to 10⁵ ops. That's **Zeta-v1 / LongNAP territory,
not Zeta2 territory, and never Cursor territory** without a user community. A curated-hundreds
fine-tune of a small code-pretrained model (`.beat` is line-oriented text — code models are the
natural base, untested inference) is *feasible*; whether it clears the next bar (§3.3) is the
open question.

### 3.3 The bar it must clear: an LLM with good context already does this

Pilot 95 (`docs/research/95-usability-pilot-mcp-agent.md`) demonstrated a frontier LLM over
`beat mcp` completing the whole loop — inspect, edit, render, measure, fix — with no human. Give
that same LLM the recent `beat diff` history, the score log, and the lint output in context,
and "propose my likely next edit" is a prompt, not a model. So a dedicated predictor is only
worth training if it beats that baseline on at least one of:

- **Latency + cost + proactivity** — the real differentiator in code editors: sub-second,
  effectively free, inline, tab-accept, no prompting. This is a *GUI feature* (ghost
  suggestions in the piano roll / device panel), and it's the only interaction pattern from
  §1.3's empty fourth row. A per-call frontier LLM cannot deliver it.
- **Personalization** — the owner's actual habits vs generic production priors. LongNAP's
  finding that retrieval over the user's own history beats few-shot frontier baselines says
  personalization is reachable *without* training, via retrieval — which lowers the bar for the
  no-training route, not the training route.

And one structural caution, the central untested assumption: **code next-edit prediction works
partly because code propagates obligations** — rename a symbol and the remaining edits are
near-forced. Music edits are less convergent: after nudging a hi-hat there is no compiler
telling you what must change next. Conventions (groove consistency, key, arrangement
symmetry, gain-staging after adding a layer) are real but softer. Predictability of production
edit sequences is an empirical question nobody has measured; expect a lower ceiling than
code, per LongNAP's open-ended-behavior numbers. (Speculative — flagged as such.)

---

## 4. Recommendation

**Now: no model. Yes to logging, and yes to shipping the LLM-flavored feature that generates
the labels.** Specifically:

1. **Log the edit stream today (cheap, one choke point).** An append-only, opt-in JSONL at the
   shared apply path: `{timestamp, session_id, surface: gui|cli|mcp|agent, op, path,
   before, after, checkpoint_ref}`. Preserve **ordering, session boundaries, and idle gaps** —
   the exact properties the NES team said endpoint data lacks and that can never be
   reconstructed later. Keep it out of the project repo (sidecar dir, like `beat-scores.jsonl`).
2. **Log proposal outcomes.** Whenever `beat lint`, `beat suggest`, or an agent proposes a
   concrete edit: record proposed → accepted / modified / ignored / reverted-within-N-minutes.
   This is Cursor's ±reward signal and it's currently evaporating unrecorded.
3. **Ship "suggest next edit" as an LLM + retrieval feature first** (LongNAP's pattern:
   retrieve similar past moments from the owner's own logged history, reason, propose a diff).
   It needs zero training, it's a genuine feature on the existing BYO-Claude-Code surface
   (D14), and every use of it generates the accept/reject labels a trained model would need.
   The feature *is* the flywheel.
4. **Revisit training when** ≥ ~10k logged semantic edits with outcomes exist (or a second user
   does). First experiment, mirroring the taste program's methodology: held-out next-edit
   top-k prediction — small fine-tuned model (Zeta recipe: LoRA on a code-pretrained 7B) vs
   the LLM+retrieval baseline vs a bigram-over-op-types floor. If the trained model can't beat
   LLM+retrieval on the owner's own log, the answer was "retrieval," and we'll have gotten the
   feature anyway.
5. **Do not** build toward the Cursor endgame (online RL, fleet telemetry) — that recipe needs a
   user population dotbeat doesn't have and isn't seeking (D13, local-machine-only).

Strategic framing: the empty fourth row of §1.3 (proactive, inline, tab-accept edit suggestion
in a DAW) is real open ground, and dotbeat's format is the only DAW substrate that records the
training data natively. But the same emptiness means zero demand validation, and the taste
program's own numbers (36% top-1 on a much more constrained preference task) counsel modesty
about learned judgment on tiny personal data. Logging costs almost nothing and keeps the
option; training today would spend the project's scarcest resource (owner attention) on the
least-validated bet available.

## Honest gaps

- Single-agent pass, not adversarially verified; several product claims rest on vendor blogs or
  single secondary sources (Feater especially — one forum thread).
- "Nobody does DAW next-edit prediction" is absence-of-evidence from one day of search; a
  private effort inside Ableton/Apple/Suno would be invisible.
- No evidence either way on the predictability of music-production edit sequences (§3.3's
  structural caution) — the one question only dotbeat's own logged data can answer.
- Zeta/NES/Cursor numbers are first-party and unaudited; LongNAP is a 2026 preprint.
- Not researched here: whether telemetry logging has UX/privacy implications worth a decisions.md
  entry (recommend one if §4.1 is adopted — opt-in default matters even for a single owner).
