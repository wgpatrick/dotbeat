#!/usr/bin/env node
// beat — the unified CLI (docs/phase-2-plan.md §2.4). One entry point over the .beat toolchain:
//
//   beat inspect <file> [--json]                     project overview (or the parsed doc as JSON)
//   beat set <file> <path> <value> [<path> <value>]  surgical edits, canonical write, edit-list output
//   beat add-note <file> <track> <pitch> <start> <dur> <vel>
//   beat rm-note <file> <track> <note-id>
//   beat diff <a.beat> <b.beat>                      semantic diff: reads like an edit list
//   beat diff --git <rev1> <rev2> <file>             same, between two git revisions
//   beat render <file> -o out.wav                   render to WAV (dotbeat's own engine, headless Chromium)
//   beat daemon <file> [--port 8420]                 two-way sync with a running dotbeat GUI
//
// diff exit codes follow diff(1) convention: 0 = no musical changes, 1 = changes, 2 = error.
// Requires `npm run build` (reads compiled ../dist/src/core).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  parse,
  saveClip,
  setScene,
  setSong,
  setMediaSample,
  setLaneSample,
  serialize,
  setValue,
  addNote,
  removeNote,
  addHit,
  removeHit,
  setAutomationPoint,
  humanize,
  quantizeNotes,
  addTrack,
  removeTrack,
  initDocument,
  diffDocuments,
  formatDiff,
  describeDocument,
  parsePresetLibrary,
  applyPreset,
  formatPresetList,
  filterPresetsByCategory,
  PRESET_CATEGORIES,
  parseSelection,
  serializeSelection,
  selectionToVaryScope,
  BeatSelectionError,
  BeatEditError,
  BeatParseError,
  BeatPresetError,
} from '../dist/src/core/index.js'
import { decodeWav, analyze, lint, formatLint } from '../dist/src/metrics/index.js'

const USAGE = `usage:
  beat init <file> [--bpm 120] [--bars 2]               a fresh project with one starter track
  beat add-track <file> <id> <synth|drums|instrument> [--name N] [--color #hex] [--soundfont <sample-id> --program N]
  beat rm-track <file> <id>
  beat inspect <file> [--json]
  beat set <file> <path> <value> [<path> <value> ...]     e.g. beat set song.beat lead.cutoff 900 bpm 124
  beat add-note <file> <track> <pitch> <start> <duration> <velocity>
  beat rm-note <file> <track> <note-id>
  beat add-hit <file> <track> <lane> <start> <velocity>   free-timed drum hit (start in fractional 16th steps)
  beat rm-hit <file> <track> <hit-id>
  beat quantize <file> <track> [--grid 1] [--amount 1] [--ends] [--no-starts] [--notes id,id]
                                                          snap notes toward the grid (grid in 16th steps:
                                                          1=16ths 2=8ths 4=quarters 0.5=32nds; amount<1 = partial)
  beat humanize <file> <track> [--timing 0.15] [--velocity 0.06] [--push-late 0] [--swing 0] [--seed N] [--lanes hat,oh | --ids a,b]
                                                          make a stiff part feel played: seeded timing/velocity
                                                          jitter, behind-the-beat drag, offbeat swing; scope by lane/id
  beat diff <a.beat> <b.beat>
  beat diff --git <rev1> <rev2> <file>
  beat presets [--json] [--category <cat>]                list the factory preset library (optionally
                                                          filtered to one taxonomy category — see
                                                          --list-categories for the enumerated set)
  beat presets --list-categories                          list the valid --category values
  beat preset <file> <track> <name>                       apply a preset to a track (a bag of set edits)
  beat vary <file> <track> <group> [--count 9] [--amount 0.25] [--seed N] [--out-dir d] [--render]
                                                          batch-generate small-diff variants of one param group
  beat vary <file> <track> feel [--count 9] [--seed N] [--timing .15] [--velocity .06] [--push-late 0] [--swing 0] [--lanes hat,oh | --ids a,b] [--render]
                                                          batch humanized FEEL variants (content variation) to audition + score
  beat vary <file> <track> feel --scope selection --port <p> [...same feel flags, minus --lanes/--ids]
                                                          scope to the GUI selection held by a running daemon instead of
                                                          typing --lanes/--ids by hand (lanes -> --lanes, bars/notes -> --ids)
  beat vary --groups                                      list the mutation groups
  beat automate <file> <track> <clip> <param> <time> <value> [--id p1]
                                                          add or move a clip automation point (time in fractional
                                                          16th steps from the clip's start; --id moves that point
                                                          if it already exists, else adds it with that id)
  beat clip <file> <track> <clip-id>                      snapshot the track's live content into a clip
  beat scene <file> <scene-id> [<track>=<clip> ...]       create/replace a scene's slot map
  beat song <file> [<scene> <bars> ...]                   replace the song timeline (empty = loop mode)
  beat sample <file> <sample-id> <wav-path>               register media (sha256 computed for you; path relative to the .beat)
  beat lane <file> <track> <lane> <sample-id|none> [gain] [tune]   back a drum lane with a sample
  beat score <batch-dir> <pick> [pick2 pick3] [--log f]   record a ranked pick (<=3) into the scores log
  beat suggest <file> <track> [--target <lane-or-id>] [--log f]
                                                          read the scores log and propose the next beat-vary round
  beat metrics <file.wav> [--json]                        LUFS, true peak, crest, spectral, stereo
  beat lint <file.wav> [--target <LUFS>] [--json]         deterministic mix findings (default target -14)
  beat render <file> [-o out.wav] [--tail <sec>]          render to WAV through dotbeat's own engine
                                                          (headless Chromium driving ui/; no BeatLab needed)
  beat daemon <file> [--port 8420]
  beat checkpoint <file> [--label L] [--intent I]         save a restorable version (auto-labels from the diff)
  beat history <file> [--limit N] [--collapsed]           list checkpoints, newest first (--collapsed folds
                                                          unnamed runs between pins into "N more checkpoints")
  beat restore <file> <ref>                               go back to a checkpoint (append-only — never destroys work)
  beat pin <file> <ref> <name...>                         name a checkpoint (<=25 chars), e.g. beat pin song.beat a1b2c3 rough mix v1
  beat unpin <file> <name...>                             remove a pin by name
  beat pins <file>                                        list this project's pins, newest checkpoint first
  beat selection --port <p> [--set "<grammar>" | --clear]  read/set the GUI selection held by a running daemon
  beat mcp                                                MCP server over stdio (all of the above as tools)
  beat mcp-init <file> [--force]                          write a .mcp.json next to <file> so Claude Code
                                                          (or any MCP client) auto-discovers 'beat mcp' there

paths for set: bpm | loop_bars | selected_track | <track>.<synth param> | <track>.name |
               <track>.color | <track>.pattern.<lane>[<step>]`

