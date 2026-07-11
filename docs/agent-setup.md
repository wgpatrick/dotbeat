# Agent setup — Claude Code (or any MCP client) over `beat mcp`

*Phase 10 Stream C (`docs/phase-10-plan.md`), closing product-spec-desktop.md §6's D5: "Ship the
BYO-Claude-Code fallback first (our MCP server + any client — near-zero new work)."
`beat mcp` has run a full stdio JSON-RPC MCP server since Phase 3
(`docs/sessions/2026-07-10-claude-over-mcp.md`); the only thing that was missing was the
zero-setup path from "I have a `.beat` project folder" to "Claude Code is talking to it" — this
doc plus `beat mcp-init` is that path.*

> **Phase 17 Stream N (D14)**: this doc covers the zero-setup MCP *connection* step (`beat
> mcp-init`, `.mcp.json`, confirming the round trip) and stays the canonical doc for that. Once
> connected, `.claude/skills/dotbeat/SKILL.md` is the actual Claude Code skill artifact that teaches
> an agent how to *use* dotbeat well from there — project layout, the full CLI/MCP command surface,
> the `.beat` path grammar, the selection protocol, the render/metrics/critique loop, checkpoint
> discipline, and common mistakes. It auto-loads when working in a dotbeat project; this doc doesn't
> supersede it, the two are complementary (connection setup vs. how-to-use-it-well). If reading this
> by hand rather than via Claude Code's skill auto-discovery, read the skill directory too.

## What `beat mcp` actually is

`node cli/beat.mjs mcp` starts a newline-delimited JSON-RPC 2.0 server on stdin/stdout —
`initialize`, `tools/list`, `tools/call`, one process per client, no network port. It exposes
every `beat` CLI operation (`beat_init`, `beat_inspect`, `beat_set`, `beat_add_note`,
`beat_render`, `beat_metrics`, `beat_checkpoint`, …) as an MCP tool. Each tool call takes its own
`file` argument — the server isn't bound to one project at startup, so a single running server
can work across any `.beat` file the client passes it (see `src/mcp/server.ts`).

Any MCP client that can spawn a subprocess and speak stdio JSON-RPC works, but this doc uses
Claude Code as the concrete example since it auto-discovers a project-local `.mcp.json`.

## 1. Open a project folder

Any folder with a `.beat` file in it. If you don't have one yet:

```bash
node <path-to-dotbeat-repo>/cli/beat.mjs init song.beat --bpm 120
```

## 2. Run the init command

From inside that project folder:

```bash
node <path-to-dotbeat-repo>/cli/beat.mjs mcp-init song.beat
```

This writes a `.mcp.json` next to `song.beat` (pass `--force` to overwrite one that already
exists):

```json
{
  "mcpServers": {
    "beat": {
      "command": "node",
      "args": ["<absolute-path-to-dotbeat-repo>/cli/beat.mjs", "mcp"]
    }
  }
}
```

The `args` path is resolved to this repo checkout's own `cli/beat.mjs`, absolute, so the config
works regardless of where the project folder lives. (`beat mcp` reads compiled output under
`dist/`, so run `npm run build` in the dotbeat checkout at least once first — the same
prerequisite the CLI already has for every other command.)

## 3. Open Claude Code there

```bash
cd /path/to/your/project   # the folder with song.beat and .mcp.json
claude
```

Claude Code reads `.mcp.json` in the current directory on startup and launches the `beat` server
automatically — no flags, no manual `claude mcp add`.

## 4. Confirm a tool call round-trips

Ask Claude something like *"inspect song.beat"* or *"what tracks does song.beat have?"*. Under
the hood this is Claude calling the `beat_inspect` tool with `{"file": "song.beat"}` and getting
back the same text `beat inspect song.beat` would print on the command line. If Claude can
describe your project's tracks/bpm/loop length back to you, the round trip works.

## Verified end to end (Phase 10 Stream C)

Rather than trust the wiring, the actual protocol was driven the way Phase 3's session did (not
a mock): a fresh temp project was created, `beat mcp-init` generated its `.mcp.json`, and a
client script spawned the exact `command`/`args` pair from that generated file and drove real
`initialize` → `tools/list` → `tools/call` requests over stdio.

```
>> {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify-client","version":"0"}}}
<< {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"beat","version":"0.3.0"}}}
>> {"jsonrpc":"2.0","method":"notifications/initialized"}
>> {"jsonrpc":"2.0","id":2,"method":"tools/list"}
<< (27 tools, including "beat_inspect")
>> {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"beat_inspect","arguments":{"file":"song.beat"}}}
<< {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"format 0.9 | 120 bpm | 2 bars (32 steps) | selected: lead\ntracks: 1\n\nlead  \"lead\"  synth  #e06c75\n  synth: sawtooth, -10 dB, cutoff 2000 Hz, res 0.8, ADSR 0.01/0.2/0.6/0.3, pan 0\n  notes: none\n"}]}}
```

The response text is byte-identical to what `beat inspect song.beat` prints on the command line —
the MCP path and the CLI path are the same code, confirmed live, not by inspection.

## Troubleshooting

- **"unknown command" / module not found**: run `npm run build` in the dotbeat checkout — `beat
  mcp` (and every other CLI command) reads compiled output under `dist/`, not the TypeScript
  source directly.
- **`.mcp.json` already exists**: `beat mcp-init` refuses to overwrite by default; pass
  `--force` if you want to regenerate it (e.g. after moving the dotbeat checkout).
- **Claude Code doesn't see the tools**: confirm you launched `claude` from the same directory
  `.mcp.json` was written into — MCP config discovery is directory-scoped.
