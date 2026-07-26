// The daemon's in-session undo/redo stack — first unit tests. Wave-0 gate W0.8(a).
//
// Review R5-F7: undo/redo is "the single most subtle piece of state in the daemon" (a coalescing
// window, an external-write invalidation path, and a `commitDoc` that deliberately BYPASSES the
// `writeIfChanged` choke point) and it had ZERO `test/` coverage — verified only by 22 headful
// browser scripts that no suite runs. R5-F5 wants `daemon.ts` split into five modules, and steps
// 4-5 move exactly this code; the split is gated on this file existing.
//
// Design intent under test is research/28 §5, as implemented in src/daemon/daemon.ts:
//   §5.1  writeIfChanged is the ONE choke point: every mutating route pushes an undo entry for free,
//         a no-op write pushes nothing, and any fresh edit invalidates the redo branch.
//   §5.3  gesture coalescing: a write reusing the same coalescing key inside UNDO_COALESCE_MS
//         (700ms) extends the in-flight gesture instead of pushing a new snapshot. The key is the
//         /edit `path`, overridable by a client-supplied `gestureId`, and deliberately ABSENT for
//         the bare `<track>.note` / `<track>.hit` append grammar (each call mints a new entity).
//   §5.4  depth is bounded (UNDO_MAX = 200); the oldest entry drops.
//   §3    an external write to the file is authoritative and clears both stacks.
//
// These are request-level tests through a real daemon over HTTP, following test/daemon.test.ts's
// pattern (port 0 = OS-assigned, so the file is parallel-safe).

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { initDocument, addTrack, addHit, serialize, parse, type BeatDocument } from '../src/core/index.js'
import { startDaemon, type Daemon } from '../src/daemon/daemon.js'

/** Mirrors src/daemon/daemon.ts's own constants — kept here so a change to either is a visible
 * two-file diff rather than a silently-passing test. */
const UNDO_COALESCE_MS = 700
const UNDO_MAX = 200

/** A small two-track project (synth `lead` + drums `beat`), built through the real edit primitives. */
function seedDoc(): BeatDocument {
  let doc = initDocument({ bpm: 120, loopBars: 1, trackId: 'lead' })
  doc = addTrack(doc, {
    id: 'beat',
    kind: 'drums',
    lanes: [
      { name: 'kick', backing: { type: 'synth', voice: 'membrane', params: {} } },
      { name: 'snare', backing: { type: 'synth', voice: 'noise', params: {} } },
    ],
  }).doc
  doc = addHit(doc, 'beat', { lane: 'kick', start: 0, velocity: 1 }).doc
  return doc
}

async function withDaemon(fn: (ctx: {
  daemon: Daemon
  filePath: string
  post: (path: string, body?: unknown) => Promise<any>
  get: (path: string) => Promise<any>
  edit: (path: string, value: string, extra?: Record<string, unknown>) => Promise<any>
  doc: () => BeatDocument
  state: () => Promise<{ canUndo: boolean; canRedo: boolean; undoCount: number; redoCount: number }>
}) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'beat-undo-test-'))
  const filePath = join(dir, 'song.beat')
  writeFileSync(filePath, serialize(seedDoc()))
  const daemon = await startDaemon({ filePath, port: 0 })
  const base = `http://127.0.0.1:${daemon.port}`
  const post = async (path: string, body?: unknown) =>
    (await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })).json()
  const get = async (path: string) => (await fetch(`${base}${path}`)).json()
  try {
    await fn({
      daemon,
      filePath,
      post,
      get,
      edit: (path, value, extra = {}) => post('/edit', { path, value, ...extra }),
      doc: () => parse(readFileSync(filePath, 'utf8')),
      state: () => get('/undo-state') as Promise<{ canUndo: boolean; canRedo: boolean; undoCount: number; redoCount: number }>,
    })
  } finally {
    await daemon.close()
  }
}

// ---------------------------------------------------------------------------------------------
// Push semantics (research/28 §5.1)
// ---------------------------------------------------------------------------------------------

