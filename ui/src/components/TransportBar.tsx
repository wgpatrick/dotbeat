import { engine } from '../audio/engine'
import { postEdit, postUndo, postRedo } from '../daemon/bridge'
import { useStore } from '../state/store'

// Adapted from BeatLab's src/components/TransportBar.tsx (docs/research/15 §4): the play/stop
// transport and the bar·beat readout from currentStep (Math.floor(step/16)+1). Stripped: the
// lesson/mode navigation (currentLessonId/loadLesson/goToTrackLab), quantize-strength, and
// MIDI-connect — lesson chrome or later-stream surface. BPM edits POST the `bpm` primitive (a
// one-line diff) and retune the running transport live.
//
// Phase 26 Stream DB (research/28) rebuilt undo/redo: two buttons here, greyed out via the
// daemon's `canUndo`/`canRedo` (GET /undo-state + the `undo-state` SSE event, mirrored in
// state/store.ts) — research/28 §5.6's own recommended affordance ("TransportBar ... can grey out
// Undo/Redo when the respective stack is empty"), not a History-panel-style flat list: that panel
// is the separate, durable, git-backed checkpoint timeline (HistoryPanel.tsx / POST /restore) and
// research/28 §1(c) is explicit the two should stay visually distinct so a user never wonders which
// one they just triggered. The buttons are a secondary affordance — Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z
// (App.tsx's global key handler) are the primary path, same split as the History panel's "Go back"
// button vs. no keyboard shortcut of its own.

export function TransportBar() {
  const doc = useStore((s) => s.doc)
  const playing = useStore((s) => s.playing)
  const currentStep = useStore((s) => s.currentStep)
  const connected = useStore((s) => s.connected)
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)

  if (!doc) return null

  const bar = currentStep >= 0 ? Math.floor(currentStep / 16) + 1 : 1
  const beat = currentStep >= 0 ? Math.floor((currentStep % 16) / 4) + 1 : 1
  // Song mode's real length is the sum of its sections, not the vestigial loopBars field (which
  // only means anything in plain loop mode, no `song` array) — showing loopBars unconditionally
  // here read as a nonsensical "4 bars" on a 29-bar, 5-section song (owner-caught).
  const totalBars = doc.song && doc.song.length > 0 ? doc.song.reduce((n, s) => n + s.bars, 0) : doc.loopBars
  const barsLabel = doc.song && doc.song.length > 0 ? 'Song' : 'Loop'

  const onBpm = (v: number) => {
    if (!Number.isFinite(v) || v < 20 || v > 999) return
    postEdit('bpm', String(Math.round(v)))
    engine.setBpm(v)
  }

  return (
    <div className="transport">
      <button className={`play-btn ${playing ? 'stop' : ''}`} onClick={() => (playing ? engine.stop() : void engine.play())}>
        {playing ? '■ Stop' : '▶ Play'}
      </button>
      <div className="undo-redo-group">
        <button
          className="undo-btn"
          data-action="undo"
          disabled={!canUndo}
          onClick={() => void postUndo()}
          title="Undo (Ctrl/Cmd+Z) — in-session only, separate from version history"
        >
          ↶ Undo
        </button>
        <button
          className="undo-btn"
          data-action="redo"
          disabled={!canRedo}
          onClick={() => void postRedo()}
          title="Redo (Ctrl/Cmd+Shift+Z) — in-session only, separate from version history"
        >
          ↷ Redo
        </button>
      </div>
      <div className="transport-field">
        <label>BPM</label>
        <input type="number" min={20} max={999} value={doc.bpm} onChange={(e) => onBpm(Number(e.target.value))} />
      </div>
      <div className="transport-field">
        <label>{barsLabel}</label>
        <span className="transport-readout">{totalBars}</span>
      </div>
      <div className="transport-field">
        <label>Position</label>
        <span className="transport-readout position">
          {bar}.{beat}
        </span>
      </div>
      <div className="spacer" />
      <div className={`conn ${connected ? 'ok' : 'down'}`} title={connected ? 'daemon connected' : 'daemon not connected'}>
        {connected ? '● daemon' : '○ offline'}
      </div>
    </div>
  )
}
