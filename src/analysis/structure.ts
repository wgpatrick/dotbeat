// Phase 37 Stream RB — symbolic song analysis (docs/phase-37-plan.md §RB). Pure, deterministic
// functions over a .beat document's notes/hits/scenes/placements — NO rendering, no audio, no DSP.
//
// Where `src/metrics/` measures a *rendered WAV* (LUFS, spectral balance — what the mix sounds
// like), this module reads the *symbolic arrangement* (what's actually written): how dense each
// section is, how syncopated, which pitch classes it uses relative to the declared scale, and how
// the sections repeat and vary across the song. It feeds two consumers: `beat feedback`'s
// arrangement-level critique (Stream RA appends this symbolic section to its audio energy-arc), and
// Phase 38's audio-structure import, which will emit its detected sections into these same types —
// so the shapes here are deliberately clean and reusable, not tailored to one caller.
//
// The core tiling model (metric 1): a section plays a scene for `bars` bars, and each track's clip
// TILES to fill that span. One tile is `clip.loop ? (clip.loop.end - clip.loop.start) : doc.loopBars`
// bars wide (a clip-level loop override wins over the document loop length — same precedence the
// engine uses); the section holds `sectionBars / tileBars` such tiles. So a 1-bar clip with 4 kicks,
// tiled across a 4-bar section, sounds 16 onsets. See analyzeStructure below.

import type {
  BeatClip,
  BeatDocument,
  BeatScene,
  BeatTimeSignature,
  BeatTrack,
  TrackKind,
} from '../core/index.js'
import { SCALES, SCALE_NAMES, firstPlacementClip } from '../core/index.js'

export class BeatAnalysisError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BeatAnalysisError'
  }
}

const STEPS_PER_BAR = 16 // 16th-note steps per bar (constant-4/4 engine — see document.ts)

/** A 12-bin pitch-class histogram over a set of notes, plus (when a scale is supplied) the fraction
 * of those notes that land in that scale. Counts are per-TILE (one loop's worth of content) — the
 * proportions and the `inScale` fraction are tiling-invariant, so tiling would only scale every bin
 * by the same factor. `inScale` is null in scale-agnostic mode (no `scale` passed to analyzeStructure). */
export interface PitchClassProfile {
  counts: number[] // length 12; counts[pc] = notes with pitch class pc (0=C, 1=C#, … 11=B)
  total: number // total notes counted (== sum of counts)
  inScale: number | null // fraction (0..1) of notes whose pitch class is in the declared scale; null if scale-agnostic
}

/** One track's symbolic content within one section — the per-track half of metric 1/2/3. */
export interface TrackContentStats {
  trackId: string
  kind: TrackKind
  clipId: string | null // the clip resolved via firstPlacementClip, or null if this track has no placement in the scene
  onsets: number // total note/hit onsets sounded across the whole section (tiled); 0 for audio/empty
  onsetsPerBar: number // onsets / sectionBars — density independent of section length
  syncopation: number // fraction (0..1) of this track's onsets that are OFF the quarter grid; 0 when it has none
  pitchClass: PitchClassProfile | null // null for drum/audio tracks (no pitched notes)
}

/** One section of the song timeline (one entry of `doc.song`), fully analyzed. */
export interface SectionAnalysis {
  index: number // 0-based position in the song
  scene: string // the scene id this section plays
  bars: number // how many bars the section runs
  startBar: number // cumulative bar offset where this section begins
  tracks: TrackContentStats[] // per-track stats, in document track order (only tracks with a placement)
  onsets: number // section total across all tracks (tiled)
  onsetsPerBar: number // section total / bars
  syncopation: number // fraction (0..1) of ALL the section's onsets that are off the quarter grid
  pitchClass: PitchClassProfile | null // aggregate over every pitched track's notes; null if the section has no pitched notes
  signature: BeatTimeSignature | null // the first non-4/4 clip signature among the section's playing clips (metadata only — the engine is 4/4)
}

/** A later section that exactly repeats an earlier one (identical content signature — same set of
 * `trackId:clipId` placements). `repeatOf` is the EARLIEST such earlier section. */
export interface SectionRepeat {
  index: number
  repeatOf: number
}

/** The whole-song result. `similarity` is the pairwise Jaccard matrix of section content signatures
 * (1 on the diagonal; Jaccard(∅,∅) is defined as 1 — two empty sections are identical). */
