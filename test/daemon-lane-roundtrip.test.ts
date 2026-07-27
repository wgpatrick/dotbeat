// GET /doc → POST /state must not destroy what the document says (Phase 41 Stream B / B1).
//
// The read path was the asymmetry: the daemon's WRITE path has carried `laneSamples` across a GUI
// push since v0.5 with a comment saying a push must never erase them, but the READ path only ever
// emitted the legacy 5-lane 16-step `pattern` — a lossy VIEW that snaps off-grid starts to the
// nearest 16th and drops every hit on a lane outside the closed DRUM_LANES set. A consumer that
// pulled /doc and pushed the same payload back therefore flattened any custom kit to five empty
// lanes, and `droppedFields` reported `[]` while it happened. Measured by the Phase 41 CLI pilot on
// a real surge project; reproduced here on the smallest document that shows it.
//
// The fix has two halves, and both are asserted below:
//   - convert.ts emits `lanes`/`hits` (and takes them back) alongside `pattern` — a payload that
//     round-trips through this daemon is lossless.
//   - daemon.ts never-erases `lanes`/`hits` for a payload that OMITS them — a legacy BeatLab client
//     cannot express an open lane, so its all-zero pattern for a custom kit is the absence of a
//     concept, not an edit.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from '../src/core/index.js'
import { startDaemon, type Daemon } from '../src/daemon/daemon.js'

const SHA = 'a'.repeat(64)

/** One custom-lane (open model) drum track and one legacy 5-lane track, each carrying something
 * the 16-step grid cannot express: a sample-backed lane named `clave` with a hit at step 3.5, and
 * a legacy kick laneSample with an off-grid hit at 6.25 in bar 2 (step 22.25, which the grid folds
 * to step 6 of bar 1). */
const DOC_TEXT = `format_version 0.11
bpm 120
loop_bars 2
selected_track kit

media
  sample clave-1 sha256:${SHA} media/clave.wav
  sample kick-909 sha256:${'b'.repeat(64)} media/kick.wav

track kit Kit #e06c75 drums
  synth
    osc sawtooth
    volume -10
    cutoff 12000
    resonance 0.1
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
  lane clave sample clave-1 -3 2
  lane thump synth:membrane tune=30
  hit h1 clave 3.5 0.8
  hit h2 thump 0 0.9
  hit h3 clave 11.25 0.55

track legacy Legacy #61afef drums
  synth
    osc sawtooth
    volume -8
    cutoff 12000
    resonance 0.1
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
  lane kick kick-909 -2 0
  hit g1 kick 22.25 0.7
  hit g2 snare 4 0.6
`

interface PartialDocTrack {
  id: string
  lanes?: unknown
  hits?: unknown
  laneSamples?: unknown
  pattern?: Record<string, number[]>
}
interface PartialDocPayload {
  bpm: number
  tracks: PartialDocTrack[]
}
interface PushResult {
  status: number
  body: { written?: boolean; report?: { droppedFields: string[] }; error?: string }
}
interface Ctx {
  daemon: Daemon
  filePath: string
  doc: () => Promise<PartialDocPayload>
  text: () => string
  push: (p: unknown) => Promise<PushResult>
}

