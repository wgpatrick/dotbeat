// Phase 29 Stream GE, item 2 (docs/phase-29-plan.md, docs/research/82/85) — the app's one and only
// in-page notification primitive, replacing raw `window.alert()` calls across ArrangementView.tsx,
// NoteView.tsx, and ContentBrowser.tsx. Two pilots hit the old behavior directly: pilot 82's
// Playwright driver crashed on the first `alert()` because the browser's own auto-dismiss ate the
// message before it could be read back; pilot 85 called a refusal dialog "jarring against the rest
// of dotbeat's polished dark-themed GUI." `window.confirm()` is UNCHANGED by this — that's still an
// appropriate blocking dialog for destructive-action confirmations (e.g. ArrangementView's
// delete-track prompt); this only replaces `alert()`'s pure-notification uses.
//
// A separate, tiny Zustand store (not folded into the main DawState in state/store.ts) — toasts are
// ephemeral, session-only UI chrome with zero relationship to the document/selection/transport state
// the main store exists to hold, same "own file, own concern" split dragDrop.ts already follows for
// drag state. `showToast` is a plain function (not a hook) so every existing `.catch((err) =>
// window.alert(...))` call site swaps in with a one-line change, including from places that aren't
// React components at all.

import { create } from 'zustand'

export type ToastVariant = 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastState {
  toasts: ToastItem[]
  push: (message: string, variant: ToastVariant) => number
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, variant) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }))
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Show a dismissable, styled in-page toast — the direct replacement for `window.alert(msg)`.
 * Defaults to the `error` variant since the overwhelming majority of the old `alert()` call sites
 * were rejection/failure messages; pass `'success'` explicitly for the few confirmation sites. */
export function showToast(message: string, variant: ToastVariant = 'error'): void {
  useToastStore.getState().push(message, variant)
}
