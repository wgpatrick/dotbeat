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
//
// Phase 30 Stream JB (research/89 "Undo got interesting fast"): these buttons used to set the real
// HTML `disabled` attribute from `canUndo`/`canRedo`, which — unlike App.tsx's Ctrl/Cmd+Z handler,
// which always just calls postUndo() unconditionally — makes a click a genuine browser no-op
// whenever that mirrored flag lags the true daemon state (bridge.ts's postEdit debounces the actual
// network write up to ~60ms after the optimistic local edit, so `canUndo` could still read stale-
// false right after a fresh, undoable edit). The keyboard shortcut never had this failure mode
// because it never gates the call on `canUndo` in the first place. Fixed at the root in bridge.ts
// (postEdit now bumps `canUndo`/`canRedo` optimistically, and postUndo/postRedo flush any pending
// debounced edit before popping), but the button ALSO now matches the keyboard's own "just always
// try, let the daemon no-op on an empty stack" behavior instead of a second, independent point of
// failure: `aria-disabled` + a CSS class dim the button when the stack looks empty, but the native
// `disabled` attribute (and its click-blocking) is gone, so `onClick` is exactly as reliable as
// Ctrl/Cmd+Z — both paths now call the identical postUndo()/postRedo().

/** m:ss for anything under an hour, h:mm:ss above it. Shared by the position and length readouts so
 * the two can never disagree about how a duration is spelled (Phase 41 Stream D). */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

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
  // Phase 41 Stream D: wall-clock alongside bars. At 242 bars a bar number stops answering the
  // question you actually have ("how long is this, and how far in am I?") — 7 minutes is a fact
  // about the track, 242 bars is a fact about the grid. Both readouts now sit side by side rather
  // than one replacing the other.
  //
  // 4/4 is the document's implicit signature (src/core/document.ts: a per-CLIP `signature` may
  // override it locally, but there is no document-level meter, so a song-length figure has nothing
  // else to compute from) — hence 4 beats per bar, 240/bpm seconds per bar.
  const secPerBar = 240 / doc.bpm
  const posSeconds = currentStep >= 0 ? (currentStep / 16) * secPerBar : 0
  const totalSeconds = totalBars * secPerBar

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
          className={`undo-btn${canUndo ? '' : ' stack-empty'}`}
          data-action="undo"
          aria-disabled={!canUndo}
          onClick={() => void postUndo()}
          title="Undo (Ctrl/Cmd+Z) — in-session only, separate from version history"
        >
          ↶ Undo
        </button>
        <button
          className={`undo-btn${canRedo ? '' : ' stack-empty'}`}
          data-action="redo"
          aria-disabled={!canRedo}
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
        <span className="transport-readout" data-total-bars={totalBars}>
          {totalBars}
          <span className="transport-clock" data-total-seconds={totalSeconds.toFixed(2)}>
            {formatClock(totalSeconds)}
          </span>
        </span>
      </div>
      <div className="transport-field">
        <label>Position</label>
        <span className="transport-readout position">
          {bar}.{beat}
          <span className="transport-clock" data-position-seconds={posSeconds.toFixed(2)}>
            {formatClock(posSeconds)}
          </span>
        </span>
      </div>
      <div className="spacer" />
      <div className={`conn ${connected ? 'ok' : 'down'}`} title={connected ? 'daemon connected' : 'daemon not connected'}>
        {connected ? '● daemon' : '○ offline'}
      </div>
    </div>
  )
}
