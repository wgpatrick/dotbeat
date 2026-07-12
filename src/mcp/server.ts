// `beat mcp` — a minimal Model Context Protocol server over stdio (docs/phase-3-plan.md §3.4).
//
// This is the M3 "agent-native" boundary: the same operations the CLI exposes, as MCP tools an
// AI agent can call — the structurally-cleaner alternative to puppeting a live DAW over a socket
// (ROADMAP §5 "MCP server"; the ableton-mcp contrast). Implemented by hand on newline-delimited
// JSON-RPC 2.0 rather than pulling in an SDK: the protocol surface we need (initialize,
// tools/list, tools/call) is tiny, and the project's zero-runtime-deps stance has paid for
// itself twice already (daemon, metrics).
//
// Render note: beat_render shells out to cli/render.mjs (it needs Chromium to drive dotbeat's own
// engine headless — no BeatLab checkout) — everything else runs in-process on core/metrics.

import { createInterface } from 'node:readline'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, join, resolve as pathResolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parse,
  serialize,
  setValue,
  addNote,
  removeNote,
  addHit,
  removeHit,
  setAutomationPoint,
  addEffect,
  removeEffect,
  moveEffect,
  setEffectEnabled,
  humanize,
  quantizeNotes,
  transposeNotes,
  timeScaleNotes,
  fitToScaleNotes,
  invertNotes,
  reverseNotes,
  legatoNotes,
  consolidateRatchet,
  SCALE_NAMES,
  addTrack,
  removeTrack,
  addGroup,
  removeGroup,
  renameGroup,
  setGroupColor,
  setGroupTracks,
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
  filterPresetsByCategory,
  PRESET_CATEGORIES,
  parseDrumKitLibrary,
  applyDrumKit,
  formatDrumKitList,
  parseSelection,
  serializeSelection,
  type BeatDocument,
} from '../core/index.js'
import { decodeWav, analyze, lint, formatLint } from '../metrics/index.js'
import { checkpoint, history, collapsedHistory, restore, pin, unpin, pins } from '../history/index.js'
import { suggestNext, parseScoresLog } from '../vary/suggest.js'

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

type InstrumentPresetResult = { presets: { program: number; bankMSB: number; bankLSB: number; name: string }[] } | { error: string }

/** v0.8+ multi-preset listing (docs/phase-8-plan.md's "Remaining"): mirrors the CLI's
 * `beat inspect` feature (cli/beat.mjs's instrumentPresetInfo) for MCP parity — reads the actual
 * .sf2 bytes (sha256-verified against the media block) and enumerates every preset in the bank
 * via spessasynth_core's SoundBankLoader (a pure binary parse; no audio context needed). Best-
 * effort per track: a missing/unregistered/mismatched sample is reported rather than failing the
 * whole inspect. */
async function instrumentPresetInfo(file: string, doc: BeatDocument): Promise<Map<string, InstrumentPresetResult>> {
  const info = new Map<string, InstrumentPresetResult>()
  const instrumentTracks = doc.tracks.filter((t) => t.kind === 'instrument' && t.instrument)
  if (instrumentTracks.length === 0) return info
  const beatDir = dirname(pathResolve(file))
  let SoundBankLoader: { fromArrayBuffer: (b: ArrayBuffer) => { presets: { program: number; bankMSB: number; bankLSB: number; name: string }[] } } | undefined
  for (const t of instrumentTracks) {
    const sample = doc.media.find((m) => m.id === t.instrument!.sample)
    if (!sample) {
      info.set(t.id, { error: `sample "${t.instrument!.sample}" is not in the media block` })
      continue
    }
    const filePath = pathResolve(beatDir, sample.path)
    if (!existsSync(filePath)) {
      info.set(t.id, { error: `file not found: ${sample.path} (relative to ${beatDir})` })
      continue
    }
    try {
      const bytes = readFileSync(filePath)
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (hash !== sample.sha256) {
        info.set(t.id, { error: `sha256 mismatch for ${sample.path} (file ${hash.slice(0, 12)}..., document expects ${sample.sha256.slice(0, 12)}...)` })
        continue
      }
      SoundBankLoader ??= (await import('spessasynth_core')).SoundBankLoader
      const bank = SoundBankLoader.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      const presets = bank.presets
        .map((p) => ({ program: p.program, bankMSB: p.bankMSB, bankLSB: p.bankLSB, name: p.name }))
        .sort((a, b) => a.bankMSB - b.bankMSB || a.bankLSB - b.bankLSB || a.program - b.program)
      info.set(t.id, { presets })
    } catch (e) {
      info.set(t.id, { error: e instanceof Error ? e.message : String(e) })
    }
  }
  return info
}

