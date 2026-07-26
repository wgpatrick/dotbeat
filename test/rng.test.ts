// RNG cross-copy equality — wave-0 gate W0.7(a) for the codebase review's T4/R6-13 consolidation.
//
// `mulberry32` is copy-pasted across this repo (R3's ledger counts 5-6 copies; R6's src sweep found
// more). Every copy is *supposed* to be the same generator: seeds, salts, and every "same seed =>
// same audio/same batch" reproducibility claim in the taste layer assume it. Nothing asserted that.
//
// This test is deliberately COORDINATE-FREE: it does not name the copies. It scans the tree for the
// mulberry32 magic constant, extracts whichever implementations are there RIGHT NOW, and proves they
// all emit the identical stream. A consolidation pass that deletes four copies leaves this test
// green and still guarding the survivor; a consolidation pass that accidentally changes the
// algorithm (or leaves one copy behind on the old math) fails it.
//
// Two layers:
//   1. A golden vector for the algorithm itself, so "they all agree" can't drift together.
//   2. Cross-copy equality for every implementation discovered on disk.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mulberry32 } from '../src/taste/eval.js'
import { makeRng } from '../src/vary/vary.js'
import { SeededRandom } from '../src/match/cmaes.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The mulberry32 increment. Every copy in this repo is found by this constant, not by name. */
const MAGIC = '0x6d2b79f5'

const SEEDS = [0, 1, 2, 7, 41, 42, 401, 523, 613, 971, 1301, 1487, 1693, 2027, 123456, 0x7fffffff, 0xdeadbeef, 4294967295]
const DRAWS = 8

/** The reference stream: `seed -> DRAWS successive draws`, from src/taste/eval.ts's exported copy. */
function reference(seed: number): number[] {
  const rng = mulberry32(seed)
  return Array.from({ length: DRAWS }, () => rng())
}

// ---------------------------------------------------------------------------------------------
// 1. The algorithm itself, pinned. If a consolidation swaps in a "better" PRNG, every reproducible
// artifact in the repo (rated batches, seeded showdowns, humanize jitter, chance rolls) silently
// changes meaning. That must be a deliberate, visible edit to these numbers.
// ---------------------------------------------------------------------------------------------
test('mulberry32 golden vector — the algorithm every seeded surface in the repo depends on', () => {
  assert.deepEqual(
    reference(0).map((v) => Number(v.toFixed(12))),
    [0.266429208685, 0.000329745701, 0.223272027448, 0.146202147938, 0.467327822931, 0.545049082721, 0.615251384443, 0.648985379841],
  )
  assert.deepEqual(
    reference(42).map((v) => Number(v.toFixed(12))),
    [0.60110375192, 0.448290558998, 0.85246579349, 0.669734041439, 0.174813898746, 0.526592542185, 0.27322799433, 0.624744653935],
  )
  // Range invariant — every draw is a uniform in [0, 1).
  for (const seed of SEEDS) for (const v of reference(seed)) assert.ok(v >= 0 && v < 1, `draw out of [0,1): ${v}`)
})

// ---------------------------------------------------------------------------------------------
// 2. Every copy on disk, discovered by scanning. Two shapes exist today:
//    - factory:  function f(seed): () => number   (a closure whose state advances per call)
//    - one-shot: function f(seed): number         (one draw; equals the factory's FIRST draw)
// A hit that sits in neither shape is reported by name so nobody can add a third silently.
// ---------------------------------------------------------------------------------------------

/** Files whose mulberry32 is NOT a free `function f(seed)` and is therefore covered by an explicit
 * import-based case below instead of by extraction. Shrinking this list is fine (consolidation);
 * GROWING it means a new odd-shaped RNG copy appeared and needs a case here. */
const NON_FREE_FUNCTION_COPIES = ['src/match/cmaes.ts']

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

/** Extracts the enclosing `function name(seed…) { … }` around `hitLine`, by walking back to the
 * declaration and forward to its balanced closing brace. Returns null if the hit isn't in one. */
