// Track 1a: the surge RENDER prep (cli/surge-render-prep.mjs) — the cache-or-sidecar desugar step
// cli/render.mjs runs before the engine boots. Two things are checked here:
//
//   1. The "sidecar unavailable at render" error path — CI-SAFE. With no usable Python interpreter,
//      prep MUST throw a loud, actionable error (never silently render silence). This is the
//      render-time half of the contract: a surge .beat PARSES anywhere (surge-track.test.ts), but a
//      RENDER without surgepy fails loudly.
//   2. The full prep (patch resolution + real render + cache + provenance + desugar to a sample
//      host) — GATED on a real surgepy build + SURGE_DATA_HOME, exactly like surge-sidecar.test.ts.
//      Skips everywhere it can't run.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { surgeDoctor, surgeAvailable } from '../src/analysis/surge.js'

// npm test runs `node --test dist/test/*.test.js` from the repo root, so the CLI module resolves
// relative to cwd (it is not compiled into dist — it is a .mjs the CLI imports at runtime).
const prepUrl = pathToFileURL(join(process.cwd(), 'cli/surge-render-prep.mjs')).href

const SURGE_BEAT = `format_version 0.11
bpm 120
loop_bars 1
selected_track lead

track lead Lead #e06c75 surge
  surge
    patch "Init Saw"
  synth
    osc sawtooth
    volume -8
    cutoff 2000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
  note u1 60 0 4 0.8
`

let hasSurgepy = false
try {
  execFileSync('python3', ['--version'], { stdio: 'ignore' })
  hasSurgepy = surgeAvailable(await surgeDoctor())
} catch {
  hasSurgepy = false
}

test('prep: no surge tracks -> passes the path through untouched (no render, no scratch)', async () => {
  const { prepareSurgeTracks } = await import(prepUrl)
  const dir = mkdtempSync(join(tmpdir(), 'surge-prep-'))
  try {
    const p = join(dir, 'plain.beat')
    writeFileSync(p, `format_version 0.11
bpm 120
loop_bars 1
selected_track a

track a A #e06c75 synth
  synth
    osc sawtooth
    volume -10
    cutoff 2000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
  note u1 60 0 4 0.8
`)
    const r = await prepareSurgeTracks(p)
    assert.equal(r.isSurge, false)
    assert.equal(r.beatPath, p, 'a doc with no surge tracks is returned unchanged')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('prep: a surge track fails LOUDLY at render when surgepy is unavailable (never silent)', { skip: hasSurgepy }, async () => {
  // Force an unusable interpreter so the catalogue listing (and therefore prep) fails the way it
  // would on any machine without a Surge build — the point of the whole out-of-process posture.
  const prev = process.env.BEAT_PYTHON
  process.env.BEAT_PYTHON = join(tmpdir(), 'definitely-not-a-python-interpreter-xyz')
  const { prepareSurgeTracks } = await import(prepUrl)
  const dir = mkdtempSync(join(tmpdir(), 'surge-prep-'))
  try {
    const p = join(dir, 'surge.beat')
    writeFileSync(p, SURGE_BEAT)
    await assert.rejects(() => prepareSurgeTracks(p), (err: Error) => /surge render prep failed|surgepy|Surge/i.test(err.message))
  } finally {
    if (prev === undefined) delete process.env.BEAT_PYTHON
    else process.env.BEAT_PYTHON = prev
    rmSync(dir, { recursive: true, force: true })
  }
})

test('prep: renders a surge track to a cached WAV + provenance and desugars to a sample host', { skip: !hasSurgepy }, async () => {
  const { prepareSurgeTracks } = await import(prepUrl)
  const { parse } = await import('../src/core/index.js')
  const dir = mkdtempSync(join(tmpdir(), 'surge-prep-'))
  try {
    const p = join(dir, 'surge.beat')
    writeFileSync(p, SURGE_BEAT)
    const r = await prepareSurgeTracks(p)
    assert.equal(r.isSurge, true)
    assert.ok(existsSync(r.beatPath), 'a rewritten scratch .beat was written')

    // the scratch is a valid doc whose surge track is now a drums-kind sample host
    const doc = parse(readFileSync(r.beatPath, 'utf8'))
    const host = doc.tracks.find((t) => t.id === 'lead')!
    assert.equal(host.kind, 'drums', 'the surge track desugars to a drums-kind host')
    assert.equal(host.synth.volume, -8, 'production (volume) is preserved from the surge track')
    assert.equal(host.hits.length, 1, 'one hit plays the rendered phrase once')
    const lane = host.lanes[0]!
    assert.equal(lane.backing.type, 'sample')

    // the rendered WAV + provenance sidecar landed under media/ and the media block references it
    const media = doc.media.find((m) => (lane.backing as { sample: string }).sample === m.id)!
    const wavPath = join(dir, media.path)
    assert.ok(existsSync(wavPath), 'the surge render WAV exists under media/')
    assert.ok(existsSync(`${wavPath}.json`), 'a provenance sidecar sits beside it')
    const prov = JSON.parse(readFileSync(`${wavPath}.json`, 'utf8'))
    assert.equal(prov.patch, 'Init Saw')
    assert.ok(typeof prov.hash === 'string' && prov.hash.length === 64)

    // a second prep is a cache hit (same doc -> same audio; regen determinism)
    const r2 = await prepareSurgeTracks(p)
    assert.match(r2.info, /cache hit/)
    r.cleanup()
    r2.cleanup()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
