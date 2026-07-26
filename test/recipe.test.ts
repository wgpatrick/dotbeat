// Contract tests for the executable recipe library (src/recipes/, presets/recipes.json;
// docs/research/139 §4). Four groups, mirroring test/trick.test.ts's structure:
//
//  1. SCHEMA — the shipped catalog passes eager validation, and a synthetic recipe that names a
//     parameter or a gate metric the format does not have fails LOUDLY. This is the contract that
//     makes a SYNTH_FIELDS rename a CI failure instead of a silently-wrong render.
//  2. BUILD — every shipped recipe executes end-to-end into a serializable, re-parseable document,
//     with the right track count, register, and feel; and the build is DETERMINISTIC (same recipe
//     + key + seed => byte-identical document), because a recipe whose build wanders cannot carry
//     a verify receipt.
//  3. VERIFY — gates report pass/fail/pending correctly, pending gates are never silently passed,
//     and a `verified` status is unreachable while any gate is pending.
//  4. END-TO-END — recipe -> document -> metrics -> gate report, over a synthesized render, so the
//     whole loop is exercised without needing headless Chromium (which `npm test` does not have).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse, serialize, SYNTH_FIELD_BY_KEY, SYNTH_PARAM_ORDER } from '../src/core/index.js'
import { analyze, analyzeRich } from '../src/metrics/index.js'
import { metricsToFeatures, FEATURE_KEYS } from '../src/metrics/features.js'
import {
  BeatRecipeError,
  buildRecipeDoc,
  checkRecipeGates,
  formatGateReport,
  formatRecipeCard,
  formatRecipeList,
  isPendingGateKey,
  parseRecipeLibrary,
  recipeFieldExists,
  soloLayer,
  swingPctToShuffleAmount,
  isPatchSource,
  PENDING_GATE_KEYS,
  RECIPE_ARCHETYPE_BANKS,
  type Recipe,
} from '../src/recipes/index.js'

const libraryPath = fileURLToPath(new URL('../presets/recipes.json', import.meta.url))
const libraryJson = readFileSync(libraryPath, 'utf8')
const RECIPES = parseRecipeLibrary(libraryJson)

const KEY = { root: 50, minor: true } as const

/** A minimal, valid recipe; tests corrupt one field then assert parseRecipeLibrary rejects it. */
function validRecipe(over: Record<string, unknown> = {}): unknown {
  return {
    name: 'probe',
    version: 1,
    role: 'bassline',
    tags: ['test'],
    character: 'a probe',
    sources: [{ cite: 'test', claim: 'the numbers', confidence: 'measured-refs' }],
    figure: { archetype: 'rolling-8ths', register: [28, 33], feel: {} },
    layers: [{ id: 'sub', kind: 'synth', why: 'the foundation', patch: { osc: 'sine', cutoff: 90 } }],
    chain: [],
    gates: { bandSubPct: [30, 80] },
    provenance: { status: 'sourced', gatesMinedFrom: { refs: 'test', stat: 'test', asOf: '2026-07-26' }, verifyReceipt: null, blindRecord: [] },
    ...over,
  }
}

const lib = (recipe: unknown): string => JSON.stringify({ version: 1, recipes: [recipe] })

// ---- 1. schema ---------------------------------------------------------------------------------

test('the shipped catalog parses and passes eager validation (13 recipes, all four roles)', () => {
  assert.equal(RECIPES.length, 13, 'recipe count changed — update this assertion deliberately, the way tricks pins its own')
  const roles = new Set(RECIPES.map((r) => r.role))
  for (const role of ['bassline', 'chords', 'lead', 'drum-loop']) assert.ok(roles.has(role as Recipe['role']), `no recipe covers the ${role} role`)
  // the two flagship layered architectures 139 §6.1 asks for
  assert.ok(
    RECIPES.filter((r) => r.layers.length >= 3).length >= 2,
    'the library must carry at least two genuinely layered (3+ track) architectures — that is the structurally-unexplored region 139 exists to open',
  )
})

