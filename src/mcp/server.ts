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
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parse,
  serialize,
  setValue,
  addNote,
  removeNote,
  addHit,
  removeHit,
  humanize,
  quantizeNotes,
  addTrack,
  removeTrack,
  initDocument,
  diffDocuments,
  formatDiff,
  describeDocument,
  saveClip,
  setScene,
  setSong,
  parsePresetLibrary,
  applyPreset,
  formatPresetList,
  parseSelection,
  serializeSelection,
} from '../core/index.js'
import { decodeWav, analyze, lint, formatLint } from '../metrics/index.js'
import { checkpoint, history, collapsedHistory, restore, pin, unpin, pins } from '../history/index.js'

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
    name: 'beat_init',
    description: 'Create a fresh .beat project file with one starter synth track. Refuses to overwrite an existing file. Compose from there with beat_add_track / beat_add_note / beat_set.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        bpm: { type: 'number', description: 'integer 20-999, default 120' },
        loop_bars: { type: 'number', description: 'integer 1-64, default 2' },
      },
      required: ['file'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      if (existsSync(file)) throw new Error(`${file} already exists — refusing to overwrite`)
      const doc = initDocument({
        ...(typeof args.bpm === 'number' ? { bpm: args.bpm } : {}),
        ...(typeof args.loop_bars === 'number' ? { loopBars: args.loop_bars } : {}),
      })
      writeFileSync(file, serialize(doc))
      return `created ${file}: ${doc.bpm} bpm, ${doc.loopBars} bar(s), starter track "${doc.tracks[0]!.id}"\n`
    },
  },
  {
    name: 'beat_add_track',
    description: 'Add a new track (synth or drums) to a .beat file with the format init patch — the way an agent builds a project up from beat_init. Returns the edit list.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        id: { type: 'string', description: 'single alphanumeric token, e.g. "bass"' },
        kind: { type: 'string', enum: ['synth', 'drums'] },
        name: { type: 'string', description: 'single token; defaults to id' },
        color: { type: 'string', description: 'lowercase #rrggbb; defaults to a palette cycle' },
      },
      required: ['file', 'id', 'kind'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc } = addTrack(before, {
        id: str(args, 'id'),
        kind: str(args, 'kind') as 'synth' | 'drums',
        ...(typeof args.name === 'string' ? { name: args.name } : {}),
        ...(typeof args.color === 'string' ? { color: args.color } : {}),
      })
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_rm_track',
    description: 'Remove a track from a .beat file (a document keeps at least one track).',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string' }, id: { type: 'string' } },
      required: ['file', 'id'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc } = removeTrack(before, str(args, 'id'))
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
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
      'Apply one or more surgical edits to a .beat file and write it back canonically. Paths use the file\'s own field names: "bpm", "loop_bars", "selected_track", "<track>.<param>", "<track>.name", "<track>.color", "<track>.pattern.<lane>[<step>]" (lanes: kick, snare, clap, hat, openhat). Params: the core 9 (osc, volume, cutoff, resonance, attack, decay, sustain, release, pan) plus the full v0.3 shaped surface — osc2Type/osc2Level/osc2Detune, subLevel, noiseLevel, fm*, unisonVoices/unisonWidth, filterType, filterEnv*, lfo*/lfo2*, glide, eq*, comp*, distortion*, bitcrush*, sendReverb/sendDelay/sendMod, duckSource (a track id or "none") + duckAmount, and drum-voice shaping (kickTune/kickPunch/kickDecay, snareTone/snareDecay, hatTone/hatDecay/openHatDecay). Fields at their default are elided from the file. Returns the musical edit list of what changed.',
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
    name: 'beat_add_hit',
    description: 'Add a free-timed drum hit to a drum track (format v0.8). start is in fractional 16th-note steps (e.g. 4.5 is halfway between steps 4 and 5 — the off-grid timing that gives a groove its feel); velocity 0..1. lane is one of kick|snare|clap|hat|openhat.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        lane: { type: 'string' },
        start: { type: 'number' },
        velocity: { type: 'number' },
      },
      required: ['file', 'track', 'lane', 'start', 'velocity'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc } = addHit(before, str(args, 'track'), { lane: str(args, 'lane') as never, start: num(args, 'start'), velocity: num(args, 'velocity') })
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_rm_hit',
    description: 'Remove a drum hit by its id (as shown in the file / diffs) from a drum track.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string' }, track: { type: 'string' }, hit_id: { type: 'string' } },
      required: ['file', 'track', 'hit_id'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc } = removeHit(before, str(args, 'track'), str(args, 'hit_id'))
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_humanize',
    description:
      'Make a stiff, on-grid part feel played (the opposite of quantize; uses v0.7/v0.8 off-grid timing). Adds seeded jitter to note/hit start times (timing, in 16th steps) and velocities (velocity, 0..1), plus optional constant behind-the-beat drag (push_late, in steps — the J Dilla move) and offbeat swing (swing, 0..1). Deterministic under seed. Scope to specific note/hit ids with ids (e.g. resolve the user selection first). Works on synth/instrument notes or drum hits.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        timing: { type: 'number' },
        velocity: { type: 'number' },
        push_late: { type: 'number' },
        swing: { type: 'number' },
        seed: { type: 'number' },
        ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['file', 'track'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc, changed } = humanize(before, str(args, 'track'), {
        ...(args.timing !== undefined ? { timing: num(args, 'timing') } : {}),
        ...(args.velocity !== undefined ? { velocity: num(args, 'velocity') } : {}),
        ...(args.push_late !== undefined ? { pushLate: num(args, 'push_late') } : {}),
        ...(args.swing !== undefined ? { swing: num(args, 'swing') } : {}),
        ...(args.seed !== undefined ? { seed: num(args, 'seed') } : {}),
        ...(Array.isArray(args.ids) ? { ids: (args.ids as unknown[]).map(String) } : {}),
      })
      writeFileSync(file, serialize(doc))
      const diff = formatDiff(diffDocuments(before, doc))
      return changed === 0 ? 'no events moved\n' : diff
    },
  },
  {
    name: 'beat_quantize',
    description:
      'Quantize notes on a synth/instrument track toward the grid, Ableton-style (format v0.7 stores arbitrary fractional timing; quantize is an explicit edit, never a storage default). grid is in 16th steps (1=16ths, 2=8ths, 4=quarters, 0.5=32nds; default 1). amount 0..1 moves notes only part of the way (default 1 = full snap) — use e.g. 0.5 to tighten tapped timing while keeping feel. By default note starts snap (length preserved); set ends=true to also snap note ends, starts=false to snap ends only. note_ids restricts to a selection.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        grid: { type: 'number' },
        amount: { type: 'number' },
        starts: { type: 'boolean' },
        ends: { type: 'boolean' },
        note_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['file', 'track'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc, changed } = quantizeNotes(before, str(args, 'track'), {
        ...(args.grid !== undefined ? { grid: num(args, 'grid') } : {}),
        ...(args.amount !== undefined ? { amount: num(args, 'amount') } : {}),
        ...(args.starts !== undefined ? { starts: Boolean(args.starts) } : {}),
        ...(args.ends !== undefined ? { ends: Boolean(args.ends) } : {}),
        ...(Array.isArray(args.note_ids) ? { noteIds: (args.note_ids as unknown[]).map(String) } : {}),
      })
      writeFileSync(file, serialize(doc))
      const diff = formatDiff(diffDocuments(before, doc))
      return changed === 0 ? 'already on the grid — no notes moved\n' : diff
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
    name: 'beat_song',
    description:
      'Author the v0.4 arrangement timeline of a .beat file in one call: optionally snapshot tracks\' live content into named clips (clips), define scenes as track->clip maps (scenes), and set the song as an ordered list of {scene, bars} sections (song). Pass any subset; each applies in that order and the edit list is returned. An empty song array clears back to loop mode. Song sections play their scene\'s clips for N bars (clips loop every loop_bars within a section; unmapped tracks are silent).',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        clips: {
          type: 'array',
          items: { type: 'object', properties: { track: { type: 'string' }, clip: { type: 'string' } }, required: ['track', 'clip'] },
          description: 'snapshot each track\'s current live notes/pattern into a named clip',
        },
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, slots: { type: 'object', additionalProperties: { type: 'string' } } },
            required: ['id', 'slots'],
          },
          description: 'each scene maps track ids to clip ids',
        },
        song: {
          type: 'array',
          items: { type: 'object', properties: { scene: { type: 'string' }, bars: { type: 'number' } }, required: ['scene', 'bars'] },
          description: 'the ordered section list; total bars = render length',
        },
      },
      required: ['file'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      let doc = before
      for (const c of (args.clips as { track: string; clip: string }[] | undefined) ?? []) doc = saveClip(doc, c.track, c.clip).doc
      for (const s of (args.scenes as { id: string; slots: Record<string, string> }[] | undefined) ?? []) doc = setScene(doc, s.id, s.slots)
      if (args.song !== undefined) doc = setSong(doc, args.song as { scene: string; bars: number }[])
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_presets',
    description:
      'List the preset library: named, curated synth/drum voicings (a preset is a bag of param edits, not a format feature — applying one writes plain params into the file). Use before beat_preset to see what exists and what each is for.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const presets = parsePresetLibrary(readFileSync(join(repoRoot, 'presets', 'factory.json'), 'utf8'))
      return formatPresetList(presets)
    },
  },
  {
    name: 'beat_preset',
    description:
      'Apply a named preset to a track in a .beat file — sets each of the preset\'s params exactly as beat_set would and returns the resulting edit list. Presets never carry routing (duckSource); set that separately per project.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        preset: { type: 'string', description: 'a name from beat_presets, e.g. "lush-pad"' },
      },
      required: ['file', 'track', 'preset'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const presets = parsePresetLibrary(readFileSync(join(repoRoot, 'presets', 'factory.json'), 'utf8'))
      const name = str(args, 'preset')
      const preset = presets.find((p) => p.name === name)
      if (!preset) throw new Error(`no preset "${name}" (have: ${presets.map((p) => p.name).join(', ')})`)
      const before = parse(readFileSync(file, 'utf8'))
      const doc = applyPreset(before, str(args, 'track'), preset)
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
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
    name: 'beat_selection',
    description:
      "Read or set the DAW selection: what the user has highlighted in the GUI right now — treat it as the referent of \"this\" in their request (\"change this up\", \"vary the selected section\"). The selection is ephemeral, held in the running daemon's memory, and NEVER written to the .beat file. With neither set nor clear, returns the current selection in the .beat selection grammar (or \"no selection\"). The daemon must be running (beat daemon <file>); pass its port. Axes are filters (tracks / lanes / bars / notes); an absent axis means unfiltered.",
    inputSchema: {
      type: 'object',
      properties: {
        port: { type: 'number', description: 'the running daemon\'s port' },
        set: {
          type: 'string',
          description: 'a selection grammar block to store, e.g. "selection\\n  tracks drums\\n  bars 8 16\\n" (validated against the current document)',
        },
        clear: { type: 'boolean', description: 'clear the selection back to empty' },
      },
      required: ['port'],
    },
    handler: async (args) => {
      const base = `http://127.0.0.1:${num(args, 'port')}`
      const fail = async (res: Response) => {
        const msg = await res.json().then((b) => (b as { error?: string }).error).catch(() => res.statusText)
        throw new Error(`daemon rejected the selection: ${msg}`)
      }
      if (args.clear === true) {
        const res = await fetch(`${base}/selection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        if (!res.ok) await fail(res)
        return 'selection cleared\n'
      }
      if (typeof args.set === 'string') {
        const sel = parseSelection(args.set)
        const res = await fetch(`${base}/selection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sel) })
        if (!res.ok) await fail(res)
        return serializeSelection(sel)
      }
      const res = await fetch(`${base}/selection`)
      if (!res.ok) await fail(res)
      const sel = (await res.json()) as Record<string, unknown>
      return Object.keys(sel).length === 0 ? 'no selection\n' : serializeSelection(sel)
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
  {
    name: 'beat_checkpoint',
    description:
      'Save a restorable version of a .beat project. Call this after each batch of edits that fulfils one user request — pass the user\'s request verbatim as `intent` so the version can later be found by what was asked for. Without a `label` the checkpoint auto-labels itself from the semantic diff ("lead: cutoff 3200 -> 900"). Storage is a local git repo in the project folder (created invisibly); no git knowledge or setup is needed. Returns the new checkpoint\'s ref, or reports that nothing changed since the last one.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        label: { type: 'string', description: 'optional human name for this version, e.g. "rough mix v1"; omit to auto-label from the diff' },
        intent: { type: 'string', description: 'the user request that drove these edits — index the version by intent so "the good version" is findable later' },
      },
      required: ['file'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const result = checkpoint(file, {
        ...(typeof args.label === 'string' ? { label: args.label } : {}),
        ...(typeof args.intent === 'string' ? { intent: args.intent } : {}),
      })
      if (result.skipped) return 'no changes since the last checkpoint — nothing to save\n'
      return `checkpoint ${result.ref}  ${result.when}  ${result.label}\n`
    },
  },
  {
    name: 'beat_history',
    description:
      'List a .beat project\'s checkpoints, newest first: each line is a ref, ISO timestamp, the semantic label (with its pin name appended when it has one), and the recorded intent when there is one. Use this to find "the good version" the user wants to return to — read the labels/intents/pins, then hand the chosen ref to beat_restore or beat_pin. Pass `collapsed: true` to fold runs of unnamed checkpoints between pins into a single "N more checkpoints" line — use that for a long history where only the pinned/named versions matter.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        limit: { type: 'number', description: 'max checkpoints to return (most recent first)' },
        collapsed: { type: 'boolean', description: 'fold unnamed checkpoint runs between pins into summary lines instead of listing every one' },
      },
      required: ['file'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const opts = typeof args.limit === 'number' ? { limit: args.limit } : {}
      const formatLine = (e: { ref: string; when: string; label: string; intent?: string; pin?: string }) =>
        `${e.ref}  ${e.when}  ${e.label}${e.pin ? `  [pin: ${e.pin}]` : ''}${e.intent ? `  (intent: ${e.intent})` : ''}`
      if (args.collapsed === true) {
        const rows = collapsedHistory(file, opts)
        if (rows.length === 0) return 'no history yet\n'
        return rows.map((row) => (row.kind === 'collapsed' ? `  ... ${row.count} more checkpoint${row.count === 1 ? '' : 's'} ...` : formatLine(row))).join('\n') + '\n'
      }
      const entries = history(file, opts)
      if (entries.length === 0) return 'no history yet\n'
      return entries.map(formatLine).join('\n') + '\n'
    },
  },
  {
    name: 'beat_restore',
    description:
      'Go back to an earlier checkpoint (ref from beat_history): rewrites the .beat file to that version and takes a fresh checkpoint. This is APPEND-ONLY and always safe — it never destroys work, because the pre-restore state stays in history and can itself be restored (redo is free). Use it freely whenever the user wants an earlier take back.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        ref: { type: 'string', description: 'a checkpoint ref from beat_history' },
      },
      required: ['file', 'ref'],
    },
    handler: (args) => {
      const result = restore(str(args, 'file'), str(args, 'ref'))
      if (result.skipped) return 'that version is already the current one — nothing changed\n'
      return `restored — new checkpoint ${result.ref}  ${result.label}\n`
    },
  },
  {
    name: 'beat_pin',
    description:
      'Name a checkpoint ("rough mix v1", "the good bridge" — 25 characters or fewer) so it stands out in beat_history and survives any amount of unnamed-checkpoint noise around it. Storage is a plain git tag in the same local repo as the checkpoints — nothing new to back up, nothing restore can invalidate. Fails loudly if the ref is unknown, is not a checkpoint of this file, or the name is already used.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        ref: { type: 'string', description: 'a checkpoint ref from beat_history' },
        name: { type: 'string', description: 'the pin\'s display name, <=25 characters' },
      },
      required: ['file', 'ref', 'name'],
    },
    handler: (args) => {
      const result = pin(str(args, 'file'), str(args, 'ref'), str(args, 'name'))
      return `pinned ${result.ref} as "${result.name}"\n`
    },
  },
  {
    name: 'beat_unpin',
    description: 'Remove a pin by name. The underlying checkpoint is untouched — this only removes the name.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        name: { type: 'string', description: 'the pin\'s display name, as given to beat_pin' },
      },
      required: ['file', 'name'],
    },
    handler: (args) => {
      unpin(str(args, 'file'), str(args, 'name'))
      return `unpinned "${str(args, 'name')}"\n`
    },
  },
  {
    name: 'beat_pins',
    description: 'List a .beat project\'s named pins, newest checkpoint first: each line is the pinned checkpoint\'s ref, ISO timestamp, and pin name.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
      },
      required: ['file'],
    },
    handler: (args) => {
      const entries = pins(str(args, 'file'))
      if (entries.length === 0) return 'no pins yet\n'
      return entries.map((p) => `${p.ref}  ${p.when}  ${p.name}`).join('\n') + '\n'
    },
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
