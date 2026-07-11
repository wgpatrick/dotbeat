import { useEffect, useRef, useState } from 'react'
import { engine } from '../audio/engine'
import { onAnimationFrame } from '../audio/animationFrame'
import { useStore } from '../state/store'

// Ported from BeatLab's src/components/Scope.tsx (docs/research/15 §2 names it THE canvas-escape-
// hatch reference). One change: instead of owning a private requestAnimationFrame loop, it
// subscribes to the shared throttled rAF driver (audio/animationFrame.ts) — the enforced
// discipline that a second continuous view shouldn't spin up its own loop. The one reactive value
// it needs (masterLevel, for glow intensity) is captured in a ref so reading it per-frame doesn't
// retrigger the effect or a re-render — "throw state over the wall" via a ref, not a subscription.
const WIDTH = 240
const HEIGHT = 72

export function Scope() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<'wave' | 'spectrum'>('wave')
  const masterLevel = useStore((s) => s.masterLevel)
  const levelRef = useRef(masterLevel)
  levelRef.current = masterLevel

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const w = canvas.width
      const h = canvas.height
      const level = levelRef.current ?? -60
      const intensity = Math.max(0, Math.min(1, (level + 40) / 40))
      const glow = 4 + intensity * 10
      const color = `hsl(${38 - intensity * 10}, 100%, ${52 + intensity * 15}%)`

      ctx.fillStyle = '#0a0a0a'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, h / 2)
      ctx.lineTo(w, h / 2)
      ctx.stroke()

      ctx.shadowColor = color
      ctx.shadowBlur = glow
      ctx.strokeStyle = color
      ctx.fillStyle = color

      if (mode === 'wave') {
        const data = engine.getWaveformData()
        if (data && data.length) {
          ctx.lineWidth = 1.5
          ctx.beginPath()
          for (let i = 0; i < data.length; i++) {
            const x = (i / (data.length - 1)) * w
            const y = h / 2 - data[i]! * (h / 2 - 2)
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
      } else {
        const data = engine.getFftData()
        if (data && data.length) {
          const bars = 48
          const binsPerBar = Math.floor(data.length / bars)
          const barW = w / bars
          for (let i = 0; i < bars; i++) {
            let sum = 0
            for (let j = 0; j < binsPerBar; j++) sum += data[i * binsPerBar + j]!
            const dbv = sum / binsPerBar
            const norm = Math.max(0, Math.min(1, (dbv + 90) / 90))
            const barH = norm * (h - 4)
            ctx.fillRect(i * barW + 1, h - barH, barW - 2, barH)
          }
        }
      }
      ctx.shadowBlur = 0
    }

    return onAnimationFrame(draw)
  }, [mode])

  return (
    <div className="scope-section">
      <div className="scope-title" title="Live view of the whole mix">
        SCOPE
      </div>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="scope-canvas"
        title="Click to switch between waveform and spectrum"
        onClick={() => setMode((m) => (m === 'wave' ? 'spectrum' : 'wave'))}
      />
      <div className="scope-label">{mode === 'wave' ? 'Waveform' : 'Spectrum'} · master out</div>
    </div>
  )
}
