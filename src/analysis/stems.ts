// Demucs stem isolation for the hosted gen path — the TypeScript half of python/stem_extract.py.
//
// Lyria is a full-track model (Google's own prompt guide leads with genre/era), so a "solo bassline"
// prompt reliably returns a band. Three escalating prompt-side attempts failed (prose isolation,
// the real negative_prompt channel, instrument-first framing — owner rating passes, 2026-07-25), so
// the showdown's gen arm gets its guarantee from EXTRACTION instead: separate the download with
// htdemucs and keep the one stem the role asked for.
//
// Same spawn/exit-code/interpreter scaffold as every other sidecar — ./spawn-sidecar.ts, which as
// of R4-1 is a shared MODULE rather than a shared convention. Like gen.py, the Python side WRITES
// the audio file and prints only metadata.

import { existsSync } from 'node:fs'
import { lastNonEmptyLine, resolvePython, spawnSidecar } from './spawn-sidecar.js'

const STEM_PY = 'python/stem_extract.py' // relative to the repo root; spawned with cwd=repoRoot so
// the sidecar's own `pip install -r python/...` fix line is copy-pasteable where it prints.

/** The four sources htdemucs separates. `other` is where solo synths/keys/guitars land. */
export type StemName = 'bass' | 'other' | 'drums' | 'vocals'
export const STEM_NAMES: StemName[] = ['bass', 'other', 'drums', 'vocals']

export function isStemName(v: unknown): v is StemName {
  return typeof v === 'string' && (STEM_NAMES as string[]).includes(v)
}

export class BeatStemError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatStemError'
  }
}

/** The sidecar's stdout contract (python/stem_extract.py). Levels are dBFS RMS. */
export interface StemExtractResult {
  backend: string
  version: string
  model: string
  device: string
  /** the stem that was ASKED for */
  stem: StemName
  /** the stem actually written — differs from `stem` when the near-silence guard fired */
  stemUsed: StemName
  /** why the guard fired and what it chose instead; null on the normal path */
  fallback: string | null
  outPath: string
  sampleRate: number
  durationSeconds: number
  /** level of the input mix */
  mixRmsDb: number
  /** level of the stem that was kept */
  keptRmsDb: number
  /** level of everything discarded (mix minus kept) — the contamination that used to ship */
  residualRmsDb: number
  stemsRmsDb: Record<string, number>
  silenceMarginDb: number
}

export interface ExtractStemOptions {
  /** the mix to separate (any container soundfile reads; the gen path hands it a WAV) */
  input: string
  stem: StemName
  /** where the extracted stem is written (16-bit PCM WAV at the model's 44.1 kHz) */
  outPath: string
  /** demucs model bag (default htdemucs — the one the taste-dataset ref pipeline used) */
  model?: string
  /** 'auto' (=cpu), 'cpu', 'mps', 'cuda'. cpu is the default because its numerics are stable. */
  device?: string
  /** the near-silence guard's threshold in dB below the mix (default: the sidecar's 25) */
  silenceMarginDb?: number
}

/** The injectable seam gen-fal.ts uses so its tests never spawn Python. */
export type StemExtractor = (opts: ExtractStemOptions) => Promise<StemExtractResult>

/**
 * Resolve the interpreter for the stem sidecar:
 *   1. `$BEAT_STEM_PYTHON` (explicit override),
 *   2. `$BEAT_PYTHON` (the shared sidecar interpreter),
 *   3. `<repo>/python/.venv/bin/python3` (the auto-discovered shared venv — where demucs already
 *      lives, installed for the taste-dataset T3 ref-chop pipeline),
 *   4. `python3` on PATH.
 * Unlike roughness there is NO dedicated venv: demucs shares the venv's torch happily, and adding a
 * second multi-GB torch install to save nothing would be worse than the coupling.
 */
export function resolveStemPython(): string {
  return resolvePython({ envVar: 'BEAT_STEM_PYTHON' })
}

const VENV_HINT =
  'the stem-extract sidecar needs demucs + torch in the shared venv: ' +
  'python/.venv/bin/pip install -r python/requirements-demucs.txt ' +
  '(or point $BEAT_STEM_PYTHON at a demucs-bearing interpreter). See python/README.md.'

