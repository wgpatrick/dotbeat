// The TypeScript half of the Surge XT render sidecar (source-showdown probe B1, research 114 §7).
//
// Spawns `python/surge_render.py` (which knows nothing about dotbeat): it renders a note sequence
// through a Surge XT factory patch and writes a WAV to a path we give it. Three modes — --doctor
// (surgepy availability + factory path + patch count), --list-patches (the factory catalogue for
// the TS-side seeded pick), and a render (the request JSON goes in on STDIN, a small metadata doc
// comes back on stdout). This module owns the spawn + the exit-code contract; the CLI owns patch
// selection (showdown.ts pickSurgePatch) and the clip pipeline. Reuses resolvePython() and the
// timeout/maxBuffer constants from sidecar.ts verbatim — one interpreter rule across all sidecars.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { resolvePython } from './sidecar.js'
import type { SurgePatch, SurgeNote } from '../taste/showdown.js'

// dist/src/analysis/surge.js → repo root is three levels up (analysis → src → dist → root),
// matching gen.ts/sidecar.ts. Spawned with cwd=repoRoot so the sidecar's own `pip`/build hint
// lines resolve relative paths meaningfully.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const SURGE_PY = 'python/surge_render.py' // relative to repoRoot

const SPAWN_TIMEOUT_MS = 600_000 // matches sidecar.ts / gen.ts
const SPAWN_MAX_BUFFER = 64 * 1024 * 1024

/** Surfaced whenever no Python interpreter (or no surgepy) is found. surgepy has no wheel — it is
 * a source-build artifact of Surge XT; the sidecar's own exit-3 stderr carries the full build
 * one-liner, so this is the short form. */
const SURGE_SETUP_HINT =
  'Surge render needs surgepy (a source-build of Surge XT — no PyPI wheel). ' +
  'Run `beat showdown --surge-doctor` for the exact build steps, or see python/README.md.'

/** A typed error for the surge path so the CLI can print a clean, stack-trace-free line. */
export class BeatSurgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatSurgeError'
  }
}

export interface SurgeRenderRequest {
  patch: string
  notes: SurgeNote[]
  sampleRate: number
  outPath: string
}

export interface SurgeRenderMeta {
  backend: string
  patch: string
  patchName: string
  category: string
  notes: number
  sampleRate: number
  seconds: number
  output: string
}

interface SpawnResult {
  code: number | null
  stdout: string
  stderr: string
  enoent: boolean
}

/** spawn (not execFile) so the render request can be streamed in on stdin; --doctor/--list-patches
 * pass an empty stdin. Never rejects — every failure mode is folded into the SpawnResult. */
function spawnPython(python: string, args: string[], stdin: string): Promise<SpawnResult> {
  return new Promise((resolvePromise) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(python, args, { cwd: repoRoot, timeout: SPAWN_TIMEOUT_MS })
    } catch {
      resolvePromise({ code: null, stdout: '', stderr: '', enoent: true })
      return
    }
    let stdout = ''
    let stderr = ''
    let over = false
    child.stdout?.on('data', (d) => {
      stdout += d
      if (stdout.length > SPAWN_MAX_BUFFER) over = true
    })
    child.stderr?.on('data', (d) => {
      stderr += d
      if (stderr.length > SPAWN_MAX_BUFFER) over = true
    })
    child.on('error', (err) => {
      resolvePromise({ code: null, stdout, stderr, enoent: (err as NodeJS.ErrnoException).code === 'ENOENT' })
    })
    child.on('close', (code) => {
      resolvePromise({ code: over ? 4 : code, stdout, stderr, enoent: false })
    })
    child.stdin?.on('error', () => { /* EPIPE if the sidecar exits before reading stdin — the exit code is the signal */ })
    child.stdin?.end(stdin)
  })
}

function lastNonEmptyLine(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
  return lines.length > 0 ? lines[lines.length - 1]! : ''
}

/** The doctor report: surge_render.py's own `--doctor` JSON augmented with the resolved interpreter
 * path and whether python3 was found at all. Never throws — always yields a readable object
 * (mirrors genDoctor / sidecarDoctor). */
export async function surgeDoctor(): Promise<Record<string, unknown>> {
  const python = resolvePython()
  const res = await spawnPython(python, [SURGE_PY, '--doctor'], '')
  if (res.enoent) {
    return { backend: 'surge', pythonFound: false, surgepy: { available: false }, interpreter: python, error: `no Python interpreter found (tried "${python}"). ${SURGE_SETUP_HINT}` }
  }
  if (res.code !== 0) {
    return { backend: 'surge', pythonFound: true, surgepy: { available: false }, interpreter: python, error: lastNonEmptyLine(res.stderr) || `--doctor exited ${res.code}` }
  }
  let report: Record<string, unknown>
  try {
    report = JSON.parse(res.stdout) as Record<string, unknown>
  } catch {
    return { backend: 'surge', pythonFound: true, interpreter: python, error: 'surge sidecar --doctor produced non-JSON output', raw: res.stdout }
  }
  return { ...report, interpreter: python, pythonFound: true }
}

