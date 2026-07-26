// Curate the Surge XT patch pool PER ROLE, v2 — target-aware, whole-library, tempo-correct.
//
// WHAT CHANGED vs scripts/curate-surge-patches.mjs (which stays, unmodified, because
// presets/surge-curated.json is the control for a future blind comparison):
//
//  1. THE POOL. The sidecar now enumerates `patches_3rdparty` as well as `patches_factory`
//     (639 -> 3,559 on the owner's install), so 2,920 patches by 37 named designers are eligible
//     for the first time. Every kept entry records its `bank` and `pool` (D23: bank names are
//     LOCAL-MANIFEST provenance; rendered patch audio stays eval-private and gitignore-gated).
//  2. THE MAPPING. Roles draw from SURGE_ROLE_CATEGORIES_V2 (surgeCuration.ts), which removes
//     `Pads` from `chords` (median amp attack 537.8 ms against a <= 12 ms target) and adds Surge's
//     own `Chords`/`Polysynths`, plus `Sequences` for lead now that renders are tempo-correct.
//  3. THE SCREEN. Selection is TARGET-AWARE: every candidate's stored parameters are read straight
//     out of its .fxp and scored against its role's distribution in
//     presets/role-parameter-stats.json (3,559 professionally designed patches). The old screens
//     scored sustained-tone prettiness and never asked whether a patch behaves like its role —
//     which is how our curated leads ended up at a 13 ms attack median (p81) with releases 39x too
//     long (141 §7.1).
//  4. THE TEMPO. Probe renders pass a tempo, so a synced patch is auditioned on the grid it will
//     actually play on. A build without the binding fails loudly instead of rendering at 120.
//
// TWO STAGES, because parameter reading is free and rendering is not:
//   stage 1  parse every role-pool .fxp (seconds) -> paramFit -> keep the top `--shortlist` per role
//   stage 2  render only the shortlist through the sidecar -> ringDb + activeFraction gates ->
//            final composite -> keep `--keep` per role
//
// Usage: node scripts/curate-surge-patches-v2.mjs [--roles bassline,chords,lead] [--keep 40]
//        [--shortlist 120] [--tempo 124] [--out presets/surge-curated-v2.json] [--force]
//        [--dry-run]   stage 1 only: no renders, prints what the pool and fits look like
//
// ENV: SURGE_DATA_HOME=$HOME/Documents/dotbeat/tools/surge/resources/data and a surgepy-bearing
// interpreter (BEAT_PYTHON or python/.venv) carrying the tempo binding
// (python/surge-patches/0001-surgepy-expose-host-tempo.patch). Verify with:
//   node cli/beat.mjs showdown --surge-doctor

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { readFxpParams } from './surge-fxp-params.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SURGE_PY = join(repoRoot, 'python', 'surge_render.py')
const PROBE_VERSION = 2 // bump when a role probe or the probe tempo changes -> cache entries re-render

const USAGE = `curate-surge-patches-v2 — target-aware curation over the WHOLE Surge patch library

  node scripts/curate-surge-patches-v2.mjs [options]

Options:
  --roles r1,r2   roles to curate (default: bassline,chords,lead)
  --keep N        patches to keep per role (default: 40)
  --shortlist N   candidates to render per role after the parameter screen (default: 120)
  --tempo BPM     probe render tempo (default: 124 — the showdown batch centre)
  --seed N        seed for the deterministic tie-break among equally-fitting patches (default: 1)
  --out PATH      output file (default: presets/surge-curated-v2.json)
  --dry-run       stage 1 only (parameter screen), no renders
  --force         ignore cached renders
  -h, --help      print this help and exit

Never overwrites presets/surge-curated.json — that file is the control for a blind A/B.`

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(USAGE + '\n')
  process.exit(0)
}
const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}
const rolesArg = (flag('--roles') ?? 'bassline,chords,lead').split(',').map((r) => r.trim()).filter(Boolean)
const keepN = Number(flag('--keep') ?? 40)
const shortlistN = Number(flag('--shortlist') ?? 120)
const probeTempo = Number(flag('--tempo') ?? 124)
const seed = Number(flag('--seed') ?? 1)
const outPath = resolve(repoRoot, flag('--out') ?? 'presets/surge-curated-v2.json')
const dryRun = argv.includes('--dry-run')
const force = argv.includes('--force')

