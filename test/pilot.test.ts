// The constrained T5 overnight pilot (docs/pilot.md, docs/research/117): the PURE half of `beat
// pilot run` — the seeded QD loop over the VARY space, the brightness×density niche descriptors,
// the stereo-width fence (the #1 measured hack vector), best-per-niche elite selection, ε
// immigrants, controls that are NEVER critic-scored, budget accounting, the run journal, and the
// blind elite-vs-control batch assembly + scoreboard. The loop's slow step (render+feature-extract)
// and its critic are INJECTED, so this runs entirely on synthetic features — no renders, no aes
// sidecar, same posture as test/prodtask.test.ts. The render half rides renderVaryBatch (its own
// tests) and the owner-side real run.

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse, serialize } from '../src/core/index.js'
import { generateSeedBeat } from '../src/taste/seeds.js'
import { FEATURE_KEYS, type FeatureVector } from '../src/taste/features.js'
import { variantTypeOf } from '../src/taste/eval.js'
import { scoreBatch } from '../src/vary/batch.js'
import { makeRng } from '../src/vary/vary.js'
import {
  fenceWidth,
  WIDTH_FENCE_VALUE,
  WIDTH_FENCE_KEY,
  factorNiches,
  buildNicheGrid,
  nicheOf,
  nicheLabel,
  runPilotRole,
  writePilotBatch,
  writePilotJournal,
  goodhartTripwire,
  loadPilotEntries,
  computePilotReport,
  formatPilotReport,
  pilotRole,
  makeInitialPopulation,
  makeOffspring,
  reconstructCheckpoint,
  checkpointSteps,
  PILOT_ROLES,
  DEFAULT_PILOT_ROLES,
  type PilotGenome,
  type Evaluated,
  type PopScore,
  type GenerationRecord,
} from '../src/taste/pilot.js'

// ---- synthetic audio + features ----------------------------------------------------------------

function toneWav(freq: number, gain: number, seconds = 0.4, sampleRate = 44100): Buffer {
  const frames = Math.round(seconds * sampleRate)
  const data = Buffer.alloc(frames * 4)
  for (let i = 0; i < frames; i++) {
    const s = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * gain * 32767)
    data.writeInt16LE(s, i * 4)
    data.writeInt16LE(s, i * 4 + 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0, 'ascii'); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22)
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36, 'ascii'); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

/** A deterministic hash of a string → 0..1, so fake features depend only on a genome's id (the
 * loop's determinism guarantee: same seed → same ids → same features → same journal). */
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

/** A full FeatureVector synthesized from a genome id — varies brightness (centroidLog2), density
 * (crestDb), and stereoWidthDb so the niche grid and the width fence both have something to bite. */
function fakeFeatures(id: string): FeatureVector {
  const r = hash01(id)
  const r2 = hash01(id + 'x')
  const base: FeatureVector = {
    lufs: -14, samplePeakDb: -1, truePeakDb: -1, crestDb: 4 + r * 8, rmsDb: -18,
    bandSubPct: 10, bandBassPct: 20, bandMidsPct: 30, bandPresencePct: 20, bandAirPct: 5,
    centroidLog2: 7 + r2 * 4, stereoCorrelation: 0.9,
    stereoWidthDb: -45 + Math.floor(r * 40), // varied REAL widths — the fence must flatten these
  }
  // sanity: every declared key present
  for (const k of FEATURE_KEYS) assert.ok(typeof base[k] === 'number')
  return base
}

const fakeAes = (id: string): number[] => [1 + hash01(id), 0.5, 0.5, 0.5]

// A fake evaluate that records which genome ids it was ever asked to render — controls must never
// appear here (they are generated post-loop and never critic-scored).
function makeEvaluate(seen: Set<string>) {
  return async (genomes: PilotGenome[]): Promise<Map<string, Evaluated>> => {
    const out = new Map<string, Evaluated>()
    for (const g of genomes) {
      seen.add(g.id)
      out.set(g.id, { dsp: fakeFeatures(g.id), aes: fakeAes(g.id) })
    }
    return out
  }
}

// A fake critic that records the stereoWidthDb of every candidate it is handed — proving the loop
// fences width BEFORE scoring.
function makeScore(seenWidths: number[]) {
  return (candidates: Evaluated[]): PopScore[] =>
    candidates.map((c) => {
      seenWidths.push(c.dsp.stereoWidthDb)
      const mean = c.dsp.centroidLog2 - c.dsp.crestDb * 0.1 + c.aes[0]!
      const std = 0.2 + hash01(String(c.dsp.centroidLog2)) * 0.3
      return { mean, std, pessimistic: mean - std }
    })
}

function makeSeeds(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const { text, file } = { text: generateSeedBeat(100 + i).text, file: `seed-${String(i + 1).padStart(3, '0')}.beat` }
    return { file, doc: parse(text) }
  })
}

