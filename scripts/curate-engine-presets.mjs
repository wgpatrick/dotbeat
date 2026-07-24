// Curate the ENGINE's own patch space PER ROLE (docs/engine-presets.md E2). The historical engine
// clips drew a RANDOMLY ROLLED seed patch (src/taste/seeds.ts synthBlock) — "the engine playing
// dice." This is the engine analogue of scripts/curate-surge-patches.mjs: score a big candidate pool
// on a short deterministic probe render, gate + blend (the shared, unit-tested src/taste/
// surgeCuration.ts), and write the top quartile per role to presets/engine-curated.json, which
// `beat showdown` (E1 pick upgraded), taste-seeds, and gen-kit then prefer over the factory pool.
//
// CANDIDATE POOL per pitched role (bassline/chords/lead — drum-loop uses factory kits, not the synth
// param space): the role's factory synth presets (presets/factory.json) + ~rolls/3 seeded RANDOM
// ROLLS of the core synth timbre space (ranges from src/vary/vary.ts VARY_GROUPS + seeds.ts, with
// resonance capped at 0.85 — the self-oscillation-whine guard seeds.ts already applies). (E3
// match-derived patches would join this pool when they exist; none do yet.)
//
// PER CANDIDATE: render a role-appropriate probe (bass = low note + its octave; chords = held triad;
// lead = a 4-note motif) through dotbeat's OWN engine (renderVaryBatch, one-boot batches, raw/
// un-normalized), then score exactly as surge curation does:
//   - ringDb          the narrow-HF ring metric, ported from python/surge_render.py _ring_db to
//                     src/metrics/ring.ts (the engine has no surge sidecar); RINGY (> -32) is gated
//   - activeFraction  src/taste/showdown.ts — a mostly-silent render (< 0.5) is gated
//   - CE/CU/PC/PQ     Audiobox-Aesthetics axes (embedAudioFile --backend aes); CE+PQ = quality
//   - criticPess      the ensemble critic's pessimistic score (criticWithUncertainty over the
//                     owner's rated dataset, examples/taste-t1/beat-scores.jsonl, READ-ONLY)
// Renders/scores cache under ~/Documents/dotbeat/tools/engine-curation-cache (NOT the repo), keyed by
// role + candidate id + probe version, so re-runs are incremental.
//
// ENV: BEAT_PYTHON a scoring interpreter with audiobox_aesthetics (or python/.venv); HF_HUB_OFFLINE=1.
// The engine render needs ui/ built (ui/dist) — `beat render` reports the steps if missing.
//
// Usage: node scripts/curate-engine-presets.mjs [--roles bassline,chords,lead] [--rolls 2000]
//        [--seed 7] [--top 0.25] [--out presets/engine-curated.json] [--limit N] [--force]
//   --rolls N   total random rolls across roles (split evenly); default 2000 (~2k engine renders)
//   --limit N   cap candidates per role (smoke; the cache still fills incrementally)
//   --force     ignore cached renders/scores and re-render every candidate

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROBE_VERSION = 1 // bump when a role probe or the roll space changes → cache entries re-render
const CHUNK = 48 // candidates per one-boot render batch (amortizes the engine boot)

// ---- CLI args ----------------------------------------------------------------------------------
const argv = process.argv.slice(2)
const USAGE = `curate-engine-presets — score & curate the engine's patch space per role (E2)

  node scripts/curate-engine-presets.mjs [options]

Options:
  --roles r1,r2   roles to curate (default: bassline,chords,lead)
  --rolls N       total random rolls across roles, split evenly (default: 2000)
  --seed N        base seed for the roll space (default: 7)
  --top F         top fraction to keep per role (default: 0.25)
  --out PATH      output file (default: presets/engine-curated.json)
  --limit N       cap candidates per role (smoke; cache still fills)
  --force         ignore cached renders/scores and re-render every candidate
  -h, --help      print this help and exit

Environment: BEAT_PYTHON (audiobox_aesthetics-bearing) or python/.venv; HF_HUB_OFFLINE=1.
Renders/scores cache under ~/Documents/dotbeat/tools/engine-curation-cache (outside the repo).`