function extractEnclosingFunction(lines: string[], hitLine: number): { name: string; src: string } | null {
  let start = -1
  let name = ''
  for (let i = hitLine; i >= 0 && i > hitLine - 12; i--) {
    const m = /^(?:export\s+)?function\s+(\w+)\s*\(\s*seed\b/.exec(lines[i]!)
    if (m) {
      start = i
      name = m[1]!
      break
    }
  }
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]!) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    if (depth === 0 && i > start) return { name, src: lines.slice(start, i + 1).join('\n') }
  }
  return null
}

/** Strips the handful of TS annotations these functions carry, so the body can be evaluated. */
function stripTypes(src: string): string {
  return src
    .replace(/^export\s+/, '')
    .replace(/\(\s*seed\s*:\s*number\s*\)/, '(seed)')
    .replace(/\)\s*:\s*(?:\(\s*\)\s*=>\s*)?number\s*\{/, ') {')
}

interface Copy {
  file: string
  name: string
  kind: 'factory' | 'one-shot'
  fn: (seed: number) => unknown
}

function discoverCopies(): Copy[] {
  const files = [...walk(join(repoRoot, 'src')), ...walk(join(repoRoot, 'ui', 'src'))]
  const copies: Copy[] = []
  const unrecognized: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes(MAGIC)) continue
    const rel = relative(repoRoot, file).split(sep).join('/')
    const lines = text.split('\n')
    let found = false
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.includes(MAGIC)) continue
      const ex = extractEnclosingFunction(lines, i)
      if (!ex) continue
      found = true
      const kind: Copy['kind'] = /return\s*(?:\(\s*\)\s*=>|function)/.test(ex.src) ? 'factory' : 'one-shot'
      // eslint-disable-next-line no-new-func -- evaluating repo source on purpose: the point of the
      // test is to run the copies as they are written, without importing (several aren't exported).
      const fn = new Function(`"use strict"; return (${stripTypes(ex.src)})`)() as (seed: number) => unknown
      copies.push({ file: rel, name: ex.name, kind, fn })
    }
    if (!found) unrecognized.push(rel)
  }
  assert.deepEqual(
    unrecognized.sort(),
    [...NON_FREE_FUNCTION_COPIES].sort(),
    'a mulberry32 copy appeared in a shape this test cannot extract — either consolidate it onto the shared RNG, or add an explicit import-based case for it below and list its file in NON_FREE_FUNCTION_COPIES',
  )
  return copies
}

test('every mulberry32 copy on disk emits the identical stream', () => {
  const copies = discoverCopies()
  assert.ok(copies.length >= 1, 'expected at least one mulberry32 implementation in src/ or ui/src/')
  for (const copy of copies) {
    for (const seed of SEEDS) {
      const want = reference(seed)
      if (copy.kind === 'factory') {
        const gen = copy.fn(seed) as () => number
        const got = Array.from({ length: DRAWS }, () => gen())
        assert.deepEqual(got, want, `${copy.file}: ${copy.name}(${seed}) stream diverges from src/taste/eval.ts's mulberry32`)
      } else {
        assert.equal(copy.fn(seed), want[0], `${copy.file}: ${copy.name}(${seed}) diverges from the first draw of the canonical stream`)
      }
    }
  }
})

// Belt-and-braces on the copies that ARE exported: exercised through their real import path, so the
// extraction machinery above can never be the only thing under test.
test('exported RNG entry points agree with the canonical stream', () => {
  for (const seed of SEEDS) {
    const want = reference(seed)

    const vary = makeRng(seed)
    assert.deepEqual(Array.from({ length: DRAWS }, () => vary()), want, `src/vary/vary.ts makeRng(${seed})`)

    // src/match/cmaes.ts's SeededRandom is the same generator in class clothing: it keeps state as
    // uint32 (`>>> 0`) where the free functions keep it as int32 (`| 0`), which is bit-identical
    // through Math.imul. Pinned here so a consolidation can fold it in with evidence.
    const cmaes = new SeededRandom(seed)
    assert.deepEqual(Array.from({ length: DRAWS }, () => cmaes.uniform()), want, `src/match/cmaes.ts SeededRandom(${seed}).uniform()`)
  }
})
