import type { BeatClip, BeatDocument, BeatDrumPattern, BeatMediaSample, BeatNote, BeatScene, BeatSongSection, BeatSynth, BeatTrack, DrumLane, OscType, TrackKind } from './document.js'
import { DRUM_LANES, OSC_TYPES, SYNTH_FIELD_BY_KEY, SYNTH_PARAM_ORDER, TRACK_KINDS, defaultSynthFields } from './document.js'

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

  function closeSynthIfOpen(lineNo: number) {
    if (!inSynth) return
    const missing = SYNTH_PARAM_ORDER.filter((k) => !synthSeen.has(k))
    if (missing.length) throw new BeatParseError(`synth block is missing required param(s): ${missing.join(', ')}`, lineNo)
    inSynth = false
  }

  // A drum pattern (track-level or clip-level) must arrive complete: all five lanes, equal step
  // counts — the same fail-loudly stance the synth block takes.
  function checkDrumPattern(pattern: BeatDrumPattern | undefined, what: string, lineNo: number) {
    const p = pattern ?? ({} as BeatDrumPattern)
    const missing = DRUM_LANES.filter((lane) => !(lane in p))
    if (missing.length) throw new BeatParseError(`${what} is missing pattern lane(s): ${missing.join(', ')}`, lineNo)
    const lengths = new Set(DRUM_LANES.map((lane) => p[lane].length))
    if (lengths.size > 1) throw new BeatParseError(`${what} has pattern lanes of unequal length`, lineNo)
  }

  function closeClipIfOpen(lineNo: number) {
    if (!currentClip || !currentTrack) return
    if (currentTrack.kind === 'drums') checkDrumPattern(currentClip.pattern, `clip "${currentClip.id}" in drum track "${currentTrack.id}"`, lineNo)
    currentClip = null
  }

  function closeTrackIfOpen(lineNo: number) {
    closeClipIfOpen(lineNo)
    if (!currentTrack || currentTrack.kind !== 'drums') return
    checkDrumPattern(currentTrack.pattern, `drum track "${currentTrack.id}"`, lineNo)
  }

  function parseNoteLine(tokens: string[], lineNo: number): BeatNote {
    if (tokens.length !== 6) throw new BeatParseError('note expects exactly 5 values: <id> <pitch> <start> <duration> <velocity>', lineNo)
    const [, id, pitchTok, startTok, durTok, velTok] = tokens as [string, string, string, string, string, string]
    const pitch = parseIntStrict(pitchTok, lineNo, 'note pitch')
    if (pitch < 0 || pitch > 127) throw new BeatParseError(`note pitch must be 0-127, got ${pitch}`, lineNo)
    const start = parseIntStrict(startTok, lineNo, 'note start')
    const duration = parseIntStrict(durTok, lineNo, 'note duration')
    if (duration < 1) throw new BeatParseError(`note duration must be >= 1 step, got ${duration}`, lineNo)
    const velocity = parseFloatStrict(velTok, lineNo, 'note velocity')
    return { id, pitch, start, duration, velocity }
  }

  function parsePatternLine(tokens: string[], existing: BeatDrumPattern | undefined, lineNo: number): { lane: DrumLane; steps: number[] } {
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
          // optional fields start at their canonical defaults (elision contract).
          synth: { osc: 'sawtooth', volume: 0, cutoff: 0, resonance: 0, attack: 0, decay: 0, sustain: 0, release: 0, pan: 0, ...defaultSynthFields() } as BeatSynth,
          laneSamples: {},
          clips: [],
          notes: [],
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
        closeSynthIfOpen(lineNo)
        closeClipIfOpen(lineNo)
        if (tokens.length !== 1) throw new BeatParseError('synth takes no values on its own line', lineNo)
        inSynth = true
        synthSeen = new Set()
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
        closeClipIfOpen(lineNo)
        if (tokens.length !== 2) throw new BeatParseError('clip expects exactly 1 value: <id>', lineNo)
        const id = tokens[1]!
        if (!SLUG_RE.test(id)) throw new BeatParseError(`clip ids are single alphanumeric/_/- tokens, got "${id}"`, lineNo)
        if (currentTrack.clips.some((c) => c.id === id)) throw new BeatParseError(`duplicate clip id "${id}" on track "${currentTrack.id}"`, lineNo)
        currentClip = { id, notes: [] }
        currentTrack.clips.push(currentClip)
        continue
      }
      closeClipIfOpen(lineNo)
      if (keyword === 'note') {
        if (currentTrack.kind !== 'synth') throw new BeatParseError(`note lines only belong in synth tracks; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
        currentTrack.notes.push(parseNoteLine(tokens, lineNo))
      } else if (keyword === 'pattern') {
        if (currentTrack.kind !== 'drums') throw new BeatParseError(`pattern lines only belong in drum tracks; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
        const { lane, steps } = parsePatternLine(tokens, currentTrack.pattern, lineNo)
        currentTrack.pattern = { ...(currentTrack.pattern ?? ({} as BeatDrumPattern)), [lane]: steps }
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
        if (keyword === 'pattern') {
          if (currentTrack.kind !== 'drums') throw new BeatParseError(`pattern lines only belong in drum-track clips; "${currentTrack.id}" is a ${currentTrack.kind} track`, lineNo)
          const { lane, steps } = parsePatternLine(tokens, currentClip.pattern, lineNo)
          currentClip.pattern = { ...(currentClip.pattern ?? ({} as BeatDrumPattern)), [lane]: steps }
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
