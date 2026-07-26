// The CA2 figure source for the showdown (research/124 §A.4, research/125 §4) — a MODEL composer
// over the deterministic chord track.
//
// research/124 §A.4's conclusion, restated: general LLMs write valid-but-shallow music and small
// specialized models are strong note-generators with no idea what the track needs, so the
// architecture the evidence supports is LLM-as-ORCHESTRATOR — our code decides key, chord track,
// register, and density; the model proposes notes. research/125 then ran the four dotbeat
// workflows through three models on this hardware and found Composer's Assistant 2 (Malandro,
// ISMIR 2024; MIT code, public-domain/permissive training data) the only one worth the integration
// cost: sparse where it should be sparse, real in-key accompaniment, purpose-built controls, every
// task under 3s on MPS. This module is the wiring it earned.
//
// The division of labour is exactly §A.4's, and it is why this file is thin on musical opinion:
//
//   * the THEORY layer (src/taste/theory.ts) is the orchestrator. buildChordTrack picks the
//     weighted, function-tagged progression, the harmonic rhythm, the cadence, the planing — the
//     harmonic source of truth. This module hands that track to CA2 as MIDI context and asks for
//     one role's notes over it, with the register and onset-density bins our code chose.
//   * CA2 (python/ca2_figures.py) only proposes notes.
//   * the theory layer's own GUARDS then have the last word: enforceBassRegister for the sub
//     register, snap-to-scale for out-of-key notes that aren't chord tones of the sounding chord,
//     and the pre-render lint (scaleConsistency / registerRuleViolations / grooveConsistency).
//     A figure that still trips the lint is REJECTED and reseeded, up to 3 times. Model output is
//     corrected and counted, never silently accepted (every correction lands in the returned
//     `ca2` block so a batch can be audited after the fact).
//
// composeCA2Phrase mirrors composeTheoryPhrase's contract exactly (role, key, seed, exclude) and
// returns the same ComposedPhrase shape applyComposedPhrase already consumes, so `ca2` slots into
// the showdown figure-draw machinery beside 'bank' / 'midi' / 'theory' with no pipeline change.
// The one difference is that it is ASYNC (there's a sidecar process behind it).
//
// PROVENANCE / WEIGHTS: CA2's checkout and its 716MB release weights live OUTSIDE the repo behind
// BEAT_CA2_DIR / BEAT_CA2_PYTHON (research/125 §2 documents the install). Its training set is
// public-domain and permissively-licensed MIDI only — the cleanest provenance in the survey
// (research/124 §A.3) — so ca2 batches carry no third-party-content posture: no gitignore gate,
// and the scores log records only the figureSource label 'ca2'.

import { join } from 'node:path'
import { lastNonEmptyLine, repoRoot, resolvePython, sidecarDoctor as runSidecarDoctor, spawnSidecar, type SpawnResult } from '../analysis/spawn-sidecar.js'
import { BeatBatchError } from '../vary/batch.js'
import { mulberry32 } from './eval.js'
import {
  buildChordTrack,
  chordAtStep,
  enforceBassRegister,
  lintFigure,
  scaleConsistency,
  snapToScale,
  type ChordTrack,
  type ChordTrackOptions,
  type LintReport,
} from './theory.js'
import { scalePitchClasses, chooseSeeded, type ComposedNote, type ComposedPhrase, type PhraseKey } from './phrase.js'

const CA2_PY = 'python/ca2_figures.py' // relative to the repo root, like every sidecar

/** The sidecar payload contract this build speaks (python/ca2_figures.py CONTRACT_VERSION). */
export const CA2_CONTRACT_VERSION = 1

/** Roles CA2 composes. drum-loop is absent on purpose: CA2 is a pitched multi-track infiller and
 * dotbeat's drum lanes are a kit-mapped grid, not GM percussion — the drum-loop role keeps the
 * archetype bank (the same posture --midi-dir takes). */
export type CA2Role = 'bassline' | 'chords' | 'lead'

export function isCA2Role(role: string): role is CA2Role {
  return role === 'bassline' || role === 'chords' || role === 'lead'
}

export const CA2_SETUP_HINT =
  'CA2 figures need an out-of-repo Composer\'s Assistant 2 install: set BEAT_CA2_DIR to its ' +
  'Scripts/composers_assistant_v2 dir and BEAT_CA2_PYTHON to a venv python with ' +
  'python/requirements-ca2.txt — run `beat showdown --ca2-doctor` for the full report'

