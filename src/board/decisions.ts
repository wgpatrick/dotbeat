// beat board — the production PICKING surface's decision log (research/128 §2.1). The NON-BLIND
// sibling of scoreBatch (src/vary/batch.ts): where `beat rate` writes blind measurement into
// beat-scores.jsonl, `beat board` writes named production DECISIONS into a DELIBERATELY SEPARATE
// beat-decisions.jsonl. Doc 128 (D24): "production never contaminates eval" — the two logs never
// merge, and no taste-eval loader globs this file. These entries double as the accept/reject
// labels a future taste model can train on (tagged non-blind), so an entry is self-describing:
// provenance snapshot + measured features travel with every pick and reject-all.
//
// Two artifacts per decision, mirroring how a pick lands in the vary flow:
//  - one append to beat-decisions.jsonl (the collection-root log, `beat board`'s --log override)
//  - <batch>/decision.json — the per-batch answer an AGENT polls on resume ("whose turn is it").
// SKIP records neither: an undecided batch simply has no decision.json and no log entry, so it
// re-appears in the next board session. Only pick and reject-all are durable verdicts.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { resolve, dirname, basename, join } from 'node:path'
import {
  readBatchManifest,
  resolveBatchParent,
  normalizePick,
  BeatBatchError,
  DEFAULT_SCORES_LOG,
  type VaryBatchManifest,
} from '../vary/batch.js'
import { computeBatchFeatures } from '../taste/features.js'

/** Where `beat board` appends and `beat board --status` reads, absent an override. Deliberately a
 * SEPARATE filename from DEFAULT_SCORES_LOG (beat-scores.jsonl) — same directory, never the same
 * file (doc 128 §2.1: the blind/production split is schema-level, separate verb + separate log). */
export const DEFAULT_DECISIONS_LOG = 'beat-decisions.jsonl'

/** A one-variant provenance snapshot, copied verbatim into the decision so the record survives the
 * batch dir being deleted (the same durability rule scoreBatch's `features`/`sources` follow). The
 * fields are exactly what the board shows NON-BLIND: where a variant came from and how. */
export interface DecisionProvenance {
  /** manifest source.kind (engine|gen|keymap|ref) when present */
  sourceKind?: string
  /** manifest source.from — human-readable provenance label (seed+track, prompt, ref path) */
  from?: string
  /** feel/whole-doc batches: the recipe string */
  recipe?: string
  /** param batches: the replayable "path value" edits */
  edits?: string[]
  /** gen batches: the media id / provider / license this candidate would register as */
  media?: { id: string; source?: string; license?: string; seed?: number }
}

export interface DecisionEntry {
  t: string
  batch: string
  track?: string
  group: string
  seed: number
  parentSha256: string
  prompt?: string
  /** 'pick' = one winner chosen (with optional note); 'reject-all' = every candidate rejected,
   * carrying the REQUIRED reject-with-feedback note (doc 128 §2.6: rejection must carry
   * information). SKIP is never written — it is the absence of an entry. */
  decision: 'pick' | 'reject-all'
  /** The winner(s), best first — length 1 for a v1 board pick, empty for reject-all. */
  picks: { rank: number; variant: string }[]
  /** Every non-picked candidate, with the reject-all note attached (a pick's losers carry no
   * per-variant note in v1 — only the winner + an optional board note). */
  rejected: { variant: string; note?: string }[]
  /** Board-level note: the optional pick note, or the required reject-all note. */
  note?: string
  /** Per-variant provenance snapshot, keyed by the variant's manifest `file`. */
  provenance: Record<string, DecisionProvenance>
  /** DSP feature vector of every rendered variant, keyed by `file` — the same enrichment
   * scoreBatch writes, so these entries are trainable accept/reject labels without the batch dir. */
  features?: Record<string, Record<string, number>>
  /** Load-time tag that keeps production picks out of any accidental blind-eval ingest, and lets a
   * deliberate future import mark them for what they are (doc 128 §2.1). Always true here. */
  nonBlind: true
}

/** The compact per-batch answer written to <batch>/decision.json — the file an agent polls to
 * learn "was this board decided, and how" without parsing the whole log. A superset-lite of the
 * log entry: the fields an agent acts on, in the shape doc 128 §2.1 names. */
export interface DecisionFile {
  decided_at: string
  board_id: string
  decision: 'pick' | 'reject-all'
  /** the winning variant's `file`, absent on reject-all */
  pick?: string
  rejected: { variant: string; note?: string }[]
  note?: string
  /** reject-all only: the reason nothing was picked (mirrors `note`, the doc-128 §2.1 `none` slot) */
  none?: string
}

export interface DecisionResult {
  dir: string
  logPath: string
  manifest: VaryBatchManifest
  entry: DecisionEntry
  file: DecisionFile
}

/** Resolve the decisions log the same way scoreBatch resolves the scores log: an explicit path
 * wins; otherwise beat-decisions.jsonl next to the batch's parent .beat (clip-set batches with no
 * parent fall back to next-to-the-batch-dir). `beat board` always passes an explicit root-level
 * path, so this default only bites direct/programmatic callers. */
function resolveDecisionsLog(dir: string, manifest: VaryBatchManifest, logPath?: string): string {
  if (logPath !== undefined) return logPath
  if (manifest.parent === '') return resolve(dirname(resolve(dir)), DEFAULT_DECISIONS_LOG)
  return resolve(dirname(resolveBatchParent(dir, manifest)), DEFAULT_DECISIONS_LOG)
}

