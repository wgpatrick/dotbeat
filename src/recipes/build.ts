// Executing a recipe: recipe + key + seed -> the `.beat` document it describes.
//
// The whole point of the library is that a recipe is not prose. `buildRecipeDoc` turns one into a
// real multi-track document — one track per layer, sharing ONE composed figure, each transposed
// and patched per the recipe, plus the clip-level chain (the ghost-kick pump, the per-layer EQ
// carve, the duck wiring). Everything it emits is an ordinary `.beat` edit: `addTrack`,
// `setValue`, `addEffect`, `applyComposedPhrase`, `applyProducedDefaults`. No new format surface,
// no engine work — research 139 §3.4's verdict ("layering is expressible by construction; it has
// simply never been done in the showdown pipeline") made executable.
//
// Determinism: every random draw goes through the composed-phrase helpers, which are seeded
// (mulberry32 via src/core/rng.ts). Same recipe + key + seed => byte-identical document. The test
// suite asserts this directly, because a recipe whose build wanders cannot carry a verify receipt.

import {
  addEffect,
  addHit,
  addTrack,
  initDocument,
  setValue,
  NOTE_FIELD_DEFAULTS,
  type BeatDocument,
} from '../core/index.js'
import { applyProducedDefaults, type ProductionProfile, type ProductionRole } from '../analysis/produce.js'
import { applyComposedDrums, applyComposedPhrase, composeDrumPhrase, composePitchedPhrase } from '../taste/showdown.js'
import type { ComposedDrumPhrase, ComposedNote, ComposedPhrase, PhraseKey } from '../taste/phrase.js'
import {
  BeatRecipeError,
  RECIPE_ARCHETYPE_BANKS,
  RECIPE_HIT_PATTERNS,
  isPatchSource,
  type Recipe,
  type RecipeFeel,
  type RecipeLayer,
} from './schema.js'

export interface BuildRecipeOptions {
  key: PhraseKey
  /** figure seed — the only source of variation between two builds of the same recipe */
  seed: number
  bpm?: number
  /** bars of figure; the showdown's clip length is 4 */
  bars?: number
}

export interface RecipeBuildReport {
  recipe: string
  version: number
  archetype: string
  /** whole-octave shift applied to land the figure inside `figure.register` */
  registerShift: number
  /** per-layer track ids in build order, layer 0 first */
  trackIds: readonly string[]
  /** every feel requirement the builder actually applied, in its own words */
  feelApplied: readonly string[]
  /** feel requirements recorded on the recipe that no builder verb can express (139's honest gap) */
  feelDeferred: readonly string[]
  /** the recipe's declared expressibility gaps, echoed so a build receipt carries them */
  gaps: readonly string[]
}

export interface RecipeBuildResult {
  doc: BeatDocument
  report: RecipeBuildReport
}

const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** Swing percent -> the format's own `shuffleAmount`. Exact, not approximate: `warpStep` eases a
 * shuffle pair through `moebiusEase(x, h)`, and `moebiusEase(0.5, h) === h`, so `h` IS the
 * fraction of the pair the off-beat lands at — i.e. literally the classic swing percentage.
 * `shuffleH(a) = 0.5 + a/2` therefore inverts to `a = (swingPct/100 - 0.5) * 2`. */
export const swingPctToShuffleAmount = (swingPct: number): number => Math.max(0, Math.min(1, (swingPct / 100 - 0.5) * 2))

/** Force one named archetype out of a bank whose chooser is random: `chooseSeeded` returns the
 * first shuffled entry NOT in `exclude`, so excluding every sibling pins the survivor. */
const pinArchetype = (bank: readonly string[], archetype: string): string[] => bank.filter((a) => a !== archetype)

/** Shift the whole figure by whole OCTAVES until its median pitch sits inside the recipe's
 * register window — research 138's free win 2 (bass root E1–A1) generalized to every role, and
 * the reason `figure.register` is a schema field rather than a comment. Whole octaves only: the
 * figure stays diatonic in the batch key by construction. */
function registerShiftFor(notes: readonly ComposedNote[], register: readonly [number, number]): number {
  if (notes.length === 0) return 0
  const mid = median(notes.map((n) => n.pitch))
  const target = (register[0] + register[1]) / 2
  let shift = Math.round((target - mid) / 12) * 12
  // never push a note outside MIDI range
  const lo = Math.min(...notes.map((n) => n.pitch))
  const hi = Math.max(...notes.map((n) => n.pitch))
  while (shift > 0 && hi + shift > 127) shift -= 12
  while (shift < 0 && lo + shift < 0) shift += 12
  return shift
}

/** Apply the recipe's articulation requirements to a composed figure. Every move here is
 * gate-INVISIBLE (139's honest gap: the static features cannot hear feel) — these exist because
 * the owner's ear is their judge, not because a metric will confirm them. */
