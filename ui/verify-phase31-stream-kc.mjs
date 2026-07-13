#!/usr/bin/env node
// Phase 31 Stream KC verification — NoteView.tsx: 3 note-editor interaction fixes found by usability
// pilots 90 (D&B song) and 91 (trance lead), docs/phase-31-plan.md's KC section.
//
// Driven live against a REAL `beat daemon` + the built frontend in headless Chrome, on disposable
// COPIES of examples/night-shift.beat mutated in memory (never written to disk unmodified) or fresh
// `beat init` projects in `/tmp/dotbeat-*` scratch dirs — examples/night-shift-song.beat, the owner's
// own live project, is never touched or even read, matching every other Phase 27-30 verify script.
//
//   T1  ITEM 1 (newly-added note isn't the active selection) — clicking empty grid to add a note
//       while a DIFFERENT note is already selected must select the NEW note (not leave the old one
//       selected, and not just clear the selection), so the very next keyboard shortcut (e.g.
//       Shift+ArrowRight resize) operates on what the user just created, not a stale prior selection.
//       Pilot 90's exact repro: click empty grid -> Shift+ArrowRight twice -> a different,
//       already-placed note silently got resized (32 steps -> 62 -> 64) instead of the new one.
//   T2  ITEM 2 (sticky tab-header dead zone over the grid) — once the clip editor is scrolled far
//       enough that `.noteview-titlebar` (position: sticky) re-docks over the top of the scrollable
//       note grid, a click on a grid row in that band must still add a note/hit — not be silently
//       swallowed by the sticky bar sitting in front of it in z-order. Pilot 91 confirmed via direct
//       `document.elementFromPoint` inspection that `.noteview-grid`'s own bounding rect claims that
//       space while `elementFromPoint` actually resolves to the sticky bar.
//   T3  ITEM 3 (mid-session off-by-one-row drift) — REPRODUCED (not a negative result): placing a
//       clip into the arrangement (entering song mode) makes `.noteview-cliploop-strip` (14px height +
//       2px margin, styles.css) render above `.noteview-grid` inside `.noteview-lanes`, but
//       `.noteview-keys` (the row-label/piano-key strip, a separate sibling column) has no matching
//       offset — so from that point on, clicking a key-strip row at its own measured position lands
//       the note/hit one row away from what the label showed. Verifies row-click accuracy stays exact
//       across a realistic multi-stage session: loop-length changes, repeated scrolling, track
//       switching, zoom in/out, a full page reload, entering song mode, and repeated section
//       switching (which reloads the live buffer via postLoadClip) — the drift only appears once a
//       clip has actually been placed, which is exactly what this test exercises.
//
// Usage: node ui/verify-phase31-stream-kc.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5943 // distinct from every other verify-phase*.mjs script's own port

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function assert(cond, msg) {
  if (!cond) throw new Error(msg)
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

async function buildDoc() {
  const { parse } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const src = readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')
  const doc = parse(src)
  const lead = doc.tracks.find((t) => t.id === 'lead')
  assert(lead, '[fixture] examples/night-shift.beat has no "lead" track — pick a different base fixture')
  const drums = doc.tracks.find((t) => t.id === 'drums')
  assert(drums, '[fixture] examples/night-shift.beat has no "drums" track — pick a different base fixture')
  lead.notes = []
  return doc
}

async function startProject(doc, tag) {
  const { serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const proj = mkdtempSync(join(tmpdir(), `dotbeat-p31kc-${tag}-`))
  const beatPath = join(proj, 'project.beat')
  writeFileSync(beatPath, serialize(doc))
  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  return { daemon, proj, beatPath }
}

async function selectTrack(page, daemon, name) {
  await page.click(`.arr-track-select:has(.arr-track-name:text-is("${name}"))`)
  await page.waitForSelector('.noteview-grid', { timeout: 5000 })
  await pollUntil(() => daemon.getDoc().selectedTrack === name, `${name} selection to record`)
  await sleep(150)
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

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
    20000,
  )
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const results = {}

  try {
    // ================================================================================================
    // T1 — ITEM 1: a newly-added note becomes the active selection immediately.
    // ================================================================================================
    console.log('\n[T1] newly-added note becomes the active selection for the next shortcut...')
    {
      const { daemon, beatPath } = await startProject(await buildDoc(), 't1')
      console.log(`daemon up on :${daemon.port}, disposable project ${beatPath}`)
      const track = () => daemon.getDoc().tracks.find((t) => t.id === 'lead')

      const page = await browser.newPage()
      const errors = []
      page.on('pageerror', (e) => {
        errors.push(String(e))
        console.log(`[pageerror] ${e}`)
      })
      await page.setViewportSize({ width: 1400, height: 700 })
      await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
      await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 12000 })
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
      const storeState = () => page.evaluate(() => window.__store.getState())

      await selectTrack(page, daemon, 'lead')

      // Place a first note (the "previously-selected, unrelated note" pilot 90's repro corrupted).
      await page.locator('[data-row="10"]').scrollIntoViewIfNeeded()
      await sleep(100)
      let gridBox = await page.locator('.noteview-grid').boundingBox()
      let row10Box = await page.locator('[data-row="10"]').boundingBox()
      const stepW = await page.$eval('.noteview-scroll', (el) => parseFloat(getComputedStyle(el).getPropertyValue('--note-step-w')))
      await page.mouse.click(gridBox.x + 3 * stepW + 2, row10Box.y + row10Box.height / 2)
      await pollUntil(() => track().notes.length === 1, 'the first note to land')
      const oldNote = track().notes[0]
      const oldDuration = oldNote.duration
      console.log(`  old note ${oldNote.id} at step ${oldNote.start}, duration ${oldDuration}`)

      // Explicitly select the OLD note (simulating "it was the last thing selected").
      await page.click(`[data-note-id="${oldNote.id}"]`)
      await pollUntil(async () => (await storeState()).editNoteIds.length === 1, 'the old note to become selected')
      let sel = (await storeState()).editNoteIds
      assert(sel.length === 1 && sel[0] === oldNote.id, `[T1] setup failed: expected just the old note selected, got ${JSON.stringify(sel)}`)

      // Click empty grid space (a different step/row) to add a NEW note — pilot 90's exact action.
      await page.locator('[data-row="25"]').scrollIntoViewIfNeeded()
      await sleep(100)
      gridBox = await page.locator('.noteview-grid').boundingBox()
      const row25Box = await page.locator('[data-row="25"]').boundingBox()
      await page.mouse.click(gridBox.x + 10 * stepW + 2, row25Box.y + row25Box.height / 2)
      await pollUntil(() => track().notes.length === 2, 'the new note to be added')
      const newNote = track().notes.find((n) => n.id !== oldNote.id)
      assert(newNote, '[T1] could not find the newly-added note by id-diff')
      console.log(`  new note ${newNote.id} at step ${newNote.start}`)

      // The store's editNoteIds must be authoritative: JUST the new note, not the old one, not empty.
      const selAfterAdd = (await storeState()).editNoteIds
      console.log(`  editNoteIds after add: ${JSON.stringify(selAfterAdd)}`)
      assert(
        selAfterAdd.length === 1 && selAfterAdd[0] === newNote.id,
        `[T1] expected only the NEW note (${newNote.id}) selected immediately after add, got ${JSON.stringify(selAfterAdd)}`,
      )

      // Immediately (no re-click, matching pilot 90's exact sequence) press Shift+ArrowRight twice —
      // must resize the NEW note, and must NOT touch the old note's duration at all.
      await page.keyboard.press('Shift+ArrowRight')
      await page.keyboard.press('Shift+ArrowRight')
      await pollUntil(() => {
        const n = track().notes.find((nn) => nn.id === newNote.id)
        return n && n.duration === newNote.duration + 2
      }, 'the new note to gain +2 duration from two Shift+ArrowRight presses')
      const oldAfter = track().notes.find((n) => n.id === oldNote.id)
      const newAfter = track().notes.find((n) => n.id === newNote.id)
      console.log(`  after 2x Shift+ArrowRight: old note duration=${oldAfter.duration} (was ${oldDuration}), new note duration=${newAfter.duration} (was ${newNote.duration})`)
      assert(oldAfter.duration === oldDuration, `[T1] the OLD note's duration changed (${oldDuration} -> ${oldAfter.duration}) — the resize hit the wrong note, exactly pilot 90's corruption bug`)
      assert(newAfter.duration === newNote.duration + 2, `[T1] the NEW note's duration should have grown by 2 steps, got ${newNote.duration} -> ${newAfter.duration}`)
      console.log('[T1] PASS: the newly-added note was immediately authoritative for the next keyboard shortcut, and the old note was untouched')
      results.t1 = { oldNoteId: oldNote.id, newNoteId: newNote.id, oldDuration, newDurationBefore: newNote.duration, newDurationAfter: newAfter.duration }

      if (errors.length) throw new Error(`[T1] page errors:\n${errors.join('\n')}`)
      await page.close()
      await daemon.close()
    }

    // ================================================================================================
    // T2 — ITEM 2: a click in the sticky tab-header's dead zone over the grid still adds a note.
    // ================================================================================================
    console.log('\n[T2] sticky title-bar no longer eats clicks meant for the grid...')
    {
      const { daemon, beatPath } = await startProject(await buildDoc(), 't2')
      console.log(`daemon up on :${daemon.port}, disposable project ${beatPath}`)
      const track = () => daemon.getDoc().tracks.find((t) => t.id === 'lead')

      const page = await browser.newPage()
      const errors = []
      page.on('pageerror', (e) => {
        errors.push(String(e))
        console.log(`[pageerror] ${e}`)
      })
      await page.setViewportSize({ width: 1400, height: 700 })
      await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
      await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 12000 })
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

      await selectTrack(page, daemon, 'lead')

      // pointer-events must be disabled on the titlebar itself — the direct, scroll-position-
      // independent assertion (matches how the fix actually works, not just one lucky scroll offset).
      const titlebarPointerEvents = await page.$eval('.noteview-titlebar', (el) => getComputedStyle(el).pointerEvents)
      console.log(`  .noteview-titlebar pointer-events: ${titlebarPointerEvents}`)
      assert(titlebarPointerEvents === 'none', `[T2] expected .noteview-titlebar to have pointer-events: none, got "${titlebarPointerEvents}"`)

      // Scroll to a position where the titlebar (sticky) re-docks directly over the grid's own top
      // rows (per its own bounding rect) — the exact dead zone pilot 91 found via elementFromPoint.
      await page.evaluate(() => {
        document.querySelector('.bottom-pane-body').scrollTop = 150
      })
      await sleep(200)
      const gridBox = await page.locator('.noteview-grid').boundingBox()
      const clickX = gridBox.x + 40
      const clickY = gridBox.y + 6 // row 0 per the grid's OWN bounding rect
      const elAtPoint = await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y)
          return { tag: el?.tagName, cls: el?.className?.toString?.() }
        },
        { x: clickX, y: clickY },
      )
      console.log(`  element at grid-row-0-per-bbox point: ${elAtPoint.tag}.${elAtPoint.cls}`)
      // With pointer-events:none, this point must resolve through to the grid (or a note on it), not
      // the titlebar sitting visually on top of it.
      assert(!String(elAtPoint.cls).includes('noteview-titlebar'), `[T2] the point still resolves to .noteview-titlebar — the dead zone is still there`)

      const before = track().notes.length
      await page.mouse.click(clickX, clickY)
      await pollUntil(() => track().notes.length === before + 1, 'the click in the formerly-dead zone to add a note')
      console.log(`[T2] PASS: a click at the grid's own row-0 position, while scrolled under the sticky title bar, added a note (${before} -> ${track().notes.length})`)
      results.t2 = { titlebarPointerEvents, notesBefore: before, notesAfter: track().notes.length }

      if (errors.length) throw new Error(`[T2] page errors:\n${errors.join('\n')}`)
      await page.close()
      await daemon.close()
    }

    // ================================================================================================
    // T3 — ITEM 3: row-click-to-pitch/lane mapping stays exact across a realistic multi-stage
    // session, INCLUDING after a clip is placed into the arrangement and sections are switched —
    // the specific transition that desynced `.noteview-keys` from `.noteview-grid` before this fix.
    // ================================================================================================
    console.log('\n[T3] row-click accuracy holds across loop/scroll/zoom/reload/song-mode-switching...')
    {
      const doc = await buildDoc()
      const { daemon, beatPath } = await startProject(doc, 't3')
      console.log(`daemon up on :${daemon.port}, disposable project ${beatPath}`)
      const track = (id) => daemon.getDoc().tracks.find((t) => t.id === id)

      const page = await browser.newPage()
      const errors = []
      page.on('pageerror', (e) => {
        errors.push(String(e))
        console.log(`[pageerror] ${e}`)
      })
      page.on('dialog', (d) => d.accept()) // postLoadClip's "unsaved content will be replaced" confirm()
      await page.setViewportSize({ width: 1400, height: 700 })
      await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
      await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 12000 })
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

      // Click a track's key-row at its OWN currently-measured position (data-row-value) and confirm
      // the resulting note/hit lands on exactly that value — the real-world shape of the bug (a user
      // clicking exactly where the label says, and getting a different row).
      async function clickRowAndCheck(trackId, rowIndex, label) {
        const isDrumTrack = trackId === 'drums'
        const before = new Set((isDrumTrack ? track(trackId).hits : track(trackId).notes).map((x) => x.id))
        const keyRow = page.locator(`[data-row="${rowIndex}"]`)
        await keyRow.scrollIntoViewIfNeeded()
        await sleep(80)
        const keyBox = await keyRow.boundingBox()
        assert(keyBox, `[T3/${label}] row ${rowIndex} key strip not visible`)
        const expectedValue = await keyRow.getAttribute('data-row-value')
        const gridBox = await page.locator('.noteview-grid').boundingBox()
        const clickX = gridBox.x + 5 * 14
        const clickY = keyBox.y + keyBox.height / 2
        await page.mouse.click(clickX, clickY)
        await sleep(150)
        const t = track(trackId)
        const items = isDrumTrack ? t.hits : t.notes
        const added = items.find((x) => !before.has(x.id))
        assert(added, `[T3/${label}] no new event was added by the click at row ${rowIndex}`)
        const actualValue = String(isDrumTrack ? added.lane : added.pitch)
        console.log(`  [${label}] row=${rowIndex} expected=${expectedValue} actual=${actualValue} ${actualValue === String(expectedValue) ? 'OK' : 'MISMATCH'}`)
        assert(actualValue === String(expectedValue), `[T3/${label}] row ${rowIndex}: clicked at the position labeled "${expectedValue}" but the note/hit landed on "${actualValue}" — the key-strip/grid drift is back`)
        return { label, rowIndex, expectedValue, actualValue }
      }

      const checks = []

      // Stage 0: baseline, loop mode, no clip placed yet.
      await selectTrack(page, daemon, 'lead')
      checks.push(await clickRowAndCheck('lead', 5, 'stage0-baseline'))

      // Stage 1: extend loop length.
      for (let i = 0; i < 3; i++) {
        await page.click('[data-loop-plus="1"]')
        await sleep(60)
      }

      // Stage 2: scroll the panel up/down repeatedly.
      for (let i = 0; i < 4; i++) {
        await page.evaluate((y) => {
          document.querySelector('.bottom-pane-body').scrollTop = y
        }, i % 2 === 0 ? 300 : 0)
        await sleep(60)
      }
      checks.push(await clickRowAndCheck('lead', 10, 'stage2-post-scroll'))

      // Stage 3: switch to drums, click a lane, back to lead.
      await selectTrack(page, daemon, 'drums')
      checks.push(await clickRowAndCheck('drums', 2, 'stage3-drums'))
      await selectTrack(page, daemon, 'lead')
      checks.push(await clickRowAndCheck('lead', 8, 'stage3-back-to-lead'))

      // Stage 4: zoom in/out, reset.
      await page.click('[data-action="note-zoom-in"]')
      await page.click('[data-action="note-zoom-in"]')
      await sleep(80)
      checks.push(await clickRowAndCheck('lead', 12, 'stage4-post-zoom'))
      const zoomResetBtn = await page.$('[data-action="note-zoom-reset"]')
      if (zoomResetBtn) await zoomResetBtn.click()

      // Stage 5: full page reload.
      await page.reload({ waitUntil: 'load' })
      await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 12000 })
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
      await selectTrack(page, daemon, 'lead')
      checks.push(await clickRowAndCheck('lead', 7, 'stage5-post-reload'))

      // Stage 6: THE key transition — enter song mode (places this track's clip into a scene, so
      // `primaryClip` becomes truthy and `.noteview-cliploop-strip` starts rendering), then switch
      // sections repeatedly (each switch reloads the live buffer via postLoadClip). This is exactly
      // the state pilot 90 was in when the drift appeared, and exactly what reproduced it before the
      // fix (5/5 mismatches, all off by +1 row, in this stream's own investigation).
      await page.click('[data-add-section="1"]')
      await sleep(200)
      await selectTrack(page, daemon, 'lead')
      checks.push(await clickRowAndCheck('lead', 6, 'stage6-songmode-first-section'))
      await page.click('[data-place-clip="lead"]').catch(() => {})
      await sleep(200)
      await page.click('[data-capture-insert-scene="1"]')
      await sleep(300)
      const sectionCount = await page.locator('[data-section-chip]').count()
      assert(sectionCount >= 2, `[T3] setup failed: expected >=2 sections after capture-insert-scene, got ${sectionCount}`)
      const lastIdx = sectionCount - 1
      for (let i = 0; i < 4; i++) {
        const target = i % 2 === 0 ? lastIdx : 0
        await page.click(`[data-section-chip="${target}"]`)
        await sleep(200)
        await page.evaluate((y) => {
          const el = document.querySelector('.bottom-pane-body')
          if (el) el.scrollTop = y
        }, i % 2 === 0 ? 200 : 50)
        await sleep(100)
        checks.push(await clickRowAndCheck('lead', 9 + i, `stage6-switch${i}-section${target}`))
      }

      console.log(`[T3] PASS: all ${checks.length} row-click checks landed on the row the key strip actually showed, across loop/scroll/zoom/reload/song-mode-entry/section-switching`)
      results.t3 = { checks }

      if (errors.length) throw new Error(`[T3] page errors:\n${errors.join('\n')}`)
      await page.close()
      await daemon.close()
    }

    console.log('\n================ ALL PHASE 31 STREAM KC CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error('\nPHASE 31 STREAM KC VERIFY FAILED:', err)
  process.exit(1)
})