function readDoc(path) {
  return parse(readFileSync(path, 'utf8'))
}

/** Write the canonical form and print the musical edit list for what changed. */
function writeDoc(path, before, after) {
  const text = serialize(after)
  writeFileSync(path, text)
  process.stdout.write(formatDiff(diffDocuments(before, after)))
}

function initCmd(argv) {
  const file = argv.find((a) => !a.startsWith('--'))
  if (!file) throw new BeatEditError('init needs a file path')
  if (existsSync(file)) throw new BeatEditError(`${file} already exists — refusing to overwrite`)
  const bpmIdx = argv.indexOf('--bpm')
  const barsIdx = argv.indexOf('--bars')
  const doc = initDocument({
    ...(bpmIdx !== -1 ? { bpm: Number(argv[bpmIdx + 1]) } : {}),
    ...(barsIdx !== -1 ? { loopBars: Number(argv[barsIdx + 1]) } : {}),
  })
  writeFileSync(file, serialize(doc))
  process.stdout.write(`created ${file}: ${doc.bpm} bpm, ${doc.loopBars} bar(s), starter track "${doc.tracks[0].id}"\n`)
}

function addTrackCmd(argv) {
  const [file, id, kind, ...rest] = argv
  if (!file || !id || !kind) throw new BeatEditError('add-track needs <file> <id> <synth|drums|instrument>')
  const nameIdx = rest.indexOf('--name')
  const colorIdx = rest.indexOf('--color')
  const sfIdx = rest.indexOf('--soundfont')
  const progIdx = rest.indexOf('--program')
  const before = readDoc(file)
  const { doc } = addTrack(before, {
    id,
    kind,
    ...(nameIdx !== -1 ? { name: rest[nameIdx + 1] } : {}),
    ...(colorIdx !== -1 ? { color: rest[colorIdx + 1] } : {}),
    ...(sfIdx !== -1 ? { soundfont: { sample: rest[sfIdx + 1], program: progIdx !== -1 ? Number(rest[progIdx + 1]) : 0 } } : {}),
  })
  writeDoc(file, before, doc)
}

function rmTrackCmd(argv) {
  const [file, id] = argv
  if (!file || !id) throw new BeatEditError('rm-track needs <file> <id>')
  const before = readDoc(file)
  const { doc } = removeTrack(before, id)
  writeDoc(file, before, doc)
}

// v0.8+ multi-preset listing (docs/phase-8-plan.md's "Remaining": "beat inspect should list a
// bank's presets" — a loaded SF2 can carry many programs; the file only pins the one selected).
// Reads the actual .sf2 bytes (relative to the .beat file, sha256-verified like every other
// media consumer) and enumerates via spessasynth_core's SoundBankLoader — a pure binary-format
// parse, no audio context / DSP / browser shim required (verified: no window/document stub
// needed, unlike SpessaSynthProcessor's WASM path in render-offline.mjs). Best-effort: a missing
// file, unregistered sample, or hash mismatch is reported per-track rather than failing the
// whole inspect (inspect is a read-only overview that should stay usable even when media isn't
// checked out locally), matching the spirit of `beat inspect`'s always-available design.
async function instrumentPresetInfo(file, doc) {
  const info = new Map()
  const instrumentTracks = doc.tracks.filter((t) => t.kind === 'instrument' && t.instrument)
  if (instrumentTracks.length === 0) return info
  const { createHash } = await import('node:crypto')
  const { dirname: pathDirname, resolve: pathResolve } = await import('node:path')
  const beatDir = pathDirname(pathResolve(file))
  let SoundBankLoader
  for (const t of instrumentTracks) {
    const sample = doc.media.find((m) => m.id === t.instrument.sample)
    if (!sample) {
      info.set(t.id, { error: `sample "${t.instrument.sample}" is not in the media block` })
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
      info.set(t.id, { error: e.message })
    }
  }
  return info
}

function formatInstrumentPresets(doc, info) {
  if (info.size === 0) return ''
  const lines = ['', 'soundfont presets:']
  for (const t of doc.tracks) {
    const result = info.get(t.id)
    if (!result) continue
    if (result.error) {
      lines.push(`  ${t.id}: ${result.error}`)
      continue
    }
    lines.push(`  ${t.id}: ${result.presets.length} preset${result.presets.length === 1 ? '' : 's'}`)
    for (const p of result.presets) {
      const selected = p.program === t.instrument.program ? ' [selected]' : ''
      lines.push(`    program ${p.program} (bank ${p.bankMSB}/${p.bankLSB}): "${p.name}"${selected}`)
    }
  }
  return lines.join('\n') + '\n'
}

async function inspectCmd(argv) {
  const json = argv.includes('--json')
  const file = argv.find((a) => a !== '--json')
  if (!file) throw new BeatEditError('inspect needs a file')
  const doc = readDoc(file)
  const presetInfo = await instrumentPresetInfo(file, doc)
  if (json) {
    const instrumentPresets = presetInfo.size > 0 ? Object.fromEntries(presetInfo) : undefined
    process.stdout.write(JSON.stringify(instrumentPresets ? { ...doc, instrumentPresets } : doc, null, 2) + '\n')
  } else {
    process.stdout.write(describeDocument(doc) + formatInstrumentPresets(doc, presetInfo))
  }
}

function setCmd(argv) {
  const [file, ...pairs] = argv
  if (!file || pairs.length === 0 || pairs.length % 2 !== 0) {
    throw new BeatEditError('set needs a file and one or more <path> <value> pairs')
  }
  const before = readDoc(file)
  let doc = before
  for (let i = 0; i < pairs.length; i += 2) {
    doc = setValue(doc, pairs[i], pairs[i + 1])
  }
  writeDoc(file, before, doc)
}

