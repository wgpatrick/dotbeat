// Phase 39 Stream UB — end-to-end tests for `beat source gen` (the Python generative-audio sidecar),
// driven through the real CLI subprocess harness. GATED on python3 like analyze-sidecar.test.ts:
// module-top probes `python3 --version`, and each subtest skips if it's absent. python3 IS present
// in the dev/CI container (3.11.15), so these DO run here. They never need torch — the stub backend
// is deterministic stdlib-only; the stableaudio case deliberately proves the missing-dependency
// DEGRADE path (exit 3 surfaced with the requirements + doctor hint).

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

let hasPython = false
try {
  execFileSync('python3', ['--version'], { stdio: 'ignore' })
  hasPython = true
} catch {
  hasPython = false
}

// Phase 40 Stream VC: the two tests below assert the missing-DEPENDENCY degrade path (stableaudio
// fails without torch; --doctor reports it missing) — true in CI, false on a machine with the venv
// installed, where they turned `npm test` red for a correctly-working install. Probe the backend
// once at module top (same shape as hasPython above) and skip them where the degrade can't happen;
// they still run wherever the dependency is genuinely absent, which is the only place they test
// anything. Skipping also saves ~80s: with stableaudio installed, the "must fail" test SUCCEEDS in
// generating real audio before failing its assertion. See `npm run test:sidecars` for the inverse.
let hasStableaudio = false
if (hasPython) {
  try {
    const report = JSON.parse(execFileSync(process.execPath, [beatCli, 'source', 'gen', '--doctor'], { encoding: 'utf8' }))
    hasStableaudio = report?.backends?.stableaudio?.ok === true
  } catch {
    hasStableaudio = false // doctor itself failing → treat the backend as absent (the degrade path is live)
  }
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

/** A fresh temp project dir with an initialized .beat file. Returns the .beat path + its dir. */
function freshProject(): { beatFile: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beat-gen-test-'))
  const beatFile = join(dir, 'song.beat')
  const init = beat(['init', beatFile])
  assert.equal(init.status, 0, init.stderr)
  return { beatFile, dir }
}

test('beat source gen --backend stub registers media + writes the provenance sidecar', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = freshProject()
  const out = beat(['source', 'gen', beatFile, 'genkick', 'punchy kick', '--backend', 'stub', '--seconds', '1', '--seed', '7'])
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /registered genkick/)
  assert.match(out.stdout, /provenance sidecar: media\/genkick\.wav\.json/)

  // The prepped WAV + its enforced provenance sidecar both land in media/.
  const wavPath = join(dir, 'media', 'genkick.wav')
  const sidecarPath = wavPath + '.json'
  assert.ok(existsSync(wavPath), 'media/genkick.wav created')
  assert.ok(existsSync(sidecarPath), 'media/genkick.wav.json created')

  // The .beat now references the media id.
  const beatText = readFileSync(beatFile, 'utf8')
  assert.match(beatText, /genkick/)

  // Provenance sidecar records the prompt/provider/seed under `generated`.
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'))
  // Honest licensing (pilot 106 M2): a stub tone is NOT a Stability model output, so it's licensed
  // 'stub-placeholder' with no Stability URL — only a real stableaudio run gets the Stability license.
  assert.equal(sidecar.license, 'stub-placeholder')
  assert.equal(sidecar.query, 'punchy kick')
  assert.ok(sidecar.generated, 'sidecar has a generated block')
  assert.equal(sidecar.generated.prompt, 'punchy kick')
  // Provenance records the ACTUAL backend/provider that ran (the stub honestly reports "stub"),
  // not the requested provider arg — a stableaudio run would record "stable-audio-open".
  assert.equal(sidecar.generated.provider, 'stub')
  assert.equal(sidecar.generated.backend, 'stub')
  assert.equal(sidecar.generated.seed, 7)
  assert.equal(sidecar.generated.licenseUrl, null)
})

test('beat source gen --backend stub is deterministic for a fixed seed+seconds', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = freshProject()
  beat(['source', 'gen', beatFile, 'genA', 'anything', '--backend', 'stub', '--seconds', '1', '--seed', '42'])
  beat(['source', 'gen', beatFile, 'genB', 'totally different prompt', '--backend', 'stub', '--seconds', '1', '--seed', '42'])
  // Same seed+seconds → byte-identical generated audio (the stub ignores the prompt), and since the
  // prep pipeline is deterministic, the registered WAVs hash identically too.
  const shaA = createHash('sha256').update(readFileSync(join(dir, 'media', 'genA.wav'))).digest('hex')
  const shaB = createHash('sha256').update(readFileSync(join(dir, 'media', 'genB.wav'))).digest('hex')
  assert.equal(shaA, shaB, 'fixed seed+seconds produces a stable hash regardless of prompt')
})

