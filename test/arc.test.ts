// Source-derived dynamics arc tests (src/metrics/arc.ts). Synthetic multi-section buffers whose
// per-section levels are known a priori: the loudest section is the 0 dB anchor, quieter sections
// carry a known negative relative level, and diffArc catches a render that flattens the planned arc.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildArcProfile,
  serializeArcProfile,
  parseArcProfile,
  formatArcTable,
  diffArc,
  formatArcDiff,
  BeatArcError,
  ARC_FORMAT,
  type ArcRange,
} from '../src/metrics/arc.js'
import { analyzeSections, type SectionSpec } from '../src/metrics/sections.js'
import { buildProfile } from '../src/metrics/profile.js'
import { analyze } from '../src/metrics/analyze.js'

const FS = 44100

/** A mono buffer of `amps.length` sections, each `secs` long, each a 220 Hz sine at the given amp. */
function sectionedSine(amps: number[], secs: number): Float64Array {
  const per = Math.round(secs * FS)
  const out = new Float64Array(amps.length * per)
  for (let s = 0; s < amps.length; s++) {
    for (let i = 0; i < per; i++) out[s * per + i] = amps[s]! * Math.sin((2 * Math.PI * 220 * i) / FS)
  }
  return out
}

/** Time ranges for N equal `secs`-long sections. */
function ranges(labels: string[], secs: number): ArcRange[] {
  return labels.map((label, i) => ({ label, startSeconds: i * secs, endSeconds: (i + 1) * secs }))
}

const SECS = 2 // 2s/section → at 120 bpm that's exactly 1 bar, so render specs line up

test('buildArcProfile: loudest section is the 0 dB anchor, quieter sections are negative', () => {
  // section 1 (amp 0.5) is loudest; section 2 (amp 0.05 ≈ -20 dB) is the quiet one
  const ch = sectionedSine([0.5, 0.05, 0.25], SECS)
  const p = buildArcProfile([ch], FS, ranges(['a', 'b', 'c'], SECS), 'ref.wav', 'csv')
  assert.equal(p.format, ARC_FORMAT)
  assert.equal(p.sections.length, 3)
  assert.equal(p.loudestIndex, 0)
  assert.equal(p.sections[0]!.relLufsDb, 0, 'the loudest section anchors at 0 dB')
  assert.ok(p.sections[1]!.relLufsDb < -12, `quiet section should sit well below the drop, got ${p.sections[1]!.relLufsDb}`)
  assert.ok(p.sections[2]!.relLufsDb < 0 && p.sections[2]!.relLufsDb > p.sections[1]!.relLufsDb, 'mid section between drop and quiet')
  // band shares are populated per section
  assert.ok(p.sections[0]!.bandsPct && typeof p.sections[0]!.bandsPct.bass === 'number')
})

test('buildArcProfile: bpm + bars provenance carried from a beat-style source', () => {
  const ch = sectionedSine([0.4, 0.4], SECS)
  const rs: ArcRange[] = [
    { label: 'intro', startSeconds: 0, endSeconds: SECS, bars: 1 },
    { label: 'drop', startSeconds: SECS, endSeconds: 2 * SECS, bars: 1 },
  ]
  const p = buildArcProfile([ch], FS, rs, 'ref.wav', 'beat', { bpm: 120 })
  assert.equal(p.bpm, 120)
  assert.equal(p.sections[0]!.bars, 1)
  assert.equal(p.sectionsFrom, 'beat')
})

test('serialize/parse round-trips, reviving a silent section (-Infinity ↔ null)', () => {
  const ch = sectionedSine([0.5, 0.0], SECS) // section 2 is pure silence → LUFS -Infinity
  const p = buildArcProfile([ch], FS, ranges(['loud', 'silent'], SECS), 'ref.wav', 'csv')
  const text = serializeArcProfile(p)
  assert.ok(text.includes('"loud"'))
  assert.ok(!text.includes('-Infinity'), 'non-finite serialized as JSON null, not the string -Infinity')
  const back = parseArcProfile(text, 'round-trip')
  assert.equal(back.sections[1]!.lufs, -Infinity, 'null revived back to -Infinity')
  assert.equal(back.loudestIndex, 0)
})

test('parseArcProfile: rejects a whole-mix profile (wrong format)', () => {
  const mix = buildProfile(analyze([sectionedSine([0.3], 1)], FS), 'mix.wav')
  assert.throws(() => parseArcProfile(JSON.stringify(mix), 'mix'), BeatArcError)
})

test('formatArcTable: shows relative dB and names the loudest as the drop', () => {
  const ch = sectionedSine([0.5, 0.1, 0.5], SECS)
  const table = formatArcTable(buildArcProfile([ch], FS, ranges(['intro', 'break', 'drop'], SECS), 'ref.wav', 'csv'))
  assert.match(table, /rel LUFS/)
  assert.match(table, /0\.0 \(drop\)/)
  assert.match(table, /honest limits/)
})

// ---- diffArc: render arc vs reference arc ---------------------------------------------------

const specs = (n: number): SectionSpec[] => Array.from({ length: n }, (_, i) => ({ bars: 1, name: `s${i + 1}` }))

test('diffArc: a render that matches the reference arc PASSES every section', () => {
  const amps = [0.5, 0.05, 0.5, 0.2]
  const refCh = sectionedSine(amps, SECS)
  const ref = buildArcProfile([refCh], FS, ranges(['s1', 's2', 's3', 's4'], SECS), 'ref.wav', 'csv')
  // render is the SAME material → identical arc → all pass, deltas ≈ 0
  const renderSecs = analyzeSections([sectionedSine(amps, SECS)], FS, 120, specs(4))
  const d = diffArc(renderSecs, ref)
  assert.equal(d.pass, true)
  for (const row of d.rows) assert.ok(Math.abs(row.deltaDb) < 0.5, `${row.label} delta ${row.deltaDb} should be ~0`)
})

test('diffArc: a render that FLATTENS a planned quiet section fails that section', () => {
  const ref = buildArcProfile([sectionedSine([0.5, 0.05, 0.5, 0.2], SECS)], FS, ranges(['s1', 's2', 's3', 's4'], SECS), 'ref.wav', 'csv')
  // render keeps every section loud (0.5) — section 2 should sit ~ -20 dB but sits at 0 → FAIL
  const renderSecs = analyzeSections([sectionedSine([0.5, 0.5, 0.5, 0.5], SECS)], FS, 120, specs(4))
  const d = diffArc(renderSecs, ref)
  assert.equal(d.pass, false)
  const s2 = d.rows[1]!
  assert.equal(s2.pass, false, 'the flattened section fails')
  assert.ok(s2.deltaDb > 10, `the flattened section reads far too loud vs plan, delta ${s2.deltaDb}`)
  assert.match(formatArcDiff(d, ref.source), /FAIL/)
})

test('diffArc: mismatched section counts interpolate the reference by position', () => {
  const ref = buildArcProfile([sectionedSine([0.5, 0.05, 0.5], SECS)], FS, ranges(['s1', 's2', 's3'], SECS), 'ref.wav', 'csv')
  // render has 6 sections following the same loud/quiet/loud shape at finer resolution
  const renderSecs = analyzeSections([sectionedSine([0.5, 0.5, 0.05, 0.05, 0.5, 0.5], SECS)], FS, 120, specs(6))
  const d = diffArc(renderSecs, ref)
  assert.equal(d.renderSections, 6)
  assert.equal(d.refSections, 3)
  assert.ok(d.rows.every((r) => r.interpolated), 'every row is marked interpolated when counts differ')
  assert.match(formatArcDiff(d, ref.source), /interpolated by position/)
})