function addNoteCmd(argv) {
  const [file, track, pitch, start, duration, velocity] = argv
  if (!file || !track || velocity === undefined) throw new BeatEditError('add-note needs <file> <track> <pitch> <start> <duration> <velocity>')
  const before = readDoc(file)
  const { doc } = addNote(before, track, { pitch: Number(pitch), start: Number(start), duration: Number(duration), velocity: Number(velocity) })
  writeDoc(file, before, doc)
}

function rmNoteCmd(argv) {
  const [file, track, noteId] = argv
  if (!file || !track || !noteId) throw new BeatEditError('rm-note needs <file> <track> <note-id>')
  const before = readDoc(file)
  const { doc } = removeNote(before, track, noteId)
  writeDoc(file, before, doc)
}

function addHitCmd(argv) {
  const [file, track, lane, start, velocity] = argv
  if (!file || !track || !lane || start === undefined || velocity === undefined) throw new BeatEditError('add-hit needs <file> <track> <lane> <start> <velocity>')
  const before = readDoc(file)
  const { doc } = addHit(before, track, { lane, start: Number(start), velocity: Number(velocity) })
  writeDoc(file, before, doc)
}

function rmHitCmd(argv) {
  const [file, track, hitId] = argv
  if (!file || !track || !hitId) throw new BeatEditError('rm-hit needs <file> <track> <hit-id>')
  const before = readDoc(file)
  const { doc } = removeHit(before, track, hitId)
  writeDoc(file, before, doc)
}

function humanizeCmd(argv) {
  const valued = ['--timing', '--velocity', '--push-late', '--swing', '--seed', '--ids', '--lanes']
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]))
  const [file, track] = positional
  if (!file || !track) throw new BeatEditError('humanize needs <file> <track> [--timing 0.15] [--velocity 0.06] [--push-late 0] [--swing 0] [--seed N] [--lanes hat,openhat | --ids a,b]')
  const flagValue = (flag) => {
    const i = argv.indexOf(flag)
    return i === -1 ? undefined : argv[i + 1]
  }
  const before = readDoc(file)
  // scope: explicit --ids, or --lanes (resolve to the drum-hit ids on those lanes)
  let ids
  if (flagValue('--ids') !== undefined) ids = flagValue('--ids').split(',').filter(Boolean)
  else if (flagValue('--lanes') !== undefined) {
    const lanes = new Set(flagValue('--lanes').split(',').filter(Boolean))
    const t = before.tracks.find((x) => x.id === track)
    if (!t) throw new BeatEditError(`no track "${track}"`)
    ids = (t.hits ?? []).filter((h) => lanes.has(h.lane)).map((h) => h.id)
    if (ids.length === 0) throw new BeatEditError(`no hits on lane(s) ${[...lanes].join(', ')} in track "${track}"`)
  }
  const seed = flagValue('--seed') !== undefined ? Number(flagValue('--seed')) : (readFileSync(file, 'utf8').length % 2147483647)
  const { doc, changed } = humanize(before, track, {
    ...(flagValue('--timing') !== undefined ? { timing: Number(flagValue('--timing')) } : {}),
    ...(flagValue('--velocity') !== undefined ? { velocity: Number(flagValue('--velocity')) } : {}),
    ...(flagValue('--push-late') !== undefined ? { pushLate: Number(flagValue('--push-late')) } : {}),
    ...(flagValue('--swing') !== undefined ? { swing: Number(flagValue('--swing')) } : {}),
    seed,
    ...(ids !== undefined ? { ids } : {}),
  })
  writeDoc(file, before, doc)
  process.stdout.write(`humanized ${changed} event(s) with seed ${seed}\n`)
}

function quantizeCmd(argv) {
  const positional = argv.filter((a, i) => !a.startsWith('--') && !['--grid', '--amount', '--notes'].includes(argv[i - 1]))
  const [file, track] = positional
  if (!file || !track) throw new BeatEditError('quantize needs <file> <track> [--grid 1] [--amount 1] [--ends] [--no-starts] [--notes id,id]')
  const flagValue = (flag) => {
    const i = argv.indexOf(flag)
    return i === -1 ? undefined : argv[i + 1]
  }
  const before = readDoc(file)
  const { doc, changed } = quantizeNotes(before, track, {
    ...(flagValue('--grid') !== undefined ? { grid: Number(flagValue('--grid')) } : {}),
    ...(flagValue('--amount') !== undefined ? { amount: Number(flagValue('--amount')) } : {}),
    ...(argv.includes('--no-starts') ? { starts: false } : {}),
    ...(argv.includes('--ends') ? { ends: true } : {}),
    ...(flagValue('--notes') !== undefined ? { noteIds: flagValue('--notes').split(',').filter(Boolean) } : {}),
  })
  writeDoc(file, before, doc)
  if (changed === 0) process.stdout.write('already on the grid — no notes moved\n')
}

// The factory library ships with the package; BEAT_PRESETS overrides for a user library.
function loadPresets() {
  const path = process.env.BEAT_PRESETS ?? resolve(dirname(new URL(import.meta.url).pathname), '..', 'presets', 'factory.json')
  return parsePresetLibrary(readFileSync(path, 'utf8'))
}

function presetsCmd(argv) {
  if (argv.includes('--list-categories')) {
    process.stdout.write(PRESET_CATEGORIES.join('\n') + '\n')
    return
  }
  let presets = loadPresets()
  const categoryIdx = argv.indexOf('--category')
  if (categoryIdx !== -1) {
    const category = argv[categoryIdx + 1]
    if (!category) throw new BeatEditError('--category needs a value (see `beat presets --list-categories`)')
    presets = filterPresetsByCategory(presets, category)
  }
  process.stdout.write(argv.includes('--json') ? JSON.stringify(presets, null, 2) + '\n' : formatPresetList(presets))
}

function presetCmd(argv) {
  const [file, track, name] = argv
  if (!file || !track || !name) throw new BeatEditError('preset needs <file> <track> <preset-name> (see `beat presets`)')
  const presets = loadPresets()
  const preset = presets.find((p) => p.name === name)
  if (!preset) throw new BeatEditError(`no preset "${name}" (have: ${presets.map((p) => p.name).join(', ')})`)
  const before = readDoc(file)
  writeDoc(file, before, applyPreset(before, track, preset))
}

// ---- variation-and-taste loop (rung 1) — docs/research/08-variation-loop-prior-art.md ------

