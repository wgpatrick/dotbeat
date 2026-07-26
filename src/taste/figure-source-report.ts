// The missing readout for the composition experiment (audit 140 D7, from research 124 §B.7/§C.7 and
// 125 §4 — both docs' CENTRAL validation experiment).
//
// `figureSource` records where a showdown batch's COMPOSED figures came from: 'midi' (private
// transcriptions of commercial tracks), 'theory' (the deterministic theory-aware layer,
// src/taste/theory.ts), 'ca2' (Composer's Assistant 2 composing over that layer's chord track,
// src/taste/ca2.ts) or 'bank' (the internal archetype bank). It is written into the batch manifest
// and copied into the scores-log entry — and then nothing reads it. `computeShowdownReport` tallies
// overall / by role / by ref-pool and no fourth axis, so the theory layer (1,294 lines) and the CA2
// sidecar (a 716 MB out-of-repo model, a Python sidecar, guards, tests, a doctor) both shipped
// specifically to be measured by an experiment whose readout does not exist.
//
// WHY IT WAS MISSED (worth keeping, because it generalizes): `figureSource` was built as PROVENANCE
// — D25 licensing hygiene, "the shared log records only the kind, never a song title or path" — and
// the privacy framing masked that the same field is also the experimental factor.
//
// WHY THIS IS A SEPARATE MODULE. The report lives in src/taste/showdown.ts, which another stream is
// actively editing. Everything needed is already exported from there (`tally`, `loadShowdownEntries`,
// `SourceStat`, `statLine`, `pct`), so this adds the one missing join and duplicates no scoreboard
// math — a `tally` fix lands here for free.
//
// INTEGRATION POINT, when showdown.ts is free: add `figureSources: figureSourceSplit(logPath)` to
// `computeShowdownReport`'s returned object (beside the existing `refPools:` line) and append
// `formatFigureSourceSplit(r.figureSources)` to `formatShowdownReport`. Nothing else changes; this
// module can then either stay as-is or be inlined.

import { existsSync, readFileSync } from 'node:fs'

import { SPLIT_SMOKE_MIN_BATCHES } from './eval.js'
import { loadShowdownEntries, pct, statLine, tally, type SourceStat } from './showdown.js'

/** The four labels `figureSource` can carry, plus the bucket for batches written before the field
 * existed (or scored without one). Deliberately not a closed union in the code below — an unknown
 * label must show up in the report rather than being silently dropped, which is the whole failure
 * mode this file exists to fix. */
export const FIGURE_SOURCES = ['midi', 'theory', 'ca2', 'bank'] as const
export type FigureSource = (typeof FIGURE_SOURCES)[number]

/** The label used for batches whose entry carries no `figureSource`. */
export const UNLABELLED = '(none recorded)'

export interface FigureSourceGroup {
  figureSource: string
  /** scored showdown batches carrying this label */
  batches: number
  /** per-source-kind scoreboard WITHIN this figure source — the same math the overall board uses */
  stats: SourceStat[]
  /** too few batches to read as a result — same convention and threshold as the per-role splits.
   * The theory arm has sat here since it shipped, which is the point of surfacing it. */
  smoke: boolean
}

export interface FigureSourceSplit {
  logPath: string
  /** batches that had a figureSource on their entry */
  labelled: number
  /** batches with no figureSource recorded — mostly pre-dating the field */
  unlabelled: number
  groups: FigureSourceGroup[]
  /** the small-n threshold the `smoke` flags use, echoed so a caller need not import it */
  smokeMinBatches: number
  /** the transpose, and the more direct readout: for one source kind, how it fared under each
   * figure source. Comparing `engine` across 'theory' and 'ca2' is the actual experiment. */
  byKind: { kind: string; rows: { figureSource: string; stat: SourceStat }[] }[]
  /** labels declared in FIGURE_SOURCES that appear in NO scored batch. A build with zero evidence
   * is the finding, not an empty row to skip past — CA2 sat here for its whole existence. */
  neverRated: string[]
}

/**
 * Map batch dir -> figureSource, read straight from the scores log.
 *
 * The shared latest-per-batch reader (`loadLatestRankedEntries`) projects entries down to
 * picks/rejected/sources and drops `figureSource`, so it has to be recovered separately. LAST
 * writer per batch wins, matching that reader's own supersede convention: a re-scored batch's
 * newer entry is the authority. Malformed lines are skipped, exactly as the shared reader does.
 */
