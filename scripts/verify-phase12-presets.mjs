#!/usr/bin/env node
// Phase 12 Stream 2 verification: apply every new factory preset to a real track, render it
// (real browser Web Audio via cli/render.mjs — the offline node-web-audio-api path needs a
// patched native build not present in every checkout, see cli/render-offline.mjs), and measure
// it with this project's own metrics engine (src/metrics/analyze.ts). Prints one JSON line per
// preset so results can be diffed/grepped; the numbers this prints are what docs/phase-12-presets.md
// cites as evidence.
//
// Usage: node scripts/verify-phase12-presets.mjs --beatlab-dir <path> [--only name1,name2] [--port 5900]
//
// Requires `npm run build` to have run first, and a real node-web-audio-api install is NOT
// required (this uses the browser render path only).

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const beatCli = join(root, 'cli', 'beat.mjs')
const renderCli = join(root, 'cli', 'render.mjs')

function args() {
  const a = { only: null, beatlabDir: null, port: 5900 }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--beatlab-dir') a.beatlabDir = argv[++i]
    else if (argv[i] === '--only') a.only = argv[++i].split(',')
    else if (argv[i] === '--port') a.port = Number(argv[++i])
  }
  a.beatlabDir ??= process.env.BEATLAB_DIR
  if (!a.beatlabDir) throw new Error('need --beatlab-dir or BEATLAB_DIR')
  return a
}

function beat(cliArgs) {
  return execFileSync(process.execPath, [beatCli, ...cliArgs], { encoding: 'utf8' })
}

async function main() {
  const { only, beatlabDir, port } = args()
  const { parsePresetLibrary } = await import(pathToFileURL(join(root, 'dist/src/core/index.js')).href)
  const { decodeWav, analyze } = await import(pathToFileURL(join(root, 'dist/src/metrics/index.js')).href)
  const factoryJson = readFileSync(join(root, 'presets', 'factory.json'), 'utf8')
  let presets = parsePresetLibrary(factoryJson)
  if (only) presets = presets.filter((p) => only.includes(p.name))

  const results = []
  let portN = port
  for (const preset of presets) {
    const dir = mkdtempSync(join(tmpdir(), 'beat-p12-verify-'))
    const file = join(dir, 'song.beat')
    beat(['init', file, '--bpm', '100', '--bars', '1'])
    const trackId = 'x'
    const kind = preset.kind === 'drums' ? 'drums' : 'synth'
    beat(['add-track', file, trackId, kind])
    beat(['preset', file, trackId, preset.name])
    if (kind === 'synth') {
      beat(['add-note', file, trackId, '60', '0', '8', '0.9'])
    } else {
      // exercise every lane so kick/snare/hat/openhat/clap character all render
      beat(['add-hit', file, trackId, 'kick', '0', '1'])
      beat(['add-hit', file, trackId, 'kick', '8', '1'])
      beat(['add-hit', file, trackId, 'snare', '4', '0.9'])
      beat(['add-hit', file, trackId, 'snare', '12', '0.9'])
      beat(['add-hit', file, trackId, 'hat', '0', '0.7'])
      beat(['add-hit', file, trackId, 'hat', '2', '0.7'])
      beat(['add-hit', file, trackId, 'hat', '4', '0.7'])
      beat(['add-hit', file, trackId, 'hat', '6', '0.7'])
      beat(['add-hit', file, trackId, 'hat', '8', '0.7'])
      beat(['add-hit', file, trackId, 'hat', '10', '0.7'])
      beat(['add-hit', file, trackId, 'hat', '12', '0.7'])
      beat(['add-hit', file, trackId, 'hat', '14', '0.7'])
      beat(['add-hit', file, trackId, 'openhat', '14', '0.8'])
      beat(['add-hit', file, trackId, 'clap', '4', '0.85'])
    }
    const wav = join(dir, 'out.wav')
    try {
      execFileSync(
        process.execPath,
        [renderCli, file, '-o', wav, '--beatlab-dir', beatlabDir, '--port', String(portN)],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
    } catch (e) {
      console.error(`RENDER FAILED for ${preset.name}: ${e.stderr?.toString().slice(-500) ?? e.message}`)
      portN++
      continue
    }
    portN++ // fresh port per render avoids any lingering-server port clash
    const { channels, sampleRate } = decodeWav(readFileSync(wav))
    const m = analyze(channels, sampleRate)
    const row = {
      name: preset.name,
      kind: preset.kind,
      peakDbfs: round(m.samplePeakDbfs),
      rmsDbfs: round(m.rmsDbfs),
      crestDb: round(m.crestDb),
      centroidHz: round(m.spectral.centroidHz),
      bands: {
        sub: round(m.spectral.bandsPct.sub),
        bass: round(m.spectral.bandsPct.bass),
        mids: round(m.spectral.bandsPct.mids),
        presence: round(m.spectral.bandsPct.presence),
        air: round(m.spectral.bandsPct.air),
      },
    }
    results.push(row)
    console.log(JSON.stringify(row))
  }
  console.error(`\n${results.length}/${presets.length} presets rendered and measured.`)
}

function round(x) {
  return typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) / 100 : x
}

main().catch((e) => {
  console.error(e.stack ?? String(e))
  process.exit(1)
})
