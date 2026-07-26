// Phase 39 Stream UB — the TypeScript half of the generative-audio sidecar (docs/phase-39-plan.md).
//
// Spawns `python/gen.py` (the Python side, which knows nothing about dotbeat), which GENERATES an
// audio one-shot from a text prompt and writes it to the `--output` path we hand it — the one
// deliberate variation from analyze.py's stdout-only contract (gen produces binary audio, so the
// WAV lands on disk and only a small metadata JSON comes back on stdout). This module owns the
// spawn + the exit-code contract; scripts/source-lib.mjs owns everything downstream (prep,
// registration, the enforced provenance sidecar, rollback). See decisions.md D19.
//
// It reuses resolvePython() and the timeout/maxBuffer constants from sidecar.ts verbatim — one
// interpreter-resolution rule, one degrade vocabulary across both sidecars.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { resolvePython } from './sidecar.js'
import type { StemName } from './stems.js'

// dist/src/analysis/gen.js → repo root is three levels up (analysis → src → dist → root), matching
// sidecar.ts's ANALYZE_PY handling. Kept relative so gen.py's own `pip install -r python/…` fix
// lines are meaningful; spawned with cwd=repoRoot.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const GEN_PY = 'python/gen.py' // relative to repoRoot

const SPAWN_TIMEOUT_MS = 600_000 // matches sidecar.ts / src/mcp/server.ts's execFile prior art
const SPAWN_MAX_BUFFER = 64 * 1024 * 1024

/** The venv setup one-liner surfaced whenever no Python interpreter can be found. */
const VENV_SETUP_HINT =
  'no Python interpreter found. Install the generative backend: ' +
  'python3 -m venv python/.venv && python/.venv/bin/pip install -r python/requirements-stableaudio.txt ' +
  '(or point $BEAT_PYTHON at an interpreter). See python/README.md.'

/** A typed error for the gen path — scripts/source-lib.mjs maps its `.message` to a SourceError so
 * the CLI/MCP surfaces print a clean, stack-trace-free line. Kept local (analyze uses
 * BeatAnalysisError; gen registers via the source pipeline, not the analysis one). */
export class BeatGenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatGenError'
  }
}

export type GenBackend = 'stub' | 'stableaudio' | 'fal'

/** The metadata gen.py prints on stdout (the WAV itself is written to outPath). */
export interface GenMeta {
  backend: string
  provider: string
  model: string | null
  seconds: number
  seed: number
  sampleRate: number
  /** Rights/provenance tags surfaced by the fal adapter table (gen-fal.ts, research/127 §4.2).
   * `watermark` names an inaudible-but-mandatory mark ("synthid" for Google Lyria); undefined for
   * backends that document none. `trainingExcluded` = the provider's ToS bans using outputs to
   * train ML models (ElevenLabs categorical; MiniMax unknown-treat-as-banned) — the taste-training
   * holdout marker, wired into src/taste/eval.ts exactly like the refs-packs exclusion. */
  watermark?: string
  trainingExcluded?: boolean
  /** When the fal adapter downbeat-trimmed a long generation to the requested bar count, the raw
   * (untrimmed) download is kept alongside outPath at this path, and these describe the cut. */
  rawOutPath?: string
  trimOffsetSeconds?: number
  trimmedSeconds?: number
  /** Set when the download was run through Demucs and reduced to ONE stem (src/analysis/stems.ts).
   * The full mix is preserved at `mixPath` so the decision stays auditable and reversible. */
  stemExtract?: GenStemExtract
}

/** What survives a stem extraction into the provenance record (the sidecar's numbers, minus the
 * per-stem table). `stemUsed` differs from `stem` exactly when the near-silence guard fired. */
export interface GenStemExtract {
  stem: string
  stemUsed: string
  model: string
  device: string
  mixRmsDb: number
  keptRmsDb: number
  residualRmsDb: number
  fallback: string | null
  /** the untouched full-mix download, kept beside the stem */
  mixPath: string
}