test('undo: a fresh daemon has an empty stack and /undo is a no-op that still reports state', async () => {
  await withDaemon(async ({ post, state, daemon }) => {
    assert.deepEqual(await state(), { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 })
    const undone = await post('/undo')
    assert.equal(undone.undone, false)
    assert.ok(undone.doc, 'an empty-stack undo still returns the current document')
    assert.equal(undone.canUndo, false)
    const redone = await post('/redo')
    assert.equal(redone.redone, false)
    assert.equal(daemon.getUndoDepth(), 0)
    assert.equal(daemon.getRedoDepth(), 0)
  })
})

test('undo: each distinct edit pushes exactly one snapshot, and a no-op edit pushes none', async () => {
  await withDaemon(async ({ edit, daemon, state }) => {
    assert.equal((await edit('bpm', '124')).written, true)
    assert.equal(daemon.getUndoDepth(), 1)

    // Different path, so a different coalescing key => a new step even inside the window.
    assert.equal((await edit('loop_bars', '2')).written, true)
    assert.equal(daemon.getUndoDepth(), 2)

    // Writing the SAME value again is canonically identical => no write, no undo entry. This is
    // writeIfChanged's canonical-to-canonical compare, and it is what keeps a GUI that re-sends
    // its current state from poisoning the stack with empty steps.
    assert.equal((await edit('loop_bars', '2')).written, false)
    assert.equal(daemon.getUndoDepth(), 2)

    assert.deepEqual(await state(), { canUndo: true, canRedo: false, undoCount: 2, redoCount: 0 })
  })
})

test('undo: mutating routes other than /edit push too (the writeIfChanged choke point)', async () => {
  await withDaemon(async ({ post, daemon }) => {
    // Effect ops carry no coalescing key at all — each is its own one-shot structural step.
    await post('/effect-add', { track: 'lead', type: 'eq7' })
    assert.equal(daemon.getUndoDepth(), 1)
    await post('/effect-add', { track: 'lead', type: 'autoPan' })
    assert.equal(daemon.getUndoDepth(), 2)
    await post('/effect-remove', { track: 'lead', id: 'eq7' })
    assert.equal(daemon.getUndoDepth(), 3)
  })
})

// ---------------------------------------------------------------------------------------------
// Gesture coalescing (research/28 §5.3)
// ---------------------------------------------------------------------------------------------

test('undo: repeated edits to the SAME path inside the coalesce window are one step', async () => {
  await withDaemon(async ({ edit, daemon, doc }) => {
    // A knob drag: many debounced /edit calls, one path, well inside UNDO_COALESCE_MS.
    for (const v of ['121', '122', '123', '124', '125']) await edit('bpm', v)
    assert.equal(daemon.getUndoDepth(), 1, 'a drag is ONE undo step, not five')
    assert.equal(doc().bpm, 125)
  })
})

test('undo: the same path AFTER the coalesce window starts a new step', async () => {
  await withDaemon(async ({ edit, daemon }) => {
    await edit('bpm', '121')
    assert.equal(daemon.getUndoDepth(), 1)
    await delay(UNDO_COALESCE_MS + 120)
    await edit('bpm', '122')
    assert.equal(daemon.getUndoDepth(), 2, 'a separate gesture on the same knob is a separate step')
  })
})

test('undo: a client gestureId coalesces edits across DIFFERENT paths (research/89)', async () => {
  await withDaemon(async ({ edit, daemon }) => {
    // A diagonal note move touches .start and .pitch; without a shared gestureId that would be two
    // undo entries and one Ctrl+Z would revert half the gesture.
    const gestureId = 'g-diagonal-1'
    await edit('bpm', '130', { gestureId })
    await edit('loop_bars', '4', { gestureId })
    await edit('selected_track', 'beat', { gestureId })
    assert.equal(daemon.getUndoDepth(), 1, 'one gestureId => one undo entry across three paths')

    // A different gestureId is a different gesture.
    await edit('bpm', '131', { gestureId: 'g-diagonal-2' })
    assert.equal(daemon.getUndoDepth(), 2)
  })
})

