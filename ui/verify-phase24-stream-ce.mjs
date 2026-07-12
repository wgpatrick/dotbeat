#!/usr/bin/env node
// Phase 24 Stream CE end-to-end verification — driven live against a real `beat daemon` in headless
// Chrome, on the real multi-section song project (examples/night-shift-song.beat) the whole Phase 24
// batch was scoped against. Mirrors ui/verify-phase22-stream-ag.mjs's boot pattern. Checks, in order:
//
//   A  Loop region wrap: "loop this section" on a NON-first, NON-last song section (so falling
//      through in either direction would be visible), start playback, and confirm — via the real
//      transport position readout the store drives (the same `currentStep` TransportBar.tsx and
//      NoteView's playhead read) — that the bar position cycles WITHIN that section's own range for
//      several full loop cycles, never once reaching the next (or previous) section's bars. A session
//      run with no loop region set is also checked, confirming it still crosses the section boundary
//      (i.e. the region genuinely changes behavior, this isn't just always-true).
//   B  Click-to-seek: a plain ruler click while STOPPED starts playback AT the clicked bar; a plain
//      ruler click while PLAYING relocates the playhead there WITHOUT the transport ever reporting
//      stopped in between (no stop/restart blip) — checked by polling `playing` continuously across
//      the click, not just before/after.
//   C  Regression: a real DRAG on the ruler (movement past the click threshold) still produces a bar-
//      range SELECTION exactly as before this stream, not a seek — the click-vs-drag split didn't
//      eat the pre-existing gesture.
//   D  Session-only discipline: after all of the above (setting/clearing a loop region, seeking,
//      playing/stopping), the .beat file on disk is BYTE-IDENTICAL to the baseline — none of this
//      transport/session state leaked into the file (this stream's own explicit non-goal).
//
// Usage: node ui/verify-phase24-stream-ce.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8473
const PREVIEW_PORT = 5333

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
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p24ce-verify-'))
  const beatPath = join(proj, 'night-shift-song.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift-song.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical song-mode baseline')

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  const song = daemon.getDoc().song
  console.log(`daemon on :${daemon.port} — bpm ${daemon.getDoc().bpm}, ${song.length} sections: ${song.map((s) => `${s.scene}(${s.bars})`).join(', ')}`)

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

    // Cumulative section start bars, same arithmetic ArrangementView.tsx's own `sections` memo uses.
    let cursor = 0
    const secBars = song.map((s) => {
      const startBar = cursor
      cursor += s.bars
      return { scene: s.scene, bars: s.bars, startBar, endBar: startBar + s.bars }
    })
    const totalBars = cursor
    // Section 1 ("build"): not first (so we can also prove it doesn't fall BACKWARD into section 0),
    // not last (proves it doesn't fall FORWARD into section 2/"drop" either).
    const target = secBars[1]
    assert(target.startBar > 0 && target.endBar < totalBars, `[setup] expected section 1 to be an interior section, got ${JSON.stringify(target)}`)
    console.log(`\n[setup] target section: "${target.scene}" bars [${target.startBar}, ${target.endBar}) of ${totalBars} total`)

    // ==================== A: loop-region wrap ====================
    // A0 (control): with NO loop region, playback DOES cross out of section 1's own range — proves
    // the boundary-respecting behavior in A1 is the loop region actually doing something, not a
    // no-op that would've held anyway.
    await page.evaluate((startBar) => window.__engine.play(startBar), target.startBar)
    await pollUntil(() => page.evaluate(() => window.__store.getState().playing), 'transport to report playing (control run)')
    await page.evaluate(() => window.__engine.setBpm(900)) // live-only speed-up; never touches doc.bpm/the file
    let sawOutsideControl = false
    const controlDeadline = Date.now() + 7000
    while (Date.now() < controlDeadline && !sawOutsideControl) {
      const step = await page.evaluate(() => window.__store.getState().currentStep)
      const bar = Math.floor(step / 16)
      if (step >= 0 && (bar < target.startBar || bar >= target.endBar)) sawOutsideControl = true
      await sleep(60)
    }
    assert(sawOutsideControl, '[A0] control run (no loop region) never left section 1\'s bars — test bpm/timing too slow to be meaningful')
    console.log('[A0] control: with no loop region set, playback crosses out of the section as expected')
    await page.evaluate(() => window.__engine.stop())
    await pollUntil(async () => !(await page.evaluate(() => window.__store.getState().playing)), 'transport to stop after control run')

    // A1: set the loop region to section 1 via its chip's "loop this section" toggle, then confirm
    // playback stays within [startBar, endBar) across several full loop cycles.
    await page.click('[data-section-loop="1"]')
    await pollUntil(async () => {
      const r = await page.evaluate(() => window.__store.getState().loopRegion)
      return r && r.start === target.startBar && r.end === target.endBar
    }, 'loopRegion to be set to section 1\'s bar range')
    const activeClass = await page.$eval('[data-section-loop="1"]', (el) => el.className)
    assert(activeClass.includes('active'), '[A1] the section-1 loop chip should show as active once its own range is looping')
    console.log(`[A1] loopRegion set to [${target.startBar}, ${target.endBar}) via the section chip's loop toggle`)

    await page.click('.play-btn')
    await pollUntil(() => page.evaluate(() => window.__store.getState().playing), 'transport to report playing')
    await page.evaluate(() => window.__engine.setBpm(900)) // same live-only speed-up as the control run

    // Runs for wall-clock time (not a fixed sample count) so it's robust to a loaded machine (this
    // repo's own verify convention — e.g. verify-phase22-stream-ag.mjs's edge-autoscroll poll) — a
    // slow page.evaluate round trip just yields fewer, still-valid samples rather than a flaky
    // failure. 7s at bpm 900 is comfortably several full cycles of the 4-bar region even if each
    // poll takes a few hundred ms.
    const samples = []
    const runDeadline = Date.now() + 7000
    while (Date.now() < runDeadline) {
      const step = await page.evaluate(() => window.__store.getState().currentStep)
      if (step >= 0) samples.push(Math.floor(step / 16))
      await sleep(50)
    }
    assert(samples.length > 5, `[A1] too few samples captured (${samples.length}) to judge wrapping`)
    const outOfRange = samples.filter((b) => b < target.startBar || b >= target.endBar)
    assert(outOfRange.length === 0, `[A1] playback left the loop region: saw bars ${[...new Set(outOfRange)].join(',')} outside [${target.startBar},${target.endBar})`)
    let sawWrap = false
    for (let i = 1; i < samples.length; i++) {
      if (samples[i] < samples[i - 1]) sawWrap = true // a drop mid-run = the loop actually cycled back
    }
    assert(sawWrap, '[A1] never observed a wrap back to the start of the region — playback may have just stalled at one bar')
    console.log(`[A1] PASS: ${samples.length} samples, bars ${Math.min(...samples)}-${Math.max(...samples)}, all within [${target.startBar},${target.endBar}), wrapped at least once`)
    results.loopRegionWrap = { region: { start: target.startBar, end: target.endBar }, samples: samples.length, min: Math.min(...samples), max: Math.max(...samples) }

    await page.evaluate(() => window.__engine.stop())
    await pollUntil(async () => !(await page.evaluate(() => window.__store.getState().playing)), 'transport to stop')
    await page.click('[data-loop-clear="1"]')
    await pollUntil(async () => (await page.evaluate(() => window.__store.getState().loopRegion)) === null, 'loopRegion to clear')
    console.log('[A] loop region cleared back to null (full-song behavior restored)')

    // ==================== B: click-to-seek ====================
    assert(!(await page.evaluate(() => window.__store.getState().playing)), '[B setup] expected stopped before click-to-seek checks')
    const rulerBox = await (await page.$('.arr-ruler')).boundingBox()
    const pxPerBar = rulerBox.width / totalBars
    const xForBar = (bar) => rulerBox.x + (bar + 0.5) * pxPerBar
    const rulerY = rulerBox.y + rulerBox.height / 2

    // B1: click while STOPPED (bar 15, inside "drop") -> starts playback AT that bar.
    const clickBar1 = 15
    assert(clickBar1 >= secBars[2].startBar && clickBar1 < secBars[2].endBar, '[B1 setup] clickBar1 should land inside the "drop" section')
    await page.mouse.click(xForBar(clickBar1), rulerY)
    await pollUntil(() => page.evaluate(() => window.__store.getState().playing), '[B1] a ruler click while stopped to start playback')
    const barAfterClick1 = await pollUntil(async () => {
      const step = await page.evaluate(() => window.__store.getState().currentStep)
      const bar = Math.floor(step / 16)
      return bar === clickBar1 ? bar : null
    }, `[B1] position to land on bar ${clickBar1}`, 2000)
    assert(barAfterClick1 === clickBar1, `[B1] expected bar ${clickBar1}, landed on ${barAfterClick1}`)
    const posText1 = await page.$eval('.transport-readout.position', (el) => el.textContent.trim())
    assert(posText1.startsWith(`${clickBar1 + 1}.`), `[B1] position readout should read bar ${clickBar1 + 1}.x, got "${posText1}"`)
    console.log(`[B1] PASS: click-to-seek while stopped -> started playing at bar ${clickBar1} (readout "${posText1}")`)

    // B2: click while PLAYING (bar 2, inside "intro") -> relocates WITHOUT ever reporting stopped.
    const clickBar2 = 2
    assert(clickBar2 >= secBars[0].startBar && clickBar2 < secBars[0].endBar, '[B2 setup] clickBar2 should land inside the "intro" section')
    let sawStoppedDuringClick = false
    const watcher = (async () => {
      const until = Date.now() + 900
      while (Date.now() < until) {
        if (!(await page.evaluate(() => window.__store.getState().playing))) sawStoppedDuringClick = true
        await sleep(15)
      }
    })()
    await page.mouse.click(xForBar(clickBar2), rulerY)
    await watcher
    assert(!sawStoppedDuringClick, '[B2] transport reported stopped at some point during a click-while-playing seek — should relocate without interrupting playback')
    const barAfterClick2 = await pollUntil(async () => {
      const step = await page.evaluate(() => window.__store.getState().currentStep)
      const bar = Math.floor(step / 16)
      return bar === clickBar2 ? bar : null
    }, `[B2] position to land on bar ${clickBar2}`, 2000)
    assert(barAfterClick2 === clickBar2, `[B2] expected bar ${clickBar2}, landed on ${barAfterClick2}`)
    assert(await page.evaluate(() => window.__store.getState().playing), '[B2] transport should still be playing after a click-while-playing seek')
    console.log(`[B2] PASS: click-to-seek while playing -> relocated to bar ${clickBar2} without ever reporting stopped`)
    results.clickToSeek = { stoppedClick: clickBar1, playingClick: clickBar2 }

    await page.evaluate(() => window.__engine.stop())
    await pollUntil(async () => !(await page.evaluate(() => window.__store.getState().playing)), 'transport to stop after click-to-seek checks')

    // ==================== C: regression — a real drag still selects, doesn't seek ====================
    const dragStart = xForBar(0)
    const dragEnd = xForBar(3)
    await page.mouse.move(dragStart, rulerY)
    await page.mouse.down()
    await page.mouse.move(dragEnd, rulerY, { steps: 8 }) // well past CLICK_MOVE_PX
    await page.mouse.up()
    const selBars = await pollUntil(async () => {
      const sel = await page.evaluate(() => window.__store.getState().selection)
      return sel && sel.bars ? sel.bars : null
    }, '[C] a real ruler drag to commit a bar-range selection')
    assert(selBars.start === 0 && selBars.end === 4, `[C] expected selection {start:0,end:4} from the drag, got ${JSON.stringify(selBars)}`)
    assert(!(await page.evaluate(() => window.__store.getState().playing)), '[C] a drag-to-select must not have triggered a seek/play')
    console.log(`[C] PASS: a real ruler drag still commits a selection (${JSON.stringify(selBars)}), unaffected by the click-to-seek addition`)
    results.dragStillSelects = selBars

    // ==================== D: session-only discipline — the file never changed ====================
    const finalOnDisk = readFileSync(beatPath, 'utf8')
    assert(finalOnDisk === canonical, '[D] the .beat file changed during loop-region/seek testing — this stream must be session-only, never touch the file')
    const gitDiff = git(proj, 'diff', '--stat')
    assert(gitDiff.trim() === '', `[D] expected zero git diff after all loop-region/click-to-seek interaction, got:\n${gitDiff}`)
    console.log('[D] PASS: the .beat file is byte-identical to baseline — loop region + click-to-seek are genuinely session-only')

    await page.screenshot({ path: join(uiDir, 'verify-p24ce-arrangement.png') })

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
