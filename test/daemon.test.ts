import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
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

// ─── Phase 19 Stream V: the arrangement-length surface (POST /song) ───────────────────────────────
const postSong = (port: number, body: unknown) =>
  fetch(`http://127.0.0.1:${port}/song`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('POST /song append converts loop mode into song mode, keeping the loop as section 0', async () => {
  await withDaemon(async (daemon, filePath) => {
    const loopBars = daemon.getDoc().loopBars
    assert.equal(daemon.getDoc().song, null) // fixture starts in loop mode

    const res = await postSong(daemon.port, { op: 'append', bars: 6 })
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as { written: boolean }).written, true)

    const doc = daemon.getDoc()
    assert.ok(doc.song && doc.song.length === 2, 'appending from loop mode yields two sections')
    // section 0 = the existing loop content, loopBars long; section 1 = the new 6-bar section.
    assert.equal(doc.song![0]!.bars, loopBars)
    assert.equal(doc.song![1]!.bars, 6)
    // Both reference a real, freshly-minted scene whose slot map covers every track via snapshotted clips.
    const sceneId = doc.song![0]!.scene
    const scene = doc.scenes.find((s) => s.id === sceneId)
    assert.ok(scene, 'the conversion minted a scene')
    for (const t of doc.tracks) {
      assert.equal(scene!.slots[t.id], sceneId, `track ${t.id} is mapped in the scene`)
      assert.ok(t.clips.some((c) => c.id === sceneId), `track ${t.id} got a snapshot clip`)
    }
    // Persisted to disk and re-parses identically (in-memory === disk invariant).
    assert.deepEqual(parse(readFileSync(filePath, 'utf8')), doc)
  })
})

test('POST /song resize and delete edit the section list; delete refuses the last section', async () => {
  await withDaemon(async (daemon) => {
    await postSong(daemon.port, { op: 'append', bars: 6 }) // -> 2 sections (loop + 6)
    await postSong(daemon.port, { op: 'append', bars: 8 }) // -> 3 sections, appended reuses last scene
    let doc = daemon.getDoc()
    assert.equal(doc.song!.length, 3)
    assert.equal(doc.song![2]!.bars, 8)
    assert.equal(doc.song![2]!.scene, doc.song![1]!.scene, 'append reuses the last section scene')

    // resize section 1 to 5 bars — only that section changes.
    await postSong(daemon.port, { op: 'resize', index: 1, bars: 5 })
    doc = daemon.getDoc()
    assert.equal(doc.song![1]!.bars, 5)

    // delete the middle section — the outer two survive intact.
    const keepScene0 = doc.song![0]!.scene
    const keepBars2 = doc.song![2]!.bars
    await postSong(daemon.port, { op: 'delete', index: 1 })
    doc = daemon.getDoc()
    assert.equal(doc.song!.length, 2)
    assert.equal(doc.song![0]!.scene, keepScene0)
    assert.equal(doc.song![1]!.bars, keepBars2)

    // deleting down to one is allowed; deleting the last remaining section is refused (400).
    await postSong(daemon.port, { op: 'delete', index: 1 })
    assert.equal(daemon.getDoc().song!.length, 1)
    const refused = await postSong(daemon.port, { op: 'delete', index: 0 })
    assert.equal(refused.status, 400)
    assert.equal(daemon.getDoc().song!.length, 1, 'the last section is still there')
  })
})

test('POST /song rejects a bad op and an out-of-range bar count', async () => {
  await withDaemon(async (daemon) => {
    assert.equal((await postSong(daemon.port, { op: 'frobnicate' })).status, 400)
    assert.equal((await postSong(daemon.port, { op: 'append', bars: 999 })).status, 400)
    assert.equal(daemon.getDoc().song, null, 'a rejected append left the doc in loop mode')
  })
})

