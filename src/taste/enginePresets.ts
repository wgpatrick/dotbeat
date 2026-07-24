// Engine preset curation & search (docs/engine-presets.md, tiers E0–E2). The engine's blind-rating
// history measured "the engine playing dice" — every clip drew a RANDOMLY ROLLED seed patch
// (src/taste/seeds.ts synthBlock). This module is the shared, spawn-free logic that lets the
// showdown (and, via the curated bank, taste-seeds / gen-kit) draw a curated VOICING instead:
//
//   E0  patch provenance — the tag string that rides a manifest `from` / work-batch recipe so every
//       future report can split engine results by patch era (random vs factory vs curated).
//   E1  role-mapped factory-preset draw — a seeded, exclude-chained pick from presets/factory.json
//       (drum-loop draws a drum kit from drum-kits.json). Applied as an ORDINARY preset edit, so the
//       engineplus clip inherits it for free.
//   E2  the curated engine bank — when presets/engine-curated.json is present the pitched-role pick
//       prefers its top-quartile per-role list (curated patch PARAM vectors), factory next, and
//       random-seed-patch last (--random-patches). The render+score marathon that PRODUCES that file
//       lives in scripts/curate-engine-presets.mjs; the gate+composite math is the shared, unit-tested
//       src/taste/surgeCuration.ts.
//
// The pick is PURE (document -> document via applyPreset / applyDrumKit) and fs-light so it unit-tests
// without the render pipeline; the CLI (showdownCmd) owns the render/score orchestration.

import { existsSync, readFileSync } from 'node:fs'
import type { BeatDocument } from '../core/document.js'
import { applyPreset, type BeatPreset } from '../core/preset.js'
import { applyDrumKit, type BeatDrumKit } from '../core/drumkit.js'
import { mulberry32 } from './eval.js'

// ---- E0: patch provenance ----------------------------------------------------------------------
// The honest era tag (docs/engine-presets.md E0), same mechanism as the figure-source label. Rides
// the engine/engineplus manifest `from` string and the engine work-batch recipe so reports split
// engine ratings by patch era instead of blurring the comparison this plan exists to make.

/** The seed's randomly rolled synthBlock patch — the historical (dice-playing) engine era. */
export const RANDOM_SEED_PATCH = 'random-seed-patch' as const

/** `factory:<preset-or-kit-name>` — an E1 role-mapped draw from presets/factory.json / drum-kits.json. */
export function factoryProvenance(name: string): string {
  return `factory:${name}`
}

/** `curated:<id>` — an E2 draw from the curated engine bank (presets/engine-curated.json). */
export function curatedProvenance(id: string): string {
  return `curated:${id}`
}

/** Append the patch-provenance tag to a manifest `from` / work-recipe string (`… [patch: <tag>]`).
 * One spelling so the batch recipe and the final manifest carry an identical, greppable tag. */
export function withPatchProvenance(base: string, provenance: string): string {
  return `${base} [patch: ${provenance}]`
}

/** Extract the `[patch: <tag>]` provenance from a `from`/recipe string, or null when absent — the
 * reader half of withPatchProvenance (report splitting, tests asserting the tag flowed through). */
export function readPatchProvenance(from: string): string | null {
  const m = /\[patch: ([^\]]+)\]/.exec(from)
  return m ? m[1]! : null
}

// ---- E1/E2: the role -> preset draw ------------------------------------------------------------

/** Role -> factory.json synth-preset categories. Pitched roles only; drum-loop draws a KIT (below),
 * not a synth voicing, so it maps to null here — the same shape surgeRoleCategories uses. The
 * categories mirror docs/engine-presets.md E1: bassline→bass, chords→pad|keys, lead→lead|pluck|arp. */
export const ENGINE_ROLE_PRESET_CATEGORIES: Record<string, readonly string[] | null> = {
  bassline: ['bass'],
  chords: ['pad', 'keys'],
  lead: ['lead', 'pluck', 'arp'],
  'drum-loop': null,
}

/** The role's synth-preset categories, or null when the role draws a kit / is unknown (the pick
 * then routes to a drum kit for drum-loop, or returns null so the CLI keeps random-seed-patch). */
export function engineRolePresetCategories(role: string): readonly string[] | null {
  return role in ENGINE_ROLE_PRESET_CATEGORIES ? ENGINE_ROLE_PRESET_CATEGORIES[role]! : null
}

/** True iff the role draws a drum kit (drum-kits.json) rather than a synth preset. */
export function engineRoleUsesKit(role: string): boolean {
  return role === 'drum-loop'
}

// ---- E2: the curated engine bank (presets/engine-curated.json) ----------------------------------

/** One curated engine patch: an id + the synth PARAM vector to apply (curation stores the vector,
 * not a factory reference, since ~2k of them are random rolls with no name). `source` records where
 * the candidate came from (`factory:<name>` or `random-roll`) for provenance; `composite` is its
 * blend score (surgeCuration). */
export interface EngineCuratedPatch {
  id: string
  source: string
  category: string
  params: Record<string, number | string | boolean>
  composite: number
}

