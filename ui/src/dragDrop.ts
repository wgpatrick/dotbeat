// Shared drag-state / drop-highlight primitive — Phase 27 Stream EB (docs/research/74-ux-drag-and-drop.md).
//
// Before this file, dotbeat had FOUR independent, inconsistent answers to "something is being
// dragged"/"this is a valid drop target": `ArrangementView.tsx`'s track header used a bare boolean
// with a real named CSS class (`.drop-target-hover`, dashed amber outline); `NoteView.tsx`'s
// drum-lane drop target used a hardcoded inline `#2f5d3a` fill with no shared class at all;
// `SynthPanel.tsx`'s effect-chain reorder and `ArrangementView.tsx`'s section-chip reorder each
// independently invented `opacity: 0.4` + accent border; `ArrangementView.tsx`'s clip-block move
// used yet a third opacity value (0.65) plus a dashed border; and `NoteView.tsx`'s note move/resize
// had no "currently dragging" visual at all. See research/74 §3 for the full inventory.
//
// This module is the one place both halves of that answer live now:
//   - `.dragging` / `.drop-target-hover` are the canonical class names (rules in styles.css) —
//     every drag source/drop target in the app should reference them by name, not invent a new
//     opacity value or inline color.
//   - `makeDropTargetHandlers` is the actual bug fix (research/74 §3.1, phase-27-plan.md bug 5):
//     `ArrangementView.tsx`'s track-header `onDragLeave={() => setDropHover(false)}` was a bare
//     boolean with no dragenter/dragleave counter and no `relatedTarget`/`contains()` check.
//     `.arr-track-header` is densely packed with interactive children (checkbox, swatch,
//     rename/delete buttons, the InlineStrip's mute/solo/volume/pan controls); native
//     `dragenter`/`dragleave` target the DEEPEST element under the cursor and bubble, so crossing
//     from the target's own background onto ANY child re-fires `dragleave` on the target and
//     cancels the highlight — verified live: an `elementFromPoint` scan of the header's ~14,500px²
//     area found only ~200px² where the header itself (not a child) is the resolved element.
//     The fix: use `relatedTarget` (the element the pointer is entering) and `.contains()` to tell
//     "actually left the target" apart from "moved onto a child still inside the target." That
//     survives crossing any number of interactive children, which a plain enter/leave counter would
//     also do but at the cost of extra state to keep in sync on unmount/cancelled drags — the
//     `relatedTarget` check needs none.
//   - `useDropTarget` wraps that in a hook for the common one-target-per-component case (e.g. one
//     track header). Multi-target consumers (e.g. NoteView's per-row drum-lane targets, one drop
//     target per rendered row, which can't each own a hook call inside a loop) call
//     `makeDropTargetHandlers` directly per row against one shared "which row is hovered" piece of
//     state instead.

import { useState } from 'react'
import type { DragEvent } from 'react'

/** Applied to the drag SOURCE for the duration of a gesture. See `.dragging` in styles.css. */
export const DRAGGING_CLASS = 'dragging'

/** Applied to a drop TARGET while a valid drag is over it. See `.drop-target-hover` in styles.css. */
export const DROP_TARGET_HOVER_CLASS = 'drop-target-hover'

export interface DropTargetHandlers<E extends Element = Element> {
  onDragOver: (e: DragEvent<E>) => void
  onDragLeave: (e: DragEvent<E>) => void
  onDrop: (e: DragEvent<E>) => void
}

/**
 * Build native-HTML5-DnD drop-target handlers immune to the "densely packed children" dragleave
 * bug described above. `accept` is the `DataTransfer` MIME type this target accepts (e.g.
 * `LIBRARY_DND_MIME`); `isOver`/`setOver` is the caller's own hover-state slice (a plain boolean
 * for a single target, or `hoveredKey === thisKey` for one of many); `onDrop` is the real drop
 * handler (payload parsing etc. stays the caller's responsibility — this only manages hover state
 * and the dragover/dragleave bookkeeping around it).
 */
export function makeDropTargetHandlers<E extends Element = Element>(
  accept: string,
  isOver: boolean,
  setOver: (v: boolean) => void,
  onDrop: (e: DragEvent<E>) => void,
): DropTargetHandlers<E> {
  return {
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes(accept)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      if (!isOver) setOver(true)
    },
    onDragLeave: (e) => {
      // The actual bug fix: only clear hover if the pointer left the target ENTIRELY, not just
      // crossed from the target's own background onto one of its children. `relatedTarget` is the
      // element the pointer is now over; if it's still inside `currentTarget` (the drop target
      // itself), this dragleave is spurious — a plain child-boundary crossing, not a real exit.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setOver(false)
    },
    onDrop: (e) => {
      e.preventDefault()
      setOver(false)
      onDrop(e)
    },
  }
}

/** Hook form of `makeDropTargetHandlers` for a single, one-per-component drop target (e.g. one
 * track header, mounted once per `TrackRow`). Returns `isOver` plus the ready-to-spread handlers,
 * and `className` already resolved to `DROP_TARGET_HOVER_CLASS` or `''`. */
export function useDropTarget<E extends Element = Element>(accept: string, onDrop: (e: DragEvent<E>) => void) {
  const [isOver, setOver] = useState(false)
  const handlers = makeDropTargetHandlers<E>(accept, isOver, setOver, onDrop)
  return { isOver, className: isOver ? DROP_TARGET_HOVER_CLASS : '', ...handlers }
}
