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
lanes hh oh` — not "the user circled some pixels." `[research pending: prior art — how
Cursor/Zed pass editor selections to the model, Photoshop's selection→generative-fill contract,
Figma AI selection scoping — steal the best conventions.]`

## 3. Agent placement: external driver vs embedded chat `[research pending]`

Two candidate shapes, not yet decided (owner explicitly deferred to research):

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
  Research should pressure-test this against prior art before we commit.

Decision criteria: implementation cost now, UX for non-terminal users, agent quality/upgrade
path, key management, offline behavior.

## 4. Versioning: checkpoints, not git UI `[research pending]`

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

`[research pending: what Ableton/Figma/Photoshop history UX gets right; whether any git-backed
creative tool has made non-programmers succeed with this, and what tripped them up.]`

## 5. The full-song view

The arrangement timeline (format v0.4 scenes/song) is the spine: tracks as rows, bars as
columns, notes visible across the whole song (density-rendered when zoomed out), section
boundaries labeled. This is also where selection lives — drag across bars, click a track
header, click a lane. The current beatlab GUI has the per-pattern grid; the song-length view is
new GUI work and is the desktop app's centerpiece screen.

## 6. Milestones (proposed — replaces "M4 someday" sequencing for the GUI track)

- **D1 — Shell**: Tauri wrap of the existing GUI, daemon logic in-process, open-a-folder,
  native file dialogs. No new musical features; ships the form factor.
- **D2 — Pointing**: selection protocol end-to-end (GUI ⇄ daemon ⇄ CLI/MCP), `beat vary
  --scope selection`, agent spotlight. This is the demo: highlight the hats, say "change this
  up," watch them change.
- **D3 — History**: auto-checkpoints, history panel with semantic labels, restore, named
  versions.
- **D4 — Song view**: full-arrangement editor with selection across it.
- **D5 — Chat surface**: whatever §3's research decides (external-only + docs, or embedded
  hybrid panel).

Ordering rationale: D1 is cheap and makes everything after it feel real; D2 is the
differentiator and unblocks the owner's exact "highlight the hi-hats" scenario; D3 makes agent
collaboration safe (undo anxiety kills trust); D4 is the biggest pure-GUI lift; D5 depends on
research. The native audio engine (old M4) proceeds independently underneath.

## 7. Open questions

- Agent placement (§3) — blocked on research 10.
- Selection grammar details: does a selection of `bars 8 16` with no tracks mean "all tracks"?
  (leaning yes — axes are filters, absent = unfiltered).
- History retention: every keystroke-ish edit vs debounced batches (leaning: one checkpoint per
  CLI command / per GUI gesture-end, debounced 2s).
- Does the embedded GUI keep its own undo stack distinct from checkpoints? (almost certainly
  yes — in-memory undo for typing-speed edits, checkpoints for "versions I might return to").
- Multi-window / multiple projects open at once — daemon-per-project vs one daemon multiplexing.
