import { useEffect } from 'react'
import { initBridge } from './daemon/bridge'
import { useStore, selectedTrackId } from './state/store'
import { TransportBar } from './components/TransportBar'
import { StepSequencer } from './components/StepSequencer'
import { SynthPanel } from './components/SynthPanel'
import { InstrumentPanel } from './components/InstrumentPanel'
import { NoteView } from './components/NoteView'
import { Scope } from './components/Scope'
import { ArrangementView } from './components/ArrangementView'
import { MixerView } from './components/MixerView'
import { HistoryPanel } from './components/HistoryPanel'
import { VaryAffordance } from './components/VaryAffordance'
import { ExportButton } from './components/ExportButton'

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

/** The bottom detail pane — Ableton's Clip View / Device View for the selected track. Clip View is
 * the note/hit editor for the track's kind (StepSequencer for drums, NoteView/piano-roll otherwise);
 * Device View is the sound (InstrumentPanel for SoundFont tracks, SynthPanel otherwise). Reuses those
 * components verbatim — only their location and the toggle that reveals them are new. */
function BottomPane() {
  const doc = useStore((s) => s.doc)
  const selected = useStore(selectedTrackId)
  const pane = useStore((s) => s.bottomPane)
  const open = useStore((s) => s.bottomPaneOpen)
  const setBottomPane = useStore((s) => s.setBottomPane)
  const setBottomPaneOpen = useStore((s) => s.setBottomPaneOpen)
  if (!doc || !open) return null
  const track = doc.tracks.find((t) => t.id === selected)
  if (!track) return null

  // Which concrete editor/device the two facets resolve to for this track's kind — exactly the
  // decision the old Editor tab already made, just split across the Clip/Device toggle.
  const clip = track.kind === 'drums' ? <StepSequencer track={track} /> : <NoteView track={track} />
  const device = track.kind === 'instrument' ? <InstrumentPanel track={track} /> : <SynthPanel track={track} />

  return (
    <section className="bottom-pane" data-testid="bottom-pane" data-pane={pane}>
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

export function App() {
  const doc = useStore((s) => s.doc)
  const parseError = useStore((s) => s.parseError)
  const selected = useStore(selectedTrackId)
  const historyOpen = useStore((s) => s.historyOpen)
  const toggleHistory = useStore((s) => s.toggleHistory)
  const mixerOpen = useStore((s) => s.mixerOpen)
  const toggleMixer = useStore((s) => s.toggleMixer)

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

      {/* The one window: arrangement on top (always), the selection-following detail pane below. */}
      <div className="workspace">
        <main className="main-area">
          <ArrangementView />
        </main>
        {selected && <BottomPane />}
      </div>

      {/* Full mixer — an on-demand overlay, not a peer screen (research 18 Q3). */}
      {mixerOpen && (
        <div className="overlay-scrim" onClick={toggleMixer}>
          <div className="mixer-overlay" data-testid="mixer-overlay" onClick={(e) => e.stopPropagation()}>
            <div className="overlay-head">
              <span className="overlay-title">Mixer — all channel strips</span>
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
            <span className="overlay-title">Version history</span>
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
