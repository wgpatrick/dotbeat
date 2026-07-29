// `beat export-midi` / `beat_export_midi` — Standard MIDI File (SMF) export of a .beat track's
// loop content, the export half of the roadmap's "MIDI file import/export (`.mid`)" row.
//
// Ableton's own discipline, adopted deliberately (research/52, manual ch.5 pp.127-128): an
// exported .mid is a STANDALONE, SEVERED copy of the notes — no live reference back to the .beat
// file, later edits on either side do not follow. That matches D1's document-only philosophy, so
// this is a plain writer with zero dependencies: SMF type 0 (one track) / type 1 (several), one
// set_tempo meta from the document's bpm, note_on/note_off pairs, and nothing else.
//
// Unit contract (the details a DAW punishes when wrong — hand-rolled-export scars, 2026-07-26):
//   * a .beat step is a 16th note; at 480 ticks/quarter that is exactly 120 ticks per step.
//   * velocity is 0..1 in .beat and 1..127 in MIDI. Clamped to >= 1: a velocity-0 note_on IS a
//     note_off by MIDI convention and must never be emitted.
//   * at the same tick, note_off sorts BEFORE note_on — otherwise back-to-back repeats of one
//     pitch fuse into a single long note on import.
//   * a note whose duration overhangs the loop boundary keeps its true length (no clamping —
//     this writer never even looks at loopBars).
//   * per-note `cent`, `chance`, ratchet fields and deactivated notes have no clean SMF mapping;
//     they are DROPPED and counted in the report (never silently).
//   * drum lane hits are not pitched notes: declared lanes map to General MIDI drum notes on
//     channel 10 (sf-backed lanes carry their own GM note and use it; everything else maps by
//     lane name via DEFAULT_DRUM_KIT). A lane with no GM mapping is skipped BY NAME in the report.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parse } from '../core/parse.js'
import { DEFAULT_DRUM_KIT, NOTE_FIELD_DEFAULTS, declaredLaneNames, type BeatDocument, type BeatTrack } from '../core/document.js'

export class BeatMidiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatMidiError'
  }
}

/** 480 ticks per quarter note — the common DAW default; divisible by every grid dotbeat uses. */
export const MIDI_TICKS_PER_QUARTER = 480
/** A .beat step IS a 16th note (format-spec), so a step is a quarter of a quarter: 120 ticks. */
export const TICKS_PER_STEP = MIDI_TICKS_PER_QUARTER / 4
/** A one-shot drum hit (no `duration` field) gets a nominal 32nd-note gate. Drum samplers ignore
 * note length, so the value is cosmetic — it just has to be short and nonzero. */
export const ONE_SHOT_HIT_TICKS = MIDI_TICKS_PER_QUARTER / 8

/** Lane-name -> General MIDI percussion note, derived from the repo's own GM-aligned default kit
 * (DEFAULT_DRUM_KIT, research 19 Part VII) so there is exactly one mapping to drift. Covers the
 * implicit legacy 5 (kick/snare/clap/hat/openhat) and every kit-808/909/acoustic lane name. */
export const GM_LANE_NOTES: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(DEFAULT_DRUM_KIT.map((l) => [l.name, l.note])),
)

/** MIDI variable-length quantity: big-endian 7-bit groups, high bit set on all but the last.
 * 0..127 is one byte; 128 is the first two-byte value (0x81 0x00). */
export function encodeVlq(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 0x0fffffff) {
    throw new BeatMidiError(`VLQ out of range: ${value} (must be an integer 0..0x0FFFFFFF)`)
  }
  const bytes = [value & 0x7f]
  let rest = value >> 7
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80)
    rest >>= 7
  }
  return bytes
}

/** .beat velocity (0..1] -> MIDI 1..127. Clamped to >= 1: velocity-0 note_ons mean note_off. */
export function midiVelocity(velocity: number): number {
  return Math.max(1, Math.min(127, Math.round(velocity * 127)))
}