test('every parameter every recipe names exists in the live format vocabulary', () => {
  // The contract that makes a SYNTH_FIELDS rename a loud CI failure. parseRecipeLibrary already
  // enforces it at load; this re-asserts it independently so the check cannot be quietly removed
  // from the loader without a test going red.
  const legal = new Set<string>([...SYNTH_PARAM_ORDER, ...[...SYNTH_FIELD_BY_KEY.keys()]])
  for (const recipe of RECIPES) {
    for (const layer of recipe.layers) {
      if (isPatchSource(layer.patch)) continue
      for (const key of Object.keys(layer.patch)) {
        assert.ok(legal.has(key), `${recipe.name}.${layer.id} names "${key}", which is not a dotbeat synth parameter`)
      }
    }
    for (const step of recipe.chain) {
      if (!('set' in step)) continue
      const field = step.set.split('.')[1]!
      assert.ok(recipeFieldExists(field), `${recipe.name} chain sets "${field}", which is not a settable dotbeat parameter`)
    }
    for (const dial of recipe.dials ?? []) {
      if (dial.field !== undefined) assert.ok(recipeFieldExists(dial.field), `${recipe.name} dial "${dial.name}" names field "${dial.field}", which does not exist`)
    }
  }
})

test('every gate references a real metric — computable today, or an explicitly declared pending one', () => {
  const computable = new Set<string>(FEATURE_KEYS)
  const pending = new Set<string>(PENDING_GATE_KEYS)
  let pendingCount = 0
  for (const recipe of RECIPES) {
    const all: [string, string][] = Object.keys(recipe.gates).map((m) => ['', m])
    for (const layer of recipe.layers) for (const m of Object.keys(layer.gates ?? {})) all.push([layer.id, m])
    assert.ok(all.length > 0, `${recipe.name} declares no gates`)
    for (const [scope, metric] of all) {
      assert.ok(computable.has(metric) || pending.has(metric), `${recipe.name}${scope ? '.' + scope : ''} gates on unknown metric "${metric}"`)
      if (pending.has(metric)) pendingCount += 1
    }
    // Every recipe must carry at least one gate that is checkable TODAY, or the checker gives no
    // signal at all until 138's B0 feature upgrade lands.
    assert.ok(Object.keys(recipe.gates).some((m) => computable.has(m)), `${recipe.name} has no clip gate computable today — it would be unverifiable in every render`)
  }
  assert.ok(pendingCount > 0, 'no recipe reaches for a 131 §4 discriminator — the library should be encoding targets ahead of the instrument, not only behind it')
})

test('every gate band is well-formed and every archetype belongs to its role bank', () => {
  for (const recipe of RECIPES) {
    for (const [metric, band] of Object.entries(recipe.gates)) {
      assert.ok(band[0] <= band[1], `${recipe.name}.${metric} band is inverted`)
      assert.ok(Number.isFinite(band[0]) && Number.isFinite(band[1]), `${recipe.name}.${metric} band is not finite`)
    }
    const bank = RECIPE_ARCHETYPE_BANKS[recipe.role]
    assert.ok(recipe.figure.archetype === 'any' || bank.includes(recipe.figure.archetype), `${recipe.name} names archetype "${recipe.figure.archetype}", absent from the ${recipe.role} bank`)
  }
})

test('every recipe carries provenance: cited sources, a gate origin, and a stated confidence per claim', () => {
  for (const recipe of RECIPES) {
    assert.ok(recipe.sources.length > 0, `${recipe.name} cites nothing`)
    assert.ok(
      recipe.sources.some((s) => s.confidence === 'measured-refs' || s.confidence === 'measured-patches'),
      `${recipe.name} cites no MEASURED source — 139 §1.3's rule is structure from the corpus, numbers from the measurements`,
    )
    assert.ok(recipe.provenance.gatesMinedFrom.refs.length > 0 && recipe.provenance.gatesMinedFrom.asOf.length > 0)
    for (const layer of recipe.layers) assert.ok(layer.why.trim().length > 0, `${recipe.name}.${layer.id} states no job`)
  }
})

