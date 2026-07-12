// Phase 24 Stream CI — POST /place-clip: "place a clip into the arrangement for the first time"
// for synth/drums/instrument tracks (docs/phase-24-stream-ci.md). NoteView.tsx edits a track's LIVE
// content, not a saved BeatClip directly, so placing it in the arrangement means snapshotting that
// live content into a clip (core's saveClip) and slotting it into a scene (core's setScene) —
// generalizing Phase 23 Stream BC's install-audio-clip route (test/content-library.test.ts) onto the
// track kinds that don't drag in an external file.

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { initDocument, addTrack, addNote, serialize, type BeatDocument } from '../src/core/index.js'
import { startDaemon, type Daemon } from '../src/daemon/daemon.js'

/** A synth track ("lead") carrying two real live notes, a drum track ("drums") with no scene
 * membership yet, an `audio` track ("fx") to exercise the kind refusal, and one song section
 * ("verse") so a freshly-placed clip has somewhere real to slot into. */
function baseDoc(): BeatDocument {
  let doc = initDocument({ trackId: 'lead' })
  doc = addNote(doc, 'lead', { pitch: 64, start: 0, duration: 4, velocity: 0.8 }).doc
  doc = addNote(doc, 'lead', { pitch: 67, start: 8, duration: 4, velocity: 0.7 }).doc
  doc = addTrack(doc, { id: 'drums', kind: 'drums' }).doc
  doc = addTrack(doc, { id: 'fx', kind: 'audio' }).doc
  doc = { ...doc, scenes: [{ id: 'verse', slots: {} }], song: [{ scene: 'verse', bars: 4 }] }
  return doc
}

async function withDaemon(fn: (daemon: Daemon, filePath: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'beat-daemon-place-clip-test-'))
  const filePath = join(dir, 'song.beat')
  writeFileSync(filePath, serialize(baseDoc()))
  const daemon = await startDaemon({ filePath, port: 0 })
  try {
    await fn(daemon, filePath)
  } finally {
    await daemon.close()
  }
}

test('POST /place-clip mints a new clip from the track\'s live notes and slots it into the given scene', async () => {
  await withDaemon(async (daemon) => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/place-clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'lead', sceneId: 'verse' }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      written: boolean
      clipId: string
      doc: {
        scenes: { id: string; slots: Record<string, string> }[]
        tracks: { id: string; notes: { pitch: number; start: number }[]; clips: { id: string; notes: { pitch: number; start: number }[] }[] }[]
      }
    }
    assert.equal(body.written, true)
    assert.equal(body.clipId, 'clip1')
    const lead = body.doc.tracks.find((t) => t.id === 'lead')!
    const clip = lead.clips.find((c) => c.id === 'clip1')!
    assert.deepEqual(
      clip.notes.map((n) => [n.pitch, n.start]).sort(),
      lead.notes.map((n) => [n.pitch, n.start]).sort(),
    )
    const verse = body.doc.scenes.find((s) => s.id === 'verse')!
    assert.equal(verse.slots.lead, 'clip1')
  })
})

test('POST /place-clip with an existing clipId re-saves that clip in place (BC\'s "reuse an existing occurrence" precedent) and merges into the scene without clobbering other tracks\' slots', async () => {
  await withDaemon(async (daemon) => {
    const base = `http://127.0.0.1:${daemon.port}`
    const first = await fetch(`${base}/place-clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'lead', sceneId: 'verse' }),
    })
    const firstBody = (await first.json()) as { clipId: string }
    assert.equal(firstBody.clipId, 'clip1')

    // A second track (drums) also places into the SAME scene — must not clobber lead's slot.
    const drumRes = await fetch(`${base}/place-clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'drums', sceneId: 'verse' }),
    })
    const drumBody = (await drumRes.json()) as { clipId: string }
    assert.equal(drumBody.clipId, 'clip1') // drums' own first free id, independent numbering per track

    // Re-place lead with its OWN clip id: updates the same clip, doesn't mint a second one.
    const again = await fetch(`${base}/place-clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'lead', clipId: 'clip1', sceneId: 'verse' }),
    })
    assert.equal(again.status, 200)
    const body = (await again.json()) as {
      clipId: string
      doc: { scenes: { id: string; slots: Record<string, string> }[]; tracks: { id: string; clips: { id: string }[] }[] }
    }
    assert.equal(body.clipId, 'clip1')
    const lead = body.doc.tracks.find((t) => t.id === 'lead')!
    assert.equal(lead.clips.length, 1) // re-saved in place, not a second clip
    const verse = body.doc.scenes.find((s) => s.id === 'verse')!
    assert.equal(verse.slots.lead, 'clip1')
    assert.equal(verse.slots.drums, 'clip1') // the OTHER track's slot survived the re-place
  })
})

test('POST /place-clip with no sceneId still creates the clip, just unslotted (loop-mode-safe — refusal is the CLIENT\'s job)', async () => {
  await withDaemon(async (daemon) => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/place-clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'lead' }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { doc: { scenes: { slots: Record<string, string> }[]; tracks: { id: string; clips: { id: string }[] }[] } }
    const lead = body.doc.tracks.find((t) => t.id === 'lead')!
    assert.equal(lead.clips.length, 1)
    assert.ok(body.doc.scenes.every((s) => !s.slots.lead))
  })
})

test('POST /place-clip rejects an audio-kind track (no live content to snapshot — use install-audio-clip)', async () => {
  await withDaemon(async (daemon, filePath) => {
    const before = readFileSync(filePath, 'utf8')
    const res = await fetch(`http://127.0.0.1:${daemon.port}/place-clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'fx', sceneId: 'verse' }),
    })
    assert.equal(res.status, 400)
    assert.equal(readFileSync(filePath, 'utf8'), before)
  })
})

test('POST /place-clip rejects an unknown track', async () => {
  await withDaemon(async (daemon) => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/place-clip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'nope', sceneId: 'verse' }),
    })
    assert.equal(res.status, 404)
  })
})
