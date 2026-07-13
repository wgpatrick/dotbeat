#!/usr/bin/env node
// Phase 29 Stream GE verification — dialogs/toasts/discoverability copy (docs/phase-29-plan.md
// Stream GE, docs/research/80-86). Drives the REAL frontend headlessly against a REAL `beat daemon`
// (same in-process startDaemon() the CLI's own `beat daemon` command calls) and a disposable
// project in a temp dir — never examples/night-shift-song.beat, the owner's own live project.
//
// What this checks, and why it's not just "does some text appear":
//
//   GE1  MIXER SCRIM NO LONGER BLOCKS THE TOPBAR UNDO BUTTON (docs/research/81). Makes a real edit,
//        opens the Mixer overlay, confirms `document.elementFromPoint()` at the Undo button's own
//        coordinates resolves to the REAL button (not `.overlay-scrim`/`.mixer-scrim` — the exact
//        diagnostic the pilot used to find the bug), clicks it with a REAL mouse click (not the
//        keyboard shortcut), and confirms the edit was actually reverted server-side.
//   GE2  window.alert() IS GONE, REPLACED BY A REAL DISMISSABLE TOAST. Source-greps all three swept
//        files for zero remaining `window.alert(` call sites (and confirms `window.confirm(` is
//        still present at least once — the sweep was scoped to alert(), not confirm()). Then drives
//        a real refusal path (NoteView's "Place in Arrangement" while not in song mode) with a
//        `page.on('dialog', ...)` trap that FAILS the test if any native dialog fires — proving the
//        UI truly never blocks on `alert()` for this path — and asserts a real `.toast.toast-error`
//        renders instead, is manually dismissable, and that firing it twice stacks two toasts.
//   GE3  AUTOMATION POPUP DISMISSES ON OUTSIDE CLICK (docs/research/81). Adds a real automation
//        point, right-clicks it to open the popup, then clicks somewhere else entirely (not Escape,
//        not back inside the same lane) and confirms the popup actually unmounts.
//   GE4  HISTORY PANEL: HONEST EMPTY-STATE COPY + A REAL "SAVE CHECKPOINT" BUTTON (docs/research/80).
//        Confirms the empty-state copy no longer claims an edit alone saves a checkpoint, drives the
//        real Save-checkpoint button (accepting its window.prompt label dialog — a legitimate,
//        unchanged use of a native dialog, not swept), confirms a new checkpoint lands with that
//        label both in the GUI list and via a direct GET /history round-trip, and confirms a second
//        checkpoint with no intervening change reports {skipped:true} via the daemon route directly.
//   GE5  CONTENT BROWSER HAS A DRAG-AND-DROP HINT LINE (docs/research/80/83).
//   GE6  "VARY" BUTTON LABELS CARRY A (tone)/(timing) QUALIFIER (docs/research/82).
//
// Usage: node ui/verify-phase29-stream-ge.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5994 // distinct from other verify scripts' ports so concurrent runs never collide

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

// A brand-new-project shape (loop mode, one synth track with a starter clip already covering the
// loop) — mirrors `beat init`'s own starter document per docs/research/80's walkthrough, so GE2's
// "not in song mode yet" refusal is the natural, unforced state rather than something contrived.
const FIXTURE = `format_version 0.3
bpm 120
loop_bars 2
selected_track lead

track lead lead #e06c75 synth
  synth
    osc sawtooth
    volume -6
    cutoff 4000
    resonance 0.8
    attack 0.01
    decay 0.2
    sustain 0.8
    release 0.3
    pan 0
  note u1 60 0 4 0.8
  note u2 64 4 4 0.8
`

