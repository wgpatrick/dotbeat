// The constrained T5 overnight pilot — plan item C3, the owner's "circular process" (make
// variations → critic scores them → the best breed the next round), deliberately SMALL. This is
// the pilot research/117 §Part-4 specifies, NOT full T5: best-of-n-per-niche instead of deep
// ascent, a handful of QD generations, ensemble pessimism REQUIRED, control items in every morning
// frontier, and the gen subspace fenced OUT (search only the synth-param VARY space, where the
// critic has measured signal — 117: it is 0% top-1 / highest-std on gen).
//
// Companions: docs/pilot.md (the design writeup), docs/research/117-critic-guided-search-in-
// practice.md (the verdict section IS this file's spec), docs/taste-loop-design.md L4/T5 + C2
// (criticWithUncertainty, the pessimistic scorer this loop consumes). The loop reuses the
// prodtask/showdown render+assembly conventions wholesale (writeVaryBatch/renderVaryBatch offline,
// seeded shuffle, loudness normalization, clip-set batches, the tally scoreboard).
//
// This module is the PURE half: genome representation, seeded mutation over the VARY space, the
// handcrafted niche descriptors, the #1-hack-vector width fence, best-per-niche elite selection,
// ε-immigrants, controls (never critic-scored), the run journal, blind batch assembly, and the
// elite-vs-control report. Rendering and the real aes/critic calls live in the CLI (cli/beat.mjs
// pilotCmd), so everything here runs on synthetic features in tests — same posture as
// src/taste/prodtask.ts. The loop takes its slow steps (render+feature-extract) and its scorer as
// INJECTED callbacks, so a fake scorer drives the determinism/niche/control tests offline.

import { resolve } from 'node:path'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import { setValue, type BeatDocument } from '../core/index.js'
import { type FeatureVector, type FeatureKey } from './features.js'
import { varyTrack, legalGroupsForKind, makeRng, BeatVaryError } from '../vary/vary.js'
import { BeatBatchError, type VaryBatchManifest } from '../vary/batch.js'
import { SPLIT_SMOKE_MIN_BATCHES } from './eval.js'
import { tally, statLine, pct, type SourceStat, type RankedArmEntry } from './showdown.js'

// ---- roles (the seed-track mapping, shared with prodtask/showdown) -----------------------------

export interface PilotRoleSpec {
  role: string
  /** the taste-seed track that carries this role (matches generateSeedBeat ids) */
  seedTrack: string
  kind: 'synth' | 'drums'
}

/** The pilot roles — the same seed-track mapping prodtask/showdown use, so a pilot run draws seeds
 * and mutates figures with the exact machinery the rest of the taste loop already validates. */
export const PILOT_ROLES: PilotRoleSpec[] = [
  { role: 'bassline', seedTrack: 'bass', kind: 'synth' },
  { role: 'chords', seedTrack: 'chords', kind: 'synth' },
  { role: 'lead', seedTrack: 'arp', kind: 'synth' },
  { role: 'drum-loop', seedTrack: 'drums', kind: 'drums' },
]

/** Default roles for a run — two synth roles keep each per-role archive fed under a small total
 * render budget (the whole point of the pilot: keep the leash short). More via --roles. */
export const DEFAULT_PILOT_ROLES = ['bassline', 'chords']

export function pilotRole(role: string): PilotRoleSpec {
  const spec = PILOT_ROLES.find((r) => r.role === role)
  if (!spec) throw new BeatBatchError(`unknown pilot role "${role}" (have: ${PILOT_ROLES.map((r) => r.role).join(', ')})`)
  return spec
}

/** Default pessimism strength (docs/research/117 §Part-4: ensemble mean − β·std, β=1 the C2
 * ablation value) — informational here; the injected `score` closure bakes β in. */
export const PILOT_BETA = 1

/** Default ε — the fraction of each generation that is pure-random immigrants (forced exploration,
 * docs/taste-loop-design.md L4 step 1; research/117 rates it "helpful, secondary"). */
export const PILOT_EPSILON = 0.2

// ---- the stereo-width fence (the #1 measured hack vector) --------------------------------------

/** The sentinel every candidate's stereoWidthDb is overwritten with before scoring. Its VALUE is
 * irrelevant (any constant works) — what matters is that it is CONSTANT across the scored
 * population. See fenceWidth. */
export const WIDTH_FENCE_VALUE = -30

/** The single feature the width fence neutralizes. */
export const WIDTH_FENCE_KEY: FeatureKey = 'stereoWidthDb'

/** Neutralize the #1 measured hack vector before the critic scores a search candidate
 * (docs/research/117 §verdict / §Part-4): dotbeat's feature-mining found **stereo width correlates
 * 1.00 with preference rank**, so an unconstrained optimizer learns "wider always wins" long before
 * it learns taste. Batch loudness normalization already fences the "louder wins" confound; this is
 * its stereo-width twin.
 *
 * The mechanism: the critic z-scores each feature WITHIN the scored population (ranker.ts
 * standardizeBatch), so overwriting stereoWidthDb with a CONSTANT makes that column's within-
 * population variance zero → every candidate z-scores to 0 on it → the critic's learned width
 * weight contributes exactly nothing to any candidate's score. The fence therefore removes width as
 * a STEERING axis for the search without touching the critic's honest width weight learned from the
 * owner's real ratings (training is never fenced — only search candidates are). NOTE (honest
 * scope): this fences stereoWidthDb, the axis 117 names; stereoCorrelation is a related channel left
 * in for v1 (mono engine renders sit at correlation≈1 regardless, so it carries little within-batch
 * variance to exploit yet — revisit if a width move ever makes it a live gradient). */
