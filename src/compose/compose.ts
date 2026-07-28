// `beat compose` / `beat_compose` — the missing VERB between dotbeat's two composition engines and
// an ordinary project.
//
// Both engines already existed and both worked: the theory layer (theory.ts — archetype banks over
// a deterministic chord track, gated by lintFigure) and Composer's Assistant 2 (ca2.ts — a neural
// MIDI infiller over the same chord track). Neither was reachable except from `beat showdown`,
// whose job is BLIND ENGINE COMPARISON, not authoring. Producing a real song on 2026-07-27 the
// owner needed arp figures for an existing 9-section project and had to hand-roll rule-based cells
// in a throwaway Python script, because there was no way to say "compose a figure into THIS track
// of THIS project". This module is that way, and it is ONE module because the operation is exposed
// on two surfaces (CLI + MCP) and the house rule is that shared logic lives in one src/ helper both
// import (CLAUDE.md, "parity is structural, never disciplinary").
//
// Three things the showdown never had to solve, because it always composed into a fresh 4-bar seed:
//
//  1. KEY. A figure composed in the theory layer's own key fights a song already written in
//     another one. Resolution order here is explicit > the track's DECLARED scale > the document's
//     other declared scales > inferSeedKey's pitch-class histogram — and the chosen source is
//     always printed, so a guessed key is never silent.
//
//  2. REGISTER. theory.ts composes leads around key.root + 24 with key.root folded into 48..59; a
//     track already written an octave up lands an octave below its own material. Default `auto`
//     shifts the figure by WHOLE OCTAVES (never anything else — that would break the diatonic
//     work the engines just did) to sit closest to the target's own median pitch.
//
//  3. CLIPS. In song mode the engine renders a track's CLIPS, never its live notes
//     (ui/src/audio/engine.ts contentOf) — so composing notes without re-snapshotting the clips
//     that carry them produces variants that render BYTE-IDENTICAL to the parent. That cost the
//     owner two full board renders on 2026-07-27, caught only because all eight variants measured
//     identically. Here it is the default behavior, it is reported line by line, and refusing it
//     (`clipSync: false`) prints a loud warning that the render will not change.
//     Pinned by test/compose-verb.test.ts, whose negative control is exactly the unfixed behavior.

import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import type { BeatDocument, BeatNote, BeatTrack } from '../core/document.js'
import { NOTE_FIELD_DEFAULTS, SCALES, saveClip } from '../core/index.js'
import { BeatBatchError, defaultBatchDir, writeVaryBatch, type VaryBatchManifest } from '../vary/batch.js'
import { CA2_SETUP_HINT, composeCA2Phrase, isCA2Role, type CA2Role } from './ca2.js'
import { THEORY_ROLE_BANKS, composeTheoryPhrase, type LintReport } from './theory.js'
import { applyComposedPhrase, inferSeedKey } from './apply.js'
import type { ComposedNote, PhraseKey, ScaleMode } from './phrase.js'

export type ComposeSource = 'theory' | 'ca2'
export type ComposeRole = 'lead' | 'bassline' | 'chords'

export const COMPOSE_SOURCES: readonly ComposeSource[] = ['theory', 'ca2']
export const COMPOSE_ROLES: readonly ComposeRole[] = ['lead', 'bassline', 'chords']
/** The modes the theory layer actually speaks (phrase.ts ScaleMode) — `minor` is spelled the way
 * the rest of the CLI spells it (`beat scale`'s SCALES table), and maps to natural-minor. */
export const COMPOSE_MODES: readonly string[] = ['major', 'minor', 'natural-minor', 'phrygian', 'dorian']

export interface ComposeOptions {
  doc: BeatDocument
  trackId: string
  source: ComposeSource
  /** default: inferred from the track's id/name (bass|sub -> bassline, chord|pad|keys|stab -> chords, else lead) */
  role?: ComposeRole
  seed: number
  /** pin the figure: a theory archetype name, or a CA2 ask name (bare, un-prefixed) */
  archetype?: string
  /** figure length in bars (default 4 — the chord track's own default) */
  bars?: number
  /** explicit key root as a pitch class 0-11; overrides all inference */
  keyRoot?: number
  /** explicit mode; overrides the inferred tonality */
  mode?: ScaleMode
  /** 'auto' (default) matches the target's own median pitch by whole octaves; 'source' leaves the
   * engine's register alone; a number is an explicit whole-OCTAVE shift. */
  register?: 'auto' | 'source' | number
  /** default false: replace the track's notes. true keeps them and adds the figure alongside. */
  append?: boolean
  /** default true: re-snapshot the clips carrying this track's content (song mode only) */
  clipSync?: boolean
  /** restrict the re-snapshot to these clip ids (default: every clip the track is placed under) */
  clips?: readonly string[]
}