/** One variant's provenance snapshot from its manifest entry — omitting every empty field so a
 * plain engine variant doesn't carry a clutter of undefineds. */
function provenanceOf(v: VaryBatchManifest['variants'][number]): DecisionProvenance {
  const p: DecisionProvenance = {}
  if (v.source?.kind !== undefined) p.sourceKind = v.source.kind
  if (v.source?.from !== undefined) p.from = v.source.from
  if (v.recipe !== undefined) p.recipe = v.recipe
  if (v.edits !== undefined) p.edits = v.edits
  if (v.media !== undefined) {
    p.media = {
      id: v.media.id,
      ...(v.media.source !== undefined ? { source: v.media.source } : {}),
      ...(v.media.license !== undefined ? { license: v.media.license } : {}),
      ...(v.media.seed !== undefined ? { seed: v.media.seed } : {}),
    }
  }
  return p
}

/** Common tail: attach provenance + features, append the log entry, write decision.json, return. */
function land(
  dir: string,
  manifest: VaryBatchManifest,
  logPath: string | undefined,
  partial: Pick<DecisionEntry, 'decision' | 'picks' | 'rejected' | 'note'>,
): DecisionResult {
  const resolvedLog = resolveDecisionsLog(dir, manifest, logPath)
  const provenance: Record<string, DecisionProvenance> = {}
  for (const v of manifest.variants) provenance[v.file] = provenanceOf(v)

  const entry: DecisionEntry = {
    t: new Date().toISOString(),
    batch: dir,
    ...(manifest.track !== undefined ? { track: manifest.track } : {}),
    group: manifest.group,
    seed: manifest.seed,
    parentSha256: manifest.parentSha256,
    ...(manifest.prompt !== undefined ? { prompt: manifest.prompt } : {}),
    ...partial,
    provenance,
    nonBlind: true,
  }
  const features = computeBatchFeatures(dir, manifest.variants.map((v) => v.file))
  if (Object.keys(features).length > 0) entry.features = features

  // decision.json is the COMPACT agent answer: one place per fact. A pick carries its optional
  // `note`; a reject-all carries its required reason in `none` (the doc-128 §2.1 slot) and NOT also
  // in `note` — the pilot found the same string echoed three ways (note + none + every rejected[])
  // cryptic. The full per-variant reject notes live in the log entry (the training record), not here.
  const file: DecisionFile = {
    decided_at: entry.t,
    board_id: basename(dir),
    decision: entry.decision,
    ...(entry.picks[0] !== undefined ? { pick: entry.picks[0].variant } : {}),
    rejected: entry.rejected.map((r) => ({ variant: r.variant })),
    ...(entry.decision === 'pick' && entry.note !== undefined ? { note: entry.note } : {}),
    ...(entry.decision === 'reject-all' && entry.note !== undefined ? { none: entry.note } : {}),
  }

  appendFileSync(resolvedLog, JSON.stringify(entry) + '\n')
  writeFileSync(join(dir, 'decision.json'), JSON.stringify(file, null, 2) + '\n')
  return { dir, logPath: resolvedLog, manifest, entry, file }
}

/** Record a PICK: one winner (accepts "N" or "vN", same normalization as scoreBatch/adopt),
 * optionally with a note. Every other candidate is recorded as rejected without a per-variant
 * note. */
export function recordPick(dir: string, pick: string, opts: { note?: string } = {}, logPath?: string): DecisionResult {
  const manifest = readBatchManifest(dir)
  const n = normalizePick(pick, manifest.variants.length)
  const winner = manifest.variants[n - 1]!.file
  const note = opts.note?.trim()
  return land(dir, manifest, logPath, {
    decision: 'pick',
    picks: [{ rank: 1, variant: winner }],
    rejected: manifest.variants.filter((_, i) => i !== n - 1).map((v) => ({ variant: v.file })),
    ...(note ? { note } : {}),
  })
}

/** Record a REJECT-ALL: every candidate rejected, carrying the REQUIRED note (the
 * reject-with-feedback verb — doc 128 §2.6). An empty/whitespace note is refused: a rejection
 * with no reason is exactly the lost signal this verb exists to capture. */
export function recordRejectAll(dir: string, note: string, logPath?: string): DecisionResult {
  const manifest = readBatchManifest(dir)
  const trimmed = (note ?? '').trim()
  if (trimmed === '') {
    throw new BeatBatchError('reject-all needs a note — the point of rejecting a whole board is to say WHY (it feeds PREFERENCES.md). Pass a reason.')
  }
  return land(dir, manifest, logPath, {
    decision: 'reject-all',
    picks: [],
    rejected: manifest.variants.map((v) => ({ variant: v.file, note: trimmed })),
    note: trimmed,
  })
}

/** The set of batch dirs (resolved absolute) that already have a decision in the log — the
 * board's undecided-scan uses this exactly as `beat rate` uses scoredBatchDirs. Tolerant of
 * non-entry lines. */
export function decidedBatchDirs(logPath: string): Set<string> {
  const decided = new Set<string>()
  if (!existsSync(logPath)) return decided
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    try {
      const e = JSON.parse(line) as Partial<DecisionEntry>
      if (typeof e.batch === 'string' && (e.decision === 'pick' || e.decision === 'reject-all')) decided.add(resolve(e.batch))
    } catch {
      /* non-entry line */
    }
  }
  return decided
}

/** Read a batch dir's decision.json (the per-batch agent-readable answer), or null if undecided. */
export function readDecisionFile(dir: string): DecisionFile | null {
  const path = join(dir, 'decision.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as DecisionFile
  } catch {
    return null
  }
}
