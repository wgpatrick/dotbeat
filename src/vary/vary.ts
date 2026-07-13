// `beat vary` — rung 1 of the variation-and-taste loop (docs/variation-loop.md,
// docs/research/08-variation-loop-prior-art.md). Every design number here is anchored to the
// verified prior art: batches default to 9 (MutaSynth's population, sized for serial
// auditioning), mutation is scoped to ONE named parameter group at a time and mapped through
// musically-nonlinear ranges (Dahlstedt: nonlinear translation curves "make the most musically
// useful values more probable"; "the more universal I make the sound engine, the smaller the
// portion of useful sounds"), and there is exactly one user-facing strength knob (Edisyn
// removed the second knob because it confused users).
//
// Pure document -> documents; deterministic under a seed (same parent + group + amount + seed
// -> byte-identical variants), so a scoring session is reproducible from its manifest.

import type { BeatDocument, BeatSynth, TrackKind } from '../core/document.js'
import { setValue } from '../core/edit.js'
import { humanize } from '../core/humanize.js'
import { formatNumber } from '../core/format.js'

export type VaryScale = 'linear' | 'log'

export interface VaryParamDef {
  key: keyof BeatSynth
  min: number
  max: number
  scale: VaryScale
  integer?: boolean
}

/** Musically-scoped mutation groups. Ranges are deliberately NARROWER than what the engine
 * accepts — they bound the *useful* region, not the legal one (the Dahlstedt lever). Numeric
 * params only in rung 1; enum flips (osc type, lfo dest) are a later, separate operator. */
export const VARY_GROUPS: Readonly<Record<string, readonly VaryParamDef[]>> = {
  kick: [
    { key: 'kickTune', min: 25, max: 80, scale: 'log' },
    { key: 'kickPunch', min: 0, max: 0.25, scale: 'linear' },
    { key: 'kickDecay', min: 0.15, max: 1.1, scale: 'log' },
  ],
  snare: [
    { key: 'snareTone', min: 0, max: 1, scale: 'linear' },
    { key: 'snareDecay', min: 0.06, max: 0.35, scale: 'log' },
  ],
  hats: [
    { key: 'hatTone', min: 2500, max: 11000, scale: 'log' },
    { key: 'hatDecay', min: 0.015, max: 0.12, scale: 'log' },
    { key: 'openHatDecay', min: 0.12, max: 0.7, scale: 'log' },
  ],
  filter: [
    { key: 'cutoff', min: 150, max: 11000, scale: 'log' },
    { key: 'resonance', min: 0.2, max: 3.5, scale: 'log' },
  ],
  env: [
    { key: 'attack', min: 0.002, max: 0.8, scale: 'log' },
    { key: 'decay', min: 0.02, max: 1, scale: 'log' },
    { key: 'sustain', min: 0, max: 1, scale: 'linear' },
    { key: 'release', min: 0.02, max: 1.8, scale: 'log' },
  ],
  filterenv: [
    { key: 'filterEnvAmount', min: 0, max: 0.8, scale: 'linear' },
    { key: 'filterEnvAttack', min: 0.002, max: 0.5, scale: 'log' },
    { key: 'filterEnvDecay', min: 0.03, max: 0.8, scale: 'log' },
    { key: 'filterEnvSustain', min: 0, max: 0.8, scale: 'linear' },
    { key: 'filterEnvRelease', min: 0.02, max: 1, scale: 'log' },
  ],
  osc: [
    { key: 'osc2Level', min: 0, max: 0.8, scale: 'linear' },
    { key: 'osc2Detune', min: 3, max: 30, scale: 'log' },
    { key: 'subLevel', min: 0, max: 0.8, scale: 'linear' },
    { key: 'noiseLevel', min: 0, max: 0.4, scale: 'linear' },
    { key: 'unisonVoices', min: 1, max: 7, scale: 'linear', integer: true },
    { key: 'unisonWidth', min: 0, max: 1, scale: 'linear' },
    { key: 'wtPos', min: 0, max: 1, scale: 'linear' },
  ],
  motion: [
    { key: 'lfoRate', min: 0.08, max: 9, scale: 'log' },
    { key: 'lfoDepth', min: 0, max: 0.7, scale: 'linear' },
    { key: 'glide', min: 0, max: 0.15, scale: 'linear' },
  ],
  fx: [
    { key: 'distortionAmount', min: 0, max: 0.7, scale: 'linear' },
    { key: 'distortionMix', min: 0, max: 0.8, scale: 'linear' },
    { key: 'bitcrushMix', min: 0, max: 0.6, scale: 'linear' },
    { key: 'compMix', min: 0, max: 1, scale: 'linear' },
    { key: 'compThreshold', min: -38, max: -8, scale: 'linear' },
    { key: 'compRatio', min: 1.5, max: 10, scale: 'log' },
    // Phase 22 Stream AC: the four new insert Mix knobs, same "bounded bypassable insert" shape
    // as distortionMix/bitcrushMix/compMix above.
    { key: 'pingPongMix', min: 0, max: 0.6, scale: 'linear' },
    { key: 'chorusMix', min: 0, max: 0.7, scale: 'linear' },
    { key: 'phaserMix', min: 0, max: 0.6, scale: 'linear' },
    { key: 'saturatorMix', min: 0, max: 0.7, scale: 'linear' },
    // Phase 23 Stream BE: same "bounded bypassable insert" shape as the Mix knobs above.
    { key: 'autoFilterMix', min: 0, max: 0.7, scale: 'linear' },
    { key: 'autoPanMix', min: 0, max: 0.7, scale: 'linear' },
    { key: 'tremoloMix', min: 0, max: 0.7, scale: 'linear' },
    { key: 'bitcrushRate', min: 1, max: 8, scale: 'log' },
  ],
  sends: [
    { key: 'sendReverb', min: 0, max: 0.8, scale: 'linear' },
    { key: 'sendDelay', min: 0, max: 0.7, scale: 'linear' },
  ],
  mix: [
    { key: 'volume', min: -20, max: 4, scale: 'linear' },
    { key: 'pan', min: -0.8, max: 0.8, scale: 'linear' },
    { key: 'eqLow', min: -5, max: 5, scale: 'linear' },
    { key: 'eqMid', min: -5, max: 5, scale: 'linear' },
    { key: 'eqHigh', min: -5, max: 5, scale: 'linear' },
    { key: 'duckAmount', min: 0, max: 0.7, scale: 'linear' },
  ],
}