export interface ComposeResult {
  doc: BeatDocument
  /** the figure's label — 'theory:<archetype>' or 'ca2:<ask>' */
  label: string
  role: ComposeRole
  key: PhraseKey
  keySource: string
  bars: number
  /** whole-octave shift applied to the composed figure to land it on the target track */
  octaveShift: number
  notes: number
  lint: LintReport
  /** clip ids re-snapshotted from the freshly composed notes (empty in loop mode) */
  clipsSnapshotted: string[]
  /** the human-readable report both surfaces print verbatim */
  lines: string[]
}

// ---- key ----------------------------------------------------------------------------------------

/** A BeatScale name -> the theory layer's ScaleMode, for the four modes it can actually compose in.
 * Anything else (harmonicMinor, the pentatonics, blues, the third-less sets) has no ScaleMode twin,
 * so only its TONALITY is taken: a scale containing a minor third reads minor, a major third major,
 * and a third-less set states nothing at all and falls through to the histogram. */
function modeOfScaleName(name: string): { mode?: ScaleMode; minor?: boolean } {
  switch (name) {
    case 'major':
      return { mode: 'major', minor: false }
    case 'minor':
      return { mode: 'natural-minor', minor: true }
    case 'dorian':
      return { mode: 'dorian', minor: true }
    case 'phrygian':
      return { mode: 'phrygian', minor: true }
    default: {
      const pcs = SCALES[name]
      if (!pcs) return {}
      if (pcs.includes(3)) return { minor: true }
      if (pcs.includes(4)) return { minor: false }
      return {}
    }
  }
}

export function parseComposeMode(value: string): ScaleMode {
  const v = value.trim().toLowerCase()
  if (v === 'minor' || v === 'natural-minor') return 'natural-minor'
  if (v === 'major' || v === 'phrygian' || v === 'dorian') return v
  throw new BeatBatchError(`unknown mode "${value}" (have: ${COMPOSE_MODES.join(', ')})`)
}

/** Pitch class 0-11 from a liberal note name (c, C#, db, Eb3 — any octave digits are ignored, a key
 * is a pitch class). Also accepts a bare 0-11 so `--key 3` works like analyze-structure's --root. */
export function parseKeyRoot(value: string): number {
  const raw = value.trim()
  if (/^\d+$/.test(raw)) {
    const pc = Number(raw)
    if (pc < 0 || pc > 11) throw new BeatBatchError(`key as a pitch class must be 0-11 (0=C), got "${value}"`)
    return pc
  }
  const m = /^([a-gA-G])([#b]?)-?\d*$/.exec(raw)
  if (!m) throw new BeatBatchError(`unparseable key "${value}" — use a note name (d#, Eb, f) or a pitch class 0-11 (0=C)`)
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1]!.toLowerCase()]!
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  return ((base + acc) % 12 + 12) % 12
}

const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export function keyLabel(key: PhraseKey): string {
  const pc = ((key.root % 12) + 12) % 12
  const mode = key.mode ?? (key.minor ? 'natural-minor' : 'major')
  return `${PITCH_CLASS_NAMES[pc]} ${mode}`
}

/** Resolve the key to compose in, most-explicit first, reporting WHICH source won so a guessed key
 * is never silent. A declared `scale` on the target track beats one on another track, which beats
 * the pitch-class histogram — a scale line is an author's statement, the histogram is an inference. */
