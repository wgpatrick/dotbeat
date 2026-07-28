// W0.9 — parity made testable (review T1 / R1-F12: exactly ONE byte-level parity test existed,
// covering 3 of 71 MCP tools, while parity across the four surfaces is otherwise maintained by
// review discipline alone — a discipline the review found already broken in six measured places).
//
// Two gates live here:
//
//  (a) A tools/list GOLDEN SNAPSHOT — every tool's name, required args, and per-arg types/enums,
//      compared against a committed fixture. It says nothing about whether a schema is RIGHT; it
//      makes any change to one LOUD, so a tool renamed, an arg quietly dropped, or a required arg
//      added shows up as a reviewable diff instead of as a silently broken agent. This is the gate
//      W2.4 (splitting the 2065-line TOOLS literal into per-family files) needs to prove that a
//      pure move moved nothing.
//
//  (b) A TABLE-DRIVEN CLI<->MCP parity script over the vary/score/audition family: the same inputs
//      run through both surfaces against two identical fresh projects, asserting the artifacts they
//      produce are byte-identical (manifests, variant .beat files, scores-log entries, the adopted
//      parent) and — where the two surfaces genuinely say the same thing — that their text output
//      matches too. Adding a row is one object literal; that is the point. Both of the bugs the
//      review hot-fixed were of exactly this class.
//
// Deliberately NOT covered here: anything requiring a real render (--render/--audition stitch a
// batch through headless Chromium in real time). The shared tail those flags drive is unit-tested
// in test/vary-run.test.ts instead, and its whole reason for existing is that neither surface owns
// it any more.

import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // dist/test -> repo root
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const GOLDEN_PATH = join(repoRoot, 'test', 'fixtures', 'mcp-tools.golden.json')
/** Set to rewrite the golden after an INTENTIONAL schema change, then review the diff. */
const UPDATE_GOLDEN = process.env.MCP_TOOLS_GOLDEN_UPDATE === '1'

// ---- MCP client (same stdio JSON-RPC harness as place-surface.test.ts) ------------------------

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
            reject(new Error(`no response to ${method} within 20s`))
          }
        }, 20000)
      }),
    notify: (method) => void proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'),
    close: () => proc.kill(),
  }
}

async function withMcp<T>(fn: (mcp: McpClient) => Promise<T>): Promise<T> {
  const mcp = startMcp()
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    mcp.notify('notifications/initialized')
    return await fn(mcp)
  } finally {
    mcp.close()
  }
}

// ---- (a) tools/list golden snapshot ------------------------------------------------------------

interface ToolShape {
  name: string
  required: string[]
  /** arg name -> its declared type ("string", "array<string>", "string(a|b)" for an enum). */
  args: Record<string, string>
}

interface RawTool {
  name: string
  inputSchema?: { properties?: Record<string, { type?: string; items?: { type?: string }; enum?: unknown[] }>; required?: string[] }
}

/** Types only — the prose descriptions are agent-facing copy that changes constantly and would
 * make the golden churn without saying anything about the contract. */
function argType(spec: { type?: string; items?: { type?: string }; enum?: unknown[] }): string {
  const base = spec.type === 'array' ? `array<${spec.items?.type ?? 'any'}>` : (spec.type ?? 'any')
  return Array.isArray(spec.enum) ? `${base}(${spec.enum.map(String).join('|')})` : base
}