function flagValue(argv, flag) {
  const i = argv.indexOf(flag)
  return i !== -1 ? argv[i + 1] : undefined
}

async function varyCmd(argv) {
  const { VARY_GROUPS, varyTrack, BeatVaryError } = await import('../dist/src/vary/vary.js')
  if (argv.includes('--groups') || argv.length === 0) {
    for (const [name, defs] of Object.entries(VARY_GROUPS)) {
      process.stdout.write(`${name.padEnd(10)} ${defs.map((d) => d.key).join(', ')}\n`)
    }
    return
  }
  const valued = ['--count', '--amount', '--seed', '--out-dir', '--timing', '--velocity', '--push-late', '--swing', '--lanes', '--ids', '--scope', '--port']
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]))
  const [file, track, group] = positional
  if (!file || !track || !group) throw new BeatEditError('vary needs <file> <track> <group> (see beat vary --groups; "feel" batches humanized variants)')

  // "feel" is content variation (rung 2): batch humanized variants for auditioning + scoring.
  if (group === 'feel') {
    await varyFeelCmd(argv, file, track)
    return
  }
  if (flagValue(argv, '--scope') !== undefined) {
    // Param-group variants (rung 1) mutate whole-track synth params — there's no per-note/lane
    // concept to scope by, so --scope selection only makes sense for "feel" (rung 2).
    throw new BeatEditError('vary --scope selection only applies to "feel" (param groups mutate whole-track synth params, not per-note/lane content)')
  }
  const count = flagValue(argv, '--count') ? Number(flagValue(argv, '--count')) : 9
  const amount = flagValue(argv, '--amount') ? Number(flagValue(argv, '--amount')) : 0.25
  const seed = flagValue(argv, '--seed') ? Number(flagValue(argv, '--seed')) : (Date.now() % 2147483647)
  const outDir = flagValue(argv, '--out-dir') ?? `vary-${group}-${seed}`

  const text = readFileSync(file, 'utf8')
  const doc = parse(text)
  let variants
  try {
    variants = varyTrack(doc, track, group, { count, amount, seed })
  } catch (err) {
    if (err instanceof BeatVaryError) throw new BeatEditError(err.message)
    throw err
  }

  const { mkdirSync } = await import('node:fs')
  const { createHash } = await import('node:crypto')
  mkdirSync(outDir, { recursive: true })
  const manifest = {
    parent: file,
    parentSha256: createHash('sha256').update(text).digest('hex'),
    track,
    group,
    count,
    amount,
    seed,
    createdAt: new Date().toISOString(),
    // Renders are nondeterministic run-to-run (see docs/phase-5-plan.md Result) — only compare
    // renders from the same batch, never across sessions.
    variants: variants.map((v, i) => ({
      file: `v${i + 1}.beat`,
      edits: v.edits.map((e) => `${e.path} ${e.value}`),
    })),
  }
  for (let i = 0; i < variants.length; i++) {
    writeFileSync(resolve(outDir, `v${i + 1}.beat`), serialize(variants[i].doc))
  }
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  process.stdout.write(`${outDir}/: ${variants.length} variants of ${track}.${group} (amount ${amount}, seed ${seed})\n`)
  for (let i = 0; i < variants.length; i++) {
    process.stdout.write(`  v${i + 1}: ${manifest.variants[i].edits.join(', ')}\n`)
  }

  if (argv.includes('--render')) {
    const { execFileSync } = await import('node:child_process')
    const { fileURLToPath } = await import('node:url')
    // D15: the one render path is dotbeat's own engine driven headless (cli/render.mjs). It's a
    // real-time capture per variant, so a batch of N takes ~N * loop-length plus browser startup —
    // slower than the retired faster-than-realtime offline path. Correct output, honest cost; a
    // dedicated fast batch renderer for dotbeat's own engine is future work (see D15 / phase-17 doc).
    const renderCli = fileURLToPath(new URL('./render.mjs', import.meta.url))
    for (let i = 0; i < variants.length; i++) {
      const beatFile = resolve(outDir, `v${i + 1}.beat`)
      process.stdout.write(`rendering v${i + 1}/${variants.length}...\n`)
      execFileSync(process.execPath, [renderCli, beatFile, '-o', resolve(outDir, `v${i + 1}.wav`)], { stdio: ['ignore', 'ignore', 'inherit'] })
    }
    process.stdout.write(`rendered ${variants.length} wavs into ${outDir}/ — audition, then: beat score ${outDir} <best> [2nd 3rd]\n`)
  }
}

/**
 * `--scope selection` glue: fetch the live selection off a running daemon and resolve it against
 * `doc`/`track` into the same {lanes|ids} shape `--lanes`/`--ids` accept by hand. Kept separate
 * from varyFeelCmd's flag parsing so the only untestable-without-a-daemon part is this one fetch
 * — the actual resolution (selectionToVaryScope) is a pure function tested without any daemon.
 */
async function fetchSelectionScope(port, doc, track) {
  const base = `http://127.0.0.1:${Number(port)}`
  const res = await fetch(`${base}/selection`)
  if (!res.ok) {
    const msg = await res.json().then((b) => b.error).catch(() => res.statusText)
    throw new BeatEditError(`could not read selection from daemon on port ${port}: ${msg}`)
  }
  const sel = await res.json()
  try {
    return selectionToVaryScope(sel, doc, track)
  } catch (err) {
    if (err instanceof BeatSelectionError) throw new BeatEditError(err.message)
    throw err
  }
}

