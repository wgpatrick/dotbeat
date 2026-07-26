// Every `dist/...` path the .mjs CLI layer imports must actually exist after a build.
//
// WHY THIS EXISTS (2026-07-26). `cli/ab.mjs` imported `dist/src/taste/features.js`. That module had
// been MOVED to `dist/src/metrics/features.js` by the D8 import-boundary work, and `beat ab` — the
// owner-feedback UI — was dead on every server invocation with ERR_MODULE_NOT_FOUND.
//
// It survived review, a full green suite, and real owner use, because of a second bug behind it:
// `npm run build` ran `tsc` over a dist/ it never cleaned, so the compiled artifact of the DELETED
// source file sat there and kept resolving. The build is now `rm -rf dist && tsc`, which is what
// makes this test able to fail at all.
//
// The suite could not catch it because the CLI's dist imports are dynamic `await import(...)` of a
// STRING — invisible to tsc, invisible to any test that doesn't spawn the real command. Every
// `beat <cmd>` smoke test in cli-surface.test.ts passes `--help`, which returns before the import.
// So this scans the strings themselves: cheap, total, and it fails on the rename rather than on the
// day someone happens to run the affected subcommand.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const cliDir = join(repoRoot, 'cli')

/** Every literal `dist/...` module path imported from the .mjs CLI layer, with its source site. */
function distImports(): { file: string; path: string }[] {
  const out: { file: string; path: string }[] = []
  for (const file of readdirSync(cliDir).filter((f) => f.endsWith('.mjs'))) {
    const src = readFileSync(join(cliDir, file), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
    for (const m of src.matchAll(/['"`](\.\.\/)?(dist\/[A-Za-z0-9_./-]+\.js)['"`]/g)) {
      out.push({ file, path: m[2]! })
    }
  }
  return out
}

test('every dist/ module the CLI imports exists after a build', () => {
  const sites = distImports()
  assert.ok(sites.length > 20, `expected the CLI to import many dist modules, found ${sites.length} — the scanner is probably broken`)

  const missing = sites
    .filter((s) => !existsSync(join(repoRoot, s.path)))
    .map((s) => `${s.file} imports ${s.path}`)
    .sort()

  assert.deepEqual(
    [...new Set(missing)],
    [],
    'a CLI subcommand imports a dist module that does not exist — it will die with ERR_MODULE_NOT_FOUND ' +
      'the moment anyone runs it. These imports are dynamic string paths, so tsc cannot see them and ' +
      'a --help smoke test returns before reaching them. Fix the path, or the move that orphaned it.',
  )
})

test('the build cleans dist, so a deleted module cannot keep resolving', () => {
  // The guard above is only meaningful if a stale artifact cannot survive a rebuild. If this ever
  // regresses to a non-cleaning build, the guard silently becomes a no-op — which is exactly how
  // the original bug hid for as long as it did.
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  assert.match(
    pkg.scripts.build ?? '',
    /rm -rf dist/,
    'npm run build must remove dist/ before compiling. Without it, the compiled output of a DELETED ' +
      'source file keeps resolving locally and the whole suite goes green against code that no longer ' +
      'exists — while a fresh clone or CI fails.',
  )
})
