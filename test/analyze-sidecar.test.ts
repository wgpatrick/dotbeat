// Phase 38 Stream SB — end-to-end tests for `beat analyze` (the Python audio-analysis sidecar),
// driven through the real CLI subprocess harness. These are GATED on python3 being present:
// module-top probes `python3 --version`, and each subtest skips if it's absent. python3 IS present
// in the dev/CI container (3.11.15), so these DO run here. They never need torch — everything is
// exercised through the deterministic stdlib-only `stub` backend, except the beatthis case, which
// deliberately proves the missing-dependency DEGRADE path (exit 3 surfaced with the doctor hint).

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
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

/** Tiny 16-bit PCM stereo WAV of a sine tone — same shape as cli.test.ts's helper. */
function writeTestWav(path: string, freq: number, amp: number, seconds = 8): void {
  const FS = 44100
  const n = Math.round(seconds * FS)
  const ch = 2
  const dataSize = n * ch * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(ch, 22)
  buf.writeUInt32LE(FS, 24); buf.writeUInt32LE(FS * ch * 2, 28); buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40)
  let o = 44
  for (let i = 0; i < n; i++) {
    const v = Math.round(amp * Math.sin((2 * Math.PI * freq * i) / FS) * 32767)
    for (let c = 0; c < ch; c++) { buf.writeInt16LE(v, o); o += 2 }
  }
  writeFileSync(path, buf)
}

function tempWav(seconds = 8): string {
  const dir = mkdtempSync(join(tmpdir(), 'beat-analyze-test-'))
  const wav = join(dir, 'ref.wav')
  writeTestWav(wav, 220, 0.4, seconds)
  return wav
}

test('beat analyze --backend stub writes a deterministic, well-formed, correctly-hashed artifact', (t) => {
  if (!hasPython) return t.skip('no python3')
  const wav = tempWav(8)
  const out = beat(['analyze', wav, '--backend', 'stub'])
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /backend stub/)
  // pilot 105: the stub result is badged as synthetic so it can't be mistaken for real detection.
  assert.match(out.stdout, /stub backend — a synthetic/)
  assert.match(out.stdout, /bpm 120\.00 \(backend\)/)
  assert.match(out.stdout, /wrote .*ref\.analysis\.json/)

  const artifactPath = wav.replace(/\.wav$/, '.analysis.json')
  assert.ok(existsSync(artifactPath), 'analysis.json created beside the audio')
  const a = JSON.parse(readFileSync(artifactPath, 'utf8'))

  // Envelope shape (the light checks; SA's validator does the authoritative pass on read-back).
  assert.equal(a.dotbeatAnalysis, 1)
  assert.equal(a.backend.name, 'stub')
  assert.equal(a.backend.version, '0.1.0')
  assert.equal(a.backend.model, null)
  assert.equal(a.bpm, 120)
  assert.equal(a.bpmMethod, 'backend')
  assert.equal(a.source.durationSeconds, 8)

  // Deterministic stub grid: 120 BPM → a beat every 0.5s strictly before 8.0s → 16 beats,
  // downbeats every 4th → 4, and exactly three intro/loop/outro sections at 15%/85% cuts.
  assert.equal(a.beats.length, 16)
  assert.deepEqual(a.downbeats, [0, 2, 4, 6])
  assert.equal(a.beats[1], 0.5)
  assert.equal(a.sections.length, 3)
  assert.deepEqual(a.sections.map((s: { label: string }) => s.label), ['intro', 'loop', 'outro'])
  assert.equal(a.sections[0].start, 0)
  assert.equal(a.sections[0].end, 1.2) // 15% of 8s
  assert.equal(a.sections[2].end, 8)

  // source.sha256 is the hash of the actual audio bytes.
  const expected = createHash('sha256').update(readFileSync(wav)).digest('hex')
  assert.equal(a.source.sha256, expected)
})

