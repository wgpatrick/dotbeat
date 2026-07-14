// Phase 37 Stream RB — symbolic song analysis (src/analysis/). Known-answer fixtures for each of
// the four documented metrics, built with the ordinary edit primitives so the fixtures read as real
// projects, plus a smoke test on the shipped example song. See src/analysis/structure.ts.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { initDocument, addTrack, addNote, addHit, saveClip, setScene, setSong, parse } from '../src/core/index.js'
import { analyzeStructure, formatStructure, BeatAnalysisError } from '../src/analysis/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// ---- Metric 1: onset density (tiling) --------------------------------------------------------

test('onset density: 4 kicks in a 1-bar clip, tiled across a 4-bar section = 16 onsets', () => {
  // loopBars 1 → each 1-bar clip tiles once per bar; a 4-bar section holds 4 tiles.
  let doc = initDocument({ loopBars: 1 })
  doc = addTrack(doc, { id: 'drums', kind: 'drums' }).doc
  for (const start of [0, 4, 8, 12]) doc = addHit(doc, 'drums', { lane: 'kick', start, velocity: 1 }).doc
  doc = saveClip(doc, 'drums', 'beat').doc
  doc = setScene(doc, 'a', { drums: 'beat' })
  doc = setSong(doc, [{ scene: 'a', bars: 4 }])

  const a = analyzeStructure(doc)
  assert.equal(a.sections.length, 1)
  const drums = a.sections[0]!.tracks.find((t) => t.trackId === 'drums')!
  assert.equal(drums.onsets, 16) // 4 hits × 4 tiled bars
  assert.equal(drums.onsetsPerBar, 4)
  assert.equal(a.sections[0]!.onsets, 16)
  assert.equal(a.totalBars, 4)
})

// ---- Metric 2: syncopation (fraction off the quarter grid) -----------------------------------

test('syncopation: hits all on off-beats (steps 2,6,10,14) → syncopation 1', () => {
  let doc = initDocument({ loopBars: 1 })
  doc = addTrack(doc, { id: 'drums', kind: 'drums' }).doc
  for (const start of [2, 6, 10, 14]) doc = addHit(doc, 'drums', { lane: 'hat', start, velocity: 1 }).doc
  doc = saveClip(doc, 'drums', 'offbeat').doc
  doc = setScene(doc, 'a', { drums: 'offbeat' })
  doc = setSong(doc, [{ scene: 'a', bars: 2 }])

  const a = analyzeStructure(doc)
  const drums = a.sections[0]!.tracks.find((t) => t.trackId === 'drums')!
  assert.equal(drums.syncopation, 1)
  assert.equal(a.sections[0]!.syncopation, 1)
})

test('syncopation: hits on the quarter grid (steps 0,4,8,12) → syncopation 0', () => {
  let doc = initDocument({ loopBars: 1 })
  doc = addTrack(doc, { id: 'drums', kind: 'drums' }).doc
  for (const start of [0, 4, 8, 12]) doc = addHit(doc, 'drums', { lane: 'kick', start, velocity: 1 }).doc
  doc = saveClip(doc, 'drums', 'four').doc
  doc = setScene(doc, 'a', { drums: 'four' })
  doc = setSong(doc, [{ scene: 'a', bars: 1 }])

  const a = analyzeStructure(doc)
  assert.equal(a.sections[0]!.tracks.find((t) => t.trackId === 'drums')!.syncopation, 0)
})

// ---- Metric 3: pitch-class histogram vs scale ------------------------------------------------

test('pitch-class: C/E/G in C major → inScale 1.0; adding Eb → 0.75', () => {
  const build = (pitches: number[]) => {
    let doc = initDocument({ loopBars: 1 }) // 'lead' synth track
    pitches.forEach((pitch, i) => (doc = addNote(doc, 'lead', { pitch, start: i, duration: 1, velocity: 0.8 }).doc))
    doc = saveClip(doc, 'lead', 'chord').doc
    doc = setScene(doc, 'a', { lead: 'chord' })
    return setSong(doc, [{ scene: 'a', bars: 1 }])
  }

  // C=60, E=64, G=67 are all in C major (root 0).
  const triad = analyzeStructure(build([60, 64, 67]), { root: 0, scale: 'major' })
  const triadPc = triad.sections[0]!.tracks.find((t) => t.trackId === 'lead')!.pitchClass!
  assert.equal(triadPc.total, 3)
  assert.equal(triadPc.inScale, 1)
  assert.equal(triadPc.counts[0], 1) // one C
  assert.equal(triadPc.counts[4], 1) // one E
  assert.equal(triadPc.counts[7], 1) // one G

  // Add Eb=63 (out of C major): 3 of 4 in scale.
  const withEb = analyzeStructure(build([60, 64, 67, 63]), { root: 0, scale: 'major' })
  assert.equal(withEb.sections[0]!.tracks.find((t) => t.trackId === 'lead')!.pitchClass!.inScale, 0.75)

  // Scale-agnostic: histogram present, inScale null.
  const agnostic = analyzeStructure(build([60, 64, 67, 63]))
  assert.equal(agnostic.scale, null)
  assert.equal(agnostic.sections[0]!.tracks.find((t) => t.trackId === 'lead')!.pitchClass!.inScale, null)
})

