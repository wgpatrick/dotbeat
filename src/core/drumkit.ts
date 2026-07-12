// Drum kits — Phase 22 Stream AB (docs/research/19-drum-voice-expansion.md Part VII: "ship
// kit-808/kit-909 (synth, generalized voice table), kit-acoustic (SoundFont, MuldjordKit)").
// Deliberately its OWN small mechanism, not bolted onto preset.ts's BeatPreset: a synth preset is
// a bag of `param = value` edits applied to an EXISTING track's synth block (setValue), but a
// drum kit REPLACES a track's whole `lanes` declaration list — a different shape of edit (see
// applyDrumKit below), so it gets its own parse/apply/list trio mirroring preset.ts's, rather than
// forcing lane declarations through the param-bag vocabulary they don't fit.

import type { BeatDocument, BeatDrumLaneDecl, BeatEffect, BeatLaneBacking, DrumVoiceType, EffectType } from './document.js'
import { DRUM_VOICE_TYPES, EFFECT_TYPES, isSampleLaneFilterType, isSampleLaneParamKey } from './document.js'

export interface BeatDrumKit {
  /** Human slug, e.g. "kit-808" — the name `beat drum-kit`/`beat_drum_kit` refer to it by. */
  name: string
  description: string
  /** The kit's full, ordered lane declaration list — see BeatDrumLaneDecl (src/core/document.ts).
   * Applying a kit REPLACES a drum track's entire `lanes` list (not a merge) — a kit is a
   * complete voicing, the drum-track analog of a synth preset's full param bag. */
  lanes: BeatDrumLaneDecl[]
}

export class BeatDrumKitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatDrumKitError'
  }
}

function isDrumVoiceType(s: unknown): s is DrumVoiceType {
  return typeof s === 'string' && (DRUM_VOICE_TYPES as readonly string[]).includes(s)
}

function parseBacking(name: string, raw: unknown): BeatLaneBacking {
  const b = raw as Partial<BeatLaneBacking> & Record<string, unknown>
  if (!b || typeof b !== 'object') throw new BeatDrumKitError(`lane "${name}": backing must be an object`)
  if (b.type === 'synth') {
    if (!isDrumVoiceType(b.voice)) throw new BeatDrumKitError(`lane "${name}": voice must be one of ${DRUM_VOICE_TYPES.join('|')}`)
    const params = (b as { params?: unknown }).params ?? {}
    if (typeof params !== 'object' || params === null || Array.isArray(params)) throw new BeatDrumKitError(`lane "${name}": params must be an object`)
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new BeatDrumKitError(`lane "${name}": param "${k}" must be a finite number`)
    }
    return { type: 'synth', voice: b.voice, params: { ...(params as Record<string, number>) } }
  }
  if (b.type === 'sample') {
    if (typeof b.sample !== 'string' || !b.sample) throw new BeatDrumKitError(`lane "${name}": sample backing needs a "sample" id`)
    if (typeof b.gainDb !== 'number' || !Number.isFinite(b.gainDb)) throw new BeatDrumKitError(`lane "${name}": gainDb must be a finite number`)
    if (typeof b.tune !== 'number' || !Number.isFinite(b.tune) || b.tune < -24 || b.tune > 24) throw new BeatDrumKitError(`lane "${name}": tune must be -24..24 semitones`)
    // Phase 26 Stream DK: optional Start/Length/AHD-envelope/filter/fx fields, same lean surface
    // as the sample lane backing itself (research 68/decisions.md #145) — absent = every default.
    const rawParams = (b as { params?: unknown }).params ?? {}
    if (typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) throw new BeatDrumKitError(`lane "${name}": params must be an object`)
    const params: Record<string, number> = {}
    for (const [k, v] of Object.entries(rawParams as Record<string, unknown>)) {
      if (!isSampleLaneParamKey(k)) throw new BeatDrumKitError(`lane "${name}": unknown sample lane param "${k}"`)
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new BeatDrumKitError(`lane "${name}": param "${k}" must be a finite number`)
      params[k] = v
    }
    const rawFilterType = (b as { filterType?: unknown }).filterType ?? 'lowpass'
    if (typeof rawFilterType !== 'string' || !isSampleLaneFilterType(rawFilterType)) throw new BeatDrumKitError(`lane "${name}": filterType must be one of lowpass|bandpass|highpass`)
    const rawEffects = (b as { effects?: unknown }).effects ?? []
    if (!Array.isArray(rawEffects)) throw new BeatDrumKitError(`lane "${name}": effects must be an array`)
    const effects: BeatEffect[] = rawEffects.map((e) => {
      const eff = e as Partial<BeatEffect>
      if (typeof eff.type !== 'string' || !(EFFECT_TYPES as readonly string[]).includes(eff.type)) {
        throw new BeatDrumKitError(`lane "${name}": effect type must be one of ${EFFECT_TYPES.join('|')}`)
      }
      return { id: typeof eff.id === 'string' && eff.id ? eff.id : eff.type, type: eff.type as EffectType, enabled: eff.enabled !== false }
    })
    return { type: 'sample', sample: b.sample, gainDb: b.gainDb, tune: b.tune, params, filterType: rawFilterType, effects }
  }
  if (b.type === 'sf') {
    if (typeof b.sample !== 'string' || !b.sample) throw new BeatDrumKitError(`lane "${name}": sf backing needs a "sample" id`)
    if (!Number.isInteger(b.program) || (b.program as number) < 0 || (b.program as number) > 127) throw new BeatDrumKitError(`lane "${name}": program must be an integer 0-127`)
    if (!Number.isInteger(b.note) || (b.note as number) < 0 || (b.note as number) > 127) throw new BeatDrumKitError(`lane "${name}": note must be an integer 0-127`)
    return { type: 'sf', sample: b.sample, program: b.program as number, note: b.note as number }
  }
  throw new BeatDrumKitError(`lane "${name}": backing type must be synth|sample|sf, got ${JSON.stringify((b as { type?: unknown }).type)}`)
}

