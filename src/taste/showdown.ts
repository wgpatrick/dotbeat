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
//   surge   — (opt-in, --with-surge) the SAME composed figure rendered through a Surge XT factory
//             patch via the python sidecar (pitched roles only) — the "can a pro synth + patch
//             library carry this part?" probe
//   surgeplus — (opt-in, --with-surge AND --with-produced) the SAME surge render through a dotbeat
//             production pass, hosted as a sample voice on a drums-kind scratch host and rendered
//             offline (see the surgeplus section below) — isolates production for surge exactly as
//             engineplus does for engine
//   layered — (opt-in, --with-layered) the SAME composed figure rendered as a MULTI-TRACK
//             instrument: 3-4 synth layers (bass sub+growl+click / chords body+pad+stab+air / lead
//             body+main+octave+width), each at its own register, in its own crossover slot, at its
//             own level — the first non-solo clip SHAPE in the eval. src/taste/layered.ts;
//             pitched roles only (a drum kit is already multi-voice). Isolates LAYERING.
//   layeredplus — (opt-in, --with-layered AND --with-produced) the same stack plus a per-layer
//             production pass (role-true width, parallel compression, glue, space, air) — the
//             layered shape's answer to engineplus.
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
import { applyProducedDefaults, type ProductionProfile, type ProductionRole, type ProducedResult } from '../analysis/produce.js'
import { buildKeymap, midiToNote } from '../core/keymap.js'
import { BeatBatchError, type VaryBatchManifest } from '../vary/batch.js'
import { shuffledOrder } from '../vary/audition.js'
import { genSubject } from './seeds.js'
import { SPLIT_SMOKE_MIN_BATCHES, mulberry32 } from './eval.js'
import {
  scalePitchClasses,
  degreePitch,
  seededShuffle,
  chooseSeeded,
  MAJOR_SCALE,
  NATURAL_MINOR_SCALE,
  type PhraseKey,
  type ComposedNote,
  type ComposedPhrase,
  type ComposedDrumLane,
  type ComposedDrumHit,
  type ComposedDrumPhrase,
} from './phrase.js'
// Barrel: the shared figure vocabulary now lives in ./phrase.ts (a near-leaf), but every consumer —
// theory.ts, ca2.ts, midifig.ts, the tests, and cli/beat.mjs's dynamic imports — has always reached
// for it here. Re-exporting keeps all of those import paths working with no edit.
export {
  scalePitchClasses,
  degreePitch,
  seededShuffle,
  chooseSeeded,
  type ScaleMode,
  type PhraseKey,
  type ComposedNote,
  type ComposedPhrase,
  type ComposedDrumLane,
  type ComposedDrumHit,
  type ComposedDrumPhrase,
} from './phrase.js'
import { readWavFormat, wavSampleCodec, type WavFormatInfo } from '../metrics/index.js'
import { curatedKey } from './surgeCuration.js'
import type { StemName } from '../analysis/stems.js'

export type ShowdownSourceKind = 'engine' | 'engineplus' | 'gen' | 'keymap' | 'layered' | 'layeredplus' | 'ref' | 'surge' | 'surgeplus'

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

/** Which htdemucs stem carries each role's gen clip (`beat showdown --gen-stem-extract`).
 *
 * htdemucs separates exactly four sources — drums / bass / other / vocals — so `other` is the
 * catch-all for every pitched non-bass instrument: chord keys, synth leads, guitars, pads. That is
 * not a compromise for this eval, it is the right target: what the chords/lead arms need removed is
 * the DRUM KIT and the bass, and `other` is precisely the mix minus those (minus vocals, which an
 * instrumental generation has none of anyway).
 *
 * Keyed by phraseSubjectId rather than role id because the subject is what the gen prompt actually
 * asked for — the two happen to line up today, and this way they cannot silently drift apart. */
export const GEN_STEM_BY_SUBJECT: Record<string, StemName> = {
  bassline: 'bass',
  chords: 'other',
  melody: 'other',
  drumloop: 'drums',
}

/** The stem to keep for a role's gen clip, or undefined when the role has no mapping (a new role
 * added to the bank without a stem opinion — the caller then just skips extraction for it). */
export function genStemForRole(spec: ShowdownRoleSpec): StemName | undefined {
  return GEN_STEM_BY_SUBJECT[spec.phraseSubjectId]
}

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
 * (it would re-write the groove), and no osc-bank claims (drum voices ignore the osc bank).
 *
 * Exported ONLY so test/showdown.test.ts can pin it field-for-field with `===` (the `>=` assertions
 * on the produced doc test a different property — "values only intensify" — and would happily pass a
 * silent change to these numbers, which would break comparability with every batch already rated
 * against the engineplus ablation). Not part of the module's working API: nothing but the test and
 * applyProductionTreatment below should call it. */
