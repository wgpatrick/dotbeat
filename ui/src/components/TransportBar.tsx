import { engine } from '../audio/engine'
import { postEdit } from '../daemon/bridge'
import { useStore } from '../state/store'

// Adapted from BeatLab's src/components/TransportBar.tsx (docs/research/15 §4): the play/stop
// transport and the bar·beat readout from currentStep (Math.floor(step/16)+1). Stripped: the
// lesson/mode navigation (currentLessonId/loadLesson/goToTrackLab), undo/redo, quantize-strength,
// and MIDI-connect — all either lesson chrome or later-stream surface. BPM edits POST the `bpm`
// primitive (a one-line diff) and retune the running transport live.

export function TransportBar() {
  const doc = useStore((s) => s.doc)
  const playing = useStore((s) => s.playing)
  const currentStep = useStore((s) => s.currentStep)
  const connected = useStore((s) => s.connected)

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
