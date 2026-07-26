// Writer-side validation tests for src/core/edit.ts — the permanent home for adversarial hunt #2's
// class-B repros (rt2-writer-corrupt.mjs, rt2b.mjs, rt3-names-mcp.mjs, rt4-groups.mjs, mcp3-set.mjs).
//
// THE INVARIANT UNDER TEST, one sentence: **every state a public writer will produce must be a
// state parse() accepts.** A `beat set` / MCP / daemon edit that "succeeds" and leaves a file the
// project's own parser rejects is the worst failure mode this codebase has — the project is bricked
// and every subsequent command, including the one that would undo it, fails on load.
//
// Three ways that invariant was broken, all found end-to-end against real files:
//   1. int/float mismatch — setValue accepted a fractional bpm/loop_bars, parse requires integers.
//   2. validate-raw-then-store-canon — writers range-checked the caller's raw number and then
//      stored canon() of it, rounding straight through the boundary they had just validated.
//   3. empty names — "" passed the whitespace check and dropped a token from the serialized line.
//
// So every case here asserts BOTH halves: the bad edit throws BeatEditError, AND the neighbouring
// good edit still round-trips. A guard that rejects everything would pass half a suite.

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import readline from 'node:readline'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  BeatEditError,
  addGroup,
  addHit,
  addNote,
  addTrack,
  initDocument,
  parse,
  renameGroup,
  saveClip,
  serialize,
  setClipLoop,
  setValue,
  type BeatDocument,
} from '../src/core/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root

const synthDoc = (): BeatDocument => initDocument({ trackId: 't1' })
const drumDoc = (): BeatDocument => addTrack(initDocument({ trackId: 't1' }), { id: 'd1', kind: 'drums' }).doc
const twoTrackDoc = (): BeatDocument => addTrack(initDocument({ trackId: 't1' }), { id: 't2', kind: 'synth' }).doc

/** The invariant itself, as an assertion: this document's canonical bytes load back into exactly
 * this document. Both halves matter — `parse` not throwing proves the file isn't bricked, and the
 * deep-equal proves nothing was silently rounded away on the way out. */
function assertRoundTrips(doc: BeatDocument, what: string) {
  let reparsed: BeatDocument
  try {
    reparsed = parse(serialize(doc))
  } catch (err) {
    assert.fail(`${what}: a writer produced a document whose serialized form does not parse — ${(err as Error).message}`)
  }
  assert.deepEqual(reparsed, doc, `${what}: parse(serialize(doc)) != doc`)
}

// ---------------------------------------------------------------------------
// 1. int/float mismatch — `beat set <file> bpm 60.5` (hunt #2's confirmed brick)
// ---------------------------------------------------------------------------

test('setValue bpm rejects anything parse would reject: fractional, zero, negative, absurd', () => {
  const doc = synthDoc()
  for (const bad of ['60.5', '0.0000001', '119.9999']) {
    assert.throws(() => setValue(doc, 'bpm', bad), /bpm must be a whole number/, `bpm ${bad}`)
  }
  for (const bad of ['0', '-10', '19', '1000']) {
    assert.throws(() => setValue(doc, 'bpm', bad), /bpm must be an integer 20-999/, `bpm ${bad}`)
  }
  assert.throws(() => setValue(doc, 'bpm', 'fast'), /expected a number/)
  // and the good edit still works, at both ends of the range
  for (const ok of ['20', '124', '999']) {
    const next = setValue(doc, 'bpm', ok)
    assert.equal(next.bpm, Number(ok))
    assertRoundTrips(next, `bpm ${ok}`)
  }
})

test('setValue loop_bars rejects anything parse would reject', () => {
  const doc = synthDoc()
  assert.throws(() => setValue(doc, 'loop_bars', '2.5'), /loop_bars must be a whole number/)
  for (const bad of ['0', '-4', '65', '100000000']) {
    assert.throws(() => setValue(doc, 'loop_bars', bad), /loop_bars must be an integer 1-64/, `loop_bars ${bad}`)
  }
  for (const ok of ['1', '8', '64']) {
    const next = setValue(doc, 'loop_bars', ok)
    assert.equal(next.loopBars, Number(ok))
    assertRoundTrips(next, `loop_bars ${ok}`)
  }
})

