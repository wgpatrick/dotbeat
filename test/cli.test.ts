// End-to-end tests for the `beat` CLI (subprocess-level, real files, real git) — including the
// literal ROADMAP M2 exit criterion: "a `beat diff` between two commits reads like an edit list."

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const exampleBeat = join(repoRoot, 'examples', 'real-groove.beat')

function beat(args: string[], opts: { cwd?: string; expectExit?: number } = {}): string {
  try {
    return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8', cwd: opts.cwd })
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    if (opts.expectExit !== undefined && e.status === opts.expectExit) return (e.stdout ?? '') + (e.stderr ?? '')
    throw new Error(`beat ${args.join(' ')} exited ${e.status}:\n${e.stderr ?? ''}${e.stdout ?? ''}`)
  }
}

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beat-cli-test-'))
  const file = join(dir, 'song.beat')
  copyFileSync(exampleBeat, file)
  return file
}

test('beat inspect prints the overview; --json prints the parsed document', () => {
  const file = tempProject()
  const text = beat(['inspect', file])
  assert.match(text, /^format 0\.4 \| 126 bpm/)
  assert.match(text, /^lead {2}"Lead" {2}synth/m)
  const json = JSON.parse(beat(['inspect', file, '--json'])) as { bpm: number; tracks: unknown[] }
  assert.equal(json.bpm, 126)
  assert.equal(json.tracks.length, 4)
})

test('beat set edits surgically, writes canonically, and prints the edit list', () => {
  const file = tempProject()
  const before = readFileSync(file, 'utf8')
  const out = beat(['set', file, 'lead.cutoff', '900', 'bpm', '124'])
  assert.match(out, /^bpm: 126 -> 124\nlead: cutoff 3200 -> 900\n$/)
  const after = readFileSync(file, 'utf8')
  const changed = after.split('\n').filter((l, i) => l !== before.split('\n')[i])
  assert.deepEqual(changed, ['bpm 124', '    cutoff 900'], 'exactly two lines changed for two edits')
})

test('beat add-note / rm-note round-trip and report themselves', () => {
  const file = tempProject()
  const addOut = beat(['add-note', file, 'lead', '76', '12', '2', '0.9'])
  const m = addOut.match(/note added (\S+) \(pitch 76, start 12, dur 2, vel 0\.9\)/)
  assert.ok(m, `unexpected add-note output: ${addOut}`)
  const rmOut = beat(['rm-note', file, 'lead', m![1]!])
  assert.match(rmOut, /note removed/)
})

test('beat set rejects bad paths with exit code 2 and a real error message', () => {
  const file = tempProject()
  const out = beat(['set', file, 'lead.wobble', '1'], { expectExit: 2 })
  assert.match(out, /unknown field "wobble"/)
})

test('beat diff between two files reads like an edit list, exit code follows diff(1)', () => {
  const a = tempProject()
  const b = join(dirname(a), 'b.beat')
  copyFileSync(a, b)
  beat(['set', b, 'drums.pattern.kick[3]', '0.7', 'lead.cutoff', '900'])
  const out = beat(['diff', a, b], { expectExit: 1 })
  assert.match(out, /drums: kick step 3 added \(vel 0\.7\)/)
  assert.match(out, /lead: cutoff 3200 -> 900/)
  // identical files: exit 0, "no musical changes"
  const same = beat(['diff', a, a])
  assert.match(same, /no musical changes/)
})

test('THE M2 EXIT CRITERION: beat diff between two git commits reads like an edit list', () => {
  const file = tempProject()
  const dir = dirname(file)
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  git('init', '-q')
  git('add', 'song.beat')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'v1')
  // a real editing session between the two commits
  beat(['set', file, 'lead.cutoff', '900', 'bpm', '124'])
  beat(['add-note', file, 'bass', '36', '0', '4', '0.85'])
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'v2')

  const out = beat(['diff', '--git', 'HEAD~1', 'HEAD', file], { expectExit: 1, cwd: dir })
  const lines = out.trim().split('\n')
  assert.match(lines[0]!, /^# .*song\.beat: HEAD~1 -> HEAD$/)
  assert.deepEqual(lines.slice(1), [
    'bpm: 126 -> 124',
    'bass: note added u100001 (pitch 36, start 0, dur 4, vel 0.85)',
    'lead: cutoff 3200 -> 900',
  ])
})
