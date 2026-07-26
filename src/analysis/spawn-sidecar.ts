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
import { spawn, type ChildProcess } from 'node:child_process'

/** dist/src/<area>/spawn-sidecar.js → repo root is three levels up (area → src → dist → root).
 * Every sidecar wrapper lives at that same depth (src/analysis/*, src/metrics/*, src/taste/*), so
 * the one constant serves all of them. Sidecars are spawned with cwd=repoRoot and referenced by a
 * RELATIVE script path, so the `pip install -r python/...` fix lines they print stay copy-pasteable. */
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** Matches src/mcp/server.ts's execFile prior art — a model render or a demucs pass can be slow. */
export const SPAWN_TIMEOUT_MS = 600_000
export const SPAWN_MAX_BUFFER = 64 * 1024 * 1024

/**
 * How long we keep draining stdout/stderr AFTER the child's own `exit` before answering anyway.
 *
 * The settle path used to be the `close` event, which fires at stdio EOF — and stdio EOF needs
 * every holder of the pipe to let go, not just the child. torch and demucs both fork workers that
 * INHERIT stdout, so a sidecar that exited at 1.0s left the promise parked until its last worker
 * died at 10.1s (measured, 2026-07-26). That is the owner's "python sidecar at 0% CPU while the
 * caller waits forever" hang. So we settle on `exit` instead, with this grace window for output
 * still in flight — and the window RESTARTS on every chunk, so a big payload still drains fully
 * while a silent inherited pipe costs only this much.
 */
export const SPAWN_DRAIN_MS = 250

/** SIGTERM → SIGKILL escalation window. A child that traps SIGTERM (or whose workers hold the
 * pipe) used to survive our only kill attempt forever; nothing survives this. */
export const SPAWN_KILL_GRACE_MS = 5_000

// ---- process-group lifecycle -------------------------------------------------------------------
//
// Sidecars are spawned DETACHED, in their own process group, and every kill targets the GROUP
// (negative pid) rather than the direct child — because the thing that actually burns CPU is
// usually a multiprocessing worker, not the interpreter we spawned. Detaching costs one thing:
// the child no longer receives the terminal's Ctrl-C along with us, so we have to clean up
// ourselves, which is what this registry is for. Before it, a Ctrl-C'd `beat analyze` / `beat
// source gen`, a daemon restart, or a killed MCP server left the model render running — the hunt
// caught a real orphaned model.py at 370% CPU with eight forks, from a session that was long gone.

const live = new Set<ChildProcess>()
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number]

/** Signal a child's whole process group; never throws (the group is routinely already gone).
 * POSIX keeps a pid reserved while it is a live group's pgid, so `-pid` can never name someone
 * else's group as long as any member is alive. */
function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  const pid = child.pid
  if (pid === undefined) return
  try {
    // win32 has no process groups in this sense; `detached` there means a new console.
    if (process.platform === 'win32') child.kill(signal)
    else process.kill(-pid, signal)
  } catch { /* already gone, or never started */ }
}

function killAllLive(): void {
  for (const child of live) killGroup(child, 'SIGKILL')
  live.clear()
}

const handlers = new Map<string, () => void>()

/** Installed on the FIRST live sidecar and removed with the last, so a process that never spawns
 * one keeps node's stock signal behaviour exactly. */
function installShutdownHooks(): void {
  if (handlers.size > 0) return
  const onExit = (): void => { killAllLive() }
  process.on('exit', onExit)
  handlers.set('exit', onExit)
  for (const sig of SHUTDOWN_SIGNALS) {
    const onSignal = (): void => {
      killAllLive()
      // If we are the ONLY listener, our handler has suppressed node's default (terminate) — so
      // put the default back and re-raise, preserving the standard 128+n status. If the host app
      // has its own handler (the daemon's graceful shutdown), we killed the children and stay out
      // of its way.
      if (process.listenerCount(sig) <= 1) {
        process.removeListener(sig, onSignal)
        process.kill(process.pid, sig)
      }
    }
    process.on(sig, onSignal)
    handlers.set(sig, onSignal)
  }
}

function removeShutdownHooks(): void {
  for (const [name, fn] of handlers) process.removeListener(name as ShutdownSignal | 'exit', fn)
  handlers.clear()
}

function register(child: ChildProcess): void {
  installShutdownHooks()
  live.add(child)
}

function unregister(child: ChildProcess): void {
  live.delete(child)
  if (live.size === 0) removeShutdownHooks()
}

/** Test seam: how many sidecars this process still has running. */
export function liveSidecarCount(): number {
  return live.size
}

/** Every failure mode folded into one value — spawnSidecar NEVER rejects, so callers translate a
 * result into their own typed error instead of writing two error paths. */
export interface SpawnResult {
  code: number | null
  stdout: string
  stderr: string
  /** no interpreter at that path at all (the "install a venv" case, distinct from a non-zero exit) */
  enoent: boolean
  /** we gave up and killed the process group; `code` is 4 and the last stderr line says so. */
  timedOut?: boolean
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
  /** defaults to SPAWN_TIMEOUT_MS; overridable so the timeout path is testable in milliseconds
   * instead of ten minutes. */
  timeoutMs?: number
}

