// Sidecar entry point for the compiled `dotbeat-daemon` binary (Phase 13 Stream D).
//
// This deliberately does NOT import `cli/daemon.mjs` directly: that file ends with a top-level
// `if (... await import('node:url') ...)` guard (so it can be both `node cli/daemon.mjs ...`'d
// directly AND imported by `cli/beat.mjs`'s dispatcher without auto-running). A top-level await
// sitting alongside export statements is exactly the combination pkg's ESM->CJS transformer
// refuses to touch (see docs/phase-9-tauri-spike-plan.md's Phase 13 Stream D section for the
// full story) — and even shipped as plain source, pkg's ESM entry-module resolution couldn't
// find the multi-file, snapshot-relative `cli/daemon.mjs` at runtime.
//
// The fix: bundle a *single* self-contained CJS file (via esbuild, see desktop/sidecar/build.mjs)
// whose entry has no top-level await and no export statements, importing only the compiled
// `dist/src/daemon/*.js` (plain tsc output, verified free of top-level await / import.meta) —
// the same two functions `cli/daemon.mjs`'s `daemonCommand` itself calls. Argv parsing is
// duplicated (intentionally small and stable) rather than reaching into `cli/daemon.mjs`, per
// this stream's file-ownership boundary (desktop/ only, no touching cli/).
//
// Usage: dotbeat-daemon <project.beat | project-folder> [--port 8420]

import { startDaemon } from '../../dist/src/daemon/daemon.js'
import { resolveProjectFile, ProjectError } from '../../dist/src/daemon/project.js'

function main(argv) {
  let target
  let port = 8420
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') port = Number(argv[++i])
    else target = argv[i]
  }
  if (!target) {
    console.error('usage: dotbeat-daemon <project.beat | project-folder> [--port 8420]')
    process.exit(1)
  }
  let filePath
  try {
    const resolved = resolveProjectFile(target)
    filePath = resolved.filePath
    if (resolved.created) console.log(`created starter project ${filePath}`)
  } catch (err) {
    console.error(err instanceof ProjectError ? err.message : String(err))
    process.exit(1)
  }
  return startDaemon({ filePath, port }).then((daemon) => {
    console.log(`beat daemon: ${daemon.filePath}`)
    console.log(`  http://localhost:${daemon.port}  (GET /document, POST /edit, GET/POST /selection, GET /events, POST /state)`)
    const shutdown = () => {
      daemon.close().then(() => process.exit(0))
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  })
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
