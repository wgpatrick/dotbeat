# Research 14 — Embedded agent chat panel via an external runtime (D5)

*2026-07-11. Deep-research pass (re-run on Opus after a Fable rate-limit killed verification).
Informs desktop milestone D5 (`docs/product-spec-desktop.md` §3). Verdict: the hybrid we
proposed is directly supported by the Claude Agent SDK; two commercial questions stay open.*

## Verdict

An in-app chat panel backed by an **external** Claude Agent SDK runtime (not a homemade LLM
loop) is well-supported and documented. The SDK gives exactly the primitives a chat panel
needs; the app feeds its own selection/state by being an MCP server. The unknowns are
commercial (auth/keys, terms), not technical.

## Verified findings (all against primary Claude Agent SDK / MCP docs)

1. **The streaming primitives are all there** *(3-0)*. `query()` returns an
   `AsyncGenerator<SDKMessage>`; **streaming-input mode** runs the agent as a long-lived process
   accepting ongoing input, partial responses, image attachments, queued/interruptible
   messages, and persistent context — the exact shape of a chat panel. (Single-message mode
   lacks interruption/queueing — use streaming mode.)
2. **Tool-call visibility for free** *(3-0)*. Iterate the message stream: a `system`/`init`
   message reports each MCP server's connection status; `assistant` messages carry
   `tool_use`/`tool_result` blocks (name + input, `mcp__`-prefixed for MCP tools);
   `forwardSubagentText` gives a nested transcript with `parent_tool_use_id`. This is how the
   panel shows "what the agent is doing" — and the natural home for the **agent-spotlight**
   idea (render which `.beat` entities a `beat_*` tool touched).
3. **Interrupt mid-run** *(3-0)*. `Query.interrupt()` (streaming mode; Claude Code v2.1.205+)
   returns `still_queued` UUIDs — a Stop button that doesn't lose queued turns.
4. **Permission gating** *(3-0)*. `canUseTool` callback (runtime fallback) + `allowedTools` /
   `disallowedTools` / `permissionMode`, changeable mid-session via `setPermissionMode()` —
   start restrictive, loosen as trust builds. This is where "audition the pending edit before
   Keep/Undo" (research 10) wires in: gate `beat_*` write tools behind an approve step.
5. **Sessions auto-persist and resume** *(3-0)*. JSONL under
   `~/.claude/projects/<cwd>/<session-id>.jsonl` capturing prompt + every tool call/result;
   resume via `resume: sessionId` or `continue: true`; `listSessions`/`getSessionMessages`/
   `forkSession` etc. Chat history survives app restarts, and **fork** is a natural fit for
   branch-per-variation (research 11).
6. **The app IS an MCP server** *(3-0)*. `createSdkMcpServer` + `tool()` (Zod schemas) runs an
   in-process MCP server passed via `mcpServers`, mixed freely with external stdio/SSE/HTTP MCP
   servers; tools namespaced `mcp__{server}__{tool}`, gated by `allowedTools`. So the desktop
   app exposes selection/state/`beat_*` ops to the agent with no separate daemon process —
   though our existing stdio `beat mcp` server also works unchanged.
7. **Target the stable API** *(3-0)*. The `unstable_v2_*` session preview surface was **removed
   in SDK 0.3.142** — build on `query()` + session options, not V2.

## Prior art (creative/DAW, community — repo-level, not independently verified)

`AbletonMCP` and `daw-mcp` validate the *architecture* but use the **inverse** of our D5 plan:
they ship an MCP server that an off-the-shelf client (Claude Desktop, Cursor, or a
locally-installed Claude Code) consumes over stdio — rather than embedding the SDK as their own
chat panel. That's exactly our **fallback tier**: "bring your own Claude Code," app registers
its `beat mcp` server in the user's client config. Cheapest to ship (works today: our MCP
server + any MCP client), no keys/billing for us to own.

## Open (unverified — commercial, not technical)

- **Auth/keys for a shipped desktop app**: user-provided API key vs OAuth/Pro-Max sign-in from a
  third-party app; what Anthropic's terms permit for embedding. **No surviving evidence** — must
  be answered before D5 ships a bundled-agent experience.
- **A first-party precedent** of a third-party desktop app embedding the Agent SDK as its own
  chat panel — none confirmed. The community DAW-MCP projects are all the inverse (BYO client).

## What this decides for D5

- **The hybrid is technically real**: an embedded two-tier surface (inline affordance + chat
  panel) whose panel is a thin client over an external Agent SDK runtime, with the app exposing
  `beat_*`/selection as MCP tools. Streaming, tool-visibility, interrupt, permission-gating, and
  resumable sessions are all first-class.
- **Sequencing**: ship the BYO-Claude-Code fallback first (it's our current MCP server + any
  client — near-zero new work, and it's what AbletonMCP/daw-mcp prove works). Layer the embedded
  SDK panel once the **auth/terms** question is answered. That answer, not the engineering, is
  the gate.
