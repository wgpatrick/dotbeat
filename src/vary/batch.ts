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
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serialize, type BeatDocument } from '../core/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..') // dist/src/vary -> repo root

/** Where `beat score`/`beat_score` append and `beat suggest`/`beat_suggest` read, absent an override. */
export const DEFAULT_SCORES_LOG = 'beat-scores.jsonl'

// ---- path defaults (Phase 35 Stream OC, pilot 101 medium 4) ----------------------------------
// Batch out-dirs and the scores log used to default relative to the PROCESS cwd — invisible and
// unpredictable for a typical MCP client whose server was launched from who-knows-where, and a
// trap even on the CLI when run from outside the project folder. Both surfaces now default
// relative to the .beat file's own directory (the project IS the folder the .beat sits in — same
// rule beat_sample already applies to media paths). Explicit --out-dir/--log/out_dir/log always
// win, resolved exactly as the caller wrote them.

/** Default batch out-dir: "vary-<group>-<seed>" NEXT TO the parent .beat file, not under the
 * process cwd. Used by `beat vary` and beat_vary whenever no explicit out-dir is given. */
export function defaultBatchDir(parentPath: string, group: string, seed: number): string {
  return resolve(dirname(resolve(parentPath)), `vary-${group}-${seed}`)
}

/** Default scores-log path: beat-scores.jsonl NEXT TO the given .beat file. Used by
 * `beat suggest`/beat_suggest directly, and by scoreBatch (via the batch's manifest parent)
 * whenever no explicit log path is given. */
export function defaultScoresLog(beatFilePath: string): string {
  return resolve(dirname(resolve(beatFilePath)), DEFAULT_SCORES_LOG)
}

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

/** Read + parse a batch dir's manifest.json — shared by scoreBatch and adoptVariant so the
 * missing-batch error text stays identical across every verb that takes a batch dir. */
export function readBatchManifest(dir: string): VaryBatchManifest {
  const manifestPath = resolve(dir, 'manifest.json')
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as VaryBatchManifest
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new BeatBatchError(`no such batch directory or missing manifest.json: ${dir}`)
    throw new BeatBatchError(`could not read ${manifestPath}: ${(err as Error).message}`)
  }
}

/** Normalize one pick ("N" or "vN", Phase 33 Stream ME) to its 1-based variant number,
 * validating against the batch size — shared by scoreBatch and adoptVariant. */
export function normalizePick(pick: string, variantCount: number): number {
  // Variants are always DISPLAYED as v1/v2/... (printed summary, manifest, suggest's "adopt"
  // line) but historically had to be REFERENCED as bare integers only. Accept either form,
  // normalizing to the bare integer everywhere below.
  const normalized = /^[vV](\d+)$/.test(pick) ? pick.slice(1) : pick
  const n = Number(normalized)
  if (!Number.isInteger(n) || n < 1 || n > variantCount) {
    throw new BeatBatchError(`pick "${pick}" is not a variant number 1-${variantCount} (accepts "N" or "vN")`)
  }
  return n
}

/** Resolve a batch manifest's `parent` (stored verbatim as the vary caller referenced it) to an
 * absolute path, from the perspective of a possibly-different later process: absolute paths pass
 * through; a relative path resolves against the cwd if a file exists there, else falls back to
 * the batch dir's own parent directory (where the parent .beat sits by construction under the
 * next-to-the-.beat out-dir default above). */
export function resolveBatchParent(dir: string, manifest: VaryBatchManifest): string {
  if (isAbsolute(manifest.parent)) return manifest.parent
  const fromCwd = resolve(manifest.parent)
  if (existsSync(fromCwd)) return fromCwd
  const fromBatch = resolve(dirname(resolve(dir)), basename(manifest.parent))
  if (existsSync(fromBatch)) return fromBatch
  return fromCwd // let callers report the nonexistence against the most conventional candidate
}

/** Records 1-3 ranked picks against a batch dir into the append-only scores log — the exact
 * normalization, validation, entry shape, and append `beat score` has always done, shared so
 * `beat_score` can't drift. Picks accept "N" or "vN" (Phase 33 Stream ME, research/96). Absent
 * an explicit logPath the log defaults NEXT TO the batch's parent .beat file (Phase 35 OC —
 * not the process cwd), so CLI- and MCP-recorded picks land in the same file regardless of
 * where either process happens to be running. */
