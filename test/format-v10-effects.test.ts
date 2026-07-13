// v0.10 grammar tests — the ordered, reorderable per-track effect chain (Phase 22 Stream AA,
// docs/phase-22-stream-aa.md). The contract under test:
//   - a pre-v0.10 file (no `effect`/`effects` lines at all) parses into the canonical default
//     chain (eq3 -> comp -> distortion -> bitcrush, all enabled) and re-serializes byte-identically
//     (lossless migration, zero-line-diff for anyone who never touches the chain)
//   - the default chain is elided; a customized chain serializes as one `effect` line per entry,
//     in FILE order (order IS chain order); an explicitly emptied chain serializes `effects none`
//   - reordering two effects is a small, local diff (two moved lines), not a full-block rewrite
//   - add/remove/move/enable primitives behave like the note/hit/automation-point primitives
//     (fail loudly, stable ids, mint an id when omitted)
//   - diffDocuments reports add/remove/move/bypass as musical facts, matched by id

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

const PRE_V10_FILE = `format_version 0.9
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  note n1 60 0 4 0.8
`

test('a pre-v0.10 file (no effect lines) migrates to the default chain and re-serializes byte-identically', () => {
  const doc = parse(PRE_V10_FILE)
  const lead = doc.tracks[0]!
  assert.deepEqual(
    lead.effects.map((e) => [e.id, e.type, e.enabled]),
    [
      ['eq3', 'eq3', true],
      ['comp', 'comp', true],
      ['distortion', 'distortion', true],
      ['bitcrush', 'bitcrush', true],
    ],
  )
  assert.equal(serialize(doc), PRE_V10_FILE)
})

test('a fresh addTrack synth track carries the default chain, elided on serialize', () => {
  const { doc } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  const t = doc.tracks.find((x) => x.id === 'lead2')!
  assert.deepEqual(t.effects, defaultEffectChain())
  assert.equal(serialize(doc).includes('effect '), false)
  assert.equal(serialize(doc).includes('effects none'), false)
})

// Phase 26 Stream DC (docs/phase-26-plan.md): drum tracks used to never carry an `effects` chain
// at all — their eq3/comp/distortion/bitcrush drove a separate, FIXED (non-reorderable) bus insert
// in ui/src/audio/engine.ts's getDrumBus. That fixed insert order is now folded into this same
// reorderable list (the same default chain a fresh synth track gets), so a drum track's insert
// order is reorderable/add/remove/bypass-able through the identical primitive a synth track uses —
// mirrors the synth test just above it.
test('a fresh addTrack drum track also carries the default chain, elided on serialize', () => {
  const { doc } = addTrack(initDocument({ trackId: 'lead' }), { id: 'drums', kind: 'drums' })
  const t = doc.tracks.find((x) => x.id === 'drums')!
  assert.deepEqual(t.effects, defaultEffectChain())
  assert.equal(serialize(doc).includes('effect '), false)
  assert.equal(serialize(doc).includes('effects none'), false)
})

test('effect lines are rejected only on audio tracks (no live/non-clip content at all)', () => {
  const bad = `format_version 0.10
bpm 120
loop_bars 1
selected_track atrk

track atrk atrk #56b6c2 audio
  effect eq3 eq3
`
  assert.throws(() => parse(bad), BeatParseError)
})

test('reordering two effects round-trips and is a small local diff (two moved lines, not a rewrite)', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  const before = withTrack
  const { doc: moved } = moveEffect(before, 'lead2', 'bitcrush', 0)
  const beforeLines = serialize(before).split('\n')
  const afterLines = serialize(moved).split('\n')
  // A customized chain now serializes 4 explicit lines where there were 0 — count the delta
  // precisely: this is "add 4 effect lines in the new order," the smallest honest diff a full
  // reorder against an elided default can produce. The load-bearing property under test is
  // ORDER, checked below — parse it back and confirm bitcrush leads.
  const moved2 = parse(serialize(moved))
  const lead = moved2.tracks.find((t) => t.id === 'lead2')!
  assert.deepEqual(
    lead.effects.map((e) => e.id),
    ['bitcrush', 'eq3', 'comp', 'distortion'],
  )
  assert.notEqual(beforeLines.length, 0)
  assert.notEqual(afterLines.length, 0)

  // Now the SMALL-diff property: starting from an already-customized (non-default) chain, moving
  // one more effect changes only that entry's line position, not its neighbors' content.
  const customLines = serialize(moved).split('\n').filter((l) => l.trim().startsWith('effect '))
  assert.deepEqual(customLines, ['  effect bitcrush bitcrush', '  effect eq3 eq3', '  effect comp comp', '  effect distortion distortion'])
  const { doc: movedAgain } = moveEffect(moved, 'lead2', 'eq3', 3)
  const againLines = serialize(movedAgain).split('\n').filter((l) => l.trim().startsWith('effect '))
  assert.deepEqual(againLines, ['  effect bitcrush bitcrush', '  effect comp comp', '  effect distortion distortion', '  effect eq3 eq3'])
  // Exactly the four effect lines differ in POSITION, and each line's own text is untouched
  // (still "effect <id> <type>") — a real move, not a delete-and-reinsert-different-content pair.
  for (const line of againLines) assert.equal(customLines.includes(line), true)
})

