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
  saveClip,
  setScene,
  setSong,
  setMediaSample,
  setLaneSample,
  addAutomationPoint,
  moveAutomationPoint,
  removeAutomationPoint,
  setAutomationPoint,
  BeatEditError,
  type QuantizeOptions,
} from './edit.js'
export { humanize, BeatHumanizeError, type HumanizeOptions } from './humanize.js'
export { describeDocument } from './inspect.js'
export { parsePresetLibrary, applyPreset, formatPresetList, BeatPresetError, type BeatPreset } from './preset.js'
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
