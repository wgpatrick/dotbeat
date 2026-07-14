// `beat set` primitives — docs/phase-2-plan.md §2.2. Pure document -> document functions; the
// CLI serializes canonically afterward, which is what turns each of these into a clean one-line
// (or one-edit) git diff. Strict on unknown paths/tracks/lanes — same fail-loudly stance as the
// parser: an agent-issued edit that doesn't land exactly where intended must error, not guess.

import type { AutomationInterpolation, BeatAudioRegion, BeatAutomationPoint, BeatClip, BeatClipLoop, BeatDrumHit, BeatDrumLaneDecl, BeatDocument, BeatEffect, BeatGroup, BeatLaneBacking, BeatNote, BeatPlacement, BeatSongSection, BeatSynth, BeatTimeSignature, BeatTrack, DrumLane, DrumVoiceType, EffectType, OscType, SampleLaneFilterType, TrackKind, WarpMode } from './document.js'
import { AUDIO_AUTOMATABLE_PARAMS, AUDIO_RATE_MAX, AUDIO_RATE_MIN, AUTOMATABLE_SYNTH_PARAMS, AUTOMATION_INTERPOLATIONS, AUTOMATION_POINT_FIELD_DEFAULTS, DEFAULT_DRUM_KIT, DRUM_LANES, DRUM_VOICE_PARAM_DEFAULTS, DRUM_VOICE_TYPES, EFFECT_TYPES, INIT_SYNTH, INSTRUMENT_EFFECT_FIELD_KEYS, NOTE_FIELD_DEFAULTS, OSC_TYPES, SAMPLE_LANE_PARAM_DEFAULTS, SYNTH_FIELD_BY_KEY, SYNTH_FIELDS, SYNTH_PARAM_ORDER, TIME_SIG_DENOMINATORS, TRACK_COLORS, TRACK_KINDS, WARP_MODES, declaredLaneNames, defaultEffectChain, isSampleLaneFilterType, isSampleLaneParamKey, scenePlacementError, sortPlacements } from './document.js'
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

  // Phase 35 Stream OA: declared-lane backing params get a first-class set path —
  //   <track>.lane.<name>.<key>  <value>   (synth-backed lanes: that voice type's
  //   DRUM_VOICE_PARAM_DEFAULTS keys, e.g. drums.lane.kick.tune; sample-backed lanes:
  //   SAMPLE_LANE_PARAM_KEYS plus gainDb/tune)
  //   <track>.lane.<name>.<key>  ""        clears a params-bag override back to its default
  // — the exact gap pilot 101 hit ("no beat set path ... can edit a declared lane's backing
  // params at all"), and what makes lane-targeted `beat vary` manifests replayable via beat set.
  const laneParamMatch = rest.match(/^lane\.([a-zA-Z0-9_-]+)\.([A-Za-z0-9_]+)$/)
  if (laneParamMatch) {
    return setLaneParamPath(doc, trackId, laneParamMatch[1]!, laneParamMatch[2]!, value)
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
    // Phase 26 Stream DC: an instrument track's effect-chain param fields (eqLow, distortionMix,
    // etc.) — the 12 EffectType members' own knobs, restricted via INSTRUMENT_EFFECT_FIELD_KEYS to
    // the fields that actually apply to a SoundFont voice (see that constant's doc comment). Table-
    // driven, same switch as the general optional-synth-fields branch below, just gated to this
    // narrower key set instead of every SYNTH_FIELDS entry.
    if (INSTRUMENT_EFFECT_FIELD_KEYS.has(rest)) {
      const def = SYNTH_FIELD_BY_KEY.get(rest)!
      switch (def.kind) {
        case 'number':
          return replaceTrack(doc, { ...track, synth: { ...track.synth, [def.key]: parseNum(value, rest) } })
        case 'enum':
          if (!def.values!.includes(value)) throw new BeatEditError(`${rest} must be one of ${def.values!.join('|')}, got "${value}"`)
          return replaceTrack(doc, { ...track, synth: { ...track.synth, [def.key]: value } })
        case 'bool':
          if (value !== 'true' && value !== 'false') throw new BeatEditError(`${rest} must be true or false, got "${value}"`)
          return replaceTrack(doc, { ...track, synth: { ...track.synth, [def.key]: value === 'true' } })
      }
    }
    throw new BeatEditError(`unknown field "${rest}" on instrument track "${trackId}" (have: soundfont, program, volume, pan, name, color; effect-chain params: ${[...INSTRUMENT_EFFECT_FIELD_KEYS].join(', ')})`)
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
    `unknown field "${rest}" on track "${trackId}" (core: ${SYNTH_PARAM_ORDER.join(', ')}; shaped: ${SYNTH_FIELDS.map((f) => f.key).join(', ')}; also name, color, shuffleAmount, shuffleGrid, pattern.<lane>[i], lane.<name>.<param> on declared-lane drums tracks)`,
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

export interface DuplicateNotesOptions {
  /** Restrict to these note ids (a selection). Omitted = every note on the track. */
  noteIds?: string[]
  /** Steps added to every copy's `start` (a single uniform delta — a rigid-body duplicate of the
   * whole scoped group, matching Ableton's Ctrl/Option-drag-to-copy and NoteView.tsx's own
   * rigid-body group-move gesture). Default 0 (copies land exactly on top of the originals). */
  offsetStart?: number
  /** Semitones added to every copy's `pitch`, clamped to MIDI 0-127 (same clamp-not-error stance
   * transposeNotes takes). Default 0. */
  offsetPitch?: number
}

/** Copies the scoped notes onto the SAME track, offsetting each by `offsetStart` steps and
 * `offsetPitch` semitones, minting a fresh id for every copy (addNote's own `u<n>` minting
 * scheme) — a thin wrapper on addNote, one call per copied note, so the result is exactly what
 * that many manual `addNote` calls would produce. Originals are left untouched; this is add-only
 * (research 57 item #2: "no primitive exists in edit.ts AND no GUI affordance"). Two calling
 * conventions share this one primitive (research 57's own recommendation, "reuse the same
 * primitive"): a drag-to-duplicate commit passes the drag's own (offsetStart, offsetPitch) delta
 * so the copy lands where the user dropped it; a clipboard paste passes an offsetStart computed
 * at paste time (paste position minus the copied selection's own earliest start) and
 * offsetPitch=0 (paste keeps the copied pitches). `added` — one entry per scoped note, in scoped
 * order — lets a caller select the fresh copies immediately (the drag/paste UX both do). */
export function duplicateNotes(doc: BeatDocument, trackId: string, opts: DuplicateNotesOptions = {}): { doc: BeatDocument; added: BeatNote[] } {
  const track = findTrack(doc, trackId)
  if (track.kind === 'drums') throw new BeatEditError(`track "${trackId}" is a drums track — duplicateNotes works on notes, not hits`)
  if (opts.noteIds) {
    const have = new Set(track.notes.map((n) => n.id))
    const missing = opts.noteIds.filter((id) => !have.has(id))
    if (missing.length) throw new BeatEditError(`no note(s) ${missing.map((m) => `"${m}"`).join(', ')} on track "${trackId}"`)
  }
  const wanted = opts.noteIds ? new Set(opts.noteIds) : null
  const offsetStart = opts.offsetStart ?? 0
  const offsetPitch = opts.offsetPitch ?? 0
  if (!Number.isFinite(offsetStart)) throw new BeatEditError(`offsetStart must be a finite number of steps, got ${offsetStart}`)
  if (!Number.isFinite(offsetPitch)) throw new BeatEditError(`offsetPitch must be a finite number of semitones, got ${offsetPitch}`)
  const scoped = wanted ? track.notes.filter((n) => wanted.has(n.id)) : track.notes

  let cur = doc
  const added: BeatNote[] = []
  for (const n of scoped) {
    const { doc: next, note } = addNote(cur, trackId, {
      pitch: Math.max(0, Math.min(127, n.pitch + offsetPitch)),
      start: Math.max(0, canon(n.start + offsetStart)),
      duration: n.duration,
      velocity: n.velocity,
      chance: n.chance,
      cent: n.cent,
      ratchetCount: n.ratchetCount,
      ratchetCurve: n.ratchetCurve,
      ratchetLength: n.ratchetLength,
    })
    cur = next
    added.push(note)
  }
  return { doc: cur, added }
}

/** v0.10 effect-chain primitives (docs/phase-22-stream-aa.md). A track's `effects` array IS the
 * insert chain's order — these are the only ways to change it, so every mutation stays a small,
 * explicit list edit (add one entry, drop one entry, move one entry, flip one flag) rather than a
 * hand-rolled array splice at each call site. Phase 26 Stream DC widened this from synth-only to
 * every track kind except 'audio' (which carries no live/non-clip content at all) — see
 * BeatTrack.effects's comment in document.ts. */

/** Adds a new effect instance. Mints `<type>` (or `<type>_2`, `_3`, ... on collision) when `id` is
 * omitted; errors if a given id already exists on the track. `index` inserts at that position
 * (clamped to the list bounds); omitted = appended (the end of the chain, the least surprising
 * default for "add a new insert"). */
export function addEffect(doc: BeatDocument, trackId: string, type: EffectType, opts: { id?: string; index?: number; enabled?: boolean } = {}): { doc: BeatDocument; effect: BeatEffect } {
  const track = findTrack(doc, trackId)
  if (track.kind === 'audio') throw new BeatEditError(`track "${trackId}" is an audio track — effect chains only belong on synth/drums/instrument tracks`)
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
    // v0.10: a fresh synth or drums track starts on the format's default chain (elided on
    // serialize, same as every other init-patch default) — Phase 26 Stream DC: drums matches
    // synth here now that the old fixed bus insert is folded into this same reorderable list (see
    // BeatTrack.effects). A fresh instrument track carries none — it never had a fixed insert to
    // preserve backward compatibility with.
    effects: kind === 'synth' || kind === 'drums' ? defaultEffectChain() : [],
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

/** Phase 23 Stream BB: fine-grained, structural drum-lane editing primitives — the GUI-facing
 * counterpart to `applyDrumKit`'s whole-list replace (drumkit.ts). Same split as the v0.10
 * effect-chain primitives just above `addLane`/etc. in this file: add/remove/move change the
 * LIST's shape or order, so each gets its own primitive rather than a setValue path=value entry.
 * `setLaneBacking`/`setLaneParam` retype/tune a SINGLE existing lane in place. Every one of these
 * requires the track to already be on the OPEN lane model (`lanes.length > 0`) — see
 * `materializeLanes` below for the one-time, explicit opt-in a legacy/migrated track needs first
 * (docs/phase-22-stream-ab.md §5 flagged exactly this gap: "no dedicated setValue path for
 * lanes[].backing.params was added ... future work"). */

const LANE_NAME_RE = /^[a-zA-Z0-9_-]+$/

/** Phase 26 Stream DK: parses a sample-backed lane's optional trailing tokens (Start/Length/AHD
 * envelope/filter/fx-list) — the BeatEditError-throwing twin of parse.ts's `parseSampleLaneExtras`
 * (same "parallel implementation, different error shape per caller" discipline this file's own
 * doc comment above already applies to the whole backing grammar). */
function parseSampleLaneExtraTokens(name: string, tokens: string[]): { params: Record<string, number>; filterType: SampleLaneFilterType; effects: BeatEffect[] } {
  const params: Record<string, number> = {}
  let filterType: SampleLaneFilterType = 'lowpass'
  let effects: BeatEffect[] = []
  for (const kv of tokens) {
    const eq = kv.indexOf('=')
    if (eq === -1) throw new BeatEditError(`lane "${name}" sample extra must be "key=value", got "${kv}"`)
    const key = kv.slice(0, eq)
    const raw = kv.slice(eq + 1)
    if (key === 'filter') {
      if (!isSampleLaneFilterType(raw)) throw new BeatEditError(`lane "${name}": filter must be one of lowpass|bandpass|highpass, got "${raw}"`)
      filterType = raw
    } else if (key === 'fx') {
      const types = raw.split(',').filter((t) => t.length > 0)
      for (const t of types) {
        if (!(EFFECT_TYPES as readonly string[]).includes(t)) throw new BeatEditError(`lane "${name}": unknown effect type "${t}" in fx list (expected one of ${EFFECT_TYPES.join('|')})`)
      }
      effects = types.map((t) => ({ id: t, type: t as EffectType, enabled: true }))
    } else if (isSampleLaneParamKey(key)) {
      params[key] = canon(parseNum(raw, `lane ${name} ${key}`))
    } else {
      throw new BeatEditError(`lane "${name}": unknown sample lane field "${key}" (expected filter|fx|${Object.keys(SAMPLE_LANE_PARAM_DEFAULTS).join('|')})`)
    }
  }
  return { params, filterType, effects }
}

/** Parses the SAME backing grammar the file's own `lane <name> <backing>` line uses (see
 * parse.ts's `tryParseLaneDecl`), from tokens already split off the name — e.g.
 * `['synth:membrane', 'tune=30']`, `['sample', 'crash-1', '-3', '0']`, `['sf', 'gm-kit', '0',
 * '37']`. A parallel implementation (not a shared import) is deliberate: parse.ts's version
 * throws BeatParseError with a line number, drumkit.ts's parseBacking works off an already-parsed
 * JSON object, and this one throws BeatEditError with no line number — three different error
 * shapes for three different callers, same discipline the codebase already applies elsewhere
 * (drumkit.ts's own header comment: "a different shape of edit ... gets its own ... trio"). */
function parseLaneBackingTokens(name: string, tokens: string[]): BeatDrumLaneDecl['backing'] {
  const sel = tokens[0]
  if (sel === undefined) throw new BeatEditError(`lane "${name}": backing must be "synth:<voice> [key=value ...]" | "sample <id> <gainDb> <tune>" | "sf <id> <program> <note>"`)
  if (sel.startsWith('synth:')) {
    const voice = sel.slice('synth:'.length)
    if (!(DRUM_VOICE_TYPES as readonly string[]).includes(voice)) {
      throw new BeatEditError(`lane "${name}": unknown drum voice type "${voice}" (expected one of ${DRUM_VOICE_TYPES.join('|')})`)
    }
    const params: Record<string, number> = {}
    for (const kv of tokens.slice(1)) {
      const eq = kv.indexOf('=')
      if (eq === -1) throw new BeatEditError(`lane "${name}": synth param must be "key=value", got "${kv}"`)
      const key = kv.slice(0, eq)
      params[key] = canon(parseNum(kv.slice(eq + 1), `lane ${name} ${key}`))
    }
    return { type: 'synth', voice: voice as DrumVoiceType, params }
  }
  if (sel === 'sample') {
    if (tokens.length < 4) throw new BeatEditError(`lane "${name}": sample backing expects "sample <sample-id> <gain dB> <tune semitones> [key=value ...]", got "${tokens.join(' ')}"`)
    const gainDb = canon(parseNum(tokens[2]!, `lane ${name} gain`))
    const tune = canon(parseNum(tokens[3]!, `lane ${name} tune`))
    if (tune < -24 || tune > 24) throw new BeatEditError(`lane "${name}": tune must be -24..24 semitones, got ${tune}`)
    const { params, filterType, effects } = parseSampleLaneExtraTokens(name, tokens.slice(4))
    return { type: 'sample', sample: tokens[1]!, gainDb, tune, params, filterType, effects }
  }
  if (sel === 'sf') {
    if (tokens.length !== 4) throw new BeatEditError(`lane "${name}": sf backing expects "sf <sample-id> <program> <note>", got "${tokens.join(' ')}"`)
    const program = Math.trunc(parseNum(tokens[2]!, `lane ${name} sf program`))
    const note = Math.trunc(parseNum(tokens[3]!, `lane ${name} sf note`))
    if (program < 0 || program > 127) throw new BeatEditError(`lane "${name}": sf program must be 0-127, got ${program}`)
    if (note < 0 || note > 127) throw new BeatEditError(`lane "${name}": sf note must be 0-127, got ${note}`)
    return { type: 'sf', sample: tokens[1]!, program, note }
  }
  throw new BeatEditError(`lane "${name}": backing must start with synth:<voice>|sample|sf, got "${sel}"`)
}

function requireDrumsWithOpenLanes(doc: BeatDocument, trackId: string): BeatTrack {
  const track = findTrack(doc, trackId)
  if (track.kind !== 'drums') throw new BeatEditError(`track "${trackId}" is a ${track.kind} track — lanes only belong on drum tracks`)
  if (track.lanes.length === 0) {
    throw new BeatEditError(`track "${trackId}" is still on the implicit 5-lane kit — call materializeLanes first (POST /lane {op:"materialize"}) to opt into per-lane editing`)
  }
  return track
}

/** One-time, explicit opt-in for a legacy/migrated drum track (declares no `lanes`, so it plays
 * through the untouched 5-lane switch — see DRUM_LANES's doc comment) into the open lane model,
 * so its lanes become individually addable/reorderable/retypeable. No-op (returns doc unchanged)
 * if the track already declares lanes. Maps the OLD track-wide voice-shaping fields
 * (kickTune/kickPunch/kickDecay, snareTone/snareDecay, hatDecay/hatTone/openHatDecay) onto the 5
 * new per-lane synth backings so the migrated kit sounds the same as before the switch (clap has
 * no legacy field — the engine hard-wires a fixed pink-noise voice for it — so it lands on the new
 * model's plain noise defaults, the closest honest equivalent). Existing hits are untouched: they
 * already reference these same 5 lane names, and `declaredLaneNames` returns the identical set
 * before and after, so nothing about hit validation changes — only the ENGINE's dispatch flips
 * from the legacy switch to the declared-lane table for this track going forward. */
export function materializeLanes(doc: BeatDocument, trackId: string): { doc: BeatDocument; lanes: BeatDrumLaneDecl[] } {
  const track = findTrack(doc, trackId)
  if (track.kind !== 'drums') throw new BeatEditError(`track "${trackId}" is a ${track.kind} track — lanes only belong on drum tracks`)
  if (track.lanes.length > 0) return { doc, lanes: track.lanes }
  const p = track.synth
  const lanes: BeatDrumLaneDecl[] = [
    { name: 'kick', backing: { type: 'synth', voice: 'membrane', params: { tune: p.kickTune, punch: p.kickPunch, decay: p.kickDecay } } },
    { name: 'snare', backing: { type: 'synth', voice: 'noise', params: { tone: p.snareTone, decay: p.snareDecay } } },
    { name: 'clap', backing: { type: 'synth', voice: 'noise', params: {} } },
    { name: 'hat', backing: { type: 'synth', voice: 'metal', params: { decay: p.hatDecay, tone: p.hatTone } } },
    { name: 'openhat', backing: { type: 'synth', voice: 'metal', params: { decay: p.openHatDecay, tone: p.hatTone } } },
  ]
  return { doc: replaceTrack(doc, { ...track, lanes }), lanes }
}

/** Appends a new declared lane (`index` inserts at that position, clamped; omitted = end — same
 * convention as `addEffect`). `backingTokens` is the backing grammar's tokens AFTER the name
 * (e.g. `['synth:noise', 'decay=0.2']`). Requires the track already be on the open lane model
 * (see `materializeLanes`). */
export function addLane(doc: BeatDocument, trackId: string, name: string, backingTokens: string[], opts: { index?: number } = {}): { doc: BeatDocument; lane: BeatDrumLaneDecl } {
  const track = requireDrumsWithOpenLanes(doc, trackId)
  if (!LANE_NAME_RE.test(name)) throw new BeatEditError(`lane names are single alphanumeric/_/- tokens, got "${name}"`)
  if (track.lanes.some((l) => l.name === name)) throw new BeatEditError(`lane "${name}" already exists on track "${trackId}"`)
  const backing = parseLaneBackingTokens(name, backingTokens)
  if ((backing.type === 'sample' || backing.type === 'sf') && !doc.media.some((m) => m.id === backing.sample)) {
    throw new BeatEditError(`lane "${name}": references unregistered sample "${backing.sample}" — register it with beat sample first`)
  }
  const added: BeatDrumLaneDecl = { name, backing }
  const index = opts.index === undefined ? track.lanes.length : Math.max(0, Math.min(Math.trunc(opts.index), track.lanes.length))
  const lanes = [...track.lanes.slice(0, index), added, ...track.lanes.slice(index)]
  return { doc: replaceTrack(doc, { ...track, lanes }), lane: added }
}

/** Removes a declared lane. Refuses if any hit still references it (same "re-lane them first"
 * discipline `applyDrumKit`'s orphan check uses) — a lane can't be silently dropped out from
 * under existing hits. */
export function removeLane(doc: BeatDocument, trackId: string, name: string): { doc: BeatDocument; lane: BeatDrumLaneDecl } {
  const track = requireDrumsWithOpenLanes(doc, trackId)
  const lane = track.lanes.find((l) => l.name === name)
  if (!lane) throw new BeatEditError(`no lane "${name}" on track "${trackId}" (have: ${track.lanes.map((l) => l.name).join(', ')})`)
  if (track.hits.some((h) => h.lane === name)) {
    throw new BeatEditError(`track "${trackId}" has hits on lane "${name}" — remove or re-lane them first`)
  }
  return { doc: replaceTrack(doc, { ...track, lanes: track.lanes.filter((l) => l.name !== name) }), lane }
}

/** Moves a declared lane to a new position (0-based, clamped) — array order IS row order (the
 * editor's row axis and the engine's dispatch both iterate `lanes` in declaration order), so this
 * is the whole reorder operation, same shape as `moveEffect`. */
export function moveLane(doc: BeatDocument, trackId: string, name: string, toIndex: number): { doc: BeatDocument; lane: BeatDrumLaneDecl; before: number; after: number } {
  const track = requireDrumsWithOpenLanes(doc, trackId)
  const from = track.lanes.findIndex((l) => l.name === name)
  if (from === -1) throw new BeatEditError(`no lane "${name}" on track "${trackId}" (have: ${track.lanes.map((l) => l.name).join(', ')})`)
  const after = Math.max(0, Math.min(Math.trunc(toIndex), track.lanes.length - 1))
  const lanes = [...track.lanes]
  const [item] = lanes.splice(from, 1)
  lanes.splice(after, 0, item!)
  return { doc: replaceTrack(doc, { ...track, lanes }), lane: item!, before: from, after }
}

/** Retypes/replaces one lane's WHOLE backing (e.g. synth:membrane -> sample, or a fresh synth
 * voice with a fresh param bag) — the lane-level analog of `applyDrumKit`'s whole-list replace,
 * scoped to one lane. The lane's NAME (and therefore every hit referencing it) is untouched. */
export function setLaneBacking(doc: BeatDocument, trackId: string, name: string, backingTokens: string[]): { doc: BeatDocument; lane: BeatDrumLaneDecl } {
  const track = requireDrumsWithOpenLanes(doc, trackId)
  const idx = track.lanes.findIndex((l) => l.name === name)
  if (idx === -1) throw new BeatEditError(`no lane "${name}" on track "${trackId}" (have: ${track.lanes.map((l) => l.name).join(', ')})`)
  const backing = parseLaneBackingTokens(name, backingTokens)
  if ((backing.type === 'sample' || backing.type === 'sf') && !doc.media.some((m) => m.id === backing.sample)) {
    throw new BeatEditError(`lane "${name}": references unregistered sample "${backing.sample}" — register it with beat sample first`)
  }
  const lanes = track.lanes.map((l, i) => (i === idx ? { name, backing } : l))
  return { doc: replaceTrack(doc, { ...track, lanes }), lane: lanes[idx]! }
}

/** Fine-grained single-param edit on a synth- OR sample-backed lane — the exact gap
 * docs/phase-22-stream-ab.md §5 flagged ("no dedicated setValue path for lanes[].backing.params
 * was added"). `value === undefined` clears the override back to that voice type's default
 * (DRUM_VOICE_PARAM_DEFAULTS for synth-backed / SAMPLE_LANE_PARAM_DEFAULTS for sample-backed),
 * matching the format's own canonical-elision discipline for these params (serialize.ts's
 * `serializeLaneBacking` already omits a param equal to its default). Phase 26 Stream DK
 * generalized this off synth-only (research 68/decisions.md #145: the drum-sampler's Start/
 * Length/AHD-envelope/filter surface rides this SAME primitive, not a new one) — sf-backed lanes
 * still have no per-param concept (their two fields, program/note, are identity, not shaping) and
 * are still refused here. */
export function setLaneParam(doc: BeatDocument, trackId: string, name: string, key: string, value: number | undefined): { doc: BeatDocument; lane: BeatDrumLaneDecl } {
  const track = requireDrumsWithOpenLanes(doc, trackId)
  const idx = track.lanes.findIndex((l) => l.name === name)
  if (idx === -1) throw new BeatEditError(`no lane "${name}" on track "${trackId}" (have: ${track.lanes.map((l) => l.name).join(', ')})`)
  const lane = track.lanes[idx]!
  if (lane.backing.type === 'sf') throw new BeatEditError(`lane "${name}" is sf-backed — only synth- and sample-backed lanes take per-param edits`)
  if (lane.backing.type === 'sample' && !isSampleLaneParamKey(key)) {
    throw new BeatEditError(`lane "${name}": unknown sample lane param "${key}" (expected one of ${Object.keys(SAMPLE_LANE_PARAM_DEFAULTS).join('|')})`)
  }
  const params = { ...lane.backing.params }
  if (value === undefined) delete params[key]
  else params[key] = canon(value)
  const lanes = track.lanes.map((l, i) => (i === idx ? { ...l, backing: { ...l.backing, params } as BeatLaneBacking } : l))
  return { doc: replaceTrack(doc, { ...track, lanes }), lane: lanes[idx]! }
}

/** Phase 35 Stream OA: the `beat set` spelling of `setLaneParam` — parses/validates one
 * `<track>.lane.<name>.<key> <value>` edit (see setValue's lane-param branch). String-typed on
 * purpose: an empty value clears a params-bag override back to its default, mirroring
 * setLaneParam's `undefined`. Two additions over raw setLaneParam: a sample-backed lane's
 * gainDb/tune (backing FIELDS, not params-bag entries — pilot 101: no CLI/MCP path could touch
 * them either) are settable through the same spelling, and a synth-backed lane's key is
 * validated against its voice type's own param set (DRUM_VOICE_PARAM_DEFAULTS) so a typo'd or
 * wrong-voice key fails loudly instead of writing a serialized-but-inaudible param. */
export function setLaneParamPath(doc: BeatDocument, trackId: string, name: string, key: string, value: string): BeatDocument {
  const track = requireDrumsWithOpenLanes(doc, trackId)
  const lane = track.lanes.find((l) => l.name === name)
  if (!lane) throw new BeatEditError(`no lane "${name}" on track "${trackId}" (have: ${track.lanes.map((l) => l.name).join(', ')})`)
  if (lane.backing.type === 'sample' && (key === 'gainDb' || key === 'tune')) {
    const n = canon(parseNum(value, `lane ${name} ${key}`))
    if (key === 'tune' && (n < -24 || n > 24)) throw new BeatEditError(`lane "${name}": tune must be -24..24 semitones, got ${n}`)
    const lanes = track.lanes.map((l) => (l === lane ? { ...l, backing: { ...lane.backing, [key]: n } as BeatLaneBacking } : l))
    return replaceTrack(doc, { ...track, lanes })
  }
  if (lane.backing.type === 'sample' && !isSampleLaneParamKey(key)) {
    throw new BeatEditError(`lane "${name}": unknown sample lane param "${key}" (expected one of ${Object.keys(SAMPLE_LANE_PARAM_DEFAULTS).join('|')}|gainDb|tune)`)
  }
  if (lane.backing.type === 'synth') {
    const valid = Object.keys(DRUM_VOICE_PARAM_DEFAULTS[lane.backing.voice])
    if (!valid.includes(key)) {
      throw new BeatEditError(`lane "${name}" on track "${trackId}" is synth:${lane.backing.voice}-backed — its params are ${valid.join('|')}, got "${key}"`)
    }
  }
  const v = value.trim() === '' ? undefined : parseNum(value, `lane ${name} ${key}`)
  return setLaneParam(doc, trackId, name, key, v).doc
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

/** v0.5: assigns (or clears, with ref = null) a drum lane's one-shot sample.
 *
 * Declared-lane tracks (every fresh drums track since the 12-lane default kit): the lane's
 * DECLARATION carries its backing, and declared-mode playback reads only that — the legacy
 * laneSamples bag below is invisible to it. Until 2026-07-13 this function wrote ONLY
 * laneSamples, so `beat lane`/`beat_lane` on a modern track "succeeded" while the render
 * silently kept the synth voice (owner's dogfood session; the same v0.5-vs-declared split
 * behind research/101's drum-vary no-op). Now it edits the declaration itself: sample backing
 * becomes the canonical `lane <name> sample <id> <gain> <tune>` decl line, and `none` restores
 * the synth voice (the default kit's voice for that name; membrane for custom lane names). */
export function setLaneSample(
  doc: BeatDocument,
  trackId: string,
  lane: string,
  ref: { sample: string; gainDb: number; tune: number } | null,
): BeatDocument {
  const track = findTrack(doc, trackId)
  if (track.kind !== 'drums') throw new BeatEditError(`track "${trackId}" is a ${track.kind} track — lane samples only belong on drum tracks`)

  if (track.lanes.length > 0) {
    const decl = track.lanes.find((l) => l.name === lane)
    if (!decl) throw new BeatEditError(`no lane "${lane}" declared on track "${trackId}" (have: ${track.lanes.map((l) => l.name).join(', ')})`)
    let backing: BeatLaneBacking
    if (ref === null) {
      const kitDefault = DEFAULT_DRUM_KIT.find((v) => v.name === lane)
      backing = { type: 'synth', voice: kitDefault ? kitDefault.voice : 'membrane', params: {} }
    } else {
      if (!doc.media.some((m) => m.id === ref.sample)) throw new BeatEditError(`no sample "${ref.sample}" in the media block (have: ${doc.media.map((m) => m.id).join(', ') || 'none'}) — register it with beat sample first`)
      if (ref.tune < -24 || ref.tune > 24) throw new BeatEditError(`lane tune must be -24..24 semitones, got ${ref.tune}`)
      // Re-backing an already-sample-backed lane keeps its Start/Length/AHD/filter/effects
      // shaping (lane character, not sample identity); coming from a synth voice starts clean
      // with the same defaults a parsed bare `lane <name> sample ...` decl line gets.
      const keep = decl.backing.type === 'sample'
        ? { params: decl.backing.params, filterType: decl.backing.filterType, effects: decl.backing.effects }
        : { params: {}, filterType: 'lowpass' as SampleLaneFilterType, effects: [] }
      backing = { type: 'sample', sample: ref.sample, gainDb: ref.gainDb, tune: ref.tune, ...keep }
    }
    const lanes = track.lanes.map((l) => (l.name === lane ? { ...l, backing } : l))
    return replaceTrack(doc, { ...track, lanes })
  }

  // Legacy implicit-5-lane tracks: laneSamples is what their playback path actually reads.
  if (!(DRUM_LANES as readonly string[]).includes(lane)) throw new BeatEditError(`unknown drum lane "${lane}" (expected one of ${DRUM_LANES.join('|')})`)
  const laneSamples = { ...track.laneSamples }
  if (ref === null) {
    delete laneSamples[lane as DrumLane]
  } else {
    if (!doc.media.some((m) => m.id === ref.sample)) throw new BeatEditError(`no sample "${ref.sample}" in the media block (have: ${doc.media.map((m) => m.id).join(', ') || 'none'}) — register it with beat sample first`)
    if (ref.tune < -24 || ref.tune > 24) throw new BeatEditError(`lane tune must be -24..24 semitones, got ${ref.tune}`)
    laneSamples[lane as DrumLane] = { ...ref }
  }
  return replaceTrack(doc, { ...track, laneSamples })
}

/** Phase 35 Stream OB: the one-shot, EXPLICIT cleanup for stale v0.5 `laneSamples` lines on a
 * DECLARED-lane track, where they are dead data (declared-mode playback reads only the lane
 * declarations). `beat inspect` flags them and points here; the serializer itself keeps
 * round-tripping them untouched (D4 — content is never destroyed silently, only by this
 * deliberate command). Deliberately refuses on a legacy implicit-5-lane track, where the same
 * lines ARE the live sample assignments — clearing those would change the sound, and the
 * per-lane `setLaneSample(..., null)` path already covers detaching them one at a time. */
export function clearLegacyLaneSamples(doc: BeatDocument, trackId: string): { doc: BeatDocument; cleared: DrumLane[] } {
  const track = findTrack(doc, trackId)
  if (track.kind !== 'drums') throw new BeatEditError(`track "${trackId}" is a ${track.kind} track — lane samples only belong on drum tracks`)
  if (track.lanes.length === 0) {
    throw new BeatEditError(
      `track "${trackId}" declares no lanes — its \`lane\` lines are live v0.5 sample assignments (playback reads them), not stale data. To detach one, use \`beat lane <file> ${trackId} <lane> none\`.`,
    )
  }
  const cleared = DRUM_LANES.filter((lane) => track.laneSamples[lane])
  if (cleared.length === 0) throw new BeatEditError(`track "${trackId}" has no legacy lane-sample lines to clear`)
  return { doc: replaceTrack(doc, { ...track, laneSamples: {} }), cleared }
}

/** A fresh document with one starter synth track — what `beat init` writes. */
export function initDocument(opts: { bpm?: number; loopBars?: number; trackId?: string } = {}): BeatDocument {
  const bpm = opts.bpm ?? 120
  const loopBars = opts.loopBars ?? 2
  if (!Number.isInteger(bpm) || bpm < 20 || bpm > 999) throw new BeatEditError(`bpm must be an integer 20-999, got ${bpm}`)
  if (!Number.isInteger(loopBars) || loopBars < 1 || loopBars > 64) throw new BeatEditError(`loop_bars must be an integer 1-64, got ${loopBars}`)
  // v0.11 (Phase 36): fresh documents stamp the current format version — the established bump
  // convention (see format-spec.md's v0.10 note): initDocument / the BeatLab-bridge converter
  // stamp NEW documents with the new version; existing files keep their own version string and
  // parse (and round-trip) unchanged, since every v0.11 addition is elided-by-default.
  const base: BeatDocument = { formatVersion: '0.11', bpm, loopBars, selectedTrack: '', media: [], tracks: [], groups: [], scenes: [], song: null }
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

/** The inverse of `saveClip`: loads an already-saved clip's notes/hits back into the track's LIVE
 * buffer, overwriting whatever's there now. Phase 29 Stream GA — before this existed, `saveClip`
 * (live -> clip) had no counterpart (clip -> live) anywhere in core, which was the deeper reason
 * docs/research/83/84/86's "clicking a later section's clip block never retargets the note editor"
 * bug was a real dead end from the GUI: even once the GUI knew WHICH clip a click meant, there was
 * no primitive to actually load that clip's content back into the one live buffer the note editor
 * always renders (track.notes/track.hits — see NoteView.tsx's header comment). Automation/loop/
 * signature stay on the clip untouched (there's no live-track automation to overwrite them with —
 * same v0.9 clip-scoped-only stance saveClip's own doc comment already establishes). */
export function loadClip(doc: BeatDocument, trackId: string, clipId: string): BeatDocument {
  const track = findTrack(doc, trackId)
  const clip = track.clips.find((c) => c.id === clipId)
  if (!clip) throw new BeatEditError(`track "${trackId}" has no clip "${clipId}" (have: ${track.clips.map((c) => c.id).join(', ') || 'none'})`)
  return replaceTrack(doc, {
    ...track,
    notes: clip.notes.map((n) => ({ ...n })),
    hits: track.kind === 'drums' ? clip.hits.map((h) => ({ ...h })) : [],
  })
}

/** v0.11 (Phase 36): the slot-map input shape every setScene caller may pass — either the
 * pre-v0.11 single-clip-per-track form (a bare clip id string, meaning one placement at 0: the
 * daemon's scene builders and the GUI's place-clip route all speak this) or an explicit placement
 * list. Mixed maps are fine (one track a string, another a placement array). */
export type BeatSlotsInput = Record<string, string | BeatPlacement[]>

/** Normalizes a BeatSlotsInput entry to a canonical placement list: a bare clip id becomes one
 * placement at 0; explicit placements get canonical number precision and (at, clip id) order.
 * Empty placement arrays are dropped by the caller (an empty list has no canonical form). */
function normalizeSlotEntry(entry: string | BeatPlacement[]): BeatPlacement[] {
  if (typeof entry === 'string') return [{ clip: entry, at: 0 }]
  return sortPlacements(entry.map((p) => ({ clip: p.clip, at: canon(p.at) })))
}

/** Sets (or creates) a scene's slot map. Every placement must reference an existing clip on an
 * existing track — same fail-loudly stance as the parser — and the v0.11 placement rules apply
 * (scenePlacementError: at finite/>=0, D16's audio-only-for-v1 scope guard, no overlap on one
 * track). Accepts the pre-v0.11 `Record<trackId, clipId>` shape unchanged (BeatSlotsInput above)
 * so single-clip callers keep working as-is. Preserves the scene's existing `name`
 * (v0.10, Phase 32 Stream LB) when re-setting an already-named scene, the same "re-snapshot
 * doesn't wipe unrelated metadata" discipline `saveClip` already follows for automation/loop —
 * this is a slot-map edit, not a rename. */
export function setScene(doc: BeatDocument, sceneId: string, slots: BeatSlotsInput): BeatDocument {
  if (!/^[a-zA-Z0-9_-]+$/.test(sceneId)) throw new BeatEditError(`scene ids are single alphanumeric/_/- tokens, got "${sceneId}"`)
  const normalized: Record<string, BeatPlacement[]> = {}
  for (const [trackId, entry] of Object.entries(slots)) {
    const track = findTrack(doc, trackId)
    const placements = normalizeSlotEntry(entry)
    if (placements.length === 0) continue // no placements = the track key is simply absent (canonical form)
    for (const p of placements) {
      if (!track.clips.some((c) => c.id === p.clip)) throw new BeatEditError(`track "${trackId}" has no clip "${p.clip}" (have: ${track.clips.map((c) => c.id).join(', ') || 'none'})`)
    }
    normalized[trackId] = placements
  }
  const placementError = scenePlacementError(doc.tracks, doc.bpm, sceneId, normalized)
  if (placementError) throw new BeatEditError(placementError)
  const existing = doc.scenes.findIndex((s) => s.id === sceneId)
  const existingName = existing === -1 ? undefined : doc.scenes[existing]!.name
  const scene = { id: sceneId, ...(existingName !== undefined ? { name: existingName } : {}), slots: normalized }
  const scenes = existing === -1 ? [...doc.scenes, scene] : doc.scenes.map((s, i) => (i === existing ? scene : s))
  return { ...doc, scenes }
}

/** v0.11 (Phase 36, D16): adds ONE placement of `clipId` at `at` (fractional 16th steps from the
 * section start) to `sceneId`'s slot for `trackId` — the friendlier single-placement verb `beat
 * place`/`beat_place` (Phase 36 PB) call, and the core primitive the GUI's drag-to-place will
 * eventually target. The scene must already exist (`setScene`/`beat scene` mints scenes — this
 * verb edits one placement, it doesn't define a scene). All v0.11 placement rules apply
 * (audio-only-for-v1, no overlap, at finite/>=0) — fail-loudly via scenePlacementError. */
export function placeClip(doc: BeatDocument, sceneId: string, trackId: string, clipId: string, at: number): { doc: BeatDocument; placement: BeatPlacement } {
  const scene = doc.scenes.find((s) => s.id === sceneId)
  if (!scene) throw new BeatEditError(`no scene "${sceneId}" (have: ${doc.scenes.map((s) => s.id).join(', ') || 'none'}) — create it first (beat scene / setScene)`)
  const track = findTrack(doc, trackId)
  if (!track.clips.some((c) => c.id === clipId)) throw new BeatEditError(`track "${trackId}" has no clip "${clipId}" (have: ${track.clips.map((c) => c.id).join(', ') || 'none'})`)
  if (!Number.isFinite(at) || at < 0) throw new BeatEditError(`placement at must be a finite number >= 0 steps, got ${at}`)
  const placement: BeatPlacement = { clip: clipId, at: canon(at) }
  const slots: Record<string, BeatPlacement[]> = { ...scene.slots, [trackId]: sortPlacements([...(scene.slots[trackId] ?? []), placement]) }
  const placementError = scenePlacementError(doc.tracks, doc.bpm, sceneId, slots)
  if (placementError) throw new BeatEditError(placementError)
  return { doc: { ...doc, scenes: doc.scenes.map((s) => (s.id === sceneId ? { ...s, slots } : s)) }, placement }
}

/** v0.11 (Phase 36, D16): removes ONE placement of `clipId` from `sceneId`'s slot for `trackId`.
 * Unambiguous when the clip is placed exactly once; when it's placed more than once, `at` is
 * REQUIRED to say which placement dies (fail-loudly on ambiguity — Phase 36 PB's `beat unplace
 * ... <clip>[@<at>]` contract). Removing a track's last placement drops the track key entirely
 * (an empty placement list has no canonical serialized form). */
export function unplaceClip(doc: BeatDocument, sceneId: string, trackId: string, clipId: string, at?: number): { doc: BeatDocument; removed: BeatPlacement } {
  const scene = doc.scenes.find((s) => s.id === sceneId)
  if (!scene) throw new BeatEditError(`no scene "${sceneId}" (have: ${doc.scenes.map((s) => s.id).join(', ') || 'none'})`)
  findTrack(doc, trackId)
  const placements = scene.slots[trackId] ?? []
  const matching = placements.filter((p) => p.clip === clipId && (at === undefined || p.at === canon(at)))
  if (matching.length === 0) {
    const have = placements.map((p) => `${p.clip}@${formatNumber(p.at)}`).join(', ') || 'none'
    throw new BeatEditError(
      at === undefined
        ? `clip "${clipId}" is not placed on track "${trackId}" in scene "${sceneId}" (placed there: ${have})`
        : `clip "${clipId}" is not placed at ${formatNumber(canon(at))} on track "${trackId}" in scene "${sceneId}" (placed there: ${have})`,
    )
  }
  if (matching.length > 1) {
    throw new BeatEditError(
      `clip "${clipId}" is placed ${matching.length} times on track "${trackId}" in scene "${sceneId}" (at ${matching.map((p) => formatNumber(p.at)).join(', ')}) — pass the placement's at to say which one`,
    )
  }
  const removed = matching[0]!
  const remaining = placements.filter((p) => p !== removed)
  const slots: Record<string, BeatPlacement[]> = { ...scene.slots }
  if (remaining.length === 0) delete slots[trackId]
  else slots[trackId] = remaining
  return { doc: { ...doc, scenes: doc.scenes.map((s) => (s.id === sceneId ? { ...s, slots } : s)) }, removed }
}

/** Sets (or clears, with name = null) a scene's display name (Phase 32 Stream LB — the GUI's
 * double-click-to-rename affordance on a section chip, mirroring `renameGroup`/track rename).
 * Named on the SCENE, not the section: a scene is dotbeat's unit of distinct musical content, and
 * the same scene reused across multiple sections should read as the same name everywhere (see
 * BeatScene's own doc comment for the full scene-vs-section reasoning). */
export function renameScene(doc: BeatDocument, sceneId: string, name: string | null): BeatDocument {
  const scene = doc.scenes.find((s) => s.id === sceneId)
  if (!scene) throw new BeatEditError(`no scene "${sceneId}" (have: ${doc.scenes.map((s) => s.id).join(', ') || 'none'})`)
  if (name !== null && !/^[a-zA-Z0-9_-]+$/.test(name)) throw new BeatEditError(`scene names are single alphanumeric/_/- tokens, got "${name}"`)
  return {
    ...doc,
    scenes: doc.scenes.map((s) => {
      if (s.id !== sceneId) return s
      if (name === null) {
        const { name: _drop, ...rest } = s
        return rest
      }
      return { ...s, name }
    }),
  }
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

/** Phase 24 Stream CB: moves a song section to a new position in the timeline (0-based, clamped to
 * the list bounds) — same reorder discipline as `moveEffect`/`moveLane`: splice out, splice back in
 * at the new index, one genuine "this section moved" fact rather than a delete+insert pair. Section
 * order IS the arrangement timeline — a section's start bar is the sum of every earlier section's
 * `bars` (there's no stored offset field, see `BeatSongSection`'s doc comment), so reordering the
 * array is the WHOLE operation; every later section's effective start just falls out of the new
 * order, nothing else needs updating. */
export function songMove(doc: BeatDocument, fromIndex: number, toIndex: number): { doc: BeatDocument; section: BeatSongSection; before: number; after: number } {
  if (!doc.song || doc.song.length === 0) throw new BeatEditError('not in song mode — no section to move')
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= doc.song.length) {
    throw new BeatEditError(`section index ${fromIndex} out of range (0-${doc.song.length - 1})`)
  }
  const after = Math.max(0, Math.min(Math.trunc(toIndex), doc.song.length - 1))
  const sections = doc.song.map((s) => ({ ...s }))
  const [item] = sections.splice(fromIndex, 1)
  sections.splice(after, 0, item!)
  return { doc: setSong(doc, sections), section: item!, before: fromIndex, after }
}

/** Next free `sN` scene id — the same "next free numbered id" idiom `addTrack`'s color cycling and
 * the daemon's `nextFreeClipId` use, just scoped to scene ids. Exported so both halves of Phase 26
 * Stream DJ (insertScene here, and daemon.ts's capture-and-insert route, which needs the identical
 * fresh id before it can snapshot INTO it) share one scan instead of two independently-maintained
 * copies. */
export function nextSceneId(doc: BeatDocument): string {
  let max = 0
  for (const s of doc.scenes) {
    const m = /^s(\d+)$/.exec(s.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `s${max + 1}`
}

/** Splices a NEW song section referencing `sceneId` into `doc.song` at `index` (0-based, clamped to
 * 0..song.length — inserting AT song.length appends after the last section, the same clamp
 * discipline `songMove`'s `toIndex` already uses). The scene itself must already exist (callers
 * mint/populate it first via `setScene`/`saveClip` — see `insertScene` below for the empty-scene
 * case, and `src/daemon/daemon.ts`'s `captureAndInsertScene` for the live-content-snapshot case);
 * this primitive's whole job is the section-LIST splice, the one piece both flavors share
 * identically. Requires song mode already (mirrors `songMove`/`songDelete`/`songResize`'s "not in
 * song mode" refusal) — there's no section list to insert a position into in loop mode; append a
 * section first to start song mode. */
export function songInsert(doc: BeatDocument, index: number, sceneId: string, bars: number): { doc: BeatDocument; section: BeatSongSection; index: number } {
  if (!doc.song || doc.song.length === 0) throw new BeatEditError('not in song mode — no section list to insert into (append a section first to start song mode)')
  if (!doc.scenes.some((s) => s.id === sceneId)) throw new BeatEditError(`no scene "${sceneId}" (have: ${doc.scenes.map((x) => x.id).join(', ') || 'none'})`)
  if (!Number.isInteger(bars) || bars < 1 || bars > 64) throw new BeatEditError(`section bars must be an integer 1-64, got ${bars}`)
  const at = Math.max(0, Math.min(Math.trunc(index), doc.song.length))
  const sections = doc.song.map((s) => ({ ...s }))
  const section: BeatSongSection = { scene: sceneId, bars }
  sections.splice(at, 0, section)
  return { doc: setSong(doc, sections), section, index: at }
}

/** Phase 26 Stream DJ ("Insert Scene"): mints a fresh, genuinely independent `BeatScene` with EMPTY
 * slots (no clips assigned — every track silent there until clips are placed into it, e.g. via the
 * existing "Place in Arrangement" flow) and splices a new song section referencing it into
 * `doc.song` at `index` (`songInsert` above).
 *
 * This is the fix for the shared-scene gap `docs/product-roadmap.md`'s Arrangement row names: today
 * `songAppend` (`src/daemon/daemon.ts`) always reuses an existing scene id (the last section's, or a
 * loop-conversion bootstrap), so editing one section's clips silently edits every OTHER section that
 * happens to reference the same scene. Insert Scene is the first GUI/API-reachable way to land a
 * section whose scene was never shared with anything — genuinely independent from the moment it's
 * created, not just from the moment its first clip diverges. */
export function insertScene(doc: BeatDocument, index: number, bars: number): { doc: BeatDocument; section: BeatSongSection; index: number; sceneId: string } {
  const sceneId = nextSceneId(doc)
  const withScene = setScene(doc, sceneId, {})
  const { doc: next, section, index: at } = songInsert(withScene, index, sceneId, bars)
  return { doc: next, section, index: at, sceneId }
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

/** Phase 26 Stream DI: validates an (optional) interpolation value passed to any of the point
 * primitives below — same "fail loudly on an unknown value" stance as checkAutomatableParam. */
function checkInterpolation(interpolation: AutomationInterpolation | undefined): void {
  if (interpolation !== undefined && !(AUTOMATION_INTERPOLATIONS as readonly string[]).includes(interpolation)) {
    throw new BeatEditError(`automation point interpolation must be one of ${AUTOMATION_INTERPOLATIONS.join('|')}, got "${String(interpolation)}"`)
  }
}

/** Canonical elision (D4): 'linear' (the default) and unset both mean "no override" — never
 * actually stored on the point, so there's exactly one representation of "this segment is
 * linear," matching AUTOMATION_POINT_FIELD_DEFAULTS / the serializer's own elision check. */
function canonInterpolation(v: AutomationInterpolation | undefined): AutomationInterpolation | undefined {
  return v && v !== AUTOMATION_POINT_FIELD_DEFAULTS.interpolation ? v : undefined
}

/** Adds a new automation point to a clip's `param` lane (creating the lane if this is its first
 * point). Mints the next free `p<n>` id scoped to that lane if `id` is omitted; errors if a
 * given id already exists in the lane (use moveAutomationPoint to edit an existing point). */
export function addAutomationPoint(
  doc: BeatDocument,
  trackId: string,
  clipId: string,
  param: string,
  point: { time: number; value: number; id?: string; interpolation?: AutomationInterpolation },
): { doc: BeatDocument; point: BeatAutomationPoint } {
  const track = findTrack(doc, trackId)
  checkAutomatableParam(param, track.kind)
  const clip = findClip(track, clipId)
  if (!Number.isFinite(point.time) || point.time < 0) throw new BeatEditError(`automation point time must be >= 0, got ${point.time}`)
  if (!Number.isFinite(point.value)) throw new BeatEditError(`automation point value must be a finite number, got ${point.value}`)
  checkInterpolation(point.interpolation)

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
  const interpolation = canonInterpolation(point.interpolation)
  const added: BeatAutomationPoint = { id, time: canon(point.time), value: canon(point.value), ...(interpolation ? { interpolation } : {}) }
  const nextLanes = lane
    ? clip.automation.map((l) => (l.param === param ? { ...l, points: [...l.points, added] } : l))
    : [...clip.automation, { param, points: [added] }]
  return { doc: replaceClip(doc, trackId, { ...clip, automation: nextLanes }), point: added }
}

/** Moves an existing automation point: updates its time, value, and/or curve-shape interpolation
 * (whichever is passed — an interpolation-only call, e.g. a hold/curve toggle with time/value
 * omitted, leaves the point's position untouched and just retargets which segment-shape it starts). */
export function moveAutomationPoint(
  doc: BeatDocument,
  trackId: string,
  clipId: string,
  param: string,
  pointId: string,
  changes: { time?: number; value?: number; interpolation?: AutomationInterpolation },
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
  checkInterpolation(changes.interpolation)
  const interpolation = canonInterpolation(changes.interpolation !== undefined ? changes.interpolation : existing.interpolation)
  const updated: BeatAutomationPoint = { id: pointId, time: canon(time), value: canon(value), ...(interpolation ? { interpolation } : {}) }
  const nextLanes = clip.automation.map((l) => (l.param === param ? { ...l, points: l.points.map((p) => (p.id === pointId ? updated : p)) } : l))
  return { doc: replaceClip(doc, trackId, { ...clip, automation: nextLanes }), point: updated }
}

/** Add-or-move in one call: if `point.id` already names a point in the lane, moves it; otherwise
 * adds a new point (minting an id if none was given). This is what `beat automate` / `beat_
 * automate` call — the CLI/MCP surface doesn't ask the caller to know in advance which case
 * they're in. Omitting `interpolation` on a move preserves the point's existing curve-shape (a
 * plain drag shouldn't silently reset it back to linear). */
export function setAutomationPoint(
  doc: BeatDocument,
  trackId: string,
  clipId: string,
  param: string,
  point: { time: number; value: number; id?: string; interpolation?: AutomationInterpolation },
): { doc: BeatDocument; point: BeatAutomationPoint; created: boolean } {
  const track = findTrack(doc, trackId)
  checkAutomatableParam(param, track.kind)
  const clip = findClip(track, clipId)
  const lane = clip.automation.find((l) => l.param === param)
  const existing = point.id !== undefined ? lane?.points.find((p) => p.id === point.id) : undefined
  if (existing) {
    const moved = moveAutomationPoint(doc, trackId, clipId, param, point.id!, { time: point.time, value: point.value, interpolation: point.interpolation })
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
 * region is replaced, the same re-snapshot ergonomics saveClip gives synth/drum tracks.
 *
 * Phase 31 Stream KA item 4 (docs/research/93): re-dropping a sample onto an audio track that
 * ALREADY has a clip (the upsert branch below) used to silently reset `warp`/`rate`/`gainDb` back
 * to hard defaults ('off'/1/0) whenever the caller — `ui/src/daemon/library.ts`'s installAudioClip
 * route, the only real caller that upserts an EXISTING clip id — didn't pass them, which it never
 * does (it only ever knows the new sample's media/in/out). Confirmed via `GET /document` before/
 * after: a carefully-set repitch rate got silently discarded on a plain re-drop, unrelated to which
 * sample was loaded. "Replace the clip's media on re-drop" is the documented, intentional one-
 * clip-per-track model (unchanged here) — but warp mode/rate/gain have nothing to do with WHICH
 * sample is loaded, so they shouldn't be collateral damage. When upserting, an omitted field now
 * defaults to the EXISTING clip's current value instead of a hard default; the trim (`in`/`out`)
 * still always comes from the caller — it's tied to the specific sample's length, so it can't
 * sensibly survive a media swap the way warp/rate/gain can. A brand-new clip (no existing region to
 * inherit from) is unaffected — omitted fields there still fall back to the same 'off'/1/0 defaults
 * as always. */
export function addAudioClip(
  doc: BeatDocument,
  trackId: string,
  clipId: string,
  region: { media: string; in: number; out: number; gainDb?: number; warp?: WarpMode; rate?: number },
): { doc: BeatDocument; clip: BeatClip } {
  const track = findTrack(doc, trackId)
  if (track.kind !== 'audio') throw new BeatEditError(`track "${trackId}" is a ${track.kind} track — audio-region clips only belong on audio tracks`)
  if (!/^[a-zA-Z0-9_-]+$/.test(clipId)) throw new BeatEditError(`clip ids are single alphanumeric/_/- tokens, got "${clipId}"`)
  const existing = track.clips.findIndex((c) => c.id === clipId)
  const existingAudio = existing === -1 ? undefined : track.clips[existing]!.audio
  const full: BeatAudioRegion = {
    media: region.media,
    in: canon(region.in),
    out: canon(region.out),
    gainDb: canon(region.gainDb ?? existingAudio?.gainDb ?? 0),
    warp: region.warp ?? existingAudio?.warp ?? 'off',
    rate: canon(region.rate ?? existingAudio?.rate ?? 1),
    markers: [],
  }
  validateAudioRegionFields(full, doc)
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
 * warp markers (not yet built, but automation already behaves this way today).
 *
 * v0.11 (Phase 36, D16 q3): AUTO-PLACES the second half at `placement.at + atSteps` in every
 * scene that placed the parent clip on this track — including each placement of a
 * multi-placement parent — so the split is genuinely lossless at the ARRANGEMENT level too, not
 * just the clip level (the "orphaned split output" gap pilots 85/99 both hit). Scenes that did
 * not place the parent are untouched. No new overlap is possible: the first half's timeline
 * length shrinks to exactly `atSteps`, so [at, at+atSteps) + [at+atSteps, at+originalLength)
 * tile the parent's original span exactly. The `placements` list in the return value reports
 * every auto-placement made (scene id + at), so the CLI/MCP surface (Phase 36 PB) can print
 * them. */
export function splitAudioClip(doc: BeatDocument, trackId: string, clipId: string, atSteps: number, opts: { newClipId?: string } = {}): { doc: BeatDocument; first: BeatClip; second: BeatClip; placements: { sceneId: string; clip: string; at: number }[] } {
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
  let next = replaceTrack(doc, { ...track, clips })

  // v0.11 (Phase 36, D16 q3): auto-place the second half after the first, in every scene that
  // placed the parent — one new placement per parent placement, at parent.at + atSteps.
  const placements: { sceneId: string; clip: string; at: number }[] = []
  next = {
    ...next,
    scenes: next.scenes.map((scene) => {
      const parentPlacements = (scene.slots[trackId] ?? []).filter((p) => p.clip === clipId)
      if (parentPlacements.length === 0) return scene // this scene never placed the parent — untouched
      const added = parentPlacements.map((p) => ({ clip: newId!, at: canon(p.at + atSteps) }))
      for (const p of added) placements.push({ sceneId: scene.id, clip: p.clip, at: p.at })
      return { ...scene, slots: { ...scene.slots, [trackId]: sortPlacements([...scene.slots[trackId]!, ...added]) } }
    }),
  }
  return { doc: next, first, second, placements }
}

/** Phase 32 Stream LA ("Duplicate" on an arrangement clip block, docs/research/81/87/92/93):
 * copies one clip on the SAME track under a fresh id — the single-clip counterpart to
 * saveClip/addAudioClip's "one clip per slot" discipline, letting a caller fork just THIS track's
 * clip into a genuinely independent copy without touching any other track. Deep-copies
 * notes/hits/automation/loop/signature/audio exactly as they stand right now (an exact snapshot —
 * same "copy, don't reference" stance as duplicateNotes above); the ORIGINAL clip, and every
 * scene/section that still references it, are completely untouched — this only appends a new clip
 * to the track's own clip list. `newClipId` uses the same auto-numbered `<id>-2`, `<id>-3`, ...
 * minting scheme as splitAudioClip's own default, unless the caller gives an explicit id. Works for
 * every track kind (synth/instrument/drums/audio) — whichever of notes/hits/audio the source clip
 * actually carries just comes along in the copy. */
export function duplicateClip(doc: BeatDocument, trackId: string, clipId: string, opts: { newClipId?: string } = {}): { doc: BeatDocument; clip: BeatClip } {
  const track = findTrack(doc, trackId)
  const source = findClip(track, clipId)
  let newId = opts.newClipId
  if (newId === undefined) {
    let n = 2
    while (track.clips.some((c) => c.id === `${clipId}-${n}`)) n++
    newId = `${clipId}-${n}`
  } else if (track.clips.some((c) => c.id === newId)) {
    throw new BeatEditError(`clip id "${newId}" already exists on track "${trackId}"`)
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(newId)) throw new BeatEditError(`clip ids are single alphanumeric/_/- tokens, got "${newId}"`)
  const clip: BeatClip = {
    id: newId,
    notes: source.notes.map((n) => ({ ...n })),
    hits: source.hits.map((h) => ({ ...h })),
    automation: source.automation.map((l) => ({ ...l, points: l.points.map((p) => ({ ...p })) })),
    loop: source.loop ? { ...source.loop } : null,
    signature: source.signature ? { ...source.signature } : null,
    ...(source.audio ? { audio: { ...source.audio, markers: source.audio.markers.map((m) => ({ ...m })) } } : {}),
  }
  return { doc: replaceTrack(doc, { ...track, clips: [...track.clips, clip] }), clip }
}
