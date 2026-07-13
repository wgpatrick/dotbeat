import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { postEdit } from '../daemon/bridge'
import { loadWaveform, getCachedWaveform, drawWaveform, type WaveformData } from '../audio/waveform'
import { WARP_MODES, type BeatClip, type BeatTrack, type WarpMode } from '../types'
import { ClipPropertiesPanel, primaryClipFor, selectedSceneId } from './ClipPropertiesPanel'
import { readableTextOn } from './NoteView'

// Phase 30 Stream JE (docs/phase-30-plan.md, docs/research/88): the bottom Clip/Device panel — the
// one consistent, prominent editing surface every OTHER track kind (Synth, Drums, Instrument) uses —
// used to show an empty, meaningless note-grid ("0 notes · click a key to preview") for Audio
// tracks, even after a real clip was placed with working content. The actual audio editing controls
// (a waveform, in/out/gain/warp fields — `AudioClipInspector` below, moved here verbatim from
// ArrangementView.tsx where it used to render as a separate, small, unlabeled strip
// `.arr-audio-inspector` wedged between the arrangement grid and the bottom panel) now render
// directly in the bottom pane's Clip tab for an Audio-kind track, via App.tsx's BottomPane routing —
// the same "track-kind-specific bottom-panel content" precedent Drums already established there.
// One editing surface, always in the same place, always showing something relevant to the selected
// track, matching every other track kind.
//
// `AudioClipEditor` is the bottom-pane entry point (mirrors NoteView's own top-level shape: a colored
// titlebar naming the track/clip, then `ClipPropertiesPanel` for the loop/signature fields every
// clip-bearing track kind gets); `AudioClipInspector` is the actual waveform/trim/gain/warp editor,
// only rendered once a real audio region exists on the resolved clip.

/** The minimum-viable trim/gain/warp editor for an audio-region clip — numeric fields, not canvas
 * drag-handles (a real drag-gesture lift on top of the canvas's existing pointer/hit-testing code —
 * deliberately out of scope; see the block/handle-marker visual in ArrangementView.tsx's TrackRow).
 * Edits ride the ordinary postEdit `<track>.clip.<id>.audio.<field>` path (core's setValue already
 * carries it), so they're optimistic + debounced exactly like every other knob in the app. Renders a
 * static min/max-per-pixel-column waveform (ui/src/audio/waveform.ts), dimming whatever falls
 * outside [in, out] — decoded independently of the playback engine's own buffer cache. */
