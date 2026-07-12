// The M1 daemon (docs/phase-1-plan.md §1.3): a small local Node process that owns a .beat file
// and keeps it in two-way sync with a running BeatLab GUI.
//
// The browser↔daemon boundary is deliberately a tiny typed protocol over plain HTTP — never
// shared state — following the pattern that makes openDAW's UI/engine split work and its
// headless harness nearly free (docs/opendaw-notes.md §2):
//
//   GET  /doc      → the current document as partial-track JSON (BeatLab-bridge shape: the drum
//                    grid is a 16-step projection of the free-timed hits)
//   GET  /document → the current document as the RAW BeatDocument (dotbeat's own frontend reads
//                    this — it needs the absolute hits/notes the /doc projection collapses)
//   GET  /events   → SSE stream; a `doc` event fires when the file changes on disk,
//                    a `parse-error` event when a hand-edit is (momentarily) invalid
//   POST /state    → the browser's full sandbox payload; converted, canonically serialized,
//                    written to disk ONLY if musically different from the current document
//   POST /edit     → a single {path,value} edit primitive (the same vocabulary `beat set` uses,
//                    via core's setValue); one edit → one canonical line → a one-line git diff.
//                    dotbeat's own frontend uses this instead of the whole-document /state push:
//                    the format stores drums as free-timed hits absolute across loop_bars, so a
//                    16-step-pattern round-trip would tile a single step-toggle across every bar
//                    (N lines, not one). A path-scoped edit lands on exactly the one hit.
//
// Canonical serialization (docs/decisions.md D4) is the entire sync mechanism: "should this
// write?" and "is this watcher event an echo of my own write?" are both plain string
// comparisons. No dirty flags, no timestamps, no vector clocks.
//
// SSE over node:http instead of WebSockets: zero new dependencies, auto-reconnecting clients,
// and a one-directional push channel is genuinely all the file→GUI direction needs.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFileSync, writeFileSync, watch, existsSync, mkdirSync, copyFileSync, readdirSync, statSync, type FSWatcher } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BeatDocument, BeatSelection, DrumLane } from '../core/index.js'
import {
  parse,
  serialize,
  sandboxPayloadToBeatDocument,
  beatDocumentToPartialTracks,
  setValue,
  setAutomationPoint,
  removeAutomationPoint,
  validateSelection,
  saveClip,
  setScene,
  setSong,
  songMove,
  addTrack,
  removeTrack,
  setMediaSample,
  setLaneSample,
  parsePresetLibrary,
  applyPreset,
  filterPresetsByCategory,
  PRESET_CATEGORIES,
  DRUM_LANES,
  addEffect,
  removeEffect,
  moveEffect,
  setEffectEnabled,
  materializeLanes,
  addLane,
  removeLane,
  moveLane,
  setLaneBacking,
  setLaneParam,
  humanize,
  addGroup,
  removeGroup,
  renameGroup,
  setGroupColor,
  setGroupTracks,
  initDocument,
  defaultDrumKitLanes,
  splitAudioClip,
  addAudioClip,
  duplicateNotes,
  BeatEditError,
  BeatPresetError,
  BeatParseError,
  type ExternalSandboxPayload,
  type TrackKind,
  type BeatPreset,
  type EffectType,
  type BeatTrack,
} from '../core/index.js'
// Phase 23 Stream BA: the six Pitch & Time operations + Consolidate, over HTTP. Phase 22 Stream AD
// shipped these as CLI/MCP-only edit primitives ("no daemon route, matching quantize's own
// precedent" — the generic {path,value} /edit channel covers everything grammar-level quantize
// touches). But unlike quantize (one scalar per note), each of these is a whole-track batch op with
// its own parameter shape (semitones/factor/root+scale/axis/gap) that doesn't fit postEdit's single
// {path,value} grammar any better than /song or /audio-split's ops do — so this route mirrors THEIR
// additive shape exactly: one POST, one op, RETURNS the full raw document (no SSE echo of the
// daemon's own writes) so the GUI applies it directly, same as postAddTrack/postEffectAdd.
import { transposeNotes, timeScaleNotes, fitToScaleNotes, invertNotes, reverseNotes, legatoNotes, consolidateRatchet, BeatPitchTimeError } from '../core/pitchtime.js'
// Phase 23 Stream BC: reads a bundled kit one-shot's own duration (sample count / sample rate) so a
// freshly dragged-in audio clip's region can default to `out = the file's full length` instead of an
// arbitrary guess. The exact same decoder the mix-metrics/MCP surface already uses (src/mcp/server.ts)
// — a pure binary parse, no audio context, so it works fine in the daemon's Node process.
import { decodeWav } from '../metrics/index.js'
// D3/D10 versioning surface over HTTP: the GUI's history panel (Phase 15 Stream H) reads the
// checkpoint list and issues "go back" through these. All of it reuses src/history's real git-backed
// functions — the daemon adds no versioning logic, just an HTTP face on the same verbs `beat
// history`/`beat restore`/`beat pin` expose. A restore/pin writes the .beat file on disk, which the
// daemon's own directory watcher picks up and broadcasts as a `doc` SSE event, so the GUI hot-reloads
// through the exact same external-edit path a hand edit or `beat set` uses — no special echo needed.
import { history, collapsedHistory, restore, pin, unpin, HistoryError } from '../history/index.js'
// D2/D5 vary-and-audition surface over HTTP (Phase 15 Stream I): the GUI's inline "vary" affordance
// POSTs /vary, which resolves the daemon's live pointing selection into a (track, param-group) and
// runs core's `varyTrack` — the exact same rung-1 param-variation `beat vary <file> <track> <group>`
// produces, over HTTP instead of shelling to the CLI. It is READ-ONLY: it returns the batch (each
// variant IS a list of `beat set`-shaped {path,value} edits), the GUI auditions a variant by
// applying its edits provisionally in-memory (heard live off the running engine, never written), and
// "keep" commits the chosen variant's edits through the ordinary POST /edit path — so audition is
// revertible by construction (nothing touches disk until Keep). See docs/phase-15-vary-affordance.md.
import { varyTrack, varyFeel, VARY_GROUPS, BeatVaryError } from '../vary/vary.js'

/** Drum lane -> the param group that shapes that lane's sound, so "highlight the hats, vary" mutates
 * the hats' own synth params (hatTone/hatDecay/openHatDecay) with no typing. clap rides the snare
 * group (both are the drums' snare/clap voice params in VARY_GROUPS). */
const DRUM_LANE_GROUP: Readonly<Record<string, string>> = { kick: 'kick', snare: 'snare', clap: 'snare', hat: 'hats', openhat: 'hats' }

export interface VaryRequestBody {
  track?: string
  group?: string
  count?: number
  amount?: number
  seed?: number
}

/** Resolve the daemon's live selection (plus any explicit request overrides) into the one (track,
 * group) a rung-1 param-vary round needs. Pure; exported for direct unit testing (test/vary-route).
 *
 *   - the target track comes from the request body if given, else the single track the selection is
 *     "about" (its tracks/lanes/notes axes union to one), else the doc's selected/first track.
 *   - ENFORCED SCOPE (spec §2): if the selection names specific tracks and the resolved target is not
 *     among them, this throws — a param-vary can't be aimed outside what's highlighted.
 *   - the group comes from the request body if given, else is inferred from a selected drum lane on
 *     the target (hats/kick/snare), else defaults by track kind (drums->hats, synth/instrument->
 *     filter). Param groups mutate whole-track synth params, so bars/note narrowing doesn't refine
 *     them — the selection's role here is "which track, and (nicely) which group". */
export function resolveVaryTarget(sel: BeatSelection, doc: BeatDocument, body: VaryRequestBody = {}): { track: string; group: string } {
  const involved = new Set<string>()
  if (sel.tracks) for (const t of sel.tracks) involved.add(t)
  if (sel.lanes) for (const l of sel.lanes) involved.add(l.track)
  if (sel.notes) for (const n of sel.notes) involved.add(n.track)

  let track = body.track
  if (track === undefined) {
    if (involved.size === 1) track = [...involved][0]
    else if (involved.size > 1) throw new BeatVaryError(`selection spans ${involved.size} tracks (${[...involved].join(', ')}) — specify which one to vary`)
    else track = doc.selectedTrack || doc.tracks[0]?.id
  }
  if (!track) throw new BeatVaryError('no track to vary (empty document?)')
  const t = doc.tracks.find((x) => x.id === track)
  if (!t) throw new BeatVaryError(`no track "${track}" (have: ${doc.tracks.map((x) => x.id).join(', ')})`)
  if (involved.size > 0 && !involved.has(track)) {
    throw new BeatVaryError(`selection covers ${[...involved].join(', ')}, not "${track}" — refusing to vary outside the selection`)
  }

  let group = body.group
  if (group === undefined) {
    const lane = sel.lanes?.find((l) => l.track === track)?.lane
    group = (lane ? DRUM_LANE_GROUP[lane] : undefined) ?? (t.kind === 'drums' ? 'hats' : 'filter')
  }
  if (!VARY_GROUPS[group]) throw new BeatVaryError(`unknown group "${group}" (have: ${Object.keys(VARY_GROUPS).join(', ')})`)
  return { track, group }
}

// ─── Arrangement-length surface over HTTP (Phase 19 Stream V) ────────────────────────────────────
// setValue's {path,value} grammar covers `loop_bars` (loop-mode length) but NOT the song timeline:
// appending / deleting / resizing a section is a whole-list statement (setSong replaces the section
// list; sections are few and order IS the data — see src/core/edit.ts). POST /song is a thin HTTP
// face on core's setSong/setScene/saveClip, the same "reuse the real core verb" pattern /vary and
// /history follow — no arrangement logic lives here, just the three high-level ops the GUI needs.

