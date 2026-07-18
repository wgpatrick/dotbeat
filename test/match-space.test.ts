// The match search space: genome<->value mapping, base/candidate documents built through the real
// parser (so anything these tests accept, the engine's own parse/serialize accepts), and the
// edits-are-real-`beat set`-lines contract.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse, setValue, serialize } from '../src/core/index.js'
import {
  buildMatchSpace,
  buildBaseDoc,
  buildCandidateDoc,
  initGenome,
  genomeToEdits,
  denormalizeParam,
  normalizeParam,
  applySpectralInit,
} from '../src/match/space.js'

test('denormalize/normalize round-trip on linear, log and integer params', () => {
  const lin = { path: 'x', min: -6, max: 6, scale: 'linear' as const }
  const log = { path: 'x', min: 150, max: 16000, scale: 'log' as const }
  const int = { path: 'x', min: 1, max: 7, scale: 'linear' as const, integer: true }
  for (const u of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(Math.abs(normalizeParam(lin, denormalizeParam(lin, u)) - u) < 1e-12)
    assert.ok(Math.abs(normalizeParam(log, denormalizeParam(log, u)) - u) < 1e-9)
  }
  assert.equal(denormalizeParam(lin, 0), -6)
  assert.equal(denormalizeParam(lin, 1), 6)
  assert.equal(denormalizeParam(log, 0), 150)
  assert.ok(Math.abs(denormalizeParam(log, 1) - 16000) < 1e-6)
  assert.equal(denormalizeParam(int, 0.5), 4)
  assert.equal(denormalizeParam(int, 1.7), 7) // clamped then rounded
})

test('synth space: staged dims stay under the ~30-dim exploit threshold; 15 discrete combos', () => {
  const space = buildMatchSpace('synth')
  assert.ok(space.stage1.length <= 30, `stage1 has ${space.stage1.length} dims`)
  assert.ok(space.stage2.length <= 30, `stage2 has ${space.stage2.length} dims`)
  assert.equal(space.discreteChoices.length, 15) // 5 osc x 3 filter
  assert.ok(space.discreteChoices.some((c) => c.label === 'sawtooth/lowpass'))
})

test('drum-sampler space: sampler params only, single discrete combo', () => {
  const space = buildMatchSpace('drum-sampler')
  assert.equal(space.discreteChoices.length, 1)
  assert.ok(space.stage1.every((d) => d.path.startsWith('match.lane.chop.')))
})

test('base synth doc parses, has the frozen-pitch note, and renders at least the target duration', () => {
  const base = buildBaseDoc({ trackKind: 'synth', midi: 57, durationSeconds: 1.3 })
  const doc = parse(base.text)
  const track = doc.tracks.find((t) => t.id === 'match')
  assert.ok(track && track.kind === 'synth')
  assert.equal(track!.notes.length, 1)
  assert.equal(track!.notes[0]!.pitch, 57)
  assert.ok(base.renderSeconds >= 1.3 - 1e-9, `renders ${base.renderSeconds}s for a 1.3s target`)
  assert.ok(base.renderSeconds < 4, 'render window should stay close to the chop length')
})

test('base drum-sampler doc registers the target as the lane sample', () => {
  const sha = 'a'.repeat(64)
  const base = buildBaseDoc({ trackKind: 'drum-sampler', midi: 48, durationSeconds: 0.8, targetSha256: sha })
  const doc = parse(base.text)
  assert.equal(doc.media.length, 1)
  assert.equal(doc.media[0]!.sha256, sha)
  const track = doc.tracks.find((t) => t.id === 'match')!
  assert.equal(track.kind, 'drums')
  assert.equal(track.lanes!.length, 1)
  assert.equal(track.lanes![0]!.backing.type, 'sample')
  assert.equal(track.hits.length, 1)
})

test('candidate edits are genuine beat-set lines: replaying them on the base doc reproduces the candidate', () => {
  const space = buildMatchSpace('synth')
  const base = buildBaseDoc({ trackKind: 'synth', midi: 60, durationSeconds: 1.0 })
  const genome = initGenome(space.stage1).map((v, i) => (i % 2 === 0 ? Math.min(1, v + 0.2) : v))
  const combo = space.discreteChoices.find((c) => c.label === 'square/bandpass')!
  const { text, edits } = buildCandidateDoc(base, space, combo, space.stage1, genome)
  // Replay the emitted edit list through setValue (exactly what `beat set` does).
  let doc = parse(base.text)
  for (const e of edits) doc = setValue(doc, e.path, e.value)
  const replayed = serialize(doc)
  // The candidate may additionally differ in the note's gate duration, which is not a set path —
  // compare everything except the note line.
  const stripNote = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('note ')).join('\n')
  assert.equal(stripNote(replayed), stripNote(text))
  const osc = parse(text).tracks[0]!.synth.osc
  assert.equal(osc, 'square')
})

test('gate pseudo-param edits the note length, not a synth field', () => {
  const space = buildMatchSpace('synth')
  const base = buildBaseDoc({ trackKind: 'synth', midi: 60, durationSeconds: 1.0 })
  const gateIdx = space.stage1.findIndex((d) => d.path === 'gate')
  assert.ok(gateIdx >= 0)
  const lowGate = initGenome(space.stage1)
  lowGate[gateIdx] = 0
  const highGate = initGenome(space.stage1)
  highGate[gateIdx] = 1
  const combo = space.discreteChoices[0]!
  const a = parse(buildCandidateDoc(base, space, combo, space.stage1, lowGate).text)
  const b = parse(buildCandidateDoc(base, space, combo, space.stage1, highGate).text)
  const durA = a.tracks[0]!.notes[0]!.duration
  const durB = b.tracks[0]!.notes[0]!.duration
  assert.ok(durA < durB, `gate 0 duration ${durA} should be < gate 1 duration ${durB}`)
  const { edits } = genomeToEdits(space.stage1, highGate)
  assert.ok(!edits.some((e) => e.path === 'gate'), 'gate must not leak into the beat-set edit list')
})

test('spectral init: cutoff starts near 2x the target centroid; other params untouched', () => {
  const space = buildMatchSpace('synth')
  const inited = applySpectralInit(space.stage1, 1200)
  const cutoffIdx = inited.findIndex((d) => d.path === 'match.cutoff')
  const cutoff = denormalizeParam(inited[cutoffIdx]!, initGenome(inited)[cutoffIdx]!)
  assert.ok(Math.abs(cutoff - 2400) < 20, `cutoff init ${cutoff} should be ~2400`)
  const gateIdx = inited.findIndex((d) => d.path === 'gate')
  assert.equal(inited[gateIdx]!.init, space.stage1[gateIdx]!.init)
  // degenerate centroid leaves the space alone
  assert.deepEqual(applySpectralInit(space.stage1, 0), space.stage1)
})

test('bpm math: a very short chop clamps to bpm 300, a long one adds bars instead of dropping below 40', () => {
  const short = buildBaseDoc({ trackKind: 'synth', midi: 60, durationSeconds: 0.3 })
  assert.equal(short.bpm, 300)
  assert.ok(short.renderSeconds >= 0.3)
  const long = buildBaseDoc({ trackKind: 'synth', midi: 60, durationSeconds: 7 })
  assert.ok(long.bpm >= 40 && long.renderSeconds >= 7 - 1e-9, `bpm ${long.bpm}, ${long.renderSeconds}s`)
})
