import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse, initDocument, serialize } from '../src/core/index.js'
import { readFileSync } from 'node:fs'
import { resolveProjectFile, ProjectError } from '../src/daemon/project.js'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'beat-project-'))
}

// A minimal-but-valid .beat, built in-memory so the test doesn't depend on file layout under dist/.
const BEAT_TEXT = serialize(initDocument({}))

test('existing .beat file is used as-is', () => {
  const dir = tmp()
  const file = join(dir, 'song.beat')
  writeFileSync(file, BEAT_TEXT)
  const r = resolveProjectFile(file)
  assert.equal(r.filePath, file)
  assert.equal(r.dir, dir)
  assert.equal(r.created, false)
})

test('folder with exactly one .beat opens it', () => {
  const dir = tmp()
  const file = join(dir, 'mytune.beat')
  writeFileSync(file, BEAT_TEXT)
  const r = resolveProjectFile(dir)
  assert.equal(r.filePath, file)
  assert.equal(r.created, false)
})

test('empty folder gets a starter project.beat created', () => {
  const dir = tmp()
  const r = resolveProjectFile(dir)
  assert.equal(r.filePath, join(dir, 'project.beat'))
  assert.equal(r.created, true)
  // The starter file parses and has the init track.
  const doc = parse(readFileSync(r.filePath, 'utf8'))
  assert.ok(doc.tracks.length >= 1)
})

test('non-existent folder is created with a starter project', () => {
  const base = tmp()
  const dir = join(base, 'newproject')
  const r = resolveProjectFile(dir)
  assert.equal(existsSync(dir), true)
  assert.equal(r.filePath, join(dir, 'project.beat'))
  assert.equal(r.created, true)
})

test('non-existent .beat path is created (with parents)', () => {
  const base = tmp()
  const file = join(base, 'nested', 'a.beat')
  const r = resolveProjectFile(file)
  assert.equal(r.filePath, file)
  assert.equal(r.created, true)
  assert.ok(existsSync(file))
})

test('folder with several .beats prefers project.beat', () => {
  const dir = tmp()
  writeFileSync(join(dir, 'a.beat'), BEAT_TEXT)
  writeFileSync(join(dir, 'project.beat'), BEAT_TEXT)
  const r = resolveProjectFile(dir)
  assert.equal(r.filePath, join(dir, 'project.beat'))
  assert.equal(r.created, false)
})

test('folder with several ambiguous .beats throws', () => {
  const dir = tmp()
  writeFileSync(join(dir, 'a.beat'), BEAT_TEXT)
  writeFileSync(join(dir, 'b.beat'), BEAT_TEXT)
  assert.throws(() => resolveProjectFile(dir), ProjectError)
})

test('create:false on an empty folder throws instead of creating', () => {
  const dir = tmp()
  assert.throws(() => resolveProjectFile(dir, { create: false }), ProjectError)
})

test('a non-.beat file is rejected', () => {
  const dir = tmp()
  const file = join(dir, 'notes.txt')
  writeFileSync(file, 'hello')
  assert.throws(() => resolveProjectFile(file), ProjectError)
})