test('undo: the bare .note/.hit APPEND grammar never coalesces, even with a gestureId', async () => {
  await withDaemon(async ({ edit, daemon, doc }) => {
    // Every call mints a brand-new entity, so two quick adds sharing the literal path string are
    // two distinct gestures — coalescing them would silently drop the first add from the stack.
    await edit('lead.note', '60 0 4 1')
    await edit('lead.note', '62 4 4 1')
    await edit('lead.note', '64 8 4 1', { gestureId: 'try-to-coalesce-me' })
    assert.equal(daemon.getUndoDepth(), 3, 'three appends are three undo steps')
    assert.equal(doc().tracks.find((t) => t.id === 'lead')!.notes.length, 3)

    await edit('beat.hit', 'snare 8 1')
    await edit('beat.hit', 'snare 12 1')
    assert.equal(daemon.getUndoDepth(), 5)
  })
})

// Phase 30 (M8): coalescing identity includes the SURFACE, not just the key.
test('undo: an agent edit never coalesces into a human GUI drag on the same path', async () => {
  await withDaemon(async ({ edit, daemon, post, doc }) => {
    // A GUI knob drag on lead.cutoff (no Origin header => surface 'cli' by daemonSurface's rules,
    // so pin it explicitly to 'gui' via the body's self-attribution field).
    await edit('lead.cutoff', '7000', { source: 'gui' })
    await edit('lead.cutoff', '6000', { source: 'gui' })
    assert.equal(daemon.getUndoDepth(), 1, 'the drag itself still coalesces into one step')

    // An agent edits the SAME path 100ms later — well inside UNDO_COALESCE_MS, but a separate
    // deliberate action on a different surface. Merging them would make one Ctrl+Z revert both.
    await delay(100)
    await edit('lead.cutoff', '2000', { source: 'mcp' })
    assert.equal(daemon.getUndoDepth(), 2, 'the mcp edit is its OWN undo step, not a drag continuation')

    await post('/undo')
    assert.equal(
      doc().tracks.find((t) => t.id === 'lead')!.synth.cutoff,
      6000,
      'one undo lands on where the human left the knob (6000), not all the way back past the drag',
    )
  })
})

test('undo: same-surface repeated edits still coalesce (the surface namespace is not a blanket split)', async () => {
  await withDaemon(async ({ edit, daemon }) => {
    for (const v of ['7000', '6000', '5000']) await edit('lead.cutoff', v, { source: 'mcp' })
    assert.equal(daemon.getUndoDepth(), 1, 'an agent burst on one path is one gesture, same as a GUI drag')
  })
})

// ---------------------------------------------------------------------------------------------
// Undo / redo navigation
// ---------------------------------------------------------------------------------------------

test('undo/redo: walks the stack, moves entries between the two, and writes the file each way', async () => {
  await withDaemon(async ({ edit, post, doc, daemon, state }) => {
    await edit('bpm', '130')
    await delay(UNDO_COALESCE_MS + 120)
    await edit('bpm', '140')
    assert.equal(daemon.getUndoDepth(), 2)
    assert.equal(doc().bpm, 140)

    const u1 = await post('/undo')
    assert.equal(u1.undone, true)
    assert.equal(u1.doc.bpm, 130, '/undo returns the full raw document it landed on')
    assert.equal(doc().bpm, 130, 'and writes it to disk')
    assert.deepEqual(await state(), { canUndo: true, canRedo: true, undoCount: 1, redoCount: 1 })

    const u2 = await post('/undo')
    assert.equal(u2.undone, true)
    assert.equal(doc().bpm, 120, 'back to the seed document')
    assert.deepEqual(await state(), { canUndo: false, canRedo: true, undoCount: 0, redoCount: 2 })

    assert.equal((await post('/undo')).undone, false, 'nothing left to undo')

    assert.equal((await post('/redo')).doc.bpm, 130)
    assert.equal((await post('/redo')).doc.bpm, 140)
    assert.equal(doc().bpm, 140)
    assert.deepEqual(await state(), { canUndo: true, canRedo: false, undoCount: 2, redoCount: 0 })
    assert.equal((await post('/redo')).redone, false)
  })
})

