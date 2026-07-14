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
  assert.match(out, /^usage:\n {2}beat vary <file> <track> <group-or-lane>/)
  assert.match(out, /beat vary --groups/)
  assert.match(out, /\nrelated: beat score, beat adopt, beat suggest\n$/)
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

// ---- Phase 35 Stream OD: reference mix profile (save-profile / lint --ref) ------------------

/** Tiny 16-bit PCM stereo wav of a sine tone — enough signal for metrics, no renders involved. */
function writeTestWav(path: string, freq: number, amp: number, seconds = 1): void {
  const FS = 44100
  const n = Math.round(seconds * FS)
  const ch = 2
  const dataSize = n * ch * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(ch, 22)
  buf.writeUInt32LE(FS, 24); buf.writeUInt32LE(FS * ch * 2, 28); buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40)
  let o = 44
  for (let i = 0; i < n; i++) {
    const v = Math.round(amp * Math.sin((2 * Math.PI * freq * i) / FS) * 32767)
    for (let c = 0; c < ch; c++) { buf.writeInt16LE(v, o); o += 2 }
  }
  writeFileSync(path, buf)
}

test('beat metrics --save-profile writes a provenance-carrying profile; beat lint --ref compares against it', () => {
  const dir = dirname(tempProject())
  const refWav = join(dir, 'ref.wav')
  const mixWav = join(dir, 'mix.wav')
  writeTestWav(refWav, 997, 0.4)
  writeTestWav(mixWav, 997, 0.1) // 12 dB quieter, same spectrum

  const out = beat(['metrics', refWav, '--save-profile', join(dir, 'ref.json')])
  assert.match(out, /reference profile saved to .*ref\.json/)
  assert.match(out, /LUFS integrated/) // the ordinary metrics readout still prints
  const profile = JSON.parse(readFileSync(join(dir, 'ref.json'), 'utf8')) as { format: string; source: string; createdAt: string; tool: string }
  assert.equal(profile.format, 'dotbeat-mix-profile')
  assert.equal(profile.source, 'ref.wav')
  assert.ok(profile.createdAt && profile.tool, 'provenance fields present')

  // ref-mode findings name the reference value, the measured value, and the edit to try
  const lintOut = beat(['lint', mixWav, '--ref', join(dir, 'ref.json')])
  assert.match(lintOut, /\[ref-loudness\] integrated loudness -\d+\.\d LUFS is 12\.0 LU quieter than the reference \(ref\.wav: -\d+\.\d LUFS\)/)
  assert.match(lintOut, /fix: raise all track volumes/)
  // --json carries the same findings for machine consumers
  const json = JSON.parse(beat(['lint', mixWav, '--ref', join(dir, 'ref.json'), '--json'])) as { rule: string }[]
  assert.ok(json.some((f) => f.rule === 'ref-loudness'))
})

test('beat lint --ref with --target errors: one comparison frame at a time', () => {
  const dir = dirname(tempProject())
  const mixWav = join(dir, 'mix.wav')
  writeTestWav(mixWav, 997, 0.3)
  writeTestWav(join(dir, 'ref.wav'), 997, 0.4)
  beat(['metrics', join(dir, 'ref.wav'), '--save-profile', join(dir, 'ref.json')])
  const out = beat(['lint', mixWav, '--ref', join(dir, 'ref.json'), '--target', '-14'], { expectExit: 2 })
  assert.match(out, /pick one comparison frame: --ref .* or --target/)
  // and a missing/garbage profile fails with pointers, not a stack trace
  const missing = beat(['lint', mixWav, '--ref', join(dir, 'nope.json')], { expectExit: 2 })
  assert.match(missing, /no profile at .*nope\.json — write one with: beat metrics/)
  writeFileSync(join(dir, 'garbage.json'), '{"some":"json"}')
  const garbage = beat(['lint', mixWav, '--ref', join(dir, 'garbage.json')], { expectExit: 2 })
  assert.match(garbage, /not a dotbeat mix profile/)
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

// Phase 35 Stream OA — lane-aware drum vary over the real CLI (pilot 101's high finding). The
// unit-level guarantees live in test/vary-lanes.test.ts; these check the end-to-end story: a
// fresh CLI drums track is declared-lane, `vary <lane>` writes a batch whose manifest edits
// replay through `beat set` byte-identically (the adopt contract), the legacy group name errors
// loudly, and `--groups` is track-aware when given a file+track.
test('beat vary <lane> end-to-end: batch, loud legacy error, and beat-set adopt replay', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-cli-lane-vary-'))
  const file = join(dir, 'groove.beat')
  beat(['init', file])
  beat(['add-track', file, 'drums', 'drums']) // CLI default: the declared 12-lane GM kit
  const err = beat(['vary', file, 'drums', 'hats', '--seed', '7'], { expectExit: 2 })
  assert.match(err, /legacy track-wide drum-voice params/)
  assert.match(err, /kick, snare, rimshot/)
  const out = beat(['vary', file, 'drums', 'kick', '--seed', '7', '--count', '3', '--out-dir', join(dir, 'batch')])
  assert.match(out, /3 variants of drums\.kick/)
  assert.match(out, /drums\.lane\.kick\./)
  const manifest = JSON.parse(readFileSync(join(dir, 'batch', 'manifest.json'), 'utf8')) as { variants: { file: string; edits: string[] }[] }
  // adopt the "winner" exactly the way `beat score`'s hint says to: beat set <file> <edits...>
  const pairs = manifest.variants[0]!.edits.flatMap((e) => {
    const sp = e.indexOf(' ')
    return [e.slice(0, sp), e.slice(sp + 1)]
  })
  beat(['set', file, ...pairs])
  assert.equal(readFileSync(file, 'utf8'), readFileSync(join(dir, 'batch', 'v1.beat'), 'utf8'), 'beat set replay must reproduce the variant file byte-identically')
})

test('beat vary --groups is track-aware with a file+track, and documents both modes without', () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-cli-lane-groups-'))
  const file = join(dir, 'groove.beat')
  beat(['init', file])
  beat(['add-track', file, 'drums', 'drums'])
  const aware = beat(['vary', file, 'drums', '--groups'])
  assert.match(aware, /declared-lane drums track "drums"/)
  assert.match(aware, /^kick {6}/m)
  assert.match(aware, /^tom_lo {4}/m)
  assert.match(aware, /legacy groups kick\/snare\/hats error on this track/)
  const stat = beat(['vary', '--groups'])
  assert.match(stat, /^kick {6}/m)
  assert.match(stat, /LEGACY drums tracks only/)
})

