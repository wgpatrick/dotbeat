import type { AutomationInterpolation, BeatAudioRegion, BeatAutomationLane, BeatAutomationPoint, BeatClip, BeatDocument, BeatDrumHit, BeatDrumLaneDecl, BeatDrumPattern, BeatEffect, BeatGroup, BeatInstrument, BeatMediaSample, BeatNote, BeatScene, BeatSongSection, BeatSynth, BeatTrack, DrumLane, DrumVoiceType, EffectType, OscType, SampleLaneFilterType, TrackKind, WarpMode } from './document.js'
import { AUDIO_AUTOMATABLE_PARAMS, AUDIO_RATE_MAX, AUDIO_RATE_MIN, AUTOMATABLE_SYNTH_PARAMS, AUTOMATION_INTERPOLATIONS, AUTOMATION_POINT_FIELD_DEFAULTS, DRUM_LANES, DRUM_VOICE_TYPES, EFFECT_TYPES, INIT_SYNTH, INSTRUMENT_EFFECT_FIELD_KEYS, NOTE_FIELD_DEFAULTS, OSC_TYPES, SAMPLE_LANE_PARAM_DEFAULTS, SYNTH_FIELD_BY_KEY, SYNTH_PARAM_ORDER, TIME_SIG_DENOMINATORS, TRACK_KINDS, WARP_MODES, declaredLaneNames, defaultEffectChain, defaultSynthFields, isSampleLaneFilterType, isSampleLaneParamKey } from './document.js'

export class BeatParseError extends Error {
  line: number
  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`)
    this.name = 'BeatParseError'
    this.line = line
  }
}

function indentOf(raw: string): number {
  let n = 0
  while (raw[n] === ' ') n++
  return n
}

function isOscType(s: string): s is OscType {
  return (OSC_TYPES as readonly string[]).includes(s)
}

function isTrackKind(s: string): s is TrackKind {
  return (TRACK_KINDS as readonly string[]).includes(s)
}

function isDrumLane(s: string): s is DrumLane {
  return (DRUM_LANES as readonly string[]).includes(s)
}

function isEffectType(s: string): s is EffectType {
  return (EFFECT_TYPES as readonly string[]).includes(s)
}

function isDrumVoiceType(s: string): s is DrumVoiceType {
  return (DRUM_VOICE_TYPES as readonly string[]).includes(s)
}

function isWarpMode(s: string): s is WarpMode {
  return (WARP_MODES as readonly string[]).includes(s)
}

function isAutomationInterpolation(s: string): s is AutomationInterpolation {
  return (AUTOMATION_INTERPOLATIONS as readonly string[]).includes(s)
}

function parseFloatStrict(tok: string, lineNo: number, field: string): number {
  const n = Number(tok)
  if (tok.trim() === '' || !Number.isFinite(n)) throw new BeatParseError(`"${field}" expected a number, got "${tok}"`, lineNo)
  return n
}

function parseIntStrict(tok: string, lineNo: number, field: string): number {
  if (!/^-?\d+$/.test(tok)) throw new BeatParseError(`"${field}" expected an integer, got "${tok}"`, lineNo)
  return Number(tok)
}

const SLUG_RE = /^[a-zA-Z0-9_-]+$/

// Parses .beat v0 text into a BeatDocument. Strict on purpose (every synth param required, no
// silently-applied defaults, unknown keywords/wrong arities are errors) — see format-spec.md for
// why: a hand-edited or agent-edited file that's missing a field should fail loudly, not produce
// a document that silently differs from what was written.
export function parse(text: string): BeatDocument {
  const rawLines = text.split('\n')

  let formatVersion: string | null = null
  let bpm: number | null = null
  let loopBars: number | null = null
  let selectedTrack: string | null = null
  const tracks: BeatTrack[] = []
  const trackIds = new Set<string>()
  const scenes: BeatScene[] = []
  const sceneIds = new Set<string>()
  let song: BeatSongSection[] | null = null
  const media: BeatMediaSample[] = []
  const mediaIds = new Set<string>()
  let inMedia = false
  // v0.10 track groups: parsed after all tracks (canonical order), before scene/song blocks.
  const groups: BeatGroup[] = []
  const groupIds = new Set<string>()
  const groupedTrackIds = new Set<string>() // a track belongs to at most one group

  let currentTrack: BeatTrack | null = null
  let currentClip: BeatClip | null = null
  let currentScene: BeatScene | null = null
  let inSynth = false
  let inSong = false
  let synthSeen = new Set<keyof BeatSynth>()
  // v0.9: the currently-open `auto <track>.<param>` lane within a clip, if any — `point` lines
  // (level 3) append to it until the next level <= 2 line closes it.
  let currentAutoLane: BeatAutomationLane | null = null
  // v0.8 migration: legacy `pattern` lines accumulate here per track/clip, then expand to hits
  // at close (grammar-level patterns are gone; v<=0.7 files still parse into the new event model).
  const legacyTrackPatterns = new Map<BeatTrack, Partial<BeatDrumPattern>>()
  const legacyClipPatterns = new Map<BeatClip, Partial<BeatDrumPattern>>()
  // v0.10 migration: a synth track with NO explicit `effect`/`effects` line gets the canonical
  // default chain at close (see defaultEffectChain) — this is what makes every pre-v0.10 file (and
  // any hand-written file that never mentions effects) parse into exactly the old hardcoded
  // EQ3->comp->distortion->bitcrush order, losslessly. `effectsNoneSeen` distinguishes an
  // explicit `effects none` (stay empty) from "never declared" (apply the default).
  const effectsSeen = new Set<BeatTrack>()
  const effectsNoneSeen = new Set<BeatTrack>()
  // Phase 26 Stream DC: an instrument track's bare effect-param field lines (e.g. `distortionMix
  // 0.4`) — the same ad hoc "field line directly under the track, no `synth` wrapper" shape
  // volume/pan already use for instrument tracks, widened to the 12 EffectType chain members'
  // own params (INSTRUMENT_EFFECT_FIELD_KEYS) so the reorderable effects chain Stream DC gives
  // instrument tracks has real, persisted knobs behind it. Tracked per-track (like synthSeen) to
  // reject duplicate lines the same way a duplicate `synth` param line is rejected.
  const instrumentFieldsSeen = new Map<BeatTrack, Set<string>>()

  // v0.9: closes any open automation lane, validating it has >= 1 point (a lane with zero
  // points has no canonical serialized form — see BeatAutomationLane) and unique point ids.
  function closeAutoLaneIfOpen(lineNo: number) {
    if (!currentAutoLane) return
    const lane = currentAutoLane
    if (lane.points.length === 0) throw new BeatParseError(`automation lane "${lane.param}" has no point lines`, lineNo)
    const seen = new Set<string>()
    for (const p of lane.points) {
      if (seen.has(p.id)) throw new BeatParseError(`duplicate automation point id "${p.id}" in lane "${lane.param}"`, lineNo)
      seen.add(p.id)
    }
    currentAutoLane = null
  }

  function closeSynthIfOpen(lineNo: number) {
    if (!inSynth) return
    const missing = SYNTH_PARAM_ORDER.filter((k) => !synthSeen.has(k))
    if (missing.length) throw new BeatParseError(`synth block is missing required param(s): ${missing.join(', ')}`, lineNo)
    inSynth = false
  }

  // A drum pattern (track-level or clip-level) must arrive complete: all five lanes, equal step
  // counts — the same fail-loudly stance the synth block takes.
  function checkDrumPattern(pattern: Partial<BeatDrumPattern> | undefined, what: string, lineNo: number) {
    const p = pattern ?? {}
    const missing = DRUM_LANES.filter((lane) => !(lane in p))
    if (missing.length) throw new BeatParseError(`${what} is missing pattern lane(s): ${missing.join(', ')}`, lineNo)
    const lengths = new Set(DRUM_LANES.map((lane) => p[lane]!.length))
    if (lengths.size > 1) throw new BeatParseError(`${what} has pattern lanes of unequal length`, lineNo)
  }

