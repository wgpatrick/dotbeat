// Surge factory-patch curation (decisions.md D26): score, gate, and select the Surge XT factory
// pool PER ROLE so the showdown draws from a curated top quartile instead of blind from ~639
// patches. This module is the PURE math + the curated-file <-> pick glue — spawn-free and
// fs-light, so it unit-tests without surgepy. The render+score marathon that PRODUCES the curated
// file lives in scripts/curate-surge-patches.mjs; the loaded list threads into pickSurgePatch
// (src/taste/showdown.ts) and the CLI's showdownCmd, degrading cleanly to the full pool when the
// file is absent (CI-safe).
//
// The composite blend is documented and frozen HERE so the science is inspectable: a per-role
// z-score blend, aesthetics-weighted (D26's direction is "making engine/surge sound as good as
// commercial stems"), gated first on two hard audibility/cleanliness rejects.

import { existsSync, readFileSync } from 'node:fs'

/** The four per-render measurements the curation composes, plus the two gate inputs. */
export interface CurationRawScores {
  /** sidecar's worst narrow tonal peak (dB); a patch that RINGS (> -32) is rejected outright */
  ringDb: number
  /** fraction of ~100 ms windows above the audibility floor (showdown.activeFraction); a
   * mostly-silent probe render (< 0.5) is rejected */
  activeFraction: number
  /** Audiobox-Aesthetics content-enjoyment axis */
  ce: number
  /** Audiobox-Aesthetics content-usefulness axis */
  cu: number
  /** Audiobox-Aesthetics production-complexity axis */
  pc: number
  /** Audiobox-Aesthetics production-quality axis */
  pq: number
  /** ensemble-critic pessimistic score (mean − β·std) over the owner's rated dataset; higher =
   * more owner-preferred */
  criticPessimistic: number
}

/** One candidate patch with its rendered scores, as the script feeds curation. */
export interface CurationCandidate {
  name: string
  category: string
  /** path relative to patches_factory (stable across machines; the on-disk absolute path is not) */
  relPath: string
  scores: CurationRawScores
}

/** Hard rejects applied BEFORE the composite (a ringy or near-silent render is out regardless of
 * how it scores elsewhere). ringDbMax mirrors the showdown ring screen; activeFractionMin mirrors
 * the ref audibility guard.
 *
 * THIS IS A SCREEN, NOT A FROZEN EVAL CONSTANT. CLAUDE.md's frozen-constants guardrail governs
 * `engineplusProfile`/`surgeplusProfile`, whose values pin treatments measured in historical blind
 * ratings. These gates decide which candidates get built; changing them invalidates nothing already
 * rated. Research/140 §4.3 found the `===` pin in test/surge-curation.test.ts had made this *feel*
 * frozen, and named that as a large part of why the known-wrong value below sat for a week.
 *
 * KNOWN WRONG FOR MELODIC ROLES — prefer CURATION_GATES_BY_ROLE. `ringDbMax: -32` was calibrated
 * against the surgepy comb-artifact whine, and research 134 §2.2 measured what it does to the
 * owner's own reference material. Re-measured 2026-07-26 over the cleaned pack pools, reproducing
 * 134 to within half a point:
 *
 *   role       n   fail the -32 dB gate      (134 §2.2 reported)
 *   lead      55   12 (21.8%)                13 of 59 (22%)
 *   chords    45    7 (15.6%)                 8 of 49 (16%)
 *   drum-loop 27    4 (14.8%)                 not reported
 *   bassline  32    0 (0.0%)                  0 of 32 (0%)
 *
 * A fifth of the commercial lead loops the owner blind-ranks above everything dotbeat makes would
 * be rejected by dotbeat's own curation gate. Left at -32 here because this role-blind constant is
 * the fallback for callers that do not know their role, and silently loosening a safety screen for
 * an unknown role is the wrong default. Pass a role and get the measured gate instead. */
export const CURATION_GATES = { ringDbMax: -32, activeFractionMin: 0.5 } as const

/** The roles curation runs per — `curateRole`'s unit of work, and the granularity every per-role
 * measurement in research 131/133/134/138 is reported at. */
export type CurationRole = 'bassline' | 'chords' | 'lead' | 'drum-loop'

