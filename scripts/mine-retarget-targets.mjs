// Mine per-role retarget TARGETS from the owner's own pack-ref pool (research/138 B2: role targets
// are "regenerated from data, never hand-tuned"; research/131 §7 quotes the same medians from a
// separate python pipeline).
//
// WHY THIS EXISTS rather than transcribing 131's numbers: src/retarget/features.ts re-implements
// 131's feature definitions from prose, so its absolute scale need not match that pipeline's. Run
// BOTH over the same pack-ref pool and the target and the measurement live in the same units by
// construction — and the printout below lets a reader check the re-implementation against 131's
// published medians axis by axis (agreements and disagreements both reported, never averaged).
//
// PRIVACY: reads private audio under ~/Documents/dotbeat/taste-dataset/refs-packs. It prints and
// writes AGGREGATE STATISTICS ONLY — no filenames, no audio, no per-clip rows — the same rule
// research/131 followed. The output JSON is safe to commit; the input directory is not.
//
// Usage:
//   node scripts/mine-retarget-targets.mjs [--ref-dir DIR] [--out PATH] [--roles a,b,c]
//   node scripts/mine-retarget-targets.mjs --wavs "glob-free dir" --label engine   # any pool

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d
}
const refDir = resolve(flag('--ref-dir', join(homedir(), 'Documents', 'dotbeat', 'taste-dataset', 'refs-packs')))
const roles = flag('--roles', 'bassline,chords,lead,drum-loop').split(',').filter(Boolean)
const outPath = flag('--out', null)
const limit = Number(flag('--limit', '400'))

const { computeRetargetFeatures, RETARGET_FEATURE_KEYS, quantile } = await import(join(repoRoot, 'dist/src/retarget/features.js'))
const { decodeWav } = await import(join(repoRoot, 'dist/src/metrics/index.js'))

function poolStats(dir) {
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.wav')).slice(0, limit)
  const rows = []
  for (const f of files) {
    try {
      const d = decodeWav(readFileSync(join(dir, f)))
      rows.push(computeRetargetFeatures(d.channels, d.sampleRate))
    } catch {
      /* undecodable clip — skipped, counted by the n gap */
    }
  }
  if (rows.length === 0) return null
  const stats = {}
  for (const key of RETARGET_FEATURE_KEYS) {
    const sorted = rows.map((r) => r[key]).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
    if (sorted.length === 0) continue
    stats[key] = {
      p10: round(quantile(sorted, 0.1)),
      p25: round(quantile(sorted, 0.25)),
      p50: round(quantile(sorted, 0.5)),
      p75: round(quantile(sorted, 0.75)),
      p90: round(quantile(sorted, 0.9)),
    }
  }
  return { n: rows.length, files: files.length, durationMedian: round(quantile(rows.map((r) => r.durationSeconds).sort((a, b) => a - b), 0.5)), stats }
}

const round = (x) => Math.round(x * 1000) / 1000

const out = { generatedAt: new Date().toISOString(), pool: 'refs-packs', refDir: '(private — path elided)', roles: {} }
for (const role of roles) {
  const s = poolStats(join(refDir, role))
  if (!s) {
    process.stderr.write(`role ${role}: no decodable wavs under ${join(refDir, role)}\n`)
    continue
  }
  out.roles[role] = s
  process.stderr.write(`role ${role}: n=${s.n}/${s.files}, median duration ${s.durationMedian}s\n`)
  for (const key of RETARGET_FEATURE_KEYS) {
    const q = s.stats[key]
    if (!q) continue
    process.stderr.write(`  ${key.padEnd(18)} p10 ${String(q.p10).padStart(9)}  p25 ${String(q.p25).padStart(9)}  p50 ${String(q.p50).padStart(9)}  p75 ${String(q.p75).padStart(9)}  p90 ${String(q.p90).padStart(9)}\n`)
  }
}

const json = JSON.stringify(out, null, 2) + '\n'
if (outPath) {
  writeFileSync(resolve(outPath), json)
  process.stderr.write(`wrote ${resolve(outPath)}\n`)
} else {
  process.stdout.write(json)
}
