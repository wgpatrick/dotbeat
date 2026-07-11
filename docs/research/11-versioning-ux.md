# Research 11 — Versioning & history UX for a git-backed DAW

*2026-07-11. Focused re-run of research 10's part 3 (which produced zero surviving claims).
Deep-research pass: 104 agents, 5 angles → 22 sources → 109 claims → top 25 adversarially
verified → 23 confirmed, 2 refuted. Plus post-pass targeted verification of the Splice Studio
story (first-party CEO letter). Feeds `docs/product-spec-desktop.md` §4.*

## Verified findings

### 1. The converged checkpoint grammar *(3-0 across Figma, Cursor, Claude Code)*

Shipped tools agree on a three-layer shape:

- **Automatic checkpoints**, time- or event-based: Figma every 30 minutes plus on
  connection-loss/crash; Cursor before each significant agent change; Claude Code per user
  prompt.
- **Optional human semantic labels on top**: Figma named versions (Cmd+Opt+S, titles clip at
  25 chars, descriptions ≤140 recommended; autosaves can be named retroactively); Ableton git
  tooling relies on user-typed tags like "bassline".
- **Skimmability by collapsing**: unnamed autosaves between named versions auto-collapse into
  expandable groups so the timeline stays readable.

### 2. Restore is append-only, never a history rewrite *(3-0)*

Figma's restore adds **two new checkpoints** (one preserving the pre-restore state, one at the
restoration point) — the abandoned state stays recoverable; any version can alternatively be
duplicated into a fork. A draft claim that Figma restore is destructive/global was **refuted
0-3**. This confirms the spec's "restore creates a new checkpoint" design as the shipped norm.

### 3. Figma deliberately stripped git concepts for designers *(3-0, vendor framing caveat)*

No commit step (branch work continuously auto-saves — "Commits felt like extra work"), no
nested branches (one level off main — "Branches of branches felt complex"), no git-style
revert (undo-a-merge = restore a pre-merge version; Figma auto-creates "Before merge"/"Before
update" safety checkpoints around every branch operation). Upstream changes arrive as an
in-app *notification* offering to update from main — not a pull the user must remember.
Conflicts resolve per-conflict (keep main / keep branch) in a review step. Caveats: rationale
quotes are the vendor's own framing; one verifier notes no-nesting may partly be roadmap gap.

### 4. Checkpoint-bracketing around risky automated changes *(3-0)*

Figma's autosave engineering post: when applying an offline diff, it automatically creates
version-history checkpoints ("similar to a Git commit") **before and after** applying —
chosen over a visual merge UI because visually diffing a 2D document was judged an unsolved
problem (2020-era; Figma later shipped a branching diff UI in 2021). Same shape as
agent-edit checkpointing. Notably: *our* diffs are semantic one-liners, so the "can't show
the diff" constraint that forced checkpoint-only UX on Figma doesn't bind us — we can do both.

### 5. The Ableton pain is real and the mechanism is proven *(3-0 ×4)*

Live **discards undo history on every save** (user reports 2010→Live 12.1, corroborated
across forums) — the core motivation for bolting git on. Community tooling does
save-as-commit (`git commit` on every Ctrl+S; .als is just gzipped XML). Findability is only
optional user-typed tags — default checkpoints are unlabeled saves. That gap (unlabeled
history) is exactly what our semantic `beat diff` labels fix for free.

### 6. Agent checkpoints in the wild *(3-0 ×4, one refutation that matters)*

- **Cursor**: auto-checkpoint before significant agent changes, preview-then-restore from the
  chat timeline; stored locally, separate from git; explicitly "use Git for permanent version
  control." Doesn't capture the user's manual edits.
- **Claude Code**: checkpoints indexed **by prompt** (the /rewind menu lists what you asked,
  not timestamps), three restore paths (code+conversation / conversation / code), persist
  across sessions, 30-day cleanup. **Refuted 0-3**: "checkpoints before literally every edit,
  so agent edits can always be undone" — restore only covers the agent's file-tool edits.
- Both index history by *intent* (the prompt/conversation), not by time — strong precedent
  for labeling checkpoints with the musical request + semantic diff, not timestamps.

## Post-pass verification: the Splice Studio story (single-source-tier, first-party CEO letter)

The closest direct prior art — "GitHub for music" — launched 2014, shut down in phases
March–June 2023 ([CEO letter](https://splice.com/blog/studio-shutdown/)):

- **What it was** (CDM, 2021): save-as-commit ("when you save inside Splice's project folder,
  it uploads automatically"), per-revision comments, track names + plug-in lists per version,
  menubar app + browser timeline. Ableton/Logic/FL/GarageBand/Studio One. Free, unlimited.
- **Why it died**: never monetized ("hasn't been a focus since 2017"), free unlimited cloud
  storage of every save of every project was a pure cost center next to the sample-marketplace
  business; CEO: "we haven't been able to provide the quality of experience of which we can
  be proud."
- **What users lost**: sessions and revisions stopped syncing; the version history lived on
  Splice's servers, so the shutdown took it with them.

**The lesson is structural, not UX**: Splice validated demand for save-as-commit + comments
with zero git vocabulary — and then demonstrated the failure mode of *centralized* history.
dotbeat inverts it: history is a plain local git repo inside the user's project folder. No
cloud bill, no shutdown risk, user owns it, and any git remote is optional off-site backup.

## Refuted (do not build on)

- "Figma restore is destructive and global to collaborators" — 0-3.
- "Claude Code checkpoints before every edit / all agent changes always undoable" — 0-3.

## What this decides for dotbeat (spec §4 updated)

1. **Checkpoint cadence**: per agent edit batch + per GUI gesture/save (event-based like the
   agent tools, not Figma's 30-minute timer — our checkpoints are cheap text commits).
2. **Labels**: every checkpoint gets an automatic semantic label (the `beat diff` one-liner)
   *plus* the prompt/intent when an agent made it (Claude Code's prompt-indexing) *plus*
   optional user naming/pinning (Figma). Unnamed checkpoints collapse between named ones.
3. **Restore**: append-only, Figma-style — restoring creates a new checkpoint; never rewrite.
   Auto-checkpoint before *and* after risky operations (vary-batch apply, merges).
4. **No git vocabulary anywhere**: no commit/branch/merge words. Variations are "takes";
   restore is "go back"; named versions are "pins".
5. **Local-first is the moat**: the Splice failure mode is impossible by construction.

## Open questions carried forward

- What tripped non-technical users of git-hiding tools (Abstract shut down, GitButler,
  Plastic SCM for artists) — no claims survived; low urgency now that Figma+Splice cover the
  design space, revisit before D3 ships.
- Media/binary versioning at scale (Git LFS failure modes, content-addressed stores) — no
  claims survived. Our media is already sha256 content-addressed and projects are small so
  far; needs a real answer before recorded-audio features (old M4 territory).
- Photoshop history states — never landed in any pass; likely fine to skip (in-session undo
  is a different mechanism than persistent versions, and we already plan both).
- Can auto-generated semantic labels beat prompt-indexing at "find the good version"? We're
  betting yes (we have `beat diff`); worth a usability check once the history panel exists.
