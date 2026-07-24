// docs/engine-presets.md tiers E0–E2: patch provenance, the role-mapped factory-preset draw, the
// curated-bank preference, and the fallback chain. Pure-logic tests (src/taste/enginePresets.ts) —
// no render pipeline; the flow test uses the real showdown manifest writer/reader to assert the E0
// tag survives batch -> manifest.

import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  RANDOM_SEED_PATCH,
  factoryProvenance,
  curatedProvenance,
  withPatchProvenance,
  readPatchProvenance,
  engineRolePresetCategories,
  engineRoleUsesKit,
  pickEnginePreset,
  loadEngineCuratedFile,
  engineCuratedForRole,
} from '../src/taste/enginePresets.js'
import { parsePresetLibrary } from '../src/core/preset.js'
import { parseDrumKitLibrary } from '../src/core/drumkit.js'
import { parse, serialize } from '../src/core/index.js'
import { writeShowdownBatch } from '../src/taste/showdown.js'
import { readBatchManifest } from '../src/vary/batch.js'
import { generateSeedBeat } from '../src/taste/seeds.js'

const FACTORY = parsePresetLibrary(readFileSync(new URL('../presets/factory.json', import.meta.url), 'utf8'))
const KITS = parseDrumKitLibrary(readFileSync(new URL('../presets/drum-kits.json', import.meta.url), 'utf8'))

// tiny WAV so the manifest writer has real files to hash
function toneWav(freq: number, seconds: number): Buffer {
  const sr = 44100
  const n = Math.floor(sr * seconds)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sr) * 12000), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sr, 24); header.writeUInt32LE(sr * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

// ==== E0: provenance tags ========================================================================

test('E0 provenance: tag format and round-trip through withPatchProvenance/readPatchProvenance', () => {
  assert.equal(RANDOM_SEED_PATCH, 'random-seed-patch')
  assert.equal(factoryProvenance('acid-bass'), 'factory:acid-bass')
  assert.equal(curatedProvenance('roll-12345'), 'curated:roll-12345')

  const from = withPatchProvenance('composed rolling-8ths figure on seed-003.beat bass solo', factoryProvenance('acid-bass'))
  assert.ok(from.includes('[patch: factory:acid-bass]'), from)
  assert.equal(readPatchProvenance(from), 'factory:acid-bass')
  assert.equal(readPatchProvenance('no tag here'), null)
  assert.equal(readPatchProvenance(withPatchProvenance('x', RANDOM_SEED_PATCH)), 'random-seed-patch')
})

test('E0 flow: the patch tag survives batch -> showdown manifest (engine + engineplus from-strings)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-engpreset-'))
  for (const v of ['v1', 'v2', 'v3']) writeFileSync(join(dir, `${v}.wav`), toneWav(220, 0.3))
  const prov = factoryProvenance('acid-bass')
  writeShowdownBatch(dir, 'bassline', [
    { file: 'v1.wav', source: { kind: 'engine', from: withPatchProvenance('composed rolling-8ths on seed-003.beat bass solo', prov) } },
    { file: 'v2.wav', source: { kind: 'engineplus', from: withPatchProvenance('same figure and patch + production pass: unison 5', prov) } },
    { file: 'v3.wav', source: { kind: 'gen', from: '"a rolling bassline" (stub)' } },
  ], { seed: 7 })
  const manifest = readBatchManifest(dir)
  const bySource = Object.fromEntries(manifest.variants.map((v) => [v.source!.kind, v.source!.from!]))
  assert.equal(readPatchProvenance(bySource.engine!), 'factory:acid-bass', 'engine clip carries the patch tag')
  assert.equal(readPatchProvenance(bySource.engineplus!), 'factory:acid-bass', 'engineplus inherits the same tag')
  assert.equal(readPatchProvenance(bySource.gen!), null, 'gen clip carries no patch tag')
})

// ==== E1: role mapping + the seeded, exclude-chained factory draw =================================

test('E1 role mapping: pitched roles -> synth categories, drum-loop -> kit, unknown -> null', () => {
  assert.deepEqual(engineRolePresetCategories('bassline'), ['bass'])
  assert.deepEqual(engineRolePresetCategories('chords'), ['pad', 'keys'])
  assert.deepEqual(engineRolePresetCategories('lead'), ['lead', 'pluck', 'arp'])
  assert.equal(engineRolePresetCategories('drum-loop'), null)
  assert.equal(engineRolePresetCategories('nonsense'), null)
  assert.equal(engineRoleUsesKit('drum-loop'), true)
  assert.equal(engineRoleUsesKit('bassline'), false)
})

test('E1 pick: a pitched role draws a role-category synth preset, deterministic in the seed', () => {
  const a = pickEnginePreset({ role: 'bassline', seed: 41, presets: FACTORY, kits: KITS })
  const b = pickEnginePreset({ role: 'bassline', seed: 41, presets: FACTORY, kits: KITS })
  assert.ok(a && b)
  assert.equal(a!.name, b!.name, 'same seed -> same pick')
  assert.equal(a!.provenance, `factory:${a!.name}`)
  const chosen = FACTORY.find((p) => p.name === a!.name)!
  assert.equal(chosen.kind, 'synth')
  assert.equal(chosen.category, 'bass', 'bassline draws from the bass category')

  // chords may be pad OR keys; lead may be lead/pluck/arp
  const chords = pickEnginePreset({ role: 'chords', seed: 3, presets: FACTORY, kits: KITS })!
  assert.ok(['pad', 'keys'].includes(FACTORY.find((p) => p.name === chords.name)!.category))
  const lead = pickEnginePreset({ role: 'lead', seed: 9, presets: FACTORY, kits: KITS })!
  assert.ok(['lead', 'pluck', 'arp'].includes(FACTORY.find((p) => p.name === lead.name)!.category))
})

