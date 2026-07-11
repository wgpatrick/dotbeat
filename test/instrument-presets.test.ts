// v0.8+ multi-preset listing (docs/phase-8-plan.md's "Remaining": "beat inspect should list a
// bank's presets" — a loaded SF2 can carry many programs, not just the one a track selects).
// End-to-end CLI + MCP subprocess tests against the real FreePats piano SF2 fixture already
// vendored in presets/sf2/ (docs/phase-8-plan.md's spike bank) — no mock/stub bank, no beatlab
// checkout, no audio rendering required (SoundBankLoader.fromArrayBuffer is a pure binary-format
// parse; verified live during implementation that it needs neither node-web-audio-api nor a
// window/document shim).

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const sf2Fixture = join(repoRoot, 'presets', 'sf2', 'upright-piano-kw-small.sf2')

function beat(args: string[], opts: { cwd?: string } = {}): string {
  return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8', cwd: opts.cwd })
}

function tempProjectWithPiano(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'beat-preset-test-'))
  const file = join(dir, 'song.beat')
  copyFileSync(sf2Fixture, join(dir, 'piano.sf2'))
  beat(['init', file])
  beat(['sample', file, 'piano', 'piano.sf2'])
  beat(['add-track', file, 'keys', 'instrument', '--soundfont', 'piano', '--program', '0'])
  return { dir, file }
}

test('beat inspect lists the SF2 bank\'s full preset set for an instrument track, marking the selected one', () => {
  const { file } = tempProjectWithPiano()
  const text = beat(['inspect', file])
  assert.match(text, /soundfont presets:/)
  assert.match(text, /keys: 1 preset/)
  assert.match(text, /program 0 \(bank 0\/0\): "Upright piano KW"\s*\[selected\]/)
})

test('beat inspect --json attaches instrumentPresets keyed by track id', () => {
  const { file } = tempProjectWithPiano()
  const json = JSON.parse(beat(['inspect', file, '--json'])) as {
    tracks: unknown[]
    instrumentPresets: Record<string, { presets: { program: number; bankMSB: number; bankLSB: number; name: string }[] } | { error: string }>
  }
  assert.equal(json.tracks.length, 2) // the init starter track + keys
  const keys = json.instrumentPresets.keys
  assert.ok(keys && 'presets' in keys, 'keys track has a resolved preset list')
  assert.deepEqual((keys as { presets: unknown[] }).presets, [{ program: 0, bankMSB: 0, bankLSB: 0, name: 'Upright piano KW' }])
})

test('beat inspect degrades gracefully (per-track error, not a crash) when the sf2 file is missing', () => {
  const { file } = tempProjectWithPiano()
  // repoint the registered sample's path at a file that doesn't exist — inspect must still run
  // to completion and report the failure per-track, not throw and abort the whole command.
  const before = readFileSync(file, 'utf8')
  const corrupted = before.replace('piano.sf2', 'missing.sf2')
  writeFileSync(file, corrupted)
  const text = beat(['inspect', file])
  assert.match(text, /soundfont presets:/)
  assert.match(text, /keys: file not found/)
})

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

test('MCP: beat_add_track builds an instrument track, beat_inspect lists its presets, beat_song authors clips/scenes/song on it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-mcp-instrument-test-'))
  const file = join(dir, 'song.beat')
  copyFileSync(sf2Fixture, join(dir, 'piano.sf2'))
  beat(['init', file])
  beat(['sample', file, 'piano', 'piano.sf2'])

  const mcp = startMcp()
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    mcp.notify('notifications/initialized')

    const added = await mcp.request('tools/call', {
      name: 'beat_add_track',
      arguments: { file, id: 'keys', kind: 'instrument', soundfont_sample: 'piano', soundfont_program: 0 },
    })
    assert.match(added.content[0].text, /track added \(instrument/)

    const inspect = await mcp.request('tools/call', { name: 'beat_inspect', arguments: { file } })
    assert.match(inspect.content[0].text, /soundfont presets:/)
    assert.match(inspect.content[0].text, /"Upright piano KW"/)

    // author a note, snapshot it into a clip, wire it into a scene + song via beat_song — the
    // same MCP tool synth/drum tracks use, now proven end-to-end on an instrument track.
    await mcp.request('tools/call', { name: 'beat_add_note', arguments: { file, track: 'keys', pitch: 60, start: 0, duration: 4, velocity: 0.8 } })
    const song = await mcp.request('tools/call', {
      name: 'beat_song',
      arguments: { file, clips: [{ track: 'keys', clip: 'take1' }], scenes: [{ id: 'a', slots: { keys: 'take1' } }], song: [{ scene: 'a', bars: 4 }] },
    })
    assert.match(song.content[0].text, /clip added "take1"/)
    assert.match(song.content[0].text, /scene added "a"/)
    assert.match(song.content[0].text, /song: \(no song\) -> a\(4\)/)
  } finally {
    mcp.close()
  }
})