/** Next free `sN` scene id (loop→song conversion mints one). */
function nextSceneId(doc: BeatDocument): string {
  let max = 0
  for (const s of doc.scenes) {
    const m = /^s(\d+)$/.exec(s.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `s${max + 1}`
}

/** Build a scene from every track's LIVE content: snapshot each track into a clip named `sceneId`
 * (core's saveClip) and map every track to it (core's setScene). This is how loop mode becomes song
 * mode without discarding what's there — the existing loop content becomes a real, playable scene.
 *
 * Phase 23 Stream BC fix: `audio`-kind tracks are SKIPPED here — they have no live content to
 * snapshot (docs/phase-22-stream-ae.md: "BeatTrack gets no `audio` field, only `BeatClip.audio?`"),
 * and saveClip's generic "snapshot whatever's live" produces a clip with no `audio` line, which the
 * parser then rejects outright (every clip on an audio track must carry one, same fail-loud stance
 * as an instrument track missing its soundfont line) — so converting to song mode with an empty
 * audio track present used to 500 the whole /song route. Leaving it unmapped in the new scene is a
 * perfectly valid state already handled everywhere else (an unmapped track is silent that section,
 * same as any track absent from a scene's slots) — the track just starts silent until a real region
 * is created and slotted (e.g. dragging a sample onto it — ui/src/daemon/library.ts's
 * installAudioClip). */
function sceneFromLiveContent(doc: BeatDocument, sceneId: string): BeatDocument {
  let d = doc
  const slots: Record<string, string> = {}
  for (const t of d.tracks) {
    if (t.kind === 'audio') continue
    d = saveClip(d, t.id, sceneId).doc
    slots[t.id] = sceneId
  }
  return setScene(d, sceneId, slots)
}

/** Append a section. In song mode the new section reuses the last section's scene (its slot map is
 * the "starting content" the spec asks for). In loop mode (song === null) this first converts to
 * song mode: section 0 is the existing loop content (loopBars long), section 1 is the new one. */
export function songAppend(doc: BeatDocument, bars: number): BeatDocument {
  if (!Number.isInteger(bars) || bars < 1 || bars > 64) throw new BeatEditError(`section bars must be an integer 1-64, got ${bars}`)
  if (doc.song && doc.song.length > 0) {
    const last = doc.song[doc.song.length - 1]!
    return setSong(doc, [...doc.song, { scene: last.scene, bars }])
  }
  const sceneId = nextSceneId(doc)
  const withScene = sceneFromLiveContent(doc, sceneId)
  return setSong(withScene, [
    { scene: sceneId, bars: doc.loopBars },
    { scene: sceneId, bars },
  ])
}

/** Delete the section at `index`. Refuses to remove the last remaining section (a song block needs
 * at least one section; clearing back to loop mode is a distinct, deliberate act, not a delete). */
export function songDelete(doc: BeatDocument, index: number): BeatDocument {
  if (!doc.song || doc.song.length === 0) throw new BeatEditError('not in song mode — no section to delete')
  if (!Number.isInteger(index) || index < 0 || index >= doc.song.length) throw new BeatEditError(`section index ${index} out of range (0-${doc.song.length - 1})`)
  if (doc.song.length === 1) throw new BeatEditError('cannot delete the last remaining section')
  return setSong(doc, doc.song.filter((_, i) => i !== index))
}

// ─── cross-section clip move (Phase 24 Stream CC) ────────────────────────────────────────────────
// ArrangementView.tsx's occurrences are 1:1 with sections: a track's clip occurrence at section
// index N is simply "does section N's scene map this track to a clip" (trackOccurrences/
// flattenTrack). There is no independent per-track bar position to move — a clip is never at an
// arbitrary bar, only ever "this track's slot in this section's scene" — so the honest edit
// primitive for "drag a clip occurrence to a different bar position" is: clear the track's slot in
// the source section's scene, and set it in the target section's scene (exactly what docs/
// phase-24-plan.md's own framing anticipated: "moving a clip... edits which SCENE a section
// plays... for that track").
//
// The one wrinkle: dotbeat scenes are deliberately REUSED across sections (night-shift-song.beat's
// own "intro" scene backs 4 separate sections) — that's real, intentional content, not an edge
// case. Naively mutating a shared scene's slots would silently also change every OTHER section
// that happens to reuse it, which is not what "move THIS occurrence" means. So every section
// touched by a batch of moves (as a source OR a destination) gets its own freshly-minted, private
// scene — a full copy of its current slot map, patched with just this batch's removals/additions —
// before any slot is written. Sections not in the batch, even if they shared the old scene id,
// never change. A whole marquee-selected GROUP of moves (potentially several tracks, several
// sections) is applied as one batch/one write, so a multi-clip drag is one clean commit, not N.
export interface ClipMove {
  track: string
  fromIndex: number
  toIndex: number
}

export function applyClipMoves(doc: BeatDocument, moves: ClipMove[]): BeatDocument {
  if (!doc.song || doc.song.length === 0) throw new BeatEditError('not in song mode — no sections to move a clip between')
  const sections = doc.song
  const real = moves.filter((m) => m.fromIndex !== m.toIndex)
  if (real.length === 0) return doc

  for (const mv of real) {
    if (!Number.isInteger(mv.fromIndex) || mv.fromIndex < 0 || mv.fromIndex >= sections.length) {
      throw new BeatEditError(`fromIndex ${mv.fromIndex} out of range (0-${sections.length - 1})`)
    }
    if (!Number.isInteger(mv.toIndex) || mv.toIndex < 0 || mv.toIndex >= sections.length) {
      throw new BeatEditError(`toIndex ${mv.toIndex} out of range (0-${sections.length - 1})`)
    }
  }

  // Resolve every move's clip id up front, against the UNCHANGED starting document — a track can
  // be both a "from" and a "to" for different moves in the same batch (e.g. two tracks swapping
  // sections), so nothing here may read a slot that an earlier move in this same loop already
  // touched.
  const resolved = real.map((mv) => {
    const scene = doc.scenes.find((s) => s.id === sections[mv.fromIndex]!.scene)
    const clipId = scene?.slots[mv.track]
    if (!clipId) throw new BeatEditError(`track "${mv.track}" has no clip playing in section ${mv.fromIndex}`)
    return { ...mv, clipId }
  })

  const removals = new Map<number, Set<string>>() // section index -> track ids to unmap
  const additions = new Map<number, Map<string, string>>() // section index -> track id -> clip id to map
  for (const mv of resolved) {
    if (!removals.has(mv.fromIndex)) removals.set(mv.fromIndex, new Set())
    removals.get(mv.fromIndex)!.add(mv.track)
    if (!additions.has(mv.toIndex)) additions.set(mv.toIndex, new Map())
    additions.get(mv.toIndex)!.set(mv.track, mv.clipId)
  }

  const nextSections = sections.map((s) => ({ ...s }))
  let next = doc
  for (const idx of new Set<number>([...removals.keys(), ...additions.keys()])) {
    const sec = nextSections[idx]!
    const scene = next.scenes.find((s) => s.id === sec.scene)
    const slots = { ...(scene?.slots ?? {}) }
    for (const track of removals.get(idx) ?? []) delete slots[track]
    for (const [track, clipId] of additions.get(idx) ?? []) slots[track] = clipId
    // Always mint a fresh scene for a touched section, even if its old scene wasn't actually
    // shared — simplest way to guarantee this move never bleeds into a sibling section, and
    // nextSceneId(next) is always strictly past every scene minted so far this batch too.
    const newId = nextSceneId(next)
    next = setScene(next, newId, slots)
    nextSections[idx] = { ...sec, scene: newId }
  }
  return setSong(
    next,
    nextSections.map((s) => ({ scene: s.scene, bars: s.bars })),
  )
}

// ─── overlapping-region resolution policy (Phase 22 Stream AG) ──────────────────────────────────
// docs/research/22-opendaw-editing-workflow.md §2.1: openDAW ships a user-configurable overlap
// policy — `["clip", "push-existing", "keep-existing"]` — for what happens when a dragged/resized
// region would overlap its neighbor. dotbeat's song timeline is a flat ORDERED LIST of section
// durations (no independently-positioned regions — a section's start is always the sum of the
// bars before it), so two sections can never literally overlap the way two Ableton clips on the
// same track can. The one place growth genuinely "conflicts" with something is resizing a
// NON-LAST section larger: that growth has to come from somewhere, and today it silently always
// pushes every later section's start (their bar counts are untouched, they just begin later —
// this already IS openDAW's "push-existing" behavior, since startBar is derived, not stored).
// Shrinking, and growing the LAST section, never conflict with anything (nothing sits after them
// to disturb), so every policy behaves identically there — matching openDAW, where the policy is a
// no-op when there's nothing to overlap in the first place.
export type OverlapPolicy = 'clip' | 'push-existing' | 'keep-existing'
export const OVERLAP_POLICIES: readonly OverlapPolicy[] = ['clip', 'push-existing', 'keep-existing']

/** Resize the section at `index` to `bars` bars (setSong validates the 1-64 range), resolving a
 * growth-into-the-next-section conflict per `policy` (default 'push-existing' — today's original,
 * unconditional behavior, so existing callers/tests are unaffected by the new parameter):
 *
 *   push-existing (default) — the resized section gets its full requested size; every later
 *     section is unaffected (their bar counts don't change) and simply starts later. Total song
 *     length grows by the delta. This is openDAW's "anything it overlaps gets pushed" — dotbeat has
 *     no second track to push a whole region to, so "pushed" means "starts later in the same list."
 *   clip — the resized section gets its full requested size; the NEXT section is truncated
 *     (shrunk) to absorb the growth, so total song length is unchanged. Never cascades past that
 *     one neighbor (openDAW's rule) — growth is capped at how many bars the next section can give
 *     up before hitting the 1-bar floor.
 *   keep-existing — the mirror image: nothing else may move or resize, so a growth that would
 *     require it is simply refused (the section's bars stay at their current value). Shrinking
 *     always succeeds under every policy (it never requires anything else to change). */
export function songResize(doc: BeatDocument, index: number, bars: number, policy: OverlapPolicy = 'push-existing'): BeatDocument {
  if (!doc.song || doc.song.length === 0) throw new BeatEditError('not in song mode — no section to resize')
  if (!Number.isInteger(index) || index < 0 || index >= doc.song.length) throw new BeatEditError(`section index ${index} out of range (0-${doc.song.length - 1})`)
  if (!(OVERLAP_POLICIES as readonly string[]).includes(policy)) throw new BeatEditError(`unknown overlap policy "${String(policy)}" (expected ${OVERLAP_POLICIES.join('|')})`)
  // Validated here, up front, rather than left to setSong: the 'clip' and 'keep-existing' branches
  // below don't always pass the raw requested `bars` through to setSong (clip caps it against the
  // neighbor's slack; keep-existing may no-op entirely), so an out-of-range request could otherwise
  // slip past validation under those two policies while still correctly failing under push-existing
  // — the same bad input must fail loudly identically no matter which policy is selected.
  if (!Number.isInteger(bars) || bars < 1 || bars > 64) throw new BeatEditError(`section bars must be an integer 1-64, got ${bars}`)
  const sections = doc.song
  const cur = sections[index]!
  const delta = bars - cur.bars
  const isLast = index === sections.length - 1

  if (delta <= 0 || isLast || policy === 'push-existing') {
    // Shrinking, growing the last section, or the push-existing policy: only this section changes
    // (setSong validates 1-64) — the original, unconditional resize behavior.
    return setSong(doc, sections.map((s, i) => (i === index ? { scene: s.scene, bars } : s)))
  }
  if (policy === 'keep-existing') {
    // Existing arrangement (everything but the incoming edit) must not move — refuse the part of
    // the growth that would require it. A no-op write (harmless; writeIfChanged skips it).
    return doc
  }
  // 'clip': the next section absorbs the growth (truncated, floor of 1 bar) so total length holds.
  const next = sections[index + 1]!
  const give = Math.min(delta, next.bars - 1)
  return setSong(
    doc,
    sections.map((s, i) => {
      if (i === index) return { scene: s.scene, bars: cur.bars + give }
      if (i === index + 1) return { scene: s.scene, bars: next.bars - give }
      return s
    }),
  )
}

export interface DaemonOptions {
  filePath: string
  port?: number
}

export interface Daemon {
  port: number
  filePath: string
  close: () => Promise<void>
  /** Test hook: the current in-memory document (what /doc serves). */
  getDoc: () => BeatDocument
  /** Test hook: the current in-memory selection (what /selection serves; {} when unset). */
  getSelection: () => BeatSelection
}

const CORS_HEADERS: Record<string, string> = {
  // The daemon binds to localhost only; the GUI origin is the local vite dev server, whose port
  // varies. Wildcard is acceptable for a loopback-only, single-user dev daemon.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
}

function readBody(req: IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS_HEADERS })
  res.end(JSON.stringify(body))
}

