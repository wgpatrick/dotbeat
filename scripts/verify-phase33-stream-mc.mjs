#!/usr/bin/env node
// Live, CLI-level verification for Phase 33 Stream MC (docs/phase-33-plan.md's "MC — Error
// handling: stack-trace leaks + beat suggest validation gaps", sourced from usability pilots 96
// and 98). Drives the REAL `beat` CLI end-to-end against disposable scratch projects (never
// examples/night-shift-song.beat) and asserts on real stdout/stderr/exit codes, not just source
// reading. Covers all 4 items from the plan's MC section:
//   1. beat score on a bad batch-dir path used to throw a raw ENOENT stack trace.
//   2. beat humanize --timing -1 used to throw a raw uncaught BeatHumanizeError stack trace.
//   3. beat diff --git with a bad git rev used to throw a raw git-show child_process error.
//   4. beat suggest's cold-start recommendation used to ignore track kind (recommending a
//      drum-only group like "kick" for a synth track) and skip track-existence validation.
//
// Usage: npm run build && node scripts/verify-phase33-stream-mc.mjs

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const beat = join(repoRoot, 'cli', 'beat.mjs')
const dir = mkdtempSync(join(tmpdir(), 'dotbeat-verify-mc-'))
const file = join(dir, 'song.beat')

let checks = 0
function ok(label) {
  checks++
  console.log(`  ok — ${label}`)
}

function run(...args) {
  return execFileSync(process.execPath, [beat, ...args], { encoding: 'utf8', cwd: dir })
}

/** Run a command expected to fail; returns {stdout, stderr, status} instead of throwing. */
function runExpectFail(...args) {
  try {
    const stdout = run(...args)
    throw new Error(`expected "${args.join(' ')}" to fail, but it exited 0 with stdout:\n${stdout}`)
  } catch (err) {
    if (err.status === undefined) throw err // a genuine JS error above, not a child-process failure
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', status: err.status }
  }
}

/** A raw Node stack trace looks like "Error: ...\n    at functionName (file:///...)" or
 * "SomeError: ...\n    at ...". A clean CLI error is a single "error: ..." line (± usage dump)
 * with no "\n    at " frame anywhere and no leaked absolute file:// path. */
