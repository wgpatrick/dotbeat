// Presets — docs/phase-5-plan.md §5.5. Deliberately TOOLING, NOT GRAMMAR: the .beat format has
// no preset reference, no include, no indirection — a document always spells out its own sound
// in full (D1: document-only). A preset is just a named bag of `param = value` edits that gets
// applied through the same setValue path as any hand edit, so applying one produces a normal
// readable edit list, a normal one-line-per-param git diff, and a file that stands alone.

import type { BeatDocument } from './document.js'
import { SYNTH_FIELD_BY_KEY, SYNTH_PARAM_ORDER } from './document.js'
import { setValue } from './edit.js'

// Content taxonomy — docs/research/18-ableton-ui-architecture.md's "borrow Ableton's
// categorization logic" recommendation, refined against the researched taxonomy
// docs/phase-12-presets.md's 36 presets were originally built against (Bass/Lead/Pad/Pluck/
// Keys/Arp/FX for synths; genre-named kits for drums). Two disjoint category classes because
// a preset's `kind` already determines which class applies — no preset should mix them.
export const SYNTH_PRESET_CATEGORIES = ['bass', 'lead', 'pad', 'pluck', 'keys', 'arp', 'fx'] as const
export const DRUM_PRESET_CATEGORIES = ['house', '808-trap', 'techno', 'boom-bap', 'lofi', 'acoustic-rock'] as const
export const PRESET_CATEGORIES = [...SYNTH_PRESET_CATEGORIES, ...DRUM_PRESET_CATEGORIES] as const
export type PresetCategory = (typeof PRESET_CATEGORIES)[number]

export interface BeatPreset {
  /** Human slug, e.g. "lush-pad" — the name agents and humans use to refer to it. */
  name: string
  /** Which track kind this voicing is designed for; 'any' fits both. Applying a preset to the
   * wrong kind is an error (fail loudly), not a warning. */
  kind: 'synth' | 'drums' | 'any'
  /** Browsable content category, drawn from `PRESET_CATEGORIES` (research 18's content-taxonomy
   * recommendation) — what a future browser sidebar groups by, and what `beat presets
   * --category` / `beat_presets({ category })` filter on today. */
  category: PresetCategory
  description: string
  /** Param name -> value. Keys must be core-9 or SYNTH_FIELDS names; values are validated by
   * the same table-driven rules as `beat set`. Trackrefs (duckSource) are deliberately not
   * allowed in presets — routing references project-specific track ids, so it stays a per-
   * project edit (e.g. `beat set song.beat pad.duckSource drums`). */
  params: Record<string, number | string | boolean>
}

export class BeatPresetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatPresetError'
  }
}

/** Parses and validates a preset-library JSON string (the shape of presets/factory.json).
 * Validation is structural only — per-value validation happens at apply time via setValue,
 * except trackref params, which are rejected here because no document context could make them
 * portable. */
