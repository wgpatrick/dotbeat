// Vary-batch plumbing shared by BOTH agent surfaces (Phase 34 Stream NA, the pilot-95 parity
// lesson): the manifest-write, pick-normalization, score-entry, and batch-render logic that
// `beat vary`/`beat score` (cli/beat.mjs) and `beat_vary`/`beat_score` (src/mcp/server.ts) must
// agree on byte-for-byte. A batch generated on either surface is scored on either surface — the
// manifest.json shape and the beat-scores.jsonl entry shape ARE the contract, so they live here
// once instead of being re-shaped per surface (phase-34-plan.md NA item 5: "extract the shared
// shaping into src/ helpers both surfaces import, so the next drift can't happen").

import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync, symlinkSync, copyFileSync, rmSync, accessSync, constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, serialize, setMediaSample, type BeatDocument } from '../core/index.js'
import { computeBatchFeatures } from '../metrics/features.js'
import { decodeWav, integratedLoudness, truePeak, readWavFormat, wavSampleCodec, type WavFormatInfo } from '../metrics/index.js'

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

// ---- environment faults vs per-batch faults --------------------------------------------------
// Every batch loop in this project (`beat showdown`, `beat taste-collect`'s vary + gen passes,
// `beat prodtask`) is a for-loop with a try/catch that counts a failure, warns, and moves on.
// That is the right shape for a PER-BATCH fault — one bad reference chop, one gen request that
// timed out, one role whose figure bank came up empty. Batch N+1 has different inputs and a fair
// chance of succeeding, so skipping is cheap and correct.
//
// It is exactly the wrong shape for a fault that is a property of the MACHINE or the CHECKOUT.
// `beat showdown` renders each batch by shelling out to cli/render.mjs --batch, which builds ui/
// first. On 2026-07-25 (round 5) and again on 2026-07-26 09:03-09:07 (round 6, first pass), one
// TypeScript error in ui/src/components/ArrangementView.tsx made `npm run build` fail inside
// render.mjs — so all 18 batches of round 5 and all 18 of round 6 failed identically, and each
// time the warning claimed the cause was "fal needs FAL_KEY + network". That hint was
// unconditional on the backend rather than derived from the error, and it sent the investigation
// after a network/credential problem that did not exist, for hours. 36 batches of compute were
// spent proving the same broken build 36 times.
//
// So: when the message matches one of these signatures the caller ABORTS the run instead of
// skipping, because batch N+1 provably cannot succeed where batch N failed for that reason — the
// only fix is a human action outside the loop (build ui/, npm install, npm run build, install a
// venv). A per-batch fault still only skips.
//
// This is a deliberately SMALL allowlist of exact strings the repo's own error sites emit, not a
// heuristic. Anything unrecognized is treated as per-batch, which is the safe default: the cost of
// a missed environment fault is the status quo (a wasted run), while the cost of a false positive
// is aborting a run that would have produced good batches.
const ENVIRONMENT_FAULT_SIGNATURES: { pattern: RegExp; what: string }[] = [
  // cli/render.mjs: `npm run build` in ui/ exited non-zero. The round 5 / round 6 case above.
  { pattern: /the ui\/ build failed/i, what: 'the ui/ build is broken' },
  // cli/render.mjs: ui/ needs building but `npm install` has never run there.
  { pattern: /ui\/node_modules is missing/i, what: 'ui/node_modules is missing' },
  // cli/render.mjs: the served bundle predates engine.pendingMediaCount(), i.e. ui/dist is a stale
  // artifact of this checkout. Every render from it is unverifiable (and probably silent).
  { pattern: /bundle has no engine\.pendingMediaCount/i, what: 'ui/dist is stale' },
  // The compiled repo is missing or half-built: any `await import('../dist/src/...')` in the CLI,
  // or a require inside a sidecar's own child process. Node spells these two ways.
  { pattern: /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/, what: 'dist/ is missing or stale' },
  { pattern: /Cannot find module/i, what: 'dist/ is missing or stale' },
  // src/analysis/{sidecar,gen,stems}.ts, src/taste/{ca2,midifig}.ts all raise this exact phrase
  // via spawnSidecar's `enoent` result — there is no interpreter at the resolved path at all.
  { pattern: /no Python interpreter found/i, what: 'no Python interpreter' },
  // src/analysis/surge.ts SURGE_SETUP_HINT: surgepy is a source build of Surge XT with no wheel,
  // so a missing one is an install task, never something the next batch resolves.
  { pattern: /needs surgepy/i, what: 'surgepy is not installed' },
]

