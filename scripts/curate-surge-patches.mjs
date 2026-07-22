// Curate the Surge XT factory-patch pool PER ROLE (decisions.md D26). Today `pickSurgePatch`
// (src/taste/showdown.ts) draws blind from the ~639-preset factory pool; this script scores every
// role-appropriate patch on a short deterministic probe render and writes the curated top quartile
// per role to presets/surge-curated.json, which showdownCmd then loads (blind draw from the
// curated pool instead of the whole factory).
//
// PER PATCH: render a role-appropriate probe (bass = sustained low note + its octave; chords = one
// held triad; lead = a 4-note motif) through the patch via python/surge_render.py, then score:
//   - ringDb          the sidecar's worst narrow tonal peak — a RINGY patch (> -32) is gated out
//   - activeFraction  src/taste/showdown.ts — a mostly-silent render (< 0.5) is gated out
//   - CE/CU/PC/PQ     Audiobox-Aesthetics axes (embedAudioFile --backend aes); CE+PQ = quality
//   - criticPess      the ensemble critic's pessimistic score (criticWithUncertainty over the
//                     owner's rated dataset, examples/taste-t1/beat-scores.jsonl, READ-ONLY)
// The gate+composite math is the pure, unit-tested src/taste/surgeCuration.ts (aesthetics-weighted
// z-score blend). Renders/scores cache under ~/Documents/dotbeat/tools/surge-curation-cache (NOT
// the repo) keyed by relPath+probe version, so re-runs are incremental.
//
// ENV (every surge command needs it): SURGE_DATA_HOME=$HOME/Documents/dotbeat/tools/surge/resources/data
// and a surgepy-bearing interpreter (BEAT_PYTHON or python/.venv). Verify first:
//   node cli/beat.mjs showdown --surge-doctor
//
// Usage: node scripts/curate-surge-patches.mjs [--roles bassline,chords,lead] [--limit N]
//        [--top 0.25] [--out presets/surge-curated.json] [--force]
//   --limit N  score only the first N patches per role (smoke; the cache still fills incrementally)
//   --force    ignore cached render/scores and re-render every patch

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SURGE_PY = join(repoRoot, 'python', 'surge_render.py')
const PROBE_VERSION = 1 // bump when a role probe changes → cache entries re-render

// ---- CLI args ----------------------------------------------------------------------------------
const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}
const rolesArg = (flag('--roles') ?? 'bassline,chords,lead').split(',').map((r) => r.trim()).filter(Boolean)
const limit = flag('--limit') !== undefined ? Number(flag('--limit')) : Infinity
const topFraction = flag('--top') !== undefined ? Number(flag('--top')) : 0.25
const outPath = resolve(repoRoot, flag('--out') ?? 'presets/surge-curated.json')
const force = argv.includes('--force')

const cacheRoot = join(homedir(), 'Documents', 'dotbeat', 'tools', 'surge-curation-cache')
const beatScores = resolve(repoRoot, 'examples', 'taste-t1', 'beat-scores.jsonl')

const log = (msg) => process.stderr.write(`[curate ${new Date().toISOString().slice(11, 19)}] ${msg}\n`)

// Role probes: absolute-time SurgeNote lists {midi, startSeconds, durationSeconds, velocity}.
// Deterministic, ~2-4 s, role-appropriate register. The sidecar adds a 1.5 s tail for releases.
const PROBES = {
  bassline: {
    desc: 'sustained low C2 (midi 36, 1.6s) then its octave C3 (midi 48, 1.6s)',
    notes: [
      { midi: 36, startSeconds: 0.0, durationSeconds: 1.6, velocity: 100 },
      { midi: 48, startSeconds: 1.6, durationSeconds: 1.6, velocity: 100 },
    ],
  },
  chords: {
    desc: 'one held C-major triad (midi 60/64/67, 2.5s)',
    notes: [
      { midi: 60, startSeconds: 0.0, durationSeconds: 2.5, velocity: 100 },
      { midi: 64, startSeconds: 0.0, durationSeconds: 2.5, velocity: 100 },
      { midi: 67, startSeconds: 0.0, durationSeconds: 2.5, velocity: 100 },
    ],
  },
  lead: {
    desc: '4-note ascending motif C5-E5-G5-C6 (midi 72/76/79/84), last note held',
    notes: [
      { midi: 72, startSeconds: 0.0, durationSeconds: 0.45, velocity: 100 },
      { midi: 76, startSeconds: 0.5, durationSeconds: 0.45, velocity: 100 },
      { midi: 79, startSeconds: 1.0, durationSeconds: 0.45, velocity: 100 },
      { midi: 84, startSeconds: 1.5, durationSeconds: 0.9, velocity: 100 },
    ],
  },
}

