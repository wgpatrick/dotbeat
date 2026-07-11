// The two-way sync between the running GUI and a `beat daemon` (src/daemon/daemon.ts). Adapted
// from BeatLab's src/state/dawBridge.ts (docs/research/15 §4) — same shape, rewired to dotbeat's
// own routes and raw-document model:
//
//   file → GUI   the daemon's SSE `doc` event fires whenever the .beat file changes on disk; the
//                GUI re-pulls GET /document and applies it (hot reload — playback keeps running,
//                the transport isn't interrupted). `open` fires on first connect and every
//                auto-reconnect, so re-pulling there covers the initial load too.
//   GUI → file   an edit (step toggle, knob turn, bpm) POSTs a single {path,value} primitive to
//                /edit; the daemon runs it through core's setValue and writes ONE canonical line
//                if it changed — a knob turn becomes a one-line `git diff`.
//
// Unlike dawBridge's whole-document POST /state, dotbeat pushes finer-grained edit primitives:
// the format stores drums as free-timed hits absolute over loop_bars, so a 16-step-pattern
// round-trip would tile a single step-toggle across every bar (see daemon.ts's /edit note). The
// UI updates optimistically (setValue is deterministic; the local mirror below matches it) and
// external edits reconcile via the SSE re-pull.

import { useStore } from '../state/store'
import type { BeatDocument, BeatDrumHit, BeatSelection, DrumLane } from '../types'
import { DRUM_LANES } from '../types'

export function daemonBase(): string {
  const port = new URLSearchParams(window.location.search).get('daw') ?? '8420'
  return `http://localhost:${port}`
}

const canon = (n: number) => Number(n.toFixed(4)) // mirror core's 4-decimal canonical precision

/** A faithful local mirror of core's setValue for exactly the paths the GUI issues, so the UI
 * reflects an edit instantly without waiting on the daemon round-trip (the daemon does not
 * broadcast its own writes — see writeIfChanged). Returns a new document (immutable) or null when
 * the path isn't one the GUI produces (then we just wait for the authoritative SSE re-pull). */
function applyLocalEdit(doc: BeatDocument, path: string, value: string): BeatDocument | null {
  if (path === 'bpm') return { ...doc, bpm: Number(value) }
  if (path === 'loop_bars') return { ...doc, loopBars: Number(value) }
  if (path === 'selected_track') return { ...doc, selectedTrack: value }

  const dot = path.indexOf('.')
  if (dot === -1) return null
  const trackId = path.slice(0, dot)
  const rest = path.slice(dot + 1)
  const idx = doc.tracks.findIndex((t) => t.id === trackId)
  if (idx === -1) return null
  const track = doc.tracks[idx]!

  const patternMatch = rest.match(/^pattern\.([a-z]+)\[(\d+)\]$/)
  if (patternMatch) {
    const lane = patternMatch[1] as DrumLane
    const step = Number(patternMatch[2])
    const vel = Number(value)
    const id = `${lane}${step}`
    const kept = track.hits.filter((h) => h.id !== id && !(h.lane === lane && h.start === step))
    const nextHits: BeatDrumHit[] = vel > 0 ? [...kept, { id, lane, start: step, velocity: canon(vel) }] : kept
    const tracks = doc.tracks.map((t, i) => (i === idx ? { ...t, hits: nextHits } : t))
    return { ...doc, tracks }
  }

  // Instrument tracks keep volume/pan on their own block, not the synth block (setValue routes on
  // track.kind — src/core/edit.ts). Mirror the mixer's `<id>.volume`/`<id>.pan` edits there.
  if (track.kind === 'instrument' && track.instrument && (rest === 'volume' || rest === 'pan')) {
    const inst = { ...track.instrument, [rest]: canon(Number(value)) }
    const tracks = doc.tracks.map((t, i) => (i === idx ? { ...t, instrument: inst } : t))
    return { ...doc, tracks }
  }

  // note grammar (piano-roll edits) — mirrors core setValue's note paths (src/core/edit.ts).
  if (rest === 'note') {
    // ADD "<pitch> <start> <duration> <velocity>" — replicate addNote's u-id minting exactly so
    // the optimistic note carries the same id the daemon will write.
    const [pitch, start, duration, velocity] = value.trim().split(/\s+/).map(Number)
    let max = 100000
    for (const t of doc.tracks) for (const n of t.notes) {
      const m = n.id.match(/^u(\d+)$/)
      if (m) max = Math.max(max, Number(m[1]))
    }
    const note = { id: `u${max + 1}`, pitch: pitch!, start: canon(start!), duration: canon(duration!), velocity: canon(velocity!) }
    const tracks = doc.tracks.map((t, i) => (i === idx ? { ...t, notes: [...t.notes, note] } : t))
    return { ...doc, tracks }
  }
  const noteFieldMatch = rest.match(/^note\.([A-Za-z0-9_-]+)\.(pitch|start|duration|velocity)$/)
  if (noteFieldMatch) {
    const [, noteId, field] = noteFieldMatch
    const n = field === 'pitch' ? Number(value) : canon(Number(value))
    const tracks = doc.tracks.map((t, i) => (i === idx ? { ...t, notes: t.notes.map((no) => (no.id === noteId ? { ...no, [field!]: n } : no)) } : t))
    return { ...doc, tracks }
  }
  const noteDeleteMatch = rest.match(/^note\.([A-Za-z0-9_-]+)$/)
  if (noteDeleteMatch) {
    const noteId = noteDeleteMatch[1]
    const tracks = doc.tracks.map((t, i) => (i === idx ? { ...t, notes: t.notes.filter((no) => no.id !== noteId) } : t))
    return { ...doc, tracks }
  }

  // synth param. String-valued fields (osc + the enums, and duckSource's 'none'->null) stay
  // strings; everything else is a canonical number. A non-numeric value means a string field.
  const num = Number(value)
  let nextVal: number | string | null
  if (rest === 'duckSource') nextVal = value === 'none' ? null : value
  else if (value.trim() === '' || Number.isNaN(num)) nextVal = value
  else nextVal = canon(num)
  const tracks = doc.tracks.map((t, i) => (i === idx ? { ...t, synth: { ...t.synth, [rest]: nextVal } } : t))
  return { ...doc, tracks }
}

