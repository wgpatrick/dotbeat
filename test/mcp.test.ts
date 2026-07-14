// Protocol-level test of `beat mcp` — a real subprocess speaking newline-delimited JSON-RPC 2.0
// over stdio, exactly as an MCP client would.

import assert from 'node:assert/strict'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

interface McpClient {
  request: (method: string, params?: unknown) => Promise<any>
  notify: (method: string) => void
  close: () => void
}

function startMcp(): McpClient {
  const proc: ChildProcess = spawn(process.execPath, [join(repoRoot, 'cli', 'beat.mjs'), 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'] })
  let nextId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  let buf = ''
  proc.stdout!.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8')
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id)!
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message))
        else p.resolve(msg.result)
      }
    }
  })
  return {
    request: (method, params) =>
      new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id)
            reject(new Error(`no response to ${method} within 10s`))
          }
        }, 10000)
      }),
    notify: (method) => void proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'),
    close: () => proc.kill(),
  }
}

test('beat mcp speaks the MCP handshake and serves the tool suite', async () => {
  const mcp = startMcp()
  try {
    const init = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    assert.equal(init.serverInfo.name, 'beat')
    assert.ok(init.capabilities.tools)
    mcp.notify('notifications/initialized')

    const list = await mcp.request('tools/list')
    const names = list.tools.map((t: { name: string }) => t.name)
    for (const expected of [
      'beat_inspect',
      'beat_set',
      'beat_add_note',
      'beat_rm_note',
      'beat_group',
      'beat_rm_group',
      'beat_group_set',
      'beat_diff',
      'beat_metrics',
      'beat_lint',
      'beat_render',
      'beat_checkpoint',
      'beat_history',
      'beat_restore',
      'beat_pin',
      'beat_unpin',
      'beat_pins',
      'beat_audio_clip',
      'beat_audio_split',
      'beat_vary',
      'beat_score',
      'beat_sample',
      'beat_lane',
    ]) {
      assert.ok(names.includes(expected), `missing tool ${expected}`)
    }
    // every tool must carry a JSON schema an agent can act on
    for (const t of list.tools) assert.equal(t.inputSchema.type, 'object')
  } finally {
    mcp.close()
  }
})

test('tools/call: inspect and set work end-to-end on a real file, edits report as edit lists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-mcp-test-'))
  const file = join(dir, 'song.beat')
  copyFileSync(join(repoRoot, 'examples', 'real-groove.beat'), file)

  const mcp = startMcp()
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    mcp.notify('notifications/initialized')

    const inspect = await mcp.request('tools/call', { name: 'beat_inspect', arguments: { file } })
    assert.match(inspect.content[0].text, /126 bpm/)

    const set = await mcp.request('tools/call', {
      name: 'beat_set',
      arguments: { file, edits: [{ path: 'lead.cutoff', value: '900' }] },
    })
    assert.equal(set.content[0].text, 'lead: cutoff 3200 -> 900\n')
    assert.match(readFileSync(file, 'utf8'), /^ {4}cutoff 900$/m)

    // tool-level failure comes back as isError result (agent-visible), not a protocol error
    const bad = await mcp.request('tools/call', { name: 'beat_set', arguments: { file, edits: [{ path: 'lead.wobble', value: '1' }] } })
    assert.equal(bad.isError, true)
    assert.match(bad.content[0].text, /unknown field "wobble"/)

    // unknown tool IS a protocol error
    await assert.rejects(() => mcp.request('tools/call', { name: 'beat_explode', arguments: {} }), /unknown tool/)
  } finally {
    mcp.close()
  }
})

