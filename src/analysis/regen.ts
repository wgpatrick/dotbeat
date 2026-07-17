// Phase 40 Stream VC — `beat regen`: rebuild a project's generated media from its provenance
// sidecars alone (docs/phase-40-plan.md §VC item 1).
//
// The claim this makes executable: a fully-generated .beat project is a RECIPE. Every
// `beat source gen` run writes media/<id>.wav.json recording the exact prompt/seed/seconds/backend
// it used, so `media/` is reconstructible from text that's already in git. Clone the repo with an
// empty media/, run `beat regen`, get the song back. On 2026-07-14 this was proven by hand for
// examples/recipe-song's hat_g: regenerating from only the sidecar reproduced the registered file
// byte-for-byte (sha256 93153d1c…, same machine).
//
// HONEST SCOPING — this is the feature, not a caveat on it:
//   - Determinism is verified SAME-MACHINE / SAME-TORCH. Stable Audio Open's output depends on the
//     torch/CUDA/CPU-kernel build underneath it, so a hash mismatch on a different machine is
//     EXPECTED, not corruption. `differs` is never reported as an error or as damage.
//   - Non-generated sidecars (Freesound, local ingest) carry no `generated` block and are simply
//     not regenerable — they're skipped by name, with their source quoted.
//   - Regeneration is SLOW (~2 min per one-shot on CPU, measured 2026-07-14). The count and the
//     estimate are printed BEFORE the run starts, never after.
//
// BOUNDARY (Ordering, docs/phase-40-plan.md): this module only ever *imports* scripts/source-lib.mjs
// — it must not modify it (Stream VB is restructuring ingest() in a parallel worktree). Regeneration
// therefore goes through `addGeneratedSource()` verbatim, which is also what makes the comparison
// meaningful: the registered WAV is the PREPPED one (trim/fade/normalize), so reproducing its hash
// means re-running generation AND prep through the identical path that produced it originally.
//
// Both modes run generation into a throwaway temp project, so `--verify` cannot touch media/ even
// by accident, and a restore only ever copies the finished WAV back. The committed sidecars and the
// .beat file are never rewritten — regen restores the recipe's OUTPUT, it does not re-issue the
// recipe (a fresh `preparedAt` would dirty every sidecar in the repo for no information gain).
//
// Writes nothing to stdout: the CLI and MCP surfaces format these results themselves, the same rule
// scripts/source-lib.mjs follows so the MCP stdio JSON-RPC channel can never be corrupted.

import { existsSync, readFileSync, readdirSync, copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

// dist/src/analysis/regen.js → repo root is three levels up, matching sidecar.ts/gen.ts.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** Measured 2026-07-14 on the owner's CPU: a ~1.5s Stable Audio Open one-shot takes ~2 minutes.
 * The stub backend is stdlib-only and effectively instant. Used only to print an up-front estimate
 * — deliberately coarse, and labelled as an estimate wherever it's shown. */
const SECONDS_PER_ONESHOT: Record<string, number> = { stableaudio: 120, stub: 1, fal: 15 }
const DEFAULT_SECONDS_PER_ONESHOT = 120

/** A typed error for the regen path, so the CLI/MCP surfaces print a clean, stack-trace-free line
 * (BeatGenError/SourceError prior art in gen.ts and source-lib.mjs). */
export class BeatRegenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatRegenError'
  }
}

/** The `generated` block a `beat source gen` sidecar carries — the recipe itself. */
export interface GeneratedProvenance {
  provider: string
  model: string | null
  backend: string
  prompt: string
  seconds: number
  seed: number
  licenseUrl?: string | null
}

/** One sidecar that CAN be regenerated (it has a complete `generated` block). */
export interface RegenPlanEntry {
  id: string
  sidecarPath: string
  wavPath: string
  /** sha256 of the prepped WAV as recorded at registration — what a regen must reproduce. */
  sha256: string
  license: string | null
  generated: GeneratedProvenance
}

/** One sidecar that cannot be regenerated, and why (in the user's vocabulary, not ours). */
export interface RegenSkip {
  id: string
  reason: string
}

export interface RegenPlan {
  beatFile: string
  mediaDir: string
  regenerable: RegenPlanEntry[]
  skipped: RegenSkip[]
}

