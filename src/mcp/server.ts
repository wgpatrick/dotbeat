// `beat mcp` — a minimal Model Context Protocol server over stdio (docs/phase-3-plan.md §3.4).
//
// This is the M3 "agent-native" boundary: the same operations the CLI exposes, as MCP tools an
// AI agent can call — the structurally-cleaner alternative to puppeting a live DAW over a socket
// (ROADMAP §5 "MCP server"; the ableton-mcp contrast). Implemented by hand on newline-delimited
// JSON-RPC 2.0 rather than pulling in an SDK: the protocol surface we need (initialize,
// tools/list, tools/call) is tiny, and the project's zero-runtime-deps stance has paid for
// itself twice already (daemon, metrics).
//
// Render note: beat_render shells out to cli/render.mjs (it needs a beatlab checkout and
// Chromium, passed via env or arguments) — everything else runs in-process on core/metrics.

import { createInterface } from 'node:readline'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parse,
  serialize,
  setValue,
  addNote,
  removeNote,
  diffDocuments,
  formatDiff,
  describeDocument,
} from '../core/index.js'
import { decodeWav, analyze, lint, formatLint } from '../metrics/index.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number | string | null
  method: string
  params?: Record<string, unknown>
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<string> | string
}

const str = (args: Record<string, unknown>, key: string): string => {
  const v = args[key]
  if (typeof v !== 'string' || v === '') throw new Error(`missing required string argument "${key}"`)
  return v
}
const num = (args: Record<string, unknown>, key: string): number => {
  const v = args[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`missing required number argument "${key}"`)
  return v
}

