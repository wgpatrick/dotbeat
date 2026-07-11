// `beat set` primitives — docs/phase-2-plan.md §2.2. Pure document -> document functions; the
// CLI serializes canonically afterward, which is what turns each of these into a clean one-line
// (or one-edit) git diff. Strict on unknown paths/tracks/lanes — same fail-loudly stance as the
// parser: an agent-issued edit that doesn't land exactly where intended must error, not guess.

import type { BeatDocument, BeatDrumPattern, BeatNote, BeatSynth, BeatTrack, DrumLane, OscType, TrackKind } from './document.js'
import { DRUM_LANES, INIT_SYNTH, OSC_TYPES, SYNTH_FIELD_BY_KEY, SYNTH_FIELDS, SYNTH_PARAM_ORDER, TRACK_COLORS, TRACK_KINDS } from './document.js'

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

  // required core synth params
  if ((SYNTH_PARAM_ORDER as readonly string[]).includes(rest)) {
    const param = rest as keyof BeatSynth
    if (param === 'osc') {
      if (!(OSC_TYPES as readonly string[]).includes(value)) throw new BeatEditError(`osc must be one of ${OSC_TYPES.join('|')}, got "${value}"`)
      return replaceTrack(doc, { ...track, synth: { ...track.synth, osc: value as OscType } })
    }
    return replaceTrack(doc, { ...track, synth: { ...track.synth, [param]: parseNum(value, rest) } })
  }

  // v0.3 optional synth fields, table-driven
  const def = SYNTH_FIELD_BY_KEY.get(rest)
  if (def) {
    switch (def.kind) {
      case 'number':
        return replaceTrack(doc, { ...track, synth: { ...track.synth, [def.key]: parseNum(value, rest) } })
      case 'enum':
        if (!def.values!.includes(value)) throw new BeatEditError(`${rest} must be one of ${def.values!.join('|')}, got "${value}"`)
        return replaceTrack(doc, { ...track, synth: { ...track.synth, [def.key]: value } })
      case 'bool':
        if (value !== 'true' && value !== 'false') throw new BeatEditError(`${rest} must be true or false, got "${value}"`)
        return replaceTrack(doc, { ...track, synth: { ...track.synth, [def.key]: value === 'true' } })
      case 'trackref': {
        const ref = value === 'none' ? null : value
        if (ref !== null && !doc.tracks.some((t) => t.id === ref)) throw new BeatEditError(`${rest} must reference an existing track or "none", got "${value}"`)
        return replaceTrack(doc, { ...track, synth: { ...track.synth, [def.key]: ref } })
      }
    }
  }

  throw new BeatEditError(
    `unknown field "${rest}" on track "${trackId}" (core: ${SYNTH_PARAM_ORDER.join(', ')}; shaped: ${SYNTH_FIELDS.map((f) => f.key).join(', ')}; also name, color, pattern.<lane>[i])`,
  )
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

function validateTrackIdentity(id: string, name: string, color: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new BeatEditError(`track ids are single alphanumeric/_/- tokens, got "${id}"`)
  if (/\s/.test(name)) throw new BeatEditError('track names are single tokens in v0.2 (no whitespace)')
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new BeatEditError(`color must be a lowercase hex color like #c678dd, got "${color}"`)
}

const emptyBeatPattern = (): BeatDrumPattern =>
  Object.fromEntries(DRUM_LANES.map((lane) => [lane, Array<number>(16).fill(0)])) as BeatDrumPattern

/** Adds a new track with the format's init patch (INIT_SYNTH; empty 16-step pattern for drums).
 * Color defaults cycle TRACK_COLORS by track index; name defaults to the id. */