  function closeClipIfOpen(lineNo: number) {
    closeAutoLaneIfOpen(lineNo)
    if (!currentClip || !currentTrack) return
    const legacy = legacyClipPatterns.get(currentClip)
    if (legacy) {
      // legacy pattern lines must be complete (all five lanes, equal length) to migrate cleanly
      checkDrumPattern(legacy, `clip "${currentClip.id}" in drum track "${currentTrack.id}"`, lineNo)
      const cycle = legacy[DRUM_LANES[0]]!.length // clips are one cycle (a bar); tile over itself
      currentClip.hits.push(...expandPattern(legacy, cycle))
      legacyClipPatterns.delete(currentClip)
    }
    if (currentTrack.kind === 'drums') assertUniqueHitIds(currentClip.hits, `clip "${currentClip.id}"`, lineNo)
    // Phase 22 Stream AE: an audio-track clip with no `audio` line is meaningless (an empty
    // region) — same fail-loudly stance as an instrument track missing its soundfont line.
    if (currentTrack.kind === 'audio' && !currentClip.audio) throw new BeatParseError(`clip "${currentClip.id}" on audio track "${currentTrack.id}" has no audio line`, lineNo)
    currentClip = null
  }

  function closeTrackIfOpen(lineNo: number) {
    closeClipIfOpen(lineNo)
    if (!currentTrack) return
    const legacy = legacyTrackPatterns.get(currentTrack)
    if (legacy) {
      checkDrumPattern(legacy, `drum track "${currentTrack.id}"`, lineNo)
      // a live pattern played every bar; tile across the whole loop (loopBars * 16 steps)
      currentTrack.hits.push(...expandPattern(legacy, (loopBars ?? 1) * 16))
      legacyTrackPatterns.delete(currentTrack)
    }
    if (currentTrack.kind === 'drums') assertUniqueHitIds(currentTrack.hits, `drum track "${currentTrack.id}"`, lineNo)
    if (currentTrack.kind === 'instrument' && !currentTrack.instrument) {
      throw new BeatParseError(`instrument track "${currentTrack.id}" is missing its soundfont line`, lineNo)
    }
    // v0.10: no explicit effect declaration at all -> the canonical default chain (see above).
    // Phase 26 Stream DC: drum tracks migrate to the SAME default (eq3->comp->distortion->
    // bitcrush, all enabled) — this is what makes a pre-Stream-DC file's drum bus (previously a
    // fixed, non-reorderable insert order at these same params' default values) sound byte-for-
    // byte identical after the fold-in; only a track that explicitly declares `effect`/`effects`
    // lines (or `effects none`) departs from it. Instrument tracks are NOT included here — they
    // never had a chain before, so the correct migration target is [], not a chain built for a
    // fixed insert order they never actually had.
    if ((currentTrack.kind === 'synth' || currentTrack.kind === 'drums') && !effectsSeen.has(currentTrack)) {
      currentTrack.effects = defaultEffectChain()
    }
  }

  // v0.10: trailing `key=value` tokens carry the optional per-note fields (chance/cent/ratchet*)
  // — canonical elision at note-line granularity (see NOTE_FIELD_DEFAULTS). Accepted in ANY order
  // on parse (a hand edit shouldn't have to remember the canonical order), but always re-emitted
  // in canonical order on serialize — same "liberal in, strict out" discipline the rest of the
  // grammar uses for e.g. clip content.
  function parseNoteOptionalFields(tokens: string[], lineNo: number): Pick<BeatNote, 'chance' | 'cent' | 'ratchetCount' | 'ratchetCurve' | 'ratchetLength'> {
    const out: Pick<BeatNote, 'chance' | 'cent' | 'ratchetCount' | 'ratchetCurve' | 'ratchetLength'> = { ...NOTE_FIELD_DEFAULTS }
    const seen = new Set<string>()
    for (const tok of tokens) {
      const eq = tok.indexOf('=')
      if (eq === -1) throw new BeatParseError(`note field must be key=value, got "${tok}"`, lineNo)
      const key = tok.slice(0, eq)
      const valTok = tok.slice(eq + 1)
      if (seen.has(key)) throw new BeatParseError(`duplicate note field "${key}"`, lineNo)
      seen.add(key)
      switch (key) {
        case 'chance': {
          const v = parseIntStrict(valTok, lineNo, 'note chance')
          if (v < 0 || v > 100) throw new BeatParseError(`note chance must be 0-100, got ${v}`, lineNo)
          out.chance = v
          break
        }
        case 'cent': {
          const v = parseFloatStrict(valTok, lineNo, 'note cent')
          if (v < -50 || v > 50) throw new BeatParseError(`note cent must be -50..50, got ${v}`, lineNo)
          out.cent = v
          break
        }
        case 'ratchetCount': {
          const v = parseIntStrict(valTok, lineNo, 'note ratchetCount')
          if (v < 1 || v > 16) throw new BeatParseError(`note ratchetCount must be 1-16, got ${v}`, lineNo)
          out.ratchetCount = v
          break
        }
        case 'ratchetCurve': {
          const v = parseFloatStrict(valTok, lineNo, 'note ratchetCurve')
          if (v < -1 || v > 1) throw new BeatParseError(`note ratchetCurve must be -1..1, got ${v}`, lineNo)
          out.ratchetCurve = v
          break
        }
        case 'ratchetLength': {
          const v = parseFloatStrict(valTok, lineNo, 'note ratchetLength')
          if (v <= 0 || v > 1) throw new BeatParseError(`note ratchetLength must be >0..1, got ${v}`, lineNo)
          out.ratchetLength = v
          break
        }
        default:
          throw new BeatParseError(`unknown note field "${key}" (expected chance, cent, ratchetCount, ratchetCurve, ratchetLength)`, lineNo)
      }
    }
    return out
  }

  function parseNoteLine(tokens: string[], lineNo: number): BeatNote {
    if (tokens.length < 6) throw new BeatParseError('note expects at least 5 values: <id> <pitch> <start> <duration> <velocity> [chance=N] [cent=N] [ratchetCount=N] [ratchetCurve=N] [ratchetLength=N]', lineNo)
    const [, id, pitchTok, startTok, durTok, velTok] = tokens as [string, string, string, string, string, string]
    const pitch = parseIntStrict(pitchTok, lineNo, 'note pitch')
    if (pitch < 0 || pitch > 127) throw new BeatParseError(`note pitch must be 0-127, got ${pitch}`, lineNo)
    // v0.7: start/duration accept decimals (fractional steps) — live/tapped input lands
    // between grid lines. Non-canonical spellings ("0.50") parse fine and re-serialize
    // canonically ("0.5"); see format.ts.
    const start = parseFloatStrict(startTok, lineNo, 'note start')
    if (start < 0) throw new BeatParseError(`note start must be >= 0, got ${start}`, lineNo)
    const duration = parseFloatStrict(durTok, lineNo, 'note duration')
    if (duration <= 0) throw new BeatParseError(`note duration must be > 0 steps, got ${duration}`, lineNo)
    const velocity = parseFloatStrict(velTok, lineNo, 'note velocity')
    const optional = parseNoteOptionalFields(tokens.slice(6), lineNo)
    return { id, pitch, start, duration, velocity, ...optional }
  }