if (resolve(outPath) === resolve(repoRoot, 'presets/surge-curated.json')) {
  process.stderr.write('refusing to overwrite presets/surge-curated.json — it is the control for the blind A/B against this bank\n')
  process.exit(2)
}

const cacheRoot = join(homedir(), 'Documents', 'dotbeat', 'tools', 'surge-curation-cache-v2')
const log = (msg) => process.stderr.write(`[curate2 ${new Date().toISOString().slice(11, 19)}] ${msg}\n`)

// Role probes, at the probe tempo. Same shapes as v1 so the two banks stay comparable, but the
// lead probe is now auditioned on a real grid (Sequences patches are eligible and they NEED it).
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

function resolvePythonLocal() {
  const override = process.env.BEAT_PYTHON
  if (override && override.trim()) return override.trim()
  const venv = join(repoRoot, 'python', '.venv', 'bin', 'python3')
  return existsSync(venv) ? venv : 'python3'
}
const PYTHON = resolvePythonLocal()

function renderPatch(patchPath, notes, outWav, tempo) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(PYTHON, [SURGE_PY], { cwd: repoRoot })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`surge render exit ${code}: ${stderr.trim().split('\n').pop() || ''}`))
      try {
        resolvePromise(JSON.parse(stdout))
      } catch {
        reject(new Error(`surge render produced non-JSON: ${stdout.slice(0, 160)}`))
      }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ patch: patchPath, notes, sampleRate: 44100, output: outWav, tempo }))
  })
}

const safeName = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '_')