export type RegenStatus = 'match' | 'differs' | 'error'

export interface RegenSampleResult {
  id: string
  status: RegenStatus
  /** The sha256 recorded in the sidecar. */
  expectedSha256: string
  /** The sha256 the regeneration actually produced (absent when it failed outright). */
  actualSha256?: string
  /** True when the regenerated WAV was written into media/ (restore mode only). */
  restored: boolean
  /** Wall-clock seconds this sample took, so the estimate can be checked against reality. */
  elapsedSeconds: number
  /** Populated for status 'error'. */
  error?: string
}

export interface RegenResult {
  plan: RegenPlan
  results: RegenSampleResult[]
  skipped: RegenSkip[]
  verify: boolean
}

export interface RunRegenOptions {
  beatFile: string
  /** Regenerate only this sample id (errors if it isn't a generated sidecar). */
  id?: string
  /** Regenerate to a temp dir and report hashes WITHOUT touching media/. */
  verify?: boolean
  /** Called as each sample finishes, so a 20-minute run isn't a silent one. */
  onProgress?: (result: RegenSampleResult, index: number, total: number) => void
}

/** Read + shape-check one `media/<id>.wav.json`. A sidecar without a complete `generated` block is
 * not an error — it's a Freesound/local ingest, which is simply not regenerable. */
function readSidecar(sidecarPath: string): { entry?: RegenPlanEntry; skip?: RegenSkip } {
  const id = basename(sidecarPath).replace(/\.wav\.json$/, '')
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(sidecarPath, 'utf8')) as Record<string, unknown>
  } catch (err) {
    return { skip: { id, reason: `unreadable provenance sidecar (${err instanceof Error ? err.message : String(err)})` } }
  }
  const source = typeof raw.source === 'string' ? raw.source : 'unknown source'
  const g = raw.generated as Record<string, unknown> | undefined
  if (!g || typeof g !== 'object') return { skip: { id, reason: `not regenerable — ${source}` } }
  // A `generated` block that's missing any of the three inputs generation actually consumes can't
  // be replayed; say which, rather than silently producing a different sound under the same id.
  const missing: string[] = []
  if (typeof g.prompt !== 'string' || g.prompt === '') missing.push('prompt')
  if (typeof g.seconds !== 'number') missing.push('seconds')
  if (typeof g.seed !== 'number') missing.push('seed')
  if (missing.length > 0) {
    return { skip: { id, reason: `not regenerable — ${source}, but its provenance is missing ${missing.join(', ')}` } }
  }
  if (typeof raw.sha256 !== 'string' || raw.sha256 === '') {
    return { skip: { id, reason: `not regenerable — ${source}, but its provenance records no sha256 to reproduce` } }
  }
  return {
    entry: {
      id,
      sidecarPath,
      wavPath: sidecarPath.replace(/\.json$/, ''),
      sha256: raw.sha256,
      license: typeof raw.license === 'string' ? raw.license : null,
      generated: {
        provider: typeof g.provider === 'string' ? g.provider : 'stable-audio-open',
        model: typeof g.model === 'string' ? g.model : null,
        backend: typeof g.backend === 'string' ? g.backend : 'stableaudio',
        prompt: g.prompt as string,
        seconds: g.seconds as number,
        seed: g.seed as number,
      },
    },
  }
}

/**
 * Walk `media/*.wav.json` beside the .beat and split them into what can and can't be regenerated.
 * Deliberately driven by the SIDECARS, not by the WAVs or the media block: the whole point is that
 * this works on a fresh clone whose media/ is empty, where the sidecars are the only thing left.
 */
