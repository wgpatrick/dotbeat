// Phase 40 Stream VC — the INVERSE of the degrade-path tests: assertions that only mean something
// on a machine where the ML backends are actually installed (`python/.venv`, see python/README.md).
//
// Run with `npm run test:sidecars`. Deliberately NOT part of `npm test`: the filename doesn't match
// its `dist/test/*.test.js` glob, because these need a real venv and real model weights that CI
// structurally cannot have — which is the whole point. analyze-sidecar/gen-sidecar cover the
// degrade path where the deps are genuinely absent (CI); this covers the working path where they're
// genuinely present (owner-side). Together they mean red is real in both places.
//
// If the venv ISN'T installed, every test here skips with the setup hint rather than failing —
// the same rule the degrade-path tests now follow, pointed the other way.
//
// `beat source gen --backend stableaudio` is deliberately NOT exercised: it costs ~2 minutes per
// one-shot on CPU (measured 2026-07-14), which is too slow for a suite anyone runs casually.
// `beat regen --verify` is the honest place to pay that cost, on purpose, against a real project.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

const SETUP_HINT =
  'ML backends not installed (python/.venv) — owner-side only; see python/README.md. ' +
  'Python must be 3.10 for stable-audio-tools.'

function beat(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' }), stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

function doctor(args: string[]): Record<string, any> | null {
  const out = beat(args)
  if (out.status !== 0) return null
  try {
    return JSON.parse(out.stdout)
  } catch {
    return null
  }
}

const analyzeDoctor = doctor(['analyze', '--doctor', '--json'])
const genDoctor = doctor(['source', 'gen', '--doctor'])
const hasBeatthis = analyzeDoctor?.backends?.beatthis?.ok === true
const hasStableaudio = genDoctor?.backends?.stableaudio?.ok === true

/** 16-bit PCM stereo sine WAV — same helper shape as analyze-sidecar.test.ts. */
function writeTestWav(path: string, freq: number, seconds: number): void {
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
    const v = Math.round(0.4 * Math.sin((2 * Math.PI * freq * i) / FS) * 32767)
    for (let c = 0; c < ch; c++) { buf.writeInt16LE(v, o); o += 2 }
  }
  writeFileSync(path, buf)
}

test('the venv interpreter is Python 3.10 (stable-audio-tools requires >=3.10,<3.11)', (t) => {
  if (!hasStableaudio && !hasBeatthis) return t.skip(SETUP_HINT)
  const version = String(genDoctor?.python ?? analyzeDoctor?.python ?? '')
  assert.match(version, /^3\.10\./, `venv Python is ${version}; stable-audio-tools pins >=3.10,<3.11 (python/README.md)`)
})

test('--doctor reports the INSTALLED backends ok with nothing missing', (t) => {
  if (!hasStableaudio && !hasBeatthis) return t.skip(SETUP_HINT)
  // The assertion CI structurally cannot make: absence-of-missing on a working install. The
  // degrade-path tests assert the exact opposite, and are skipped here.
  if (hasBeatthis) {
    assert.equal(analyzeDoctor?.backends?.beatthis?.ok, true)
    assert.deepEqual(analyzeDoctor?.backends?.beatthis?.missing ?? [], [])
  }
  if (hasStableaudio) {
    assert.equal(genDoctor?.backends?.stableaudio?.ok, true)
    assert.deepEqual(genDoctor?.backends?.stableaudio?.missing ?? [], [])
  }
  assert.match(String(genDoctor?.interpreter ?? analyzeDoctor?.interpreter), /\.venv/, 'doctor resolved the venv, not a bare python3')
})

test('beat analyze --backend beatthis really analyzes a WAV (the path CI can only see fail)', (t) => {
  if (!hasBeatthis) return t.skip(SETUP_HINT)
  const dir = mkdtempSync(join(tmpdir(), 'beat-owner-analyze-'))
  const wav = join(dir, 'ref.wav')
  writeTestWav(wav, 220, 6)
  const out = beat(['analyze', wav, '--backend', 'beatthis'])
  // Phase 39's real-run bugs were all here: beat_this needs an undeclared soundfile, and without it
  // EVERY real analyze died on "Could not load audio". That's the regression this test exists for.
  assert.equal(out.status, 0, `real beatthis analyze failed:\n${out.stdout}${out.stderr}`)
  assert.doesNotMatch(out.stdout + out.stderr, /Could not load audio/)

  const artifactPath = wav.replace(/\.wav$/, '.analysis.json')
  assert.ok(existsSync(artifactPath), 'analysis.json written beside the audio')
  const a = JSON.parse(readFileSync(artifactPath, 'utf8'))
  assert.equal(a.dotbeatAnalysis, 1)
  assert.equal(a.backend.name, 'beatthis')
  assert.ok(a.backend.model, 'a real model is named in the artifact (the stub records null)')
  // No known-answer BPM assertion: a 220Hz sine has no beat, and inventing an expectation for what
  // a real detector "should" say about it would be exactly the false precision D20 warns against.
  // What's provable is that it ran, produced the frozen envelope, and hashed the real bytes.
  assert.ok(typeof a.bpm === 'number' && a.bpm > 0, 'a real bpm came back')
  assert.equal(a.source.durationSeconds, 6)
})