function assertNoStackTrace(stderr, label) {
  assert.ok(!/\n\s*at /.test(stderr), `${label}: stderr must not contain a stack-trace frame ("at ..."); got:\n${stderr}`)
  assert.ok(!/file:\/\//.test(stderr), `${label}: stderr must not leak a file:// path; got:\n${stderr}`)
  assert.match(stderr, /^error: /m, `${label}: stderr must contain a clean "error: ..." line; got:\n${stderr}`)
}

try {
  // ---- setup: a fresh project with a synth track (lead) and a drums track -------------------
  run('init', file, '--bpm', '120', '--bars', '2')
  run('add-note', file, 'lead', '60', '0', '2', '0.8')
  run('add-track', file, 'drums', 'drums')
  run('add-hit', file, 'drums', 'kick', '0', '0.9')

  // =========================================================================================
  // Item 1: three commands used to leak raw Node stack traces instead of clean `error: ...`
  // =========================================================================================

  // ---- 1a. beat score on a bad batch-dir path (research/96) ---------------------------------
  console.log('1a. beat score <nonexistent-batch-dir> 1 — clean error, no stack trace')
  const scoreFail = runExpectFail('score', join(dir, 'vary-filter-nonexistent'), '1')
  assert.equal(scoreFail.status, 2, 'score on a bad batch-dir exits 2')
  assertNoStackTrace(scoreFail.stderr, 'beat score bad batch-dir')
  assert.match(scoreFail.stderr, /no such batch directory|could not read/, 'error names the actual problem')
  ok(`score on a nonexistent batch dir fails cleanly: ${scoreFail.stderr.trim()}`)

  // ---- 1b. beat humanize --timing -1 (research/98) -------------------------------------------
  console.log('1b. beat humanize <file> lead --timing -1 — clean error, no stack trace')
  const humanizeFail = runExpectFail('humanize', file, 'lead', '--timing', '-1')
  assert.equal(humanizeFail.status, 2, 'humanize --timing -1 exits 2')
  assertNoStackTrace(humanizeFail.stderr, 'beat humanize --timing -1')
  assert.match(humanizeFail.stderr, /timing must be >= 0, got -1/, 'error names the actual validation failure')
  ok(`humanize --timing -1 fails cleanly: ${humanizeFail.stderr.trim()}`)
  // file must NOT have been corrupted or modified by the failed humanize
  const afterHumanizeFail = readFileSync(file, 'utf8')
  assert.ok(afterHumanizeFail.includes('note') && afterHumanizeFail.includes('lead'), 'file still intact after failed humanize')

  // ---- 1c. beat diff --git with a bad git rev (research/98) ----------------------------------
  console.log('1c. beat diff --git <bad-rev> HEAD <file> — clean error, no stack trace')
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'test'])
  execFileSync('git', ['-C', dir, 'add', 'song.beat'])
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'initial'])
  const diffFail = runExpectFail('diff', '--git', 'not-a-real-rev', 'HEAD', file)
  assert.equal(diffFail.status, 2, 'diff --git with a bad rev exits 2')
  assertNoStackTrace(diffFail.stderr, 'beat diff --git bad rev')
  assert.match(diffFail.stderr, /git show/, 'error names the failing git operation')
  ok(`diff --git with a bad rev fails cleanly: ${diffFail.stderr.trim()}`)

  // =========================================================================================
  // Item 2: beat suggest's cold-start recommendation now respects track kind
  // =========================================================================================

  console.log('2. beat suggest <file> lead (synth track, cold start) — never recommends a drum-only group')
  const suggestSynth = run('suggest', file, 'lead')
  assert.match(suggestSynth, /recommend: beat vary \S+ lead (\S+)/, 'suggest prints a recommend line')
  const recommendedGroup = suggestSynth.match(/recommend: beat vary \S+ lead (\S+)/)[1]
  assert.ok(!['kick', 'snare', 'hats'].includes(recommendedGroup), `recommended group "${recommendedGroup}" must not be a drum-only group for a synth track`)
  ok(`suggest's cold-start recommendation for synth track "lead" is "${recommendedGroup}" (not a drum-only group)`)

  // Confirm the recommended command actually changes the synth's audible params (not a no-op):
  // run it and diff before/after the lead track's synth block.
  const beforeVary = readFileSync(file, 'utf8')
  run('vary', file, 'lead', recommendedGroup, '--count', '1', '--amount', '0.5', '--seed', '1', '--out-dir', join(dir, 'vary-check'))
  // vary writes variants to a batch dir, not the live file — apply the winning edit for real via
  // `beat set` using the manifest, exactly like a real user's adopt step, to confirm it's a real
  // (non-inert) edit to the live file's synth params.
  const manifest = JSON.parse(readFileSync(join(dir, 'vary-check', 'manifest.json'), 'utf8'))
  assert.ok(manifest.variants[0].edits.length > 0, 'the recommended group produced at least one real edit')
  // manifest edits are "<trackId>.<param> <value>" strings (see varyCmd in cli/beat.mjs)
  const editArgs = manifest.variants[0].edits.flatMap((e) => e.split(' '))
  run('set', file, ...editArgs)
  const afterVary = readFileSync(file, 'utf8')
  assert.notEqual(beforeVary, afterVary, 'applying the recommended group\'s edit actually changed the live file')
  ok(`applying suggest's recommended group ("${recommendedGroup}") produced a real, non-inert edit to lead's synth params`)

  console.log('2b. beat suggest <file> drums (drums track, cold start) — still recommends a legal drum group')
  const suggestDrums = run('suggest', file, 'drums')
  const recommendedDrumGroup = suggestDrums.match(/recommend: beat vary \S+ drums (\S+)/)[1]
  assert.ok(!['osc', 'motion'].includes(recommendedDrumGroup), `recommended group "${recommendedDrumGroup}" must not be a synth-only group for a drums track`)
  ok(`suggest's cold-start recommendation for drums track "drums" is "${recommendedDrumGroup}" (not a synth-only group)`)

  // =========================================================================================
  // Item 3: beat suggest validates track existence, same as beat vary
  // =========================================================================================

  console.log('3. beat suggest <file> bass (no such track) — errors like vary does')
  const varyBadTrack = runExpectFail('vary', file, 'bass', 'filter')
  assert.match(varyBadTrack.stderr, /no track "bass"/, 'vary rejects the unknown track (baseline)')

  const suggestBadTrack = runExpectFail('suggest', file, 'bass')
  assert.equal(suggestBadTrack.status, 2, 'suggest on an unknown track exits 2')
  assert.match(suggestBadTrack.stderr, /no track "bass"/, 'suggest rejects the unknown track the same way vary does')
  assert.match(suggestBadTrack.stderr, /have: lead, drums/, 'error lists the real valid track ids')
  assertNoStackTrace(suggestBadTrack.stderr, 'beat suggest bad track')
  ok(`suggest now rejects an unknown track exactly like vary does: ${suggestBadTrack.stderr.trim()}`)

  console.log(`\n${checks} checks passed.`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
