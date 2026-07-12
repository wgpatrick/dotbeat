#!/usr/bin/env node
// Phase 27 Stream ED verification — a real colored title/header bar for the Clip View
// (docs/phase-27-plan.md Stream ED, docs/research/71-ux-clip-view-midi-editing.md §3 P0 item 1).
//
// research/71 found dotbeat's NoteView stacked multiple visually-identical dark strips with no
// colored anchor point tying the editor back to its track — unlike Ableton's own clip title strip,
// "the single strongest 'what am I editing' visual anchor in the whole view" (§1.1). The fix adds
// `.noteview-titlebar`, a real bar painted with the selected track's own `track.color`, sticky to
// the top of `.noteview` (ui/src/components/NoteView.tsx, ui/src/styles.css).
//
// This script drives the REAL built frontend against a REAL `beat daemon`, on a disposable copy of
// examples/night-shift.beat in a fresh tmp dir (examples/night-shift-song.beat, the owner's own
// live project, is never touched or even read).
//
//   T1  title bar exists for the selected ("lead") track, and its COMPUTED background-color
//       (getComputedStyle, not class presence) matches lead's own track.color (#e06c75).
//   T2  switching to a different-colored track ("drums", #56b6c2) updates the title bar's computed
//       background-color to match — proves it's driven by the live selected track, not a static/
//       cached value.
//   T3  scrolling the piano-roll editor (the real scroll container is `.bottom-pane-body` —
//       `.noteview` itself has no overflow of its own, confirmed by reading ui/src/styles.css
//       before writing this check, not assumed) leaves the title bar's bounding-box position
//       UNCHANGED, while the grid content it sits above visibly moves — the actual "stays visible
//       while scrolling" proof, not just a static CSS-property check.
//
// Usage: node ui/verify-phase27-stream-ed.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8527
const PREVIEW_PORT = 5527

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
// hex "#rrggbb" -> the "rgb(r, g, b)" string form getComputedStyle returns for an opaque color.
function hexToRgbString(hex) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgb(${r}, ${g}, ${b})`
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // Disposable copy in a fresh tmp dir — NEVER examples/night-shift-song.beat (the owner's own live
  // project). examples/night-shift.beat is only READ here, never written.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p27-ed-'))
  const beatPath = join(proj, 'night-shift.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)

  const daemon = await startDaemon({ filePath: beatPath, port: PORT })
  console.log(`daemon up on :${daemon.port}, project ${beatPath}`)
  const trackColor = (id) => daemon.getDoc().tracks.find((t) => t.id === id).color
  console.log(`track colors: lead=${trackColor('lead')} drums=${trackColor('drums')} bass=${trackColor('bass')} pad=${trackColor('pad')}`)

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
    // A deliberately short viewport so the bottom pane's own scroll container
    // (`.bottom-pane-body`) has real overflow to scroll through for T3 — the default 42vh/900px
    // pane height already tends to overflow with the full panel stack, but a shorter viewport makes
    // that reliable regardless of exact content height on any given track.
    await page.setViewportSize({ width: 1400, height: 640 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // Select the "lead" track (arrangement header click — same pattern as verify-phase19-piano-keys.mjs).
    await page.click('.arr-track-select:has(.arr-track-name:text-is("lead"))')
    await page.waitForSelector('.noteview-titlebar', { timeout: 5000 })
    await pollUntil(() => daemon.getDoc().selectedTrack === 'lead', 'lead selection to record')
    await sleep(150)

    // ============ T1: title bar exists, computed background matches lead's track.color ============
    const titlebar = page.locator('.noteview-titlebar')
    const nameText = (await page.locator('.noteview-titlebar-name').textContent())?.trim()
    const bg1 = await titlebar.evaluate((el) => getComputedStyle(el).backgroundColor)
    const expectedLead = hexToRgbString(trackColor('lead'))
    console.log(`\n[T1] lead titlebar name="${nameText}" computed background=${bg1} (expected ${expectedLead}, track.color=${trackColor('lead')})`)
    if (nameText !== 'lead') throw new Error(`[T1] titlebar name text is ${JSON.stringify(nameText)}, expected "lead"`)
    if (bg1 !== expectedLead) throw new Error(`[T1] titlebar computed background ${bg1} !== expected ${expectedLead} (track.color=${trackColor('lead')})`)
    console.log('[T1] PASS: title bar renders for the selected track, computed background-color matches track.color exactly')
    results.t1 = { name: nameText, background: bg1, expected: expectedLead }

    // ============ T2: switching track updates the title bar's color live ============
    await page.click('.arr-track-select:has(.arr-track-name:text-is("drums"))')
    await pollUntil(() => daemon.getDoc().selectedTrack === 'drums', 'drums selection to record')
    await page.waitForSelector('.noteview-titlebar', { timeout: 5000 })
    await sleep(150)
    const nameText2 = (await page.locator('.noteview-titlebar-name').textContent())?.trim()
    const bg2 = await titlebar.evaluate((el) => getComputedStyle(el).backgroundColor)
    const expectedDrums = hexToRgbString(trackColor('drums'))
    console.log(`\n[T2] drums titlebar name="${nameText2}" computed background=${bg2} (expected ${expectedDrums}, track.color=${trackColor('drums')})`)
    if (nameText2 !== 'drums') throw new Error(`[T2] titlebar name text is ${JSON.stringify(nameText2)}, expected "drums"`)
    if (bg2 !== expectedDrums) throw new Error(`[T2] titlebar computed background ${bg2} !== expected ${expectedDrums} (track.color=${trackColor('drums')})`)
    if (bg2 === bg1) throw new Error(`[T2] titlebar background did not change when switching tracks (still ${bg2})`)
    console.log('[T2] PASS: switching to a different-colored track updates the title bar\'s computed background-color to match')
    results.t2 = { name: nameText2, background: bg2, expected: expectedDrums }

    // ============ T3: sticky — bounding box unchanged across a scroll, grid content moves ============
    // Confirm there is actually something to scroll (real overflow on .bottom-pane-body), not a
    // vacuous pass on a pane that's already fully visible.
    const scrollInfo = await page.$eval('.bottom-pane-body', (el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
    console.log(`\n[T3] .bottom-pane-body scrollHeight=${scrollInfo.scrollHeight} clientHeight=${scrollInfo.clientHeight}`)
    if (scrollInfo.scrollHeight <= scrollInfo.clientHeight + 20) {
      throw new Error(`[T3] .bottom-pane-body has no meaningful overflow to scroll (scrollHeight ${scrollInfo.scrollHeight} vs clientHeight ${scrollInfo.clientHeight}) — cannot exercise the sticky behavior`)
    }
    const titleBoxBefore = await titlebar.boundingBox()
    const gridBoxBefore = await page.locator('.noteview-grid').boundingBox()
    await page.$eval('.bottom-pane-body', (el) => {
      el.scrollTop = el.scrollHeight
    })
    await sleep(200)
    const scrollTopAfter = await page.$eval('.bottom-pane-body', (el) => el.scrollTop)
    if (scrollTopAfter < 40) throw new Error(`[T3] scroll did not actually move .bottom-pane-body (scrollTop=${scrollTopAfter})`)
    const titleBoxAfter = await titlebar.boundingBox()
    const gridBoxAfter = await page.locator('.noteview-grid').boundingBox()
    const titleDy = Math.abs(titleBoxAfter.y - titleBoxBefore.y)
    const gridDy = gridBoxBefore && gridBoxAfter ? Math.abs(gridBoxAfter.y - gridBoxBefore.y) : null
    console.log(`[T3] scrollTop 0 -> ${scrollTopAfter}; titlebar y ${titleBoxBefore.y.toFixed(1)} -> ${titleBoxAfter.y.toFixed(1)} (Δ${titleDy.toFixed(2)}px); grid y ${gridBoxBefore ? gridBoxBefore.y.toFixed(1) : 'n/a'} -> ${gridBoxAfter ? gridBoxAfter.y.toFixed(1) : 'scrolled out of view'} (Δ${gridDy === null ? 'n/a' : gridDy.toFixed(1)}px)`)
    if (titleDy > 1.5) throw new Error(`[T3] title bar moved ${titleDy.toFixed(2)}px during scroll — not actually pinned (sticky is not working within the real scroll context)`)
    if (gridDy === null || gridDy < 20) throw new Error(`[T3] grid content did not visibly move during the scroll (Δ${gridDy}px) — the scroll gesture itself may not be exercising real content movement`)
    console.log('[T3] PASS: title bar bounding box is unchanged across the scroll while the grid content beneath it visibly moves — genuinely sticky to the top')
    results.t3 = { titleBoxBefore, titleBoxAfter, gridBoxBefore, gridBoxAfter, titleDy, gridDy }

    await page.screenshot({ path: join(uiDir, 'verify-p27-ed-scrolled.png') })
    console.log('\nscreenshot -> ui/verify-p27-ed-scrolled.png')

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ PHASE 27 STREAM ED VERIFY PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nPHASE 27 STREAM ED VERIFY FAILED:', err)
  process.exit(1)
})
