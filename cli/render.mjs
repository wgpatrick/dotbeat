#!/usr/bin/env node
// beat render — Phase 0 prototype of the CLI render path (docs/phase-0-plan.md, Track B.5).
//
// Renders a .beat file to a real WAV by driving the actual BeatLab app in headless Chromium:
// parse the file, boot a beatlab dev server, land on the default sandbox groove (so everything
// v0 doesn't model — swing, arrangement, the other ~65 SynthParams fields — is already a valid
// default), overlay the .beat document's tracks/notes/9-param synth subset onto it via the
// store's own actions (so BeatLab's own merge logic does the work, not a hand-rolled duplicate),
// then call the exact recordWav() export path ProjectToolbar's "Export WAV" button uses, and
// write the resulting bytes to disk.
//
// v0 prototype limitation: track IDs in the .beat file must match tracks already present in the
// default sandbox groove (drums/bass/chords/lead) — creating brand-new tracks isn't wired up
// yet. Reusing/hand-editing an exported real project (see test/fixtures/real-sandbox.beatlab.json
// and its converted .beat form) is exactly the intended v0 workflow.
//
// Usage:
//   node cli/render.mjs <project.beat> -o <output.wav> --beatlab-dir /path/to/beatlab [--port 5872]
//   BEATLAB_DIR=/path/to/beatlab node cli/render.mjs <project.beat>
//
// Requires `npm run build` to have run first (reads compiled ../dist/src/core).

import { readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import { parse } from '../dist/src/core/index.js'

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

async function spawnBeatlabDevServer(beatlabDir, port) {
  // `npx` execs through an intermediate `sh -c` before reaching the real vite process (confirmed
  // by inspecting the process tree in this session) — plain vite.kill() only signals the `npx`
  // wrapper and leaves the actual dev server orphaned and running. detached:true puts the whole
  // tree in its own process group so killVite() below can take it out with one negative-PID kill.
  const vite = spawn('npx', ['vite', '--port', String(port)], { cwd: beatlabDir, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('vite did not announce a URL within 30s')), 30000)
    let buf = ''
    const onData = (chunk) => {
      buf += chunk.toString()
      const clean = buf.replace(/\x1B\[[0-9;]*m/g, '') // vite ANSI-bolds the port mid-string
      const m = clean.match(/Local:\s+(http:\/\/localhost:\d+\/musiclearning\/)/)
      if (m) {
        clearTimeout(timer)
        resolve(m[1])
      }
    }
    vite.stdout.on('data', onData)
    vite.stderr.on('data', onData)
    vite.on('exit', (code) => reject(new Error(`vite exited early (code ${code}): ${buf.slice(-300)}`)))
  })
  return { vite, url }
}

function killVite(vite) {
  try {
    process.kill(-vite.pid, 'SIGTERM') // negative PID = whole process group, see detached:true above
  } catch {
    vite.kill() // group already gone, or platform doesn't support negative-PID kill — best effort
  }
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
    await page.evaluate((doc) => {
      window.__store.getState().goToSandbox()
      for (const t of doc.tracks) {
        const s = window.__store.getState()
        const track = s.tracks.find((x) => x.id === t.id)
        if (!track) {
          throw new Error(
            `track "${t.id}" from the .beat file has no matching track in the default sandbox groove ` +
              `(v0 prototype limitation — see beatlab-daw/docs/phase-0-plan.md)`,
          )
        }
        s.setSynth(t.id, t.synth)
        s.clearTrack(t.id)
        for (const n of t.notes) {
          s.recordNote(t.id, { pitch: n.pitch, start: n.start, duration: n.duration, velocity: n.velocity })
        }
      }
      window.__store.setState({ bpm: doc.bpm, loopBars: doc.loopBars, selectedTrackId: doc.selectedTrack })
    }, doc)

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
