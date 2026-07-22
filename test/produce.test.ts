// Produced defaults (src/analysis/produce.ts, plan item A1 — docs/research/115). Unit-tests the
// role-aware production layer directly, against docs built with the ordinary edit primitives:
//   - profiles differ by role, and map through productionRoleFor;
//   - every move is intensify-only (a patch already past a target keeps its own value);
//   - bass/sub are mono-anchored (no width fields, no reverb send) — the §2.2 invariant;
//   - the emitted patch is a deterministic function of (role, tier), byte-stable per caller;
//   - the applied[] list is honest (an entry iff a field actually changed);
//   - osc-bank / utility / auto-pan moves are synth-only (sample/drum voices don't read them).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { initDocument, addTrack, setValue, serialize } from '../src/core/index.js'
import {
  productionRoleFor,
  productionProfileFor,
  applyProducedDefaults,
  BeatProduceError,
  type ProductionRole,
} from '../src/analysis/index.js'

// initDocument seeds one default synth track — name it directly for a single-synth-track doc.
const synthDoc = (id: string) => initDocument({ loopBars: 1, trackId: id })
const drumsDoc = (id: string) => addTrack(initDocument({ loopBars: 1, trackId: '__base' }), { id, kind: 'drums', name: id }).doc
const synthOf = (doc: ReturnType<typeof synthDoc>, id: string) => doc.tracks.find((t) => t.id === id)!.synth

// ---- productionRoleFor: track id / gen-kit role name -> production role -----------------------

test('productionRoleFor maps names (and synonyms) onto roles, unknowns to default', () => {
  const cases: [string, ProductionRole][] = [
    ['kick', 'kick'], ['snare', 'snare'], ['clap', 'snare'], ['hats', 'hats'], ['hihat', 'hats'],
    ['perc', 'perc'], ['tom', 'perc'], ['bass', 'bass'], ['sub', 'sub'], ['lead', 'lead'],
    ['arp', 'lead'], ['pluck', 'lead'], ['pad', 'pad'], ['chords', 'chords'], ['keys', 'chords'],
    ['kit', 'kit'], ['drums', 'kit'], ['KICK', 'kick'], ['wobblegizmo', 'default'],
  ]
  for (const [id, role] of cases) assert.equal(productionRoleFor(id), role, `${id} -> ${role}`)
})

// ---- profiles differ by role -----------------------------------------------------------------

test('profiles differ by role: lead is the full width stack, kick is dry, kit is air+glue only', () => {
  const lead = productionProfileFor('lead')
  const kick = productionProfileFor('kick')
  const kit = productionProfileFor('kit')
  // lead: the full 2-4-layer width stack + space + air
  assert.ok(lead.osc2Layer && lead.unison && lead.chorusMix !== undefined && lead.utilityWidth !== undefined)
  assert.ok(lead.sendReverb !== undefined && lead.eqHigh !== undefined)
  // kick: dry/mono/punchy — only a touch of saturation, no width/space/air
  assert.equal(kick.osc2Layer, undefined)
  assert.equal(kick.unison, undefined)
  assert.equal(kick.chorusMix, undefined)
  assert.equal(kick.utilityWidth, undefined)
  assert.equal(kick.sendReverb, undefined)
  assert.equal(kick.eqHigh, undefined)
  assert.ok(kick.saturator)
  // kit (drum BUS carrying the kick): air shelf + light glue, but NO width / reverb / auto-pan
  assert.ok(kit.eqHigh !== undefined && kit.saturator)
  assert.equal(kit.utilityWidth, undefined)
  assert.equal(kit.sendReverb, undefined)
  assert.equal(kit.autoPan, undefined)
})

// ---- §2.2: bass/sub are mono-anchored ---------------------------------------------------------

