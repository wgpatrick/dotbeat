#!/usr/bin/env node
// Phase 3 closed-loop verification — docs/phase-3-plan.md §3.5.
//
// The deterministic skeleton of ROADMAP M3's exit criterion ("render a project, read its
// metrics, and propose a diff that measurably moves LUFS toward a target"), chaining ONLY the
// operations an agent has over MCP: render → metrics → set (volume edits) → diff → re-render →
// re-measure → assert loudness measurably moved toward the target.
//
// Usage: node scripts/verify-m3.mjs --beatlab-dir /path/to/beatlab

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--beatlab-dir') args.beatlabDir = argv[++i]
    else if (argv[i] === '--offline') args.offline = true
  }
  return args
}

function run(args) {
  return execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function beat(args, expectExit) {
  try {
    return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    if (expectExit !== undefined && err.status === expectExit) return (err.stdout ?? '') + (err.stderr ?? '')
    throw new Error(`beat ${args.join(' ')} exited ${err.status}:\n${err.stderr ?? ''}${err.stdout ?? ''}`)
  }
}

async function main() {
  const { beatlabDir = process.env.BEATLAB_DIR, offline } = parseArgs(process.argv.slice(2))
  if (!beatlabDir) {
    console.error('need a beatlab checkout: pass --beatlab-dir <path> or set BEATLAB_DIR')
    process.exit(1)
  }

  const dir = mkdtempSync(join(tmpdir(), 'beat-m3-'))
  const song = join(dir, 'song.beat')
  const baseline = join(dir, 'baseline.beat')
  copyFileSync(join(repoRoot, 'examples', 'real-groove.beat'), song)
  copyFileSync(song, baseline)

  const render = (input, output, port) =>
    offline
      ? run([join(repoRoot, 'cli', 'render-offline.mjs'), input, '-o', output, '--beatlab-dir', beatlabDir])
      : beat(['render', input, '-o', output, '--beatlab-dir', beatlabDir, '--port', port])

  // 1. render + measure the baseline
  console.log(`render #1 (baseline${offline ? ', offline engine' : ''})...`)
  render(song, join(dir, 'v0.wav'), '5881')
  const m0 = JSON.parse(beat(['metrics', join(dir, 'v0.wav'), '--json']))
  console.log(`baseline: ${m0.integratedLufs.toFixed(2)} LUFS, true peak ${m0.truePeakDbtp.toFixed(2)} dBTP`)

  // 2. pick a target the way an agent would be given one, then propose the edit the lint
  //    suggestion phrasing implies: move every track volume by the LUFS delta
  const target = m0.integratedLufs + 3 // "make it 3 LU louder" — a concrete, measurable ask
  console.log(`target: ${target.toFixed(2)} LUFS (baseline + 3)`)
  const doc = JSON.parse(beat(['inspect', song, '--json']))
  const edits = []
  for (const t of doc.tracks) {
    edits.push(`${t.id}.volume`, String(Math.round((t.synth.volume + 3) * 10) / 10))
  }
  const editList = beat(['set', song, ...edits])
  console.log('proposed + applied edits (the "diff" of the exit criterion):')
  process.stdout.write(beat(['diff', baseline, song], 1))
  if (!/volume/.test(editList)) throw new Error('volume edits did not apply')

  // 3. re-render + re-measure
  console.log('render #2 (after edits)...')
  render(song, join(dir, 'v1.wav'), '5882')
  const m1 = JSON.parse(beat(['metrics', join(dir, 'v1.wav'), '--json']))
  console.log(`after: ${m1.integratedLufs.toFixed(2)} LUFS (was ${m0.integratedLufs.toFixed(2)}, target ${target.toFixed(2)})`)

  // 4. the actual assertion: measurably moved toward the target
  const before = Math.abs(m0.integratedLufs - target)
  const after = Math.abs(m1.integratedLufs - target)
  if (!(after < before - 1)) {
    throw new Error(`loudness did not measurably move toward the target: |Δ| ${before.toFixed(2)} -> ${after.toFixed(2)} LU`)
  }
  console.log(`\nM3 closed loop: PROVEN — distance to target ${before.toFixed(2)} LU -> ${after.toFixed(2)} LU`)
  console.log(`(moved ${(m1.integratedLufs - m0.integratedLufs).toFixed(2)} LU with a +3 dB per-track volume edit)`)
  console.log(`work dir kept: ${dir}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.stack ?? String(err))
    process.exit(1)
  })
