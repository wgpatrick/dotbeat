// The `beat match` harness (taste-loop T6): CMA-ES over the engine's continuous params against a
// target chop, staged per research/107 §2.3 — discrete osc/filter combos enumerated as short
// screening runs, then source params, then insert effects on the frozen winner. The render is the
// slow step, so evaluations are cached by candidate-text hash (persisted, so a re-run with a
// bigger budget resumes free) and the budget counts RENDERS, not cache hits.
//
// The harness is engine-agnostic by injection: it asks a MatchSessionFactory for a renderer
// rooted in the candidate project dir. The CLI (cli/match.mjs) supplies the real offline engine
// session (one headless-Chromium boot for the WHOLE run — the same hot-swap mechanism
// `render --batch` uses per batch); tests supply a pure-TS synthesizer, which is how the search
// loop is exercised end-to-end in CI without a browser.

import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { decodeWav } from '../metrics/wav.js'
import { analyze } from '../metrics/analyze.js'
import { detectPitch, type PitchDetection } from '../analysis/pitch.js'
import { integratedLoudness } from '../metrics/loudness.js'
import { CmaEs } from './cmaes.js'
import { prepareTarget, matchLoss, cosineSimilarity, type MatchLossDetail, type PreparedTarget } from './loss.js'
import {
  buildMatchSpace,
  buildBaseDoc,
  buildCandidateDoc,
  initGenome,
  applySpectralInit,
  sha256Text,
  type BaseDoc,
  type DiscreteChoice,
  type MatchParamDef,
  type MatchSpace,
  type MatchTrackKind,
} from './space.js'

/** Bump when the loss definition changes — invalidates every cached evaluation. */
export const MATCH_LOSS_VERSION = 1

export class BeatMatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatMatchError'
  }
}

export interface MatchRenderSession {
  /** Render `beatText` (a complete candidate project) for `seconds`; resolve to WAV bytes. */
  render(beatText: string, seconds: number): Promise<Uint8Array>
  close(): Promise<void>
}
export type MatchSessionFactory = (projectDir: string, initialText: string) => Promise<MatchRenderSession>

export interface RunMatchOptions {
  targetWavPath: string
  outDir: string
  sessionFactory: MatchSessionFactory
  trackKind?: MatchTrackKind
  /** Total RENDER budget across all stages (cache hits are free). Default 50 — a smoke-scale
   * budget; real runs are owner-side at 2000-5000 (docs/t6-sound-matching.md). */
  budget?: number
  /** CMA-ES population per generation (renders per generation). */
  population?: number
  seed?: number
  log?: (line: string) => void
  /** Attempt the CLAP-cosine report line via the embedding sidecar (never required — degrades to
   * a named reason when python/torch are absent). Default true. */
  clap?: boolean
}

export interface LossCurvePoint {
  /** 1-based evaluation index (renders + cache hits — what the budget counts). */
  eval: number
  /** renders spent so far when this point was recorded. */
  render: number
  stage: string
  label: string
  loss: number
  best: number
  /** present (true) when this evaluation came from the eval cache instead of a render. */
  cached?: boolean
}

export interface MatchReport {
  target: {
    path: string
    sha256: string
    durationSeconds: number
    lufs: number | null
    pitch: { midi: number; note: string | null; hz: number | null; confidence: string; frozenMidi: number } | null
  }
  trackKind: MatchTrackKind
  budget: number
  population: number
  seed: number
  renders: number
  cacheHits: number
  stages: { name: string; renders: number; bestLoss: number | null; note?: string }[]
  best: {
    stage: string
    discrete: string
    loss: MatchLossDetail
    edits: { path: string; value: string }[]
  }
  /** The headline ceiling metrics (research/107 §2.2's human-validated pair). */
  ceiling: {
    mfccDistance: number
    clapCosine: number | null
    clapBackend: string | null
    clapNote: string | null
  }
  elapsedSeconds: number
}