function applyFeel(notes: readonly ComposedNote[], feel: RecipeFeel, applied: string[]): ComposedNote[] {
  let out = notes.map((n) => ({ ...n }))
  if (feel.restBeatOneSixteenth === true) {
    const before = out.length
    out = out.filter((n) => Math.round(n.start) % 4 !== 0)
    // never empty the figure: if the rule would silence the clip, keep the downbeat and say so
    if (out.length === 0) {
      out = notes.map((n) => ({ ...n })).filter((n) => Math.round(n.start) % 4 === 0)
      applied.push('restBeatOneSixteenth: SKIPPED — the figure lives entirely on beat-1 16ths')
    } else {
      applied.push(`restBeatOneSixteenth: dropped ${before - out.length} of ${before} notes off the kick's 16th`)
    }
  }
  if (feel.velocityTiers && feel.velocityTiers.length > 0) {
    const tiers = feel.velocityTiers
    out = out.map((n) => {
      const s = Math.round(n.start)
      const tier = s % 16 === 0 ? 0 : s % 4 === 0 ? 1 : 2
      const v = tiers[Math.min(tier, tiers.length - 1)]!
      return { ...n, velocity: v }
    })
    applied.push(`velocityTiers ${tiers.join('/')} by metrical position (bar / beat / off-beat)`)
  }
  if (feel.gate !== undefined) {
    out = out.map((n) => ({ ...n, duration: Math.max(0.25, Math.round(n.duration * feel.gate! * 4) / 4) }))
    applied.push(`gate ×${feel.gate} on every note length`)
  }
  return out
}

/** The drum-side of `applyFeel`: velocity tiers by metrical position. `restBeatOneSixteenth` and
 * `gate` are deliberately NOT applied to a kit — the kick is what beat-1 is being cleared FOR, and
 * a hit's length is a lane property, not an articulation. */
function applyDrumFeel(phrase: ComposedDrumPhrase, feel: RecipeFeel, applied: string[]): ComposedDrumPhrase {
  if (!feel.velocityTiers || feel.velocityTiers.length === 0) return phrase
  const tiers = feel.velocityTiers
  applied.push(`velocityTiers ${tiers.join('/')} by metrical position (bar / beat / off-beat)`)
  return {
    archetype: phrase.archetype,
    hits: phrase.hits.map((h) => {
      const s = Math.round(h.start)
      const tier = s % 16 === 0 ? 0 : s % 4 === 0 ? 1 : 2
      return { ...h, velocity: tiers[Math.min(tier, tiers.length - 1)]! }
    }),
  }
}

/** Which feel fields the builder cannot express, so a build report says so out loud. */
function deferredFeel(feel: RecipeFeel): string[] {
  return [...(feel.notes ?? [])]
}

function applyPatch(doc: BeatDocument, layer: RecipeLayer): BeatDocument {
  const patch = layer.patch
  if (isPatchSource(patch)) {
    throw new BeatRecipeError(
      `layer "${layer.id}" uses the patch SOURCE "${patch.from}" — retargeting (research 139 §4.3) is a sibling stream and is not executable here yet. ` +
        `The builder refuses rather than silently rendering the un-retargeted preset, which would be a different sound wearing this recipe's name.`,
    )
  }
  let out = doc
  // Sort so the build is order-independent: two libraries that list the same fields in a
  // different order must produce byte-identical documents.
  for (const key of Object.keys(patch).sort()) {
    out = setValue(out, `${layer.id}.${key}`, String(patch[key]))
  }
  return out
}

function produceProfile(layer: RecipeLayer): ProductionProfile | null {
  if (!layer.produce) return null
  return { role: (layer.role ?? 'default') as ProductionRole, ...layer.produce }
}

/**
 * Build the document a recipe describes: one track per layer, one shared figure, the chain
 * applied, ready to render.
 */