export interface EngineCuratedRole {
  pool: number
  survivors: number
  kept: EngineCuratedPatch[]
}

export interface EngineCuratedFile {
  version: number
  generatedAt: string
  probe?: Record<string, string>
  blend?: unknown
  gates?: unknown
  roles: Record<string, EngineCuratedRole>
}

/** Read presets/engine-curated.json, or null when absent/unreadable/malformed — the pick then falls
 * back to the factory pool (the CI-safe path: no curated file committed, factory draw as E1). */
export function loadEngineCuratedFile(path: string): EngineCuratedFile | null {
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as EngineCuratedFile
    if (!parsed || typeof parsed !== 'object' || typeof parsed.roles !== 'object' || parsed.roles === null) return null
    return parsed
  } catch {
    return null
  }
}

/** The role's curated patches (deterministic order), or [] when the role has none — the pick then
 * uses the factory pool. */
export function engineCuratedForRole(file: EngineCuratedFile | null, role: string): EngineCuratedPatch[] {
  if (!file) return []
  const r = file.roles?.[role]
  if (!r || !Array.isArray(r.kept)) return []
  return r.kept
}

// ---- the pick ----------------------------------------------------------------------------------

/** A resolved engine-preset pick: the provenance tag, a pure doc->doc application, and a name for
 * logging + exclude-chaining within a run (the archetype-figure convention: no two batches of a run
 * repeat one voicing while the pool has alternatives). */
export interface EnginePick {
  provenance: string
  name: string
  apply: (doc: BeatDocument, trackId: string) => BeatDocument
}

const PRESET_SALT = 811 // distinct from the phrase (composePitchedPhrase) and surge (613) salts

/** A curated patch as a synthetic BeatPreset (kind 'any' so it applies to either a synth or the
 * drums-track voice the seed carries — the params are core-9 + SYNTH_FIELDS, validated at apply). */
function curatedAsPreset(patch: EngineCuratedPatch): BeatPreset {
  return { name: patch.id, kind: 'any', category: 'fx', description: `curated engine patch ${patch.id}`, params: patch.params }
}

/** Deterministically pick one voicing for a role, exclude-chained by name within a run.
 *
 * Preference order (docs/engine-presets.md): the curated engine bank (E2) → factory.json / drum-kits
 * (E1) → null (the caller keeps the seed's random-seed-patch). Returns null when the role has no
 * pool at all (unknown role, or an empty factory category), so the pick degrades cleanly.
 *
 * Determinism: seeded by `seed` + a fixed preset salt, over a pool sorted by name — stable across
 * machines with the same preset content regardless of file order. `exclude` names are dropped first;
 * if that empties the pool (a run longer than the pool) the exclude is ignored so the pick never
 * returns null just because everything's been used. */
export function pickEnginePreset(opts: {
  role: string
  seed: number
  presets: readonly BeatPreset[]
  kits: readonly BeatDrumKit[]
  curated?: EngineCuratedFile | null
  exclude?: readonly string[]
}): EnginePick | null {
  const { role, seed, presets, kits } = opts
  const exclude = new Set(opts.exclude ?? [])
  const rng = mulberry32((seed >>> 0) + PRESET_SALT)
  const drawFrom = <T extends { name: string }>(pool: readonly T[]): T | null => {
    if (pool.length === 0) return null
    const sorted = [...pool].sort((a, b) => a.name.localeCompare(b.name))
    let candidates = sorted.filter((p) => !exclude.has(p.name))
    if (candidates.length === 0) candidates = sorted // run outran the pool — reuse rather than fail
    return candidates[Math.floor(rng() * candidates.length)]!
  }

  // drum-loop: a factory drum kit (drum-kits.json). No curated bank for kits (E2 curates the synth
  // param space, not kit voicings — the surge-curation precedent).
  if (engineRoleUsesKit(role)) {
    const kit = drawFrom(kits)
    if (!kit) return null
    return { provenance: factoryProvenance(kit.name), name: kit.name, apply: (doc, trackId) => applyDrumKit(doc, trackId, kit) }
  }

  const categories = engineRolePresetCategories(role)
  if (categories === null) return null // unknown role — keep random-seed-patch

  // E2: prefer the curated bank when it carries this role.
  const curatedRole = engineCuratedForRole(opts.curated ?? null, role)
  if (curatedRole.length > 0) {
    // reuse drawFrom by mapping id->name so exclude-chaining is one namespace with factory names
    const pick = drawFrom(curatedRole.map((c) => ({ ...c, name: c.id })))
    if (pick) {
      const preset = curatedAsPreset(pick)
      return { provenance: curatedProvenance(pick.id), name: pick.id, apply: (doc, trackId) => applyPreset(doc, trackId, preset) }
    }
  }

  // E1: a role-mapped factory synth preset.
  const pool = presets.filter((p) => p.kind === 'synth' && (categories as readonly string[]).includes(p.category))
  const preset = drawFrom(pool)
  if (!preset) return null
  return { provenance: factoryProvenance(preset.name), name: preset.name, apply: (doc, trackId) => applyPreset(doc, trackId, preset) }
}
