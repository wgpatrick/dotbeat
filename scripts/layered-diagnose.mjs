#!/usr/bin/env node
// The owner ear report of 2026-07-26, measured. "The bassline layering doesn't sound great from my
// POV... I liked the unlayered one better", against a layered arm that passed 19 of 24 measured
// targets where single-voice engineplus passed 3.
//
// This renders each LAYER of a stack on its own, at the same gain staging as the full mix, so the
// per-layer contribution can be read directly instead of inferred from a whole-file band share —
// the measurement that distinguishes "a bass with a strong sub" from "a bass that is nothing but a
// sub with an inaudible character layer". It also prints the extended features
// (scripts/lib/extra-features.mjs) that MixMetrics structurally cannot produce, next to the
// reference-pool quantiles from scripts/ref-pool-stats.mjs.
//
//   node scripts/layered-diagnose.mjs [--role bassline] [--seeds 41,1050] [--out <dir>]
//
// Run `npm run build` first — this drives the compiled dist/.

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback
}

const role = arg('--role', 'bassline')
const seeds = arg('--seeds', '41,1050').split(',').map(Number)
const outDir = resolve(arg('--out', join(process.env.HOME, 'Documents/dotbeat/taste-dataset/layered-diagnose')))

const { parse } = await import(`${repoRoot}/dist/src/core/index.js`)
const { generateSeedBeat } = await import(`${repoRoot}/dist/src/taste/seeds.js`)
const { inferSeedKey, composePitchedPhrase } = await import(`${repoRoot}/dist/src/taste/showdown.js`)
const { buildLayeredClip } = await import(`${repoRoot}/dist/src/taste/layered.js`)
const { writeVaryBatch, renderVaryBatch } = await import(`${repoRoot}/dist/src/vary/batch.js`)
const { analyze, decodeWav } = await import(`${repoRoot}/dist/src/metrics/index.js`)
const { extraFeatures } = await import(`${repoRoot}/scripts/lib/extra-features.mjs`)

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, '.gitignore'), '# private diagnostic renders — never committed\n*\n')

const num = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'n/a')

for (const seed of seeds) {
  const clipDir = join(outDir, `${role}-${seed}`)
  rmSync(clipDir, { recursive: true, force: true })
  mkdirSync(clipDir, { recursive: true })

  const seedText = generateSeedBeat(seed).text
  const seedPath = join(clipDir, 'seed.beat')
  writeFileSync(seedPath, seedText)
  const seedDoc = parse(seedText)
  const key = inferSeedKey(seedDoc)
  const phrase = composePitchedPhrase(role, key, seed)
  const built = buildLayeredClip(role, phrase, seedDoc.bpm)

  const soloDocs = built.arch.layers.map((l) => ({
    id: l.id,
    // selectedTrack must follow, or the doc names a track it no longer contains and won't parse
    doc: { ...built.doc, selectedTrack: l.id, tracks: built.doc.tracks.filter((t) => t.id === l.id) },
  }))
  const variants = [
    { doc: built.doc, recipe: 'full stack' },
    ...soloDocs.map((s) => ({ doc: s.doc, recipe: `solo ${s.id}` })),
  ]
  writeVaryBatch({ parentPath: seedPath, parentText: seedText, track: role, group: 'layered-diagnose', count: variants.length, seed, outDir: clipDir, variants })
  // NO normalization — the whole point is comparing each layer at the level it sits in the stack
  renderVaryBatch(clipDir, variants.length, { normalize: false })

  process.stdout.write(`\n=== ${role} seed ${seed} — ${built.arch.summary}\n`)
  const labels = ['FULL', ...soloDocs.map((s) => s.id)]
  const measured = []
  for (let i = 0; i < variants.length; i++) {
    const wav = join(clipDir, `v${i + 1}.wav`)
    if (!existsSync(wav)) { process.stdout.write(`  ${labels[i]}: NO RENDER\n`); continue }
    const d = decodeWav(readFileSync(wav))
    measured.push({ label: labels[i], m: analyze(d.channels, d.sampleRate), x: extraFeatures(d.channels, d.sampleRate) })
  }
  const full = measured[0]
  process.stdout.write(`  ${'layer'.padEnd(10)}${['rms dB', 'vs FULL', 'LUFS', 'sub%', 'bass%', 'mids%', 'modDepth', 'artic'].map((h) => h.padStart(10)).join('')}\n`)
  for (const r of measured) {
    process.stdout.write(`  ${r.label.padEnd(10)}${[
      num(r.m.rmsDbfs), num(r.m.rmsDbfs - full.m.rmsDbfs), num(r.m.integratedLufs),
      num(r.m.spectral.bandsPct.sub), num(r.m.spectral.bandsPct.bass), num(r.m.spectral.bandsPct.mids),
      num(r.x.modDepthDb), num(r.x.articulationDb),
    ].map((c) => c.padStart(10)).join('')}\n`)
  }
}

process.stdout.write(`\nrenders in ${outDir} (private)\n`)
