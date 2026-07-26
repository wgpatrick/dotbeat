# 137 — The producer's cockpit: surge in hand, proposals on screen, taste on file

*Run 2026-07-25, round 2 of the owner–agent–GUI question. Round 1 is
`docs/research/128-agent-owner-gui-loop.md`; its whole "before the toy songs" build plan has now
SHIPPED (`beat board`, `beat open` + `/focus`, edit telemetry, `beat diff --since --rollup`, the
session-rhythm protocol + D29). The owner's frame (2026-07-25, near-verbatim): the agent is great
at breadth — song structure, generating many options for synths, drums, melodies, basslines; the
owner's job is taste (picking the best sounds) plus hands-on fine-tuning of synth patches and
exploration of arrangement/melody ideas, which they expect to do in the GUI. This doc goes past
round 1's plumbing into the working experience: the surge gap (now the biggest hole in that
stated workflow), the actual cockpit screen, the taste flywheel on top of the telemetry, and
multi-session continuity. Method: three grounding passes read directly this session — the surge
stack (format/edit/render/sidecar/catalogue), the shipped 128 features as-landed (including their
gaps), and the GUI anatomy (`ui/src` layout, HistoryPanel, VaryAffordance, bridge routes, store).
Claims from those passes are **(high)** unless noted; the one load-bearing unverified claim (the
surge GUI crash) is flagged inline. Companions: 128 (the loop), 130 (refactor waves this plan
must sequence against), 121 §3 (the harness the loop plugs into), the R6 GUI review.*

## Headline answers

1. **Surge: repair now, pick on boards, nudge in a real panel — and the panel is cheaper than
   round 1 priced it.** Opening a surge `.beat` in the GUI today likely **crashes the
   arrangement render** (`ArrangementView.tsx:2005`, unguarded kind lookup; unverified at
   runtime, reads as real), and even without the crash the track is silent and its device pane
   is blank. Round 1 sized "surge GUI panel" at L assuming a synth-panel-scale surface. Wrong
   frame: the edit path (`<track>.surge.patch` / `.override.<param>` via daemon `POST /edit`)
   **already works end-to-end**, the sidecar already enumerates every patch param internally
   (`python/surge_render.py:219-240` — just never exposes it), and the render cache is already
   content-hashed. A scoped SurgePanel — curated patch browser + override strip + one-click
   render-audition — is **M (~4 focused PR-days)**, honestly "edit → ~1-3 s → hear", not
   knob-drag. Recommended over bounce-to-engine (the T6 numbers say the engine cannot reproduce
   surge timbre — translation destroys the reason surge exists) and over hosting Surge's own UI
   (in-process is GPL-closed per D23; side-by-side Surge XT + user-patch round-trip is a
   documented later escape hatch, not a build). §2

2. **The cockpit is one new drawer, not a redesign.** The GUI has exactly one unclaimed region —
   the right drawer slot, currently History-only — and one proto-proposal surface nobody named
   as such: `VaryAffordance`, which already does snapshot → apply-in-memory → audition →
   Keep/Undo. The cockpit = a **Session drawer** (the BRIEF rendered clickable, board status,
   and a **review lane**: the agent's turn as rollup rows, each with hold-to-hear-before A/B and
   per-row revert), HistoryPanel rows that expand into the same rollup rendering, attribution
   toasts on agent-surface edits, and VaryAffordance generalized into the in-context candidate
   auditioner. No staging layer: the agent keeps applying edits directly (git-reversible,
   single-writer); review is retrospective with per-row undo — hunk granularity without forking
   a second document state. §3

3. **The rollup belongs in the GUI, and the daemon route is nearly free.** `rollupDiff` is a
   pure, IO-free core function with a stable typed JSON shape (`src/core/rollup.ts`); a
   `GET /rollup?since=<ref>` daemon route plus one React renderer gives both the review lane and
   the HistoryPanel expansion. Today no GUI surface shows any diff beyond the one-line
   checkpoint label. §3.3

4. **The taste flywheel is not spinning: telemetry is off and nothing reads it.** `~/.dotbeat/`
   does not exist on this machine; `BEAT_EDIT_LOG` is unset; grep finds zero readers of
   `edit-log.jsonl`. Step one is literally turning it on for owner sessions and writing the
   decisions.md entry 128 required. The first reader worth building is the **correction
   detector**: a GUI-surface edit whose path was last written by the agent = a labeled
   correction (before = agent's value, after = owner's). Corrections feed a PREFERENCES.md with
   an explicit lifecycle — *observed → owner-ratified → default/lint* — a sample floor (≥3
   same-direction corrections across ≥2 songs), scope tags, and a hard rule: preferences are
   **proposed in the BRIEF, never silently applied**, and never touch frozen eval profiles or
   critic training. Honest math: the toy-song program will yield single-digit ratified
   preferences. That is fine — PREFERENCES.md is a checklist for the agent, not a model. §4

