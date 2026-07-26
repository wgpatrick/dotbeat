// Arm pairing for the figure-source experiment: two showdown arms run at the SAME `--seed` must
// agree on every nuisance variable — source doc (and therefore key), ref chop, engine patch, gen
// and keymap prompts and generation seeds — and differ ONLY in the composed figure.
//
// WHY THIS FILE EXISTS. Round 6 (2026-07-25) compared bank vs theory vs ca2 under a script header
// reading "One variable — where the figure comes from." It ran the three arms at three DIFFERENT
// seeds (93001 / 93002 / 93003), so for the bassline cell alone: ca2 composed over seed-007.beat
// with patch roll-bassline-234 against ref NOIZU_sub_loop_06, theory over seed-008.beat with
// roll-bassline-102 against NOIZU_125_choppy, bank over seed-006.beat with roll-bassline-402
// against NOIZU_sub_loop_03 — plus a different gen prompt each. Arm was confounded with source doc,
// engine patch, reference clip and gen prompt, and the round was unreadable.
//
// Same-seed pairing was verified empirically (three stub `beat showdown` runs at --seed 777 over
// bassline+chords, bank/theory/ca2: identical batch seed, seed doc, key, ref path, engine preset,
// gen prompt and keymap prompt in all three manifests). But it held only by accident of statement
// order — the seven nuisance draws happened to sit above every arm-conditional branch on a single
// sequential rng walked across the whole run, so ONE new `rng()` call lower in that ~500-line loop
// body would have shifted every subsequent batch (src/core/rng.ts's stated hazard). This file pins
// both halves of the fix: the draw is a pure keyed function, and the CLI loop calls no rng at all.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { drawShowdownBatchPlan, composePitchedPhrase, inferSeedKey, type ShowdownBatchPlan } from '../src/taste/showdown.js'
import { composeTheoryPhrase } from '../src/taste/theory.js'
import { pickEnginePreset } from '../src/taste/enginePresets.js'
import { parsePresetLibrary } from '../src/core/preset.js'
import { generateSeedBeat } from '../src/taste/seeds.js'
import { parse } from '../src/core/index.js'

const plan = (o: Partial<Parameters<typeof drawShowdownBatchPlan>[0]> = {}): ShowdownBatchPlan =>
  drawShowdownBatchPlan({ metaSeed: 777, round: 0, role: 'bassline', styleCount: 6, candidateCount: 8, ...o })

test('the batch plan is deterministic in (metaSeed, round, role)', () => {
  assert.deepEqual(plan(), plan())
  assert.notDeepEqual(plan(), plan({ metaSeed: 778 }))
  assert.notDeepEqual(plan(), plan({ round: 1 }))
  assert.notDeepEqual(plan(), plan({ role: 'chords' }))
})

test('the batch plan takes no arm parameter, so two figure sources at one seed cannot diverge', () => {
  // The property is structural: `drawShowdownBatchPlan`'s options type has exactly these five keys
  // and none of them can carry the figure source, the optional arms, or the gen backend. If a future
  // edit threads an arm through, this assertion is what fails.
  const keys = ['metaSeed', 'round', 'role', 'styleCount', 'candidateCount']
  const spy = new Proxy(
    { metaSeed: 777, round: 0, role: 'bassline', styleCount: 6, candidateCount: 8 } as Record<string, unknown>,
    {
      get(target, prop: string) {
        assert.ok(keys.includes(prop), `the batch plan read an unexpected option "${prop}" — nuisance draws must not depend on the arm`)
        return target[prop]
      },
    },
  )
  assert.deepEqual(drawShowdownBatchPlan(spy as unknown as Parameters<typeof drawShowdownBatchPlan>[0]), plan())
})

test('the plan is keyed on the ROLE NAME, so a round can be re-run one role at a time', () => {
  // `--roles chords` alone and `--roles bassline,chords` must produce the identical chords batch.
  // Under the old sequential stream chords' draws depended on how many roles preceded it, so a
  // per-role re-run after a failure silently produced a DIFFERENT batch.
  assert.deepEqual(plan({ role: 'chords' }), plan({ role: 'chords' }))
  assert.notEqual(plan({ role: 'chords' }).batchSeed, plan({ role: 'lead' }).batchSeed)
})

test('plan indices stay inside the pools they address', () => {
  for (let metaSeed = 1; metaSeed <= 200; metaSeed++) {
    for (const role of ['bassline', 'chords', 'lead', 'drum-loop']) {
      const p = drawShowdownBatchPlan({ metaSeed, round: 0, role, styleCount: 6, candidateCount: 3 })
      assert.ok(p.styleIndex >= 0 && p.styleIndex < 6, `styleIndex ${p.styleIndex}`)
      assert.ok(p.kmStyleIndex >= 0 && p.kmStyleIndex < 6, `kmStyleIndex ${p.kmStyleIndex}`)
      assert.ok(p.seedIndex >= 0 && p.seedIndex < 3, `seedIndex ${p.seedIndex}`)
      for (const s of [p.batchSeed, p.genSeed, p.kmSeed, p.refPick]) {
        assert.ok(Number.isInteger(s) && s >= 0 && s < 100000, `seed out of range: ${s}`)
      }
    }
  }
})

