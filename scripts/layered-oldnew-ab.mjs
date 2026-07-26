#!/usr/bin/env node
// OLD-vs-NEW listening set for the layered arm, with a `beat ab` manifest.
//
// Why this exists alongside scripts/layered-check.mjs: layered-check renders the three ARMS of the
// treatment (engineplus / layered / layeredplus) at whatever the working tree currently says. It
// cannot answer "did the change help?", because the previous version of the code is gone by the
// time you want to compare against it. This script renders the SAME nine cases from TWO builds —
// a reference build (`--old <dir>`, an ordinary checkout of the commit the owner last rated) and
// the working tree — into ONE vary batch per case, so all four arms are loudness-normalized
// TOGETHER. A wav normalized in a different batch is not comparable: the level difference swamps
// the thing being judged.
//
//   node scripts/layered-oldnew-ab.mjs --old /tmp/oldbuild [--out <dir>] [--per-role 3] [--seed 41]
//                                      [--roles chords] [--seeds 138,1147,2156]
//
// `--seeds` names the batch seeds EXACTLY instead of generating them from --seed/--per-role. That
// matters because the owner rates specific clips and refers back to them by seed ("chords seed
// 1147"), and a re-render of a case he has already judged is worth more than a fresh random one:
// he is comparing against a memory of that exact clip. Without it the only way to reach a rated
// case was to solve `metaSeed + n * 1009 + roleIndex * 97` backwards.
//
// The reference build is prepared outside this script, e.g.
//   mkdir /tmp/oldbuild && git archive <ref> | tar -x -C /tmp/oldbuild
//   ln -s "$(git rev-parse --show-toplevel)/node_modules" /tmp/oldbuild/node_modules
//   cd /tmp/oldbuild && ./node_modules/.bin/tsc -p tsconfig.json && cp presets/*.json dist/presets/
//
// Run `npm run build` in the working tree first — this drives the compiled dist/. The output dir is
// PRIVATE by convention (taste-dataset/) and is never committed.

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const oldRoot = arg('--old', '')
if (oldRoot === '') throw new Error('--old <dir> is required: a built checkout of the commit to compare against')
const outDir = resolve(arg('--out', join(process.env.HOME, 'Documents/dotbeat/taste-dataset/layered-fix2')))
const perRole = Number(arg('--per-role', '3'))
const metaSeed = Number(arg('--seed', '41'))
const onlyRoles = arg('--roles', '').split(',').filter(Boolean)
const explicitSeeds = arg('--seeds', '').split(',').filter(Boolean).map(Number)
if (explicitSeeds.some((s) => !Number.isFinite(s))) throw new Error('--seeds must be a comma-separated list of numbers')

const { parse } = await import(`${repoRoot}/dist/src/core/index.js`)
const { generateSeedBeat } = await import(`${repoRoot}/dist/src/taste/seeds.js`)
const { inferSeedKey, composePitchedPhrase, applyComposedPhrase, soloForShowdown, extendToFourBars, applyProductionTreatment } =
  await import(`${repoRoot}/dist/src/taste/showdown.js`)
const { LAYERED_ROLES, buildLayeredClip, layeredArchitecture, layeredFeatures } = await import(`${repoRoot}/dist/src/taste/layered.js`)
const old = await import(`${resolve(oldRoot)}/dist/src/taste/layered.js`)
const { writeVaryBatch, renderVaryBatch, normalizeBatchLoudness } = await import(`${repoRoot}/dist/src/vary/batch.js`)
const { analyze, decodeWav, fft } = await import(`${repoRoot}/dist/src/metrics/index.js`)

const SEED_TRACK = { bassline: 'bass', chords: 'chords', lead: 'arp' }

/** Share of total spectral energy inside [lo, hi) Hz, percent. Same Hann/4096/hop-2048 averaged
 * spectrum `analyze()`'s own band split uses (src/metrics/analyze.ts `spectral`), just with the
 * edges the caller asks for — 1.6-3.8 kHz here, because that is the band
 * docs/priors/layering.md §1/§3 tells us to cut to remove "metallic harshness", so it is the band
 * the de-harsh pair has to be shown moving. */
