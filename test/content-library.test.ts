// Phase 22 Stream AH — the content-browser sidebar's daemon surface (docs/phase-22-plan.md's AH,
// docs/research/18-ableton-ui-architecture.md §8). Exercises the five new routes against the REAL
// `presets/` tree (factory.json, kit-init/kit-audiophob, sf2/*.sf2) — the same content the CLI's
// `beat presets`/Phase 18 Stream S's taxonomy already reads — rather than a synthetic fixture, so a
// stale/renamed preset or kit would fail this suite the same way it'd break the CLI.

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { initDocument, addTrack, serialize, type BeatDocument } from '../src/core/index.js'
import { startDaemon, type Daemon } from '../src/daemon/daemon.js'

/** A small project with one of each track kind — drums (for install-kit), a synth (for
 * apply-preset), and an instrument track pointed at a throwaway media id (for install-soundfont's
 * "reassign an existing track" branch; the sample id itself is never read until a note plays). */
function baseDoc(): BeatDocument {
  let doc = initDocument({ trackId: 'lead' })
  doc = addTrack(doc, { id: 'drums', kind: 'drums' }).doc
  doc = { ...doc, media: [{ id: 'placeholder', sha256: 'a'.repeat(64), path: 'media/placeholder.sf2' }] }
  doc = addTrack(doc, { id: 'keys', kind: 'instrument', soundfont: { sample: 'placeholder', program: 0 } }).doc
  return doc
}

async function withDaemon(fn: (daemon: Daemon, filePath: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'beat-daemon-library-test-'))
  const filePath = join(dir, 'song.beat')
  writeFileSync(filePath, serialize(baseDoc()))
  const daemon = await startDaemon({ filePath, port: 0 })
  try {
    await fn(daemon, filePath)
  } finally {
    await daemon.close()
  }
}

test('GET /library serves the real factory presets, kits, and soundfonts', async () => {
  await withDaemon(async (daemon) => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/library`)
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      presets: { name: string; kind: string; category: string }[]
      categories: string[]
      kits: { id: string; lanes: { lane: string; file: string }[] }[]
      soundfonts: { file: string }[]
    }
    assert.equal(body.presets.length, 36) // Phase 18 Stream S's factory library size
    assert.ok(body.presets.some((p) => p.name === 'deep-sub-bass' && p.category === 'bass'))
    assert.ok(body.categories.includes('bass') && body.categories.includes('808-trap'))
    const kitIds = body.kits.map((k) => k.id).sort()
    assert.deepEqual(kitIds, ['kit-audiophob', 'kit-init'])
    for (const kit of body.kits) assert.deepEqual(kit.lanes.map((l) => l.lane).sort(), ['clap', 'hat', 'kick', 'openhat', 'snare'])
    const sfFiles = body.soundfonts.map((s) => s.file).sort()
    assert.deepEqual(sfFiles, ['fluidr3-gm-small.sf2', 'muldjordkit-small.sf2', 'upright-piano-kw-small.sf2'])
  })
})

test('GET /library?category= filters, the same taxonomy `beat presets --category` uses', async () => {
  await withDaemon(async (daemon) => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/library?category=bass`)
    const body = (await res.json()) as { presets: { name: string; category: string }[] }
    assert.ok(body.presets.length > 0)
    assert.ok(body.presets.every((p) => p.category === 'bass'))
  })
})

test('GET /library?category=bogus fails loudly', async () => {
  await withDaemon(async (daemon) => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/library?category=bogus`)
    assert.equal(res.status, 400)
  })
})

test('GET /library/file serves a real kit one-shot and refuses to escape the library', async () => {
  await withDaemon(async (daemon) => {
    const ok = await fetch(`http://127.0.0.1:${daemon.port}/library/file?path=kit-init/kick.wav`)
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('content-type'), 'audio/wav')
    const bytes = new Uint8Array(await ok.arrayBuffer())
    assert.ok(bytes.length > 100)

    const escape = await fetch(`http://127.0.0.1:${daemon.port}/library/file?path=../package.json`)
    assert.equal(escape.status, 400)

    const missing = await fetch(`http://127.0.0.1:${daemon.port}/library/file?path=kit-init/nope.wav`)
    assert.equal(missing.status, 404)
  })
})

