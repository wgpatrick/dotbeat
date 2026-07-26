// The executable recipe library — schema, types, and the eagerly-validating loader
// (docs/research/139-recipe-library-and-layering.md §4; the mined corpus in docs/priors/*.md and
// the patch-file ground truth in docs/research/141 + presets/role-parameter-stats.json).
//
// A RECIPE is one altitude above a TRICK (presets/tricks.json — a single preconditioned move) and
// two above a PRESET (a parameter bag with no procedure and no gate): a named, executable,
// VERIFIABLE procedure for one produced clip role — layer structure, per-layer patch in dotbeat's
// real field names, effect chain with dosages and order, MIDI/articulation requirements, and exit
// gates expressed in metrics the repo already computes.
//
// Three disciplines are inherited wholesale from the repo's existing format precedents:
//
//  1. **Eager validation** (src/analysis/trick.ts's posture). Every synth field, effect type,
//     archetype, drum lane, production-profile field and gate key a recipe names is checked at
//     LOAD time against the live format vocabulary — SYNTH_FIELDS, EFFECT_TYPES, the showdown
//     archetype banks, FEATURE_KEYS. A SYNTH_FIELDS rename therefore breaks the recipe library
//     loudly in CI instead of producing a silently-wrong render. This module never touches the
//     filesystem: `parseRecipeLibrary(json)` takes the JSON TEXT so it stays pure and testable;
//     path resolution is the caller's job (CLI / script / test), exactly as tricks does it.
//
//  2. **Gates are BANDS, never scalar maxima** (139 §1.3). A gate is `[lo, hi]` membership, which
//     is the anti-Goodhart shape: a distribution target cannot be maximized by a degenerate point.
//     A gate key the feature pipeline does not compute YET (131 §4's "B0" keys — fluxMean,
//     attackMedMs, flatnessHiDb, crest_subDb, ...) is legal to encode and is reported `pending` by
//     the checker rather than silently passing; `verified` status requires every gate computable.
//
//  3. **Provenance-carrying and frozen** (CLAUDE.md's frozen-science rule). Every numeric value
//     records where it came from and at what confidence — `consensus` (3+ independent sources
//     agree), `corroborated` (2), `single-source` (a hypothesis, not a spec), `measured-patches`
//     (research 141: 3,559 real Surge patch files — these WIN over prose where the two disagree),
//     or `measured-refs` (131/133/135's owned-reference measurements). Where sources genuinely
//     contradict each other (Reese detune spans ±7…±61 cents across the corpus), the recipe
//     encodes the patch-file median as the VALUE and records the full span as an explicit
//     `dials[]` sweep entry — never an arbitrary pick presented as fact.

import {
  EFFECT_TYPES,
  SYNTH_FIELD_BY_KEY,
  SYNTH_PARAM_ORDER,
  DRUM_LANES,
  OSC_TYPES,
  type EffectType,
} from '../core/index.js'
import { FEATURE_KEYS, type FeatureKey } from '../taste/features.js'
import { BASSLINE_ARCHETYPES, CHORDS_ARCHETYPES, LEAD_ARCHETYPES, DRUM_ARCHETYPES } from '../taste/showdown.js'

/** Thrown by every validation path here. `cli/beat.mjs` allowlists it by name so a bad library
 * prints `error: <message>` and exits 2 rather than dumping a stack. */
export class BeatRecipeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatRecipeError'
  }
}

/** The four roles of the standing eval (src/taste/showdown.ts's SHOWDOWN_ROLES). */
export const RECIPE_ROLES = ['bassline', 'chords', 'lead', 'drum-loop'] as const
export type RecipeRole = (typeof RECIPE_ROLES)[number]

/** How much weight a numeric value carries. `measured-patches` and `measured-refs` outrank every
 * prose tier by construction (139 §1.3 pushback 2: structure from the corpus, numbers from the
 * measurements; 141's whole premise: patch files measure what designers DID, tutorials say what
 * they SAY). */
export const SOURCE_CONFIDENCES = ['measured-refs', 'measured-patches', 'consensus', 'corroborated', 'single-source'] as const
export type SourceConfidence = (typeof SOURCE_CONFIDENCES)[number]

export interface RecipeSource {
  /** human-readable citation — publication + article, or `research/NNN §X` for repo measurements */
  cite: string
  url?: string
  /** what this source contributes to THIS recipe, in one line */
  claim: string
  confidence: SourceConfidence
}

/** A closed `[lo, hi]` band. Gates check membership; they are never maximized. */
export type GateBand = readonly [number, number]

/** An explicit, named disagreement between sources, preserved rather than averaged away. `value`
 * is what the recipe actually encodes (the patch-file median where one exists); `range` is the
 * full span the corpus supports; `field` names the dotbeat parameter the sweep would move. */
