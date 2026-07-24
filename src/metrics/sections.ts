// Phase 37 Stream RA — section-aware feedback (audio-domain). A song plays its sections back to
// back on one timeline; whole-mix metrics (src/metrics/analyze.ts) average right over that arc and
// can't tell a quiet intro from a loud drop. This module slices ONE rendered mix at its section
// boundaries and analyzes each slice, turning the render into an energy-arc report: LUFS / spectral
// balance / width / crest per section, plus section-to-section movement flagged only when the change
// clears the measured render-run variance (src/metrics/variance.ts).
//
// Honest limits, stated on every surface: these are per-section STATIC metrics — each section
// measured as an isolated static mix. They do NOT hear masking, arrangement, transitions, or how one
// section sets up the next. Same discipline as the reference-profile comparison (profile.ts): the
// numbers remove gross static differences, they don't tell you the arrangement works.

import { analyze, type MixMetrics, type SpectralBands } from './analyze.js'
import { refFindings, formatLint, type LintFinding } from './lint.js'
import type { MixProfile } from './profile.js'
import {
  RENDER_RUN_VARIANCE_LU,
  RENDER_RUN_VARIANCE_PEAK_DB,
  RENDER_RUN_VARIANCE_BAND_PCT,
  RENDER_RUN_VARIANCE_WIDTH_DB,
} from './variance.js'

/** One song section as fed to the slicer: its bar count (required — drives the boundary math) plus
 * whatever labels the caller has (scene id, human name) for the report. */
export interface SectionSpec {
  bars: number
  scene?: string
  name?: string
}

/** A section's slice location + measured metrics. `channels` are VIEWS into the source buffer
 * (subarray), so this is cheap; analyze() never mutates its input. */
export interface SectionMetrics {
  index: number // 0-based
  label: string // name ?? scene ?? "section N"
  bars: number
  startSample: number
  endSample: number
  metrics: MixMetrics
}

/** Samples per bar at 4/4: 4 beats/bar × (60/bpm) s/beat × sr = 240·sr/bpm. Same clock the render
 * length uses (cli/render.mjs: seconds = renderBars·240/bpm). */
export function samplesPerBar(sampleRate: number, bpm: number): number {
  return (240 * sampleRate) / bpm
}

const sectionLabel = (s: SectionSpec, i: number): string => s.name ?? s.scene ?? `section ${i + 1}`

/** Slice `channels` at cumulative section boundaries. Boundary k lands at round(cumulativeBars·
 * samplesPerBar); the LAST section absorbs the tail (any trailing reverb/rounding drift) by running
 * to the buffer end rather than its nominal boundary. Returns one channel-array (subarray views) per
 * section — contiguous and gap-free by construction (each section starts exactly where the previous
 * ended). */
export function sliceSections(channels: Float64Array[], sampleRate: number, bpm: number, sectionBars: number[]): Float64Array[][] {
  const spb = samplesPerBar(sampleRate, bpm)
  const total = channels[0]?.length ?? 0
  const slices: Float64Array[][] = []
  let cumBars = 0
  for (let i = 0; i < sectionBars.length; i++) {
    const start = Math.min(Math.round(cumBars * spb), total)
    cumBars += sectionBars[i]!
    const isLast = i === sectionBars.length - 1
    const end = isLast ? total : Math.min(Math.round(cumBars * spb), total)
    const lo = Math.min(start, total)
    const hi = Math.max(lo, end)
    slices.push(channels.map((ch) => ch.subarray(lo, hi)))
  }
  return slices
}

/** Slice + analyze every section. `sections` supplies the bar counts (boundary math) and labels. */
export function analyzeSections(channels: Float64Array[], sampleRate: number, bpm: number, sections: SectionSpec[]): SectionMetrics[] {
  const spb = samplesPerBar(sampleRate, bpm)
  const total = channels[0]?.length ?? 0
  const slices = sliceSections(channels, sampleRate, bpm, sections.map((s) => s.bars))
  let cumBars = 0
  return sections.map((s, i) => {
    const start = Math.min(Math.round(cumBars * spb), total)
    cumBars += s.bars
    const isLast = i === sections.length - 1
    const end = isLast ? total : Math.min(Math.round(cumBars * spb), total)
    return {
      index: i,
      label: sectionLabel(s, i),
      bars: s.bars,
      startSample: Math.min(start, total),
      endSample: Math.max(Math.min(start, total), end),
      metrics: analyze(slices[i]!, sampleRate),
    }
  })
}

