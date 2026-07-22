// Production-task eval — production-transform (docs/research/119-production-task-evals.md §T-C /
// §2.1, and docs/prodtask.md). The question: do the research-118 production tricks move the
// OWNER'S blind ratings — not just the width/air METRICS the showdown measured? Each batch is ONE
// source clip in N ARMS, blind-rated through the unchanged `beat rate` flow:
//
//   original — the role's composed figure, soloed, rendered raw through dotbeat's own engine (the
//              documented loss mode: mono / airless / static)
//   tricked  — the SAME figure + patch, plus a sensible per-role trick stack applied via the real
//              `beat trick apply` path (src/analysis/trick.ts) — width / air / glue moves
//   random   — the SAME figure + patch, plus a magnitude-matched RANDOM-EDIT control: the same
//              number of edits as the trick stack made, on randomly-chosen legal params at legal
//              values (vary's mutation machinery). The control that separates "the RIGHT production
//              moves" from "any change sounds different" (research 119 §T-C: tricked must beat
//              random or the catalog's CONTENT is doing no work).
//
// Same structural honesty as the source showdown (docs/source-showdown-eval.md), reused wholesale:
// clip-set batches (empty parent — score works, adopt refuses), group `prodtask:transform:<role>`,
// seeded source->v-number shuffle (the rate UI shuffles again), duration-match, and — load-bearing
// — batch-level loudness normalization: tricks must win on WIDTH/AIR/GLUE, never on level. This
// module is render-free and network-free by construction (it builds documents, manifests, and does
// frame math is left to showdown.ts's helpers); the CLI (cli/beat.mjs prodtaskCmd) owns the renders,
// so everything here tests on synthetic audio, the same posture as test/showdown.test.ts.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setValue, type BeatDocument } from '../core/index.js'
import { formatNumber } from '../core/format.js'
import { applyTrick, type BeatTrick } from '../analysis/trick.js'
import type { BeatMacro } from '../core/index.js'
import {
  VARY_GROUPS,
  legalGroupsForKind,
  makeRng,
  sampleValueInRange,
  type VaryParamDef,
} from '../vary/vary.js'
import { type FeatureKey, type FeatureVector } from './features.js'
import { BeatBatchError, type VaryBatchManifest } from '../vary/batch.js'
import { SPLIT_SMOKE_MIN_BATCHES } from './eval.js'
import { tally, statLine, pct, type SourceStat } from './showdown.js'

// ---- roles & the per-role trick stacks ---------------------------------------------------------

export type ProdtaskArm = 'original' | 'tricked' | 'random'

export interface ProdtaskRoleSpec {
  role: string
  /** the taste-seed track that carries this role (matches SHOWDOWN_ROLES / generateSeedBeat ids) */
  seedTrack: string
  kind: 'synth' | 'drums'
}

/** The four transform roles — the same seed-track mapping the showdown uses, so a prodtask round
 * draws seeds and composes figures with the exact machinery the showdown already validates. */
export const PRODTASK_ROLES: ProdtaskRoleSpec[] = [
  { role: 'bassline', seedTrack: 'bass', kind: 'synth' },
  { role: 'chords', seedTrack: 'chords', kind: 'synth' },
  { role: 'lead', seedTrack: 'arp', kind: 'synth' },
  { role: 'drum-loop', seedTrack: 'drums', kind: 'drums' },
]

export function prodtaskRole(role: string): ProdtaskRoleSpec {
  const spec = PRODTASK_ROLES.find((r) => r.role === role)
  if (!spec) throw new BeatBatchError(`unknown prodtask role "${role}" (have: ${PRODTASK_ROLES.map((r) => r.role).join(', ')})`)
  return spec
}

/** A sensible production STACK per role, from the validated catalog (presets/tricks.json) — the
 * width / air / glue moves that fit the role and apply cleanly to a fresh mono/dry engine clip
 * (the exact loss mode the showdown measured). Curated rather than drawn from `beat trick suggest`
 * because the transform arm is composed BEFORE any render, so suggest would only ever see the
 * document-state preconditions anyway — a fixed, honest stack is the fair test of the catalog's
 * CONTENT. Override with `--tricks name,name`.
 *
 * Per-role rationale (productionRoleFor maps bass->bass, chords->chords, arp->lead, drums->kit):
 *  - bassline: production for a bass is GLUE, not width or air — you give it sub weight
 *    (sub-foundation) and warmth (glue-saturation), and you deliberately DON'T widen or air-shelf
 *    it (the catalog's width/air tricks all counter-indicate bass/sub — a widened, shelved sub is
 *    a mixing mistake, so those tricks refuse). An honest two-move glue stack.
 *  - chords / lead: the canonical width+air+glue trio — unison stereo spread, a high shelf for
 *    air, warm saturation for glue.
 *  - drum-loop: autopan the hats for width, open-hat offbeats + a brighter tone for air. Glue is
 *    a bus move (glue-saturation is per-synth-track only), so the kit stack is width+air. */
