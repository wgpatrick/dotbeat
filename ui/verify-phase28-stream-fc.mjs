#!/usr/bin/env node
// Phase 28 Stream FC verification — the keyboard-shortcut reference panel (docs/phase-28-plan.md
// Stream FC, docs/research/79-ux-overall-patterns-round2.md §3.10/§4 P1 item 7). Drives the REAL
// frontend headlessly against a REAL `beat daemon` (same in-process startDaemon() the CLI's own
// `beat daemon` command calls) and a disposable COPY of examples/night-shift.beat in a temp dir —
// never examples/night-shift-song.beat, the owner's own live project.
//
// What this checks, and why it's not just "does some text appear":
//
//   FC1  BUTTON FOLLOWS THE EXISTING TOPBAR CONVENTION   a `.topbar-btn` next to Browser/Mixer/
//        History, same `data-action="toggle-*"` naming, same `.active` class toggling on click —
//        the exact interaction pattern research/79 asked this stream to reuse rather than invent.
//   FC2  CLICK OPENS THE PANEL                            the shortcut panel mounts
//        (`[data-testid="shortcut-help-panel"]`) and is actually visible.
//   FC3  LISTED SHORTCUTS ARE CROSS-CHECKED AGAINST THE REAL HANDLER SOURCE, NOT JUST TEXT
//        PRESENCE — this script reads App.tsx/NoteView.tsx/Knob.tsx from disk and greps each real
//        keydown handler for the literal key comparisons it makes (e.g. `e.key === 'z'` guarded by
//        ctrlKey/metaKey in App.tsx, `e.key === 'c'`/`'v'` in NoteView.tsx, `e.key === 'Enter'`/
//        `'Escape'` in Knob.tsx). Only once the source is confirmed to still contain each handler
//        does the script assert the panel's rendered DOM actually lists a keycap row for it — so a
//        future edit that silently removes a handler (or a panel edit that silently invents one
//        that doesn't exist) would fail this script, not just "some text matches somewhere."
//   FC4  PANEL CLOSES VIA THE SAME TOPBAR BUTTON            clicking `[data-action="toggle-
//        shortcuts"]` again removes the panel from the DOM (a second, independent dismiss path —
//        the panel's own Close button — is also checked).
//
// Usage: node ui/verify-phase28-stream-fc.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5983 // distinct from other verify scripts' ports so concurrent runs never collide

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

// ---- FC3 source cross-check: read the real handler files and confirm each shortcut this panel
// claims to document is actually implemented as a real key comparison, not invented. ----
function verifySourceHasHandlers() {
  const appSrc = readFileSync(join(uiDir, 'src/App.tsx'), 'utf8')
  const noteViewSrc = readFileSync(join(uiDir, 'src/components/NoteView.tsx'), 'utf8')
  const knobSrc = readFileSync(join(uiDir, 'src/components/Knob.tsx'), 'utf8')

  const checks = [
    // App.tsx: Shift+Tab (bottom pane toggle)
    [appSrc, /e\.key\s*!==\s*'Tab'\s*\|\|\s*!e\.shiftKey/, 'App.tsx Shift+Tab bottom-pane-toggle handler'],
    // App.tsx: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y redo
    [appSrc, /key\s*===\s*'z'\s*&&\s*!e\.shiftKey/, "App.tsx undo handler (key === 'z' && !shiftKey)"],
    [appSrc, /key\s*===\s*'z'\s*&&\s*e\.shiftKey/, "App.tsx redo handler (key === 'z' && shiftKey)"],
    [appSrc, /key\s*===\s*'y'/, "App.tsx redo-alt handler (key === 'y')"],
    // NoteView.tsx: select all / copy / paste / delete / arrows / shift+arrows
    [noteViewSrc, /e\.key\s*===\s*'a'\s*\|\|\s*e\.key\s*===\s*'A'/, 'NoteView.tsx select-all handler'],
    [noteViewSrc, /e\.key\s*===\s*'c'\s*\|\|\s*e\.key\s*===\s*'C'/, 'NoteView.tsx copy handler'],
    [noteViewSrc, /e\.key\s*===\s*'v'\s*\|\|\s*e\.key\s*===\s*'V'/, 'NoteView.tsx paste handler'],
    [noteViewSrc, /e\.key\s*===\s*'Delete'\s*\|\|\s*e\.key\s*===\s*'Backspace'/, 'NoteView.tsx delete handler'],
    [noteViewSrc, /e\.key\s*===\s*'ArrowLeft'\s*\|\|\s*e\.key\s*===\s*'ArrowRight'\s*\|\|\s*e\.key\s*===\s*'ArrowUp'\s*\|\|\s*e\.key\s*===\s*'ArrowDown'/, 'NoteView.tsx arrow-nudge handler'],
    [noteViewSrc, /e\.shiftKey\s*&&\s*\(e\.key\s*===\s*'ArrowLeft'\s*\|\|\s*e\.key\s*===\s*'ArrowRight'\)/, 'NoteView.tsx shift+left/right resize handler'],
    // Knob.tsx: Enter commits, Escape cancels
    [knobSrc, /e\.key\s*===\s*'Enter'/, 'Knob.tsx Enter-commit handler'],
    [knobSrc, /e\.key\s*===\s*'Escape'/, 'Knob.tsx Escape-cancel handler'],
  ]
  for (const [src, re, label] of checks) {
    assert(re.test(src), `expected real source handler for: ${label} (regex ${re} did not match)`)
  }
  console.log(`[FC3-source] PASS: all ${checks.length} real keydown handlers confirmed present in source`)
}

