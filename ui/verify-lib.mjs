#!/usr/bin/env node
// ui/verify-lib.mjs — the shared harness for the ui/verify-*.mjs fleet.
//
// W1.5 (docs/research/130 §3 wave 1; R6-8 step 1). The fleet is ~88 Playwright scripts and ~27k
// LOC — larger than the GUI it tests — with ZERO relative imports between them. Every script
// re-declares the same boot sequence: `sleep` (85 copies, byte-identical), `pollUntil` (85 copies
// in 14 gratuitously different default-timeout dialects), `git` (64 copies, byte-identical),
// `npm run build` in BOTH the repo root and ui/ (95 copies — every script rebuilds the whole
// world twice), the daemon boot, the `npm run preview --strictPort` spawn, the `chromium.launch`
// with CHROME_PATH, the `?daw=<port>` goto, the `window.__store`/`window.__engine` wait, and the
// `finally { browser.close(); preview.kill(); daemon.close() }` teardown. Reuse in this fleet has
// always happened by PROSE CITATION ("mirrors ui/verify-phase13.mjs's boot pattern") — i.e. by
// re-pasting, never by importing.
//
// This module is the SUPERSET of that boilerplate, so a script can be about the thing it verifies.
// It deliberately does not try to abstract the interesting half: the assertions, the DOM driving,
// and the audio measurement stay in each script, because that IS the script.
//
// Design rules this file keeps to:
//   - Every export is opt-in. Nothing here runs on import; a script that wants only `sleep` gets
//     only `sleep`. Partial adoption has to be cheap or the migration stalls at script 10.
//   - Defaults match what the fleet already does, so a port is a deletion, not a rewrite. Where
//     the fleet disagreed with itself (pollUntil's timeout), the default is the most common
//     generous value and every caller can still override.
//   - Ports are NEGOTIATED, not hardcoded. Every script picked its own magic pair (8479/5327,
//     8619/5619, ...) which is why the fleet can only ever run one script at a time and why a
//     script can collide with the owner's live daemon on 8420. `pickPort` prefers the script's
//     historical number and silently falls back to a free one.
//   - The build is done ONCE per suite. `npm run verify` sets VERIFY_SKIP_BUILD=1 after building,
//     so N scripts cost one build instead of 2N.
//
// See ui/verify-manifest.mjs for what runs in which tier, and `npm run verify` / `npm run
// verify:engine` for the runners.

import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

export const uiDir = dirname(fileURLToPath(import.meta.url))
export const repoRoot = join(uiDir, '..')
export const beatCli = join(repoRoot, 'cli', 'beat.mjs')

// ---- the three helpers every script redeclares -------------------------------------------------

/** 85 byte-identical copies across the fleet. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Poll `fn` until it returns truthy, or throw naming what we were waiting for.
 *
 * The fleet has 14 different default-timeout pairs for this one function, from (8000, 20) to
 * (20000, 40). The differences are not considered — they are whatever the script's author happened
 * to type. (12000, 40) is the most common generous pair; anything that genuinely needs longer
 * (a first-run media fetch, a cold vite preview) passes its own. */
export async function pollUntil(fn, what, timeoutMs = 12000, everyMs = 40) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}

/** 64 byte-identical copies across the fleet. */
export function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}

/** Run the real CLI. Throws on non-zero exit with the child's own output attached, which is what
 * every hand-rolled copy of this forgot to do (a failing `beat` step used to surface as an opaque
 * "Command failed" with the actual error on a swallowed stderr). */
export function beat(args, opts = {}) {
  try {
    return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8', ...opts })
  } catch (err) {
    const detail = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim()
    throw new Error(`beat ${args.join(' ')} failed (exit ${err.status}):\n${detail}`)
  }
}

// ---- assertions --------------------------------------------------------------------------------

let passed = 0
let failed = 0
const failures = []

/** The fleet's own `check(cond, msg)` idiom: log every assertion either way and keep going, so one
 * run reports the whole picture instead of stopping at the first problem. */
export function check(cond, msg) {
  if (cond) {
    passed++
    console.log(`  PASS: ${msg}`)
  } else {
    failed++
    failures.push(msg)
    console.log(`  FAIL: ${msg}`)
  }
  return !!cond
}

export function tally() {
  return { passed, failed, failures: [...failures] }
}

/** Print the run's tally and set the process exit code. A verify script's exit code is the only
 * thing the runner can read, so a script that logs FAILs and exits 0 is invisible to `npm run
 * verify` — several in the fleet did exactly that before this existed. */