// ─── Phase 22 Stream AG: overlapping-region resolution policy (POST /song resize) ─────────────────
// docs/research/22-opendaw-editing-workflow.md §2.1's clip/push-existing/keep-existing, reimplemented
// for dotbeat's 1D section-list timeline (src/daemon/daemon.ts's songResize doc comment has the full
// reasoning). Only growing a NON-LAST section can conflict with anything; shrinking and growing the
// last section behave identically under every policy (nothing sits after them to disturb).
async function threeSections(daemon: Daemon): Promise<number> {
  const loopBars = daemon.getDoc().loopBars
  await postSong(daemon.port, { op: 'append', bars: 6 })
  await postSong(daemon.port, { op: 'append', bars: 8 })
  // -> sections [loopBars, 6, 8]
  return loopBars
}

test('overlap policy "push-existing" (default): growing a non-last section leaves every other section untouched, total length grows', async () => {
  await withDaemon(async (daemon) => {
    const loopBars = await threeSections(daemon)
    const res = await postSong(daemon.port, { op: 'resize', index: 0, bars: loopBars + 3, policy: 'push-existing' })
    assert.equal(res.status, 200)
    const doc = daemon.getDoc()
    assert.equal(doc.song![0]!.bars, loopBars + 3)
    assert.equal(doc.song![1]!.bars, 6, 'section 1 is unaffected — it just starts later')
    assert.equal(doc.song![2]!.bars, 8, 'section 2 is unaffected')
  })
})

test('overlap policy defaults to "push-existing" when omitted (backward-compatible with pre-Stream-AG callers)', async () => {
  await withDaemon(async (daemon) => {
    const loopBars = await threeSections(daemon)
    await postSong(daemon.port, { op: 'resize', index: 0, bars: loopBars + 3 }) // no policy field
    const doc = daemon.getDoc()
    assert.equal(doc.song![0]!.bars, loopBars + 3)
    assert.equal(doc.song![1]!.bars, 6)
  })
})

test('overlap policy "clip": growing a non-last section truncates the NEXT section by the overflow, total length unchanged', async () => {
  await withDaemon(async (daemon) => {
    const loopBars = await threeSections(daemon)
    const totalBefore = docTotalBars(daemon)
    const res = await postSong(daemon.port, { op: 'resize', index: 0, bars: loopBars + 3, policy: 'clip' })
    assert.equal(res.status, 200)
    const doc = daemon.getDoc()
    assert.equal(doc.song![0]!.bars, loopBars + 3, 'the resized section gets its full requested size')
    assert.equal(doc.song![1]!.bars, 3, 'section 1 (6 bars) absorbed the 3-bar overflow, truncated to 3')
    assert.equal(doc.song![2]!.bars, 8, 'section 2 is untouched — clip never cascades past the immediate neighbor')
    assert.equal(docTotalBars(daemon), totalBefore, 'total song length is unchanged')
  })
})

test('overlap policy "clip" never cascades: growth is capped at what the immediate neighbor can give up (floor of 1 bar)', async () => {
  await withDaemon(async (daemon) => {
    const loopBars = await threeSections(daemon)
    // section 1 has 6 bars, so it can give up at most 5 (floor of 1) — request an 8-bar growth.
    const res = await postSong(daemon.port, { op: 'resize', index: 0, bars: loopBars + 8, policy: 'clip' })
    assert.equal(res.status, 200)
    const doc = daemon.getDoc()
    assert.equal(doc.song![1]!.bars, 1, 'section 1 gave up everything down to the 1-bar floor')
    assert.equal(doc.song![0]!.bars, loopBars + 5, 'the resize itself is capped to what section 1 could give up (5), not the full requested 8')
    assert.equal(doc.song![2]!.bars, 8, 'section 2 is still untouched — no cascade past section 1')
  })
})

test('overlap policy "keep-existing": growing a non-last section is refused — the whole arrangement is byte-for-byte unchanged', async () => {
  await withDaemon(async (daemon, filePath) => {
    const loopBars = await threeSections(daemon)
    const before = readFileSync(filePath, 'utf8')
    const res = await postSong(daemon.port, { op: 'resize', index: 0, bars: loopBars + 3, policy: 'keep-existing' })
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as { written: boolean }).written, false, 'a refused growth writes nothing')
    const doc = daemon.getDoc()
    assert.equal(doc.song![0]!.bars, loopBars, 'the growth was refused — section 0 stays at its original size')
    assert.equal(doc.song![1]!.bars, 6)
    assert.equal(doc.song![2]!.bars, 8)
    assert.equal(readFileSync(filePath, 'utf8'), before, 'the file is untouched by a refused resize')
  })
})