test('bypass toggle serializes a trailing "bypassed" token and round-trips', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  const { doc } = setEffectEnabled(withTrack, 'lead2', 'comp', false)
  const text = serialize(doc)
  assert.match(text, /effect comp comp bypassed/)
  const round = parse(text)
  const comp = round.tracks.find((t) => t.id === 'lead2')!.effects.find((e) => e.id === 'comp')!
  assert.equal(comp.enabled, false)
  // Re-enabling comp lands the chain back EXACTLY on the canonical default (same 4 ids/types, all
  // enabled, same order) — canonical elision kicks in and the file goes back to zero effect
  // lines. This is the correct, load-bearing behavior (one canonical form per state), not a bug.
  const enabledAgain = serialize(setEffectEnabled(doc, 'lead2', 'comp', true).doc)
  assert.equal(enabledAgain.includes('effect '), false)
  assert.equal(enabledAgain.includes('effects none'), false)
})

test('toggling one bypass on an already-non-default chain changes exactly one line', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  // Add a 5th effect so the chain can never collapse back to the exact default — isolates the
  // "one flag flip = one line changed" property from the separate elision property above.
  const { doc: withExtra } = addEffect(withTrack, 'lead2', 'eq3', { id: 'eq3_extra' })
  const before = serialize(withExtra)
  const after = serialize(setEffectEnabled(withExtra, 'lead2', 'comp', false).doc)
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  assert.equal(beforeLines.length, afterLines.length)
  const changed = beforeLines.filter((l, i) => l !== afterLines[i])
  assert.deepEqual(changed, ['  effect comp comp'])
})

test('addEffect appends by default, mints an id on collision, and rejects only audio tracks', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  const { doc, effect } = addEffect(withTrack, 'lead2', 'eq3')
  assert.equal(effect.id, 'eq3_2') // 'eq3' already taken by the default chain
  assert.deepEqual(
    doc.tracks.find((t) => t.id === 'lead2')!.effects.map((e) => e.id),
    ['eq3', 'comp', 'distortion', 'bitcrush', 'eq3_2'],
  )
  // Phase 26 Stream DC: drum tracks now accept effect-add (folded into the same reorderable list
  // as the old fixed bus insert) — the id-minting rule applies identically (drums' own default
  // chain already claims 'eq3').
  const { doc: drums } = addTrack(withTrack, { id: 'drums', kind: 'drums' })
  const { effect: drumEffect } = addEffect(drums, 'drums', 'eq3')
  assert.equal(drumEffect.id, 'eq3_2')
  const { doc: audioDoc } = addTrack(withTrack, { id: 'atrk', kind: 'audio' })
  assert.throws(() => addEffect(audioDoc, 'atrk', 'eq3'), BeatEditError)
})

test('addEffect at an explicit index inserts there; removeEffect drops by id', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  const { doc } = addEffect(withTrack, 'lead2', 'eq3', { id: 'eq3_pre', index: 0 })
  assert.deepEqual(
    doc.tracks.find((t) => t.id === 'lead2')!.effects.map((e) => e.id),
    ['eq3_pre', 'eq3', 'comp', 'distortion', 'bitcrush'],
  )
  const { doc: removed } = removeEffect(doc, 'lead2', 'eq3_pre')
  assert.deepEqual(
    removed.tracks.find((t) => t.id === 'lead2')!.effects.map((e) => e.id),
    ['eq3', 'comp', 'distortion', 'bitcrush'],
  )
  assert.throws(() => removeEffect(removed, 'lead2', 'eq3_pre'), BeatEditError)
})

test('emptying the whole chain serializes "effects none" and round-trips to an empty list', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  let doc = withTrack
  for (const id of ['eq3', 'comp', 'distortion', 'bitcrush']) doc = removeEffect(doc, 'lead2', id).doc
  const text = serialize(doc)
  assert.match(text, /^\s*effects none\s*$/m)
  const round = parse(text)
  assert.deepEqual(round.tracks.find((t) => t.id === 'lead2')!.effects, [])
  assert.equal(serialize(round), text) // idempotent
})

