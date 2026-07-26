// The shared HTTP shell behind `beat rate` (blind measurement) and `beat board` (named production
// picks). Both are tiny local web apps over a directory of rendered batches: serve one inline HTML
// page, serve the batch wavs, take a few JSON POSTs that append a row to a JSONL log.
//
// Why this module exists (research/130 T9/W2.9): cli/rate.mjs and cli/board.mjs carried that shell
// twice, nearly byte-identically — including two copies of the SAME two security bugs, so a fix in
// one would have silently left the other exposed:
//
//   L1a  The /audio containment test was `full.startsWith(batchDir)` — a STRING prefix, not a path
//        containment test. A sibling directory whose name merely begins with the root's name
//        (`/coll-private` next to `/coll`, `showdown-1-secret` next to `showdown-1`) passes it, so
//        `?b=` / `?f=` could read any .wav on the machine whose path happened to share the prefix.
//        Confirmed with 200s and real bytes. `isInside` below does the real test.
//
//   L1b  The mutating routes checked neither Origin nor content-type. A cross-site form POST is a
//        CORS-"simple" request — text/plain, no preflight, sent without the attacker ever reading
//        the response — so any page open in the same browser while a rating session was running
//        could append forged rows to beat-scores.jsonl / beat-decisions.jsonl, i.e. silently
//        poison the taste data the whole eval pipeline is built on. `guardMutatingRequest` below
//        requires application/json (which forces a preflight this server never answers) AND a
//        loopback Origin, and pins Host to loopback so a DNS-rebinding name can't stand in for it.
//
// Everything here is deliberately dependency-free (node:http + a page string), same as before.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'

/** Hostnames that mean "this machine" for a server bound to 127.0.0.1. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * True when `candidate` is `root` itself or lives underneath it — a real path containment test,
 * not `candidate.startsWith(root)`. Both sides are resolved first, so `..` segments and relative
 * inputs are normalised away before the comparison.
 */
export function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  if (rel === '') return true // the root itself
  if (isAbsolute(rel)) return false // different volume / no relative path exists
  return rel.split(sep)[0] !== '..' // any leading `..` means it escaped
}

/**
 * The /audio route's whole guard, in one place: `?b=` must name a directory inside the scanned
 * root, `?f=` must resolve to a .wav inside THAT directory, and the file must exist. Returns the
 * absolute path to serve, or null for "404, and don't say why".
 *
 * `f` is normalised (not just resolved) so a traversal is folded before the containment test, and
 * an ABSOLUTE `f` is caught too: `resolve(batchDir, '/somewhere/else.wav')` ignores batchDir
 * entirely, which the containment test then rejects.
 */
export function resolveAudioPath(root: string, batchParam: string | null, fileParam: string | null): string | null {
  if (batchParam === null || fileParam === null || batchParam === '' || fileParam === '') return null
  const batchDir = resolve(batchParam)
  if (!isInside(root, batchDir)) return null
  const full = resolve(batchDir, normalize(fileParam))
  if (!isInside(batchDir, full)) return null
  if (!full.toLowerCase().endsWith('.wav')) return null
  if (!existsSync(full)) return null
  return full
}

/**
 * The guard on every mutating (POST) route. Returns null when the request is allowed, or a reason
 * string to answer 403 with. Two independent checks, either of which alone stops the drive-by:
 *
 *  1. content-type MUST be application/json. The three CORS-"simple" content types
 *     (text/plain, application/x-www-form-urlencoded, multipart/form-data) are exactly what a
 *     cross-site form or no-preflight fetch can send; requiring application/json forces a CORS
 *     preflight, and this server answers no preflight, so the browser never sends the real request.
 *  2. Origin, when present, must be loopback. A same-origin fetch from the served page sends
 *     `http://localhost:<port>`; a page on any other site sends its own origin and is refused.
 *
 * Host is pinned to loopback as well: the server binds 127.0.0.1, but a DNS-rebinding name that
 * resolves there would otherwise reach it with an attacker-controlled Origin the browser considers
 * same-origin. A non-browser client (curl, a test, the CLI) sends no Origin and is unaffected —
 * this is a CSRF guard, not authentication, and the server is loopback-only by design.
 */
