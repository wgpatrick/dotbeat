# Research 10 — Human⇄agent interaction in the desktop DAW

*2026-07-11. Deep-research pass (105 agents: 5 search angles → 23 sources → 115 claims
extracted → top 25 adversarially verified, 3 skeptic votes each → 24 confirmed, 1 refuted).
Covers parts 1–2 of the owner's question (selection-as-context, embedded vs external agent).
Part 3 (versioning) produced ZERO surviving claims in this round and re-ran as its own focused
pass → `11-versioning-ux.md`. Feeds `docs/product-spec-desktop.md` §2–§3.*

## Verified findings

### 1. Selection-as-context is a converged, multi-vendor pattern — not a novel bet *(3-0, high)*

Cursor Inline Edit ("Select the code you want to change… Cursor applies the edit to your
selected code"), VS Code inline chat ("Select a block of code to scope the prompt to that
code"), Zed Inline Assistant ("sends your current selection (or line) to a language model and
replaces it in place"), and Visual Studio Copilot Chat (current selection implicitly included
in chat context) all ship the identical contract: **highlight, then say "change this."**
Sources: cursor.com, code.visualstudio.com, zed.dev, learn.microsoft.com (all primary docs).

**Verifier caveat that matters for us:** selection scoping in these tools is *design intent,
not a hard guarantee* — VS Code has bug reports of edits escaping the selection, and Photoshop
v26.1+ had an acknowledged defect where generation bled 10–20px past the selection edge.
→ **dotbeat should enforce selection scope structurally**, which we uniquely can: edits are
semantic operations on IDs, so `--scope selection` can *reject* any mutation outside the
selected set rather than hoping the model stays inside. A guarantee, not a suggestion.

### 2. Context sharing is layered: implicit + explicit + provenance *(3-0, high)*

The shipped stack is three mechanisms, not one:
- **Implicit** — no selection ⇒ scope defaults to the active file; workspace indexing pulls in
  relevant files automatically.
- **Explicit** — `#`-attachments (files, folders, symbols, terminal output, even line ranges
  `#MyFile.cs:66-72`) and `@`-mentions for things not on screen.
- **Provenance** — a References dropdown after each response shows what context the model
  consumed (caveat: community reports say it can omit implicitly-added context).

DAW mapping: current GUI selection + visible arrangement = implicit; `@drums`, `@bridge`,
`@bars 8-16` in chat = explicit attachment of off-screen referents; and a visible "what the
agent read/changed" trace = provenance (our agent-spotlight channel plus `beat diff` output).

### 3. Creative tools ship the same contract, editing real objects in place *(3-0, high)*

- **Figma Prompt-to-Edit** (beta since May 2026): "select specific layers first, so the agent
  edits exactly what you mean… applying changes to your real layers, text, and components
  instead of generating something new to rebuild." Documented flow is four steps: select →
  prompt → review on canvas → refine.
- **Photoshop Generative Fill**: a user-made selection scopes the AI edit to that region; the
  *text prompt is optional* — selection alone can carry intent (blank prompt = fill from
  surroundings).

Two transfers for dotbeat: (a) the agent edits the user's actual tracks/notes (which our
file-is-ground-truth design already forces — no "generated replacement project"); (b)
selection-without-prompt is a meaningful gesture (e.g. select hats + hit "vary" = no typing).

### 4. Embedded vs external: all first-party prior art is embedded — but as a TWO-TIER hybrid *(3-0 ×5, 2-1 ×1)*

No shipped pattern is a single chat window. The converged shape is:
- **Tier 1 — lightweight inline edit at the selection**: Cursor Cmd+K, VS Code inline chat,
  Zed inline assistant, Photoshop's Contextual Task Bar (appears *at* the selection: model
  picker + prompt, no chat window).
- **Tier 2 — full chat/agent panel** for multi-step work: VS Code's official guidance splits
  labor exactly this way ("inline chat for quick, targeted edits… Chat view for multi-step,
  multi-file work").
- **Escalation carries the selection across the boundary**: Cursor Cmd+L opens Agent mode
  with the selection preloaded; Zed's inline assistant can `@thread` a past panel
  conversation. Figma ships its agent as a mode *alongside and able to invoke* its point
  tools.

### 5. Human-in-the-loop acceptance is universal *(3-0, high)*

Two mechanisms, both directly transferable:
- **Preview-then-commit**: VS Code shows AI edits as an inline diff; the user must Keep or
  Undo. (Nuance: pending edits are *applied to the buffer revertibly*, not held outside it —
  an interesting model for DAW audition: apply the edit, let it play, revert on reject.)
- **Variation-then-choose**: Photoshop generates three candidates per prompt; the user picks
  or regenerates. Nothing auto-commits.

The DAW analogue is *auditionable pending edits* — hear the change in context before
accepting — and multiple takes per request, which is exactly what `beat vary` batches already
produce. Variation-then-choose is also the natural seed for branch-per-variation versioning.

## Post-pass verification (this session, single-source but primary)

The pass's one gap on the external-agent side — "no shipped first-party example of an external
agent driving a creative desktop app was confirmed" — is **now closed**: Anthropic's official
announcement (anthropic.com/news/claude-for-creative-work, **April 28, 2026**, fetched and
read directly) ships first-party connectors from Claude to **Ableton, Splice**, Blender, Adobe
Creative Cloud, Autodesk Fusion, Resolume, SketchUp, and Affinity — e.g. Resolume "control[led]
in real time through natural language." Community precedent for exactly our pattern also
surfaced in search (unverified beyond repo READMEs): **Producer Pal** (MCP server as a Max for
Live device; the external agent can read the user's current selection in Ableton) and
**ahujasid/ableton-mcp**. So both halves are real: embedded two-tier UX has the converged
first-party pattern, and external-agent-over-MCP has first-party product momentum from the
model vendors themselves.

## Refuted (do not build on)

- "Figma AI is invoked through the Actions menu" — killed 1-2. Don't cite the Actions menu as
  Figma's AI entry point.

## What this decides for dotbeat (spec updates applied)

1. **D2 selection protocol is validated wholesale** — and we can beat the prior art on the
   one weakness verifiers found, by *enforcing* scope structurally.
2. **Agent placement: the hybrid is now research-backed** — an embedded two-tier surface
   (inline affordance at the selection + chat panel) fronting an external agent runtime over
   MCP. The embedded tiers are UX chrome; the agent stays real and swappable. This matches
   *all* converged first-party UX **and** the first-party external-agent product direction.
   Final call remains the owner's, but the evidence no longer supports a plain
   external-terminal-only story as the end state (fine as the D1-era interim, since it works
   today).
3. **Acceptance UX**: pending agent edits must be auditionable (revertible-apply model) and
   variation batches presented as choose-one — wire `beat vary` into the panel from day one.

## Open questions carried forward

- Versioning/undo (part 3) → dedicated pass running, lands as `11-versioning-ux.md`.
- The audio equivalent of the inline diff: how exactly to A/B a pending edit during looped
  playback (pre/post solo of the selection? crossfade toggle?). Prototype question for D2.
- Logic/Ableton first-party AI features (Session Players etc.) — nothing survived
  verification this round; low urgency, revisit if their UX ships something selection-shaped.
- Provenance completeness: don't repeat VS Code's gap — our "what the agent read" trace
  should include implicit context (the selection value itself), not just explicit mentions.