export function engineplusProfile(kind: 'synth' | 'drums'): ProductionProfile {
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

const rnd2 = (x: number) => Math.round(x * 100) / 100
const vel = (rng: () => number, lo: number, hi: number) => rnd2(Math.min(0.95, lo + rng() * (hi - lo)))

/** First archetype of a seeded shuffle not yet used this session; every archetype used → seeded
 * pick anyway (a 7th batch may repeat an archetype, never a realization). The bank's labels are the
 * bare archetype names — that is its namespace in the CLI's shared exclude chain. */
const chooseArchetype = (rng: () => number, names: readonly string[], exclude: readonly string[]): string =>
  chooseSeeded(rng, names, (n) => n, exclude)

function bassNotes(archetype: string, key: PhraseKey, prog: readonly number[], rng: () => number): ComposedNote[] {
  const reg = rng() < 0.3 ? 0 : -12 // sub register most batches, upper bass sometimes
  // Register-rule fix (research 124 §C.2, "below ~100 Hz stick to root/5th/octave; colour tones go
  // an octave up"): in the sub register, a chord's upper colour tone is voiced as the OCTAVE
  // (degree+7), never the mid-chord tone (degree+4) the doc flags on sparse-sub/pickup-sync — so the
  // sub carries only root/5th/octave. Above the sub floor (reg === 0), the fifth stays.
  const subReg = reg < 0
  const colorDegree = (base: number) => base + (subReg ? 7 : 4)
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
        if (rng() < 0.6) push(rng() < 0.3 ? colorDegree(d) : d, bar * 16 + 10, 2, vel(rng, 0.55, 0.8))
        push(next(bar) + approach, bar * 16 + 14, 2, vel(rng, 0.5, 0.7))
      })
      break
    }
    case 'sparse-sub': {
      prog.forEach((d, bar) => {
        push(d, bar * 16, 4 + Math.floor(rng() * 5), vel(rng, 0.8, 0.95))
        push(d, bar * 16 + 10, 3 + Math.floor(rng() * 2), vel(rng, 0.6, 0.8))
        if (bar % 2 === 1 && rng() < 0.5) push(colorDegree(d), bar * 16 + 14, 2, vel(rng, 0.5, 0.7))
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

// ---- surge probe (the Surge-as-sound-factory source, research 114 §7) --------------------------
// A `surge` clip renders the batch's OWN composed figure — same notes as the engine/engineplus
// clips, so the comparison holds composition constant and isolates timbre — through a Surge XT
// factory patch via the python/surge_render.py sidecar. The pure logic lives here (role->patch-
// category mapping, note-list conversion, the deterministic seeded patch pick); the spawn and the
// render pipeline live in src/analysis/surge.ts + the CLI, same split as gen (showdown.ts is
// render-free by construction).
//
// LICENSING: Surge XT is GPLv3 (fine for a local dev-side render tool — outputs carry no code
// copyleft), but the factory-PATCH content license is unresolved upstream (surge issue #6741), so
// every batch that contains a surge clip is gitignore-gated exactly like a ref-bearing batch
// (writeShowdownBatch below). drum-loop is intentionally OUT of scope for v1 — driving a kit
// through a synth patch is a different question than the pitched-timbre one this probe asks.

/** One factory patch as the sidecar's --list-patches reports it. */
export interface SurgePatch {
  name: string
  /** Surge's top-level patch category (the dir under patches_factory: Basses / Leads / Pads / …) */
  category: string
  /** absolute path to the .fxp */
  path: string
}

/** The sidecar's note-list format: absolute-time events, MIDI velocity 1..127. */
export interface SurgeNote {
  midi: number
  startSeconds: number
  durationSeconds: number
  velocity: number
}

/** Role -> Surge factory patch-categories to draw a patch from. Pitched roles only; drum-loop
 * maps to null (skipped for v1 — see the section note). Matching is case-insensitive and by
 * substring so "Basses" also catches sub-categories like "Basses/Acid". */
export const SURGE_ROLE_CATEGORIES: Record<string, readonly string[] | null> = {
  bassline: ['Basses'],
  chords: ['Pads', 'Keys'],
  lead: ['Leads', 'Plucks'],
  'drum-loop': null,
}

/** The role's patch-categories, or null when surge is skipped for the role (drum-loop). Unknown
 * roles also return null (no surge clip) rather than throwing — the flag degrades, never breaks. */
export function surgeRoleCategories(role: string): readonly string[] | null {
  return role in SURGE_ROLE_CATEGORIES ? SURGE_ROLE_CATEGORIES[role]! : null
}

/** Whether `patch`'s category matches any of `categories` (case-insensitive substring). */
export function patchInCategories(patch: SurgePatch, categories: readonly string[]): boolean {
  const cat = patch.category.toLowerCase()
  return categories.some((c) => cat.includes(c.toLowerCase()))
}

/** Deterministically pick one patch for a role from `patches`, filtered to the role's categories
 * and seeded by the batch seed — the manifest records the chosen name+category so a round is
 * reproducible. Returns null when the role skips surge, or when no factory patch matches the
 * role's categories (the CLI then warns and drops the surge clip for that batch). The candidate
 * list is sorted by (category, name) first so the pick is stable across machines with the same
 * factory content regardless of the sidecar's enumeration order.
 *
 * CURATION (decisions.md D26): pass `opts.curatedKeys` — the role's curated patch-key Set from a
 * loaded presets/surge-curated.json (surgeCuration.curatedKeysForRole) — to draw only from the
 * curated top quartile instead of the full ~639-patch pool. Falls back to the full role pool when
 * the Set is null/empty, or when NONE of the role's category patches are in it (a curated file
 * built against different factory content), so the pick never degrades to null just because
 * curation is on. */
export function pickSurgePatch(
  patches: readonly SurgePatch[],
  role: string,
  seed: number,
  opts: { curatedKeys?: ReadonlySet<string> | null } = {},
): SurgePatch | null {
  const categories = surgeRoleCategories(role)
  if (categories === null) return null
  let candidates = patches
    .filter((p) => patchInCategories(p, categories))
    .sort((a, b) => a.category.toLowerCase().localeCompare(b.category.toLowerCase()) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  const keys = opts.curatedKeys
  if (keys && keys.size > 0) {
    const curated = candidates.filter((p) => keys.has(curatedKey(p.category, p.name)))
    if (curated.length > 0) candidates = curated // else: curated file doesn't match this factory content — full pool
  }
  if (candidates.length === 0) return null
  const rng = mulberry32(seed + 613) // surge salt, distinct from the phrase/archetype salts
  return candidates[Math.floor(rng() * candidates.length)]!
}

/** Convert a composed pitched figure to the sidecar's absolute-time note list at `bpm`. Composed
 * starts/durations are in 16th-note STEPS (16 per bar, the .beat grid); one quarter = 4 steps, so
 * secondsPerStep = (60/bpm)/4. Velocity is the composer's 0..~0.95 float scaled to MIDI 1..127.
 * A zero/negative-duration note is clamped to a single step so the sidecar always gets an audible
 * event. Same notes the engine plays — the surge/engine comparison varies only the sound source. */
export function composedPhraseToSurgeNotes(phrase: ComposedPhrase, bpm: number): SurgeNote[] {
  if (!(bpm > 0)) throw new BeatBatchError(`surge note conversion needs a positive bpm, got ${bpm}`)
  const secondsPerStep = 60 / bpm / 4
  return phrase.notes.map((n) => ({
    midi: n.pitch,
    startSeconds: round4(n.start * secondsPerStep),
    durationSeconds: round4(Math.max(1, n.duration) * secondsPerStep),
    velocity: Math.min(127, Math.max(1, Math.round(n.velocity * 127))),
  }))
}

const round4 = (x: number) => Math.round(x * 10000) / 10000

// ---- surgeplus: the surge render THROUGH a production host (decisions.md D26/D27) --------------
// The engineplus arm proved production-only edits move the engine 3%->29% blind pairwise; surge
// sits at ~50% with ZERO production treatment. surgeplus isolates production for surge exactly as
// engineplus does for engine: the SAME surge render (same patch + figure audio) through a dotbeat
// production pass, deliberately same-figure.
//
// WHERE the production is applied — the honest audio-domain finding. A surge clip is a WAV from the
// python sidecar, not engine-synthesized, so its production can't be expressed as SYNTH_FIELDS edits
// on a synth track (engineplus's mechanism). It has to be applied to the AUDIO. dotbeat's 'audio'-
// KIND track is the obvious host, but it carries NO effect chain BY FORMAT DESIGN: `addEffect`
// refuses audio tracks (src/core/edit.ts — "effect chains only belong on synth/drums/instrument
// tracks"), the serializer emits none for them, and the engine wires an audio voice as a bare
// player -> muteGain -> master (ui/src/audio/engine.ts buildAudioTrackVoice) that never reads
// `track.effects`. Hosting the surge WAV in an 'audio' track would therefore render it DRY — a
// production no-op. So surgeplus hosts the render the SAME way the keymap clip hosts its one-shot:
// as a single-trigger SAMPLE voice on a drums-KIND scratch host (keymapScratchText is itself a
// drums-kind track), the audio-playback track dotbeat's engine actually PRODUCES — its sample voice
// routes player -> filter -> the drum bus (EQ/comp/distortion/bitcrush + saturator + reverb/delay
// sends) and the reorderable insert chain, all rendered offline like the other work clips.
//
// The production pass is a STRENGTHENED, sample-host-specific profile (surgeplusProfile), applied
// through the shared applyProducedDefaults primitive (the same one engineplus wraps) with the
// sampleHostWidth opt-in. It fixes the measured "twin problem": the old pass reused the mild genkit
// profile AND dropped its two biggest width moves on the sample voice, so a surgeplus render landed
// within ~0.5 dB RMS of its surge sibling (0% wins — the owner heard duplicates). The honest map of
// what renders on the drums-kind sample voice, corrected against the engine (the reorderable
// track.effects chain reconciles on drums exactly as on synth — Phase 26 Stream DC — so utility and
// auto-pan ARE available inserts, NOT synth-only; the earlier claim that "the drum bus's fixed tail
// doesn't carry utility" conflated the fixed tail with the reorderable chain):
//   RENDERS  → eq3 high-shelf air (eqHigh), saturator glue, chorus width, reverb + delay sends,
//              the utility mid/side widener, and auto-pan motion (the last two via sampleHostWidth).
//   DROPPED  → the osc-BANK width stack (osc2 layer / unison / noise wash — a sample truly has no
//              osc bank), and the sidechain duck (the drums branch of the engine's offline tick()
//              returns before the synth-only duck block, so a duck on a drums voice silently
//              no-ops — surgeplusProfile sets none, keeping the `applied` list honest).
// So surgeplus leans on the full renderable width path — utility + auto-pan + assertive chorus —
// plus stronger air/saturation/space, targeting the dead-mono / no-air deficit the whole effort
// chases while staying same-figure (notes/hits held constant against the surge clip).

/** The drums-kind scratch host's track id — the CLI registers the surge WAV as a sample lane on it
 * (beat source add -> media/) before buildSurgeSampleHost declares the lane and the single hit. */
export const SURGEPLUS_TRACK_ID = 'surge'

/** showdown role -> produce.ts ProductionRole for the surgeplus host. Pitched roles only (surge —
 * and therefore surgeplus — skips drum-loop, see SURGE_ROLE_CATEGORIES); an unmapped role falls
 * back to the mild all-round 'default' profile rather than throwing (degrade, never break). */
export const SURGEPLUS_PRODUCTION_ROLE: Record<string, ProductionRole> = {
  bassline: 'bass',
  chords: 'chords',
  lead: 'lead',
}

export function surgeplusProductionRole(role: string): ProductionRole {
  return SURGEPLUS_PRODUCTION_ROLE[role] ?? 'default'
}

/** The role's STRENGTHENED production profile for the surgeplus host. Deterministic function of role,
 * no rng. Not the shared genkit profile: surgeplus fixes the "twin problem" (measured — a surgeplus
 * render landed within 0.5 dB RMS of its surge sibling, so the owner heard duplicates and it scored
 * 0% wins). The genkit chords/lead profile is mild (chorus 0.3, sat 0.18/0.25, revb 0.28, air +2.5)
 * AND its two biggest width moves — the osc-bank stack and utility — were being dropped on the
 * sample host, leaving only faint chorus/eq. This profile instead LEANS on exactly what the drums-
 * kind sample host renders offline (verified: the reorderable chain reconciles on drums as on synth,
 * Phase 26 Stream DC — so utility + auto-pan ARE available; only the osc bank and the synth-only duck
 * are not): assertive chorus, the mid/side utility widener, slow auto-pan motion, saturation glue,
 * bigger reverb/delay sends, and a firm air shelf. Role-aware: bass stays mono-anchored (no wide
 * utility, no auto-pan that would smear the sub — research 115 §2.2) but is still audibly produced
 * via saturation-forward glue + air + a touch of chorus; chords/lead get the full width stack. */
export function surgeplusProfile(role: string): ProductionProfile {
  const r = surgeplusProductionRole(role)
  if (r === 'bass') {
    return {
      role: r,
      chorusMix: 0.3,
      saturator: { drive: 0.4, mix: 0.45 },
      sendReverb: 0.18,
      sendDelay: 0.06,
      eqHigh: 4,
    }
  }
  return {
    role: r,
    chorusMix: 0.55,
    utilityWidth: 0.85,
    autoPan: { rate: 0.15, depth: 0.4, mix: 0.3 },
    saturator: { drive: 0.3, mix: 0.4 },
    sendReverb: 0.42,
    sendDelay: 0.16,
    eqHigh: 5,
  }
}

/** Minimal drums-kind host for the surge render: one track ("surge") the CLI registers the surge WAV
 * into as a sample lane (beat source add -> media/) before buildSurgeSampleHost declares the lane
 * and writes one hit at step 0. The voice is deliberately NEUTRAL — a wide-open filter and a FLAT
 * amp envelope (decay 0 = no percussive ramp, so the full multi-second render plays through, gated
 * only by the buffer end, not a drum-hit envelope) — so the only colour the production pass adds is
 * its own. Emitted as text and parse-validated by the caller, same discipline as keymapScratchText. */
export function surgeSampleHostText(bpm: number): string {
  return [
    'format_version 0.11',
    `bpm ${Math.round(bpm)}`,
    'loop_bars 4',
    'selected_track surge',
    '',
    'track surge Surge #61afef drums',
    '  synth',
    '    osc triangle',
    `    volume ${SHOWDOWN_PROMINENT_DB}`,
    '    cutoff 18000',
    '    resonance 0',
    '    attack 0.001',
    '    decay 0',
    '    sustain 1',
    '    release 0.05',
    '    pan 0',
    '',
  ].join('\n')
}

/** Build the surgeplus host from the parsed surgeSampleHostText scratch (AFTER the CLI registered
 * the surge WAV as `sampleId` in its media block): materialize the host's default lanes, keep ONE,
 * re-back it with the surge sample, and add a single hit at step 0 so the render plays once through
 * the drum bus. Notes/hits are held constant against the plain surge clip by construction — only the
 * production (added by applySurgeplusProduction) varies. */
export function buildSurgeSampleHost(scratchDoc: BeatDocument, sampleId: string): BeatDocument {
  const trackId = SURGEPLUS_TRACK_ID
  let doc = materializeLanes(scratchDoc, trackId).doc
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track || track.kind !== 'drums') throw new BeatBatchError(`surgeplus host needs drums track "${trackId}" on the scratch`)
  const laneName = track.lanes[0]?.name
  if (laneName === undefined) throw new BeatBatchError(`surgeplus host track "${trackId}" materialized no lanes`)
  // drop every other default lane so the host is a single clean voice playing the surge render
  for (const l of track.lanes.slice(1)) doc = removeLane(doc, trackId, l.name).doc
  doc = setLaneSample(doc, trackId, laneName, { sample: sampleId, gainDb: 0, tune: 0 })
  doc = addHit(doc, trackId, { lane: laneName, start: 0, velocity: 0.9 }).doc
  return doc
}

/** Apply the surgeplus production pass to the built host — the strengthened surgeplusProfile through
 * the shared applyProducedDefaults primitive (the same one engineplus wraps), with sampleHostWidth
 * so the drums-kind sample host gets the utility + auto-pan inserts too (they render on drums via the
 * reorderable chain — see the section note). Returns the produced doc and the honest `applied` list
 * (only the moves that actually landed; the osc-bank width stack has no target on a sample voice and
 * is silently dropped, and the profile sets no duck since it no-ops on a drums voice offline). */
export function applySurgeplusProduction(doc: BeatDocument, role: string): ProducedResult {
  return applyProducedDefaults(doc, SURGEPLUS_TRACK_ID, surgeplusProfile(role), { sampleHostWidth: true })
}

// ---- per-batch nuisance draws (the figure-source experiment's control) -------------------------
// A showdown batch has exactly ONE variable under test at a time — today, `figureSource` (bank /
// theory / ca2 / midi). Everything else the batch happens to need — WHICH taste-seed song supplies
// the host doc and therefore the key, WHICH engine preset the engine/engineplus clips wear, WHICH
// ref chop is drawn, WHICH gen/keymap prompt style is asked for, and the gen/keymap generation
// seeds — are NUISANCE variables. They must be identical between two arms run at the same
// `--seed`, or the comparison measures arm + four confounds.
//
// WHY THIS IS A FUNCTION AND NOT SEVEN `rng()` CALLS IN THE CLI LOOP. The draws used to come off a
// single sequential `mulberry32(metaSeed)` stream walked across the whole run. That happened to be
// correct — every draw sat at the TOP of the loop body, above any arm-conditional code — but only
// by accident of statement order, and nothing tested it. Adding one `rng()` call anywhere lower in
// that ~500-line body (i.e. anywhere in the arm-specific code) would shift every subsequent
// batch's nuisance draws, which is precisely the hazard src/core/rng.ts's header describes. Round
// 6 (2026-07-25) shipped an unreadable figure-source comparison for the adjacent reason — three
// arms run at three different `--seed`s — so the failure mode is not hypothetical.
//
// Keying the sub-stream on the ROLE NAME rather than its index in `--roles` is deliberate and buys
// a second property the sequential stream did not have: `--roles chords` and `--roles bassline,chords`
// now produce the SAME chords batch, so a round can be re-run one role at a time (e.g. after a
// per-role failure) without disturbing the others.

/** The nuisance draws for ONE showdown batch — everything the batch needs that is NOT the variable
 * under test. A pure function of (metaSeed, round, role) plus the two pool sizes it indexes into;
 * it takes no figure-source / arm parameter BY CONSTRUCTION, which is what makes two arms at one
 * seed comparable. */
export interface ShowdownBatchPlan {
  /** seeds the composed figure, the engine-preset pick, the surge-patch pick and the clip shuffle */
  batchSeed: number
  /** `--count`-style seed passed to the gen backend for the gen clip */
  genSeed: number
  /** generation seed for the keymap clip's one-shot(s) */
  kmSeed: number
  /** index into `genStyles()` for the gen clip's prompt style */
  styleIndex: number
  /** index into `genStyles()` for the keymap one-shot's prompt style */
  kmStyleIndex: number
  /** rotation offset into the role's ref pool (the audibility/role screens scan forward from it) */
  refPick: number
  /** index into the taste-seed songs that actually carry this role's track */
  seedIndex: number
  /** seeds the genre/mood variant `genSubjectVaried` picks for the gen clip's phrase prompt.
   * A seed rather than an index because the variant pool is per-role and sized in seeds.ts, not
   * here — the caller turns it into its own one-draw stream. */
  genSubjectSeed: number
}

/** FNV-1a over the batch's identity, so the sub-stream seed is stable across machines and across
 * any reordering of `--roles`. Kept private: the seed is an implementation detail of the plan, and
 * `drawShowdownBatchPlan` is the only supported way to obtain the draws. */
function batchStreamSeed(metaSeed: number, round: number, role: string): number {
  let h = 0x811c9dc5
  for (const ch of `${metaSeed}|${round}|${role}`) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Draw one batch's nuisance variables. Deterministic in (metaSeed, round, role); independent of
 * the figure source, of which optional arms (`--with-produced` / `--with-surge` / `--with-layered`)
 * are on, and of how many roles the run asks for. */
export function drawShowdownBatchPlan(opts: {
  metaSeed: number
  round: number
  role: string
  /** `genStyles().length` — the prompt-style pool the two style indices address */
  styleCount: number
  /** how many taste-seed songs carry this role's track */
  candidateCount: number
}): ShowdownBatchPlan {
  const { metaSeed, round, role, styleCount, candidateCount } = opts
  if (!(styleCount > 0)) throw new BeatBatchError(`showdown batch plan needs a non-empty style pool (got ${styleCount})`)
  if (!(candidateCount > 0)) throw new BeatBatchError(`showdown batch plan needs at least one candidate seed song (got ${candidateCount})`)
  const rng = mulberry32(batchStreamSeed(metaSeed, round, role))
  return {
    batchSeed: Math.floor(rng() * 100000),
    genSeed: Math.floor(rng() * 100000),
    kmSeed: Math.floor(rng() * 100000),
    styleIndex: Math.floor(rng() * styleCount),
    kmStyleIndex: Math.floor(rng() * styleCount),
    refPick: Math.floor(rng() * 100000),
    seedIndex: Math.floor(rng() * candidateCount),
    // APPENDED, never inserted: every draw above keeps its historical value only because this one
    // comes last in the stream.
    genSubjectSeed: Math.floor(rng() * 100000),
  }
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
 * `source` records. When any clip is a ref OR a surge/surgeplus render, a `.gitignore` covering the
 * whole dir is written too: ref working copies are private derivatives of commercial music, and
 * surge (and surgeplus, the same surge audio produced) renders carry Surge XT's still-unresolved
 * factory-patch CONTENT license (research 114 §2.1, surge issue #6741) — neither may land in git
 * even when a collection dir sits inside a repo (docs/source-showdown-eval.md, licensing stance). */
export function writeShowdownBatch(
  outDir: string,
  role: string,
  clips: { file: string; source: { kind: ShowdownSourceKind; from?: string } }[],
  opts: { seed?: number; figureSource?: 'midi' | 'bank' | 'theory' | 'ca2'; genProvider?: string } = {},
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
    ...(opts.figureSource !== undefined ? { figureSource: opts.figureSource } : {}),
    // only when the batch actually HAS a gen clip — "no generator was involved" and "we forgot to
    // record which one" must stay distinguishable, the same discipline refPools/trainingExcluded use
    ...(opts.genProvider !== undefined && clips.some((c) => c.source.kind === 'gen') ? { genProvider: opts.genProvider } : {}),
    variants: clips.map((c) => ({ file: c.file, source: c.source })),
  }
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  // The gitignore gate (docs/source-showdown-eval.md licensing stances): ref working copies are
  // private chops of commercial audio; surge renders — and surgeplus, which is the SAME surge audio
  // through a production pass — carry the unresolved factory-patch content license; midi-figure
  // batches render DERIVATIVES of MIDI transcriptions of copyrighted songs (and their manifests
  // carry the midi path). None may ever land in git.
  if (clips.some((c) => c.source.kind === 'ref' || c.source.kind === 'surge' || c.source.kind === 'surgeplus') || opts.figureSource === 'midi') {
    writeFileSync(resolve(outDir, '.gitignore'), '# showdown batch containing private ref/surge/midi-derived clips — never committed (docs/source-showdown-eval.md)\n*\n')
  }
  return manifest
}

// ---- duration matching (frame math, no DSP) ----------------------------------------------------

interface WavData {
  /** EFFECTIVE format tag (1 = integer PCM, 3 = float) — WAVE_FORMAT_EXTENSIBLE is already
   * resolved by the shared reader, and writeWavData below emits this plain tag in its 16-byte
   * fmt chunk, so an extensible input comes back out as an ordinary readable wav. */
  formatTag: number
  channels: number
  sampleRate: number
  bitsPerSample: number
  blockAlign: number
  data: Uint8Array
}

/** Read a batch clip through the ONE shared wav reader (src/metrics/wav.ts) — same chunk walk,
 * same EXTENSIBLE resolution, same format-support list as decodeWav and applyWavGain. This used
 * to be a narrower private re-implementation that rejected WAVE_FORMAT_EXTENSIBLE, which is how
 * most modern 24-bit encoders tag their files (2026-07-26 eval-integrity hunt, H1). */
function readWavData(path: string): WavData {
  const bytes = readFileSync(path)
  let info: WavFormatInfo
  try {
    info = readWavFormat(bytes)
  } catch (err) {
    throw new BeatBatchError(`${path}: ${(err as Error).message}`)
  }
  const data = bytes.subarray(info.dataOffset, info.dataOffset + info.frames * info.blockAlign)
  return {
    formatTag: info.format,
    channels: info.channels,
    sampleRate: info.sampleRate,
    bitsPerSample: info.bitsPerSample,
    blockAlign: info.blockAlign,
    data,
  }
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
 * would click. Goes through the shared per-format sample codec, so EVERY encoding readWavData
 * accepts is faded (2026-07-26 hunt, M5: this used to handle 16-bit PCM and 32-bit float only
 * while readWavData happily accepted 24-bit, so every trimmed 24-bit clip — i.e. the ref arm, the
 * pool is overwhelmingly 24-bit — got a HARD CUT instead of a fade, one of them ending at full
 * scale. Silently doing nothing for an unhandled format is exactly how that hid for 950 clips). */
function applyFadeOut(w: WavData, fadeFrames: number): void {
  const codec = wavSampleCodec(w.data, { format: w.formatTag, bitsPerSample: w.bitsPerSample })
  const totalFrames = Math.floor(w.data.length / w.blockAlign)
  const start = Math.max(0, totalFrames - fadeFrames)
  for (let f = start; f < totalFrames; f++) {
    const g = fadeFrames <= 0 ? 0 : (totalFrames - f) / fadeFrames
    for (let c = 0; c < w.channels; c++) {
      const off = f * w.blockAlign + c * w.bitsPerSample / 8
      codec.write(off, codec.read(off) * g)
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

/** One batch's FINAL ranking as the log records it — the shape every blind-eval report starts
 * from, after latest-per-batch supersede and retraction handling. */
export interface LatestRankedEntry {
  batch: string
  group: string
  /** ranked pick files, best first */
  picks: string[]
  rejected: string[]
  sources: Record<string, string>
  /** score-time DSP feature vectors keyed by variant file, when the entry carries them */
  features?: Record<string, Record<string, number>>
}

/** The ONE latest-per-batch reader every blind-eval report shares (showdown, prodtask transform,
 * pilot frontier — all three had a copy, and all three had the same bug). Reads `<prefix>` groups
 * from the scores log and returns each batch's FINAL entry.
 *
 * TWO ORDERING RULES, and they are the whole reason this is shared (2026-07-26 hunt, M3):
 *   1. SUPERSEDE FIRST, over every entry with a picks ARRAY — including the empty one a
 *      "none of these are good" verdict writes. Filtering empty picks at parse time (what all
 *      three copies did) meant a retraction could never become its batch's latest entry, so a
 *      ranking the owner had explicitly taken back kept counting in the win-rate and pairwise
 *      math AND kept training the taste model — under a report line claiming the opposite.
 *   2. THEN drop retracted batches (empty picks: no winner, so nothing to imply a pair from).
 *      They are surfaced by the report's own none-good tally instead.
 * Entries with no sources map cannot be attributed to an arm and are counted as `skipped`. */
export function loadLatestRankedEntries(logPath: string, groupPrefix: string): { entries: LatestRankedEntry[]; skipped: number } {
  let text: string
  try {
    text = readFileSync(logPath, 'utf8')
  } catch {
    return { entries: [], skipped: 0 }
  }
  type Raw = {
    batch?: string
    group?: string
    picks?: { rank: number; variant: string }[]
    rejected?: string[]
    sources?: Record<string, string>
    features?: Record<string, Record<string, number>>
  }
  const latest = new Map<string, Raw>()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: Raw
    try {
      raw = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof raw.batch !== 'string' || typeof raw.group !== 'string' || !raw.group.startsWith(groupPrefix)) continue
    if (!Array.isArray(raw.picks)) continue
    latest.set(raw.batch, raw) // rule 1
  }
  const entries: LatestRankedEntry[] = []
  let skipped = 0
  for (const [batch, e] of latest) {
    if (e.picks!.length === 0) continue // rule 2
    if (e.sources === undefined || Object.keys(e.sources).length === 0) {
      skipped += 1
      continue
    }
    entries.push({
      batch,
      group: e.group!,
      picks: [...e.picks!].sort((a, b) => a.rank - b.rank).map((p) => p.variant),
      rejected: Array.isArray(e.rejected) ? e.rejected : [],
      sources: e.sources,
      ...(e.features !== undefined ? { features: e.features } : {}),
    })
  }
  return { entries, skipped }
}

/** Scored showdown entries from the log: `showdown:<role>` groups only, latest entry per batch
 * dir (same supersede rule as the taste harness), entries without a sources map skipped (they
 * cannot be attributed). */
export function loadShowdownEntries(logPath: string): { entries: ShowdownLogEntry[]; skipped: number } {
  const { entries, skipped } = loadLatestRankedEntries(logPath, 'showdown:')
  return { entries: entries.map((e) => ({ ...e, role: e.group.slice('showdown:'.length) })), skipped }
}

/** Count "none of these are good" verdicts (batch.ts recordNoneGood) per showdown role — the
 * signal the empty-picks exclusion deliberately keeps OUT of the win-rate/pairwise math but that
 * the report still wants to surface ("for lead, the owner rejected the whole board 3 times").
 * Reads `verdict: 'none-good'` on `showdown:<role>` entries; latest-per-batch, so a none-good
 * that was later re-scored (or vice versa) counts by the batch's final verdict only. */
export function noneGoodByRole(logPath: string): { byRole: { role: string; batches: number }[]; total: number } {
  let text: string
  try {
    text = readFileSync(logPath, 'utf8')
  } catch {
    return { byRole: [], total: 0 }
  }
  // latest entry per batch decides — a none-good can be superseded by a real ranking and vice versa
  const verdictByBatch = new Map<string, { role: string; noneGood: boolean }>()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: { batch?: string; group?: string; verdict?: string }
    try {
      raw = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof raw.batch !== 'string' || typeof raw.group !== 'string' || !raw.group.startsWith('showdown:')) continue
    verdictByBatch.set(raw.batch, { role: raw.group.slice('showdown:'.length), noneGood: raw.verdict === 'none-good' })
  }
  const counts = new Map<string, number>()
  for (const { role, noneGood } of verdictByBatch.values()) {
    if (noneGood) counts.set(role, (counts.get(role) ?? 0) + 1)
  }
  const byRole = [...counts.entries()].map(([role, batches]) => ({ role, batches })).sort((a, b) => a.role.localeCompare(b.role))
  return { byRole, total: byRole.reduce((s, r) => s + r.batches, 0) }
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

// ---- the figure-source axis (research 124 §B.7/§C.7 and 125 §4, audit 140 D7) ------------------
// `figureSource` records where a showdown batch's COMPOSED figures came from: 'midi' (private
// transcriptions of commercial tracks), 'theory' (the deterministic theory-aware layer, theory.ts),
// 'ca2' (Composer's Assistant 2 composing over that layer's chord track, ca2.ts) or 'bank' (the
// internal archetype bank). It is written into the batch manifest and copied into the scores-log
// entry — and for its whole existence NOTHING READ IT: the report tallied overall / by role / by
// ref-pool and no fourth axis, so the theory layer (1,294 lines) and the CA2 sidecar (a 716 MB
// out-of-repo model, a Python sidecar, guards, tests, a doctor) both shipped specifically to be
// measured by an experiment whose readout did not exist.
//
// WHY IT WAS MISSED (worth keeping, because it generalizes): `figureSource` was built as PROVENANCE
// — D25 licensing hygiene, "the shared log records only the kind, never a song title or path" — and
// the privacy framing masked that the same field is also the experimental factor.
//
// This landed first as a separate module (src/taste/figure-source-report.ts) because showdown.ts was
// being actively edited by another stream; its own header named the integration point. That stream
// merged, so the code is inlined here — the module remains as a re-export barrel so existing import
// paths and its tests keep working. Reading the split requires the batches to be COMPARABLE, which
// is what drawShowdownBatchPlan above guarantees.

/** The four labels `figureSource` can carry. Deliberately not treated as a closed union below — an
 * unknown label must show up in the report rather than being silently dropped, which is the whole
 * failure mode this readout exists to fix. */
export const FIGURE_SOURCES = ['midi', 'theory', 'ca2', 'bank'] as const
export type FigureSource = (typeof FIGURE_SOURCES)[number]

/** The label used for batches whose entry carries no `figureSource`. */
export const UNLABELLED = '(none recorded)'

export interface FigureSourceGroup {
  figureSource: string
  /** scored showdown batches carrying this label */
  batches: number
  /** per-source-kind scoreboard WITHIN this figure source — the same math the overall board uses */
  stats: SourceStat[]
  /** too few batches to read as a result — same convention and threshold as the per-role splits. */
  smoke: boolean
}

export interface FigureSourceSplit {
  logPath: string
  /** batches that had a figureSource on their entry */
  labelled: number
  /** batches with no figureSource recorded — mostly pre-dating the field */
  unlabelled: number
  groups: FigureSourceGroup[]
  /** the small-n threshold the `smoke` flags use, echoed so a caller need not import it */
  smokeMinBatches: number
  /** the transpose, and the more direct readout: for one source kind, how it fared under each
   * figure source. Comparing `engine` across 'theory' and 'ca2' is the actual experiment. */
  byKind: { kind: string; rows: { figureSource: string; stat: SourceStat }[] }[]
  /** labels declared in FIGURE_SOURCES that appear in NO scored batch. A build with zero evidence
   * is the finding, not an empty row to skip past — CA2 sat here for its whole existence. */
  neverRated: string[]
}

/**
 * Map batch dir -> figureSource, read straight from the scores log.
 *
 * The shared latest-per-batch reader (`loadLatestRankedEntries`) projects entries down to
 * picks/rejected/sources and drops `figureSource`, so it has to be recovered separately. LAST
 * writer per batch wins, matching that reader's own supersede convention: a re-scored batch's
 * newer entry is the authority. Malformed lines are skipped, exactly as the shared reader does.
 */
export function figureSourceByBatch(logPath: string): Map<string, string> {
  const out = new Map<string, string>()
  if (!existsSync(logPath)) return out
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (t === '') continue
    let e: { batch?: unknown; group?: unknown; figureSource?: unknown }
    try {
      e = JSON.parse(t)
    } catch {
      continue
    }
    if (typeof e.group !== 'string' || !e.group.startsWith('showdown:')) continue
    if (typeof e.batch !== 'string' || typeof e.figureSource !== 'string') continue
    out.set(e.batch, e.figureSource)
  }
  return out
}

function figureRank(label: string): number {
  if (label === UNLABELLED) return FIGURE_SOURCES.length + 1
  const i = (FIGURE_SOURCES as readonly string[]).indexOf(label)
  return i === -1 ? FIGURE_SOURCES.length : i
}

/** The scoreboard split by `figureSource` — the readout 124 and 125 were built to produce. */
export function figureSourceSplit(logPath: string): FigureSourceSplit {
  const { entries } = loadShowdownEntries(logPath)
  const byBatch = figureSourceByBatch(logPath)

  const buckets = new Map<string, typeof entries>()
  for (const e of entries) {
    const label = byBatch.get(e.batch) ?? UNLABELLED
    if (!buckets.has(label)) buckets.set(label, [])
    buckets.get(label)!.push(e)
  }

  const groups: FigureSourceGroup[] = [...buckets.entries()]
    .map(([figureSource, es]) => ({ figureSource, batches: es.length, stats: tally(es), smoke: es.length < SPLIT_SMOKE_MIN_BATCHES }))
    // declared order first (midi, theory, ca2, bank), then anything unexpected, then the unlabelled
    // bucket last — it is the least interesting and usually the largest.
    .sort((a, b) => figureRank(a.figureSource) - figureRank(b.figureSource) || a.figureSource.localeCompare(b.figureSource))

  const kinds = [...new Set(groups.flatMap((g) => g.stats.map((s) => s.kind)))].sort()
  const byKind = kinds.map((kind) => ({
    kind,
    rows: groups
      .map((g) => ({ figureSource: g.figureSource, stat: g.stats.find((s) => s.kind === kind) }))
      .filter((r): r is { figureSource: string; stat: SourceStat } => r.stat !== undefined),
  }))

  const seen = new Set(groups.map((g) => g.figureSource))
  return {
    logPath,
    labelled: entries.filter((e) => byBatch.has(e.batch)).length,
    unlabelled: entries.filter((e) => !byBatch.has(e.batch)).length,
    groups,
    smokeMinBatches: SPLIT_SMOKE_MIN_BATCHES,
    byKind,
    neverRated: FIGURE_SOURCES.filter((f) => !seen.has(f)),
  }
}

/** Human-facing block, in the same voice and column widths as `formatShowdownReport`. */
export function formatFigureSourceSplit(r: FigureSourceSplit): string {
  let out = `\nby figure source — where each batch's COMPOSED figures came from (research 124/125's validation axis)\n`
  if (r.labelled === 0) {
    out += `  no scored showdown batch records a figureSource yet — nothing to split.\n`
    // Still name the arms: "zero evidence" is the finding, and an early return that says only
    // "nothing to split" is how ca2 stayed invisible for its whole existence.
    if (r.neverRated.length > 0) out += `  NEVER RATED: ${r.neverRated.join(', ')} — built, integrated, and carrying zero evidence.\n`
    return out
  }
  out += `  ${r.labelled} labelled batch(es), ${r.unlabelled} without a recorded figureSource\n`
  for (const g of r.groups) {
    out += `\n  ${g.figureSource} (${g.batches} batch${g.batches === 1 ? '' : 'es'}${g.smoke ? ', SMOKE — too few to read as a result' : ''})\n`
    for (const s of g.stats) out += statLine(s, '    ')
  }
  // The transpose is the actual comparison, so print it explicitly rather than making the reader
  // hold four blocks in their head.
  const comparable = r.byKind.filter((k) => k.rows.length > 1)
  if (comparable.length > 0) {
    out += `\n  same source kind across figure sources (the comparison the experiment is for)\n`
    for (const k of comparable) {
      const cells = k.rows.map((row) => `${row.figureSource} ${pct(row.stat.pairsWon, row.stat.pairCount)} of ${row.stat.pairCount}`)
      out += `    ${k.kind.padEnd(11)} pairwise  ${cells.join('   ')}\n`
    }
  }
  if (r.neverRated.length > 0) {
    out += `\n  NEVER RATED: ${r.neverRated.join(', ')} — built, integrated, and carrying zero evidence.\n`
  }
  return out
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
  /** "None of these are good" verdicts per role (recordNoneGood) — excluded from the win-rate math
   * above (empty picks, no winner to imply pairs from) but surfaced here so the signal isn't lost. */
  noneGood: { byRole: { role: string; batches: number }[]; total: number }
  /** the figure-source axis (bank / theory / ca2 / midi) — research 124/125's validation experiment */
  figureSources: FigureSourceSplit
}

/** The minimal ranked-batch shape the per-arm tally needs — a set of ranked picks, the rejected
 * variants, and a variant->kind map. `ShowdownLogEntry` satisfies it, and so does the
 * prodtask-transform eval's own entry (src/taste/prodtask.ts reuses this tally + the formatters
 * below rather than duplicating them — research 119's report is the showdown report with a
 * different source axis). */
export interface RankedArmEntry {
  /** ranked pick files, best first */
  picks: string[]
  rejected: string[]
  /** variant file -> arm/source kind */
  sources: Record<string, string>
}

/** Per-kind win / top-half / pairwise tally over ranked batches — the shared scoreboard math for
 * BOTH the source showdown (kind = source pipeline) and the prodtask-transform eval (kind = arm).
 * Only reads picks/rejected/sources, so any RankedArmEntry works. */
export function tally(entries: RankedArmEntry[]): SourceStat[] {
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
    // Top-half is a per-BATCH fact, not a per-slot one (2026-07-26 hunt, M4). Real pilot batches
    // duplicate arms (three elites and two controls in one board), so counting every top-half SLOT
    // let one kind's topHalf exceed its `batches` — the report printed "top-half 200%". A kind
    // places top-half in a batch if ANY of its clips did.
    const topHalfKinds = new Set<string>()
    for (let i = 0; i < Math.min(topHalfRanks, e.picks.length); i++) {
      const k = e.sources[e.picks[i]!]
      if (k !== undefined) topHalfKinds.add(k)
    }
    for (const k of topHalfKinds) stat(k).topHalf += 1
    // implied pairwise comparisons: each ranked pick beats every later pick and every reject.
    // SELF-COMPARISONS ARE NOT EVIDENCE (M4): when a batch carries two clips of the same arm, one
    // of them necessarily "beats" the other, which manufactured a guaranteed win AND a guaranteed
    // loss for that arm — pulling a lopsided elite-vs-control result toward 50% purely as an
    // artifact of how many duplicate arms the board happened to hold.
    for (let wi = 0; wi < e.picks.length; wi++) {
      const w = e.sources[e.picks[wi]!]
      if (w === undefined) continue
      const losers = [...e.picks.slice(wi + 1), ...e.rejected].map((f) => e.sources[f]).filter((k): k is string => k !== undefined && k !== w)
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
export function classifyRefPool(fromPath: string): 'ref:familiar' | 'ref:unfamiliar' | 'ref:packs' | 'ref:cc0' | 'ref:other' {
  if (/refs-familiar\b/.test(fromPath)) return 'ref:familiar'
  if (/refs-unfamiliar\b/.test(fromPath)) return 'ref:unfamiliar'
  // D25 pools: refs-packs = purchased pro sample-pack loops (eval bar; EXCLUDED from critic
  // training until the vendor's ML clause is verified clean); refs-cc0 = curated Freesound CC0
  // loops (training-safe by construction — CC0 has no use restrictions)
  if (/refs-packs\b/.test(fromPath)) return 'ref:packs'
  if (/refs-cc0\b/.test(fromPath)) return 'ref:cc0'
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
    noneGood: noneGoodByRole(logPath),
    figureSources: figureSourceSplit(logPath),
  }
}

export const pct = (num: number, den: number) => (den === 0 ? '—' : `${Math.round((100 * num) / den)}%`)

/** One scoreboard line for a kind's stats — shared by the showdown and prodtask reports (padded to
 * the longest kind name so mixed-kind scoreboards stay column-aligned). */
export function statLine(s: SourceStat, indent: string): string {
  // pad to the longest kind name ('layeredplus') so mixed-kind scoreboards stay column-aligned
  return (
    `${indent}${s.kind.padEnd(11)} win ${pct(s.wins, s.batches)} (${s.wins}/${s.batches})` +
    `  top-half ${pct(s.topHalf, s.batches)} (${s.topHalf}/${s.batches})` +
    `  pairwise ${pct(s.pairsWon, s.pairCount)} of ${s.pairCount}\n`
  )
}

/** Human-facing scoreboard, honest about sample size (smoke labels per role AND overall). */
export function formatShowdownReport(r: ShowdownReport): string {
  let out = `source showdown — per-source win rates over ${r.totalBatches} scored showdown batch(es) in ${r.logPath}\n`
  if (r.skipped > 0) out += `(${r.skipped} showdown-group entr${r.skipped === 1 ? 'y' : 'ies'} skipped: no per-variant source record)\n`
  if (r.noneGood.total > 0) {
    out += `none-good verdicts (whole board rejected — excluded from the win rates above): ${r.noneGood.total} batch(es)` +
      ` [${r.noneGood.byRole.map((n) => `${n.role} ${n.batches}`).join(', ')}]\n`
  }
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
  out += formatFigureSourceSplit(r.figureSources)
  out += `(win = ranked best; top-half = ranked in the top ceil(n/2) picks; pairwise = implied comparisons won; ref clips are counted by KIND only — their identity stays in the batch dir)\n`
  return out
}