// ==== Phase 37 Stream RD begin ====
// `beat source` — real sound sources into the taste loop. The OFFLINE path (source add of a file
// you already have) is fully exercised; the GATED Freesound path is asserted only for its clean,
// stack-trace-free key/egress error (this environment has no key and blocks egress to freesound.org).
const sampleWav = join(repoRoot, 'presets', 'kit-init', 'kick.wav') // a real 16-bit PCM wav in-repo

test('beat source add: offline ingest preps, registers, writes an enforced sidecar; sample is then usable in an audio-clip', () => {
  const file = tempProject()
  const dir = dirname(file)
  const out = beat(['source', 'add', file, 'smp_src', sampleWav, '--note', 'e2e'])
  assert.match(out, /registered smp_src: sha256:[0-9a-f]{12}\.\.\. media\/smp_src\.wav \(0\.\d+s, license unspecified\)/)
  assert.match(out, /provenance sidecar: media\/smp_src\.wav\.json/)

  // registered into the media block with a content hash
  assert.match(readFileSync(file, 'utf8'), /sample smp_src sha256:[0-9a-f]{64} media\/smp_src\.wav/)

  // ENFORCED provenance sidecar with the required fields; default license is "unspecified"
  const sidecar = JSON.parse(readFileSync(join(dir, 'media', 'smp_src.wav.json'), 'utf8'))
  assert.equal(sidecar.license, 'unspecified', 'offline add license defaults to "unspecified"')
  assert.equal(typeof sidecar.source, 'string')
  assert.match(sidecar.sha256, /^[0-9a-f]{64}$/)
  assert.equal(typeof sidecar.preparedAt, 'string')
  assert.equal(sidecar.note, 'e2e')

  // the registered sample is a first-class media id: usable in an audio-region clip
  beat(['add-track', file, 'atrk', 'audio'])
  const clip = beat(['audio-clip', file, 'atrk', 'c1', 'smp_src', '0', '0.2'])
  assert.match(clip, /atrk: clip added "c1"/)
  assert.match(readFileSync(file, 'utf8'), /audio smp_src 0 0\.2/)
})

test('beat source add: --license passes through to the sidecar (only the Freesound path forces CC0-1.0)', () => {
  const file = tempProject()
  const dir = dirname(file)
  beat(['source', 'add', file, 'smp_cc', sampleWav, '--license', 'CC-BY-4.0'])
  const sidecar = JSON.parse(readFileSync(join(dir, 'media', 'smp_cc.wav.json'), 'utf8'))
  assert.equal(sidecar.license, 'CC-BY-4.0', 'custom --license is recorded verbatim')
})

test('beat source search without a key fails with an actionable error and NO stack trace (exit 2)', () => {
  const out = beat(['source', 'search', 'kick'], { expectExit: 2 })
  assert.match(out, /^error: Freesound needs an API key/)
  assert.match(out, /FREESOUND_API_KEY/)
  assert.doesNotMatch(out, /\n\s+at /, 'must not leak a JS stack trace')
  assert.doesNotMatch(out, /SourceError/, 'must not leak the internal error class name')
})
// ==== Phase 37 Stream RD end ====