export function finish(name) {
  console.log(`\n${name}: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    for (const f of failures) console.log(`  - ${f}`)
    process.exitCode = 1
  }
  return failed === 0
}

/** Wrap a script's main so a throw is reported the same way a failed check is, and so teardown
 * problems can never mask the real result. */
export async function run(name, fn) {
  try {
    await fn()
  } catch (err) {
    failed++
    failures.push(`threw: ${err?.message ?? err}`)
    console.error(`\n${name} threw:`)
    console.error(err?.stack ?? err)
  }
  return finish(name)
}

// ---- build ---------------------------------------------------------------------------------

/** `npm run build` in the repo root (core/daemon/metrics -> dist/) and in ui/ (the vite bundle the
 * preview serves). 95 scripts do this inline, so running any N of them costs 2N builds. The runner
 * builds once and sets VERIFY_SKIP_BUILD=1; an individually-invoked script still builds, because
 * "I ran the script and it tested a stale bundle" is the failure mode that matters more. */
export function buildAll({ core = true, ui = true, quiet = false } = {}) {
  if (process.env.VERIFY_SKIP_BUILD === '1') {
    if (!quiet) console.log('build: skipped (VERIFY_SKIP_BUILD=1 — the runner already built)')
    return
  }
  const stdio = quiet ? 'ignore' : 'inherit'
  if (core) {
    if (!quiet) console.log('building repo core/daemon/metrics...')
    execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio })
  }
  if (ui) {
    if (!quiet) console.log('building ui...')
    execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio })
  }
}

/** Import a compiled module out of dist/. Scripts hand-write this join 200+ times; centralizing it
 * also gives one place to say WHY it is a dynamic import (the fleet is .mjs and dist/ only exists
 * after buildAll has run, so a static import would fail at parse time on a clean checkout). */
export async function importDist(rel) {
  return import(join(repoRoot, 'dist', rel.replace(/^\/*/, '')))
}

// ---- scratch project ---------------------------------------------------------------------------

/** A real project directory in tmp with a real .beat file, optionally a real git repo (checkpoint/
 * history/diff assertions need one). `edits` are extra `beat` argv arrays applied in order, with
 * the file path spliced in as the first argument. */
export function scratchProject({
  prefix = 'dotbeat-verify-',
  name = 'song.beat',
  bpm = 120,
  bars = 2,
  gitInit = false,
  edits = [],
  text = null,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const file = join(dir, name)
  if (text !== null) writeFileSync(file, text)
  else beat(['init', file, '--bpm', String(bpm), '--bars', String(bars)])
  if (gitInit) {
    git(dir, 'init', '-q')
    git(dir, 'config', 'user.email', 'verify@dotbeat.test')
    git(dir, 'config', 'user.name', 'verify')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-q', '-m', 'initial')
  }
  for (const argv of edits) beat([argv[0], file, ...argv.slice(1)])
  return { dir, file }
}

// ---- ports -------------------------------------------------------------------------------------

/** An OS-assigned free port. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

/** Prefer a script's historical port number (so its logs and any hand-run instructions still read
 * the same), but never insist on it. Every script in the fleet hardcodes a magic pair; that is why
 * two of them can never run concurrently and why one can steal port 8420 out from under a live GUI
 * session. Preferring-then-falling-back costs one connect attempt. */
export async function pickPort(preferred) {
  if (!preferred) return freePort()
  const free = await new Promise((resolve) => {
    const srv = createServer()
    srv.on('error', () => resolve(false))
    srv.listen(preferred, '127.0.0.1', () => srv.close(() => resolve(true)))
  })
  return free ? preferred : freePort()
}

// ---- the GUI stack -----------------------------------------------------------------------------

/** Boot the whole live stack a GUI verify script needs and hand back its pieces:
 *
 *   daemon (dist/src/daemon/daemon.js on a real port, serving a real .beat file)
 *     -> vite preview serving the real production bundle
 *       -> headless Chromium at /?daw=<daemonPort>
 *         -> a page with window.__store / window.__engine live (ui/src/main.tsx exposes them)
 *
 * Returns `{ daemon, preview, browser, page, errors, daemonPort, previewPort, close }`. `errors`
 * accumulates page-level exceptions — assert on it; an uncaught React/engine error otherwise shows
 * up only as a mysteriously-unchanged DOM three assertions later.
 *
 * ALWAYS call `close()` in a finally. It is ordered browser -> preview -> daemon and each step is
 * independently try/caught, because a teardown throw used to hide the actual test result. */
export async function bootGui({
  file,
  daemonPort: wantDaemonPort = null,
  previewPort: wantPreviewPort = null,
  viewport = { width: 1280, height: 900 },
  waitAppReady = true,
  readyTimeoutMs = 15000,
  autoplay = true,
  chromiumArgs = [],
  query = '',
} = {}) {
  const daemonPort = await pickPort(wantDaemonPort)
  const previewPort = await pickPort(wantPreviewPort)

  const { startDaemon } = await importDist('src/daemon/daemon.js')
  const daemon = await startDaemon({ filePath: file, port: daemonPort })
  console.log(`daemon on :${daemon.port}`)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(previewPort), '--strictPort'], {
    cwd: uiDir,
    stdio: 'pipe',
  })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))

  let browser = null
  let page = null
  const errors = []

  const close = async () => {
    try {
      if (browser) await browser.close()
    } catch (e) {
      console.error(`[teardown] browser.close: ${e?.message ?? e}`)
    }
    try {
      preview.kill('SIGTERM')
    } catch (e) {
      console.error(`[teardown] preview.kill: ${e?.message ?? e}`)
    }
    try {
      await daemon.close()
    } catch (e) {
      console.error(`[teardown] daemon.close: ${e?.message ?? e}`)
    }
  }

  try {
    await pollUntil(
      async () => {
        try {
          return (await fetch(`http://localhost:${previewPort}/`)).ok
        } catch {
          return false
        }
      },
      'vite preview to serve',
      30000,
    )
    console.log(`ui served on :${previewPort}`)

    browser = await chromium.launch({
      // CHROME_PATH is how this repo's own runs point at a pinned browser; `channel: 'chrome'`
      // is the fallback the whole fleet already uses. Kept identical so a ported script behaves
      // exactly as it did.
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
      headless: true,
      args: [...(autoplay ? ['--autoplay-policy=no-user-gesture-required'] : []), ...chromiumArgs],
    })
    page = await browser.newPage()
    if (viewport) await page.setViewportSize(viewport)
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(`http://localhost:${previewPort}/?daw=${daemon.port}${query}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, {
      timeout: readyTimeoutMs,
    })
    if (waitAppReady) {
      // Not every historical build renders this marker; a missing one is a warning, never a
      // failure, so a ported script can't start failing for a reason unrelated to what it tests.
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 }).catch(() => {
        console.log('  note: [data-testid="app-ready"] never appeared — continuing')
      })
    }
  } catch (err) {
    await close()
    throw err
  }

  return { daemon, preview, browser, page, errors, daemonPort: daemon.port, previewPort, close }
}

// ---- audio capture -----------------------------------------------------------------------------

/** Record the live engine's master output and decode it with the repo's own WAV decoder.
 *
 * This is the fleet's central evidence move — `window.__engine.recordWav` is the SAME
 * MediaRecorder path `beat render` and the live GUI use, so the bytes measured here are the bytes
 * a user hears. The base64 shuttle exists because a Blob cannot cross the Playwright boundary.
 * Returns the decoded `{ channels, sampleRate }`. */
export async function recordWav(page, seconds, { play = true, settleMs = 250, stop = true } = {}) {
  const b64 = await page.evaluate(
    async ({ secs, play, settleMs, stop }) => {
      if (play) await window.__engine.play()
      if (settleMs) await new Promise((r) => setTimeout(r, settleMs))
      const blob = await window.__engine.recordWav(secs)
      if (stop) window.__engine.stop()
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      return btoa(bin)
    },
    { secs: seconds, play, settleMs, stop },
  )
  const { decodeWav } = await importDist('src/metrics/index.js')
  const bytes = Buffer.from(b64, 'base64')
  return decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
}

/** `recordWav` + src/metrics' own `analyze()` — the loudness/crest/spectral report most audio
 * assertions in the fleet are written against. */
export async function analyzeRecording(page, seconds, opts = {}) {
  const decoded = await recordWav(page, seconds, opts)
  const { analyze } = await importDist('src/metrics/index.js')
  return { decoded, metrics: analyze(decoded.channels, decoded.sampleRate) }
}

/** Screenshot into ui/ next to the script, named consistently. Screenshots are evidence a human
 * reads after a failure, so they are written unconditionally, not only on failure. */
export async function screenshot(page, name) {
  const path = join(uiDir, name.endsWith('.png') ? name : `${name}.png`)
  await page.screenshot({ path, fullPage: false })
  console.log(`  screenshot: ${path}`)
  return path
}
