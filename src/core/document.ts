// The in-memory shape of a .beat v0 document. Every field maps 1:1 onto real fields in
// BeatLab's Track/Note/SynthParams (beatlab/src/types.ts) — see docs/format-spec.md's "v0
// grammar" section for the frozen grammar this type mirrors, and the worked example there for
// what serializing one of these actually looks like on disk.

export type OscType = 'sine' | 'triangle' | 'sawtooth' | 'square'

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
  synth: BeatSynth
  notes: BeatNote[]
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
