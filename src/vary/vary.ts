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

import type { BeatDocument, BeatDrumLaneDecl, BeatSynth, BeatTrack, DrumVoiceType, TrackKind } from '../core/document.js'
import { DRUM_VOICE_PARAM_DEFAULTS, SAMPLE_LANE_PARAM_DEFAULTS } from '../core/document.js'
import { setValue, applyAutomationShape } from '../core/edit.js'
import { humanize } from '../core/humanize.js'
import { formatNumber } from '../core/format.js'
import { AUTOMATION_SHAPES, type AutomationShape } from '../core/automation-shape.js'

export type VaryScale = 'linear' | 'log'

/** The mutation-range shape mutateValue works off — min/max bound the MUSICAL region, scale picks
 * the jitter space (log for frequency/time-like params). Shared by the track-wide VARY_GROUPS defs
 * (key: keyof BeatSynth) and the Phase 35 per-lane defs (key: an open lane-param name). */
export interface VaryRangeDef {
  min: number
  max: number
  scale: VaryScale
  integer?: boolean
}

export interface VaryParamDef extends VaryRangeDef {
  key: keyof BeatSynth
}

/** A declared drum lane's own backing-param mutation def — same musical-range discipline as
 * VaryParamDef, but keyed by the lane grammar's open param names (tune/punch/decay/tone for synth
 * voices; start/length/attack/hold/decay/cutoff/resonance plus gainDb/tune for samples). */