/** The set_tempo meta payload: microseconds per quarter note (125 bpm -> 480000 -> 07 53 00). */
export function tempoMetaBytes(bpm: number): number[] {
  const mpqn = Math.round(60_000_000 / bpm)
  return [0xff, 0x51, 0x03, (mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff]
}

// Same-tick ordering ranks: metas, then note_offs, then note_ons. The off-before-on rule is the
// one that matters musically (see the unit contract above); metas-first keeps tempo/name at the
// very front of the track.
const RANK_META = 0
const RANK_NOTE_OFF = 1
const RANK_NOTE_ON = 2

interface TimedEvent {
  tick: number
  rank: number
  bytes: number[] // status + data (delta time is added at encode time)
}

/** What one exported track dropped/mapped — printed by both surfaces, never silently swallowed. */
export interface MidiTrackReport {
  trackId: string
  kind: BeatTrack['kind']
  /** 0-based MIDI channel (drums always 9, i.e. "channel 10" in human terms). */
  channel: number
  noteCount: number
  /** Notes carrying a nonzero `cent` detune — SMF has no per-note detune; dropped. */
  droppedCent: number
  /** Notes with chance < 100 — exported as ordinary always-on notes; the probability is dropped. */
  droppedChance: number
  /** Notes with ratchetCount > 1 — exported once, un-ratcheted (`beat consolidate` bakes them). */
  droppedRatchet: number
  /** Deactivated notes (active=false) — silent in dotbeat, so not exported at all. */
  skippedInactive: number
  /** Drums only: lane name -> the GM note its hits landed on. */
  laneNotes: Record<string, number>
  /** Drums only: lane name -> hit count for lanes with NO GM mapping (skipped, loudly). */
  skippedLanes: Record<string, number>
  /** Where the track's last note_off lands, in seconds at the document tempo. */
  endSeconds: number
}

function stepTicks(steps: number): number {
  return Math.round(steps * TICKS_PER_STEP)
}

/** The GM note a drum lane exports on: sf-backed lanes carry a real GM note in the document and
 * it wins; everything else maps by lane name; null = no mapping (the caller reports the skip). */
export function gmNoteForLane(track: BeatTrack, lane: string): number | null {
  const decl = track.lanes.find((l) => l.name === lane)
  if (decl && decl.backing.type === 'sf') return decl.backing.note
  return GM_LANE_NOTES[lane] ?? null
}

function trackEvents(track: BeatTrack, channel: number, bpm: number): { events: TimedEvent[]; report: MidiTrackReport } {
  const report: MidiTrackReport = {
    trackId: track.id,
    kind: track.kind,
    channel,
    noteCount: 0,
    droppedCent: 0,
    droppedChance: 0,
    droppedRatchet: 0,
    skippedInactive: 0,
    laneNotes: {},
    skippedLanes: {},
    endSeconds: 0,
  }
  const events: TimedEvent[] = []
  let lastOffTick = 0
  const emit = (pitch: number, onTick: number, durTicks: number, velocity: number) => {
    const offTick = onTick + Math.max(1, durTicks)
    events.push({ tick: onTick, rank: RANK_NOTE_ON, bytes: [0x90 | channel, pitch, midiVelocity(velocity)] })
    events.push({ tick: offTick, rank: RANK_NOTE_OFF, bytes: [0x80 | channel, pitch, 0] })
    report.noteCount += 1
    lastOffTick = Math.max(lastOffTick, offTick)
  }

  if (track.kind === 'drums') {
    // Validate the whole lane set up front so a lane with no GM mapping is reported even when
    // its name would otherwise only surface hit-by-hit.
    for (const lane of declaredLaneNames(track)) {
      if (gmNoteForLane(track, lane) === null) report.skippedLanes[lane] = 0
    }
    for (const hit of track.hits) {
      const note = gmNoteForLane(track, hit.lane)
      if (note === null) {
        report.skippedLanes[hit.lane] = (report.skippedLanes[hit.lane] ?? 0) + 1
        continue
      }
      report.laneNotes[hit.lane] = note
      emit(note, stepTicks(hit.start), hit.duration !== undefined ? stepTicks(hit.duration) : ONE_SHOT_HIT_TICKS, hit.velocity)
    }
    // Mapped-but-unused lanes are not interesting; drop skip entries for lanes that had no hits
    // only when the lane also never appears in the hit list (count 0 AND unmapped stays listed:
    // the user should know the lane will never export before they put hits on it).
  } else {
    for (const note of track.notes) {
      if (!note.active) {
        report.skippedInactive += 1
        continue // deactivated = silent in dotbeat; exporting it would UN-mute it in the DAW
      }
      if (note.cent !== NOTE_FIELD_DEFAULTS.cent) report.droppedCent += 1
      if (note.chance !== NOTE_FIELD_DEFAULTS.chance) report.droppedChance += 1
      if (note.ratchetCount !== NOTE_FIELD_DEFAULTS.ratchetCount) report.droppedRatchet += 1
      emit(note.pitch, stepTicks(note.start), stepTicks(note.duration), note.velocity)
    }
  }

  const secondsPerTick = 60 / (bpm * MIDI_TICKS_PER_QUARTER)
  report.endSeconds = lastOffTick * secondsPerTick
  return { events, report }
}

function metaTrackName(name: string): number[] {
  const ascii = [...name].map((c) => c.charCodeAt(0) & 0x7f)
  return [0xff, 0x03, ...encodeVlq(ascii.length), ...ascii]
}

/** One MTrk chunk: events sorted by (tick, rank — note_off before note_on), delta-encoded,
 * closed with end-of-track. The sort is stable, so same-tick same-rank events keep file order. */
function encodeTrackChunk(events: TimedEvent[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.rank - b.rank)
  const body: number[] = []
  let lastTick = 0
  for (const ev of sorted) {
    body.push(...encodeVlq(ev.tick - lastTick), ...ev.bytes)
    lastTick = ev.tick
  }
  body.push(0x00, 0xff, 0x2f, 0x00) // end of track
  return [0x4d, 0x54, 0x72, 0x6b, (body.length >> 24) & 0xff, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff, ...body]
}

export interface MidiFileExport {
  format: 0 | 1
  bytes: Uint8Array
  tracks: MidiTrackReport[]
}

const EXPORTABLE_KINDS: ReadonlySet<BeatTrack['kind']> = new Set(['synth', 'drums', 'instrument', 'surge'])

function findExportableTrack(doc: BeatDocument, trackId: string): BeatTrack {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatMidiError(`no track "${trackId}" (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  if (!EXPORTABLE_KINDS.has(track.kind)) {
    throw new BeatMidiError(`track "${trackId}" is an ${track.kind} track — it has no MIDI content to export`)
  }
  if (track.notes.length === 0 && track.hits.length === 0) {
    const inClips = track.clips.reduce((n, c) => n + c.notes.length + c.hits.length, 0)
    throw new BeatMidiError(
      `track "${trackId}" has no notes/hits to export` +
        (inClips > 0 ? ` — its content lives only in clips (${inClips} event(s)); export-midi v1 reads the track's own loop notes/hits` : ''),
    )
  }
  return track
}

