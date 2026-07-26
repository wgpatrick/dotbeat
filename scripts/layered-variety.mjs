#!/usr/bin/env node
// The VARIETY set: N different layered architectures rendering the SAME figure, side by side.
//
// WHY (owner ear report, 2026-07-26): "One thing I noticed with all the layering... is it makes
// everything sort of sound the same-ish. Something to watch out for." `scripts/layered-check.mjs`
// answers a different question — layered versus unlayered on one clip — and structurally cannot
// answer this one, because it varies the FIGURE and the architecture together, so a listener cannot
// tell whether two clips differ because the notes changed or because the instrument did.
//
// Here the figure, the key, the tempo and the loudness are all held constant and ONLY the
// architecture moves. If the set still sounds same-ish, the sweep has not fixed anything, and that
// verdict is available in about a minute of listening.
//
//   node scripts/layered-variety.mjs [--role bassline] [--count 6] [--seed 41] [--out <dir>]
//
// Run `npm run build` first — this drives the compiled dist/.

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const role = arg('--role', 'bassline')
const count = Number(arg('--count', '6'))
const figureSeed = Number(arg('--seed', '41'))
const outDir = resolve(arg('--out', join(process.env.HOME, 'Documents/dotbeat/taste-dataset/layered-variety')))

const { parse } = await import(`${repoRoot}/dist/src/core/index.js`)
const { generateSeedBeat } = await import(`${repoRoot}/dist/src/taste/seeds.js`)
const { inferSeedKey, composePitchedPhrase, soloForShowdown, applyComposedPhrase, extendToFourBars, applyProductionTreatment } = await import(`${repoRoot}/dist/src/taste/showdown.js`)
const { buildLayeredClip, layeredArchitecture, layeredFeatures, verifyLayeredTargets, architectureFingerprint } = await import(`${repoRoot}/dist/src/taste/layered.js`)
const { writeVaryBatch, renderVaryBatch, normalizeBatchLoudness } = await import(`${repoRoot}/dist/src/vary/batch.js`)
const { analyze, decodeWav } = await import(`${repoRoot}/dist/src/metrics/index.js`)

const SEED_TRACK = { bassline: 'bass', chords: 'chords', lead: 'arp' }

const clipDir = join(outDir, `${role}-${figureSeed}`)
rmSync(clipDir, { recursive: true, force: true })
mkdirSync(clipDir, { recursive: true })
writeFileSync(join(outDir, '.gitignore'), '# private variety renders — never committed\n*\n')

const seedText = generateSeedBeat(figureSeed).text
const seedPath = join(clipDir, 'seed.beat')
writeFileSync(seedPath, seedText)
const seedDoc = parse(seedText)
const key = inferSeedKey(seedDoc)
const bpm = seedDoc.bpm
const phrase = composePitchedPhrase(role, key, figureSeed)

// arm 0 is the UNLAYERED reference — the arm the owner said he preferred, kept in the set so the
// comparison stays honest rather than being layered-versus-layered only
const extended = { ...extendToFourBars(seedDoc), bpm }
const soloed = soloForShowdown(applyComposedPhrase(extended, SEED_TRACK[role], phrase), SEED_TRACK[role])
const engineplus = applyProductionTreatment(soloed, SEED_TRACK[role])

const picks = []
const seen = new Set()
for (let seed = figureSeed; picks.length < count && seed < figureSeed + 500; seed++) {
  const arch = layeredArchitecture(role, seed)
  // one clip per FAMILY, so the set spans the sweep's coarse axis instead of six near-twins
  if (seen.has(arch.draw.family)) continue
  seen.add(arch.draw.family)
  picks.push({ seed, arch })
}

const variants = [
  { doc: engineplus.doc, recipe: `engineplus (UNLAYERED reference): ${phrase.archetype} soloed + frozen production` },
  ...picks.map((p) => ({ doc: buildLayeredClip(role, phrase, bpm, { arch: p.arch }).doc, recipe: `layered [${p.arch.draw.family}] arch seed ${p.seed}: ${p.arch.summary}` })),
]

writeVaryBatch({ parentPath: seedPath, parentText: seedText, track: SEED_TRACK[role], group: 'layered-variety', count: variants.length, seed: figureSeed, outDir: clipDir, variants })
renderVaryBatch(clipDir, variants.length, { normalize: false })
normalizeBatchLoudness(clipDir, variants.length)

const num = (x) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)) : 'n/a')
const FEATURES = ['bandSubPct', 'bandBassPct', 'bandMidsPct', 'centroidHz', 'stereoWidthDb', 'crestSubDb', 'articulationDb', 'characterLevelDb']

process.stdout.write(`\n=== ${role} VARIETY — one figure ("${phrase.archetype}", seed ${figureSeed}, ${bpm} BPM), ${picks.length} architectures + the unlayered reference\n`)
process.stdout.write(`    ${'file'.padEnd(9)}${'family'.padEnd(24)}${FEATURES.map((f) => f.slice(0, 9).padStart(11)).join('')}  targets\n`)

const rows = []
for (let i = 0; i < variants.length; i++) {
  const src = join(clipDir, `v${i + 1}.wav`)
  if (!existsSync(src)) { process.stdout.write(`    v${i + 1}: NO RENDER\n`); continue }
  const label = i === 0 ? 'engineplus' : `layered-${picks[i - 1].arch.draw.family}`
  copyFileSync(src, join(clipDir, `${String(i).padStart(2, '0')}-${label}.wav`))
  const { channels, sampleRate } = decodeWav(readFileSync(src))
  const f = layeredFeatures(analyze(channels, sampleRate), channels, sampleRate)
  const v = verifyLayeredTargets(role, f)
  const family = i === 0 ? 'UNLAYERED (engineplus)' : picks[i - 1].arch.draw.family
  rows.push({ file: `v${i + 1}.wav`, family, seed: i === 0 ? null : picks[i - 1].seed, fingerprint: i === 0 ? null : architectureFingerprint(picks[i - 1].arch), summary: i === 0 ? null : picks[i - 1].arch.summary, features: f, passed: v.passed, total: v.total })
  process.stdout.write(`    ${`v${i + 1}.wav`.padEnd(9)}${family.padEnd(24)}${FEATURES.map((k) => num(f[k]).padStart(11)).join('')}  ${v.passed}/${v.total}\n`)
}

// the spread across the set IS the answer to "does it all sound the same" — a set whose features
// barely move is a set of near-twins no matter how different the architectures look on paper
process.stdout.write(`\n    ${'feature'.padEnd(20)}${['min', 'max', 'SPREAD'].map((h) => h.padStart(11)).join('')}\n`)
const layeredRows = rows.filter((r) => r.seed !== null)
for (const k of FEATURES) {
  const xs = layeredRows.map((r) => r.features[k]).filter(Number.isFinite)
  process.stdout.write(`    ${k.padEnd(20)}${[Math.min(...xs), Math.max(...xs), Math.max(...xs) - Math.min(...xs)].map((x) => num(x).padStart(11)).join('')}\n`)
}

writeFileSync(join(clipDir, 'variety.json'), JSON.stringify({ generatedAt: new Date().toISOString(), role, figureSeed, archetype: phrase.archetype, bpm, rows }, null, 2) + '\n')
process.stdout.write(`\nrenders + variety.json in ${clipDir} (private)\n`)
