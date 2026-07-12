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

// Phase 24 Stream CB: POST /song move — reorder a section without deleting/re-adding it, verified
// end-to-end through the daemon route (the unit-level splice logic itself is covered by
// songMove's own tests in test/format-v04.test.ts).
test('POST /song move reorders a section; the file on disk reflects the new order', async () => {
  await withDaemon(async (daemon, filePath) => {
    await postSong(daemon.port, { op: 'append', bars: 6 }) // -> 2 sections (loop + 6)
    await postSong(daemon.port, { op: 'append', bars: 8 }) // -> 3 sections
    const before = daemon.getDoc()
    assert.equal(before.song!.length, 3)
    const [s0, s1, s2] = before.song!

    // move the last section to the front.
    const res = await postSong(daemon.port, { op: 'move', from: 2, to: 0 })
    assert.equal(res.status, 200)
    const after = daemon.getDoc()
    assert.deepEqual(after.song, [s2, s0, s1])
    // no scene was created/destroyed — same three scenes, just reordered sections referencing them.
    assert.equal(after.scenes.length, before.scenes.length)
    // in-memory === disk invariant.
    assert.deepEqual(parse(readFileSync(filePath, 'utf8')), after)
  })
})

test('POST /song move rejects an out-of-range fromIndex (400), doc unchanged', async () => {
  await withDaemon(async (daemon) => {
    await postSong(daemon.port, { op: 'append', bars: 6 })
    const before = daemon.getDoc()
    const res = await postSong(daemon.port, { op: 'move', from: 99, to: 0 })
    assert.equal(res.status, 400)
    assert.deepEqual(daemon.getDoc().song, before.song)
  })
})

test('POST /song rejects a bad op and an out-of-range bar count', async () => {
  await withDaemon(async (daemon) => {
    assert.equal((await postSong(daemon.port, { op: 'frobnicate' })).status, 400)
    assert.equal((await postSong(daemon.port, { op: 'append', bars: 999 })).status, 400)
    assert.equal(daemon.getDoc().song, null, 'a rejected append left the doc in loop mode')
  })
})

// Phase 23 Stream BC regression: converting loop -> song mode used to 500 whenever an `audio`-kind
// track was present. sceneFromLiveContent snapshotted EVERY track's live content into the new
// scene, but an audio track has none (Stream AE: "BeatTrack gets no `audio` field, only
// `BeatClip.audio?`") — saveClip produced a clip with no `audio` line, which the parser then
// rejects outright the moment writeIfChanged's serialize+parse round-trip ran, 500-ing the whole
// route (discovered live via ui/verify-phase23-stream-bc.mjs's drag-to-create-clip flow). Fixed by
// skipping audio-kind tracks in sceneFromLiveContent — they simply start unmapped/silent in the new
// scene, same as any track absent from a scene's slots.
test('POST /song append with an audio-kind track present does not 500 — the audio track starts unmapped, not with a phantom clip', async () => {
  const { initDocument, addTrack, serialize: ser } = await import('../src/core/index.js')
  const dir = mkdtempSync(join(tmpdir(), 'beat-daemon-song-audio-test-'))
  const filePath = join(dir, 'song.beat')
  let doc = initDocument({ trackId: 'lead' })
  doc = addTrack(doc, { id: 'fx', kind: 'audio' }).doc
  writeFileSync(filePath, ser(doc))
  const daemon = await startDaemon({ filePath, port: 0 })
  try {
    const res = await postSong(daemon.port, { op: 'append', bars: 4 })
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as { written: boolean }).written, true)

    const next = daemon.getDoc()
    assert.ok(next.song && next.song.length === 2)
    const sceneId = next.song![0]!.scene
    const scene = next.scenes.find((s) => s.id === sceneId)
    assert.ok(scene)
    // the synth track snapshotted in and got mapped, same as the existing test above...
    assert.equal(scene!.slots.lead, sceneId)
    // ...but the audio track did NOT — no slot, no phantom clip.
    assert.equal(scene!.slots.fx, undefined, 'the audio track should stay unmapped in the new scene')
    const fxTrack = next.tracks.find((t) => t.id === 'fx')!
    assert.equal(fxTrack.clips.length, 0, 'the audio track should get no snapshot clip')
    // in-memory === disk invariant still holds (the round-trip that used to 500 now succeeds cleanly).
    assert.deepEqual(parse(readFileSync(filePath, 'utf8')), next)
  } finally {
    await daemon.close()
  }
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

