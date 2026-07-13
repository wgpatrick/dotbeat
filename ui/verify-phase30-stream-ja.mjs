#!/usr/bin/env node
// Phase 30 Stream JA verification — drum-hit editor (docs/phase-30-plan.md's "JA" section,
// docs/research/89-usability-pilot-clip-editing.md).
//
// This stream's brief named three bugs. After exhaustive live re-testing against a REAL beat
// daemon + the built frontend in headless Chrome (single delete via keyboard AND the toolbar
// button, single move, single gate/resize, a resize-then-move-then-multi-delete combo, group
// (multi-select) move and delete, and marquee-select — each checked on BOTH an implicit 5-lane
// kit (`lanes: []`, night-shift.beat's own `drums` track) and after "Enable lane editing"
// materializes the lanes, against a production build AND `vite dev`, with a full page reload
// after each), only ONE of the three reproduced:
//
//   - The "drum-hit edits don't reach the daemon" persistence bug did NOT reproduce, in any
//     combination tried. Every delete/move/resize/group-op landed on the daemon's own
//     `GET /document` and survived a full reload. Given research/89 itself explains pilots 87-89
//     ran "while Phase 29's six streams were being merged into that same checkout over roughly
//     ninety minutes" (a live-reloading dev server against a moving target), and that research/89
//     was committed to the repo (c905f15) chronologically AFTER Phase 29 Stream GC landed
//     (a54c249) — GC fixed exactly this class of gesture/selection bug in the SAME shared
//     move/resize code path this stream's hit branches also run through (its bug 4, "selection
//     doesn't narrow on click", and bug 5, "drag-resize scroll drift") — this looks like the same
//     "artifact of testing a partial merge mid-session" class the plan's own intro already
//     documents for several of pilots 87/88's findings, just not caught for JA specifically
//     because the plan's own pre-writing re-verification only re-ran the raw `POST /edit` API
//     path (confirmed working), not a live GUI session against current stable main. T1-T6 below
//     lock this behavior in as a regression guard now that it's been independently re-confirmed.
//   - Marquee-select on the drum-hit editor did NOT reproduce as broken either — a drag rectangle
//     over several populated hit cells already selects them and draws a visible marquee box,
//     identically to the note editor. T5 guards this too.
//   - The hitbox imbalance WAS real and confirmed by reading the code: `.noteview-resize` (the
//     resize/gate handle) is a flat 5px-wide `right:0` strip shared by every event type, but a
//     durationless hit renders as a fixed MARKER_W=7px pill — so the shared handle consumed 5 of
//     its 7px, leaving only the leftmost ~2px as a safe move target (matching research/89's
//     bounding-box measurement once the marker's own border/rounding is accounted for). Fixed
//     with a `.noteview-note.marker .noteview-resize { width: 2px }` override in styles.css —
//     only markers get the narrower handle; notes and already-gated hit bars (both comfortably
//     wider than 5px) are untouched. T3/T4 verify the new balance: grabbing the marker's middle
//     now moves it; grabbing the true right edge still resizes/gates it.
//
//   T1  DELETE (implicit kit) — select one hit via click, delete via the Delete key, confirm the
//       daemon's GET /document (not just window.__store) no longer has it, and it survives reload.
//   T2  MOVE + GATE/RESIZE + GROUP DELETE (implicit kit) — a single continuous session: gate/resize
//       one hit into a bar, move that same hit, then shift-click-select 3 more hits and delete them
//       via the toolbar "Delete" button — all four operations checked against the daemon and a
//       full reload, matching research/89's own combined repro shape (resize, move, multi-delete
//       all in one pilot session).
//   T3  HITBOX — grabbing a marker ~3px in from its left edge (within the OLD 5px handle's zone,
//       which used to force a resize) now produces a MOVE (start changes, duration stays
//       undefined).
//   T4  HITBOX — grabbing a marker's true right edge (within the NEW 2px handle) still produces a
//       GATE/RESIZE (duration becomes defined), so the resize affordance survives the narrowing.
//   T5  MARQUEE — a drag rectangle spanning several populated hit cells draws a visible marquee box
//       and selects exactly the hits inside it.
//   T6  MATERIALIZED LANES — after "Enable lane editing", group move + group delete on drum hits
//       still land on the daemon and survive reload (rules out the bug being lane-state-specific).
//
// Usage: node ui/verify-phase30-stream-ja.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 9030
const PREVIEW_PORT = 9040

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
}
async function pollUntil(fn, what, timeoutMs = 9000, everyMs = 40) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}

