// MCP's four `beat_effect_*` tools — first tests. Wave-0 gate W0.8(c).
//
// Review R5-F7: all four effect tools were untested on MCP, and untested on the daemon at the same
// time — which is precisely where R5-F3's live semantic drift lives:
//
//   | surface | verb                  | boolean arg          | what TRUE means |
//   |---------|-----------------------|----------------------|-----------------|
//   | CLI     | `beat effect-bypass`  | positional true/false| BYPASSED        |
//   | MCP     | `beat_effect_bypass`  | `enabled: boolean`   | ENABLED         |
//   | daemon  | `POST /effect-enabled`| `enabled: boolean`   | ENABLED         |
//
// Two surfaces expose a verb literally named *bypass* whose boolean means the opposite thing, so an
// agent porting a working CLI recipe to MCP silently flips every bypass.
//
// ****************************************************************************************
// THIS FILE ASSERTS CURRENT BEHAVIOUR, NOT DESIRED BEHAVIOUR. The polarity inversion below is
// a known bug, scheduled as part of W3.1 (docs/research/130 §3 wave 3: "the effects family first
// … includes the R5-F3 bypass-polarity fix as an additive alias then deprecation"). It is pinned
// here deliberately so that fixing it is a VISIBLE test change rather than a silent flip — when
// W3.1 lands, the `polarity` cases below must be edited, and that edit is the record of the fix.
// ****************************************************************************************
//
// Protocol-level, spawning a real `beat mcp` subprocess over stdio, following test/mcp.test.ts's
// pattern; the CLI half runs the real `cli/beat.mjs` as a subprocess too, so the comparison is
// between the shipped surfaces, not between two re-implementations in this file.

import assert from 'node:assert/strict'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { initDocument, addTrack, serialize, parse, type BeatEffect } from '../src/core/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

interface McpClient {
  call: (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>
  request: (method: string, params?: unknown) => Promise<any>
  close: () => void
}

function startMcp(): McpClient {
  const proc: ChildProcess = spawn(process.execPath, [beatCli, 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'] })
  let nextId = 1
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  let buf = ''
  proc.stdout!.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8')
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } }
      if (msg.id === undefined || !pending.has(msg.id)) continue
      const p = pending.get(msg.id)!
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message))
      else p.resolve(msg.result)
    }
  })
  const request = (method: string, params?: unknown) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id)
          reject(new Error(`no response to ${method} within 10s`))
        }
      }, 10000)
    })
  return {
    call: async (name, args) => {
      const res = await request('tools/call', { name, arguments: args })
      return { text: (res.content ?? []).map((c: { text?: string }) => c.text ?? '').join('\n'), isError: res.isError === true }
    },
    request,
    close: () => proc.kill(),
  }
}

/** A project file with a synth `lead` (default eq3 -> comp -> distortion -> bitcrush chain), a
 * drums `beat`, and an `audio` track. Returns the path. */
function seedFile(prefix: string): string {
  let doc = initDocument({ bpm: 120, loopBars: 1, trackId: 'lead' })
  doc = addTrack(doc, { id: 'beat', kind: 'drums' }).doc
  doc = addTrack(doc, { id: 'stem', kind: 'audio' }).doc
  const file = join(mkdtempSync(join(tmpdir(), prefix)), 'song.beat')
  writeFileSync(file, serialize(doc))
  return file
}

const chainOf = (file: string, trackId = 'lead'): BeatEffect[] => parse(readFileSync(file, 'utf8')).tracks.find((t) => t.id === trackId)!.effects
const ids = (effects: BeatEffect[]) => effects.map((e) => e.id)
const enabledOf = (file: string, id: string, trackId = 'lead') => chainOf(file, trackId).find((e) => e.id === id)!.enabled

/** Runs the real CLI; returns stdout, or throws with stderr attached. */
function beat(args: string[]): string {
  return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
}

async function withMcp(fn: (mcp: McpClient, file: string) => Promise<void>) {
  const mcp = startMcp()
  try {
    await fn(mcp, seedFile('beat-mcp-effects-'))
  } finally {
    mcp.close()
  }
}

// ---------------------------------------------------------------------------------------------
// beat_effect_add
// ---------------------------------------------------------------------------------------------