test('bass/sub carry no width fields and no reverb send (mono-anchored low end, §2.2)', () => {
  for (const role of ['bass', 'sub'] as const) {
    const p = productionProfileFor(role)
    assert.equal(p.osc2Layer, undefined, `${role} no osc2 width`)
    assert.equal(p.unison, undefined, `${role} no unison`)
    assert.equal(p.chorusMix, undefined, `${role} no chorus`)
    assert.equal(p.utilityWidth, undefined, `${role} no utility width`)
    assert.equal(p.sendReverb, undefined, `${role} no reverb send`)
    assert.equal(p.autoPan, undefined, `${role} no auto-pan`)
    assert.ok(p.saturator, `${role} keeps saturation (mid/top harmonics)`)
  }
})

test('applyProducedDefaults never widens or wets a bass track', () => {
  let doc = synthDoc('bass')
  doc = applyProducedDefaults(doc, 'bass', productionProfileFor('bass')).doc
  const s = synthOf(doc, 'bass')
  assert.equal(s.osc2Level, 0, 'no osc2 layer')
  assert.equal(s.unisonVoices, 1, 'no unison voices')
  assert.equal(s.chorusMode, 'off', 'no chorus')
  assert.equal(s.utilityWidth, 0.5, 'utility width stays neutral')
  assert.equal(s.sendReverb, 0, 'no reverb send')
  assert.ok(s.saturatorDrive > 0, 'but saturation is applied')
  // the utility insert must not have been added either
  assert.ok(!doc.tracks.find((t) => t.id === 'bass')!.effects.some((e) => e.type === 'utility' && e.enabled))
})

// ---- intensify-only: Math.max against the patch's own settings --------------------------------

test('intensify-only: a patch already past a target keeps its own richer value', () => {
  let doc = synthDoc('lead')
  // Pre-load the lead patch with production RICHER than the genkit lead profile's targets.
  doc = setValue(doc, 'lead.saturatorDrive', '0.9')
  doc = setValue(doc, 'lead.saturatorMix', '0.9')
  doc = setValue(doc, 'lead.sendReverb', '0.8')
  doc = setValue(doc, 'lead.eqHigh', '9')
  doc = setValue(doc, 'lead.chorusMode', 'chorus')
  doc = setValue(doc, 'lead.chorusMix', '0.9')
  const before = synthOf(doc, 'lead')
  const res = applyProducedDefaults(doc, 'lead', productionProfileFor('lead'))
  const after = synthOf(res.doc, 'lead')
  // every already-richer field is preserved exactly
  assert.equal(after.saturatorDrive, before.saturatorDrive)
  assert.equal(after.saturatorMix, before.saturatorMix)
  assert.equal(after.sendReverb, before.sendReverb)
  assert.equal(after.eqHigh, before.eqHigh)
  assert.equal(after.chorusMix, before.chorusMix)
  // none of those preserved fields show up as "applied" — the list is honest about no-ops
  assert.ok(!res.applied.some((a) => /saturator|sendReverb|eqHigh|chorus/.test(a)), res.applied.join('; '))
  // it never QUIETS anything: no field decreased
  assert.ok(after.saturatorDrive >= before.saturatorDrive && after.sendReverb >= before.sendReverb)
})

test('applied[] is empty when the profile asks for nothing the patch lacks', () => {
  let doc = synthDoc('lead')
  // apply once — now the patch already carries every genkit-lead target
  doc = applyProducedDefaults(doc, 'lead', productionProfileFor('lead')).doc
  // apply the SAME profile again: nothing left to intensify
  const res = applyProducedDefaults(doc, 'lead', productionProfileFor('lead'))
  assert.deepEqual(res.applied, [], `second application is a no-op, got: ${res.applied.join('; ')}`)
  assert.equal(serialize(res.doc), serialize(doc), 'and the document is unchanged')
})

test('applied[] names exactly the moves that changed the patch (lead, from dry)', () => {
  const res = applyProducedDefaults(synthDoc('lead'), 'lead', productionProfileFor('lead'))
  const joined = res.applied.join('; ')
  for (const move of ['osc2 layer', 'unison', 'chorus', 'utility width', 'saturator', 'sendReverb', 'sendDelay', 'eqHigh']) {
    assert.match(joined, new RegExp(move), `lead from dry should report "${move}"`)
  }
})

