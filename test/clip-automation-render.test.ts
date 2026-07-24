// Clip-automation render regression — data-contract half (node --test, headless).
//
// The engine bug fixed alongside these fixtures (ui/src/audio/engine.ts, "fix(engine): clip
// automation lanes now win over static patch values on render"): applyParams() re-asserted the
// STATIC patch value for every automatable param on every 16th-note tick, clobbering the drawn
// automation curve — a -60dB volume lane rendered at only ~-4.6dB of attenuation; an automated
// 150Hz cutoff read ~10dB LOUDER than the identical static-150Hz control.
//
// The engine lives in ui/ (a standalone Vite app that can't be imported here and needs a browser
// AudioContext), so the RENDER assertion runs in ui/verify-clip-automation-render.mjs — the same
// split every other engine-audio check in this repo uses (see ui/verify-phase26-stream-da.mjs, the
// sibling automation-vs-LFO bug). THIS file guards the shared source of truth those renders consume:
// that the committed fixtures still parse into a document whose clip automation is wired to actually
// PLAY (song + scene + slot) and whose lanes hold the exact target values the render assertions
// depend on. A fixture that silently stopped mapping its clip, or drifted off -60dB/150Hz, would
// make the render checks vacuous — these tests fail loudly if that happens.
//
// When golden WAVs rendered by the FIXED engine are present next to the fixtures
// (test/fixtures/clip-automation/*.wav, produced by the verify script), the second half of this
// file decodes them with src/metrics and asserts the actual measured render — so `node --test`
// asserts real rendered audio too, not just the document shape.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '../src/core/index.js'
import { decodeWav } from '../src/metrics/index.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures', 'clip-automation')
const load = (name: string) => parse(readFileSync(join(fixturesDir, `${name}.beat`), 'utf8'))

// A fixture's clip automation only PLAYS in song mode: contentOf() reads lanes off the clip the
// active scene maps into the track's slot. Assert every fixture is wired that way (one section, one
// scene, the scene's slot points the track at the drone clip) — the precondition the render depends
// on, easy to break silently by editing a fixture.
function assertPlayableWiring(name: string) {
  const doc = load(name)
  assert.ok(doc.song, `${name}: expected song mode (clip automation only plays in song mode)`)
  assert.equal(doc.song.length, 1, `${name}: expected exactly one song section`)
  assert.equal(doc.scenes.length, 1, `${name}: expected exactly one scene`)
  const track = doc.tracks[0]!
  const sceneId = doc.song[0]!.scene
  const scene = doc.scenes.find((s) => s.id === sceneId)!
  assert.ok(scene, `${name}: song references a scene that exists`)
  const slot = scene.slots[track.id]
  assert.ok(slot && slot.length > 0, `${name}: scene maps the track's slot`)
  const clipId = slot[0]!.clip
  assert.ok(track.clips.some((c) => c.id === clipId), `${name}: slot points at a real clip on the track`)
  return { doc, track, clip: track.clips.find((c) => c.id === clipId)! }
}

test('vol-auto: volume lane held at -60dB, wired to play, static patch volume 0', () => {
  const { track, clip } = assertPlayableWiring('vol-auto')
  assert.equal(track.synth.volume, 0, 'static patch volume is the loud 0dB the lane must override')
  const lanes = clip.automation
  assert.equal(lanes.length, 1)
  assert.equal(lanes[0]!.param, 'volume')
  assert.ok(lanes[0]!.points.length >= 2)
  for (const p of lanes[0]!.points) assert.equal(p.value, -60, 'every volume point is held at -60dB')
})

test('vol-static: control has no automation lanes and a static 0dB volume', () => {
  const { track, clip } = assertPlayableWiring('vol-static')
  assert.equal(clip.automation.length, 0, 'control carries no lanes')
  assert.equal(track.synth.volume, 0)
})

test('cutoff-auto: cutoff lane held at 150Hz over a wide-open 12kHz static patch cutoff', () => {
  const { track, clip } = assertPlayableWiring('cutoff-auto')
  assert.equal(track.synth.cutoff, 12000, 'static patch cutoff is wide open so the lane must do the closing')
  const lanes = clip.automation
  assert.equal(lanes.length, 1)
  assert.equal(lanes[0]!.param, 'cutoff')
  assert.ok(lanes[0]!.points.length >= 2)
  for (const p of lanes[0]!.points) assert.equal(p.value, 150, 'every cutoff point is held at 150Hz')
})

test('cutoff-static: control has no lanes and a static 150Hz patch cutoff matching the automated target', () => {
  const { track, clip } = assertPlayableWiring('cutoff-static')
  assert.equal(clip.automation.length, 0)
  assert.equal(track.synth.cutoff, 150, 'static cutoff equals the automated lane target — the two renders must match')
})

// ---- rendered-audio assertions (present once the verify script has written golden WAVs) ----------
// dBFS RMS of a decoded WAV, skipping the first `skipSec` (graph settle + note attack).
function rmsDb(wav: { channels: Float64Array[]; sampleRate: number }, skipSec = 0.4): number {
  const i0 = Math.min(wav.channels[0]!.length, Math.floor(skipSec * wav.sampleRate))
  let sumSq = 0
  let count = 0
  for (const ch of wav.channels) {
    for (let i = i0; i < ch.length; i++) { sumSq += ch[i]! * ch[i]!; count++ }
  }
  const rms = Math.sqrt(sumSq / Math.max(1, count))
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity
}
const wavPath = (name: string) => join(fixturesDir, `${name}.wav`)
const haveGolden = ['vol-auto', 'vol-static', 'cutoff-auto', 'cutoff-static'].every((n) => existsSync(wavPath(n)))
const decode = (name: string) => decodeWav(new Uint8Array(readFileSync(wavPath(name))))

test('rendered golden WAVs: automated -60dB volume lane is near-silent vs the static-0dB control', { skip: !haveGolden && 'golden WAVs not rendered (run ui/verify-clip-automation-render.mjs)' }, () => {
  const autoDb = rmsDb(decode('vol-auto'))
  const staticDb = rmsDb(decode('vol-static'))
  assert.ok(staticDb - autoDb > 40, `automated -60dB lane should attenuate >40dB below the static control (got ${(staticDb - autoDb).toFixed(1)}dB; pre-fix ~4.6dB)`)
  assert.ok(autoDb < -50, `automated -60dB lane render should be near-silent (got ${autoDb.toFixed(1)}dBFS)`)
})

test('rendered golden WAVs: automated 150Hz cutoff renders within tolerance of the static-150Hz control', { skip: !haveGolden && 'golden WAVs not rendered (run ui/verify-clip-automation-render.mjs)' }, () => {
  const autoDb = rmsDb(decode('cutoff-auto'))
  const staticDb = rmsDb(decode('cutoff-static'))
  assert.ok(Math.abs(autoDb - staticDb) < 4, `automated 150Hz cutoff should render within 4dB of the static 150Hz control (got ${(autoDb - staticDb).toFixed(1)}dB; pre-fix ~+10dB)`)
})
