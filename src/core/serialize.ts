import type { BeatAutomationLane, BeatAutomationPoint, BeatDrumHit, BeatDocument, BeatEffect, BeatNote, BeatScene, BeatTrack } from './document.js'
import { DRUM_LANES, SYNTH_FIELDS, SYNTH_PARAM_ORDER, isDefaultEffectChain } from './document.js'
import { formatNumber } from './format.js'

// v0.10: the effect chain serializes iff it differs from the canonical default (isDefaultEffectChain)
// — same canonical-elision discipline as v0.3's synth fields. An unmodified (or pre-v0.10) track
// emits ZERO effect lines and round-trips byte-identically; an explicitly emptied chain emits the
// `effects none` sentinel (there'd otherwise be no way to tell "emptied" from "never declared"
// apart on the next parse); anything else emits one `effect <id> <type>[ bypassed]` line per
// entry, IN LIST ORDER — the file's order IS the chain order, no re-sorting.
function serializeEffectLines(effects: BeatEffect[], indent: string): string[] {
  if (isDefaultEffectChain(effects)) return []
  if (effects.length === 0) return [`${indent}effects none`]
  return effects.map((e) => `${indent}effect ${e.id} ${e.type}${e.enabled ? '' : ' bypassed'}`)
}

// Canonical note order: (start, pitch, id) ascending — see format-spec.md's "canonical ordering".
function sortedNoteLines(notes: BeatNote[], indent: string): string[] {
  return [...notes]
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch || a.id.localeCompare(b.id))
    .map((n) => `${indent}note ${n.id} ${n.pitch} ${formatNumber(n.start)} ${formatNumber(n.duration)} ${formatNumber(n.velocity)}`)
}

// v0.8: canonical drum-hit order is (start, lane-in-DRUM_LANES-order, id) ascending — one hit per
// line, so an added/moved hit is a one-line diff. Hits are free-timed events (research 12); the
// old fixed-grid `pattern` lines are gone from the grammar (migrated on parse).
const laneIndex = (lane: string) => DRUM_LANES.indexOf(lane as (typeof DRUM_LANES)[number])
function sortedHitLines(hits: BeatDrumHit[], indent: string): string[] {
  return [...hits]
    .sort((a, b) => a.start - b.start || laneIndex(a.lane) - laneIndex(b.lane) || a.id.localeCompare(b.id))
    .map((h) => `${indent}hit ${h.id} ${h.lane} ${formatNumber(h.start)} ${formatNumber(h.velocity)}`)
}

// v0.9: canonical automation point order is (time, id) ascending, same discipline as notes/hits.
function sortedPointLines(points: BeatAutomationPoint[], indent: string): string[] {
  return [...points]
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
    .map((p) => `${indent}point ${p.id} ${formatNumber(p.time)} ${formatNumber(p.value)}`)
}

// v0.9: automation lanes serialize in source order (first-seen — like clips themselves; order
// of creation is meaningful, not alphabetized). `trackId` prefixes the target so each `auto`
// line is self-describing (same <track>.<param> addressing `beat set` already uses).
function serializeAutomationLanes(trackId: string, lanes: BeatAutomationLane[], indent: string): string[] {
  const lines: string[] = []
  for (const lane of lanes) {
    lines.push(`${indent}auto ${trackId}.${lane.param}`)
    lines.push(...sortedPointLines(lane.points, `${indent}  `))
  }
  return lines
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
    // v0.8+: instrument clips carry notes only (same grammar as synth-track clips)
    for (const clip of t.clips) {
      lines.push(`  clip ${clip.id}`)
      lines.push(...sortedNoteLines(clip.notes, '    '))
    }
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
  // v0.10: the ordered insert-effect chain (synth tracks only — drums/instrument never serialize
  // effect lines; their `effects` field stays [] and is not this feature's concern, see
  // BeatTrack.effects).
  if (t.kind === 'synth') lines.push(...serializeEffectLines(t.effects, '  '))
  // v0.5 lane samples: DRUM_LANES order (canonical), one line per assigned lane.
  if (t.kind === 'drums') {
    for (const lane of DRUM_LANES) {
      const ls = t.laneSamples[lane]
      if (ls) lines.push(`  lane ${lane} ${ls.sample} ${formatNumber(ls.gainDb)} ${formatNumber(ls.tune)}`)
    }
  }
  // v0.4 clips: source order (creation order is meaningful, like tracks); content in canonical
  // form (sorted notes / sorted hits) one indent level deeper than live content.
  for (const clip of t.clips) {
    lines.push(`  clip ${clip.id}`)
    if (t.kind === 'drums') lines.push(...sortedHitLines(clip.hits, '    '))
    lines.push(...sortedNoteLines(clip.notes, '    '))
    lines.push(...serializeAutomationLanes(t.id, clip.automation, '    '))
  }
  if (t.kind === 'drums') {
    lines.push(...sortedHitLines(t.hits, '  '))
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
