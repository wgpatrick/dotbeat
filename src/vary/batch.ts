// Vary-batch plumbing shared by BOTH agent surfaces (Phase 34 Stream NA, the pilot-95 parity
// lesson): the manifest-write, pick-normalization, score-entry, and batch-render logic that
// `beat vary`/`beat score` (cli/beat.mjs) and `beat_vary`/`beat_score` (src/mcp/server.ts) must
// agree on byte-for-byte. A batch generated on either surface is scored on either surface — the
// manifest.json shape and the beat-scores.jsonl entry shape ARE the contract, so they live here
// once instead of being re-shaped per surface (phase-34-plan.md NA item 5: "extract the shared
// shaping into src/ helpers both surfaces import, so the next drift can't happen").

import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, symlinkSync, copyFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, serialize, setMediaSample, type BeatDocument } from '../core/index.js'
import { computeBatchFeatures } from '../taste/features.js'
import { decodeWav, integratedLoudness, truePeak } from '../metrics/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..') // dist/src/vary -> repo root

/** Where `beat score`/`beat_score` append and `beat suggest`/`beat_suggest` read, absent an override. */
export const DEFAULT_SCORES_LOG = 'beat-scores.jsonl'

// ---- path defaults (Phase 35 Stream OC, pilot 101 medium 4) ----------------------------------
// Batch out-dirs and the scores log used to default relative to the PROCESS cwd — invisible and
// unpredictable for a typical MCP client whose server was launched from who-knows-where, and a
// trap even on the CLI when run from outside the project folder. Both surfaces now default
// relative to the .beat file's own directory (the project IS the folder the .beat sits in — same
// rule beat_sample already applies to media paths). Explicit --out-dir/--log/out_dir/log always
// win, resolved exactly as the caller wrote them.

/** Default batch out-dir: "vary-<group>-<seed>" NEXT TO the parent .beat file, not under the
 * process cwd. Used by `beat vary` and beat_vary whenever no explicit out-dir is given. */
export function defaultBatchDir(parentPath: string, group: string, seed: number): string {
  return resolve(dirname(resolve(parentPath)), `vary-${group}-${seed}`)
}

/** Default scores-log path: beat-scores.jsonl NEXT TO the given .beat file. Used by
 * `beat suggest`/beat_suggest directly, and by scoreBatch (via the batch's manifest parent)
 * whenever no explicit log path is given. */
export function defaultScoresLog(beatFilePath: string): string {
  return resolve(dirname(resolve(beatFilePath)), DEFAULT_SCORES_LOG)
}

// ==== Phase 40 Stream VB ====
/** Default GEN batch out-dir: "gen-<sample-id>-<seed>" next to the parent .beat — the same
 * next-to-the-.beat convention as defaultBatchDir above, with a prefix that says at a glance which
 * kind of batch a directory holds. Used by `beat source gen --count N` / beat_source_gen. */
export function defaultGenBatchDir(parentPath: string, id: string, seed: number): string {
  return resolve(dirname(resolve(parentPath)), `gen-${id}-${seed}`)
}
// ==== end Phase 40 Stream VB ====

/** Batch/score shaping failures — the CLI rewraps these as BeatEditError (clean `error: ...`
 * output, exit 2); the MCP server surfaces the message as an isError tool result. */
export class BeatBatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatBatchError'
  }
}

// ==== Phase 40 Stream VB ====
/** D21: the per-variant `media` field that lets a GEN batch (N seeds of one prompt) ride this one
 * manifest shape instead of forking a parallel gen-only batch contract. A gen candidate is an
 * already-prepped one-shot WAV sitting in the batch dir that has NOT been registered into the
 * parent .beat — everything `registerPreppedMedia` needs to do that registration at ADOPT time,
 * for the winner alone, travels in here. `sidecar` is the complete provenance doc (prompt, seed,
 * backend, model, license posture…) written verbatim to media/<id>.wav.json on adopt, so adopt is
 * a dumb, deterministic replay of a decision the batch already recorded. */
export interface VariantMedia {
  /** the media/sample id this candidate registers as if it wins */
  id: string
  /** sha256 of the PREPPED candidate wav — the exact bytes adopt copies into media/, so what you
   * auditioned is byte-for-byte what gets registered (prep never re-runs at adopt) */
  sha256: string
  durationSeconds: number
  license: string
  source: string
  /** the generator seed for this candidate (batch seed + index) */
  seed?: number
  /** the ENFORCED provenance sidecar doc, written verbatim to media/<id>.wav.json at adopt */
  sidecar: Record<string, unknown>
}
// ==== end Phase 40 Stream VB ====

export interface VaryBatchManifest {
  parent: string
  parentSha256: string
  // ==== Phase 40 Stream VB ====
  // D21 strain (b): optional, because a GEN batch has no track — its candidates are media that
  // isn't in the project yet, so there is nothing for it to belong to. Vary batches always set it.
  track?: string
  // ==== end Phase 40 Stream VB ====
  group: string
  count: number
  amount?: number // param batches only — feel batches have no strength knob, so no key at all
  seed: number
  createdAt: string
  // ==== Phase 40 Stream VB ==== (gen batches only: the one prompt all N seeds render)
  prompt?: string
  // ==== end Phase 40 Stream VB ====
  // ==== loudness normalization (taste-loop) ====
  // Present once renderVaryBatch (or `beat render --batch`) has MEASURED this batch's renders.
  // normalized: true (the default path) — every measurable vN.wav was gained to targetLufs (the
  // batch MEDIAN variant's own measured LUFS) under the true-peak ceiling. normalized: false
  // (--no-normalize, pilot 113) — the renders keep their raw loudness but the measured levels are
  // still recorded (per-variant loudness with gainDb 0), so a raw batch is distinguishable from a
  // pre-normalization one and its levels leave a trail. Older manifests lack `normalized`; treat
  // absent as true (they were only ever written by the normalizing path). See VariantLoudness.
  normalization?: { targetLufs?: number; truePeakCeilingDbtp: number; normalized?: boolean }
  // ==== end loudness normalization ====
  // Showdown midi-figure source (docs/source-showdown-eval.md, "The midi figure source"): where
  // this batch's COMPOSED figures came from — 'midi' (extracted from private MIDI transcriptions
  // of commercial tracks; the batch dir is gitignore-gated and each variant's `from` records the
  // midi path as a local reference) or 'bank' (the internal archetype bank). scoreBatch copies
  // THIS LABEL ONLY into the shared log — never a song title, artist, or path.
  figureSource?: 'midi' | 'bank'
  // D21 strain (a): `file` is "vN.beat" for vary batches and "vN.wav" for gen batches — every
  // reader below resolves the variant through THIS field rather than re-deriving "vN.beat".
  // `source` (source-showdown eval, docs/source-showdown-eval.md): which PIPELINE produced this
  // clip — kind is engine|gen|keymap|ref; `from` is a human-readable provenance label (seed file
  // + track for engine clips, the prompt for gen/keymap clips, the ORIGINAL absolute path for ref
  // clips, which is a reference only — ref audio is private and its bytes/identity never travel
  // beyond the batch dir). scoreBatch copies the KINDS (never `from`) into the log entry so
  // per-source win rates survive batch-dir deletion.
  variants: { file: string; edits?: string[]; recipe?: string; media?: VariantMedia; loudness?: VariantLoudness; source?: { kind: string; from?: string } }[]
}

