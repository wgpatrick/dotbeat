// src/core/drumkit.ts — first tests. Wave-0 gate W0.7(b) (codebase review R2 §6.1).
//
// Why this file exists: `drumkit.ts` had ZERO coverage, direct or indirect — 155 lines reachable
// only through the MCP tools `beat_drum_kits`/`beat_drum_kit`, which no test invoked. That matters
// beyond the usual "untested module" complaint, because `parseBacking` (drumkit.ts:33-78) is the
// THIRD hand-maintained copy of the lane-backing grammar (the others live in parse.ts's
// `tryParseLaneDecl` and edit.ts's `parseLaneBackingTokens`), and it is the copy nothing tested.
// The review found the copies had already drifted: the -24..24 semitone `tune` clamp is enforced
// here and in edit.ts but was MISSING from parse.ts's new `lane <name> sample …` form (hot-fixed
// during the review). These tests pin what THIS copy enforces, so the pending unification of the
// three copies is a refactor with a net under it rather than a rewrite of untested code.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseDrumKitLibrary,
  applyDrumKit,
  formatDrumKitList,
  BeatDrumKitError,
  initDocument,
  addTrack,
  addHit,
  setMediaSample,
  parse,
  serialize,
  type BeatDrumKit,
} from '../src/core/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** A one-kit library JSON, with `lanes` overridable per case. */
function lib(lanes: unknown[], kit: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 1, kits: [{ name: 'kit-test', description: 'a test kit', lanes, ...kit }] })
}
const synthLane = { name: 'kick', backing: { type: 'synth', voice: 'membrane', params: { tune: 32.7 } } }
const sampleLane = { name: 'kick', backing: { type: 'sample', sample: 'kick-1', gainDb: -3, tune: 0 } }
const sfLane = { name: 'kick', backing: { type: 'sf', sample: 'kit.sf2', program: 0, note: 36 } }

const throwsKitError = (fn: () => unknown, match: RegExp) =>
  assert.throws(fn, (err: unknown) => err instanceof BeatDrumKitError && match.test((err as Error).message), `expected BeatDrumKitError matching ${match}`)

// ---------------------------------------------------------------------------------------------
// parseDrumKitLibrary — library envelope
// ---------------------------------------------------------------------------------------------

test('parseDrumKitLibrary: the shipped presets/drum-kits.json parses', () => {
  const kits = parseDrumKitLibrary(readFileSync(join(repoRoot, 'presets', 'drum-kits.json'), 'utf8'))
  assert.ok(kits.length >= 3, 'expected at least kit-808 / kit-909 / kit-acoustic')
  assert.ok(kits.some((k) => k.name === 'kit-808'))
  for (const kit of kits) {
    assert.ok(kit.lanes.length > 0)
    assert.ok(kit.description.length > 0)
    for (const lane of kit.lanes) assert.ok(['synth', 'sample', 'sf'].includes(lane.backing.type))
  }
})

test('parseDrumKitLibrary: rejects non-JSON, wrong version, and a missing kits array', () => {
  throwsKitError(() => parseDrumKitLibrary('{not json'), /not valid JSON/)
  throwsKitError(() => parseDrumKitLibrary(JSON.stringify({ version: 2, kits: [] })), /unsupported drum-kit library version: 2/)
  throwsKitError(() => parseDrumKitLibrary(JSON.stringify({ kits: [] })), /unsupported drum-kit library version: undefined/)
  throwsKitError(() => parseDrumKitLibrary(JSON.stringify({ version: 1 })), /no "kits" array/)
  // An empty kits array is legal — a library with nothing in it, not an error.
  assert.deepEqual(parseDrumKitLibrary(JSON.stringify({ version: 1, kits: [] })), [])
})

test('parseDrumKitLibrary: kit names are lowercase slugs, unique, and described', () => {
  throwsKitError(() => parseDrumKitLibrary(lib([synthLane], { name: 'Kit_808' })), /kit name must be a lowercase slug/)
  throwsKitError(() => parseDrumKitLibrary(lib([synthLane], { name: 'kit 808' })), /kit name must be a lowercase slug/)
  throwsKitError(() => parseDrumKitLibrary(lib([synthLane], { name: 42 })), /kit name must be a lowercase slug/)
  throwsKitError(
    () => parseDrumKitLibrary(JSON.stringify({ version: 1, kits: [{ name: 'kit-a', description: 'x', lanes: [synthLane] }, { name: 'kit-a', description: 'y', lanes: [synthLane] }] })),
    /duplicate kit name "kit-a"/,
  )
  throwsKitError(() => parseDrumKitLibrary(JSON.stringify({ version: 1, kits: [{ name: 'kit-a', lanes: [synthLane] }] })), /missing description/)
})

