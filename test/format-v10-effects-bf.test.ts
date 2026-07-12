// v0.10 grammar tests — Phase 23 Stream BF's three additive EffectType members (Grain Delay,
// Vinyl Distortion, Resonators), closing research 17 §5's "meaningfully bigger lift" list Phase
// 22 Stream AC deferred. Same discipline as test/format-v10-effects.test.ts (Stream AA's own
// suite), scoped to what's NEW here:
//   - EFFECT_TYPES now has seven members, but defaultEffectChain()/isDefaultEffectChain() are
//     UNCHANGED — the legacy four-type default must stay exactly what it was, or every pre-v0.10
//     file's migration/byte-identical-round-trip guarantee (Stream AA's whole point) would break.
//   - the three new types are legal `effect-add` targets, parse/serialize/diff exactly like the
//     original four (fully generic machinery — no parser/serializer changes were needed).
//   - the three new SYNTH_FIELDS groups (grainDelay*/vinyl*/resonator*) follow the same
//     canonical-elision discipline as every other insert's params.

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
  removeEffect,
  moveEffect,
  setEffectEnabled,
  setValue,
  describeDocument,
  defaultEffectChain,
  EFFECT_TYPES,
  SYNTH_FIELDS,
  BeatParseError,
  BeatEditError,
} from '../src/core/index.js'

const CORE_SYNTH = `  synth
    osc sine
    volume 0
    cutoff 1000
    resonance 1
    attack 0.01
    decay 0.1
    sustain 0.5
    release 0.1
    pan 0`

test('EFFECT_TYPES gained the three new types (a sibling stream, BE, has since widened the enum further with its own types, so this checks inclusion, not exact membership), but defaultEffectChain() is untouched (still exactly the legacy four)', () => {
  for (const t of ['eq3', 'comp', 'distortion', 'bitcrush', 'grainDelay', 'vinylDistortion', 'resonator']) {
    assert.ok((EFFECT_TYPES as readonly string[]).includes(t), `EFFECT_TYPES should include "${t}"`)
  }
  assert.deepEqual(
    defaultEffectChain().map((e) => [e.id, e.type, e.enabled]),
    [
      ['eq3', 'eq3', true],
      ['comp', 'comp', true],
      ['distortion', 'distortion', true],
      ['bitcrush', 'bitcrush', true],
    ],
  )
})

test('a pre-v0.10 file with no effect lines still migrates to the legacy default chain only — the three new types never appear implicitly', () => {
  const text = `format_version 0.9
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  note n1 60 0 4 0.8
`
  const doc = parse(text)
  const lead = doc.tracks[0]!
  assert.equal(lead.effects.length, 4)
  assert.equal(
    lead.effects.some((e) => e.type === 'grainDelay' || e.type === 'vinylDistortion' || e.type === 'resonator'),
    false,
  )
  assert.equal(serialize(doc), text) // still byte-identical — Stream AA's contract, unbroken by this stream
})

test('addEffect accepts all three new types and they round-trip through parse/serialize', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  let doc = withTrack
  doc = addEffect(doc, 'lead2', 'grainDelay').doc
  doc = addEffect(doc, 'lead2', 'vinylDistortion').doc
  doc = addEffect(doc, 'lead2', 'resonator').doc
  const text = serialize(doc)
  assert.match(text, /effect grainDelay grainDelay/)
  assert.match(text, /effect vinylDistortion vinylDistortion/)
  assert.match(text, /effect resonator resonator/)
  const round = parse(text)
  const lead2 = round.tracks.find((t) => t.id === 'lead2')!
  assert.deepEqual(
    lead2.effects.map((e) => [e.id, e.type]),
    [
      ['eq3', 'eq3'],
      ['comp', 'comp'],
      ['distortion', 'distortion'],
      ['bitcrush', 'bitcrush'],
      ['grainDelay', 'grainDelay'],
      ['vinylDistortion', 'vinylDistortion'],
      ['resonator', 'resonator'],
    ],
  )
  assert.equal(serialize(round), text) // idempotent
})

test('a hand-written file using one of the new types parses, and rejects an unknown type the same way as before', () => {
  const text = `format_version 0.10
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  effect r1 resonator
  note n1 60 0 4 0.8
`
  const doc = parse(text)
  assert.deepEqual(
    doc.tracks[0]!.effects.map((e) => [e.id, e.type]),
    [['r1', 'resonator']],
  )
  assert.equal(serialize(doc), text)

  const bad = text.replace('effect r1 resonator', 'effect r1 corpus')
  assert.throws(() => parse(bad), /unknown effect type "corpus"/)
})