if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(USAGE + '\n')
  process.exit(0)
}
const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}
const roles = (flag('--roles') ?? 'bassline,chords,lead').split(',').map((r) => r.trim()).filter(Boolean)
const totalRolls = flag('--rolls') !== undefined ? Number(flag('--rolls')) : 2000
const baseSeed = flag('--seed') !== undefined ? Number(flag('--seed')) : 7
const topFraction = flag('--top') !== undefined ? Number(flag('--top')) : 0.25
const outPath = resolve(repoRoot, flag('--out') ?? 'presets/engine-curated.json')
const limit = flag('--limit') !== undefined ? Number(flag('--limit')) : Infinity
const force = argv.includes('--force')

const cacheRoot = join(homedir(), 'Documents', 'dotbeat', 'tools', 'engine-curation-cache')
const beatScores = resolve(repoRoot, 'examples', 'taste-t1', 'beat-scores.jsonl')
const workRoot = join(cacheRoot, '_work')
const log = (msg) => process.stderr.write(`[engine-curate ${new Date().toISOString().slice(11, 19)}] ${msg}\n`)

// ---- role probes (STEP-time .beat note lists; bpm 100 → 1 step = 0.15 s) ------------------------
const PROBES = {
  bassline: {
    desc: 'sustained low C2 (midi 36) then its octave C3 (midi 48), ~1.65s each',
    notes: [{ midi: 36, start: 0, len: 11, vel: 0.9 }, { midi: 48, start: 11, len: 11, vel: 0.9 }],
  },
  chords: {
    desc: 'one held C-major triad (midi 60/64/67, ~2.55s)',
    notes: [{ midi: 60, start: 0, len: 17, vel: 0.85 }, { midi: 64, start: 0, len: 17, vel: 0.85 }, { midi: 67, start: 0, len: 17, vel: 0.85 }],
  },
  lead: {
    desc: '4-note ascending motif C5-E5-G5-C6 (midi 72/76/79/84), last held',
    notes: [{ midi: 72, start: 0, len: 3, vel: 0.9 }, { midi: 76, start: 3, len: 3, vel: 0.9 }, { midi: 79, start: 6, len: 3, vel: 0.9 }, { midi: 84, start: 9, len: 7, vel: 0.9 }],
  },
}

// factory synth-preset categories per role (mirrors src/taste/enginePresets.ts E1 mapping)
const ROLE_CATEGORIES = { bassline: ['bass'], chords: ['pad', 'keys'], lead: ['lead', 'pluck', 'arp'] }

const OSCS = ['sawtooth', 'square', 'triangle']

// ---- roll space (core synth timbre; VARY_GROUPS bounds, resonance capped 0.85) ------------------
const rrange = (rng, lo, hi) => lo + rng() * (hi - lo)
const rlog = (rng, lo, hi) => Math.exp(rrange(rng, Math.log(lo), Math.log(hi)))
const round = (v, dp = 3) => Number(v.toFixed(dp))
function rollParams(rng) {
  return {
    osc: OSCS[Math.floor(rng() * OSCS.length)],
    volume: round(rrange(rng, -14, -6), 1),
    cutoff: Math.round(rlog(rng, 150, 11000)),
    resonance: round(rlog(rng, 0.2, 0.85)),
    attack: round(rlog(rng, 0.002, 0.8)),
    decay: round(rlog(rng, 0.02, 1)),
    sustain: round(rrange(rng, 0, 1), 2),
    release: round(rlog(rng, 0.02, 1.8)),
  }
}

function probeBaseText(role) {
  const p = PROBES[role]
  const lines = ['format_version 0.11', 'bpm 100', 'loop_bars 2', 'selected_track voice', '',
    'track voice Voice #98c379 synth',
    '  synth',
    '    osc sawtooth', '    volume -9', '    cutoff 3000', '    resonance 0.4',
    '    attack 0.01', '    decay 0.3', '    sustain 0.6', '    release 0.4', '    pan 0']
  let uid = 1
  for (const n of p.notes) lines.push(`  note u${uid++} ${n.midi} ${n.start} ${n.len} ${n.vel}`)
  return lines.join('\n') + '\n'
}