/**
 * Is this failure a property of the machine/checkout rather than of one batch?
 *
 * True means every remaining iteration of the batch loop will hit the identical failure, so the
 * caller should abort the whole run and say why, rather than counting a skip and continuing. See
 * the block comment above for the two rounds of showdown compute that motivated this.
 */
export function isEnvironmentFault(message: string): boolean {
  return ENVIRONMENT_FAULT_SIGNATURES.some((s) => s.pattern.test(message))
}

/** The short reason `isEnvironmentFault` matched on, for the abort message. Null when it didn't. */
export function environmentFaultReason(message: string): string | null {
  return ENVIRONMENT_FAULT_SIGNATURES.find((s) => s.pattern.test(message))?.what ?? null
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
  // midi path as a local reference), 'theory' (the deterministic theory-aware layer,
  // src/taste/theory.ts), 'ca2' (Composer's Assistant 2 composing over that layer's chord track,
  // src/taste/ca2.ts) or 'bank' (the internal archetype bank). scoreBatch copies THIS LABEL ONLY
  // into the shared log — never a song title, artist, or path.
  figureSource?: 'midi' | 'bank' | 'theory' | 'ca2'
  // Showdown/gen batches: WHICH generator produced the `gen` clip — the model id, e.g.
  // 'stable-audio-3', 'lyria2', 'minimax-music', or the bare backend ('fal', 'stub') when no
  // provider was pinned. scoreBatch copies THIS LABEL ONLY, never the prompt.
  genProvider?: string
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

/** Hard floor on UPWARD normalization gain, dB (2026-07-26 eval-integrity hunt, M7). A variant
 * more than this far below the batch median is not "a quiet render" — it is a different signal (a
 * failed render, a tacet stem, a chop that landed in a gap), and boosting it to match raises its
 * noise floor by the same amount, so what the owner rates is materially not what was rendered.
 * Without a floor a -70 LUFS near-silence got +54 dB and entered a blind batch at full level,
 * recorded in the manifest as an ordinary normalization.
 *
 * Calibration (2026-07-26, over the 877 per-variant loudness records in examples/**\/manifest.json,
 * i.e. every batch rated to date): 321 boosts were upward, p50 +4.36 dB, p90 +11.63 dB,
 * p99 +21.58 dB, max +42.01 dB. 18 dB limits 6 of those 321 (1.9%) — the +42.0/+32.8/+23.8/+21.6/
 * +20.5/+19.1 dB outliers — and leaves every boost inside the p99 untouched. Raising it silently
 * re-admits the pathology; lowering it starts capping ordinary quiet renders. Limited variants are
 * flagged `capped` with `capLimit: 'maxBoost'`, exactly like the true-peak ceiling. */
export const NORMALIZE_MAX_BOOST_DB = 18

/** What normalization did to one variant's render — recorded in the manifest (D21: additive
 * optional fields on the one shared manifest shape) so score/audition/training can see it. */
export interface VariantLoudness {
  /** Integrated LUFS of vN.wav as rendered, BEFORE the gain. null = immeasurable (digital
   * silence / nothing above the BS.1770 gates, or a missing/undecodable render) — the file is
   * left untouched. */
  measuredLufs: number | null
  /** The pure gain applied to vN.wav, in dB (0 = left byte-identical). */
  gainDb: number
  /** True when a limit held an upward gain below full normalization — this variant still renders
   * quieter than the batch target. WHICH limit is in `capLimit`. */
  capped: boolean
  /** Which limit bound (only present when `capped`): 'truePeak' = the
   * NORMALIZE_TRUE_PEAK_CEILING_DBTP ceiling, 'maxBoost' = the NORMALIZE_MAX_BOOST_DB floor on
   * upward gain. Absent on entries written before the boost floor existed, where `capped` always
   * meant 'truePeak'. */
  capLimit?: 'truePeak' | 'maxBoost'
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

/** Parse `path`'s wav header through the ONE shared reader (src/metrics/wav.ts) and assert it can
 * actually be gained in place, re-throwing decode failures as BeatBatchError. Split out from
 * applyWavGain so `normalizeBatchLoudness` can validate EVERY file before it writes the first
 * gain (see its all-or-nothing note) — a mid-batch throw used to leave some clips gained and the
 * rest raw, i.e. a level confound in a blind batch that still looked rateable.
 *
 * A zero-length data chunk is an ERROR, not a no-op (2026-07-26 hunt, L3): applying a gain to a
 * headerless/streamed stub used to succeed silently while the manifest recorded a gain that never
 * touched a sample. */
export function assertWavGainable(path: string): void {
  let bytes: Buffer
  try {
    bytes = readFileSync(path)
  } catch (err) {
    throw new BeatBatchError(`${path}: cannot read for gain (${(err as Error).message})`)
  }
  const info = readWavInfoOrThrow(path, bytes)
  if (info.dataLength === 0) throw new BeatBatchError(`${path}: data chunk is empty — refusing to record a gain that would touch no samples`)
  // Writability too: a read-only clip decodes and MEASURES perfectly and only fails at the
  // writeFileSync — i.e. exactly the mid-batch throw the pre-pass exists to prevent.
  try {
    accessSync(path, constants.W_OK)
  } catch {
    throw new BeatBatchError(`${path}: not writable — cannot apply the normalization gain`)
  }
}

function readWavInfoOrThrow(path: string, bytes: Uint8Array): WavFormatInfo {
  try {
    return readWavFormat(bytes)
  } catch (err) {
    throw new BeatBatchError(`${path}: ${(err as Error).message}`)
  }
}

/** Scale every sample of a wav by a pure linear gain, in place on disk — every encoding the
 * shared reader accepts (16/24/32-bit PCM, 32/64-bit float, including WAVE_FORMAT_EXTENSIBLE).
 * Header and any extra chunks are preserved byte-for-byte; only the data chunk changes. Integer
 * samples SATURATE at full scale rather than wrapping. */
export function applyWavGain(path: string, gainDb: number): void {
  const bytes = readFileSync(path)
  const info = readWavInfoOrThrow(path, bytes)
  if (info.dataLength === 0) throw new BeatBatchError(`${path}: data chunk is empty — refusing to record a gain that would touch no samples`)
  const codec = wavSampleCodec(bytes, info)
  const g = Math.pow(10, gainDb / 20)
  const step = info.bytesPerSample
  const end = info.dataOffset + info.dataLength
  for (let p = info.dataOffset; p + step <= end; p += step) codec.write(p, codec.read(p) * g)
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
      ...(v.capLimit !== undefined ? { capLimit: v.capLimit } : {}),
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

  // All-or-nothing (2026-07-26 hunt, H1): every file that could take a gain is header-validated
  // BEFORE the first byte is written. A throw partway through used to leave the earlier clips
  // gained and the rest raw — a level confound baked into a blind batch that still looked
  // perfectly rateable. Now an unreadable clip fails the whole normalization with nothing written.
  for (let i = 1; i <= count; i++) {
    if (measured[i - 1] !== null) assertWavGainable(resolve(outDir, `v${i}.wav`))
  }

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
    let capLimit: 'truePeak' | 'maxBoost' | undefined
    if (gainDb > 0) {
      // Floor the boost first (M7): past NORMALIZE_MAX_BOOST_DB the variant is not quiet, it is
      // broken, and matching it would just amplify its noise floor into the comparison.
      if (gainDb > NORMALIZE_MAX_BOOST_DB) {
        gainDb = NORMALIZE_MAX_BOOST_DB
        capped = true
        capLimit = 'maxBoost'
      }
      // Boosting can push peaks toward clipping — cap the gain so the ESTIMATED true peak
      // (pre-peak + gain: a pure gain shifts true peak by exactly the gain) stays at or below
      // the ceiling. Never cap below 0: a variant already over the ceiling as rendered is the
      // render's business, not normalization's — we just refuse to make it worse. Whichever
      // limit binds TIGHTER is the one named in capLimit.
      const maxUp = NORMALIZE_TRUE_PEAK_CEILING_DBTP - m.truePeakDb
      if (gainDb > maxUp) {
        gainDb = Math.max(0, maxUp)
        capped = true
        capLimit = 'truePeak'
      }
    }
    if (Math.abs(gainDb) >= NORMALIZE_MIN_GAIN_DB) applyWavGain(resolve(outDir, file), gainDb)
    else gainDb = 0
    variants.push({ file, measuredLufs: round2(m.lufs), gainDb: round2(gainDb), capped, ...(capLimit !== undefined ? { capLimit } : {}), truePeakDbtp: round2(m.truePeakDb), wantedGainDb: round2(wantedGainDb) })
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
      // M7: say WHICH limit held the gain back — a floored boost means "this variant is far too
      // quiet to be part of this comparison", which is a different fact from a peak-limited one.
      if (v.capLimit === 'maxBoost') {
        return `v${i + 1} ${fmt(v.gainDb)} dB applied (wanted ${fmt(wanted)}, floored at the +${NORMALIZE_MAX_BOOST_DB} dB max boost — this variant is far below the rest of the batch; check the render)`
      }
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
  /** Which composition source produced the figures, for batches whose variants ARE figures
   * (`beat compose`). Fills the manifest field the score/report layer already reads. */
  figureSource?: 'midi' | 'bank' | 'theory' | 'ca2'
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
    ...(opts.figureSource !== undefined ? { figureSource: opts.figureSource } : {}),
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
 * this in every caller, so audition.wav is built from the normalized renders.
 *
 * THE CHILD'S STDERR IS CAPTURED, NOT INHERITED (2026-07-26). It used to be `stdio: [ignore,
 * ignore, 'inherit']`, which printed the render's real error to the terminal but left it OUT of the
 * Error the parent throws — Node's exec wrapper message is only `Command failed: <node> <render.mjs>
 * --batch <dir>`, carrying none of the child's words. Every caller that classifies a failure was
 * therefore classifying that empty string. Measured, not theorised: with ui/node_modules moved
 * aside, a 3-batch `beat showdown` run printed render.mjs's exact "ui/node_modules is missing" text
 * three times, `isEnvironmentFault` matched NONE of it, and all three batches were counted as
 * ordinary skips with exit code 0 — bit for bit the rounds 5 and 6 failure the environment-fault
 * abort was built to end, still happening after it shipped.
 *
 * The trade is that a long render's progress lines now arrive in one block when the child exits
 * instead of live. That is worth it: the lines are still all printed, in order, and the alternative
 * is an abort guard that provably cannot see the faults it lists. */
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
  const res = spawnSync(process.execPath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  // forward everything the child said, so nothing an operator used to see is lost
  if (res.stderr) process.stderr.write(res.stderr)
  if (res.error) throw res.error
  if (res.status !== 0) {
    const tail = (res.stderr ?? '').trim().split('\n').slice(-RENDER_STDERR_TAIL_LINES).join('\n')
    throw new BeatBatchError(
      `the batch render failed (exit ${res.status ?? 'signal ' + res.signal}) for ${resolve(outDir)}` +
        (tail === '' ? ' — the render printed nothing' : `:\n${tail}`),
    )
  }
  if (opts.normalize === false) return measureBatchLoudness(outDir, count)
  return normalizeBatchLoudness(outDir, count)
}

/** How much of a failed render's stderr travels in the thrown Error. Enough to carry render.mjs's
 * multi-line fatal messages (the ui/node_modules one is 3 lines plus a stack) without pasting a
 * whole render log into a one-line warning. */
const RENDER_STDERR_TAIL_LINES = 40

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
  /** Variant files this batch's D25 holdout must keep OUT of taste-model TRAINING pairs — they
   * are still rated and still ranked held-out, they just never become a training comparison.
   * Two sources, both decided at score time from the batch dir's own manifest: refs-packs ref
   * clips (purchased pro loops whose vendor ToU prohibits ML-training use) and generated clips
   * whose provider ToS bans training on outputs.
   *
   * WHY IT RIDES THE LOG (2026-07-26 eval-integrity hunt, H3): this list used to live ONLY in the
   * batch manifest while the trainable FEATURES lived here — and deleting batch dirs after a round
   * is the documented lifecycle. Delete the dirs and every purchased-loop clip silently became
   * training data, with no error and no visible change. Carrying the file names here leaks nothing
   * `sources` doesn't already (variant file names + kinds; the ref's origin PATH still never
   * leaves the batch dir). Present — possibly EMPTY — on every entry whose batch carries source
   * records, because "checked, nothing excluded" and "written before this existed" must be
   * distinguishable: only the first keeps a training-safe refs-cc0 ref trainable once its dir is
   * gone. BACK-FILL IS IMPOSSIBLE for entries written before this field existed: nothing on disk
   * records which pool a deleted batch's ref came from, so eval.ts treats a ref variant with no
   * manifest and no logged list as UNKNOWN => EXCLUDED. */
  trainingExcluded?: string[]
  /** Ref variants only: which POOL each ref clip came from, keyed by the same variant file names
   * `sources` uses. Its sibling `figureSource` has ridden the log entry since it existed; the ref
   * POOL did not, so every pool-split analysis had to re-read the batch dir's own manifest — and
   * `showdown.ts`'s own tally says as much out loud ("the pool split is computed at report time
   * from the batch dir's own manifest"), skipping any entry whose manifest is gone. Deleting batch
   * dirs after a round is the DOCUMENTED lifecycle, so every historical pool breakdown silently
   * under-counted. This is the same failure the D25 holdout fix (hunt H3) closed for
   * `trainingExcluded` in this same file, and the pool label did not get the same treatment then.
   *
   * Same absent-means-old-entry discipline as `trainingExcluded`: written — possibly EMPTY —
   * on every entry whose batch carries source records, because "looked, no refs in this batch"
   * and "written before this field existed" must stay distinguishable. BACK-FILL IS IMPOSSIBLE
   * for older entries: once the dir is gone nothing on disk records which pool its ref came from.
   *
   * Leaks nothing new: the value is one of five enum labels (see `refPoolOf`) — the ref's origin
   * PATH still never leaves the batch dir, exactly as with `sources`. */
  refPools?: Record<string, RefPool>
  /** Showdown batches only: where the composed figures came from — 'midi' (commercial MIDI
   * transcriptions, private), 'theory' (the deterministic theory-aware layer), 'ca2' (Composer's
   * Assistant 2 over that layer's chord track) or 'bank' (internal archetypes). The label is the
   * ONLY midi-related
   * fact that ever reaches this shared log (the licensing posture): song identity stays in the
   * gitignore-gated batch dir's manifest. Lets the report separate "our sounds with commercial
   * composition" from "our sounds with our composition". */
  figureSource?: 'midi' | 'bank' | 'theory' | 'ca2'
  /** Which generator produced this batch's `gen` clip — the model id ('stable-audio-3', 'lyria2',
   * 'minimax-music', ...) or the bare backend when none was pinned.
   *
   * WHY THIS EXISTS (2026-07-26). `gen` is the second-strongest source in the whole log — 72%
   * pairwise over 185 rated batches, behind only real commercial loops — and until this field
   * NOTHING said which generator earned it: 170 of 188 surviving manifests record only 'fal', 18
   * record nothing, and zero of 266 log lines named a model. So the single best-performing
   * non-reference source was unattributable, and a backend bake-off could not be settled from the
   * evidence we had already paid for. Same shape and same discipline as `figureSource` and
   * `refPools`: one label, copied into the shared log, never the prompt.
   *
   * Leaks nothing the log did not already carry: `sources` already records the KIND ('gen'); this
   * is a sub-label of that kind, exactly as `refPools` is a sub-label of 'ref'. Blindness is
   * unaffected — the log is written AFTER rating.
   *
   * BACK-FILL IS PARTIAL: recoverable from a surviving batch dir's manifest, impossible once the
   * dir is deleted (the documented lifecycle). `scripts/backfill-gen-provider.mjs` does what can
   * be done and reports what cannot. */
  genProvider?: string
  /** "None of these are good" verdict (owner, twice after a showdown batch: nothing deserved a
   * pick, and the only options were picking or silently skipping — which loses the signal). A
   * none-good entry carries `picks: []`, `rejected: [every variant]`, and `verdict: 'none-good'`.
   * The empty picks array is deliberate and load-bearing: every consumer drops empty-picks entries
   * (src/taste/eval.ts loadTasteBatches, src/taste/showdown.ts loadLatestRankedEntries — which
   * showdown, prodtask and pilot all read through), so a none-good batch is EXCLUDED from
   * taste-model training and from the win-rate/pairwise math rather than corrupting either (there
   * is no winner to imply a pairwise comparison from).
   *
   * ORDER MATTERS, and getting it wrong is invisible (2026-07-26 hunt, M3): every loader must
   * apply its latest-entry-per-batch SUPERSEDE first and drop empty picks SECOND. Dropping them at
   * parse time — what all four loaders originally did — means a none-good recorded AFTER a ranking
   * never becomes the batch's latest entry, so the retracted ranking goes on counting and training
   * while the report claims it was excluded.
   *
   * The signal is preserved in two places that read the field directly: the showdown report
   * tallies a `noneGood` count per collection, and the taste log keeps the entry verbatim.
   * Semantics: "all variants rejected, none worth ranking." */
  verdict?: 'none-good'
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

// ---- batch completion marker (2026-07-26 eval-integrity hunt, H2) -----------------------------
// A showdown/prodtask/pilot batch is only comparable once the three CONFOUND-REMOVING steps have
// run: manifest, duration match, loudness normalization. The assembly CLI wrote manifest.json
// FIRST and its failure handler deleted the out-dir only `if (!existsSync(manifest.json))`, so a
// throw in exactly those three steps left behind a dir with a manifest, N clips of mismatched
// length and level, and no record that anything went wrong — `beat rate` queues it and the owner
// rates a broken comparison as if it were a real one.
//
// Chosen fix: an explicit `.complete` marker written LAST, with cleanup gated on IT rather than on
// the manifest. Considered and rejected: writing the manifest last. normalizeBatchLoudness records
// its per-variant loudness INTO the manifest, so deferring the manifest would mean either losing
// that record or staging it under a second filename that every reader would have to know about.
// The marker is additive, inert to every existing reader (`beat rate` still scans for
// manifest.json — untouched, so no sibling surface has to change), and states exactly the fact
// that was missing: "assembly finished".

/** Marker file written into a batch dir once assembly fully succeeded. */
export const BATCH_COMPLETE_MARKER = '.complete'

/** Mark a batch dir fully assembled — call AFTER the last confound-removing step. */
export function markBatchComplete(dir: string): void {
  writeFileSync(
    resolve(dir, BATCH_COMPLETE_MARKER),
    `# batch assembly finished ${new Date().toISOString()} — manifest + duration match + loudness normalization all succeeded.\n` +
      `# A batch dir WITHOUT this marker is half-built: its clips are not level- or length-matched, so rating it would score a confound.\n`,
  )
}

