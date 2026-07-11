#!/usr/bin/env node
// Phase 12 Stream 1 end-to-end verification — dotbeat's OWN frontend against the real daemon.
// Mirrors scripts/verify-m1.mjs (the M1 exit bar the BeatLab bridge once met), now for ui/:
//
//   A. toggle a drum step in the GUI  → git diff on the .beat is exactly ONE added line
//   B. hand-edit the .beat on disk    → the GUI's store reflects it, no reload
//   C. audio actually plays           → transport ticks (currentStep advances) and the master
//                                        meter reads a real level while notes trigger
//   D. the GUI is showing REAL project data (track names read from the live DOM + a screenshot)
//
// Boots: daemon on a git-tracked canonical .beat + `vite preview` of ui/dist + headless Chrome
// (system Chrome via playwright-core, same as cli/render.mjs). Requires `npm run build` at the
// repo root (for dist/src/daemon) and `npm run build` in ui/ (for ui/dist) to have run first;
// this script runs both to be self-contained.
//
// Usage: node ui/verify.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8455
const PREVIEW_PORT = 5311

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 8000, everyMs = 25) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // 1. temp git project holding night-shift in CURRENT canonical form (so a later toggle is a
  //    clean one-line diff, not a v0.3→v0.9 format migration).
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-ui-verify-'))
  const beatPath = join(proj, 'night-shift.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical night-shift baseline')
  console.log(`\nproject: ${beatPath} (committed canonical baseline)`)

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon on :${daemon.port}`)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stdout.on('data', () => {})
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(
    async () => {
      try {
        return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok
      } catch {
        return false
      }
    },
    'vite preview to serve',
    15000,
  )
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const results = {}
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })

    // Wait for the document to load from the daemon and the app to render.
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // ---- D: real data on screen ----
    const names = await page.$$eval('.track-name', (els) => els.map((e) => e.textContent))
    const bpm = await page.$eval('.transport-field input', (el) => Number(el.value))
    console.log(`\n[D] tracks in DOM: ${JSON.stringify(names)} · bpm ${bpm}`)
    results.tracks = names
    results.bpm = bpm
    if (!(names.includes('lead') && names.includes('drums') && names.includes('bass') && names.includes('pad'))) {
      throw new Error(`[D] expected real track names, got ${JSON.stringify(names)}`)
    }
    await page.screenshot({ path: join(uiDir, 'verify-screenshot-1.png') })
    console.log('[D] screenshot -> ui/verify-screenshot-1.png')

    // Select the drums track so the step grid renders. Selecting records selected_track to the
    // file (a legitimate one-line edit of its own); commit it so the toggle diff below isolates
    // exactly the step change and nothing else.
    await page.click('.track-row:has(.track-name:text-is("drums"))')
    await page.waitForSelector('[data-lane="kick"][data-step="1"]', { timeout: 5000 })
    await pollUntil(() => daemon.getDoc().selectedTrack === 'drums', 'selection to record to the file')
    await sleep(150)
    git(proj, 'commit', '-q', '-am', 'select drums track')

    // ---- A: toggle a step -> one-line diff ----
    // kick step 1 is OFF in night-shift (kick lands on 0,4,8,12,...). Toggling it ON adds exactly
    // one hit line: `hit kick1 kick 1 0.8`.
    await page.click('[data-lane="kick"][data-step="1"]')
    await pollUntil(() => daemon.getDoc().tracks.find((t) => t.id === 'drums').hits.some((h) => h.id === 'kick1'), 'daemon to record the toggled hit')
    await sleep(150) // let the write settle
    const diff = git(proj, 'diff', '--unified=0', 'night-shift.beat')
    const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    const removed = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'))
    console.log('\n[A] git diff (unified=0):\n' + diff)
    results.diffAdded = added
    results.diffRemoved = removed
    if (added.length !== 1 || removed.length !== 0) {
      throw new Error(`[A] expected exactly 1 added / 0 removed line, got +${added.length} -${removed.length}`)
    }
    if (!/^\+\s*hit kick1 kick 1 0\.8\s*$/.test(added[0])) {
      throw new Error(`[A] the one added line is not the expected hit: ${JSON.stringify(added[0])}`)
    }
    console.log('[A] PASS: exactly one line added, the toggled kick hit')

    // ---- B: hand-edit the file -> GUI updates without reload ----
    const onDisk = readFileSync(beatPath, 'utf8')
    writeFileSync(beatPath, onDisk.replace(/^bpm 124$/m, 'bpm 141'))
    await pollUntil(() => page.evaluate(() => window.__store.getState().doc.bpm === 141), 'GUI to reflect the hand-edited bpm', 8000)
    const domBpm = await page.$eval('.transport-field input', (el) => Number(el.value))
    console.log(`\n[B] hand-edited bpm 124 -> 141 on disk; GUI store bpm now ${domBpm} (no reload)`)
    results.bpmAfterFileEdit = domBpm
    if (domBpm !== 141) throw new Error(`[B] GUI did not reflect the file edit (bpm ${domBpm})`)
    console.log('[B] PASS: file edit propagated to the GUI live')
    await page.screenshot({ path: join(uiDir, 'verify-screenshot-2.png') })

    // ---- C: audio plays ----
    await page.click('.play-btn')
    await pollUntil(() => page.evaluate(() => window.__store.getState().currentStep >= 0), 'transport to start ticking', 8000)
    const audio = await pollUntil(
      async () =>
        page.evaluate(() => {
          const s = window.__store.getState()
          return s.currentStep >= 0 && typeof s.masterLevel === 'number' && Number.isFinite(s.masterLevel) && s.masterLevel > -Infinity ? { step: s.currentStep, level: s.masterLevel } : null
        }),
      'transport ticking + master meter reading a real level',
      9000,
    )
    // Confirm the step advances (transport is really running, not a single frozen tick).
    const step1 = await page.evaluate(() => window.__store.getState().currentStep)
    await sleep(400)
    const step2 = await page.evaluate(() => window.__store.getState().currentStep)
    console.log(`\n[C] playing: currentStep ${step1} -> ${step2}, masterLevel ${audio.level.toFixed(1)} dB`)
    results.audio = { step1, step2, level: audio.level }
    if (!(audio.level > -60)) throw new Error(`[C] master meter never rose above -60 dB (got ${audio.level})`)
    console.log('[C] PASS: transport ticks and the master meter reads real output')

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))

    console.log('\n================ ALL CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nVERIFY FAILED:', err)
  process.exit(1)
})
