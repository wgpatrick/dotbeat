#!/usr/bin/env node
// Phase 19 Stream V end-to-end verification — the arrangement-length controls, driven live against a
// real `beat daemon` in headless Chrome, on a real LOOP-MODE project (examples/night-shift.beat,
// loop_bars 4, no song block). Mirrors ui/verify-phase13.mjs's boot pattern. Checks, in order, the
// whole length-editing surface this stream adds:
//
//   A  Loop extend via the +/- control: click [+] -> loop_bars 4->5 on disk, a clean ONE-LINE diff.
//   A2 Loop extend via the ruler drag handle: drag the section's right edge -> loop_bars grows again,
//      still a one-line diff (proves the drag path commits through the same loop_bars edit).
//   B  Loop -> song conversion: "+ section" from loop mode -> a real 2-section song whose section 0 is
//      the old loop (same bars) and whose scene snapshots every track's live content into clips; the
//      arrangement timeline visibly grows (totalBars doubles, two section labels render).
//   C  Append in song mode: "+ section" again -> a 3rd section, timeline grows again.
//   D  Resize a section: [+] on section 0 -> that section grows one bar, timeline grows one bar.
//   E  Delete a section: [x] on the middle section -> timeline shrinks, the remaining sections and
//      their bar counts stay intact.
//
// Screenshot: the converted multi-section arrangement.
//
// Usage: node ui/verify-phase19-length.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8471
const PREVIEW_PORT = 5331

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
// totalBars as the component computes it: song ? sum(section bars) : loop_bars.
const totalBarsOf = (page) =>
  page.evaluate(() => {
    const d = window.__store.getState().doc
    return d.song && d.song.length ? d.song.reduce((n, s) => n + s.bars, 0) : d.loopBars
  })

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // A real LOOP-MODE project in current canonical form (so each length change is a clean diff, not a
  // format migration). night-shift.beat has no song block — loop_bars 4.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p19-verify-'))
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

    // ---- A: loop extend via the +/- control ----
    assert(daemon.getDoc().loopBars === 4, `[A] expected baseline loop_bars 4, got ${daemon.getDoc().loopBars}`)
    await page.click('[data-loop-plus]')
    await pollUntil(() => daemon.getDoc().loopBars === 5, 'loop_bars to become 5 on disk')
    await sleep(150)
    const a = oneLineDiff(proj, 'night-shift.beat')
    console.log(`\n[A] clicked [+]: loop_bars 4 -> ${daemon.getDoc().loopBars}. diff (unified=0):\n${a.diff}`)
    assert(a.added.length === 1 && a.removed.length === 1, `[A] expected a one-line diff, got +${a.added.length} -${a.removed.length}`)
    assert(/loop_bars\s+5/.test(a.added[0]), `[A] the changed line is not loop_bars: ${a.added[0]}`)
    results.loopPlus = { added: a.added, removed: a.removed }
    git(proj, 'commit', '-q', '-am', 'loop_bars 4 -> 5 via + control')
    console.log('[A] PASS: the +/- control extended the loop by one bar, one clean line on disk')

    // ---- A2: loop resize via the ruler drag handle ----
    // In loop mode the single region fills the whole width, so its right-edge handle sits at the far
    // right — dragging it LEFT (shrink) is what stays on-screen and proves the handle commits a real
    // loop_bars edit. (Extending by one bar is already covered by [A]'s +/- control.)
    const rulerBox = await (await page.$('.arr-ruler')).boundingBox()
    const pxPerBar = rulerBox.width / daemon.getDoc().loopBars // 5 bars right now
    const handle = await page.$('[data-section-resize="0"]')
    const hb = await handle.boundingBox()
    const hy = hb.y + hb.height / 2
    await page.mouse.move(hb.x + hb.width / 2, hy)
    await page.mouse.down()
    await page.mouse.move(hb.x + hb.width / 2 - pxPerBar * 2, hy, { steps: 10 })
    await page.mouse.up()
    await pollUntil(() => daemon.getDoc().loopBars === 3, 'loop_bars to shrink to 3 via the drag handle')
    await sleep(150)
    const a2 = oneLineDiff(proj, 'night-shift.beat')
    console.log(`\n[A2] dragged the loop's right edge -2 bars: loop_bars 5 -> ${daemon.getDoc().loopBars}. diff:\n${a2.diff}`)
    assert(a2.added.length === 1 && /loop_bars\s+3/.test(a2.added[0]), `[A2] expected a one-line loop_bars 3 diff, got ${JSON.stringify(a2.added)}`)
    results.loopDrag = { loopBars: daemon.getDoc().loopBars, added: a2.added }
    // Restore to a comfortable 4 bars for the song-conversion checks, then commit a clean baseline.
    await page.click('[data-loop-plus]')
    await pollUntil(() => daemon.getDoc().loopBars === 4, 'loop_bars back to 4')
    await sleep(150)
    git(proj, 'commit', '-q', '-am', 'loop resized via drag handle, back to 4')
    console.log('[A2] PASS: the ruler drag handle resized the loop, one clean line on disk')

    // ---- B: loop -> song conversion ----
    const loopBars = daemon.getDoc().loopBars
    const beforeTotal = await totalBarsOf(page)
    await page.click('[data-add-section]')
    await pollUntil(() => !!daemon.getDoc().song && daemon.getDoc().song.length === 2, 'loop mode to convert into a 2-section song')
    await sleep(200)
    const song = daemon.getDoc().song
    const doc = daemon.getDoc()
    console.log(`\n[B] "+ section" from loop mode -> song: ${song.map((s) => `${s.scene}(${s.bars})`).join(' ')}`)
    assert(song[0].bars === loopBars, `[B] section 0 should keep the loop length ${loopBars}, got ${song[0].bars}`)
    assert(song[1].bars === loopBars, `[B] appended section should duplicate the loop length ${loopBars}, got ${song[1].bars}`)
    const scene = doc.scenes.find((s) => s.id === song[0].scene)
    assert(scene, `[B] the conversion should mint a scene "${song[0].scene}"`)
    for (const t of doc.tracks) {
      assert(scene.slots[t.id] === song[0].scene, `[B] track ${t.id} not mapped in the scene`)
      assert(t.clips.some((c) => c.id === song[0].scene), `[B] track ${t.id} has no snapshot clip`)
    }
    const labels = await page.$$eval('.arr-section-name', (els) => els.map((e) => e.textContent))
    const afterTotal = await totalBarsOf(page)
    console.log(`[B] section labels now ${JSON.stringify(labels)}; timeline ${beforeTotal} -> ${afterTotal} bars`)
    assert(labels.length === 2, `[B] expected 2 section labels, got ${labels.length}`)
    assert(afterTotal === beforeTotal * 2, `[B] timeline should double to ${beforeTotal * 2}, got ${afterTotal}`)
    const fileText = readFileSync(beatPath, 'utf8')
    assert(/\nsong\n/.test(fileText) && /\n  section /.test(fileText) && /\nscene /.test(fileText), '[B] the .beat file did not gain a song/scene block')
    results.convert = { song: song.map((s) => ({ scene: s.scene, bars: s.bars })), beforeTotal, afterTotal }
    git(proj, 'commit', '-q', '-am', 'convert loop -> 2-section song')
    console.log('[B] PASS: loop converted into a real, populated 2-section song; timeline doubled on screen')

    // ---- C: append in song mode ----
    const t2 = await totalBarsOf(page)
    await page.click('[data-add-section]')
    await pollUntil(() => daemon.getDoc().song.length === 3, 'a 3rd section to be appended')
    await sleep(200)
    const t3 = await totalBarsOf(page)
    const labels3 = await page.$$eval('.arr-section-name', (els) => els.length)
    console.log(`\n[C] "+ section" in song mode -> ${daemon.getDoc().song.length} sections; timeline ${t2} -> ${t3} bars, ${labels3} labels`)
    assert(labels3 === 3, `[C] expected 3 section labels, got ${labels3}`)
    assert(t3 === t2 + loopBars, `[C] timeline should grow by ${loopBars} to ${t2 + loopBars}, got ${t3}`)
    git(proj, 'commit', '-q', '-am', 'append 3rd section')
    console.log('[C] PASS: appending in song mode grew the timeline')

    // ---- D: resize a section ----
    const bars0 = daemon.getDoc().song[0].bars
    const tD0 = await totalBarsOf(page)
    await page.click('[data-section-plus="0"]')
    await pollUntil(() => daemon.getDoc().song[0].bars === bars0 + 1, 'section 0 to grow one bar')
    await sleep(200)
    const tD1 = await totalBarsOf(page)
    console.log(`\n[D] [+] on section 0: ${bars0} -> ${daemon.getDoc().song[0].bars} bars; timeline ${tD0} -> ${tD1}`)
    assert(tD1 === tD0 + 1, `[D] timeline should grow by 1 to ${tD0 + 1}, got ${tD1}`)
    git(proj, 'commit', '-q', '-am', 'resize section 0 +1')
    console.log('[D] PASS: resizing a section grew exactly that section and the timeline')

    // ---- E: delete a section ----
    const before = daemon.getDoc().song.map((s) => ({ scene: s.scene, bars: s.bars }))
    const tE0 = await totalBarsOf(page)
    await page.click('[data-section-delete="1"]')
    await pollUntil(() => daemon.getDoc().song.length === 2, 'the middle section to be deleted')
    await sleep(200)
    const after = daemon.getDoc().song.map((s) => ({ scene: s.scene, bars: s.bars }))
    const tE1 = await totalBarsOf(page)
    console.log(`\n[E] deleted section 1: ${JSON.stringify(before)} -> ${JSON.stringify(after)}; timeline ${tE0} -> ${tE1}`)
    assert(after.length === 2, `[E] expected 2 sections after delete, got ${after.length}`)
    assert(after[0].bars === before[0].bars && after[0].scene === before[0].scene, '[E] section 0 was not left intact')
    assert(after[1].bars === before[2].bars && after[1].scene === before[2].scene, '[E] the surviving 3rd section was altered')
    assert(tE1 === tE0 - before[1].bars, `[E] timeline should shrink by ${before[1].bars} to ${tE0 - before[1].bars}, got ${tE1}`)
    results.delete = { before, after, tE0, tE1 }
    await page.screenshot({ path: join(uiDir, 'verify-p19-arrangement.png') })
    console.log('[E] PASS: deleting a section shrank the timeline; the remaining sections stayed intact -> ui/verify-p19-arrangement.png')

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