test('POST /library/apply-preset writes the preset params as a normal edit list (no reference)', async () => {
  await withDaemon(async (daemon, filePath) => {
    const before = readFileSync(filePath, 'utf8')
    const res = await fetch(`http://127.0.0.1:${daemon.port}/library/apply-preset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'lead', name: 'deep-sub-bass' }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { written: boolean; doc: { tracks: { id: string; synth: { subLevel: number; osc2Type: string; glide: number } }[] } }
    assert.equal(body.written, true)
    const leadTrack = body.doc.tracks.find((t) => t.id === 'lead')!
    // deep-sub-bass's own params (presets/factory.json) — literal values, not a name/reference
    assert.equal(leadTrack.synth.subLevel, 0.6)
    assert.equal(leadTrack.synth.osc2Type, 'square')
    assert.equal(leadTrack.synth.glide, 0.02)
    const after = readFileSync(filePath, 'utf8')
    assert.notEqual(after, before)
    // landed as ordinary `<field> <value>` lines inside the track's synth block — no `preset`
    // keyword or preset-name token anywhere in the grammar (format-spec.md: presets are tooling,
    // not grammar; the file never spells out which preset produced these values).
    assert.ok(!/\bpreset\b/.test(after))
    assert.ok(after.split('\n').some((l) => l.trim() === 'subLevel 0.6'))
  })
})

test('POST /library/apply-preset rejects a kind mismatch (a drums preset on a synth track) with 400, no write', async () => {
  await withDaemon(async (daemon, filePath) => {
    const before = readFileSync(filePath, 'utf8')
    const res = await fetch(`http://127.0.0.1:${daemon.port}/library/apply-preset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'lead', name: 'driving-kit' }), // a drums preset
    })
    assert.equal(res.status, 400)
    assert.equal(readFileSync(filePath, 'utf8'), before)
  })
})

test('POST /library/install-kit registers and assigns every lane of a kit to the drum track', async () => {
  await withDaemon(async (daemon, filePath) => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/library/install-kit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'drums', kit: 'kit-init' }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      written: boolean
      doc: { media: { id: string; path: string; sha256: string }[]; tracks: { id: string; laneSamples: Record<string, { sample: string }> }[] }
    }
    assert.equal(body.written, true)
    const drumsTrack = body.doc.tracks.find((t) => t.id === 'drums')!
    for (const lane of ['kick', 'snare', 'clap', 'hat', 'openhat']) {
      assert.equal(drumsTrack.laneSamples[lane]?.sample, `kit-init-${lane}`)
    }
    // the wav actually landed in the PROJECT's own media/ dir, content-addressed, not referenced
    // by its presets/ path
    const kickMedia = body.doc.media.find((m) => m.id === 'kit-init-kick')!
    assert.equal(kickMedia.path, 'media/kit-init-kick.wav')
    assert.ok(!kickMedia.path.includes('presets/'))
    assert.ok(/^[0-9a-f]{64}$/.test(kickMedia.sha256))
    const dir = join(filePath, '..')
    assert.ok(existsSync(join(dir, 'media', 'kit-init-kick.wav')))
  })
})

test('POST /library/install-kit with lane+targetLane drops one sample onto a different lane', async () => {
  await withDaemon(async (daemon) => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/library/install-kit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'drums', kit: 'kit-audiophob', lane: 'clap', targetLane: 'snare' }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { doc: { tracks: { id: string; laneSamples: Record<string, { sample: string }> }[] } }
    const drumsTrack = body.doc.tracks.find((t) => t.id === 'drums')!
    assert.equal(drumsTrack.laneSamples.snare?.sample, 'kit-audiophob-clap')
    assert.equal(drumsTrack.laneSamples.kick, undefined) // untouched
  })
})

test('POST /library/install-kit rejects a track that is not a drum track', async () => {
  await withDaemon(async (daemon, filePath) => {
    const before = readFileSync(filePath, 'utf8')
    const res = await fetch(`http://127.0.0.1:${daemon.port}/library/install-kit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'lead', kit: 'kit-init' }),
    })
    assert.equal(res.status, 400)
    assert.equal(readFileSync(filePath, 'utf8'), before)
  })
})

test('POST /library/install-soundfont reassigns an existing instrument track', async () => {
  await withDaemon(async (daemon) => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/library/install-soundfont`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'keys', file: 'upright-piano-kw-small.sf2', program: 0 }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { doc: { tracks: { id: string; instrument?: { sample: string; program: number } }[] } }
    const keys = body.doc.tracks.find((t) => t.id === 'keys')!
    assert.equal(keys.instrument?.sample, 'upright-piano-kw-small')
    assert.equal(keys.instrument?.program, 0)
  })
})

test('POST /library/install-soundfont with no track mints a brand new instrument track', async () => {
  await withDaemon(async (daemon) => {
    const before = (await (await fetch(`http://127.0.0.1:${daemon.port}/library`)).json()) // warm, unrelated
    void before
    const res = await fetch(`http://127.0.0.1:${daemon.port}/library/install-soundfont`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'fluidr3-gm-small.sf2' }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { doc: { tracks: { id: string; kind: string; instrument?: { sample: string } }[] } }
    const created = body.doc.tracks.find((t) => t.kind === 'instrument' && t.instrument?.sample === 'fluidr3-gm-small')
    assert.ok(created, `expected a new instrument track carrying fluidr3-gm-small; tracks: ${JSON.stringify(body.doc.tracks.map((t) => t.id))}`)
  })
})

test('POST /library/install-soundfont rejects an unknown file', async () => {
  await withDaemon(async (daemon) => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/library/install-soundfont`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'keys', file: 'nope.sf2' }),
    })
    assert.equal(res.status, 404)
  })
})