test('undo: navigating breaks gesture coalescing, so the next edit is its own step', async () => {
  await withDaemon(async ({ edit, post, daemon }) => {
    await edit('bpm', '130')
    assert.equal(daemon.getUndoDepth(), 1)
    await post('/undo')
    assert.equal(daemon.getUndoDepth(), 0)
    // Same path, still inside the 700ms window — but /undo cleared lastUndoKey, so this must push
    // rather than silently extend the gesture that was just undone.
    await edit('bpm', '131')
    assert.equal(daemon.getUndoDepth(), 1, 'the edit after an undo always starts a fresh step')
  })
})

// ---------------------------------------------------------------------------------------------
// Supersede: a fresh edit invalidates the redo branch (research/28 §5.1)
// ---------------------------------------------------------------------------------------------

test('undo: a new edit after an undo SUPERSEDES the redo branch (latest wins)', async () => {
  await withDaemon(async ({ edit, post, daemon, state }) => {
    await edit('bpm', '130')
    await delay(UNDO_COALESCE_MS + 120)
    await edit('bpm', '140')
    await post('/undo')
    await post('/undo')
    assert.equal(daemon.getRedoDepth(), 2)

    await edit('bpm', '150')
    assert.equal(daemon.getRedoDepth(), 0, 'branching off the undone timeline discards the redo branch')
    assert.deepEqual(await state(), { canUndo: true, canRedo: false, undoCount: 1, redoCount: 0 })
    assert.equal((await post('/redo')).redone, false)
  })
})

test('undo: a coalesced continuation does NOT clear the redo branch a fresh edit would', async () => {
  // The redo-clear lives inside the `if (!coalesced)` arm, so an in-flight gesture extending itself
  // leaves redo alone. Pinned because it is the one asymmetry between the two arms that is easy to
  // lose in the R5-F5 session.ts extraction.
  await withDaemon(async ({ edit, post, daemon }) => {
    await edit('bpm', '130')
    await post('/undo')
    assert.equal(daemon.getRedoDepth(), 1)
    // /undo cleared lastUndoKey, so this first call is NOT coalesced and does clear redo…
    await edit('loop_bars', '3')
    assert.equal(daemon.getRedoDepth(), 0)
    // …and this one, same key inside the window, is coalesced and pushes nothing new.
    const before = daemon.getUndoDepth()
    await edit('loop_bars', '4')
    assert.equal(daemon.getUndoDepth(), before)
  })
})

// ---------------------------------------------------------------------------------------------
// External-write invalidation (research/28 §3)
// ---------------------------------------------------------------------------------------------

test('undo: an external write to the file clears BOTH stacks (external state is authoritative)', async () => {
  await withDaemon(async ({ edit, post, filePath, daemon, get, state }) => {
    await edit('bpm', '130')
    await delay(UNDO_COALESCE_MS + 120)
    await edit('bpm', '140')
    await post('/undo')
    assert.equal(daemon.getUndoDepth(), 1)
    assert.equal(daemon.getRedoDepth(), 1)

    // A hand edit / CLI call / other process lands on disk. The in-session snapshots are only
    // meaningful relative to a history the daemon observed; restoring one now could discard
    // content nobody asked to discard, so both stacks are dropped.
    const external = serialize({ ...parse(readFileSync(filePath, 'utf8')), bpm: 90 })
    writeFileSync(filePath, external)
    await delay(400) // the watcher debounces at 60ms

    assert.equal(daemon.getUndoDepth(), 0, 'undo stack cleared by the external write')
    assert.equal(daemon.getRedoDepth(), 0, 'redo stack cleared too')
    assert.deepEqual(await state(), { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 })
    assert.equal((await get('/document')).bpm, 90, 'and the external document is adopted')
  })
})