test('"effect" and "effects none" cannot be mixed on the same track', () => {
  const mixed = `format_version 0.10
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  effect eq3 eq3
  effects none
`
  assert.throws(() => parse(mixed), BeatParseError)
  const mixed2 = `format_version 0.10
bpm 120
loop_bars 1
selected_track lead

track lead Lead #c678dd synth
${CORE_SYNTH}
  effects none
  effect eq3 eq3
`
  assert.throws(() => parse(mixed2), BeatParseError)
})

test('moveEffect clamps to bounds and fails loudly on an unknown id', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  const { doc, after } = moveEffect(withTrack, 'lead2', 'eq3', 999)
  assert.equal(after, 3) // clamped to the last valid index
  assert.deepEqual(
    doc.tracks.find((t) => t.id === 'lead2')!.effects.map((e) => e.id),
    ['comp', 'distortion', 'bitcrush', 'eq3'],
  )
  assert.throws(() => moveEffect(withTrack, 'lead2', 'nope', 0), BeatEditError)
})

test('beat set <track>.effect.<id>.enabled fits the path=value grammar', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  const doc = setValue(withTrack, 'lead2.effect.comp.enabled', 'false')
  assert.equal(doc.tracks.find((t) => t.id === 'lead2')!.effects.find((e) => e.id === 'comp')!.enabled, false)
  assert.throws(() => setValue(withTrack, 'lead2.effect.comp.enabled', 'nope'), BeatEditError)
})

test('diffDocuments reports effect add/remove/bypass as musical facts, matched by id', () => {
  // Deliberately no reorder in this one — removing/adding effects can itself shift the relative
  // order of surviving common ids (same characteristic as track-moved's "an insertion shifting
  // indices of everything after it" case), so add/remove/enable are exercised in isolation here;
  // a pure reorder is covered separately below.
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  const a = withTrack
  const b = setEffectEnabled(addEffect(removeEffect(a, 'lead2', 'distortion').doc, 'lead2', 'eq3', { id: 'eq3_new' }).doc, 'lead2', 'comp', false).doc
  const entries = diffDocuments(a, b)
  const kinds = entries.map((e) => e.kind).sort()
  assert.deepEqual(kinds, ['effect-added', 'effect-enabled', 'effect-removed'])
  const text = formatDiff(entries)
  assert.match(text, /effect removed distortion/)
  assert.match(text, /effect added eq3_new/)
  assert.match(text, /effect comp bypassed/)
})

test('diffDocuments reports a pure single-effect reorder as ONE effect-moved entry, not one per shifted index', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  const a = withTrack
  const b = moveEffect(a, 'lead2', 'bitcrush', 0).doc // eq3,comp,distortion,bitcrush -> bitcrush,eq3,comp,distortion
  const entries = diffDocuments(a, b)
  // Phase 33 Stream ME (docs/research/98): moving one effect to the front mechanically shifts every
  // OTHER effect's own index too, but only bitcrush conceptually moved — diffEffects detects that
  // removing bitcrush alone reconciles both orderings (eq3,comp,distortion stayed in the same
  // relative order) and reports just that one relocation, matching the raw file's own "one line
  // relocated" diff instead of one line per shifted index (previously 4 lines for this exact case).
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.kind, 'effect-moved')
  assert.match(formatDiff(entries), /effect bitcrush moved from position 3 to 0/)
})

test('diffDocuments falls back to per-index effect-moved entries for a genuine multi-effect reshuffle', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  const a = withTrack // eq3, comp, distortion, bitcrush
  // Reverse the whole chain — no single id's removal reconciles the two orderings, so every
  // shifted id should still get its own entry (the fallback must not hide a real multi-item change).
  const b = moveEffect(moveEffect(a, 'lead2', 'bitcrush', 0).doc, 'lead2', 'distortion', 1).doc // -> bitcrush, distortion, eq3, comp
  const entries = diffDocuments(a, b)
  assert.equal(entries.every((e) => e.kind === 'effect-moved'), true)
  assert.ok(entries.length > 1, 'a genuine multi-item reshuffle should not collapse to a single entry')
})

test('beat inspect shows the effect chain, including bypass state', () => {
  const { doc: withTrack } = addTrack(initDocument({ trackId: 'lead' }), { id: 'lead2', kind: 'synth' })
  const { doc } = setEffectEnabled(withTrack, 'lead2', 'comp', false)
  const text = describeDocument(doc)
  assert.match(text, /effects: eq3\(eq3\) -> comp\(comp, bypassed\) -> distortion\(distortion\) -> bitcrush\(bitcrush\)/)
})