export interface MatchResult {
  report: MatchReport
  bestText: string
  bestWavPath: string
  bestBeatPath: string
  patchPath: string
  lossCurvePath: string
  reportPath: string
  lossCurve: LossCurvePoint[]
}

interface CacheEntry {
  key: string
  loss: MatchLossDetail
}

interface EvalOutcome {
  loss: MatchLossDetail
  text: string
  edits: { path: string; value: string }[]
  cached: boolean
}

class Evaluator {
  renders = 0
  cacheHits = 0
  /** renders + cacheHits — what the budget counts, so the search trajectory is a pure function
   * of (target, seed, budget) and a re-run over a warm cache replays the same trajectory for
   * free instead of wandering somewhere new. */
  evals = 0
  readonly curve: LossCurvePoint[] = []
  private best: { loss: MatchLossDetail; text: string; edits: { path: string; value: string }[]; wav: Uint8Array | null; stage: string; discrete: string } | null = null
  private readonly cache = new Map<string, MatchLossDetail>()
  private readonly cachePath: string

  constructor(
    private readonly target: PreparedTarget,
    private readonly targetSha: string,
    private readonly session: MatchRenderSession,
    private readonly base: BaseDoc,
    private readonly budget: number,
    private readonly curvePath: string,
    private readonly log: (line: string) => void,
  ) {
    this.cachePath = join(resolve(curvePath, '..'), 'eval-cache.jsonl')
    if (existsSync(this.cachePath)) {
      for (const line of readFileSync(this.cachePath, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          const e = JSON.parse(line) as CacheEntry
          this.cache.set(e.key, e.loss)
        } catch {
          /* corrupt line — recompute */
        }
      }
    }
  }

  get budgetLeft(): number {
    return this.budget - this.evals
  }

  get bestSoFar() {
    return this.best
  }

  private key(text: string): string {
    return createHash('sha256').update(`${MATCH_LOSS_VERSION}:${this.targetSha}:${sha256Text(text)}`).digest('hex')
  }

  async evaluate(
    space: MatchSpace,
    discrete: DiscreteChoice,
    defs: MatchParamDef[],
    genome: number[],
    frozenEdits: { path: string; value: string }[],
    stage: string,
    frozenGate: number | null = null,
  ): Promise<EvalOutcome> {
    const { text, edits } = buildCandidateDoc(this.base, space, discrete, defs, genome, frozenEdits, frozenGate)
    const key = this.key(text)
    const cachedLoss = this.cache.get(key)
    let loss: MatchLossDetail
    let wav: Uint8Array | null = null
    let cached = false
    if (this.budgetLeft <= 0) throw new BeatMatchError('budget exhausted mid-generation (internal accounting bug)')
    this.evals++
    if (cachedLoss !== undefined) {
      loss = cachedLoss
      cached = true
      this.cacheHits++
    } else {
      wav = await this.session.render(text, this.base.renderSeconds)
      this.renders++
      const decoded = decodeWav(wav)
      loss = matchLoss(this.target, decoded.channels, decoded.sampleRate)
      this.cache.set(key, loss)
      appendFileSync(this.cachePath, JSON.stringify({ key, loss } satisfies CacheEntry) + '\n')
    }
    if (this.best === null || loss.total < this.best.loss.total) {
      this.best = { loss, text, edits, wav, stage, discrete: discrete.label }
      this.log(`  [${stage}] render ${this.renders}: new best loss ${loss.total.toFixed(4)} (${discrete.label})`)
    } else if (this.best.wav === null && this.best.text === text && wav !== null) {
      this.best.wav = wav // best came from cache earlier; keep bytes when we happen to render it
    }
    const point: LossCurvePoint = {
      eval: this.evals,
      render: this.renders,
      stage,
      label: discrete.label,
      loss: round4(loss.total),
      best: round4(this.best.loss.total),
      ...(cached ? { cached: true } : {}),
    }
    this.curve.push(point)
    appendFileSync(this.curvePath, JSON.stringify(point) + '\n')
    return { loss, text, edits, cached }
  }
}

const round4 = (x: number) => Math.round(x * 10000) / 10000

