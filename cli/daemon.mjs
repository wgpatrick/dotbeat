#!/usr/bin/env node
// beat daemon — owns a .beat file and keeps it in two-way sync with a running BeatLab GUI.
// See src/daemon/daemon.ts for the protocol and docs/phase-1-plan.md for the design.
//
// Usage:
//   node cli/daemon.mjs <project.beat | project-folder> [--port 8420]
//
// Point it at a .beat file, or at a project *folder* (the desktop-shell "open a folder" flow):
// a folder with one .beat opens it; an empty folder gets a starter project.beat created for it.
//
// Then open the BeatLab dev server with ?daw=<port> appended, e.g.
//   http://localhost:5173/musiclearning/?daw=8420
//
// Requires `npm run build` to have run first (reads compiled ../dist/src).

import { startDaemon } from '../dist/src/daemon/daemon.js'
import { resolveProjectFile, ProjectError } from '../dist/src/daemon/project.js'

// Phase 29 Stream GD (research/82, 84, 86): the daemon process has died mid-session with ZERO log
// output beyond the startup banner in at least three independent usability pilots — confirmed via
// `ps`/`curl` that the process was genuinely gone, not a network blip. The GUI's auto-reconnect
// already handles the drop gracefully; the gap was pure debuggability — whatever actually threw
// left no trace anywhere. Register these as early as possible (before any daemon setup can throw)
// so ANY uncaught error or rejected promise on this process — not just ones inside startDaemon —
// gets its message and stack logged before the process goes down. Deliberately NOT trying to
// survive the error and keep serving (a daemon that swallows an unknown exception and limps on
// with possibly-corrupt in-memory state is worse than one that dies loudly and restarts clean).
function installCrashLogging() {
  process.on('uncaughtException', (err) => {
    console.error('[beat daemon] uncaught exception — process exiting:')
    console.error(err instanceof Error ? (err.stack ?? err.message) : err)
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[beat daemon] unhandled promise rejection — process exiting:')
    console.error(reason instanceof Error ? (reason.stack ?? reason.message) : reason)
    process.exit(1)
  })
}

export async function daemonCommand(argv) {
  installCrashLogging()
  let target
  let port = 8420
  let editLog = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') port = Number(argv[++i])
    else if (argv[i] === '--edit-log') editLog = true
    else target = argv[i]
  }
  if (!target) {
    console.error('usage: beat daemon <project.beat | project-folder> [--port 8420] [--edit-log]')
    console.error('  --edit-log   append every edit (GUI/CLI/MCP) to ~/.dotbeat/edit-log.jsonl for later')
    console.error('               analysis — the research/116 "log-don\'t-train" telemetry stream. Opt-in;')
    console.error('               equivalent to setting BEAT_EDIT_LOG=1. Off unless this flag or that env is set.')
    process.exit(1)
  }
  // Opt-in edit telemetry (research/116 §4, research/128 §2.4). `beat daemon --edit-log` is the
  // convenient way to turn it on for a produce-song session without exporting an env var first;
  // it just sets the same env the telemetry module reads, so a GUI knob-drag, a CLI `beat set`,
  // and an MCP tool call all append to ~/.dotbeat/edit-log.jsonl (outside any project repo).
  if (editLog) process.env.BEAT_EDIT_LOG = '1'
  let filePath
  try {
    const resolved = resolveProjectFile(target)
    filePath = resolved.filePath
    if (resolved.created) console.log(`created starter project ${filePath}`)
  } catch (err) {
    console.error(err instanceof ProjectError ? err.message : String(err))
    process.exit(1)
  }
  const daemon = await startDaemon({ filePath, port })
  console.log(`beat daemon: ${daemon.filePath}`)
  console.log(`  http://localhost:${daemon.port}  (GET /doc, GET /events, POST /state)`)
  console.log(`  open BeatLab with ?daw=${daemon.port} to connect the GUI`)
  if (editLog) console.log(`  edit telemetry ON → ${process.env.BEAT_EDIT_LOG_FILE ?? '~/.dotbeat/edit-log.jsonl'}`)
  const shutdown = () => {
    daemon.close().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

// Runs directly (node cli/daemon.mjs ...) or via the `beat` dispatcher (cli/beat.mjs).
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  daemonCommand(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
