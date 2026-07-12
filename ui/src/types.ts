// The shape of the raw BeatDocument the daemon serves at GET /document. This is dotbeat's OWN
// document model (src/core/document.ts) — NOT BeatLab's Track/types.ts. The GUI renders this
// directly: free-timed drum hits (absolute over the loop), notes, and a full synth block per
// track. Mirrored here (not imported) because ui/ is a standalone Vite app; the daemon's JSON is
// the contract. Only the fields the frontend actually reads are typed strictly; the rest ride as
// a permissive index on the synth block.

export const DRUM_LANES = ['kick', 'snare', 'clap', 'hat', 'openhat'] as const
export type DrumLane = (typeof DRUM_LANES)[number]

export const DRUM_LABELS: Record<DrumLane, string> = {
  kick: 'Kick',
  snare: 'Snare',
  clap: 'Clap',
  hat: 'Hat',
  openhat: 'Open',
}

// Phase 22 Stream AB (mirrors src/core/document.ts's open lane model — research 19 Part VI Option
// B). A drum track's `lanes` is either [] (legacy/migrated: the implicit 5 DRUM_LANES above,
// synth-backed) or a fully-declared, ordered list that's authoritative for that track's lane
// identity — see declaredLaneNames() below.
export type DrumVoiceType = 'membrane' | 'noise' | 'metal'
export const DRUM_VOICE_TYPES: readonly DrumVoiceType[] = ['membrane', 'noise', 'metal']
export interface BeatLaneSynthBacking {
  type: 'synth'
  voice: DrumVoiceType
  params: Record<string, number>
}
export interface BeatLaneSampleBacking {
  type: 'sample'
  sample: string
  gainDb: number
  tune: number
}
export interface BeatLaneSfBacking {
  type: 'sf'
  sample: string
  program: number
  note: number
}
export type BeatLaneBacking = BeatLaneSynthBacking | BeatLaneSampleBacking | BeatLaneSfBacking
export interface BeatDrumLaneDecl {
  name: string
  backing: BeatLaneBacking
}

export const DRUM_VOICE_PARAM_DEFAULTS: Record<DrumVoiceType, Record<string, number>> = {
  membrane: { tune: 32.7, punch: 0.05, decay: 0.4 },
  noise: { tone: 0, decay: 0.13 },
  metal: { decay: 0.05, tone: 4000 },
}

/** Lane names in a drum track's declared order, or the implicit 5 DRUM_LANES when it declares
 * none — mirrors src/core/document.ts's declaredLaneNames exactly (see that function's comment). */
export function declaredLaneNames(track: Pick<BeatTrack, 'lanes'>): readonly string[] {
  return track.lanes.length > 0 ? track.lanes.map((l) => l.name) : DRUM_LANES
}

export type OscType = 'sine' | 'triangle' | 'sawtooth' | 'square'
export const OSC_TYPES_LIST: readonly OscType[] = ['sine', 'triangle', 'sawtooth', 'square']
export type TrackKind = 'synth' | 'drums' | 'instrument' | 'audio'

export interface BeatNote {
  id: string
  pitch: number
  start: number // 16th steps from loop start
  duration: number // steps
  velocity: number // 0..1
  // v0.10 (Phase 22 Stream AD; mirrors src/core/document.ts's BeatNote exactly — see that file
  // for the full rationale). Always present on a note the daemon serves (defaults filled by
  // core's addNote/parse); canonical elision only affects the ON-DISK text, not this shape.
  chance: number // 0-100 int; per-playback-pass trigger probability. 100 = always fires (default).
  cent: number // -50..50; micro-tuning offset, independent of semitone `pitch`. 0 = none (default).
  ratchetCount: number // 1-16 int; repeat the note this many times within its own duration. 1 = no ratchet (default).
  ratchetCurve: number // -1..1; shapes ratchet repeat spacing (0 = even). Default 0.
  ratchetLength: number // 0..1 (exclusive of 0); each repeat's sounding length as a fraction of its slot. 1 = fills the slot (default).
}

export interface BeatDrumHit {
  id: string
  lane: string // Phase 22 Stream AB: open — validated against the track's declaredLaneNames()
  start: number // 16th steps, absolute over the loop
  velocity: number // (0..1]
  duration?: number // 16th steps, > 0; absent = one-shot trigger (research 20 Part 7)
}

