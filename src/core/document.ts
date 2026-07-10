// The in-memory shape of a .beat v0 document. Every field maps 1:1 onto real fields in
// BeatLab's Track/Note/SynthParams (beatlab/src/types.ts) — see docs/format-spec.md's "v0
// grammar" section for the frozen grammar this type mirrors, and the worked example there for
// what serializing one of these actually looks like on disk.

export type OscType = 'sine' | 'triangle' | 'sawtooth' | 'square'

export type TrackKind = 'synth' | 'drums'

// BeatLab's own lane set and order (DRUM_LANES in beatlab/src/types.ts). Order is canonical for
// serialization: all five lanes are always emitted, in this order, so toggling any drum step is
// always a one-line diff and never inserts or deletes lines (the Humdrum fixed-grid discipline —
// see docs/format-spec.md).
export const DRUM_LANES = ['kick', 'snare', 'clap', 'hat', 'openhat'] as const
export type DrumLane = (typeof DRUM_LANES)[number]

// One velocity (0..1) per step; 0 = off. In BeatLab this is a 16-step (one-bar) cycle that
// repeats across the loop, independent of loop_bars — the format stores whatever length the app
// uses, requiring only that all lanes agree.
export type BeatDrumPattern = Record<DrumLane, number[]>

export interface BeatSynth {
  osc: OscType
  volume: number // dB
  cutoff: number // Hz
  resonance: number
  attack: number // seconds
  decay: number // seconds
  sustain: number // 0..1
  release: number // seconds
  pan: number // -1..1
}

export interface BeatNote {
  id: string
  pitch: number // MIDI 0-127
  start: number // 16th-note steps from the loop start
  duration: number // steps
  velocity: number // 0..1
}

export interface BeatTrack {
  id: string
  name: string
  color: string // lowercase hex, e.g. "#c678dd"
  kind: TrackKind
  synth: BeatSynth // drum tracks carry these too — in BeatLab they're the real drum bus/voice params
  notes: BeatNote[] // synth tracks only; always [] for drums
  pattern?: BeatDrumPattern // drum tracks only; absent for synth
}

export interface BeatDocument {
  formatVersion: string
  bpm: number
  loopBars: number
  selectedTrack: string
  tracks: BeatTrack[]
}

// Fixed serialization order for synth params — BeatLab's own P_FULL progressive-reveal order
// (osc -> volume -> cutoff -> resonance -> attack/decay/sustain/release), pan appended. See
// format-spec.md's "canonical ordering" section for why this specific order, not alphabetical.
export const SYNTH_PARAM_ORDER: (keyof BeatSynth)[] = [
  'osc',
  'volume',
  'cutoff',
  'resonance',
  'attack',
  'decay',
  'sustain',
  'release',
  'pan',
]

export const OSC_TYPES: readonly OscType[] = ['sine', 'triangle', 'sawtooth', 'square']

export const TRACK_KINDS: readonly TrackKind[] = ['synth', 'drums']

/** The format's standard init patch for a newly-created track (`beat init` / `beat add-track`).
 * A format-level default, not a copy of any host app's: a mellow filtered saw that sounds
 * reasonable for bass, chords, or lead until edited. */
export const INIT_SYNTH: BeatSynth = {
  osc: 'sawtooth',
  volume: -10,
  cutoff: 2000,
  resonance: 0.8,
  attack: 0.01,
  decay: 0.2,
  sustain: 0.6,
  release: 0.3,
  pan: 0,
}

/** Default track colors cycled by `beat add-track` when none is given — beatlab's own palette. */
export const TRACK_COLORS = ['#e06c75', '#56b6c2', '#f7c948', '#c678dd', '#98c379', '#61afef'] as const
