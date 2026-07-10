#!/usr/bin/env node
// beat daemon — owns a .beat file and keeps it in two-way sync with a running BeatLab GUI.
// See src/daemon/daemon.ts for the protocol and docs/phase-1-plan.md for the design.
//
// Usage:
//   node cli/daemon.mjs <project.beat> [--port 8420]
//
// Then open the BeatLab dev server with ?daw=<port> appended, e.g.
//   http://localhost:5173/musiclearning/?daw=8420
//
// Requires `npm run build` to have run first (reads compiled ../dist/src).

import { startDaemon } from '../dist/src/daemon/daemon.js'

export async function daemonCommand(argv) {
  let filePath
  let port = 8420
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') port = Number(argv[++i])
    else filePath = argv[i]
  }
  if (!filePath) {
    console.error('usage: beat daemon <project.beat> [--port 8420]')
    process.exit(1)
  }
  const daemon = await startDaemon({ filePath, port })
  console.log(`beat daemon: ${daemon.filePath}`)
  console.log(`  http://localhost:${daemon.port}  (GET /doc, GET /events, POST /state)`)
  console.log(`  open BeatLab with ?daw=${daemon.port} to connect the GUI`)
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