// The nine core synth params the panel exposes as controls; the full block carries ~60 fields
// (SYNTH_FIELDS) which ride through as a permissive index but aren't all surfaced yet.
export interface BeatSynth {
  osc: OscType
  volume: number // dB
  cutoff: number // Hz
  resonance: number
  attack: number // s
  decay: number // s
  sustain: number // 0..1
  release: number // s
  pan: number // -1..1
  [k: string]: number | string | boolean | null
}

export interface BeatInstrument {
  sample: string
  program: number
  volume: number
  pan: number
}

// v0.4 arrangement shapes (mirrors src/core/document.ts). The arrangement/song view reads these:
// a clip is a named bag of notes (synth) or hits (drums); a scene maps trackId -> clipId; the
// song is an ordered list of sections, each "play `scene` for `bars` bars".
//
// v0.9 clip automation (Phase 20 Stream Z): a lane is every (time,value) breakpoint recorded for
// one automatable synth param within one clip; `time` is in 16th steps from the clip's start
// (same unit as note/hit start), `value` is the param's raw unit. Mirrors src/core/document.ts's
// BeatAutomationLane/BeatAutomationPoint (ui/ hand-mirrors core shapes — see this file's siblings).
export interface BeatAutomationPoint {
  id: string
  time: number
  value: number
}
export interface BeatAutomationLane {
  param: string
  points: BeatAutomationPoint[]
}
// v0.10 (Phase 22 Stream AG): a clip's own loop range / time signature — Ableton's "Loop Position &
// Length" + Signature fields (docs/research/18-ableton-ui-architecture.md's Clip View table).
// Mirrors src/core/document.ts's BeatClipLoop/BeatTimeSignature; null = no override (canonical
// elision — the clip tiles across whatever length the section/loopBars gives it / inherits 4/4).
export interface BeatClipLoop {
  start: number // bars, clip-local
  end: number // bars, clip-local, > start
}
export interface BeatTimeSignature {
  numerator: number
  denominator: number
}
export const TIME_SIG_DENOMINATORS: readonly number[] = [1, 2, 4, 8, 16, 32]

// Phase 22 Stream AE (format v0.10): an audio-region clip's entire content — media reference
// (v0.5 media block id) + in/out points (seconds into the SOURCE media) + static gain + warp
// mode + repitch rate. Mirrors src/core/document.ts's BeatAudioRegion. `warp` is 'off'|'repitch'|
// 'complex' ('complex' is a legal value with no engine support yet — see engine.ts). `markers` is
// reserved for warp==='complex' (not built this stream) and always empty.
export type WarpMode = 'off' | 'repitch' | 'complex'
export const WARP_MODES: readonly WarpMode[] = ['off', 'repitch', 'complex']
export interface BeatAudioRegion {
  media: string
  in: number
  out: number
  gainDb: number
  warp: WarpMode
  rate: number
  markers: { id: string; sourceTime: number; timelineTime: number }[]
}

export interface BeatClip {
  id: string
  notes: BeatNote[]
  hits: BeatDrumHit[]
  automation: BeatAutomationLane[]
  loop: BeatClipLoop | null
  signature: BeatTimeSignature | null
  audio?: BeatAudioRegion // Phase 22 Stream AE; present iff the enclosing track is kind 'audio'
}

export interface BeatScene {
  id: string
  slots: Record<string, string> // trackId -> clipId
}

export interface BeatSongSection {
  scene: string
  bars: number
}

// v0.10 (Phase 22 Stream AA): the ordered, reorderable per-track effect chain — mirrors
// src/core/document.ts's EffectType/BeatEffect exactly. Synth tracks only (drum/instrument tracks
// carry []); array order IS chain order (see ui/src/audio/engine.ts's buildSynthChain).
// Phase 23 Stream BE: widened from the original four — see src/core/document.ts's EffectType
// comment for why defaultEffectChain (engine.ts side: the migration target) stays the original
// four regardless of this widened list.
export type EffectType = 'eq3' | 'comp' | 'distortion' | 'bitcrush' | 'autoFilter' | 'autoPan' | 'tremolo' | 'utility'
export const EFFECT_TYPES: readonly EffectType[] = ['eq3', 'comp', 'distortion', 'bitcrush', 'autoFilter', 'autoPan', 'tremolo', 'utility']
export const EFFECT_LABELS: Record<EffectType, string> = {
  eq3: 'EQ3',
  comp: 'Compressor',
  distortion: 'Distortion',
  bitcrush: 'Bitcrush',
  autoFilter: 'Auto Filter',
  autoPan: 'Auto Pan',
  tremolo: 'Tremolo',
  utility: 'Utility',
}
export interface BeatEffect {
  id: string
  type: EffectType
  enabled: boolean
}

