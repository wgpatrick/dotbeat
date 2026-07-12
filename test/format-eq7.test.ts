// v0.10 grammar tests — eq7, the 7-band parametric EQ (Phase 23 Stream BD, docs/phase-23-stream-bd.md).
// eq7 is an ADDITIVE new EffectType alongside eq3/comp/distortion/bitcrush (Phase 22 Stream AA's
// reorderable per-track effect chain, docs/phase-22-stream-aa.md) — this file follows the exact
// same round-trip discipline as test/format-v10-effects.test.ts, scoped to what's NEW here:
//   - eq7's 26 fields (7 *On flags, HP/LP freq+slope+Q, 2 shelf freq+gain, 3 bell freq+gain+Q) are
//     plain SYNTH_FIELDS, so they get canonical elision, `beat set`, and clip automation for free —
//     tested directly rather than re-testing the generic SYNTH_FIELDS machinery test/format-v03
//     already covers.
//   - the load-bearing regression: adding 'eq7' to EFFECT_TYPES must NOT change
//     defaultEffectChain()/isDefaultEffectChain() — every pre-existing synth track (migrated or
//     freshly created) must still elide to zero effect lines with exactly the old 4-entry chain,
//     no phantom eq7 insert.
//   - eq7 slots into the existing add/remove/move/bypass/diff/inspect machinery with zero special
//     casing (it's just another EffectType) — a light smoke test per primitive, not a re-test of
//     the primitives themselves (already covered for eq3/comp/distortion/bitcrush).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parse,
  serialize,
  diffDocuments,
  formatDiff,
  addTrack,
  initDocument,
  addEffect,
  setEffectEnabled,
  setValue,
  describeDocument,
  defaultEffectChain,
  isDefaultEffectChain,
  EFFECT_TYPES,
  EQ_FILTER_SLOPES,
  BeatParseError,
  BeatEditError,
} from '../src/core/index.js'

function freshSynthDoc() {
  const { doc } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  return doc
}

test('eq7 is a valid EFFECT_TYPES member, additive to the original four (sibling streams BE/BF have since widened the enum further with their own types, so this checks inclusion, not exact membership)', () => {
  for (const t of ['eq3', 'comp', 'distortion', 'bitcrush', 'eq7']) {
    assert.ok((EFFECT_TYPES as readonly string[]).includes(t), `EFFECT_TYPES should include "${t}"`)
  }
})

test('defaultEffectChain() / isDefaultEffectChain() are UNCHANGED by adding eq7 — no phantom insert on any existing track', () => {
  const chain = defaultEffectChain()
  assert.deepEqual(
    chain.map((e) => [e.id, e.type, e.enabled]),
    [
      ['eq3', 'eq3', true],
      ['comp', 'comp', true],
      ['distortion', 'distortion', true],
      ['bitcrush', 'bitcrush', true],
    ],
  )
  assert.equal(isDefaultEffectChain(chain), true)
  assert.equal(chain.some((e) => e.type === 'eq7'), false)
})

test('a pre-v0.10 file with no effect lines migrates to the default chain (still no eq7) and re-serializes byte-identically', () => {
  const preV10 = `format_version 0.9
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
  synth
    osc sine
    volume 0
    cutoff 1000
    resonance 1
    attack 0.01
    decay 0.1
    sustain 0.5
    release 0.1
    pan 0
  note n1 60 0 4 0.8
`
  const doc = parse(preV10)
  const lead = doc.tracks[0]!
  assert.deepEqual(
    lead.effects.map((e) => e.type),
    ['eq3', 'comp', 'distortion', 'bitcrush'],
  )
  assert.equal(serialize(doc), preV10)
})

test('a fresh addTrack synth track carries the default (eq7-free) chain, elided on serialize', () => {
  const doc = freshSynthDoc()
  const t = doc.tracks.find((x) => x.id === 'lead2')!
  assert.deepEqual(t.effects, defaultEffectChain())
  assert.equal(serialize(doc).includes('effect '), false)
})

test('addEffect accepts eq7, mints the expected id, and serializes/round-trips as one effect line', () => {
  const before = freshSynthDoc()
  const { doc, effect } = addEffect(before, 'lead2', 'eq7')
  assert.equal(effect.id, 'eq7')
  assert.equal(effect.type, 'eq7')
  const text = serialize(doc)
  assert.match(text, /^\s*effect eq7 eq7\s*$/m)
  const round = parse(text)
  const lead = round.tracks.find((x) => x.id === 'lead2')!
  assert.deepEqual(
    lead.effects.map((e) => [e.id, e.type]),
    [
      ['eq3', 'eq3'],
      ['comp', 'comp'],
      ['distortion', 'distortion'],
      ['bitcrush', 'bitcrush'],
      ['eq7', 'eq7'],
    ],
  )
  assert.equal(serialize(round), text) // idempotent
})