// ─── Phase 22 Stream AH: the content-browser library surface ────────────────────────────────────
// Read-only catalog over the repo's bundled, un-project-scoped content (presets/factory.json,
// presets/kit-*/, presets/sf2/*.sf2) — the same data `beat presets`/`beat presets --category`
// already reads (src/core/preset.ts's parsePresetLibrary/PRESET_CATEGORIES), plus the kit/soundfont
// directories no CLI/MCP surface lists today (docs/phase-18-content-taxonomy.md flagged this as
// real follow-up work, out of that stream's file-ownership boundary). Three write routes "install"
// a browsed item into the CURRENT project:
//   - apply-preset: literal param edits via core's applyPreset — no reference, no indirection
//     (format-spec.md: presets are tooling, not grammar). Same function `beat preset` calls.
//   - install-kit: copies the kit's one-shot wav(s) into this project's OWN media/ directory,
//     registers them via setMediaSample (content-addressed, same as `beat sample`), and assigns
//     via setLaneSample — the same two primitives `beat sample` + `beat lane` chain together.
//   - install-soundfont: same copy+register, then either reassigns an existing instrument track's
//     bank (the already-existing `<track>.soundfont` setValue path) or mints a brand new instrument
//     track carrying it (core's addTrack) — closing the real gap ArrangementView.tsx's addTrackOfKind
//     documents ("the GUI has no sample-registration surface" — Phase 20 Stream W's honest comment).
// Presets are pure text edits; kits/soundfonts are the one place this stream touches bytes, and it
// always copies into the PROJECT's media/ (never references presets/ by path — the file must still
// stand alone, D1).

const presetsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'presets')

function loadFactoryPresets(): BeatPreset[] {
  const path = process.env.BEAT_PRESETS ?? resolve(presetsRoot, 'factory.json')
  return parsePresetLibrary(readFileSync(path, 'utf8'))
}

interface KitLane {
  lane: DrumLane
  file: string
}
interface KitEntry {
  id: string
  lanes: KitLane[]
}

/** Every `presets/kit-<name>` directory that has at least one of the five recognized lane one-shots
 * (`<lane>.wav`, DRUM_LANES' own names — the same convention docs/phase-7-plan.md established for
 * kit-init/kit-audiophob). Missing lanes are just omitted, not an error — a kit need not be
 * complete. */
function listKits(): KitEntry[] {
  let entries: string[]
  try {
    entries = readdirSync(presetsRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('kit-'))
      .map((d) => d.name)
  } catch {
    return []
  }
  return entries
    .map((id) => ({
      id,
      lanes: (DRUM_LANES as readonly DrumLane[])
        .filter((lane) => existsSync(resolve(presetsRoot, id, `${lane}.wav`)))
        .map((lane) => ({ lane, file: `${lane}.wav` })),
    }))
    .filter((k) => k.lanes.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
}

interface SoundfontEntry {
  file: string
  license?: string
  source?: string
}

/** Every `presets/sf2/*.sf2` bank. License/source come best-effort from the `<file>.json`
 * provenance sidecar (docs/phase-7-plan.md's convention) — a missing/unparseable sidecar just
 * omits that metadata, it doesn't hide the bank (the sidecar is documentation, never grammar). */
function listSoundfonts(): SoundfontEntry[] {
  const dir = resolve(presetsRoot, 'sf2')
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.sf2') || f.endsWith('.sf3'))
  } catch {
    return []
  }
  return files
    .map((file) => {
      let meta: { license?: string; source?: string } = {}
      try {
        const raw = JSON.parse(readFileSync(resolve(dir, `${file}.json`), 'utf8')) as { license?: unknown; source?: unknown }
        meta = {
          ...(typeof raw.license === 'string' ? { license: raw.license } : {}),
          ...(typeof raw.source === 'string' ? { source: raw.source } : {}),
        }
      } catch {
        // sidecar optional
      }
      return { file, ...meta }
    })
    .sort((a, b) => a.file.localeCompare(b.file))
}

/** Phase 23 Stream BC: the next free `clip<n>` id on a track — used when a drag-created audio clip
 * has no caller-given id (a brand new clip, not a replace-in-place drop onto an existing one). Same
 * "mint the next free numbered id" idiom splitAudioClip already uses for its second half. */
function nextFreeClipId(track: BeatTrack): string {
  const existing = new Set(track.clips.map((c) => c.id))
  let n = 1
  while (existing.has(`clip${n}`)) n++
  return `clip${n}`
}

/** Resolves a library-relative path to bytes under `presetsRoot`, refusing anything that escapes
 * it (traversal-safe, same discipline the `/media/<path>` route uses for the project's own media). */
function resolveLibraryPath(rel: string): string | null {
  const abs = resolve(presetsRoot, rel)
  if (abs !== presetsRoot && !abs.startsWith(presetsRoot + sep)) return null
  return abs
}