// ---- niche descriptors -------------------------------------------------------------------------

test('factorNiches picks a near-square grid, prime falls back to a single density row', () => {
  assert.deepEqual(factorNiches(4), { densityBins: 2, brightBins: 2 })
  assert.deepEqual(factorNiches(6), { densityBins: 2, brightBins: 3 })
  assert.deepEqual(factorNiches(8), { densityBins: 2, brightBins: 4 })
  assert.deepEqual(factorNiches(9), { densityBins: 3, brightBins: 3 })
  assert.deepEqual(factorNiches(5), { densityBins: 1, brightBins: 5 })
  assert.deepEqual(factorNiches(1), { densityBins: 1, brightBins: 1 })
})

test('niche assignment buckets brightness × density and labels the corners', () => {
  // four clearly-separated points → one per 2×2 niche
  const mk = (centroid: number, crest: number): FeatureVector => ({ ...fakeFeatures('x'), centroidLog2: centroid, crestDb: crest })
  const darkSparse = mk(6, 10) // low bright, high crest → low density
  const darkBusy = mk(6, 2)    // low bright, low crest → high density
  const brightSparse = mk(11, 10)
  const brightBusy = mk(11, 2)
  const grid = buildNicheGrid([darkSparse, darkBusy, brightSparse, brightBusy], 4)
  const niches = new Set([darkSparse, darkBusy, brightSparse, brightBusy].map((f) => nicheOf(grid, f)))
  assert.equal(niches.size, 4, 'four separated points occupy four distinct niches')
  // corner semantics: niche 0 is dark·sparse, the last is bright·busy
  assert.equal(nicheOf(grid, darkSparse), 0)
  assert.equal(nicheLabel(grid, 0), 'sparse·dark')
  assert.equal(nicheLabel(grid, 3), 'busy·bright')
})

// ---- the width fence ---------------------------------------------------------------------------

test('fenceWidth overwrites stereoWidthDb with the constant sentinel and leaves every other feature intact', () => {
  const f = fakeFeatures('sample')
  assert.notEqual(f.stereoWidthDb, WIDTH_FENCE_VALUE, 'precondition: the real width is not already the sentinel')
  const fenced = fenceWidth(f)
  assert.equal(fenced[WIDTH_FENCE_KEY], WIDTH_FENCE_VALUE)
  for (const k of FEATURE_KEYS) {
    if (k === WIDTH_FENCE_KEY) continue
    assert.equal(fenced[k], f[k], `${k} must be untouched by the width fence`)
  }
})

// ---- the loop ----------------------------------------------------------------------------------

test('the pilot loop is deterministic per seed (fake scorer)', async () => {
  const seeds = makeSeeds(4)
  const run = () =>
    runPilotRole({
      role: 'bassline', seeds, budget: 16, generations: 4, niches: 4, seed: 71,
      evaluate: makeEvaluate(new Set()), score: makeScore([]),
    })
  const a = await run()
  const b = await run()
  assert.equal(JSON.stringify(a.journal), JSON.stringify(b.journal), 'same seed → byte-identical journal')
  assert.deepEqual(a.archive.map((e) => e.genome.id), b.archive.map((e) => e.genome.id), 'same seed → same elites')
  assert.deepEqual(a.controls.map((c) => c.id), b.controls.map((c) => c.id), 'same seed → same controls')
})

test('the loop fences stereo width before every scoring call (feature actually excluded)', async () => {
  const seeds = makeSeeds(4)
  const seenWidths: number[] = []
  await runPilotRole({
    role: 'bassline', seeds, budget: 12, generations: 3, niches: 4, seed: 71,
    evaluate: makeEvaluate(new Set()), score: makeScore(seenWidths),
  })
  assert.ok(seenWidths.length > 0, 'the critic was actually called')
  for (const w of seenWidths) assert.equal(w, WIDTH_FENCE_VALUE, 'every candidate the critic saw had its width fenced to the sentinel')
})

test('controls are random-mutation descendants of elites that are NEVER critic-scored', async () => {
  const seeds = makeSeeds(4)
  const seenByEvaluate = new Set<string>()
  const scoredWidths: number[] = []
  const result = await runPilotRole({
    role: 'bassline', seeds, budget: 16, generations: 4, niches: 4, controls: 3, seed: 71,
    evaluate: makeEvaluate(seenByEvaluate), score: makeScore(scoredWidths),
  })
  assert.ok(result.controls.length >= 2 && result.controls.length <= 4, 'controls clamp to 2..4')
  for (const c of result.controls) {
    assert.equal(c.origin, 'control')
    assert.ok(c.parentId, 'a control descends from a named elite')
    assert.ok(!seenByEvaluate.has(c.id), 'a control is NEVER rendered/scored inside the loop')
    // its ancestor elite WAS evaluated (it is in the final archive)
    assert.ok(result.archive.some((e) => e.genome.id === c.parentId), 'the control descends from a final elite')
  }
})

