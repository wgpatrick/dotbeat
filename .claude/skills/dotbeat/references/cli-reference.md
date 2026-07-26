# dotbeat CLI + MCP command surface

Re-verified 2026-07-25 against the live surfaces: 87 CLI commands from `cli/beat.mjs`'s `HELP`
array (1:1 with its dispatch switch), and 71 MCP tools from a real `tools/list` call over stdio.

> **This file deliberately does not reproduce the usage text.** It used to embed a verbatim
> snapshot of `USAGE`, and that snapshot went stale badly — by 2026-07-25 it listed ~30 of the 87
> commands, still advertised `beat render --beatlab-dir` (removed by D15), and claimed
> `beat vary`/`beat score`/`beat sample`/`beat lane` had no MCP tool when all four do. **The CLI's
> own help is the only authoritative source.** Run it; it is instant and always current.

```bash
node cli/beat.mjs help              # all 87 commands, grouped, with every flag
node cli/beat.mjs help <command>    # one command's block (also: beat <command> --help)
```

All commands: `node <dotbeat-repo>/cli/beat.mjs <command> ...` (or `beat ...` if on PATH).
Requires `npm run build` in the dotbeat checkout first — the CLI reads compiled `dist/`.

`beat diff` exit codes follow `diff(1)`: 0 = no musical changes, 1 = changes, 2 = error. `beat lint`
exits 1 if any finding is `warn` level, else 0 — usable in a script/loop.

## What is on MCP and what is CLI-only

71 tools, confirmed live 2026-07-25. Almost every *document-editing* verb has a twin; the
**orchestration and eval verbs do not**.

**CLI-only** (shell out even inside an MCP session): `audition`, `board`, `daemon`, `excerpt`,
`gen-kit`, `match`, `mcp`, `mcp-init`, `open`, `pilot`, `prodtask`, `rate`, `showdown`, `surge`,
`taste-collect`, `taste-eval`, `taste-seeds`, `trick`.

Everything else has a tool. Name mapping is `beat <verb>` → `beat_<verb_with_underscores>`, with
five deliberate exceptions to know about:

- `beat analyze` (audio) → **`beat_analyze_audio`**; `beat analyze-structure` (symbolic) →
  `beat_analyze_structure`. Two different operations, easy to confuse.
- `beat clip` / `beat scene` / `beat song` → one **`beat_song`** call taking optional `clips`,
  `scenes`, `song` arguments applied in that order. There is no `beat_clip`.
- `beat macro` → **`beat_macro_list`** + **`beat_macro_apply`** (the CLI's two subcommands split
  into two tools).
- `beat source` → **`beat_source_search`** / **`beat_source_add`** / **`beat_source_gen`**.
- `beat drum-kits` / `beat drum-kit` → `beat_drum_kits` / `beat_drum_kit`.

Argument-shape notes (verified by reading each `inputSchema` in `src/mcp/server.ts`):

- `beat_set` takes `{ file, edits: [{path, value}, ...] }` — same batch-edit semantics as the CLI's
  `beat set file p1 v1 p2 v2`, structured as an array instead of alternating positionals.
- `beat_render` takes `{ file, out, tail_seconds }`. It has **no** `offline` or `beatlab_dir`
  parameter — D15 removed the BeatLab dependency and D22 made `--offline` a CLI-side choice. See
  `references/render-metrics-loop.md`.
- `beat_humanize`/`beat_quantize`/`beat_vary` use snake_case argument names (`push_late`,
  `note_ids`, `out_dir`) where the CLI flag is kebab-case (`--push-late`, `--notes`, `--out-dir`) —
  same semantics, different naming convention per surface.
- `beat_checkpoint`'s description explicitly recommends passing the user's own request as `intent`
  — the MCP-native equivalent of `--intent`, and it matters more here than on the CLI since an
  agent decides when to call it (see the main SKILL.md "checkpoints are NOT automatic" section).
- **Parity across CLI and MCP is maintained by hand, not by structure** (research/130 T1), and
  measured drifts exist. When a result surprises you on one surface, check the other before
  concluding it is a musical problem.

## Verification method (for anyone re-checking this doc later)

```bash
npm run build
node cli/beat.mjs help | grep -c '^  beat '   # command blocks in the help dump
node cli/beat.mjs help <command>              # one command, to confirm a flag exists
```

For the MCP list, spawn `node cli/beat.mjs mcp` and write newline-delimited JSON-RPC 2.0 to its
stdin — `initialize`, then `{"jsonrpc":"2.0","id":2,"method":"tools/list"}` — and read the
`result.tools` array back from stdout:

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"x","version":"1"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node cli/beat.mjs mcp
```

Prefer re-running these two commands over trusting any list written down here or elsewhere.