test('a dial always encodes a value inside its own recorded range, and says what the disagreement was', () => {
  for (const recipe of RECIPES) {
    for (const dial of recipe.dials ?? []) {
      assert.ok(dial.value >= dial.range[0] && dial.value <= dial.range[1], `${recipe.name}.${dial.name} encodes ${dial.value} outside [${dial.range[0]}, ${dial.range[1]}]`)
      assert.ok(dial.note.length > 40, `${recipe.name}.${dial.name} must record WHICH sources disagreed and how the value was chosen`)
    }
  }
  // the three contradictions the commission named explicitly must all be preserved as dials
  const dialNames = RECIPES.flatMap((r) => (r.dials ?? []).map((d) => `${r.name}.${d.name}`))
  assert.ok(dialNames.includes('reese-bass.reeseDetuneCents'), 'the Reese detune ±7…±61¢ disagreement must survive as a sweep dial, not be silently averaged')
  assert.ok(dialNames.includes('warm-pad-with-air.padDetuneCents'), 'the sub-4¢ "warmth vs defect" disagreement must survive as a sweep dial')
  assert.ok(dialNames.includes('layered-house-kit.swingPct'), 'the 50–80% swing disagreement must survive as a sweep dial')
})

test('a recipe naming a parameter the format does not have is rejected loudly', () => {
  assert.throws(
    () => parseRecipeLibrary(lib(validRecipe({ layers: [{ id: 'x', kind: 'synth', why: 'w', patch: { transientShaperAttack: 0.5 } }] }))),
    (err: Error) => err instanceof BeatRecipeError && /not a dotbeat synth parameter/.test(err.message) && /gaps/.test(err.message),
  )
})

test('a recipe gating on a metric nothing computes or plans to compute is rejected loudly', () => {
  assert.throws(
    () => parseRecipeLibrary(lib(validRecipe({ gates: { grooveFeel: [0, 1] } }))),
    (err: Error) => err instanceof BeatRecipeError && /unknown gate metric/.test(err.message),
  )
})

test('a gate written as a scalar maximum instead of a band is rejected — bands are the anti-Goodhart shape', () => {
  assert.throws(() => parseRecipeLibrary(lib(validRecipe({ gates: { bandSubPct: 30 } }))), BeatRecipeError)
  assert.throws(() => parseRecipeLibrary(lib(validRecipe({ gates: { bandSubPct: [80, 30] } }))), /inverted/)
})

test('`verified` status is unreachable while any gate names a metric the pipeline cannot compute', () => {
  const withPending = validRecipe({
    gates: { bandSubPct: [30, 80], fluxMean: [0.1, 0.4] },
    provenance: { status: 'verified', gatesMinedFrom: { refs: 't', stat: 't', asOf: '2026-07-26' }, verifyReceipt: {}, blindRecord: [] },
  })
  assert.throws(() => parseRecipeLibrary(lib(withPending)), (err: Error) => err instanceof BeatRecipeError && /B0/.test(err.message))
  // the same recipe at `sourced` is legal — encoding targets ahead of the instrument is the point
  assert.doesNotThrow(() => parseRecipeLibrary(lib(validRecipe({ gates: { bandSubPct: [30, 80], fluxMean: [0.1, 0.4] } }))))
})

test('a layer with no stated job, an unknown effect type, or a dangling $ref is rejected', () => {
  assert.throws(() => parseRecipeLibrary(lib(validRecipe({ layers: [{ id: 'x', kind: 'synth', patch: { osc: 'sine' } }] }))), /why is required/)
  assert.throws(() => parseRecipeLibrary(lib(validRecipe({ chain: [{ effectAdd: '$sub', type: 'transientShaper' }] }))), /type must be one of/)
  assert.throws(() => parseRecipeLibrary(lib(validRecipe({ chain: [{ set: '$nope.cutoff', value: 100 }] }))), /unknown layer/)
  assert.throws(() => parseRecipeLibrary(lib(validRecipe({ chain: [{ set: '$sub.duckSource', value: 'ghost' }] }))), /not a layer or an added track/)
})

test('the library envelope is versioned and names are unique', () => {
  assert.throws(() => parseRecipeLibrary(JSON.stringify({ version: 2, recipes: [] })), /version must be 1/)
  assert.throws(() => parseRecipeLibrary(JSON.stringify({ version: 1, recipes: [validRecipe(), validRecipe()] })), /duplicate recipe name/)
  assert.throws(() => parseRecipeLibrary('not json'), /not valid JSON/)
})

// ---- 2. build ----------------------------------------------------------------------------------

