// W0.2 — the CLI *surface* test (docs/research/130 §3 wave 0; R1 §6.4 step 0).
//
// Every other CLI test in this repo asserts one command's OUTPUT. Nothing asserts the shape of the
// surface itself, so nothing would notice a command silently vanishing from the dispatch during a
// refactor — which is exactly what the beat.mjs decomposition (W2.5) is going to do to every
// command in the file. This is that net, and it is deliberately the CHEAPEST possible one:
//
//   1. HELP <-> dispatch is 1:1 (no documented-but-unreachable command, no undocumented command)
//   2. every command answers `beat <cmd> --help` with exit 0 and non-empty output
//   3. the full no-args usage dump matches a golden snapshot
//   4. every command rejects an unknown flag — with a documented, SHRINKING ledger of the ones
//      that don't (R1-F2: 75 of 87 today)
//
// (1) and (3) parse `cli/beat.mjs` as TEXT rather than importing it, because importing it would
// run the CLI. That is brittle-but-honest: the parsing is pinned by sanity assertions below, and
// the whole parsing half of this file is meant to be DELETED when W1.4 lands `cli/lib/args.mjs`
// and the HELP array moves to `cli/help/` — at which point both tables become importable data and
// these tests read them directly. Until then, brittle beats absent.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const usageGolden = join(repoRoot, 'test', 'fixtures', 'cli-usage.golden.txt')
const source = readFileSync(beatCli, 'utf8')

// A scratch cwd so a command that writes on a malformed invocation (notably `beat daemon`, which
// treats an unrecognized argument as the project *folder* and scaffolds a starter project in it)
// litters a temp dir instead of the repo.
const scratch = mkdtempSync(join(tmpdir(), 'beat-cli-surface-'))

// ---- parsing cli/beat.mjs's two tables -------------------------------------------------------

/** The `cmd:` (and any `aliases:`) fields of the HELP array — the documented command surface. */
function helpCommands(): string[] {
  const start = source.indexOf('\nconst HELP = [')
  assert.ok(start > 0, 'could not find `const HELP = [` in cli/beat.mjs — update this test')
  const end = source.indexOf('\n]\n', start)
  assert.ok(end > start, 'could not find the end of the HELP array in cli/beat.mjs')
  const block = source.slice(start, end)
  const names: string[] = []
  for (const m of block.matchAll(/\bcmd: '([^']+)'/g)) names.push(m[1]!)
  for (const m of block.matchAll(/\baliases: \[([^\]]*)\]/g)) {
    for (const a of m[1]!.matchAll(/'([^']+)'/g)) names.push(a[1]!)
  }
  return names
}

/** The `case '<cmd>':` labels of main()'s dispatch switch — the reachable command surface. */
function dispatchCommands(): string[] {
  const start = source.indexOf('\nasync function main() {')
  assert.ok(start > 0, 'could not find `async function main()` in cli/beat.mjs — update this test')
  const block = source.slice(start)
  return [...block.matchAll(/^ {4}case '([^']+)':/gm)].map((m) => m[1]!)
}

/** Dispatch labels that are the help mechanism itself, not commands with HELP entries. */
const HELP_ONLY_CASES = ['help', '--help']

// ---- running the CLI -------------------------------------------------------------------------

interface Run {
  status: number | null
  signal: string | null
  out: string
}