/** True iff the sidecar reports surgepy available (used by the CLI to decide whether to add a
 * surge clip at all). Reads the doctor report defensively. */
export function surgeAvailable(doctorReport: Record<string, unknown>): boolean {
  const s = doctorReport.surgepy
  return typeof s === 'object' && s !== null && (s as { available?: unknown }).available === true
}

/** List the factory patch catalogue for the TS-side seeded pick. Throws BeatSurgeError on any
 * failure (surgepy missing, non-JSON, bad shape) so the CLI can warn + skip surge cleanly. */
export async function listSurgePatches(): Promise<SurgePatch[]> {
  const python = resolvePython()
  const res = await spawnPython(python, [SURGE_PY, '--list-patches'], '')
  if (res.enoent) throw new BeatSurgeError(`${SURGE_SETUP_HINT} (tried "${python}")`)
  if (res.code !== 0) {
    const detail = lastNonEmptyLine(res.stderr) || `exit code ${res.code}`
    throw new BeatSurgeError(`surge --list-patches failed: ${detail}`)
  }
  let parsed: { patches?: unknown }
  try {
    parsed = JSON.parse(res.stdout) as { patches?: unknown }
  } catch {
    throw new BeatSurgeError(`surge --list-patches produced non-JSON: ${res.stdout.slice(0, 200)}`)
  }
  if (!Array.isArray(parsed.patches)) throw new BeatSurgeError('surge --list-patches returned no patches array')
  return parsed.patches
    .filter((p): p is SurgePatch => !!p && typeof (p as SurgePatch).name === 'string' && typeof (p as SurgePatch).category === 'string' && typeof (p as SurgePatch).path === 'string')
    .map((p) => ({ name: p.name, category: p.category, path: p.path }))
}

/** Render `req.notes` through `req.patch`, writing a WAV to `req.outPath`; returns the sidecar's
 * metadata. Throws BeatSurgeError on every failure so the CLI's per-batch try/catch degrades to a
 * warning-and-skip (never breaks the batch). */
export async function runSurgeRender(req: SurgeRenderRequest): Promise<{ meta: SurgeRenderMeta; outPath: string }> {
  if (!req.patch) throw new BeatSurgeError('surge render needs a patch path')
  if (!req.notes || req.notes.length === 0) throw new BeatSurgeError('surge render needs at least one note')
  if (!(req.sampleRate > 0)) throw new BeatSurgeError(`surge render: sampleRate must be positive, got ${req.sampleRate}`)

  const python = resolvePython()
  const stdin = JSON.stringify({ patch: req.patch, notes: req.notes, sampleRate: req.sampleRate, output: req.outPath })
  const res = await spawnPython(python, [SURGE_PY], stdin)

  if (res.enoent) throw new BeatSurgeError(`${SURGE_SETUP_HINT} (tried "${python}")`)
  if (res.code !== 0) {
    const detail = lastNonEmptyLine(res.stderr) || `exit code ${res.code}`
    let message = `surge render failed: ${detail}`
    if (res.code === 3) message += ' — run `beat showdown --surge-doctor` (surgepy is a source-build of Surge XT, no wheel)'
    throw new BeatSurgeError(message)
  }
  if (!existsSync(req.outPath)) throw new BeatSurgeError(`surge render reported success but wrote no file at ${req.outPath}`)

  let meta: Record<string, unknown>
  try {
    meta = JSON.parse(res.stdout) as Record<string, unknown>
  } catch {
    throw new BeatSurgeError(`surge sidecar produced non-JSON metadata: ${res.stdout.slice(0, 200)}`)
  }
  const normalized: SurgeRenderMeta = {
    backend: typeof meta.backend === 'string' ? meta.backend : 'surge',
    patch: typeof meta.patch === 'string' ? meta.patch : req.patch,
    patchName: typeof meta.patchName === 'string' ? meta.patchName : '',
    category: typeof meta.category === 'string' ? meta.category : '',
    notes: typeof meta.notes === 'number' ? meta.notes : req.notes.length,
    sampleRate: typeof meta.sampleRate === 'number' ? meta.sampleRate : req.sampleRate,
    seconds: typeof meta.seconds === 'number' ? meta.seconds : 0,
    output: typeof meta.output === 'string' ? meta.output : req.outPath,
  }
  return { meta: normalized, outPath: req.outPath }
}