async function main() {
  log(`roles=${roles.join(',')} rolls=${totalRolls} seed=${baseSeed} top=${topFraction} cache=${cacheRoot}`)
  const python = process.env.BEAT_PYTHON ?? (existsSync(join(repoRoot, 'python', '.venv', 'bin', 'python3')) ? join(repoRoot, 'python', '.venv', 'bin', 'python3') : 'python3')
  log(`python=${python}  HF_HUB_OFFLINE=${process.env.HF_HUB_OFFLINE ?? '(unset)'}`)

  const { parse, setValue } = await import('../dist/src/core/index.js')
  const { parsePresetLibrary } = await import('../dist/src/core/preset.js')
  const { writeVaryBatch, renderVaryBatch } = await import('../dist/src/vary/batch.js')
  const { mulberry32 } = await import('../dist/src/taste/eval.js')
  const showdown = await import('../dist/src/taste/showdown.js')
  const { ringDb } = await import('../dist/src/metrics/ring.js')
  const metrics = await import('../dist/src/metrics/index.js')
  const features = await import('../dist/src/taste/features.js')
  const embeddings = await import('../dist/src/taste/embeddings.js')
  const evalMod = await import('../dist/src/taste/eval.js')
  const curation = await import('../dist/src/taste/surgeCuration.js')

  const factory = parsePresetLibrary(readFileSync(resolve(repoRoot, 'presets', 'factory.json'), 'utf8'))

  log(`building ensemble critic over ${beatScores} (aes backend)...`)
  const critic = await evalMod.criticWithUncertainty(beatScores, { aesBackend: 'aes' })
  log(`critic ready: ${critic.trainedBatches} batches, ${critic.trainedPairs} pairs, beta=${critic.beta}`)

  const rollsPerRole = Math.max(1, Math.floor(totalRolls / roles.length))
  const roleResults = {}
  mkdirSync(workRoot, { recursive: true })

  for (const role of roles) {
    const probe = PROBES[role]
    const categories = ROLE_CATEGORIES[role]
    if (!probe || !categories) { log(`role ${role}: no probe/categories — skipping`); continue }
    const roleCacheDir = join(cacheRoot, role)
    mkdirSync(roleCacheDir, { recursive: true })

    // candidate pool: factory synth presets in the role's categories + seeded random rolls
    const candidates = []
    for (const p of factory) {
      if (p.kind === 'synth' && categories.includes(p.category)) {
        candidates.push({ id: p.name, source: `factory:${p.name}`, category: p.category, params: { ...p.params } })
      }
    }
    const rng = mulberry32((baseSeed * 1000003 + role.length * 7919) >>> 0)
    for (let i = 0; i < rollsPerRole; i++) {
      const params = rollParams(rng)
      const id = `roll-${role}-${i}`
      candidates.push({ id, source: 'random-roll', category: 'roll', params })
    }
    const scoped = Number.isFinite(limit) ? candidates.slice(0, limit) : candidates
    log(`role ${role}: ${candidates.length} candidates (${candidates.length - rollsPerRole} factory + ${rollsPerRole} rolls)${Number.isFinite(limit) ? ` — scoring first ${scoped.length}` : ''}`)

    const cachePathOf = (c) => join(roleCacheDir, `${c.id}.render.json`)
    const scored = new Map() // id -> { ringDb, activeFraction, dsp, aes }

    // load cache
    const uncached = []
    for (const c of scoped) {
      const cp = cachePathOf(c)
      if (!force && existsSync(cp)) {
        try {
          const prev = JSON.parse(readFileSync(cp, 'utf8'))
          if (prev.probeVersion === PROBE_VERSION && typeof prev.ringDb === 'number' && Array.isArray(prev.aes) && prev.dsp) {
            scored.set(c.id, { ringDb: prev.ringDb, activeFraction: prev.activeFraction, dsp: prev.dsp, aes: prev.aes })
            continue
          }
        } catch { /* recompute */ }
      }
      uncached.push(c)
    }
    log(`role ${role}: ${scoped.length - uncached.length} cached, ${uncached.length} to render`)

    const baseText = probeBaseText(role)
    const baseDoc = parse(baseText)
    const basePath = join(workRoot, `${role}-base.beat`)
    writeFileSync(basePath, baseText)

    // render + score uncached in one-boot chunks
    for (let off = 0; off < uncached.length; off += CHUNK) {
      const chunk = uncached.slice(off, off + CHUNK)
      const outDir = join(workRoot, `${role}-chunk`)
      rmSync(outDir, { recursive: true, force: true })
      const variants = chunk.map((c) => {
        let doc = baseDoc
        for (const [key, value] of Object.entries(c.params)) doc = setValue(doc, `voice.${key}`, String(value))
        return { doc, recipe: `engine ${role} probe: ${c.id} (${c.source})` }
      })
      writeVaryBatch({ parentPath: basePath, parentText: baseText, track: 'voice', group: 'engine-curate', count: variants.length, seed: baseSeed, outDir, variants })
      renderVaryBatch(outDir, variants.length, { normalize: false })
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i]
        const wav = join(outDir, `v${i + 1}.wav`)
        try {
          if (!existsSync(wav)) throw new Error('no render wav')
          const decoded = metrics.decodeWav(readFileSync(wav))
          const ring = ringDb(decoded.channels, decoded.sampleRate)
          const active = showdown.activeFraction(decoded.channels, decoded.sampleRate)
          const dsp = features.featuresForAudioFile(wav)
          if (dsp === null) throw new Error('feature extraction returned null')
          const aesRes = await embeddings.embedAudioFile(wav, { backend: 'aes' })
          const aes = aesRes.embedding
          if (!Array.isArray(aes) || aes.length < 4) throw new Error(`aes returned ${aes?.length} axes`)
          writeFileSync(cachePathOf(c), JSON.stringify({ probeVersion: PROBE_VERSION, ringDb: ring, activeFraction: active, dsp, aes, source: c.source, category: c.category }) + '\n')
          scored.set(c.id, { ringDb: ring, activeFraction: active, dsp, aes })
        } catch (err) {
          log(`  ! ${role} ${c.id}: ${err instanceof Error ? err.message : err} — dropped`)
        }
      }
      rmSync(outDir, { recursive: true, force: true })
      log(`  ${role}: ${Math.min(off + CHUNK, uncached.length)}/${uncached.length} rendered (${scored.size} scored total)`)
    }

    // critic pessimistic over the whole role population, then gate + composite blend
    const alive = scoped.filter((c) => scored.has(c.id))
    const critPess = critic.scorePopulation(alive.map((c) => ({ dsp: scored.get(c.id).dsp, aes: scored.get(c.id).aes.slice(0, 4) })))
    const curationCandidates = alive.map((c, i) => {
      const s = scored.get(c.id)
      return { name: c.id, category: c.category, relPath: c.id, scores: { ringDb: s.ringDb, activeFraction: s.activeFraction, ce: s.aes[0], cu: s.aes[1], pc: s.aes[2], pq: s.aes[3], criticPessimistic: critPess[i]?.pessimistic ?? 0 } }
    })
    const { survivors, kept } = curation.curateRole(curationCandidates, { topFraction })
    // map kept ids back to their params/source for the output bank
    const paramsById = new Map(alive.map((c) => [c.id, c]))
    const keptOut = kept.map((k) => {
      const c = paramsById.get(k.name)
      return { id: k.name, source: c.source, category: c.category, params: c.params, composite: Number(k.composite.toFixed(4)) }
    })
    log(`role ${role}: ${alive.length} scored → ${survivors} survivors (gates) → ${kept.length} kept (top ${Math.round(topFraction * 100)}%)`)
    for (const k of keptOut.slice(0, 5)) log(`    keep: ${k.id} (${k.source})  composite=${k.composite}`)
    roleResults[role] = { pool: candidates.length, scored: alive.length, survivors, kept: keptOut }
  }

  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    note: 'Engine patch curation per role (docs/engine-presets.md E2). Preferred by beat showdown/taste-seeds/gen-kit; absent → factory pool (E1), then random-seed-patch.',
    probeVersion: PROBE_VERSION,
    seed: baseSeed,
    rollsPerRole,
    probe: Object.fromEntries(Object.entries(PROBES).map(([r, v]) => [r, v.desc])),
    blend: curation.CURATION_BLEND,
    gates: curation.CURATION_GATES,
    dataset: 'examples/taste-t1/beat-scores.jsonl',
    roles: roleResults,
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n')
  log(`wrote ${outPath}`)
  for (const [role, r] of Object.entries(roleResults)) log(`  ${role}: pool ${r.pool}, scored ${r.scored}, survivors ${r.survivors}, kept ${r.kept.length}`)
  try { rmSync(workRoot, { recursive: true, force: true }) } catch { /* best-effort */ }
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? err.stack || err.message : err}`)
  process.exit(1)
})
