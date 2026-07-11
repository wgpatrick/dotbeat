// The version-history panel (Phase 15 Stream H) — the GUI surface for D3/D10 versioning, which
// until now existed only as `beat history`/`beat restore`/`beat pin` CLI/MCP verbs with zero GUI
// presence (docs/product-spec-desktop.md §4: "we make changes — we want to store the previous
// version so you can go back"). It renders the daemon's GET /history as a linear list — timestamp,
// one-line semantic diff, pin name if present — each row with a "Go back" (restore) button, and a
// lightweight "pin" affordance. Everything is real: the list is the file's actual git-backed
// checkpoints, and restore is append-only (writes the old bytes + a fresh checkpoint, never a
// destructive rewind — research 11 / D3), so the current state stays recoverable.
//
// Sync model: after a restore/pin the daemon writes the .beat file, its watcher broadcasts a `doc`
// SSE event, and the bridge re-pulls the document into the store. So we simply re-fetch /history
// whenever the store's `doc` identity changes (any edit or restore mints a checkpoint) plus when the
// panel opens — no bespoke socket, we ride the same reactive doc the rest of the app does.

import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { daemonBase } from '../daemon/bridge'
import type { HistoryEntry, HistoryRow } from '../types'

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function HistoryPanel() {
  const doc = useStore((s) => s.doc) // re-fetch whenever the document changes (edits mint checkpoints)
  const [rows, setRows] = useState<HistoryRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyRef, setBusyRef] = useState<string | null>(null)
  const [pinningRef, setPinningRef] = useState<string | null>(null)
  const [pinName, setPinName] = useState('')
  // Flat vs collapsed (product-spec-desktop.md §4: "unnamed checkpoints collapse between named
  // pins... a long timeline still skims"). Collapsed is the default — it's the spec's must-have
  // reading for a long history; flat stays one click away for when every checkpoint matters.
  const [collapsed, setCollapsed] = useState(true)

  const load = useCallback(async () => {
    const base = daemonBase()
    try {
      const res = await fetch(`${base}/history?limit=200${collapsed ? '&collapsed=true' : ''}`)
      if (!res.ok) throw new Error(`GET /history: HTTP ${res.status}`)
      const body = (await res.json()) as { entries?: HistoryEntry[]; rows?: HistoryRow[] }
      const nextRows: HistoryRow[] = collapsed ? (body.rows ?? []) : (body.entries ?? []).map((e) => ({ kind: 'checkpoint' as const, ...e }))
      setRows(nextRows)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [collapsed])

  useEffect(() => {
    void load()
  }, [load, doc])

  async function restore(ref: string) {
    setBusyRef(ref)
    setError(null)
    try {
      const res = await fetch(`${daemonBase()}/restore`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
      // The daemon's watcher will broadcast `doc`, the bridge re-pulls, `doc` changes, and the
      // useEffect above re-fetches history — but re-load here too so the new checkpoint shows even
      // if the restored bytes happened to equal the current ones (a no-op restore mints nothing).
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyRef(null)
    }
  }

  async function savePin(ref: string) {
    const name = pinName.trim()
    if (!name) return
    try {
      const res = await fetch(`${daemonBase()}/pin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref, name }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
      setPinningRef(null)
      setPinName('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="history-panel" data-testid="history-panel">
      <div className="history-head">
        <div>
          <div className="history-title">Version history</div>
          <div className="history-sub">newest first · restoring goes back without erasing work</div>
        </div>
        <button
          className="history-btn history-toggle"
          onClick={() => setCollapsed((c) => !c)}
          data-action="toggle-collapsed"
          title={collapsed ? 'show every checkpoint' : 'fold unnamed checkpoints between pins'}
        >
          {collapsed ? 'Show all' : 'Collapse'}
        </button>
      </div>
      {error && <div className="history-error">{error}</div>}
      {rows === null && !error && <div className="history-empty">loading history…</div>}
      {rows !== null && rows.length === 0 && <div className="history-empty">No checkpoints yet — make an edit to save one.</div>}
      {rows && rows.length > 0 && (
        <ul className="history-list">
          {rows.map((row, i) =>
            row.kind === 'collapsed' ? (
              <li key={`collapsed-${i}`} className="history-row history-row-collapsed" data-testid="history-collapsed-row">
                {row.count} more checkpoint{row.count === 1 ? '' : 's'}
              </li>
            ) : (
              <li key={row.ref} className={`history-row ${row.pin ? 'pinned' : ''}`} data-ref={row.ref}>
                <div className="history-row-main">
                  <div className="history-row-line">
                    {row.pin && <span className="history-pin" title="pinned version">📌 {row.pin}</span>}
                    <span className="history-label">{row.label}</span>
                  </div>
                  <div className="history-meta">
                    <span className="history-when">{formatWhen(row.when)}</span>
                    <span className="history-ref">{row.ref}</span>
                    {row.intent && <span className="history-intent" title={row.intent}>“{row.intent}”</span>}
                  </div>
                </div>
                <div className="history-row-actions">
                  <button className="history-btn restore" onClick={() => restore(row.ref)} disabled={busyRef !== null} data-action="restore">
                    {busyRef === row.ref ? 'Going back…' : 'Go back'}
                  </button>
                  {pinningRef === row.ref ? (
                    <span className="history-pin-edit">
                      <input
                        className="history-pin-input"
                        autoFocus
                        maxLength={25}
                        value={pinName}
                        placeholder="name (≤25)"
                        onChange={(ev) => setPinName(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') void savePin(row.ref)
                          if (ev.key === 'Escape') setPinningRef(null)
                        }}
                      />
                      <button className="history-btn pin-save" onClick={() => savePin(row.ref)}>Save</button>
                    </span>
                  ) : (
                    !row.pin && (
                      <button className="history-btn pin" onClick={() => { setPinningRef(row.ref); setPinName('') }} data-action="pin">
                        Pin
                      </button>
                    )
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  )
}