5. **Continuity is one misplaced file away from correct.** The D29 file protocol
   (BRIEF/FEEDBACK/NOTES/decisions/checkpoints) already reconstructs a song session from files
   alone. The gap: PREFERENCES.md is specced per-song (`workshop/`), but preferences are
   owner-level, cross-song state — move it to `~/Documents/dotbeat/PREFERENCES.md` next to
   HANDOFF.md, the established shared home both a fresh agent and the owner already read. A
   `beat session status` resume verb is named as a candidate but deferred: practice before verb
   (the 121 lesson). §5

6. **Build order: repair the shipped loop first (S, days), then the two M's.** (1) The
   **loop-repair bundle** before the next toy run: surge kind-plumbing + crash fix, generate the
   board's `.context.wav` renders (the in-context toggle currently *never appears* because
   nothing produces them), telemetry on in the standard daemon launch + decisions.md entry,
   stale skill prose refreshed, `beat open --bar`. (2) **SurgePanel v1** [M]. (3) **Session
   drawer + `GET /rollup`** [M]. Board hot-swap, the correction detector, and a persistent surge
   worker wait for toy-run evidence. Sequencing against 130's waves is clean: the crash fix is
   wave-0-shaped; SurgePanel is a new component (aligned with W3.5's split direction, and its
   param list comes from the sidecar at runtime — **no new hand-mirror**); the rollup route
   coordinates with W2.3's daemon split. §6

## Part 1 — What round 1 shipped, and the seams it left

### 1.1 The loop as-landed (grounding pass, high)