export function addTrack(
  doc: BeatDocument,
  opts: { id: string; kind: TrackKind; name?: string; color?: string },
): { doc: BeatDocument; track: BeatTrack } {
  const { id, kind } = opts
  if (!(TRACK_KINDS as readonly string[]).includes(kind)) throw new BeatEditError(`track kind must be one of ${TRACK_KINDS.join('|')}, got "${kind}"`)
  if (doc.tracks.some((t) => t.id === id)) throw new BeatEditError(`track id "${id}" already exists`)
  const name = opts.name ?? id
  const color = opts.color ?? TRACK_COLORS[doc.tracks.length % TRACK_COLORS.length]!
  validateTrackIdentity(id, name, color)
  const track: BeatTrack = {
    id,
    name,
    color,
    kind,
    synth: { ...INIT_SYNTH },
    laneSamples: {},
    clips: [],
    notes: [],
    ...(kind === 'drums' ? { pattern: emptyBeatPattern() } : {}),
  }
  return { doc: { ...doc, tracks: [...doc.tracks, track] }, track }
}

/** Removes a track. A document keeps at least one track (the grammar's selected_track needs a
 * referent); if the removed track was selected, selection falls back to the first remaining. */
export function removeTrack(doc: BeatDocument, trackId: string): { doc: BeatDocument; track: BeatTrack } {
  const track = findTrack(doc, trackId)
  if (doc.tracks.length === 1) throw new BeatEditError('cannot remove the last track — a document keeps at least one')
  // Clean up every reference to the removed track, or the canonical output would fail its own
  // parse: duckSource refs fall back to none, scene slots for the track are dropped.
  const tracks = doc.tracks
    .filter((t) => t.id !== trackId)
    .map((t) => (t.synth.duckSource === trackId ? { ...t, synth: { ...t.synth, duckSource: null } } : t))
  const scenes = doc.scenes.map((s) => {
    if (!(trackId in s.slots)) return s
    const slots = { ...s.slots }
    delete slots[trackId]
    return { ...s, slots }
  })
  const selectedTrack = doc.selectedTrack === trackId ? tracks[0]!.id : doc.selectedTrack
  return { doc: { ...doc, tracks, scenes, selectedTrack }, track }
}

/** v0.5 media primitives. Registers (or re-pins) a content-addressed sample. Hash computation
 * is the CALLER's job (core stays fs-free); the CLI computes sha256 from the real file. */
export function setMediaSample(doc: BeatDocument, id: string, sha256: string, path: string): BeatDocument {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new BeatEditError(`sample ids are single alphanumeric/_/- tokens, got "${id}"`)
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new BeatEditError('sha256 must be 64 lowercase hex chars')
  if (path.startsWith('/') || path.includes('..')) throw new BeatEditError(`sample paths must be relative without "..", got "${path}"`)
  const entry = { id, sha256, path }
  const existing = doc.media.findIndex((m) => m.id === id)
  const media = existing === -1 ? [...doc.media, entry] : doc.media.map((m, i) => (i === existing ? entry : m))
  return { ...doc, media }
}

/** v0.5: assigns (or clears, with ref = null) a drum lane's one-shot sample. */
export function setLaneSample(
  doc: BeatDocument,
  trackId: string,
  lane: DrumLane,
  ref: { sample: string; gainDb: number; tune: number } | null,
): BeatDocument {
  const track = findTrack(doc, trackId)
  if (track.kind !== 'drums') throw new BeatEditError(`track "${trackId}" is a ${track.kind} track — lane samples only belong on drum tracks`)
  if (!(DRUM_LANES as readonly string[]).includes(lane)) throw new BeatEditError(`unknown drum lane "${lane}" (expected one of ${DRUM_LANES.join('|')})`)
  const laneSamples = { ...track.laneSamples }
  if (ref === null) {
    delete laneSamples[lane]
  } else {
    if (!doc.media.some((m) => m.id === ref.sample)) throw new BeatEditError(`no sample "${ref.sample}" in the media block (have: ${doc.media.map((m) => m.id).join(', ') || 'none'}) — register it with beat sample first`)
    if (ref.tune < -24 || ref.tune > 24) throw new BeatEditError(`lane tune must be -24..24 semitones, got ${ref.tune}`)
    laneSamples[lane] = { ...ref }
  }
  return replaceTrack(doc, { ...track, laneSamples })
}

