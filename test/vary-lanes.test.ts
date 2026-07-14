// Phase 35 Stream OA — lane-aware drum vary/suggest (docs/phase-35-plan.md §OA; pilot 101's
// high finding). The properties under test are the honesty guarantees: on a declared-lane drums
// track, `vary <lane>` mutates the NAMED LANE's own backing params (so the serialized `lane`
// lines — the thing the engine actually plays — differ per variant), a legacy drum-voice group
// name ERRORS loudly instead of generating audio-identical no-op variants, every manifest edit
// is replayable via the `beat set` lane-param path (`<track>.lane.<name>.<key>`), and suggest
// never recommends a target that would no-op on the actual track.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDocument, addTrack, serialize, parse, setValue, setLaneBacking, setMediaSample, BeatEditError } from '../src/core/index.js'
import { defaultDrumKitLanes, DRUM_VOICE_PARAM_DEFAULTS } from '../src/core/document.js'
import {
  varyTrack,
  laneVaryDefs,
  laneParamCurrent,
  legalVaryTargets,
  DRUM_VOICE_VARY_DEFS,
  SAMPLE_LANE_VARY_DEFS,
  LEGACY_DRUM_VOICE_GROUPS,
  BeatVaryError,
} from '../src/vary/vary.js'
import { suggestNext, type ScoreEntry } from '../src/vary/suggest.js'
import { writeVaryBatch, scoreBatch } from '../src/vary/batch.js'

/** A project with a declared-lane drums track (the 12-lane GM default kit — what every fresh
 * CLI/MCP drums track gets) and a legacy drums track (empty `lanes`). */