// ─── Phase 24 Stream CC: cross-section clip move (POST /clip-move) ────────────────────────────────
// ArrangementView.tsx's marquee-select-then-drag: moving one or more clip occurrences to different
// section(s) at once, preserving their relative section-index offset. See daemon.ts's
// applyClipMoves doc comment for the full design — occurrences are 1:1 with sections, so a move
// clears the track's slot in the source section's scene and sets it in the target's, but every
// section TOUCHED by the batch gets a freshly-minted PRIVATE scene first, so the move never bleeds
// into a sibling section that happens to reuse the same original scene.
const postClipMove = (port: number, moves: unknown) =>
  fetch(`http://127.0.0.1:${port}/clip-move`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ moves }) })

/** A small controlled 4-section song where scene "verse" deliberately backs TWO separate sections
 * (0 and 3) — the shared-scene case a move has to handle without bleeding into section 3 when
 * section 0 is the one being edited. Section 1 ("chorus") maps both tracks; section 2 ("bridge")
 * maps neither (silent), so it's never touched by any of these tests. */
async function sharedSceneSong(): Promise<{ daemon: Daemon; filePath: string }> {
  const { initDocument, addTrack, saveClip, setScene, setSong, serialize: ser } = await import('../src/core/index.js')
  let doc = initDocument({ trackId: 'lead' })
  doc = addTrack(doc, { id: 'drums', kind: 'drums' }).doc
  doc = saveClip(doc, 'lead', 'leadClip').doc
  doc = saveClip(doc, 'drums', 'drumsClip').doc
  doc = setScene(doc, 'verse', { lead: 'leadClip', drums: 'drumsClip' })
  doc = setScene(doc, 'chorus', { lead: 'leadClip' })
  doc = setScene(doc, 'bridge', {})
  doc = setSong(doc, [
    { scene: 'verse', bars: 4 }, // 0
    { scene: 'chorus', bars: 4 }, // 1
    { scene: 'bridge', bars: 4 }, // 2 — genuinely empty, a clean destination for a move
    { scene: 'verse', bars: 4 }, // 3 — shares the ORIGINAL "verse" scene with section 0
  ])
  const dir = mkdtempSync(join(tmpdir(), 'beat-daemon-clipmove-test-'))
  const filePath = join(dir, 'song.beat')
  writeFileSync(filePath, ser(doc))
  const daemon = await startDaemon({ filePath, port: 0 })
  return { daemon, filePath }
}

test('POST /clip-move moves one track\'s occurrence to a different section without touching a sibling section that shares the same scene', async () => {
  const { daemon, filePath } = await sharedSceneSong()
  try {
    // Move "drums" from section 0 ("verse") to section 1 ("chorus", currently drums-less).
    const res = await postClipMove(daemon.port, [{ track: 'drums', fromIndex: 0, toIndex: 1 }])
    assert.equal(res.status, 200)
    const body = (await res.json()) as { written: boolean }
    assert.equal(body.written, true)

    const doc = daemon.getDoc()
    assert.equal(doc.song!.length, 4, 'move never changes the section COUNT')
    const sec0 = doc.scenes.find((s) => s.id === doc.song![0]!.scene)!
    const sec1 = doc.scenes.find((s) => s.id === doc.song![1]!.scene)!
    const sec3 = doc.scenes.find((s) => s.id === doc.song![3]!.scene)!
    assert.equal(sec0.slots.drums, undefined, 'drums unmapped at the source section')
    assert.equal(sec0.slots.lead, 'leadClip', 'lead untouched at the source section')
    assert.equal(sec1.slots.drums, 'drumsClip', 'drums mapped at the destination section')
    assert.equal(sec1.slots.lead, 'leadClip', 'chorus\'s own lead mapping is untouched')
    // Section 3 shared the ORIGINAL "verse" scene with section 0 — it must be completely
    // unaffected: still has drums mapped (the whole point of private-scene cloning).
    assert.equal(sec3.slots.drums, 'drumsClip', 'a sibling section sharing the old scene keeps its own drums mapping')
    assert.equal(sec3.slots.lead, 'leadClip')
    // Section 0 and section 3 must now be on DIFFERENT scenes (the clone), even though they
    // started on the same one.
    assert.notEqual(doc.song![0]!.scene, doc.song![3]!.scene)
    // in-memory === disk invariant still holds.
    assert.deepEqual(parse(readFileSync(filePath, 'utf8')), doc)
  } finally {
    await daemon.close()
  }
})