function freshProject(dirTag) {
  const proj = mkdtempSync(join(tmpdir(), `dotbeat-verify-ja-${dirTag}-`))
  const beatPath = join(proj, 'song.beat')
  // NEVER examples/night-shift-song.beat (the owner's live project) — always a disposable copy of
  // the fixture, in a scratch tmp dir, per this stream's ground rules.
  writeFileSync(beatPath, readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))
  return { proj, beatPath }
}

async function daemonDoc(port) {
  return fetch(`http://localhost:${port}/document`).then((r) => r.json())
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
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

  async function withPage(fn) {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1600, height: 980 })
    page.on('dialog', (d) => d.dismiss())
    const warnings = []
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') warnings.push(msg.text())
    })
    try {
      return await fn(page, warnings)
    } finally {
      await page.close()
    }
  }

  async function openDrums(page, daemonPort) {
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemonPort}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    await page.click('.arr-track-select:has(.arr-track-name:text-is("drums"))')
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    await sleep(150)
  }

  try {
    // ============ T1: single delete (implicit kit), daemon-level + reload check ============
    {
      const { proj, beatPath } = freshProject('t1')
      const daemon = await startDaemon({ filePath: beatPath, port: PORT })
      try {
        await withPage(async (page) => {
          await openDrums(page, daemon.port)
          const doc0 = await daemonDoc(PORT)
          const drums0 = doc0.tracks.find((t) => t.id === 'drums')
          assert(drums0.lanes.length === 0, 'T1 fixture precondition: drums track should be an implicit (unmaterialized) kit')
          const kick0 = drums0.hits.find((h) => h.id === 'kick0')
          assert(kick0, 'T1 fixture precondition: expected a "kick0" hit on the drums track')
          const totalSteps = doc0.loopBars * 16
          const gridBox = await page.locator('.noteview-grid').boundingBox()
          const stepW = gridBox.width / totalSteps

          // click inside the kick0 marker body (row 0 = kick, step 0)
          await page.mouse.click(gridBox.x + 0.15 * stepW, gridBox.y + 0 * 12 + 6)
          await sleep(120)
          const sel = await page.evaluate(() => window.__store.getState().editNoteIds)
          assert(sel.length === 1 && sel[0] === 'kick0', `T1: expected selection ["kick0"], got ${JSON.stringify(sel)}`)

          await page.keyboard.press('Delete')
          await sleep(400)

          const daemonAfter = await pollUntil(
            async () => {
              const d = await daemonDoc(PORT)
              const still = d.tracks.find((t) => t.id === 'drums').hits.some((h) => h.id === 'kick0')
              return still ? null : d
            },
            'daemon document to lose "kick0" after a GUI-driven Delete',
          )
          assert(!daemonAfter.tracks.find((t) => t.id === 'drums').hits.some((h) => h.id === 'kick0'), 'T1: kick0 should be gone from the DAEMON document')
          assert(
            daemonAfter.tracks.find((t) => t.id === 'drums').hits.length === drums0.hits.length - 1,
            'T1: daemon hit count should have dropped by exactly 1',
          )

          await page.reload({ waitUntil: 'load' })
          await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
          await sleep(250)
          const countAfterReload = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').hits.length)
          assert(countAfterReload === drums0.hits.length - 1, `T1: hit count should survive reload at ${drums0.hits.length - 1}, got ${countAfterReload}`)
          results.t1 = { before: drums0.hits.length, afterDelete: daemonAfter.tracks.find((t) => t.id === 'drums').hits.length, afterReload: countAfterReload }
          console.log(`[T1] PASS: delete (implicit kit) persisted to the daemon and survived reload — ${JSON.stringify(results.t1)}`)
        })
      } finally {
        await daemon.close()
      }
    }

    // ============ T2: gate/resize + move + group delete combo (implicit kit) ============
    {
      const { beatPath } = freshProject('t2')
      const daemon = await startDaemon({ filePath: beatPath, port: PORT + 1 })
      try {
        await withPage(async (page) => {
          await openDrums(page, daemon.port)
          const doc0 = await daemonDoc(PORT + 1)
          const totalSteps = doc0.loopBars * 16
          let gridBox = await page.locator('.noteview-grid').boundingBox()
          const stepW = gridBox.width / totalSteps

          // gate/resize kick4 (step 4, row 0) into a 2-step bar
          let x = gridBox.x + 4 * stepW + 5 // within the (still-5px, since this is a marker becoming a bar) handle zone
          let y = gridBox.y + 0 * 12 + 6
          await page.mouse.move(x, y)
          await page.mouse.down()
          await page.mouse.move(x + 2 * stepW, y, { steps: 5 })
          await sleep(30)
          await page.mouse.up()
          await sleep(250)

          let d = await daemonDoc(PORT + 1)
          let kick4 = d.tracks.find((t) => t.id === 'drums').hits.find((h) => h.id === 'kick4')
          assert(kick4 && kick4.duration === 2, `T2: expected kick4 gated to duration 2 on the daemon, got ${JSON.stringify(kick4)}`)

          // move that same (now-bar) hit: grab its left portion, drag 3 steps right + 1 lane down
          gridBox = await page.locator('.noteview-grid').boundingBox()
          x = gridBox.x + 4 * stepW + 1
          y = gridBox.y + 0 * 12 + 6
          await page.mouse.move(x, y)
          await page.mouse.down()
          await page.mouse.move(x + 3 * stepW, y + 6, { steps: 5 }) // +6, not +12: the row-delta math rounds off the ROW_H boundary, so +12 lands exactly on a row's edge and can round to +2 rows instead of +1
          await sleep(30)
          await page.mouse.up()
          await sleep(250)

          d = await daemonDoc(PORT + 1)
          kick4 = d.tracks.find((t) => t.id === 'drums').hits.find((h) => h.id === 'kick4')
          assert(kick4 && kick4.start === 7 && kick4.lane === 'snare', `T2: expected kick4 moved to lane=snare,start=7 on the daemon, got ${JSON.stringify(kick4)}`)

          // shift-click select 3 more hits, delete via the toolbar button
          const targets = d.tracks.find((t) => t.id === 'drums').hits.filter((h) => h.start >= 20 && h.start <= 30).slice(0, 3)
          assert(targets.length === 3, `T2 fixture precondition: expected >=3 hits in steps 20-30, found ${targets.length}`)
          const laneOrder = ['kick', 'snare', 'clap', 'hat', 'openhat']
          for (const [i, t] of targets.entries()) {
            const rowIdx = laneOrder.indexOf(t.lane)
            const tx = gridBox.x + (t.start + 0.15) * stepW
            const ty = gridBox.y + rowIdx * 12 + 6
            if (i === 0) await page.mouse.click(tx, ty)
            else {
              await page.keyboard.down('Shift')
              await page.mouse.click(tx, ty)
              await page.keyboard.up('Shift')
            }
            await sleep(80)
          }
          const sel = await page.evaluate(() => window.__store.getState().editNoteIds)
          assert(sel.length === 3, `T2: expected 3 hits selected for group delete, got ${JSON.stringify(sel)}`)
          await page.click('.note-del-btn')
          await sleep(300)

          const daemonAfter = await pollUntil(
            async () => {
              const dd = await daemonDoc(PORT + 1)
              const hits = dd.tracks.find((t) => t.id === 'drums').hits
              const stillThere = targets.some((t) => hits.some((h) => h.id === t.id))
              return stillThere ? null : dd
            },
            'daemon document to lose all 3 group-deleted hits',
          )
          const finalHits = daemonAfter.tracks.find((t) => t.id === 'drums').hits
          assert(finalHits.length === doc0.tracks.find((t) => t.id === 'drums').hits.length - 3, `T2: daemon hit count should have dropped by exactly 3`)

          await page.reload({ waitUntil: 'load' })
          await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
          await sleep(250)
          const countAfterReload = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').hits.length)
          assert(countAfterReload === finalHits.length, `T2: hit count should survive reload at ${finalHits.length}, got ${countAfterReload}`)
          results.t2 = { finalDaemonCount: finalHits.length, afterReload: countAfterReload }
          console.log(`[T2] PASS: gate/resize + move + group-delete combo all persisted to the daemon and survived reload — ${JSON.stringify(results.t2)}`)
        })
      } finally {
        await daemon.close()
      }
    }

    // ============ T3/T4: hitbox rebalance ============
    {
      const { beatPath } = freshProject('t34')
      const daemon = await startDaemon({ filePath: beatPath, port: PORT + 2 })
      try {
        await withPage(async (page) => {
          await openDrums(page, daemon.port)
          const doc0 = await daemonDoc(PORT + 2)
          const totalSteps = doc0.loopBars * 16
          const gridBox = await page.locator('.noteview-grid').boundingBox()
          const stepW = gridBox.width / totalSteps

          // T3: grab kick0's marker ~3px in from the left (inside the OLD 5px handle's zone,
          // which used to force a resize) and drag right -- should MOVE, not resize. Y is offset
          // +5 (not +6/ROW_H-half) from the row top so a purely-horizontal drag doesn't land
          // exactly on the row-delta formula's 0.5 rounding boundary and tip into an unintended
          // row change (Math.round(0.5) rounds up in JS) -- a test-precision concern, not a
          // product one; ROW_H=12 gives plenty of margin at +5.
          let x = gridBox.x + 3
          let y = gridBox.y + 0 * 12 + 5
          await page.mouse.move(x, y)
          await page.mouse.down()
          await page.mouse.move(x + 3 * stepW, y, { steps: 5 })
          await sleep(30)
          await page.mouse.up()
          await sleep(250)
          let d = await daemonDoc(PORT + 2)
          let kick0 = d.tracks.find((t) => t.id === 'drums').hits.find((h) => h.id === 'kick0')
          assert(kick0, 'T3: kick0 should still exist')
          assert(kick0.duration === undefined, `T3: grabbing the marker mid-body should MOVE it (stay durationless), got duration=${kick0.duration}`)
          assert(kick0.start === 3, `T3: expected kick0 moved to start=3, got start=${kick0.start}`)
          assert(kick0.lane === 'kick', `T3: a horizontal-only drag should not change the lane, got lane=${kick0.lane}`)

          // T4: grab kick4's marker at its true right edge (within the NEW 2px handle) and drag
          // right -- should still GATE/RESIZE it into a bar.
          x = gridBox.x + 4 * stepW + 6 // 6px in of a 7px marker: inside the new 2px (5-7) handle zone
          y = gridBox.y + 0 * 12 + 5
          await page.mouse.move(x, y)
          await page.mouse.down()
          await page.mouse.move(x + 2 * stepW, y, { steps: 5 })
          await sleep(30)
          await page.mouse.up()
          await sleep(250)
          d = await daemonDoc(PORT + 2)
          let kick4 = d.tracks.find((t) => t.id === 'drums').hits.find((h) => h.id === 'kick4')
          assert(kick4, 'T4: kick4 should still exist')
          assert(kick4.duration !== undefined && kick4.duration > 0, `T4: grabbing the marker's true right edge should still GATE/RESIZE it, got duration=${kick4.duration}`)
          assert(kick4.start === 4, `T4: a resize should not have moved kick4's start, got start=${kick4.start}`)
          assert(kick4.lane === 'kick', `T4: a resize should not change the lane, got lane=${kick4.lane}`)

          results.t3 = { kick0AfterMidGrab: kick0 }
          results.t4 = { kick4AfterEdgeGrab: kick4 }
          console.log(`[T3] PASS: grabbing a marker's middle now MOVES it — ${JSON.stringify(kick0)}`)
          console.log(`[T4] PASS: grabbing a marker's true right edge still GATES/RESIZES it — ${JSON.stringify(kick4)}`)
        })
      } finally {
        await daemon.close()
      }
    }

    // ============ T5: marquee-select in the drum-hit editor ============
    {
      const { beatPath } = freshProject('t5')
      const daemon = await startDaemon({ filePath: beatPath, port: PORT + 3 })
      try {
        await withPage(async (page) => {
          await openDrums(page, daemon.port)
          const doc0 = await daemonDoc(PORT + 3)
          const drums0 = doc0.tracks.find((t) => t.id === 'drums')
          const totalSteps = doc0.loopBars * 16
          const gridBox = await page.locator('.noteview-grid').boundingBox()
          const stepW = gridBox.width / totalSteps
          // The drag below spans x in [0, 9.5*stepW) -- any hit starting before step 9.5 overlaps
          // the marquee rect (matching onGridPointerMove's own `ex0 < x1` overlap test).
          const expected = drums0.hits.filter((h) => h.start < 9.5).map((h) => h.id)
          assert(expected.length >= 3, `T5 fixture precondition: expected several hits in steps 0-9, found ${expected.length}`)

          // drag from an EMPTY cell (step 9.5, row 0) back across steps 0-9, rows 0-4
          const startX = gridBox.x + 9.5 * stepW
          const startY = gridBox.y + 0 * 12 + 2
          const endX = gridBox.x + 0 * stepW
          const endY = gridBox.y + 5 * 12 - 2
          await page.mouse.move(startX, startY)
          await page.mouse.down()
          await page.mouse.move(startX - 20, startY + 5, { steps: 3 })
          await sleep(30)
          const marqueeVisible = (await page.locator('.noteview-marquee').count()) > 0
          await page.mouse.move(endX, endY, { steps: 5 })
          await sleep(30)
          const marqueeVisible2 = (await page.locator('.noteview-marquee').count()) > 0
          await page.mouse.up()
          await sleep(100)

          assert(marqueeVisible, 'T5: the marquee rubber-band box should be visible mid-drag')
          assert(marqueeVisible2, 'T5: the marquee rubber-band box should still be visible later in the drag')
          const sel = await page.evaluate(() => window.__store.getState().editNoteIds)
          const selSorted = [...sel].sort()
          const expectedSorted = [...expected].sort()
          assert(
            JSON.stringify(selSorted) === JSON.stringify(expectedSorted),
            `T5: marquee should select exactly ${JSON.stringify(expectedSorted)}, got ${JSON.stringify(selSorted)}`,
          )
          const hitCountUnchanged = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').hits.length)
          assert(hitCountUnchanged === drums0.hits.length, 'T5: marquee-select must not mutate any hits')
          results.t5 = { selected: selSorted }
          console.log(`[T5] PASS: marquee-select drew a visible box and selected exactly the hits inside it — ${JSON.stringify(results.t5)}`)
        })
      } finally {
        await daemon.close()
      }
    }

    // ============ T6: materialized lanes — group move + group delete ============
    {
      const { beatPath } = freshProject('t6')
      const daemon = await startDaemon({ filePath: beatPath, port: PORT + 4 })
      try {
        await withPage(async (page) => {
          await openDrums(page, daemon.port)
          const enableBtn = page.locator('button:has-text("Enable lane editing")')
          assert((await enableBtn.count()) > 0, 'T6 fixture precondition: expected an "Enable lane editing" button on the implicit-kit drums track')
          await enableBtn.first().click()
          await sleep(300)

          const doc0 = await daemonDoc(PORT + 4)
          const drums0 = doc0.tracks.find((t) => t.id === 'drums')
          assert(drums0.lanes.length === 5, `T6: expected lanes materialized to 5 explicit entries, got ${drums0.lanes.length}`)

          // the "Lanes (N)" panel pushes the grid down, often below the fold -- scroll it into view.
          await page.locator('.noteview-grid').scrollIntoViewIfNeeded()
          await sleep(100)
          const totalSteps = doc0.loopBars * 16
          const gridBox = await page.locator('.noteview-grid').boundingBox()
          const stepW = gridBox.width / totalSteps
          const laneOrder = drums0.lanes.map((l) => l.name)

          const targets = drums0.hits.filter((h) => h.start < 8).slice(0, 2)
          assert(targets.length === 2, `T6 fixture precondition: expected >=2 hits in steps 0-7, found ${targets.length}`)
          for (const [i, t] of targets.entries()) {
            const rowIdx = laneOrder.indexOf(t.lane)
            const tx = gridBox.x + (t.start + 0.15) * stepW
            const ty = gridBox.y + rowIdx * 12 + 6
            if (i === 0) await page.mouse.click(tx, ty)
            else {
              await page.keyboard.down('Shift')
              await page.mouse.click(tx, ty)
              await page.keyboard.up('Shift')
            }
            await sleep(80)
          }
          const sel = await page.evaluate(() => window.__store.getState().editNoteIds)
          assert(sel.length === 2, `T6: expected 2 hits selected, got ${JSON.stringify(sel)}`)

          const t0 = targets[0]
          const rowIdx0 = laneOrder.indexOf(t0.lane)
          const gx = gridBox.x + t0.start * stepW + 1
          const gy = gridBox.y + rowIdx0 * 12 + 6
          await page.mouse.move(gx, gy)
          await page.mouse.down()
          await page.mouse.move(gx + 2 * stepW, gy + 6, { steps: 5 }) // +6, not +12 — see T2's identical comment on the row-delta rounding boundary
          await sleep(30)
          await page.mouse.up()
          await sleep(250)

          let d = await daemonDoc(PORT + 4)
          for (const t of targets) {
            const found = d.tracks.find((tr) => tr.id === 'drums').hits.find((h) => h.id === t.id)
            assert(found, `T6: ${t.id} should still exist after group move`)
            assert(found.start === t.start + 2, `T6: ${t.id} should have moved +2 steps on the daemon, got start=${found.start}`)
          }

          await page.click('.note-del-btn')
          await sleep(300)
          const daemonAfter = await pollUntil(
            async () => {
              const dd = await daemonDoc(PORT + 4)
              const hits = dd.tracks.find((t) => t.id === 'drums').hits
              const stillThere = targets.some((t) => hits.some((h) => h.id === t.id))
              return stillThere ? null : dd
            },
            'daemon document to lose both group-deleted hits (materialized lanes)',
          )
          const finalCount = daemonAfter.tracks.find((t) => t.id === 'drums').hits.length
          assert(finalCount === drums0.hits.length - 2, 'T6: daemon hit count should have dropped by exactly 2')

          await page.reload({ waitUntil: 'load' })
          await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
          await sleep(250)
          const countAfterReload = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').hits.length)
          assert(countAfterReload === finalCount, `T6: hit count should survive reload at ${finalCount}, got ${countAfterReload}`)
          results.t6 = { finalDaemonCount: finalCount, afterReload: countAfterReload }
          console.log(`[T6] PASS: group move + group delete persisted with lanes materialized, survived reload — ${JSON.stringify(results.t6)}`)
        })
      } finally {
        await daemon.close()
      }
    }

    console.log('\n================ ALL CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error('\nVERIFY FAILED:', err)
  process.exit(1)
})
