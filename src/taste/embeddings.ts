// The TS half of the embedding sidecar (taste-loop T2, docs/taste-loop-design.md L1): spawn
// python/embed.py per audio file, cache the vector NEXT TO the audio as <file>.embedding.json
// (keyed by audio sha256 + backend + model, so a re-render invalidates the cache and a re-run is
// free), and provide the PCA that squeezes a 512-d CLAP vector down to something a
// tiny-personal-dataset model can use (research/107 §1.2's whole premise). The PCA is fit on
// UNLABELED variants — dotbeat can render unlimited audio, so the projection never spends a
// preference label.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { lastNonEmptyLine, resolvePython, spawnSidecar, type SpawnResult } from '../analysis/spawn-sidecar.js'

const EMBED_PY = 'python/embed.py' // relative to the repo root, like every sidecar

/** The raw-vector backends. Both real ones are LEGACY as of research/122 §5 ("Embedding spaces for
 * music, post-CLAP-retirement"): `clap` scored BELOW CHANCE on held-out owner picks and actively
 * misled at n=37, so it was killed at the T1 gate; `mert` was never tried and carries the same
 * caveat (python/embed.py implements run_mert and requirements-mert.txt pins its deps, but no
 * caller anywhere selects it — it is reachable only by hand). They stay selectable so an old run
 * can be reproduced; neither is a default any more (R4-3 / research/130 W0.4). */
export type EmbedBackend = 'stub' | 'clap' | 'mert'
/** Audiobox-Aesthetics axes ride the same sidecar/cache plumbing but are NOT embeddings — four
 * named, crowd-trained axes (CE/CU/PC/PQ) used as explicit features, never PCA-projected. This is
 * the ENDORSED representation (research/122 §5) and hence embedAudioFile's default. */
export type AesBackend = 'aes' | 'aes-stub'
export const AES_AXES = ['CE', 'CU', 'PC', 'PQ'] as const

export class BeatEmbedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatEmbedError'
  }
}

export interface EmbeddingResult {
  backend: string
  model: string
  dims: number
  embedding: number[]
  /** true when this came from <file>.embedding.json rather than a sidecar run */
  cached: boolean
}

/** aes results live in their OWN sidecar file: taste-eval runs an embedding backend AND an aes
 * backend over the same wavs in one pass, and a shared cache file would thrash (each backend's
 * mismatch check would recompute and overwrite the other's entry every run). */
