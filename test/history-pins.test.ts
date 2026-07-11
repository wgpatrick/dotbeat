// Named pins + retention/collapse tests ("versioning without git vocabulary",
// docs/product-spec-desktop.md §4, research/11-versioning-ux.md §1: "optional user pins ...
// unnamed checkpoints collapse between named ones so the timeline skims"). Pins are plain git
// tags (`pin/<slug>`) in the same local repo as the checkpoints — no new file format, no cloud.
// Covers: pin/unpin/list, name validation, the collapsed history view, pins showing up in the
// plain `history()` output, and pins surviving `restore`'s append-only model.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkpoint, history, collapsedHistory, restore, pin, unpin, pins, HistoryError, type CheckpointResult } from '../src/history/index.js'
import { initDocument, setValue, serialize } from '../src/core/index.js'

// realpathSync(tmpdir()) works around the same macOS symlink issue the module itself now
// resolves internally (/var/folders -> /private/var/folders) — belt and suspenders so these
// tests aren't a second victim of it even if the internal fix is ever reverted.
function tempDir(): string {
  return mkdtempSync(join(realpathSync(tmpdir()), 'beat-pins-test-'))
}

function starter(dir: string): string {
  const file = join(dir, 'song.beat')
  writeFileSync(file, serialize(initDocument({ trackId: 'lead' })))
  return file
}

function bumpBpm(file: string, bpm: string, label?: string): CheckpointResult {
  writeFileSync(file, serialize(setValue(initDocument({ trackId: 'lead' }), 'bpm', bpm)))
  return checkpoint(file, label ? { label } : {})
}

/** Narrow a CheckpointResult to its ref, failing the test loudly if it was skipped. */
function refOf(result: CheckpointResult): string {
  if (result.skipped) throw new Error('expected a real checkpoint, got skipped (unchanged file)')
  return result.ref
}

test('pin names a checkpoint; it shows up via pins() and in history()', () => {
  const dir = tempDir()
  const file = starter(dir)
  const v1 = refOf(checkpoint(file, { label: 'v1' }))

  const result = pin(file, v1, 'rough mix v1')
  assert.equal(result.name, 'rough mix v1')
  assert.equal(result.ref, v1)

  assert.deepEqual(
    pins(file).map((p) => p.name),
    ['rough mix v1']
  )

  const entries = history(file)
  assert.equal(entries.find((e) => e.ref === v1)!.pin, 'rough mix v1')
})

test('pin rejects an empty name, a name over 25 chars, an unknown ref, and a duplicate name', () => {
  const dir = tempDir()
  const file = starter(dir)
  const v1 = refOf(checkpoint(file, { label: 'v1' }))

  // errors are HistoryError, not a bare Error — same no-git-vocabulary discipline as checkpoint/restore
  assert.throws(() => pin(file, v1, '   '), (err: unknown) => err instanceof HistoryError && /needs a name/.test((err as Error).message))
  assert.throws(() => pin(file, v1, 'x'.repeat(26)), /25 characters or fewer/)
  assert.throws(() => pin(file, 'deadbeef', 'nope'), /unknown checkpoint/)

  pin(file, v1, 'the good take')
  assert.throws(() => pin(file, v1, 'the good take'), /already exists/)
  // a name that slugifies the same (case/spacing) collides too — one pin per identity
  assert.throws(() => pin(file, v1, 'The   Good Take'), /already exists/)
})

test('pin refuses a ref that never had a checkpoint of this file', () => {
  const dir = tempDir()
  const file = starter(dir)
  checkpoint(file) // baseline commit so HEAD exists
  const otherFile = join(dir, 'other.beat')
  writeFileSync(otherFile, serialize(initDocument({ trackId: 'lead' })))
  const otherRef = refOf(checkpoint(otherFile))

  // otherRef is a real checkpoint, but never touched song.beat
  assert.throws(() => pin(file, otherRef, 'wrong file'), /has no saved version of/)
})

