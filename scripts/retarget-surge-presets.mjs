// PRESET RETARGETING, SURGE ARM — the same local-optimization-from-a-known-good-point idea applied
// to Surge XT factory patches instead of engine patches.
//
// FEASIBILITY (measured 2026-07-26, this machine, before any of this was built): a Surge render of
// a 9.45 s figure costs 0.52 s INCLUDING process spawn, patch load and WAV write — HALF the engine's
// 1.02 s for an 8 s clip. Eight concurrent sidecar processes finish 8 renders in 1.57 s wall
// (0.20 s/render effective; 12-way gives 0.17). Surge is the CHEAPER backend, not the more
// expensive one, and it parallelizes trivially because each render is an independent process,
// where the engine funnels through one headless Chromium session.
//
// WHAT HAD TO BE FIXED FIRST: surgepy's `setParamVal` takes a parameter's NATIVE value, but
// python/surge_render.py's `overrides` path validates "normalized 0..1" and rejects everything
// else — so it could only ever reach the 0..1 slice of each range ("A Filter 1 Cutoff" spans
// -60..70 = 13.75 Hz..14 kHz; 0..1 reaches 440.00..466.16 Hz). Parameters whose native range
// happens to BE 0..1 (resonance, EG sustain) were unaffected, which is how it went unnoticed. The
// old path is untouched (every cached render is keyed on it); `nativeOverrides` and `--dump-params`
// were added alongside.
//
// SPACE: resolved PER PATCH from `--dump-params`, because Surge's oscillator parameter slots are
// TYPE-DEPENDENT — "A Osc 1 Sub Mix" and "A Osc 1 Unison Detune" exist on a Classic oscillator and
// simply are not there on an FM2 one (measured across Basses/Theme, Pads/Bright, Plucks/The 1980s).
// A macro is skipped, with a note, when the patch does not have it.
//
// WIDTH: surge renders are STEREO, so widthMeanDb is measurable here where the engine's mono
// renders make it meaningless. It is still NOT scored — the role profiles are shared between the
// two backends, and scoring an axis on one but not the other would make their losses incomparable.
// Reported as informational; a surge-specific width target is a stated follow-up.
//
// Usage:
//   node scripts/retarget-surge-presets.mjs [--roles bassline,chords,lead] [--per-role 1]
//        [--budget 200] [--population 10] [--seed 41] [--out presets/surge-retargeted.json]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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
const perRole = Number(flag('--per-role', '1'))
const budget = Number(flag('--budget', '200'))
const population = Number(flag('--population', '10'))
const seed = Number(flag('--seed', '41'))
const outPath = resolve(repoRoot, flag('--out', 'presets/surge-retargeted.json'))
const renderRoot = resolve(flag('--renders', join(homedir(), 'Documents', 'dotbeat', 'taste-dataset', 'retarget-check', 'surge')))
const dryRun = argv.includes('--dry-run')

const BPM = 120
const FIGURE_SEED = { bassline: 12345, chords: 22334, lead: 31415 }
const HELDOUT_SEED = { bassline: 54321, chords: 43322, lead: 51413 }
const KEY = { root: 48, minor: true }

const log = (m) => process.stderr.write(`[surge-retarget ${new Date().toISOString().slice(11, 19)}] ${m}\n`)

const showdown = await import(join(repoRoot, 'dist/src/taste/showdown.js'))
const metrics = await import(join(repoRoot, 'dist/src/metrics/index.js'))
const retarget = await import(join(repoRoot, 'dist/src/retarget/index.js'))

const PYTHON =
  process.env.BEAT_PYTHON ??
  (existsSync(join(repoRoot, 'python', '.venv', 'bin', 'python3'))
    ? join(repoRoot, 'python', '.venv', 'bin', 'python3')
    : existsSync(join(repoRoot, '..', '..', '..', 'python', '.venv', 'bin', 'python3'))
      ? resolve(repoRoot, '..', '..', '..', 'python', '.venv', 'bin', 'python3')
      : 'python3')