export function planRegen(beatFile: string, opts: { id?: string } = {}): RegenPlan {
  if (!beatFile) throw new BeatRegenError('beat regen needs a <file.beat>')
  const abs = resolve(beatFile)
  if (!existsSync(abs)) throw new BeatRegenError(`no .beat file at ${beatFile}`)
  const mediaDir = join(dirname(abs), 'media')
  if (!existsSync(mediaDir)) {
    throw new BeatRegenError(
      `no media/ directory beside ${basename(abs)} — nothing to regenerate. ` +
        `beat regen rebuilds generated media from the provenance sidecars (media/<id>.wav.json) that ` +
        `beat source gen writes; a project with no media/ has no recipe to replay.`,
    )
  }
  const sidecars = readdirSync(mediaDir).filter((f) => f.endsWith('.wav.json')).sort()
  const regenerable: RegenPlanEntry[] = []
  const skipped: RegenSkip[] = []
  for (const f of sidecars) {
    const { entry, skip } = readSidecar(join(mediaDir, f))
    if (entry) regenerable.push(entry)
    else if (skip) skipped.push(skip)
  }
  if (opts.id !== undefined) {
    const wanted = opts.id
    const hit = regenerable.find((e) => e.id === wanted)
    if (!hit) {
      const skip = skipped.find((s) => s.id === wanted)
      // Distinguish "you asked for a sound that can't be replayed" from "you asked for a sound that
      // isn't here" — different fixes, so they must not collapse into one message.
      if (skip) throw new BeatRegenError(`--id ${wanted}: ${skip.reason}`)
      const known = regenerable.map((e) => e.id)
      throw new BeatRegenError(
        `--id ${wanted}: no generated sample with that id in ${mediaDir}` +
          (known.length > 0 ? ` — regenerable ids: ${known.join(', ')}` : ''),
      )
    }
    return { beatFile: abs, mediaDir, regenerable: [hit], skipped: [] }
  }
  return { beatFile: abs, mediaDir, regenerable, skipped }
}

/** Coarse up-front cost estimate in seconds — printed BEFORE a run, never after. */
export function estimateRegenSeconds(entries: RegenPlanEntry[]): number {
  return entries.reduce((sum, e) => sum + (SECONDS_PER_ONESHOT[e.generated.backend] ?? DEFAULT_SECONDS_PER_ONESHOT), 0)
}

/** "~2 min" / "~20 min" / "~45s" — a human duration for the estimate line. */
export function formatDuration(seconds: number): string {
  if (seconds < 90) return `~${Math.max(1, Math.round(seconds))}s`
  return `~${Math.round(seconds / 60)} min`
}

/** The up-front banner: what will run, and what it will cost, before a minute of it is spent. */
export function formatRegenPlan(plan: RegenPlan, verify: boolean): string {
  const n = plan.regenerable.length
  const lines: string[] = []
  const verb = verify ? 'verify' : 'regenerate'
  lines.push(
    `${verb}ing ${n} generated sample${n === 1 ? '' : 's'} from ${basename(plan.beatFile)}'s provenance sidecars ` +
      `— estimated ${formatDuration(estimateRegenSeconds(plan.regenerable))} (~2 min per one-shot on CPU)`,
  )
  if (verify) lines.push('  --verify: regenerating to a temp dir; media/ will NOT be modified')
  for (const s of plan.skipped) lines.push(`  skip ${s.id}: ${s.reason}`)
  return lines.join('\n')
}

/** One sample's regeneration, into a throwaway project so nothing real can be clobbered mid-run.
 * Returns the hash the recipe actually produced this time. */
