# Usability testing: exploratory pilots

A second, complementary testing methodology alongside `ui/verify-*.mjs`. Both drive the real running
app with Playwright — the difference is what they're allowed to assume.

**Verify scripts** assert known-correct DOM state. They're written by someone who already knows the
right answer, so they're excellent at proving "this specific behavior still works" and catching
regressions, but structurally cannot catch a bug in the app's own idea of what "correct" looks like
— if the click-math itself is wrong, a verify script written against that same click-math will
happily assert the wrong answer forever.

**Usability pilots** don't get a checklist. An agent is given a realistic end-user GOAL, drives the
real app, and has to figure out for itself whether what happened matches what a reasonable user
would expect — the way a human usability tester thinks aloud through a session. This is what found
the click-to-add off-by-one bug in `NoteView.tsx` (`docs/research/80`), the clip editor getting
stuck on a song's first scene (`docs/research/84`), and the macro-knob display desync after a preset
swap (`docs/research/86`) — three real, high-impact bugs that thirty-some existing verify scripts,
written by people who already believed the click math / scene targeting / macro display were
correct, could never have surfaced.

Pilots run 80-86 (`docs/research/`) are the reference implementations of everything below. Read one
or two before running a new pilot — they show what "actually reading every screenshot" produces in
practice, not just what the rule says.

## When to run one

Run a pilot as part of wrapping up any phase or stream that changes GUI-facing behavior — the same
way a roadmap/README refresh is now a standing habit at phase completion, a usability pilot targeting
the area that just shipped should be too. Don't wait to be asked. A pilot doesn't need to be
elaborate: one focused session against the specific feature area that changed is enough; save the
full multi-pilot batches (5+ sessions) for periodic broader sweeps, not every small stream.

