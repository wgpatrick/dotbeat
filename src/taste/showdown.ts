// Source-showdown eval (docs/source-showdown-eval.md): a standing, blind, per-musical-role
// comparison of WHERE good sound comes from. Each showdown batch is ONE role (bassline / chords /
// lead / drum-loop) × one clip per SOURCE PIPELINE:
//
//   engine  — the role's phrase from a taste-seed song, soloed, rendered through dotbeat's own
//             synth engine (the "can our synth carry this part?" baseline)
//   engineplus — (opt-in, --with-produced) the SAME figure through the SAME patch plus a
//             production pass expressed as ordinary .beat edits (width/air/glue — see
//             applyProductionTreatment) — the ablation separating "bad synth" from "no production"
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
import { join, resolve } from 'node:path'
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
import { NOTE_FIELD_DEFAULTS } from '../core/index.js'
import { applyProducedDefaults, type ProductionProfile } from '../analysis/produce.js'
import { buildKeymap, midiToNote } from '../core/keymap.js'
import { BeatBatchError, type VaryBatchManifest } from '../vary/batch.js'
import { shuffledOrder } from '../vary/audition.js'
import { genSubject } from './seeds.js'
import { SPLIT_SMOKE_MIN_BATCHES, mulberry32 } from './eval.js'

export type ShowdownSourceKind = 'engine' | 'engineplus' | 'gen' | 'keymap' | 'ref'

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

// ---- production treatment (the engineplus ablation) --------------------------------------------
// Feature-mining the first 21 rated showdown batches (2026-07-21) showed the engine's clips lose
// on PRODUCTION, not (only) raw timbre: dead mono (stereo correlation 1.00, width -52 dB vs ref
// -11 dB — the batch solos one center-panned single-voice track), near-zero air band (0.22% vs
// 1.89% energy above ~10 kHz), and the lowest production-complexity score, while production-
// QUALITY was flat across sources. `engineplus` isolates that variable: the SAME composed figure
// through the SAME synth patch, plus a production pass expressed entirely as ordinary .beat edits
// (existing SYNTH_FIELDS + the effect chain — no new engine features). If engineplus closes most
// of the engine's blind-rating deficit, the fix is production defaults, not a new synth.
//
// Every treatment requested for this ablation exists in the format vocabulary already, so nothing
// is skipped: width comes from the osc bank's own unison stack (osc2 detune layer + unisonWidth
// stereo spread) plus a light chorus insert — honest stereo, no opposite-panned duplicate track
// needed; "gentle saturation" is the always-wired saturator insert (saturatorDrive/Mix); space is
// the shared reverb/delay return buses (sendReverb/sendDelay); the air lift is eq3's high shelf
// (eqHigh), present in every migrated default chain. Values only ever INTENSIFY (Math.max against
// the patch's own settings) so a seed patch that already carries some production keeps it.

export interface ProductionTreatment {
  doc: BeatDocument
  /** honest, human-readable list of what was actually changed — the manifest's `from` record */
  applied: string[]
}

/** The engineplus ablation's FROZEN profile, expressed against the shared produced-defaults
 * primitive (src/analysis/produce.ts). These constants are the frozen science — the exact width /
 * glue / space / air targets whose blind-rating effect was measured — so they live HERE, spelled
 * out, rather than being drawn from `productionProfileFor` (whose role profiles are free to evolve).
 * Synth roles get the osc-bank width stack + delay glue; drums get the lighter chorus and no delay
 * (it would re-write the groove), and no osc-bank claims (drum voices ignore the osc bank). */
function engineplusProfile(kind: 'synth' | 'drums'): ProductionProfile {
  if (kind === 'synth') {
    return {
      role: 'default',
      osc2Layer: { level: 0.35, detuneCents: 10 },
      unison: { voices: 5, width: 0.6 },
      chorusMix: 0.25,
      saturator: { drive: 0.25, mix: 0.3 },
      sendReverb: 0.18,
      sendDelay: 0.08,
      eqHigh: 2.5,
    }
  }
  return {
    role: 'default',
    chorusMix: 0.15, // lighter on drums — keep the kick's mono punch
    saturator: { drive: 0.25, mix: 0.3 },
    sendReverb: 0.18,
    eqHigh: 2.5,
  }
}

/** Apply the engineplus production pass to `trackId` (synth or drums — the four showdown roles).
 * Notes/hits are untouched by construction: the comparison against the plain engine clip holds
 * the figure and patch constant and varies ONLY production. A thin wrapper over the shared
 * `applyProducedDefaults` primitive (plan A1) with the frozen engineplus profile — the ablation
 * semantics are unchanged (its tests pass unmodified). */
