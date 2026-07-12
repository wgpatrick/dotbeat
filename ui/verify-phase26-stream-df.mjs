#!/usr/bin/env node
// Phase 26 Stream DF — GUI affordance for Quantize (docs/phase-26-plan.md; research 57 §2 item 1,
// "the single cheapest, highest-value item" in the whole Ableton-comparison shortlist).
//
// quantizeNotes (src/core/edit.ts:390-466) was already fully wired through `beat quantize`/
// `beat_quantize` and had a working daemon route precedent (POST /pitch-time, Phase 23 Stream BA),
// but NoteView.tsx had zero GUI affordance for it — no button, no panel control. This stream adds a
// Quantize control group to PitchTimePanel (grid-size dropdown, amount slider 0-100%, starts/ends
// checkboxes) wired through the SAME /pitch-time route (a new `quantize` op alongside transpose/
// timeScale/fitToScale/invert/reverse/legato/consolidate) — no new core primitive, no format change.
//
// Verification strategy (the whole point of this script): don't just assert the GUI click did
// *something* — cross-check the GUI path against the CLI path for the IDENTICAL input. Two
// identical project copies start from the same canonical baseline (night-shift.beat + 3 freshly
// added, deliberately off-grid notes). One copy is quantized via the new GUI control (real
// Playwright clicks against a real daemon + built frontend); the other via `beat quantize` directly
// on disk with the same grid/amount/starts/ends/notes parameters. Both write through the same core
// `serialize()`, so if the GUI path is wired correctly the two resulting .beat files must be BYTE
// IDENTICAL — the strongest possible cross-check, no hand-computed expected values needed.
//
//   DF1 GUI CONTROLS PRESENT   the Quantize control group renders inside PitchTimePanel: grid
//                              select, amount range slider, starts/ends checkboxes, Quantize button.
//   DF2 GUI QUANTIZE, SCOPED   select 2 of 3 off-grid notes (q1, q2 — leave q3 unselected), set
//                              grid=8ths, amount=50%, check "ends", click Quantize -> daemon reports
//                              "2 notes changed"; q3 (unselected) is byte-for-byte untouched.
//   DF3 GUI == CLI             the resulting .beat file from the GUI path is byte-identical to the
//                              file produced by `beat quantize <file> lead --grid 2 --amount 0.5
//                              --ends --notes q1,q2` run directly against an identical starting
//                              copy — same grid/amount/starts/ends/notes as the GUI action.
//   DF4 PARTIAL AMOUNT         q1/q2 moved only PART of the way to the grid (amount=0.5, not a full
//                              snap) — confirms the amount slider actually reaches quantizeNotes'
//                              partial-blend semantics, not just a hardcoded full snap.
//
// Usage: node ui/verify-phase26-stream-df.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8924
const PREVIEW_PORT = 5935

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