test('beat_effect_add: appends, mints ids, honours index, and returns a musical diff (not a document)', async () => {
  await withMcp(async (mcp, file) => {
    const added = await mcp.call('beat_effect_add', { file, track: 'lead', type: 'eq7' })
    assert.equal(added.isError, false)
    // MCP's return shape is human diff text; the daemon's twin returns {written, doc} (R5-F3's
    // "divergent, but defensible per transport" note). Pinned so a future unification is visible.
    assert.match(added.text, /eq7/)
    assert.deepEqual(ids(chainOf(file)), ['eq3', 'comp', 'distortion', 'bitcrush', 'eq7'])

    await mcp.call('beat_effect_add', { file, track: 'lead', type: 'eq7' })
    assert.deepEqual(ids(chainOf(file)).slice(-1), ['eq7_2'], 'a colliding id auto-mints <type>_2')

    await mcp.call('beat_effect_add', { file, track: 'lead', type: 'autoPan', id: 'widener', index: 0 })
    assert.deepEqual(ids(chainOf(file))[0], 'widener')
  })
})

test('beat_effect_add: `bypassed` is the arg name (inverted into core\'s enabled)', async () => {
  await withMcp(async (mcp, file) => {
    await mcp.call('beat_effect_add', { file, track: 'lead', type: 'eq7', id: 'silent', bypassed: true })
    assert.equal(enabledOf(file, 'silent'), false, 'bypassed:true => the insert is wired out')
    await mcp.call('beat_effect_add', { file, track: 'lead', type: 'tremolo', id: 'loud', bypassed: false })
    assert.equal(enabledOf(file, 'loud'), true)
    await mcp.call('beat_effect_add', { file, track: 'lead', type: 'utility', id: 'default' })
    assert.equal(enabledOf(file, 'default'), true, 'omitted => active')
  })
})

test('beat_effect_add: errors are tool errors, and the file is untouched', async () => {
  await withMcp(async (mcp, file) => {
    const badType = await mcp.call('beat_effect_add', { file, track: 'lead', type: 'reverb' })
    assert.equal(badType.isError, true)
    // MCP casts the type straight through and lets core throw, so its message comes from
    // src/core/edit.ts — the daemon instead enumerates the 12 types in its own 400 (R5-F3).
    assert.match(badType.text, /effect type must be one of/)

    assert.equal((await mcp.call('beat_effect_add', { file, track: 'ghost', type: 'eq7' })).isError, true)
    // `stem` (an audio track) used to be an error here too. Research 142 §3.2 lifted that refusal
    // on every surface at once — it is now a legal add, asserted in the positive below.
    assert.deepEqual(ids(chainOf(file)), ['eq3', 'comp', 'distortion', 'bitcrush'], "lead's chain is untouched by the failed calls")
    assert.notEqual((await mcp.call('beat_effect_add', { file, track: 'stem', type: 'eq7' })).isError, true)
    assert.deepEqual(ids(chainOf(file, 'stem')), ['eq7'])
  })
})

// ---------------------------------------------------------------------------------------------
// beat_effect_rm / beat_effect_move — note the arg is `effect_id` here but `id` on beat_effect_add
// ---------------------------------------------------------------------------------------------

test('beat_effect_rm: removes by `effect_id` (NOT `id` — MCP is inconsistent with itself)', async () => {
  await withMcp(async (mcp, file) => {
    const removed = await mcp.call('beat_effect_rm', { file, track: 'lead', effect_id: 'comp' })
    assert.equal(removed.isError, false)
    assert.deepEqual(ids(chainOf(file)), ['eq3', 'distortion', 'bitcrush'])

    // R5-F3's naming drift, pinned: the ADD tool takes `id`, the other three take `effect_id`.
    // Passing the sibling's spelling is a missing-required-argument error, not a silent no-op.
    const wrongArg = await mcp.call('beat_effect_rm', { file, track: 'lead', id: 'eq3' })
    assert.equal(wrongArg.isError, true)
    assert.deepEqual(ids(chainOf(file)), ['eq3', 'distortion', 'bitcrush'], 'nothing removed')

    const unknown = await mcp.call('beat_effect_rm', { file, track: 'lead', effect_id: 'nope' })
    assert.equal(unknown.isError, true)
    assert.match(unknown.text, /no effect "nope" on track "lead"/)
  })
})