test('undo: an external write that is a canonical NO-OP leaves the stacks intact', async () => {
  await withDaemon(async ({ edit, filePath, daemon }) => {
    await edit('bpm', '130')
    assert.equal(daemon.getUndoDepth(), 1)
    // Rewriting the identical bytes is the daemon's own write echoing back; it must not be
    // mistaken for a foreign edit.
    writeFileSync(filePath, readFileSync(filePath, 'utf8'))
    await delay(400)
    assert.equal(daemon.getUndoDepth(), 1, 'an echo of our own bytes is not an external change')
  })
})

test('undo: an external write of UNPARSEABLE text neither adopts nor clears', async () => {
  await withDaemon(async ({ edit, filePath, daemon, get }) => {
    await edit('bpm', '130')
    const good = readFileSync(filePath, 'utf8')
    writeFileSync(filePath, 'format_version 0.11\nbpm not-a-number\n')
    await delay(400)
    assert.equal(daemon.getUndoDepth(), 1, 'a half-saved hand edit is normal, not a reason to drop history')
    assert.equal((await get('/document')).bpm, 130, 'the last good document keeps being served')
    writeFileSync(filePath, good) // leave the file valid for teardown
    await delay(200)
  })
})

// ---------------------------------------------------------------------------------------------
// Phase 30 (M2): the external write that lands INSIDE the watcher's debounce window.
//
// The three tests above all wait 400ms for the 60ms-debounced watcher to notice. The bug was
// everything that happens before that: an external write followed within ~0-80ms by a daemon write
// was overwritten outright, and `lastFileText` was reset to the daemon's own text so the watcher
// never fired the §3 invalidation either — undo stayed armed over a history that had diverged.
// The daemon now re-reads before every write; on a mismatch it adopts the external state FIRST and
// rejects the racing edit with 409 + {conflict:true} (documented choice: reject, never merge).
// ---------------------------------------------------------------------------------------------