/**
 * Per-role hard-reject gates. Built by research 134 §5's own stated rule — *"calibrate the ring
 * gate against the owned refs per role: set each role's threshold so >=95% of that role's pack
 * loops pass (lead needs >> -32; bass can stay)"* — applied 2026-07-26 to the cleaned pools by
 * running `src/metrics/ring.ts`'s `ringDb` over every file in each role dir:
 *
 *   role       n   ringDb p50   p90     p95 (= the threshold)
 *   bassline  32     -120.00  -120.00  -117.80
 *   chords    45     -120.00   -22.38   -13.10
 *   drum-loop 27     -120.00   -20.66   -15.83
 *   lead      55     -120.00   -21.60   -16.08
 *
 * The rule is applied as `max(-32, p95)` — LOOSEN where the reference class demands it, never
 * tighten. Bassline's p95 is -117.80, which would reject a fifth of nothing while making the gate
 * far stricter than the artifact it was built to catch; 134 says explicitly "bass can stay", so it
 * keeps -32.
 *
 * `activeFractionMin` is unchanged at 0.5 across every role — 134 §5 item (5), "keep activeFraction
 * as-is", and it measured 0% rejection on the pools.
 *
 * HONEST CAVEAT, stated because it qualifies every number above: these thresholds are calibrated on
 * finished commercial LOOPS but applied to solo patch-PROBE renders. 134 §2.2 names that mismatch
 * itself as part of the diagnosis ("scale-mismatched across content"), and its fix item (2) — score
 * candidates through the same assembly the eval will rate, rather than the raw voice — is the real
 * repair and has not been built. Until it is, these gates are calibrated to stop rejecting the
 * quality bar, which is strictly better than the role-blind -32, not to be finally correct. */
export const CURATION_GATES_BY_ROLE: Record<CurationRole, CurationGates> = {
  bassline: { ringDbMax: -32, activeFractionMin: 0.5 },
  chords: { ringDbMax: -13.1, activeFractionMin: 0.5 },
  lead: { ringDbMax: -16.08, activeFractionMin: 0.5 },
  'drum-loop': { ringDbMax: -15.83, activeFractionMin: 0.5 },
}

/** The gates for a role, falling back to the role-blind CURATION_GATES when the role is unknown. */
export function gatesForRole(role?: CurationRole | null): CurationGates {
  return role ? CURATION_GATES_BY_ROLE[role] : CURATION_GATES
}

/** The aesthetics-weighted z-score blend (D26). Weights sum to 1.0. The two aesthetics-derived
 * terms — raw Audiobox quality (CE+PQ) and the aes⊕dsp ensemble critic — carry 0.75 of the weight;
 * the two cleanliness terms (ring headroom, active fraction) carry 0.25, rewarding a cleaner, more
 * present render among aesthetically-comparable patches. */
export const CURATION_BLEND = { aesQuality: 0.45, critic: 0.3, ringHeadroom: 0.15, active: 0.1 } as const

export type CurationBlend = typeof CURATION_BLEND
/** Widened from `typeof CURATION_GATES` 2026-07-26: the `as const` there made the type the LITERAL
 * -32, so the per-role table below could not express any other threshold. A gate type that only
 * admits the one value it was first written with is a type-level version of the same "feels frozen"
 * problem research/140 §4.3 describes. */
export interface CurationGates {
  ringDbMax: number
  activeFractionMin: number
}

/** True iff the render clears both hard gates. */
export function passesGates(s: CurationRawScores, gates: CurationGates = CURATION_GATES): boolean {
  return s.ringDb <= gates.ringDbMax && s.activeFraction >= gates.activeFractionMin
}

/** Population z-scores (mean 0, sd 1). A degenerate column (sd ≈ 0, e.g. one survivor) collapses
 * to all-zeros — honest: no within-population contrast to standardize. */
export function zScores(xs: number[]): number[] {
  const n = xs.length
  if (n === 0) return []
  const mean = xs.reduce((a, b) => a + b, 0) / n
  const varc = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n
  const sd = Math.sqrt(varc)
  if (sd < 1e-12) return xs.map(() => 0)
  return xs.map((x) => (x - mean) / sd)
}

/** The four raw terms the blend standardizes: aesthetic quality (CE+PQ), the critic's pessimistic
 * preference, ring HEADROOM (−ringDb, so a cleaner render scores higher), and active fraction. */
export interface CompositeRow {
  aesQuality: number
  critic: number
  ringHeadroom: number
  active: number
}

