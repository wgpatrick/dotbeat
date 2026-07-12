#!/usr/bin/env node
// Phase 27 Stream EE verification — drop velocity-opacity encoding on grid notes, add a live
// floating numeric readout while dragging a velocity/chance marker (docs/phase-27-plan.md Stream
// EE, docs/research/71-ux-clip-view-midi-editing.md §2.4/§2.5, §3 P0 items 2-3). Driven live
// against a real `beat daemon` + the built frontend in headless Chrome, on a disposable copy of
// examples/night-shift.beat in a temp dir — examples/night-shift-song.beat (the owner's own live
// project) is NEVER touched, matching every other Phase 27 verify script's discipline.
//
//   EE1  ADD TWO NOTES, VERY DIFFERENT VELOCITIES — click empty grid twice on the `lead` track to
//        add two fresh notes, then drag each one's velocity-lane bar to a near-opposite extreme
//        (~0.05 and ~1.0, "very different" per the stream brief's 0.1/0.95 example). Read the
//        ACTUAL COMPUTED opacity of both on-grid `.noteview-note` divs: they must be IDENTICAL,
//        proving velocity no longer drives grid opacity (NoteView.tsx:1032's old
//        `(0.45 + ev.velocity * 0.55) * (isChancy ? 0.6 : 1)` formula is gone).
//   EE2  CHANCE DIMMING STILL LEGIBLE — set one of those two notes' chance<100 via the
//        NoteInspector; its computed opacity now differs from the still-chance=100 note (0.6 vs 1),
//        proving the chance-dim treatment survived the opacity-formula change and still reads as
//        its own, distinct signal now that velocity isn't fighting it for the same channel.
//   EE3  LIVE DRAG LABEL, VELOCITY LANE — mid-drag on a velocity-lane bar,
//        `[data-drag-label="velocity"]` becomes visible with a live numeric value that changes as
//        the pointer moves; the value shown right before pointerup matches what actually commits
//        to the .beat file (checked against both daemon.getDoc() and a real git diff of the
//        fixture, the same "label vs. committed value" discipline verify-phase26-stream-di.mjs's
//        A2 check used for ArrangementView's automation-lane drag label).
//   EE4  LIVE DRAG LABEL, CHANCE LANE — same check for the chance lane's draw-across-notes paint
//        gesture: `[data-drag-label="chance"]` is visible and live during the drag, and its final
//        value matches the committed `chance=N` token that lands in the .beat file for the swept
//        note.
//
// Usage: node ui/verify-phase27-stream-ee.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8927
const PREVIEW_PORT = 5937

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
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
function addedRemoved(diff) {
  return {
    added: diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')),
    removed: diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')),
  }
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // Disposable copy in a temp dir — NEVER examples/night-shift-song.beat (the owner's own live
  // project). examples/night-shift.beat is the shared read-only fixture other Phase 23/26/27
  // verify scripts already use the same way.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p27ee-'))
  const beatPath = join(proj, 'night-shift.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical night-shift baseline')

  const daemon = await startDaemon({ filePath: beatPath, port: PORT })
  console.log(`daemon up on :${daemon.port}, project ${beatPath} (disposable copy, not the owner's real project)`)
  const readBeat = () => readFileSync(beatPath, 'utf8')
  const leadNotes = () => daemon.getDoc().tracks.find((t) => t.id === 'lead').notes
  const note = (id) => leadNotes().find((n) => n.id === id)

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
    page.on('pageerror', (e) => {
      errors.push(String(e))
      console.log(`[pageerror] ${e}`)
    })
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    await page.click('.arr-track-select:has(.arr-track-name:text-is("lead"))')
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    await pollUntil(() => daemon.getDoc().selectedTrack === 'lead', 'lead selection to record')
    // block:'start' (not 'center') — the grid is ~576px tall (48 padded pitch rows * 12px), taller
    // than the viewport once the toolbar/clip-properties chrome above it is counted, so centering it
    // could scroll its own top edge above y=0. Anchoring the top keeps our small, near-top pixel
    // offsets below inside the actual visible viewport.
    await page.$eval('.noteview-grid', (el) => el.scrollIntoView({ block: 'start' }))
    await sleep(200)

    const gridBox = await page.locator('.noteview-grid').boundingBox()
    const TOTAL_STEPS = 64 // night-shift.beat: loop_bars 4 * 16
    const STEP_W = gridBox.width / TOTAL_STEPS
    const xForStep = (step) => gridBox.x + (step + 0.5) * STEP_W
    const idsBefore = new Set(leadNotes().map((n) => n.id))

    // ============ EE1a: add two fresh notes in empty grid space (steps 2 and 6 — unused by the
    // fixture's own lead notes, which sit at steps 20/24/28/40/52/56/62) ============
    console.log('\n[EE1a] adding two fresh notes via click-empty-grid-to-add')
    await page.mouse.click(xForStep(2), gridBox.y + 66) // row ~5 -> a pitch well inside the padded window
    await pollUntil(() => leadNotes().length === idsBefore.size + 1, 'note A added')
    const idA = leadNotes()
      .map((n) => n.id)
      .find((id) => !idsBefore.has(id))
    await page.mouse.click(xForStep(6), gridBox.y + 186) // row ~15 -> a different pitch, still inside the window
    await pollUntil(() => leadNotes().length === idsBefore.size + 2, 'note B added')
    const idB = leadNotes()
      .map((n) => n.id)
      .find((id) => !idsBefore.has(id) && id !== idA)
    console.log(`  added noteA=${idA} (pitch ${note(idA).pitch}, start ${note(idA).start}) noteB=${idB} (pitch ${note(idB).pitch}, start ${note(idB).start}), both default velocity ${note(idA).velocity}`)
    git(proj, 'commit', '-q', '-am', 'add note A + note B')

    // ============ EE1b + EE3: drag note A's velocity bar to the bottom (~0.05), checking the live
    // drag label along the way ============
    console.log('\n[EE1b/EE3] dragging note A velocity bar toward the bottom (~0.05) — checking the live label mid-drag')
    // The velocity lane sits below the ~576px-tall grid, off the bottom of the viewport at this
    // scroll position (gridBox was only scrolled far enough to show the GRID, not what's below it) —
    // scroll it fully into view and re-read its box fresh before computing any click coordinates
    // against it, or the mouse events below land past the bottom of the actual viewport and hit
    // nothing.
    await page.locator('.noteview-vel-lane').scrollIntoViewIfNeeded()
    await sleep(100)
    const velLane = await page.locator('.noteview-vel-lane').boundingBox()
    const barA = await page.locator(`[data-vel-note-id="${idA}"]`).boundingBox()
    await page.mouse.move(barA.x + barA.width / 2, barA.y + barA.height / 2)
    await page.mouse.down()
    await page.mouse.move(barA.x + barA.width / 2, velLane.y + velLane.height / 2, { steps: 4 })
    const midDragDisplay = await page.locator('[data-drag-label="velocity"]').evaluate((el) => getComputedStyle(el).display)
    const midDragText = (await page.locator('[data-drag-label="velocity"]').textContent()) ?? ''
    console.log(`  mid-drag label: display="${midDragDisplay}" text="${midDragText}"`)
    if (midDragDisplay === 'none' || midDragText.trim() === '') throw new Error('[EE3] the live velocity drag-label was not shown mid-drag')
    await page.mouse.move(barA.x + barA.width / 2, velLane.y + velLane.height - 2, { steps: 6 })
    const finalDragText = ((await page.locator('[data-drag-label="velocity"]').textContent()) ?? '').trim()
    await page.mouse.up()
    await pollUntil(() => note(idA).velocity <= 0.15, 'note A velocity to drop to ~0.05')
    const velA = note(idA).velocity
    const labelVelA = Number(finalDragText.replace(/[^0-9.]/g, ''))
    console.log(`  label showed "${finalDragText}" (~${labelVelA}), committed velocity ${velA}`)
    if (!Number.isFinite(labelVelA) || Math.abs(labelVelA - velA) > 0.02) throw new Error(`[EE3] label value ${labelVelA} doesn't match committed note A velocity ${velA}`)
    const diffVelA = git(proj, 'diff', '--unified=0', 'night-shift.beat')
    const arVelA = addedRemoved(diffVelA)
    if (!arVelA.added.some((l) => l.includes(`note ${idA} `) && l.trim().endsWith(String(velA)))) {
      throw new Error(`[EE3] expected the committed .beat diff to show note ${idA}'s velocity as ${velA}, got:\n${diffVelA}`)
    }
    git(proj, 'commit', '-q', '-am', 'drag note A velocity to ~0.05')
    console.log(`  [EE1b/EE3] PASS: live label matched the committed value (${velA}), which also landed correctly in the .beat diff`)

    // ============ note B: drag its velocity bar to the top (~1.0), no label re-check needed (EE3
    // already proved the label mechanism; this call just needs the extreme opposite value) ============
    console.log('\n[EE1c] dragging note B velocity bar toward the top (~1.0)')
    const barB = await page.locator(`[data-vel-note-id="${idB}"]`).boundingBox()
    await page.mouse.move(barB.x + barB.width / 2, barB.y + barB.height / 2)
    await page.mouse.down()
    await page.mouse.move(barB.x + barB.width / 2, velLane.y + 2, { steps: 6 })
    await page.mouse.up()
    await pollUntil(() => note(idB).velocity >= 0.9, 'note B velocity to rise to ~1.0')
    const velB = note(idB).velocity
    console.log(`  committed velocity B = ${velB}`)
    git(proj, 'commit', '-q', '-am', 'drag note B velocity to ~1.0')
    results.ee1 = { idA, velA, idB, velB }
    if (Math.abs(velA - velB) < 0.5) throw new Error(`[EE1] fixture assumption broken: expected velocities to be "very different", got A=${velA} B=${velB}`)

    // ============ EE1d: the actual assertion — computed grid opacity is now IDENTICAL despite the
    // huge velocity gap ============
    console.log('\n[EE1d] comparing computed on-grid opacity of note A (vel ~0.05) vs note B (vel ~1.0)')
    const opacityOf = async (id) => Number(await page.locator(`[data-note-id="${id}"]`).evaluate((el) => getComputedStyle(el).opacity))
    const opA = await opacityOf(idA)
    const opB = await opacityOf(idB)
    console.log(`  opacity(A, vel=${velA}) = ${opA}   opacity(B, vel=${velB}) = ${opB}`)
    if (opA !== opB) throw new Error(`[EE1] expected identical on-grid opacity regardless of velocity (velocity-as-opacity encoding should be gone), got A=${opA} vs B=${opB}`)
    if (opA !== 1) throw new Error(`[EE1] expected a non-chancy note's on-grid opacity to be a flat 1 (constant base color), got ${opA}`)
    console.log('  [EE1] PASS: on-grid opacity is identical for wildly different velocities, and equals a flat 1 — velocity-as-opacity encoding is gone')

    // ============ EE2: chance-dimming is still legible on its own, now that it's the only opacity
    // encoding left ============
    console.log('\n[EE2] setting note A chance=40 via the NoteInspector, comparing opacity against still-chance=100 note B')
    await page.locator(`[data-note-id="${idA}"]`).click()
    await pollUntil(async () => page.evaluate(() => window.__store.getState().editNoteIds.join(',')), 'note A selected')
    await page.waitForSelector('[data-note-field="chance"]', { timeout: 3000 })
    await page.fill('[data-note-field="chance"]', '40')
    await pollUntil(() => note(idA).chance === 40, 'note A chance -> 40')
    const chancyClass = await page.locator(`[data-note-id="${idA}"]`).getAttribute('class')
    if (!chancyClass.includes('chancy')) throw new Error(`[EE2] expected .chancy class on note A after chance=40, got "${chancyClass}"`)
    const opAChancy = await opacityOf(idA)
    const opBStill = await opacityOf(idB)
    console.log(`  opacity(A, chance=40) = ${opAChancy}   opacity(B, chance=100) = ${opBStill}`)
    if (opAChancy === opBStill) throw new Error(`[EE2] expected the chancy note's opacity to differ from the non-chancy note's, both read ${opAChancy}`)
    if (opAChancy !== 0.6) throw new Error(`[EE2] expected the chancy-note opacity to be exactly 0.6 (the documented dim factor), got ${opAChancy}`)
    console.log('  [EE2] PASS: chance-dimming still reads as its own, distinct, legible signal after the velocity-opacity removal')
    results.ee2 = { opA, opB, opAChancy, opBStill }
    git(proj, 'commit', '-q', '-am', 'note A chance=40')

    // ============ EE4: the chance lane's draw-across-notes paint gesture also gets a live label ============
    console.log('\n[EE4] dragging across the chance lane over note B, checking the live label mid-drag')
    await page.locator('.noteview-chance-lane').scrollIntoViewIfNeeded()
    await sleep(100)
    const chanceLaneBox = await page.locator('.noteview-chance-lane').boundingBox()
    const targetChanceY = chanceLaneBox.y + chanceLaneBox.height * 0.3 // fraction from top = 1-0.3 = 70%
    // Computed against the chance lane's OWN bounding box, not the grid's — they should share the
    // same x-coordinate system (siblings in the same column, both `totalSteps * var(--note-step-w)`
    // wide) but paintChanceAt's hit-test uses the lane's own captured rect, so anchor to that
    // directly rather than assuming the two boxes are pixel-identical. Uses note B's ACTUAL start
    // (not a hardcoded step) — click-to-add's step snapping doesn't always land exactly on the
    // clicked step's nominal index, confirmed live while developing this check (a hardcoded step 6
    // missed note B, which actually landed at step 7).
    const bXCenter = chanceLaneBox.x + (note(idB).start + 0.5) * (chanceLaneBox.width / TOTAL_STEPS)
    await page.mouse.move(bXCenter, targetChanceY)
    await page.mouse.down()
    await page.mouse.move(bXCenter + 2, targetChanceY, { steps: 3 }) // tiny move so the paint gesture registers as a drag, not just a press
    const chanceMidDisplay = await page.locator('[data-drag-label="chance"]').evaluate((el) => getComputedStyle(el).display)
    const chanceMidText = (await page.locator('[data-drag-label="chance"]').textContent()) ?? ''
    console.log(`  mid-drag chance label: display="${chanceMidDisplay}" text="${chanceMidText}"`)
    if (chanceMidDisplay === 'none' || chanceMidText.trim() === '') throw new Error('[EE4] the live chance drag-label was not shown mid-drag')
    const chanceFinalText = chanceMidText.trim()
    await page.mouse.up()
    await pollUntil(() => note(idB).chance !== undefined && note(idB).chance !== 100, 'note B chance to change from the paint gesture')
    const chanceB = note(idB).chance
    const labelChanceB = Number(chanceFinalText.replace(/[^0-9.]/g, ''))
    console.log(`  label showed "${chanceFinalText}" (~${labelChanceB}%), committed chance ${chanceB}%`)
    if (!Number.isFinite(labelChanceB) || Math.abs(labelChanceB - chanceB) > 2) throw new Error(`[EE4] label value ${labelChanceB} doesn't match committed note B chance ${chanceB}`)
    const diffChanceB = git(proj, 'diff', '--unified=0', 'night-shift.beat')
    const arChanceB = addedRemoved(diffChanceB)
    if (!arChanceB.added.some((l) => l.includes(`note ${idB} `) && l.includes(`chance=${chanceB}`))) {
      throw new Error(`[EE4] expected the committed .beat diff to show note ${idB} with chance=${chanceB}, got:\n${diffChanceB}`)
    }
    git(proj, 'commit', '-q', '-am', 'paint note B chance via the chance-lane drag')
    console.log(`  [EE4] PASS: live chance label matched the committed value (${chanceB}%), which also landed correctly in the .beat diff`)
    results.ee4 = { idB, chanceB, labelChanceB }

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log(`\nALL PASS — Phase 27 Stream EE (velocity-lane opacity removal + live drag labels) verified live:`)
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGKILL')
    await daemon.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