// ---- the orchestrator's asks --------------------------------------------------------------------
// Our code decides register and density (§A.4). Registers are the theory layer's own, relative to
// the key root, so a CA2 figure lands in the same octave a theory figure would. The density ASKS
// double as the exclude-chain label ('ca2:<ask>'), so two composed sources in one batch never get
// the same request — the same contract the bank archetypes and 'theory:' labels use.

/** Per-role pitch window handed to CA2 as its loose lowest/highest-note bounds, as semitone
 * offsets from the key root (48..59). Bass sits under the theory register floor (48) by design —
 * enforceBassRegister has the last word on what may live down there. */
export const CA2_ROLE_REGISTER_OFFSETS: Record<CA2Role, { lo: number; hi: number }> = {
  bassline: { lo: -20, hi: 4 },
  chords: { lo: 9, hi: 28 },
  lead: { lo: 17, hi: 36 },
}

/** A density/temperature ask: CA2's onset-density bins (constants.py — horiz 0..5 onsets per beat,
 * vert 0..4 notes per onset) plus the sampling temperature. */
export interface CA2Ask {
  name: string
  horiz: number
  vert: number
  temperature: number
}

/** The per-role ask bank. These are the ORCHESTRATOR's decisions, not archetypes: each one is a
 * different density/temperature request over the same chord track. Exclude-chained by label. */
export const CA2_ROLE_ASKS: Record<CA2Role, readonly CA2Ask[]> = {
  bassline: [
    { name: 'sub-hold', horiz: 1, vert: 1, temperature: 0.95 },
    { name: 'roller', horiz: 2, vert: 1, temperature: 1.0 },
    { name: 'driving', horiz: 3, vert: 1, temperature: 1.05 },
    { name: 'sparse-anchor', horiz: 0, vert: 1, temperature: 1.0 },
  ],
  chords: [
    { name: 'pad-hold', horiz: 0, vert: 3, temperature: 0.95 },
    { name: 'stabs', horiz: 1, vert: 3, temperature: 1.0 },
    { name: 'pulse', horiz: 2, vert: 3, temperature: 1.0 },
    { name: 'wide-voicing', horiz: 1, vert: 4, temperature: 1.05 },
  ],
  lead: [
    { name: 'sparse-motif', horiz: 1, vert: 1, temperature: 0.95 },
    { name: 'phrase', horiz: 2, vert: 1, temperature: 1.0 },
    { name: 'arp', horiz: 3, vert: 1, temperature: 1.05 },
    { name: 'long-tones', horiz: 0, vert: 1, temperature: 1.0 },
  ],
}

const CA2_ROLE_SALTS: Record<CA2Role, number> = { bassline: 2311, chords: 2477, lead: 2683 }

/** The label a CA2 figure carries in the manifest and the per-role exclude chain. Prefixed 'ca2:'
 * so it can never collide with a bank archetype, a 'theory:' label, or a midi figure label. */
export const ca2FigureLabel = (ask: string): string => `ca2:${ask}`

/** First ask of a seeded shuffle not excluded this run (every one used -> seeded pick anyway),
 * through the shared selector in phrase.ts so all four figure sources have ONE implementation of
 * the CLI's per-role exclude-chain contract. */
export function chooseCA2Ask(rng: () => number, asks: readonly CA2Ask[], exclude: readonly string[]): CA2Ask {
  return chooseSeeded(rng, asks, (a) => ca2FigureLabel(a.name), exclude)
}

// ---- the sidecar request/response contract ------------------------------------------------------

export interface CA2RequestChord {
  bar: number
  bars: number
  /** the chord root as an absolute midi pitch */
  root: number
  /** the chord's tones as absolute midi pitches, root-first */
  tones: number[]
}

export interface CA2Request {
  role: CA2Role
  key: { root: number; minor: boolean; mode?: string }
  bpm: number
  bars: number
  seed: number
  register: { lo: number; hi: number }
  chordTrack: CA2RequestChord[]
  density: { horiz: number; vert: number }
  temperature: number
}

export interface CA2Payload {
  backend: string
  contract: number
  model: string
  device: string
  role: CA2Role
  seed: number
  bars: number
  generatedNotes: number
  wallSeconds: number
  notes: ComposedNote[]
}

/** The theory layer's ChordTrack as the sidecar's absolute-pitch chord list. `rootOffset`/`tones`
 * are semitones above the key root; the pad register (root + 12) is where the context MIDI sounds,
 * which keeps a planed stab track from colliding with the bass guide. */
export function chordTrackToRequestChords(track: ChordTrack): CA2RequestChord[] {
  return track.chords.map((c) => ({
    bar: c.startBar,
    bars: c.bars,
    root: track.key.root + c.rootOffset,
    tones: c.tones.map((t) => track.key.root + t),
  }))
}

