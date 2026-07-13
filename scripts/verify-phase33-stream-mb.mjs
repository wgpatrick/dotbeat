#!/usr/bin/env node
// Live, CLI+MCP-level verification for Phase 33 Stream MB (docs/phase-33-plan.md's "MB — MCP/CLI
// parity + help-text/doc accuracy"), fixing findings from usability pilots 94/95/100
// (docs/research/94, 95, 100). Drives the REAL `beat` CLI and the REAL `beat mcp` JSON-RPC server
// end-to-end against disposable scratch projects — not core functions directly, not mocks — the
// same way pilots 94/95/100 did. Complements (does not replace) test/*.test.ts unit coverage.
//
// Usage: npm run build && node scripts/verify-phase33-stream-mb.mjs

import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const beat = join(repoRoot, 'cli', 'beat.mjs')

let checks = 0
function ok(label) {
  checks++
  console.log(`  ok — ${label}`)
}

function run(...args) {
  return execFileSync(process.execPath, [beat, ...args], { encoding: 'utf8', cwd: repoRoot })
}

// ---- a tiny, reusable MCP client (mirrors scripts/mcp-call.mjs's protocol handling, but keeps
// one `beat mcp` subprocess alive across many sequential tools/call / tools/list requests instead
// of spawning fresh per call) -----------------------------------------------------------------
class McpClient {
  constructor() {
    this.proc = spawn(process.execPath, [beat, 'mcp'], { stdio: ['pipe', 'pipe', 'inherit'] })
    this.buf = ''
    this.nextId = 1
    this.pending = new Map()
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk.toString('utf8')
      let nl
      while ((nl = this.buf.indexOf('\n')) !== -1) {
        const line = this.buf.slice(0, nl)
        this.buf = this.buf.slice(nl + 1)
        if (!line.trim()) continue
        const msg = JSON.parse(line)
        const p = this.pending.get(msg.id)
        if (p) {
          this.pending.delete(msg.id)
          p(msg)
        }
      }
    })
  }
  send(msg) {
    this.proc.stdin.write(JSON.stringify(msg) + '\n')
  }
  request(method, params) {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }
  async initialize() {
    await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify-phase33-mb', version: '0' } })
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }
  async toolsList() {
    const msg = await this.request('tools/list')
    return msg.result.tools
  }
  async call(name, args) {
    const msg = await this.request('tools/call', { name, arguments: args })
    if (msg.error) throw new Error(`protocol error calling ${name}: ${msg.error.message}`)
    const text = (msg.result.content ?? []).map((c) => c.text).join('')
    return { text, isError: !!msg.result.isError }
  }
  close() {
    this.proc.kill()
  }
}

const dir = mkdtempSync(join(tmpdir(), 'dotbeat-verify-mb-'))

