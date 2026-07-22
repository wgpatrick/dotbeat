// Production tricks — docs/research/118-production-bag-of-tricks.md (the operational half of
// research/115-production-layer-techniques.md). "A trick is a preset with preconditions and a
// receipt." This is the rung above macros (src/core/macro.ts) and produced-defaults
// (src/analysis/produce.ts): a validated catalog of named production MOVES, each carrying
//   (1) machine-readable PRECONDITIONS over the metric vector the eval loop already computes
//       (taste/features.ts FEATURE_KEYS) AND over document state (SYNTH_FIELDS values, song mode,
//       lane hits) — so "this track is mono and shouldn't be" is a computable fact, not vibes;
//   (2) a multi-verb RECIPE in a closed step vocabulary (set / effect-add / macro / automate /
//       hits), every step resolving through an EXISTING edit primitive — the trick engine composes,
//       it never invents grammar (D9, the macro/preset lesson re-applied); and
//   (3) a declared EXPECTED DELTA on those same metrics (the CI/eval verification contract — the
//       `trick verify` render loop is deferred to v2, but the contract lives in the catalog now).
//
// Validation is EAGER (research 118 §1.3 layer 1), mirroring showdownRole()'s genSubject discipline
// ("so a drifted prompt bank fails at spec time, not mid-run") and parseMacroLibrary's structural
// posture: every field/effect/param/macro/lane a trick names is checked against the LIVE format
// vocabulary at load time, so a SYNTH_FIELDS rename breaks the trick library loudly in CI, before
// any agent trusts a stale recipe. Lives in src/analysis/ (not src/core/, despite research 118's
// sketch) because the metric-precondition half binds to taste/features.ts FEATURE_KEYS, and core
// must not depend upward on taste/metrics — exactly the layer produce.ts already occupies.

import {
  applyMacro,
  addEffect,
  addHit,
  setAutomationPoint,
  setValue,
  EFFECT_TYPES,
  SYNTH_FIELDS,
  SYNTH_PARAM_ORDER,
  OSC_TYPES,
  AUTOMATABLE_SYNTH_PARAMS,
  DEFAULT_DRUM_KIT,
  DRUM_LANES,
  type BeatDocument,
  type BeatMacro,
  type EffectType,
  type SynthFieldKind,
} from '../core/index.js'
import { FEATURE_KEYS, featuresForAudioFile, type FeatureKey, type FeatureVector } from '../taste/features.js'
import { productionRoleFor, type ProductionRole } from './produce.js'

export class BeatTrickError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatTrickError'
  }
}

// ---- the trick representation ------------------------------------------------------------------

/** The four measured gap axes from the source showdown (research 115 §6 / 118 §2): width (engine
 * renders mono, -52 dB vs ref -11), air (near-zero vs 1.9%), motion (Audiobox PC 2.1 vs 4.5), and
 * glue (the harmonic-density / "less digital" axis). Arrangement/transition tricks (118 §21-22)
 * strain the closed recipe vocabulary with clip-copy semantics and are deferred to a later pass. */
export const TRICK_AXES = ['width', 'air', 'motion', 'glue'] as const
export type TrickAxis = (typeof TRICK_AXES)[number]

export type CompareOp = '<' | '<=' | '>' | '>=' | '==' | '!='
const COMPARE_OPS: readonly CompareOp[] = ['<', '<=', '>', '>=', '==', '!=']

/** A machine-readable precondition clause. Three kinds, all computable today:
 *  - `metric`: over a FEATURE_KEYS value of a render (needs a wav; unknown when none is available)
 *  - `field`:  over a SYNTH_FIELDS document-state value (always computable from the parsed doc)
 *  - `state`:  over a small closed set of named document predicates (song mode, per-lane hit count) */
export type WhenClause =
  | { metric: FeatureKey; op: CompareOp; value: number }
  | { field: string; op: CompareOp; value: number | boolean | string | null }
  | { state: 'songMode'; op: '==' | '!='; value: boolean }
  | { state: 'laneHitCount'; lane: string; op: CompareOp; value: number }

/** One recipe step — a closed vocabulary, every kind backed by an existing edit primitive.
 *  - `set`:       setValue  — path "$track.<field>"; value literal or a "$knob" slot reference
 *  - `effectAdd`: addEffect — "$track", an EFFECT_TYPES member (no-op with a note if already present)
 *  - `macro`:     applyMacro from presets/macros.json
 *  - `automate`:  setAutomationPoint — needs a `$clip`; time tokens 0/$clipEndStep/$phraseEndStep
 *  - `addHits`:   addHit — a drum lane, a named step pattern, one velocity */
export type RecipeStep =
  | { set: string; value: number | string | boolean }
  | { effectAdd: string; type: EffectType }
  | { macro: string; track: string; knob: number }
  | { automate: string; clip: string; points: [number | string, number][] }
  | { addHits: string; lane: string; steps: string; velocity: number }

/** The declared metric delta — direction plus optional minimum movement. The verification contract
 * for `trick verify` (v2) and research 119's blind production-transform eval; carried in the catalog
 * and surfaced by `show`/the generated reference, not executed in v1. */
