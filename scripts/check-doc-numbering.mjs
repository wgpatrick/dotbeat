#!/usr/bin/env node
// Doc-numbering hygiene, proposed by research/140 §5.3 and not added until 2026-07-26. Three
// failures this repo has actually shipped, each of which silently breaks every citation that
// resolves a number to a document:
//
//   1. TWO research docs with the same number — `103-generative-audio-apis.md` and
//      `103-usability-pilot-lane-taste-loop.md` both landed on 2026-07-14, so "research 103"
//      pointed at two unrelated documents for twelve days.
//   2. TWO decisions with the same number — a second `## D23` (GPL/surge, 2026-07-22) collided
//      with the offline-render D23, splitting ~20 citations across two meanings.
//   3. A decision number that is CITED but does not exist — `D20` was referenced from six source
//      files while `docs/decisions.md` jumped D19 -> D21; its text lived only in a phase plan.
//
// Run standalone (`node scripts/check-doc-numbering.mjs`, or `npm run check:docs`), or wire it as
// a pre-commit hook. It is also asserted by test/doc-numbering.test.ts, so it gates on every test
// run whether or not a hook is installed — this repo has no hook mechanism today, and an
// uninstalled hook is not a gate.
//
// Exit 0 = clean, 1 = at least one problem (printed, one per line, with the fix).

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RESEARCH_DIR = join(repoRoot, 'docs', 'research')
const DECISIONS = join(repoRoot, 'docs', 'decisions.md')

/** Every problem found, as a printable line. Empty = clean.
 *  The two paths are overridable so the test can point it at a fixture that DOES have each defect —
 *  a checker nobody has ever seen fail is not a gate. */
export function checkDocNumbering({ researchDir = RESEARCH_DIR, decisionsPath = DECISIONS } = {}) {
  const problems = []

  // ---- 1. duplicate research numbers ---------------------------------------------------------
  // `ls docs/research/*.md | grep -oE '^[0-9]+' | uniq -d`, but reporting WHICH files collide.
  const byNumber = new Map()
  for (const name of readdirSync(researchDir)) {
    if (!name.endsWith('.md')) continue
    const m = /^(\d+)-/.exec(name)
    if (m === null) continue // README.md, surge-right-ear-ring-rootcause.md, etc.
    const n = Number(m[1])
    if (!byNumber.has(n)) byNumber.set(n, [])
    byNumber.get(n).push(name)
  }
  for (const [n, files] of [...byNumber].sort((a, b) => a[0] - b[0])) {
    if (files.length > 1) {
      problems.push(
        `duplicate research number ${n}: ${files.sort().join(', ')} — renumber one to the next free ` +
          `number (${Math.max(...byNumber.keys()) + 1}) and update every citation of it, bare "research ${n}" ` +
          'references included',
      )
    }
  }

  // ---- 2. duplicate decision numbers ---------------------------------------------------------
  const decisions = readFileSync(decisionsPath, 'utf8')
  const seen = new Map()
  for (const m of decisions.matchAll(/^## D(\d+)\b/gm)) {
    const n = Number(m[1])
    seen.set(n, (seen.get(n) ?? 0) + 1)
  }
  if (seen.size === 0) {
    problems.push(`no "## D<n>" headings found in ${decisionsPath} — the heading format changed and this check is now blind`)
    return problems
  }
  for (const [n, count] of [...seen].sort((a, b) => a[0] - b[0])) {
    if (count > 1) {
      problems.push(
        `duplicate decision number D${n}: ${count} "## D${n}" headings in docs/decisions.md — renumber the ` +
          `newer one to D${Math.max(...seen.keys()) + 1} and update every citation, then leave a bookkeeping ` +
          'note under it saying which is which',
      )
    }
  }

  // ---- 3. a MISSING number in the decisions sequence ------------------------------------------
  // The D20 failure: cited from code, absent from the log. A gap is not automatically wrong, but it
  // is always worth a sentence, so the fix line offers both remedies.
  const max = Math.max(...seen.keys())
  const missing = []
  for (let n = 1; n <= max; n++) if (!seen.has(n)) missing.push(n)
  if (missing.length > 0) {
    problems.push(
      `docs/decisions.md is missing ${missing.map((n) => `D${n}`).join(', ')} (the sequence runs D1..D${max}) — ` +
        'either paste the decision in (D20 was cited from six source files while its text lived only in ' +
        'docs/phase-40-plan.md) or add a one-line placeholder saying the number was retired and why',
    )
  }

  return problems
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const problems = checkDocNumbering()
  if (problems.length === 0) {
    console.log('doc numbering OK: no duplicate research numbers, no duplicate or missing decision numbers')
    process.exit(0)
  }
  for (const p of problems) console.error(`doc-numbering: ${p}`)
  process.exit(1)
}
