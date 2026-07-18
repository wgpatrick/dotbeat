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
// the `beat skeleton` scaffolder. See src/analysis/import.ts. `import.ts` is the canonical
// authority for the AnalysisArtifact contract type (re-exported here); the SB sidecar produces a
// structurally-identical value, so it does not re-export the name a second time.
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
// ==== Phase 38 Stream SB begin ====
export {
  runAnalysis,
  sidecarDoctor,
  resolvePython,
  defaultAnalysisPath,
  type AnalysisBackend,
  type SidecarSection,
  type RunAnalysisOptions,
  type RunAnalysisResult,
} from './sidecar.js'
// ==== Phase 38 Stream SB end ====
// ==== Phase 39 Stream UB begin ====
// Generative-audio sidecar (`beat source gen`): spawns python/gen.py, which WRITES the generated
// WAV to a told --output path and returns metadata on stdout. source-lib.mjs registers + owns
// provenance. See src/analysis/gen.ts and decisions.md D19.
export {
  runGen,
  genDoctor,
  BeatGenError,
  type GenBackend,
  type GenMeta,
  type RunGenOptions,
  type RunGenResult,
} from './gen.js'
// ==== Phase 39 Stream UB end ====
// ==== Phase 40 Stream VC ====
// `beat regen`: rebuild generated media from the provenance sidecars alone — the executable form of
// "a fully-generated .beat project is a recipe". Imports source-lib.mjs; never modifies it (see
// src/analysis/regen.ts and docs/phase-40-plan.md §VC).
export {
  planRegen,
  runRegen,
  estimateRegenSeconds,
  formatDuration,
  formatRegenPlan,
  formatRegenSample,
  formatRegenResults,
  BeatRegenError,
  type GeneratedProvenance,
  type RegenPlan,
  type RegenPlanEntry,
  type RegenSkip,
  type RegenStatus,
  type RegenSampleResult,
  type RegenResult,
  type RunRegenOptions,
} from './regen.js'
// ==== end Phase 40 Stream VC ====

// ==== gen-kit begin ====
// `beat gen-kit`: compose a playable project entirely from generated sounds — the pure half
// (role vocabulary, pick heuristics, keymap span, seeded pattern plans). Orchestration lives in
// cli/beat.mjs. See docs/gen-kit-pipeline.md.
export {
  GENKIT_ROLES,
  parseGenKitRoles,
  genkitPrompts,
  pickDrumCandidate,
  pickTonalCandidate,
  keymapSpanForRoot,
  planDrumHits,
  planBassHits,
  planLeadHits,
  BeatGenKitError,
  type GenKitRoleSpec,
  type GenKitPick,
  type GenKitTonalPick,
  type PlannedHit,
} from './genkit.js'
// ==== gen-kit end ====

// ==== Phase 40 Stream VA begin ====
// Pitch detection for one-shots — pure TS, zero deps, no Python (decisions.md D20). Reuses
// src/metrics/'s FFT and WAV decoder, so the dependency direction stays analysis -> metrics.
// The tune/keymap arithmetic that consumes a root lives in src/core/keymap.ts.
export {
  detectPitch,
  formatPartials,
  formatPitchLine,
  pitchConfidenceLevel,
  PITCH_CONFIDENCE_HIGH,
  PITCH_CONFIDENCE_MEDIUM,
  type DetectPitchOptions,
  type PitchConfidenceLevel,
  type PitchDetection,
  type SpectralPartial,
} from './pitch.js'
// ==== Phase 40 Stream VA end ====