/**
 * Spawn a sidecar and collect its output. Uses `spawn` (not `execFile`) because that is the
 * SUPERSET: it streams stdin for the request-on-stdin sidecars (surge_render, ca2_figures) while
 * behaving identically for the execFile-shaped ones, which simply pass no stdin. Output over
 * SPAWN_MAX_BUFFER reports code 4 (the sidecars' own "failure" exit code) rather than throwing.
 *
 * Lifecycle guarantees (2026-07-26 — three confirmed hangs, see the constants above):
 *   1. It settles when the CHILD exits, not when its inherited pipes close, so a forked worker
 *      cannot park the caller behind it.
 *   2. It ALWAYS settles. The timeout kills the group and answers immediately, whatever the child
 *      does about the signal; the kill escalates SIGTERM → SIGKILL on its own.
 *   3. It never leaves a render running behind a dead parent: the child owns a process group we
 *      kill as a unit, and the parent's exit path kills every still-live group.
 */
export function spawnSidecar(opts: SpawnSidecarOptions): Promise<SpawnResult> {
  const { python, args, stdin, cwd = repoRoot, timeoutMs = SPAWN_TIMEOUT_MS } = opts
  return new Promise((resolvePromise) => {
    let child: ChildProcess
    try {
      // The timeout is OURS, not spawn's `timeout` option, and that is deliberate: node clears the
      // built-in timer on the child's 'exit' event, which never fires when the interpreter is
      // missing — so an ENOENT left a 10-minute timer armed, holding the whole process open long
      // after the promise settled (measured: a missing-python unit test parked node for 600s).
      // A timer we own is cleared on every settle path AND unref'd, so it can never do that.
      // `detached` puts the sidecar in its own process group; see the registry above for why.
      child = spawn(python, [...args], { cwd, detached: process.platform !== 'win32' })
    } catch {
      resolvePromise({ code: null, stdout: '', stderr: '', enoent: true })
      return
    }
    register(child)
    let stdout = ''
    let stderr = ''
    let over = false
    let settled = false
    let exited = false
    let exitCode: number | null = null
    let drainTimer: ReturnType<typeof setTimeout> | undefined

    /** SIGTERM the whole group, then SIGKILL it if anything is still there. Unref'd: escalation
     * must never be the reason node stays alive. */
    const terminateGroup = (): void => {
      killGroup(child, 'SIGTERM')
      const escalate = setTimeout(() => killGroup(child, 'SIGKILL'), SPAWN_KILL_GRACE_MS)
      escalate.unref?.()
    }

    const finish = (res: SpawnResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(drainTimer)
      // Let go of the pipes. If a worker inherited stdout, these handles would otherwise keep the
      // node event loop alive for as long as it lives — the promise would be answered and the
      // process still would not exit.
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.stdin?.destroy()
      resolvePromise(res)
    }

    const timer = setTimeout(() => {
      terminateGroup()
      // Settle NOW. Previously the timeout only sent one SIGTERM to the direct child and waited
      // for `close`, so a child that trapped SIGTERM — or whose workers held the pipe — meant the
      // promise never resolved at all (measured: never, at any duration).
      const note = `sidecar timed out after ${Math.round(timeoutMs / 1000)}s and was killed`
      finish({ code: 4, stdout, stderr: stderr === '' ? note + '\n' : `${stderr}\n${note}\n`, enoent: false, timedOut: true })
    }, timeoutMs)
    timer.unref?.()

    /** past SPAWN_MAX_BUFFER we stop the child rather than grow the string unbounded (execFile's
     * posture); the reported code is 4, the sidecars' own "failure" exit. Same posture as the
     * timeout: kill the group and answer, rather than hope the child cooperates. */
    const guard = (): void => {
      if (over) return
      over = true
      terminateGroup()
      finish({ code: 4, stdout, stderr, enoent: false })
    }

    /** Arm (or re-arm) the post-exit drain window. Restarted by every chunk, so output still
     * arriving keeps draining and only SILENCE past SPAWN_DRAIN_MS ends it. */
    const armDrain = (): void => {
      clearTimeout(drainTimer)
      drainTimer = setTimeout(() => {
        // The child is gone but its stdout is still open: something it forked inherited the pipe
        // and outlived it. Answer the caller, and reap the stray — after the process we spawned
        // has exited, anything left in its group is a leaked worker by definition.
        terminateGroup()
        finish({ code: over ? 4 : exitCode, stdout, stderr, enoent: false })
      }, SPAWN_DRAIN_MS)
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => {
      stdout += d
      if (stdout.length > SPAWN_MAX_BUFFER) guard()
      else if (exited) armDrain()
    })
    child.stderr?.on('data', (d: string) => {
      stderr += d
      if (stderr.length > SPAWN_MAX_BUFFER) guard()
      else if (exited) armDrain()
    })
    child.on('error', (err) => {
      unregister(child)
      finish({ code: null, stdout, stderr, enoent: (err as NodeJS.ErrnoException).code === 'ENOENT' })
    })
    child.on('exit', (code) => {
      unregister(child)
      exited = true
      exitCode = code
      armDrain()
    })
    // The happy path: stdio hit EOF too, so there is nothing left to wait for.
    child.on('close', (code) => {
      finish({ code: over ? 4 : (code ?? exitCode), stdout, stderr, enoent: false })
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
