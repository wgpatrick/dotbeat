// v0.10 grammar tests — Phase 23 Stream BE: Auto Filter / Auto Pan / Tremolo / Utility (four new
// ADDITIVE EffectType members in Stream AA's reorderable chain, docs/phase-22-stream-aa.md) plus
// Redux's downsampling half (bitcrushRate — a NEW FIELD on the EXISTING `bitcrush` type, not a
// fifth new type; see docs/phase-23-stream-be.md for the reasoning). The contract under test:
//   - EFFECT_TYPES widens to 8, but defaultEffectChain() — the migration/canonical-elision target
//     — stays EXACTLY the original 4 (eq3/comp/distortion/bitcrush); no existing/pre-BE file
//     changes shape on parse/serialize (this is the correctness point a naive "derive
//     defaultEffectChain from EFFECT_TYPES" implementation would silently break)
//   - each new type can be added/removed/reordered/bypassed through the same generic primitives
//     Stream AA built (addEffect/removeEffect/moveEffect/setEffectEnabled) — no per-type code
//   - every new field (bitcrushRate + autoFilter*/autoPan*/tremolo*/utility*) follows the standard
//     SYNTH_FIELDS canonical-elision contract: present-at-default => no line; present-off-default
//     => one line; round-trips losslessly
//   - diffDocuments/beat inspect treat the new types exactly like the original 4 (matched by id,
//     no special-casing)

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
  setEffectEnabled,
  setValue,
  describeDocument,
  defaultEffectChain,
  EFFECT_TYPES,
  AUTOMATABLE_SYNTH_PARAMS,
  BeatEditError,
} from '../src/core/index.js'

function freshSynthTrack() {
  const { doc } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  return doc
}

