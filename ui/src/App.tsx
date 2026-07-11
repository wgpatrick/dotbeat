import { useEffect } from 'react'
import { initBridge } from './daemon/bridge'
import { useStore, selectedTrackId } from './state/store'
import { TransportBar } from './components/TransportBar'
import { TrackList } from './components/TrackList'
import { StepSequencer } from './components/StepSequencer'
import { SynthPanel } from './components/SynthPanel'
import { NoteView } from './components/NoteView'
import { Scope } from './components/Scope'
import { ArrangementView } from './components/ArrangementView'
import { MixerView } from './components/MixerView'
import type { AppView } from './types'

const VIEW_TABS: { id: AppView; label: string }[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'arrangement', label: 'Arrangement' },
  { id: 'mixer', label: 'Mixer' },
]

/** The per-track editor: track list sidebar + the focused track's step grid / synth panel. This is
 * Stream 1's original single screen, now one of three tabs. */
function EditorView() {
  const doc = useStore((s) => s.doc)
  const selected = useStore(selectedTrackId)
  if (!doc) return null
  const track = doc.tracks.find((t) => t.id === selected) ?? doc.tracks[0]
  return (
    <div className="body">
      <aside className="sidebar">
        <TrackList />
        <Scope />
      </aside>
      <main className="editor">
        {track && track.kind === 'drums' && <StepSequencer track={track} />}
        {track && track.kind === 'synth' && (
          <>
            <SynthPanel track={track} />
            <NoteView track={track} />
          </>
        )}
        {track && track.kind === 'instrument' && (
          <div className="instrument-note">
            <div className="editor-toolbar">
              <span className="editor-title" style={{ color: track.color }}>
                {track.name}
              </span>
              <span className="toolbar-tip">instrument (SoundFont) track — editing surface is a later stream</span>
            </div>
            <NoteView track={track} />
          </div>
        )}
      </main>
    </div>
  )
}

export function App() {
  const doc = useStore((s) => s.doc)
  const parseError = useStore((s) => s.parseError)
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)

  useEffect(() => {
    initBridge()
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
        <nav className="view-tabs">
          {VIEW_TABS.map((t) => (
            <button key={t.id} className={`view-tab ${view === t.id ? 'active' : ''}`} data-view={t.id} onClick={() => setView(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <TransportBar />
      </header>
      {parseError && <div className="parse-error">file did not parse: {parseError} (still playing last good version)</div>}
      {view === 'editor' && <EditorView />}
      {view === 'arrangement' && <ArrangementView />}
      {view === 'mixer' && <MixerView />}
    </div>
  )
}
