// Phase 35 Stream OD — reference mix profile: save a track-you-love's measured metrics as a
// reusable JSON profile, then critique your own mix against it (`beat lint --ref`). The strongest
// cheap upgrade to the listening loop: "how far am I from the reference?" instead of "how far am
// I from a genre-agnostic absolute target?".
//
// Honest limits, stated everywhere this surfaces: a profile is FULL-MIX STATICS — integrated
// loudness, spectral band shares, stereo width, crest — measured over the whole file. It does not
// hear arrangement, sections, or masking; matching a profile's numbers does not make two mixes
// sound alike, it only removes the gross static differences. Per-stem / per-section metrics are
// separate roadmap rows, not this.

import type { MixMetrics } from './analyze.js'

export class BeatProfileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatProfileError'
  }
}

export const PROFILE_FORMAT = 'dotbeat-mix-profile'
/** Bump when the profile shape changes incompatibly; parseProfile refuses newer versions. */
export const PROFILE_VERSION = 1

export interface MixProfile {
  format: typeof PROFILE_FORMAT
  version: number
  /** Provenance: the filename the profile was measured from (as given, no path resolution). */
  source: string
  /** Provenance: ISO-8601 timestamp of when the profile was written. */
  createdAt: string
  /** Provenance: which tool/version wrote it, e.g. "dotbeat beat metrics" — a format/tool field
   * so a future reader can tell profiles from different writers apart. */
  tool: string
  metrics: MixMetrics
}

export function buildProfile(metrics: MixMetrics, source: string, now: Date = new Date()): MixProfile {
  return {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    source,
    createdAt: now.toISOString(),
    tool: 'dotbeat beat metrics',
    metrics,
  }
}

// MixMetrics legitimately contains non-finite numbers (integratedLufs of silence is -Infinity;
// widthDb of a dual-mono file is -Infinity), and JSON.stringify would silently turn those into
// null. Round-trip them as the strings "Infinity"/"-Infinity"/"NaN" instead — lossless and
// human-readable in the saved file.
const NON_FINITE = new Set(['Infinity', '-Infinity', 'NaN'])

export function serializeProfile(profile: MixProfile): string {
  return (
    JSON.stringify(profile, (_key, value) => (typeof value === 'number' && !Number.isFinite(value) ? String(value) : value), 2) + '\n'
  )
}

function reviveNumbers(value: unknown): unknown {
  if (typeof value === 'string' && NON_FINITE.has(value)) return Number(value)
  if (Array.isArray(value)) return value.map(reviveNumbers)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = reviveNumbers(v)
    return out
  }
  return value
}

const isNum = (x: unknown): x is number => typeof x === 'number'

/** Parse + validate a saved profile. `label` names the file in error messages. */
export function parseProfile(text: string, label = 'profile'): MixProfile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BeatProfileError(`${label} is not valid JSON — write one with \`beat metrics <ref.wav> --save-profile <ref.json>\``)
  }
  const p = reviveNumbers(raw) as Partial<MixProfile> | null
  if (p === null || typeof p !== 'object' || p.format !== PROFILE_FORMAT) {
    throw new BeatProfileError(`${label} is not a dotbeat mix profile (expected "format": "${PROFILE_FORMAT}")`)
  }
  if (!isNum(p.version) || p.version > PROFILE_VERSION) {
    throw new BeatProfileError(`${label} has profile version ${String(p.version)} — this dotbeat reads up to version ${PROFILE_VERSION} (update dotbeat, or re-save the profile with this version)`)
  }
  const m = p.metrics as MixMetrics | undefined
  const bands = m?.spectral?.bandsPct
  if (
    !m ||
    !isNum(m.integratedLufs) ||
    !isNum(m.crestDb) ||
    !bands ||
    !isNum(bands.sub) ||
    !isNum(bands.bass) ||
    !isNum(bands.mids) ||
    !isNum(bands.presence) ||
    !isNum(bands.air) ||
    (m.stereo !== null && !isNum(m.stereo?.widthDb))
  ) {
    throw new BeatProfileError(`${label} is missing measured metrics (integratedLufs / crestDb / spectral band shares / stereo) — re-save it with \`beat metrics <ref.wav> --save-profile\``)
  }
  return p as MixProfile
}
