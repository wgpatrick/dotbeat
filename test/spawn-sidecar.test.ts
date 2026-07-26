// The shared sidecar spawn scaffold (src/analysis/spawn-sidecar.ts, research/130 W1.1 / R4-1).
//
// The eight sidecar wrappers are covered by their own files; this one pins the SCAFFOLD they now
// share — the exit-code/ENOENT/stdin plumbing, the one parameterized interpreter resolver (which
// has to reproduce all five hand-forked chains exactly), and the generic doctor's never-throws
// contract. It uses `node` as the "interpreter" and tiny JS stubs as the "sidecars", so it runs
// everywhere with no venv.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SPAWN_DRAIN_MS,
  SPAWN_KILL_GRACE_MS,
  SPAWN_MAX_BUFFER,
  SPAWN_TIMEOUT_MS,
  lastNonEmptyLine,
  liveSidecarCount,
  repoRoot,
  resolvePython,
  sidecarDoctor,
  spawnSidecar,
} from '../src/analysis/spawn-sidecar.js'

const dir = mkdtempSync(join(tmpdir(), 'beat-spawn-sidecar-'))

/** Write a JS "sidecar" and return its path relative to `dir` (spawned with cwd=dir). */
function stub(name: string, body: string): string {
  writeFileSync(join(dir, name), body)
  return name
}

// ---- constants + the pure helper ---------------------------------------------------------------

test('the frozen spawn constants are the ones all eight sidecars used', () => {
  assert.equal(SPAWN_TIMEOUT_MS, 600_000)
  assert.equal(SPAWN_MAX_BUFFER, 64 * 1024 * 1024)
})

test('lastNonEmptyLine picks the sidecars\' error line, trimmed, ignoring trailing blanks', () => {
  assert.equal(lastNonEmptyLine('a\nb\n  \n'), 'b')
  assert.equal(lastNonEmptyLine('  pip install -r python/requirements-midi.txt  \n\n'), 'pip install -r python/requirements-midi.txt')
  assert.equal(lastNonEmptyLine('one\r\ntwo\r\n'), 'two')
  assert.equal(lastNonEmptyLine(''), '')
  assert.equal(lastNonEmptyLine('\n \n'), '')
})

test('repoRoot points at a checkout (the three-levels-up trick every wrapper re-derived)', () => {
  assert.ok(repoRoot.length > 0)
})

// ---- spawnSidecar ------------------------------------------------------------------------------

test('spawnSidecar returns exit 0 with stdout/stderr captured', async () => {
  const script = stub('ok.mjs', 'process.stdout.write(JSON.stringify({ok:true}));process.stderr.write("noise\\n")')
  const res = await spawnSidecar({ python: process.execPath, args: [script], cwd: dir })
  assert.equal(res.code, 0)
  assert.equal(res.enoent, false)
  assert.equal(res.stdout, '{"ok":true}')
  assert.equal(res.stderr.trim(), 'noise')
})

test('spawnSidecar reports the sidecar exit codes (2 bad input / 3 missing dep / 4 failure)', async () => {
  for (const code of [2, 3, 4]) {
    const script = stub(`exit${code}.mjs`, `process.stderr.write("hint line\\n");process.exit(${code})`)
    const res = await spawnSidecar({ python: process.execPath, args: [script], cwd: dir })
    assert.equal(res.code, code)
    assert.equal(lastNonEmptyLine(res.stderr), 'hint line')
  }
})

test('spawnSidecar flags a missing interpreter as enoent, never a rejection', async () => {
  const res = await spawnSidecar({ python: join(dir, 'definitely-not-an-interpreter'), args: ['x.mjs'], cwd: dir })
  assert.equal(res.enoent, true)
  assert.equal(res.code, null)
})

test('an ENOENT leaves no armed timer behind (it used to park node for the full 600s timeout)', async () => {
  // Regression: with spawn's built-in `timeout` option, node clears the timer on the child's
  // 'exit' event — which never fires when the interpreter does not exist. The promise settled at
  // once but the process stayed alive for SPAWN_TIMEOUT_MS, which would hang every suite that
  // exercises a missing-python path. The timer is ours now, cleared on settle and unref'd.
  // Asserted the only way that is actually meaningful: a fresh node that does ONE failed spawn must
  // exit on its own, promptly.
  const mod = new URL('../src/analysis/spawn-sidecar.js', import.meta.url).href
  const src = `const { spawnSidecar } = await import(${JSON.stringify(mod)});
    await spawnSidecar({ python: ${JSON.stringify(join(dir, 'nope-python'))}, args: ['x.mjs'], cwd: process.cwd() })`
  const t0 = Date.now()
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', src], { timeout: 30_000, encoding: 'utf8' })
  assert.equal(res.status, 0, `child exited ${String(res.status)} ${res.stderr}`)
  assert.ok(Date.now() - t0 < 25_000, 'a failed spawn must not hold the process open')
})

