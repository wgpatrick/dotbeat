// The shared sidecar spawn scaffold (src/analysis/spawn-sidecar.ts, research/130 W1.1 / R4-1).
//
// The eight sidecar wrappers are covered by their own files; this one pins the SCAFFOLD they now
// share — the exit-code/ENOENT/stdin plumbing, the one parameterized interpreter resolver (which
// has to reproduce all five hand-forked chains exactly), and the generic doctor's never-throws
// contract. It uses `node` as the "interpreter" and tiny JS stubs as the "sidecars", so it runs
// everywhere with no venv.

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SPAWN_MAX_BUFFER,
  SPAWN_TIMEOUT_MS,
  lastNonEmptyLine,
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
