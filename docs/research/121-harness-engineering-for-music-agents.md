# 121 — Harness engineering for music agents: prompting and tooling an AI producer

*Run 2026-07-24 at the owner's request, after the serious Sandstorm cover landed "solid — but not
as good as the original." The driving question (owner, verbatim spirit): "how do we prompt/give
the best tools to an agent so they can make and edit music most effectively" — toward an
AI-producer whose outputs are producer-level, which the owner then directs and fine-tunes. Part 1
is primary-source process mining: the two craftsman agents' full session transcripts
(`~/.claude/projects/-Users-willpatrick/fc3bd856…/subagents/agent-ad33ae0037e0d9bf1.jsonl` and
`agent-ae1027cd94fb2da01.jsonl`) and their workshop
(`~/Documents/dotbeat/taste-dataset/covers/` — NOTES.md, solo-\*.wav stems, test-\* excerpts,
surge-candidates/, the .beat itself). Those claims are read directly off the transcripts and are
**(high)** unless noted. Part 2 is a single-agent web pass, NOT adversarially verified —
per-claim confidence labels are self-reported; treat **(medium)** and below as leads. Part 3 is
synthesis: a concrete harness design grounded in both.*

## Headline answers

1. **The agents invented a genuinely good process** — research-first, source-mining, solo-stem
   verification, section-excerpt iteration, metrics-as-ears — and it produced the best full song
   dotbeat's tools have made. The process is currently *folklore*: it lives in two transcripts
   and a NOTES.md, not in any skill or prompt. Codifying it is nearly free. (High.)
2. **Both owner-caught failures were measurable, and one was even measured — but nothing made
   them failures.** The grindy bass's signature (crest 9.6, 96 % of energy < 250 Hz) sat in a
   solo stem nobody was told to screen; the arrangement flatness (per-8-bar rms −15.2 → −12.7)
   was *in the agent's own notes* with no threshold attached. The gap is not "metrics can't
   hear" — it's that no standing detector turned numbers into verdicts. (High.)
3. **The prompt is the tool index.** The brief said "`beat metrics` + `beat lint` are your ears,"
   and those became the *only* ears: `beat feedback --sections` (the per-section energy arc — the
   exact flatness detector) and `beat render --stems` existed in the agents' own worktree and
   were never called; the agents hand-rolled worse versions of both. The taste critic and
   aesthetics scorers were never invoked either. Agents do not browse the toolbox; they use what
   the prompt names. (High — directly observed.)
4. **The single worst tool friction was a broken affordance, not a missing one:** clip automation
   parses, round-trips, and is advertised — but the render path re-applies static patch values
   every 16th tick, so a −60 dB volume lane measured −4.6 dB. Agent 1 burned ~45 tool calls
   discovering this by source archaeology plus micro-experiments, then encoded every build and
   sweep as note data (velocity ramps + `velToFilterAmount`). A tool that lies costs far more
   than a tool that's absent. (High.)
5. **State of the art confirms the direction, not a shortcut.** Agentic music production research
   (RIME, DAWZY, MixAssist) is at "instruction-following + point edits" — nobody has published a
   full song-crafting harness; the transferable lessons come from code agents (ACI design,
   tool-grounded critique) and reference-based mixing (Diff-MST: derive the target from a
   reference track — the "dynamics plan from source material" idea, already proven as a model).
   (Medium-high.)
6. **Top-5 harness changes** (detail in §3.7): codify the craftsman workflow as a skill with a
   named-instrument verification gauntlet [S]; a checkpoint-listen protocol that schedules the
   owner's ears [S]; detector-per-complaint as a standing `lint` practice [M]; a source-derived
   dynamics plan artifact [M]; render-true timeline automation + section-energy primitives [L].

---

## Part 1 — Process mining: how the Sandstorm cover was actually built

### 1.1 The two sessions in numbers

| | Agent 1 ("Craft the serious Sandstorm cover") | Agent 2 ("Finish the serious Sandstorm") |
|---|---|---|
| transcript | agent-ad33ae0037e0d9bf1.jsonl (1.6 MB, 507 events) | agent-ae1027cd94fb2da01.jsonl (0.5 MB, 203 events) |
| tool calls | 155 Bash, 14 Write, 8 Read, 2 WebSearch, 2 WebFetch, 3 Monitor | 54 Bash, 6 Write, 3 Read, 1 Monitor |
| assistant prose | 13 short text blocks (~1.2 kB total) — nearly all effort is tool-mediated | same shape (13 blocks) |
| ending | **stopped by the user mid-verification** ("verify the critical transitions") | completed; final render + NOTES.md |
| model | fable, worktree-isolated, deliverable outside the repo | same |