// v0.10 track groups (Phase 22 Stream AF): a flat, named, colored fold of N existing tracks — no
// nesting/group-of-groups, a track belongs to at most one group (mirrors src/core/document.ts's
// BeatGroup). Collapsed/expanded is deliberately NOT here — it's UI-only session state, kept as
// local component state in ArrangementView (the same "not in the .beat file" treatment mute/solo get
// in ui/src/state/store.ts), so it doesn't round-trip through the daemon at all.
export interface BeatGroup {
  id: string
  name: string
  color: string
  tracks: string[]
}

export interface BeatTrack {
  id: string
  name: string
  color: string
  kind: TrackKind
  synth: BeatSynth
  instrument?: BeatInstrument
  notes: BeatNote[]
  hits: BeatDrumHit[]
  clips: BeatClip[]
  laneSamples: Record<string, unknown>
  effects: BeatEffect[]
  lanes: BeatDrumLaneDecl[]
  // v0.10 groove/shuffle (Phase 22 Stream AD) — mirrors src/core/document.ts's BeatTrack exactly.
  // A reversible playback-time warp (see ui/src/audio/engine.ts's warpStep), never baked into
  // stored note/hit start. 0 = off (default).
  shuffleAmount: number
  shuffleGrid: number
}

export interface BeatMediaSample {
  id: string
  sha256: string
  path: string
}

export interface BeatDocument {
  formatVersion: string
  bpm: number
  loopBars: number
  selectedTrack: string
  media: BeatMediaSample[]
  tracks: BeatTrack[]
  groups: BeatGroup[]
  scenes: BeatScene[]
  song: BeatSongSection[] | null
}

// The D2 pointing protocol value (src/core/selection.ts). Every axis is an independent, optional
// filter; an absent axis is unfiltered ("all"). The arrangement view posts the `tracks` and `bars`
// axes; it reads back the whole value (an agent may set lanes/notes too).
export interface SelectionLane {
  track: string
  lane: string
}
export interface SelectionNote {
  track: string
  note: string
}
export interface BeatSelection {
  tracks?: string[]
  lanes?: SelectionLane[]
  bars?: { start: number; end: number }
  notes?: SelectionNote[]
}

/** Which facet the bottom detail pane shows — Ableton's Clip View (edit the clip's notes/hits) vs
 * Device View (edit the track's sound). Phase 18 replaced the old four-screen `AppView` tab enum:
 * the arrangement is now the unconditional main area, so there is no top-level screen to switch. */
export type BottomPane = 'clip' | 'device'

/** One checkpoint row from the daemon's GET /history (mirrors src/history/history.ts's
 * HistoryEntry — the daemon's JSON is the contract). `ref` is the short sha handle `restore` takes;
 * `label` is the semantic one-line diff; `pin`/`intent` are present only when set. */
export interface HistoryEntry {
  ref: string
  when: string // ISO date
  label: string
  intent?: string
  pin?: string
}

/** One row of the daemon's GET /history?collapsed=true (mirrors src/history/history.ts's
 * HistoryRow): either a real checkpoint, or a `{kind:'collapsed', count}` summary standing in for a
 * run of unnamed checkpoints folded between pins (product-spec-desktop.md §4). */
export type HistoryRow = ({ kind: 'checkpoint' } & HistoryEntry) | { kind: 'collapsed'; count: number }

/** The nine core params, in the format's canonical order, with UI ranges + display formatting.
 * `osc` is an enum handled separately by the panel; the other eight are knobs. */
export interface KnobSpec {
  key: keyof BeatSynth
  label: string
  min: number
  max: number
  log?: boolean
  format: (v: number) => string
}

const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`)
const s = (v: number) => (v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`)
const db = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`

export const CORE_KNOBS: KnobSpec[] = [
  { key: 'volume', label: 'Vol', min: -60, max: 6, format: db },
  { key: 'cutoff', label: 'Cutoff', min: 20, max: 18000, log: true, format: hz },
  { key: 'resonance', label: 'Res', min: 0, max: 20, format: (v) => v.toFixed(1) },
  { key: 'attack', label: 'Attack', min: 0.001, max: 2, log: true, format: s },
  { key: 'decay', label: 'Decay', min: 0.001, max: 2, log: true, format: s },
  { key: 'sustain', label: 'Sustain', min: 0, max: 1, format: (v) => v.toFixed(2) },
  { key: 'release', label: 'Release', min: 0.001, max: 4, log: true, format: s },
  { key: 'pan', label: 'Pan', min: -1, max: 1, format: (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`) },
]
