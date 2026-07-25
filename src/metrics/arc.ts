// Source-derived dynamics arc (research 121 §3.4; decision D28 phase 3). The produce-song skill's
// phase 3 demands "per-section energy targets derived from the reference's measured arc, not vibes"
// — this module turns a REFERENCE RECORDING into that plan. Given a wav plus section boundaries
// (from `beat analyze`'s .analysis.json, a .beat song block, or an explicit csv of ranges), it
// slices the reference at those boundaries, measures each section, and expresses the arc as
// per-section loudness RELATIVE to the loudest section (the drop = 0 dB, everything else negative).
//
// The saved ArcProfile is the plan an agent pastes into NOTES.md at phase 3 (formatArcTable) AND
// the machine-checkable target `beat feedback --sections --ref <arc.json>` diffs the project's
// rendered arc against at phase 6 (diffArc).
//
// Honest limits, same discipline as profile.ts / sections.ts: these are per-section STATIC metrics
// measured over each slice's own audio. The arc captures how loud each section is relative to the
// loudest — the DYNAMIC shape — but it does not hear masking, arrangement, transitions, or how one
// section sets up the next.

import { analyze, type MixMetrics, type SpectralBands } from './analyze.js'
import { RENDER_RUN_VARIANCE_LU } from './variance.js'
import type { SectionMetrics } from './sections.js'

export class BeatArcError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatArcError'
  }
}

export const ARC_FORMAT = 'dotbeat-arc-profile'
/** Bump when the arc-profile shape changes incompatibly; parseArcProfile refuses newer versions. */
export const ARC_VERSION = 1

/** How the section boundaries were derived — provenance on the saved profile. */
export type ArcSectionSource = 'analysis' | 'beat' | 'csv'

/** One labelled span of the reference, in seconds. `bars` present only when the source knows it
 * (the `beat` song-block source); the `analysis`/`csv` sources are time-only. */
export interface ArcRange {
  label: string
  startSeconds: number
  endSeconds: number
  bars?: number
}

/** One section of the measured arc: its location, its absolute metrics, and — the headline — its
 * loudness relative to the loudest section (loudest = 0 dB). */
export interface ArcSection {
  index: number
  label: string
  startSeconds: number
  endSeconds: number
  bars?: number
  /** Absolute integrated LUFS of the slice (provenance; -Infinity for a section too quiet/short to gate). */
  lufs: number
  /** Absolute RMS dBFS of the slice. */
  rms: number
  /** lufs minus the loudest section's lufs — the arc value (0 at the loudest section, negative below it). */
  relLufsDb: number
  /** rms minus the loudest section's rms. */
  relRmsDb: number
  bandsPct: SpectralBands
  widthDb: number | null
}

export interface ArcProfile {
  format: typeof ARC_FORMAT
  version: number
  /** Provenance: the reference filename the arc was measured from (as given). */
  source: string
  /** Provenance: ISO-8601 timestamp of when the profile was written. */
  createdAt: string
  /** Provenance: which tool wrote it. */
  tool: string
  /** Provenance: how section boundaries were derived. */
  sectionsFrom: ArcSectionSource
  /** bpm, when a bar-based source (beat) supplied it — informational. */
  bpm?: number
  /** Index of the section the arc is measured relative to (the loudest). */
  loudestIndex: number
  sections: ArcSection[]
}

const db = (x: number) => (x <= 0 ? -Infinity : 20 * Math.log10(x))

/** RMS dBFS over a set of channel slices. */
function sliceRmsDbfs(chSlices: Float64Array[]): number {
  let sum = 0
  let n = 0
  for (const ch of chSlices) {
    for (let i = 0; i < ch.length; i++) sum += ch[i]! * ch[i]!
    n += ch.length
  }
  return db(n > 0 ? Math.sqrt(sum / n) : 0)
}