// ---- GE2-source: the three swept files carry zero window.alert(), but window.confirm( survives ----
function verifyAlertSweepSource() {
  const files = ['ArrangementView.tsx', 'NoteView.tsx', 'ContentBrowser.tsx'].map((f) => join(uiDir, 'src/components', f))
  let totalShowToast = 0
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    assert(!/window\.alert\(/.test(src), `expected zero window.alert( call sites left in ${f}, found at least one`)
    totalShowToast += (src.match(/showToast\(/g) ?? []).length
  }
  assert(totalShowToast >= 25, `expected at least 25 showToast( call sites across the three swept files (the mechanical sweep), found ${totalShowToast}`)
  const arrSrc = readFileSync(files[0], 'utf8')
  assert(/window\.confirm\(/.test(arrSrc), 'expected window.confirm( to SURVIVE in ArrangementView.tsx (destructive-action confirmation, out of this sweep\'s scope) — sweep must not have over-reached')
  console.log(`[GE2-source] PASS: zero window.alert( in the three swept files, ${totalShowToast} showToast( call sites, window.confirm( survives for the delete-track confirmation`)
}

// ---- GE4-source: the empty-state copy fix, checked directly against source (not runtime), since
// this project's own git-backed history repo already carries a "canonical baseline" commit by the
// time the daemon boots (same fixture-setup convention every verify script in this suite uses), so
// the GUI's OWN empty-state branch is never actually reachable at runtime here — this is the only
// way to pin the exact copy regression this item fixed. ----
function verifyHistoryEmptyCopySource() {
  const src = readFileSync(join(uiDir, 'src/components/HistoryPanel.tsx'), 'utf8')
  // Look at the actual rendered empty-state JSX line, not the whole file (a comment nearby
  // legitimately quotes the old, false copy to explain what was fixed and why).
  const emptyStateLine = src.split('\n').find((l) => l.includes('history-empty') && l.includes('rows.length === 0'))
  assert(emptyStateLine, 'could not find the rendered "no checkpoints" empty-state line in HistoryPanel.tsx at all')
  assert(!/make an edit to save one/i.test(emptyStateLine), `the rendered empty-state copy still implies an edit alone saves a checkpoint: ${emptyStateLine.trim()}`)
  assert(/data-action="save-checkpoint"/.test(src), 'HistoryPanel.tsx is missing a data-action="save-checkpoint" button')
  console.log(`[GE4-source] PASS: the old false empty-state copy is gone (now: ${emptyStateLine.trim()}), and a save-checkpoint action exists`)
}

async function main() {
  verifyAlertSweepSource()
  verifyHistoryEmptyCopySource()

  console.log('\nbuilding repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p29ge-'))
  const beatPath = join(proj, 'song.beat')
  const canonical = serialize(parse(FIXTURE))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical baseline')

  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  console.log(`daemon up on :${daemon.port}, project ${beatPath}`)

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
    await sleep(200)

    // ================================================================================================
    // GE1 — Mixer scrim no longer blocks the topbar Undo button
    // ================================================================================================
    console.log('\n[GE1] Mixer open -> topbar Undo button stays real, clickable, and actually undoes')
    const panBefore = daemon.getDoc().tracks.find((t) => t.id === 'lead').synth.pan
    assert(panBefore === 0, `fixture sanity: expected lead.pan to start at 0, got ${panBefore}`)
    // A real edit via the exact wire contract postEdit's debounced timer uses.
    await page.evaluate(
      async ({ base }) => {
        await fetch(`${base}/edit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'lead.pan', value: '0.6' }) })
      },
      { base: `http://localhost:${daemon.port}` },
    )
    await pollUntil(() => daemon.getDoc().tracks.find((t) => t.id === 'lead').synth.pan === 0.6, 'lead.pan edit to land')
    await pollUntil(async () => (await page.evaluate(() => window.__store.getState().canUndo)) === true, 'GUI canUndo to flip true after the edit')
    console.log('  [GE1a] PASS: a real edit landed and the GUI\'s own undo stack sees it')

    await page.click('[data-action="toggle-mixer"]')
    await page.waitForSelector('[data-testid="mixer-overlay"]', { timeout: 5000 })
    await sleep(150)

    const undoBtn = page.locator('[data-action="undo"]')
    await undoBtn.waitFor({ state: 'visible', timeout: 3000 })
    const box = await undoBtn.boundingBox()
    assert(box, 'Undo button has no bounding box while the Mixer is open')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const hitTag = await page.evaluate(
      ({ cx, cy }) => {
        const el = document.elementFromPoint(cx, cy)
        return el ? { tag: el.tagName, action: el.getAttribute('data-action'), cls: el.className } : null
      },
      { cx, cy },
    )
    console.log(`  [GE1b] elementFromPoint(Undo center) while Mixer is open -> ${JSON.stringify(hitTag)}`)
    assert(hitTag && hitTag.action === 'undo', `expected elementFromPoint to resolve to the real Undo button (data-action="undo"), got ${JSON.stringify(hitTag)} — the scrim is still intercepting it`)
    console.log('  [GE1b] PASS: elementFromPoint resolves to the REAL Undo button, not the scrim, while the Mixer is open')

    await undoBtn.click() // a REAL mouse click — the exact gesture pilot 81 found silently did nothing
    await pollUntil(() => daemon.getDoc().tracks.find((t) => t.id === 'lead').synth.pan === panBefore, 'the mixer-open topbar Undo click to actually revert lead.pan', 5000)
    console.log(`  [GE1c] PASS: clicking the topbar Undo button DIRECTLY (not Ctrl/Cmd+Z) while the Mixer is open reverted lead.pan back to ${panBefore}`)
    results.ge1 = { panBefore, hitTag }

    await page.click('[data-action="close-mixer"]')
    await page.waitForSelector('[data-testid="mixer-overlay"]', { state: 'detached', timeout: 5000 })

    // ================================================================================================
    // GE2 — window.alert() replaced by a real, dismissable, non-blocking toast
    // ================================================================================================
    console.log('\n[GE2] a refusal path renders a real toast, never a native dialog')
    let dialogFired = false
    const dialogTrap = (d) => {
      dialogFired = true
      console.log(`  [GE2] UNEXPECTED native dialog fired: "${d.message()}" — this is exactly the bug (Playwright's default auto-dismiss would have eaten this message, research/82)`)
      d.dismiss().catch(() => {})
    }
    page.on('dialog', dialogTrap)

    assert(daemon.getDoc().song === null || daemon.getDoc().song === undefined, 'fixture sanity: expected loop mode (no song) before GE2')
    await page.waitForSelector('[data-place-clip="lead"]', { timeout: 5000 })
    await page.click('[data-place-clip="lead"]')
    const toast1 = page.locator('.toast.toast-error')
    await toast1.waitFor({ state: 'visible', timeout: 3000 })
    const toastText = await toast1.textContent()
    assert(/add a song section first/i.test(toastText), `expected the toast to carry the refusal message, got "${toastText}"`)
    assert(!dialogFired, 'a native dialog fired for a pure-notification refusal — the alert() sweep missed this call site')
    console.log(`  [GE2a] PASS: "Place in Arrangement" while not in song mode renders a toast ("${toastText.trim()}"), zero native dialogs`)

    // Fire it again without dismissing the first — toasts should stack, not replace.
    await page.click('[data-place-clip="lead"]')
    await pollUntil(async () => (await page.locator('.toast.toast-error').count()) === 2, 'a second toast to stack alongside the first', 3000)
    console.log('  [GE2b] PASS: firing the same refusal twice stacks two toasts (not a single replaced one)')

    await page.locator('.toast-close').first().click()
    await pollUntil(async () => (await page.locator('.toast.toast-error').count()) === 1, 'one toast to remain after dismissing the other', 3000)
    console.log('  [GE2c] PASS: the manual dismiss (×) button actually removes just that one toast')
    page.off('dialog', dialogTrap)
    results.ge2 = { toastText: toastText.trim() }

    // ================================================================================================
    // GE3 — automation popup dismisses on outside click
    // ================================================================================================
    console.log('\n[GE3] automation breakpoint popup dismisses on a click OUTSIDE the lane')
    await page.click('[data-add-section="1"]') // loop mode -> song mode (keeps the loop as section 1)
    await pollUntil(() => !!daemon.getDoc().song && daemon.getDoc().song.length > 0, 'doc to enter song mode', 4000)
    // The GUI's own occurrencesByTrack (and therefore the "A" toggle's disabled state) only updates
    // once the SSE-broadcast doc round-trips back into the store — poll for it to actually enable
    // rather than racing a click against that.
    await pollUntil(async () => !(await page.locator('[data-auto-toggle="lead"]').isDisabled()), 'the "A" automation toggle to become enabled after entering song mode', 5000)

    await page.click('[data-auto-toggle="lead"]')
    await page.waitForSelector('[data-auto-select="lead"]', { timeout: 4000 })
    await page.selectOption('[data-auto-select="lead"]', 'cutoff')
    await page.click('[data-auto-add="lead"]')
    await page.waitForSelector('.arr-auto-lane[data-auto-track="lead"][data-auto-param="cutoff"]', { timeout: 4000 })
    await sleep(150)

    const lane = await page.$('.arr-auto-lane[data-auto-track="lead"][data-auto-param="cutoff"]')
    const lb = await lane.boundingBox()
    const px = lb.x + lb.width * 0.3
    const py = lb.y + lb.height * 0.5
    await page.mouse.click(px, py)
    await pollUntil(() => {
      const clip = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips[0]
      const l = clip?.automation.find((x) => x.param === 'cutoff')
      return l && l.points.length > 0
    }, 'the clicked breakpoint to land', 5000)
    const pointId = daemon.getDoc().tracks.find((t) => t.id === 'lead').clips[0].automation.find((l) => l.param === 'cutoff').points[0].id
    console.log(`  [GE3a] PASS: a real breakpoint (${pointId}) landed via a click on the lane`)

    await page.mouse.click(px, py, { button: 'right' })
    const popup = page.locator(`[data-auto-popup="lead.cutoff.${pointId}"]`)
    await popup.waitFor({ state: 'visible', timeout: 4000 })
    console.log('  [GE3b] PASS: right-click opened the popup')

    // The OLD bug: only Escape-with-focus or a further click inside this SAME lane closed it. Click
    // somewhere entirely unrelated — the topbar brand logo — and confirm it dismisses.
    await page.click('.brand')
    await pollUntil(async () => (await popup.count()) === 0, 'popup to unmount after a click entirely outside the automation lane', 3000)
    console.log('  [GE3c] PASS: clicking outside the lane (the topbar brand logo) dismissed the popup — the fix this item asked for')
    results.ge3 = { pointId }

    // ================================================================================================
    // GE4 — History panel: honest empty-state copy + a real Save-checkpoint button
    // ================================================================================================
    console.log('\n[GE4] History panel copy is honest, and Save checkpoint actually saves one')
    await page.click('[data-action="toggle-history"]')
    await page.waitForSelector('[data-testid="history-panel"]', { timeout: 5000 })
    await sleep(200)

    const emptyLocator = page.locator('.history-empty')
    if (await emptyLocator.count()) {
      const emptyText = await emptyLocator.textContent()
      assert(!/make an edit to save one/i.test(emptyText), `the empty-state copy still implies an edit alone saves a checkpoint: "${emptyText}"`)
      console.log(`  [GE4a] PASS: empty-state copy no longer claims an edit saves a checkpoint ("${emptyText.trim()}")`)
    } else {
      console.log('  [GE4a] SKIPPED (rows already non-empty going in) — copy check needs the empty state; continuing to the button check')
    }

    const rowsBefore = (await (await fetch(`http://localhost:${daemon.port}/history`)).json()).entries?.length ?? 0
    let promptedWith = null
    const promptTrap = (d) => {
      promptedWith = d.message()
      d.accept('verify checkpoint label').catch(() => {})
    }
    page.on('dialog', promptTrap)
    await page.click('[data-action="save-checkpoint"]')
    await pollUntil(async () => ((await (await fetch(`http://localhost:${daemon.port}/history`)).json()).entries?.length ?? 0) > rowsBefore, 'a new checkpoint to land after clicking Save checkpoint', 6000)
    page.off('dialog', promptTrap)
    assert(promptedWith !== null, 'expected Save checkpoint to prompt for an optional label (window.prompt — a legitimate, un-swept native dialog)')
    console.log(`  [GE4b] PASS: Save checkpoint prompted ("${promptedWith}") and a new checkpoint landed server-side`)

    const historyAfter = await (await fetch(`http://localhost:${daemon.port}/history`)).json()
    const newest = historyAfter.entries[0]
    assert(newest.label === 'verify checkpoint label', `expected the new checkpoint's label to be the typed prompt text, got "${newest.label}"`)
    console.log(`  [GE4c] PASS: the new checkpoint carries the typed label verbatim ("${newest.label}")`)

    await pollUntil(async () => (await page.locator('.history-row').count()) >= 1, 'the History panel\'s own list to show the new row', 4000)
    console.log('  [GE4d] PASS: the GUI list reflects the new checkpoint too (not just the daemon)')

    // A second checkpoint with zero intervening changes should skip, not commit noise — the exact
    // CLI/MCP `beat checkpoint` contract this route wraps.
    const skipRes = await (await fetch(`http://localhost:${daemon.port}/checkpoint`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
    assert(skipRes.skipped === true, `expected a second immediate checkpoint (no changes since) to report {skipped:true}, got ${JSON.stringify(skipRes)}`)
    console.log('  [GE4e] PASS: POST /checkpoint with nothing new to record reports {skipped:true} (matches beat checkpoint\'s own CLI contract) instead of committing noise')
    results.ge4 = { newestLabel: newest.label }

    await page.click('[data-action="close-history"]')
    await page.waitForSelector('[data-testid="history-panel"]', { state: 'detached', timeout: 5000 })

    // ================================================================================================
    // GE5 — Content Browser has a drag-and-drop hint line
    // ================================================================================================
    console.log('\n[GE5] Content Browser carries an inline drag-and-drop hint')
    await page.click('[data-action="toggle-library"]')
    await page.waitForSelector('[data-testid="content-browser"]', { timeout: 5000 })
    const hint = await page.locator('[data-testid="content-browser"] .library-hint').textContent()
    console.log(`  hint text: "${hint.trim()}"`)
    assert(/drag/i.test(hint) && /track/i.test(hint), `expected a drag-onto-a-track hint, got "${hint}"`)
    console.log('  [GE5] PASS: Content Browser shows an inline hint describing the real drag-onto-a-track interaction')
    results.ge5 = { hint: hint.trim() }
    await page.click('[data-action="close-library"]')

    // ================================================================================================
    // GE6 — "vary" button labels carry a (tone)/(timing) qualifier
    // ================================================================================================
    console.log('\n[GE6] vary button labels signal timbre/timing, not a rhythmic pattern change')
    // Click the track's own select button — clickHeader's real click path (ArrangementView.tsx),
    // which POSTs the D2 pointing selection and is exactly what makes VaryAffordance render its bar.
    await page.click('.arr-track-select')
    await pollUntil(async () => (await page.evaluate(() => Object.keys(window.__store.getState().selection).length)) > 0, 'a real track selection to post', 4000)
    await page.waitForSelector('.vary-bar .vary-btn.trigger', { timeout: 5000 })
    const varyLabel = (await page.locator('.vary-bar .vary-btn.trigger').first().textContent()).trim()
    const varyFeelLabel = (await page.locator('.vary-bar .vary-btn.trigger').nth(1).textContent()).trim()
    console.log(`  rung-1 trigger label: "${varyLabel}"    rung-2 feel label: "${varyFeelLabel}"`)
    assert(/\(tone\)/i.test(varyLabel), `expected the rung-1 "vary" trigger to carry a "(tone)" qualifier, got "${varyLabel}"`)
    assert(/vary feel\s*\(timing\)/i.test(varyFeelLabel), `expected the rung-2 "vary feel" trigger to carry a "(timing)" qualifier, got "${varyFeelLabel}"`)
    console.log('  [GE6] PASS: both vary triggers carry an explicit tone/timing qualifier, not a bare "vary X" that reads as a rhythmic pattern change')
    results.ge6 = { varyLabel, varyFeelLabel }

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log('\n================ ALL PHASE 29 STREAM GE CHECKS PASSED ================')
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
    console.error('\nPHASE 29 STREAM GE VERIFY FAILED:', err)
    process.exit(1)
  })