test('E1 pick: drum-loop draws a factory drum kit; provenance is factory:<kit>', () => {
  const pick = pickEnginePreset({ role: 'drum-loop', seed: 41, presets: FACTORY, kits: KITS })!
  assert.ok(pick)
  assert.ok(KITS.some((k) => k.name === pick.name), 'name is a real kit')
  assert.equal(pick.provenance, `factory:${pick.name}`)
})

test('E1 pick: exclude-chains within a run so a run does not repeat a voicing while alternatives exist', () => {
  const seen = new Set<string>()
  let seed = 100
  // bass category has 6 presets — draw 6 with growing exclude, expect 6 distinct
  for (let i = 0; i < 6; i++) {
    const pick = pickEnginePreset({ role: 'bassline', seed: seed++, presets: FACTORY, kits: KITS, exclude: [...seen] })!
    assert.ok(!seen.has(pick.name), `pick ${pick.name} not repeated (draw ${i})`)
    seen.add(pick.name)
  }
  assert.equal(seen.size, 6, 'all six bass presets used before any repeat')
  // a 7th draw (pool exhausted) reuses rather than returning null
  const seventh = pickEnginePreset({ role: 'bassline', seed: seed, presets: FACTORY, kits: KITS, exclude: [...seen] })
  assert.ok(seventh, 'pool exhausted -> reuse, never null')
})

test('E1 pick applies as an ordinary preset edit: the seed patch is replaced and the doc round-trips', () => {
  const seed = parse(generateSeedBeat(3).text)
  const pick = pickEnginePreset({ role: 'bassline', seed: 41, presets: FACTORY, kits: KITS })!
  const applied = pick.apply(seed, 'bass')
  const preset = FACTORY.find((p) => p.name === pick.name)!
  const bass = applied.tracks.find((t) => t.id === 'bass')!
  // every preset param landed on the track's synth block
  for (const [key, value] of Object.entries(preset.params)) {
    assert.equal(String((bass.synth as unknown as Record<string, unknown>)[key]), String(value), `param ${key} applied`)
  }
  assert.doesNotThrow(() => parse(serialize(applied)), 'applied doc round-trips')
})

// ==== E2: the curated-bank preference + fallback chain ===========================================

test('E2 curated bank: pick prefers a curated patch when the role has one; provenance is curated:<id>', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-curated-'))
  const path = join(dir, 'engine-curated.json')
  writeFileSync(path, JSON.stringify({
    version: 1,
    generatedAt: '2026-07-23T00:00:00.000Z',
    roles: {
      bassline: {
        pool: 200, survivors: 50,
        kept: [
          { id: 'roll-abc', source: 'random-roll', category: 'bass', params: { osc: 'sawtooth', cutoff: 600, resonance: 0.4 }, composite: 1.9 },
          { id: 'roll-def', source: 'factory:acid-bass', category: 'bass', params: { osc: 'square', cutoff: 800 }, composite: 1.2 },
        ],
      },
    },
  }))
  const curated = loadEngineCuratedFile(path)
  assert.ok(curated)
  assert.equal(engineCuratedForRole(curated, 'bassline').length, 2)
  assert.equal(engineCuratedForRole(curated, 'chords').length, 0)

  const pick = pickEnginePreset({ role: 'bassline', seed: 41, presets: FACTORY, kits: KITS, curated })!
  assert.ok(pick.provenance.startsWith('curated:'), `curated preferred: ${pick.provenance}`)
  assert.ok(['roll-abc', 'roll-def'].includes(pick.name))
})

test('E2 fallback chain: curated file absent -> factory; role missing from curated -> factory', () => {
  assert.equal(loadEngineCuratedFile('/no/such/engine-curated.json'), null)
  // a curated file that covers only bassline: a chords pick still falls back to factory
  const dir = mkdtempSync(join(tmpdir(), 'beat-curated2-'))
  const path = join(dir, 'engine-curated.json')
  writeFileSync(path, JSON.stringify({
    version: 1, generatedAt: 'x',
    roles: { bassline: { pool: 1, survivors: 1, kept: [{ id: 'roll-1', source: 'random-roll', category: 'bass', params: { cutoff: 500 }, composite: 1 }] } },
  }))
  const curated = loadEngineCuratedFile(path)
  const chords = pickEnginePreset({ role: 'chords', seed: 5, presets: FACTORY, kits: KITS, curated })!
  assert.ok(chords.provenance.startsWith('factory:'), 'chords not in curated -> factory draw')
})

test('E2 loader: malformed / non-object curated files degrade to null (CI-safe factory draw)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-curated3-'))
  const bad = join(dir, 'bad.json')
  writeFileSync(bad, '{ not valid json')
  assert.equal(loadEngineCuratedFile(bad), null)
  const noRoles = join(dir, 'noroles.json')
  writeFileSync(noRoles, JSON.stringify({ version: 1 }))
  assert.equal(loadEngineCuratedFile(noRoles), null)
})