export function toCompositeRow(s: CurationRawScores): CompositeRow {
  return { aesQuality: s.ce + s.pq, critic: s.criticPessimistic, ringHeadroom: -s.ringDb, active: s.activeFraction }
}

/** The blended composite per row, z-scoring EACH term across the given rows first (so the blend is
 * a within-population comparison — the pool that reaches this function should be one role's
 * survivors). Returns composites in input order. */
export function compositeScores(rows: CompositeRow[], w: CurationBlend = CURATION_BLEND): number[] {
  const za = zScores(rows.map((r) => r.aesQuality))
  const zc = zScores(rows.map((r) => r.critic))
  const zr = zScores(rows.map((r) => r.ringHeadroom))
  const zt = zScores(rows.map((r) => r.active))
  return rows.map((_, i) => w.aesQuality * za[i]! + w.critic * zc[i]! + w.ringHeadroom * zr[i]! + w.active * zt[i]!)
}

export interface CuratedPatch extends CurationCandidate {
  composite: number
}

export interface CurateRoleResult {
  /** how many candidates cleared the gates */
  survivors: number
  /** the kept top-quartile survivors, deterministic order (composite desc, then name, then relPath) */
  kept: CuratedPatch[]
}

/** Select a role's kept patches: gate → composite over the SURVIVORS → top `topFraction` (default
 * quartile), in deterministic order. Always keeps at least one survivor when any clear the gates
 * (ceil), so a small role pool never curates to empty. */
export function curateRole(
  candidates: CurationCandidate[],
  // `role` selects the measured per-role gates (CURATION_GATES_BY_ROLE); explicit `gates` still
  // win, and omitting both keeps the role-blind CURATION_GATES for back-compat. Additive on
  // purpose — no existing caller changes behaviour, and a caller that knows its role (which is
  // every caller of a function named curateRole) opts into the calibrated screen by naming it.
  opts: { gates?: CurationGates; blend?: CurationBlend; topFraction?: number; role?: CurationRole } = {},
): CurateRoleResult {
  const gates = opts.gates ?? gatesForRole(opts.role)
  const topFraction = opts.topFraction ?? 0.25
  const survivors = candidates.filter((c) => passesGates(c.scores, gates))
  if (survivors.length === 0) return { survivors: 0, kept: [] }
  const comps = compositeScores(survivors.map((c) => toCompositeRow(c.scores)), opts.blend)
  const scored: CuratedPatch[] = survivors.map((c, i) => ({ ...c, composite: comps[i]! }))
  scored.sort((a, b) => b.composite - a.composite || a.name.localeCompare(b.name) || a.relPath.localeCompare(b.relPath))
  const keepN = Math.max(1, Math.ceil(scored.length * topFraction))
  return { survivors: survivors.length, kept: scored.slice(0, keepN) }
}

// ---- curated file <-> pick glue ----------------------------------------------------------------

export interface CuratedFileRole {
  /** patches in the role's category pool the curation considered */
  pool: number
  /** how many cleared the gates */
  survivors: number
  kept: CuratedPatch[]
}

export interface CuratedFile {
  version: number
  generatedAt: string
  /** human-readable per-role probe descriptions (what note-list each role was rendered on) */
  probe: Record<string, string>
  blend: CurationBlend
  gates: CurationGates
  roles: Record<string, CuratedFileRole>
}

/** Stable identity for a patch across machines: (category, name) lower-cased. The on-disk absolute
 * path differs per checkout; category + name (and relPath) do not. */
export function curatedKey(category: string, name: string): string {
  return `${category.toLowerCase()}\x00${name.toLowerCase()}`
}

/** Read a curated file, or null when it is absent/unreadable/malformed — pickSurgePatch then falls
 * back to the full pool (the CI-safe path: no curated file committed, blind draw as today). */
export function loadCuratedFile(path: string): CuratedFile | null {
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as CuratedFile
    if (!parsed || typeof parsed !== 'object' || typeof parsed.roles !== 'object' || parsed.roles === null) return null
    return parsed
  } catch {
    return null
  }
}

/** The role's curated patch keys as a Set, or null when the role has no curated entries (then the
 * pick uses the full role pool). */
export function curatedKeysForRole(file: CuratedFile | null, role: string): ReadonlySet<string> | null {
  if (!file) return null
  const r = file.roles?.[role]
  if (!r || !Array.isArray(r.kept) || r.kept.length === 0) return null
  return new Set(r.kept.map((p) => curatedKey(p.category, p.name)))
}