// Phase 22 Stream AF: track grouping over MCP (beat_group / beat_group_set / beat_rm_group), the
// agent-facing face on the same core primitives the daemon's POST /group route and the GUI's
// "+ group" affordance wrap.
test('tools/call: beat_group folds tracks, beat_group_set edits it, beat_rm_group ungroups', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-mcp-group-test-'))
  const file = join(dir, 'song.beat')
  copyFileSync(join(repoRoot, 'examples', 'real-groove.beat'), file)

  const mcp = startMcp()
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    mcp.notify('notifications/initialized')

    const grouped = await mcp.request('tools/call', {
      name: 'beat_group',
      arguments: { file, id: 'keys', track_ids: ['bass', 'chords'], name: 'Keys' },
    })
    assert.match(grouped.content[0].text, /group added "keys" \("Keys": bass, chords\)/)
    assert.match(readFileSync(file, 'utf8'), /^group keys Keys #[0-9a-f]{6} bass chords$/m)

    const renamed = await mcp.request('tools/call', { name: 'beat_group_set', arguments: { file, id: 'keys', name: 'Synths' } })
    assert.match(renamed.content[0].text, /group keys: name "Keys" -> "Synths"/)

    const ungrouped = await mcp.request('tools/call', { name: 'beat_rm_group', arguments: { file, id: 'keys' } })
    assert.match(ungrouped.content[0].text, /group removed "keys"/)
    assert.doesNotMatch(readFileSync(file, 'utf8'), /^group /m)

    // tool-level failure (double-grouping a track) comes back as isError, not a protocol error
    await mcp.request('tools/call', { name: 'beat_group', arguments: { file, id: 'g1', track_ids: ['bass'] } })
    const dup = await mcp.request('tools/call', { name: 'beat_group', arguments: { file, id: 'g2', track_ids: ['bass', 'lead'] } })
    assert.equal(dup.isError, true)
    assert.match(dup.content[0].text, /already in group/)
  } finally {
    mcp.close()
  }
})

// Phase 24 Stream CB: beat_song_move — reorder the arrangement timeline over MCP, the agent-facing
// face on the same core songMove primitive the daemon's POST /song {op:'move'} route and the GUI's
// section-chip drag both wrap.
test('tools/call: beat_song_move reorders a section end-to-end', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-mcp-song-move-test-'))
  const file = join(dir, 'song.beat')
  copyFileSync(join(repoRoot, 'examples', 'real-groove.beat'), file)

  const mcp = startMcp()
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    mcp.notify('notifications/initialized')

    // set up a 3-section song via beat_song first
    await mcp.request('tools/call', {
      name: 'beat_song',
      arguments: {
        file,
        clips: [{ track: 'drums', clip: 'a' }],
        scenes: [{ id: 'intro', slots: { drums: 'a' } }, { id: 'main', slots: { drums: 'a' } }, { id: 'outro', slots: { drums: 'a' } }],
        song: [{ scene: 'intro', bars: 2 }, { scene: 'main', bars: 8 }, { scene: 'outro', bars: 2 }],
      },
    })
    assert.match(readFileSync(file, 'utf8'), /section intro 2\n {2}section main 8\n {2}section outro 2/)

    // move the last section (index 2) to the front — a genuine reorder, not a delete+insert.
    const moved = await mcp.request('tools/call', { name: 'beat_song_move', arguments: { file, from_index: 2, to_index: 0 } })
    assert.match(moved.content[0].text, /^song: intro\(2\) main\(8\) outro\(2\) -> outro\(2\) intro\(2\) main\(8\)$/m)
    assert.match(readFileSync(file, 'utf8'), /section outro 2\n {2}section intro 2\n {2}section main 8/)

    // tool-level failure (out-of-range index) comes back as isError, not a protocol error
    const bad = await mcp.request('tools/call', { name: 'beat_song_move', arguments: { file, from_index: 99, to_index: 0 } })
    assert.equal(bad.isError, true)
    assert.match(bad.content[0].text, /out of range/)
  } finally {
    mcp.close()
  }
})