async function regenOne(
  entry: RegenPlanEntry,
  mediaDir: string,
  beatFile: string,
  verify: boolean,
): Promise<RegenSampleResult> {
  const started = Date.now()
  const elapsed = () => (Date.now() - started) / 1000
  // A throwaway copy of the .beat: addGeneratedSource registers into whatever .beat it's handed, so
  // handing it a copy is what keeps `--verify` structurally incapable of touching the real project.
  const workDir = mkdtempSync(join(tmpdir(), 'beat-regen-'))
  try {
    const tempBeat = join(workDir, basename(beatFile))
    copyFileSync(beatFile, tempBeat)
    const lib = (await import(pathToFileURL(join(repoRoot, 'scripts', 'source-lib.mjs')).href)) as {
      addGeneratedSource: (o: Record<string, unknown>) => Promise<{ sha256: string }>
    }
    let sha256: string
    try {
      ;({ sha256 } = await lib.addGeneratedSource({
        beatFile: tempBeat,
        id: entry.id,
        prompt: entry.generated.prompt,
        seconds: entry.generated.seconds,
        seed: entry.generated.seed,
        backend: entry.generated.backend,
        provider: entry.generated.provider,
        ...(entry.generated.model !== null ? { model: entry.generated.model } : {}),
        ...(entry.license !== null ? { license: entry.license } : {}),
      }))
    } catch (err) {
      return {
        id: entry.id,
        status: 'error',
        expectedSha256: entry.sha256,
        restored: false,
        elapsedSeconds: elapsed(),
        error: err instanceof Error ? err.message : String(err),
      }
    }
    // Restore mode writes the regenerated WAV back even when the hash differs: on a different
    // machine `differs` is the EXPECTED outcome, and a usable sound from the right recipe is the
    // thing the user asked for. The report says plainly which samples differed.
    let restored = false
    if (!verify) {
      mkdirSync(mediaDir, { recursive: true })
      copyFileSync(join(workDir, 'media', `${entry.id}.wav`), join(mediaDir, `${entry.id}.wav`))
      restored = true
    }
    return {
      id: entry.id,
      status: sha256 === entry.sha256 ? 'match' : 'differs',
      expectedSha256: entry.sha256,
      actualSha256: sha256,
      restored,
      elapsedSeconds: elapsed(),
    }
  } finally {
    try { rmSync(workDir, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
}

/**
 * Regenerate a project's generated media from its provenance sidecars. `verify: true` reports
 * per-sample sha256 match/mismatch without writing anything into media/; otherwise each regenerated
 * WAV is restored into media/. Never throws for a `differs` — that's a report, not a failure.
 */
export async function runRegen(opts: RunRegenOptions): Promise<RegenResult> {
  const { beatFile, id, verify = false, onProgress } = opts
  const plan = planRegen(beatFile, { id })
  const results: RegenSampleResult[] = []
  for (let i = 0; i < plan.regenerable.length; i++) {
    const r = await regenOne(plan.regenerable[i]!, plan.mediaDir, plan.beatFile, verify)
    results.push(r)
    onProgress?.(r, i, plan.regenerable.length)
  }
  return { plan, results, skipped: plan.skipped, verify }
}

/** One per-sample line, printable as each result lands (the progress feed) and again in the summary. */
export function formatRegenSample(r: RegenSampleResult): string {
  const short = (h: string) => h.slice(0, 12)
  switch (r.status) {
    case 'match':
      return `  ${r.id}: match (sha256:${short(r.expectedSha256)}…)${r.restored ? ' — restored' : ''}`
    case 'differs':
      // The single most important string in this module. A cross-machine mismatch is expected
      // behaviour of a model that depends on its torch build — reporting it as corruption would
      // teach users to distrust a working recipe.
      return (
        `  ${r.id}: differs (cross-machine reproduction is not guaranteed) — ` +
        `recorded sha256:${short(r.expectedSha256)}…, regenerated sha256:${short(r.actualSha256 ?? '')}…` +
        `${r.restored ? ' — restored anyway (the recipe ran; only the bytes differ)' : ''}`
      )
    case 'error':
      return `  ${r.id}: could not regenerate — ${r.error}`
  }
}

/** The closing summary. Reports `differs` as information, and only genuine failures as errors. */
export function formatRegenResults(res: RegenResult): string {
  const lines: string[] = []
  for (const r of res.results) lines.push(formatRegenSample(r))
  const n = (s: RegenStatus) => res.results.filter((r) => r.status === s).length
  const [matched, differed, errored] = [n('match'), n('differs'), n('error')]
  const parts = [`${matched} match`]
  if (differed > 0) parts.push(`${differed} differ`)
  if (errored > 0) parts.push(`${errored} failed`)
  if (res.skipped.length > 0) parts.push(`${res.skipped.length} not regenerable`)
  lines.push(`${res.verify ? 'verified' : 'regenerated'} ${res.results.length} sample(s): ${parts.join(', ')}`)
  if (differed > 0) {
    lines.push(
      'note: byte-identical regeneration is verified same-machine/same-torch only. A differing hash on ' +
        'another machine (or after a torch upgrade) is expected — the sound is generated from the same ' +
        'recipe, not corrupted.',
    )
  }
  if (res.verify && res.results.length > 0) lines.push('media/ was not modified (--verify). Drop --verify to restore.')
  return lines.join('\n')
}