**The same trigger applies to the CLI and MCP surfaces** (see the variant section below) — whenever
a phase adds or changes a `beat` subcommand or an MCP tool, run one against it. These pilots are
much cheaper than GUI ones (the first, research/94, took ~4 minutes and 26 tool calls versus a GUI
pilot's 15-50+ minutes) since there's no screenshot-and-read loop or browser to drive — cheap enough
that skipping one is a real gap, not a reasonable cost tradeoff.

Also good triggers: after fixing a batch of pilot-found bugs (re-verify the fix landed the way a
real user would experience it, not just that the specific repro steps from the report now pass),
and whenever a feature area hasn't had a pilot pointed at it yet (check `docs/research/` for
coverage gaps before assuming something's been tested this way).

## The rules

1. **No pre-scripted checklist.** Give the agent a realistic goal, not a list of clicks. If you
   already know the exact sequence of UI interactions that should happen, write a verify script
   instead — that's the right tool for known-behavior assertions.
2. **Screenshot after every meaningful action, and actually look at it before deciding what's
   next.** This is the entire method. An agent that chains actions without reading the intermediate
   screenshots is just running an unscripted verify script blind — it'll miss exactly the class of
   bug (silent no-op, view drift, misleading copy) this methodology exists to catch. Multimodal
   reading is not optional instrumentation here; it's the mechanism.
3. **Keep a running narrative log as you go**, think-aloud style — expectation vs. reality, what
   was confusing, what worked well — written turn by turn, not reconstructed from memory afterward.
   A reconstructed narrative smooths over exactly the moments (the misclick, the "wait, did the view
   just move?") that are the actual findings.
4. **Try at least one non-obvious interaction if it fits naturally** (right-click, a keyboard
   shortcut, a drag gesture) — don't force it into a workflow it doesn't belong in, but a pilot that
   only ever does the single obvious happy-path action per screen will under-report.
5. **When something breaks or confuses, don't paper over it.** Stop, note it clearly, then try a
   real-user workaround rather than silently abandoning the stated goal. "Where I gave up on the
   ideal workflow" is itself a finding, not a failure of the pilot.
6. **Ground truth is the `.beat` file and the daemon's live document, not the screen.** Screenshots
   show what the UI claims happened; `beat inspect` / `GET /doc` show what actually persisted. Several
   of the highest-value findings (grid-click off-by-one, the rapid-edit data-loss bug, the audio
   loop-field no-op) were only caught by diffing intent against the file, not by eyeballing the UI.

## Setup conventions

- **Fixture discipline.** Never touch `examples/night-shift-song.beat` — the owner's own live
  project, liable to be open in his running dev GUI. Use `beat init` for a fresh project, or copy
  `examples/night-shift.beat` (no `-song-`) to a disposable path first if an existing multi-track
  project is needed. Always work in a scratch directory under `/tmp/dotbeat-usability-<name>/`,
  deleted at the end of the session.
- **Dedicated ports per pilot.** Each concurrent pilot needs its own daemon port and Vite dev-server
  port pair so parallel sessions don't collide. Pick a fresh, clearly-separated block each batch
  (e.g. 9101-9110 for one round, 9401-9410 for the next) rather than reusing recent numbers — stale
  zombie processes from earlier sessions are a real, recurring source of false failures.
  ```
  node cli/beat.mjs init /tmp/dotbeat-usability-<name>/song.beat --bpm <n>
  node cli/beat.mjs daemon /tmp/dotbeat-usability-<name>/song.beat --port <daemon-port>
  cd ui && npm run dev -- --port <vite-port> --strictPort
  ```
  Open the app at `http://localhost:<vite-port>/?daw=<daemon-port>` — the `daw` query param wires
  the GUI to the daemon (`ui/src/daemon/bridge.ts`'s `daemonBase()`).
- **Real browser, real viewport.** Use Playwright against a persistent/CDP-connected Chrome instance
  at a normal desktop viewport (around 1440×900) so screenshots look like what a human would
  actually see, not a headless default.

## Report format

One file per pilot, `docs/research/NN-usability-pilot-<name>.md`, next sequential number. Structure:

- **Intro** — the realistic goal, one short paragraph.
- **Narrative walkthrough** — the think-aloud log, condensed but keeping the honest reactions, not
  reduced to "did X, did Y."
- **Findings summary** — bulleted, each tagged `[bug]`, `[confusing]`, `[slow-to-discover]`, or
  `[worked well]`, roughly ordered by real-user impact, most important first. Specific enough to
  act on: file/component names where inferable, exact repro steps for bugs.
- **Where the pilot gave up on the "ideal" workflow**, if anywhere — the workarounds found, and
  what that implies about GUI-only reachability of a feature.

## Cleanup discipline

Before finishing: kill the daemon and Vite processes, delete the scratch directory, and run
`git status` in the repo root to confirm the only change is the new report file. Stray artifacts
have leaked into the tracked repo before this way — a `.sf2` sample auto-collected into `examples/`
by a daemon's content-browser logic, debug screenshots committed despite instructions not to. Catch
these before they land, not after.

## Variant: CLI/MCP pilots (no GUI at all)

Every pilot through `docs/research/93` drove the GUI via Playwright. dotbeat's actual thesis is that
the CLI, the GUI, and an AI agent all edit the same file — so a pilot that never opens the GUI and
instead accomplishes a realistic task purely through the `beat` CLI, or purely through the MCP tool
surface (`beat mcp`), is testing something the GUI pilots structurally cannot: whether the
non-visual surfaces are actually usable by someone (or something) with no prior knowledge of
dotbeat's internals beyond what the CLI's own `--help` output or the MCP tools' own descriptions
expose.

The same six rules above still apply, translated:

- **No pre-scripted checklist** — discover the actual command/tool set as you go (`beat` with no
  args, `beat <cmd> --help`, or an MCP `tools/list` call), the way a real first-time user or a fresh
  AI agent integration would, not by reading `cli/beat.mjs`'s source first.
- **"Screenshot after every action, read it before the next" becomes "read every command's actual
  output/response before deciding the next command."** A CLI/MCP pilot that chains commands based on
  assumed success is exactly as blind as a GUI pilot that chains clicks without reading screenshots
  — the failure mode is the same, just the medium differs.
- **Ground truth discipline still applies, arguably more directly**: there's no "screen" to be fooled
  by here, but there IS a real risk of a command reporting success while not doing what its name/
  description implied, or an MCP tool's description misleading an agent into a wrong call. Always
  check `beat inspect` / the raw `.beat` file / `GET /document` against what a command claimed to do.
- **Try at least one non-obvious path** — an intentionally malformed command, an ambiguous MCP tool
  call, a command run in the wrong order — the way a real user or agent genuinely would stumble.

**For an MCP pilot specifically**: there's no ready-made MCP client tool to hand a dispatched agent,
so the pilot needs to speak the protocol itself — spawn `beat mcp` as a subprocess and write a small
script (Node.js is simplest, matching the rest of this codebase) that sends JSON-RPC requests over
stdio (`initialize`, `tools/list`, `tools/call`) and reads the responses, the same way a real MCP
client integration would. This mirrors the precedent of pilots writing their own small Playwright
driver scripts when no ready-made browser tool was available — same idea, different protocol.
Evaluate the tool descriptions/schemas as if encountering them cold: would a fresh agent, given only
the `tools/list` output, guess the correct usage without trial and error?

**Fixture/port discipline is unchanged** — disposable scratch projects, never
`examples/night-shift-song.beat`. Ports still matter for the daemon if a CLI/MCP pilot needs one
running (some CLI commands talk to a live daemon, e.g. `beat selection`), but there's no Vite dev
server involved at all for a pure CLI/MCP session.

**Report format is the same** (`docs/research/NN-usability-pilot-<name>.md`, same findings tags),
with one addition: call out explicitly whether a finding is CLI-specific, MCP-specific, or a gap in
the underlying `src/core`/`src/daemon` capability itself (which would also affect the GUI) — these
have different fixes and shouldn't get conflated.