// Phase 22 Stream AE: audio-region clip tools (format v0.10). No beat_sample MCP tool exists yet
// (media registration is CLI-only — a pre-existing gap, not this stream's to close), so the
// fixture below writes its own media block directly; format-level edits don't verify the bytes
// on disk (see docs/format-spec.md's v0.5 section — hash/existence checks are a LOAD-time
// concern, not a parse-time one), so a placeholder hash is fine for exercising the tool surface.
test('tools/call: beat_add_track(audio), beat_audio_clip, and beat_audio_split work end-to-end', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-mcp-audio-test-'))
  const file = join(dir, 'song.beat')
  writeFileSync(
    file,
    `format_version 0.10
bpm 120
loop_bars 4
selected_track lead

media
  sample smp_kick sha256:${'a'.repeat(64)} media/kick.wav

track lead Lead #c678dd synth
  synth
    osc sawtooth
    volume 0
    cutoff 1000
    resonance 1
    attack 0.01
    decay 0.1
    sustain 0.5
    release 0.1
    pan 0
`,
  )

  const mcp = startMcp()
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    mcp.notify('notifications/initialized')

    const addTrack = await mcp.request('tools/call', { name: 'beat_add_track', arguments: { file, id: 'atrk', kind: 'audio' } })
    assert.match(addTrack.content[0].text, /atrk: track added \(audio/)

    const clipCall = await mcp.request('tools/call', {
      name: 'beat_audio_clip',
      arguments: { file, track: 'atrk', clip: 'c1', media: 'smp_kick', in: 0, out: 0.5, gain_db: -3, warp: 'repitch', rate: 1.5 },
    })
    assert.match(clipCall.content[0].text, /atrk: clip added "c1"/)
    assert.match(readFileSync(file, 'utf8'), /audio smp_kick 0 0\.5 -3 repitch 1\.5/)

    // tool-level failure (unregistered media id) comes back as isError, not a protocol error
    const badClip = await mcp.request('tools/call', {
      name: 'beat_audio_clip',
      arguments: { file, track: 'atrk', clip: 'c2', media: 'smp_ghost', in: 0, out: 1 },
    })
    assert.equal(badClip.isError, true)
    assert.match(badClip.content[0].text, /no sample "smp_ghost"/)

    const splitCall = await mcp.request('tools/call', { name: 'beat_audio_split', arguments: { file, track: 'atrk', clip: 'c1', at: 2 } })
    assert.match(splitCall.content[0].text, /split into "c1" and "c1-2"/)
    const after = readFileSync(file, 'utf8')
    // 2 steps @ 120bpm = 0.25s of timeline; rate 1.5 (repitch) -> 0.375s of source material
    assert.match(after, /clip c1\n {4}audio smp_kick 0 0\.375/)
    assert.match(after, /clip c1-2\n {4}audio smp_kick 0\.375 0\.5/)
  } finally {
    mcp.close()
  }
})