const SIDECAR = join(repoRoot, 'python', 'surge_render.py')

/** The macro set a retarget may move, with trust radii as a FRACTION of the parameter's own
 * [min, max]. Names are Surge's canonical parameter names; a patch missing one is skipped. Ranges
 * come from the patch itself, so a radius means the same thing on every patch. Surge's native
 * units are already perceptual (cutoff in semitones, envelopes in log2 seconds), so 'linear' in
 * native space IS logarithmic in Hz/seconds — no scale conversion needed. */
const SURGE_MACROS = [
  { name: 'A Filter 1 Cutoff', trust: 0.1, note: 'centroid / mids share / tilt. 0.1 of a 130-semitone range = ~1.1 octaves.' },
  { name: 'A Filter 1 Resonance', trust: 0.25, note: 'presence-band crest and flatness.' },
  { name: 'A Filter 2 Cutoff', trust: 0.1, note: 'the second filter stage, when the patch uses one.' },
  { name: 'A Filter Balance', trust: 0.2, note: 'serial/parallel filter blend — timbre without moving either cutoff.' },
  { name: 'A Filter 1 FEG Mod Amount', trust: 0.12, note: '131 §7 P3 movement: how far the filter envelope sweeps.' },
  { name: 'A Filter EG Attack', trust: 0.2, note: 'the sweep leading edge — attack statistics see it.' },
  { name: 'A Filter EG Decay', trust: 0.25, note: 'how long each note keeps moving (fluxMean).' },
  { name: 'A Filter EG Sustain', trust: 0.3, note: 'where the sweep settles.' },
  { name: 'A Amp EG Attack', trust: 0.25, note: '131 §7 P2 attack targets.' },
  { name: 'A Amp EG Decay', trust: 0.25, note: 'transient shape / band steadiness.' },
  { name: 'A Amp EG Sustain', trust: 0.3, note: 'sustainPct and band-energy steadiness.' },
  { name: 'A Amp EG Release', trust: 0.25, note: 'tail density between notes.' },
  { name: 'A Osc 1 Sub Mix', trust: 0.6, note: "138 §2 row 1's lever in Surge terms — the sub-oscillator mix. Wide trust on purpose. Classic-oscillator patches only." },
  { name: 'A Osc 1 Unison Detune', trust: 0.3, note: 'unison spread — body and width. Classic-oscillator patches only.' },
  { name: 'A Waveshaper Drive', trust: 0.3, note: '131 §7 P4: harmonics into the 2-8 kHz band.' },
  { name: 'A Highpass', trust: 0.15, note: 'the scene high-pass — the direct control over sub-band energy and its steadiness.' },
  { name: 'A Osc 1 Volume', trust: 0.2, note: 'oscillator level into the filter — drive, not output loudness (features are loudness-normalized).' },
  { name: 'A FM Depth', trust: 0.2, note: 'inter-oscillator FM — texture (flatnessHiDb) on patches routed for it.' },
]

const SURGE_ROLE_DIR = { bassline: 'bassline', chords: 'chords', lead: 'lead' }

