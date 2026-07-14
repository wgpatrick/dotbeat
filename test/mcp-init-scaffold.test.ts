// Phase 35 Stream OC: `beat mcp-init` also scaffolds a music-session CLAUDE.md next to the
// project — the fix for "the agent started updating the README" from the owner's first dogfood
// session. The scaffold's job is ground rules for a MUSIC session (you're making music, not
// developing dotbeat; render -> metrics/lint; vary/score for taste; checkpoint at milestones;
// the two unit traps; the daemon port convention), kept to a screenful. An existing CLAUDE.md
// is the user's own and is never overwritten without --force.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

function beat(args: string[], opts: { expectExit?: number } = {}): string {
  try {
    return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    if (opts.expectExit !== undefined && e.status === opts.expectExit) return (e.stdout ?? '') + (e.stderr ?? '')
    throw new Error(`beat ${args.join(' ')} exited ${e.status}:\n${e.stderr ?? ''}${e.stdout ?? ''}`)
  }
}

function tempProject(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beat-scaffold-test-'))
  const file = join(dir, 'song.beat')
  copyFileSync(join(repoRoot, 'examples', 'real-groove.beat'), file)
  return { dir, file }
}

test('beat mcp-init writes the music-session CLAUDE.md scaffold next to the project', () => {
  const { dir, file } = tempProject()
  const out = beat(['mcp-init', file])
  assert.match(out, /wrote .*\.mcp\.json/)
  assert.match(out, /wrote .*CLAUDE\.md \(music-session ground rules/)

  const scaffold = readFileSync(join(dir, 'CLAUDE.md'), 'utf8')
  // titled for THIS project
  assert.match(scaffold, /^# Music session — song\.beat/)
  // the plan's required ground rules, each present verbatim enough to survive rewording drift:
  assert.match(scaffold, /MAKE MUSIC with dotbeat, not to develop dotbeat/)
  assert.match(scaffold, /Never edit the dotbeat repo/)
  assert.match(scaffold, /After EVERY render, run metrics and lint/)
  assert.match(scaffold, /vary -> audition -> score/)
  assert.match(scaffold, /beat adopt <batch-dir> <pick>/)
  assert.match(scaffold, /Checkpoint at musical milestones/)
  assert.match(scaffold, /velocity is 0\.\.1 \(0\.8, not MIDI 100\)/)
  assert.match(scaffold, /gain is in dB/)
  assert.match(scaffold, /beat-scores\.jsonl live next to the \.beat file/)
  // the daemon port convention the plan says the scaffold must record
  assert.match(scaffold, /default port 8420/)
  assert.match(scaffold, /scope "selection"/)
  // "keep it short (a screenful)" — hold the line against scaffold bloat
  assert.ok(scaffold.split('\n').length <= 40, `scaffold must stay a screenful, got ${scaffold.split('\n').length} lines`)
})

test('beat mcp-init never overwrites an existing CLAUDE.md without --force (but still writes .mcp.json)', () => {
  const { dir, file } = tempProject()
  const own = '# my own notes\ndo not lose these\n'
  writeFileSync(join(dir, 'CLAUDE.md'), own)

  const out = beat(['mcp-init', file])
  assert.match(out, /wrote .*\.mcp\.json/)
  assert.match(out, /CLAUDE\.md already exists — left untouched \(--force overwrites/)
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), own, 'existing CLAUDE.md untouched')

  // --force replaces it with the scaffold (and .mcp.json too, as before)
  const forced = beat(['mcp-init', file, '--force'])
  assert.match(forced, /wrote .*CLAUDE\.md/)
  assert.match(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), /MAKE MUSIC with dotbeat/)
})