// Phase 34 Stream NA: the taste loop over MCP — beat_vary generates a batch whose manifest is
// byte-compatible with the CLI's, beat_score records ranked picks into the same jsonl shape, and
// the two surfaces are interchangeable per batch (the whole point: an MCP-generated batch scores
// from the CLI and vice versa). No render:true coverage here — real-time Chromium capture per
// variant is far too slow for CI; the flag's plumbing is the same renderVaryBatch the CLI's
// long-standing --render path uses.
test('tools/call: beat_vary -> beat_score round trip; batches are CLI-compatible both ways', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-mcp-vary-test-'))
  const file = join(dir, 'song.beat')
  copyFileSync(join(repoRoot, 'examples', 'real-groove.beat'), file)
  const logPath = join(dir, 'scores.jsonl')

  const mcp = startMcp()
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    mcp.notify('notifications/initialized')

    // rung 1: param-group batch — deterministic under seed, manifest carries replayable edits
    const paramDir = join(dir, 'batch-filter')
    const vary = await mcp.request('tools/call', {
      name: 'beat_vary',
      arguments: { file, track: 'lead', group: 'filter', count: 3, amount: 0.3, seed: 7, out_dir: paramDir },
    })
    assert.match(vary.content[0].text, /3 variants of lead\.filter \(amount 0\.3, seed 7\)/)
    assert.match(vary.content[0].text, /^ {2}v1: lead\./m)
    for (const f of ['v1.beat', 'v2.beat', 'v3.beat', 'manifest.json']) assert.ok(existsSync(join(paramDir, f)), `missing ${f}`)
    const manifest = JSON.parse(readFileSync(join(paramDir, 'manifest.json'), 'utf8'))
    assert.equal(manifest.parent, file)
    assert.equal(manifest.track, 'lead')
    assert.equal(manifest.group, 'filter')
    assert.equal(manifest.count, 3)
    assert.equal(manifest.amount, 0.3)
    assert.equal(manifest.seed, 7)
    assert.equal(manifest.variants.length, 3)
    for (const v of manifest.variants) assert.ok(Array.isArray(v.edits) && v.edits.length > 0, 'param variants carry replayable edits')
    // the parent file itself is untouched — variants are copies in the batch dir
    assert.equal(readFileSync(file, 'utf8'), readFileSync(join(repoRoot, 'examples', 'real-groove.beat'), 'utf8'))

    // score it over MCP: "vN" and bare-"N" pick forms both accepted (Phase 33 ME normalization)
    const score = await mcp.request('tools/call', { name: 'beat_score', arguments: { dir: paramDir, picks: ['v2', '1'], log: logPath } })
    assert.match(score.content[0].text, /scored .*batch-filter: v2 > v1 -> /)
    assert.match(score.content[0].text, /to adopt the winner: beat set .* lead\./)
    const entries = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    assert.equal(entries.length, 1)
    assert.deepEqual(entries[0].picks.map((p: { rank: number; variant: string }) => [p.rank, p.variant]), [[1, 'v2.beat'], [2, 'v1.beat']])
    assert.ok(Array.isArray(entries[0].picks[0].edits), 'picks carry the manifest edits')
    assert.deepEqual(entries[0].rejected, ['v3.beat'])
    assert.equal(entries[0].group, 'filter')
    assert.equal(entries[0].seed, 7)
    assert.equal(entries[0].parentSha256, manifest.parentSha256)

    // cross-surface: the CLI scores the SAME MCP-generated batch into the same log
    const cliOut = execFileSync(process.execPath, [join(repoRoot, 'cli', 'beat.mjs'), 'score', paramDir, '3', '--log', logPath], { encoding: 'utf8' })
    assert.match(cliOut, /scored .*batch-filter: v3 -> /)
    const after = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    assert.equal(after.length, 2)
    assert.deepEqual(Object.keys(after[1]), Object.keys(after[0]), 'CLI and MCP write the identical entry shape')

    // ...and beat_suggest parses the combined log (the jsonl really is one shared exhaust)
    const suggest = await mcp.request('tools/call', { name: 'beat_suggest', arguments: { file, track: 'lead', log: logPath } })
    assert.match(suggest.content[0].text, /filter/)

    // rung 2: feel batch — recipe manifest, lane scoping, cp-style adopt hint
    const feelDir = join(dir, 'batch-feel')
    const feel = await mcp.request('tools/call', {
      name: 'beat_vary',
      arguments: { file, track: 'drums', group: 'feel', count: 2, seed: 5, timing: 0.2, lanes: ['hat'], out_dir: feelDir },
    })
    assert.match(feel.content[0].text, /2 feel variants of drums \(seed 5\)/)
    const feelManifest = JSON.parse(readFileSync(join(feelDir, 'manifest.json'), 'utf8'))
    assert.equal(feelManifest.group, 'feel')
    assert.ok(!('amount' in feelManifest), 'feel manifests carry no amount key (same as the CLI)')
    assert.match(feelManifest.variants[0].recipe, /humanize seed=5 timing=0\.2 .*lanes=hat/)
    const feelScore = await mcp.request('tools/call', { name: 'beat_score', arguments: { dir: feelDir, picks: ['2'], log: logPath } })
    assert.match(feelScore.content[0].text, /to adopt the winner \(humanize seed=6 .*\): cp /)

    // ...and the reverse cross-surface direction: beat_score reads a CLI-generated batch
    const cliBatch = join(dir, 'batch-cli')
    execFileSync(process.execPath, [join(repoRoot, 'cli', 'beat.mjs'), 'vary', file, 'lead', 'env', '--count', '2', '--seed', '11', '--out-dir', cliBatch], { encoding: 'utf8' })
    const cliScored = await mcp.request('tools/call', { name: 'beat_score', arguments: { dir: cliBatch, picks: ['v1'], log: logPath } })
    assert.match(cliScored.content[0].text, /scored .*batch-cli: v1 -> /)

    // error paths surface as isError tool results with the CLI's own messages
    const badPick = await mcp.request('tools/call', { name: 'beat_score', arguments: { dir: paramDir, picks: ['9'], log: logPath } })
    assert.equal(badPick.isError, true)
    assert.match(badPick.content[0].text, /pick "9" is not a variant number 1-3 \(accepts "N" or "vN"\)/)
    const dupPicks = await mcp.request('tools/call', { name: 'beat_score', arguments: { dir: paramDir, picks: ['1', 'v1'], log: logPath } })
    assert.equal(dupPicks.isError, true)
    assert.match(dupPicks.content[0].text, /picks must be distinct/)
    const noBatch = await mcp.request('tools/call', { name: 'beat_score', arguments: { dir: join(dir, 'nope'), picks: ['1'] } })
    assert.equal(noBatch.isError, true)
    assert.match(noBatch.content[0].text, /no such batch directory or missing manifest\.json/)
    const badGroup = await mcp.request('tools/call', { name: 'beat_vary', arguments: { file, track: 'lead', group: 'wobble' } })
    assert.equal(badGroup.isError, true)
    assert.match(badGroup.content[0].text, /unknown group "wobble"/)
  } finally {
    mcp.close()
  }
})

