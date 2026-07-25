// beat board — the non-blind production picking surface (research/128 §2.1). Covers the decision
// core (src/board/decisions.ts) and the `beat board --status` CLI: append-only decision log,
// decided-batch scan, the reject-all-needs-a-note rule, decision.json as the per-batch answer, and
// the SEPARATION invariant — a board decision never lands in beat-scores.jsonl.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  recordPick,
  recordRejectAll,
  decidedBatchDirs,
  readDecisionFile,
  DEFAULT_DECISIONS_LOG,
} from '../src/board/decisions.js'
import { BeatBatchError } from '../src/vary/batch.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const exampleBeat = join(repoRoot, 'examples', 'real-groove.beat')

function beat(args: string[], opts: { cwd?: string; expectExit?: number } = {}): string {
  try {
    return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8', cwd: opts.cwd })
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    if (opts.expectExit !== undefined && e.status === opts.expectExit) return (e.stdout ?? '') + (e.stderr ?? '')
    throw new Error(`beat ${args.join(' ')} exited ${e.status}:\n${e.stderr ?? ''}${e.stdout ?? ''}`)
  }
}

/** A minimal 44-byte silent WAV so findBoardBatches (which requires a rendered wav per variant)
 * sees the batch as auditionable, without paying for a real headless render. decodeWav tolerates
 * it as immeasurable, so features are simply absent — exactly the un-decodable-render path. */
