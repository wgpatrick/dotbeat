// Phase 41 Stream D — v0.11 timeline locators: named point markers on the song timeline.
//
// The feature exists because a 242-bar / 7:17 arrangement is unnavigable without one: "Breakdown"
// has to be a thing you can see and jump to, not a bar number you re-derive by counting sections.
// These tests pin the three surfaces that make it durable rather than a GUI-session ornament:
// the parser/serializer round-trip (it survives a save), the setValue path grammar (the CLI, MCP
// `beat_set` and the daemon's POST /edit all reach it through ONE helper, so parity is structural
// rather than three handlers vowing to stay in sync), and the musical diff (an edit that changes
// the file must never report "no musical changes" — the first cut of this feature did exactly
// that, writing the locator correctly while telling the user nothing had happened).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse, serialize, setValue, diffDocuments, formatDiff, initDocument, BeatParseError, BeatEditError } from '../src/core/index.js'

const BASE = `format_version 0.11
bpm 125
loop_bars 4
selected_track lead

track lead Lead #c678dd synth
  synth
    osc sawtooth
    volume -12
    cutoff 3000
    resonance 0.5
    attack 0.01
    decay 0.2
    sustain 0.5
    release 0.3
    pan 0
`

function withLocators(body: string): string {
  return `${BASE}\nlocators\n${body}`
}

test('a document with no locators round-trips byte-identically and grows no block', () => {
  const doc = parse(BASE)
  assert.equal(doc.locators.length, 0)
  const out = serialize(doc)
  assert.ok(!out.includes('locators'), 'an empty locator list must be elided entirely, so every pre-Stream-D file is untouched')
  assert.equal(serialize(parse(out)), out)
})

test('locators parse, round-trip, and keep 1-based bars', () => {
  const text = withLocators('  locator brk 101 Breakdown\n  locator main1 53 Main_1\n')
  const doc = parse(text)
  assert.equal(doc.locators.length, 2)
  // Sorted by bar on serialize, NOT source order — see serialize.ts's comment.
  assert.deepEqual(
    parse(serialize(doc)).locators,
    [
      { id: 'main1', bar: 53, name: 'Main_1' },
      { id: 'brk', bar: 101, name: 'Breakdown' },
    ],
    'serialization orders locators by bar so inserting one in the middle is a one-line diff',
  )
  assert.equal(serialize(parse(serialize(doc))), serialize(doc), 'serialize is idempotent')
})

test('an omitted name defaults to the id, and elides again on the way out', () => {
  const doc = parse(withLocators('  locator drop 33\n'))
  assert.deepEqual(doc.locators, [{ id: 'drop', bar: 33, name: 'drop' }])
  assert.ok(serialize(doc).includes('  locator drop 33\n'), 'a name identical to the id is not re-emitted')
  assert.ok(!serialize(doc).includes('locator drop 33 drop'))
})

test('the parser rejects malformed locator lines', () => {
  const bad: [string, RegExp][] = [
    ['  locator brk\n', /2 or 3 values/],
    ['  locator brk 101 Breakdown extra\n', /2 or 3 values/],
    ['  locator brk 0\n', /1-based/],
    ['  locator brk 1.5\n', /whole number|locator bar/],
    ['  locator has.dots 4\n', /alphanumeric/],
    ['  locator brk 4\n  locator brk 8\n', /duplicate locator id/],
  ]
  for (const [body, re] of bad) {
    assert.throws(() => parse(withLocators(body)), (err: unknown) => err instanceof BeatParseError && re.test(err.message), `expected ${re} for: ${body.trim()}`)
  }
  assert.throws(() => parse(withLocators('  locator a 1\n') + '\nlocators\n  locator b 2\n'), /duplicate locators block/)
})

test('a locator past the end of the song still parses — it must survive to be moved back', () => {
  // Deliberate: rejecting it at load would silently DELETE a user's marker the moment they
  // shortened the arrangement, which is the worst possible response to an out-of-range value.
  const doc = parse(withLocators('  locator ghost 9999 Way_Out_There\n'))
  assert.equal(doc.locators[0]!.bar, 9999)
})