// Phase 34 Stream NA: media registration + sample-backed lanes over MCP — beat_sample mirrors
// `beat sample` (sha256 computed server-side, path stored/resolved RELATIVE to the .beat file,
// same exists-check message) and beat_lane mirrors `beat lane` (gain/tune defaults, "none" to
// revert, register-first enforcement).
test('tools/call: beat_sample registers media relative to the .beat; beat_lane backs a drum lane with it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-mcp-sample-test-'))
  const file = join(dir, 'song.beat')
  copyFileSync(join(repoRoot, 'examples', 'real-groove.beat'), file)
  mkdirSync(join(dir, 'media'))
  writeFileSync(join(dir, 'media', 'kick.wav'), 'RIFF-not-really-a-wav — format edits never decode audio')

  const mcp = startMcp()
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    mcp.notify('notifications/initialized')

    // happy path: path is relative to the .beat file (NOT the server cwd, which is elsewhere)
    const reg = await mcp.request('tools/call', { name: 'beat_sample', arguments: { file, sample_id: 'smp_kick', path: 'media/kick.wav' } })
    assert.match(reg.content[0].text, /registered smp_kick: sha256:[0-9a-f]{12}\.\.\. media\/kick\.wav/)
    assert.match(readFileSync(file, 'utf8'), /^ {2}sample smp_kick sha256:[0-9a-f]{64} media\/kick\.wav$/m)

    // error: missing file — the CLI's own message, as an isError result
    const missing = await mcp.request('tools/call', { name: 'beat_sample', arguments: { file, sample_id: 'smp_ghost', path: 'media/ghost.wav' } })
    assert.equal(missing.isError, true)
    assert.match(missing.content[0].text, /no file at media\/ghost\.wav \(relative to .*\) — put the audio next to the project first/)

    // happy path: back a lane with the registered sample (explicit gain/tune)
    const lane = await mcp.request('tools/call', { name: 'beat_lane', arguments: { file, track: 'drums', lane: 'kick', sample_id: 'smp_kick', gain_db: -3, tune: 2 } })
    assert.match(lane.content[0].text, /drums: kick lane synth voice -> smp_kick \(-3 dB, 2 st\)/)
    assert.match(readFileSync(file, 'utf8'), /^ {2}lane kick smp_kick -3 2$/m)

    // ..."none" reverts to the synthesized voice
    const cleared = await mcp.request('tools/call', { name: 'beat_lane', arguments: { file, track: 'drums', lane: 'kick', sample_id: 'none' } })
    assert.match(cleared.content[0].text, /drums: kick lane smp_kick \(-3 dB, 2 st\) -> synth voice/)
    assert.doesNotMatch(readFileSync(file, 'utf8'), /^ {2}lane kick /m)

    // error: unregistered sample id — register-first is enforced with the core's own message
    const badLane = await mcp.request('tools/call', { name: 'beat_lane', arguments: { file, track: 'drums', lane: 'kick', sample_id: 'smp_ghost' } })
    assert.equal(badLane.isError, true)
    assert.match(badLane.content[0].text, /no sample "smp_ghost" in the media block/)
  } finally {
    mcp.close()
  }
})

