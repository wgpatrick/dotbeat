#!/usr/bin/env node
// Phase 34 Stream NC — measure run-to-run render variance (docs/phase-34-plan.md §NC).
//
// Renders the SAME .beat file N times through cli/render.mjs (dotbeat's real engine in headless
// Chromium, real-time capture — D15) and reports per-metric min/max/spread/stddev across runs:
// integrated LUFS, true peak, sample peak, crest, RMS, spectral band shares, centroid, stereo
// correlation/width — plus wav byte length, frame count, and leading silence (first frame with
// any channel above -60 dBFS), which separates *capture-alignment* variance from *DSP* variance.
//
// With --trimmed, additionally re-runs the whole comparison on ALIGNED audio: each run trimmed to
// its own first non-silent frame, then truncated to the shortest trimmed length so every run
// covers the same musical span. If the trimmed table's variance collapses relative to the
// untrimmed one, the dominant source is capture-start alignment jitter (when MediaRecorder starts
// relative to transport start), not the engine's DSP. See docs/render-determinism.md for the
// measured numbers and diagnosis.
//
// Usage:
//   CHROME_PATH=... node scripts/measure-render-determinism.mjs [project.beat] [N] \
//     [--trimmed] [--out-dir <dir>] [--reuse] [--threshold-db <dBFS>]
//
// Defaults: examples/real-groove.beat, N=8, out-dir <tmpdir>/render-determinism-<basename>.
// --reuse skips rendering when run-1.wav..run-N.wav already exist in out-dir (re-analyze only).
// Exits nonzero ONLY on render/decode failure — variance itself is a measurement, not an error.

import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const args = { _: [], trimmed: false, reuse: false, thresholdDb: -60 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--trimmed') args.trimmed = true
    else if (a === '--reuse') args.reuse = true
    else if (a === '--out-dir') args.outDir = argv[++i]
    else if (a === '--threshold-db') args.thresholdDb = Number(argv[++i])
    else args._.push(a)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const beatPath = resolve(args._[0] ?? join(repoRoot, 'examples/real-groove.beat'))
const runs = Number(args._[1] ?? 8)
if (!existsSync(beatPath)) {
  console.error(`no such project: ${beatPath}`)
  process.exit(1)
}
if (!Number.isInteger(runs) || runs < 2) {
  console.error(`N must be an integer >= 2 (got ${args._[1]})`)
  process.exit(1)
}
const outDir = resolve(args.outDir ?? join(tmpdir(), `render-determinism-${basename(beatPath, '.beat')}`))
mkdirSync(outDir, { recursive: true })

// Compiled metrics (same decode/analyze code `beat metrics` uses).
if (!existsSync(join(repoRoot, 'dist/src/metrics/index.js'))) {
  console.error('dist/ missing — run `npm run build` first')
  process.exit(1)
}
const { decodeWav, analyze } = await import(pathToFileURL(join(repoRoot, 'dist/src/metrics/index.js')).href)

function renderOnce(outWav) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(process.execPath, [join(repoRoot, 'cli/render.mjs'), beatPath, '-o', outWav], {
      cwd: repoRoot,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    proc.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`render exited with code ${code}`))))
    proc.on('error', reject)
  })
}

/** First frame index where ANY channel exceeds the amplitude threshold, or -1 if all silent. */
function firstNonSilentFrame(channels, thresholdDb) {
  const amp = Math.pow(10, thresholdDb / 20)
  const frames = channels[0].length
  for (let i = 0; i < frames; i++) {
    for (const ch of channels) if (Math.abs(ch[i]) > amp) return i
  }
  return -1
}

