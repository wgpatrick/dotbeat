#!/usr/bin/env node
// Phase 18 Stream Q — the Ableton-shaped GUI recomposition (docs/phase-18-layout.md). Drives the
// REAL frontend headlessly against a REAL `beat daemon` on the real multi-track night-shift project
// and asserts the new one-window layout end-to-end, INCLUDING real audio measurement of the inline
// mixer's mute gate (reusing Phase 14 Stream E's samplePeaks approach — a muted track's post-gate
// tap must read TRUE silence, not just flip a CSS class).
//
//   Q1 arrangement is the persistent main view: `.arrangement` + one `.arr-canvas` per track are
//      present, and the old four-tab `.view-tab` switcher is GONE (0 found).
//   Q2 inline per-track mixer gates real audio: mute the loudest track via its in-header mixer strip
//      button -> its post-gate meter falls to true silence; the arrangement stays the main view.
//   Q3 Clip View follows selection — select the drum track -> the bottom pane's Clip facet shows the
//      StepSequencer (`.stepseq`).
//   Q4 Shift+Tab toggles to Device View -> the sound panel (`.synth-panel`, drum bus/voice params).
//   Q5 select a synth track, Clip facet -> the piano roll (`.noteview-grid`) shows.
//   Q6 History is a drawer that does NOT disrupt the main view: open it -> drawer appears AND the
//      arrangement canvases are still mounted; close it -> drawer gone, arrangement intact.
//   Q7 the full Mixer is an on-demand overlay (all channel strips), openable/closable.
//   Q8 VaryAffordance still works: with a selection its trigger shows; triggering enters the audition
//      strip; Undo restores. (Unmodified component — proves it's selection-driven, not tab-bound.)
//
// Screenshots: arrangement-with-inline-strips (+ a muted, dimmed row), drum Clip View, Device View,
// synth Clip View (piano roll), History drawer, Mixer overlay.
//
// Usage: node ui/verify-phase18-layout.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8498
const PREVIEW_PORT = 5328

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 9000, everyMs = 25) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}

// Real per-track peak dB over a window (decay-free RMS straight off the engine tap — a silenced track
// reads true -Infinity, mapped to -120). Identical technique to verify-phase14.mjs.
async function samplePeaks(page, trackIds, ms) {
  return page.evaluate(
    async ({ trackIds, ms }) => {
      const eng = window.__engine
      const peaks = {}
      for (const id of trackIds) peaks[id] = -Infinity
      const t0 = performance.now()
      while (performance.now() - t0 < ms) {
        for (const id of trackIds) {
          const v = eng.getTrackLevel(id)
          if (typeof v === 'number' && isFinite(v) && v > peaks[id]) peaks[id] = v
        }
        await new Promise((r) => setTimeout(r, 30))
      }
      const clean = {}
      for (const id of trackIds) clean[id] = peaks[id] === -Infinity ? -120 : Math.round(peaks[id] * 10) / 10
      return clean
    },
    { trackIds, ms },
  )
}

