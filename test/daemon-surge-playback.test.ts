// A surge track that SOUNDS in the GUI (Phase 41 Stream B / B2-B3).
//
// docs/surge-track.md claimed "in the GUI a surge track plays its last rendered WAV" and nothing
// implemented it — `grep surge ui/src/audio/engine.ts` matches nothing. The daemon now serves one
// generated drums-kind sample host per surge track ALONGSIDE it (see daemon.ts's "surge playback
// companions" section for why alongside and not instead-of), so the browser engine — which only
// knows synth/drums/instrument/audio — plays the cached render while the piano roll stays editable.
//
// NO PYTHON HERE, deliberately. The sidecar is env-gated everywhere else (surgepy is a source build
// of Surge XT with no wheel), and a test that can only run on the owner's machine is not a gate.
// The daemon's render step is content-addressed and cache-first, so seeding the cache — a WAV plus
// the provenance sidecar carrying the same hash the daemon computes — exercises every line of the
// companion path with the sidecar never spawned. The one thing that needs surgepy is the render
// itself, which surge-sidecar.test.ts already covers.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from '../src/core/index.js'
import { surgeRenderHash } from '../src/analysis/surge-host.js'
import { startDaemon, type Daemon } from '../src/daemon/daemon.js'

// Every assertion here is about the DAEMON's companion logic, never about the sidecar, so the
// interpreter is pointed at a path that cannot exist: a render attempt then fails instantly and
// IDENTICALLY everywhere, instead of the file quietly testing something different on the one
// machine that has a surgepy build. (`node --test` runs each file in its own process.)
process.env.BEAT_PYTHON = join(tmpdir(), 'no-such-python-for-surge-playback-tests')

const DOC_TEXT = `format_version 0.11
bpm 125
loop_bars 4
selected_track melody

track melody MELODY #61afef surge
  surge
    patch "Crockett's Plucked Lead"
    override volume 0.9
  synth
    osc sawtooth
    volume 6
    cutoff 2000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
  note u1 61 0 6 0.85
  note u2 66 6 10 0.8
  note u3 68 20 12 0.65
`

/** A 44-byte silent WAV header — nothing in the daemon decodes audio, it only hashes and serves
 * the bytes, and the browser is what plays them. */