test('a second analyze of the same WAV reports the cache; --force re-runs', (t) => {
  if (!hasPython) return t.skip('no python3')
  const wav = tempWav(8)
  const first = beat(['analyze', wav, '--backend', 'stub'])
  assert.match(first.stdout, /wrote .*ref\.analysis\.json/)

  const second = beat(['analyze', wav, '--backend', 'stub'])
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /using cached .*ref\.analysis\.json — pass --force to re-analyze/)

  const forced = beat(['analyze', wav, '--backend', 'stub', '--force'])
  assert.equal(forced.status, 0, forced.stderr)
  assert.match(forced.stdout, /wrote .*ref\.analysis\.json/)
  assert.doesNotMatch(forced.stdout, /using cached/)
})

test('mutating the WAV invalidates the sha256-keyed cache', (t) => {
  if (!hasPython) return t.skip('no python3')
  const wav = tempWav(8)
  beat(['analyze', wav, '--backend', 'stub'])
  // A different-length WAV → different bytes → different sha256 → cache miss, re-analyzed.
  writeTestWav(wav, 330, 0.3, 6)
  const out = beat(['analyze', wav, '--backend', 'stub'])
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /wrote .*ref\.analysis\.json/)
  assert.doesNotMatch(out.stdout, /using cached/)
  const a = JSON.parse(readFileSync(wav.replace(/\.wav$/, '.analysis.json'), 'utf8'))
  assert.equal(a.source.durationSeconds, 6)
  assert.equal(a.beats.length, 12) // 6s at 120 BPM → 12 beats
  const expected = createHash('sha256').update(readFileSync(wav)).digest('hex')
  assert.equal(a.source.sha256, expected)
})

test('-o writes the artifact to an explicit path', (t) => {
  if (!hasPython) return t.skip('no python3')
  const wav = tempWav(8)
  const outPath = join(dirname(wav), 'custom.json')
  const out = beat(['analyze', wav, '--backend', 'stub', '-o', outPath])
  assert.equal(out.status, 0, out.stderr)
  assert.ok(existsSync(outPath), 'artifact written to the -o path')
  assert.ok(!existsSync(wav.replace(/\.wav$/, '.analysis.json')), 'default path not used when -o given')
})

test('--backend beatthis without torch exits non-zero with the doctor hint (the degrade path)', (t) => {
  if (!hasPython) return t.skip('no python3')
  const wav = tempWav(4)
  const out = beat(['analyze', wav, '--backend', 'beatthis'])
  assert.notEqual(out.status, 0, 'beatthis must fail without torch installed')
  const combined = out.stdout + out.stderr
  assert.match(combined, /pip install -r python\/requirements-beatthis\.txt/)
  assert.match(combined, /beat analyze --doctor/)
  // pilot 105: the default-backend failure names the no-deps escape hatch.
  assert.match(combined, /--backend stub/)
  // No cache file should have been written on the failure.
  assert.ok(!existsSync(wav.replace(/\.wav$/, '.analysis.json')))
})

test('beat analyze on a .beat file redirects to analyze-structure', (t) => {
  if (!hasPython) return t.skip('no python3')
  const out = beat(['analyze', 'song.beat'])
  assert.equal(out.status, 2)
  assert.match(out.stdout + out.stderr, /use: beat analyze-structure song\.beat/)
})

test('beat analyze --doctor --json parses and reports stub ok / beatthis missing', (t) => {
  if (!hasPython) return t.skip('no python3')
  const out = beat(['analyze', '--doctor', '--json'])
  assert.equal(out.status, 0, out.stderr)
  const report = JSON.parse(out.stdout)
  assert.equal(report.pythonFound, true)
  assert.ok(typeof report.python === 'string' && report.python !== '')
  assert.ok(typeof report.interpreter === 'string')
  assert.equal(report.backends.stub.ok, true)
  assert.equal(report.backends.beatthis.ok, false)
  assert.ok(report.backends.beatthis.missing.includes('torch'))
})

test('beat analyze --doctor prints a readable (non-JSON) report by default', (t) => {
  if (!hasPython) return t.skip('no python3')
  const out = beat(['analyze', '--doctor'])
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /interpreter:/)
  assert.match(out.stdout, /stub {6}ok/)
  assert.match(out.stdout, /beatthis {2}missing: torch, beat_this/)
})