test('beat source gen --backend stub varies by prompt when no seed is pinned (pilot 106 M1)', (t) => {
  if (!hasPython) return t.skip('no python3')
  const { beatFile, dir } = freshProject()
  // No --seed: the default seed is derived from the prompt, so two DIFFERENT prompts must produce
  // DIFFERENT sounds (a producer building a kit from distinct prompts shouldn't get N copies) — while
  // the SAME prompt still reproduces (determinism preserved).
  beat(['source', 'gen', beatFile, 'kick', '808 kick', '--backend', 'stub', '--seconds', '1'])
  beat(['source', 'gen', beatFile, 'snare', 'tight snare', '--backend', 'stub', '--seconds', '1'])
  beat(['source', 'gen', beatFile, 'kick2', '808 kick', '--backend', 'stub', '--seconds', '1'])
  const sha = (id: string) => createHash('sha256').update(readFileSync(join(dir, 'media', `${id}.wav`))).digest('hex')
  assert.notEqual(sha('kick'), sha('snare'), 'different prompts → different default sounds')
  assert.equal(sha('kick'), sha('kick2'), 'same prompt → reproducible default sound')
})

test('beat source gen --backend stableaudio without torch exits non-zero with the requirements/doctor hint', (t) => {
  if (!hasPython) return t.skip('no python3')
  if (hasStableaudio) return t.skip('stableaudio installed — degrade path not exercisable here')
  const { beatFile, dir } = freshProject()
  const out = beat(['source', 'gen', beatFile, 'genpad', 'warm pad', '--backend', 'stableaudio', '--seconds', '1', '--seed', '1'])
  assert.notEqual(out.status, 0, 'stableaudio must fail without torch installed')
  const combined = out.stdout + out.stderr
  assert.match(combined, /pip install -r python\/requirements-stableaudio\.txt/)
  assert.match(combined, /beat source gen --doctor/)
  assert.match(combined, /--backend stub/)
  // No media should have been registered on the failure (temp file is cleaned up; no genpad.wav).
  assert.ok(!existsSync(join(dir, 'media', 'genpad.wav')), 'no media registered on the degrade path')
})

test('beat source gen --doctor JSON parses reporting stub ok / stableaudio missing', (t) => {
  if (!hasPython) return t.skip('no python3')
  if (hasStableaudio) return t.skip('stableaudio installed — degrade path not exercisable here')
  const out = beat(['source', 'gen', '--doctor'])
  assert.equal(out.status, 0, out.stderr)
  const report = JSON.parse(out.stdout)
  assert.equal(report.pythonFound, true)
  assert.ok(typeof report.interpreter === 'string')
  assert.equal(report.backends.stub.ok, true)
  assert.equal(report.backends.stableaudio.ok, false)
  assert.ok(report.backends.stableaudio.missing.includes('torch'))
})

// ---- R4-4: the downbeat trim is reachable from `beat source gen` ---------------------------------
// Until research/130 W0.4/W0.5, RunGenOptions carried no bpm/bars, so src/analysis/gen-trim.ts —
// fully implemented and fully tested — could only be reached by scripts/gen-bakeoff-run.mjs calling
// runGenFal directly. `beat source gen` could never trim, which is backwards: the trim exists
// because Lyria's fixed 30 s and MiniMax's multi-minute output need cutting, and those are exactly
// the models this command selects. These assert the wiring (CLI flag -> source-lib -> runGen) and
// the loud-not-silent validation; the trim MATH is covered by test/gen-trim.test.ts and the
// runGenFal integration by test/gen-fal.test.ts.

test('source gen --bpm/--bars reach runGen: a non-fal backend is refused, not silently ignored', () => {
  const { beatFile, dir } = freshProject()
  const out = beat(['source', 'gen', beatFile, 'gentrim', 'a loop', '--backend', 'stub', '--seconds', '1', '--seed', '3', '--bpm', '120', '--bars', '4'])
  assert.notEqual(out.status, 0, 'the flags must not be accepted-and-ignored')
  const combined = out.stdout + out.stderr
  assert.match(combined, /--bpm\/--bars .*only apply to --backend fal/)
  assert.ok(!existsSync(join(dir, 'media', 'gentrim.wav')), 'nothing registered when the request is rejected')
})

test('source gen --bpm without --bars errors (the trim needs both to know a bar length)', () => {
  const { beatFile } = freshProject()
  const out = beat(['source', 'gen', beatFile, 'gentrim2', 'a loop', '--backend', 'fal', '--bpm', '120'])
  assert.notEqual(out.status, 0)
  assert.match(out.stdout + out.stderr, /--bpm and --bars go together/)
})

test('source gen rejects a non-positive --bpm and a fractional --bars before spending a generation', () => {
  const { beatFile } = freshProject()
  const bad = beat(['source', 'gen', beatFile, 'gentrim3', 'a loop', '--backend', 'fal', '--bpm', '0', '--bars', '4'])
  assert.notEqual(bad.status, 0)
  assert.match(bad.stdout + bad.stderr, /--bpm must be positive/)
  const frac = beat(['source', 'gen', beatFile, 'gentrim4', 'a loop', '--backend', 'fal', '--bpm', '120', '--bars', '2.5'])
  assert.notEqual(frac.status, 0)
  assert.match(frac.stdout + frac.stderr, /--bars must be a positive integer/)
})

test('source gen --count batches accept the same trim flags (the batch path forwards them too)', () => {
  const { beatFile } = freshProject()
  const out = beat(['source', 'gen', beatFile, 'gentrim5', 'a loop', '--count', '2', '--backend', 'stub', '--seconds', '1', '--bpm', '120', '--bars', '4'])
  assert.notEqual(out.status, 0, 'the batch path must validate identically to the single-shot path')
  assert.match(out.stdout + out.stderr, /--bpm\/--bars .*only apply to --backend fal/)
})
