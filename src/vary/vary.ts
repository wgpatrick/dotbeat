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

import type { BeatDocument, BeatSynth } from '../core/document.js'
import { setValue } from '../core/edit.js'
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
  ],
  sends: [
    { key: 'sendReverb', min: 0, max: 0.8, scale: 'linear' },
    { key: 'sendDelay', min: 0, max: 0.7, scale: 'linear' },
    { key: 'sendMod', min: 0, max: 0.6, scale: 'linear' },
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