/** Slice `channels` at second boundaries and analyze each span. The last span absorbs any tail. */
export function analyzeArcRanges(channels: Float64Array[], sampleRate: number, ranges: ArcRange[]): {
  range: ArcRange
  metrics: MixMetrics
  rmsDbfs: number
  startSample: number
  endSample: number
}[] {
  const total = channels[0]?.length ?? 0
  return ranges.map((r, i) => {
    const start = Math.min(Math.max(0, Math.round(r.startSeconds * sampleRate)), total)
    const nominalEnd = Math.round(r.endSeconds * sampleRate)
    const isLast = i === ranges.length - 1
    const end = Math.min(Math.max(start, isLast ? total : nominalEnd), total)
    const chSlices = channels.map((ch) => ch.subarray(start, end))
    return { range: r, metrics: analyze(chSlices, sampleRate), rmsDbfs: sliceRmsDbfs(chSlices), startSample: start, endSample: end }
  })
}

/** Build the arc profile from a reference recording and its section boundaries. `loudest` is the
 * section with the greatest finite integrated LUFS; every section's arc value is relative to it. */
export function buildArcProfile(
  channels: Float64Array[],
  sampleRate: number,
  ranges: ArcRange[],
  source: string,
  sectionsFrom: ArcSectionSource,
  opts: { bpm?: number; now?: Date } = {},
): ArcProfile {
  if (ranges.length === 0) throw new BeatArcError('no sections to measure — the section source yielded zero ranges')
  const measured = analyzeArcRanges(channels, sampleRate, ranges)
  // Loudest = greatest FINITE LUFS (a silent/too-short section is never the anchor). Fall back to
  // the first section only if every section bottomed out (all silence).
  let loudestIndex = -1
  let loudestLufs = -Infinity
  measured.forEach((m, i) => {
    if (Number.isFinite(m.metrics.integratedLufs) && m.metrics.integratedLufs > loudestLufs) {
      loudestLufs = m.metrics.integratedLufs
      loudestIndex = i
    }
  })
  if (loudestIndex === -1) loudestIndex = 0
  const anchorLufs = measured[loudestIndex]!.metrics.integratedLufs
  const anchorRms = measured[loudestIndex]!.rmsDbfs

  const sections: ArcSection[] = measured.map((m, i) => ({
    index: i,
    label: m.range.label,
    startSeconds: m.startSample / sampleRate,
    endSeconds: m.endSample / sampleRate,
    ...(m.range.bars !== undefined ? { bars: m.range.bars } : {}),
    lufs: m.metrics.integratedLufs,
    rms: m.rmsDbfs,
    relLufsDb: m.metrics.integratedLufs - anchorLufs,
    relRmsDb: m.rmsDbfs - anchorRms,
    bandsPct: m.metrics.spectral.bandsPct,
    widthDb: m.metrics.stereo ? m.metrics.stereo.widthDb : null,
  }))

  return {
    format: ARC_FORMAT,
    version: ARC_VERSION,
    source,
    createdAt: (opts.now ?? new Date()).toISOString(),
    tool: 'dotbeat beat metrics --sections-from',
    sectionsFrom,
    ...(opts.bpm !== undefined ? { bpm: opts.bpm } : {}),
    loudestIndex,
    sections,
  }
}

// ---- serialization (mirrors profile.ts: -Infinity → null, revived on read) ------------------

const NON_FINITE = new Set(['Infinity', '-Infinity', 'NaN'])

export function serializeArcProfile(profile: ArcProfile): string {
  return (
    JSON.stringify(
      profile,
      (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? (v === -Infinity ? null : String(v)) : v),
      2,
    ) + '\n'
  )
}

function reviveNumbers(value: unknown): unknown {
  if (typeof value === 'string' && NON_FINITE.has(value)) return Number(value)
  if (Array.isArray(value)) return value.map(reviveNumbers)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = reviveNumbers(v)
    return out
  }
  return value
}

/** Within a section, a null numeric leaf means "-Infinity" (a silent/too-short slice). `widthDb`
 * null legitimately means "mono" and is preserved by key. */
