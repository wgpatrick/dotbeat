import { useState } from 'react'
import { engine } from '../audio/engine'
import { useStore } from '../state/store'

// Phase 20 Stream X — render/export from the GUI. There was no way to get a WAV out of the app
// without dropping to the CLI (`beat render`, cli/render.mjs). But cli/render.mjs and
// ui/verify-engine-parity.mjs already establish the real capture mechanism: drive the live engine
// (ui/src/audio/engine.ts) with `engine.play()` then capture its post-limiter master output with
// `engine.recordWav(seconds)` (MediaRecorder -> opus -> decode -> WAV, ported from BeatLab). This
// button does exactly that, in the user's own already-open tab — no new capture code, no second
// engine, no headless browser. See docs/phase-20-render-export.md for the download-vs-write-to-disk
// decision (this button downloads; the daemon is not touched).
//
// Same render-length formula as engine.play()'s transport.loopEnd and cli/render.mjs's `seconds`:
// a `song` block plays its full timeline (sum of section bars), otherwise one loop pass.
function renderSeconds(doc: { bpm: number; loopBars: number; song: { scene: string; bars: number }[] | null }): number {
  const renderBars = doc.song && doc.song.length > 0 ? doc.song.reduce((sum, s) => sum + s.bars, 0) : doc.loopBars
  return (renderBars * 16 * 60) / doc.bpm / 4
}

type ExportStatus = 'idle' | 'rendering' | 'done' | 'error'

export function ExportButton() {
  const doc = useStore((s) => s.doc)
  const [status, setStatus] = useState<ExportStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  if (!doc) return null

  async function runExport() {
    if (!doc || status === 'rendering') return
    setStatus('rendering')
    setError(null)
    const wasPlaying = useStore.getState().playing
    try {
      const seconds = renderSeconds(doc)
      await engine.play()
      await new Promise((r) => setTimeout(r, 250)) // let the graph settle before capture, same as cli/render.mjs
      const blob = await engine.recordWav(seconds)
      if (!wasPlaying) engine.stop() // leave transport as we found it; if it was already playing, let it keep going

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      a.href = url
      a.download = `dotbeat-export-${stamp}.wav`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      setStatus('done')
      setTimeout(() => setStatus((s) => (s === 'done' ? 'idle' : s)), 2000)
    } catch (err) {
      engine.stop()
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const label = status === 'rendering' ? 'Rendering…' : status === 'done' ? 'Exported ✓' : status === 'error' ? 'Export failed' : 'Export'

  return (
    <button
      className={`topbar-btn export-btn ${status}`}
      data-action="export-render"
      onClick={() => void runExport()}
      disabled={status === 'rendering'}
      title={error ?? 'render the project through the live engine and download a WAV'}
    >
      {status === 'rendering' && <span className="export-spinner" aria-hidden="true" />}
      {label}
    </button>
  )
}
