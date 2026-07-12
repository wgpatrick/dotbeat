// Macros — docs/research/27-macro-tooling-layer.md. Deliberately TOOLING, NOT GRAMMAR, exactly
// like presets (src/core/preset.ts, D9): "a macro is a preset with a continuous input" (research
// 18 §6, confirmed independently by research 27 §1). Turning a macro knob computes N target
// values and writes them through the SAME setValue path as any hand edit — the .beat file only
// ever contains the resolved numbers, never a `macro=0.7` + mapping-table indirection. This file
// deliberately mirrors preset.ts's shape/validation discipline (same error class pattern, same
// "structural validation here, per-value validation at apply time via setValue" posture, same
// "one table, many consumers" house style) rather than inventing a parallel convention.

import type { BeatDocument } from './document.js'
import { AUTOMATABLE_SYNTH_PARAMS } from './document.js'
import { setValue } from './edit.js'

export type MacroCurve = 'linear' | 'exp' | 'log'

export interface MacroTarget {
  /** Must be a member of AUTOMATABLE_SYNTH_PARAMS (research 27 §5) — reusing that derived table,
   * not a hand-maintained parallel whitelist, so macro-target coverage grows for free whenever a
   * new numeric SYNTH_FIELDS entry ships. */
  param: string
  /** Resolved value when the knob reads 0. */
  min: number
  /** Resolved value when the knob reads 100. min > max is valid and IS how "inverted" targets
   * (e.g. a decay that should get SHORTER at higher knob values) are expressed — no separate
   * `invert` flag needed. */
  max: number
  /** Shape of the 0..100 -> min..max mapping. Default 'linear'. 'exp'/'log' mirror the curve math
   * ui/src/components/Knob.tsx already uses for knob *display* scaling (toNorm/fromNorm), ported
   * here as pure functions so core has no UI dependency. */
  curve?: MacroCurve
}

/** Sound-shaping-intent categories — deliberately NOT PRESET_CATEGORIES (bass/lead/pad/...),
 * because a macro cuts across voice types (e.g. "Space" works on a bass track and a pad track
 * equally) where a preset is one voice's whole state. */
export const MACRO_CATEGORIES = ['tone', 'drive', 'space', 'motion', 'dynamics'] as const
export type MacroCategory = (typeof MACRO_CATEGORIES)[number]

export interface BeatMacro {
  /** Lowercase slug, e.g. "filter-sweep" — same naming rule parseMacroLibrary enforces, mirrors
   * parsePresetLibrary. */
  name: string
  /** Which track kind this macro is designed for; 'any' fits both. Applying a macro to the wrong
   * kind is an error (fail loudly), not a warning — same posture as BeatPreset.kind. */
  kind: 'synth' | 'drums' | 'any'
  category: MacroCategory
  description: string
  /** 1..8ish. Order = application order (deterministic edit-list order), same discipline
   * preset.ts's orderedParams() already establishes for presets. */
  targets: MacroTarget[]
}

export class BeatMacroError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatMacroError'
  }
}

/** Parses and validates a macro-library JSON string (the shape of presets/macros.json).
 * Validation is structural only — per-value validation happens at apply time via setValue, except
 * target params, which must already be a member of AUTOMATABLE_SYNTH_PARAMS (no meaningful curve
 * on an enum/bool/trackref, research 27 §5). */
