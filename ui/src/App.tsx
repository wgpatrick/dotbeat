import { useEffect } from 'react'
import { initBridge } from './daemon/bridge'
import { useStore, selectedTrackId } from './state/store'
import { TransportBar } from './components/TransportBar'
import { TrackList } from './components/TrackList'
import { StepSequencer } from './components/StepSequencer'
import { SynthPanel } from './components/SynthPanel'
import { NoteView } from './components/NoteView'
import { Scope } from './components/Scope'

export function App() {
  const doc = useStore((s) => s.doc)
  const parseError = useStore((s) => s.parseError)
  const selected = useStore(selectedTrackId)

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

  const track = doc.tracks.find((t) => t.id === selected) ?? doc.tracks[0]

  return (
    <div className="app" data-testid="app-ready">
      <header className="topbar">
        <div className="brand">dotbeat</div>
        <TransportBar />
      </header>
      {parseError && <div className="parse-error">file did not parse: {parseError} (still playing last good version)</div>}
      <div className="body">
        <aside className="sidebar">
          <TrackList />
          <Scope />
        </aside>
        <main className="editor">
          {track && track.kind === 'drums' && (
            <>
              <StepSequencer track={track} />
              <SynthPanel track={track} />
            </>
          )}
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
    </div>
  )
}
