import { useCallback, useRef } from 'react'

// Ported from BeatLab's src/components/Knob.tsx (docs/research/15 §4), with the ParamStatus /
// STATUS_COLOR ear-training grading feedback stripped — it imported from ../lessons/framework and
// has no meaning in dotbeat. Pure SVG arc knob, pointer-capture drag-to-value, log/linear scaling.

interface KnobProps {
  label: string
  value: number
  min: number
  max: number
  log?: boolean
  onChange: (v: number) => void
  format?: (v: number) => string
  hint?: string
}

const START_DEG = 135 // bottom-left
const SWEEP = 270

function toNorm(value: number, min: number, max: number, log: boolean) {
  if (log) return Math.log(value / min) / Math.log(max / min)
  return (value - min) / (max - min)
}

function fromNorm(norm: number, min: number, max: number, log: boolean) {
  if (log) return min * Math.pow(max / min, norm)
  return min + norm * (max - min)
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number) {
  const [x1, y1] = polar(cx, cy, r, fromDeg)
  const [x2, y2] = polar(cx, cy, r, toDeg)
  const large = toDeg - fromDeg > 180 ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

export function Knob({ label, value, min, max, log = false, onChange, format, hint }: KnobProps) {
  const drag = useRef<{ startY: number; startNorm: number } | null>(null)
  const norm = Math.min(1, Math.max(0, toNorm(value, min, max, log)))

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
      drag.current = { startY: e.clientY, startNorm: norm }
    },
    [norm],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return
      const dy = drag.current.startY - e.clientY
      const next = Math.min(1, Math.max(0, drag.current.startNorm + dy / 140))
      onChange(fromNorm(next, min, max, log))
    },
    [onChange, min, max, log],
  )

  const onPointerUp = useCallback(() => {
    drag.current = null
  }, [])

  const angle = START_DEG + norm * SWEEP
  const [nx, ny] = polar(20, 20, 11, angle)

  return (
    <div className="knob" title={hint}>
      <svg
        width="40"
        height="40"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ cursor: 'ns-resize', touchAction: 'none' }}
      >
        <path d={arcPath(20, 20, 16, START_DEG, START_DEG + SWEEP)} stroke="#3a3a3a" strokeWidth="3" fill="none" strokeLinecap="round" />
        {norm > 0.001 && <path d={arcPath(20, 20, 16, START_DEG, angle)} stroke="var(--accent)" strokeWidth="3" fill="none" strokeLinecap="round" />}
        <circle cx="20" cy="20" r="12" fill="#2b2b2b" stroke="#1a1a1a" strokeWidth={1} />
        <line x1="20" y1="20" x2={nx} y2={ny} stroke="#dedede" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="knob-value">{format ? format(value) : value.toFixed(2)}</div>
      <div className="knob-label">{label}</div>
    </div>
  )
}