/** A fresh document with one starter synth track — what `beat init` writes. */
export function initDocument(opts: { bpm?: number; loopBars?: number; trackId?: string } = {}): BeatDocument {
  const bpm = opts.bpm ?? 120
  const loopBars = opts.loopBars ?? 2
  if (!Number.isInteger(bpm) || bpm < 20 || bpm > 999) throw new BeatEditError(`bpm must be an integer 20-999, got ${bpm}`)
  if (!Number.isInteger(loopBars) || loopBars < 1 || loopBars > 64) throw new BeatEditError(`loop_bars must be an integer 1-64, got ${loopBars}`)
  const base: BeatDocument = { formatVersion: '0.5', bpm, loopBars, selectedTrack: '', media: [], tracks: [], scenes: [], song: null }
  const { doc } = addTrack(base, { id: opts.trackId ?? 'lead', kind: 'synth' })
  return { ...doc, selectedTrack: doc.tracks[0]!.id }
}

/** v0.4 song primitives — the arrangement-timeline edit surface (docs/phase-6-plan.md §6.4). */

/** Snapshots a track's live content into a named clip (beatlab's saveClip, format-side).
 * Overwrites an existing clip with the same id — re-snapshotting is the common workflow. */
export function saveClip(doc: BeatDocument, trackId: string, clipId: string): { doc: BeatDocument; created: boolean } {
  const track = findTrack(doc, trackId)
  if (!/^[a-zA-Z0-9_-]+$/.test(clipId)) throw new BeatEditError(`clip ids are single alphanumeric/_/- tokens, got "${clipId}"`)
  const clip = {
    id: clipId,
    notes: track.notes.map((n) => ({ ...n })),
    ...(track.kind === 'drums' && track.pattern ? { pattern: structuredClone(track.pattern) } : {}),
  }
  const existing = track.clips.findIndex((c) => c.id === clipId)
  const clips = existing === -1 ? [...track.clips, clip] : track.clips.map((c, i) => (i === existing ? clip : c))
  return { doc: replaceTrack(doc, { ...track, clips }), created: existing === -1 }
}

/** Sets (or creates) a scene's slot map. Every slot must reference an existing clip on an
 * existing track — same fail-loudly stance as the parser. */
export function setScene(doc: BeatDocument, sceneId: string, slots: Record<string, string>): BeatDocument {
  if (!/^[a-zA-Z0-9_-]+$/.test(sceneId)) throw new BeatEditError(`scene ids are single alphanumeric/_/- tokens, got "${sceneId}"`)
  for (const [trackId, clipId] of Object.entries(slots)) {
    const track = findTrack(doc, trackId)
    if (!track.clips.some((c) => c.id === clipId)) throw new BeatEditError(`track "${trackId}" has no clip "${clipId}" (have: ${track.clips.map((c) => c.id).join(', ') || 'none'})`)
  }
  const scene = { id: sceneId, slots: { ...slots } }
  const existing = doc.scenes.findIndex((s) => s.id === sceneId)
  const scenes = existing === -1 ? [...doc.scenes, scene] : doc.scenes.map((s, i) => (i === existing ? scene : s))
  return { ...doc, scenes }
}

/** Replaces the song's section list (the whole timeline is one statement — sections are few and
 * order is the data, so replace-not-patch is the honest edit shape). Empty list clears the song
 * block (back to loop mode). */
export function setSong(doc: BeatDocument, sections: { scene: string; bars: number }[]): BeatDocument {
  for (const s of sections) {
    if (!doc.scenes.some((sc) => sc.id === s.scene)) throw new BeatEditError(`no scene "${s.scene}" (have: ${doc.scenes.map((x) => x.id).join(', ') || 'none'})`)
    if (!Number.isInteger(s.bars) || s.bars < 1 || s.bars > 64) throw new BeatEditError(`section bars must be an integer 1-64, got ${s.bars}`)
  }
  return { ...doc, song: sections.length === 0 ? null : sections.map((s) => ({ ...s })) }
}
