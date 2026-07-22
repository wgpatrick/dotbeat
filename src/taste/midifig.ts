// Commercial-MIDI figures for the source showdown (docs/source-showdown-eval.md, "The midi figure
// source"). The showdown's composed sources (engine / engineplus / keymap / surge) normally play
// figures from the internal archetype bank — which entangles what a rating measures: a loss can
// mean "bad sound" or "bank composition worse than commercial composition". Feeding the composed
// sources figures EXTRACTED FROM MIDI TRANSCRIPTIONS of well-known electronic tracks holds
// composition at commercial quality, so ratings compare sound realization alone.
//
// LICENSING (the ref-chop posture, enforced here and in the CLI): MIDI transcriptions of
// copyrighted songs are derivative works. The .mid files live in the PRIVATE dataset dir outside
// any repo; batches whose figures derive from them get the generated .gitignore gate; the batch
// manifest records the midi path as a LOCAL reference only (plus `figureSource:'midi'`); the
// shared scores log records only the figure-source label ('midi' vs 'bank') — never a song title,
// artist, or path.
//
// This module owns: the sidecar spawn (python/midi_extract.py via mido), validation of its JSON,
// and the conversion of an extracted part into the ComposedPhrase shape applyComposedPhrase
// expects — including the key transposition that keeps a batch diatonically coherent with its
// seed. The CLI owns file picking per source and the fall-back-to-bank policy.

import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolvePython } from '../analysis/sidecar.js'
import { BeatBatchError } from '../vary/batch.js'
import { mulberry32 } from './eval.js'
import type { ComposedPhrase, PhraseKey } from './showdown.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MIDI_EXTRACT_PY = 'python/midi_extract.py' // relative to repoRoot, like every sidecar
const SPAWN_TIMEOUT_MS = 600_000 // matches sidecar.ts / gen.ts / surge.ts
const SPAWN_MAX_BUFFER = 64 * 1024 * 1024

export type MidiPart = 'bass' | 'chords' | 'lead'

/** Showdown role -> midi part. drum-loop maps to null: midi DRUM extraction (GM percussion
 * mapping, kit-lane translation) is its own project — the drum-loop role keeps the archetype
 * bank in v1. Unknown roles also null (the flag degrades, never breaks). */
export const ROLE_MIDI_PARTS: Record<string, MidiPart | null> = {
  bassline: 'bass',
  chords: 'chords',
  lead: 'lead',
  'drum-loop': null,
}

export function roleMidiPart(role: string): MidiPart | null {
  return role in ROLE_MIDI_PARTS ? ROLE_MIDI_PARTS[role]! : null
}

export interface MidiFigureNote {
  pitch: number
  /** 16th-note steps from the window start (0..bars*16-1) */
  start: number
  /** 16th-note steps, >= 1 */
  duration: number
  /** normalized 0..1 */
  velocity: number
}

/** The sidecar's validated extract payload. */
export interface MidiFigure {
  /** absolute path of the source .mid — a LOCAL reference (the licensing posture) */
  input: string
  part: MidiPart
  picked: { track: number; channel: number; name: string }
  bpm: number | null
  window: { startBar: number; bars: number }
  key: { rootPc: number; minor: boolean } | null
  notes: MidiFigureNote[]
}

/** Validate the sidecar's stdout JSON into a MidiFigure — loud, specific errors: a malformed
 * sidecar payload must fail HERE, not as NaN pitches at render time. */
