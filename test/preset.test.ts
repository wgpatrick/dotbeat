// Preset tests — docs/phase-5-plan.md §5.5. Presets are tooling, not grammar: applying one must
// be indistinguishable from a hand-typed series of `beat set` edits, and the factory library
// must stay valid against the live field table (these tests are the tripwire if a field is ever
// renamed out from under it).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  parse,
  serialize,
  parsePresetLibrary,
  applyPreset,
  diffDocuments,
  initDocument,
  addTrack,
  BeatPresetError,
} from '../src/core/index.js'

const factoryJson = readFileSync(fileURLToPath(new URL('../presets/factory.json', import.meta.url)), 'utf8')

function projectWithDrums() {
  const base = initDocument({ trackId: 'lead' })
  return addTrack(base, { id: 'drums', kind: 'drums' }).doc
}

test('the factory library parses and validates against the live field table', () => {
  const presets = parsePresetLibrary(factoryJson)
  assert.ok(presets.length >= 4)
  const names = presets.map((p) => p.name)
  for (const expected of ['driving-kit', 'deep-sub-bass', 'lush-pad', 'bright-lead']) {
    assert.ok(names.includes(expected), `factory library must include "${expected}"`)
  }
})

test('every factory preset applies cleanly to a fresh track of its kind', () => {
  for (const preset of parsePresetLibrary(factoryJson)) {
    const doc = projectWithDrums()
    const target = preset.kind === 'drums' ? 'drums' : 'lead'
    const next = applyPreset(doc, target, preset)
    // every param actually landed
    for (const [key, value] of Object.entries(preset.params)) {
      assert.equal(next.tracks.find((t) => t.id === target)!.synth[key as keyof typeof next.tracks[0]['synth']], value, `${preset.name}: ${key}`)
    }
    // and the result is a valid, round-trippable document
    assert.equal(serialize(parse(serialize(next))), serialize(next))
  }
})

test('applying a preset is exactly a bag of synth-param edits — nothing else changes', () => {
  const doc = projectWithDrums()
  const preset = parsePresetLibrary(factoryJson).find((p) => p.name === 'lush-pad')!
  const next = applyPreset(doc, 'lead', preset)
  const entries = diffDocuments(doc, next)
  assert.ok(entries.length > 0)
  for (const e of entries) {
    assert.equal(e.kind, 'synth-param')
    assert.equal((e as { trackId: string }).trackId, 'lead')
  }
})

test('a drums preset refuses to apply to a synth track (and vice versa)', () => {
  const doc = projectWithDrums()
  const presets = parsePresetLibrary(factoryJson)
  const kit = presets.find((p) => p.name === 'driving-kit')!
  const pad = presets.find((p) => p.name === 'lush-pad')!
  assert.throws(() => applyPreset(doc, 'lead', kit), BeatPresetError)
  assert.throws(() => applyPreset(doc, 'drums', pad), BeatPresetError)
})

test('applying to a nonexistent track fails loudly', () => {
  const preset = parsePresetLibrary(factoryJson)[0]!
  assert.throws(() => applyPreset(projectWithDrums(), 'ghost', preset), BeatPresetError)
})

test('a library with an unknown param is rejected at load time', () => {
  const bad = JSON.stringify({ version: 1, presets: [{ name: 'x', kind: 'synth', description: 'd', params: { warpDrive: 11 } }] })
  assert.throws(() => parsePresetLibrary(bad), /unknown synth param "warpDrive"/)
})

test('a library preset carrying a trackref param is rejected — routing is per-project', () => {
  const bad = JSON.stringify({ version: 1, presets: [{ name: 'x', kind: 'synth', description: 'd', params: { duckSource: 'drums' } }] })
  assert.throws(() => parsePresetLibrary(bad), /track reference/)
})

test('an invalid param VALUE is rejected at apply time by the same rules as beat set', () => {
  const lib = JSON.stringify({ version: 1, presets: [{ name: 'x', kind: 'synth', description: 'd', params: { filterType: 'notch' } }] })
  const [preset] = parsePresetLibrary(lib)
  assert.throws(() => applyPreset(projectWithDrums(), 'lead', preset!), /filterType/)
})

test('duplicate preset names are rejected', () => {
  const bad = JSON.stringify({
    version: 1,
    presets: [
      { name: 'x', kind: 'synth', description: 'd', params: {} },
      { name: 'x', kind: 'synth', description: 'd', params: {} },
    ],
  })
  assert.throws(() => parsePresetLibrary(bad), /duplicate preset name/)
})