test('e2e: a rejected `beat set bpm 60.5` leaves the project loadable and editable', () => {
  // The live repro: `beat set t1 bpm 60.5` used to succeed and then EVERY later command on that
  // file — including `beat set bpm 120`, i.e. the fix — failed with `line 2: bpm expected an
  // integer`. Driven through the real CLI because that is the surface that bricked a real project.
  const dir = mkdtempSync(join(tmpdir(), 'beat-core-edit-'))
  const file = join(dir, 'p.beat')
  writeFileSync(file, serialize(initDocument({ trackId: 'lead' })))
  const before = readFileSync(file, 'utf8')

  let status = 0
  try {
    execFileSync(process.execPath, [join(repoRoot, 'cli', 'beat.mjs'), 'set', file, 'bpm', '60.5'], { encoding: 'utf8', stdio: 'pipe' })
  } catch (err) {
    status = (err as { status?: number }).status ?? 0
  }
  assert.notEqual(status, 0, 'beat set bpm 60.5 must exit non-zero')
  assert.equal(readFileSync(file, 'utf8'), before, 'a rejected edit must not touch the file')

  execFileSync(process.execPath, [join(repoRoot, 'cli', 'beat.mjs'), 'set', file, 'bpm', '128'], { encoding: 'utf8', stdio: 'pipe' })
  assert.equal(parse(readFileSync(file, 'utf8')).bpm, 128, 'the project must still be editable afterwards')
})