export interface LaneVaryParamDef extends VaryRangeDef {
  key: string
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
 * all, rather than returning an empty recommendation set. NOTE: kind-level only — on a
 * declared-lane drums track the kick/snare/hats entries this returns are still dead (pilot 101);
 * use `legalVaryTargets` when the actual track (with its `lanes` list) is in hand. */
export function legalGroupsForKind(kind: TrackKind): string[] {
  const legal = Object.keys(VARY_GROUPS).filter((g) => (VARY_GROUP_KINDS[g] ?? []).includes(kind))
  return legal.length > 0 ? legal : Object.keys(VARY_GROUPS)
}

/** The three VARY_GROUPS entries that mutate the LEGACY track-wide drum-voice synth params
 * (kickTune/snareTone/hatDecay/...). Correct on a legacy drums track (empty `lanes`); provably
 * inaudible on a declared-lane track — the engine plays those fields only while `lanes` is empty
 * (pilot 101, verified against ui/src/audio/engine.ts), so on declared-lane tracks these names
 * ERROR loudly instead of generating no-op variants. */
export const LEGACY_DRUM_VOICE_GROUPS: ReadonlySet<string> = new Set(['kick', 'snare', 'hats'])

/** Per-voice-type mutation ranges for a SYNTH-backed declared lane's own params bag — the
 * per-lane analog of the legacy kick/snare/hats groups, same musically-nonlinear-range
 * discipline. Ranges span the factory kits' actual values (presets/drum-kits.json: membrane tune
 * 20 (808 tom_lo) to 58 (909 cowbell); metal decay 0.03 (909 hat) to 1.1 (808 ride)) with
 * headroom, since ANY declared lane — toms, cowbell, ride — can be targeted now, not just the
 * historic five names. */
export const DRUM_VOICE_VARY_DEFS: Readonly<Record<DrumVoiceType, readonly LaneVaryParamDef[]>> = {
  membrane: [
    { key: 'tune', min: 18, max: 90, scale: 'log' },
    { key: 'punch', min: 0, max: 0.25, scale: 'linear' },
    { key: 'decay', min: 0.1, max: 1.1, scale: 'log' },
  ],
  noise: [
    { key: 'tone', min: 0, max: 1, scale: 'linear' },
    { key: 'decay', min: 0.03, max: 0.35, scale: 'log' },
  ],
  metal: [
    { key: 'tone', min: 2500, max: 11000, scale: 'log' },
    { key: 'decay', min: 0.015, max: 1.3, scale: 'log' },
  ],
}

/** Mutation ranges for a SAMPLE-backed declared lane: the full Phase-26 drum-sampler surface
 * (SAMPLE_LANE_PARAM_KEYS — Start/Length trim, AHD envelope, filter) plus the backing's own
 * gainDb/tune. Ranges bound the useful region, not the legal one, same as every group above:
 * tune legal span is -24..24 but +/-12 covers musical retuning; cutoff's max IS the format's
 * wide-open default (18000) so the filter can always sweep back open. */
export const SAMPLE_LANE_VARY_DEFS: readonly LaneVaryParamDef[] = [
  { key: 'gainDb', min: -9, max: 6, scale: 'linear' },
  { key: 'tune', min: -12, max: 12, scale: 'linear' },
  { key: 'start', min: 0, max: 0.05, scale: 'linear' },
  { key: 'length', min: 0, max: 0.8, scale: 'linear' },
  { key: 'attack', min: 0.0005, max: 0.05, scale: 'log' },
  { key: 'hold', min: 0, max: 0.25, scale: 'linear' },
  { key: 'decay', min: 0, max: 0.8, scale: 'linear' },
  { key: 'cutoff', min: 400, max: 18000, scale: 'log' },
  { key: 'resonance', min: 0.2, max: 3.5, scale: 'log' },
]

/** The mutation defs for one declared lane's own backing params, or undefined for sf-backed lanes
 * (their two fields, program/note, are identity, not shaping — nothing to vary). Shared by
 * varyTrack's lane targeting and suggest's direction-hint computation so both read the same
 * ranges. */
export function laneVaryDefs(lane: BeatDrumLaneDecl): readonly LaneVaryParamDef[] | undefined {
  if (lane.backing.type === 'synth') return DRUM_VOICE_VARY_DEFS[lane.backing.voice]
  if (lane.backing.type === 'sample') return SAMPLE_LANE_VARY_DEFS
  return undefined
}

/** A lane param's CURRENT sounding value — the declared override if present, else that backing's
 * own default (DRUM_VOICE_PARAM_DEFAULTS / SAMPLE_LANE_PARAM_DEFAULTS / the backing's gainDb-tune
 * fields). This is the mutation basis, so variants jitter around what the lane actually plays —
 * pilot 101 caught the legacy groups centering on the track-wide default (32.7) instead of the
 * lane's declared tune (28.5). */
export function laneParamCurrent(lane: BeatDrumLaneDecl, key: string): number {
  if (lane.backing.type === 'synth') return lane.backing.params[key] ?? DRUM_VOICE_PARAM_DEFAULTS[lane.backing.voice][key] ?? 0
  if (lane.backing.type === 'sample') {
    if (key === 'gainDb') return lane.backing.gainDb
    if (key === 'tune') return lane.backing.tune
    return lane.backing.params[key] ?? SAMPLE_LANE_PARAM_DEFAULTS[key as keyof typeof SAMPLE_LANE_PARAM_DEFAULTS] ?? 0
  }
  return 0
}

/** Every vary target that is actually AUDIBLE on this specific track, in a stable order. For a
 * declared-lane drums track: its own lane names (sf-backed excluded — nothing to vary) followed
 * by the track-wide bus groups (filter/env/fx/... — real on the drum bus) with the dead legacy
 * drum-voice groups removed. For everything else: `legalGroupsForKind`. The "feel" pseudo-group
 * is always additionally legal on any track and is not listed here. */
export function legalVaryTargets(track: Pick<BeatTrack, 'kind' | 'lanes'>): string[] {
  if (track.kind === 'drums' && track.lanes.length > 0) {
    const laneNames = track.lanes.filter((l) => l.backing.type !== 'sf').map((l) => l.name)
    const busGroups = legalGroupsForKind('drums').filter((g) => !LEGACY_DRUM_VOICE_GROUPS.has(g))
    return [...laneNames, ...busGroups.filter((g) => !laneNames.includes(g))]
  }
  return legalGroupsForKind(track.kind)
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

const toSpace = (v: number, d: VaryRangeDef) => (d.scale === 'log' ? Math.log(Math.max(v, d.min > 0 ? d.min : 1e-4)) : v)
const fromSpace = (s: number, d: VaryRangeDef) => (d.scale === 'log' ? Math.exp(s) : s)

/** Spread-mode value: uniform draw inside quantile band `band` of [min,max] in scale space —
 * variant i's band assignment comes from a per-param shuffle, so a batch tiles the whole range. */
function spreadValue(def: VaryRangeDef, band: number, count: number, rng: () => number): number {
  const lo = toSpace(def.min, def)
  const hi = toSpace(def.max, def)
  const q = (band + rng()) / count
  let next = fromSpace(lo + q * (hi - lo), def)
  if (def.integer) next = Math.round(next)
  return next
}

/** One mutated value: jitter in scale space by (gaussian * amount * span), clamped to the
 * musical range. amount 0.25 ~= gentle neighborhood; 1 ~= anywhere-in-range leaps. */
function mutateValue(current: number, def: VaryRangeDef, amount: number, rng: () => number): number {
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
  /** EXPLORATION mode (taste-collect, 2026-07-17): sample each param STRATIFIED ACROSS ITS FULL
   * musical range instead of jittering around the parent's value. The default gaussian-around-
   * current is deliberately local (MutaSynth: "variants of MY patch"), which is right for
   * refinement but wrong for preference-data collection — when the parent's value sits near a
   * range end (a 0.002s bass attack), even amount 0.6 leaves most variants clamped there, and
   * the owner rightly reported five near-identical basses. With spread, variant i draws from the
   * i-th shuffled quantile band of each param's range, so a batch of 5 GUARANTEES range-spanning,
   * audibly distinct settings. `amount` is ignored in this mode. */
  spread?: boolean
  /** Param keys to LEAVE UNTOUCHED within the targeted group (pilot 113: taste-collect's solo
   * mix batches exclude `volume` — loudness normalization would gain-match the renders and
   * cancel exactly the difference being rated). Unknown keys error loudly rather than silently
   * varying a param the caller thought was pinned. */
  exclude?: string[]
}

export interface VaryVariant {
  doc: BeatDocument
  /** The exact `beat set` edits that produce this variant from the parent — the variant IS a
   * small diff, in the file's own vocabulary. */
  edits: { path: string; value: string }[]
}

/** The shared mutation loop behind both targeting modes: `defs` bound the ranges, `current` reads
 * each param's basis value, `path` spells the replayable `beat set` path. Deterministic under the
 * options — the rng call order is exactly the pre-Phase-35 loop's, so legacy batches stay
 * byte-identical under the same seed. */
function mutateVariants(
  doc: BeatDocument,
  target: string,
  defs: readonly LaneVaryParamDef[] | readonly VaryParamDef[],
  current: (key: string) => number,
  path: (key: string) => string,
  opts: VaryOptions,
): VaryVariant[] {
  const count = opts.count ?? 9
  const amount = opts.amount ?? 0.25
  const probability = opts.mutationProbability ?? 0.8
  if (count < 1 || count > 32) throw new BeatVaryError(`count must be 1-32, got ${count}`)
  if (amount <= 0 || amount > 1) throw new BeatVaryError(`amount must be in (0, 1], got ${amount}`)
  // Pilot 113: opt-out of individual params within the group (taste-collect pins mix's volume).
  // Filtering BEFORE any rng draw keeps un-excluded batches byte-identical under the same seed.
  if (opts.exclude && opts.exclude.length > 0) {
    const known = new Set(defs.map((d) => d.key))
    const unknown = opts.exclude.filter((k) => !known.has(k))
    if (unknown.length > 0) throw new BeatVaryError(`--exclude names param(s) "${target}" does not vary: ${unknown.join(', ')} (its params: ${[...known].join(', ')})`)
    defs = defs.filter((d) => !opts.exclude!.includes(d.key))
    if (defs.length === 0) throw new BeatVaryError(`--exclude removed every param of "${target}" — nothing left to vary`)
  }
  const rng = makeRng(opts.seed ?? 1)

  // spread mode: one shuffled quantile-band permutation per param, so across the batch each
  // param's variants tile its whole range in a different order (a latin-hypercube-lite). Every
  // param is always touched — the point is maximal audible distinctness, not minimal diffs.
  const bandPerm: Record<string, number[]> = {}
  if (opts.spread) {
    for (const def of defs) {
      const p = Array.from({ length: count }, (_, k) => k)
      for (let k = p.length - 1; k > 0; k--) {
        const j = Math.floor(rng() * (k + 1))
        ;[p[k], p[j]] = [p[j]!, p[k]!]
      }
      bandPerm[def.key] = p
    }
  }

  const variants: VaryVariant[] = []
  for (let i = 0; i < count; i++) {
    let edits: { path: string; value: string }[] = []
    for (let attempt = 0; attempt < 8 && edits.length === 0; attempt++) {
      for (const def of defs) {
        if (!opts.spread && rng() > probability) continue
        const before = current(def.key)
        const next = opts.spread ? spreadValue(def, bandPerm[def.key]![i]!, count, rng) : mutateValue(before, def, amount, rng)
        const text = formatNumber(next)
        if (text === formatNumber(before)) continue // no-op after canonical rounding
        edits.push({ path: path(def.key), value: text })
      }
    }
    if (edits.length === 0) throw new BeatVaryError(`could not produce a distinct variant for "${target}" (amount too small?)`)
    let next = doc
    for (const e of edits) next = setValue(next, e.path, e.value)
    variants.push({ doc: next, edits })
  }
  return variants
}

/** Generates `count` variants of one track by mutating one parameter group — or, on a
 * declared-lane drums track, one NAMED LANE's own backing params (Phase 35 Stream OA, pilot
 * 101's high finding: the legacy kick/snare/hats groups mutate track-wide fields the engine
 * never plays once `lanes` is declared, so there `group` is a lane name and the mutations land
 * on the lane's own params via the `<track>.lane.<name>.<key>` set path). Deterministic under
 * (parent, trackId, group, options). Guarantees every variant differs from the parent in at
 * least one param (re-rolls a variant's mutation pass if the jitter rounds to no-op). */
export function varyTrack(doc: BeatDocument, trackId: string, group: string, opts: VaryOptions = {}): VaryVariant[] {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatVaryError(`no track "${trackId}" (have: ${doc.tracks.map((t) => t.id).join(', ')})`)

  if (track.kind === 'drums' && track.lanes.length > 0) {
    const laneNames = track.lanes.map((l) => l.name)
    const lane = track.lanes.find((l) => l.name === group)
    if (lane) {
      // A declared lane name takes precedence over any same-named group: on a declared-lane
      // track the lane params are what actually sound.
      const defs = laneVaryDefs(lane)
      if (!defs) {
        throw new BeatVaryError(
          `lane "${group}" on track "${trackId}" is sf-backed — its two fields (program/note) are identity, not shaping, so there is nothing to vary; target a synth- or sample-backed lane instead (have: ${legalVaryTargets(track).join(', ')})`,
        )
      }
      return mutateVariants(doc, `${trackId} lane ${group}`, defs, (key) => laneParamCurrent(lane, key), (key) => `${trackId}.lane.${group}.${key}`, opts)
    }
    if (LEGACY_DRUM_VOICE_GROUPS.has(group)) {
      // Never generate no-op variants: these groups mutate the legacy track-wide drum-voice
      // params, which the engine ignores on every declared-lane track (pilot 101).
      throw new BeatVaryError(
        `group "${group}" mutates the legacy track-wide drum-voice params, which a declared-lane drums track never plays — target one of this track's lanes instead: ${laneNames.join(', ')} (track-wide groups that still apply: ${legalGroupsForKind('drums')
          .filter((g) => !LEGACY_DRUM_VOICE_GROUPS.has(g))
          .join(', ')})`,
      )
    }
    if (!VARY_GROUPS[group]) {
      throw new BeatVaryError(`unknown vary target "${group}" on declared-lane drums track "${trackId}" (lanes: ${laneNames.join(', ')}; track-wide groups: ${Object.keys(VARY_GROUPS).filter((g) => !LEGACY_DRUM_VOICE_GROUPS.has(g)).join(', ')})`)
    }
  }

  const defs = VARY_GROUPS[group]
  if (!defs) throw new BeatVaryError(`unknown group "${group}" (have: ${Object.keys(VARY_GROUPS).join(', ')})`)
  // Pilot 103: the declared-lane guard above wasn't enough — a drums-only group on a SYNTH track
  // (e.g. `beat vary song lead kick`) mutated lead.kickTune/... , params a synth track never
  // plays: the same inaudible-no-op family, one track-kind over. Never generate no-op variants.
  const legalKinds = VARY_GROUP_KINDS[group]
  if (legalKinds && !legalKinds.includes(track.kind)) {
    throw new BeatVaryError(
      `group "${group}" mutates ${legalKinds.join('/')}-track params that a ${track.kind} track never plays — an inaudible no-op batch; legal groups for "${trackId}": ${legalGroupsForKind(track.kind).join(', ')}${track.kind === 'synth' ? ' (or "feel")' : ''}`,
    )
  }
  const variants = mutateVariants(doc, group, defs, (key) => track.synth[key as keyof BeatSynth] as number, (key) => `${trackId}.${key}`, opts)
  // Silent-no-op guard, found by ear (owner, 2026-07-18, two batches: "all the same"): the motion
  // group varies lfoRate/lfoDepth — but lfoDest DEFAULTS TO 'off', so on a track that never set a
  // destination every variant modulates a disconnected LFO: byte-different documents, identical
  // audio. In spread mode (exploration), route the LFO too — cycle destinations across variants so
  // the batch tours modulation CHARACTER (vibrato / filter wobble / tremolo). Refinement mode is
  // left alone: silently rewiring a patch the user is refining would be a bigger surprise than a
  // subtle batch.
  if (opts.spread && group === 'motion' && (track.synth.lfoDest === undefined || track.synth.lfoDest === 'off')) {
    const DESTS = ['pitch', 'cutoff', 'amp'] as const
    for (let i = 0; i < variants.length; i++) {
      const dest = DESTS[i % DESTS.length]!
      const v = variants[i]!
      v.doc = setValue(v.doc, `${trackId}.lfoDest`, dest)
      v.edits.push({ path: `${trackId}.lfoDest`, value: dest })
    }
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
  /** EXPLORATION mode (taste-collect, 2026-07-18): each variant gets a distinct GROOVE ARCHETYPE
   * (tight -> light swing -> heavy swing -> laid-back -> loose) instead of `count` random rolls
   * of one fixed-strength jitter — the owner flagged every default feel batch as "all very
   * similar", and structurally they were: same knobs, different dice. Archetypes make the feel
   * axis itself the variation. Explicit timing/velocity/pushLate/swing knobs are ignored. */
  spread?: boolean
}

/** Groove archetypes for spread-mode feel batches, ordered mild -> extreme; variant i cycles
 * through these. Values chosen to be unmistakably distinct on both drums and tonal parts. */
const FEEL_ARCHETYPES: { label: string; timing: number; velocity: number; pushLate: number; swing: number }[] = [
  { label: 'tight',     timing: 0.02, velocity: 0.02, pushLate: 0,    swing: 0 },
  { label: 'light-swing', timing: 0.06, velocity: 0.05, pushLate: 0,  swing: 0.22 },
  { label: 'heavy-swing', timing: 0.08, velocity: 0.08, pushLate: 0.04, swing: 0.55 },
  { label: 'laid-back', timing: 0.06, velocity: 0.06, pushLate: 0.22, swing: 0.12 },
  { label: 'loose',     timing: 0.32, velocity: 0.18, pushLate: 0.08, swing: 0.3 },
]

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
    const arch = opts.spread ? FEEL_ARCHETYPES[i % FEEL_ARCHETYPES.length]! : undefined
    const knobs = arch ?? { timing, velocity, pushLate, swing }
    const { doc: next } = humanize(doc, trackId, { timing: knobs.timing, velocity: knobs.velocity, pushLate: knobs.pushLate, swing: knobs.swing, seed, ...(ids ? { ids } : {}) })
    const parts = [`seed=${seed}`, `timing=${formatNumber(knobs.timing)}`]
    if (knobs.velocity) parts.push(`velocity=${formatNumber(knobs.velocity)}`)
    if (knobs.pushLate) parts.push(`push-late=${formatNumber(knobs.pushLate)}`)
    if (knobs.swing) parts.push(`swing=${formatNumber(knobs.swing)}`)
    if (opts.lanes && opts.lanes.length) parts.push(`lanes=${opts.lanes.join('+')}`)
    variants.push({ doc: next, recipe: `humanize ${parts.join(' ')}${arch ? `  # ${arch.label}` : ''}` })
  }
  return variants
}

export interface AutomationVaryOptions {
  count?: number // default 9
  seed?: number // base seed; deterministic under it
  points?: number // points per generated lane, default 16
  bars?: number // explicit clip span override, forwarded to applyAutomationShape
  clip?: string // which clip to write the lane on; default the track's first clip
}

export interface AutomationVariant {
  doc: BeatDocument
  /** The exact replayable `automate-shape` command (sans the file arg, like feel's `humanize …`
   * recipe) that reproduces this variant's movement — stored as the batch's recipe. */
  recipe: string
}

/** Phase 37 Stream RC — automation as a VARY TARGET (`beat vary <track> automation:<param>`): batch
 * `count` movement variants of one clip's `param` lane, each a distinct predefined SHAPE + depth +
 * rate + phase, for auditioning/scoring in the existing writeVaryBatch -> score -> adopt harness.
 * Whole-doc variants (like feel — a generated lane isn't a single set-replayable edit), so each
 * carries a `recipe` (the replayable automate-shape command) rather than `edits`. Deterministic
 * under (parent, track, param, options, seed); re-rolls a variant whose movement collides with an
 * earlier one (mutateVariants' distinctness discipline), so a batch is `count` genuinely different
 * lanes. The clip written is `opts.clip` or the track's first clip (automation is clip-scoped —
 * errors if the track has none). */
export function varyAutomation(doc: BeatDocument, trackId: string, param: string, opts: AutomationVaryOptions = {}): AutomationVariant[] {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatVaryError(`no track "${trackId}" (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  const count = opts.count ?? 9
  if (count < 1 || count > 32) throw new BeatVaryError(`count must be 1-32, got ${count}`)
  if (track.clips.length === 0) throw new BeatVaryError(`track "${trackId}" has no clips — automation is clip-scoped, so there is nothing to vary; snapshot a clip first (beat clip) or add notes to one`)
  const clipId = opts.clip ?? track.clips[0]!.id
  const clip = track.clips.find((c) => c.id === clipId)
  if (!clip) throw new BeatVaryError(`no clip "${clipId}" on track "${trackId}" (have: ${track.clips.map((c) => c.id).join(', ')})`)
  const points = opts.points ?? 16

  // The param's current value anchors the sweep's center (so the movement stays in a musical
  // neighborhood of what's already there). checkAutomatableParam inside applyAutomationShape is the
  // real gate; here we just read a base to sweep around.
  let base: number
  if (track.kind === 'audio') base = clip.audio?.gainDb ?? 0
  else base = (track.synth as unknown as Record<string, number>)[param] ?? 0

  const rng = makeRng(opts.seed ?? 1)
  const variants: AutomationVariant[] = []
  const seenRecipes = new Set<string>()
  for (let i = 0; i < count; i++) {
    let variant: AutomationVariant | null = null
    for (let attempt = 0; attempt < 16 && variant === null; attempt++) {
      const shape: AutomationShape = AUTOMATION_SHAPES[Math.floor(rng() * AUTOMATION_SHAPES.length)] ?? 'ramp'
      const depth = 0.3 + rng() * 0.6 // 0.3..0.9 — how far the sweep reaches from center
      const cycles = 1 + Math.floor(rng() * 3) // 1..3 — the "rate" of oscillating shapes
      const invert = rng() < 0.5 // "phase": sweep up-then-down vs down-then-up
      // Magnitude to sweep across: multiplicative around a positive base (cutoff Hz etc.), additive
      // around a zero/negative base (gain dB, pan). Floor a positive `from` above zero so a
      // frequency-like param never sweeps to/through 0.
      const magnitude = base !== 0 ? Math.abs(base) : 1000
      let lo = base - depth * magnitude
      const hi = base + depth * magnitude
      if (base > 0) lo = Math.max(lo, base * 0.05)
      const from = invert ? hi : lo
      const to = invert ? lo : hi
      const recipe = `automate-shape ${clipId} ${param} ${shape} --from ${formatNumber(from)} --to ${formatNumber(to)} --cycles ${cycles} --points ${points}${opts.bars !== undefined ? ` --bars ${formatNumber(opts.bars)}` : ''}`
      if (seenRecipes.has(recipe)) continue // re-roll — keep the batch's movements distinct
      const next = applyAutomationShape(doc, trackId, clipId, param, shape, { from, to, cycles, points, ...(opts.bars !== undefined ? { bars: opts.bars } : {}) }).doc
      seenRecipes.add(recipe)
      variant = { doc: next, recipe }
    }
    if (variant === null) throw new BeatVaryError(`could not produce ${count} distinct automation variants for "${trackId}.${param}" (try a smaller count)`)
    variants.push(variant)
  }
  return variants
}
