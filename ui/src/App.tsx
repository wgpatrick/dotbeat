import { useCallback, useEffect, useState } from 'react'
import { initBridge, postUndo, postRedo } from './daemon/bridge'
import { useStore, selectedTrackId } from './state/store'
import { TransportBar } from './components/TransportBar'
import { SynthPanel } from './components/SynthPanel'
import { InstrumentPanel } from './components/InstrumentPanel'
import { NoteView } from './components/NoteView'
import { Scope } from './components/Scope'
import { ArrangementView } from './components/ArrangementView'
import { MixerView } from './components/MixerView'
import { HistoryPanel } from './components/HistoryPanel'
import { VaryAffordance } from './components/VaryAffordance'
import { ExportButton } from './components/ExportButton'
import { ContentBrowser } from './components/ContentBrowser'

// Phase 18 — the Ableton-shaped recomposition (docs/phase-18-layout.md, driven by
// docs/research/18-ableton-ui-architecture.md). The old four-tab switcher (Editor / Arrangement /
// Mixer / History, each a full-screen peer) is gone. Research 18's headline finding: Ableton is not
// tabs — it's one window with two always-present regions. So dotbeat is now:
//
//   • ONE main area, unconditionally the Arrangement timeline (ArrangementView, promoted from a tab
//     to the permanent main view; its track headers now carry an inline mixer strip).
//   • A BOTTOM detail pane that follows the selected track and toggles between Clip View (the note/
//     hit editor — NoteView or StepSequencer) and Device View (the sound — SynthPanel/InstrumentPanel)
//     via Shift+Tab or the Clip/Device labels. This is Ableton's Shift+Tab mechanism.
//   • The full Mixer (all channel strips) demoted to an on-demand OVERLAY (the "step back and
//     balance" mode, research 18 Q3) reached from a top-bar button — NOT a peer screen.
//   • Version history as a slide-out DRAWER (research 18 has no direct analog; dotbeat's own idiom),
//     not competing with the bottom pane for screen space.
//   • VaryAffordance unchanged — it's already selection-triggered, not tab-bound (verified: it reads
//     the store's D2 selection and renders a contextual bar regardless of any layout state).
//   • Phase 22 Stream AH ADDED a collapsible LEFT rail (ContentBrowser — presets/kits/soundfonts,
//     research 18 §8 "Browser/sidebar") alongside the arrangement, toggled by a topbar button next
//     to Mixer/History. Purely additive: `.app-body` is a new flex ROW wrapping the rail + the
//     existing `.workspace` column unchanged — nothing inside ArrangementView/BottomPane moved.

/** The bottom detail pane — Ableton's Clip View / Device View for the selected track. Clip View is
 * NoteView for every track kind (Phase 22 Stream AB retired StepSequencer — NoteView now takes a
 * row-axis adapter and handles drum tracks via a named-lane adapter, the same "one editor, two row
 * models" shape Ableton itself uses for its Drum Rack — see NoteView.tsx's header comment); Device
 * View is the sound (InstrumentPanel for SoundFont tracks, SynthPanel otherwise). */
function BottomPane() {
  const doc = useStore((s) => s.doc)
  const selected = useStore(selectedTrackId)
  const pane = useStore((s) => s.bottomPane)
  const open = useStore((s) => s.bottomPaneOpen)
  const setBottomPane = useStore((s) => s.setBottomPane)
  const setBottomPaneOpen = useStore((s) => s.setBottomPaneOpen)
  const height = useStore((s) => s.bottomPaneHeight)
  if (!doc || !open) return null
  const track = doc.tracks.find((t) => t.id === selected)
  if (!track) return null

  const clip = <NoteView track={track} />
  const device = track.kind === 'instrument' ? <InstrumentPanel track={track} /> : <SynthPanel track={track} />

  return (
    <section
      className="bottom-pane"
      data-testid="bottom-pane"
      data-pane={pane}
      // Phase 24 Stream CA: an explicit drag-set height overrides the CSS default (42vh). `undefined`
      // (height === null) leaves the CSS rule in charge, so a session that never touches the divider
      // renders byte-identical to before this stream.
      style={height != null ? { height: `${height}px` } : undefined}
    >
      <div className="bottom-pane-bar">
        <span className="bottom-pane-track" style={{ color: track.color }} title={`selected track: ${track.name}`}>
          {track.name}
        </span>
        <div className="pane-toggle" role="tablist" aria-label="clip / device view">
          <button
            className={`pane-tab ${pane === 'clip' ? 'active' : ''}`}
            data-pane-tab="clip"
            role="tab"
            aria-selected={pane === 'clip'}
            onClick={() => setBottomPane('clip')}
            title="edit the clip's notes/hits"
          >
            Clip
          </button>
          <button
            className={`pane-tab ${pane === 'device' ? 'active' : ''}`}
            data-pane-tab="device"
            role="tab"
            aria-selected={pane === 'device'}
            onClick={() => setBottomPane('device')}
            title="edit the track's sound"
          >
            Device
          </button>
        </div>
        <span className="bottom-pane-hint">Shift+Tab toggles</span>
        <button
          className="pane-collapse"
          data-action="collapse-pane"
          onClick={() => setBottomPaneOpen(false)}
          title="close the detail pane (select a track to reopen)"
        >
          ✕
        </button>
      </div>
      <div className="bottom-pane-body">{pane === 'clip' ? clip : device}</div>
    </section>
  )
}

