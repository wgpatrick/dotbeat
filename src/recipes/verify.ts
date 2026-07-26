// Verifying a recipe: did the render land where the recipe said it would?
//
// This is the half of the library that makes it evidence rather than lore. A recipe declares exit
// gates as `[lo, hi]` BANDS over metrics the repo already computes; the checker renders (or is
// handed) the feature vectors and reports, per gate, the measured value beside the target.
//
// Three statuses, and the middle one is the important one:
//   pass       — measured value sits inside the band
//   fail       — measured value sits outside it. **This is a FINDING, not a reason to widen the
//                band.** Either the recipe is wrong for our engine, or the engine cannot express
//                what the corpus describes; both are worth more than a green tick (139 §6.2's
//                pre-registered failure reading).
//   pending    — the gate names a metric research 131 §4 measured but `FEATURE_KEYS` does not yet
//                compute (138's B0 upgrade). 139 §4.2 is explicit that these must be REPORTED,
//                never silently passed, and that `verified` status is unreachable while any gate
//                is pending.
//   unmeasured — no render was supplied for this scope (a layer solo that was not rendered).
//
// The anti-Goodhart property is structural: a band cannot be maximized. Nothing here ever ranks;
// metrics may reject and verify, they may never rank the survivors (139 §1.3).

import { featuresForAudioFile, type FeatureVector } from '../metrics/features.js'
import { isComputableGateKey, isPendingGateKey, type GateBand, type Recipe } from './schema.js'

export type GateStatus = 'pass' | 'fail' | 'pending' | 'unmeasured'

export interface GateResult {
  /** '' for the clip-level (summed) gates, else the layer id whose solo render was checked */
  scope: string
  metric: string
  target: GateBand
  measured: number | null
  status: GateStatus
  /** how far outside the band, in the metric's own units (0 when inside) */
  distance: number
  note?: string
}

export interface RecipeCheckReport {
  recipe: string
  version: number
  role: string
  results: readonly GateResult[]
  counts: Record<GateStatus, number>
  /** 'pass' only when every gate is computable AND in band — the bar for `verified` */
  verdict: 'pass' | 'fail' | 'incomplete'
  /** the receipt to store in provenance.verifyReceipt on a pass */
  receipt: Record<string, number> | null
}

/** The feature vectors a check runs against: the summed clip, plus any per-layer solo renders. */
export interface RecipeFeatureSet {
  clip: FeatureVector | null
  layers?: Record<string, FeatureVector | null | undefined>
}

function checkOne(scope: string, metric: string, target: GateBand, features: FeatureVector | null | undefined): GateResult {
  if (isPendingGateKey(metric)) {
    return {
      scope,
      metric,
      target,
      measured: null,
      status: 'pending',
      distance: 0,
      note: 'research 131 §4 measured this discriminator; FEATURE_KEYS does not compute it yet (138 B0)',
    }
  }
  if (!isComputableGateKey(metric)) {
    // parseRecipeLibrary rejects unknown keys, so this is unreachable from a loaded library; kept
    // so a hand-built Recipe object in a test still gets an honest answer rather than a crash.
    return { scope, metric, target, measured: null, status: 'pending', distance: 0, note: 'unknown metric' }
  }
  if (!features) return { scope, metric, target, measured: null, status: 'unmeasured', distance: 0, note: scope === '' ? 'no clip render supplied' : `no solo render supplied for layer "${scope}"` }
  const measured = features[metric]
  const inBand = measured >= target[0] && measured <= target[1]
  const distance = inBand ? 0 : measured < target[0] ? target[0] - measured : measured - target[1]
  return { scope, metric, target, measured, status: inBand ? 'pass' : 'fail', distance }
}

/** Check every gate a recipe declares — clip-level first, then each layer's own. */
export function checkRecipeGates(recipe: Recipe, features: RecipeFeatureSet): RecipeCheckReport {
  const results: GateResult[] = []
  for (const metric of Object.keys(recipe.gates).sort()) results.push(checkOne('', metric, recipe.gates[metric]!, features.clip))
  for (const layer of recipe.layers) {
    if (!layer.gates) continue
    for (const metric of Object.keys(layer.gates).sort()) results.push(checkOne(layer.id, metric, layer.gates[metric]!, features.layers?.[layer.id]))
  }
  const counts: Record<GateStatus, number> = { pass: 0, fail: 0, pending: 0, unmeasured: 0 }
  for (const r of results) counts[r.status] += 1
  const verdict = counts.fail > 0 ? 'fail' : counts.pending > 0 || counts.unmeasured > 0 ? 'incomplete' : 'pass'
  const receipt =
    verdict === 'pass' && features.clip
      ? Object.fromEntries(Object.keys(recipe.gates).sort().map((m) => [m, features.clip![m as keyof FeatureVector]]))
      : null
  return { recipe: recipe.name, version: recipe.version, role: recipe.role, results, counts, verdict, receipt }
}

/** Convenience wrapper for the CLI: read the wavs off disk, then check.
 * `layerWavs` maps a layer id to its solo render; absent layers report `unmeasured`. */
export function checkRecipeRenders(recipe: Recipe, clipWav: string | null, layerWavs: Record<string, string> = {}): RecipeCheckReport {
  const layers: Record<string, FeatureVector | null> = {}
  for (const [id, path] of Object.entries(layerWavs)) layers[id] = featuresForAudioFile(path)
  return checkRecipeGates(recipe, { clip: clipWav ? featuresForAudioFile(clipWav) : null, layers })
}

const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const num = (x: number): string => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2))

const MARK: Record<GateStatus, string> = { pass: 'PASS', fail: 'FAIL', pending: 'PEND', unmeasured: '  - ' }

/** One human-readable table: measured value beside the target, per gate. */
export function formatGateReport(report: RecipeCheckReport): string {
  const lines: string[] = []
  lines.push(`${report.recipe} v${report.version} (${report.role}) — ${report.verdict.toUpperCase()}`)
  lines.push(`  ${report.counts.pass} pass · ${report.counts.fail} fail · ${report.counts.pending} pending · ${report.counts.unmeasured} unmeasured`)
  lines.push('')
  const width = Math.max(...report.results.map((r) => (r.scope ? `${r.scope}.${r.metric}` : r.metric).length), 10)
  for (const r of report.results) {
    const label = r.scope ? `${r.scope}.${r.metric}` : r.metric
    const target = `[${num(r.target[0])}, ${num(r.target[1])}]`
    const measured = r.measured === null ? '—' : num(r.measured)
    const off = r.status === 'fail' ? `  off by ${num(r.distance)}` : ''
    const note = r.note ? `  (${r.note})` : ''
    lines.push(`  ${MARK[r.status]}  ${pad(label, width)}  target ${pad(target, 18)} measured ${pad(measured, 9)}${off}${note}`)
  }
  if (report.counts.fail > 0) {
    lines.push('')
    lines.push('  A failing gate is a FINDING, not a reason to widen the band: either this recipe is')
    lines.push('  wrong for our engine, or the engine cannot express what the corpus describes.')
  }
  return lines.join('\n') + '\n'
}
