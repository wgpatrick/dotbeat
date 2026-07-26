// Doc-numbering hygiene (research/140 §5.3, added 2026-07-26). `scripts/check-doc-numbering.mjs`
// was proposed as a pre-commit check; this repo has no hook mechanism, and an uninstalled hook is
// not a gate — so it runs here instead, on every test run.
//
// Three real failures it exists to catch, all found by the same audit:
//   - two research docs numbered 103 (2026-07-14 -> 2026-07-26, twelve days of ambiguous citations);
//   - two decisions numbered D23 (offline-render and GPL/surge), splitting ~20 citations;
//   - D20 cited from six source files while docs/decisions.md jumped D19 -> D21.
//
// Both directions are tested: the real docs must be clean, AND the checker must actually fire on
// each defect. A checker nobody has watched fail is indistinguishable from one that always passes.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const script = join(repoRoot, 'scripts', 'check-doc-numbering.mjs')

// The script is plain .mjs under scripts/ (not compiled into dist/), so it is imported by URL.
const { checkDocNumbering } = (await import(`file://${script}`)) as {
  checkDocNumbering: (opts?: { researchDir?: string; decisionsPath?: string }) => string[]
}

/** A throwaway docs tree with the given research filenames and decisions.md body. */
function fixture(researchFiles: string[], decisionsBody: string): { researchDir: string; decisionsPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beat-doc-numbering-'))
  const researchDir = join(dir, 'research')
  mkdirSync(researchDir)
  for (const f of researchFiles) writeFileSync(join(researchDir, f), '# stub\n')
  const decisionsPath = join(dir, 'decisions.md')
  writeFileSync(decisionsPath, decisionsBody)
  return { researchDir, decisionsPath }
}

const cleanDecisions = ['## D1 — first', 'body', '## D2 — second', 'body', '## D3 — third', ''].join('\n')

test('the repo\'s own docs pass the numbering check', () => {
  const problems = checkDocNumbering()
  assert.deepEqual(problems, [], `docs/research and docs/decisions.md have numbering problems:\n  ${problems.join('\n  ')}`)
})

test('the check runs standalone and exits 0 on the real docs', () => {
  // Also proves the script is executable as the pre-commit check its header advertises.
  const out = execFileSync(process.execPath, [script], { encoding: 'utf8' })
  assert.match(out, /doc numbering OK/)
})

test('it catches two research docs sharing a number', () => {
  const f = fixture(
    ['103-generative-audio-apis.md', '103-usability-pilot-lane-taste-loop.md', '104-something.md'],
    cleanDecisions,
  )
  const problems = checkDocNumbering(f)
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0]!, /duplicate research number 103/)
  assert.match(problems[0]!, /103-generative-audio-apis\.md, 103-usability-pilot-lane-taste-loop\.md/)
  assert.match(problems[0]!, /next free number \(105\)/, 'the fix line must name the number to move to')
})

test('non-numbered files in the research dir are not miscounted as a collision', () => {
  const f = fixture(['README.md', 'surge-right-ear-ring-rootcause.md', '01-landscape.md'], cleanDecisions)
  assert.deepEqual(checkDocNumbering(f), [])
})

test('it catches two decisions sharing a number', () => {
  // The real shape: D1..D3 clean, then the same number used twice. No gaps, so the ONLY finding
  // must be the duplicate — a duplicate that only shows up bundled with a gap report would be easy
  // to skim past.
  const f = fixture(
    ['01-x.md'],
    ['## D1 — a', '', '## D2 — b', '', '## D3 — offline renders', '', '## D3 — GPL synths', ''].join('\n'),
  )
  const problems = checkDocNumbering(f)
  assert.equal(problems.length, 1, problems.join('\n'))
  assert.match(problems[0]!, /duplicate decision number D3/)
  assert.match(problems[0]!, /2 "## D3" headings/)
  assert.match(problems[0]!, /renumber the newer one to D4/, 'the fix line must name the next free decision number')
})

test('it catches a MISSING number in the decisions sequence — the D20 hole', () => {
  const f = fixture(['01-x.md'], ['## D19 — a', '', '## D21 — b', '', '## D18 — c', '', '## D17 — d', ''].join('\n'))
  const problems = checkDocNumbering(f)
  const gap = problems.find((p) => /is missing/.test(p))
  assert.ok(gap !== undefined, `expected a missing-number report, got:\n  ${problems.join('\n  ')}`)
  // D1..D16 are absent too in this toy fixture; the point is that D20 is named.
  assert.match(gap, /\bD20\b/)
  assert.match(gap, /D1\.\.D21/)
})

test('it fails loudly if the decisions heading format ever changes', () => {
  const f = fixture(['01-x.md'], '# Design decisions\n\n### Decision 1 — a\n')
  const problems = checkDocNumbering(f)
  assert.equal(problems.length, 1)
  assert.match(problems[0]!, /no "## D<n>" headings found/)
  assert.match(problems[0]!, /this check is now blind/, 'a format change must not read as "everything is fine"')
})
