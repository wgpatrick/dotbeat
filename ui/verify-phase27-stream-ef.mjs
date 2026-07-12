#!/usr/bin/env node
// Phase 27 Stream EF verification — the clip-loop handle in NoteView.tsx becomes two-sided.
//
// docs/research/71-ux-clip-view-midi-editing.md §2.6/§3.4 item 4 diagnosed a real gap: Ableton's
// loop brace is draggable at BOTH edges and reads as clearly grabbable even at rest, while
// dotbeat's clip-loop handle (Phase 24 Stream CJ) was END-ONLY and a bare 2px line only visible on
// hover — the START edge had no drag affordance at all (numeric-field-only). This stream:
//   1. Adds a real second, symmetric drag handle at the loop's START edge, wired through the SAME
//      `origStart`-aware gesture plumbing the end handle already used (NoteView.tsx's
//      `clipLoopGesture`/`onClipLoopPointerMove`/`onClipLoopPointerUp` now take an `edge` field
//      rather than being invented as a second mechanism).
//   2. Thickens BOTH handles (9px -> 13px hit zone, 2px -> 4px grip bar) and adds a triangular cap
//      (`::before`, a small inward-pointing nub) so each handle reads as draggable AT REST, not
//      only discoverable by accidentally hovering a thin invisible strip.
//
// Three parts, in order, against a REAL `beat daemon` + built frontend on a disposable copy/mutation
// of examples/night-shift.beat in a temp dir (examples/night-shift-song.beat, the owner's own live
// project, is never touched):
//   A  REST-STATE VISUAL AFFORDANCE — no drag, no hover: both handles exist, are positioned at the
//      loop's actual start/end x-coordinates, are wider than the old 9px hit zone, and carry a
//      non-transparent triangular ::before cap plus a >=4px ::after grip bar — confirmed via
//      getBoundingClientRect + getComputedStyle(el, '::before'/'::after'), not a screenshot.
//   B  DRAG THE START HANDLE — drag from bar 0 to bar 1 (end stays at the default loopBars=4); the
//      resulting git diff on the .beat file must show a NEW "loop 1 4" line under the clip (there
//      was no loop line before — clip.loop was null/canonical-elided).
//   C  DRAG THE END HANDLE (regression) — drag the still-working end handle from bar 4 to bar 3; the
//      git diff must show "loop 1 4" replaced by "loop 1 3" (start stays exactly where part B left
//      it, proving the two handles are independent and both still work after one another).
//
// Usage: node ui/verify-phase27-stream-ef.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5948 // distinct from verify-phase24-stream-cj.mjs's 5947 so both can run independently

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 12000, everyMs = 30) {
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

// ---- build the test fixture: examples/night-shift.beat (loop-mode, NO song section, per the
// shipped example) mutated into song mode with one clip on "lead" so ClipPropertiesPanel/NoteView's
// `primaryClipFor` resolves a real clip to resize — the same gating Stream CJ's own verify script
// relies on. This is a MUTATION IN MEMORY of a parsed copy; the original example file on disk is
// never opened for writing. ------------------------------------------------------------------------
async function buildDoc() {
  const { parse } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const src = readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')
  const doc = parse(src)
  assert(doc.selectedTrack === 'lead', `[fixture] expected examples/night-shift.beat's selected_track to be "lead", got ${doc.selectedTrack}`)
  assert(doc.loopBars === 4, `[fixture] expected examples/night-shift.beat's loop_bars to be 4, got ${doc.loopBars}`)
  const lead = doc.tracks.find((t) => t.id === 'lead')
  assert(lead, '[fixture] examples/night-shift.beat has no "lead" track — pick a different base fixture')
  assert(lead.clips.length === 0, '[fixture] examples/night-shift.beat\'s "lead" track already has clips — fixture assumption broken')
  lead.clips.push({ id: 'main', notes: [], hits: [], automation: [], loop: null, signature: null })
  doc.scenes = [{ id: 'sceneA', slots: { lead: 'main' } }]
  doc.song = [{ scene: 'sceneA', bars: 4 }]
  return doc
}

async function startProject(doc, dirPrefix) {
  const { serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const proj = mkdtempSync(join(tmpdir(), dirPrefix))
  const beatPath = join(proj, 'project.beat')
  writeFileSync(beatPath, serialize(doc))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline (no clip.loop override)')
  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  return { daemon, proj, beatPath }
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try {
      return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok
    } catch {
      return false
    }
  }, 'vite preview to serve', 20000)
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const errors = []
  const results = {}

  try {
    const { daemon, proj, beatPath } = await startProject(await buildDoc(), 'dotbeat-p27ef-')
    const page = await browser.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 12000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    await page.waitForSelector('[data-clip-loop-strip="lead"]', { timeout: 8000 })

    // ================================================================================================
    // PART A — rest-state visual affordance: both handles exist, positioned correctly, thicker than
    // the old 9px zone, and carry a non-transparent triangular cap — with NO drag or hover performed.
    // ================================================================================================
    console.log('\n[A] at-rest visual affordance of both clip-loop handles (no drag, no hover)...')
    const stripBox0 = await page.$eval('[data-clip-loop-strip="lead"]', (el) => el.getBoundingClientRect().toJSON())
    const startBox0 = await page.$eval('[data-clip-loop-handle-start="lead"]', (el) => el.getBoundingClientRect().toJSON())
    const endBox0 = await page.$eval('[data-clip-loop-handle="lead"]', (el) => el.getBoundingClientRect().toJSON())
    const STEP_W = 14 // px, --note-step-w (styles.css)

    // clip.loop is null (canonical elision) -> effective range is [0, loopBars=4) -> start handle at
    // bar 0 (the strip's own left edge), end handle at bar 4 (the strip's right edge).
    const expectedStartX = stripBox0.x
    const expectedEndX = stripBox0.x + 4 * 16 * STEP_W
    assert(Math.abs(startBox0.x + startBox0.width / 2 - expectedStartX) < 4, `[A] start handle center x=${(startBox0.x + startBox0.width / 2).toFixed(1)} not close to expected loop-start x=${expectedStartX.toFixed(1)}`)
    assert(Math.abs(endBox0.x + endBox0.width / 2 - expectedEndX) < 4, `[A] end handle center x=${(endBox0.x + endBox0.width / 2).toFixed(1)} not close to expected loop-end x=${expectedEndX.toFixed(1)}`)
    console.log(`[A] PASS: start handle sits at the loop's start (bar 0), end handle at the loop's end (bar 4) — both edges have a real positioned handle`)

    assert(startBox0.width >= 13, `[A] start handle width ${startBox0.width}px should be >= 13px (thickened from the old 9px hit zone)`)
    assert(endBox0.width >= 13, `[A] end handle width ${endBox0.width}px should be >= 13px (thickened from the old 9px hit zone)`)
    console.log(`[A] PASS: both handles thickened to ${startBox0.width}px / ${endBox0.width}px (was 9px pre-Stream-EF)`)

    const pseudo = await page.evaluate(() => {
      const start = document.querySelector('[data-clip-loop-handle-start="lead"]')
      const end = document.querySelector('[data-clip-loop-handle="lead"]')
      const sAfter = getComputedStyle(start, '::after')
      const sBefore = getComputedStyle(start, '::before')
      const eAfter = getComputedStyle(end, '::after')
      const eBefore = getComputedStyle(end, '::before')
      return {
        startAfterWidth: sAfter.width,
        startBeforeBorderLeft: sBefore.borderLeftWidth,
        startBeforeBorderLeftColor: sBefore.borderLeftColor,
        endAfterWidth: eAfter.width,
        endBeforeBorderRight: eBefore.borderRightWidth,
        endBeforeBorderRightColor: eBefore.borderRightColor,
      }
    })
    console.log(`  computed pseudo-element styles at rest: ${JSON.stringify(pseudo)}`)
    assert(parseFloat(pseudo.startAfterWidth) >= 4, `[A] start handle's ::after grip bar should be >= 4px wide (was 2px pre-Stream-EF), got ${pseudo.startAfterWidth}`)
    assert(parseFloat(pseudo.endAfterWidth) >= 4, `[A] end handle's ::after grip bar should be >= 4px wide (was 2px pre-Stream-EF), got ${pseudo.endAfterWidth}`)
    assert(parseFloat(pseudo.startBeforeBorderLeft) >= 6, `[A] start handle's ::before triangular cap (border-left) should be a real several-px triangle, got ${pseudo.startBeforeBorderLeft}`)
    assert(parseFloat(pseudo.endBeforeBorderRight) >= 6, `[A] end handle's ::before triangular cap (border-right) should be a real several-px triangle, got ${pseudo.endBeforeBorderRight}`)
    assert(!/rgba?\(0, ?0, ?0, ?0\)|transparent/.test(pseudo.startBeforeBorderLeftColor), `[A] start handle's triangular cap must have a real (non-transparent) color at rest, got ${pseudo.startBeforeBorderLeftColor}`)
    assert(!/rgba?\(0, ?0, ?0, ?0\)|transparent/.test(pseudo.endBeforeBorderRightColor), `[A] end handle's triangular cap must have a real (non-transparent) color at rest, got ${pseudo.endBeforeBorderRightColor}`)
    console.log(`[A] PASS: both handles carry a real, non-transparent triangular grip cap AT REST — no hover, no drag needed to see the drag affordance`)
    results.partA = { stripBox0, startBox0, endBox0, pseudo }

    // ================================================================================================
    // PART B — drag the NEW start handle from bar 0 to bar 1; confirm the .beat diff shows a NEW
    // "loop 1 4" line (there was no loop line before — clip.loop was canonical-elided null).
    // ================================================================================================
    console.log('\n[B] drag the start handle (bar 0 -> bar 1), confirm the .beat diff...')
    const startHandle = await page.$('[data-clip-loop-handle-start="lead"]')
    const startBoxForDrag = await startHandle.boundingBox()
    const stripForDrag = await page.$('[data-clip-loop-strip="lead"]')
    const stripBoxForDrag = await stripForDrag.boundingBox()
    const targetStartX = stripBoxForDrag.x + 1 * 16 * STEP_W // bar 1
    const hy = startBoxForDrag.y + startBoxForDrag.height / 2
    await page.mouse.move(startBoxForDrag.x + startBoxForDrag.width / 2, hy)
    await page.mouse.down()
    await page.mouse.move(targetStartX, hy, { steps: 10 })
    await pollUntil(async () => {
      const label = await page.$eval('[data-clip-loop-label-start="lead"]', (el) => el.textContent).catch(() => null)
      return label === '1 bar'
    }, 'the live start-drag preview label to read "1 bar"', 4000, 20)
    await page.mouse.up()

    await pollUntil(() => {
      const c = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'main')
      return c.loop && c.loop.start === 1 && c.loop.end === 4
    }, 'clip.loop to commit as {start:1, end:4} on disk after the start-handle drag', 8000)
    await sleep(150)

    const diffAfterStartDrag = git(proj, 'diff')
    console.log('  git diff after start-handle drag:\n' + diffAfterStartDrag)
    assert(/^\+\s+loop 1 4\s*$/m.test(diffAfterStartDrag), `[B] expected the diff to add a "loop 1 4" line under clip "main", got:\n${diffAfterStartDrag}`)
    const onDiskB = readFileSync(beatPath, 'utf8')
    assert(/\n\s{4}loop 1 4\n/.test(onDiskB), `[B] expected "loop 1 4" under clip "main" on disk, file:\n${onDiskB}`)
    console.log('[B] PASS: dragging the NEW start handle wrote clip.loop = {start:1, end:4} — the diff shows a genuine new "loop 1 4" line')
    git(proj, 'commit', '-q', '-am', 'clip.loop start dragged to bar 1')
    results.partB = { loop: { start: 1, end: 4 } }

    // ================================================================================================
    // PART C — regression: the pre-existing end handle still works. Drag it from bar 4 to bar 3;
    // confirm the diff replaces "loop 1 4" with "loop 1 3" (start untouched by this drag).
    // ================================================================================================
    console.log('\n[C] drag the (pre-existing) end handle (bar 4 -> bar 3), confirm the .beat diff — regression check...')
    const endHandle = await page.$('[data-clip-loop-handle="lead"]')
    const endBoxForDrag = await endHandle.boundingBox()
    const strip2 = await page.$('[data-clip-loop-strip="lead"]')
    const stripBox2 = await strip2.boundingBox()
    const targetEndX = stripBox2.x + 3 * 16 * STEP_W // bar 3
    const hy2 = endBoxForDrag.y + endBoxForDrag.height / 2
    await page.mouse.move(endBoxForDrag.x + endBoxForDrag.width / 2, hy2)
    await page.mouse.down()
    await page.mouse.move(targetEndX, hy2, { steps: 10 })
    await pollUntil(async () => {
      const label = await page.$eval('[data-clip-loop-label="lead"]', (el) => el.textContent).catch(() => null)
      return label === '3 bars'
    }, 'the live end-drag preview label to read "3 bars"', 4000, 20)
    await page.mouse.up()

    await pollUntil(() => {
      const c = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === 'main')
      return c.loop && c.loop.start === 1 && c.loop.end === 3
    }, 'clip.loop to commit as {start:1, end:3} on disk after the end-handle drag', 8000)
    await sleep(150)

    const diffAfterEndDrag = git(proj, 'diff')
    console.log('  git diff after end-handle drag:\n' + diffAfterEndDrag)
    assert(/^-\s+loop 1 4\s*$/m.test(diffAfterEndDrag), `[C] expected the diff to remove the old "loop 1 4" line, got:\n${diffAfterEndDrag}`)
    assert(/^\+\s+loop 1 3\s*$/m.test(diffAfterEndDrag), `[C] expected the diff to add a "loop 1 3" line (start=1 unchanged, end 4->3), got:\n${diffAfterEndDrag}`)
    const onDiskC = readFileSync(beatPath, 'utf8')
    assert(/\n\s{4}loop 1 3\n/.test(onDiskC), `[C] expected "loop 1 3" under clip "main" on disk, file:\n${onDiskC}`)
    console.log('[C] PASS: dragging the pre-existing end handle still works after the start-handle drag — clip.loop = {start:1, end:3}, start untouched by this drag (regression clean)')
    results.partC = { loop: { start: 1, end: 3 } }

    await page.close()
    await daemon.close()

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL PHASE 27 STREAM EF CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error('\nPHASE 27 STREAM EF VERIFY FAILED:', err)
  process.exit(1)
})
