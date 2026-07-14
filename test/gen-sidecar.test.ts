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
  assert.equal(sidecar.license, 'Stability-AI-Community')
  assert.equal(sidecar.query, 'punchy kick')
  assert.ok(sidecar.generated, 'sidecar has a generated block')
  assert.equal(sidecar.generated.prompt, 'punchy kick')
  // Provenance records the ACTUAL backend/provider that ran (the stub honestly reports "stub"),
  // not the requested provider arg — a stableaudio run would record "stable-audio-open".
  assert.equal(sidecar.generated.provider, 'stub')
  assert.equal(sidecar.generated.backend, 'stub')
  assert.equal(sidecar.generated.seed, 7)
  assert.equal(sidecar.generated.licenseUrl, 'https://stability.ai/community-license-agreement')
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

test('beat source gen --backend stableaudio without torch exits non-zero with the requirements/doctor hint', (t) => {
  if (!hasPython) return t.skip('no python3')
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
  const out = beat(['source', 'gen', '--doctor'])
  assert.equal(out.status, 0, out.stderr)
  const report = JSON.parse(out.stdout)
  assert.equal(report.pythonFound, true)
  assert.ok(typeof report.interpreter === 'string')
  assert.equal(report.backends.stub.ok, true)
  assert.equal(report.backends.stableaudio.ok, false)
  assert.ok(report.backends.stableaudio.missing.includes('torch'))
})