Both prompts were themselves harness artifacts worth studying: they specified the brief, the
materials, the sound-source menu (engine patches / surge sidecar renders / 909 kit), the quality
loop ("you cannot listen — use the instruments"), metric targets (width ≥ −15 dB, air > 1 %,
drop-vs-break contrast), render-budget guidance (~0.5× realtime → iterate on section excerpts),
and a required NOTES.md iteration log. Agent 2's prompt additionally transferred Agent 1's state
("the workshop") and forbade restructuring. A coordinator session relayed the owner's listening
feedback mid-flight and revived a dead render-watcher — the human-in-the-loop channel worked.

### 1.2 The process they invented (and where it worked)

Reconstructed phase by phase from the transcripts; ~map of Agent 1's 155 Bash calls:

1. **Orient (~20 calls).** CLAUDE.md, the dotbeat skill, the taste-program memory file, research
   115/118, D26/D27, `produce.ts` values, preset/kit/surge catalogues. The agent treated the
   repo's own research as production evidence — the tricks-reference numbers (width −52 vs
   −11 dB, air 1.9 %) became its mix targets.
2. **Research (~6 calls, web).** Sound on Sound + Syntorial on the actual Sandstorm lead (not a
   supersaw — a distorted mono line; gate from staccato 16ths, not an FX gate), BPM/key/form.
   This is where the cover's musical correctness came from; five research conclusions in
   NOTES.md all trace to this pass. **Research-first demonstrably paid off.** (High.)
3. **Source mining (~8 calls, python/mido).** The 19-track 12.5k-note MIDI reduced via an
   18-block activity matrix to the real form (intro → groove → build → break bars 48-77 →
   55-bar drop), then per-voice extraction windows chosen *musically* (bars 88-96 where
   everything is chord-aligned; the arp's two D-major bars replaced with the Em figure to keep
   the backing chord-safe). Composition was solved by mining, not generation.
4. **Capability probing (~45 calls — the expensive detour).** Verifying automation semantics:
   grep archaeology through `engine.ts`/`offline.ts`/`bridge.ts`, then — decisively —
   micro-projects (`autotest.beat`, `cutofftest.beat`, a static-cutoff control) rendered and
   RMS-compared. Finding: `applyParams` re-ramps every automated param to the static patch value
   each 16th tick, so clip automation is *mostly defeated in renders* (−60 dB lane ⇒ −4.6 dB
   measured; automated 150 Hz cutoff ⇒ −35.4 dB rms vs −45.8 static). Consequence: **all**
   dynamics were re-encoded as note data — velocity terracing, `velToFilterAmount` (verified
   per-note: 2^(vtf·(v−0.5)·4)), and arrangement changes. The final .beat contains zero
   automation lanes. The empirical micro-test pattern was excellent; needing it was not.
5. **Generate (~10 calls).** A single python generator (`gen_sandstorm.py`) emitting the whole
   .beat — 12 tracks, clips, scenes, 113-bar song — then `lint`/`inspect` to parse-clean.
   Notable: the agent chose *programmatic generation of the text format* over incremental CLI
   edits for the bulk build, keeping every later pass a parameter tweak + regenerate. (Agent 2,
   doing surgical fixes, inverted this: CLI `set`/`scene` edits + one python clip-clone.) Both
   choices were right for their phase — bulk vs patch.
6. **Verify by parts (~35 calls).** The invented verification kit:
   - **Section excerpts** (`test-drop`, `test-break`, `test-trans` — copy the .beat, rewrite the
     `song` block to 8-16 bars, render ~1 min instead of ~8): the workhorse, used for every
     iteration cycle, straight from the prompt's render-budget hint.
   - **Solo-stem renders** (`solo.sh`: all other tracks muted): per-instrument spectral truth —
     which later let the owner's bass complaint be localized in one measurement.
   - **Surge patch auditions** (`surge-candidates/`): 5 lead patches rendered on the riff
     phrase, picked by measured centroid (1714 Hz) + width (−8.1 dB) — a real A/B decided by
     numbers, and the pick survived to the final mix.
   - **Reference measurement**: metrics run over the owner's loved refs (`refs-familiar/`) to
     calibrate targets rather than trusting genre lore.
   - **Background renders + Monitor** while doing other work — latency hidden, mostly (§1.4).