export interface RecipeDial {
  name: string
  field?: string
  value: number
  range: GateBand
  note: string
}

/** A literal patch: dotbeat SYNTH_FIELDS / core-9 keys to values, validated against the live
 * format vocabulary at load. */
export type RecipePatchLiteral = Record<string, number | string | boolean>

/** A patch SOURCE (139 §4.3, the owner's retargeting addition): start from a human-designed
 * known-good point and run a bounded local search until 5–8 measured scalars sit in-band. Encoded
 * here so the schema is the contract the sibling retargeting stream lands against; the v1 builder
 * REFUSES to execute it (see build.ts) rather than silently rendering the un-retargeted preset. */
export interface RecipePatchSource {
  /** `factory:<name>` | `curated:<name>` | `surge:<category>` | `matched:<loop>` */
  from: string
  /** the gate subset the local search drives into band */
  retarget?: Record<string, GateBand>
}

export type RecipePatch = RecipePatchLiteral | RecipePatchSource

export const isPatchSource = (p: RecipePatch): p is RecipePatchSource => typeof (p as RecipePatchSource).from === 'string'

/** The production-profile subset a layer may request. Mirrors `ProductionProfile`
 * (src/analysis/produce.ts) minus `role` (which the layer names separately) and minus `duck`
 * (which only a chain step can wire, since it needs a real track id). */
export interface RecipeProduce {
  osc2Layer?: { level: number; detuneCents: number }
  unison?: { voices: number; width: number }
  noiseLevel?: number
  chorusMix?: number
  utilityWidth?: number
  saturator?: { drive: number; mix: number }
  sendReverb?: number
  sendDelay?: number
  eqHigh?: number
  autoPan?: { rate: number; depth: number; mix: number }
}

const PRODUCE_KEYS = ['osc2Layer', 'unison', 'noiseLevel', 'chorusMix', 'utilityWidth', 'saturator', 'sendReverb', 'sendDelay', 'eqHigh', 'autoPan'] as const

/** `ProductionRole` values a layer may name (src/analysis/produce.ts's ProductionRole). */
const PRODUCTION_ROLES = ['kick', 'snare', 'hats', 'perc', 'bass', 'sub', 'lead', 'pad', 'chords', 'arp', 'kit', 'default'] as const

/** One layer of the stack. Layer 0 is the identity layer (the one the recipe is "about"); every
 * further layer is an additive track sharing the clip's figure, transposed and re-patched. */
export interface RecipeLayer {
  /** unique within the recipe; becomes the track id, and `$<id>.<field>` resolves to it in chain steps */
  id: string
  kind: 'synth' | 'drums'
  /** semitone offset from the composed figure (139 spells this `octave`; renamed for honesty —
   * the values are semitones, and −7 / +7 fifth layers are a real technique in the corpus). */
  transpose?: number
  /** the ProductionRole this layer plays, for `produce` and for width/mono discipline */
  role?: string
  patch: RecipePatch
  produce?: RecipeProduce
  /** per-layer exit gates, checked on this layer's SOLO render */
  gates?: Record<string, GateBand>
  /** why this layer exists, in the corpus's own terms */
  why: string
}

/** Clip-level steps, in the tricks step vocabulary plus the one extension 139 §4.1 named as the
 * blocker for `sidechain-pump`: `trackAdd`. Deliberately NOT implemented in v1:
 * `automate` (renders only in song mode), `macro`, `addHits`, `humanize`, `scaleVelocity`,
 * `rehost` (the two-stage bus-glue pass) — each is recorded as a gap where a recipe wants it. */
export type RecipeStep =
  | { set: string; value: number | string | boolean }
  | { effectAdd: string; type: EffectType }
  | { trackAdd: string; kind: 'drums'; hits: string; volume: number }

/** Named drum-hit patterns a `trackAdd` step may request (16th-step offsets within a bar). */
export const RECIPE_HIT_PATTERNS: Record<string, readonly number[]> = {
  'kick-quarters': [0, 4, 8, 12],
  'kick-downbeat': [0],
  'kick-offbeat-8ths': [2, 6, 10, 14],
}

/** MIDI/articulation requirements. 139 §4.2's honest note applies verbatim: **feel is
 * gate-invisible** — every one of these is a REQUIREMENT the builder applies, never a gate, and
 * the owner's ear is its only judge. */