function formatInstrumentPresets(doc: BeatDocument, info: Map<string, InstrumentPresetResult>): string {
  if (info.size === 0) return ''
  const lines: string[] = ['', 'soundfont presets:']
  for (const t of doc.tracks) {
    const result = info.get(t.id)
    if (!result) continue
    if ('error' in result) {
      lines.push(`  ${t.id}: ${result.error}`)
      continue
    }
    lines.push(`  ${t.id}: ${result.presets.length} preset${result.presets.length === 1 ? '' : 's'}`)
    for (const p of result.presets) {
      const selected = p.program === t.instrument!.program ? ' [selected]' : ''
      lines.push(`    program ${p.program} (bank ${p.bankMSB}/${p.bankLSB}): "${p.name}"${selected}`)
    }
  }
  return lines.join('\n') + '\n'
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
    description:
      'Add a new track (synth, drums, or instrument) to a .beat file with the format init patch — the way an agent builds a project up from beat_init. An instrument track is a sampled SF2 voice: pass soundfont_sample (a media id already registered via beat_sample) and optionally soundfont_program (the SF2 program number, default 0) — see beat_inspect on an instrument track for the bank\'s full preset list. Returns the edit list.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        id: { type: 'string', description: 'single alphanumeric token, e.g. "bass"' },
        kind: { type: 'string', enum: ['synth', 'drums', 'instrument'] },
        name: { type: 'string', description: 'single token; defaults to id' },
        color: { type: 'string', description: 'lowercase #rrggbb; defaults to a palette cycle' },
        soundfont_sample: { type: 'string', description: 'instrument tracks only: a media id (register the .sf2 with beat_sample first)' },
        soundfont_program: { type: 'number', description: 'instrument tracks only: SF2 program number 0-127, default 0' },
      },
      required: ['file', 'id', 'kind'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const kind = str(args, 'kind') as 'synth' | 'drums' | 'instrument'
      const { doc } = addTrack(before, {
        id: str(args, 'id'),
        kind,
        ...(typeof args.name === 'string' ? { name: args.name } : {}),
        ...(typeof args.color === 'string' ? { color: args.color } : {}),
        ...(kind === 'instrument' ? { soundfont: { sample: str(args, 'soundfont_sample'), program: typeof args.soundfont_program === 'number' ? args.soundfont_program : 0 } } : {}),
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
    name: 'beat_group',
    description:
      'Fold N existing tracks into one named, colored group (Phase 22 "track & project polish" — the same fold a DAW group-track UI does). A track belongs to at most one group; grouping an already-grouped track is refused. Returns the edit list.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        id: { type: 'string', description: 'single alphanumeric token, e.g. "keys"' },
        track_ids: { type: 'array', items: { type: 'string' }, description: 'the tracks to fold into this group, at least 1' },
        name: { type: 'string', description: 'single token; defaults to id' },
        color: { type: 'string', description: 'lowercase #rrggbb; defaults to a palette cycle' },
      },
      required: ['file', 'id', 'track_ids'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const trackIds = args.track_ids
      if (!Array.isArray(trackIds) || trackIds.length === 0 || !trackIds.every((t) => typeof t === 'string')) {
        throw new Error('track_ids must be a non-empty array of strings')
      }
      const { doc } = addGroup(before, {
        id: str(args, 'id'),
        trackIds,
        ...(typeof args.name === 'string' ? { name: args.name } : {}),
        ...(typeof args.color === 'string' ? { color: args.color } : {}),
      })
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_rm_group',
    description: 'Ungroup: deletes a group. Member tracks are kept, untouched.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string' }, id: { type: 'string' } },
      required: ['file', 'id'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc } = removeGroup(before, str(args, 'id'))
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_group_set',
    description: 'Rename/recolor a group, or replace its whole membership list (add/remove/reorder members) — pass any combination of name/color/track_ids.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        id: { type: 'string' },
        name: { type: 'string' },
        color: { type: 'string', description: 'lowercase #rrggbb' },
        track_ids: { type: 'array', items: { type: 'string' }, description: 'replaces the group\'s whole membership list' },
      },
      required: ['file', 'id'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const id = str(args, 'id')
      if (args.name === undefined && args.color === undefined && args.track_ids === undefined) {
        throw new Error('pass at least one of name/color/track_ids')
      }
      let doc: BeatDocument = before
      if (typeof args.name === 'string') doc = renameGroup(doc, id, args.name)
      if (typeof args.color === 'string') doc = setGroupColor(doc, id, args.color)
      if (args.track_ids !== undefined) {
        const trackIds = args.track_ids
        if (!Array.isArray(trackIds) || !trackIds.every((t) => typeof t === 'string')) throw new Error('track_ids must be an array of strings')
        doc = setGroupTracks(doc, id, trackIds)
      }
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_inspect',
    description:
      'Overview of a .beat project file: bpm, loop length, tracks, synth settings, note ranges, drum grids. For instrument tracks, also lists every preset available in the loaded SF2 bank (not just the one selected), marking the current selection. The place to start before editing.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string', description: 'path to the .beat file' } },
      required: ['file'],
    },
    handler: async (args) => {
      const file = str(args, 'file')
      const doc = parse(readFileSync(file, 'utf8'))
      const presetInfo = await instrumentPresetInfo(file, doc)
      return describeDocument(doc) + formatInstrumentPresets(doc, presetInfo)
    },
  },
  {
    name: 'beat_set',
    description:
      'Apply one or more surgical edits to a .beat file and write it back canonically. Paths use the file\'s own field names: "bpm", "loop_bars", "selected_track", "<track>.<param>", "<track>.name", "<track>.color", "<track>.pattern.<lane>[<step>]" (lanes: kick, snare, clap, hat, openhat), "<track>.shuffleAmount"/"<track>.shuffleGrid" (v0.10 groove — a reversible time-warp applied at playback, 0 amount = off), "<track>.note.<id>.chance" (0-100, v0.10 per-note trigger probability, default 100 = always fires), "<track>.note.<id>.cent" (-50..50, v0.10 per-note micro-tuning independent of pitch), "<track>.note.<id>.ratchetCount"/"ratchetCurve"/"ratchetLength" (v0.10 note ratchet/repeat — see beat_consolidate to bake a ratchet back into discrete notes). Params: the core 9 (osc, volume, cutoff, resonance, attack, decay, sustain, release, pan) plus the full v0.3 shaped surface — osc2Type/osc2Level/osc2Detune, subLevel, noiseLevel, fm*, unisonVoices/unisonWidth, filterType, filterEnv*, lfo*/lfo2*, glide, eq*, comp*, distortion*, bitcrush*, pingPong* (ping pong delay), beatRepeat* (grid/gate/chance/mode scheduling-layer stutter), chorus*/phaser* (per-track chorus-ensemble and phaser-flanger inserts), saturator* (curve/drive/mix), sendReverb/sendDelay, duckSource (a track id or "none") + duckAmount, and drum-voice shaping (kickTune/kickPunch/kickDecay, snareTone/snareDecay, hatTone/hatDecay/openHatDecay). Fields at their default are elided from the file. Returns the musical edit list of what changed.',
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
    description:
      'Add a free-timed drum hit to a drum track (format v0.10). start is in fractional 16th-note steps (e.g. 4.5 is halfway between steps 4 and 5 — the off-grid timing that gives a groove its feel); velocity 0..1. lane is open: one of the track\'s own declared lanes (see beat_inspect), or one of the implicit kick|snare|clap|hat|openhat for a track that declares none. Optional duration (16th steps, > 0) gates the voice instead of firing a one-shot trigger — release for synth/SoundFont-backed lanes, truncation for sample-backed ones.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        lane: { type: 'string' },
        start: { type: 'number' },
        velocity: { type: 'number' },
        duration: { type: 'number' },
      },
      required: ['file', 'track', 'lane', 'start', 'velocity'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const duration = typeof args.duration === 'number' ? args.duration : undefined
      const { doc } = addHit(before, str(args, 'track'), { lane: str(args, 'lane'), start: num(args, 'start'), velocity: num(args, 'velocity'), duration })
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
    name: 'beat_automate',
    description:
      'Add or move a clip automation point (format v0.9): a (time, value) point on a named synth param\'s automation lane within one clip. time is in fractional 16th steps from the CLIP\'s own start (v0.7 number rules); value is in the param\'s own units (Hz for cutoff, dB for volume, 0..1 for resonance-like params, etc.). param is any numeric synth field (the core 9 minus osc, plus the v0.3 shaped surface — see beat_set\'s description for the full list). Pass id to move an existing point (matched by id) instead of adding a new one; omit it to add a new point with a minted id. Returns the musical edit list.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        clip: { type: 'string' },
        param: { type: 'string' },
        time: { type: 'number' },
        value: { type: 'number' },
        id: { type: 'string', description: 'an existing point id to move; omit to add a new point' },
      },
      required: ['file', 'track', 'clip', 'param', 'time', 'value'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc } = setAutomationPoint(before, str(args, 'track'), str(args, 'clip'), str(args, 'param'), {
        time: num(args, 'time'),
        value: num(args, 'value'),
        ...(typeof args.id === 'string' ? { id: args.id } : {}),
      })
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_effect_add',
    description:
      "Add an insert to a synth track's effect chain (format v0.10). Array order in the file IS chain order — no separate index field — so this is dotbeat's answer to \"reorder/add/remove effects,\" built as flat ordered text rather than a box/pointer graph (docs/research/21-opendaw-devices-effects.md #1). type is one of eq3|comp|distortion|bitcrush (the same four built-in inserts every synth track already has knobs for — see beat_set's eqLow/compMix/distortionMix/bitcrushMix etc.; this tool only changes whether/where/in-what-order they run, not their own params). Omit id to mint one (the type name, or type_2/_3... on collision); omit index to append. Returns the musical edit list.",
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        type: { type: 'string', description: 'eq3 | comp | distortion | bitcrush' },
        id: { type: 'string', description: 'a stable id for this instance; omit to mint one' },
        index: { type: 'number', description: '0-based insert position; omit to append at the end of the chain' },
        bypassed: { type: 'boolean', description: 'add it already bypassed; default false (active)' },
      },
      required: ['file', 'track', 'type'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const opts: { id?: string; index?: number; enabled?: boolean } = {}
      if (typeof args.id === 'string') opts.id = args.id
      if (typeof args.index === 'number') opts.index = args.index
      if (typeof args.bypassed === 'boolean') opts.enabled = !args.bypassed
      const { doc } = addEffect(before, str(args, 'track'), str(args, 'type') as never, opts)
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_effect_rm',
    description: 'Remove an effect instance (by its id, as shown in the file / beat_inspect / diffs) from a synth track\'s effect chain.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string' }, track: { type: 'string' }, effect_id: { type: 'string' } },
      required: ['file', 'track', 'effect_id'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc } = removeEffect(before, str(args, 'track'), str(args, 'effect_id'))
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_effect_move',
    description:
      'Reorder a synth track\'s effect chain: move one effect instance to a new 0-based position (clamped to the list bounds). This IS the reorder primitive — chain order is exactly the array order, so moving one entry is the whole operation, and the resulting file diff is a small, local change (the moved lines), not a full rewrite.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string' }, track: { type: 'string' }, effect_id: { type: 'string' }, index: { type: 'number' } },
      required: ['file', 'track', 'effect_id', 'index'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc } = moveEffect(before, str(args, 'track'), str(args, 'effect_id'), num(args, 'index'))
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_effect_bypass',
    description:
      "Bypass or re-enable one effect instance on a synth track. This is a REAL routing bypass (the effect is wired out of the audio graph entirely, ui/src/audio/engine.ts), not just its own mix knob set to 0 — the only meaningful way to bypass eq3, which has no mix control of its own. Equivalent to beat_set's <track>.effect.<id>.enabled path.",
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string' }, track: { type: 'string' }, effect_id: { type: 'string' }, enabled: { type: 'boolean' } },
      required: ['file', 'track', 'effect_id', 'enabled'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      if (typeof args.enabled !== 'boolean') throw new Error('missing required boolean argument "enabled"')
      const { doc } = setEffectEnabled(before, str(args, 'track'), str(args, 'effect_id'), args.enabled)
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
  // ---- Pitch & Time operations (Phase 22 Stream AD) — one-shot edit primitives, same shape as
  // beat_quantize/beat_humanize above: pure core function, canonical write, musical-edit-list
  // return value. Every op takes an optional note_ids scope (a resolved selection).
  {
    name: 'beat_transpose',
    description: 'Shift every scoped note\'s pitch by semitones (+/-), clamped to MIDI 0-127 (out-of-range notes clamp rather than erroring). note_ids restricts to a selection.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        semitones: { type: 'number', description: 'integer, positive or negative' },
        note_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['file', 'track', 'semitones'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc, changed } = transposeNotes(before, str(args, 'track'), num(args, 'semitones'), Array.isArray(args.note_ids) ? { noteIds: (args.note_ids as unknown[]).map(String) } : {})
      writeFileSync(file, serialize(doc))
      const diff = formatDiff(diffDocuments(before, doc))
      return changed === 0 ? 'no notes moved (already clamped, or nothing in scope)\n' : diff
    },
  },
  {
    name: 'beat_time_scale',
    description: 'Stretch every scoped note\'s start/duration by factor (2 = Ableton\'s x2 Stretch button, 0.5 = ÷2, or any positive factor), anchored at the EARLIEST scoped note so a selected phrase stretches in place rather than sliding. note_ids restricts to a selection.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        factor: { type: 'number', description: '> 0; 2 = double length, 0.5 = half length' },
        note_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['file', 'track', 'factor'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc, changed } = timeScaleNotes(before, str(args, 'track'), num(args, 'factor'), Array.isArray(args.note_ids) ? { noteIds: (args.note_ids as unknown[]).map(String) } : {})
      writeFileSync(file, serialize(doc))
      const diff = formatDiff(diffDocuments(before, doc))
      return changed === 0 ? 'no notes changed\n' : diff
    },
  },
  {
    name: 'beat_fit_scale',
    description: `Snap every scoped note's pitch to the nearest tone in root/scale (Ableton's "Fit to Scale"). root is a pitch class 0-11 (0=C, 1=C#, ... 11=B). Ties (equidistant up/down) resolve to the lower pitch. Valid scale names: ${SCALE_NAMES.join(', ')}. note_ids restricts to a selection.`,
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        root: { type: 'number', description: 'pitch class 0-11 (0=C)' },
        scale: { type: 'string', description: `one of: ${SCALE_NAMES.join(', ')}` },
        note_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['file', 'track', 'root', 'scale'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc, changed } = fitToScaleNotes(before, str(args, 'track'), num(args, 'root'), str(args, 'scale'), Array.isArray(args.note_ids) ? { noteIds: (args.note_ids as unknown[]).map(String) } : {})
      writeFileSync(file, serialize(doc))
      const diff = formatDiff(diffDocuments(before, doc))
      return changed === 0 ? 'already in scale — no notes moved\n' : diff
    },
  },
  {
    name: 'beat_invert',
    description: 'Mirrors every scoped note\'s pitch around axis (newPitch = 2*axis - pitch, clamped to 0-127). Omit axis to mirror around the scoped notes\' own mean pitch (Ableton\'s Invert has no separate axis control; this defaults the same way). note_ids restricts to a selection.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        axis: { type: 'number', description: 'a MIDI pitch to mirror around; omit for the selection\'s own mean pitch' },
        note_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['file', 'track'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc, changed } = invertNotes(before, str(args, 'track'), typeof args.axis === 'number' ? args.axis : undefined, Array.isArray(args.note_ids) ? { noteIds: (args.note_ids as unknown[]).map(String) } : {})
      writeFileSync(file, serialize(doc))
      const diff = formatDiff(diffDocuments(before, doc))
      return changed === 0 ? 'no notes moved\n' : diff
    },
  },
  {
    name: 'beat_reverse',
    description: 'Tape-reverses the scoped notes\' own time span: each note\'s [start, start+duration) interval reflects around the span\'s midpoint (playback order flips; durations are unchanged). note_ids restricts to a selection.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        note_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['file', 'track'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc, changed } = reverseNotes(before, str(args, 'track'), Array.isArray(args.note_ids) ? { noteIds: (args.note_ids as unknown[]).map(String) } : {})
      writeFileSync(file, serialize(doc))
      const diff = formatDiff(diffDocuments(before, doc))
      return changed === 0 ? 'no notes moved (a single note has no span to reverse)\n' : diff
    },
  },
  {
    name: 'beat_legato',
    description: 'Extends (or shortens) each scoped note\'s duration to reach the NEXT scoped note\'s start, time-ordered regardless of pitch (Ableton\'s Legato) — closes gaps and removes overlaps. gap (steps, default 0) leaves a small silence before the next note instead of touching it exactly. The last scoped note is left alone. note_ids restricts to a selection.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        gap: { type: 'number', description: 'steps of silence to leave before the next note, default 0' },
        note_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['file', 'track'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc, changed } = legatoNotes(before, str(args, 'track'), {
        ...(typeof args.gap === 'number' ? { gap: args.gap } : {}),
        ...(Array.isArray(args.note_ids) ? { noteIds: (args.note_ids as unknown[]).map(String) } : {}),
      })
      writeFileSync(file, serialize(doc))
      const diff = formatDiff(diffDocuments(before, doc))
      return changed === 0 ? 'no notes resized\n' : diff
    },
  },
  {
    name: 'beat_consolidate',
    description: 'Bakes every scoped ratcheted note (ratchetCount > 1 — see beat_set\'s note.<id>.ratchetCount) back into ratchetCount discrete, plain notes (research 22\'s "Consolidate" action, the inverse of setting a ratchet). Notes that aren\'t ratcheted are left alone. note_ids restricts to a selection.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        note_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['file', 'track'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc, changed } = consolidateRatchet(before, str(args, 'track'), Array.isArray(args.note_ids) ? { noteIds: (args.note_ids as unknown[]).map(String) } : {})
      writeFileSync(file, serialize(doc))
      const diff = formatDiff(diffDocuments(before, doc))
      return changed === 0 ? 'no ratcheted notes in scope — nothing to consolidate\n' : diff
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
      `List the preset library: named, curated synth/drum voicings (a preset is a bag of param edits, not a format feature — applying one writes plain params into the file). Each preset carries a taxonomy \`category\` (research 18's content-taxonomy recommendation) shown in the listing; pass \`category\` to filter to one, e.g. { category: "bass" }. Valid categories: ${PRESET_CATEGORIES.join(', ')}. Use before beat_preset to see what exists and what each is for.`,
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: `filter to one category — one of: ${PRESET_CATEGORIES.join(', ')}` },
      },
    },
    handler: (args) => {
      let presets = parsePresetLibrary(readFileSync(join(repoRoot, 'presets', 'factory.json'), 'utf8'))
      if (args.category !== undefined) presets = filterPresetsByCategory(presets, str(args, 'category'))
      return formatPresetList(presets)
    },
  },
  {
    name: 'beat_preset',
    description:
      'Apply a named preset to a track in a .beat file — sets each of the preset\'s params exactly as beat_set would and returns the resulting edit list. Presets never carry routing (duckSource); set that separately per project. Use beat_presets (optionally with a `category` filter, e.g. "bass"/"lead"/"pad") to find a name first.',
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
    name: 'beat_drum_kits',
    description:
      'List the factory drum-kit library (Phase 22 Stream AB, docs/research/19-drum-voice-expansion.md): kit-808/kit-909 (synth-backed) and kit-acoustic (SoundFont-backed against the bundled MuldjordKit — register it first with beat_sample under the id "muldjordkit", or pass --sample to remap when applying). A kit REPLACES a drum track\'s whole lane list — see beat_drum_kit.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => formatDrumKitList(parseDrumKitLibrary(readFileSync(join(repoRoot, 'presets', 'drum-kits.json'), 'utf8'))),
  },
  {
    name: 'beat_drum_kit',
    description:
      'Apply a named drum kit to a track: REPLACES its whole declared lane list (research 19 Part VI/VII) with the kit\'s — a complete voicing, not an incremental edit. Fails loudly if the track has existing hits on lanes the new kit doesn\'t declare, or if a sample/SoundFont-backed lane references media the file hasn\'t registered yet (beat_sample first). Use beat_drum_kits to see what exists.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        kit: { type: 'string', description: 'a name from beat_drum_kits, e.g. "kit-808"' },
      },
      required: ['file', 'track', 'kit'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const kits = parseDrumKitLibrary(readFileSync(join(repoRoot, 'presets', 'drum-kits.json'), 'utf8'))
      const name = str(args, 'kit')
      const kit = kits.find((k) => k.name === name)
      if (!kit) throw new Error(`no drum kit "${name}" (have: ${kits.map((k) => k.name).join(', ')})`)
      const before = parse(readFileSync(file, 'utf8'))
      const doc = applyDrumKit(before, str(args, 'track'), kit)
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
      "Render a .beat file to a WAV through dotbeat's own audio engine (ui/src/audio/engine.ts, the same engine the live GUI plays) driven in headless Chromium — no BeatLab checkout required. Real-time capture: takes about as long as the audio is long, plus a few seconds of browser/daemon startup. Pass tail_seconds to capture a reverb/delay tail past the loop end.",
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        out: { type: 'string', description: 'output .wav path' },
        tail_seconds: { type: 'number', description: 'extra seconds captured past the loop/song end (for reverb/delay tails)' },
      },
      required: ['file', 'out'],
    },
    handler: (args) =>
      new Promise<string>((resolve, reject) => {
        const cliArgs = [join(repoRoot, 'cli', 'render.mjs'), str(args, 'file'), '-o', str(args, 'out')]
        if (typeof args.tail_seconds === 'number') cliArgs.push('--tail', String(args.tail_seconds))
        execFile(process.execPath, cliArgs, { timeout: 600000 }, (err, stdout, stderr) => {
          if (err) reject(new Error(`render failed: ${stderr || stdout || err.message}`))
          else resolve(stdout)
        })
      }),
  },
  {
    name: 'beat_suggest',
    description:
      'Read a track\'s beat-scores.jsonl exhaust (written by beat_score / `beat score`) and propose the next `beat vary` round, biased toward the mutation group that has scored best so far. Aggregates picked-vs-rejected counts per group (Bradley-Terry odds-form against an implicit "not picked" baseline — a ranking signal, not a proven head-to-head result, since each vary round tests only one group) and, where enough picks share a numeric param, reports whether picks trend toward one end of that param\'s vary.ts range (e.g. brighter/darker on filter.cutoff). With no scored rounds yet for the track (cold start), says so and recommends a sensible first round instead of guessing. Returns the reasoning as plain text ending in a copy-pasteable `beat vary` command; never a bare score.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'path shown in the recommended command (the project this suggestion is for)' },
        track: { type: 'string' },
        target: { type: 'string', description: 'optional lane/id/param focus filter over the scores log (matched against round group names and picks\' edit paths / feel recipes)' },
        log: { type: 'string', description: 'path to beat-scores.jsonl, default "beat-scores.jsonl"' },
      },
      required: ['file', 'track'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const track = str(args, 'track')
      const logPath = typeof args.log === 'string' ? args.log : 'beat-scores.jsonl'
      const text = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
      const entries = parseScoresLog(text)
      const suggestion = suggestNext(entries, track, { file, ...(typeof args.target === 'string' ? { target: args.target } : {}) })
      return suggestion.reasoning.join('\n') + '\n'
    },
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