test('eq7 bypass and diff/inspect all work with zero special-casing (same machinery as eq3/comp/etc.)', () => {
  const withEq7 = addEffect(freshSynthDoc(), 'lead2', 'eq7').doc
  const bypassed = setEffectEnabled(withEq7, 'lead2', 'eq7', false).doc
  const text = serialize(bypassed)
  assert.match(text, /effect eq7 eq7 bypassed/)
  const round = parse(text)
  assert.equal(round.tracks.find((t) => t.id === 'lead2')!.effects.find((e) => e.id === 'eq7')!.enabled, false)

  const entries = diffDocuments(freshSynthDoc(), withEq7)
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.kind, 'effect-added')
  assert.match(formatDiff(entries), /effect added eq7/)

  const inspected = describeDocument(withEq7)
  assert.match(inspected, /effects: eq3\(eq3\) -> comp\(comp\) -> distortion\(distortion\) -> bitcrush\(bitcrush\) -> eq7\(eq7\)/)
})

test('each eq7 field individually elides at its default and serializes as exactly one changed line when set', () => {
  const cases: { path: string; value: string; expectedLine: string }[] = [
    { path: 'lead2.eq7HpOn', value: 'true', expectedLine: '    eq7HpOn true' },
    { path: 'lead2.eq7HpFreq', value: '120', expectedLine: '    eq7HpFreq 120' },
    { path: 'lead2.eq7HpSlope', value: '48', expectedLine: '    eq7HpSlope 48' },
    { path: 'lead2.eq7HpQ', value: '2', expectedLine: '    eq7HpQ 2' },
    { path: 'lead2.eq7LowShelfOn', value: 'true', expectedLine: '    eq7LowShelfOn true' },
    { path: 'lead2.eq7LowShelfFreq', value: '300', expectedLine: '    eq7LowShelfFreq 300' },
    { path: 'lead2.eq7LowShelfGain', value: '6', expectedLine: '    eq7LowShelfGain 6' },
    { path: 'lead2.eq7Bell1On', value: 'true', expectedLine: '    eq7Bell1On true' },
    { path: 'lead2.eq7Bell1Freq', value: '500', expectedLine: '    eq7Bell1Freq 500' },
    { path: 'lead2.eq7Bell1Gain', value: '-4', expectedLine: '    eq7Bell1Gain -4' },
    { path: 'lead2.eq7Bell1Q', value: '3', expectedLine: '    eq7Bell1Q 3' },
    { path: 'lead2.eq7Bell2On', value: 'true', expectedLine: '    eq7Bell2On true' },
    { path: 'lead2.eq7Bell2Freq', value: '1500', expectedLine: '    eq7Bell2Freq 1500' },
    { path: 'lead2.eq7Bell2Gain', value: '5', expectedLine: '    eq7Bell2Gain 5' },
    { path: 'lead2.eq7Bell2Q', value: '0.5', expectedLine: '    eq7Bell2Q 0.5' },
    { path: 'lead2.eq7Bell3On', value: 'true', expectedLine: '    eq7Bell3On true' },
    { path: 'lead2.eq7Bell3Freq', value: '6000', expectedLine: '    eq7Bell3Freq 6000' },
    { path: 'lead2.eq7Bell3Gain', value: '3', expectedLine: '    eq7Bell3Gain 3' },
    { path: 'lead2.eq7Bell3Q', value: '4', expectedLine: '    eq7Bell3Q 4' },
    { path: 'lead2.eq7HighShelfOn', value: 'true', expectedLine: '    eq7HighShelfOn true' },
    { path: 'lead2.eq7HighShelfFreq', value: '9000', expectedLine: '    eq7HighShelfFreq 9000' },
    { path: 'lead2.eq7HighShelfGain', value: '-6', expectedLine: '    eq7HighShelfGain -6' },
    { path: 'lead2.eq7LpOn', value: 'true', expectedLine: '    eq7LpOn true' },
    { path: 'lead2.eq7LpFreq', value: '9000', expectedLine: '    eq7LpFreq 9000' },
    { path: 'lead2.eq7LpSlope', value: '96', expectedLine: '    eq7LpSlope 96' },
    { path: 'lead2.eq7LpQ', value: '1.5', expectedLine: '    eq7LpQ 1.5' },
  ]
  const base = freshSynthDoc()
  const baseLines = serialize(base).split('\n')
  for (const c of cases) {
    const doc = setValue(base, c.path, c.value)
    const lines = serialize(doc).split('\n')
    assert.equal(lines.length, baseLines.length + 1, `${c.path}: expected exactly one new line`)
    assert.equal(lines.includes(c.expectedLine), true, `${c.path}: expected line ${JSON.stringify(c.expectedLine)} in:\n${lines.join('\n')}`)
    // round-trips byte-identically
    assert.equal(serialize(parse(serialize(doc))), serialize(doc))
  }
})