function run(args: string[], timeout = 5000): Run {
  try {
    const out = execFileSync(process.execPath, [beatCli, ...args], {
      encoding: 'utf8',
      cwd: scratch,
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, signal: null, out }
  } catch (err) {
    const e = err as { status?: number | null; signal?: string | null; stdout?: string; stderr?: string }
    return { status: e.status ?? null, signal: e.signal ?? null, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}

// ---- 1. HELP <-> dispatch --------------------------------------------------------------------

test('every HELP entry has a dispatch case and every dispatch case has a HELP entry', () => {
  const help = helpCommands()
  const dispatch = dispatchCommands()

  // Sanity-pin the text parsing itself: if a refactor moves these tables, this fails LOUDLY here
  // rather than silently asserting two empty sets are equal.
  assert.ok(help.length >= 80, `parsed only ${help.length} HELP entries — the parser is stale`)
  assert.ok(dispatch.length >= 80, `parsed only ${dispatch.length} dispatch cases — the parser is stale`)
  assert.ok(help.includes('init') && help.includes('mcp-init'), 'HELP parse missed known commands')
  assert.ok(dispatch.includes('init') && dispatch.includes('mcp-init'), 'dispatch parse missed known commands')

  assert.deepEqual([...new Set(help)].sort(), help.slice().sort(), 'a command is listed twice in HELP')
  assert.deepEqual([...new Set(dispatch)].sort(), dispatch.slice().sort(), 'a command has two dispatch cases')

  const documented = new Set(help)
  const reachable = new Set(dispatch.filter((c) => !HELP_ONLY_CASES.includes(c)))

  const undocumented = [...reachable].filter((c) => !documented.has(c)).sort()
  const unreachable = [...documented].filter((c) => !reachable.has(c)).sort()

  assert.deepEqual(undocumented, [], 'dispatch cases with no HELP entry (undocumented commands)')
  assert.deepEqual(unreachable, [], 'HELP entries with no dispatch case (advertised but unreachable — pilot 111)')

  for (const c of HELP_ONLY_CASES) {
    assert.ok(dispatch.includes(c), `the \`${c}\` dispatch case disappeared — per-command help is broken`)
  }
})

// ---- 2. `beat <cmd> --help` ------------------------------------------------------------------

test('every command answers --help with exit 0 and non-empty usage text', () => {
  const failures: string[] = []
  for (const cmd of helpCommands()) {
    const r = run([cmd, '--help'])
    if (r.status !== 0) {
      failures.push(`${cmd}: exited ${r.status ?? r.signal}`)
      continue
    }
    if (!r.out.trim()) {
      failures.push(`${cmd}: empty output`)
      continue
    }
    if (!r.out.startsWith('usage:')) failures.push(`${cmd}: help does not start with "usage:"`)
    if (!r.out.includes(`beat ${cmd}`)) failures.push(`${cmd}: help text never names the command`)
  }
  assert.deepEqual(failures, [], 'commands whose --help is broken')
})

test('`beat help <cmd>` and `beat <cmd> --help` print the same block; unknown names exit 2', () => {
  for (const cmd of ['init', 'set', 'vary', 'render']) {
    assert.equal(run(['help', cmd]).out, run([cmd, '--help']).out, `help routing diverges for ${cmd}`)
  }
  const unknown = run(['help', 'definitely-not-a-command'])
  assert.equal(unknown.status, 2)
  assert.match(unknown.out, /unknown command/)
  const unknownDash = run(['definitely-not-a-command', '--help'])
  assert.equal(unknownDash.status, 2)
  assert.match(unknownDash.out, /unknown command/)
})

// ---- 3. golden usage snapshot ----------------------------------------------------------------

test('the no-args usage dump matches its golden snapshot', () => {
  const r = run([])
  assert.equal(r.status, 0, 'bare `beat` should print usage and exit 0')

  if (process.env.UPDATE_CLI_USAGE === '1' || !existsSync(usageGolden)) {
    writeFileSync(usageGolden, r.out)
    if (process.env.UPDATE_CLI_USAGE !== '1') {
      assert.fail(`wrote a fresh golden at ${usageGolden} — inspect it and commit it`)
    }
    return
  }

  const golden = readFileSync(usageGolden, 'utf8')
  if (golden !== r.out) {
    const g = golden.split('\n')
    const a = r.out.split('\n')
    const i = g.findIndex((l, n) => l !== a[n])
    assert.fail(
      `beat's usage dump changed at line ${i + 1}:\n` +
        `  golden: ${JSON.stringify(g[i])}\n` +
        `  actual: ${JSON.stringify(a[i])}\n` +
        `If the change is intended, re-run with UPDATE_CLI_USAGE=1 and commit ${usageGolden}.`,
    )
  }
})

// ---- 4. unknown-flag rejection, with a shrinking ledger --------------------------------------

// R1-F2: only 12 of 87 commands reject a typo'd flag. Four separate usability pilots (109, 110,
// 111, 112) each rediscovered this bug class ONE COMMAND AT A TIME, because the fix was applied
// per-command instead of structurally. The ledger below is the honest state of that hole, written
// down so it can only get smaller: a command listed here that starts rejecting FAILS this test
// and must be deleted from the list. W1.4 (`cli/lib/args.mjs` + declarative per-command specs) is
// what empties it.
//
// Deliberately NOT `{ skip: true }`: a skip reads as a pass and would let the number grow back.
const UNKNOWN_FLAG_HOLES = [
  'add-hit',
  'add-note',
  'add-track',
  'adopt',
  'analyze',
  'analyze-structure',
  'audio-clip',
  'audio-pitch',
  'audio-split',
  'audition',
  'automate',
  'automate-shape',
  'checkpoint',
  'clip',
  'consolidate',
  'daemon',
  'diff',
  'drum-kit',
  'drum-kits',
  'effect-add',
  'effect-bypass',
  'effect-move',
  'effect-rm',
  'excerpt',
  // 'feedback' left the ledger on 2026-07-27, when it grew --offline/--live: a typo'd --offlin
  // would otherwise have fallen through to the positional list and silently run the non-exact
  // real-time path, which is pilot 109's exact bug on a new flag.
  'fit-scale',
  'group',
  'group-set',
  'history',
  'humanize',
  'init',
  'inspect',
  'invert',
  'keymap',
  'lane',
  'legato',
  'lint',
  'macro',
  'mcp',
  'mcp-init',
  'metrics',
  'open',
  'pin',
  'pins',
  'place',
  'preset',
  'presets',
  'produce',
  'quantize',
  'regen',
  'restore',
  'reverse',
  'rm-group',
  'rm-hit',
  'rm-note',
  'rm-track',
  'sample',
  'sample-info',
  'scene',
  'scene-set',
  'score',
  'selection',
  'set',
  'skeleton',
  'song',
  'song-insert',
  'song-move',
  'source',
  'suggest',
  'surge',
  'time-scale',
  'transpose',
  'trick',
  'unpin',
  'unplace',
]

/** Extra argv some commands need so PROBING them is safe (never anything that could satisfy the
 * bogus flag). `daemon` treats an unrecognized argument as its project target and then SERVES —
 * `--port 0` keeps it off the real 8420 so a probe can never collide with a live GUI session. */
const PROBE_PREFIX: Record<string, string[]> = { daemon: ['--port', '0'] }

const BOGUS_FLAG = '--definitely-not-a-flag'

test('unknown flags are rejected — and the ledger of commands that do not only shrinks', () => {
  const commands = helpCommands()

  for (const c of UNKNOWN_FLAG_HOLES) {
    assert.ok(commands.includes(c), `UNKNOWN_FLAG_HOLES lists "${c}", which is not a command any more`)
  }

  const stillOpen: string[] = []
  for (const cmd of commands) {
    const r = run([cmd, ...(PROBE_PREFIX[cmd] ?? []), BOGUS_FLAG], 4000)
    const rejects = r.status === 2 && /unknown flag/i.test(r.out)
    if (!rejects) stillOpen.push(cmd)
  }

  const known = new Set(UNKNOWN_FLAG_HOLES)
  const regressions = stillOpen.filter((c) => !known.has(c)).sort()
  const fixed = UNKNOWN_FLAG_HOLES.filter((c) => !stillOpen.includes(c)).sort()

  assert.deepEqual(
    regressions,
    [],
    'these commands silently accept an unknown flag and are NOT in the documented ledger — ' +
      'a new command shipped without arg validation (see R1-F2)',
  )
  assert.deepEqual(
    fixed,
    [],
    'these commands now reject unknown flags — delete them from UNKNOWN_FLAG_HOLES so the ledger shrinks',
  )
  assert.ok(
    UNKNOWN_FLAG_HOLES.length <= 75,
    `the unknown-flag hole is ${UNKNOWN_FLAG_HOLES.length} commands wide; it was 75 at W0.2 and must never grow`,
  )
})
