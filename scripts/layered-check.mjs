#!/usr/bin/env node
// The layered arm's render-side proof (research 138 §3 B4 / §4 rung 5).
//
// Builds N layered clips per pitched role, renders each in THREE arms holding the figure, the key
// and the tempo constant — `engineplus` (the frozen single-voice production ablation), `layered`
// (the multi-voice architecture, no production) and `layeredplus` (architecture + the per-layer
// production pass) — loudness-normalizes each triple together exactly the way a real showdown batch
// is normalized, then measures every render with the SAME `analyze()` every other dotbeat surface
// uses and checks it against the per-role measured targets in src/taste/layered.ts.
//
// Output: one before/after feature table per clip plus a roll-up, and the renders themselves in the
// output dir so the owner can listen. The output dir is PRIVATE by convention (taste-dataset/) and
// is never committed.
//
//   node scripts/layered-check.mjs [--out <dir>] [--per-role 2] [--seed 41]
//
// Run `npm run build` first — this drives the compiled dist/.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const outDir = resolve(arg('--out', join(process.env.HOME, 'Documents/dotbeat/taste-dataset/layered-check')))
const perRole = Number(arg('--per-role', '2'))
const metaSeed = Number(arg('--seed', '41'))
const onlyRoles = arg('--roles', '').split(',').filter(Boolean)

const { parse, serialize } = await import(`${repoRoot}/dist/src/core/index.js`)
const { generateSeedBeat } = await import(`${repoRoot}/dist/src/taste/seeds.js`)
const {
  inferSeedKey,
  composePitchedPhrase,
  applyComposedPhrase,
  soloForShowdown,
  extendToFourBars,
  applyProductionTreatment,
} = await import(`${repoRoot}/dist/src/taste/showdown.js`)
const {
  LAYERED_ROLES,
  buildLayeredClip,
  layeredArchitecture,
  layeredFeatures,
  verifyLayeredTargets,
  formatTargetVerification,
  checkCrossover,
} = await import(`${repoRoot}/dist/src/taste/layered.js`)
const { writeVaryBatch, renderVaryBatch, normalizeBatchLoudness } = await import(`${repoRoot}/dist/src/vary/batch.js`)
const { analyze, decodeWav } = await import(`${repoRoot}/dist/src/metrics/index.js`)

// role -> the taste-seed track that carries it (same map showdown.ts uses)
const SEED_TRACK = { bassline: 'bass', chords: 'chords', lead: 'arp' }
const ARMS = ['engineplus', 'layered', 'layeredplus']

mkdirSync(outDir, { recursive: true })
// the private-by-convention marker, so a stray `git add` in a parent repo cannot pick these up
writeFileSync(join(outDir, '.gitignore'), '# private layered-arm renders — never committed\n*\n')

const rows = []
process.stdout.write(`layered check -> ${outDir}\n`)
process.stdout.write(`arms: ${ARMS.join(' vs ')} (same figure, same key, same bpm, normalized together)\n\n`)

const ROLES = onlyRoles.length > 0 ? LAYERED_ROLES.filter((r) => onlyRoles.includes(r)) : LAYERED_ROLES