test('spawnSidecar streams stdin (the surge/ca2 request-on-stdin path)', async () => {
  const script = stub('echo-stdin.mjs', 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(s))')
  const res = await spawnSidecar({ python: process.execPath, args: [script], stdin: '{"role":"bassline"}', cwd: dir })
  assert.equal(res.code, 0)
  assert.equal(res.stdout, '{"role":"bassline"}')
})

test('spawnSidecar closes stdin even when no payload is given (no sidecar hangs on an open pipe)', async () => {
  const script = stub('read-stdin.mjs', 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{process.stdout.write("eof:"+s.length)})')
  const res = await spawnSidecar({ python: process.execPath, args: [script], cwd: dir })
  assert.equal(res.stdout, 'eof:0')
})

// ---- process lifecycle: the three confirmed hangs (2026-07-26) ---------------------------------
//
// Every stub here is a JS "sidecar" run under `node`, standing in for what torch/demucs actually
// do: fork a worker that inherits stdout, trap SIGTERM, or simply outlive the caller.

/** Is this pid still around? (signal 0 = existence probe, the shell's `kill -0`.) */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Poll a predicate at 50ms until it holds or `ms` elapses; returns whether it held. */
async function until(predicate: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return predicate()
}

test('the lifecycle constants are the measured ones', () => {
  assert.equal(SPAWN_DRAIN_MS, 250)
  assert.equal(SPAWN_KILL_GRACE_MS, 5_000)
})

test('a sidecar whose forked worker inherits stdout settles when the SIDECAR exits, not the worker', async () => {
  // Regression, measured 2026-07-26: the only settle path was `close`, i.e. stdio EOF, and EOF
  // waits for every holder of the inherited pipe. This exact shape (child exits at ~0.3s, worker
  // holds stdout for 10s) settled at 10.1s — the owner's "python sidecar at 0% CPU while the
  // caller waits forever". torch and demucs both fork workers with inherited stdio.
  const script = stub('forker.mjs', `
    import { spawn } from 'node:child_process'
    spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: 'inherit' }).unref()
    process.stdout.write('sidecar done')
    setTimeout(() => process.exit(0), 200)
  `)
  const t0 = Date.now()
  const res = await spawnSidecar({ python: process.execPath, args: [script], cwd: dir })
  const elapsed = Date.now() - t0
  assert.equal(res.code, 0)
  assert.equal(res.stdout, 'sidecar done', 'output written before exit must still be captured')
  assert.ok(elapsed < 3_000, `settled after ${elapsed}ms — the worker's 10s lifetime is leaking into the caller again`)
})

test('the drain window restarts on every chunk, so a big payload still arrives whole', async () => {
  // The grandchild fix must not truncate: SPAWN_DRAIN_MS is silence-after-exit, not a hard cap.
  // 8MB in 64KB chunks takes many event-loop turns to drain out of the pipe.
  const script = stub('big.mjs', `
    const chunk = 'x'.repeat(65536)
    for (let i = 0; i < 128; i++) process.stdout.write(chunk)
    process.stdout.end()
  `)
  const res = await spawnSidecar({ python: process.execPath, args: [script], cwd: dir })
  assert.equal(res.code, 0)
  assert.equal(res.stdout.length, 128 * 65536)
})

test('a timeout ALWAYS settles, even against a child that traps SIGTERM', async () => {
  // Regression, measured 2026-07-26: the timeout sent one SIGTERM to the direct child and then
  // waited for `close`. A child that ignores SIGTERM meant the promise resolved never — observed
  // still parked at 12s with a 2s timeout, and it would have stayed parked forever.
  const pidFile = join(dir, 'trapper.pid')
  const script = stub('trapper.mjs', `
    import { writeFileSync } from 'node:fs'
    process.on('SIGTERM', () => {})
    writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))
    setInterval(() => {}, 1000)
  `)
  const t0 = Date.now()
  const res = await spawnSidecar({ python: process.execPath, args: [script], cwd: dir, timeoutMs: 1_000 })
  const elapsed = Date.now() - t0
  assert.equal(res.timedOut, true)
  assert.equal(res.code, 4, 'a timeout reports the sidecars\' own "failure" exit so callers need no new branch')
  assert.equal(lastNonEmptyLine(res.stderr), 'sidecar timed out after 1s and was killed')
  assert.ok(elapsed < 3_000, `settled after ${elapsed}ms — the timeout is waiting on the child again`)

  // ...and the kill escalates rather than giving up after the ignored SIGTERM.
  const pid = Number(readFileSync(pidFile, 'utf8'))
  assert.ok(await until(() => !alive(pid), SPAWN_KILL_GRACE_MS + 5_000), `pid ${pid} survived the SIGKILL escalation`)
})

