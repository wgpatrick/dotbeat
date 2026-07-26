// PRESET RETARGETING (owner's idea, 2026-07-26: "take known presets that we already have in surge /
// engineplus and then try to make them hit those parameters").
//
// Take a curated/factory engine preset — a human-designed known-good point — and LOCALLY optimize
// its parameters toward the role's measured target profile (src/retarget/targets.ts, derived from
// research/131 §7 and the owner's own pack-ref pool), inside a trust region, with a loss that
// cannot be bought by gaming one axis and that charges for breaking what the preset already got
// right. Emits: the retargeted bank, a before/after feature table, the loss curve, the parameter
// diff, and before/after renders for listening.
//
// WHY THIS IS NOT THE T5 SCALING GATE (research/117, docs/pilot.md): that search roamed a large
// patch space from random inits under a critic and LOST to random controls. This one starts at a
// good patch, moves at most one trust radius per parameter, and optimizes ~9 SCALAR targets rather
// than a full spectrum (which is what research/138's T6 ceiling study found unreachable).
//
// WHAT IS OPTIMIZED: the RAW soloed engine voice — no engineplus production pass. The patch is the
// only variable; production is a separate lever with its own frozen profiles (CLAUDE.md's
// frozen-science rule). Renders are mono by construction, which is why widthMeanDb is reported but
// never scored.
//
// HELD-OUT CHECK: the search uses one composed figure per role; the report re-measures the winner
// on a SECOND figure the search never saw, so "did this overfit the figure" is answered with a
// number instead of a hope.
//
// PRIVACY: before/after wavs go to ~/Documents/dotbeat/taste-dataset/retarget-check/ (outside the
// repo, never committed). Only params and aggregate features are written into presets/.
//
// Usage:
//   node scripts/retarget-presets.mjs [--roles bassline,chords,lead] [--per-role 2]
//        [--budget 300] [--population 12] [--seed 41] [--out presets/engine-retargeted.json]
//        [--report DIR] [--dry-run]

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d
}
const roles = flag('--roles', 'bassline,chords,lead').split(',').map((s) => s.trim()).filter(Boolean)
const perRole = Number(flag('--per-role', '2'))
const budget = Number(flag('--budget', '300'))
const population = Number(flag('--population', '12'))
const seed = Number(flag('--seed', '41'))
const outPath = resolve(repoRoot, flag('--out', 'presets/engine-retargeted.json'))
const dryRun = argv.includes('--dry-run')
const renderRoot = resolve(flag('--renders', join(homedir(), 'Documents', 'dotbeat', 'taste-dataset', 'retarget-check')))
const reportDir = resolve(flag('--report', renderRoot))

const BPM = 120
const LOOP_BARS = 4
const RENDER_SECONDS = (LOOP_BARS * 240) / BPM
const TRACK = 'voice'
/** Fixed figure seeds: the first is what the search optimizes against, the second is the held-out
 * check. Frozen here so a re-run reproduces the same clips. */
const FIGURE_SEED = { bassline: 12345, chords: 22334, lead: 31415 }
const HELDOUT_SEED = { bassline: 54321, chords: 43322, lead: 51413 }
/** MIDI root of the composed key (48 = C3), the taste-seed generator's own range. */
const KEY = { root: 48, minor: true }

const log = (m) => process.stderr.write(`[retarget ${new Date().toISOString().slice(11, 19)}] ${m}\n`)

const { parse, serialize, setValue } = await import(join(repoRoot, 'dist/src/core/index.js'))
const showdown = await import(join(repoRoot, 'dist/src/taste/showdown.js'))
const metrics = await import(join(repoRoot, 'dist/src/metrics/index.js'))
const retarget = await import(join(repoRoot, 'dist/src/retarget/index.js'))
const { parsePresetLibrary } = await import(join(repoRoot, 'dist/src/core/preset.js'))

// ---- the evaluation clip -------------------------------------------------------------------------

function baseText() {
  return (
    [
      'format_version 0.11',
      `bpm ${BPM}`,
      `loop_bars ${LOOP_BARS}`,
      `selected_track ${TRACK}`,
      '',
      `track ${TRACK} Voice #98c379 synth`,
      '  synth',
      '    osc sawtooth',
      `    volume ${showdown.SHOWDOWN_PROMINENT_DB}`,
      '    cutoff 3000',
      '    resonance 0.4',
      '    attack 0.01',
      '    decay 0.3',
      '    sustain 0.6',
      '    release 0.4',
      '    pan 0',
      '  note n1 48 0 8 0.8',
    ].join('\n') + '\n'
  )
}

