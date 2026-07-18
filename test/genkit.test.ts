// `beat gen-kit` — one command that composes a playable .beat project entirely from generated
// sounds (docs/gen-kit-pipeline.md). Two halves under test:
//
//   1. The PURE half (src/analysis/genkit.ts): role parsing, style-contrast prompts, the pick
//      heuristics (centroid for drums, pitch confidence for tonal), the keymap span arithmetic
//      (always inside the ±24 lane-tune clamp), and the seeded pattern plans — all deterministic,
//      no audio, no I/O.
//   2. The PIPELINE (cli gen-kit, stub backend, gated on python3 like gen-batch.test.ts): one run
//      must yield a normal, renderable, regen-able project — exactly one registered sample per
//      role, per-role batch dirs (group genkit:<role>) whose losers never touched the media
//      block, keymapped tonal tracks, and every track SCENE-PLACED (song mode renders only
//      scene-placed content — the Phase 39 silent-render trap gen-kit must never re-open).

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  GENKIT_ROLES,
  parseGenKitRoles,
  genkitPrompts,
  pickDrumCandidate,
  pickTonalCandidate,
  keymapSpanForRoot,
  planDrumHits,
  planBassHits,
  planLeadHits,
} from '../src/analysis/genkit.js'
import type { PitchDetection } from '../src/analysis/pitch.js'
import { parse, unplacedContentTracks } from '../src/core/index.js'
import { readBatchManifest } from '../src/vary/batch.js'
import { variantTypeOf } from '../src/taste/eval.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

let hasPython = false
try {
  execFileSync('python3', ['--version'], { stdio: 'ignore' })
  hasPython = true
} catch {
  hasPython = false
}