/** Parses and validates a drum-kit library JSON string (the shape of presets/drum-kits.json).
 * Structural validation only — media references (sample/sf backings) are checked at apply time,
 * against the target document's own media block, same as instrument/lane-sample presets. */
export function parseDrumKitLibrary(json: string): BeatDrumKit[] {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    throw new BeatDrumKitError(`drum-kit library is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  const lib = raw as { version?: unknown; kits?: unknown }
  if (lib.version !== 1) throw new BeatDrumKitError(`unsupported drum-kit library version: ${String(lib.version)}`)
  if (!Array.isArray(lib.kits)) throw new BeatDrumKitError('drum-kit library has no "kits" array')

  const out: BeatDrumKit[] = []
  const seenKits = new Set<string>()
  for (const entry of lib.kits as unknown[]) {
    const k = entry as Partial<BeatDrumKit>
    if (typeof k.name !== 'string' || !/^[a-z0-9-]+$/.test(k.name)) throw new BeatDrumKitError(`kit name must be a lowercase slug, got ${JSON.stringify(k.name)}`)
    if (seenKits.has(k.name)) throw new BeatDrumKitError(`duplicate kit name "${k.name}"`)
    seenKits.add(k.name)
    if (typeof k.description !== 'string') throw new BeatDrumKitError(`kit "${k.name}": missing description`)
    if (!Array.isArray(k.lanes) || k.lanes.length === 0) throw new BeatDrumKitError(`kit "${k.name}": lanes must be a non-empty array`)
    const seenLanes = new Set<string>()
    const lanes: BeatDrumLaneDecl[] = k.lanes.map((raw2) => {
      const l = raw2 as Partial<BeatDrumLaneDecl>
      if (typeof l.name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(l.name)) throw new BeatDrumKitError(`kit "${k.name}": lane name must be a slug, got ${JSON.stringify(l.name)}`)
      if (seenLanes.has(l.name)) throw new BeatDrumKitError(`kit "${k.name}": duplicate lane "${l.name}"`)
      seenLanes.add(l.name)
      return { name: l.name, backing: parseBacking(l.name, l.backing) }
    })
    out.push({ name: k.name, description: k.description, lanes })
  }
  return out
}

/** Applies a drum kit to a track: REPLACES its `lanes` list wholesale (a kit is a complete
 * voicing, not an incremental edit). Fails loudly if the track isn't drums, if the kit's sample/
 * sf backings reference media the document hasn't registered (`beat sample` first — same
 * convention as lane-sample/soundfont), or if the track has existing hits on lanes the new kit
 * doesn't declare (an orphaned hit would fail to re-parse — caught here instead). */
export function applyDrumKit(doc: BeatDocument, trackId: string, kit: BeatDrumKit): BeatDocument {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatDrumKitError(`no track "${trackId}" (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  if (track.kind !== 'drums') throw new BeatDrumKitError(`drum kit "${kit.name}" only applies to drum tracks — "${trackId}" is a ${track.kind} track`)
  for (const decl of kit.lanes) {
    const backing = decl.backing
    if (backing.type === 'sample' || backing.type === 'sf') {
      if (!doc.media.some((m) => m.id === backing.sample)) {
        throw new BeatDrumKitError(`kit "${kit.name}" lane "${decl.name}": references unregistered sample "${backing.sample}" — register it with beat sample first`)
      }
    }
  }
  const newNames = new Set(kit.lanes.map((l) => l.name))
  const orphaned = [...new Set(track.hits.filter((h) => !newNames.has(h.lane)).map((h) => h.lane))]
  if (orphaned.length) {
    throw new BeatDrumKitError(`track "${trackId}" has hits on lane(s) not in kit "${kit.name}" (${orphaned.join(', ')}) — remove or re-lane them first`)
  }
  const lanes = kit.lanes.map((l) => ({
    name: l.name,
    backing: {
      ...l.backing,
      ...(l.backing.type === 'synth' || l.backing.type === 'sample' ? { params: { ...l.backing.params } } : {}),
      ...(l.backing.type === 'sample' ? { effects: l.backing.effects.map((e) => ({ ...e })) } : {}),
    },
  }))
  return { ...doc, tracks: doc.tracks.map((t) => (t.id === trackId ? { ...t, lanes } : t)) }
}

/** One line per kit — what `beat drum-kits` prints. */
export function formatDrumKitList(kits: BeatDrumKit[]): string {
  if (kits.length === 0) return 'no drum kits\n'
  const nameWidth = Math.max(...kits.map((k) => k.name.length))
  return kits.map((k) => `${k.name.padEnd(nameWidth)}  ${k.lanes.length} lanes  ${k.description}`).join('\n') + '\n'
}