export const PRODTASK_TRICK_STACKS: Record<string, readonly string[]> = {
  bassline: ['sub-foundation', 'glue-saturation'],
  chords: ['unison-spread', 'air-shelf', 'glue-saturation'],
  lead: ['unison-spread', 'air-shelf', 'glue-saturation'],
  'drum-loop': ['autopan-hats', 'open-hat-air'],
}

/** The trick stack for a role — the curated default, or an explicit override list. Throws (with
 * the legal names) on an unknown trick so a typo fails at spec time, not mid-run. */
export function resolveTrickStack(role: string, tricks: BeatTrick[], override?: readonly string[]): BeatTrick[] {
  const names = override ?? PRODTASK_TRICK_STACKS[role]
  if (!names) throw new BeatBatchError(`no default trick stack for role "${role}" — pass --tricks name,name (have tricks: ${tricks.map((t) => t.name).join(', ')})`)
  return names.map((n) => {
    const t = tricks.find((tr) => tr.name === n)
    if (!t) throw new BeatBatchError(`unknown trick "${n}" in the stack for role "${role}" (have: ${tricks.map((tr) => tr.name).join(', ')})`)
    return t
  })
}

// ---- the tricked arm ---------------------------------------------------------------------------

export interface TrickStackResult {
  doc: BeatDocument
  /** trick names actually applied, in order */
  tricks: string[]
  /** the honest, flattened edit receipt across the whole stack (the manifest's provenance) */
  applied: string[]
  /** advisory warnings across the stack (failed `when` preconditions — apply proceeds) */
  warnings: string[]
  /** the number of real edits the stack made (no-op effect re-adds excluded) — the count the
   * random-edit control matches. */
  editCount: number
}

/** Apply the role's trick stack to `trackId` sequentially, through the real `applyTrick` path (no
 * force: a curated stack must not counter-indicate — if one does, that's a stack bug and it throws
 * loudly). `features` is null at compose time (no render yet), so metric preconditions warn but the
 * stack proceeds — the same advisory posture as `beat trick apply`. Notes/hits are untouched by
 * construction (every trick step routes through an existing edit primitive), so the tricked arm
 * holds the figure and patch constant against the original and varies ONLY production. */
export function applyTrickStack(doc: BeatDocument, trackId: string, stack: BeatTrick[], macros: BeatMacro[]): TrickStackResult {
  let cur = doc
  const tricks: string[] = []
  const applied: string[] = []
  const warnings: string[] = []
  let editCount = 0
  for (const trick of stack) {
    const res = applyTrick(trick, { doc: cur, trackId, features: null }, { macros })
    cur = res.doc
    tricks.push(trick.name)
    for (const a of res.applied) {
      applied.push(`${trick.name}: ${a}`)
      if (!a.includes('(no-op)')) editCount += 1
    }
    for (const w of res.warnings) warnings.push(`${trick.name}: ${w}`)
  }
  if (editCount === 0) throw new BeatBatchError(`the trick stack for "${trackId}" made no edits — nothing to rate against the original`)
  return { doc: cur, tricks, applied, warnings, editCount }
}

// ---- the random-edit control -------------------------------------------------------------------

export interface RandomEditResult {
  doc: BeatDocument
  /** the applied edits as replayable "path value" strings — the manifest's honest record */
  edits: string[]
}

/** Legal random-edit CANDIDATES for a track: every vary param that is actually audible on the
 * track's kind, as `{ path, def }`. Synth tracks get the full param surface (osc / motion / fx /
 * sends / mix / filter / env / filterenv); drums tracks get the BUS groups only (filter / env /
 * filterenv / fx / sends / mix) — the legacy track-wide kick/snare/hats voice params are provably
 * inaudible on a declared-lane kit (pilot 101), and lane-level randomization is a different, larger
 * control. `volume` is excluded everywhere: batch loudness normalization cancels it, so a random
 * volume edit would be a wasted (invisible) edit rather than an audible change. */
