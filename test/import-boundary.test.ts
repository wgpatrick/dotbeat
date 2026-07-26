// D8 / research/136 §4 — "the DAW may not import the taste program", made a test instead of a
// convention. 136 called this "the highest leverage-per-risk item in this review" and it stayed
// unenforced through four live violations, so the enforcement is the point, not the four fixes.
//
// The rule, verbatim from 136: the DAW — `src/{core,metrics,analysis,vary,daemon,mcp}` and `ui/` —
// never imports `src/taste`. The taste program is a CONSUMER of the DAW (it renders projects,
// measures them, and ranks them); the DAW must not know it exists. Without that direction the
// module graph is cyclic, `beat set` transitively pulls in the ranker, and "delete the taste
// program" stops being a thing anyone can evaluate.
//
// Shape borrowed from test/verify-manifest.test.ts: read the SOURCE text, not the compiled graph.
// A source-text scan is what makes this cheap enough to be exhaustive, and it catches the
// `await import('../dist/src/taste/…')` dynamic form that a type-level check would miss.
//
// Deliberately NOT covered: `cli/` (the CLI is the taste program's own front door — `beat taste`,
// `beat showdown`, `beat rate` all live there by design) and `src/board` (the decision board reads
// scored batches; it is taste-adjacent tooling, not the DAW).

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root

/** The DAW side of the boundary, 136 §4's own list. */
const DAW_DIRS = [
  join('src', 'core'),
  join('src', 'metrics'),
  join('src', 'analysis'),
  join('src', 'vary'),
  join('src', 'daemon'),
  join('src', 'mcp'),
  join('ui', 'src'),
]

/**
 * The ONE known type-only violation, tracked as an exact-match ratchet rather than waved through.
 *
 * `src/analysis/surge.ts` imports `SurgePatch`/`SurgeNote` as TYPES from `src/taste/showdown.ts`.
 * They describe the Surge patch/note format, which is DAW vocabulary — their natural home is
 * `src/analysis/surge.ts` itself, with showdown importing them back. That move edits
 * `src/taste/showdown.ts`, which was owned by a concurrent stream when this test was written
 * (2026-07-26), so the one-line follow-up is: move the two interfaces into `src/analysis/surge.ts`,
 * re-point showdown's import, and delete this list.
 *
 * The list is asserted EXACTLY equal, not as an upper bound: fixing the violation without deleting
 * the entry fails too, so the ratchet cannot quietly become a permanent allowlist.
 */
const KNOWN_TYPE_ONLY_VIOLATIONS = [join('src', 'analysis', 'surge.ts')]

interface Violation {
  file: string
  line: number
  spec: string
  typeOnly: boolean
  text: string
}

function sourceFiles(dir: string): string[] {
  const abs = join(repoRoot, dir)
  let entries: string[]
  try {
    entries = readdirSync(abs)
  } catch {
    throw new Error(`import-boundary: ${dir} does not exist under ${repoRoot} — the DAW_DIRS list is stale, fix it rather than dropping the directory`)
  }
  const out: string[] = []
  for (const name of entries) {
    const full = join(abs, name)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(join(dir, name)))
    } else if (/\.(ts|tsx|mjs|js)$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

/** Every static/dynamic/re-export specifier on a line, with its `import type` flag. Comment lines
 * are skipped: this file's own siblings cite `src/taste/*` in prose constantly, and a rule that
 * fires on documentation trains people to stop writing it. */
function scanFile(abs: string): Violation[] {
  const rel = relative(repoRoot, abs)
  const out: Violation[] = []
  const lines = readFileSync(abs, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!
    const text = raw.trim()
    if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) continue
    // `from '…'`, `import('…')`, `require('…')` — every module-specifier form in this repo.
    const specs = [...raw.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!)
    for (const spec of specs) {
      if (!/(^|\/)taste\//.test(spec)) continue
      out.push({
        file: rel,
        line: i + 1,
        spec,
        typeOnly: /^(import|export)\s+type\b/.test(text),
        text,
      })
    }
  }
  return out
}

function allViolations(): Violation[] {
  return DAW_DIRS.flatMap((d) => sourceFiles(d)).flatMap(scanFile)
}

test('the DAW may not import the taste program (research/136 §4) — zero RUNTIME imports', () => {
  const runtime = allViolations().filter((v) => !v.typeOnly)
  assert.deepEqual(
    runtime.map((v) => `${v.file}:${v.line} -> ${v.spec}`),
    [],
    'a DAW module imports src/taste at runtime. The taste program consumes the DAW, never the other ' +
      'way round: move the shared thing DAW-side (src/metrics/features.ts and src/analysis/gen-styles.ts ' +
      'are the two worked examples) and let src/taste import it back.',
  )
})

test('the type-only taste imports are an exact ratchet, not an allowlist', () => {
  const typeOnly = allViolations().filter((v) => v.typeOnly)
  assert.deepEqual(
    [...new Set(typeOnly.map((v) => v.file))].sort(),
    [...KNOWN_TYPE_ONLY_VIOLATIONS].sort(),
    'the known type-only taste imports changed. A NEW one is a boundary break — move the type ' +
      'DAW-side instead. A FIXED one means deleting its entry from KNOWN_TYPE_ONLY_VIOLATIONS, ' +
      'which is the whole point of asserting equality rather than a ceiling.',
  )
})

test('the boundary scan actually reads files (a scan over nothing would pass silently)', () => {
  // CLAUDE.md: a test that can silently skip is not a gate. If a rename empties DAW_DIRS or the
  // extension filter, both assertions above go green over zero files — so pin the floor.
  const files = DAW_DIRS.flatMap((d) => sourceFiles(d))
  assert.ok(files.length > 80, `the boundary scan found only ${files.length} DAW source files — expected >80 (94 at the time of writing); DAW_DIRS or the extension filter is broken`)
  for (const d of DAW_DIRS) {
    assert.ok(sourceFiles(d).length > 0, `no source files under ${d} — the DAW_DIRS entry is stale`)
  }
})