export function resolveComposeKey(
  doc: BeatDocument,
  trackId: string,
  opts: { keyRoot?: number; mode?: ScaleMode },
): { key: PhraseKey; source: string } {
  const track = doc.tracks.find((t) => t.id === trackId)
  const declared = track?.scale ?? doc.tracks.find((t) => t.scale)?.scale ?? null
  const declaredOn = track?.scale ? trackId : doc.tracks.find((t) => t.scale)?.id
  let root: number | undefined = opts.keyRoot
  let mode: ScaleMode | undefined = opts.mode
  let minor: boolean | undefined = mode ? mode !== 'major' : undefined
  const from: string[] = []
  if (opts.keyRoot !== undefined) from.push('--key')
  if (opts.mode !== undefined) from.push('--mode')
  if (root === undefined && declared) {
    root = declared.root
    from.push(`the "${declaredOn}" track's declared scale (${PITCH_CLASS_NAMES[declared.root]!} ${declared.name})`)
  }
  if (minor === undefined && declared) {
    const m = modeOfScaleName(declared.name)
    if (m.mode !== undefined) mode = m.mode
    if (m.minor !== undefined) {
      minor = m.minor
      if (!from.some((f) => f.startsWith('the "'))) from.push(`the "${declaredOn}" track's declared scale (${declared.name})`)
    }
  }
  if (root === undefined || minor === undefined) {
    // The histogram is read over the REST of the song, with the target track's own notes dropped —
    // they are the notes about to be replaced, so letting them vote makes the key drift with each
    // pass. Measured on the real project 2026-07-27: composing into `arp` and immediately composing
    // again read D# natural-minor the first time and G# natural-minor the second, purely because
    // the first figure's own pitch classes had joined the count. Dropped only when something else
    // is pitched: on a one-track project the target IS the song, and an empty histogram throws.
    // The bar for "the rest of the song can carry the key alone" is 3 distinct pitch classes: a
    // bass part sitting on one root says nothing about major vs minor (dropping the only melodic
    // track then flips the answer), so below that the whole document votes, target included.
    const otherPcs = new Set<number>()
    for (const t of doc.tracks) {
      if (t.id === trackId || t.kind !== 'synth') continue
      for (const n of t.notes) otherPcs.add(((n.pitch % 12) + 12) % 12)
    }
    const excludeTarget = otherPcs.size >= 3
    const context = excludeTarget ? { ...doc, tracks: doc.tracks.filter((t) => t.id !== trackId) } : doc
    const inferred = inferSeedKey(context)
    if (root === undefined) root = ((inferred.root % 12) + 12) % 12
    if (minor === undefined) minor = inferred.minor
    from.push(
      excludeTarget
        ? `the rest of the song's pitch-class histogram ("${trackId}" excluded — its notes are what you are replacing)`
        : `the project's pitch-class histogram (nothing outside "${trackId}" carries enough pitch to read a key from)`,
    )
  }
  const key: PhraseKey = { root: 48 + root, minor, ...(mode !== undefined ? { mode } : {}) }
  return { key, source: from.join(' + ') }
}

// ---- role and register --------------------------------------------------------------------------

/** Infer the role from what the track is CALLED. Deliberately name-based rather than register-based:
 * a track's id/name is the author's own statement of intent, while its current pitch range is just
 * whatever is in it today (and an empty track has none at all). */
export function inferComposeRole(track: BeatTrack): { role: ComposeRole; why: string } {
  const hay = `${track.id} ${track.name}`.toLowerCase()
  if (/(bass|sub|808)/.test(hay)) return { role: 'bassline', why: `"${track.id}" reads as a bass part` }
  if (/(chord|pad|key|stab|harmon|string|organ)/.test(hay)) return { role: 'chords', why: `"${track.id}" reads as a chordal part` }
  return { role: 'lead', why: `"${track.id}" has no bass/chord marker, so the melodic role` }
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 === 1 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}

/** The pitches the target track already sounds — its live notes, or (when live is empty but the
 * project is in song mode) the notes of the clips it is placed under. A track whose live buffer was
 * never populated still has a register, and it is the one the listener hears. */
export function targetPitches(doc: BeatDocument, track: BeatTrack, clipIds: readonly string[]): number[] {
  if (track.kind !== 'synth') return []
  if (track.notes.length > 0) return track.notes.map((n) => n.pitch)
  const out: number[] = []
  for (const id of clipIds) {
    const clip = track.clips.find((c) => c.id === id)
    if (clip) for (const n of clip.notes) out.push(n.pitch)
  }
  if (out.length > 0) return out
  for (const clip of track.clips) for (const n of clip.notes) out.push(n.pitch)
  return out
}