export interface RecipeFeel {
  /** swing as the classic percentage: 50 = straight, 66.7 = triplet shuffle. Mapped onto the
   * format's own `shuffleAmount` via the exact identity `amount = (swingPct − 50) / 50`
   * (src/core/groove.ts: moebiusEase(0.5, h) === h, so h IS the pair fraction). */
  swingPct?: number
  /** 16th-step subdivision the swing pairs against (BeatTrack.shuffleGrid; 1 = swung 16ths). */
  swingGrid?: number
  /** velocity levels applied by metrical position, strongest first (downbeat → offbeat → rest) */
  velocityTiers?: readonly number[]
  /** note-length multiplier — the arpeggiator "gate %" the corpus quotes (0.5 = staccato) */
  gate?: number
  /** portamento seconds, written to every layer's `glide` (the 303/808 slide) */
  glideSeconds?: number
  /** the warehouse-techno rule, verbatim from Attack Magazine: "leaving the first 16th-note of
   * every beat empty is important to prevent clashing with the kick" */
  restBeatOneSixteenth?: boolean
  /** requirements the builder cannot apply — recorded so the gap is visible, not silently dropped */
  notes?: readonly string[]
}

export interface RecipeFigure {
  /** a showdown archetype name for the recipe's role, or 'any' */
  archetype: string
  /** MIDI window the figure's median pitch is transposed (by whole octaves) to land inside */
  register: GateBand
  feel: RecipeFeel
}

export type RecipeStatus = 'sourced' | 'verified' | 'validated' | 'parked'
export const RECIPE_STATUSES = ['sourced', 'verified', 'validated', 'parked'] as const

export interface RecipeProvenance {
  status: RecipeStatus
  /** where the gate numbers came from and how to regenerate them (frozen science: gates
   * regenerate by script and mint a new recipe VERSION; they are never hand-edited in place) */
  gatesMinedFrom: { refs: string; stat: string; regenerate?: string; asOf: string }
  /** the features of the seeded reference build, filled when the recipe reaches `verified` */
  verifyReceipt: Record<string, number> | null
  /** append-only: one entry per rated batch */
  blindRecord: readonly unknown[]
}

export interface Recipe {
  name: string
  version: number
  role: RecipeRole
  tags: readonly string[]
  /** one line: what this recipe IS, in the corpus's own vocabulary */
  character: string
  sources: readonly RecipeSource[]
  /** the source disagreements this recipe resolved by measurement, kept explicit */
  dials?: readonly RecipeDial[]
  /** techniques the source describes that dotbeat cannot express — recorded, never faked */
  gaps?: readonly string[]
  figure: RecipeFigure
  layers: readonly RecipeLayer[]
  chain: readonly RecipeStep[]
  /** clip-level exit gates, checked on the SUMMED render */
  gates: Record<string, GateBand>
  provenance: RecipeProvenance
}

// ---- the gate vocabulary ------------------------------------------------------------------------

/** Gate keys the feature pipeline computes TODAY (src/taste/features.ts's FEATURE_KEYS). */
export const COMPUTABLE_GATE_KEYS: readonly string[] = FEATURE_KEYS

/** Gate keys research 131 §4 measured as the real discriminators and 138 B0 will append to
 * FEATURE_KEYS. Legal to encode; reported `pending` by the checker until B0 lands (139 §4.2's
 * explicit rule — a recipe may encode targets ahead of the instrument, but cannot reach
 * `verified` on a gate the instrument cannot read). Kept in 131 §4's own order. */
export const PENDING_GATE_KEYS = [
  'fluxMean',
  'fluxP95',
  'fluxStd',
  'flatnessDb',
  'flatnessHiDb',
  'flatnessLoDb',
  'slopeDbPerOct',
  'crest_subDb',
  'crest_bassDb',
  'crest_midsDb',
  'crest_presenceDb',
  'crest_airDb',
  'envStdDb',
  'envRangeDb',
  'envFluxDb',
  'sustainPct',
  'onsetRatePerSec',
  'attackMedMs',
  'attackP25Ms',
  'attackCv',
  'onsetLevelCv',
  'widthMeanDb',
  'widthStdDb',
] as const

export type PendingGateKey = (typeof PENDING_GATE_KEYS)[number]
export const isComputableGateKey = (k: string): k is FeatureKey => (COMPUTABLE_GATE_KEYS as readonly string[]).includes(k)
export const isPendingGateKey = (k: string): k is PendingGateKey => (PENDING_GATE_KEYS as readonly string[]).includes(k)

/** Every archetype bank, by role — the vocabulary `figure.archetype` is checked against. */
export const RECIPE_ARCHETYPE_BANKS: Record<RecipeRole, readonly string[]> = {
  bassline: BASSLINE_ARCHETYPES,
  chords: CHORDS_ARCHETYPES,
  lead: LEAD_ARCHETYPES,
  'drum-loop': DRUM_ARCHETYPES,
}

/** Every field name a literal patch may set: the required core 9 plus all ~136 SYNTH_FIELDS.
 * Built from the live format tables at module init, so a rename cannot drift past this file. */
