// Phase 38 Stream SA — the analysis-artifact LOADER (docs/phase-38-plan.md §SA). The counterpart
// to src/analysis/structure.ts: where that module reads a .beat document's SYMBOLIC arrangement,
// this one reads a `*.analysis.json` artifact (tempo/beats/downbeats/sections detected from a real
// audio file by the Python sidecar) and scaffolds a structure-matched empty .beat to write into.
//
// THE SECONDS-VS-BARS BOUNDARY LIVES HERE. The frozen artifact contract is expressed entirely in
// SECONDS (beats, downbeats, section start/end) — bars never appear in the JSON. This module owns
// ALL of the seconds→bars math: `barSeconds` (from the downbeat grid, or `4*60/bpm` as a fallback),
// the per-section `Math.round((end-start)/barSeconds)` conversion, the >64-bar chunking that keeps
// every song entry inside setSong's 1–64 cap, and the empty-sections uniform-chunk fallback. The
// document that comes out the far side is pure bars/steps, like every other .beat — no caller
// downstream ever has to think in seconds again.
//
// `validateAnalysisArtifact` is the sole validation authority for the contract (SB's sidecar does
// only a light shape-check on the sidecar's stdout core before wrapping it — it does NOT re-check
// these rules). Every rejection throws the existing BeatAnalysisError with a message that names
// what was wrong, so a stale/hand-edited artifact fails loudly rather than scaffolding garbage.

import type { BeatDocument } from '../core/index.js'
import { initDocument, setScene, setSong } from '../core/index.js'
import { BeatAnalysisError } from './structure.js'

// ---- the frozen contract, as TypeScript ------------------------------------------------------

/** One detected section of the source audio, in SECONDS. `label` is the backend's structural tag
 * (intro/verse/chorus/…) or null when the backend emits sections without labels. */
export interface AnalysisSection {
  start: number // seconds from the start of the source audio
  end: number // seconds; > start
  label: string | null
}

/** A `*.analysis.json` artifact — the frozen contract between the Python sidecar (emits the core in
 * seconds), the TS envelope wrapper (adds source/generatedAt/bpm), and this loader. Seconds
 * throughout; bars never appear. See docs/phase-38-plan.md §"analysis.json contract". */
export interface AnalysisArtifact {
  dotbeatAnalysis: 1 // the artifact schema version; an unknown value means a newer dotbeat wrote it
  source: { file: string; sha256: string; durationSeconds: number }
  backend: { name: string; version: string; model: string | null }
  generatedAt: string // ISO-8601
  bpm: number // finite, in (20, 400)
  bpmMethod: 'backend' | 'median-ibi' // reported by the backend, or derived from median inter-beat interval
  beats: number[] // seconds, >= 0, sorted ascending
  downbeats: number[] // seconds, >= 0, sorted ascending; MAY be empty
  sections: AnalysisSection[] // MAY be empty; each start<end, non-overlapping, sorted ascending
}

// ---- validation ------------------------------------------------------------------------------

const HEX64 = /^[0-9a-f]{64}$/

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Validates a finite, ascending-sorted array of non-negative seconds. Throws BeatAnalysisError
 * naming `what` on the first violation. Empty arrays are legal (the caller distinguishes which
 * lists may be empty — downbeats may; the contract itself only pins ordering and finiteness). */
function validateSecondsArray(raw: unknown, what: string): number[] {
  if (!Array.isArray(raw)) throw new BeatAnalysisError(`${what} must be an array of seconds`)
  for (let i = 0; i < raw.length; i++) {
    const n = raw[i]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      throw new BeatAnalysisError(`${what}[${i}] must be a finite number of seconds >= 0, got ${String(n)}`)
    }
    if (i > 0 && n < (raw[i - 1] as number)) {
      throw new BeatAnalysisError(`${what} must be sorted ascending — ${what}[${i}] (${n}) < ${what}[${i - 1}] (${String(raw[i - 1])})`)
    }
  }
  return raw as number[]
}

/** Parses/validates an unknown value as an AnalysisArtifact per the frozen contract, throwing
 * BeatAnalysisError with a specific message on the first violation. Unknown top-level keys are
 * ignored (the contract grows additively under version bumps). This is the ONLY place the contract
 * rules are enforced. */