export interface ExpectClause {
  metric: FeatureKey
  dir: 'up' | 'down' | 'flat'
  min?: number
}

/** A counter-indication. `note` is always prose the agent reads. An optional machine-readable
 * `clause` (same grammar as `when`) makes the counter a hard REFUSAL condition: `beat trick apply`
 * refuses when a counter clause is true, unless --force (research 118 §3.2). A counter with no
 * clause is pure advisory prose (always displayed, never blocks). */
export interface CounterEntry {
  note: string
  clause?: WhenClause
}

export interface TrackSlot {
  /** hard kind constraint — a drums trick on a synth track can't resolve (recipe names osc fields);
   * a mismatch is a structural error, never a warning (same posture as BeatMacro.kind). */
  kind: 'synth' | 'drums' | 'any'
  /** allowlist: the track's production role (productionRoleFor) must be one of these. Advisory
   * counter-indication (refuses unless --force), not a hard error. */
  roles?: ProductionRole[]
  /** denylist: the track's production role must NOT be one of these (e.g. never widen bass/sub).
   * Advisory counter-indication (refuses unless --force). */
  notRoles?: ProductionRole[]
}

export interface KnobSlot {
  name: string
  default: number
}

export interface TrickSlots {
  track: TrackSlot
  /** true = the recipe needs a clip (an `automate` step); resolved from --clip or the track's first
   * clip at apply time. */
  clip?: boolean
  knobs?: KnobSlot[]
}

export interface BeatTrick {
  name: string
  axis: TrickAxis
  slots: TrickSlots
  when: WhenClause[]
  recipe: RecipeStep[]
  expect: ExpectClause[]
  counter: CounterEntry[]
  why: string
}

// ---- the live-vocabulary tables the eager validator checks against -----------------------------

/** kind (+ enum values) for every settable synth field: the core-9 (SYNTH_PARAM_ORDER — all numeric
 * except `osc`) plus every optional SYNTH_FIELDS row. The single source of truth a `set` step's
 * path and value are validated against, so a field rename or a wrong-typed value fails at load. */
const SYNTH_FIELD_KIND = new Map<string, { kind: SynthFieldKind; values?: readonly string[] }>()
for (const k of SYNTH_PARAM_ORDER) SYNTH_FIELD_KIND.set(k, k === 'osc' ? { kind: 'enum', values: OSC_TYPES } : { kind: 'number' })
for (const f of SYNTH_FIELDS) SYNTH_FIELD_KIND.set(f.key, { kind: f.kind, ...(f.values ? { values: f.values } : {}) })

/** The closed named step patterns an `addHits` step may reference — one bar (16 steps), replicated
 * across the loop at apply time. */
export const STEP_PATTERNS: Record<string, readonly number[]> = {
  downbeats: [0, 8],
  quarters: [0, 4, 8, 12],
  'offbeat-8ths': [2, 6, 10, 14],
  '8ths': [0, 2, 4, 6, 8, 10, 12, 14],
  '16ths': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
}

/** Lane names an `addHits` step may reference — research 118 §1.3's "the 12-lane kit set". */
const KIT_LANE_NAMES = new Set<string>([...DEFAULT_DRUM_KIT.map((l) => l.name), ...DRUM_LANES])

/** Automation time tokens a `points` entry may use in place of a literal step number. */
const AUTOMATE_TIME_TOKENS = new Set(['$clipStart', '$clipEndStep', '$phraseEndStep'])

const ALL_ROLES: ReadonlySet<string> = new Set<ProductionRole>(['kick', 'snare', 'hats', 'perc', 'bass', 'sub', 'lead', 'pad', 'chords', 'arp', 'kit', 'default'])

// ---- eager validation (research 118 §1.3 layer 1) ----------------------------------------------