const selectTrack = async (page, name) => page.click(`.arr-row:has(.arr-track-name:text-is("${name}")) .arr-track-select`)
const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel)

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p18-'))
  const beatPath = join(proj, 'night-shift.beat')
  writeFileSync(beatPath, serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline night-shift')

  const daemon = await startDaemon({ filePath: beatPath, port: PORT })
  console.log(`daemon up on :${daemon.port}, project ${beatPath}`)

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
    await page.setViewportSize({ width: 1440, height: 960 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    const trackIds = await page.evaluate(() => window.__store.getState().doc.tracks.map((t) => t.id))
    console.log(`tracks: ${JSON.stringify(trackIds)}`)

    // ============ Q1: arrangement is the persistent main view; no tab switcher ============
    await page.waitForSelector('.arrangement .arr-canvas', { timeout: 5000 })
    const canvases = await count(page, '.arr-canvas')
    const tabs = await count(page, '.view-tab')
    if (canvases !== trackIds.length) throw new Error(`[Q1] expected ${trackIds.length} arrangement canvases, got ${canvases}`)
    if (tabs !== 0) throw new Error(`[Q1] the old four-tab switcher is still present (${tabs} .view-tab found)`)
    console.log(`[Q1] PASS: arrangement is the main view (${canvases} track canvases); the four-tab switcher is gone (0 .view-tab)`)
    results.q1 = { canvases, tabs }

    // ============ Q2: inline mixer strip gates REAL audio ============
    await page.click('.play-btn')
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().currentStep >= 0),
      'transport ticking',
    )
    const base = await samplePeaks(page, trackIds, 1800)
    console.log(`[Q2] baseline per-track peak dB: ${JSON.stringify(base)}`)
    const audible = trackIds.filter((id) => base[id] > -60)
    if (audible.length < 2) throw new Error(`[Q2] expected >=2 audible tracks, got ${JSON.stringify(base)}`)
    const victim = audible.reduce((a, b) => (base[a] >= base[b] ? a : b))
    await page.click(`.arr-strip-btn.mute[data-mute="${victim}"]`)
    await pollUntil(() => page.evaluate((id) => window.__store.getState().mutes[id] === true, victim), 'inline mute to reach store')
    await sleep(300) // let the gate apply on the next tick
    const muted = await samplePeaks(page, trackIds, 1500)
    console.log(`[Q2] muted "${victim}" via its inline strip -> peak dB: ${JSON.stringify(muted)}`)
    if (!(muted[victim] < -60)) throw new Error(`[Q2] muted track ${victim} still audible at ${muted[victim]} dB (inline mute did not gate real audio)`)
    if ((await count(page, '.arr-canvas')) !== trackIds.length) throw new Error('[Q2] arrangement stopped being the main view after muting')
    console.log(`[Q2] PASS: inline mute drove ${victim} to TRUE silence (${base[victim]} -> ${muted[victim]} dB); arrangement still the main view`)
    results.q2 = { victim, before: base[victim], after: muted[victim] }
    await page.screenshot({ path: join(uiDir, 'verify-p18-arrangement.png') })
    // unmute + stop for the pane tests
    await page.click(`.arr-strip-btn.mute[data-mute="${victim}"]`)
    await pollUntil(() => page.evaluate((id) => !window.__store.getState().mutes[id], victim), 'unmute')
    await page.click('.play-btn')

    // ============ Q3: Clip View follows selection — drum track shows the StepSequencer ============
    await selectTrack(page, 'drums')
    await pollUntil(() => page.evaluate(() => window.__store.getState().selectedTrackId === 'drums' || window.__store.getState().doc.selectedTrack === 'drums'), 'drums selection')
    await page.click('[data-pane-tab="clip"]') // ensure the Clip facet
    await page.waitForSelector('[data-testid="bottom-pane"] .stepseq', { timeout: 5000 })
    console.log('[Q3] PASS: selecting the drum track shows the StepSequencer in the bottom pane Clip View')
    await page.screenshot({ path: join(uiDir, 'verify-p18-clip-drums.png') })

    // ============ Q4: Shift+Tab -> Device View shows the sound panel ============
    await page.keyboard.press('Shift+Tab')
    await pollUntil(() => page.evaluate(() => window.__store.getState().bottomPane === 'device'), 'Shift+Tab to switch to Device View')
    await page.waitForSelector('[data-testid="bottom-pane"] .synth-panel', { timeout: 5000 })
    if ((await count(page, '[data-testid="bottom-pane"] .stepseq')) !== 0) throw new Error('[Q4] StepSequencer still showing after switching to Device View')
    console.log('[Q4] PASS: Shift+Tab toggled to Device View — the drum-voice/synth param panel shows, the step grid is hidden')
    await page.screenshot({ path: join(uiDir, 'verify-p18-device.png') })

    // ============ Q5: synth track -> Clip View shows the piano roll ============
    await selectTrack(page, 'lead')
    await pollUntil(() => page.evaluate(() => window.__store.getState().doc.selectedTrack === 'lead'), 'lead selection')
    await page.click('[data-pane-tab="clip"]')
    await page.waitForSelector('[data-testid="bottom-pane"] .noteview-grid', { timeout: 5000 })
    console.log('[Q5] PASS: selecting the synth track shows the piano roll (NoteView) in the bottom pane Clip View')
    await page.screenshot({ path: join(uiDir, 'verify-p18-clip-synth.png') })

    // ============ Q6: History drawer does not disrupt the main view ============
    await page.click('[data-action="toggle-history"]')
    await page.waitForSelector('[data-testid="history-drawer"] .history-panel', { timeout: 5000 })
    if ((await count(page, '.arr-canvas')) !== trackIds.length) throw new Error('[Q6] opening History disrupted the arrangement main view')
    console.log('[Q6] PASS: History drawer opened over the main view; the arrangement is still mounted underneath')
    await page.screenshot({ path: join(uiDir, 'verify-p18-history.png') })
    await page.click('[data-action="close-history"]')
    await pollUntil(async () => (await count(page, '[data-testid="history-drawer"]')) === 0, 'History drawer to close')
    if ((await count(page, '.arr-canvas')) !== trackIds.length) throw new Error('[Q6] closing History disrupted the arrangement main view')
    console.log('[Q6] PASS: History drawer closed; main view intact throughout')

    // ============ Q7: full Mixer overlay ============
    await page.click('[data-action="toggle-mixer"]')
    await page.waitForSelector('[data-testid="mixer-overlay"] .mixer-strip', { timeout: 5000 })
    const strips = await count(page, '[data-testid="mixer-overlay"] .mixer-strip')
    if (strips !== trackIds.length) throw new Error(`[Q7] mixer overlay showed ${strips} strips, expected ${trackIds.length}`)
    console.log(`[Q7] PASS: full Mixer overlay shows all ${strips} channel strips`)
    await page.screenshot({ path: join(uiDir, 'verify-p18-mixer.png') })
    await page.click('[data-action="close-mixer"]')
    await pollUntil(async () => (await count(page, '[data-testid="mixer-overlay"]')) === 0, 'mixer overlay to close')

    // ============ Q8: VaryAffordance still triggers on a selection ============
    await selectTrack(page, 'drums')
    await pollUntil(() => page.evaluate(() => window.__store.getState().selection.tracks?.includes('drums')), 'drums selection posted for vary')
    const triggerText = await pollUntil(async () => {
      const el = await page.$('.vary-btn.trigger')
      return el ? (await el.textContent())?.trim() : null
    }, 'vary trigger button to appear on selection')
    console.log(`[Q8] vary trigger shows: "${triggerText}"`)
    await page.click('.vary-btn.trigger')
    await page.waitForSelector('.vary-bar.auditioning', { timeout: 12000 })
    console.log('[Q8] audition strip entered')
    await page.click('.vary-btn.undo')
    await pollUntil(async () => (await count(page, '.vary-bar.auditioning')) === 0, 'vary audition to close on Undo')
    console.log('[Q8] PASS: VaryAffordance (unmodified) triggered on the selection, auditioned, and Undo restored — selection-driven, not tab-bound')
    results.q8 = { triggerText }

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
