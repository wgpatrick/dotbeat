// `beat inspect` — docs/phase-2-plan.md §2.3. A compact, deterministic overview of a document
// for humans and agents. (The CLI's --json mode doesn't come through here — it just prints the
// parsed document; this is the human-shaped view.)

import type { BeatClip, BeatDocument, BeatTrack } from './document.js'
import { DRUM_LANES } from './document.js'
import { formatNumber } from './format.js'

// v0.9: ", auto: cutoff(3), volume(2)" — lane names + point counts, in lane order; empty when
// the clip has no automation (the common case, and every v0.8-and-earlier file).
function clipAutomationSummary(c: BeatClip): string {
  if (c.automation.length === 0) return ''
  return `, auto: ${c.automation.map((l) => `${l.param}(${l.points.length})`).join(', ')}`
}

function describeTrack(t: BeatTrack, loopSteps: number): string[] {
  const lines: string[] = []
  const s = t.synth
  lines.push(`${t.id}  "${t.name}"  ${t.kind}  ${t.color}`)
  if (t.kind === 'instrument' && t.instrument) {
    lines.push(`  soundfont: ${t.instrument.sample} program ${formatNumber(t.instrument.program)}, ${formatNumber(t.instrument.volume)} dB, pan ${formatNumber(t.instrument.pan)}`)
  } else {
    lines.push(`  synth: ${s.osc}, ${formatNumber(s.volume)} dB, cutoff ${formatNumber(s.cutoff)} Hz, res ${formatNumber(s.resonance)}, ADSR ${formatNumber(s.attack)}/${formatNumber(s.decay)}/${formatNumber(s.sustain)}/${formatNumber(s.release)}, pan ${formatNumber(s.pan)}`)
  }
  // v0.10: the ordered insert-effect chain (synth tracks only) — always shown, even at the default
  // order, so an agent can see chain order without diffing against the format's default.
  if (t.kind === 'synth') {
    const chain = t.effects.map((e) => `${e.id}(${e.type}${e.enabled ? '' : ', bypassed'})`).join(' -> ')
    lines.push(`  effects: ${chain || '(none)'}`)
  }
  if (t.kind === 'drums') {
    // v0.8: hits are free-timed events. Render the first bar as a 16-step grid VIEW (X >= 0.75,
    // x > 0, . = off — a hit shows in the cell nearest its start) and count off-grid hits (a
    // fractional start) separately, so loose/tapped timing is visible without the grid lying.
    for (const lane of DRUM_LANES) {
      const laneHits = t.hits.filter((h) => h.lane === lane)
      const grid = Array<number>(16).fill(0)
      let offGrid = 0
      for (const h of laneHits) {
        if (!Number.isInteger(h.start)) offGrid++
        const cell = ((Math.round(h.start) % 16) + 16) % 16
        if (h.velocity > grid[cell]!) grid[cell] = h.velocity
      }
      const strip = grid.map((v) => (v === 0 ? '.' : v >= 0.75 ? 'X' : 'x')).join('')
      const off = offGrid > 0 ? `, ${offGrid} off-grid` : ''
      lines.push(`  ${lane.padEnd(7)} ${strip}  (${laneHits.length} hit${laneHits.length === 1 ? '' : 's'}${off})`)
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
  if (t.clips.length > 0) {
    lines.push(`  clips: ${t.clips.map((c) => `${c.id} (${t.kind === 'drums' ? `${c.hits.length} hits` : `${c.notes.length} note${c.notes.length === 1 ? '' : 's'}`}${clipAutomationSummary(c)})`).join(', ')}`)
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
  for (const s of doc.scenes) {
    const slots = Object.entries(s.slots).map(([tr, c]) => `${tr}=${c}`).join(' ')
    lines.push(`scene ${s.id}: ${slots || '(empty)'}`)
  }
  if (doc.scenes.length > 0) lines.push('')
  if (doc.song) {
    const total = doc.song.reduce((sum, x) => sum + x.bars, 0)
    lines.push(`song: ${doc.song.map((x) => `${x.scene}(${x.bars})`).join(' ')} — ${total} bars total`)
  }
  return lines.join('\n').replace(/\n+$/, '\n')
}