function cachePath(audioPath: string, backend: string): string {
  return backend.startsWith('aes') ? `${audioPath}.aesthetics.json` : `${audioPath}.embedding.json`
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function spawnEmbed(args: readonly string[]): Promise<SpawnResult> {
  return spawnSidecar({ python: resolvePython(), args })
}

/**
 * Embedding for one audio file, cache-first. The cache entry pins the audio's sha256 + backend +
 * model; any mismatch re-runs the sidecar and rewrites it. Throws BeatEmbedError with the
 * sidecar's own fix line on missing deps (exit 3) — callers that can degrade (taste-eval) catch
 * and report rather than abort.
 */
export async function embedAudioFile(audioPath: string, opts: { backend?: EmbedBackend | AesBackend; model?: string } = {}): Promise<EmbeddingResult> {
  if (!existsSync(audioPath)) throw new BeatEmbedError(`no audio file at ${audioPath}`)
  // 'aes', not the retired 'clap' (R4-3): every live caller — gen-bakeoff-metrics, curate-engine-
  // presets, curate-surge-patches, eval.ts's attach* pair, the CLI's taste-collect — already passes
  // a backend explicitly, so this default only governs a bare call, and a bare call should get the
  // endorsed representation rather than a backend measured below chance.
  const backend = opts.backend ?? 'aes'
  const sha = sha256File(audioPath)
  const cp = cachePath(audioPath, backend)
  if (existsSync(cp)) {
    try {
      const cached = JSON.parse(readFileSync(cp, 'utf8')) as { sha256?: string; backend?: string; model?: string; dims?: number; embedding?: number[] }
      if (cached.sha256 === sha && cached.backend === backend && Array.isArray(cached.embedding) && (opts.model === undefined || cached.model === opts.model)) {
        return { backend, model: cached.model ?? '', dims: cached.dims ?? cached.embedding.length, embedding: cached.embedding, cached: true }
      }
    } catch {
      /* unreadable cache — recompute */
    }
  }
  const args = [EMBED_PY, '--backend', backend, '--input', audioPath]
  if (opts.model !== undefined) args.push('--model', opts.model)
  const res = await spawnEmbed(args)
  if (res.enoent) {
    // Name the requirements file for the backend actually asked for — pointing an aes run at
    // requirements-clap.txt (the pre-R4-3 text) installs the retired model and still fails.
    const reqs = backend === 'clap' ? 'requirements-clap.txt' : backend === 'mert' ? 'requirements-mert.txt' : 'requirements-aesthetics.txt'
    throw new BeatEmbedError(`no Python interpreter found for the embedding sidecar (point $BEAT_PYTHON at one, or python3 -m venv python/.venv && python/.venv/bin/pip install -r python/${reqs})`)
  }
  if (res.code !== 0) {
    throw new BeatEmbedError(`embed sidecar (${backend}) failed: ${lastNonEmptyLine(res.stderr) || `exit ${res.code}`}${res.code === 3 ? ' — run `beat taste-eval --doctor` (or use --embed-backend stub)' : ''}`)
  }
  let parsed: { backend?: string; model?: string; dims?: number; embedding?: number[] }
  try {
    parsed = JSON.parse(res.stdout) as typeof parsed
  } catch {
    throw new BeatEmbedError(`embed sidecar produced non-JSON: ${res.stdout.slice(0, 200)}`)
  }
  if (!Array.isArray(parsed.embedding) || parsed.embedding.length === 0) throw new BeatEmbedError('embed sidecar returned no embedding vector')
  writeFileSync(cp, JSON.stringify({ sha256: sha, backend, model: parsed.model ?? '', dims: parsed.embedding.length, embedding: parsed.embedding }) + '\n')
  return { backend, model: parsed.model ?? '', dims: parsed.embedding.length, embedding: parsed.embedding, cached: false }
}

/** The sidecar's --doctor report plus interpreter facts. Never throws. */
export async function embedDoctor(): Promise<Record<string, unknown>> {
  // Not the generic sidecarDoctor: this report deliberately omits the `interpreter` field the other
  // seven carry (it is printed by `beat taste-eval --doctor`, whose JSON shape is asserted).
  const res = await spawnEmbed([EMBED_PY, '--doctor'])
  if (res.enoent) return { pythonFound: false, error: 'no Python interpreter found' }
  if (res.code !== 0) return { pythonFound: true, error: res.stderr.trim() || `--doctor exited ${res.code}` }
  try {
    return { pythonFound: true, ...(JSON.parse(res.stdout) as Record<string, unknown>) }
  } catch {
    return { pythonFound: true, error: 'embed sidecar --doctor produced non-JSON' }
  }
}

// ---- PCA (plain power iteration — dims are small, data is small, no deps) ---------------------

export interface PCAModel {
  mean: number[]
  /** components[k] is the k-th principal axis (unit vector, input dims) */
  components: number[][]
}

/** Fit a k-component PCA on row vectors. Power iteration with deflation — plenty for
 * (hundreds of rows) x (512 dims), and dependency-free. Rows shorter than the first row throw. */
export function fitPCA(rows: number[][], k: number, iterations = 100): PCAModel {
  if (rows.length < 2) throw new BeatEmbedError(`PCA needs at least 2 vectors, got ${rows.length}`)
  const dims = rows[0]!.length
  if (rows.some((r) => r.length !== dims)) throw new BeatEmbedError('PCA input vectors differ in length')
  const mean = new Array<number>(dims).fill(0)
  for (const r of rows) for (let d = 0; d < dims; d++) mean[d] = mean[d]! + r[d]! / rows.length
  const centered = rows.map((r) => r.map((x, d) => x - mean[d]!))
  const components: number[][] = []
  const data = centered.map((r) => [...r])
  const effectiveK = Math.min(k, dims, rows.length - 1)
  let seed = 41
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff - 0.5
  }
  for (let c = 0; c < effectiveK; c++) {
    let v = Array.from({ length: dims }, () => rand())
    for (let it = 0; it < iterations; it++) {
      // v <- X^T X v, normalized
      const scores = data.map((r) => r.reduce((s, x, d) => s + x * v[d]!, 0))
      const next = new Array<number>(dims).fill(0)
      for (let i = 0; i < data.length; i++) for (let d = 0; d < dims; d++) next[d] = next[d]! + scores[i]! * data[i]![d]!
      const norm = Math.sqrt(next.reduce((s, x) => s + x * x, 0))
      if (norm < 1e-12) break
      v = next.map((x) => x / norm)
    }
    components.push(v)
    // deflate
    for (const r of data) {
      const score = r.reduce((s, x, d) => s + x * v[d]!, 0)
      for (let d = 0; d < dims; d++) r[d] = r[d]! - score * v[d]!
    }
  }
  return { mean, components }
}

/** Project one vector through a fitted PCA. */
export function projectPCA(model: PCAModel, vector: number[]): number[] {
  const centered = vector.map((x, d) => x - model.mean[d]!)
  return model.components.map((comp) => centered.reduce((s, x, d) => s + x * comp[d]!, 0))
}