// ---- embed sidecar (taste loop) ---------------------------------------------------------------

const embedPy = join(repoRoot, 'python', 'embed.py')

/** Same resolution order as src/analysis/sidecar.ts resolvePython — BEAT_PYTHON, repo venv, PATH. */
function resolveSidecarPython(): string {
  const override = process.env.BEAT_PYTHON
  if (override && override.trim() !== '') return override.trim()
  const venv = join(repoRoot, 'python', '.venv', 'bin', 'python3')
  if (existsSync(venv)) return venv
  return 'python3'
}

function embedSidecar(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    return {
      status: 0,
      stdout: execFileSync(resolveSidecarPython(), [embedPy, ...args], {
        encoding: 'utf8',
        // The owner's stored HF token has gone invalid before, and a bad implicit token makes
        // hub requests for PUBLIC repos hang/401 (observed 2026-07-18: three model loads hung
        // at 0% CPU). The models embed.py loads are all public — never send the stored token.
        env: { ...process.env, HF_HUB_DISABLE_IMPLICIT_TOKEN: '1' },
      }),
      stderr: '',
    }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

function embedDoctor(): Record<string, any> | null {
  const out = embedSidecar(['--doctor'])
  if (out.status !== 0) return null
  try {
    return JSON.parse(out.stdout)
  } catch {
    return null
  }
}

const embedDoc = embedDoctor()
const hasClap = embedDoc?.backends?.clap?.available === true

test('clap embeds SHORT and LONG clips to the same fixed dims (the fusion-pooling regression)', (t) => {
  if (!hasClap) return t.skip(SETUP_HINT)
  // The 2026-07-18 bug: transformers 5.x get_audio_features returns an output object whose
  // pooler_output is the projected clip embedding; grabbing it positionally cached
  // last_hidden_state instead — dims that VARIED with clip length (1024 vs 65536), silently
  // corrupting every centroid built from them. A >10s clip triggers CLAP's feature-fusion
  // path (multiple windows), so short-vs-long is exactly the contrast that regresses.
  const dir = mkdtempSync(join(tmpdir(), 'beat-owner-embed-'))
  const short = join(dir, 'short.wav')
  const long = join(dir, 'long.wav')
  writeTestWav(short, 440, 1)
  writeTestWav(long, 220, 12)
  const results = [short, long].map((wav) => {
    const out = embedSidecar(['--backend', 'clap', '--input', wav])
    assert.equal(out.status, 0, `real clap embed failed on ${wav}:\n${out.stdout}${out.stderr}`)
    const parsed = JSON.parse(out.stdout) as { backend: string; dims: number; embedding: number[] }
    assert.equal(parsed.backend, 'clap')
    assert.equal(parsed.dims, parsed.embedding.length)
    return parsed
  })
  assert.equal(results[0]!.dims, results[1]!.dims, 'clip length must never change embedding dims')
  // The default checkpoint (laion/larger_clap_music) projects to exactly 512; a 1024-wide vector
  // here means hidden states leaked through again.
  assert.equal(results[0]!.dims, 512)
})

test('beat source gen --backend stub still routes through the venv interpreter', (t) => {
  if (!hasStableaudio) return t.skip(SETUP_HINT)
  // Cheap guard on the contract Phase 39 found broken owner-side: stable-audio-tools print()s
  // warnings to STDOUT, which breaks the "stdout is exactly one JSON line" contract the gen path
  // parses strictly. The stub run proves the parse survives THIS interpreter's import-time noise.
  const dir = mkdtempSync(join(tmpdir(), 'beat-owner-gen-'))
  const beatFile = join(dir, 'song.beat')
  assert.equal(beat(['init', beatFile]).status, 0)
  const out = beat(['source', 'gen', beatFile, 'g', 'a tick', '--backend', 'stub', '--seconds', '1', '--seed', '3'])
  assert.equal(out.status, 0, `${out.stdout}${out.stderr}`)
  assert.match(out.stdout, /registered g/)
})
