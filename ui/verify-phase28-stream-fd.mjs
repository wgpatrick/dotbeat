#!/usr/bin/env node
// Phase 28 Stream FD verification — NoteView.tsx: two real bugs fixed, two follow-through
// improvements shipped (docs/phase-28-plan.md Stream FD, docs/research/76-ux-clip-view-midi-editing-round2.md).
//
// Driven live against a REAL `beat daemon` + the built frontend in headless Chrome, on a disposable
// COPY of examples/night-shift.beat mutated in memory (never written to disk unmodified — the copy
// lives in a fresh tmp dir). examples/night-shift-song.beat, the owner's own live project, is never
// touched or even read, matching every other Phase 27/28 verify script's discipline.
//
//   T1  BUG 3 (dead code) — `.editor-title` (the redundant second `track.name` render, superseded by
//       Phase 27 ED's `.noteview-titlebar`) is gone from the DOM entirely; the rest of the toolbar
//       row (Preview-clip button, the new zoom controls, the hint text, Place-in-Arrangement) still
//       renders.
//   T2  BUG 4 (titlebar/note visual collision) — reproduces research/76's exact repro shape (a
//       full-opacity, full-width, same-hue note scrolled to sit directly beneath the sticky
//       `.noteview-titlebar`): (a) getComputedStyle confirms a real, non-trivial border-bottom
//       (>=2px, a real opaque dark color, not the old barely-there 1px/30%-black shadow) exists on
//       the title bar; (b) a screenshot pixel-sample at the seam shows a genuinely darker band than
//       both the titlebar's own track-color fill and the note's track-color fill immediately below
//       it — the actual visible-separation proof, not just a CSS-declaration check.
//   T3  FOLLOW-THROUGH 1 (velocity paint-across) — a single drag gesture that starts on one note's
//       velocity bar and sweeps sideways across a SECOND note's bar changes BOTH notes' velocity
//       (not just the one under the cursor at drag-start, which is what the old single-note-anchored
//       gesture would have done).
//   T4  FOLLOW-THROUGH 2 (local time-zoom) — a fixed-duration note's on-grid bounding-box width
//       changes after clicking the new zoom-in button, changes further via a real Ctrl+wheel event
//       dispatched at the note grid (same modifier convention as ArrangementView.tsx's own
//       `onWheelZoom`), and returns to its original width after clicking "reset."
//   T5  FOLLOW-THROUGH 3 (clip-loop off `--accent`) — with a real placed clip (so the clip-loop strip
//       renders), the loop-range fill and the loop-handle's grip-bar computed background-color are
//       BOTH different from `--accent`'s own resolved value (read live off an element that actually
//       uses `var(--accent)`, not a hardcoded expectation).
//
// Usage: node ui/verify-phase28-stream-fd.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5928 // distinct from every other verify-phase2*.mjs script's own port

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
// hex "#rrggbb" -> the "rgb(r, g, b)" string form getComputedStyle returns for an opaque color.
function hexToRgbString(hex) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgb(${r}, ${g}, ${b})`
}
function parseRgb(s) {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s ?? '')
  if (!m) return null
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) }
}
function luminance({ r, g, b }) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}
// Playwright's `locator.boundingBox()` returns a plain {x, y, width, height} — NOT a DOMRect, so it
// has no `.bottom`/`.right` of its own.
function bottomOf(box) {
  return box.y + box.height
}

// ---- build the fixture doc: examples/night-shift.beat mutated in memory (song mode with one
// placed clip on "lead," EF-style, so the clip-loop strip renders) plus three synthetic notes
// pushed directly onto lead's own TOP-LEVEL notes array (what NoteView actually edits, in loop mode
// OR song mode — confirmed by reading NoteView.tsx: `events` always comes from `track.notes`, never
// `clip.notes`, matching how verify-phase27-stream-ee.mjs's fresh notes worked too). --------------
async function buildDoc() {
  const { parse } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const src = readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')
  const doc = parse(src)
  assert(doc.loopBars === 4, `[fixture] expected examples/night-shift.beat's loop_bars to be 4, got ${doc.loopBars}`)
  const lead = doc.tracks.find((t) => t.id === 'lead')
  assert(lead, '[fixture] examples/night-shift.beat has no "lead" track — pick a different base fixture')
  assert(lead.clips.length === 0, '[fixture] "lead" already has clips — fixture assumption broken')

  const defaults = { chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 }
  // T2 fixture: a near-full-loop-length note at the fixture's own highest existing pitch (76, so the
  // pitch-axis window doesn't shift around it) — the exact "full-opacity, full-width, same-hue note"
  // shape research/76 §2.5 diagnosed colliding with the title bar above it.
  lead.notes.push({ id: 'zfdbug4', pitch: 76, start: 0, duration: 62, velocity: 0.7, ...defaults })
  // T3 fixture: two short notes, well apart in x (steps 2 and 10 — free of the fixture's own note
  // starts: 20/24/28/40/52/56/62), same starting velocity, so a paint-across drag spanning both is
  // unambiguous: if only the anchor note changes, the old single-note-anchored bug is still present.
  lead.notes.push({ id: 'zfdvelA', pitch: 50, start: 2, duration: 2, velocity: 0.8, ...defaults })
  lead.notes.push({ id: 'zfdvelB', pitch: 45, start: 10, duration: 2, velocity: 0.8, ...defaults })

  // T5 fixture: a real placed clip so ClipPropertiesPanel/NoteView's `primaryClipFor` resolves a
  // clip and the clip-loop strip actually renders (same construction verify-phase27-stream-ef.mjs
  // uses for the same reason).
  lead.clips.push({ id: 'main', notes: [], hits: [], automation: [], loop: null, signature: null })
  doc.scenes = [{ id: 'sceneA', slots: { lead: 'main' } }]
  doc.song = [{ scene: 'sceneA', bars: doc.loopBars }]
  return doc
}

