// Phase 38 Stream SA — the analysis-artifact loader (src/analysis/import.ts). Pure, no Python:
// these tests ALWAYS run. They cover the frozen-contract validator (accept the fixture; reject
// each rule with a message assert), the known-answer seconds->bars math (round-to-0 DROP, >64-bar
// SPLIT, sanitize collision, one-scene-per-distinct-label reuse), the empty-sections chunking
// fallback, and the round-trip that closes structure.ts's header promise: buildSkeleton ->
// serialize -> parse -> analyzeStructure reports the same ordered section list.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { serialize, parse } from '../src/core/index.js'
import {
  validateAnalysisArtifact,
  artifactToSections,
  buildSkeleton,
  analyzeStructure,
  BeatAnalysisError,
  type AnalysisArtifact,
} from '../src/analysis/index.js'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const refRaw = () => JSON.parse(readFileSync(join(fixtureDir, 'ref.analysis.json'), 'utf8'))

/** A minimal valid artifact, overridable per test — the base every inline edge case is built on. */
function mkArtifact(overrides: Partial<AnalysisArtifact> = {}): AnalysisArtifact {
  return {
    dotbeatAnalysis: 1,
    source: { file: 'ref.wav', sha256: 'a'.repeat(64), durationSeconds: 100 },
    backend: { name: 'stub', version: '1.0.0', model: null },
    generatedAt: '2026-07-14T00:00:00.000Z',
    bpm: 120,
    bpmMethod: 'backend',
    beats: [],
    downbeats: [],
    sections: [],
    ...overrides,
  }
}

// ---- validator: accept -----------------------------------------------------------------------

test('validateAnalysisArtifact accepts the shipped fixture', () => {
  const art = validateAnalysisArtifact(refRaw())
  assert.equal(art.dotbeatAnalysis, 1)
  assert.equal(art.backend.name, 'beatthis')
  assert.equal(art.bpm, 128.02)
  assert.equal(art.sections.length, 6)
  assert.equal(art.sections[0]!.label, 'intro')
})

test('validateAnalysisArtifact ignores unknown top-level keys', () => {
  const raw = { ...refRaw(), somethingNew: { future: true } }
  const art = validateAnalysisArtifact(raw)
  assert.equal(art.sections.length, 6)
  assert.ok(!('somethingNew' in art))
})

// ---- validator: reject each rule with a message assert ---------------------------------------

test('validateAnalysisArtifact rejects a newer schema version', () => {
  const raw = { ...refRaw(), dotbeatAnalysis: 2 }
  assert.throws(() => validateAnalysisArtifact(raw), (e: unknown) => e instanceof BeatAnalysisError && /newer dotbeat/.test(e.message))
})

test('validateAnalysisArtifact rejects unsorted beats', () => {
  const raw = { ...refRaw(), beats: [1.0, 0.5, 2.0] }
  assert.throws(() => validateAnalysisArtifact(raw), (e: unknown) => e instanceof BeatAnalysisError && /beats must be sorted ascending/.test(e.message))
})

test('validateAnalysisArtifact rejects overlapping sections', () => {
  const raw = {
    ...refRaw(),
    sections: [
      { start: 0, end: 20, label: 'a' },
      { start: 15, end: 30, label: 'b' }, // starts before the previous ended
    ],
  }
  assert.throws(() => validateAnalysisArtifact(raw), (e: unknown) => e instanceof BeatAnalysisError && /non-overlapping/.test(e.message))
})

test('validateAnalysisArtifact rejects an out-of-range bpm', () => {
  const raw = { ...refRaw(), bpm: 500 }
  assert.throws(() => validateAnalysisArtifact(raw), (e: unknown) => e instanceof BeatAnalysisError && /bpm must be a finite number in \(20, 400\)/.test(e.message))
})

test('validateAnalysisArtifact rejects a malformed sha256', () => {
  const raw = { ...refRaw(), source: { ...refRaw().source, sha256: 'not-a-hash' } }
  assert.throws(() => validateAnalysisArtifact(raw), (e: unknown) => e instanceof BeatAnalysisError && /sha256/.test(e.message))
})

test('validateAnalysisArtifact rejects a section with end <= start', () => {
  const raw = { ...refRaw(), sections: [{ start: 10, end: 10, label: 'x' }] }
  assert.throws(() => validateAnalysisArtifact(raw), (e: unknown) => e instanceof BeatAnalysisError && /end must be a finite number > start/.test(e.message))
})

// ---- known-answer bars math ------------------------------------------------------------------

