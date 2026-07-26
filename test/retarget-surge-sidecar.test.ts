// The two surge_render.py surfaces preset retargeting added: `--dump-params` (a patch's parameters
// with NATIVE value + range — what a local search needs to start AT a preset) and the additive
// `nativeOverrides` render field. GATED on surgepy exactly like test/surge-sidecar.test.ts: surgepy
// is a source build of Surge XT with no PyPI wheel, so on most machines (and in CI) these skip with
// a named reason rather than failing.
//
// The property under test is the one that motivated the whole addition: `overrides` is validated as
// normalized 0..1 while surgepy's setParamVal takes NATIVE values, so on a parameter whose real
// range is not 0..1 the two paths land in different places — and only the native path can reach
// the range a retarget needs.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { surgeAvailable, surgeDoctor } from '../src/analysis/surge.js'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const sidecar = join(repoRoot, 'python', 'surge_render.py')
const venv = join(repoRoot, 'python', '.venv', 'bin', 'python3')
const python = process.env.BEAT_PYTHON ?? (existsSync(venv) ? venv : 'python3')

let hasPython = false
try {
  execFileSync(python, ['--version'], { stdio: 'ignore' })
  hasPython = true
} catch {
  hasPython = false
}

let hasSurgepy = false
let patchesRoot: string | null = null
let samplePatch: string | null = null
if (hasPython) {
  try {
    const report = await surgeDoctor()
    hasSurgepy = surgeAvailable(report)
    patchesRoot = typeof report.patchesRoot === 'string' ? report.patchesRoot : null
  } catch {
    hasSurgepy = false
  }
}
if (hasSurgepy && patchesRoot) {
  try {
    const listing = JSON.parse(execFileSync(python, [sidecar, '--list-patches'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as {
      patches: { path: string }[]
    }
    samplePatch = listing.patches[0]?.path ?? null
  } catch {
    samplePatch = null
  }
}
/** Named skip reason, per CLAUDE.md's "a test that can silently skip is not a gate". */
const skipReason = !hasPython ? 'no python3' : !hasSurgepy ? 'surgepy not built here (no PyPI wheel — see python/README.md)' : !samplePatch ? 'no surge factory patches found' : false

const run = (args: string[], stdin?: string) =>
  JSON.parse(execFileSync(python, [sidecar, ...args], { input: stdin, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) as string)

test('--dump-params reports every parameter with a native value inside its own range', { skip: skipReason }, () => {
  const dump = run(['--dump-params', samplePatch!]) as {
    backend: string
    count: number
    params: { name: string; value: number; min: number; max: number; type: string }[]
  }
  assert.equal(dump.backend, 'surge')
  assert.ok(dump.count > 100, `expected a few hundred parameters, got ${dump.count}`)
  assert.equal(dump.params.length, dump.count)
  for (const p of dump.params) {
    assert.equal(typeof p.name, 'string')
    assert.ok(p.max >= p.min, `${p.name}: inverted range`)
    assert.ok(p.value >= p.min - 1e-6 && p.value <= p.max + 1e-6, `${p.name}: value ${p.value} outside [${p.min}, ${p.max}]`)
  }
  // the parameters the retarget space is built from exist and are floats with a real range
  const cutoff = dump.params.find((p) => p.name === 'A Filter 1 Cutoff')
  assert.ok(cutoff, 'every Surge patch carries a scene-A filter cutoff')
  assert.equal(cutoff!.type, 'float')
  assert.ok(cutoff!.max - cutoff!.min > 100, 'cutoff spans more than 100 semitones — far more than the 0..1 window')
})

test('nativeOverrides move a parameter to the value asked for, clamped to its own range', { skip: skipReason }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'retarget-surge-'))
  const notes = [{ midi: 48, startSeconds: 0, durationSeconds: 0.4, velocity: 100 }]
  const req = (nativeOverrides: { param: string; value: number }[]) =>
    run([], JSON.stringify({ patch: samplePatch, notes, sampleRate: 44100, output: join(dir, 'out.wav'), nativeOverrides })) as {
      nativeOverrides: { param: string; requested: number; applied: number; min: number; max: number; display: string }[]
    }
  const mid = req([{ param: 'A Filter 1 Cutoff', value: 10 }])
  assert.equal(mid.nativeOverrides.length, 1)
  assert.equal(mid.nativeOverrides[0]!.param, 'A Filter 1 Cutoff')
  assert.ok(Math.abs(mid.nativeOverrides[0]!.applied - 10) < 0.01, `asked 10, applied ${mid.nativeOverrides[0]!.applied}`)
  assert.match(mid.nativeOverrides[0]!.display, /Hz/)

  // out of range clamps to the parameter's own edge rather than erroring or wrapping
  const hot = req([{ param: 'A Filter 1 Cutoff', value: 1e6 }])
  assert.equal(hot.nativeOverrides[0]!.applied, hot.nativeOverrides[0]!.max)
  assert.equal(hot.nativeOverrides[0]!.requested, 1e6)
})

test('the native path reaches values the 0..1 `overrides` path cannot — the reason it exists', { skip: skipReason }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'retarget-surge-'))
  const notes = [{ midi: 48, startSeconds: 0, durationSeconds: 0.4, velocity: 100 }]
  const out = join(dir, 'out.wav')
  const viaOld = run([], JSON.stringify({ patch: samplePatch, notes, sampleRate: 44100, output: out, overrides: [{ param: 'cutoff', value: 1 }] }))
  const viaNew = run([], JSON.stringify({ patch: samplePatch, notes, sampleRate: 44100, output: out, nativeOverrides: [{ param: 'A Filter 1 Cutoff', value: 40 }] })) as {
    nativeOverrides: { applied: number }[]
  }
  assert.deepEqual(viaOld.overrides, ['A Filter 1 Cutoff'], 'the old path still resolves and still applies')
  assert.ok(viaNew.nativeOverrides[0]!.applied > 1, 'the native path reaches beyond the 0..1 ceiling the old path enforces')
})

test('a malformed nativeOverride is a loud usage error, never a silent no-op', { skip: skipReason }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'retarget-surge-'))
  const notes = [{ midi: 48, startSeconds: 0, durationSeconds: 0.4, velocity: 100 }]
  assert.throws(() =>
    run([], JSON.stringify({ patch: samplePatch, notes, sampleRate: 44100, output: join(dir, 'o.wav'), nativeOverrides: [{ param: 'A Filter 1 Cutoff' }] })),
  )
  assert.throws(() =>
    run([], JSON.stringify({ patch: samplePatch, notes, sampleRate: 44100, output: join(dir, 'o.wav'), nativeOverrides: [{ param: 'not a real parameter', value: 1 }] })),
  )
})