// ---- arrangement lint -----------------------------------------------------------------------

// docs/research/122 §4.2 (the one "ship regardless" item): the flatness detector. The measured
// evidence pair (research/121 §1, the Sandstorm cover): the arrangement the owner called flat
// moved only 1-2 dB between adjacent sections everywhere; the commercial reference's build→drop
// spans 11.8 dB. Nominal thresholds sit between those poles and are padded by the render-run
// variance like every other lint rule, so re-rendering an unchanged .beat can't flip the finding.
export const SECTION_FLAT_ADJACENT_LU = 2
export const SECTION_FLAT_SPAN_LU = 6

/** The arrangement-flatness rule over an already-analyzed section arc: fires when NO adjacent
 * pair moves more than SECTION_FLAT_ADJACENT_LU (padded) AND the whole arrangement's
 * quietest→loudest span stays under SECTION_FLAT_SPAN_LU (padded). Both conditions together —
 * a slow 8-section crescendo has small steps but a real span, and a single drop has a big step;
 * neither is flat. A silent section (-Infinity LUFS) counts as real contrast, not a bail-out.
 * Level 'info' by the lint discipline: flatness is a taste defect, not a playback-safety one. */
export function arrangementFindings(sections: SectionMetrics[]): LintFinding[] {
  if (sections.length < 2) return []
  const lufs = sections.map((s) => s.metrics.integratedLufs)
  if (lufs.some(Number.isNaN)) return [] // an unmeasurable section: no honest verdict either way

  let maxAdjacent = 0
  for (let i = 1; i < lufs.length; i++) maxAdjacent = Math.max(maxAdjacent, Math.abs(lufs[i]! - lufs[i - 1]!))
  const loudest = sections[lufs.indexOf(Math.max(...lufs))]!
  const quietest = sections[lufs.indexOf(Math.min(...lufs))]!
  const span = loudest.metrics.integratedLufs - quietest.metrics.integratedLufs

  const adjacentThreshold = SECTION_FLAT_ADJACENT_LU + RENDER_RUN_VARIANCE_LU
  const spanThreshold = SECTION_FLAT_SPAN_LU + RENDER_RUN_VARIANCE_LU
  if (maxAdjacent > adjacentThreshold || span >= spanThreshold) return []

  return [
    {
      rule: 'arrangement-flat',
      level: 'info',
      measured: span,
      threshold: spanThreshold,
      message:
        `the energy arc is flat: across ${sections.length} sections no adjacent pair moves more than ` +
        `${fmt(maxAdjacent)} LU and the whole arrangement spans only ${fmt(span)} LU ` +
        `(loudest "${loudest.label}" ${fmt(loudest.metrics.integratedLufs)} LUFS, quietest "${quietest.label}" ` +
        `${fmt(quietest.metrics.integratedLufs)} LUFS) — a commercial build→drop typically spans well over ${SECTION_FLAT_SPAN_LU} LU`,
      suggestion:
        `create contrast at the arc level: thin the sections meant to sit low (drop tracks from their scenes, ` +
        `close filters, lower velocities) and stack the section meant to hit (add layers, open filters) until ` +
        `the quietest→loudest span clears ${SECTION_FLAT_SPAN_LU} LU`,
    },
  ]
}

// ---- formatting -----------------------------------------------------------------------------

const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : x > 0 ? '+inf' : x < 0 ? '-inf' : 'nan')
const highEnd = (b: SpectralBands) => b.presence + b.air // "brightness" as a spectral share
const lowEnd = (b: SpectralBands) => b.sub + b.bass
const widthOf = (m: MixMetrics) => (m.stereo ? m.stereo.widthDb : NaN)