  function parsePatternLine(tokens: string[], existing: Partial<BeatDrumPattern> | undefined, lineNo: number): { lane: DrumLane; steps: number[] } {
    if (tokens.length < 3) throw new BeatParseError('pattern expects a lane name and at least 1 step velocity', lineNo)
    const lane = tokens[1]!
    if (!isDrumLane(lane)) throw new BeatParseError(`unknown drum lane "${lane}" (expected one of ${DRUM_LANES.join('|')})`, lineNo)
    if (existing?.[lane]) throw new BeatParseError(`duplicate pattern lane "${lane}"`, lineNo)
    const steps = tokens.slice(2).map((tok) => {
      const v = parseFloatStrict(tok, lineNo, `pattern ${lane} step`)
      if (v < 0 || v > 1) throw new BeatParseError(`pattern step velocities must be 0..1, got ${v}`, lineNo)
      return v
    })
    return { lane, steps }
  }

  // v0.8: a free-timed drum hit — `hit <id> <lane> <start> <velocity>`. start is fractional
  // steps (v0.7 number rules), absolute over the loop. Phase 22 Stream AB (research 20 Part 7)
  // appends an OPTIONAL trailing `duration` — 5 tokens (no duration) parses exactly as before
  // (byte-identical for every pre-existing file); 6 tokens gates the voice for that many steps.
  // `laneNames` is the enclosing track's declared lane set (declaredLaneNames) — validated here
  // so an undeclared lane fails loudly at parse time, not silently at playback.
  function parseHitLine(tokens: string[], laneNames: readonly string[], lineNo: number): BeatDrumHit {
    if (tokens.length !== 5 && tokens.length !== 6) throw new BeatParseError('hit expects 4 or 5 values: <id> <lane> <start> <velocity> [<duration>]', lineNo)
    const [, id, laneTok, startTok, velTok, durTok] = tokens as [string, string, string, string, string, string?]
    if (!SLUG_RE.test(id)) throw new BeatParseError(`hit ids are single alphanumeric/_/- tokens, got "${id}"`, lineNo)
    if (!laneNames.includes(laneTok)) throw new BeatParseError(`unknown drum lane "${laneTok}" (expected one of ${laneNames.join('|')} — declare it with a "lane" line first)`, lineNo)
    const start = parseFloatStrict(startTok, lineNo, 'hit start')
    if (start < 0) throw new BeatParseError(`hit start must be >= 0, got ${start}`, lineNo)
    const velocity = parseFloatStrict(velTok, lineNo, 'hit velocity')
    if (velocity <= 0 || velocity > 1) throw new BeatParseError(`hit velocity must be in (0, 1], got ${velocity}`, lineNo)
    const hit: BeatDrumHit = { id, lane: laneTok, start, velocity }
    if (durTok !== undefined) {
      const duration = parseFloatStrict(durTok, lineNo, 'hit duration')
      if (duration <= 0) throw new BeatParseError(`hit duration must be > 0 steps, got ${duration}`, lineNo)
      hit.duration = duration
    }
    return hit
  }

  // Phase 26 Stream DK: parses a sample-backed lane's OPTIONAL trailing tokens — the lean drum-
  // sampler surface (Start/Length trim, AHD envelope, one filter, a short playback-effect list)
  // layered onto the existing `sample <id> <gainDb> <tune>` line as extra `key=value` tokens (same
  // style as a synth-backed lane's own param tokens), plus two non-numeric special tokens:
  // `filter=<lowpass|bandpass|highpass>` and `fx=<type>[,<type>...]` (ordered, comma-joined
  // EffectType list — reuses BeatEffect/EFFECT_TYPES wholesale, id defaults to type like
  // defaultEffectChain()'s own convention). Absent = every field at its documented default (see
  // SAMPLE_LANE_PARAM_DEFAULTS/'lowpass'/[]) — a pre-Stream-DK 4-token line parses identically.
  function parseSampleLaneExtras(name: string, tokens: string[], lineNo: number): { params: Record<string, number>; filterType: SampleLaneFilterType; effects: BeatEffect[] } {
    const params: Record<string, number> = {}
    let filterType: SampleLaneFilterType = 'lowpass'
    let effects: BeatEffect[] = []
    for (const kv of tokens) {
      const eq = kv.indexOf('=')
      if (eq === -1) throw new BeatParseError(`lane "${name}" sample extra must be "key=value", got "${kv}"`, lineNo)
      const key = kv.slice(0, eq)
      const raw = kv.slice(eq + 1)
      if (key === 'filter') {
        if (!isSampleLaneFilterType(raw)) throw new BeatParseError(`lane "${name}": filter must be one of lowpass|bandpass|highpass, got "${raw}"`, lineNo)
        filterType = raw
      } else if (key === 'fx') {
        const types = raw.split(',').filter((t) => t.length > 0)
        for (const t of types) {
          if (!(EFFECT_TYPES as readonly string[]).includes(t)) throw new BeatParseError(`lane "${name}": unknown effect type "${t}" in fx list (expected one of ${EFFECT_TYPES.join('|')})`, lineNo)
        }
        effects = types.map((t) => ({ id: t, type: t as EffectType, enabled: true }))
      } else if (isSampleLaneParamKey(key)) {
        params[key] = parseFloatStrict(raw, lineNo, `lane ${name} ${key}`)
      } else {
        throw new BeatParseError(`lane "${name}": unknown sample lane field "${key}" (expected filter|fx|${Object.keys(SAMPLE_LANE_PARAM_DEFAULTS).join('|')})`, lineNo)
      }
    }
    return { params, filterType, effects }
  }

  // Phase 22 Stream AB: parses one of the three NEW `lane` declaration forms (synth:/sample/sf),
  // pushing onto `track.lanes` in declaration order. Returns false (no-op) if the line doesn't
  // match any new form, so the caller falls through to the legacy 5-token `lane <lane> <sample-id>
  // <gain> <tune>` handling (unchanged — see below), which is what keeps every pre-existing v0.5+
  // file parsing byte-identically: the new forms are additive, never required.
  function tryParseLaneDecl(tokens: string[], track: BeatTrack, lineNo: number): boolean {
    if (tokens.length < 3) return false
    const name = tokens[1]!
    const sel = tokens[2]!
    let backing: BeatDrumLaneDecl['backing'] | null = null
    if (sel.startsWith('synth:')) {
      const voice = sel.slice('synth:'.length)
      if (!isDrumVoiceType(voice)) throw new BeatParseError(`unknown drum voice type "${voice}" (expected one of ${DRUM_VOICE_TYPES.join('|')})`, lineNo)
      const params: Record<string, number> = {}
      for (const kv of tokens.slice(3)) {
        const eq = kv.indexOf('=')
        if (eq === -1) throw new BeatParseError(`lane synth param must be "key=value", got "${kv}"`, lineNo)
        const key = kv.slice(0, eq)
        params[key] = parseFloatStrict(kv.slice(eq + 1), lineNo, `lane ${name} ${key}`)
      }
      backing = { type: 'synth', voice, params }
    } else if (sel === 'sample') {
      if (tokens.length < 6) throw new BeatParseError('lane sample expects at least 4 values: <name> sample <sample-id> <gain dB> <tune semitones> [key=value ...]', lineNo)
      const gainDb = parseFloatStrict(tokens[4]!, lineNo, 'lane gain')
      const tune = parseFloatStrict(tokens[5]!, lineNo, 'lane tune')
      backing = { type: 'sample', sample: tokens[3]!, gainDb, tune, ...parseSampleLaneExtras(name, tokens.slice(6), lineNo) }
    } else if (sel === 'sf') {
      if (tokens.length !== 6) throw new BeatParseError('lane sf expects exactly 4 values: <name> sf <sample-id> <program> <note>', lineNo)
      const program = parseIntStrict(tokens[4]!, lineNo, 'lane sf program')
      const note = parseIntStrict(tokens[5]!, lineNo, 'lane sf note')
      if (program < 0 || program > 127) throw new BeatParseError(`lane sf program must be 0-127, got ${program}`, lineNo)
      if (note < 0 || note > 127) throw new BeatParseError(`lane sf note must be 0-127, got ${note}`, lineNo)
      backing = { type: 'sf', sample: tokens[3]!, program, note }
    }
    if (!backing) return false
    if (track.lanes.some((l) => l.name === name)) throw new BeatParseError(`duplicate lane declaration "${name}"`, lineNo)
    track.lanes.push({ name, backing })
    return true
  }