// ---- post-render loudness normalization (taste-loop) ------------------------------------------
// Loudness is the taste log's one measured confound (docs/taste-loop-design.md "Confounds"):
// within-batch level differences dominate naive preference — the learned taste model carried a
// +0.57 weight on samplePeakDb, i.e. "louder wins". renderVaryBatch therefore gain-matches every
// variant render to a COMMON integrated LUFS right after the batch renders, before audition
// stitching and before score-time feature extraction, so future ratings (and their recorded
// feature vectors) compare sound, not level. The target is the batch MEDIAN variant's own LUFS —
// relative, never an absolute genre target, so gains stay small and a quiet sketch isn't blasted
// to streaming loudness. Pure gain only: no limiting, no dynamics.

/** True-peak ceiling for UPWARD normalization gain, dBTP: boosting a variant never pushes its
 * estimated true peak past this; the gain is capped (and recorded as capped) instead. */
export const NORMALIZE_TRUE_PEAK_CEILING_DBTP = -1

/** Below this magnitude a computed gain is recorded as 0 and the wav left byte-identical —
 * rewriting 16-bit samples for a hundredth of a dB only adds requantization noise. */
const NORMALIZE_MIN_GAIN_DB = 0.05

/** What normalization did to one variant's render — recorded in the manifest (D21: additive
 * optional fields on the one shared manifest shape) so score/audition/training can see it. */
export interface VariantLoudness {
  /** Integrated LUFS of vN.wav as rendered, BEFORE the gain. null = immeasurable (digital
   * silence / nothing above the BS.1770 gates, or a missing/undecodable render) — the file is
   * left untouched. */
  measuredLufs: number | null
  /** The pure gain applied to vN.wav, in dB (0 = left byte-identical). */
  gainDb: number
  /** True when the NORMALIZE_TRUE_PEAK_CEILING_DBTP ceiling limited an upward gain below full
   * normalization — this variant still renders quieter than the batch target. */
  capped: boolean
  /** Estimated true peak of vN.wav as rendered (dBTP, BEFORE the gain) — pilot 113: the number
   * that makes a "capped" record readable on its own. Absent when immeasurable. */
  truePeakDbtp?: number
  /** The gain full normalization WANTED (target - measured) before the ceiling cap / min-gain
   * rounding — equals gainDb whenever nothing limited it. Absent when immeasurable or when the
   * batch was not normalized. */
  wantedGainDb?: number
}

export interface NormalizeBatchResult {
  /** False when normalization was skipped (--no-normalize / a batch recorded as raw): the levels
   * below were measured and recorded, but no gain was applied and no target exists. */
  normalized: boolean
  /** The common LUFS the batch was gained to. Absent when normalized is false. */
  targetLufs?: number
  /** Where targetLufs came from: 'batch median' (fresh normalization) or 'manifest target'
   * (a `render --batch` re-render honoring the batch's recorded target). */
  basis?: string
  /** One entry per variant, v1..vN order; `file` is the render ("vN.wav"). */
  variants: (VariantLoudness & { file: string })[]
}

const round2 = (x: number) => Math.round(x * 100) / 100

/** Scale every sample of a 16-bit PCM / 32-bit float wav by a pure linear gain, in place on
 * disk. Header and any extra chunks are preserved byte-for-byte; only the data chunk changes. */