const SYNTH_FIELD_KINDS: ReadonlyMap<string, 'number' | 'enum' | 'bool' | 'trackref'> = (() => {
  const m = new Map<string, 'number' | 'enum' | 'bool' | 'trackref'>()
  for (const key of SYNTH_PARAM_ORDER) m.set(key, key === 'osc' ? 'enum' : 'number')
  for (const [key, def] of SYNTH_FIELD_BY_KEY) m.set(key, def.kind)
  return m
})()

const SYNTH_FIELD_VALUES: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, readonly string[]>()
  m.set('osc', OSC_TYPES)
  for (const [key, def] of SYNTH_FIELD_BY_KEY) if (def.values) m.set(key, def.values)
  return m
})()

/** Track-level (non-synth) fields `setValue` also accepts on a `<track>.<field>` path — the
 * groove pair (src/core/document.ts's BeatTrack.shuffleAmount/shuffleGrid). Legal in a chain
 * `set` step and as a dial's `field`, but NOT in a layer `patch`, which is the synth block only
 * (a recipe expresses groove through `figure.feel.swingPct`, which maps onto these exactly). */
const TRACK_FIELD_KINDS: ReadonlyMap<string, 'number'> = new Map([
  ['shuffleAmount', 'number'],
  ['shuffleGrid', 'number'],
] as const)

/** Public accessor used by the test suite's "every referenced parameter exists" contract. */
export const recipeFieldExists = (key: string): boolean => SYNTH_FIELD_KINDS.has(key) || TRACK_FIELD_KINDS.has(key)

const settableKind = (key: string): 'number' | 'enum' | 'bool' | 'trackref' | undefined => SYNTH_FIELD_KINDS.get(key) ?? TRACK_FIELD_KINDS.get(key)

// ---- validation ---------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function band(v: unknown, where: string): GateBand {
  if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'number' || typeof v[1] !== 'number' || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) {
    throw new BeatRecipeError(`${where} must be a [lo, hi] band of two finite numbers, got ${JSON.stringify(v)}`)
  }
  if (v[0] > v[1]) throw new BeatRecipeError(`${where} band is inverted: lo ${v[0]} > hi ${v[1]}`)
  return [v[0], v[1]] as const
}

function gateMap(v: unknown, where: string): Record<string, GateBand> {
  if (!isObj(v)) throw new BeatRecipeError(`${where} must be an object of gateKey -> [lo, hi]`)
  const out: Record<string, GateBand> = {}
  for (const [key, raw] of Object.entries(v)) {
    if (!isComputableGateKey(key) && !isPendingGateKey(key)) {
      throw new BeatRecipeError(
        `${where}: unknown gate metric "${key}" — must be a FEATURE_KEYS metric (${COMPUTABLE_GATE_KEYS.join(', ')}) or a declared pending 131 §4 key (${PENDING_GATE_KEYS.join(', ')})`,
      )
    }
    out[key] = band(raw, `${where}.${key}`)
  }
  return out
}

function validatePatch(patch: unknown, where: string): RecipePatch {
  if (!isObj(patch)) throw new BeatRecipeError(`${where}.patch must be an object`)
  if (typeof patch['from'] === 'string') {
    const from = patch['from']
    if (!/^(factory|curated|surge|matched|retarget):/.test(from)) {
      throw new BeatRecipeError(`${where}.patch.from must be prefixed factory:|curated:|surge:|matched:|retarget: , got "${from}"`)
    }
    const retarget = patch['retarget'] === undefined ? undefined : gateMap(patch['retarget'], `${where}.patch.retarget`)
    return retarget ? { from, retarget } : { from }
  }
  const out: RecipePatchLiteral = {}
  for (const [key, value] of Object.entries(patch)) {
    const kind = SYNTH_FIELD_KINDS.get(key)
    if (!kind) {
      throw new BeatRecipeError(
        `${where}.patch: "${key}" is not a dotbeat synth parameter — a recipe may never name a field the format cannot express (record it under \`gaps\` instead). Legal fields come from SYNTH_PARAM_ORDER + SYNTH_FIELDS in src/core/document.ts.`,
      )
    }
    if (kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new BeatRecipeError(`${where}.patch.${key} must be a finite number, got ${JSON.stringify(value)}`)
    } else if (kind === 'bool') {
      if (typeof value !== 'boolean') throw new BeatRecipeError(`${where}.patch.${key} must be a boolean, got ${JSON.stringify(value)}`)
    } else if (kind === 'trackref') {
      if (typeof value !== 'string') throw new BeatRecipeError(`${where}.patch.${key} must be a track-id string, got ${JSON.stringify(value)}`)
    } else {
      const values = SYNTH_FIELD_VALUES.get(key) ?? []
      if (typeof value !== 'string' || !values.includes(value)) {
        throw new BeatRecipeError(`${where}.patch.${key} must be one of ${values.join('|')}, got ${JSON.stringify(value)}`)
      }
    }
    out[key] = value as number | string | boolean
  }
  return out
}

