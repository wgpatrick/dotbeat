import { create } from 'zustand'
import type { BeatDocument } from '../types'

// Discrete, note-grid-granularity state only (docs/research/15 §2): the document, the transport
// flags, the selection, and the grid-quantized playhead step + per-step master level. Continuous
// per-frame values (scope waveform/fft) do NOT live here — they're read straight off the engine's
// analysers inside the shared rAF driver. `currentStep`/`masterLevel` tick at most 16x/bar via
// Tone.getDraw (the engine's tick), which is why they're allowed in reactive state.

interface DawState {
  doc: BeatDocument | null
  connected: boolean
  parseError: string | null
  /** Local selection override; falls back to doc.selectedTrack when null. */
  selectedTrackId: string | null
  playing: boolean
  currentStep: number // -1 when stopped
  masterLevel: number | undefined // dB, from the master meter; undefined before first tick

  setDoc: (doc: BeatDocument) => void
  setConnected: (c: boolean) => void
  setParseError: (m: string | null) => void
  setSelectedTrack: (id: string) => void
  setPlaying: (p: boolean) => void
}

export const useStore = create<DawState>((set) => ({
  doc: null,
  connected: false,
  parseError: null,
  selectedTrackId: null,
  playing: false,
  currentStep: -1,
  masterLevel: undefined,

  setDoc: (doc) =>
    set((s) => ({
      doc,
      parseError: null,
      // Keep a local selection if it still resolves; otherwise clear to fall back to the doc's.
      selectedTrackId: s.selectedTrackId && doc.tracks.some((t) => t.id === s.selectedTrackId) ? s.selectedTrackId : null,
    })),
  setConnected: (connected) => set({ connected }),
  setParseError: (parseError) => set({ parseError }),
  setSelectedTrack: (selectedTrackId) => set({ selectedTrackId }),
  setPlaying: (playing) => set({ playing }),
}))

/** The currently-selected track id: local override, else the document's own selection, else the
 * first track. */
export function selectedTrackId(s: DawState): string | null {
  if (s.selectedTrackId) return s.selectedTrackId
  if (!s.doc) return null
  return s.doc.selectedTrack || s.doc.tracks[0]?.id || null
}
