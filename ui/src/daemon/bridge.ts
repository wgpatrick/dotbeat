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
import type { BeatAutomationLane, BeatAutomationPoint, BeatDocument, BeatDrumHit, BeatSelection, DrumLane } from '../types'
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

  // Instrument tracks keep volume/pan/program on their own block, not the synth block (setValue
  // routes on track.kind — src/core/edit.ts). Mirror those edits there so the live engine hears a
  // program/level/pan change immediately (the daemon doesn't echo its own writes). `program` is an
  // integer 0-127; volume/pan are canonical numbers.
  if (track.kind === 'instrument' && track.instrument && (rest === 'volume' || rest === 'pan' || rest === 'program')) {
    const next = rest === 'program' ? Math.round(Number(value)) : canon(Number(value))
    const inst = { ...track.instrument, [rest]: next }
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

  // track metadata (Phase 20 Stream W): name/color live on the TRACK, not the synth block — core's
  // setValue routes them to track.name/track.color (src/core/edit.ts). Mirror them there so an inline
  // rename / color-pick reflects instantly; without this branch they'd fall through to the synth-param
  // path below and be written to a phantom synth.name/synth.color (the same optimistic-mirror miss
  // class Stream Y fixed for osc2), leaving the real header name/swatch stale until the next re-pull.
  if (rest === 'name' || rest === 'color') {
    const tracks = doc.tracks.map((t, i) => (i === idx ? { ...t, [rest]: value } : t))
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

// ─── clip automation (Phase 20 Stream Z) ─────────────────────────────────────────────────────────
// Automation curve edits can't use postEdit's {path,value} grammar (they carry a (clip, param,
// point) tuple), so they go to the daemon's additive POST /automate — wrapping the SAME core
// primitives `beat automate` uses (setAutomationPoint / removeAutomationPoint). Like postEdit, the
// UI mirrors the edit optimistically so the drawn curve updates instantly, then reconciles on the
// SSE re-pull. The optimistic id-mint below matches core's exactly (`p<n>`, max+1 within the lane)
// so a freshly-drawn point keeps the same id the daemon writes — no flicker on reconcile.

export interface AutomationEdit {
  op: 'set' | 'remove'
  track: string
  clip: string
  param: string
  time?: number
  value?: number
  id?: string
}

const canonV = (n: number) => Number(n.toFixed(4))

/** A faithful local mirror of core's setAutomationPoint / removeAutomationPoint for one clip lane,
 * so the automation overlay reflects a drag instantly. Returns a new document, or null when the
 * target track/clip can't be found (then we just wait for the authoritative SSE re-pull). */
function applyLocalAutomation(doc: BeatDocument, e: AutomationEdit): BeatDocument | null {
  const ti = doc.tracks.findIndex((t) => t.id === e.track)
  if (ti === -1) return null
  const track = doc.tracks[ti]!
  const ci = track.clips.findIndex((c) => c.id === e.clip)
  if (ci === -1) return null
  const clip = track.clips[ci]!
  const lane = clip.automation.find((l) => l.param === e.param)

  let nextLanes: BeatAutomationLane[]
  if (e.op === 'remove') {
    if (!lane || e.id === undefined) return doc
    const remaining = lane.points.filter((p) => p.id !== e.id)
    nextLanes =
      remaining.length === 0
        ? clip.automation.filter((l) => l.param !== e.param)
        : clip.automation.map((l) => (l.param === e.param ? { ...l, points: remaining } : l))
  } else {
    if (e.time === undefined || e.value === undefined) return doc
    const time = canonV(e.time)
    const value = canonV(e.value)
    const existing = e.id !== undefined && lane ? lane.points.find((p) => p.id === e.id) : undefined
    if (existing) {
      nextLanes = clip.automation.map((l) =>
        l.param === e.param ? { ...l, points: l.points.map((p) => (p.id === e.id ? { id: p.id, time, value } : p)) } : l,
      )
    } else {
      const points = lane ? lane.points : []
      let id = e.id
      if (id === undefined) {
        let max = 0
        for (const p of points) {
          const m = p.id.match(/^p(\d+)$/)
          if (m) max = Math.max(max, Number(m[1]))
        }
        id = `p${max + 1}`
      }
      const added: BeatAutomationPoint = { id, time, value }
      nextLanes = lane
        ? clip.automation.map((l) => (l.param === e.param ? { ...l, points: [...l.points, added] } : l))
        : [...clip.automation, { param: e.param, points: [added] }]
    }
  }

  const nextClip = { ...clip, automation: nextLanes }
  const clips = track.clips.map((c, i) => (i === ci ? nextClip : c))
  const tracks = doc.tracks.map((t, i) => (i === ti ? { ...t, clips } : t))
  return { ...doc, tracks }
}

/** Issue one automation edit. Mirrors it optimistically, then POSTs /automate (fire-and-forget;
 * the SSE re-pull reconciles). Curve drags call this only on pointer-up — the live drag redraws
 * the canvas imperatively (research 15 §2: no React state / no network per pointer move). */
export function postAutomation(e: AutomationEdit): void {
  const state = useStore.getState()
  if (state.doc) {
    const next = applyLocalAutomation(state.doc, e)
    if (next) state.setDoc(next)
  }
  const base = daemonBase()
  const body: Record<string, unknown> = { op: e.op, track: e.track, clip: e.clip, param: e.param }
  if (e.time !== undefined) body.time = e.time
  if (e.value !== undefined) body.value = e.value
  if (e.id !== undefined) body.id = e.id
  sendQueue = sendQueue.then(() =>
    fetch(`${base}/automate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (!res.ok) console.warn(`[daw] /automate ${e.op} ${e.track}.${e.clip}.${e.param}: HTTP ${res.status}`, await res.text().catch(() => ''))
      })
      .catch((err) => console.warn('[daw] could not POST automation:', err)),
  )
}

// ─── track structure add/remove (Phase 20 Stream W) ─────────────────────────────────────────────
// Add/remove change the whole tracks list, so they don't fit setValue's `path=value` shape and go to
// dedicated daemon routes (/add-track, /remove-track) wrapping core's addTrack/removeTrack — the same
// functions `beat add-track`/`beat rm-track` call. The daemon never SSE-echoes its own writes, so
// both routes RETURN the resulting raw document and we apply it straight to the store (no optimistic
// local mirror needed — the authoritative post-edit doc comes back in the response). Errors (dup id,
// removing the last track, an instrument track with no soundfont) surface with the daemon's message.

export interface AddTrackOpts {
  id: string
  kind: 'synth' | 'drums' | 'instrument'
  name?: string
  color?: string
  soundfont?: { sample: string; program: number }
}

export async function postAddTrack(opts: AddTrackOpts): Promise<void> {
  const base = daemonBase()
  const res = await fetch(`${base}/add-track`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opts),
  })
  if (!res.ok) {
    const msg = await res.json().then((b) => (b as { error?: string }).error).catch(() => res.statusText)
    throw new Error(msg || `HTTP ${res.status}`)
  }
  const { doc } = (await res.json()) as { written: boolean; doc: BeatDocument }
  useStore.getState().setDoc(doc)
}

export async function postRemoveTrack(id: string): Promise<void> {
  const base = daemonBase()
  const res = await fetch(`${base}/remove-track`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  })
  if (!res.ok) {
    const msg = await res.json().then((b) => (b as { error?: string }).error).catch(() => res.statusText)
    throw new Error(msg || `HTTP ${res.status}`)
  }
  const { doc } = (await res.json()) as { written: boolean; doc: BeatDocument }
  useStore.getState().setDoc(doc)
}

// ─── effect-chain add/remove/move/bypass (Phase 22 Stream AA) ───────────────────────────────────
// Same reasoning as track add/remove above: these change the ordered `effects` LIST's shape or
// order, so they don't fit setValue's single `path=value` shape (bypass alone DOES — see
// postEdit's `<track>.effect.<id>.enabled` path, an alternative for that one case). Dedicated
// daemon routes (/effect-add, /effect-remove, /effect-move, /effect-enabled) wrap the same core
// primitives `beat effect-add`/`-rm`/`-move`/`-bypass` call, and RETURN the full raw document
// (no SSE echo of the daemon's own writes) — applied straight to the store, no optimistic mirror.

async function postEffectOp<T extends Record<string, unknown>>(route: string, body: T): Promise<void> {
  const base = daemonBase()
  const res = await fetch(`${base}/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = await res.json().then((b) => (b as { error?: string }).error).catch(() => res.statusText)
    throw new Error(msg || `HTTP ${res.status}`)
  }
  const { doc } = (await res.json()) as { written: boolean; doc: BeatDocument }
  useStore.getState().setDoc(doc)
}

export function postEffectAdd(track: string, type: string, opts: { id?: string; index?: number; bypassed?: boolean } = {}): Promise<void> {
  return postEffectOp('effect-add', { track, type, ...opts })
}
export function postEffectRemove(track: string, id: string): Promise<void> {
  return postEffectOp('effect-remove', { track, id })
}
export function postEffectMove(track: string, id: string, index: number): Promise<void> {
  return postEffectOp('effect-move', { track, id, index })
}
export function postEffectEnabled(track: string, id: string, enabled: boolean): Promise<void> {
  return postEffectOp('effect-enabled', { track, id, enabled })
}

// ─── track grouping (Phase 22 Stream AF) ────────────────────────────────────────────────────────
// One route, five ops (mirrors /song's "whole-statement op" shape — a group's membership list isn't
// a single scalar, so it doesn't fit postEdit's {path,value} grammar). Like postAddTrack/
// postRemoveTrack, the daemon RETURNS the full raw document and we apply it directly (no optimistic
// local mirror — the daemon never SSE-echoes its own writes).

export type GroupOp =
  | { op: 'create'; trackIds: string[]; id?: string; name?: string; color?: string }
  | { op: 'delete'; id: string }
  | { op: 'rename'; id: string; name: string }
  | { op: 'recolor'; id: string; color: string }
  | { op: 'set-tracks'; id: string; trackIds: string[] }

export async function postGroupOp(body: GroupOp): Promise<void> {
  const base = daemonBase()
  const res = await fetch(`${base}/group`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = await res.json().then((b) => (b as { error?: string }).error).catch(() => res.statusText)
    throw new Error(msg || `HTTP ${res.status}`)
  }
  const { doc } = (await res.json()) as { written: boolean; doc: BeatDocument }
  useStore.getState().setDoc(doc)
}

// ─── vary-and-audition (Phase 15 Stream I) ──────────────────────────────────────────────────────
// The daemon's POST /vary returns a batch of param-variants, each a list of {path,value} edits in
// the SAME grammar postEdit already commits. Auditioning a variant = applying its edits to a base
// document snapshot in memory (heard live off the engine, which re-reads the store doc every tick)
// WITHOUT posting anything; "keep" replays those same edits through postEdit (one canonical line
// each on disk); "undo" just restores the snapshot. Nothing touches disk until keep — the revertible
// audition the product spec (§3) asks for.

export interface VaryEdit {
  path: string
  value: string
}
export interface VaryVariant {
  index: number
  edits: VaryEdit[]
  label: string
}
export interface VaryBatch {
  track: string
  group: string
  count: number
  amount: number
  seed: number
  variants: VaryVariant[]
}

/** Apply a list of {path,value} edits to a document IN MEMORY, reusing the exact optimistic mirror
 * postEdit uses (applyLocalEdit) so an auditioned variant matches what committing it would produce.
 * Pure — returns a new document; never posts. */
export function applyEdits(doc: BeatDocument, edits: VaryEdit[]): BeatDocument {
  let d = doc
  for (const e of edits) {
    const next = applyLocalEdit(d, e.path, e.value)
    if (next) d = next
  }
  return d
}

/** Ask the daemon to generate a vary batch scoped by the live selection. The daemon reads its own
 * in-memory selection; `body` may override the track/group/count/amount/seed. Throws with the
 * daemon's error message on a 4xx (e.g. a selection that points at a different track). */
export async function requestVary(body: { track?: string; group?: string; count?: number; amount?: number; seed?: number } = {}): Promise<VaryBatch> {
  const base = daemonBase()
  const res = await fetch(`${base}/vary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = await res
      .json()
      .then((b) => (b as { error?: string }).error)
      .catch(() => res.statusText)
    throw new Error(msg || `HTTP ${res.status}`)
  }
  return (await res.json()) as VaryBatch
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
