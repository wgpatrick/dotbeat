// Phase 40 Stream VC — tests for `beat regen` (src/analysis/regen.ts + the CLI verb).
//
// Everything here runs on the `stub` backend: it's stdlib-only (no torch, so this runs in CI) and
// deterministic per seed+seconds, which makes a regen a genuine known-answer test — the same
// property the real stableaudio backend has same-machine, exercised without the 2-minute cost.
// GATED on python3 like gen-sidecar.test.ts (the stub still runs through python/gen.py).
//
// The behaviours worth pinning are the honesty ones: --verify must not touch media/, a hash
// mismatch must be reported as `differs` rather than an error, and non-generated media must be
// skipped by name rather than silently ignored.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { planRegen, estimateRegenSeconds, formatDuration, BeatRegenError } from '../src/analysis/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

let hasPython = false
try {
  execFileSync('python3', ['--version'], { stdio: 'ignore' })
  hasPython = true
} catch {
  hasPython = false
}

interface RunResult {
  status: number
  stdout: string
  stderr: string
}

function beat(args: string[]): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

/** A temp project with one stub-generated sample registered (so it has a real provenance sidecar). */
function projectWithGeneratedSample(id = 'gtick'): { beatFile: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beat-regen-test-'))
  const beatFile = join(dir, 'song.beat')
  assert.equal(beat(['init', beatFile]).status, 0)
  const gen = beat(['source', 'gen', beatFile, id, 'a tick', '--backend', 'stub', '--seconds', '1', '--seed', '5'])
  assert.equal(gen.status, 0, gen.stderr)
  return { beatFile, dir }
}

test('planRegen reads the generated recipe out of the provenance sidecar', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile } = projectWithGeneratedSample()
  const plan = planRegen(beatFile)
  assert.equal(plan.regenerable.length, 1)
  const e = plan.regenerable[0]!
  assert.equal(e.id, 'gtick')
  assert.equal(e.generated.prompt, 'a tick')
  assert.equal(e.generated.seed, 5)
  assert.equal(e.generated.seconds, 1)
  assert.equal(e.generated.backend, 'stub')
  assert.match(e.sha256, /^[0-9a-f]{64}$/)
})

test('non-generated media is not regenerable and is skipped by name with its source', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = projectWithGeneratedSample()
  // A local ingest of the generated wav — same prep pipeline, but no `generated` block, so there is
  // no recipe to replay. It must be reported, not silently dropped.
  const add = beat(['source', 'add', beatFile, 'localone', join(dir, 'media', 'gtick.wav')])
  assert.equal(add.status, 0, add.stderr)
  const plan = planRegen(beatFile)
  assert.deepEqual(plan.regenerable.map((e) => e.id), ['gtick'])
  assert.equal(plan.skipped.length, 1)
  assert.equal(plan.skipped[0]!.id, 'localone')
  assert.match(plan.skipped[0]!.reason, /not regenerable — local file/)
})

test('--id on a non-generated sample explains why, rather than "not found"', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = projectWithGeneratedSample()
  beat(['source', 'add', beatFile, 'localone', join(dir, 'media', 'gtick.wav')])
  assert.throws(() => planRegen(beatFile, { id: 'localone' }), (err: Error) => {
    assert.ok(err instanceof BeatRegenError)
    assert.match(err.message, /--id localone: not regenerable — local file/)
    return true
  })
})

test('--id for an unknown sample lists the ids that ARE regenerable', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile } = projectWithGeneratedSample()
  assert.throws(() => planRegen(beatFile, { id: 'nope' }), (err: Error) => {
    assert.match(err.message, /no generated sample with that id/)
    assert.match(err.message, /regenerable ids: gtick/)
    return true
  })
})