// Phase 24 Stream CA: a draggable horizontal divider between `.main-area` and `.bottom-pane`. Same
// window-level pointermove/pointerup drag idiom ArrangementView.tsx's own section-resize handle
// (`beginResize`) already establishes — preview live while dragging, no daemon/file write at all
// here (this is pure session UI state, see the `bottomPaneHeight` doc comment in state/store.ts).
const MIN_PANE_HEIGHT = 200 // matches the pre-existing CSS min-height — never let the pane collapse away
const MIN_MAIN_AREA_HEIGHT = 160 // don't let the pane swallow the whole arrangement either
const DIVIDER_HEIGHT = 6

function PaneDivider() {
  const setHeight = useStore((s) => s.setBottomPaneHeight)
  const [drag, setDrag] = useState<{ startY: number; startHeight: number } | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    // Read the pane's REAL current height off the DOM rather than trusting the store's own value —
    // it may still be null (CSS default 42vh in effect), and this is the one honest source of the
    // actual pixel height regardless of which is currently driving layout.
    const paneEl = document.querySelector('.bottom-pane') as HTMLElement | null
    const startHeight = paneEl?.getBoundingClientRect().height ?? MIN_PANE_HEIGHT
    setDrag({ startY: e.clientY, startHeight })
  }, [])

  useEffect(() => {
    if (!drag) return
    const onMove = (e: PointerEvent) => {
      const workspace = document.querySelector('.workspace') as HTMLElement | null
      const workspaceHeight = workspace?.getBoundingClientRect().height ?? Infinity
      const maxHeight = Math.max(MIN_PANE_HEIGHT, workspaceHeight - MIN_MAIN_AREA_HEIGHT - DIVIDER_HEIGHT)
      // The divider sits ABOVE the pane, so dragging UP (clientY decreases) should grow it.
      const delta = drag.startY - e.clientY
      const next = Math.min(maxHeight, Math.max(MIN_PANE_HEIGHT, drag.startHeight + delta))
      setHeight(next)
    }
    const onUp = () => setDrag(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, setHeight])

  return (
    <div
      className={`pane-divider ${drag ? 'dragging' : ''}`}
      data-testid="pane-divider"
      onPointerDown={onPointerDown}
      // Double-click resets to the CSS default (42vh) — a quick way back after over-dragging.
      onDoubleClick={() => setHeight(null)}
      style={{ touchAction: 'none' }}
      title="drag to resize the clip/device pane (double-click to reset)"
    />
  )
}

