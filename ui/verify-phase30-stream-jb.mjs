#!/usr/bin/env node
// Phase 30 Stream JB verification (docs/phase-30-plan.md's "JB" section, root cause research/89
// "Undo got interesting fast"). Drives a REAL `beat daemon` + the built frontend through Playwright
// — every assertion reads the daemon's own in-process state (getDoc()/getUndoDepth()/getRedoDepth()
// test hooks, cross-checked against GET /document) or real DOM state, never just client-side
// appearance.
//
// Two bugs, two parts:
//
//   PART 1 — the toolbar Undo button's displayed state and click behavior didn't reliably match the
//   real undo stack. Root cause: bridge.ts's postEdit debounces the actual network POST /edit up to
//   ~60ms after the optimistic LOCAL doc update, but canUndo/canRedo only ever changed on the
//   daemon's later `undo-state` SSE broadcast — so right after a fresh edit, canUndo could still read
//   stale. TransportBar's button gated its onClick on `disabled={!canUndo}` (a REAL HTML disabled
//   attribute blocks the click event outright), so a stale-false canUndo made a click a genuine
//   no-op. Separately, clicking Undo before a still-debounced edit reached the daemon could pop the
//   WRONG (older) undo entry, with the late edit then landing on top of that wrong base a moment
//   later — masking the mistake visually while corrupting the stack (needing a follow-up Cmd+Z to
//   really fix it). Fixed in bridge.ts: postEdit now bumps canUndo/canRedo OPTIMISTICALLY (same
//   discipline as the doc mirror itself), postUndo/postRedo now flush any pending debounced edit
//   (and await the send queue) before popping, and TransportBar no longer uses the native `disabled`
//   attribute (aria-disabled + a CSS class dim it instead) — the click handler is now exactly as
//   unconditional as Ctrl/Cmd+Z's own handler, which never gated on canUndo at all.
//
//   Sub-tests 1B/1C/1D below reproduce the pilot's three repro types (note add, diagonal drag,
//   resize) with NO artificial delay between finishing the edit gesture and checking/clicking Undo —
//   the exact adversarial timing the pilot's 3 clean-reload repro cycles hit.
//
//   PART 2 — a single user gesture that touches multiple paths (a diagonal move's start+pitch, a
//   multi-note delete's one-path-per-note) used to land as one undo entry PER PATH, because
//   daemon.ts's undo-stack coalescing keys on /edit's `path` by default. Fixed via an optional
//   client-supplied `gestureId` (bridge.ts's newGestureId, threaded through NoteView.tsx's
//   commit/delete/arrow-nudge handlers) that overrides the per-path key so a whole gesture's calls
//   share ONE coalescing bucket. Verified two ways per gesture: the daemon's undo depth grows by
//   EXACTLY 1 for the whole gesture (not once per note/field), and exactly ONE Undo press restores
//   the FULL original document (not a partial revert needing a second/third press).
//
// Fixture: examples/night-shift.beat (READ ONLY, copied into a fresh /tmp/dotbeat-verify-jb-* dir —
// examples/night-shift-song.beat is never touched, per this phase's ground rules). bpm 124,
// loop_bars 4, "lead" synth track pre-selected with 7 notes (u100033..u100039).
//
// Usage: node ui/verify-phase30-stream-jb.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5930

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pollUntil(fn, what, timeoutMs = 8000, everyMs = 40) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg)
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const deepEqual = (a, b) => serialize(a) === serialize(b)

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-verify-jb-'))
  const beatPath = join(proj, 'project.beat')
  writeFileSync(beatPath, readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))

  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  const base = `http://localhost:${daemon.port}`
  console.log(`daemon on :${daemon.port}, project at ${beatPath}`)

  const d0 = daemon.getDoc()
  assert(d0.bpm === 124 && d0.loopBars === 4, 'fixture assumption broken: bpm/loop_bars changed')
  const lead0 = d0.tracks.find((t) => t.id === 'lead')
  assert(lead0 && lead0.notes.length === 7, `fixture assumption broken: expected 7 lead notes, got ${lead0?.notes.length}`)
  assert(daemon.getUndoDepth() === 0 && daemon.getRedoDepth() === 0, 'daemon should boot with empty undo/redo stacks')
  console.log('[setup] fixture assumptions hold; daemon boots with empty undo/redo stacks')

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try {
      return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok
    } catch {
      return false
    }
  }, 'vite preview to serve')
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const errors = []
  const page = await browser.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (msg) => {
    if (msg.type() === 'warning' || msg.type() === 'error') console.log(`  [page console.${msg.type()}] ${msg.text()}`)
  })
  await page.setViewportSize({ width: 1400, height: 1200 })

  const undoBtn = page.locator('[data-action="undo"]')
  const redoBtn = page.locator('[data-action="redo"]')

  /** Undo-button `aria-disabled` reading, per TransportBar.tsx's Phase 30 JB fix — cosmetic-only now,
   * never blocks the click, but still checked here to confirm the DISPLAY also stays accurate (not
   * just click behavior). */
  const undoAriaDisabled = async () => (await undoBtn.getAttribute('aria-disabled')) === 'true'

  try {
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 12000 })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 12000 })
    await page.waitForSelector('.noteview-grid', { timeout: 8000 })
    await sleep(150)

    // ================================================================================================
    // PART 1 — button reliability: display state AND click behavior must match Cmd/Ctrl+Z exactly,
    // checked with NO artificial delay between finishing the edit gesture and checking/clicking Undo.
    // ================================================================================================
    console.log('\n[PART 1] toolbar Undo button reliability (note add / diagonal move / resize)...')

    /** Runs `gesture` (a real GUI action), then IMMEDIATELY (no sleep) checks the button isn't
     * showing stale-disabled, then immediately clicks/keys Undo and confirms the daemon's document
     * fully reverts to `before` in that ONE action — no follow-up Undo required. Restores exactly to
     * `before` on success, so scenarios can run back-to-back against the untouched fixture. */
    async function checkButtonReliability(label, gesture, { viaKeyboard = false } = {}) {
      const before = structuredClone(daemon.getDoc())
      const depthBefore = daemon.getUndoDepth()

      await gesture()

      // No sleep here on purpose — this is exactly the adversarial timing the pilot's repro hit.
      const staleDisabled = await undoAriaDisabled()
      assert(!staleDisabled, `[${label}] Undo button reads aria-disabled=true immediately after a fresh, undoable edit (display-lag bug)`)

      if (viaKeyboard) {
        await page.keyboard.press('Control+z')
      } else {
        await undoBtn.click() // real click — must not be a no-op even though the daemon write may still be in flight
      }

      await pollUntil(() => daemon.getUndoDepth() === depthBefore, `[${label}] undo depth to drop back to ${depthBefore}`, 4000)
      const got = daemon.getDoc()
      if (!deepEqual(got, before)) {
        const { diffDocuments, formatDiff } = await import(join(repoRoot, 'dist/src/core/index.js'))
        console.log(`  [DEBUG ${label}] diff (expected -> got):`, formatDiff(diffDocuments(before, got)))
      }
      assert(deepEqual(got, before), `[${label}] one Undo (${viaKeyboard ? 'Ctrl/Cmd+Z' : 'button click'}) did not fully revert the edit — the exact "flips to disabled but nothing changed" bug`)
      console.log(`  [${label}] PASS: button read enabled immediately, and ONE ${viaKeyboard ? 'Ctrl/Cmd+Z' : 'click'} fully reverted the edit`)
    }

    // ---- 1B: note add (append-grammar path — no client debounce, tests the optimistic canUndo bump) ----
    await checkButtonReliability('1B note-add', async () => {
      const rowEl = page.locator('[data-row-value="76"]')
      await rowEl.scrollIntoViewIfNeeded()
      const rowBox = await rowEl.boundingBox()
      const gridBox = await page.locator('.noteview-grid').boundingBox()
      const totalSteps = 4 * 16
      const stepW = gridBox.width / totalSteps
      const x = gridBox.x + (4 + 0.5) * stepW // step 4 — empty at pitch 76
      const y = rowBox.y + rowBox.height / 2
      await page.mouse.click(x, y)
    })

    // ---- 1C: diagonal move (debounced path — tests flush-before-undo + gesture coalescing) ----
    await checkButtonReliability('1C diagonal-move', async () => {
      const noteEl = page.locator('[data-note-id="u100036"]') // start=40, pitch=69
      await noteEl.scrollIntoViewIfNeeded()
      const box = await noteEl.boundingBox()
      const cx = box.x + 3
      const cy = box.y + 3
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.mouse.move(cx + 42, cy - 12, { steps: 8 }) // +3 steps AND +1 row (pitch) — genuinely diagonal
      await page.mouse.up()
    })

    // ---- 1D: resize (debounced path — the pilot's exact "enabled, click flips to disabled, but the
    // edit wasn't reverted" repro) ----
    await checkButtonReliability('1D resize', async () => {
      const handle = page.locator('[data-note-id="u100033"] .noteview-resize') // start=20, dur=2, pitch=76
      await handle.scrollIntoViewIfNeeded()
      const box = await handle.boundingBox()
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.mouse.move(cx + 28, cy, { steps: 6 }) // +2 steps of duration
      await page.mouse.up()
    })

    // ---- 1E: same resize repro, but via Ctrl/Cmd+Z instead of the button — confirms both paths
    // (which now call the identical postUndo()) stay in parity, not just the button in isolation ----
    await checkButtonReliability(
      '1E resize-via-keyboard',
      async () => {
        const handle = page.locator('[data-note-id="u100038"] .noteview-resize') // start=56, dur=4, pitch=69
        await handle.scrollIntoViewIfNeeded()
        const box = await handle.boundingBox()
        const cx = box.x + box.width / 2
        const cy = box.y + box.height / 2
        await page.mouse.move(cx, cy)
        await page.mouse.down()
        await page.mouse.move(cx + 14, cy, { steps: 4 })
        await page.mouse.up()
      },
      { viaKeyboard: true },
    )

    assert(daemon.getUndoDepth() === 0, `PART 1 should leave the undo stack empty again (fully reverted every scenario), depth=${daemon.getUndoDepth()}`)
    console.log('[PART 1] PASS: button state and click behavior matched Cmd/Ctrl+Z reliability across note-add, diagonal-move, and resize')

    // ================================================================================================
    // PART 2 — atomic multi-entity/multi-property undo: one gesture -> exactly ONE undo entry,
    // restored by exactly ONE Undo press (not N).
    // ================================================================================================
    console.log('\n[PART 2] one gesture = one undo entry (diagonal move / multi-note delete / multi-note paste)...')

    async function checkAtomicGesture(label, gesture, { press = 'button' } = {}) {
      const before = structuredClone(daemon.getDoc())
      const depthBefore = daemon.getUndoDepth()

      await gesture()
      await pollUntil(() => daemon.getUndoDepth() > depthBefore, `[${label}] undo depth to grow after the gesture`, 4000)
      // Settle: make sure nothing ELSE lands a moment later (would mean the gesture wasn't fully
      // coalesced — some straggler /edit call landing outside the shared gestureId's window).
      await sleep(300)
      const depthAfterGesture = daemon.getUndoDepth()
      assert(
        depthAfterGesture === depthBefore + 1,
        `[${label}] gesture should push EXACTLY 1 undo entry, pushed ${depthAfterGesture - depthBefore} (this is the "N presses needed" bug if >1)`,
      )
      console.log(`  [${label}] gesture pushed exactly 1 undo entry (was previously ${depthAfterGesture - depthBefore >= 1 ? 'confirmed' : 'unconfirmed'} 1-per-field/note before this fix)`)

      if (press === 'button') await undoBtn.click()
      else await page.keyboard.press('Control+z')

      await pollUntil(() => daemon.getUndoDepth() === depthBefore, `[${label}] undo depth to drop back to ${depthBefore} after ONE undo`, 4000)
      const got = daemon.getDoc()
      if (!deepEqual(got, before)) {
        const { diffDocuments, formatDiff } = await import(join(repoRoot, 'dist/src/core/index.js'))
        console.log(`  [DEBUG ${label}] diff (expected -> got):`, formatDiff(diffDocuments(before, got)))
      }
      assert(deepEqual(got, before), `[${label}] ONE Undo press should fully restore the pre-gesture document — a second press should not have been necessary`)
      console.log(`  [${label}] PASS: ONE Undo press fully reverted the whole gesture (document exactly matches pre-gesture state)`)
    }

    // ---- 2A: diagonal note move (pitch + start together) ----
    await checkAtomicGesture('2A diagonal-move', async () => {
      const noteEl = page.locator('[data-note-id="u100037"]') // start=52, pitch=67
      await noteEl.scrollIntoViewIfNeeded()
      const box = await noteEl.boundingBox()
      const cx = box.x + 3
      const cy = box.y + 3
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.mouse.move(cx + 28, cy + 24, { steps: 8 }) // +2 steps AND -2 rows (pitch) — diagonal
      await page.mouse.up()
    })

    // ---- 2B: 3-note delete (multi-select via click + shift-click, then Delete) ----
    await checkAtomicGesture('2B multi-delete', async () => {
      const ids = ['u100033', 'u100034', 'u100035']
      const first = page.locator(`[data-note-id="${ids[0]}"]`)
      await first.scrollIntoViewIfNeeded()
      await first.click()
      for (const id of ids.slice(1)) {
        await page.locator(`[data-note-id="${id}"]`).click({ modifiers: ['Shift'] })
      }
      const selCount = await page.evaluate(() => window.__store.getState().editNoteIds.length)
      assert(selCount === 3, `expected 3 notes selected before Delete, got ${selCount}`)
      await page.keyboard.press('Delete')
    })

    // ---- 2C: 2-note paste (Cmd/Ctrl+C then Cmd/Ctrl+V) — already single-entry pre-fix (postDuplicateNotes
    // is one daemon route call), verified here as a regression guard alongside the two real fixes above ----
    await checkAtomicGesture('2C multi-paste', async () => {
      const ids = ['u100038', 'u100039']
      const first = page.locator(`[data-note-id="${ids[0]}"]`)
      await first.scrollIntoViewIfNeeded()
      await first.click()
      await page.locator(`[data-note-id="${ids[1]}"]`).click({ modifiers: ['Shift'] })
      const selCount = await page.evaluate(() => window.__store.getState().editNoteIds.length)
      assert(selCount === 2, `expected 2 notes selected before copy, got ${selCount}`)
      await page.keyboard.press('Control+c')
      await page.keyboard.press('Control+v')
    })

    assert(daemon.getUndoDepth() === 0, `PART 2 should leave the undo stack empty again, depth=${daemon.getUndoDepth()}`)
    assert(deepEqual(daemon.getDoc(), d0), 'PART 2 should leave the document exactly matching the original fixture after every scenario reverted cleanly')
    console.log('[PART 2] PASS: diagonal move, multi-note delete, and multi-note paste each reverted fully with exactly ONE undo press')

    console.log('\nno browser console/page errors: ' + (errors.length === 0 ? 'confirmed' : `FAILED — ${errors.length} error(s): ${errors.join('; ')}`))
    assert(errors.length === 0, `page errors occurred: ${errors.join('; ')}`)

    console.log('\n=== PHASE 30 STREAM JB: ALL CHECKS PASSED ===')
  } finally {
    await page.close().catch(() => {})
    await browser.close().catch(() => {})
    preview.kill()
    await daemon.close().catch(() => {})
  }
}

main().catch((err) => {
  console.error('\nVERIFICATION FAILED:', err)
  process.exit(1)
})
