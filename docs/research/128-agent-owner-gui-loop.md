# 128 — The owner–agent–GUI loop: option boards, deep links, and musical diffs

*Run 2026-07-25 at the owner's request, ahead of the approved toy-song runs. The driving brief
(owner, 2026-07-25, near-verbatim): "the agent seems extremely good at thinking about the overall
song structure, creating lots of options for synths, drum patterns, melodies, bass lines... I need
to be focused on using my taste to pick the best sounds. my guess is that it will also be
important for me to finetune some of the synth sounds. so I'm guessing we'll get into a flow where
we work together to do the heavy lifting in agent mode and then I'll want to pop up some UI to do
fine tuning of synths. my guess is i'd also want to do a lot of fine tuning and exploration of
arrangement ideas, changing melodies manually, etc. It might make sense for you to think a bit
about this interaction between me, you, and the GUI." Method: a repo-grounding pass first
(`ui/` architecture, the `beat` CLI/daemon surface, `.claude/skills/produce-song/SKILL.md`,
research 10/116/121, decisions D8/D14/D24/D28 — read directly; claims from it are **(high)**
unless noted), then a light single-agent web survey for prior art (§2.6 — NOT adversarially
verified; per-claim confidence inline, treat medium and below as leads). Companions:
`121-harness-engineering-for-music-agents.md` (the harness this loop plugs into),
`116-daw-automation-sota.md` §4 (the log-don't-train verdict this doc operationalizes),
`10-interaction-model.md` (selection-as-context; the two-tier hybrid this defers on per D14).*

## Headline answers

1. **The loop is already half-built, and its spine is the daemon, not the GUI.** `beat daemon` is
   the single writer of the `.beat` file; every GUI knob turn becomes one canonical text line;
   SSE hot-reloads the GUI when the agent edits and exposes owner edits to the agent instantly;
   checkpoints commit whatever the working tree holds, so GUI edits are already captured; and
   `beat diff` is already semantic/musical (`src/core/diff.ts`, D8), including `--git rev rev`.
   Everything this doc proposes is a thin layer on that spine. (High — read directly.) §1
2. **Option boards: build `beat board` on the `beat rate` pattern, over the existing
   `vary`/batch/adopt machinery — and keep it a separate verb with a separate log from blind
   eval.** A self-contained non-blind page per batch: 2-4 candidates, provenance + params +
   measurements visible, in-context renders, pick + reject-with-note; the pick writes
   `decision.json` in the batch dir (the file the agent reads on resume) and optionally runs
   `beat adopt`. Blind `beat rate` and `beat-scores.jsonl` are never touched — measurement and
   production stay uncontaminated (D24). (Design proposal grounded in existing code.) §2.1
3. **Deep links need no router: one daemon `/focus` route + a `beat open` wrapper.** The GUI is
   already an SSE subscriber; a `focus` event that selects a track/view/bar via existing store
   state gives "click here to fine-tune this synth" for ~a day of UI work. Honest exception:
   surge tracks have no GUI panel at all — their fine-tuning stays option-boards + agent-applied
   nudges until one exists. (Design proposal; surge gap high — grep of `ui/src`.) §2.2
4. **GUI→agent diffs: the verb exists, the altitude doesn't.** Spec `beat diff --since <ref>`
   (sugar for "last checkpoint → now") and `--rollup` (net per-param before/after with tweak
   counts, lanes and note-clusters collapsed); the agent's standing step is to *interpret* the
   rollup into NOTES.md and mine repeated corrections into `PREFERENCES.md` + candidate lint
   rules — preference-per-correction as the sibling of 121's detector-per-complaint. §2.3
5. **Edit telemetry is NOT built, and the choke point research 116 assumed is real:**
   `setValue()` in `src/core/edit.ts` serves CLI, daemon (`POST /edit`), and MCP alike. Land the
   116 §4 JSONL there (surface/op/path/before/after/session, sidecar outside the repo), plus
   proposal-outcome records — option-board picks and rejects ARE the accept/reject labels 116
   said were evaporating. Cheap (S), and it must exist before the toy songs so they generate
   data from day one. (High on the code facts.) §2.4
6. **The session rhythm is a file protocol, not a feeling:** agent phase work → checkpoint +
   listening packet + option boards + `BRIEF.md` (turn token: `awaiting-owner`) → owner GUI/board
   session, complaints into `FEEDBACK.md`, ending in the owner's own checkpoint → agent wakes
   (chat, per D14), reads decisions + `diff --since --rollup` + feedback, writes interpretation
   to NOTES.md, updates PREFERENCES.md, proceeds. Owner edits are ground truth: never reverted,
   only flagged if they break a lint gate. `beat selection` already gives the agent live
   "what is the owner looking at." §2.5
7. **Prior art converges hard on one shape** — small-N candidates (Suno/Udio landed on exactly
   2), auditioned in context at near-zero switching cost (XLN XO's hot-swap), the pick promoted
   to an ordinary fully-editable artifact (iZotope assistants hand you a normal preset), and
   rejection carrying information back (LangGraph's reject-with-feedback). Human fatigue is the
   documented failure mode of pick-the-best galleries (~10-20 items × 10-20 rounds is the
   empirical cap in interactive evolution). Granularity of accept/reject is trust: Cursor's
   retreat from per-hunk review caused user revolt. (Mixed confidence, §2.6 has per-claim
   labels.) §2.6
8. **Build order for the toy songs:** before them — `beat board` v1 [M], the session-rhythm
   protocol in the produce-song skill [S], `beat diff --since` [S], telemetry JSONL [S],
   `beat open`/`/focus` [M]. After them, calibrated by real sessions — `--rollup` as a verb,
   board hot-swap audition through the daemon, surge panel [L]. §3

## Part 1 — What exists today (the grounding pass)

### 1.1 The daemon is the coupling point

The GUI (`ui/`, React/Vite, `ui/src/App.tsx`) is a thin client over `beat daemon` — a Node
HTTP+SSE server (default port 8420) that is the **single writer** of the `.beat` file. Every
edit POSTs to the daemon (`POST /edit {path, value, gestureId}`, debounced 60 ms, gesture
coalescing), which calls the same `setValue()` core the CLI and MCP call and writes **one
canonical line** per edit — a knob turn is a one-line git diff. File→GUI sync runs the other way
over SSE `/events`: agent CLI edits hot-reload an open GUI live. The daemon also holds the
in-session undo/redo stack (separate from git) and the live selection state
(`GET/POST /selection` — surfaced to agents as `beat selection`). It does not render; rendering
drives the same `ui/` engine headlessly. (High — `ui/src/daemon/bridge.ts`,
`src/daemon/`~`daemon.ts:1140`, dotbeat skill.)

Consequences worth stating plainly:

- **GUI edits are already agent-readable and already checkpointed.** `checkpoint()`
  (`src/history/history.ts`, hidden per-project git repo, pins as `pin/*` tags) commits whatever
  the working tree holds — the daemon's writes included. Commit messages are auto-generated from
  the semantic diff. Nothing new is needed for the agent to *see* owner edits — only a protocol
  for when to look and how to interpret (§2.3).
- **Checkpoints are manual on both surfaces** — the GUI has an explicit "Save checkpoint"
  button (POST `/checkpoint` → the same `checkpoint()`). That makes the checkpoint stream a
  shared, *intentional* punctuation mark: the natural turn token (§2.5).
- **`beat diff` already speaks music.** `diffCmd` (`cli/beat.mjs:4945`) diffs the parsed model
  via `src/core/diff.ts` — typed `DiffEntry[]`, before/after on every entry, stable-ID entity
  matching, musical phrasing ("note moved", "kick step 3 added") — and takes
  `--git <rev1> <rev2> <file>`. The `--musical` verb the brief asked to spec **exists**; §2.3 is
  about the missing altitude, not the missing verb.

### 1.2 What the GUI can fine-tune today

The owner's imagined GUI session is mostly buildable today **for engine tracks**:

- **Synths** — `SynthPanel.tsx`: core-9 plus ~58 SYNTH_FIELDS in grouped panels
  (osc/osc2/sub/noise/FM/unison/glide, filter + dual ADSR, vel/key mod, dual LFO, the full
  effect arsenal, sends, sidechain, drum-voice shaping), effect-chain add/remove/reorder/bypass,
  preset hot-swap, macro knobs.
- **Melodies/patterns** — piano roll (`NoteView.tsx`): add/move/resize/delete notes and drum
  hits, velocity drag, marquee multi-select, clipboard, pitch-and-time operations
  (transpose/quantize/invert/reverse/legato/fit-to-scale).
- **Arrangement** — `ArrangementView.tsx`: clip drag/move/duplicate/delete, sections, grouping,
  drag-drop content, and timeline **automation lanes** with draggable breakpoints and curves.
- **Mix** — `MixerView` faders/pan/mute/solo/meters; client-side WAV export.

The hole squarely in the brief's blast radius: **surge tracks have no GUI** (zero references in
`ui/src`; render-only track kind; roadmap row ❌). "Fine-tune the synth" in the GUI currently
means the internal engine and soundfonts. Also missing: deep links of any kind (the only URL
parameter is `?daw=<port>`; no `beat open` command), waveform drag-editing, piano-roll fold.
(High — GUI survey + `docs/product-roadmap.md`, 353 tracked features / 161 done.)

### 1.3 The agent-side surfaces this loop composes

- **produce-song** (`.claude/skills/produce-song/SKILL.md`, D28): six stage-gated phases; the
  checkpoint-listen protocol (three fixed owner-ear milestones; listening packets of 3-4
  high-information excerpts; a one-screen brief whose uncertainty list is the owner's triage
  list; block or do only reversible work while waiting); complaint capture as
  *timestamp/section + description + suspected stem*; each complaint → localize → metric
  signature → permanent lint rule. Listening packets and complaints are today **conventions in
  the workshop dir, with no file schema** — §2.5 gives them one.
- **The audition-by-measurement pattern** (surge-candidates, 121 §3.1): a documented workflow,
  not a command — render N candidates on the actual phrase, compare measured
  centroid/width/crest, pick by numbers, record why in NOTES.md. The generic machinery is
  `beat vary --count N --render --audition` + metrics + `beat adopt <batch-dir> <pick>`. An
  option board is this pattern with the owner's ears as the final judge.
- **`beat rate`'s blind UI** (`cli/rate.mjs`): a self-contained node:http page (inline HTML, no
  React) serving seeded-shuffled blind players; picks POST → `scoreBatch()`
  (`src/vary/batch.ts:727`) → `beat-scores.jsonl`, whose `ScoreEntry` records picks/rejects plus
  per-variant DSP feature vectors. Deliberately separate from `ui/`. Non-blind picking today is
  CLI-only (`beat score <batch> <best> [2nd 3rd]`) — no UI.
- **Edit telemetry (116 §4): not implemented.** No logging anywhere — but the assumed single
  shared apply path is real: pure functions in `src/core/edit.ts` with the generic choke point
  `setValue(doc, path, value)` (`edit.ts:48`); the CLI calls it directly, the daemon's
  `POST /edit` calls it (`daemon.ts:1140`), MCP rides the same core. One hook covers all
  surfaces. (High — CLI survey read the call sites.)

## Part 2 — The six design answers

### 2.1 Option boards — the picking surface

**Recommendation: a new `beat board` verb built on the `rate.mjs` pattern, not a mode of
`beat rate` and not (yet) a panel inside the daemon GUI.**

Why this shape:

- **Separation is load-bearing.** Blindness is a decision (D24) and `beat-scores.jsonl` is the
  taste program's eval ground truth. A non-blind mode reachable from the blind page — or writing
  to the same log — is exactly the contamination path the brief warns about. Different verb,
  different page header color, different log (`beat-decisions.jsonl`), and the blind page never
  gains a "show me what these are" affordance. Production picks may later be *imported* into
  taste training deliberately and tagged `non-blind`; they must never leak in by default.
- **The rate.mjs pattern is cheap and proven** — self-contained node:http + inline HTML, no
  build step, already knows how to serve batch dirs with audio players. Extending `ui/` instead
  would couple the board to the daemon's one-file lifecycle and a React build for what is, v1, a
  page of audio players and a pick button.

**What a board shows** (per decision, one page):

- 2-4 candidates — not 8. Small N is the strongest cross-domain convergence in the prior art
  (§2.6): Suno/Udio pick-from-2, IEC fatigue caps. The agent has already measured and screened;
  the board presents *finalists*, and says so ("5 rendered, 2 passed the solo-stem screen").
- Per candidate: name + provenance (patch/recipe/params — non-blind on purpose), the agent's
  measurements (centroid/width/crest, whatever drove the shortlist), and **two renders**: solo
  on the actual phrase, and in-context (the excerpt machinery — `beat excerpt` has landed — cut
  the surrounding 8 bars). In-context audition is the single most-praised pattern in the survey
  (XO's hot-swap, Co-Producer's key/tempo-synced audition).
- Per candidate: a pick button and a **reject-with-note** box (one line, optional). Rejection
  notes are the reject-with-feedback channel music tools lack (§2.6) and feed straight into
  PREFERENCES.md mining.
- A "none — regenerate" verdict (the taste program's twice-motivated all-bad row).

**What a pick writes back:** `<batch-dir>/decision.json` —
`{decided_at, board_id, pick, runner_up?, rejected: [{variant, note?}], none?: reason}` — plus
an append to `beat-decisions.jsonl` (sidecar, next to `beat-scores.jsonl` but never merged with
it). The agent's resume step globs open batch dirs for `decision.json`; adoption itself
(`beat adopt <batch> <pick>`) is run by the agent so the checkpoint that lands the winner also
records the intent — or the board offers an "adopt now" button that shells to the same verb for
the impatient-owner path. Either way the winner lands as ordinary editable `.beat` lines, and
the board links the deep link (§2.2) to fine-tune it — pick → tweak is one gesture, the
iZotope handoff shape.

**v2, after the toy songs validate the surface:** in-context audition via the daemon instead of
pre-rendered wavs — clicking a candidate hot-swaps its params through `POST /edit` while the
GUI loops the phrase, XO-style zero-latency switching — and a "more like this" button that
requests another `vary` generation seeded from a candidate. Both are real work (M/L) and both
are wasted if the pre-rendered v1 already satisfies; let the runs decide.

### 2.2 Deep links agent→GUI — "click here to fine-tune this synth"

**Today: nothing.** No router; the only URL parameter is `?daw=<port>`; no `beat open`. The
Tauri shell spawns daemon + webview and switches projects by respawning the daemon. (High.)

**The cheapest path is a daemon route, not a router.** Every open GUI is already an SSE
subscriber, so agent→GUI navigation doesn't need URL state:

1. **Daemon**: `POST /focus {track?, view?, bar?, param_group?}` → broadcast a `focus` event on
   the existing `/events` stream.
2. **GUI**: one handler mapping the event onto existing store state — select the track, open
   the Device pane (the Clip/Device toggle exists), scroll the arrangement, flash the named
   param group. No routing library; on the order of a day of UI work. (Effort medium-confidence
   until prototyped.)
3. **CLI**: `beat open <file> [--track X] [--view device|clip|arrange|mixer] [--bar N]` =
   ensure a daemon on that file (spawn if absent) → launch the window if none subscribed →
   `POST /focus`. Idempotent, so briefs can embed it freely: every "least sure of" bullet and
   every board winner gets a copy-pasteable
   `beat open song.beat --track lead --view device` line. A `#focus=lead.device` URL fragment,
   parsed once at startup, covers only the cold-start case where the brief is a clickable link
   rather than a command.

This turns the listening brief from "go find the lead synth" into one paste per suspect. The
honest exception is surge: nothing to deep-link *to*; surge fine-tuning stays option boards
(§2.1) plus agent-mediated nudges ("raise filter env depth a touch" → agent edit → SSE reload →
owner re-listens) until a surge panel is scoped. That workaround is genuinely worse than the
engine path — named as a gap, not papered over.

### 2.3 Diffs GUI→agent — the rollup and the correction miner

**The verb exists; the altitude doesn't.** A 20-minute GUI session at 60 ms debounce writes
hundreds of one-line edits; the agent needs the session's *story*, not the log. Spec, as a
layer over the existing differ (same `DiffEntry` shape, per D8 — one changeset representation):

- **`beat diff --since <ref>`** — sugar for "ref → working tree", the interval a resuming agent
  always wants (default ref: last checkpoint).
- **`beat diff --rollup`** — collapse and group: (a) per track+param, net before→after plus
  tweak count ("bass.cutoff 750 → 850, 14 tweaks" — the endpoint is signal, and *so is the
  dithering count*: a 14-tweak param is one the owner cares about and struggled with); (b) an
  automation lane's point edits collapse to "lane reshaped (bars 8-16, peak +3 dB)"; (c) note
  edits cluster by track + bar range ("lead: 3 notes moved, bar 2"); (d) one header line per
  track, sorted by edit mass. Gesture IDs (already coalesced by the daemon) and, once telemetry
  lands, session boundaries make the grouping exact rather than heuristic.
- **Interpretation stays in the agent.** The produce-song skill gains a standing wake-up step:
  read the rollup, write one paragraph of *musical* interpretation into NOTES.md ("owner
  brightened the bass and pulled the lead 2 dB — my mix was dark and lead-heavy"), and check
  the next phase's work against it. The rollup is what changed; the agent supplies why.
- **Preference-per-correction** — the sibling of 121 §3.3's detector-per-complaint. When
  rollups across sessions repeat a directional fix (air band up on pads, twice; hats
  un-quantized, every time), the agent records it in `workshop/PREFERENCES.md` with evidence
  (dates, before/afters) and, where a threshold is expressible, proposes a lint rule. GUI
  corrections are the cheapest high-signal taste data the project can collect: the owner saying
  "not this, this" in machine-readable before/after pairs, as a side effect of work they wanted
  to do anyway.

Until `--rollup` is built, the skill instructs the agent to do the same grouping by hand from
raw `beat diff --git` output — the practice ships before the verb (the 121 lesson: name the
move, then harden it into a tool).

### 2.4 Edit telemetry — log-don't-train, operationalized

Research 116 §4 said: log the edit stream at the shared apply path, log proposal outcomes, train
nothing yet. **Status: not built — and newly cheap**, because the CLI survey confirmed the choke
point is real: `setValue()` in `src/core/edit.ts:48` behind CLI, daemon `/edit`, and MCP alike.
Spec, unchanged from 116 except made concrete:

- Append-only JSONL, sidecar next to `beat-scores.jsonl` (never inside the project repo):
  `{ts, session_id, surface: gui|cli|mcp|agent, op, path, before, after, gesture_id?,
  checkpoint_ref?}`. Log **post-coalescing** at the daemon's write layer for GUI gestures (the
  60 ms debounce stream is noise; the coalesced gesture is the edit), directly at the verb layer
  for CLI/MCP. Preserve ordering, session boundaries, and idle gaps — the properties 116 said
  can never be reconstructed later.
- **Proposal outcomes**: every option-board decision is a labeled (candidates, pick, rejects,
  notes) record — `beat-decisions.jsonl` (§2.1) *is* this log for the picking surface. Add the
  same for agent-proposed edits the owner then reverts or re-tweaks within a session
  (detectable from the rollup: agent set cutoff 900 at 14:02, owner moved it to 750 at 14:20 →
  log `modified`).
- Opt-in flag + a decisions.md entry when it lands (116's own caveat: opt-in default matters
  even for a single owner).

Effort: S — one hook point, one write path, a schema that already exists on paper. It should
land **before** the toy songs: the runs are exactly the sessions whose edit stream is worth
having from day one, and the flywheel argument (116: "the feature is the flywheel") only spins
if the labels are being written.

### 2.5 The session rhythm — whose turn, on what, recorded where

The produce-song skill already schedules *when* the owner listens (three checkpoint-listen
milestones). What it lacks is the GUI-era handoff: what the owner does with their turn, and how
the agent finds out. Codify the loop as a **file protocol in the workshop dir** (the proven
cross-session-memory pattern — a dead session's successor must reconstruct everything from
files):

1. **Agent phase work** — as today, checkpoint discipline per batch, reversible-only work while
   awaiting feedback.
2. **Handoff out** — at each milestone: `beat checkpoint` + pin; render the listening packet;
   generate option boards for the phase's open picks (§2.1); write **`workshop/BRIEF.md`**: the
   one-screen brief (what to listen for, checks passed, uncertainty triage), the packet index
   (file paths + per-excerpt one-liners), board URLs, and a `beat open` deep link per suspect
   track. Last line: `state: awaiting-owner @ <checkpoint-ref>`. The brief is the turn token
   and the record of which checkpoint the owner's session started from.
3. **Owner session** — picks on boards; synth/melody/arrangement fine-tuning in the GUI (daemon
   live; the agent's `beat selection` can read what's in focus if the owner asks for help
   mid-session); complaints and free notes into **`workshop/FEEDBACK.md`** in the capture
   format (timestamp/section + description + suspected stem) — or just said in chat, which the
   agent transcribes into the file so the record survives the session. The owner ends their
   turn with the GUI's "Save checkpoint" button (or a chat "done") — that checkpoint bounds the
   diff.
4. **Agent wake-up** (chat is the wake channel; D14 — the owner is driving Claude Code anyway):
   read `decision.json`s → `beat diff --since <brief-ref> --rollup` → read FEEDBACK.md →
   write the musical interpretation into NOTES.md → update PREFERENCES.md (repeated
   corrections) and propose lint rules (complaints, per 121 §3.3) → adopt winners → next phase.
5. **The ground-truth rule:** owner edits are never reverted. If an owner tweak breaks a lint
   gate or a phase-3 target (a fader push that clips the master), the agent *raises it* in the
   next brief with the measurement, and proposes — never applies — the fix. The single
   exception is a mechanical repair the owner asks for.
6. **Concurrency:** the daemon's single-writer design makes simultaneous editing safe at the
   file level but not at the intent level; the protocol is turn-based per decision, and the
   agent avoids touching a track the owner has open (visible via `beat selection`) during a
   co-present session. Everything is git-reversible, so per the irreversibility framing (§2.6)
   the agent runs free between checkpoints; the gated resource is owner ears, not file safety.

Where the handoffs live, in one line: **BRIEF.md (agent→owner) · boards + decision.json
(owner→agent picks) · FEEDBACK.md (owner→agent complaints) · the checkpoint stream (turn
boundaries) · NOTES.md/PREFERENCES.md (the accumulated understanding).** All text, all in git's
reach, all reconstructable.

### 2.6 Prior art worth stealing (light survey — confidence per claim)

Single-agent web pass, not adversarially verified. Grouped, with what each finding buys us:

**Accept/reject granularity is trust.** Cursor's move away from per-hunk inline accept/reject
toward session-level review triggered sustained user pushback — "show me damage after the fact"
is not review (high — forum.cursor.com thread 160856, fetched). Claude Code users ask for
batch-then-review-at-checkpoint as a distinct mode (medium — GitHub issue, number reported as
31888, not independently verified). Copilot Next Edit Suggestions' single-keystroke
Tab-accept/Esc-reject is fatigue management (high — vendor docs). Google Docs suggesting mode
pairs per-suggestion accept/reject with a review-all surface and a **preview-with/without
toggle** (high — support.google.com/docs/answer/6033474) — the direct steal for audio:
every board and every proposed mix change should offer with/without A/B, which the .beat +
checkpoint machinery makes cheap.

**Music tools converge on small-N, in-context, hand-back-editable.** Suno and Udio both settled
on exactly 2 candidates per generation with pick-then-extend; Udio's fine-tuning surface is
scoped inpainting — redo the chorus, keep the rest (high/medium — product surfaces). iZotope's
assistants (Neutron/Ozone) build a full chain as a *starting point* whose handoff artifact is
an ordinary editable preset (high). Synplant 2's Genopatch grows a live candidate gallery
toward a target and lands the winner in a normal param editor (high). XLN XO's similarity map
**hot-swaps the clicked sample into the playing beat** — zero-latency in-context audition
(high). Output's Co-Producer auditions candidates synced to the track's key/tempo with
"more like this" pivots (high). WavTool — the chat-drives-the-DAW model — shut down in 2024;
discrete AI tools inside conventional DAWs survived (medium — single source). The composite
lesson is §2.1's design: finalists not fields, in-context renders, pick lands as editable
`.beat` lines, never a locked artifact.

**HITL agent research.** The generation-verification loop's leverage point is *shrinking
verification time* — GUI diffs beat raw output readouts (high — Karpathy, latent.space/p/s3).
LangGraph's HITL vocabulary — approve / edit-before-run / **reject-with-feedback** / respond,
with checkpointed pauses that resume cleanly — names the channel most music tools lack;
rejection must carry information (high — langchain docs). Anthropic's agent guidance gates on
*irreversibility*: reversible actions run free, irreversible ones get approval (medium —
secondary source, not fetched primary) — mapping cleanly to "agent edits git-reversible text
freely; owner gates what reaches ears." The "artifact (file/diff) as the human-agent medium"
framing found no canonical citable source — presented in this doc as synthesis, not citation
(low as citation, high as our own observed practice).

**Interactive-evolution galleries.** Human fatigue is the documented failure mode: the
empirical cap is ~10-20 individuals × 10-20 generations per session (high — Takagi's IEC
survey). Mitigations that transplant: paired comparisons (2AFC is cognitively cheapest — note
Suno/Udio independently landed on N=2); learned proxy fitness so the human isn't consulted
every round (that's the taste critic's advisory seat, T5-leashed); Picbreeder-style branching —
publish endpoints others resume — which is literally git branches per candidate line (medium).
Deep Interactive Evolution transplants pick-from-grid to neural generators (medium).

Skipped as thin: Vochlea, AIVA/Amper, centaur essays.

## Part 3 — Build plan (ranked by leverage; the toy songs are the validation vehicle)

**Must exist BEFORE the toy songs** (else the runs can't exercise the loop they're meant to
validate):

| # | item | size | why first |
|---|---|---|---|
| 1 | **`beat board` v1** — rate.mjs-pattern page over a vary batch dir: 2-4 finalists, provenance + measurements, solo + in-context renders, pick / reject-with-note / none, writes `decision.json` + `beat-decisions.jsonl`; strictly separate from blind `beat rate` | **M** | The owner's core ask ("use my taste to pick the best sounds") has no surface today beyond CLI `beat score`. Every toy-song phase-4 decision exercises it. |
| 2 | **Session-rhythm protocol into produce-song** — BRIEF.md/FEEDBACK.md/PREFERENCES.md conventions, the wake-up step (decisions → diff → interpret → NOTES.md), the ground-truth rule | **S** | Prompt/docs only — the 121 lesson says codified protocol is the highest-ROI artifact class in this repo. Everything else in this table is *named* by it. |
| 3 | **Telemetry JSONL at `setValue()`** + `beat-decisions.jsonl` as the proposal-outcome log | **S** | One hook point, schema already specced (116 §4). The toy-song sessions are the first data worth having; retrofitting loses them forever. |
| 4 | **`beat diff --since <ref>`** | **S** | Trivial sugar on the existing differ; the wake-up step calls it every time. Rollup ships as agent practice first (skill text), verb later. |
| 5 | **`beat open` + daemon `/focus`** | **M** | "Pop up some UI to fine-tune" is the brief's literal ask; one route + one store handler + one CLI wrapper. If schedule forces a cut, this is the one to slip — briefs degrade to "open the GUI and click the lead track" rather than breaking. |

**AFTER the toy songs** (needs real-session calibration, or is expensive until validated):

| # | item | size | gate |
|---|---|---|---|
| 6 | **`beat diff --rollup` as a real verb** — grouping rules tuned on actual owner-session diffs | **M** | First toy-song owner session provides the calibration diff; building the grouping heuristics before seeing one is guessing. |
| 7 | **Board v2: daemon hot-swap audition** (click candidate → `POST /edit` param swap while the GUI loops) + "more like this" regeneration | **M/L** | Only if v1's pre-rendered audition feels laggy/context-poor in real use — XO says it will matter, the runs say whether it matters *yet*. |
| 8 | **Surge GUI panel** (or a minimal surge param strip in SynthPanel) | **L** | The brief's fine-tuning ask hits this wall only if toy songs lean on surge tracks; the runs measure how often the boards+agent-nudge workaround actually hurts. |
| 9 | **Preference→lint automation** — tooling that turns a PREFERENCES.md entry into a lint rule scaffold | **S/M** | Needs a populated PREFERENCES.md first; manual per 121 §3.3 until then. |

The dependency picture: items 2-4 are a few days combined and de-risk nothing by waiting;
item 1 is the only M-sized bet made *before* validation, justified because a picking surface is
the one thing the brief states as a certainty rather than a guess ("I need to be focused on
using my taste to pick the best sounds").

## Honest gaps

- **No owner-GUI-session diff exists yet to calibrate against.** The rollup grouping rules
  (§2.3) and the fatigue-derived board size (2-4) are designed from prior art and IEC numbers,
  not from dotbeat data; the first toy-song runs are the calibration, and the numbers here
  should be revised against them.
- **Effort sizes are unprototyped.** The `/focus` handler's "~a day" rests on the GUI survey's
  read of the store shape, not on a spike; the board's M assumes rate.mjs generalizes as
  cleanly as it looks.
- **The web survey is single-agent and partly secondhand.** The Claude Code issue number and
  WavTool shutdown date are single-source; the Anthropic irreversibility framing was not
  fetched from a primary page; the artifact-as-medium framing has no citable source at all.
- **Contamination boundary is designed, not audited.** The blind/production split here is
  schema-level (separate verb, separate log); nobody has re-read `pairsFromRanking` and the
  taste-eval loaders to confirm nothing globs broadly enough to ingest `beat-decisions.jsonl`
  by accident — worth a 15-minute check when the board lands. Related standing debt: the D25
  pack-ref training-exclusion filter is still unimplemented.
- **Surge is answered with a workaround, not an answer.** Boards + agent-mediated nudges is a
  real regression versus knob-in-hand fine-tuning; the doc defers the panel on cost grounds
  without evidence about how much it will actually be missed.
- **Co-present (same-time) editing is under-designed on purpose.** The protocol is turn-based;
  live pair-production (owner tweaking while the agent renders and comments) is plausible on
  this architecture (SSE + `beat selection`) but has no design here beyond "don't touch what
  the owner has open."