// ---- surge render sidecar (spawned directly so we keep the sidecar's ringDb) --------------------
function resolvePythonLocal() {
  const override = process.env.BEAT_PYTHON
  if (override && override.trim()) return override.trim()
  const venv = join(repoRoot, 'python', '.venv', 'bin', 'python3')
  return existsSync(venv) ? venv : 'python3'
}
const PYTHON = resolvePythonLocal()

function renderPatch(patchPath, notes, outWav) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(PYTHON, [SURGE_PY], { cwd: repoRoot })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`surge render exit ${code}: ${stderr.trim().split('\n').pop() || ''}`))
      try {
        resolvePromise(JSON.parse(stdout))
      } catch {
        reject(new Error(`surge render produced non-JSON: ${stdout.slice(0, 160)}`))
      }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ patch: patchPath, notes, sampleRate: 44100, output: outWav }))
  })
}

// ---- helpers -----------------------------------------------------------------------------------
const safeName = (relPath) => relPath.replace(/[^A-Za-z0-9._-]+/g, '_')
const relPathOf = (patchPath) => {
  const marker = 'patches_factory'
  const i = patchPath.indexOf(marker)
  return i >= 0 ? patchPath.slice(i + marker.length).replace(/^[/\\]+/, '') : patchPath
}

async function main() {
  if (!process.env.SURGE_DATA_HOME) {
    log('WARNING: SURGE_DATA_HOME is not set — surgepy may not find the factory content. Set it to $HOME/Documents/dotbeat/tools/surge/resources/data')
  }
  log(`python=${PYTHON}  roles=${rolesArg.join(',')}  limit=${limit}  top=${topFraction}  cache=${cacheRoot}`)

  const surge = await import('../dist/src/analysis/surge.js')
  const showdown = await import('../dist/src/taste/showdown.js')
  const features = await import('../dist/src/taste/features.js')
  const embeddings = await import('../dist/src/taste/embeddings.js')
  const evalMod = await import('../dist/src/taste/eval.js')
  const curation = await import('../dist/src/taste/surgeCuration.js')
  const metrics = await import('../dist/src/metrics/index.js')

  // doctor + full catalogue once
  const doctor = await surge.surgeDoctor()
  if (!surge.surgeAvailable(doctor)) {
    log(`FATAL: surgepy unavailable (${doctor.error ?? doctor.surgepy?.fix ?? 'not built'}). Run: node cli/beat.mjs showdown --surge-doctor`)
    process.exit(3)
  }
  const allPatches = await surge.listSurgePatches()
  log(`factory catalogue: ${allPatches.length} patches at ${doctor.patchesRoot ?? '?'}`)

  // the ensemble critic, trained once over the owner's rated dataset (READ-ONLY)
  log(`building ensemble critic over ${beatScores} (aes backend)...`)
  const critic = await evalMod.criticWithUncertainty(beatScores, { aesBackend: 'aes' })
  log(`critic ready: ${critic.trainedBatches} aes-bearing batches, ${critic.trainedPairs} pairs, beta=${critic.beta}`)

  const roleResults = {}
  for (const role of rolesArg) {
    const categories = showdown.surgeRoleCategories(role)
    if (categories === null) {
      log(`role ${role}: no surge categories (skipped for curation)`)
      continue
    }
    const probe = PROBES[role]
    if (!probe) {
      log(`role ${role}: no probe defined — skipping`)
      continue
    }
    const pool = allPatches
      .filter((p) => showdown.patchInCategories(p, categories))
      .sort((a, b) => a.category.toLowerCase().localeCompare(b.category.toLowerCase()) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    const scoped = Number.isFinite(limit) ? pool.slice(0, limit) : pool
    log(`role ${role}: ${pool.length} patches in [${categories.join('/')}]${Number.isFinite(limit) ? ` (scoring first ${scoped.length})` : ''}`)

    const roleCacheDir = join(cacheRoot, role)
    mkdirSync(roleCacheDir, { recursive: true })

    const candidates = [] // { name, category, relPath, ringDb, activeFraction, dsp, aes }
    let done = 0
    for (const p of scoped) {
      done += 1
      const relPath = relPathOf(p.path)
      const base = safeName(relPath.replace(/\.fxp$/i, ''))
      const wav = join(roleCacheDir, `${base}.wav`)
      const scoresPath = join(roleCacheDir, `${base}.render.json`)

      let ringDb
      let cached = false
      if (!force && existsSync(scoresPath) && existsSync(wav)) {
        try {
          const prev = JSON.parse(readFileSync(scoresPath, 'utf8'))
          if (prev.probeVersion === PROBE_VERSION && typeof prev.ringDb === 'number') {
            ringDb = prev.ringDb
            cached = true
          }
        } catch {
          /* recompute */
        }
      }
      try {
        if (!cached) {
          const meta = await renderPatch(p.path, probe.notes, wav)
          ringDb = typeof meta.ringDb === 'number' ? meta.ringDb : -120
        }
        // activeFraction from the rendered wav (mono-mixes channels)
        const decoded = metrics.decodeWav(readFileSync(wav))
        const activeFraction = showdown.activeFraction(decoded.channels, decoded.sampleRate)
        // dsp features (cheap, recomputed) + aes axes (cached next to the wav by embedAudioFile)
        const dsp = features.featuresForAudioFile(wav)
        if (dsp === null) throw new Error('feature extraction returned null')
        const aesRes = await embeddings.embedAudioFile(wav, { backend: 'aes' })
        const aes = aesRes.embedding // [CE, CU, PC, PQ]
        if (!Array.isArray(aes) || aes.length < 4) throw new Error(`aes returned ${aes?.length} axes`)
        if (!cached) writeFileSync(scoresPath, JSON.stringify({ probeVersion: PROBE_VERSION, ringDb, activeFraction, name: p.name, category: p.category, relPath }) + '\n')
        candidates.push({ name: p.name, category: p.category, relPath, ringDb, activeFraction, dsp, aes })
      } catch (err) {
        log(`  ! ${role} ${relPath}: ${err instanceof Error ? err.message : err} — dropped`)
      }
      if (done % 20 === 0 || done === scoped.length) log(`  ${role}: ${done}/${scoped.length} rendered (${candidates.length} scored)`) // progress
    }

    // critic pessimistic score over the whole role population (within-population z-scored)
    const critPess = critic.scorePopulation(candidates.map((c) => ({ dsp: c.dsp, aes: c.aes.slice(0, 4) })))
    const curationCandidates = candidates.map((c, i) => ({
      name: c.name,
      category: c.category,
      relPath: c.relPath,
      scores: {
        ringDb: c.ringDb,
        activeFraction: c.activeFraction,
        ce: c.aes[0],
        cu: c.aes[1],
        pc: c.aes[2],
        pq: c.aes[3],
        criticPessimistic: critPess[i]?.pessimistic ?? 0,
      },
    }))
    const { survivors, kept } = curation.curateRole(curationCandidates, { topFraction })
    log(`role ${role}: ${candidates.length} scored → ${survivors} survivors (gates) → ${kept.length} kept (top ${Math.round(topFraction * 100)}%)`)
    for (const k of kept.slice(0, 5)) log(`    keep: ${k.name} (${k.category})  composite=${k.composite.toFixed(3)}  CE+PQ=${(k.scores.ce + k.scores.pq).toFixed(2)}  ring=${k.scores.ringDb.toFixed(0)}`)
    roleResults[role] = { pool: pool.length, scored: candidates.length, survivors, kept }
  }

  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    note: 'Surge factory-patch curation per role (decisions.md D26). Loaded by beat showdown --with-surge; absent → blind draw from the full factory pool.',
    probeVersion: PROBE_VERSION,
    probe: Object.fromEntries(Object.entries(PROBES).map(([r, v]) => [r, v.desc])),
    blend: curation.CURATION_BLEND,
    gates: curation.CURATION_GATES,
    dataset: 'examples/taste-t1/beat-scores.jsonl',
    roles: roleResults,
  }
  mkdirSync(dirname(outPath), { recursive: true })
  // deterministic round-trip: sort role keys, keep kept order from curateRole
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')
  log(`wrote ${outPath}`)
  for (const [role, r] of Object.entries(roleResults)) log(`  ${role}: pool ${r.pool}, scored ${r.scored}, survivors ${r.survivors}, kept ${r.kept.length}`)
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? err.stack || err.message : err}`)
  process.exit(1)
})