function beat(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' }), stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

// ---- the pure half ----------------------------------------------------------------------------

test('parseGenKitRoles: defaults to all six roles in build order; subsets keep build order; unknowns error', () => {
  assert.deepEqual(parseGenKitRoles().map((s) => s.role), ['kick', 'snare', 'hats', 'perc', 'bass', 'lead'])
  // flag order does not reorder the build — bass always builds after the drums
  assert.deepEqual(parseGenKitRoles('bass,kick').map((s) => s.role), ['kick', 'bass'])
  assert.throws(() => parseGenKitRoles('kick,cowbell'), /unknown role "cowbell"/)
})

test('genkitPrompts: distinct style treatments of ONE subject, deterministic in seed', () => {
  const spec = GENKIT_ROLES[0]!
  const a = genkitPrompts(spec, 4, 9)
  const b = genkitPrompts(spec, 4, 9)
  assert.deepEqual(a, b, 'same seed, same prompts')
  assert.equal(new Set(a).size, 4, 'style-contrast convention: four DISTINCT prompts, not four seeds of one')
  for (const p of a) assert.ok(p.startsWith(`${spec.subject}, `), `every prompt is subject + style treatment, got "${p}"`)
  assert.notDeepEqual(genkitPrompts(spec, 4, 10), a, 'different seed, different style draw')
})

test('pickDrumCandidate: nearest log-distance centroid to the role target wins; silence never wins', () => {
  const kick = GENKIT_ROLES.find((s) => s.role === 'kick')!
  // target 150 Hz: 160 is much closer in octaves than 90 or 1200
  assert.equal(pickDrumCandidate(kick, [1200, 160, 90]).index, 1)
  assert.equal(pickDrumCandidate(kick, [null, 5000, 300]).index, 2, 'unmeasurable candidates are skipped')
  const fallback = pickDrumCandidate(kick, [null, null])
  assert.equal(fallback.index, 0)
  assert.match(fallback.reason, /no candidate had a measurable spectral centroid/)
  const hats = GENKIT_ROLES.find((s) => s.role === 'hats')!
  assert.equal(pickDrumCandidate(hats, [1200, 160, 7000]).index, 2, 'hats want the airy candidate, not the kick-shaped one')
})

const pitchStub = (over: Partial<PitchDetection>): PitchDetection => ({
  hz: null,
  midi: null,
  note: null,
  cents: null,
  confidence: 0,
  level: 'low',
  method: 'test',
  periodicity: 0,
  harmonicity: 0,
  partials: [],
  suggestedRootNote: null,
  suggestedRootHz: null,
  sampleRate: 44100,
  durationSeconds: 1,
  analyzedFromSeconds: 0,
  analyzedToSeconds: 1,
  ...over,
})

test('pickTonalCandidate: the most CONFIDENT single pitch wins and roots the keymap', () => {
  const pick = pickTonalCandidate([
    pitchStub({ hz: 110, midi: 45, note: 'a2', confidence: 0.6, level: 'medium' }),
    pitchStub({ hz: 220, midi: 57, note: 'a3', confidence: 0.95, level: 'high' }),
    pitchStub({ hz: 440, midi: 69, note: 'a4', confidence: 0.3, level: 'low' }),
  ])
  assert.equal(pick.index, 1)
  assert.equal(pick.rootSource, 'detected')
  assert.equal(pick.rootMidi, 57)
})

test('pickTonalCandidate: all-low-confidence roots on the winner\'s lowest strong partial, and says so', () => {
  const pick = pickTonalCandidate([
    pitchStub({ confidence: 0.1 }),
    pitchStub({ hz: 200, midi: 55.02, confidence: 0.4, suggestedRootHz: 220, suggestedRootNote: 'a3' }),
  ])
  assert.equal(pick.index, 1)
  assert.equal(pick.rootSource, 'suggested')
  assert.ok(Math.abs(pick.rootMidi - 57) < 0.01, `root comes from the 220 Hz partial (a3=57), got ${pick.rootMidi}`)
  assert.match(pick.reason, /no candidate reached medium pitch confidence/)
  assert.throws(() => pickTonalCandidate([pitchStub({}), pitchStub({})]), /no candidate produced any pitch reading/)
})

test('keymapSpanForRoot: one octave anchored to the sample, always inside the ±24 lane-tune clamp', () => {
  // Whatever register generation landed in (a 25 Hz bass ≈ midi 19.6, a 1.7 kHz bell ≈ 93), every
  // lane tune from the span must be reachable: |from - root| <= 6 and to = from + 12.
  for (let root = 15; root <= 110; root += 0.7) {
    for (const pc of [0, 4, 9, 11]) {
      const { fromMidi, toMidi } = keymapSpanForRoot(root, pc)
      assert.equal(toMidi - fromMidi, 12)
      assert.equal(((fromMidi % 12) + 12) % 12, pc, 'the span starts on the key root')
      assert.ok(fromMidi - root >= -24.5 && toMidi - root <= 24.5, `root ${root} pc ${pc}: span ${fromMidi}..${toMidi} strays outside the tune clamp`)
    }
  }
  assert.throws(() => keymapSpanForRoot(60, 12), /pitch class/)
})

test('pattern plans: deterministic in seed, only the given lanes, starts inside the loop', () => {
  const drums = planDrumHits(['kick', 'snare', 'hats', 'perc'], 2, 41)
  assert.deepEqual(drums, planDrumHits(['kick', 'snare', 'hats', 'perc'], 2, 41), 'same seed, same groove')
  assert.ok(drums.length > 0)
  for (const h of drums) {
    assert.ok(['kick', 'snare', 'hats', 'perc'].includes(h.lane))
    assert.ok(h.start >= 0 && h.start < 32, `start ${h.start} outside the 2-bar loop`)
    assert.ok(h.velocity > 0 && h.velocity <= 1)
  }
  // a subset kit only ever writes hits for the roles it has
  const kickOnly = planDrumHits(['kick'], 2, 41)
  assert.ok(kickOnly.every((h) => h.lane === 'kick'))
  assert.ok(kickOnly.some((h) => h.start === 0), 'four-on-the-floor starts on the one')

  const lanes = ['a2', 'c3', 'd3', 'e3', 'g3', 'a3']
  const bass = planBassHits(lanes, 2, 7)
  assert.deepEqual(bass, planBassHits(lanes, 2, 7))
  assert.ok(bass.every((h) => lanes.includes(h.lane)), 'bass only plays keymap lanes — in-key by construction')
  assert.ok(bass.filter((h) => h.lane === 'a2').length >= bass.length / 2, 'the bassline is root-heavy')
  const lead = planLeadHits(lanes, 2, 7)
  assert.deepEqual(lead, planLeadHits(lanes, 2, 7))
  assert.ok(lead.every((h) => lanes.includes(h.lane)))
  assert.ok(lead.every((h) => h.start >= 0 && h.start < 32))
})

test('a genkit:<role> group classifies as a gen round in taste-eval\'s splits', () => {
  assert.equal(variantTypeOf({ group: 'genkit:kick' }), 'gen')
  assert.equal(variantTypeOf({ group: 'gen:snare' }), 'gen')
  assert.equal(variantTypeOf({ group: 'clips' }), 'clip-set')
})

// ---- the pipeline (stub backend, CI-clean) ----------------------------------------------------

test('gen-kit composes a playable project: one registered sample per role, rateable batches, scene-placed patterns', (t) => {
  if (!hasPython) return t.skip('no python3')
  const dir = join(mkdtempSync(join(tmpdir(), 'beat-genkit-')), 'kit')
  const out = beat(['gen-kit', dir, '--gen-backend', 'stub', '--candidates', '3', '--seed', '7'])
  assert.equal(out.status, 0, out.stderr)
  const beatFile = join(dir, 'kit.beat')
  assert.ok(existsSync(beatFile), 'project file is <dir>/<basename>.beat')

  const doc = parse(readFileSync(beatFile, 'utf8'))
  // Exactly one registered sample per role — the deferred-registration property, kit-wide: three
  // candidates each were generated, but only the picked winner ever entered the media block.
  assert.deepEqual(doc.media.map((m) => m.id).sort(), ['bass', 'hats', 'kick', 'lead', 'perc', 'snare'])
  for (const m of doc.media) {
    assert.ok(existsSync(join(dir, m.path)), `${m.path} exists`)
    assert.ok(existsSync(join(dir, `${m.path}.json`)), `${m.path}.json provenance sidecar exists`)
    const sidecar = JSON.parse(readFileSync(join(dir, `${m.path}.json`), 'utf8'))
    assert.equal(sidecar.generated.backend, 'stub')
    assert.ok(sidecar.generated.prompt.includes(','), 'the sidecar records the candidate\'s own STYLE prompt, not just the subject')
  }

  // Tracks: one kit with a lane per drum role, one keymapped track per tonal role.
  const kit = doc.tracks.find((t2) => t2.id === 'kit')!
  assert.ok(kit && kit.kind === 'drums')
  assert.deepEqual(kit.lanes.map((l) => l.name), ['kick', 'snare', 'hats', 'perc'])
  assert.ok(kit.hits.length > 0, 'the starter groove is real content')
  for (const role of ['bass', 'lead']) {
    const track = doc.tracks.find((t2) => t2.id === role)!
    assert.ok(track && track.kind === 'drums', `${role} track exists`)
    assert.ok(track.lanes.length >= 4, `${role} is keymapped across the scale`)
    assert.ok(track.lanes.every((l) => l.backing.type === 'sample' && l.backing.sample === role), `${role} lanes all back onto the one ${role} sample`)
    assert.ok(track.hits.length > 0, `${role} has a starter phrase`)
    const laneNames = new Set(track.lanes.map((l) => l.name))
    assert.ok(track.hits.every((h) => laneNames.has(h.lane)), `${role} phrase only plays keymap lanes`)
  }

  // THE Phase 39 trap: song mode renders only scene-placed content. Every populated track must be
  // placed, or the render this command advertises comes back silent.
  assert.ok(doc.song !== null && doc.song.length > 0, 'the project is song-armed')
  assert.deepEqual(unplacedContentTracks(doc), [], 'no populated track is left out of the played scenes')

  // Each role's candidates remain behind as an ordinary rateable batch: group genkit:<role>, all
  // wavs present (what `beat rate` requires), classified as a gen round.
  const batchDirs = readdirSync(dir).filter((f) => f.startsWith('gen-'))
  assert.equal(batchDirs.length, 6, `one batch dir per role, got ${batchDirs.join(', ')}`)
  for (const b of batchDirs) {
    const manifest = readBatchManifest(join(dir, b))
    const role = b.replace(/^gen-/, '').replace(/-\d+$/, '')
    assert.equal(manifest.group, `genkit:${role}`)
    assert.equal(variantTypeOf(manifest), 'gen')
    assert.equal(manifest.count, 3)
    assert.ok(manifest.variants.every((v, i) => v.media !== undefined && existsSync(join(dir, b, `v${i + 1}.wav`))), 'every candidate is auditionable audio + D21 media')
    assert.equal(new Set(manifest.variants.map((v) => v.media!.sidecar['query'])).size, 3, 'three DISTINCT style prompts per batch')
  }

  // Deterministic in --seed: a second run with the same flags produces the identical document.
  const dir2 = join(mkdtempSync(join(tmpdir(), 'beat-genkit-')), 'kit')
  const out2 = beat(['gen-kit', dir2, '--gen-backend', 'stub', '--candidates', '3', '--seed', '7'])
  assert.equal(out2.status, 0, out2.stderr)
  assert.equal(readFileSync(join(dir2, 'kit.beat'), 'utf8'), readFileSync(beatFile, 'utf8'), 'same seed + backend => byte-identical .beat')

  // regen --verify replays every sample from its provenance sidecar alone — the project is a
  // recipe, and with the stub backend the hashes must match exactly.
  const verify = beat(['regen', beatFile, '--verify'])
  assert.equal(verify.status, 0, verify.stderr)
  assert.match(verify.stdout, /verified 6 sample\(s\): 6 match/)
})

test('gen-kit role subset: only those roles are generated, registered and placed', (t) => {
  if (!hasPython) return t.skip('no python3')
  const dir = join(mkdtempSync(join(tmpdir(), 'beat-genkit-')), 'duo')
  const out = beat(['gen-kit', dir, '--roles', 'kick,bass', '--candidates', '2', '--gen-backend', 'stub', '--seed', '3'])
  assert.equal(out.status, 0, out.stderr)
  const doc = parse(readFileSync(join(dir, 'duo.beat'), 'utf8'))
  assert.deepEqual(doc.media.map((m) => m.id).sort(), ['bass', 'kick'])
  assert.deepEqual(doc.tracks.map((t2) => t2.id).sort(), ['bass', 'kit'])
  const kit = doc.tracks.find((t2) => t2.id === 'kit')!
  assert.ok(kit.kind === 'drums' && kit.lanes.map((l) => l.name).join(',') === 'kick')
  assert.deepEqual(unplacedContentTracks(doc), [])
  assert.equal(readdirSync(dir).filter((f) => f.startsWith('gen-')).length, 2)
})

test('gen-kit refuses to overwrite an existing project and rejects unknown flags/roles', (t) => {
  if (!hasPython) return t.skip('no python3')
  const dir = join(mkdtempSync(join(tmpdir(), 'beat-genkit-')), 'kit')
  const first = beat(['gen-kit', dir, '--roles', 'kick', '--candidates', '1', '--gen-backend', 'stub', '--seed', '1'])
  assert.equal(first.status, 0, first.stderr)
  const again = beat(['gen-kit', dir, '--roles', 'kick', '--gen-backend', 'stub'])
  assert.equal(again.status, 2)
  assert.match(again.stderr, /already exists/)

  const badFlag = beat(['gen-kit', join(dir, 'x'), '--nope', '1'])
  assert.equal(badFlag.status, 2)
  assert.match(badFlag.stderr, /unknown flag "--nope"/)
  const badRole = beat(['gen-kit', join(dir, 'y'), '--roles', 'kazoo', '--gen-backend', 'stub'])
  assert.equal(badRole.status, 2)
  assert.match(badRole.stderr, /unknown role "kazoo"/)
  const badBackend = beat(['gen-kit', join(dir, 'z'), '--gen-backend', 'vibes'])
  assert.equal(badBackend.status, 2)
  assert.match(badBackend.stderr, /--gen-backend must be/)
})
