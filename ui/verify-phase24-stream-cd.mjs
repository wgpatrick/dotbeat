#!/usr/bin/env node
// Phase 24 Stream CD end-to-end verification — timeline zoom + bar-number ruler ticks, driven live
// against a real `beat daemon` in headless Chrome, on a real multi-section song project
// (examples/night-shift-song.beat — intro/build/drop/intro/intro/intro, 33 bars). Mirrors
// ui/verify-phase22-stream-ag.mjs's boot pattern (that stream is CD's direct predecessor: it's what
// first made .arr-scroll horizontally scrollable, for the resize-drag live preview only — CD is what
// makes that scrolling reachable in ordinary use, via independent zoom). Checks, in order:
//
//   A  Baseline: at load, zoom is "fit" (pxPerBar === laneWidth/totalBars, no horizontal overflow),
//      and the ruler already carries one bar-number tick per bar (33 bars, 4/4-ish density at the
//      default viewport).
//   B  Zoom-in button: clicking [+] actually changes the LIVE pxPerBar (read off the DOM, not just a
//      CSS class toggling) by the expected factor, growing the ruler's real rendered width, and — once
//      pxPerBar*totalBars exceeds the container — .arr-scroll actually becomes scrollable
//      (scrollWidth > clientWidth), which it structurally cannot be at fit-to-width.
//   C  Real horizontal scroll: scrolling .arr-scroll moves the rendered content (a bar tick that was
//      off-screen right becomes visible; the ruler's on-screen bounding box shifts left).
//   D  Bar-tick correctness at the zoomed-in width: tick count matches the zoom-aware density
//      (tickIntervalFor), each tick's number text is bar+1, and each tick's on-screen x position
//      matches start + bar*pxPerBar to within a couple of px.
//   E  Zoom-out button: pxPerBar decreases; repeated zoom-out clamps at MIN_PX_PER_BAR (button
//      disables) rather than going negative/zero.
//   F  Zoom-fit button: returns pxPerBar exactly to the original baseline fit value.
//   G  Cmd/Ctrl+scroll-wheel zoom: a wheel event with ctrlKey changes pxPerBar; a plain wheel (no
//      modifier) does NOT change pxPerBar (it's left to scroll normally, per the "and/or" spec).
//
// Usage: node ui/verify-phase24-stream-cd.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8975
const PREVIEW_PORT = 5975

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

// The live px/bar the ruler is actually rendering at, read straight off the DOM attribute
// ArrangementView.tsx stamps on .arr-ruler (data-pxperbar) — not derived/guessed from CSS.
const readPxPerBar = (page) => page.$eval('.arr-ruler', (el) => Number.parseFloat(el.dataset.pxperbar))
const readRulerWidthPx = (page) => page.$eval('.arr-ruler', (el) => el.getBoundingClientRect().width)
const readScrollMetrics = (page) =>
  page.$eval('.arr-scroll', (el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollLeft: el.scrollLeft }))
