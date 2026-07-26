// The shared `beat rate` / `beat board` server shell (src/serve/review-server.ts) — the two
// security bugs it was extracted to fix, once, for both twins.
//
// Every case below is a runnable adversarial probe that returned 200 (or wrote a row) before the
// fix. The traversal cases are the ones that matter most: the old guard was a STRING prefix test,
// so the interesting escapes aren't `../` at all — they're sibling directories whose names merely
// begin with the root's name, which no amount of `..`-stripping would have caught.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AddressInfo } from 'node:net'
import { createReviewServer, guardMutatingRequest, isInside, resolveAudioPath, ReviewHttpError } from '../src/serve/review-server.js'
import { scoreBatch, BeatBatchError } from '../src/vary/batch.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root

// ---------------------------------------------------------------------------------------------
// Path containment (f3-traversal.mjs)
// ---------------------------------------------------------------------------------------------

test('isInside is a path-containment test, not a string-prefix test', () => {
  assert.equal(isInside('/a/coll', '/a/coll'), true, 'the root contains itself')
  assert.equal(isInside('/a/coll', '/a/coll/showdown-1'), true)
  assert.equal(isInside('/a/coll', '/a/coll/showdown-1/v1.wav'), true)

  // The bug: every one of these passes `candidate.startsWith(root)`.
  assert.equal(isInside('/a/coll', '/a/coll-private'), false, 'a sibling sharing the root name prefix is OUTSIDE')
  assert.equal(isInside('/a/coll', '/a/collision'), false)
  assert.equal(isInside('/a/coll/showdown-1', '/a/coll/showdown-1-secret'), false, 'and a sibling of a batch dir too')

  assert.equal(isInside('/a/coll', '/a'), false, 'a parent is not inside a child')
  assert.equal(isInside('/a/coll', '/a/coll/../elsewhere'), false, 'traversal is normalised before the test')
  assert.equal(isInside('/a/coll', '/b/other'), false)
})

/** The f3 fixture: a rating root with one batch, plus two "private" dirs the string-prefix guard
 * happily served — one beside the root, one beside the batch dir. */
function traversalFixture() {
  const base = mkdtempSync(join(tmpdir(), 'beat-review-traversal-'))
  const root = join(base, 'coll')
  const batch = join(root, 'showdown-bassline-1')
  const secret = join(base, 'coll-private') // shares the ROOT's name prefix
  const sibling = join(root, 'showdown-bassline-1-secret') // shares the BATCH dir's name prefix
  for (const d of [batch, secret, sibling]) mkdirSync(d, { recursive: true })
  writeFileSync(join(batch, 'v1.wav'), 'legit-wav-bytes')
  writeFileSync(join(secret, 'commercial-ref.wav'), 'private-reference-bytes')
  writeFileSync(join(sibling, 'leak.wav'), 'leaked-bytes')
  return { base, root, batch, secret, sibling }
}