test('budget accounting: renders never exceed the budget and the journal sums to rendersSpent', async () => {
  const seeds = makeSeeds(4)
  const result = await runPilotRole({
    role: 'bassline', seeds, budget: 15, generations: 6, niches: 4, seed: 71,
    evaluate: makeEvaluate(new Set()), score: makeScore([]),
  })
  assert.ok(result.rendersSpent <= 15, `rendersSpent ${result.rendersSpent} must not exceed budget 15`)
  const summed = result.journal.reduce((s, g) => s + g.rendersThisGen, 0)
  assert.equal(summed, result.rendersSpent, 'per-generation renders sum to the total spent')
  // the archive never exceeds the niche count
  assert.ok(result.archive.length <= 4)
  // the last journal row's cumulative rendersSpent matches
  assert.equal(result.journal[result.journal.length - 1]!.rendersSpent, result.rendersSpent)
})

test('runPilotRole errors clearly when no seed carries the role track', async () => {
  const seeds = makeSeeds(2).map((s) => ({ ...s, doc: { ...s.doc, tracks: s.doc.tracks.filter((t) => t.id !== 'bass') } }))
  await assert.rejects(
    runPilotRole({ role: 'bassline', seeds, budget: 8, generations: 2, niches: 4, seed: 71, evaluate: makeEvaluate(new Set()), score: makeScore([]) }),
    /no seed song has a "bass" track/,
  )
})

// ---- the Goodhart tripwire ---------------------------------------------------------------------

test('the Goodhart tripwire fires when pessimism climbs while ensemble std explodes', () => {
  const rec = (best: number, std: number): GenerationRecord => ({
    role: 'x', generation: 0, populationSize: 1, rendersThisGen: 1, rendersSpent: 1,
    nicheOccupancy: 1, nicheTotal: 4, meanPessimistic: best, meanEnsembleStd: std,
    archiveBestPessimistic: best, archiveMeanPessimistic: best, individuals: [],
  })
  // pessimism up AND std up >1.5× → alarm
  assert.ok(goodhartTripwire([rec(1, 0.2), rec(3, 0.5)]))
  // pessimism up but std steady → no alarm
  assert.equal(goodhartTripwire([rec(1, 0.2), rec(3, 0.21)]), null)
  // a single generation → no basis to compare
  assert.equal(goodhartTripwire([rec(1, 0.2)]), null)
})

// ---- batch assembly honesty + the report -------------------------------------------------------

test('writePilotBatch records elite-vs-control honestly and the report reads it kind-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-batch-'))
  writeFileSync(join(dir, 'v1.wav'), toneWav(220, 0.3))
  writeFileSync(join(dir, 'v2.wav'), toneWav(440, 0.3))
  writeFileSync(join(dir, 'v3.wav'), toneWav(330, 0.3))
  const manifest = writePilotBatch(dir, 'bassline', [
    { file: 'v1.wav', source: { kind: 'elite', from: 'niche sparse·dark, 3 edits from seed-001.beat' } },
    { file: 'v2.wav', source: { kind: 'control', from: 'random-mutation control descended from elite bassline-g6-9' } },
    { file: 'v3.wav', source: { kind: 'elite', from: 'niche busy·bright, 2 edits from seed-002.beat' } },
  ], { seed: 71 })
  assert.equal(manifest.group, 'pilot:bassline')
  assert.equal(manifest.parent, '', 'clip-set batch — empty parent (score works, adopt refuses)')
  assert.deepEqual(manifest.variants.map((v) => v.source!.kind), ['elite', 'control', 'elite'])
  assert.equal(variantTypeOf({ group: 'pilot:bassline' }), 'pilot', 'taste-eval classifies pilot frontier as its own split')

  // score it → the shared log records the ARM KIND only (never the lineage in `from`)
  const logPath = join(dir, 'beat-scores.jsonl')
  const res = scoreBatch(dir, ['1', '3'], logPath)
  assert.equal(res.entry.group, 'pilot:bassline')
  assert.deepEqual(res.entry.sources, { 'v1.wav': 'elite', 'v2.wav': 'control', 'v3.wav': 'elite' })
  const logged = readFileSync(logPath, 'utf8')
  assert.ok(!logged.includes('seed-001.beat'), 'the batch-local lineage never leaks into the shared log')

  const report = computePilotReport(logPath)
  assert.equal(report.totalBatches, 1)
  const elite = report.overall.find((s) => s.kind === 'elite')!
  const control = report.overall.find((s) => s.kind === 'control')!
  assert.ok(elite && control)
  assert.equal(elite.wins, 1, 'the rank-1 pick (an elite) is the win')
  assert.equal(control.wins, 0)
  const text = formatPilotReport(report)
  assert.match(text, /SCALING GATE/)
})

