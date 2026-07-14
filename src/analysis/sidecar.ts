// Phase 38 Stream SB — the TypeScript half of the audio-analysis sidecar (docs/phase-38-plan.md).
//
// This module spawns `python/analyze.py` (the Python side, which knows nothing about dotbeat),
// takes the analysis CORE it prints on stdout (tempo/beats/downbeats/sections, all in SECONDS),
// and wraps it in the frozen `*.analysis.json` envelope: source{file,sha256,durationSeconds},
// generatedAt, dotbeatAnalysis:1, and a bpm derived from the median inter-beat interval when the
// backend has no tempo of its own (Beat This). It owns ALL file I/O — sha256 caching and an atomic
// temp+rename write — so the Python side never touches the filesystem.
//
// Boundary note: this file does only a LIGHT shape-check on the sidecar's stdout (enough to build
// a well-formed envelope). Full validation authority is SA's `validateAnalysisArtifact` in
// src/analysis/import.ts, invoked when `beat skeleton` reads the file back. We don't duplicate it.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { decodeWav } from '../metrics/index.js'
import { BeatAnalysisError } from './structure.js'

// dist/src/analysis/sidecar.js → repo root is three levels up (analysis → src → dist → root),
// the same trick scripts/source-lib.mjs and src/mcp/server.ts use.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const ANALYZE_PY = 'python/analyze.py' // relative to repoRoot (kept relative so the sidecar's own
// `pip install -r python/…` fix lines are meaningful); spawned with cwd=repoRoot.

const SPAWN_TIMEOUT_MS = 600_000 // matches src/mcp/server.ts's execFile prior art
const SPAWN_MAX_BUFFER = 64 * 1024 * 1024

/** The venv setup one-liner surfaced whenever no Python interpreter can be found. */
const VENV_SETUP_HINT =
  'no Python interpreter found. Install the analysis backend: ' +
  'python3 -m venv python/.venv && python/.venv/bin/pip install -r python/requirements-beatthis.txt ' +
  '(or point $BEAT_PYTHON at an interpreter). See python/README.md.'

/** One section of the detected structure — seconds throughout, bars never appear in this file. */
export interface SidecarSection {
  start: number
  end: number
  label: string | null
}

/** The `*.analysis.json` envelope this module writes (the frozen contract, docs/phase-38-plan.md).
 * SA's import.ts owns the authoritative type + validator; this is the shape we PRODUCE. */
export interface AnalysisArtifact {
  dotbeatAnalysis: 1
  source: { file: string; sha256: string; durationSeconds: number }
  backend: { name: string; version: string; model: string | null }
  generatedAt: string
  bpm: number
  bpmMethod: 'backend' | 'median-ibi'
  beats: number[]
  downbeats: number[]
  sections: SidecarSection[]
}

export type AnalysisBackend = 'stub' | 'beatthis' | 'allin1'

export interface RunAnalysisOptions {
  audioPath: string
  backend: AnalysisBackend
  force?: boolean
  outPath?: string
}

export interface RunAnalysisResult {
  artifact: AnalysisArtifact
  cached: boolean
  outPath: string
}

/**
 * Resolve the Python interpreter, in priority order:
 *   1. `$BEAT_PYTHON` (explicit override),
 *   2. `<repo>/python/.venv/bin/python3` if it exists (the auto-discovered venv),
 *   3. `python3` on PATH.
 * The resolved value is echoed in `--doctor` output and in degrade messages so it's never a mystery.
 */
export function resolvePython(): string {
  const override = process.env.BEAT_PYTHON
  if (override && override.trim() !== '') return override.trim()
  const venv = join(repoRoot, 'python', '.venv', 'bin', 'python3')
  if (existsSync(venv)) return venv
  return 'python3'
}

