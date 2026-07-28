// `beat diff --since <ref>` + `--rollup` — research/128 §2.3 (the agent's morning read of an owner
// GUI session). Two halves: showFileAt resolving BOTH a checkpoint ref and a pin NAME against a
// real history repo (--since's resolution), and rollupDiff collapsing/clustering/ordering plus a
// stable --json shape (the rollup's grouping).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkpoint, pin, history, showFileAt, HistoryError } from '../src/history/index.js'
import { initDocument, setValue, serialize, parse, diffDocuments, rollupDiff, type DiffEntry } from '../src/core/index.js'

function project(mutate?: (d: ReturnType<typeof initDocument>) => ReturnType<typeof initDocument>): string {
  const dir = mkdtempSync(join(tmpdir(), 'beat-since-'))
  const file = join(dir, 'song.beat')
  const doc = initDocument({ trackId: 'lead' })
  writeFileSync(file, serialize(mutate ? mutate(doc) : doc))
  return file
}

test('diff --since resolves a checkpoint REF: showFileAt returns the file as of that ref', () => {
  const file = project()
  const c1 = checkpoint(file) // bpm 120
  assert.equal(c1.skipped, false)
  // move on
  writeFileSync(file, serialize(setValue(parse(readFileSync(file, 'utf8')), 'bpm', '140')))
  checkpoint(file)
  writeFileSync(file, serialize(setValue(parse(readFileSync(file, 'utf8')), 'bpm', '160')))

  const asOfC1 = parse(showFileAt(file, (c1 as { ref: string }).ref))
  assert.equal(asOfC1.bpm, 120, 'the ref state is the checkpoint-1 bpm, not the working-tree 160')
})

test('diff --since defaults to the LAST checkpoint when no ref is given', () => {
  // Mirrors the CLI default-ref path: history(file, {limit:1})[0].ref -> showFileAt.
  const file = project()
  checkpoint(file) // bpm 120
  writeFileSync(file, serialize(setValue(parse(readFileSync(file, 'utf8')), 'bpm', '150')))
  const latest = history(file, { limit: 1 })[0]!
  const asOf = parse(showFileAt(file, latest.ref))
  assert.equal(asOf.bpm, 120, 'the latest checkpoint is the default --since baseline, not the working tree')
})

test('diff --since resolves a PIN NAME (with spaces) to its saved version', () => {
  const file = project()
  const c1 = checkpoint(file)
  pin(file, (c1 as { ref: string }).ref, 'the good bridge') // -> tag pin/the-good-bridge
  // change the working tree afterward
  writeFileSync(file, serialize(setValue(parse(readFileSync(file, 'utf8')), 'bpm', '200')))

  const asOfPin = parse(showFileAt(file, 'the good bridge'))
  assert.equal(asOfPin.bpm, 120, 'a pin name resolves via its pin/<slug> tag')
})

test('showFileAt throws a helpful error on an unknown ref/pin', () => {
  const file = project()
  checkpoint(file)
  assert.throws(() => showFileAt(file, 'no-such-thing'), HistoryError)
})

test('rollup collapses repeated same-path edits into one net row with a tweakCount', () => {
  // A hand-built stream (as a gesture/telemetry feed would produce): cutoff wiggled 3x, ends at 850.
  const entries: DiffEntry[] = [
    { kind: 'synth-param', trackId: 'bass', param: 'cutoff', before: 750, after: 800 },
    { kind: 'synth-param', trackId: 'bass', param: 'cutoff', before: 800, after: 820 },
    { kind: 'synth-param', trackId: 'bass', param: 'cutoff', before: 820, after: 850 },
    { kind: 'synth-param', trackId: 'bass', param: 'resonance', before: 0.1, after: 0.2 },
  ]
  const r = rollupDiff(entries)
  assert.equal(r.tracks.length, 1)
  const bass = r.tracks[0]!
  const cutoff = bass.params.find((p) => p.path === 'bass.cutoff')!
  assert.ok(cutoff, 'cutoff collapses to a single param row')
  assert.equal(cutoff.before, 750, 'keeps the FIRST before')
  assert.equal(cutoff.after, 850, 'keeps the LAST after')
  assert.equal(cutoff.tweakCount, 3, 'counts the folded edits — the struggle signal')
  // ordered by tweaks: cutoff (3) before resonance (1)
  assert.equal(bass.params[0]!.path, 'bass.cutoff')
})

test('rollup clusters note edits per track and bar, and orders tracks by edit mass', () => {
  const entries: DiffEntry[] = [
    // lead: a note moved in bar 1 (step 4 -> 8) and one added in bar 2 (step 20)
    { kind: 'note-changed', trackId: 'lead', noteId: 'u1', changes: [{ field: 'start', before: 4, after: 8 }] },
    { kind: 'note-added', trackId: 'lead', note: { id: 'u2', pitch: 60, start: 20, duration: 4, velocity: 0.8, chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1, active: true } },
    // pad: one tiny param tweak
    { kind: 'synth-param', trackId: 'pad', param: 'volume', before: -10, after: -8 },
  ]
  const r = rollupDiff(entries)
  assert.equal(r.tracks[0]!.trackId, 'lead', 'the most-edited track comes first')
  const leadNotes = r.tracks[0]!.notes.find((n) => n.scope === 'note')!
  assert.equal(leadNotes.moved, 1)
  assert.equal(leadNotes.added, 1)
  assert.deepEqual(leadNotes.bars, [1, 2], '1-indexed bars from the note positions')
})

test('--json rollup shape is stable (the fields the agent consumes)', () => {
  const before = initDocument({ trackId: 'lead' })
  const after = setValue(setValue(before, 'bpm', '128'), 'lead.cutoff', '1200')
  const r = rollupDiff(diffDocuments(before, after))
  // top-level shape
  assert.deepEqual(Object.keys(r).sort(), ['global', 'header', 'totalEntries', 'tracks'])
  assert.equal(r.totalEntries, 2)
  // header carries the bpm net
  assert.equal(r.header.find((p) => p.path === 'bpm')!.after, 128)
  // a param roll's shape
  const p = r.tracks[0]!.params[0]!
  assert.deepEqual(Object.keys(p).sort(), ['after', 'before', 'op', 'path', 'tweakCount'])
})
