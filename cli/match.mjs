#!/usr/bin/env node
// beat match — the T6 sound-matching harness (docs/t6-sound-matching.md): CMA-ES over the synth
// engine's continuous params against a 1-2s target chop, rendered through dotbeat's OWN engine
// (offline compute, one headless session for the whole run), loss = log-mel multi-scale + MFCC +
// envelope on loudness-normalized audio, pitch frozen from f0 detection. Outputs a diffable
// `beat set` patch, the loss curve, and a ceiling report in MFCC + CLAP cosine.
//
// Usage:
//   beat match <target.wav> [--track-kind synth|drum-sampler] [--budget N] [--population N]
//              [--out <dir>] [--seed N] [--no-clap]
//
// The default budget (50) is deliberately smoke-scale: it proves the plumbing, not the ceiling.
// Real ceiling runs are owner-side at 2000-5000 renders/target (research/107 §2.3: 90% of the
// gain lands early). See docs/t6-sound-matching.md for budget guidance and how to read the report.

import { existsSync, mkdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--track-kind') args.trackKind = argv[++i]
    else if (a === '--budget') args.budget = argv[++i]
    else if (a === '--population') args.population = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--seed') args.seed = argv[++i]
    else if (a === '--no-clap') args.noClap = true
    else if (a === '--daemon-port') args.daemonPort = argv[++i]
    else if (a === '--preview-port') args.previewPort = argv[++i]
    else if (a.startsWith('--')) {
      console.error(
        `error: unknown flag "${a}" (known: --track-kind, --budget, --population, --out, --seed, --no-clap, --daemon-port, --preview-port)`,
      )
      process.exit(2)
    } else args._.push(a)
  }
  return args
}

export async function matchCommand(argv) {
  const args = parseArgs(argv)
  const targetPath = args._[0]
  if (!targetPath) {
    console.error('usage: beat match <target.wav> [--track-kind synth|drum-sampler] [--budget N] [--population N] [--out <dir>] [--seed N] [--no-clap]')
    process.exit(1)
  }
  if (!existsSync(targetPath)) {
    console.error(`error: no target wav at ${targetPath}`)
    process.exit(2)
  }
  const trackKind = args.trackKind ?? 'synth'
  if (trackKind !== 'synth' && trackKind !== 'drum-sampler') {
    console.error(`error: --track-kind must be "synth" or "drum-sampler", got "${trackKind}"`)
    process.exit(2)
  }
  const budget = args.budget !== undefined ? Number(args.budget) : 50
  const population = args.population !== undefined ? Number(args.population) : 24
  const seed = args.seed !== undefined ? Number(args.seed) : 41
  if (!Number.isInteger(budget) || budget < 20) {
    console.error(`error: --budget must be an integer >= 20 (got "${args.budget}")`)
    process.exit(2)
  }
  if (!Number.isInteger(population) || population < 4) {
    console.error(`error: --population must be an integer >= 4 (got "${args.population}")`)
    process.exit(2)
  }
  const outDir = resolve(args.out ?? `match-${basename(targetPath).replace(/\.wav$/i, '')}`)
  mkdirSync(outDir, { recursive: true })

  const { runMatch, formatMatchReport, BeatMatchError } = await import('../dist/src/match/index.js')
  const { startMatchRenderSession } = await import('./render.mjs')

  let failure = null
  try {
    const result = await runMatch({
      targetWavPath: resolve(targetPath),
      outDir,
      trackKind,
      budget,
      population,
      seed,
      clap: !args.noClap,
      log: (line) => console.error(line),
      sessionFactory: async (projectDir, initialText) => {
        // One offline engine session serves the run — but RECYCLED every ~350 renders: the
        // headless page degrades after roughly 570-600 offline renders (measured twice — a
        // budget-800 run wedged near render 580 both times; each offline render builds a full
        // engine graph in a fresh OfflineContext and the page's heap never fully recovers).
        // A recycle costs one ~15s boot per 350 renders — noise next to the renders themselves.
        const RECYCLE_EVERY = 350
        const scratchPath = join(projectDir, 'current.beat')
        const bootOpts = { daemonPort: args.daemonPort, previewPort: args.previewPort }
        console.error('booting one offline render session for the whole run (daemon + vite + headless Chromium)...')
        let inner = await startMatchRenderSession(scratchPath, initialText, bootOpts)
        let sessionRenders = 0
        return {
          async render(text, seconds) {
            if (sessionRenders >= RECYCLE_EVERY) {
              console.error(`recycling the render session after ${sessionRenders} renders (fresh page; the search continues)...`)
              await inner.close()
              inner = await startMatchRenderSession(scratchPath, text, bootOpts)
              sessionRenders = 0
            }
            sessionRenders++
            return inner.render(text, seconds)
          },
          close: () => inner.close(),
        }
      },
    })
    console.log(formatMatchReport(result.report))
    console.log(`\nwrote:`)
    console.log(`  ${result.bestBeatPath}   (the winning one-note project)`)
    if (existsSync(result.bestWavPath)) console.log(`  ${result.bestWavPath}    (its render)`)
    console.log(`  ${result.patchPath}   (the patch as beat set lines)`)
    console.log(`  ${result.lossCurvePath}`)
    console.log(`  ${result.reportPath}`)
  } catch (err) {
    failure = err
  }
  if (failure) {
    if (failure.name === 'BeatMatchError' || failure.name === 'WavDecodeError') {
      console.error(`error: ${failure.message}`)
    } else {
      console.error(failure.stack ?? String(failure))
    }
    process.exit(1)
  }
  process.exit(0) // chromium/vite stragglers keep the loop alive — same story as render.mjs
}
