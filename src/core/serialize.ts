import type { BeatDocument, BeatDrumPattern, BeatNote, BeatScene, BeatTrack } from './document.js'
import { DRUM_LANES, SYNTH_FIELDS, SYNTH_PARAM_ORDER } from './document.js'
import { formatNumber } from './format.js'

// Canonical note order: (start, pitch, id) ascending — see format-spec.md's "canonical ordering".
function sortedNoteLines(notes: BeatNote[], indent: string): string[] {
  return [...notes]
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch || a.id.localeCompare(b.id))
    .map((n) => `${indent}note ${n.id} ${n.pitch} ${n.start} ${n.duration} ${formatNumber(n.velocity)}`)
}

// Canonical: all five lanes, always, in DRUM_LANES order — a step toggle is always a one-line
// diff and never inserts/deletes lines. See format-spec.md.
function patternLines(pattern: BeatDrumPattern, indent: string): string[] {
  return DRUM_LANES.map((lane) => `${indent}pattern ${lane} ${pattern[lane].map(formatNumber).join(' ')}`)
}

function serializeTrack(t: BeatTrack): string[] {
  const lines: string[] = []
  lines.push(`track ${t.id} ${t.name} ${t.color} ${t.kind}`)
  // v0.6 instrument tracks: a soundfont voice line instead of a synth block; volume/pan elided
  // at their defaults (-10 dB, center) like every optional field.
  if (t.kind === 'instrument') {
    const inst = t.instrument!
    lines.push(`  soundfont ${inst.sample} ${formatNumber(inst.program)}`)
    if (formatNumber(inst.volume) !== '-10') lines.push(`  volume ${formatNumber(inst.volume)}`)
    if (formatNumber(inst.pan) !== '0') lines.push(`  pan ${formatNumber(inst.pan)}`)
    lines.push(...sortedNoteLines(t.notes, '  '))
    return lines
  }
  lines.push(`  synth`)
  for (const key of SYNTH_PARAM_ORDER) {
    const value = t.synth[key]
    lines.push(`    ${key} ${key === 'osc' ? String(value) : formatNumber(value as number)}`)
  }
  // v0.3 optional fields: canonical elision — emitted iff != default, in table order. One
  // canonical form per state (the elision rule is deterministic in both directions).
  for (const def of SYNTH_FIELDS) {
    const value = t.synth[def.key]
    if (value === def.default) continue
    // number defaults compare by value; formatNumber-normalized equality guards float noise
    if (def.kind === 'number' && formatNumber(value as number) === formatNumber(def.default as number)) continue
    const text = def.kind === 'number' ? formatNumber(value as number) : def.kind === 'trackref' ? (value === null ? 'none' : String(value)) : String(value)
    lines.push(`    ${def.key} ${text}`)
  }
  // v0.5 lane samples: DRUM_LANES order (canonical), one line per assigned lane.
  if (t.kind === 'drums') {
    for (const lane of DRUM_LANES) {
      const ls = t.laneSamples[lane]
      if (ls) lines.push(`  lane ${lane} ${ls.sample} ${formatNumber(ls.gainDb)} ${formatNumber(ls.tune)}`)
    }
  }
  // v0.4 clips: source order (creation order is meaningful, like tracks); content in canonical
  // form (sorted notes / all-five-lanes patterns) one indent level deeper than live content.
  for (const clip of t.clips) {
    lines.push(`  clip ${clip.id}`)
    if (t.kind === 'drums' && clip.pattern) lines.push(...patternLines(clip.pattern, '    '))
    lines.push(...sortedNoteLines(clip.notes, '    '))
  }
  if (t.kind === 'drums' && t.pattern) {
    lines.push(...patternLines(t.pattern, '  '))
  }
  lines.push(...sortedNoteLines(t.notes, '  '))
  return lines
}

// v0.4: scene slots serialize in TRACK order (not insertion order) — one canonical form, and a
// re-mapped slot is a one-line diff.
function serializeScene(scene: BeatScene, trackOrder: string[]): string[] {
  const lines = [`scene ${scene.id}`]
  for (const trackId of trackOrder) {
    const clipId = scene.slots[trackId]
    if (clipId !== undefined) lines.push(`  slot ${trackId} ${clipId}`)
  }
  return lines
}

// Deterministic: two BeatDocuments that are musically identical always serialize to
// byte-identical text (canonical field order, canonical number formatting, canonical note sort —
// see document.ts and format.ts). Track order is preserved as given (source order is meaningful,
// see format-spec.md), everything within a track is put in canonical form. Canonical block
// order: header, tracks, scenes, song.
export function serialize(doc: BeatDocument): string {
  const lines: string[] = [
    `format_version ${doc.formatVersion}`,
    `bpm ${formatNumber(doc.bpm)}`,
    `loop_bars ${formatNumber(doc.loopBars)}`,
    `selected_track ${doc.selectedTrack}`,
  ]
  if (doc.media.length > 0) {
    lines.push('', 'media')
    for (const m of doc.media) {
      lines.push(`  sample ${m.id} sha256:${m.sha256} ${m.path}`)
    }
  }
  for (const t of doc.tracks) {
    lines.push('', ...serializeTrack(t))
  }
  const trackOrder = doc.tracks.map((t) => t.id)
  for (const scene of doc.scenes) {
    lines.push('', ...serializeScene(scene, trackOrder))
  }
  if (doc.song) {
    lines.push('', 'song')
    for (const section of doc.song) {
      lines.push(`  section ${section.scene} ${formatNumber(section.bars)}`)
    }
  }
  return lines.join('\n') + '\n'
}