function AudioClipInspector({ track, clip }: { track: BeatTrack; clip: BeatClip }) {
  const region = clip.audio
  const doc = useStore((s) => s.doc)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [waveform, setWaveform] = useState<WaveformData | null>(null)
  const mediaPath = useMemo(() => {
    if (!region || !doc) return undefined
    return (doc.media as { id: string; path: string }[]).find((m) => m.id === region.media)?.path
  }, [doc, region])

  useEffect(() => {
    if (!region || !mediaPath) {
      setWaveform(null)
      return
    }
    const cached = getCachedWaveform(region.media)
    if (cached) {
      setWaveform(cached)
      return
    }
    let live = true
    loadWaveform(region.media, mediaPath)
      .then((wf) => {
        if (live) setWaveform(wf)
      })
      .catch((err) => console.warn(`[waveform] could not decode "${region.media}":`, err))
    return () => {
      live = false
    }
  }, [region, mediaPath])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !waveform || !region) return
    drawWaveform(canvas, waveform, region.in, region.out, track.color)
  }, [waveform, region, track.color])

  if (!region) return null
  const base = `${track.id}.clip.${clip.id}.audio`
  return (
    <div className="audio-clip-inspector" data-audio-clip-inspector={clip.id}>
      <canvas
        className="audio-clip-waveform"
        data-audio-waveform={clip.id}
        data-waveform-ready={waveform ? 'true' : 'false'}
        ref={canvasRef}
        width={600}
        height={48}
      />
      <div className="audio-clip-inspector-fields">
        <span className="audio-clip-inspector-label">{clip.id}:</span>
        <label>
          in
          <input type="number" step="0.01" min={0} defaultValue={region.in} data-audio-in={clip.id} onBlur={(e) => postEdit(`${base}.in`, e.target.value)} />
        </label>
        <label>
          out
          <input type="number" step="0.01" min={0} defaultValue={region.out} data-audio-out={clip.id} onBlur={(e) => postEdit(`${base}.out`, e.target.value)} />
        </label>
        <label>
          gain (dB)
          <input type="number" step="0.5" defaultValue={region.gainDb} data-audio-gain={clip.id} onBlur={(e) => postEdit(`${base}.gainDb`, e.target.value)} />
        </label>
        <label>
          warp
          <select value={region.warp} data-audio-warp={clip.id} onChange={(e) => postEdit(`${base}.warp`, e.target.value)}>
            {WARP_MODES.map((w: WarpMode) => (
              // `complex` is a legal enum value with no engine implementation yet (docs/format-spec.md
              // documents it as a deliberate, deferred scope cut; `beat inspect` already prints
              // "complex (unimplemented)" for it) — the label annotation communicates that without
              // blocking selection (still a legal, if inert, value to have on file).
              <option key={w} value={w}>
                {w === 'complex' ? `${w} (not yet implemented)` : w}
              </option>
            ))}
          </select>
        </label>
        {region.warp === 'repitch' && (
          <label>
            rate
            <input type="number" step="0.05" min={0.1} max={8} defaultValue={region.rate} data-audio-rate={clip.id} onBlur={(e) => postEdit(`${base}.rate`, e.target.value)} />
          </label>
        )}
      </div>
    </div>
  )
}

/** The bottom-pane Clip View for an Audio-kind track — App.tsx's BottomPane routes here instead of
 * NoteView whenever the selected track is `kind === 'audio'`. Resolves "the" clip the exact same way
 * every other clip-aware surface in the app does (`primaryClipFor`, the same helper
 * ClipPropertiesPanel/NoteView already share), so this always agrees with what's actually placed in
 * the currently-selected song section — no separate/duplicated clip-resolution logic. */
export function AudioClipEditor({ track }: { track: BeatTrack }) {
  const doc = useStore((s) => s.doc)
  const selectedSectionIndex = useStore((s) => s.selectedSectionIndex)
  if (!doc) return null
  const clip = primaryClipFor(track, doc, selectedSceneId(doc, selectedSectionIndex))
  const inSongMode = !!doc.song && doc.song.length > 0

  return (
    <div className="audio-clip-editor" data-audio-clip-editor={track.id}>
      <div className="noteview-titlebar" style={{ background: track.color, color: readableTextOn(track.color) }}>
        <span className="noteview-titlebar-name">{track.name}</span>
        {clip && <span className="noteview-titlebar-clip">clip &quot;{clip.id}&quot;</span>}
      </div>
      <ClipPropertiesPanel track={track} />
      {clip?.audio ? (
        <AudioClipInspector track={track} clip={clip} />
      ) : (
        // No audio region placed yet on this track (in this section) — Audio tracks have no "Place
        // in Arrangement" button (research/88: the placement mechanism is a drag from the Content
        // Browser onto the track HEADER, not the arrangement row), so the empty state points at that
        // gesture directly instead of showing an irrelevant note-grid.
        <div className="audio-clip-editor-empty" data-audio-clip-empty={track.id}>
          <span className="audio-clip-editor-empty-icon" aria-hidden="true">
            ♪
          </span>
          <p>
            {inSongMode
              ? 'No audio clip here yet. Drag a sample from the Browser onto this track\'s header (not the arrangement row) to create one.'
              : 'Add a song section first ("+ section"), then drag a sample from the Browser onto this track\'s header to create a clip — audio clips are song-mode-only.'}
          </p>
        </div>
      )}
    </div>
  )
}
