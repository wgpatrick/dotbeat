import { useEffect, useRef } from 'react'

// Phase 32 Stream LA (docs/phase-32-plan.md, docs/research/81/87/92/93): the first genuinely
// reusable menu/popup component in the codebase. Before this stream the only precedent was the
// automation lane's own bespoke right-click breakpoint popup (Phase 26 Stream DI,
// ArrangementView.tsx's `.arr-auto-popup`) — a one-off `position: absolute` element positioned in
// LANE-LOCAL pixel coordinates (relative to its own scrolling ancestor), which only works because
// that popup is rendered as a direct child of the exact element its coordinates are measured
// against. A right-click context menu needs to work from ANY component (a note in the piano roll, a
// clip block in the arrangement, each with its own scroll/zoom context), so this uses
// `position: fixed` in raw VIEWPORT coordinates instead — correct regardless of which scrolled
// container the triggering element lives inside, at the cost of not being usable as an ancestor of
// something that itself needs a `transform`/`filter`/`contain: paint` (none of dotbeat's structural
// containers use those today — grepped styles.css before choosing this).
//
// Dismiss on Escape (from anywhere) AND on an outside pointerdown, both wired up from the moment
// this component exists — the automation popup's own Phase 29 Stream GE follow-up fix (it used to
// dismiss ONLY via Escape while its own numeric input had focus, or a further click inside the SAME
// lane) is folded in here as the baseline, not a bug to discover later.

export interface ContextMenuItem {
  key: string
  label: string
  onSelect: () => void
  disabled?: boolean
  title?: string
  /** Visually distinct (red-leaning) treatment for a destructive action, e.g. Delete — same
   * "danger" idiom the rest of the app already uses for irreversible actions (track delete's `×`,
   * `note-del-btn`). */
  danger?: boolean
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  testId,
}: {
  /** Viewport-relative coordinates (a right-click's own `clientX`/`clientY`) — NOT relative to any
   * scrolled ancestor. */
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
  /** Rendered as `data-ctx-menu` for live-verify scripts to target a specific menu instance
   * (e.g. which note/clip-block it opened for). */
  testId?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointerDownOutside = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // capture phase: a right-click that opens ANOTHER context menu elsewhere (e.g. jumping straight
    // from one note's menu to another note) still counts as "outside" even though that second
    // right-click's own contextmenu handler runs after this pointerdown listener in bubble order.
    document.addEventListener('pointerdown', onPointerDownOutside, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDownOutside, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  // Keep the menu fully on-screen — opened near the right/bottom viewport edge would otherwise
  // render partially (or fully) off-canvas, since `x`/`y` are raw cursor coordinates with no clamping.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const overflowX = rect.right - window.innerWidth
    const overflowY = rect.bottom - window.innerHeight
    if (overflowX > 0) el.style.left = `${Math.max(0, x - overflowX - 4)}px`
    if (overflowY > 0) el.style.top = `${Math.max(0, y - overflowY - 4)}px`
  }, [x, y])

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: x, top: y }}
      data-ctx-menu={testId}
      // A pointerdown/contextmenu landing on the menu itself must never be treated as "outside" (the
      // capture-phase listener above already excludes it via `.contains`) nor open a SECOND, nested
      // browser context menu on top of this one.
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={`ctx-menu-item${it.danger ? ' danger' : ''}`}
          disabled={it.disabled}
          title={it.title}
          data-ctx-item={it.key}
          onClick={() => {
            if (it.disabled) return
            it.onSelect()
            onClose()
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