test('unknown scale throws BeatAnalysisError', () => {
  const doc = initDocument({ loopBars: 1 })
  assert.throws(() => analyzeStructure(doc, { root: 0, scale: 'bogus' }), BeatAnalysisError)
})

// ---- Metric 4: repetition / novelty ----------------------------------------------------------

test('arrangement A B A: section 3 repeats section 1, and B is novel', () => {
  // Build an A-B-A song (NOT A-A-B): two distinct scenes, then arranged so the THIRD section
  // returns to the FIRST scene's content. Section index 2 (the third) must exactly repeat index 0.
  let doc = initDocument({ loopBars: 1 })
  doc = addTrack(doc, { id: 'drums', kind: 'drums' }).doc
  // clip A: kick pattern
  doc = addHit(doc, 'drums', { lane: 'kick', start: 0, velocity: 1 }).doc
  doc = addHit(doc, 'drums', { lane: 'kick', start: 8, velocity: 1 }).doc
  doc = saveClip(doc, 'drums', 'clipA').doc
  // clip B: distinct snare pattern (clear the live hits by re-snapshotting fresh content)
  doc = addHit(doc, 'drums', { lane: 'snare', start: 4, velocity: 1 }).doc
  doc = saveClip(doc, 'drums', 'clipB').doc
  doc = setScene(doc, 'A', { drums: 'clipA' })
  doc = setScene(doc, 'B', { drums: 'clipB' })
  // A B A — the third section reuses scene A.
  doc = setSong(doc, [
    { scene: 'A', bars: 4 },
    { scene: 'B', bars: 4 },
    { scene: 'A', bars: 4 },
  ])

  const a = analyzeStructure(doc)
  assert.equal(a.sections.length, 3)
  // Novelty: A (index 0) and B (index 1) are the first appearances of their content.
  assert.deepEqual(a.novelSections, [0, 1])
  // Repetition: section index 2 exactly repeats index 0.
  assert.deepEqual(a.repeats, [{ index: 2, repeatOf: 0 }])
  // Self-similarity: A~A = 1, A~B < 1.
  assert.equal(a.similarity[0]![2], 1)
  assert.ok(a.similarity[0]![1]! < 1)
})

// ---- Loop-mode (no song block) ---------------------------------------------------------------

test('loop mode (no song block) → sections=[], totalBars=loopBars', () => {
  const doc = initDocument({ loopBars: 8 }) // song stays null
  const a = analyzeStructure(doc)
  assert.deepEqual(a.sections, [])
  assert.equal(a.totalBars, 8)
  assert.deepEqual(a.repeats, [])
  assert.deepEqual(a.novelSections, [])
  // The formatter renders the loop-mode note rather than a table.
  assert.match(formatStructure(a), /loop mode/)
})

// ---- Smoke test on the shipped example -------------------------------------------------------

test('smoke: analyzes examples/night-shift-song.beat without throwing', () => {
  const doc = parse(readFileSync(join(repoRoot, 'examples', 'night-shift-song.beat'), 'utf8'))
  const a = analyzeStructure(doc, { root: 0, scale: 'minor' })
  assert.ok(a.sections.length > 0)
  assert.equal(a.totalBars, a.sections.reduce((sum, s) => sum + s.bars, 0))
  // The example arranges intro/build/drop with the intro repeated at the end — repeats are found.
  assert.ok(a.repeats.length > 0)
  // Every section's onsets equal the sum of its tracks' onsets (internal consistency).
  for (const s of a.sections) {
    assert.equal(s.onsets, s.tracks.reduce((sum, t) => sum + t.onsets, 0))
  }
  // The formatted view renders a table with the scale label.
  assert.match(formatStructure(a), /C minor/)
})