test('setValue creates, moves, renames and removes locators', () => {
  let doc = initDocument({ bpm: 125, loopBars: 4, trackId: 'lead' })
  doc = setValue(doc, 'locator.brk', '101 Breakdown')
  assert.deepEqual(doc.locators, [{ id: 'brk', bar: 101, name: 'Breakdown' }])

  doc = setValue(doc, 'locator.quick', '9')
  assert.equal(doc.locators.find((l) => l.id === 'quick')!.name, 'quick', 'a bare bar defaults the name to the id')

  doc = setValue(doc, 'locator.brk.bar', '105')
  assert.equal(doc.locators.find((l) => l.id === 'brk')!.bar, 105)
  assert.equal(doc.locators.find((l) => l.id === 'brk')!.name, 'Breakdown', 'moving must not disturb the name')

  doc = setValue(doc, 'locator.brk.name', 'Big_Breakdown')
  assert.equal(doc.locators.find((l) => l.id === 'brk')!.bar, 105, 'renaming must not disturb the bar')

  doc = setValue(doc, 'locator.quick', '')
  assert.deepEqual(doc.locators.map((l) => l.id), ['brk'], 'an empty value removes, as <track>.hit.<id> already does')
})

test('setValue upserts an existing locator rather than duplicating it', () => {
  let doc = initDocument({ trackId: 'lead' })
  doc = setValue(doc, 'locator.brk', '101 Breakdown')
  doc = setValue(doc, 'locator.brk', '133 Main_2')
  assert.deepEqual(doc.locators, [{ id: 'brk', bar: 133, name: 'Main_2' }])
})

test('setValue rejects bad locator input with an actionable message', () => {
  const doc = setValue(initDocument({ trackId: 'lead' }), 'locator.brk', '101 Breakdown')
  const bad: [string, string, RegExp][] = [
    ['locator.nope.bar', '5', /no locator "nope"/],
    ['locator.x', '0 Zero', /1-based/],
    ['locator.x', 'abc', /expected a bar number/],
    ['locator.x', '5 has spaces', /"<bar> \[<name>\]"/],
    ['locator.x', '5 bad!name', /alphanumeric/],
    ['locator.brk.colour', 'red', /unknown locator path/],
    ['locator.nope', '', /no locator "nope" to remove/],
  ]
  for (const [path, value, re] of bad) {
    assert.throws(() => setValue(doc, path, value), (err: unknown) => err instanceof BeatEditError && re.test(err.message), `expected ${re} for ${path}=${value}`)
  }
})

test('setValue round-trips through the file: what it writes, the parser reads back', () => {
  let doc = initDocument({ bpm: 125, loopBars: 4, trackId: 'lead' })
  doc = setValue(doc, 'locator.intro', '1 Intro')
  doc = setValue(doc, 'locator.brk', '101 Breakdown')
  doc = setValue(doc, 'locator.main3', '185 Peak')
  const text = serialize(doc)
  assert.deepEqual(parse(text).locators, [
    { id: 'intro', bar: 1, name: 'Intro' },
    { id: 'brk', bar: 101, name: 'Breakdown' },
    { id: 'main3', bar: 185, name: 'Peak' },
  ])
})

test('the musical diff reports locator adds, moves, renames and removals', () => {
  // The regression this exists for: `beat set` printed "no musical changes" while correctly
  // writing the locator to disk, making a working edit indistinguishable from a silent no-op.
  const empty = initDocument({ trackId: 'lead' })
  const added = setValue(empty, 'locator.brk', '101 Breakdown')
  assert.deepEqual(diffDocuments(empty, added), [{ kind: 'locator-added', locator: { id: 'brk', bar: 101, name: 'Breakdown' } }])
  assert.match(formatDiff(diffDocuments(empty, added)), /locator "Breakdown" added at bar 101/)

  const moved = setValue(added, 'locator.brk.bar', '105')
  assert.deepEqual(diffDocuments(added, moved), [{ kind: 'locator-changed', locatorId: 'brk', changes: [{ field: 'bar', before: 101, after: 105 }] }])
  assert.match(formatDiff(diffDocuments(added, moved)), /locator brk: bar 101 -> 105/)

  const renamed = setValue(moved, 'locator.brk.name', 'Big_Breakdown')
  assert.match(formatDiff(diffDocuments(moved, renamed)), /locator brk: name Breakdown -> Big_Breakdown/)

  const removed = setValue(renamed, 'locator.brk', '')
  assert.deepEqual(diffDocuments(renamed, removed), [{ kind: 'locator-removed', locator: { id: 'brk', bar: 105, name: 'Big_Breakdown' } }])
  assert.match(formatDiff(diffDocuments(renamed, removed)), /locator "Big_Breakdown" removed \(was at bar 105\)/)
})

test('reordering the locator array is not a diff — identity is the id, not the position', () => {
  const a = parse(withLocators('  locator brk 101 Breakdown\n  locator main1 53 Main_1\n'))
  const b = parse(withLocators('  locator main1 53 Main_1\n  locator brk 101 Breakdown\n'))
  assert.deepEqual(diffDocuments(a, b), [], 'file order of locators is serializer-owned, never user-meaningful')
})