export interface RunGenOptions {
  prompt: string
  seconds: number
  seed: number
  backend: GenBackend
  outPath: string
  /** fal backend only: the fal model path (defaults to FAL_DEFAULT_PROVIDER). The Python
   * backends ignore it — their provider is baked into gen.py's own metadata. */
  provider?: string
  /** fal backend only: negative prompt, honored by adapters with a real negative_prompt channel
   * (Lyria); silently ignored elsewhere. */
  negativePrompt?: string
  /** fal backend only, OPT-IN: run the download through Demucs and keep only this stem, so a
   * full-mix model (Lyria) still yields a single-instrument clip. Off by default — the existing
   * one-shot/batch callers are byte-unchanged. The Python backends ignore it. */
  stemExtract?: StemName
  /** fal backend only, OPT-IN and given TOGETHER: downbeat-align-trim the generation to `bars` bars
   * at `bpm` (src/analysis/gen-trim.ts, research/127 §4.2). This is why the trim exists — Lyria's
   * fixed 30 s and MiniMax's multi-minute output need cutting, and those are exactly the models
   * `beat source gen --backend fal --provider ...` selects. Until R4-4 these fields were missing
   * from RunGenOptions entirely, so the whole capability was unreachable from the registered
   * `beat source gen` path and only scripts/gen-bakeoff-run.mjs (which calls runGenFal directly)
   * could trim. Off by default, so existing callers are byte-identical; the raw untrimmed download
   * is preserved at `<outPath>.raw.wav` so the cut stays auditable and reversible. */
  bpm?: number
  bars?: number
}

export interface RunGenResult {
  meta: GenMeta
  outPath: string
}

interface SpawnResult {
  code: number | null
  stdout: string
  stderr: string
  enoent: boolean
}

function spawnPython(python: string, args: string[]): Promise<SpawnResult> {
  return new Promise((resolvePromise) => {
    execFile(
      python,
      args,
      { cwd: repoRoot, timeout: SPAWN_TIMEOUT_MS, maxBuffer: SPAWN_MAX_BUFFER },
      (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          resolvePromise({ code: null, stdout, stderr, enoent: true })
        } else if (err) {
          const code = typeof (err as NodeJS.ErrnoException).code === 'number' ? ((err as unknown as { code: number }).code) : 1
          resolvePromise({ code, stdout, stderr, enoent: false })
        } else {
          resolvePromise({ code: 0, stdout, stderr, enoent: false })
        }
      },
    )
  })
}

function lastNonEmptyLine(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
  return lines.length > 0 ? lines[lines.length - 1]! : ''
}

/**
 * Generate an audio one-shot into `outPath` (the Python side writes the file; we read back only the
 * metadata JSON). ENOENT → clean "no Python" error with the venv hint; exit 3 → names the
 * requirements file + `beat source gen --doctor`; any other non-zero → the sidecar's last stderr
 * line. Throws BeatGenError on every failure so source-lib can map it to a SourceError.
 */