test('beat_effect_move: reorders to a 0-based index, clamped', async () => {
  await withMcp(async (mcp, file) => {
    await mcp.call('beat_effect_move', { file, track: 'lead', effect_id: 'bitcrush', index: 0 })
    assert.deepEqual(ids(chainOf(file)), ['bitcrush', 'eq3', 'comp', 'distortion'])
    await mcp.call('beat_effect_move', { file, track: 'lead', effect_id: 'bitcrush', index: 99 })
    assert.deepEqual(ids(chainOf(file)), ['eq3', 'comp', 'distortion', 'bitcrush'])
    assert.equal((await mcp.call('beat_effect_move', { file, track: 'lead', effect_id: 'nope', index: 0 })).isError, true)
  })
})

// ---------------------------------------------------------------------------------------------
// beat_effect_bypass — THE POLARITY CASES. Editing these is what "the fix landed" looks like.
// ---------------------------------------------------------------------------------------------

test('polarity (CURRENT, pre-W3.1): beat_effect_bypass takes ENABLED despite its bypass name', async () => {
  await withMcp(async (mcp, file) => {
    // Read this the way an agent would: the tool is called "bypass", so `enabled: true` LOOKS like
    // "bypass it". It does the opposite — it re-enables.
    const on = await mcp.call('beat_effect_bypass', { file, track: 'lead', effect_id: 'distortion', enabled: true })
    assert.equal(on.isError, false)
    assert.equal(enabledOf(file, 'distortion'), true, 'enabled:true leaves the insert ACTIVE (i.e. NOT bypassed)')

    const off = await mcp.call('beat_effect_bypass', { file, track: 'lead', effect_id: 'distortion', enabled: false })
    assert.equal(off.isError, false)
    assert.equal(enabledOf(file, 'distortion'), false, 'enabled:false is what actually bypasses')

    // Bypass is routing, not removal — the chain order is untouched either way.
    assert.deepEqual(ids(chainOf(file)), ['eq3', 'comp', 'distortion', 'bitcrush'])

    const missing = await mcp.call('beat_effect_bypass', { file, track: 'lead', effect_id: 'distortion' })
    assert.equal(missing.isError, true)
    assert.match(missing.text, /missing required boolean argument "enabled"/)
  })
})

test('polarity (CURRENT, pre-W3.1): the CLI\'s effect-bypass takes BYPASSED — the same word, inverted', async () => {
  const file = seedFile('beat-cli-effects-')
  // `beat effect-bypass <file> <track> <effect-id> <true|false>` — here TRUE means "bypass it".
  beat(['effect-bypass', file, 'lead', 'distortion', 'true'])
  assert.equal(enabledOf(file, 'distortion'), false, 'CLI true => bypassed => enabled:false in the file')
  beat(['effect-bypass', file, 'lead', 'distortion', 'false'])
  assert.equal(enabledOf(file, 'distortion'), true, 'CLI false => not bypassed => enabled:true')

  assert.throws(() => beat(['effect-bypass', file, 'lead', 'distortion', 'yes']), /state must be true or false|Command failed/)
})

test('polarity (CURRENT, pre-W3.1): the SAME boolean through CLI and MCP produces OPPOSITE files', async () => {
  // The bug in one assertion. This is the drift R5-F3 found and W3.1 will fix; when it is fixed,
  // this test must be rewritten to assert AGREEMENT, and that rewrite is the visible record.
  await withMcp(async (mcp) => {
    const cliFile = seedFile('beat-polarity-cli-')
    const mcpFile = seedFile('beat-polarity-mcp-')

    beat(['effect-bypass', cliFile, 'lead', 'distortion', 'true'])
    await mcp.call('beat_effect_bypass', { file: mcpFile, track: 'lead', effect_id: 'distortion', enabled: true })

    assert.equal(enabledOf(cliFile, 'distortion'), false, 'CLI: "true" bypassed it')
    assert.equal(enabledOf(mcpFile, 'distortion'), true, 'MCP: "true" left it enabled')
    assert.notEqual(
      enabledOf(cliFile, 'distortion'),
      enabledOf(mcpFile, 'distortion'),
      'PINNED BUG (R5-F3): passing `true` to the same-named bypass verb on two surfaces yields opposite audio. Fix in W3.1, then rewrite this assertion to assert.equal.',
    )
  })
})