function validateWhenClause(where: string, c: unknown): WhenClause {
  if (typeof c !== 'object' || c === null) throw new BeatTrickError(`${where}: precondition clause must be an object`)
  const o = c as Record<string, unknown>
  if ('metric' in o) {
    if (!(FEATURE_KEYS as readonly string[]).includes(o.metric as string)) {
      throw new BeatTrickError(`${where}: metric "${String(o.metric)}" is not a FEATURE_KEYS member (have: ${FEATURE_KEYS.join(', ')})`)
    }
    if (!COMPARE_OPS.includes(o.op as CompareOp)) throw new BeatTrickError(`${where}: op must be one of ${COMPARE_OPS.join(' ')}, got ${JSON.stringify(o.op)}`)
    if (typeof o.value !== 'number') throw new BeatTrickError(`${where}: a metric clause value must be a number`)
    return { metric: o.metric as FeatureKey, op: o.op as CompareOp, value: o.value }
  }
  if ('field' in o) {
    const def = SYNTH_FIELD_KIND.get(o.field as string)
    if (!def) throw new BeatTrickError(`${where}: field "${String(o.field)}" is not a settable synth field`)
    if (!COMPARE_OPS.includes(o.op as CompareOp)) throw new BeatTrickError(`${where}: op must be one of ${COMPARE_OPS.join(' ')}, got ${JSON.stringify(o.op)}`)
    validateFieldValue(where, def, o.value)
    return { field: o.field as string, op: o.op as CompareOp, value: o.value as number | boolean | string | null }
  }
  if ('state' in o) {
    if (o.state === 'songMode') {
      if (o.op !== '==' && o.op !== '!=') throw new BeatTrickError(`${where}: songMode op must be == or !=`)
      if (typeof o.value !== 'boolean') throw new BeatTrickError(`${where}: songMode value must be a boolean`)
      return { state: 'songMode', op: o.op, value: o.value }
    }
    if (o.state === 'laneHitCount') {
      if (typeof o.lane !== 'string' || !KIT_LANE_NAMES.has(o.lane)) throw new BeatTrickError(`${where}: laneHitCount lane "${String(o.lane)}" is not a known kit lane`)
      if (!COMPARE_OPS.includes(o.op as CompareOp)) throw new BeatTrickError(`${where}: op must be one of ${COMPARE_OPS.join(' ')}`)
      if (typeof o.value !== 'number') throw new BeatTrickError(`${where}: laneHitCount value must be a number`)
      return { state: 'laneHitCount', lane: o.lane, op: o.op as CompareOp, value: o.value }
    }
    throw new BeatTrickError(`${where}: unknown state predicate "${String(o.state)}" (have: songMode, laneHitCount)`)
  }
  throw new BeatTrickError(`${where}: clause must carry one of "metric", "field", or "state"`)
}

function validateFieldValue(where: string, def: { kind: SynthFieldKind; values?: readonly string[] }, value: unknown): void {
  switch (def.kind) {
    case 'number':
      if (typeof value !== 'number') throw new BeatTrickError(`${where}: numeric field needs a number value, got ${JSON.stringify(value)}`)
      break
    case 'bool':
      if (typeof value !== 'boolean') throw new BeatTrickError(`${where}: bool field needs a boolean value, got ${JSON.stringify(value)}`)
      break
    case 'enum':
      if (typeof value !== 'string' || !(def.values ?? []).includes(value)) {
        throw new BeatTrickError(`${where}: enum field value must be one of ${(def.values ?? []).join('|')}, got ${JSON.stringify(value)}`)
      }
      break
    case 'trackref':
      if (value !== null && value !== 'none' && typeof value !== 'string') throw new BeatTrickError(`${where}: trackref field value must be a track id, "none", or null`)
      break
  }
}

/** "$track.<field>" -> field name. */
function trackFieldOf(where: string, path: string): string {
  if (!path.startsWith('$track.')) throw new BeatTrickError(`${where}: path must start with "$track.", got ${JSON.stringify(path)}`)
  return path.slice('$track.'.length)
}

function validateRecipeStep(where: string, step: unknown, knobNames: Set<string>, hasClip: boolean, macroNames: Set<string>): RecipeStep {
  if (typeof step !== 'object' || step === null) throw new BeatTrickError(`${where}: recipe step must be an object`)
  const o = step as Record<string, unknown>

  if ('set' in o) {
    const field = trackFieldOf(where, o.set as string)
    const def = SYNTH_FIELD_KIND.get(field)
    if (!def) throw new BeatTrickError(`${where}: set target "${field}" is not a settable synth field`)
    if (typeof o.value === 'string' && (o.value as string).startsWith('$')) {
      const knob = (o.value as string).slice(1)
      if (!knobNames.has(knob)) throw new BeatTrickError(`${where}: value references undeclared knob slot "$${knob}"`)
      if (def.kind !== 'number') throw new BeatTrickError(`${where}: a knob slot can only fill a numeric field, not ${def.kind} field "${field}"`)
    } else {
      validateFieldValue(where, def, o.value)
    }
    return { set: o.set as string, value: o.value as number | string | boolean }
  }

  if ('effectAdd' in o) {
    if (o.effectAdd !== '$track') throw new BeatTrickError(`${where}: effectAdd target must be "$track"`)
    if (!(EFFECT_TYPES as readonly string[]).includes(o.type as string)) throw new BeatTrickError(`${where}: effect type "${String(o.type)}" is not an EFFECT_TYPES member`)
    return { effectAdd: '$track', type: o.type as EffectType }
  }

  if ('macro' in o) {
    if (!macroNames.has(o.macro as string)) throw new BeatTrickError(`${where}: macro "${String(o.macro)}" is not in the macro library (have: ${[...macroNames].join(', ')})`)
    if (o.track !== '$track') throw new BeatTrickError(`${where}: macro track must be "$track"`)
    if (typeof o.knob !== 'number' || o.knob < 0 || o.knob > 100) throw new BeatTrickError(`${where}: macro knob must be a number 0..100`)
    return { macro: o.macro as string, track: '$track', knob: o.knob }
  }

  if ('automate' in o) {
    if (!hasClip) throw new BeatTrickError(`${where}: an automate step requires the trick to declare a clip slot`)
    const param = trackFieldOf(where, o.automate as string)
    if (!(AUTOMATABLE_SYNTH_PARAMS as readonly string[]).includes(param)) throw new BeatTrickError(`${where}: automate param "${param}" is not in AUTOMATABLE_SYNTH_PARAMS`)
    if (o.clip !== '$clip') throw new BeatTrickError(`${where}: automate clip must be "$clip"`)
    if (!Array.isArray(o.points) || o.points.length < 2) throw new BeatTrickError(`${where}: automate needs a points array with >= 2 entries`)
    for (const p of o.points as unknown[]) {
      if (!Array.isArray(p) || p.length !== 2) throw new BeatTrickError(`${where}: each automate point must be a [time, value] pair`)
      const [t, v] = p as [unknown, unknown]
      if (typeof t === 'string') {
        if (!AUTOMATE_TIME_TOKENS.has(t)) throw new BeatTrickError(`${where}: automate time token "${t}" unknown (have: ${[...AUTOMATE_TIME_TOKENS].join(', ')})`)
      } else if (typeof t !== 'number' || t < 0) {
        throw new BeatTrickError(`${where}: automate time must be a step >= 0 or a time token`)
      }
      if (typeof v !== 'number') throw new BeatTrickError(`${where}: automate value must be a number`)
    }
    return { automate: o.automate as string, clip: '$clip', points: o.points as [number | string, number][] }
  }

  if ('addHits' in o) {
    if (o.addHits !== '$track') throw new BeatTrickError(`${where}: addHits target must be "$track"`)
    if (typeof o.lane !== 'string' || !KIT_LANE_NAMES.has(o.lane)) throw new BeatTrickError(`${where}: addHits lane "${String(o.lane)}" is not a known kit lane`)
    if (typeof o.steps !== 'string' || !(o.steps in STEP_PATTERNS)) throw new BeatTrickError(`${where}: addHits steps "${String(o.steps)}" is not a known pattern (have: ${Object.keys(STEP_PATTERNS).join(', ')})`)
    if (typeof o.velocity !== 'number' || o.velocity <= 0 || o.velocity > 1) throw new BeatTrickError(`${where}: addHits velocity must be in (0, 1]`)
    return { addHits: '$track', lane: o.lane, steps: o.steps, velocity: o.velocity }
  }

  throw new BeatTrickError(`${where}: unknown recipe step kind (have: set, effectAdd, macro, automate, addHits)`)
}

