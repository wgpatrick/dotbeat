// Phase 35 Stream OC: `beat adopt` (and the shared adoptVariant core beat_adopt also calls) —
// copy a picked variant over the batch's parent file, guarded by the manifest's parentSha256 so
// a parent that moved on after the batch was generated is never silently clobbered. Plus the
// OC path-default rule: batch out-dirs and the scores log default NEXT TO the .beat file, not
// the process cwd (pilot 101 medium 4), on the CLI surface (mcp.test.ts covers the MCP side).

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { adoptVariant, defaultBatchDir, defaultScoresLog, scoreBatch, BeatBatchError } from '../src/vary/batch.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const exampleBeat = join(repoRoot, 'examples', 'real-groove.beat')

function beat(args: string[], opts: { cwd?: string; expectExit?: number } = {}): string {
  try {
    return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8', cwd: opts.cwd })
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    if (opts.expectExit !== undefined && e.status === opts.expectExit) return (e.stdout ?? '') + (e.stderr ?? '')
    throw new Error(`beat ${args.join(' ')} exited ${e.status}:\n${e.stderr ?? ''}${e.stdout ?? ''}`)
  }
}

function tempProject(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beat-adopt-test-'))
  const file = join(dir, 'song.beat')
  copyFileSync(exampleBeat, file)
  return { dir, file }
}