/** Whole-octave shift landing `notes` closest to the register the target already occupies. Whole
 * octaves ONLY: any other interval would undo the diatonic work theory.ts/ca2.ts just did. Returns
 * 0 when the target has no pitched content to match (nothing to match against is not a licence to
 * guess) or when the shift would push a note out of MIDI range. */
export function octaveShiftFor(notes: readonly ComposedNote[], target: readonly number[]): number {
  if (notes.length === 0 || target.length === 0) return 0
  const raw = (median(target) - median(notes.map((n) => n.pitch))) / 12
  const shift = Math.round(raw)
  if (shift === 0) return 0
  const lo = Math.min(...notes.map((n) => n.pitch)) + shift * 12
  const hi = Math.max(...notes.map((n) => n.pitch)) + shift * 12
  if (lo < 0 || hi > 127) return 0
  return shift
}

// ---- clips ---------------------------------------------------------------------------------------

/** Every clip id the track is placed under across the scenes the SONG actually visits, in song
 * order and deduped. This is the set the engine can play for the track (engine.ts contentOf); a
 * clip the song never reaches is not part of the render and is deliberately not touched. Empty in
 * loop mode, where the engine plays the live notes directly. */
export function placedClipIds(doc: BeatDocument, trackId: string): string[] {
  if (!doc.song || doc.song.length === 0) return []
  const out: string[] = []
  for (const section of doc.song) {
    const scene = doc.scenes.find((s) => s.id === section.scene)
    if (!scene) continue
    for (const p of scene.slots[trackId] ?? []) if (!out.includes(p.clip)) out.push(p.clip)
  }
  return out
}

// ---- the figure ----------------------------------------------------------------------------------

/** Compose one figure, apply the register match, and hand back the notes plus their provenance.
 * Separated from the document surgery below so the batch path can compose N of these and dedupe
 * them BEFORE any of them touches a document. */
export async function composeFigure(
  source: ComposeSource,
  role: ComposeRole,
  key: PhraseKey,
  seed: number,
  opts: { archetype?: string; bars?: number; bpm?: number } = {},
): Promise<{ label: string; notes: ComposedNote[]; lint: LintReport }> {
  const chordTrack = opts.bars !== undefined ? { bars: opts.bars } : {}
  if (source === 'ca2') {
    if (!isCA2Role(role)) throw new BeatBatchError(`CA2 does not compose the "${role}" role`)
    const phrase = await composeCA2Phrase(role as CA2Role, key, seed, {
      chordTrack,
      ...(opts.bpm !== undefined ? { bpm: opts.bpm } : {}),
      ...(opts.archetype !== undefined ? { ask: opts.archetype } : {}),
    })
    return { label: phrase.archetype, notes: phrase.notes, lint: phrase.lint }
  }
  const phrase = composeTheoryPhrase(role, key, seed, {
    chordTrack,
    ...(opts.archetype !== undefined ? { archetype: opts.archetype } : {}),
  })
  return { label: phrase.archetype, notes: phrase.notes, lint: phrase.lint }
}

/** Append-mode note ids: `cp<n>` is what applyComposedPhrase mints for a REPLACE, so an appended
 * figure uses its own `cf<n>` prefix — the two can then coexist on one track without colliding, and
 * the prefix says which pass put a note there. */
function appendNotes(existing: readonly BeatNote[], notes: readonly ComposedNote[]): BeatNote[] {
  const taken = new Set(existing.map((n) => n.id))
  let next = 1
  const added: BeatNote[] = notes.map((n) => {
    while (taken.has(`cf${next}`)) next += 1
    const id = `cf${next}`
    taken.add(id)
    return { id, pitch: n.pitch, start: n.start, duration: n.duration, velocity: n.velocity, ...NOTE_FIELD_DEFAULTS }
  })
  return [...existing, ...added].sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}

/** Compose a figure into one track of one document: key/role/register resolution, the note write,
 * and — the whole reason this is a verb and not three commands — the song-mode clip re-snapshot. */
