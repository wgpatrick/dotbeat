// Tests for the figureSource split (audit 140 D7) — the readout research 124 and 125 were both
// built to be measured by, and which did not exist.
//
// The interesting properties are the ones that made the gap survivable: a figure source with zero
// rated batches has to be VISIBLE (CA2 shipped a 716 MB model and a Python sidecar and has never
// appeared in a single rated batch — an empty row you scroll past is how that stayed unnoticed), and
// an unrecognised label has to bucket rather than vanish.

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  FIGURE_SOURCES,
  UNLABELLED,
  figureSourceByBatch,
  figureSourceSplit,
  formatFigureSourceSplit,
} from '../src/taste/figure-source-report.js'

/** One scores-log line in the shape scoreBatch writes for a showdown batch. */
const entry = (o: {
  batch: string
  role?: string
  picks: string[]
  rejected?: string[]
  sources: Record<string, string>
  figureSource?: string
  t?: string
}) =>
  JSON.stringify({
    t: o.t ?? '2026-07-26T00:00:00.000Z',
    batch: o.batch,
    group: `showdown:${o.role ?? 'lead'}`,
    seed: 1,
    parentSha256: 'x',
    picks: o.picks.map((variant, i) => ({ rank: i + 1, variant })),
    rejected: o.rejected ?? [],
    sources: o.sources,
    ...(o.figureSource !== undefined ? { figureSource: o.figureSource } : {}),
  })

function logWith(lines: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'figsrc-'))
  const p = join(dir, 'beat-scores.jsonl')
  writeFileSync(p, lines.join('\n') + '\n')
  return p
}

const TWO = { 'v1.wav': 'ref', 'v2.wav': 'engine' }

test('splits the scoreboard by figureSource, with the same tally math as the overall board', () => {
  const p = logWith([
    entry({ batch: 'b1', picks: ['v1.wav', 'v2.wav'], sources: TWO, figureSource: 'theory' }),
    entry({ batch: 'b2', picks: ['v1.wav', 'v2.wav'], sources: TWO, figureSource: 'theory' }),
    entry({ batch: 'b3', picks: ['v2.wav', 'v1.wav'], sources: TWO, figureSource: 'bank' }),
  ])
  const r = figureSourceSplit(p)
  const theory = r.groups.find((g) => g.figureSource === 'theory')!
  const bank = r.groups.find((g) => g.figureSource === 'bank')!
  assert.equal(theory.batches, 2)
  assert.equal(bank.batches, 1)
  // ref won both theory batches and lost the bank one
  assert.equal(theory.stats.find((s) => s.kind === 'ref')!.wins, 2)
  assert.equal(bank.stats.find((s) => s.kind === 'ref')!.wins, 0)
  assert.equal(bank.stats.find((s) => s.kind === 'engine')!.wins, 1)
  assert.equal(r.labelled, 3)
  assert.equal(r.unlabelled, 0)
})

test('a figure source that was BUILT but never rated is reported, not silently absent', () => {
  const p = logWith([entry({ batch: 'b1', picks: ['v1.wav', 'v2.wav'], sources: TWO, figureSource: 'theory' })])
  const r = figureSourceSplit(p)
  assert.ok(r.neverRated.includes('ca2'), 'ca2 shipped and has no rated batch — that is the finding')
  assert.ok(r.neverRated.includes('bank'))
  assert.ok(!r.neverRated.includes('theory'))
  assert.match(formatFigureSourceSplit(r), /NEVER RATED: .*ca2/)
})

test('batches with no figureSource bucket under a named label instead of disappearing', () => {
  const p = logWith([
    entry({ batch: 'b1', picks: ['v1.wav', 'v2.wav'], sources: TWO, figureSource: 'midi' }),
    entry({ batch: 'b2', picks: ['v1.wav', 'v2.wav'], sources: TWO }),
    entry({ batch: 'b3', picks: ['v1.wav', 'v2.wav'], sources: TWO }),
  ])
  const r = figureSourceSplit(p)
  assert.equal(r.labelled, 1)
  assert.equal(r.unlabelled, 2)
  assert.equal(r.groups.find((g) => g.figureSource === UNLABELLED)!.batches, 2)
  // and the unlabelled bucket sorts LAST, after every declared label
  assert.equal(r.groups[r.groups.length - 1]!.figureSource, UNLABELLED)
})

test('an unrecognised figureSource label still gets a row', () => {
  // The failure this whole module exists to fix is a field nobody reads. A label the code does not
  // know about must be loud, not dropped on the floor.
  const p = logWith([entry({ batch: 'b1', picks: ['v1.wav', 'v2.wav'], sources: TWO, figureSource: 'someNewLayer' })])
  const r = figureSourceSplit(p)
  assert.ok(r.groups.some((g) => g.figureSource === 'someNewLayer'))
})

test('the LAST entry per batch wins, matching the shared reader supersede convention', () => {
  const p = logWith([
    entry({ batch: 'b1', picks: ['v1.wav', 'v2.wav'], sources: TWO, figureSource: 'bank', t: '2026-07-26T00:00:00.000Z' }),
    entry({ batch: 'b1', picks: ['v1.wav', 'v2.wav'], sources: TWO, figureSource: 'theory', t: '2026-07-26T01:00:00.000Z' }),
  ])
  assert.equal(figureSourceByBatch(p).get('b1'), 'theory')
  const r = figureSourceSplit(p)
  assert.equal(r.groups.length, 1)
  assert.equal(r.groups[0]!.figureSource, 'theory')
  assert.equal(r.groups[0]!.batches, 1, 're-scoring a batch must not double-count it')
})

test('thin arms are labelled SMOKE rather than read as results', () => {
  const p = logWith([entry({ batch: 'b1', picks: ['v1.wav', 'v2.wav'], sources: TWO, figureSource: 'theory' })])
  const r = figureSourceSplit(p)
  assert.equal(r.groups[0]!.smoke, true)
  assert.match(formatFigureSourceSplit(r), /SMOKE/)
})

test('the transpose lines up one source kind across figure sources', () => {
  const p = logWith([
    entry({ batch: 'b1', picks: ['v1.wav', 'v2.wav'], sources: TWO, figureSource: 'theory' }),
    entry({ batch: 'b2', picks: ['v2.wav', 'v1.wav'], sources: TWO, figureSource: 'bank' }),
  ])
  const r = figureSourceSplit(p)
  const engine = r.byKind.find((k) => k.kind === 'engine')!
  assert.deepEqual(engine.rows.map((x) => x.figureSource), ['theory', 'bank'])
  assert.match(formatFigureSourceSplit(r), /same source kind across figure sources/)
})

test('a missing log is empty, not a throw', () => {
  const r = figureSourceSplit(join(tmpdir(), 'definitely-not-a-log-xyz.jsonl'))
  assert.equal(r.labelled, 0)
  assert.deepEqual(r.groups, [])
  assert.deepEqual([...r.neverRated].sort(), [...FIGURE_SOURCES].sort())
  assert.match(formatFigureSourceSplit(r), /nothing to split/)
})
