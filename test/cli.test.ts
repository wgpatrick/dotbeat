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
  assert.match(text, /^format 0\.8 \| 126 bpm/)
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
  assert.match(out, /drums: kick hit added kick3 \(step 3, vel 0\.7\)/)
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

// Phase 10 Stream C: the BYO-Claude-Code onboarding path (docs/agent-setup.md,
// docs/product-spec-desktop.md §6 D5) starts with `beat mcp-init` writing a ready-to-use
// .mcp.json next to the project — this is the config-generation logic, tested for real.
test('beat mcp-init writes a .mcp.json next to the project pointing at this beat.mjs\'s "mcp" command', () => {
  const file = tempProject()
  const dir = dirname(file)
  const out = beat(['mcp-init', file])
  assert.match(out, /wrote .*\.mcp\.json/)
  assert.match(out, /beat_inspect/)
  const config = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'))
  assert.deepEqual(Object.keys(config.mcpServers), ['beat'])
  assert.equal(config.mcpServers.beat.command, 'node')
  assert.equal(config.mcpServers.beat.args[0], beatCli)
  assert.equal(config.mcpServers.beat.args[1], 'mcp')
})

test('beat mcp-init refuses to overwrite an existing .mcp.json without --force', () => {
  const file = tempProject()
  const dir = dirname(file)
  beat(['mcp-init', file])
  const out = beat(['mcp-init', file], { expectExit: 2 })
  assert.match(out, /already exists.*--force/)
  // --force does overwrite
  const forced = beat(['mcp-init', file, '--force'])
  assert.match(forced, /wrote .*\.mcp\.json/)
  const config = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'))
  assert.equal(config.mcpServers.beat.args[1], 'mcp')
})

test('beat mcp-init errors on a missing project file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-cli-test-'))
  const out = beat(['mcp-init', join(dir, 'nope.beat')], { expectExit: 2 })
  assert.match(out, /does not exist/)
})

// Phase 34 Stream NB (pilots 94 & 97): per-command help — `beat <cmd> --help` (only as the FIRST
// arg after the command) and `beat help <cmd>` print just that command's block plus a "related:"
// family pointer, instead of the monolithic no-args dump.
test('beat <cmd> --help prints only that command\'s block', () => {
  const out = beat(['quantize', '--help'])
  assert.match(out, /^usage:\n {2}beat quantize <file> <track>/)
  assert.match(out, /snap notes toward the grid/)
  // ONLY the quantize block — no other command, no paths footer, and much shorter than the dump
  assert.doesNotMatch(out, /beat init|beat humanize|paths for set/)
  assert.ok(out.split('\n').length < 8, `expected a short block, got ${out.split('\n').length} lines`)
  // --help is intercepted only as the first arg, so it can't shadow a command's own later args —
  // and the full no-args dump still ends with set's paths footer as it always has
  const dump = beat([])
  assert.match(dump, /^usage:\n {2}beat init /)
  assert.match(dump, /paths for set: bpm \| loop_bars/)
})

test('beat help <cmd> works and appends the command\'s "related:" family', () => {
  const out = beat(['help', 'vary'])
  assert.match(out, /^usage:\n {2}beat vary <file> <track> <group>/)
  assert.match(out, /beat vary --groups/)
  assert.match(out, /\nrelated: beat score, beat suggest\n$/)
  // set's per-command view carries its paths footer
  const setHelp = beat(['set', '--help'])
  assert.match(setHelp, /paths for set: bpm \| loop_bars/)
  // a family in the middle: pin points back at the rest of the versioning loop
  const pinHelp = beat(['help', 'pin'])
  assert.match(pinHelp, /related: beat checkpoint, beat history, beat restore, beat unpin, beat pins/)
})

test('beat help <unknown> is the standard unknown-command error, exit 2', () => {
  const out = beat(['help', 'nope'], { expectExit: 2 })
  assert.match(out, /unknown command "nope"/)
  assert.match(out, /usage:/) // the full dump follows, same as any unknown command
  // ...and an unknown command with --help behaves the same way
  const out2 = beat(['bogus', '--help'], { expectExit: 2 })
  assert.match(out2, /unknown command "bogus"/)
})

// Phase 35 Stream OB: stale-legacy laneSamples surface — inspect flags them (text AND --json stay
// consistent), `beat lane --clear-legacy` is the explicit one-shot cleanup, and the file keeps
// round-tripping them untouched until that command runs (D4).
test('beat inspect flags stale legacy lane lines; beat lane --clear-legacy removes them explicitly', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-cli-test-'))
  const file = join(dir, 'song.beat')
  writeFileSync(
    file,
    `format_version 0.10
bpm 120
loop_bars 1
selected_track dr

media
  sample kick-909 sha256:${'d'.repeat(64)} media/kick.wav

track dr Drums #e06c75 drums
  synth
    osc sawtooth
    volume -10
    cutoff 12000
    resonance 0.1
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
  lane kick synth:membrane
  lane snare synth:noise
  lane kick kick-909 -2 -3
  hit h1 kick 0 0.9
`,
  )
  const before = readFileSync(file, 'utf8')

  // Text view: per-lane truth + the stale flag; no bogus synth: header on the drums track.
  const text = beat(['inspect', file])
  assert.match(text, /^ {2}bus: -10 dB/m)
  assert.doesNotMatch(text, /^ {2}synth: /m)
  assert.match(text, /^ {4}kick {4}synth:membrane$/m)
  assert.match(text, /legacy lane lines \(ignored by playback\): kick — .*beat lane <file> dr --clear-legacy/)
  // --json view carries the same facts structurally: declared lanes + the stale laneSamples bag.
  const json = JSON.parse(beat(['inspect', file, '--json'])) as { tracks: { id: string; lanes: { name: string }[]; laneSamples: Record<string, unknown> }[] }
  const dr = json.tracks.find((t) => t.id === 'dr')!
  assert.deepEqual(dr.lanes.map((l) => l.name), ['kick', 'snare'])
  assert.deepEqual(Object.keys(dr.laneSamples), ['kick'])
  // Reading never mutates: the stale line survives inspect (D4 — only the explicit cleanup drops it).
  assert.equal(readFileSync(file, 'utf8'), before)

  const out = beat(['lane', file, 'dr', '--clear-legacy'])
  // The edit list phrases this as stale-data removal, NOT a voice change ("-> synth voice" would
  // contradict the 2026-07-13 setLaneSample fix: on declared-lane tracks playback never read this).
  assert.match(out, /dr: stale legacy lane line kick \(ignored by playback\) kick-909 \(-2 dB, -3 st\) -> \(removed\)/)
  assert.match(out, /cleared 1 stale legacy lane line on dr: kick/)
  assert.doesNotMatch(readFileSync(file, 'utf8'), /lane kick kick-909/)
  assert.match(readFileSync(file, 'utf8'), /^ {2}lane kick synth:membrane$/m)
  assert.doesNotMatch(beat(['inspect', file]), /legacy lane lines/)

  // Nothing left to clear -> loud error, exit 2 (never a silent no-op).
  const err = beat(['lane', file, 'dr', '--clear-legacy'], { expectExit: 2 })
  assert.match(err, /no legacy lane-sample lines to clear/)
})
