#!/usr/bin/env node
// Per-role reference-pool feature distributions, measured over EVERY file in a cleaned pool with
// the same `analyze()` every other dotbeat surface uses.
//
// WHY THIS EXISTS (owner ear report, 2026-07-26). The layered arm's gates were written as
// one-sided thresholds ("bandSubPct >= 30") taken from a single quoted reference NUMBER. A
// floor-only gate cannot fail for overshoot, and the layered bassline promptly overshot it to
// 96.1% sub — measurably "on target", audibly a featureless subwoofer tone. The owner preferred
// the unlayered bass. The general fix is to derive gates as RANGES centred on the reference
// distribution, which needs the distribution, not one number: that is what this prints.
//
//   node scripts/ref-pool-stats.mjs [--pool <dir>] [--out <file.json>] [--roles bassline,chords,lead]
//
// Default pool: ~/Documents/dotbeat/taste-dataset/refs-packs (private, never committed).
// Run `npm run build` first — this drives the compiled dist/.

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const poolDir = resolve(arg('--pool', join(process.env.HOME, 'Documents/dotbeat/taste-dataset/refs-packs')))
const roles = arg('--roles', 'bassline,chords,lead,drum-loop').split(',').filter(Boolean)
const outPath = arg('--out', '')

const { analyze, decodeWav } = await import(`${repoRoot}/dist/src/metrics/index.js`)
const { layeredFeatures } = await import(`${repoRoot}/dist/src/taste/layered.js`)

export const FEATURES = ['bandSubPct', 'bandBassPct', 'bandMidsPct', 'bandPresencePct', 'bandAirPct', 'centroidHz', 'stereoWidthDb', 'stereoCorrelation', 'crestDb', 'truePeakDb']

const quantile = (sorted, q) => {
  if (sorted.length === 0) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

const num = (x) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)) : 'n/a')

const out = {}
for (const role of roles) {
  const dir = join(poolDir, role)
  if (!existsSync(dir)) {
    process.stdout.write(`${role}: no pool dir at ${dir} — skipped\n`)
    continue
  }
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.wav') && statSync(join(dir, f)).isFile())
  const rows = []
  for (const f of files) {
    try {
      const { channels, sampleRate } = decodeWav(readFileSync(join(dir, f)))
      rows.push({ file: f, features: layeredFeatures(analyze(channels, sampleRate)) })
    } catch (err) {
      process.stderr.write(`  ${role}/${f}: unreadable (${err.message})\n`)
    }
  }
  const stats = {}
  for (const key of FEATURES) {
    const xs = rows.map((r) => r.features[key]).filter(Number.isFinite).sort((a, b) => a - b)
    stats[key] = { n: xs.length, p10: quantile(xs, 0.1), p25: quantile(xs, 0.25), p50: quantile(xs, 0.5), p75: quantile(xs, 0.75), p90: quantile(xs, 0.9), min: xs[0], max: xs[xs.length - 1] }
  }
  out[role] = { n: rows.length, stats, files: rows.map((r) => ({ file: r.file, features: r.features })) }

  process.stdout.write(`\n=== ${role} — n=${rows.length}\n`)
  process.stdout.write(`  ${'feature'.padEnd(20)}${['p10', 'p25', 'MEDIAN', 'p75', 'p90'].map((h) => h.padStart(11)).join('')}\n`)
  for (const key of FEATURES) {
    const s = stats[key]
    process.stdout.write(`  ${key.padEnd(20)}${[s.p10, s.p25, s.p50, s.p75, s.p90].map((x) => num(x).padStart(11)).join('')}\n`)
  }
}

if (outPath) {
  writeFileSync(resolve(outPath), JSON.stringify({ generatedAt: new Date().toISOString(), poolDir, roles, pools: out }, null, 2) + '\n')
  process.stdout.write(`\nwrote ${resolve(outPath)}\n`)
}
