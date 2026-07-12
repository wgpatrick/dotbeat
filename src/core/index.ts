export * from './document.js'
export * from './format.js'
export { parse, BeatParseError } from './parse.js'
export { serialize } from './serialize.js'
export {
  sandboxPayloadToBeatDocument,
  beatDocumentToPartialTracks,
  DELIBERATELY_UNMODELED,
  type ExternalSandboxPayload,
  type ExternalTrack,
  type ExternalClipAutomation,
  type ConversionReport,
  type PartialTrack,
} from './convert.js'
export { diffDocuments, formatDiff, type DiffEntry } from './diff.js'
export {
  setValue,
  addNote,
  removeNote,
  addHit,
  removeHit,
  quantizeNotes,
  addTrack,
  removeTrack,
  initDocument,
  addGroup,
  removeGroup,
  renameGroup,
  setGroupColor,
  setGroupTracks,
  saveClip,
  setScene,
  setSong,
  setMediaSample,
  setLaneSample,
  addAutomationPoint,
  moveAutomationPoint,
  removeAutomationPoint,
  setAutomationPoint,
  addEffect,
  removeEffect,
  moveEffect,
  setEffectEnabled,
  setClipLoop,
  setClipSignature,
  BeatEditError,
  type QuantizeOptions,
} from './edit.js'
export { humanize, BeatHumanizeError, type HumanizeOptions } from './humanize.js'
export { moebiusEase, warpStep, unwarpStep } from './groove.js'
export { chanceFires } from './chance.js'
export {
  transposeNotes,
  timeScaleNotes,
  fitToScaleNotes,
  invertNotes,
  reverseNotes,
  legatoNotes,
  consolidateRatchet,
  ratchetSlots,
  SCALES,
  SCALE_NAMES,
  BeatPitchTimeError,
  type NoteScopeOptions,
} from './pitchtime.js'
export { describeDocument } from './inspect.js'
export {
  parsePresetLibrary,
  applyPreset,
  formatPresetList,
  filterPresetsByCategory,
  BeatPresetError,
  type BeatPreset,
  type PresetCategory,
  PRESET_CATEGORIES,
  SYNTH_PRESET_CATEGORIES,
  DRUM_PRESET_CATEGORIES,
} from './preset.js'
export {
  parseDrumKitLibrary,
  applyDrumKit,
  formatDrumKitList,
  BeatDrumKitError,
  type BeatDrumKit,
} from './drumkit.js'
export {
  parseSelection,
  serializeSelection,
  validateSelection,
  selectionToNoteIds,
  selectionToVaryScope,
  BeatSelectionError,
  type BeatSelection,
  type SelectionLane,
  type SelectionNote,
  type VaryScope,
} from './selection.js'
