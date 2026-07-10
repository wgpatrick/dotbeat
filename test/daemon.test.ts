import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { get } from 'node:http'
import { test } from 'node:test'
import { parse, serialize, sandboxPayloadToBeatDocument, type ExternalSandboxPayload } from '../src/core/index.js'
import { startDaemon, type Daemon } from '../src/daemon/daemon.js'

const fixturePath = fileURLToPath(new URL('./fixtures/real-sandbox.beatlab.json', import.meta.url))
const realPayload = JSON.parse(readFileSync(fixturePath, 'utf8')) as ExternalSandboxPayload

function realBeatText(): string {
  return serialize(sandboxPayloadToBeatDocument(realPayload).doc)
}

/** Minimal SSE client: resolves with the next event whose name is in `names`. */
function nextSseEvent(port: number, names: string[], timeoutMs = 3000): { promise: Promise<{ event: string; data: unknown }>; ready: Promise<void> } {
  let resolveReady!: () => void
  const ready = new Promise<void>((r) => (resolveReady = r))
  const promise = new Promise<{ event: string; data: unknown }>((resolve, reject) => {
    const req = get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
      resolveReady()
      let buf = ''
      res.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8')
        // SSE frames are separated by a blank line
        let sep: number
        while ((sep = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, sep)
          buf = buf.slice(sep + 2)
          const eventLine = frame.split('\n').find((l) => l.startsWith('event: '))
          const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))
          if (!eventLine || !dataLine) continue
          const event = eventLine.slice('event: '.length)
          if (!names.includes(event)) continue
          clearTimeout(timer)
          req.destroy()
          resolve({ event, data: JSON.parse(dataLine.slice('data: '.length)) })
          return
        }
      })
    })
    const timer = setTimeout(() => {
      req.destroy()
      reject(new Error(`no ${names.join('/')} SSE event within ${timeoutMs}ms`))
    }, timeoutMs)
    req.on('error', reject)
  })
  return { promise, ready }
}

async function withDaemon(fn: (daemon: Daemon, filePath: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'beat-daemon-test-'))
  const filePath = join(dir, 'song.beat')
  writeFileSync(filePath, realBeatText())
  const daemon = await startDaemon({ filePath, port: 0 }) // port 0 = OS-assigned, parallel-safe
  try {
    await fn(daemon, filePath)
  } finally {
    await daemon.close()
  }
}

test('GET /doc serves the parsed document as partial tracks', async () => {
  await withDaemon(async (daemon) => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/doc`)
    const body = (await res.json()) as { bpm: number; tracks: { id: string; kind: string }[] }
    assert.equal(body.bpm, 126)
    assert.equal(body.tracks.length, 4)
    assert.ok(body.tracks.some((t) => t.kind === 'drums'))
  })
})

test('POST /state writes the file only when musically changed, and the change is one line', async () => {
  await withDaemon(async (daemon, filePath) => {
    const before = readFileSync(filePath, 'utf8')

    // identical state → no write
    const same = await fetch(`http://127.0.0.1:${daemon.port}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(realPayload),
    })
    assert.equal(((await same.json()) as { written: boolean }).written, false)
    assert.equal(readFileSync(filePath, 'utf8'), before)

    // one param changed → written, and the diff is exactly one line
    const edited = structuredClone(realPayload)
    const lead = edited.tracks.find((t) => t.id === 'lead')!
    lead.synth = { ...lead.synth, cutoff: 777 }
    const changed = await fetch(`http://127.0.0.1:${daemon.port}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(edited),
    })
    assert.equal(((await changed.json()) as { written: boolean }).written, true)
    const after = readFileSync(filePath, 'utf8')
    const beforeLines = before.split('\n')
    const afterLines = after.split('\n')
    assert.equal(beforeLines.length, afterLines.length)
    const diff = afterLines.filter((l, i) => l !== beforeLines[i])
    assert.deepEqual(diff, ['    cutoff 777'])
    assert.equal(daemon.getDoc().tracks.find((t) => t.id === 'lead')!.synth.cutoff, 777)
  })
})

test('an external file edit is parsed and broadcast to SSE clients', async () => {
  await withDaemon(async (daemon, filePath) => {
    const { promise, ready } = nextSseEvent(daemon.port, ['doc'])
    await ready
    const text = readFileSync(filePath, 'utf8').replace('    cutoff 3200', '    cutoff 555')
    writeFileSync(filePath, text)
    const { data } = await promise
    const body = data as { tracks: { id: string; synth: { cutoff?: number } }[] }
    assert.equal(body.tracks.find((t) => t.id === 'lead')!.synth.cutoff, 555)
    assert.equal(daemon.getDoc().tracks.find((t) => t.id === 'lead')!.synth.cutoff, 555)
  })
})

test('an invalid file edit broadcasts parse-error and keeps serving the last good document', async () => {
  await withDaemon(async (daemon, filePath) => {
    const { promise, ready } = nextSseEvent(daemon.port, ['parse-error', 'doc'])
    await ready
    writeFileSync(filePath, 'this is not a beat file\n')
    const { event } = await promise
    assert.equal(event, 'parse-error')
    // the daemon still serves the last good document
    const res = await fetch(`http://127.0.0.1:${daemon.port}/doc`)
    const body = (await res.json()) as { tracks: unknown[] }
    assert.equal(body.tracks.length, 4)
  })
})

test('the daemon refuses to start on an unparseable file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-daemon-test-'))
  const filePath = join(dir, 'broken.beat')
  writeFileSync(filePath, 'nope\n')
  await assert.rejects(() => startDaemon({ filePath, port: 0 }))
})

test('round-trip sanity: the text the daemon writes re-parses to the same document', async () => {
  await withDaemon(async (daemon, filePath) => {
    const edited = structuredClone(realPayload)
    edited.bpm = 133
    await fetch(`http://127.0.0.1:${daemon.port}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(edited),
    })
    const onDisk = parse(readFileSync(filePath, 'utf8'))
    assert.equal(onDisk.bpm, 133)
    assert.deepEqual(onDisk, daemon.getDoc())
  })
})