export function guardMutatingRequest(req: IncomingMessage): string | null {
  const contentType = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
  if (contentType !== 'application/json') {
    return `content-type must be application/json (got ${contentType === '' ? 'none' : `"${contentType}"`})`
  }
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    let hostname: string
    try {
      hostname = new URL(origin).hostname
    } catch {
      return `unreadable Origin header "${origin}"`
    }
    if (!LOOPBACK_HOSTS.has(hostname)) return `cross-origin request from ${origin} refused`
  }
  const host = String(req.headers.host ?? '')
  if (host !== '') {
    const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]!
    if (!LOOPBACK_HOSTS.has(hostname)) return `unexpected Host header "${host}" (this server is loopback-only)`
  }
  return null
}

/** Throw from a route handler to answer with a specific status instead of 500. */
export class ReviewHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ReviewHttpError'
  }
}

export interface ReviewRoute {
  method: 'GET' | 'POST'
  /** GET handlers receive the parsed URL; POST handlers receive the parsed JSON body. Return the
   * value to serialise as the JSON response; throw ReviewHttpError for a 4xx. */
  handler: (arg: unknown, url: URL) => unknown | Promise<unknown>
}

export interface ReviewServerConfig {
  /** The scanned collection root. Nothing outside it is ever served. */
  root: string
  /** The inline HTML page served at `/`. */
  page: string
  /** Extra routes by pathname, e.g. `'/api/score'`. `/` and `/audio` are provided by the shell. */
  routes: Record<string, ReviewRoute>
  /** Cap on a POST body; a rating/decision payload is a few hundred bytes. */
  maxBodyBytes?: number
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > maxBytes) throw new ReviewHttpError(413, 'request body too large')
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new ReviewHttpError(400, 'body must be JSON')
  }
}

/** Build the server. Exported separately from listening so tests can drive it on port 0. */
export function createReviewServer(config: ReviewServerConfig): Server {
  const root = resolve(config.root)
  const maxBodyBytes = config.maxBodyBytes ?? 1024 * 1024
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    try {
      if (url.pathname === '/' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html' }).end(config.page)
        return
      }
      if (url.pathname === '/audio' && req.method === 'GET') {
        const full = resolveAudioPath(root, url.searchParams.get('b'), url.searchParams.get('f'))
        if (full === null) {
          res.writeHead(404).end('not found')
          return
        }
        res.writeHead(200, { 'content-type': 'audio/wav' }).end(readFileSync(full))
        return
      }
      const route = config.routes[url.pathname]
      if (route === undefined || route.method !== req.method) {
        res.writeHead(404).end('not found')
        return
      }
      let arg: unknown = url
      if (route.method === 'POST') {
        const refusal = guardMutatingRequest(req)
        if (refusal !== null) {
          res.writeHead(403, { 'content-type': 'text/plain' }).end(refusal)
          return
        }
        arg = await readJsonBody(req, maxBodyBytes)
      }
      const payload = await route.handler(arg, url)
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(payload))
    } catch (err) {
      const status = err instanceof ReviewHttpError ? err.status : 500
      res.writeHead(status).end(String(err instanceof Error ? err.message : err))
    }
  })
}

/**
 * Bind on loopback with the shared "port already in use" advice both commands printed identically.
 * `onReady` prints the command's own banner.
 */
export function listenReviewServer(server: Server, port: number, onReady: () => void, inUseHint: string): void {
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`error: port ${port} is already in use — pass --port <other> (${inUseHint})`)
      process.exit(2)
    }
    console.error(`error: ${err.message}`)
    process.exit(1)
  })
  server.listen(port, '127.0.0.1', onReady)
}