export function validateMidiFigure(raw: unknown): MidiFigure {
  const fail = (why: string): never => {
    throw new BeatBatchError(`midi_extract payload invalid: ${why}`)
  }
  if (typeof raw !== 'object' || raw === null) fail('not an object')
  const r = raw as Record<string, unknown>
  if (typeof r.input !== 'string' || r.input === '') fail('missing input path')
  if (r.part !== 'bass' && r.part !== 'chords' && r.part !== 'lead') fail(`part must be bass|chords|lead (got ${String(r.part)})`)
  const picked = (r.picked ?? {}) as Record<string, unknown>
  if (typeof picked.track !== 'number' || typeof picked.channel !== 'number') fail('missing picked track/channel')
  const window = (r.window ?? {}) as Record<string, unknown>
  if (typeof window.startBar !== 'number' || (window.bars !== 4 && window.bars !== 8)) fail('window.bars must be 4 or 8')
  const maxStep = (window.bars as number) * 16
  let key: MidiFigure['key'] = null
  if (r.key !== null && r.key !== undefined) {
    const k = r.key as Record<string, unknown>
    if (typeof k.rootPc !== 'number' || !Number.isInteger(k.rootPc) || k.rootPc < 0 || k.rootPc > 11 || typeof k.minor !== 'boolean') fail('key must be {rootPc 0-11, minor bool} or null')
    key = { rootPc: k.rootPc as number, minor: k.minor as boolean }
  }
  if (!Array.isArray(r.notes) || r.notes.length === 0) fail('empty notes')
  const notes: MidiFigureNote[] = (r.notes as unknown[]).map((n, i) => {
    const note = n as Record<string, unknown>
    const { pitch, start, duration, velocity } = note
    if (typeof pitch !== 'number' || !Number.isInteger(pitch) || pitch < 0 || pitch > 127) fail(`note ${i}: pitch out of range`)
    if (typeof start !== 'number' || !Number.isInteger(start) || start < 0 || start >= maxStep) fail(`note ${i}: start ${String(start)} outside 0..${maxStep - 1}`)
    if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1) fail(`note ${i}: duration must be a positive integer`)
    if (typeof velocity !== 'number' || velocity < 0 || velocity > 1) fail(`note ${i}: velocity must be 0..1`)
    return { pitch: pitch as number, start: start as number, duration: duration as number, velocity: velocity as number }
  })
  return {
    input: r.input as string,
    part: r.part as MidiPart,
    picked: { track: picked.track as number, channel: picked.channel as number, name: typeof picked.name === 'string' ? picked.name : '' },
    bpm: typeof r.bpm === 'number' && r.bpm > 0 ? (r.bpm as number) : null,
    window: { startBar: window.startBar as number, bars: window.bars as number },
    key,
    notes,
  }
}

// ---- key transposition -------------------------------------------------------------------------
// The batch must stay diatonically coherent with its seed (the gen prompt and any bank figures
// are in the seed's key), but the commercial figure's INTERVALS are exactly what we're importing —
// so the transposition is purely CHROMATIC (one semitone shift for every note, the figure
// verbatim), aimed by RELATIVE-KEY alignment: same mode -> the figure's tonic lands on the seed's
// root; different mode -> it lands on the seed key's relative minor/major, so every diatonic note
// of the figure falls inside the seed's own scale without altering a single interval. (Forcing a
// mode SWAP would rewrite the commercial composition — the thing this source exists to preserve.)
// A figure with no detectable key is left untransposed, and the manifest says so honestly.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

/** Chromatic shift in semitones, folded to the nearest direction (-6..+5). */
export function midiTranspositionSemitones(figureKey: { rootPc: number; minor: boolean }, seedKey: PhraseKey): number {
  const seedPc = ((seedKey.root % 12) + 12) % 12
  const targetPc = figureKey.minor === seedKey.minor
    ? seedPc
    : figureKey.minor
      ? (seedPc + 9) % 12 // seed major, figure minor -> the seed's relative minor
      : (seedPc + 3) % 12 // seed minor, figure major -> the seed's relative major
  let shift = (((targetPc - figureKey.rootPc) % 12) + 12) % 12
  if (shift > 6) shift -= 12
  return shift
}