const TOOLS: ToolDef[] = [
  {
    name: 'beat_inspect',
    description:
      'Overview of a .beat project file: bpm, loop length, tracks, synth settings, note ranges, drum grids. The place to start before editing.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string', description: 'path to the .beat file' } },
      required: ['file'],
    },
    handler: (args) => describeDocument(parse(readFileSync(str(args, 'file'), 'utf8'))),
  },
  {
    name: 'beat_set',
    description:
      'Apply one or more surgical edits to a .beat file and write it back canonically. Paths use the file\'s own field names: "bpm", "loop_bars", "selected_track", "<track>.<param>" (osc, volume, cutoff, resonance, attack, decay, sustain, release, pan), "<track>.name", "<track>.color", "<track>.pattern.<lane>[<step>]" (lanes: kick, snare, clap, hat, openhat). Returns the musical edit list of what changed.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, value: { type: 'string' } },
            required: ['path', 'value'],
          },
          minItems: 1,
        },
      },
      required: ['file', 'edits'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const edits = args.edits as { path: string; value: string }[]
      const before = parse(readFileSync(file, 'utf8'))
      let doc = before
      for (const e of edits) doc = setValue(doc, e.path, String(e.value))
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_add_note',
    description: 'Add a note to a synth track in a .beat file. start/duration are in 16th-note steps; velocity is 0..1.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        pitch: { type: 'number', description: 'MIDI pitch 0-127' },
        start: { type: 'number' },
        duration: { type: 'number' },
        velocity: { type: 'number' },
      },
      required: ['file', 'track', 'pitch', 'start', 'duration', 'velocity'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc } = addNote(before, str(args, 'track'), {
        pitch: num(args, 'pitch'),
        start: num(args, 'start'),
        duration: num(args, 'duration'),
        velocity: num(args, 'velocity'),
      })
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_rm_note',
    description: 'Remove a note (by its id, as shown in the file / diffs) from a track in a .beat file.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string' }, track: { type: 'string' }, note_id: { type: 'string' } },
      required: ['file', 'track', 'note_id'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc } = removeNote(before, str(args, 'track'), str(args, 'note_id'))
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_diff',
    description: 'Semantic (musical) diff between two .beat files — reads like an edit list ("lead: cutoff 3200 -> 900"), never line noise.',
    inputSchema: {
      type: 'object',
      properties: { file_a: { type: 'string' }, file_b: { type: 'string' } },
      required: ['file_a', 'file_b'],
    },
    handler: (args) =>
      formatDiff(diffDocuments(parse(readFileSync(str(args, 'file_a'), 'utf8')), parse(readFileSync(str(args, 'file_b'), 'utf8')))),
  },
  {
    name: 'beat_metrics',
    description:
      'Deterministic DSP measurements of a rendered WAV: integrated LUFS (ITU-R BS.1770), sample/true peak, crest factor, spectral band balance + centroid, stereo correlation/width. These numbers are the ground truth for any mix judgment — trust them over any impression of what the audio "probably" sounds like.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string', description: 'path to a .wav file (render one with beat_render)' } },
      required: ['file'],
    },
    handler: (args) => {
      const { channels, sampleRate } = decodeWav(readFileSync(str(args, 'file')))
      return JSON.stringify(analyze(channels, sampleRate), null, 2)
    },
  },
  {
    name: 'beat_lint',
    description:
      'Run the deterministic mix-lint rules over a rendered WAV: true-peak clipping risk, loudness vs target (default -14 LUFS), over-compression, spectral imbalance, mono/phase issues. Findings include the measured value, the threshold, and — where expressible — the .beat edit to try.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string' }, target_lufs: { type: 'number', description: 'loudness target, default -14' } },
      required: ['file'],
    },
    handler: (args) => {
      const { channels, sampleRate } = decodeWav(readFileSync(str(args, 'file')))
      const findings = lint(analyze(channels, sampleRate), typeof args.target_lufs === 'number' ? { targetLufs: args.target_lufs } : {})
      return formatLint(findings)
    },
  },
  {
    name: 'beat_render',
    description:
      'Render a .beat file to a WAV with the real BeatLab engine. offline=true (recommended for iteration) runs it in-process on node-web-audio-api — no browser, ~10s, self-consistent for relative loudness targets but with a known constant level offset vs the browser (see beatlab-daw/docs/phase-4-plan.md). offline=false drives headless Chromium — the fidelity reference, slower (~20s), use for final absolute-loudness checks. Needs a beatlab checkout: pass beatlab_dir or set BEATLAB_DIR in the environment.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        out: { type: 'string', description: 'output .wav path' },
        offline: { type: 'boolean', description: 'true = fast browserless render (default); false = headless-Chromium reference' },
        beatlab_dir: { type: 'string', description: 'path to a beatlab checkout (falls back to BEATLAB_DIR env)' },
      },
      required: ['file', 'out'],
    },
    handler: (args) =>
      new Promise<string>((resolve, reject) => {
        const offline = args.offline !== false
        const cliArgs = [join(repoRoot, 'cli', offline ? 'render-offline.mjs' : 'render.mjs'), str(args, 'file'), '-o', str(args, 'out')]
        if (typeof args.beatlab_dir === 'string') cliArgs.push('--beatlab-dir', args.beatlab_dir)
        execFile(process.execPath, cliArgs, { timeout: 180000 }, (err, stdout, stderr) => {
          if (err) reject(new Error(`render failed: ${stderr || stdout || err.message}`))
          else resolve(stdout)
        })
      }),
  },
]

function toolResultText(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) }
}

export async function runMcpServer(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const send = (msg: unknown) => output.write(JSON.stringify(msg) + '\n')

  const rl = createInterface({ input })
  for await (const line of rl) {
    if (!line.trim()) continue
    let req: JsonRpcRequest
    try {
      req = JSON.parse(line) as JsonRpcRequest
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
      continue
    }
    const { id, method, params = {} } = req

    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'beat', version: '0.3.0' },
        },
      })
      continue
    }
    if (method === 'notifications/initialized') continue // notification, no response
    if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} })
      continue
    }
    if (method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
      })
      continue
    }
    if (method === 'tools/call') {
      const name = (params as { name?: string }).name
      const args = ((params as { arguments?: Record<string, unknown> }).arguments ?? {}) as Record<string, unknown>
      const tool = TOOLS.find((t) => t.name === name)
      if (!tool) {
        send({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool "${String(name)}"` } })
        continue
      }
      try {
        const text = await tool.handler(args)
        send({ jsonrpc: '2.0', id, result: toolResultText(text) })
      } catch (err) {
        // tool-level failures are results with isError (per MCP), not protocol errors —
        // the agent should see the message and self-correct
        send({ jsonrpc: '2.0', id, result: toolResultText(err instanceof Error ? err.message : String(err), true) })
      }
      continue
    }
    if (id !== undefined) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } })
    }
  }
}