/** Which track kinds each VARY_GROUPS entry is actually audible on — derived from the real
 * engine/panel wiring (ui/src/components/synthParams.ts's PARAM_GROUPS `kinds` field is the
 * ground truth for which ParamGroup card is shown per track kind; ui/src/audio/engine.ts wires
 * the underlying synth fields identically). kick/snare/hats are the drum-voice fields
 * (synthParams.ts's 'drumvoice' group, kinds: ['drums']) — writing them onto a synth/instrument
 * track's synth object is a structurally-legal but audibly-inert no-op (research/96's finding).
 * filter/env/filterenv mirror synthParams.ts's 'filter' group (kinds: ['synth', 'drums'] — the
 * drum bus has its own filter+envelope). osc/motion (osc2, sub, noise, unison, glide, LFOs) mirror
 * the 'osc' and 'lfo' groups, both synth-only. fx/sends/mix mirror the insert-effect, sends, and
 * amp/eq groups, all of which include 'drums'. Not used to reject an explicit `beat vary` call
 * (that's a separate, bigger scope decision — see docs/phase-33-plan.md's MC item 2 note) — only
 * to steer `suggest`'s own cold-start recommendation toward a group that will actually do
 * something on the target track. */
export const VARY_GROUP_KINDS: Readonly<Record<string, readonly TrackKind[]>> = {
  kick: ['drums'],
  snare: ['drums'],
  hats: ['drums'],
  filter: ['synth', 'drums'],
  env: ['synth', 'drums'],
  filterenv: ['synth', 'drums'],
  osc: ['synth'],
  motion: ['synth'],
  fx: ['synth', 'drums'],
  sends: ['synth', 'drums'],
  mix: ['synth', 'drums'],
}

/** Vary groups that are actually legal (audible) for a given track kind, in VARY_GROUPS's own
 * declared order. Falls back to every group if a kind (e.g. 'audio') has no known-legal group at
 * all, rather than returning an empty recommendation set. */
export function legalGroupsForKind(kind: TrackKind): string[] {
  const legal = Object.keys(VARY_GROUPS).filter((g) => (VARY_GROUP_KINDS[g] ?? []).includes(kind))
  return legal.length > 0 ? legal : Object.keys(VARY_GROUPS)
}

export class BeatVaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatVaryError'
  }
}

/** mulberry32 — tiny deterministic PRNG; good enough for jitter, trivially reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const toSpace = (v: number, d: VaryParamDef) => (d.scale === 'log' ? Math.log(Math.max(v, d.min > 0 ? d.min : 1e-4)) : v)
const fromSpace = (s: number, d: VaryParamDef) => (d.scale === 'log' ? Math.exp(s) : s)

/** One mutated value: jitter in scale space by (gaussian * amount * span), clamped to the
 * musical range. amount 0.25 ~= gentle neighborhood; 1 ~= anywhere-in-range leaps. */
function mutateValue(current: number, def: VaryParamDef, amount: number, rng: () => number): number {
  const lo = toSpace(def.min, def)
  const hi = toSpace(def.max, def)
  const span = hi - lo
  // Box-Muller gaussian from two uniforms
  const u1 = Math.max(rng(), 1e-12)
  const u2 = rng()
  const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  const start = Math.min(Math.max(toSpace(current, def), lo), hi)
  let next = fromSpace(Math.min(Math.max(start + gauss * amount * span * 0.5, lo), hi), def)
  if (def.integer) next = Math.round(next)
  return next
}

export interface VaryOptions {
  count?: number // default 9 — MutaSynth's population, sized for serial auditioning
  amount?: number // 0..1, default 0.25 — the single strength knob
  seed?: number // required for reproducibility; caller should log it
  mutationProbability?: number // per-param chance of being touched, default 0.8
}