test('the cost estimate is stated per one-shot in the backend that will run', () => {
  // ~2 min per stableaudio one-shot (measured 2026-07-14) is what makes the up-front estimate worth
  // printing at all; the stub is effectively free, and the two must not be estimated the same.
  const entry = (backend: string) => ({ generated: { backend } }) as never
  assert.equal(estimateRegenSeconds([entry('stableaudio')]), 120)
  assert.equal(estimateRegenSeconds(Array.from({ length: 10 }, () => entry('stableaudio'))), 1200)
  assert.equal(estimateRegenSeconds([entry('stub')]), 1)
  assert.equal(formatDuration(1200), '~20 min') // the full recipe-song estimate
  assert.equal(formatDuration(120), '~2 min')
  assert.equal(formatDuration(1), '~1s')
})

test('beat regen --verify reproduces the recorded hash and does NOT touch media/', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = projectWithGeneratedSample()
  const wav = join(dir, 'media', 'gtick.wav')
  const before = { bytes: readFileSync(wav), mtime: statSync(wav).mtimeMs }
  const beatBefore = readFileSync(beatFile, 'utf8')
  const sidecarBefore = readFileSync(wav + '.json', 'utf8')

  const out = beat(['regen', beatFile, '--verify'])
  assert.equal(out.status, 0, out.stderr)
  // The count + cost estimate lead the run — before any of it is spent, not after.
  assert.match(out.stdout, /verifying 1 generated sample .* — estimated .* \(~2 min per one-shot on CPU\)/)
  assert.match(out.stdout, /media\/ will NOT be modified/)
  assert.match(out.stdout, /gtick: match \(sha256:[0-9a-f]{12}…\)/)
  assert.match(out.stdout, /media\/ was not modified \(--verify\)/)
  assert.doesNotMatch(out.stdout, /restored/)

  // Nothing under the project moved — the point of --verify.
  assert.deepEqual(readFileSync(wav), before.bytes)
  assert.equal(statSync(wav).mtimeMs, before.mtime)
  assert.equal(readFileSync(beatFile, 'utf8'), beatBefore)
  assert.equal(readFileSync(wav + '.json', 'utf8'), sidecarBefore, 'the recipe itself is never rewritten')
})

test('beat regen restores a deleted media file from the sidecar alone (the recipe claim)', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = projectWithGeneratedSample()
  const wav = join(dir, 'media', 'gtick.wav')
  const original = readFileSync(wav)
  rmSync(wav) // the "cloned the repo with an empty media/" case: only the sidecar is left

  const out = beat(['regen', beatFile])
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /gtick: match .* — restored/)
  assert.ok(existsSync(wav), 'media/gtick.wav is back')
  assert.deepEqual(readFileSync(wav), original, 'restored byte-for-byte from prompt/seed/seconds alone')
})

test('a hash mismatch is reported as "differs", never as corruption or an error', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = projectWithGeneratedSample()
  const sidecarPath = join(dir, 'media', 'gtick.wav.json')
  // Stand in for the cross-machine case: same recipe, a hash that doesn't match what this build
  // produces. On another machine/torch this is the EXPECTED outcome, so it must exit 0 and read as
  // information — the sound is generated from the same recipe, not damaged.
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'))
  sidecar.sha256 = 'f'.repeat(64)
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n')

  const out = beat(['regen', beatFile, '--verify', '--id', 'gtick'])
  assert.equal(out.status, 0, 'a differing hash is a report, not a failure')
  assert.match(out.stdout, /gtick: differs \(cross-machine reproduction is not guaranteed\)/)
  assert.match(out.stdout, /recorded sha256:ffffffffffff…, regenerated sha256:[0-9a-f]{12}…/)
  assert.match(out.stdout, /expected — the sound is generated from the same recipe, not corrupted/)
  assert.doesNotMatch(out.stdout, /corrupt(ed)?[^,]*damage|error/i)
})

test('regen refuses a project with no media/ by naming what it needs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-regen-empty-'))
  const beatFile = join(dir, 'song.beat')
  assert.equal(beat(['init', beatFile]).status, 0)
  assert.throws(() => planRegen(beatFile), (err: Error) => {
    assert.match(err.message, /no media\/ directory/)
    assert.match(err.message, /provenance sidecars \(media\/<id>\.wav\.json\)/)
    return true
  })
})