export function validateAnalysisArtifact(raw: unknown): AnalysisArtifact {
  if (!isObject(raw)) throw new BeatAnalysisError('analysis artifact must be a JSON object')

  if (raw.dotbeatAnalysis !== 1) {
    if (typeof raw.dotbeatAnalysis === 'number' && Number.isInteger(raw.dotbeatAnalysis) && raw.dotbeatAnalysis > 1) {
      throw new BeatAnalysisError(`analysis artifact is version ${raw.dotbeatAnalysis} — a newer dotbeat needed to read it (this build understands version 1)`)
    }
    throw new BeatAnalysisError(`analysis artifact missing "dotbeatAnalysis": 1 (got ${JSON.stringify(raw.dotbeatAnalysis)})`)
  }

  // source
  if (!isObject(raw.source)) throw new BeatAnalysisError('analysis artifact "source" must be an object')
  const source = raw.source
  if (typeof source.file !== 'string' || source.file === '') throw new BeatAnalysisError('source.file must be a non-empty string')
  if (typeof source.sha256 !== 'string' || !HEX64.test(source.sha256)) {
    throw new BeatAnalysisError(`source.sha256 must be a 64-character lowercase hex string, got ${JSON.stringify(source.sha256)}`)
  }
  if (typeof source.durationSeconds !== 'number' || !Number.isFinite(source.durationSeconds) || source.durationSeconds <= 0) {
    throw new BeatAnalysisError(`source.durationSeconds must be a finite number > 0, got ${String(source.durationSeconds)}`)
  }

  // backend
  if (!isObject(raw.backend)) throw new BeatAnalysisError('analysis artifact "backend" must be an object')
  const backend = raw.backend
  if (typeof backend.name !== 'string' || backend.name === '') throw new BeatAnalysisError('backend.name must be a non-empty string')
  if (typeof backend.version !== 'string') throw new BeatAnalysisError('backend.version must be a string')
  if (backend.model !== null && typeof backend.model !== 'string') throw new BeatAnalysisError('backend.model must be a string or null')

  if (typeof raw.generatedAt !== 'string' || raw.generatedAt === '') throw new BeatAnalysisError('generatedAt must be an ISO-8601 string')

  if (typeof raw.bpm !== 'number' || !Number.isFinite(raw.bpm) || raw.bpm <= 20 || raw.bpm >= 400) {
    throw new BeatAnalysisError(`bpm must be a finite number in (20, 400), got ${String(raw.bpm)}`)
  }
  if (raw.bpmMethod !== 'backend' && raw.bpmMethod !== 'median-ibi') {
    throw new BeatAnalysisError(`bpmMethod must be "backend" or "median-ibi", got ${JSON.stringify(raw.bpmMethod)}`)
  }

  const beats = validateSecondsArray(raw.beats, 'beats')
  const downbeats = validateSecondsArray(raw.downbeats, 'downbeats')

  // sections
  if (!Array.isArray(raw.sections)) throw new BeatAnalysisError('sections must be an array (possibly empty)')
  const sections: AnalysisSection[] = []
  let prevEnd = -Infinity
  for (let i = 0; i < raw.sections.length; i++) {
    const s = raw.sections[i]
    if (!isObject(s)) throw new BeatAnalysisError(`sections[${i}] must be an object`)
    if (typeof s.start !== 'number' || !Number.isFinite(s.start) || s.start < 0) {
      throw new BeatAnalysisError(`sections[${i}].start must be a finite number of seconds >= 0, got ${String(s.start)}`)
    }
    if (typeof s.end !== 'number' || !Number.isFinite(s.end) || s.end <= s.start) {
      throw new BeatAnalysisError(`sections[${i}].end must be a finite number > start (${s.start}), got ${String(s.end)}`)
    }
    if (s.label !== null && typeof s.label !== 'string') {
      throw new BeatAnalysisError(`sections[${i}].label must be a string or null, got ${JSON.stringify(s.label)}`)
    }
    if (s.start < prevEnd) {
      throw new BeatAnalysisError(`sections must be sorted and non-overlapping — sections[${i}] starts at ${s.start} but the previous section ends at ${prevEnd}`)
    }
    prevEnd = s.end
    sections.push({ start: s.start, end: s.end, label: s.label as string | null })
  }

  return {
    dotbeatAnalysis: 1,
    source: { file: source.file, sha256: source.sha256, durationSeconds: source.durationSeconds },
    backend: { name: backend.name, version: backend.version, model: backend.model as string | null },
    generatedAt: raw.generatedAt,
    bpm: raw.bpm,
    bpmMethod: raw.bpmMethod,
    beats,
    downbeats,
    sections,
  }
}

// ---- seconds -> bars -------------------------------------------------------------------------

/** One resolved song entry: a scene id (a distinct scene per distinct label; repeated across a
 * section's >64-bar chunks and across sections that reuse the label), its bar length (always in
 * setSong's 1–64 range), the section's source label, and the section's source start in seconds
 * (carried so the CLI/MCP can print a "where did this come from" table). */
