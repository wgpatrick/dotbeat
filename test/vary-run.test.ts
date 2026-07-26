// W1.3 (review R5-F2) — the vary render/normalize/audition tail, now owned once by
// src/vary/run.ts. These pin the four behaviours that had already DRIFTED across the six copies
// this module replaced, on the pure half (varyRenderPlan/varySeed/renderedLine) so they are
// testable without spawning a headless-Chromium render:
//
//   1. linkMediaFrom is always forwarded (pilot 111 — the CLI got the fix, MCP's param branch
//      didn't, and a group vary of a sample-using project rendered with silent lanes).
//   2. The pilot-113 volume-vs-normalization warning fires for BOTH surfaces (it lived on one of
//      the six copies).
//   3. Capture mode passes through (--live/--offline was CLI-only; beat_vary now takes `mode`).
//   4. The seed zero-guard (2 of 4 sites had it; a zero seed is reachable ~every 24.8 days).
//
// The end-to-end shape of the tail (that both surfaces call it at all, with the same inputs) is
// covered by test/mcp-parity.test.ts's table.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { varyRenderPlan, varySeed, renderedLine, type VaryTailOptions } from '../src/vary/run.js'

const PARAM_VARIANTS = [
  { edits: [{ path: 'lead.cutoff', value: '2100' }, { path: 'lead.resonance', value: '0.4' }] },
  { edits: [{ path: 'lead.cutoff', value: '3400' }, { path: 'lead.resonance', value: '0.8' }] },
]
const FEEL_VARIANTS = [{ recipe: 'humanize seed=5 timing=0.15 velocity=0.06' }]

function opts(over: Partial<VaryTailOptions> = {}): VaryTailOptions {
  return {
    file: '/proj/song.beat',
    outDir: '/proj/vary-filter-7',
    count: 2,
    variants: PARAM_VARIANTS,
    seed: 7,
    surface: 'cli',
    ...over,
  }
}

// ---- 1. linkMediaFrom is structural, not remembered ------------------------------------------

test('linkMediaFrom is always the parent .beat path — every plan, every surface, every mode (pilot 111)', () => {
  for (const surface of ['cli', 'mcp'] as const) {
    for (const over of [{}, { mode: 'live' as const }, { mode: 'offline' as const }, { normalize: false }, { variants: FEEL_VARIANTS, count: 1 }]) {
      const plan = varyRenderPlan(opts({ surface, ...over }))
      assert.equal(plan.render.linkMediaFrom, '/proj/song.beat', `linkMediaFrom missing for ${surface} ${JSON.stringify(over)}`)
    }
  }
})

// ---- 2. the pilot-113 volume warning, on both surfaces ---------------------------------------

test('a batch varying .volume with normalization on warns — identically on CLI and MCP (pilot 113)', () => {
  const volumeVariants = [{ edits: [{ path: 'lead.volume', value: '-12' }] }, { edits: [{ path: 'lead.volume', value: '-8' }] }]
  const cli = varyRenderPlan(opts({ variants: volumeVariants, surface: 'cli' }))
  const mcp = varyRenderPlan(opts({ variants: volumeVariants, surface: 'mcp' }))
  assert.equal(cli.warnings.length, 1)
  assert.match(cli.warnings[0]!, /varies volume, but loudness normalization will gain-match the renders/)
  assert.deepEqual(mcp.warnings, cli.warnings, 'the warning must not be a CLI-only courtesy — an agent hits the same confound')
})

test('the volume warning is silent when normalization is off (nothing to confound) and when no edit touches .volume', () => {
  const volumeVariants = [{ edits: [{ path: 'lead.volume', value: '-12' }] }]
  assert.deepEqual(varyRenderPlan(opts({ variants: volumeVariants, normalize: false })).warnings, [])
  assert.deepEqual(varyRenderPlan(opts()).warnings, [], 'filter edits do not touch volume')
  assert.deepEqual(varyRenderPlan(opts({ variants: FEEL_VARIANTS, count: 1 })).warnings, [], 'feel/automation variants carry a recipe, not edits')
})

test('the warning matches on the path SEGMENT, not a substring: lane paths ending .volume count, .volumes does not', () => {
  assert.equal(varyRenderPlan(opts({ variants: [{ edits: [{ path: 'drums.lane.kick.volume', value: '-3' }] }] })).warnings.length, 1)
  assert.equal(varyRenderPlan(opts({ variants: [{ edits: [{ path: 'lead.volumeless', value: '1' }] }] })).warnings.length, 0)
})

// ---- 3. capture mode + normalize passthrough -------------------------------------------------

test('capture mode passes through to renderVaryBatch, and is absent (renderer default) when unset', () => {
  assert.equal(varyRenderPlan(opts({ mode: 'live' })).render.mode, 'live')
  assert.equal(varyRenderPlan(opts({ mode: 'offline' })).render.mode, 'offline')
  assert.ok(!('mode' in varyRenderPlan(opts()).render), 'no mode key at all — render --batch picks its own default')
})

test('normalize false passes through; normalize unset stays absent so the default (normalize) applies', () => {
  assert.equal(varyRenderPlan(opts({ normalize: false })).render.normalize, false)
  assert.ok(!('normalize' in varyRenderPlan(opts()).render))
  assert.ok(!('normalize' in varyRenderPlan(opts({ normalize: true })).render))
})

test('the plan a CLI call and the equivalent MCP call produce is identical — the surface only names the next step', () => {
  const shared = { mode: 'offline' as const, normalize: false, audition: true }
  assert.deepEqual(varyRenderPlan(opts({ ...shared, surface: 'cli' })), varyRenderPlan(opts({ ...shared, surface: 'mcp' })))
  assert.match(renderedLine('/proj/b', 3, 'cli'), /beat score \/proj\/b <best> \[2nd 3rd\]/)
  assert.match(renderedLine('/proj/b', 3, 'mcp'), /record picks with beat_score/)
  assert.ok(renderedLine('/proj/b', 3, 'cli').startsWith('rendered 3 wavs into /proj/b/ — audition, then'))
})

// ---- audition ordering -----------------------------------------------------------------------

test('the audition shuffles from the batch seed by default and presents in generation order under noShuffle', () => {
  assert.equal(varyRenderPlan(opts({ seed: 41 })).shuffleSeed, 41)
  assert.equal(varyRenderPlan(opts({ seed: 41, noShuffle: true })).shuffleSeed, undefined)
})

// ---- 4. the seed zero-guard ------------------------------------------------------------------

test('varySeed honours an explicit seed verbatim (including 0 — an explicit choice is the caller\'s)', () => {
  assert.equal(varySeed(7), 7)
  assert.equal(varySeed(0), 0)
  assert.equal(varySeed(2147483646), 2147483646)
})

test('varySeed never returns 0 from the clock — the ~every-24.8-days degenerate seed two of four sites allowed', () => {
  const realNow = Date.now
  try {
    Date.now = () => 2147483647 // % 2147483647 === 0
    assert.equal(varySeed(), 1)
    Date.now = () => 2147483647 * 3 // and again on a later wrap
    assert.equal(varySeed(), 1)
    Date.now = () => 2147483647 + 12
    assert.equal(varySeed(), 12)
  } finally {
    Date.now = realNow
  }
})
