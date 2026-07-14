// `beat vary --scope selection` — the CLI wiring that lets a live daemon's /selection stand in
// for typing --lanes/--ids by hand (docs/phase-9-selection-vary-plan.md). The resolution itself
// (selection -> {lanes|ids}) is `selectionToVaryScope`, a pure function fully unit-tested in
// test/selection.test.ts without any daemon. What's specific to THIS file is the thin glue: the
// CLI fetches the live selection over HTTP from a real running daemon and passes the resolved
// scope through to `varyFeel` — so these tests spin up a real daemon (same pattern as
// test/daemon.test.ts / test/selection.test.ts) and drive the actual `beat` CLI as a subprocess
// (same pattern as test/cli.test.ts), rather than mocking the fetch.

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse, type BeatSelection } from '../src/core/index.js'
import { startDaemon, type Daemon } from '../src/daemon/daemon.js'

// IMPORTANT: async execFile, not execFileSync. The daemon these tests drive lives in THIS process
// (startDaemon below); a *Sync spawn blocks the whole event loop until the child exits, which
// would deadlock the moment the child `beat` process tries to open an HTTP connection back to
// this process's daemon to GET /selection. Async execFile keeps the event loop free to service it.
const execFileAsync = promisify(execFile)

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

function synthBlock(): string {
  return `  synth
    osc sawtooth
    volume -10
    cutoff 9000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.7
    release 0.3
    pan 0`
}

// drums (kick/hat/openhat hits) + lead (three notes) — same shape as test/selection.test.ts's
// fixture, so the resolved ids here match what selection.test.ts already proved selectionToVaryScope
// computes for this exact document.
const TEST_BEAT = `format_version 0.7
bpm 120
loop_bars 8
selected_track lead

track drums Drums #e06c75 drums
${synthBlock()}
  pattern kick 1 0 0 0 1 0 0 0 1 0 0 0 1 0 0 0
  pattern snare 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
  pattern clap 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
  pattern hat 0 0 1 0 0 0 1 0 0 0 1 0 0 0 1 0
  pattern openhat 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0

track lead Lead #c678dd synth
${synthBlock()}
  note u1 60 0 4 0.8
  note u2 64 3.5 0.5 0.7
  note u3 67 67 2 0.6
`

async function beat(args: string[], opts: { expectExit?: number } = {}): Promise<string> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
    return stdout
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string }
    if (opts.expectExit !== undefined && e.code === opts.expectExit) return (e.stdout ?? '') + (e.stderr ?? '')
    throw new Error(`beat ${args.join(' ')} exited ${e.code}:\n${e.stderr ?? ''}${e.stdout ?? ''}`)
  }
}

async function withDaemon(fn: (daemon: Daemon, filePath: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'beat-vary-scope-test-'))
  const filePath = join(dir, 'song.beat')
  writeFileSync(filePath, TEST_BEAT)
  const daemon = await startDaemon({ filePath, port: 0 }) // port 0 = OS-assigned, parallel-safe
  try {
    await fn(daemon, filePath)
  } finally {
    await daemon.close()
  }
}

