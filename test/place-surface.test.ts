// Phase 36 Stream PB — the CLI/MCP face of v0.11 multi-region audio placement (decisions.md D16;
// docs/multi-region-audio-design.md Option A; core landed in Stream PA). Subprocess-level CLI
// tests and protocol-level MCP tests over the SAME core calls: `beat scene`'s repeatable
// <track>=<clip>[@<steps>] grammar, the new `beat place` / `beat unplace` verbs (and their
// beat_place / beat_unplace / beat_scene MCP twins), audio-split's auto-placement reporting, and
// cross-surface parity (identical inputs -> byte-identical files). Validation itself lives in
// core (setScene/placeClip/unplaceClip -> scenePlacementError) — these tests pin down that both
// surfaces call it and surface its errors verbatim, not that they re-implement it.

import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

function beat(args: string[], opts: { cwd?: string; expectExit?: number } = {}): string {
  try {
    return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8', cwd: opts.cwd })
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    if (opts.expectExit !== undefined && e.status === opts.expectExit) return (e.stdout ?? '') + (e.stderr ?? '')
    throw new Error(`beat ${args.join(' ')} exited ${e.status}:\n${e.stderr ?? ''}${e.stdout ?? ''}`)
  }
}

// bpm 120 -> one 16th step = 0.125 s. Timeline lengths: riser (0..1 s, rate 1) = 8 steps,
// impact (0..0.5 s) = 4 steps — so riser@0 + impact@8 never overlap, and impact@8 + impact@16
// don't either. Same shape as format-v11-placements.test.ts's V11_EXAMPLE, plus a song section.
const SHA = 'a'.repeat(64)
const FIXTURE = `format_version 0.11
bpm 120
loop_bars 2
selected_track lead

media
  sample smp sha256:${SHA} media/smp.wav

track lead Lead #c678dd synth
  synth
    osc square
    volume -14
    cutoff 4500
    resonance 0.8
    attack 0.01
    decay 0.3
    sustain 0.2
    release 0.4
    pan 0
  clip melody
    note n1 60 0 2 0.8

track fx FX #56b6c2 audio
  clip riser
    audio smp 0 1 0 off 1
  clip impact
    audio smp 0 0.5 0 off 1

scene s1
  slot lead melody
  slot fx riser

song
  section s1 4
`

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'beat-place-cli-test-'))
  const file = join(dir, 'song.beat')
  writeFileSync(file, FIXTURE)
  return file
}

// ---- CLI: beat scene's repeatable placement grammar ---------------------------------------------

test('beat scene <track>=<clip>[@<steps>] is repeatable per track and writes canonical slot lines', () => {
  const file = tempProject()
  const out = beat(['scene', file, 's2', 'lead=melody', 'fx=riser', 'fx=impact@8'])
  assert.match(out, /scene added "s2"/)
  const text = readFileSync(file, 'utf8')
  assert.match(text, /scene s2\n {2}slot lead melody\n {2}slot fx riser\n {2}slot fx impact at 8\n/)
})

test('beat scene surfaces core validation verbatim: @>0 on a synth track is the audio-only-for-v1 error, exit 2', () => {
  const file = tempProject()
  const before = readFileSync(file, 'utf8')
  const out = beat(['scene', file, 's2', 'lead=melody@4'], { expectExit: 2 })
  assert.match(out, /multi-placement is audio-only for now — synth\/drum clips tile from the section start/)
  assert.equal(readFileSync(file, 'utf8'), before, 'a rejected edit must not touch the file')
})

test('beat scene rejects a malformed @ suffix with a usable message', () => {
  const file = tempProject()
  const out = beat(['scene', file, 's2', 'fx=impact@nope'], { expectExit: 2 })
  assert.match(out, /@ must be followed by a step offset/)
})

// ---- CLI: beat place / beat unplace --------------------------------------------------------------

test('beat place adds one placement to an existing scene and reports it as a placement-granular diff', () => {
  const file = tempProject()
  const out = beat(['place', file, 's1', 'fx', 'impact', '8'])
  assert.equal(out, 'scene s1: fx +impact@8\n')
  assert.match(readFileSync(file, 'utf8'), /^ {2}slot fx impact at 8$/m)
})

test('beat place requires the scene to already exist (beat scene mints scenes) — core error verbatim, exit 2', () => {
  const file = tempProject()
  const out = beat(['place', file, 'nope', 'fx', 'impact', '8'], { expectExit: 2 })
  assert.match(out, /no scene "nope" \(have: s1\) — create it first \(beat scene \/ setScene\)/)
})