async function varyFeelCmd(argv, file, track) {
  const { varyFeel, BeatVaryError } = await import('../dist/src/vary/vary.js')
  const count = flagValue(argv, '--count') ? Number(flagValue(argv, '--count')) : 9
  const seed = flagValue(argv, '--seed') ? Number(flagValue(argv, '--seed')) : (Date.now() % 2147483647)
  const outDir = flagValue(argv, '--out-dir') ?? `vary-feel-${seed}`
  const scope = flagValue(argv, '--scope')
  if (scope !== undefined && scope !== 'selection') throw new BeatEditError(`vary --scope only supports "selection", got "${scope}"`)
  if (scope === 'selection' && (flagValue(argv, '--lanes') !== undefined || flagValue(argv, '--ids') !== undefined)) {
    throw new BeatEditError('vary --scope selection cannot be combined with --lanes/--ids — pick one way to scope')
  }
  const opts = {
    count,
    seed,
    ...(flagValue(argv, '--timing') !== undefined ? { timing: Number(flagValue(argv, '--timing')) } : {}),
    ...(flagValue(argv, '--velocity') !== undefined ? { velocity: Number(flagValue(argv, '--velocity')) } : {}),
    ...(flagValue(argv, '--push-late') !== undefined ? { pushLate: Number(flagValue(argv, '--push-late')) } : {}),
    ...(flagValue(argv, '--swing') !== undefined ? { swing: Number(flagValue(argv, '--swing')) } : {}),
    ...(scope !== 'selection' && flagValue(argv, '--lanes') !== undefined ? { lanes: flagValue(argv, '--lanes').split(',').filter(Boolean) } : {}),
    ...(scope !== 'selection' && flagValue(argv, '--ids') !== undefined ? { ids: flagValue(argv, '--ids').split(',').filter(Boolean) } : {}),
  }
  const text = readFileSync(file, 'utf8')
  const doc = parse(text)

  if (scope === 'selection') {
    const portIdx = argv.indexOf('--port')
    if (portIdx === -1 || argv[portIdx + 1] === undefined) {
      throw new BeatEditError('vary --scope selection needs --port <port> (the running daemon — same convention as `beat selection`)')
    }
    const resolved = await fetchSelectionScope(argv[portIdx + 1], doc, track)
    Object.assign(opts, resolved)
    process.stdout.write(
      resolved.lanes
        ? `scope: selection -> lanes ${resolved.lanes.join(', ')}\n`
        : resolved.ids
          ? `scope: selection -> ${resolved.ids.length} id(s): ${resolved.ids.join(', ')}\n`
          : 'scope: selection -> whole track (selection had nothing narrowing it)\n',
    )
  }

  let variants
  try {
    variants = varyFeel(doc, track, opts)
  } catch (err) {
    if (err instanceof BeatVaryError) throw new BeatEditError(err.message)
    throw err
  }
  const { mkdirSync } = await import('node:fs')
  const { createHash } = await import('node:crypto')
  mkdirSync(outDir, { recursive: true })
  const manifest = {
    parent: file,
    parentSha256: createHash('sha256').update(text).digest('hex'),
    track,
    group: 'feel',
    count,
    seed,
    createdAt: new Date().toISOString(),
    variants: variants.map((v, i) => ({ file: `v${i + 1}.beat`, recipe: v.recipe })),
  }
  for (let i = 0; i < variants.length; i++) writeFileSync(resolve(outDir, `v${i + 1}.beat`), serialize(variants[i].doc))
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  process.stdout.write(`${outDir}/: ${variants.length} feel variants of ${track} (seed ${seed})\n`)
  for (let i = 0; i < variants.length; i++) process.stdout.write(`  v${i + 1}: ${manifest.variants[i].recipe}\n`)

  if (argv.includes('--render')) {
    const { execFileSync } = await import('node:child_process')
    const { fileURLToPath } = await import('node:url')
    const { existsSync, symlinkSync } = await import('node:fs')
    // variant .beat files reference media relative to themselves; the parent's media/ dir sits
    // next to the parent, so link it into the batch dir before rendering.
    const parentMedia = resolve(dirname(resolve(file)), 'media')
    const batchMedia = resolve(outDir, 'media')
    if (existsSync(parentMedia) && !existsSync(batchMedia)) {
      try { symlinkSync(parentMedia, batchMedia, 'dir') } catch { /* best-effort; render will report a missing sample */ }
    }
    // D15: render through dotbeat's own engine (cli/render.mjs) — real-time per variant (see the
    // matching note in varyCmd above; a fast batch renderer for the canonical engine is future work).
    const renderCli = fileURLToPath(new URL('./render.mjs', import.meta.url))
    for (let i = 0; i < variants.length; i++) {
      process.stdout.write(`rendering v${i + 1}/${variants.length}...\n`)
      execFileSync(process.execPath, [renderCli, resolve(outDir, `v${i + 1}.beat`), '-o', resolve(outDir, `v${i + 1}.wav`)], { stdio: ['ignore', 'ignore', 'inherit'] })
    }
    process.stdout.write(`rendered ${variants.length} wavs into ${outDir}/ — audition, then: beat score ${outDir} <best> [2nd 3rd]\n`)
  }
}

async function scoreCmd(argv) {
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--log')
  const [dir, ...picks] = positional
  if (!dir || picks.length === 0) throw new BeatEditError('score needs <batch-dir> and 1-3 ranked picks (variant numbers, best first)')
  if (picks.length > 3) throw new BeatEditError('at most 3 ranked picks (Edisyn (3,16) pattern — ranking more adds fatigue, not signal)')
  const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'))
  const ranks = picks.map((p) => {
    const n = Number(p)
    if (!Number.isInteger(n) || n < 1 || n > manifest.variants.length) throw new BeatEditError(`pick "${p}" is not a variant number 1-${manifest.variants.length}`)
    return n
  })
  if (new Set(ranks).size !== ranks.length) throw new BeatEditError('picks must be distinct')
  const logPath = flagValue(argv, '--log') ?? 'beat-scores.jsonl'
  // param batches carry replayable `edits`; feel batches carry a `recipe` (the whole variant
  // file IS the result, since humanize isn't a set-replayable edit).
  const isFeel = manifest.group === 'feel'
  const entry = {
    t: new Date().toISOString(),
    batch: dir,
    track: manifest.track,
    group: manifest.group,
    amount: manifest.amount,
    seed: manifest.seed,
    parentSha256: manifest.parentSha256,
    picks: ranks.map((n, i) => ({ rank: i + 1, variant: `v${n}.beat`, ...(isFeel ? { recipe: manifest.variants[n - 1].recipe } : { edits: manifest.variants[n - 1].edits }) })),
    rejected: manifest.variants.map((_, i) => i + 1).filter((n) => !ranks.includes(n)).map((n) => `v${n}.beat`),
  }
  const { appendFileSync } = await import('node:fs')
  appendFileSync(logPath, JSON.stringify(entry) + '\n')
  process.stdout.write(`scored ${dir}: ${ranks.map((n) => `v${n}`).join(' > ')} -> ${logPath}\n`)
  if (isFeel) process.stdout.write(`to adopt the winner (${entry.picks[0].recipe}): cp ${resolve(dir, `v${ranks[0]}.beat`)} ${manifest.parent}\n`)
  else process.stdout.write(`to adopt the winner: beat set ${manifest.parent} ${entry.picks[0].edits.join(' ')}\n`)
}