test('every shipped recipe builds into a document that serializes and re-parses', () => {
  for (const recipe of RECIPES) {
    const { doc, report } = buildRecipeDoc(recipe, { key: KEY, seed: 7 })
    const text = serialize(doc)
    assert.doesNotThrow(() => parse(text), `${recipe.name} produced a document the parser rejects`)
    // one track per layer, plus any trackAdd steps
    const added = recipe.chain.filter((s) => 'trackAdd' in s).length
    assert.equal(doc.tracks.length, recipe.layers.length + added, `${recipe.name} track count`)
    for (const layer of recipe.layers) {
      const track = doc.tracks.find((t) => t.id === layer.id)
      assert.ok(track, `${recipe.name} is missing layer track "${layer.id}"`)
      const events = layer.kind === 'drums' ? track!.hits.length : track!.notes.length
      assert.ok(events > 0, `${recipe.name}.${layer.id} rendered silent (no notes/hits)`)
    }
    assert.equal(report.recipe, recipe.name)
  }
})

test('the build is deterministic — same recipe, key and seed, byte-identical document', () => {
  for (const recipe of RECIPES) {
    const a = serialize(buildRecipeDoc(recipe, { key: KEY, seed: 3 }).doc)
    const b = serialize(buildRecipeDoc(recipe, { key: KEY, seed: 3 }).doc)
    assert.equal(a, b, `${recipe.name} does not build deterministically`)
    // seed sensitivity: with the archetype pinned and velocity tiers fixed, a single alternate
    // seed can coincide, so sweep a few — a recipe that produces the SAME clip for every seed
    // would make every batch a duplicate.
    const varied = [4, 5, 6, 7, 8].some((seed) => serialize(buildRecipeDoc(recipe, { key: KEY, seed }).doc) !== a)
    assert.ok(varied, `${recipe.name} ignores its seed — every build would be the same clip`)
  }
})

test('a pitched recipe lands its figure inside the register window it declares', () => {
  for (const recipe of RECIPES) {
    if (recipe.role === 'drum-loop') continue
    const { doc } = buildRecipeDoc(recipe, { key: KEY, seed: 11 })
    const base = doc.tracks.find((t) => t.id === recipe.layers[0]!.id)!
    const pitches = base.notes.map((n) => n.pitch).sort((a, b) => a - b)
    const median = pitches[pitches.length >> 1]!
    const [lo, hi] = recipe.figure.register
    // the shift is by whole OCTAVES, so the median lands within a semitone-of-an-octave of the
    // window rather than exactly inside it — assert it is closer than an octave either side.
    assert.ok(median >= lo - 12 && median <= hi + 12, `${recipe.name} figure median ${median} is more than an octave outside its register [${lo}, ${hi}]`)
  }
})

test('per-layer transposition is real — a layer declaring +12 renders an octave above layer 0', () => {
  const stack = RECIPES.find((r) => r.name === 'three-layer-bass-stack')!
  const { doc } = buildRecipeDoc(stack, { key: KEY, seed: 5 })
  const sub = doc.tracks.find((t) => t.id === 'sub')!
  const body = doc.tracks.find((t) => t.id === 'body')!
  const growl = doc.tracks.find((t) => t.id === 'growl')!
  assert.equal(sub.notes.length, body.notes.length)
  for (let i = 0; i < sub.notes.length; i++) {
    assert.equal(body.notes[i]!.pitch - sub.notes[i]!.pitch, 12, 'body layer must sit exactly one octave over the sub')
    assert.equal(growl.notes[i]!.pitch - sub.notes[i]!.pitch, 24, 'growl layer must sit exactly two octaves over the sub')
    assert.equal(body.notes[i]!.start, sub.notes[i]!.start, 'layers must share ONE figure, not three')
  }
})

test('swing maps onto the format\'s own shuffleAmount by exact identity, not approximation', () => {
  // moebiusEase(0.5, h) === h, and shuffleH(a) = 0.5 + a/2, so swingPct/100 = 0.5 + amount/2.
  assert.equal(swingPctToShuffleAmount(50), 0)
  assert.ok(Math.abs(swingPctToShuffleAmount(66.7) - 0.334) < 1e-9)
  assert.equal(swingPctToShuffleAmount(75), 0.5)
  const kit = RECIPES.find((r) => r.name === 'layered-house-kit')!
  const { doc } = buildRecipeDoc(kit, { key: KEY, seed: 2 })
  assert.equal(doc.tracks.find((t) => t.id === 'kit')!.shuffleAmount, swingPctToShuffleAmount(62.5))
})