7. **Iterate.** Pass 1 caught a genuinely broken mix by numbers alone (drop at −3.5 LUFS,
   +4.6 dBTP, crest 6.5, sub+bass 62 %, air 25.8 % "metal hats screaming") and fixed it. This is
   the strongest pro-metrics datapoint: **metrics-as-ears reliably catch gross errors.**
8. **Persist.** NOTES.md as cross-session memory — when Agent 1 was stopped mid-flight, Agent 2
   reconstructed the entire state from the workshop files + NOTES.md, seeded its own log from
   the old worktree's copy, and used `beat checkpoint` (90ed309 pre-polish, 3e60223
   final-polish) around the risky finishing pass. The workshop-as-state pattern worked.

### 1.3 Where it failed — and precisely why

The owner heard two things every metric check had passed over:

- **The grindy bass (~1:11-1:16).** The strip section, bass exposed. Post-hoc, the signature was
  unambiguous *and already on disk*: `solo-bass-stabs.wav` (rendered by Agent 1 as a
  verification stem!) measured crest 9.6 — the flattest stem — 96 % of energy < 250 Hz, centroid
  77 Hz: drive/resonance intermodulation on an E1 square + sub with no pitch definition. Nothing
  screened solo stems for timbral pathology; the checked axes were width/air/LUFS/band-shares of
  the *mix*. Once the owner named the complaint, Agent 2 turned it into numbers in one
  measurement pass and fixed it verifiably (crest 9.6 → 11.4, bass-definition band 28 → 37 %).
  **Detector-per-complaint works; it just ran in the wrong direction — after the ears instead of
  before.** (High.)
- **"Everything on all the time."** The flatness was *literally recorded in NOTES.md* before the
  owner heard it: "per-8-bar rms nearly flat from groove to drop (−15.2 → −12.7, adjacent
  contrasts 1-2 dB)" — written down as an observation, not a failure, because no target said
  what section contrast *should* be. The thresholds arrived only with the owner's feedback
  ("adjacent contrasting sections ≥ 3-4 LUFS apart"). After the fix: groove −19.4 / strip −27.8
  / build −19.8 / gap −28.9 / drop −17.1 — an 11.8 dB gap→drop step. The knowledge existed in
  the repo (`beat feedback --sections` flags exactly this arc); it wasn't in the loop. (High.)
- **A cosmetic but telling miss:** the render the owner heard was clipping (+2.58 dBTP) — the
  prompt's own targets said ≤ −1 dBTP, but true peak was only gated in the *final* full-render
  check, after the listening. Verification order matters: the owner should never hear a render
  that fails a check the harness already knows how to run.

And the standing-instrument misses, confirmed by transcript grep (the strings `beat score`,
`critic`, `aesthet` appear only in prompt/skill text, never in a command):

- **Taste critic + aesthetics scorers: never invoked** — despite being the project's own
  purpose-built preference instruments (dsp+aes-bt, 64.4 % held-out pairwise).
- **`beat feedback --sections`, `beat render --stems`: never invoked** — both existed in the
  agents' worktree (verified by running `help` there); the agents hand-rolled `solo.sh` and a
  per-8-bar `winmetrics.py` instead. Rediscovery cost plus worse coverage.
- **`beat produce`, `beat trick apply/suggest`, `beat vary`: never invoked** — production values
  were hand-copied from the docs into the generator. It worked (the agent had read the evidence),
  but it means the curated affordance layer added no leverage on its flagship use case.

The common cause is §Headline 3: **agents use the tools the prompt names, at the altitude the
prompt names them.** "metrics + lint are your ears" produced exactly a metrics+lint loop, hand
tools for everything else.

### 1.4 Tool-friction inventory