test('parseDrumKitLibrary: lanes must be a non-empty array of uniquely-named slugs', () => {
  throwsKitError(() => parseDrumKitLibrary(lib([])), /lanes must be a non-empty array/)
  throwsKitError(() => parseDrumKitLibrary(JSON.stringify({ version: 1, kits: [{ name: 'kit-a', description: 'x', lanes: 'kick' }] })), /lanes must be a non-empty array/)
  throwsKitError(() => parseDrumKitLibrary(lib([{ ...synthLane, name: 'kick drum' }])), /lane name must be a slug/)
  throwsKitError(() => parseDrumKitLibrary(lib([synthLane, synthLane])), /duplicate lane "kick"/)
  // Lane names, unlike kit names, allow uppercase and underscores (the `tom_lo` convention).
  const kits = parseDrumKitLibrary(lib([{ ...synthLane, name: 'Tom_Lo-2' }]))
  assert.equal(kits[0]!.lanes[0]!.name, 'Tom_Lo-2')
})

// ---------------------------------------------------------------------------------------------
// parseBacking — the third copy of the lane-backing grammar
// ---------------------------------------------------------------------------------------------

test('parseBacking synth: voice must be a known DrumVoiceType, params finite numbers', () => {
  const kits = parseDrumKitLibrary(lib([{ name: 'kick', backing: { type: 'synth', voice: 'membrane', params: { tune: 32.7, decay: 0.55 } } }]))
  assert.deepEqual(kits[0]!.lanes[0]!.backing, { type: 'synth', voice: 'membrane', params: { tune: 32.7, decay: 0.55 } })
  for (const voice of ['membrane', 'noise', 'metal']) {
    assert.equal(parseDrumKitLibrary(lib([{ name: 'k', backing: { type: 'synth', voice } }]))[0]!.lanes[0]!.backing.type, 'synth')
  }
  // params is optional and defaults to {}
  assert.deepEqual((parseDrumKitLibrary(lib([{ name: 'k', backing: { type: 'synth', voice: 'noise' } }]))[0]!.lanes[0]!.backing as { params: unknown }).params, {})
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { type: 'synth', voice: 'kick' } }])), /voice must be one of membrane\|noise\|metal/)
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { type: 'synth', voice: 'noise', params: [1] } }])), /params must be an object/)
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { type: 'synth', voice: 'noise', params: { decay: 'fast' } } }])), /param "decay" must be a finite number/)
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { type: 'synth', voice: 'noise', params: { decay: null } } }])), /param "decay" must be a finite number/)
})

test('parseBacking: unknown / missing backing shapes fail loudly', () => {
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { type: 'wav' } }])), /backing type must be synth\|sample\|sf/)
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k' }])), /backing must be an object/)
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: 'synth:membrane' }])), /backing must be an object/)
})

test('parseBacking sample: the -24..24 semitone tune clamp (the R2-F1 divergence)', () => {
  // This clamp is the concrete divergence the review found between the three lane-grammar copies:
  // enforced here and in edit.ts's parseLaneBackingTokens, absent from parse.ts's new lane form
  // (hot-fixed). Boundaries are INCLUSIVE.
  for (const tune of [-24, -0.5, 0, 12, 24]) {
    const backing = parseDrumKitLibrary(lib([{ name: 'k', backing: { ...sampleLane.backing, tune } }]))[0]!.lanes[0]!.backing as { tune: number }
    assert.equal(backing.tune, tune, `tune ${tune} is inside the legal range`)
  }
  for (const tune of [-24.0001, -25, 24.0001, 25, 99]) {
    throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { ...sampleLane.backing, tune } }])), /tune must be -24\.\.24 semitones/)
  }
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { ...sampleLane.backing, tune: 'up' } }])), /tune must be -24\.\.24 semitones/)
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { ...sampleLane.backing, tune: Infinity } }])), /tune must be -24\.\.24 semitones/)
})

test('parseBacking sample: sample id and gainDb are required and typed', () => {
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { type: 'sample', gainDb: 0, tune: 0 } }])), /sample backing needs a "sample" id/)
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { type: 'sample', sample: '', gainDb: 0, tune: 0 } }])), /sample backing needs a "sample" id/)
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { type: 'sample', sample: 's', tune: 0 } }])), /gainDb must be a finite number/)
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { type: 'sample', sample: 's', gainDb: NaN, tune: 0 } }])), /gainDb must be a finite number/)
})