test('a killed parent takes the sidecar AND its forked worker with it', async () => {
  // Regression, measured 2026-07-26: the python child survived SIGTERM of the calling node
  // process, so every Ctrl-C'd `beat analyze` / `beat source gen`, daemon restart or killed MCP
  // server leaked a multi-minute model render (the hunt found a real orphaned model.py at 370%
  // CPU with eight multiprocessing forks). SIGINT is the Ctrl-C case specifically: the sidecar is
  // detached now, so it no longer gets the terminal's signal for free — the exit hook has to do it.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const kidFile = join(dir, `kid-${signal}.pid`)
    const workerFile = join(dir, `worker-${signal}.pid`)
    const script = stub(`outliver-${signal}.mjs`, `
      import { spawn } from 'node:child_process'
      import { writeFileSync } from 'node:fs'
      const worker = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
      writeFileSync(${JSON.stringify(workerFile)}, String(worker.pid))
      writeFileSync(${JSON.stringify(kidFile)}, String(process.pid))
      setTimeout(() => {}, 60000)
    `)
    const mod = new URL('../src/analysis/spawn-sidecar.js', import.meta.url).href
    const src = `const { spawnSidecar } = await import(${JSON.stringify(mod)});
      await spawnSidecar({ python: ${JSON.stringify(process.execPath)}, args: [${JSON.stringify(script)}], cwd: ${JSON.stringify(dir)} })`
    const parent = spawn(process.execPath, ['--input-type=module', '-e', src], { stdio: 'ignore' })
    const exited = new Promise<number | null>((r) => parent.on('exit', (_c, s) => r(s === null ? 0 : 1)))

    assert.ok(await until(() => existsSync(kidFile) && existsSync(workerFile), 15_000), 'sidecar never started')
    const kid = Number(readFileSync(kidFile, 'utf8'))
    const worker = Number(readFileSync(workerFile, 'utf8'))
    assert.ok(alive(kid) && alive(worker), 'fixture is wrong: sidecar/worker not running')

    parent.kill(signal)
    await exited
    assert.ok(await until(() => !alive(kid), 10_000), `${signal}: sidecar ${kid} outlived its parent`)
    assert.ok(await until(() => !alive(worker), 10_000), `${signal}: worker ${worker} outlived its parent (process group not killed)`)
  }
})

test('the shutdown hooks are installed only while a sidecar is live, and removed after', async () => {
  // Detaching means we take over Ctrl-C handling — but only for processes that actually spawn a
  // sidecar. A program that never does must see node's stock signal behaviour, so the hooks go on
  // with the first live child and come off with the last.
  const before = process.listenerCount('SIGINT')
  const script = stub('quiet.mjs', 'process.stdout.write("ok")')
  const pending = spawnSidecar({ python: process.execPath, args: [script], cwd: dir })
  assert.equal(liveSidecarCount(), 1)
  assert.ok(process.listenerCount('SIGINT') > before, 'no shutdown hook while a sidecar is live')
  await pending
  assert.equal(liveSidecarCount(), 0)
  assert.equal(process.listenerCount('SIGINT'), before, 'shutdown hooks outlived the last sidecar')
})

// ---- resolvePython: all five hand-forked chains, from one function -----------------------------

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

test('the base chain is $BEAT_PYTHON, then the shared venv, then python3', () => {
  withEnv({ BEAT_PYTHON: '/tmp/shared-python' }, () => {
    assert.equal(resolvePython(), '/tmp/shared-python')
  })
  withEnv({ BEAT_PYTHON: '   ' }, () => {
    // a blank override is ignored, not honoured as an empty interpreter path
    assert.ok(resolvePython() === 'python3' || resolvePython().endsWith('/python/.venv/bin/python3'))
  })
})

