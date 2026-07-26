// Edit telemetry (research/116 §4, research/128 §2.4). Covers the three properties the spec names:
// the hook fires with the right schema, GUI gesture coalescing yields ONE entry per drag, and the
// log costs nothing when disabled (the opt-in default).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDocument, setValue, serialize } from '../src/core/index.js'
import { startDaemon } from '../src/daemon/daemon.js'
import { recordEdits, noteDaemonEdit, flushEditLog, resetEditLogForTest, editLogEnabled } from '../src/telemetry/index.js'

/** Run `fn` with the telemetry env pointed at a fresh temp log; returns the parsed JSONL entries.
 * Restores env and buffered state afterward so tests don't leak into each other (one process). */
function withLog(enabled: boolean, fn: (logPath: string) => void): Record<string, unknown>[] {
  const dir = mkdtempSync(join(tmpdir(), 'beat-editlog-'))
  const logPath = join(dir, 'edit-log.jsonl')
  const prevEnabled = process.env.BEAT_EDIT_LOG
  const prevFile = process.env.BEAT_EDIT_LOG_FILE
  if (enabled) process.env.BEAT_EDIT_LOG = '1'
  else delete process.env.BEAT_EDIT_LOG
  process.env.BEAT_EDIT_LOG_FILE = logPath
  resetEditLogForTest()
  try {
    fn(logPath)
    flushEditLog()
    if (!existsSync(logPath)) return []
    return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
  } finally {
    if (prevEnabled === undefined) delete process.env.BEAT_EDIT_LOG
    else process.env.BEAT_EDIT_LOG = prevEnabled
    if (prevFile === undefined) delete process.env.BEAT_EDIT_LOG_FILE
    else process.env.BEAT_EDIT_LOG_FILE = prevFile
    resetEditLogForTest()
    rmSync(dir, { recursive: true, force: true })
  }
}

test('recordEdits writes one JSONL entry with the full research/116 schema', () => {
  const entries = withLog(true, () => {
    const before = initDocument()
    const after = setValue(before, 'bpm', '128')
    recordEdits(before, after, { surface: 'cli', file: '/tmp/song.beat' })
  })
  assert.equal(entries.length, 1)
  const e = entries[0]!
  // schema: {t, session, surface, op, path, before, after, file}
  for (const k of ['t', 'session', 'surface', 'op', 'path', 'before', 'after', 'file']) assert.ok(k in e, `missing field ${k}`)
  assert.equal(e.surface, 'cli')
  assert.equal(e.op, 'header')
  assert.equal(e.path, 'bpm')
  assert.equal(e.before, 120)
  assert.equal(e.after, 128)
  assert.equal(e.file, 'song.beat') // basename, not the full path
  assert.match(String(e.t), /^\d{4}-\d{2}-\d{2}T/) // ISO timestamp
  assert.equal(typeof e.session, 'string')
})

test('a knob-drag gesture coalesces to ONE entry spanning the whole drag', () => {
  const entries = withLog(true, () => {
    // Simulate the daemon's per-tick calls for one drag of lead.cutoff: the first tick opens
    // the gesture (coalesced=false), the rest continue it (coalesced=true, same gestureKey).
    const d0 = initDocument()
    const d1 = setValue(d0, 'lead.cutoff', '900')
    const d2 = setValue(d1, 'lead.cutoff', '1500')
    const d3 = setValue(d2, 'lead.cutoff', '2200')
    const key = 'lead.cutoff'
    noteDaemonEdit(d0, d1, { coalesced: false, gestureKey: key, surface: 'gui', file: 'x.beat' })
    noteDaemonEdit(d1, d2, { coalesced: true, gestureKey: key, surface: 'gui', file: 'x.beat' })
    noteDaemonEdit(d2, d3, { coalesced: true, gestureKey: key, surface: 'gui', file: 'x.beat' })
    // (withLog flushes for us)
  })
  assert.equal(entries.length, 1, 'three debounced ticks must collapse into one gesture entry')
  const e = entries[0]!
  assert.equal(e.surface, 'gui')
  assert.equal(e.op, 'synth-param')
  assert.equal(e.path, 'lead.cutoff')
  assert.equal(e.before, 2000, 'before is the value at gesture START (the init cutoff)')
  assert.equal(e.after, 2200, 'after is the value the drag SETTLED on')
})

