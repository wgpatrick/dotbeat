// MCP dispatch lifecycle: concurrency, the per-file lock, and the per-tool timeout.
//
// Adversarial hunt #2 (2026-07-26) measured the server as STRICTLY SEQUENTIAL with no per-tool
// timeout: one slow `beat_source_gen` (a local text-to-audio model, minutes long) held up roughly
// twenty subsequent tool calls until it finished. One agent's generation froze every other caller,
// including read-only ones.
//
// These tests drive the REAL `runMcpServer` — its real accept loop, lock, timeout and isError
// shape — over real streams, with a tool table whose timing the test controls. Standing in for
// "a local model that takes minutes" with a gate the test opens is the whole point: the alternative
// is a test that needs torch installed and takes minutes to prove a timing property.

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { runMcpServer, mcpToolTimeoutMs, type ToolDef } from '../src/mcp/server.js'

const dir = mkdtempSync(join(tmpdir(), 'beat-mcp-conc-'))
const fileA = join(dir, 'a.beat')
const fileB = join(dir, 'b.beat')

// Teardown for the whole file. A test that FAILS mid-way leaves a gate shut and a server input
// open, and both hold the event loop: the file would hang at exit instead of reporting its
// failure. Since these tests exist to catch hangs, they must not be able to become one.
const openGates: (() => void)[] = []
const openInputs: PassThrough[] = []
after(() => {
  for (const open of openGates) open()
  for (const s of openInputs) s.destroy()
})

/** A promise the test opens by hand — our stand-in for "the model is still running". */
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void
  const wait = new Promise<void>((r) => { open = () => r() })
  openGates.push(open)
  return { wait, open }
}

const schema = { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] }

interface Harness {
  call: (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>
  /** response texts in the order they actually came back off the wire */
  order: string[]
  end: () => Promise<void>
}

function serve(tools: ToolDef[]): Harness {
  const input = new PassThrough()
  const output = new PassThrough()
  openInputs.push(input)
  const finished = runMcpServer(input, output, tools)
  void finished.catch(() => {})
  let nextId = 1
  const pending = new Map<number, (v: { text: string; isError: boolean }) => void>()
  const order: string[] = []
  let buf = ''
  output.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8')
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      const msg = JSON.parse(line) as { id?: number; result?: { content: { text: string }[]; isError?: boolean } }
      const resolve = msg.id === undefined ? undefined : pending.get(msg.id)
      if (resolve === undefined || msg.result === undefined) continue
      pending.delete(msg.id!)
      const text = msg.result.content[0]!.text
      order.push(text)
      resolve({ text, isError: msg.result.isError === true })
    }
  })
  return {
    call: (name, args) =>
      new Promise((resolve) => {
        const id = nextId++
        pending.set(id, resolve)
        input.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n')
      }),
    order,
    end: async () => {
      input.end()
      await finished
    },
  }
}

/** Has `p` settled yet? (`Promise.race` against a macrotask — a microtask tick is not enough when
 * the thing under test is "did the accept loop move on".) */
async function settled<T>(p: Promise<T>): Promise<boolean> {
  const marker = Symbol('pending')
  const tick = new Promise<typeof marker>((r) => setTimeout(() => r(marker), 50))
  return (await Promise.race([p, tick])) !== marker
}

/** Await `p`, but FAIL rather than hang if it never comes. The regression these tests guard is a
 * hang, and a test that hangs on regression is not a gate — it is a wedged CI run. (Measured: with
 * dispatch made sequential again, the head-of-line test below never returned at all.) */
async function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  const marker = Symbol('late')
  const late = new Promise<typeof marker>((r) => setTimeout(() => r(marker), ms))
  const got = await Promise.race([p, late])
  if (got === marker) throw new Error(`${what} did not come back within ${ms}ms — head-of-line blocking is back`)
  return got as T
}