/** Frozen-pitch decision: the detected f0's MIDI, else middle-of-the-road C3 (48). Rounded to the
 * nearest semitone — the engine plays equal temperament and the loss must not chase pitch. */
export function freezeMidi(pitch: PitchDetection): number {
  if (pitch.midi !== null && Number.isFinite(pitch.midi)) {
    return Math.min(96, Math.max(24, Math.round(pitch.midi)))
  }
  return 48
}

export async function runMatch(opts: RunMatchOptions): Promise<MatchResult> {
  const t0 = Date.now()
  const log = opts.log ?? (() => {})
  const trackKind = opts.trackKind ?? 'synth'
  const budget = opts.budget ?? 50
  const population = opts.population ?? 24
  const seed = opts.seed ?? 41
  if (budget < 20) throw new BeatMatchError(`budget ${budget} is too small to search anything (need >= 20)`)

  // ---- target ---------------------------------------------------------------------------------
  if (!existsSync(opts.targetWavPath)) throw new BeatMatchError(`no target wav at ${opts.targetWavPath}`)
  const targetBytes = readFileSync(opts.targetWavPath)
  const targetSha = createHash('sha256').update(targetBytes).digest('hex')
  const decoded = decodeWav(targetBytes)
  const durationSeconds = decoded.channels[0]!.length / decoded.sampleRate
  if (durationSeconds > 10) {
    throw new BeatMatchError(
      `target is ${durationSeconds.toFixed(1)}s — matching wants a 1-2s chop (research/107 §2.3); cut one first`,
    )
  }
  const targetLufs = integratedLoudness(decoded.channels, decoded.sampleRate).integratedLufs
  const pitch = detectPitch(decoded.channels, decoded.sampleRate)
  const midi = freezeMidi(pitch)
  const target = prepareTarget(decoded.channels, decoded.sampleRate)
  log(
    `target ${basename(opts.targetWavPath)}: ${durationSeconds.toFixed(2)}s, ` +
      `${Number.isFinite(targetLufs) ? targetLufs.toFixed(1) + ' LUFS' : 'immeasurable LUFS'}, ` +
      `pitch ${pitch.note ?? 'none'} (${pitch.level} confidence) -> frozen MIDI ${midi}`,
  )

  // ---- project scaffold -----------------------------------------------------------------------
  const outDir = resolve(opts.outDir)
  const projectDir = join(outDir, 'project')
  mkdirSync(projectDir, { recursive: true })
  if (trackKind === 'drum-sampler') {
    mkdirSync(join(projectDir, 'media'), { recursive: true })
    copyFileSync(opts.targetWavPath, join(projectDir, 'media', 'target.wav'))
  }
  const space = buildMatchSpace(trackKind)
  // Spectral-analysis initialization (research/107 §2.3): the filter cutoff starts near the
  // target's own spectral centroid instead of a fixed bright default, so the discrete screen
  // ranks combos in the right neighborhood of param space.
  const centroidHz = analyze(decoded.channels, decoded.sampleRate).spectral.centroidHz
  space.stage1 = applySpectralInit(space.stage1, centroidHz)
  log(`spectral init: target centroid ${centroidHz.toFixed(0)} Hz -> cutoff search starts near ${(centroidHz * 2).toFixed(0)} Hz`)
  const base = buildBaseDoc({ trackKind, midi, durationSeconds, targetSha256: targetSha })
  const curvePath = join(outDir, 'loss-curve.jsonl')
  writeFileSync(curvePath, '')

  const session = await opts.sessionFactory(projectDir, base.text)
  const stages: MatchReport['stages'] = []
  let evaluator: Evaluator
  try {
    evaluator = new Evaluator(target, targetSha, session, base, budget, curvePath, log)

    // ---- stage A: discrete screening ----------------------------------------------------------
    const combos = space.discreteChoices
    let bestCombo = combos[0]!
    let bestComboGenome = initGenome(space.stage1)
    if (combos.length > 1) {
      const screenBudget = Math.max(combos.length, Math.floor(budget * 0.25))
      const perCombo = Math.max(1, Math.floor(screenBudget / combos.length))
      const before = evaluator.renders
      let bestComboLoss = Infinity
      log(`stage screen: ${combos.length} osc/filter combos x ~${perCombo} render(s) each`)
      for (const combo of combos) {
        if (evaluator.budgetLeft < 1) break
        let comboBest = await evaluator.evaluate(space, combo, space.stage1, initGenome(space.stage1), [], 'screen')
        let comboBestGenome = initGenome(space.stage1)
        const miniEvals = Math.min(perCombo - 1, evaluator.budgetLeft)
        if (miniEvals >= 4) {
          const miniPop = Math.min(8, Math.max(4, miniEvals))
          const es = new CmaEs(initGenome(space.stage1), 0.2, {
            populationSize: miniPop,
            seed: seed + combos.indexOf(combo),
            lowerBounds: new Array(space.stage1.length).fill(0),
            upperBounds: new Array(space.stage1.length).fill(1),
          })
          let spent = 0
          while (spent + es.lambda <= miniEvals && evaluator.budgetLeft >= es.lambda) {
            const pts = es.ask()
            const losses: number[] = []
            for (const x of pts) {
              const r = await evaluator.evaluate(space, combo, space.stage1, x, [], 'screen')
              losses.push(r.loss.total)
              if (r.loss.total < comboBest.loss.total) {
                comboBest = r
                comboBestGenome = [...x]
              }
            }
            es.tell(pts, losses)
            spent += pts.length
          }
        }
        if (comboBest.loss.total < bestComboLoss) {
          bestComboLoss = comboBest.loss.total
          bestCombo = combo
          bestComboGenome = comboBestGenome
        }
      }
      stages.push({ name: 'screen', renders: evaluator.renders - before, bestLoss: round4(bestComboLoss) })
      log(`stage screen done: best combo ${bestCombo.label} (loss ${bestComboLoss.toFixed(4)})`)
    }

    // ---- stage B: source params (CMA-ES on stage1 dims, winning combo) ------------------------
    const stage2Planned = space.stage2.length > 0
    const stage1Budget = Math.max(0, Math.floor(evaluator.budgetLeft * (stage2Planned ? 0.7 : 1)))
    let stage1BestGenome = bestComboGenome
    {
      const before = evaluator.renders
      const pop = Math.min(population, Math.max(4, Math.floor(stage1Budget / 2)))
      let bestLoss: number | null = null
      if (stage1Budget >= pop * 2) {
        log(`stage source: CMA-ES over ${space.stage1.length} dims, population ${pop}, ~${stage1Budget} renders`)
        const es = new CmaEs(bestComboGenome, 0.25, {
          populationSize: pop,
          seed,
          lowerBounds: new Array(space.stage1.length).fill(0),
          upperBounds: new Array(space.stage1.length).fill(1),
        })
        let spent = 0
        let genomeBest = Infinity
        while (spent + es.lambda <= stage1Budget && evaluator.budgetLeft >= es.lambda) {
          const pts = es.ask()
          const losses: number[] = []
          for (const x of pts) {
            const r = await evaluator.evaluate(space, bestCombo, space.stage1, x, [], 'source')
            losses.push(r.loss.total)
            if (r.loss.total < genomeBest) {
              genomeBest = r.loss.total
              stage1BestGenome = [...x]
            }
          }
          es.tell(pts, losses)
          spent += pts.length
        }
        bestLoss = genomeBest === Infinity ? null : round4(genomeBest)
      } else {
        log(`stage source: skipped (budget left ${evaluator.budgetLeft} < ${pop * 2})`)
      }
      stages.push({
        name: 'source',
        renders: evaluator.renders - before,
        bestLoss,
        ...(bestLoss === null ? { note: 'skipped — budget too small after screening' } : {}),
      })
    }

    // ---- stage C: insert effects on the frozen stage-1 winner ---------------------------------
    if (stage2Planned) {
      const before = evaluator.renders
      const stage1Winner = buildCandidateDoc(base, space, bestCombo, space.stage1, stage1BestGenome)
      const frozen = stage1Winner.edits.filter((e) => !(e.path in bestCombo.edits))
      // The gate pseudo-param is a note edit, not a `beat set` line — it must be frozen
      // EXPLICITLY or stage 2 silently reverts the winner's note length (measured: the first
      // real self-match's inserts stage scored worse than its own starting point).
      const frozenGate = stage1Winner.gate
      const pop2 = Math.min(population, Math.max(4, Math.floor(evaluator.budgetLeft / 2)))
      let bestLoss: number | null = null
      if (evaluator.budgetLeft >= pop2 * 2 + 1) {
        log(`stage inserts: CMA-ES over ${space.stage2.length} dims, population ${pop2}, ~${evaluator.budgetLeft} renders`)
        // Anchor: the effects-off init genome reproduces the stage-1 winner's sound, so this
        // stage's reported best can never be worse than where it started.
        const anchor = await evaluator.evaluate(space, bestCombo, space.stage2, initGenome(space.stage2), frozen, 'inserts', frozenGate)
        let genomeBest = anchor.loss.total
        const es = new CmaEs(initGenome(space.stage2), 0.2, {
          populationSize: pop2,
          seed: seed + 1000,
          lowerBounds: new Array(space.stage2.length).fill(0),
          upperBounds: new Array(space.stage2.length).fill(1),
        })
        // `spent` counts ASKED points (cache hits included) so a fully-converged run that keeps
        // hitting the cache still terminates.
        const spentCap = evaluator.budgetLeft * 2 + 50
        let spent = 0
        while (spent + es.lambda <= spentCap && evaluator.budgetLeft >= es.lambda) {
          const pts = es.ask()
          const losses: number[] = []
          for (const x of pts) {
            const r = await evaluator.evaluate(space, bestCombo, space.stage2, x, frozen, 'inserts', frozenGate)
            losses.push(r.loss.total)
            if (r.loss.total < genomeBest) genomeBest = r.loss.total
          }
          es.tell(pts, losses)
          spent += pts.length
        }
        bestLoss = genomeBest === Infinity ? null : round4(genomeBest)
      }
      stages.push({
        name: 'inserts',
        renders: evaluator.renders - before,
        bestLoss,
        ...(bestLoss === null ? { note: 'skipped — budget exhausted by earlier stages' } : {}),
      })
    }
  } finally {
    await session.close()
  }

  const best = evaluator.bestSoFar
  if (best === null) throw new BeatMatchError('no candidate was ever evaluated (budget too small?)')

  // ---- outputs --------------------------------------------------------------------------------
  const bestBeatPath = join(outDir, 'best.beat')
  writeFileSync(bestBeatPath, best.text)
  const bestWavPath = join(outDir, 'best.wav')
  if (best.wav !== null) writeFileSync(bestWavPath, best.wav)

  const patchPath = join(outDir, 'patch.txt')
  const patchPairs = best.edits.map((e) => `${e.path} ${e.value}`)
  writeFileSync(
    patchPath,
    [
      `# beat match patch — target ${basename(opts.targetWavPath)} (sha256 ${targetSha.slice(0, 12)})`,
      `# loss ${best.loss.total.toFixed(4)} (mel ${best.loss.mel.toFixed(4)}, mfcc ${best.loss.mfcc.toFixed(4)}, env ${best.loss.envelope.toFixed(4)}) after ${evaluator.renders} renders`,
      `# frozen pitch: MIDI ${midi}; discrete: ${best.discrete}`,
      `# apply to this run's one-note project:`,
      `#   beat set ${bestBeatPath.replace(/best\.beat$/, 'project/current.beat')} ${patchPairs.slice(0, 2).join(' ')} ...`,
      `# or replay onto any ${trackKind === 'synth' ? 'synth' : 'drums'} track by swapping the "${space.trackId}." prefix for your track id.`,
      ...patchPairs,
    ].join('\n') + '\n',
  )

  // ---- ceiling metrics ------------------------------------------------------------------------
  let clapCosine: number | null = null
  let clapBackend: string | null = null
  let clapNote: string | null = null
  if (opts.clap !== false && best.wav !== null) {
    try {
      const { embedAudioFile } = await import('../taste/embeddings.js')
      for (const backend of ['clap', 'stub'] as const) {
        try {
          const a = await embedAudioFile(opts.targetWavPath, { backend })
          const b = await embedAudioFile(bestWavPath, { backend })
          clapCosine = round4(cosineSimilarity(a.embedding, b.embedding))
          clapBackend = backend
          if (backend === 'stub') clapNote = 'stub backend — NOT a real CLAP similarity; install python/requirements-clap.txt for the real number'
          break
        } catch (err) {
          clapNote = err instanceof Error ? err.message : String(err)
        }
      }
    } catch (err) {
      clapNote = err instanceof Error ? err.message : String(err)
    }
  } else if (best.wav === null) {
    clapNote = 'best candidate came from the eval cache — no render bytes in this run to embed'
  }

  const report: MatchReport = {
    target: {
      path: resolve(opts.targetWavPath),
      sha256: targetSha,
      durationSeconds: round4(durationSeconds),
      lufs: Number.isFinite(targetLufs) ? round4(targetLufs) : null,
      pitch: { midi: midi, note: pitch.note, hz: pitch.hz, confidence: pitch.level, frozenMidi: midi },
    },
    trackKind,
    budget,
    population,
    seed,
    renders: evaluator.renders,
    cacheHits: evaluator.cacheHits,
    stages,
    best: { stage: best.stage, discrete: best.discrete, loss: best.loss, edits: best.edits },
    ceiling: { mfccDistance: round4(best.loss.mfccDistance), clapCosine, clapBackend, clapNote },
    elapsedSeconds: Math.round((Date.now() - t0) / 100) / 10,
  }
  const reportPath = join(outDir, 'report.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')

  return {
    report,
    bestText: best.text,
    bestWavPath,
    bestBeatPath,
    patchPath,
    lossCurvePath: curvePath,
    reportPath,
    lossCurve: evaluator.curve,
  }
}

