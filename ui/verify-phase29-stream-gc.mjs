#!/usr/bin/env node
// Phase 29 Stream GC verification — NoteView.tsx: 6 real bugs fixed, found by exploratory usability
// pilots (docs/phase-29-plan.md Stream GC; docs/research/80, 81, 83, 84).
//
// Driven live against a REAL `beat daemon` + the built frontend in headless Chrome, on a disposable
// COPY of examples/night-shift.beat mutated in memory (never written to disk unmodified — the copy
// lives in a fresh tmp dir). examples/night-shift-song.beat, the owner's own live project, is never
// touched or even read, matching every other Phase 27/28/29 verify script's discipline.
//
//   T1  BUG 1 (click-to-add off-by-one) — clicking the RIGHT HALF of a visually empty step cell
//       (the exact repro shape research 80 measured: "the right half of what looks like step N")
//       lands the new note/hit on the CLICKED cell, not the next one over. Checked for both the
//       melodic note grid and the drum-lane grid.
//   T2  BUG 2 (view auto-recenter on edit) — the pitch axis's row-0 (topmost) pitch value, read
//       straight off the DOM, is IDENTICAL before and after adding a track's very first note (the
//       exact "zero notes -> one note" transition research 83 pinned as the moment the window used
//       to jump octaves).
//   T3  BUG 3 (click-eaten-by-deselect) — clicking empty grid space while a note is selected both
//       clears the selection AND adds a new note at the clicked cell (not just a deselect).
//   T4  BUG 4 (selection doesn't narrow on click) — after a marquee selects 2 notes, a plain click
//       (no drag) directly on one of them narrows the selection down to just that one note.
//   T5  BUG 5 (drag-resize scroll drift) — dragging a note's right-edge resize handle, with the
//       clip editor's scroll container pre-scrolled to a mid position, leaves that scroll position
//       completely unchanged (previously `gridEl.focus()` could silently scroll it).
//   T6  BUG 6 (sticky titlebar covers content) — `.bottom-pane-body` carries a `scroll-padding-top`,
//       and both `.lane-row` (DrumLanePanel) and `.noteview-key-row` (the piano-roll/lane key strip)
//       carry a matching `scroll-margin-top`, all equal to `--sticky-titlebar-h` — the shared fix
//       that generalizes across both panels research 80 found the collision in.
//
// Usage: node ui/verify-phase29-stream-gc.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5929 // distinct from every other verify-phase2*.mjs script's own port

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

// ---- build the fixture doc: examples/night-shift.beat mutated in memory --------------------------
// `lead`'s own notes are cleared (not deleted from the file — this never touches disk) so this
// stream's tests get full, deterministic control of the grid's starting content: T2 specifically
// needs a track with ZERO notes to reproduce the "first note lands, window jumps" repro shape.
// `drums` keeps its existing (legacy pattern-migrated) hits/lanes untouched, used only for T1's
// drum-grid half of the click-to-add check. A fresh `leadB` track (cloned from `lead`, notes
// cleared, own id/name/color) is added so T2 can run its own "zero notes" check independent of
// whatever T1/T3/T4 have already added to `lead` by the time T2 runs.
async function buildDoc() {
  const { parse } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const src = readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')
  const doc = parse(src)
  const lead = doc.tracks.find((t) => t.id === 'lead')
  assert(lead, '[fixture] examples/night-shift.beat has no "lead" track — pick a different base fixture')
  const drums = doc.tracks.find((t) => t.id === 'drums')
  assert(drums, '[fixture] examples/night-shift.beat has no "drums" track — pick a different base fixture')
  lead.notes = []
  const leadB = { ...lead, id: 'leadB', name: 'leadB', color: '#61afef', notes: [], clips: [] }
  doc.tracks.push(leadB)
  return doc
}

