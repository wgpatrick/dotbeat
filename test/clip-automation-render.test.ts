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
// The second half decodes golden WAVs rendered by the FIXED engine (test/fixtures/clip-automation/
// *.wav, committed through git-lfs per D11) with src/metrics and asserts the actual measured
// render — so `node --test` asserts real rendered audio too, not just the document shape.
//
// Wave-0 gate W0.1 (docs/research/130 §3; review R6-2). Until this commit the four goldens were
// never committed and the rendered-audio assertions carried `{ skip: !haveGolden }`, so on every
// clean checkout `npm test` SILENTLY SKIPPED the two assertions written for the exact bug above —
// "the regression fixture the brief names as a gate is, today, asserting nothing about audio."
// Worse, the skip message told you to run `ui/verify-clip-automation-render.mjs`, which measures
// in memory and writes no WAV at all: the goldens it named could never have been produced that
// way. A skip that reads as a pass is worse than no test, so a missing/unfetched golden now FAILS
// LOUDLY with the real regenerate command (REGENERATE below).
//
// What the committed goldens do and do not gate, stated honestly: they pin the measured render of
// a known-good engine, so they catch a corrupted or wrongly-regenerated golden immediately, and
// they make the regenerate step a required, visible part of any engine change — re-render after
// touching the tick/automation path and these thresholds are what tell you whether the sound moved.
// The live end-to-end check (drive the real browser engine and measure what it plays right now)
// remains ui/verify-clip-automation-render.mjs.

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

// ---- rendered-audio assertions (against the committed golden WAVs) ------------------------------

const GOLDENS = ['vol-auto', 'vol-static', 'cutoff-auto', 'cutoff-static'] as const

/** The command that produced the committed goldens — printed by every failure below so the fix is
 * always one copy-paste away. Offline compute through the engine (~0.2s each) rather than realtime
 * capture: exact, no recorder spin-up, no opus round-trip, and a single render is never
 * loudness-normalized (cli/render.mjs), which the -60dB volume case depends on. */
const REGENERATE = [
  'regenerate with:',
  '  npm run build && (cd ui && npm run build)',
  "  for n in vol-auto vol-static cutoff-auto cutoff-static; do \\",
  '    node cli/render.mjs test/fixtures/clip-automation/$n.beat -o test/fixtures/clip-automation/$n.wav --offline; \\',
  '  done',
].join('\n')

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

/** Reads a committed golden, failing LOUDLY (never skipping) on the three ways it can be absent:
 * never rendered, fetched as an unresolved git-lfs pointer, or truncated/not a RIFF WAV. */
function readGolden(name: string): Uint8Array {
  const path = wavPath(name)
  if (!existsSync(path)) {
    assert.fail(`missing golden WAV ${name}.wav — the rendered-audio regression gate cannot run.\nThis is a FAILURE, not a skip (review R6-2: a skip that reads as a pass is worse than no test).\n${REGENERATE}`)
  }
  const bytes = new Uint8Array(readFileSync(path))
  const head = Buffer.from(bytes.subarray(0, 64)).toString('utf8')
  if (head.startsWith('version https://git-lfs')) {
    assert.fail(`golden WAV ${name}.wav is an unresolved git-lfs pointer, not audio (*.wav goes through lfs per D11/.gitattributes).\nFetch it with:  git lfs pull\n${REGENERATE}`)
  }
  if (!head.startsWith('RIFF')) {
    assert.fail(`golden WAV ${name}.wav is not a RIFF WAV (${bytes.length} bytes) — corrupted or partially written.\n${REGENERATE}`)
  }
  return bytes
}
const decode = (name: string) => decodeWav(readGolden(name))

test('golden WAVs: all four are present, decodable, and the right shape', () => {
  // Runs first so a missing/unfetched golden reports ONCE with the regenerate command, rather than
  // as two confusing decode failures further down.
  for (const name of GOLDENS) {
    const wav = decode(name)
    assert.equal(wav.sampleRate, 44100, `${name}.wav: unexpected sample rate`)
    assert.equal(wav.channels.length, 2, `${name}.wav: expected stereo`)
    const seconds = wav.channels[0]!.length / wav.sampleRate
    // Every fixture is one bar at 120bpm = 2.00s; a golden much shorter than that would make the
    // RMS window (which skips the first 0.4s) meaningless rather than failing outright.
    assert.ok(Math.abs(seconds - 2) < 0.25, `${name}.wav: expected ~2.00s of audio, got ${seconds.toFixed(3)}s\n${REGENERATE}`)
  }
})

// Threshold provenance (measured 2026-07-25 on the committed goldens, rendered offline through the
// FIXED engine): vol-auto -77.3 dBFS vs vol-static -16.6 dBFS => 60.7dB of attenuation, and the two
// cutoff takes matched to 0.0dB. The guards below sit far outside those margins on purpose — they
// are catching the pre-fix behaviour (~4.6dB of attenuation; the automated take ~10dB LOUDER),
// not policing render-to-render noise.
test('rendered golden WAVs: automated -60dB volume lane is near-silent vs the static-0dB control', () => {
  const autoDb = rmsDb(decode('vol-auto'))
  const staticDb = rmsDb(decode('vol-static'))
  assert.ok(staticDb - autoDb > 40, `automated -60dB lane should attenuate >40dB below the static control (got ${(staticDb - autoDb).toFixed(1)}dB; pre-fix ~4.6dB)`)
  assert.ok(autoDb < -50, `automated -60dB lane render should be near-silent (got ${autoDb.toFixed(1)}dBFS)`)
})

test('rendered golden WAVs: automated 150Hz cutoff renders within tolerance of the static-150Hz control', () => {
  const autoDb = rmsDb(decode('cutoff-auto'))
  const staticDb = rmsDb(decode('cutoff-static'))
  assert.ok(Math.abs(autoDb - staticDb) < 4, `automated 150Hz cutoff should render within 4dB of the static 150Hz control (got ${(autoDb - staticDb).toFixed(1)}dB; pre-fix ~+10dB)`)
})