export interface StructureAnalysis {
  sections: SectionAnalysis[]
  totalBars: number
  similarity: number[][] // N×N, similarity[i][j] = Jaccard(sig_i, sig_j)
  repeats: SectionRepeat[] // later sections that exactly repeat an earlier one
  novelSections: number[] // indices whose content signature first appears at that section (incl. the first of every distinct set)
  scale: { root: number; name: string } | null // the resolved scale (echoing the options), or null in scale-agnostic mode
}

export interface AnalyzeStructureOptions {
  /** Tonic pitch class 0-11 (0=C). Only used together with `scale`. */
  root?: number
  /** A scale name from core's SCALES table (major, minor, dorian, …). Unknown names throw. Omit for
   * scale-agnostic analysis (pitch-class histograms with `inScale: null`). */
  scale?: string
}

// ---- tiling / window helpers -----------------------------------------------------------------

/** The clip-local step window that tiles, and how many bars wide one tile is. A clip-level loop
 * override (BeatClipLoop, in bars) wins over doc.loopBars — the same precedence the engine uses. */
function tileWindow(doc: BeatDocument, clip: BeatClip): { start: number; end: number; tileBars: number } {
  if (clip.loop) {
    return { start: clip.loop.start * STEPS_PER_BAR, end: clip.loop.end * STEPS_PER_BAR, tileBars: clip.loop.end - clip.loop.start }
  }
  return { start: 0, end: doc.loopBars * STEPS_PER_BAR, tileBars: doc.loopBars }
}

/** The note/hit onset start-steps of a clip (synth/instrument → notes, drums → hits, audio → none). */
function clipOnsetStarts(clip: BeatClip, kind: TrackKind): number[] {
  if (kind === 'drums') return clip.hits.map((h) => h.start)
  if (kind === 'synth' || kind === 'instrument') return clip.notes.map((n) => n.start)
  return [] // audio: one region, no discrete symbolic onsets
}

/** A step is "on the quarter grid" iff it's an exact integer multiple of 4 sixteenth-steps (steps
 * 0,4,8,12 — the four quarter notes of a bar). Everything else — off-grid eighths/sixteenths and any
 * fractional (humanized) start — is syncopated. */
function offQuarterGrid(step: number): boolean {
  return !(Number.isInteger(step) && step % 4 === 0)
}

// ---- pitch-class profile ---------------------------------------------------------------------

function pitchClassProfile(pitches: number[], root: number | undefined, scaleSet: readonly number[] | undefined): PitchClassProfile {
  const counts = new Array<number>(12).fill(0)
  for (const p of pitches) counts[((p % 12) + 12) % 12]!++
  const total = pitches.length
  let inScale: number | null = null
  if (root !== undefined && scaleSet) {
    if (total === 0) {
      inScale = 0
    } else {
      let hit = 0
      for (const p of pitches) if (scaleSet.includes(((p - root) % 12 + 12) % 12)) hit++
      inScale = hit / total
    }
  }
  return { counts, total, inScale }
}

// ---- content signature (repetition / novelty, metric 4) --------------------------------------

/** A section's content signature: the sorted set of `trackId:clipId` for each track that has a
 * playing placement in the scene. Two sections are "the same" iff their signatures are equal. */
function sectionSignature(scene: BeatScene, tracks: readonly BeatTrack[]): string[] {
  const sig: string[] = []
  for (const t of tracks) {
    const clipId = firstPlacementClip(scene.slots, t.id)
    if (clipId) sig.push(`${t.id}:${clipId}`)
  }
  return sig.sort()
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a)
  const sb = new Set(b)
  if (sa.size === 0 && sb.size === 0) return 1 // two empty sections are identical
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  const union = sa.size + sb.size - inter
  return union === 0 ? 1 : inter / union
}

// ---- the analysis ----------------------------------------------------------------------------

/** Analyze the symbolic structure of a .beat document's arranged song. Loop-mode documents (no song
 * block, `doc.song === null`) have no sections to analyze: `sections` is [] and `totalBars` is the
 * document loop length. Passing an unknown `scale` throws BeatAnalysisError. */