export async function composeIntoDoc(opts: ComposeOptions): Promise<ComposeResult> {
  const track = opts.doc.tracks.find((t) => t.id === opts.trackId)
  if (!track) {
    throw new BeatBatchError(`no track "${opts.trackId}" (have: ${opts.doc.tracks.map((t) => t.id).join(', ')})`)
  }
  if (track.kind !== 'synth') {
    throw new BeatBatchError(
      `compose writes pitched figures, and track "${opts.trackId}" is a ${track.kind} track — ` +
        `for drums use \`beat gen-kit\` or \`beat drum-kit\` + \`beat add-hit\``,
    )
  }
  const roleInfo = opts.role ? { role: opts.role, why: 'stated with --role' } : inferComposeRole(track)
  const role = roleInfo.role
  if (opts.archetype !== undefined && opts.source === 'theory' && !THEORY_ROLE_BANKS[role].includes(opts.archetype as never)) {
    throw new BeatBatchError(`unknown theory archetype "${opts.archetype}" for role ${role} (have: ${THEORY_ROLE_BANKS[role].join(', ')})`)
  }
  const { key, source: keySource } = resolveComposeKey(opts.doc, opts.trackId, {
    ...(opts.keyRoot !== undefined ? { keyRoot: opts.keyRoot } : {}),
    ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
  })
  const bars = opts.bars ?? 4
  const figure = await composeFigure(opts.source, role, key, opts.seed, {
    ...(opts.archetype !== undefined ? { archetype: opts.archetype } : {}),
    bars,
    bpm: opts.doc.bpm,
  })

  const placed = placedClipIds(opts.doc, opts.trackId)
  const requested = opts.clips !== undefined ? [...opts.clips] : placed
  if (opts.clips !== undefined) {
    for (const id of requested) {
      if (!track.clips.some((c) => c.id === id)) {
        throw new BeatBatchError(`track "${opts.trackId}" has no clip "${id}" (have: ${track.clips.map((c) => c.id).join(', ') || 'none'})`)
      }
    }
  }

  // register match happens against the material that is actually there, live notes or placed clips
  const shift = opts.register === 'source' ? 0 : typeof opts.register === 'number' ? opts.register : octaveShiftFor(figure.notes, targetPitches(opts.doc, track, requested))
  const notes = shift === 0 ? figure.notes : figure.notes.map((n) => ({ ...n, pitch: n.pitch + shift * 12 }))

  const lines: string[] = []
  lines.push(`${opts.trackId}: ${figure.label} (${role}, ${bars} bars, seed ${opts.seed})`)
  lines.push(`key ${keyLabel(key)} — from ${keySource}`)
  if (shift !== 0) lines.push(`register: shifted ${shift > 0 ? '+' : ''}${shift} octave(s) to match ${opts.trackId}'s own range`)
  else if (opts.register === 'source') lines.push(`register: left at the ${opts.source} layer's own (--register source)`)
  else lines.push(`register: already matches ${opts.trackId}'s range — no shift`)
  if (figure.lint.flags.length > 0) lines.push(`lint: ${figure.lint.flags.join(', ')}`)

  let doc = opts.append === true
    ? { ...opts.doc, tracks: opts.doc.tracks.map((t) => (t.id === opts.trackId && t.kind === 'synth' ? { ...t, notes: appendNotes(t.notes, notes) } : t)) }
    : applyComposedPhrase(opts.doc, opts.trackId, { archetype: figure.label, notes })
  lines.push(`${opts.append === true ? 'appended' : 'replaced'} ${opts.trackId}'s notes: ${notes.length} note(s)`)

  // ---- the song-mode clip re-snapshot ----
  // An EXPLICIT `clips` list is honored in loop mode too: the caller named the clips, and a clip a
  // loop-mode project keeps around is usually one it is about to arrange with. Only the DEFAULT
  // set is song-derived, because only the song can say which clips are actually rendered.
  const clipsSnapshotted: string[] = []
  const songMode = doc.song !== null && doc.song.length > 0
  if (opts.clipSync === false && !songMode) {
    // loop mode renders the live notes, so opting out of a clip sync changes nothing audible
  } else if (songMode && opts.clipSync === false) {
    lines.push(
      `WARNING: --no-clip-sync on a SONG-MODE project — the engine renders this track's CLIPS ` +
        `(${placed.join(', ') || 'none placed'}), not its live notes, so this compose will render ` +
        `IDENTICALLY to the parent. Re-snapshot with: beat clip <file> ${opts.trackId} <clip-id>`,
    )
  } else {
    if (songMode && requested.length === 0) {
      lines.push(
        `WARNING: song mode, but "${opts.trackId}" is placed in no scene the song visits — nothing ` +
          `to re-snapshot, and the composed notes will not be heard until the track is placed ` +
          `(beat place <file> <scene> ${opts.trackId} <clip-id>).`,
      )
    }
    for (const clipId of requested) {
      doc = saveClip(doc, opts.trackId, clipId).doc
      clipsSnapshotted.push(clipId)
    }
    if (clipsSnapshotted.length > 0) {
      lines.push(
        `re-snapshotted ${clipsSnapshotted.length} clip(s) from the new notes: ${clipsSnapshotted.join(', ')}` +
          (songMode ? ' (song mode renders clips, not live notes)' : ' (as asked — this project is in loop mode, where the engine plays the live notes)'),
      )
    }
    if (opts.clips === undefined && clipsSnapshotted.length > 1) {
      lines.push(
        `note: "${opts.trackId}" plays ${clipsSnapshotted.length} distinct clips and ALL of them now ` +
          `carry the new figure — any per-clip rendition (a softer velocity copy, a variation) is ` +
          `overwritten. Pass --clip <id> to compose into one of them only.`,
      )
    }
  }

  return {
    doc,
    label: figure.label,
    role,
    key,
    keySource,
    bars,
    octaveShift: shift,
    notes: notes.length,
    lint: figure.lint,
    clipsSnapshotted,
    lines,
  }
}