  // Phase 22 Stream AE: `audio <media-id> <in> <out> <gain dB> <warp> <rate>` — the entire
  // content of one audio-region clip, one bundled event per line (note/hit-style, no per-field
  // elision — see BeatAudioRegion's doc comment). `in`/`out` are seconds into the SOURCE media
  // (not timeline steps); `rate` must be exactly 1 when `warp` isn't 'repitch' — one canonical
  // form per state (D4), so a hand-edited "off 1.5" is rejected rather than silently accepted as
  // a second spelling of "off 1".
  function parseAudioLine(tokens: string[], lineNo: number): BeatAudioRegion {
    if (tokens.length !== 7) throw new BeatParseError('audio expects exactly 6 values: <media-id> <in> <out> <gain dB> <warp> <rate>', lineNo)
    const [, media, inTok, outTok, gainTok, warpTok, rateTok] = tokens as [string, string, string, string, string, string, string]
    const inPoint = parseFloatStrict(inTok, lineNo, 'audio in')
    if (inPoint < 0) throw new BeatParseError(`audio in-point must be >= 0, got ${inPoint}`, lineNo)
    const outPoint = parseFloatStrict(outTok, lineNo, 'audio out')
    if (outPoint <= inPoint) throw new BeatParseError(`audio out-point must be > in-point, got in=${inPoint} out=${outPoint}`, lineNo)
    const gainDb = parseFloatStrict(gainTok, lineNo, 'audio gain')
    if (!isWarpMode(warpTok)) throw new BeatParseError(`audio warp must be one of ${WARP_MODES.join('|')}, got "${warpTok}"`, lineNo)
    const rate = parseFloatStrict(rateTok, lineNo, 'audio rate')
    if (rate < AUDIO_RATE_MIN || rate > AUDIO_RATE_MAX) throw new BeatParseError(`audio rate must be ${AUDIO_RATE_MIN}-${AUDIO_RATE_MAX}, got ${rate}`, lineNo)
    if (warpTok !== 'repitch' && rate !== 1) throw new BeatParseError(`audio rate must be 1 when warp is "${warpTok}" (rate only applies to warp=repitch), got ${rate}`, lineNo)
    return { media, in: inPoint, out: outPoint, gainDb, warp: warpTok, rate, markers: [] }
  }

  // Phase 26 Stream DI: trailing `key=value` tokens carry the one optional per-point field
  // (interpolation) — same "liberal in, strict out" discipline as parseNoteOptionalFields above.
  // An explicit "interpolation=linear" (the canonical default) parses fine but is intentionally
  // NOT retained on the returned point — one canonical form per state (D4): a redundant default
  // token silently canonicalizes away on the next serialize, same as note fields' own defaults.
  function parsePointOptionalFields(tokens: string[], lineNo: number): Pick<BeatAutomationPoint, 'interpolation'> {
    const out: Pick<BeatAutomationPoint, 'interpolation'> = {}
    const seen = new Set<string>()
    for (const tok of tokens) {
      const eq = tok.indexOf('=')
      if (eq === -1) throw new BeatParseError(`point field must be key=value, got "${tok}"`, lineNo)
      const key = tok.slice(0, eq)
      const valTok = tok.slice(eq + 1)
      if (seen.has(key)) throw new BeatParseError(`duplicate point field "${key}"`, lineNo)
      seen.add(key)
      switch (key) {
        case 'interpolation': {
          if (!isAutomationInterpolation(valTok)) throw new BeatParseError(`point interpolation must be one of ${AUTOMATION_INTERPOLATIONS.join('|')}, got "${valTok}"`, lineNo)
          if (valTok !== AUTOMATION_POINT_FIELD_DEFAULTS.interpolation) out.interpolation = valTok
          break
        }
        default:
          throw new BeatParseError(`unknown point field "${key}" (expected interpolation)`, lineNo)
      }
    }
    return out
  }

  // v0.9: `point <id> <time> <value>` — one automation point inside an open `auto` lane. time
  // is fractional 16th steps from the clip's start (v0.7 number rules); value is unconstrained
  // (its legal range depends on which param the enclosing lane targets). Phase 26 Stream DI
  // appends an OPTIONAL trailing `interpolation=linear|hold|curve` token (4 tokens parses exactly
  // as before — byte-identical for every pre-existing file).
  function parsePointLine(tokens: string[], lineNo: number): BeatAutomationPoint {
    if (tokens.length < 4) throw new BeatParseError('point expects at least 3 values: <id> <time> <value> [interpolation=linear|hold|curve]', lineNo)
    const [, id, timeTok, valueTok] = tokens as [string, string, string, string]
    if (!SLUG_RE.test(id)) throw new BeatParseError(`point ids are single alphanumeric/_/- tokens, got "${id}"`, lineNo)
    const time = parseFloatStrict(timeTok, lineNo, 'point time')
    if (time < 0) throw new BeatParseError(`point time must be >= 0, got ${time}`, lineNo)
    const value = parseFloatStrict(valueTok, lineNo, 'point value')
    const optional = parsePointOptionalFields(tokens.slice(4), lineNo)
    return { id, time, value, ...optional }
  }

  // v0.8 migration: expand a legacy per-bar pattern into absolute hits. A step at velocity v
  // becomes a hit at that step; the 16-step cycle is tiled across `totalSteps` (loopBars*16 for
  // a live track — the pattern played every bar; the pattern's own length for a clip). Ids are
  // deterministic `<lane><step>` so re-parsing a migrated file is stable. See research 12.
  function expandPattern(pattern: Partial<BeatDrumPattern>, totalSteps: number): BeatDrumHit[] {
    const hits: BeatDrumHit[] = []
    for (const lane of DRUM_LANES) {
      const steps = pattern[lane]
      if (!steps || steps.length === 0) continue
      for (let k = 0; k < totalSteps; k++) {
        const v = steps[k % steps.length]!
        if (v > 0) hits.push({ id: `${lane}${k}`, lane, start: k, velocity: v })
      }
    }
    return hits
  }

  function assertUniqueHitIds(hits: BeatDrumHit[], what: string, lineNo: number) {
    const seen = new Set<string>()
    for (const h of hits) {
      if (seen.has(h.id)) throw new BeatParseError(`duplicate hit id "${h.id}" in ${what}`, lineNo)
      seen.add(h.id)
    }
  }

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1
    const raw = (rawLines[i] ?? '').replace(/\r$/, '')
    if (raw.trim().length === 0) continue
    const trimmedStart = raw.trimStart()
    if (trimmedStart.startsWith('#')) continue // full-line comment only — see format-spec.md

    const indentChars = indentOf(raw)
    if (indentChars % 2 !== 0) throw new BeatParseError(`indentation must be a multiple of 2 spaces, got ${indentChars}`, lineNo)
    const level = indentChars / 2
    const tokens = trimmedStart.trim().split(/\s+/)
    const keyword = tokens[0]! // tokens is split from a non-empty trimmed string, so always >= 1 element

