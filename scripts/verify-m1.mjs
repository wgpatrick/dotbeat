#!/usr/bin/env node
// Phase 1 (ROADMAP M1) end-to-end verification — docs/phase-1-plan.md §1.6.
//
// Boots the whole real stack (daemon on a git-tracked .beat file + BeatLab dev server + headless
// Chromium with the daw bridge active) and proves the M1 exit criteria with measured latencies:
//
//   A. GUI knob-turn  → the file changes, `git diff` is exactly one line     (+ latency ms)
//   B. file edit      → the GUI's store reflects it, playback keeps running  (+ latency ms)
//   C. a track that exists only in the file appears in the GUI, fully reconstituted
//   D. a drum step toggled in the file lands in the GUI's pattern
//   E. quiescence: after all that, nothing rewrites the file in the background (no echo loops)
//
// Usage: node scripts/verify-m1.mjs --beatlab-dir /path/to/beatlab [--port 5877] [--daemon-port 8421]

import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright-core'
import { startDaemon } from '../dist/src/daemon/daemon.js'
import { spawnBeatlabDevServer, killVite } from '../cli/devserver.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--beatlab-dir') args.beatlabDir = argv[++i]
    else if (argv[i] === '--port') args.port = argv[++i]
    else if (argv[i] === '--daemon-port') args.daemonPort = Number(argv[++i])
  }
  return args
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pollUntil(fn, what, timeoutMs = 5000, everyMs = 10) {
  const t0 = performance.now()
  for (;;) {
    if (await fn()) return performance.now() - t0
    if (performance.now() - t0 > timeoutMs) throw new Error(`timed out after ${timeoutMs}ms waiting for: ${what}`)
    await sleep(everyMs)
  }
}

