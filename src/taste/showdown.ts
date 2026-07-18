// Source-showdown eval (docs/source-showdown-eval.md): a standing, blind, per-musical-role
// comparison of WHERE good sound comes from. Each showdown batch is ONE role (bassline / chords /
// lead / drum-loop) × one clip per SOURCE PIPELINE:
//
//   engine  — the role's phrase from a taste-seed song, soloed, rendered through dotbeat's own
//             synth engine (the "can our synth carry this part?" baseline)
//   gen     — a fal/stub-generated phrase for the same role (the prompt bank's phrase tier)
//   keymap  — a generated ONE-SHOT turned into an instrument (beat keymap / sample lanes) playing
//             the SAME phrase through the engine's sampler — the hybrid the owner is curious about
//   ref     — (opt-in, private) a clip referenced from an external directory of commercial-music
//             chops; see the licensing stance in the design doc — the tool references files under
//             the given path, and nothing identifying them ever enters anything shared
//
// Rating flows through the EXISTING `beat rate` UI and scoreBatch path unchanged (blind: sources
// are assigned to v-numbers in a seeded shuffle here, and the rate UI shuffles presentation again
// per batch). This module is deliberately render-free and network-free: it builds documents,
// manifests, and does frame-math on wavs; the CLI (cli/beat.mjs showdownCmd) owns the renders and
// the generation calls, so everything here tests on synthetic audio.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  parse,
  serialize,
  addHit,
  addLane,
  removeLane,
  materializeLanes,
  setLaneSample,
  type BeatDocument,
} from '../core/index.js'
import { buildKeymap, midiToNote } from '../core/keymap.js'
import { BeatBatchError, type VaryBatchManifest } from '../vary/batch.js'
import { shuffledOrder } from '../vary/audition.js'
import { genSubject } from './seeds.js'
import { SPLIT_SMOKE_MIN_BATCHES } from './eval.js'

export type ShowdownSourceKind = 'engine' | 'gen' | 'keymap' | 'ref'

/** Volume levels shared with taste-collect's solo logic (owner feedback 2026-07-18: a quiet
 * varied track in a full mix is unratable — the showdown compares the SOUND of one role, so the
 * engine clip solos it). */
export const SHOWDOWN_PROMINENT_DB = -4
export const SHOWDOWN_MUTE_DB = -60

export interface ShowdownRoleSpec {
  role: string
  /** the taste-seed track that carries this role (src/taste/seeds.ts generateSeedBeat) */
  seedTrack: string
  /** phrase-tier prompt-bank subject id for the gen clip */
  phraseSubjectId: string
  /** how the keymap clip is built: a pitched keymap from one one-shot, or a sample-backed kit */
  keymap: { kind: 'pitched'; oneShotSubjectId: string } | { kind: 'kit'; laneSubjects: Record<'kick' | 'snare' | 'hat', string> }
}

/** The four roles of the standing eval. seedTrack names match generateSeedBeat's track ids; the
 * subject ids are prompt-bank entries (genSubject throws loudly if the banks ever drift). */
export const SHOWDOWN_ROLES: ShowdownRoleSpec[] = [
  { role: 'bassline', seedTrack: 'bass', phraseSubjectId: 'bassline', keymap: { kind: 'pitched', oneShotSubjectId: 'bass' } },
  { role: 'chords', seedTrack: 'chords', phraseSubjectId: 'chords', keymap: { kind: 'pitched', oneShotSubjectId: 'stab' } },
  { role: 'lead', seedTrack: 'arp', phraseSubjectId: 'melody', keymap: { kind: 'pitched', oneShotSubjectId: 'pluck' } },
  { role: 'drum-loop', seedTrack: 'drums', phraseSubjectId: 'drumloop', keymap: { kind: 'kit', laneSubjects: { kick: 'kick', snare: 'snare', hat: 'hat' } } },
]