async function startProject(doc) {
  const { serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p28fd-'))
  const beatPath = join(proj, 'project.beat')
  writeFileSync(beatPath, serialize(doc))
  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  return { daemon, proj, beatPath }
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
    const leadNotes = () => daemon.getDoc().tracks.find((t) => t.id === 'lead').notes
    const note = (id) => leadNotes().find((n) => n.id === id)

    const page = await browser.newPage()
    page.on('pageerror', (e) => {
      errors.push(String(e))
      console.log(`[pageerror] ${e}`)
    })
    await page.setViewportSize({ width: 1400, height: 700 })
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 12000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    await page.click('.arr-track-select:has(.arr-track-name:text-is("lead"))')
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    await pollUntil(() => daemon.getDoc().selectedTrack === 'lead', 'lead selection to record')
    await sleep(150)

    // ================================================================================================
    // T1 — BUG 3: the dead `.editor-title` span is gone; the rest of the toolbar row still works.
    // ================================================================================================
    console.log('\n[T1] confirming NoteView\'s own dead .editor-title span is gone...')
    // Both `.editor-toolbar` and `.editor-title` are SHARED classes — MixerView/SynthPanel/
    // InstrumentPanel/ArrangementView all still render their own toolbar + title span with them
    // (ArrangementView's is mounted in the same page throughout, since it's the main view), so the
    // assertion is scoped to `.noteview .editor-toolbar` specifically (`.noteview` is NoteView's own,
    // non-shared root class), not a blanket "zero anywhere in the DOM" check.
    const editorTitleCount = await page.locator('.noteview .editor-toolbar .editor-title').count()
    assert(editorTitleCount === 0, `[T1] expected zero .editor-title elements inside NoteView's own .editor-toolbar, found ${editorTitleCount}`)
    const toolbarText = await page.locator('.noteview .editor-toolbar').innerText()
    assert(/Preview clip/.test(toolbarText), `[T1] expected the Preview-clip button to still be in the toolbar row, got: ${JSON.stringify(toolbarText)}`)
    assert(/Place in Arrangement|Placed/.test(toolbarText), `[T1] expected the Place-in-Arrangement button to still be in the toolbar row, got: ${JSON.stringify(toolbarText)}`)
    const zoomControlsInToolbar = await page.locator('.noteview .editor-toolbar .noteview-zoom-controls').count()
    assert(zoomControlsInToolbar === 1, `[T1] expected the new zoom controls to occupy the freed toolbar space, found ${zoomControlsInToolbar}`)
    console.log('[T1] PASS: .editor-title is gone; Preview-clip, Place-in-Arrangement, and the new zoom controls all still render in the same row')
    results.t1 = { editorTitleCount, zoomControlsInToolbar }

    // ================================================================================================
    // T2 — BUG 4: titlebar/note visual collision fix. Scroll the pane until the near-full-loop
    // "zfdbug4" note sits directly beneath the sticky title bar (the exact research/76 repro shape),
    // then confirm a real, visible seam — both via computed style and a pixel sample.
    // ================================================================================================
    console.log('\n[T2] reproducing the titlebar/note collision, checking for a real visible seam...')
    const titlebar = page.locator('.noteview-titlebar')
    const scroller = page.locator('.bottom-pane-body')
    await scroller.evaluate((el) => {
      el.scrollTop = 0
    })
    await sleep(100)
    const noteAtTop = page.locator('[data-note-id="zfdbug4"]')
    await noteAtTop.scrollIntoViewIfNeeded()
    await sleep(100)
    // Find the pinned (sticky-detached) titlebar bottom edge: scroll to the very bottom first — any
    // scroll position past its own natural offset detaches it, and once detached its own bounding box
    // no longer moves, so reading it at max scroll gives the same "pinned" y a smaller scroll would.
    const scrollHeight = await scroller.evaluate((el) => el.scrollHeight)
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await sleep(100)
    const titlebarPinned = await titlebar.boundingBox()
    await scroller.evaluate((el) => {
      el.scrollTop = 0
    })
    await sleep(100)
    const noteUnscrolled = await noteAtTop.boundingBox()
    assert(noteUnscrolled, '[T2] the zfdbug4 note did not render at all (fixture problem)')
    assert(titlebarPinned, '[T2] titlebar bounding box unavailable at max scroll')
    // Compute the scrollTop that puts the note's own top edge exactly against the pinned titlebar's
    // bottom edge (content scrolls 1:1 with scrollTop; the titlebar itself stays put once pinned).
    const targetScrollTop = Math.max(0, Math.min(scrollHeight, noteUnscrolled.y - bottomOf(titlebarPinned)))
    await scroller.evaluate((el, y) => {
      el.scrollTop = y
    }, targetScrollTop)
    await sleep(150)
    const titlebarBox = await titlebar.boundingBox()
    const noteBox = await noteAtTop.boundingBox()
    const gap = noteBox.y - bottomOf(titlebarBox)
    console.log(`  scrollTop=${targetScrollTop.toFixed(1)} -> titlebar bottom=${bottomOf(titlebarBox).toFixed(1)}, note top=${noteBox.y.toFixed(1)} (gap ${gap.toFixed(1)}px)`)
    assert(Math.abs(gap) < 6, `[T2] setup failed to position the note directly under the title bar (gap ${gap.toFixed(1)}px) — cannot exercise the collision repro`)

    // (a) computed-style check: a real, non-trivial seam, not the old 1px/30%-black shadow.
    const seamStyle = await titlebar.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { borderBottomWidth: cs.borderBottomWidth, borderBottomColor: cs.borderBottomColor, borderBottomStyle: cs.borderBottomStyle }
    })
    console.log(`  [T2a] computed titlebar border-bottom: ${JSON.stringify(seamStyle)}`)
    assert(seamStyle.borderBottomStyle !== 'none', `[T2a] expected a real border-bottom-style, got "${seamStyle.borderBottomStyle}"`)
    assert(parseFloat(seamStyle.borderBottomWidth) >= 2, `[T2a] expected a >=2px border-bottom (research/76's "2-3px solid dark bottom border" fix), got ${seamStyle.borderBottomWidth}`)
    const seamRgb = parseRgb(seamStyle.borderBottomColor)
    assert(seamRgb, `[T2a] could not parse border-bottom-color ${seamStyle.borderBottomColor}`)
    assert(luminance(seamRgb) < 40, `[T2a] expected a real dark (near-black) border-bottom color, got ${seamStyle.borderBottomColor} (luminance ${luminance(seamRgb).toFixed(1)})`)
    console.log('  [T2a] PASS: a real, opaque, >=2px dark border-bottom exists on the title bar')

    // (b) pixel-sample check: the seam row is genuinely darker than the track-color fill immediately
    // above (titlebar) and below (note) it — the actual visible-separation proof.
    const screenshotPath = join(uiDir, 'verify-p28fd-seam.png')
    await page.screenshot({ path: screenshotPath })
    const trackColor = daemon.getDoc().tracks.find((t) => t.id === 'lead').color
    const sampleX = Math.round(titlebarBox.x + titlebarBox.width / 2)
    const aboveY = Math.round(bottomOf(titlebarBox) - 6) // inside the titlebar's own fill
    const seamY = Math.round(bottomOf(titlebarBox) - 1) // on the border itself
    const belowY = Math.round(noteBox.y + noteBox.height / 2) // inside the note's own fill
    const sample = await page.evaluate(
      async ({ src, pts }) => {
        const img = new Image()
        img.src = src
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        return pts.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data))
      },
      { src: `data:image/png;base64,${readFileSync(screenshotPath).toString('base64')}`, pts: [[sampleX, aboveY], [sampleX, seamY], [sampleX, belowY]] },
    )
    const [aboveRgb, seamRgbPx, belowRgb] = sample.map(([r, g, b]) => ({ r, g, b }))
    const lumAbove = luminance(aboveRgb)
    const lumSeam = luminance(seamRgbPx)
    const lumBelow = luminance(belowRgb)
    console.log(`  [T2b] pixel luminance — titlebar fill=${lumAbove.toFixed(1)}, seam=${lumSeam.toFixed(1)}, note fill=${lumBelow.toFixed(1)} (track.color=${trackColor})`)
    assert(lumSeam < lumAbove - 15, `[T2b] the seam pixel should read noticeably darker than the titlebar's own fill (${lumSeam.toFixed(1)} vs ${lumAbove.toFixed(1)})`)
    assert(lumSeam < lumBelow - 15, `[T2b] the seam pixel should read noticeably darker than the note's own fill (${lumSeam.toFixed(1)} vs ${lumBelow.toFixed(1)})`)
    console.log('  [T2b] PASS: a genuinely darker seam band separates the titlebar fill from the note fill in the actual rendered pixels')
    console.log(`\nscreenshot -> ${screenshotPath}`)
    results.t2 = { seamStyle, gap, lumAbove, lumSeam, lumBelow }

    // ================================================================================================
    // T3 — FOLLOW-THROUGH 1: velocity lane paint-across. Drag starting on zfdvelA's bar, sweeping
    // sideways across the GAP onto zfdvelB's bar, ending near the lane's bottom (min velocity). Both
    // notes must drop from their shared starting velocity (0.8) — proof the gesture isn't anchored
    // to only the note pressed at drag-start.
    // ================================================================================================
    console.log('\n[T3] dragging across the velocity lane from note A to note B...')
    await scroller.evaluate((el) => {
      el.scrollTop = 0
    })
    await page.locator('.noteview-vel-lane').scrollIntoViewIfNeeded()
    await sleep(100)
    const velLane = await page.locator('.noteview-vel-lane').boundingBox()
    const barA = await page.locator('[data-vel-note-id="zfdvelA"]').boundingBox()
    const barB = await page.locator('[data-vel-note-id="zfdvelB"]').boundingBox()
    console.log(`  before: A velocity=${note('zfdvelA').velocity}, B velocity=${note('zfdvelB').velocity}`)
    assert(note('zfdvelA').velocity === 0.8 && note('zfdvelB').velocity === 0.8, '[T3] fixture assumption broken: expected both notes to start at velocity 0.8')
    const yNearBottom = velLane.y + velLane.height - 2
    await page.mouse.move(barA.x + barA.width / 2, yNearBottom)
    await page.mouse.down()
    await page.mouse.move((barA.x + barB.x) / 2, yNearBottom, { steps: 4 }) // pass through the gap between the two bars
    await page.mouse.move(barB.x + barB.width / 2, yNearBottom, { steps: 4 })
    await page.mouse.up()
    await pollUntil(() => note('zfdvelA').velocity <= 0.15 && note('zfdvelB').velocity <= 0.15, 'both note A and note B velocity to drop to ~0.05 from the paint-across drag')
    const velA = note('zfdvelA').velocity
    const velB = note('zfdvelB').velocity
    console.log(`  after: A velocity=${velA}, B velocity=${velB}`)
    assert(velA <= 0.15, `[T3] note A (the drag-anchor note) should have been painted, got velocity ${velA}`)
    assert(velB <= 0.15, `[T3] note B (swept over, NOT the drag-anchor note) should ALSO have been painted — a single-note-anchored gesture would have left it at 0.8, got velocity ${velB}`)
    console.log('[T3] PASS: a single drag swept across two notes\' velocity bars changed BOTH — the paint-across-notes gesture now covers the velocity lane, not just the chance lane')
    results.t3 = { velA, velB }

    // ================================================================================================
    // T4 — FOLLOW-THROUGH 2: local time-zoom control. Measure zfdvelA's on-grid bounding-box width at
    // default zoom, click zoom-in, confirm it grows; dispatch a real Ctrl+wheel event over the note
    // grid (same modifier convention as ArrangementView.tsx's onWheelZoom) and confirm it grows
    // further; click reset and confirm it returns to the original width.
    // ================================================================================================
    console.log('\n[T4] local time-zoom control...')
    const noteA = page.locator('[data-note-id="zfdvelA"]')
    await noteA.scrollIntoViewIfNeeded()
    await sleep(100)
    const widthAtDefault = (await noteA.boundingBox()).width
    const readoutAtDefault = await page.locator('.noteview-zoom-readout').getAttribute('data-stepw')
    console.log(`  default: note width=${widthAtDefault.toFixed(1)}px, readout stepw=${readoutAtDefault}`)
    assert(Math.abs(Number(readoutAtDefault) - 14) < 0.5, `[T4] expected the default readout to be ~14px/step, got ${readoutAtDefault}`)

    await page.click('[data-action="note-zoom-in"]')
    await page.click('[data-action="note-zoom-in"]')
    await pollUntil(async () => (await noteA.boundingBox()).width > widthAtDefault * 1.3, 'note width to grow after two zoom-in clicks')
    const widthAfterButtons = (await noteA.boundingBox()).width
    console.log(`  after 2x zoom-in clicks: note width=${widthAfterButtons.toFixed(1)}px`)
    assert(widthAfterButtons > widthAtDefault * 1.3, `[T4] expected a real width increase from zoom-in clicks, got ${widthAtDefault} -> ${widthAfterButtons}`)

    // Real Ctrl+wheel event dispatched at .noteview-scroll — same "synthesize a WheelEvent with
    // ctrlKey" technique verify-phase24-stream-cd.mjs's own [G] check uses for ArrangementView's
    // analogous onWheelZoom.
    const scrollRect = await page.$eval('.noteview-scroll', (el) => el.getBoundingClientRect().toJSON())
    await page.$eval(
      '.noteview-scroll',
      (el, rect) => el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true, clientX: rect.x + 10, clientY: rect.y + 10 })),
      scrollRect,
    )
    await pollUntil(async () => (await noteA.boundingBox()).width > widthAfterButtons, 'note width to grow further after a Ctrl+wheel zoom event')
    const widthAfterWheel = (await noteA.boundingBox()).width
    console.log(`  after Ctrl+wheel: note width=${widthAfterWheel.toFixed(1)}px`)

    // Plain wheel (no modifier) must NOT zoom — it's left for ordinary scrolling.
    await page.$eval('.noteview-scroll', (el, rect) => el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true, clientX: rect.x + 10, clientY: rect.y + 10 })), scrollRect)
    await sleep(150)
    const widthAfterPlainWheel = (await noteA.boundingBox()).width
    assert(Math.abs(widthAfterPlainWheel - widthAfterWheel) < 0.5, `[T4] a plain (non-modified) wheel event must not change zoom, got ${widthAfterWheel} -> ${widthAfterPlainWheel}`)
    console.log(`  plain wheel (no modifier): note width unchanged at ${widthAfterPlainWheel.toFixed(1)}px, as expected`)

    await page.click('[data-action="note-zoom-reset"]')
    await pollUntil(async () => Math.abs((await noteA.boundingBox()).width - widthAtDefault) < 0.5, 'note width to return to the default after zoom-reset')
    const widthAfterReset = (await noteA.boundingBox()).width
    const resetDisabled = await page.$eval('[data-action="note-zoom-reset"]', (b) => b.disabled)
    console.log(`  after reset: note width=${widthAfterReset.toFixed(1)}px, reset button disabled=${resetDisabled}`)
    assert(Math.abs(widthAfterReset - widthAtDefault) < 0.5, `[T4] expected zoom-reset to restore the exact default width, got ${widthAtDefault} -> ${widthAfterReset}`)
    assert(resetDisabled, '[T4] reset button should disable itself once already at the default zoom')
    console.log('[T4] PASS: zoom-in buttons and a real Ctrl+wheel event both grow the note grid\'s horizontal scale; a plain wheel does not; reset restores the exact default')
    results.t4 = { widthAtDefault, widthAfterButtons, widthAfterWheel, widthAfterReset }

    // ================================================================================================
    // T5 — FOLLOW-THROUGH 3: clip-loop range/handles are no longer `--accent`.
    // ================================================================================================
    console.log('\n[T5] clip-loop range/handle color vs. --accent...')
    await page.locator('[data-clip-loop-strip="lead"]').scrollIntoViewIfNeeded()
    await sleep(100)
    const accentRgb = await page.$eval('.clip-audition-btn', (el) => getComputedStyle(el).backgroundColor) // a real var(--accent) call site
    const rangeRgb = await page.$eval('[data-clip-loop-strip="lead"] .noteview-cliploop-range', (el) => getComputedStyle(el).backgroundColor)
    const handleGripRgb = await page.evaluate(() => {
      const handle = document.querySelector('[data-clip-loop-handle="lead"]')
      return getComputedStyle(handle, '::after').backgroundColor
    })
    console.log(`  --accent (via .clip-audition-btn background) = ${accentRgb}`)
    console.log(`  .noteview-cliploop-range background = ${rangeRgb}`)
    console.log(`  clip-loop handle ::after (grip bar) background = ${handleGripRgb}`)
    const expectedAccent = hexToRgbString('#e0a13c')
    assert(accentRgb.replace(/\s/g, '') === expectedAccent.replace(/\s/g, ''), `[T5] sanity check failed: .clip-audition-btn's own background (${accentRgb}) doesn't match the known --accent value (${expectedAccent}) — cannot use it as the --accent reference`)
    assert(handleGripRgb.replace(/\s/g, '') !== accentRgb.replace(/\s/g, ''), `[T5] clip-loop handle grip bar (${handleGripRgb}) must no longer equal --accent (${accentRgb})`)
    const accentParsed = parseRgb(accentRgb)
    const rangeParsed = parseRgb(rangeRgb)
    const dist = Math.sqrt((accentParsed.r - rangeParsed.r) ** 2 + (accentParsed.g - rangeParsed.g) ** 2 + (accentParsed.b - rangeParsed.b) ** 2)
    assert(dist > 40, `[T5] clip-loop range fill (${rangeRgb}) reads too close to --accent (${accentRgb}) to be a genuinely distinct hue (distance ${dist.toFixed(1)})`)
    console.log(`[T5] PASS: the clip-loop range/handle color (${handleGripRgb}) is genuinely distinct from --accent (${accentRgb})`)
    results.t5 = { accentRgb, rangeRgb, handleGripRgb, dist }

    await page.close()
    await daemon.close()

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log('\n================ ALL PHASE 28 STREAM FD CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error('\nPHASE 28 STREAM FD VERIFY FAILED:', err)
  process.exit(1)
})
