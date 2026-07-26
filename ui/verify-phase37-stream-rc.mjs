#!/usr/bin/env node
// Phase 37 Stream RC render proof — prove that a `beat automate-shape` SINE cutoff sweep is
// AUDIBLE, not just written to the file. Build two song-mode projects that are identical except for
// the automation: SWEPT has a sine cutoff sweep (300 -> 6000 Hz, 2 cycles) on a bright resonant saw
// clip; BASELINE has the same clip with a flat cutoff and no automation lane. Render each through
// dotbeat's own engine (cli/render.mjs, headless Chromium — the D15 canonical render path), window
// each WAV into 12 equal time slices, and compute analyze().spectral.centroidHz per slice. A real
// filter sweep makes the swept render's per-slice centroid RANGE swing far wider than the flat
// baseline's — we assert >= 3x. Automation only plays in SONG mode (engine.ts contentOf returns an
// empty automation map in loop mode), so both projects declare a scene + song section.
//
// Usage: CHROME_PATH=/opt/pw-browsers/chromium node ui/verify-phase37-stream-rc.mjs
//
// Ported to ui/verify-lib.mjs (W1.5): the build step and the `beat` spawn wrapper come from the
// shared harness. This script needs no browser of its own — cli/render.mjs owns that — so it is
// one of the smallest possible ports and a good illustration of the shape.

import { readFileSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { beat, buildAll, check, importDist, repoRoot, run as runVerify } from './verify-lib.mjs'

const render = join(repoRoot, 'cli', 'render.mjs')

// Build a song-mode project with a bright resonant sustained saw. `withSweep` adds the sine cutoff
// automation via `beat automate-shape`; without it the cutoff stays flat at 2000 Hz.
function buildProject(dir, name, withSweep) {
  const file = join(dir, name)
  beat(['init', file, '--bpm', '120', '--bars', '4'])
  // A bright, resonant, fully-sustained saw so the filter cutoff dominates the spectral centroid.
  // High resonance puts a moving spectral peak right at the cutoff, so a sweep drags the centroid
  // with it; a mid-register pitch (48) keeps plenty of harmonics inside the 300..6000 sweep band.
  beat(['set', file, 'lead.osc', 'sawtooth', 'lead.resonance', '12', 'lead.volume', '-8', 'lead.cutoff', '2000', 'lead.attack', '0.005', 'lead.decay', '0.05', 'lead.sustain', '1', 'lead.release', '0.3'])
  // One long note held across all 4 bars (64 sixteenth-steps) — a rich harmonic source for the
  // lowpass to sweep through. Retrigger once mid-way so the amp envelope never fully decays.
  beat(['add-note', file, 'lead', '48', '0', '32', '0.9', '--id', 'n1'])
  beat(['add-note', file, 'lead', '48', '32', '32', '0.9', '--id', 'n2'])
  beat(['clip', file, 'lead', 'c1'])
  if (withSweep) {
    beat(['automate-shape', file, 'lead', 'c1', 'cutoff', 'sine', '--from', '300', '--to', '6000', '--cycles', '2', '--points', '24', '--bars', '4'])
  }
  // Song mode: a scene mapping lead -> c1, played for 4 bars. Required for clip automation to play.
  beat(['scene', file, 's1', 'lead=c1'])
  beat(['song', file, 's1', '4'])
  return file
}

async function centroidSlices(wavPath, nSlices = 12) {
  const { decodeWav, analyze } = await importDist('src/metrics/index.js')
  const bytes = readFileSync(wavPath)
  const dec = decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  const n = dec.channels[0].length
  const out = []
  for (let s = 0; s < nSlices; s++) {
    const a = Math.floor((s * n) / nSlices)
    const b = Math.floor(((s + 1) * n) / nSlices)
    const sliceCh = dec.channels.map((ch) => ch.subarray(a, b))
    out.push(analyze(sliceCh, dec.sampleRate).spectral.centroidHz)
  }
  return out
}

const range = (xs) => Math.max(...xs) - Math.min(...xs)

async function main() {
  buildAll()

  if (process.env.CHROME_PATH && !existsSync(process.env.CHROME_PATH)) {
    throw new Error(`CHROME_PATH=${process.env.CHROME_PATH} does not exist`)
  }

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-rc-'))
  const sweptFile = buildProject(proj, 'swept.beat', true)
  const flatFile = buildProject(proj, 'flat.beat', false)
  const sweptWav = join(proj, 'swept.wav')
  const flatWav = join(proj, 'flat.wav')

  console.log('\nrendering SWEPT (sine cutoff 300->6000, 2 cycles) ...')
  execFileSync(process.execPath, [render, sweptFile, '-o', sweptWav], { stdio: ['ignore', 'inherit', 'inherit'] })
  console.log('rendering BASELINE (flat cutoff 2000) ...')
  execFileSync(process.execPath, [render, flatFile, '-o', flatWav], { stdio: ['ignore', 'inherit', 'inherit'] })

  const swept = await centroidSlices(sweptWav)
  const flat = await centroidSlices(flatWav)

  const fmt = (xs) => xs.map((v) => v.toFixed(0).padStart(5)).join(' ')
  console.log('\nper-slice spectral centroid (Hz), 12 windows across the render:')
  console.log(`  SWEPT   : ${fmt(swept)}`)
  console.log(`  BASELINE: ${fmt(flat)}`)
  const sweptRange = range(swept)
  const flatRange = range(flat)
  const ratio = flatRange > 0 ? sweptRange / flatRange : Infinity
  console.log(`\n  SWEPT centroid range   : ${sweptRange.toFixed(0)} Hz  (min ${Math.min(...swept).toFixed(0)} .. max ${Math.max(...swept).toFixed(0)})`)
  console.log(`  BASELINE centroid range: ${flatRange.toFixed(0)} Hz  (min ${Math.min(...flat).toFixed(0)} .. max ${Math.max(...flat).toFixed(0)})`)
  console.log(`  ratio (swept / baseline): ${ratio.toFixed(1)}x`)

  check(
    ratio >= 3,
    `the automate-shape sine sweep moves the spectral centroid ${ratio.toFixed(1)}x more than a flat cutoff ` +
      `(bar: >= 3x; swept range ${sweptRange.toFixed(0)}Hz vs baseline ${flatRange.toFixed(0)}Hz)`,
  )
}

await runVerify('phase37-stream-rc', main)
