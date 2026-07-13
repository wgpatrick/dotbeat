import { useCallback, useEffect, useRef, useState } from 'react'

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

// Plain numeric string for the edit field's pre-fill — deliberately NOT `format(value)`, since
// most of synthParams.ts's formatters (fmt.hz/db/pct/sec/cents/ratio/pan) append units/suffixes
// ("1.01 kHz", "+3.0", "50%") that don't round-trip back through Number() cleanly. The typed-entry
// field always works in the same raw numeric domain `onChange` expects.
function formatForEdit(value: number) {
  return String(Math.round(value * 1000) / 1000)
}

// Phase 31 Stream KD item 5 (docs/research/91 — pilots 90/91's real overshoots: detune to +48c,
// cutoff to 18kHz, resonance swinging past target). `onPointerMove` below maps drag distance to
// normalized position with the SAME fixed 140px-per-full-range constant for every knob regardless
// of `min`/`max`/`log` — investigated changing that mapping (e.g. scaling the 140 by each param's
// own range/curve so a given pixel distance feels more perceptually consistent), but
// verify-phase26-stream-dd.mjs's macro-knob check depends on the EXACT current constant
// ("dragging up exactly 70px (0.5 * 140px/unit) lands the knob at EXACTLY 50" — a real, currently-
// passing regression test against already-tuned behavior across the many existing knob call sites
// in synthParams.ts). Changing the mapping is a global behavior change with no way to scope it to
// only the "coarse" knobs without the SAME risk on knobs already tuned around the current constant
// — the smaller, contained fix per the plan's own "if normalizing risks too much behavior change"
// branch: a purely visual affordance, no change to onPointerMove/toNorm/fromNorm at all.
//
// `sensitive` flags a knob whose FULL RANGE traversal (still the same 140px for every knob) covers
// unusually much ground: every `log`-scaled param (cutoff/resonance-style curves compress a large
// multiplicative range into that fixed pixel distance, so equal norm-steps swing progressively
// LARGER absolute amounts as the drag approaches the top of the range — a real, asymmetric property
// linear knobs don't have) or any linear param whose own span is wide (`>= 20` in the param's own
// units — a practical threshold, not a precise one, chosen to catch resonance (0-20) and detune
// (±100c/range 200) without flagging the many small 0-1/±1-range percentage/pan knobs that don't
// need it). Sensitive knobs get a dashed background arc (a different "arc density," the plan's own
// suggested affordance) and a small min–max range readout so a user can judge, before the first
// drag, how much ground a given pixel distance is likely to cover.
function isSensitive(min: number, max: number, log: boolean): boolean {
  return log || max - min >= 20
}

export function Knob({ label, value, min, max, log = false, onChange, format, hint }: KnobProps) {
  const drag = useRef<{ startY: number; startNorm: number } | null>(null)
  const norm = Math.min(1, Math.max(0, toNorm(value, min, max, log)))
  const sensitive = isSensitive(min, max, log)
  const rangeHint = format ? `${format(min)}–${format(max)}` : `${min}–${max}`

  // Phase 27 Stream EI (research/72 §2.3, §3 item 3): click-to-type numeric entry. `.knob-value`
  // toggles from a static <div> into a real <input> on click; Enter/blur commits through the exact
  // same `onChange` the drag gesture already calls (no separate clamp/format path), Escape reverts
  // without committing.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Set right before an Enter/Escape-triggered setEditing(false) so the blur that unmounting the
  // input may fire doesn't also run (and potentially re-commit) the same edit.
  const suppressBlurCommit = useRef(false)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const startEdit = useCallback(() => {
    setDraft(formatForEdit(value))
    suppressBlurCommit.current = false
    setEditing(true)
  }, [value])

  const commitDraft = useCallback(() => {
    suppressBlurCommit.current = true
    const parsed = Number(draft)
    if (draft.trim() !== '' && Number.isFinite(parsed)) {
      // Respect min/max exactly like the drag path (which can never leave [0,1] normalized space,
      // hence never leaves [min,max]) — an out-of-range typed value clamps to the boundary rather
      // than being accepted raw.
      onChange(Math.min(max, Math.max(min, parsed)))
    }
    setEditing(false)
  }, [draft, min, max, onChange])

  const cancelEdit = useCallback(() => {
    suppressBlurCommit.current = true
    setEditing(false)
  }, [])

  const onValueKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commitDraft()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelEdit()
      }
    },
    [commitDraft, cancelEdit],
  )

  const onValueBlur = useCallback(() => {
    if (suppressBlurCommit.current) {
      suppressBlurCommit.current = false
      return
    }
    commitDraft()
  }, [commitDraft])

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
    <div
      className={`knob${sensitive ? ' knob-sensitive' : ''}`}
      title={sensitive ? `${hint ? hint + ' — ' : ''}wide/steep range (${rangeHint}) — a small drag can move this a lot` : hint}
      data-knob-sensitive={sensitive || undefined}
    >
      <svg
        width="40"
        height="40"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ cursor: 'ns-resize', touchAction: 'none' }}
      >
        <path
          d={arcPath(20, 20, 16, START_DEG, START_DEG + SWEEP)}
          stroke="#3a3a3a"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={sensitive ? '2 3' : undefined}
        />
        {norm > 0.001 && <path d={arcPath(20, 20, 16, START_DEG, angle)} stroke="var(--accent)" strokeWidth="3" fill="none" strokeLinecap="round" />}
        <circle cx="20" cy="20" r="12" fill="#2b2b2b" stroke="#1a1a1a" strokeWidth={1} />
        <line x1="20" y1="20" x2={nx} y2={ny} stroke="#dedede" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {editing ? (
        <input
          ref={inputRef}
          className="knob-value knob-value-input"
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onValueKeyDown}
          onBlur={onValueBlur}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          className="knob-value knob-value-display"
          tabIndex={0}
          role="button"
          aria-label={`${label} value, click to type a new value`}
          onClick={startEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              startEdit()
            }
          }}
        >
          {format ? format(value) : value.toFixed(2)}
        </div>
      )}
      <div className="knob-label">{label}</div>
      {sensitive && (
        <div className="knob-range-hint" data-knob-range={rangeHint}>
          {rangeHint}
        </div>
      )}
    </div>
  )
}