function validateProduce(v: unknown, where: string): RecipeProduce {
  if (!isObj(v)) throw new BeatRecipeError(`${where} must be an object`)
  for (const key of Object.keys(v)) {
    if (!(PRODUCE_KEYS as readonly string[]).includes(key)) {
      throw new BeatRecipeError(`${where}: unknown production field "${key}" (ProductionProfile fields: ${PRODUCE_KEYS.join(', ')}; \`role\` is named on the layer and \`duck\` is a chain step)`)
    }
  }
  return v as RecipeProduce
}

function validateStep(v: unknown, where: string, layerIds: ReadonlySet<string>, addedTracks: Set<string>): RecipeStep {
  if (!isObj(v)) throw new BeatRecipeError(`${where} must be an object`)
  const known = (id: string): boolean => layerIds.has(id) || addedTracks.has(id)
  if (typeof v['set'] === 'string') {
    const path = v['set']
    const m = path.match(/^\$([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)$/)
    if (!m) throw new BeatRecipeError(`${where}.set must look like "$<layerId>.<field>", got "${path}"`)
    const [, ref, field] = m as unknown as [string, string, string]
    if (!known(ref)) throw new BeatRecipeError(`${where}.set references unknown layer/track "$${ref}" (have: ${[...layerIds, ...addedTracks].join(', ')})`)
    const kind = settableKind(field)
    if (!kind) throw new BeatRecipeError(`${where}.set: "${field}" is not a settable dotbeat parameter`)
    const value = v['value']
    if (value === undefined) throw new BeatRecipeError(`${where}.set needs a \`value\``)
    if (kind === 'number' && typeof value !== 'number') throw new BeatRecipeError(`${where}.value must be a number for ${field}`)
    if (kind === 'bool' && typeof value !== 'boolean') throw new BeatRecipeError(`${where}.value must be a boolean for ${field}`)
    if (kind === 'enum') {
      const values = SYNTH_FIELD_VALUES.get(field) ?? []
      if (typeof value !== 'string' || !values.includes(value)) throw new BeatRecipeError(`${where}.value must be one of ${values.join('|')} for ${field}`)
    }
    if (kind === 'trackref' && typeof value === 'string' && value !== 'none' && !known(value)) {
      throw new BeatRecipeError(`${where}.value: duckSource "${value}" is not a layer or an added track`)
    }
    return { set: path, value: value as number | string | boolean }
  }
  if (typeof v['effectAdd'] === 'string') {
    const ref = v['effectAdd'].replace(/^\$/, '')
    if (!known(ref)) throw new BeatRecipeError(`${where}.effectAdd references unknown layer/track "${ref}"`)
    const type = v['type']
    if (typeof type !== 'string' || !(EFFECT_TYPES as readonly string[]).includes(type)) {
      throw new BeatRecipeError(`${where}.type must be one of ${EFFECT_TYPES.join('|')}, got ${JSON.stringify(type)}`)
    }
    return { effectAdd: `$${ref}`, type: type as EffectType }
  }
  if (typeof v['trackAdd'] === 'string') {
    const id = v['trackAdd']
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new BeatRecipeError(`${where}.trackAdd must be a simple track id, got "${id}"`)
    if (known(id)) throw new BeatRecipeError(`${where}.trackAdd "${id}" collides with an existing layer/track`)
    if (v['kind'] !== 'drums') throw new BeatRecipeError(`${where}.trackAdd only supports kind "drums" in v1 (the ghost-kick pump source — research 138 free win 9)`)
    const hits = v['hits']
    if (typeof hits !== 'string' || !(hits in RECIPE_HIT_PATTERNS)) {
      throw new BeatRecipeError(`${where}.hits must be one of ${Object.keys(RECIPE_HIT_PATTERNS).join('|')}, got ${JSON.stringify(hits)}`)
    }
    const volume = v['volume']
    if (typeof volume !== 'number' || !Number.isFinite(volume)) throw new BeatRecipeError(`${where}.volume must be a number (−60 floors the ghost track to silence)`)
    addedTracks.add(id)
    return { trackAdd: id, kind: 'drums', hits, volume }
  }
  throw new BeatRecipeError(`${where}: unknown step — expected one of set / effectAdd / trackAdd`)
}

function validateLayer(v: unknown, where: string, role: RecipeRole): RecipeLayer {
  if (!isObj(v)) throw new BeatRecipeError(`${where} must be an object`)
  const id = v['id']
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) throw new BeatRecipeError(`${where}.id must be a kebab-case token, got ${JSON.stringify(id)}`)
  const kind = v['kind']
  if (kind !== 'synth' && kind !== 'drums') throw new BeatRecipeError(`${where}.kind must be "synth" or "drums", got ${JSON.stringify(kind)}`)
  if (kind === 'drums' && role !== 'drum-loop') throw new BeatRecipeError(`${where}: a drums layer only belongs to a drum-loop recipe`)
  if (kind === 'synth' && role === 'drum-loop') throw new BeatRecipeError(`${where}: a drum-loop recipe's layers must all be drums layers (the kit IS the figure)`)
  const transpose = v['transpose']
  if (transpose !== undefined && (typeof transpose !== 'number' || !Number.isInteger(transpose) || Math.abs(transpose) > 48)) {
    throw new BeatRecipeError(`${where}.transpose must be an integer semitone offset within ±48, got ${JSON.stringify(transpose)}`)
  }
  const layerRole = v['role']
  if (layerRole !== undefined && (typeof layerRole !== 'string' || !(PRODUCTION_ROLES as readonly string[]).includes(layerRole))) {
    throw new BeatRecipeError(`${where}.role must be a ProductionRole (${PRODUCTION_ROLES.join('|')}), got ${JSON.stringify(layerRole)}`)
  }
  const why = v['why']
  if (typeof why !== 'string' || why.trim() === '') throw new BeatRecipeError(`${where}.why is required — a layer with no stated job is exactly the "mud" failure the corpus warns about (docs/priors/layering.md §6)`)
  const layer: RecipeLayer = {
    id,
    kind,
    ...(transpose !== undefined ? { transpose } : {}),
    ...(layerRole !== undefined ? { role: layerRole } : {}),
    patch: validatePatch(v['patch'], where),
    ...(v['produce'] !== undefined ? { produce: validateProduce(v['produce'], `${where}.produce`) } : {}),
    ...(v['gates'] !== undefined ? { gates: gateMap(v['gates'], `${where}.gates`) } : {}),
    why,
  }
  return layer
}