async function suggestCmd(argv) {
  const { suggestNext, parseScoresLog } = await import('../dist/src/vary/suggest.js')
  const valued = ['--target', '--log']
  const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]))
  const [file, track] = positional
  if (!file || !track) throw new BeatEditError('suggest needs <file> <track> (see beat vary --groups for group names)')
  const logPath = flagValue(argv, '--log') ?? 'beat-scores.jsonl'
  const target = flagValue(argv, '--target')
  const text = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
  const entries = parseScoresLog(text)
  const suggestion = suggestNext(entries, track, { file, ...(target ? { target } : {}) })
  process.stdout.write(suggestion.reasoning.join('\n') + '\n')
}

// ---- v0.4 song structure (docs/phase-6-plan.md §6.4) ----------------------------------------

function clipCmd(argv) {
  const [file, track, clipId] = argv
  if (!file || !track || !clipId) throw new BeatEditError('clip needs <file> <track> <clip-id>')
  const before = readDoc(file)
  const { doc, created } = saveClip(before, track, clipId)
  writeDoc(file, before, doc)
  if (!created) process.stdout.write(`(re-snapshotted existing clip "${clipId}")\n`)
}

function sceneCmd(argv) {
  const [file, sceneId, ...pairs] = argv
  if (!file || !sceneId) throw new BeatEditError('scene needs <file> <scene-id> [<track>=<clip> ...]')
  const slots = {}
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq === -1) throw new BeatEditError(`slot "${pair}" must be <track>=<clip>`)
    slots[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  const before = readDoc(file)
  writeDoc(file, before, setScene(before, sceneId, slots))
}

function songCmd(argv) {
  const [file, ...rest] = argv
  if (!file) throw new BeatEditError('song needs <file> [<scene> <bars> ...]')
  if (rest.length % 2 !== 0) throw new BeatEditError('song sections are <scene> <bars> pairs')
  const sections = []
  for (let i = 0; i < rest.length; i += 2) sections.push({ scene: rest[i], bars: Number(rest[i + 1]) })
  const before = readDoc(file)
  writeDoc(file, before, setSong(before, sections))
}

// v0.9 clip automation (docs/phase-9-automation-plan.md)
function automateCmd(argv) {
  const idIdx = argv.indexOf('--id')
  const id = idIdx !== -1 ? argv[idIdx + 1] : undefined
  const positional = argv.filter((a, i) => !(idIdx !== -1 && (i === idIdx || i === idIdx + 1)))
  const [file, track, clip, param, time, value] = positional
  if (!file || !track || !clip || !param || time === undefined || value === undefined) {
    throw new BeatEditError('automate needs <file> <track> <clip> <param> <time> <value> [--id p1]')
  }
  const before = readDoc(file)
  const { doc, created } = setAutomationPoint(before, track, clip, param, { time: Number(time), value: Number(value), ...(id !== undefined ? { id } : {}) })
  writeDoc(file, before, doc)
  if (!created) process.stdout.write(`(moved existing point)\n`)
}

async function sampleCmd(argv) {
  const [file, id, samplePath] = argv
  if (!file || !id || !samplePath) throw new BeatEditError('sample needs <file> <sample-id> <wav-path> (path relative to the .beat file)')
  const { createHash } = await import('node:crypto')
  const beatDir = dirname(resolve(file))
  const abs = resolve(beatDir, samplePath)
  if (!existsSync(abs)) throw new BeatEditError(`no file at ${samplePath} (relative to ${beatDir}) — put the audio next to the project first`)
  const sha256 = createHash('sha256').update(readFileSync(abs)).digest('hex')
  const before = readDoc(file)
  writeDoc(file, before, setMediaSample(before, id, sha256, samplePath.replace(/\\/g, '/')))
  process.stdout.write(`registered ${id}: sha256:${sha256.slice(0, 12)}... ${samplePath}\n`)
}

function laneCmd(argv) {
  const [file, track, lane, sampleId, gain, tune] = argv
  if (!file || !track || !lane || !sampleId) throw new BeatEditError('lane needs <file> <track> <lane> <sample-id|none> [gain dB] [tune semitones]')
  const before = readDoc(file)
  const ref = sampleId === 'none' ? null : { sample: sampleId, gainDb: gain !== undefined ? Number(gain) : 0, tune: tune !== undefined ? Number(tune) : 0 }
  writeDoc(file, before, setLaneSample(before, track, lane, ref))
}

function fmtDb(x, unit = '') {
  return Number.isFinite(x) ? `${x.toFixed(1)}${unit}` : String(x)
}

function metricsCmd(argv) {
  const json = argv.includes('--json')
  const file = argv.find((a) => !a.startsWith('--'))
  if (!file) throw new BeatEditError('metrics needs a wav file')
  const { channels, sampleRate } = decodeWav(readFileSync(file))
  const m = analyze(channels, sampleRate)
  if (json) {
    process.stdout.write(JSON.stringify(m, null, 2) + '\n')
    return
  }
  const b = m.spectral.bandsPct
  process.stdout.write(
    [
      `${file}: ${m.durationSeconds.toFixed(2)}s, ${m.channels}ch @ ${m.sampleRate} Hz`,
      `loudness   ${fmtDb(m.integratedLufs, ' LUFS')} integrated`,
      `peaks      sample ${fmtDb(m.samplePeakDbfs, ' dBFS')}, true ${fmtDb(m.truePeakDbtp, ' dBTP')}`,
      `dynamics   crest ${fmtDb(m.crestDb, ' dB')} (rms ${fmtDb(m.rmsDbfs, ' dBFS')})`,
      `spectrum   sub ${b.sub.toFixed(0)}% | bass ${b.bass.toFixed(0)}% | mids ${b.mids.toFixed(0)}% | presence ${b.presence.toFixed(0)}% | air ${b.air.toFixed(0)}%  (centroid ${m.spectral.centroidHz.toFixed(0)} Hz)`,
      m.stereo ? `stereo     correlation ${m.stereo.correlation.toFixed(3)}, width ${fmtDb(m.stereo.widthDb, ' dB')}` : 'stereo     (mono)',
    ].join('\n') + '\n',
  )
}

