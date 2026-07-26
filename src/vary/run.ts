// The vary POST-WRITE tail, owned once (W1.3 / review R5-F2, and D21's own mandate: "extract the
// shared shaping into src/ helpers both surfaces import, so the next drift can't happen").
//
// `writeVaryBatch` was extracted after pilot 95 so both surfaces agree on the manifest. The tail
// that runs AFTER the manifest — warn, render, report normalization, stitch the audition — was
// not, and it was copy-pasted SIX times (cli/beat.mjs: varyCmd / varyFeelCmd / varyAutomationCmd;
// src/mcp/server.ts beat_vary: the param, feel and automation branches). All three drifts the
// 2026-07-25 review found lived in exactly those copies:
//
//   1. `linkMediaFrom` (pilot 111) was fixed on the CLI's three copies and missed on MCP's
//      param-group branch — a group vary of any sample-using project rendered with every media
//      fetch 404ing (silent lanes). It is no longer an argument a caller can forget: the parent
//      .beat path is REQUIRED here and always forwarded.
//   2. The pilot-113 volume-vs-normalization warning existed on ONE of the six copies (the CLI's
//      param branch). It now fires from here, so both surfaces warn.
//   3. Capture mode (`--live`/`--offline`, itself a pilot-111 fix) was CLI-only; MCP had no way to
//      ask for it. `mode` is a plain option here and beat_vary now exposes it.
//
// Surfaces keep their own I/O: the CLI streams each line to stdout as it is produced (the render
// is a real-time capture per variant — a batch takes minutes, so the warning must print BEFORE it,
// not after), MCP joins the same lines into one tool result. `varyRenderPlan` is the pure decision
// half, so all four behaviours above are unit-testable without booting a browser.

import {
  renderVaryBatch,
  formatNormalizationResult,
  type NormalizeBatchResult,
  type RenderBatchOptions,
} from './batch.js'
import { stitchAudition, formatAuditionIndex, type AuditionResult } from './audition.js'

/** Which surface is asking — the only thing that differs between the six former copies, and it is
 * one sentence of "what to do next" prose. Owning both strings here keeps them from drifting. */
export type VarySurface = 'cli' | 'mcp'

/** Exactly one of the two is present per variant (VaryVariant vs FeelVariant/AutomationVariant). */
export type VaryTailVariant = { edits: { path: string; value: string }[]; recipe?: undefined } | { recipe: string; edits?: undefined }

export interface VaryTailOptions {
  /** The parent .beat path exactly as the caller referenced it. ALWAYS forwarded to
   * `renderVaryBatch` as `linkMediaFrom` (pilot 111) — required, so it cannot be forgotten. */
  file: string
  /** The batch directory `writeVaryBatch` just wrote. */
  outDir: string
  /** Variant count (== the number of vN.wav renders the tail expects). */
  count: number
  /** The batch's variants — read ONLY for the pilot-113 volume warning (param batches carry
   * `edits`; feel/automation variants carry a `recipe` instead and never trip it). Typed as the
   * union of what varyTrack/varyFeel/varyAutomation return, minus the doc nobody here needs. */
  variants: readonly VaryTailVariant[]
  /** false = `--no-normalize` / `normalize: false` (levels are still measured and recorded). */
  normalize?: boolean
  /** Force the batch capture path (`--live`/`--offline`); omitted = render --batch's own default. */
  mode?: 'live' | 'offline'
  /** The batch seed — the audition's shuffle seed, so re-stitching reproduces the same order. */
  seed: number
  /** `--audition` / `audition: true`: stitch the renders into one contact-sheet audition.wav. */
  audition?: boolean
  /** `--no-shuffle`: present the variants in generation order (the answer key is then printed). */
  noShuffle?: boolean
  surface: VarySurface
}

export interface VaryRenderPlan {
  /** Exactly what `renderVaryBatch` is called with — `linkMediaFrom` is always present. */
  render: RenderBatchOptions
  /** Lines to emit BEFORE the render starts (today: the pilot-113 volume confound warning). */
  warnings: string[]
  /** undefined = present in generation order (`--no-shuffle`). */
  shuffleSeed: number | undefined
}