export function parseMacroLibrary(json: string): BeatMacro[] {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    throw new BeatMacroError(`macro library is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  const lib = raw as { version?: unknown; macros?: unknown }
  if (lib.version !== 1) throw new BeatMacroError(`unsupported macro library version: ${String(lib.version)}`)
  if (!Array.isArray(lib.macros)) throw new BeatMacroError('macro library has no "macros" array')

  const out: BeatMacro[] = []
  const seen = new Set<string>()
  for (const entry of lib.macros as unknown[]) {
    const m = entry as Partial<BeatMacro>
    if (typeof m.name !== 'string' || !/^[a-z0-9-]+$/.test(m.name)) throw new BeatMacroError(`macro name must be a lowercase slug, got ${JSON.stringify(m.name)}`)
    if (seen.has(m.name)) throw new BeatMacroError(`duplicate macro name "${m.name}"`)
    seen.add(m.name)
    if (m.kind !== 'synth' && m.kind !== 'drums' && m.kind !== 'any') throw new BeatMacroError(`macro "${m.name}": kind must be synth|drums|any`)
    if (typeof m.category !== 'string' || !(MACRO_CATEGORIES as readonly string[]).includes(m.category)) {
      throw new BeatMacroError(`macro "${m.name}": category must be one of ${MACRO_CATEGORIES.join(', ')}, got ${JSON.stringify(m.category)}`)
    }
    if (typeof m.description !== 'string') throw new BeatMacroError(`macro "${m.name}": missing description`)
    if (!Array.isArray(m.targets) || m.targets.length === 0) throw new BeatMacroError(`macro "${m.name}": targets must be a non-empty array`)

    const targets: MacroTarget[] = []
    const seenParams = new Set<string>()
    for (const raw of m.targets as unknown[]) {
      const t = raw as Partial<MacroTarget>
      if (typeof t.param !== 'string' || !(AUTOMATABLE_SYNTH_PARAMS as readonly string[]).includes(t.param)) {
        throw new BeatMacroError(`macro "${m.name}": target param must be one of AUTOMATABLE_SYNTH_PARAMS, got ${JSON.stringify(t.param)}`)
      }
      if (seenParams.has(t.param)) throw new BeatMacroError(`macro "${m.name}": target param "${t.param}" listed more than once`)
      seenParams.add(t.param)
      if (typeof t.min !== 'number' || typeof t.max !== 'number') {
        throw new BeatMacroError(`macro "${m.name}": target "${t.param}" needs numeric min/max`)
      }
      if (t.curve !== undefined && t.curve !== 'linear' && t.curve !== 'exp' && t.curve !== 'log') {
        throw new BeatMacroError(`macro "${m.name}": target "${t.param}" has invalid curve ${JSON.stringify(t.curve)}`)
      }
      targets.push({ param: t.param, min: t.min, max: t.max, ...(t.curve ? { curve: t.curve } : {}) })
    }
    out.push({ name: m.name, kind: m.kind, category: m.category, description: m.description, targets })
  }
  return out
}

function resolveTarget(t: MacroTarget, knob: number): number {
  const n = Math.min(1, Math.max(0, knob / 100))
  const shaped = t.curve === 'exp' ? n * n : t.curve === 'log' ? Math.sqrt(n) : n
  return t.min + shaped * (t.max - t.min)
}

/** Pure: knob position (0..100) -> resolved (param, value) pairs. No document, no I/O — this is
 * the function both the interactive GUI drag and the one-shot CLI/agent apply share (the GUI's
 * own copy in ui/src/daemon/library.ts mirrors this exactly — research 27 §4: "a small pure
 * function, safe to duplicate/share between src/core and ui/"). */
export function resolveMacro(macro: BeatMacro, knob: number): Array<{ param: string; value: number }> {
  return macro.targets.map((t) => ({ param: t.param, value: resolveTarget(t, knob) }))
}

/** Applies a macro to one track at one knob position. Pure document -> document, exactly
 * preset.ts's applyPreset shape: loop setValue in target order, return the new document. The
 * caller serializes/diffs as usual — this produces N ordinary edit-list lines, nothing new. */
export function applyMacro(doc: BeatDocument, trackId: string, macro: BeatMacro, knob: number): BeatDocument {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatMacroError(`no track "${trackId}" (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  if (macro.kind !== 'any' && track.kind !== macro.kind) {
    throw new BeatMacroError(`macro "${macro.name}" is a ${macro.kind} macro — track "${trackId}" is a ${track.kind} track`)
  }
  let next = doc
  for (const { param, value } of resolveMacro(macro, knob)) next = setValue(next, `${trackId}.${param}`, String(value))
  return next
}

/** One line per macro — what `beat macro list` prints. */
export function formatMacroList(macros: BeatMacro[]): string {
  if (macros.length === 0) return 'no macros\n'
  const nameWidth = Math.max(...macros.map((m) => m.name.length))
  const kindWidth = Math.max(...macros.map((m) => m.kind.length))
  const categoryWidth = Math.max(...macros.map((m) => m.category.length))
  return (
    macros
      .map(
        (m) =>
          `${m.name.padEnd(nameWidth)}  ${m.kind.padEnd(kindWidth)}  ${m.category.padEnd(categoryWidth)}  ${m.targets.length} targets  ${m.description}`,
      )
      .join('\n') + '\n'
  )
}

/** Best-effort inverse of resolveTarget's linear/exp/log shaping — used ONLY by the GUI to
 * estimate where a macro's knob should visually sit from a target's current live value when a
 * track is (re)selected. Never stored, never a claim of ground truth: the file only ever records
 * resolved target values, never "this came from macro X at position N" (research 27 §6, "the
 * knob-position display problem, stated honestly"). */
export function inverseResolveTarget(t: MacroTarget, value: number): number {
  const span = t.max - t.min
  if (span === 0) return 50
  const n = Math.min(1, Math.max(0, (value - t.min) / span))
  const shaped = t.curve === 'exp' ? Math.sqrt(n) : t.curve === 'log' ? n * n : n
  return Math.round(shaped * 100)
}