export interface VaryVariant {
  doc: BeatDocument
  /** The exact `beat set` edits that produce this variant from the parent — the variant IS a
   * small diff, in the file's own vocabulary. */
  edits: { path: string; value: string }[]
}

/** Generates `count` variants of one track by mutating one parameter group. Deterministic under
 * (parent, trackId, group, options). Guarantees every variant differs from the parent in at
 * least one param (re-rolls a variant's mutation pass if the jitter rounds to no-op). */
export function varyTrack(doc: BeatDocument, trackId: string, group: string, opts: VaryOptions = {}): VaryVariant[] {
  const defs = VARY_GROUPS[group]
  if (!defs) throw new BeatVaryError(`unknown group "${group}" (have: ${Object.keys(VARY_GROUPS).join(', ')})`)
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatVaryError(`no track "${trackId}" (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  const count = opts.count ?? 9
  const amount = opts.amount ?? 0.25
  const probability = opts.mutationProbability ?? 0.8
  if (count < 1 || count > 32) throw new BeatVaryError(`count must be 1-32, got ${count}`)
  if (amount <= 0 || amount > 1) throw new BeatVaryError(`amount must be in (0, 1], got ${amount}`)
  const rng = makeRng(opts.seed ?? 1)

  const variants: VaryVariant[] = []
  for (let i = 0; i < count; i++) {
    let edits: { path: string; value: string }[] = []
    for (let attempt = 0; attempt < 8 && edits.length === 0; attempt++) {
      for (const def of defs) {
        if (rng() > probability) continue
        const current = track.synth[def.key] as number
        const next = mutateValue(current, def, amount, rng)
        const text = formatNumber(next)
        if (text === formatNumber(current)) continue // no-op after canonical rounding
        edits.push({ path: `${trackId}.${def.key}`, value: text })
      }
    }
    if (edits.length === 0) throw new BeatVaryError(`could not produce a distinct variant for "${group}" (amount too small?)`)
    let next = doc
    for (const e of edits) next = setValue(next, e.path, e.value)
    variants.push({ doc: next, edits })
  }
  return variants
}

export interface FeelVaryOptions {
  count?: number // default 9
  seed?: number // base seed; variant i uses seed+i so a batch is reproducible
  timing?: number // humanize knobs (see HumanizeOptions)
  velocity?: number
  pushLate?: number
  swing?: number
  lanes?: string[] // drum tracks: scope to these lanes
  ids?: string[] // or explicit note/hit ids
}

export interface FeelVariant {
  doc: BeatDocument
  /** A one-line recipe describing how to reproduce this variant's feel. */
  recipe: string
}

/** Rung 2 of the variation loop: batch `count` humanized *feels* of one track (or a selection),
 * each from a distinct seed. Content variation, not param variation — the generative half the
 * owner asked for ("auto-generate many variations; human picks by taste"). Reproducible: the
 * same (parent, track, options, base seed) yields byte-identical variants. Renders + `beat
 * score` work exactly as for param variation. */
export function varyFeel(doc: BeatDocument, trackId: string, opts: FeelVaryOptions = {}): FeelVariant[] {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatVaryError(`no track "${trackId}" (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  const count = opts.count ?? 9
  if (count < 1 || count > 32) throw new BeatVaryError(`count must be 1-32, got ${count}`)
  const base = opts.seed ?? 1
  const timing = opts.timing ?? 0.15
  const velocity = opts.velocity ?? 0.06
  const pushLate = opts.pushLate ?? 0
  const swing = opts.swing ?? 0

  // resolve a lane scope to concrete drum-hit ids
  let ids = opts.ids
  if (ids === undefined && opts.lanes && opts.lanes.length) {
    if (track.kind !== 'drums') throw new BeatVaryError(`--lanes only applies to drum tracks; "${trackId}" is a ${track.kind} track`)
    const lanes = new Set(opts.lanes)
    ids = track.hits.filter((h) => lanes.has(h.lane)).map((h) => h.id)
    if (ids.length === 0) throw new BeatVaryError(`no hits on lane(s) ${opts.lanes.join(', ')} in track "${trackId}"`)
  }

  const variants: FeelVariant[] = []
  for (let i = 0; i < count; i++) {
    const seed = base + i
    const { doc: next } = humanize(doc, trackId, { timing, velocity, pushLate, swing, seed, ...(ids ? { ids } : {}) })
    const parts = [`seed=${seed}`, `timing=${formatNumber(timing)}`]
    if (velocity) parts.push(`velocity=${formatNumber(velocity)}`)
    if (pushLate) parts.push(`push-late=${formatNumber(pushLate)}`)
    if (swing) parts.push(`swing=${formatNumber(swing)}`)
    if (opts.lanes && opts.lanes.length) parts.push(`lanes=${opts.lanes.join('+')}`)
    variants.push({ doc: next, recipe: `humanize ${parts.join(' ')}` })
  }
  return variants
}