// Phase 35 Stream OB: the stale-legacy cleanup is reachable MCP-natively (beat_lane clear_legacy),
// so an MCP-only agent that sees beat_inspect's flag isn't stranded with a CLI-only fix.
test('tools/call: beat_lane clear_legacy drops stale v0.5 lane lines on a declared-lane track, refuses on legacy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-mcp-clear-legacy-test-'))
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

  const mcp = startMcp()
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    mcp.notify('notifications/initialized')

    // beat_inspect flags the stale line (same text surface as the CLI)
    const inspect = await mcp.request('tools/call', { name: 'beat_inspect', arguments: { file } })
    assert.match(inspect.content[0].text, /legacy lane lines \(ignored by playback\): kick/)

    // mutually exclusive with lane/sample_id — loud, not silently ignored
    const mixed = await mcp.request('tools/call', { name: 'beat_lane', arguments: { file, track: 'dr', lane: 'kick', sample_id: 'none', clear_legacy: true } })
    assert.equal(mixed.isError, true)
    assert.match(mixed.content[0].text, /do not pass lane\/sample_id/)

    // the cleanup, phrased as stale-data removal (not a voice change)
    const cleared = await mcp.request('tools/call', { name: 'beat_lane', arguments: { file, track: 'dr', clear_legacy: true } })
    assert.match(cleared.content[0].text, /dr: stale legacy lane line kick \(ignored by playback\) kick-909 \(-2 dB, -3 st\) -> \(removed\)/)
    assert.doesNotMatch(readFileSync(file, 'utf8'), /lane kick kick-909/)
    assert.match(readFileSync(file, 'utf8'), /^ {2}lane kick synth:membrane$/m)
    const after = await mcp.request('tools/call', { name: 'beat_inspect', arguments: { file } })
    assert.doesNotMatch(after.content[0].text, /legacy lane lines/)

    // legacy implicit-5-lane track: those lines are live — refuse with the core's own message
    const legacyFile = join(dir, 'legacy.beat')
    copyFileSync(join(repoRoot, 'examples', 'real-groove.beat'), legacyFile)
    const refused = await mcp.request('tools/call', { name: 'beat_lane', arguments: { file: legacyFile, track: 'drums', clear_legacy: true } })
    assert.equal(refused.isError, true)
    assert.match(refused.content[0].text, /declares no lanes/)
  } finally {
    mcp.close()
  }
})

// Pilot 101: two fixes. (1) Unknown argument keys are rejected at the dispatch layer instead of
// silently ignored — an agent's plausible-but-wrong arg guess (e.g. `lanes` on beat_humanize,
// which only exists on beat_vary) must fail loudly, not silently widen the edit to the whole
// track. (2) beat_suggest validates track existence and passes the track's kind, matching the
// CLI's Phase-33 fix — the drift pilot 101 caught.
test('tools/call: unknown argument keys are rejected loudly, naming the valid ones', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-mcp-unknown-arg-test-'))
  const file = join(dir, 'song.beat')
  copyFileSync(join(repoRoot, 'examples', 'real-groove.beat'), file)

  const mcp = startMcp()
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    mcp.notify('notifications/initialized')

    // the exact pilot-101 trap: beat_humanize has no `lanes` key (its lane scoping is `lanes` on
    // beat_vary but `lanes` here was a guess) — must be an isError naming the valid keys, and the
    // file must be untouched
    const before = readFileSync(file, 'utf8')
    const res = await mcp.request('tools/call', { name: 'beat_humanize', arguments: { file, track: 'drums', lanez: 'hat' } })
    assert.equal(res.isError, true)
    assert.match(res.content[0].text, /unknown argument "lanez" for beat_humanize \(valid: .*track.*\)/)
    assert.equal(readFileSync(file, 'utf8'), before)

    // valid calls still work unchanged
    const ok = await mcp.request('tools/call', { name: 'beat_inspect', arguments: { file } })
    assert.equal(ok.isError ?? false, false)
  } finally {
    mcp.close()
  }
})

test('tools/call: beat_suggest validates the track exists (CLI parity, pilot 101)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-mcp-suggest-validate-test-'))
  const file = join(dir, 'song.beat')
  copyFileSync(join(repoRoot, 'examples', 'real-groove.beat'), file)

  const mcp = startMcp()
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    mcp.notify('notifications/initialized')

    const bad = await mcp.request('tools/call', { name: 'beat_suggest', arguments: { file, track: 'nope' } })
    assert.equal(bad.isError, true)
    assert.match(bad.content[0].text, /no track "nope" \(have: .*\)/)

    // a real synth track's cold start must not recommend a drums-only group (kind-aware, like the CLI)
    const good = await mcp.request('tools/call', { name: 'beat_suggest', arguments: { file, track: 'bass' } })
    assert.equal(good.isError ?? false, false)
    assert.doesNotMatch(good.content[0].text, /beat vary .* bass (kick|snare|hats)\b/)
  } finally {
    mcp.close()
  }
})