let checks = 0
function ok(label) {
  checks++
  console.log(`  ok — ${label}`)
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { addNote } = await import(join(repoRoot, 'dist/src/core/edit.js'))

  // Build the shared starting document: canonical night-shift.beat + 3 deliberately off-grid notes
  // on `lead` (grid=2 means 8th-note steps; none of q1/q2/q3's starts sit on an even integer).
  let baseDoc = parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))
  baseDoc = addNote(baseDoc, 'lead', { id: 'q1', pitch: 60, start: 5.25, duration: 1.5, velocity: 0.5 }).doc
  baseDoc = addNote(baseDoc, 'lead', { id: 'q2', pitch: 62, start: 9.75, duration: 1.75, velocity: 0.55 }).doc
  baseDoc = addNote(baseDoc, 'lead', { id: 'q3', pitch: 64, start: 13.4, duration: 1.2, velocity: 0.6 }).doc
  const baseline = serialize(baseDoc)
  // sanity: none of the 3 new notes should already sit on a grid=2 boundary (or the "off-grid"
  // premise of this whole test is broken)
  for (const [id, start] of [['q1', 5.25], ['q2', 9.75], ['q3', 13.4]]) {
    if (start % 2 === 0) throw new Error(`fixture bug: ${id} start ${start} is already on the grid=2 boundary`)
  }

  // Two identical project copies: A gets quantized via the GUI, B via the CLI, same parameters.
  const projA = mkdtempSync(join(tmpdir(), 'dotbeat-p26df-gui-'))
  const projB = mkdtempSync(join(tmpdir(), 'dotbeat-p26df-cli-'))
  const beatA = join(projA, 'night-shift.beat')
  const beatB = join(projB, 'night-shift.beat')
  writeFileSync(beatA, baseline)
  writeFileSync(beatB, baseline)
  for (const proj of [projA, projB]) {
    git(proj, 'init', '-q')
    git(proj, 'config', 'user.email', 'verify@dotbeat.local')
    git(proj, 'config', 'user.name', 'verify')
    git(proj, 'add', '-A')
    git(proj, 'commit', '-q', '-m', 'baseline + 3 off-grid notes')
  }

  const daemon = await startDaemon({ filePath: beatA, port: PORT })
  console.log(`daemon up on :${daemon.port}, project ${beatA}`)
  const readBeatA = () => readFileSync(beatA, 'utf8')
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
    await page.waitForSelector('.pitch-time-panel', { timeout: 5000 })
    await pollUntil(() => daemon.getDoc().selectedTrack === 'lead', 'lead selection to record')
    await pollUntil(() => note('q1') && note('q2') && note('q3'), 'q1/q2/q3 to be present in the loaded doc')
    await page.$eval('.noteview-grid', (el) => el.scrollIntoView({ block: 'center' }))
    await sleep(150)

    const clearSel = () => page.evaluate(() => window.__store.getState().setEditNoteIds([]))
    const selIds = () => page.evaluate(() => [...window.__store.getState().editNoteIds].sort())

    async function selectNote(id) {
      await clearSel()
      await page.locator(`[data-note-id="${id}"]`).click()
      await pollUntil(async () => (await selIds()).join(',') === id, `selection = [${id}]`)
    }
    async function shiftSelectNote(id) {
      await page.locator(`[data-note-id="${id}"]`).click({ modifiers: ['Shift'] })
    }

    // Set a native <input type="range">'s value the React-safe way: Playwright's `fill()` refuses
    // range inputs outright, and a plain `el.value = x` write is swallowed by React's controlled-
    // input value tracker unless it goes through the native property setter first.
    async function setRangeValue(selector, value) {
      await page.locator(selector).evaluate((el, v) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(el, String(v))
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }, value)
    }

    // ============ DF1: Quantize control group renders ============
    console.log('\n[DF1] Quantize control group present in PitchTimePanel')
    await page.waitForSelector('[data-pitch-time-input="quantize-grid"]', { timeout: 3000 })
    await page.waitForSelector('[data-pitch-time-input="quantize-amount"]', { timeout: 3000 })
    await page.waitForSelector('[data-pitch-time-input="quantize-starts"]', { timeout: 3000 })
    await page.waitForSelector('[data-pitch-time-input="quantize-ends"]', { timeout: 3000 })
    await page.waitForSelector('[data-pitch-time-op="quantize"]', { timeout: 3000 })
    const gridOptions = await page.locator('[data-pitch-time-input="quantize-grid"] option').allTextContents()
    if (!['32nds', '16ths', '8ths', 'quarters'].every((g) => gridOptions.includes(g))) {
      throw new Error(`[DF1] expected grid options 32nds/16ths/8ths/quarters, got ${JSON.stringify(gridOptions)}`)
    }
    const startsChecked0 = await page.locator('[data-pitch-time-input="quantize-starts"]').isChecked()
    const endsChecked0 = await page.locator('[data-pitch-time-input="quantize-ends"]').isChecked()
    if (!startsChecked0) throw new Error('[DF1] expected starts checkbox to default checked (matches quantizeNotes default)')
    if (endsChecked0) throw new Error('[DF1] expected ends checkbox to default UNchecked (matches quantizeNotes default)')
    console.log(`[DF1] PASS: grid dropdown (${gridOptions.join('/')}), amount slider, starts/ends checkboxes (starts=${startsChecked0}, ends=${endsChecked0}), Quantize button all present`)
    results.df1 = { gridOptions, startsChecked0, endsChecked0 }

    // ============ DF2: GUI quantize, scoped to q1+q2 (q3 left unselected) ============
    console.log('\n[DF2] GUI quantize: select q1+q2, grid=8ths, amount=50%, ends=on, click Quantize')
    const beforeQ1 = { ...note('q1') }
    const beforeQ2 = { ...note('q2') }
    const beforeQ3Line = readBeatA()
      .split('\n')
      .find((l) => l.trim().startsWith('note q3 '))
    await selectNote('q1')
    await shiftSelectNote('q2')
    await pollUntil(async () => (await selIds()).join(',') === 'q1,q2', 'selection = [q1,q2]')
    // .pitch-time-scope also appears in the NoteNameReadout component just below the panel
    // (Phase 24 Stream CF) — scope to the PitchTimePanel's own copy specifically.
    const scopeText = await page.locator('.pitch-time-panel .pitch-time-scope').textContent()
    if (!/2 notes selected/.test(scopeText)) throw new Error(`[DF2] expected scope label "2 notes selected", got "${scopeText}"`)

    await page.selectOption('[data-pitch-time-input="quantize-grid"]', '2') // 8ths
    await setRangeValue('[data-pitch-time-input="quantize-amount"]', 50)
    await pollUntil(async () => (await page.locator('[data-pitch-time-amount-readout]').textContent()) === '50%', 'amount readout -> 50%')
    await page.click('[data-pitch-time-input="quantize-ends"]') // turn ends ON (starts stays on)
    const endsCheckedNow = await page.locator('[data-pitch-time-input="quantize-ends"]').isChecked()
    if (!endsCheckedNow) throw new Error('[DF2] expected ends checkbox to be checked after clicking it')

    await page.click('[data-pitch-time-op="quantize"]')
    await pollUntil(() => note('q1').start !== beforeQ1.start || note('q1').duration !== beforeQ1.duration, 'q1 to change after Quantize click')
    const msg = await page.locator('[data-pitch-time-msg]').textContent()
    if (!/2 notes changed/.test(msg)) throw new Error(`[DF2] expected "2 notes changed", got "${msg}"`)
    const afterQ3Line = readBeatA()
      .split('\n')
      .find((l) => l.trim().startsWith('note q3 '))
    if (afterQ3Line !== beforeQ3Line) throw new Error(`[DF2] q3 (unselected) should be byte-for-byte untouched:\n  before: ${beforeQ3Line}\n  after:  ${afterQ3Line}`)
    console.log(`[DF2] PASS: panel reported "${msg}"; q3 (not selected) untouched on disk`)
    results.df2 = { msg, beforeQ1, beforeQ2, afterQ1: note('q1'), afterQ2: note('q2') }

    // ============ DF4: partial amount — q1/q2 moved PART of the way, not a full snap ============
    console.log('\n[DF4] amount=50% should be a PARTIAL snap, not a full snap to the grid=2 line')
    const afterQ1 = note('q1')
    const afterQ2 = note('q2')
    const fullSnapQ1 = Math.round(beforeQ1.start / 2) * 2
    const fullSnapQ2 = Math.round(beforeQ2.start / 2) * 2
    if (afterQ1.start === fullSnapQ1) throw new Error(`[DF4] q1 start ${afterQ1.start} looks like a FULL snap to ${fullSnapQ1} — amount slider isn't reaching quantizeNotes as a partial blend`)
    if (afterQ2.start === fullSnapQ2) throw new Error(`[DF4] q2 start ${afterQ2.start} looks like a FULL snap to ${fullSnapQ2} — amount slider isn't reaching quantizeNotes as a partial blend`)
    if (afterQ1.start === beforeQ1.start) throw new Error('[DF4] q1 start did not move at all')
    console.log(`[DF4] PASS: q1 start ${beforeQ1.start} -> ${afterQ1.start} (nearest grid line ${fullSnapQ1}, not fully snapped); q2 start ${beforeQ2.start} -> ${afterQ2.start} (nearest grid line ${fullSnapQ2})`)
    results.df4 = { fullSnapQ1, fullSnapQ2 }

    // ============ DF3: GUI result == CLI result for the identical operation ============
    console.log('\n[DF3] cross-check: GUI path vs `beat quantize` CLI path, identical params')
    execFileSync(
      'node',
      [join(repoRoot, 'cli/beat.mjs'), 'quantize', beatB, 'lead', '--grid', '2', '--amount', '0.5', '--ends', '--notes', 'q1,q2'],
      { cwd: repoRoot, stdio: 'pipe' },
    )
    const textA = readBeatA()
    const textB = readFileSync(beatB, 'utf8')
    if (textA !== textB) {
      // Show the first differing line to make a failure diagnosable without a full dump.
      const linesA = textA.split('\n')
      const linesB = textB.split('\n')
      let firstDiff = -1
      for (let i = 0; i < Math.max(linesA.length, linesB.length); i++) {
        if (linesA[i] !== linesB[i]) {
          firstDiff = i
          break
        }
      }
      throw new Error(`[DF3] GUI-produced file != CLI-produced file at line ${firstDiff}:\n  GUI: ${linesA[firstDiff]}\n  CLI: ${linesB[firstDiff]}`)
    }
    console.log('[DF3] PASS: GUI-produced .beat file is byte-identical to the CLI-produced one (same grid=2, amount=0.5, starts=true, ends=true, notes=q1,q2)')
    results.df3 = { bytesEqual: true, length: textA.length }

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log(`\nALL PASS — Phase 26 Stream DF (GUI affordance for Quantize) verified live:`)
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
