#!/usr/bin/env node
// D20 (research/140) / usability pilot 109 HIGH finding: `beat render --offline` did not reproduce
// for any project using a noise-based drum voice.
//
// Tone's NoiseSynth is unseeded twice over — the noise buffer is drawn from Math.random() at
// construction (so it differs per PROCESS) and a fresh Math.random() read offset is chosen on every
// trigger (so it differs per HIT). Pilot 109 measured two `--offline` renders of the same file
// differing across ~19% of samples, by up to 42% full scale, and the finding was closed by making
// `beat help render` honest rather than by fixing it. Meanwhile src/taste/embeddings.ts caches
// per-wav features keyed on the audio's sha256, so an unseeded voice means one .beat file has
// unboundedly many audio identities and every golden or regression comparison over a drum project
// is comparing noise.
//
// The fix (ui/src/audio/engine.ts SeededNoiseSynth) seeds the buffer per (track, lane) and makes
// the read offset a pure function of (seed, trigger time). This script is the gate: render the SAME
// project twice, through two separate harness boots (two processes — the point is that the noise
// does not depend on process state), and assert the PCM is identical.
//
// The bar is not "byte-identical bytes". Pilot 109 also measured a residual ~0.07% of samples
// differing by exactly 1 LSB on pure OSCILLATOR content, which is float-rounding in the offline
// mix, predates this work, and is not what this script is about. So: max absolute difference <= 1
// LSB, which a single unseeded noise hit blows past by four orders of magnitude.
//
//   node scripts/verify-offline-noise-reproducible.mjs

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const beat = join(repoRoot, 'cli', 'beat.mjs')

const dir = mkdtempSync(join(tmpdir(), 'beat-offline-noise-'))
const file = join(dir, 'kit.beat')

const run = (...args) => execFileSync(process.execPath, [beat, ...args], { encoding: 'utf8', cwd: dir })

/** Int16 PCM samples out of a canonical 16-bit WAV (what `beat render` writes). */
function pcm(path) {
  const b = readFileSync(path)
  let o = 12
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4)
    const size = b.readUInt32LE(o + 4)
    if (id === 'data') {
      const data = b.subarray(o + 8, o + 8 + size)
      return new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2))
    }
    o += 8 + size + (size % 2)
  }
  throw new Error(`no data chunk in ${path}`)
}

try {
  // A project whose audible content is ENTIRELY noise voices: snare (white) and clap (pink) on the
  // legacy kit. No oscillator content at all, so the 1-LSB float-rounding residual has nowhere to
  // come from and any difference this script sees is the thing it is testing.
  run('init', file)
  run('add-track', file, 'kit', 'drums')
  for (const step of [0, 4, 8, 12]) run('add-hit', file, 'kit', 'snare', String(step), '0.9')
  for (const step of [2, 6, 10, 14]) run('add-hit', file, 'kit', 'clap', String(step), '0.7')

  // Two separate `beat render` processes: the whole point is that the noise is a function of the
  // DOCUMENT, not of whatever Math.random() happened to hand this process at startup.
  run('render', file, '--offline', '-o', join(dir, 'a.wav'))
  run('render', file, '--offline', '-o', join(dir, 'b.wav'))

  const a = pcm(join(dir, 'a.wav'))
  const b = pcm(join(dir, 'b.wav'))
  assert.equal(a.length, b.length, 'the two renders are different lengths')
  assert.ok(a.length > 100000, `render is suspiciously short (${a.length} samples) — the project may not have rendered`)

  let peak = 0
  let differing = 0
  let energy = 0
  for (let i = 0; i < a.length; i++) {
    energy = Math.max(energy, Math.abs(a[i]))
    const d = Math.abs(a[i] - b[i])
    if (d > 0) {
      differing++
      if (d > peak) peak = d
    }
  }

  // Guard against passing on two identical SILENT renders — the drums must actually be audible.
  assert.ok(energy > 1000, `both renders are near-silent (peak ${energy}/32767) — the noise voices did not sound, so this proves nothing`)

  const pct = ((100 * peak) / 32767).toFixed(4)
  console.log(`[offline-noise] ${a.length} samples, ${differing} differing, max diff ${peak}/32767 (${pct}% FS), peak level ${energy}/32767`)
  assert.ok(
    peak <= 1,
    `two --offline renders of the same all-noise project differ by ${peak}/32767 (${pct}% FS). ` +
      'The drum noise voices are unseeded again — see SeededNoiseSynth in ui/src/audio/engine.ts. ' +
      'Pilot 109 measured 42% FS before the fix; the allowed residual is the 1-LSB offline float-rounding.',
  )
  console.log('[offline-noise] PASS — the same document renders the same audio')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