function reviveSectionNulls(section: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(section)) {
    if (k === 'widthDb') out[k] = v // null = mono; a real width is a number
    else if (k === 'bandsPct' && v && typeof v === 'object') {
      const bands: Record<string, unknown> = {}
      for (const [bk, bv] of Object.entries(v as Record<string, unknown>)) bands[bk] = bv === null ? -Infinity : bv
      out[k] = bands
    } else out[k] = v === null ? -Infinity : v
  }
  return out
}

const isNum = (x: unknown): x is number => typeof x === 'number'

/** Parse + validate a saved arc profile. `label` names the file in error messages. */
export function parseArcProfile(text: string, label = 'arc profile'): ArcProfile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BeatArcError(`${label} is not valid JSON — write one with \`beat metrics <ref.wav> --sections-from <analysis|beat|csv> --save-profile <arc.json>\``)
  }
  const p = reviveNumbers(raw) as Partial<ArcProfile> | null
  if (p === null || typeof p !== 'object' || p.format !== ARC_FORMAT) {
    throw new BeatArcError(`${label} is not a dotbeat arc profile (expected "format": "${ARC_FORMAT}") — a whole-mix profile from \`--save-profile\` alone is a different shape`)
  }
  if (!isNum(p.version) || p.version > ARC_VERSION) {
    throw new BeatArcError(`${label} has arc-profile version ${String(p.version)} — this dotbeat reads up to version ${ARC_VERSION}`)
  }
  if (!Array.isArray(p.sections) || p.sections.length === 0) {
    throw new BeatArcError(`${label} has no sections — re-save it with \`beat metrics <ref.wav> --sections-from ... --save-profile\``)
  }
  p.sections = (p.sections as unknown[]).map((s, i) => {
    if (!s || typeof s !== 'object') throw new BeatArcError(`${label} section ${i} is malformed`)
    const rev = reviveSectionNulls(s as Record<string, unknown>) as unknown as ArcSection
    if (!isNum(rev.relLufsDb) || !isNum(rev.lufs) || typeof rev.label !== 'string') {
      throw new BeatArcError(`${label} section ${i} is missing measured fields (relLufsDb / lufs / label)`)
    }
    return rev
  })
  if (!isNum(p.loudestIndex)) p.loudestIndex = 0
  return p as ArcProfile
}

// ---- formatting: the arc table an agent pastes into NOTES.md ---------------------------------

const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : x > 0 ? '+inf' : x < 0 ? '-inf' : 'nan')
const signed = (x: number, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(d)}` : x < 0 ? '-inf' : '+inf')

/** The arc table (relative dB per section) — the plan for NOTES.md. The `rel LUFS` column is the
 * headline: how far below the loudest section each section sits. */
export function formatArcTable(profile: ArcProfile): string {
  const lines: string[] = []
  const dur = profile.sections.length ? profile.sections[profile.sections.length - 1]!.endSeconds - profile.sections[0]!.startSeconds : 0
  lines.push(`dynamics arc: ${profile.sections.length} section${profile.sections.length === 1 ? '' : 's'} from ${profile.source} (${profile.sectionsFrom}), ${dur.toFixed(1)}s`)
  lines.push(`loudest section = "${profile.sections[profile.loudestIndex]?.label ?? '?'}" (the 0 dB anchor; every other section is relative to it)`)
  lines.push('')
  const rows = profile.sections.map((s) => ({
    idx: String(s.index + 1),
    label: s.label,
    span: `${s.startSeconds.toFixed(1)}–${s.endSeconds.toFixed(1)}s`,
    rel: s.index === profile.loudestIndex ? '0.0 (drop)' : signed(s.relLufsDb),
    relRms: signed(s.relRmsDb),
    lufs: fmt(s.lufs),
    sub: s.bandsPct.sub.toFixed(0),
    bass: s.bandsPct.bass.toFixed(0),
    mids: s.bandsPct.mids.toFixed(0),
    pres: s.bandsPct.presence.toFixed(0),
    air: s.bandsPct.air.toFixed(0),
    width: s.widthDb === null ? 'mono' : fmt(s.widthDb),
  }))
  const labelW = Math.max(5, ...rows.map((r) => r.label.length))
  const spanW = Math.max(6, ...rows.map((r) => r.span.length))
  lines.push(`  #  ${'label'.padEnd(labelW)}  ${'span'.padEnd(spanW)}  rel LUFS   rel RMS    LUFS   sub bass mids pres air  width`)
  for (const r of rows) {
    lines.push(
      `  ${r.idx}  ${r.label.padEnd(labelW)}  ${r.span.padEnd(spanW)}  ${r.rel.padStart(8)}  ${r.relRms.padStart(7)}  ${r.lufs.padStart(6)}  ${r.sub.padStart(3)} ${r.bass.padStart(4)} ${r.mids.padStart(4)} ${r.pres.padStart(4)} ${r.air.padStart(3)}  ${r.width.padStart(6)}`,
    )
  }
  lines.push('')
  lines.push('honest limits: per-section STATIC metrics (each slice measured on its own). The arc is the')
  lines.push('relative-loudness SHAPE — it does not hear masking, arrangement, transitions, or how one')
  lines.push('section sets up the next. Paste this table into NOTES.md as the phase-3 dynamics plan; verify')
  lines.push('the render against it with: beat feedback --sections --ref <this-file>')
  return lines.join('\n') + '\n'
}