function tinyWav(): Buffer {
  const b = Buffer.alloc(44)
  b.write('RIFF', 0)
  b.writeUInt32LE(36, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(48000, 24)
  b.writeUInt32LE(96000, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(0, 40)
  return b
}

/** Seed the render cache for the surge track in `text` exactly as a previous `beat render` would
 * have left it: media/surge_<track>_<hash12>.wav plus the provenance sidecar the daemon checks. */
function seedRenderCache(dir: string, text: string, trackId: string): string {
  const doc = parse(text)
  const track = doc.tracks.find((t) => t.id === trackId)!
  const key = surgeRenderHash(track, doc)!
  const sampleId = `surge_${trackId}_${key.hash.slice(0, 12)}`
  mkdirSync(join(dir, 'media'), { recursive: true })
  writeFileSync(join(dir, 'media', `${sampleId}.wav`), tinyWav())
  writeFileSync(join(dir, 'media', `${sampleId}.wav.json`), JSON.stringify({ hash: key.hash, seconds: 7.7 }) + '\n')
  return sampleId
}

interface ServedTrack {
  id: string
  name: string
  kind: string
  notes: { id: string }[]
  hits: { lane: string; start: number }[]
  lanes: { name: string; backing: { type: string; sample?: string } }[]
  synth: Record<string, unknown>
}
interface ServedDoc {
  tracks: ServedTrack[]
  media: { id: string; path: string }[]
}

async function withSurgeDaemon(fn: (ctx: { daemon: Daemon; dir: string; filePath: string; base: string; document: () => Promise<ServedDoc> }) => Promise<void>, opts: { seed?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'beat-surge-gui-'))
  const filePath = join(dir, 'song.beat')
  writeFileSync(filePath, DOC_TEXT)
  if (opts.seed !== false) seedRenderCache(dir, DOC_TEXT, 'melody')
  const daemon = await startDaemon({ filePath, port: 0 })
  const base = `http://127.0.0.1:${daemon.port}`
  try {
    await daemon.surgeIdle()
    await fn({ daemon, dir, filePath, base, document: async () => (await (await fetch(`${base}/document`)).json()) as ServedDoc })
  } finally {
    await daemon.close()
  }
}

test('GET /document serves a playable companion beside the surge track, not instead of it', async () => {
  await withSurgeDaemon(async ({ document, dir }) => {
    const served = await document()
    assert.deepEqual(
      served.tracks.map((t) => `${t.id}:${t.kind}`),
      ['melody:surge', 'melody__surge:drums'],
      'the companion is appended right after the track it shadows',
    )
    const source = served.tracks[0]!
    assert.equal(source.notes.length, 3, 'the surge track keeps its notes — the piano roll is why it is still kind "surge"')

    const companion = served.tracks[1]!
    const sampleId = seedRenderCache(dir, DOC_TEXT, 'melody')
    assert.deepEqual(companion.lanes, [{ name: 'surge', backing: { type: 'sample', sample: sampleId, gainDb: 0, tune: 0, params: {}, filterType: 'lowpass', effects: [] } }])
    assert.deepEqual(
      companion.hits.map((h) => `${h.lane}@${h.start}`),
      ['surge@0'],
      'one hit at 0 — the host plays the whole rendered phrase once per loop',
    )
    assert.equal(companion.notes.length, 0, 'the notes live on the surge track; the host is a sample player')
    assert.equal(companion.synth.volume, 6, "and it carries the surge track's production block, so its level is the one the owner set")
    assert.equal(companion.synth.cutoff, 18000, 'with the neutral host voice on top, so the whole render plays through')
    assert.ok(
      served.media.some((m) => m.id === sampleId && m.path === `media/${sampleId}.wav`),
      'the render is declared media of the SERVED document',
    )
  })
})

test('the render is servable over /media, so the browser can actually load it', async () => {
  await withSurgeDaemon(async ({ base, dir }) => {
    const sampleId = seedRenderCache(dir, DOC_TEXT, 'melody')
    const res = await fetch(`${base}/media/${sampleId}.wav`)
    assert.equal(res.status, 200)
    assert.equal((await res.arrayBuffer()).byteLength, 44, 'the seeded bytes, served verbatim')
  })
})

test('the companion is never written to the .beat file, by any route that could', async () => {
  await withSurgeDaemon(async ({ base, filePath, document }) => {
    const before = readFileSync(filePath, 'utf8')
    const served = await document()
    const companion = served.tracks[1]!

    // 1. A whole-document push that carries the companion back (what a client that pulled the
    //    served document and pushed it back would do).
    const doc = (await (await fetch(`${base}/doc`)).json()) as { tracks: unknown[]; bpm: number; loopBars: number; selectedTrackId: string }
    assert.equal(doc.tracks.length, 1, 'the legacy /doc projection is the FILE, unchanged — companions are a GUI-playback concern')
    const push = await fetch(`${base}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...doc,
        bpm: 130,
        tracks: [...doc.tracks, { id: companion.id, name: companion.name, color: '#61afef', kind: 'drums', notes: [], synth: companion.synth, pattern: { kick: [1, 0, 0, 0], snare: [], clap: [], hat: [], openhat: [] } }],
      }),
    })
    assert.equal(push.status, 200, await push.clone().text())
    const afterPush = parse(readFileSync(filePath, 'utf8'))
    assert.equal(afterPush.bpm, 130, 'the real edit in that push still lands')
    assert.deepEqual(
      afterPush.tracks.map((t) => t.id),
      ['melody'],
      'but the companion is dropped rather than becoming a real track shadowing the one it voices',
    )

    // 2. A path-scoped edit aimed at the companion answers with the track to edit instead.
    const edit = await fetch(`${base}/edit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: `${companion.id}.volume`, value: '-3' }) })
    assert.equal(edit.status, 400)
    assert.match(((await edit.json()) as { error: string }).error, /generated for playback, never stored.*Edit "melody"/s)
    assert.equal(readFileSync(filePath, 'utf8'), serializeGuard(before, 130), 'no edit route wrote a companion into the file')
  })
})

/** The file after the bpm push above — spelled out rather than re-read so the assertion above is a
 * real comparison and not a tautology. */
function serializeGuard(before: string, bpm: number): string {
  return before.replace(/^bpm .*$/m, `bpm ${bpm}`)
}

test('a production edit re-hosts with no sidecar; a note edit with no render available keeps the last one sounding', async () => {
  await withSurgeDaemon(async ({ base, daemon, document }) => {
    // A production knob: the render key does not move, so this must NOT need the sidecar (which is
    // not even installed in most environments) and must still reach the ear.
    const vol = await fetch(`${base}/edit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'melody.volume', value: '-4' }) })
    assert.equal(vol.status, 200)
    await daemon.surgeIdle()
    const served = await document()
    assert.equal(served.tracks[1]!.synth.volume, -4, "the companion follows the surge track's production immediately")

    // A note edit DOES move the render key. With no surgepy build (the normal case) there is no new
    // WAV to host — the companion must keep playing the previous render rather than falling silent
    // or vanishing mid-session.
    const note = await fetch(`${base}/edit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'melody.note.u1.pitch', value: '73' }) })
    assert.equal(note.status, 200)
    await daemon.surgeIdle()
    const after = await document()
    assert.equal(after.tracks.length, 2, 'still a companion')
    assert.equal(after.tracks[1]!.lanes[0]!.backing.sample, served.tracks[1]!.lanes[0]!.backing.sample, 'still the last render it had')
    assert.equal(after.tracks[0]!.notes.length, 3, 'and the edit itself landed on the surge track')
  })
})

test('a project with no cached render at all serves the document unchanged (and stays usable)', async () => {
  await withSurgeDaemon(
    async ({ document, filePath }) => {
      const served = await document()
      assert.deepEqual(
        served.tracks.map((t) => t.id),
        ['melody'],
        'no render, no companion — the GUI gets exactly what it got before this existed',
      )
      assert.equal(parse(readFileSync(filePath, 'utf8')).tracks.length, 1)
    },
    { seed: false },
  )
})