export function figureSourceByBatch(logPath: string): Map<string, string> {
  const out = new Map<string, string>()
  if (!existsSync(logPath)) return out
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (t === '') continue
    let e: { batch?: unknown; group?: unknown; figureSource?: unknown }
    try {
      e = JSON.parse(t)
    } catch {
      continue
    }
    if (typeof e.group !== 'string' || !e.group.startsWith('showdown:')) continue
    if (typeof e.batch !== 'string' || typeof e.figureSource !== 'string') continue
    out.set(e.batch, e.figureSource)
  }
  return out
}

/** The scoreboard split by `figureSource` — the readout 124 and 125 were built to produce. */
export function figureSourceSplit(logPath: string): FigureSourceSplit {
  const { entries } = loadShowdownEntries(logPath)
  const byBatch = figureSourceByBatch(logPath)

  const buckets = new Map<string, typeof entries>()
  for (const e of entries) {
    const label = byBatch.get(e.batch) ?? UNLABELLED
    if (!buckets.has(label)) buckets.set(label, [])
    buckets.get(label)!.push(e)
  }

  const groups: FigureSourceGroup[] = [...buckets.entries()]
    .map(([figureSource, es]) => ({ figureSource, batches: es.length, stats: tally(es), smoke: es.length < SPLIT_SMOKE_MIN_BATCHES }))
    // declared order first (midi, theory, ca2, bank), then anything unexpected, then the unlabelled
    // bucket last — it is the least interesting and usually the largest.
    .sort((a, b) => figureRank(a.figureSource) - figureRank(b.figureSource) || a.figureSource.localeCompare(b.figureSource))

  const kinds = [...new Set(groups.flatMap((g) => g.stats.map((s) => s.kind)))].sort()
  const byKind = kinds.map((kind) => ({
    kind,
    rows: groups
      .map((g) => ({ figureSource: g.figureSource, stat: g.stats.find((s) => s.kind === kind) }))
      .filter((r): r is { figureSource: string; stat: SourceStat } => r.stat !== undefined),
  }))

  const seen = new Set(groups.map((g) => g.figureSource))
  return {
    logPath,
    labelled: entries.filter((e) => byBatch.has(e.batch)).length,
    unlabelled: entries.filter((e) => !byBatch.has(e.batch)).length,
    groups,
    smokeMinBatches: SPLIT_SMOKE_MIN_BATCHES,
    byKind,
    neverRated: FIGURE_SOURCES.filter((f) => !seen.has(f)),
  }
}

function figureRank(label: string): number {
  if (label === UNLABELLED) return FIGURE_SOURCES.length + 1
  const i = (FIGURE_SOURCES as readonly string[]).indexOf(label)
  return i === -1 ? FIGURE_SOURCES.length : i
}

/** Human-facing block, in the same voice and column widths as `formatShowdownReport`. */
export function formatFigureSourceSplit(r: FigureSourceSplit): string {
  let out = `\nby figure source — where each batch's COMPOSED figures came from (research 124/125's validation axis)\n`
  if (r.labelled === 0) {
    out += `  no scored showdown batch records a figureSource yet — nothing to split.\n`
    return out
  }
  out += `  ${r.labelled} labelled batch(es), ${r.unlabelled} without a recorded figureSource\n`
  for (const g of r.groups) {
    out += `\n  ${g.figureSource} (${g.batches} batch${g.batches === 1 ? '' : 'es'}${g.smoke ? ', SMOKE — too few to read as a result' : ''})\n`
    for (const s of g.stats) out += statLine(s, '    ')
  }
  // The transpose is the actual comparison, so print it explicitly rather than making the reader
  // hold four blocks in their head.
  const comparable = r.byKind.filter((k) => k.rows.length > 1)
  if (comparable.length > 0) {
    out += `\n  same source kind across figure sources (the comparison the experiment is for)\n`
    for (const k of comparable) {
      const cells = k.rows.map((row) => `${row.figureSource} ${pct(row.stat.pairsWon, row.stat.pairCount)} of ${row.stat.pairCount}`)
      out += `    ${k.kind.padEnd(10)} pairwise  ${cells.join('   ')}\n`
    }
  }
  if (r.neverRated.length > 0) {
    out += `\n  NEVER RATED: ${r.neverRated.join(', ')} — built, integrated, and carrying zero evidence.\n`
  }
  return out
}