export interface SongEntry {
  scene: string
  bars: number
  label: string | null
  startSeconds: number
}

interface DerivedResult {
  entries: SongEntry[]
  dropped: { startSeconds: number; label: string | null }[] // sections that rounded to 0 bars
}

/** Median of a non-empty numeric list. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** Seconds per bar: the median inter-downbeat interval when there are >= 2 downbeats (robust to
 * tempo drift and to a backend whose global bpm is a rounded average), else `4 * 60 / bpm` (a
 * 4/4 bar at the reported tempo — the engine is constant-4/4). */
function barSecondsOf(artifact: AnalysisArtifact): number {
  if (artifact.downbeats.length >= 2) {
    const diffs: number[] = []
    for (let i = 1; i < artifact.downbeats.length; i++) diffs.push(artifact.downbeats[i]! - artifact.downbeats[i - 1]!)
    const m = median(diffs)
    if (m > 0) return m
  }
  return (4 * 60) / artifact.bpm
}

/** Splits a section's bar count into setSong-legal chunks. <= 64 stays whole; anything larger is
 * cut into repeated 32-bar entries of the same scene with the remainder last (e.g. 70 -> 32+32+6),
 * so a long detected section becomes several plays of one scene rather than an illegal >64 entry. */
function chunkBars(bars: number): number[] {
  if (bars <= 64) return [bars]
  const chunks: number[] = []
  let rem = bars
  while (rem > 32) {
    chunks.push(32)
    rem -= 32
  }
  if (rem > 0) chunks.push(rem)
  return chunks
}

/** Sanitizes a raw label to a legal scene id fragment: lowercase, spaces->'-', every other
 * character stripped. May return '' (a label of only punctuation) — callers treat that like an
 * absent label. */
function sanitizeLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '')
}

/** Returns `base` if free, else `base-2`, `base-3`, … — and records the chosen id as used. */
function uniqueSceneId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let n = 2
  while (used.has(`${base}-${n}`)) n++
  const id = `${base}-${n}`
  used.add(id)
  return id
}

function resolveSectionBars(opts: { sectionBars?: number }): number {
  const sectionBars = opts.sectionBars ?? 8
  if (!Number.isInteger(sectionBars) || sectionBars < 1 || sectionBars > 64) {
    throw new BeatAnalysisError(`--section-bars must be an integer 1-64, got ${String(opts.sectionBars)}`)
  }
  return sectionBars
}

/** The whole seconds->bars derivation, returning both the kept ordered entries and the sections
 * that rounded to 0 bars (so buildSkeleton can report them). `artifactToSections` is the public,
 * drop-silent view of this; buildSkeleton uses the richer result. */
function deriveSongEntries(artifact: AnalysisArtifact, opts: { sectionBars?: number }): DerivedResult {
  const sectionBars = resolveSectionBars(opts)
  const barSeconds = barSecondsOf(artifact)
  const entries: SongEntry[] = []
  const dropped: { startSeconds: number; label: string | null }[] = []

  // Empty sections (e.g. a pure Beat This artifact): uniform-chunk fallback so skeleton ALWAYS
  // works on a beats-only artifact. Total bars = downbeat count (each downbeat starts a bar), or a
  // duration/barSeconds estimate when there are no downbeats either. Cut into `sectionBars` chunks
  // named part-1..n, remainder last; each part is its own scene (no honest basis to claim two
  // unlabeled chunks are the same material).
  if (artifact.sections.length === 0) {
    const totalBars = artifact.downbeats.length > 0 ? artifact.downbeats.length : Math.round(artifact.source.durationSeconds / barSeconds)
    let remaining = totalBars
    let part = 1
    let cumBars = 0
    while (remaining > 0) {
      const bars = Math.min(sectionBars, remaining)
      entries.push({ scene: `part-${part}`, bars, label: null, startSeconds: cumBars * barSeconds })
      remaining -= bars
      cumBars += bars
      part++
    }
    return { entries, dropped }
  }

  // Labelled (or unlabeled-with-boundaries) sections: one scene per DISTINCT raw label; null/empty
  // labels each get their own per-section `section-<n>` scene (no reuse across nulls).
  const labelToScene = new Map<string, string>()
  const used = new Set<string>()
  artifact.sections.forEach((sec, i) => {
    const bars = Math.round((sec.end - sec.start) / barSeconds)
    if (bars <= 0) {
      dropped.push({ startSeconds: sec.start, label: sec.label })
      return
    }
    const raw = sec.label
    let scene: string
    const base = raw !== null && raw !== '' ? sanitizeLabel(raw) : ''
    if (base !== '') {
      const existing = labelToScene.get(raw!)
      if (existing !== undefined) {
        scene = existing
      } else {
        scene = uniqueSceneId(base, used)
        labelToScene.set(raw!, scene)
      }
    } else {
      scene = uniqueSceneId(`section-${i + 1}`, used)
    }
    for (const chunk of chunkBars(bars)) {
      entries.push({ scene, bars: chunk, label: raw, startSeconds: sec.start })
    }
  })
  return { entries, dropped }
}