/** Encode one or more tracks of a document as a single SMF: type 0 for one track, type 1 (a
 * shared tempo track + one MTrk per beat track) for several. Drums land on channel 10 (index 9);
 * pitched tracks take 0, 1, 2, … skipping 9. */
export function exportTracksToMidi(doc: BeatDocument, trackIds: string[]): MidiFileExport {
  if (trackIds.length === 0) throw new BeatMidiError('exportTracksToMidi needs at least one track id')
  const dupes = trackIds.filter((id, i) => trackIds.indexOf(id) !== i)
  if (dupes.length > 0) throw new BeatMidiError(`track "${dupes[0]}" is listed twice`)
  const tracks = trackIds.map((id) => findExportableTrack(doc, id))

  let nextPitchedChannel = 0
  const channelFor = (t: BeatTrack): number => {
    if (t.kind === 'drums') return 9
    const ch = nextPitchedChannel
    nextPitchedChannel += nextPitchedChannel === 8 ? 2 : 1 // skip 9 (GM drums)
    return Math.min(ch, 15)
  }

  const perTrack = tracks.map((t) => {
    const { events, report } = trackEvents(t, channelFor(t), doc.bpm)
    return { track: t, events, report }
  })

  const header = (format: 0 | 1, ntrks: number): number[] => [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, // MThd, length 6
    0, format,
    (ntrks >> 8) & 0xff, ntrks & 0xff,
    (MIDI_TICKS_PER_QUARTER >> 8) & 0xff, MIDI_TICKS_PER_QUARTER & 0xff,
  ]
  const tempo: TimedEvent = { tick: 0, rank: RANK_META, bytes: tempoMetaBytes(doc.bpm) }

  let bytes: number[]
  let format: 0 | 1
  if (perTrack.length === 1) {
    format = 0
    const only = perTrack[0]!
    const name: TimedEvent = { tick: 0, rank: RANK_META, bytes: metaTrackName(only.track.id) }
    bytes = [...header(0, 1), ...encodeTrackChunk([tempo, name, ...only.events])]
  } else {
    format = 1
    const chunks = [encodeTrackChunk([tempo])]
    for (const pt of perTrack) {
      const name: TimedEvent = { tick: 0, rank: RANK_META, bytes: metaTrackName(pt.track.id) }
      chunks.push(encodeTrackChunk([name, ...pt.events]))
    }
    bytes = [...header(1, chunks.length), ...chunks.flat()]
  }
  return { format, bytes: Uint8Array.from(bytes), tracks: perTrack.map((pt) => pt.report) }
}

// ---- the shared CLI/MCP runner (parity is structural: both surfaces call THIS) -----------------

export interface RunExportMidiOptions {
  file: string
  /** Named tracks; empty/absent = every non-audio track with notes or hits. */
  tracks?: string[]
  /** Write ONE .mid at this path (type 1 multi-track when it covers several tracks). */
  out?: string
  /** Write one type-0 .mid per track into this directory (default: <file>-midi/ next to the .beat). */
  outDir?: string
}

export interface RunExportMidiResult {
  text: string
  files: string[]
}