function sidecar(args, stdin) {
  return JSON.parse(execFileSync(PYTHON, [SIDECAR, ...args], { input: stdin ?? undefined, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
}

function dumpParams(patchPath) {
  return sidecar(['--dump-params', patchPath])
}

function curatedSurgePool(role) {
  const p = join(repoRoot, 'presets', 'surge-curated.json')
  if (!existsSync(p)) return []
  const bank = JSON.parse(readFileSync(p, 'utf8'))
  return (bank.roles?.[role]?.kept ?? []).map((k) => ({ id: k.name, category: k.category, relPath: k.relPath }))
}

function patchesRoot() {
  const d = sidecar(['--doctor'])
  if (!d.surgepy?.available) throw new Error('surgepy is not available — see python/README.md')
  if (!d.patchesRoot) throw new Error('surge factory content not found')
  return d.patchesRoot
}

/** Build the retarget space for THIS patch: every macro the patch actually has, with the patch's
 * own [min, max] and value. Returns { defs, startParams, skipped }. */
function spaceForPatch(dump) {
  const byName = new Map(dump.params.map((p) => [p.name, p]))
  const defs = []
  const startParams = {}
  const skipped = []
  for (const m of SURGE_MACROS) {
    const p = byName.get(m.name)
    if (!p || p.type !== 'float' || !(p.max > p.min)) {
      skipped.push(m.name)
      continue
    }
    defs.push({ field: m.name, min: p.min, max: p.max, scale: 'linear', trust: m.trust, note: m.note })
    startParams[m.name] = p.value
  }
  return { defs, startParams, skipped }
}

async function main() {
  log(`python=${PYTHON}`)
  const root = patchesRoot()
  mkdirSync(renderRoot, { recursive: true })
  const plan = []
  for (const role of roles) for (const c of curatedSurgePool(role).slice(0, perRole)) plan.push({ role, ...c })
  if (plan.length === 0) throw new Error('no curated surge patches to retarget (presets/surge-curated.json missing or empty)')
  log(`plan: ${plan.map((p) => `${p.role}/${p.id}`).join(', ')}`)
  if (dryRun) return

  const results = []
  for (const item of plan) {
    const patchPath = join(root, item.relPath)
    if (!existsSync(patchPath)) {
      log(`  ! ${item.id}: no patch at ${item.relPath} — skipped`)
      continue
    }
    const dump = dumpParams(patchPath)
    const { defs, startParams, skipped } = spaceForPatch(dump)
    log(`--- ${item.role}/${item.id}: ${defs.length} macro dims (${skipped.length ? `skipped ${skipped.join(', ')}` : 'all present'})`)

    const phrase = showdown.composePitchedPhrase(item.role, KEY, FIGURE_SEED[item.role])
    const notes = showdown.composedPhraseToSurgeNotes(phrase, BPM)
    const held = showdown.composePitchedPhrase(item.role, KEY, HELDOUT_SEED[item.role])
    const heldNotes = showdown.composedPhraseToSurgeNotes(held, BPM)
    const scratchWav = join(renderRoot, '_scratch.wav')

    const renderWith = (noteList, params, outWav) => {
      const nativeOverrides = Object.entries(params).map(([param, value]) => ({ param, value }))
      sidecar([], JSON.stringify({ patch: patchPath, notes: noteList, sampleRate: 44100, output: outWav, nativeOverrides }))
      const d = metrics.decodeWav(readFileSync(outWav))
      return { bytes: readFileSync(outWav), channels: d.channels, sampleRate: d.sampleRate }
    }

    const t0 = Date.now()
    const result = await retarget.runRetarget({
      role: item.role,
      presetId: item.id,
      presetParams: startParams,
      space: defs,
      fallbackValue: (f) => startParams[f] ?? 0,
      budget,
      population,
      seed,
      log: (line) => log(line),
      render: async (params) => {
        const { channels, sampleRate } = renderWith(notes, params, scratchWav)
        return { channels, sampleRate }
      },
    })
    log(retarget.formatRetargetReport(result))

    const profile = retarget.targetProfileFor(item.role)
    const stem = `${item.role}--${item.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    const roleDir = join(renderRoot, SURGE_ROLE_DIR[item.role])
    mkdirSync(roleDir, { recursive: true })
    const before = renderWith(notes, startParams, join(roleDir, `${stem}--before.wav`))
    const after = renderWith(notes, result.afterParams, join(roleDir, `${stem}--after.wav`))
    const hb = renderWith(heldNotes, startParams, join(roleDir, `${stem}--heldout-before.wav`))
    const ha = renderWith(heldNotes, result.afterParams, join(roleDir, `${stem}--heldout-after.wav`))
    const hbF = retarget.computeRetargetFeatures(hb.channels, hb.sampleRate)
    const haF = retarget.computeRetargetFeatures(ha.channels, ha.sampleRate)
    const hbL = retarget.retargetLoss(hbF, profile, hbF)
    const haL = retarget.retargetLoss(haF, profile, hbF)
    log(`  held-out figure: ${hbL.hit}/${hbL.of} -> ${haL.hit}/${haL.of} targets hit, gap ${hbL.gap.toFixed(4)} -> ${haL.gap.toFixed(4)}`)
    writeFileSync(join(roleDir, `${stem}--loss-curve.jsonl`), result.curve.map((p) => JSON.stringify(p)).join('\n') + '\n')
    void before
    void after

    const { afterAudio, beforeAudio, ...serializable } = result
    results.push({
      ...serializable,
      backend: 'surge',
      relPath: item.relPath,
      category: item.category,
      skippedMacros: skipped,
      figureArchetype: phrase.archetype,
      heldOut: { archetype: held.archetype, before: { features: hbF, hit: hbL.hit, of: hbL.of, gap: hbL.gap }, after: { features: haF, hit: haL.hit, of: haL.of, gap: haL.gap } },
      renderStem: stem,
      wallSeconds: Math.round((Date.now() - t0) / 100) / 10,
    })
  }

  const byRole = {}
  for (const r of results) {
    ;(byRole[r.role] ??= { retargeted: [] }).retargeted.push({
      id: `${r.presetId}-rt`,
      name: r.presetId,
      category: r.category,
      relPath: r.relPath,
      nativeOverrides: Object.entries(r.afterParams).map(([param, value]) => ({ param, value })),
      provenance: {
        from: r.presetId,
        role: r.role,
        lossVersion: r.lossVersion,
        budget: r.budget,
        renders: r.renders,
        seed: r.seed,
        skippedMacros: r.skippedMacros,
        targetsHit: `${r.before.loss.hit}/${r.before.loss.of} -> ${r.after.loss.hit}/${r.after.loss.of}`,
        gap: `${r.before.loss.gap.toFixed(4)} -> ${r.after.loss.gap.toFixed(4)}`,
        heldOutGap: `${r.heldOut.before.gap.toFixed(4)} -> ${r.heldOut.after.gap.toFixed(4)}`,
        moved: r.moved.map((m) => `${m.field} ${m.from}->${m.to}`),
        unreachable: r.unreachable.map((u) => `${u.key} ${u.region} (at ${u.value})`),
      },
    })
  }
  const bank = {
    version: 1,
    generatedAt: new Date().toISOString(),
    note:
      'Surge preset RETARGETING. Each row is a curated factory patch plus a nativeOverrides list ' +
      "(Surge's own parameter units) that moves it toward the role's measured targets. Apply with " +
      'python/surge_render.py\'s nativeOverrides field — NOT the older 0..1 `overrides` path, which ' +
      'reaches only a sliver of each range on this surgepy build. Patch CONTENT stays out of this ' +
      'file: it names patches by relPath, exactly as presets/surge-curated.json does, and the ' +
      'Surge factory-content license question (surge #6741) is unchanged by it.',
    lossVersion: retarget.RETARGET_LOSS_VERSION,
    budget,
    population,
    seed,
    figure: { bpm: BPM, keyRootMidi: KEY.root, minor: KEY.minor, searchSeeds: FIGURE_SEED, heldOutSeeds: HELDOUT_SEED },
    roles: byRole,
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(bank, null, 2) + '\n')
  log(`wrote ${outPath}`)
  writeFileSync(join(renderRoot, 'surge-retarget-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + '\n')
  for (const r of results) log(`  ${r.role}/${r.presetId}: ${r.before.loss.hit}/${r.before.loss.of} -> ${r.after.loss.hit}/${r.after.loss.of} hit, ${r.wallSeconds}s`)
}

main().catch((err) => {
  log(`FATAL: ${err instanceof Error ? (err.stack ?? err.message) : err}`)
  process.exit(1)
})