// ---- arc diff: render arc vs reference arc (feedback --sections --ref) -----------------------

/** Nominal per-section arc tolerance before variance padding: a matched section may sit this many
 * LU off the reference's relative level before it's a finding. Padded by render-run variance so a
 * re-render of the same .beat can't flip a pass/fail. */
export const ARC_SECTION_TOLERANCE_LU = 2

export interface ArcDiffRow {
  index: number
  label: string
  /** The render section's loudness relative to the render's OWN loudest section. */
  renderRelDb: number
  /** The reference arc's relative level at this section's position (interpolated when counts differ). */
  refRelDb: number
  /** renderRelDb - refRelDb: how much flatter (+) or deeper (−) the render's contrast is here. */
  deltaDb: number
  pass: boolean
  /** True when refRelDb came from interpolating between reference sections (section counts differ). */
  interpolated: boolean
}

export interface ArcDiff {
  rows: ArcDiffRow[]
  tolerance: number
  pass: boolean
  /** Section counts, surfaced because a mismatch is why interpolation kicked in. */
  renderSections: number
  refSections: number
}

/** Normalized midpoint position (0..1) of each entry by cumulative weight (bars or duration). */
function midpointPositions(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1
  const out: number[] = []
  let cum = 0
  for (const w of weights) {
    out.push((cum + w / 2) / total)
    cum += w
  }
  return out
}

/** Linear-interpolate a reference arc (positions must be ascending) at position `pos`. */
function interpAt(positions: number[], values: number[], pos: number): number {
  if (positions.length === 1) return values[0]!
  if (pos <= positions[0]!) return values[0]!
  if (pos >= positions[positions.length - 1]!) return values[values.length - 1]!
  for (let i = 1; i < positions.length; i++) {
    if (pos <= positions[i]!) {
      const t = (pos - positions[i - 1]!) / (positions[i]! - positions[i - 1]! || 1)
      return values[i - 1]! + t * (values[i]! - values[i - 1]!)
    }
  }
  return values[values.length - 1]!
}

/** Diff the project's rendered section arc against a reference ArcProfile. Both arcs are expressed
 * relative to their OWN loudest section (so absolute-level differences are removed — this compares
 * the dynamic SHAPE). Sections are matched by position: exact index when the counts match, else the
 * render section's normalized midpoint is interpolated onto the reference arc. A section fails when
 * its render relative-level is more than `tolerance` LU off the reference's — i.e. the contrast the
 * plan calls for isn't there (a section that should sit −8 dB but only sits −2 dB is flat). */