test('beat adopt copies the picked variant over the parent (score -> adopt round trip, "vN" and "N" both accepted)', () => {
  const { dir, file } = tempProject()
  const batch = join(dir, 'batch')
  beat(['vary', file, 'lead', 'filter', '--count', '3', '--seed', '7', '--out-dir', batch])

  const out = beat(['adopt', batch, 'v2'])
  assert.match(out, /adopted v2 -> .*song\.beat \(lead\./)
  assert.match(out, /daemon\/GUI on this file picks the change up automatically/)
  assert.equal(readFileSync(file, 'utf8'), readFileSync(join(batch, 'v2.beat'), 'utf8'), 'parent bytes equal the picked variant')

  // idempotent from the same batch requires force now: adopting v2 changed the parent's sha
  const refused = beat(['adopt', batch, '1'], { expectExit: 2 })
  assert.match(refused, /has changed since this batch was generated \(sha256 [0-9a-f]{12}\.\.\. vs the manifest's [0-9a-f]{12}\.\.\.\)/)
  assert.match(refused, /pass force to overwrite anyway/)
  assert.equal(readFileSync(file, 'utf8'), readFileSync(join(batch, 'v2.beat'), 'utf8'), 'refusal leaves the parent untouched')

  const forced = beat(['adopt', batch, '1', '--force'])
  assert.match(forced, /adopted v1 -> /)
  assert.match(forced, /\(forced: the parent had changed since this batch was generated/)
  assert.equal(readFileSync(file, 'utf8'), readFileSync(join(batch, 'v1.beat'), 'utf8'))
})

test('beat adopt guards against a parent that moved on through ORDINARY edits after the batch', () => {
  const { dir, file } = tempProject()
  const batch = join(dir, 'batch')
  beat(['vary', file, 'lead', 'env', '--count', '2', '--seed', '3', '--out-dir', batch])
  // the parent moves on — exactly the "may have been edited since" case the sha guard is for
  beat(['set', file, 'lead.cutoff', '500'])
  const movedOn = readFileSync(file, 'utf8')

  const refused = beat(['adopt', batch, '1'], { expectExit: 2 })
  assert.match(refused, /has changed since this batch was generated/)
  assert.equal(readFileSync(file, 'utf8'), movedOn)

  beat(['adopt', batch, '1', '--force'])
  assert.equal(readFileSync(file, 'utf8'), readFileSync(join(batch, 'v1.beat'), 'utf8'))
})

test('beat adopt error paths: bad pick, missing batch, and feel batches adopt too (the pilot-101 gap)', () => {
  const { dir, file } = tempProject()
  const batch = join(dir, 'feel-batch')
  beat(['vary', file, 'drums', 'feel', '--count', '2', '--seed', '5', '--out-dir', batch])

  assert.match(beat(['adopt', batch, '9'], { expectExit: 2 }), /pick "9" is not a variant number 1-2/)
  assert.match(beat(['adopt', join(dir, 'nope'), '1'], { expectExit: 2 }), /no such batch directory or missing manifest\.json/)
  assert.match(beat(['adopt', batch], { expectExit: 2 }), /adopt needs <batch-dir> <pick>/)

  // a feel winner — not replayable via `beat set` — adopts cleanly, and the output names the recipe
  const out = beat(['adopt', batch, 'v2'])
  assert.match(out, /adopted v2 -> .*song\.beat \(humanize seed=6/)
  assert.equal(readFileSync(file, 'utf8'), readFileSync(join(batch, 'v2.beat'), 'utf8'))
})

test('adoptVariant resolves a relative manifest parent via the batch dir when the cwd has moved', () => {
  const { dir, file } = tempProject()
  // vary from INSIDE the project dir with a relative file reference and the default out-dir —
  // manifest.parent is stored verbatim as "song.beat"
  const out = beat(['vary', 'song.beat', 'lead', 'filter', '--count', '2', '--seed', '11'], { cwd: dir })
  assert.match(out, /2 variants of lead\.filter/)
  const batch = join(dir, 'vary-filter-11')
  assert.ok(existsSync(join(batch, 'manifest.json')), 'default out-dir lands next to the .beat')
  assert.equal(JSON.parse(readFileSync(join(batch, 'manifest.json'), 'utf8')).parent, 'song.beat')

  // adopt from a DIFFERENT cwd: "song.beat" doesn't exist here, so the batch-dir fallback resolves it
  const elsewhere = mkdtempSync(join(tmpdir(), 'beat-adopt-elsewhere-'))
  const result = adoptVariant(batch, 'v1')
  assert.equal(result.parentPath, file)
  assert.equal(readFileSync(file, 'utf8'), readFileSync(join(batch, 'v1.beat'), 'utf8'))
  // (elsewhere unused beyond proving no cwd dependency — adoptVariant ran in this test process,
  // whose cwd is the repo, not the project dir)
  assert.ok(existsSync(elsewhere))
})

// ---- OC path defaults: out-dir and scores log land next to the .beat, not the cwd ------------

test('beat vary run from an unrelated cwd defaults its out-dir next to the .beat file', () => {
  const { dir, file } = tempProject()
  const elsewhere = mkdtempSync(join(tmpdir(), 'beat-vary-cwd-'))
  const out = beat(['vary', file, 'lead', 'filter', '--count', '2', '--seed', '42'], { cwd: elsewhere })
  assert.match(out, /2 variants of lead\.filter/)
  assert.ok(existsSync(join(dir, 'vary-filter-42', 'manifest.json')), 'batch created next to the .beat')
  assert.ok(!existsSync(join(elsewhere, 'vary-filter-42')), 'nothing scattered into the cwd')
  assert.equal(defaultBatchDir(file, 'filter', 42), join(dir, 'vary-filter-42'))
})

test('beat score and beat suggest default the scores log next to the parent .beat, from any cwd', () => {
  const { dir, file } = tempProject()
  const elsewhere = mkdtempSync(join(tmpdir(), 'beat-score-cwd-'))
  const batch = join(dir, 'vary-filter-42')
  beat(['vary', file, 'lead', 'filter', '--count', '2', '--seed', '42', '--out-dir', batch], { cwd: elsewhere })

  const out = beat(['score', batch, '1'], { cwd: elsewhere })
  assert.match(out, /scored .*: v1 -> \S*beat-scores\.jsonl\n/)
  assert.ok(existsSync(join(dir, 'beat-scores.jsonl')), 'log lands next to the .beat')
  assert.ok(!existsSync(join(elsewhere, 'beat-scores.jsonl')), 'nothing scattered into the cwd')
  assert.equal(defaultScoresLog(file), join(dir, 'beat-scores.jsonl'))

  // suggest reads the SAME default location — the pair must agree or the exhaust silently forks
  const suggest = beat(['suggest', file, 'lead'], { cwd: elsewhere })
  assert.match(suggest, /filter/)
  assert.doesNotMatch(suggest, /no scored rounds/i)

  // an explicit --log still wins, exactly as written
  const explicitLog = join(elsewhere, 'my.jsonl')
  beat(['score', batch, '2', '--log', explicitLog], { cwd: elsewhere })
  assert.ok(existsSync(explicitLog))
})

test('scoreBatch (shared core) derives the same default log via the manifest parent', () => {
  const { dir, file } = tempProject()
  const batch = join(dir, 'batch')
  beat(['vary', file, 'lead', 'env', '--count', '2', '--seed', '9', '--out-dir', batch])
  const result = scoreBatch(batch, ['v1'])
  assert.equal(result.logPath, join(dir, 'beat-scores.jsonl'))
  assert.ok(existsSync(result.logPath))
  assert.throws(() => scoreBatch(batch, []), BeatBatchError)
})