export function randomEditCandidates(trackId: string, kind: 'synth' | 'drums'): { path: string; def: VaryParamDef }[] {
  const groups = kind === 'drums' ? ['filter', 'env', 'filterenv', 'fx', 'sends', 'mix'] : legalGroupsForKind('synth')
  const out: { path: string; def: VaryParamDef }[] = []
  for (const g of groups) {
    for (const def of VARY_GROUPS[g] ?? []) {
      if (def.key === 'volume') continue
      out.push({ path: `${trackId}.${def.key}`, def })
    }
  }
  return out
}

/** The random-edit control (research 119 §T-C): apply `editCount` edits on RANDOMLY-CHOSEN legal
 * params at seeded random legal values, matched to the number of edits the trick stack made. Params
 * are drawn without replacement (a seeded shuffle) so the control touches `editCount` DISTINCT
 * knobs, and each value is a full-range musical draw (vary's `sampleValueInRange`); a draw that
 * rounds to the param's current value is re-rolled a few times so every edit is a real change.
 * Deterministic in `seed`. This controls for "any change sounds different/better" — the same number
 * of edits, same parameter KINDS, random targets and values. */
export function randomEditControl(doc: BeatDocument, trackId: string, editCount: number, seed: number): RandomEditResult {
  const track = doc.tracks.find((t) => t.id === trackId)
  if (!track) throw new BeatBatchError(`no track "${trackId}" for the random-edit control (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
  if (track.kind !== 'synth' && track.kind !== 'drums') throw new BeatBatchError(`random-edit control covers synth/drums tracks, and "${trackId}" is ${track.kind}`)
  if (editCount < 1) throw new BeatBatchError(`random-edit control needs a positive edit count, got ${editCount}`)
  const candidates = randomEditCandidates(trackId, track.kind)
  const rng = makeRng(seed)
  // seeded Fisher-Yates over the candidate list — pick `editCount` DISTINCT params
  const order = candidates.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  const n = Math.min(editCount, candidates.length)
  let cur = doc
  const edits: string[] = []
  for (let k = 0; k < n; k++) {
    const cand = candidates[order[k]!]!
    const t = cur.tracks.find((tt) => tt.id === trackId)!
    const before = formatNumber((t.synth as unknown as Record<string, number>)[cand.def.key] ?? 0)
    let text = ''
    for (let attempt = 0; attempt < 8; attempt++) {
      const v = formatNumber(sampleValueInRange(cand.def, rng))
      if (v !== before) { text = v; break }
    }
    if (text === '') continue // param sat at its own value across every draw — skip (rare)
    cur = setValue(cur, cand.path, text)
    edits.push(`${cand.path} ${text}`)
  }
  if (edits.length === 0) throw new BeatBatchError(`the random-edit control produced no edits for "${trackId}" — candidate params all sat at their draws`)
  return { doc: cur, edits }
}

// ---- batch assembly ----------------------------------------------------------------------------

export interface ProdtaskClipSource {
  kind: ProdtaskArm
  /** human-readable provenance (the manifest's `from`) */
  from: string
  /** the trick names applied (tricked arm) — recorded honestly in the manifest */
  tricks?: string[]
  /** the random-edit control's applied edits (random arm) — recorded honestly in the manifest */
  edits?: string[]
}

/** Write the prodtask-transform batch manifest over v1..vN.wav already in `outDir`: the clip-set
 * shape (empty parent — score works, adopt refuses) with group `prodtask:transform:<role>` and
 * per-variant `source` records carrying the arm kind PLUS the applied tricks / random edits,
 * honestly. No gitignore gate — every arm is an ordinary engine render of a composed figure (no
 * ref / surge / midi-derived audio), so the batch is safe to commit. */
export function writeProdtaskBatch(
  outDir: string,
  role: string,
  clips: { file: string; source: ProdtaskClipSource }[],
  opts: { seed?: number; task?: string } = {},
): VaryBatchManifest {
  if (clips.length < 2) throw new BeatBatchError('a prodtask batch needs at least two arm clips')
  for (const c of clips) {
    if (!existsSync(resolve(outDir, c.file))) throw new BeatBatchError(`prodtask batch is missing ${resolve(outDir, c.file)}`)
  }
  const task = opts.task ?? 'transform'
  const manifest: VaryBatchManifest = {
    parent: '',
    parentSha256: '',
    group: `prodtask:${task}:${role}`,
    count: clips.length,
    seed: opts.seed ?? 61,
    createdAt: new Date().toISOString(),
    variants: clips.map((c) => ({
      file: c.file,
      // the arm kind is the scored axis (scoreBatch copies `kind` into the log); tricks/edits stay
      // in the manifest only (batch-local honesty, like a ref clip's `from` path)
      source: {
        kind: c.source.kind,
        from: c.source.from,
        ...(c.source.tricks !== undefined ? { tricks: c.source.tricks } : {}),
        ...(c.source.edits !== undefined ? { edits: c.source.edits } : {}),
      } as VaryBatchManifest['variants'][number]['source'],
    })),
  }
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

// ---- reporting ---------------------------------------------------------------------------------

export interface ProdtaskLogEntry {
  task: string
  role: string
  batch: string
  /** ranked pick files, best first */
  picks: string[]
  rejected: string[]
  /** variant file -> arm kind */
  sources: Record<string, string>
  /** variant file -> DSP feature vector (from the score-time enrichment), when present — the
   * "sanity receipts for free" of research 119 §T-C: does the tricked arm's stereoWidthDb / bandAirPct
   * actually move into the produced range? */
  features?: Record<string, FeatureVector>
}

/** Scored prodtask entries from the log: `prodtask:<task>:<role>` groups only, latest entry per
 * batch dir (same supersede rule as the taste harness), entries without a sources map skipped. */
export function loadProdtaskEntries(logPath: string): { entries: ProdtaskLogEntry[]; skipped: number } {
  let text: string
  try {
    text = readFileSync(logPath, 'utf8')
  } catch {
    return { entries: [], skipped: 0 }
  }
  const latest = new Map<string, { group: string; picks: { rank: number; variant: string }[]; rejected?: string[]; sources?: Record<string, string>; features?: Record<string, FeatureVector> }>()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: { batch?: string; group?: string; picks?: { rank: number; variant: string }[]; rejected?: string[]; sources?: Record<string, string>; features?: Record<string, FeatureVector> }
    try {
      raw = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof raw.batch !== 'string' || typeof raw.group !== 'string' || !raw.group.startsWith('prodtask:')) continue
    if (!Array.isArray(raw.picks) || raw.picks.length === 0) continue
    latest.set(raw.batch, { group: raw.group, picks: raw.picks, rejected: raw.rejected, sources: raw.sources, features: raw.features })
  }
  const entries: ProdtaskLogEntry[] = []
  let skipped = 0
  for (const [batch, e] of latest) {
    if (e.sources === undefined || Object.keys(e.sources).length === 0) {
      skipped += 1
      continue
    }
    // group is `prodtask:<task>:<role>`; a role can itself contain no ':' (bassline, drum-loop)
    const rest = e.group.slice('prodtask:'.length)
    const sep = rest.indexOf(':')
    const task = sep === -1 ? rest : rest.slice(0, sep)
    const role = sep === -1 ? '' : rest.slice(sep + 1)
    entries.push({
      task,
      role,
      batch,
      picks: [...e.picks].sort((a, b) => a.rank - b.rank).map((p) => p.variant),
      rejected: Array.isArray(e.rejected) ? e.rejected : [],
      sources: e.sources,
      ...(e.features !== undefined ? { features: e.features } : {}),
    })
  }
  return { entries, skipped }
}

/** Mean of a DSP metric per arm across entries that carry the feature vectors — the mechanical
 * receipt alongside the blind result (research 119 §T-C). Absent arms / metrics are simply not in
 * the returned map. */
export function armMetricMeans(entries: ProdtaskLogEntry[], metric: FeatureKey): Record<string, number> {
  const sums = new Map<string, { sum: number; n: number }>()
  for (const e of entries) {
    if (!e.features) continue
    for (const [file, kind] of Object.entries(e.sources)) {
      const fv = e.features[file]
      if (!fv || typeof fv[metric] !== 'number' || !Number.isFinite(fv[metric])) continue
      const s = sums.get(kind) ?? { sum: 0, n: 0 }
      s.sum += fv[metric]
      s.n += 1
      sums.set(kind, s)
    }
  }
  const out: Record<string, number> = {}
  for (const [kind, s] of sums) if (s.n > 0) out[kind] = Math.round((s.sum / s.n) * 100) / 100
  return out
}

export interface ProdtaskRoleReport {
  task: string
  role: string
  batches: number
  smoke: boolean
  stats: SourceStat[]
  /** per-arm mean metric receipts (research 119 §T-C two-receipt design) */
  metricMeans: { metric: FeatureKey; byArm: Record<string, number> }[]
}

export interface ProdtaskReport {
  logPath: string
  totalBatches: number
  skipped: number
  overall: SourceStat[]
  /** per (task, role) split — the honest small-n unit, same convention as the showdown */
  roles: ProdtaskRoleReport[]
  /** the metrics surfaced as per-arm receipts */
  receiptMetrics: FeatureKey[]
  smokeMinBatches: number
}

/** The metrics the report ties the blind result back to — the two the showdown measured as the
 * engine's loss (research 119 §T-C): stereo width and air-band energy. */
export const PRODTASK_RECEIPT_METRICS: FeatureKey[] = ['stereoWidthDb', 'bandAirPct']

/** The scoreboard: per-arm win / top-half / pairwise from every scored prodtask batch, overall and
 * per (task, role), with the same small-n smoke convention as the showdown and taste-eval, plus the
 * per-arm DSP metric means (the mechanical receipt). Reuses the showdown's `tally` verbatim. */
export function computeProdtaskReport(logPath: string): ProdtaskReport {
  const { entries, skipped } = loadProdtaskEntries(logPath)
  const keyOf = (e: ProdtaskLogEntry) => `${e.task} ${e.role}`
  const roleKeys = [...new Set(entries.map(keyOf))].sort()
  const roles: ProdtaskRoleReport[] = roleKeys.map((k) => {
    const [task, role] = k.split(' ') as [string, string]
    const roleEntries = entries.filter((e) => keyOf(e) === k)
    return {
      task,
      role,
      batches: roleEntries.length,
      smoke: roleEntries.length < SPLIT_SMOKE_MIN_BATCHES,
      stats: tally(roleEntries),
      metricMeans: PRODTASK_RECEIPT_METRICS.map((metric) => ({ metric, byArm: armMetricMeans(roleEntries, metric) })),
    }
  })
  return {
    logPath,
    totalBatches: entries.length,
    skipped,
    overall: tally(entries),
    roles,
    receiptMetrics: PRODTASK_RECEIPT_METRICS,
    smokeMinBatches: SPLIT_SMOKE_MIN_BATCHES,
  }
}

function metricReceiptLine(metric: FeatureKey, byArm: Record<string, number>, indent: string): string {
  const arms = ['original', 'tricked', 'random'].filter((a) => a in byArm)
  if (arms.length === 0) return ''
  return `${indent}${metric}: ${arms.map((a) => `${a} ${byArm[a]}`).join('  ')}\n`
}

/** Human-facing scoreboard, honest about sample size (smoke labels per split AND overall), with
 * the per-arm metric receipts under each split. */
export function formatProdtaskReport(r: ProdtaskReport): string {
  let out = `production-task eval — per-arm win rates over ${r.totalBatches} scored prodtask batch(es) in ${r.logPath}\n`
  if (r.skipped > 0) out += `(${r.skipped} prodtask-group entr${r.skipped === 1 ? 'y' : 'ies'} skipped: no per-variant arm record)\n`
  if (r.totalBatches === 0) {
    out += 'nothing scored yet — collect a round (beat prodtask transform <dir>) and rate it (beat rate <dir>) first\n'
    return out
  }
  out += `overall${r.totalBatches < r.smokeMinBatches ? '  [small n — smoke, not evidence]' : ''}:\n`
  for (const s of r.overall) out += statLine(s, '  ')
  out += `by task/role:\n`
  for (const role of r.roles) {
    out += `  ${role.task}:${role.role} (${role.batches} batch${role.batches === 1 ? '' : 'es'})${role.smoke ? '  [small n — smoke, not evidence]' : ''}\n`
    for (const s of role.stats) out += statLine(s, '    ')
    for (const m of role.metricMeans) out += metricReceiptLine(m.metric, m.byArm, '      receipt ')
  }
  out += `(win = ranked best; top-half = ranked in the top ceil(n/2) picks; pairwise = implied comparisons won; receipt = per-arm mean DSP metric — the tricked arm should sit toward the produced range: width -25..-8 dB, air 1..2.5%)\n`
  out += `(chance: tricked-vs-original pairwise 50% = tricks don't move the ear; tricked must ALSO beat random or the catalog's CONTENT is doing no work — research 119 §T-C)\n`
  return out
}
