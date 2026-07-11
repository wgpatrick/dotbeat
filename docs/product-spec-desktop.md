# dotbeat Desktop — product spec

*Started 2026-07-11 from owner direction (voice notes). Living document — sections marked
`[research pending]` will be revised when `docs/research/10-interaction-and-versioning.md`
lands. This spec is about the product; engine internals live in
`docs/m4-native-engine-design.md`.*

## Owner direction this spec exists to serve (2026-07-11)

Paraphrased from the owner, kept close to the original wording because it's the requirements
source:

1. **Desktop app connected to local files** — not a hosted web app. (Recorded in
   `decisions.md` D3 update; Tauri shell pulled forward.)
2. **See the whole song** — all the notes over the entire course of the song, in one view.
3. **Selection the agent can see.** "I'd want to highlight something and I want that highlight
   to be able to be seen by the agent… then I might be like, hey, create variations of this
   section. Or I might highlight the drum track, or the hi-hats, and be like, hey, change this
   up."
4. **Agent placement is genuinely open.** Option A: the DAW is open and Claude (on the user's
   machine, CLI) drives it — "I'm typing to Claude and it's automatically changing things that
   are in the DAW, so I can visually see all the changes… might be the easiest implementation."
   Option B: "embedding an LLM chatbot into the system itself." Owner asked for research on
   this whole interface/interaction question rather than a snap decision.
5. **Versioning.** "We make changes — we want to store the previous version so you can go
   back."
6. **Live input.** "We will want to be able to input notes at arbitrary times… like tapping
   on keys to create rhythm." Play it in, don't program it in.

## 1. What the product is

A desktop DAW where the project is a folder of plain files (`.beat` text + `media/`), the GUI
is one of three equal ways to touch it, and an AI agent is a first-class collaborator rather
than a bolted-on chatbot. The three surfaces:

| Surface | Who uses it | What it's for |
|---|---|---|
| **The file** | humans-as-editors, git, agents | ground truth; every change is a readable diff |
| **CLI / MCP** | agents (Claude Code etc.), scripts | every edit primitive, render, metrics, vary/score |
| **GUI (desktop shell)** | humans-as-musicians | seeing, hearing, selecting, playing |

The bet (unchanged since the roadmap): the agent doesn't need a screenshot of the DAW or
pixel-level control — it reads and writes the same file the GUI renders. The GUI's job in the
agent story is to give the *human* eyes on what the agent did (live-updating views, diffs) and
to give the *agent* the human's pointing finger (selection). Which is the part that's new:

## 2. Selection as shared context (the pointing protocol)

The single most load-bearing new idea from the owner notes. "Change this up" is only meaningful
if "this" is machine-readable. The format was accidentally built for exactly this: **every
entity in `.beat` already has a stable ID** (tracks, notes, clips, scenes, lanes are named;
time is bars). So a selection is just a small value:

```
selection
  tracks drums            # a whole track
  lanes drums.hh          # …or specific lanes of it
  bars 8 16               # …or a time range
  notes lead.u3 lead.u7   # …or individual notes
```

(any subset of those axes; empty = no selection)

### How it flows

- **GUI → daemon:** the GUI already POSTs state to the daemon on every edit; selection becomes
  another (ephemeral, never written to the `.beat` file) channel: `POST /selection`, pushed on
  every selection change.
- **Daemon → agent:** exposed two ways — `beat selection` (CLI, prints the current selection in
  the grammar above) and an MCP resource/tool so "create variations of the selected section"
  works with zero copy-paste. Selection also stamps into `beat vary` (`--scope selection`) so
  the variation loop mutates only what's highlighted.
