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

export type OscType = 'sine' | 'triangle' | 'sawtooth' | 'square'
export const OSC_TYPES_LIST: readonly OscType[] = ['sine', 'triangle', 'sawtooth', 'square']
export type TrackKind = 'synth' | 'drums' | 'instrument'

export interface BeatNote {
  id: string
  pitch: number
  start: number // 16th steps from loop start
  duration: number // steps
  velocity: number // 0..1
}

export interface BeatDrumHit {
  id: string
  lane: DrumLane
  start: number // 16th steps, absolute over the loop
  velocity: number // (0..1]
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
// song is an ordered list of sections, each "play `scene` for `bars` bars". Automation lanes ride
// through untyped — the arrangement view doesn't render them yet.
export interface BeatClip {
  id: string
  notes: BeatNote[]
  hits: BeatDrumHit[]
  automation: unknown[]
}

export interface BeatScene {
  id: string
  slots: Record<string, string> // trackId -> clipId
}

export interface BeatSongSection {
  scene: string
  bars: number
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
}

export interface BeatDocument {
  formatVersion: string
  bpm: number
  loopBars: number
  selectedTrack: string
  media: unknown[]
  tracks: BeatTrack[]
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

/** Which of the top-level app screens is showing. */
export type AppView = 'editor' | 'arrangement' | 'mixer' | 'history'

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
