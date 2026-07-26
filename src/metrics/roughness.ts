// Pair-relative "grind" ear (research 123). The Daniel-Weber time-varying roughness curve (computed
// by python/roughness.py via MoSQITo) is the ONLY measured signal that tracks the owner's "grindy"
// complaint — but the benchmark proved it has NO valid absolute threshold: commercial material
// out-roughs the flagged defect (a bass loop scored 3.71 asper vs the 2.09 fail). So this is a
// PAIR-RELATIVE regression detector only: given a baseline render and a candidate render of the SAME
// material, it flags 3-second bins where the candidate got measurably rougher. There is no absolute
// gate, by design — feeding it unmatched material would be meaningless (research 123 §5, N1).
//
// The comparison itself is a pure function of two sidecar results (roughnessFindings) so it tests
// with stubbed data; roughnessCompare wires in the actual sidecar spawn.

import { existsSync } from 'node:fs'
import { lastNonEmptyLine, resolvePython, sidecarDoctor as runSidecarDoctor, spawnSidecar } from '../analysis/spawn-sidecar.js'
import type { PathologyFinding } from './screens.js'

const ROUGHNESS_PY = 'python/roughness.py' // relative to the repo root (kept relative so the
// sidecar's own `pip install -r python/...` fix line is meaningful); spawned with cwd=repoRoot.

// research 123 §5 thresholds — a bin flags only when BOTH clear (a small % rise on a near-zero bin
// is noise; a small absolute rise on a loud bin is a level wobble). Bin-level application of the
// mean-level rule the doc adopted.
export const ROUGHNESS_RISE_PCT = 0.15 // candidate >= baseline x1.15
export const ROUGHNESS_RISE_ABS = 0.2 // AND candidate >= baseline + 0.2 asper

export class BeatRoughnessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatRoughnessError'
  }
}

/** One 3-second bin of the DW roughness curve. */
export interface RoughnessBin {
  index: number
  start: number // seconds
  end: number // seconds
  roughness: number // asper
}

/** The sidecar's parsed result — the time-varying roughness curve, binned, plus overall summaries. */
export interface RoughnessResult {
  backend: string
  version: string
  model: string
  binSeconds: number
  sampleRate: number
  durationSeconds: number
  mean: number
  p95: number
  bins: RoughnessBin[]
}

/**
 * Resolve the Python interpreter for the roughness sidecar, in priority order:
 *   1. `$BEAT_ROUGHNESS_PYTHON` (explicit override — the dedicated venv),
 *   2. `<repo>/python/venv-roughness/bin/python3` (the dedicated venv, if built),
 *   3. `$BEAT_PYTHON` (the shared sidecar interpreter),
 *   4. `<repo>/python/.venv/bin/python3` (the shared auto-discovered venv),
 *   5. `python3` on PATH.
 * MoSQITo can conflict with the shared venv's pins, so a dedicated venv-roughness is checked first
 * (documented in python/README.md); the chain still falls back to the shared venv when it isn't.
 */
export function resolveRoughnessPython(): string {
  return resolvePython({ envVar: 'BEAT_ROUGHNESS_PYTHON', dedicatedVenv: 'venv-roughness' })
}

const VENV_HINT =
  'the roughness sidecar needs MoSQITo. Build the dedicated venv: ' +
  'python3.10 -m venv python/venv-roughness && python/venv-roughness/bin/pip install -r python/requirements-roughness.txt ' +
  '(or point $BEAT_ROUGHNESS_PYTHON at a MoSQITo-bearing interpreter). See python/README.md.'

/** Validate + shape the sidecar's stdout JSON into a RoughnessResult. */
export function parseRoughnessResult(text: string, label = 'roughness sidecar'): RoughnessResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BeatRoughnessError(`${label} produced non-JSON on stdout: ${text.slice(0, 200)}`)
  }
  const o = raw as Partial<RoughnessResult>
  if (
    !o ||
    typeof o.mean !== 'number' ||
    typeof o.p95 !== 'number' ||
    typeof o.binSeconds !== 'number' ||
    !Array.isArray(o.bins)
  ) {
    throw new BeatRoughnessError(`${label} returned a malformed result (missing mean/p95/binSeconds/bins)`)
  }
  const bins: RoughnessBin[] = o.bins.map((b, i) => {
    const bin = b as Partial<RoughnessBin>
    if (typeof bin.roughness !== 'number' || typeof bin.start !== 'number' || typeof bin.end !== 'number') {
      throw new BeatRoughnessError(`${label} bin ${i} is malformed`)
    }
    return { index: typeof bin.index === 'number' ? bin.index : i, start: bin.start, end: bin.end, roughness: bin.roughness }
  })
  return {
    backend: String(o.backend ?? 'roughness'),
    version: String(o.version ?? ''),
    model: String(o.model ?? ''),
    binSeconds: o.binSeconds,
    sampleRate: typeof o.sampleRate === 'number' ? o.sampleRate : 0,
    durationSeconds: typeof o.durationSeconds === 'number' ? o.durationSeconds : 0,
    mean: o.mean,
    p95: o.p95,
    bins,
  }
}

