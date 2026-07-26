// Build, render and gate-check every recipe in presets/recipes.json, and write the result to
// presets/recipe-verify-receipts.json — the reproducible measurement behind the "verification"
// half of the recipe library (research 139 §4.2/§6.3).
//
// Named `gen-*` rather than `verify-*` deliberately: `verify-<name>.mjs` is the reserved prefix of
// the Playwright/CLI verify FLEET, whose roster ui/verify-manifest.mjs enforces (test/verify-
// manifest.test.ts). This is a data GENERATOR in the gen-tricks-reference.mjs family — it produces
// a committed artifact, it does not assert an invariant.
//
// This is the loop that turns a recipe from prose into evidence: execute it, render it through
// dotbeat's own engine, and report each gate's measured value beside its target. A FAILING GATE IS
// A FINDING — either the recipe is wrong for our engine, or the engine cannot express what the
// corpus describes. Nothing here ever widens a band to make a report look better; the receipts
// file records the failures verbatim, with the render's full feature vector beside them so a later
// reader can re-derive the verdict without re-rendering.
//
//   npm run build && node scripts/gen-recipe-receipts.mjs [--out <dir>] [--seed n] [--key Am] [--bpm n]
//                                                    [--only <name>] [--layers] [--live]
//
// `--layers` also renders each layer's SOLO document, which is what the per-layer gates are
// checked against; it multiplies render time by the layer count, so it is opt-in.
//
// Requires a renderable checkout: `ui/node_modules` + a built `ui/dist` (cli/render.mjs builds the
// latter automatically). Frozen-science discipline: the receipts file is REGENERATED, never
// hand-edited, and carries the command that produced it.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRecipeLibrary, buildRecipeDoc, checkRecipeGates, soloLayer, formatGateReport } from '../dist/src/recipes/index.js'
import { serialize } from '../dist/src/core/index.js'
import { featuresForAudioFile } from '../dist/src/taste/features.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i === -1 ? fallback : argv[i + 1]
}

if (argv.includes('--help') || argv.includes('-h')) {
  // This script RENDERS; an unrecognised flag must not silently kick off 38 browser renders.
  process.stdout.write('usage: node scripts/gen-recipe-receipts.mjs [--out <dir>] [--seed n] [--key Am] [--bpm n] [--only <name>] [--layers] [--live]\n')
  process.exit(0)
}
const KNOWN_FLAGS = new Set(['--out', '--seed', '--key', '--bpm', '--only', '--layers', '--live'])
for (const a of argv) {
  if (a.startsWith('--') && !KNOWN_FLAGS.has(a)) {
    process.stderr.write(`error: unknown flag "${a}" (known: ${[...KNOWN_FLAGS].join(', ')})\n`)
    process.exit(2)
  }
}

const seed = Number(flag('--seed', '11'))
const bpm = Number(flag('--bpm', '124'))
const keySpec = flag('--key', 'Am')
const only = flag('--only', null)
const withLayers = argv.includes('--layers')
const mode = argv.includes('--live') ? '--live' : '--offline'
const outDir = flag('--out', null) ?? mkdtempSync(join(tmpdir(), 'recipe-verify-'))
mkdirSync(outDir, { recursive: true })

const PITCH_CLASSES = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }
const m = String(keySpec).match(/^([A-G][#b]?)(m)?$/)
if (!m) throw new Error(`--key must look like C, Am, F#m — got "${keySpec}"`)
const key = { root: 48 + PITCH_CLASSES[m[1]], minor: m[2] === 'm' }

const recipes = parseRecipeLibrary(readFileSync(join(root, 'presets', 'recipes.json'), 'utf8')).filter((r) => !only || r.name === only)

function render(beatPath, wavPath) {
  execFileSync(process.execPath, [join(root, 'cli', 'render.mjs'), beatPath, mode, '--out', wavPath], { stdio: 'pipe' })
  if (!existsSync(wavPath)) throw new Error(`render produced no wav at ${wavPath}`)
}

const entries = []
for (const recipe of recipes) {
  const { doc, report: build } = buildRecipeDoc(recipe, { key, seed, bpm })
  const beatPath = join(outDir, `${recipe.name}.beat`)
  const wavPath = join(outDir, `${recipe.name}.wav`)
  writeFileSync(beatPath, serialize(doc))
  let clip = null
  let renderError = null
  try {
    render(beatPath, wavPath)
    clip = featuresForAudioFile(wavPath)
  } catch (err) {
    renderError = String(err.message ?? err).split('\n')[0]
  }
  const layers = {}
  if (withLayers && renderError === null) {
    for (const layer of recipe.layers) {
      const soloBeat = join(outDir, `${recipe.name}.${layer.id}.beat`)
      const soloWav = join(outDir, `${recipe.name}.${layer.id}.wav`)
      writeFileSync(soloBeat, serialize(soloLayer(doc, layer.id)))
      try {
        render(soloBeat, soloWav)
        layers[layer.id] = featuresForAudioFile(soloWav)
      } catch {
        layers[layer.id] = null
      }
    }
  }
  const check = checkRecipeGates(recipe, { clip, layers })
  process.stdout.write(formatGateReport(check))
  entries.push({
    recipe: recipe.name,
    version: recipe.version,
    role: recipe.role,
    archetype: build.archetype,
    tracks: doc.tracks.length,
    ...(renderError ? { renderError } : {}),
    verdict: check.verdict,
    counts: check.counts,
    clipFeatures: clip,
    gates: check.results.map((r) => ({ scope: r.scope, metric: r.metric, target: r.target, measured: r.measured, status: r.status, distance: r.distance })),
    gaps: build.gaps,
  })
}

const receipts = {
  version: 1,
  generatedAt: new Date().toISOString().slice(0, 10),
  note: 'REGENERATED, never hand-edited. Each entry is one recipe built, rendered through dotbeat\'s own engine, and checked against its own declared gates. A `fail` row is a FINDING (the recipe is wrong for this engine, or this engine cannot express what the corpus describes) — never a reason to widen the band. A `pending` row names a research 131 §4 discriminator FEATURE_KEYS does not compute yet (138 B0).',
  regenerate: `npm run build && node scripts/gen-recipe-receipts.mjs --seed ${seed} --key ${keySpec} --bpm ${bpm}${withLayers ? ' --layers' : ''}`,
  build: { seed, key: keySpec, bpm, mode: mode.replace('--', ''), layerSolos: withLayers },
  totals: {
    recipes: entries.length,
    pass: entries.filter((e) => e.verdict === 'pass').length,
    fail: entries.filter((e) => e.verdict === 'fail').length,
    incomplete: entries.filter((e) => e.verdict === 'incomplete').length,
    gatesPass: entries.reduce((s, e) => s + e.counts.pass, 0),
    gatesFail: entries.reduce((s, e) => s + e.counts.fail, 0),
    gatesPending: entries.reduce((s, e) => s + e.counts.pending, 0),
    gatesUnmeasured: entries.reduce((s, e) => s + e.counts.unmeasured, 0),
  },
  entries,
}
const receiptPath = join(root, 'presets', 'recipe-verify-receipts.json')
writeFileSync(receiptPath, JSON.stringify(receipts, null, 2) + '\n')
console.log(`wrote ${receiptPath} — ${receipts.totals.recipes} recipes, ${receipts.totals.gatesPass} gates passed / ${receipts.totals.gatesFail} FAILED / ${receipts.totals.gatesPending} pending`)
if (flag('--out', null) === null) rmSync(outDir, { recursive: true, force: true })
