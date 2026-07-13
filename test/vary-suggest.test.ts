// beat suggest tests — rung 3 of the variation loop (docs/variation-loop.md,
// docs/research/08-variation-loop-prior-art.md). Under test: cold start (no scores log yet),
// the group ranking picked from synthetic beat-scores.jsonl exhaust with a deliberate, checkable
// win pattern, the honestly-labeled Bradley-Terry-odds-form reasoning citing accurate counts,
// the direction-within-group heuristic, the --target focus filter, and parseScoresLog's
// tolerance of blank/malformed lines (an append-only log some tooling may hand-edit).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { suggestNext, parseScoresLog, type ScoreEntry } from '../src/vary/suggest.js'
import { VARY_GROUPS } from '../src/vary/vary.js'

// edits use the real log schema: each pick's edits are "<trackId>.<param> <value>" strings
// (exactly what cli/beat.mjs's varyCmd writes into manifest.json and scoreCmd copies verbatim).
function round(track: string, group: string, pickCount: number, rejectCount: number, edits?: string[][]): ScoreEntry {
  const picks = Array.from({ length: pickCount }, (_, i) => ({
    rank: i + 1,
    variant: `v${i + 1}.beat`,
    ...(edits ? { edits: edits[i] } : {}),
  }))
  const rejected = Array.from({ length: rejectCount }, (_, i) => `v${pickCount + i + 1}.beat`)
  return { track, group, picks, rejected }
}

test('cold start: no entries for the track recommends the first vary.ts group', () => {
  const s = suggestNext([], 'drums', { file: 'song.beat' })
  assert.equal(s.coldStart, true)
  assert.equal(s.totalRounds, 0)
  assert.equal(s.recommendedGroup, Object.keys(VARY_GROUPS)[0])
  assert.match(s.command, /^beat vary song\.beat drums \w+ --amount 0\.25 --seed \d+$/)
  assert.ok(s.reasoning.some((l) => /cold start/.test(l)))
  assert.ok(s.reasoning.some((l) => l === `recommend: ${s.command}`))
})

test('cold start with trackKind "synth" recommends a group legal for synth tracks, not a drum-only one', () => {
  // research/96: suggest's first-ever recommendation for a synth track used to be "kick" (first
  // in VARY_GROUPS's declared order) — a drum-only param group that's a silent no-op on a synth
  // track. With trackKind supplied, the recommendation must come from a group that's actually
  // legal for "synth" (see vary.ts's VARY_GROUP_KINDS: kick/snare/hats are drums-only).
  const s = suggestNext([], 'lead', { file: 'song.beat', trackKind: 'synth' })
  assert.equal(s.coldStart, true)
  assert.notEqual(s.recommendedGroup, 'kick')
  assert.notEqual(s.recommendedGroup, 'snare')
  assert.notEqual(s.recommendedGroup, 'hats')
  assert.match(s.command, /^beat vary song\.beat lead \w+ --amount 0\.25 --seed \d+$/)
  assert.ok(s.reasoning.some((l) => /legal for a "synth" track/.test(l)))
})

test('cold start with trackKind "drums" still recommends the first drums-legal group ("kick")', () => {
  const s = suggestNext([], 'drums', { file: 'song.beat', trackKind: 'drums' })
  assert.equal(s.coldStart, true)
  assert.equal(s.recommendedGroup, 'kick')
})

test('cold start without trackKind falls back to the old kind-agnostic first-group behavior', () => {
  const s = suggestNext([], 'lead', { file: 'song.beat' })
  assert.equal(s.coldStart, true)
  assert.equal(s.recommendedGroup, Object.keys(VARY_GROUPS)[0])
})

test('cold start scoped by track: entries exist, but not for this track', () => {
  const entries = [round('lead', 'filter', 3, 6)]
  const s = suggestNext(entries, 'drums', { file: 'song.beat' })
  assert.equal(s.coldStart, true)
})