test('POST /clip-move batches a whole marquee-selected group as one write, preserving each occurrence\'s relative section offset', async () => {
  const { daemon } = await sharedSceneSong()
  try {
    // Move BOTH lead and drums from section 0 to section 2 in one batch (as a real marquee-drag
    // would issue) — both should land together, and section 3 (still sharing the ORIGINAL "verse"
    // scene) must stay untouched.
    const res = await postClipMove(daemon.port, [
      { track: 'lead', fromIndex: 0, toIndex: 2 },
      { track: 'drums', fromIndex: 0, toIndex: 2 },
    ])
    assert.equal(res.status, 200)
    const doc = daemon.getDoc()
    const sec0 = doc.scenes.find((s) => s.id === doc.song![0]!.scene)!
    const sec2 = doc.scenes.find((s) => s.id === doc.song![2]!.scene)!
    const sec3 = doc.scenes.find((s) => s.id === doc.song![3]!.scene)!
    assert.equal(sec0.slots.lead, undefined)
    assert.equal(sec0.slots.drums, undefined)
    assert.equal(sec2.slots.lead, 'leadClip')
    assert.equal(sec2.slots.drums, 'drumsClip')
    assert.equal(sec3.slots.lead, 'leadClip', 'sibling section 3 (shared the old "verse" scene) is untouched')
    assert.equal(sec3.slots.drums, 'drumsClip')
  } finally {
    await daemon.close()
  }
})

test('POST /clip-move rejects an out-of-range section index and a track with no occurrence at fromIndex, without writing', async () => {
  const { daemon, filePath } = await sharedSceneSong()
  try {
    const before = readFileSync(filePath, 'utf8')
    const badIndex = await postClipMove(daemon.port, [{ track: 'drums', fromIndex: 0, toIndex: 99 }])
    assert.equal(badIndex.status, 400)
    // "chorus" (section 1) has no drums slot — moving drums FROM section 1 is a no-op source.
    const badSource = await postClipMove(daemon.port, [{ track: 'drums', fromIndex: 1, toIndex: 2 }])
    assert.equal(badSource.status, 400)
    assert.equal(readFileSync(filePath, 'utf8'), before, 'a rejected move must not touch the file')
  } finally {
    await daemon.close()
  }
})

test('POST /clip-move is a no-op (200, unwritten) when every move has fromIndex === toIndex', async () => {
  const { daemon, filePath } = await sharedSceneSong()
  try {
    const before = readFileSync(filePath, 'utf8')
    const res = await postClipMove(daemon.port, [{ track: 'drums', fromIndex: 0, toIndex: 0 }])
    assert.equal(res.status, 200)
    assert.equal(readFileSync(filePath, 'utf8'), before)
  } finally {
    await daemon.close()
  }
})

test('POST /clip-move outside song mode is rejected with a 400', async () => {
  await withDaemon(async (daemon) => {
    assert.equal(daemon.getDoc().song, null)
    const res = await postClipMove(daemon.port, [{ track: 'lead', fromIndex: 0, toIndex: 1 }])
    assert.equal(res.status, 400)
  })
})

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

// ─── Phase 22 Stream AE: POST /audio-split (split-at-point over HTTP, the GUI's split gesture) ───

async function withAudioDaemon(fn: (daemon: Daemon, filePath: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'beat-daemon-audio-test-'))
  const filePath = join(dir, 'song.beat')
  writeFileSync(
    filePath,
    `format_version 0.10
bpm 120
loop_bars 4
selected_track atrk

media
  sample smp_kick sha256:${'a'.repeat(64)} media/kick.wav

track atrk atrk #56b6c2 audio
  clip c1
    audio smp_kick 0 8 0 off 1
`,
  )
  const daemon = await startDaemon({ filePath, port: 0 })
  try {
    await fn(daemon, filePath)
  } finally {
    await daemon.close()
  }
}