/** The human summary both the CLI and the self-match smoke print. */
export function formatMatchReport(r: MatchReport): string {
  const lines: string[] = []
  const p = r.target.pitch
  lines.push(
    `matched ${basename(r.target.path)} (${r.target.durationSeconds}s, ${r.target.lufs ?? '?'} LUFS) as ${r.trackKind}`,
    `pitch frozen at MIDI ${p?.frozenMidi} (detected ${p?.note ?? 'none'}, ${p?.confidence} confidence)`,
    `evaluations: ${r.renders + r.cacheHits}/${r.budget} (${r.renders} renders, ${r.cacheHits} cache hits), ${r.elapsedSeconds}s`,
  )
  for (const s of r.stages) {
    lines.push(`  stage ${s.name}: ${s.renders} renders${s.bestLoss !== null ? `, best loss ${s.bestLoss}` : ''}${s.note ? ` (${s.note})` : ''}`)
  }
  lines.push(
    `best: loss ${round4(r.best.loss.total)} (mel ${round4(r.best.loss.mel)}, mfcc ${round4(r.best.loss.mfcc)}, env ${round4(r.best.loss.envelope)}) — ${r.best.discrete}, found in stage ${r.best.stage}`,
    `ceiling: MFCC distance ${r.ceiling.mfccDistance}` +
      (r.ceiling.clapCosine !== null
        ? `, CLAP cosine ${r.ceiling.clapCosine} (${r.ceiling.clapBackend})`
        : `, CLAP cosine unavailable${r.ceiling.clapNote ? ` (${r.ceiling.clapNote})` : ''}`),
  )
  if (r.ceiling.clapNote && r.ceiling.clapCosine !== null) lines.push(`note: ${r.ceiling.clapNote}`)
  return lines.join('\n')
}