test('EFFECT_TYPES includes Stream BE\'s four new types (autoFilter/autoPan/tremolo/utility — a sibling stream, BF, has since widened the enum further with its own types, so this checks inclusion, not exact membership) but defaultEffectChain() stays exactly the original 4', () => {
  for (const t of ['eq3', 'comp', 'distortion', 'bitcrush', 'autoFilter', 'autoPan', 'tremolo', 'utility']) {
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

test('a fresh synth track still elides all effect lines (widened EFFECT_TYPES did not change what "default" means)', () => {
  const doc = freshSynthTrack()
  const text = serialize(doc)
  assert.equal(text.includes('effect '), false)
  assert.equal(text.includes('effects none'), false)
})

for (const type of ['autoFilter', 'autoPan', 'tremolo', 'utility'] as const) {
  test(`addEffect('${type}') round-trips through parse/serialize and lands in the chain`, () => {
    const before = freshSynthTrack()
    const { doc, effect } = addEffect(before, 'lead2', type)
    assert.equal(effect.type, type)
    assert.equal(effect.id, type) // mints the type name when unclaimed, same as eq3/comp/etc.
    const text = serialize(doc)
    assert.match(text, new RegExp(`effect ${type} ${type}\\b`))
    const round = parse(text)
    const track = round.tracks.find((t) => t.id === 'lead2')!
    assert.deepEqual(
      track.effects.map((e) => e.id),
      ['eq3', 'comp', 'distortion', 'bitcrush', type],
    )
    assert.equal(serialize(round), text) // idempotent
  })
}

test('the four new types support remove/bypass/diff exactly like the original four (no per-type special-casing)', () => {
  const before = freshSynthTrack()
  const { doc: withTremolo } = addEffect(before, 'lead2', 'tremolo', { id: 'trem1' })
  const { doc: bypassed } = setEffectEnabled(withTremolo, 'lead2', 'trem1', false)
  const text = serialize(bypassed)
  assert.match(text, /effect trem1 tremolo bypassed/)
  const round = parse(text)
  const trem = round.tracks.find((t) => t.id === 'lead2')!.effects.find((e) => e.id === 'trem1')!
  assert.equal(trem.enabled, false)

  const { doc: removed } = removeEffect(bypassed, 'lead2', 'trem1')
  assert.equal(
    removed.tracks.find((t) => t.id === 'lead2')!.effects.some((e) => e.id === 'trem1'),
    false,
  )

  const entries = diffDocuments(before, withTremolo)
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.kind, 'effect-added')
  assert.match(formatDiff(entries), /effect added trem1/)
})

// Phase 26 Stream DC: drum tracks now accept effect-add for every type, including these four
// (previously synth-tracks-only) — only the unknown-type rejection and audio tracks still throw.
test('addEffect rejects an unknown type and audio tracks; drums now accepts these four too', () => {
  const before = freshSynthTrack()
  assert.throws(() => addEffect(before, 'lead2', 'reverb' as never), BeatEditError)
  const { doc: drums } = addTrack(before, { id: 'drums', kind: 'drums' })
  const { effect } = addEffect(drums, 'drums', 'autoPan')
  assert.equal(effect.type, 'autoPan')
  const { doc: audioDoc } = addTrack(before, { id: 'atrk', kind: 'audio' })
  assert.throws(() => addEffect(audioDoc, 'atrk', 'autoPan'), BeatEditError)
})

test('Auto Filter / Auto Pan / Tremolo / Utility params follow the standard canonical-elision contract', () => {
  const before = freshSynthTrack()
  let doc = addEffect(before, 'lead2', 'autoFilter').doc
  doc = setValue(doc, 'lead2.autoFilterRate', '2.5')
  doc = setValue(doc, 'lead2.autoFilterMix', '0.6')
  doc = setValue(doc, 'lead2.utilityWidth', '0.9')
  doc = setValue(doc, 'lead2.utilityGain', '-3')
  const text = serialize(doc)
  assert.match(text, /autoFilterRate 2\.5/)
  assert.match(text, /autoFilterMix 0\.6/)
  assert.match(text, /utilityWidth 0\.9/)
  assert.match(text, /utilityGain -3/)
  // Untouched fields at their canonical defaults stay elided.
  assert.equal(text.includes('autoPanRate'), false)
  assert.equal(text.includes('tremoloMix'), false)
  assert.equal(text.includes('autoFilterOctaves'), false) // default 2.6, untouched
  const round = parse(text)
  assert.equal(serialize(round), text)
  const t = round.tracks.find((x) => x.id === 'lead2')!.synth as unknown as Record<string, number>
  assert.equal(t.autoFilterRate, 2.5)
  assert.equal(t.autoFilterMix, 0.6)
  assert.equal(t.utilityWidth, 0.9)
  assert.equal(t.utilityGain, -3)
})

test('Redux (bitcrushRate) rides the EXISTING bitcrush type — no fifth new EffectType, field elides at 1 (off)', () => {
  const before = freshSynthTrack()
  const text0 = serialize(before)
  assert.equal(text0.includes('bitcrushRate'), false) // default chain already has a bitcrush entry; field itself still elides at default
  const doc = setValue(before, 'lead2.bitcrushRate', '6')
  const text = serialize(doc)
  assert.match(text, /bitcrushRate 6/)
  // Still exactly the 4 default effect ids/types — bitcrushRate is a FIELD, not a chain entry.
  assert.deepEqual(
    doc.tracks.find((t) => t.id === 'lead2')!.effects.map((e) => e.type),
    ['eq3', 'comp', 'distortion', 'bitcrush'],
  )
  const round = parse(text)
  assert.equal(serialize(round), text)
  assert.equal((round.tracks.find((t) => t.id === 'lead2')!.synth as unknown as Record<string, number>).bitcrushRate, 6)
})

test('all 15 new numeric fields are automation-lane-capable for free (AUTOMATABLE_SYNTH_PARAMS auto-derives)', () => {
  for (const key of [
    'bitcrushRate',
    'autoFilterRate',
    'autoFilterDepth',
    'autoFilterOctaves',
    'autoFilterBaseFrequency',
    'autoFilterMix',
    'autoPanRate',
    'autoPanDepth',
    'autoPanMix',
    'tremoloRate',
    'tremoloDepth',
    'tremoloSpread',
    'tremoloMix',
    'utilityWidth',
    'utilityGain',
  ]) {
    assert.equal(AUTOMATABLE_SYNTH_PARAMS.includes(key), true, `${key} should be automatable`)
  }
})

test('beat inspect shows the widened chain, including the new types', () => {
  const before = freshSynthTrack()
  const { doc } = addEffect(before, 'lead2', 'utility', { id: 'util1' })
  const text = describeDocument(doc)
  assert.match(text, /effects: eq3\(eq3\) -> comp\(comp\) -> distortion\(distortion\) -> bitcrush\(bitcrush\) -> util1\(utility\)/)
})