test('removeEffect/moveEffect/setEffectEnabled work on the new types exactly like the original four', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  const { doc: added } = addEffect(withTrack, 'lead2', 'vinylDistortion', { id: 'vny' })
  const { doc: moved, after } = moveEffect(added, 'lead2', 'vny', 0)
  assert.equal(after, 0)
  assert.equal(moved.tracks.find((t) => t.id === 'lead2')!.effects[0]!.id, 'vny')
  const { doc: bypassed } = setEffectEnabled(moved, 'lead2', 'vny', false)
  assert.match(serialize(bypassed), /effect vny vinylDistortion bypassed/)
  const { doc: removed } = removeEffect(bypassed, 'lead2', 'vny')
  assert.equal(
    removed.tracks.find((t) => t.id === 'lead2')!.effects.some((e) => e.id === 'vny'),
    false,
  )
})

test('diffDocuments and beat inspect report the new types identically to the original four', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  const a = withTrack
  const { doc: b } = addEffect(a, 'lead2', 'grainDelay', { id: 'grd' })
  const entries = diffDocuments(a, b)
  assert.deepEqual(entries, [{ kind: 'effect-added', trackId: 'lead2', effect: { id: 'grd', type: 'grainDelay', enabled: true } }])
  assert.match(formatDiff(entries), /effect added grd \(grainDelay\)/)
  assert.match(describeDocument(b), /grd\(grainDelay\)/)
})

test('the three new SYNTH_FIELDS groups follow canonical elision (default = no line; non-default = one line)', () => {
  const fields = ['grainDelayTime', 'grainDelayFeedback', 'grainDelaySize', 'grainDelayPitch', 'grainDelayMix', 'vinylDrive', 'vinylNoiseLevel', 'vinylTone', 'vinylMix', 'resonatorFreq', 'resonatorChord', 'resonatorQ', 'resonatorMix']
  const known = new Set<string>(SYNTH_FIELDS.map((f) => f.key))
  for (const f of fields) assert.equal(known.has(f), true, `${f} missing from SYNTH_FIELDS`)

  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  const before = serialize(withTrack)
  assert.equal(before.includes('grainDelayMix'), false)
  assert.equal(before.includes('vinylMix'), false)
  assert.equal(before.includes('resonatorMix'), false)

  const withGrain = setValue(withTrack, 'lead2.grainDelayMix', '0.5')
  const afterLines = serialize(withGrain).split('\n')
  const beforeLines = before.split('\n')
  assert.equal(afterLines.length, beforeLines.length + 1)
  assert.deepEqual(
    afterLines.filter((l) => !beforeLines.includes(l)),
    ['    grainDelayMix 0.5'],
  )
  // back to default removes the line again — one canonical form per state
  assert.equal(serialize(setValue(withGrain, 'lead2.grainDelayMix', '0')), before)
})

test('resonatorChord is a real validated enum (beat set / parse both reject an unknown value)', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  assert.throws(() => setValue(withTrack, 'lead2.resonatorChord', 'pentatonic'), BeatEditError)
  const set = setValue(withTrack, 'lead2.resonatorChord', 'harmonic')
  assert.equal(set.tracks.find((t) => t.id === 'lead2')!.synth.resonatorChord, 'harmonic')
  assert.match(serialize(set), /resonatorChord harmonic/)

  const bad = `format_version 0.10
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
    resonatorChord pentatonic
`
  assert.throws(() => parse(bad), BeatParseError)
})

// Phase 26 Stream DC (docs/phase-26-plan.md Stream DC): drum tracks now carry the same reorderable
// `effects` chain synth tracks do (folded in from the old fixed bus insert order), so they can
// `effect-add` any of the 12 EffectType members, including the three Stream BF added here — only
// audio tracks (no live/non-clip content at all) still reject effect-add.
test('drum tracks can now carry the new effect types too (folded into the same reorderable chain)', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'drums', kind: 'drums' })
  const { doc, effect } = addEffect(withTrack, 'drums', 'resonator')
  assert.equal(effect.type, 'resonator')
  assert.deepEqual(
    doc.tracks.find((t) => t.id === 'drums')!.effects.map((e) => e.type),
    ['eq3', 'comp', 'distortion', 'bitcrush', 'resonator'],
  )
  const { doc: audioDoc } = addTrack(withTrack, { id: 'atrk', kind: 'audio' })
  assert.throws(() => addEffect(audioDoc, 'atrk', 'resonator'), BeatEditError)
})