const postAudioSplit = (port: number, body: unknown) =>
  fetch(`http://127.0.0.1:${port}/audio-split`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('POST /audio-split cuts one audio-region clip into two, writes to disk, and returns both ids', async () => {
  await withAudioDaemon(async (daemon, filePath) => {
    const res = await postAudioSplit(daemon.port, { track: 'atrk', clip: 'c1', at: 4 }) // 4 steps @ 120bpm = 0.5s
    assert.equal(res.status, 200)
    const body = (await res.json()) as { written: boolean; firstId: string; secondId: string }
    assert.equal(body.written, true)
    assert.equal(body.firstId, 'c1')
    assert.equal(body.secondId, 'c1-2')

    const doc = daemon.getDoc()
    const track = doc.tracks.find((t) => t.id === 'atrk')!
    assert.deepEqual(track.clips.map((c) => c.id), ['c1', 'c1-2'])
    assert.equal(track.clips[0]!.audio!.out, 0.5)
    assert.equal(track.clips[1]!.audio!.in, 0.5)
    assert.equal(track.clips[1]!.audio!.out, 8)
    // Persisted to disk and re-parses identically (in-memory === disk invariant).
    assert.deepEqual(parse(readFileSync(filePath, 'utf8')), doc)
  })
})

test('POST /audio-split rejects a bad request body and an out-of-range split position (400, no write)', async () => {
  await withAudioDaemon(async (daemon) => {
    assert.equal((await postAudioSplit(daemon.port, { track: 'atrk', clip: 'c1' })).status, 400) // missing `at`
    const res = await postAudioSplit(daemon.port, { track: 'atrk', clip: 'c1', at: 999 })
    assert.equal(res.status, 400)
    assert.match((await res.json() as { error: string }).error, /out of range/)
    assert.equal(daemon.getDoc().tracks.find((t) => t.id === 'atrk')!.clips.length, 1, 'the rejected split left the doc untouched')
  })
})

// ─── Phase 23 Stream BB: drum-lane structural editing + rung-2 feel vary/audition ──────────────────

function postJSON(port: number, path: string, body: unknown) {
  return fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

test('POST /lane materialize opts a legacy drums track into the open lane model', async () => {
  await withDaemon(async (daemon) => {
    assert.equal(daemon.getDoc().tracks.find((t) => t.id === 'drums')!.lanes.length, 0)
    const res = await postJSON(daemon.port, '/lane', { op: 'materialize', track: 'drums' })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { written: boolean; doc: { tracks: { id: string; lanes: { name: string }[] }[] } }
    assert.equal(body.written, true)
    assert.deepEqual(
      body.doc.tracks.find((t) => t.id === 'drums')!.lanes.map((l) => l.name),
      ['kick', 'snare', 'clap', 'hat', 'openhat'],
    )
    assert.equal(daemon.getDoc().tracks.find((t) => t.id === 'drums')!.lanes.length, 5)
  })
})

test('POST /lane add/move/param/backing/remove round-trip against a real daemon+file', async () => {
  await withDaemon(async (daemon, filePath) => {
    await postJSON(daemon.port, '/lane', { op: 'materialize', track: 'drums' })

    const add = await postJSON(daemon.port, '/lane', { op: 'add', track: 'drums', name: 'rim', backing: 'synth:noise decay=0.2' })
    assert.equal(add.status, 200)
    assert.ok(daemon.getDoc().tracks.find((t) => t.id === 'drums')!.lanes.some((l) => l.name === 'rim'))

    const move = await postJSON(daemon.port, '/lane', { op: 'move', track: 'drums', name: 'rim', index: 0 })
    assert.equal(move.status, 200)
    assert.equal(daemon.getDoc().tracks.find((t) => t.id === 'drums')!.lanes[0]!.name, 'rim')

    const param = await postJSON(daemon.port, '/lane', { op: 'param', track: 'drums', name: 'rim', key: 'decay', value: 0.4 })
    assert.equal(param.status, 200)
    const rim = daemon.getDoc().tracks.find((t) => t.id === 'drums')!.lanes.find((l) => l.name === 'rim')!
    assert.equal((rim.backing as { params: Record<string, number> }).params.decay, 0.4)

    const backing = await postJSON(daemon.port, '/lane', { op: 'backing', track: 'drums', name: 'rim', backing: 'synth:metal tone=6000' })
    assert.equal(backing.status, 200)
    const retyped = daemon.getDoc().tracks.find((t) => t.id === 'drums')!.lanes.find((l) => l.name === 'rim')!
    assert.equal((retyped.backing as { voice: string }).voice, 'metal')

    const remove = await postJSON(daemon.port, '/lane', { op: 'remove', track: 'drums', name: 'rim' })
    assert.equal(remove.status, 200)
    assert.ok(!daemon.getDoc().tracks.find((t) => t.id === 'drums')!.lanes.some((l) => l.name === 'rim'))

    assert.deepEqual(parse(readFileSync(filePath, 'utf8')), daemon.getDoc()) // in-memory === disk throughout
  })
})

test('POST /lane rejects unknown ops and missing fields with 400, and never writes on error', async () => {
  await withDaemon(async (daemon) => {
    const before = daemon.getDoc()
    assert.equal((await postJSON(daemon.port, '/lane', { op: 'bogus', track: 'drums' })).status, 400)
    assert.equal((await postJSON(daemon.port, '/lane', { op: 'add', track: 'drums' })).status, 400) // missing name/backing
    assert.deepEqual(daemon.getDoc(), before)
  })
})

test('POST /vary-feel generates a reproducible batch of full-document variants, scoped by selection', async () => {
  await withDaemon(async (daemon) => {
    await postJSON(daemon.port, '/selection', { tracks: ['drums'] })
    const res = await postJSON(daemon.port, '/vary-feel', { count: 3, seed: 5 })
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      track: string
      variants: { index: number; seed: number; recipe: string; doc: { tracks: { id: string; hits: { start: number }[] }[] } }[]
    }
    assert.equal(body.track, 'drums')
    assert.equal(body.variants.length, 3)
    assert.deepEqual(body.variants.map((v) => v.seed), [5, 6, 7]) // seed+i, reproducible
    assert.match(body.variants[0]!.recipe, /seed=5/)
    const drums0 = body.variants[0]!.doc.tracks.find((t) => t.id === 'drums')!
    assert.ok(drums0.hits.some((h) => !Number.isInteger(h.start))) // genuinely humanized off-grid
    // read-only: the live document's hits are still on-grid integers
    assert.ok(daemon.getDoc().tracks.find((t) => t.id === 'drums')!.hits.every((h) => Number.isInteger(h.start)))
  })
})

test('POST /vary-feel enforces selection scope, same guarantee /vary makes (spec §2)', async () => {
  await withDaemon(async (daemon) => {
    await postJSON(daemon.port, '/selection', { tracks: ['bass'] })
    const res = await postJSON(daemon.port, '/vary-feel', { track: 'drums', count: 1 })
    assert.equal(res.status, 400)
    assert.match((await res.json() as { error: string }).error, /refusing to vary outside the selection/)
  })
})

// Sorts each track's hits by id — /vary-feel's raw in-memory doc keeps humanize's original array
// order, while a written-then-reparsed doc comes back in serialize.ts's canonical (start, lane, id)
// order (sortedHitLines). Same hits, different array order; normalize before a content comparison.
function withSortedHits(doc: { tracks: { hits?: { id: string }[] }[] }): unknown {
  return { ...doc, tracks: doc.tracks.map((t) => (t.hits ? { ...t, hits: [...t.hits].sort((a, b) => a.id.localeCompare(b.id)) } : t)) }
}

test('POST /vary-feel/commit writes the exact seed a batch offered, deterministically', async () => {
  await withDaemon(async (daemon, filePath) => {
    const batchRes = await postJSON(daemon.port, '/vary-feel', { track: 'drums', count: 2, seed: 11 })
    const batch = (await batchRes.json()) as { variants: { seed: number; doc: { tracks: { hits?: { id: string }[] }[] } }[] }
    const chosen = batch.variants[1]!

    const commitRes = await postJSON(daemon.port, '/vary-feel/commit', { track: 'drums', seed: chosen.seed })
    assert.equal(commitRes.status, 200)
    const body = (await commitRes.json()) as { written: boolean; doc: { tracks: { hits?: { id: string }[] }[] } }
    assert.equal(body.written, true)
    // the write matches the audition variant's actual content (deterministic seed) — array order can
    // legitimately differ (see withSortedHits), the hit SET must not.
    assert.deepEqual(withSortedHits(body.doc), withSortedHits(chosen.doc))
    assert.deepEqual(parse(readFileSync(filePath, 'utf8')), daemon.getDoc())
  })
})

test('POST /vary-feel/commit can scope to specific drum lanes, leaving every other lane byte-identical', async () => {
  await withDaemon(async (daemon) => {
    const before = daemon.getDoc().tracks.find((t) => t.id === 'drums')!
    const kickBefore = before.hits.filter((h) => h.lane === 'kick').map((h) => h.start)
    const res = await postJSON(daemon.port, '/vary-feel/commit', { track: 'drums', seed: 3, lanes: ['kick'] })
    assert.equal(res.status, 200)
    const after = daemon.getDoc().tracks.find((t) => t.id === 'drums')!
    assert.deepEqual(after.hits.filter((h) => h.lane !== 'kick'), before.hits.filter((h) => h.lane !== 'kick'))
    assert.notDeepEqual(after.hits.filter((h) => h.lane === 'kick').map((h) => h.start), kickBefore)
  })
})
