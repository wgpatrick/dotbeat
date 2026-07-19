// CMA-ES — Covariance Matrix Adaptation Evolution Strategy, dependency-free TS.
//
// The optimizer behind `beat match` (taste-loop T6, docs/taste-loop-design.md "sound matching"):
// research/107 Part 2's practical recipe is CMA-ES over the synth's continuous params, population
// ~24 rendered in parallel, on a composite spectral loss — the method INSTRUMENTAL
// (arXiv:2603.15905) proved out on a 28-param subtractive synth (CMA-ES beats Adam there; Adam
// traps in the spectral loss's local minima).
//
// This is the standard (mu/mu_w, lambda) algorithm from Hansen's tutorial (arXiv:1604.00772):
// cumulative step-size adaptation (CSA), rank-one + rank-mu covariance update, eigendecomposition
// each generation (dimensions here are <= ~30, so a per-generation Jacobi decomposition is cheap
// next to even one audio render). Deterministic under a seed. Box constraints are handled by
// projection (clamp the sampled point, evaluate and update with the clamped point) — the simple
// repair strategy; INSTRUMENTAL's dimensionality warning (optimizers exploit extremes past ~30
// dims) is handled one level up by keeping the search spaces small and the ranges musical
// (src/match/space.ts).

export interface CmaEsOptions {
  /** lambda — candidates per generation. Default 4 + floor(3 ln n). */
  populationSize?: number
  /** RNG seed (mulberry32). Same seed + same losses => identical trajectory. */
  seed?: number
  /** Per-dimension box bounds; sampled points are clamped into them before evaluation. */
  lowerBounds?: number[]
  upperBounds?: number[]
}

export interface CmaEsBest {
  x: number[]
  value: number
  /** 1-based evaluation index at which this best was found. */
  evals: number
}

/** Deterministic uniform RNG (mulberry32) + a Box-Muller gaussian on top. */
export class SeededRandom {
  private state: number
  private spare: number | null = null
  constructor(seed: number) {
    this.state = seed >>> 0
  }
  uniform(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  gaussian(): number {
    if (this.spare !== null) {
      const v = this.spare
      this.spare = null
      return v
    }
    let u = 0
    let v = 0
    while (u <= 1e-12) u = this.uniform()
    v = this.uniform()
    const mag = Math.sqrt(-2 * Math.log(u))
    this.spare = mag * Math.sin(2 * Math.PI * v)
    return mag * Math.cos(2 * Math.PI * v)
  }
}

/** Jacobi eigendecomposition of a symmetric matrix. Returns eigenvalues and column eigenvectors
 * (V[i][k] = component i of eigenvector k). Plenty for n <= ~40. */
export function jacobiEigen(matrix: number[][]): { values: number[]; vectors: number[][] } {
  const n = matrix.length
  const a = matrix.map((row) => [...row])
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p]![q]! * a[p]![q]!
    if (off < 1e-24) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p]![q]!
        if (Math.abs(apq) < 1e-18) continue
        const app = a[p]![p]!
        const aqq = a[q]![q]!
        const theta = (aqq - app) / (2 * apq)
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!
          const akq = a[k]![q]!
          a[k]![p] = c * akp - s * akq
          a[k]![q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!
          const aqk = a[q]![k]!
          a[p]![k] = c * apk - s * aqk
          a[q]![k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k]![p]!
          const vkq = v[k]![q]!
          v[k]![p] = c * vkp - s * vkq
          v[k]![q] = s * vkp + c * vkq
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]!), vectors: v }
}

export class CmaEs {
  readonly n: number
  readonly lambda: number
  private readonly mu: number
  private readonly weights: number[]
  private readonly muEff: number
  private readonly cc: number
  private readonly cs: number
  private readonly c1: number
  private readonly cmu: number
  private readonly damps: number
  private readonly chiN: number

  private mean: number[]
  private sigma: number
  private C: number[][]
  private pc: number[]
  private ps: number[]
  private B: number[][] // column eigenvectors
  private D: number[] // sqrt eigenvalues
  private readonly rng: SeededRandom
  private readonly lo: number[] | null
  private readonly hi: number[] | null
  private generationCount = 0
  private evalCount = 0
  private bestSoFar: CmaEsBest | null = null
  /** z/y vectors of the last ask(), needed by tell()'s updates. */
  private pending: { x: number[]; y: number[] }[] = []