test('resolveAudioPath serves the batch wav and refuses every f3 escape', () => {
  const f = traversalFixture()
  try {
    // A. the legitimate request still works
    assert.equal(resolveAudioPath(f.root, f.batch, 'v1.wav'), resolve(f.batch, 'v1.wav'))

    // B. `?b=` pointed at a sibling of the ROOT whose name starts with the root's name
    assert.equal(resolveAudioPath(f.root, f.secret, 'commercial-ref.wav'), null)
    // C. `?f=` reaching a sibling of the BATCH dir whose name starts with the batch dir's name
    assert.equal(resolveAudioPath(f.root, f.batch, '../showdown-bassline-1-secret/leak.wav'), null)
    // D. plain `../../`
    assert.equal(resolveAudioPath(f.root, f.batch, '../../coll-private/commercial-ref.wav'), null)
    // E. double-encoded separators are not separators — resolves inside, then simply doesn't exist
    assert.equal(resolveAudioPath(f.root, f.batch, '..%2f..%2fcoll-private%2fcommercial-ref.wav'), null)
    // F. an ABSOLUTE `?f=` (resolve() would drop batchDir entirely)
    assert.equal(resolveAudioPath(f.root, f.batch, join(f.secret, 'commercial-ref.wav')), null)

    // and the non-traversal parts of the guard still hold
    assert.equal(resolveAudioPath(f.root, f.batch, 'manifest.json'), null, 'only .wav is served')
    assert.equal(resolveAudioPath(f.root, f.batch, 'missing.wav'), null, 'and only if it exists')
    assert.equal(resolveAudioPath(f.root, null, 'v1.wav'), null)
    assert.equal(resolveAudioPath(f.root, f.batch, null), null)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------------------------
// CSRF on the mutating routes (f4-csrf.mjs)
// ---------------------------------------------------------------------------------------------

const headers = (h: Record<string, string>) => ({ headers: h }) as unknown as Parameters<typeof guardMutatingRequest>[0]

test('guardMutatingRequest refuses the CORS-simple drive-by POST', () => {
  // The f4 request verbatim: a cross-site form-shaped POST needs no preflight and no CORS grant to
  // SEND, so before the fix it appended a forged rating row to beat-scores.jsonl.
  const refusal = guardMutatingRequest(headers({ 'content-type': 'text/plain', origin: 'https://evil.example', host: '127.0.0.1:4321' }))
  assert.ok(refusal !== null)
  assert.match(refusal, /content-type must be application\/json/)

  // Each of the other CORS-simple content types is refused for the same reason.
  for (const ct of ['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '']) {
    assert.ok(guardMutatingRequest(headers({ 'content-type': ct, host: 'localhost:4321' })) !== null, `${ct || 'no content-type'} must be refused`)
  }
})

test('guardMutatingRequest refuses a non-loopback Origin even with the right content-type', () => {
  const refusal = guardMutatingRequest(headers({ 'content-type': 'application/json', origin: 'https://evil.example', host: 'localhost:4321' }))
  assert.ok(refusal !== null)
  assert.match(refusal, /cross-origin/)
})

test('guardMutatingRequest refuses a rebound Host name pointing at loopback', () => {
  const refusal = guardMutatingRequest(headers({ 'content-type': 'application/json', host: 'rebind.evil.example:4321' }))
  assert.ok(refusal !== null)
  assert.match(refusal, /Host header/)
})

test('guardMutatingRequest allows the page\'s own fetch and a plain CLI/test client', () => {
  // The served page: same-origin fetch, JSON body.
  assert.equal(guardMutatingRequest(headers({ 'content-type': 'application/json', origin: 'http://localhost:4321', host: 'localhost:4321' })), null)
  assert.equal(guardMutatingRequest(headers({ 'content-type': 'application/json; charset=utf-8', origin: 'http://127.0.0.1:4321', host: '127.0.0.1:4321' })), null)
  // A non-browser client sends no Origin — this is a CSRF guard, not authentication.
  assert.equal(guardMutatingRequest(headers({ 'content-type': 'application/json', host: '127.0.0.1:4321' })), null)
})

// ---------------------------------------------------------------------------------------------
// The shell end to end
// ---------------------------------------------------------------------------------------------

async function withShell(fn: (ctx: { url: (p: string) => string; root: string; batch: string; posted: unknown[] }) => Promise<void>) {
  const f = traversalFixture()
  const posted: unknown[] = []
  const server = createReviewServer({
    root: f.root,
    page: '<!doctype html><title>x</title>hello',
    routes: {
      '/api/queue': { method: 'GET', handler: () => [{ id: f.batch }] },
      '/api/score': {
        method: 'POST',
        handler: (body) => {
          const { id } = (body ?? {}) as { id?: unknown }
          if (!isInside(f.root, resolve(String(id ?? '')))) throw new ReviewHttpError(400, 'batch outside root')
          posted.push(body)
          return { ok: true }
        },
      },
    },
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  try {
    await fn({ url: (p) => `http://127.0.0.1:${port}${p}`, root: f.root, batch: f.batch, posted })
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
    rmSync(f.base, { recursive: true, force: true })
  }
}

test('the shell serves the page, the queue, and only in-root wavs', async () => {
  await withShell(async ({ url, batch }) => {
    assert.equal((await fetch(url('/'))).status, 200)
    assert.deepEqual(await (await fetch(url('/api/queue'))).json(), [{ id: batch }])

    const ok = await fetch(url(`/audio?b=${encodeURIComponent(batch)}&f=v1.wav`))
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('content-type'), 'audio/wav')
    assert.equal(await ok.text(), 'legit-wav-bytes')

    const escaped = await fetch(url(`/audio?b=${encodeURIComponent(batch)}&f=${encodeURIComponent('../showdown-bassline-1-secret/leak.wav')}`))
    assert.equal(escaped.status, 404, 'the sibling-prefix escape is a 404, and says nothing about why')

    assert.equal((await fetch(url('/nope'))).status, 404)
  })
})

test('the shell rejects a drive-by POST end to end and the handler never runs', async () => {
  await withShell(async ({ url, batch, posted }) => {
    const drive = await fetch(url('/api/score'), {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: 'https://evil.example' },
      body: JSON.stringify({ id: batch, picks: ['v1.wav'] }),
    })
    assert.equal(drive.status, 403)
    assert.equal(posted.length, 0, 'nothing reached the handler, so nothing could be appended to the log')

    // The page's own request goes through.
    const real = await fetch(url('/api/score'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url('') },
      body: JSON.stringify({ id: batch, picks: ['v1.wav'] }),
    })
    assert.equal(real.status, 200)
    assert.equal(posted.length, 1)
  })
})

test('the shell answers 400 for non-JSON bodies and forwards ReviewHttpError statuses', async () => {
  await withShell(async ({ url, posted }) => {
    const bad = await fetch(url('/api/score'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' })
    assert.equal(bad.status, 400)
    const outside = await fetch(url('/api/score'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: '/etc', picks: ['v1.wav'] }),
    })
    assert.equal(outside.status, 400)
    assert.equal(await outside.text(), 'batch outside root')
    assert.equal(posted.length, 0)
  })
})

// ---------------------------------------------------------------------------------------------
// Structural parity: one shell, not two copies (research/130 T9/W2.9)
// ---------------------------------------------------------------------------------------------

test('rate.mjs and board.mjs both go through the shared shell — neither keeps a private copy', () => {
  for (const name of ['rate.mjs', 'board.mjs']) {
    const src = readFileSync(join(repoRoot, 'cli', name), 'utf8')
    assert.match(src, /createReviewServer/, `${name} must build its server from the shared shell`)
    assert.doesNotMatch(src, /createServer\(/, `${name} must not stand up its own http server again`)
    // The exact shape of the bug, banned by name so a future edit can't reintroduce it quietly.
    assert.doesNotMatch(src, /\.startsWith\(root\)/, `${name} must not path-check with a string prefix`)
    assert.doesNotMatch(src, /\.startsWith\(batchDir\)/, `${name} must not path-check with a string prefix`)
  }
})

// ---------------------------------------------------------------------------------------------
// M6: the rating page's pick cap must equal the SCORER's cap (f5-fourpicks.mjs)
// ---------------------------------------------------------------------------------------------

test('the rate page caps picks at exactly the number scoreBatch accepts', async () => {
  const { PAGE } = (await import(pathToFileURL(join(repoRoot, 'cli', 'rate.mjs')).href)) as { PAGE: string }
  const declared = /const MAX_PICKS=(\d+)/.exec(PAGE)
  assert.ok(declared, 'the page must declare its cap in one named place')
  const cap = Number(declared[1])

  // The page must actually USE it — the bug was a page that bound 9 picks while the scorer took 3.
  assert.match(PAGE, /picks\.length<Math\.min\(queue\[idx\]\.order\.length,MAX_PICKS\)/, 'togglePick must gate on MAX_PICKS')
  assert.doesNotMatch(PAGE, /a full ranking teaches the most/, 'and must not invite a ranking the scorer will reject')

  // And it must equal the scorer's real, behavioural cap — probed, not read from a constant.
  const dir = mkdtempSync(join(tmpdir(), 'beat-review-cap-'))
  try {
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        group: 'bassline',
        seed: 41,
        parent: 'song.beat',
        variants: Array.from({ length: cap + 3 }, (_, i) => ({ file: `v${i + 1}.beat`, edits: ['lead.cutoff', '4000'] })),
      }),
    )
    const logPath = join(dir, 'beat-scores.jsonl')
    const picks = Array.from({ length: cap + 1 }, (_, i) => `v${i + 1}`)
    assert.throws(
      () => scoreBatch(dir, picks, logPath),
      (err: unknown) => err instanceof BeatBatchError && /at most 3 ranked picks/.test((err as Error).message),
      `the scorer must reject ${cap + 1} picks — if it now accepts more, raise MAX_PICKS in cli/rate.mjs deliberately (see the pairs-math note in the M6 write-up)`,
    )
    // …and accept exactly `cap`, so the page is never capping BELOW what the owner could give.
    scoreBatch(dir, picks.slice(0, cap), logPath)
    assert.equal(readFileSync(logPath, 'utf8').trim().split('\n').length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