/** One `1 -> 2  ...` movement line: only the metrics whose section-to-section change clears the
 * matching render-run-variance pad are named (the rest are noise you can't hear between two renders,
 * Phase 34 NC). Everything padded-out is listed after "steady:" so the report is honest about what
 * DIDN'T move, not silently omitting it. */
function movementLine(a: SectionMetrics, b: SectionMetrics): string {
  const am = a.metrics
  const bm = b.metrics
  const movers: string[] = []
  const steady: string[] = []

  const lufsD = bm.integratedLufs - am.integratedLufs
  if (Number.isFinite(lufsD) && Math.abs(lufsD) > RENDER_RUN_VARIANCE_LU) movers.push(`LUFS ${lufsD > 0 ? '+' : ''}${fmt(lufsD)} LU (${lufsD > 0 ? 'louder' : 'quieter'})`)
  else steady.push('loudness')

  const highD = highEnd(bm.spectral.bandsPct) - highEnd(am.spectral.bandsPct)
  if (Math.abs(highD) > RENDER_RUN_VARIANCE_BAND_PCT) movers.push(`high-end ${highD > 0 ? '+' : ''}${fmt(highD, 0)}pt (${highD > 0 ? 'brighter' : 'darker'})`)
  else steady.push('brightness')

  const lowD = lowEnd(bm.spectral.bandsPct) - lowEnd(am.spectral.bandsPct)
  if (Math.abs(lowD) > RENDER_RUN_VARIANCE_BAND_PCT) movers.push(`low-end ${lowD > 0 ? '+' : ''}${fmt(lowD, 0)}pt (${lowD > 0 ? 'fuller' : 'thinner'})`)
  else steady.push('low-end')

  const widthD = widthOf(bm) - widthOf(am)
  if (Number.isFinite(widthD) && Math.abs(widthD) > RENDER_RUN_VARIANCE_WIDTH_DB) movers.push(`width ${widthD > 0 ? '+' : ''}${fmt(widthD)} dB (${widthD > 0 ? 'wider' : 'narrower'})`)
  else steady.push('width')

  const crestD = bm.crestDb - am.crestDb
  if (Number.isFinite(crestD) && Math.abs(crestD) > RENDER_RUN_VARIANCE_PEAK_DB) movers.push(`crest ${crestD > 0 ? '+' : ''}${fmt(crestD)} dB (${crestD > 0 ? 'more dynamic' : 'more squashed'})`)
  else steady.push('crest')

  const head = `  ${a.index + 1} -> ${b.index + 1}  `
  const body = movers.length ? movers.join(' · ') : 'no change above the render-run variance floor'
  const tail = steady.length ? `\n${' '.repeat(head.length)}steady: ${steady.join(', ')}` : ''
  return head + body + tail
}

/** The honest-limits footer, one definition so CLI + MCP + the whole-song path can't drift. */
export const SECTION_HONEST_LIMITS =
  'honest limits: per-section STATIC metrics only (loudness / spectral balance / width / crest, each\n' +
  'measured over that section\'s own audio). This does NOT hear masking, arrangement, transitions, or\n' +
  'how one section sets up the next — only how the sections differ as isolated static mixes.'

/** The energy-arc report: a per-section table, section-to-section movement (variance-padded), an
 * optional per-section reference comparison, and the honest-limits footer. */