test('e2e: MCP beat_set refuses the same fractional bpm, as a string AND as a JSON number', async () => {
  // The second surface hunt #2 confirmed the brick on. beat_set stringifies its value and calls
  // the same setValue, so this is a parity check: an agent must not be able to reach through MCP
  // and write a file the CLI could not have written.
  const dir = mkdtempSync(join(tmpdir(), 'beat-core-edit-mcp-'))
  const file = join(dir, 'p.beat')
  writeFileSync(file, serialize(initDocument({ trackId: 'lead' })))

  const proc = spawn(process.execPath, [join(repoRoot, 'cli', 'beat.mjs'), 'mcp'], { stdio: ['pipe', 'pipe', 'ignore'] })
  try {
    const lines = readline.createInterface({ input: proc.stdout! })
    const pending = new Map<number, (m: any) => void>()
    lines.on('line', (l) => {
      try {
        const m = JSON.parse(l)
        pending.get(m.id)?.(m)
      } catch {
        /* the server may emit non-JSON noise; ignore */
      }
    })
    let id = 0
    const call = (method: string, params: unknown) =>
      new Promise<any>((resolve) => {
        const i = ++id
        pending.set(i, resolve)
        proc.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id: i, method, params })}\n`)
      })

    await call('initialize', {})
    for (const value of ['60.5', 60.5 as unknown as string]) {
      const res = await call('tools/call', { name: 'beat_set', arguments: { file, edits: [{ path: 'bpm', value }] } })
      assert.equal(res.result?.isError, true, `beat_set bpm ${value} must be an error`)
      assert.match(res.result.content[0].text, /whole number/)
      assert.equal(parse(readFileSync(file, 'utf8')).bpm, 120, 'the file must be untouched by a rejected edit')
    }
  } finally {
    proc.kill()
  }
})

// ---------------------------------------------------------------------------
// 2. validate-raw-then-store-canon — a value rounded through its own guard
// ---------------------------------------------------------------------------
// 0.00001 is the probe throughout: strictly inside every "> 0" guard, and exactly 0 once
// formatNumber's 4-decimal rounding has had it.

test('addHit velocity/duration are checked at the precision they are stored at', () => {
  const doc = drumDoc()
  assert.throws(() => addHit(doc, 'd1', { lane: 'kick', start: 0, velocity: 0.00001 }), /velocity must be in \(0, 1\]/)
  assert.throws(() => addHit(doc, 'd1', { lane: 'kick', start: 0, velocity: 0.5, duration: 0.00001 }), /duration must be > 0 steps/)
  assert.throws(() => addHit(doc, 'd1', { lane: 'kick', start: 0, velocity: Number.NaN }), /velocity must be in \(0, 1\]/)
  // the smallest velocity that SURVIVES rounding is accepted and round-trips
  const ok = addHit(doc, 'd1', { lane: 'kick', start: 0.0625, velocity: 0.0001, duration: 0.0001 }).doc
  assertRoundTrips(ok, 'addHit at canonical resolution')
})

test('the <track>.hit setValue path inherits the same guard', () => {
  assert.throws(() => setValue(drumDoc(), 'd1.hit', 'kick 0 0.00001'), /velocity must be in \(0, 1\]/)
  assertRoundTrips(setValue(drumDoc(), 'd1.hit', 'kick 0 0.9'), 'd1.hit')
})

test('setClipLoop rejects a range that rounds to empty', () => {
  const doc = saveClip(synthDoc(), 't1', 'c1').doc
  assert.throws(() => setClipLoop(doc, 't1', 'c1', { start: 0, end: 0.00003 }), /loop end must be > start/)
  assert.throws(() => setValue(doc, 't1.clip.c1.loop', '0 0.00003'), /loop end must be > start/)
  assertRoundTrips(setClipLoop(doc, 't1', 'c1', { start: 0, end: 4 }), 'clip loop 0..4')
})

test('addNote ratchetLength (and its neighbours) are checked post-rounding', () => {
  const doc = synthDoc()
  const note = { pitch: 60, start: 0, duration: 1, velocity: 0.5 }
  assert.throws(() => addNote(doc, 't1', { ...note, ratchetLength: 0.00001 }), /ratchetLength must be >0\.\.1/)
  assert.throws(() => addNote(doc, 't1', { ...note, duration: 0.00001 }), /duration must be > 0 steps/)
  assertRoundTrips(addNote(doc, 't1', { ...note, ratchetLength: 0.25, cent: 12.3456, ratchetCurve: -0.5 }).doc, 'addNote optionals')
})

test('setValue shuffleGrid rejects a grid that rounds to zero', () => {
  const doc = setValue(synthDoc(), 't1.shuffleAmount', '0.5')
  assert.throws(() => setValue(doc, 't1.shuffleGrid', '0.00001'), /shuffleGrid must be > 0/)
  assertRoundTrips(setValue(doc, 't1.shuffleGrid', '2'), 'shuffleGrid 2')
})

test('a shuffleAmount below canonical resolution stores as off, and stays off', () => {
  // Finding 8's writer-side twin: whatever is stored must be what a reload gives back, first try.
  const doc = setValue(synthDoc(), 't1.shuffleAmount', '0.00001')
  assert.equal(doc.tracks[0]!.shuffleAmount, 0)
  assertRoundTrips(doc, 'shuffleAmount 0.00001')
})

test('a pattern step below canonical resolution is off, not a velocity-0 hit', () => {
  const doc = setValue(drumDoc(), 'd1.pattern.kick[0]', '0.00001')
  assert.equal(doc.tracks[1]!.hits.length, 0, 'a step that rounds to 0 must not write a hit line')
  assertRoundTrips(doc, 'pattern step 0.00001')
  assertRoundTrips(setValue(drumDoc(), 'd1.pattern.kick[0]', '0.8'), 'pattern step 0.8')
})

// ---------------------------------------------------------------------------
// 3. empty names — one token too FEW on the serialized line
// ---------------------------------------------------------------------------

test('an empty track name is rejected on every path that can write one', () => {
  assert.throws(() => setValue(synthDoc(), 't1.name', ''), /track names can't be empty/)
  assert.throws(() => addTrack(synthDoc(), { id: 't2', kind: 'synth', name: '' }), /track names can't be empty/)
  // the pre-existing whitespace rule is untouched
  assert.throws(() => setValue(synthDoc(), 't1.name', 'two words'), /single tokens/)
  assertRoundTrips(setValue(synthDoc(), 't1.name', 'Lead_2'), 'track rename')
})

test('an empty group name is rejected on add and on rename', () => {
  const doc = twoTrackDoc()
  assert.throws(() => addGroup(doc, { id: 'g1', name: '', trackIds: ['t1', 't2'] }), /group names can't be empty/)
  const grouped = addGroup(doc, { id: 'g1', name: 'drums-bus', trackIds: ['t1', 't2'] }).doc
  assert.throws(() => renameGroup(grouped, 'g1', ''), /group names can't be empty/)
  assert.throws(() => renameGroup(grouped, 'g1', 'two words'), /single tokens/)
  assertRoundTrips(renameGroup(grouped, 'g1', 'bus'), 'group rename')
})

test('BeatEditError is what every one of these throws (callers switch on it)', () => {
  const cases: (() => unknown)[] = [
    () => setValue(synthDoc(), 'bpm', '60.5'),
    () => setValue(synthDoc(), 'loop_bars', '0'),
    () => setValue(synthDoc(), 't1.name', ''),
    () => addHit(drumDoc(), 'd1', { lane: 'kick', start: 0, velocity: 0.00001 }),
    () => setClipLoop(saveClip(synthDoc(), 't1', 'c1').doc, 't1', 'c1', { start: 0, end: 0.00003 }),
    () => addNote(synthDoc(), 't1', { pitch: 60, start: 0, duration: 1, velocity: 0.5, ratchetLength: 0.00001 }),
    () => setValue(synthDoc(), 't1.shuffleGrid', '0.00001'),
    () => addGroup(twoTrackDoc(), { id: 'g1', name: '', trackIds: ['t1'] }),
  ]
  for (const fn of cases) assert.throws(fn, BeatEditError)
})
