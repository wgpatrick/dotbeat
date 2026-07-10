// `beat set` primitives — docs/phase-2-plan.md §2.2. Pure document -> document functions; the
// CLI serializes canonically afterward, which is what turns each of these into a clean one-line
// (or one-edit) git diff. Strict on unknown paths/tracks/lanes — same fail-loudly stance as the
// parser: an agent-issued edit that doesn't land exactly where intended must error, not guess.

import type { BeatDocument, BeatNote, BeatSynth, BeatTrack, DrumLane, OscType } from './document.js'
import { DRUM_LANES, OSC_TYPES, SYNTH_PARAM_ORDER } from './document.js'

export class BeatEditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatEditError'
  }
}

function findTrack(doc: BeatDocument, trackId: string): BeatTrack {
  const t = doc.tracks.find((x) => x.id === trackId)
  if (!t) throw new BeatEditError(`no track "${trackId}" (have: ${doc.tracks.map((x) => x.id).join(', ')})`)
  return t
}

function replaceTrack(doc: BeatDocument, next: BeatTrack): BeatDocument {
  return { ...doc, tracks: doc.tracks.map((t) => (t.id === next.id ? next : t)) }
}

function parseNum(value: string, what: string): number {
  const n = Number(value)
  if (value.trim() === '' || !Number.isFinite(n)) throw new BeatEditError(`${what} expected a number, got "${value}"`)
  return n
}

/** Applies one `path = value` edit. Paths (the same names the file itself uses — no second
 * vocabulary to learn):
 *
 *   bpm 124                      loop_bars 8                selected_track lead
 *   lead.cutoff 900              lead.osc square            lead.name Lead2
 *   lead.color #aabbcc           drums.pattern.kick[3] 0.7
 *
 * Returns a new document; never mutates. */
export function setValue(doc: BeatDocument, path: string, value: string): BeatDocument {
  // header fields
  if (path === 'bpm') return { ...doc, bpm: parseNum(value, 'bpm') }
  if (path === 'loop_bars') return { ...doc, loopBars: parseNum(value, 'loop_bars') }
  if (path === 'selected_track') {
    findTrack(doc, value) // must reference a real track
    return { ...doc, selectedTrack: value }
  }

  const dot = path.indexOf('.')
  if (dot === -1) throw new BeatEditError(`unknown path "${path}" (expected bpm, loop_bars, selected_track, or <track>.<field>)`)
  const trackId = path.slice(0, dot)
  const rest = path.slice(dot + 1)
  const track = findTrack(doc, trackId)

  // pattern step: <track>.pattern.<lane>[<step>]
  const patternMatch = rest.match(/^pattern\.([a-z]+)\[(\d+)\]$/)
  if (patternMatch) {
    if (track.kind !== 'drums') throw new BeatEditError(`track "${trackId}" is a ${track.kind} track — no pattern to edit`)
    const lane = patternMatch[1]!
    if (!(DRUM_LANES as readonly string[]).includes(lane)) throw new BeatEditError(`unknown drum lane "${lane}" (expected one of ${DRUM_LANES.join('|')})`)
    const step = Number(patternMatch[2]!)
    const steps = track.pattern![lane as DrumLane]
    if (step >= steps.length) throw new BeatEditError(`step ${step} out of range (pattern has ${steps.length} steps, 0-${steps.length - 1})`)
    const vel = parseNum(value, `pattern.${lane}[${step}]`)
    if (vel < 0 || vel > 1) throw new BeatEditError(`step velocities must be 0..1, got ${vel}`)
    const nextSteps = [...steps]
    nextSteps[step] = vel
    return replaceTrack(doc, { ...track, pattern: { ...track.pattern!, [lane]: nextSteps } })
  }

  // track metadata
  if (rest === 'name') {
    if (/\s/.test(value)) throw new BeatEditError('track names are single tokens in v0.2 (no whitespace)')
    return replaceTrack(doc, { ...track, name: value })
  }
  if (rest === 'color') {
    if (!/^#[0-9a-f]{6}$/.test(value)) throw new BeatEditError(`color must be a lowercase hex color like #c678dd, got "${value}"`)
    return replaceTrack(doc, { ...track, color: value })
  }

  // synth params
  if ((SYNTH_PARAM_ORDER as string[]).includes(rest)) {
    const param = rest as keyof BeatSynth
    if (param === 'osc') {
      if (!(OSC_TYPES as readonly string[]).includes(value)) throw new BeatEditError(`osc must be one of ${OSC_TYPES.join('|')}, got "${value}"`)
      return replaceTrack(doc, { ...track, synth: { ...track.synth, osc: value as OscType } })
    }
    return replaceTrack(doc, { ...track, synth: { ...track.synth, [param]: parseNum(value, rest) } })
  }

  throw new BeatEditError(`unknown field "${rest}" on track "${trackId}" (synth params: ${SYNTH_PARAM_ORDER.join(', ')}; also name, color, pattern.<lane>[i])`)
}

/** Adds a note to a synth track. If `id` is omitted, mints the next free `u<n>` id (the same
 * prefix BeatLab's own recordNote uses, chosen above the current max so it can't collide). */
export function addNote(doc: BeatDocument, trackId: string, note: { pitch: number; start: number; duration: number; velocity: number; id?: string }): { doc: BeatDocument; note: BeatNote } {
  const track = findTrack(doc, trackId)
  if (track.kind !== 'synth') throw new BeatEditError(`track "${trackId}" is a ${track.kind} track — notes only belong on synth tracks`)
  if (note.pitch < 0 || note.pitch > 127 || !Number.isInteger(note.pitch)) throw new BeatEditError(`pitch must be an integer 0-127, got ${note.pitch}`)
  if (!Number.isInteger(note.start) || note.start < 0) throw new BeatEditError(`start must be a non-negative integer step, got ${note.start}`)
  if (!Number.isInteger(note.duration) || note.duration < 1) throw new BeatEditError(`duration must be an integer >= 1 step, got ${note.duration}`)
  if (note.velocity < 0 || note.velocity > 1) throw new BeatEditError(`velocity must be 0..1, got ${note.velocity}`)

  let id = note.id
  if (id === undefined) {
    let max = 100000
    for (const t of doc.tracks) for (const n of t.notes) {
      const m = n.id.match(/^u(\d+)$/)
      if (m) max = Math.max(max, Number(m[1]))
    }
    id = `u${max + 1}`
  } else if (doc.tracks.some((t) => t.notes.some((n) => n.id === id))) {
    throw new BeatEditError(`note id "${id}" already exists`)
  }

  const added: BeatNote = { id, pitch: note.pitch, start: note.start, duration: note.duration, velocity: note.velocity }
  return { doc: replaceTrack(doc, { ...track, notes: [...track.notes, added] }), note: added }
}

/** Removes a note by id from a track. */
export function removeNote(doc: BeatDocument, trackId: string, noteId: string): { doc: BeatDocument; note: BeatNote } {
  const track = findTrack(doc, trackId)
  const note = track.notes.find((n) => n.id === noteId)
  if (!note) throw new BeatEditError(`no note "${noteId}" on track "${trackId}"`)
  return { doc: replaceTrack(doc, { ...track, notes: track.notes.filter((n) => n.id !== noteId) }), note }
}