test('the kick-clearance rule actually clears the kick, and the ghost pump track is silent and wired', () => {
  const rolling = RECIPES.find((r) => r.name === 'rolling-sub-bass')!
  const { doc, report } = buildRecipeDoc(rolling, { key: KEY, seed: 9 })
  const mid = doc.tracks.find((t) => t.id === 'mid')!
  for (const n of mid.notes) assert.notEqual(Math.round(n.start) % 4, 0, 'a note landed on the beat-1 16th the recipe reserves for the kick')
  assert.ok(report.feelApplied.some((f) => /restBeatOneSixteenth/.test(f)))
  const pump = doc.tracks.find((t) => t.id === 'pump')!
  assert.equal(pump.kind, 'drums')
  assert.equal(pump.synth.volume, -60, 'the ghost kick must be inaudible — it exists only to trigger the duck')
  assert.ok(pump.hits.length > 0)
  assert.equal(mid.synth.duckSource, 'pump')
  assert.ok(mid.synth.duckAmount > 0)
})

test('a patch SOURCE (retargeting) refuses to build rather than silently rendering the wrong sound', () => {
  const retargeted = validRecipe({
    layers: [{ id: 'sub', kind: 'synth', why: 'w', patch: { from: 'surge:Basses', retarget: { bandSubPct: [40, 80] } } }],
  })
  const [recipe] = parseRecipeLibrary(lib(retargeted))
  assert.throws(() => buildRecipeDoc(recipe!, { key: KEY, seed: 1 }), (err: Error) => err instanceof BeatRecipeError && /sibling stream/.test(err.message))
})

test('soloing a layer mutes every sibling to the showdown floor', () => {
  const stack = RECIPES.find((r) => r.name === 'three-layer-bass-stack')!
  const { doc } = buildRecipeDoc(stack, { key: KEY, seed: 1 })
  const solo = soloLayer(doc, 'growl')
  for (const t of solo.tracks) assert.equal(t.synth.volume === -60, t.id !== 'growl', `${t.id} volume is wrong under solo`)
})

// ---- 3. verify ---------------------------------------------------------------------------------

const zeroFeatures = () => Object.fromEntries(FEATURE_KEYS.map((k) => [k, 0])) as Record<string, number>

test('a gate on a metric FEATURE_KEYS cannot compute yet reports `pending`, never `pass`', () => {
  const recipe = RECIPES.find((r) => r.name === 'rolling-sub-bass')!
  const pendingMetrics = Object.keys(recipe.gates).filter(isPendingGateKey)
  assert.ok(pendingMetrics.length > 0, 'this fixture must carry at least one pending gate')
  const report = checkRecipeGates(recipe, { clip: zeroFeatures() as never })
  for (const m of pendingMetrics) {
    const row = report.results.find((r) => r.scope === '' && r.metric === m)!
    assert.equal(row.status, 'pending', `${m} must report pending, not silently pass`)
    assert.equal(row.measured, null)
  }
  assert.notEqual(report.verdict, 'pass', 'a report containing a pending gate can never read as a clean pass')
})

test('a measured value inside its band passes, outside it fails, with the distance reported', () => {
  const recipe = RECIPES.find((r) => r.name === 'techno-stab')!
  const inBand = { ...zeroFeatures(), bandMidsPct: 60, bandPresencePct: 10, crestDb: 15, stereoWidthDb: -8 }
  const passing = checkRecipeGates(recipe, { clip: inBand as never })
  assert.equal(passing.counts.fail, 0, formatGateReport(passing))
  const outOfBand = { ...inBand, crestDb: 30 }
  const failing = checkRecipeGates(recipe, { clip: outOfBand as never })
  const row = failing.results.find((r) => r.metric === 'crestDb')!
  assert.equal(row.status, 'fail')
  assert.equal(row.measured, 30)
  assert.equal(row.distance, 30 - recipe.gates['crestDb']![1])
  assert.equal(failing.verdict, 'fail')
  assert.match(formatGateReport(failing), /FINDING/, 'the report must say out loud that a failing gate is a finding, not a reason to widen the band')
})

test('an unrendered scope reports `unmeasured` rather than passing by default', () => {
  const recipe = RECIPES.find((r) => r.name === 'three-layer-bass-stack')!
  const report = checkRecipeGates(recipe, { clip: null })
  assert.ok(report.counts.unmeasured > 0)
  assert.equal(report.counts.pass, 0)
  assert.equal(report.receipt, null)
})

