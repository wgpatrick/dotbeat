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
import { basename, dirname, join, resolve as pathResolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  parse,
  serialize,
  setValue,
  addNote,
  removeNote,
  addHit,
  removeHit,
  setAutomationPoint,
  applyAutomationShape,
  addEffect,
  removeEffect,
  moveEffect,
  setEffectEnabled,
  addAudioClip,
  splitAudioClip,
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
  defaultDrumKitLanes,
  diffDocuments,
  formatDiff,
  describeDocument,
  saveClip,
  setScene,
  placeClip,
  unplaceClip,
  formatNumber,
  renameScene,
  setSong,
  songMove,
  insertScene,
  parsePresetLibrary,
  applyPreset,
  formatPresetList,
  filterPresetsByCategory,
  PRESET_CATEGORIES,
  parseMacroLibrary,
  applyMacro,
  formatMacroList,
  parseDrumKitLibrary,
  applyDrumKit,
  formatDrumKitList,
  parseSelection,
  serializeSelection,
  selectionToVaryScope,
  setMediaSample,
  setLaneSample,
  clearLegacyLaneSamples,
  type BeatDocument,
  type BeatSlotsInput,
} from '../core/index.js'
import { decodeWav, analyze, lint, formatLint, RENDER_RUN_VARIANCE_META, buildProfile, serializeProfile, parseProfile } from '../metrics/index.js'
// --- Phase 37 Stream RB begin ---
import { analyzeStructure, formatStructure } from '../analysis/index.js'
// --- Phase 37 Stream RB end ---
// ==== Phase 38 Stream SA begin ====
import { validateAnalysisArtifact, buildSkeleton, formatSkeletonReport } from '../analysis/index.js'
// ==== Phase 38 Stream SA end ====
// ==== Phase 38 Stream SB begin ====
import { runAnalysis, sidecarDoctor } from '../analysis/index.js'
// ==== Phase 38 Stream SB end ====
// ==== Phase 40 Stream VA ====
// Pitch-aware sampling (docs/phase-40-plan.md §VA). Pure TS, no Python (decisions.md D20).
import { detectPitch, formatPartials, formatPitchLine, PITCH_CONFIDENCE_MEDIUM, type PitchDetection } from '../analysis/index.js'
import { buildKeymap, noteToMidi, midiToNote, rateForPitch } from '../core/keymap.js'
// ==== end Phase 40 Stream VA ====
import { checkpoint, history, collapsedHistory, restore, pin, unpin, pins } from '../history/index.js'
import { suggestNext, parseScoresLog } from '../vary/suggest.js'
import { varyTrack, varyFeel, varyAutomation, VARY_GROUPS } from '../vary/vary.js'
import { AUTOMATION_SHAPES } from '../core/automation-shape.js'
import {
  writeVaryBatch,
  renderVaryBatch,
  scoreBatch,
  formatScoreResult,
  adoptVariant,
  formatAdoptResult,
  defaultBatchDir,
  defaultScoresLog,
  DEFAULT_SCORES_LOG,
} from '../vary/batch.js'
import { stitchAudition, formatAuditionIndex } from '../vary/audition.js'

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

// ==== Phase 40 Stream VA ====
/** Decodes a REGISTERED sample's audio — the MCP twin of the CLI's readSampleAudio. */
function readSampleAudioMcp(file: string, doc: BeatDocument, sampleId: string): { path: string; channels: Float64Array[]; sampleRate: number } {
  const entry = doc.media.find((m) => m.id === sampleId)
  if (!entry) throw new Error(`no sample "${sampleId}" in the media block (have: ${doc.media.map((m) => m.id).join(', ') || 'none'}) — register it with beat_sample first`)
  const beatDir = dirname(pathResolve(file))
  const abs = pathResolve(beatDir, entry.path)
  if (!existsSync(abs)) throw new Error(`sample "${sampleId}" is registered at ${entry.path}, but there is no file there (relative to ${beatDir})`)
  const { channels, sampleRate } = decodeWav(readFileSync(abs))
  return { path: entry.path, channels, sampleRate }
}

/** The low-confidence refusal, in MCP terms. Deliberately NOT the CLI's string: an agent calling a
 * tool needs the ARGUMENT to add (`root: "a6"`), not a shell line to paste. Same contract though —
 * quote the measured confidence and the whole partial table, and name the one-argument fix, because
 * a wrong keymap is worse than none and a bare "low confidence" leaves the caller stuck. */
function pitchRefusalMcp(what: string, pitch: PitchDetection, fix: string): string {
  return [
    `pitch detection is not confident enough to ${what} — refusing rather than building a wrong tuning.`,
    '',
    formatPitchLine(pitch),
    '',
    `partials (measured over the body, ${pitch.analyzedFromSeconds.toFixed(3)}-${pitch.analyzedToSeconds.toFixed(3)}s of ${pitch.durationSeconds.toFixed(2)}s):`,
    formatPartials(pitch.partials),
    '',
    pitch.suggestedRootNote
      ? `The lowest strong partial is ${pitch.suggestedRootHz!.toFixed(1)} Hz = ${pitch.suggestedRootNote}, which is usually where a struck sound's perceived pitch sits. Read the table, decide the root, and ${fix} (e.g. "${pitch.suggestedRootNote}") — stating the root is a first-class path, not a workaround: bells, plucks and found percussion are exactly where detection is weakest.`
      : `Read the table and ${fix}.`,
    `Or pass force: true to accept the ${pitch.level}-confidence detection above as-is.`,
  ].join('\n')
}
// ==== end Phase 40 Stream VA ====

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

/** v0.11 (Phase 36 PB): the wire shape of a scene's slot map — per track, either a bare clip id
 * (one placement at step 0, the pre-v0.11 shape) or an explicit placement list. Normalized here
 * (at defaults to 0, liberal in) and handed straight to core's setScene, which owns ALL the
 * validation (clip-exists, audio-only-for-v1, overlap) — same call the CLI's `beat scene` makes. */
type SlotsArg = Record<string, string | { clip: string; at?: number }[]>
const normalizeSlotsArg = (slots: SlotsArg): BeatSlotsInput =>
  Object.fromEntries(
    Object.entries(slots).map(([track, entry]) => [
      track,
      typeof entry === 'string' ? entry : entry.map((p) => ({ clip: String(p.clip), at: p.at === undefined ? 0 : Number(p.at) })),
    ]),
  )