async function setSelection(port: number, sel: BeatSelection): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/selection`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sel),
  })
  assert.equal(res.status, 200, `POST /selection failed: ${await res.text()}`)
}

test('vary --scope selection: a lanes selection scopes a feel batch to just that drum lane', async () => {
  await withDaemon(async (daemon, filePath) => {
    await setSelection(daemon.port, { lanes: [{ track: 'drums', lane: 'hat' }] })
    const dir = mkdtempSync(join(tmpdir(), 'beat-vary-scope-out-'))
    const out = await beat(['vary', filePath, 'drums', 'feel', '--scope', 'selection', '--port', String(daemon.port), '--seed', '1', '--out-dir', join(dir, 'batch')])
    assert.match(out, /scope: selection -> lanes hat/)

    const parent = parse(TEST_BEAT)
    const parentDrums = parent.tracks.find((t) => t.id === 'drums')!
    const variant = parse(readFileSync(join(dir, 'batch', 'v1.beat'), 'utf8'))
    const variantDrums = variant.tracks.find((t) => t.id === 'drums')!

    let hatChanged = 0
    for (const h of parentDrums.hits) {
      const after = variantDrums.hits.find((v) => v.id === h.id)!
      const same = after.start === h.start && after.velocity === h.velocity
      if (h.lane === 'hat') {
        if (!same) hatChanged++
      } else {
        assert.ok(same, `non-hat hit ${h.id} should be untouched by a --lanes hat scope`)
      }
    }
    assert.ok(hatChanged > 0, 'at least one hat hit should have moved')
  })
})

test('vary --scope selection: a notes selection maps to concrete ids, scoping a synth track to just those notes', async () => {
  await withDaemon(async (daemon, filePath) => {
    await setSelection(daemon.port, { notes: [{ track: 'lead', note: 'u1' }] })
    const dir = mkdtempSync(join(tmpdir(), 'beat-vary-scope-out-'))
    const out = await beat(['vary', filePath, 'lead', 'feel', '--scope', 'selection', '--port', String(daemon.port), '--seed', '1', '--out-dir', join(dir, 'batch')])
    assert.match(out, /scope: selection -> 1 id\(s\): u1/)

    const parent = parse(TEST_BEAT)
    const parentLead = parent.tracks.find((t) => t.id === 'lead')!
    const variant = parse(readFileSync(join(dir, 'batch', 'v1.beat'), 'utf8'))
    const variantLead = variant.tracks.find((t) => t.id === 'lead')!

    for (const n of parentLead.notes) {
      const after = variantLead.notes.find((v) => v.id === n.id)!
      const same = after.start === n.start && after.velocity === n.velocity
      if (n.id === 'u1') assert.ok(!same, 'u1 should have moved')
      else assert.ok(same, `${n.id} should be untouched by a --ids [u1] scope`)
    }
  })
})

test('vary --scope selection: a selection covering a different track fails loudly instead of varying the wrong track', async () => {
  await withDaemon(async (daemon, filePath) => {
    await setSelection(daemon.port, { tracks: ['lead'] })
    const dir = mkdtempSync(join(tmpdir(), 'beat-vary-scope-out-'))
    const out = await beat(
      ['vary', filePath, 'drums', 'feel', '--scope', 'selection', '--port', String(daemon.port), '--seed', '1', '--out-dir', join(dir, 'batch')],
      { expectExit: 2 },
    )
    assert.match(out, /does not cover track "drums"/)
  })
})

test('vary --scope selection: an empty/no-op selection falls back to whole-track scope, same as omitting --scope', async () => {
  await withDaemon(async (daemon, filePath) => {
    // GET /selection with nothing POSTed yet returns {} — "no selection" degenerates to "whole track".
    const dir = mkdtempSync(join(tmpdir(), 'beat-vary-scope-out-'))
    const out = await beat(['vary', filePath, 'lead', 'feel', '--scope', 'selection', '--port', String(daemon.port), '--seed', '1', '--out-dir', join(dir, 'batch')])
    assert.match(out, /scope: selection -> whole track/)
  })
})

test('vary --scope selection requires --port, and rejects being combined with --lanes/--ids', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-vary-scope-noport-'))
  const filePath = join(dir, 'song.beat')
  writeFileSync(filePath, TEST_BEAT)

  const noPort = await beat(['vary', filePath, 'lead', 'feel', '--scope', 'selection', '--seed', '1', '--out-dir', join(dir, 'batch1')], { expectExit: 2 })
  assert.match(noPort, /needs --port/)

  const withLanes = await beat(
    ['vary', filePath, 'lead', 'feel', '--scope', 'selection', '--port', '9999', '--lanes', 'hat', '--seed', '1', '--out-dir', join(dir, 'batch2')],
    { expectExit: 2 },
  )
  assert.match(withLanes, /cannot be combined with --lanes\/--ids/)
})

test('vary --scope selection only applies to "feel" — a param-group vary rejects it up front', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'beat-vary-scope-paramgroup-'))
  const filePath = join(dir, 'song.beat')
  writeFileSync(filePath, TEST_BEAT)
  const out = await beat(['vary', filePath, 'drums', 'kick', '--scope', 'selection', '--port', '9999', '--seed', '1', '--out-dir', join(dir, 'batch')], {
    expectExit: 2,
  })
  assert.match(out, /only applies to "feel"/)
})

// Phase 35 Stream OC: the SAME selection glue over MCP — beat_vary with scope:"selection" + port
// reads the live selection off the daemon and resolves it exactly like the CLI's --scope
// selection above (shared selectionToVaryScope; the argument-contract errors are covered in
// test/mcp.test.ts). Minimal inline MCP client, same newline-delimited JSON-RPC as mcp.test.ts.
import { spawn, type ChildProcess } from 'node:child_process'

function startMcpClient(): { request: (method: string, params?: unknown) => Promise<any>; close: () => void } {
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
    close: () => proc.kill(),
  }
}

test('beat_vary scope:"selection" over MCP resolves the daemon selection like the CLI does', async () => {
  await withDaemon(async (daemon, filePath) => {
    await setSelection(daemon.port, { lanes: [{ track: 'drums', lane: 'hat' }] })
    const outDir = join(mkdtempSync(join(tmpdir(), 'beat-mcp-scope-out-')), 'batch')
    const mcp = startMcpClient()
    try {
      await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
      const res = await mcp.request('tools/call', {
        name: 'beat_vary',
        arguments: { file: filePath, track: 'drums', group: 'feel', scope: 'selection', port: daemon.port, seed: 1, count: 2, out_dir: outDir },
      })
      assert.equal(res.isError ?? false, false, res.content[0].text)
      assert.match(res.content[0].text, /scope: selection -> lanes hat/)

      // ground truth: only hat hits moved, same as the CLI test above with the same seed
      const parent = parse(TEST_BEAT)
      const parentDrums = parent.tracks.find((t) => t.id === 'drums')!
      const variant = parse(readFileSync(join(outDir, 'v1.beat'), 'utf8'))
      const variantDrums = variant.tracks.find((t) => t.id === 'drums')!
      let hatChanged = 0
      for (const h of parentDrums.hits) {
        const after = variantDrums.hits.find((v) => v.id === h.id)!
        const same = after.start === h.start && after.velocity === h.velocity
        if (h.lane === 'hat') {
          if (!same) hatChanged++
        } else {
          assert.ok(same, `non-hat hit ${h.id} should be untouched by a selection-lanes scope`)
        }
      }
      assert.ok(hatChanged > 0, 'at least one hat hit should have moved')

      // a selection not covering the track fails loudly with the shared resolver's message
      await setSelection(daemon.port, { tracks: ['lead'] })
      const wrongTrack = await mcp.request('tools/call', {
        name: 'beat_vary',
        arguments: { file: filePath, track: 'drums', group: 'feel', scope: 'selection', port: daemon.port, seed: 1, count: 2, out_dir: join(outDir, 'x') },
      })
      assert.equal(wrongTrack.isError, true)
      assert.match(wrongTrack.content[0].text, /does not cover track "drums"/)
    } finally {
      mcp.close()
    }
  })
})