- **Agent → GUI (reverse pointing):** the same channel run backwards — the agent sets a
  "spotlight" (e.g. after `beat diff`, highlight what changed; or "look at bar 12, the kick and
  bass collide") and the GUI renders it. Cheap to build once the forward direction exists, and
  it makes agent changes *legible* instead of spooky.

### Why this beats screenshots/computer-use

Deterministic, instant, diffable, and works headless. The agent gets `bars 8-16 of track drums,
lanes hh oh` — not "the user circled some pixels."

### Research-validated (research 10, 24 claims verified 3-0)

Selection-as-context is the *converged* pattern across Cursor/VS Code/Zed/Visual Studio and
Figma Prompt-to-Edit/Photoshop Generative Fill — highlight, then say "change this," edits
applied to the user's real objects in place. Three conventions to adopt from the prior art:

- **Layered context**: selection = implicit context; `@`-mentions in chat for off-screen
  referents (`@drums`, `@bars 8-16`); a visible "what the agent read/changed" trace
  (provenance) — and unlike VS Code's References dropdown, ours must include the *implicit*
  context (the selection value), not just explicit mentions.
- **Enforced scope, not suggested scope.** Verifiers found the prior art's weakness: selection
  scoping there is design intent (VS Code edits escape selections; Photoshop had a
  bleed-past-the-edge defect). Because our edits are semantic operations on stable IDs,
  `--scope selection` can structurally *reject* mutations outside the selected set. A
  guarantee no pixel/text-buffer tool can make — lead with it.
- **Selection-without-prompt is a gesture**: Photoshop fills from a blank prompt + selection.
  Ours: select the hats, hit "vary" — no typing.

## 3. Agent placement: external driver vs embedded chat `[research in — owner call pending]`

Two candidate shapes (owner explicitly deferred to research; research 10 is now in):

- **A. External agent, live-updating DAW.** Claude Code (or any MCP client) runs beside the
  app, talks to the daemon/MCP server; the DAW window updates as edits land (it already does —
  this is exactly how the browser GUI behaves under `beat` CLI edits today). Cheapest to ship:
  it *works right now* minus selection. Keeps the agent swappable/upgradeable, keeps API keys
  and billing out of the app.
- **B. Embedded chat panel.** A chat UI inside the desktop app talking to an LLM directly.
  One-app UX, no terminal; but we own prompt/agent-loop/keys/billing, and the embedded agent is
  frozen at whatever we built it to be.
- **Likely answer is a hybrid** (A's engine with B's front-end): the app embeds a chat *panel*
  that is a thin client to an external agent runtime (e.g. Claude Agent SDK / Claude Code
  headless) which itself talks MCP to the daemon. Musicians see one app; the agent stays real.

**Research 10 verdict: the hybrid is now research-backed, with one refinement — the embedded
surface should be TWO-TIER.** Every first-party shipped pattern (VS Code, Cursor, Zed,
Photoshop, Figma) is embedded but split into (1) a lightweight inline affordance *at the
selection* (Cursor Cmd+K, Photoshop's Contextual Task Bar) for quick scoped edits, and (2) a
full chat/agent panel for multi-step work — with escalation that carries the selection across
(Cursor Cmd+L preloads the selection into Agent mode). Meanwhile the external-agent-over-MCP
half has first-party momentum too: Anthropic ships official Claude connectors to Ableton,
Splice, Blender, Adobe CC, Resolume et al. (April 2026), and community Ableton-MCP projects
(Producer Pal) already do exactly our pattern. So: **option A is the correct interim** (works
today, D1-era), and the end state is the hybrid — inline "vary this" affordance + chat panel,
both fronting an external agent runtime over MCP. Acceptance UX from the same research:
pending agent edits are *auditionable* (applied revertibly — hear it, then Keep/Undo, VS Code's
model) and `beat vary` batches present as variation-then-choose (Photoshop's model). Owner
sign-off still wanted before D5 commits to this.

Decision criteria: implementation cost now, UX for non-terminal users, agent quality/upgrade
path, key management, offline behavior.

## 4. Versioning: checkpoints, not git UI `[research in — see research 11]`

Ground truth: the project is already a git-friendly text file — versioning is a UX problem, not
a storage problem. Direction:

- **Auto-checkpoint**: every agent edit batch and every GUI save commits automatically to the
  project's local repo (init'd invisibly on project creation). The `.beat` diff discipline
  means each checkpoint is *readable* ("hats: velocity humanized, bars 8-16").
- **History panel**: a linear list — timestamp, one-line semantic diff (we already generate
  these via `beat diff`), play button (checkpoints are renderable), restore button. "Go back"
  = restore; restoring creates a new checkpoint rather than rewriting history, so redo is free.
- **Named versions**: "pin" a checkpoint with a name ("rough mix v1", "the good bridge").
- **Branch-per-variation** (later): `beat vary` batches land as short-lived branches; audition,
  keep one, the rest garbage-collect. Musicians never see the words git/branch/commit.
- Media files ride in-repo while small; revisit (LFS or content-store) if projects get heavy —
  media is already content-addressed by sha256, which is most of the work.

**Research 11 verdict (23 claims verified 3-0): the direction above is the shipped consensus,
with four refinements now adopted:**

- **Append-only restore is the norm** — Figma's restore creates *two* new checkpoints (the
  pre-restore state stays recoverable); a claim that restore is destructive was refuted 0-3.
  Also: auto-checkpoint before *and* after risky operations (vary-batch apply), Figma's
  bracketing pattern.
- **Index history by intent, not time**: Cursor/Claude Code list checkpoints by the *prompt*
  that caused them, not timestamps. Ours get three layers: the automatic semantic diff
  one-liner, the agent prompt when applicable, and optional user pins (Figma named versions,
  ≤25-char titles). Unnamed checkpoints collapse between named ones so the timeline skims.
- **Strip ALL git vocabulary** (Figma: "Commits felt like extra work. Branches of branches
  felt complex" — no commit step, one branch level, no revert verb). Variations are "takes",
  restore is "go back", named versions are "pins".
- **The Ableton pain is confirmed** (Live discards undo history on every save — reports span
  2010→Live 12.1), and the community's git-on-.als tools prove save-as-commit works but leave
  history unlabeled — the exact gap our semantic diffs fill.

**And the Splice Studio lesson (launched 2014, shut down 2023, verified via the CEO letter):**
"GitHub for music" validated save-as-commit + per-revision comments with zero git vocabulary —
then died because free unlimited *cloud* storage of every save was an unmonetized cost center,
and its shutdown took users' version history with it. dotbeat inverts the failure mode by
construction: history is a plain local git repo in the project folder — no cloud bill, no
shutdown risk, the user owns it, and a git remote is optional off-site backup.

Still open (tracked in research 11): media/binary versioning at scale (LFS vs content-store —
our media is already sha256-addressed), and what tripped users of git-hiding tools like
Abstract — revisit before D3 ships.

**Shipped 2026-07-11: named pins + collapsed history (closes the "named versions" line item and
the retention/collapse open question below).** `beat pin <file> <ref> <name>` names a checkpoint
(<=25 chars, Figma's budget); `beat unpin`/`beat pins` remove/list them. Storage is a plain git
tag (`pin/<slug>`, annotated with the exact display name) in the same local repo as the
checkpoints themselves — no new sidecar file, nothing a cloud shutdown could take with it, and
because tags are immutable refs, a pin is untouched by `restore`'s append-only rewrites (see D10).
`beat history` now shows a pinned entry's name alongside its semantic label (`[pin: rough mix
v1]`); `beat history --collapsed` folds runs of unnamed checkpoints between pins into a single
"N more checkpoints" line so a long timeline still skims. Same shape as MCP tools
(`beat_pin`/`beat_unpin`/`beat_pins`, plus a `collapsed` flag on `beat_history`) and CLI
(`src/history/history.ts`, `cli/beat.mjs`, `src/mcp/server.ts`).

## 5. The full-song view

The arrangement timeline (format v0.4 scenes/song) is the spine: tracks as rows, bars as
columns, notes visible across the whole song (density-rendered when zoomed out), section
boundaries labeled. This is also where selection lives — drag across bars, click a track
header, click a lane. Per-pattern editing (step sequencer / piano roll) is one screen; the
song-length arrangement view is another, and together they're dotbeat's own frontend's
centerpiece work (D12: built independently, not inherited from BeatLab).

## 5.5 Live capture (tap-to-record)

The format side landed as **v0.7 (2026-07-11): fractional note timing** — notes store at
arbitrary step positions (4-decimal canonical precision, engine verified sample-accurate), so
a tapped performance records *as played*. What remains is the capture UX, which is GUI work:

- **Tap recording**: during looped playback, computer-keyboard (later MIDI) taps become notes
  timestamped against the transport, written to the file on loop end (one checkpoint per
  take — versioning makes bad takes free).
- **Quantize is an edit, not a default** (built 2026-07-11, owner-directed Ableton model):
  captured timing is kept raw; `beat quantize` snaps starts and/or ends to a chosen grid with
  an amount knob (0.5 = halfway — tighten without flattening), scoped to note ids (the
  selection protocol's `--scope selection` plugs straight in). Also exposed as `beat_quantize`
  over MCP, so the agent can do it conversationally.
- **Humanize generates the feel** (built 2026-07-11): `beat humanize` / `beat_humanize` walks a
  stiff on-grid part *away* from the grid — seeded timing/velocity jitter, constant
  behind-the-beat drag (`--push-late`, the Dilla move), offbeat swing — scoped by lane or note/
  hit id (i.e. by selection). Deterministic under a seed, so a good feel is reproducible, and
  every nudge is a one-line diff. This is the generative half of the loop: the agent produces
  the human feel, quantize can undo it, and the checkpoint system makes trying feels free.
- **Drum lanes**: tapping a drum lane needs off-grid drum hits, which the pattern grid can't
  express — per-lane swing or note-style hit lines is a follow-up format decision (spec'd as
  an open question in format-spec v0.7 notes).

## 6. Milestones (proposed — replaces "M4 someday" sequencing for the GUI track)

**Update 2026-07-11 (owner, D12 in `decisions.md`): dotbeat builds its own GUI, not a Tauri wrap
of BeatLab.** The milestones below are renumbered against that: D1 (shell) shipped as a spike
against BeatLab's GUI to de-risk WKWebView Web Audio — that risk answer stands (Web Audio works
in WKWebView, confirmed) even though the shell's actual webview content is being rebuilt to point
at dotbeat's own frontend instead. D2/D3 (selection protocol, checkpoint/history) are backend
work in `src/daemon`/`src/history` that was never BeatLab-coupled and is unaffected. D4/D5 are
now scoped as dotbeat-owned frontend builds from the start, not BeatLab retrofits.

- **D1 — Shell**: Tauri shell, daemon as a bundled sidecar, open-a-folder, native file dialogs,
  pointed at dotbeat's own frontend (once it exists) instead of a BeatLab dev/production build.
  *(research 13: feasible; daemon-sidecar + fs plugins well-supported. Highest risk = macOS
  WKWebView Web Audio — de-risked via a one-day spike, confirmed working regardless of which
  frontend the webview loads.)*
- **D2 — Pointing**: selection protocol end-to-end (GUI ⇄ daemon ⇄ CLI/MCP), `beat vary
  --scope selection`, agent spotlight. This is the demo: highlight the hats, say "change this
  up," watch them change.
- **D3 — History**: auto-checkpoints, history panel with semantic labels, restore, named
  versions.
- **D4 — Song view**: full-arrangement editor with selection across it.
- **D5 — Chat surface**: the two-tier hybrid (§3), now research-backed (research 14: the Claude
  Agent SDK gives streaming, tool-visibility, interrupt, permission-gating, resumable/forkable
  sessions, and the app-is-an-MCP-server pattern). Ship the BYO-Claude-Code fallback first (our
  MCP server + any client — near-zero new work); the embedded SDK panel is gated on the open
  auth/terms question, not on engineering.

Ordering rationale: D1 is cheap and makes everything after it feel real; D2 is the
differentiator and unblocks the owner's exact "highlight the hi-hats" scenario; D3 makes agent
collaboration safe (undo anxiety kills trust); D4 is the biggest pure-GUI lift; D5 depends on
research. The native audio engine (old M4) proceeds independently underneath.

## 7. Open questions

- Agent placement (§3) — blocked on research 10.
- Selection grammar details: does a selection of `bars 8 16` with no tracks mean "all tracks"?
  (leaning yes — axes are filters, absent = unfiltered).
- History retention: every keystroke-ish edit vs debounced batches (leaning: one checkpoint per
  CLI command / per GUI gesture-end, debounced 2s). Still open (this is about *when a checkpoint
  gets created*). What's now shipped is the adjacent *display* question — unnamed checkpoints
  collapsing between named pins so a long timeline skims (§4, `beat history --collapsed`) — which
  works regardless of how cadence above is eventually decided.
- Does the embedded GUI keep its own undo stack distinct from checkpoints? (almost certainly
  yes — in-memory undo for typing-speed edits, checkpoints for "versions I might return to").
- Multi-window / multiple projects open at once — daemon-per-project vs one daemon multiplexing.