// ---------------------------------------------------------------------------------------------
// Cross-surface: what the two surfaces DO agree on
// ---------------------------------------------------------------------------------------------

test('CLI and MCP agree on add / rm / move — only the bypass polarity diverges', async () => {
  await withMcp(async (mcp) => {
    const cliFile = seedFile('beat-parity-cli-')
    const mcpFile = seedFile('beat-parity-mcp-')

    beat(['effect-add', cliFile, 'lead', 'eq7'])
    await mcp.call('beat_effect_add', { file: mcpFile, track: 'lead', type: 'eq7' })
    assert.deepEqual(ids(chainOf(cliFile)), ids(chainOf(mcpFile)))

    beat(['effect-move', cliFile, 'lead', 'eq7', '0'])
    await mcp.call('beat_effect_move', { file: mcpFile, track: 'lead', effect_id: 'eq7', index: 0 })
    assert.deepEqual(ids(chainOf(cliFile)), ids(chainOf(mcpFile)))

    beat(['effect-rm', cliFile, 'lead', 'comp'])
    await mcp.call('beat_effect_rm', { file: mcpFile, track: 'lead', effect_id: 'comp' })
    assert.deepEqual(ids(chainOf(cliFile)), ids(chainOf(mcpFile)))

    // Byte parity, not just id parity.
    assert.equal(readFileSync(cliFile, 'utf8'), readFileSync(mcpFile, 'utf8'))
  })
})

test('beat_effect_bypass is equivalent to beat_set\'s <track>.effect.<id>.enabled path (its own doc claim)', async () => {
  await withMcp(async (mcp, file) => {
    const viaSet = seedFile('beat-effect-set-')
    const bypassed = await mcp.call('beat_effect_bypass', { file, track: 'lead', effect_id: 'comp', enabled: false })
    const set = await mcp.call('beat_set', { file: viaSet, edits: [{ path: 'lead.effect.comp.enabled', value: 'false' }] })
    assert.equal(bypassed.isError, false)
    assert.equal(set.isError, false)
    assert.equal(readFileSync(file, 'utf8'), readFileSync(viaSet, 'utf8'), 'the tool description promises these are the same edit')
    assert.equal(bypassed.text, set.text, 'and they report the same musical edit')
  })
})

// ---------------------------------------------------------------------------------------------
// Schema surface — the four tools exist and declare the args this file exercises
// ---------------------------------------------------------------------------------------------

test('the four beat_effect_* tools declare exactly the arg names asserted above', async () => {
  const mcp = startMcp()
  try {
    const list = await mcp.request('tools/list')
    const byName = new Map<string, { inputSchema: { properties: Record<string, unknown>; required: string[] } }>(
      (list.tools as { name: string; inputSchema: any }[]).map((t) => [t.name, t]),
    )
    // A snapshot of the drift itself: `id` on add, `effect_id` on the other three; `bypassed` on
    // add, `enabled` on bypass. W3.1 unifies these — when it does, this snapshot changes with it.
    assert.deepEqual(Object.keys(byName.get('beat_effect_add')!.inputSchema.properties), ['file', 'track', 'type', 'id', 'index', 'bypassed'])
    assert.deepEqual(byName.get('beat_effect_add')!.inputSchema.required, ['file', 'track', 'type'])

    assert.deepEqual(Object.keys(byName.get('beat_effect_rm')!.inputSchema.properties), ['file', 'track', 'effect_id'])
    assert.deepEqual(byName.get('beat_effect_rm')!.inputSchema.required, ['file', 'track', 'effect_id'])

    assert.deepEqual(Object.keys(byName.get('beat_effect_move')!.inputSchema.properties), ['file', 'track', 'effect_id', 'index'])
    assert.deepEqual(byName.get('beat_effect_move')!.inputSchema.required, ['file', 'track', 'effect_id', 'index'])

    assert.deepEqual(Object.keys(byName.get('beat_effect_bypass')!.inputSchema.properties), ['file', 'track', 'effect_id', 'enabled'])
    assert.deepEqual(byName.get('beat_effect_bypass')!.inputSchema.required, ['file', 'track', 'effect_id', 'enabled'])
  } finally {
    mcp.close()
  }
})
