import type { BeatDocument, BeatTrack } from './document.js'
import { SYNTH_PARAM_ORDER } from './document.js'
import { formatNumber } from './format.js'

function serializeTrack(t: BeatTrack): string[] {
  const lines: string[] = []
  lines.push(`track ${t.id} ${t.name} ${t.color}`)
  lines.push(`  synth`)
  for (const key of SYNTH_PARAM_ORDER) {
    const value = t.synth[key]
    lines.push(`    ${key} ${key === 'osc' ? String(value) : formatNumber(value as number)}`)
  }
  // Canonical order: (start, pitch, id) ascending — see format-spec.md's "canonical ordering".
  const sortedNotes = [...t.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch || a.id.localeCompare(b.id))
  for (const n of sortedNotes) {
    lines.push(`  note ${n.id} ${n.pitch} ${n.start} ${n.duration} ${formatNumber(n.velocity)}`)
  }
  return lines
}

// Deterministic: two BeatDocuments that are musically identical always serialize to
// byte-identical text (canonical field order, canonical number formatting, canonical note sort —
// see document.ts and format.ts). Track order is preserved as given (source order is meaningful,
// see format-spec.md), everything within a track is put in canonical form.
export function serialize(doc: BeatDocument): string {
  const lines: string[] = [
    `format_version ${doc.formatVersion}`,
    `bpm ${formatNumber(doc.bpm)}`,
    `loop_bars ${formatNumber(doc.loopBars)}`,
    `selected_track ${doc.selectedTrack}`,
  ]
  for (const t of doc.tracks) {
    lines.push('', ...serializeTrack(t))
  }
  return lines.join('\n') + '\n'
}
