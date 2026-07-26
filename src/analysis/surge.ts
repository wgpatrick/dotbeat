// The TypeScript half of the Surge XT render sidecar (source-showdown probe B1, research 114 §7).
//
// Spawns `python/surge_render.py` (which knows nothing about dotbeat): it renders a note sequence
// through a Surge XT factory patch and writes a WAV to a path we give it. Three modes — --doctor
// (surgepy availability + factory path + patch count), --list-patches (the factory catalogue for
// the TS-side seeded pick), and a render (the request JSON goes in on STDIN, a small metadata doc
// comes back on stdout). This module owns the spawn + the exit-code contract; the CLI owns patch
// selection (showdown.ts pickSurgePatch) and the clip pipeline. The spawn scaffold is
// ./spawn-sidecar.ts — and this file's stdin-streaming spawn is the variant that became the shared
// one, since request-on-stdin is the superset every other sidecar's execFile shape fits inside.

import { existsSync } from 'node:fs'
import { lastNonEmptyLine, resolvePython, sidecarDoctor as runSidecarDoctor, spawnSidecar } from './spawn-sidecar.js'
import type { SurgePatch, SurgeNote } from '../taste/showdown.js'

const SURGE_PY = 'python/surge_render.py' // relative to the repo root; spawned with cwd=repoRoot so
// the sidecar's own `pip`/build hint lines resolve relative paths meaningfully.

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
  /** Track 1a: normalized (0..1) param overrides applied to the patch before notes play. */
  overrides?: { param: string; value: number }[]
}

export interface SurgeRenderMeta {
  backend: string
  patch: string
  patchName: string
  category: string
  notes: number
  /** the resolved Surge param names the overrides landed on (sidecar echoes these back). */
  overrides: string[]
  sampleRate: number
  seconds: number
  output: string
}

/** The doctor report: surge_render.py's own `--doctor` JSON augmented with the resolved interpreter
 * path and whether python3 was found at all. Never throws — always yields a readable object
 * (mirrors genDoctor / sidecarDoctor). */
export async function surgeDoctor(): Promise<Record<string, unknown>> {
  // `surgepy: { available: false }` rides every failure branch so surgeAvailable() reads false
  // rather than undefined — including the non-JSON branch, which used to omit it.
  return runSidecarDoctor(SURGE_PY, {
    hint: SURGE_SETUP_HINT,
    label: 'surge sidecar',
    base: { backend: 'surge' },
    failure: { surgepy: { available: false } },
  })
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
  const res = await spawnSidecar({ python, args: [SURGE_PY, '--list-patches'] })
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
  const stdin = JSON.stringify({ patch: req.patch, notes: req.notes, overrides: req.overrides ?? [], sampleRate: req.sampleRate, output: req.outPath })
  const res = await spawnSidecar({ python, args: [SURGE_PY], stdin })

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
    overrides: Array.isArray(meta.overrides) ? (meta.overrides as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    sampleRate: typeof meta.sampleRate === 'number' ? meta.sampleRate : req.sampleRate,
    seconds: typeof meta.seconds === 'number' ? meta.seconds : 0,
    output: typeof meta.output === 'string' ? meta.output : req.outPath,
  }
  return { meta: normalized, outPath: req.outPath }
}