function contentTrackIds(doc: BeatDocument): string[] {
  return doc.tracks.filter((t) => EXPORTABLE_KINDS.has(t.kind) && (t.notes.length > 0 || t.hits.length > 0)).map((t) => t.id)
}

function reportLines(report: MidiTrackReport, dest: string): string[] {
  const lines: string[] = []
  const count = report.kind === 'drums' ? `${report.noteCount} hit${report.noteCount === 1 ? '' : 's'}` : `${report.noteCount} note${report.noteCount === 1 ? '' : 's'}`
  const chan = report.channel === 9 ? 'ch 10 (GM drums)' : `ch ${report.channel + 1}`
  lines.push(`  ${report.trackId}  ${count}  ${chan}  0-${report.endSeconds.toFixed(2)}s  -> ${dest}`)
  const mapped = Object.entries(report.laneNotes)
  if (mapped.length > 0) {
    lines.push(`    GM drum map: ${mapped.map(([lane, note]) => `${lane}->${note}`).join(' ')}`)
  }
  for (const [lane, hits] of Object.entries(report.skippedLanes)) {
    lines.push(
      hits > 0
        ? `    SKIPPED lane "${lane}" — no General MIDI mapping: ${hits} hit${hits === 1 ? '' : 's'} NOT exported`
        : `    note: lane "${lane}" has no General MIDI mapping — any hits on it would not export`,
    )
  }
  const dropped: string[] = []
  if (report.droppedCent > 0) dropped.push(`cent detune on ${report.droppedCent}`)
  if (report.droppedChance > 0) dropped.push(`chance<100 on ${report.droppedChance}`)
  if (report.droppedRatchet > 0) dropped.push(`ratchet on ${report.droppedRatchet} (beat consolidate bakes ratchets into real notes first)`)
  if (dropped.length > 0) lines.push(`    dropped (no SMF equivalent): ${dropped.join(', ')} note(s)`)
  if (report.skippedInactive > 0) lines.push(`    skipped ${report.skippedInactive} deactivated note(s) (active=0 — silent in dotbeat, not exported)`)
  return lines
}

/** Read a .beat file and write .mid file(s). Both the CLI verb and the MCP tool are thin argv/JSON
 * adapters over this one function — the runVaryBatch parity pattern (CLAUDE.md / D21). */
export function runExportMidi(opts: RunExportMidiOptions): RunExportMidiResult {
  if (opts.out !== undefined && opts.outDir !== undefined) {
    throw new BeatMidiError('pass either -o <out.mid> (one file) or --out-dir <dir> (one file per track), not both')
  }
  const file = resolve(opts.file)
  const doc = parse(readFileSync(file, 'utf8'))
  const requested = (opts.tracks ?? []).filter((t) => t.length > 0)
  const trackIds = requested.length > 0 ? requested : contentTrackIds(doc)
  if (trackIds.length === 0) {
    throw new BeatMidiError(`${basename(file)} has no track with notes or hits — nothing to export`)
  }

  const lines: string[] = []
  const files: string[] = []
  const reports: MidiTrackReport[] = []

  if (opts.out !== undefined) {
    const outPath = resolve(opts.out)
    const exported = exportTracksToMidi(doc, trackIds)
    writeFileSync(outPath, exported.bytes)
    files.push(outPath)
    reports.push(...exported.tracks)
    lines.push(
      `exported ${basename(file)} @ ${doc.bpm}bpm -> ${outPath} (SMF type ${exported.format}${exported.format === 1 ? `, ${trackIds.length} tracks + tempo track` : ''}, ${MIDI_TICKS_PER_QUARTER} ticks/quarter, 1 step = ${TICKS_PER_STEP} ticks)`,
    )
    for (const report of exported.tracks) lines.push(...reportLines(report, basename(outPath)))
  } else {
    const stem = basename(file).replace(/\.beat$/, '')
    const dir = resolve(opts.outDir ?? join(dirname(file), `${stem}-midi`))
    mkdirSync(dir, { recursive: true })
    lines.push(`exported ${basename(file)} @ ${doc.bpm}bpm -> ${dir}/ (one SMF type-0 .mid per track, ${MIDI_TICKS_PER_QUARTER} ticks/quarter, 1 step = ${TICKS_PER_STEP} ticks)`)
    for (const id of trackIds) {
      const exported = exportTracksToMidi(doc, [id])
      const dest = join(dir, `${id}.mid`)
      writeFileSync(dest, exported.bytes)
      files.push(dest)
      reports.push(...exported.tracks)
      lines.push(...reportLines(exported.tracks[0]!, dest))
    }
  }

  lines.push(`Ableton: drag a .mid onto a MIDI track — the import is a severed copy (its own manual's discipline, research/52); later dotbeat edits do not follow.`)
  return { text: lines.join('\n') + '\n', files }
}