async function withDaemon(fn: (ctx: Ctx) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'beat-lane-roundtrip-'))
  const filePath = join(dir, 'song.beat')
  writeFileSync(filePath, DOC_TEXT)
  const daemon = await startDaemon({ filePath, port: 0 })
  const base = `http://127.0.0.1:${daemon.port}`
  try {
    await fn({
      daemon,
      filePath,
      doc: async () => (await (await fetch(`${base}/doc`)).json()) as PartialDocPayload,
      text: () => readFileSync(filePath, 'utf8'),
      push: async (p) => {
        const res = await fetch(`${base}/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) })
        return { status: res.status, body: (await res.json()) as PushResult['body'] }
      },
    })
  } finally {
    await daemon.close()
  }
}

test('the fixture itself carries what the 16-step grid cannot express', () => {
  const doc = parse(DOC_TEXT)
  const kit = doc.tracks.find((t) => t.id === 'kit')!
  assert.equal(kit.lanes.length, 2, 'two declared lanes, neither of them a DRUM_LANES name')
  assert.equal(kit.hits.find((h) => h.id === 'h1')!.start, 3.5, 'and a free-timed hit on one of them')
  assert.deepEqual(doc.tracks.find((t) => t.id === 'legacy')!.laneSamples.kick, { sample: 'kick-909', gainDb: -2, tune: 0 })
})

test('GET /doc carries lanes, hits and laneSamples alongside the legacy 16-step pattern', async () => {
  await withDaemon(async ({ doc }) => {
    const body = await doc()
    const kit = body.tracks.find((t) => t.id === 'kit')!
    assert.ok(kit.pattern, 'the legacy grid is still there for BeatLab-bridge consumers')
    assert.deepEqual(
      kit.lanes,
      [
        { name: 'clave', backing: { type: 'sample', sample: 'clave-1', gainDb: -3, tune: 2, params: {}, filterType: 'lowpass', effects: [] } },
        { name: 'thump', backing: { type: 'synth', voice: 'membrane', params: { tune: 30 } } },
      ],
      'the open lane declarations ride along verbatim',
    )
    assert.deepEqual(
      kit.hits,
      [
        { id: 'h1', lane: 'clave', start: 3.5, velocity: 0.8 },
        { id: 'h2', lane: 'thump', start: 0, velocity: 0.9 },
        { id: 'h3', lane: 'clave', start: 11.25, velocity: 0.55 },
      ],
      'and so do the free-timed hits the grid snaps and drops',
    )
    // The lossy view is exactly as lossy as it always was — this is a VIEW, not the truth.
    assert.deepEqual(kit.pattern!.kick, Array<number>(16).fill(0), 'no custom-lane hit has a cell in the 5-lane grid')
    const legacy = body.tracks.find((t) => t.id === 'legacy')!
    assert.deepEqual(legacy.laneSamples, { kick: { sample: 'kick-909', gainDb: -2, tune: 0 } })
    assert.equal((legacy.hits as { start: number }[])[0]!.start, 22.25, 'off-grid, past bar 1 — the grid would fold it to step 6')
  })
})

test('a /doc payload pushed straight back to /state is a no-op: nothing is written, nothing is dropped', async () => {
  await withDaemon(async ({ doc, push, text }) => {
    const before = text()
    const payload = await doc()
    const res = await push(payload)
    assert.equal(res.status, 200)
    assert.equal(res.body.written, false, 'identical music → identical canonical bytes → no write')
    assert.deepEqual(res.body.report!.droppedFields, [])
    assert.equal(text(), before, 'and the file is byte-identical')
  })
})

test('a /doc → /state round trip that DOES change one thing changes only that thing', async () => {
  await withDaemon(async ({ doc, push, text }) => {
    const payload = await doc()
    payload.bpm = 126
    const res = await push(payload)
    assert.equal(res.body.written, true)
    const after = parse(text())
    assert.equal(after.bpm, 126)
    const kit = after.tracks.find((t) => t.id === 'kit')!
    assert.equal(kit.lanes.length, 2, 'the custom kit survived the push')
    assert.deepEqual(
      kit.hits.map((h) => `${h.lane}@${h.start}`),
      ['thump@0', 'clave@3.5', 'clave@11.25'],
      'with its free timing intact',
    )
    assert.deepEqual(after.tracks.find((t) => t.id === 'legacy')!.hits.find((h) => h.id === 'g1')!.start, 22.25)
  })
})

test('a legacy client that cannot express open lanes (no lanes/hits fields) never erases them', async () => {
  await withDaemon(async ({ doc, push, text }) => {
    const payload = await doc()
    // Exactly what a real BeatLab sandbox payload looks like: the 5-lane grid and nothing else.
    for (const t of payload.tracks) {
      delete t.lanes
      delete t.hits
      delete t.laneSamples
    }
    payload.bpm = 130
    const res = await push(payload)
    assert.equal(res.body.written, true, 'the bpm edit still lands')
    const after = parse(text())
    assert.equal(after.bpm, 130)
    const kit = after.tracks.find((t) => t.id === 'kit')!
    assert.equal(kit.lanes.length, 2, 'the declarations are carried, not flattened to the 5-lane grid')
    assert.equal(kit.hits.length, 3, 'and so are the hits that name them — carrying one without the other writes a file the parser rejects')
    assert.deepEqual(after.tracks.find((t) => t.id === 'legacy')!.laneSamples.kick, { sample: 'kick-909', gainDb: -2, tune: 0 })
  })
})

test('a legacy client CAN still edit a plain 5-lane track through the grid', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-lane-roundtrip-plain-'))
  const filePath = join(dir, 'song.beat')
  writeFileSync(
    filePath,
    `format_version 0.11
bpm 120
loop_bars 1
selected_track plain

track plain Plain #e06c75 drums
  synth
    osc sawtooth
    volume -10
    cutoff 12000
    resonance 0.1
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
  hit p1 kick 0 0.9
`,
  )
  const daemon = await startDaemon({ filePath, port: 0 })
  try {
    const base = `http://127.0.0.1:${daemon.port}`
    const payload = (await (await fetch(`${base}/doc`)).json()) as PartialDocPayload
    const track = payload.tracks[0]!
    delete track.lanes
    delete track.hits // a grid-only client: the pattern is the whole truth for this track
    track.pattern!.snare![4] = 0.7
    const res = await fetch(`${base}/state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    assert.equal(((await res.json()) as PushResult['body']).written, true)
    const after = parse(readFileSync(filePath, 'utf8'))
    assert.deepEqual(
      after.tracks[0]!.hits.map((h) => `${h.lane}@${h.start}`),
      ['kick@0', 'snare@4'],
      'a track with no declared lanes still round-trips through the grid exactly as before',
    )
  } finally {
    await daemon.close()
  }
})