export function fenceWidth(dsp: FeatureVector): FeatureVector {
  return { ...dsp, [WIDTH_FENCE_KEY]: WIDTH_FENCE_VALUE }
}

// ---- niche descriptors (v1: handcrafted brightness × density buckets) --------------------------
//
// research/117 + taste-loop-design.md L4 both call for HANDCRAFTED, human-legible descriptors first
// ("the bright sparse corner vs the dark busy corner"), learned-embedding descriptors later. v1 is
// two DSP axes read straight off the feature vector, HONESTLY coarse:
//   brightness = centroidLog2   (spectral centroid, log2 Hz — the feature's own brightness axis)
//   density    = −crestDb        (crest factor inverted: a busy/sustained/compressed texture has a
//                                 LOW crest factor, a sparse/transient one a HIGH crest — a coarse
//                                 proxy for "onset density"/busyness, NOT true onset detection,
//                                 which the DSP feature vector does not carry. Named as a proxy so
//                                 nobody reads it as a real onset count.)
// The grid EDGES are quantiles frozen from the INITIAL (generation-0) population, so the archive's
// descriptor space is fixed for the whole run (a MAP-Elites archive needs stable niche boundaries —
// re-quantiling every generation would let a niche's meaning drift out from under its incumbent).

export interface NicheGrid {
  brightBins: number
  densityBins: number
  /** internal bucket boundaries on centroidLog2 (length brightBins−1) */
  brightEdges: number[]
  /** internal bucket boundaries on −crestDb (length densityBins−1) */
  densityEdges: number[]
}

const brightnessOf = (dsp: FeatureVector) => dsp.centroidLog2
const densityOf = (dsp: FeatureVector) => -dsp.crestDb

/** Factor a niche count into (densityBins × brightBins), preferring a near-square grid: 4→2×2,
 * 6→2×3, 8→2×4, 9→3×3; a prime count falls back to a single density row (n bright bins). */
export function factorNiches(nicheCount: number): { brightBins: number; densityBins: number } {
  if (nicheCount < 1) throw new BeatBatchError(`niche count must be >= 1, got ${nicheCount}`)
  let densityBins = 1
  for (let d = Math.floor(Math.sqrt(nicheCount)); d >= 1; d--) {
    if (nicheCount % d === 0) {
      densityBins = d
      break
    }
  }
  return { densityBins, brightBins: nicheCount / densityBins }
}

/** Internal quantile boundaries splitting `values` into `bins` roughly-equal buckets (length
 * bins−1). Deterministic; a degenerate all-equal column yields edges that put everything in bucket
 * 0 (honest: no variation to niche on). */