    if (level === 0) {
      closeSynthIfOpen(lineNo)
      if (keyword === 'format_version') {
        if (tokens.length !== 2) throw new BeatParseError('format_version expects exactly 1 value', lineNo)
        formatVersion = tokens[1]!
      } else if (keyword === 'bpm') {
        if (tokens.length !== 2) throw new BeatParseError('bpm expects exactly 1 value', lineNo)
        bpm = parseIntStrict(tokens[1]!, lineNo, 'bpm')
      } else if (keyword === 'loop_bars') {
        if (tokens.length !== 2) throw new BeatParseError('loop_bars expects exactly 1 value', lineNo)
        loopBars = parseIntStrict(tokens[1]!, lineNo, 'loop_bars')
      } else if (keyword === 'selected_track') {
        if (tokens.length !== 2) throw new BeatParseError('selected_track expects exactly 1 value', lineNo)
        selectedTrack = tokens[1]!
      } else if (keyword === 'media') {
        if (tracks.length > 0 || scenes.length > 0 || song !== null) throw new BeatParseError('the media block must come before track/scene/song blocks (canonical order)', lineNo)
        if (tokens.length !== 1) throw new BeatParseError('media takes no values on its own line', lineNo)
        if (inMedia || media.length > 0) throw new BeatParseError('duplicate media block', lineNo)
        inMedia = true
      } else if (keyword === 'track') {
        inMedia = false
        if (groups.length > 0 || scenes.length > 0 || song !== null) throw new BeatParseError('track blocks must come before group/scene/song blocks (canonical order)', lineNo)
        closeTrackIfOpen(lineNo)
        if (tokens.length !== 5) throw new BeatParseError('track expects exactly 4 values: <id> <name> <color> <kind>', lineNo)
        const [, id, name, color, kind] = tokens as [string, string, string, string, string]
        if (trackIds.has(id)) throw new BeatParseError(`duplicate track id "${id}"`, lineNo)
        if (!/^#[0-9a-f]{6}$/.test(color)) throw new BeatParseError(`track color must be a lowercase hex color like #c678dd, got "${color}"`, lineNo)
        if (!isTrackKind(kind)) throw new BeatParseError(`track kind must be one of ${TRACK_KINDS.join('|')}, got "${kind}"`, lineNo)
        trackIds.add(id)
        currentTrack = {
          id,
          name,
          color,
          kind,
          // core 9 are placeholders until the synth block fills them (all required); the v0.3
          // optional fields start at their canonical defaults (elision contract). Instrument and
          // audio tracks never serialize a synth block — they carry the canonical INIT copy so
          // parse(serialize(x)) deep-equals documents built via addTrack.
          synth: kind === 'instrument' || kind === 'audio'
            ? { ...INIT_SYNTH }
            : ({ osc: 'sawtooth', volume: 0, cutoff: 0, resonance: 0, attack: 0, decay: 0, sustain: 0, release: 0, pan: 0, ...defaultSynthFields() } as BeatSynth),
          laneSamples: {},
          lanes: [],
          clips: [],
          notes: [],
          hits: [],
          // v0.10: filled with the default chain at track-close if no explicit effect/effects
          // line was seen (migration); stays [] as-is for drum/instrument tracks.
          effects: [],
          // v0.10 groove/shuffle: canonical default is "off" (0 amount, neutral 1-step grid) until
          // an optional `groove` line (below) overrides it.
          shuffleAmount: 0,
          shuffleGrid: 1,
        }
        tracks.push(currentTrack)
      } else if (keyword === 'group') {
        closeTrackIfOpen(lineNo)
        currentTrack = null
        if (scenes.length > 0 || song !== null) throw new BeatParseError('group blocks must come before scene/song blocks (canonical order)', lineNo)
        if (tokens.length < 5) throw new BeatParseError('group expects at least 4 values: <id> <name> <color> <track-id> [<track-id> ...]', lineNo)
        const [, id, name, color] = tokens as [string, string, string, string, string]
        if (!SLUG_RE.test(id)) throw new BeatParseError(`group ids are single alphanumeric/_/- tokens, got "${id}"`, lineNo)
        if (groupIds.has(id)) throw new BeatParseError(`duplicate group id "${id}"`, lineNo)
        if (!/^#[0-9a-f]{6}$/.test(color)) throw new BeatParseError(`group color must be a lowercase hex color like #c678dd, got "${color}"`, lineNo)
        const memberIds = tokens.slice(4)
        const seenHere = new Set<string>()
        for (const tid of memberIds) {
          if (!trackIds.has(tid)) throw new BeatParseError(`group "${id}": unknown track "${tid}" (have: ${[...trackIds].join(', ')})`, lineNo)
          if (seenHere.has(tid)) throw new BeatParseError(`group "${id}": track "${tid}" listed twice`, lineNo)
          seenHere.add(tid)
          if (groupedTrackIds.has(tid)) throw new BeatParseError(`track "${tid}" is in more than one group — a track belongs to at most one group`, lineNo)
          groupedTrackIds.add(tid)
        }
        groupIds.add(id)
        groups.push({ id, name, color, tracks: memberIds })
        continue
      } else if (keyword === 'scene') {
        closeTrackIfOpen(lineNo)
        currentTrack = null
        if (inSong || song !== null) throw new BeatParseError('scene blocks must come before the song block (canonical order)', lineNo)
        if (tokens.length !== 2) throw new BeatParseError('scene expects exactly 1 value: <id>', lineNo)
        const id = tokens[1]!
        if (!SLUG_RE.test(id)) throw new BeatParseError(`scene ids are single alphanumeric/_/- tokens, got "${id}"`, lineNo)
        if (sceneIds.has(id)) throw new BeatParseError(`duplicate scene id "${id}"`, lineNo)
        sceneIds.add(id)
        currentScene = { id, slots: {} }
        scenes.push(currentScene)
      } else if (keyword === 'song') {
        closeTrackIfOpen(lineNo)
        currentTrack = null
        currentScene = null
        if (song !== null) throw new BeatParseError('duplicate song block', lineNo)
        if (tokens.length !== 1) throw new BeatParseError('song takes no values on its own line', lineNo)
        song = []
        inSong = true
      } else {
        throw new BeatParseError(`unexpected top-level keyword "${keyword}"`, lineNo)
      }
      continue
    }

    if (level === 1) {
      if (inMedia && keyword === 'sample') {
        if (tokens.length !== 4) throw new BeatParseError('sample expects exactly 3 values: <id> sha256:<hex> <path>', lineNo)
        const [, id, hashTok, path] = tokens as [string, string, string, string]
        if (!SLUG_RE.test(id)) throw new BeatParseError(`sample ids are single alphanumeric/_/- tokens, got "${id}"`, lineNo)
        if (mediaIds.has(id)) throw new BeatParseError(`duplicate sample id "${id}"`, lineNo)
        const m = hashTok.match(/^sha256:([0-9a-f]{64})$/)
        if (!m) throw new BeatParseError(`sample hash must be sha256:<64 lowercase hex chars>, got "${hashTok}"`, lineNo)
        if (path.startsWith('/') || path.includes('..')) throw new BeatParseError(`sample paths must be relative without "..", got "${path}"`, lineNo)
        mediaIds.add(id)
        media.push({ id, sha256: m[1]!, path })
        continue
      }
      // scene and song sub-lines
      if (currentScene && keyword === 'slot') {
        if (tokens.length !== 3) throw new BeatParseError('slot expects exactly 2 values: <track> <clip>', lineNo)
        const [, trackId, clipId] = tokens as [string, string, string]
        if (trackId in currentScene.slots) throw new BeatParseError(`scene "${currentScene.id}" already has a slot for track "${trackId}"`, lineNo)
        currentScene.slots[trackId] = clipId
        continue
      }
      if (inSong && keyword === 'section') {
        if (tokens.length !== 3) throw new BeatParseError('section expects exactly 2 values: <scene> <bars>', lineNo)
        const [, sceneId, barsTok] = tokens as [string, string, string]
        const bars = parseIntStrict(barsTok, lineNo, 'section bars')
        if (bars < 1 || bars > 64) throw new BeatParseError(`section bars must be 1-64, got ${bars}`, lineNo)
        song!.push({ scene: sceneId, bars })
        continue
      }
      if (!currentTrack) throw new BeatParseError(`"${keyword}" outside of any track`, lineNo)
      if (keyword === 'synth') {
        if (currentTrack.kind === 'instrument') throw new BeatParseError(`instrument tracks have no synth block; "${currentTrack.id}" uses a soundfont line`, lineNo)
        if (currentTrack.kind === 'audio') throw new BeatParseError(`audio tracks have no synth block; "${currentTrack.id}" carries audio-region clips instead`, lineNo)
        closeSynthIfOpen(lineNo)
        closeClipIfOpen(lineNo)
        if (tokens.length !== 1) throw new BeatParseError('synth takes no values on its own line', lineNo)
        inSynth = true
        synthSeen = new Set()
        continue
      }
      if (keyword === 'soundfont') {
        if (currentTrack.kind !== 'instrument') throw new BeatParseError(`soundfont lines only belong in instrument tracks; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
        if (currentTrack.instrument) throw new BeatParseError('duplicate soundfont line', lineNo)
        if (tokens.length !== 3) throw new BeatParseError('soundfont expects exactly 2 values: <sample-id> <program>', lineNo)
        const program = parseIntStrict(tokens[2]!, lineNo, 'soundfont program')
        if (program < 0 || program > 127) throw new BeatParseError(`soundfont program must be 0-127, got ${program}`, lineNo)
        currentTrack.instrument = { sample: tokens[1]!, program, volume: -10, pan: 0 }
        continue
      }
      if (currentTrack.kind === 'instrument' && (keyword === 'volume' || keyword === 'pan')) {
        if (!currentTrack.instrument) throw new BeatParseError(`"${keyword}" must come after the soundfont line`, lineNo)
        if (tokens.length !== 2) throw new BeatParseError(`"${keyword}" expects exactly 1 value`, lineNo)
        const v = parseFloatStrict(tokens[1]!, lineNo, keyword)
        if (keyword === 'pan' && (v < -1 || v > 1)) throw new BeatParseError(`pan must be -1..1, got ${v}`, lineNo)
        currentTrack.instrument[keyword] = v
        continue
      }
      // Phase 26 Stream DC: an instrument track's effect-chain param fields — see
      // instrumentFieldsSeen's own comment above for why this mirrors the volume/pan branch just
      // above rather than requiring a `synth` block (which instrument tracks still don't get; the
      // core 9 + non-effect optional fields genuinely don't apply to a SoundFont voice).
      if (currentTrack.kind === 'instrument' && INSTRUMENT_EFFECT_FIELD_KEYS.has(keyword)) {
        if (!currentTrack.instrument) throw new BeatParseError(`"${keyword}" must come after the soundfont line`, lineNo)
        if (tokens.length !== 2) throw new BeatParseError(`"${keyword}" expects exactly 1 value`, lineNo)
        const seen = instrumentFieldsSeen.get(currentTrack) ?? new Set<string>()
        if (seen.has(keyword)) throw new BeatParseError(`duplicate synth param "${keyword}"`, lineNo)
        seen.add(keyword)
        instrumentFieldsSeen.set(currentTrack, seen)
        const def = SYNTH_FIELD_BY_KEY.get(keyword)!
        const value = tokens[1]!
        const synth = currentTrack.synth as unknown as Record<string, unknown>
        switch (def.kind) {
          case 'number':
            synth[def.key] = parseFloatStrict(value, lineNo, keyword)
            break
          case 'enum':
            if (!def.values!.includes(value)) throw new BeatParseError(`${keyword} must be one of ${def.values!.join('|')}, got "${value}"`, lineNo)
            synth[def.key] = value
            break
          case 'bool':
            if (value !== 'true' && value !== 'false') throw new BeatParseError(`${keyword} must be true or false, got "${value}"`, lineNo)
            synth[def.key] = value === 'true'
            break
          default:
            // No EFFECT_PARAM_KEYS entry is 'trackref'-kind (no effect param references a track).
            throw new BeatParseError(`unexpected field kind for "${keyword}"`, lineNo)
        }
        continue
      }
      closeSynthIfOpen(lineNo)
      // v0.10: `effect <id> <type> [bypassed]` — one insert-chain entry, in file order (order IS
      // chain order). `effects none` is the explicit-empty-chain sentinel (distinguishes "the
      // user emptied the chain" from "the file never mentions effects" — see defaultEffectChain's
      // comment). Phase 26 Stream DC: widened from synth-only to every track kind — see
      // BeatTrack.effects's comment for why (audio tracks are the one kind still excluded; they
      // carry no live/non-clip content at all, effects or otherwise).
      if (keyword === 'effect' || keyword === 'effects') {
        closeClipIfOpen(lineNo)
        if (currentTrack.kind === 'audio') throw new BeatParseError(`"${keyword}" lines only belong on synth/drums/instrument tracks; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
        if (keyword === 'effects') {
          if (tokens.length !== 2 || tokens[1] !== 'none') throw new BeatParseError('effects takes exactly one value: none', lineNo)
          if (effectsSeen.has(currentTrack)) throw new BeatParseError(`track "${currentTrack.id}" already has an effect chain declaration`, lineNo)
          effectsSeen.add(currentTrack)
          effectsNoneSeen.add(currentTrack)
          continue
        }
        if (effectsNoneSeen.has(currentTrack)) throw new BeatParseError(`track "${currentTrack.id}": cannot mix "effect" lines with "effects none"`, lineNo)
        if (tokens.length !== 3 && tokens.length !== 4) throw new BeatParseError('effect expects <id> <type> [bypassed]', lineNo)
        const [, id, type, bypassTok] = tokens as [string, string, string, string?]
        if (!SLUG_RE.test(id)) throw new BeatParseError(`effect ids are single alphanumeric/_/- tokens, got "${id}"`, lineNo)
        if (!isEffectType(type)) throw new BeatParseError(`unknown effect type "${type}" (expected one of ${EFFECT_TYPES.join('|')})`, lineNo)
        if (bypassTok !== undefined && bypassTok !== 'bypassed') throw new BeatParseError(`unexpected token "${bypassTok}" after effect type (expected "bypassed" or nothing)`, lineNo)
        if (currentTrack.effects.some((e) => e.id === id)) throw new BeatParseError(`duplicate effect id "${id}" on track "${currentTrack.id}"`, lineNo)
        effectsSeen.add(currentTrack)
        const added: BeatEffect = { id, type, enabled: bypassTok === undefined }
        currentTrack.effects.push(added)
        continue
      }
      if (keyword === 'lane') {
        closeClipIfOpen(lineNo)
        if (currentTrack.kind !== 'drums') throw new BeatParseError(`lane lines only belong in drum tracks; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
        // Phase 22 Stream AB: try the new open-lane-list forms (synth:<voice> | sample <id> <gain>
        // <tune> | sf <id> <program> <note>) FIRST; if none match, fall through to the legacy
        // v0.5 form below unchanged — this is what keeps every pre-existing file parsing (and,
        // since neither form touches the other's storage, re-serializing) byte-identically.
        if (tryParseLaneDecl(tokens, currentTrack, lineNo)) continue
        if (tokens.length !== 5) throw new BeatParseError('lane expects exactly 4 values: <lane> <sample-id> <gain dB> <tune semitones> (or a synth:/sample/sf backing)', lineNo)
        const [, laneTok, sampleId, gainTok, tuneTok] = tokens as [string, string, string, string, string]
        if (!isDrumLane(laneTok)) throw new BeatParseError(`unknown drum lane "${laneTok}" (expected one of ${DRUM_LANES.join('|')})`, lineNo)
        if (currentTrack.laneSamples[laneTok]) throw new BeatParseError(`duplicate lane line for "${laneTok}"`, lineNo)
        const gainDb = parseFloatStrict(gainTok, lineNo, 'lane gain')
        const tune = parseFloatStrict(tuneTok, lineNo, 'lane tune')
        if (tune < -24 || tune > 24) throw new BeatParseError(`lane tune must be -24..24 semitones, got ${tune}`, lineNo)
        currentTrack.laneSamples[laneTok] = { sample: sampleId, gainDb, tune }
        continue
      }
      // v0.10 groove/shuffle: `groove <amount> <grid>` — a track-level playback WARP (see
      // document.ts's BeatTrack.shuffleAmount/shuffleGrid and groove.ts's warpStep/unwarpStep),
      // never a note edit. Canonical elision: the line is entirely absent while amount is 0 (the
      // default), so pre-v0.10 files are untouched; present, both fields are always given
      // together (there's no meaningful "grid without amount").
      if (keyword === 'groove') {
        closeClipIfOpen(lineNo)
        if (tokens.length !== 3) throw new BeatParseError('groove expects exactly 2 values: <shuffleAmount 0..1> <shuffleGrid steps>', lineNo)
        const amount = parseFloatStrict(tokens[1]!, lineNo, 'groove shuffleAmount')
        if (amount < 0 || amount > 1) throw new BeatParseError(`groove shuffleAmount must be 0..1, got ${amount}`, lineNo)
        const grid = parseFloatStrict(tokens[2]!, lineNo, 'groove shuffleGrid')
        if (grid <= 0) throw new BeatParseError(`groove shuffleGrid must be > 0, got ${grid}`, lineNo)
        currentTrack.shuffleAmount = amount
        currentTrack.shuffleGrid = grid
        continue
      }
      if (keyword === 'clip') {
        closeClipIfOpen(lineNo)
        if (tokens.length !== 2) throw new BeatParseError('clip expects exactly 1 value: <id>', lineNo)
        const id = tokens[1]!
        if (!SLUG_RE.test(id)) throw new BeatParseError(`clip ids are single alphanumeric/_/- tokens, got "${id}"`, lineNo)
        if (currentTrack.clips.some((c) => c.id === id)) throw new BeatParseError(`duplicate clip id "${id}" on track "${currentTrack.id}"`, lineNo)
        currentClip = { id, notes: [], hits: [], automation: [], loop: null, signature: null }
        currentTrack.clips.push(currentClip)
        continue
      }
      closeClipIfOpen(lineNo)
      if (keyword === 'note') {
        if (currentTrack.kind === 'drums' || currentTrack.kind === 'audio') throw new BeatParseError(`note lines only belong in synth/instrument tracks; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
        currentTrack.notes.push(parseNoteLine(tokens, lineNo))
      } else if (keyword === 'hit') {
        if (currentTrack.kind !== 'drums') throw new BeatParseError(`hit lines only belong in drum tracks; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
        currentTrack.hits.push(parseHitLine(tokens, declaredLaneNames(currentTrack), lineNo))
      } else if (keyword === 'pattern') {
        // legacy (v<=0.7): accumulate, migrate to hits at track close
        if (currentTrack.kind !== 'drums') throw new BeatParseError(`pattern lines only belong in drum tracks; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
        const acc = legacyTrackPatterns.get(currentTrack) ?? {}
        const { lane, steps } = parsePatternLine(tokens, acc, lineNo)
        acc[lane] = steps
        legacyTrackPatterns.set(currentTrack, acc)
      } else if (keyword === 'audio') {
        // Phase 22 Stream AE: audio-region clips only — a live (non-clip) audio line makes no
        // sense in this stream's clip-only design (see docs/phase-22-stream-ae.md).
        throw new BeatParseError(`audio lines only belong inside a clip block; "${currentTrack.id}" has one directly under the track`, lineNo)
      } else {
        throw new BeatParseError(`unexpected keyword "${keyword}" inside a track`, lineNo)
      }
      continue
    }

    if (level === 2) {
      // clip content (notes for synth/instrument clips, pattern lanes for drum clips, v0.9 automation lanes)
      if (currentClip && currentTrack && !inSynth) {
        // Any level-2 line here ends a previously-open automation lane (its `point` children are
        // level 3) — close-and-validate it before handling this line, whatever it is.
        closeAutoLaneIfOpen(lineNo)
        // v0.10 (Phase 22 Stream AG): clip-level loop range + time signature — DAWproject-style
        // clip properties (loopStart/loopEnd, format-spec.md's "borrow the vocabulary" precedent),
        // at most one of each per clip. Presence is the "Clip Loop" toggle (canonical elision).
        if (keyword === 'loop') {
          if (currentClip.loop) throw new BeatParseError(`clip "${currentClip.id}" has more than one loop line`, lineNo)
          if (tokens.length !== 3) throw new BeatParseError('loop expects exactly 2 values: <start> <end> (bars, clip-local)', lineNo)
          const start = parseFloatStrict(tokens[1]!, lineNo, 'loop start')
          const end = parseFloatStrict(tokens[2]!, lineNo, 'loop end')
          if (start < 0) throw new BeatParseError(`loop start must be >= 0, got ${start}`, lineNo)
          if (end <= start) throw new BeatParseError(`loop end must be > start, got start ${start} end ${end}`, lineNo)
          currentClip.loop = { start, end }
          continue
        }
        if (keyword === 'signature') {
          if (currentClip.signature) throw new BeatParseError(`clip "${currentClip.id}" has more than one signature line`, lineNo)
          if (tokens.length !== 3) throw new BeatParseError('signature expects exactly 2 values: <numerator> <denominator>', lineNo)
          const numerator = parseIntStrict(tokens[1]!, lineNo, 'signature numerator')
          const denominator = parseIntStrict(tokens[2]!, lineNo, 'signature denominator')
          if (numerator < 1 || numerator > 32) throw new BeatParseError(`signature numerator must be 1-32, got ${numerator}`, lineNo)
          if (!(TIME_SIG_DENOMINATORS as readonly number[]).includes(denominator)) {
            throw new BeatParseError(`signature denominator must be one of ${TIME_SIG_DENOMINATORS.join('|')}, got ${denominator}`, lineNo)
          }
          currentClip.signature = { numerator, denominator }
          continue
        }
        if (keyword === 'note') {
          if (currentTrack.kind === 'drums' || currentTrack.kind === 'audio') throw new BeatParseError(`note lines only belong in synth/instrument-track clips; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
          currentClip.notes.push(parseNoteLine(tokens, lineNo))
          continue
        }
        if (keyword === 'hit') {
          if (currentTrack.kind !== 'drums') throw new BeatParseError(`hit lines only belong in drum-track clips; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
          currentClip.hits.push(parseHitLine(tokens, declaredLaneNames(currentTrack), lineNo))
          continue
        }
        if (keyword === 'pattern') {
          // legacy (v<=0.7) clip pattern: accumulate, migrate to hits at clip close
          if (currentTrack.kind !== 'drums') throw new BeatParseError(`pattern lines only belong in drum-track clips; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
          const acc = legacyClipPatterns.get(currentClip) ?? {}
          const { lane, steps } = parsePatternLine(tokens, acc, lineNo)
          acc[lane] = steps
          legacyClipPatterns.set(currentClip, acc)
          continue
        }
        if (keyword === 'audio') {
          // Phase 22 Stream AE: the entire content of an audio-region clip, one bundled line
          // (see parseAudioLine above).
          if (currentTrack.kind !== 'audio') throw new BeatParseError(`audio lines only belong in audio-track clips; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
          if (currentClip.audio) throw new BeatParseError(`duplicate audio line in clip "${currentClip.id}"`, lineNo)
          currentClip.audio = parseAudioLine(tokens, lineNo)
          continue
        }
        if (keyword === 'auto') {
          // v0.9: `auto <track>.<param>` opens an automation lane; its points are level-3
          // `point` lines, collected until the next level <= 2 line closes it (above). Phase 22
          // Stream AE: an audio-track clip's only automatable param is 'gain' (AUDIO_AUTOMATABLE_
          // PARAMS) — reuses this exact same lane/point grammar unchanged (research 16 §3).
          if (tokens.length !== 2) throw new BeatParseError('auto expects exactly 1 value: <track>.<param>', lineNo)
          const target = tokens[1]!
          const dot = target.indexOf('.')
          if (dot === -1) throw new BeatParseError(`auto target must be <track>.<param>, got "${target}"`, lineNo)
          const targetTrack = target.slice(0, dot)
          const param = target.slice(dot + 1)
          if (targetTrack !== currentTrack.id) throw new BeatParseError(`auto target track "${targetTrack}" must match the enclosing track "${currentTrack.id}"`, lineNo)
          if (currentTrack.kind === 'audio') {
            if (!(AUDIO_AUTOMATABLE_PARAMS as readonly string[]).includes(param)) throw new BeatParseError(`"${param}" is not an automatable param for an audio-track clip (expected one of ${AUDIO_AUTOMATABLE_PARAMS.join(', ')})`, lineNo)
          } else if (!(AUTOMATABLE_SYNTH_PARAMS as readonly string[]).includes(param)) {
            throw new BeatParseError(`"${param}" is not an automatable synth param (expected one of ${AUTOMATABLE_SYNTH_PARAMS.join(', ')})`, lineNo)
          }
          if (currentClip.automation.some((l) => l.param === param)) throw new BeatParseError(`duplicate automation lane "${param}" on clip "${currentClip.id}"`, lineNo)
          currentAutoLane = { param, points: [] }
          currentClip.automation.push(currentAutoLane)
          continue
        }
        throw new BeatParseError(`unexpected keyword "${keyword}" inside a clip`, lineNo)
      }

      if (!currentTrack || !inSynth) throw new BeatParseError(`"${keyword}" outside of a synth block`, lineNo)
      if (tokens.length !== 2) throw new BeatParseError(`"${keyword}" expects exactly 1 value`, lineNo)
      const value = tokens[1]!
      const field = keyword as keyof BeatSynth
      if (synthSeen.has(field)) throw new BeatParseError(`duplicate synth param "${keyword}"`, lineNo)

      if ((SYNTH_PARAM_ORDER as readonly string[]).includes(keyword)) {
        // required core 9
        synthSeen.add(field)
        if (field === 'osc') {
          if (!isOscType(value)) throw new BeatParseError(`osc must be one of sine|triangle|sawtooth|square, got "${value}"`, lineNo)
          currentTrack.synth.osc = value
        } else {
          ;(currentTrack.synth as unknown as Record<string, unknown>)[field] = parseFloatStrict(value, lineNo, keyword)
        }
        continue
      }

      // v0.3 optional fields, table-driven
      const def = SYNTH_FIELD_BY_KEY.get(keyword)
      if (!def) throw new BeatParseError(`unknown synth param "${keyword}"`, lineNo)
      synthSeen.add(field)
      const synth = currentTrack.synth as unknown as Record<string, unknown>
      switch (def.kind) {
        case 'number':
          synth[def.key] = parseFloatStrict(value, lineNo, keyword)
          break
        case 'enum':
          if (!def.values!.includes(value)) throw new BeatParseError(`${keyword} must be one of ${def.values!.join('|')}, got "${value}"`, lineNo)
          synth[def.key] = value
          break
        case 'bool':
          if (value !== 'true' && value !== 'false') throw new BeatParseError(`${keyword} must be true or false, got "${value}"`, lineNo)
          synth[def.key] = value === 'true'
          break
        case 'trackref':
          // "none" = null; other values validated against track ids after the whole document is
          // parsed (forward references are legal — duck the drums track defined later).
          synth[def.key] = value === 'none' ? null : value
          break
      }
      continue
    }

    if (level === 3) {
      // v0.9: the only level-3 content is `point` lines inside an open automation lane.
      if (currentAutoLane && keyword === 'point') {
        currentAutoLane.points.push(parsePointLine(tokens, lineNo))
        continue
      }
      if (!currentAutoLane) throw new BeatParseError(`"${keyword}" outside of an automation lane`, lineNo)
      throw new BeatParseError(`unexpected keyword "${keyword}" inside an automation lane`, lineNo)
    }

    throw new BeatParseError(`indentation too deep (level ${level})`, lineNo)
  }

  closeSynthIfOpen(rawLines.length + 1)
  closeTrackIfOpen(rawLines.length + 1)
  const eof = rawLines.length + 1

  // trackref validation happens after all tracks exist (forward references are legal)
  for (const t of tracks) {
    if (t.synth.duckSource !== null && !trackIds.has(t.synth.duckSource)) {
      throw new BeatParseError(`track "${t.id}": duckSource references unknown track "${t.synth.duckSource}"`, eof)
    }
  }

  // v0.4 reference validation: every slot names a real track and a clip that exists on it;
  // every song section names a real scene. Fail loudly — a dangling reference is a corrupt song.
  const trackById = new Map(tracks.map((t) => [t.id, t]))
  for (const scene of scenes) {
    for (const [trackId, clipId] of Object.entries(scene.slots)) {
      const track = trackById.get(trackId)
      if (!track) throw new BeatParseError(`scene "${scene.id}": slot references unknown track "${trackId}"`, eof)
      if (!track.clips.some((c) => c.id === clipId)) throw new BeatParseError(`scene "${scene.id}": slot references unknown clip "${clipId}" on track "${trackId}"`, eof)
    }
  }
  if (song) {
    if (song.length === 0) throw new BeatParseError('song block must contain at least one section', eof)
    for (const section of song) {
      if (!sceneIds.has(section.scene)) throw new BeatParseError(`song section references unknown scene "${section.scene}"`, eof)
    }
  }
  // v0.6: every instrument soundfont must reference a declared media sample
  for (const t of tracks) {
    if (t.kind === 'instrument' && t.instrument && !mediaIds.has(t.instrument.sample)) {
      throw new BeatParseError(`track "${t.id}": soundfont references unknown sample "${t.instrument.sample}"`, eof)
    }
  }
  // v0.5: every lane line must reference a declared media sample
  for (const t of tracks) {
    for (const [laneName, ls] of Object.entries(t.laneSamples)) {
      if (ls && !mediaIds.has(ls.sample)) throw new BeatParseError(`track "${t.id}" lane ${laneName}: references unknown sample "${ls.sample}"`, eof)
    }
  }
  // Phase 22 Stream AB: sample-/sf-backed entries on the OPEN lane list must also reference a
  // declared media sample — same fail-loudly stance as laneSamples/soundfont above.
  for (const t of tracks) {
    for (const decl of t.lanes) {
      if ((decl.backing.type === 'sample' || decl.backing.type === 'sf') && !mediaIds.has(decl.backing.sample)) {
        throw new BeatParseError(`track "${t.id}" lane "${decl.name}": references unknown sample "${decl.backing.sample}"`, eof)
      }
    }
  }
  // Phase 22 Stream AE: every audio-region clip must reference a declared media sample
  for (const t of tracks) {
    for (const clip of t.clips) {
      if (clip.audio && !mediaIds.has(clip.audio.media)) throw new BeatParseError(`track "${t.id}" clip "${clip.id}": audio references unknown sample "${clip.audio.media}"`, eof)
    }
  }

  if (formatVersion === null) throw new BeatParseError('missing format_version', 1)
  if (bpm === null) throw new BeatParseError('missing bpm', 1)
  if (loopBars === null) throw new BeatParseError('missing loop_bars', 1)
  if (selectedTrack === null) throw new BeatParseError('missing selected_track', 1)

  return { formatVersion, bpm, loopBars, selectedTrack, media, tracks, groups, scenes, song }
}
