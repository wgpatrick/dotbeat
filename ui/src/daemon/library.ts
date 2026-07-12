// Phase 22 Stream AH — the content-browser sidebar's client-side data layer. Talks to the daemon's
// new /library* routes (src/daemon/daemon.ts) the same way bridge.ts talks to /edit, /add-track,
// etc.: install routes RETURN the fresh document (the daemon never SSE-echoes its own writes — see
// bridge.ts's header comment), so a successful drop lands straight in the store with no re-pull.
//
// This file owns TWO things: (1) fetching/installing the content catalog, and (2) the tiny
// drag-payload protocol ContentBrowser.tsx (the drag source) and ArrangementView.tsx/
// StepSequencer.tsx (the drop targets) share — kept here rather than duplicated in three
// components, so the wire format has exactly one definition.

import { daemonBase } from './bridge'
import { useStore } from '../state/store'
import type { BeatDocument } from '../types'

export interface LibraryPreset {
  name: string
  kind: 'synth' | 'drums' | 'any'
  category: string
  description: string
  params: Record<string, number | string | boolean>
}
// Phase 26 Stream DD (docs/research/27-macro-tooling-layer.md): mirrors src/core/macro.ts's
// BeatMacro/MacroTarget exactly (hand-mirrored, not imported — ui/ is a standalone Vite app; the
// daemon's JSON is the contract, same convention LibraryPreset above already follows).
export type LibraryMacroCurve = 'linear' | 'exp' | 'log'
export interface LibraryMacroTarget {
  param: string
  min: number
  max: number
  curve?: LibraryMacroCurve
}
export interface LibraryMacro {
  name: string
  kind: 'synth' | 'drums' | 'any'
  category: string
  description: string
  targets: LibraryMacroTarget[]
}

export interface LibraryKitLane {
  // Phase 22 Stream AB opened the lane model to arbitrary declared names (research 19 Part VI
  // Option B) — widened from the old closed DrumLane enum so a kit one-shot can target any of a
  // 12-lane kit's rows (rimshot/tom_lo/cowbell/...), not just the legacy 5.
  lane: string
  file: string
}
export interface LibraryKit {
  id: string
  lanes: LibraryKitLane[]
}
export interface LibrarySoundfont {
  file: string
  license?: string
  source?: string
}
export interface LibraryCatalog {
  presets: LibraryPreset[]
  categories: string[]
  macros: LibraryMacro[]
  kits: LibraryKit[]
  soundfonts: LibrarySoundfont[]
}

export async function fetchLibrary(): Promise<LibraryCatalog> {
  const res = await fetch(`${daemonBase()}/library`)
  if (!res.ok) throw new Error(`GET /library: HTTP ${res.status}`)
  return (await res.json()) as LibraryCatalog
}

/** Raw bytes of one library file (a kit one-shot or a soundfont bank) — for preview-before-load:
 * decode+play locally, never write anything (see engine.previewBuffer/previewSoundfont). */