function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const beatlabDir = args.beatlabDir ?? process.env.BEATLAB_DIR
  if (!beatlabDir) {
    console.error('need a beatlab checkout: pass --beatlab-dir <path> or set BEATLAB_DIR')
    process.exit(1)
  }

  // A real git repo around the .beat file — criterion A says `git diff`, so use actual git.
  const workDir = mkdtempSync(join(tmpdir(), 'beat-m1-'))
  const beatFile = join(workDir, 'song.beat')
  copyFileSync(join(repoRoot, 'examples', 'real-groove.beat'), beatFile)
  git(workDir, 'init', '-q')
  git(workDir, '-c', 'user.name=verify', '-c', 'user.email=verify@local', 'commit', '-qam', 'initial', '--allow-empty')
  git(workDir, 'add', 'song.beat')
  git(workDir, '-c', 'user.name=verify', '-c', 'user.email=verify@local', 'commit', '-qm', 'song v1')

  console.log('starting beat daemon...')
  const daemon = await startDaemon({ filePath: beatFile, port: args.daemonPort ?? 8421 })

  console.log('starting beatlab dev server...')
  const { vite, url } = await spawnBeatlabDevServer(beatlabDir, args.port ?? '5877')

  let browser
  const results = {}
  try {
    browser = await chromium.launch({
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required'],
    })
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    console.log('loading app with ?daw=' + daemon.port + ' ...')
    // NOT networkidle: the bridge's SSE stream is a deliberately never-ending request, so
    // networkidle would never fire. Found by running this, not by reading it.
    await page.goto(url + '?daw=' + daemon.port, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__engine, { timeout: 10000 })

    // The bridge pulls the file on SSE-open; the file (bpm 126) wins over the default sandbox.
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().bpm === 126 && window.__store.getState().mode === 'sandbox'),
      'bridge to apply the initial document from the file',
    )
    console.log('bridge connected, file applied (bpm 126).')

    // Start playback so criterion B can prove hot-reload doesn't interrupt it.
    await page.evaluate(() => window.__store.getState().play())
    await pollUntil(() => page.evaluate(() => window.__store.getState().isPlaying), 'playback to start')

    // ---- A. GUI edit → one-line git diff ----------------------------------------------------
    {
      const t0 = performance.now()
      await page.evaluate(() => window.__store.getState().setSynth('lead', { cutoff: 777 }))
      await pollUntil(() => readFileSync(beatFile, 'utf8').includes('    cutoff 777'), 'GUI edit to reach the file')
      results.guiToFileMs = performance.now() - t0
      const numstat = git(workDir, 'diff', '--numstat').trim()
      if (numstat !== '1\t1\tsong.beat') throw new Error(`expected a one-line diff (1\\t1\\tsong.beat), got: "${numstat}"`)
      const diff = git(workDir, 'diff', '--unified=0')
      if (!/^\+ {4}cutoff 777$/m.test(diff)) throw new Error('diff does not contain the +cutoff 777 line:\n' + diff)
      console.log(`A ✓ GUI knob-turn → one-line git diff (-cutoff 3200 / +cutoff 777) in ${Math.round(results.guiToFileMs)}ms`)
      git(workDir, '-c', 'user.name=verify', '-c', 'user.email=verify@local', 'commit', '-qam', 'gui edit')
    }

    // ---- B. file edit → GUI updates, playback uninterrupted ---------------------------------
    {
      const text = readFileSync(beatFile, 'utf8')
      writeFileSync(beatFile, text.replace('    cutoff 777', '    cutoff 555'))
      results.fileToGuiMs = await pollUntil(
        () => page.evaluate(() => window.__store.getState().tracks.find((t) => t.id === 'lead')?.synth.cutoff === 555),
        'file edit to reach the GUI store',
      )
      const stillPlaying = await page.evaluate(() => window.__store.getState().isPlaying)
      if (!stillPlaying) throw new Error('playback stopped during a file-edit hot reload — restore semantics leaked in')
      console.log(`B ✓ file edit → GUI store updated in ${Math.round(results.fileToGuiMs)}ms, playback uninterrupted`)
    }

    // ---- C. a track that exists only in the file appears in the GUI -------------------------
    {
      const newTrack = [
        'track pluck Pluck #98c379 synth',
        '  synth',
        '    osc triangle',
        '    volume -12',
        '    cutoff 2500',
        '    resonance 1.1',
        '    attack 0.005',
        '    decay 0.2',
        '    sustain 0.3',
        '    release 0.2',
        '    pan 0.2',
        '  note p1 76 0 2 0.9',
        '',
      ].join('\n')
      writeFileSync(beatFile, readFileSync(beatFile, 'utf8') + '\n' + newTrack)
      await pollUntil(
        () =>
          page.evaluate(() => {
            const t = window.__store.getState().tracks.find((x) => x.id === 'pluck')
            // fully reconstituted: file fields applied AND un-modeled SynthParams fields present
            // (merged from DEFAULT_SYNTH — the "importing side's job" contract)
            return !!t && t.synth.cutoff === 2500 && t.notes.length === 1 && typeof t.synth.lfoRate === 'number'
          }),
        'the file-only track to appear in the GUI',
      )
      console.log('C ✓ track that exists only in the file appeared in the GUI, fully reconstituted (74-field synth from a 9-field patch)')
    }

    // ---- D. a drum step toggled in the file lands in the GUI pattern ------------------------
    {
      const text = readFileSync(beatFile, 'utf8')
      const kickLine = text.split('\n').find((l) => l.startsWith('  pattern kick '))
      const steps = kickLine.replace('  pattern kick ', '').split(' ')
      steps[3] = '0.7' // a step that's 0 in the real groove
      writeFileSync(beatFile, text.replace(kickLine, '  pattern kick ' + steps.join(' ')))
      await pollUntil(
        () => page.evaluate(() => window.__store.getState().tracks.find((t) => t.kind === 'drums')?.pattern.kick[3] === 0.7),
        'the drum-step edit to reach the GUI',
      )
      console.log('D ✓ drum step toggled in the file landed in the GUI pattern')
    }

    // ---- E. quiescence: no echo loops --------------------------------------------------------
    {
      const settled = readFileSync(beatFile, 'utf8')
      await sleep(1500) // > bridge debounce (250ms) + daemon watch debounce (60ms), with margin
      const after = readFileSync(beatFile, 'utf8')
      if (after !== settled) throw new Error('the file changed with no edits pending — an echo loop is live')
      console.log('E ✓ quiescent: no background rewrites after 1.5s idle')
    }

    if (pageErrors.length) throw new Error('page error(s) during the run:\n' + pageErrors.join('\n'))

    console.log('\nM1 exit criteria: ALL MET')
    console.log(`  GUI edit  → file written:  ${Math.round(results.guiToFileMs)}ms (bridge debounce is 250ms of that)`)
    console.log(`  file edit → GUI applied:   ${Math.round(results.fileToGuiMs)}ms (daemon watch debounce is 60ms of that)`)
    console.log(`  work dir (kept for inspection): ${workDir}`)
  } finally {
    await browser?.close()
    await daemon.close()
    killVite(vite)
  }
}

main()
  .then(() => process.exit(0)) // same event-loop-drain issue as cli/render.mjs — see its footer comment
  .catch((err) => {
    console.error(err.stack ?? String(err))
    process.exit(1)
  })
