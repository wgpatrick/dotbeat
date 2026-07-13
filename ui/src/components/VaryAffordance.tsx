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
import { applyEdits, requestVary, requestVaryFeel, commitVaryFeel, postEdit, type VaryBatch, type FeelBatch } from '../daemon/bridge'
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

/** Drum lanes selected on `track` (the exact "lane click narrows vary-scope" gesture NoteView.tsx's
 * `buildLaneAxis.preview` already posts) — feed straight into /vary-feel's optional `lanes` scope, so
 * selecting the hats and running "vary feel" humanizes just the hats, mirroring param-vary's own
 * lane-inferred group. Undefined (whole track) when nothing lane-specific is selected. */
function feelLaneScope(sel: BeatSelection, track: string | undefined): string[] | undefined {
  if (!track) return undefined
  const lanes = sel.lanes?.filter((l) => l.track === track).map((l) => l.lane)
  return lanes && lanes.length ? lanes : undefined
}

// Phase 29 Stream GF item 3: `sel.tracks`/`sel.lanes[].track` hold stable track IDs, not display
// names — a track's `.name` can be changed independently of its `id` via the inline rename
// affordance (ArrangementView.tsx's `${track.id}.name` edit). Resolving through `doc.tracks` here
// means this label always reflects the CURRENT name, instead of freezing whatever the id happened
// to look like (often the original, pre-rename name) for the rest of the session.
function selectionSummary(sel: BeatSelection, doc: BeatDocument | null): string {
  const nameOf = (id: string) => doc?.tracks.find((t) => t.id === id)?.name ?? id
  const parts: string[] = []
  if (sel.lanes?.length) parts.push(sel.lanes.map((l) => `${nameOf(l.track)}.${l.lane}`).join(' '))
  else if (sel.tracks?.length) parts.push(sel.tracks.map(nameOf).join(' '))
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

  // ── Phase 23 Stream BB: rung-2 "feel" (humanized content) audition — the same trigger/audition/
  // Keep/Undo shape as the rung-1 param-vary state above, but each variant is a FULL document (not
  // a small edit list — humanize rewrites many note/hit fields), and Keep resends the variant's
  // reproducible seed to POST /vary-feel/commit rather than replaying edits (see bridge.ts).
  const [feelBatch, setFeelBatch] = useState<FeelBatch | null>(null)
  const [feelIndex, setFeelIndex] = useState(0)
  const [feelBusy, setFeelBusy] = useState(false)
  const [feelError, setFeelError] = useState<string | null>(null)
  const [feelKept, setFeelKept] = useState<string | null>(null)
  const feelBaseDoc = useRef<BeatDocument | null>(null)

  const hasSelection = Object.keys(selection).length > 0
  // Show whenever there's a selection to act on, or either kind of audition is in flight.
  if (!doc || (!hasSelection && !batch && !feelBatch)) return null

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

  async function triggerFeel() {
    const current = useStore.getState().doc
    if (!current) return
    setFeelBusy(true)
    setFeelError(null)
    setFeelKept(null)
    try {
      const lanes = feelLaneScope(selection, scope.track)
      const b = await requestVaryFeel(lanes ? { lanes } : {}) // track resolved server-side from selection
      if (!b.variants.length) throw new Error('no variants returned')
      feelBaseDoc.current = current
      setFeelBatch(b)
      setFeelIndex(0)
      useStore.getState().setDoc(b.variants[0]!.doc) // a FULL document, applied directly (no edit list to replay)
    } catch (e) {
      setFeelError(e instanceof Error ? e.message : String(e))
    } finally {
      setFeelBusy(false)
    }
  }

  function showFeel(i: number) {
    if (!feelBatch) return
    const clamped = Math.max(0, Math.min(feelBatch.variants.length - 1, i))
    setFeelIndex(clamped)
    useStore.getState().setDoc(feelBatch.variants[clamped]!.doc)
  }

  async function keepFeel() {
    if (!feelBatch) return
    const chosen = feelBatch.variants[feelIndex]!
    try {
      // Resend the exact seed the audition offered — /vary-feel/commit regenerates the identical
      // content deterministically and writes it (no edit-list replay; see bridge.ts's doc comment).
      await commitVaryFeel(feelBatch.track, chosen.seed, feelLaneScope(selection, feelBatch.track))
      setFeelKept(`kept feel variant ${feelIndex + 1}: ${chosen.recipe}`)
    } catch (e) {
      setFeelError(e instanceof Error ? e.message : String(e))
    }
    setFeelBatch(null)
    feelBaseDoc.current = null
  }

  function cancelFeel() {
    if (feelBaseDoc.current) useStore.getState().setDoc(feelBaseDoc.current)
    setFeelBatch(null)
    feelBaseDoc.current = null
    setFeelError(null)
  }

  // ── Audition strip: rung-1 param vary ───────────────────────────────────────────────────────
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

  // ── Audition strip: rung-2 "feel" content vary ──────────────────────────────────────────────
  if (feelBatch) {
    const v = feelBatch.variants[feelIndex]!
    return (
      <div className="vary-bar auditioning" role="group" aria-label="vary feel audition">
        <span className="vary-scope">feel on {feelBatch.track}</span>
        <span className="vary-count">
          variant {feelIndex + 1} of {feelBatch.variants.length}
        </span>
        <span className="vary-label" title={v.recipe}>
          {v.recipe}
        </span>
        <div className="vary-actions">
          <button className="vary-btn" onClick={() => showFeel(feelIndex - 1)} disabled={feelIndex === 0} title="previous variant">
            {'◀'} Prev
          </button>
          <button className="vary-btn" onClick={() => showFeel(feelIndex + 1)} disabled={feelIndex === feelBatch.variants.length - 1} title="next variant">
            Next {'▶'}
          </button>
          <button className="vary-btn keep" onClick={() => void keepFeel()} title="commit this humanized feel to the file">
            Keep
          </button>
          <button className="vary-btn undo" onClick={cancelFeel} title="discard all variants, restore the original">
            Undo
          </button>
        </div>
      </div>
    )
  }

  // ── Idle trigger ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="vary-bar" role="group" aria-label="vary selection">
      <span className="vary-scope-hint">selection: {selectionSummary(selection, doc)}</span>
      <button className="vary-btn trigger" onClick={trigger} disabled={busy} title="generate parameter variations of the selection (rung 1)">
        {busy ? 'varying…' : `≈ ${triggerLabel}`}
      </button>
      <button className="vary-btn trigger" onClick={() => void triggerFeel()} disabled={feelBusy} title="generate humanized timing/velocity feels of the selection (rung 2)">
        {feelBusy ? 'varying…' : '≈ vary feel'}
      </button>
      {kept && <span className="vary-kept">{kept}</span>}
      {error && <span className="vary-error">{error}</span>}
      {feelKept && <span className="vary-kept">{feelKept}</span>}
      {feelError && <span className="vary-error">{feelError}</span>}
    </div>
  )
}
