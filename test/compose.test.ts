// The compose-from-scratch primitives (beat init / add-track / rm-track) — the gap the
// Claude-over-MCP session exposed: an agent could edit a project but not start one.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse, serialize, initDocument, addTrack, removeTrack, addNote, setValue, BeatEditError } from '../src/core/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

function beat(args: string[], opts: { expectExit?: number } = {}): string {
  try {
    return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    if (opts.expectExit !== undefined && e.status === opts.expectExit) return (e.stdout ?? '') + (e.stderr ?? '')
    throw new Error(`beat ${args.join(' ')} exited ${e.status}:\n${e.stderr ?? ''}${e.stdout ?? ''}`)
  }
}

test('initDocument produces a valid, round-trippable document with one starter track', () => {
  const doc = initDocument({ bpm: 124, loopBars: 4 })
  assert.equal(doc.bpm, 124)
  assert.equal(doc.tracks.length, 1)
  assert.equal(doc.selectedTrack, doc.tracks[0]!.id)
  assert.deepEqual(parse(serialize(doc)), doc)
  assert.throws(() => initDocument({ bpm: 7 }), BeatEditError)
  assert.throws(() => initDocument({ loopBars: 0 }), BeatEditError)
})

test('addTrack: defaults, palette cycling, drums get an empty 16-step pattern, dup ids rejected', () => {
  let doc = initDocument()
  const first = addTrack(doc, { id: 'bass', kind: 'synth' })
  doc = first.doc
  assert.equal(first.track.name, 'bass')
  const drums = addTrack(doc, { id: 'drums', kind: 'drums' })
  doc = drums.doc
  assert.deepEqual(drums.track.hits, []) // v0.8: fresh drum tracks start with no hits
  assert.notEqual(first.track.color, drums.track.color, 'palette cycles')
  assert.deepEqual(parse(serialize(doc)), doc, 'round-trips with all three tracks')
  assert.throws(() => addTrack(doc, { id: 'bass', kind: 'synth' }), BeatEditError)
  assert.throws(() => addTrack(doc, { id: 'bad id', kind: 'synth' }), BeatEditError)
  assert.throws(() => addTrack(doc, { id: 'x', kind: 'sampler' as never }), BeatEditError)
})

test('removeTrack: selection falls back, last track is protected', () => {
  let doc = initDocument({ trackId: 'lead' })
  doc = addTrack(doc, { id: 'bass', kind: 'synth' }).doc
  doc = { ...doc, selectedTrack: 'bass' }
  const removed = removeTrack(doc, 'bass')
  assert.equal(removed.doc.selectedTrack, 'lead')
  assert.throws(() => removeTrack(removed.doc, 'lead'), /last track/)
})

test('the full compose-from-nothing flow builds a valid groove (core level)', () => {
  let doc = initDocument({ bpm: 126, loopBars: 1, trackId: 'bass' })
  doc = addTrack(doc, { id: 'drums', kind: 'drums' }).doc
  doc = setValue(doc, 'drums.pattern.kick[0]', '0.9')
  doc = setValue(doc, 'drums.pattern.kick[8]', '0.9')
  doc = setValue(doc, 'drums.pattern.hat[4]', '0.6')
  doc = setValue(doc, 'bass.cutoff', '700')
  doc = addNote(doc, 'bass', { pitch: 33, start: 0, duration: 4, velocity: 0.85 }).doc
  doc = addNote(doc, 'bass', { pitch: 36, start: 8, duration: 4, velocity: 0.8 }).doc
  const text = serialize(doc)
  assert.equal(serialize(parse(text)), text, 'canonical round-trip is idempotent')
  assert.match(text, /^ {2}hit kick0 kick 0 0\.9$/m)
  assert.match(text, /^ {2}hit kick8 kick 8 0\.9$/m)
  assert.match(text, /^ {2}note u\d+ 33 0 4 0\.85$/m)
})

test('the same flow through the CLI: init -> add-track -> set -> add-note, all edit-listed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-compose-'))
  const file = join(dir, 'new.beat')
  const init = beat(['init', file, '--bpm', '126', '--bars', '1'])
  assert.match(init, /created .*126 bpm, 1 bar/)
  assert.match(beat(['add-track', file, 'drums', 'drums']), /^drums: track added \(drums "drums", 0 hits\)\n$/)
  assert.match(beat(['set', file, 'drums.pattern.kick[0]', '0.9']), /kick hit added/)
  assert.match(beat(['add-note', file, 'lead', '64', '0', '2', '0.8']), /note added/)
  const doc = parse(readFileSync(file, 'utf8'))
  assert.equal(doc.tracks.length, 2)
  // init refuses to overwrite
  const refuse = beat(['init', file], { expectExit: 2 })
  assert.match(refuse, /refusing to overwrite/)
})
