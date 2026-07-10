#!/usr/bin/env node
// beat render — Phase 0 prototype of the CLI render path (docs/phase-0-plan.md, Track B.5).
//
// Renders a .beat file to a real WAV by driving the actual BeatLab app in headless Chromium:
// parse the file, boot a beatlab dev server, apply the document through the store's own
// applyDawState action — the SAME apply path the daw-daemon bridge uses (one typed boundary,
// two consumers: the openDAW lesson, see beatlab-daw/docs/phase-1-plan.md). Tracks that only
// exist in the file are created (partial synth merged onto beatlab's live defaults), drum
// patterns apply, tracks absent from the file are dropped: the file is the root document.
// Then call the exact recordWav() export path ProjectToolbar's "Export WAV" button uses, and
// write the resulting bytes to disk.
//
// Usage:
//   node cli/render.mjs <project.beat> -o <output.wav> --beatlab-dir /path/to/beatlab [--port 5872]
//   BEATLAB_DIR=/path/to/beatlab node cli/render.mjs <project.beat>
//
// Requires `npm run build` to have run first (reads compiled ../dist/src/core).

import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { parse, beatDocumentToPartialTracks } from '../dist/src/core/index.js'
import { spawnBeatlabDevServer, killVite } from './devserver.mjs'

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-o' || a === '--out') args.out = argv[++i]
    else if (a === '--beatlab-dir') args.beatlabDir = argv[++i]
    else if (a === '--port') args.port = argv[++i]
    else args._.push(a)
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const beatPath = args._[0]
  if (!beatPath) {
    console.error('usage: node cli/render.mjs <project.beat> -o <output.wav> --beatlab-dir <path to beatlab checkout>')
    process.exit(1)
  }
  const outPath = args.out ?? beatPath.replace(/\.beat$/, '') + '.wav'
  const beatlabDir = args.beatlabDir ?? process.env.BEATLAB_DIR
  if (!beatlabDir) {
    console.error('need a beatlab checkout: pass --beatlab-dir <path> or set BEATLAB_DIR')
    process.exit(1)
  }
  const port = args.port ?? '5872'

  const doc = parse(readFileSync(beatPath, 'utf8'))
  console.log(`parsed ${beatPath}: ${doc.tracks.length} track(s), bpm ${doc.bpm}, loop_bars ${doc.loopBars}`)

  console.log('starting beatlab dev server...')
  const { vite, url } = await spawnBeatlabDevServer(beatlabDir, port)

  let browser
  try {
    browser = await chromium.launch({
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required'],
    })
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    console.log('loading app...')
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.__store && window.__engine, { timeout: 10000 })

    console.log('applying .beat document to the sandbox...')
    await page.evaluate((partial) => {
      window.__store.getState().goToSandbox()
      window.__store.getState().applyDawState(partial)
    }, beatDocumentToPartialTracks(doc))

    if (pageErrors.length) throw new Error('page error(s) after applying the document:\n' + pageErrors.join('\n'))

    console.log('rendering (real-time capture — takes about as long as the loop itself)...')
    const base64 = await page.evaluate(async () => {
      const blob = await window.__store.getState().exportSandboxWav()
      if (!blob) throw new Error('exportSandboxWav returned null — not in sandbox mode?')
      const buf = await blob.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      return btoa(binary)
    })

    if (pageErrors.length) throw new Error('page error(s) during render:\n' + pageErrors.join('\n'))

    const wavBytes = Buffer.from(base64, 'base64')
    writeFileSync(outPath, wavBytes)
    console.log(`wrote ${outPath} (${wavBytes.length} bytes)`)
  } finally {
    await browser?.close()
    killVite(vite)
  }
}

main()
  .then(() => process.exit(0)) // vite.kill()/browser.close() alone don't reliably drain the
  // event loop (esbuild's service process, open pipes) — same fix scripts/smoke.mjs already
  // needed for the same reason; without this the CLI hangs after printing success.
  .catch((err) => {
    console.error(err.stack ?? String(err))
    process.exit(1)
  })