function validateSource(v: unknown, where: string): RecipeSource {
  if (!isObj(v)) throw new BeatRecipeError(`${where} must be an object`)
  const { cite, claim, confidence, url } = v as Record<string, unknown>
  if (typeof cite !== 'string' || cite.trim() === '') throw new BeatRecipeError(`${where}.cite is required`)
  if (typeof claim !== 'string' || claim.trim() === '') throw new BeatRecipeError(`${where}.claim is required — say what this source contributes`)
  if (typeof confidence !== 'string' || !(SOURCE_CONFIDENCES as readonly string[]).includes(confidence)) {
    throw new BeatRecipeError(`${where}.confidence must be one of ${SOURCE_CONFIDENCES.join('|')}, got ${JSON.stringify(confidence)}`)
  }
  if (url !== undefined && typeof url !== 'string') throw new BeatRecipeError(`${where}.url must be a string`)
  return { cite, claim, confidence: confidence as SourceConfidence, ...(url !== undefined ? { url } : {}) }
}

function validateFeel(v: unknown, where: string): RecipeFeel {
  if (!isObj(v)) throw new BeatRecipeError(`${where} must be an object`)
  const known = ['swingPct', 'swingGrid', 'velocityTiers', 'gate', 'glideSeconds', 'restBeatOneSixteenth', 'notes']
  for (const key of Object.keys(v)) if (!known.includes(key)) throw new BeatRecipeError(`${where}: unknown feel field "${key}" (have: ${known.join(', ')})`)
  const feel = v as Record<string, unknown>
  if (feel['swingPct'] !== undefined) {
    const s = feel['swingPct']
    if (typeof s !== 'number' || s < 50 || s > 80) throw new BeatRecipeError(`${where}.swingPct must be 50..80 (the corpus's whole observed span: 50 straight, 66.7 triplet, 70–80 "dusted" house — docs/priors/drums.md)`)
  }
  if (feel['swingGrid'] !== undefined && (typeof feel['swingGrid'] !== 'number' || feel['swingGrid'] <= 0)) throw new BeatRecipeError(`${where}.swingGrid must be a positive number`)
  if (feel['velocityTiers'] !== undefined) {
    const t = feel['velocityTiers']
    if (!Array.isArray(t) || t.length === 0 || t.some((x) => typeof x !== 'number' || x <= 0 || x > 1)) throw new BeatRecipeError(`${where}.velocityTiers must be a non-empty array of numbers in (0, 1]`)
  }
  if (feel['gate'] !== undefined && (typeof feel['gate'] !== 'number' || feel['gate'] <= 0 || feel['gate'] > 4)) throw new BeatRecipeError(`${where}.gate must be a note-length multiplier in (0, 4]`)
  if (feel['glideSeconds'] !== undefined && (typeof feel['glideSeconds'] !== 'number' || feel['glideSeconds'] < 0 || feel['glideSeconds'] > 1)) throw new BeatRecipeError(`${where}.glideSeconds must be 0..1 (the \`glide\` field's own range)`)
  if (feel['restBeatOneSixteenth'] !== undefined && typeof feel['restBeatOneSixteenth'] !== 'boolean') throw new BeatRecipeError(`${where}.restBeatOneSixteenth must be a boolean`)
  if (feel['notes'] !== undefined && (!Array.isArray(feel['notes']) || feel['notes'].some((n) => typeof n !== 'string'))) throw new BeatRecipeError(`${where}.notes must be an array of strings`)
  return v as RecipeFeel
}