export function buildRecipeDoc(recipe: Recipe, opts: BuildRecipeOptions): RecipeBuildResult {
  const bars = opts.bars ?? 4
  const bpm = opts.bpm ?? 124
  const feelApplied: string[] = []

  // --- the shared figure -------------------------------------------------------------------
  const bank = RECIPE_ARCHETYPE_BANKS[recipe.role]
  const exclude = recipe.figure.archetype === 'any' ? [] : pinArchetype(bank, recipe.figure.archetype)
  let pitched: ComposedPhrase | null = null
  let drums: ComposedDrumPhrase | null = null
  let registerShift = 0
  if (recipe.role === 'drum-loop') {
    drums = applyDrumFeel(composeDrumPhrase(opts.seed, { exclude }), recipe.figure.feel, feelApplied)
  } else {
    const phrase = composePitchedPhrase(recipe.role, opts.key, opts.seed, { exclude })
    registerShift = registerShiftFor(phrase.notes, recipe.figure.register)
    const shifted = phrase.notes.map((n) => ({ ...n, pitch: n.pitch + registerShift }))
    if (registerShift !== 0) feelApplied.push(`register: figure shifted ${registerShift > 0 ? '+' : ''}${registerShift} semitones into MIDI [${recipe.figure.register[0]}, ${recipe.figure.register[1]}]`)
    pitched = { archetype: phrase.archetype, notes: applyFeel(shifted, recipe.figure.feel, feelApplied) }
    if (pitched.notes.length === 0) throw new BeatRecipeError(`${recipe.name}: the feel requirements emptied the figure — nothing to render`)
  }
  const archetype = pitched?.archetype ?? drums!.archetype

  // --- the layer tracks --------------------------------------------------------------------
  const first = recipe.layers[0]!
  // initDocument insists on one track; build it as a scratch id and drop it once the real layers
  // exist, so a drum-loop recipe's first layer can be a drums track (initDocument only makes synths).
  const scratchId = 'recipe-scratch'
  let doc = initDocument({ bpm, loopBars: bars, trackId: scratchId })
  for (const layer of recipe.layers) {
    doc = addTrack(doc, { id: layer.id, kind: layer.kind, name: layer.id }).doc
  }
  doc = { ...doc, tracks: doc.tracks.filter((t) => t.id !== scratchId), selectedTrack: first.id }

  for (const layer of recipe.layers) {
    // notes/hits first: applyProducedDefaults and the patch both act on the synth block only, and
    // a transposed figure is the layer's identity (the octave/fifth split IS the architecture).
    if (layer.kind === 'synth') {
      const shift = layer.transpose ?? 0
      const notes = pitched!.notes.map((n) => ({ ...n, pitch: Math.max(0, Math.min(127, n.pitch + shift)) }))
      doc = applyComposedPhrase(doc, layer.id, { archetype, notes })
    } else {
      doc = applyComposedDrums(doc, layer.id, drums!)
    }
    doc = applyPatch(doc, layer)
    const profile = produceProfile(layer)
    if (profile) doc = applyProducedDefaults(doc, layer.id, profile).doc
    if (recipe.figure.feel.swingPct !== undefined) {
      doc = setValue(doc, `${layer.id}.shuffleAmount`, String(swingPctToShuffleAmount(recipe.figure.feel.swingPct)))
      doc = setValue(doc, `${layer.id}.shuffleGrid`, String(recipe.figure.feel.swingGrid ?? 1))
    }
    if (recipe.figure.feel.glideSeconds !== undefined && layer.kind === 'synth') {
      doc = setValue(doc, `${layer.id}.glide`, String(recipe.figure.feel.glideSeconds))
    }
  }
  if (recipe.figure.feel.swingPct !== undefined) {
    feelApplied.push(`swing ${recipe.figure.feel.swingPct}% -> shuffleAmount ${swingPctToShuffleAmount(recipe.figure.feel.swingPct).toFixed(4)} on grid ${recipe.figure.feel.swingGrid ?? 1}`)
  }
  if (recipe.figure.feel.glideSeconds !== undefined) feelApplied.push(`glide ${recipe.figure.feel.glideSeconds}s on every synth layer (the 303/808 slide)`)

  // --- the clip-level chain ----------------------------------------------------------------
  for (const step of recipe.chain) {
    if ('trackAdd' in step) {
      doc = addTrack(doc, { id: step.trackAdd, kind: step.kind, name: step.trackAdd }).doc
      const pattern = RECIPE_HIT_PATTERNS[step.hits]!
      for (let bar = 0; bar < bars; bar++) {
        for (const s of pattern) doc = addHit(doc, step.trackAdd, { lane: 'kick', start: bar * 16 + s, velocity: 0.9 }).doc
      }
      doc = setValue(doc, `${step.trackAdd}.volume`, String(step.volume))
    } else if ('effectAdd' in step) {
      doc = addEffect(doc, step.effectAdd.replace(/^\$/, ''), step.type).doc
    } else {
      doc = setValue(doc, step.set.replace(/^\$/, ''), String(step.value))
    }
  }

  return {
    doc,
    report: {
      recipe: recipe.name,
      version: recipe.version,
      archetype,
      registerShift,
      trackIds: recipe.layers.map((l) => l.id),
      feelApplied,
      feelDeferred: deferredFeel(recipe.figure.feel),
      gaps: recipe.gaps ?? [],
    },
  }
}

/** Mute every track but one, at the showdown's own levels — the per-layer solo render the
 * per-layer gates are checked against (139 §4.2: "per-layer gates are checked on the layer's solo
 * render — one soloForShowdown call, already exists"). Re-implemented here rather than imported
 * so `src/taste/showdown.ts` (a sibling-owned file) stays untouched. */
export function soloLayer(doc: BeatDocument, layerId: string): BeatDocument {
  if (!doc.tracks.some((t) => t.id === layerId)) throw new BeatRecipeError(`no layer "${layerId}" to solo (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  return {
    ...doc,
    selectedTrack: layerId,
    tracks: doc.tracks.map((t) => (t.id === layerId ? { ...t, synth: { ...t.synth, volume: Math.max(t.synth.volume, -4) } } : { ...t, synth: { ...t.synth, volume: -60 } })),
  }
}

/** Unused-import guard: NOTE_FIELD_DEFAULTS is re-exported so callers building notes by hand
 * outside `applyComposedPhrase` write the same v0.10 defaults the composer does. */
export { NOTE_FIELD_DEFAULTS }