// ---- batches -------------------------------------------------------------------------------------

/** Stride between variant seeds — a large odd number, so neighbouring variants are nowhere near
 * each other in the generator's seed space (the same posture ca2.ts's RESEED_STRIDE takes). */
const COMPOSE_SEED_STRIDE = 6151
/** How many extra seeds a batch may burn looking for a figure it has not already produced, per
 * variant asked for. A batch that emits the same figure eight times is not an option board. */
const COMPOSE_DEDUPE_BUDGET = 8

/** The identity of a FIGURE for dedupe: its notes, not its label. Two different archetypes that
 * happen to realize the same notes are the same option to a listener. */
const figureKey = (notes: readonly { pitch: number; start: number; duration: number; velocity: number }[]): string =>
  createHash('sha256').update(notes.map((n) => `${n.pitch}:${n.start}:${n.duration}:${n.velocity}`).join('|')).digest('hex')

export interface ComposeBatchOptions extends Omit<ComposeOptions, 'doc'> {
  parentPath: string
  parentText: string
  doc: BeatDocument
  count: number
  outDir?: string
}

export interface ComposeBatchResult {
  outDir: string
  manifest: VaryBatchManifest
  lines: string[]
  variants: { doc: BeatDocument; recipe: string }[]
}

/** `compose-<source>-<track>-<seed>` NEXT TO the .beat file — the same "batches live beside their
 * parent, not under the process cwd" rule defaultBatchDir/defaultGenBatchDir follow (pilot 101). */
export function defaultComposeBatchDir(parentPath: string, source: ComposeSource, trackId: string, seed: number): string {
  return join(dirname(resolve(parentPath)), `compose-${source}-${trackId}-${seed}`)
}

/** N genuinely different figures into a `beat board`-servable batch directory. Archetypes are SWEPT
 * (variant i takes bank[i % bank.length]) rather than left to the per-seed draw, and identical
 * figures are rejected and re-seeded — a board of eight identical options is the failure mode this
 * exists to avoid. */