function touchDummyWav(path: string): void {
  const buf = Buffer.alloc(44)
  buf.write('RIFF', 0); buf.writeUInt32LE(36, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(44100, 24); buf.writeUInt32LE(88200, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(0, 40)
  writeFileSync(path, buf)
}

/** A real decodable 16-bit stereo WAV of a short sine tone — so computeBatchFeatures produces an
 * actual feature vector without a headless render (the engine/ui isn't built in unit-test env). */
function writeSineWav(path: string, freq = 220): void {
  const sr = 44100, n = Math.floor(sr * 0.2)
  const buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) {
    const s = Math.round(Math.sin((2 * Math.PI * freq * i) / sr) * 12000)
    buf.writeInt16LE(s, 44 + i * 4); buf.writeInt16LE(s, 44 + i * 4 + 2)
  }
  writeFileSync(path, buf)
}

/** A project with two vary batches ready to decide on (each variant given a placeholder render so
 * it shows up as a board). */
function projectWithBatches(): { dir: string; file: string; batchA: string; batchB: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beat-board-test-'))
  const file = join(dir, 'song.beat')
  copyFileSync(exampleBeat, file)
  const batchA = join(dir, 'vary-filter-7')
  const batchB = join(dir, 'vary-env-9')
  beat(['vary', file, 'lead', 'filter', '--count', '3', '--seed', '7', '--out-dir', batchA])
  beat(['vary', file, 'lead', 'env', '--count', '2', '--seed', '9', '--out-dir', batchB])
  for (const n of [1, 2, 3]) touchDummyWav(join(batchA, `v${n}.wav`))
  for (const n of [1, 2]) touchDummyWav(join(batchB, `v${n}.wav`))
  return { dir, file, batchA, batchB }
}

test('recordPick writes an append-only log entry + decision.json (the per-batch answer)', () => {
  const { dir, batchA, batchB } = projectWithBatches()
  const log = join(dir, DEFAULT_DECISIONS_LOG)

  const r = recordPick(batchA, 'v2', { note: 'warmest of the three' }, log)
  assert.equal(r.logPath, log)
  assert.equal(r.entry.decision, 'pick')
  assert.deepEqual(r.entry.picks, [{ rank: 1, variant: 'v2.beat' }])
  assert.equal(r.entry.rejected.length, 2, 'the two non-picks are recorded as rejected')
  assert.equal(r.entry.note, 'warmest of the three')
  assert.equal(r.entry.nonBlind, true)

  // decision.json is the agent-readable answer
  const df = readDecisionFile(batchA)!
  assert.equal(df.decision, 'pick')
  assert.equal(df.pick, 'v2.beat')
  assert.equal(df.note, 'warmest of the three')
  assert.equal(df.board_id, 'vary-filter-7')

  // append-only: a second decision on ANOTHER batch adds a line, never rewrites
  recordPick(batchB, '1', {}, log)
  const lines = readFileSync(log, 'utf8').trim().split('\n')
  assert.equal(lines.length, 2, 'two entries appended')
  assert.equal((JSON.parse(lines[0]!) as { batch: string }).batch, batchA)
})

test('recordPick carries a provenance snapshot + measured features (trainable accept/reject label)', () => {
  const { dir, batchA } = projectWithBatches()
  const log = join(dir, DEFAULT_DECISIONS_LOG)
  // give the variants real (decodable) renders so features are computed
  for (const n of [1, 2, 3]) writeSineWav(join(batchA, `v${n}.wav`), 110 * n)
  const r = recordPick(batchA, 'v1', {}, log)
  assert.ok(r.entry.provenance['v1.beat'], 'winner has a provenance snapshot')
  // param vary variants carry replayable edits
  assert.ok(r.entry.provenance['v2.beat']!.edits, 'a rejected variant keeps its edits provenance')
  assert.ok(r.entry.features && r.entry.features['v1.beat'], 'rendered variants carry a feature vector')
  assert.ok(typeof r.entry.features!['v1.beat']!.lufs === 'number')
})

test('recordRejectAll REQUIRES a note (the reject-with-feedback rule) and rejects every candidate', () => {
  const { dir, batchA } = projectWithBatches()
  const log = join(dir, DEFAULT_DECISIONS_LOG)

  assert.throws(() => recordRejectAll(batchA, '', log), BeatBatchError)
  assert.throws(() => recordRejectAll(batchA, '   ', log), (e: Error) => /reject-all needs a note/.test(e.message))
  assert.ok(!existsSync(log), 'a refused reject-all writes nothing')
  assert.equal(readDecisionFile(batchA), null, 'and no decision.json')

  const r = recordRejectAll(batchA, 'all too bright, need darker', log)
  assert.equal(r.entry.decision, 'reject-all')
  assert.equal(r.entry.picks.length, 0)
  assert.equal(r.entry.rejected.length, 3, 'every candidate rejected')
  assert.ok(r.entry.rejected.every((x) => x.note === 'all too bright, need darker'))
  const df = readDecisionFile(batchA)!
  assert.equal(df.decision, 'reject-all')
  assert.equal(df.none, 'all too bright, need darker', 'reject-all fills the doc-128 none slot')
})

test('decidedBatchDirs scans the log; SKIP leaves a batch undecided', () => {
  const { dir, batchA, batchB } = projectWithBatches()
  const log = join(dir, DEFAULT_DECISIONS_LOG)
  assert.equal(decidedBatchDirs(log).size, 0, 'empty/absent log => nothing decided')

  recordPick(batchA, 'v1', {}, log)
  const decided = decidedBatchDirs(log)
  assert.ok(decided.has(resolve(batchA)), 'the picked batch is decided')
  assert.ok(!decided.has(resolve(batchB)), 'the untouched (skipped) batch stays undecided')
})

test('a board decision never contaminates beat-scores.jsonl (the separation invariant)', () => {
  const { dir, batchA } = projectWithBatches()
  const decisionsLog = join(dir, DEFAULT_DECISIONS_LOG)
  recordPick(batchA, 'v2', { note: 'this one' }, decisionsLog)
  assert.ok(existsSync(decisionsLog), 'decisions land in beat-decisions.jsonl')
  assert.ok(!existsSync(join(dir, 'beat-scores.jsonl')), 'and NOTHING is written to beat-scores.jsonl')
})

// ---- CLI: beat board --status -----------------------------------------------------------------

test('beat board --status reports decided/undecided + decisions, and --json is machine-readable', () => {
  const { dir, batchA, batchB } = projectWithBatches()
  const log = join(dir, DEFAULT_DECISIONS_LOG)
  recordPick(batchA, 'v3', { note: 'brightest' }, log)

  const status = beat(['board', dir, '--status'])
  assert.match(status, /1 decided, 1 undecided \(2 total\)/)
  assert.match(status, /\[x\].*pick v3\.beat.*"brightest"/)
  assert.match(status, /\[ \]/, 'the skipped/undecided batch shows an empty box')

  const json = JSON.parse(beat(['board', dir, '--status', '--json'])) as {
    decided: number
    undecided: number
    batches: { batch: string; decided: boolean; decision: { decision: string; pick?: string } | null }[]
  }
  assert.equal(json.decided, 1)
  assert.equal(json.undecided, 1)
  const decidedBatch = json.batches.find((b) => b.decided)!
  assert.equal(decidedBatch.batch, batchA)
  assert.equal(decidedBatch.decision!.pick, 'v3.beat')
  const undecided = json.batches.find((b) => !b.decided)!
  assert.equal(undecided.batch, batchB)
  assert.equal(undecided.decision, null)
})

test('beat board --status --json on a fresh dir reports everything undecided', () => {
  const { dir } = projectWithBatches()
  const json = JSON.parse(beat(['board', dir, '--status', '--json'])) as { decided: number; undecided: number }
  assert.equal(json.decided, 0)
  assert.equal(json.undecided, 2)
})

test('beat board rejects an unknown flag loudly (pilot 112 stance)', () => {
  const { dir } = projectWithBatches()
  const out = beat(['board', dir, '--prot', '4322'], { expectExit: 2 })
  assert.match(out, /unknown flag "--prot"/)
})