export function isBatchComplete(dir: string): boolean {
  return existsSync(resolve(dir, BATCH_COMPLETE_MARKER))
}

/** The failure-path cleanup every batch-assembly loop shares: delete a batch dir that never
 * reached markBatchComplete, so a half-built batch can never be queued for rating. Best-effort by
 * design — cleanup must never mask the original assembly error. Returns true when it removed one. */
export function discardIncompleteBatch(dir: string): boolean {
  try {
    if (!existsSync(dir) || isBatchComplete(dir)) return false
    rmSync(dir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/** The canonical key for a batch dir in the scores log (2026-07-26 hunt, M1): `resolve`, which
 * collapses `./x`, `x`, `x/` and a bare relative name against the cwd — the four spellings that
 * each used to mint a phantom batch.
 *
 * Deliberately NOT `realpathSync`: `beat rate`'s already-rated dedupe compares its own
 * `resolve(dir)` against `resolve(entry.batch)`, so canonicalizing symlinks HERE and not there
 * would make every batch rated under a symlinked root (e.g. anything below /tmp or /var/folders on
 * macOS) reappear in the rate queue. One rule, both surfaces. */
export function canonicalBatchKey(dir: string): string {
  return resolve(dir)
}

/** The D25 training holdout for one batch, read from its manifest — the ONE definition both the
 * score-time writer (which freezes it into the log entry) and the load-time reader
 * (src/taste/eval.ts, for pre-H3 entries whose dir still exists) use. Two markers:
 *   - a ref clip from the refs-packs pool: purchased pro loops, vendor ToU prohibits ML training;
 *   - an explicit `trainingExcluded` flag on the source or on a gen candidate's provenance
 *     sidecar (providers whose ToS bans training on outputs).
 * Returned in manifest order, deduped. */
export type RefPool = 'ref:familiar' | 'ref:unfamiliar' | 'ref:packs' | 'ref:cc0' | 'ref:other'

/** Classify a ref clip's origin POOL from its manifest `from` path — the taste-dataset convention:
 *
 *   refs-familiar/    chops of songs the owner loves
 *   refs-unfamiliar/  competent-but-unknown tracks
 *   refs-packs/       purchased pro sample-pack loops (the eval bar; D25 holds these out of critic
 *                     training until the vendor's ML clause is verified clean)
 *   refs-cc0/         curated Freesound CC0 loops (training-safe by construction)
 *
 * "my taste is unreachable" and "any commercial track is unreachable" are different findings, which
 * is the whole reason the split is worth carrying.
 *
 * This is the DAW-side definition, and it is deliberately where the refs-packs test that
 * `trainingExcludedFiles` already needed now lives, so this file has ONE pool rule rather than two.
 * `src/taste/showdown.ts` still carries its own `classifyRefPool` twin; `test/ref-pool.test.ts`
 * asserts the two agree on a shared path table, and the follow-up is to delete showdown's copy and
 * import this one (it was owned by a concurrent stream when this landed). */
export function refPoolOf(fromPath: string): RefPool {
  if (/refs-familiar\b/.test(fromPath)) return 'ref:familiar'
  if (/refs-unfamiliar\b/.test(fromPath)) return 'ref:unfamiliar'
  if (/refs-packs\b/.test(fromPath)) return 'ref:packs'
  if (/refs-cc0\b/.test(fromPath)) return 'ref:cc0'
  return 'ref:other'
}

/** Every ref variant's pool, keyed by variant file — what `ScoreEntry.refPools` freezes into the
 * log so the split outlives the batch dir. Non-ref variants are absent, not 'ref:other'. */
export function refPoolsOf(manifest: VaryBatchManifest): Record<string, RefPool> {
  const out: Record<string, RefPool> = {}
  for (const v of manifest.variants ?? []) {
    if (typeof v.file !== 'string') continue
    const source = v.source as { kind?: string; from?: string } | undefined
    if (source?.kind !== 'ref' || typeof source.from !== 'string') continue
    out[v.file] = refPoolOf(source.from)
  }
  return out
}

export function trainingExcludedFiles(manifest: VaryBatchManifest): string[] {
  const out: string[] = []
  for (const v of manifest.variants ?? []) {
    if (typeof v.file !== 'string') continue
    const source = v.source as { kind?: string; from?: string; trainingExcluded?: boolean } | undefined
    const media = v.media as (VariantMedia & { sidecar?: { generated?: { trainingExcluded?: boolean } } }) | undefined
    const refsPack = source?.kind === 'ref' && typeof source.from === 'string' && refPoolOf(source.from) === 'ref:packs'
    const banned = source?.trainingExcluded === true || media?.sidecar?.generated?.trainingExcluded === true
    if ((refsPack || banned) && !out.includes(v.file)) out.push(v.file)
  }
  return out
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
  // ONE physical batch dir is ONE batch, however the caller spelled it (2026-07-26 hunt, M1).
  // The entry used to store the raw argument, so `./x`, `x`, `/abs/x` and `x/` each created a
  // PHANTOM batch: the re-score note never fired, the showdown report counted one board up to four
  // times, and taste-eval built a fold per spelling out of contradictory rankings of the same
  // clips. Resolving here makes the key canonical at write time (pilot-108's corruption, reachable
  // from an ordinary `cd` into the collection root between two ratings).
  const batchKey = canonicalBatchKey(dir)
  // NB: the log path deliberately uses plain `resolve`, not the canonical key — canonicalization
  // is for the log's batch KEY, and routing the default log through realpath would rename it
  // (/var -> /private/var on macOS) for every existing collection.
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
    batch: batchKey,
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
  // D25 holdout (hunt H3): the exclusion list must outlive the batch dir — see the field comment.
  // Written whenever the batch HAS source records, empty list included: "the scorer looked and
  // found nothing to exclude" is a different fact from "this entry predates the field", and only
  // the first lets a training-safe ref (refs-cc0) stay trainable after its dir is deleted.
  if (Object.keys(sources).length > 0) entry.trainingExcluded = trainingExcludedFiles(manifest)
  // D12: freeze the ref POOL split into the entry, on the same trigger and with the same
  // absent-means-old-entry discipline as trainingExcluded above — see the field comment. An empty
  // object on a ref-less batch is the point, not noise.
  if (Object.keys(sources).length > 0) entry.refPools = refPoolsOf(manifest)
  // Midi-figure showdown batches: carry the figure-source LABEL (see the ScoreEntry field
  // comment — 'midi'/'bank' only, never what the midi transcribes).
  if (manifest.figureSource !== undefined) entry.figureSource = manifest.figureSource
  if (manifest.genProvider !== undefined) entry.genProvider = manifest.genProvider
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
        // match on the RESOLVED path, and re-resolve legacy entries written before that was the
        // rule so a re-score of an already-scored batch is still recognized as one
        const sameBatch = typeof prev.batch === 'string' && (prev.batch === batchKey || canonicalBatchKey(prev.batch) === batchKey)
        if (sameBatch && Array.isArray(prev.picks)) {
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

export interface NoneGoodResult {
  dir: string
  logPath: string
  manifest: VaryBatchManifest
  entry: ScoreEntry
}

/** Record a "none of these are good" verdict against a batch dir — the owner finished the batch
 * and nothing deserved a pick (recorded instead of silently skipping, which loses the signal).
 * Writes ONE append-only entry shaped exactly like a `scoreBatch` entry but with `picks: []`,
 * `rejected: [every variant]`, and `verdict: 'none-good'`. Same log resolution, same feature /
 * source / figure-source enrichment as scoreBatch, so the entry is fully self-describing for the
 * report. The empty picks array is what makes the existing load-time guards exclude it from the
 * taste model and the win-rate math (see the ScoreEntry.verdict comment) — no consumer change is
 * needed for the exclusion; only the report's own none-good tally reads the field. */
export function recordNoneGood(dir: string, logPath?: string): NoneGoodResult {
  const manifest = readBatchManifest(dir)
  const batchKey = canonicalBatchKey(dir) // same canonical batch key scoreBatch writes — see M1 there
  // NB: the log path deliberately uses plain `resolve`, not the canonical key — canonicalization
  // is for the log's batch KEY, and routing the default log through realpath would rename it
  // (/var -> /private/var on macOS) for every existing collection.
  const resolvedLog = logPath ?? (manifest.parent === '' ? resolve(dirname(resolve(dir)), DEFAULT_SCORES_LOG) : defaultScoresLog(resolveBatchParent(dir, manifest)))
  const allFiles = manifest.variants.map((v) => v.file)
  const entry: ScoreEntry = {
    t: new Date().toISOString(),
    batch: batchKey,
    ...(manifest.track !== undefined ? { track: manifest.track } : {}),
    group: manifest.group,
    amount: manifest.amount,
    seed: manifest.seed,
    parentSha256: manifest.parentSha256,
    ...(manifest.prompt !== undefined ? { prompt: manifest.prompt } : {}),
    picks: [],
    rejected: allFiles,
    verdict: 'none-good',
  }
  // Same enrichment scoreBatch does — the entry stays self-describing (a report reading the
  // none-good count still wants to know which sources were on the table).
  const features = computeBatchFeatures(dir, allFiles)
  if (Object.keys(features).length > 0) entry.features = features
  const sources = Object.fromEntries(manifest.variants.filter((v) => v.source !== undefined).map((v) => [v.file, v.source!.kind]))
  if (Object.keys(sources).length > 0) entry.sources = sources
  if (Object.keys(sources).length > 0) entry.trainingExcluded = trainingExcludedFiles(manifest) // see scoreBatch
  if (Object.keys(sources).length > 0) entry.refPools = refPoolsOf(manifest) // see scoreBatch
  if (manifest.figureSource !== undefined) entry.figureSource = manifest.figureSource
  if (manifest.genProvider !== undefined) entry.genProvider = manifest.genProvider
  appendFileSync(resolvedLog, JSON.stringify(entry) + '\n')
  return { dir, logPath: resolvedLog, manifest, entry }
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