export function scoreBatch(dir: string, picks: string[], logPath?: string): ScoreBatchResult {
  if (picks.length === 0) throw new BeatBatchError('score needs 1-3 ranked picks (variant numbers, best first)')
  if (picks.length > 3) throw new BeatBatchError('at most 3 ranked picks (Edisyn (3,16) pattern — ranking more adds fatigue, not signal)')
  const manifest = readBatchManifest(dir)
  const resolvedLog = logPath ?? defaultScoresLog(resolveBatchParent(dir, manifest))
  const ranks = picks.map((p) => normalizePick(p, manifest.variants.length))
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
  appendFileSync(resolvedLog, JSON.stringify(entry) + '\n')
  return { dir, logPath: resolvedLog, manifest, ranks, entry, isFeel }
}

/** The human-facing summary both surfaces emit after a score: the scored line plus the
 * adopt-the-winner hint. Feel batches point at `beat adopt`/beat_adopt (a humanize recipe is not
 * replayable via `beat set`, and pilot 101 showed the old `cp ...` hint was unactionable for an
 * MCP-only agent); param batches keep the `beat set` replay, which survives the parent moving on. */
export function formatScoreResult(r: ScoreBatchResult): string {
  let out = `scored ${r.dir}: ${r.ranks.map((n) => `v${n}`).join(' > ')} -> ${r.logPath}\n`
  if (r.isFeel) out += `to adopt the winner (${r.entry.picks[0]!.recipe}): beat adopt ${r.dir} v${r.ranks[0]} (or the beat_adopt tool)\n`
  else out += `to adopt the winner: beat adopt ${r.dir} v${r.ranks[0]} (or replay just its edits: beat set ${r.manifest.parent} ${r.entry.picks[0]!.edits!.join(' ')})\n`
  return out
}

// ---- adopt (Phase 35 Stream OC, pilot 101 medium 3) -------------------------------------------
// "A feel winner is unadoptable MCP-only": beat_score's old adopt hint for a feel batch was a
// shell `cp` command no MCP tool could perform. adopt copies the picked variant over the batch's
// parent file through a real verb on both surfaces (`beat adopt` / beat_adopt). Writing the file
// is the whole operation — a running daemon watches the file and hot-reloads it into the GUI.

export interface AdoptResult {
  dir: string
  /** 1-based variant number that was adopted. */
  pick: number
  /** Resolved absolute path of the parent file that was overwritten. */
  parentPath: string
  /** True when the parent's sha256 no longer matched the manifest and force overrode the guard. */
  forced: boolean
  recipe?: string
  edits?: string[]
}

/** Copy the picked variant's bytes over the batch's parent .beat file. Data safety: the parent
 * may have moved on since the batch was generated (other edits, another adopt, another session),
 * so if its current sha256 no longer matches the manifest's parentSha256 this REFUSES unless
 * force — adopting a variant grown from a stale parent would silently destroy the newer work. */
export function adoptVariant(dir: string, pick: string, opts: { force?: boolean } = {}): AdoptResult {
  const manifest = readBatchManifest(dir)
  const n = normalizePick(pick, manifest.variants.length)
  const variantPath = resolve(dir, `v${n}.beat`)
  if (!existsSync(variantPath)) throw new BeatBatchError(`v${n}.beat is listed in the manifest but missing from ${dir}`)
  const parentPath = resolveBatchParent(dir, manifest)
  if (!existsSync(parentPath)) {
    throw new BeatBatchError(`cannot find the batch's parent file "${manifest.parent}" (looked at ${parentPath}) — run adopt from the directory vary ran in, or copy the variant by hand`)
  }
  const parentSha = createHash('sha256').update(readFileSync(parentPath, 'utf8')).digest('hex')
  const mismatch = parentSha !== manifest.parentSha256
  if (mismatch && opts.force !== true) {
    throw new BeatBatchError(
      `${parentPath} has changed since this batch was generated (sha256 ${parentSha.slice(0, 12)}... vs the manifest's ${manifest.parentSha256.slice(0, 12)}...) — ` +
        `adopting would overwrite that newer work. Re-vary from the current file, or force the overwrite ("beat adopt ... --force" / beat_adopt force:true)`,
    )
  }
  writeFileSync(parentPath, readFileSync(variantPath, 'utf8'))
  const v = manifest.variants[n - 1]!
  return {
    dir,
    pick: n,
    parentPath,
    forced: mismatch,
    ...(v.recipe !== undefined ? { recipe: v.recipe } : { edits: v.edits ?? [] }),
  }
}

/** The human-facing summary both surfaces emit after an adopt. */
export function formatAdoptResult(r: AdoptResult): string {
  const what = r.recipe ?? (r.edits && r.edits.length > 0 ? r.edits.join(', ') : undefined)
  let out = `adopted v${r.pick} -> ${r.parentPath}${what !== undefined ? ` (${what})` : ''}\n`
  if (r.forced) out += `(forced: the parent had changed since this batch was generated — its newer edits are now overwritten)\n`
  out += `a running daemon/GUI on this file picks the change up automatically; checkpoint to keep it as a version\n`
  return out
}