function applyWavGain(path: string, gainDb: number): void {
  const bytes = readFileSync(path)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (off: number, len: number) => String.fromCharCode(...bytes.subarray(off, off + len))
  if (bytes.length < 44 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') throw new BeatBatchError(`${path} is not a RIFF/WAVE file`)
  let off = 12
  let fmt: { format: number; bitsPerSample: number } | null = null
  let dataOff = -1
  let dataLen = -1
  while (off + 8 <= bytes.length) {
    const id = ascii(off, 4)
    const size = view.getUint32(off + 4, true)
    if (id === 'fmt ') fmt = { format: view.getUint16(off + 8, true), bitsPerSample: view.getUint16(off + 22, true) }
    else if (id === 'data') {
      dataOff = off + 8
      dataLen = Math.min(size, bytes.length - dataOff)
    }
    off += 8 + size + (size % 2) // chunks are word-aligned
  }
  if (!fmt || dataOff === -1) throw new BeatBatchError(`${path}: missing fmt/data chunk`)
  const g = Math.pow(10, gainDb / 20)
  if (fmt.format === 1 && fmt.bitsPerSample === 16) {
    for (let p = dataOff; p + 2 <= dataOff + dataLen; p += 2) {
      const v = Math.round(view.getInt16(p, true) * g)
      view.setInt16(p, Math.max(-32768, Math.min(32767, v)), true)
    }
  } else if (fmt.format === 3 && fmt.bitsPerSample === 32) {
    for (let p = dataOff; p + 4 <= dataOff + dataLen; p += 4) {
      view.setFloat32(p, view.getFloat32(p, true) * g, true)
    }
  } else {
    throw new BeatBatchError(`${path}: unsupported wav encoding (format ${fmt.format}, ${fmt.bitsPerSample}-bit — need 16-bit PCM or 32-bit float)`)
  }
  writeFileSync(path, bytes)
}

/** Measure v1.wav..vN.wav once each: integrated LUFS + estimated true peak (both from the same
 * decode). null = immeasurable (silence, missing/undecodable render). */
function measureVariantLevels(outDir: string, count: number): ({ lufs: number; truePeakDb: number } | null)[] {
  const measured: ({ lufs: number; truePeakDb: number } | null)[] = []
  for (let i = 1; i <= count; i++) {
    let m: { lufs: number; truePeakDb: number } | null = null
    try {
      const decoded = decodeWav(readFileSync(resolve(outDir, `v${i}.wav`)))
      const l = integratedLoudness(decoded.channels, decoded.sampleRate).integratedLufs
      if (Number.isFinite(l)) m = { lufs: l, truePeakDb: 20 * Math.log10(truePeak(decoded.channels)) }
    } catch {
      /* missing/undecodable render — recorded as immeasurable, left untouched */
    }
    measured.push(m)
  }
  return measured
}

/** Record a loudness outcome into outDir's manifest.json when one exists (per-variant `loudness`
 * + batch-level `normalization` — D21 additive fields) so score-time readers and the training
 * log can see what happened. Tolerant of a missing manifest so the normalizer stays usable on
 * bare wav dirs (mirrors stitchAudition's posture). */
function recordLoudnessInManifest(outDir: string, count: number, normalization: NonNullable<VaryBatchManifest['normalization']>, variants: NormalizeBatchResult['variants']): void {
  const manifestPath = resolve(outDir, 'manifest.json')
  if (!existsSync(manifestPath)) return
  const manifest = readBatchManifest(outDir)
  manifest.normalization = normalization
  for (let i = 0; i < Math.min(count, manifest.variants.length); i++) {
    const v = variants[i]!
    manifest.variants[i]!.loudness = {
      measuredLufs: v.measuredLufs,
      gainDb: v.gainDb,
      capped: v.capped,
      ...(v.truePeakDbtp !== undefined ? { truePeakDbtp: v.truePeakDbtp } : {}),
      ...(v.wantedGainDb !== undefined ? { wantedGainDb: v.wantedGainDb } : {}),
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

/** Gain-match outDir's v1.wav..vN.wav to a common integrated LUFS (default: the batch MEDIAN
 * variant's own measured loudness — for even counts, the lower-middle variant, so the target is
 * always an actual variant's level; opts.targetLufs overrides it, e.g. `render --batch`
 * re-rendering a batch to its manifest's recorded target). Immeasurable variants (silence,
 * missing render) are left untouched and recorded as such; upward gains are capped at
 * NORMALIZE_TRUE_PEAK_CEILING_DBTP true peak — the cap is UPWARD-ONLY: a variant already over
 * the ceiling as rendered is never attenuated (pilot 113: say so, don't imply a hard ceiling).
 * Records the outcome into outDir's manifest.json when one exists and returns it either way.
 * Returns null when nothing was measurable (nothing rendered, or an all-silent batch). */
export function normalizeBatchLoudness(outDir: string, count: number, opts: { targetLufs?: number; basis?: string } = {}): NormalizeBatchResult | null {
  if (count < 1) return null
  const measured = measureVariantLevels(outDir, count)
  const measurable = measured.filter((m): m is { lufs: number; truePeakDb: number } => m !== null)
  if (measurable.length === 0) return null
  const sorted = measurable.map((m) => m.lufs).sort((a, b) => a - b)
  const targetLufs = opts.targetLufs ?? sorted[Math.floor((sorted.length - 1) / 2)]!

  const variants: NormalizeBatchResult['variants'] = []
  for (let i = 1; i <= count; i++) {
    const file = `v${i}.wav`
    const m = measured[i - 1]!
    if (m === null) {
      variants.push({ file, measuredLufs: null, gainDb: 0, capped: false })
      continue
    }
    const wantedGainDb = targetLufs - m.lufs
    let gainDb = wantedGainDb
    let capped = false
    if (gainDb > 0) {
      // Boosting can push peaks toward clipping — cap the gain so the ESTIMATED true peak
      // (pre-peak + gain: a pure gain shifts true peak by exactly the gain) stays at or below
      // the ceiling. Never cap below 0: a variant already over the ceiling as rendered is the
      // render's business, not normalization's — we just refuse to make it worse.
      const maxUp = NORMALIZE_TRUE_PEAK_CEILING_DBTP - m.truePeakDb
      if (gainDb > maxUp) {
        gainDb = Math.max(0, maxUp)
        capped = true
      }
    }
    if (Math.abs(gainDb) >= NORMALIZE_MIN_GAIN_DB) applyWavGain(resolve(outDir, file), gainDb)
    else gainDb = 0
    variants.push({ file, measuredLufs: round2(m.lufs), gainDb: round2(gainDb), capped, truePeakDbtp: round2(m.truePeakDb), wantedGainDb: round2(wantedGainDb) })
  }

  recordLoudnessInManifest(outDir, count, { targetLufs: round2(targetLufs), truePeakCeilingDbtp: NORMALIZE_TRUE_PEAK_CEILING_DBTP, normalized: true }, variants)
  return { normalized: true, targetLufs: round2(targetLufs), basis: opts.basis ?? 'batch median', variants }
}

/** The --no-normalize half (pilot 113): measure v1.wav..vN.wav and RECORD the levels (per-variant
 * loudness with gainDb 0, batch-level normalized: false) without touching a byte of audio — so a
 * raw batch still leaves a measured-LUFS trail and is distinguishable from a pre-normalization
 * one. Returns null when nothing was measurable, same as normalizeBatchLoudness. */
export function measureBatchLoudness(outDir: string, count: number): NormalizeBatchResult | null {
  if (count < 1) return null
  const measured = measureVariantLevels(outDir, count)
  if (!measured.some((m) => m !== null)) return null
  const variants: NormalizeBatchResult['variants'] = measured.map((m, i) =>
    m === null
      ? { file: `v${i + 1}.wav`, measuredLufs: null, gainDb: 0, capped: false }
      : { file: `v${i + 1}.wav`, measuredLufs: round2(m.lufs), gainDb: 0, capped: false, truePeakDbtp: round2(m.truePeakDb) },
  )
  recordLoudnessInManifest(outDir, count, { truePeakCeilingDbtp: NORMALIZE_TRUE_PEAK_CEILING_DBTP, normalized: false }, variants)
  return { normalized: false, variants }
}

/** The post-`render --batch` loudness policy (pilot 113 HIGH 1: a re-render used to silently
 * strip normalization and leave the manifest lying about the audio). Reads the batch manifest
 * and: re-applies normalization to the manifest's RECORDED target when the batch was normalized
 * (refreshing every loudness field); measure-only refreshes a batch recorded as raw; with
 * normalize: false (--no-normalize) measure-only refreshes and honestly re-records the batch as
 * not normalized. A manifest with no normalization record at all returns null untouched — that
 * is a batch being rendered for the FIRST time (renderVaryBatch's child call), whose caller owns
 * the normalize-or-measure decision. */
export function refreshBatchLoudnessAfterRender(outDir: string, count: number, opts: { normalize?: boolean } = {}): NormalizeBatchResult | null {
  if (!existsSync(resolve(outDir, 'manifest.json'))) return null
  const recorded = readBatchManifest(outDir).normalization
  if (opts.normalize === false) return measureBatchLoudness(outDir, count)
  if (recorded === undefined) return null
  // Older manifests lack `normalized` — absent means true (see the manifest field comment).
  if (recorded.normalized === false) return measureBatchLoudness(outDir, count)
  return normalizeBatchLoudness(outDir, count, { ...(recorded.targetLufs !== undefined ? { targetLufs: recorded.targetLufs, basis: 'manifest target' } : {}) })
}

/** The one-line loudness summary both surfaces print after a rendered batch — the normalization
 * line, or the explicit not-normalized line (pilot 113: an opt-out run must say so). Capped
 * variants print what was WANTED and why it was held back (a bare "+0.0 dB (capped)" was
 * unreadable), and a batch whose renders exceed the ceiling on their own gets an honest note —
 * the cap only limits normalization boosts, it never attenuates a hot render. */
export function formatNormalizationResult(r: NormalizeBatchResult): string {
  const fmt = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`
  let out: string
  if (!r.normalized) {
    const parts = r.variants.map((v, i) => (v.measuredLufs === null ? `v${i + 1} silent` : `v${i + 1} ${v.measuredLufs.toFixed(1)} LUFS`))
    out = `not loudness-normalized (raw render loudness kept; measured levels recorded in the manifest): ${parts.join(', ')}\n`
  } else {
    const parts = r.variants.map((v, i) => {
      if (v.measuredLufs === null) return `v${i + 1} silent (untouched)`
      if (!v.capped) return `v${i + 1} ${fmt(v.gainDb)} dB`
      const wanted = v.wantedGainDb ?? v.gainDb
      return v.gainDb === 0
        ? `v${i + 1} +0.0 dB applied (wanted ${fmt(wanted)}, capped: already at ${fmt(v.truePeakDbtp ?? 0)} dBTP)`
        : `v${i + 1} ${fmt(v.gainDb)} dB applied (wanted ${fmt(wanted)}, capped at the ${NORMALIZE_TRUE_PEAK_CEILING_DBTP} dBTP ceiling)`
    })
    out = `loudness-normalized to ${r.targetLufs!.toFixed(1)} LUFS (${r.basis ?? 'batch median'}): ${parts.join(', ')}\n`
  }
  const hot = r.variants.filter((v) => v.truePeakDbtp !== undefined && v.truePeakDbtp + v.gainDb > NORMALIZE_TRUE_PEAK_CEILING_DBTP + 0.01)
  if (hot.length > 0) {
    out += `note: ${hot.length} of ${r.variants.length} variant(s) exceed ${NORMALIZE_TRUE_PEAK_CEILING_DBTP} dBTP as rendered — the ceiling only caps normalization boosts, it never attenuates a hot render (beat lint flags true-peak clipping)\n`
  }
  return out
}

export interface WriteVaryBatchOptions {
  /** The parent .beat path exactly as the caller referenced it — stored verbatim in the manifest
   * (and echoed back by score's adopt hint), same as the CLI has always done. */
  parentPath: string
  /** The parent's raw text, hashed into parentSha256 so score entries pin the exact source. */
  parentText: string
  track: string
  group: string
  count: number
  amount?: number
  seed: number
  outDir: string
  /** From varyTrack (edits) or varyFeel (recipe) — exactly one of the two per variant. */
  variants: { doc: BeatDocument; edits?: { path: string; value: string }[]; recipe?: string }[]
}

/** Writes v1.beat..vN.beat plus manifest.json into outDir. The manifest shape is the cross-surface
 * contract `scoreBatch` below reads — param batches carry replayable `edits` ("path value" strings,
 * ready for `beat set`), feel batches carry a `recipe` (the whole variant file IS the result, since
 * humanize isn't a set-replayable edit). */
export function writeVaryBatch(opts: WriteVaryBatchOptions): VaryBatchManifest {
  mkdirSync(opts.outDir, { recursive: true })
  const manifest: VaryBatchManifest = {
    parent: opts.parentPath,
    parentSha256: createHash('sha256').update(opts.parentText).digest('hex'),
    track: opts.track,
    group: opts.group,
    count: opts.count,
    ...(opts.amount !== undefined ? { amount: opts.amount } : {}),
    seed: opts.seed,
    createdAt: new Date().toISOString(),
    // Renders are nondeterministic run-to-run — measured (Phase 34 NC, docs/render-determinism.md):
    // identical re-renders differ by up to ~0.6 dB in peak-domain metrics (true peak / crest),
    // ~1.6 band-share points, and ~1.3 dB stereo width, while LUFS stays within ~0.2 LU (tolerance
    // constants: RENDER_RUN_VARIANCE_* in src/metrics/variance.ts). Only compare renders from the
    // same batch, never across sessions, and treat metric deltas inside those bounds as ties, not
    // rankings.
    variants: opts.variants.map((v, i) => ({
      file: `v${i + 1}.beat`,
      ...(v.recipe !== undefined ? { recipe: v.recipe } : { edits: (v.edits ?? []).map((e) => `${e.path} ${e.value}`) }),
    })),
  }
  for (let i = 0; i < opts.variants.length; i++) {
    writeFileSync(resolve(opts.outDir, `v${i + 1}.beat`), serialize(opts.variants[i]!.doc))
  }
  writeFileSync(resolve(opts.outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

// ==== Phase 40 Stream VB ====

export interface WriteGenBatchOptions {
  /** The parent .beat path exactly as the caller referenced it — stored verbatim, same as vary. */
  parentPath: string
  /** The parent's raw text, hashed into parentSha256: the .beat adopt will register into. */
  parentText: string
  /** The media id the candidates compete to become — the manifest's group is "gen:<id>". */
  id: string
  /** The one prompt all N candidates render (the batch varies only the seed). */
  prompt: string
  /** The FIRST seed of the run (candidate i has seed + i) — the batch's identity, like vary's. */
  seed: number
  /** Manifest group override (default `gen:<id>`). `beat gen-kit` passes `genkit:<role>` so a
   * kit run's role batches are distinguishable in the one scores log while still classifying as
   * generation rounds (variantTypeOf treats both prefixes as 'gen'). */
  group?: string
  outDir: string
  /** One per candidate in v1..vN order; each candidate's PREPPED wav must already be written to
   * outDir/v<i+1>.wav by the caller (source-lib's prep half). */
  variants: { media: VariantMedia }[]
}

/** Writes manifest.json for a GEN batch — the candidates' v1.wav..vN.wav are already on disk (the
 * generator wrote them; unlike vary there is no document to serialize). Produces the SAME
 * VaryBatchManifest shape writeVaryBatch does, so scoreBatch/adoptVariant/readBatchManifest and
 * both surfaces read one contract (D21) — the differences are entirely carried by the optional
 * fields the type already declares: `file` is vN.wav, `track` is absent, `media` is present. */
export function writeGenBatch(opts: WriteGenBatchOptions): VaryBatchManifest {
  mkdirSync(opts.outDir, { recursive: true })
  // The caller writes the candidate wavs and this names them — an invariant split across two files,
  // so verify it here rather than letting a manifest that lies about its own contents reach adopt.
  opts.variants.forEach((_, i) => {
    const wav = resolve(opts.outDir, `v${i + 1}.wav`)
    if (!existsSync(wav)) throw new BeatBatchError(`gen batch is missing its prepped candidate ${wav} — the manifest would name a file that does not exist`)
  })
  const manifest: VaryBatchManifest = {
    parent: opts.parentPath,
    parentSha256: createHash('sha256').update(opts.parentText).digest('hex'),
    // no `track` — see the D21 strain (b) note on the interface
    group: opts.group ?? `gen:${opts.id}`,
    count: opts.variants.length,
    seed: opts.seed,
    createdAt: new Date().toISOString(),
    prompt: opts.prompt,
    variants: opts.variants.map((v, i) => ({ file: `v${i + 1}.wav`, media: v.media })),
  }
  writeFileSync(resolve(opts.outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

export interface RegisterMediaResult {
  id: string
  sha256: string
  /** the media path as written into the .beat, e.g. "media/snare.wav" */
  relPath: string
  sidecarPath: string
  durationSeconds: number
  license: string
  source: string
  /** non-null when the id was ALREADY in the media block (setMediaSample is an upsert) — pilot
   * 104's "silent replace" note, surfaced through the return value so each surface prints it. */
  reregistered: { changed: boolean; previousSha256: string } | null
}

/** The REGISTER half of source-lib's old `ingest()` (Phase 40 VB): take an ALREADY-PREPPED wav and
 * make it real in a .beat project — copy it to media/<id>.wav, write the ENFORCED provenance
 * sidecar, and upsert the media block.
 *
 * It lives here rather than in scripts/source-lib.mjs because `adoptVariant` (below) is the second
 * caller and must stay synchronous for both surfaces; source-lib imports it back so `beat source
 * add`/`gen`'s single-shot path and `beat adopt`'s deferred path share ONE registration
 * implementation — splitting ingest was never meant to fork it.
 *
 * `wavPath` may already BE media/<id>.wav (source-lib preps straight there on the single-shot
 * path), in which case the copy is skipped. Rollback: a failed sidecar write removes the wav, so
 * media is never registered without its provenance — the invariant the original ingest enforced. */
export function registerPreppedMedia(beatFilePath: string, wavPath: string, media: VariantMedia): RegisterMediaResult {
  const beatDir = dirname(resolve(beatFilePath))
  const mediaDir = join(beatDir, 'media')
  const relPath = `media/${media.id}.wav`
  const outPath = join(mediaDir, `${media.id}.wav`)
  mkdirSync(mediaDir, { recursive: true })
  const copied = resolve(wavPath) !== resolve(outPath)
  if (copied) {
    if (!existsSync(wavPath)) throw new BeatBatchError(`the prepped candidate ${wavPath} is missing — cannot register ${media.id}`)
    copyFileSync(wavPath, outPath)
  }
  const sidecarPath = outPath + '.json'
  try {
    writeFileSync(sidecarPath, JSON.stringify(media.sidecar, null, 2) + '\n')
  } catch (err) {
    try { rmSync(outPath) } catch { /* best-effort */ }
    throw new BeatBatchError(`could not write the required provenance sidecar ${sidecarPath}: ${err instanceof Error ? err.message : String(err)}`)
  }
  let before
  try {
    before = parse(readFileSync(beatFilePath, 'utf8'))
  } catch (err) {
    throw new BeatBatchError(`could not parse ${beatFilePath}: ${err instanceof Error ? err.message : String(err)}`)
  }
  const existing = before.media.find((m) => m.id === media.id)
  const reregistered = existing ? { changed: existing.sha256 !== media.sha256, previousSha256: existing.sha256 } : null
  writeFileSync(beatFilePath, serialize(setMediaSample(before, media.id, media.sha256, relPath)))
  return {
    id: media.id,
    sha256: media.sha256,
    relPath,
    sidecarPath,
    durationSeconds: media.durationSeconds,
    license: media.license,
    source: media.source,
    reregistered,
  }
}
// ==== end Phase 40 Stream VB ====

export interface RenderBatchOptions {
  /** Set to the parent .beat path for FEEL batches: variant files reference media relative to
   * themselves, and the parent's media/ dir sits next to the parent, so it gets linked into the
   * batch dir before rendering (best-effort — a failed link surfaces as render's own
   * missing-sample report). */
  linkMediaFrom?: string
  /** Force the batch capture path (pilot 111: `vary --render --live` used to swallow the flag
   * silently — the render child never saw it). Omitted = render --batch's own default (offline
   * when the project is eligible, live otherwise). */
  mode?: 'live' | 'offline'
  /** false = skip post-render loudness normalization (`--no-normalize` / normalize:false) —
   * levels are still measured and recorded (measureBatchLoudness, pilot 113). Normalized is the
   * default: see normalizeBatchLoudness above for why (the taste log's "louder wins" confound). */
  normalize?: boolean
}

/** Renders the batch's .beat variants to vN.wav each through cli/render.mjs's --batch mode —
 * dotbeat's own engine in headless Chromium (D15), booted ONCE for the whole batch (the
 * per-variant daemon + vite + browser boot used to cost ~10-15s of pure overhead each; variants
 * now swap through one session via the daemon's own hot-reload). Real-time capture per variant
 * still applies; the child prints per-variant progress on stderr (inherited).
 *
 * After rendering, the batch is loudness-normalized by default (normalizeBatchLoudness above —
 * gain-matched to the median variant's LUFS, upward gains capped at -1 dBTP true peak, recorded
 * in the manifest). opts.normalize false skips the gain but still MEASURES and records the raw
 * levels (measureBatchLoudness — pilot 113: an opt-out run says so and leaves a loudness trail).
 * The returned result is the loudness summary for the caller to print via
 * formatNormalizationResult (null when nothing was measurable). Audition stitching happens AFTER
 * this in every caller, so audition.wav is built from the normalized renders. */
export function renderVaryBatch(outDir: string, count: number, opts: RenderBatchOptions = {}): NormalizeBatchResult | null {
  if (count < 1) return null
  if (opts.linkMediaFrom !== undefined) {
    const parentMedia = resolve(dirname(resolve(opts.linkMediaFrom)), 'media')
    const batchMedia = resolve(outDir, 'media')
    if (existsSync(parentMedia) && !existsSync(batchMedia)) {
      try {
        symlinkSync(parentMedia, batchMedia, 'dir')
      } catch {
        /* best-effort; render will report a missing sample */
      }
    }
  }
  const renderCli = join(repoRoot, 'cli', 'render.mjs')
  const args = [renderCli, '--batch', resolve(outDir)]
  if (opts.mode !== undefined) args.push(`--${opts.mode}`)
  execFileSync(process.execPath, args, {
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  if (opts.normalize === false) return measureBatchLoudness(outDir, count)
  return normalizeBatchLoudness(outDir, count)
}

export interface ScoreEntry {
  t: string
  batch: string
  // ==== Phase 40 Stream VB ==== (D21 strain (b): absent on gen entries — a gen batch has no track)
  track?: string
  // ==== end Phase 40 Stream VB ====
  group: string
  amount?: number
  seed: number
  parentSha256: string
  // ==== Phase 40 Stream VB ==== (gen entries: the prompt these seeds rendered — one `jq` away
  // from answering "which prompts/seeds do I actually like", the point of keeping ONE scores log)
  prompt?: string
  // ==== end Phase 40 Stream VB ====
  picks: { rank: number; variant: string; recipe?: string; edits?: string[]; media?: { id: string; seed?: number; sha256: string } }[]
  rejected: string[]
  /** T0 taste-loop enrichment (docs/taste-loop-design.md L1): the DSP feature vector of EVERY
   * variant with a render present at score time, keyed by the variant's `file`, picks and
   * rejects alike — the training data a taste model needs is "what did the losers measure",
   * which the picks-only shape above deliberately never carried. Absent entirely when the batch
   * was never rendered (scoring un-rendered batches stays legal and cheap). Batch dirs get
   * deleted after adopt; this makes the log self-contained for training. */
  features?: Record<string, Record<string, number>>
  /** Source-showdown batches (docs/source-showdown-eval.md): each variant's source KIND
   * (engine|gen|keymap|ref) keyed by variant file — what `beat showdown --report` aggregates
   * into per-source win rates, durable after the batch dir is gone. Deliberately the kind ONLY:
   * a ref clip's origin path stays in the batch dir's manifest, never in the shared log. */
  sources?: Record<string, string>
  /** Showdown batches only: where the composed figures came from — 'midi' (commercial MIDI
   * transcriptions, private) or 'bank' (internal archetypes). The label is the ONLY midi-related
   * fact that ever reaches this shared log (the licensing posture): song identity stays in the
   * gitignore-gated batch dir's manifest. Lets the report separate "our sounds with commercial
   * composition" from "our sounds with our composition". */
  figureSource?: 'midi' | 'bank'
}

export interface ScoreBatchResult {
  dir: string
  logPath: string
  manifest: VaryBatchManifest
  ranks: number[]
  entry: ScoreEntry
  /** True when this batch's variants carry a `recipe` (a whole-doc result — feel humanize batches
   * AND Phase 37 automation-shape batches) rather than replayable `edits` (param/lane batches). The
   * adopt-vs-`beat set`-replay branch keys off this, not off any specific group name, so a new
   * whole-doc vary target scores and adopts for free by simply producing recipe'd variants. */
  usesRecipe: boolean
  // ==== Phase 40 Stream VB ====
  /** True when this batch's variants carry `media` — a GEN batch of one-shot candidates, whose
   * winner is ADOPTED BY REGISTRATION rather than by copying a document over the parent. Keyed off
   * the variant shape for the same reason usesRecipe is, not off the "gen:" group prefix. */
  usesMedia: boolean
  // ==== end Phase 40 Stream VB ====
  /** Pilot 108: set when this batch dir already had one or more entries in the resolved log —
   * the LATEST previous ranking, as display labels ("v1 > v3"), so the summary can flag the
   * re-score instead of silently appending a contradiction. The log stays append-only (a
   * re-score is a legitimate change of mind); the taste harness uses the latest entry per batch
   * (src/taste/eval.ts) and this note is how the user learns that rule exists. */
  previousPicks?: string
}

/** Read + parse a batch dir's manifest.json — shared by scoreBatch and adoptVariant so the
 * missing-batch error text stays identical across every verb that takes a batch dir. */
export function readBatchManifest(dir: string): VaryBatchManifest {
  const manifestPath = resolve(dir, 'manifest.json')
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as VaryBatchManifest
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new BeatBatchError(`no such batch directory or missing manifest.json: ${dir}`)
    throw new BeatBatchError(`could not read ${manifestPath}: ${(err as Error).message}`)
  }
}

/** Normalize one pick ("N" or "vN", Phase 33 Stream ME) to its 1-based variant number,
 * validating against the batch size — shared by scoreBatch and adoptVariant. */
export function normalizePick(pick: string, variantCount: number): number {
  // Variants are always DISPLAYED as v1/v2/... (printed summary, manifest, suggest's "adopt"
  // line) but historically had to be REFERENCED as bare integers only. Accept either form,
  // normalizing to the bare integer everywhere below.
  const normalized = /^[vV](\d+)$/.test(pick) ? pick.slice(1) : pick
  const n = Number(normalized)
  if (!Number.isInteger(n) || n < 1 || n > variantCount) {
    throw new BeatBatchError(`pick "${pick}" is not a variant number 1-${variantCount} (accepts "N" or "vN")`)
  }
  return n
}

/** Resolve a batch manifest's `parent` (stored verbatim as the vary caller referenced it) to an
 * absolute path, from the perspective of a possibly-different later process: absolute paths pass
 * through; a relative path resolves against the cwd if a file exists there, else falls back to
 * the batch dir's own parent directory (where the parent .beat sits by construction under the
 * next-to-the-.beat out-dir default above). */
export function resolveBatchParent(dir: string, manifest: VaryBatchManifest): string {
  if (isAbsolute(manifest.parent)) return manifest.parent
  const fromCwd = resolve(manifest.parent)
  if (existsSync(fromCwd)) return fromCwd
  const fromBatch = resolve(dirname(resolve(dir)), basename(manifest.parent))
  if (existsSync(fromBatch)) return fromBatch
  return fromCwd // let callers report the nonexistence against the most conventional candidate
}

// ---- clip-set batches (T0 taste-loop, docs/taste-loop-design.md L1) ---------------------------
// An audition/score batch built from ARBITRARY wavs (stem chops, downloaded one-shots) rather
// than variants of a parent .beat — the T3 blind-chop-rating flow needs exactly the vary batch's
// audition + score machinery pointed at sounds that have no parent document. Represented in the
// SAME manifest shape with parent/parentSha256 empty: scoreBatch defaults the log next to the
// batch dir (there is no parent to sit next to), and adoptVariant refuses outright (nothing to
// adopt into).

/** Write a clip-set batch manifest over wavs already sitting in outDir. `files` are outDir-
 * relative wav names in v1..vN order. */
export function writeClipSetBatch(outDir: string, files: string[], opts: { group?: string; seed?: number } = {}): VaryBatchManifest {
  if (files.length === 0) throw new BeatBatchError('a clip-set batch needs at least one wav')
  for (const f of files) {
    if (!existsSync(resolve(outDir, f))) throw new BeatBatchError(`clip-set batch is missing ${resolve(outDir, f)}`)
  }
  const manifest: VaryBatchManifest = {
    parent: '',
    parentSha256: '',
    group: opts.group ?? 'clips',
    count: files.length,
    seed: opts.seed ?? 41,
    createdAt: new Date().toISOString(),
    variants: files.map((file) => ({ file })),
  }
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

/** Records 1-3 ranked picks against a batch dir into the append-only scores log — the exact
 * normalization, validation, entry shape, and append `beat score` has always done, shared so
 * `beat_score` can't drift. Picks accept "N" or "vN" (Phase 33 Stream ME, research/96). Absent
 * an explicit logPath the log defaults NEXT TO the batch's parent .beat file (Phase 35 OC —
 * not the process cwd), so CLI- and MCP-recorded picks land in the same file regardless of
 * where either process happens to be running. Clip-set batches (empty parent) default the log
 * next to the batch dir instead. */
export function scoreBatch(dir: string, picks: string[], logPath?: string): ScoreBatchResult {
  if (picks.length === 0) throw new BeatBatchError('score needs 1-3 ranked picks (variant numbers, best first)')
  if (picks.length > 3) throw new BeatBatchError('at most 3 ranked picks (Edisyn (3,16) pattern — ranking more adds fatigue, not signal)')
  const manifest = readBatchManifest(dir)
  const resolvedLog = logPath ?? (manifest.parent === '' ? resolve(dirname(resolve(dir)), DEFAULT_SCORES_LOG) : defaultScoresLog(resolveBatchParent(dir, manifest)))
  const ranks = picks.map((p) => normalizePick(p, manifest.variants.length))
  if (new Set(ranks).size !== ranks.length) throw new BeatBatchError('picks must be distinct')
  // param batches carry replayable `edits`; whole-doc batches (feel humanize, Phase 37 automation-
  // shape) carry a `recipe` (the variant file IS the result, not a set-replayable edit). Key off the
  // variant shape itself, not any group name, so any future whole-doc target works without touching
  // this: a batch is recipe-shaped iff its (homogeneous) variants carry recipe rather than edits.
  const usesRecipe = manifest.variants.length > 0 && manifest.variants[0]!.recipe !== undefined
  // ==== Phase 40 Stream VB ====
  // Third variant shape, same rule: a batch is media-shaped iff its variants carry `media` (gen
  // candidates). Note the file name comes from the variant's own `file` field everywhere below
  // rather than a re-derived `v${n}.beat` — D21 strain (a). For vary batches that field IS
  // "vN.beat", so every existing entry keeps its exact bytes.
  const usesMedia = manifest.variants.length > 0 && manifest.variants[0]!.media !== undefined
  const fileOf = (n: number) => manifest.variants[n - 1]!.file
  // ==== end Phase 40 Stream VB ====
  const entry: ScoreEntry = {
    t: new Date().toISOString(),
    batch: dir,
    ...(manifest.track !== undefined ? { track: manifest.track } : {}),
    group: manifest.group,
    amount: manifest.amount,
    seed: manifest.seed,
    parentSha256: manifest.parentSha256,
    ...(manifest.prompt !== undefined ? { prompt: manifest.prompt } : {}),
    picks: ranks.map((n, i) => ({
      rank: i + 1,
      variant: fileOf(n),
      ...(usesMedia
        ? { media: { id: manifest.variants[n - 1]!.media!.id, seed: manifest.variants[n - 1]!.media!.seed, sha256: manifest.variants[n - 1]!.media!.sha256 } }
        : usesRecipe
          ? { recipe: manifest.variants[n - 1]!.recipe }
          : { edits: manifest.variants[n - 1]!.edits }),
    })),
    rejected: manifest.variants.map((_, i) => i + 1).filter((n) => !ranks.includes(n)).map(fileOf),
  }
  // T0 taste-loop enrichment: measure every rendered variant into the entry (see the ScoreEntry
  // field comment). computeBatchFeatures skips missing/undecodable renders, so an un-rendered
  // batch adds nothing and costs one existsSync per variant.
  const features = computeBatchFeatures(dir, manifest.variants.map((v) => v.file))
  if (Object.keys(features).length > 0) entry.features = features
  // Source-showdown enrichment: carry each variant's source KIND into the entry (see the
  // ScoreEntry field comment — kinds only, a ref clip's path never leaves the batch dir).
  const sources = Object.fromEntries(manifest.variants.filter((v) => v.source !== undefined).map((v) => [v.file, v.source!.kind]))
  if (Object.keys(sources).length > 0) entry.sources = sources
  // Midi-figure showdown batches: carry the figure-source LABEL (see the ScoreEntry field
  // comment — 'midi'/'bank' only, never what the midi transcribes).
  if (manifest.figureSource !== undefined) entry.figureSource = manifest.figureSource
  // Pilot 108: detect a re-score of an already-scored batch BEFORE appending, so the summary can
  // say so — a fat-fingered duplicate otherwise silently contradicts the taste log's history.
  let previousPicks: string | undefined
  if (existsSync(resolvedLog)) {
    const fileToLabel = new Map(manifest.variants.map((v, i) => [v.file, `v${i + 1}`]))
    for (const line of readFileSync(resolvedLog, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const prev = JSON.parse(trimmed) as Partial<ScoreEntry>
        if (prev.batch === dir && Array.isArray(prev.picks)) {
          previousPicks = prev.picks.map((p) => fileToLabel.get(p.variant) ?? p.variant).join(' > ')
        }
      } catch {
        /* non-entry line — ignore */
      }
    }
  }
  appendFileSync(resolvedLog, JSON.stringify(entry) + '\n')
  return { dir, logPath: resolvedLog, manifest, ranks, entry, usesRecipe, usesMedia, ...(previousPicks !== undefined ? { previousPicks } : {}) }
}

/** The human-facing summary both surfaces emit after a score: the scored line plus the
 * adopt-the-winner hint. Feel batches point at `beat adopt`/beat_adopt (a humanize recipe is not
 * replayable via `beat set`, and pilot 101 showed the old `cp ...` hint was unactionable for an
 * MCP-only agent); param batches keep the `beat set` replay, which survives the parent moving on. */
export function formatScoreResult(r: ScoreBatchResult): string {
  let out = `scored ${r.dir}: ${r.ranks.map((n) => `v${n}`).join(' > ')} -> ${r.logPath}\n`
  // Pilot 108: a re-score is legal (changed your mind) but never silent — and say which entry wins.
  if (r.previousPicks !== undefined) {
    out += `note: this batch was already scored (${r.previousPicks}) — the log keeps both, and beat taste-eval uses only the LATEST entry per batch\n`
  }
  // Clip-set batches (T0 taste-loop): the picks ARE the product — they feed the taste log; there
  // is no parent to adopt into and no edits to replay, so say that instead of hinting either.
  if (r.manifest.parent === '') {
    out += `picks recorded for the taste log; a clip-set batch has nothing to adopt — register a keeper with beat sample / beat source add\n`
    return out
  }
  // ==== Phase 40 Stream VB ====
  // A gen winner has no edits to replay and no document to copy — adopt is the ONLY way to take it
  // (it is what registers the sample), so say exactly that rather than offering a `beat set` line.
  if (r.usesMedia) {
    const m = r.entry.picks[0]!.media!
    out += `to adopt the winner (${m.id}, seed ${m.seed ?? '?'}) — this is what registers it into ${r.manifest.parent}: beat adopt ${r.dir} v${r.ranks[0]} (or the beat_adopt tool)\n`
    return out
  }
  // ==== end Phase 40 Stream VB ====
  if (r.usesRecipe) out += `to adopt the winner (${r.entry.picks[0]!.recipe}): beat adopt ${r.dir} v${r.ranks[0]} (or the beat_adopt tool)\n`
  else out += `to adopt the winner: beat adopt ${r.dir} v${r.ranks[0]} (or replay just its edits: beat set ${r.manifest.parent} ${r.entry.picks[0]!.edits!.join(' ')})\n`
  return out
}

// ---- adopt (Phase 35 Stream OC, pilot 101 medium 3) -------------------------------------------
// "A feel winner is unadoptable MCP-only": beat_score's old adopt hint for a feel batch was a
// shell `cp` command no MCP tool could perform. adopt copies the picked variant over the batch's
// parent file through a real verb on both surfaces (`beat adopt` / beat_adopt). Writing the file
// is the whole operation — a running daemon watches the file and hot-reloads it into the GUI.

export interface AdoptResult {
  dir: string
  /** 1-based variant number that was adopted. */
  pick: number
  /** Resolved absolute path of the parent file that was overwritten. */
  parentPath: string
  /** True when the parent's sha256 no longer matched the manifest and force overrode the guard. */
  forced: boolean
  recipe?: string
  edits?: string[]
  // ==== Phase 40 Stream VB ====
  /** Set for a GEN batch: what the deferred registration actually did to the parent. Its presence
   * is what tells formatAdoptResult it adopted a SAMPLE, not a document. */
  media?: RegisterMediaResult
  /** GEN batches: how many candidates the batch held, so the summary can say how many losers were
   * left unregistered — the whole property this stream exists to establish. */
  candidateCount?: number
  // ==== end Phase 40 Stream VB ====
}

/** Copy the picked variant's bytes over the batch's parent .beat file. Data safety: the parent
 * may have moved on since the batch was generated (other edits, another adopt, another session),
 * so if its current sha256 no longer matches the manifest's parentSha256 this REFUSES unless
 * force — adopting a variant grown from a stale parent would silently destroy the newer work. */
export function adoptVariant(dir: string, pick: string, opts: { force?: boolean } = {}): AdoptResult {
  const manifest = readBatchManifest(dir)
  if (manifest.parent === '') {
    throw new BeatBatchError('this is a clip-set batch (arbitrary wavs, no parent .beat) — its picks feed the scores log, but there is nothing to adopt into. Register a wav with beat sample / beat source add instead')
  }
  const n = normalizePick(pick, manifest.variants.length)
  const v = manifest.variants[n - 1]!
  // Phase 40 VB (D21 strain (a)): the variant's own `file` — "vN.beat" for vary, "vN.wav" for gen.
  const variantPath = resolve(dir, v.file)
  if (!existsSync(variantPath)) throw new BeatBatchError(`${v.file} is listed in the manifest but missing from ${dir}`)
  const parentPath = resolveBatchParent(dir, manifest)
  if (!existsSync(parentPath)) {
    throw new BeatBatchError(`cannot find the batch's parent file "${manifest.parent}" (looked at ${parentPath}) — run adopt from the directory vary ran in, or copy the variant by hand`)
  }
  const parentSha = createHash('sha256').update(readFileSync(parentPath, 'utf8')).digest('hex')
  const mismatch = parentSha !== manifest.parentSha256
  if (mismatch && opts.force !== true) {
    // ==== Phase 40 Stream VB ====
    // The guard still applies to a gen adopt — the .beat it registers into must not have moved —
    // but the CONSEQUENCE differs, so the message must too: a gen adopt upserts one media line
    // rather than overwriting the whole document, and the commonest way to trip it is adopting a
    // second candidate from the same batch (the first adopt is itself a change to the parent).
    if (v.media !== undefined) {
      throw new BeatBatchError(
        `${parentPath} has changed since this batch was generated (sha256 ${parentSha.slice(0, 12)}... vs the manifest's ${manifest.parentSha256.slice(0, 12)}...) — ` +
          `it has moved on through other edits (adopting an earlier candidate from this batch is itself such a change). ` +
          `Registering ${v.media.id} into that changed file is probably what you want if you are simply changing your mind about which candidate wins — ` +
          `force it ("beat adopt ... --force" / beat_adopt force:true), which upserts the media entry and leaves every other edit alone`,
      )
    }
    // ==== end Phase 40 Stream VB ====
    throw new BeatBatchError(
      `${parentPath} has changed since this batch was generated (sha256 ${parentSha.slice(0, 12)}... vs the manifest's ${manifest.parentSha256.slice(0, 12)}...) — ` +
        `adopting would overwrite that newer work. Re-vary from the current file, or force the overwrite ("beat adopt ... --force" / beat_adopt force:true)`,
    )
  }
  // ==== Phase 40 Stream VB ====
  // GEN batch: adopt IS the registration (the candidates deliberately touched nothing until now).
  // The prepped bytes are copied verbatim — prep never re-runs, so the winner registers as exactly
  // the audio that was auditioned — and the losers are simply never mentioned again.
  if (v.media !== undefined) {
    return {
      dir,
      pick: n,
      parentPath,
      forced: mismatch,
      media: registerPreppedMedia(parentPath, variantPath, v.media),
      candidateCount: manifest.variants.length,
    }
  }
  // ==== end Phase 40 Stream VB ====
  writeFileSync(parentPath, readFileSync(variantPath, 'utf8'))
  return {
    dir,
    pick: n,
    parentPath,
    forced: mismatch,
    ...(v.recipe !== undefined ? { recipe: v.recipe } : { edits: v.edits ?? [] }),
  }
}

/** The human-facing summary both surfaces emit after an adopt. */
export function formatAdoptResult(r: AdoptResult): string {
  // ==== Phase 40 Stream VB ====
  if (r.media !== undefined) {
    const m = r.media
    const losers = (r.candidateCount ?? 1) - 1
    let out =
      `adopted v${r.pick} -> registered ${m.id} in ${r.parentPath}: sha256:${m.sha256.slice(0, 12)}... ${m.relPath} ` +
      `(${m.durationSeconds}s, ${m.source}, license ${m.license})\n` +
      `provenance sidecar: ${m.relPath}.json\n`
    // Same re-register note the source-add/gen surfaces print (pilot 104): an upsert is silent
    // otherwise, and here it is genuinely likely (re-adopting after changing your mind).
    if (m.reregistered) {
      out += m.reregistered.changed
        ? `note: re-registered ${m.id} (replaced sha256:${m.reregistered.previousSha256.slice(0, 7)}... -> ${m.sha256.slice(0, 7)}...)\n`
        : `note: ${m.id} already registered (unchanged)\n`
    }
    if (r.forced) out += `(forced: the parent had changed since this batch was generated — only ${m.id}'s media entry was touched)\n`
    if (losers > 0) {
      out += losers === 1
        ? `the 1 losing candidate stayed in ${r.dir} and was never registered — delete the dir to forget it\n`
        : `the ${losers} losing candidates stayed in ${r.dir} and were never registered — delete the dir to forget them\n`
    }
    out += `a running daemon/GUI on this file picks the change up automatically; checkpoint to keep it as a version\n`
    return out
  }
  // ==== end Phase 40 Stream VB ====
  const what = r.recipe ?? (r.edits && r.edits.length > 0 ? r.edits.join(', ') : undefined)
  let out = `adopted v${r.pick} -> ${r.parentPath}${what !== undefined ? ` (${what})` : ''}\n`
  if (r.forced) out += `(forced: the parent had changed since this batch was generated — its newer edits are now overwritten)\n`
  out += `a running daemon/GUI on this file picks the change up automatically; checkpoint to keep it as a version\n`
  return out
}
