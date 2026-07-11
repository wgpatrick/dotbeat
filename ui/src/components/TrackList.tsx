import { type BeatTrack } from '../types'
import { postEdit } from '../daemon/bridge'
import { useStore, selectedTrackId } from '../state/store'

// The track list / selector down the left. Clicking a track selects it (locally, and pushes
// selected_track so the file records the same selection — a one-line diff). Kind badge distinguishes
// synth / drums / instrument.

export function TrackList() {
  const doc = useStore((s) => s.doc)
  const selected = useStore(selectedTrackId)
  const setSelectedTrack = useStore((s) => s.setSelectedTrack)
  if (!doc) return null

  const select = (t: BeatTrack) => {
    setSelectedTrack(t.id)
    postEdit('selected_track', t.id)
  }

  return (
    <div className="tracklist">
      <div className="tracklist-title">TRACKS</div>
      {doc.tracks.map((t) => (
        <button key={t.id} className={`track-row ${t.id === selected ? 'selected' : ''}`} onClick={() => select(t)}>
          <span className="track-swatch" style={{ background: t.color }} />
          <span className="track-name">{t.name}</span>
          <span className={`track-kind kind-${t.kind}`}>{t.kind}</span>
        </button>
      ))}
    </div>
  )
}
