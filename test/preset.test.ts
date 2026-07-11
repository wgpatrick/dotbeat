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
  filterPresetsByCategory,
  PRESET_CATEGORIES,
  SYNTH_PRESET_CATEGORIES,
  DRUM_PRESET_CATEGORIES,
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

// Phase 12 Stream 2 (docs/phase-12-presets.md): the library grew from 4 presets to a real
// categorized set covering both drum-voice kits and the full synth taxonomy research turned up
// (Bass/Lead/Pad/Pluck/Keys/Arp/FX). These are tripwires against the count/shape silently
// regressing, not a re-statement of every preset's params.
test('the factory library covers a genre-named drum-voice kit per researched convention', () => {
  const presets = parsePresetLibrary(factoryJson)
  const drumKits = presets.filter((p) => p.kind === 'drums').map((p) => p.name)
  assert.ok(drumKits.length >= 6, `expected >= 6 drum-voice kits, got ${drumKits.length}`)
  for (const expected of ['driving-kit', '808-trap-kit', 'techno-kit', 'boom-bap-kit', 'lofi-kit', 'acoustic-rock-kit']) {
    assert.ok(drumKits.includes(expected), `factory library must include the "${expected}" drum-voice kit`)
  }
})

test('the factory library covers the researched synth taxonomy with multiple presets per category', () => {
  const presets = parsePresetLibrary(factoryJson)
  const synthPresets = presets.filter((p) => p.kind !== 'drums')
  assert.ok(synthPresets.length >= 24, `expected >= 24 synth presets, got ${synthPresets.length}`)
  // one representative name per researched category (Bass/Lead/Pad/Pluck/Keys/Arp/FX) — proves
  // every category actually shipped, not just that the total count grew somewhere.
  const names = synthPresets.map((p) => p.name)
  for (const expected of [
    'sub-sine-bass', 'reese-bass', 'wobble-bass', 'acid-bass', 'fm-bass', // Bass
    'supersaw-lead', 'pluck-lead', 'square-chip-lead', 'fm-bell-lead', // Lead
    'warm-pad', 'string-pad', 'glass-pad', 'dark-pad', // Pad
    'crystal-pluck', 'warm-pluck', 'fm-pluck', 'marimba-pluck', // Pluck
    'e-piano', 'bell-keys', 'organ-keys', 'warm-keys', // Keys
    'arp-pluck', 'arp-bell', 'arp-sequence', // Arp
    'riser-sweep', 'noise-impact', 'drone-texture', // FX
  ]) {
    assert.ok(names.includes(expected), `factory library must include "${expected}"`)
  }
})

test('no two presets in the factory library share an identical param bag — every preset is genuinely distinct, not a relabeled duplicate', () => {
  const presets = parsePresetLibrary(factoryJson)
  const seen = new Map<string, string>()
  for (const p of presets) {
    const key = `${p.kind}:${JSON.stringify(Object.entries(p.params).sort())}`
    const dupeOf = seen.get(key)
    assert.ok(!dupeOf, `"${p.name}" has identical params to "${dupeOf}"`)
    seen.set(key, p.name)
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
  const bad = JSON.stringify({ version: 1, presets: [{ name: 'x', kind: 'synth', category: 'bass', description: 'd', params: { warpDrive: 11 } }] })
  assert.throws(() => parsePresetLibrary(bad), /unknown synth param "warpDrive"/)
})

test('a library preset carrying a trackref param is rejected — routing is per-project', () => {
  const bad = JSON.stringify({ version: 1, presets: [{ name: 'x', kind: 'synth', category: 'bass', description: 'd', params: { duckSource: 'drums' } }] })
  assert.throws(() => parsePresetLibrary(bad), /track reference/)
})

test('an invalid param VALUE is rejected at apply time by the same rules as beat set', () => {
  const lib = JSON.stringify({ version: 1, presets: [{ name: 'x', kind: 'synth', category: 'bass', description: 'd', params: { filterType: 'notch' } }] })
  const [preset] = parsePresetLibrary(lib)
  assert.throws(() => applyPreset(projectWithDrums(), 'lead', preset!), /filterType/)
})

// Phase 18 Stream S (docs/phase-18-content-taxonomy.md): every preset now carries an explicit
// `category` field (research 18's content-taxonomy recommendation). This is the structural
// coverage tripwire, same spirit as Phase 12 Stream 2's "no two presets share identical params"
// test — it guards the taxonomy itself, not any one preset's specific category.
test('every factory preset has a valid category drawn from the enumerated taxonomy, matching its kind', () => {
  const presets = parsePresetLibrary(factoryJson)
  assert.ok(presets.length > 0)
  for (const p of presets) {
    assert.ok(
      (PRESET_CATEGORIES as readonly string[]).includes(p.category),
      `"${p.name}" has category "${p.category}", not one of ${PRESET_CATEGORIES.join(', ')}`,
    )
    if (p.kind === 'drums') {
      assert.ok(
        (DRUM_PRESET_CATEGORIES as readonly string[]).includes(p.category),
        `drum preset "${p.name}" has category "${p.category}", not one of ${DRUM_PRESET_CATEGORIES.join(', ')}`,
      )
    } else if (p.kind === 'synth') {
      assert.ok(
        (SYNTH_PRESET_CATEGORIES as readonly string[]).includes(p.category),
        `synth preset "${p.name}" has category "${p.category}", not one of ${SYNTH_PRESET_CATEGORIES.join(', ')}`,
      )
    }
  }
})

test('filterPresetsByCategory returns exactly the presets in that category and nothing else', () => {
  const presets = parsePresetLibrary(factoryJson)
  const bass = filterPresetsByCategory(presets, 'bass')
  assert.ok(bass.length > 0)
  for (const p of bass) assert.equal(p.category, 'bass')
  // cross-check: every preset elsewhere in the library is NOT in the bass result
  const bassNames = new Set(bass.map((p) => p.name))
  for (const p of presets) {
    if (p.category !== 'bass') assert.ok(!bassNames.has(p.name), `"${p.name}" leaked into the bass filter`)
  }
  assert.deepEqual(
    bass.map((p) => p.name).sort(),
    ['deep-sub-bass', 'sub-sine-bass', 'reese-bass', 'wobble-bass', 'acid-bass', 'fm-bass'].sort(),
  )
})

test('filterPresetsByCategory rejects a category outside the enumerated taxonomy', () => {
  const presets = parsePresetLibrary(factoryJson)
  assert.throws(() => filterPresetsByCategory(presets, 'chords'), /unknown category/)
})

test('a preset with a category outside the taxonomy is rejected at load time', () => {
  const bad = JSON.stringify({ version: 1, presets: [{ name: 'x', kind: 'synth', category: 'chords', description: 'd', params: {} }] })
  assert.throws(() => parsePresetLibrary(bad), /category must be one of/)
})

test('a synth preset carrying a drum-only category is rejected at load time', () => {
  const bad = JSON.stringify({ version: 1, presets: [{ name: 'x', kind: 'synth', category: 'techno', description: 'd', params: {} }] })
  assert.throws(() => parsePresetLibrary(bad), /synth preset.*category must be one of/)
})

test('duplicate preset names are rejected', () => {
  const bad = JSON.stringify({
    version: 1,
    presets: [
      { name: 'x', kind: 'synth', category: 'bass', description: 'd', params: {} },
      { name: 'x', kind: 'synth', category: 'bass', description: 'd', params: {} },
    ],
  })
  assert.throws(() => parsePresetLibrary(bad), /duplicate preset name/)
})
