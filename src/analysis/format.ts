// Phase 37 Stream RB — text rendering of a StructureAnalysis in the `beat inspect` house style
// (src/core/inspect.ts): a compact, deterministic, aligned overview for humans and agents. The CLI's
// --json mode does NOT come through here (it prints the StructureAnalysis object directly); this is
// the human-shaped view, same split inspect.ts documents.

import { formatNumber } from '../core/index.js'
import type { PitchClassProfile, StructureAnalysis } from './structure.js'

const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** A one-line pitch-class summary: the classes present, densest first, with the in-scale fraction
 * when a scale was supplied (e.g. "C×4 E×2 G×2, 100% in scale"). */
function pitchClassSummary(pc: PitchClassProfile): string {
  const present = pc.counts
    .map((count, cls) => ({ count, cls }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count || a.cls - b.cls)
    .map((e) => `${PITCH_CLASS_NAMES[e.cls]}×${e.count}`)
    .join(' ')
  const scalePart = pc.inScale === null ? '' : `, ${formatNumber(Math.round(pc.inScale * 100))}% in scale`
  return `${present || '(none)'}${scalePart}`
}

export function formatStructure(a: StructureAnalysis): string {
  const scaleLabel = a.scale ? `${PITCH_CLASS_NAMES[a.scale.root]} ${a.scale.name}` : 'scale-agnostic'

  if (a.sections.length === 0) {
    // Loop-mode (no song block): nothing to arrange-analyze.
    return `structure: loop mode (no song block) | ${a.totalBars} bar${a.totalBars === 1 ? '' : 's'} | ${scaleLabel}\n  no sections — arrange a song block (beat song) to analyze structure`
  }

  const lines: string[] = [
    `structure: ${a.sections.length} section${a.sections.length === 1 ? '' : 's'} | ${a.totalBars} bars total | ${scaleLabel}`,
    '',
  ]

  // Section table. Columns: index, scene, bar range, onsets/bar, syncopation, new-or-repeat marker.
  const rows = a.sections.map((s) => {
    const repeatOf = a.repeats.find((r) => r.index === s.index)
    const marker = repeatOf ? `repeat of §${repeatOf.repeatOf + 1} (${a.sections[repeatOf.repeatOf]!.scene})` : 'new'
    return {
      idx: `${s.index + 1}`,
      scene: s.scene,
      bars: `${s.startBar + 1}-${s.startBar + s.bars}`,
      density: formatNumber(Math.round(s.onsetsPerBar * 10) / 10),
      sync: `${formatNumber(Math.round(s.syncopation * 100))}%`,
      marker,
    }
  })
  const w = (key: keyof (typeof rows)[number], head: string) => Math.max(head.length, ...rows.map((r) => r[key].length))
  const wIdx = w('idx', '#')
  const wScene = w('scene', 'scene')
  const wBars = w('bars', 'bars')
  const wDensity = w('density', 'onset/bar')
  const wSync = w('sync', 'sync')
  lines.push(
    `  ${'#'.padStart(wIdx)}  ${'scene'.padEnd(wScene)}  ${'bars'.padStart(wBars)}  ${'onset/bar'.padStart(wDensity)}  ${'sync'.padStart(wSync)}  arc`,
  )
  for (const r of rows) {
    lines.push(
      `  ${r.idx.padStart(wIdx)}  ${r.scene.padEnd(wScene)}  ${r.bars.padStart(wBars)}  ${r.density.padStart(wDensity)}  ${r.sync.padStart(wSync)}  ${r.marker}`,
    )
  }

  // Per-section pitch content (only sections that have pitched notes).
  const withPitch = a.sections.filter((s) => s.pitchClass && s.pitchClass.total > 0)
  if (withPitch.length > 0) {
    lines.push('', 'pitch content:')
    for (const s of withPitch) lines.push(`  §${s.index + 1} ${s.scene}: ${pitchClassSummary(s.pitchClass!)}`)
  }

  // Arrangement summary: novelty vs repetition across the whole song.
  lines.push(
    '',
    `arrangement: ${a.novelSections.length} distinct section${a.novelSections.length === 1 ? '' : 's'}, ${a.repeats.length} exact repeat${a.repeats.length === 1 ? '' : 's'}`,
  )

  return lines.join('\n')
}