// ---- determinism -----------------------------------------------------------------------------

test('deterministic: same (role, tier) -> identical profile and identical produced document', () => {
  for (const role of ['kick', 'lead', 'pad', 'hats', 'bass', 'kit'] as const) {
    assert.deepEqual(productionProfileFor(role), productionProfileFor(role))
    const a = applyProducedDefaults(synthDoc(role), role, productionProfileFor(role))
    const b = applyProducedDefaults(synthDoc(role), role, productionProfileFor(role))
    assert.equal(serialize(a.doc), serialize(b.doc), `${role} produced doc is byte-stable`)
    assert.deepEqual(a.applied, b.applied)
  }
})

test('seed tier is a scaled-down (headroom-keeping) version of the genkit tier', () => {
  const full = productionProfileFor('lead')
  const seed = productionProfileFor('lead', { tier: 'seed' })
  assert.ok(seed.eqHigh! < full.eqHigh!, 'seed air shelf is lower')
  assert.ok(seed.sendReverb! < full.sendReverb!, 'seed reverb send is lower')
  assert.ok(seed.saturator!.mix < full.saturator!.mix, 'seed glue is lighter')
  // deterministic without an rng
  assert.deepEqual(productionProfileFor('lead', { tier: 'seed' }), productionProfileFor('lead', { tier: 'seed' }))
})

// ---- synth-only moves vs sample/drum voices --------------------------------------------------

test('osc-bank / utility / auto-pan moves apply to synth voices only, not drum/sample tracks', () => {
  // a hats profile carries an air shelf + reverb send + auto-pan; on a drums-kind track the auto-pan
  // insert-move must NOT apply (sample voices do not read the reorderable synth chain), while the
  // shelf and the send — which act on the summed track output — still do.
  const res = applyProducedDefaults(drumsDoc('hats'), 'hats', productionProfileFor('hats'))
  const s = res.doc.tracks.find((t) => t.id === 'hats')!.synth
  assert.equal(s.autoPanMix, 0, 'no auto-pan on a drums track')
  assert.ok(!res.doc.tracks.find((t) => t.id === 'hats')!.effects.some((e) => e.type === 'autoPan' && e.enabled))
  assert.ok(s.eqHigh > 0, 'air shelf still applies (summed output)')
  assert.ok(s.sendReverb > 0, 'reverb send still applies (bus)')
  assert.ok(!res.applied.some((a) => /autoPan/.test(a)), 'and applied[] does not claim the auto-pan')
})

test('a caller-supplied duck wires only when its source track exists', () => {
  let doc = synthDoc('bass')
  doc = addTrack(doc, { id: 'kit', kind: 'drums', name: 'kit' }).doc
  const profile = { ...productionProfileFor('bass'), duck: { source: 'kit', amount: 0.35 } }
  const res = applyProducedDefaults(doc, 'bass', profile)
  assert.equal(res.doc.tracks.find((t) => t.id === 'bass')!.synth.duckSource, 'kit')
  assert.ok(res.applied.some((a) => /duck source kit/.test(a)))
  // with a missing source, the duck is silently skipped (never points at a non-existent track)
  const missing = applyProducedDefaults(synthDoc('bass'), 'bass', { ...productionProfileFor('bass'), duck: { source: 'ghost', amount: 0.35 } })
  assert.equal(missing.doc.tracks.find((t) => t.id === 'bass')!.synth.duckSource, null)
  assert.ok(!missing.applied.some((a) => /duck/.test(a)))
})

// ---- errors ----------------------------------------------------------------------------------

test('applyProducedDefaults rejects a missing track and non-voiced track kinds', () => {
  assert.throws(() => applyProducedDefaults(synthDoc('lead'), 'nope', productionProfileFor('lead')), BeatProduceError)
})