test('an empty style or candidate pool fails loudly rather than indexing undefined', () => {
  assert.throws(() => drawShowdownBatchPlan({ metaSeed: 1, round: 0, role: 'bassline', styleCount: 0, candidateCount: 1 }), /style pool/)
  assert.throws(() => drawShowdownBatchPlan({ metaSeed: 1, round: 0, role: 'bassline', styleCount: 6, candidateCount: 0 }), /candidate seed song/)
})

test('golden plan values — the derivation is a reproducibility contract, not an implementation detail', () => {
  // Every batch already rated under a given --seed is reproducible only as long as this mapping
  // holds. Change it and historical batch dirs stop being regenerable; that is a deliberate act, so
  // it has to break a test with this comment on it rather than drift.
  assert.deepEqual(drawShowdownBatchPlan({ metaSeed: 41, round: 0, role: 'bassline', styleCount: 6, candidateCount: 8 }), {
    batchSeed: 93972,
    genSeed: 50509,
    kmSeed: 58909,
    styleIndex: 0,
    kmStyleIndex: 4,
    refPick: 58872,
    seedIndex: 5,
  })
})

test('downstream of the plan, the nuisance choices are arm-blind and only the figure moves', () => {
  // The end-to-end property, expressed on the pure functions the CLI feeds the plan into: hold the
  // plan fixed (i.e. same --seed, same round, same role) and swap the figure source. The source doc,
  // its inferred key and the engine preset must be byte-identical; the figure must not be.
  const p = plan({ role: 'bassline' })
  const FACTORY = parsePresetLibrary(readFileSync(new URL('../presets/factory.json', import.meta.url), 'utf8'))
  const candidates = Array.from({ length: 8 }, (_, i) => parse(generateSeedBeat(i + 1).text)).filter((d) => d.tracks.some((t) => t.id === 'bass'))
  assert.ok(candidates.length > 0, 'expected at least one generated seed song with a bass track')

  const forArm = (compose: (seed: number, key: ReturnType<typeof inferSeedKey>) => { archetype: string }) => {
    const doc = candidates[p.seedIndex % candidates.length]!
    const key = inferSeedKey(doc)
    const patch = pickEnginePreset({ role: 'bassline', seed: p.batchSeed, presets: FACTORY, curated: null })
    return { doc, key, patch, figure: compose(p.batchSeed, key).archetype, refPick: p.refPick, genSeed: p.genSeed }
  }
  const bank = forArm((seed, key) => composePitchedPhrase('bassline', key, seed))
  const theory = forArm((seed, key) => composeTheoryPhrase('bassline', key, seed))

  // nuisance variables: identical
  assert.equal(bank.doc, theory.doc, 'source doc differs between arms at one seed')
  assert.deepEqual(bank.key, theory.key, 'inferred key differs between arms at one seed')
  assert.ok(bank.patch !== null, 'expected the factory pool to yield a bassline preset — a null/null comparison proves nothing')
  assert.equal(bank.patch.name, theory.patch?.name, 'engine patch differs between arms at one seed')
  assert.equal(bank.refPick, theory.refPick, 'ref pick differs between arms at one seed')
  assert.equal(bank.genSeed, theory.genSeed, 'gen seed (and therefore the gen prompt) differs between arms at one seed')
  // the variable under test: different
  assert.notEqual(bank.figure, theory.figure, 'the two arms composed the same figure — nothing is being compared')
})

test('showdownCmd draws no randomness of its own — every nuisance value comes from the plan', () => {
  // The structural half. The batch loop is ~500 lines and most of it is arm-conditional; a single
  // `rng()` anywhere in it would re-introduce exactly the coupling this file exists to forbid.
  // dist/test -> repo root, the same hop test/cli-surface.test.ts uses (this file is compiled)
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const cli = readFileSync(join(repoRoot, 'cli', 'beat.mjs'), 'utf8')
  const start = cli.indexOf('async function showdownCmd(')
  assert.ok(start > 0, 'showdownCmd not found in cli/beat.mjs')
  const end = cli.indexOf('\nasync function ', start + 1)
  assert.ok(end > start, 'could not delimit showdownCmd')
  const body = cli.slice(start, end)

  assert.ok(body.includes('drawShowdownBatchPlan'), 'showdownCmd no longer uses the shared batch plan')
  assert.equal(/\brng\s*\(/.test(body), false, 'showdownCmd calls an rng directly — nuisance draws must come from drawShowdownBatchPlan')
  assert.equal(/\bmulberry32\b/.test(body), false, 'showdownCmd imports mulberry32 — it must not own a random stream')
  // and the seven nuisance values are bound from the plan, not recomputed
  for (const name of ['batchSeed', 'genSeed', 'kmSeed', 'refPick']) {
    assert.ok(new RegExp(`const \\{[^}]*\\b${name}\\b[^}]*\\} = plan`).test(body), `${name} is not destructured from the plan`)
  }
  for (const expr of ['styles[plan.styleIndex]', 'styles[plan.kmStyleIndex]', 'candidates[plan.seedIndex]']) {
    assert.ok(body.includes(expr), `showdownCmd does not take ${expr} from the plan`)
  }
})