async function startProject(doc) {
  const { serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p29gc-'))
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
  const errors = []
  const results = {}

  try {
    const { daemon, proj, beatPath } = await startProject(await buildDoc())
    console.log(`daemon up on :${daemon.port}, disposable project ${beatPath} (never examples/night-shift-song.beat)`)
    const track = (id) => daemon.getDoc().tracks.find((t) => t.id === id)

    const page = await browser.newPage()
    page.on('pageerror', (e) => {
      errors.push(String(e))
      console.log(`[pageerror] ${e}`)
    })
    await page.setViewportSize({ width: 1400, height: 700 })
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 12000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    const storeState = () => page.evaluate(() => window.__store.getState())

    // ================================================================================================
    // T1 — BUG 1: click-to-add off-by-one. Click the RIGHT HALF of a visually empty step cell —
    // must land on the clicked cell, not the next one over.
    // ================================================================================================
    console.log('\n[T1] click-to-add off-by-one (melodic grid + drum grid)...')
    await selectTrack(page, daemon, 'lead')
    await page.locator('.noteview-grid').scrollIntoViewIfNeeded()
    await sleep(100)
    const gridBox1 = await page.locator('.noteview-grid').boundingBox()
    const stepW1 = await page.$eval('.noteview-scroll', (el) => parseFloat(getComputedStyle(el).getPropertyValue('--note-step-w')))
    console.log(`  lead grid: stepW=${stepW1}px`)
    const TARGET_STEP = 5
    const TARGET_ROW = 15
    // 90% across the visual cell — squarely in the "right half" the old Math.round-to-nearest-
    // gridline bug misattributed to step+1.
    const clickX1 = gridBox1.x + (TARGET_STEP + 0.9) * stepW1
    const clickY1 = gridBox1.y + TARGET_ROW * 12 + 6 // ROW_H=12, click mid-row
    await page.mouse.click(clickX1, clickY1)
    await pollUntil(() => track('lead').notes.length === 1, 'lead to gain exactly one note from the click')
    const leadNote1 = track('lead').notes[0]
    console.log(`  clicked 90% across step ${TARGET_STEP}'s cell -> note landed at start=${leadNote1.start} (pitch ${leadNote1.pitch})`)
    assert(leadNote1.start === TARGET_STEP, `[T1] expected the note to land on step ${TARGET_STEP} (the clicked cell), got step ${leadNote1.start} — the off-by-one bug is back`)
    results.t1a = { start: leadNote1.start, id: leadNote1.id }

    await selectTrack(page, daemon, 'drums')
    await page.locator('.noteview-grid').scrollIntoViewIfNeeded()
    await sleep(100)
    const gridBox1d = await page.locator('.noteview-grid').boundingBox()
    const stepW1d = await page.$eval('.noteview-scroll', (el) => parseFloat(getComputedStyle(el).getPropertyValue('--note-step-w')))
    const DRUM_STEP = 3
    const DRUM_ROW = 1 // "snare" — the fixture's pattern-migrated snare lane is all-zero (empty)
    const clickX1d = gridBox1d.x + (DRUM_STEP + 0.88) * stepW1d
    const clickY1d = gridBox1d.y + DRUM_ROW * 12 + 6
    const idsBefore = new Set(track('drums').hits.map((h) => h.id))
    const hitsBefore = idsBefore.size
    await page.mouse.click(clickX1d, clickY1d)
    await pollUntil(() => track('drums').hits.length === hitsBefore + 1, 'drums to gain exactly one hit from the click')
    // Diff by id, not array position — the pattern-migrated fixture already has hits tiled across
    // every bar (e.g. openhat at step 62), so "last element" is not reliably the new one.
    const addedHit = track('drums').hits.find((h) => !idsBefore.has(h.id))
    assert(addedHit, '[T1] could not find the newly-added drum hit by id-diff')
    console.log(`  drum grid: clicked 88% across step ${DRUM_STEP}'s cell -> hit landed at start=${addedHit.start} (lane ${addedHit.lane})`)
    assert(addedHit.start === DRUM_STEP, `[T1] expected the drum hit to land on step ${DRUM_STEP} (the clicked cell), got step ${addedHit.start}`)
    console.log('[T1] PASS: clicking the right half of an empty cell lands on that cell, not the next one, in both the note and drum-lane grids')
    results.t1b = { start: addedHit.start, lane: addedHit.lane }

    // ================================================================================================
    // T2 — BUG 2: the pitch window must not shift on the track's very first note-add (the exact
    // "zero notes -> one note" repro research 83 measured as a full-octave jump).
    // ================================================================================================
    console.log('\n[T2] view stability across a track\'s first note-add...')
    await selectTrack(page, daemon, 'leadB')
    assert(track('leadB').notes.length === 0, '[fixture] leadB should start with zero notes')
    const row0ValueBefore = await page.$eval('[data-row="0"]', (el) => el.getAttribute('data-row-value'))
    console.log(`  row 0 pitch BEFORE any edit: ${row0ValueBefore}`)
    // Row 40 (well away from the window's own center) -> a pitch far from whatever default the OLD
    // per-render recompute would have re-centered around, so any window shift would show up clearly.
    // Scroll THAT specific row into view (row 40 of 48 is likely below the grid's own top-anchored
    // scrollIntoView) rather than the grid element itself, whose top may leave row 40 off-screen.
    await page.locator('[data-row="40"]').scrollIntoViewIfNeeded()
    await sleep(100)
    const gridBox2 = await page.locator('.noteview-grid').boundingBox()
    const row40Box = await page.locator('[data-row="40"]').boundingBox()
    assert(row40Box, '[T2] setup failed: row 40 is not attached/visible after scrollIntoViewIfNeeded')
    const stepW2 = await page.$eval('.noteview-scroll', (el) => parseFloat(getComputedStyle(el).getPropertyValue('--note-step-w')))
    const clickX2 = gridBox2.x + 8.5 * stepW2
    const clickY2 = row40Box.y + row40Box.height / 2
    await page.mouse.click(clickX2, clickY2)
    await pollUntil(() => track('leadB').notes.length === 1, 'leadB to gain its first note')
    await sleep(150)
    const row0ValueAfter = await page.$eval('[data-row="0"]', (el) => el.getAttribute('data-row-value'))
    console.log(`  row 0 pitch AFTER the first note landed (pitch ${track('leadB').notes[0].pitch}): ${row0ValueAfter}`)
    assert(row0ValueAfter === row0ValueBefore, `[T2] the pitch window's row 0 shifted from ${row0ValueBefore} to ${row0ValueAfter} after the track's first note-add — the view-jump bug is back`)
    console.log('[T2] PASS: the visible pitch window stayed put across the track\'s first edit')
    results.t2 = { row0ValueBefore, row0ValueAfter }

    // ================================================================================================
    // T3 — BUG 3: clicking empty grid space while a note is selected both deselects the OLD note AND
    // adds a new one. Phase 31 Stream KC item 1 (docs/research/90) changed what the selection should
    // be AFTER that add: the click used to leave editNoteIds empty (the new note only ever LOOKED
    // selected, never was); now the newly-added note itself becomes the sole selection, so it's
    // actually authoritative for the very next keyboard shortcut (e.g. Shift+ArrowRight resize) —
    // pilot 90's exact repro was that very shortcut silently resizing a stale, different note instead.
    // ================================================================================================
    console.log('\n[T3] click on empty grid while a note is selected...')
    await selectTrack(page, daemon, 'lead')
    // Select the T1 note.
    await page.click(`[data-note-id="${leadNote1.id}"]`)
    await pollUntil(async () => (await storeState()).editNoteIds.length === 1, 'clicking the T1 note to select it')
    let sel = (await storeState()).editNoteIds
    assert(sel.length === 1 && sel[0] === leadNote1.id, `[T3] setup failed: expected just the T1 note selected, got ${JSON.stringify(sel)}`)
    const notesBeforeT3 = track('lead').notes.length
    // Click clearly empty grid space — a different step/row from every existing note. Scroll the
    // SPECIFIC target row into view (row 30 of 48 can otherwise sit below the fold once the
    // NoteInspector panel below the grid pushes everything else down) rather than just the grid.
    await page.locator('[data-row="30"]').scrollIntoViewIfNeeded()
    await sleep(100)
    const gridBox3 = await page.locator('.noteview-grid').boundingBox()
    const row30Box3 = await page.locator('[data-row="30"]').boundingBox()
    assert(row30Box3, '[T3] setup failed: row 30 is not attached/visible after scrollIntoViewIfNeeded')
    const stepW3 = await page.$eval('.noteview-scroll', (el) => parseFloat(getComputedStyle(el).getPropertyValue('--note-step-w')))
    const clickX3 = gridBox3.x + 20.3 * stepW3
    const clickY3 = row30Box3.y + row30Box3.height / 2
    await page.mouse.click(clickX3, clickY3)
    await pollUntil(() => track('lead').notes.length === notesBeforeT3 + 1, 'the empty-grid click to add a new note, not just deselect')
    await sleep(100)
    const selAfterT3 = (await storeState()).editNoteIds
    const leadNote3 = track('lead').notes.find((n) => n.id !== leadNote1.id)
    console.log(`  notes: ${notesBeforeT3} -> ${track('lead').notes.length}; selection after click: ${JSON.stringify(selAfterT3)}`)
    assert(track('lead').notes.length === notesBeforeT3 + 1, `[T3] expected a new note to be added, count stayed at ${track('lead').notes.length}`)
    assert(leadNote3, '[T3] could not find the newly-added note by id-diff against leadNote1')
    assert(
      selAfterT3.length === 1 && selAfterT3[0] === leadNote3.id,
      `[T3] expected the click to clear the OLD selection and select just the NEW note (id ${leadNote3.id}), got ${JSON.stringify(selAfterT3)}`,
    )
    console.log('[T3] PASS: clicking empty grid while a note was selected cleared the old selection and made the new note the sole, active one')
    results.t3 = { notesBefore: notesBeforeT3, notesAfter: track('lead').notes.length, selAfter: selAfterT3 }

    // ================================================================================================
    // T4 — BUG 4: after a marquee selects multiple notes, a plain click on one of them narrows the
    // selection to just that one note.
    // ================================================================================================
    console.log('\n[T4] selection narrows on a plain click after a marquee...')
    // Center the viewport between the two notes' rows (15 and 30) so both are simultaneously
    // visible — T3 left the panel scrolled to show row 30 alone, which can leave row 15 (and thus
    // leadNote1) scrolled above the fold.
    await page.locator('[data-row="22"]').evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await sleep(150)
    const box1 = await page.locator(`[data-note-id="${leadNote1.id}"]`).boundingBox()
    const box3 = await page.locator(`[data-note-id="${leadNote3.id}"]`).boundingBox()
    assert(box1 && box3, '[T4] setup failed: both T1 and T3 notes must be visible in the grid')
    assert(box1.y >= 0 && box3.y >= 0, `[T4] setup failed: a note is scrolled above the viewport (box1.y=${box1.y}, box3.y=${box3.y})`)
    // Marquee-drag a rectangle enclosing both notes (start well above/left of both, end well below/right).
    const left = Math.min(box1.x, box3.x) - 10
    const top = Math.min(box1.y, box3.y) - 10
    const right = Math.max(box1.x + box1.width, box3.x + box3.width) + 10
    const bottom = Math.max(box1.y + box1.height, box3.y + box3.height) + 10
    await page.mouse.move(left, top)
    await page.mouse.down()
    await page.mouse.move((left + right) / 2, (top + bottom) / 2, { steps: 4 })
    await page.mouse.move(right, bottom, { steps: 4 })
    await page.mouse.up()
    await pollUntil(async () => (await storeState()).editNoteIds.length === 2, 'the marquee to select both notes')
    const selMarquee = (await storeState()).editNoteIds
    console.log(`  after marquee: ${JSON.stringify(selMarquee)}`)
    assert(new Set(selMarquee).size === 2 && selMarquee.includes(leadNote1.id) && selMarquee.includes(leadNote3.id), `[T4] setup failed: expected both notes selected, got ${JSON.stringify(selMarquee)}`)
    // Plain click (no drag) directly on ONE of the two already-selected notes.
    const box1Now = await page.locator(`[data-note-id="${leadNote1.id}"]`).boundingBox()
    await page.mouse.click(box1Now.x + box1Now.width / 2, box1Now.y + box1Now.height / 2)
    await pollUntil(async () => (await storeState()).editNoteIds.length === 1, 'the plain click to narrow the selection down to one note')
    const selNarrowed = (await storeState()).editNoteIds
    console.log(`  after plain click on the T1 note: ${JSON.stringify(selNarrowed)}`)
    assert(selNarrowed.length === 1 && selNarrowed[0] === leadNote1.id, `[T4] expected selection narrowed to just [${leadNote1.id}], got ${JSON.stringify(selNarrowed)}`)
    console.log('[T4] PASS: a plain click on an already-multi-selected note narrows the selection to just that note')
    results.t4 = { selMarquee, selNarrowed }

    // ================================================================================================
    // T5 — BUG 5: dragging a note's resize handle must not move the clip editor's scroll position.
    // ================================================================================================
    console.log('\n[T5] drag-resize must not drift the scroll position...')
    const scroller = page.locator('.bottom-pane-body')
    await scroller.evaluate((el) => {
      el.scrollTop = 120
    })
    await sleep(150)
    const scrollTopBefore = await scroller.evaluate((el) => el.scrollTop)
    assert(scrollTopBefore > 50, `[T5] setup failed: expected the panel to actually be scrolled (>50px), got ${scrollTopBefore} — the grid may not be tall enough to scroll in this fixture`)
    const resizeHandle = page.locator(`[data-note-id="${leadNote1.id}"] .noteview-resize`)
    const handleBox = await resizeHandle.boundingBox()
    assert(handleBox, '[T5] setup failed: the T1 note\'s resize handle is not visible/attached after scrolling')
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 40, handleBox.y + handleBox.height / 2, { steps: 6 })
    await page.mouse.up()
    await sleep(200)
    const scrollTopAfter = await scroller.evaluate((el) => el.scrollTop)
    console.log(`  scrollTop before drag=${scrollTopBefore}, after drag=${scrollTopAfter}`)
    assert(scrollTopAfter === scrollTopBefore, `[T5] resize drag moved the scroll position from ${scrollTopBefore} to ${scrollTopAfter} — the scroll-drift bug is back`)
    console.log('[T5] PASS: dragging a note\'s resize handle left the scroll position untouched')
    results.t5 = { scrollTopBefore, scrollTopAfter }

    // ================================================================================================
    // T6 — BUG 6: the sticky titlebar's scroll-margin/scroll-padding generalization is really in the CSS.
    // ================================================================================================
    console.log('\n[T6] sticky titlebar scroll-margin/scroll-padding generalization...')
    const titlebarH = await page.$eval(':root', (el) => getComputedStyle(el).getPropertyValue('--sticky-titlebar-h').trim())
    const bodyPad = await page.$eval('.bottom-pane-body', (el) => getComputedStyle(el).scrollPaddingTop)
    const keyRowMargin = await page.$eval('.noteview-key-row', (el) => getComputedStyle(el).scrollMarginTop)
    // Render a real `.lane-row`: the drums fixture is still a legacy (pattern-migrated) track with
    // no explicit `lanes[]`, so DrumLanePanel shows its "Enable lane editing" materialize prompt
    // instead of the row list until that one-way conversion happens (the panel itself starts
    // expanded by default, so no toggle click is needed first).
    await selectTrack(page, daemon, 'drums')
    await page.click('[data-lane-materialize]')
    await page.waitForSelector('.lane-row', { timeout: 5000 })
    const laneRowMargin = await page.$eval('.lane-row', (el) => getComputedStyle(el).scrollMarginTop)
    console.log(`  --sticky-titlebar-h=${titlebarH}, .bottom-pane-body scroll-padding-top=${bodyPad}, .noteview-key-row scroll-margin-top=${keyRowMargin}, .lane-row scroll-margin-top=${laneRowMargin}`)
    assert(parseFloat(titlebarH) > 0, `[T6] --sticky-titlebar-h should resolve to a real px value, got "${titlebarH}"`)
    assert(bodyPad === titlebarH, `[T6] .bottom-pane-body's scroll-padding-top (${bodyPad}) should equal --sticky-titlebar-h (${titlebarH})`)
    assert(keyRowMargin === titlebarH, `[T6] .noteview-key-row's scroll-margin-top (${keyRowMargin}) should equal --sticky-titlebar-h (${titlebarH})`)
    assert(laneRowMargin === titlebarH, `[T6] .lane-row's scroll-margin-top (${laneRowMargin}) should equal --sticky-titlebar-h (${titlebarH}) — the fix must generalize to both panels`)
    console.log('[T6] PASS: both the drum-lane list and the note/lane key strip share the same scroll-margin/scroll-padding fix against the sticky title bar')
    results.t6 = { titlebarH, bodyPad, keyRowMargin, laneRowMargin }

    await page.close()
    await daemon.close()

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log('\n================ ALL PHASE 29 STREAM GC CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error('\nPHASE 29 STREAM GC VERIFY FAILED:', err)
  process.exit(1)
})