function withTimeoutEnv<T>(ms: number | undefined, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.BEAT_MCP_TOOL_TIMEOUT_MS
  if (ms === undefined) delete process.env.BEAT_MCP_TOOL_TIMEOUT_MS
  else process.env.BEAT_MCP_TOOL_TIMEOUT_MS = String(ms)
  return fn().finally(() => {
    if (saved === undefined) delete process.env.BEAT_MCP_TOOL_TIMEOUT_MS
    else process.env.BEAT_MCP_TOOL_TIMEOUT_MS = saved
  })
}

test('the default tool timeout is the 600s ceiling the spawning tools already use, and the env overrides it', () => {
  withTimeoutEnv(undefined, async () => {})
  assert.equal(mcpToolTimeoutMs(), 600_000)
  process.env.BEAT_MCP_TOOL_TIMEOUT_MS = '2500'
  assert.equal(mcpToolTimeoutMs(), 2500)
  process.env.BEAT_MCP_TOOL_TIMEOUT_MS = 'nonsense'
  assert.equal(mcpToolTimeoutMs(), 600_000, 'a garbage override falls back to the default rather than to 0')
  delete process.env.BEAT_MCP_TOOL_TIMEOUT_MS
})

test('a slow tool no longer blocks calls on OTHER files (the ~20-call head-of-line stall)', async () => {
  const g = gate()
  const tools: ToolDef[] = [
    { name: 'beat_slow', description: 'stands in for a local model render', inputSchema: schema, handler: async () => { await g.wait; return 'slow done' } },
    { name: 'beat_fast', description: 'any ordinary tool', inputSchema: schema, handler: async () => 'fast done' },
  ]
  const mcp = serve(tools)
  const slow = mcp.call('beat_slow', { file: fileA })
  // Twenty ordinary calls behind it, the hunt's measured shape. Before the fix not one of these
  // could be answered until the model finished.
  const others = Array.from({ length: 20 }, () => mcp.call('beat_fast', { file: fileB }))

  const answers = await within(Promise.all(others), 5_000, 'the 20 queued calls')
  assert.ok(answers.every((a) => a.text === 'fast done' && !a.isError), 'the queued calls did not all succeed')
  assert.equal(await settled(slow), false, 'fixture is wrong: the slow call should still be running')
  assert.equal(mcp.order.length, 20, 'the slow call answered early — it is not the one being blocked on')

  g.open()
  assert.equal((await within(slow, 5_000, 'the slow call')).text, 'slow done')
  assert.equal(mcp.order[20], 'slow done', 'responses come back in completion order, not request order')
  await mcp.end()
})

test('two calls on the SAME file stay serialized, in arrival order', async () => {
  // The reason concurrency is per-file and not global: nearly every mutating tool is a
  // read-modify-write of one .beat file, and two of those must never interleave.
  const g = gate()
  const seen: string[] = []
  const tools: ToolDef[] = [
    { name: 'beat_slow', description: 'x', inputSchema: schema, handler: async () => { seen.push('slow-start'); await g.wait; seen.push('slow-end'); return 'slow done' } },
    { name: 'beat_fast', description: 'x', inputSchema: schema, handler: async () => { seen.push('fast-start'); return 'fast done' } },
  ]
  const mcp = serve(tools)
  const slow = mcp.call('beat_slow', { file: fileA })
  const second = mcp.call('beat_fast', { file: fileA })
  assert.equal(await settled(second), false, 'a second call on the same file must not run while the first holds it')
  assert.deepEqual(seen, ['slow-start'])

  g.open()
  await within(slow, 5_000, 'the slow call')
  await within(second, 5_000, 'the queued same-file call')
  assert.deepEqual(seen, ['slow-start', 'slow-end', 'fast-start'], 'the same-file calls interleaved')
  assert.deepEqual(mcp.order, ['slow done', 'fast done'])
  await mcp.end()
})