function lintCmd(argv) {
  const json = argv.includes('--json')
  const targetIdx = argv.indexOf('--target')
  const target = targetIdx !== -1 ? Number(argv[targetIdx + 1]) : undefined
  const file = argv.find((a, i) => !a.startsWith('--') && (targetIdx === -1 || i !== targetIdx + 1))
  if (!file) throw new BeatEditError('lint needs a wav file')
  const { channels, sampleRate } = decodeWav(readFileSync(file))
  const findings = lint(analyze(channels, sampleRate), target !== undefined ? { targetLufs: target } : {})
  process.stdout.write(json ? JSON.stringify(findings, null, 2) + '\n' : formatLint(findings))
  process.exitCode = findings.some((f) => f.level === 'warn') ? 1 : 0
}

/** `git show rev:path` needs the path relative to the repo root, wherever we're invoked from. */
function gitShow(rev, file) {
  const abs = resolve(file)
  const dir = dirname(abs)
  const prefix = execFileSync('git', ['-C', dir, 'rev-parse', '--show-prefix'], { encoding: 'utf8' }).trim()
  return execFileSync('git', ['-C', dir, 'show', `${rev}:${prefix}${basename(abs)}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function diffCmd(argv) {
  let aText, bText, label
  if (argv[0] === '--git') {
    const [, rev1, rev2, file] = argv
    if (!rev1 || !rev2 || !file) throw new BeatEditError('diff --git needs <rev1> <rev2> <file>')
    aText = gitShow(rev1, file)
    bText = gitShow(rev2, file)
    label = `${file}: ${rev1} -> ${rev2}`
  } else {
    const [a, b] = argv
    if (!a || !b) throw new BeatEditError('diff needs two files (or --git <rev1> <rev2> <file>)')
    aText = readFileSync(a, 'utf8')
    bText = readFileSync(b, 'utf8')
    label = `${a} -> ${b}`
  }
  const entries = diffDocuments(parse(aText), parse(bText))
  process.stdout.write(`# ${label}\n` + formatDiff(entries))
  process.exitCode = entries.length === 0 ? 0 : 1 // diff(1) convention
}

// ---- D3 history: checkpoint / history / restore (append-only, semantic labels) -------------
// "Versioning without git vocabulary" (docs/product-spec-desktop.md §4). Dynamically imported so
// this block stays self-contained.

async function checkpointCmd(argv) {
  const { checkpoint } = await import('../dist/src/history/index.js')
  const positional = argv.filter((a, i) => !a.startsWith('--') && !['--label', '--intent'].includes(argv[i - 1]))
  const [file] = positional
  if (!file) throw new BeatEditError('checkpoint needs <file> [--label L] [--intent I]')
  const label = flagValue(argv, '--label')
  const intent = flagValue(argv, '--intent')
  const result = checkpoint(file, { ...(label ? { label } : {}), ...(intent ? { intent } : {}) })
  if (result.skipped) process.stdout.write('no changes since the last checkpoint — nothing to save\n')
  else process.stdout.write(`checkpoint ${result.ref}  ${result.when}  ${result.label}\n`)
}

// Shared with the --collapsed view below: one checkpoint line, pin name (if any) and intent
// (if any) appended.
function formatHistoryLine(e) {
  const pin = e.pin ? `  [pin: ${e.pin}]` : ''
  const intent = e.intent ? `  (intent: ${e.intent})` : ''
  return `${e.ref}  ${e.when}  ${e.label}${pin}${intent}\n`
}

async function historyCmd(argv) {
  const { history, collapsedHistory } = await import('../dist/src/history/index.js')
  const limit = flagValue(argv, '--limit')
  const collapsed = argv.includes('--collapsed') || argv.includes('--pinned')
  const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--limit')
  if (!file) throw new BeatEditError('history needs <file> [--limit N] [--collapsed]')
  const opts = limit !== undefined ? { limit: Number(limit) } : {}

  if (collapsed) {
    const rows = collapsedHistory(file, opts)
    if (rows.length === 0) {
      process.stdout.write('no history yet\n')
      return
    }
    for (const row of rows) {
      if (row.kind === 'collapsed') process.stdout.write(`  ... ${row.count} more checkpoint${row.count === 1 ? '' : 's'} ...\n`)
      else process.stdout.write(formatHistoryLine(row))
    }
    return
  }

  const entries = history(file, opts)
  if (entries.length === 0) {
    process.stdout.write('no history yet\n')
    return
  }
  for (const e of entries) process.stdout.write(formatHistoryLine(e))
}

async function restoreCmd(argv) {
  const { restore } = await import('../dist/src/history/index.js')
  const [file, ref] = argv
  if (!file || !ref) throw new BeatEditError('restore needs <file> <ref> (a checkpoint from `beat history`)')
  const result = restore(file, ref)
  if (result.skipped) process.stdout.write('that version is already the current one — nothing changed\n')
  else process.stdout.write(`restored — new checkpoint ${result.ref}  ${result.label}\n`)
}

async function pinCmd(argv) {
  const { pin } = await import('../dist/src/history/index.js')
  const [file, ref, ...nameParts] = argv
  const name = nameParts.join(' ')
  if (!file || !ref || !name) throw new BeatEditError('pin needs <file> <ref> <name> (a checkpoint from `beat history`, and a name up to 25 chars)')
  const result = pin(file, ref, name)
  process.stdout.write(`pinned ${result.ref} as "${result.name}"\n`)
}

async function unpinCmd(argv) {
  const { unpin } = await import('../dist/src/history/index.js')
  const [file, ...nameParts] = argv
  const name = nameParts.join(' ')
  if (!file || !name) throw new BeatEditError('unpin needs <file> <name>')
  unpin(file, name)
  process.stdout.write(`unpinned "${name}"\n`)
}

async function pinsCmd(argv) {
  const { pins } = await import('../dist/src/history/index.js')
  const [file] = argv
  if (!file) throw new BeatEditError('pins needs <file>')
  const entries = pins(file)
  if (entries.length === 0) {
    process.stdout.write('no pins yet\n')
    return
  }
  for (const p of entries) process.stdout.write(`${p.ref}  ${p.when}  ${p.name}\n`)
}

// D2 pointing protocol: the selection lives in a running daemon's memory, so this command is a
// thin HTTP client over it (parse/serialize the grammar client-side; POST/GET JSON).
async function selectionCmd(argv) {
  const portIdx = argv.indexOf('--port')
  if (portIdx === -1 || argv[portIdx + 1] === undefined) throw new BeatEditError('selection needs --port <port> (the running daemon)')
  const base = `http://127.0.0.1:${Number(argv[portIdx + 1])}`
  const fail = async (res) => {
    const msg = await res.json().then((b) => b.error).catch(() => res.statusText)
    throw new BeatEditError(`daemon rejected the selection: ${msg}`)
  }
  if (argv.includes('--clear')) {
    const res = await fetch(`${base}/selection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    if (!res.ok) await fail(res)
    process.stdout.write('selection cleared\n')
    return
  }
  const setIdx = argv.indexOf('--set')
  if (setIdx !== -1) {
    if (argv[setIdx + 1] === undefined) throw new BeatEditError('selection --set needs a grammar string')
    const sel = parseSelection(argv[setIdx + 1])
    const res = await fetch(`${base}/selection`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sel) })
    if (!res.ok) await fail(res)
    process.stdout.write(serializeSelection(sel))
    return
  }
  const res = await fetch(`${base}/selection`)
  if (!res.ok) await fail(res)
  const sel = await res.json()
  process.stdout.write(Object.keys(sel).length === 0 ? 'no selection\n' : serializeSelection(sel))
}

// D5's "BYO-Claude-Code fallback" (docs/product-spec-desktop.md §6): `beat mcp` already runs a
// full stdio JSON-RPC MCP server, but pointing a client at it was tribal knowledge (the right
// command, the right absolute path to this repo's beat.mjs). This writes the one-file config
// Claude Code (or any MCP client) auto-discovers on startup, so opening the project folder is
// the entire setup step.
function mcpInitCmd(argv) {
  const file = argv.find((a) => !a.startsWith('--'))
  if (!file) throw new BeatEditError('mcp-init needs a <file> — the .beat project to point an MCP client at')
  if (!existsSync(file)) throw new BeatEditError(`${file} does not exist — run \`beat init ${file}\` first`)
  const force = argv.includes('--force')
  const beatScript = new URL(import.meta.url).pathname // this file's own absolute path
  const projectDir = dirname(resolve(file))
  const configPath = resolve(projectDir, '.mcp.json')
  if (existsSync(configPath) && !force) throw new BeatEditError(`${configPath} already exists — pass --force to overwrite`)
  const config = { mcpServers: { beat: { command: 'node', args: [beatScript, 'mcp'] } } }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
  process.stdout.write(
    `wrote ${configPath}\n\n` +
      `next: open ${projectDir} in Claude Code (or any MCP client that reads .mcp.json) — the\n` +
      `"beat" server is auto-discovered. Try a tool call: beat_inspect on "${basename(file)}".\n`,
  )
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  switch (cmd) {
    case 'init':
      initCmd(rest)
      break
    case 'add-track':
      addTrackCmd(rest)
      break
    case 'rm-track':
      rmTrackCmd(rest)
      break
    case 'inspect':
      await inspectCmd(rest)
      break
    case 'set':
      setCmd(rest)
      break
    case 'add-note':
      addNoteCmd(rest)
      break
    case 'rm-note':
      rmNoteCmd(rest)
      break
    case 'add-hit':
      addHitCmd(rest)
      break
    case 'rm-hit':
      rmHitCmd(rest)
      break
    case 'humanize':
      humanizeCmd(rest)
      break
    case 'quantize':
      quantizeCmd(rest)
      break
    case 'diff':
      diffCmd(rest)
      break
    case 'checkpoint':
      await checkpointCmd(rest)
      break
    case 'history':
      await historyCmd(rest)
      break
    case 'restore':
      await restoreCmd(rest)
      break
    case 'pin':
      await pinCmd(rest)
      break
    case 'unpin':
      await unpinCmd(rest)
      break
    case 'pins':
      await pinsCmd(rest)
      break
    case 'presets':
      presetsCmd(rest)
      break
    case 'vary':
      await varyCmd(rest)
      break
    case 'automate':
      automateCmd(rest)
      break
    case 'clip':
      clipCmd(rest)
      break
    case 'scene':
      sceneCmd(rest)
      break
    case 'song':
      songCmd(rest)
      break
    case 'sample':
      await sampleCmd(rest)
      break
    case 'lane':
      laneCmd(rest)
      break
    case 'score':
      await scoreCmd(rest)
      break
    case 'suggest':
      await suggestCmd(rest)
      break
    case 'preset':
      presetCmd(rest)
      break
    case 'metrics':
      metricsCmd(rest)
      break
    case 'lint':
      lintCmd(rest)
      break
    case 'mcp': {
      const { runMcpServer } = await import('../dist/src/mcp/server.js')
      await runMcpServer()
      return // serves stdio until stdin closes
    }
    case 'mcp-init':
      mcpInitCmd(rest)
      break
    case 'render': {
      // One render path now (D15): dotbeat's own engine (ui/src/audio/engine.ts) driven headless.
      // The retired `--offline` flag (BeatLab-dependent, broken in this environment) is accepted
      // and ignored so old invocations don't hard-error — the real engine is dotbeat's own either way.
      const { renderCommand } = await import('./render.mjs')
      await renderCommand(rest.filter((a) => a !== '--offline'))
      process.exit(0) // render leaves event-loop stragglers (chromium pipes, vite) — see render.mjs footer
    }
    case 'daemon': {
      const { daemonCommand } = await import('./daemon.mjs')
      await daemonCommand(rest)
      return // daemon keeps running until signaled
    }
    case 'selection':
      await selectionCmd(rest)
      break
    case 'help':
    case '--help':
    case undefined:
      console.log(USAGE)
      break
    default:
      console.error(`unknown command "${cmd}"\n\n${USAGE}`)
      process.exitCode = 2
  }
}

main().catch((err) => {
  if (err instanceof BeatEditError || err instanceof BeatParseError || err instanceof BeatPresetError || err.name === 'HistoryError') {
    console.error(`error: ${err.message}`)
    process.exitCode = 2
  } else {
    console.error(err.stack ?? String(err))
    process.exitCode = 2
  }
})
