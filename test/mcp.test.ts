// Protocol-level test of `beat mcp` — a real subprocess speaking newline-delimited JSON-RPC 2.0
// over stdio, exactly as an MCP client would.

import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
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
    for (const expected of ['beat_inspect', 'beat_set', 'beat_add_note', 'beat_rm_note', 'beat_diff', 'beat_metrics', 'beat_lint', 'beat_render']) {
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