export function showdownRole(role: string): ShowdownRoleSpec {
  const spec = SHOWDOWN_ROLES.find((r) => r.role === role)
  if (!spec) throw new BeatBatchError(`unknown showdown role "${role}" (have: ${SHOWDOWN_ROLES.map((r) => r.role).join(', ')})`)
  // validate the bank references eagerly so a drifted prompt bank fails at spec time, not mid-run
  genSubject(spec.phraseSubjectId)
  if (spec.keymap.kind === 'pitched') genSubject(spec.keymap.oneShotSubjectId)
  else Object.values(spec.keymap.laneSubjects).forEach((id) => genSubject(id))
  return spec
}

// ---- document builders -------------------------------------------------------------------------

/** Loop the seed's content out to 4 bars (the gen phrase tier is 4 bars / ~8s — owner call
 * 2026-07-18) by duplicating notes/hits per repeat. Seeds are 2-bar loops; a doc already >= 4
 * bars passes through untouched. */
export function extendToFourBars(doc: BeatDocument): BeatDocument {
  if (doc.loopBars >= 4) return doc
  const reps = Math.ceil(4 / doc.loopBars)
  const shiftUnit = doc.loopBars * 16
  const tracks = doc.tracks.map((t) => {
    if (t.kind === 'synth') {
      const notes = [...t.notes]
      for (let r = 1; r < reps; r++) for (const n of t.notes) notes.push({ ...n, id: `${n.id}r${r}`, start: n.start + r * shiftUnit })
      return { ...t, notes }
    }
    if (t.kind === 'drums') {
      const hits = [...t.hits]
      for (let r = 1; r < reps; r++) for (const h of t.hits) hits.push({ ...h, id: `${h.id}r${r}`, start: h.start + r * shiftUnit })
      return { ...t, hits }
    }
    return t
  })
  return { ...doc, loopBars: doc.loopBars * reps, tracks }
}

/** Solo `trackId` the way taste-collect's param batches do: every other track muted, the target
 * boosted to a prominent level — the batch compares the SOUND of one role, not a mix. */