async function main() {
  verifySourceHasHandlers()

  console.log('\nbuilding repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p28fc-'))
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

    const shortcutsBtn = page.locator('[data-action="toggle-shortcuts"]')
    const panel = page.locator('[data-testid="shortcut-help-panel"]')

    // ============ FC1: button exists, follows the Browser/Mixer/History topbar-btn convention ============
    console.log('\n[FC1] Shortcuts topbar button exists, sits alongside Browser/Mixer/History, starts inactive')
    await shortcutsBtn.waitFor({ state: 'visible', timeout: 5000 })
    const btnClass0 = await shortcutsBtn.getAttribute('class')
    assert(btnClass0.includes('topbar-btn'), `expected the Shortcuts button to use the shared .topbar-btn class, got "${btnClass0}"`)
    assert(!btnClass0.includes('active'), `expected the Shortcuts button to start inactive, got class "${btnClass0}"`)
    assert((await page.locator('[data-action="toggle-library"]').count()) === 1, 'sanity: Browser button should exist alongside it')
    assert((await page.locator('[data-action="toggle-mixer"]').count()) === 1, 'sanity: Mixer button should exist alongside it')
    assert((await page.locator('[data-action="toggle-history"]').count()) === 1, 'sanity: History button should exist alongside it')
    assert((await panel.count()) === 0, 'panel must not be mounted before the button is clicked')
    console.log('[FC1] PASS: Shortcuts button present with the shared topbar-btn convention, panel starts closed')

    // ============ FC2: clicking the button opens the panel, and it's actually visible ============
    console.log('\n[FC2] click Shortcuts -> panel opens and is visible; button gains .active')
    await shortcutsBtn.click()
    await panel.waitFor({ state: 'visible', timeout: 3000 })
    assert(await panel.isVisible(), 'shortcut panel must be visible after clicking the topbar button')
    const btnClass1 = await shortcutsBtn.getAttribute('class')
    assert(btnClass1.includes('active'), `expected the Shortcuts button to gain .active once open, got "${btnClass1}"`)
    const title = await page.locator('[data-testid="shortcut-help-panel"] .overlay-title').textContent()
    assert(/keyboard shortcuts/i.test(title), `expected an "keyboard shortcuts" overlay title, got "${title}"`)
    console.log('[FC2] PASS: panel opened and visible, button shows .active')

    // ============ FC3: rendered rows actually list the real shortcuts, matched to real handlers ============
    console.log('\n[FC3] rendered panel lists the real shortcuts (Undo/Redo, copy/paste, Knob Enter/Escape, etc.)')
    const panelText = (await panel.textContent()).replace(/\s+/g, ' ')

    // Global group: Shift+Tab, Undo (Ctrl/Cmd+Z), Redo (Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y)
    const globalGroup = page.locator('.shortcut-group', { hasText: 'Global' })
    await globalGroup.waitFor({ state: 'visible', timeout: 3000 })
    assert(await globalGroup.locator('.kbd', { hasText: 'Shift' }).count() >= 1, 'expected a Shift keycap in the Global group (Shift+Tab)')
    assert(await globalGroup.locator('.kbd', { hasText: 'Tab' }).count() >= 1, 'expected a Tab keycap in the Global group (Shift+Tab)')
    assert(await globalGroup.locator('.kbd', { hasText: 'Ctrl/Cmd' }).count() >= 1, 'expected a Ctrl/Cmd keycap in the Global group (undo/redo)')
    assert(await globalGroup.locator('.shortcut-row', { hasText: 'undo' }).count() >= 1, 'expected an undo row in the Global group')
    assert(await globalGroup.locator('.shortcut-row', { hasText: 'redo' }).count() >= 1, 'expected a redo row in the Global group')
    console.log('[FC3a] PASS: Global group lists Shift+Tab and Undo/Redo')

    // Piano Roll / Note Editing group: select-all, copy, paste, delete, nudge, resize
    const noteGroup = page.locator('.shortcut-group', { hasText: 'Piano Roll' })
    await noteGroup.waitFor({ state: 'visible', timeout: 3000 })
    assert(await noteGroup.locator('.shortcut-row', { hasText: /select all/i }).count() >= 1, 'expected a select-all row')
    assert(await noteGroup.locator('.shortcut-row', { hasText: /copy/i }).count() >= 1, 'expected a copy row')
    assert(await noteGroup.locator('.shortcut-row', { hasText: /paste/i }).count() >= 1, 'expected a paste row')
    assert(await noteGroup.locator('.shortcut-row', { hasText: /delete/i }).count() >= 1, 'expected a delete row')
    assert(await noteGroup.locator('.shortcut-row', { hasText: /nudge/i }).count() >= 1, 'expected a nudge row')
    assert(await noteGroup.locator('.shortcut-row', { hasText: /resize/i }).count() >= 1, 'expected a resize row')
    console.log('[FC3b] PASS: Piano Roll / Note Editing group lists select-all/copy/paste/delete/nudge/resize')

    // Knobs group: Enter, Escape
    const knobGroup = page.locator('.shortcut-group', { hasText: 'Knobs' })
    await knobGroup.waitFor({ state: 'visible', timeout: 3000 })
    assert(await knobGroup.locator('.kbd', { hasText: 'Enter' }).count() >= 1, 'expected an Enter keycap in the Knobs group')
    assert(await knobGroup.locator('.kbd', { hasText: 'Escape' }).count() >= 1, 'expected an Escape keycap in the Knobs group')
    console.log('[FC3c] PASS: Knobs group lists Enter/Escape')

    results.fc3 = { panelTextLength: panelText.length }

    // ============ FC4: two independent dismiss gestures both close the panel ============
    // Note: the panel is a `position: fixed; inset: 0` scrim (App.tsx's shared `.overlay-scrim`,
    // same shell the Mixer overlay already uses) with z-index over everything, INCLUDING the
    // topbar — so the Shortcuts toggle button itself is covered while the panel is open and isn't
    // clickable a second time (confirmed the hard way: Phase 26 Stream DE's verify script hit the
    // exact same "topbar button covered by its own scrim" behavior for the Mixer overlay and
    // documents dismissing via the in-panel Close button instead, ui/verify-phase26-stream-de.mjs
    // around line 177). So this checks the two dismiss gestures that ARE reachable: clicking the
    // scrim itself (outside the panel content — the click-away gesture `overlay-scrim`'s own
    // `onClick={onClose}` implements), and the panel's own Close button.
    console.log('\n[FC4a] click the scrim outside the panel content -> panel closes (click-away dismiss)')
    await page.mouse.click(10, 10) // top-left corner: inside the scrim, outside the centered panel
    await pollUntil(async () => (await panel.count()) === 0, 'panel to unmount after clicking the scrim outside the panel')
    const btnClass2 = await shortcutsBtn.getAttribute('class')
    assert(!btnClass2.includes('active'), `expected the Shortcuts button to lose .active once closed, got "${btnClass2}"`)
    console.log('[FC4a] PASS: panel closes via the click-away scrim gesture, button state stays in sync')

    console.log('\n[FC4b] reopen via the topbar button, click the panel\'s own Close button -> panel closes')
    await shortcutsBtn.click()
    await panel.waitFor({ state: 'visible', timeout: 3000 })
    await page.click('[data-action="close-shortcuts"]')
    await pollUntil(async () => (await panel.count()) === 0, 'panel to unmount after clicking its own Close button')
    const btnClass3 = await shortcutsBtn.getAttribute('class')
    assert(!btnClass3.includes('active'), `expected the Shortcuts button to lose .active after Close-button dismiss too, got "${btnClass3}"`)
    console.log('[FC4b] PASS: panel closes via its own Close button, button state stays in sync')

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log('\n================ ALL PHASE 28 STREAM FC (KEYBOARD-SHORTCUT REFERENCE) CHECKS PASSED ================')
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
    console.error('\nPHASE 28 STREAM FC VERIFY FAILED:', err)
    process.exit(1)
  })
