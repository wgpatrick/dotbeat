// D3 history tests — checkpoint / history / restore ("versioning without git vocabulary",
// docs/product-spec-desktop.md §4). Real git in real temp dirs; git commands (execFileSync) are
// the ground truth for what actually landed in the repo. Covers repo bootstrapping (init vs
// reuse-the-enclosing-repo, never nest), semantic auto-labels, the unchanged-file skip, log order
// + limit, the append-only restore invariant (history grows, never shrinks), and media riding
// alongside the .beat.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkpoint, history, restore, ensureHistoryRepo } from '../src/history/index.js'
import { initDocument, setValue, serialize } from '../src/core/index.js'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'beat-history-test-'))
}

/** Write a starter project to <dir>/song.beat and return its path. */
function starter(dir: string, mutate?: (doc: ReturnType<typeof initDocument>) => ReturnType<typeof initDocument>): string {
  const file = join(dir, 'song.beat')
  const doc = initDocument({ trackId: 'lead' })
  writeFileSync(file, serialize(mutate ? mutate(doc) : doc))
  return file
}

const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
const commitCount = (repo: string) => {
  try {
    return Number(git(repo, 'rev-list', '--count', 'HEAD'))
  } catch {
    return 0 // unborn branch
  }
}

test('first checkpoint git-inits the project folder when it is not already a repo', () => {
  const dir = tempDir()
  const file = starter(dir)
  assert.equal(existsSync(join(dir, '.git')), false)
  const result = checkpoint(file)
  assert.equal(result.skipped, false)
  assert.equal(existsSync(join(dir, '.git')), true)
  assert.equal(commitCount(dir), 1)
  assert.equal(history(file).length, 1)
})

test('a project inside an existing repo reuses it — never nests a second .git', () => {
  const outer = tempDir()
  git(outer, 'init', '-q')
  const projDir = join(outer, 'proj')
  mkdirSync(projDir)
  const file = starter(projDir)

  assert.equal(ensureHistoryRepo(projDir), execFileSync('git', ['-C', projDir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim())
  checkpoint(file)
  assert.equal(existsSync(join(projDir, '.git')), false, 'must not create a nested repo in the subdir')
  assert.equal(commitCount(outer), 1, 'the commit lands in the enclosing repo')
})

test('auto-label comes from the semantic diff (a cutoff change reads as a cutoff change)', () => {
  const dir = tempDir()
  const file = starter(dir)
  checkpoint(file) // baseline so HEAD exists

  writeFileSync(file, serialize(setValue(initDocument({ trackId: 'lead' }), 'lead.cutoff', '900')))
  const result = checkpoint(file)
  assert.equal(result.skipped, false)
  assert.match(result.label, /cutoff/)
  assert.match(git(dir, 'log', '-1', '--format=%s'), /cutoff/)
})

test('a label and an intent become the subject and an Intent trailer', () => {
  const dir = tempDir()
  const file = starter(dir)
  const result = checkpoint(file, { label: 'rough mix v1', intent: 'make it darker' })
  assert.equal(result.skipped, false)
  assert.equal(result.label, 'rough mix v1')
  assert.equal(result.intent, 'make it darker')
  assert.match(git(dir, 'log', '-1', '--format=%B'), /^rough mix v1\n\nIntent: make it darker/)
})

test('an unchanged file skips without committing', () => {
  const dir = tempDir()
  const file = starter(dir)
  checkpoint(file)
  const before = commitCount(dir)
  const result = checkpoint(file)
  assert.deepEqual(result, { skipped: true })
  assert.equal(commitCount(dir), before, 'no new commit for an unchanged file')
})

test('history is newest-first and respects limit', () => {
  const dir = tempDir()
  const file = starter(dir)
  checkpoint(file, { label: 'one' })
  writeFileSync(file, serialize(setValue(initDocument({ trackId: 'lead' }), 'bpm', '130')))
  checkpoint(file, { label: 'two' })
  writeFileSync(file, serialize(setValue(initDocument({ trackId: 'lead' }), 'bpm', '140')))
  checkpoint(file, { label: 'three' })

  assert.deepEqual(history(file).map((e) => e.label), ['three', 'two', 'one'])
  assert.deepEqual(history(file, { limit: 2 }).map((e) => e.label), ['three', 'two'])
})

test('restore writes the old bytes AND appends a new checkpoint (history grows, never shrinks)', () => {
  const dir = tempDir()
  const file = starter(dir)
  const v1Bytes = readFileSync(file, 'utf8')
  checkpoint(file, { label: 'v1' })

  writeFileSync(file, serialize(setValue(initDocument({ trackId: 'lead' }), 'bpm', '155')))
  checkpoint(file, { label: 'v2' })

  const v1Ref = history(file).find((e) => e.label === 'v1')!.ref
  const lenBefore = history(file).length
  const result = restore(file, v1Ref)

  assert.equal(result.skipped, false)
  assert.equal(readFileSync(file, 'utf8'), v1Bytes, 'the file is back to the v1 bytes')
  assert.equal(history(file).length, lenBefore + 1, 'restore appends, never rewrites')
  assert.match(history(file)[0]!.label, /go back to .* \(v1\)/)
})

test('restore with a bogus ref fails loudly', () => {
  const dir = tempDir()
  const file = starter(dir)
  checkpoint(file)
  assert.throws(() => restore(file, 'deadbeef'), /unknown checkpoint/)
})

test('restore never discards uncommitted work — it gets auto-checkpointed first (research/97)', () => {
  const dir = tempDir()
  const file = starter(dir)
  checkpoint(file, { label: 'v1' })
  const v1Bytes = readFileSync(file, 'utf8')
  const v1Ref = history(file).find((e) => e.label === 'v1')!.ref

  // An UNCOMMITTED edit — never checkpointed before restore is called. Before the fix, this got
  // silently and permanently discarded (git log --all -p showed zero trace of it).
  writeFileSync(file, serialize(setValue(initDocument({ trackId: 'lead' }), 'bpm', '155')))
  const lenBefore = history(file).length

  restore(file, v1Ref)

  assert.equal(readFileSync(file, 'utf8'), v1Bytes, 'the file is back to the v1 bytes')
  // Two new entries, not one: the auto-saved pre-restore state, then the "go back to v1" checkpoint.
  assert.equal(history(file).length, lenBefore + 2, 'the uncommitted bpm=155 edit got its own checkpoint before being overwritten')
  const entries = history(file)
  assert.match(entries[1]!.label, /before restore/, 'the auto-save checkpoint is the second-newest entry')
  assert.match(entries[0]!.label, /go back to .* \(v1\)/, 'the restore checkpoint is newest')

  // The uncommitted bpm=155 edit is genuinely recoverable — not just logged as having existed.
  const preRestoreRef = entries[1]!.ref
  const preRestoreBytes = execFileSync('git', ['-C', dir, 'show', `${preRestoreRef}:song.beat`], { encoding: 'utf8' })
  assert.match(preRestoreBytes, /bpm 155/, 'the discarded-looking edit is really still there, one restore away')
})

test('media/ files are committed alongside the .beat', () => {
  const dir = tempDir()
  const file = starter(dir)
  mkdirSync(join(dir, 'media'))
  writeFileSync(join(dir, 'media', 'kick.wav'), Buffer.from('RIFF....fake wav'))

  checkpoint(file)
  const tracked = git(dir, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n')
  assert.ok(tracked.includes('media/kick.wav'), `media not committed; tracked: ${tracked.join(', ')}`)
  assert.ok(tracked.includes('song.beat'))
})
