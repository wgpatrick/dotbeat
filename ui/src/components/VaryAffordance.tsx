// The inline "vary this" affordance (Phase 15 Stream I, product-spec-desktop §2/§3). Research 10's
// validated pattern — Photoshop's Contextual Task Bar / Cursor Cmd+K: a small control that appears
// when there's a selection, one click starts a vary batch, results audition in place. NOT a modal or
// a separate page. It reads the daemon's live pointing selection off the store, so "select the hats,
// hit vary — no typing" works exactly as the owner's demo describes.
//
// The audition is genuinely revertible (the spec's Keep/Undo requirement): triggering snapshots the
// current document, then each variant is applied to that snapshot IN MEMORY (setDoc) so the running
// engine plays it — nothing is written to disk. Keep replays the chosen variant's edits through the
// normal postEdit path (one canonical line each); Undo restores the snapshot. Disk changes only on
// Keep, and only to the variant the human actually chose.

import { useRef, useState } from 'react'
import { useStore } from '../state/store'
import { applyEdits, requestVary, postEdit, type VaryBatch } from '../daemon/bridge'
import type { BeatDocument, BeatSelection } from '../types'

// Mirror of the daemon's DRUM_LANE_GROUP + kind default, for the trigger LABEL only — the daemon is
// authoritative about what actually gets varied (it returns the resolved track/group in the batch).
const DRUM_LANE_GROUP: Record<string, string> = { kick: 'kick', snare: 'snare', clap: 'snare', hat: 'hats', openhat: 'hats' }

function previewScope(sel: BeatSelection, doc: BeatDocument | null): { track?: string; group?: string } {
  if (!doc) return {}
  const involved = new Set<string>()
  sel.tracks?.forEach((t) => involved.add(t))
  sel.lanes?.forEach((l) => involved.add(l.track))
  sel.notes?.forEach((n) => involved.add(n.track))
  let track: string | undefined
  if (involved.size === 1) track = [...involved][0]
  else if (involved.size === 0) track = doc.selectedTrack || doc.tracks[0]?.id
  // size > 1: ambiguous — let the daemon report it; leave track/group unlabelled.
  const t = track ? doc.tracks.find((x) => x.id === track) : undefined
  if (!t) return { track }
  const lane = sel.lanes?.find((l) => l.track === track)?.lane
  const group = (lane ? DRUM_LANE_GROUP[lane] : undefined) ?? (t.kind === 'drums' ? 'hats' : 'filter')
  return { track, group }
}

function selectionSummary(sel: BeatSelection): string {
  const parts: string[] = []
  if (sel.lanes?.length) parts.push(sel.lanes.map((l) => `${l.track}.${l.lane}`).join(' '))
  else if (sel.tracks?.length) parts.push(sel.tracks.join(' '))
  if (sel.bars) parts.push(`bars ${sel.bars.start}–${sel.bars.end}`)
  if (sel.notes?.length) parts.push(`${sel.notes.length} note${sel.notes.length === 1 ? '' : 's'}`)
  return parts.join(' · ') || 'current track'
}

export function VaryAffordance() {
  const selection = useStore((s) => s.selection)
  const doc = useStore((s) => s.doc)
  const [batch, setBatch] = useState<VaryBatch | null>(null)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [kept, setKept] = useState<string | null>(null)
  // The pre-vary document snapshot. Provisional audition edits are applied on top of this; Undo (and
  // Keep, implicitly) return here. Held in a ref so it survives re-renders without re-triggering.
  const baseDoc = useRef<BeatDocument | null>(null)

  const hasSelection = Object.keys(selection).length > 0
  // Show whenever there's a selection to act on, or an audition is in flight.
  if (!doc || (!hasSelection && !batch)) return null

  const scope = previewScope(selection, doc)
  const triggerLabel = scope.group ? `vary ${scope.group}` : 'vary'

  async function trigger() {
    const current = useStore.getState().doc
    if (!current) return
    setBusy(true)
    setError(null)
    setKept(null)
    try {
      const b = await requestVary({}) // selection is read server-side
      if (!b.variants.length) throw new Error('no variants returned')
      baseDoc.current = current
      setBatch(b)
      setIndex(0)
      useStore.getState().setDoc(applyEdits(current, b.variants[0]!.edits))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function show(i: number) {
    if (!batch || !baseDoc.current) return
    const clamped = Math.max(0, Math.min(batch.variants.length - 1, i))
    setIndex(clamped)
    useStore.getState().setDoc(applyEdits(baseDoc.current, batch.variants[clamped]!.edits))
  }

  function keep() {
    if (!batch) return
    const chosen = batch.variants[index]!
    for (const e of chosen.edits) postEdit(e.path, e.value) // one canonical line each, on disk
    setKept(`kept variant ${index + 1}: ${chosen.label}`)
    setBatch(null)
    baseDoc.current = null
  }

  function cancel() {
    if (baseDoc.current) useStore.getState().setDoc(baseDoc.current)
    setBatch(null)
    baseDoc.current = null
    setError(null)
  }

  // ── Audition strip ──────────────────────────────────────────────────────────────────────────
  if (batch) {
    const v = batch.variants[index]!
    return (
      <div className="vary-bar auditioning" role="group" aria-label="vary audition">
        <span className="vary-scope">
          {batch.group} on {batch.track}
        </span>
        <span className="vary-count">
          variant {index + 1} of {batch.variants.length}
        </span>
        <span className="vary-label" title={v.label}>
          {v.label}
        </span>
        <div className="vary-actions">
          <button className="vary-btn" onClick={() => show(index - 1)} disabled={index === 0} title="previous variant">
            {'◀'} Prev
          </button>
          <button className="vary-btn" onClick={() => show(index + 1)} disabled={index === batch.variants.length - 1} title="next variant">
            Next {'▶'}
          </button>
          <button className="vary-btn keep" onClick={keep} title="commit this variant to the file">
            Keep
          </button>
          <button className="vary-btn undo" onClick={cancel} title="discard all variants, restore the original">
            Undo
          </button>
        </div>
      </div>
    )
  }

  // ── Idle trigger ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="vary-bar" role="group" aria-label="vary selection">
      <span className="vary-scope-hint">selection: {selectionSummary(selection)}</span>
      <button className="vary-btn trigger" onClick={trigger} disabled={busy} title="generate variations of the selection">
        {busy ? 'varying…' : `≈ ${triggerLabel}`}
      </button>
      {kept && <span className="vary-kept">{kept}</span>}
      {error && <span className="vary-error">{error}</span>}
    </div>
  )
}
