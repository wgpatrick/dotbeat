#!/usr/bin/env node
// Bundle BeatLab's REAL engine + store for headless Node use — docs/phase-4-plan.md §4.1.
//
// The openDAW lesson (docs/opendaw-notes.md §3): headless is the real engine plus a small shim,
// never a re-implementation. This script reads beatlab's sources as-is (writes nothing into the
// beatlab checkout) and emits one ESM bundle with:
//   - `tone` external: the runner and the bundle MUST share one Tone module instance, because
//     Tone.setContext() state is module-global — the runner points it at an OfflineContext.
//   - import.meta.env.DEV defined to false: strips the vite-isms (window.__store exposure etc.).
//   - everything else (zustand, lessons, analysis) bundled in.
//
// Usage: node scripts/build-headless-engine.mjs --beatlab-dir /path/to/beatlab [-o dist-headless/engine.mjs]

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

export function buildHeadlessEngine({ beatlabDir, outFile = join(repoRoot, 'dist-headless', 'engine.mjs') }) {
  if (!beatlabDir) throw new Error('need a beatlab checkout: pass --beatlab-dir or set BEATLAB_DIR')
  const abs = resolve(beatlabDir)
  mkdirSync(dirname(outFile), { recursive: true })

  // A tiny entry that re-exports exactly what the offline runner needs, from the real sources.
  const entryPath = join(dirname(outFile), 'headless-entry.ts')
  writeFileSync(
    entryPath,
    [
      `export { useStore } from '${join(abs, 'src/state/store').replace(/\\/g, '/')}'`,
      `export { engine } from '${join(abs, 'src/audio/engine').replace(/\\/g, '/')}'`,
      `export { DEFAULT_SYNTH } from '${join(abs, 'src/types').replace(/\\/g, '/')}'`,
      `export { audioBufferToWav } from '${join(abs, 'src/audio/wavEncode').replace(/\\/g, '/')}'`,
      '',
    ].join('\n'),
  )

  // beatlab ships esbuild (via vite) — use its binary rather than adding a dependency here.
  const esbuild = join(abs, 'node_modules', '.bin', 'esbuild')
  execFileSync(
    esbuild,
    [
      entryPath,
      '--bundle',
      '--format=esm',
      '--platform=node',
      '--external:tone',
      '--define:import.meta.env.DEV=false',
      `--outfile=${outFile}`,
      '--log-level=warning',
    ],
    { stdio: 'inherit' },
  )
  rmSync(entryPath)
  return outFile
}

// direct invocation
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  let beatlabDir = process.env.BEATLAB_DIR
  let outFile
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--beatlab-dir') beatlabDir = argv[++i]
    else if (argv[i] === '-o') outFile = argv[++i]
  }
  try {
    const out = buildHeadlessEngine({ beatlabDir, ...(outFile ? { outFile } : {}) })
    console.log(`built ${out}`)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}
