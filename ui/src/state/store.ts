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
  /** Phase 24 Stream CA: the bottom detail pane's height in px, set by dragging the divider between
   * `.main-area` and `.bottom-pane` (`PaneDivider` in App.tsx). `null` means "use the CSS default"
   * (`styles.css`'s `.bottom-pane { height: 42vh }`) — the common case, so most sessions never carry
   * an explicit pixel value at all. This is a view preference, not a musical fact, so it follows the
   * exact same session-only treatment as mute/solo and `BeatGroup.collapsed` (see the `mutes`/`solos`
   * doc comment below for the fuller rationale): never written to the `.beat` file, resets to the CSS
   * default on reload rather than persisting across sessions. */
  bottomPaneHeight: number | null
  /** Whether the version-history drawer is slid open over the main view (was the 4th tab). */
  historyOpen: boolean
  /** Whether the full all-strips Mixer overlay is open (was the 3rd tab; now an on-demand overlay). */
  mixerOpen: boolean
  /** Phase 22 Stream AH: whether the content-browser sidebar (presets/kits/soundfonts, research
   * 18 §8 "Browser/sidebar") is docked open as a collapsible LEFT rail, alongside the permanent
   * Arrangement main area — additive to the Phase 18 layout, not a replacement for any of it. */
  libraryOpen: boolean
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
   * each track's mute gate accordingly, in addition to driving the mixer's visual state.
   *
   * Phase 23 Stream BB revisited this deliberately (docs/phase-23-stream-bb.md) and CONFIRMED
   * transient-only is correct, not just inherited: (1) real DAWs (Ableton, Logic) keep mute/solo as
   * session/monitoring state, not composition data; (2) dotbeat's own precedent already treats
   * every other "how am I looking at this right now" flag the same way — BeatGroup's
   * collapsed/expanded (src/core/document.ts) is explicitly UI-only for the identical reason, and
   * this field's own doc comment there cross-references mute/solo; (3) the .beat format's whole
   * premise is a diff that means something musically (decisions.md) — a solo toggled to audition one
   * track while arranging would otherwise pollute every commit with a line that isn't a musical
   * choice. Nothing was added to BeatTrack; this comment IS the decision record. */
  mutes: Record<string, boolean>
  solos: Record<string, boolean>
  /** Phase 22 Stream AG: the arrangement's overlapping-region resolution policy — what happens when
   * resizing a song section grows it into the next one's space (docs/research/22-opendaw-editing-
   * workflow.md §2.1's `clip`/`push-existing`/`keep-existing`, reimplemented for dotbeat's 1D
   * section-list timeline in src/daemon/daemon.ts's songResize). This is a GUI editing PREFERENCE,
   * not project content — openDAW itself keeps it in app-level `StudioSettings`, not the saved
   * project — so it deliberately does NOT ride in the .beat file; it lives here (session-only,
   * resets to the default on reload) and every resize call (the +/- chips and the drag handle) reads
   * it and sends it to the daemon's POST /song resize op. */
  overlapPolicy: 'clip' | 'push-existing' | 'keep-existing'
  /** Phase 24 Stream CE: the transport's loop-region override, a `[start, end)` bar range, or
   * `null` for today's default (loop the full song/loop — `engine.ts`'s existing `songBars`/
   * `totalSteps` wrap). When set, `engine.ts`'s `tick()` wraps playback within this range instead,
   * without touching the song/section structure itself. Deliberately session-only, same "view/
   * session state stays out of the file" discipline as mute/solo, group-collapse, and CA/CD's
   * pane-height/zoom state — looping a section while auditioning it is a listening choice, not a
   * musical fact the `.beat` file's diff should carry. Set from the arrangement's existing bar-range
   * SELECTION axis (`selection.bars` above — drag the ruler/a track, or a section chip's "loop
   * this" button derives the range from the section's own bars) — reuses that axis rather than
   * inventing a second one; setting a loop region does not itself change `selection`. */
  loopRegion: { start: number; end: number } | null
  /** Phase 24 Stream CH: the id of the track currently being AUDITIONED (NoteView's "preview this
   * clip" button — engine.auditionClip()/stopAudition()), or null when nothing is auditioning.
   * Session-only, like `playing` — mirrors the engine's own internal audition flag purely so
   * NoteView's button can render its own play/stop state reactively. Mutually exclusive with
   * `playing`: starting normal playback clears this (engine.play()), and starting an audition
   * doesn't touch `playing` (see engine.ts's auditionClip/stopAudition). */
  auditioningTrackId: string | null
  /** Phase 26 Stream DB (research/28): whether the daemon's session-only in-memory undo/redo stack
   * has anything to pop, mirrored from GET /undo-state + the `undo-state` SSE event so Ctrl+Z's
   * affordance (TransportBar's Undo/Redo buttons) can grey out without an extra round-trip per
   * keypress. This is NOT the git-backed History panel's checkpoint list — a wholly separate,
   * ephemeral mechanism (see bridge.ts's postUndo/postRedo header comment).
   *
   * Phase 30 Stream JB (research/89): as of this stream, this is set from TWO sources, not just the
   * SSE event — bridge.ts's postEdit also bumps it OPTIMISTICALLY (canUndo: true, canRedo: false) the
   * instant a local edit is applied, the same "don't wait for the round trip" treatment the doc field
   * itself already gets. Without that, this field could read stale (usually stale-false) for as long
   * as postEdit's own ~60ms debounce plus a network round trip, which is exactly the window
   * TransportBar's Undo button used to show `disabled` right after a real, undoable edit. The SSE
   * event remains authoritative and corrects this shortly after in the rare case the optimistic guess
   * was wrong (e.g. an edit that round-tripped to no actual canonical change). */
  canUndo: boolean
  canRedo: boolean
  /** Phase 29 Stream GA: the index into `doc.song` the user is currently "looking at" — alongside
   * `selectedTrackId` above, this is the second half of "which clip should the bottom Clip View / the
   * ClipPropertiesPanel strip / Place-in-Arrangement target." Before this field existed, nothing in the
   * GUI had ANY notion of "which section" — `primaryClipFor` (ClipPropertiesPanel.tsx) and
   * `placeInArrangement` (NoteView.tsx) both always resolved to the FIRST song section's scene for a
   * track, so once a song had more than one section there was no way to view or edit any but the
   * first (docs/research/83, 84, 86 — the single highest-impact usability-pilot finding this session).
   * `null` = nothing explicitly selected, which every consumer treats as "fall back to the old
   * first-occurrence behavior" (loop mode, or before the user has clicked any section/clip block yet).
   * Session-only, like `selectedTrackId` — not written to the .beat file, and (see `setDoc` below)
   * reset to null whenever it stops resolving against the live doc (song shrinks/clears). */
  selectedSectionIndex: number | null
  /** Phase 36 Stream PD (v0.11 multi-region placements, D16): which PLACEMENT of an audio track's
   * multi-placement slot the user last clicked in the arrangement — the third coordinate of "which
   * clip is open" alongside `selectedTrackId`/`selectedSectionIndex` above. Only audio tracks can
   * carry more than one placement per (track, section) (the D16 audio-only scope guard), so this is
   * only ever set by a click on an audio clip block; `null` means "no explicit placement choice,"
   * which every consumer (AudioClipEditor's clip resolution) treats as "fall back to the playhead's
   * placement, else the at-0/first one." Session-only, like the two fields above; cleared whenever
   * the section selection changes without a placement click, and (see `setDoc`) whenever it stops
   * resolving against the live doc. */
  selectedPlacement: { track: string; clip: string; at: number } | null
  /** Phase 29 Stream GB (docs/research/81, /86): bumped once per track each time a PRESET is
   * actually applied to it — the in-panel PresetPicker (SynthPanel.tsx) and a Content-Browser
   * drag-drop onto a track header both funnel through daemon/library.ts's applyPresetToTrack,
   * which is the single place this increments. Neither "current preset" nor "macro dial
   * position" is a real field in the `.beat` document (both are inferred client-side from raw
   * synth params — see MacroKnob's own comment in SynthPanel.tsx) — this counter is the signal
   * that inference needs to distinguish "a preset just replaced this track's params wholesale,
   * re-derive my display" from "an ordinary param edit ticked by, my own in-progress state stays
   * authoritative." Keyed by track id; the number itself is meaningless, only a CHANGE in it is —
   * same idiom `currentStep` already uses for "did a tick happen," just keyed and manual instead
   * of a shared clock. Session-only, like every other GUI-inference field here; resets on reload
   * (a fresh mount re-derives straight from the live document instead, see MacroKnob/PresetPicker). */
  presetEpoch: Record<string, number>

  setDoc: (doc: BeatDocument) => void
  setConnected: (c: boolean) => void
  setParseError: (m: string | null) => void
  setSelectedTrack: (id: string) => void
  setSelectedSection: (index: number | null) => void
  setSelectedPlacement: (p: { track: string; clip: string; at: number } | null) => void
  setPlaying: (p: boolean) => void
  setBottomPane: (p: BottomPane) => void
  toggleBottomPane: () => void
  setBottomPaneOpen: (open: boolean) => void
  setBottomPaneHeight: (h: number | null) => void
  toggleHistory: () => void
  toggleMixer: () => void
  toggleLibrary: () => void
  setSelection: (s: BeatSelection) => void
  setEditNoteIds: (ids: string[]) => void
  toggleMute: (id: string) => void
  toggleSolo: (id: string) => void
  setOverlapPolicy: (p: DawState['overlapPolicy']) => void
  setLoopRegion: (r: { start: number; end: number } | null) => void
  setAuditioning: (trackId: string | null) => void
  setUndoState: (s: { canUndo: boolean; canRedo: boolean }) => void
  bumpPresetEpoch: (trackId: string) => void
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
  bottomPaneHeight: null,
  historyOpen: false,
  mixerOpen: false,
  libraryOpen: false,
  selection: {},
  editNoteIds: [],
  mutes: {},
  solos: {},
  overlapPolicy: 'push-existing', // matches the pre-Stream-AG unconditional-shift behavior
  loopRegion: null,
  auditioningTrackId: null,
  canUndo: false,
  canRedo: false,
  selectedSectionIndex: null,
  selectedPlacement: null,
  presetEpoch: {},

  setDoc: (doc) =>
    set((s) => {
      // Keep a local selection if it still resolves; otherwise clear to fall back to the doc's.
      const selectedTrackId = s.selectedTrackId && doc.tracks.some((t) => t.id === s.selectedTrackId) ? s.selectedTrackId : null
      // Same "keep it if it still resolves" discipline as selectedTrackId above — a section index
      // stops being meaningful the instant the song shrinks below it (a delete, or leaving song mode
      // entirely), so a stale index doesn't silently keep pointing at some OTHER section post-edit.
      const selectedSectionIndex =
        s.selectedSectionIndex !== null && doc.song && s.selectedSectionIndex < doc.song.length ? s.selectedSectionIndex : null
      // Phase 36 PD: a placement selection only survives if the selected section's scene still
      // literally places that (clip, at) on that track — anything else (placement moved/removed,
      // section retargeted, song gone) falls back to null's documented playhead/first behavior.
      const sp = s.selectedPlacement
      const sectionScene =
        selectedSectionIndex !== null && doc.song ? doc.scenes.find((sc) => sc.id === doc.song![selectedSectionIndex]!.scene) : undefined
      const selectedPlacement =
        sp && sectionScene && (sectionScene.slots[sp.track] ?? []).some((p) => p.clip === sp.clip && p.at === sp.at) ? sp : null
      return { doc, parseError: null, selectedTrackId, selectedSectionIndex, selectedPlacement }
    }),
  setConnected: (connected) => set({ connected }),
  setParseError: (parseError) => set({ parseError }),
  setSelectedTrack: (selectedTrackId) => set({ selectedTrackId }),
  // Retargeting the section drops any explicit placement choice — a placement is meaningful only
  // within the section it was clicked in; the caller that DOES know a placement (ArrangementView's
  // audio clip-block click) sets it right after via setSelectedPlacement.
  setSelectedSection: (selectedSectionIndex) => set({ selectedSectionIndex, selectedPlacement: null }),
  setSelectedPlacement: (selectedPlacement) => set({ selectedPlacement }),
  setPlaying: (playing) => set({ playing }),
  setBottomPane: (bottomPane) => set({ bottomPane, bottomPaneOpen: true }),
  toggleBottomPane: () => set((s) => ({ bottomPane: s.bottomPane === 'clip' ? 'device' : 'clip', bottomPaneOpen: true })),
  setBottomPaneOpen: (bottomPaneOpen) => set({ bottomPaneOpen }),
  setBottomPaneHeight: (bottomPaneHeight) => set({ bottomPaneHeight }),
  toggleHistory: () => set((s) => ({ historyOpen: !s.historyOpen })),
  toggleMixer: () => set((s) => ({ mixerOpen: !s.mixerOpen })),
  toggleLibrary: () => set((s) => ({ libraryOpen: !s.libraryOpen })),
  setSelection: (selection) => set({ selection }),
  setEditNoteIds: (editNoteIds) => set({ editNoteIds }),
  toggleMute: (id) => set((s) => ({ mutes: { ...s.mutes, [id]: !s.mutes[id] } })),
  toggleSolo: (id) => set((s) => ({ solos: { ...s.solos, [id]: !s.solos[id] } })),
  setOverlapPolicy: (overlapPolicy) => set({ overlapPolicy }),
  setLoopRegion: (loopRegion) => set({ loopRegion }),
  setAuditioning: (auditioningTrackId) => set({ auditioningTrackId }),
  setUndoState: ({ canUndo, canRedo }) => set({ canUndo, canRedo }),
  bumpPresetEpoch: (trackId) => set((s) => ({ presetEpoch: { ...s.presetEpoch, [trackId]: (s.presetEpoch[trackId] ?? 0) + 1 } })),
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