/** The default `*.analysis.json` sits beside the audio: `<dir>/<basename-without-ext>.analysis.json`. */
export function defaultAnalysisPath(audioPath: string): string {
  const abs = resolve(audioPath)
  const base = basename(abs).replace(/\.[^./\\]+$/, '')
  return join(dirname(abs), `${base}.analysis.json`)
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

/** bpm from the median inter-beat interval — used when the backend reports no tempo (Beat This). */
function deriveBpmFromBeats(beats: number[]): number {
  if (beats.length < 2) {
    throw new BeatAnalysisError('cannot derive tempo: the backend returned no bpm and fewer than 2 beats')
  }
  const ibis: number[] = []
  for (let i = 1; i < beats.length; i++) ibis.push(beats[i]! - beats[i - 1]!)
  ibis.sort((a, b) => a - b)
  const mid = Math.floor(ibis.length / 2)
  const median = ibis.length % 2 === 1 ? ibis[mid]! : (ibis[mid - 1]! + ibis[mid]!) / 2
  if (!(median > 0)) throw new BeatAnalysisError('cannot derive tempo: non-positive median inter-beat interval')
  return 60 / median
}

function asFiniteNumberArray(value: unknown, what: string): number[] {
  if (!Array.isArray(value) || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new BeatAnalysisError(`sidecar returned a malformed ${what} array`)
  }
  return value as number[]
}

/**
 * Run the sidecar (or return a cached artifact) and write the `*.analysis.json` envelope.
 *
 * Cache: before spawning, if the target file exists, parses, its `source.sha256` matches the
 * current audio bytes AND its `backend.name` matches the requested backend, it's returned with
 * `cached: true` (nothing is spawned). `force` bypasses the cache.
 */
export async function runAnalysis(opts: RunAnalysisOptions): Promise<RunAnalysisResult> {
  const { audioPath, backend, force = false } = opts
  const abs = resolve(audioPath)
  if (!existsSync(abs)) throw new BeatAnalysisError(`audio file not found: ${audioPath}`)
  if (!/\.wav$/i.test(abs)) {
    throw new BeatAnalysisError(
      `beat analyze reads 16-bit PCM WAV this phase — convert ${basename(audioPath)} first ` +
        `(e.g. ffmpeg -i "${basename(audioPath)}" out.wav), then analyze out.wav.`,
    )
  }
  const outPath = opts.outPath ?? defaultAnalysisPath(abs)

  // Hash the real audio bytes — this is the cache key and the artifact's source.sha256.
  const bytes = readFileSync(abs)
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  if (!force && existsSync(outPath)) {
    try {
      const prev = JSON.parse(readFileSync(outPath, 'utf8')) as AnalysisArtifact
      if (prev?.source?.sha256 === sha256 && prev?.backend?.name === backend) {
        return { artifact: prev, cached: true, outPath }
      }
    } catch {
      // Unparseable/stale cache file — fall through and re-analyze, overwriting it.
    }
  }

  // durationSeconds via the pure-JS WAV decoder (also our earliest signal the file is a usable WAV).
  let durationSeconds: number
  try {
    durationSeconds = decodeWav(bytes).durationSeconds
  } catch (e) {
    throw new BeatAnalysisError(`could not read WAV duration from ${basename(audioPath)}: ${e instanceof Error ? e.message : String(e)}`)
  }

  const python = resolvePython()
  const res = await spawnPython(python, [ANALYZE_PY, '--backend', backend, '--input', abs])

  if (res.enoent) throw new BeatAnalysisError(`${VENV_SETUP_HINT} (tried "${python}")`)
  if (res.code !== 0) {
    const detail = lastNonEmptyLine(res.stderr) || `exit code ${res.code}`
    let message = `beat analyze (${backend}) failed: ${detail}`
    if (res.code === 3) message += ' — run `beat analyze --doctor` to check the Python backends'
    throw new BeatAnalysisError(message)
  }

  let core: Record<string, unknown>
  try {
    core = JSON.parse(res.stdout) as Record<string, unknown>
  } catch {
    throw new BeatAnalysisError(`sidecar produced non-JSON on stdout: ${res.stdout.slice(0, 200)}`)
  }

  // Light shape-check (SA's validator does the full pass on read-back).
  const backendObj = core.backend as { name?: unknown; version?: unknown; model?: unknown } | undefined
  if (!backendObj || typeof backendObj.name !== 'string' || backendObj.name === '') {
    throw new BeatAnalysisError('sidecar output missing backend.name')
  }
  const beats = asFiniteNumberArray(core.beats, 'beats')
  const downbeats = asFiniteNumberArray(core.downbeats, 'downbeats')
  if (!Array.isArray(core.sections)) throw new BeatAnalysisError('sidecar output missing sections array')
  const sections: SidecarSection[] = (core.sections as unknown[]).map((s) => {
    const sec = s as { start?: unknown; end?: unknown; label?: unknown }
    if (typeof sec.start !== 'number' || typeof sec.end !== 'number') {
      throw new BeatAnalysisError('sidecar returned a malformed section (start/end must be numbers)')
    }
    return { start: sec.start, end: sec.end, label: typeof sec.label === 'string' ? sec.label : null }
  })

  let bpm: number
  let bpmMethod: 'backend' | 'median-ibi'
  if (core.bpm === null || core.bpm === undefined) {
    bpm = deriveBpmFromBeats(beats)
    bpmMethod = 'median-ibi'
  } else if (typeof core.bpm === 'number' && Number.isFinite(core.bpm)) {
    bpm = core.bpm
    bpmMethod = 'backend'
  } else {
    throw new BeatAnalysisError('sidecar returned a non-numeric, non-null bpm')
  }

  const artifact: AnalysisArtifact = {
    dotbeatAnalysis: 1,
    // source.file records the path as given at analyze time (relative allowed) — see the contract.
    source: { file: audioPath, sha256, durationSeconds },
    backend: {
      name: backendObj.name,
      version: typeof backendObj.version === 'string' ? backendObj.version : String(backendObj.version ?? ''),
      model: typeof backendObj.model === 'string' ? backendObj.model : null,
    },
    generatedAt: new Date().toISOString(),
    bpm,
    bpmMethod,
    beats,
    downbeats,
    sections,
  }

  // Atomic write: temp file in the same directory, then rename (rename is atomic on the same fs).
  const tmp = `${outPath}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, JSON.stringify(artifact, null, 2) + '\n')
  renameSync(tmp, outPath)

  return { artifact, cached: false, outPath }
}

/** The doctor report: the sidecar's own `--doctor` JSON augmented with the TS-resolved interpreter
 * path and whether python3 was found at all. Never throws — always yields a readable object. */
export async function sidecarDoctor(): Promise<Record<string, unknown>> {
  const python = resolvePython()
  let res: SpawnResult
  try {
    res = await spawnPython(python, [ANALYZE_PY, '--doctor'])
  } catch (e) {
    return { pythonFound: false, interpreter: python, error: e instanceof Error ? e.message : String(e) }
  }
  if (res.enoent) {
    return {
      pythonFound: false,
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
    return { pythonFound: true, interpreter: python, error: 'sidecar --doctor produced non-JSON output', raw: res.stdout }
  }
  return { ...report, interpreter: python, pythonFound: true }
}