test('a sidecar override env var wins over $BEAT_PYTHON (stems, roughness, ca2)', () => {
  withEnv({ BEAT_STEM_PYTHON: '/tmp/stem-python', BEAT_PYTHON: '/tmp/shared-python' }, () => {
    assert.equal(resolvePython({ envVar: 'BEAT_STEM_PYTHON' }), '/tmp/stem-python')
  })
  withEnv({ BEAT_STEM_PYTHON: undefined, BEAT_PYTHON: '/tmp/shared-python' }, () => {
    assert.equal(resolvePython({ envVar: 'BEAT_STEM_PYTHON' }), '/tmp/shared-python')
  })
})

test('a dedicated venv is probed before $BEAT_PYTHON but after the override (roughness)', () => {
  withEnv({ BEAT_ROUGHNESS_PYTHON: '/tmp/rough-python', BEAT_PYTHON: '/tmp/shared-python' }, () => {
    assert.equal(resolvePython({ envVar: 'BEAT_ROUGHNESS_PYTHON', dedicatedVenv: 'venv-roughness' }), '/tmp/rough-python')
  })
  withEnv({ BEAT_ROUGHNESS_PYTHON: undefined, BEAT_PYTHON: '/tmp/shared-python' }, () => {
    // no venv-roughness on this machine → falls through to the shared chain
    const got = resolvePython({ envVar: 'BEAT_ROUGHNESS_PYTHON', dedicatedVenv: 'venv-roughness' })
    assert.ok(got === '/tmp/shared-python' || got.endsWith('/python/venv-roughness/bin/python3'))
  })
})

test('extraCandidates are probed before the shared chain and skipped when absent (ca2)', () => {
  const present = join(dir, 'candidate-python')
  writeFileSync(present, '')
  withEnv({ BEAT_CA2_PYTHON: undefined, BEAT_PYTHON: '/tmp/shared-python' }, () => {
    assert.equal(resolvePython({ envVar: 'BEAT_CA2_PYTHON', extraCandidates: [join(dir, 'nope'), present] }), present)
    assert.equal(resolvePython({ envVar: 'BEAT_CA2_PYTHON', extraCandidates: [join(dir, 'nope')] }), '/tmp/shared-python')
  })
})

// ---- the generic doctor ------------------------------------------------------------------------

test('sidecarDoctor returns the sidecar report augmented with the interpreter', async () => {
  const script = stub('doctor-ok.mjs', 'process.stdout.write(JSON.stringify({backend:"x",available:true}))')
  const report = await sidecarDoctor(script, { python: process.execPath, cwd: dir, base: { backend: 'x' } })
  assert.equal(report.available, true)
  assert.equal(report.pythonFound, true)
  assert.equal(report.interpreter, process.execPath)
})

test('sidecarDoctor never throws: missing interpreter, non-zero exit and non-JSON all report', async () => {
  const missing = await sidecarDoctor('whatever.py', { python: join(dir, 'no-such-python'), cwd: dir, hint: 'see python/README.md.', failure: { available: false } })
  assert.equal(missing.pythonFound, false)
  assert.equal(missing.available, false)
  assert.match(String(missing.error), /no Python interpreter found \(tried ".*no-such-python"\)\. see python\/README\.md\./)

  const failing = stub('doctor-fail.mjs', 'process.stderr.write("pip install -r python/requirements-x.txt\\n");process.exit(3)')
  const failed = await sidecarDoctor(failing, { python: process.execPath, cwd: dir })
  assert.equal(failed.pythonFound, true)
  assert.equal(failed.error, 'pip install -r python/requirements-x.txt')

  const garbage = stub('doctor-garbage.mjs', 'process.stdout.write("not json")')
  const bad = await sidecarDoctor(garbage, { python: process.execPath, cwd: dir, label: 'x sidecar' })
  assert.equal(bad.error, 'x sidecar --doctor produced non-JSON output')
  assert.equal(bad.raw, 'not json')
})

test('sidecarDoctor omits the trailing hint sentence when the sidecar has none (midi_extract)', async () => {
  const report = await sidecarDoctor('whatever.py', { python: join(dir, 'no-such-python'), cwd: dir, base: { backend: 'midi' } })
  assert.equal(report.backend, 'midi')
  assert.equal(report.error, `no Python interpreter found (tried "${join(dir, 'no-such-python')}")`)
})

test('sidecarDoctor passes through alternate flags (ca2 --smoke)', async () => {
  const script = stub('doctor-flags.mjs', 'process.stdout.write(JSON.stringify({flag:process.argv[2]}))')
  const report = await sidecarDoctor(script, { python: process.execPath, cwd: dir, args: ['--smoke'] })
  assert.equal(report.flag, '--smoke')
})