export async function fetchLibraryFile(path: string): Promise<ArrayBuffer> {
  const res = await fetch(`${daemonBase()}/library/file?path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error(`GET /library/file?path=${path}: HTTP ${res.status}`)
  return res.arrayBuffer()
}

async function postLibrary(route: string, body: Record<string, unknown>): Promise<BeatDocument> {
  const res = await fetch(`${daemonBase()}${route}`, {
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
  const { doc } = (await res.json()) as { written: boolean; doc: BeatDocument }
  return doc
}

/** Drag a preset onto a track: applies its literal params via core's applyPreset (a normal edit
 * list — format-spec.md: presets are tooling, not grammar). Throws (kind mismatch, unknown name)
 * with the daemon's message; the caller decides how to surface it. */
export async function applyPresetToTrack(track: string, name: string): Promise<void> {
  const doc = await postLibrary('/library/apply-preset', { track, name })
  useStore.getState().setDoc(doc)
}

// ─── macros (Phase 26 Stream DD) ─────────────────────────────────────────────────────────────────
// "A macro is a preset with a continuous input" (research 18 §6, confirmed research 27 §1): no
// in-file indirection, ever — turning a macro knob resolves directly to real target values. The
// interactive knob drag in SynthPanel.tsx's MacroKnob computes this CLIENT-SIDE and posts each
// target through the existing per-path-debounced /edit channel (postEdit) — research 27 §4's own
// finding that this needs no new daemon plumbing, unlike `beat vary --scope selection`. This is a
// deliberate, small duplication of src/core/macro.ts's resolveTarget/resolveMacro math (research
// 27 §4: "a small pure function, safe to duplicate/share between src/core and ui/") rather than an
// import, because ui/ is a standalone Vite app with no dependency on the Node-only core package.

function resolveMacroTarget(t: LibraryMacroTarget, knob: number): number {
  const n = Math.min(1, Math.max(0, knob / 100))
  const shaped = t.curve === 'exp' ? n * n : t.curve === 'log' ? Math.sqrt(n) : n
  return t.min + shaped * (t.max - t.min)
}

/** Pure: knob position (0..100) -> resolved (param, value) pairs. Mirrors src/core/macro.ts's
 * resolveMacro exactly. */
export function resolveMacro(macro: LibraryMacro, knob: number): Array<{ param: string; value: number }> {
  return macro.targets.map((t) => ({ param: t.param, value: resolveMacroTarget(t, knob) }))
}

/** Best-effort inverse of resolveMacroTarget — used ONLY to estimate where a macro's knob should
 * visually sit from a target's current live value on (re)selection. Never stored: the file only
 * ever records resolved target values, never "this came from macro X at position N" (research 27
 * §6). Mirrors src/core/macro.ts's inverseResolveTarget exactly. */
export function inverseResolveMacroTarget(t: LibraryMacroTarget, value: number): number {
  const span = t.max - t.min
  if (span === 0) return 50
  const n = Math.min(1, Math.max(0, (value - t.min) / span))
  const shaped = t.curve === 'exp' ? Math.sqrt(n) : t.curve === 'log' ? n * n : n
  return Math.round(shaped * 100)
}

/** The one-shot, non-dragging macro apply (POST /library/apply-macro) — NOT used by the
 * interactive knob drag above (that resolves client-side and posts via /edit instead). Exposed
 * for parity with applyPresetToTrack and any future non-dragging "apply at a value" GUI action. */
export async function applyMacroToTrack(track: string, name: string, value: number): Promise<void> {
  const doc = await postLibrary('/library/apply-macro', { track, name, value })
  useStore.getState().setDoc(doc)
}

/** Drag one kit lane onto a drum lane (targetLane, if it differs from the sample's own lane) or a
 * whole kit onto a drum track (lane omitted -> every lane the kit has). */
export async function installKitLane(track: string, kit: string, opts: { lane?: string; targetLane?: string } = {}): Promise<void> {
  const doc = await postLibrary('/library/install-kit', { track, kit, ...opts })
  useStore.getState().setDoc(doc)
}

/** Drag a soundfont bank onto an existing instrument track (reassigns it) or drop it with no track
 * (mints a brand new instrument track carrying it — see daemon.ts's route comment for why). */
export async function installSoundfont(file: string, opts: { track?: string; program?: number } = {}): Promise<void> {
  const doc = await postLibrary('/library/install-soundfont', { file, ...opts })
  useStore.getState().setDoc(doc)
}

/** Phase 23 Stream BC: drag a kit one-shot (a real audio file — a `presets/kit-<id>` lane wav) onto an
 * `audio`-kind track to create a clip from it — the drag-to-create-audio-clip interaction the audio-
 * region clip format's GUI layer was still missing (docs/phase-22-stream-ae.md's own "not built"
 * note: repitch/split/gain trimming shipped, clip *creation* didn't). Same drag payload
 * (`kit-lane`) Stream AH already established for dropping a one-shot onto a drum lane — this is
 * just a new landing zone for it, not a new protocol. `clipId` given replaces that existing clip's
 * region in place; omitted mints a new one, slotted into `sceneId`'s scene if given (so it's
 * immediately visible on the arrangement canvas — omit sceneId in loop mode, where there's no scene
 * to slot into and the clip is created but not yet reachable from any section). Returns the id of
 * the clip that was created or replaced. */
export async function installAudioClip(
  track: string,
  kit: string,
  lane: string,
  opts: { clipId?: string; sceneId?: string } = {},
): Promise<string> {
  const res = await fetch(`${daemonBase()}/library/install-audio-clip`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ track, kit, lane, ...opts }),
  })
  if (!res.ok) {
    const msg = await res
      .json()
      .then((b) => (b as { error?: string }).error)
      .catch(() => res.statusText)
    throw new Error(msg || `HTTP ${res.status}`)
  }
  const { doc, clipId } = (await res.json()) as { written: boolean; doc: BeatDocument; clipId: string }
  useStore.getState().setDoc(doc)
  return clipId
}

// ─── drag-and-drop payload protocol ──────────────────────────────────────────────────────────────
// One custom MIME carrying a small tagged JSON payload — ContentBrowser.tsx sets it on drag-start;
// ArrangementView.tsx's track header and StepSequencer.tsx's lane rows read it on drop. A duck-typed
// {dataTransfer} parameter (not React.DragEvent) so this file doesn't need a React import — both
// native DragEvent and React's SyntheticEvent<DragEvent> carry a real DataTransfer.

export const LIBRARY_DND_MIME = 'application/x-dotbeat-library-item'

export type DragPayload =
  | { type: 'preset'; name: string; kind: 'synth' | 'drums' | 'any' }
  // `lane` present = one one-shot (drop onto a specific drum lane, possibly a DIFFERENT lane than
  // its own); `lane` absent = the whole kit, every lane it has (drop onto a drum track's header).
  | { type: 'kit-lane'; kit: string; lane?: string }
  | { type: 'soundfont'; file: string }

export function setDragPayload(dt: DataTransfer, payload: DragPayload): void {
  dt.setData(LIBRARY_DND_MIME, JSON.stringify(payload))
  dt.effectAllowed = 'copy'
}

/** Reads the drag payload off a drop (or dragover, to decide whether to show a drop-hover state).
 * Returns null for any drag that isn't one of ours (e.g. an OS file drop) or malformed JSON. Most
 * browsers only expose `getData` on the `drop` event itself (dragover/dragenter see an empty
 * string for security reasons) — callers that need to gate dragover styling should check
 * `dt.types.includes(LIBRARY_DND_MIME)` instead, which IS available during dragover. */
export function readDragPayload(dt: DataTransfer): DragPayload | null {
  const raw = dt.getData(LIBRARY_DND_MIME)
  if (!raw) return null
  try {
    return JSON.parse(raw) as DragPayload
  } catch {
    return null
  }
}
