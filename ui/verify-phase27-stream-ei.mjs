#!/usr/bin/env node
// Phase 27 Stream EI verification — Knob.tsx click-to-type numeric value entry (docs/phase-27-plan.md
// Stream EI, docs/research/72-ux-device-view.md §2.3/§3 item 3). Drives the REAL frontend headlessly
// against a REAL `beat daemon` (same in-process startDaemon() the CLI's own `beat daemon` command
// calls) and a disposable COPY of examples/night-shift.beat in a temp dir — never the owner's own
// examples/night-shift-song.beat.
//
// Target knob: the "lead" synth track's Filter & Envelope group, Cutoff param
// (`synthParams.ts`: k('cutoff', 'Cutoff', 20, 18000, fmt.hz, true) — log scale, real min/max, a
// starting value of 5200 straight from the fixture file) — plus a second, LINEAR knob (Resonance,
// min 0 / max 20) used only for the drag-gesture regression check.
//
//   EI1  CLICK REVEALS EDITABLE INPUT     click `.knob-value-display` -> a real `.knob-value-input`
//        appears, pre-filled with the current numeric value (plain "5200", not the unit-suffixed
//        "5.2k" display string), focused.
//   EI2  ENTER COMMITS A VALID VALUE      type "1200", press Enter -> input disappears, the daemon's
//        live document AND the on-disk git diff both show cutoff=1200 exactly, display re-renders
//        "1.2k".
//   EI3  OUT-OF-RANGE HIGH CLAMPS         type "999999" (way above max 18000), Enter -> commits
//        18000 (the boundary), never the raw typed number.
//   EI4  OUT-OF-RANGE LOW CLAMPS          type "1" (below min 20, and log-scale can't tolerate <=0
//        anyway), Enter -> commits 20 (the boundary).
//   EI5  ESCAPE CANCELS                   open the editor, type a new value, press Escape -> input
//        disappears, display reverts to the pre-edit value, the daemon document AND git diff show
//        NO change at all.
//   EI6  DRAG REGRESSION                  the ORIGINAL pointer-drag gesture (unrelated Resonance
//        knob, linear scale) still resolves to the exact `fromNorm` value the drag math has always
//        produced — proves EI's edits to Knob.tsx didn't disturb the pre-existing drag path.
//
// Usage: node ui/verify-phase27-stream-ei.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5981 // distinct from other verify scripts' ports so concurrent runs never collide

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
function assertClose(a, b, msg, eps = 1e-3) {
  assert(Math.abs(a - b) <= eps, `${msg} (${a} vs ${b}, diff ${Math.abs(a - b)})`)
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p27ei-'))
  const beatPath = join(proj, 'night-shift.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical night-shift baseline')

  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  console.log(`daemon up on :${daemon.port}, project ${beatPath}`)
  const leadSynth = () => daemon.getDoc().tracks.find((t) => t.id === 'lead').synth
  const diffLines = () => {
    const diff = git(proj, 'diff', '--unified=0', 'night-shift.beat')
    return {
      diff,
      added: diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')),
      removed: diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')),
    }
  }
  const commit = (msg) => {
    try {
      git(proj, 'commit', '-q', '-am', msg)
    } catch (err) {
      if (!String(err.stdout || '').includes('nothing to commit')) throw err
    }
  }

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

    await page.click('[data-pane-tab="device"]')
    await page.waitForSelector('.synth-panel', { timeout: 5000 })
    await pollUntil(() => daemon.getDoc().selectedTrack === 'lead', 'lead to be the selected track (fixture default)')

    const cutoffKnob = page.locator('[data-param-group="filter"] .knob:has(.knob-label:text-is("Cutoff"))')
    const cutoffDisplay = cutoffKnob.locator('.knob-value-display')
    const cutoffInput = cutoffKnob.locator('.knob-value-input')
    await cutoffKnob.scrollIntoViewIfNeeded()

    assert(leadSynth().cutoff === 5200, `fixture sanity: expected lead.cutoff=5200 in the source file, got ${leadSynth().cutoff}`)
    const initialText = await cutoffDisplay.textContent()
    assert(initialText === '5.2k', `expected initial Cutoff display "5.2k" (fmt.hz(5200)), got "${initialText}"`)
    console.log(`[setup] PASS: Cutoff knob starts at 5200 ("${initialText}")`)

    // ============ EI1: click reveals a real editable input, pre-filled with the numeric value ============
    console.log('\n[EI1] click .knob-value-display -> editable input pre-filled with 5200, focused')
    await cutoffDisplay.click()
    await cutoffInput.waitFor({ state: 'visible', timeout: 3000 })
    const prefill1 = await cutoffInput.inputValue()
    assert(prefill1 === '5200', `expected input pre-filled with plain "5200" (not the unit-suffixed display string), got "${prefill1}"`)
    const isFocused1 = await cutoffInput.evaluate((el) => el === document.activeElement)
    assert(isFocused1, 'the revealed input must be focused')
    assert((await cutoffDisplay.count()) === 0, 'the static .knob-value-display must be replaced, not just overlaid, while editing')
    console.log(`[EI1] PASS: input revealed, pre-filled "${prefill1}", focused`)
    results.ei1 = { prefill: prefill1, focused: isFocused1 }

    // ============ EI2: Enter commits a valid typed value through the same onChange the drag uses ============
    console.log('\n[EI2] type "1200", press Enter -> commits via onChange, same as a drag would')
    await cutoffInput.fill('1200')
    await cutoffInput.press('Enter')
    await pollUntil(() => leadSynth().cutoff === 1200, 'daemon document to show cutoff=1200 after Enter-commit')
    await sleep(150)
    assert((await cutoffInput.count()) === 0, 'input must disappear after commit')
    const text2 = await cutoffDisplay.textContent()
    assert(text2 === '1.2k', `expected display to re-render "1.2k" (fmt.hz(1200)) after commit, got "${text2}"`)
    const d2 = diffLines()
    console.log(`[EI2] diff (unified=0):\n${d2.diff}`)
    assert(d2.added.length === 1 && d2.removed.length === 1, `expected exactly 1 changed line in the .beat diff, got +${d2.added.length} -${d2.removed.length}`)
    assert(/\bcutoff 1200\b/.test(d2.diff), `expected the .beat diff to show literal "cutoff 1200", got:\n${d2.diff}`)
    console.log('[EI2] PASS: typed "1200" -> committed exactly, .beat diff shows "cutoff 1200", display updated')
    results.ei2 = { docCutoff: leadSynth().cutoff, diff: d2.diff }
    commit('gui: click-to-type cutoff = 1200')

    // ============ EI3: out-of-range HIGH clamps to max, does not accept the raw number ============
    console.log('\n[EI3] type "999999" (>> max 18000), Enter -> clamps to 18000')
    await cutoffDisplay.click()
    const prefill3 = await cutoffInput.inputValue()
    assert(prefill3 === '1200', `expected input pre-filled with "1200" (the current value), got "${prefill3}"`)
    await cutoffInput.fill('999999')
    await cutoffInput.press('Enter')
    await pollUntil(() => leadSynth().cutoff === 18000, 'daemon document to clamp cutoff to max 18000')
    await sleep(150)
    assert(leadSynth().cutoff === 18000, `expected clamped cutoff=18000 (max), got ${leadSynth().cutoff} — a typed out-of-range value must NOT be accepted raw`)
    const text3 = await cutoffDisplay.textContent()
    assert(text3 === '18k', `expected display "18k" (fmt.hz(18000)) after high clamp, got "${text3}"`)
    const d3 = diffLines()
    assert(/\bcutoff 18000\b/.test(d3.diff), `expected the .beat diff to show the CLAMPED "cutoff 18000", not the raw typed 999999, got:\n${d3.diff}`)
    console.log('[EI3] PASS: "999999" clamped to boundary max 18000, not accepted raw')
    results.ei3 = { docCutoff: leadSynth().cutoff, diff: d3.diff }
    commit('gui: click-to-type cutoff over-range clamps to max')

    // ============ EI4: out-of-range LOW clamps to min ============
    console.log('\n[EI4] type "1" (< min 20), Enter -> clamps to 20')
    await cutoffDisplay.click()
    const prefill4 = await cutoffInput.inputValue()
    assert(prefill4 === '18000', `expected input pre-filled with "18000" (the current value), got "${prefill4}"`)
    await cutoffInput.fill('1')
    await cutoffInput.press('Enter')
    await pollUntil(() => leadSynth().cutoff === 20, 'daemon document to clamp cutoff to min 20')
    await sleep(150)
    assert(leadSynth().cutoff === 20, `expected clamped cutoff=20 (min), got ${leadSynth().cutoff}`)
    const text4 = await cutoffDisplay.textContent()
    assert(text4 === '20', `expected display "20" (fmt.hz(20)) after low clamp, got "${text4}"`)
    const d4 = diffLines()
    assert(/\bcutoff 20\b/.test(d4.diff), `expected the .beat diff to show the CLAMPED "cutoff 20", not the raw typed 1, got:\n${d4.diff}`)
    console.log('[EI4] PASS: "1" clamped to boundary min 20, not accepted raw')
    results.ei4 = { docCutoff: leadSynth().cutoff, diff: d4.diff }
    commit('gui: click-to-type cutoff under-range clamps to min')

    // ============ EI5: Escape cancels — reverts display, commits nothing ============
    console.log('\n[EI5] open editor, type "9999", press Escape -> no commit, value/document unchanged')
    const beforeEscapeCutoff = leadSynth().cutoff
    await cutoffDisplay.click()
    await cutoffInput.waitFor({ state: 'visible', timeout: 3000 })
    await cutoffInput.fill('9999')
    await cutoffInput.press('Escape')
    await sleep(200)
    assert((await cutoffInput.count()) === 0, 'input must disappear after Escape')
    const text5 = await cutoffDisplay.textContent()
    assert(text5 === '20', `expected display to revert to the pre-edit "20", got "${text5}"`)
    assert(leadSynth().cutoff === beforeEscapeCutoff, `Escape must not commit — expected cutoff still ${beforeEscapeCutoff}, got ${leadSynth().cutoff}`)
    const d5 = diffLines()
    assert(d5.added.length === 0 && d5.removed.length === 0, `Escape must leave the .beat file byte-identical to the last commit, got +${d5.added.length} -${d5.removed.length}:\n${d5.diff}`)
    console.log('[EI5] PASS: Escape reverted the display without committing; document and .beat diff both unchanged')
    results.ei5 = { docCutoff: leadSynth().cutoff, diffEmpty: d5.added.length === 0 && d5.removed.length === 0 }

    // ============ EI6: the pre-existing pointer-drag gesture still works, unchanged ============
    console.log('\n[EI6] regression: plain pointer-drag on the Resonance knob (linear, unaffected by EI) still works')
    const resKnobSvg = page.locator('[data-param-group="filter"] .knob:has(.knob-label:text-is("Res")) svg')
    await resKnobSvg.scrollIntoViewIfNeeded()
    const resBefore = leadSynth().resonance
    assertClose(resBefore, 1.1, `fixture sanity: expected lead.resonance=1.1 in the source file, got ${resBefore}`)
    const box = await resKnobSvg.boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const DY = 70 // 0.5 of the 140px full-range drag
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx, cy - DY, { steps: 12 })
    await page.mouse.up()
    // min=0, max=20, linear: expected = 0 + (resBefore/20 + 0.5) * 20 = resBefore + 10
    const expectedRes = resBefore + 10
    await pollUntil(() => Math.abs(leadSynth().resonance - expectedRes) <= 1e-3, `daemon document to show dragged resonance ~= ${expectedRes}`)
    assertClose(leadSynth().resonance, expectedRes, '[EI6] drag-resolved resonance must match the exact fromNorm() math the drag path has always used')
    const resDisplay = page.locator('[data-param-group="filter"] .knob:has(.knob-label:text-is("Res")) .knob-value-display')
    const resText = await resDisplay.textContent()
    assert(resText === expectedRes.toFixed(1), `expected Res display "${expectedRes.toFixed(1)}" (fmt.num1) after drag, got "${resText}"`)
    console.log(`[EI6] PASS: dragging the Resonance knob still resolves via the ORIGINAL fromNorm() math (${resBefore} -> ${leadSynth().resonance.toFixed(3)}, expected ${expectedRes})`)
    results.ei6 = { resBefore, resAfter: leadSynth().resonance, expectedRes }
    commit('gui: drag regression check (resonance)')

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log('\n================ ALL PHASE 27 STREAM EI (KNOB CLICK-TO-TYPE) CHECKS PASSED ================')
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
    console.error('\nPHASE 27 STREAM EI VERIFY FAILED:', err)
    process.exit(1)
  })
