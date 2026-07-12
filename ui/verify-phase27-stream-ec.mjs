#!/usr/bin/env node
// Phase 27 Stream EC end-to-end verification — driven live against a real `beat daemon` + built
// frontend in headless Chrome, on a disposable copy of `examples/night-shift.beat` (loop mode, 4
// tracks: lead/drums/bass/pad — NEVER `examples/night-shift-song.beat`, the owner's own live
// project). Mirrors the boot pattern in ui/verify-phase24-stream-cc.mjs.
//
// The bug (docs/research/70-ux-arrangement-view.md §3.5, item 2; docs/phase-27-plan.md Stream EC):
// dragging a bar-range selection inside one track's lane only painted the amber selection band on
// THAT track's own canvas — every other track row stayed untouched, unlike Ableton's default where
// a time-range selection (dragged from the ruler OR a lane) is a full-arrangement vertical band
// across every track. The fix (ArrangementView.tsx's `bandForTrack`) widens the RENDER scope only —
// every row now shows the band whenever a selection/drag exists, regardless of which row the drag
// started in. The underlying selection DATA (what's posted to the daemon, what `beat vary --scope
// selection` etc. read) is UNCHANGED: a lane drag still scopes the daemon's `selection.tracks` to
// just that one track.
//
// This script checks both halves:
//
//   A  Rendering: drag a bar-range selection on the "drums" track's lane (not the ruler), with
//      lead/bass/pad also visible. Read back real canvas pixel data (average alpha over the full
//      row height at an x inside the selected bar range) for ALL FOUR tracks' `.arr-canvas`
//      elements, before and after the drag. Every track's canvas must show a material alpha jump
//      inside the selected range (the amber band, `rgba(224,161,60,0.22)`, painted across the full
//      ROW_H) — not just "drums", the row physically dragged across. A control x OUTSIDE the
//      selected range must NOT jump on any track, proving the tint is confined to the selected
//      bars, not a blanket redraw artifact.
//   B  Data-model regression: the daemon's live selection (GET /selection, what `beat selection
//      --port` and `beat vary --scope selection` both read — daemon.getSelection() here) must still
//      be scoped to exactly `{tracks: ['drums'], bars: {start, end}}`, i.e. the SAME per-track
//      selection DATA a lane drag has always produced — only how many rows render the tint changed,
//      not what got selected. Also exercises `resolveVaryTarget` (the real function `beat vary
//      --scope selection` calls server-side) directly against that live selection, confirming it
//      still resolves to the single dragged track ("drums"), not something broadened by the render
//      fix.
//
// Usage: node ui/verify-phase27-stream-ec.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8478
const PREVIEW_PORT = 5347

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

  const { startDaemon, resolveVaryTarget } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // Disposable copy of the STABLE loop-mode fixture, in a scratch temp dir — never touches
  // examples/night-shift-song.beat, the owner's actively-edited project.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p27ec-verify-'))
  const beatPath = join(proj, 'night-shift.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical loop-mode baseline')

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  const doc0 = daemon.getDoc()
  assert(doc0.song === null, `[setup] expected loop-mode (song === null), got ${JSON.stringify(doc0.song)}`)
  const trackIds = doc0.tracks.map((t) => t.id)
  console.log(`daemon on :${daemon.port} — loop mode, ${doc0.loopBars ?? doc0.loop_bars} bars, tracks: ${trackIds.join(', ')}`)
  assert(trackIds.includes('drums') && trackIds.length >= 3, `[setup] expected "drums" plus at least 2 other tracks, got ${trackIds.join(', ')}`)

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
    await page.setViewportSize({ width: 1600, height: 900 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    await page.waitForSelector('.arr-canvas', { timeout: 5000 })
    await sleep(300) // let ResizeObserver settle the lane/ruler widths

    const lanesOnScreen = await page.$$eval('.arr-lane[data-track]', (els) => els.map((el) => el.getAttribute('data-track')))
    console.log(`\n[setup] ${lanesOnScreen.length} track lanes visible: ${lanesOnScreen.join(', ')}`)
    assert(lanesOnScreen.length >= 3, `[setup] expected at least 3 visible track lanes, found ${lanesOnScreen.length}`)
    for (const id of ['drums', 'lead', 'bass', 'pad']) {
      assert(lanesOnScreen.includes(id), `[setup] expected "${id}" lane visible, got ${JSON.stringify(lanesOnScreen)}`)
    }

    const loopBars = doc0.loopBars ?? doc0.loop_bars ?? 4
    const pxPerBar = await page.$eval('.arr-ruler', (el) => Number(el.getAttribute('data-pxperbar')))
    assert(pxPerBar > 0, `[setup] expected a positive px/bar, got ${pxPerBar}`)
    console.log(`[setup] ${loopBars} bars @ ${pxPerBar.toFixed(1)}px/bar (fit-to-width)`)

    const ROW_H = 56 // ArrangementView.tsx's own ROW_H constant — the canvas's own CSS height

    // Pixel probe: average the ALPHA channel over a full-height 1px-wide column of one track's
    // canvas at a given bar-relative x. Alpha (not RGB) is the robust signal here — the band overlay
    // (`rgba(224,161,60,0.22)`, drawn `fillRect(x0, 0, x1-x0, ROW_H)`) covers the ENTIRE row height
    // regardless of what note/hit/density content underlies it (which varies per track/bar and would
    // make a fixed RGB threshold unreliable), while ordinary row content (thin note ticks, sparse
    // hit slivers) only ever touches a small fraction of the column's height. A real band always
    // pushes the column's average alpha up by tens of levels; unrelated re-renders of unrelated bars
    // don't.
    async function avgColumnAlpha(trackId, barX) {
      return page.$eval(
        `.arr-lane[data-track="${trackId}"] canvas.arr-canvas`,
        (canvas, { barX, ROW_H }) => {
          const ctx = canvas.getContext('2d')
          const dpr = window.devicePixelRatio || 1
          const px = Math.round(barX * dpr)
          const h = Math.round(ROW_H * dpr)
          if (px < 0 || px >= canvas.width) return null
          const data = ctx.getImageData(px, 0, 1, h).data
          let sum = 0
          let n = 0
          for (let i = 3; i < data.length; i += 4) {
            sum += data[i]
            n++
          }
          return n ? sum / n : null
        },
        { barX, ROW_H },
      )
    }

    // Selected range: bars [1, 3) — comfortably inside the 4-bar loop, away from the canvas's own
    // edges. Sample x inside the band mid-way through bar 1 (well clear of the band's own left/right
    // border stroke lines), and a control x in bar 3.5 — inside the loop, OUTSIDE the selected range.
    const xInside = 1.5 * pxPerBar
    const xOutside = 3.5 * pxPerBar

    const before = {}
    for (const id of ['drums', 'lead', 'bass', 'pad']) {
      before[id] = { inside: await avgColumnAlpha(id, xInside), outside: await avgColumnAlpha(id, xOutside) }
    }
    console.log(`\n[before] per-track avg column alpha: ${JSON.stringify(before)}`)

    // ==================== drag a bar-range selection on "drums"'s own lane ====================
    const drumsLane = await page.$eval('.arr-lane[data-track="drums"]', (el) => el.getBoundingClientRect())
    const startX = drumsLane.x + 1 * pxPerBar + 6 // just inside bar 1
    const endX = drumsLane.x + 2 * pxPerBar + 6 // into bar 2 -> selection [1,3)
    const y = drumsLane.y + drumsLane.height / 2

    await page.mouse.move(startX, y)
    await page.mouse.down()
    await page.mouse.move((startX + endX) / 2, y, { steps: 5 })
    await page.mouse.move(endX, y, { steps: 10 })
    await page.mouse.up()
    await sleep(250)

    // ==================== B: the underlying selection DATA is unchanged (still per-track) ====================
    const liveSel = daemon.getSelection()
    console.log(`\n[B] daemon.getSelection() after the lane drag: ${JSON.stringify(liveSel)}`)
    assert(JSON.stringify(liveSel.tracks) === JSON.stringify(['drums']), `[B] expected selection.tracks === ["drums"] (a lane drag still scopes the DATA to one track), got ${JSON.stringify(liveSel.tracks)}`)
    assert(liveSel.bars && liveSel.bars.start === 1 && liveSel.bars.end === 3, `[B] expected selection.bars === {start:1,end:3}, got ${JSON.stringify(liveSel.bars)}`)
    const resolved = resolveVaryTarget(liveSel, daemon.getDoc())
    console.log(`[B] resolveVaryTarget(selection) (the real function \`beat vary --scope selection\` calls) resolved to: ${JSON.stringify(resolved)}`)
    assert(resolved.track === 'drums', `[B] resolveVaryTarget should resolve to "drums" (the single dragged track), got "${resolved.track}"`)
    console.log('[B] PASS: a lane drag still produces the SAME per-track selection DATA as before — only the render scope changed, downstream selection-reading logic is unaffected')
    results.selectionAfterLaneDrag = liveSel
    results.resolvedVaryTarget = resolved

    // ==================== A: every visible track's canvas shows the band, not just "drums" ====================
    const after = {}
    for (const id of ['drums', 'lead', 'bass', 'pad']) {
      after[id] = { inside: await avgColumnAlpha(id, xInside), outside: await avgColumnAlpha(id, xOutside) }
    }
    console.log(`\n[A] per-track avg column alpha after the "drums"-lane drag: ${JSON.stringify(after)}`)

    const JUMP_THRESHOLD = 20 // out of 255 — the band alone contributes ~0.22*255 ≈ 56 over a near-transparent backdrop
    const STABLE_THRESHOLD = 10
    const deltas = {}
    for (const id of ['drums', 'lead', 'bass', 'pad']) {
      const insideDelta = after[id].inside - before[id].inside
      const outsideDelta = after[id].outside - before[id].outside
      deltas[id] = { insideDelta, outsideDelta }
      assert(insideDelta >= JUMP_THRESHOLD, `[A] "${id}"'s canvas should show a selection-band alpha jump inside bars [1,3) (>=${JUMP_THRESHOLD}), got ${insideDelta.toFixed(1)} (before=${before[id].inside?.toFixed(1)}, after=${after[id].inside?.toFixed(1)}) — the bug this stream fixes was that only "drums" (the row physically dragged across) showed this`)
      assert(Math.abs(outsideDelta) < STABLE_THRESHOLD, `[A] "${id}"'s canvas should NOT show a material alpha change OUTSIDE the selected range (bar 3.5), got delta ${outsideDelta.toFixed(1)} — the tint must be confined to the selected bars, not a blanket redraw`)
    }
    console.log(`[A] deltas: ${JSON.stringify(deltas, null, 2)}`)
    assert(
      ['drums', 'lead', 'bass', 'pad'].every((id) => deltas[id].insideDelta >= JUMP_THRESHOLD),
      '[A] expected ALL FOUR visible track rows to show the selection band, not just the row dragged across',
    )
    console.log('[A] PASS: dragging on "drums"\'s own lane painted the selection band across ALL FOUR visible track rows (lead/drums/bass/pad), matching Ableton\'s full-arrangement time-selection convention — not just the row physically dragged across')
    results.deltas = deltas

    await page.screenshot({ path: join(uiDir, 'verify-p27ec-selection-band.png') })

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