for (const role of ROLES) {
  process.stdout.write(`=== ${role}\n`)

  for (let n = 0; n < perRole; n++) {
    const batchSeed = metaSeed + n * 1009 + LAYERED_ROLES.indexOf(role) * 97
    const clipDir = join(outDir, `${role}-${batchSeed}`)
    rmSync(clipDir, { recursive: true, force: true })
    mkdirSync(clipDir, { recursive: true })

    // ONE figure for all three arms — the comparison isolates the clip SHAPE, nothing else
    const seedText = generateSeedBeat(batchSeed).text
    const seedPath = join(clipDir, 'seed.beat')
    writeFileSync(seedPath, seedText)
    const seedDoc = parse(seedText)
    const key = inferSeedKey(seedDoc)
    const bpm = seedDoc.bpm
    const phrase = composePitchedPhrase(role, key, batchSeed)

    // arm 1: engineplus — the same figure on the seed's own role track, soloed, frozen production
    const extended = { ...extendToFourBars(seedDoc), bpm }
    const soloed = soloForShowdown(applyComposedPhrase(extended, SEED_TRACK[role], phrase), SEED_TRACK[role])
    const engineplus = applyProductionTreatment(soloed, SEED_TRACK[role])

    // arms 2 + 3: the layered stack, without and with the per-layer production pass. The
    // architecture is DRAWN from the batch seed (2026-07-26 owner ear report: a frozen architecture
    // made every clip in a round the same instrument), so each clip below is a different stack.
    const arch = layeredArchitecture(role, batchSeed)
    const cross = checkCrossover(arch)
    const layered = buildLayeredClip(role, phrase, bpm, { arch })
    const layeredplus = buildLayeredClip(role, phrase, bpm, { arch, produced: true })

    writeVaryBatch({
      parentPath: seedPath,
      parentText: seedText,
      track: SEED_TRACK[role],
      group: 'layered-check',
      count: 3,
      seed: batchSeed,
      outDir: clipDir,
      variants: [
        { doc: engineplus.doc, recipe: `engineplus: ${phrase.archetype} soloed + frozen production (${engineplus.applied.join(', ')})` },
        { doc: layered.doc, recipe: `layered: ${arch.summary} (shift ${layered.baseShift})` },
        { doc: layeredplus.doc, recipe: `layeredplus: ${arch.summary} + per-layer production (${layeredplus.applied.length} moves)` },
      ],
    })
    renderVaryBatch(clipDir, 3, { normalize: false })
    // normalize the three together, exactly as a showdown batch is — otherwise truePeak/crest
    // comparisons across arms are measuring gain, not production
    normalizeBatchLoudness(clipDir, 3)

    process.stdout.write(`\n--- ${role} seed ${batchSeed} — figure "${phrase.archetype}" in ${key.minor ? 'minor' : 'major'} root ${key.root}, ${bpm} BPM, ${phrase.notes.length} notes\n`)
    process.stdout.write(`    architecture [${arch.draw.family}] ${arch.summary}\n`)
    process.stdout.write(`    crossover ${cross.ok ? 'OK' : 'BROKEN: ' + cross.problems.join('; ')}: ${cross.ladder.map((l) => `${l.id}(${l.mode} ${l.cutoffHz})`).join(' -> ')}\n`)
    process.stdout.write(`    layers: ${layered.layers.map((l) => `${l.id} ${l.loMidi}-${l.hiMidi} @${l.gainDb}dB ${l.band}${l.mono ? ' MONO' : ''}`).join(' | ')}\n`)

    for (let i = 0; i < ARMS.length; i++) {
      const src = join(clipDir, `v${i + 1}.wav`)
      if (!existsSync(src)) {
        process.stdout.write(`    ${ARMS[i]}: NO RENDER\n`)
        continue
      }
      const named = join(clipDir, `${ARMS[i]}.wav`)
      copyFileSync(src, named)
      const { channels, sampleRate } = decodeWav(readFileSync(src))
      const f = layeredFeatures(analyze(channels, sampleRate), channels, sampleRate)
      const v = verifyLayeredTargets(role, f)
      rows.push({ role, seed: batchSeed, arm: ARMS[i], features: f, architecture: ARMS[i] === 'engineplus' ? null : { family: arch.draw.family, summary: arch.summary, layers: arch.layers.length }, passed: v.passed, total: v.total, results: v.results })
      process.stdout.write(formatTargetVerification(v, `    ${ARMS[i]}`).replace(/^/gm, ''))
    }
  }
  process.stdout.write('\n')
}

// ---- roll-up ------------------------------------------------------------------------------------
const FEATURES = ['bandSubPct', 'bandBassPct', 'bandMidsPct', 'bandPresencePct', 'bandAirPct', 'centroidHz', 'stereoWidthDb', 'stereoCorrelation', 'crestDb', 'truePeakDb', 'crestSubDb', 'modDepthDb', 'articulationDb', 'characterLevelDb']
const num = (x) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)) : 'n/a')
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length

process.stdout.write('\n==== FEATURE TABLE — per role, mean over clips, by arm ====\n')
for (const role of ROLES) {
  process.stdout.write(`\n${role}\n`)
  process.stdout.write(`  ${'feature'.padEnd(18)}${ARMS.map((a) => a.padStart(13)).join('')}\n`)
  for (const key of FEATURES) {
    const cells = ARMS.map((arm) => {
      const rs = rows.filter((r) => r.role === role && r.arm === arm && Number.isFinite(r.features[key]))
      return rs.length === 0 ? 'n/a' : num(mean(rs.map((r) => r.features[key])))
    })
    process.stdout.write(`  ${key.padEnd(18)}${cells.map((c) => c.padStart(13)).join('')}\n`)
  }
  const gates = ARMS.map((arm) => {
    const rs = rows.filter((r) => r.role === role && r.arm === arm)
    return rs.length === 0 ? 'n/a' : `${rs.reduce((s, r) => s + r.passed, 0)}/${rs.reduce((s, r) => s + r.total, 0)}`
  })
  process.stdout.write(`  ${'TARGETS PASSED'.padEnd(18)}${gates.map((c) => c.padStart(13)).join('')}\n`)
}

process.stdout.write('\n==== PER-TARGET PASS RATE (all roles) ====\n')
const targetKeys = [...new Set(rows.flatMap((r) => r.results.map((x) => x.feature)))].sort()
process.stdout.write(`  ${'target'.padEnd(20)}${ARMS.map((a) => a.padStart(13)).join('')}\n`)
for (const t of targetKeys) {
  const cells = ARMS.map((arm) => {
    const rs = rows.filter((r) => r.arm === arm).flatMap((r) => r.results.filter((x) => x.feature === t))
    return rs.length === 0 ? '—' : `${rs.filter((x) => x.pass).length}/${rs.length}`
  })
  process.stdout.write(`  ${t.padEnd(20)}${cells.map((c) => c.padStart(13)).join('')}\n`)
}

writeFileSync(join(outDir, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), arms: ARMS, perRole, metaSeed, rows }, null, 2) + '\n')
process.stdout.write(`\nrenders + results.json in ${outDir} (private — .gitignore written)\n`)
