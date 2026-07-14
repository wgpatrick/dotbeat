// Phase 37 Stream RB — symbolic song analysis. Pure, deterministic functions over a .beat
// document's notes/hits/scenes/placements (no rendering). See structure.ts for the analysis and
// the reusable types (RA's `beat feedback` appends this; Phase 38 audio-import emits into it).
export {
  analyzeStructure,
  BeatAnalysisError,
  type AnalyzeStructureOptions,
  type PitchClassProfile,
  type SectionAnalysis,
  type SectionRepeat,
  type StructureAnalysis,
  type TrackContentStats,
} from './structure.js'
export { formatStructure } from './format.js'
// ==== Phase 38 Stream SA begin ====
// Audio-structure import: the `*.analysis.json` loader (validation + all seconds->bars math) and
// the `beat skeleton` scaffolder. See src/analysis/import.ts.
export {
  validateAnalysisArtifact,
  artifactToSections,
  buildSkeleton,
  formatSkeletonReport,
  type AnalysisArtifact,
  type AnalysisSection,
  type SongEntry,
  type SkeletonReport,
  type SkeletonReportSection,
} from './import.js'
// ==== Phase 38 Stream SA end ====