/** Validate + shape the sidecar's stdout JSON. Pure, so the parse contract tests without a spawn. */
export function parseStemResult(text: string, label = 'stem-extract sidecar'): StemExtractResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BeatStemError(`${label} produced non-JSON on stdout: ${text.slice(0, 200)}`)
  }
  const o = raw as Partial<StemExtractResult>
  if (!o || !isStemName(o.stem) || !isStemName(o.stemUsed) || typeof o.outPath !== 'string' || typeof o.keptRmsDb !== 'number' || typeof o.mixRmsDb !== 'number') {
    throw new BeatStemError(`${label} returned a malformed result (need stem/stemUsed/outPath/keptRmsDb/mixRmsDb): ${text.slice(0, 200)}`)
  }
  return {
    backend: String(o.backend ?? 'stem-extract'),
    version: String(o.version ?? ''),
    model: String(o.model ?? ''),
    device: String(o.device ?? ''),
    stem: o.stem,
    stemUsed: o.stemUsed,
    fallback: typeof o.fallback === 'string' ? o.fallback : null,
    outPath: o.outPath,
    sampleRate: typeof o.sampleRate === 'number' ? o.sampleRate : 44100,
    durationSeconds: typeof o.durationSeconds === 'number' ? o.durationSeconds : 0,
    mixRmsDb: o.mixRmsDb,
    keptRmsDb: o.keptRmsDb,
    residualRmsDb: typeof o.residualRmsDb === 'number' ? o.residualRmsDb : 0,
    stemsRmsDb: (o.stemsRmsDb && typeof o.stemsRmsDb === 'object' ? o.stemsRmsDb : {}) as Record<string, number>,
    silenceMarginDb: typeof o.silenceMarginDb === 'number' ? o.silenceMarginDb : 25,
  }
}

/**
 * Separate `input` and write its `stem` to `outPath`. Throws BeatStemError on ANY failure — this is
 * deliberately NOT a degrade-and-continue sidecar like roughness: the caller asked for a guaranteed
 * single-instrument clip, and silently shipping the full mix instead would poison a blind eval far
 * more quietly than a loud failure does. The showdown's per-role try/catch turns that into a
 * warn-and-skip for that role, which is the honest outcome.
 */
export const extractStem: StemExtractor = async (opts) => {
  if (!isStemName(opts.stem)) throw new BeatStemError(`stem extraction needs one of ${STEM_NAMES.join('|')}, got "${String(opts.stem)}"`)
  if (!existsSync(opts.input)) throw new BeatStemError(`no audio to separate at ${opts.input}`)
  const python = resolveStemPython()
  const args = [STEM_PY, '--input', opts.input, '--stem', opts.stem, '--output', opts.outPath]
  if (opts.model !== undefined) args.push('--model', opts.model)
  if (opts.device !== undefined) args.push('--device', opts.device)
  if (opts.silenceMarginDb !== undefined) args.push('--silence-margin-db', String(opts.silenceMarginDb))
  const res = await spawnSidecar({ python, args })
  if (res.enoent) throw new BeatStemError(`no Python interpreter found (tried "${python}"). ${VENV_HINT}`)
  if (res.code !== 0) {
    const detail = lastNonEmptyLine(res.stderr) || `exit code ${res.code}`
    if (res.code === 3) throw new BeatStemError(`stem-extract sidecar dependency missing: ${detail} — ${VENV_HINT}`)
    throw new BeatStemError(`stem-extract sidecar (exit ${res.code}): ${detail}`)
  }
  const parsed = parseStemResult(res.stdout, `stem-extract sidecar (${python})`)
  if (!existsSync(opts.outPath)) {
    throw new BeatStemError(`stem-extract reported success but wrote no file at ${opts.outPath}`)
  }
  return parsed
}

/** Doctor fragment: the sidecar's own probe plus the TS-resolved interpreter. Never throws. */
export async function stemDoctor(): Promise<Record<string, unknown>> {
  const python = resolveStemPython()
  // Not the generic sidecarDoctor: this one nests the whole report under `stemExtract` and names
  // its interpreter field `stemInterpreter`, because it is MERGED into gen's doctor output.
  const res = await spawnSidecar({ python, args: [STEM_PY, '--doctor'] })
  if (res.enoent) return { stemExtract: { available: false, error: `no Python interpreter found (tried "${python}"). ${VENV_HINT}` }, stemInterpreter: python }
  if (res.code !== 0) return { stemExtract: { available: false, error: lastNonEmptyLine(res.stderr) || `--doctor exited ${res.code}` }, stemInterpreter: python }
  try {
    return { stemExtract: JSON.parse(res.stdout) as Record<string, unknown>, stemInterpreter: python }
  } catch {
    return { stemExtract: { available: false, error: 'stem-extract --doctor produced non-JSON output', raw: res.stdout.slice(0, 200) }, stemInterpreter: python }
  }
}