test('parseBacking sample: optional Phase 26 DK params, filterType and effects', () => {
  const backing = parseDrumKitLibrary(
    lib([
      {
        name: 'k',
        backing: {
          type: 'sample',
          sample: 'snr',
          gainDb: -2,
          tune: 3,
          params: { start: 0.01, length: 0, attack: 0.001, hold: 0, decay: 0.2, cutoff: 8000, resonance: 1 },
          filterType: 'bandpass',
          effects: [{ type: 'eq3' }, { id: 'crush', type: 'bitcrush', enabled: false }],
        },
      },
    ]),
  )[0]!.lanes[0]!.backing as { params: Record<string, number>; filterType: string; effects: { id: string; type: string; enabled: boolean }[] }
  assert.equal(backing.params.cutoff, 8000)
  assert.equal(backing.filterType, 'bandpass')
  // Effect id defaults to the type; `enabled` defaults to true and is only false when EXPLICITLY false.
  assert.deepEqual(backing.effects, [
    { id: 'eq3', type: 'eq3', enabled: true },
    { id: 'crush', type: 'bitcrush', enabled: false },
  ])

  // Absent = every default: no params, lowpass, no effects.
  const bare = parseDrumKitLibrary(lib([sampleLane]))[0]!.lanes[0]!.backing as { params: Record<string, number>; filterType: string; effects: unknown[] }
  assert.deepEqual(bare.params, {})
  assert.equal(bare.filterType, 'lowpass')
  assert.deepEqual(bare.effects, [])

  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { ...sampleLane.backing, params: { wobble: 1 } } }])), /unknown sample lane param "wobble"/)
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { ...sampleLane.backing, params: { cutoff: 'hi' } } }])), /param "cutoff" must be a finite number/)
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { ...sampleLane.backing, filterType: 'notch' } }])), /filterType must be one of lowpass\|bandpass\|highpass/)
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { ...sampleLane.backing, effects: {} } }])), /effects must be an array/)
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { ...sampleLane.backing, effects: [{ type: 'reverb' }] } }])), /effect type must be one of/)
})

test('parseBacking sf: sample id plus integer program/note in 0..127', () => {
  const backing = parseDrumKitLibrary(lib([sfLane]))[0]!.lanes[0]!.backing
  assert.deepEqual(backing, { type: 'sf', sample: 'kit.sf2', program: 0, note: 36 })
  for (const [program, note] of [[0, 0], [127, 127]] as const) {
    assert.ok(parseDrumKitLibrary(lib([{ name: 'k', backing: { type: 'sf', sample: 's', program, note } }])))
  }
  throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { type: 'sf', program: 0, note: 36 } }])), /sf backing needs a "sample" id/)
  for (const program of [-1, 128, 1.5, '0']) {
    throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { type: 'sf', sample: 's', program, note: 36 } }])), /program must be an integer 0-127/)
  }
  for (const note of [-1, 128, 36.5, null]) {
    throwsKitError(() => parseDrumKitLibrary(lib([{ name: 'k', backing: { type: 'sf', sample: 's', program: 0, note } }])), /note must be an integer 0-127/)
  }
})

// ---------------------------------------------------------------------------------------------
// applyDrumKit
// ---------------------------------------------------------------------------------------------

/** A `lead` synth track + a `beat` drums track with kick/snare lanes and one hit on each. Built
 * through the real edit primitives so the fixture can't drift out of the format. */
function drumsDoc(opts: { media?: string } = {}) {
  let doc = initDocument({ bpm: 120, loopBars: 1, trackId: 'lead' })
  if (opts.media) doc = setMediaSample(doc, opts.media, '0'.repeat(64), `${opts.media}.wav`)
  doc = addTrack(doc, {
    id: 'beat',
    kind: 'drums',
    lanes: [
      { name: 'kick', backing: { type: 'synth', voice: 'membrane', params: {} } },
      { name: 'snare', backing: { type: 'synth', voice: 'noise', params: {} } },
    ],
  }).doc
  doc = addHit(doc, 'beat', { lane: 'kick', start: 0, velocity: 1 }).doc
  doc = addHit(doc, 'beat', { lane: 'snare', start: 4, velocity: 1 }).doc
  return doc
}

const kitOf = (json: string): BeatDrumKit => parseDrumKitLibrary(json)[0]!