/** mulberry32 (src/core/rng.ts), per-role so adding a role never shifts another role's draws. */
function rngFor(role) {
  let a = (seed + [...role].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Path relative to the pool root, so a curated entry is portable across machines. */
function relPathOf(patchPath) {
  for (const marker of ['patches_3rdparty', 'patches_factory']) {
    const i = patchPath.indexOf(marker)
    if (i >= 0) return patchPath.slice(i).replace(/\\/g, '/')
  }
  return patchPath
}

async function main() {
  if (!process.env.SURGE_DATA_HOME) {
    log('WARNING: SURGE_DATA_HOME is not set — surgepy may not find the content. Set it to $HOME/Documents/dotbeat/tools/surge/resources/data')
  }
  log(`python=${PYTHON}  roles=${rolesArg.join(',')}  keep=${keepN}  shortlist=${shortlistN}  tempo=${probeTempo}${dryRun ? '  (DRY RUN)' : ''}`)

  const surge = await import('../dist/src/analysis/surge.js')
  const showdown = await import('../dist/src/taste/showdown.js')
  const curation = await import('../dist/src/taste/surgeCuration.js')
  const metrics = await import('../dist/src/metrics/index.js')

  const doctor = await surge.surgeDoctor()
  if (!surge.surgeAvailable(doctor)) {
    log(`FATAL: surgepy unavailable (${doctor.surgepy?.fix ?? 'not built'}). Run: node cli/beat.mjs showdown --surge-doctor`)
    process.exit(3)
  }
  if (!dryRun && doctor.tempoBinding !== true) {
    log('FATAL: this surgepy build has no setTempo binding, so probe renders would be silently mistimed at 120 BPM.')
    log(`Fix: ${doctor.tempoFix ?? 'apply python/surge-patches/0001-surgepy-expose-host-tempo.patch and rebuild surgepy'}`)
    process.exit(3)
  }

  const statsPath = join(repoRoot, 'presets', 'role-parameter-stats.json')
  if (!existsSync(statsPath)) {
    log(`FATAL: ${statsPath} is missing — it is the source of every selection target (research 141). Regenerate it or check out the commit that added it.`)
    process.exit(2)
  }
  const stats = JSON.parse(readFileSync(statsPath, 'utf8'))

  const allPatches = await surge.listSurgePatches()
  const byPool = {}
  for (const p of allPatches) byPool[p.pool] = (byPool[p.pool] ?? 0) + 1
  log(`catalogue: ${allPatches.length} patches (${Object.entries(byPool).map(([k, v]) => `${k} ${v}`).join(', ')})`)
  if (allPatches.length === 0) {
    log('FATAL: catalogue is empty — surgepy loaded but found no patches. SURGE_DATA_HOME is almost certainly unset or wrong.')
    process.exit(3)
  }

  const roleResults = {}
  for (const role of rolesArg) {
    const categories = curation.surgeRoleCategoriesV2(role)
    if (categories === null) {
      log(`role ${role}: not a surge role — skipped`)
      continue
    }
    const probe = PROBES[role]
    if (!probe) {
      log(`role ${role}: no probe defined — skipping`)
      continue
    }
    const targets = curation.roleParamTargets(stats, role)
    const pool = allPatches
      .filter((p) => showdown.patchInCategories(p, categories))
      .sort((a, b) => a.category.toLowerCase().localeCompare(b.category.toLowerCase()) || a.bank.toLowerCase().localeCompare(b.bank.toLowerCase()) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    log(`role ${role}: ${pool.length} patches in [${categories.join('/')}]  targets attack<=${targets.attackMs.hi.toFixed(1)}ms release ${targets.releaseMs.lo.toFixed(0)}-${targets.releaseMs.hi.toFixed(0)}ms cutoff ${targets.cutoffHz.lo.toFixed(0)}-${targets.cutoffHz.hi.toFixed(0)}Hz`)

    // ---- stage 1: the free parameter screen ----------------------------------------------------
    const measured = []
    let unreadable = 0
    for (const p of pool) {
      const params = readFxpParams(p.path)
      if (params === null || params.ampEnv.attackMs === null) {
        unreadable += 1
        continue
      }
      const m = {
        attackMs: params.ampEnv.attackMs,
        releaseMs: params.ampEnv.releaseMs,
        sustain: params.ampEnv.sustain,
        cutoffHz: params.filter.filter1On ? params.filter.cutoffHz : null,
        activeOscCount: params.oscillators.activeCount,
        effectSlots: params.effectSlots,
      }
      measured.push({ patch: p, params, m, fit: curation.paramFit(m, targets) })
    }
    measured.sort((a, b) => b.fit - a.fit || a.patch.name.toLowerCase().localeCompare(b.patch.name.toLowerCase()))
    log(`  stage 1: ${measured.length} readable (${unreadable} unreadable), fit p50=${measured[Math.floor(measured.length / 2)]?.fit.toFixed(3)} best=${measured[0]?.fit.toFixed(3)}`)

    const shortlist = diverseSelect(measured, shortlistN, rngFor(role))
    if (dryRun) {
      roleResults[role] = { pool: pool.length, measured: measured.length, shortlist: shortlist.length, kept: diverseSelect(shortlist, keepN, rngFor(role)).map(toEntry) }
      for (const c of shortlist.slice(0, 5)) log(`    ${c.fit.toFixed(3)} ${c.patch.name} (${c.patch.category} / ${c.patch.bank}) atk=${c.m.attackMs.toFixed(1)}ms rel=${c.m.releaseMs?.toFixed(0)}ms osc=${c.m.activeOscCount}`)
      continue
    }

    // ---- stage 2: render the shortlist and apply the cleanliness gates --------------------------
    const roleCacheDir = join(cacheRoot, role)
    mkdirSync(roleCacheDir, { recursive: true })
    const scored = []
    let done = 0
    for (const c of shortlist) {
      done += 1
      const rel = relPathOf(c.patch.path)
      const base = safeName(rel.replace(/\.fxp$/i, ''))
      const wav = join(roleCacheDir, `${base}.wav`)
      const scoresPath = join(roleCacheDir, `${base}.render.json`)
      let ringDb = null
      let activeFraction = null
      if (!force && existsSync(scoresPath) && existsSync(wav)) {
        try {
          const prev = JSON.parse(readFileSync(scoresPath, 'utf8'))
          if (prev.probeVersion === PROBE_VERSION && prev.tempo === probeTempo && typeof prev.ringDb === 'number') {
            ringDb = prev.ringDb
            activeFraction = prev.activeFraction
          }
        } catch {
          /* recompute */
        }
      }
      try {
        if (ringDb === null) {
          const meta = await renderPatch(c.patch.path, probe.notes, wav, probeTempo)
          if (meta.tempoApplied !== true) throw new Error('sidecar did not apply the probe tempo')
          ringDb = typeof meta.ringDb === 'number' ? meta.ringDb : -120
          const decoded = metrics.decodeWav(readFileSync(wav))
          activeFraction = showdown.activeFraction(decoded.channels, decoded.sampleRate)
          writeFileSync(scoresPath, JSON.stringify({ probeVersion: PROBE_VERSION, tempo: probeTempo, ringDb, activeFraction, name: c.patch.name, category: c.patch.category, bank: c.patch.bank, relPath: rel }) + '\n')
        }
        scored.push({ ...c, ringDb, activeFraction })
      } catch (err) {
        log(`  ! ${role} ${rel}: ${err instanceof Error ? err.message : err} — dropped`)
      }
      if (done % 25 === 0 || done === shortlist.length) log(`  stage 2: ${done}/${shortlist.length} rendered (${scored.length} scored)`)
    }

    // Cleanliness gates unchanged (D26's CURATION_GATES): a ringy or near-silent render is out
    // regardless of how well its parameters fit.
    const survivors = scored.filter((c) => c.ringDb <= curation.CURATION_GATES.ringDbMax && c.activeFraction >= curation.CURATION_GATES.activeFractionMin)
    // Final order: parameter fit is the objective (that is the whole point of v2); ring headroom
    // breaks ties among equally well-fitting patches.
    survivors.sort((a, b) => b.fit - a.fit || a.ringDb - b.ringDb || a.patch.name.toLowerCase().localeCompare(b.patch.name.toLowerCase()))
    const kept = diverseSelect(survivors, keepN, rngFor(role))
    log(`role ${role}: ${pool.length} pool -> ${shortlist.length} shortlisted -> ${scored.length} rendered -> ${survivors.length} survivors -> ${kept.length} kept`)
    for (const k of kept.slice(0, 5)) log(`    keep: ${k.patch.name} (${k.patch.category} / ${k.patch.bank}) fit=${k.fit.toFixed(3)} atk=${k.m.attackMs.toFixed(1)}ms rel=${k.m.releaseMs?.toFixed(0)}ms ring=${k.ringDb.toFixed(0)}`)
    roleResults[role] = {
      pool: pool.length,
      measured: measured.length,
      shortlist: shortlist.length,
      rendered: scored.length,
      survivors: survivors.length,
      categories: [...categories],
      targets,
      banks: countBy(kept.map((k) => k.patch.bank)),
      distribution: summarize(kept),
      kept: kept.map(toEntry),
    }
  }

  const out = {
    version: 2,
    generatedAt: new Date().toISOString(),
    note:
      'Surge patch curation v2: whole library (patches_factory + patches_3rdparty), corrected role->category ' +
      'mapping (SURGE_ROLE_CATEGORIES_V2), and TARGET-AWARE selection against presets/role-parameter-stats.json ' +
      '(research 141). presets/surge-curated.json is the v1 control and is NOT replaced by this file. ' +
      'D23: bank names are local provenance only — rendered patch audio stays eval-private.',
    probeVersion: PROBE_VERSION,
    probeTempoBpm: probeTempo,
    seed,
    probe: Object.fromEntries(Object.entries(PROBES).map(([r, v]) => [r, v.desc])),
    selection: {
      method: 'paramFit (surgeCuration.paramFit) against role-parameter-stats.json, gated on CURATION_GATES',
      weights: curation.PARAM_FIT_WEIGHTS,
      gates: curation.CURATION_GATES,
      statsArtifact: 'presets/role-parameter-stats.json',
      statRoleForShowdownRole: curation.SHOWDOWN_ROLE_TO_STAT_ROLE,
    },
    roles: roleResults,
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')
  log(`wrote ${outPath}`)
  for (const [role, r] of Object.entries(roleResults)) log(`  ${role}: pool ${r.pool}, kept ${r.kept.length}`)
}

/**
 * Pick `n` from a fit-sorted list, spreading across (category, bank) buckets.
 *
 * WHY: the parameter screen produces a LOT of exact ties — 3.91 ms attack and a 31.25 ms release are
 * Surge's defaults, which 65% and 33% of professional patches leave alone (141 §3.3) — so hundreds
 * of patches score exactly 1.000. Breaking those ties alphabetically would fill a role with one
 * designer's bank and names beginning with "A", which is precisely the diversity failure 132 §2.1
 * measured on the v1 bank (the same patch appearing up to 3x across 72 rated surge clips). Instead
 * we round-robin over buckets in descending bucket-quality order, so 40 kept patches come from as
 * many designers and categories as the pool allows.
 *
 * Deterministic: the only randomness is a mulberry32 shuffle WITHIN a tie group, seeded by --seed.
 */
function diverseSelect(sortedCandidates, n, rng) {
  // group exact-fit ties and shuffle each group, so ties are broken by seed rather than by name
  const groups = []
  for (const c of sortedCandidates) {
    const last = groups[groups.length - 1]
    if (last && Math.abs(last[0].fit - c.fit) < 1e-9) last.push(c)
    else groups.push([c])
  }
  const ordered = groups.flatMap((g) => (g.length === 1 ? g : seededShuffle(rng, g)))

  const buckets = new Map()
  for (const c of ordered) {
    const key = `${c.patch.category}\u0000${c.patch.bank}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(c)
  }
  // bucket order: best fit first, so a round-robin pass still favours the best patches
  const order = [...buckets.values()].sort((a, b) => b[0].fit - a[0].fit)
  const out = []
  for (let depth = 0; out.length < n; depth++) {
    let progressed = false
    for (const bucket of order) {
      if (depth >= bucket.length) continue
      out.push(bucket[depth])
      progressed = true
      if (out.length >= n) break
    }
    if (!progressed) break
  }
  return out
}

/** Fisher-Yates with a supplied rng (mirrors src/core/rng.ts seededShuffle; duplicated here only
 * because this script imports from dist/ lazily and runs before any TS is loaded). */
function seededShuffle(rng, arr) {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function toEntry(c) {
  return {
    name: c.patch.name,
    category: c.patch.category,
    bank: c.patch.bank,
    pool: c.patch.pool,
    relPath: relPathOf(c.patch.path),
    fit: Number(c.fit.toFixed(4)),
    ...(c.ringDb === undefined ? {} : { ringDb: c.ringDb, activeFraction: Number(c.activeFraction.toFixed(3)) }),
    params: {
      attackMs: round(c.m.attackMs),
      releaseMs: round(c.m.releaseMs),
      sustain: round(c.m.sustain, 3),
      cutoffHz: round(c.m.cutoffHz),
      activeOscCount: c.m.activeOscCount,
      octaveSplit: c.params.oscillators.octaveSplit,
      effectSlots: c.m.effectSlots,
    },
  }
}
const round = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(d)) : null)
const countBy = (xs) => {
  const o = {}
  for (const x of xs) o[x] = (o[x] ?? 0) + 1
  return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]))
}
function summarize(kept) {
  const q = (vals, p) => {
    const s = vals.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
    return s.length === 0 ? null : round(s[Math.min(s.length - 1, Math.floor(p * s.length))])
  }
  const at = kept.map((k) => k.m.attackMs)
  const rl = kept.map((k) => k.m.releaseMs)
  const su = kept.map((k) => k.m.sustain)
  const cu = kept.map((k) => k.m.cutoffHz)
  return {
    n: kept.length,
    attackMs: { p25: q(at, 0.25), median: q(at, 0.5), p75: q(at, 0.75), pctLe12_5: round((100 * at.filter((v) => v <= 12.5).length) / Math.max(1, at.length), 1) },
    releaseMs: { p25: q(rl, 0.25), median: q(rl, 0.5), p75: q(rl, 0.75) },
    sustain: { median: q(su, 0.5) },
    cutoffHz: { p25: q(cu, 0.25), median: q(cu, 0.5), p75: q(cu, 0.75) },
    activeOscCount: { median: q(kept.map((k) => k.m.activeOscCount), 0.5), pctGe2: round((100 * kept.filter((k) => k.m.activeOscCount >= 2).length) / Math.max(1, kept.length), 1) },
    pctOctaveSplit: round((100 * kept.filter((k) => k.params.oscillators.octaveSplit).length) / Math.max(1, kept.length), 1),
    effectSlots: { median: q(kept.map((k) => k.m.effectSlots), 0.5) },
  }
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? err.stack || err.message : err}`)
  process.exit(1)
})