test('every policy behaves identically for shrinking and for growing the LAST section (nothing to overlap)', async () => {
  await withDaemon(async (daemon) => {
    await threeSections(daemon) // [loopBars, 6, 8]
    for (const policy of ['clip', 'push-existing', 'keep-existing'] as const) {
      await postSong(daemon.port, { op: 'resize', index: 1, bars: 4, policy }) // shrink section 1
      assert.equal(daemon.getDoc().song![1]!.bars, 4, `shrink succeeds under ${policy}`)
      await postSong(daemon.port, { op: 'resize', index: 1, bars: 6, policy }) // restore
      await postSong(daemon.port, { op: 'resize', index: 2, bars: 12, policy }) // grow the LAST section
      assert.equal(daemon.getDoc().song![2]!.bars, 12, `growing the last section succeeds under ${policy} — nothing sits after it`)
      await postSong(daemon.port, { op: 'resize', index: 2, bars: 8, policy }) // restore
    }
  })
})

test('an unknown overlap policy is rejected with a 400', async () => {
  await withDaemon(async (daemon) => {
    await threeSections(daemon)
    const res = await postSong(daemon.port, { op: 'resize', index: 0, bars: 5, policy: 'frobnicate' })
    assert.equal(res.status, 400)
  })
})

test('an out-of-range bar count is rejected with a 400 under every policy — not just push-existing', async () => {
  // The 'clip' and 'keep-existing' branches don't always forward the raw requested `bars` to
  // setSong (clip caps it against the neighbor's slack; keep-existing may no-op), so validation has
  // to happen up front in songResize itself, or an out-of-range request could silently slip through
  // under those two policies while still correctly failing under push-existing.
  await withDaemon(async (daemon) => {
    await threeSections(daemon)
    for (const policy of ['push-existing', 'clip', 'keep-existing'] as const) {
      const before = daemon.getDoc().song!.map((s) => s.bars)
      const res = await postSong(daemon.port, { op: 'resize', index: 0, bars: 999, policy })
      assert.equal(res.status, 400, `policy ${policy} should reject bars 999`)
      assert.deepEqual(daemon.getDoc().song!.map((s) => s.bars), before, `policy ${policy} must leave the arrangement untouched on a rejected request`)
    }
  })
})

function docTotalBars(daemon: Daemon): number {
  return daemon.getDoc().song!.reduce((n, s) => n + s.bars, 0)
}

// Phase 20 Stream W: track structure add/remove over HTTP (the GUI's track-management surface).
test('POST /add-track appends a track, writes it to the file, and returns the fresh document', async () => {
  await withDaemon(async (daemon, filePath) => {
    const before = daemon.getDoc().tracks.length
    const res = await fetch(`http://127.0.0.1:${daemon.port}/add-track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'pad2', kind: 'synth' }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { written: boolean; doc: { tracks: { id: string }[] } }
    assert.equal(body.written, true)
    assert.ok(body.doc.tracks.some((t) => t.id === 'pad2'))
    // landed in memory AND on disk (a real track line, not just the response)
    assert.equal(daemon.getDoc().tracks.length, before + 1)
    assert.ok(readFileSync(filePath, 'utf8').split('\n').some((l) => l.startsWith('track pad2 ')))
  })
})

test('POST /add-track rejects a duplicate id with 400 and does not write', async () => {
  await withDaemon(async (daemon, filePath) => {
    const before = readFileSync(filePath, 'utf8')
    const res = await fetch(`http://127.0.0.1:${daemon.port}/add-track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'lead', kind: 'synth' }), // 'lead' already exists
    })
    assert.equal(res.status, 400)
    assert.match(((await res.json()) as { error: string }).error, /already exists/)
    assert.equal(readFileSync(filePath, 'utf8'), before)
  })
})