function quantileEdges(values: number[], bins: number): number[] {
  if (bins <= 1 || values.length === 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  const edges: number[] = []
  for (let i = 1; i < bins; i++) edges.push(sorted[Math.min(sorted.length - 1, Math.floor((i / bins) * sorted.length))]!)
  return edges
}

// Quantile buckets are half-open [edge, nextEdge): a value AT an edge belongs to the UPPER bucket,
// so a population with ties on a boundary still splits (values >= edge go up) instead of piling into
// the lower bucket.
const bucketOf = (value: number, edges: number[]) => {
  let b = 0
  for (const e of edges) if (value >= e) b++
  return b
}

/** Freeze a niche grid from the initial population's feature vectors. */
export function buildNicheGrid(population: FeatureVector[], nicheCount: number): NicheGrid {
  const { brightBins, densityBins } = factorNiches(nicheCount)
  return {
    brightBins,
    densityBins,
    brightEdges: quantileEdges(population.map(brightnessOf), brightBins),
    densityEdges: quantileEdges(population.map(densityOf), densityBins),
  }
}

/** The niche index (0 .. brightBins·densityBins−1) a candidate falls in — density row × brightness
 * column, human-legible: niche 0 is the dark-sparse corner, the last is bright-busy. */
export function nicheOf(grid: NicheGrid, dsp: FeatureVector): number {
  const bright = bucketOf(brightnessOf(dsp), grid.brightEdges)
  const density = bucketOf(densityOf(dsp), grid.densityEdges)
  return density * grid.brightBins + bright
}

/** Human-legible niche label ("dark·sparse", "bright·busy", or coordinate form for finer grids). */
export function nicheLabel(grid: NicheGrid, niche: number): string {
  const bright = niche % grid.brightBins
  const density = Math.floor(niche / grid.brightBins)
  const b = grid.brightBins === 2 ? (bright === 0 ? 'dark' : 'bright') : `b${bright}`
  const d = grid.densityBins === 2 ? (density === 0 ? 'sparse' : 'busy') : `d${density}`
  return `${d}·${b}`
}

// ---- genomes -----------------------------------------------------------------------------------

export type GenomeOrigin = 'seed' | 'elite' | 'immigrant' | 'control'

/** One individual: a concrete .beat document derived from a seed song by mutating ONE role track's
 * synth params. `edits` is the full replayable lineage from the seed (a chain of `beat set`
 * recipes — the provenance-for-free the design promises), so every discovered sound is diffable and
 * reproducible. */
export interface PilotGenome {
  id: string
  role: string
  seedFile: string
  trackId: string
  doc: BeatDocument
  /** "path value" edits from the seed to this genome, in order (replayable via `beat set`) */
  edits: string[]
  /** cumulative edits.length after each MUTATION STEP — the checkpoint cut points for
   * trajectory audits (owner, 2026-07-22: "add intermediate checkpoints and see if the last
   * one is my preference"). editSteps[k]-1 is the last edit index of step k. */
  editSteps: number[]
  origin: GenomeOrigin
  /** id of the elite this was mutated from (elite offspring and controls); absent for seed/immigrant */
  parentId?: string
}

/** Features + critic scores attached to a genome after render/feature-extract/score. */
export interface Evaluated {
  dsp: FeatureVector
  /** the four Audiobox-Aesthetics axes [CE, CU, PC, PQ] */
  aes: number[]
}

export interface PopScore {
  mean: number
  std: number
  pessimistic: number
}

/** An archive incumbent: the best-scoring genome in its niche so far, with its cached features. */
export interface Elite {
  genome: PilotGenome
  dsp: FeatureVector
  aes: number[]
  niche: number
  score: PopScore
}

// ---- mutation over the VARY space --------------------------------------------------------------

/** The synth-param vary groups legal (audible) for a role's track kind — the search subspace. The
 * gen subspace is fenced OUT by construction: this loop only ever mutates synth params of a
 * hand-authored seed track, never a generated sample (research/117: the critic is blind on gen). */
function legalGroups(spec: PilotRoleSpec): string[] {
  return legalGroupsForKind(spec.kind)
}

/** One seeded mutation step of a document's role track: try the legal groups in a seeded order
 * until one produces a distinct variant (varyTrack can no-op on a group whose params round back to
 * where they were). Returns the mutated doc + the new edits, or null if every group no-ops (rare —
 * the caller skips that genome). `spread` = exploration (range-spanning immigrants); else a gentle
 * `amount` neighborhood step (elite refinement). */
function mutateOnce(
  doc: BeatDocument,
  spec: PilotRoleSpec,
  rng: () => number,
  opts: { spread?: boolean; amount?: number },
): { doc: BeatDocument; edits: string[] } | null {
  const groups = legalGroups(spec)
  // seeded group order — try each once
  const order = groups.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  for (const gi of order) {
    const group = groups[gi]!
    try {
      const variants = varyTrack(doc, spec.seedTrack, group, {
        count: 1,
        seed: Math.floor(rng() * 1_000_000) + 1,
        ...(opts.spread ? { spread: true } : { amount: opts.amount ?? 0.3 }),
      })
      const v = variants[0]!
      return { doc: v.doc, edits: v.edits.map((e) => `${e.path} ${e.value}`) }
    } catch (err) {
      // BeatVaryError = an illegal/no-op group for this track — try the next one.
      if (err instanceof BeatVaryError) continue
      throw err
    }
  }
  return null
}

/** Generation-0 population: `count` range-spanning variants distributed across the role's seeds and
 * legal groups, so the initial archive samples the descriptor space broadly (spread mode — the
 * design's "maximal audible distinctness" for cold-start diversity). */
export function makeInitialPopulation(
  roleSeeds: { file: string; doc: BeatDocument }[],
  spec: PilotRoleSpec,
  count: number,
  rng: () => number,
  nextId: () => string,
): PilotGenome[] {
  const out: PilotGenome[] = []
  let guard = 0
  while (out.length < count && guard < count * 8) {
    guard++
    const seed = roleSeeds[out.length % roleSeeds.length]!
    const m = mutateOnce(seed.doc, spec, rng, { spread: true })
    if (!m) continue
    out.push({ id: nextId(), role: spec.role, seedFile: seed.file, trackId: spec.seedTrack, doc: m.doc, edits: m.edits, editSteps: [m.edits.length], origin: 'seed' })
  }
  return out
}

/** One generation's offspring: (1−ε) neighborhood mutations of the archive elites (round-robin
 * across niches, so the whole frontier breeds — QD, not hill-climbing) + ε pure-random immigrants
 * from fresh seeds. `count` bounded by the caller against the render budget. */
export function makeOffspring(
  archive: Elite[],
  roleSeeds: { file: string; doc: BeatDocument }[],
  spec: PilotRoleSpec,
  count: number,
  epsilon: number,
  amount: number,
  rng: () => number,
  nextId: () => string,
): PilotGenome[] {
  const nImmigrants = Math.round(epsilon * count)
  const nElite = count - nImmigrants
  const out: PilotGenome[] = []
  const elites = [...archive].sort((a, b) => b.score.pessimistic - a.score.pessimistic)

  let guard = 0
  let ei = 0
  while (out.length < nElite && elites.length > 0 && guard < count * 8) {
    guard++
    const elite = elites[ei % elites.length]!
    ei++
    const m = mutateOnce(elite.genome.doc, spec, rng, { amount })
    if (!m) continue
    out.push({
      id: nextId(),
      role: spec.role,
      seedFile: elite.genome.seedFile,
      trackId: spec.seedTrack,
      doc: m.doc,
      edits: [...elite.genome.edits, ...m.edits],
      editSteps: [...elite.genome.editSteps, elite.genome.edits.length + m.edits.length],
      origin: 'elite',
      parentId: elite.genome.id,
    })
  }
  // immigrants — and if there were no elites yet (shouldn't happen post gen-0), the whole
  // generation is immigrants so the loop never stalls
  const wantImmigrants = count - out.length
  guard = 0
  while (out.length < count && guard < wantImmigrants * 8 + 8) {
    guard++
    const seed = roleSeeds[Math.floor(rng() * roleSeeds.length)]!
    const m = mutateOnce(seed.doc, spec, rng, { spread: true })
    if (!m) continue
    out.push({ id: nextId(), role: spec.role, seedFile: seed.file, trackId: spec.seedTrack, doc: m.doc, edits: m.edits, editSteps: [m.edits.length], origin: 'immigrant' })
  }
  return out
}

/** The controls (research/117 §Part-4, the SCALING GATE's null hypothesis): random-mutation, NO-
 * CRITIC descendants of the same elites the frontier ships. Each control takes a final elite and
 * applies ONE pure-random mutation (never scored, never selected) — "the same starting point, one
 * random move instead of a critic-guided move." If critic-guided elites don't beat these in the
 * owner's blind ratings, the critic isn't yet adding value over mutation + diversity alone. */
/** Rebuild the genome's state after its first `steps` mutation steps by replaying the edit
 * prefix onto the seed doc — the trajectory-audit reconstruction (owner, 2026-07-22). Edits are
 * the same canonical "path value" pairs `beat set` applies, so replay goes through core setValue
 * and is exact by construction (the vary test suite asserts replayability). steps=0 returns the
 * seed doc itself (the "origin" arm). */
export function reconstructCheckpoint(seedDoc: BeatDocument, genome: PilotGenome, steps: number): BeatDocument {
  if (steps <= 0) return seedDoc
  const upto = genome.editSteps[Math.min(steps, genome.editSteps.length) - 1] ?? genome.edits.length
  let doc = seedDoc
  for (const e of genome.edits.slice(0, upto)) {
    const sp = e.indexOf(' ')
    doc = setValue(doc, e.slice(0, sp), e.slice(sp + 1))
  }
  return doc
}

/** The checkpoint cut plan for a trajectory batch: origin (0), ~1/3, ~2/3 of the elite's
 * mutation depth — deduplicated, strictly between 0 and the final step. An elite with <3 steps
 * yields fewer cuts (honest: shallow lineages have no meaningful trajectory to audit). */
export function checkpointSteps(totalSteps: number): number[] {
  if (totalSteps < 3) return totalSteps === 2 ? [1] : []
  const cuts = [Math.max(1, Math.floor(totalSteps / 3)), Math.min(totalSteps - 1, Math.floor((2 * totalSteps) / 3))]
  return [...new Set(cuts)].sort((a, b) => a - b)
}

export function makeControls(
  archive: Elite[],
  spec: PilotRoleSpec,
  count: number,
  rng: () => number,
  nextId: () => string,
): PilotGenome[] {
  const elites = [...archive].sort((a, b) => b.score.pessimistic - a.score.pessimistic)
  const out: PilotGenome[] = []
  let guard = 0
  let i = 0
  while (out.length < count && elites.length > 0 && guard < count * 8) {
    guard++
    const elite = elites[i % elites.length]!
    i++
    const m = mutateOnce(elite.genome.doc, spec, rng, { spread: true })
    if (!m) continue
    out.push({
      id: nextId(),
      role: spec.role,
      seedFile: elite.genome.seedFile,
      trackId: spec.seedTrack,
      doc: m.doc,
      edits: [...elite.genome.edits, ...m.edits],
      editSteps: [...elite.genome.editSteps, elite.genome.edits.length + m.edits.length],
      origin: 'control',
      parentId: elite.genome.id,
    })
  }
  return out
}

// ---- the journal -------------------------------------------------------------------------------

export interface GenerationRecord {
  role: string
  generation: number
  /** genomes evaluated (rendered + scored) THIS generation */
  populationSize: number
  /** renders spent this generation, and cumulative over the run */
  rendersThisGen: number
  rendersSpent: number
  /** niches filled in the archive after this generation, out of the grid total */
  nicheOccupancy: number
  nicheTotal: number
  /** mean/std over this generation's evaluated candidates */
  meanPessimistic: number
  meanEnsembleStd: number
  /** archive aggregates after the rebuild (the frontier's health) */
  archiveBestPessimistic: number
  archiveMeanPessimistic: number
  /** per-candidate rows for this generation (the honest population dump) */
  individuals: {
    id: string
    origin: GenomeOrigin
    niche: number
    nicheLabel: string
    mean: number
    std: number
    pessimistic: number
  }[]
}

export interface PilotRoleResult {
  role: string
  spec: PilotRoleSpec
  grid: NicheGrid
  /** final elites, best per niche (the morning frontier's critic-guided half) */
  archive: Elite[]
  /** the never-scored controls */
  controls: PilotGenome[]
  journal: GenerationRecord[]
  rendersSpent: number
  seedCount: number
}

// ---- the loop ----------------------------------------------------------------------------------

export interface RunPilotRoleOptions {
  role: string
  seeds: { file: string; doc: BeatDocument }[]
  budget: number
  generations: number
  niches: number
  controls?: number
  epsilon?: number
  amount?: number
  seed: number
  /** INJECTED slow step: render `genomes` offline + feature-extract (dsp + aes), keyed by genome id.
   * The real impl (cli/beat.mjs) reuses renderVaryBatch (one boot per generation) + the aes
   * sidecar; tests pass a deterministic synthetic-feature fake. */
  evaluate: (genomes: PilotGenome[]) => Promise<Map<string, Evaluated>>
  /** INJECTED critic: score a whole population at once, mean/std/pessimistic per candidate, in
   * input order. The loop applies the width fence to each candidate's dsp BEFORE calling this, so
   * the injected closure sees ALREADY-FENCED features (real impl = criticWithUncertainty's
   * scorePopulation; tests inspect the fenced width here). */
  score: (candidates: Evaluated[]) => PopScore[]
}

/** Run the constrained QD loop for ONE role. Deterministic in `seed` given deterministic injected
 * callbacks. Budget-bounded: renders never exceed `budget` across the whole run (gen-0 population +
 * every generation's offspring). Controls are generated AFTER the loop from the final archive and
 * are NEVER passed to `score`. */
export async function runPilotRole(opts: RunPilotRoleOptions): Promise<PilotRoleResult> {
  const spec = pilotRole(opts.role)
  const roleSeeds = opts.seeds.filter((s) => s.doc.tracks.some((t) => t.id === spec.seedTrack))
  if (roleSeeds.length === 0) {
    throw new BeatBatchError(`no seed song has a "${spec.seedTrack}" track for role ${opts.role} — generate more seeds (beat taste-seeds)`)
  }
  const epsilon = opts.epsilon ?? PILOT_EPSILON
  const amount = opts.amount ?? 0.3
  const controlCount = Math.max(2, Math.min(4, opts.controls ?? 3))
  const rng = makeRng(opts.seed)
  let counter = 0
  const nextId = () => `${opts.role}-g${genLabel}-${counter++}`
  let genLabel = 0

  // per-generation render allowance — best-of-n-per-niche cadence, not deep ascent (117 §Part-4)
  const perGen = Math.max(opts.niches, Math.floor(opts.budget / (opts.generations + 1)))
  let rendersSpent = 0
  const remaining = () => opts.budget - rendersSpent

  const journal: GenerationRecord[] = []
  let archive = new Map<number, Elite>()
  let grid: NicheGrid | null = null

  // Score a set of candidates TOGETHER with the current archive incumbents (re-scored in the same
  // population so cross-generation comparisons are honest — the critic z-scores within-population,
  // so incumbents and challengers must share one scoring context). Re-scoring incumbents costs no
  // renders (their features are cached). Returns the freshly-scored challengers only, plus a rebuilt
  // archive.
  const scoreAndSelect = (
    challengers: { genome: PilotGenome; ev: Evaluated }[],
    incumbents: Elite[],
  ): { scoredChallengers: (Elite & { origin: GenomeOrigin })[]; nextArchive: Map<number, Elite> } => {
    const combined = [
      ...challengers.map((c) => ({ genome: c.genome, dsp: c.ev.dsp, aes: c.ev.aes })),
      ...incumbents.map((e) => ({ genome: e.genome, dsp: e.dsp, aes: e.aes })),
    ]
    // THE FENCE — apply before scoring, always (research/117 §Part-4 "neutralize the visible hacks
    // up front"). The injected `score` only ever sees width-fenced features.
    const scores = opts.score(combined.map((c) => ({ dsp: fenceWidth(c.dsp), aes: c.aes })))
    const scored: Elite[] = combined.map((c, i) => ({
      genome: c.genome,
      dsp: c.dsp,
      aes: c.aes,
      niche: nicheOf(grid!, c.dsp),
      score: scores[i]!,
    }))
    const nextArchive = new Map<number, Elite>()
    for (const s of scored) {
      const cur = nextArchive.get(s.niche)
      if (!cur || s.score.pessimistic > cur.score.pessimistic) nextArchive.set(s.niche, s)
    }
    const scoredChallengers = scored.slice(0, challengers.length).map((s) => ({ ...s, origin: s.genome.origin }))
    return { scoredChallengers, nextArchive }
  }

  const recordGeneration = (
    generation: number,
    scoredChallengers: (Elite & { origin: GenomeOrigin })[],
    rendersThisGen: number,
    nextArchive: Map<number, Elite>,
  ) => {
    const pess = scoredChallengers.map((s) => s.score.pessimistic)
    const std = scoredChallengers.map((s) => s.score.std)
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
    const archiveScores = [...nextArchive.values()].map((e) => e.score.pessimistic)
    journal.push({
      role: opts.role,
      generation,
      populationSize: scoredChallengers.length,
      rendersThisGen,
      rendersSpent,
      nicheOccupancy: nextArchive.size,
      nicheTotal: grid!.brightBins * grid!.densityBins,
      meanPessimistic: round4(mean(pess)),
      meanEnsembleStd: round4(mean(std)),
      archiveBestPessimistic: round4(archiveScores.length ? Math.max(...archiveScores) : 0),
      archiveMeanPessimistic: round4(mean(archiveScores)),
      individuals: scoredChallengers.map((s) => ({
        id: s.genome.id,
        origin: s.origin,
        niche: s.niche,
        nicheLabel: nicheLabel(grid!, s.niche),
        mean: round4(s.score.mean),
        std: round4(s.score.std),
        pessimistic: round4(s.score.pessimistic),
      })),
    })
  }

  // ---- generation 0: initial population -------------------------------------------------------
  genLabel = 0
  const initCount = Math.max(1, Math.min(perGen, remaining()))
  const initGenomes = makeInitialPopulation(roleSeeds, spec, initCount, rng, nextId)
  const initEval = await opts.evaluate(initGenomes)
  const initEvaluated = initGenomes.filter((g) => initEval.has(g.id))
  rendersSpent += initEvaluated.length
  grid = buildNicheGrid(initEvaluated.map((g) => initEval.get(g.id)!.dsp), opts.niches)
  {
    const challengers = initEvaluated.map((g) => ({ genome: g, ev: initEval.get(g.id)! }))
    const { scoredChallengers, nextArchive } = scoreAndSelect(challengers, [])
    archive = nextArchive
    recordGeneration(0, scoredChallengers, initEvaluated.length, archive)
  }

  // ---- generations 1..G -----------------------------------------------------------------------
  for (let g = 1; g <= opts.generations; g++) {
    if (remaining() <= 0) break
    genLabel = g
    const count = Math.min(perGen, remaining())
    const offspring = makeOffspring([...archive.values()], roleSeeds, spec, count, epsilon, amount, rng, nextId)
    const ev = await opts.evaluate(offspring)
    const evaluated = offspring.filter((o) => ev.has(o.id))
    rendersSpent += evaluated.length
    const challengers = evaluated.map((o) => ({ genome: o, ev: ev.get(o.id)! }))
    const { scoredChallengers, nextArchive } = scoreAndSelect(challengers, [...archive.values()])
    archive = nextArchive
    recordGeneration(g, scoredChallengers, evaluated.length, archive)
  }

  // ---- controls (post-loop, never scored) -----------------------------------------------------
  genLabel = opts.generations + 1
  const controls = makeControls([...archive.values()], spec, controlCount, rng, nextId)

  return {
    role: opts.role,
    spec,
    grid,
    archive: [...archive.values()].sort((a, b) => b.score.pessimistic - a.score.pessimistic),
    controls,
    journal,
    rendersSpent,
    seedCount: roleSeeds.length,
  }
}

const round4 = (x: number) => Math.round(x * 10000) / 10000

// ---- morning frontier assembly (the showdown/prodtask clip-set conventions, reused) ------------

export type PilotArm = 'elite' | 'control'

export interface PilotClipSource {
  kind: PilotArm
  /** human-readable, batch-local provenance (niche + lineage for elites; ancestor for controls) */
  from: string
}

/** Write the morning-frontier batch manifest over v1..vN.wav already in `outDir`: the clip-set
 * shape (empty parent — score works, adopt refuses) with group `pilot:<role>` and per-variant
 * `source` records carrying the arm kind (elite vs control) PLUS the batch-local provenance,
 * honestly. scoreBatch copies the KIND only into the shared log (elite/control) — lineage stays in
 * the batch dir, like a ref clip's path. Every clip is an ordinary engine render of a mutated seed
 * (no ref/gen/private audio), so the batch is safe to commit — no gitignore gate. */
export function writePilotBatch(
  outDir: string,
  role: string,
  clips: { file: string; source: PilotClipSource }[],
  opts: { seed?: number } = {},
): VaryBatchManifest {
  if (clips.length < 2) throw new BeatBatchError('a pilot frontier batch needs at least two clips (elites + controls)')
  for (const c of clips) {
    if (!existsSync(resolve(outDir, c.file))) throw new BeatBatchError(`pilot batch is missing ${resolve(outDir, c.file)}`)
  }
  const manifest: VaryBatchManifest = {
    parent: '',
    parentSha256: '',
    group: `pilot:${role}`,
    count: clips.length,
    seed: opts.seed ?? 71,
    createdAt: new Date().toISOString(),
    variants: clips.map((c) => ({
      file: c.file,
      source: { kind: c.source.kind, from: c.source.from } as VaryBatchManifest['variants'][number]['source'],
    })),
  }
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

// ---- the run journal (JSONL) -------------------------------------------------------------------

/** Write the per-generation journal (one JSON object per generation, across all roles) to a JSONL
 * file. Consumed by the morning summary and auditable after the fact. */
export function writePilotJournal(path: string, results: PilotRoleResult[]): void {
  const lines: string[] = []
  for (const r of results) for (const rec of r.journal) lines.push(JSON.stringify(rec))
  writeFileSync(path, lines.join('\n') + (lines.length ? '\n' : ''))
}

// ---- the morning summary (trajectory + Goodhart tripwire) --------------------------------------

/** Did pessimistic score climb while ensemble std ALSO climbed sharply? That is the Goodhart alarm:
 * the frontier is "improving" by marching into a region the ensemble disagrees on (research/117:
 * "a monotone climb ... with flat morning ratings is the Goodhart alarm going off"). Returns a note
 * when tripped, else null. Compares the last generation to the first. */
export function goodhartTripwire(journal: GenerationRecord[]): string | null {
  if (journal.length < 2) return null
  const first = journal[0]!
  const last = journal[journal.length - 1]!
  const pessRose = last.archiveBestPessimistic > first.archiveBestPessimistic + 1e-6
  // "exploded" = ensemble std grew by more than half again over the run
  const stdBase = Math.abs(first.meanEnsembleStd)
  const stdExploded = stdBase > 1e-9 && last.meanEnsembleStd > first.meanEnsembleStd * 1.5
  if (pessRose && stdExploded) {
    return (
      `GOODHART TRIPWIRE: pessimistic score climbed (${first.archiveBestPessimistic} → ${last.archiveBestPessimistic}) ` +
      `WHILE ensemble std climbed ${first.meanEnsembleStd} → ${last.meanEnsembleStd} (>1.5×). The frontier may be ` +
      `improving by marching into disagreement, not taste — weight the blind morning ratings accordingly.`
    )
  }
  return null
}

/** The human-facing run summary: per-role critic-score trajectory, niche occupancy, renders spent,
 * the Goodhart tripwire note, and — always — the SCALING GATE. */
export function formatPilotRunSummary(results: PilotRoleResult[], opts: { batchesLanded: number; journalPath: string; beta: number }): string {
  let out = `\n=== pilot run summary ===\n`
  for (const r of results) {
    const traj = r.journal.map((j) => j.archiveBestPessimistic).join(' → ')
    const occ = r.journal.length ? r.journal[r.journal.length - 1]! : undefined
    out += `\n${r.role} (${r.seedCount} seed${r.seedCount === 1 ? '' : 's'}, ${r.rendersSpent} renders, β=${opts.beta}):\n`
    out += `  archive-best pessimistic trajectory: ${traj || '(no generations)'}\n`
    if (occ) out += `  niche occupancy: ${occ.nicheOccupancy}/${occ.nicheTotal}  |  mean ensemble std: ${r.journal.map((j) => j.meanEnsembleStd).join(' → ')}\n`
    out += `  frontier: ${r.archive.length} elite${r.archive.length === 1 ? '' : 's'} + ${r.controls.length} control${r.controls.length === 1 ? '' : 's'}\n`
    const trip = goodhartTripwire(r.journal)
    if (trip) out += `  ${trip}\n`
  }
  out += `\njournal: ${opts.journalPath}\n`
  out += `${opts.batchesLanded} frontier+control batch(es) landed in the rating queue — rate them blind: beat rate <dir>\n`
  out += `\nSCALING GATE (research/117 §Part-4): the critic-guided ELITES must beat the random-mutation CONTROLS in the\n`
  out += `owner's blind ratings before any scale-up. If controls tie or win, the critic is not yet adding value over\n`
  out += `mutation + diversity alone — keep the budget small, keep collecting labels. Check with: beat pilot --report <dir>\n`
  return out
}

// ---- the elite-vs-control report (`beat pilot --report`) ---------------------------------------
//
// The prodtask/showdown scoreboard, reused verbatim (tally + statLine): per-arm win / top-half /
// pairwise over every scored `pilot:<role>` batch, overall and per role, with the SCALING GATE
// verdict. The only axis that differs is the kind (elite vs control instead of source/arm).

export interface PilotLogEntry {
  role: string
  batch: string
  picks: string[]
  rejected: string[]
  /** variant file → arm kind (elite | control) */
  sources: Record<string, string>
}

/** Scored pilot entries from the log: `pilot:<role>` groups only, latest entry per batch dir (same
 * supersede rule as the taste harness), entries without a sources map skipped. */
export function loadPilotEntries(logPath: string): { entries: PilotLogEntry[]; skipped: number } {
  let text: string
  try {
    text = readFileSync(logPath, 'utf8')
  } catch {
    return { entries: [], skipped: 0 }
  }
  const latest = new Map<string, { group: string; picks: { rank: number; variant: string }[]; rejected?: string[]; sources?: Record<string, string> }>()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: { batch?: string; group?: string; picks?: { rank: number; variant: string }[]; rejected?: string[]; sources?: Record<string, string> }
    try {
      raw = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof raw.batch !== 'string' || typeof raw.group !== 'string' || !raw.group.startsWith('pilot:')) continue
    if (!Array.isArray(raw.picks) || raw.picks.length === 0) continue
    latest.set(raw.batch, { group: raw.group, picks: raw.picks, rejected: raw.rejected, sources: raw.sources })
  }
  const entries: PilotLogEntry[] = []
  let skipped = 0
  for (const [batch, e] of latest) {
    if (e.sources === undefined || Object.keys(e.sources).length === 0) {
      skipped += 1
      continue
    }
    entries.push({
      role: e.group.slice('pilot:'.length),
      batch,
      picks: [...e.picks].sort((a, b) => a.rank - b.rank).map((p) => p.variant),
      rejected: Array.isArray(e.rejected) ? e.rejected : [],
      sources: e.sources,
    })
  }
  return { entries, skipped }
}

export interface PilotRoleReport {
  role: string
  batches: number
  smoke: boolean
  stats: SourceStat[]
}

export interface PilotReport {
  logPath: string
  totalBatches: number
  skipped: number
  overall: SourceStat[]
  roles: PilotRoleReport[]
  smokeMinBatches: number
  /** the SCALING GATE verdict: do elites beat controls on the blind ratings so far? */
  gate: { elitePairwise: number | null; controlPairwise: number | null; eliteWins: number; controlWins: number; verdict: string }
}

function gateVerdict(overall: SourceStat[]): PilotReport['gate'] {
  const elite = overall.find((s) => s.kind === 'elite')
  const control = overall.find((s) => s.kind === 'control')
  const ep = elite && elite.pairCount > 0 ? elite.pairsWon / elite.pairCount : null
  const cp = control && control.pairCount > 0 ? control.pairsWon / control.pairCount : null
  let verdict: string
  if (!elite || !control) verdict = 'not enough scored batches yet — need both elite and control picks'
  else if (ep !== null && cp !== null && ep > cp + 0.05) verdict = 'elites are beating controls — evidence to consider scaling the budget (keep watching n)'
  else if (ep !== null && cp !== null && cp > ep + 0.05) verdict = 'controls are beating elites — the critic is not yet adding value over mutation + diversity; keep the leash short'
  else verdict = 'elites and controls are roughly tied — no scale-up evidence yet; the labels still accrue'
  return { elitePairwise: ep, controlPairwise: cp, eliteWins: elite?.wins ?? 0, controlWins: control?.wins ?? 0, verdict }
}

/** The scoreboard: per-arm (elite vs control) win / top-half / pairwise from every scored pilot
 * batch, overall and per role, with the small-n smoke convention and the SCALING GATE verdict. */
export function computePilotReport(logPath: string): PilotReport {
  const { entries, skipped } = loadPilotEntries(logPath)
  const roleKeys = [...new Set(entries.map((e) => e.role))].sort()
  const roles: PilotRoleReport[] = roleKeys.map((role) => {
    const roleEntries = entries.filter((e) => e.role === role)
    return { role, batches: roleEntries.length, smoke: roleEntries.length < SPLIT_SMOKE_MIN_BATCHES, stats: tally(roleEntries as RankedArmEntry[]) }
  })
  const overall = tally(entries as RankedArmEntry[])
  return {
    logPath,
    totalBatches: entries.length,
    skipped,
    overall,
    roles,
    smokeMinBatches: SPLIT_SMOKE_MIN_BATCHES,
    gate: gateVerdict(overall),
  }
}

/** Human-facing elite-vs-control scoreboard, honest about sample size, ending with the gate. */
export function formatPilotReport(r: PilotReport): string {
  let out = `pilot eval — elite-vs-control win rates over ${r.totalBatches} scored pilot batch(es) in ${r.logPath}\n`
  if (r.skipped > 0) out += `(${r.skipped} pilot-group entr${r.skipped === 1 ? 'y' : 'ies'} skipped: no per-variant arm record)\n`
  if (r.totalBatches === 0) {
    out += 'nothing scored yet — run a pilot (beat pilot run <dir>) and rate the frontier (beat rate <dir>) first\n'
    return out
  }
  out += `overall${r.totalBatches < r.smokeMinBatches ? '  [small n — smoke, not evidence]' : ''}:\n`
  for (const s of r.overall) out += statLine(s, '  ')
  out += `by role:\n`
  for (const role of r.roles) {
    out += `  ${role.role} (${role.batches} batch${role.batches === 1 ? '' : 'es'})${role.smoke ? '  [small n — smoke, not evidence]' : ''}\n`
    for (const s of role.stats) out += statLine(s, '    ')
  }
  out += `\nSCALING GATE: ${r.gate.verdict}\n`
  out += `  elite pairwise ${r.gate.elitePairwise === null ? '—' : pct(Math.round(r.gate.elitePairwise * 100), 100)}`
  out += `  vs control pairwise ${r.gate.controlPairwise === null ? '—' : pct(Math.round(r.gate.controlPairwise * 100), 100)}`
  out += `  (elites must beat controls before scale-up — research/117 §Part-4)\n`
  return out
}