/** Run the roughness sidecar over one WAV. Throws BeatRoughnessError on any failure (the CLI catches
 * it and DEGRADES — roughness is advisory, a missing sidecar must never break a lint run). */
export async function runRoughness(wavPath: string, opts: { binSeconds?: number } = {}): Promise<RoughnessResult> {
  if (!existsSync(wavPath)) throw new BeatRoughnessError(`audio file not found: ${wavPath}`)
  const python = resolveRoughnessPython()
  const args = [ROUGHNESS_PY, '--input', wavPath]
  if (opts.binSeconds !== undefined) args.push('--bin-seconds', String(opts.binSeconds))
  const res = await spawnSidecar({ python, args })
  if (res.enoent) throw new BeatRoughnessError(`no Python interpreter found (tried "${python}"). ${VENV_HINT}`)
  if (res.code !== 0) {
    const detail = lastNonEmptyLine(res.stderr) || `exit code ${res.code}`
    if (res.code === 3) throw new BeatRoughnessError(`roughness sidecar dependency missing: ${detail} — ${VENV_HINT}`)
    throw new BeatRoughnessError(`roughness sidecar (exit ${res.code}): ${detail}`)
  }
  return parseRoughnessResult(res.stdout, `roughness sidecar (${python})`)
}

/** severity by how far past the flag line the rise sits (research 123 §5: sev 3 at +25%, sev 4-5
 * beyond +50%). Below +25% but past the +15% flag line is a mild sev 2. */
function severityForRise(risePct: number): number {
  if (risePct >= 0.75) return 5
  if (risePct >= 0.5) return 4
  if (risePct >= 0.25) return 3
  return 2
}

/**
 * The pair-relative comparison, as a PURE function of two already-computed sidecar results (so it
 * tests with stubbed data). Bins are matched by index — the caller guarantees the same material, so
 * the same 3s grid. A bin flags when the candidate is rougher than the baseline by BOTH >= +15% and
 * >= +0.2 asper (research 123 §5). Findings are the shared pathology-screen shape, source
 * 'roughness-dw'; `measured` is the candidate's asper, `threshold` the effective bar it cleared.
 */
export function roughnessFindings(baseline: RoughnessResult, candidate: RoughnessResult): PathologyFinding[] {
  const out: PathologyFinding[] = []
  const n = Math.min(baseline.bins.length, candidate.bins.length)
  for (let i = 0; i < n; i++) {
    const base = baseline.bins[i]!
    const cand = candidate.bins[i]!
    const riseAbs = cand.roughness - base.roughness
    const risePct = base.roughness > 0 ? riseAbs / base.roughness : riseAbs > 0 ? Infinity : 0
    if (risePct >= ROUGHNESS_RISE_PCT && riseAbs >= ROUGHNESS_RISE_ABS) {
      // the effective bar the candidate cleared (whichever of the two conditions bound higher)
      const bar = Math.max(base.roughness * (1 + ROUGHNESS_RISE_PCT), base.roughness + ROUGHNESS_RISE_ABS)
      const pctLabel = Number.isFinite(risePct) ? `${(risePct * 100).toFixed(0)}%` : 'from ~0'
      out.push({
        kind: 'roughness-rise',
        severity: severityForRise(risePct),
        source: 'roughness-dw',
        detail:
          `roughness rose to ${cand.roughness.toFixed(2)} asper vs the baseline's ${base.roughness.toFixed(2)} ` +
          `(+${riseAbs.toFixed(2)}, ${pctLabel}) over ${cand.start.toFixed(0)}–${cand.end.toFixed(0)}s — the candidate ` +
          `render got measurably grindier here than the baseline of the same material. Check for added ` +
          `saturation/distortion or a hotter sub on the bass in this section.`,
        start: cand.start,
        end: cand.end,
        band: 'full-band',
        measured: cand.roughness,
        threshold: bar,
      })
    }
  }
  return out
}

/** Run the sidecar on both renders and return the pair-relative findings. `candidate` is the render
 * under test; `baseline` is a matched render of the same material (a prior patch/produce pass). */
export async function roughnessCompare(baselineWav: string, candidateWav: string, opts: { binSeconds?: number } = {}): Promise<{
  findings: PathologyFinding[]
  baseline: RoughnessResult
  candidate: RoughnessResult
}> {
  const [baseline, candidate] = await Promise.all([runRoughness(baselineWav, opts), runRoughness(candidateWav, opts)])
  return { findings: roughnessFindings(baseline, candidate), baseline, candidate }
}

/** Doctor: is the roughness sidecar runnable here? Never throws — mirrors sidecarDoctor. */
export async function roughnessDoctor(): Promise<Record<string, unknown>> {
  return runSidecarDoctor(ROUGHNESS_PY, {
    python: resolveRoughnessPython(),
    hint: VENV_HINT,
    failure: { available: false },
  })
}