| friction | evidence | cost | harness lesson |
|---|---|---|---|
| Clip automation defeated in renders | §1.2 step 4; NOTES.md "engine findings" | ~45 calls discovery + total workaround (note-data dynamics) | a documented affordance that doesn't render is worse than none; capability truth-testing should be pre-packaged, not improvised |
| Automation is clip-scoped only | format grammar (`auto` lives in clips) | build/sweep arcs across sections had to be faked with per-clip velocity ramps and duplicated clip variants (`b_soft` = b_main × 0.735) | no timeline/section-level dynamics primitive exists — the #1 format gap for arrangement craft |
| Render latency ~0.5× realtime | prompt guidance; 7-8 min full renders | mitigated well by section excerpts + background renders; still the pacing bottleneck of every loop | keep excerpt-first; consider a faster-than-realtime or partial-invalidation render path |
| Background-watcher fragility | coordinator interjection: "your watcher died without waking you; ALL renders completed" | idle stall until the coordinator nudged | poll-the-artifact loops beat one-shot watchers; bake the pattern into the skill |
| Write tool scoped to worktree, deliverable outside | both agents hit it; both rebuilt scripts in a scratch dir and wrote outputs via bash | ~6 calls each, plus awkward two-home layouts | give craft agents an explicit workshop dir that Write can touch |
| Solo/section tooling hand-rolled | `solo.sh`, `mksection.sh`, `winmetrics.py` written from scratch (twice — Agent 2 re-derived Agent 1's kit from files) | ~10 calls each session | `render --stems`, `feedback --sections` cover most of it — naming them is the fix; a `beat excerpt <file> <section...>` verb would finish it |
| Taste scorers unreachable in practice | never invoked (above) | unknown — possibly a caught bass | wire `critic`/`aes` into a named verification step, or accept they're eval-only instruments |

One more positive worth naming: **the interjection channel**. The owner's mid-flight listening
notes reached Agent 2 as a coordinator message with concrete per-complaint fix directions, and
the agent pivoted immediately ("Owner feedback noted — bass grind… let me measure the before
profile"). That loop — owner ears → coordinator translation → agent detectors — is the germ of
the checkpoint-listen protocol in §3.2.

---

## Part 2 — State of the art (what's new or newly relevant since 116)

*116 already mapped the product landscape (WavTool→Suno, MCP puppeteers, incumbents' point
tools) and the next-edit-prediction question; none of that is re-surveyed. This pass looks
specifically at HARNESS structure: how agentic creative systems decompose, verify, iterate.*

### 2.1 Agentic music production systems

- **DAWZY** (NeurIPS 2025 demo, [arXiv:2512.03289](https://arxiv.org/abs/2512.03289)) —
  natural-language/voice control of REAPER. Harness shape: only **three MCP tools** (live state
  query, parameter adjustment, beat generation) + **LLM code generation** for everything else,
  with two disciplines dotbeat already shares: *refresh state before every mutation* (the `beat
  inspect`-first rule) and *atomic, undoable actions*. It is instruction-following ("warm the
  vocals" → edits), not autonomous craft — no self-verification loop beyond user audition.
  (High that this is the design; medium on details — abstract-level fetch.)
- **RIME / POEMS** ([arXiv:2607.19605](https://arxiv.org/abs/2607.19605)) — the closest
  statement of dotbeat's thesis in the literature: "agentic post-production, wherein individual
  aspects of a song are targeted, refined, and combined into a final track," explicitly analogized
  to interactive coding agents. POEMS = stem separation + mixing + studio effects as an agent
  toolkit; RIME generates 3,000 edit-instruction/ground-truth pairs *grounded in canonical
  production methods* and finds current multimodal LLMs have "persistent challenges" at
  post-production, improvable by SFT. Two transfers: (a) per-stem decomposition of production
  work is the consensus structure; (b) *canonical production methods as data/verification
  grounding* — dotbeat's tricks catalog is the same move, made executable. (Medium-high —
  abstract-level fetch, recent preprint.)
- **MixAssist** ([arXiv:2507.06329](https://arxiv.org/abs/2507.06329)) — 431 audio-grounded
  conversational turns of expert-amateur co-mixing dialogue. Small, but it is the only dataset of
  *how a human expert directs mixing decisions turn by turn* — relevant to training/evaluating
  the AI-producer's directing interface, and structurally identical to the owner-feedback
  interjections mined in Part 1. (Medium.)
- **Reference-based automatic mixing — the proven "derive the plan from the source" pattern.**
  **Diff-MST** ([arXiv:2407.08889](https://arxiv.org/abs/2407.08889),
  [code](https://github.com/sai-soum/Diff-MST)) infers mix-console parameters for raw tracks
  from a *reference song* via a differentiable console + style loss — interpretable parameters
  out, arbitrary track counts, post-hoc adjustable; **Diff-MSTC**
  ([arXiv:2411.06576](https://arxiv.org/abs/2411.06576)) is the Cubase prototype. This is the
  model-shaped version of what the Sandstorm agents did by hand when they measured
  refs-familiar tracks to calibrate targets — and the direct precedent for §3.4's
  dynamics-plan-from-source. (High that the systems exist and work as described.)
- Adjacent-but-different: **SonicMaster** (all-in-one mastering,
  [arXiv:2508.03448](https://arxiv.org/pdf/2508.03448)), **Audio-Agent** (GPT-4 decomposing
  text-to-audio conditions, [arXiv:2410.03335](https://arxiv.org/abs/2410.03335)), **CoComposer**
  multi-agent composition (already in 116). None has a verification loop stronger than
  "generate, maybe regenerate." (Medium.)

The field-level reading: **nobody has published an end-to-end song-crafting harness with
instrumented self-verification.** The Sandstorm transcripts are — as far as this pass found —
ahead of the literature as a worked example. The competitive frontier is exactly the harness,
not the models. (Medium — absence-of-evidence from one pass.)

### 2.2 Generator-critic loops: what actually transfers

- The foundational pattern results — **Self-Refine**
  ([arXiv:2303.17651](https://arxiv.org/abs/2303.17651)) and **Reflexion**
  ([arXiv:2303.11366](https://arxiv.org/abs/2303.11366)) — show iterate-with-feedback gains, but
  the load-bearing caveat is **Huang et al.: LLMs cannot reliably self-correct without external
  feedback** ([arXiv:2310.01798](https://arxiv.org/abs/2310.01798)), and **CRITIC**
  ([arXiv:2305.11738](https://arxiv.org/abs/2305.11738)) locates the fix: *tool-interactive*
  critiquing — ground every critique in an external instrument. The Sandstorm process was
  already CRITIC-shaped (render → measure → fix), and its failures were exactly where the
  instruments had holes. The design conclusion for §3: don't add a "self-reflect harder" step;
  add detectors. (High for the papers' claims; the mapping is this doc's inference.)
- **Multi-dimensional critics beat monolithic ones** in creative-generation practice: VISTA's
  video loop splits critique across visual/audio/context judges
  ([arXiv:2510.15831](https://arxiv.org/pdf/2510.15831)); Anthropic's evaluator-optimizer
  pattern makes the same separation argument generally
  ([anthropic.com/research/building-effective-agents](https://www.anthropic.com/research/building-effective-agents)).
  dotbeat's natural critic panel is already plural: metrics bands, lint, per-section feedback,
  the taste critic, aes scorers, and (per research 122's mission) future listening models — the
  harness should present them as a *panel with named jurisdictions*, not a pile. (Medium-high.)
- **Where dotbeat's own evidence cuts against the literature's optimism:** research 117 + the T5
  gate (controls beat elites 89 % vs 50 %) already showed critic-guided *search* isn't ready to
  replace human ears here; and the showdown data says the generator, not judgment, binds
  quality. So the harness role of critics in the near term is **regression-testing taste**
  (catching known-bad patterns cheaply), not steering search. (High — own-repo evidence.)

### 2.3 Tool design for agents (ACI): affordances over primitives, and the naming effect

- **SWE-agent** formalized the Agent-Computer Interface result: interface design alone — compact
  consolidated actions, guardrails, concise informative feedback — moved solve rates
  dramatically with unchanged model weights
  ([arXiv:2405.15793](https://arxiv.org/abs/2405.15793)). (High.)
- **Anthropic's tool-writing guidance** converges: fewer, higher-level, workflow-shaped tools;
  responses that return *meaningful context* rather than raw dumps; token-efficient outputs;
  descriptions that are themselves prompt engineering; and evaluate tools *with agents in the
  loop* ([anthropic.com/engineering/writing-tools-for-agents](https://www.anthropic.com/engineering/writing-tools-for-agents)). (High.)
- Part 1 adds a corollary the literature under-states: **discovery beats existence**. dotbeat's
  affordance ladder (`produce` → `trick` → `feedback --sections` → `render --stems`) is
  well-designed by ACI standards and was still bypassed, because the operative tool index at
  runtime was one line of prompt. For a ~58-tool surface, the skill/prompt must route *by task
  phase* ("when verifying dynamics, run X") — a checklist, not a catalogue. (High — observed.)

### 2.4 Long-horizon creative decomposition and the sample-retrieval pillar

- **Dramatron** ([arXiv:2209.14958](https://arxiv.org/abs/2209.14958)) remains the cleanest
  creative-domain precedent for *hierarchical* generation (logline → plot → character →
  scene-by-scene), with coherence flowing top-down — the analogue of Sandstorm's
  form-first-then-stems order, which the agents chose unprompted. General long-horizon agent
  work has converged on the same two-level split (strategic plan / tactical execution, e.g.
  HiMAC, [arXiv:2603.00977](https://arxiv.org/pdf/2603.00977)). (Medium.)
- **Samples**: the retrieval problem is solved-ish in research — **SampleMatch** (drum sample
  retrieval by musical context, [arXiv:2208.01141](https://arxiv.org/pdf/2208.01141)) and
  CLAP-embedding text/audio search over local libraries (e.g.
  [microsoft/msclap](https://huggingface.co/microsoft/msclap)) — and solved commercially
  (Splice search, Ableton 12's similarity browser, per 116). The missing piece for dotbeat is
  purely harness-side: an indexed local library the agent can query by role/text/similarity and
  a licensing-clean acquisition path (research 120's pack recommendation + the D25 exclusion
  wrinkle). One caution from the taste program: CLAP embeddings scored below chance on
  *intra-batch preference* — fine for retrieval ("find me a 909 crash"), unproven for taste.
  (Medium-high.)

---

## Part 3 — The harness design for dotbeat's AI-producer

Grounded in Parts 1-2 and the existing assets: the `beat` CLI/MCP (~58 tools), engine + surge
track kind (`docs/surge-track.md`), fal generation (`beat source gen`), the produce/trick layer
(`docs/producing.md`, `docs/tricks-reference.md`), curated preset banks, the taste critic + aes
scorers (`docs/taste-loop-design.md`), and the eval instruments (`metrics`/`lint`/`feedback`/
`analyze`/`analyze-structure`).

### 3.1 Workflow skeleton — codify what worked

A `produce-song` skill (or standing prompt template) with six stage-gated phases, each naming
its tools and its exit criterion. This is 90 % transcription of what the craftsman agents did,
plus the instruments they missed:

1. **Research** — web pass on the target sound/genre + repo evidence (tricks-reference, relevant
   research docs) + reference measurement (`beat metrics --save-profile` on 2-3 owner-loved
   refs, per section if possible). *Exit: 5-bullet "what makes it hit" + numeric targets table.*
2. **Source mining / material plan** — for covers: MIDI/audio mining (`beat analyze`,
   `analyze-structure`, activity-matrix scripting); for originals: motif/palette decisions. *Exit:
   per-role source table (which instrument plays what, from where) — the NOTES.md architecture
   table, made mandatory.*
3. **Dynamics plan from source** (§3.4) — *before* any track is built. *Exit: per-section energy
   targets (LUFS deltas, instrumentation on/off matrix, automation arcs).*
4. **Per-stem build** — engine patch or surge patch or sample per role; audition candidates the
   surge-candidates way (render N, measure, pick, record why); `add-track --produced` /
   `beat trick` as the default production baseline instead of hand-copied values. *Exit: every
   stem passes a solo-stem screen (§3.3) — rendered via `beat render --stems`, not a hand script.*
5. **Sections + assembly** — clips/scenes/song; section excerpts (`test-*.beat` pattern —
   worth a real `beat excerpt` verb) for every transition; background renders with
   poll-the-artifact loops, never single watchers.
6. **Verification gauntlet** — in order: `beat lint` (clean, ≤ −1 dBTP); `beat feedback
   --sections` against the §3-phase dynamics plan (adjacent contrast ≥ 3-4 LUFS where planned,
   gap bars near-silent, drop step present); solo-stem screens re-run; band-share masking check
   on the lead stack; **then** the checkpoint-listen (§3.2). *No render reaches the owner with a
   known-red check.*

The skeleton also fixes the two mechanical potholes: an explicit workshop dir the agent can
Write to, and the capability-truth note ("automation is defeated in offline renders — encode
dynamics as note data until the engine fix lands") so no future agent re-spends 45 calls.

### 3.2 The checkpoint-listen protocol — scheduling the owner's ears

The Sandstorm run's listening events were accidental (owner heard a near-final clipping render).
Make them milestones. At three fixed points — end of phase 4 (stems), first full assembly, and
pre-final polish — the agent:

1. `beat checkpoint` the project (pinned, e.g. `stems-review`);
2. renders a **listening packet**, not a full song: the 3-4 highest-information excerpts
   (each hero stem solo ~8 bars; the build→gap→drop transition; the sparsest section) — a few
   minutes of audio that samples the failure surface, honoring the 0.5× render budget;
3. posts a one-screen brief: what to listen for, which checks already passed, what the agent is
   least sure of (the agent's uncertainty is the owner's triage list);
4. **blocks or forks**: either waits, or continues on explicitly-reversible work only, so a
   complaint never lands after unrelated changes are stacked on top.

Owner feedback returns through the interjection channel that already worked, in a
complaint-capture format: *timestamp/section + plain description + (optionally) suspected
stem*. Each complaint triggers §3.3. This is also the data flywheel research 122 needs: every
complaint paired with the exact render is a labeled failure case for candidate listening models
("does it hear what the owner heard?" — the owner's own benchmark framing).

### 3.3 Detector-per-complaint as standing practice

The pattern that already worked once (grind → crest/sub-share/definition-band → verified fix),
run forward instead of backward, and *accumulated*:

- Every owner complaint gets (a) a localization (which section, which stem — solo renders make
  this cheap), (b) a metric signature distinguishing bad from fixed, (c) a **permanent check** in
  `beat lint`/`feedback` with the complaint date and thresholds, so the same failure is never
  shipped to ears twice. Lint becomes the regression suite of the owner's taste — the exact
  proposal shape of 116 §4's "log the labels," applied to listening instead of edits.
- Seed detectors from the two known complaints: **bass-grind** (solo bass stem: crest < ~10.5
  AND sub-share > ~65 % AND definition band < ~30 % ⇒ flag; thresholds from the measured
  before/after pair, to be calibrated on more cases) and **arrangement-flatness** (per-section
  LUFS: fewer than N adjacent contrasts ≥ 3 LUFS, or no ≥ 8 dB gap→drop step where the plan
  declares a drop ⇒ flag). Both are implementable today on `render --stems` + `feedback
  --sections` outputs.
- The taste critic/aes scorers join here, honestly scoped: run them on candidate renders as an
  *advisory* panel member (they're cheap), log their scores against the owner's eventual
  verdicts, and promote them to gating only if they start predicting complaints (the T5 lesson:
  don't let the critic steer until it earns it).

### 3.4 Dynamics plans derived from source material

The flatness failure was a planning failure before it was a mixing failure: dynamics were
"vibes" (owner's framing in the memory file: plans were not source-derived). The fix exists in
pieces:

- For covers/references: `beat analyze` (beats/sections) + per-section `beat metrics` over the
  *original recording* ⇒ an explicit **energy-arc profile** (per-section LUFS relative to the
  drop, band balance, width, on/off instrumentation from stem activity) that phase 3 writes into
  the plan and phase 6 verifies against. The Sandstorm MIDI mining already produced the
  activity matrix — it was used for *composition* but never converted into *level* targets.
- `beat feedback --ref` already compares sections to a saved profile — the missing verbs are
  "build the profile from a reference recording per-section" and "diff my arc against it."
  Small additions to existing analysis code.
- Longer-term, Diff-MST-style parameter inference from a reference (§2.1) is the upgrade path:
  interpretable per-track gain/EQ suggestions from the ref, which the agent applies through
  ordinary `beat set` edits — model-assisted, still text-diffable. (Direction, not a commitment.)

### 3.5 Samples as the next toolkit pillar

Owner: "using samples isn't something we've really added… will be impactful." The showdown
hierarchy (ref 94 % >> gen 70 % >> engine 4 %) says the fastest route to producer-level *sound*
is often not synthesizing it. Harness shape, in order of effort:

1. **Acquire clean**: execute research 120's plan (Splice Creator month / Loopmasters pack) into
   `taste-dataset/refs-packs/<role>/` — doubles as eval refs and production material; keep the
   D25 training-exclusion filter in mind (Splice ToU vs critic training).
2. **Index**: a local CLAP (or msclap) index over the library; `beat source search --local
   "<text>" [--role r] [--like <wav>]` returning ranked candidates with previews — the
   SampleMatch/Splice pattern, pointed at owned media. Retrieval is what CLAP is actually good
   at (its taste failure is irrelevant here).
3. **Audition like surge-candidates**: the harness already knows how — render top-k in context,
   measure, pick, record. Samples enter the .beat through the existing `source add` +
   drum-lane/keymap/audio-clip machinery; provenance sidecars already enforce licensing labels.
4. Sandstorm would have used it immediately: real 909 crashes/sweeps ("shhh-pshhh"), a reverse
   crash, noise risers — the FX layer that was synthesized adequately but is *sampled* in every
   commercial reference.

### 3.6 Format/tool gaps the process exposed (build list)

In leverage order: **(1)** render-true automation — make the offline/render path honor clip
automation (the applyParams stomp is arguably a bug, and NOTES.md documents the measured
symptom); **(2)** a section/timeline-level energy primitive — per-section track gain/duck/filter
offsets or song-scoped automation lanes, so "the drop bass steps up" is one line, not a cloned
clip at ×0.735 velocities; **(3)** `beat excerpt <file> <sections…>` (auto test-\*.beat) and
solo/section render flags naming the existing stems path; **(4)** surge track v1 limits that
will bite the next craftsman: clips/scenes on surge tracks don't render (track-level notes
only) and `--batch` skips surge prep; **(5)** the skill's command reference should route by
task phase (§2.3's naming effect) — the cheapest fix on this list and arguably worth doing
first.

### 3.7 The five highest-leverage harness changes

| # | change | grounding | effort |
|---|---|---|---|
| 1 | **Codify the craftsman workflow as a `produce-song` skill** — six phases (§3.1), each naming its instruments (`feedback --sections`, `render --stems`, `produce`/`trick`, lint gates incl. ≤ −1 dBTP), the capability-truth notes, workshop-dir and poll-loop patterns | §1.2-1.4: the process exists and worked; every miss traces to un-named tools | **S** (prompt/docs only — highest ROI on the list) |
| 2 | **Checkpoint-listen protocol** — scheduled owner-ear milestones with listening packets, uncertainty briefs, complaint-capture format; never ship a known-red render to ears | §1.3 (flatness + clipping reached the owner), §3.2; doubles as research-122's benchmark flywheel | **S** (protocol + small render/packet helper) |
| 3 | **Detector-per-complaint into `beat lint`/`feedback`** — bass-grind + flatness detectors now, one permanent check per future complaint; critic/aes run advisory and scored against owner verdicts | §1.3 (both misses were measurable; one was measured), §2.2 (tool-grounded critique) | **M** (metrics code exists; thresholds need calibration cases) |
| 4 | **Source-derived dynamics plan artifact** — per-section energy-arc profile extracted from the reference (analyze + per-section metrics), written at plan time, verified by `feedback --ref` at assembly | §1.3 ("vibes not source-derived"), §2.1 Diff-MST precedent | **M** (composes existing analyze/metrics/feedback pieces) |
| 5 | **Render-true timeline dynamics** — fix automation-in-render, add a section-level energy primitive; plus the samples pillar (pack acquisition + CLAP-indexed local search) as the parallel M/L track | §1.4 (the single worst friction), §3.5-3.6 | **L** (engine/format work; samples M) |

## Honest gaps

- Part 1 mines two transcripts of one song by one model family on one genre — the process
  conclusions may not survive a genre where composition (not production) binds, and Agent 1's
  text-light/tool-heavy style means intent is sometimes inferred from command sequences.
- Thinking blocks were not extractable from the transcripts (empty in the stored format), so the
  *reasoning* behind key choices (e.g. generator-script vs CLI edits) is reconstructed, not read.
- "Nobody has published an end-to-end song-crafting harness" is absence-of-evidence from one
  search day; RIME/DAWZY details come from abstract-level fetches, not full-paper reads.
- The proposed detector thresholds (§3.3) are calibrated on n=1 complaint each; treat as
  starting points, not truths.
- Whether `beat feedback --sections` would have flagged the flatness *at default sensitivity* was
  not empirically re-run on the pass-2 render — worth a 10-minute check before building on it.
- The claim that the taste critic would have caught anything here is untested (its jurisdiction
  is ranked preference over variants, not absolute mix pathology) — hence "advisory, scored,
  promote-if-predictive" rather than gating.