try {
  const mcp = new McpClient()
  await mcp.initialize()
  const tools = await mcp.toolsList()
  const toolByName = Object.fromEntries(tools.map((t) => [t.name, t]))

  // =========================================================================================
  // Item 1: beat_add_track over MCP must materialize the real 12-lane drum kit, matching the
  // CLI's own `add-track ... drums` default (research/95's headline finding).
  // =========================================================================================
  console.log('1. beat_add_track (MCP) drums default lanes')
  const file1 = join(dir, 'song1.beat')
  run('init', file1, '--bpm', '120')
  const addDrumsResult = await mcp.call('beat_add_track', { file: file1, id: 'drums', kind: 'drums' })
  assert.ok(!addDrumsResult.isError, `beat_add_track should succeed, got: ${addDrumsResult.text}`)
  const doc1 = JSON.parse(run('inspect', file1, '--json'))
  const drumsTrack = doc1.tracks.find((t) => t.id === 'drums')
  assert.ok(drumsTrack, 'drums track exists')
  const laneNames = drumsTrack.lanes.map((l) => l.name ?? l.id ?? l).sort()
  const expected12 = ['kick', 'snare', 'rimshot', 'clap', 'hat', 'openhat', 'tom_lo', 'tom_mid', 'tom_hi', 'crash', 'ride', 'cowbell'].sort()
  assert.equal(drumsTrack.lanes.length, 12, `MCP-created drums track should have 12 lanes, got ${drumsTrack.lanes.length}: ${JSON.stringify(laneNames)}`)
  assert.deepEqual(laneNames, expected12, 'MCP-created drums track lane set matches the CLI\'s documented 12-lane kit exactly')
  // cross-check: an identical CLI-created drums track produces the same lane set (the parity check
  // pilot 95 did by comparing sessions with pilot 94's independent CLI run)
  const file1b = join(dir, 'song1b.beat')
  run('init', file1b, '--bpm', '120')
  run('add-track', file1b, 'drums', 'drums')
  const doc1b = JSON.parse(run('inspect', file1b, '--json'))
  const cliLaneNames = doc1b.tracks
    .find((t) => t.id === 'drums')
    .lanes.map((l) => l.name ?? l.id ?? l)
    .sort()
  assert.deepEqual(laneNames, cliLaneNames, 'MCP-created and CLI-created drums tracks now produce byte-identical lane sets')
  ok('beat_add_track (MCP) on a drums track materializes the real 12-lane kit, matching the CLI exactly')

  // =========================================================================================
  // Item 2: `beat mcp`'s top-level help text must not claim 1:1 CLI/MCP tool parity.
  // =========================================================================================
  console.log('2. `beat mcp` help text does not overstate tool coverage')
  const topLevelUsage = execFileSync(process.execPath, [beat], { encoding: 'utf8', cwd: repoRoot })
  assert.ok(!/all of the above as tools/i.test(topLevelUsage), 'top-level help no longer claims "all of the above as tools"')
  for (const cliOnly of ['vary', 'score', 'sample', 'lane', 'daemon']) {
    assert.ok(
      new RegExp(cliOnly).test(topLevelUsage.match(/beat mcp[\s\S]*?\n\n/)?.[0] ?? topLevelUsage),
      `help text's beat mcp block mentions CLI-only command "${cliOnly}"`,
    )
  }
  // and the actual live tool surface really does lack MCP equivalents for those 5, confirming the
  // new help text describes reality rather than just asserting it
  for (const cliOnlyToolName of ['beat_vary', 'beat_score', 'beat_sample', 'beat_lane', 'beat_daemon']) {
    assert.ok(!toolByName[cliOnlyToolName], `${cliOnlyToolName} genuinely has no MCP tool (confirms the help text's claim)`)
  }
  ok('`beat mcp` help text no longer claims full CLI parity, and names the actual CLI-only commands')

  // =========================================================================================
  // Item 3: beat_checkpoint's tool description documents the first-checkpoint auto-label
  // behavior, and the real behavior matches (core, unchanged) — first checkpoint on a fresh
  // project always labels "checkpoint" even with real content already present.
  // =========================================================================================
  console.log('3. beat_checkpoint description documents first-checkpoint auto-label + behavior matches')
  const checkpointDesc = toolByName['beat_checkpoint'].description
  assert.match(checkpointDesc, /first checkpoint/i, 'beat_checkpoint description mentions the first-checkpoint case')
  assert.match(checkpointDesc, /"checkpoint"/, 'beat_checkpoint description names the literal fallback label')
  const file3 = join(dir, 'song3.beat')
  run('init', file3, '--bpm', '120')
  run('add-note', file3, 'lead', '60', '0', '4', '0.8')
  run('add-note', file3, 'lead', '64', '4', '4', '0.7')
  const firstCkpt = await mcp.call('beat_checkpoint', { file: file3 })
  assert.match(firstCkpt.text, /\bcheckpoint\b/, 'first-ever checkpoint response includes the bare "checkpoint" label')
  assert.ok(!/note added|pitch/.test(firstCkpt.text), 'first checkpoint label is generic, not a semantic diff, even though real notes exist')
  run('add-note', file3, 'lead', '67', '8', '4', '0.6')
  const secondCkpt = await mcp.call('beat_checkpoint', { file: file3 })
  assert.match(secondCkpt.text, /note/, 'second checkpoint (a real prior version to diff against) DOES produce a semantic diff label')
  ok('beat_checkpoint description documents the first-checkpoint fallback, and live behavior matches it')

  // =========================================================================================
  // Item 4: add-note/add-hit velocity is documented as 0-1 (not MIDI 0-127) in both surfaces.
  // =========================================================================================
  console.log('4. add-note/add-hit velocity range documented as 0-1')
  assert.match(topLevelUsage, /add-note[\s\S]{0,120}0-1/, 'CLI top-level help documents add-note velocity as 0-1')
  assert.match(topLevelUsage, /add-hit[\s\S]{0,200}0-1/, 'CLI top-level help documents add-hit velocity as 0-1')
  assert.match(toolByName['beat_add_note'].description, /0\.\.1|0-1/, 'beat_add_note MCP description documents velocity 0..1')
  assert.match(toolByName['beat_add_hit'].description, /0\.\.1|0-1/, 'beat_add_hit MCP description documents velocity 0..1')
  assert.match(toolByName['beat_add_note'].inputSchema.properties.velocity.description ?? '', /MIDI/, 'beat_add_note velocity schema field itself calls out the MIDI-0-127 trap')
  assert.match(toolByName['beat_add_hit'].inputSchema.properties.velocity.description ?? '', /MIDI/, 'beat_add_hit velocity schema field itself calls out the MIDI-0-127 trap')
  // functional confirmation the 0-1 convention is still what's actually enforced (unchanged core
  // behavior; this is a doc fix, not a behavior change) — a MIDI-scale value is rejected
  assert.throws(() => run('add-note', join(dir, 'song1.beat'), 'lead', '60', '0', '4', '100'), /velocity must be 0\.\.1/, 'CLI still rejects a MIDI-scale (100) velocity exactly as before')
  ok('velocity 0-1 (not MIDI 0-127) is documented in the CLI help and both MCP tool descriptions/schemas')

  // =========================================================================================
  // Item 5: fresh synth/drums tracks' default effect chain is documented in both surfaces, and
  // matches addTrack's real default (eq3 -> comp -> distortion -> bitcrush).
  // =========================================================================================
  console.log('5. default effect chain documented + verified against real addTrack defaults')
  assert.match(topLevelUsage, /add-track[\s\S]{0,700}eq3.{0,20}comp.{0,20}distortion.{0,20}bitcrush/, 'CLI add-track help names the exact default effect chain')
  assert.match(toolByName['beat_add_track'].description, /eq3.{0,20}comp.{0,20}distortion.{0,20}bitcrush/, 'beat_add_track MCP description names the exact default effect chain')
  const file5 = join(dir, 'song5.beat')
  run('init', file5, '--bpm', '120') // init's starter track is a fresh synth track
  const doc5 = JSON.parse(run('inspect', file5, '--json'))
  const starterEffects = doc5.tracks[0].effects.map((e) => e.type)
  assert.deepEqual(starterEffects, ['eq3', 'comp', 'distortion', 'bitcrush'], 'a fresh synth track really does start with exactly this 4-effect chain, in this order')
  assert.ok(doc5.tracks[0].effects.every((e) => e.enabled), 'all 4 default effects start enabled')
  ok('add-track help/description accurately name the real default effect chain (eq3, comp, distortion, bitcrush)')

  // =========================================================================================
  // Item 6: `clip` accumulates live content across snapshots (intentional, matches the daemon's
  // own "+ capture scene" / sceneFromLiveContent precedent) — confirm the behavior, confirm the
  // CLI help text now documents it, and confirm the MCP beat_song `clips` field does too.
  // =========================================================================================
  console.log('6. `clip` live-content accumulation: documented, and confirmed intentional (not a bug)')
  assert.match(topLevelUsage, /beat clip[\s\S]{0,700}(accumulat|not empty|verse|chorus)/i, 'CLI clip help text now explains the live-content-accumulation semantic')
  const clipsFieldDesc = toolByName['beat_song'].inputSchema.properties.clips.description
  assert.match(clipsFieldDesc, /accumulat|not empty/i, 'MCP beat_song\'s clips field also documents the same accumulation semantic')
  const file6 = join(dir, 'song6.beat')
  run('init', file6, '--bpm', '120', '--bars', '4')
  run('add-note', file6, 'lead', '60', '0', '4', '0.8') // "verse" content: 1 note
  run('clip', file6, 'lead', 'verse-lead')
  run('add-note', file6, 'lead', '64', '4', '4', '0.7') // add "chorus" content on top, WITHOUT clearing verse
  run('clip', file6, 'lead', 'chorus-lead')
  const doc6 = JSON.parse(run('inspect', file6, '--json'))
  const lead6 = doc6.tracks.find((t) => t.id === 'lead')
  const verseClip = lead6.clips.find((c) => c.id === 'verse-lead')
  const chorusClip = lead6.clips.find((c) => c.id === 'chorus-lead')
  assert.equal(verseClip.notes.length, 1, 'verse clip has exactly the 1 note live at the time it was snapshotted')
  assert.equal(chorusClip.notes.length, 2, 'chorus clip accumulated BOTH notes (verse-plus-chorus), reproducing pilot 94\'s exact finding')
  ok('`clip` genuinely accumulates live content across sequential snapshots — confirmed intentional (matches captureAndInsertScene/sceneFromLiveContent\'s documented "current live state" model in src/daemon/daemon.ts) and now documented in both the CLI help and the MCP beat_song description, not changed behavior')

  mcp.close()
  console.log(`\n${checks} checks passed.`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
