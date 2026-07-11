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
import { parse, serialize, sandboxPayloadToBeatDocument, beatDocumentToPartialTracks, setValue, validateSelection, type ExternalSandboxPayload } from '../core/index.js'

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