  constructor(x0: number[], sigma0: number, opts: CmaEsOptions = {}) {
    const n = x0.length
    if (n < 1) throw new Error('CmaEs needs at least 1 dimension')
    if (!(sigma0 > 0)) throw new Error('CmaEs needs sigma0 > 0')
    this.n = n
    this.lambda = Math.max(2, opts.populationSize ?? 4 + Math.floor(3 * Math.log(n)))
    this.mu = Math.floor(this.lambda / 2)
    const rawWeights = Array.from({ length: this.mu }, (_, i) => Math.log(this.mu + 0.5) - Math.log(i + 1))
    const wSum = rawWeights.reduce((a, b) => a + b, 0)
    this.weights = rawWeights.map((w) => w / wSum)
    this.muEff = 1 / this.weights.reduce((a, w) => a + w * w, 0)
    this.cc = (4 + this.muEff / n) / (n + 4 + (2 * this.muEff) / n)
    this.cs = (this.muEff + 2) / (n + this.muEff + 5)
    this.c1 = 2 / ((n + 1.3) ** 2 + this.muEff)
    this.cmu = Math.min(1 - this.c1, (2 * (this.muEff - 2 + 1 / this.muEff)) / ((n + 2) ** 2 + this.muEff))
    this.damps = 1 + 2 * Math.max(0, Math.sqrt((this.muEff - 1) / (n + 1)) - 1) + this.cs
    this.chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n))

    this.mean = [...x0]
    this.sigma = sigma0
    this.C = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
    this.pc = new Array<number>(n).fill(0)
    this.ps = new Array<number>(n).fill(0)
    this.B = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
    this.D = new Array<number>(n).fill(1)
    this.rng = new SeededRandom(opts.seed ?? 41)
    this.lo = opts.lowerBounds ? [...opts.lowerBounds] : null
    this.hi = opts.upperBounds ? [...opts.upperBounds] : null
    if (this.lo && this.lo.length !== n) throw new Error('lowerBounds length mismatch')
    if (this.hi && this.hi.length !== n) throw new Error('upperBounds length mismatch')
  }

  get generation(): number {
    return this.generationCount
  }
  get evaluations(): number {
    return this.evalCount
  }
  get best(): CmaEsBest | null {
    return this.bestSoFar
  }
  get stepSize(): number {
    return this.sigma
  }

  private clamp(x: number[]): number[] {
    if (!this.lo && !this.hi) return x
    return x.map((v, i) => {
      let out = v
      if (this.lo) out = Math.max(this.lo[i]!, out)
      if (this.hi) out = Math.min(this.hi[i]!, out)
      return out
    })
  }

  /** Sample lambda candidates. Points are clamped into the box bounds; the clamped point is what
   * the caller must evaluate and pass back to tell() (repair-and-rate). */
  ask(): number[][] {
    this.pending = []
    const out: number[][] = []
    for (let k = 0; k < this.lambda; k++) {
      const z = Array.from({ length: this.n }, () => this.rng.gaussian())
      // y = B * (D .* z)
      const y = new Array<number>(this.n).fill(0)
      for (let i = 0; i < this.n; i++) {
        let sum = 0
        for (let j = 0; j < this.n; j++) sum += this.B[i]![j]! * this.D[j]! * z[j]!
        y[i] = sum
      }
      const x = this.clamp(this.mean.map((m, i) => m + this.sigma * y[i]!))
      // Recompute y from the clamped x so the distribution update is consistent with what was
      // actually evaluated (projection repair).
      const yRepaired = x.map((xi, i) => (xi - this.mean[i]!) / this.sigma)
      this.pending.push({ x, y: yRepaired })
      out.push([...x])
    }
    return out
  }

  /** Rank the evaluated points (lower value = better) and update mean, paths, sigma, C. `points`
   * must be the exact arrays returned by the matching ask() (order preserved). */
  tell(points: number[][], values: number[]): void {
    if (points.length !== this.pending.length || values.length !== points.length) {
      throw new Error(`tell() needs the ${this.pending.length} points of the last ask() with one value each`)
    }
    this.evalCount += points.length
    const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
    const bestOfGen = order[0]!
    if (this.bestSoFar === null || bestOfGen.v < this.bestSoFar.value) {
      this.bestSoFar = { x: [...points[bestOfGen.i]!], value: bestOfGen.v, evals: this.evalCount - points.length + 1 }
    }

    // Weighted mean of the mu best y-vectors (equivalently: new mean in x-space).
    const yw = new Array<number>(this.n).fill(0)
    for (let r = 0; r < this.mu; r++) {
      const y = this.pending[order[r]!.i]!.y
      for (let i = 0; i < this.n; i++) yw[i] = yw[i]! + this.weights[r]! * y[i]!
    }
    this.mean = this.mean.map((m, i) => m + this.sigma * yw[i]!)

    // ps update needs C^(-1/2) * yw = B * diag(1/D) * B^T * yw.
    const btYw = new Array<number>(this.n).fill(0)
    for (let j = 0; j < this.n; j++) {
      let sum = 0
      for (let i = 0; i < this.n; i++) sum += this.B[i]![j]! * yw[i]!
      btYw[j] = sum / Math.max(this.D[j]!, 1e-20)
    }
    const cInvHalfYw = new Array<number>(this.n).fill(0)
    for (let i = 0; i < this.n; i++) {
      let sum = 0
      for (let j = 0; j < this.n; j++) sum += this.B[i]![j]! * btYw[j]!
      cInvHalfYw[i] = sum
    }
    const csFactor = Math.sqrt(this.cs * (2 - this.cs) * this.muEff)
    this.ps = this.ps.map((p, i) => (1 - this.cs) * p + csFactor * cInvHalfYw[i]!)
    const psNorm = Math.sqrt(this.ps.reduce((a, p) => a + p * p, 0))
    const hsig =
      psNorm / Math.sqrt(1 - Math.pow(1 - this.cs, 2 * (this.generationCount + 1))) / this.chiN < 1.4 + 2 / (this.n + 1)
        ? 1
        : 0
    const ccFactor = Math.sqrt(this.cc * (2 - this.cc) * this.muEff)
    this.pc = this.pc.map((p, i) => (1 - this.cc) * p + hsig * ccFactor * yw[i]!)

    // Covariance: rank-one (pc) + rank-mu (weighted best y outer products).
    const c1a = this.c1 * (1 - (1 - hsig * hsig) * this.cc * (2 - this.cc))
    for (let i = 0; i < this.n; i++) {
      for (let j = 0; j < this.n; j++) {
        let rankMu = 0
        for (let r = 0; r < this.mu; r++) {
          const y = this.pending[order[r]!.i]!.y
          rankMu += this.weights[r]! * y[i]! * y[j]!
        }
        this.C[i]![j] =
          (1 - c1a - this.cmu) * this.C[i]![j]! + this.c1 * this.pc[i]! * this.pc[j]! + this.cmu * rankMu
      }
    }

    // Step size (CSA).
    this.sigma = this.sigma * Math.exp((this.cs / this.damps) * (psNorm / this.chiN - 1))
    if (!Number.isFinite(this.sigma) || this.sigma > 1e6) this.sigma = 1e6
    if (this.sigma < 1e-12) this.sigma = 1e-12

    // Refresh the eigendecomposition (symmetrize first — numeric drift).
    for (let i = 0; i < this.n; i++) {
      for (let j = i + 1; j < this.n; j++) {
        const avg = (this.C[i]![j]! + this.C[j]![i]!) / 2
        this.C[i]![j] = avg
        this.C[j]![i] = avg
      }
    }
    const eig = jacobiEigen(this.C)
    this.D = eig.values.map((v) => Math.sqrt(Math.max(v, 1e-20)))
    this.B = eig.vectors
    this.generationCount++
    this.pending = []
  }
}

/** Convenience driver: minimize f under an evaluation budget. Used by the harness's staged runs
 * and directly by the unit tests. Sequential; the harness calls ask/tell itself when it wants to
 * batch renders. */
export function minimize(
  f: (x: number[]) => number,
  x0: number[],
  sigma0: number,
  opts: CmaEsOptions & { maxEvaluations: number },
): CmaEsBest {
  const es = new CmaEs(x0, sigma0, opts)
  while (es.evaluations + es.lambda <= opts.maxEvaluations) {
    const points = es.ask()
    es.tell(points, points.map(f))
  }
  // Spend any remainder smaller than one full generation on nothing — a partial generation would
  // bias tell()'s ranking. The budget contract is "at most maxEvaluations".
  if (es.best === null) {
    const x = x0.slice()
    return { x, value: f(x), evals: 1 }
  }
  return es.best
}
