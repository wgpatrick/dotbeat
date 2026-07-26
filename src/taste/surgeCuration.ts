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

/** ROLE -> SURGE PATCH CATEGORIES, CORRECTED (research 141 §7.3; re-verified from the .fxp corpus
 * 2026-07-26). Lives HERE, not in showdown.ts, so the curation script and the showdown draw can
 * share one definition instead of two that drift.
 *
 * THE BUG: `showdown.ts`'s `SURGE_ROLE_CATEGORIES` maps `chords -> ['Pads','Keys']`. Measured over
 * the installed corpus (amp-EG attack of the SOUNDING scene, n = 3,559 .fxp):
 *
 *   category      n     median attack   % <= 12.5 ms
 *   Pads        419         537.8 ms          18%     <- what chords actually drew from
 *   Keys        315           4.8 ms          78%
 *   Chords       28           3.9 ms          89%     <- never eligible
 *   Polysynths  122           3.9 ms          75%     <- never eligible
 *   Sequences   121           3.9 ms          84%     <- never eligible (needed the tempo fix)
 *
 * and all 16 curated chords picks in the OLD presets/surge-curated.json came from `Pads` (zero from
 * Keys) — factory Pads alone median 829.5 ms, 4.6% within target. Against 131's measured chords
 * target of <= 12 ms attack that is the wrong shelf outright, so `Pads` is REMOVED from chords.
 *
 * Also folded in: the third-party pool's synonym vocabulary (`Bass` beside `Basses`, `Synths`
 * beside `Polysynths`, `Arps`/`Rhythms` beside `Sequences`), which only became reachable when the
 * sidecar started enumerating `patches_3rdparty`; and `Sequences`, which research 132 §2 gated
 * explicitly on the tempo fix (a synced arp rendered at the wrong tempo is worse than no arp).
 *
 * Matching semantics are showdown's `patchInCategories`: case-insensitive SUBSTRING, so 'Bass'
 * also catches 'Basses' and 'Sequence' also catches 'Sequences'. Both spellings are listed anyway
 * — substring matching is idempotent and the explicit list is what a reader can check. */
export const SURGE_ROLE_CATEGORIES_V2: Record<string, readonly string[] | null> = {
  bassline: ['Basses', 'Bass'],
  chords: ['Chords', 'Polysynths', 'Synths', 'Keys'],
  lead: ['Leads', 'Plucks', 'Sequences', 'Arps', 'Rhythms'],
  'drum-loop': null,
}

/** The corrected role -> categories, or null when surge is skipped for the role (drum-loop) or the
 * role is unknown. Same degrade-never-throw contract as showdown's `surgeRoleCategories`. */
export function surgeRoleCategoriesV2(role: string): readonly string[] | null {
  return role in SURGE_ROLE_CATEGORIES_V2 ? SURGE_ROLE_CATEGORIES_V2[role]! : null
}

/** Hard rejects applied BEFORE the composite (a ringy or near-silent render is out regardless of
 * how it scores elsewhere). ringDbMax mirrors the showdown ring screen; activeFractionMin mirrors
 * the ref audibility guard. */
export const CURATION_GATES = { ringDbMax: -32, activeFractionMin: 0.5 } as const

/** The aesthetics-weighted z-score blend (D26). Weights sum to 1.0. The two aesthetics-derived
 * terms — raw Audiobox quality (CE+PQ) and the aes⊕dsp ensemble critic — carry 0.75 of the weight;
 * the two cleanliness terms (ring headroom, active fraction) carry 0.25, rewarding a cleaner, more
 * present render among aesthetically-comparable patches. */
export const CURATION_BLEND = { aesQuality: 0.45, critic: 0.3, ringHeadroom: 0.15, active: 0.1 } as const

export type CurationBlend = typeof CURATION_BLEND
export type CurationGates = typeof CURATION_GATES

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
  opts: { gates?: CurationGates; blend?: CurationBlend; topFraction?: number } = {},
): CurateRoleResult {
  const gates = opts.gates ?? CURATION_GATES
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
