// Phase 10 Stream B (docs/phase-10-plan.md): FreePats MuldjordKit (CC-BY 4.0), deferred in
// Phase 7 as "blocked on GitHub-release proxy access" — confirmed unblocked and fetched for real
// via scripts/fetch-muldjordkit.mjs, trimmed to presets/sf2/muldjordkit-small.sf2. Unlike
// FluidR3 GM this is a single-preset bank (a drum kit has no "programs" to pick between) — this
// test just confirms the real kit loads and names itself correctly through the same
// SoundBankLoader path as the multi-preset fixtures.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const sf2Fixture = join(repoRoot, 'presets', 'sf2', 'muldjordkit-small.sf2')

function beat(args: string[]): string {
  return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
}

test('beat inspect loads the real MuldjordKit SF2 and lists its single preset', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-muldjordkit-test-'))
  const file = join(dir, 'song.beat')
  copyFileSync(sf2Fixture, join(dir, 'kit.sf2'))
  beat(['init', file])
  beat(['sample', file, 'mkit', 'kit.sf2'])
  beat(['add-track', file, 'drums', 'instrument', '--soundfont', 'mkit', '--program', '0'])
  const text = beat(['inspect', file])
  assert.match(text, /soundfont presets:/)
  assert.match(text, /drums: 1 preset/)
  assert.match(text, /program 0 \(bank 0\/0\): "MuldjordKit"\s*\[selected\]/)
})