/** POST that keeps the status code — the shared `post` helper only returns the parsed body. */
async function postStatus(port: number, path: string, body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

/** The external write the repro uses: bpm 90 plus an extra note nobody must be allowed to lose. */
function externalEdit(filePath: string): string {
  const cur = parse(readFileSync(filePath, 'utf8'))
  const next = addHit({ ...cur, bpm: 90 }, 'beat', { lane: 'snare', start: 2, velocity: 1 }).doc
  const text = serialize(next)
  writeFileSync(filePath, text)
  return text
}

// The repro's own timing sweep. Whether a given delay lands inside or outside the 60ms debounce is
// a scheduling detail, so the assertion is the invariant that holds either way: the external write
// is never destroyed and undo is never left armed across it. 0/30ms are additionally pinned to 409
// (deterministically inside the window) — that is the branch the fix added.
for (const raceMs of [0, 30, 55, 80, 150]) {
  test(`undo: an external write ${raceMs}ms before a GUI edit is never clobbered`, async () => {
    await withDaemon(async ({ edit, filePath, daemon, doc }) => {
      await edit('bpm', '130') // arm the undo stack so the §3 clear is observable
      assert.equal(daemon.getUndoDepth(), 1)

      externalEdit(filePath)
      if (raceMs > 0) await delay(raceMs)
      const onDisk = readFileSync(filePath, 'utf8')

      const res = await postStatus(daemon.port, '/edit', { path: 'lead.cutoff', value: '4000' })

      // Invariant, both branches: the external musical content is still there.
      assert.equal(doc().bpm, 90, 'the external bpm survived')
      assert.equal(doc().tracks.find((t) => t.id === 'beat')!.hits.length, 2, 'the external hit survived')

      if (res.status === 409) {
        // Inside the debounce: the edit was computed against a document that no longer existed.
        assert.equal(res.body.conflict, true, 'the rejection is machine-readable so a client can retry')
        assert.equal(readFileSync(filePath, 'utf8'), onDisk, 'the external bytes are untouched on disk')
        assert.equal(daemon.getUndoDepth(), 0, 'research/28 §3 fires INSIDE the debounce window too')
        assert.equal(daemon.getRedoDepth(), 0)
      } else {
        // The watcher already adopted the external write, so this edit is honest work on top of it.
        assert.equal(res.status, 200)
        assert.equal(doc().tracks.find((t) => t.id === 'lead')!.synth.cutoff, 4000)
        assert.equal(daemon.getUndoDepth(), 1, 'the pre-external stack was cleared; only this edit remains')
      }
      if (raceMs <= 30) assert.equal(res.status, 409, 'a same-tick race is always a conflict')
    })
  })
}

test('undo: after a 409 the retry succeeds against the adopted state', async () => {
  await withDaemon(async ({ edit, filePath, daemon, doc }) => {
    externalEdit(filePath)
    assert.equal((await postStatus(daemon.port, '/edit', { path: 'lead.cutoff', value: '4000' })).status, 409)
    // Second attempt: the daemon has already adopted the external document, so nothing is stale.
    assert.equal((await edit('lead.cutoff', '4000')).written, true)
    assert.equal(doc().tracks.find((t) => t.id === 'lead')!.synth.cutoff, 4000, 'the retried edit lands')
    assert.equal(doc().bpm, 90, 'on top of the external change, not instead of it')
    assert.equal(doc().tracks.find((t) => t.id === 'beat')!.hits.length, 2)
  })
})

test('undo: a whole-document POST /state push cannot overwrite a racing external write either', async () => {
  await withDaemon(async ({ get, filePath, daemon }) => {
    const payload = await get('/doc') // the sandbox-shaped projection the GUI pushes back
    externalEdit(filePath)
    const before = readFileSync(filePath, 'utf8')
    const res = await postStatus(daemon.port, '/state', { ...payload, bpm: 155 })
    assert.equal(res.status, 409, 'the most destructive route gets the same guard')
    assert.equal(res.body.conflict, true)
    assert.equal(readFileSync(filePath, 'utf8'), before, 'external bytes untouched')
  })
})

test('undo: /undo inside the debounce window invalidates instead of restoring over an external write', async () => {
  await withDaemon(async ({ edit, filePath, daemon, post }) => {
    await edit('bpm', '130')
    assert.equal(daemon.getUndoDepth(), 1)
    const before = externalEdit(filePath)

    const undone = await post('/undo')
    assert.equal(undone.undone, false, 'the stack was invalidated by the external write, so there is nothing to undo')
    assert.equal(daemon.getUndoDepth(), 0)
    assert.equal(readFileSync(filePath, 'utf8'), before, 'and no snapshot was written over the external state')
  })
})

test('undo: a no-op edit computed against stale state still conflicts rather than reporting success', async () => {
  await withDaemon(async ({ edit, filePath, daemon }) => {
    await edit('bpm', '130')
    externalEdit(filePath) // moves bpm to 90
    // "bpm 130" is a no-op against the daemon's STALE canonical text but a real change against
    // disk. Answering `{written:false}` here would be a lie the caller acts on.
    const res = await postStatus(daemon.port, '/edit', { path: 'bpm', value: '130' })
    assert.equal(res.status, 409)
    assert.equal(daemon.getUndoDepth(), 0)
  })
})

// ---------------------------------------------------------------------------------------------
// Bounded depth (research/28 §5.4)
// ---------------------------------------------------------------------------------------------

test('undo: the stack is bounded at UNDO_MAX and drops the OLDEST entry', async () => {
  await withDaemon(async ({ edit, daemon, post, doc }) => {
    // Distinct paths so nothing coalesces: one note append per step, each its own gesture.
    for (let i = 0; i < UNDO_MAX + 5; i++) await edit('lead.note', `${60 + (i % 12)} ${i} 1 1`)
    assert.equal(daemon.getUndoDepth(), UNDO_MAX, 'depth is capped')

    // Unwinding the whole capped stack cannot reach the original empty-notes document — the five
    // oldest snapshots were dropped, which is the documented trade (research/28 §5.4).
    for (let i = 0; i < UNDO_MAX; i++) await post('/undo')
    assert.equal(daemon.getUndoDepth(), 0)
    assert.equal(doc().tracks.find((t) => t.id === 'lead')!.notes.length, 5, 'the five oldest steps are gone for good')
  })
})