/** Build the full sidecar request for one role over one chord track. */
export function buildCA2Request(role: CA2Role, track: ChordTrack, ask: CA2Ask, seed: number, bpm: number): CA2Request {
  const off = CA2_ROLE_REGISTER_OFFSETS[role]
  const clamp = (p: number): number => Math.max(0, Math.min(127, p))
  return {
    role,
    key: { root: track.key.root, minor: track.key.minor, ...(track.key.mode ? { mode: track.key.mode } : {}) },
    bpm,
    bars: track.bars,
    seed,
    register: { lo: clamp(track.key.root + off.lo), hi: clamp(track.key.root + off.hi) },
    chordTrack: chordTrackToRequestChords(track),
    density: { horiz: ask.horiz, vert: ask.vert },
    temperature: ask.temperature,
  }
}

/** Validate the sidecar's stdout JSON. A malformed payload must fail HERE with a specific message,
 * not as NaN pitches at render time (the midifig.ts posture). */
export function validateCA2Payload(raw: unknown): CA2Payload {
  const fail = (why: string): never => {
    throw new BeatBatchError(`ca2_figures payload invalid: ${why}`)
  }
  if (typeof raw !== 'object' || raw === null) fail('not an object')
  const r = raw as Record<string, unknown>
  if (r.backend !== 'ca2') fail(`backend must be "ca2" (got ${String(r.backend)})`)
  if (r.contract !== CA2_CONTRACT_VERSION) fail(`contract ${String(r.contract)} != ${CA2_CONTRACT_VERSION} (sidecar/TS version skew)`)
  if (!isCA2Role(String(r.role))) fail(`role must be bassline|chords|lead (got ${String(r.role)})`)
  if (typeof r.bars !== 'number' || !Number.isInteger(r.bars) || r.bars < 1) fail('bars must be a positive integer')
  if (typeof r.seed !== 'number') fail('missing seed')
  const maxStep = (r.bars as number) * 16
  if (!Array.isArray(r.notes) || r.notes.length === 0) fail('empty notes')
  const notes: ComposedNote[] = (r.notes as unknown[]).map((n, i) => {
    const note = n as Record<string, unknown>
    const { pitch, start, duration, velocity } = note
    if (typeof pitch !== 'number' || !Number.isInteger(pitch) || pitch < 0 || pitch > 127) fail(`note ${i}: pitch out of range`)
    if (typeof start !== 'number' || !Number.isInteger(start) || start < 0 || start >= maxStep) fail(`note ${i}: start ${String(start)} outside 0..${maxStep - 1}`)
    if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1) fail(`note ${i}: duration must be a positive integer`)
    if (typeof velocity !== 'number' || velocity < 0 || velocity > 1) fail(`note ${i}: velocity must be 0..1`)
    return { pitch: pitch as number, start: start as number, duration: duration as number, velocity: velocity as number }
  })
  return {
    backend: 'ca2',
    contract: CA2_CONTRACT_VERSION,
    model: typeof r.model === 'string' ? r.model : 'ca2',
    device: typeof r.device === 'string' ? r.device : 'unknown',
    role: r.role as CA2Role,
    seed: r.seed as number,
    bars: r.bars as number,
    generatedNotes: typeof r.generatedNotes === 'number' ? (r.generatedNotes as number) : notes.length,
    wallSeconds: typeof r.wallSeconds === 'number' ? (r.wallSeconds as number) : 0,
    notes,
  }
}

// ---- sidecar spawn -------------------------------------------------------------------------------

/** The interpreter that runs ca2_figures.py. CA2 needs torch + transformers + miditoolkit, which
 * live in a SEPARATE out-of-repo venv from dotbeat's own python/.venv (research/125 §2 reused the
 * trial's python3.10 venv), so it gets its own override: BEAT_CA2_PYTHON, then the compose-lab
 * trial venv if it's there, then whatever resolvePython() finds. */
export function resolveCA2Python(): string {
  return resolvePython({
    envVar: 'BEAT_CA2_PYTHON',
    extraCandidates: [join(repoRoot, '..'), join(repoRoot, '..', '..', '..', '..'), join(process.env.HOME ?? '', 'Documents', 'dotbeat')]
      .map((base) => join(base, 'taste-dataset', 'compose-lab', 'tools', 'amt-venv', 'bin', 'python3')),
  })
}

function spawnCA2(args: string[], stdin?: string): Promise<SpawnResult> {
  return spawnSidecar({ python: resolveCA2Python(), args, ...(stdin !== undefined ? { stdin } : {}) })
}