function project() {
  const base = initDocument({ trackId: 'lead' })
  const withDeclared = addTrack(base, { id: 'drums', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  return addTrack(withDeclared, { id: 'olddrums', kind: 'drums' }).doc
}

/** project() with the drums track's hat lane swapped to a sample backing and an sf-backed extra
 * lane, exercising all three backing types. */
function mixedBackingProject() {
  let doc = project()
  doc = setMediaSample(doc, 'smp_hat', 'a'.repeat(64), 'media/hat.wav')
  doc = setMediaSample(doc, 'gm_kit', 'b'.repeat(64), 'media/kit.sf2')
  doc = setLaneBacking(doc, 'drums', 'hat', ['sample', 'smp_hat', '-3', '2']).doc
  doc = setLaneBacking(doc, 'drums', 'ride', ['sf', 'gm_kit', '0', '51']).doc
  return doc
}

// ---- the `beat set` lane-param path (the replay grammar) --------------------------------------

test('setValue <track>.lane.<name>.<key> edits a synth lane param and serializes onto its lane line', () => {
  const doc = setValue(project(), 'drums.lane.kick.tune', '28.5')
  const text = serialize(doc)
  assert.match(text, /^ {2}lane kick synth:membrane tune=28\.5$/m)
  const lane = doc.tracks.find((t) => t.id === 'drums')!.lanes.find((l) => l.name === 'kick')!
  assert.equal(lane.backing.type === 'synth' && lane.backing.params.tune, 28.5)
})

test('setValue lane path with an empty value clears the override back to the voice default (elided)', () => {
  let doc = setValue(project(), 'drums.lane.kick.tune', '28.5')
  doc = setValue(doc, 'drums.lane.kick.tune', '')
  assert.match(serialize(doc), /^ {2}lane kick synth:membrane$/m)
})

test('setValue lane path validates the key against the voice type (fail loudly, not a dead param)', () => {
  assert.throws(() => setValue(project(), 'drums.lane.kick.tone', '0.5'), /synth:membrane-backed — its params are tune\|punch\|decay/)
  assert.throws(() => setValue(project(), 'drums.lane.snare.punch', '0.1'), /synth:noise-backed — its params are tone\|decay/)
})

test('setValue lane path: unknown lane, legacy track, and sf-backed lane all fail loudly', () => {
  assert.throws(() => setValue(project(), 'drums.lane.ghost.tune', '30'), /no lane "ghost" on track "drums" \(have: kick, snare/)
  assert.throws(() => setValue(project(), 'olddrums.lane.kick.tune', '30'), /still on the implicit 5-lane kit/)
  assert.throws(() => setValue(mixedBackingProject(), 'drums.lane.ride.tune', '2'), /sf-backed/)
})

test('setValue lane path on a sample-backed lane: params bag, gainDb, and tune (with range check)', () => {
  let doc = mixedBackingProject()
  doc = setValue(doc, 'drums.lane.hat.start', '0.01')
  doc = setValue(doc, 'drums.lane.hat.gainDb', '-6')
  doc = setValue(doc, 'drums.lane.hat.tune', '5')
  const text = serialize(doc)
  assert.match(text, /^ {2}lane hat sample smp_hat -6 5 start=0\.01$/m)
  assert.throws(() => setValue(doc, 'drums.lane.hat.tune', '30'), /tune must be -24\.\.24/)
  assert.throws(() => setValue(doc, 'drums.lane.hat.warp', '1'), /unknown sample lane param "warp" .*gainDb\|tune/)
})

// ---- varyTrack lane targeting ------------------------------------------------------------------

test('vary <lane> on a declared-lane track mutates ONLY that lane, via replayable lane set paths', () => {
  const doc = project()
  const variants = varyTrack(doc, 'drums', 'kick', { seed: 5, count: 6 })
  assert.equal(variants.length, 6)
  const membraneKeys = new Set(DRUM_VOICE_VARY_DEFS.membrane.map((d) => d.key))
  for (const v of variants) {
    assert.ok(v.edits.length > 0)
    for (const e of v.edits) {
      const m = e.path.match(/^drums\.lane\.kick\.([a-z]+)$/)
      assert.ok(m, `edit path "${e.path}" is not a drums.lane.kick.* set path`)
      assert.ok(membraneKeys.has(m![1]!), `param ${m![1]} outside the membrane defs`)
    }
  }
})

test('variants of a declared-lane track produce docs whose serialized LANE lines differ (spec test 1)', () => {
  const doc = project()
  const parentLaneLine = serialize(doc).split('\n').find((l) => /^ {2}lane kick /.test(l))!
  for (const v of varyTrack(doc, 'drums', 'kick', { seed: 7, count: 9 })) {
    const laneLine = serialize(v.doc).split('\n').find((l) => /^ {2}lane kick /.test(l))!
    assert.notEqual(laneLine, parentLaneLine, 'each variant must change the kick lane line — the params the engine actually plays')
    // and the legacy track-wide drum-voice params are untouched (no more dead-param writes)
    assert.equal(v.doc.tracks.find((t) => t.id === 'drums')!.synth.kickTune, doc.tracks.find((t) => t.id === 'drums')!.synth.kickTune)
  }
})

test('lane mutation basis is the lane\'s own declared value, not the track-wide default (pilot 101)', () => {
  // kit-909-style kick: tune declared at 28.5 while the legacy track-wide default is 32.7. With a
  // tiny amount, every mutated tune must hug 28.5 — the value the engine actually plays.
  const doc = setValue(project(), 'drums.lane.kick.tune', '28.5')
  for (const v of varyTrack(doc, 'drums', 'kick', { seed: 11, count: 9, amount: 0.01 })) {
    for (const e of v.edits) {
      if (!e.path.endsWith('.tune')) continue
      const tune = Number(e.value)
      assert.ok(tune > 25 && tune < 32, `tune ${tune} should stay near the lane's declared 28.5, not the track-wide 32.7 default`)
    }
  }
})

test('any declared lane works, not just the historic five names (tom_lo), deterministically', () => {
  const doc = project()
  const a = varyTrack(doc, 'drums', 'tom_lo', { seed: 3, count: 4 })
  const b = varyTrack(doc, 'drums', 'tom_lo', { seed: 3, count: 4 })
  assert.deepEqual(a.map((v) => serialize(v.doc)), b.map((v) => serialize(v.doc)))
  for (const v of a) for (const e of v.edits) assert.match(e.path, /^drums\.lane\.tom_lo\./)
})

test('sample-backed lane vary targets SAMPLE_LANE_PARAM_KEYS plus gainDb/tune, inside the ranges', () => {
  const doc = mixedBackingProject()
  const sampleKeys = new Set(SAMPLE_LANE_VARY_DEFS.map((d) => d.key))
  const seen = new Set<string>()
  for (const v of varyTrack(doc, 'drums', 'hat', { seed: 9, count: 12, amount: 0.6 })) {
    for (const e of v.edits) {
      const m = e.path.match(/^drums\.lane\.hat\.([a-zA-Z]+)$/)
      assert.ok(m, `edit path "${e.path}" is not a drums.lane.hat.* set path`)
      const key = m![1]!
      assert.ok(sampleKeys.has(key), `param ${key} outside the sample-lane defs`)
      seen.add(key)
      const def = SAMPLE_LANE_VARY_DEFS.find((d) => d.key === key)!
      const val = Number(e.value)
      assert.ok(val >= def.min - 1e-9 && val <= def.max + 1e-9, `${key}=${val} out of [${def.min}, ${def.max}]`)
    }
  }
  assert.ok(seen.has('gainDb') || seen.has('tune'), 'the backing fields gainDb/tune are part of the vary surface')
})

test('a legacy group name on a declared-lane track ERRORS loudly, naming the real lanes (spec test 2)', () => {
  const doc = project()
  assert.throws(
    () => varyTrack(doc, 'drums', 'hats', { seed: 1 }),
    (err: Error) => {
      assert.ok(err instanceof BeatVaryError)
      assert.match(err.message, /legacy track-wide drum-voice params/)
      assert.match(err.message, /kick, snare, rimshot, clap, hat, openhat/) // names the real lanes
      assert.match(err.message, /filter/) // and the still-live track-wide groups
      return true
    },
  )
})

test('an sf-backed lane refuses to vary (program/note are identity, not shaping)', () => {
  assert.throws(() => varyTrack(mixedBackingProject(), 'drums', 'ride', { seed: 1 }), /sf-backed .* nothing to vary/)
})

test('track-wide bus groups (filter/fx/...) still work on a declared-lane drums track', () => {
  const doc = project()
  for (const v of varyTrack(doc, 'drums', 'filter', { seed: 2, count: 3 })) {
    for (const e of v.edits) assert.match(e.path, /^drums\.(cutoff|resonance)$/)
  }
})

test('unknown target on a declared-lane track names both the lanes and the live groups', () => {
  assert.throws(() => varyTrack(project(), 'drums', 'warp', { seed: 1 }), /unknown vary target "warp" .*lanes: kick, snare.*track-wide groups: filter/)
})

test('legacy tracks keep today\'s behavior: kick group mutates the track-wide synth params', () => {
  const doc = project()
  const variants = varyTrack(doc, 'olddrums', 'kick', { seed: 5, count: 3 })
  for (const v of variants) {
    assert.ok(v.edits.length > 0)
    for (const e of v.edits) assert.match(e.path, /^olddrums\.(kickTune|kickPunch|kickDecay)$/)
  }
  // and deterministic under the seed, same as always
  assert.deepEqual(
    variants.map((v) => serialize(v.doc)),
    varyTrack(doc, 'olddrums', 'kick', { seed: 5, count: 3 }).map((v) => serialize(v.doc)),
  )
})

test('round-trip: replaying every manifest edit via setValue reproduces the variant doc (spec test 4)', () => {
  const synthLaneDoc = project()
  const sampleLaneDoc = mixedBackingProject()
  const cases: [ReturnType<typeof project>, string][] = [
    [synthLaneDoc, 'kick'],
    [synthLaneDoc, 'tom_hi'],
    [sampleLaneDoc, 'hat'],
  ]
  for (const [doc, lane] of cases) {
    for (const v of varyTrack(doc, 'drums', lane, { seed: 21, count: 5 })) {
      let rebuilt = doc
      for (const e of v.edits) rebuilt = setValue(rebuilt, e.path, e.value)
      assert.equal(serialize(rebuilt), serialize(v.doc), `replay of ${lane} edits must rebuild the variant byte-identically`)
    }
  }
})

test('the shared batch manifest carries lane edits that replay through beat set (scoreBatch adopt path)', () => {
  const doc = project()
  const parentText = serialize(doc)
  const outDir = mkdtempSync(join(tmpdir(), 'beat-vary-lane-'))
  const variants = varyTrack(doc, 'drums', 'kick', { seed: 33, count: 3 })
  writeVaryBatch({ parentPath: 'song.beat', parentText, track: 'drums', group: 'kick', count: 3, amount: 0.25, seed: 33, outDir, variants })
  const result = scoreBatch(outDir, ['v2'], join(outDir, 'scores.jsonl'))
  const edits = result.entry.picks[0]!.edits!
  assert.ok(edits.length > 0)
  // each edit is a "path value" pair in the lane set-path vocabulary; replaying them onto the
  // parent must reproduce the picked variant's file bytes (the adopt contract).
  let rebuilt = parse(parentText)
  for (const edit of edits) {
    const sp = edit.indexOf(' ')
    rebuilt = setValue(rebuilt, edit.slice(0, sp), edit.slice(sp + 1))
  }
  assert.equal(serialize(rebuilt), readFileSync(join(outDir, 'v2.beat'), 'utf8'))
})

// ---- lane-aware helpers ------------------------------------------------------------------------

test('legalVaryTargets: declared-lane drums = non-sf lanes + bus groups, minus dead legacy groups', () => {
  const targets = legalVaryTargets(mixedBackingProject().tracks.find((t) => t.id === 'drums')!)
  // "kick"/"snare" appear because they are LANE names in this kit (varyTrack resolves them as
  // lanes there — the real, audible target); "hats" is a legacy group with no same-named lane,
  // so it must be gone entirely.
  assert.ok(targets.includes('kick') && targets.includes('hat') && targets.includes('tom_lo'))
  assert.ok(!targets.includes('ride'), 'sf-backed lane has nothing to vary')
  assert.ok(targets.includes('filter') && targets.includes('mix'))
  assert.ok(!targets.includes('hats'), 'the lane-less legacy group "hats" is a no-op on declared-lane tracks')
  assert.ok(LEGACY_DRUM_VOICE_GROUPS.has('hats'))
})

test('laneVaryDefs/laneParamCurrent read the actual backing (declared value over voice default)', () => {
  const doc = setValue(project(), 'drums.lane.kick.tune', '28.5')
  const kick = doc.tracks.find((t) => t.id === 'drums')!.lanes.find((l) => l.name === 'kick')!
  assert.equal(laneParamCurrent(kick, 'tune'), 28.5)
  assert.equal(laneParamCurrent(kick, 'punch'), DRUM_VOICE_PARAM_DEFAULTS.membrane.punch)
  assert.deepEqual(laneVaryDefs(kick), DRUM_VOICE_VARY_DEFS.membrane)
})

// ---- suggest follows (spec test 3 + never-recommend-a-no-op) -----------------------------------

test('suggest cold start on a declared-lane drums track recommends a REAL lane (spec test 3)', () => {
  const lanes = project().tracks.find((t) => t.id === 'drums')!.lanes
  const s = suggestNext([], 'drums', { file: 'song.beat', trackKind: 'drums', trackLanes: lanes })
  assert.equal(s.coldStart, true)
  assert.equal(s.recommendedGroup, 'kick') // the first declared lane — a target that actually sounds
  assert.match(s.command, /^beat vary song\.beat drums kick --amount 0\.25 --seed \d+$/)
  assert.ok(s.reasoning.some((l) => /declared-lane drums track/.test(l)))
})

test('suggest cold start skips an sf-backed first lane (nothing to vary there)', () => {
  const doc = mixedBackingProject()
  // move the sf-backed ride declaration to the front by reordering the lanes list directly
  const drums = doc.tracks.find((t) => t.id === 'drums')!
  const ride = drums.lanes.find((l) => l.name === 'ride')!
  const lanes = [ride, ...drums.lanes.filter((l) => l !== ride)]
  const s = suggestNext([], 'drums', { file: 'song.beat', trackKind: 'drums', trackLanes: lanes })
  assert.equal(s.recommendedGroup, 'kick', 'sf-backed ride must be skipped even as the first declared lane')
})

test('suggest never recommends a historically-winning group that would no-op on this track', () => {
  const lanes = project().tracks.find((t) => t.id === 'drums')!.lanes
  // "hats" scored brilliantly — but this declared-lane track has no "hats" lane, so those wins
  // were rated on audio-identical no-ops. "filter" scored modestly and is real.
  const entries: ScoreEntry[] = [
    { track: 'drums', group: 'hats', picks: [{ rank: 1, variant: 'v1.beat' }, { rank: 2, variant: 'v2.beat' }, { rank: 3, variant: 'v3.beat' }], rejected: [] },
    { track: 'drums', group: 'filter', picks: [{ rank: 1, variant: 'v1.beat' }], rejected: ['v2.beat', 'v3.beat'] },
  ]
  const s = suggestNext(entries, 'drums', { file: 'song.beat', trackKind: 'drums', trackLanes: lanes })
  assert.equal(s.coldStart, false)
  assert.equal(s.recommendedGroup, 'filter')
  assert.ok(s.reasoning.some((l) => /skipping "hats"/.test(l)), 'the skip must be explained, not silent')
})

test('suggest with an all-dead history falls back to recommending a real lane, honestly labeled', () => {
  const lanes = project().tracks.find((t) => t.id === 'drums')!.lanes
  const entries: ScoreEntry[] = [{ track: 'drums', group: 'hats', picks: [{ rank: 1, variant: 'v1.beat' }], rejected: ['v2.beat'] }]
  const s = suggestNext(entries, 'drums', { file: 'song.beat', trackKind: 'drums', trackLanes: lanes })
  assert.equal(s.coldStart, true)
  assert.equal(s.recommendedGroup, 'kick')
  assert.ok(s.reasoning.some((l) => /no audible signal/.test(l)))
  assert.match(s.command, /^beat vary song\.beat drums kick /)
})

test('suggest recommends a lane that scored well, with direction hints from its own lane defs', () => {
  const lanes = project().tracks.find((t) => t.id === 'drums')!.lanes
  // three picked kick-lane variants, all with tune driven high (near the top of membrane's 18-90
  // log range) — the direction heuristic must read the lane defs, not VARY_GROUPS
  const entries: ScoreEntry[] = [
    {
      track: 'drums',
      group: 'kick',
      picks: [
        { rank: 1, variant: 'v1.beat', edits: ['drums.lane.kick.tune 80'] },
        { rank: 2, variant: 'v2.beat', edits: ['drums.lane.kick.tune 75'] },
        { rank: 3, variant: 'v3.beat', edits: ['drums.lane.kick.tune 82'] },
      ],
      rejected: ['v4.beat'],
    },
  ]
  const s = suggestNext(entries, 'drums', { file: 'song.beat', trackKind: 'drums', trackLanes: lanes })
  assert.equal(s.recommendedGroup, 'kick')
  assert.equal(s.directions.length, 1)
  assert.equal(s.directions[0]!.param, 'tune')
  assert.equal(s.directions[0]!.direction, 'higher')
})

test('suggest without lane info keeps the old kind-level behavior (legacy drums cold start = kick)', () => {
  const s = suggestNext([], 'olddrums', { file: 'song.beat', trackKind: 'drums' })
  assert.equal(s.coldStart, true)
  assert.equal(s.recommendedGroup, 'kick') // correct on a LEGACY drums track — those params play there
})

// Pilot 103: the declared-lane guard alone wasn't enough — a drums-only group on a SYNTH track
// (vary lead kick) silently mutated lead.kickTune/..., params a synth track never plays. Same
// inaudible-no-op family, one track-kind over. Kind-illegal groups now error loudly.
test('varyTrack rejects a kind-illegal group (drums-only group on a synth track)', () => {
  const doc = initDocument({ bpm: 120 })
  assert.throws(() => varyTrack(doc, 'lead', 'kick'), /mutates drums-track params that a synth track never plays.*legal groups for "lead"/)
})