/** Converts an artifact's detected sections into the ORDERED list of song entries (a scene may
 * repeat). ALL of the seconds->bars math lives here (see the module header): barSeconds derivation,
 * per-section rounding, the round-to-0 DROP (a dropped section is simply absent from the returned
 * list), the >64-bar SPLIT into 32-bar chunks, the empty-sections uniform-chunk fallback, and the
 * one-scene-per-distinct-label id assignment. Pure and file-free, so it unit-tests directly. */
export function artifactToSections(artifact: AnalysisArtifact, opts: { sectionBars?: number } = {}): SongEntry[] {
  return deriveSongEntries(artifact, opts).entries
}

// ---- skeleton assembly -----------------------------------------------------------------------

/** The per-entry row of a skeleton report — what the CLI/MCP print as a section table. */
export interface SkeletonReportSection {
  index: number
  scene: string
  bars: number
  startSeconds: number
  label: string | null
}

/** What buildSkeleton returns alongside the document, for the CLI/MCP to format. */
export interface SkeletonReport {
  sections: SkeletonReportSection[]
  droppedNotes: string[] // human notes for sections that rounded to 0 bars
  detectedBpm: number // the artifact's raw bpm
  roundedBpm: number // Math.round(detectedBpm) — what the document actually uses
}

/** Assembles a structure-matched EMPTY .beat document from a validated artifact: `initDocument`
 * (integer bpm), one empty scene per distinct scene id, and a song block of the ordered entries.
 * The starter `lead` track from initDocument is kept — scenes are minted empty for the caller to
 * fill (beat clip / beat place). Returns the document plus a report for the section table. */
export function buildSkeleton(artifact: AnalysisArtifact, opts: { sectionBars?: number } = {}): { doc: BeatDocument; report: SkeletonReport } {
  const roundedBpm = Math.round(artifact.bpm)
  const { entries, dropped } = deriveSongEntries(artifact, opts)

  let doc = initDocument({ bpm: roundedBpm })
  const distinctScenes: string[] = []
  const seen = new Set<string>()
  for (const e of entries) {
    if (!seen.has(e.scene)) {
      seen.add(e.scene)
      distinctScenes.push(e.scene)
    }
  }
  for (const id of distinctScenes) doc = setScene(doc, id, {})
  doc = setSong(doc, entries.map((e) => ({ scene: e.scene, bars: e.bars })))

  const report: SkeletonReport = {
    sections: entries.map((e, index) => ({ index, scene: e.scene, bars: e.bars, startSeconds: e.startSeconds, label: e.label })),
    droppedNotes: dropped.map((d) => `skipped 1 sub-bar section at ${d.startSeconds.toFixed(1)}s${d.label ? ` (${d.label})` : ''}`),
    detectedBpm: artifact.bpm,
    roundedBpm,
  }
  return { doc, report }
}

/** Formats a skeleton report as the human-readable block both `beat skeleton` and `beat_skeleton`
 * print — the tempo line, the section table (index / scene / bars / source start-seconds), any
 * dropped-section notes, and a next-step hint. Single source of truth so the two surfaces agree. */
export function formatSkeletonReport(report: SkeletonReport, outFile: string): string {
  const lines: string[] = []
  lines.push(`created ${outFile}`)
  lines.push(`tempo ${report.roundedBpm} (detected ${report.detectedBpm})`)
  if (report.sections.length === 0) {
    lines.push('(no sections — the artifact produced no bars to scaffold)')
  } else {
    lines.push('  #  scene              bars  start')
    for (const s of report.sections) {
      lines.push(`  ${String(s.index).padStart(2)}  ${s.scene.padEnd(17)}  ${String(s.bars).padStart(4)}  ${s.startSeconds.toFixed(2)}s`)
    }
  }
  for (const note of report.droppedNotes) lines.push(note)
  const sceneCount = new Set(report.sections.map((s) => s.scene)).size
  if (sceneCount > 0) lines.push(`next: beat clip / beat place to fill the ${sceneCount} scene(s) with content`)
  return lines.join('\n')
}