/** The JSON schema fragment for a slot map, shared by beat_scene and beat_song's scenes arg. */
const SLOTS_SCHEMA = {
  type: 'object',
  additionalProperties: {
    oneOf: [
      { type: 'string', description: 'a clip id — one placement at step 0 (the pre-v0.11 shape, still canonical for “the clip plays at the section start”)' },
      {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            clip: { type: 'string' },
            at: { type: 'number', description: 'fractional 16th steps from the section start; default 0' },
          },
          required: ['clip'],
        },
        description: 'explicit placement list (v0.11) — the same clip may appear more than once at different at offsets',
      },
    ],
  },
  description:
    'track id -> clip id, or track id -> [{clip, at}] placements. Multiple placements / at > 0 are AUDIO tracks only for v1 — synth/drum clips tile from the section start (anything else is a validation error).',
} as const

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
      'Add a new track (synth, drums, instrument, or audio) to a .beat file with the format init patch — the way an agent builds a project up from beat_init. A fresh drums track defaults to the full 12-lane GM-aligned kit (kick/snare/rimshot/clap/hat/openhat/tom_lo/tom_mid/tom_hi/crash/ride/cowbell), matching the CLI\'s own `beat add-track ... drums` default (there is no legacy-5-lane opt-out over MCP). A fresh synth or drums track also starts with a real, already-populated default effect chain — eq3 -> comp -> distortion -> bitcrush, all enabled — not an empty one; see beat_effect_add/beat_effect_rm to change it. An instrument track is a sampled SF2 voice: pass soundfont_sample (a media id already registered via beat_sample) and optionally soundfont_program (the SF2 program number, default 0) — see beat_inspect on an instrument track for the bank\'s full preset list. An audio track (format v0.10, Phase 22 Stream AE) starts with no clips — add audio-region clips afterward with beat_audio_clip. Returns the edit list.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        id: { type: 'string', description: 'single alphanumeric token, e.g. "bass"' },
        kind: { type: 'string', enum: ['synth', 'drums', 'instrument', 'audio'] },
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
      const kind = str(args, 'kind') as 'synth' | 'drums' | 'instrument' | 'audio'
      const { doc } = addTrack(before, {
        id: str(args, 'id'),
        kind,
        ...(typeof args.name === 'string' ? { name: args.name } : {}),
        ...(typeof args.color === 'string' ? { color: args.color } : {}),
        ...(kind === 'instrument' ? { soundfont: { sample: str(args, 'soundfont_sample'), program: typeof args.soundfont_program === 'number' ? args.soundfont_program : 0 } } : {}),
        // Phase 33 Stream MB: the CLI's own `add-track` defaults a fresh drums track to the real
        // 12-lane kit (defaultDrumKitLanes()) unless --legacy-lanes is passed; this handler used to
        // omit `lanes` entirely, silently falling back to the old implicit 5-lane shape with no way
        // to opt in (research/95's headline finding). Match the CLI's default here — MCP has no
        // legacy-lanes escape hatch, since nothing over MCP asked for the old behavior.
        ...(kind === 'drums' ? { lanes: defaultDrumKitLanes() } : {}),
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
  // --- Phase 37 Stream RB begin ---
  {
    name: 'beat_analyze_structure',
    description:
      'Read-only SYMBOLIC analysis of a .beat song\'s arrangement — no rendering, no audio. Complements beat_metrics (which measures a rendered WAV): this reads what\'s written. Per song section it reports onset density (onsets/bar, tiling each clip across the section), syncopation (fraction of onsets off the quarter grid), and a 12-bin pitch-class histogram; across sections it reports pairwise self-similarity, exact repeats, and which sections are novel — the arrangement-level view (repetition vs variation, energy arc) the WAV metrics can\'t see. Pass root (0-11, 0=C) + scale (major/minor/dorian/phrygian/lydian/mixolydian/locrian/harmonicMinor/melodicMinor/majorPentatonic/minorPentatonic/blues) to get an in-scale fraction per section; omit both for scale-agnostic histograms. A loop-mode file (no song block) has no sections. Returns the human-readable structure view; pass json:true for the raw StructureAnalysis object.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'path to the .beat file' },
        root: { type: 'number', description: 'tonic pitch class 0-11 (0=C); only meaningful with scale' },
        scale: { type: 'string', description: 'scale name from core\'s SCALES table (major, minor, dorian, …); unknown names error' },
        json: { type: 'boolean', description: 'return the raw StructureAnalysis JSON instead of the formatted text view' },
      },
      required: ['file'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const doc = parse(readFileSync(file, 'utf8'))
      const root = typeof args.root === 'number' ? args.root : undefined
      const scale = typeof args.scale === 'string' && args.scale !== '' ? args.scale : undefined
      const analysis = analyzeStructure(doc, { root, scale })
      return args.json === true ? JSON.stringify(analysis, null, 2) : formatStructure(analysis)
    },
  },
  // --- Phase 37 Stream RB end ---
  // ==== Phase 38 Stream SB begin ====
  {
    name: 'beat_analyze_audio',
    description:
      "Detect the tempo, beats, downbeats, and sections of a real reference WAV via dotbeat's Python sidecar, and write a cached <audio>.analysis.json you can feed to beat_skeleton. This is the AUDIO importer (deliberately NOT beat_analyze_structure, which reads a .beat project's symbolic arrangement — this reads an external WAV file's waveform). Backends: 'beatthis' (default; Beat This — beats+downbeats, needs the owner-side Python venv), 'stub' (a deterministic 120-BPM no-dependency grid for testing/plumbing), 'allin1' (a heavy spike backend that also labels sections). The sidecar only runs where its Python deps are installed; without them it returns an actionable install hint. Result is cached by audio-bytes sha256 + backend — a second call returns the cache unless force is set. Pass doctor:true (with no file) to report which interpreter and backends are available. WAV input only this phase.",
    inputSchema: {
      type: 'object',
      properties: {
        // ==== Phase 39 Stream UA begin ==== (pilot 105: file is optional in the schema only because doctor omits it)
        file: { type: 'string', description: 'path to a reference audio .wav to analyze — REQUIRED unless doctor:true (doctor probes deps with no input file)' },
        // ==== Phase 39 Stream UA end ====
        backend: { type: 'string', description: "detection backend: 'beatthis' (default), 'stub' (deterministic, no deps), or 'allin1' (spike, adds labels)" },
        force: { type: 'boolean', description: 're-analyze even if a matching cached .analysis.json exists' },
        out: { type: 'string', description: 'output path for the analysis JSON (default: <audio>.analysis.json beside the input)' },
        json: { type: 'boolean', description: 'return the raw analysis artifact JSON instead of the formatted summary' },
        doctor: { type: 'boolean', description: 'report the resolved Python interpreter and which backends are installed (mutually exclusive with file)' },
      },
      required: [],
    },
    handler: async (args) => {
      if (args.doctor === true) {
        if (typeof args.file === 'string' && args.file !== '') throw new Error('doctor and file are mutually exclusive — pass one or the other')
        const report = await sidecarDoctor()
        return JSON.stringify(report, null, 2)
      }
      const file = str(args, 'file')
      const backend = typeof args.backend === 'string' && args.backend !== '' ? args.backend : 'beatthis'
      if (!['stub', 'beatthis', 'allin1'].includes(backend)) throw new Error(`unknown backend "${backend}" (one of: stub, beatthis, allin1)`)
      const out = typeof args.out === 'string' && args.out !== '' ? args.out : undefined
      const result = await runAnalysis({ audioPath: file, backend: backend as 'stub' | 'beatthis' | 'allin1', force: args.force === true, outPath: out })
      if (args.json === true) return JSON.stringify(result.artifact, null, 2)
      const a = result.artifact
      const lines = [
        `analyzed ${a.source.file} (backend ${a.backend.name}${a.backend.version ? ` ${a.backend.version}` : ''})`,
        `bpm ${Number(a.bpm).toFixed(2)} (${a.bpmMethod}) · ${a.beats.length} beats · ${a.downbeats.length} downbeats · ${a.sections.length} sections`,
        result.cached ? `using cached ${result.outPath} (pass force:true to re-analyze)` : `wrote ${result.outPath}`,
      ]
      return lines.join('\n')
    },
  },
  // ==== Phase 38 Stream SB end ====
  {
    name: 'beat_set',
    description:
      'Apply one or more surgical edits to a .beat file and write it back canonically. Paths use the file\'s own field names: "bpm", "loop_bars", "selected_track", "<track>.<param>", "<track>.name", "<track>.color", "<track>.pattern.<lane>[<step>]" (lanes: kick, snare, clap, hat, openhat), "<track>.shuffleAmount"/"<track>.shuffleGrid" (v0.10 groove — a reversible time-warp applied at playback, 0 amount = off), "<track>.note.<id>.chance" (0-100, v0.10 per-note trigger probability, default 100 = always fires), "<track>.note.<id>.cent" (-50..50, v0.10 per-note micro-tuning independent of pitch), "<track>.note.<id>.ratchetCount"/"ratchetCurve"/"ratchetLength" (v0.10 note ratchet/repeat — see beat_consolidate to bake a ratchet back into discrete notes). Params: the core 9 (osc, volume, cutoff, resonance, attack, decay, sustain, release, pan) plus the full v0.3 shaped surface — osc2Type/osc2Level/osc2Detune, subLevel, noiseLevel, fm*, unisonVoices/unisonWidth, filterType, filterEnv*, lfo*/lfo2*, glide, eq*, comp*, distortion*, bitcrush*, pingPong* (ping pong delay), beatRepeat* (grid/gate/chance/mode scheduling-layer stutter), chorus*/phaser* (per-track chorus-ensemble and phaser-flanger inserts), saturator* (curve/drive/mix), grainDelay* (time/feedback/size/pitch/mix — a hand-built granular pitch-shifting delay, Phase 23 Stream BF), vinyl* (drive/noiseLevel/tone/mix — WaveShaper harmonic saturation + a seeded, reproducible surface-noise/crackle bed), resonator* (freq/chord/q/mix — a bank of up to 5 tuned bandpass filters approximating physical resonance; chord is one of fifths|major|minor|octaves|harmonic), sendReverb/sendDelay, duckSource (a track id or "none") + duckAmount, and drum-voice shaping (kickTune/kickPunch/kickDecay, snareTone/snareDecay, hatTone/hatDecay/openHatDecay — LEGACY drums tracks only: a declared-lane drums track never plays these, edit its lanes instead). Declared drum lanes: "<track>.lane.<name>.<param>" edits one lane\'s own backing params — synth-backed lanes take that voice\'s params (tune/punch/decay for membrane, tone/decay for noise, decay/tone for metal), sample-backed lanes take start/length/attack/hold/decay/cutoff/resonance plus gainDb/tune; an empty value reverts a param to its default. Fields at their default are elided from the file. Returns the musical edit list of what changed.',
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
        velocity: { type: 'number', description: '0..1, NOT MIDI 0-127 (e.g. 0.8, not 100)' },
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
        velocity: { type: 'number', description: '0..1, NOT MIDI 0-127 (e.g. 0.9, not 110)' },
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
      'Add or move a clip automation point (format v0.9): a (time, value) point on a named synth param\'s automation lane within one clip. time is in fractional 16th steps from the CLIP\'s own start (v0.7 number rules); value is in the param\'s own units (Hz for cutoff, dB for volume, 0..1 for resonance-like params, etc.). param is any numeric synth field (the core 9 minus osc, plus the v0.3 shaped surface — see beat_set\'s description for the full list). Pass id to move an existing point (matched by id) instead of adding a new one; omit it to add a new point with a minted id. Phase 26 Stream DI: interpolation sets the segment-shape this point STARTS (toward the next point) — linear (default, elided), hold (step instantly to the next point\'s value at its time instead of ramping), or curve (an eased bow instead of a straight ramp); omit it on a move to leave the point\'s existing curve-shape untouched. Returns the musical edit list.',
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
        interpolation: { type: 'string', description: 'linear | hold | curve — the segment-shape this point starts; default linear; omit on a move to keep the existing shape' },
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
        ...(typeof args.interpolation === 'string' ? { interpolation: args.interpolation as 'linear' | 'hold' | 'curve' } : {}),
      })
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  // === Phase 37 Stream RC begin ===
  {
    name: 'beat_automate_shape',
    description:
      "Fill a clip's automation lane for one param with a predefined SHAPE (Phase 37 Stream RC — the \"Predefined automation shapes\" roadmap row made a generator): ramp = linear from->to; sine/triangle = `cycles` oscillations between from and to (each starts at from, rises to to, returns); exp = an eased (exponential) from->to curve; adsr = a fixed-proportion attack/decay/sustain/release envelope whose peak is to and floor is from. Emits `points` breakpoints (default 16) uniformly across the clip span, so points applies to every shape uniformly. The span (how many 16th steps the points spread across) is resolved: bars override -> the clip's own loop range -> an audio-region clip's length in seconds -> the document's loop_bars. This REPLACES any existing lane for that param on the clip (a shape is the whole lane, not an addition). param is gated exactly like beat_automate: a synth/drums/instrument clip automates any AUTOMATABLE_SYNTH_PARAM; an audio clip automates only 'gain'. Returns the musical edit list.",
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        clip: { type: 'string' },
        param: { type: 'string', description: 'a numeric synth param (cutoff, resonance, volume, pan, …) or "gain" on an audio clip' },
        shape: { type: 'string', description: AUTOMATION_SHAPES.join(' | ') },
        from: { type: 'number', description: "the shape's start value, in the param's own units" },
        to: { type: 'number', description: "the shape's target/peak value" },
        cycles: { type: 'number', description: 'sine/triangle only: oscillations across the span; default 1' },
        points: { type: 'number', description: 'breakpoints to emit, uniformly spaced; default 16, min 2' },
        bars: { type: 'number', description: 'explicit clip span in bars; overrides the clip loop / audio length / doc loop_bars' },
      },
      required: ['file', 'track', 'clip', 'param', 'shape', 'from', 'to'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc } = applyAutomationShape(before, str(args, 'track'), str(args, 'clip'), str(args, 'param'), str(args, 'shape') as never, {
        from: num(args, 'from'),
        to: num(args, 'to'),
        ...(typeof args.cycles === 'number' ? { cycles: args.cycles } : {}),
        ...(typeof args.points === 'number' ? { points: args.points } : {}),
        ...(typeof args.bars === 'number' ? { bars: args.bars } : {}),
      })
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  // === Phase 37 Stream RC end ===
  {
    name: 'beat_effect_add',
    description:
      "Add an insert to a synth track's effect chain (format v0.10). Array order in the file IS chain order — no separate index field — so this is dotbeat's answer to \"reorder/add/remove effects,\" built as flat ordered text rather than a box/pointer graph (docs/research/21-opendaw-devices-effects.md #1). type is one of eq3|comp|distortion|bitcrush|eq7|autoFilter|autoPan|tremolo|utility|grainDelay|vinylDistortion|resonator — the first four are the original built-in inserts every synth track already has knobs for (see beat_set's eqLow/compMix/distortionMix/bitcrushMix etc.); Phase 23 Stream BD added eq7, a 7-band parametric EQ (HP + low-shelf + 3 parametric bells + high-shelf + LP, each independently enabled via its own eq7*On field); Phase 23 Stream BE added Auto Filter/Auto Pan/Tremolo/Utility (autoFilter*/autoPan*/tremolo*/utility* params — Redux's downsampling half rides bitcrushRate on the existing bitcrush type, not a new one); Phase 23 Stream BF added three real custom-DSP inserts — a hand-built granular delay, WaveShaper+seeded-noise vinyl character, and a tuned bandpass-filter-bank resonator (see beat_set's grainDelay*/vinyl*/resonator* fields for their own params, docs/phase-23-stream-bf.md for design notes). This tool only changes whether/where/in-what-order a type runs in the chain, not its own params. Omit id to mint one (the type name, or type_2/_3... on collision); omit index to append. Returns the musical edit list.",
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        type: { type: 'string', description: 'eq3 | comp | distortion | bitcrush | eq7 | autoFilter | autoPan | tremolo | utility | grainDelay | vinylDistortion | resonator' },
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
    name: 'beat_audio_clip',
    description:
      'Create or replace an audio-region clip (format v0.10, Phase 22 Stream AE) on an \'audio\'-kind track: a clip whose entire content is a span of a content-addressed media file (register it first with `beat sample` — this tool does not read audio files itself). in/out are seconds into the SOURCE media (not timeline steps) — the span that plays. gain is the static clip level in dB (default 0). warp is off (native rate, the default), repitch (variable-speed playback — pitch moves with tempo, set rate to the playbackRate multiplier), or complex (a legal value with no implementation yet — behaves like off). rate only applies when warp=repitch and must be 1 otherwise. Upserts: an existing clip id\'s region is replaced. To trim an EXISTING clip\'s fields (e.g. a drag-handle gesture) use beat_set with path "<track>.clip.<clip_id>.audio.<field>" (field one of media, in, out, gainDb, warp, rate) instead of recreating the clip. Returns the musical edit list.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        clip: { type: 'string' },
        media: { type: 'string', description: 'a sample id already registered in the media block (beat_sample / `beat sample`)' },
        in: { type: 'number', description: 'in-point, seconds into the source media' },
        out: { type: 'number', description: 'out-point, seconds into the source media; must be > in' },
        gain_db: { type: 'number', description: 'static clip gain in dB; default 0' },
        warp: { type: 'string', enum: ['off', 'repitch', 'complex'], description: "default 'off'" },
        rate: { type: 'number', description: 'playbackRate multiplier; only when warp=repitch; default 1' },
      },
      required: ['file', 'track', 'clip', 'media', 'in', 'out'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const region: Parameters<typeof addAudioClip>[3] = { media: str(args, 'media'), in: num(args, 'in'), out: num(args, 'out') }
      if (args.gain_db !== undefined) region.gainDb = num(args, 'gain_db')
      if (typeof args.warp === 'string') region.warp = args.warp as 'off' | 'repitch' | 'complex'
      if (args.rate !== undefined) region.rate = num(args, 'rate')
      const { doc } = addAudioClip(before, str(args, 'track'), str(args, 'clip'), region)
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_audio_split',
    description:
      'Split-at-point (format v0.10, Phase 22 Stream AE, docs/research/16-audio-clip-editing.md §2): cuts one audio-region clip into two at a timeline position, no DSP. at is in fractional 16th steps from the CLIP\'s own start (the same unit note/hit start and automation point time already use). Both halves reference the same media with adjusted in/out points; gain-automation points partition by time (before the split stay on the first clip, at/after move to the second, retimed relative to its own new start). The first half keeps the original clip id; the second is auto-numbered ("<clip>-2", "<clip>-3", ...) unless new_clip_id is given. v0.11 (Phase 36): the second half is AUTO-PLACED right after the first (at parent placement + split offset) in every scene that placed the original — including multi-placement parents — so a split never orphans arrangement; the output reports each auto-placement. Returns the musical edit list.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        clip: { type: 'string' },
        at: { type: 'number', description: 'split position, fractional 16th steps from the clip\'s own start' },
        new_clip_id: { type: 'string', description: 'id for the second half; omit to auto-number' },
      },
      required: ['file', 'track', 'clip', 'at'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc, first, second, placements } = splitAudioClip(before, str(args, 'track'), str(args, 'clip'), num(args, 'at'), typeof args.new_clip_id === 'string' ? { newClipId: args.new_clip_id } : {})
      writeFileSync(file, serialize(doc))
      return (
        formatDiff(diffDocuments(before, doc)) +
        `split into "${first.id}" and "${second.id}"\n` +
        placements.map((p) => `auto-placed "${p.clip}" at ${formatNumber(p.at)} in scene "${p.sceneId}"\n`).join('')
      )
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
          description:
            'snapshot each track\'s CURRENT LIVE notes/pattern into a named clip. Always starts from whatever\'s live on the track right now, not empty — re-using this on the same track without clearing its live content first accumulates rather than resets (e.g. a "chorus" clip captured on top of still-present "verse" content becomes verse-plus-chorus)',
        },
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, slots: SLOTS_SCHEMA },
            required: ['id', 'slots'],
          },
          description: 'each scene maps track ids to clip ids (or, v0.11, to placement lists — see beat_scene)',
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
      for (const s of (args.scenes as { id: string; slots: SlotsArg }[] | undefined) ?? []) doc = setScene(doc, s.id, normalizeSlotsArg(s.slots))
      if (args.song !== undefined) doc = setSong(doc, args.song as { scene: string; bars: number }[])
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_scene',
    description:
      'Create or wholesale-replace ONE scene\'s slot map — the tool that MINTS a scene id (beat_place only edits scenes that already exist). Per track, slots takes either a bare clip id (one placement at step 0 — exactly the pre-v0.11 shape) or a placement list [{clip, at}] with at in fractional 16th steps from the section start (v0.11, Phase 36); the same clip may be placed more than once. v1 scope caveat: multi-placement and at > 0 are AUDIO tracks only for now — synth/drum clips tile from the section start, and placing them anywhere else is a validation error. Overlapping placements on one audio track (region length from in/out/rate and the document bpm) are an error too. Same core call as `beat scene`. Returns the musical edit list.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        id: { type: 'string', description: 'the scene id to create or replace (e.g. "s1")' },
        slots: SLOTS_SCHEMA,
      },
      required: ['file', 'id', 'slots'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      if (typeof args.slots !== 'object' || args.slots === null || Array.isArray(args.slots)) throw new Error('missing required object argument "slots"')
      const doc = setScene(before, str(args, 'id'), normalizeSlotsArg(args.slots as SlotsArg))
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_place',
    description:
      'Add ONE placement of an already-saved clip into an EXISTING scene (v0.11, Phase 36): the clip sounds at `at` fractional 16th steps from the section start. The scene must already exist — beat_scene (or beat_song\'s scenes arg) mints scenes; this tool edits one placement. v1 scope caveat: multi-placement and at > 0 are AUDIO tracks only for now — synth/drum clips tile from the section start. Placements that would overlap in time on one track are an error (fail-loudly). The same clip may be placed more than once at different offsets. Same core call as `beat place`. Returns the musical edit list.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        scene: { type: 'string', description: 'an EXISTING scene id' },
        track: { type: 'string' },
        clip: { type: 'string', description: 'a clip id that exists on that track' },
        at: { type: 'number', description: 'fractional 16th steps from the section start, >= 0' },
      },
      required: ['file', 'scene', 'track', 'clip', 'at'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc } = placeClip(before, str(args, 'scene'), str(args, 'track'), str(args, 'clip'), num(args, 'at'))
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_unplace',
    description:
      'Remove ONE placement of a clip from a scene\'s track slot (v0.11, Phase 36). `at` is optional when the clip is placed exactly once on that track; when it\'s placed more than once, `at` is REQUIRED to say which placement to remove — omitting it fails loudly and the error lists the candidate at values. Removing a track\'s last placement drops the track from the scene entirely. Same core call as `beat unplace`. Returns the musical edit list.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        scene: { type: 'string' },
        track: { type: 'string' },
        clip: { type: 'string' },
        at: { type: 'number', description: 'the placement\'s step offset; only required when the clip is placed more than once on that track' },
      },
      required: ['file', 'scene', 'track', 'clip'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc } = unplaceClip(before, str(args, 'scene'), str(args, 'track'), str(args, 'clip'), args.at === undefined ? undefined : num(args, 'at'))
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_scene_set',
    description:
      'Rename (or clear) a scene\'s display name. Named on the SCENE, not the section: a scene is dotbeat\'s unit of distinct musical content (e.g. "Part A"), and the same scene reused across multiple sections shows the same name in every section that reuses it. A slug-like token (letters/digits/_/-), like scene/track ids — pass name to set it, or omit name/pass an empty value to clear it back to showing just the id.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        id: { type: 'string', description: 'the scene id (e.g. "s1")' },
        name: { type: 'string', description: 'omit or pass "" to clear the name back to just the id' },
      },
      required: ['file', 'id'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const id = str(args, 'id')
      const name = typeof args.name === 'string' && args.name.length > 0 ? args.name : null
      const doc = renameScene(before, id, name)
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_song_move',
    description:
      'Reorder the arrangement timeline: move one song section to a new 0-based position (clamped to the list bounds). This IS the reorder primitive — a section\'s start bar is the sum of every earlier section\'s bars, not a stored offset, so moving one entry in the list is the whole operation. The resulting diff reports the reorder as a single musical fact (the whole song statement changing), not a delete+insert pair.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string' }, from_index: { type: 'number' }, to_index: { type: 'number' } },
      required: ['file', 'from_index', 'to_index'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc } = songMove(before, num(args, 'from_index'), num(args, 'to_index'))
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_song_insert',
    description:
      'Phase 26 ("Insert Scene"): insert a brand-new song section referencing a FRESHLY MINTED, EMPTY scene at a 0-based index (index === current section count appends). Unlike beat_song (which only ever references existing scenes, so a duplicated/appended section silently shares state with whatever else references that scene id), this scene has never appeared in the document before — editing its clips (via beat_song\'s clips/scenes args, or beat_place equivalents) can never bleed into any other section. Place clips into it afterward. The other half of this feature, Capture-and-Insert Scene (snapshot every track\'s current live content into the new scene instead of leaving it empty), is daemon/GUI-only for now — no CLI/MCP verb yet.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        index: { type: 'number', description: '0-based position to insert at; equal to the current section count to append' },
        bars: { type: 'number', description: 'length of the new section in bars (1-64)' },
      },
      required: ['file', 'index', 'bars'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      const { doc, sceneId } = insertScene(before, num(args, 'index'), num(args, 'bars'))
      writeFileSync(file, serialize(doc))
      return `${formatDiff(diffDocuments(before, doc))}\n(new scene: "${sceneId}")\n`
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
    name: 'beat_macro_list',
    description:
      'List the macro library: a macro is "a preset with a continuous input" (docs/research/27-macro-tooling-layer.md) — one named knob (0-100) that resolves to 2-4 real synth params moving together (e.g. "Filter Sweep" turns cutoff+resonance up together). Applying one writes plain resolved params into the file, exactly like a preset — no macro reference is ever stored. Use before beat_macro_apply to see what exists and which params each one targets.',
    inputSchema: { type: 'object', properties: {} },
    handler: () => {
      const macros = parseMacroLibrary(readFileSync(join(repoRoot, 'presets', 'macros.json'), 'utf8'))
      return formatMacroList(macros)
    },
  },
  {
    name: 'beat_macro_apply',
    description:
      'Apply a named macro to a track at a knob position (0-100) — resolves every target to a literal value and sets each exactly as beat_set would, returning the resulting edit list. min>max on a target is a deliberate inverted range (e.g. a decay that gets SHORTER as the knob rises), not an error. Use beat_macro_list to find a name first.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        macro: { type: 'string', description: 'a name from beat_macro_list, e.g. "filter-sweep"' },
        value: { type: 'number', description: 'knob position, 0..100' },
      },
      required: ['file', 'track', 'macro', 'value'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const macros = parseMacroLibrary(readFileSync(join(repoRoot, 'presets', 'macros.json'), 'utf8'))
      const name = str(args, 'macro')
      const macro = macros.find((m) => m.name === name)
      if (!macro) throw new Error(`no macro "${name}" (have: ${macros.map((m) => m.name).join(', ')})`)
      const before = parse(readFileSync(file, 'utf8'))
      const doc = applyMacro(before, str(args, 'track'), macro, num(args, 'value'))
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
    name: 'beat_sample',
    description:
      'Register a media file (WAV or SF2) in a .beat project\'s media block under a stable sample id — the prerequisite for sample-backed drum lanes (beat_lane), instrument tracks (beat_add_track\'s soundfont_sample), and audio-region clips (beat_audio_clip\'s media). Computes the sha256 content hash for you and stores the path RELATIVE TO THE .BEAT FILE (the path argument is resolved against the .beat file\'s own directory, not the server\'s working directory — put the audio next to the project first, e.g. in a media/ folder beside it). Registering an existing id updates it. Same semantics as `beat sample`. Returns the edit list plus the computed hash.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        sample_id: { type: 'string', description: 'a stable id for this media, e.g. "smp_kick" or "muldjordkit"' },
        path: { type: 'string', description: 'path to the audio file, RELATIVE to the .beat file (e.g. "media/kick.wav")' },
      },
      required: ['file', 'sample_id', 'path'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const id = str(args, 'sample_id')
      const samplePath = str(args, 'path')
      const beatDir = dirname(pathResolve(file))
      const abs = pathResolve(beatDir, samplePath)
      if (!existsSync(abs)) throw new Error(`no file at ${samplePath} (relative to ${beatDir}) — put the audio next to the project first`)
      const sha256 = createHash('sha256').update(readFileSync(abs)).digest('hex')
      const before = parse(readFileSync(file, 'utf8'))
      const doc = setMediaSample(before, id, sha256, samplePath.replace(/\\/g, '/'))
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc)) + `registered ${id}: sha256:${sha256.slice(0, 12)}... ${samplePath}\n`
    },
  },
  // ==== Phase 37 Stream RD begin ====
  {
    name: 'beat_source_search',
    description:
      'Find real, redistributable sounds on Freesound to bring into a project, HARD-FILTERED to Creative Commons 0 (public domain — the only license safe to ship inside a user\'s MIT .beat project; no other license is ever returned). Top-rated first. This is the DISCOVERY step: it returns candidate ids/names/durations/ratings; register a chosen one with beat_source_add (freesound_id). GATED: needs a FREESOUND_API_KEY in the server environment AND network egress to freesound.org — if either is missing it returns an actionable isError telling you which (no stack trace). To ingest audio you already have instead of searching, use beat_source_add with audio_file (no key/network needed).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'what to search for, e.g. "vinyl crackle" or "808 kick"' },
        max: { type: 'number', description: 'max results to return (default 10)' },
        dur_min: { type: 'number', description: 'minimum duration in seconds (default 0.05)' },
        dur_max: { type: 'number', description: 'maximum duration in seconds (default 5)' },
        out_dir: { type: 'string', description: 'optional: also download each result\'s HQ preview into this dir for auditioning (needs egress)' },
      },
      required: ['query'],
    },
    handler: async (args) => {
      const lib = await import(pathToFileURL(join(repoRoot, 'scripts', 'source-lib.mjs')).href)
      const query = str(args, 'query')
      const { total, results } = await lib.freesoundSearchCC0({
        query,
        max: typeof args.max === 'number' ? args.max : 10,
        durMin: typeof args.dur_min === 'number' ? args.dur_min : 0.05,
        durMax: typeof args.dur_max === 'number' ? args.dur_max : 5,
      })
      let out = `${total} CC0 result${total === 1 ? '' : 's'} for "${query}" — top ${results.length} by rating:\n`
      for (const r of results as { id: number; name: string; by: string; duration: number; rating: number | null; url: string }[]) {
        out += `  #${r.id}  ${r.name} by ${r.by}  (${Number(r.duration).toFixed(2)}s, rating ${r.rating ?? 'n/a'})  ${r.url}\n`
      }
      if (typeof args.out_dir === 'string' && args.out_dir !== '') {
        const saved = await lib.downloadPreviews({ results, outDir: args.out_dir })
        out += `downloaded ${saved.length} preview${saved.length === 1 ? '' : 's'} into ${args.out_dir}/ for auditioning\n`
      }
      out += `register one with beat_source_add (freesound_id)\n`
      return out
    },
  },
  {
    name: 'beat_source_add',
    description:
      'Ingest a real sound into a .beat project as registered media, prepped through the same trim/fade/peak-normalize pipeline as every bundled one-shot, and write an ENFORCED provenance sidecar (media/<id>.wav.json with source, license, sha256, preparedAt). Two paths: (1) OFFLINE (always available, no key/network) — pass audio_file, a path to audio you already have; its license defaults to "unspecified" (you assert the real license via the license argument — we never guess it). (2) GATED — pass freesound_id (from beat_source_search) to fetch a specific CC0 sound from Freesound and register it with the "CC0-1.0" label; needs FREESOUND_API_KEY + egress, and returns an actionable isError if either is missing. The "CC0-1.0" label is applied ONLY on the Freesound path. Once registered, use the sample id in beat_audio_clip / beat_lane / beat_add_track just like a beat_sample id.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'the .beat project file' },
        sample_id: { type: 'string', description: 'a stable media id, e.g. "smp_crackle"' },
        audio_file: { type: 'string', description: 'OFFLINE path: a local audio file to prep and ingest' },
        freesound_id: { type: 'string', description: 'GATED path: a Freesound sound id (from beat_source_search) — mutually exclusive with audio_file' },
        license: { type: 'string', description: 'offline path only: the license you assert for this file (default "unspecified"); ignored on the Freesound path, which is always CC0-1.0' },
        note: { type: 'string', description: 'optional human note recorded in the provenance sidecar' },
      },
      required: ['file', 'sample_id'],
    },
    handler: async (args) => {
      const lib = await import(pathToFileURL(join(repoRoot, 'scripts', 'source-lib.mjs')).href)
      const file = str(args, 'file')
      const id = str(args, 'sample_id')
      const note = typeof args.note === 'string' ? args.note : undefined
      const freesoundId = typeof args.freesound_id === 'string' && args.freesound_id !== '' ? args.freesound_id : undefined
      const result = freesoundId !== undefined
        ? await lib.addFreesoundSource({ beatFile: file, id, freesoundId, note })
        : await lib.addLocalSource({ beatFile: file, id, audioFile: typeof args.audio_file === 'string' ? args.audio_file : undefined, license: typeof args.license === 'string' ? args.license : 'unspecified', note })
      // Pilot 104 minor: re-registering an existing id silently replaced it. Say so explicitly.
      const reregisterNote = result.reregistered
        ? result.reregistered.changed
          ? `note: re-registered ${result.id} (replaced sha256:${result.reregistered.previousSha256.slice(0, 7)}... -> ${result.sha256.slice(0, 7)}...)\n`
          : `note: ${result.id} already registered (unchanged)\n`
        : ''
      return (
        `registered ${result.id}: sha256:${result.sha256.slice(0, 12)}... ${result.relPath} ` +
        `(${result.durationSeconds}s, license ${result.license})\nprovenance sidecar: ${result.relPath}.json\n` +
        reregisterNote
      )
    },
  },
  // ==== Phase 37 Stream RD end ====
  // ==== Phase 39 Stream UB begin ====
  {
    name: 'beat_source_gen',
    description:
      'GENERATE an audio one-shot from a text prompt with Stable Audio Open (local text-to-audio) and register it into a .beat project as media, prepped through the same trim/fade/peak-normalize pipeline as every other source and written with an ENFORCED provenance sidecar (media/<id>.wav.json recording the prompt, provider, model, seconds, seed, and the Stability AI Community License). Two backends: "stableaudio" (default) runs Stable Audio Open locally — needs torch + the model weights installed server-side (see python/README.md), and returns an actionable isError with a `beat source gen --doctor` hint if they are missing; "stub" is a deterministic, dependency-free tone bed (same seed+seconds → byte-identical audio) that proves the pipeline everywhere. You OWN the generated output; free commercial use under $1M revenue with Stability registration; "Powered by Stability AI". Once registered, use the sample id in beat_audio_clip / beat_lane / beat_add_track just like any media id.' +
      // ==== Phase 40 Stream VB ====
      ' BATCH MODE — pass `count` to generate N candidates of the same prompt across seeds seed_from..seed_from+N-1 and register NOTHING: they land in a batch dir (gen-<sample_id>-<seed>/ next to the .beat) with a manifest beat_score and beat_adopt read, exactly like a beat_vary batch. This is the right shape whenever you want to hear a few takes before committing to one: rank them with beat_score, then beat_adopt registers the WINNER ALONE (that adopt IS the registration — it copies the winning wav into media/ and writes its provenance sidecar). Candidates you do not adopt never touch the project, so the media block never accumulates rejects. Candidates are already audio, so `audition: true` stitches them into one audition.wav with a timecode index immediately — no render step. Without `count`, the single-shot behavior above is unchanged (generate and register in one step).',
      // ==== end Phase 40 Stream VB ====
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'the .beat project file' },
        sample_id: { type: 'string', description: 'a stable media id, e.g. "gen_pad"' },
        prompt: { type: 'string', description: 'the text prompt to generate from, e.g. "warm analog pad" or "punchy 808 kick"' },
        seconds: { type: 'number', description: 'clip length in seconds (default 2; Stable Audio Open caps ~47)' },
        seed: { type: 'number', description: 'integer seed for reproducible generation (default 0); recorded in the provenance sidecar' },
        backend: { type: 'string', description: '"stableaudio" (default, local model) or "stub" (deterministic dependency-free tone bed)' },
        provider: { type: 'string', description: 'provider label recorded in provenance (default "stable-audio-open")' },
        license: { type: 'string', description: 'license label for the generated media (default "Stability-AI-Community")' },
        // ==== Phase 40 Stream VB ====
        count: { type: 'number', description: 'BATCH MODE: generate this many candidates (1-16) of the same prompt, one per seed, and register NONE of them — score/adopt picks the winner. Omit for the single-shot generate-and-register behavior.' },
        seed_from: { type: 'number', description: 'batch mode: the FIRST seed (candidate i gets seed_from + i); defaults to the prompt-derived seed, same as `seed` does for a single shot' },
        out_dir: { type: 'string', description: 'batch mode: where the candidates + manifest.json go; default "gen-<sample_id>-<seed_from>" NEXT TO the .beat file (not the server cwd)' },
        audition: { type: 'boolean', description: 'batch mode: also stitch the candidates into one audition.wav with a timecode index (they are already audio — no render step)' },
        // ==== end Phase 40 Stream VB ====
      },
      required: ['file', 'sample_id', 'prompt'],
    },
    handler: async (args) => {
      const lib = await import(pathToFileURL(join(repoRoot, 'scripts', 'source-lib.mjs')).href)
      // ==== Phase 40 Stream VB ====
      if (typeof args.count === 'number') {
        const result = await lib.genSourceBatch({
          beatFile: str(args, 'file'),
          id: str(args, 'sample_id'),
          prompt: str(args, 'prompt'),
          count: args.count,
          seconds: typeof args.seconds === 'number' ? args.seconds : 2,
          ...(typeof args.seed_from === 'number' ? { seedFrom: args.seed_from } : typeof args.seed === 'number' ? { seedFrom: args.seed } : {}),
          backend: typeof args.backend === 'string' ? args.backend : 'stableaudio',
          provider: typeof args.provider === 'string' ? args.provider : 'stable-audio-open',
          ...(typeof args.license === 'string' ? { license: args.license } : {}),
          ...(typeof args.out_dir === 'string' ? { outDir: args.out_dir } : {}),
        })
        const last = result.seedFrom + result.candidates.length - 1
        const lines = [
          `${result.dir}/: ${result.candidates.length} candidate${result.candidates.length === 1 ? '' : 's'} of "${str(args, 'prompt')}" (seeds ${result.seedFrom}${last !== result.seedFrom ? `-${last}` : ''})`,
          ...result.candidates.map((c: { variant: string; seed: number; durationSeconds: number; sha256: string }) =>
            `  ${c.variant}: seed ${c.seed}, ${c.durationSeconds}s, sha256:${c.sha256.slice(0, 12)}...`),
          `nothing is registered in ${str(args, 'file')} yet: candidates live only in the batch dir until you adopt one`,
        ]
        if (args.audition === true) lines.push(formatAuditionIndex(stitchAudition(result.dir, result.candidates.length, { shuffleSeed: result.seedFrom })).trimEnd())
        lines.push(`audition, then: beat_score dir "${result.dir}" picks [best, ...]`)
        lines.push(`then register the winner: beat_adopt dir "${result.dir}" pick "<best>"`)
        return lines.join('\n') + '\n'
      }
      // ==== end Phase 40 Stream VB ====
      const result = await lib.addGeneratedSource({
        beatFile: str(args, 'file'),
        id: str(args, 'sample_id'),
        prompt: str(args, 'prompt'),
        seconds: typeof args.seconds === 'number' ? args.seconds : 2,
        ...(typeof args.seed === 'number' ? { seed: args.seed } : {}),
        backend: typeof args.backend === 'string' ? args.backend : 'stableaudio',
        provider: typeof args.provider === 'string' ? args.provider : 'stable-audio-open',
        ...(typeof args.license === 'string' ? { license: args.license } : {}),
      })
      const reregisterNote = result.reregistered
        ? result.reregistered.changed
          ? `note: re-registered ${result.id} (replaced sha256:${result.reregistered.previousSha256.slice(0, 7)}... -> ${result.sha256.slice(0, 7)}...)\n`
          : `note: ${result.id} already registered (unchanged)\n`
        : ''
      return (
        `registered ${result.id}: sha256:${result.sha256.slice(0, 12)}... ${result.relPath} ` +
        `(${result.durationSeconds}s, license ${result.license})\nprovenance sidecar: ${result.relPath}.json\n` +
        reregisterNote
      )
    },
  },
  // ==== Phase 39 Stream UB end ====
  // ==== Phase 40 Stream VC ====
  {
    name: 'beat_regen',
    description:
      "REBUILD a project's generated media from its provenance sidecars alone. Every `beat source gen` writes media/<id>.wav.json recording the exact prompt/seed/seconds/backend it used, so a fully-generated project is a RECIPE: clone it with an empty media/, call this, and the sounds come back. Use verify:true to regenerate into a temp dir and report per-sample sha256 match/differ WITHOUT modifying media/ (the honest check that a project is still reproducible); omit it to actually restore media/. SLOW — roughly 2 minutes per one-shot on CPU, so a 10-sample project is ~20 minutes; the count and estimate are reported before the run. IMPORTANT and not a bug: byte-identical regeneration is verified same-machine/same-torch only, so a \"differs\" result on a different machine (or after a torch upgrade) is EXPECTED — the sound was generated from the same recipe, it is not corrupted, and in restore mode it is written anyway. Media that was NOT generated (Freesound downloads, local file ingests) carries no recipe and is skipped by name. Use sample_id to do a single sound.",
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'the .beat project file (its media/ dir is read for provenance sidecars)' },
        verify: { type: 'boolean', description: 'regenerate to a temp dir and report sha256 match/differ without touching media/ (default false = restore media/)' },
        sample_id: { type: 'string', description: 'regenerate only this sample id (default: every generated sample in the project)' },
      },
      required: ['file'],
    },
    handler: async (args) => {
      const { planRegen, runRegen, formatRegenPlan, formatRegenResults } = await import('../analysis/index.js')
      const verify = args.verify === true
      const id = typeof args.sample_id === 'string' ? args.sample_id : undefined
      const file = str(args, 'file')
      // The plan banner (count + cost estimate) leads the result, mirroring the CLI: an agent should
      // learn what a full run costs from the same text a human does.
      const plan = planRegen(file, { id })
      if (plan.regenerable.length === 0) {
        return formatRegenPlan(plan, verify) + '\nnothing to regenerate — no generated media in this project\n'
      }
      const res = await runRegen({ beatFile: file, id, verify })
      return formatRegenPlan(plan, verify) + '\n' + formatRegenResults(res) + '\n'
    },
  },
  // ==== end Phase 40 Stream VC ====
  // ==== Phase 38 Stream SA begin ====
  {
    name: 'beat_skeleton',
    description:
      'Scaffold a NEW, structure-matched EMPTY .beat project from a *.analysis.json artifact (produced by beat analyze / beat_analyze_audio from a reference audio file). Reads the detected tempo/downbeats/sections, and writes an empty project whose song block matches the detected arrangement: one empty scene per distinct section label (all "chorus" sections share a single chorus scene; unlabeled sections each get their own section-<n> scene), each section converted from seconds to bars (a section longer than 64 bars becomes repeated plays of its scene). A labelless artifact falls back to uniform section_bars-sized chunks (default 8). REFUSES to overwrite an existing out_file. The reference audio itself is never registered as media — only the analysis JSON of numbers/labels is used. After scaffolding, fill the empty scenes with beat_clip / beat_place. Returns the tempo and a section table (index, scene, bars, source start-seconds).',
    inputSchema: {
      type: 'object',
      properties: {
        out_file: { type: 'string', description: 'the .beat project to create (must not already exist); alias: out' },
        analysis_file: { type: 'string', description: 'path to a *.analysis.json artifact from beat_analyze_audio; alias: analysis' },
        section_bars: { type: 'number', description: 'uniform chunk size (bars) for the labelless fallback; default 8, integer 1-64' },
        // ==== Phase 39 Stream UA begin ==== (pilot 105: accept the natural-guess arg names too)
        out: { type: 'string', description: 'alias for out_file' },
        analysis: { type: 'string', description: 'alias for analysis_file' },
        // ==== Phase 39 Stream UA end ====
      },
      // out_file/analysis_file are logically required, but each accepts an alias, so presence is
      // enforced in-handler (like beat_analyze_audio's file) rather than by this advisory list.
      required: [],
    },
    handler: (args) => {
      // ==== Phase 39 Stream UA begin ==== (pilot 105: read out_file OR out, analysis_file OR analysis)
      const strAlias = (primary: string, alias: string): string => {
        const v = args[primary] ?? args[alias]
        if (typeof v !== 'string' || v === '') throw new Error(`missing required string argument "${primary}" (alias: "${alias}")`)
        return v
      }
      const outFile = strAlias('out_file', 'out')
      const analysisFile = strAlias('analysis_file', 'analysis')
      // ==== Phase 39 Stream UA end ====
      if (existsSync(outFile)) throw new Error(`${outFile} already exists — refusing to overwrite (skeleton scaffolds a NEW project; delete it or choose another path)`)
      if (!existsSync(analysisFile)) throw new Error(`no analysis file at ${analysisFile} — produce one with beat_analyze_audio first`)
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(analysisFile, 'utf8'))
      } catch (e) {
        throw new Error(`${analysisFile} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
      }
      const artifact = validateAnalysisArtifact(raw)
      const { doc, report } = buildSkeleton(artifact, typeof args.section_bars === 'number' ? { sectionBars: args.section_bars } : {})
      writeFileSync(outFile, serialize(doc))
      return formatSkeletonReport(report, outFile)
    },
  },
  // ==== Phase 38 Stream SA end ====
  // ==== Phase 40 Stream VA ====
  {
    name: 'beat_sample_info',
    description:
      'What IS this registered sample: its detected PITCH (fundamental in Hz, note name, cents off, fractional MIDI), a confidence read, duration/peak/centroid, and — the part to actually read — the TOP-PARTIALS TABLE (frequency, level relative to the strongest, and ratio to the lowest strong partial). Pure TS: no Python, no venv, works everywhere. dotbeat can play a sample at a tune offset but had no idea what pitch a sample IS; this is that missing middle, and it is what beat_keymap roots a pitch-map on. READ THE TABLE, NOT JUST THE f0: two strong partials a semitone apart (ratio ~1.06) will beat against each other into an unsteady, detuned ring — that reading alone is what decided the recipe-song\'s bell choice; a ratio like 1.80 means an inharmonic clang whose "pitch" is a judgement call. LOW confidence is a real, useful answer rather than a failure — bells, plucks and found percussion usually read low, because their perceived pitch can be a strike tone that is not in the spectrum at all. When it does, use the table to pick a root yourself and pass it to beat_keymap as `root`.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'the .beat project file' },
        sample_id: { type: 'string', description: 'a media id already in the project (register with beat_sample)' },
        partials: { type: 'number', description: 'how many partials the table carries (default 8)' },
      },
      required: ['file', 'sample_id'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const sampleId = str(args, 'sample_id')
      const doc = parse(readFileSync(file, 'utf8'))
      const { path, channels, sampleRate } = readSampleAudioMcp(file, doc, sampleId)
      const pitch = detectPitch(channels, sampleRate, typeof args.partials === 'number' ? { partialCount: args.partials } : {})
      const m = analyze(channels, sampleRate)
      const out = [
        `${sampleId}: ${m.durationSeconds.toFixed(2)}s, ${m.channels}ch @ ${m.sampleRate} Hz  ${path}`,
        formatPitchLine(pitch),
        `peak       ${m.samplePeakDbfs.toFixed(1)} dBFS sample, ${m.truePeakDbtp.toFixed(1)} dBTP true`,
        `centroid   ${m.spectral.centroidHz.toFixed(0)} Hz`,
        '',
        `partials (measured over the body, ${pitch.analyzedFromSeconds.toFixed(3)}-${pitch.analyzedToSeconds.toFixed(3)}s of ${pitch.durationSeconds.toFixed(2)}s):`,
        formatPartials(pitch.partials),
      ]
      const beating = pitch.partials.find((q) => q.relDb >= -6 && Math.abs(1200 * Math.log2(q.ratio)) > 20 && Math.abs(1200 * Math.log2(q.ratio)) < 250)
      if (beating) {
        out.push('', `note: two strong partials sit ${Math.abs(1200 * Math.log2(beating.ratio)).toFixed(0)} cents apart (x${beating.ratio.toFixed(3)}) — this close, they beat against each other: an unsteady, detuned ring rather than one clear pitch.`)
      }
      if (pitch.level === 'low' && pitch.suggestedRootNote) {
        out.push('', `LOW confidence is a real answer here, not a failure. Read the table and decide the root yourself, then pass it to beat_keymap as root: "${pitch.suggestedRootNote}" (the lowest strong partial).`)
      }
      return out.join('\n')
    },
  },
  {
    name: 'beat_keymap',
    description:
      'Pitch-map ONE sample across a scale: mints one declared drum lane per scale degree, named by note (a5, c6, …), each backed by the same sample with the `tune` that lands it on that pitch — a melodic instrument out of a single one-shot, in one call, whose output is still just N diffable lines of text. The tunes are computed from the sample\'s DETECTED fundamental, so they are right even when the sound came back between notes (fractional tunes are normal and correct, not an error). Pass `root` to STATE the sample\'s pitch instead of detecting it — a first-class path, not a fallback: bells, plucks and found percussion are exactly where detection is weakest, so expect to use it (get a root from beat_sample_info\'s partial table). REFUSES on a low-confidence detection, quoting the partials and a suggested root, rather than minting a wrong tuning; force: true accepts the detection anyway. Existing lanes of the same name are re-backed in place, so re-running with a better root is safe and keeps any hits. A lane\'s tune is limited to -24..24 semitones, so a span more than two octaves from the root is refused, naming what IS reachable. Scales: the same vocabulary as beat_fit_scale.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'the .beat project file' },
        track: { type: 'string', description: 'a drums track id (lanes live on drum tracks)' },
        sample_id: { type: 'string', description: 'a media id already in the project' },
        scale: { type: 'string', description: `scale name — one of: ${SCALE_NAMES.join(', ')}` },
        from: { type: 'string', description: 'lowest note of the span, scientific pitch e.g. "a5" (c4 = middle C)' },
        to: { type: 'string', description: 'highest note of the span, e.g. "a6"' },
        root: { type: 'string', description: 'the SAMPLE\'s own pitch, e.g. "a6" — states the root instead of detecting it' },
        key: { type: 'string', description: 'the scale\'s root note or pitch class, e.g. "a" or "a4" (default: from\'s pitch class)' },
        gain_db: { type: 'number', description: 'lane gain in dB for every minted lane (default 0)' },
        force: { type: 'boolean', description: 'build on a low-confidence detection anyway' },
        dry_run: { type: 'boolean', description: 'report the lanes without writing the file' },
      },
      required: ['file', 'track', 'sample_id', 'scale', 'from', 'to'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const track = str(args, 'track')
      const sampleId = str(args, 'sample_id')
      const scale = str(args, 'scale')
      const fromMidi = noteToMidi(str(args, 'from'))
      const toMidi = noteToMidi(str(args, 'to'))
      const keyArg = typeof args.key === 'string' ? args.key : undefined
      const scaleRootMidi = keyArg === undefined ? fromMidi : noteToMidi(/^[a-gA-G][#sb]?$/.test(keyArg) ? `${keyArg}4` : keyArg)
      const gainDb = typeof args.gain_db === 'number' ? args.gain_db : 0
      const before = parse(readFileSync(file, 'utf8'))

      let rootMidi: number
      let rootSource: string
      if (typeof args.root === 'string' && args.root !== '') {
        rootMidi = noteToMidi(args.root)
        rootSource = `root ${args.root} (stated, not detected)`
      } else {
        const { channels, sampleRate } = readSampleAudioMcp(file, before, sampleId)
        const pitch = detectPitch(channels, sampleRate)
        if (pitch.hz === null || pitch.midi === null || (pitch.confidence < PITCH_CONFIDENCE_MEDIUM && args.force !== true)) {
          throw new Error(pitchRefusalMcp(`root a keymap on "${sampleId}"`, pitch, 'call beat_keymap again with a `root` argument'))
        }
        rootMidi = pitch.midi
        rootSource = `detected ${pitch.hz.toFixed(1)} Hz = ${pitch.note} (${pitch.level} confidence ${pitch.confidence.toFixed(2)})`
      }

      const opts = { rootMidi, scaleRootMidi, scale, fromMidi, toMidi, gainDb }
      const { doc, plan, added, rebacked } = buildKeymap(before, track, sampleId, opts)
      const header =
        `keymap${args.dry_run === true ? ' (dry run)' : ''}: ${plan.length} lane${plan.length === 1 ? '' : 's'} on ${track} backed by ${sampleId} — ` +
        `${scale} in ${midiToNote(scaleRootMidi).replace(/-?\d+$/, '')}, ${midiToNote(fromMidi)}..${midiToNote(toMidi)}\n` +
        `root ${midiToNote(rootMidi)}: ${rootSource}\n` +
        plan.map((l) => `  lane ${l.name} sample ${sampleId} ${formatNumber(gainDb)} ${formatNumber(l.tune)}`).join('\n')
      if (args.dry_run === true) return `${header}\nnothing written (dry_run)`
      writeFileSync(file, serialize(doc))
      return (
        `${header}\n` +
        (added.length > 0 ? `added ${added.length}: ${added.join(', ')}\n` : '') +
        (rebacked.length > 0 ? `re-backed ${rebacked.length} existing lane${rebacked.length === 1 ? '' : 's'}: ${rebacked.join(', ')}\n` : '') +
        formatDiff(diffDocuments(before, doc))
      )
    },
  },
  {
    name: 'beat_audio_pitch',
    description:
      'Repitch an audio-region clip by computing its warp rate for you (sets warp=repitch and the rate). Either `to` (detect the region\'s fundamental and move it to that note) or `semitones` (shift by an interval with no detection at all). `root` states the region\'s current pitch instead of detecting it. A CHORD or pad has no single pitch to detect and will be refused for `to` — use `semitones` there, which is the honest option. Repitch is variable-speed playback: length changes with pitch, so check the region\'s in/out span if timing matters. Detection runs over the span that actually plays (the region\'s in/out), not the whole file.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string', description: 'an audio-kind track id' },
        clip: { type: 'string', description: 'the audio-region clip id' },
        to: { type: 'string', description: 'target note, e.g. "g4" — detects the region\'s current pitch' },
        root: { type: 'string', description: 'the region\'s CURRENT pitch, e.g. "a4" — states it instead of detecting' },
        semitones: { type: 'number', description: 'shift by this interval instead (no detection; the honest option for a chord)' },
        force: { type: 'boolean', description: 'accept a low-confidence detection anyway' },
      },
      required: ['file', 'track', 'clip'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const trackId = str(args, 'track')
      const clipId = str(args, 'clip')
      const before = parse(readFileSync(file, 'utf8'))
      const track = before.tracks.find((t) => t.id === trackId)
      if (!track) throw new Error(`no track "${trackId}" (have: ${before.tracks.map((t) => t.id).join(', ') || 'none'})`)
      const clip = track.clips.find((c) => c.id === clipId)
      if (!clip) throw new Error(`no clip "${clipId}" on track "${trackId}" (have: ${track.clips.map((c) => c.id).join(', ') || 'none'})`)
      if (!clip.audio) throw new Error(`clip "${clipId}" on track "${trackId}" is not an audio-region clip — beat_audio_pitch repitches audio regions (see beat_audio_clip)`)

      let semitones: number
      let how: string
      if (typeof args.semitones === 'number') {
        semitones = args.semitones
        how = `semitones ${formatNumber(semitones)} (stated — no pitch detection)`
      } else if (typeof args.to === 'string' && args.to !== '') {
        const targetMidi = noteToMidi(args.to)
        let rootMidi: number
        if (typeof args.root === 'string' && args.root !== '') {
          rootMidi = noteToMidi(args.root)
          how = `root ${args.root} -> ${args.to} (root stated, not detected)`
        } else {
          const { channels, sampleRate } = readSampleAudioMcp(file, before, clip.audio.media)
          const a = Math.max(0, Math.round(clip.audio.in * sampleRate))
          const b = Math.min(channels[0]!.length, Math.round(clip.audio.out * sampleRate))
          const pitch = detectPitch(channels.map((ch) => ch.slice(a, b)), sampleRate)
          if (pitch.hz === null || pitch.midi === null || (pitch.confidence < PITCH_CONFIDENCE_MEDIUM && args.force !== true)) {
            throw new Error(
              pitchRefusalMcp(`repitch "${clipId}" to ${args.to}`, pitch, 'call beat_audio_pitch again with a `root` argument') +
              '\nA chord or a pad has no single pitch to detect — for those, pass `semitones` (an interval) instead of `to`.',
            )
          }
          rootMidi = pitch.midi
          how = `detected ${pitch.hz.toFixed(1)} Hz = ${pitch.note} (${pitch.level} confidence ${pitch.confidence.toFixed(2)}) -> ${args.to}`
        }
        semitones = targetMidi - rootMidi
      } else {
        throw new Error('beat_audio_pitch needs either `to` (a target note, detected) or `semitones` (an interval, no detection)')
      }
      const rate = rateForPitch(0, semitones)
      // warp first: setValue normalizes rate back to 1 while warp isn't 'repitch' (D4), so setting
      // rate first would be undone.
      let doc = setValue(before, `${trackId}.clip.${clipId}.audio.warp`, 'repitch')
      doc = setValue(doc, `${trackId}.clip.${clipId}.audio.rate`, String(rate))
      writeFileSync(file, serialize(doc))
      return (
        `audio-pitch: ${trackId}.${clipId} warp repitch, rate ${formatNumber(rate)} (${semitones >= 0 ? '+' : ''}${formatNumber(semitones)} semitones)\n` +
        `${how}\n` +
        `repitch is variable-speed: the region now plays ${rate > 1 ? 'faster and shorter' : rate < 1 ? 'slower and longer' : 'unchanged'} — check its in/out span if the timing matters.\n` +
        formatDiff(diffDocuments(before, doc))
      )
    },
  },
  // ==== end Phase 40 Stream VA ====
  {
    name: 'beat_lane',
    description:
      'Back a drum lane with a registered sample — the lane plays that audio (with optional gain in dB and tune in semitones) instead of its built-in synthesized voice. sample_id must already be in the media block (register it with beat_sample first; fails loudly otherwise), or pass the literal string "none" to clear the lane back to its synthesized voice. Same semantics as `beat lane` (gain defaults 0 dB, tune defaults 0 semitones). Or pass clear_legacy: true (no lane/sample_id) to drop stale v0.5 `lane` sample lines from a declared-lane track — dead data there (playback reads the lane declarations; beat_inspect flags them); errors on a legacy 5-lane track where those lines are live. Returns the edit list.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string', description: 'a drums track id' },
        lane: { type: 'string', description: 'one of the track\'s lanes, e.g. "kick" (required unless clear_legacy)' },
        sample_id: { type: 'string', description: 'a media id from beat_sample, or "none" to revert to the synthesized voice (required unless clear_legacy)' },
        gain_db: { type: 'number', description: 'playback gain in dB, default 0' },
        tune: { type: 'number', description: 'pitch offset in semitones, default 0' },
        clear_legacy: { type: 'boolean', description: 'one-shot cleanup: remove ALL stale legacy lane-sample lines from a declared-lane track (ignored by playback there). Mutually exclusive with lane/sample_id.' },
      },
      required: ['file', 'track'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const before = parse(readFileSync(file, 'utf8'))
      // Phase 35 Stream OB: the explicit stale-legacy cleanup — see clearLegacyLaneSamples.
      if (args.clear_legacy === true) {
        if (args.lane !== undefined || args.sample_id !== undefined) throw new Error('clear_legacy is a one-shot track-level cleanup — do not pass lane/sample_id with it')
        const { doc } = clearLegacyLaneSamples(before, str(args, 'track'))
        writeFileSync(file, serialize(doc))
        return formatDiff(diffDocuments(before, doc))
      }
      const sampleId = str(args, 'sample_id')
      const ref = sampleId === 'none' ? null : { sample: sampleId, gainDb: typeof args.gain_db === 'number' ? args.gain_db : 0, tune: typeof args.tune === 'number' ? args.tune : 0 }
      // lane is validated at runtime by setLaneSample itself (unknown-lane -> friendly error),
      // same as the CLI, which passes the raw argv string — the cast just satisfies the compiler.
      const doc = setLaneSample(before, str(args, 'track'), str(args, 'lane') as Parameters<typeof setLaneSample>[2], ref)
      writeFileSync(file, serialize(doc))
      return formatDiff(diffDocuments(before, doc))
    },
  },
  {
    name: 'beat_metrics',
    description:
      'Deterministic DSP measurements of a rendered WAV: integrated LUFS (ITU-R BS.1770), sample/true peak, crest factor, spectral band balance + centroid, stereo correlation/width. These numbers are the ground truth for any mix judgment — trust them over any impression of what the audio "probably" sounds like. Pass save_profile to also write the measured numbers as a reusable reference profile (JSON with provenance: source file, date, tool) for beat_lint\'s ref argument — measure a track you love once, then critique your own mixes against it. Honest limits: a profile captures full-mix statics only; it does not hear arrangement, sections, or masking.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'path to a .wav file (render one with beat_render)' },
        save_profile: { type: 'string', description: 'path to write a reference profile JSON (e.g. "ref.json"), usable as beat_lint\'s ref' },
      },
      required: ['file'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const { channels, sampleRate } = decodeWav(readFileSync(file))
      const m = analyze(channels, sampleRate)
      // Phase 35 Stream OD: same profile shape + code path as `beat metrics --save-profile`
      // (src/metrics/profile.ts) — a profile written on either surface reads on either.
      const saved = typeof args.save_profile === 'string' && args.save_profile !== '' ? args.save_profile : undefined
      if (saved) writeFileSync(saved, serializeProfile(buildProfile(m, basename(file))))
      // Same renderRunVariance metadata `beat metrics --json` emits (Phase 34 NC parity —
      // docs/render-determinism.md): deltas inside these bounds are render noise.
      return JSON.stringify({ ...m, meta: RENDER_RUN_VARIANCE_META, ...(saved ? { savedProfile: saved } : {}) }, null, 2)
    },
  },
  {
    name: 'beat_lint',
    description:
      'Run the deterministic mix-lint rules over a rendered WAV: true-peak clipping risk, loudness vs target (default -14 LUFS), over-compression, spectral imbalance, mono/phase issues. Findings include the measured value, the threshold, and — where expressible — the .beat edit to try. Pass ref (a profile saved by beat_metrics\' save_profile) to critique against a reference mix instead of absolute targets: findings then report loudness / band-share / width / crest deltas from the reference, padded by the measured render-run variance, while the safety rules (true-peak clipping, phase cancellation) stay absolute. ref and target_lufs are mutually exclusive — pick one comparison frame. Honest limits: the ref comparison is full-mix statics only; it does not hear arrangement, sections, or masking.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        target_lufs: { type: 'number', description: 'loudness target, default -14 (absolute mode only; mutually exclusive with ref)' },
        ref: { type: 'string', description: 'path to a reference profile JSON from beat_metrics\' save_profile (mutually exclusive with target_lufs)' },
      },
      required: ['file'],
    },
    handler: (args) => {
      const refPath = typeof args.ref === 'string' && args.ref !== '' ? args.ref : undefined
      if (refPath !== undefined && typeof args.target_lufs === 'number') {
        throw new Error('pick one comparison frame: ref (compare against a reference mix profile) or target_lufs (absolute loudness target) — not both')
      }
      if (refPath !== undefined && !existsSync(refPath)) {
        throw new Error(`no profile at ${refPath} — write one with beat_metrics' save_profile first`)
      }
      const { channels, sampleRate } = decodeWav(readFileSync(str(args, 'file')))
      const opts = refPath !== undefined ? { ref: parseProfile(readFileSync(refPath, 'utf8'), refPath) } : typeof args.target_lufs === 'number' ? { targetLufs: args.target_lufs } : {}
      return formatLint(lint(analyze(channels, sampleRate), opts))
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
  // ---- Phase 37 Stream RA begin: beat_feedback (section-aware + whole-song mix feedback) -----
  {
    name: 'beat_feedback',
    description:
      "Render a .beat file ONCE through dotbeat's real engine (headless Chromium — same real-time capture as beat_render, so it takes about as long as the audio is long plus browser startup) and turn that capture into mix feedback in one step. Default (no sections): whole-song deterministic metrics (LUFS, true peak, crest, spectral balance, stereo) plus the lint findings, the same numbers beat_metrics/beat_lint produce. With sections true: slice the render at the song's section boundaries and report the per-section ENERGY ARC — integrated LUFS, spectral band shares, stereo width, and crest per section, plus section-to-section movement (louder/quieter, brighter/darker, wider/narrower, more/less dynamic) flagged only when the change clears the measured render-run variance floor, so a reported mover is a real audible difference, not render noise. Pass ref (a profile saved by beat_metrics' save_profile) to compare each section (or the whole song) against a reference mix. Honest limits: these are per-section STATIC metrics — each section measured as an isolated static mix. This does NOT hear masking, arrangement, transitions, or how one section sets up the next, only how the sections differ as static mixes; and sections mode needs a song block (a loop-mode project has no sections to slice).",
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'path to a .beat file (it gets rendered, then the render is analyzed)' },
        sections: { type: 'boolean', description: 'slice the render at song section boundaries and report the per-section energy arc (needs a song block)' },
        ref: { type: 'string', description: "path to a reference profile JSON from beat_metrics' save_profile — compares each section (or the whole song) against it" },
        json: { type: 'boolean', description: 'emit machine-readable JSON instead of the formatted report' },
      },
      required: ['file'],
    },
    handler: (args) =>
      new Promise<string>((resolve, reject) => {
        const cliArgs = [join(repoRoot, 'cli', 'beat.mjs'), 'feedback', str(args, 'file')]
        if (args.sections === true) cliArgs.push('--sections')
        if (typeof args.ref === 'string' && args.ref !== '') cliArgs.push('--ref', args.ref)
        if (args.json === true) cliArgs.push('--json')
        execFile(process.execPath, cliArgs, { timeout: 600000 }, (err, stdout, stderr) => {
          // beat feedback exits non-zero when the whole-song lint has a warn-level finding — that is
          // a valid, useful result (findings are on stdout), not a failure, so surface stdout when
          // it exists rather than treating the exit code as an error.
          if (stdout) resolve(stdout)
          else if (err) reject(new Error(`feedback failed: ${stderr || err.message}`))
          else resolve(stderr || '')
        })
      }),
  },
  // ---- Phase 37 Stream RA end -----------------------------------------------------------------
  // ---- variation-and-taste loop (Phase 34 Stream NA — pilot 95's headline gap): beat_vary
  // generates, beat_score records picks, beat_suggest reads the exhaust. Same core functions,
  // same defaults, and the same manifest/jsonl shapes as `beat vary`/`beat score` — the shared
  // shaping lives in src/vary/batch.ts so a batch made on either surface scores on either.
  {
    name: 'beat_vary',
    description:
      `Batch-generate small-diff variants of one track into an out-dir — the generate half of dotbeat's vary -> audition -> score taste loop (beat_score records ranked picks; beat_adopt takes a winner; beat_suggest proposes the next round). Same semantics and defaults as \`beat vary\`. Choosing the target: on a DECLARED-LANE drums track (every drums track this server creates — beat_add_track/beat_drum_kit declare lanes), group is a LANE NAME (e.g. kick, hat, tom_lo — any declared lane): variants mutate that lane's OWN backing params, the ones the engine actually plays (synth-backed: the voice's tune/punch/decay/tone; sample-backed: start/length/attack/hold/decay/cutoff/resonance plus gainDb/tune), written as replayable beat_set lane paths (<track>.lane.<name>.<param>); the legacy kick/snare/hats groups ERROR there because they mutate track-wide params a declared-lane track never plays (an inaudible no-op batch, pilot 101's headline bug). Track-wide bus groups (filter, env, filterenv, fx, sends, mix) still apply to any drums track, and on legacy tracks and synth tracks group is a param group as before (${Object.keys(VARY_GROUPS).join(', ')} — seeded mutations of that group's synth params, strength set by amount 0-1, default 0.25). The special group "feel" batches humanized timing/velocity variants of the track's own notes/hits — content variation, not param variation. Writes v1.beat..vN.beat plus manifest.json into out_dir (default "vary-<group>-<seed>" NEXT TO the .beat file — NOT the server's working directory; an explicit out_dir resolves as written) — the exact manifest \`beat score\`/beat_score read, so a batch generated here can be scored from either surface. count defaults to 9, seed to the clock (pass one for reproducibility; it's recorded in the manifest either way). feel-only options: timing/velocity/push_late/swing (humanize knobs, defaults 0.15/0.06/0/0) and ONE way to scope the variation — lanes, ids, or scope "selection" with port (reads the user's live GUI selection off the daemon running on that port and resolves it to lanes/ids, exactly like the CLI's --scope selection: what the user has highlighted IS the referent of "vary this"). Pass render true to also render each variant to vN.wav through dotbeat's real engine — honest cost warning: that is a REAL-TIME capture per variant in headless Chromium, so a batch takes roughly count x loop-length plus a few seconds of browser startup each; a 9-variant batch of an 8-second loop is well over a minute. Pass audition true (implies render) to additionally stitch the rendered variants into ONE audition.wav in pick order with 0.5s gaps, returning a timecode index ("v1 @ 0:00.0, v2 @ 0:09.2, ...") and writing the same map to audition.json — one file to listen through instead of count files to juggle. Returns the batch summary, one line per variant (its edits, or its feel recipe).`,    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string' },
        track: { type: 'string' },
        group: { type: 'string', description: `a declared lane name (drums tracks with lanes — targets that lane's own backing params) | ${Object.keys(VARY_GROUPS).join(' | ')} | feel | automation:<param> (Phase 37: batch movement/shape variants of a clip's automation lane for that param, e.g. automation:cutoff)` },
        count: { type: 'number', description: 'variants per batch, 1-32, default 9' },
        amount: { type: 'number', description: 'param groups only: mutation strength (0, 1], default 0.25' },
        seed: { type: 'number', description: 'RNG seed; default from the clock (recorded in the manifest)' },
        out_dir: { type: 'string', description: 'batch directory to create; default "vary-<group>-<seed>" next to the .beat file (not the server cwd)' },
        timing: { type: 'number', description: 'feel only: timing jitter in 16th steps, default 0.15' },
        velocity: { type: 'number', description: 'feel only: velocity jitter 0..1, default 0.06' },
        push_late: { type: 'number', description: 'feel only: constant behind-the-beat drag in steps, default 0' },
        swing: { type: 'number', description: 'feel only: offbeat swing 0..1, default 0' },
        points: { type: 'number', description: 'automation:<param> only: breakpoints per generated lane, default 16' },
        bars: { type: 'number', description: 'automation:<param> only: clip span in bars for the generated lane; overrides the clip loop / doc loop_bars' },
        clip: { type: 'string', description: 'automation:<param> only: WHICH clip on the track to vary the lane on (default the track\'s first clip). Use it when a track has automation on more than one clip so the target is explicit rather than implicitly the first.' },
        lanes: { type: 'array', items: { type: 'string' }, description: 'feel only, drum tracks: scope to these lanes' },
        ids: { type: 'array', items: { type: 'string' }, description: 'feel only: scope to these note/hit ids (alternative to lanes)' },
        scope: { type: 'string', description: 'feel only: "selection" scopes the batch to the user\'s live GUI selection, read from the daemon on `port` (mutually exclusive with lanes/ids)' },
        port: { type: 'number', description: 'the running daemon\'s port — required with scope "selection" (same convention as beat_selection; default GUI port is 8420)' },
        render: { type: 'boolean', description: 'also render each variant to vN.wav — SLOW: real-time capture per variant in headless Chromium' },
        audition: { type: 'boolean', description: 'implies render: also stitch the rendered variants into one audition.wav (0.5s gaps) + timecode index + audition.json' },
      },
      required: ['file', 'track', 'group'],
    },
    handler: async (args) => {
      const file = str(args, 'file')
      const track = str(args, 'track')
      const group = str(args, 'group')
      const count = typeof args.count === 'number' ? args.count : 9
      // Same seed default as the CLI: the clock, folded to a 31-bit int.
      const seed = typeof args.seed === 'number' ? args.seed : Date.now() % 2147483647
      const render = args.render === true || args.audition === true // audition implies render
      const text = readFileSync(file, 'utf8')
      const doc = parse(text)
      // scope "selection" — same rules and error texts as the CLI's --scope selection glue.
      if (args.scope !== undefined && args.scope !== 'selection') throw new Error(`vary scope only supports "selection", got "${String(args.scope)}"`)
      if (args.scope === 'selection' && group !== 'feel') {
        throw new Error('vary scope "selection" only applies to "feel" (param groups mutate whole-track synth params, not per-note/lane content)')
      }
      if (args.scope === 'selection' && (args.lanes !== undefined || args.ids !== undefined)) {
        throw new Error('vary scope "selection" cannot be combined with lanes/ids — pick one way to scope')
      }
      const lines: string[] = []
      let selectionScope: { lanes?: string[]; ids?: string[] } = {}
      if (args.scope === 'selection') {
        if (typeof args.port !== 'number') throw new Error('vary scope "selection" needs port (the running daemon — same convention as beat_selection)')
        const res = await fetch(`http://127.0.0.1:${args.port}/selection`)
        if (!res.ok) {
          const msg = await res.json().then((b) => (b as { error?: string }).error).catch(() => res.statusText)
          throw new Error(`could not read selection from daemon on port ${args.port}: ${msg}`)
        }
        selectionScope = selectionToVaryScope((await res.json()) as Parameters<typeof selectionToVaryScope>[0], doc, track)
        lines.push(
          selectionScope.lanes
            ? `scope: selection -> lanes ${selectionScope.lanes.join(', ')}`
            : selectionScope.ids
              ? `scope: selection -> ${selectionScope.ids.length} id(s): ${selectionScope.ids.join(', ')}`
              : 'scope: selection -> whole track (selection had nothing narrowing it)',
        )
      }
      // === Phase 37 Stream RC begin === automation:<param> — whole-doc movement variants of a clip
      // lane, scored/adopted through the same recipe-carrying harness feel uses.
      if (group.startsWith('automation:')) {
        const param = group.slice('automation:'.length)
        const outDir = typeof args.out_dir === 'string' ? args.out_dir : defaultBatchDir(file, `automation-${param}`, seed)
        const variants = varyAutomation(doc, track, param, {
          count,
          seed,
          ...(typeof args.points === 'number' ? { points: args.points } : {}),
          ...(typeof args.bars === 'number' ? { bars: args.bars } : {}),
          ...(typeof args.clip === 'string' ? { clip: args.clip } : {}),
        })
        const manifest = writeVaryBatch({ parentPath: file, parentText: text, track, group, count, seed, outDir, variants })
        lines.push(`${outDir}/: ${variants.length} automation variants of ${track}.${param} (seed ${seed})`)
        for (let i = 0; i < manifest.variants.length; i++) lines.push(`  v${i + 1}: ${manifest.variants[i]!.recipe}`)
        if (render) {
          renderVaryBatch(outDir, variants.length, { linkMediaFrom: file })
          lines.push(`rendered ${variants.length} wavs into ${outDir}/ — audition, then record picks with beat_score`)
          if (args.audition === true) lines.push(formatAuditionIndex(stitchAudition(outDir, variants.length, { shuffleSeed: seed })).trimEnd())
        }
        return lines.join('\n') + '\n'
      }
      // === Phase 37 Stream RC end ===
      if (group === 'feel') {
        const outDir = typeof args.out_dir === 'string' ? args.out_dir : defaultBatchDir(file, 'feel', seed)
        const variants = varyFeel(doc, track, {
          count,
          seed,
          ...(args.timing !== undefined ? { timing: num(args, 'timing') } : {}),
          ...(args.velocity !== undefined ? { velocity: num(args, 'velocity') } : {}),
          ...(args.push_late !== undefined ? { pushLate: num(args, 'push_late') } : {}),
          ...(args.swing !== undefined ? { swing: num(args, 'swing') } : {}),
          ...(Array.isArray(args.lanes) ? { lanes: (args.lanes as unknown[]).map(String) } : {}),
          ...(Array.isArray(args.ids) ? { ids: (args.ids as unknown[]).map(String) } : {}),
          ...selectionScope,
        })
        const manifest = writeVaryBatch({ parentPath: file, parentText: text, track, group: 'feel', count, seed, outDir, variants })
        lines.push(`${outDir}/: ${variants.length} feel variants of ${track} (seed ${seed})`)
        for (let i = 0; i < manifest.variants.length; i++) lines.push(`  v${i + 1}: ${manifest.variants[i]!.recipe}`)
        if (render) {
          renderVaryBatch(outDir, variants.length, { linkMediaFrom: file })
          lines.push(`rendered ${variants.length} wavs into ${outDir}/ — audition, then record picks with beat_score`)
          if (args.audition === true) lines.push(formatAuditionIndex(stitchAudition(outDir, variants.length, { shuffleSeed: seed })).trimEnd())
        }
      } else {
        const amount = typeof args.amount === 'number' ? args.amount : 0.25
        const outDir = typeof args.out_dir === 'string' ? args.out_dir : defaultBatchDir(file, group, seed)
        const variants = varyTrack(doc, track, group, { count, amount, seed })
        const manifest = writeVaryBatch({ parentPath: file, parentText: text, track, group, count, amount, seed, outDir, variants })
        lines.push(`${outDir}/: ${variants.length} variants of ${track}.${group} (amount ${amount}, seed ${seed})`)
        for (let i = 0; i < manifest.variants.length; i++) lines.push(`  v${i + 1}: ${manifest.variants[i]!.edits!.join(', ')}`)
        if (render) {
          renderVaryBatch(outDir, variants.length)
          lines.push(`rendered ${variants.length} wavs into ${outDir}/ — audition, then record picks with beat_score`)
          if (args.audition === true) lines.push(formatAuditionIndex(stitchAudition(outDir, variants.length, { shuffleSeed: seed })).trimEnd())
        }
      }
      return lines.join('\n') + '\n'
    },
  },
  {
    name: 'beat_score',
    description:
      'Record 1-3 ranked picks against a vary batch (from beat_vary or `beat vary`) into the append-only scores log — the taste-capture half of the loop, and the exhaust beat_suggest reads to propose the next round. picks is an ordered array, best first; each pick names a variant as "3" or "v3" (both accepted), and picks must be distinct — at most 3, because ranking more adds fatigue, not signal (the Edisyn pattern). Appends one jsonl entry (identical shape to `beat score`\'s, so CLI- and MCP-recorded picks share one log/history) recording the batch\'s track/group/seed, each pick\'s replayable edits (param batches) or feel recipe, and which variants were rejected. Returns the scored summary plus how to adopt the winner (beat_adopt takes it MCP-natively).',
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'the batch directory (contains manifest.json, written by beat_vary)' },
        picks: { type: 'array', items: { type: 'string' }, description: 'ranked picks, best first, 1-3 distinct variant numbers ("N" or "vN")' },
        log: { type: 'string', description: `scores log path to append to; default "${DEFAULT_SCORES_LOG}" NEXT TO the batch's parent .beat file (not the server cwd)` },
      },
      required: ['dir', 'picks'],
    },
    handler: (args) => {
      const dir = str(args, 'dir')
      if (!Array.isArray(args.picks) || !(args.picks as unknown[]).every((p) => typeof p === 'string' || typeof p === 'number')) {
        throw new Error('picks must be an array of variant numbers ("N" or "vN"), best first')
      }
      const picks = (args.picks as unknown[]).map(String)
      return formatScoreResult(scoreBatch(dir, picks, typeof args.log === 'string' ? args.log : undefined))
    },
  },
  {
    name: 'beat_adopt',
    description:
      'Adopt a winner from a vary batch: copies the picked vN.beat over the batch\'s parent .beat file — the MCP-native way to take a variant after auditioning/scoring (no shell `cp` needed; this is the ONLY adopt path for feel batches, whose humanize recipe is not replayable via beat_set). pick accepts "3" or "v3". Data safety: if the parent file has changed since the batch was generated (its current sha256 no longer matches the manifest\'s parentSha256 — the project may have moved on through other edits), this REFUSES rather than silently overwriting that newer work; either re-run beat_vary from the current file, or pass force true to overwrite anyway. Writing the file is the whole operation — a running daemon/GUI on the project hot-reloads it automatically. Consider beat_checkpoint afterwards to keep the adopted state as a restorable version.' +
      // ==== Phase 40 Stream VB ====
      ' GEN batches (beat_source_gen with count): adopt REGISTERS the winning candidate instead of copying a document — it copies the winning wav into the project\'s media/ folder, writes its provenance sidecar, and adds the media entry, leaving every other edit in the file alone. The candidates deliberately touched nothing until this call, so adopt is the ONLY thing that puts a generated sound into the project, and the ones you did not pick leave no trace outside the batch dir. Adopting a second candidate from the same batch (changing your mind) trips the sha256 guard, because the first adopt itself changed the parent — pass force true, which just upserts the media entry.',
      // ==== end Phase 40 Stream VB ====
    inputSchema: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: 'the batch directory (contains manifest.json, written by beat_vary)' },
        pick: { type: 'string', description: 'the variant to adopt ("N" or "vN")' },
        force: { type: 'boolean', description: 'overwrite the parent even though it changed since the batch was generated (sha256 mismatch) — destroys those newer edits' },
      },
      required: ['dir', 'pick'],
    },
    handler: (args) => formatAdoptResult(adoptVariant(str(args, 'dir'), str(args, 'pick'), { force: args.force === true })),
  },
  {
    name: 'beat_suggest',
    description:
      'Read a track\'s beat-scores.jsonl exhaust (written by beat_score / `beat score`) and propose the next `beat vary` round, biased toward the mutation group that has scored best so far. Lane-aware (Phase 35): on a declared-lane drums track the recommendation targets the track\'s REAL vary surface — its own lane names (whose backing params are what actually sound) plus the track-wide bus groups — a cold start recommends an actual lane, and a group that would be an audio no-op on that track (the legacy kick/snare/hats, whose params a declared-lane track never plays) is never recommended even if it scored well historically (those wins were rated on inaudible differences). Aggregates picked-vs-rejected counts per group (Bradley-Terry odds-form against an implicit "not picked" baseline — a ranking signal, not a proven head-to-head result, since each vary round tests only one group) and, where enough picks share a numeric param, reports whether picks trend toward one end of that param\'s mutation range (e.g. brighter/darker on filter.cutoff). With no scored rounds yet for the track (cold start), says so and recommends a sensible first round instead of guessing. Returns the reasoning as plain text ending in a copy-pasteable `beat vary` command; never a bare score.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'path shown in the recommended command (the project this suggestion is for)' },
        track: { type: 'string' },
        target: { type: 'string', description: 'optional lane/id/param focus filter over the scores log (matched against round group names and picks\' edit paths / feel recipes)' },
        log: { type: 'string', description: 'path to beat-scores.jsonl; default "beat-scores.jsonl" NEXT TO the .beat file (not the server cwd) — the same place beat_score appends by default' },
      },
      required: ['file', 'track'],
    },
    handler: (args) => {
      const file = str(args, 'file')
      const track = str(args, 'track')
      // Same track-existence + kind resolution the CLI's suggestCmd gained in Phase 33
      // (research/96) — pilot 101 caught this handler still skipping it (the CLI/MCP drift class
      // Stream NA's shared helpers exist to prevent; suggest predates them). Kind matters: it
      // feeds suggestNext's group-legality logic so a synth track is never cold-started onto a
      // drums-only param group (a silent no-op).
      const doc = parse(readFileSync(file, 'utf8'))
      const trackObj = doc.tracks.find((t) => t.id === track)
      if (!trackObj) throw new Error(`no track "${track}" (have: ${doc.tracks.map((t) => t.id).join(', ')})`)
      const logPath = typeof args.log === 'string' ? args.log : defaultScoresLog(file)
      const text = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
      const entries = parseScoresLog(text)
      const suggestion = suggestNext(entries, track, {
        file,
        trackKind: trackObj.kind,
        // Lane-awareness (Phase 35 Stream OA): on a declared-lane drums track, cold start must
        // recommend a real lane and a dead legacy drum-voice group must never be recommended.
        ...(trackObj.kind === 'drums' && trackObj.lanes.length > 0 ? { trackLanes: trackObj.lanes } : {}),
        ...(typeof args.target === 'string' ? { target: args.target } : {}),
      })
      return suggestion.reasoning.join('\n') + '\n'
    },
  },
  {
    name: 'beat_checkpoint',
    description:
      'Save a restorable version of a .beat project. Call this after each batch of edits that fulfils one user request — pass the user\'s request verbatim as `intent` so the version can later be found by what was asked for. Without a `label` the checkpoint auto-labels itself from the semantic diff ("lead: cutoff 3200 -> 900") — EXCEPT the very first checkpoint of a project\'s history, which always auto-labels as the bare word "checkpoint" regardless of how much changed, since there is no prior checkpoint to diff against; pass an explicit `label` on a first call if you want it to be self-describing. Storage is a local git repo in the project folder (created invisibly); no git knowledge or setup is needed. Returns the new checkpoint\'s ref, or reports that nothing changed since the last one.',
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
      // Reject unknown argument keys instead of silently ignoring them (pilot 101: an agent's
      // plausible-but-wrong `lanes:` guess on beat_humanize was dropped without a word, turning an
      // intended lane-scoped edit into an unintended full-track one). Every tool's inputSchema
      // enumerates its real properties, so one dispatch-level check covers the whole surface —
      // fail-loudly beats a silently different edit, and the isError text names the valid keys so
      // the agent can self-correct on the next call.
      const knownKeys = Object.keys((tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {})
      const unknownKeys = Object.keys(args).filter((k) => !knownKeys.includes(k))
      if (unknownKeys.length > 0) {
        send({
          jsonrpc: '2.0',
          id,
          result: toolResultText(
            `unknown argument${unknownKeys.length > 1 ? 's' : ''} ${unknownKeys.map((k) => `"${k}"`).join(', ')} for ${tool.name} (valid: ${knownKeys.join(', ')})`,
            true,
          ),
        })
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
