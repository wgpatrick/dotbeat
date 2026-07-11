#!/usr/bin/env node
// Compiles the beat daemon (cli/daemon.mjs's public surface, via desktop/sidecar/daemon-entry.mjs)
// into a real per-target-triple binary under desktop/src-tauri/binaries/, per research 13 finding
// 4 (`bundle.externalBin` + `Command.sidecar()`) and the Phase 13 Stream D writeup in
// docs/phase-9-tauri-spike-plan.md.
//
// Two-stage build, both stages empirically required (see the plan doc for the full story of why):
//   1. esbuild bundles desktop/sidecar/daemon-entry.mjs + its whole `dist/src/**` dependency
//      closure into a single CJS file. Required because (a) pkg's ESM->CJS transformer refuses
//      to touch a module that combines a top-level await with export statements — the shape
//      cli/daemon.mjs's own self-invocation guard has — and (b) even shipped as source, pkg's
//      *entry-module* ESM resolution couldn't find a multi-file, snapshot-relative `.mjs` graph
//      at runtime. A single self-contained CJS file sidesteps both problems.
//   2. @yao-pkg/pkg compiles that single CJS file into a standalone binary with Node embedded —
//      verified to run with `node`/`npx` fully absent from PATH.
//
// Usage: node desktop/sidecar/build.mjs [--triple <rust-target-triple>]
// Defaults to the build host's own triple (via `rustc -vV`) — cross-compiling to other triples
// works too (pkg targets below cover the common desktop triples) but was not exercised this
// stream; the Mac build (aarch64-apple-darwin) is what was actually built and verified.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, chmodSync, copyFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const desktopDir = join(here, '..')
const repoRoot = join(desktopDir, '..')
const binariesDir = join(desktopDir, 'src-tauri', 'binaries')
const pkgBin = join(desktopDir, 'node_modules', '.bin', 'pkg')
const esbuildBin = join(desktopDir, 'node_modules', '.bin', 'esbuild')

// Maps a Rust target triple (what Tauri names externalBin binaries after, and what `rustc -vV`
// reports as `host:`) to the pkg/yao-pkg target string (`node<major>-<os>-<arch>`) needed to fetch
// the matching prebuilt Node base binary. Only the triples this stream could plausibly build/test
// are filled in; add more here if a future stream cross-compiles for Windows/Linux.
const TRIPLE_TO_PKG_TARGET = {
  'aarch64-apple-darwin': 'node22-macos-arm64',
  'x86_64-apple-darwin': 'node22-macos-x64',
  'aarch64-unknown-linux-gnu': 'node22-linux-arm64',
  'x86_64-unknown-linux-gnu': 'node22-linux-x64',
  'x86_64-pc-windows-msvc': 'node22-win-x64',
}

function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
  const m = out.match(/^host:\s*(\S+)/m)
  if (!m) throw new Error('could not determine host triple from `rustc -vV`')
  return m[1]
}

function main() {
  const argTriple = process.argv.includes('--triple')
    ? process.argv[process.argv.indexOf('--triple') + 1]
    : null
  const triple = argTriple ?? hostTriple()
  const pkgTarget = TRIPLE_TO_PKG_TARGET[triple]
  if (!pkgTarget) {
    console.error(`no pkg target mapping for triple ${triple} — add one to TRIPLE_TO_PKG_TARGET`)
    process.exit(1)
  }
  console.log(`[sidecar build] triple=${triple} pkgTarget=${pkgTarget}`)

  // 1. Make sure dist/ is fresh (the daemon-entry imports compiled dist/src/daemon/*.js directly).
  console.log('[sidecar build] npm run build (repo root, compiles src/ -> dist/)')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })

  // 2. Bundle to a single self-contained CJS file.
  const bundleOut = join(desktopDir, 'sidecar', '.build', 'daemon-bundle.cjs')
  mkdirSync(dirname(bundleOut), { recursive: true })
  console.log('[sidecar build] esbuild bundle -> ' + bundleOut)
  execFileSync(
    esbuildBin,
    [
      join(here, 'daemon-entry.mjs'),
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--target=node20',
      `--outfile=${bundleOut}`,
    ],
    { stdio: 'inherit' },
  )

  // 3. pkg the bundle into a real binary, named per Tauri's externalBin convention:
  // `binaries/<name>-<target-triple>[.exe]`.
  mkdirSync(binariesDir, { recursive: true })
  const exeSuffix = triple.includes('windows') ? '.exe' : ''
  const finalName = `dotbeat-daemon-${triple}${exeSuffix}`
  const finalPath = join(binariesDir, finalName)
  console.log(`[sidecar build] pkg -> ${finalPath}`)
  execFileSync(
    pkgBin,
    [bundleOut, '--targets', pkgTarget, '--output', finalPath],
    { stdio: 'inherit' },
  )
  chmodSync(finalPath, 0o755)
  rmSync(dirname(bundleOut), { recursive: true, force: true })
  console.log(`[sidecar build] done: ${finalPath}`)
}

main()