export function diffArc(renderSections: SectionMetrics[], ref: ArcProfile, opts: { toleranceLu?: number } = {}): ArcDiff {
  const tolerance = (opts.toleranceLu ?? ARC_SECTION_TOLERANCE_LU) + RENDER_RUN_VARIANCE_LU
  // render arc relative to the render's own loudest finite section
  const renderLufs = renderSections.map((s) => s.metrics.integratedLufs)
  let rLoudIdx = -1
  let rLoud = -Infinity
  renderLufs.forEach((l, i) => {
    if (Number.isFinite(l) && l > rLoud) {
      rLoud = l
      rLoudIdx = i
    }
  })
  const rAnchor = rLoudIdx === -1 ? 0 : renderLufs[rLoudIdx]!
  const renderRel = renderLufs.map((l) => (Number.isFinite(l) ? l - rAnchor : -Infinity))

  // reference arc positions + values
  const refWeights = ref.sections.map((s) => (s.bars ?? s.endSeconds - s.startSeconds) || 1)
  const refPos = midpointPositions(refWeights)
  const refVals = ref.sections.map((s) => s.relLufsDb)

  const sameCount = renderSections.length === ref.sections.length
  const renderWeights = renderSections.map((s) => s.bars || 1)
  const renderPos = midpointPositions(renderWeights)

  const rows: ArcDiffRow[] = renderSections.map((s, i) => {
    const refRel = sameCount ? refVals[i]! : interpAt(refPos, refVals, renderPos[i]!)
    const rRel = renderRel[i]!
    const delta = Number.isFinite(rRel) ? rRel - refRel : NaN
    // A silent render section that the ref says should be loud is a fail; NaN delta (both unmeasurable)
    // is treated as within-tolerance (no honest verdict either way).
    const pass = Number.isFinite(delta) ? Math.abs(delta) <= tolerance : !Number.isFinite(rRel) && refRel < -tolerance ? false : true
    return {
      index: i,
      label: s.label,
      renderRelDb: rRel,
      refRelDb: refRel,
      deltaDb: delta,
      pass,
      interpolated: !sameCount,
    }
  })

  return { rows, tolerance, pass: rows.every((r) => r.pass), renderSections: renderSections.length, refSections: ref.sections.length }
}

/** Human-readable arc diff — per-section render-vs-reference relative levels, deltas, and a
 * pass/fail line. Machine consumers read the ArcDiff object directly (feedback --json). */
export function formatArcDiff(diff: ArcDiff, refSource: string): string {
  const lines: string[] = []
  lines.push(`arc vs reference (${refSource}) — dynamic shape, each arc relative to its own loudest section:`)
  if (diff.renderSections !== diff.refSections) {
    lines.push(`  note: render has ${diff.renderSections} sections, reference has ${diff.refSections} — reference levels interpolated by position`)
  }
  const labelW = Math.max(5, ...diff.rows.map((r) => r.label.length))
  lines.push(`  #  ${'label'.padEnd(labelW)}  render rel  ref rel   delta    verdict`)
  for (const r of diff.rows) {
    lines.push(
      `  ${r.index + 1}  ${r.label.padEnd(labelW)}  ${signed(r.renderRelDb).padStart(9)}  ${signed(r.refRelDb).padStart(7)}  ${signed(r.deltaDb).padStart(6)}   ${r.pass ? 'ok' : 'FAIL'}`,
    )
  }
  lines.push('')
  const failed = diff.rows.filter((r) => !r.pass)
  if (failed.length === 0) {
    lines.push(`arc check: PASS — every section's relative level is within ${diff.tolerance.toFixed(1)} LU of the reference arc`)
  } else {
    lines.push(`arc check: FAIL — ${failed.length} section${failed.length === 1 ? '' : 's'} off the reference arc by more than ${diff.tolerance.toFixed(1)} LU:`)
    for (const r of failed) {
      const flatter = Number.isFinite(r.deltaDb) && r.deltaDb > 0
      lines.push(`  "${r.label}" is ${signed(r.deltaDb)} LU vs plan (${flatter ? 'not enough contrast — this section sits too close to the drop' : 'more contrast than planned'})`)
    }
  }
  return lines.join('\n') + '\n'
}
