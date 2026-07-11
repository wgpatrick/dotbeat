import { create } from 'zustand'
import type { BottomPane, BeatDocument, BeatSelection } from '../types'

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

  // ── Phase 18 GUI layout state (Ableton-shaped, additive/UI-only) ──────────────────────────────
  // Replaces the old `view: AppView` four-tab switcher. The arrangement is now the unconditional
  // main area; these flags drive the selection-following bottom detail pane, the History drawer, and
  // the on-demand full-Mixer overlay (research 18: the full mixer is demoted from a peer tab to an
  // optional "step back and balance" overlay that lives alongside the inline per-track strips).
  /** Which facet the bottom detail pane shows for the selected track — Clip View (notes/hits) vs
   * Device View (the sound). Toggled by Shift+Tab (Ableton) or the pane's Clip/Device labels. */
  bottomPane: BottomPane
  /** Whether the bottom detail pane is docked open. There is always a selected track (selectedTrackId
   * falls back to the first), so the pane can always be shown; this lets the user collapse it and
   * have selecting a track re-open it — Ableton's "drag the pane to the window bottom to close" idiom. */
  bottomPaneOpen: boolean
  /** Whether the version-history drawer is slid open over the main view (was the 4th tab). */
  historyOpen: boolean
  /** Whether the full all-strips Mixer overlay is open (was the 3rd tab; now an on-demand overlay). */
  mixerOpen: boolean
  /** The daemon's current pointing selection (the D2 channel), mirrored locally. {} = unset. It is
   * ephemeral and never in the .beat file — the daemon owns it; we read it via SSE + GET /selection
   * and write it via POST /selection (see bridge.ts). */
  selection: BeatSelection
  /** Multi-note editing selection (Phase 17 Stream M): the ids of the notes currently selected in
   * the piano roll for group move/resize/delete/nudge. This is GUI-only editing state and is
   * DISTINCT from `selection` above — that is the D2 pointing protocol (tracks/lanes/bars) the
   * daemon owns and `beat vary --scope selection` reads; this is just "which notes the pointer/
   * keyboard is about to act on" inside NoteView. Note ids are globally unique across the doc, but
   * NoteView only ever operates on the intersection with the currently-edited track's notes. */
  editNoteIds: string[]
  /** Mixer mute/solo — GUI-only transport state, keyed by track id. NOT persisted to the .beat file
   * (the format carries no mute/solo field, and real DAWs treat these as session state). As of
   * Phase 14 Stream E these gate real audio: the engine reads isEffectivelyMuted per tick and sets
   * each track's mute gate accordingly, in addition to driving the mixer's visual state. */
  mutes: Record<string, boolean>
  solos: Record<string, boolean>

  setDoc: (doc: BeatDocument) => void
  setConnected: (c: boolean) => void
  setParseError: (m: string | null) => void
  setSelectedTrack: (id: string) => void
  setPlaying: (p: boolean) => void
  setBottomPane: (p: BottomPane) => void
  toggleBottomPane: () => void
  setBottomPaneOpen: (open: boolean) => void
  toggleHistory: () => void
  toggleMixer: () => void
  setSelection: (s: BeatSelection) => void
  setEditNoteIds: (ids: string[]) => void
  toggleMute: (id: string) => void
  toggleSolo: (id: string) => void
}

export const useStore = create<DawState>((set) => ({
  doc: null,
  connected: false,
  parseError: null,
  selectedTrackId: null,
  playing: false,
  currentStep: -1,
  masterLevel: undefined,
  bottomPane: 'clip',
  bottomPaneOpen: true,
  historyOpen: false,
  mixerOpen: false,
  selection: {},
  editNoteIds: [],
  mutes: {},
  solos: {},

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
  setBottomPane: (bottomPane) => set({ bottomPane, bottomPaneOpen: true }),
  toggleBottomPane: () => set((s) => ({ bottomPane: s.bottomPane === 'clip' ? 'device' : 'clip', bottomPaneOpen: true })),
  setBottomPaneOpen: (bottomPaneOpen) => set({ bottomPaneOpen }),
  toggleHistory: () => set((s) => ({ historyOpen: !s.historyOpen })),
  toggleMixer: () => set((s) => ({ mixerOpen: !s.mixerOpen })),
  setSelection: (selection) => set({ selection }),
  setEditNoteIds: (editNoteIds) => set({ editNoteIds }),
  toggleMute: (id) => set((s) => ({ mutes: { ...s.mutes, [id]: !s.mutes[id] } })),
  toggleSolo: (id) => set((s) => ({ solos: { ...s.solos, [id]: !s.solos[id] } })),
}))

/** A track is effectively silenced iff it is explicitly muted, OR any track is soloed and this one
 * is not among them (standard mixer solo semantics). Drives both the mixer's visual dimming and the
 * engine's real per-track audio gate (Phase 14 Stream E). */
export function isEffectivelyMuted(s: DawState, id: string): boolean {
  if (s.mutes[id]) return true
  const anySolo = Object.values(s.solos).some(Boolean)
  return anySolo && !s.solos[id]
}

/** The currently-selected track id: local override, else the document's own selection, else the
 * first track. */
export function selectedTrackId(s: DawState): string | null {
  if (s.selectedTrackId) return s.selectedTrackId
  if (!s.doc) return null
  return s.doc.selectedTrack || s.doc.tracks[0]?.id || null
}