/** The role's 4-bar composed figure applied to a bare solo synth track — the same figure vocabulary
 * `beat showdown` composes its engine clip from (src/taste/showdown.ts composePitchedPhrase). */
function figureDoc(role, figureSeed) {
  const phrase = showdown.composePitchedPhrase(role, KEY, figureSeed)
  return { doc: showdown.applyComposedPhrase(parse(baseText()), TRACK, phrase), archetype: phrase.archetype }
}

/** doc + a preset's param bag -> canonical .beat text. String values (osc, filterType) apply too:
 * the preset's own oscillator is part of the preset, it just isn't in the SEARCH space. */
function textFor(doc, params) {
  let d = doc
  for (const [k, v] of Object.entries(params)) d = setValue(d, `${TRACK}.${k}`, String(v))
  return serialize(d)
}

// ---- preset pools ---------------------------------------------------------------------------------

function poolFor(role) {
  const out = []
  const curatedPath = join(repoRoot, 'presets', 'engine-curated.json')
  if (existsSync(curatedPath)) {
    try {
      const bank = JSON.parse(readFileSync(curatedPath, 'utf8'))
      for (const k of bank.roles?.[role]?.kept ?? []) {
        out.push({ id: k.id, source: `curated:${k.id}`, category: k.category, params: { ...k.params }, composite: k.composite })
      }
    } catch (err) {
      log(`could not read engine-curated.json (${err.message}) — falling back to factory`)
    }
  }
  const categories = { bassline: ['bass'], chords: ['pad', 'keys'], lead: ['lead', 'pluck', 'arp'] }[role] ?? []
  for (const p of parsePresetLibrary(readFileSync(join(repoRoot, 'presets', 'factory.json'), 'utf8'))) {
    if (p.kind === 'synth' && categories.includes(p.category)) {
      out.push({ id: p.name, source: `factory:${p.name}`, category: p.category, params: { ...p.params }, composite: null })
    }
  }
  return out
}

/** Pick `n` presets per role: the top curated patches, plus a named FACTORY preset so the report
 * covers both banks (the owner's phrasing was "presets that we already have"). */
function pick(role, n) {
  const pool = poolFor(role)
  const curated = pool.filter((p) => p.source.startsWith('curated:'))
  const factory = pool.filter((p) => p.source.startsWith('factory:'))
  const chosen = []
  for (let i = 0; i < n; i++) {
    const fromCurated = i % 2 === 0 ? curated[Math.floor(i / 2)] : undefined
    const fromFactory = i % 2 === 1 ? factory[Math.floor(i / 2)] : undefined
    const p = fromCurated ?? fromFactory ?? curated[i] ?? factory[i]
    if (p && !chosen.some((c) => c.id === p.id)) chosen.push(p)
  }
  return chosen
}

// ---- run -------------------------------------------------------------------------------------------