export async function composeBatch(opts: ComposeBatchOptions): Promise<ComposeBatchResult> {
  if (!Number.isInteger(opts.count) || opts.count < 1 || opts.count > 32) {
    throw new BeatBatchError(`compose --count must be an integer 1-32, got ${opts.count}`)
  }
  const track = opts.doc.tracks.find((t) => t.id === opts.trackId)
  if (!track) throw new BeatBatchError(`no track "${opts.trackId}" (have: ${opts.doc.tracks.map((t) => t.id).join(', ')})`)
  const role = opts.role ?? inferComposeRole(track).role
  const bank = opts.source === 'theory' ? THEORY_ROLE_BANKS[role] : null
  const outDir = opts.outDir ?? defaultComposeBatchDir(opts.parentPath, opts.source, opts.trackId, opts.seed)

  const variants: { doc: BeatDocument; recipe: string }[] = []
  const lines: string[] = []
  const seen = new Set<string>()
  let attempts = 0
  const maxAttempts = opts.count * COMPOSE_DEDUPE_BUDGET
  let duplicates = 0
  while (variants.length < opts.count && attempts < maxAttempts) {
    const i = variants.length
    const seed = opts.seed + attempts * COMPOSE_SEED_STRIDE
    attempts += 1
    // sweep the bank so consecutive variants are different KINDS of figure, not just different
    // realizations of whatever the seed happened to draw (an explicit --archetype pins all N)
    const archetype = opts.archetype ?? (bank ? bank[i % bank.length]! : undefined)
    const composed = await composeIntoDoc({
      ...opts,
      seed,
      ...(archetype !== undefined ? { archetype } : {}),
    })
    const composedTrack = composed.doc.tracks.find((t) => t.id === opts.trackId)!
    const key = figureKey(composedTrack.kind === 'synth' ? composedTrack.notes : [])
    if (seen.has(key)) {
      duplicates += 1
      continue
    }
    seen.add(key)
    const recipe = `compose ${opts.source} ${composed.label} role ${composed.role} key ${keyLabel(composed.key)} bars ${composed.bars} seed ${seed}${composed.octaveShift !== 0 ? ` octave ${composed.octaveShift > 0 ? '+' : ''}${composed.octaveShift}` : ''}`
    variants.push({ doc: composed.doc, recipe })
    if (variants.length === 1) {
      // Batch-INVARIANT provenance only, printed once. Key and clip handling are identical across
      // the batch by construction; register shift and note count are NOT (they follow the figure),
      // so they live in each variant's own recipe line above rather than in a header that would be
      // true of v1 and quietly wrong about the rest.
      lines.push(`key ${keyLabel(composed.key)} — from ${composed.keySource}`)
      lines.push(`role ${composed.role}, ${composed.bars} bars, register ${opts.register === 'source' ? 'left at the source layer' : typeof opts.register === 'number' ? `shifted ${opts.register} octave(s)` : "matched to the track's own range per variant"}`)
      for (const line of composed.lines) {
        if (line.startsWith('re-snapshotted') || line.startsWith('WARNING') || line.startsWith('note:')) lines.push(line)
      }
    }
  }
  if (variants.length < opts.count) {
    throw new BeatBatchError(
      `compose could only find ${variants.length} distinct figure(s) in ${attempts} attempts (asked for ${opts.count}) — ` +
        `the ${opts.source} layer is repeating itself for role ${role}${opts.archetype ? ` pinned to "${opts.archetype}"` : ''}; ` +
        `try a smaller --count, a different --seed, or drop --archetype`,
    )
  }

  const manifest = writeVaryBatch({
    parentPath: opts.parentPath,
    parentText: opts.parentText,
    track: opts.trackId,
    group: `compose:${opts.source}`,
    count: variants.length,
    seed: opts.seed,
    outDir,
    figureSource: opts.source,
    variants,
  })
  const head = [`${outDir}/: ${variants.length} composed variants of ${opts.trackId} (${opts.source}, seed ${opts.seed})`]
  for (let i = 0; i < variants.length; i++) head.push(`  v${i + 1}: ${variants[i]!.recipe}`)
  if (duplicates > 0) head.push(`(${duplicates} duplicate figure(s) rejected and re-seeded — every variant on this board is a different figure)`)
  return { outDir, manifest, lines: [...head, ...lines], variants }
}

/** The refusal text for `--source ca2` where CA2 is not installed. Kept here so both surfaces refuse
 * identically, and it names the doctor rather than describing the install (the doctor is the thing
 * that actually knows). */
export function ca2UnavailableMessage(detail: string): string {
  return `compose --source ca2 needs a working Composer's Assistant 2 install: ${detail}\n${CA2_SETUP_HINT}`
}
