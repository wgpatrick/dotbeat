// v0.3 grammar tests — the optional shaped-parameter surface (docs/phase-5-plan.md).
// The core contract under test: CANONICAL ELISION. An optional field appears in the text iff
// its value differs from the frozen default, so (a) v0.2-era files are still valid and parse
// with all optional fields at defaults, (b) every state has exactly one serialized form, and
// (c) a single param change is always a one-line git diff (add, remove, or modify).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parse,
  serialize,
  setValue,
  diffDocuments,
  formatDiff,
  BeatParseError,
  BeatEditError,
  SYNTH_FIELDS,
  defaultSynthFields,
} from '../src/core/index.js'

const HEADER = `format_version 0.3
bpm 120
loop_bars 1
selected_track a
`

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

const MINIMAL = `${HEADER}
track a A #ffffff synth
${CORE_SYNTH}
`

test('a synth block with only the core 9 parses with every optional field at its default', () => {
  const doc = parse(MINIMAL)
  const synth = doc.tracks[0]!.synth
  for (const def of SYNTH_FIELDS) {
    assert.equal(synth[def.key], def.default, def.key)
  }
})

test('optional fields at their default are never serialized (elision)', () => {
  const doc = parse(MINIMAL)
  assert.equal(serialize(doc), MINIMAL)
})

test('setting an optional field to a non-default value emits exactly one extra line', () => {
  const before = parse(MINIMAL)
  const after = setValue(before, 'a.sendReverb', '0.4')
  const beforeLines = serialize(before).split('\n')
  const afterLines = serialize(after).split('\n')
  assert.equal(afterLines.length, beforeLines.length + 1)
  const added = afterLines.filter((l) => !beforeLines.includes(l))
  assert.deepEqual(added, ['    sendReverb 0.4'])
})

test('setting an optional field back to its default removes its line (one canonical form per state)', () => {
  const shaped = setValue(parse(MINIMAL), 'a.sendReverb', '0.4')
  const reverted = setValue(shaped, 'a.sendReverb', '0')
  assert.equal(serialize(reverted), MINIMAL)
})

test('serialize(parse(x)) === x for a file using shaped params of every kind', () => {
  const text = `${HEADER}
track a A #ffffff synth
${CORE_SYNTH}
    osc2Type square
    osc2Level 0.25
    unisonVoices 5
    filterEnvAmount 0.35
    lfoDest cutoff
    sendReverb 0.55
    duckSource b
    duckAmount 0.45

track b B #e35d5d drums
${CORE_SYNTH}
    kickPunch 0.08
  hit kick0 kick 0 0.9
  hit hat0 hat 0 0.5
  hit snare2 snare 2 0.8
  hit openhat3 openhat 3 0.4
`
  const doc = parse(text)
  assert.equal(serialize(doc), text)
  const a = doc.tracks[0]!.synth
  assert.equal(a.osc2Type, 'square')
  assert.equal(a.osc2Level, 0.25)
  assert.equal(a.duckSource, 'b')
  assert.equal(doc.tracks[1]!.synth.kickPunch, 0.08)
})

test('shaped params serialize in SYNTH_FIELDS table order regardless of source order', () => {
  const scrambled = `${HEADER}
track a A #ffffff synth
${CORE_SYNTH}
    sendReverb 0.5
    osc2Level 0.3
    subLevel 0.6
`
  const out = serialize(parse(scrambled))
  const idx = (field: string) => out.indexOf(`    ${field} `)
  assert.ok(idx('osc2Level') !== -1 && idx('subLevel') !== -1 && idx('sendReverb') !== -1)
  assert.ok(idx('osc2Level') < idx('subLevel'), 'osc2Level before subLevel')
  assert.ok(idx('subLevel') < idx('sendReverb'), 'subLevel before sendReverb')
})

test('duckSource none is the explicit null spelling and round-trips to elision', () => {
  const text = `${HEADER}
track a A #ffffff synth
${CORE_SYNTH}
    duckSource none
`
  const doc = parse(text)
  assert.equal(doc.tracks[0]!.synth.duckSource, null)
  // canonical form elides the default — "duckSource none" never survives serialization
  assert.equal(serialize(doc), MINIMAL)
})

test('duckSource may forward-reference a track defined later in the file', () => {
  const text = `${HEADER.replace('selected_track a', 'selected_track lead')}
track lead Lead #c678dd synth
${CORE_SYNTH}
    duckSource drums

track drums Drums #e35d5d drums
${CORE_SYNTH}
  pattern kick 0.9 0 0 0
  pattern snare 0 0 0 0
  pattern clap 0 0 0 0
  pattern hat 0 0 0 0
  pattern openhat 0 0 0 0
`
  const doc = parse(text)
  assert.equal(doc.tracks[0]!.synth.duckSource, 'drums')
})

test('duckSource referencing a nonexistent track is rejected at parse time', () => {
  const bad = `${HEADER}
track a A #ffffff synth
${CORE_SYNTH}
    duckSource ghost
`
  assert.throws(() => parse(bad), /duckSource/)
})

test('an enum field rejects a value outside its set', () => {
  const bad = `${HEADER}
track a A #ffffff synth
${CORE_SYNTH}
    filterType notch
`
  assert.throws(() => parse(bad), BeatParseError)
})

test('an unknown synth param is still rejected (no silent vendor extensions)', () => {
  const bad = `${HEADER}
track a A #ffffff synth
${CORE_SYNTH}
    warpDrive 11
`
  assert.throws(() => parse(bad), /unknown synth param "warpDrive"/)
})

test('a duplicate optional param line is rejected', () => {
  const bad = `${HEADER}
track a A #ffffff synth
${CORE_SYNTH}
    sendReverb 0.3
    sendReverb 0.5
`
  assert.throws(() => parse(bad), /duplicate synth param "sendReverb"/)
})

test('beat set validates enum and trackref values', () => {
  const doc = parse(MINIMAL)
  assert.throws(() => setValue(doc, 'a.filterType', 'notch'), BeatEditError)
  assert.throws(() => setValue(doc, 'a.duckSource', 'ghost'), BeatEditError)
  const off = setValue(setValue(doc, 'a.duckSource', 'a'), 'a.duckSource', 'none')
  assert.equal(off.tracks[0]!.synth.duckSource, null)
})

test('semantic diff reports a shaped-param change as one synth-param entry', () => {
  const before = parse(MINIMAL)
  const after = setValue(before, 'a.unisonVoices', '5')
  const entries = diffDocuments(before, after)
  assert.deepEqual(entries, [{ kind: 'synth-param', trackId: 'a', param: 'unisonVoices', before: 1, after: 5 }])
})

test('semantic diff formats a trackref change with the none spelling', () => {
  const before = parse(MINIMAL)
  const withDuck = setValue(before, 'a.duckSource', 'a')
  const entries = diffDocuments(before, withDuck)
  assert.equal(entries.length, 1)
  assert.match(formatDiff(entries), /a: duckSource none -> a/)
})

test('a v0.2 file (no optional fields) still parses and keeps its declared version', () => {
  const v02 = MINIMAL.replace('format_version 0.3', 'format_version 0.2')
  const doc = parse(v02)
  assert.equal(doc.formatVersion, '0.2')
  assert.equal(serialize(doc), v02)
  assert.deepEqual({ ...doc.tracks[0]!.synth }, { ...doc.tracks[0]!.synth, ...defaultSynthFields() })
})