test('the report gate verdict tracks whether elites beat controls', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-gate-'))
  const logPath = join(dir, 'beat-scores.jsonl')
  // synthesize five batches where the elite always wins over the control
  for (let i = 0; i < 5; i++) {
    const entry = {
      t: new Date().toISOString(), batch: `${dir}/b${i}`, group: 'pilot:bassline', seed: 71, parentSha256: '',
      picks: [{ rank: 1, variant: 'v1.wav' }, { rank: 2, variant: 'v2.wav' }],
      rejected: ['v3.wav'],
      sources: { 'v1.wav': 'elite', 'v2.wav': 'elite', 'v3.wav': 'control' },
    }
    appendFileSync(logPath, JSON.stringify(entry) + '\n')
  }
  const report = computePilotReport(logPath)
  assert.equal(report.totalBatches, 5)
  assert.ok(report.gate.elitePairwise! > report.gate.controlPairwise!, 'elites win the pairwise')
  assert.match(report.gate.verdict, /elites are beating controls/)

  const { entries } = loadPilotEntries(logPath)
  assert.equal(entries.length, 5)
  assert.equal(entries[0]!.role, 'bassline')
})

// ---- role table --------------------------------------------------------------------------------

test('pilot role table and defaults', () => {
  assert.equal(pilotRole('bassline').seedTrack, 'bass')
  assert.equal(pilotRole('drum-loop').kind, 'drums')
  assert.throws(() => pilotRole('nope'), /unknown pilot role/)
  assert.ok(DEFAULT_PILOT_ROLES.every((r) => PILOT_ROLES.some((s) => s.role === r)))
})

// ---- journal write -----------------------------------------------------------------------------

test('writePilotJournal emits one JSON line per generation across roles', async () => {
  const seeds = makeSeeds(4)
  const result = await runPilotRole({
    role: 'bassline', seeds, budget: 12, generations: 3, niches: 4, seed: 71,
    evaluate: makeEvaluate(new Set()), score: makeScore([]),
  })
  const dir = mkdtempSync(join(tmpdir(), 'pilot-journal-'))
  const jp = join(dir, 'pilot-journal.jsonl')
  writePilotJournal(jp, [result])
  const lines = readFileSync(jp, 'utf8').trim().split('\n')
  assert.equal(lines.length, result.journal.length)
  const first = JSON.parse(lines[0]!)
  assert.equal(first.role, 'bassline')
  assert.equal(first.generation, 0)
  assert.ok('nicheOccupancy' in first && 'meanEnsembleStd' in first && 'rendersSpent' in first)
})

test('trajectory: editSteps accumulate per mutation and reconstructCheckpoint replays exactly', () => {
  const seeds = [1, 2, 3].map((n) => ({ file: `seed-00${n}.beat`, doc: parse(generateSeedBeat(n).text) }))
  const rng = makeRng(9)
  let n = 0
  const nextId = () => `g${n++}`
  const spec = pilotRole('bassline')
  const pop = makeInitialPopulation(seeds, spec, 3, rng, nextId)
  for (const g of pop) assert.deepEqual(g.editSteps, [g.edits.length], 'one step after initial mutation')
  // breed one offspring chain and check cumulative steps
  const zeroDsp = Object.fromEntries(FEATURE_KEYS.map((k) => [k, 0])) as FeatureVector
  const elite = { genome: pop[0]!, niche: 0, score: { mean: 0, std: 0, pessimistic: 0 }, dsp: zeroDsp, aes: [0, 0, 0, 0] }
  const kids = makeOffspring([elite], seeds, spec, 2, 0, 0.4, rng, nextId)
  for (const k of kids) {
    if (k.origin === 'immigrant') continue
    assert.equal(k.editSteps.length, pop[0]!.editSteps.length + 1)
    assert.equal(k.editSteps[k.editSteps.length - 1], k.edits.length)
    // full-depth reconstruction rebuilds the genome's own doc exactly
    const seedDoc = seeds.find((s) => s.file === k.seedFile)!.doc
    const rebuilt = reconstructCheckpoint(seedDoc, k, k.editSteps.length)
    assert.equal(serialize(rebuilt), serialize(k.doc), 'prefix replay at full depth = the genome doc')
    // a mid-depth checkpoint differs from both ends when steps >= 2
    if (k.editSteps.length >= 2) {
      const mid = reconstructCheckpoint(seedDoc, k, 1)
      assert.notEqual(serialize(mid), serialize(seedDoc))
    }
  }
  assert.deepEqual(checkpointSteps(0), [])
  assert.deepEqual(checkpointSteps(2), [1])
  assert.deepEqual(checkpointSteps(6), [2, 4])
  assert.deepEqual(checkpointSteps(3), [1, 2])
})
