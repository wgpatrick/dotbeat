#!/usr/bin/env node
// Phase 30 Stream JC verification (docs/phase-30-plan.md JC, docs/research/89-usability-pilot-clip-
// editing.md). Drives the REAL frontend headlessly against a REAL `beat daemon` (the in-process
// startDaemon() the CLI's own `beat daemon` command calls) and a disposable scratch project copied
// from examples/night-shift.beat — never night-shift-song.beat, the owner's own live project, and
// never the checked-in night-shift.beat itself (only ever read, then copied to a temp dir).
//
// Four independent NoteView.tsx UX gaps pilot 89 found on the `lead` synth track's note editor:
//
//   JC1 ESCAPE-TO-DESELECT     click a note to select it, press Escape (no other control focused) ->
//                              selection clears to zero. Confirms it's a PURE deselect: no note
//                              added or removed (the note count before/after is identical) — Escape
//                              must not accidentally trigger the "click empty grid adds a note"
//                              behavior this item explicitly must NOT change.
//   JC2 PASTE OFFSET, NO PLAYHEAD   with transport stopped (currentStep === -1, the default before
//                              ever pressing play), copy a note and paste it. The new note must NOT
//                              land at the exact same pitch+start as the original (the old silent-
//                              stack bug) — it must land DEFAULT_DUR (2 steps, an eighth note) later,
//                              same pitch, a real and visible offset.
//   JC3 QUANTIZE ZERO FEEDBACK   night-shift.beat's `lead` notes are already 16th-grid-aligned (the
//                              exact fixture shape pilot 89 hit this bug against). Clicking Quantize
//                              at its own DEFAULT settings (grid=16ths, amount=100%, starts on/ends
//                              off — untouched dropdowns) against these already-aligned notes must
//                              show an explicit "0 notes changed" message, not silence.
//   JC4 TRANSFORM-OVERFLOW WARNING   select-all + click ×2 (time-scale) on the 7-note clip (4 bars =
//                              64 steps) pushes several notes' end times past step 64 (confirmed
//                              server-side, same as pilot 89's own repro) — a toast must appear
//                              warning about the loop-boundary overhang.
//
// Usage: node ui/verify-phase30-stream-jc.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir, platform } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5997 // distinct from other verify scripts' ports so concurrent runs never collide
const MOD = platform() === 'darwin' ? 'Meta' : 'Control' // same OS-aware modifier convention verify-phase17/26-dg use

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
function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg)
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))

  // Scratch project: a plain copy of the checked-in night-shift.beat fixture (never mutated in
  // place — read once here, written fresh into a disposable temp dir git repo).
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p30jc-'))
  const beatPath = join(proj, 'night-shift.beat')
  const baseline = readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')
  writeFileSync(beatPath, baseline)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical baseline')

  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  console.log(`daemon up on :${daemon.port}, project ${beatPath}`)
  const leadNotes = () => daemon.getDoc().tracks.find((t) => t.id === 'lead').notes
  const note = (id) => leadNotes().find((n) => n.id === id)

  // Fixture sanity: night-shift.beat's `lead` notes are all integer (whole-16th-step) starts, i.e.
  // already grid=1(16ths)-aligned — the exact precondition JC3's bug needs.
  const startingNotes = leadNotes()
  assert(startingNotes.length === 7, `fixture sanity: expected 7 starting lead notes, got ${startingNotes.length}`)
  for (const n of startingNotes) {
    assert(Number.isInteger(n.start), `fixture sanity: expected note ${n.id} start ${n.start} to already be 16th-grid-aligned (an integer)`)
  }
  const loopSteps = daemon.getDoc().loopBars * 16
  assert(loopSteps === 64, `fixture sanity: expected loopBars*16 === 64, got ${loopSteps}`)

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
    await page.$eval('.noteview-grid', (el) => el.scrollIntoView({ block: 'center' }))
    await sleep(150)

    const clearSel = () => page.evaluate(() => window.__store.getState().setEditNoteIds([]))
    const selIds = () => page.evaluate(() => [...window.__store.getState().editNoteIds].sort())
    const currentStep = () => page.evaluate(() => window.__store.getState().currentStep)

    async function selectNote(id) {
      await clearSel()
      await page.locator(`[data-note-id="${id}"]`).click()
      await pollUntil(async () => (await selIds()).join(',') === id, `selection = [${id}]`)
    }

    // ============ sanity: transport is stopped ============
    const step0 = await currentStep()
    assert(step0 === -1, `fixture sanity: expected currentStep === -1 (stopped) before ever pressing play, got ${step0}`)

    // ============ JC1: Escape-to-deselect ============
    console.log('\n[JC1] click a note to select it, press Escape -> selection clears, nothing added/removed')
    const countBeforeJC1 = leadNotes().length
    await selectNote('u100033')
    assert((await selIds()).length === 1, 'JC1 setup: expected exactly 1 note selected after clicking u100033')
    await page.keyboard.press('Escape')
    await pollUntil(async () => (await selIds()).length === 0, 'selection to clear after Escape', 3000)
    await sleep(150) // let any accidental add/remove reach the daemon before we check
    const countAfterJC1 = leadNotes().length
    assert(countAfterJC1 === countBeforeJC1, `[JC1] Escape must not add/remove notes: before=${countBeforeJC1}, after=${countAfterJC1}`)
    console.log(`[JC1] PASS: selection cleared via Escape, note count unchanged (${countAfterJC1})`)
    results.jc1 = { countBeforeJC1, countAfterJC1 }

    // ============ JC2: paste offset when there's no playhead ============
    console.log('\n[JC2] copy + paste with transport stopped -> new note offset, not an invisible exact stack')
    assert((await currentStep()) === -1, 'JC2 setup: transport must still be stopped')
    const beforeJC2 = { ...note('u100033') }
    await selectNote('u100033')
    await page.keyboard.press(`${MOD}+c`)
    await page.keyboard.press(`${MOD}+v`)
    await pollUntil(() => leadNotes().length === 8, 'a pasted 8th note to land on the daemon-side track', 5000)
    const pasted = leadNotes().find((n) => n.id !== beforeJC2.id && n.pitch === beforeJC2.pitch && Math.abs(n.start - beforeJC2.start) < 8)
    assert(pasted, `[JC2] could not find a freshly-pasted note near the original (pitch ${beforeJC2.pitch}, start ~${beforeJC2.start}) among ${JSON.stringify(leadNotes().map((n) => ({ id: n.id, start: n.start, pitch: n.pitch })))}`)
    assert(pasted.start !== beforeJC2.start, `[JC2] pasted note landed at the EXACT same start (${pasted.start}) as the original — the old silent-stack bug`)
    assert(pasted.start === beforeJC2.start + 2, `[JC2] expected the pasted note at start+2 (DEFAULT_DUR, an eighth note), got start=${pasted.start} (original ${beforeJC2.start})`)
    assert(pasted.pitch === beforeJC2.pitch, `[JC2] expected paste to preserve pitch (${beforeJC2.pitch}), got ${pasted.pitch}`)
    console.log(`[JC2] PASS: pasted note landed at start=${pasted.start} (original ${beforeJC2.start}, +2 steps), pitch unchanged (${pasted.pitch}) — a real, visible offset instead of an invisible stack`)
    results.jc2 = { before: beforeJC2, pasted }

    // ============ JC3: Quantize at default settings, already-aligned notes -> "0 notes changed" ============
    console.log('\n[JC3] Quantize at its own DEFAULT grid (16ths) against already-aligned notes -> explicit "0 notes changed"')
    await clearSel() // whole-track scope, exactly like a first-time user who never touches the dropdowns
    const gridNow = await page.locator('[data-pitch-time-input="quantize-grid"]').inputValue()
    assert(gridNow === '1', `[JC3] expected the Quantize grid dropdown to default to "1" (16ths), got "${gridNow}"`)
    const startsChecked = await page.locator('[data-pitch-time-input="quantize-starts"]').isChecked()
    const endsChecked = await page.locator('[data-pitch-time-input="quantize-ends"]').isChecked()
    assert(startsChecked && !endsChecked, `[JC3] expected default starts=on/ends=off, got starts=${startsChecked} ends=${endsChecked}`)
    const notesBeforeQuantize = JSON.stringify(leadNotes().map((n) => ({ id: n.id, start: n.start })).sort((a, b) => a.id.localeCompare(b.id)))
    await page.click('[data-pitch-time-op="quantize"]')
    await pollUntil(async () => {
      const t = await page.locator('[data-pitch-time-msg]').textContent()
      return t && t.trim().length > 0
    }, 'a Quantize confirmation message to appear', 5000)
    const quantizeMsg = (await page.locator('[data-pitch-time-msg]').textContent()).trim()
    assert(/^0 notes? changed$/.test(quantizeMsg), `[JC3] expected an explicit "0 notes changed" message at default settings, got "${quantizeMsg}"`)
    const notesAfterQuantize = JSON.stringify(leadNotes().map((n) => ({ id: n.id, start: n.start })).sort((a, b) => a.id.localeCompare(b.id)))
    assert(notesBeforeQuantize === notesAfterQuantize, '[JC3] Quantize at default settings against already-aligned notes must not actually move anything')
    console.log(`[JC3] PASS: panel shows "${quantizeMsg}" (not silence) for a genuine zero-op Quantize`)
    results.jc3 = { quantizeMsg }

    // ============ JC4: transform-overflow warning (×2 pushes notes past the clip's loop boundary) ============
    console.log('\n[JC4] select-all + ×2 pushes notes past the 64-step loop boundary -> a warning toast appears')
    await page.keyboard.press(`${MOD}+a`)
    await pollUntil(async () => (await selIds()).length === 8, 'select-all to select all 8 notes (7 original + JC2 paste)', 3000)
    const toastCountBefore = await page.locator('.toast').count()
    await page.click('[data-pitch-time-op="time-scale-2"]')
    await pollUntil(async () => {
      const t = await page.locator('[data-pitch-time-msg]').textContent()
      return t && /changed/.test(t)
    }, 'a ×2 confirmation message to appear', 5000)
    // Confirm server-side that this really did push content past the loop boundary — matching
    // pilot 89's own repro shape (checked the daemon's document, not just the screen).
    const overflowing = leadNotes().filter((n) => n.start + n.duration > loopSteps)
    assert(overflowing.length > 0, `[JC4] setup sanity: expected ×2 to push at least one note past ${loopSteps} steps, but none overflowed: ${JSON.stringify(leadNotes())}`)
    await pollUntil(async () => (await page.locator('.toast').count()) > toastCountBefore, 'a new toast to appear warning about the loop-boundary overhang', 5000)
    const toastText = await page.locator('.toast').last().textContent()
    assert(/loop|boundary|64.step/i.test(toastText), `[JC4] expected the toast to mention the loop/boundary overhang, got "${toastText}"`)
    console.log(`[JC4] PASS: ${overflowing.length} note(s) now overhang the ${loopSteps}-step loop (server-confirmed), toast reads: "${toastText.trim()}"`)
    results.jc4 = { overflowing: overflowing.map((n) => ({ id: n.id, start: n.start, duration: n.duration })), toastText: toastText.trim() }

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log(`\nALL PASS — Phase 30 Stream JC (Note editor UX gaps) verified live:`)
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