export async function runGen(opts: RunGenOptions): Promise<RunGenResult> {
  const { prompt, seconds, seed, backend, outPath } = opts
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    throw new BeatGenError('beat source gen needs a non-empty prompt')
  }
  if (!(seconds > 0)) throw new BeatGenError(`beat source gen: --seconds must be positive, got ${seconds}`)
  if (!Number.isInteger(seed)) throw new BeatGenError(`beat source gen: --seed must be an integer, got ${seed}`)

  // The downbeat trim is fal-only and needs BOTH numbers. Say so loudly rather than accepting a
  // flag and silently doing nothing with it (the class of bug pilot 110 found on --by-type).
  const wantsTrim = opts.bpm !== undefined || opts.bars !== undefined
  if (wantsTrim) {
    if (opts.bpm === undefined || opts.bars === undefined) {
      throw new BeatGenError('beat source gen: --bpm and --bars go together (the downbeat trim needs both to know how long a bar is)')
    }
    if (!(opts.bpm > 0)) throw new BeatGenError(`beat source gen: --bpm must be positive, got ${opts.bpm}`)
    if (!Number.isInteger(opts.bars) || opts.bars < 1) throw new BeatGenError(`beat source gen: --bars must be a positive integer, got ${opts.bars}`)
    if (backend !== 'fal') {
      throw new BeatGenError(`beat source gen: --bpm/--bars trim the hosted download and only apply to --backend fal (got "${backend}") — the local backends generate exactly --seconds of audio`)
    }
  }

  // The hosted backend is pure TS — no Python, no venv, one API round-trip (gen-fal.ts). Same
  // GenMeta contract, so source-lib's prep/provenance pipeline never knows the difference.
  if (backend === 'fal') {
    const { runGenFal } = await import('./gen-fal.js')
    // Only a real fal model path ("owner/model[/sub]") is a provider here — callers pass legacy
    // provider labels like "stable-audio-open" through this field for the Python backends, and
    // those must fall back to fal's default model rather than 404 as a bogus endpoint.
    const provider = opts.provider !== undefined && opts.provider.includes('/') ? opts.provider : undefined
    const meta = await runGenFal({
      prompt,
      seconds,
      seed,
      provider,
      outPath,
      ...(opts.negativePrompt ? { negativePrompt: opts.negativePrompt } : {}),
      ...(opts.stemExtract ? { stemExtract: opts.stemExtract } : {}),
      ...(opts.bpm !== undefined && opts.bars !== undefined ? { bpm: opts.bpm, bars: opts.bars } : {}),
    })
    return { meta, outPath }
  }

  const python = resolvePython()
  const res = await spawnPython(python, [
    GEN_PY,
    '--backend', backend,
    '--prompt', prompt,
    '--seconds', String(seconds),
    '--seed', String(seed),
    '--output', outPath,
  ])

  if (res.enoent) throw new BeatGenError(`${VENV_SETUP_HINT} (tried "${python}")`)
  if (res.code !== 0) {
    const detail = lastNonEmptyLine(res.stderr) || `exit code ${res.code}`
    let message = `beat source gen (${backend}) failed: ${detail}`
    if (res.code === 3) {
      message += ' — run `beat source gen --doctor` to check the Python backends'
      if (backend !== 'stub') message += ', or `--backend stub` for a deterministic dependency-free tone bed'
    }
    throw new BeatGenError(message)
  }

  if (!existsSync(outPath)) {
    throw new BeatGenError(`beat source gen (${backend}) reported success but wrote no file at ${outPath}`)
  }

  let meta: Record<string, unknown>
  try {
    meta = JSON.parse(res.stdout) as Record<string, unknown>
  } catch {
    throw new BeatGenError(`gen sidecar produced non-JSON metadata on stdout: ${res.stdout.slice(0, 200)}`)
  }
  if (typeof meta.backend !== 'string' || meta.backend === '') {
    throw new BeatGenError('gen sidecar metadata missing backend')
  }

  const normalized: GenMeta = {
    backend: meta.backend,
    provider: typeof meta.provider === 'string' ? meta.provider : String(meta.provider ?? ''),
    model: typeof meta.model === 'string' ? meta.model : null,
    seconds: typeof meta.seconds === 'number' ? meta.seconds : seconds,
    seed: typeof meta.seed === 'number' ? meta.seed : seed,
    sampleRate: typeof meta.sampleRate === 'number' ? meta.sampleRate : 44100,
  }
  return { meta: normalized, outPath }
}

/** The doctor report: gen.py's own `--doctor` JSON augmented with the TS-resolved interpreter path
 * and whether python3 was found at all. Never throws — always yields a readable object (mirrors
 * sidecar.ts's sidecarDoctor). */
export async function genDoctor(): Promise<Record<string, unknown>> {
  const python = resolvePython()
  let res: SpawnResult
  try {
    res = await spawnPython(python, [GEN_PY, '--doctor'])
  } catch (e) {
    const { falDoctor } = await import('./gen-fal.js')
    return { pythonFound: false, ...falDoctor(), interpreter: python, error: e instanceof Error ? e.message : String(e) }
  }
  if (res.enoent) {
    const { falDoctor } = await import('./gen-fal.js')
    return {
      pythonFound: false,
      ...falDoctor(),
      interpreter: python,
      error: `no Python interpreter found (tried "${python}"). ${VENV_SETUP_HINT}`,
    }
  }
  if (res.code !== 0) {
    return { pythonFound: true, interpreter: python, error: lastNonEmptyLine(res.stderr) || `--doctor exited ${res.code}` }
  }
  let report: Record<string, unknown>
  try {
    report = JSON.parse(res.stdout) as Record<string, unknown>
  } catch {
    return { pythonFound: true, interpreter: python, error: 'gen sidecar --doctor produced non-JSON output', raw: res.stdout }
  }
  const { falDoctor } = await import('./gen-fal.js')
  return { ...report, ...falDoctor(), interpreter: python, pythonFound: true }
}