function bandSharePct(channels, sampleRate, lo, hi) {
  const N = 4096
  const hop = 2048
  const mono = new Float64Array(channels[0].length)
  for (const ch of channels) for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / channels.length
  const hann = new Float64Array(N)
  for (let i = 0; i < N; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)))
  const acc = new Float64Array(N / 2)
  let frames = 0
  for (let start = 0; start + N <= mono.length; start += hop) {
    const re = new Float64Array(N)
    const im = new Float64Array(N)
    for (let i = 0; i < N; i++) re[i] = mono[start + i] * hann[i]
    fft(re, im)
    for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k]
    frames++
  }
  if (frames === 0) return 0
  const binHz = sampleRate / N
  let total = 0
  let inBand = 0
  for (let k = 1; k < N / 2; k++) {
    const f = k * binHz
    total += acc[k]
    if (f >= lo && f < hi) inBand += acc[k]
  }
  return total > 0 ? (inBand / total) * 100 : 0
}

/** The resting lowpass each layer of a stack actually sits behind, and the stack's median — the
 * number that gets compared against organic-vs-mechanical §4d's 523 Hz corpus median. A layer with
 * no resting lowpass is reported as Infinity (open), and counts against the 82.1% lowpass rate. */
function restingCutoffs(arch) {
  return arch.layers.map((l) => ({
    id: l.id,
    hz: l.band.mode === 'lowpass' ? l.band.cutoffHz : l.patch.eq7LpOn === true ? l.patch.eq7LpFreq : Infinity,
  }))
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0 ? NaN : s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, '.gitignore'), '# private layered-arm renders — never committed\n*\n')

const ARMS = [
  { key: 'engineplus', name: 'unlayered (engineplus)' },
  { key: 'layered-old', name: 'layered — BEFORE' },
  { key: 'layered-new', name: 'layered — AFTER' },
  { key: 'layeredplus-new', name: 'layered + production — AFTER' },
]

const comparisons = []
const report = []

