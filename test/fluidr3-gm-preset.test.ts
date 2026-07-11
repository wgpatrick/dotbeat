// Phase 10 Stream B (docs/phase-10-plan.md): exercise the multi-preset listing machinery
// (test/instrument-presets.test.ts covered a single-preset piano fixture) against a real,
// multi-preset General MIDI bank for the first time — presets/sf2/fluidr3-gm-small.sf2, trimmed
// from the real FluidR3 GM (MIT, docs/research/09-sample-source-licenses.md bundle-today
// shortlist item 4) via scripts/fetch-fluidr3-gm.mjs. Confirms `beat inspect` surfaces the
// bank's actual GM program names, not a mock/stub bank.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const sf2Fixture = join(repoRoot, 'presets', 'sf2', 'fluidr3-gm-small.sf2')

function beat(args: string[]): string {
  return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
}

function tempProjectWithGmBank(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beat-fluidr3-test-'))
  const file = join(dir, 'song.beat')
  copyFileSync(sf2Fixture, join(dir, 'gm.sf2'))
  beat(['init', file])
  beat(['sample', file, 'gm', 'gm.sf2'])
  // program 73 (Flute) is melodic-only in FluidR3 GM — no drum kit in the trimmed set reuses
  // program 73, so the "[selected]" marker in `beat inspect` output is unambiguous.
  beat(['add-track', file, 'flute', 'instrument', '--soundfont', 'gm', '--program', '73'])
  return { dir, file }
}

test('beat inspect lists real FluidR3 GM program names from the actual bundled .sf2', () => {
  const { file } = tempProjectWithGmBank()
  const text = beat(['inspect', file])
  assert.match(text, /soundfont presets:/)
  assert.match(text, /flute: 8 presets/)
  // A representative spread of real GM names must appear verbatim — proves the multi-preset
  // listing machinery (cli/beat.mjs's instrumentPresetInfo, SoundBankLoader) is reading actual
  // FluidR3 GM binary content, not a stub.
  for (const name of ['Yamaha Grand Piano', 'Nylon String Guitar', 'Acoustic Bass', 'Violin', 'Trumpet', 'Flute', 'Synth Drum', 'Standard']) {
    assert.match(text, new RegExp(`"${name}"`), `expected preset name "${name}" in inspect output`)
  }
  assert.match(text, /program 73 \(bank 0\/0\): "Flute"\s*\[selected\]/)
})

test('beat inspect --json attaches the full real preset list, program numbers matching GM', () => {
  const { file } = tempProjectWithGmBank()
  const json = JSON.parse(beat(['inspect', file, '--json'])) as {
    instrumentPresets: Record<string, { presets: { program: number; bankMSB: number; bankLSB: number; name: string }[] }>
  }
  const flutePresets = json.instrumentPresets.flute
  assert.ok(flutePresets, 'flute track has a resolved preset list')
  const presets = flutePresets.presets
  assert.equal(presets.length, 8)
  const flute = presets.find((p) => p.name === 'Flute')
  assert.ok(flute, 'Flute preset present')
  assert.equal(flute!.program, 73)
  const drumKit = presets.find((p) => p.name === 'Standard')
  assert.ok(drumKit, 'the GM "Standard" drum kit preset survived the trim')
})