export function formatSectionFeedback(sections: SectionMetrics[], ref?: MixProfile): string {
  const lines: string[] = []
  const totalBars = sections.reduce((n, s) => n + s.bars, 0)
  lines.push(`section feedback: ${sections.length} section${sections.length === 1 ? '' : 's'}, ${totalBars} bars total`)
  lines.push('')

  // per-section table
  const rows = sections.map((s) => {
    const m = s.metrics
    const b = m.spectral.bandsPct
    return {
      idx: String(s.index + 1),
      label: s.label,
      bars: String(s.bars),
      lufs: fmt(m.integratedLufs),
      sub: b.sub.toFixed(0),
      bass: b.bass.toFixed(0),
      mids: b.mids.toFixed(0),
      pres: b.presence.toFixed(0),
      air: b.air.toFixed(0),
      centroid: m.spectral.centroidHz.toFixed(0),
      width: m.stereo ? fmt(m.stereo.widthDb) : 'mono',
      crest: fmt(m.crestDb),
    }
  })
  const labelW = Math.max(5, ...rows.map((r) => r.label.length))
  const header = `  #  ${'label'.padEnd(labelW)}  bars    LUFS   sub  bass  mids  pres  air   centroid    width    crest`
  lines.push(header)
  for (const r of rows) {
    lines.push(
      `  ${r.idx.padStart(1)}  ${r.label.padEnd(labelW)}  ${r.bars.padStart(4)}  ${r.lufs.padStart(6)}  ${r.sub.padStart(3)}  ${r.bass.padStart(4)}  ${r.mids.padStart(4)}  ${r.pres.padStart(4)}  ${r.air.padStart(3)}  ${(r.centroid + ' Hz').padStart(8)}  ${r.width.padStart(7)}  ${r.crest.padStart(7)}`,
    )
  }

  // movement
  if (sections.length >= 2) {
    lines.push('')
    lines.push('section-to-section movement (flagged only when the change clears the render-run variance floor):')
    for (let i = 1; i < sections.length; i++) lines.push(movementLine(sections[i - 1]!, sections[i]!))
  }

  // arrangement lint (research/122 §4.2): the one arc-level verdict this report can measure
  const arc = arrangementFindings(sections)
  if (arc.length > 0) {
    lines.push('')
    lines.push('arrangement lint:')
    for (const f of arc) lines.push(`  ${f.level.toUpperCase()} [${f.rule}] ${f.message}${f.suggestion ? `\n     fix: ${f.suggestion}` : ''}`)
  } else if (sections.length >= 2 && !sections.some((s) => Number.isNaN(s.metrics.integratedLufs))) {
    const lufs = sections.map((s) => s.metrics.integratedLufs)
    lines.push('')
    lines.push(`arrangement lint: pass — quietest→loudest span ${fmt(Math.max(...lufs) - Math.min(...lufs))} LU (flat is under ${SECTION_FLAT_SPAN_LU} LU with no adjacent step over ${SECTION_FLAT_ADJACENT_LU} LU)`)
  }

  // optional per-section reference comparison
  if (ref) {
    lines.push('')
    lines.push(`per-section vs reference (${ref.source}):`)
    for (const s of sections) {
      const findings = refFindings(s.metrics, ref)
      lines.push(`  ${s.index + 1} ${s.label}:`)
      lines.push(
        findings.length
          ? findings.map((f) => `     ${f.message}`).join('\n')
          : '     within reference tolerance on every static metric',
      )
    }
  }

  lines.push('')
  lines.push(SECTION_HONEST_LIMITS)
  return lines.join('\n') + '\n'
}

/** The whole-song default (no --sections): the analyze + lint pair as one block — the same numbers
 * `beat metrics`/`beat lint` print, gathered under one "feedback" call so the loop is render ->
 * feedback in one step. */
export function formatWholeSongFeedback(m: MixMetrics, findings: LintFinding[]): string {
  const b = m.spectral.bandsPct
  const lines = [
    `whole-song feedback: ${m.durationSeconds.toFixed(2)}s, ${m.channels}ch @ ${m.sampleRate} Hz`,
    `loudness   ${fmt(m.integratedLufs)} LUFS integrated`,
    `peaks      sample ${fmt(m.samplePeakDbfs)} dBFS, true ${fmt(m.truePeakDbtp)} dBTP`,
    `dynamics   crest ${fmt(m.crestDb)} dB (rms ${fmt(m.rmsDbfs)} dBFS)`,
    `spectrum   sub ${b.sub.toFixed(0)}% | bass ${b.bass.toFixed(0)}% | mids ${b.mids.toFixed(0)}% | presence ${b.presence.toFixed(0)}% | air ${b.air.toFixed(0)}%  (centroid ${m.spectral.centroidHz.toFixed(0)} Hz)`,
    m.stereo ? `stereo     correlation ${m.stereo.correlation.toFixed(3)}, width ${fmt(m.stereo.widthDb)} dB` : 'stereo     (mono)',
    '',
    'lint:',
    formatLint(findings).trimEnd(),
  ]
  return lines.join('\n') + '\n'
}