for (const role of onlyRoles.length > 0 ? LAYERED_ROLES.filter((r) => onlyRoles.includes(r)) : LAYERED_ROLES) {
  const seedsForRole = explicitSeeds.length > 0 ? explicitSeeds : Array.from({ length: perRole }, (_, n) => metaSeed + n * 1009 + LAYERED_ROLES.indexOf(role) * 97)
  for (const batchSeed of seedsForRole) {
    const clipDir = join(outDir, `${role}-${batchSeed}`)
    rmSync(clipDir, { recursive: true, force: true })
    mkdirSync(clipDir, { recursive: true })

    // ONE figure for every arm — the comparison isolates the instrument, nothing else
    const seedText = generateSeedBeat(batchSeed).text
    const seedPath = join(clipDir, 'seed.beat')
    writeFileSync(seedPath, seedText)
    const seedDoc = parse(seedText)
    const key = inferSeedKey(seedDoc)
    const bpm = seedDoc.bpm
    const phrase = composePitchedPhrase(role, key, batchSeed)

    const extended = { ...extendToFourBars(seedDoc), bpm }
    const soloed = soloForShowdown(applyComposedPhrase(extended, SEED_TRACK[role], phrase), SEED_TRACK[role])
    const engineplus = applyProductionTreatment(soloed, SEED_TRACK[role])

    const archOld = old.layeredArchitecture(role, batchSeed)
    const archNew = layeredArchitecture(role, batchSeed)
    const clipOld = old.buildLayeredClip(role, phrase, bpm, { arch: archOld })
    const clipNew = buildLayeredClip(role, phrase, bpm, { arch: archNew })
    const clipNewPlus = buildLayeredClip(role, phrase, bpm, { arch: archNew, produced: true })

    writeVaryBatch({
      parentPath: seedPath,
      parentText: seedText,
      track: SEED_TRACK[role],
      group: 'layered-oldnew',
      count: 4,
      seed: batchSeed,
      outDir: clipDir,
      variants: [
        { doc: engineplus.doc, recipe: `engineplus: ${phrase.archetype} soloed + frozen production` },
        { doc: clipOld.doc, recipe: `layered BEFORE: ${archOld.summary}` },
        { doc: clipNew.doc, recipe: `layered AFTER: ${archNew.summary}` },
        { doc: clipNewPlus.doc, recipe: `layeredplus AFTER: ${archNew.summary} + ${clipNewPlus.applied.length} production moves` },
      ],
    })
    renderVaryBatch(clipDir, 4, { normalize: false })
    normalizeBatchLoudness(clipDir, 4)

    const measurements = {}
    const row = { role, seed: batchSeed, archOld: archOld.summary, archNew: archNew.summary, arms: {} }
    for (let i = 0; i < ARMS.length; i++) {
      const src = join(clipDir, `v${i + 1}.wav`)
      if (!existsSync(src)) {
        process.stdout.write(`    ${ARMS[i].key}: NO RENDER\n`)
        continue
      }
      copyFileSync(src, join(clipDir, `${ARMS[i].key}.wav`))
      const { channels, sampleRate } = decodeWav(readFileSync(src))
      const f = layeredFeatures(analyze(channels, sampleRate), channels, sampleRate)
      const harsh = bandSharePct(channels, sampleRate, 1600, 3800)
      measurements[ARMS[i].name] = {
        'harsh band 1.6-3.8 kHz %': Math.round(harsh * 100) / 100,
        'centroid Hz': Math.round(f.centroidHz),
        'bass-band %': Math.round(f.bandBassPct * 10) / 10,
        'mids %': Math.round(f.bandMidsPct * 10) / 10,
        'crest dB': Math.round(f.crestDb * 10) / 10,
        'width dB': Math.round(f.stereoWidthDb * 10) / 10,
      }
      row.arms[ARMS[i].key] = { ...measurements[ARMS[i].name] }
    }
    const restOld = restingCutoffs(archOld)
    const restNew = restingCutoffs(archNew)
    row.restingOld = restOld
    row.restingNew = restNew
    row.restingMedianOld = median(restOld.map((r) => r.hz).filter((h) => Number.isFinite(h)))
    row.restingMedianNew = median(restNew.map((r) => r.hz).filter((h) => Number.isFinite(h)))
    row.openLayersOld = restOld.filter((r) => !Number.isFinite(r.hz)).length
    row.openLayersNew = restNew.filter((r) => !Number.isFinite(r.hz)).length
    report.push(row)

    comparisons.push({
      id: `${role}-${batchSeed}`,
      label: `${role} — seed ${batchSeed}`,
      options: ARMS.map((a) => ({ name: a.name, wav: `${role}-${batchSeed}/${a.key}.wav`, note: '' })),
      measurements,
    })

    process.stdout.write(`${role}-${batchSeed}\n  BEFORE ${archOld.summary}\n  AFTER  ${archNew.summary}\n`)
    process.stdout.write(
      `  resting lowpass: before ${restOld.map((r) => `${r.id} ${Number.isFinite(r.hz) ? r.hz : 'open'}`).join(', ')}` +
        ` | after ${restNew.map((r) => `${r.id} ${Number.isFinite(r.hz) ? r.hz : 'open'}`).join(', ')}\n`,
    )
    for (const a of ARMS) if (row.arms[a.key]) process.stdout.write(`  ${a.key.padEnd(16)} harsh ${String(row.arms[a.key]['harsh band 1.6-3.8 kHz %']).padStart(6)}%  centroid ${String(row.arms[a.key]['centroid Hz']).padStart(5)} Hz\n`)
    process.stdout.write('\n')
  }
}

writeFileSync(join(outDir, 'measurements.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows: report }, null, 2) + '\n')
writeFileSync(join(outDir, 'feedback.json'), JSON.stringify({ question: 'PLACEHOLDER — written by the caller', comparisons }, null, 2) + '\n')
process.stdout.write(`renders + measurements.json + feedback.json in ${outDir} (private)\n`)