export function parsePresetLibrary(json: string): BeatPreset[] {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    throw new BeatPresetError(`preset library is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  const lib = raw as { version?: unknown; presets?: unknown }
  if (lib.version !== 1) throw new BeatPresetError(`unsupported preset library version: ${String(lib.version)}`)
  if (!Array.isArray(lib.presets)) throw new BeatPresetError('preset library has no "presets" array')

  const out: BeatPreset[] = []
  const seen = new Set<string>()
  for (const entry of lib.presets as unknown[]) {
    const p = entry as Partial<BeatPreset>
    if (typeof p.name !== 'string' || !/^[a-z0-9-]+$/.test(p.name)) throw new BeatPresetError(`preset name must be a lowercase slug, got ${JSON.stringify(p.name)}`)
    if (seen.has(p.name)) throw new BeatPresetError(`duplicate preset name "${p.name}"`)
    seen.add(p.name)
    if (p.kind !== 'synth' && p.kind !== 'drums' && p.kind !== 'any') throw new BeatPresetError(`preset "${p.name}": kind must be synth|drums|any`)
    if (typeof p.category !== 'string' || !(PRESET_CATEGORIES as readonly string[]).includes(p.category)) {
      throw new BeatPresetError(`preset "${p.name}": category must be one of ${PRESET_CATEGORIES.join(', ')}, got ${JSON.stringify(p.category)}`)
    }
    if (p.kind === 'drums' && !(DRUM_PRESET_CATEGORIES as readonly string[]).includes(p.category)) {
      throw new BeatPresetError(`preset "${p.name}": a drums preset's category must be one of ${DRUM_PRESET_CATEGORIES.join(', ')}, got "${p.category}"`)
    }
    if (p.kind === 'synth' && !(SYNTH_PRESET_CATEGORIES as readonly string[]).includes(p.category)) {
      throw new BeatPresetError(`preset "${p.name}": a synth preset's category must be one of ${SYNTH_PRESET_CATEGORIES.join(', ')}, got "${p.category}"`)
    }
    if (typeof p.description !== 'string') throw new BeatPresetError(`preset "${p.name}": missing description`)
    if (typeof p.params !== 'object' || p.params === null || Array.isArray(p.params)) throw new BeatPresetError(`preset "${p.name}": params must be an object`)
    for (const [key, value] of Object.entries(p.params)) {
      const isCore = (SYNTH_PARAM_ORDER as readonly string[]).includes(key)
      const def = SYNTH_FIELD_BY_KEY.get(key)
      if (!isCore && !def) throw new BeatPresetError(`preset "${p.name}": unknown synth param "${key}"`)
      if (def?.kind === 'trackref') throw new BeatPresetError(`preset "${p.name}": "${key}" is a track reference — routing is per-project, not preset material`)
      const t = typeof value
      if (t !== 'number' && t !== 'string' && t !== 'boolean') throw new BeatPresetError(`preset "${p.name}": param "${key}" has unsupported value type ${t}`)
    }
    out.push({ name: p.name, kind: p.kind, category: p.category, description: p.description, params: { ...p.params } as BeatPreset['params'] })
  }
  return out
}

/** Canonical application order: core 9 first, then SYNTH_FIELDS table order — so the edit list
 * (and any error) is deterministic regardless of JSON key order. */
function orderedParams(preset: BeatPreset): [string, number | string | boolean][] {
  const rank = new Map<string, number>()
  ;(SYNTH_PARAM_ORDER as readonly string[]).forEach((k, i) => rank.set(k, i))
  ;[...SYNTH_FIELD_BY_KEY.keys()].forEach((k, i) => rank.set(k, SYNTH_PARAM_ORDER.length + i))
  return Object.entries(preset.params).sort(([a], [b]) => rank.get(a)! - rank.get(b)!)
}

/** Applies a preset to one track. Pure document -> document, exactly as if each param had been
 * a `beat set` edit; the caller serializes canonically and diffs as usual. */
export function applyPreset(doc: BeatDocument, trackId: string, preset: BeatPreset): BeatDocument {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatPresetError(`no track "${trackId}" (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  if (preset.kind !== 'any' && track.kind !== preset.kind) {
    throw new BeatPresetError(`preset "${preset.name}" is a ${preset.kind} voicing — track "${trackId}" is a ${track.kind} track`)
  }
  let next = doc
  for (const [key, value] of orderedParams(preset)) {
    next = setValue(next, `${trackId}.${key}`, String(value))
  }
  return next
}

/** One line per preset — what `beat presets` prints. Includes the category column so a listing
 * is self-describing without cross-referencing `--category` separately. */
export function formatPresetList(presets: BeatPreset[]): string {
  if (presets.length === 0) return 'no presets\n'
  const nameWidth = Math.max(...presets.map((p) => p.name.length))
  const kindWidth = Math.max(...presets.map((p) => p.kind.length))
  const categoryWidth = Math.max(...presets.map((p) => p.category.length))
  return (
    presets
      .map(
        (p) =>
          `${p.name.padEnd(nameWidth)}  ${p.kind.padEnd(kindWidth)}  ${p.category.padEnd(categoryWidth)}  ${Object.keys(p.params).length} params  ${p.description}`,
      )
      .join('\n') + '\n'
  )
}

/** Filters a preset library to one category — the shared implementation behind `beat presets
 * --category` and `beat_presets({ category })`, kept in core so both surfaces agree on the exact
 * same taxonomy validation and error message. */
export function filterPresetsByCategory(presets: BeatPreset[], category: string): BeatPreset[] {
  if (!(PRESET_CATEGORIES as readonly string[]).includes(category)) {
    throw new BeatPresetError(`unknown category "${category}" — must be one of ${PRESET_CATEGORIES.join(', ')}`)
  }
  return presets.filter((p) => p.category === category)
}