test('artifactToSections: reuse, sanitize collision, round-to-0 drop, and >64-bar split', () => {
  // bpm 120, no downbeats -> barSeconds = 4*60/120 = 2s per bar. Every section length below is a
  // clean multiple of 2s so the rounding is exact and the known answer is unambiguous.
  const art = mkArtifact({
    bpm: 120,
    downbeats: [],
    source: { file: 'x.wav', sha256: 'a'.repeat(64), durationSeconds: 210 },
    sections: [
      { start: 0, end: 8, label: 'intro' }, // 4 bars
      { start: 8, end: 24, label: 'chorus' }, // 8 bars
      { start: 24, end: 40, label: 'chorus' }, // 8 bars — SAME label -> one scene, repeated
      { start: 40, end: 48, label: null }, // 4 bars — unlabeled -> its own section-<n> scene
      { start: 48, end: 56, label: 'Break' }, // 4 bars -> sanitizes to "break"
      { start: 56, end: 64, label: 'break' }, // 4 bars -> COLLIDES -> "break-2"
      { start: 64, end: 64.5, label: 'tiny' }, // 0.25 bars -> rounds to 0 -> DROPPED
      { start: 64.5, end: 204.5, label: 'outro' }, // 70 bars -> SPLIT 32+32+6
    ],
  })
  const entries = artifactToSections(art)
  assert.deepEqual(
    entries.map((e) => ({ scene: e.scene, bars: e.bars })),
    [
      { scene: 'intro', bars: 4 },
      { scene: 'chorus', bars: 8 },
      { scene: 'chorus', bars: 8 },
      { scene: 'section-4', bars: 4 },
      { scene: 'break', bars: 4 },
      { scene: 'break-2', bars: 4 },
      { scene: 'outro', bars: 32 },
      { scene: 'outro', bars: 32 },
      { scene: 'outro', bars: 6 },
    ],
  )
  // the dropped section is simply ABSENT from the returned list
  assert.ok(!entries.some((e) => e.scene === 'tiny' || e.startSeconds === 64))
  // source start-seconds are carried through, and the split chunks all share the section's start
  assert.deepEqual(entries.filter((e) => e.scene === 'outro').map((e) => e.startSeconds), [64.5, 64.5, 64.5])
})

test('buildSkeleton reports the dropped sub-bar section as a note', () => {
  const art = mkArtifact({
    bpm: 120,
    sections: [
      { start: 0, end: 8, label: 'intro' },
      { start: 8, end: 8.5, label: 'tiny' }, // rounds to 0
    ],
  })
  const { report } = buildSkeleton(art)
  assert.equal(report.sections.length, 1)
  assert.equal(report.droppedNotes.length, 1)
  assert.match(report.droppedNotes[0]!, /skipped 1 sub-bar section at 8\.0s \(tiny\)/)
  assert.equal(report.detectedBpm, 120)
  assert.equal(report.roundedBpm, 120)
})

test('barSeconds derives from the downbeat grid when >= 2 downbeats exist', () => {
  // downbeats spaced 1.5s -> barSeconds 1.5; a 6s section is therefore 4 bars, not (4*60/120=2 ->) 3.
  const art = mkArtifact({
    bpm: 120,
    downbeats: [0, 1.5, 3.0, 4.5],
    sections: [{ start: 0, end: 6, label: 'a' }],
  })
  assert.equal(artifactToSections(art)[0]!.bars, 4)
})

// ---- empty-sections chunking fallback --------------------------------------------------------

test('empty sections fall back to uniform part-N chunks (downbeat count -> total bars)', () => {
  const art = mkArtifact({ bpm: 120, downbeats: Array.from({ length: 20 }, (_, i) => i * 0.5), sections: [] })
  const entries = artifactToSections(art) // default sectionBars 8; totalBars = 20 downbeats
  assert.deepEqual(
    entries.map((e) => ({ scene: e.scene, bars: e.bars })),
    [
      { scene: 'part-1', bars: 8 },
      { scene: 'part-2', bars: 8 },
      { scene: 'part-3', bars: 4 }, // remainder as a final shorter section
    ],
  )
  // every part is its own distinct scene (no reuse across unlabeled chunks)
  assert.equal(new Set(entries.map((e) => e.scene)).size, 3)
})

test('empty-sections fallback honors --section-bars', () => {
  const art = mkArtifact({ bpm: 120, downbeats: Array.from({ length: 10 }, (_, i) => i * 0.5), sections: [] })
  const entries = artifactToSections(art, { sectionBars: 4 })
  assert.deepEqual(entries.map((e) => e.bars), [4, 4, 2])
})

test('artifactToSections rejects a bad --section-bars', () => {
  const art = mkArtifact({ sections: [] })
  assert.throws(() => artifactToSections(art, { sectionBars: 0 }), (e: unknown) => e instanceof BeatAnalysisError && /section-bars/.test(e.message))
})

// ---- round-trip: closes the loop -------------------------------------------------------------

test('buildSkeleton -> serialize -> parse -> analyzeStructure sees the same ordered section list', () => {
  const art = validateAnalysisArtifact(refRaw())
  const expected = artifactToSections(art) // the ordered {scene, bars} the loader intends
  const { doc } = buildSkeleton(art)

  // a concrete known answer for the fixture (barSeconds = median downbeat gap 1.875s):
  assert.deepEqual(
    expected.map((e) => ({ scene: e.scene, bars: e.bars })),
    [
      { scene: 'intro', bars: 8 },
      { scene: 'verse', bars: 16 },
      { scene: 'chorus', bars: 16 },
      { scene: 'verse', bars: 16 },
      { scene: 'chorus', bars: 16 },
      { scene: 'outro', bars: 35 },
    ],
  )

  // round-trip through the real serializer/parser, then re-analyze the arrangement symbolically:
  const reparsed = parse(serialize(doc))
  const analysis = analyzeStructure(reparsed)
  assert.deepEqual(
    analysis.sections.map((s) => ({ scene: s.scene, bars: s.bars })),
    expected.map((e) => ({ scene: e.scene, bars: e.bars })),
  )
  // distinct scenes were minted (verse/chorus each once, reused across their two sections)
  assert.deepEqual(reparsed.scenes.map((s) => s.id).sort(), ['chorus', 'intro', 'outro', 'verse'])
  assert.equal(reparsed.bpm, 128) // Math.round(128.02)
  // the starter lead track from initDocument is kept
  assert.ok(reparsed.tracks.some((t) => t.id === 'lead'))
})
