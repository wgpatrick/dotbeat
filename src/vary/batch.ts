// Vary-batch plumbing shared by BOTH agent surfaces (Phase 34 Stream NA, the pilot-95 parity
// lesson): the manifest-write, pick-normalization, score-entry, and batch-render logic that
// `beat vary`/`beat score` (cli/beat.mjs) and `beat_vary`/`beat_score` (src/mcp/server.ts) must
// agree on byte-for-byte. A batch generated on either surface is scored on either surface — the
// manifest.json shape and the beat-scores.jsonl entry shape ARE the contract, so they live here
// once instead of being re-shaped per surface (phase-34-plan.md NA item 5: "extract the shared
// shaping into src/ helpers both surfaces import, so the next drift can't happen").

import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, symlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serialize, type BeatDocument } from '../core/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..') // dist/src/vary -> repo root

/** Where `beat score`/`beat_score` append and `beat suggest`/`beat_suggest` read, absent an override. */
export const DEFAULT_SCORES_LOG = 'beat-scores.jsonl'

/** Batch/score shaping failures — the CLI rewraps these as BeatEditError (clean `error: ...`
 * output, exit 2); the MCP server surfaces the message as an isError tool result. */
export class BeatBatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatBatchError'
  }
}

export interface VaryBatchManifest {
  parent: string
  parentSha256: string
  track: string
  group: string
  count: number
  amount?: number // param batches only — feel batches have no strength knob, so no key at all
  seed: number
  createdAt: string
  variants: { file: string; edits?: string[]; recipe?: string }[]
}

export interface WriteVaryBatchOptions {
  /** The parent .beat path exactly as the caller referenced it — stored verbatim in the manifest
   * (and echoed back by score's adopt hint), same as the CLI has always done. */
  parentPath: string
  /** The parent's raw text, hashed into parentSha256 so score entries pin the exact source. */
  parentText: string
  track: string
  group: string
  count: number
  amount?: number
  seed: number
  outDir: string
  /** From varyTrack (edits) or varyFeel (recipe) — exactly one of the two per variant. */
  variants: { doc: BeatDocument; edits?: { path: string; value: string }[]; recipe?: string }[]
}

/** Writes v1.beat..vN.beat plus manifest.json into outDir. The manifest shape is the cross-surface
 * contract `scoreBatch` below reads — param batches carry replayable `edits` ("path value" strings,
 * ready for `beat set`), feel batches carry a `recipe` (the whole variant file IS the result, since
 * humanize isn't a set-replayable edit). */
