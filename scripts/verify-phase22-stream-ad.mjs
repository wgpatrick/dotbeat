#!/usr/bin/env node
// Live, CLI-level verification for Phase 22 Stream AD (Pitch & Time / groove / chance / ratchet).
// Drives the REAL `beat` CLI end-to-end (not core functions directly) against a scratch project,
// exactly the way an agent would, and asserts on both the printed diff output and the resulting
// .beat text. Complements (does not replace) `npm test`'s unit coverage — see test/groove.test.ts,
// test/chance.test.ts, test/pitchtime.test.ts, test/format-v10.test.ts.
//
// Usage: npm run build && node scripts/verify-phase22-stream-ad.mjs

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const beat = join(repoRoot, 'cli', 'beat.mjs')
const dir = mkdtempSync(join(tmpdir(), 'dotbeat-verify-ad-'))
const file = join(dir, 'song.beat')

let checks = 0
function ok(label) {
  checks++
  console.log(`  ok — ${label}`)
}

function run(...args) {
  return execFileSync(process.execPath, [beat, ...args], { encoding: 'utf8', cwd: dir })
}

function leadNoteIds() {
  const doc = JSON.parse(run('inspect', file, '--json'))
  return doc.tracks.find((t) => t.id === 'lead').notes.map((n) => n.id)
}

try {
  // ---- setup: a fresh project with two notes we can operate on ------------------------------
  run('init', file, '--bpm', '120', '--bars', '1')
  run('add-note', file, 'lead', '60', '0', '2', '0.8')
  run('add-note', file, 'lead', '64', '4', '2', '0.7')
  const before = readFileSync(file, 'utf8')

  // ---- 1. a Pitch & Time operation rewrites the expected note lines with a clean diff --------
  console.log('1. transpose +7 semitones')
  const transposeOut = run('transpose', file, 'lead', '7')
  assert.match(transposeOut, /lead: note \S+ pitch 60 -> 67/, 'diff names the exact pitch change')
  assert.match(transposeOut, /lead: note \S+ pitch 64 -> 71/, 'diff names the exact pitch change')
  const afterTranspose = readFileSync(file, 'utf8')
  assert.match(afterTranspose, /note \S+ 67 0 2 0\.8\n/, 'note line literally rewritten to pitch 67')
  assert.match(afterTranspose, /note \S+ 71 4 2 0\.7\n/, 'note line literally rewritten to pitch 71')
  // the diff is CLEAN: only the pitch tokens changed, nothing else on any line moved
  const stripPitch = (text) => text.split('\n').map((l) => l.replace(/^(  note \S+) \d+/, '$1 <P>'))
  assert.deepEqual(stripPitch(before), stripPitch(afterTranspose), 'every other token on every line is byte-identical')
  ok('transpose rewrote exactly the pitch tokens; diff names the exact before -> after')

  console.log('2. reverse the two-note span')
  run('reverse', file, 'lead')
  const afterReverse = readFileSync(file, 'utf8')
  assert.match(afterReverse, /note \S+ 71 0 2 0\.7\n/, 'the later note now starts at the span start')
  assert.match(afterReverse, /note \S+ 67 4 2 0\.8\n/, 'the earlier note now starts where the span used to end')
  ok('reverse produced the exact expected discrete note lines (a tape-reverse of the span)')

  // ---- 2. chance: verify the RNG logic directly against the seeded sequence (the task's own
  // documented alternative to a slow render-100-times statistical check) ---------------------
  console.log('3. chance RNG — seeded sequence, not a live render')
  const { chanceFires } = await import(join(repoRoot, 'dist', 'src', 'core', 'chance.js'))
  let fired = 0
  const passes = 1000
  for (let pass = 0; pass < passes; pass++) if (chanceFires(50, pass, 'lead', 'n1')) fired++
  const rate = fired / passes
  assert.ok(rate > 0.4 && rate < 0.6, `chance=50 should fire ~50% of ${passes} passes, got ${(rate * 100).toFixed(1)}%`)
  assert.equal(chanceFires(100, 0, 'lead', 'n1'), true, 'chance=100 always fires')
  assert.equal(chanceFires(0, 0, 'lead', 'n1'), false, 'chance=0 never fires')
  ok(`chance=50 fired ${(rate * 100).toFixed(1)}% of ${passes} seeded passes (expected ~50%)`)

  // ---- 3. ratchet consolidate produces the EXACT expected discrete notes --------------------
  console.log('4. ratchet consolidate — exact expected discrete notes')
  for (const id of leadNoteIds()) run('rm-note', file, 'lead', id)
  run('add-note', file, 'lead', '60', '2', '4', '0.9')
  const [noteId] = leadNoteIds()
  run('set', file, `lead.note.${noteId}.ratchetCount`, '4', `lead.note.${noteId}.ratchetCurve`, '0', `lead.note.${noteId}.ratchetLength`, '1')
  run('consolidate', file, 'lead')
  const afterConsolidate = readFileSync(file, 'utf8')
  const noteLines = afterConsolidate
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('note'))
  assert.equal(noteLines.length, 4, 'exactly ratchetCount discrete notes')
  // curve=0 (even spacing), length=1 (fills each slot), count=4, a 4-step note starting at step 2
  // -> four 1-step-long notes at steps 2, 3, 4, 5.
  const gotStarts = noteLines.map((l) => Number(l.split(/\s+/)[3])).sort((a, b) => a - b)
  assert.deepEqual(gotStarts, [2, 3, 4, 5], 'exact expected start positions')
  for (const l of noteLines) assert.match(l, /^note \S+ 60 \S+ 1 0\.9/, 'exact expected pitch/duration/velocity on every consolidated note')
  ok('consolidate(count=4, curve=0, length=1) on a 4-step note produced exactly 4 one-step notes at steps 2,3,4,5')

  // ---- 4. groove: set via the CLI, round-trips exactly ---------------------------------------
  console.log('5. groove set + round trip')
  run('set', file, 'lead.shuffleAmount', '0.6', 'lead.shuffleGrid', '1')
  const withGroove = readFileSync(file, 'utf8')
  assert.match(withGroove, /  groove 0\.6 1\n/, 'groove line written exactly as expected')
  ok('groove line present and exact after `beat set <track>.shuffleAmount/<track>.shuffleGrid`')

  console.log(`\n${checks} checks passed.`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