test('beat unplace: @<at> only required on ambiguity — core fail-loudly error verbatim, then the disambiguated form works', () => {
  const file = tempProject()
  beat(['place', file, 's1', 'fx', 'riser', '24.5']) // riser is now placed twice: @0 and @24.5
  const ambiguous = beat(['unplace', file, 's1', 'fx', 'riser'], { expectExit: 2 })
  assert.match(ambiguous, /clip "riser" is placed 2 times on track "fx" in scene "s1" \(at 0, 24\.5\) — pass the placement's at to say which one/)
  const out = beat(['unplace', file, 's1', 'fx', 'riser@24.5'])
  assert.equal(out, 'scene s1: fx -riser@24.5\n')
  // back to one placement -> no @ needed; removing the last placement drops the track key entirely
  const last = beat(['unplace', file, 's1', 'fx', 'riser'])
  assert.equal(last, 'scene s1: fx -riser\n')
  assert.ok(!readFileSync(file, 'utf8').includes('slot fx'), 'the track key is dropped with its last placement')
})

// ---- CLI: audio-split reports its auto-placements ------------------------------------------------

test('beat audio-split reports the auto-placements the split made (D16 q3), one line per placing scene', () => {
  const file = tempProject()
  beat(['scene', file, 's2', 'fx=riser@4']) // a second scene placing the parent, at a nonzero offset
  const out = beat(['audio-split', file, 'fx', 'riser', '4'])
  assert.match(out, /split "riser" into "riser" and "riser-2"/)
  assert.match(out, /auto-placed "riser-2" at 4 in scene "s1"/)
  assert.match(out, /auto-placed "riser-2" at 8 in scene "s2"/) // parent.at (4) + split offset (4)
  const text = readFileSync(file, 'utf8')
  assert.match(text, /scene s1\n {2}slot lead melody\n {2}slot fx riser\n {2}slot fx riser-2 at 4\n/)
  assert.match(text, /scene s2\n {2}slot fx riser at 4\n {2}slot fx riser-2 at 8\n/)
})

// ---- CLI: help ------------------------------------------------------------------------------------

test('beat place/unplace have per-command help in the clip/scene family, and place says scenes must pre-exist', () => {
  const placeHelp = beat(['place', '--help'])
  assert.match(placeHelp, /scene must already EXIST — beat scene\n\s+mints scenes/)
  assert.match(placeHelp, /related: beat clip, beat scene, beat scene-set, beat unplace, beat song/)
  const unplaceHelp = beat(['help', 'unplace'])
  assert.match(unplaceHelp, /only required when the/)
  assert.match(unplaceHelp, /related: beat clip, beat scene, beat scene-set, beat place, beat song/)
  const sceneHelp = beat(['scene', '--help'])
  assert.match(sceneHelp, /<track>=<clip>\[@<steps>\]/)
  assert.match(sceneHelp, /AUDIO tracks only/)
})

// ---- MCP: protocol-level tests over the same core calls ------------------------------------------

interface McpClient {
  request: (method: string, params?: unknown) => Promise<any>
  notify: (method: string) => void
  close: () => void
}

function startMcp(): McpClient {
  const proc: ChildProcess = spawn(process.execPath, [beatCli, 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'] })
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

async function withMcp(fn: (mcp: McpClient) => Promise<void>) {
  const mcp = startMcp()
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    mcp.notify('notifications/initialized')
    await fn(mcp)
  } finally {
    mcp.close()
  }
}

test('tools/list serves beat_scene, beat_place, beat_unplace, each carrying the audio-only-v1 caveat', async () => {
  await withMcp(async (mcp) => {
    const list = await mcp.request('tools/list')
    const byName = new Map<string, { description: string }>(list.tools.map((t: { name: string; description: string }) => [t.name, t]))
    for (const name of ['beat_scene', 'beat_place', 'beat_unplace']) assert.ok(byName.has(name), `missing tool ${name}`)
    assert.match(byName.get('beat_scene')!.description, /audio-only|AUDIO tracks only/i)
    assert.match(byName.get('beat_place')!.description, /AUDIO tracks only for now/)
    assert.match(byName.get('beat_place')!.description, /scene must already exist/)
    assert.match(byName.get('beat_unplace')!.description, /REQUIRED to say which placement/)
    assert.match(byName.get('beat_audio_split')!.description, /AUTO-PLACED/)
  })
})

test('tools/call: beat_scene takes placement lists (and bare clip ids), beat_place adds, beat_unplace fail-louds on ambiguity then removes', async () => {
  const file = tempProject()
  await withMcp(async (mcp) => {
    const scene = await mcp.request('tools/call', {
      name: 'beat_scene',
      arguments: { file, id: 's2', slots: { lead: 'melody', fx: [{ clip: 'riser' }, { clip: 'impact', at: 8 }] } },
    })
    assert.equal(scene.isError, undefined)
    assert.match(scene.content[0].text, /scene added "s2"/)
    assert.match(readFileSync(file, 'utf8'), /scene s2\n {2}slot lead melody\n {2}slot fx riser\n {2}slot fx impact at 8\n/)

    const place = await mcp.request('tools/call', { name: 'beat_place', arguments: { file, scene: 's2', track: 'fx', clip: 'impact', at: 16 } })
    assert.equal(place.content[0].text, 'scene s2: fx +impact@16\n')

    // ambiguity: impact is now placed twice — at is REQUIRED, and the core error comes through verbatim
    const ambiguous = await mcp.request('tools/call', { name: 'beat_unplace', arguments: { file, scene: 's2', track: 'fx', clip: 'impact' } })
    assert.equal(ambiguous.isError, true)
    assert.match(ambiguous.content[0].text, /clip "impact" is placed 2 times on track "fx" in scene "s2" \(at 8, 16\) — pass the placement's at to say which one/)

    const removed = await mcp.request('tools/call', { name: 'beat_unplace', arguments: { file, scene: 's2', track: 'fx', clip: 'impact', at: 16 } })
    assert.equal(removed.content[0].text, 'scene s2: fx -impact@16\n')
  })
})

test('tools/call: beat_place enforces the audio-only-v1 scope and the scene-must-exist rule (core errors verbatim, as isError results)', async () => {
  const file = tempProject()
  await withMcp(async (mcp) => {
    const synth = await mcp.request('tools/call', { name: 'beat_place', arguments: { file, scene: 's1', track: 'lead', clip: 'melody', at: 4 } })
    assert.equal(synth.isError, true)
    assert.match(synth.content[0].text, /multi-placement is audio-only for now/)

    const noScene = await mcp.request('tools/call', { name: 'beat_place', arguments: { file, scene: 'nope', track: 'fx', clip: 'impact', at: 0 } })
    assert.equal(noScene.isError, true)
    assert.match(noScene.content[0].text, /no scene "nope".*create it first/)
  })
})

test('tools/call: beat_song\'s scenes arg accepts the same placement shape (one composite call, same setScene underneath)', async () => {
  const file = tempProject()
  await withMcp(async (mcp) => {
    const res = await mcp.request('tools/call', {
      name: 'beat_song',
      arguments: {
        file,
        scenes: [{ id: 's2', slots: { fx: [{ clip: 'riser' }, { clip: 'impact', at: 8 }] } }],
        song: [
          { scene: 's1', bars: 4 },
          { scene: 's2', bars: 4 },
        ],
      },
    })
    assert.equal(res.isError, undefined)
    assert.match(readFileSync(file, 'utf8'), /scene s2\n {2}slot fx riser\n {2}slot fx impact at 8\n/)
  })
})

test('tools/call: beat_audio_split reports the auto-placements it made', async () => {
  const file = tempProject()
  await withMcp(async (mcp) => {
    const res = await mcp.request('tools/call', { name: 'beat_audio_split', arguments: { file, track: 'fx', clip: 'riser', at: 4 } })
    assert.equal(res.isError, undefined)
    assert.match(res.content[0].text, /split into "riser" and "riser-2"/)
    assert.match(res.content[0].text, /auto-placed "riser-2" at 4 in scene "s1"/)
  })
})

// ---- cross-surface parity: identical inputs through either surface -> byte-identical files -------

test('cross-surface parity: the same scene/place/unplace edits via CLI and MCP produce byte-identical files', async () => {
  const cliFile = tempProject()
  const mcpFile = tempProject()

  beat(['scene', cliFile, 's2', 'lead=melody', 'fx=riser', 'fx=impact@8'])
  beat(['place', cliFile, 's2', 'fx', 'impact', '16'])
  beat(['unplace', cliFile, 's2', 'fx', 'impact@8'])

  await withMcp(async (mcp) => {
    await mcp.request('tools/call', {
      name: 'beat_scene',
      arguments: { file: mcpFile, id: 's2', slots: { lead: 'melody', fx: [{ clip: 'riser' }, { clip: 'impact', at: 8 }] } },
    })
    await mcp.request('tools/call', { name: 'beat_place', arguments: { file: mcpFile, scene: 's2', track: 'fx', clip: 'impact', at: 16 } })
    await mcp.request('tools/call', { name: 'beat_unplace', arguments: { file: mcpFile, scene: 's2', track: 'fx', clip: 'impact', at: 8 } })
  })

  assert.equal(readFileSync(cliFile, 'utf8'), readFileSync(mcpFile, 'utf8'))
})