/** Mean-pitch target per part, matching where the archetype bank composes (bass reg 36-59,
 * chords ~60-76, lead ~72-88) so a midi figure written an octave off lands in a comparable
 * register. Applied as WHOLE-OCTAVE recentring only — never touches the figure's intervals. */
export const MIDI_ROLE_REGISTER_TARGETS: Record<MidiPart, number> = { bass: 43, chords: 64, lead: 76 }

export interface MidiPhraseConversion {
  phrase: ComposedPhrase
  /** honest transposition record for the manifest `from` string */
  transposition: string
}

/** figure label used as the ComposedPhrase archetype AND the exclude-chain token, so the CLI's
 * existing per-role figure exclusion works unchanged across midi figures. Contains the file's
 * basename — fine for the manifest/stderr (local), never written to the shared scores log. */
export function midiFigureLabel(midiPath: string): string {
  return `midi:${basename(midiPath).replace(/\.[^.]+$/, '')}`
}

/** Convert a validated midi figure into the ComposedPhrase applyComposedPhrase expects: notes on
 * the 4-bar/64-step grid, chromatically transposed into the seed's key (relative-key alignment,
 * above), whole-octave recentred into the part's register. An 8-bar figure keeps its first 4 bars
 * (the sidecar's window already picked the densest region). */
export function midiFigureToComposedPhrase(figure: MidiFigure, seedKey: PhraseKey): MidiPhraseConversion {
  const shift = figure.key === null ? 0 : midiTranspositionSemitones(figure.key, seedKey)
  const kept = figure.notes.filter((n) => n.start < 64)
  if (kept.length === 0) throw new BeatBatchError('midi figure has no notes in its first 4 bars')
  const mean = kept.reduce((s, n) => s + n.pitch + shift, 0) / kept.length
  const target = MIDI_ROLE_REGISTER_TARGETS[figure.part]
  const octaves = Math.round((target - mean) / 12)
  const notes = kept.map((n) => ({
    pitch: Math.min(127, Math.max(0, n.pitch + shift + octaves * 12)),
    start: n.start,
    duration: Math.min(n.duration, 64 - n.start),
    velocity: Math.min(1, Math.max(0.05, n.velocity)),
  }))
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  const seedPc = ((seedKey.root % 12) + 12) % 12
  const transposition = figure.key === null
    ? 'untransposed (no key detected in the midi)'
    : `transposed ${shift >= 0 ? '+' : ''}${shift} st (${NOTE_NAMES[figure.key.rootPc]} ${figure.key.minor ? 'minor' : 'major'} -> ` +
      `${NOTE_NAMES[(figure.key.rootPc + ((shift % 12) + 12) % 12) % 12]} ${figure.key.minor ? 'minor' : 'major'}` +
      `${figure.key.minor === seedKey.minor ? '' : `, relative of the seed's ${NOTE_NAMES[seedPc]} ${seedKey.minor ? 'minor' : 'major'}`})` +
      `${octaves !== 0 ? ` ${octaves > 0 ? '+' : ''}${octaves} oct register recentre` : ''}`
  return { phrase: { archetype: midiFigureLabel(figure.input), notes }, transposition }
}

// ---- midi-dir enumeration + seeded picks -------------------------------------------------------

/** Every .mid/.midi under `dir` (recursive, hidden dirs skipped), absolute paths, sorted — the
 * pool the CLI's per-source picks draw from. */
export function listMidiFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) walk(join(d, e.name))
      else if (/\.midi?$/i.test(e.name)) out.push(resolve(d, e.name))
    }
  }
  walk(dir)
  return out.sort()
}

/** Seeded pick of one midi file whose label isn't in `exclude` — the same first-unused-of-a-
 * seeded-shuffle contract as chooseArchetype, so per-source distinct figures and the per-run
 * exclude chain work identically for midi figures. Every file used -> seeded pick anyway. */
