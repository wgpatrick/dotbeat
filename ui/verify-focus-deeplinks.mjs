#!/usr/bin/env node
// research/128 §2.2 — agent→GUI deep links (the daemon `POST /focus` route + the GUI's `focus` SSE
// handler). Drives the REAL frontend headlessly against a REAL `beat daemon` on examples/night-shift
// and asserts the full round-trip: an agent POSTs /focus, every connected GUI mirrors it onto the
// SAME layout state a hand action touches, so agent-focus and hand-click end indistinguishable.
//
//   F1 device+param: POST /focus {track:lead, view:device, param:cutoff} -> the store selects `lead`
//      (selectedTrackId), the bottom pane flips to Device (.synth-panel, data-pane="device"), the
//      D2 selection + `selected_track` are written exactly as a header CLICK would (indistinguishable
//      afterward), and the Filter group + the Cutoff control flash (param-group-flash / param-flash).
//   F2 clip: POST /focus {track:bass, view:clip} -> Device->Clip flip, the piano roll (.noteview-grid).
//   F3 mixer: POST /focus {view:mixer} -> the on-demand Mixer overlay opens (reusing mixerOpen).
//   F4 arrangement: POST /focus {track:pad, view:arrangement} -> selects pad + arms the scroll epoch,
//      no new pane/overlay invented.
//   F5 validation: POST /focus {track:bogus} -> the daemon 400s with the known track list (no GUI change).
//
// Screenshots: the flashed Cutoff control, the Clip piano roll, the Mixer overlay.
//
// Usage: node ui/verify-focus-deeplinks.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8471
const PREVIEW_PORT = 5331

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function pollUntil(fn, what, timeoutMs = 9000, everyMs = 25) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}
const count = (page, sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel)
const st = (page) => page.evaluate(() => window.__store.getState())
async function postFocus(port, body) {
  const res = await fetch(`http://127.0.0.1:${port}/focus`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-focus-'))
  const beatPath = join(proj, 'night-shift.beat')
  writeFileSync(beatPath, serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))))

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
    const trackIds = (await st(page)).doc.tracks.map((t) => t.id)
    console.log(`tracks: ${JSON.stringify(trackIds)}`)

    // ============ F1: device + param deep link ============
    // Start on the Clip pane and a DIFFERENT track, so the focus has real work to do (switch both).
    await page.evaluate(() => {
      window.__store.getState().setSelectedTrack('drums')
      window.__store.getState().setBottomPane('clip')
    })
    let r = await postFocus(daemon.port, { track: 'lead', view: 'device', param: 'cutoff' })
    if (r.status !== 200) throw new Error(`[F1] /focus returned ${r.status}`)
    // The GUI mirrors it onto the ordinary selection state — same as a header click (selection posted).
    await pollUntil(async () => {
      const s = await st(page)
      return s.selectedTrackId === 'lead' && s.bottomPane === 'device' && s.selection.tracks?.includes('lead')
    }, '[F1] lead selected + device pane + D2 selection posted')
    await page.waitForSelector('.synth-panel', { timeout: 5000 })
    // `selected_track` written to the doc too — the exact side effect clickHeader has, so an
    // agent-focused track and a hand-clicked one are indistinguishable afterward.
    await pollUntil(async () => (await st(page)).doc.selectedTrack === 'lead', '[F1] selected_track written to the doc (as a click would)')
    // The Cutoff control + its Filter group flash (transient — catch it while it is up).
    const flashed = await pollUntil(async () => (await count(page, '.param-flash')) > 0, '[F1] the focused control to flash (.param-flash)', 3000)
    const groupFlash = await count(page, '[data-param-group="filter"].param-group-flash')
    if (groupFlash < 1) throw new Error('[F1] the Filter group did not flash (param-group-flash)')
    await page.screenshot({ path: join(uiDir, 'verify-focus-device-param.png') })
    console.log('[F1] PASS: focus selected lead, opened Device, posted the D2 selection + selected_track (as a click would), and flashed Cutoff + the Filter group')
    results.f1 = { flashed, groupFlash }

    // ============ F2: clip deep link ============
    r = await postFocus(daemon.port, { track: 'bass', view: 'clip' })
    if (r.status !== 200) throw new Error(`[F2] /focus returned ${r.status}`)
    await pollUntil(async () => {
      const s = await st(page)
      return s.selectedTrackId === 'bass' && s.bottomPane === 'clip'
    }, '[F2] bass selected + clip pane')
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    await page.screenshot({ path: join(uiDir, 'verify-focus-clip.png') })
    console.log('[F2] PASS: focus flipped to the Clip pane on bass (piano roll shown)')
    results.f2 = { pane: 'clip' }

    // ============ F3: mixer deep link ============
    r = await postFocus(daemon.port, { view: 'mixer' })
    if (r.status !== 200) throw new Error(`[F3] /focus returned ${r.status}`)
    await pollUntil(async () => (await count(page, '[data-testid="mixer-overlay"]')) === 1, '[F3] the Mixer overlay to open')
    if (!(await st(page)).mixerOpen) throw new Error('[F3] mixerOpen flag not set')
    await page.screenshot({ path: join(uiDir, 'verify-focus-mixer.png') })
    console.log('[F3] PASS: focus opened the on-demand Mixer overlay (reusing mixerOpen)')
    results.f3 = { mixerOpen: true }
    await page.click('[data-action="close-mixer"]')
    await pollUntil(async () => (await count(page, '[data-testid="mixer-overlay"]')) === 0, 'mixer overlay to close')

    // ============ F4: arrangement deep link (select + arm scroll, no new view) ============
    const epochBefore = (await st(page)).focusEpoch
    r = await postFocus(daemon.port, { track: 'pad', view: 'arrangement' })
    if (r.status !== 200) throw new Error(`[F4] /focus returned ${r.status}`)
    await pollUntil(async () => {
      const s = await st(page)
      return s.selectedTrackId === 'pad' && s.focusTrackId === 'pad' && s.focusEpoch > epochBefore
    }, '[F4] pad selected + scroll epoch armed')
    console.log('[F4] PASS: focus selected pad and armed the arrangement scroll (no new pane/overlay)')
    results.f4 = { selected: 'pad' }

    // ============ F5: an unknown track is a daemon-side 400, no GUI change ============
    const before = (await st(page)).selectedTrackId
    r = await postFocus(daemon.port, { track: 'bogus' })
    if (r.status !== 400) throw new Error(`[F5] expected 400 for unknown track, got ${r.status}`)
    const body = await r.json()
    if (!Array.isArray(body.tracks) || !body.tracks.includes('lead')) throw new Error('[F5] 400 did not carry the known track list')
    await sleep(200)
    if ((await st(page)).selectedTrackId !== before) throw new Error('[F5] a rejected focus still changed the GUI selection')
    console.log(`[F5] PASS: unknown track rejected with 400 + track list ${JSON.stringify(body.tracks)}; GUI unchanged`)
    results.f5 = { tracks: body.tracks }

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