const wavPaths = []
for (let i = 1; i <= runs; i++) {
  const wavPath = join(outDir, `run-${i}.wav`)
  wavPaths.push(wavPath)
  if (args.reuse && existsSync(wavPath)) {
    console.error(`[${i}/${runs}] reusing ${wavPath}`)
    continue
  }
  console.error(`[${i}/${runs}] rendering ${basename(beatPath)} -> ${wavPath}`)
  const t0 = Date.now()
  await renderOnce(wavPath)
  console.error(`[${i}/${runs}] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

// ---- analysis -----------------------------------------------------------------------------

const decoded = wavPaths.map((p) => {
  const bytes = readFileSync(p)
  const wav = decodeWav(bytes)
  return { path: p, byteLength: bytes.length, wav, leadFrame: firstNonSilentFrame(wav.channels, args.thresholdDb) }
})

/** Flatten a MixMetrics into a flat { label: number } row (Infinity-safe). */
function metricRow(m) {
  return {
    'LUFS integrated': m.integratedLufs,
    'true peak dBTP': m.truePeakDbtp,
    'sample peak dBFS': m.samplePeakDbfs,
    'crest dB': m.crestDb,
    'RMS dBFS': m.rmsDbfs,
    'sub %': m.spectral.bandsPct.sub,
    'bass %': m.spectral.bandsPct.bass,
    'mids %': m.spectral.bandsPct.mids,
    'presence %': m.spectral.bandsPct.presence,
    'air %': m.spectral.bandsPct.air,
    'centroid Hz': m.spectral.centroidHz,
    ...(m.stereo ? { 'stereo corr': m.stereo.correlation, 'width dB': m.stereo.widthDb } : {}),
  }
}

function stats(values) {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return { min: NaN, max: NaN, spread: NaN, stddev: NaN, mean: NaN }
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const mean = finite.reduce((s, v) => s + v, 0) / finite.length
  const stddev = Math.sqrt(finite.reduce((s, v) => s + (v - mean) * (v - mean), 0) / finite.length)
  return { min, max, spread: max - min, stddev, mean }
}

function printTable(title, rows) {
  // rows: array of { label: value } per run, all same keys
  const labels = Object.keys(rows[0])
  const w = Math.max(...labels.map((l) => l.length))
  console.log(`\n${title}`)
  console.log(`${'metric'.padEnd(w)}  ${'min'.padStart(10)}  ${'max'.padStart(10)}  ${'spread'.padStart(8)}  ${'stddev'.padStart(8)}`)
  for (const label of labels) {
    const s = stats(rows.map((r) => r[label]))
    const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x)).padStart(10)
    console.log(`${label.padEnd(w)}  ${f(s.min)}  ${f(s.max)}  ${(Number.isFinite(s.spread) ? s.spread.toFixed(3) : 'n/a').padStart(8)}  ${(Number.isFinite(s.stddev) ? s.stddev.toFixed(3) : 'n/a').padStart(8)}`)
  }
}

console.log(`\n=== render determinism: ${basename(beatPath)}, N=${runs} ===`)
console.log(`wavs in ${outDir}`)

// per-run capture facts
console.log(`\nper-run capture (leading silence = first frame with any channel above ${args.thresholdDb} dBFS)`)
for (const d of decoded) {
  const frames = d.wav.channels[0].length
  const leadMs = d.leadFrame < 0 ? NaN : (d.leadFrame / d.wav.sampleRate) * 1000
  console.log(
    `  ${basename(d.path).padEnd(12)} ${String(d.byteLength).padStart(10)} bytes  ${String(frames).padStart(9)} frames  ${d.wav.durationSeconds.toFixed(3)}s  lead ${Number.isFinite(leadMs) ? leadMs.toFixed(1) : 'all-silent'} ms (frame ${d.leadFrame})`,
  )
}
const byteStats = stats(decoded.map((d) => d.byteLength))
const frameStats = stats(decoded.map((d) => d.wav.channels[0].length))
const leadStats = stats(decoded.map((d) => (d.leadFrame < 0 ? NaN : (d.leadFrame / d.wav.sampleRate) * 1000)))
console.log(`  byte-length spread ${byteStats.spread} bytes; frame spread ${frameStats.spread}; leading-silence spread ${Number.isFinite(leadStats.spread) ? leadStats.spread.toFixed(1) : 'n/a'} ms`)

const untrimmedRows = decoded.map((d) => metricRow(analyze(d.wav.channels, d.wav.sampleRate)))
printTable('UNTRIMMED (raw capture, as `beat render` writes it)', untrimmedRows)

if (args.trimmed) {
  const trimmed = decoded.map((d) => ({
    ...d,
    channels: d.wav.channels.map((ch) => ch.subarray(Math.max(d.leadFrame, 0))),
  }))
  const minLen = Math.min(...trimmed.map((t) => t.channels[0].length))
  const alignedRows = trimmed.map((t) => metricRow(analyze(t.channels.map((ch) => ch.subarray(0, minLen)), t.wav.sampleRate)))
  printTable(`TRIMMED (each run cut to its first non-silent frame, all truncated to ${minLen} frames — alignment removed)`, alignedRows)
  console.log('\nIf the trimmed spread collapses vs untrimmed, the variance is capture-start alignment jitter, not DSP.')
}