/** Run one CA2 generation. Throws BeatBatchError on every failure mode with the sidecar's own last
 * stderr line; exit 3 (missing install/deps) appends the setup hint. NEVER falls back silently —
 * the caller's contract is "loud failure, never a substituted bank figure". */
export async function runCA2(request: CA2Request): Promise<CA2Payload> {
  const res = await spawnCA2([CA2_PY, '--request', '-'], JSON.stringify(request))
  if (res.enoent) throw new BeatBatchError(`no Python interpreter found for ca2_figures (tried "${resolveCA2Python()}") — ${CA2_SETUP_HINT}`)
  if (res.code !== 0) {
    const detail = lastNonEmptyLine(res.stderr) || `exit ${res.code}`
    throw new BeatBatchError(`ca2_figures (${request.role}, seed ${request.seed}) failed: ${detail}${res.code === 3 ? ` — ${CA2_SETUP_HINT}` : ''}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(res.stdout)
  } catch {
    throw new BeatBatchError(`ca2_figures produced non-JSON stdout: ${res.stdout.slice(0, 200)}`)
  }
  return validateCA2Payload(raw)
}

/** The sidecar's --doctor (or --smoke) JSON plus the resolved interpreter — mirrors
 * sidecarDoctor / surgeDoctor / midiExtractDoctor. Never throws. */
export async function ca2Doctor(opts: { smoke?: boolean } = {}): Promise<Record<string, unknown>> {
  return runSidecarDoctor(CA2_PY, {
    python: resolveCA2Python(),
    args: [opts.smoke === true ? '--smoke' : '--doctor'],
    label: 'ca2_figures',
    base: { backend: 'ca2' },
    failure: { available: false, fix: CA2_SETUP_HINT },
  })
}

/** True iff the doctor report says the checkout, the weights, and every package are present. */
export function ca2Available(report: Record<string, unknown>): boolean {
  return report.available === true
}

// ---- guards: the theory layer has the last word --------------------------------------------------

export interface CA2Corrections {
  /** sub-register notes lifted an octave by enforceBassRegister (bassline only) */
  registerLifted: number
  /** out-of-key, non-chord-tone notes snapped to the scale */
  scaleSnapped: number
  /** notes folded by whole octaves back into the requested register window */
  rangeFolded: number
  /** scale consistency BEFORE any correction — the honest measure of what CA2 handed back */
  rawScaleConsistency: number
}

/** Apply the theory layer's own guards to raw model output. Every correction is COUNTED, so a
 * batch can be audited after the fact rather than trusting the model silently:
 *
 *   1. range fold — whole octaves back into the register window our code asked for (a model that
 *      ignores a loose bound gets moved, not dropped);
 *   2. scale snap — a note whose pitch class is outside the key's scale AND is not a tone of the
 *      chord sounding under it is snapped to the nearest scale pitch. Chord tones are exempt
 *      because our OWN chord track declared them legal (a cadential harmonic-minor leading tone is
 *      chromatic in natural minor and must survive);
 *   3. bass register rule — enforceBassRegister on every bassline note against its chord root, the
 *      "below ~130 Hz only root/5th/octave" rule (§C.2).
 */
export function guardCA2Notes(role: CA2Role, notes: readonly ComposedNote[], track: ChordTrack, register: { lo: number; hi: number }): { notes: ComposedNote[]; corrections: CA2Corrections } {
  const key = track.key
  const scale = scalePitchClasses(key)
  const rootPc = ((key.root % 12) + 12) % 12
  const corrections: CA2Corrections = { registerLifted: 0, scaleSnapped: 0, rangeFolded: 0, rawScaleConsistency: scaleConsistency(notes, key) }
  const out: ComposedNote[] = notes.map((n) => ({ ...n }))
  for (const n of out) {
    // 1. range fold
    const before = n.pitch
    let guard = 0
    while (n.pitch < register.lo && guard < 10) { n.pitch += 12; guard += 1 }
    while (n.pitch > register.hi && guard < 20) { n.pitch -= 12; guard += 1 }
    if (n.pitch !== before) corrections.rangeFolded += 1

    // 2. scale snap (chord tones of the sounding chord are exempt)
    const chord = chordAtStep(track, Math.floor(n.start))
    const chordPcs = new Set(chord.tones.map((t) => (((key.root + t) % 12) + 12) % 12))
    const pc = (((n.pitch - rootPc) % 12) + 12) % 12
    if (!scale.includes(pc) && !chordPcs.has(((n.pitch % 12) + 12) % 12)) {
      const snapped = snapToScale(n.pitch, key)
      if (snapped !== n.pitch) {
        n.pitch = snapped
        corrections.scaleSnapped += 1
      }
    }

    // 3. bass register rule
    if (role === 'bassline') {
      const chordRoot = key.root - 12 + chord.rootOffset
      const lifted = enforceBassRegister(n.pitch, chordRoot)
      if (lifted !== n.pitch) {
        n.pitch = lifted
        corrections.registerLifted += 1
      }
    }
    n.pitch = Math.max(0, Math.min(127, n.pitch))
  }
  out.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  return { notes: out, corrections }
}

// ---- public entry point --------------------------------------------------------------------------

/** Reseed budget on a lint rejection. 3 reseeds = up to 4 CA2 calls, ~1-3s each on MPS
 * (research/125 §2), so a gross-failure retry loop stays inside a batch's time budget. */
export const CA2_MAX_RESEEDS = 3

/** The stride between reseed attempts — a large odd number so a reseed lands far from the seeds
 * neighbouring clips in the same batch are using. */
const RESEED_STRIDE = 7919

export interface CA2Provenance {
  ask: string
  model: string
  device: string
  /** how many times the figure was REJECTED by the lint and regenerated (0 = clean first try) */
  reseeds: number
  /** the seed that actually produced the accepted figure (= seed + reseeds * 7919) */
  acceptedSeed: number
  /** lint flags still present on the accepted figure (non-empty only when the budget ran out) */
  unresolvedFlags: string[]
  corrections: CA2Corrections
  generatedNotes: number
  wallSeconds: number
}

export type CA2Phrase = ComposedPhrase & { lint: LintReport; chordTrack: ChordTrack; ca2: CA2Provenance }

/** One 4-bar CA2 figure for a pitched role — the model composing OVER the deterministic chord
 * track. Same contract as composeTheoryPhrase (role, key, seed, opts.exclude) returning the same
 * ComposedPhrase shape, so the showdown pipeline consumes it unchanged; async because a sidecar
 * process is behind it.
 *
 * Flow: buildChordTrack (our harmony) -> choose a density ask (our density) -> CA2 proposes notes
 * -> guardCA2Notes (our register/scale rules) -> lintFigure. A figure that still trips the lint is
 * REJECTED and regenerated at a fresh seed, up to CA2_MAX_RESEEDS times; the last attempt is
 * returned with its flags recorded rather than throwing, so one stubborn figure degrades to a
 * flagged-but-rated clip exactly as a flagged theory figure does.
 *
 * Throws BeatBatchError (never falls back to the bank) when the sidecar or the CA2 install is
 * unavailable — the CLI turns that into a loud batch failure with the setup hint. */
export async function composeCA2Phrase(
  role: CA2Role,
  key: PhraseKey,
  seed: number,
  opts: { exclude?: readonly string[]; chordTrack?: ChordTrackOptions; bpm?: number } = {},
): Promise<CA2Phrase> {
  const rng = mulberry32(seed + CA2_ROLE_SALTS[role])
  const ask = chooseCA2Ask(rng, CA2_ROLE_ASKS[role], opts.exclude ?? [])
  const track = buildChordTrack(key, seed, opts.chordTrack)
  const bpm = opts.bpm ?? 124

  let best: { notes: ComposedNote[]; lint: LintReport; corrections: CA2Corrections; payload: CA2Payload; attempt: number } | null = null
  let attemptsSpent = 0
  for (let attempt = 0; attempt <= CA2_MAX_RESEEDS; attempt++) {
    attemptsSpent = attempt
    const attemptSeed = seed + attempt * RESEED_STRIDE
    const request = buildCA2Request(role, track, ask, attemptSeed, bpm)
    const payload = await runCA2(request)
    const { notes, corrections } = guardCA2Notes(role, payload.notes, track, request.register)
    const lint = lintFigure(notes, track)
    if (best === null || lint.flags.length < best.lint.flags.length) best = { notes, lint, corrections, payload, attempt }
    if (lint.flags.length === 0) break
  }
  const chosen = best!
  return {
    archetype: ca2FigureLabel(ask.name),
    notes: chosen.notes,
    lint: chosen.lint,
    chordTrack: track,
    ca2: {
      ask: ask.name,
      model: chosen.payload.model,
      device: chosen.payload.device,
      // budget SPENT (not the chosen attempt's index): a figure whose flags never cleared
      // reports the full budget even when an earlier attempt was kept as the least-bad one.
      reseeds: attemptsSpent,
      acceptedSeed: seed + chosen.attempt * RESEED_STRIDE,
      unresolvedFlags: chosen.lint.flags,
      corrections: chosen.corrections,
      generatedNotes: chosen.payload.generatedNotes,
      wallSeconds: chosen.payload.wallSeconds,
    },
  }
}
