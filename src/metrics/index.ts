export { decodeWav, readWavFormat, wavSampleCodec, WavDecodeError, type DecodedWav, type WavFormatInfo, type WavSampleCodec } from './wav.js'
export { integratedLoudness, type LoudnessResult } from './loudness.js'
export { analyze, fft, truePeak, AIR_BAND_LO_HZ, type MixMetrics, type SpectralBands } from './analyze.js'
export { analyzeRich, ATTACK_WINDOW_MS, WIDTH_FLOOR_DB, type RichMetrics } from './rich.js'
export { lint, formatLint, refFindings, worstTrack, type LintFinding, type LintOptions, type TrackContribution } from './lint.js'
export {
  sliceSections,
  analyzeSections,
  samplesPerBar,
  formatSectionFeedback,
  formatWholeSongFeedback,
  arrangementFindings,
  SECTION_FLAT_ADJACENT_LU,
  SECTION_FLAT_SPAN_LU,
  SECTION_HONEST_LIMITS,
  type SectionSpec,
  type SectionMetrics,
} from './sections.js'
export { buildProfile, serializeProfile, parseProfile, BeatProfileError, PROFILE_FORMAT, PROFILE_VERSION, type MixProfile } from './profile.js'
export {
  buildArcProfile,
  analyzeArcRanges,
  serializeArcProfile,
  parseArcProfile,
  formatArcTable,
  diffArc,
  formatArcDiff,
  BeatArcError,
  ARC_FORMAT,
  ARC_VERSION,
  ARC_SECTION_TOLERANCE_LU,
  type ArcProfile,
  type ArcSection,
  type ArcRange,
  type ArcSectionSource,
  type ArcDiff,
  type ArcDiffRow,
} from './arc.js'
export { RENDER_RUN_VARIANCE_LU, RENDER_RUN_VARIANCE_PEAK_DB, RENDER_RUN_VARIANCE_BAND_PCT, RENDER_RUN_VARIANCE_WIDTH_DB, RENDER_RUN_VARIANCE_META } from './variance.js'
export { screen, formatScreens, type PathologyFinding, type ScreenOptions } from './screens.js'
export {
  runRoughness,
  roughnessCompare,
  roughnessFindings,
  parseRoughnessResult,
  roughnessDoctor,
  resolveRoughnessPython,
  BeatRoughnessError,
  ROUGHNESS_RISE_PCT,
  ROUGHNESS_RISE_ABS,
  type RoughnessResult,
  type RoughnessBin,
} from './roughness.js'