/** Parse + eagerly validate a trick-library JSON string. `macros` is the parsed macro library (the
 * validation context for `macro` steps) — dependency-injected, not read from disk here, so this
 * function stays pure and testable. Every field/effect/param/macro/lane is checked against the LIVE
 * format vocabulary; a drifted trick throws BeatTrickError with a named reason. */
export function parseTrickLibrary(json: string, macros: BeatMacro[]): BeatTrick[] {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    throw new BeatTrickError(`trick library is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  const lib = raw as { version?: unknown; tricks?: unknown }
  if (lib.version !== 1) throw new BeatTrickError(`unsupported trick library version: ${String(lib.version)}`)
  if (!Array.isArray(lib.tricks)) throw new BeatTrickError('trick library has no "tricks" array')
  const macroNames = new Set(macros.map((m) => m.name))

  const out: BeatTrick[] = []
  const seen = new Set<string>()
  for (const entry of lib.tricks as unknown[]) {
    const t = entry as Partial<BeatTrick>
    const where = `trick "${String(t.name)}"`
    if (typeof t.name !== 'string' || !/^[a-z0-9-]+$/.test(t.name)) throw new BeatTrickError(`trick name must be a lowercase slug, got ${JSON.stringify(t.name)}`)
    if (seen.has(t.name)) throw new BeatTrickError(`duplicate trick name "${t.name}"`)
    seen.add(t.name)
    if (!(TRICK_AXES as readonly string[]).includes(t.axis as string)) throw new BeatTrickError(`${where}: axis must be one of ${TRICK_AXES.join(', ')}, got ${JSON.stringify(t.axis)}`)
    if (typeof t.why !== 'string' || t.why.trim() === '') throw new BeatTrickError(`${where}: missing sourced "why"`)

    // slots
    const slots = t.slots as Partial<TrickSlots> | undefined
    if (!slots || typeof slots !== 'object' || !slots.track) throw new BeatTrickError(`${where}: slots.track is required`)
    const tk = slots.track
    if (tk.kind !== 'synth' && tk.kind !== 'drums' && tk.kind !== 'any') throw new BeatTrickError(`${where}: slots.track.kind must be synth|drums|any`)
    for (const r of tk.roles ?? []) if (!ALL_ROLES.has(r)) throw new BeatTrickError(`${where}: unknown role "${r}" in slots.track.roles`)
    for (const r of tk.notRoles ?? []) if (!ALL_ROLES.has(r)) throw new BeatTrickError(`${where}: unknown role "${r}" in slots.track.notRoles`)
    const knobs = slots.knobs ?? []
    const knobNames = new Set<string>()
    for (const k of knobs) {
      if (typeof k.name !== 'string' || !/^[a-z0-9-]+$/.test(k.name)) throw new BeatTrickError(`${where}: knob name must be a slug`)
      if (knobNames.has(k.name)) throw new BeatTrickError(`${where}: duplicate knob slot "${k.name}"`)
      if (typeof k.default !== 'number') throw new BeatTrickError(`${where}: knob "${k.name}" needs a numeric default`)
      knobNames.add(k.name)
    }
    const hasClip = slots.clip === true

    // when
    if (!Array.isArray(t.when)) throw new BeatTrickError(`${where}: "when" must be an array (may be empty)`)
    const when = t.when.map((c, i) => validateWhenClause(`${where} when[${i}]`, c))

    // recipe
    if (!Array.isArray(t.recipe) || t.recipe.length === 0) throw new BeatTrickError(`${where}: "recipe" must be a non-empty array`)
    const recipe = t.recipe.map((s, i) => validateRecipeStep(`${where} recipe[${i}]`, s, knobNames, hasClip, macroNames))

    // expect
    if (!Array.isArray(t.expect) || t.expect.length === 0) throw new BeatTrickError(`${where}: "expect" must be a non-empty array`)
    const expect: ExpectClause[] = t.expect.map((e, i) => {
      const eo = e as Partial<ExpectClause>
      if (!(FEATURE_KEYS as readonly string[]).includes(eo.metric as string)) throw new BeatTrickError(`${where} expect[${i}]: metric "${String(eo.metric)}" is not a FEATURE_KEYS member`)
      if (eo.dir !== 'up' && eo.dir !== 'down' && eo.dir !== 'flat') throw new BeatTrickError(`${where} expect[${i}]: dir must be up|down|flat`)
      if (eo.min !== undefined && typeof eo.min !== 'number') throw new BeatTrickError(`${where} expect[${i}]: min must be a number`)
      return { metric: eo.metric as FeatureKey, dir: eo.dir, ...(eo.min !== undefined ? { min: eo.min } : {}) }
    })

    // counter
    if (!Array.isArray(t.counter)) throw new BeatTrickError(`${where}: "counter" must be an array (may be empty)`)
    const counter: CounterEntry[] = t.counter.map((c, i) => {
      const co = c as Partial<CounterEntry>
      if (typeof co.note !== 'string' || co.note.trim() === '') throw new BeatTrickError(`${where} counter[${i}]: needs a prose "note"`)
      return { note: co.note, ...(co.clause !== undefined ? { clause: validateWhenClause(`${where} counter[${i}] clause`, co.clause) } : {}) }
    })

    out.push({ name: t.name, axis: t.axis as TrickAxis, slots: { track: tk, ...(hasClip ? { clip: true } : {}), ...(knobs.length ? { knobs } : {}) }, when, recipe, expect, counter, why: t.why })
  }
  return out
}

// ---- precondition evaluation -------------------------------------------------------------------

function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case '<': return a < b
    case '<=': return a <= b
    case '>': return a > b
    case '>=': return a >= b
    case '==': return a === b
    case '!=': return a !== b
  }
}

export interface TrickContext {
  doc: BeatDocument
  trackId: string
  /** metric vector of a render, or null when none is available (metric clauses become "unknown"). */
  features: FeatureVector | null
}

export type ClauseResult = 'pass' | 'fail' | 'unknown'

/** Count hits on a lane across a drum track's live hits and its clips (research 118 open-hat-air). */
function laneHitCount(ctx: TrickContext, lane: string): number {
  const track = ctx.doc.tracks.find((t) => t.id === ctx.trackId)
  if (!track) return 0
  let n = track.hits.filter((h) => h.lane === lane).length
  for (const c of track.clips) n += c.hits.filter((h) => h.lane === lane).length
  return n
}

export function evalClause(ctx: TrickContext, c: WhenClause): ClauseResult {
  if ('metric' in c) {
    if (!ctx.features) return 'unknown'
    return compare(ctx.features[c.metric], c.op, c.value) ? 'pass' : 'fail'
  }
  if ('field' in c) {
    const track = ctx.doc.tracks.find((t) => t.id === ctx.trackId)
    if (!track) return 'unknown'
    const raw = (track.synth as unknown as Record<string, unknown>)[c.field]
    // trackref "none"/null equality
    if (c.value === null || c.value === 'none') {
      const isNone = raw === null || raw === undefined
      return (c.op === '==' ? isNone : c.op === '!=' ? !isNone : false) ? 'pass' : 'fail'
    }
    if (typeof raw === 'boolean' || typeof c.value === 'boolean') {
      const eq = raw === c.value
      return (c.op === '==' ? eq : c.op === '!=' ? !eq : false) ? 'pass' : 'fail'
    }
    if (typeof raw === 'string' || typeof c.value === 'string') {
      const eq = raw === c.value
      return (c.op === '==' ? eq : c.op === '!=' ? !eq : false) ? 'pass' : 'fail'
    }
    return compare(raw as number, c.op, c.value as number) ? 'pass' : 'fail'
  }
  // state
  if (c.state === 'songMode') {
    const on = ctx.doc.song !== null
    const eq = on === c.value
    return (c.op === '==' ? eq : !eq) ? 'pass' : 'fail'
  }
  return compare(laneHitCount(ctx, c.lane), c.op, c.value) ? 'pass' : 'fail'
}

/** Does the track satisfy the slot's role allow/deny lists? (advisory — a violation is a
 * counter-indication, not a hard error). Returns a reason when it does NOT. */
function roleViolation(trick: BeatTrick, ctx: TrickContext): string | null {
  const role = productionRoleFor(ctx.trackId)
  const { roles, notRoles } = trick.slots.track
  if (roles && !roles.includes(role)) return `track "${ctx.trackId}" reads as role "${role}"; this trick is for ${roles.join('/')}`
  if (notRoles && notRoles.includes(role)) return `track "${ctx.trackId}" reads as role "${role}", which this trick counter-indicates`
  return null
}

// ---- resolution / apply ------------------------------------------------------------------------

export interface ApplyOptions {
  clipId?: string
  /** knob-slot overrides by name; unset slots use their declared default. */
  knobs?: Record<string, number>
  macros: BeatMacro[]
  force?: boolean
}

export interface TrickApplyResult {
  doc: BeatDocument
  /** honest, human-readable list of what actually changed (the receipt). */
  applied: string[]
  /** failed `when` preconditions, as human-readable warnings (advisory — apply proceeds). */
  warnings: string[]
  /** counter-indications that fired (role/clause); non-empty only when --force overrode them. */
  overridden: string[]
}

const rnd2 = (x: number): number => Math.round(x * 100) / 100

/** Which counter-indications currently fire for this track (role denial + any true counter clause).
 * These are the hard refusals `apply` blocks on unless --force. */
export function firingCounters(trick: BeatTrick, ctx: TrickContext): string[] {
  const out: string[] = []
  const rv = roleViolation(trick, ctx)
  if (rv) out.push(rv)
  for (const c of trick.counter) {
    if (c.clause && evalClause(ctx, c.clause) === 'pass') out.push(c.note)
  }
  return out
}

/** Which `when` preconditions currently fail (advisory warnings). Unknown (no-render) metric
 * clauses are reported separately so the caller can say "couldn't verify" honestly. */
export function failingPreconditions(trick: BeatTrick, ctx: TrickContext): { failed: string[]; unknown: string[] } {
  const failed: string[] = []
  const unknown: string[] = []
  for (const c of trick.when) {
    const r = evalClause(ctx, c)
    if (r === 'fail') failed.push(describeClause(c))
    else if (r === 'unknown') unknown.push(describeClause(c))
  }
  return { failed, unknown }
}

function resolveTime(token: number | string, doc: BeatDocument): number {
  if (typeof token === 'number') return token
  const clipEnd = doc.loopBars * 16
  if (token === '$clipStart') return 0
  if (token === '$clipEndStep') return clipEnd
  if (token === '$phraseEndStep') return Math.max(0, clipEnd - 1)
  return 0
}

/** Apply a trick's recipe to `trackId` as ordinary edits. Notes/hits that the recipe doesn't touch
 * are untouched by construction — every step routes through an existing edit primitive. Refuses on
 * counter-indications unless `force`; failed `when` preconditions warn but proceed (research 118
 * §3.2). Throws BeatTrickError on a hard kind mismatch, a missing track/clip, or a blocked counter. */
export function applyTrick(trick: BeatTrick, ctx: TrickContext, opts: ApplyOptions): TrickApplyResult {
  const track = ctx.doc.tracks.find((t) => t.id === ctx.trackId)
  if (!track) throw new BeatTrickError(`no track "${ctx.trackId}" (have: ${ctx.doc.tracks.map((t) => t.id).join(', ')})`)
  // hard kind constraint
  if (trick.slots.track.kind !== 'any' && track.kind !== trick.slots.track.kind) {
    throw new BeatTrickError(`trick "${trick.name}" is a ${trick.slots.track.kind} trick — track "${ctx.trackId}" is a ${track.kind} track`)
  }
  // counter-indications: hard refusal unless forced
  const counters = firingCounters(trick, ctx)
  if (counters.length > 0 && !opts.force) {
    throw new BeatTrickError(`trick "${trick.name}" counter-indicated for "${ctx.trackId}": ${counters.join('; ')} — re-run with --force to apply anyway`)
  }

  // clip resolution (only if a step needs it)
  const needsClip = trick.recipe.some((s) => 'automate' in s)
  let clipId: string | undefined
  if (needsClip) {
    clipId = opts.clipId ?? track.clips[0]?.id
    if (!clipId) throw new BeatTrickError(`trick "${trick.name}" automates a clip, but track "${ctx.trackId}" has no clip — pass --clip <id> or save a clip first`)
    if (!track.clips.some((c) => c.id === clipId)) throw new BeatTrickError(`no clip "${clipId}" on track "${ctx.trackId}" (have: ${track.clips.map((c) => c.id).join(', ') || 'none'})`)
  }

  const knobVal = (name: string): number => {
    const decl = (trick.slots.knobs ?? []).find((k) => k.name === name)
    return opts.knobs?.[name] ?? decl?.default ?? 0
  }

  let doc = ctx.doc
  const applied: string[] = []
  for (const step of trick.recipe) {
    if ('set' in step) {
      const field = step.set.slice('$track.'.length)
      const value = typeof step.value === 'string' && step.value.startsWith('$') ? knobVal(step.value.slice(1)) : step.value
      doc = setValue(doc, `${ctx.trackId}.${field}`, String(value))
      applied.push(`set ${field} ${value}`)
    } else if ('effectAdd' in step) {
      const t = doc.tracks.find((tt) => tt.id === ctx.trackId)!
      if (t.effects.some((e) => e.type === step.type && e.enabled)) {
        applied.push(`effect ${step.type} already present (no-op)`)
      } else {
        doc = addEffect(doc, ctx.trackId, step.type).doc
        applied.push(`effect-add ${step.type}`)
      }
    } else if ('macro' in step) {
      const macro = opts.macros.find((m) => m.name === step.macro)
      if (!macro) throw new BeatTrickError(`trick "${trick.name}" references macro "${step.macro}", absent from the macro library`)
      doc = applyMacro(doc, ctx.trackId, macro, step.knob)
      applied.push(`macro ${step.macro} @ ${step.knob}`)
    } else if ('automate' in step) {
      const param = step.automate.slice('$track.'.length)
      for (const [t, v] of step.points) {
        doc = setAutomationPoint(doc, ctx.trackId, clipId!, param, { time: resolveTime(t, doc), value: v }).doc
      }
      applied.push(`automate ${param} on ${clipId} (${step.points.length} points)`)
    } else {
      // addHits — replicate the one-bar pattern across the loop; skip a step that already has a hit
      const pattern = STEP_PATTERNS[step.steps]!
      const bars = Math.max(1, doc.loopBars)
      let added = 0
      for (let b = 0; b < bars; b++) {
        for (const s of pattern) {
          const start = b * 16 + s
          const t = doc.tracks.find((tt) => tt.id === ctx.trackId)!
          if (t.hits.some((h) => h.lane === step.lane && h.start === start)) continue
          doc = addHit(doc, ctx.trackId, { lane: step.lane, start, velocity: step.velocity }).doc
          added++
        }
      }
      applied.push(`addHits ${step.lane} ${step.steps} v${step.velocity} (+${added})`)
    }
  }

  const { failed, unknown } = failingPreconditions(trick, ctx)
  const warnings = failed.map((f) => `precondition not met: ${f}`)
  if (unknown.length > 0) warnings.push(`couldn't verify (no render): ${unknown.join('; ')}`)
  return { doc, applied, warnings, overridden: opts.force ? counters : [] }
}

// ---- suggest -----------------------------------------------------------------------------------

/** Produced-metric target bands (research 115 §6 / 118 §1.2 — ref chops: width ≈ -11 dB, air ≈
 * 1.9%). Used only to RANK suggestions by how far a failing metric sits from produced range; the
 * pass/fail contract itself is the trick's `when` clauses, not these. */
export const PRODUCED_RANGES: Partial<Record<FeatureKey, { lo: number; hi: number }>> = {
  stereoWidthDb: { lo: -25, hi: -8 },
  bandAirPct: { lo: 1.0, hi: 2.5 },
  bandSubPct: { lo: 8, hi: 22 },
  bandPresencePct: { lo: 8, hi: 25 },
}

const AXIS_PRIORITY: Record<TrickAxis, number> = { width: 0, air: 1, motion: 2, glue: 3 }

export interface Suggestion {
  trick: BeatTrick
  trackId: string
  /** gap distance used for ranking (0 when no render / no ranged metric). */
  gap: number
  /** true when metric preconditions could not be checked (no render available). */
  unverified: boolean
  reasons: string[]
}

/** How far a metric sits BELOW its produced range (0 if in/above range or unranged). The width and
 * air gaps are the measured showdown ordering (115 §6) — width first. */
function gapBelowRange(metric: FeatureKey, value: number): number {
  const r = PRODUCED_RANGES[metric]
  if (!r) return 0
  return value < r.lo ? r.lo - value : 0
}

/** Rank the catalog's applicable tricks for a track. A trick is suggestible when its kind fits, no
 * counter-indication fires, and every EVALUABLE precondition passes (unknown metric clauses, with no
 * render, don't disqualify — they mark the suggestion `unverified`). Ranked by axis priority (width
 * gap first — 115 §6), then by gap distance descending. Renders nothing itself (research 118 §3.4). */
export function suggestForTrack(tricks: BeatTrick[], ctx: TrickContext): Suggestion[] {
  const track = ctx.doc.tracks.find((t) => t.id === ctx.trackId)
  if (!track) return []
  const out: Suggestion[] = []
  for (const trick of tricks) {
    if (trick.slots.track.kind !== 'any' && track.kind !== trick.slots.track.kind) continue
    if (firingCounters(trick, ctx).length > 0) continue
    let ok = true
    let unverified = false
    for (const c of trick.when) {
      const r = evalClause(ctx, c)
      if (r === 'fail') { ok = false; break }
      if (r === 'unknown') unverified = true
    }
    if (!ok) continue
    // gap = the largest below-range distance among this trick's metric preconditions/expects
    let gap = 0
    const reasons: string[] = []
    if (ctx.features) {
      for (const c of trick.when) {
        if ('metric' in c) {
          const g = gapBelowRange(c.metric, ctx.features[c.metric])
          if (g > gap) gap = g
          reasons.push(`${c.metric}=${rnd2(ctx.features[c.metric])} ${c.op} ${c.value}`)
        }
      }
    }
    out.push({ trick, trackId: ctx.trackId, gap, unverified, reasons })
  }
  out.sort((a, b) => AXIS_PRIORITY[a.trick.axis] - AXIS_PRIORITY[b.trick.axis] || b.gap - a.gap || a.trick.name.localeCompare(b.trick.name))
  return out
}

/** Suggest across a whole document: run suggestForTrack over every synth/drums track, then apply the
 * layered-timeline stacking policy (research 118 §17) — surface at most one trick per axis per track
 * as a "primary" pick, the rest as secondary — so the output reads as a small ordered checklist, not
 * a wall. `wavPath` (a sibling render) is read for metrics when present; else document state only. */
export function suggestForDocument(tricks: BeatTrick[], doc: BeatDocument, wavPath: string | null, onlyTrack?: string): Suggestion[] {
  const features = wavPath ? featuresForAudioFile(wavPath) : null
  const trackIds = onlyTrack ? [onlyTrack] : doc.tracks.filter((t) => t.kind === 'synth' || t.kind === 'drums').map((t) => t.id)
  const all: Suggestion[] = []
  for (const trackId of trackIds) all.push(...suggestForTrack(tricks, { doc, trackId, features }))
  all.sort((a, b) => AXIS_PRIORITY[a.trick.axis] - AXIS_PRIORITY[b.trick.axis] || b.gap - a.gap || a.trackId.localeCompare(b.trackId) || a.trick.name.localeCompare(b.trick.name))
  return all
}

/** Read a sibling render's metrics for suggest: "<file>.beat" -> "<file>.wav" next to it, when it
 * exists and decodes; else null (document-state-only suggest). Never renders. */
export function siblingRenderFeatures(beatPath: string): FeatureVector | null {
  const wav = beatPath.replace(/\.beat$/, '.wav')
  return featuresForAudioFile(wav)
}

// ---- formatting (house style) ------------------------------------------------------------------

export function describeClause(c: WhenClause): string {
  if ('metric' in c) return `${c.metric} ${c.op} ${c.value}`
  if ('field' in c) return `${c.field} ${c.op} ${c.value === null ? 'none' : c.value}`
  if (c.state === 'songMode') return `song mode ${c.op} ${c.value}`
  return `${c.lane} hits ${c.op} ${c.value}`
}

function describeStep(step: RecipeStep): string {
  if ('set' in step) return `set ${step.set} ${step.value}`
  if ('effectAdd' in step) return `effect-add ${step.type}`
  if ('macro' in step) return `macro ${step.macro} @ ${step.knob}`
  if ('automate' in step) return `automate ${step.automate} [${step.points.map(([t, v]) => `${t}:${v}`).join(', ')}]`
  return `addHits ${step.lane} ${step.steps} v${step.velocity}`
}

function describeExpect(e: ExpectClause): string {
  return `${e.metric} ${e.dir}${e.min !== undefined ? ` (>= ${e.min})` : ''}`
}

/** One line per trick — what `beat trick list` prints. */
export function formatTrickList(tricks: BeatTrick[]): string {
  if (tricks.length === 0) return 'no tricks\n'
  const nameW = Math.max(...tricks.map((t) => t.name.length))
  const axisW = Math.max(...tricks.map((t) => t.axis.length))
  return tricks.map((t) => `${t.name.padEnd(nameW)}  ${t.axis.padEnd(axisW)}  ${t.recipe.length} steps  ${t.why.split('.')[0]}`).join('\n') + '\n'
}

/** The full card — what `beat trick show <name>` prints. */
export function formatTrickCard(t: BeatTrick): string {
  const tk = t.slots.track
  const kindLine = `${tk.kind}${tk.roles ? ` (roles: ${tk.roles.join('/')})` : ''}${tk.notRoles ? ` (not: ${tk.notRoles.join('/')})` : ''}`
  const lines = [
    `${t.name}  [${t.axis}]`,
    `  applies to  ${kindLine}${t.slots.clip ? ', needs a clip' : ''}${t.slots.knobs ? `, knobs: ${t.slots.knobs.map((k) => `${k.name}=${k.default}`).join(', ')}` : ''}`,
    `  when        ${t.when.length ? t.when.map(describeClause).join('  AND  ') : '(no preconditions)'}`,
    `  recipe`,
    ...t.recipe.map((s) => `    - ${describeStep(s)}`),
    `  expect      ${t.expect.map(describeExpect).join(', ')}`,
    `  counter`,
    ...(t.counter.length ? t.counter.map((c) => `    - ${c.note}${c.clause ? `  [blocks when: ${describeClause(c.clause)}]` : ''}`) : ['    (none)']),
    `  why         ${t.why}`,
  ]
  return lines.join('\n') + '\n'
}