| 128 item | Landed as | Seams found this pass |
|---|---|---|
| `beat board` | `cli/board.mjs` (465 ln, rate.mjs pattern, port 4322) + `src/board/decisions.ts`; manifest-order non-blind; provenance + LUFS/crest/centroid/width/sub/air per candidate; pick `1-9` / reject-all `n` (note required) / skip; writes `<batch>/decision.json` + `beat-decisions.jsonl` with provenance+features snapshotted, `nonBlind: true`; `--status --json` for agent readback; separation from `beat-scores.jsonl` is test-asserted | **The in-context toggle never appears**: it is gated on every candidate having a `.context.wav` (`board.mjs:122`) and *nothing generates them* — the single most-praised pattern in 128's survey is dark. One shared note box, not per-candidate reject notes. No adopt button (page tells you to run `beat adopt`). No deep link from a winner to `beat open`. No "more like this". |
| `beat open` + `/focus` | `cli/beat.mjs:5606-5667` → daemon `POST /focus` (`daemon.ts:1081-1126`, loud validation incl. `FOCUSABLE_PARAMS`) → SSE → `applyFocus` (`store.ts:276-302`) + one-shot param flash (`SynthPanel.tsx:702-745`) + arrangement scroll. Agent-focus and hand-click leave identical state (deliberate) | No `--bar` flag (128 specced one; the daemon's `clip` field is accepted, unvalidated, unconsumed). No auto-spawn (prints the daemon line, exit 3). Surge tracks: nothing to link to. |
| Edit telemetry | `src/telemetry/edit-log.ts`; `{t, session, surface, op, path, before, after, file}` to `~/.dotbeat/edit-log.jsonl`; GUI entries ride the daemon's undo gesture boundary — **one entry per knob drag** (test-asserted); CLI + MCP covered at their choke points | **Off** (opt-in `BEAT_EDIT_LOG` / `beat daemon --edit-log`; unset here, `~/.dotbeat/` absent). **Zero readers exist.** No `gesture_id`/`checkpoint_ref` fields from the 128 spec. The decisions.md entry 128 required was never written. |
| `beat diff --since --rollup` | `src/core/rollup.ts` (446 ln, pure, stable JSON); net before→after + tweak count per track+param, note clusters with bars, automation `+a ~c peak`, tracks by edit mass; `--since` defaults to last checkpoint, accepts pin names | CLI/agent-only — no daemon route, no GUI rendering anywhere. |
| Session rhythm | SKILL.md "Working with the owner" + **D29** (`decisions.md:12-34`): file protocol, `state: awaiting-owner @ <ref>`, wake-up ritual, ground-truth rule | Skill prose is stale — still says board and `--since/--rollup` "are being built on a sibling branch, check `beat help`", with dead fallback instructions. No `workshop/` scaffolding helper exists (fine — prose-first was the plan). Also: `decisions.md` has two D23s (:47, :149) — renumber one. |

### 1.2 The GUI's unclaimed real estate (grounding pass, high)

`App.tsx` (:268-375): topbar (Browser/Mixer/History toggles) · left rail = `ContentBrowser`
(260 px, one occupant) · main = `ArrangementView` (permanent) · bottom pane = exactly two tabs,
Clip / Device, routed by two ternaries at `App.tsx:85-86` · **right drawer = `HistoryPanel`
only** (list of checkpoints: pin badge, one-line semantic-diff label, Go back, pin — no diff
view of any kind) · `VaryAffordance` as a full-width strip · `ToastHost`.

Three facts shape everything in Part 3:

- **There is no agent presence anywhere.** The only agent-visible signal is the `focus` SSE
  event; an agent edit arrives as a *silent* full-document hot-reload with zero notification of
  what changed or who changed it. All ~20 toast call sites are local user-action failures.
- **`VaryAffordance` (283 ln) is already a proposal lane in miniature** — selection-scoped,
  snapshots the doc, applies each variant **in memory** so the live engine plays it, Prev / Next
  / Keep / Undo, Keep replays through `postEdit`. It is single-variant-visible, machine-generated
  only, ephemeral, and hardwired to `/vary*` — but the *idiom* (snapshot → in-memory apply →
  audition → commit-or-restore) is exactly the with/without A/B machinery the cockpit needs.
- **The right drawer slot is the one place a Session surface fits without redesign** — History
  already proves the pattern (slide-out, `min(90vw,520px)`, store-flag toggled).

## Part 2 — The surge answer

### 2.1 Where surge actually stands (grounding pass, high except where flagged)

The format/CLI side is complete and disciplined: a surge track is `patch "<name>"` + optional
`sampleRate` + normalized 0..1 `override <param> <val>` lines, **plus a full ordinary synth
block** whose volume/pan/sends/effect chain genuinely process the hosted audio
(`docs/surge-track.md:44-50`). `beat set <track>.surge.patch|sampleRate|override.<param>` exists
(`src/core/edit.ts:277-303`), reaches the daemon's `/edit` unchanged — **a surge param strip is
a pure UI + audition problem, not a protocol problem**. Rendering is offline-only: one surgepy
sidecar spawn per render (`cli/surge-render-prep.mjs` → `python/surge_render.py`), content-hash
cached (`surge_<track>_<hash12>.wav` + provenance sidecar), the track rewritten as a sample host
for the engine. 639 factory patches discoverable; `presets/surge-curated.json` holds a ranked,
scored, per-role shortlist (14 bassline / 16 chords / 16 lead survivors of the ring/activity
gates + aesthetics blend) — *already exactly the shape a patch browser wants*, though today it
is wired only into showdown, not authoring.

The GUI side is worse than "no panel":

- `ui/src/types.ts:92` omits `'surge'` from `TrackKind`, and `ArrangementView.tsx:2005` does an
  unguarded `AUTO_OPTIONS_BY_KIND[track.kind].map(...)` executed for every visible track row
  (:2708) — with a surge track that lookup is `undefined` and **the arrangement render throws**.
  (Read from source, not executed — worth the 2-minute runtime check, but treat as real. Medium-
  high.)
- Even un-crashed: the live engine binds voices by exact kind (`engine.ts:2839/2871/3097/3194`)
  — surge matches none, so the track is **silent** in the GUI (the `docs/surge-track.md:113-115`
  claim that the GUI plays the last render is stale: only `beat render`'s scratch-doc path does
  that; the interactive daemon never calls `prepareSurgeTracks`). The Device pane falls through
  to SynthPanel and renders an empty shell — or worse, live-looking knobs that are honest no-ops
  on a surge track.
- `beat inspect` and MCP are also surge-blind (`inspect.ts:104-126`; zero `surge` hits in
  `src/mcp/server.ts`) — an agent can't cheaply read back what a surge track is set to, and the
  MCP schema never mentions override paths.

On the sidecar's capabilities (the facts that reprice the panel): `_index_patch_params()`
already enumerates **every** parameter of a loaded patch (`surge_render.py:219-240`) — it is
just only ever called inside a render; there is no `--list-params` mode. `setParamVal` works;
no `get` of current value/range/display is used anywhere (whether surgepy exposes
`getParamVal`/display is a 30-minute spike — if yes, the strip shows real values; if no, it is
an overrides-only strip, still useful). Only 7 friendly aliases exist; everything else resolves
by unique substring **at render time**, failing as exit-4 — a GUI needs edit-time validation
from the enumerated list. Measured curation throughput was ~3 s/patch *including* aesthetics
scoring; a bare 2-4 s probe render is spawn + createSurge + loadPatch + faster-than-realtime
DSP — call it **1-3 s per audition** (medium — not separately timed).

### 2.2 The four options, priced honestly

| Option | What the owner gets | Cost | Verdict |
|---|---|---|---|
| **A. Minimal SurgePanel** — curated patch browser + override strip + render-audition | Patch swap + param nudges in the GUI, hearing each change ~1-3 s later on the track's own phrase; every tweak a canonical `.beat` line (diffable, undoable, telemetry-logged) | **M** (~4 PR-days, itemized §2.4) — round 1's L assumed a full synth surface | **Build (next slice)** |
| **B. Option-board flow** — agent renders patch/override sweeps, owner picks/nudges via board | Picking works today; "nudge" = reject-note → agent applies → re-board. Minutes per iteration, agent in the loop for every step | S (board exists; needs context renders — part of the repair bundle — and a sweep helper) | **Keep — it is the *selection* surface**; it is not fine-tuning. 128 already called this workaround "genuinely worse than knob-in-hand", and the owner's brief says fine-tuning is *their* job |
| **C. Bounce to engine patch** — `beat match` (T6 CMA-ES) translates the surge sound to an engine patch, owner fine-tunes live in SynthPanel | True knob-latency tweaking — of a *worse* sound: T6 ceiling v2 measured best engine matches at loss 1.85-2.62 vs 0.77 self-match, timbre ≈ 90 % of residual; blind showdown has engine at 0-4 % pairwise vs surge mid-pack | S to try, but lossy by measurement | **Reject as the fine-tuning path.** Keep as a niche move when a match happens to land close (the agent can offer it case-by-case with the loss number attached) |
| **D. Host Surge's own UI** | Full-fidelity editor, live sound | In-process: **closed** — GPLv3/JUCE linkage is exactly what D23 kept shut ("the GPL engine tier is CLOSED", `decisions.md:785`). Side-by-side: run Surge XT standalone, tweak with its own audio, save a user `.fxp`, dotbeat renders it — no linkage, license-clean | **In-process: never. Side-by-side: document later as the power escape hatch**, gated on user-patch support (`enumerate_patches` globs only `patches_factory` today; custom-path patches need discovery + provenance treatment) — real but clunky (two apps, no note sync, patch-file management) |

### 2.3 Recommendation

**Staged, with the panel committed rather than re-deferred.** Round 1 deferred the panel behind
"the runs will measure how much the workaround hurts" — but the owner's frame has since made
fine-tuning-synths-in-the-GUI an explicit pillar of *their* job, and this pass found the cost
was overestimated. So:

1. **Now, inside the loop-repair bundle (S):** add `'surge'` to the UI kind + guard the
   `ArrangementView.tsx:2005` lookup; render surge tracks as visibly-offline (badge on the track
   header: "renders offline — last render <age>", no fake knobs — route the Device pane to a
   stub SurgePanel immediately rather than the no-op SynthPanel shell). Boards remain the
   patch-*selection* surface, now with in-context renders.
2. **Next slice: SurgePanel v1 (M)** — §2.4. Honest ceiling stated up front: it is
   "edit, then hear" at render latency, a pedal not a knob. That is still categorically better
   than "ask the agent to nudge it and wait for an SSE reload".
3. **Later, evidence-gated:** a persistent surgepy worker (amortize createSurge/loadPatch; no
   repo precedent — `spawn-sidecar.ts` is one-shot) if toy-run sessions show the 1-3 s loop
   breaking flow; the Surge-XT-side-by-side escape hatch if the owner wants deep patch surgery.

### 2.4 SurgePanel v1, itemized

| Piece | What | Size |
|---|---|---|
| Kind plumbing | `'surge'` in `ui/src/types.ts`; `App.tsx:85-86` ternaries → small kind→panel dispatch map; crash guard; track-header offline badge | S (half-day) |
| Sidecar `--list-params` | New mode mirroring `--list-patches`, exposing `_index_patch_params` names (+ values/ranges if the surgepy `get` spike lands); daemon caches per patch | S (half-day) |
| Panel component | Patch picker: curated-per-role list from `presets/surge-curated.json` (scores shown — the board aesthetic) + searchable full 639; override rows: the 7 aliases pre-listed + "add param" search over the enumerated list, 0..1 sliders, edit-time validation, clear-override affordance; all writes are plain `POST /edit` on existing paths | M (1-2 days) |
| Audition loop | "Render & hear" button → daemon route spawns the existing cached render on the track's notes → SSE `surge-render` event → GUI plays the WAV through the engine's preview-buffer path; content hash means unchanged = instant. Optional "render in context" = same on a `beat excerpt` window | M (1-2 days) |

Two disciplines, both 130-mandated: the param list is **served, never mirrored** (no
`synthParams.ts`-style hand fork — the D9-breach lesson); and the panel is a **new component**,
not growth inside SynthPanel (which W3.5 wants split, not fattened). One new daemon
responsibility is real and should be named in the PR: the interactive daemon gains its first
render-triggering route — keep it preview-scoped (never writes into `media/` beyond the
existing cache) so D15's one-canonical-render-path stays true.

## Part 3 — The cockpit: what the screen looks like when the agent is a collaborator

### 3.1 Principles carried forward (from 128 §2.6, all still binding)

Small-N finalists; in-context audition at near-zero switching cost; picks land as ordinary
editable lines; **granularity of accept/reject is trust** (Cursor's per-hunk retreat → revolt);
with/without A/B on everything (the Google Docs preview toggle); rejection carries information.
Plus one new principle this design adds: **no staging layer.** The agent applies edits directly
— that is the daemon/D29 architecture (single writer, git-reversible, checkpoint-bounded), and a
pending-changes lane would fork a second document state the way Cursor's shadow buffers do.
Review is therefore *retrospective with per-row undo*: batch-then-review-at-checkpoint, the mode
128's survey found users explicitly asking for — hunk granularity without a proposals purgatory.

### 3.2 The screen

Five moves, in growth order (grow > new, per the R6 review's consolidation mandate):

1. **Session drawer** (NEW — the second occupant of the right drawer slot, sibling toggle to
   History in the topbar). Three stacked sections:
   - **The brief** — `workshop/BRIEF.md` rendered (daemon `GET /brief` serves the file). Its
     `beat open` lines become *local* rows: clicking one calls `applyFocus` directly — the deep
     link without the terminal. The `state:` line renders as the turn banner ("agent is
     awaiting you since <ref>, <age>").
   - **Boards** — open batch status (decided/undecided from the `--status` logic, which
     `board.mjs:12-15` deliberately kept exportable) with links out to the board pages. v1 links
     out; embedding waits.
   - **The review lane** — §3.3.
   - Plus a **"note to agent"** box at the bottom: appends to `workshop/FEEDBACK.md` in the
     capture format with the current selection context auto-attached (track/param/bar from the
     store — the thing chat can't capture precisely). No new file, no new channel: it feeds the
     protocol that already exists, and covers the async case (owner works at midnight, agent
     wakes tomorrow).
2. **HistoryPanel grows** (S/M): each checkpoint row expands in place into the rollup between it
   and its predecessor — same renderer as the review lane, fed by `GET /rollup?since=<ref>`.
   Checkpoint rows gain an **actor badge** (agent / owner): v1 attribution is
   checkpoint-granular via the daemon's existing `daemonSurface()` at `/checkpoint` time plus
   the intent strings agent checkpoints already carry — per-edit attribution waits for telemetry
   to be reliably on. This answers "does the rollup belong in the GUI's history panel": yes, and
   it is the same component the Session drawer uses for the latest turn.
3. **Attribution toasts** (S): the daemon stamps its `doc` SSE broadcasts with the originating
   surface; a non-`gui` surface fires a quiet toast — "agent edited bass (+3 tracks) — review" —
   whose click opens the Session drawer at the review lane. Today an agent edit is a silent
   hot-reload; this is the difference between a collaborator and a poltergeist. (New toast
   variant beside `success|error`; the ~20 existing call sites untouched.)
4. **VaryAffordance grows into the candidate auditioner** (M, gated): board v2's hot-swap —
   loading a batch's candidates as in-memory variant sets auditioned against the looping
   arrangement via the exact snapshot/apply/Keep/Undo idiom the strip already implements — is
   *this component generalized*, not a new surface. For engine-track candidates it beats
   pre-rendered WAVs (XO-style zero-latency); surge candidates stay pre-rendered. Gate per 128:
   only if v1 boards feel context-poor in the toy runs.
5. **SurgePanel** slots into the Device tab per §2.4; **ContentBrowser** is untouched in this
   slice (a curated-surge-patches section is a natural later add, same drag-to-track grammar).

What deliberately does **not** exist: an in-GUI chat pane. Chat is the wake channel (D14) and
lives in Claude Code; the cockpit's job is to make the agent's *work* legible in the GUI, not to
relocate the conversation.

### 3.3 The review lane (the hunk-granularity answer)

Content: `GET /rollup?since=<BRIEF ref>` rendered as grouped rows — per track by edit mass, each
row one rollup entry (`bass.cutoff 750 → 850 (14 tweaks)` · `lead: 3 notes moved, bar 2` ·
`automation c1.cutoff reshaped, peak +3`). Per row:

- **Hold-to-hear-before**: while held, apply the row's `before` value in memory (the
  VaryAffordance snapshot idiom — engine plays it, nothing touches disk); release restores
  `after`. The with/without toggle, per hunk, while the loop plays. Scalar params and
  automation lanes v1; note clusters get a **deep-link row** (open the clip view at those bars)
  instead — A/B'ing a note cluster in memory is the same mechanism but needs the cluster's
  before-notes from the ref doc, so it is v2.
- **Revert**: inverse edit through ordinary `POST /edit` (the rollup rows carry `before`).
  Cluster revert = restore the track's bar range from the ref — a daemon route reading
  `showFileAt`, M, v2.
- **Why**: rows carry the agent's stated intent when available — v1 sources it from the
  checkpoint intent string covering the row; per-row rationale would need the agent to annotate
  its edits (a `note` field on `/edit`, speculative — not in this slice).

The asymmetry is D29's, deliberately: this lane reviews **agent** turns and the owner may revert
freely; the agent never gets a symmetric lane over owner edits — it gets the rollup + the
never-revert rule.

## Part 4 — The taste flywheel

### 4.1 First, turn it on

The flywheel argument of 116/128 ("the feature is the flywheel") currently spins at zero RPM:
telemetry is opt-in, unset, and `~/.dotbeat/` doesn't exist. Actions, all S: `--edit-log` goes
into every standard daemon launch (skill text + the desktop sidecar's spawn args); the
decisions.md entry 128 §2.4 required gets written (opt-in flag stays — the entry records that
the owner's own daemon runs with it on); the toy runs then generate edit-stream data from
session one. Retrofitting loses those sessions forever — this precedes everything else in Part 4.

### 4.2 The correction detector (the first telemetry reader)

The highest-signal event in the log is not "owner moved a knob" — it is "owner moved a knob **the
agent had set**". The schema already supports detecting it: group entries by `file`+`path`; a
`surface:'gui'` entry whose most recent prior writer was `cli`/`mcp` within the same song is a
**correction** — `{param, agent_value, owner_value, direction, when, song}`. A small reader
(`src/telemetry/` gains its first consumer; S/M) emits `corrections.jsonl`; the agent's wake-up
ritual mines *that*, not the raw log. This is 128's proposal-outcome "modified" record,
operationalized — and it also powers the honest overfit guard: only corrections *of agent
choices* are preference evidence; an owner tweaking their own earlier value is just work.

### 4.3 The PREFERENCES.md lifecycle

Format per entry: directional statement + scope tags + evidence + status.

```
## pads: darker than my defaults
scope: role=pads, genre=deep-house        # never global by default
evidence: 2026-07-28 toy-1 pad.cutoff 1200→900; 2026-08-02 toy-2 pad2.cutoff 1400→1000
status: observed          # observed → ratified → default (or lint)
```

- **Sample floor:** an entry is written at ≥2 same-direction corrections, *proposed* at ≥3
  across ≥2 songs. Below that it stays in NOTES.md as observation.
- **Ratification, not inference:** the BRIEF gains a "preference candidates" section — "you have
  darkened pads in 3 sessions across 2 songs; adopt darker pad defaults? [yes / no / only this
  genre]". Owner says yes → status `ratified` → the agent applies it as a starting-point
  **owner overlay** on produced defaults (a post-`applyProducedDefaults` delta, production-only).
  The surfaced-observation step is the design: the owner hears "you usually darken pads" and
  gets to say "no — those two mixes were harsh", which is precisely the context a 3-sample rule
  cannot see. Nothing preference-derived is ever silently applied.
- **Where thresholds are expressible**, a ratified preference proposes a lint rule
  (preference-per-correction, the 121 §3.3 sibling) — the same complaint→detector pipeline,
  running on corrections instead of complaints.

### 4.4 What the telemetry must NOT feed

- **Frozen eval profiles** (`engineplusProfile` etc.): `===`-guarded science (D26/D27
  comparability with the rated arc). The owner overlay is a separate layer that never enters a
  showdown/eval arm — otherwise preference-learning quietly un-blinds the benchmark.
- **Critic training, for now.** `beat-decisions.jsonl` entries are trainable-shaped
  (features + picks, `nonBlind` tagged) — and should stay out. The critic sits at 64.4 %
  pairwise on 85+ *blind* entries; the toy runs will add a few dozen non-blind production picks
  — too few to move it, enough to contaminate it. Revisit as a deliberate, tagged import at
  ≥100 board decisions (128's line: imported deliberately, never leaked by default). Standing
  debt worth restating: the D25 pack-ref training-exclusion filter is still unimplemented, and
  nobody has yet done 128's 15-minute audit that no taste loader globs `beat-decisions.jsonl`.

### 4.5 Honest sample-size math

A 20-minute GUI session ≈ 30-80 coalesced gestures (one per drag, per the telemetry tests), of
which maybe 5-15 are corrections of agent values, of which repeated *directional* patterns are a
handful. The toy-song program (2-4 songs × 2-5 sessions) yields perhaps **3-8 candidate
preferences and fewer ratified ones**. Design accordingly: PREFERENCES.md's near-term value is a
short checklist the agent reads before choosing defaults — worth having at n=3. What is *not*
justified at these n's: auto-applied defaults, per-param learned priors, or any gradient
anything. The flywheel's first year is symbolic.

## Part 5 — Multi-session continuity

### 5.1 The state inventory (what a fresh agent + the owner must both be able to read)

| Artifact | Path | Writer | Reader | Scope |
|---|---|---|---|---|
| BRIEF.md (turn token, `state:` line) | `<workshop>/` | agent | owner (+ Session drawer) | per-song, per-turn |
| FEEDBACK.md (complaints + GUI note box) | `<workshop>/` | owner | agent | per-song, append |
| NOTES.md (interpretations, auditions) | `<workshop>/` | agent | both | per-song, append |
| **PREFERENCES.md** | **`~/Documents/dotbeat/` (moved — see below)** | agent, owner-ratified | both | **owner-level, durable** |
| decision.json / beat-decisions.jsonl | `<batch>/` / project dir | board | agent (+ later deliberate import) | per-batch / per-project |
| Checkpoints + pins (incl. the awaiting-owner ref) | hidden per-project git | both | both | per-project, durable |
| edit-log.jsonl / corrections.jsonl | `~/.dotbeat/` | daemon/CLI/MCP | correction detector (§4.2) | machine-level |
| HANDOFF.md | `~/Documents/dotbeat/` | agent | agent | program-level, decays fast |

### 5.2 Two fixes and one deferral

1. **Move PREFERENCES.md up a level.** D29/SKILL.md place it in the per-song workshop, but its
   content is owner-level and cross-song by construction (§4.3's evidence spans songs).
   `~/Documents/dotbeat/PREFERENCES.md`, next to HANDOFF.md — the established shared home the
   owner already browses and every session already reads — with the skill's ground rules gaining
   "read owner PREFERENCES.md before choosing any default" and the wake ritual writing to it.
   One-line D29 amendment.
2. **The resume entry point is BRIEF.md, and the skill should say so explicitly**: a fresh
   agent's first read is `<workshop>/BRIEF.md` (the `state:` line names the ref everything diffs
   against), then FEEDBACK.md-newer-than-BRIEF, then `beat board --status`, then
   `beat diff --since <ref> --rollup`. That ordering exists implicitly across the skill; making
   it a literal numbered "cold start" list costs a paragraph. Also restate the standing
   parallel-session rule (memory: concurrent sessions converge on `beat.mjs`) — one *producing*
   session per song; the BRIEF turn token is also the inter-session lock.
3. **Deferred: `beat session status`** — one verb printing daemon liveness, last checkpoint +
   state line, undecided boards, unread feedback. Attractive, but the file protocol has not yet
   been exercised by a single real toy run; per the 121 lesson (name the move, then harden it
   into a tool), it earns a verb after the runs show which fields matter. Candidate in §6's
   later table.

## Part 6 — The build plan, ranked

Scoring is (owner-time saved × frequency) / effort; sequencing constraints against doc 130's
waves are listed per item. The toy-song runs are the validation vehicle throughout: run 1
exercises the repaired loop, runs 2+ exercise the cockpit.

### Before the next toy run

| # | Item | Owner-time × frequency | Effort | 130 interaction |
|---|---|---|---|---|
| 1 | **Loop-repair bundle**: surge kind-plumbing + `ArrangementView.tsx:2005` crash guard + offline badge; **generate board `.context.wav`s** (in the vary/board render path — the in-context toggle currently never fires); telemetry `--edit-log` in standard daemon launch + the missing decisions.md entry; refresh the stale SKILL.md prose (board/rollup "sibling branch" lines); `beat open --bar`; renumber the duplicate D23 | In-context audition is the most-praised pattern in the whole survey and it is dark; every phase-4 decision hits it. The crash blocks any surge-containing song from the GUI at all. Telemetry-off forfeits the first runs' data forever | **S** (days, parallelizable) | Crash fix + doc rot are wave-0-shaped (ride with W0.6's hygiene); telemetry flag is config/prose; no file conflicts with W0/W1 packages |

### The two M's (next slice, in this order)

| # | Item | Owner-time × frequency | Effort | 130 interaction |
|---|---|---|---|---|
| 2 | **SurgePanel v1** (§2.4): kind dispatch, sidecar `--list-params`, curated patch browser + override strip, render-audition loop | "Fine-tuning synth sounds" is the owner's stated core job and is *impossible* in the GUI for the better-sounding synth today; every surge nudge currently costs an agent round-trip (minutes) vs seconds. Frequency: several per track, every song that uses surge | **M** (~4 PR-days) | New component — aligned with W3.5's split-don't-fatten direction; param list served, not mirrored (T1/D9 discipline); preview route is the daemon's first render trigger — name it, keep it cache-scoped (D15); `beat inspect`/MCP surge-blindness fixed in passing (S) |
| 3 | **Session drawer + `GET /rollup`** (§3.2-3.3): brief rendering with click-to-focus, board status, review lane (scalar A/B + revert v1), HistoryPanel rollup expansion, attribution toasts, FEEDBACK note box | The owner currently cannot see what the agent did without the CLI; every wake/handoff turn hits this. Review-at-checkpoint with per-hunk undo is the trust mechanism the survey says decides whether collaboration feels safe | **M** (~1 week) | `GET /rollup`/`/brief` are small routes — land before W2.3's daemon split or into its new routes module, not both; renderer is new UI (no conflicts); A/B reuses the VaryAffordance idiom (no engine changes, safe w.r.t. W2.7) |

### After the toy runs (evidence-gated)

| # | Item | Gate |
|---|---|---|
| 4 | **Correction detector + PREFERENCES lifecycle tooling** (§4.2-4.3) | ≥2 songs of telemetry on disk — building the miner before the data exists is guessing (the 128 rollup lesson) |
| 5 | **Board hot-swap via VaryAffordance** (§3.2 item 4) + per-candidate reject notes + adopt/`beat open` buttons on the board page | Toy runs say v1 boards feel context-poor or the pick→tweak seam has friction |
| 6 | **Persistent surgepy worker** (sub-second surge audition) | SurgePanel sessions show the 1-3 s loop breaking flow |
| 7 | **`beat session status`** (§5.2) | The cold-start file ritual proves annoying in practice |
| 8 | **Surge XT side-by-side escape hatch** (user-patch discovery + provenance, docs) | Owner asks for patch surgery beyond the override strip |

## Honest gaps

- **The surge crash is read, not run.** The `ArrangementView.tsx:2005` failure is source-derived
  (unguarded `Record<TrackKind,…>` lookup on a kind the UI type omits); nobody opened a surge
  `.beat` in the GUI this session. Two-minute check before scheduling the fix.
- **Surge audition latency is estimated, not measured in isolation** — the ~3 s/patch figure
  includes aesthetics scoring; the 1-3 s panel estimate needs one timed bare render. If it comes
  in at 4-5 s the persistent-worker item moves up the list. Whether surgepy exposes
  `getParamVal`/display strings is an unresolved spike that decides overrides-only vs
  real-values UI.
- **The review lane's note-cluster A/B and revert are v2 by fiat**, not by evidence — if toy-run
  sessions turn out melody-heavy, the scalar-first cut is wrong and cluster revert should be
  pulled forward.
- **Effort sizes are unprototyped** (the standing 128 caveat, still true): the SurgePanel ~4-day
  figure assumes the daemon preview route composes cleanly with the existing render prep;
  nothing was spiked.
- **The correction detector's precision is untested** — "GUI edit after an agent edit on the same
  path" will include some owner-experiments-then-restores noise; the ≥3-across-≥2-songs floor is
  the guard, but the false-positive rate is unknown until there is data.
- **Attribution v1 is coarse.** Checkpoint-level actor badges misattribute mixed turns (owner
  and agent both editing between checkpoints in a co-present session). Per-edit attribution
  needs telemetry reliably on plus the daemon stamping doc broadcasts — sequenced but not
  designed in detail here.
- **The cockpit adds GUI surface while 130's waves are trying to shrink it.** All three build
  items were checked against the wave plan at the package level (no shared files with W0/W1;
  named coordination for daemon/W2.3 and engine/W2.7), but the file-level pre-flight
  `git diff --stat` discipline from 130 §5 applies before each lands.
- **No prior art re-survey this round.** Part 3 leans on 128 §2.6's survey (single-agent, partly
  secondhand, per-claim confidence there); nothing new was fetched beyond a surgepy
  documentation check that returned little — the sidecar source was treated as ground truth
  instead.