test('applyDrumKit: REPLACES the lane list wholesale and leaves other tracks alone', () => {
  const doc = drumsDoc()
  const kit = kitOf(lib([{ name: 'kick', backing: { type: 'synth', voice: 'membrane', params: { tune: 40 } } }, { name: 'snare', backing: { type: 'synth', voice: 'noise' } }, { name: 'hat', backing: { type: 'synth', voice: 'metal' } }]))
  const next = applyDrumKit(doc, 'beat', kit)
  const track = next.tracks.find((t) => t.id === 'beat')!
  assert.deepEqual(track.lanes.map((l) => l.name), ['kick', 'snare', 'hat'])
  assert.equal(track.hits.length, 2, 'hits survive — a kit swaps the voicing, not the pattern')
  assert.deepEqual(next.tracks.find((t) => t.id === 'lead'), doc.tracks.find((t) => t.id === 'lead'))
  // Immutable: the input document is untouched.
  assert.deepEqual(doc.tracks.find((t) => t.id === 'beat')!.lanes.map((l) => l.name), ['kick', 'snare'])
})

test('applyDrumKit: deep-copies backing params/effects so the kit object is not aliased', () => {
  const kit = kitOf(lib([{ name: 'kick', backing: { type: 'sample', sample: 'kick-1', gainDb: 0, tune: 0, params: { decay: 0.2 }, effects: [{ type: 'eq3' }] } }]))
  const doc = drumsDoc({ media: 'kick-1' })
  // `snare` hit would be orphaned by a kick-only kit, so drop the hits for this aliasing check.
  const next = applyDrumKit({ ...doc, tracks: doc.tracks.map((t) => (t.id === 'beat' ? { ...t, hits: [] } : t)) }, 'beat', kit)
  const backing = next.tracks.find((t) => t.id === 'beat')!.lanes[0]!.backing as { params: Record<string, number>; effects: { id: string }[] }
  backing.params.decay = 9
  backing.effects[0]!.id = 'mutated'
  const kitBacking = kit.lanes[0]!.backing as { params: Record<string, number>; effects: { id: string }[] }
  assert.equal(kitBacking.params.decay, 0.2, 'mutating the applied document must not reach back into the kit')
  assert.equal(kitBacking.effects[0]!.id, 'eq3')
})

test('applyDrumKit: refuses an unknown track, a non-drums track, unregistered media, and orphaned hits', () => {
  const doc = drumsDoc()
  const kit = kitOf(lib([{ name: 'kick', backing: { type: 'synth', voice: 'membrane' } }, { name: 'snare', backing: { type: 'synth', voice: 'noise' } }]))
  throwsKitError(() => applyDrumKit(doc, 'nope', kit), /no track "nope"/)
  throwsKitError(() => applyDrumKit(doc, 'lead', kit), /only applies to drum tracks — "lead" is a synth track/)

  const sampleKit = kitOf(lib([{ name: 'kick', backing: { type: 'sample', sample: 'missing-1', gainDb: 0, tune: 0 } }, { name: 'snare', backing: { type: 'synth', voice: 'noise' } }]))
  throwsKitError(() => applyDrumKit(doc, 'beat', sampleKit), /references unregistered sample "missing-1" — register it with beat sample first/)

  // The track has a `snare` hit; a kit without a snare lane would orphan it (and the result would
  // not re-parse), so it is refused up front.
  const kickOnly = kitOf(lib([{ name: 'kick', backing: { type: 'synth', voice: 'membrane' } }]))
  throwsKitError(() => applyDrumKit(doc, 'beat', kickOnly), /has hits on lane\(s\) not in kit "kit-test" \(snare\)/)
})

test('applyDrumKit: the result re-serializes and re-parses (the kit produces a writable document)', () => {
  const doc = drumsDoc()
  const kit = kitOf(lib([{ name: 'kick', backing: { type: 'synth', voice: 'membrane', params: { tune: 32.7, decay: 0.55 } } }, { name: 'snare', backing: { type: 'synth', voice: 'noise' } }]))
  const text = serialize(applyDrumKit(doc, 'beat', kit))
  assert.equal(serialize(parse(text)), text, 'a kit-applied document round-trips byte-identically (D4)')
})

// ---------------------------------------------------------------------------------------------
// formatDrumKitList
// ---------------------------------------------------------------------------------------------

test('formatDrumKitList: one padded line per kit, and an honest empty case', () => {
  assert.equal(formatDrumKitList([]), 'no drum kits\n')
  const kits = parseDrumKitLibrary(
    JSON.stringify({
      version: 1,
      kits: [
        { name: 'kit-808', description: 'eight-oh-eight', lanes: [synthLane] },
        { name: 'k', description: 'short name', lanes: [synthLane, { ...synthLane, name: 'snare' }] },
      ],
    }),
  )
  assert.equal(formatDrumKitList(kits), 'kit-808  1 lanes  eight-oh-eight\nk        2 lanes  short name\n')
})