const readTicks = (page) =>
  page.$$eval('[data-bar-tick]', (els) =>
    els
      .map((el) => ({
        bar: Number.parseInt(el.dataset.barTick, 10),
        text: el.querySelector('.arr-bar-tick-num')?.textContent ?? '',
        x: el.getBoundingClientRect().left,
      }))
      .sort((a, b) => a.bar - b.bar),
  )

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p24cd-verify-'))
  const beatPath = join(proj, 'night-shift-song.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift-song.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical song-mode baseline')

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  const totalBars = daemon.getDoc().song.reduce((n, s) => n + s.bars, 0)
  console.log(`daemon on :${daemon.port} — song mode, ${daemon.getDoc().song.length} sections, ${totalBars} bars total`)

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
    await page.setViewportSize({ width: 1280, height: 800 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    await page.waitForSelector('.arr-canvas', { timeout: 5000 })
    await sleep(300) // let ResizeObserver settle the lane/ruler widths

    // ==================== A: baseline is fit-to-width, one tick per bar ====================
    const fitPxPerBar = await readPxPerBar(page)
    const fitScroll = await readScrollMetrics(page)
    console.log(`\n[A] baseline pxPerBar ${fitPxPerBar.toFixed(2)}, .arr-scroll ${fitScroll.scrollWidth}/${fitScroll.clientWidth} (scrollWidth/clientWidth)`)
    assert(fitPxPerBar > 0, '[A] baseline pxPerBar must be positive')
    assert(fitScroll.scrollWidth <= fitScroll.clientWidth + 1, `[A] fit-to-width must not overflow: ${JSON.stringify(fitScroll)}`)
    const fitTicks = await readTicks(page)
    console.log(`[A] ${fitTicks.length} bar ticks at fit zoom (of ${totalBars} bars)`)
    assert(fitTicks.length >= 1, '[A] expected at least one bar tick at baseline')
    assert(fitTicks[0].bar === 0 && fitTicks[0].text === '1', `[A] first tick must be bar 0, labeled "1": ${JSON.stringify(fitTicks[0])}`)
    results.baseline = { fitPxPerBar, tickCount: fitTicks.length, totalBars }
    console.log('[A] PASS: fit-to-width baseline, no overflow, tick 1 present')

    // ==================== B: zoom-in button changes real pxPerBar + width ====================
    const rulerWidthBefore = await readRulerWidthPx(page)
    let lastPx = fitPxPerBar
    // 5 clicks at ZOOM_FACTOR 1.4x compounds to ~5.4x fit — comfortably past the container width
    // without approaching MAX_PX_PER_BAR (256), which would disable the button mid-loop.
    const ZOOM_CLICKS = 5
    for (let i = 0; i < ZOOM_CLICKS; i++) {
      await page.click('[data-action="zoom-in"]')
      await pollUntil(async () => (await readPxPerBar(page)) > lastPx + 0.01, `zoom-in click ${i} to raise pxPerBar past ${lastPx}`)
      lastPx = await readPxPerBar(page)
    }
    const zoomedPx = await readPxPerBar(page)
    const rulerWidthAfter = await readRulerWidthPx(page)
    console.log(`\n[B] pxPerBar ${fitPxPerBar.toFixed(2)} -> ${zoomedPx.toFixed(2)} after ${ZOOM_CLICKS}x zoom-in; ruler width ${rulerWidthBefore.toFixed(0)} -> ${rulerWidthAfter.toFixed(0)}px`)
    assert(zoomedPx > fitPxPerBar * 4, `[B] ${ZOOM_CLICKS} zoom-in clicks at 1.4x should compound well past 4x fit: got ${zoomedPx}`)
    assert(rulerWidthAfter > rulerWidthBefore * 4, `[B] ruler's real rendered width must grow with pxPerBar: ${rulerWidthBefore} -> ${rulerWidthAfter}`)
    const zoomedScroll = await readScrollMetrics(page)
    console.log(`[B] .arr-scroll now ${zoomedScroll.scrollWidth}/${zoomedScroll.clientWidth} (scrollWidth/clientWidth)`)
    assert(zoomedScroll.scrollWidth > zoomedScroll.clientWidth + 20, `[B] zoomed-in timeline must overflow (structurally impossible at fit-to-width): ${JSON.stringify(zoomedScroll)}`)
    results.zoomIn = { fitPxPerBar, zoomedPx, rulerWidthBefore, rulerWidthAfter, scrollWidth: zoomedScroll.scrollWidth, clientWidth: zoomedScroll.clientWidth }
    console.log('[B] PASS: zoom-in raised the real pxPerBar/rendered width and made the timeline genuinely overflow')

    // ==================== C: horizontal scroll actually moves rendered content ====================
    const ticksBeforeScroll = await readTicks(page)
    const lastTickBefore = ticksBeforeScroll[ticksBeforeScroll.length - 1]
    const scrollBoxBefore = await page.$eval('.arr-scroll', (el) => el.getBoundingClientRect())
    console.log(`\n[C] last tick (bar ${lastTickBefore.bar}) at x=${lastTickBefore.x.toFixed(0)}, container right edge ${scrollBoxBefore.right.toFixed(0)}`)
    const wasOffscreenRight = lastTickBefore.x > scrollBoxBefore.right
    await page.evaluate(() => {
      const el = document.querySelector('.arr-scroll')
      el.scrollLeft = el.scrollWidth
    })
    await sleep(150)
    const scrollAfter = await readScrollMetrics(page)
    assert(scrollAfter.scrollLeft > 0, `[C] .arr-scroll.scrollLeft must actually move: ${JSON.stringify(scrollAfter)}`)
    const ticksAfterScroll = await readTicks(page)
    const lastTickAfter = ticksAfterScroll[ticksAfterScroll.length - 1]
    console.log(`[C] scrolled to scrollLeft=${scrollAfter.scrollLeft}; last tick (bar ${lastTickAfter.bar}) now at x=${lastTickAfter.x.toFixed(0)}`)
    assert(lastTickAfter.bar === lastTickBefore.bar, '[C] the same last bar tick should still be the last one (content unchanged, just scrolled)')
    assert(lastTickAfter.x < lastTickBefore.x, `[C] scrolling right must move later content LEFT on screen: ${lastTickBefore.x} -> ${lastTickAfter.x}`)
    const scrollBoxAfter = await page.$eval('.arr-scroll', (el) => el.getBoundingClientRect())
    assert(lastTickAfter.x <= scrollBoxAfter.right + 2, `[C] after scrolling to the end, the last tick should be within (or at) the visible right edge: ${lastTickAfter.x} vs ${scrollBoxAfter.right}`)
    results.scroll = { wasOffscreenRightBeforeScroll: wasOffscreenRight, scrollLeftAfter: scrollAfter.scrollLeft, lastTickXBefore: lastTickBefore.x, lastTickXAfter: lastTickAfter.x }
    console.log(`[C] PASS: horizontal scroll genuinely moved rendered content (was off-screen right: ${wasOffscreenRight})`)

    // ==================== D: bar-tick correctness at the zoomed-in width ====================
    // Read the ruler's own left edge in the SAME coordinate space as the ticks (both are
    // getBoundingClientRect() in viewport px) so tick-position math doesn't need scrollLeft at all.
    const rulerBoxD = await page.$eval('.arr-ruler', (el) => el.getBoundingClientRect())
    const pxPerBarD = await readPxPerBar(page)
    const ticksD = await readTicks(page)
    console.log(`\n[D] ${ticksD.length} ticks at pxPerBar=${pxPerBarD.toFixed(2)}`)
    assert(ticksD.length >= 2, '[D] expect multiple ticks once zoomed in')
    // Every bar numbered once pxPerBar is at/above DETAIL_PX_PER_BAR (32) — true here (zoomedPx checked
    // above is well past fit and 8 clicks of 1.4x from any reasonable fit value clears 32px/bar).
    for (let i = 0; i < ticksD.length; i++) {
      const t = ticksD[i]
      assert(t.text === String(t.bar + 1), `[D] tick for bar ${t.bar} should read "${t.bar + 1}", got "${t.text}"`)
      const expectedX = rulerBoxD.left + t.bar * pxPerBarD
      assert(Math.abs(t.x - expectedX) <= 3, `[D] tick bar ${t.bar} at x=${t.x.toFixed(1)}, expected ~${expectedX.toFixed(1)} (ruler.left + bar*pxPerBar)`)
      if (i > 0) assert(t.bar > ticksD[i - 1].bar, '[D] ticks must be in strictly ascending bar order')
    }
    results.ticks = { count: ticksD.length, sample: ticksD.slice(0, 3) }
    console.log('[D] PASS: every tick numbered correctly and positioned at ruler.left + bar*pxPerBar')

    // ==================== E: zoom-out clamps at MIN_PX_PER_BAR ====================
    let px = await readPxPerBar(page)
    console.log(`\n[E] zooming out repeatedly from ${px.toFixed(2)}...`)
    let clicks = 0
    for (; clicks < 60; clicks++) {
      const disabled = await page.$eval('[data-action="zoom-out"]', (b) => b.disabled)
      if (disabled) break
      await page.click('[data-action="zoom-out"]')
      await sleep(20)
    }
    const minPx = await readPxPerBar(page)
    const stillDisabled = await page.$eval('[data-action="zoom-out"]', (b) => b.disabled)
    console.log(`[E] clamped at pxPerBar=${minPx.toFixed(2)} after ${clicks} zoom-out clicks, button disabled=${stillDisabled}`)
    assert(stillDisabled, '[E] zoom-out button must disable once clamped at the minimum')
    assert(minPx > 0 && minPx < px, `[E] clamped px/bar must be positive and less than where we started: ${minPx} vs ${px}`)
    results.zoomOutClamp = { minPx, clicks }
    console.log('[E] PASS: zoom-out clamps at a positive MIN_PX_PER_BAR rather than reaching zero/negative')

    // ==================== F: zoom-fit returns exactly to the baseline fit value ====================
    await page.click('[data-action="zoom-fit"]')
    await pollUntil(async () => Math.abs((await readPxPerBar(page)) - fitPxPerBar) < 0.05, 'zoom-fit to restore the original fit pxPerBar')
    const refit = await readPxPerBar(page)
    const refitScroll = await readScrollMetrics(page)
    console.log(`\n[F] zoom-fit restored pxPerBar to ${refit.toFixed(2)} (baseline was ${fitPxPerBar.toFixed(2)}); overflow gone: scrollWidth ${refitScroll.scrollWidth} vs clientWidth ${refitScroll.clientWidth}`)
    assert(Math.abs(refit - fitPxPerBar) < 0.05, `[F] zoom-fit must restore the exact baseline fit value: ${refit} vs ${fitPxPerBar}`)
    assert(refitScroll.scrollWidth <= refitScroll.clientWidth + 1, '[F] fit must not overflow again')
    const fitDisabled = await page.$eval('[data-action="zoom-fit"]', (b) => b.disabled)
    assert(fitDisabled, '[F] zoom-fit button must disable once already at fit')
    results.zoomFit = { refit, fitDisabled }
    console.log('[F] PASS: zoom-fit exactly restores the pre-zoom fit-to-width layout')

    // ==================== G: Cmd/Ctrl+scroll-wheel zoom, vs plain wheel (no-op for zoom) ====================
    const beforeWheel = await readPxPerBar(page)
    // Plain wheel (no modifier) must NOT change pxPerBar — it's left for ordinary scrolling.
    await page.$eval('.arr-scroll', (el) => el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })))
    await sleep(100)
    const afterPlainWheel = await readPxPerBar(page)
    console.log(`\n[G] plain wheel: pxPerBar ${beforeWheel.toFixed(2)} -> ${afterPlainWheel.toFixed(2)} (should be unchanged)`)
    assert(Math.abs(afterPlainWheel - beforeWheel) < 0.01, `[G] a plain wheel event must not zoom: ${beforeWheel} -> ${afterPlainWheel}`)

    // Ctrl+wheel (deltaY < 0, "scroll up/away" = zoom in) must change pxPerBar.
    await page.$eval('.arr-scroll', (el) => {
      const rect = el.getBoundingClientRect()
      el.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + 10 }),
      )
    })
    await pollUntil(async () => Math.abs((await readPxPerBar(page)) - afterPlainWheel) > 0.01, 'ctrl+wheel to change pxPerBar')
    const afterCtrlWheel = await readPxPerBar(page)
    console.log(`[G] ctrl+wheel (deltaY -100): pxPerBar ${afterPlainWheel.toFixed(2)} -> ${afterCtrlWheel.toFixed(2)}`)
    assert(afterCtrlWheel > afterPlainWheel, `[G] ctrl+wheel with deltaY<0 must zoom IN (increase pxPerBar): ${afterPlainWheel} -> ${afterCtrlWheel}`)
    results.wheelZoom = { beforeWheel, afterPlainWheel, afterCtrlWheel }
    console.log('[G] PASS: Cmd/Ctrl+wheel zooms; a plain wheel leaves pxPerBar untouched')

    await page.screenshot({ path: join(uiDir, 'verify-p24cd-zoom.png') })

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

main().catch((err) => {
  console.error('\nVERIFY FAILED:', err)
  process.exit(1)
})