test('POST /remove-track drops a track, cleans up disk, and returns the fresh document', async () => {
  await withDaemon(async (daemon, filePath) => {
    const before = daemon.getDoc().tracks.length
    const res = await fetch(`http://127.0.0.1:${daemon.port}/remove-track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'chords' }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { written: boolean; doc: { tracks: { id: string }[] } }
    assert.equal(body.written, true)
    assert.ok(!body.doc.tracks.some((t) => t.id === 'chords'))
    assert.equal(daemon.getDoc().tracks.length, before - 1)
    assert.ok(!readFileSync(filePath, 'utf8').split('\n').some((l) => l.startsWith('track chords ')))
  })
})

// ─── Phase 22 Stream AF: track grouping (POST /group) ──────────────────────────────────────────────
const postGroup = (port: number, body: unknown) =>
  fetch(`http://127.0.0.1:${port}/group`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('POST /group create folds tracks into a group, writes a `group` line, and returns the fresh document', async () => {
  await withDaemon(async (daemon, filePath) => {
    const res = await postGroup(daemon.port, { op: 'create', trackIds: ['lead', 'chords'], name: 'Keys' })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { written: boolean; doc: { groups: { id: string; name: string; tracks: string[] }[] } }
    assert.equal(body.written, true)
    assert.equal(body.doc.groups.length, 1)
    assert.deepEqual(body.doc.groups[0]!.tracks, ['lead', 'chords'])
    assert.equal(daemon.getDoc().groups[0]!.name, 'Keys')
    const line = readFileSync(filePath, 'utf8').split('\n').find((l) => l.startsWith('group '))
    assert.match(line!, /^group group1 Keys #[0-9a-f]{6} lead chords$/)
  })
})

test('POST /group refuses to double-group a track (400, no write) and rename/recolor/set-tracks/delete round-trip', async () => {
  await withDaemon(async (daemon, filePath) => {
    const create = await postGroup(daemon.port, { op: 'create', trackIds: ['lead', 'chords'] })
    const { doc: created } = (await create.json()) as { doc: { groups: { id: string }[] } }
    const groupId = created.groups[0]!.id

    // a third track can't join by creating ANOTHER group containing an already-grouped track
    const dup = await postGroup(daemon.port, { op: 'create', trackIds: ['lead', 'drums'] })
    assert.equal(dup.status, 400)
    assert.match(((await dup.json()) as { error: string }).error, /already in group/)

    const rename = await postGroup(daemon.port, { op: 'rename', id: groupId, name: 'Synths' })
    assert.equal((((await rename.json()) as { doc: { groups: { name: string }[] } }).doc.groups[0]!).name, 'Synths')

    const recolor = await postGroup(daemon.port, { op: 'recolor', id: groupId, color: '#123456' })
    assert.equal((((await recolor.json()) as { doc: { groups: { color: string }[] } }).doc.groups[0]!).color, '#123456')

    const setTracks = await postGroup(daemon.port, { op: 'set-tracks', id: groupId, trackIds: ['lead', 'chords', 'drums'] })
    assert.deepEqual((((await setTracks.json()) as { doc: { groups: { tracks: string[] }[] } }).doc.groups[0]!).tracks, ['lead', 'chords', 'drums'])

    const del = await postGroup(daemon.port, { op: 'delete', id: groupId })
    const afterDelete = (await del.json()) as { doc: { groups: unknown[]; tracks: { id: string }[] } }
    assert.equal(afterDelete.doc.groups.length, 0)
    assert.equal(afterDelete.doc.tracks.length, daemon.getDoc().tracks.length) // ungrouping never removes tracks

    // final on-disk state has no group line at all (elided, same discipline as an empty automation lane)
    assert.ok(!readFileSync(filePath, 'utf8').split('\n').some((l) => l.startsWith('group ')))
  })
})

// ─── Phase 22 Stream AF: new-project-from-scratch + save-as-template ───────────────────────────────

test('POST /new-project (blank) creates project.beat in a folder with the requested bpm', async () => {
  await withDaemon(async (daemon) => {
    const dir = mkdtempSync(join(tmpdir(), 'beat-new-project-'))
    const res = await fetch(`http://127.0.0.1:${daemon.port}/new-project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: dir, bpm: 140 }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { filePath: string; created: boolean }
    assert.equal(body.filePath, join(dir, 'project.beat'))
    assert.ok(existsSync(body.filePath))
    const created = parse(readFileSync(body.filePath, 'utf8'))
    assert.equal(created.bpm, 140)
    assert.equal(created.tracks.length, 1) // the format's standard init patch: one starter track
  })
})

test('POST /new-project refuses to overwrite an existing file', async () => {
  await withDaemon(async (daemon) => {
    const dir = mkdtempSync(join(tmpdir(), 'beat-new-project-'))
    const target = join(dir, 'song.beat')
    writeFileSync(target, 'not touched\n')
    const res = await fetch(`http://127.0.0.1:${daemon.port}/new-project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: target }),
    })
    assert.equal(res.status, 400)
    assert.match(((await res.json()) as { error: string }).error, /already exists/)
    assert.equal(readFileSync(target, 'utf8'), 'not touched\n')
  })
})

test('POST /save-as-template copies the CURRENT on-disk project bytes to a new path, unmodified', async () => {
  await withDaemon(async (daemon, filePath) => {
    const dir = mkdtempSync(join(tmpdir(), 'beat-template-'))
    const before = readFileSync(filePath, 'utf8')
    const res = await fetch(`http://127.0.0.1:${daemon.port}/save-as-template`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: dir, name: 'my-template' }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { filePath: string; source: string }
    assert.equal(body.filePath, join(dir, 'my-template.beat'))
    assert.equal(readFileSync(body.filePath, 'utf8'), before)
    assert.equal(readFileSync(filePath, 'utf8'), before, 'the source project is untouched')
  })
})

test('POST /new-project with `from` starts a new project as a fresh copy of a saved template, never touching it', async () => {
  await withDaemon(async (daemon) => {
    // Save a template, then edit the ORIGINAL project (add a track) — the template must not follow.
    const templateDir = mkdtempSync(join(tmpdir(), 'beat-template-'))
    const saveRes = await fetch(`http://127.0.0.1:${daemon.port}/save-as-template`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: templateDir }),
    })
    const { filePath: templatePath } = (await saveRes.json()) as { filePath: string }
    const templateBytesBefore = readFileSync(templatePath, 'utf8')

    await fetch(`http://127.0.0.1:${daemon.port}/add-track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'extra', kind: 'synth' }),
    })
    assert.equal(readFileSync(templatePath, 'utf8'), templateBytesBefore, 'editing the live project did not touch the saved template')

    // Now start a brand-new project FROM that template.
    const newProjectDir = mkdtempSync(join(tmpdir(), 'beat-from-template-'))
    const newRes = await fetch(`http://127.0.0.1:${daemon.port}/new-project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: newProjectDir, from: templatePath }),
    })
    assert.equal(newRes.status, 200)
    const { filePath: newProjectPath } = (await newRes.json()) as { filePath: string }
    assert.equal(readFileSync(newProjectPath, 'utf8'), templateBytesBefore, 'the new project starts as an exact copy of the template')

    // Editing the NEW project must not touch the template either (independent files, not a reference).
    writeFileSync(newProjectPath, readFileSync(newProjectPath, 'utf8').replace('bpm 126', 'bpm 200'))
    assert.equal(readFileSync(templatePath, 'utf8'), templateBytesBefore, 'editing the new project left the template byte-identical')
    assert.notEqual(readFileSync(newProjectPath, 'utf8'), templateBytesBefore)
  })
})

test('POST /new-project with a `from` that is not a valid .beat file is rejected (400)', async () => {
  await withDaemon(async (daemon) => {
    const badTemplateDir = mkdtempSync(join(tmpdir(), 'beat-bad-template-'))
    const badTemplate = join(badTemplateDir, 'nope.beat')
    writeFileSync(badTemplate, 'this is not a beat file\n')
    const dir = mkdtempSync(join(tmpdir(), 'beat-new-project-'))
    const res = await fetch(`http://127.0.0.1:${daemon.port}/new-project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: dir, from: badTemplate }),
    })
    assert.equal(res.status, 400)
    assert.match(((await res.json()) as { error: string }).error, /not a valid \.beat file/)
    assert.ok(!existsSync(join(dir, 'project.beat')))
  })
})
