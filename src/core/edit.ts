// `beat set` primitives — docs/phase-2-plan.md §2.2. Pure document -> document functions; the
// CLI serializes canonically afterward, which is what turns each of these into a clean one-line
// (or one-edit) git diff. Strict on unknown paths/tracks/lanes — same fail-loudly stance as the
// parser: an agent-issued edit that doesn't land exactly where intended must error, not guess.

import type { BeatAutomationPoint, BeatClip, BeatDrumHit, BeatDocument, BeatNote, BeatSynth, BeatTrack, DrumLane, OscType, TrackKind } from './document.js'
import { AUTOMATABLE_SYNTH_PARAMS, DRUM_LANES, INIT_SYNTH, OSC_TYPES, SYNTH_FIELD_BY_KEY, SYNTH_FIELDS, SYNTH_PARAM_ORDER, TRACK_COLORS, TRACK_KINDS } from './document.js'
import { formatNumber } from './format.js'

/** Snaps a value to the format's canonical 4-decimal precision (format.ts), so numbers stored
 * in a document survive a serialize→parse round-trip deep-equal. */
const canon = (n: number): number => Number(formatNumber(n))

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

  // pattern step: <track>.pattern.<lane>[<step>] — v0.8 grid SUGAR over free-timed hits.
  // Upserts/removes the on-grid hit at integer step `step` (canonical id `<lane><step>`); a
  // velocity of 0 removes it. Off-grid hits at fractional starts are untouched. Keeps the
  // familiar step-toggle vocabulary working over the event model (research 12: grid as input).
  const patternMatch = rest.match(/^pattern\.([a-z]+)\[(\d+)\]$/)
  if (patternMatch) {
    if (track.kind !== 'drums') throw new BeatEditError(`track "${trackId}" is a ${track.kind} track — no pattern to edit`)
    const lane = patternMatch[1]!
    if (!(DRUM_LANES as readonly string[]).includes(lane)) throw new BeatEditError(`unknown drum lane "${lane}" (expected one of ${DRUM_LANES.join('|')})`)
    const step = Number(patternMatch[2]!)
    const maxStep = doc.loopBars * 16
    if (step >= maxStep) throw new BeatEditError(`step ${step} out of range (loop is ${maxStep} steps, 0-${maxStep - 1}); use beat add-hit for an off-grid hit past the loop`)
    const vel = parseNum(value, `pattern.${lane}[${step}]`)
    if (vel < 0 || vel > 1) throw new BeatEditError(`step velocities must be 0..1, got ${vel}`)
    const id = `${lane}${step}`
    const rest2 = track.hits.filter((h) => h.id !== id && !(h.lane === lane && h.start === step))
    const nextHits = vel > 0 ? [...rest2, { id, lane: lane as DrumLane, start: step, velocity: canon(vel) }] : rest2
    return replaceTrack(doc, { ...track, hits: nextHits })
  }

  // note grammar (synth/instrument tracks) — the piano-roll edit primitive, the note-side analog
  // of `pattern.<lane>[<step>]` for drums. Added so dotbeat's GUI can compose notes through the
  // same `beat set`/`POST /edit` {path,value} channel (one edit -> one canonical line), rather
  // than a separate route:
  //   <track>.note  "<pitch> <start> <duration> <velocity>"  -> add (mints the next u-id)
  //   <track>.note.<id>.pitch|start|duration|velocity  <n>   -> move/resize/transpose one field
  //   <track>.note.<id>  ""                                  -> delete (empty value removes)
  if (rest === 'note') {
    const parts = value.trim().split(/\s+/)
    if (parts.length !== 4) throw new BeatEditError(`note add expects "<pitch> <start> <duration> <velocity>", got "${value}"`)
    const [pitch, start, duration, velocity] = parts.map((p, i) => parseNum(p, ['pitch', 'start', 'duration', 'velocity'][i]!))
    return addNote(doc, trackId, { pitch: pitch!, start: start!, duration: duration!, velocity: velocity! }).doc
  }
  const noteFieldMatch = rest.match(/^note\.([A-Za-z0-9_-]+)\.(pitch|start|duration|velocity)$/)
  if (noteFieldMatch) {
    const noteId = noteFieldMatch[1]!
    const field = noteFieldMatch[2]! as 'pitch' | 'start' | 'duration' | 'velocity'
    const existing = track.notes.find((n) => n.id === noteId)
    if (!existing) throw new BeatEditError(`no note "${noteId}" on track "${trackId}"`)
    const n = parseNum(value, `note.${noteId}.${field}`)
    // Round-trip through remove+add so addNote's own range/precision invariants apply and the id
    // is preserved (canonical serialization re-sorts either way, so a moved note reads as a moved
    // line — the same diff `beat set` would produce).
    const removed = removeNote(doc, trackId, noteId).doc
    return addNote(removed, trackId, {
      id: noteId,
      pitch: field === 'pitch' ? n : existing.pitch,
      start: field === 'start' ? n : existing.start,
      duration: field === 'duration' ? n : existing.duration,
      velocity: field === 'velocity' ? n : existing.velocity,
    }).doc
  }
  const noteDeleteMatch = rest.match(/^note\.([A-Za-z0-9_-]+)$/)
  if (noteDeleteMatch) {
    if (value.trim() !== '') throw new BeatEditError(`note delete takes an empty value (got "${value}"); to edit a field use ${trackId}.note.${noteDeleteMatch[1]}.<pitch|start|duration|velocity>`)
    return removeNote(doc, trackId, noteDeleteMatch[1]!).doc
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

  // v0.6 instrument tracks: their small field set, validated in place
  if (track.kind === 'instrument') {
    const inst = track.instrument!
    if (rest === 'volume') return replaceTrack(doc, { ...track, instrument: { ...inst, volume: parseNum(value, 'volume') } })
    if (rest === 'pan') {
      const p = parseNum(value, 'pan')
      if (p < -1 || p > 1) throw new BeatEditError(`pan must be -1..1, got ${p}`)
      return replaceTrack(doc, { ...track, instrument: { ...inst, pan: p } })
    }
    if (rest === 'program') {
      const prog = parseNum(value, 'program')
      if (!Number.isInteger(prog) || prog < 0 || prog > 127) throw new BeatEditError(`program must be an integer 0-127, got ${value}`)
      return replaceTrack(doc, { ...track, instrument: { ...inst, program: prog } })
    }
    if (rest === 'soundfont') {
      if (!doc.media.some((m) => m.id === value)) throw new BeatEditError(`no sample "${value}" in the media block — register it with beat sample first`)
      return replaceTrack(doc, { ...track, instrument: { ...inst, sample: value } })
    }
    throw new BeatEditError(`unknown field "${rest}" on instrument track "${trackId}" (have: soundfont, program, volume, pan, name, color)`)
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
  if (track.kind === 'drums') throw new BeatEditError(`track "${trackId}" is a drums track — notes only belong on synth/instrument tracks`)
  if (note.pitch < 0 || note.pitch > 127 || !Number.isInteger(note.pitch)) throw new BeatEditError(`pitch must be an integer 0-127, got ${note.pitch}`)
  // v0.7: fractional steps are legal — live/tapped input lands between grid lines. Values are
  // snapped to the canonical 4-decimal precision on the way in (see format.ts) so a stored doc
  // always deep-equals parse(serialize(doc)).
  if (!Number.isFinite(note.start) || note.start < 0) throw new BeatEditError(`start must be a step position >= 0, got ${note.start}`)
  if (!Number.isFinite(note.duration) || note.duration <= 0) throw new BeatEditError(`duration must be > 0 steps, got ${note.duration}`)
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

  const duration = canon(note.duration)
  if (duration <= 0) throw new BeatEditError(`duration must be > 0 steps at canonical precision (4 decimals), got ${note.duration}`)
  const added: BeatNote = { id, pitch: note.pitch, start: canon(note.start), duration, velocity: canon(note.velocity) }
  return { doc: replaceTrack(doc, { ...track, notes: [...track.notes, added] }), note: added }
}

export interface QuantizeOptions {
  /** Grid size in 16th steps (1 = 16ths, 2 = 8ths, 4 = quarters, 0.5 = 32nds). Default 1. */
  grid?: number
  /** How far each note moves toward the grid, 0..1 (Ableton's Amount). 1 = full snap. Default 1. */
  amount?: number
  /** Snap note starts. Default true (Ableton's default quantizes starts). */
  starts?: boolean
  /** Also snap note ends (adjusts duration so the end lands on the grid). Default false. */
  ends?: boolean
  /** Restrict to these note ids (a selection). Omitted = every note on the track. */
  noteIds?: string[]
}

/** Quantizes notes toward a grid, Ableton-style: start and/or end snap independently, and
 * `amount` moves notes only part of the way (so tapped-in timing can be tightened without
 * flattening the feel — quantize is an edit here, never a storage default; see format-spec
 * v0.7). Ends never snap onto (or past) the note's own start: a note keeps a minimum length
 * of one grid cell after end-quantize, matching Ableton's behavior. */
export function quantizeNotes(doc: BeatDocument, trackId: string, opts: QuantizeOptions = {}): { doc: BeatDocument; changed: number } {
  const track = findTrack(doc, trackId)
  const grid = opts.grid ?? 1
  const amount = opts.amount ?? 1
  if (!Number.isFinite(grid) || grid <= 0) throw new BeatEditError(`grid must be > 0 steps, got ${grid}`)
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new BeatEditError(`amount must be 0..1, got ${amount}`)

  // v0.8: drum tracks quantize their free-timed hits (starts only — hits are durationless
  // triggers). Same amount knob; noteIds scopes to specific hit ids.
  if (track.kind === 'drums') {
    if (opts.ends) throw new BeatEditError('drum hits have no duration — ends quantize does not apply')
    if (opts.starts === false) throw new BeatEditError('nothing to quantize: drum hits only have starts')
    if (opts.noteIds) {
      const have = new Set(track.hits.map((h) => h.id))
      const missing = opts.noteIds.filter((id) => !have.has(id))
      if (missing.length) throw new BeatEditError(`no hit(s) ${missing.map((m) => `"${m}"`).join(', ')} on track "${trackId}"`)
    }
    const wantedH = opts.noteIds ? new Set(opts.noteIds) : null
    let changedH = 0
    const hits = track.hits.map((h) => {
      if (wantedH && !wantedH.has(h.id)) return h
      const start = canon(h.start + amount * (Math.round(h.start / grid) * grid - h.start))
      if (start === h.start) return h
      changedH++
      return { ...h, start }
    })
    return { doc: replaceTrack(doc, { ...track, hits }), changed: changedH }
  }

  const starts = opts.starts ?? true
  const ends = opts.ends ?? false
  if (!starts && !ends) throw new BeatEditError('nothing to quantize: enable starts and/or ends')
  if (opts.noteIds) {
    const have = new Set(track.notes.map((n) => n.id))
    const missing = opts.noteIds.filter((id) => !have.has(id))
    if (missing.length) throw new BeatEditError(`no note(s) ${missing.map((m) => `"${m}"`).join(', ')} on track "${trackId}"`)
  }
  const wanted = opts.noteIds ? new Set(opts.noteIds) : null
  const toward = (value: number, target: number) => canon(value + amount * (target - value))

  let changed = 0
  const notes = track.notes.map((n) => {
    if (wanted && !wanted.has(n.id)) return n
    let start = n.start
    let end = n.start + n.duration
    if (starts) start = toward(n.start, Math.round(n.start / grid) * grid)
    if (ends) {
      end = toward(n.start + n.duration, Math.round((n.start + n.duration) / grid) * grid)
    } else {
      end = start + n.duration // start-only quantize slides the note, preserving its length
    }
    let duration = canon(end - start)
    if (duration <= 0) duration = canon(grid) // end snapped onto/behind start: keep one grid cell
    if (start === n.start && duration === n.duration) return n
    changed++
    return { ...n, start, duration }
  })
  return { doc: replaceTrack(doc, { ...track, notes }), changed }
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

/** Adds a new track with the format's init patch (INIT_SYNTH; drum tracks start with no hits).
 * Color defaults cycle TRACK_COLORS by track index; name defaults to the id. */
export function addTrack(
  doc: BeatDocument,
  opts: { id: string; kind: TrackKind; name?: string; color?: string; soundfont?: { sample: string; program: number } },
): { doc: BeatDocument; track: BeatTrack } {
  const { id, kind } = opts
  if (!(TRACK_KINDS as readonly string[]).includes(kind)) throw new BeatEditError(`track kind must be one of ${TRACK_KINDS.join('|')}, got "${kind}"`)
  if (doc.tracks.some((t) => t.id === id)) throw new BeatEditError(`track id "${id}" already exists`)
  if (kind === 'instrument') {
    if (!opts.soundfont) throw new BeatEditError('instrument tracks need a soundfont: pass --soundfont <sample-id> [--program N] (register the .sf2 with beat sample first)')
    if (!doc.media.some((m) => m.id === opts.soundfont!.sample)) throw new BeatEditError(`no sample "${opts.soundfont.sample}" in the media block — register it with beat sample first`)
    if (!Number.isInteger(opts.soundfont.program) || opts.soundfont.program < 0 || opts.soundfont.program > 127) throw new BeatEditError(`program must be an integer 0-127, got ${opts.soundfont.program}`)
  }
  const name = opts.name ?? id
  const color = opts.color ?? TRACK_COLORS[doc.tracks.length % TRACK_COLORS.length]!
  validateTrackIdentity(id, name, color)
  const track: BeatTrack = {
    id,
    name,
    color,
    kind,
    // Drum tracks: the "synth" params drive the drum BUS in beatlab (cutoff = bus lowpass), so
    // a fresh drum track opens the filter (beatlab's own bus default) — INIT_SYNTH's 2000 Hz is
    // a lead-synth default that silently swallows hats/cymbals (found via a silent-hat render).
    synth: kind === 'drums' ? { ...INIT_SYNTH, cutoff: 12000, resonance: 0.1 } : { ...INIT_SYNTH },
    ...(kind === 'instrument' ? { instrument: { sample: opts.soundfont!.sample, program: opts.soundfont!.program, volume: -10, pan: 0 } } : {}),
    laneSamples: {},
    clips: [],
    notes: [],
    hits: [],
  }
  return { doc: { ...doc, tracks: [...doc.tracks, track] }, track }
}

/** Adds a free-timed drum hit to a drum track (v0.8). If `id` is omitted, mints the next free
 * `h<n>` id above the current max. start is in fractional 16th steps (snapped to canonical
 * precision); velocity in (0, 1]. */
export function addHit(doc: BeatDocument, trackId: string, hit: { lane: DrumLane; start: number; velocity: number; id?: string }): { doc: BeatDocument; hit: BeatDrumHit } {
  const track = findTrack(doc, trackId)
  if (track.kind !== 'drums') throw new BeatEditError(`track "${trackId}" is a ${track.kind} track — hits only belong on drum tracks`)
  if (!(DRUM_LANES as readonly string[]).includes(hit.lane)) throw new BeatEditError(`unknown drum lane "${hit.lane}" (expected one of ${DRUM_LANES.join('|')})`)
  if (!Number.isFinite(hit.start) || hit.start < 0) throw new BeatEditError(`hit start must be a step position >= 0, got ${hit.start}`)
  if (hit.velocity <= 0 || hit.velocity > 1) throw new BeatEditError(`hit velocity must be in (0, 1], got ${hit.velocity}`)
  let id = hit.id
  if (id === undefined) {
    let max = 0
    for (const h of track.hits) {
      const m = h.id.match(/^h(\d+)$/)
      if (m) max = Math.max(max, Number(m[1]))
    }
    id = `h${max + 1}`
  } else if (track.hits.some((h) => h.id === id)) {
    throw new BeatEditError(`hit id "${id}" already exists on track "${trackId}"`)
  }
  const added: BeatDrumHit = { id, lane: hit.lane, start: canon(hit.start), velocity: canon(hit.velocity) }
  return { doc: replaceTrack(doc, { ...track, hits: [...track.hits, added] }), hit: added }
}

/** Removes a drum hit by id. */
export function removeHit(doc: BeatDocument, trackId: string, hitId: string): { doc: BeatDocument; hit: BeatDrumHit } {
  const track = findTrack(doc, trackId)
  const hit = track.hits.find((h) => h.id === hitId)
  if (!hit) throw new BeatEditError(`no hit "${hitId}" on track "${trackId}"`)
  return { doc: replaceTrack(doc, { ...track, hits: track.hits.filter((h) => h.id !== hitId) }), hit }
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
  const base: BeatDocument = { formatVersion: '0.9', bpm, loopBars, selectedTrack: '', media: [], tracks: [], scenes: [], song: null }
  const { doc } = addTrack(base, { id: opts.trackId ?? 'lead', kind: 'synth' })
  return { ...doc, selectedTrack: doc.tracks[0]!.id }
}

/** v0.4 song primitives — the arrangement-timeline edit surface (docs/phase-6-plan.md §6.4). */

/** Snapshots a track's live content into a named clip (beatlab's saveClip, format-side).
 * Overwrites an existing clip with the same id — re-snapshotting is the common workflow. Notes/
 * hits come from the track's live content (there's no live-track automation to snapshot from —
 * v0.9 automation is clip-scoped only), so a re-snapshot preserves the clip's existing
 * automation lanes rather than wiping them; a brand-new clip starts with none. */
export function saveClip(doc: BeatDocument, trackId: string, clipId: string): { doc: BeatDocument; created: boolean } {
  const track = findTrack(doc, trackId)
  if (!/^[a-zA-Z0-9_-]+$/.test(clipId)) throw new BeatEditError(`clip ids are single alphanumeric/_/- tokens, got "${clipId}"`)
  const existing = track.clips.findIndex((c) => c.id === clipId)
  const clip: BeatClip = {
    id: clipId,
    notes: track.notes.map((n) => ({ ...n })),
    hits: track.kind === 'drums' ? track.hits.map((h) => ({ ...h })) : [],
    automation: existing === -1 ? [] : track.clips[existing]!.automation.map((l) => ({ ...l, points: l.points.map((p) => ({ ...p })) })),
  }
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

/** v0.9 clip automation primitives (docs/phase-9-automation-plan.md). Automation is clip-scoped
 * only (no live/non-clip automation — see format-spec.md's v0.9 section for why); every function
 * here targets `<track>.<clip>` and one automatable synth param. */

function findClip(track: BeatTrack, clipId: string): BeatClip {
  const c = track.clips.find((x) => x.id === clipId)
  if (!c) throw new BeatEditError(`no clip "${clipId}" on track "${track.id}" (have: ${track.clips.map((x) => x.id).join(', ') || 'none'})`)
  return c
}

function replaceClip(doc: BeatDocument, trackId: string, next: BeatClip): BeatDocument {
  const track = findTrack(doc, trackId)
  return replaceTrack(doc, { ...track, clips: track.clips.map((c) => (c.id === next.id ? next : c)) })
}

function checkAutomatableParam(param: string) {
  if (!(AUTOMATABLE_SYNTH_PARAMS as readonly string[]).includes(param)) {
    throw new BeatEditError(`"${param}" is not an automatable synth param (have: ${AUTOMATABLE_SYNTH_PARAMS.join(', ')})`)
  }
}

/** Adds a new automation point to a clip's `param` lane (creating the lane if this is its first
 * point). Mints the next free `p<n>` id scoped to that lane if `id` is omitted; errors if a
 * given id already exists in the lane (use moveAutomationPoint to edit an existing point). */
export function addAutomationPoint(
  doc: BeatDocument,
  trackId: string,
  clipId: string,
  param: string,
  point: { time: number; value: number; id?: string },
): { doc: BeatDocument; point: BeatAutomationPoint } {
  const track = findTrack(doc, trackId)
  checkAutomatableParam(param)
  const clip = findClip(track, clipId)
  if (!Number.isFinite(point.time) || point.time < 0) throw new BeatEditError(`automation point time must be >= 0, got ${point.time}`)
  if (!Number.isFinite(point.value)) throw new BeatEditError(`automation point value must be a finite number, got ${point.value}`)

  const lane = clip.automation.find((l) => l.param === param)
  const points = lane ? lane.points : []
  let id = point.id
  if (id === undefined) {
    let max = 0
    for (const p of points) {
      const m = p.id.match(/^p(\d+)$/)
      if (m) max = Math.max(max, Number(m[1]))
    }
    id = `p${max + 1}`
  } else if (points.some((p) => p.id === id)) {
    throw new BeatEditError(`automation point id "${id}" already exists in the "${param}" lane on clip "${clipId}"`)
  }
  const added: BeatAutomationPoint = { id, time: canon(point.time), value: canon(point.value) }
  const nextLanes = lane
    ? clip.automation.map((l) => (l.param === param ? { ...l, points: [...l.points, added] } : l))
    : [...clip.automation, { param, points: [added] }]
  return { doc: replaceClip(doc, trackId, { ...clip, automation: nextLanes }), point: added }
}

/** Moves an existing automation point: updates its time and/or value (whichever is passed). */
export function moveAutomationPoint(
  doc: BeatDocument,
  trackId: string,
  clipId: string,
  param: string,
  pointId: string,
  changes: { time?: number; value?: number },
): { doc: BeatDocument; point: BeatAutomationPoint } {
  const track = findTrack(doc, trackId)
  const clip = findClip(track, clipId)
  const lane = clip.automation.find((l) => l.param === param)
  const existing = lane?.points.find((p) => p.id === pointId)
  if (!lane || !existing) throw new BeatEditError(`no automation point "${pointId}" in the "${param}" lane on clip "${clipId}"`)
  const time = changes.time ?? existing.time
  const value = changes.value ?? existing.value
  if (!Number.isFinite(time) || time < 0) throw new BeatEditError(`automation point time must be >= 0, got ${time}`)
  if (!Number.isFinite(value)) throw new BeatEditError(`automation point value must be a finite number, got ${value}`)
  const updated: BeatAutomationPoint = { id: pointId, time: canon(time), value: canon(value) }
  const nextLanes = clip.automation.map((l) => (l.param === param ? { ...l, points: l.points.map((p) => (p.id === pointId ? updated : p)) } : l))
  return { doc: replaceClip(doc, trackId, { ...clip, automation: nextLanes }), point: updated }
}

/** Add-or-move in one call: if `point.id` already names a point in the lane, moves it; otherwise
 * adds a new point (minting an id if none was given). This is what `beat automate` / `beat_
 * automate` call — the CLI/MCP surface doesn't ask the caller to know in advance which case
 * they're in. */
export function setAutomationPoint(
  doc: BeatDocument,
  trackId: string,
  clipId: string,
  param: string,
  point: { time: number; value: number; id?: string },
): { doc: BeatDocument; point: BeatAutomationPoint; created: boolean } {
  const track = findTrack(doc, trackId)
  checkAutomatableParam(param)
  const clip = findClip(track, clipId)
  const lane = clip.automation.find((l) => l.param === param)
  const existing = point.id !== undefined ? lane?.points.find((p) => p.id === point.id) : undefined
  if (existing) {
    const moved = moveAutomationPoint(doc, trackId, clipId, param, point.id!, { time: point.time, value: point.value })
    return { doc: moved.doc, point: moved.point, created: false }
  }
  const added = addAutomationPoint(doc, trackId, clipId, param, point)
  return { doc: added.doc, point: added.point, created: true }
}

/** Removes an automation point; drops the whole lane if it was the last point (an empty lane
 * has no canonical serialized form — see BeatAutomationLane in document.ts). */
export function removeAutomationPoint(doc: BeatDocument, trackId: string, clipId: string, param: string, pointId: string): { doc: BeatDocument; point: BeatAutomationPoint } {
  const track = findTrack(doc, trackId)
  const clip = findClip(track, clipId)
  const lane = clip.automation.find((l) => l.param === param)
  const existing = lane?.points.find((p) => p.id === pointId)
  if (!lane || !existing) throw new BeatEditError(`no automation point "${pointId}" in the "${param}" lane on clip "${clipId}"`)
  const remaining = lane.points.filter((p) => p.id !== pointId)
  const nextLanes = remaining.length === 0 ? clip.automation.filter((l) => l.param !== param) : clip.automation.map((l) => (l.param === param ? { ...l, points: remaining } : l))
  return { doc: replaceClip(doc, trackId, { ...clip, automation: nextLanes }), point: existing }
}