function toolShapes(tools: RawTool[]): ToolShape[] {
  return tools
    .map((t) => ({
      name: t.name,
      required: [...(t.inputSchema?.required ?? [])].sort(),
      args: Object.fromEntries(Object.entries(t.inputSchema?.properties ?? {}).map(([k, v]) => [k, argType(v)])),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

test('MCP tools/list matches the committed golden — names, required args, and arg types', async () => {
  const live = await withMcp(async (mcp) => toolShapes(((await mcp.request('tools/list')) as { tools: RawTool[] }).tools))

  if (UPDATE_GOLDEN) {
    writeFileSync(GOLDEN_PATH, JSON.stringify(live, null, 2) + '\n')
    return
  }
  // A missing golden must FAIL, not skip (research/130 T2: the engine's golden-WAV gate silently
  // skipped on every clean checkout, so the regression test asserted nothing for months).
  assert.ok(
    existsSync(GOLDEN_PATH),
    `${GOLDEN_PATH} is missing — regenerate with MCP_TOOLS_GOLDEN_UPDATE=1 node --test dist/test/mcp-parity.test.js`,
  )
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as ToolShape[]

  const liveNames = live.map((t) => t.name)
  const goldenNames = golden.map((t) => t.name)
  assert.deepEqual(
    liveNames,
    goldenNames,
    `the MCP tool ROSTER changed (added: ${liveNames.filter((n) => !goldenNames.includes(n)).join(', ') || 'none'}; removed: ${goldenNames.filter((n) => !liveNames.includes(n)).join(', ') || 'none'}). If intended, regenerate: MCP_TOOLS_GOLDEN_UPDATE=1 node --test dist/test/mcp-parity.test.js`,
  )
  for (const want of golden) {
    const got = live.find((t) => t.name === want.name)!
    assert.deepEqual(
      got,
      want,
      `${want.name}'s arg schema drifted from the golden. Agents are written against this shape — if the change is intended, regenerate with MCP_TOOLS_GOLDEN_UPDATE=1 and review the diff.`,
    )
  }
})

// ---- (b) the CLI<->MCP parity table ------------------------------------------------------------

const FIXTURE = `format_version 0.11
bpm 120
loop_bars 2
selected_track lead

track lead lead #e06c75 synth
  synth
    osc sawtooth
    volume -10
    cutoff 2000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.6
    release 0.3
    pan 0
  clip melody
    note u100001 64 4 2 0.7
    note u100002 67 8 2 0.75
    note u100003 72 12 2 0.6
  note u100001 64 4 2 0.7
  note u100002 67 8 2 0.75
  note u100003 72 12 2 0.6
`

interface Ctx {
  dir: string
  file: string
  log: string
}

interface ParityRow {
  name: string
  /** argv after `beat` — the CLI's spelling of the operation. */
  cli: (c: Ctx) => string[]
  /** the MCP twin, same inputs. */
  mcp: (c: Ctx) => { name: string; arguments: Record<string, unknown> }
  /** project-relative files whose bytes must be identical across the two surfaces afterwards. */
  artifacts: string[]
  /** false when the two surfaces legitimately word their prose differently (say why). */
  sameText?: boolean
}

// The parity script: each row runs on BOTH surfaces against two identical projects, in order, so
// later rows exercise the artifacts earlier rows produced (vary -> score -> suggest -> adopt).
// Adding a row is one object literal — that is the whole design goal (R1-F12: 3 of 71 tools had
// any parity coverage at all).
const ROWS: ParityRow[] = [
  {
    name: 'vary, param group (the branch whose missing linkMediaFrom was the live pilot-111 twin bug)',
    cli: (c) => ['vary', c.file, 'lead', 'filter', '--count', '3', '--seed', '7', '--out-dir', join(c.dir, 'b-param')],
    mcp: (c) => ({ name: 'beat_vary', arguments: { file: c.file, track: 'lead', group: 'filter', count: 3, seed: 7, out_dir: join(c.dir, 'b-param') } }),
    artifacts: ['b-param/manifest.json', 'b-param/v1.beat', 'b-param/v2.beat', 'b-param/v3.beat'],
  },
  {
    name: 'vary, param group with --exclude / exclude (pilot 113 pins mix volume)',
    cli: (c) => ['vary', c.file, 'lead', 'mix', '--count', '2', '--seed', '9', '--exclude', 'volume', '--out-dir', join(c.dir, 'b-mix')],
    mcp: (c) => ({ name: 'beat_vary', arguments: { file: c.file, track: 'lead', group: 'mix', count: 2, seed: 9, exclude: ['volume'], out_dir: join(c.dir, 'b-mix') } }),
    artifacts: ['b-mix/manifest.json', 'b-mix/v1.beat', 'b-mix/v2.beat'],
  },
  {
    name: 'vary feel (content variation — humanize recipes, not edits)',
    cli: (c) => ['vary', c.file, 'lead', 'feel', '--count', '2', '--seed', '11', '--out-dir', join(c.dir, 'b-feel')],
    mcp: (c) => ({ name: 'beat_vary', arguments: { file: c.file, track: 'lead', group: 'feel', count: 2, seed: 11, out_dir: join(c.dir, 'b-feel') } }),
    artifacts: ['b-feel/manifest.json', 'b-feel/v1.beat', 'b-feel/v2.beat'],
  },
  {
    name: 'vary automation:<param> (whole-doc lane variants carrying a replayable recipe)',
    cli: (c) => ['vary', c.file, 'lead', 'automation:cutoff', '--count', '2', '--seed', '13', '--out-dir', join(c.dir, 'b-auto')],
    mcp: (c) => ({ name: 'beat_vary', arguments: { file: c.file, track: 'lead', group: 'automation:cutoff', count: 2, seed: 13, out_dir: join(c.dir, 'b-auto') } }),
    artifacts: ['b-auto/manifest.json', 'b-auto/v1.beat', 'b-auto/v2.beat'],
  },
  {
    name: 'score a param batch (ranked picks -> the shared jsonl exhaust)',
    cli: (c) => ['score', join(c.dir, 'b-param'), 'v2', '1', '--log', c.log],
    mcp: (c) => ({ name: 'beat_score', arguments: { dir: join(c.dir, 'b-param'), picks: ['v2', '1'], log: c.log } }),
    artifacts: ['scores.jsonl'],
  },
  {
    name: 'score a feel batch (recipe-carrying entry shape)',
    cli: (c) => ['score', join(c.dir, 'b-feel'), '2', '--log', c.log],
    mcp: (c) => ({ name: 'beat_score', arguments: { dir: join(c.dir, 'b-feel'), picks: ['2'], log: c.log } }),
    artifacts: ['scores.jsonl'],
  },
  {
    name: 'suggest (reads the exhaust both surfaces just wrote)',
    cli: (c) => ['suggest', c.file, 'lead', '--log', c.log],
    mcp: (c) => ({ name: 'beat_suggest', arguments: { file: c.file, track: 'lead', log: c.log } }),
    artifacts: [],
  },
  {
    name: 'adopt a winner (copies the picked variant over the parent, sha-guarded)',
    cli: (c) => ['adopt', join(c.dir, 'b-param'), 'v2'],
    mcp: (c) => ({ name: 'beat_adopt', arguments: { dir: join(c.dir, 'b-param'), pick: 'v2' } }),
    artifacts: ['song.beat'],
  },
  // D11 — the trick family. `beat_trick` was ADVERTISED in beat_produce's description for months
  // with no tool behind it (research/140 D11), and the CLI's `beat trick` had no parity row, which
  // is how the two facts coexisted. These four run last so they operate on the adopted song.beat,
  // which both surfaces have just proven byte-identical.
  {
    name: 'trick list (the catalog, filtered by axis)',
    cli: () => ['trick', 'list', '--axis', 'width'],
    mcp: () => ({ name: 'beat_trick_list', arguments: { axis: 'width' } }),
    artifacts: [],
  },
  {
    name: 'trick show (the full card an agent must read before applying)',
    cli: () => ['trick', 'show', 'detune-double'],
    mcp: () => ({ name: 'beat_trick_show', arguments: { trick: 'detune-double' } }),
    artifacts: [],
  },
  {
    name: 'trick suggest (ranking without a sibling render — the unverified path)',
    cli: (c) => ['trick', 'suggest', c.file, 'lead'],
    mcp: (c) => ({ name: 'beat_trick_suggest', arguments: { file: c.file, track: 'lead' } }),
    artifacts: [],
  },
  {
    name: 'trick apply (recipe as ordinary edits — the file must come out byte-identical)',
    cli: (c) => ['trick', 'apply', c.file, 'lead', 'detune-double'],
    mcp: (c) => ({ name: 'beat_trick', arguments: { file: c.file, track: 'lead', trick: 'detune-double' } }),
    artifacts: ['song.beat'],
  },
  // The compose family. Both surfaces call src/taste/compose.ts, so what these rows really pin is
  // that the two ARGUMENT SHAPES agree — a flag named on one surface and forgotten on the other is
  // exactly the drift class this table exists for, and compose has a lot of flags.
  {
    name: 'compose a figure into a track (theory layer, everything pinned so both surfaces must agree)',
    cli: (c) => ['compose', c.file, 'lead', '--source', 'theory', '--role', 'lead', '--archetype', 'motif-repeat', '--key', 'a', '--mode', 'minor', '--bars', '4', '--seed', '4211'],
    mcp: (c) => ({ name: 'beat_compose', arguments: { file: c.file, track: 'lead', source: 'theory', role: 'lead', archetype: 'motif-repeat', key: 'a', mode: 'minor', bars: 4, seed: 4211 } }),
    artifacts: ['song.beat'],
  },
  {
    name: 'compose with an explicit clip re-snapshot (the song-mode trap\'s narrow form)',
    cli: (c) => ['compose', c.file, 'lead', '--archetype', 'arp-motif', '--key', 'a', '--mode', 'minor', '--seed', '99', '--clip', 'melody'],
    mcp: (c) => ({ name: 'beat_compose', arguments: { file: c.file, track: 'lead', archetype: 'arp-motif', key: 'a', mode: 'minor', seed: 99, clips: ['melody'] } }),
    artifacts: ['song.beat'],
  },
  {
    name: 'compose --count: an option board, same manifest contract as a vary batch',
    cli: (c) => ['compose', c.file, 'lead', '--count', '3', '--seed', '55', '--key', 'a', '--mode', 'minor', '--out-dir', join(c.dir, 'b-compose')],
    mcp: (c) => ({ name: 'beat_compose', arguments: { file: c.file, track: 'lead', count: 3, seed: 55, key: 'a', mode: 'minor', out_dir: join(c.dir, 'b-compose') } }),
    artifacts: ['b-compose/manifest.json', 'b-compose/v1.beat', 'b-compose/v2.beat', 'b-compose/v3.beat'],
    // the CLI's tail line names `beat board <dir>`; the MCP one names beat_adopt, since an MCP
    // client has no shell to run the board in
    sameText: false,
  },
]

function project(): Ctx {
  const dir = mkdtempSync(join(tmpdir(), 'beat-parity-'))
  const file = join(dir, 'song.beat')
  writeFileSync(file, FIXTURE)
  return { dir, file, log: join(dir, 'scores.jsonl') }
}

/** Absolute paths and wall-clock stamps (the manifest's createdAt, a score entry's `t`) differ by
 * construction; nothing else may. */
function normalize(text: string, c: Ctx): string {
  return text
    .split(c.dir)
    .join('<PROJ>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<TIME>')
    // `suggest` ends on a copy-pasteable command whose seed is drawn from the clock on purpose
    // (a fresh round wants a fresh seed). Every row above passes its seeds explicitly, so this is
    // the only place a `--seed` appears in compared text.
    .replace(/--seed \d+/g, '--seed <SEED>')
}

test('CLI<->MCP parity: the vary/score/audition family produces identical artifacts through both surfaces', async () => {
  const cliCtx = project()
  const mcpCtx = project()

  await withMcp(async (mcp) => {
    for (const row of ROWS) {
      const cliArgs = row.cli(cliCtx)
      let cliOut: string
      try {
        cliOut = execFileSync(process.execPath, [beatCli, ...cliArgs], { encoding: 'utf8', cwd: cliCtx.dir })
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string }
        throw new Error(`[${row.name}] beat ${cliArgs.join(' ')} exited ${e.status}:\n${e.stderr ?? ''}${e.stdout ?? ''}`)
      }
      const call = row.mcp(mcpCtx)
      const res = await mcp.request('tools/call', { name: call.name, arguments: call.arguments })
      assert.notEqual(res.isError, true, `[${row.name}] ${call.name} failed: ${res.content?.[0]?.text}`)
      const mcpOut = res.content[0].text as string

      for (const rel of row.artifacts) {
        const cliPath = join(cliCtx.dir, rel)
        const mcpPath = join(mcpCtx.dir, rel)
        assert.ok(existsSync(cliPath), `[${row.name}] the CLI did not write ${rel}`)
        assert.ok(existsSync(mcpPath), `[${row.name}] ${call.name} did not write ${rel}`)
        assert.equal(
          normalize(readFileSync(mcpPath, 'utf8'), mcpCtx),
          normalize(readFileSync(cliPath, 'utf8'), cliCtx),
          `[${row.name}] ${rel} differs between the CLI and ${call.name} — the two surfaces have drifted`,
        )
      }
      if (row.sameText !== false) {
        assert.equal(
          normalize(mcpOut, mcpCtx),
          normalize(cliOut, cliCtx),
          `[${row.name}] ${call.name}'s text output differs from \`beat ${cliArgs[0]}\`'s. If the difference is deliberate surface-specific prose, set sameText: false on the row and say why.`,
        )
      }
    }
  })
})

test('the parity table covers every MCP tool in the vary/score/audition family (a new one must arrive with a row)', () => {
  const covered = new Set(ROWS.map((r) => r.mcp({ dir: '/x', file: '/x/s.beat', log: '/x/l.jsonl' }).name))
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as ToolShape[]
  // The family as the review scoped it (R5-F2/F9): generate -> record -> read the exhaust -> take
  // the winner. beat_render is the render verb itself and needs a browser, so it is out of scope.
  // Plus the whole beat_trick* family (D11): the tool that was advertised-but-absent arrives WITH
  // its rows, and any future beat_trick_* tool is caught by the prefix rather than by memory.
  const family = golden
    .map((t) => t.name)
    // beat_compose joins the family because it WRITES the batches the rest of it consumes: a
    // compose board is scored, adopted and suggested-from through the same manifest.
    .filter((n) => ['beat_vary', 'beat_score', 'beat_adopt', 'beat_suggest', 'beat_compose'].includes(n) || n.startsWith('beat_trick'))
  assert.deepEqual([...covered].sort(), family.sort(), 'a vary-family or trick tool has no parity row')
})
