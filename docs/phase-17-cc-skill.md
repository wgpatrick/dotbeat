# Phase 17 Stream N — a Claude Code skill for dotbeat (D14)

Executes `docs/decisions.md` D14 (BYO-Claude-Code as the agent surface; invest in a skill, not an
embedded chat panel) per `docs/phase-17-plan.md` Stream N.

## What was built

`.claude/skills/dotbeat/` — a Claude Code project skill, auto-discovered from the repo root (no
existing `.claude/skills/` convention was present before this; confirmed by checking first). Format
follows the real Claude Code skill-authoring convention found on this machine at
`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/plugin-dev/skills/
skill-development/SKILL.md` (YAML frontmatter with `name`/`description`, third-person description
with concrete trigger phrases, imperative-form body, progressive disclosure via a lean `SKILL.md`
plus a `references/` directory for detailed content):

- **`SKILL.md`** (~1,450 words, within the recommended 1,500-2,000-word budget) — project layout,
  MCP-vs-CLI guidance (including the MCP tool gaps), the `beat set` path grammar essentials with
  the shell-quoting gotcha, the selection protocol with a concrete "highlight the hats, vary it"
  mapping, the checkpoint-is-not-automatic warning, a condensed render/metrics loop summary with
  the current environment caveat, and pointers into `references/`.
- **`references/cli-reference.md`** — the full `beat` CLI usage text (verbatim from `cli/beat.mjs`'s
  own `USAGE` constant) and the full 27-tool MCP list with the CLI↔MCP naming/coverage mapping.
- **`references/format-grammar.md`** — every `beat set` path shape, the full optional synth-param
  list, note/hit/automation grammar, the selection grammar and its axis semantics, and how to read
  `beat inspect` output.
- **`references/render-metrics-loop.md`** — the render→metrics→critique→re-render loop, the real
  worked example from `docs/sessions/2026-07-10-claude-over-mcp.md` (both rounds, exact numbers),
  the current-environment render caveat, and the cross-render-path LUFS calibration offset.
- **`references/mistakes.md`** — 8 "don't do this" items, 6 confirmed against this project's own
  history or live-verified behavior this session, 2 flagged as design properties worth stating
  explicitly rather than confirmed historical bugs.

`docs/agent-setup.md` was updated with a short cross-reference note (not rewritten) — it stays the
canonical doc for the MCP *connection* step (`beat mcp-init`, `.mcp.json`, confirming the round
trip); the new skill is the "how to use dotbeat well once connected" artifact. No contradiction
between the two: connection setup vs. usage guidance are different concerns, so both are kept.

## An unplanned but necessary detour: the worktree was stale