export function analyzeStructure(doc: BeatDocument, opts: AnalyzeStructureOptions = {}): StructureAnalysis {
  const { root, scale: scaleName } = opts
  let scaleSet: readonly number[] | undefined
  if (scaleName !== undefined) {
    const found = SCALES[scaleName]
    if (!found) throw new BeatAnalysisError(`unknown scale "${scaleName}" (have: ${SCALE_NAMES.join(', ')})`)
    scaleSet = found
  }
  if (scaleSet && (root === undefined || !Number.isInteger(root) || root < 0 || root > 11)) {
    throw new BeatAnalysisError(`--scale needs a root pitch class 0-11 (0=C); got root ${String(root)}`)
  }
  const scale = scaleSet ? { root: root!, name: scaleName! } : null

  const sceneById = new Map(doc.scenes.map((s) => [s.id, s]))

  if (!doc.song) {
    return { sections: [], totalBars: doc.loopBars, similarity: [], repeats: [], novelSections: [], scale }
  }

  const sections: SectionAnalysis[] = []
  let startBar = 0
  for (let index = 0; index < doc.song.length; index++) {
    const seg = doc.song[index]!
    const scene = sceneById.get(seg.scene)
    const trackStats: TrackContentStats[] = []
    const sectionOnsetSteps: number[] = [] // one entry per DISTINCT tile-window onset (for section syncopation)
    let sectionOnsets = 0
    const sectionPitches: number[] = []
    let signature: BeatTimeSignature | null = null

    if (scene) {
      for (const track of doc.tracks) {
        const clipId = firstPlacementClip(scene.slots, track.id)
        if (!clipId) continue
        const clip = track.clips.find((c) => c.id === clipId)
        if (!clip) {
          // A placement pointing at a missing clip is a malformed document (parse/edit guard against
          // it), but analysis stays non-throwing: record the track with zeroed content.
          trackStats.push({ trackId: track.id, kind: track.kind, clipId, onsets: 0, onsetsPerBar: 0, syncopation: 0, pitchClass: null })
          continue
        }
        if (clip.signature && !signature) signature = clip.signature

        const { start: winStart, end: winEnd, tileBars } = tileWindow(doc, clip)
        const tiles = tileBars > 0 ? seg.bars / tileBars : 0
        const starts = clipOnsetStarts(clip, track.kind).filter((s) => s >= winStart && s < winEnd)
        const onsets = starts.length * tiles
        const offGrid = starts.filter((s) => offQuarterGrid(s - winStart)).length
        const syncopation = starts.length === 0 ? 0 : offGrid / starts.length

        let pitchClass: PitchClassProfile | null = null
        if (track.kind === 'synth' || track.kind === 'instrument') {
          const pitches = clip.notes.filter((n) => n.start >= winStart && n.start < winEnd).map((n) => n.pitch)
          pitchClass = pitchClassProfile(pitches, root, scaleSet)
          sectionPitches.push(...pitches)
        }

        trackStats.push({
          trackId: track.id,
          kind: track.kind,
          clipId,
          onsets,
          onsetsPerBar: seg.bars > 0 ? onsets / seg.bars : 0,
          syncopation,
          pitchClass,
        })
        sectionOnsets += onsets
        for (const s of starts) sectionOnsetSteps.push(s - winStart)
      }
    }

    const sectionOff = sectionOnsetSteps.filter((s) => offQuarterGrid(s)).length
    sections.push({
      index,
      scene: seg.scene,
      bars: seg.bars,
      startBar,
      tracks: trackStats,
      onsets: sectionOnsets,
      onsetsPerBar: seg.bars > 0 ? sectionOnsets / seg.bars : 0,
      syncopation: sectionOnsetSteps.length === 0 ? 0 : sectionOff / sectionOnsetSteps.length,
      pitchClass: sectionPitches.length > 0 ? pitchClassProfile(sectionPitches, root, scaleSet) : null,
      signature,
    })
    startBar += seg.bars
  }

  // Metric 4: pairwise Jaccard + exact-repeat linkage + novel-section detection.
  const signatures = doc.song.map((seg) => {
    const scene = sceneById.get(seg.scene)
    return scene ? sectionSignature(scene, doc.tracks) : []
  })
  const similarity = signatures.map((a) => signatures.map((b) => jaccard(a, b)))
  const repeats: SectionRepeat[] = []
  const novelSections: number[] = []
  const seen: string[][] = []
  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i]!
    const key = sig.join('|')
    const priorIdx = seen.findIndex((s) => s.join('|') === key)
    if (priorIdx === -1) {
      novelSections.push(i)
    } else {
      repeats.push({ index: i, repeatOf: priorIdx })
    }
    seen.push(sig)
  }

  return { sections, totalBars: startBar, similarity, repeats, novelSections, scale }
}