test('a fully-computable, fully-in-band check yields a receipt', () => {
  const base = RECIPES.find((r) => r.name === 'techno-stab')!
  const recipe: Recipe = { ...base, gates: { crestDb: [10, 20] }, layers: base.layers.map((l) => ({ ...l, gates: undefined })) }
  const report = checkRecipeGates(recipe, { clip: { ...zeroFeatures(), crestDb: 15 } as never })
  assert.equal(report.verdict, 'pass')
  assert.deepEqual(report.receipt, { crestDb: 15 })
})

// ---- 4. end-to-end -----------------------------------------------------------------------------

/** Synthesize a stereo signal whose spectral shape is known, so the whole recipe -> features ->
 * gate-report loop runs without a real render (headless Chromium is not available to `npm test`).
 * The real render path is `cli/render.mjs`, exercised by `beat recipe check` on disk. */
function syntheticRender(partials: readonly { hz: number; amp: number }[], seconds = 4, sampleRate = 48000): { channels: Float64Array[]; sampleRate: number } {
  const n = Math.round(seconds * sampleRate)
  const l = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2 * t)
    let v = 0
    for (const p of partials) v += p.amp * Math.sin(2 * Math.PI * p.hz * t)
    l[i] = env * v
  }
  // identical channels: the bass recipes' whole width doctrine is "dead mono", so a mono render
  // is the honest fixture, not a limitation of the harness.
  return { channels: [l, Float64Array.from(l)], sampleRate }
}

test('end to end: recipe -> document -> analyzed audio -> gate report with measured values beside targets', () => {
  const recipe = RECIPES.find((r) => r.name === 'rolling-sub-bass')!
  // 1. execute
  const { doc, report: build } = buildRecipeDoc(recipe, { key: KEY, seed: 42 })
  assert.doesNotThrow(() => parse(serialize(doc)))
  assert.equal(doc.tracks.length, 3)

  // 2. measure a signal that DOES satisfy the recipe's register intent (a 45 Hz fundamental sits
  //    in the sub band, which is the whole point of rows 1–2 of 138's free-wins table)
  const sub = syntheticRender([{ hz: 45, amp: 0.4 }, { hz: 180, amp: 0.25 }])
  const features = metricsToFeatures(analyze(sub.channels, sub.sampleRate), analyzeRich(sub.channels, sub.sampleRate))

  // 3. verify
  const check = checkRecipeGates(recipe, { clip: features })
  const subRow = check.results.find((r) => r.scope === '' && r.metric === 'bandSubPct')!
  assert.equal(subRow.status, 'pass', `a 45 Hz tone must satisfy the sub-share gate; got ${subRow.measured}`)
  assert.ok(typeof subRow.measured === 'number' && subRow.measured > 30)
  const centroid = check.results.find((r) => r.metric === 'centroidLog2')!
  assert.equal(centroid.status, 'pass', 'a 45 Hz tone must satisfy the centroid ceiling')

  // 4. the same recipe against a signal in the WRONG register fails loudly rather than sliding by
  const wrong = syntheticRender([{ hz: 900, amp: 0.4 }, { hz: 2700, amp: 0.25 }])
  const wrongCheck = checkRecipeGates(recipe, { clip: metricsToFeatures(analyze(wrong.channels, wrong.sampleRate), analyzeRich(wrong.channels, wrong.sampleRate)) })
  assert.equal(wrongCheck.verdict, 'fail')
  assert.ok(wrongCheck.results.some((r) => r.metric === 'bandSubPct' && r.status === 'fail'))

  // 5. and the report is human-readable, with the pending keys visible rather than hidden
  const text = formatGateReport(check)
  assert.match(text, /rolling-sub-bass v1 \(bassline\)/)
  assert.match(text, /PEND/)
  assert.ok(build.gaps.length > 0, 'this recipe records real expressibility gaps and the build report must carry them')
})

test('the formatters render every shipped recipe without throwing', () => {
  assert.match(formatRecipeList(RECIPES), /13 recipes/)
  for (const recipe of RECIPES) {
    const card = formatRecipeCard(recipe)
    assert.match(card, new RegExp(recipe.name))
    assert.match(card, /sources/)
    assert.match(card, /clip gates/)
  }
})
