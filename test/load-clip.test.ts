// Phase 29 Stream GA — POST /load-clip: the inverse of /place-clip (test/place-clip.test.ts). Once a
// song has more than one section, the note editor could resolve WHICH clip a click meant
// (primaryClipFor, ui/src/components/ClipPropertiesPanel.tsx) but had no primitive to actually load
// that clip's saved content back into the track's live buffer — the deeper reason docs/research/83,
// 84, and 86 all independently found that clicking a later section's clip block never retargeted the
// note editor away from the first section's clip. This route (core's loadClip) closes that gap.

import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { initDocument, addTrack, addNote, addHit, saveClip, serialize, type BeatDocument } from '../src/core/index.js'
import { startDaemon, type Daemon } from '../src/daemon/daemon.js'

/** A synth track ("lead") whose LIVE notes differ from an already-saved clip ("verse-clip"), so
 * loading that clip is an observable change — plus a drums track with its own saved clip, to cover
 * the hits path too. */
function baseDoc(): BeatDocument {
  let doc = initDocument({ trackId: 'lead' })
  // Save a clip from an EARLIER live state (two notes)...
  doc = addNote(doc, 'lead', { pitch: 64, start: 0, duration: 4, velocity: 0.8 }).doc
  doc = addNote(doc, 'lead', { pitch: 67, start: 8, duration: 4, velocity: 0.7 }).doc
  doc = saveClip(doc, 'lead', 'verse-clip').doc
  // ...then keep editing live so the live buffer now diverges from the saved clip.
  doc = addNote(doc, 'lead', { pitch: 72, start: 16, duration: 2, velocity: 0.9 }).doc

  doc = addTrack(doc, { id: 'drums', kind: 'drums' }).doc
  doc = addHit(doc, 'drums', { lane: 'kick', start: 0, velocity: 0.9 }).doc
  doc = saveClip(doc, 'drums', 'drum-clip').doc
  doc = addHit(doc, 'drums', { lane: 'hat', start: 4, velocity: 0.5 }).doc // live now has 2 hits, clip has 1
  return doc
}

async function withDaemon(fn: (daemon: Daemon, filePath: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'beat-daemon-load-clip-test-'))
  const filePath = join(dir, 'song.beat')
  writeFileSync(filePath, serialize(baseDoc()))
  const daemon = await startDaemon({ filePath, port: 0 })
  try {
    await fn(daemon, filePath)
  } finally {
    await daemon.close()
  }
}

test('POST /load-clip overwrites the track\'s live notes with the named clip\'s notes, leaving the clip itself untouched', async () => {
  await withDaemon(async (daemon) => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/load-clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'lead', clipId: 'verse-clip' }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      written: boolean
      doc: { tracks: { id: string; notes: { pitch: number; start: number }[]; clips: { id: string; notes: { pitch: number; start: number }[] }[] }[] }
    }
    assert.equal(body.written, true)
    const lead = body.doc.tracks.find((t) => t.id === 'lead')!
    const clip = lead.clips.find((c) => c.id === 'verse-clip')!
    // live now matches the clip exactly (2 notes, not the 3 it had before loading)...
    assert.deepEqual(
      lead.notes.map((n) => [n.pitch, n.start]).sort(),
      [
        [64, 0],
        [67, 8],
      ],
    )
    // ...and the clip itself is unchanged by the load.
    assert.deepEqual(
      clip.notes.map((n) => [n.pitch, n.start]).sort(),
      [
        [64, 0],
        [67, 8],
      ],
    )
  })
})

test('POST /load-clip on a drums track swaps live hits, not notes', async () => {
  await withDaemon(async (daemon) => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/load-clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'drums', clipId: 'drum-clip' }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { doc: { tracks: { id: string; hits: { lane: string }[]; notes: unknown[] }[] } }
    const drums = body.doc.tracks.find((t) => t.id === 'drums')!
    assert.deepEqual(drums.hits.map((h) => h.lane), ['kick']) // back down to the clip's one hit
    assert.deepEqual(drums.notes, [])
  })
})

test('POST /load-clip rejects an unknown clip id or track', async () => {
  await withDaemon(async (daemon) => {
    const badClip = await fetch(`http://127.0.0.1:${daemon.port}/load-clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'lead', clipId: 'no-such-clip' }),
    })
    assert.equal(badClip.status, 400)

    const badTrack = await fetch(`http://127.0.0.1:${daemon.port}/load-clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'no-such-track', clipId: 'verse-clip' }),
    })
    assert.equal(badTrack.status, 400)
  })
})