/** The clock-derived seed default both surfaces use when no seed is given, with the zero guard
 * that only two of the four sites had (review R5-F2): `Date.now() % 2147483647` is 0 roughly once
 * every ~24.8 days, and seed 0 is a legal-but-degenerate RNG state. */
export function varySeed(explicit?: number): number {
  return explicit !== undefined ? explicit : Date.now() % 2147483647 || 1
}

/** The pure half of the tail: what to warn about, what to hand `renderVaryBatch`, how to order the
 * audition. No filesystem, no child process — the drift-prone decisions, testable directly. */
export function varyRenderPlan(opts: VaryTailOptions): VaryRenderPlan {
  const warnings: string[] = []
  // Pilot 113 (MEDIUM-HIGH): a batch that varies `volume` while loudness normalization is on rates
  // level-matched audio — the rater never hears the very difference the batch mutates, yet adopting
  // the winner writes that volume into a project nothing normalizes. Say so, on BOTH surfaces (the
  // CLI printed this and MCP printed nothing: an agent got no warning about the same confound).
  if (opts.normalize !== false && opts.variants.some((v) => v.edits?.some((e) => e.path.endsWith('.volume')))) {
    // The opt-out is spelled differently per surface, and a warning that names the wrong one is
    // worse than useless to the reader it is aimed at (MCP pilot, 2026-07-25: the shared text told
    // an agent to "pass --no-normalize", a flag no MCP client can pass).
    const optOut = opts.surface === 'cli' ? 'pass --no-normalize' : 'pass normalize false'
    warnings.push(
      `note: this batch varies volume, but loudness normalization will gain-match the renders — the volume differences will be largely inaudible when auditioning (${optOut} to hear them raw)`,
    )
  }
  return {
    render: {
      // D15/D23: the one render path is dotbeat's own engine driven headless via render.mjs
      // --batch. linkMediaFrom is unconditional — variant .beat files reference media relative to
      // themselves and the parent's media/ dir sits next to the parent (pilot 111).
      linkMediaFrom: opts.file,
      ...(opts.mode !== undefined ? { mode: opts.mode } : {}),
      ...(opts.normalize === false ? { normalize: false } : {}),
    },
    warnings,
    shuffleSeed: opts.noShuffle === true ? undefined : opts.seed,
  }
}

/** The line every surface prints once the renders exist, pointing at that surface's own score verb. */
export function renderedLine(outDir: string, count: number, surface: VarySurface): string {
  return surface === 'cli'
    ? `rendered ${count} wavs into ${outDir}/ — audition, then: beat score ${outDir} <best> [2nd 3rd]`
    : `rendered ${count} wavs into ${outDir}/ — audition, then record picks with beat_score`
}

export interface VaryTailResult {
  /** Every line produced, in order, each WITHOUT its trailing newline. */
  lines: string[]
  /** The loudness summary (null when nothing was measurable), for callers that want the data. */
  normalization: NormalizeBatchResult | null
  /** The stitched audition index, or null when `audition` was not requested. */
  audition: AuditionResult | null
}

/** Render → report normalization → stitch the audition, for a batch `writeVaryBatch` has already
 * written. `onLine` is called as each line is produced (the CLI streams to stdout so the warning
 * lands before the minutes-long render); the same lines come back in the result for MCP to join.
 * Throws `BeatBatchError` from the audition stitch, which each surface maps as it always has. */
export function runVaryBatch(opts: VaryTailOptions & { onLine?: (line: string) => void }): VaryTailResult {
  const plan = varyRenderPlan(opts)
  const lines: string[] = []
  const emit = (line: string) => {
    lines.push(line)
    opts.onLine?.(line)
  }
  for (const w of plan.warnings) emit(w)
  const normalization = renderVaryBatch(opts.outDir, opts.count, plan.render)
  emit(renderedLine(opts.outDir, opts.count, opts.surface))
  if (normalization) emit(formatNormalizationResult(normalization).trimEnd())
  let audition: AuditionResult | null = null
  if (opts.audition === true) {
    audition = stitchAudition(opts.outDir, opts.count, {
      ...(plan.shuffleSeed !== undefined ? { shuffleSeed: plan.shuffleSeed } : {}),
    })
    emit(formatAuditionIndex(audition).trimEnd())
  }
  return { lines, normalization, audition }
}