export function App() {
  const doc = useStore((s) => s.doc)
  const parseError = useStore((s) => s.parseError)
  const selected = useStore(selectedTrackId)
  const historyOpen = useStore((s) => s.historyOpen)
  const toggleHistory = useStore((s) => s.toggleHistory)
  const mixerOpen = useStore((s) => s.mixerOpen)
  const toggleMixer = useStore((s) => s.toggleMixer)
  const libraryOpen = useStore((s) => s.libraryOpen)
  const toggleLibrary = useStore((s) => s.toggleLibrary)

  useEffect(() => {
    initBridge()
  }, [])

  // Shift+Tab toggles Clip/Device (Ableton's exact shortcut, research 18 §1). Global, but yields to
  // form controls so it never hijacks the BPM box or a panel <select> — the same guard NoteView's
  // key handler uses. Reads/writes the store directly so the listener attaches once.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Tab' || !e.shiftKey) return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      e.preventDefault()
      useStore.getState().toggleBottomPane()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Phase 26 Stream DB (research/28 §5.5): Ctrl/Cmd+Z (undo) and Ctrl/Cmd+Shift+Z (redo) — the
  // session-only, ephemeral document-snapshot stack, deliberately separate from the git-backed
  // History drawer (POST /restore). Same global-listener-with-form-control-guard shape as the
  // Shift+Tab handler above, extended per research/28's own note ("extending the exact pattern
  // already established for Shift+Tab"). Every edit already goes through the daemon rather than
  // mutating client state directly (bridge.ts's file↔GUI model), so this POSTs /undo or /redo
  // instead of touching the store — postUndo/postRedo apply the daemon's returned document.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      // Ctrl/Cmd+Z (undo), Ctrl/Cmd+Shift+Z (redo), plus Ctrl/Cmd+Y as the common Windows redo alt.
      const isUndo = key === 'z' && !e.shiftKey
      const isRedo = (key === 'z' && e.shiftKey) || key === 'y'
      if (!isUndo && !isRedo) return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el?.isContentEditable) return
      e.preventDefault()
      if (isRedo) void postRedo()
      else void postUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!doc) {
    return (
      <div className="app loading">
        <div className="brand">dotbeat</div>
        <div className="loading-msg">connecting to daemon…</div>
      </div>
    )
  }

  return (
    <div className="app" data-testid="app-ready">
      <header className="topbar">
        <div className="brand">dotbeat</div>
        <TransportBar />
        <div className="topbar-scope">
          <Scope />
        </div>
        <div className="topbar-actions">
          <ExportButton />
          <button
            className={`topbar-btn ${libraryOpen ? 'active' : ''}`}
            data-action="toggle-library"
            onClick={toggleLibrary}
            title="browse presets, kits, and soundfonts"
          >
            Browser
          </button>
          <button
            className={`topbar-btn ${mixerOpen ? 'active' : ''}`}
            data-action="toggle-mixer"
            onClick={toggleMixer}
            title="open the full mixer (all channel strips)"
          >
            Mixer
          </button>
          <button
            className={`topbar-btn ${historyOpen ? 'active' : ''}`}
            data-action="toggle-history"
            onClick={toggleHistory}
            title="version history"
          >
            History
          </button>
        </div>
      </header>
      {parseError && <div className="parse-error">file did not parse: {parseError} (still playing last good version)</div>}
      {/* The inline vary-and-audition affordance (Phase 15 Stream I): a contextual bar that appears
          whenever there's a selection — Photoshop's Contextual Task Bar pattern. Selection-triggered,
          not tab-bound, so it rides above the whole workspace unchanged by the Phase 18 recomposition. */}
      <VaryAffordance />

      {/* Phase 22 Stream AH: a new flex ROW wrapping the optional content-browser rail + the
          existing workspace column — additive, the workspace's own internals are unchanged. */}
      <div className="app-body">
        {libraryOpen && <ContentBrowser />}
        {/* The one window: arrangement on top (always), the selection-following detail pane below. */}
        <div className="workspace">
          <main className="main-area">
            <ArrangementView />
          </main>
          {selected && (
            <>
              <PaneDivider />
              <BottomPane />
            </>
          )}
        </div>
      </div>

      {/* Full mixer — an on-demand overlay, not a peer screen (research 18 Q3). */}
      {mixerOpen && (
        <div className="overlay-scrim" onClick={toggleMixer}>
          <div className="mixer-overlay" data-testid="mixer-overlay" onClick={(e) => e.stopPropagation()}>
            <div className="overlay-head">
              <span className="overlay-title section-heading">Mixer — all channel strips</span>
              <button className="topbar-btn" data-action="close-mixer" onClick={toggleMixer} title="close mixer">
                Close
              </button>
            </div>
            <MixerView />
          </div>
        </div>
      )}

      {/* Version history — a slide-out drawer over the main view. */}
      {historyOpen && (
        <aside className="history-drawer" data-testid="history-drawer">
          <div className="overlay-head">
            <span className="overlay-title section-heading">Version history</span>
            <button className="topbar-btn" data-action="close-history" onClick={toggleHistory} title="close history">
              Close
            </button>
          </div>
          <HistoryPanel />
        </aside>
      )}
    </div>
  )
}
