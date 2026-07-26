// The ONE Python-sidecar spawn scaffold (research/130 W1.1, from review finding R4-1).
//
// Before this module, every sidecar wrapper re-declared the same four things: SPAWN_TIMEOUT_MS +
// SPAWN_MAX_BUFFER (8 copies), `interface SpawnResult` (7), `spawnPython` (7 — two pairs of them
// byte-identical after whitespace normalization), `lastNonEmptyLine` (5), `repoRoot`'s
// three-levels-up trick (7), and a `*Doctor()` that spawns `--doctor` and augments the report with
// the resolved interpreter (8). Five separate `resolve*Python()` chains had four env-var names and
// three orderings. Several of the doc comments already CLAIMED to reuse a shared module
// ("reuses resolvePython() and the timeout/maxBuffer constants from sidecar.ts verbatim") — this is
// that module, finally written.
//
// What stays with each sidecar: its PARSE CONTRACT (parseStemResult / parseRoughnessResult /
// validateCA2Payload / validateMidiFigure / the analyze envelope), its typed error class, and its
// setup hint. Those are the parts that differ for real; only the plumbing lives here.
//
// D17 note: the Python side of the contract is unchanged — exit 0/2/3/4, `--doctor`, stdout-only
// JSON, a copy-pasteable `pip install -r python/...` as the last stderr line. This module is the
// TypeScript consumer of that contract, not a change to it.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

/** dist/src/<area>/spawn-sidecar.js → repo root is three levels up (area → src → dist → root).
 * Every sidecar wrapper lives at that same depth (src/analysis/*, src/metrics/*, src/taste/*), so
 * the one constant serves all of them. Sidecars are spawned with cwd=repoRoot and referenced by a
 * RELATIVE script path, so the `pip install -r python/...` fix lines they print stay copy-pasteable. */
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** Matches src/mcp/server.ts's execFile prior art — a model render or a demucs pass can be slow. */
export const SPAWN_TIMEOUT_MS = 600_000
export const SPAWN_MAX_BUFFER = 64 * 1024 * 1024

/** Every failure mode folded into one value — spawnSidecar NEVER rejects, so callers translate a
 * result into their own typed error instead of writing two error paths. */
export interface SpawnResult {
  code: number | null
  stdout: string
  stderr: string
  /** no interpreter at that path at all (the "install a venv" case, distinct from a non-zero exit) */
  enoent: boolean
}

export interface SpawnSidecarOptions {
  /** the interpreter path (from resolvePython) */
  python: string
  /** argv AFTER the interpreter — conventionally [script, ...flags] with a repo-relative script */
  args: readonly string[]
  /** written to the child's stdin and closed; stdin is closed either way (no sidecar reads a
   * never-ending pipe, and EOF is what the stdin-taking ones — surge, ca2 — expect). */
  stdin?: string
  /** defaults to repoRoot; overridable for tests */
  cwd?: string
}

/**
 * Spawn a sidecar and collect its output. Uses `spawn` (not `execFile`) because that is the
 * SUPERSET: it streams stdin for the request-on-stdin sidecars (surge_render, ca2_figures) while
 * behaving identically for the execFile-shaped ones, which simply pass no stdin. Output over
 * SPAWN_MAX_BUFFER reports code 4 (the sidecars' own "failure" exit code) rather than throwing.
 */
export function spawnSidecar(opts: SpawnSidecarOptions): Promise<SpawnResult> {
  const { python, args, stdin, cwd = repoRoot } = opts
  return new Promise((resolvePromise) => {
    let child: ReturnType<typeof spawn>
    try {
      // The timeout is OURS, not spawn's `timeout` option, and that is deliberate: node clears the
      // built-in timer on the child's 'exit' event, which never fires when the interpreter is
      // missing — so an ENOENT left a 10-minute timer armed, holding the whole process open long
      // after the promise settled (measured: a missing-python unit test parked node for 600s).
      // A timer we own is cleared on every settle path AND unref'd, so it can never do that.
      child = spawn(python, [...args], { cwd })
    } catch {
      resolvePromise({ code: null, stdout: '', stderr: '', enoent: true })
      return
    }
    let stdout = ''
    let stderr = ''
    let over = false
    let settled = false
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM') } catch { /* already gone */ }
    }, SPAWN_TIMEOUT_MS)
    timer.unref?.()
    const settle = (res: SpawnResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise(res)
    }
    /** past SPAWN_MAX_BUFFER we stop the child rather than grow the string unbounded (execFile's
     * posture); the reported code is 4, the sidecars' own "failure" exit. */
    const guard = (): void => {
      if (over) return
      over = true
      try { child.kill('SIGTERM') } catch { /* already gone */ }
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => {
      stdout += d
      if (stdout.length > SPAWN_MAX_BUFFER) guard()
    })
    child.stderr?.on('data', (d: string) => {
      stderr += d
      if (stderr.length > SPAWN_MAX_BUFFER) guard()
    })
    child.on('error', (err) => {
      settle({ code: null, stdout, stderr, enoent: (err as NodeJS.ErrnoException).code === 'ENOENT' })
    })
    child.on('close', (code) => {
      settle({ code: over ? 4 : code, stdout, stderr, enoent: false })
    })
    // EPIPE when the sidecar exits before reading stdin — the exit code is the real signal.
    child.stdin?.on('error', () => {})
    child.stdin?.end(stdin ?? '')
  })
}