export function soloForShowdown(doc: BeatDocument, trackId: string): BeatDocument {
  if (!doc.tracks.some((t) => t.id === trackId)) {
    throw new BeatBatchError(`no track "${trackId}" to solo (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  }
  const tracks = doc.tracks.map((t) => {
    const v = t.synth?.volume
    if (typeof v !== 'number') return t
    if (t.id === trackId) return v < SHOWDOWN_PROMINENT_DB ? { ...t, synth: { ...t.synth, volume: SHOWDOWN_PROMINENT_DB } } : t
    return { ...t, synth: { ...t.synth, volume: SHOWDOWN_MUTE_DB } }
  })
  return { ...doc, tracks }
}

/** Minimal host project for a pitched keymap phrase: one drums-kind track ("phrase") the CLI
 * registers the generated one-shot into (beat source gen -> media/) before buildPitchedKeymapPhrase
 * declares the lanes and writes the hits. Emitted as text and parse-validated by the caller, same
 * discipline as generateSeedBeat. */
export function keymapScratchText(bpm: number): string {
  return [
    'format_version 0.11',
    `bpm ${Math.round(bpm)}`,
    'loop_bars 4',
    'selected_track phrase',
    '',
    'track phrase Phrase #c678dd drums',
    '  synth',
    '    osc triangle',
    `    volume ${SHOWDOWN_PROMINENT_DB}`,
    '    cutoff 8000',
    '    resonance 0.5',
    '    attack 0.001',
    '    decay 0.2',
    '    sustain 0.5',
    '    release 0.2',
    '    pan 0',
    '',
  ].join('\n')
}

export interface PhraseNote {
  pitch: number
  start: number
  velocity: number
}

/** The role's phrase as plain notes, read off the (already 4-bar-extended) seed doc. */
export function phraseFromSeed(doc: BeatDocument, trackId: string): PhraseNote[] {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track || track.kind !== 'synth') throw new BeatBatchError(`showdown needs synth track "${trackId}" on the seed (have: ${doc.tracks.map((t) => `${t.id}(${t.kind})`).join(', ')})`)
  if (track.notes.length === 0) throw new BeatBatchError(`seed track "${trackId}" has no notes to phrase from`)
  return track.notes.map((n) => ({ pitch: n.pitch, start: n.start, velocity: n.velocity }))
}

/** Build the pitched keymap clip: chromatic keymap lanes over the phrase's (octave-recentred)
 * span, backed by `sampleId` at `rootMidi`, playing the seed phrase as hits. `scratchDoc` is the
 * parsed keymapScratchText host AFTER the CLI registered the one-shot into its media block.
 *
 * The phrase is shifted by whole octaves toward the sample's root so every lane's tune stays
 * inside the engine's ±24-semitone lane clamp — the phrase's CONTOUR is the comparison, not its
 * absolute octave (a bass phrase played on a bell sample at the bell's own register is the honest
 * rendition of "this one-shot as an instrument"). */
export function buildPitchedKeymapPhrase(
  scratchDoc: BeatDocument,
  sampleId: string,
  rootMidi: number,
  phrase: PhraseNote[],
): { doc: BeatDocument; shift: number; fromMidi: number; toMidi: number } {
  if (phrase.length === 0) throw new BeatBatchError('a keymap phrase needs at least one note')
  const mean = phrase.reduce((s, n) => s + n.pitch, 0) / phrase.length
  const shift = Math.round((rootMidi - mean) / 12) * 12
  const fromMidi = Math.min(...phrase.map((n) => n.pitch)) + shift
  const toMidi = Math.max(...phrase.map((n) => n.pitch)) + shift
  const trackId = 'phrase'
  // materialize the default kit only to satisfy the open-lane model, then drop the 5 unused
  // synth lanes — the phrase track ends up holding ONLY the keymap's sample lanes.
  let doc = materializeLanes(scratchDoc, trackId).doc
  const defaults = doc.tracks.find((t) => t.id === trackId)!
  const defaultNames = defaults.kind === 'drums' ? defaults.lanes.map((l) => l.name) : []
  doc = buildKeymap(doc, trackId, sampleId, { rootMidi, scaleRootMidi: fromMidi, scale: 'chromatic', fromMidi, toMidi }).doc
  for (const name of defaultNames) doc = removeLane(doc, trackId, name).doc
  for (const n of phrase) {
    doc = addHit(doc, trackId, { lane: midiToNote(n.pitch + shift), start: n.start, velocity: Math.min(1, Math.max(0.05, n.velocity)) }).doc
  }
  return { doc, shift, fromMidi, toMidi }
}

/** Build the drum-loop keymap clip: the seed's own drum pattern, with kick/snare/hat re-backed by
 * generated one-shot samples (the engine's sampler lanes as the instrument). `baseDoc` is the
 * drums-only extended seed AFTER the CLI registered the three one-shots into its media block. */
export function buildKitPhrase(baseDoc: BeatDocument, trackId: string, samplesByLane: Record<string, string>): BeatDocument {
  const track = baseDoc.tracks.find((t) => t.id === trackId)
  if (!track || track.kind !== 'drums') throw new BeatBatchError(`showdown drum-loop needs drums track "${trackId}" on the seed`)
  let doc = materializeLanes(baseDoc, trackId).doc
  for (const [lane, sampleId] of Object.entries(samplesByLane)) {
    doc = setLaneSample(doc, trackId, lane, { sample: sampleId, gainDb: 0, tune: 0 })
  }
  return doc
}

/** Keep only `trackId` (plus the doc's media block) — the drums-only host the kit clip renders
 * from. selectedTrack is repointed so the doc stays valid. */
export function isolateTrack(doc: BeatDocument, trackId: string): BeatDocument {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatBatchError(`no track "${trackId}" to isolate (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  return { ...doc, selectedTrack: trackId, tracks: [track], groups: [], scenes: [], song: null }
}

/** Round-trip a built doc through serialize+parse — a doc this module assembled that does not
 * survive its own format is a builder bug and must fail HERE, not at render time. */
export function serializeChecked(doc: BeatDocument): string {
  const text = serialize(doc)
  parse(text)
  return text
}

// ---- batch assembly ----------------------------------------------------------------------------

export interface ShowdownClip {
  kind: ShowdownSourceKind
  /** absolute path of the prepared clip wav (copied INTO the batch dir as v<n>.wav) */
  wav: string
  /** human-readable provenance: seed+track for engine, prompt for gen/keymap, the ORIGINAL
   * absolute path for ref (a reference — the only place the path is ever recorded) */
  from: string
}

/** Seeded assignment of sources to v-numbers — the first blinding layer (the rate UI shuffles
 * again per batch). Returns clip index per v-number (0-based), deterministic in `seed`. */
export function assignClipOrder(count: number, seed: number): number[] {
  // reuse the audition shuffle (Fisher-Yates over 1..n) with a derived seed so batch-seed reuse
  // by the rate UI's own shuffle never composes back to identity systematically
  return shuffledOrder(count, seed * 7 + 3).map((n) => n - 1)
}

/** Write the showdown batch manifest over v1..vN.wav already sitting in outDir: the clip-set
 * shape (empty parent — score works, adopt refuses) with group `showdown:<role>` and per-variant
 * `source` records. When any clip is a ref, a `.gitignore` covering the whole dir is written too:
 * ref working copies are private derivatives of commercial music and must never land in git even
 * when a collection dir sits inside a repo (docs/source-showdown-eval.md, licensing stance). */
export function writeShowdownBatch(
  outDir: string,
  role: string,
  clips: { file: string; source: { kind: ShowdownSourceKind; from?: string } }[],
  opts: { seed?: number } = {},
): VaryBatchManifest {
  if (clips.length < 2) throw new BeatBatchError('a showdown batch needs at least two source clips')
  for (const c of clips) {
    if (!existsSync(resolve(outDir, c.file))) throw new BeatBatchError(`showdown batch is missing ${resolve(outDir, c.file)}`)
  }
  const manifest: VaryBatchManifest = {
    parent: '',
    parentSha256: '',
    group: `showdown:${role}`,
    count: clips.length,
    seed: opts.seed ?? 41,
    createdAt: new Date().toISOString(),
    variants: clips.map((c) => ({ file: c.file, source: c.source })),
  }
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  if (clips.some((c) => c.source.kind === 'ref')) {
    writeFileSync(resolve(outDir, '.gitignore'), '# showdown batch containing private ref clips — never committed (docs/source-showdown-eval.md)\n*\n')
  }
  return manifest
}

// ---- duration matching (frame math, no DSP) ----------------------------------------------------

interface WavData {
  formatTag: number
  channels: number
  sampleRate: number
  bitsPerSample: number
  blockAlign: number
  data: Uint8Array
}

function readWavData(path: string): WavData {
  const bytes = readFileSync(path)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (off: number, len: number) => String.fromCharCode(...bytes.subarray(off, off + len))
  if (bytes.length < 44 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') throw new BeatBatchError(`${path} is not a RIFF/WAVE file`)
  let off = 12
  let fmt: { formatTag: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null
  let data: Uint8Array | null = null
  while (off + 8 <= bytes.length) {
    const id = ascii(off, 4)
    const size = view.getUint32(off + 4, true)
    if (id === 'fmt ') {
      fmt = {
        formatTag: view.getUint16(off + 8, true),
        channels: view.getUint16(off + 10, true),
        sampleRate: view.getUint32(off + 12, true),
        bitsPerSample: view.getUint16(off + 22, true),
      }
    } else if (id === 'data') {
      data = bytes.subarray(off + 8, off + 8 + Math.min(size, bytes.length - off - 8))
    }
    off += 8 + size + (size % 2)
  }
  if (!fmt || !data) throw new BeatBatchError(`${path}: missing fmt/data chunk`)
  if (fmt.formatTag !== 1 && fmt.formatTag !== 3) throw new BeatBatchError(`${path}: unsupported wav encoding (format ${fmt.formatTag}; need 16-bit PCM or 32-bit float)`)
  const blockAlign = (fmt.bitsPerSample / 8) * fmt.channels
  const wholeFrames = Math.floor(data.length / blockAlign) * blockAlign
  return { ...fmt, blockAlign, data: data.subarray(0, wholeFrames) }
}

function writeWavData(path: string, w: WavData): void {
  const out = new Uint8Array(44 + w.data.length)
  const view = new DataView(out.buffer)
  const writeAscii = (off: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[off + i] = text.charCodeAt(i)
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + w.data.length, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, w.formatTag, true)
  view.setUint16(22, w.channels, true)
  view.setUint32(24, w.sampleRate, true)
  view.setUint32(28, w.sampleRate * w.blockAlign, true)
  view.setUint16(32, w.blockAlign, true)
  view.setUint16(34, w.bitsPerSample, true)
  writeAscii(36, 'data')
  view.setUint32(40, w.data.length, true)
  out.set(w.data, 44)
  writeFileSync(path, out)
}

/** Linear fade-out over the trailing `fadeFrames` frames, in place — a hard trim mid-phrase
 * would click. Handles the same two encodings every other wav-touching module supports. */
function applyFadeOut(w: WavData, fadeFrames: number): void {
  const view = new DataView(w.data.buffer, w.data.byteOffset, w.data.byteLength)
  const totalFrames = w.data.length / w.blockAlign
  const start = Math.max(0, totalFrames - fadeFrames)
  for (let f = start; f < totalFrames; f++) {
    const g = fadeFrames <= 0 ? 0 : (totalFrames - f) / fadeFrames
    for (let c = 0; c < w.channels; c++) {
      const off = f * w.blockAlign + c * (w.bitsPerSample / 8)
      if (w.formatTag === 1 && w.bitsPerSample === 16) view.setInt16(off, Math.round(view.getInt16(off, true) * g), true)
      else if (w.formatTag === 3 && w.bitsPerSample === 32) view.setFloat32(off, view.getFloat32(off, true) * g, true)
    }
  }
}

export const SHOWDOWN_TRIM_FADE_SECONDS = 0.03

export interface DurationMatchResult {
  targetSeconds: number
  clips: { file: string; action: 'kept' | 'trimmed' | 'padded'; fromSeconds: number; toSeconds: number }[]
}

/** Rough duration matching for one batch: trim every clip longer than the target (with a short
 * fade at the cut), zero-pad every clip shorter. Default target = the SHORTEST clip, so nothing
 * is ever padded unless --seconds asks for more. Sample rates/encodings may differ per clip
 * (engine renders vs generated audio) — each file is matched in its own format; only `beat rate`
 * needs to play them, and it plays files individually. */
export function matchClipDurations(outDir: string, files: string[], opts: { targetSeconds?: number } = {}): DurationMatchResult {
  if (files.length === 0) throw new BeatBatchError('duration matching needs at least one clip')
  const wavs = files.map((f) => readWavData(resolve(outDir, f)))
  const seconds = wavs.map((w) => w.data.length / w.blockAlign / w.sampleRate)
  const targetSeconds = opts.targetSeconds ?? Math.min(...seconds)
  if (!(targetSeconds > 0)) throw new BeatBatchError(`duration-match target must be positive, got ${targetSeconds}`)
  const clips: DurationMatchResult['clips'] = []
  for (let i = 0; i < files.length; i++) {
    const w = wavs[i]!
    const from = seconds[i]!
    const targetFrames = Math.round(targetSeconds * w.sampleRate)
    const haveFrames = w.data.length / w.blockAlign
    if (Math.abs(haveFrames - targetFrames) <= w.sampleRate * 0.01) {
      clips.push({ file: files[i]!, action: 'kept', fromSeconds: round2(from), toSeconds: round2(from) })
      continue
    }
    if (haveFrames > targetFrames) {
      const trimmed: WavData = { ...w, data: w.data.subarray(0, targetFrames * w.blockAlign) }
      applyFadeOut(trimmed, Math.round(SHOWDOWN_TRIM_FADE_SECONDS * w.sampleRate))
      writeWavData(resolve(outDir, files[i]!), trimmed)
      clips.push({ file: files[i]!, action: 'trimmed', fromSeconds: round2(from), toSeconds: round2(targetFrames / w.sampleRate) })
    } else {
      const padded = new Uint8Array(targetFrames * w.blockAlign)
      padded.set(w.data, 0)
      writeWavData(resolve(outDir, files[i]!), { ...w, data: padded })
      clips.push({ file: files[i]!, action: 'padded', fromSeconds: round2(from), toSeconds: round2(targetFrames / w.sampleRate) })
    }
  }
  return { targetSeconds: round2(targetSeconds), clips }
}

const round2 = (x: number) => Math.round(x * 100) / 100

// ---- reporting ---------------------------------------------------------------------------------

export interface ShowdownLogEntry {
  role: string
  batch: string
  /** ranked pick files, best first */
  picks: string[]
  rejected: string[]
  /** variant file -> source kind */
  sources: Record<string, string>
}

/** Scored showdown entries from the log: `showdown:<role>` groups only, latest entry per batch
 * dir (same supersede rule as the taste harness), entries without a sources map skipped (they
 * cannot be attributed). */
export function loadShowdownEntries(logPath: string): { entries: ShowdownLogEntry[]; skipped: number } {
  let text: string
  try {
    text = readFileSync(logPath, 'utf8')
  } catch {
    return { entries: [], skipped: 0 }
  }
  const latest = new Map<string, { group: string; picks: { rank: number; variant: string }[]; rejected?: string[]; sources?: Record<string, string> }>()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: { batch?: string; group?: string; picks?: { rank: number; variant: string }[]; rejected?: string[]; sources?: Record<string, string> }
    try {
      raw = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof raw.batch !== 'string' || typeof raw.group !== 'string' || !raw.group.startsWith('showdown:')) continue
    if (!Array.isArray(raw.picks) || raw.picks.length === 0) continue
    latest.set(raw.batch, { group: raw.group, picks: raw.picks, rejected: raw.rejected, sources: raw.sources })
  }
  const entries: ShowdownLogEntry[] = []
  let skipped = 0
  for (const [batch, e] of latest) {
    if (e.sources === undefined || Object.keys(e.sources).length === 0) {
      skipped += 1
      continue
    }
    entries.push({
      role: e.group.slice('showdown:'.length),
      batch,
      picks: [...e.picks].sort((a, b) => a.rank - b.rank).map((p) => p.variant),
      rejected: Array.isArray(e.rejected) ? e.rejected : [],
      sources: e.sources,
    })
  }
  return { entries, skipped }
}

export interface SourceStat {
  kind: string
  /** batches this source appeared in */
  batches: number
  /** rank-1 picks */
  wins: number
  /** placed in the top half of the batch (rank <= ceil(n/2) among the ranked picks) */
  topHalf: number
  /** implied pairwise comparisons won / total (picks beat later picks and all rejects) */
  pairsWon: number
  pairCount: number
}

export interface ShowdownReport {
  logPath: string
  totalBatches: number
  /** entries without a sources map (pre-showdown clip-set scores that happened to use the group) */
  skipped: number
  overall: SourceStat[]
  roles: { role: string; batches: number; smoke: boolean; stats: SourceStat[] }[]
  smokeMinBatches: number
}

function tally(entries: ShowdownLogEntry[]): SourceStat[] {
  const stats = new Map<string, SourceStat>()
  const stat = (kind: string): SourceStat => {
    if (!stats.has(kind)) stats.set(kind, { kind, batches: 0, wins: 0, topHalf: 0, pairsWon: 0, pairCount: 0 })
    return stats.get(kind)!
  }
  for (const e of entries) {
    const kinds = new Set(Object.values(e.sources))
    for (const k of kinds) stat(k).batches += 1
    const n = Object.keys(e.sources).length
    const topHalfRanks = Math.ceil(n / 2)
    const winner = e.sources[e.picks[0]!]
    if (winner !== undefined) stat(winner).wins += 1
    for (let i = 0; i < Math.min(topHalfRanks, e.picks.length); i++) {
      const k = e.sources[e.picks[i]!]
      if (k !== undefined) stat(k).topHalf += 1
    }
    // implied pairwise comparisons: each ranked pick beats every later pick and every reject
    for (let wi = 0; wi < e.picks.length; wi++) {
      const w = e.sources[e.picks[wi]!]
      if (w === undefined) continue
      const losers = [...e.picks.slice(wi + 1), ...e.rejected].map((f) => e.sources[f]).filter((k): k is string => k !== undefined)
      for (const l of losers) {
        stat(w).pairsWon += 1
        stat(w).pairCount += 1
        stat(l).pairCount += 1
      }
    }
  }
  // sort by win rate (then pairwise) so the scoreboard reads best-first
  return [...stats.values()].sort((a, b) => b.wins / Math.max(1, b.batches) - a.wins / Math.max(1, a.batches) || b.pairsWon / Math.max(1, b.pairCount) - a.pairsWon / Math.max(1, a.pairCount))
}

/** The scoreboard: per-source win rates from every scored showdown batch, overall and per role,
 * with the same small-n smoke convention as taste-eval's splits. */
export function computeShowdownReport(logPath: string): ShowdownReport {
  const { entries, skipped } = loadShowdownEntries(logPath)
  const roles = [...new Set(entries.map((e) => e.role))].sort().map((role) => {
    const roleEntries = entries.filter((e) => e.role === role)
    return { role, batches: roleEntries.length, smoke: roleEntries.length < SPLIT_SMOKE_MIN_BATCHES, stats: tally(roleEntries) }
  })
  return {
    logPath,
    totalBatches: entries.length,
    skipped,
    overall: tally(entries),
    roles,
    smokeMinBatches: SPLIT_SMOKE_MIN_BATCHES,
  }
}

const pct = (num: number, den: number) => (den === 0 ? '—' : `${Math.round((100 * num) / den)}%`)

function statLine(s: SourceStat, indent: string): string {
  return (
    `${indent}${s.kind.padEnd(7)} win ${pct(s.wins, s.batches)} (${s.wins}/${s.batches})` +
    `  top-half ${pct(s.topHalf, s.batches)} (${s.topHalf}/${s.batches})` +
    `  pairwise ${pct(s.pairsWon, s.pairCount)} of ${s.pairCount}\n`
  )
}

/** Human-facing scoreboard, honest about sample size (smoke labels per role AND overall). */
export function formatShowdownReport(r: ShowdownReport): string {
  let out = `source showdown — per-source win rates over ${r.totalBatches} scored showdown batch(es) in ${r.logPath}\n`
  if (r.skipped > 0) out += `(${r.skipped} showdown-group entr${r.skipped === 1 ? 'y' : 'ies'} skipped: no per-variant source record)\n`
  if (r.totalBatches === 0) {
    out += 'nothing scored yet — collect a round (beat showdown <dir>) and rate it (beat rate <dir>) first\n'
    return out
  }
  out += `overall${r.totalBatches < r.smokeMinBatches ? '  [small n — smoke, not evidence]' : ''}:\n`
  for (const s of r.overall) out += statLine(s, '  ')
  out += `by role:\n`
  for (const role of r.roles) {
    out += `  ${role.role} (${role.batches} batch${role.batches === 1 ? '' : 'es'})${role.smoke ? '  [small n — smoke, not evidence]' : ''}\n`
    for (const s of role.stats) out += statLine(s, '    ')
  }
  out += `(win = ranked best; top-half = ranked in the top ceil(n/2) picks; pairwise = implied comparisons won; ref clips are counted by KIND only — their identity stays in the batch dir)\n`
  return out
}