test('the lock keys on the RESOLVED path, so ./a.beat and a.beat are the same file', async () => {
  const g = gate()
  const tools: ToolDef[] = [
    { name: 'beat_slow', description: 'x', inputSchema: schema, handler: async () => { await g.wait; return 'slow done' } },
    { name: 'beat_fast', description: 'x', inputSchema: schema, handler: async () => 'fast done' },
  ]
  const mcp = serve(tools)
  const slow = mcp.call('beat_slow', { file: fileA })
  const aliased = mcp.call('beat_fast', { file: join(dir, '.', 'x', '..', 'a.beat') })
  assert.equal(await settled(aliased), false, 'a path alias slipped past the lock')
  g.open()
  await within(slow, 5_000, 'the slow call')
  assert.equal((await within(aliased, 5_000, 'the aliased call')).text, 'fast done')
  await mcp.end()
})

test('a call that never finishes returns a clean isError instead of hanging the caller forever', async () => {
  await withTimeoutEnv(200, async () => {
    const g = gate()
    const tools: ToolDef[] = [
      { name: 'beat_slow', description: 'x', inputSchema: schema, handler: async () => { await g.wait; return 'slow done' } },
      { name: 'beat_fast', description: 'x', inputSchema: schema, handler: async () => 'fast done' },
    ]
    const mcp = serve(tools)
    const timedOut = await within(mcp.call('beat_slow', { file: fileA }), 5_000, 'the timed-out call')
    assert.equal(timedOut.isError, true)
    assert.match(timedOut.text, /^beat_slow exceeded the 200ms tool timeout and was abandoned/)
    assert.match(timedOut.text, /BEAT_MCP_TOOL_TIMEOUT_MS/, 'the message must say how to raise the limit')

    // The server is still serving — a timeout is one call failing, not the session dying.
    assert.equal((await within(mcp.call('beat_fast', { file: fileB }), 5_000, 'a call on another file')).text, 'fast done')

    // ...and the abandoned call still OWNS file A, because it is still running. `abandoned` is not
    // `cancelled`: an in-process handler cannot be interrupted, so the lock is what keeps a later
    // call from observing a half-written file.
    const blocked = await within(mcp.call('beat_fast', { file: fileA }), 5_000, 'the call queued behind the abandoned one')
    assert.equal(blocked.isError, true, 'file A was handed out while the abandoned call still held it')
    assert.match(blocked.text, /exceeded the 200ms tool timeout/)

    g.open()
    await new Promise((r) => setTimeout(r, 50))
    const freed = await within(mcp.call('beat_fast', { file: fileA }), 5_000, 'the call after the lock was freed')
    assert.equal(freed.text, 'fast done', 'the lock was never released after the abandoned call finished')
    await mcp.end()
  })
})

test('a throwing tool releases its file lock (a failure must not wedge the file forever)', async () => {
  const tools: ToolDef[] = [
    { name: 'beat_boom', description: 'x', inputSchema: schema, handler: async () => { throw new Error('no such track "kick"') } },
    { name: 'beat_fast', description: 'x', inputSchema: schema, handler: async () => 'fast done' },
  ]
  const mcp = serve(tools)
  const boom = await within(mcp.call('beat_boom', { file: fileA }), 5_000, 'the throwing call')
  assert.equal(boom.isError, true)
  assert.equal(boom.text, 'no such track "kick"')
  assert.equal((await within(mcp.call('beat_fast', { file: fileA }), 5_000, 'the call after the failure')).text, 'fast done')
  await mcp.end()
})

test('the server does not finish until every accepted call has answered', async () => {
  // stdin closing means the client is gone, but a call we already accepted still owes a response —
  // and every call is bounded by the tool timeout, so this can never wait forever.
  const g = gate()
  const tools: ToolDef[] = [
    { name: 'beat_slow', description: 'x', inputSchema: schema, handler: async () => { await g.wait; return 'slow done' } },
  ]
  const mcp = serve(tools)
  const slow = mcp.call('beat_slow', { file: fileA })
  const ended = mcp.end()
  assert.equal(await settled(ended), false, 'the server finished with a call still in flight')
  g.open()
  await within(ended, 5_000, 'the server shutdown')
  assert.equal((await slow).text, 'slow done')
})
