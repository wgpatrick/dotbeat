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
import { readFileSync, writeFileSync, watch, existsSync, type FSWatcher } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'
import type { BeatDocument, BeatSelection } from '../core/index.js'
import { parse, serialize, sandboxPayloadToBeatDocument, beatDocumentToPartialTracks, setValue, setAutomationPoint, removeAutomationPoint, validateSelection, saveClip, setScene, setSong, addTrack, removeTrack, BeatEditError, type ExternalSandboxPayload, type TrackKind } from '../core/index.js'
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
import { varyTrack, VARY_GROUPS, BeatVaryError } from '../vary/vary.js'

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
 * mode without discarding what's there — the existing loop content becomes a real, playable scene. */
function sceneFromLiveContent(doc: BeatDocument, sceneId: string): BeatDocument {
  let d = doc
  const slots: Record<string, string> = {}
  for (const t of d.tracks) {
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

/** Resize the section at `index` to `bars` bars (setSong validates the 1-64 range). */
export function songResize(doc: BeatDocument, index: number, bars: number): BeatDocument {
  if (!doc.song || doc.song.length === 0) throw new BeatEditError('not in song mode — no section to resize')
  if (!Number.isInteger(index) || index < 0 || index >= doc.song.length) throw new BeatEditError(`section index ${index} out of range (0-${doc.song.length - 1})`)
  return setSong(doc, doc.song.map((s, i) => (i === index ? { scene: s.scene, bars } : s)))
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
            return prev && Object.keys(prev.laneSamples).length > 0 ? { ...t, laneSamples: prev.laneSamples } : t
          })
          // v0.6: instrument tracks never reach the GUI, so they never come back in a GUI push —
          // reinsert them at their original positions (same never-erase rule as media).
          for (const [i, t] of doc.tracks.entries()) {
            if (t.kind === 'instrument') carried.splice(Math.min(i, carried.length), 0, t)
          }
          const nextDoc = {
            ...converted,
            media: doc.media,
            tracks: carried,
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
    if (req.method === 'POST' && url.pathname === '/song') {
      readBody(req)
        .then((body) => {
          const b = JSON.parse(body) as { op?: unknown; index?: unknown; bars?: unknown }
          let next: BeatDocument
          if (b.op === 'append') next = songAppend(doc, Number(b.bars))
          else if (b.op === 'resize') next = songResize(doc, Number(b.index), Number(b.bars))
          else if (b.op === 'delete') next = songDelete(doc, Number(b.index))
          else {
            json(res, 400, { error: `unknown song op "${String(b.op)}" (expected append|resize|delete)` })
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