export function writeVaryBatch(opts: WriteVaryBatchOptions): VaryBatchManifest {
  mkdirSync(opts.outDir, { recursive: true })
  const manifest: VaryBatchManifest = {
    parent: opts.parentPath,
    parentSha256: createHash('sha256').update(opts.parentText).digest('hex'),
    track: opts.track,
    group: opts.group,
    count: opts.count,
    ...(opts.amount !== undefined ? { amount: opts.amount } : {}),
    seed: opts.seed,
    createdAt: new Date().toISOString(),
    // Renders are nondeterministic run-to-run — measured (Phase 34 NC, docs/render-determinism.md):
    // identical re-renders differ by up to ~0.6 dB in peak-domain metrics (true peak / crest),
    // ~1.6 band-share points, and ~1.3 dB stereo width, while LUFS stays within ~0.2 LU (tolerance
    // constants: RENDER_RUN_VARIANCE_* in src/metrics/variance.ts). Only compare renders from the
    // same batch, never across sessions, and treat metric deltas inside those bounds as ties, not
    // rankings.
    variants: opts.variants.map((v, i) => ({
      file: `v${i + 1}.beat`,
      ...(v.recipe !== undefined ? { recipe: v.recipe } : { edits: (v.edits ?? []).map((e) => `${e.path} ${e.value}`) }),
    })),
  }
  for (let i = 0; i < opts.variants.length; i++) {
    writeFileSync(resolve(opts.outDir, `v${i + 1}.beat`), serialize(opts.variants[i]!.doc))
  }
  writeFileSync(resolve(opts.outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

export interface RenderBatchOptions {
  /** Set to the parent .beat path for FEEL batches: variant files reference media relative to
   * themselves, and the parent's media/ dir sits next to the parent, so it gets linked into the
   * batch dir before rendering (best-effort — a failed link surfaces as render's own
   * missing-sample report). */
  linkMediaFrom?: string
  /** Called before each variant render (1-based) — the CLI prints "rendering vN/N...". */
  onProgress?: (i: number, n: number) => void
}

/** Renders v1.beat..vN.beat in outDir to vN.wav each, through cli/render.mjs — dotbeat's own
 * engine driven in headless Chromium (D15). Real-time capture per variant: a batch of N takes
 * ~N x loop-length plus browser startup. */
export function renderVaryBatch(outDir: string, count: number, opts: RenderBatchOptions = {}): void {
  if (opts.linkMediaFrom !== undefined) {
    const parentMedia = resolve(dirname(resolve(opts.linkMediaFrom)), 'media')
    const batchMedia = resolve(outDir, 'media')
    if (existsSync(parentMedia) && !existsSync(batchMedia)) {
      try {
        symlinkSync(parentMedia, batchMedia, 'dir')
      } catch {
        /* best-effort; render will report a missing sample */
      }
    }
  }
  const renderCli = join(repoRoot, 'cli', 'render.mjs')
  for (let i = 0; i < count; i++) {
    opts.onProgress?.(i + 1, count)
    execFileSync(process.execPath, [renderCli, resolve(outDir, `v${i + 1}.beat`), '-o', resolve(outDir, `v${i + 1}.wav`)], {
      stdio: ['ignore', 'ignore', 'inherit'],
    })
  }
}

export interface ScoreEntry {
  t: string
  batch: string
  track: string
  group: string
  amount?: number
  seed: number
  parentSha256: string
  picks: { rank: number; variant: string; recipe?: string; edits?: string[] }[]
  rejected: string[]
}

export interface ScoreBatchResult {
  dir: string
  logPath: string
  manifest: VaryBatchManifest
  ranks: number[]
  entry: ScoreEntry
  isFeel: boolean
}

/** Records 1-3 ranked picks against a batch dir into the append-only scores log — the exact
 * normalization, validation, entry shape, and append `beat score` has always done, shared so
 * `beat_score` can't drift. Picks accept "N" or "vN" (Phase 33 Stream ME, research/96). */
export function scoreBatch(dir: string, picks: string[], logPath: string = DEFAULT_SCORES_LOG): ScoreBatchResult {
  if (picks.length === 0) throw new BeatBatchError('score needs 1-3 ranked picks (variant numbers, best first)')
  if (picks.length > 3) throw new BeatBatchError('at most 3 ranked picks (Edisyn (3,16) pattern — ranking more adds fatigue, not signal)')
  const manifestPath = resolve(dir, 'manifest.json')
  let manifest: VaryBatchManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as VaryBatchManifest
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new BeatBatchError(`no such batch directory or missing manifest.json: ${dir}`)
    throw new BeatBatchError(`could not read ${manifestPath}: ${(err as Error).message}`)
  }
  const ranks = picks.map((p) => {
    // Variants are always DISPLAYED as v1/v2/... (printed summary, manifest, suggest's "adopt"
    // line) but historically had to be REFERENCED as bare integers only. Accept either form,
    // normalizing to the bare integer everywhere below.
    const normalized = /^[vV](\d+)$/.test(p) ? p.slice(1) : p
    const n = Number(normalized)
    if (!Number.isInteger(n) || n < 1 || n > manifest.variants.length) {
      throw new BeatBatchError(`pick "${p}" is not a variant number 1-${manifest.variants.length} (accepts "N" or "vN")`)
    }
    return n
  })
  if (new Set(ranks).size !== ranks.length) throw new BeatBatchError('picks must be distinct')
  // param batches carry replayable `edits`; feel batches carry a `recipe` (the whole variant
  // file IS the result, since humanize isn't a set-replayable edit).
  const isFeel = manifest.group === 'feel'
  const entry: ScoreEntry = {
    t: new Date().toISOString(),
    batch: dir,
    track: manifest.track,
    group: manifest.group,
    amount: manifest.amount,
    seed: manifest.seed,
    parentSha256: manifest.parentSha256,
    picks: ranks.map((n, i) => ({
      rank: i + 1,
      variant: `v${n}.beat`,
      ...(isFeel ? { recipe: manifest.variants[n - 1]!.recipe } : { edits: manifest.variants[n - 1]!.edits }),
    })),
    rejected: manifest.variants.map((_, i) => i + 1).filter((n) => !ranks.includes(n)).map((n) => `v${n}.beat`),
  }
  appendFileSync(logPath, JSON.stringify(entry) + '\n')
  return { dir, logPath, manifest, ranks, entry, isFeel }
}

/** The human-facing summary both surfaces emit after a score: the scored line plus the
 * adopt-the-winner hint (cp for feel batches, `beat set` replay for param batches). */
export function formatScoreResult(r: ScoreBatchResult): string {
  let out = `scored ${r.dir}: ${r.ranks.map((n) => `v${n}`).join(' > ')} -> ${r.logPath}\n`
  if (r.isFeel) out += `to adopt the winner (${r.entry.picks[0]!.recipe}): cp ${resolve(r.dir, `v${r.ranks[0]}.beat`)} ${r.manifest.parent}\n`
  else out += `to adopt the winner: beat set ${r.manifest.parent} ${r.entry.picks[0]!.edits!.join(' ')}\n`
  return out
}
