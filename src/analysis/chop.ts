// Beat/bar/section-aware cutting of a real audio file into candidate chops (research 142 §2.1,
// build item 2 — "the highest-value new verb in this document").
//
// THE PROBLEM THIS REMOVES. The owner supplies ears; the toolkit removes the labor around them.
// Before this, the finding loop was: open the file in something that isn't dotbeat, scrub, guess
// at bar lines, export a region by hand, `beat sample` it (with no provenance), discover it's
// off-grid, repeat. Four of those five steps are labor. This module is the cut — the one missing
// piece — and everything downstream (`beat board`, `beat audition`, `beat rate`) then works on the
// result for free because it writes a clip-set batch manifest.
//
// FOUR DESIGN CALLS, ALL FROM THE MINED PRACTITIONER CORPUS (docs/priors/sample-manipulation.md),
// all of which are easy to get backwards:
//
//  1. GRID IS THE DEFAULT, transient detection is not offered here at all. The corpus is emphatic
//     that OVER-SEGMENTATION is the named failure mode of transient chopping, and that "making
//     fewer chops, leaving some pads playing sections of multiple hits... borrows more of the
//     groove of the original sample, and lets it breathe" — one source builds a whole groove from
//     THREE slices of a break. So: `--grid bar` with `--bars 1`, and the way to get more material
//     is to ask for a coarser grid, never a finer one by accident.
//
//  2. CUT AT ZERO CROSSINGS WHERE POSSIBLE, FADE WHERE NOT. "Experienced editors of digital audio
//     always try to make cuts at points where the waveform crosses the zero axis"; the documented
//     fallback is a short fade to "rescue a badly trimmed, clicky sample start." Two independent
//     corpora agree (pack-production.md reports the same rule as a shipped-loop QC gate). So each
//     cut point snaps to the nearest zero crossing within +/- 2 ms, and a 3 ms fade is applied
//     regardless. The snap is applied to the START only, and the next chop's start IS this chop's
//     end, so the set stays gapless and seamless against the source.
//
//  3. NO AUTO-NORMALIZE AND NO SILENCE-TRIM. `prepOneshot` does both and both are WRONG for a bar
//     of music: silence-trimming destroys the chop's timing relationship to the grid (a chop that
//     begins with a 30 ms rest becomes early), and peak-normalizing destroys the level
//     relationship BETWEEN chops of one song — which is exactly the information the owner is
//     listening for. The corpus's "normalize after trimming" advice is about one-shots, and
//     dotbeat already follows it there. This is the raw path.
//
//  4. REGISTER NOTHING. `beat source gen --count N` registers nothing and `beat adopt` registers
//     the winner alone; chops behave identically. Losing chops never enter a media block. The out
//     directory gets a generated `.gitignore` too — chops of commercial music are private, on the
//     same footing `--ref-dir` reference clips already have.
//
// The module is deliberately split: `planChops` is PURE (artifact + options -> cut points, no I/O,
// no audio), so the grid math is unit-testable against a stub-backend artifact; `cutChops` does
// the sample-domain work on already-decoded channels; the CLI owns the file I/O. Nothing here
// ranks, scores or rejects a chop — 142 §2.2 and D30 both forbid it (a mistake costs the sample).

import type { AnalysisArtifact } from './import.js'
import { BeatAnalysisError } from './structure.js'

/** How the cut points are derived from the detected grid. Deliberately no `transient` member —
 * see design call 1 above. */
export type ChopGrid = 'bar' | 'beat' | 'section'
export const CHOP_GRIDS: readonly ChopGrid[] = ['bar', 'beat', 'section']

export interface ChopPlanOptions {
  /** Default 'bar'. */
  grid?: ChopGrid
  /** Grid units per chop — bars for `bar`, beats for `beat`. Ignored for `section` (a section's
   * own boundaries are the cut). Default 1. */
  bars?: number
  /** Stop after this many chops (from the start of the file). Omitted = all of them. */
  max?: number
}