export function pickMidiFile(files: readonly string[], seed: number, exclude: readonly string[]): string | null {
  if (files.length === 0) return null
  const rng = mulberry32(seed + 523) // midi salt, distinct from the archetype/surge salts
  const shuffled = [...files]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  return shuffled.find((f) => !exclude.includes(midiFigureLabel(f))) ?? shuffled[0]!
}

// ---- sidecar spawn -----------------------------------------------------------------------------

interface SpawnResult {
  code: number | null
  stdout: string
  stderr: string
  enoent: boolean
}

function spawnPython(args: string[]): Promise<SpawnResult> {
  const python = resolvePython()
  return new Promise((resolvePromise) => {
    execFile(python, args, { cwd: repoRoot, timeout: SPAWN_TIMEOUT_MS, maxBuffer: SPAWN_MAX_BUFFER }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') resolvePromise({ code: null, stdout, stderr, enoent: true })
      else if (err) resolvePromise({ code: typeof (err as { code?: unknown }).code === 'number' ? ((err as unknown as { code: number }).code) : 1, stdout, stderr, enoent: false })
      else resolvePromise({ code: 0, stdout, stderr, enoent: false })
    })
  })
}

const lastLine = (text: string): string => {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
  return lines.length > 0 ? lines[lines.length - 1]! : ''
}

/** Run the extraction sidecar for one part of one file. Throws BeatBatchError on every failure
 * mode with the sidecar's own last stderr line (exit 3 adds the pip-install fix) — the CLI
 * catches per file and falls back to the next file / the archetype bank. */
export async function runMidiExtract(opts: { midiPath: string; part: MidiPart; bars?: 4 | 8 }): Promise<MidiFigure> {
  if (!existsSync(opts.midiPath)) throw new BeatBatchError(`no midi file at ${opts.midiPath}`)
  const res = await spawnPython([MIDI_EXTRACT_PY, '--input', resolve(opts.midiPath), '--part', opts.part, '--bars', String(opts.bars ?? 4)])
  if (res.enoent) throw new BeatBatchError('no Python interpreter found for midi_extract (python3 -m venv python/.venv && python/.venv/bin/pip install -r python/requirements-midi.txt)')
  if (res.code !== 0) {
    throw new BeatBatchError(`midi_extract (${basename(opts.midiPath)}, ${opts.part}) failed: ${lastLine(res.stderr) || `exit ${res.code}`}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(res.stdout)
  } catch {
    throw new BeatBatchError(`midi_extract produced non-JSON stdout: ${res.stdout.slice(0, 200)}`)
  }
  return validateMidiFigure(raw)
}

/** The sidecar's --doctor JSON plus the resolved interpreter (mirrors sidecarDoctor/surgeDoctor).
 * Never throws. */
export async function midiExtractDoctor(): Promise<Record<string, unknown>> {
  const python = resolvePython()
  let res: SpawnResult
  try {
    res = await spawnPython([MIDI_EXTRACT_PY, '--doctor'])
  } catch (e) {
    return { backend: 'midi', pythonFound: false, interpreter: python, error: e instanceof Error ? e.message : String(e) }
  }
  if (res.enoent) return { backend: 'midi', pythonFound: false, interpreter: python, error: `no Python interpreter found (tried "${python}")` }
  if (res.code !== 0) return { backend: 'midi', pythonFound: true, interpreter: python, error: lastLine(res.stderr) || `--doctor exited ${res.code}` }
  try {
    return { ...(JSON.parse(res.stdout) as Record<string, unknown>), interpreter: python, pythonFound: true }
  } catch {
    return { backend: 'midi', pythonFound: true, interpreter: python, error: 'midi_extract --doctor produced non-JSON output', raw: res.stdout }
  }
}

/** True iff the doctor report says mido is importable — the CLI's warn-once gate. */
export function midiExtractAvailable(report: Record<string, unknown>): boolean {
  const mido = report.mido as { available?: unknown } | undefined
  return typeof mido === 'object' && mido !== null && mido.available === true
}