test('two distinct gestures produce two entries; a one-shot edit flushes immediately', () => {
  const entries = withLog(true, () => {
    const d0 = initDocument()
    const d1 = setValue(d0, 'lead.cutoff', '900')
    // gesture A (a drag)
    noteDaemonEdit(d0, d1, { coalesced: false, gestureKey: 'lead.cutoff', surface: 'gui', file: 'x.beat' })
    // a one-shot structural edit (no gestureKey) — flushes A, then records itself at once
    const d2 = setValue(d1, 'bpm', '140')
    noteDaemonEdit(d1, d2, { coalesced: false, gestureKey: undefined, surface: 'gui', file: 'x.beat' })
  })
  assert.equal(entries.length, 2)
  assert.equal(entries[0]!.op, 'synth-param')
  assert.equal(entries[1]!.op, 'header')
  assert.equal(entries[1]!.path, 'bpm')
})

test('disabled by default: no env, no file, no work', () => {
  assert.equal(editLogEnabled(), false, 'the log is opt-in — off unless BEAT_EDIT_LOG is set')
  const entries = withLog(false, (logPath) => {
    const before = initDocument()
    const after = setValue(before, 'bpm', '200')
    recordEdits(before, after, { surface: 'cli', file: 'x.beat' })
    noteDaemonEdit(before, after, { coalesced: false, gestureKey: 'bpm', surface: 'gui', file: 'x.beat' })
    assert.equal(existsSync(logPath), false, 'nothing should be written when disabled')
  })
  assert.equal(entries.length, 0)
})

// Phase 30 (M8): the coalescing identity the daemon hands this hook is namespaced by SURFACE, so
// an agent's edit can never be recorded as a continuation of a human's in-flight GUI drag. Before
// the fix, an mcp edit on the same path within the 700ms window arrived with `coalesced: true` and
// was folded into the pending 'gui' gesture — the log then claimed the human made it. This is the
// end-to-end version: a real daemon, real HTTP, real log file.
test('an agent edit on a drag\'s path is logged as its OWN mcp entry, not a gui continuation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-editlog-daemon-'))
  const logPath = join(dir, 'edit-log.jsonl')
  const filePath = join(dir, 'song.beat')
  writeFileSync(filePath, serialize(initDocument({ bpm: 120, loopBars: 1, trackId: 'lead' })))
  const prevEnabled = process.env.BEAT_EDIT_LOG
  const prevFile = process.env.BEAT_EDIT_LOG_FILE
  process.env.BEAT_EDIT_LOG = '1'
  process.env.BEAT_EDIT_LOG_FILE = logPath
  resetEditLogForTest()
  const daemon = await startDaemon({ filePath, port: 0 })
  try {
    const edit = (value: string, source: string) =>
      fetch(`http://127.0.0.1:${daemon.port}/edit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'lead.cutoff', value, source }),
      })
    await edit('7000', 'gui') // human drag, tick 1
    await edit('6000', 'gui') // human drag, tick 2 — coalesces into tick 1
    await edit('2000', 'mcp') // an agent, same path, same window, different surface
    flushEditLog()
    const entries = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
    assert.equal(entries.length, 2, 'two gestures, two entries — the agent edit is not swallowed')
    assert.equal(entries[0]!.surface, 'gui')
    assert.equal(entries[0]!.before, 2000, 'the drag entry spans the whole drag: init cutoff…')
    assert.equal(entries[0]!.after, 6000, '…to where the human left it')
    assert.equal(entries[1]!.surface, 'mcp', 'the agent edit is attributed to the agent')
    assert.equal(entries[1]!.before, 6000)
    assert.equal(entries[1]!.after, 2000)
  } finally {
    await daemon.close()
    if (prevEnabled === undefined) delete process.env.BEAT_EDIT_LOG
    else process.env.BEAT_EDIT_LOG = prevEnabled
    if (prevFile === undefined) delete process.env.BEAT_EDIT_LOG_FILE
    else process.env.BEAT_EDIT_LOG_FILE = prevFile
    resetEditLogForTest()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('note-field edits log a beat-set-style dotted path per changed field', () => {
  const entries = withLog(true, () => {
    const before = setValue(initDocument(), 'lead.note', '60 0 4 0.8') // add a note (id u100001)
    const after = setValue(before, 'lead.note.u100001.pitch', '67')
    recordEdits(before, after, { surface: 'cli', file: 'x.beat' })
  })
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.op, 'note-changed')
  assert.equal(entries[0]!.path, 'lead.note.u100001.pitch')
  assert.equal(entries[0]!.before, 60)
  assert.equal(entries[0]!.after, 67)
})