/** One planned cut, in SOURCE SECONDS — the same unit the analysis artifact speaks, so nothing in
 * this module ever converts to bars/steps (that boundary belongs to import.ts and stays there). */
export interface ChopPlan {
  /** 1-based, and the number in the `cNNN.wav` filename. */
  index: number
  startSeconds: number
  endSeconds: number
  /** Index into the detected downbeat list this chop starts on, or null when the grid isn't
   * downbeat-derived (beat grid, section grid, or a downbeat-less artifact). */
  downbeatIndex: number | null
  /** The detected section this chop's START falls in, or null (backends without sections report
   * an honest empty list — see the artifact contract). */
  sectionLabel: string | null
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** Seconds per bar — the SAME median-inter-downbeat rule `src/analysis/import.ts` owns for
 * `beat skeleton`, restated here rather than exported from there on purpose: import.ts's copy is
 * private to its seconds->bars derivation and this one is a fallback for a downbeat-less artifact.
 * Both fall back to `4 * 60 / bpm` (the engine is constant-4/4). Kept identical by inspection and
 * by test/chop.test.ts asserting the fallback value. */
function barSecondsOf(artifact: AnalysisArtifact): number {
  if (artifact.downbeats.length >= 2) {
    const diffs: number[] = []
    for (let i = 1; i < artifact.downbeats.length; i++) diffs.push(artifact.downbeats[i]! - artifact.downbeats[i - 1]!)
    const m = median(diffs)
    if (m > 0) return m
  }
  return (4 * 60) / artifact.bpm
}

function sectionLabelAt(artifact: AnalysisArtifact, seconds: number): string | null {
  for (const s of artifact.sections) {
    if (seconds >= s.start && seconds < s.end) return s.label
  }
  return null
}

/** Build a uniform grid of cut times from `bpm`/duration when the artifact has no usable detected
 * list — the honest degradation for a beats-only or empty artifact, and the same shape
 * `buildSkeleton` falls back to for sections. */
function uniformGrid(step: number, duration: number): number[] {
  const out: number[] = []
  for (let t = 0; t < duration - step * 0.5; t += step) out.push(t)
  return out
}

/** Extend a detected grid by ONE synthesized edge so the final full unit of audio is cuttable —
 * but only when there genuinely is one. A detector's last downbeat starts a real bar that ends at
 * the file's end; without this, that bar is silently dropped. Appending `duration` unconditionally
 * would be worse: it would mint a ragged partial "bar" whose length is whatever was left over, and
 * a set where one chop is a different length than the rest is exactly what grid cutting exists to
 * avoid. So: append `last + step` (clamped to duration) iff at least 90% of a unit remains. */
function closeTail(edges: number[], duration: number): void {
  if (edges.length < 2) return
  const last = edges[edges.length - 1]!
  const diffs: number[] = []
  for (let i = 1; i < edges.length; i++) diffs.push(edges[i]! - edges[i - 1]!)
  const step = median(diffs)
  if (step > 0 && duration - last >= step * 0.9) edges.push(Math.min(duration, last + step))
}

/** The pure planner: a validated analysis artifact + options -> the ordered cut list. Throws
 * BeatAnalysisError (naming what was missing) rather than silently degrading when the requested
 * grid genuinely isn't available — `--grid section` against a beats-only backend is a real user
 * error with a real fix (`--backend allin1`), not something to paper over. */
export function planChops(artifact: AnalysisArtifact, opts: ChopPlanOptions = {}): ChopPlan[] {
  const grid: ChopGrid = opts.grid ?? 'bar'
  if (!CHOP_GRIDS.includes(grid)) throw new BeatAnalysisError(`unknown --grid "${grid}" (one of: ${CHOP_GRIDS.join(', ')})`)
  const span = opts.bars ?? 1
  if (!Number.isInteger(span) || span < 1 || span > 64) {
    throw new BeatAnalysisError(`--bars must be an integer 1-64, got ${String(opts.bars)}`)
  }
  if (opts.max !== undefined && (!Number.isInteger(opts.max) || opts.max < 1)) {
    throw new BeatAnalysisError(`--max must be a positive integer, got ${String(opts.max)}`)
  }
  const duration = artifact.source.durationSeconds

  let edges: number[]
  let downbeatDerived = false
  if (grid === 'section') {
    if (artifact.sections.length === 0) {
      throw new BeatAnalysisError(
        `--grid section needs detected sections and this artifact has none (backend "${artifact.backend.name}"). ` +
          `beatthis reports beats/downbeats only — re-run with: beat analyze <file> --backend allin1, or use --grid bar.`,
      )
    }
    // Section boundaries are already start/end pairs; take starts plus the final end as the edge
    // list so the last section closes at its own detected end rather than the file's end.
    edges = [...artifact.sections.map((s) => s.start), artifact.sections[artifact.sections.length - 1]!.end]
  } else if (grid === 'beat') {
    edges = artifact.beats.length >= 2 ? [...artifact.beats] : uniformGrid(60 / artifact.bpm, duration)
    closeTail(edges, duration)
  } else {
    if (artifact.downbeats.length >= 2) {
      edges = [...artifact.downbeats]
      downbeatDerived = true
    } else {
      // No detected downbeats (a beats-only or degenerate artifact): a uniform bar grid from the
      // reported bpm. Honest, and identical to what `beat skeleton` does in the same situation.
      edges = uniformGrid(barSecondsOf(artifact), duration)
    }
    closeTail(edges, duration)
  }

  const plans: ChopPlan[] = []
  // `section` cuts on its own boundaries, so `--bars` does not apply (stated in the CLI help too).
  const stride = grid === 'section' ? 1 : span
  for (let i = 0; i + stride < edges.length; i += stride) {
    const start = edges[i]!
    const end = Math.min(edges[Math.min(i + stride, edges.length - 1)]!, duration)
    if (!(end > start)) continue
    plans.push({
      index: plans.length + 1,
      startSeconds: start,
      endSeconds: end,
      downbeatIndex: downbeatDerived ? i : null,
      sectionLabel: sectionLabelAt(artifact, start),
    })
    if (opts.max !== undefined && plans.length >= opts.max) break
  }
  if (plans.length === 0) {
    throw new BeatAnalysisError(
      `nothing to chop: the ${grid} grid produced no span of ${stride} unit(s) inside ${duration.toFixed(2)}s of audio` +
        (grid === 'section' ? '' : ` — try a smaller --bars`),
    )
  }
  return plans
}

// ---- the sample-domain cut ---------------------------------------------------------------------

/** How far a cut point may move to land on a zero crossing. 2 ms is the corpus's own "as close as
 * possible" reading of the rule and is under a 32nd note at any tempo dotbeat supports, so a snap
 * can never audibly move the downbeat. */
export const ZERO_CROSS_WINDOW_SECONDS = 0.002
/** Seam fade applied to both ends of every chop, unconditionally — the documented fallback for
 * when no zero crossing is reachable, and cheap insurance when one is. 3 ms sits inside the
 * corpus's 2-5 ms range and is short enough not to shape the transient. */
export const CHOP_FADE_SECONDS = 0.003

/** Nearest sample index to `target` where the mono sum crosses zero, within the window; `target`
 * itself when there is none (the fade then does the work). Ties go to the earlier index, so the
 * result is deterministic. */
export function snapToZeroCrossing(mono: Float64Array, target: number, windowSamples: number): number {
  const lo = Math.max(1, target - windowSamples)
  const hi = Math.min(mono.length - 1, target + windowSamples)
  let best = target
  let bestDist = Infinity
  for (let i = lo; i <= hi; i++) {
    const a = mono[i - 1]!
    const b = mono[i]!
    if ((a <= 0 && b >= 0) || (a >= 0 && b <= 0)) {
      const d = Math.abs(i - target)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
  }
  return best
}

export interface CutChop {
  plan: ChopPlan
  channels: Float64Array[]
  /** The sample-exact window actually taken, AFTER zero-crossing snapping — this is what the
   * provenance sidecar records, not the requested time (a chop's real bytes are what matters when
   * you later ask "where did this come from"). */
  startSeconds: number
  endSeconds: number
  /** true iff BOTH ends landed on a real zero crossing (the seam fade runs either way). */
  snapped: boolean
}

/** Cut one decoded file into the planned chops. Pure and deterministic. No normalization and no
 * silence trimming, by design (see design call 3 in this file's header) — the only sample-domain
 * changes are the zero-crossing snap and the seam fade. */
export function cutChops(
  channels: Float64Array[],
  sampleRate: number,
  plans: readonly ChopPlan[],
  opts: { fadeSeconds?: number; zeroCrossWindowSeconds?: number } = {},
): CutChop[] {
  const frames = channels[0]?.length ?? 0
  if (frames === 0) throw new BeatAnalysisError('cannot chop an empty audio file (0 frames decoded)')
  const fadeSeconds = opts.fadeSeconds ?? CHOP_FADE_SECONDS
  const window = Math.max(0, Math.round((opts.zeroCrossWindowSeconds ?? ZERO_CROSS_WINDOW_SECONDS) * sampleRate))

  // Mono sum drives the zero-crossing search so every channel is cut at the SAME sample — cutting
  // each channel at its own crossing would smear the stereo image at the seam.
  const mono = new Float64Array(frames)
  for (const ch of channels) for (let i = 0; i < frames; i++) mono[i] = mono[i]! + ch[i]! / channels.length

  const snapCache = new Map<number, number>()
  const snapAt = (seconds: number) => {
    // Clamped to `frames`, NOT `frames - 1`: a cut point is a boundary between samples, and the
    // last chop's END is legitimately the frame count itself. Clamping to frames-1 here silently
    // shortened the final chop by one sample (caught by the gapless assertion in test/chop.test.ts).
    const target = Math.max(0, Math.min(frames, Math.round(seconds * sampleRate)))
    if (target >= frames) return frames // nothing to search past the buffer's end
    // Endpoints are shared between adjacent chops; snapping each once keeps the set gapless.
    const cached = snapCache.get(target)
    if (cached !== undefined) return cached
    const snapped = window > 0 ? snapToZeroCrossing(mono, target, window) : target
    snapCache.set(target, snapped)
    return snapped
  }

  const out: CutChop[] = []
  for (const plan of plans) {
    const s0 = snapAt(plan.startSeconds)
    const s1 = Math.max(s0 + 1, Math.min(frames, snapAt(plan.endSeconds)))
    const length = s1 - s0
    const fade = Math.min(Math.floor(fadeSeconds * sampleRate), Math.floor(length / 2))
    const cut = channels.map((ch) => {
      const dst = new Float64Array(length)
      for (let i = 0; i < length; i++) {
        let g = 1
        if (fade > 0) {
          if (i < fade) g = i / fade
          else if (i >= length - fade) g = (length - i) / fade
        }
        dst[i] = ch[s0 + i]! * g
      }
      return dst
    })
    out.push({
      plan,
      channels: cut,
      startSeconds: s0 / sampleRate,
      endSeconds: s1 / sampleRate,
      snapped: s0 !== Math.round(plan.startSeconds * sampleRate) || s1 !== Math.round(plan.endSeconds * sampleRate),
    })
  }
  return out
}

// ---- provenance --------------------------------------------------------------------------------

/** One chop's provenance sidecar, written to `cNNN.wav.json` — the SAME `media/<id>.wav.json`
 * shape `registerPreppedMedia` enforces (source/license/sha256/preparedAt/durationSeconds), plus
 * the chop-shaped fields 142 §2.4 asks for. Written next to the wav so a chop stays
 * self-describing after it is moved, adopted, or renamed: the sidecar travels with the bytes.
 *
 * `license` defaults to the literal `unspecified`, exactly as everywhere else in this repo —
 * "you assert the license, we don't guess it." Ingesting a chop into a project (`beat source add`)
 * is where an asserted licence becomes mandatory; cutting one is not distribution.
 *
 * `key` is present and always null today, deliberately: the frozen `*.analysis.json` contract has
 * no key field, and detecting one per chop would be exactly the "confident wrong number" that
 * src/analysis/pitch.ts was written to avoid. The field exists so a future key-aware backend fills
 * it rather than growing a second sidecar shape. */
export interface ChopSidecar {
  source: string
  license: string
  sha256: string
  preparedAt: string
  durationSeconds: number
  derivedFrom: {
    file: string
    sha256: string
    startSeconds: number
    endSeconds: number
  }
  bpm: number
  bpmMethod: string
  grid: ChopGrid
  bars: number | null
  downbeatIndex: number | null
  sectionLabel: string | null
  key: null
  backend: string
}

export function buildChopSidecar(args: {
  cut: CutChop
  artifact: AnalysisArtifact
  sourcePath: string
  sha256: string
  grid: ChopGrid
  bars: number | null
  license: string
  preparedAt?: string
}): ChopSidecar {
  const { cut, artifact, sourcePath, sha256, grid, bars, license } = args
  return {
    source: `chop of ${sourcePath} [${cut.startSeconds.toFixed(3)}s, ${cut.endSeconds.toFixed(3)}s)`,
    license,
    sha256,
    preparedAt: args.preparedAt ?? new Date().toISOString(),
    durationSeconds: Number((cut.endSeconds - cut.startSeconds).toFixed(6)),
    derivedFrom: {
      file: sourcePath,
      sha256: artifact.source.sha256,
      startSeconds: Number(cut.startSeconds.toFixed(6)),
      endSeconds: Number(cut.endSeconds.toFixed(6)),
    },
    bpm: artifact.bpm,
    bpmMethod: artifact.bpmMethod,
    grid,
    bars,
    downbeatIndex: cut.plan.downbeatIndex,
    sectionLabel: cut.plan.sectionLabel,
    key: null,
    backend: artifact.backend.name,
  }
}

/** The set-level index written alongside the per-chop sidecars. NOT a second provenance mechanism
 * (142's "what NOT to build" forbids one) — every fact here is a copy of what the per-chop
 * sidecars already say, collected once so a human (or `beat board`) can read the whole set at a
 * glance without opening N files. The sidecars stay authoritative. */
export interface ChopIndex {
  dotbeatChops: 1
  source: { file: string; sha256: string; durationSeconds: number }
  backend: string
  bpm: number
  grid: ChopGrid
  bars: number | null
  createdAt: string
  chops: {
    file: string
    index: number
    startSeconds: number
    endSeconds: number
    durationSeconds: number
    downbeatIndex: number | null
    sectionLabel: string | null
  }[]
}

/** `cNNN.wav` — zero-padded to 3 so a directory listing sorts in cut order (and so
 * `writeClipSetBatch`'s v1..vN mapping follows the same order). */
export function chopFileName(index: number): string {
  return `c${String(index).padStart(3, '0')}.wav`
}

/** The generated `.gitignore` every chop directory gets: chops of commercial music are private,
 * on the same footing `--ref-dir` reference clips already have (D30's standing constraint 1 —
 * "royalty-free is not redistributable"). Ignoring everything including itself means dropping a
 * chop dir inside a repo can never accidentally stage a bar of someone's record. */
export const CHOP_GITIGNORE = `# beat chop: chops of source audio are working copies, never committed.
# D30 constraint 1 — royalty-free is not redistributable, and a chop of a commercial record is
# the source record. The provenance sidecars next to each wav record where they came from.
*
`