// Per-path debounce: a knob drag fires many deltas; only the latest value per path needs to land.
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
let sendQueue: Promise<unknown> = Promise.resolve()

/** Issue one edit. Applies it optimistically to the store, then debounces a POST /edit. */
export function postEdit(path: string, value: string): void {
  const state = useStore.getState()
  if (state.doc) {
    const next = applyLocalEdit(state.doc, path, value)
    if (next) state.setDoc(next)
  }
  const existing = pendingTimers.get(path)
  if (existing) clearTimeout(existing)
  pendingTimers.set(
    path,
    setTimeout(() => {
      pendingTimers.delete(path)
      const base = daemonBase()
      sendQueue = sendQueue.then(() =>
        fetch(`${base}/edit`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path, value }),
        })
          .then(async (res) => {
            if (!res.ok) console.warn(`[daw] /edit ${path}=${value}: HTTP ${res.status}`, await res.text().catch(() => ''))
          })
          .catch((err) => console.warn('[daw] could not POST edit:', err)),
      )
    }, 60),
  )
}

async function pullDocument(base: string): Promise<void> {
  try {
    const res = await fetch(`${base}/document`)
    if (!res.ok) throw new Error(`GET /document: HTTP ${res.status}`)
    useStore.getState().setDoc((await res.json()) as BeatDocument)
    useStore.getState().setConnected(true)
  } catch (err) {
    console.warn('[daw] could not load document from daemon:', err)
  }
}

async function pullSelection(base: string): Promise<void> {
  try {
    const res = await fetch(`${base}/selection`)
    if (!res.ok) throw new Error(`GET /selection: HTTP ${res.status}`)
    useStore.getState().setSelection((await res.json()) as BeatSelection)
  } catch (err) {
    console.warn('[daw] could not load selection from daemon:', err)
  }
}

/** Push a pointing selection to the daemon (the D2 channel `beat vary --scope selection` reads).
 * Mirrors it locally immediately; the daemon broadcasts a `selection` SSE event that reconciles
 * any agent-set value back. A 400 means the selection didn't resolve against the current document. */
export function postSelection(sel: BeatSelection): void {
  useStore.getState().setSelection(sel)
  const base = daemonBase()
  fetch(`${base}/selection`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sel),
  })
    .then(async (res) => {
      if (!res.ok) console.warn(`[daw] POST /selection: HTTP ${res.status}`, await res.text().catch(() => ''))
    })
    .catch((err) => console.warn('[daw] could not POST selection:', err))
}

/** Connect to the daemon: initial pull + live SSE hot-reload. Idempotent-ish; call once at boot. */
export function initBridge(): void {
  const base = daemonBase()
  console.log(`[daw] bridging to beat daemon at ${base}`)

  const events = new EventSource(`${base}/events`)
  events.addEventListener('open', () => {
    void pullDocument(base)
    void pullSelection(base)
  })
  events.addEventListener('doc', () => {
    // The event payload is the /doc projection; the raw model lives at /document, so re-pull it.
    void pullDocument(base)
  })
  events.addEventListener('selection', (e) => {
    // The daemon broadcasts the full selection value on every change (ours or an agent's).
    try {
      useStore.getState().setSelection(JSON.parse((e as MessageEvent).data) as BeatSelection)
    } catch (err) {
      console.warn('[daw] bad selection event payload:', err)
    }
  })
  events.addEventListener('parse-error', (e) => {
    const msg = (JSON.parse((e as MessageEvent).data) as { message: string }).message
    console.warn('[daw] file edit did not parse:', msg)
    useStore.getState().setParseError(msg)
  })
  events.onerror = () => useStore.getState().setConnected(false)

  // Cover the case where the SSE `open` is slow or the browser buffers it: pull once eagerly too.
  void pullDocument(base)
  void pullSelection(base)
}

export { DRUM_LANES }
