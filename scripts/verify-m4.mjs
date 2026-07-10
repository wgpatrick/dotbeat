#!/usr/bin/env node
// Phase 4 verification — docs/phase-4-plan.md §4.4: render the same real .beat file through
// BOTH paths (headless-Chromium reference, offline node-web-audio-api) and compare the
// deterministic metrics within stated tolerances (D5, adapted: the reference path passes
// through MediaRecorder's lossy opus encode, so byte comparison is impossible by construction).
//
// Usage: node scripts/verify-m4.mjs --beatlab-dir /path/to/beatlab

import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--beatlab-dir') args.beatlabDir = argv[++i]
  return args
}

function run(args) {
  return execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

async function main() {
  const { beatlabDir = process.env.BEATLAB_DIR } = parseArgs(process.argv.slice(2))
  if (!beatlabDir) {
    console.error('need a beatlab checkout: pass --beatlab-dir <path> or set BEATLAB_DIR')
    process.exit(1)
  }
  const song = join(repoRoot, 'examples', 'real-groove.beat')
  const dir = mkdtempSync(join(tmpdir(), 'beat-m4-'))

  console.log('rendering via headless Chromium (the reference)...')
  const tChromium = performance.now()
  run([join(repoRoot, 'cli', 'render.mjs'), song, '-o', join(dir, 'reference.wav'), '--beatlab-dir', beatlabDir, '--port', '5883'])
  const chromiumMs = performance.now() - tChromium

  console.log('rendering via offline node-web-audio-api...')
  const tOffline = performance.now()
  run([join(repoRoot, 'cli', 'render-offline.mjs'), song, '-o', join(dir, 'offline.wav'), '--beatlab-dir', beatlabDir])
  const offlineMs = performance.now() - tOffline

  const ref = JSON.parse(run([join(repoRoot, 'cli', 'beat.mjs'), 'metrics', join(dir, 'reference.wav'), '--json']))
  const off = JSON.parse(run([join(repoRoot, 'cli', 'beat.mjs'), 'metrics', join(dir, 'offline.wav'), '--json']))

  // The two Web Audio implementations apply different DynamicsCompressor auto-makeup formulas
  // (measured: ~2 dB per stage; the master limiter + drum-bus compressor stack it into a
  // CONSTANT level offset — ROADMAP Risk #6, now measured rather than hypothetical). So the
  // fidelity contract is: same music, same spectrum, same dynamics, and a level offset that is
  // consistent (LUFS offset ≈ peak offset — i.e. pure gain, not distortion), reported not hidden.
  const lufsOffset = ref.integratedLufs - off.integratedLufs
  const peakOffset = ref.samplePeakDbfs - off.samplePeakDbfs
  const checks = [
    { name: 'duration', ref: ref.durationSeconds, off: off.durationSeconds, tol: 0.15, unit: 's' },
    { name: 'crest (dynamics preserved)', ref: ref.crestDb, off: off.crestDb, tol: 2.0, unit: 'dB' },
    { name: 'bass band share', ref: ref.spectral.bandsPct.bass, off: off.spectral.bandsPct.bass, tol: 8, unit: '%' },
    { name: 'mids band share', ref: ref.spectral.bandsPct.mids, off: off.spectral.bandsPct.mids, tol: 8, unit: '%' },
    { name: 'presence+air share', ref: ref.spectral.bandsPct.presence + ref.spectral.bandsPct.air, off: off.spectral.bandsPct.presence + off.spectral.bandsPct.air, tol: 8, unit: '%' },
    { name: 'level offset consistency (LUFS-vs-peak)', ref: lufsOffset, off: peakOffset, tol: 2.0, unit: 'dB' },
  ]
  let failed = 0
  for (const c of checks) {
    const delta = Math.abs(c.ref - c.off)
    const ok = delta <= c.tol
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} ${c.name}: reference ${c.ref.toFixed(2)} vs offline ${c.off.toFixed(2)} (Δ ${delta.toFixed(2)} ${c.unit}, tol ${c.tol})`)
  }
  console.log(`\nmeasured constant level offset (compressor-makeup divergence): ${lufsOffset.toFixed(2)} LU (peak agrees at ${peakOffset.toFixed(2)} dB)`)
  console.log(`wall-clock: chromium ${Math.round(chromiumMs / 1000)}s (incl. vite+browser boot) vs offline ${Math.round(offlineMs / 1000)}s — ${(chromiumMs / offlineMs).toFixed(1)}x`)
  console.log(`work dir kept: ${dir}`)
  if (failed) throw new Error(`${failed} metric(s) outside tolerance — offline path diverges from the reference beyond the known constant offset`)
  console.log('M4 fidelity: same music, same spectrum, same dynamics; constant level offset measured and reported above')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.stack ?? String(err))
    process.exit(1)
  })