This worktree's branch (`worktree-agent-aec89f2f98363c29c`) was created off `deba7c1`, a commit
from *before* D14 and the Phase 17 plan existed — both landed on `main` afterward (`main` was at
`5a16ca4`). Worse, `deba7c1` and `main` turned out to be **unrelated histories** (every file
conflicted as add/add on a rebase attempt — `main` had been through a local history rewrite,
consistent with D11's LFS migration note about rewriting commit hashes). Since this worktree
branch had zero commits of its own beyond that stale base (clean working tree, nothing to lose),
it was reset (`git reset --hard main`) onto current `main` before starting any real work, so D14,
the Phase 17 plan, and the current `cli/beat.mjs`/`src/mcp/server.ts` could actually be read as
ground truth rather than an older, wrong version. Documented here rather than silently done.

## Verification approach

**Command accuracy — live, not just read.** Every command/path/flag documented was run for real
against a scratch project in this checkout, not paraphrased from memory or an older doc:

- `npm run build`, then `beat init`, `beat inspect`, `beat set` (including the bracket-path
  quoting failure mode, reproduced directly under zsh), `beat add-note`, `beat add-track`,
  `beat add-hit`, `beat diff`, `beat checkpoint`/`beat history`/`beat pin`/`beat pins`.
- `beat vary <track> feel --scope selection`: started a real daemon, set a selection via `beat
  selection --set`, confirmed `--scope selection` resolved `lanes drums.hat` into `--lanes hat` and
  produced real variant files — the literal "highlight the hats, vary it" path, end to end.
- `beat vary <track> cutoff --scope selection` (a param-group vary): confirmed it rejects with the
  documented error rather than silently misbehaving.
- The MCP surface: spawned `node cli/beat.mjs mcp` as a real subprocess and drove the actual
  JSON-RPC protocol over stdio (`initialize` → `notifications/initialized` → `tools/list` →
  `tools/call` for `beat_inspect` and `beat_set`) via a small throwaway script — **27 tools
  confirmed live**, matching what `src/mcp/server.ts` defines; confirmed `beat_vary` and
  `beat_score` are absent from the live list (not just absent from a source read); confirmed
  `beat_inspect`/`beat_set` tool-call results match CLI output byte-for-byte.
- `beat mcp-init`: ran it, read the generated `.mcp.json` back, confirmed it matches the documented
  shape.

**What could not be verified live**: `beat render` and the render/metrics/critique loop, because
this environment has neither `BEATLAB_DIR`/a BeatLab checkout nor a locally-patched
`node-web-audio-api` build — confirmed absent (`node_modules/node-web-audio-api/*.node` doesn't
exist, `$BEATLAB_DIR` is unset, no `beatlab*` directory found on the machine). This is not a gap in
verification effort; it's a real, current limitation of `beat render`/`beat render --offline` that
`docs/decisions.md` D15 already exists to fix (retarget onto dotbeat's own `ui/` engine,
`docs/phase-17-plan.md` Stream L, not part of this stream's scope). The skill documents this
limitation explicitly (`references/render-metrics-loop.md`'s "current environment caveat" section)
rather than presenting the render loop as something that "just works" here — the loop itself is
documented from the one genuine, fully-real worked transcript this project has
(`docs/sessions/2026-07-10-claude-over-mcp.md`), with exact numbers, not a fabricated example.

**Skill-invocation mechanism**: attempted the strongest possible check — calling the `Skill` tool
with `dotbeat` mid-session, immediately after creating the files. Result: `Unknown skill: dotbeat`.
This is expected, not a bug in the skill: this session's available-skills list was fixed at
conversation start (before the skill existed), and skill discovery is session-scoped, not
hot-reloaded. A fresh Claude Code session started in a dotbeat project folder after this commit
lands would pick it up via normal project-skill auto-discovery (per the skill-authoring doc's own
"Auto-Discovery" section: scans `skills/`, finds `SKILL.md`, loads metadata always). Testing that
specific claim requires a session boundary this task can't cross, so it's stated honestly as
untested rather than asserted as verified.

## Covered vs. deferred

**Covered**: project layout; the full CLI command surface and full MCP tool list (cross-checked
against each other, gaps called out explicitly); `beat set` path grammar including drum-pattern
grid sugar and its shell-quoting gotcha; `beat add-note`/`add-hit`/`add-track`; `beat diff`;
`beat inspect`; the selection protocol and `--scope selection`; the render/metrics/critique loop
(as a documented pattern plus a real worked example, with the current environment limitation
stated honestly); checkpoint/history/pin/restore and the not-automatic gotcha; 8 concrete
mistakes, sourced from this project's own history where possible.

**Deferred / explicitly out of scope**: exercising `beat render` itself end-to-end (blocked on the
Stream L engine consolidation landing, or on a BeatLab checkout being present); testing actual
skill auto-discovery in a fresh session (cannot cross a session boundary from within this task);
song/scene/clip arrangement grammar beyond a pointer (format-spec.md's v0.4 section covers it fully
and wasn't a named requirement in Stream N's brief); instrument-track soundfont-preset workflow
(`beat_add_track`'s `soundfont_sample`/`soundfont_program`, `beat inspect`'s per-track preset
listing) — mentioned in the CLI reference table but not given its own worked example.

## Test result

`npm test`: **293 / 287 pass / 0 fail / 6 skipped** — unaffected, as expected (no source under
`src/`/`cli/` was touched, only `.claude/skills/dotbeat/` and a cross-reference edit to
`docs/agent-setup.md`).
