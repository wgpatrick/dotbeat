// Phase 29 Stream GE, item 2 — the toast host. Mounted once in App.tsx alongside the other
// always-present overlays (mirrors ShortcutHelp/HistoryPanel's own "one instance, driven by shared
// state" shape). Success/error only, per the plan ("this app doesn't need a full notification
// stack") — no info/warning variant, no queueing UI beyond a simple stacked list, no undo-in-toast.
// Each toast auto-dismisses after a few seconds AND offers a manual close button, matching the
// "in-page, dismissable, styled" requirement — unlike `window.alert()`, nothing here blocks input or
// the page's own event loop, which is exactly what let pilot 82's Playwright driver crash on the old
// behavior (default dialog auto-dismiss ate the message before it could be read).

import { useEffect } from 'react'
import { useToastStore, type ToastItem } from '../state/toastStore'

const AUTO_DISMISS_MS = 6000

function ToastRow({ id, message, variant }: ToastItem) {
  const dismiss = useToastStore((s) => s.dismiss)
  useEffect(() => {
    const t = window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    return () => window.clearTimeout(t)
  }, [id, dismiss])
  return (
    <div className={`toast toast-${variant}`} role={variant === 'error' ? 'alert' : 'status'} data-toast={id} data-toast-variant={variant}>
      <span className="toast-message">{message}</span>
      <button className="toast-close" onClick={() => dismiss(id)} title="dismiss" aria-label="dismiss">
        ×
      </button>
    </div>
  )
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  if (!toasts.length) return null
  return (
    <div className="toast-host" data-testid="toast-host">
      {toasts.map((t) => (
        <ToastRow key={t.id} {...t} />
      ))}
    </div>
  )
}