export function applyProductionTreatment(doc: BeatDocument, trackId: string): ProductionTreatment {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatBatchError(`no track "${trackId}" to produce (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  if (track.kind !== 'synth' && track.kind !== 'drums') {
    throw new BeatBatchError(`production treatment covers synth/drums tracks, and "${trackId}" is ${track.kind}`)
  }
  return applyProducedDefaults(doc, trackId, engineplusProfile(track.kind))
}

/** Fraction of ~100 ms windows whose RMS exceeds `floorDb` dBFS — the ref-chop AUDIBILITY guard
 * (owner, 2026-07-21, mid-rating: a picked bass-stem chop was "not really audible"). Loudness
 * normalization can't fix this class: gated LUFS normalizes a SPARSE chop by its few loud
 * moments, and matched integrated loudness can't make missing content audible. The guard runs at
 * pick time instead: a chop that is mostly silence (low active fraction) is skipped for the next
 * pool candidate. Mono-mixes whatever channels it's given. */
export function activeFraction(channels: Float32Array[] | number[][], sampleRate: number, floorDb = -40): number {
  if (channels.length === 0 || sampleRate <= 0) return 0
  const n = channels[0]!.length
  if (n === 0) return 0
  const win = Math.max(1, Math.round(sampleRate * 0.1))
  const floorRms = Math.pow(10, floorDb / 20)
  let active = 0
  let windows = 0
  for (let start = 0; start < n; start += win) {
    const end = Math.min(start + win, n)
    let sumSq = 0
    for (let i = start; i < end; i++) {
      let s = 0
      for (const ch of channels) s += ch[i] ?? 0
      s /= channels.length
      sumSq += s * s
    }
    windows += 1
    if (Math.sqrt(sumSq / (end - start)) > floorRms) active += 1
  }
  return windows === 0 ? 0 : active / windows
}

/** Fold a detected tempo into the plausible showdown range by octave-doubling/halving — beat
 * trackers on short chops routinely report half- or double-time (a 61 BPM reading of a 122 BPM
 * house chop). [70, 180] covers the taste-seed space (90-160) with headroom on both sides; the
 * result is rounded to an integer because .beat bpm and gen prompts both want whole numbers. */
export function foldBpmToRange(bpm: number, lo = 70, hi = 180): number {
  if (!Number.isFinite(bpm) || bpm <= 0) throw new BeatBatchError(`cannot fold a non-positive bpm (${bpm})`)
  let b = bpm
  while (b < lo) b *= 2
  while (b > hi) b /= 2
  // a pathological input can oscillate (e.g. lo=100 hi=150, bpm=80 -> 160 -> 80); one final
  // clamp keeps the result honest rather than looping forever
  return Math.round(Math.min(Math.max(b, lo), hi))
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

// ---- composed phrase bank ----------------------------------------------------------------------
// Un-blinding fix (owner, 2026-07-21, caught while rating showdown:bassline batches: "you gotta
// change up the basslines from a notes POV — I know the ones that you're composing bc they are
// almost all the same"). The engine and keymap clips used to play the taste-seed's OWN role
// phrase, and generateSeedBeat draws those from a very narrow space (bass: chord roots in one of
// two rhythms; chords: one sustained voicing per half bar; arp: chord-tone 8ths in one of three
// orders; drums: three feels) — so the composed clips were fingerprintable across batches and the
// blind leaked: the rater was judging "is this the phrase I've seen before", not the sound.
//
// Now every batch composes its figure from a per-batch-seeded ARCHETYPE bank. Within one batch the
// engine and keymap clips still play the SAME figure (the comparison is the sound source — the
// notes are deliberately held constant); across batches the figure genuinely changes (archetype ×
// progression × register × rhythm × density, all deterministic in the batch seed), and the CLI
// threads an exclude list so no two batches in one session even share an archetype. Figures stay
// diatonic in the seed's inferred key — the point is a fair fight for the engine, so every
// archetype is something a producer would actually play, not random notes.

export interface PhraseKey {
  /** midi root of the key, folded into 48..59 (the taste-seed generator's own range) */
  root: number
  minor: boolean
}

const MAJOR_SCALE: readonly number[] = [0, 2, 4, 5, 7, 9, 11]
const NATURAL_MINOR_SCALE: readonly number[] = [0, 2, 3, 5, 7, 8, 10]

export function scalePitchClasses(key: PhraseKey): readonly number[] {
  return key.minor ? NATURAL_MINOR_SCALE : MAJOR_SCALE
}

/** Best-fit key of a seed doc: score every (root, mode) candidate by how many synth-note pitch
 * classes fall inside its diatonic scale, with a small bonus for rooting on the bass's opening
 * note (breaks the relative-major/minor pitch-class tie toward the pitch the loop actually
 * centers on). Deterministic; tolerant of a borrowed chord or two. */
export function inferSeedKey(doc: BeatDocument): PhraseKey {
  const counts = new Array<number>(12).fill(0)
  for (const t of doc.tracks) {
    if (t.kind !== 'synth') continue
    for (const n of t.notes) counts[((n.pitch % 12) + 12) % 12]! += 1
  }
  if (counts.every((c) => c === 0)) throw new BeatBatchError('cannot infer a key: the seed has no synth notes')
  const bass = doc.tracks.find((t) => t.id === 'bass' && t.kind === 'synth')
  const opening = bass && bass.kind === 'synth' ? [...bass.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch)[0] : undefined
  const anchorPc = opening ? ((opening.pitch % 12) + 12) % 12 : -1
  let best: { root: number; minor: boolean; score: number } | null = null
  for (let root = 0; root < 12; root++) {
    for (const minor of [false, true]) {
      const scale = minor ? NATURAL_MINOR_SCALE : MAJOR_SCALE
      let score = 0
      for (let pc = 0; pc < 12; pc++) if (scale.includes((((pc - root) % 12) + 12) % 12)) score += counts[pc]!
      if (root === anchorPc) score += 2
      if (best === null || score > best.score) best = { root, minor, score }
    }
  }
  return { root: 48 + best!.root, minor: best!.minor }
}

export interface ComposedNote {
  pitch: number
  start: number
  duration: number
  velocity: number
}

export interface ComposedPhrase {
  archetype: string
  notes: ComposedNote[]
}

export type ComposedDrumLane = 'kick' | 'snare' | 'hat'

export interface ComposedDrumHit {
  lane: ComposedDrumLane
  start: number
  velocity: number
}

export interface ComposedDrumPhrase {
  archetype: string
  hits: ComposedDrumHit[]
}

export const BASSLINE_ARCHETYPES = ['rolling-8ths', 'offbeat-stabs', 'pickup-sync', 'sparse-sub', 'walking', 'octave-bounce'] as const
export const CHORDS_ARCHETYPES = ['sustained-pad', 'half-bar-hits', 'offbeat-house', 'pulse-8ths', 'charleston', 'anticipation'] as const
export const LEAD_ARCHETYPES = ['arp-16ths', 'arp-8ths', 'motif-repeat', 'call-response', 'long-tones', 'offbeat-riff'] as const
export const DRUM_ARCHETYPES = ['four-floor', 'half-time', 'breakbeat', 'shuffle-16', 'minimal-tech', 'boom-bap'] as const

/** 4-bar progressions as scale-degree roots, one chord per bar — diatonic in either mode. */
const PHRASE_PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 5, 3, 4],
  [0, 3, 4, 4],
  [5, 3, 0, 4],
  [0, 2, 3, 4],
  [0, 4, 5, 3],
  [3, 4, 0, 5],
  [0, 3, 5, 4],
  [0, 5, 3, 2],
]

/** `degree` is any integer scale degree (0 = the key root; ±7 wraps an octave). */
const degreePitch = (key: PhraseKey, degree: number, octaveShift: number): number => {
  const scale = scalePitchClasses(key)
  const idx = ((degree % 7) + 7) % 7
  const oct = Math.floor(degree / 7)
  return Math.min(127, Math.max(0, key.root + octaveShift + oct * 12 + scale[idx]!))
}

const rnd2 = (x: number) => Math.round(x * 100) / 100
const vel = (rng: () => number, lo: number, hi: number) => rnd2(Math.min(0.95, lo + rng() * (hi - lo)))

function seededShuffle<T>(rng: () => number, arr: readonly T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** First archetype of a seeded shuffle not yet used this session; every archetype used → seeded
 * pick anyway (a 7th batch may repeat an archetype, never a realization). */
function chooseArchetype(rng: () => number, names: readonly string[], exclude: readonly string[]): string {
  const shuffled = seededShuffle(rng, names)
  return shuffled.find((n) => !exclude.includes(n)) ?? shuffled[0]!
}

function bassNotes(archetype: string, key: PhraseKey, prog: readonly number[], rng: () => number): ComposedNote[] {
  const reg = rng() < 0.3 ? 0 : -12 // sub register most batches, upper bass sometimes
  const notes: ComposedNote[] = []
  const push = (degree: number, start: number, duration: number, v: number) => notes.push({ pitch: degreePitch(key, degree, reg), start, duration, velocity: v })
  const next = (bar: number) => prog[(bar + 1) % prog.length]!
  switch (archetype) {
    case 'rolling-8ths': {
      const dur = rng() < 0.35 ? 1 : 2 // staccato vs legato character, fixed per batch
      prog.forEach((d, bar) => {
        for (let s = 0; s < 16; s += 2) {
          const pop = s === 14 && rng() < 0.5
          push(pop ? d + (rng() < 0.5 ? 7 : 4) : d, bar * 16 + s, dur, vel(rng, 0.6, 0.9))
        }
      })
      break
    }
    case 'offbeat-stabs': {
      const useFifth = rng() < 0.5
      prog.forEach((d, bar) => {
        for (const s of [2, 6, 10, 14]) push(useFifth && s === 10 ? d + 4 : d, bar * 16 + s, rng() < 0.4 ? 1 : 2, vel(rng, 0.65, 0.9))
        if (rng() < 0.3) push(next(bar), bar * 16 + 15, 1, vel(rng, 0.4, 0.6))
      })
      break
    }
    case 'pickup-sync': {
      const approach = rng() < 0.5 ? -1 : 1 // pickup approaches the next root from below or above
      prog.forEach((d, bar) => {
        push(d, bar * 16, 3, vel(rng, 0.75, 0.9))
        push(d, bar * 16 + 6, 2, vel(rng, 0.6, 0.8))
        if (rng() < 0.6) push(d + (rng() < 0.3 ? 4 : 0), bar * 16 + 10, 2, vel(rng, 0.55, 0.8))
        push(next(bar) + approach, bar * 16 + 14, 2, vel(rng, 0.5, 0.7))
      })
      break
    }
    case 'sparse-sub': {
      prog.forEach((d, bar) => {
        push(d, bar * 16, 4 + Math.floor(rng() * 5), vel(rng, 0.8, 0.95))
        push(d, bar * 16 + 10, 3 + Math.floor(rng() * 2), vel(rng, 0.6, 0.8))
        if (bar % 2 === 1 && rng() < 0.5) push(d + 4, bar * 16 + 14, 2, vel(rng, 0.5, 0.7))
      })
      break
    }
    case 'walking': {
      const up = rng() < 0.5
      prog.forEach((d, bar) => {
        const quarters = up ? [d, d + 2, d + 4, next(bar) - 1] : [d + 7, d + 4, d + 2, next(bar) + 1]
        quarters.forEach((deg, q) => push(deg, bar * 16 + q * 4, 3 + Math.floor(rng() * 2), vel(rng, 0.6, 0.85)))
      })
      break
    }
    default: {
      // octave-bounce
      prog.forEach((d, bar) => {
        for (let s = 0; s < 16; s += 2) {
          const high = (s / 2) % 2 === 1
          const deg = s === 12 && rng() < 0.4 ? d + 4 : high ? d + 7 : d
          push(deg, bar * 16 + s, 1, high ? vel(rng, 0.5, 0.7) : vel(rng, 0.7, 0.9))
        }
      })
      break
    }
  }
  return notes
}

/** Chord voicings as scale-degree offsets from the chord root degree. */
const CHORD_VOICINGS: readonly (readonly number[])[] = [
  [0, 2, 4], // close triad
  [0, 4, 9], // open: root, fifth, tenth
  [2, 4, 7], // first inversion, root on top
  [0, 2, 4, 7], // triad + octave
  [0, 4, 7, 9], // wide: root, fifth, octave, tenth
]

function chordNotes(archetype: string, key: PhraseKey, prog: readonly number[], rng: () => number): ComposedNote[] {
  const voicing = CHORD_VOICINGS[Math.floor(rng() * CHORD_VOICINGS.length)]!
  const reg = 12
  const notes: ComposedNote[] = []
  const stack = (degree: number, start: number, duration: number, v: number) => {
    for (const off of voicing) notes.push({ pitch: degreePitch(key, degree + off, reg), start, duration, velocity: v })
  }
  const next = (bar: number) => prog[(bar + 1) % prog.length]!
  switch (archetype) {
    case 'sustained-pad':
      prog.forEach((d, bar) => stack(d, bar * 16, rng() < 0.3 ? 14 : 16, vel(rng, 0.5, 0.7)))
      break
    case 'half-bar-hits': {
      const dur = rng() < 0.5 ? 3 : 7 // stabs vs held halves, fixed per batch
      const second = rng() < 0.6 ? 8 : 10 // on the half bar, or pushed onto the "and of 3"
      prog.forEach((d, bar) => {
        stack(d, bar * 16, dur, vel(rng, 0.55, 0.75))
        stack(d, bar * 16 + second, Math.min(dur, 16 - second), vel(rng, 0.5, 0.7))
        if (rng() < 0.25) stack(d, bar * 16 + 14, 2, vel(rng, 0.4, 0.55)) // pre-barline pickup stab
      })
      break
    }
    case 'offbeat-house':
      prog.forEach((d, bar) => {
        for (const s of [2, 6, 10, 14]) stack(d, bar * 16 + s, rng() < 0.5 ? 1 : 2, vel(rng, 0.5, 0.75))
      })
      break
    case 'pulse-8ths':
      prog.forEach((d, bar) => {
        for (let s = 0; s < 16; s += 2) {
          if (s === 14 && rng() < 0.3) continue // seeded breath before the barline
          stack(d, bar * 16 + s, 1, s % 8 === 0 ? vel(rng, 0.65, 0.8) : vel(rng, 0.45, 0.6))
        }
      })
      break
    case 'charleston':
      prog.forEach((d, bar) => {
        stack(d, bar * 16, 3, vel(rng, 0.6, 0.8))
        stack(d, bar * 16 + 6, 2, vel(rng, 0.5, 0.7))
        if (rng() < 0.4) stack(d, bar * 16 + 12, 2, vel(rng, 0.45, 0.6))
      })
      break
    default: {
      // anticipation: held chord, the next bar's chord anticipated just before the barline
      const held = 10 + 2 * Math.floor(rng() * 3) // 10, 12, or 14 steps of hold, fixed per batch
      const pushAt = rng() < 0.5 ? 14 : 15
      prog.forEach((d, bar) => {
        if (rng() < 0.35) {
          // seeded re-attack: split the hold in two for this bar
          stack(d, bar * 16, 6, vel(rng, 0.55, 0.75))
          stack(d, bar * 16 + 6, held - 6, vel(rng, 0.5, 0.7))
        } else {
          stack(d, bar * 16, held, vel(rng, 0.55, 0.75))
        }
        stack(next(bar), bar * 16 + pushAt, 16 - pushAt, vel(rng, 0.45, 0.65))
      })
      break
    }
  }
  return notes
}

function leadNotes(archetype: string, key: PhraseKey, prog: readonly number[], rng: () => number): ComposedNote[] {
  const reg = 24
  const notes: ComposedNote[] = []
  const push = (degree: number, start: number, duration: number, v: number) => notes.push({ pitch: degreePitch(key, degree, reg), start, duration, velocity: v })
  switch (archetype) {
    case 'arp-16ths': {
      const orders: readonly (readonly number[])[] = [[0, 2, 4, 7], [0, 4, 2, 7], [7, 4, 2, 0], [0, 2, 4, 7, 4, 2], [0, 7, 4, 2]]
      const order = orders[Math.floor(rng() * orders.length)]!
      const restP = 0.08 + rng() * 0.17
      prog.forEach((d, bar) => {
        for (let s = 0; s < 16; s++) {
          if (rng() < restP) continue
          push(d + order[s % order.length]!, bar * 16 + s, 1, vel(rng, 0.35, 0.6))
        }
      })
      break
    }
    case 'arp-8ths': {
      const orders: readonly (readonly number[])[] = [[0, 4, 2, 7], [0, 2, 4, 2], [4, 2, 0, 2], [0, 7, 2, 4]]
      const order = orders[Math.floor(rng() * orders.length)]!
      const dur = rng() < 0.5 ? 1 : 2
      prog.forEach((d, bar) => {
        for (let s = 0; s < 16; s += 2) {
          if (rng() < 0.1) continue
          push(d + order[(s / 2) % order.length]!, bar * 16 + s, dur, vel(rng, 0.4, 0.65))
        }
      })
      break
    }
    case 'motif-repeat':
    case 'call-response': {
      // a seeded one-bar motif replayed over each bar's chord; call-response answers the odd
      // bars with the motif's contour inverted
      const starts = seededShuffle(rng, [0, 2, 3, 4, 6, 8, 10, 11, 12, 14]).slice(0, 4 + Math.floor(rng() * 3)).sort((a, b) => a - b)
      const offsetBank = [-3, -1, 0, 0, 2, 4, 5, 7]
      const offsets = starts.map(() => offsetBank[Math.floor(rng() * offsetBank.length)]!)
      prog.forEach((d, bar) => {
        const invert = archetype === 'call-response' && bar % 2 === 1
        starts.forEach((s, i) => {
          const off = invert ? -offsets[i]! : offsets[i]!
          const gap = (starts[i + 1] ?? 16) - s
          push(d + off, bar * 16 + s, Math.max(1, Math.min(3, gap)), vel(rng, 0.45, 0.7))
        })
      })
      break
    }
    case 'long-tones':
      prog.forEach((d, bar) => {
        const tone = d + [0, 2, 4][Math.floor(rng() * 3)]!
        push(tone, bar * 16, 10 + Math.floor(rng() * 5), vel(rng, 0.5, 0.7))
        if (rng() < 0.6) push(tone + 1, bar * 16 + 12, 2, vel(rng, 0.35, 0.55)) // upper-neighbour ornament
        if (rng() < 0.4) push(tone, bar * 16 + 14, 2, vel(rng, 0.35, 0.5))
      })
      break
    default: {
      // offbeat-riff
      const cells = [1, 3, 6, 9, 11, 14]
      const tones = [0, 2, 4, 7]
      prog.forEach((d, bar) => {
        for (const s of cells) {
          if (rng() < 0.25) continue
          push(d + tones[Math.floor(rng() * tones.length)]!, bar * 16 + s, rng() < 0.5 ? 1 : 2, vel(rng, 0.4, 0.65))
        }
      })
      break
    }
  }
  return notes
}

const ROLE_SALTS = { bassline: 101, chords: 211, lead: 307 } as const
const ROLE_BANKS = { bassline: BASSLINE_ARCHETYPES, chords: CHORDS_ARCHETYPES, lead: LEAD_ARCHETYPES } as const

/** One 4-bar composed figure for a pitched role, deterministic in `seed`, diatonic in `key`.
 * `opts.exclude` lists archetypes already used this session so consecutive batches never share a
 * figure (the CLI threads it per role). */
export function composePitchedPhrase(
  role: 'bassline' | 'chords' | 'lead',
  key: PhraseKey,
  seed: number,
  opts: { exclude?: readonly string[] } = {},
): ComposedPhrase {
  const rng = mulberry32(seed + ROLE_SALTS[role])
  const archetype = chooseArchetype(rng, ROLE_BANKS[role], opts.exclude ?? [])
  const prog = PHRASE_PROGRESSIONS[Math.floor(rng() * PHRASE_PROGRESSIONS.length)]!
  const notes = role === 'bassline' ? bassNotes(archetype, key, prog, rng) : role === 'chords' ? chordNotes(archetype, key, prog, rng) : leadNotes(archetype, key, prog, rng)
  if (notes.length === 0) notes.push({ pitch: degreePitch(key, prog[0]!, role === 'bassline' ? -12 : role === 'chords' ? 12 : 24), start: 0, duration: 8, velocity: 0.7 })
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  return { archetype, notes }
}

/** One 4-bar composed drum groove over the kick/snare/hat kit lanes, deterministic in `seed` —
 * the drum-loop role's figure, same archetype-bank contract as the pitched roles. */
export function composeDrumPhrase(seed: number, opts: { exclude?: readonly string[] } = {}): ComposedDrumPhrase {
  const rng = mulberry32(seed + 401)
  const archetype = chooseArchetype(rng, DRUM_ARCHETYPES, opts.exclude ?? [])
  const hits: ComposedDrumHit[] = []
  const hit = (lane: ComposedDrumLane, start: number, v: number) => hits.push({ lane, start, velocity: v })
  switch (archetype) {
    case 'four-floor': {
      const openHatEvery8th = rng() < 0.4
      for (let bar = 0; bar < 4; bar++) {
        const o = bar * 16
        for (let s = 0; s < 16; s += 4) hit('kick', o + s, vel(rng, 0.8, 0.95))
        hit('snare', o + 4, vel(rng, 0.7, 0.85))
        hit('snare', o + 12, vel(rng, 0.7, 0.85))
        for (let s = 2; s < 16; s += openHatEvery8th ? 2 : 4) hit('hat', o + s, vel(rng, 0.35, 0.6))
        if (rng() < 0.4) hit('hat', o + 15, vel(rng, 0.2, 0.35))
      }
      break
    }
    case 'half-time': {
      for (let bar = 0; bar < 4; bar++) {
        const o = bar * 16
        hit('kick', o, vel(rng, 0.85, 0.95))
        if (rng() < 0.7) hit('kick', o + 10, vel(rng, 0.55, 0.75))
        hit('snare', o + 8, vel(rng, 0.75, 0.9))
        for (let s = 0; s < 16; s += 2) hit('hat', o + s, vel(rng, 0.25, 0.5))
      }
      break
    }
    case 'breakbeat': {
      for (let bar = 0; bar < 4; bar++) {
        const o = bar * 16
        hit('kick', o, vel(rng, 0.85, 0.95))
        if (rng() < 0.8) hit('kick', o + 6, vel(rng, 0.6, 0.8))
        if (rng() < 0.8) hit('kick', o + 10, vel(rng, 0.65, 0.85))
        hit('snare', o + 4, vel(rng, 0.75, 0.9))
        hit('snare', o + 12, vel(rng, 0.75, 0.9))
        if (rng() < 0.5) hit('snare', o + (rng() < 0.5 ? 7 : 15), vel(rng, 0.2, 0.4)) // ghost
        for (let s = 1; s < 16; s += 2) if (rng() < 0.7) hit('hat', o + s, vel(rng, 0.25, 0.5))
      }
      break
    }
    case 'shuffle-16': {
      const kickGhostAt = rng() < 0.5 ? 7 : 11
      for (let bar = 0; bar < 4; bar++) {
        const o = bar * 16
        for (let s = 0; s < 16; s++) hit('hat', o + s, s % 4 === 2 ? vel(rng, 0.45, 0.6) : vel(rng, 0.15, 0.35))
        hit('kick', o, vel(rng, 0.85, 0.95))
        if (rng() < 0.6) hit('kick', o + kickGhostAt, vel(rng, 0.5, 0.7))
        hit('snare', o + 4, vel(rng, 0.7, 0.85))
        hit('snare', o + 12, vel(rng, 0.7, 0.85))
      }
      break
    }
    case 'minimal-tech': {
      const hatOffs = rng() < 0.5 ? [2, 10] : [6, 14]
      for (let bar = 0; bar < 4; bar++) {
        const o = bar * 16
        for (let s = 0; s < 16; s += 4) hit('kick', o + s, vel(rng, 0.8, 0.9))
        for (const s of hatOffs) hit('hat', o + s, vel(rng, 0.3, 0.5))
        if (bar % 2 === 1) hit('snare', o + 12, vel(rng, 0.4, 0.6))
        if (rng() < 0.3) hit('hat', o + 13, vel(rng, 0.15, 0.3))
        if (rng() < 0.25) hit('kick', o + 14, vel(rng, 0.4, 0.6))
      }
      break
    }
    default: {
      // boom-bap
      for (let bar = 0; bar < 4; bar++) {
        const o = bar * 16
        hit('kick', o, vel(rng, 0.85, 0.95))
        if (rng() < 0.7) hit('kick', o + 3, vel(rng, 0.5, 0.7))
        hit('kick', o + 10, vel(rng, 0.7, 0.85))
        hit('snare', o + 4, vel(rng, 0.75, 0.9))
        hit('snare', o + 12, vel(rng, 0.75, 0.9))
        for (let s = 0; s < 16; s += 2) if (rng() < 0.85) hit('hat', o + s, vel(rng, 0.3, 0.55))
      }
      break
    }
  }
  hits.sort((a, b) => a.start - b.start || a.lane.localeCompare(b.lane))
  return { archetype, hits }
}

/** Replace `trackId`'s notes with the composed figure (ids cp1.., v0.10 fields at canonical
 * defaults). The engine clip solos this doc and the keymap clip reads the phrase back off it
 * (phraseFromSeed), so same-batch note parity holds by construction. */
export function applyComposedPhrase(doc: BeatDocument, trackId: string, phrase: ComposedPhrase): BeatDocument {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track || track.kind !== 'synth') throw new BeatBatchError(`composed phrase needs synth track "${trackId}" (have: ${doc.tracks.map((t) => `${t.id}(${t.kind})`).join(', ')})`)
  if (phrase.notes.length === 0) throw new BeatBatchError('a composed phrase needs at least one note')
  const notes = phrase.notes.map((n, i) => ({ id: `cp${i + 1}`, pitch: n.pitch, start: n.start, duration: n.duration, velocity: n.velocity, ...NOTE_FIELD_DEFAULTS }))
  return { ...doc, tracks: doc.tracks.map((t) => (t.id === trackId && t.kind === 'synth' ? { ...t, notes } : t)) }
}

/** Same contract for the drum-loop role: replace the drums track's hits with the composed groove
 * (ids ch1..) — the engine clip and the kit clip both build from the result. */
export function applyComposedDrums(doc: BeatDocument, trackId: string, phrase: ComposedDrumPhrase): BeatDocument {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track || track.kind !== 'drums') throw new BeatBatchError(`composed drum phrase needs drums track "${trackId}" (have: ${doc.tracks.map((t) => `${t.id}(${t.kind})`).join(', ')})`)
  if (phrase.hits.length === 0) throw new BeatBatchError('a composed drum phrase needs at least one hit')
  const hits = phrase.hits.map((h, i) => ({ id: `ch${i + 1}`, lane: h.lane, start: h.start, velocity: h.velocity }))
  return { ...doc, tracks: doc.tracks.map((t) => (t.id === trackId && t.kind === 'drums' ? { ...t, hits } : t)) }
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
  /** ref rows re-kinded by origin pool (ref:familiar / ref:unfamiliar / ref:other) — computed
   * from local batch manifests only, so the shared log stays kind-only; empty when no ref batch
   * still has its manifest on disk */
  refPools: SourceStat[]
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

/** Classify a ref clip's origin pool from its manifest `from` path. The SHARED scores log
 * records the source kind only (the licensing posture) — the pool split is computed at report
 * time from the batch dir's own manifest, so only someone who already has the batches (and the
 * refs) can see it. Pools are the taste-dataset convention: refs-familiar/ = chops of songs the
 * owner loves, refs-unfamiliar/ = competent-but-unknown tracks — "my taste is unreachable" and
 * "any commercial track is unreachable" are different findings. */
export function classifyRefPool(fromPath: string): 'ref:familiar' | 'ref:unfamiliar' | 'ref:other' {
  if (/refs-familiar\b/.test(fromPath)) return 'ref:familiar'
  if (/refs-unfamiliar\b/.test(fromPath)) return 'ref:unfamiliar'
  return 'ref:other'
}

/** Re-kind each entry's ref variants by pool (reading the batch manifest when it still exists);
 * entries whose dir/manifest is gone keep plain 'ref' and land in ref:other only if classified. */
function refPoolTally(entries: ShowdownLogEntry[]): SourceStat[] {
  const augmented: ShowdownLogEntry[] = []
  for (const e of entries) {
    if (!Object.values(e.sources).includes('ref')) continue
    const manifestPath = join(e.batch, 'manifest.json')
    if (!existsSync(manifestPath)) continue
    let manifest: VaryBatchManifest & { variants: { file: string; source?: { kind?: string; from?: string } }[] }
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch {
      continue
    }
    const sources: Record<string, string> = { ...e.sources }
    for (const v of manifest.variants ?? []) {
      if (v.source?.kind === 'ref' && typeof v.source.from === 'string') {
        const wav = v.file.replace(/\.beat$/, '.wav')
        if (sources[wav] === 'ref') sources[wav] = classifyRefPool(v.source.from)
        else if (sources[v.file] === 'ref') sources[v.file] = classifyRefPool(v.source.from)
      }
    }
    augmented.push({ ...e, sources })
  }
  return tally(augmented).filter((s) => s.kind.startsWith('ref:'))
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
    refPools: refPoolTally(entries),
    roles,
    smokeMinBatches: SPLIT_SMOKE_MIN_BATCHES,
  }
}

const pct = (num: number, den: number) => (den === 0 ? '—' : `${Math.round((100 * num) / den)}%`)

function statLine(s: SourceStat, indent: string): string {
  // pad to the longest kind name ('engineplus') so mixed-kind scoreboards stay column-aligned
  return (
    `${indent}${s.kind.padEnd(10)} win ${pct(s.wins, s.batches)} (${s.wins}/${s.batches})` +
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
  if (r.refPools.length > 0) {
    out += `ref by pool (local manifests only — the shared log stays kind-only):\n`
    for (const s of r.refPools) out += statLine(s, '  ')
  }
  out += `by role:\n`
  for (const role of r.roles) {
    out += `  ${role.role} (${role.batches} batch${role.batches === 1 ? '' : 'es'})${role.smoke ? '  [small n — smoke, not evidence]' : ''}\n`
    for (const s of role.stats) out += statLine(s, '    ')
  }
  out += `(win = ranked best; top-half = ranked in the top ceil(n/2) picks; pairwise = implied comparisons won; ref clips are counted by KIND only — their identity stays in the batch dir)\n`
  return out
}