test('unpin removes a pin by name; unknown name fails loudly; the checkpoint itself is untouched', () => {
  const dir = tempDir()
  const file = starter(dir)
  const v1 = refOf(checkpoint(file, { label: 'v1' }))
  pin(file, v1, 'keeper')

  assert.throws(() => unpin(file, 'not a pin'), /no pin named/)

  unpin(file, 'keeper')
  assert.deepEqual(pins(file), [])
  assert.equal(history(file).find((e) => e.ref === v1)!.pin, undefined)
  // the checkpoint survives — unpinning removes only the name
  assert.equal(history(file).length, 1)

  // and the name can be reused now that it's free
  pin(file, v1, 'keeper')
  assert.deepEqual(
    pins(file).map((p) => p.name),
    ['keeper']
  )
})

test('collapsedHistory folds unnamed runs between pins; pins() and history() stay newest-first', () => {
  const dir = tempDir()
  const file = starter(dir)

  const c1 = refOf(checkpoint(file, { label: 'one' })) // will be pinned
  refOf(bumpBpm(file, '121', 'two'))
  refOf(bumpBpm(file, '122', 'three'))
  const c4 = refOf(bumpBpm(file, '123', 'four')) // will be pinned
  refOf(bumpBpm(file, '124', 'five'))
  refOf(bumpBpm(file, '125', 'six'))

  pin(file, c1, 'first take')
  pin(file, c4, 'better take')

  // newest-first: six, five, [better take = four], three, two, [first take = one]
  const rows = collapsedHistory(file)
  assert.equal(rows.length, 4)
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['collapsed', 'checkpoint', 'collapsed', 'checkpoint']
  )
  assert.equal(rows[0]!.kind === 'collapsed' ? rows[0]!.count : -1, 2) // six, five
  assert.ok(rows[1]!.kind === 'checkpoint' && rows[1]!.pin === 'better take' && rows[1]!.ref === c4)
  assert.equal(rows[2]!.kind === 'collapsed' ? rows[2]!.count : -1, 2) // three, two
  assert.ok(rows[3]!.kind === 'checkpoint' && rows[3]!.pin === 'first take' && rows[3]!.ref === c1)

  // pins() lists pinned checkpoints only, newest first, independent of the collapsed view
  assert.deepEqual(
    pins(file).map((p) => p.name),
    ['better take', 'first take']
  )

  // sanity: uncollapsed history has all six, only two carrying a pin name
  const full = history(file)
  assert.equal(full.length, 6)
  assert.equal(full.filter((e) => e.pin).length, 2)
})

test('collapsedHistory with no pins at all folds the whole thing into one summary row', () => {
  const dir = tempDir()
  const file = starter(dir)
  checkpoint(file, { label: 'one' })
  bumpBpm(file, '130', 'two')
  bumpBpm(file, '140', 'three')

  const rows = collapsedHistory(file)
  assert.deepEqual(rows, [{ kind: 'collapsed', count: 3 }])
})

test("pins survive restore's append-only model: the pinned checkpoint stays pinned and visible after going back", () => {
  const dir = tempDir()
  const file = starter(dir)
  const v1 = refOf(checkpoint(file, { label: 'v1' }))
  pin(file, v1, 'rough mix v1')

  bumpBpm(file, '150', 'v2')
  bumpBpm(file, '160', 'v3')

  const lenBefore = history(file).length
  const result = restore(file, v1)
  assert.equal(result.skipped, false)

  // history grew (append-only) but the original pinned commit and its pin are both still there
  assert.equal(history(file).length, lenBefore + 1)
  assert.deepEqual(
    pins(file).map((p) => p.name),
    ['rough mix v1']
  )
  assert.equal(history(file).find((e) => e.ref === v1)!.pin, 'rough mix v1')

  // and the restored-to version can itself be pinned again under a new name
  const afterRestoreHead = history(file)[0]!
  pin(file, afterRestoreHead.ref, 'back to v1')
  assert.deepEqual(
    pins(file)
      .map((p) => p.name)
      .sort(),
    ['back to v1', 'rough mix v1'].sort()
  )
})
