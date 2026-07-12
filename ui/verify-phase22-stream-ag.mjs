#!/usr/bin/env node
// Phase 22 Stream AG end-to-end verification — driven live against a real `beat daemon` in headless
// Chrome, on a real project (examples/night-shift.beat). Mirrors ui/verify-phase19-length.mjs's boot
// pattern (that stream's the direct predecessor: this one closes its "extending the rightmost region
// by dragging" deferred gap, then adds two more format/GUI surfaces). Checks, in order:
//
//   A  Drag the loop's right edge OUTWARD (grow, not just shrink) directly in the timeline — the gap
//      Phase 19 deferred because the timeline is fit-to-width (docs/phase-19-arrangement-length.md's
//      "Deferred" note). Proves the new render-time preview + edge auto-scroll actually reach
//      off-screen content, commits through the SAME loop_bars edit the +/- controls use, and leaves a
//      clean single-line .beat diff.
//   B  Clip-level loop range + time signature (v0.10): set both via the GUI's Clip View properties
//      panel, confirm they land on disk as `loop <start> <end>` / `signature <num> <den>` lines under
//      the clip block, then clear them and confirm the lines disappear (elision both directions).
//   C  Overlapping-region resolution policy: a 3-section song, growing section 0 under each of the
//      three policies, confirming the ACTUAL resulting section layout differs per policy (not just
//      that the setting exists) — push-existing shifts everything later; clip truncates the next
//      section; keep-existing refuses the growth outright (checked via both the disabled chip button
//      and a real drag that produces no change).
//
// Usage: node ui/verify-phase22-stream-ag.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8472
const PREVIEW_PORT = 5332

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
const oneLineDiff = (dir, file) => {
  const diff = git(dir, 'diff', '--unified=0', file)
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
  const removed = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'))
  return { diff, added, removed }
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p22ag-verify-'))
  const beatPath = join(proj, 'night-shift.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical loop-mode baseline')

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon on :${daemon.port} — loop_bars ${daemon.getDoc().loopBars}, song ${daemon.getDoc().song}`)

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

    // ==================== A: drag the loop's right edge OUTWARD ====================
    const loopBarsBefore = daemon.getDoc().loopBars
    console.log(`\n[A] baseline loop_bars ${loopBarsBefore} (loop mode, single implicit section)`)
    const handle = await page.$('[data-section-resize="0"]')
    const hb = await handle.boundingBox()
    const scrollBox = await (await page.$('.arr-scroll')).boundingBox()
    const targetX = scrollBox.x + scrollBox.width - 8 // pinned right at the container's edge
    const hy = hb.y + hb.height / 2

    await page.mouse.move(hb.x + hb.width / 2, hy)
    await page.mouse.down()
    // Walk the pointer to the edge, then hold it there across many ticks so the edge-autoscroll
    // (ArrangementView.tsx's resize effect) has real wall-clock time to nudge .arr-scroll's
    // scrollLeft and grow the reachable content, same as a human holding a drag at the screen edge.
    // Each poll jitters x by 1px — a genuine no-op mousemove (identical coordinates) never reaches
    // the page as a real DOM event, so the position has to actually change every tick to keep
    // driving the auto-scroll. Bounded by an overall timeout, not a fixed step count.
    await page.mouse.move(targetX, hy, { steps: 6 })
    // Poll the LIVE PREVIEW label (.arr-resize-label), not the daemon — the drag only commits
    // loop_bars to disk on pointer-up, so polling daemon.getDoc() here would just wait forever
    // while the mouse button is still down.
    let tick = 0
    await pollUntil(
      async () => {
        tick++
        await page.mouse.move(targetX + (tick % 2), hy)
        await sleep(30)
        const label = await page.$eval('.arr-resize-label', (el) => el.textContent).catch(() => null)
        const previewBars = label ? Number.parseInt(label, 10) : NaN
        return Number.isFinite(previewBars) && previewBars > loopBarsBefore
      },
      'the live drag preview to show a bar count past the fit-to-width edge',
      8000,
      10,
    )
    await page.mouse.up()
    await pollUntil(() => daemon.getDoc().loopBars > loopBarsBefore, 'loop_bars to commit to disk on pointer-up')
    await sleep(150)
    assert(daemon.getDoc().loopBars > loopBarsBefore, `[A] expected loop_bars to grow, stayed at ${daemon.getDoc().loopBars}`)
    const a = oneLineDiff(proj, 'night-shift.beat')
    console.log(`[A] dragged the right edge OUTWARD: loop_bars ${loopBarsBefore} -> ${daemon.getDoc().loopBars}. diff (unified=0):\n${a.diff}`)
    assert(a.added.length === 1 && a.removed.length === 1, `[A] expected a one-line diff, got +${a.added.length} -${a.removed.length}`)
    assert(new RegExp(`loop_bars\\s+${daemon.getDoc().loopBars}`).test(a.added[0]), `[A] the changed line is not the new loop_bars: ${a.added[0]}`)
    results.dragExtend = { before: loopBarsBefore, after: daemon.getDoc().loopBars, added: a.added }
    git(proj, 'commit', '-q', '-am', `loop_bars ${loopBarsBefore} -> ${daemon.getDoc().loopBars} via outward drag`)
    console.log('[A] PASS: the drag handle extended the loop past the fit-to-width edge, one clean line on disk')

    // ==================== B: clip-level loop range + time signature ====================
    await page.click('[data-add-section]') // loop -> 2-section song; every track gets a clip in the new scene
    await pollUntil(() => !!daemon.getDoc().song && daemon.getDoc().song.length === 2, 'loop mode to convert into a 2-section song')
    await sleep(200)
    const track0 = daemon.getDoc().selectedTrack || daemon.getDoc().tracks[0].id
    const clipId = daemon.getDoc().song[0].scene // sceneFromLiveContent names the clip after the scene
    console.log(`\n[B] track "${track0}", clip "${clipId}"`)
    await page.waitForSelector(`[data-clip-props="${clipId}"]`, { timeout: 5000 })

    await page.fill(`[data-clip-loop-start="${clipId}"]`, '0')
    await page.fill(`[data-clip-loop-end="${clipId}"]`, '4')
    await pollUntil(() => {
      const c = daemon.getDoc().tracks.find((t) => t.id === track0).clips.find((c) => c.id === clipId)
      return c.loop && c.loop.start === 0 && c.loop.end === 4
    }, 'clip.loop to land as {start:0, end:4}')
    await sleep(150)
    let onDisk = readFileSync(beatPath, 'utf8')
    assert(/\n {4}loop 0 4\n/.test(onDisk), `[B] expected "loop 0 4" under clip "${clipId}" on disk`)
    console.log('[B] loop range set via the GUI -> "loop 0 4" on disk')

    await page.fill(`[data-clip-sig-num="${clipId}"]`, '3')
    await page.selectOption(`[data-clip-sig-den="${clipId}"]`, '4')
    await pollUntil(() => {
      const c = daemon.getDoc().tracks.find((t) => t.id === track0).clips.find((c) => c.id === clipId)
      return c.signature && c.signature.numerator === 3 && c.signature.denominator === 4
    }, 'clip.signature to land as {numerator:3, denominator:4}')
    await sleep(150)
    onDisk = readFileSync(beatPath, 'utf8')
    assert(/\n {4}signature 3 4\n/.test(onDisk), '[B] expected "signature 3 4" on disk')
    console.log('[B] signature set via the GUI -> "signature 3 4" on disk')
    results.clipProps = { clipId, loop: { start: 0, end: 4 }, signature: { numerator: 3, denominator: 4 } }
    git(proj, 'commit', '-q', '-am', 'clip loop range + signature set via GUI')

    // Clear both — elision must remove the lines entirely, not just blank them.
    await page.click(`[data-clip-loop-clear="${clipId}"]`)
    await pollUntil(() => daemon.getDoc().tracks.find((t) => t.id === track0).clips.find((c) => c.id === clipId).loop === null, 'clip.loop to clear')
    await page.click(`[data-clip-sig-clear="${clipId}"]`)
    await pollUntil(() => daemon.getDoc().tracks.find((t) => t.id === track0).clips.find((c) => c.id === clipId).signature === null, 'clip.signature to clear')
    await sleep(150)
    onDisk = readFileSync(beatPath, 'utf8')
    assert(!onDisk.includes('loop 0 4') && !onDisk.includes('signature 3 4'), '[B] cleared properties must not leave stray lines on disk')
    console.log('[B] PASS: clip loop/signature round-trip through the file in both directions (set + clear)')
    git(proj, 'commit', '-q', '-am', 'clip properties cleared')

    // ==================== C: overlapping-region resolution policy ====================
    await page.click('[data-add-section]') // -> 3 sections
    await pollUntil(() => daemon.getDoc().song.length === 3, 'a 3rd section to be appended')
    await sleep(200)
    const s0 = daemon.getDoc().song[0].bars
    const s1 = daemon.getDoc().song[1].bars
    const s2 = daemon.getDoc().song[2].bars
    console.log(`\n[C] baseline sections: [${s0}, ${s1}, ${s2}]`)

    // C1: push-existing (the default) — section 1/2 untouched, total grows.
    await page.selectOption('[data-overlap-policy]', 'push-existing')
    await page.click('[data-section-plus="0"]')
    await pollUntil(() => daemon.getDoc().song[0].bars === s0 + 1, 'push-existing: section 0 to grow')
    await sleep(150)
    let song = daemon.getDoc().song
    console.log(`[C1] push-existing: [${song[0].bars}, ${song[1].bars}, ${song[2].bars}]`)
    assert(song[0].bars === s0 + 1, '[C1] section 0 should grow by 1')
    assert(song[1].bars === s1, '[C1] section 1 must be untouched under push-existing')
    assert(song[2].bars === s2, '[C1] section 2 must be untouched under push-existing')
    results.pushExisting = song.map((s) => s.bars)
    console.log('[C1] PASS: push-existing left every other section untouched (total grew)')

    // reset section 0 back to baseline for a clean C2 comparison
    await page.click('[data-section-minus="0"]')
    await pollUntil(() => daemon.getDoc().song[0].bars === s0, 'section 0 back to baseline')
    await sleep(150)

    // C2: clip — section 1 absorbs the overflow (truncated), total unchanged.
    await page.selectOption('[data-overlap-policy]', 'clip')
    await page.click('[data-section-plus="0"]')
    await pollUntil(() => daemon.getDoc().song[0].bars === s0 + 1, 'clip: section 0 to grow')
    await sleep(150)
    song = daemon.getDoc().song
    console.log(`[C2] clip: [${song[0].bars}, ${song[1].bars}, ${song[2].bars}]`)
    assert(song[0].bars === s0 + 1, '[C2] section 0 should grow by 1')
    assert(song[1].bars === s1 - 1, '[C2] section 1 should be truncated by exactly the overflow')
    assert(song[2].bars === s2, '[C2] section 2 untouched — clip never cascades past the immediate neighbor')
    assert(song[0].bars + song[1].bars + song[2].bars === s0 + s1 + s2, '[C2] total length must be unchanged')
    results.clipPolicy = song.map((s) => s.bars)
    console.log('[C2] PASS: clip truncated exactly the next section; total length held constant')

    // Reset back to baseline for C3 — switch to push-existing FIRST so the reset clicks themselves
    // are side-effect-free (still being on "clip" here would truncate section 2 again on the
    // section-1 restore, same as it did to get us into this [6, 4, 5] state).
    await page.selectOption('[data-overlap-policy]', 'push-existing')
    await page.click('[data-section-minus="0"]')
    await page.click('[data-section-plus="1"]')
    await pollUntil(
      () => daemon.getDoc().song[0].bars === s0 && daemon.getDoc().song[1].bars === s1 && daemon.getDoc().song[2].bars === s2,
      'sections back to baseline',
    )
    await sleep(150)

    // C3: keep-existing — growth is refused outright. Checked two ways: the chip is disabled, and a
    // real drag on the handle produces no change (the drag path is the "collision handling" the
    // stream is specifically about, not just the convenience chip buttons).
    await page.selectOption('[data-overlap-policy]', 'keep-existing')
    const plusDisabled = await page.$eval('[data-section-plus="0"]', (b) => b.disabled)
    assert(plusDisabled, '[C3] the [+] chip on a non-last section must be disabled under keep-existing')
    console.log('[C3] the [+] chip on section 0 is correctly disabled under keep-existing')

    const before = readFileSync(beatPath, 'utf8')
    const h0 = await page.$('[data-section-resize="0"]')
    const hb0 = await h0.boundingBox()
    await page.mouse.move(hb0.x + hb0.width / 2, hb0.y + hb0.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb0.x + hb0.width / 2 + 120, hb0.y + hb0.height / 2, { steps: 8 })
    await page.mouse.up()
    await sleep(200)
    song = daemon.getDoc().song
    console.log(`[C3] after a rightward drag attempt on section 0's handle: [${song[0].bars}, ${song[1].bars}, ${song[2].bars}]`)
    assert(song[0].bars === s0 && song[1].bars === s1 && song[2].bars === s2, '[C3] keep-existing must leave every section exactly as it was')
    assert(readFileSync(beatPath, 'utf8') === before, '[C3] a refused resize must not touch the file')
    results.keepExisting = song.map((s) => s.bars)
    console.log('[C3] PASS: keep-existing refused the growth via both the chip and a real drag — arrangement byte-for-byte unchanged')

    await page.screenshot({ path: join(uiDir, 'verify-p22ag-arrangement.png') })

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
