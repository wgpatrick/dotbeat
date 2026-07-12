// `beat set` primitives — docs/phase-2-plan.md §2.2. Pure document -> document functions; the
// CLI serializes canonically afterward, which is what turns each of these into a clean one-line
// (or one-edit) git diff. Strict on unknown paths/tracks/lanes — same fail-loudly stance as the
// parser: an agent-issued edit that doesn't land exactly where intended must error, not guess.

import type { BeatAudioRegion, BeatAutomationPoint, BeatClip, BeatClipLoop, BeatDrumHit, BeatDrumLaneDecl, BeatDocument, BeatEffect, BeatGroup, BeatNote, BeatSynth, BeatTimeSignature, BeatTrack, DrumLane, EffectType, OscType, TrackKind, WarpMode } from './document.js'
import { AUDIO_AUTOMATABLE_PARAMS, AUDIO_RATE_MAX, AUDIO_RATE_MIN, AUTOMATABLE_SYNTH_PARAMS, DRUM_LANES, EFFECT_TYPES, INIT_SYNTH, NOTE_FIELD_DEFAULTS, OSC_TYPES, SYNTH_FIELD_BY_KEY, SYNTH_FIELDS, SYNTH_PARAM_ORDER, TIME_SIG_DENOMINATORS, TRACK_COLORS, TRACK_KINDS, WARP_MODES, declaredLaneNames, defaultEffectChain } from './document.js'
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
 *   lead.clip.verse-a.loop "0 4"                 lead.clip.verse-a.signature "3 4"   (v0.10;
 *   empty value clears the override — see setClipLoop/setClipSignature)
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
  const patternMatch = rest.match(/^pattern\.([a-zA-Z0-9_-]+)\[(\d+)\]$/)
  if (patternMatch) {
    if (track.kind !== 'drums') throw new BeatEditError(`track "${trackId}" is a ${track.kind} track — no pattern to edit`)
    const lane = patternMatch[1]!
    const laneNames = declaredLaneNames(track)
    if (!laneNames.includes(lane)) throw new BeatEditError(`unknown drum lane "${lane}" (expected one of ${laneNames.join('|')})`)
    const step = Number(patternMatch[2]!)
    const maxStep = doc.loopBars * 16
    if (step >= maxStep) throw new BeatEditError(`step ${step} out of range (loop is ${maxStep} steps, 0-${maxStep - 1}); use beat add-hit for an off-grid hit past the loop`)
    const vel = parseNum(value, `pattern.${lane}[${step}]`)
    if (vel < 0 || vel > 1) throw new BeatEditError(`step velocities must be 0..1, got ${vel}`)
    const id = `${lane}${step}`
    const rest2 = track.hits.filter((h) => h.id !== id && !(h.lane === lane && h.start === step))
    const nextHits = vel > 0 ? [...rest2, { id, lane, start: step, velocity: canon(vel) }] : rest2
    return replaceTrack(doc, { ...track, hits: nextHits })
  }

  // v0.10 effect bypass toggle: <track>.effect.<id>.enabled = true|false — the one effect-chain
  // edit that fits setValue's flat path=value shape (a boolean flip on an existing entry, same
  // convention as lfoSync's bool SYNTH_FIELD). Add/remove/reorder change the LIST's shape/order,
  // so they get their own primitives below (addEffect/removeEffect/moveEffect) — same split as
  // v0.9 automation (setAutomationPoint via setValue-adjacent vs. the structural clip/scene calls).
  const effectEnabledMatch = rest.match(/^effect\.([A-Za-z0-9_-]+)\.enabled$/)
  if (effectEnabledMatch) {
    if (value !== 'true' && value !== 'false') throw new BeatEditError(`effect enabled must be true or false, got "${value}"`)
    return setEffectEnabled(doc, trackId, effectEnabledMatch[1]!, value === 'true').doc
  }

  // hit grammar (drum tracks) — the drum-side analog of the note grammar above (research 20 Part
  // 7 step 8: "<track>.hit.<id>.start|velocity|duration|lane", add via "<track>.hit"). Each is
  // one canonical `.beat` line, same discipline as note.*.
  //   <track>.hit  "<lane> <start> <velocity> [<duration>]"  -> add (mints the next h-id)
  //   <track>.hit.<id>.lane|start|velocity|duration  <v>     -> move/resize/retarget one field
  //   <track>.hit.<id>  ""                                   -> delete (empty value removes)
  if (rest === 'hit') {
    const parts = value.trim().split(/\s+/)
    if (parts.length !== 3 && parts.length !== 4) throw new BeatEditError(`hit add expects "<lane> <start> <velocity> [<duration>]", got "${value}"`)
    const [lane, startTok, velTok, durTok] = parts
    const start = parseNum(startTok!, 'start')
    const velocity = parseNum(velTok!, 'velocity')
    const duration = durTok !== undefined ? parseNum(durTok, 'duration') : undefined
    return addHit(doc, trackId, { lane: lane!, start, velocity, duration }).doc
  }
  const hitFieldMatch = rest.match(/^hit\.([A-Za-z0-9_-]+)\.(lane|start|velocity|duration)$/)
  if (hitFieldMatch) {
    const hitId = hitFieldMatch[1]!
    const field = hitFieldMatch[2]! as 'lane' | 'start' | 'velocity' | 'duration'
    const existing = track.hits.find((h) => h.id === hitId)
    if (!existing) throw new BeatEditError(`no hit "${hitId}" on track "${trackId}"`)
    if (field === 'duration' && value.trim() === '') {
      // empty value clears the duration (bar -> marker, the inverse of dragging a duration on)
      const removed = removeHit(doc, trackId, hitId).doc
      return addHit(removed, trackId, { id: hitId, lane: existing.lane, start: existing.start, velocity: existing.velocity }).doc
    }
    const removed = removeHit(doc, trackId, hitId).doc
    if (field === 'lane') {
      return addHit(removed, trackId, { id: hitId, lane: value, start: existing.start, velocity: existing.velocity, duration: existing.duration }).doc
    }
    const n = parseNum(value, `hit.${hitId}.${field}`)
    return addHit(removed, trackId, {
      id: hitId,
      lane: existing.lane,
      start: field === 'start' ? n : existing.start,
      velocity: field === 'velocity' ? n : existing.velocity,
      duration: field === 'duration' ? n : existing.duration,
    }).doc
  }
  const hitDeleteMatch = rest.match(/^hit\.([A-Za-z0-9_-]+)$/)
  if (hitDeleteMatch) {
    if (value.trim() !== '') throw new BeatEditError(`hit delete takes an empty value (got "${value}"); to edit a field use ${trackId}.hit.${hitDeleteMatch[1]}.<lane|start|velocity|duration>`)
    return removeHit(doc, trackId, hitDeleteMatch[1]!).doc
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
  // v0.10: chance/cent/ratchet* ride the SAME `<track>.note.<id>.<field>` path as the original
  // four (pitch/start/duration/velocity) — one more row each, not a second vocabulary.
  const noteFieldMatch = rest.match(/^note\.([A-Za-z0-9_-]+)\.(pitch|start|duration|velocity|chance|cent|ratchetCount|ratchetCurve|ratchetLength)$/)
  if (noteFieldMatch) {
    const noteId = noteFieldMatch[1]!
    const field = noteFieldMatch[2]! as 'pitch' | 'start' | 'duration' | 'velocity' | 'chance' | 'cent' | 'ratchetCount' | 'ratchetCurve' | 'ratchetLength'
    const existing = track.notes.find((n) => n.id === noteId)
    if (!existing) throw new BeatEditError(`no note "${noteId}" on track "${trackId}"`)
    const n = parseNum(value, `note.${noteId}.${field}`)
    // Round-trip through remove+add so addNote's own range/precision invariants apply and the id
    // is preserved (canonical serialization re-sorts either way, so a moved note reads as a moved
    // line — the same diff `beat set` would produce). Every field not being edited carries over
    // from `existing` — including chance/cent/ratchet* — so e.g. moving a note's start never
    // silently resets its chance back to 100.
    const removed = removeNote(doc, trackId, noteId).doc
    return addNote(removed, trackId, {
      id: noteId,
      pitch: field === 'pitch' ? n : existing.pitch,
      start: field === 'start' ? n : existing.start,
      duration: field === 'duration' ? n : existing.duration,
      velocity: field === 'velocity' ? n : existing.velocity,
      chance: field === 'chance' ? n : existing.chance,
      cent: field === 'cent' ? n : existing.cent,
      ratchetCount: field === 'ratchetCount' ? n : existing.ratchetCount,
      ratchetCurve: field === 'ratchetCurve' ? n : existing.ratchetCurve,
      ratchetLength: field === 'ratchetLength' ? n : existing.ratchetLength,
    }).doc
  }
  const noteDeleteMatch = rest.match(/^note\.([A-Za-z0-9_-]+)$/)
  if (noteDeleteMatch) {
    if (value.trim() !== '') throw new BeatEditError(`note delete takes an empty value (got "${value}"); to edit a field use ${trackId}.note.${noteDeleteMatch[1]}.<pitch|start|duration|velocity>`)
    return removeNote(doc, trackId, noteDeleteMatch[1]!).doc
  }

  // v0.10 clip properties (Phase 22 Stream AG): <track>.clip.<clipId>.loop / .signature — the GUI's
  // clip inspector edit path, same {path,value} /edit channel as everything else. "<start> <end>" /
  // "<num> <den>" sets the override; an empty value clears it (back to null — no override). Thin
  // wrappers around setClipLoop/setClipSignature below (the same functions a future CLI verb would
  // call), kept here so `beat set`/POST /edit needs no new route for this, matching the house rule
  // of reusing the generic edit channel wherever a single {path,value} line can express the fact.
  const clipPropMatch = rest.match(/^clip\.([A-Za-z0-9_-]+)\.(loop|signature)$/)
  if (clipPropMatch) {
    const clipId = clipPropMatch[1]!
    const field = clipPropMatch[2]! as 'loop' | 'signature'
    if (field === 'loop') {
      if (value.trim() === '') return setClipLoop(doc, trackId, clipId, null)
      const parts = value.trim().split(/\s+/)
      if (parts.length !== 2) throw new BeatEditError(`clip loop expects "<start> <end>" (bars), got "${value}"`)
      const start = parseNum(parts[0]!, 'clip loop start')
      const end = parseNum(parts[1]!, 'clip loop end')
      return setClipLoop(doc, trackId, clipId, { start, end })
    }
    if (value.trim() === '') return setClipSignature(doc, trackId, clipId, null)
    const parts = value.trim().split(/\s+/)
    if (parts.length !== 2) throw new BeatEditError(`clip signature expects "<numerator> <denominator>", got "${value}"`)
    const numerator = parseNum(parts[0]!, 'clip signature numerator')
    const denominator = parseNum(parts[1]!, 'clip signature denominator')
    return setClipSignature(doc, trackId, clipId, { numerator, denominator })
  }

  // Phase 22 Stream AE: audio-region clip grammar (the clip-scoped analog of the note paths
  // above — this content type has no LIVE/non-clip form, only clip.<id>.audio):
  //   <track>.clip.<id>.audio         "<media-id> <in> <out> [gainDb] [warp] [rate]" -> create/replace
  //   <track>.clip.<id>.audio.<field> <n or token>                                  -> trim one field
  const clipAudioAddMatch = rest.match(/^clip\.([A-Za-z0-9_-]+)\.audio$/)
  if (clipAudioAddMatch) {
    const parts = value.trim().split(/\s+/)
    if (parts.length < 3 || parts.length > 6) throw new BeatEditError(`audio region expects "<media-id> <in> <out> [gainDb] [warp] [rate]", got "${value}"`)
    const [media, inTok, outTok, gainTok, warpTok, rateTok] = parts
    const region: Parameters<typeof addAudioClip>[3] = { media: media!, in: parseNum(inTok!, 'in'), out: parseNum(outTok!, 'out') }
    if (gainTok !== undefined) region.gainDb = parseNum(gainTok, 'gainDb')
    if (warpTok !== undefined) {
      if (!(WARP_MODES as readonly string[]).includes(warpTok)) throw new BeatEditError(`warp must be one of ${WARP_MODES.join('|')}, got "${warpTok}"`)
      region.warp = warpTok as WarpMode
    }
    if (rateTok !== undefined) region.rate = parseNum(rateTok, 'rate')
    return addAudioClip(doc, trackId, clipAudioAddMatch[1]!, region).doc
  }
  const clipAudioFieldMatch = rest.match(/^clip\.([A-Za-z0-9_-]+)\.audio\.(media|in|out|gainDb|warp|rate)$/)
  if (clipAudioFieldMatch) {
    const [, clipId, field] = clipAudioFieldMatch as [string, string, 'media' | 'in' | 'out' | 'gainDb' | 'warp' | 'rate']
    if (field === 'media') return setClipAudioRegion(doc, trackId, clipId, { media: value }).doc
    if (field === 'warp') {
      if (!(WARP_MODES as readonly string[]).includes(value)) throw new BeatEditError(`warp must be one of ${WARP_MODES.join('|')}, got "${value}"`)
      return setClipAudioRegion(doc, trackId, clipId, { warp: value as WarpMode }).doc
    }
    return setClipAudioRegion(doc, trackId, clipId, { [field]: parseNum(value, field) }).doc
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
  // v0.10 groove/shuffle: track-level playback fields, not synth params (see document.ts's
  // BeatTrack.shuffleAmount/shuffleGrid) — same `beat set <track>.<field> <value>` grammar as
  // name/color, so no new CLI verb or daemon route is needed to dial groove in.
  if (rest === 'shuffleAmount') {
    const amount = parseNum(value, 'shuffleAmount')
    if (amount < 0 || amount > 1) throw new BeatEditError(`shuffleAmount must be 0..1, got ${amount}`)
    return replaceTrack(doc, { ...track, shuffleAmount: canon(amount) })
  }
  if (rest === 'shuffleGrid') {
    const grid = parseNum(value, 'shuffleGrid')
    if (grid <= 0) throw new BeatEditError(`shuffleGrid must be > 0, got ${grid}`)
    return replaceTrack(doc, { ...track, shuffleGrid: canon(grid) })
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
    `unknown field "${rest}" on track "${trackId}" (core: ${SYNTH_PARAM_ORDER.join(', ')}; shaped: ${SYNTH_FIELDS.map((f) => f.key).join(', ')}; also name, color, shuffleAmount, shuffleGrid, pattern.<lane>[i])`,
  )
}

/** Adds a note to a synth track. If `id` is omitted, mints the next free `u<n>` id (the same
 * prefix BeatLab's own recordNote uses, chosen above the current max so it can't collide).
 * v0.10's chance/cent/ratchet* are optional and default to NOTE_FIELD_DEFAULTS (today's implicit
 * behavior — always-fires, no detune, no ratchet) so every existing caller keeps working
 * unchanged. */
export function addNote(
  doc: BeatDocument,
  trackId: string,
  note: {
    pitch: number
    start: number
    duration: number
    velocity: number
    id?: string
    chance?: number
    cent?: number
    ratchetCount?: number
    ratchetCurve?: number
    ratchetLength?: number
  },
): { doc: BeatDocument; note: BeatNote } {
  const track = findTrack(doc, trackId)
  if (track.kind === 'drums') throw new BeatEditError(`track "${trackId}" is a drums track — notes only belong on synth/instrument tracks`)
  if (note.pitch < 0 || note.pitch > 127 || !Number.isInteger(note.pitch)) throw new BeatEditError(`pitch must be an integer 0-127, got ${note.pitch}`)
  // v0.7: fractional steps are legal — live/tapped input lands between grid lines. Values are
  // snapped to the canonical 4-decimal precision on the way in (see format.ts) so a stored doc
  // always deep-equals parse(serialize(doc)).
  if (!Number.isFinite(note.start) || note.start < 0) throw new BeatEditError(`start must be a step position >= 0, got ${note.start}`)
  if (!Number.isFinite(note.duration) || note.duration <= 0) throw new BeatEditError(`duration must be > 0 steps, got ${note.duration}`)
  if (note.velocity < 0 || note.velocity > 1) throw new BeatEditError(`velocity must be 0..1, got ${note.velocity}`)
  const chance = note.chance ?? NOTE_FIELD_DEFAULTS.chance
  if (!Number.isInteger(chance) || chance < 0 || chance > 100) throw new BeatEditError(`chance must be an integer 0-100, got ${note.chance}`)
  const cent = note.cent ?? NOTE_FIELD_DEFAULTS.cent
  if (!Number.isFinite(cent) || cent < -50 || cent > 50) throw new BeatEditError(`cent must be -50..50, got ${note.cent}`)
  const ratchetCount = note.ratchetCount ?? NOTE_FIELD_DEFAULTS.ratchetCount
  if (!Number.isInteger(ratchetCount) || ratchetCount < 1 || ratchetCount > 16) throw new BeatEditError(`ratchetCount must be an integer 1-16, got ${note.ratchetCount}`)
  const ratchetCurve = note.ratchetCurve ?? NOTE_FIELD_DEFAULTS.ratchetCurve
  if (!Number.isFinite(ratchetCurve) || ratchetCurve < -1 || ratchetCurve > 1) throw new BeatEditError(`ratchetCurve must be -1..1, got ${note.ratchetCurve}`)
  const ratchetLength = note.ratchetLength ?? NOTE_FIELD_DEFAULTS.ratchetLength
  if (!Number.isFinite(ratchetLength) || ratchetLength <= 0 || ratchetLength > 1) throw new BeatEditError(`ratchetLength must be >0..1, got ${note.ratchetLength}`)

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
  const added: BeatNote = {
    id,
    pitch: note.pitch,
    start: canon(note.start),
    duration,
    velocity: canon(note.velocity),
    chance,
    cent: canon(cent),
    ratchetCount,
    ratchetCurve: canon(ratchetCurve),
    ratchetLength: canon(ratchetLength),
  }
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

/** v0.10 effect-chain primitives (docs/phase-22-stream-aa.md). A track's `effects` array IS the
 * insert chain's order — these are the only ways to change it, so every mutation stays a small,
 * explicit list edit (add one entry, drop one entry, move one entry, flip one flag) rather than a
 * hand-rolled array splice at each call site. Synth tracks only — see BeatTrack.effects. */

/** Adds a new effect instance. Mints `<type>` (or `<type>_2`, `_3`, ... on collision) when `id` is
 * omitted; errors if a given id already exists on the track. `index` inserts at that position
 * (clamped to the list bounds); omitted = appended (the end of the chain, the least surprising
 * default for "add a new insert"). */
export function addEffect(doc: BeatDocument, trackId: string, type: EffectType, opts: { id?: string; index?: number; enabled?: boolean } = {}): { doc: BeatDocument; effect: BeatEffect } {
  const track = findTrack(doc, trackId)
  if (track.kind !== 'synth') throw new BeatEditError(`track "${trackId}" is a ${track.kind} track — effect chains only belong on synth tracks`)
  if (!(EFFECT_TYPES as readonly string[]).includes(type)) throw new BeatEditError(`effect type must be one of ${EFFECT_TYPES.join('|')}, got "${type}"`)
  let id = opts.id
  if (id === undefined) {
    id = type
    let n = 2
    while (track.effects.some((e) => e.id === id)) {
      id = `${type}_${n}`
      n++
    }
  } else {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new BeatEditError(`effect ids are single alphanumeric/_/- tokens, got "${id}"`)
    if (track.effects.some((e) => e.id === id)) throw new BeatEditError(`effect id "${id}" already exists on track "${trackId}"`)
  }
  const added: BeatEffect = { id, type, enabled: opts.enabled ?? true }
  const index = opts.index === undefined ? track.effects.length : Math.max(0, Math.min(Math.trunc(opts.index), track.effects.length))
  const effects = [...track.effects.slice(0, index), added, ...track.effects.slice(index)]
  return { doc: replaceTrack(doc, { ...track, effects }), effect: added }
}

/** Removes an effect instance by id. */
export function removeEffect(doc: BeatDocument, trackId: string, effectId: string): { doc: BeatDocument; effect: BeatEffect } {
  const track = findTrack(doc, trackId)
  const effect = track.effects.find((e) => e.id === effectId)
  if (!effect) throw new BeatEditError(`no effect "${effectId}" on track "${trackId}" (have: ${track.effects.map((e) => e.id).join(', ') || 'none'})`)
  return { doc: replaceTrack(doc, { ...track, effects: track.effects.filter((e) => e.id !== effectId) }), effect }
}

/** Moves an effect to a new position in the chain (0-based, clamped to the list bounds) — this is
 * THE reorder primitive: array order is chain order, so this is the whole operation. */
export function moveEffect(doc: BeatDocument, trackId: string, effectId: string, toIndex: number): { doc: BeatDocument; effect: BeatEffect; before: number; after: number } {
  const track = findTrack(doc, trackId)
  const from = track.effects.findIndex((e) => e.id === effectId)
  if (from === -1) throw new BeatEditError(`no effect "${effectId}" on track "${trackId}" (have: ${track.effects.map((e) => e.id).join(', ') || 'none'})`)
  const after = Math.max(0, Math.min(Math.trunc(toIndex), track.effects.length - 1))
  const effects = [...track.effects]
  const [item] = effects.splice(from, 1)
  effects.splice(after, 0, item!)
  return { doc: replaceTrack(doc, { ...track, effects }), effect: item!, before: from, after }
}

/** Sets an effect instance's enabled/bypassed state. This is dotbeat's bypass mechanism: a
 * disabled effect is routed OUT of the audio graph entirely (ui/src/audio/engine.ts), not just
 * silenced via its own *Mix param — a real bypass, not a wet/dry illusion, and the only way to
 * meaningfully bypass eq3 (which has no mix knob of its own). */
export function setEffectEnabled(doc: BeatDocument, trackId: string, effectId: string, enabled: boolean): { doc: BeatDocument; effect: BeatEffect } {
  const track = findTrack(doc, trackId)
  const idx = track.effects.findIndex((e) => e.id === effectId)
  if (idx === -1) throw new BeatEditError(`no effect "${effectId}" on track "${trackId}" (have: ${track.effects.map((e) => e.id).join(', ') || 'none'})`)
  const effects = track.effects.map((e, i) => (i === idx ? { ...e, enabled } : e))
  return { doc: replaceTrack(doc, { ...track, effects }), effect: effects[idx]! }
}

function validateTrackIdentity(id: string, name: string, color: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new BeatEditError(`track ids are single alphanumeric/_/- tokens, got "${id}"`)
  if (/\s/.test(name)) throw new BeatEditError('track names are single tokens in v0.2 (no whitespace)')
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new BeatEditError(`color must be a lowercase hex color like #c678dd, got "${color}"`)
}

/** Adds a new track with the format's init patch (INIT_SYNTH; drum tracks start with no hits).
 * Color defaults cycle TRACK_COLORS by track index; name defaults to the id. Phase 22 Stream AB:
 * `lanes` lets a caller opt a fresh drum track into the OPEN lane list explicitly (the CLI's `beat
 * add-track --kind drums` passes `defaultDrumKitLanes()` — the new 12-lane GM-aligned default kit,
 * research 19 Part VII); omitted (the default for every other/internal caller, including this
 * function's own many existing callers across quantize/humanize/vary/tests) leaves `lanes: []`,
 * i.e. the legacy/implicit 5 DRUM_LANES — unchanged behavior, deliberately not switched wholesale
 * so the low-level primitive stays backward compatible. */
export function addTrack(
  doc: BeatDocument,
  opts: { id: string; kind: TrackKind; name?: string; color?: string; soundfont?: { sample: string; program: number }; lanes?: BeatDrumLaneDecl[] },
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
    lanes: kind === 'drums' ? (opts.lanes ?? []) : [],
    clips: [],
    notes: [],
    hits: [],
    // v0.10: a fresh synth track starts on the format's default chain (elided on serialize, same
    // as every other init-patch default); drum/instrument tracks carry none.
    effects: kind === 'synth' ? defaultEffectChain() : [],
    shuffleAmount: 0,
    shuffleGrid: 1,
  }
  return { doc: { ...doc, tracks: [...doc.tracks, track] }, track }
}

/** Adds a free-timed drum hit to a drum track (v0.8). If `id` is omitted, mints the next free
 * `h<n>` id above the current max. start is in fractional 16th steps (snapped to canonical
 * precision); velocity in (0, 1]. Phase 22 Stream AB: `lane` is open — validated against the
 * track's declared lane set (declaredLaneNames: its own `lanes` list, or the implicit 5
 * DRUM_LANES for a legacy/migrated track) rather than a closed enum; an optional `duration` (> 0
 * steps) gates the voice for that long instead of firing a one-shot trigger (research 20 Part 7). */
export function addHit(
  doc: BeatDocument,
  trackId: string,
  hit: { lane: string; start: number; velocity: number; duration?: number; id?: string },
): { doc: BeatDocument; hit: BeatDrumHit } {
  const track = findTrack(doc, trackId)
  if (track.kind !== 'drums') throw new BeatEditError(`track "${trackId}" is a ${track.kind} track — hits only belong on drum tracks`)
  const laneNames = declaredLaneNames(track)
  if (!laneNames.includes(hit.lane)) throw new BeatEditError(`unknown drum lane "${hit.lane}" (expected one of ${laneNames.join('|')})`)
  if (!Number.isFinite(hit.start) || hit.start < 0) throw new BeatEditError(`hit start must be a step position >= 0, got ${hit.start}`)
  if (hit.velocity <= 0 || hit.velocity > 1) throw new BeatEditError(`hit velocity must be in (0, 1], got ${hit.velocity}`)
  if (hit.duration !== undefined && (!Number.isFinite(hit.duration) || hit.duration <= 0)) throw new BeatEditError(`hit duration must be > 0 steps, got ${hit.duration}`)
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
  if (hit.duration !== undefined) added.duration = canon(hit.duration)
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
  // v0.10: drop the removed track from whatever group it was in; a group that's left with zero
  // members has no canonical serialized form (same elision discipline as an empty automation lane),
  // so it's dropped entirely rather than persisted as an empty shell.
  const groups = doc.groups.map((g) => ({ ...g, tracks: g.tracks.filter((t) => t !== trackId) })).filter((g) => g.tracks.length > 0)
  const selectedTrack = doc.selectedTrack === trackId ? tracks[0]!.id : doc.selectedTrack
  return { doc: { ...doc, tracks, groups, scenes, selectedTrack }, track }
}

/** v0.10: single-token identity rules for a group — same discipline as `validateTrackIdentity`
 * (ids are slugs, names are single tokens because the grammar has no quoting, colors are lowercase
 * hex). */
function validateGroupIdentity(id: string, name: string, color: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new BeatEditError(`group ids are single alphanumeric/_/- tokens, got "${id}"`)
  if (/\s/.test(name)) throw new BeatEditError('group names are single tokens (no whitespace)')
  if (!/^#[0-9a-f]{6}$/.test(color)) throw new BeatEditError(`color must be a lowercase hex color like #c678dd, got "${color}"`)
}

function findGroup(doc: BeatDocument, groupId: string): BeatGroup {
  const g = doc.groups.find((x) => x.id === groupId)
  if (!g) throw new BeatEditError(`no group "${groupId}" (have: ${doc.groups.map((x) => x.id).join(', ') || 'none'})`)
  return g
}

/** v0.10: folds N existing tracks into one named, colored group (Phase 22 Stream AF). Deliberately
 * flat — a track belongs to at most one group, so grouping an already-grouped track is refused
 * rather than silently moving it (the caller should ungroup it first, an explicit act). Mints
 * `group<n>` when `id` is omitted (same convention as `addHit`'s `h<n>`); color cycles TRACK_COLORS
 * like `addTrack`'s default; name defaults to the id like `addTrack`'s default. */
export function addGroup(doc: BeatDocument, opts: { id?: string; name?: string; color?: string; trackIds: string[] }): { doc: BeatDocument; group: BeatGroup } {
  if (opts.trackIds.length < 1) throw new BeatEditError('a group needs at least 1 track')
  const seen = new Set<string>()
  for (const tid of opts.trackIds) {
    findTrack(doc, tid) // throws if the track doesn't exist
    if (seen.has(tid)) throw new BeatEditError(`track "${tid}" listed twice in the same group`)
    seen.add(tid)
    const already = doc.groups.find((g) => g.tracks.includes(tid))
    if (already) throw new BeatEditError(`track "${tid}" is already in group "${already.id}" — ungroup it first`)
  }
  let id = opts.id
  if (id === undefined) {
    let max = 0
    for (const g of doc.groups) {
      const m = g.id.match(/^group(\d+)$/)
      if (m) max = Math.max(max, Number(m[1]))
    }
    id = `group${max + 1}`
  } else if (doc.groups.some((g) => g.id === id)) {
    throw new BeatEditError(`group id "${id}" already exists`)
  }
  const name = opts.name ?? id
  const color = opts.color ?? TRACK_COLORS[doc.groups.length % TRACK_COLORS.length]!
  validateGroupIdentity(id, name, color)
  const group: BeatGroup = { id, name, color, tracks: [...opts.trackIds] }
  return { doc: { ...doc, groups: [...doc.groups, group] }, group }
}

/** Ungroups: deletes the group. Member tracks are untouched — they simply stop being grouped. */
export function removeGroup(doc: BeatDocument, groupId: string): { doc: BeatDocument; group: BeatGroup } {
  const group = findGroup(doc, groupId)
  return { doc: { ...doc, groups: doc.groups.filter((g) => g.id !== groupId) }, group }
}

/** Renames a group (the GUI's double-click-to-rename affordance, mirroring track rename). */
export function renameGroup(doc: BeatDocument, groupId: string, name: string): BeatDocument {
  const group = findGroup(doc, groupId)
  validateGroupIdentity(group.id, name, group.color)
  return { ...doc, groups: doc.groups.map((g) => (g.id === groupId ? { ...g, name } : g)) }
}

/** Recolors a group. */
export function setGroupColor(doc: BeatDocument, groupId: string, color: string): BeatDocument {
  const group = findGroup(doc, groupId)
  validateGroupIdentity(group.id, group.name, color)
  return { ...doc, groups: doc.groups.map((g) => (g.id === groupId ? { ...g, color } : g)) }
}

/** Replaces a group's whole membership list — add, remove, or reorder members in one statement
 * (same "whole-list edit" shape as `setSong`/`setScene`: membership is few-entries data where order
 * can matter, so replace-not-patch is the honest edit). Same at-most-one-group-per-track rule as
 * `addGroup`. */
export function setGroupTracks(doc: BeatDocument, groupId: string, trackIds: string[]): BeatDocument {
  const group = findGroup(doc, groupId)
  if (trackIds.length < 1) throw new BeatEditError('a group needs at least 1 track')
  const seen = new Set<string>()
  for (const tid of trackIds) {
    findTrack(doc, tid)
    if (seen.has(tid)) throw new BeatEditError(`track "${tid}" listed twice in the same group`)
    seen.add(tid)
    const already = doc.groups.find((g) => g.id !== groupId && g.tracks.includes(tid))
    if (already) throw new BeatEditError(`track "${tid}" is already in group "${already.id}" — ungroup it first`)
  }
  return { ...doc, groups: doc.groups.map((g) => (g.id === groupId ? { ...g, tracks: [...trackIds] } : g)) }
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
  const base: BeatDocument = { formatVersion: '0.10', bpm, loopBars, selectedTrack: '', media: [], tracks: [], groups: [], scenes: [], song: null }
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
    // v0.10: re-snapshotting preserves the clip's existing loop/signature overrides (like
    // automation above) rather than wiping them — they're clip metadata, not live-track content.
    loop: existing === -1 ? null : track.clips[existing]!.loop,
    signature: existing === -1 ? null : track.clips[existing]!.signature,
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

/** v0.10 (Phase 22 Stream AG): sets or clears a clip's own loop range (Ableton's "Loop Position &
 * Length" — docs/research/18-ableton-ui-architecture.md's Clip View table). `loop: null` clears the
 * override, returning the clip to tiling across whatever length the section/loopBars gives it. */
export function setClipLoop(doc: BeatDocument, trackId: string, clipId: string, loop: BeatClipLoop | null): BeatDocument {
  const track = findTrack(doc, trackId)
  const clip = findClip(track, clipId)
  if (loop === null) return replaceClip(doc, trackId, { ...clip, loop: null })
  if (!Number.isFinite(loop.start) || loop.start < 0) throw new BeatEditError(`clip loop start must be >= 0, got ${loop.start}`)
  if (!Number.isFinite(loop.end) || loop.end <= loop.start) throw new BeatEditError(`clip loop end must be > start, got start ${loop.start} end ${loop.end}`)
  return replaceClip(doc, trackId, { ...clip, loop: { start: canon(loop.start), end: canon(loop.end) } })
}

/** v0.10: sets or clears a clip's own time signature (metadata only — the audio engine is still
 * constant-tempo 4/4; see BeatTimeSignature's doc comment). `signature: null` clears the override. */
export function setClipSignature(doc: BeatDocument, trackId: string, clipId: string, signature: BeatTimeSignature | null): BeatDocument {
  const track = findTrack(doc, trackId)
  const clip = findClip(track, clipId)
  if (signature === null) return replaceClip(doc, trackId, { ...clip, signature: null })
  // Integer fields fail loudly on a non-integer input rather than silently rounding — same stance
  // instrument tracks' `program` field takes (setValue's `program` case above): a fractional time
  // signature isn't a real musical fact to round away, it's a caller bug worth surfacing.
  const { numerator, denominator } = signature
  if (!Number.isInteger(numerator) || numerator < 1 || numerator > 32) throw new BeatEditError(`clip signature numerator must be an integer 1-32, got ${numerator}`)
  if (!Number.isInteger(denominator) || !(TIME_SIG_DENOMINATORS as readonly number[]).includes(denominator)) {
    throw new BeatEditError(`clip signature denominator must be one of ${TIME_SIG_DENOMINATORS.join('|')}, got ${denominator}`)
  }
  return replaceClip(doc, trackId, { ...clip, signature: { numerator, denominator } })
}

/** Phase 22 Stream AE: which params a track kind's clips may automate — synth/instrument/drums
 * (drum tracks automate their own bus synth params, same as synth) use AUTOMATABLE_SYNTH_PARAMS;
 * audio tracks use the separate AUDIO_AUTOMATABLE_PARAMS ('gain' only) — different namespaces, no
 * overlap, so a track kind fully determines which set applies. */
function checkAutomatableParam(param: string, trackKind: TrackKind) {
  if (trackKind === 'audio') {
    if (!(AUDIO_AUTOMATABLE_PARAMS as readonly string[]).includes(param)) {
      throw new BeatEditError(`"${param}" is not an automatable param for an audio-track clip (have: ${AUDIO_AUTOMATABLE_PARAMS.join(', ')})`)
    }
    return
  }
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
  checkAutomatableParam(param, track.kind)
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
  checkAutomatableParam(param, track.kind)
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

/** Phase 22 Stream AE: audio-region clip primitives (`docs/phase-22-stream-ae.md`). An audio-
 * region clip is one bundled entity (media + in/out + gain + warp + rate — see BeatAudioRegion
 * in document.ts), so these operate on the whole region at once, the same shape addNote/addHit
 * take for their own single-line entities. Gain automation reuses addAutomationPoint/
 * moveAutomationPoint/removeAutomationPoint/setAutomationPoint unchanged (param 'gain', gated by
 * checkAutomatableParam's track-kind branch above) — no separate primitives needed for that part. */

function validateAudioRegionFields(region: { media: string; in: number; out: number; gainDb: number; warp: WarpMode; rate: number }, doc: BeatDocument): void {
  if (!doc.media.some((m) => m.id === region.media)) throw new BeatEditError(`no sample "${region.media}" in the media block (have: ${doc.media.map((m) => m.id).join(', ') || 'none'}) — register it with beat sample first`)
  if (!Number.isFinite(region.in) || region.in < 0) throw new BeatEditError(`audio in-point must be >= 0, got ${region.in}`)
  if (!Number.isFinite(region.out) || region.out <= region.in) throw new BeatEditError(`audio out-point must be > in-point, got in=${region.in} out=${region.out}`)
  if (!(WARP_MODES as readonly string[]).includes(region.warp)) throw new BeatEditError(`warp must be one of ${WARP_MODES.join('|')}, got "${region.warp}"`)
  if (!Number.isFinite(region.rate) || region.rate < AUDIO_RATE_MIN || region.rate > AUDIO_RATE_MAX) throw new BeatEditError(`audio rate must be ${AUDIO_RATE_MIN}-${AUDIO_RATE_MAX}, got ${region.rate}`)
  if (region.warp !== 'repitch' && region.rate !== 1) throw new BeatEditError(`audio rate must be 1 when warp is "${region.warp}" (rate only applies to warp=repitch), got ${region.rate}`)
}

/** Creates (or replaces) a clip on an audio track with a single audio region — the direct,
 * one-call creation path (mirrors addNote/addHit's directness). saveClip's generic "snapshot
 * whatever's live" pattern doesn't apply here: audio tracks carry no live/non-clip content in
 * this stream (see docs/phase-22-stream-ae.md's scope notes). Upserts: an existing clip id's
 * region is replaced, the same re-snapshot ergonomics saveClip gives synth/drum tracks. */
export function addAudioClip(
  doc: BeatDocument,
  trackId: string,
  clipId: string,
  region: { media: string; in: number; out: number; gainDb?: number; warp?: WarpMode; rate?: number },
): { doc: BeatDocument; clip: BeatClip } {
  const track = findTrack(doc, trackId)
  if (track.kind !== 'audio') throw new BeatEditError(`track "${trackId}" is a ${track.kind} track — audio-region clips only belong on audio tracks`)
  if (!/^[a-zA-Z0-9_-]+$/.test(clipId)) throw new BeatEditError(`clip ids are single alphanumeric/_/- tokens, got "${clipId}"`)
  const full: BeatAudioRegion = {
    media: region.media,
    in: canon(region.in),
    out: canon(region.out),
    gainDb: canon(region.gainDb ?? 0),
    warp: region.warp ?? 'off',
    rate: canon(region.rate ?? 1),
    markers: [],
  }
  validateAudioRegionFields(full, doc)
  const existing = track.clips.findIndex((c) => c.id === clipId)
  const clip: BeatClip = existing === -1 ? { id: clipId, notes: [], hits: [], automation: [], loop: null, signature: null, audio: full } : { ...track.clips[existing]!, audio: full }
  const clips = existing === -1 ? [...track.clips, clip] : track.clips.map((c, i) => (i === existing ? clip : c))
  return { doc: replaceTrack(doc, { ...track, clips }), clip }
}

/** Updates one or more fields on an EXISTING clip's audio region directly — the trim/gain/warp
 * edit primitive (what a GUI drag-handle or `beat set <track>.clip.<id>.audio.<field>` calls, see
 * setValue below). Fields not passed keep their current value. Switching `warp` away from
 * 'repitch' silently normalizes `rate` back to 1 (one canonical form per state, D4) unless the
 * caller ALSO passed a new rate in the same call. */
export function setClipAudioRegion(
  doc: BeatDocument,
  trackId: string,
  clipId: string,
  changes: { media?: string; in?: number; out?: number; gainDb?: number; warp?: WarpMode; rate?: number },
): { doc: BeatDocument; region: BeatAudioRegion } {
  const track = findTrack(doc, trackId)
  const clip = findClip(track, clipId)
  if (!clip.audio) throw new BeatEditError(`clip "${clipId}" on track "${trackId}" has no audio region`)
  const next: BeatAudioRegion = {
    media: changes.media ?? clip.audio.media,
    in: changes.in !== undefined ? canon(changes.in) : clip.audio.in,
    out: changes.out !== undefined ? canon(changes.out) : clip.audio.out,
    gainDb: changes.gainDb !== undefined ? canon(changes.gainDb) : clip.audio.gainDb,
    warp: changes.warp ?? clip.audio.warp,
    rate: changes.rate !== undefined ? canon(changes.rate) : clip.audio.rate,
    markers: clip.audio.markers,
  }
  if (next.warp !== 'repitch' && changes.rate === undefined) next.rate = 1
  validateAudioRegionFields(next, doc)
  return { doc: replaceClip(doc, trackId, { ...clip, audio: next }), region: next }
}

/** Split-at-point (`docs/research/16-audio-clip-editing.md` §2): given a timeline position (16th
 * steps from the clip's own start), splits one audio-region clip into two, each referencing the
 * same media with adjusted in/out points — a pure edit primitive, no DSP, no engine involvement
 * beyond consuming the new format field. `atSteps` converts to source-media seconds via the
 * region's own rate (repitch changes how much source material elapses per timeline second: at
 * rate=2, twice as much source plays per second of timeline, so the split point in the SOURCE
 * file is further along than a naive step*stepSeconds would put it).
 *
 * The first half keeps the clip's id with `out` trimmed to the split point; the second half is a
 * NEW clip (auto-numbered `<id>-2`, `<id>-3`, ... unless `newClipId` is given) inserted
 * immediately after the first in the track's clip list, with `in` moved to the split point.
 * Gain-automation points partition by time — before the split stay on the first clip unchanged;
 * at/after it move to the second clip, retimed relative to ITS own new start — the same "survive
 * the split, attached to whichever segment they fall in" discipline research 16 §2 documents for
 * warp markers (not yet built, but automation already behaves this way today). */
export function splitAudioClip(doc: BeatDocument, trackId: string, clipId: string, atSteps: number, opts: { newClipId?: string } = {}): { doc: BeatDocument; first: BeatClip; second: BeatClip } {
  const track = findTrack(doc, trackId)
  if (track.kind !== 'audio') throw new BeatEditError(`track "${trackId}" is a ${track.kind} track — split-at-point only applies to audio-region clips`)
  const idx = track.clips.findIndex((c) => c.id === clipId)
  if (idx === -1) throw new BeatEditError(`no clip "${clipId}" on track "${trackId}" (have: ${track.clips.map((c) => c.id).join(', ') || 'none'})`)
  const clip = track.clips[idx]!
  if (!clip.audio) throw new BeatEditError(`clip "${clipId}" on track "${trackId}" has no audio region`)
  if (!Number.isFinite(atSteps) || atSteps <= 0) throw new BeatEditError(`split position must be > 0 steps from the clip's start, got ${atSteps}`)

  const stepSeconds = 60 / doc.bpm / 4 // one 16th note, seconds, at the document's tempo
  const sourceSplit = canon(clip.audio.in + atSteps * stepSeconds * clip.audio.rate)
  const MIN_REGION_SECONDS = 0.001
  if (sourceSplit <= clip.audio.in + MIN_REGION_SECONDS || sourceSplit >= clip.audio.out - MIN_REGION_SECONDS) {
    throw new BeatEditError(
      `split position ${atSteps} steps is out of range for clip "${clipId}" (region spans ${formatNumber(clip.audio.in)}-${formatNumber(clip.audio.out)}s of source, split would land at ${formatNumber(sourceSplit)}s)`,
    )
  }

  let newId = opts.newClipId
  if (newId === undefined) {
    let n = 2
    while (track.clips.some((c) => c.id === `${clipId}-${n}`)) n++
    newId = `${clipId}-${n}`
  } else if (track.clips.some((c) => c.id === newId)) {
    throw new BeatEditError(`clip id "${newId}" already exists on track "${trackId}"`)
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(newId)) throw new BeatEditError(`clip ids are single alphanumeric/_/- tokens, got "${newId}"`)

  const partitionAutomation = (before: boolean): BeatClip['automation'] =>
    clip.automation
      .map((lane) => ({
        param: lane.param,
        points: lane.points.filter((p) => (before ? p.time < atSteps : p.time >= atSteps)).map((p) => (before ? { ...p } : { ...p, time: canon(p.time - atSteps) })),
      }))
      .filter((lane) => lane.points.length > 0)

  const first: BeatClip = { ...clip, audio: { ...clip.audio, out: sourceSplit }, automation: partitionAutomation(true) }
  const second: BeatClip = { id: newId, notes: [], hits: [], automation: partitionAutomation(false), loop: null, signature: null, audio: { ...clip.audio, in: sourceSplit } }

  const clips = [...track.clips.slice(0, idx), first, second, ...track.clips.slice(idx + 1)]
  return { doc: replaceTrack(doc, { ...track, clips }), first, second }
}