test('setting every eq7 field non-default round-trips byte-identically as one block', () => {
  let doc = freshSynthDoc()
  const edits: [string, string][] = [
    ['eq7HpOn', 'true'], ['eq7HpFreq', '150'], ['eq7HpSlope', '48'], ['eq7HpQ', '1.2'],
    ['eq7LowShelfOn', 'true'], ['eq7LowShelfFreq', '250'], ['eq7LowShelfGain', '4'],
    ['eq7Bell1On', 'true'], ['eq7Bell1Freq', '600'], ['eq7Bell1Gain', '-3'], ['eq7Bell1Q', '2.5'],
    ['eq7Bell2On', 'true'], ['eq7Bell2Freq', '1800'], ['eq7Bell2Gain', '5.5'], ['eq7Bell2Q', '0.8'],
    ['eq7Bell3On', 'true'], ['eq7Bell3Freq', '7000'], ['eq7Bell3Gain', '-2'], ['eq7Bell3Q', '3.3'],
    ['eq7HighShelfOn', 'true'], ['eq7HighShelfFreq', '10000'], ['eq7HighShelfGain', '3'],
    ['eq7LpOn', 'true'], ['eq7LpFreq', '11000'], ['eq7LpSlope', '96'], ['eq7LpQ', '1.8'],
  ]
  for (const [key, value] of edits) doc = setValue(doc, `lead2.${key}`, value)
  const text = serialize(doc)
  const round = parse(text)
  assert.deepEqual(round, doc)
  assert.equal(serialize(round), text)
})

test('eq7HpSlope/eq7LpSlope only accept the 4 EQ_FILTER_SLOPES values', () => {
  assert.deepEqual(EQ_FILTER_SLOPES, ['12', '24', '48', '96'])
  const doc = freshSynthDoc()
  assert.throws(() => setValue(doc, 'lead2.eq7HpSlope', '32'), BeatEditError)
  const ok = setValue(doc, 'lead2.eq7HpSlope', '96')
  assert.equal(ok.tracks.find((t) => t.id === 'lead2')!.synth.eq7HpSlope, '96')
})

test('a hand-written file using eq7 in its effect chain parses and round-trips', () => {
  const text = `format_version 0.10
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
  synth
    osc sine
    volume 0
    cutoff 1000
    resonance 1
    attack 0.01
    decay 0.1
    sustain 0.5
    release 0.1
    pan 0
    eq7HpOn true
    eq7HpFreq 90
    eq7Bell2On true
    eq7Bell2Gain 6
  effect eq7 eq7
  effect eq3 eq3
  note n1 60 0 4 0.8
`
  const doc = parse(text)
  const lead = doc.tracks[0]!
  assert.deepEqual(
    lead.effects.map((e) => e.type),
    ['eq7', 'eq3'],
  )
  assert.equal(lead.synth.eq7HpOn, true)
  assert.equal(lead.synth.eq7HpFreq, 90)
  assert.equal(lead.synth.eq7Bell2On, true)
  assert.equal(lead.synth.eq7Bell2Gain, 6)
  assert.equal(serialize(doc), text)
})

test('effect type validation rejects an unknown type but accepts eq7', () => {
  const doc = freshSynthDoc()
  assert.throws(() => addEffect(doc, 'lead2', 'nope' as never), BeatEditError)
  const { effect } = addEffect(doc, 'lead2', 'eq7', { id: 'my_eq7' })
  assert.equal(effect.id, 'my_eq7')
})

test('BeatParseError still rejects an unknown effect type in a hand-written file', () => {
  const bad = `format_version 0.10
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
  synth
    osc sine
    volume 0
    cutoff 1000
    resonance 1
    attack 0.01
    decay 0.1
    sustain 0.5
    release 0.1
    pan 0
  effect weird weird
  note n1 60 0 4 0.8
`
  assert.throws(() => parse(bad), BeatParseError)
})