export async function startDaemon(opts: DaemonOptions): Promise<Daemon> {
  const filePath = resolve(opts.filePath)
  const requestedPort = opts.port ?? 8420

  // Fail loudly at startup if the file doesn't exist or doesn't parse — a daemon that boots on a
  // broken document has nothing true to serve.
  let lastFileText = readFileSync(filePath, 'utf8')
  let doc = parse(lastFileText)
  let canonicalText = serialize(doc)

  const sseClients = new Set<ServerResponse>()

  // The D2 pointing protocol: ephemeral "what the human is highlighted in the GUI right now",
  // held in memory ONLY — never serialized into the .beat file. {} = no selection.
  let selection: BeatSelection = {}

  function broadcast(event: string, data: unknown) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of sseClients) client.write(frame)
  }

  // Editors (vim included) save via atomic rename, which orphans a watcher attached to the file's
  // inode — so watch the *directory* and filter by name (docs/phase-1-plan.md).
  const dir = dirname(filePath)
  const name = basename(filePath)
  let watchTimer: ReturnType<typeof setTimeout> | null = null
  const watcher: FSWatcher = watch(dir, (_eventType, changedName) => {
    if (changedName !== null && changedName !== name) return
    // Debounce: one save can emit several fs events; also gives an editor's write time to finish.
    if (watchTimer) clearTimeout(watchTimer)
    watchTimer = setTimeout(onFileMaybeChanged, 60)
  })

  function onFileMaybeChanged() {
    let text: string
    try {
      text = readFileSync(filePath, 'utf8')
    } catch {
      return // transient (mid-rename); the next event will retry
    }
    if (text === lastFileText) return // echo of our own write, or a no-op save
    lastFileText = text
    let next: BeatDocument
    try {
      next = parse(text)
    } catch (err) {
      // A half-saved or momentarily-invalid hand edit is normal, not fatal. Tell the GUI and
      // keep serving the last good document.
      broadcast('parse-error', { message: err instanceof Error ? err.message : String(err) })
      return
    }
    doc = next
    canonicalText = serialize(doc)
    broadcast('doc', beatDocumentToPartialTracks(doc))
    revalidateSelection()
  }

  // A selection points at ids in the document; a hand edit that removes a selected track/note/lane
  // invalidates it. Rather than serve a stale pointer, drop to empty and tell the GUI.
  function revalidateSelection() {
    if (Object.keys(selection).length === 0) return
    try {
      validateSelection(selection, doc)
    } catch {
      selection = {}
      broadcast('selection', selection)
    }
  }

  // Shared write path for a document-producing edit: canonical-to-canonical comparison decides
  // whether anything is written (same discipline as POST /state — identical music, identical
  // bytes, no write, no watcher echo). Re-parses our own canonical text so in-memory === disk.
  function writeIfChanged(nextDoc: BeatDocument): boolean {
    const nextText = serialize(nextDoc)
    if (nextText === canonicalText) return false
    writeFileSync(filePath, nextText)
    lastFileText = nextText
    canonicalText = nextText
    doc = parse(nextText)
    return true
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS)
      res.end()
      return
    }

    if (req.method === 'GET' && url.pathname === '/doc') {
      json(res, 200, beatDocumentToPartialTracks(doc))
      return
    }

    // dotbeat's own frontend reads the RAW document (absolute hits/notes, full synth), not the
    // 16-step-collapsed /doc projection — it renders the free-timed event model directly.
    if (req.method === 'GET' && url.pathname === '/document') {
      json(res, 200, doc)
      return
    }

    // v0.5 media: serve the document's referenced sample files to the browser bridge. Only
    // paths DECLARED in the media block are servable — this is a project-file server, not a
    // directory listing; the declared-paths check also makes traversal structurally impossible
    // (declared paths are validated relative-only at parse time).
    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      const wanted = decodeURIComponent(url.pathname.slice('/media/'.length))
      const entry = doc.media.find((m) => m.path === `media/${wanted}` || m.path === wanted)
      if (!entry) {
        json(res, 404, { error: `no media entry with path "${wanted}" in the document` })
        return
      }
      const abs = resolve(dirname(resolve(filePath)), entry.path)
      try {
        const bytes = readFileSync(abs)
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length, ...CORS_HEADERS })
        res.end(bytes)
      } catch {
        json(res, 404, { error: `media file missing on disk: ${entry.path}` })
      }
      return
    }

    // v0.6 instrument tracks: enumerate every program (preset) in a registered SoundFont bank so
    // the GUI's instrument panel can offer program selection. Mirrors `beat inspect`'s multi-preset
    // listing (cli/beat.mjs / src/mcp/server.ts): reads the actual .sf2 bytes (sha256-verified
    // against the media block) and parses them with spessasynth_core's SoundBankLoader — a pure
    // binary parse, no audio context. Additive and read-only.
    if (req.method === 'GET' && url.pathname === '/soundfont-presets') {
      const sampleId = url.searchParams.get('sample')
      if (!sampleId) {
        json(res, 400, { error: 'missing ?sample=<mediaId>' })
        return
      }
      const entry = doc.media.find((m) => m.id === sampleId)
      if (!entry) {
        json(res, 404, { error: `no media entry with id "${sampleId}" in the document` })
        return
      }
      const abs = resolve(dirname(resolve(filePath)), entry.path)
      ;(async () => {
        if (!existsSync(abs)) {
          json(res, 404, { error: `soundfont file missing on disk: ${entry.path}` })
          return
        }
        const bytes = readFileSync(abs)
        const hash = createHash('sha256').update(bytes).digest('hex')
        if (hash !== entry.sha256) {
          json(res, 409, { error: `sha256 mismatch for ${entry.path} (file ${hash.slice(0, 12)}..., document expects ${entry.sha256.slice(0, 12)}...)` })
          return
        }
        const { SoundBankLoader } = (await import('spessasynth_core')) as unknown as {
          SoundBankLoader: { fromArrayBuffer: (b: ArrayBuffer) => { presets: { program: number; bankMSB: number; bankLSB: number; name: string }[] } }
        }
        const bank = SoundBankLoader.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
        const presets = bank.presets
          .map((p) => ({ program: p.program, bankMSB: p.bankMSB, bankLSB: p.bankLSB, name: p.name }))
          .sort((a, b) => a.bankMSB - b.bankMSB || a.bankLSB - b.bankLSB || a.program - b.program)
        json(res, 200, { presets })
      })().catch((err) => json(res, 500, { error: err instanceof Error ? err.message : String(err) }))
      return
    }

    // D2 pointing protocol: the selection is a channel parallel to /doc — ephemeral, in-memory,
    // never touching disk. GET returns {} when unset.
    if (req.method === 'GET' && url.pathname === '/selection') {
      json(res, 200, selection)
      return
    }

    if (req.method === 'POST' && url.pathname === '/selection') {
      readBody(req)
        .then((body) => {
          const next = JSON.parse(body) as BeatSelection
          // Validate against the CURRENT document; a selection that doesn't resolve is a client
          // bug worth surfacing loudly (400), not silently storing.
          validateSelection(next, doc)
          selection = next
          broadcast('selection', selection)
          json(res, 200, selection)
        })
        .catch((err) => {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        ...CORS_HEADERS,
      })
      res.write('retry: 500\n\n')
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return
    }

    if (req.method === 'POST' && url.pathname === '/state') {
      readBody(req)
        .then((body) => {
          const payload = JSON.parse(body) as ExternalSandboxPayload
          if (!Array.isArray(payload.tracks) || typeof payload.bpm !== 'number') {
            json(res, 400, { error: 'body is not a sandbox payload' })
            return
          }
          const { doc: converted, report } = sandboxPayloadToBeatDocument(payload)
          // v0.5: the GUI has no media/lane-sample editing surface, so a GUI push must never
          // erase them — carry the CURRENT document's media table and per-track lane
          // assignments over (for tracks that still exist; a lane's sample id must still
          // resolve, which it does because media is carried wholesale).
          const carried = converted.tracks.map((t) => {
            const prev = doc.tracks.find((p) => p.id === t.id)
            let next = prev && Object.keys(prev.laneSamples).length > 0 ? { ...t, laneSamples: prev.laneSamples } : t
            // v0.10: groove/shuffle has no external-payload concept either (see convert.ts's
            // sandboxPayloadToBeatDocument) — carry it across the same never-erase way, so a GUI
            // knob-turn push never silently un-shuffles a track that CLI/MCP set groove on.
            if (prev && prev.shuffleAmount !== 0) next = { ...next, shuffleAmount: prev.shuffleAmount, shuffleGrid: prev.shuffleGrid }
            return next
          })
          // v0.6: instrument tracks never reach the GUI, so they never come back in a GUI push —
          // reinsert them at their original positions (same never-erase rule as media).
          for (const [i, t] of doc.tracks.entries()) {
            if (t.kind === 'instrument') carried.splice(Math.min(i, carried.length), 0, t)
          }
          // v0.10: the GUI's whole-document push has no group-editing surface (groups are edited
          // through the dedicated POST /group route below), so a /state push must never erase them —
          // same never-erase rule as media/instrument tracks above. Defensively drop any member track
          // the payload didn't carry over (same "a group left with zero members is dropped entirely"
          // cleanup removeTrack does — see src/core/edit.ts) so the written file always stays
          // internally consistent even if the browser payload silently omitted a track.
          const carriedIds = new Set(carried.map((t) => t.id))
          const groups = doc.groups.map((g) => ({ ...g, tracks: g.tracks.filter((tid) => carriedIds.has(tid)) })).filter((g) => g.tracks.length > 0)
          const nextDoc = {
            ...converted,
            media: doc.media,
            tracks: carried,
            groups,
          }
          const nextText = serialize(nextDoc)
          // Canonical-to-canonical comparison: identical music → identical bytes → no write.
          // (Comparing against serialize(doc), not the raw file text, means a hand-added comment
          // is left alone until a real musical change rewrites the file in canonical form —
          // comments are a hand-editing convenience, not canonical, per format-spec.md.)
          const written = nextText !== canonicalText
          if (written) {
            writeFileSync(filePath, nextText)
            lastFileText = nextText
            canonicalText = nextText
            // Re-parse our own canonical text rather than keeping nextDoc: the payload's note
            // order isn't canonical (serialize sorts notes), and memory must never disagree
            // with disk — getDoc() === parse(file) is an invariant the tests assert.
            doc = parse(nextText)
          }
          json(res, 200, { written, report })
        })
        .catch((err) => {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // dotbeat's own frontend edit channel: one {path,value} primitive per call (bpm, loop_bars,
    // selected_track, <track>.<param>, <track>.pattern.<lane>[<step>] — exactly `beat set`'s
    // grammar, via core's setValue). Finer-grained than /state on purpose (see header): a step
    // toggle or knob turn round-trips as a single canonical line.
    if (req.method === 'POST' && url.pathname === '/edit') {
      readBody(req)
        .then((body) => {
          const { path, value } = JSON.parse(body) as { path?: unknown; value?: unknown }
          if (typeof path !== 'string' || typeof value !== 'string') {
            json(res, 400, { error: 'body must be {path: string, value: string}' })
            return
          }
          const written = writeIfChanged(setValue(doc, path, value))
          revalidateSelection()
          json(res, 200, { written })
        })
        .catch((err) => {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // Phase 19 Stream V: the arrangement-length edit surface the {path,value} /edit grammar can't
    // express. One high-level op per call — append / delete / resize a song section — each a thin
    // call into core's setSong/setScene/saveClip (see the helpers above), written the same
    // canonical-to-canonical way /edit is. The GUI re-pulls /document afterward (the daemon doesn't
    // echo its own writes). loop_bars (loop-mode length) still rides the ordinary /edit path.
    // Phase 24 Stream CB: 'move' reorders a section (core's songMove) — same shape as the other
    // three ops, just a straight pass-through since songMove needs no daemon-side composition
    // (unlike append's scene-from-live-content bootstrap or resize's overlap-policy branching).
    if (req.method === 'POST' && url.pathname === '/song') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { op?: unknown; index?: unknown; bars?: unknown; policy?: unknown; from?: unknown; to?: unknown }
          let next: BeatDocument
          if (b.op === 'append') next = songAppend(doc, Number(b.bars))
          else if (b.op === 'resize') next = songResize(doc, Number(b.index), Number(b.bars), typeof b.policy === 'string' ? (b.policy as OverlapPolicy) : undefined)
          else if (b.op === 'delete') next = songDelete(doc, Number(b.index))
          else if (b.op === 'move') next = songMove(doc, Number(b.from), Number(b.to)).doc
          else {
            json(res, 400, { error: `unknown song op "${String(b.op)}" (expected append|resize|delete|move)` })
            return
          }
          const written = writeIfChanged(next)
          revalidateSelection()
          json(res, 200, { written, song: doc.song })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // Phase 24 Stream CC: move a clip occurrence (or a whole marquee-selected GROUP of them, across
    // however many tracks) to different section(s), as one batched write — see applyClipMoves'
    // doc comment for why this can't just be a scene-slot {path,value} /edit (shared-scene bleed).
    if (req.method === 'POST' && url.pathname === '/clip-move') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { moves?: unknown }
          if (!Array.isArray(b.moves)) {
            json(res, 400, { error: 'body must be {moves: {track: string, fromIndex: number, toIndex: number}[]}' })
            return
          }
          const moves: ClipMove[] = b.moves.map((raw, i) => {
            const m = raw as { track?: unknown; fromIndex?: unknown; toIndex?: unknown }
            if (typeof m.track !== 'string' || typeof m.fromIndex !== 'number' || typeof m.toIndex !== 'number') {
              throw new BeatEditError(`moves[${i}] must be {track: string, fromIndex: number, toIndex: number}`)
            }
            return { track: m.track, fromIndex: m.fromIndex, toIndex: m.toIndex }
          })
          const next = applyClipMoves(doc, moves)
          const written = writeIfChanged(next)
          revalidateSelection()
          json(res, 200, { written, doc })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // Phase 22 Stream AE: split-at-point for audio-region clips. Not expressible as a single
    // {path,value} /edit — it produces TWO clips (first trimmed in place, second newly minted) —
    // so it's an additive route wrapping core's splitAudioClip (the same function `beat
    // audio-split` / `beat_audio_split` call), same shape as /song above. Returns the resulting
    // clip ids so the GUI can select the new one without re-deriving the naming scheme.
    if (req.method === 'POST' && url.pathname === '/audio-split') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { track?: unknown; clip?: unknown; at?: unknown; newClipId?: unknown }
          if (typeof b.track !== 'string' || typeof b.clip !== 'string' || typeof b.at !== 'number') {
            json(res, 400, { error: 'body must be {track: string, clip: string, at: number, newClipId?: string}' })
            return
          }
          const { doc: next, first, second } = splitAudioClip(doc, b.track, b.clip, b.at, typeof b.newClipId === 'string' ? { newClipId: b.newClipId } : {})
          const written = writeIfChanged(next)
          revalidateSelection()
          json(res, 200, { written, firstId: first.id, secondId: second.id })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // Phase 23 Stream BA: the six Pitch & Time operations + Consolidate (src/core/pitchtime.ts),
    // reachable from the piano-roll's new operations panel. One op per call:
    //   { op:'transpose',  track, semitones, noteIds? }
    //   { op:'timeScale',  track, factor, noteIds? }
    //   { op:'fitToScale', track, root, scale, noteIds? }
    //   { op:'invert',     track, axis?, noteIds? }
    //   { op:'reverse',    track, noteIds? }
    //   { op:'legato',     track, gap?, noteIds? }
    //   { op:'consolidate', track, noteIds? }
    // Returns the full raw document (no SSE echo of the daemon's own writes), same as /add-track.
    if (req.method === 'POST' && url.pathname === '/pitch-time') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as {
            op?: unknown
            track?: unknown
            noteIds?: unknown
            semitones?: unknown
            factor?: unknown
            root?: unknown
            scale?: unknown
            axis?: unknown
            gap?: unknown
          }
          if (typeof b.track !== 'string') {
            json(res, 400, { error: 'body must include track: string' })
            return
          }
          const opts = Array.isArray(b.noteIds) ? { noteIds: (b.noteIds as unknown[]).map(String) } : {}
          let result: { doc: BeatDocument; changed: number }
          switch (b.op) {
            case 'transpose':
              if (typeof b.semitones !== 'number') throw new BeatPitchTimeError('transpose needs semitones: number')
              result = transposeNotes(doc, b.track, b.semitones, opts)
              break
            case 'timeScale':
              if (typeof b.factor !== 'number') throw new BeatPitchTimeError('timeScale needs factor: number')
              result = timeScaleNotes(doc, b.track, b.factor, opts)
              break
            case 'fitToScale':
              if (typeof b.root !== 'number' || typeof b.scale !== 'string') throw new BeatPitchTimeError('fitToScale needs root: number, scale: string')
              result = fitToScaleNotes(doc, b.track, b.root, b.scale, opts)
              break
            case 'invert':
              result = invertNotes(doc, b.track, typeof b.axis === 'number' ? b.axis : undefined, opts)
              break
            case 'reverse':
              result = reverseNotes(doc, b.track, opts)
              break
            case 'legato':
              result = legatoNotes(doc, b.track, { ...opts, ...(typeof b.gap === 'number' ? { gap: b.gap } : {}) })
              break
            case 'consolidate':
              result = consolidateRatchet(doc, b.track, opts)
              break
            default:
              json(res, 400, { error: `unknown op "${String(b.op)}" (expected transpose|timeScale|fitToScale|invert|reverse|legato|consolidate)` })
              return
          }
          const written = writeIfChanged(result.doc)
          revalidateSelection()
          json(res, 200, { written, changed: result.changed, doc })
        })
        .catch((err) => {
          const status = err instanceof BeatPitchTimeError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // Phase 26 Stream DG: copy/duplicate notes + clipboard (research 57 item #2 — "no primitive
    // exists in edit.ts AND no GUI affordance"). One route, reused by both NoteView.tsx flows:
    // Alt-drag-to-duplicate passes the drag's own uniform (offsetStart, offsetPitch) delta;
    // Cmd/Ctrl+V paste passes an offsetStart computed at paste time (playhead - copied selection's
    // own earliest start) and no offsetPitch. Mirrors /pitch-time's own shape (one op, whole track +
    // noteIds scoping) but gets its own route rather than folding into the pitch-time op union
    // since it needs to hand back the fresh copies' ids (so the GUI can select them), the same
    // reason /audio-split and /place-clip are their own routes instead of /edit.
    //   { track, noteIds?, offsetStart?, offsetPitch? } -> { written, addedIds, doc }
    if (req.method === 'POST' && url.pathname === '/duplicate-notes') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { track?: unknown; noteIds?: unknown; offsetStart?: unknown; offsetPitch?: unknown }
          if (typeof b.track !== 'string') {
            json(res, 400, { error: 'body must include track: string' })
            return
          }
          const opts = {
            ...(Array.isArray(b.noteIds) ? { noteIds: (b.noteIds as unknown[]).map(String) } : {}),
            ...(typeof b.offsetStart === 'number' ? { offsetStart: b.offsetStart } : {}),
            ...(typeof b.offsetPitch === 'number' ? { offsetPitch: b.offsetPitch } : {}),
          }
          const { doc: next, added } = duplicateNotes(doc, b.track, opts)
          const written = writeIfChanged(next)
          revalidateSelection()
          json(res, 200, { written, addedIds: added.map((n) => n.id), doc })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // v0.9 clip-automation edit channel (Phase 20 Stream Z, GUI automation lanes). The /edit
    // {path,value} grammar (core's setValue) cannot express a (track, clip, param, point) tuple, so
    // this additive route wraps the SAME core primitives `beat automate` / `beat_automate` use
    // (setAutomationPoint / removeAutomationPoint — src/core/edit.ts), one call per curve edit:
    //   { op:'set',    track, clip, param, time, value, id? }  -> add-or-move a breakpoint
    //   { op:'remove', track, clip, param, id }                -> delete one breakpoint (drops the
    //                                                             lane when it was the last point)
    // Writes through writeIfChanged like /edit, so a curve drag is a clean per-point line diff and
    // the directory watcher hot-reloads the GUI through the ordinary external-edit path.
    if (req.method === 'POST' && url.pathname === '/automate') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as {
            op?: unknown
            track?: unknown
            clip?: unknown
            param?: unknown
            time?: unknown
            value?: unknown
            id?: unknown
          }
          if (typeof b.track !== 'string' || typeof b.clip !== 'string' || typeof b.param !== 'string') {
            json(res, 400, { error: 'body must include string track, clip, param' })
            return
          }
          if (b.op === 'remove') {
            if (typeof b.id !== 'string') {
              json(res, 400, { error: "op 'remove' needs a string id" })
              return
            }
            const written = writeIfChanged(removeAutomationPoint(doc, b.track, b.clip, b.param, b.id).doc)
            json(res, 200, { written })
            return
          }
          if (b.op === 'set') {
            if (typeof b.time !== 'number' || typeof b.value !== 'number') {
              json(res, 400, { error: "op 'set' needs numeric time and value" })
              return
            }
            const point = { time: b.time, value: b.value, ...(typeof b.id === 'string' ? { id: b.id } : {}) }
            const out = setAutomationPoint(doc, b.track, b.clip, b.param, point)
            const written = writeIfChanged(out.doc)
            json(res, 200, { written, id: out.point.id, created: out.created })
            return
          }
          json(res, 400, { error: "op must be 'set' or 'remove'" })
        })
        .catch((err) => {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // dotbeat's own frontend track-structure channel (Phase 20 Stream W). Track ADD/REMOVE change the
    // whole tracks list, so they don't fit setValue's single `path=value` shape (which is why /edit
    // can't carry them) — they wrap core's addTrack/removeTrack, the exact functions `beat
    // add-track`/`beat rm-track` call. Additive and structurally identical to /edit: run the pure core
    // function, write-if-changed, revalidate the selection. Unlike /edit these RETURN the full raw
    // document (same shape GET /document serves) because the daemon never SSE-echoes its own writes —
    // the frontend applies the returned doc directly rather than re-pulling, so an add/remove reflects
    // instantly (rename/color already go through /edit's <track>.name/.color setValue paths).
    if (req.method === 'POST' && url.pathname === '/add-track') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { id?: unknown; kind?: unknown; name?: unknown; color?: unknown; soundfont?: { sample?: unknown; program?: unknown } }
          if (typeof b.id !== 'string' || typeof b.kind !== 'string') {
            json(res, 400, { error: 'body must be {id: string, kind: "synth"|"drums"|"instrument", name?, color?, soundfont?}' })
            return
          }
          const opts: Parameters<typeof addTrack>[1] = { id: b.id, kind: b.kind as TrackKind }
          if (typeof b.name === 'string') opts.name = b.name
          if (typeof b.color === 'string') opts.color = b.color
          if (b.soundfont && typeof b.soundfont.sample === 'string') {
            opts.soundfont = { sample: b.soundfont.sample, program: typeof b.soundfont.program === 'number' ? b.soundfont.program : 0 }
          }
          // Phase 22 Stream AB: a fresh drum track from the GUI's "add track" gets the 12-lane
          // GM-aligned default kit (research 19 Part VII), same as `beat add-track --kind drums`.
          if (b.kind === 'drums') opts.lanes = defaultDrumKitLanes()
          const { doc: next } = addTrack(doc, opts)
          const written = writeIfChanged(next)
          revalidateSelection()
          json(res, 200, { written, doc })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    if (req.method === 'POST' && url.pathname === '/remove-track') {
      readBody(req)
        .then((body) => {
          const { id } = JSON.parse(body) as { id?: unknown }
          if (typeof id !== 'string') {
            json(res, 400, { error: 'body must be {id: string}' })
            return
          }
          const { doc: next } = removeTrack(doc, id)
          const written = writeIfChanged(next)
          revalidateSelection()
          json(res, 200, { written, doc })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    if (req.method === 'POST' && url.pathname === '/effect-add') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { track?: unknown; type?: unknown; id?: unknown; index?: unknown; bypassed?: unknown }
          if (typeof b.track !== 'string' || typeof b.type !== 'string') {
            json(res, 400, { error: 'body must include string track and type (eq3|comp|distortion|bitcrush|eq7|autoFilter|autoPan|tremolo|utility|grainDelay|vinylDistortion|resonator)' })
            return
          }
          const opts: Parameters<typeof addEffect>[3] = {}
          if (typeof b.id === 'string') opts.id = b.id
          if (typeof b.index === 'number') opts.index = b.index
          if (typeof b.bypassed === 'boolean') opts.enabled = !b.bypassed
          const { doc: next } = addEffect(doc, b.track, b.type as EffectType, opts)
          const written = writeIfChanged(next)
          json(res, 200, { written, doc })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    if (req.method === 'POST' && url.pathname === '/effect-remove') {
      readBody(req)
        .then((body) => {
          const { track, id } = JSON.parse(body) as { track?: unknown; id?: unknown }
          if (typeof track !== 'string' || typeof id !== 'string') {
            json(res, 400, { error: 'body must be {track: string, id: string}' })
            return
          }
          const { doc: next } = removeEffect(doc, track, id)
          const written = writeIfChanged(next)
          json(res, 200, { written, doc })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    if (req.method === 'POST' && url.pathname === '/effect-move') {
      readBody(req)
        .then((body) => {
          const { track, id, index } = JSON.parse(body) as { track?: unknown; id?: unknown; index?: unknown }
          if (typeof track !== 'string' || typeof id !== 'string' || typeof index !== 'number') {
            json(res, 400, { error: 'body must be {track: string, id: string, index: number}' })
            return
          }
          const { doc: next } = moveEffect(doc, track, id, index)
          const written = writeIfChanged(next)
          json(res, 200, { written, doc })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    if (req.method === 'POST' && url.pathname === '/effect-enabled') {
      readBody(req)
        .then((body) => {
          const { track, id, enabled } = JSON.parse(body) as { track?: unknown; id?: unknown; enabled?: unknown }
          if (typeof track !== 'string' || typeof id !== 'string' || typeof enabled !== 'boolean') {
            json(res, 400, { error: 'body must be {track: string, id: string, enabled: boolean}' })
            return
          }
          const { doc: next } = setEffectEnabled(doc, track, id, enabled)
          const written = writeIfChanged(next)
          json(res, 200, { written, doc })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    if (req.method === 'POST' && url.pathname === '/group') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { op?: unknown; id?: unknown; name?: unknown; color?: unknown; trackIds?: unknown }
          const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
          let next: BeatDocument
          if (b.op === 'create') {
            if (!isStringArray(b.trackIds)) {
              json(res, 400, { error: "op 'create' needs a string[] trackIds" })
              return
            }
            const opts: Parameters<typeof addGroup>[1] = { trackIds: b.trackIds }
            if (typeof b.id === 'string') opts.id = b.id
            if (typeof b.name === 'string') opts.name = b.name
            if (typeof b.color === 'string') opts.color = b.color
            next = addGroup(doc, opts).doc
          } else if (b.op === 'delete') {
            if (typeof b.id !== 'string') {
              json(res, 400, { error: "op 'delete' needs a string id" })
              return
            }
            next = removeGroup(doc, b.id).doc
          } else if (b.op === 'rename') {
            if (typeof b.id !== 'string' || typeof b.name !== 'string') {
              json(res, 400, { error: "op 'rename' needs a string id and name" })
              return
            }
            next = renameGroup(doc, b.id, b.name)
          } else if (b.op === 'recolor') {
            if (typeof b.id !== 'string' || typeof b.color !== 'string') {
              json(res, 400, { error: "op 'recolor' needs a string id and color" })
              return
            }
            next = setGroupColor(doc, b.id, b.color)
          } else if (b.op === 'set-tracks') {
            if (typeof b.id !== 'string' || !isStringArray(b.trackIds)) {
              json(res, 400, { error: "op 'set-tracks' needs a string id and string[] trackIds" })
              return
            }
            next = setGroupTracks(doc, b.id, b.trackIds)
          } else {
            json(res, 400, { error: `unknown group op "${String(b.op)}" (expected create|delete|rename|recolor|set-tracks)` })
            return
          }
          const written = writeIfChanged(next)
          revalidateSelection()
          json(res, 200, { written, doc })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // New-project-from-scratch, GUI-reachable (Phase 22 Stream AF). `beat init` has always been able
    // to do this from the CLI (cli/beat.mjs's initCmd, wrapping core's initDocument); this is the
    // same wrap over HTTP so the GUI can reach it too — same "add a route, call the real core
    // function" pattern /add-track and /remove-track follow. Deliberately usable from ANY running
    // daemon, not just via the Tauri folder-repoint dance (docs/phase-20-track-project-management.md's
    // "open folder…" boundary): this is a pure filesystem write to an arbitrary target path, unrelated
    // to the calling daemon's OWN file, so it works — and is verifiable live — in a plain browser too
    // (see ui/verify-phase22-af.mjs). `from` (an existing .beat file's path) makes this double as "new
    // project FROM A TEMPLATE" (Stream AF's third feature) instead of a blank `initDocument()` start —
    // the exact reuse the phase plan calls for. Refuses to overwrite an existing file at the resolved
    // target, matching `beat init`'s own "already exists — refusing to overwrite" stance.
    if (req.method === 'POST' && url.pathname === '/new-project') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { path?: unknown; name?: unknown; bpm?: unknown; loopBars?: unknown; from?: unknown }
          if (typeof b.path !== 'string' || b.path.trim() === '') {
            json(res, 400, { error: 'body must include a non-empty string path (a folder, or a path ending in .beat)' })
            return
          }
          const defaultName = typeof b.name === 'string' && b.name.trim() !== '' ? `${b.name.trim()}.beat` : 'project.beat'
          const pathAbs = resolve(b.path)
          const targetAbs = pathAbs.endsWith('.beat') ? pathAbs : join(pathAbs, defaultName)
          if (existsSync(targetAbs)) {
            json(res, 400, { error: `${targetAbs} already exists — refusing to overwrite` })
            return
          }
          if (b.from !== undefined) {
            if (typeof b.from !== 'string' || b.from.trim() === '') {
              json(res, 400, { error: 'from must be a non-empty string path to an existing .beat template' })
              return
            }
            const fromAbs = resolve(b.from)
            if (!existsSync(fromAbs) || !statSync(fromAbs).isFile()) {
              json(res, 400, { error: `template "${b.from}" does not exist or is not a file` })
              return
            }
            // Fail loudly on a corrupt/foreign template rather than silently duplicating garbage —
            // the same "the file states everything, and it must be TRUE" discipline the parser itself
            // enforces on every read.
            try {
              parse(readFileSync(fromAbs, 'utf8'))
            } catch (err) {
              json(res, 400, { error: `template "${b.from}" is not a valid .beat file: ${err instanceof Error ? err.message : String(err)}` })
              return
            }
            mkdirSync(dirname(targetAbs), { recursive: true })
            copyFileSync(fromAbs, targetAbs)
            json(res, 200, { filePath: targetAbs, created: true, fromTemplate: fromAbs })
            return
          }
          const init: Parameters<typeof initDocument>[0] = {}
          if (typeof b.bpm === 'number') init.bpm = b.bpm
          if (typeof b.loopBars === 'number') init.loopBars = b.loopBars
          mkdirSync(dirname(targetAbs), { recursive: true })
          writeFileSync(targetAbs, serialize(initDocument(init)))
          json(res, 200, { filePath: targetAbs, created: true })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof BeatParseError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // Save project as template (Phase 22 Stream AF): duplicate THIS project's CURRENT on-disk bytes
    // to a new path — a literal file copy (docs/research/24-opendaw-roadmap-positioning.md's "copy
    // this project's file/folder as a new project"), not a re-serialize, so a template is exactly what
    // was on disk at save time, comments and all. Copies the file the daemon itself owns (`filePath`,
    // closed over from startDaemon's argument), so the client doesn't need to know it. Opening a
    // template is just POST /new-project with `from` set to the saved template's path (above) — it
    // reads the template file, never writes it, so the original is untouched by construction.
    if (req.method === 'POST' && url.pathname === '/save-as-template') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { path?: unknown; name?: unknown }
          if (typeof b.path !== 'string' || b.path.trim() === '') {
            json(res, 400, { error: 'body must include a non-empty string path (a folder, or a path ending in .beat)' })
            return
          }
          const defaultName = typeof b.name === 'string' && b.name.trim() !== '' ? `${b.name.trim()}.beat` : 'template.beat'
          const pathAbs = resolve(b.path)
          const targetAbs = pathAbs.endsWith('.beat') ? pathAbs : join(pathAbs, defaultName)
          if (existsSync(targetAbs)) {
            json(res, 400, { error: `${targetAbs} already exists — refusing to overwrite` })
            return
          }
          mkdirSync(dirname(targetAbs), { recursive: true })
          copyFileSync(filePath, targetAbs)
          json(res, 200, { filePath: targetAbs, source: filePath })
        })
        .catch((err) => {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // D3 versioning: the checkpoint list for this file, newest first, each with its semantic
    // one-liner label and (if pinned) its pin name — the same data `beat history` prints. Read-only;
    // reuses history() wholesale. `?limit=N` caps the list (the panel asks for a bounded window).
    // `?collapsed=true` (Phase 16 Stream J, additive) switches to collapsedHistory() — the same
    // "fold unnamed runs between pins" view `beat history --collapsed` / `beat_history{collapsed:true}`
    // already expose — returning `{ rows }` (HistoryRow[]: checkpoint rows plus `{kind:'collapsed',
    // count}` summary rows) instead of `{ entries }`, so the history panel can offer a skimmable view
    // on a long timeline per product-spec-desktop.md §4.
    if (req.method === 'GET' && url.pathname === '/history') {
      try {
        const limitParam = url.searchParams.get('limit')
        const limit = limitParam !== null ? Number(limitParam) : undefined
        if (limit !== undefined && (!Number.isFinite(limit) || limit < 0)) {
          json(res, 400, { error: `bad ?limit=${limitParam}` })
          return
        }
        const opts = limit !== undefined ? { limit } : {}
        if (url.searchParams.get('collapsed') === 'true') {
          json(res, 200, { rows: collapsedHistory(filePath, opts) })
        } else {
          json(res, 200, { entries: history(filePath, opts) })
        }
      } catch (err) {
        json(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // D3 "go back": restore an earlier checkpoint by its ref. Append-only (src/history/restore) —
    // it writes the old bytes and takes a FRESH checkpoint, never rewinding the timeline, so the
    // pre-restore state stays recoverable. The write lands on disk; our directory watcher then
    // broadcasts `doc` and the GUI hot-reloads. Returns the new checkpoint (or {skipped:true} when
    // that version was already current). An unknown/invalid ref is a HistoryError → 400.
    if (req.method === 'POST' && url.pathname === '/restore') {
      readBody(req)
        .then((body) => {
          const { ref } = JSON.parse(body) as { ref?: unknown }
          if (typeof ref !== 'string' || ref.trim() === '') {
            json(res, 400, { error: 'body must be {ref: string}' })
            return
          }
          json(res, 200, restore(filePath, ref))
        })
        .catch((err) => {
          const status = err instanceof HistoryError ? 400 : err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // D10 "pin": name a checkpoint (<=25 chars) — a plain annotated git tag in the same repo. Nice-
    // to-have alongside restore; reuses pin() unchanged. Bad name / unknown ref / duplicate name all
    // surface as HistoryError → 400.
    if (req.method === 'POST' && url.pathname === '/pin') {
      readBody(req)
        .then((body) => {
          const { ref, name } = JSON.parse(body) as { ref?: unknown; name?: unknown }
          if (typeof ref !== 'string' || typeof name !== 'string') {
            json(res, 400, { error: 'body must be {ref: string, name: string}' })
            return
          }
          json(res, 200, pin(filePath, ref, name))
        })
        .catch((err) => {
          const status = err instanceof HistoryError ? 400 : err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // D10 "unpin": remove a pin by name. Reuses unpin() unchanged.
    if (req.method === 'POST' && url.pathname === '/unpin') {
      readBody(req)
        .then((body) => {
          const { name } = JSON.parse(body) as { name?: unknown }
          if (typeof name !== 'string') {
            json(res, 400, { error: 'body must be {name: string}' })
            return
          }
          unpin(filePath, name)
          json(res, 200, { ok: true })
        })
        .catch((err) => {
          const status = err instanceof HistoryError ? 400 : err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // POST /vary: generate a rung-1 param-variation batch scoped by the live selection. Read-only —
    // returns each variant as its `beat set`-shaped edits (+ a human label); the GUI auditions by
    // applying edits in-memory and commits a kept variant back through POST /edit. Never writes here.
    if (req.method === 'POST' && url.pathname === '/vary') {
      readBody(req)
        .then((body) => {
          const b = (body.trim() ? JSON.parse(body) : {}) as VaryRequestBody
          const { track, group } = resolveVaryTarget(selection, doc, b)
          const count = b.count ?? 9
          const amount = b.amount ?? 0.25
          const seed = b.seed ?? (Date.now() % 2147483647 || 1)
          const variants = varyTrack(doc, track, group, { count, amount, seed })
          json(res, 200, {
            track,
            group,
            count: variants.length,
            amount,
            seed,
            // Each variant is a small diff in the file's own vocabulary; `label` drops the redundant
            // `<track>.` prefix so the GUI can show "hatTone 8123, hatDecay 0.05" tersely.
            variants: variants.map((v, i) => ({
              index: i,
              edits: v.edits,
              label: v.edits.map((e) => `${e.path.slice(e.path.indexOf('.') + 1)} ${e.value}`).join(', '),
            })),
          })
        })
        .catch((err) => {
          const status = err instanceof BeatVaryError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // POST /vary-feel: generate a rung-2 humanized-FEEL batch scoped by the live selection — the
    // content-variation analog of /vary (Phase 23 Stream BB). Unlike /vary's small {path,value}
    // edit lists, `varyFeel` rewrites many note/hit timing/velocity fields per variant, so each
    // variant is returned as a FULL raw document (reused verbatim for setDoc during audition) plus
    // the reproducible `seed` that generated it — POST /vary-feel/commit resends that same seed to
    // write it for real. Read-only; never writes.
    if (req.method === 'POST' && url.pathname === '/vary-feel') {
      readBody(req)
        .then((body) => {
          const b = (body.trim() ? JSON.parse(body) : {}) as VaryRequestBody & { lanes?: string[] }
          // Reuses resolveVaryTarget purely for its track resolution + selection-scope enforcement
          // (spec §2) — the `group` it also returns is param-vary-specific and unused here.
          const { track } = resolveVaryTarget(selection, doc, b)
          const count = b.count ?? 9
          const seed = b.seed ?? (Date.now() % 2147483647 || 1)
          const lanes = Array.isArray(b.lanes) && b.lanes.every((l) => typeof l === 'string') ? b.lanes : undefined
          const variants = varyFeel(doc, track, { count, seed, ...(lanes ? { lanes } : {}) })
          json(res, 200, {
            track,
            count: variants.length,
            seed,
            variants: variants.map((v, i) => ({ index: i, seed: seed + i, recipe: v.recipe, doc: v.doc })),
          })
        })
        .catch((err) => {
          const status = err instanceof BeatVaryError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // POST /vary-feel/commit {track, seed, lanes?}: writes ONE feel variant for real — the "Keep"
    // half of the audition/keep loop. Deterministic per (track, seed, lanes) — resending the exact
    // seed a /vary-feel variant carried regenerates byte-identical content, so committing needs no
    // edit-list replay (there isn't one; see /vary-feel's doc comment), just re-run + write.
    if (req.method === 'POST' && url.pathname === '/vary-feel/commit') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { track?: unknown; seed?: unknown; lanes?: unknown }
          if (typeof b.track !== 'string' || typeof b.seed !== 'number') {
            json(res, 400, { error: 'body must be {track: string, seed: number, lanes?: string[]}' })
            return
          }
          const lanes = Array.isArray(b.lanes) && b.lanes.every((l) => typeof l === 'string') ? (b.lanes as string[]) : undefined
          const track = doc.tracks.find((t) => t.id === b.track)
          if (!track) throw new BeatVaryError(`no track "${b.track}" (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
          const ids =
            lanes && lanes.length
              ? (() => {
                  if (track.kind !== 'drums') throw new BeatVaryError(`lanes only applies to drum tracks; "${b.track}" is a ${track.kind} track`)
                  const set = new Set(lanes)
                  return track.hits.filter((h) => set.has(h.lane)).map((h) => h.id)
                })()
              : undefined
          const { doc: next } = humanize(doc, b.track, { timing: 0.15, velocity: 0.06, pushLate: 0, swing: 0, seed: b.seed, ...(ids ? { ids } : {}) })
          const written = writeIfChanged(next)
          revalidateSelection()
          json(res, 200, { written, doc })
        })
        .catch((err) => {
          const status = err instanceof BeatVaryError || err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // ─── Phase 23 Stream BB: drum-lane structural editing ───────────────────────────────────────────
    // One route, six ops — same "whole-statement op" shape as /group (a lane list's shape/order
    // isn't a single scalar, so it doesn't fit /edit's {path,value} grammar). Wraps core's
    // materializeLanes/addLane/removeLane/moveLane/setLaneBacking/setLaneParam verbatim; RETURNS the
    // fresh document (the daemon never SSE-echoes its own writes — same convention /effect-* and
    // /group already use).
    if (req.method === 'POST' && url.pathname === '/lane') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { op?: unknown; track?: unknown; name?: unknown; backing?: unknown; index?: unknown; key?: unknown; value?: unknown }
          if (typeof b.track !== 'string') {
            json(res, 400, { error: 'body must include a string track' })
            return
          }
          let next: BeatDocument
          if (b.op === 'materialize') {
            next = materializeLanes(doc, b.track).doc
          } else if (b.op === 'add') {
            if (typeof b.name !== 'string' || typeof b.backing !== 'string') {
              json(res, 400, { error: "op 'add' needs {name: string, backing: string}" })
              return
            }
            const opts: Parameters<typeof addLane>[4] = {}
            if (typeof b.index === 'number') opts.index = b.index
            next = addLane(doc, b.track, b.name, b.backing.trim().split(/\s+/), opts).doc
          } else if (b.op === 'remove') {
            if (typeof b.name !== 'string') {
              json(res, 400, { error: "op 'remove' needs {name: string}" })
              return
            }
            next = removeLane(doc, b.track, b.name).doc
          } else if (b.op === 'move') {
            if (typeof b.name !== 'string' || typeof b.index !== 'number') {
              json(res, 400, { error: "op 'move' needs {name: string, index: number}" })
              return
            }
            next = moveLane(doc, b.track, b.name, b.index).doc
          } else if (b.op === 'backing') {
            if (typeof b.name !== 'string' || typeof b.backing !== 'string') {
              json(res, 400, { error: "op 'backing' needs {name: string, backing: string}" })
              return
            }
            next = setLaneBacking(doc, b.track, b.name, b.backing.trim().split(/\s+/)).doc
          } else if (b.op === 'param') {
            if (typeof b.name !== 'string' || typeof b.key !== 'string') {
              json(res, 400, { error: "op 'param' needs {name: string, key: string, value?: number}" })
              return
            }
            const value = b.value === '' || b.value === undefined || b.value === null ? undefined : Number(b.value)
            if (value !== undefined && !Number.isFinite(value)) {
              json(res, 400, { error: `op 'param' value must be a finite number or empty, got ${JSON.stringify(b.value)}` })
              return
            }
            next = setLaneParam(doc, b.track, b.name, b.key, value).doc
          } else {
            json(res, 400, { error: `unknown op "${String(b.op)}" (expected materialize|add|remove|move|backing|param)` })
            return
          }
          const written = writeIfChanged(next)
          revalidateSelection()
          json(res, 200, { written, doc })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // ─── Phase 22 Stream AH: content-browser library routes ───────────────────────────────────────
    // GET /library — the whole catalog in one call (small: 36 presets, 2 kits, 3 banks today):
    // presets (with an optional ?category= filter, the same taxonomy `beat presets --category`
    // filters on), the enumerated category list, kit lane manifests, and soundfont banks. Read-only,
    // no document dependency — this is repo content, not project content.
    if (req.method === 'GET' && url.pathname === '/library') {
      try {
        let presets = loadFactoryPresets()
        const category = url.searchParams.get('category')
        if (category) presets = filterPresetsByCategory(presets, category)
        json(res, 200, { presets, categories: PRESET_CATEGORIES, kits: listKits(), soundfonts: listSoundfonts() })
      } catch (err) {
        const status = err instanceof BeatPresetError ? 400 : 500
        json(res, status, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // GET /library/file?path=<relative> — raw bytes of one library file (a kit one-shot or a
    // soundfont bank), for the browser to fetch-and-decode as a preview — the same "fetch the real
    // bytes, play them locally, never write anything" idiom scripts/freesound-cc0.mjs's preview tier
    // uses for Freesound candidates, applied to dotbeat's own already-bundled content. Path-traversal
    // safe (resolveLibraryPath refuses anything outside presetsRoot), mirroring GET /media/<path>'s
    // declared-paths discipline for the project's own media.
    if (req.method === 'GET' && url.pathname === '/library/file') {
      const rel = url.searchParams.get('path')
      if (!rel) {
        json(res, 400, { error: 'missing ?path=' })
        return
      }
      const abs = resolveLibraryPath(rel)
      if (!abs) {
        json(res, 400, { error: `path "${rel}" escapes the content library` })
        return
      }
      if (!existsSync(abs)) {
        json(res, 404, { error: `no library file at "${rel}"` })
        return
      }
      try {
        const bytes = readFileSync(abs)
        const ct = abs.endsWith('.wav') ? 'audio/wav' : 'application/octet-stream'
        res.writeHead(200, { 'content-type': ct, 'content-length': bytes.length, ...CORS_HEADERS })
        res.end(bytes)
      } catch {
        json(res, 404, { error: `library file unreadable: ${rel}` })
      }
      return
    }

    // POST /library/apply-preset {track, name} — the drag-a-preset-onto-a-track interaction. Wraps
    // core's applyPreset (the exact function `beat preset <file> <track> <name>` calls): a literal
    // param bag applied through setValue, so the result is a normal edit list, never a reference.
    // RETURNS the fresh document (same convention as /add-track) since the daemon never SSE-echoes
    // its own writes.
    if (req.method === 'POST' && url.pathname === '/library/apply-preset') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { track?: unknown; name?: unknown }
          if (typeof b.track !== 'string' || typeof b.name !== 'string') {
            json(res, 400, { error: 'body must be {track: string, name: string}' })
            return
          }
          const presets = loadFactoryPresets()
          const preset = presets.find((p) => p.name === b.name)
          if (!preset) {
            json(res, 404, { error: `no preset "${b.name}" (see GET /library)` })
            return
          }
          const written = writeIfChanged(applyPreset(doc, b.track, preset))
          revalidateSelection()
          json(res, 200, { written, doc })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof BeatPresetError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // POST /library/install-kit {track, kit, lane?, targetLane?} — the drag-a-sample-onto-a-drum-
    // lane interaction (lane+targetLane given: one one-shot onto one lane, which may differ from its
    // own — e.g. drop kit-audiophob's clap onto the snare lane) and the drag-a-kit-onto-a-track
    // interaction (lane omitted: every lane the kit has). Copies each wav into THIS project's own
    // media/ (content-addressed, never referenced by presets/ path — the file must stand alone),
    // registers it via setMediaSample, and assigns it via setLaneSample — the same two primitives
    // `beat sample` + `beat lane` chain together by hand. One atomic write for the whole drop.
    if (req.method === 'POST' && url.pathname === '/library/install-kit') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { track?: unknown; kit?: unknown; lane?: unknown; targetLane?: unknown }
          if (typeof b.track !== 'string' || typeof b.kit !== 'string') {
            json(res, 400, { error: 'body must be {track: string, kit: string, lane?: string, targetLane?: string}' })
            return
          }
          const kit = listKits().find((k) => k.id === b.kit)
          if (!kit) {
            json(res, 404, { error: `no kit "${b.kit}" (see GET /library)` })
            return
          }
          let wanted = kit.lanes
          if (typeof b.lane === 'string') {
            const found = kit.lanes.find((l) => l.lane === b.lane)
            if (!found) {
              json(res, 404, { error: `kit "${b.kit}" has no "${b.lane}" lane (have: ${kit.lanes.map((l) => l.lane).join(', ')})` })
              return
            }
            wanted = [found]
          }
          if (typeof b.targetLane === 'string' && wanted.length !== 1) {
            json(res, 400, { error: 'targetLane only applies when dropping a single lane (pass lane too)' })
            return
          }
          const mediaDir = resolve(dirname(filePath), 'media')
          mkdirSync(mediaDir, { recursive: true })
          let next = doc
          for (const { lane, file } of wanted) {
            const destLane = (typeof b.targetLane === 'string' ? b.targetLane : lane) as DrumLane
            const destName = `${kit.id}-${lane}.wav`
            const destAbs = resolve(mediaDir, destName)
            copyFileSync(resolve(presetsRoot, kit.id, file), destAbs)
            const sha256 = createHash('sha256').update(readFileSync(destAbs)).digest('hex')
            const id = `${kit.id}-${lane}`
            next = setMediaSample(next, id, sha256, `media/${destName}`)
            next = setLaneSample(next, b.track as string, destLane, { sample: id, gainDb: 0, tune: 0 })
          }
          const written = writeIfChanged(next)
          revalidateSelection()
          json(res, 200, { written, doc })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // POST /library/install-audio-clip {track, kit, lane, clipId?, sceneId?} — the drag-a-kit-one-
    // shot-onto-an-audio-track interaction (Phase 23 Stream BC): the clip-CREATION half of the
    // audio-region clip GUI gap docs/phase-22-stream-ae.md left open (that stream shipped trim/gain/
    // warp/split editing for an ALREADY-existing clip; nothing in the GUI could create one). Reuses
    // the exact same content-browser drag payload Stream AH already established for kit one-shots
    // (`{type:'kit-lane', kit, lane}` — ui/src/daemon/library.ts) rather than inventing a new drag
    // protocol, and the same copy-into-project-media/register/content-address discipline
    // install-kit uses just above — the two new pieces are reading the wav's own duration
    // (decodeWav, imported above) to size the region's initial out-point to the file's real length,
    // and creating/replacing the clip via core's addAudioClip.
    //   - `clipId` given: REPLACE that existing clip's region in place (it's already slotted
    //     somewhere — dropping a new sample onto a clip being edited swaps its content, the same
    //     mental model a preset drop re-applying params in place already uses). No scene write.
    //   - `clipId` omitted: MINT a new clip id on the track (nextFreeClipId); if `sceneId` is also
    //     given, slot it into that scene — merged into the scene's EXISTING slots (never clobbers
    //     other tracks' slots in the same scene) — so the new clip is immediately visible/playable.
    //     `sceneId` omitted (e.g. loop-mode, no song block at all) still creates the clip on the
    //     track, just not reachable from any section yet — song-mode-only playback for audio
    //     regions is Stream AE's own documented design (see its "why clip-only" section), not a new
    //     limitation this route introduces.
    if (req.method === 'POST' && url.pathname === '/library/install-audio-clip') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { track?: unknown; kit?: unknown; lane?: unknown; clipId?: unknown; sceneId?: unknown }
          if (typeof b.track !== 'string' || typeof b.kit !== 'string' || typeof b.lane !== 'string') {
            json(res, 400, { error: 'body must be {track: string, kit: string, lane: string, clipId?: string, sceneId?: string}' })
            return
          }
          const track = doc.tracks.find((t) => t.id === b.track)
          if (!track) {
            json(res, 404, { error: `no track "${b.track}"` })
            return
          }
          if (track.kind !== 'audio') {
            json(res, 400, { error: `track "${b.track}" is a ${track.kind} track — audio clips only go on an "audio" track` })
            return
          }
          const kit = listKits().find((k) => k.id === b.kit)
          if (!kit) {
            json(res, 404, { error: `no kit "${b.kit}" (see GET /library)` })
            return
          }
          const laneFile = kit.lanes.find((l) => l.lane === b.lane)
          if (!laneFile) {
            json(res, 404, { error: `kit "${b.kit}" has no "${b.lane}" lane (have: ${kit.lanes.map((l) => l.lane).join(', ')})` })
            return
          }
          const mediaDir = resolve(dirname(filePath), 'media')
          mkdirSync(mediaDir, { recursive: true })
          const destName = `${kit.id}-${laneFile.lane}.wav`
          const destAbs = resolve(mediaDir, destName)
          copyFileSync(resolve(presetsRoot, kit.id, laneFile.file), destAbs)
          const bytes = readFileSync(destAbs)
          const sha256 = createHash('sha256').update(bytes).digest('hex')
          const mediaId = `${kit.id}-${laneFile.lane}`
          let next = setMediaSample(doc, mediaId, sha256, `media/${destName}`)
          let durationSec: number
          try {
            durationSec = decodeWav(bytes).durationSeconds
          } catch (err) {
            json(res, 400, { error: `could not read "${destName}"'s duration: ${err instanceof Error ? err.message : String(err)}` })
            return
          }
          const clipId = typeof b.clipId === 'string' && b.clipId ? b.clipId : nextFreeClipId(track)
          const { doc: withClip } = addAudioClip(next, track.id, clipId, { media: mediaId, in: 0, out: Math.max(0.02, durationSec) })
          next = withClip
          if (typeof b.sceneId === 'string' && b.sceneId) {
            const scene = next.scenes.find((s) => s.id === b.sceneId)
            next = setScene(next, b.sceneId, { ...(scene?.slots ?? {}), [track.id]: clipId })
          }
          const written = writeIfChanged(next)
          revalidateSelection()
          json(res, 200, { written, doc, clipId })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // POST /place-clip {track, clipId?, sceneId?} — Phase 24 Stream CI: "place a clip into the
    // arrangement for the first time" for synth/drums/instrument tracks (the note/hit editor,
    // NoteView.tsx), generalizing Phase 23 Stream BC's install-audio-clip route just above onto
    // dotbeat's OTHER track kinds. Those tracks have no external "file" to drag in — NoteView edits a
    // track's LIVE content (track.notes/track.hits) directly, and that live content only becomes
    // audible in song mode once it's snapshotted into a BeatClip (core's saveClip) and slotted into a
    // scene (core's setScene) — see src/daemon/daemon.ts's own sceneFromLiveContent for the same
    // snapshot step run automatically for every track the first time a project enters song mode. This
    // route is the GUI's on-demand version of that same step for a track added (or newly authored)
    // AFTER song mode already exists, which sceneFromLiveContent never retroactively covers.
    //   - `clipId` given: REPLACE that existing clip's snapshot in place (re-saves the track's
    //     CURRENT live notes/hits over it) — BC's "reuse an existing occurrence if the track already
    //     has one" precedent, generalized: re-snapshotting a clip that's already placed elsewhere just
    //     updates what plays there, it doesn't move or duplicate it. No scene write in this branch
    //     unless `sceneId` is ALSO given (e.g. the existing occurrence is in a different scene).
    //   - `clipId` omitted: MINT a new clip id on the track (nextFreeClipId) from the live content.
    //   - `sceneId` given: slot the (new-or-reused) clip into that scene, merged into the scene's
    //     EXISTING slots (never clobbers another track's slot in the same scene) — same merge-not-
    //     replace pattern install-audio-clip uses. `sceneId` omitted just snapshots the clip without
    //     slotting it anywhere (not reachable from any section yet, same "created but not yet placed"
    //     state install-audio-clip documents for loop mode).
    // Refusal precedent (loop mode, no song block, no scene to slot into) is enforced CLIENT-SIDE,
    // same as BC's own audio-clip drop handler — this route itself only requires a real target track
    // and (if slotting) a real target scene; it doesn't independently know about "loop mode."
    if (req.method === 'POST' && url.pathname === '/place-clip') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { track?: unknown; clipId?: unknown; sceneId?: unknown }
          if (typeof b.track !== 'string') {
            json(res, 400, { error: 'body must be {track: string, clipId?: string, sceneId?: string}' })
            return
          }
          const track = doc.tracks.find((t) => t.id === b.track)
          if (!track) {
            json(res, 404, { error: `no track "${b.track}"` })
            return
          }
          if (track.kind === 'audio') {
            json(res, 400, {
              error: `track "${b.track}" is an audio track — drag a sample from the content browser (POST /library/install-audio-clip), not /place-clip`,
            })
            return
          }
          const clipId = typeof b.clipId === 'string' && b.clipId ? b.clipId : nextFreeClipId(track)
          const { doc: withClip } = saveClip(doc, track.id, clipId)
          let next = withClip
          if (typeof b.sceneId === 'string' && b.sceneId) {
            const scene = next.scenes.find((s) => s.id === b.sceneId)
            next = setScene(next, b.sceneId, { ...(scene?.slots ?? {}), [track.id]: clipId })
          }
          const written = writeIfChanged(next)
          revalidateSelection()
          json(res, 200, { written, doc, clipId })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    // POST /library/install-soundfont {file, track?, program?, newTrackId?} — drag a bank from the
    // Samples/SoundFonts section onto an existing instrument track (reassigns its bank via the
    // already-existing `<track>.soundfont`/`<track>.program` setValue paths) or, with `track`
    // omitted, mints a brand new instrument track carrying it. That second form closes a real,
    // documented gap: ArrangementView.tsx's addTrackOfKind (Phase 20 Stream W) can only reuse an
    // ALREADY-registered media sample for a new instrument track and says so ("the GUI has no
    // sample-registration surface... register one with `beat sample` first") — this route IS that
    // surface, for the bundled banks at least.
    if (req.method === 'POST' && url.pathname === '/library/install-soundfont') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { file?: unknown; track?: unknown; program?: unknown; newTrackId?: unknown }
          if (typeof b.file !== 'string') {
            json(res, 400, { error: 'body must include string file' })
            return
          }
          if (!listSoundfonts().some((s) => s.file === b.file)) {
            json(res, 404, { error: `no soundfont "${b.file}" (see GET /library)` })
            return
          }
          const mediaDir = resolve(dirname(filePath), 'media')
          mkdirSync(mediaDir, { recursive: true })
          const destAbs = resolve(mediaDir, b.file)
          copyFileSync(resolve(presetsRoot, 'sf2', b.file), destAbs)
          const sha256 = createHash('sha256').update(readFileSync(destAbs)).digest('hex')
          const id = b.file.replace(/\.sf2$/, '').replace(/[^a-zA-Z0-9_-]/g, '-')
          let next = setMediaSample(doc, id, sha256, `media/${b.file}`)
          const program = typeof b.program === 'number' && Number.isInteger(b.program) && b.program >= 0 && b.program <= 127 ? b.program : 0
          if (typeof b.track === 'string') {
            next = setValue(next, `${b.track}.soundfont`, id)
            next = setValue(next, `${b.track}.program`, String(program))
          } else {
            const ids = new Set(next.tracks.map((t) => t.id))
            let newId = typeof b.newTrackId === 'string' && b.newTrackId ? b.newTrackId : 'instrument'
            for (let i = 2; ids.has(newId); i++) newId = `instrument${i}`
            next = addTrack(next, { id: newId, kind: 'instrument', soundfont: { sample: id, program } }).doc
          }
          const written = writeIfChanged(next)
          revalidateSelection()
          json(res, 200, { written, doc })
        })
        .catch((err) => {
          const status = err instanceof BeatEditError || err instanceof SyntaxError ? 400 : 500
          json(res, status, { error: err instanceof Error ? err.message : String(err) })
        })
      return
    }

    json(res, 404, { error: `no such endpoint: ${req.method} ${url.pathname}` })
  })

  await new Promise<void>((resolveListen, reject) => {
    server.on('error', reject)
    server.listen(requestedPort, '127.0.0.1', () => resolveListen())
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : requestedPort
  return {
    port,
    filePath,
    getDoc: () => doc,
    getSelection: () => selection,
    close: () =>
      new Promise<void>((done) => {
        if (watchTimer) clearTimeout(watchTimer)
        watcher.close()
        for (const client of sseClients) client.end()
        sseClients.clear()
        server.close(() => done())
      }),
  }
}
