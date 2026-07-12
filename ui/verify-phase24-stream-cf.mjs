#!/usr/bin/env node
// Phase 24 Stream CF — clip view: show what notes are playing (ui/src/components/NoteView.tsx).
// Drives the REAL frontend headlessly against a REAL `beat daemon` (examples/night-shift.beat,
// whose "lead" track has notes at pitches 76,72,74,69,67,69,76 -> distinct pitches {67,69,72,74,76}
// = G4,A4,C5,D5,E5) and asserts the new `.note-name-readout` element actually renders the correct
// scientific-pitch-notation note NAMES, not just numeric MIDI pitch, both for the whole visible clip
// (nothing selected) and for the current selection (one note, then two).
//
//   W1 whole-clip readout   nothing selected -> readout shows every distinct pitch in the clip, in
//                            ascending order, comma-separated ("G4, A4, C5, D5, E5"), scope "whole clip".
//   W2 single selection      click note u100033 (pitch 76) -> readout narrows to "E5" only, scope
//                            "(1 selected)".
//   W3 multi selection        shift-click note u100034 (pitch 72) -> readout shows "C5, E5" (sorted
//                            ascending by pitch, not click order), scope "(2 selected)".
//   W4 selection cleared      tap empty grid space -> selection collapses -> readout reverts to the
//                            whole-clip list from W1.
//
// Usage: node ui/verify-phase24-stream-cf.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8924
const PREVIEW_PORT = 5924

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

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p24-cf-'))
  const beatPath = join(proj, 'night-shift.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical night-shift baseline')

  const daemon = await startDaemon({ filePath: beatPath, port: PORT })
  console.log(`daemon up on :${daemon.port}, project ${beatPath}`)
  const leadNotes = () => daemon.getDoc().tracks.find((t) => t.id === 'lead').notes

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
    await page.setViewportSize({ width: 1400, height: 900 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    await page.click('.arr-track-select:has(.arr-track-name:text-is("lead"))')
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    await page.waitForSelector('[data-testid="note-name-readout"]', { timeout: 5000 })
    await pollUntil(() => daemon.getDoc().selectedTrack === 'lead', 'lead selection to record')
    // The grid is taller than the viewport (piano-roll rows + velocity/chance lanes) — scroll the
    // notes we're about to click into view first, same as verify-phase19-piano-keys.mjs's K2.
    await page.locator('[data-note-id="u100033"]').scrollIntoViewIfNeeded()
    await sleep(150)

    const readoutText = () => page.locator('[data-testid="note-name-readout"] .note-name-readout-names').textContent()
    const readoutAttr = () => page.locator('[data-testid="note-name-readout"] .note-name-readout-names').getAttribute('data-note-names')
    const readoutFull = () => page.locator('[data-testid="note-name-readout"]').textContent()

    // sanity: confirm the fixture's actual distinct pitches match what this test hardcodes below.
    const distinctPitches = Array.from(new Set(leadNotes().map((n) => n.pitch))).sort((a, b) => a - b)
    console.log(`\nlead track distinct pitches: ${JSON.stringify(distinctPitches)}`)
    if (JSON.stringify(distinctPitches) !== JSON.stringify([67, 69, 72, 74, 76])) {
      throw new Error(`fixture drifted: expected lead distinct pitches [67,69,72,74,76], got ${JSON.stringify(distinctPitches)}`)
    }

    // ============ W1: whole-clip readout (nothing selected) ============
    const w1 = (await readoutText()).trim()
    const w1Attr = await readoutAttr()
    const w1Full = await readoutFull()
    console.log(`\n[W1] readout text: ${JSON.stringify(w1)}`)
    if (w1 !== 'G4, A4, C5, D5, E5') throw new Error(`[W1] expected "G4, A4, C5, D5, E5" for the whole clip, got ${JSON.stringify(w1)}`)
    if (w1Attr !== 'G4,A4,C5,D5,E5') throw new Error(`[W1] data-note-names attr expected "G4,A4,C5,D5,E5", got ${JSON.stringify(w1Attr)}`)
    if (!/whole clip/.test(w1Full)) throw new Error(`[W1] readout does not mention "whole clip" scope: ${JSON.stringify(w1Full)}`)
    console.log('[W1] PASS: whole-clip readout shows every distinct pitch as real note names, ascending, scoped "whole clip"')
    results.w1 = { text: w1, full: w1Full }

    // ============ W2: single-note selection narrows the readout ============
    const noteBox33 = await page.locator('[data-note-id="u100033"]').boundingBox() // pitch 76 = E5
    await page.mouse.click(noteBox33.x + noteBox33.width / 2, noteBox33.y + noteBox33.height / 2)
    await pollUntil(async () => (await page.evaluate(() => [...window.__store.getState().editNoteIds]))?.length === 1, 'single-note selection to register')
    await sleep(100)
    const w2 = (await readoutText()).trim()
    const w2Full = await readoutFull()
    console.log(`\n[W2] readout text after selecting u100033 (pitch 76): ${JSON.stringify(w2)}`)
    if (w2 !== 'E5') throw new Error(`[W2] expected "E5" for the single selected note (pitch 76), got ${JSON.stringify(w2)}`)
    if (!/1 selected/.test(w2Full)) throw new Error(`[W2] readout does not mention "1 selected" scope: ${JSON.stringify(w2Full)}`)
    console.log('[W2] PASS: selecting one note narrows the readout to that note\'s real name, scoped "1 selected"')
    results.w2 = { text: w2, full: w2Full }

    // ============ W3: shift-click a second note extends the selection ============
    await page.locator('[data-note-id="u100034"]').scrollIntoViewIfNeeded()
    await sleep(100)
    const noteBox34 = await page.locator('[data-note-id="u100034"]').boundingBox() // pitch 72 = C5
    await page.keyboard.down('Shift')
    await page.mouse.click(noteBox34.x + noteBox34.width / 2, noteBox34.y + noteBox34.height / 2)
    await page.keyboard.up('Shift')
    await pollUntil(async () => (await page.evaluate(() => [...window.__store.getState().editNoteIds]))?.length === 2, 'two-note selection to register')
    await sleep(100)
    const w3 = (await readoutText()).trim()
    const w3Full = await readoutFull()
    console.log(`\n[W3] readout text after shift-selecting u100034 (pitch 72) too: ${JSON.stringify(w3)}`)
    if (w3 !== 'C5, E5') throw new Error(`[W3] expected "C5, E5" (sorted by pitch, not click order) for the 2-note selection, got ${JSON.stringify(w3)}`)
    if (!/2 selected/.test(w3Full)) throw new Error(`[W3] readout does not mention "2 selected" scope: ${JSON.stringify(w3Full)}`)
    console.log('[W3] PASS: 2-note selection shows both real names, sorted ascending by pitch (not click order), scoped "2 selected"')
    results.w3 = { text: w3, full: w3Full }

    // ============ W4: clearing the selection reverts to the whole-clip list ============
    // A plain TAP on empty grid space adds a note (the existing click-to-add affordance — not what
    // we want here). A short DRAG (>3px) over empty space is a marquee that resolves to an empty
    // hit-set, clearing the selection without adding anything — use that instead.
    await page.$eval('.noteview-grid', (el) => el.scrollIntoView({ block: 'start' }))
    await sleep(100)
    const gridBox = await page.locator('.noteview-grid').boundingBox()
    const emptyX = gridBox.x + gridBox.width - 4
    const emptyY = gridBox.y + 4
    await page.mouse.move(emptyX, emptyY)
    await page.mouse.down()
    await page.mouse.move(emptyX - 10, emptyY + 10, { steps: 4 })
    await page.mouse.up()
    await pollUntil(async () => (await page.evaluate(() => [...window.__store.getState().editNoteIds]))?.length === 0, 'selection to clear')
    await sleep(150)
    const notesAfterClear = leadNotes().length
    if (notesAfterClear !== 7) throw new Error(`[W4] expected the drag-deselect to add no notes (still 7), got ${notesAfterClear}`)
    const w4 = (await readoutText()).trim()
    console.log(`\n[W4] readout text after clearing selection: ${JSON.stringify(w4)}`)
    if (w4 !== 'G4, A4, C5, D5, E5') throw new Error(`[W4] expected readout to revert to the whole-clip list after clearing selection, got ${JSON.stringify(w4)}`)
    console.log('[W4] PASS: clearing the selection reverts the readout to the whole clip\'s distinct note names')
    results.w4 = { text: w4 }

    await page.screenshot({ path: join(uiDir, 'verify-p24-cf-note-names.png') })
    console.log('\nscreenshot -> ui/verify-p24-cf-note-names.png')

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