test('picks the group with the higher picked-vs-rejected rate, with accurate counts', () => {
  // filter: two rounds, consistently picked well (3/9 each = strong signal)
  // kick: one round, picked weakly (1/9)
  const entries: ScoreEntry[] = [
    round('drums', 'filter', 3, 6),
    round('drums', 'filter', 3, 6),
    round('drums', 'kick', 1, 8),
  ]
  const s = suggestNext(entries, 'drums', { file: 'song.beat', now: 42 })
  assert.equal(s.coldStart, false)
  assert.equal(s.totalRounds, 3)
  assert.equal(s.recommendedGroup, 'filter')
  // stats sorted with filter first, and the raw counts must be exactly right
  const filterStat = s.stats.find((g) => g.group === 'filter')!
  const kickStat = s.stats.find((g) => g.group === 'kick')!
  assert.equal(filterStat.rounds, 2)
  assert.equal(filterStat.wins, 6)
  assert.equal(filterStat.losses, 12)
  assert.equal(kickStat.rounds, 1)
  assert.equal(kickStat.wins, 1)
  assert.equal(kickStat.losses, 8)
  assert.ok(filterStat.strength > kickStat.strength, 'filter must rank above kick')
  // reasoning cites the exact pooled counts (not just a black-box score)
  assert.ok(s.reasoning.some((l) => l.includes('filter: 6/18 variants picked across 2 round(s)')))
  assert.ok(s.reasoning.some((l) => l.includes('kick: 1/9 variants picked across 1 round(s)')))
  assert.ok(s.reasoning.some((l) => /"filter" ranks highest/.test(l)))
  assert.match(s.command, /^beat vary song\.beat drums filter --amount 0\.4 --seed 42$/)
})

test('honestly labels the method as an odds-form / not a full head-to-head Bradley-Terry fit', () => {
  const entries: ScoreEntry[] = [round('drums', 'filter', 3, 6)]
  const s = suggestNext(entries, 'drums', {})
  const methodLine = s.reasoning.find((l) => /ranks highest/.test(l))!
  assert.match(methodLine, /Bradley-Terry/)
  assert.match(methodLine, /not a proven head-to-head/)
})

test('detects a directional trend within the winning group from picks\' diffs', () => {
  // cutoff range is [150, 11000] log-scale; feed in consistently high values (brighter)
  const highCutoffEdits = [['drums.cutoff 8000'], ['drums.cutoff 9000'], ['drums.cutoff 7500']]
  const entries: ScoreEntry[] = [round('drums', 'filter', 3, 6, highCutoffEdits)]
  const s = suggestNext(entries, 'drums', {})
  assert.equal(s.recommendedGroup, 'filter')
  assert.equal(s.directions.length, 1)
  assert.equal(s.directions[0]!.param, 'cutoff')
  assert.equal(s.directions[0]!.direction, 'higher')
  assert.equal(s.directions[0]!.label, 'brighter')
  assert.equal(s.directions[0]!.samples, 3)
  assert.ok(s.reasoning.some((l) => /picks trend brighter on cutoff/.test(l)))
})

test('no directional claim with too few samples or values near the range midpoint', () => {
  // only 2 picks carry a cutoff edit -> below MIN_DIRECTION_SAMPLES
  const entries: ScoreEntry[] = [round('drums', 'filter', 2, 7, [['drums.cutoff 8000'], ['drums.cutoff 9000']])]
  const s = suggestNext(entries, 'drums', {})
  assert.equal(s.directions.length, 0)
  assert.ok(s.reasoning.some((l) => /no clear directional trend/.test(l)))
})

test('--target filters to rounds about that lane/group/param', () => {
  const entries: ScoreEntry[] = [
    round('drums', 'filter', 3, 6),
    { track: 'drums', group: 'feel', picks: [{ rank: 1, variant: 'v1.beat', recipe: 'humanize seed=5 lanes=hat' }], rejected: ['v2.beat'] },
  ]
  const targeted = suggestNext(entries, 'drums', { target: 'hat' })
  assert.equal(targeted.totalRounds, 1)
  assert.equal(targeted.recommendedGroup, 'feel')
  // feel suggestions never carry --amount (varyFeel has no amount knob)
  assert.match(targeted.command, /^beat vary <file> drums feel --seed \d+$/)

  const untargeted = suggestNext(entries, 'drums', {})
  assert.equal(untargeted.totalRounds, 2)
})

test('parseScoresLog tolerates blank and malformed lines', () => {
  const text = [
    JSON.stringify({ track: 'drums', group: 'kick', picks: [{ rank: 1, variant: 'v1.beat' }], rejected: ['v2.beat'] }),
    '',
    '   ',
    'not json at all',
    JSON.stringify({ track: 'drums', group: 'snare', picks: [{ rank: 1, variant: 'v1.beat' }], rejected: [] }),
    '',
  ].join('\n')
  const entries = parseScoresLog(text)
  assert.equal(entries.length, 2)
  assert.equal(entries[0]!.group, 'kick')
  assert.equal(entries[1]!.group, 'snare')
  assert.deepEqual(entries[1]!.rejected, [])
})

test('a group with all variants picked (empty rejected) does not blow up (Laplace smoothing)', () => {
  const entries: ScoreEntry[] = [round('drums', 'kick', 3, 0)]
  const s = suggestNext(entries, 'drums', {})
  assert.equal(s.recommendedGroup, 'kick')
  assert.ok(Number.isFinite(s.stats[0]!.strength))
})
