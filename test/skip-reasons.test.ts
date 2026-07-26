// The skip-reason roll-up (audit 140 §5.8).
//
// CLAUDE.md: "A test that can silently skip is not a gate. Missing fixtures/goldens FAIL LOUDLY
// with a regenerate hint. Only explicitly env-gated dependencies (venvs, surgepy, network) may
// skip, EACH WITH A NAMED REASON."
//
// That rule was being followed in spirit and unenforced in fact. Ten skip declarations used the
// bare `{ skip: !hasThing }` form, which node:test prints as an unadorned `# SKIP` — so
// `midiExtractDoctor: honest availability report  # SKIP` told a reader nothing about which
// dependency was missing or how to install it, and five of the eight skips in a clean run looked
// like that. They are now `{ skip: !hasThing ? 'reason' : false }`, the form ca2.test.ts and
// stem-extract.test.ts already used.
//
// What was missing beyond the individual reasons is the ROLL-UP: no single place said "these are
// the complete sanctioned set", so a new gated dependency could be added without anyone noticing it
// was new. This is that place. Same shape as W0.1's golden gate — a committed list that fails loudly
// when reality diverges, in either direction.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const testDir = join(repoRoot, 'test')

/**
 * The COMPLETE sanctioned set of reasons a test in this suite may skip for. Every one is an
 * explicitly env-gated external dependency, which is the only category CLAUDE.md permits.
 *
 * Adding an entry is a deliberate act: it means a new external dependency now gates part of the
 * suite. Say so in the commit. Removing one means a dependency became mandatory or its tests were
 * deleted. A skip reason that is NOT in this list fails the build.
 */
const SANCTIONED_REASONS = [
  // --- python + sidecar availability ---
  'no python3',
  'no python3 for the stub sidecar here: ${err instanceof Error ? err.message : err}',
  'no mido in python/.venv (pip install -r python/requirements-midi.txt)',
  'no roughness sidecar (pip install -r python/requirements-roughness.txt into python/venv-roughness)',
  'no surgepy (see python/README.md: surge XT python bindings)',
  'surgepy not built here (no PyPI wheel — see python/README.md)',
  'no surge factory patches found',
  'no CA2 install (set BEAT_CA2_DIR / BEAT_CA2_PYTHON)',
  'demucs not installed — python/.venv/bin/pip install -r python/requirements-demucs.txt',
  // --- the INVERSE gates: a degrade path can only be exercised when the dep is ABSENT ---
  'beatthis installed — degrade path not exercisable here',
  'stableaudio installed — degrade path not exercisable here',
  'surgepy installed — the unavailable-path assertion is not exercisable here',
  'this build HAS the tempo binding, so the degrade path cannot fire here',
  // --- the surgepy TEMPO binding (a local patch on top of the surgepy source build) ---
  'needs surgepy built WITH python/surge-patches/0001-surgepy-expose-host-tempo.patch (see `beat showdown --surge-doctor`)',
  // --- environment shape ---
  'running as root (or on a permissionless filesystem): a read-only file is still writable, so the mid-batch-failure precondition cannot be created',
]

/** Reason constants referenced by name rather than inlined — allowed, but only these. A const
 * whose definition fits on one line is RESOLVED to that definition below, so naming a reason
 * buys readability, not an exemption from the sanctioned list. `SETUP_HINT` spans several lines
 * and stays unresolved (named-but-unenforced), which is the older, weaker contract. */
const SANCTIONED_REASON_CONSTS = ['SETUP_HINT', 'skipReason']

const testFiles = readdirSync(testDir).filter((f) => f.endsWith('.ts'))

/** A file's source with line comments stripped — this file quotes the bad form in its own header,
 * and a scanner that cannot tell code from prose is a scanner nobody trusts (the same guard
 * verify-scene-slots.test.ts uses). */
function code(file: string): string {
  return readFileSync(join(testDir, file), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
}

/** Single-line `const NAME = <expr>` definitions in one file, for resolving named reasons back to
 * the strings they stand for. Multi-line definitions are deliberately not matched. */
function reasonConstDefs(src: string): Map<string, string> {
  const defs = new Map<string, string>()
  for (const m of src.matchAll(/^const (\w+) = (.+)$/gm)) {
    if (SANCTIONED_REASON_CONSTS.includes(m[1]!)) defs.set(m[1]!, m[2]!)
  }
  return defs
}

/** Every skip declaration in the suite: `t.skip(<arg>)` and `{ skip: <expr> }`. An arg that is a
 * bare sanctioned const resolves to that const's single-line definition, so the reason strings it
 * holds are checked against SANCTIONED_REASONS like any inlined one. */
function skipSites(): { file: string; form: string; arg: string }[] {
  const out: { file: string; form: string; arg: string }[] = []
  for (const file of testFiles) {
    const src = code(file)
    const defs = reasonConstDefs(src)
    const resolve = (arg: string) => defs.get(arg.trim()) ?? arg
    for (const m of src.matchAll(/t\.skip\(\s*([^\n]+?)\s*\)\s*$/gm)) {
      out.push({ file, form: 't.skip', arg: resolve(m[1]!) })
    }
    for (const m of src.matchAll(/\{\s*skip:\s*([\s\S]+?)\s*\}\s*,/g)) {
      out.push({ file, form: '{ skip }', arg: resolve(m[1]!) })
    }
  }
  return out
}

/** String literals inside a skip expression. */
const literalsIn = (arg: string): string[] =>
  [...arg.matchAll(/'([^']*)'|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? '')

test('every skip in the suite names a reason', () => {
  const nameless = skipSites().filter((s) => {
    if (literalsIn(s.arg).length > 0) return false
    return !SANCTIONED_REASON_CONSTS.some((c) => s.arg.includes(c))
  })
  assert.deepEqual(
    nameless.map((s) => `${s.file}: ${s.form} ${s.arg}`),
    [],
    'a skip with no reason prints as a bare "# SKIP" and tells a reader nothing about which ' +
      "dependency is missing. Use { skip: !hasThing ? 'why, and how to install it' : false }.",
  )
})

test('the set of skip reasons is exactly the sanctioned list — no more, no fewer', () => {
  const found = new Set<string>()
  for (const s of skipSites()) for (const lit of literalsIn(s.arg)) found.add(lit)

  const sanctioned = new Set(SANCTIONED_REASONS)
  const unsanctioned = [...found].filter((r) => !sanctioned.has(r)).sort()
  assert.deepEqual(
    unsanctioned,
    [],
    'a NEW gated dependency entered the suite. If that is intended, add its reason to ' +
      'SANCTIONED_REASONS and say so in the commit message — the point of this list is that ' +
      'growing the set of things that can silently not run is a visible decision.',
  )

  const vanished = [...sanctioned].filter((r) => !found.has(r)).sort()
  assert.deepEqual(
    vanished,
    [],
    'a sanctioned skip reason no longer appears anywhere. Either a dependency became mandatory ' +
      '(good — drop it from the list) or its tests were deleted (check that was intended).',
  )
})

test('the skip surface stays small', () => {
  // Not a style rule: every skip is a test that does not run on this machine, and the suite is the
  // only thing standing between a refactor and a silent regression. A jump here should be argued
  // for, not absorbed. Raise deliberately with the reason in the commit.
  const sites = skipSites().length
  assert.ok(
    sites <= 80,
    `${sites} skip declarations — 63 when this guard was written (2026-07-26), raised to 80 the ` +
      `same day when the retarget-surge-sidecar suite (4, all surgepy) merged in. Adding ` +
      `env-gated tests is fine; adding a lot of them at once usually means a dependency should be ` +
      `made mandatory in CI instead.`,
  )
})