async function main() {
  log(`roles=${roles.join(',')} perRole=${perRole} budget=${budget} population=${population} seed=${seed}`)
  mkdirSync(renderRoot, { recursive: true })
  mkdirSync(reportDir, { recursive: true })
  const workDir = join(renderRoot, '_work')
  mkdirSync(workDir, { recursive: true })
  const scratch = join(workDir, 'current.beat')

  const plan = []
  for (const role of roles) for (const p of pick(role, perRole)) plan.push({ role, preset: p })
  log(`plan: ${plan.length} presets — ${plan.map((x) => `${x.role}/${x.preset.id}`).join(', ')}`)
  const evalsPlanned = plan.length * (budget + 3)
  log(`~${evalsPlanned} renders planned; at the measured ~1.02 s/render that is ~${Math.round((evalsPlanned * 1.13) / 60)} min`)
  if (dryRun) {
    process.stderr.write(JSON.stringify(plan.map((x) => ({ role: x.role, id: x.preset.id, source: x.preset.source })), null, 2) + '\n')
    return
  }

  const { startMatchRenderSession } = await import(join(repoRoot, 'cli/render.mjs'))
  const RECYCLE_EVERY = 350
  let inner = await startMatchRenderSession(scratch, textFor(figureDoc(roles[0], FIGURE_SEED[roles[0]]).doc, {}), {})
  let sessionRenders = 0
  const renderText = async (text) => {
    if (sessionRenders >= RECYCLE_EVERY) {
      log(`recycling the render session after ${sessionRenders} renders (the headless page degrades near ~580)`)
      await inner.close()
      inner = await startMatchRenderSession(scratch, text, {})
      sessionRenders = 0
    }
    sessionRenders++
    const bytes = await inner.render(text, RENDER_SECONDS)
    const d = metrics.decodeWav(bytes)
    return { bytes, channels: d.channels, sampleRate: d.sampleRate }
  }

  const results = []
  try {
    for (const { role, preset } of plan) {
      const { doc, archetype } = figureDoc(role, FIGURE_SEED[role])
      const { doc: heldDoc, archetype: heldArchetype } = figureDoc(role, HELDOUT_SEED[role])
      log(`--- ${role}/${preset.id} (${preset.source}); figure "${archetype}", held-out "${heldArchetype}"`)
      const t0 = Date.now()
      const result = await retarget.runRetarget({
        role,
        presetId: preset.id,
        presetParams: preset.params,
        budget,
        population,
        seed,
        log: (line) => log(line),
        render: async (params) => {
          const { channels, sampleRate } = await renderText(textFor(doc, { ...preset.params, ...params }))
          return { channels, sampleRate }
        },
      })
      log(retarget.formatRetargetReport(result))

      // held-out figure: the same two patches on a figure the search never saw
      const heldBefore = await renderText(textFor(heldDoc, preset.params))
      const heldAfter = await renderText(textFor(heldDoc, { ...preset.params, ...result.afterParams }))
      const heldBeforeF = retarget.computeRetargetFeatures(heldBefore.channels, heldBefore.sampleRate)
      const heldAfterF = retarget.computeRetargetFeatures(heldAfter.channels, heldAfter.sampleRate)
      const profile = retarget.targetProfileFor(role)
      const heldBeforeLoss = retarget.retargetLoss(heldBeforeF, profile, heldBeforeF)
      const heldAfterLoss = retarget.retargetLoss(heldAfterF, profile, heldBeforeF)
      log(`  held-out figure: ${heldBeforeLoss.hit}/${heldBeforeLoss.of} -> ${heldAfterLoss.hit}/${heldAfterLoss.of} targets hit, gap ${heldBeforeLoss.gap.toFixed(4)} -> ${heldAfterLoss.gap.toFixed(4)}`)

      // renders for the owner's ears (private dir)
      const stem = `${role}--${preset.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
      const roleDir = join(renderRoot, role)
      mkdirSync(roleDir, { recursive: true })
      const before = await renderText(textFor(doc, preset.params))
      const after = await renderText(textFor(doc, { ...preset.params, ...result.afterParams }))
      writeFileSync(join(roleDir, `${stem}--before.wav`), before.bytes)
      writeFileSync(join(roleDir, `${stem}--after.wav`), after.bytes)
      writeFileSync(join(roleDir, `${stem}--heldout-before.wav`), heldBefore.bytes)
      writeFileSync(join(roleDir, `${stem}--heldout-after.wav`), heldAfter.bytes)
      writeFileSync(join(roleDir, `${stem}--before.beat`), textFor(doc, preset.params))
      writeFileSync(join(roleDir, `${stem}--after.beat`), textFor(doc, { ...preset.params, ...result.afterParams }))
      writeFileSync(join(roleDir, `${stem}--loss-curve.jsonl`), result.curve.map((p) => JSON.stringify(p)).join('\n') + '\n')

      const { afterAudio, beforeAudio, ...serializable } = result
      results.push({
        ...serializable,
        source: preset.source,
        category: preset.category,
        figureArchetype: archetype,
        heldOut: {
          archetype: heldArchetype,
          before: { features: heldBeforeF, hit: heldBeforeLoss.hit, of: heldBeforeLoss.of, gap: heldBeforeLoss.gap, total: heldBeforeLoss.total },
          after: { features: heldAfterF, hit: heldAfterLoss.hit, of: heldAfterLoss.of, gap: heldAfterLoss.gap, total: heldAfterLoss.total },
        },
        renderStem: stem,
        wallSeconds: Math.round((Date.now() - t0) / 100) / 10,
      })
    }
  } finally {
    await inner.close()
    try { rmSync(workDir, { recursive: true, force: true }) } catch { /* best-effort */ }
  }

  // ---- the retargeted preset bank -----------------------------------------------------------------
  const byRole = {}
  for (const r of results) {
    ;(byRole[r.role] ??= { retargeted: [] }).retargeted.push({
      id: `${r.presetId}-rt`,
      source: `retarget:${r.source}`,
      category: r.category,
      params: { ...(plan.find((p) => p.preset.id === r.presetId)?.preset.params ?? {}), ...r.afterParams },
      provenance: {
        from: r.presetId,
        fromSource: r.source,
        role: r.role,
        lossVersion: r.lossVersion,
        budget: r.budget,
        renders: r.renders,
        seed: r.seed,
        figureArchetype: r.figureArchetype,
        targetsHit: `${r.before.loss.hit}/${r.before.loss.of} -> ${r.after.loss.hit}/${r.after.loss.of}`,
        gap: `${round4(r.before.loss.gap)} -> ${round4(r.after.loss.gap)}`,
        heldOutGap: `${round4(r.heldOut.before.gap)} -> ${round4(r.heldOut.after.gap)}`,
        moved: r.moved.map((m) => `${m.field} ${m.from}->${m.to}`),
        unreachable: r.unreachable.map((u) => `${u.key} ${u.region} (at ${u.value})`),
      },
    })
  }
  const bank = {
    version: 1,
    generatedAt: new Date().toISOString(),
    note:
      'Preset RETARGETING (docs/preset-retargeting.md): curated/factory engine presets locally ' +
      'optimized toward the per-role scalar targets in src/retarget/targets.ts (research/131 §7 + ' +
      "the owner's pack-ref pool), inside a per-parameter trust region. Same shape as " +
      'presets/engine-curated.json so a showdown arm can draw from it; each row carries the ' +
      'provenance of the preset it came from and what moved.',
    lossVersion: retarget.RETARGET_LOSS_VERSION,
    budget,
    population,
    seed,
    figure: { bpm: BPM, loopBars: LOOP_BARS, keyRootMidi: KEY.root, minor: KEY.minor, searchSeeds: FIGURE_SEED, heldOutSeeds: HELDOUT_SEED },
    renderedThrough: 'raw soloed engine voice (no production pass) — mono by construction',
    roles: byRole,
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(bank, null, 2) + '\n')
  log(`wrote ${outPath}`)

  const reportPath = join(reportDir, 'retarget-report.json')
  writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), budget, population, seed, results }, null, 2) + '\n')
  writeFileSync(join(reportDir, 'retarget-table.md'), renderTable(results))
  log(`wrote ${reportPath} and retarget-table.md (private dir — never committed)`)
  for (const r of results) log(`  ${r.role}/${r.presetId}: ${r.before.loss.hit}/${r.before.loss.of} -> ${r.after.loss.hit}/${r.after.loss.of} hit, ${r.wallSeconds}s`)
}

const round4 = (x) => Math.round(x * 10000) / 10000

function renderTable(results) {
  const out = ['# Preset retargeting — before/after', '']
  for (const r of results) {
    const profile = retarget.targetProfileFor(r.role)
    out.push(`## ${r.role} / ${r.presetId} (${r.source})`)
    out.push('')
    out.push(`figure "${r.figureArchetype}", held-out "${r.heldOut.archetype}"; ${r.renders} renders, ${r.wallSeconds}s`)
    out.push(`loss ${round4(r.before.loss.total)} -> ${round4(r.after.loss.total)}; targets hit ${r.before.loss.hit}/${r.before.loss.of} -> ${r.after.loss.hit}/${r.after.loss.of}`)
    out.push(`held-out figure: ${r.heldOut.before.hit}/${r.heldOut.before.of} -> ${r.heldOut.after.hit}/${r.heldOut.after.of} hit, gap ${round4(r.heldOut.before.gap)} -> ${round4(r.heldOut.after.gap)}`)
    out.push('')
    out.push('| axis | target | before | after | held-out after | status |')
    out.push('|---|---|---|---|---|---|')
    for (const t of profile.targets) {
      const b = r.before.features[t.key]
      const a = r.after.features[t.key]
      const h = r.heldOut.after.features[t.key]
      const ok = retarget.targetSatisfied(t, a)
      const wasOk = retarget.targetSatisfied(t, b)
      const status = ok && !wasOk ? 'GAINED' : ok ? 'kept' : wasOk ? 'LOST' : 'unreached'
      out.push(`| ${t.key} | ${retarget.describeTarget(t)} | ${round4(b)} | ${round4(a)} | ${round4(h)} | ${status} |`)
    }
    for (const k of [...profile.preserve, ...profile.informational]) {
      out.push(`| ${k} _(not scored)_ | — | ${round4(r.before.features[k])} | ${round4(r.after.features[k])} | ${round4(r.heldOut.after.features[k])} | — |`)
    }
    out.push('')
    out.push(`moved: ${r.moved.length ? r.moved.map((m) => `\`${m.field}\` ${m.from} -> ${m.to}`).join(', ') : 'nothing'}`)
    out.push('')
    out.push(`renders: \`${r.renderStem}--before.wav\` / \`--after.wav\` (+ \`--heldout-*\`)`)
    out.push('')
  }
  return out.join('\n') + '\n'
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? (err.stack ?? err.message) : err}`)
  process.exit(1)
})