/** The sidecars' error convention: the LAST non-empty stderr line is the human-facing message (and
 * for exit 3 it is the copy-pasteable `pip install -r python/...` line). */
export function lastNonEmptyLine(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
  return lines.length > 0 ? lines[lines.length - 1]! : ''
}

export interface ResolvePythonOptions {
  /** a sidecar-specific override env var, checked FIRST (e.g. BEAT_STEM_PYTHON) */
  envVar?: string
  /** a dedicated venv directory under `python/`, probed before the shared venv (roughness's
   * venv-roughness — MoSQITo pins numpy<2 against demucs's numpy>=2, python/README.md §venvs) */
  dedicatedVenv?: string
  /** absolute interpreter paths probed after the dedicated venv (ca2's out-of-repo amt-venv) */
  extraCandidates?: readonly string[]
}

/**
 * The ONE interpreter resolver, parameterized where the five hand-forked chains differed:
 *
 *   1. `$<envVar>` when the sidecar has its own override,
 *   2. `<repo>/python/<dedicatedVenv>/bin/python3` when it has a dedicated venv,
 *   3. any `extraCandidates` that exist,
 *   4. `$BEAT_PYTHON` (the shared sidecar interpreter),
 *   5. `<repo>/python/.venv/bin/python3` (the auto-discovered shared venv),
 *   6. `python3` on PATH.
 *
 * A bare `resolvePython()` is steps 4-6 — the base chain analyze/gen/surge/embed/midi_extract use.
 * The resolved value is echoed in every `--doctor` report and degrade message, so which interpreter
 * ran is never a mystery.
 */
export function resolvePython(opts: ResolvePythonOptions = {}): string {
  if (opts.envVar !== undefined) {
    const override = process.env[opts.envVar]
    if (override !== undefined && override.trim() !== '') return override.trim()
  }
  if (opts.dedicatedVenv !== undefined) {
    const dedicated = join(repoRoot, 'python', opts.dedicatedVenv, 'bin', 'python3')
    if (existsSync(dedicated)) return dedicated
  }
  for (const candidate of opts.extraCandidates ?? []) {
    if (existsSync(candidate)) return candidate
  }
  const shared = process.env.BEAT_PYTHON
  if (shared !== undefined && shared.trim() !== '') return shared.trim()
  const venv = join(repoRoot, 'python', '.venv', 'bin', 'python3')
  if (existsSync(venv)) return venv
  return 'python3'
}

export interface SidecarDoctorOptions {
  /** the interpreter to probe; defaults to the base `resolvePython()` chain */
  python?: string
  /** flags after the script; defaults to ['--doctor'] (ca2 passes ['--smoke']) */
  args?: readonly string[]
  /** the sidecar's setup hint, appended to the "no Python interpreter" line */
  hint?: string
  /** fields merged into EVERY branch (e.g. `{ backend: 'surge' }`) */
  base?: Record<string, unknown>
  /** fields merged into the failure branches only (e.g. `{ available: false }`) */
  failure?: Record<string, unknown>
  /** names the sidecar in the non-JSON message; defaults to 'sidecar' */
  label?: string
  /** defaults to repoRoot; overridable for tests */
  cwd?: string
}

/**
 * The generic doctor: spawn `<script> --doctor`, return the sidecar's own JSON augmented with the
 * TS-resolved interpreter and `pythonFound`. NEVER throws — a doctor that can fail is useless,
 * because it is what you run when everything else already failed.
 *
 * Covers analyze / surge / midi_extract / ca2 / roughness exactly. gen, stem_extract and embed keep
 * bespoke doctors (gen merges the hosted-fal report, stem_extract nests under `stemExtract`, embed
 * omits the interpreter) — they still use spawnSidecar + lastNonEmptyLine, which is where the
 * duplication actually was.
 */
export async function sidecarDoctor(script: string, extra: SidecarDoctorOptions = {}): Promise<Record<string, unknown>> {
  const python = extra.python ?? resolvePython()
  const base = extra.base ?? {}
  const failure = { ...base, ...(extra.failure ?? {}), interpreter: python }
  const res = await spawnSidecar({ python, args: [script, ...(extra.args ?? ['--doctor'])], ...(extra.cwd !== undefined ? { cwd: extra.cwd } : {}) })
  if (res.enoent) {
    // "(tried …)" alone when the sidecar has no hint, "(tried …). <hint>" when it does.
    const error = `no Python interpreter found (tried "${python}")` + (extra.hint !== undefined ? `. ${extra.hint}` : '')
    return { ...failure, pythonFound: false, error }
  }
  if (res.code !== 0) {
    return { ...failure, pythonFound: true, error: lastNonEmptyLine(res.stderr) || `--doctor exited ${res.code}` }
  }
  try {
    const report = JSON.parse(res.stdout) as Record<string, unknown>
    return { ...base, ...report, interpreter: python, pythonFound: true }
  } catch {
    return { ...failure, pythonFound: true, error: `${extra.label ?? 'sidecar'} --doctor produced non-JSON output`, raw: res.stdout }
  }
}
