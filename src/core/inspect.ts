// `beat inspect` — docs/phase-2-plan.md §2.3. A compact, deterministic overview of a document
// for humans and agents. (The CLI's --json mode doesn't come through here — it just prints the
// parsed document; this is the human-shaped view.)

import type { BeatDocument, BeatTrack } from './document.js'
import { DRUM_LANES } from './document.js'
import { formatNumber } from './format.js'

function describeTrack(t: BeatTrack, loopSteps: number): string[] {
  const lines: string[] = []
  const s = t.synth
  lines.push(`${t.id}  "${t.name}"  ${t.kind}  ${t.color}`)
  lines.push(`  synth: ${s.osc}, ${formatNumber(s.volume)} dB, cutoff ${formatNumber(s.cutoff)} Hz, res ${formatNumber(s.resonance)}, ADSR ${formatNumber(s.attack)}/${formatNumber(s.decay)}/${formatNumber(s.sustain)}/${formatNumber(s.release)}, pan ${formatNumber(s.pan)}`)
  if (t.kind === 'drums' && t.pattern) {
    for (const lane of DRUM_LANES) {
      const steps = t.pattern[lane]
      const hits = steps.filter((v) => v > 0).length
      // A char-per-step strip: readable at a glance, still exact (X >= 0.75, x > 0, . = off).
      const strip = steps.map((v) => (v === 0 ? '.' : v >= 0.75 ? 'X' : 'x')).join('')
      lines.push(`  ${lane.padEnd(7)} ${strip}  (${hits} hit${hits === 1 ? '' : 's'})`)
    }
  } else {
    const n = t.notes.length
    if (n === 0) {
      lines.push('  notes: none')
    } else {
      const pitches = t.notes.map((x) => x.pitch)
      const starts = t.notes.map((x) => x.start)
      lines.push(`  notes: ${n}, pitch ${Math.min(...pitches)}-${Math.max(...pitches)}, steps ${Math.min(...starts)}-${Math.max(...starts)} of ${loopSteps}`)
    }
  }
  return lines
}

export function describeDocument(doc: BeatDocument): string {
  const loopSteps = doc.loopBars * 16
  const lines: string[] = [
    `format ${doc.formatVersion} | ${formatNumber(doc.bpm)} bpm | ${doc.loopBars} bar${doc.loopBars === 1 ? '' : 's'} (${loopSteps} steps) | selected: ${doc.selectedTrack}`,
    `tracks: ${doc.tracks.length}`,
    '',
  ]
  for (const t of doc.tracks) {
    lines.push(...describeTrack(t, loopSteps), '')
  }
  return lines.join('\n').replace(/\n+$/, '\n')
}
