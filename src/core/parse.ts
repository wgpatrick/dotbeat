import type { BeatClip, BeatDocument, BeatDrumHit, BeatDrumPattern, BeatInstrument, BeatMediaSample, BeatNote, BeatScene, BeatSongSection, BeatSynth, BeatTrack, DrumLane, OscType, TrackKind } from './document.js'
import { DRUM_LANES, INIT_SYNTH, OSC_TYPES, SYNTH_FIELD_BY_KEY, SYNTH_PARAM_ORDER, TRACK_KINDS, defaultSynthFields } from './document.js'

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

  let currentTrack: BeatTrack | null = null
  let currentClip: BeatClip | null = null
  let currentScene: BeatScene | null = null
  let inSynth = false
  let inSong = false
  let synthSeen = new Set<keyof BeatSynth>()
  // v0.8 migration: legacy `pattern` lines accumulate here per track/clip, then expand to hits
  // at close (grammar-level patterns are gone; v<=0.7 files still parse into the new event model).
  const legacyTrackPatterns = new Map<BeatTrack, Partial<BeatDrumPattern>>()
  const legacyClipPatterns = new Map<BeatClip, Partial<BeatDrumPattern>>()

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
  }

  function parseNoteLine(tokens: string[], lineNo: number): BeatNote {
    if (tokens.length !== 6) throw new BeatParseError('note expects exactly 5 values: <id> <pitch> <start> <duration> <velocity>', lineNo)
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
    return { id, pitch, start, duration, velocity }
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
  // steps (v0.7 number rules), absolute over the loop; no duration (one-shot trigger).
  function parseHitLine(tokens: string[], lineNo: number): BeatDrumHit {
    if (tokens.length !== 5) throw new BeatParseError('hit expects exactly 4 values: <id> <lane> <start> <velocity>', lineNo)
    const [, id, laneTok, startTok, velTok] = tokens as [string, string, string, string, string]
    if (!SLUG_RE.test(id)) throw new BeatParseError(`hit ids are single alphanumeric/_/- tokens, got "${id}"`, lineNo)
    if (!isDrumLane(laneTok)) throw new BeatParseError(`unknown drum lane "${laneTok}" (expected one of ${DRUM_LANES.join('|')})`, lineNo)
    const start = parseFloatStrict(startTok, lineNo, 'hit start')
    if (start < 0) throw new BeatParseError(`hit start must be >= 0, got ${start}`, lineNo)
    const velocity = parseFloatStrict(velTok, lineNo, 'hit velocity')
    if (velocity <= 0 || velocity > 1) throw new BeatParseError(`hit velocity must be in (0, 1], got ${velocity}`, lineNo)
    return { id, lane: laneTok, start, velocity }
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
        if (scenes.length > 0 || song !== null) throw new BeatParseError('track blocks must come before scene/song blocks (canonical order)', lineNo)
        closeTrackIfOpen(lineNo)
        if (tokens.length !== 5) throw new BeatParseError('track expects exactly 4 values: <id> <name> <color> <kind>', lineNo)
        const [, id, name, color, kind] = tokens as [string, string, string, string, string]
        if (trackIds.has(id)) throw new BeatParseError(`duplicate track id "${id}"`, lineNo)
        if (!/^#[0-9a-f]{6}$/.test(color)) throw new BeatParseError(`track color must be a lowercase hex color like #c678dd, got "${color}"`, lineNo)
        if (!isTrackKind(kind)) throw new BeatParseError(`track kind must be one of synth|drums, got "${kind}"`, lineNo)
        trackIds.add(id)
        currentTrack = {
          id,
          name,
          color,
          kind,
          // core 9 are placeholders until the synth block fills them (all required); the v0.3
          // optional fields start at their canonical defaults (elision contract). Instrument
          // tracks never serialize a synth block — they carry the canonical INIT copy so
          // parse(serialize(x)) deep-equals documents built via addTrack.
          synth: kind === 'instrument'
            ? { ...INIT_SYNTH }
            : ({ osc: 'sawtooth', volume: 0, cutoff: 0, resonance: 0, attack: 0, decay: 0, sustain: 0, release: 0, pan: 0, ...defaultSynthFields() } as BeatSynth),
          laneSamples: {},
          clips: [],
          notes: [],
          hits: [],
        }
        tracks.push(currentTrack)
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
      closeSynthIfOpen(lineNo)
      if (keyword === 'lane') {
        closeClipIfOpen(lineNo)
        if (currentTrack.kind !== 'drums') throw new BeatParseError(`lane lines only belong in drum tracks; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
        if (tokens.length !== 5) throw new BeatParseError('lane expects exactly 4 values: <lane> <sample-id> <gain dB> <tune semitones>', lineNo)
        const [, laneTok, sampleId, gainTok, tuneTok] = tokens as [string, string, string, string, string]
        if (!isDrumLane(laneTok)) throw new BeatParseError(`unknown drum lane "${laneTok}" (expected one of ${DRUM_LANES.join('|')})`, lineNo)
        if (currentTrack.laneSamples[laneTok]) throw new BeatParseError(`duplicate lane line for "${laneTok}"`, lineNo)
        const gainDb = parseFloatStrict(gainTok, lineNo, 'lane gain')
        const tune = parseFloatStrict(tuneTok, lineNo, 'lane tune')
        if (tune < -24 || tune > 24) throw new BeatParseError(`lane tune must be -24..24 semitones, got ${tune}`, lineNo)
        currentTrack.laneSamples[laneTok] = { sample: sampleId, gainDb, tune }
        continue
      }
      if (keyword === 'clip') {
        if (currentTrack.kind === 'instrument') throw new BeatParseError(`instrument tracks do not carry clips in v0.6 (timeline participation is a later phase); "${currentTrack.id}"`, lineNo)
        closeClipIfOpen(lineNo)
        if (tokens.length !== 2) throw new BeatParseError('clip expects exactly 1 value: <id>', lineNo)
        const id = tokens[1]!
        if (!SLUG_RE.test(id)) throw new BeatParseError(`clip ids are single alphanumeric/_/- tokens, got "${id}"`, lineNo)
        if (currentTrack.clips.some((c) => c.id === id)) throw new BeatParseError(`duplicate clip id "${id}" on track "${currentTrack.id}"`, lineNo)
        currentClip = { id, notes: [], hits: [] }
        currentTrack.clips.push(currentClip)
        continue
      }
      closeClipIfOpen(lineNo)
      if (keyword === 'note') {
        if (currentTrack.kind === 'drums') throw new BeatParseError(`note lines only belong in synth/instrument tracks; "${currentTrack.id}" is a drums track`, lineNo)
        currentTrack.notes.push(parseNoteLine(tokens, lineNo))
      } else if (keyword === 'hit') {
        if (currentTrack.kind !== 'drums') throw new BeatParseError(`hit lines only belong in drum tracks; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
        currentTrack.hits.push(parseHitLine(tokens, lineNo))
      } else if (keyword === 'pattern') {
        // legacy (v<=0.7): accumulate, migrate to hits at track close
        if (currentTrack.kind !== 'drums') throw new BeatParseError(`pattern lines only belong in drum tracks; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
        const acc = legacyTrackPatterns.get(currentTrack) ?? {}
        const { lane, steps } = parsePatternLine(tokens, acc, lineNo)
        acc[lane] = steps
        legacyTrackPatterns.set(currentTrack, acc)
      } else {
        throw new BeatParseError(`unexpected keyword "${keyword}" inside a track`, lineNo)
      }
      continue
    }

    if (level === 2) {
      // clip content (notes for synth clips, pattern lanes for drum clips)
      if (currentClip && currentTrack && !inSynth) {
        if (keyword === 'note') {
          if (currentTrack.kind !== 'synth') throw new BeatParseError(`note lines only belong in synth-track clips; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
          currentClip.notes.push(parseNoteLine(tokens, lineNo))
          continue
        }
        if (keyword === 'hit') {
          if (currentTrack.kind !== 'drums') throw new BeatParseError(`hit lines only belong in drum-track clips; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
          currentClip.hits.push(parseHitLine(tokens, lineNo))
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

  if (formatVersion === null) throw new BeatParseError('missing format_version', 1)
  if (bpm === null) throw new BeatParseError('missing bpm', 1)
  if (loopBars === null) throw new BeatParseError('missing loop_bars', 1)
  if (selectedTrack === null) throw new BeatParseError('missing selected_track', 1)

  return { formatVersion, bpm, loopBars, selectedTrack, media, tracks, scenes, song }
}