function validateRecipe(v: unknown, index: number): Recipe {
  const where = `recipes[${index}]`
  if (!isObj(v)) throw new BeatRecipeError(`${where} must be an object`)
  const name = v['name']
  if (typeof name !== 'string' || !/^[a-z0-9-]+$/.test(name)) throw new BeatRecipeError(`${where}.name must be kebab-case ([a-z0-9-]+), got ${JSON.stringify(name)}`)
  const version = v['version']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new BeatRecipeError(`${name}.version must be a positive integer (frozen science: a numeric change mints a new version)`)
  const role = v['role']
  if (typeof role !== 'string' || !(RECIPE_ROLES as readonly string[]).includes(role)) throw new BeatRecipeError(`${name}.role must be one of ${RECIPE_ROLES.join('|')}, got ${JSON.stringify(role)}`)
  const r = role as RecipeRole

  const tags = v['tags']
  if (!Array.isArray(tags) || tags.length === 0 || tags.some((t) => typeof t !== 'string')) throw new BeatRecipeError(`${name}.tags must be a non-empty array of strings`)
  const character = v['character']
  if (typeof character !== 'string' || character.trim() === '') throw new BeatRecipeError(`${name}.character is required`)

  const rawSources = v['sources']
  if (!Array.isArray(rawSources) || rawSources.length === 0) throw new BeatRecipeError(`${name}.sources must be a non-empty array — an uncited recipe is lore, not evidence`)
  const sources = rawSources.map((s, i) => validateSource(s, `${name}.sources[${i}]`))

  const figureRaw = v['figure']
  if (!isObj(figureRaw)) throw new BeatRecipeError(`${name}.figure must be an object`)
  const archetype = figureRaw['archetype']
  const bank = RECIPE_ARCHETYPE_BANKS[r]
  if (typeof archetype !== 'string' || (archetype !== 'any' && !bank.includes(archetype))) {
    throw new BeatRecipeError(`${name}.figure.archetype must be "any" or one of the ${r} bank (${bank.join(', ')}), got ${JSON.stringify(archetype)}`)
  }
  const register = band(figureRaw['register'], `${name}.figure.register`)
  if (register[0] < 0 || register[1] > 127) throw new BeatRecipeError(`${name}.figure.register must sit inside MIDI 0..127`)
  const figure: RecipeFigure = { archetype, register, feel: validateFeel(figureRaw['feel'], `${name}.figure.feel`) }

  const rawLayers = v['layers']
  if (!Array.isArray(rawLayers) || rawLayers.length === 0) throw new BeatRecipeError(`${name}.layers must be a non-empty array`)
  const layers = rawLayers.map((l, i) => validateLayer(l, `${name}.layers[${i}]`, r))
  const layerIds = new Set<string>()
  for (const l of layers) {
    if (layerIds.has(l.id)) throw new BeatRecipeError(`${name}: duplicate layer id "${l.id}"`)
    layerIds.add(l.id)
  }

  const rawChain = v['chain'] ?? []
  if (!Array.isArray(rawChain)) throw new BeatRecipeError(`${name}.chain must be an array`)
  const addedTracks = new Set<string>()
  const chain = rawChain.map((s, i) => validateStep(s, `${name}.chain[${i}]`, layerIds, addedTracks))

  const gates = gateMap(v['gates'], `${name}.gates`)
  if (Object.keys(gates).length === 0) throw new BeatRecipeError(`${name}.gates must carry at least one clip-level gate — an unverifiable recipe is a preset`)

  const provRaw = v['provenance']
  if (!isObj(provRaw)) throw new BeatRecipeError(`${name}.provenance must be an object`)
  const status = provRaw['status']
  if (typeof status !== 'string' || !(RECIPE_STATUSES as readonly string[]).includes(status)) throw new BeatRecipeError(`${name}.provenance.status must be one of ${RECIPE_STATUSES.join('|')}`)
  const mined = provRaw['gatesMinedFrom']
  if (!isObj(mined) || typeof mined['refs'] !== 'string' || typeof mined['stat'] !== 'string' || typeof mined['asOf'] !== 'string') {
    throw new BeatRecipeError(`${name}.provenance.gatesMinedFrom needs { refs, stat, asOf } — where the numbers came from, and when`)
  }
  const receipt = provRaw['verifyReceipt']
  if (receipt !== null && receipt !== undefined && !isObj(receipt)) throw new BeatRecipeError(`${name}.provenance.verifyReceipt must be null or a feature map`)
  const record = provRaw['blindRecord']
  if (record !== undefined && !Array.isArray(record)) throw new BeatRecipeError(`${name}.provenance.blindRecord must be an array (append-only)`)
  if (status === 'verified' || status === 'validated') {
    const pending = Object.keys(gates).filter(isPendingGateKey)
    if (pending.length > 0) {
      throw new BeatRecipeError(
        `${name}: status "${status}" is not reachable while gates reference metrics the pipeline cannot compute (${pending.join(', ')}) — research 139 §4.2. Ship 138's B0 feature upgrade first.`,
      )
    }
  }

  const rawDials = v['dials']
  let dials: RecipeDial[] | undefined
  if (rawDials !== undefined) {
    if (!Array.isArray(rawDials)) throw new BeatRecipeError(`${name}.dials must be an array`)
    dials = rawDials.map((d, i) => {
      const dw = `${name}.dials[${i}]`
      if (!isObj(d)) throw new BeatRecipeError(`${dw} must be an object`)
      if (typeof d['name'] !== 'string') throw new BeatRecipeError(`${dw}.name is required`)
      if (typeof d['note'] !== 'string' || d['note'].trim() === '') throw new BeatRecipeError(`${dw}.note must state the disagreement this dial preserves`)
      if (typeof d['value'] !== 'number') throw new BeatRecipeError(`${dw}.value must be a number (the encoded default — the patch-file median where one exists)`)
      const range = band(d['range'], `${dw}.range`)
      if (d['value'] < range[0] || d['value'] > range[1]) throw new BeatRecipeError(`${dw}.value ${d['value']} sits outside its own range [${range[0]}, ${range[1]}]`)
      const field = d['field']
      if (field !== undefined && (typeof field !== 'string' || !recipeFieldExists(field))) throw new BeatRecipeError(`${dw}.field must name a real dotbeat synth parameter, got ${JSON.stringify(field)}`)
      return { name: d['name'], value: d['value'], range, note: d['note'], ...(field !== undefined ? { field: field as string } : {}) }
    })
  }

  const rawGaps = v['gaps']
  if (rawGaps !== undefined && (!Array.isArray(rawGaps) || rawGaps.some((g) => typeof g !== 'string'))) throw new BeatRecipeError(`${name}.gaps must be an array of strings`)

  return {
    name,
    version,
    role: r,
    tags: tags as string[],
    character,
    sources,
    ...(dials ? { dials } : {}),
    ...(rawGaps ? { gaps: rawGaps as string[] } : {}),
    figure,
    layers,
    chain,
    gates,
    provenance: {
      status: status as RecipeStatus,
      gatesMinedFrom: { refs: mined['refs'] as string, stat: mined['stat'] as string, asOf: mined['asOf'] as string, ...(typeof mined['regenerate'] === 'string' ? { regenerate: mined['regenerate'] } : {}) },
      verifyReceipt: (receipt ?? null) as Record<string, number> | null,
      blindRecord: (record ?? []) as unknown[],
    },
  }
}

/** The library envelope, mirroring `presets/tricks.json`: `{ version: 1, recipes: [...] }`.
 * Pure: takes the JSON TEXT, never a path. */
export function parseRecipeLibrary(json: string): Recipe[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    throw new BeatRecipeError(`recipe library is not valid JSON: ${(err as Error).message}`)
  }
  if (!isObj(parsed)) throw new BeatRecipeError('recipe library must be a JSON object')
  if (parsed['version'] !== 1) throw new BeatRecipeError(`recipe library version must be 1, got ${JSON.stringify(parsed['version'])}`)
  const raw = parsed['recipes']
  if (!Array.isArray(raw)) throw new BeatRecipeError('recipe library needs a `recipes` array')
  const recipes = raw.map(validateRecipe)
  const seen = new Set<string>()
  for (const r of recipes) {
    if (seen.has(r.name)) throw new BeatRecipeError(`duplicate recipe name "${r.name}"`)
    seen.add(r.name)
  }
  return recipes
}

/** Every drum lane a recipe may address — re-exported so the doc generator and tests read the
 * same list the format defines. */
export const RECIPE_DRUM_LANES: readonly string[] = DRUM_LANES
