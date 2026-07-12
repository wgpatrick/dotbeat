#!/usr/bin/env node
// Phase 27 Stream EH verification — effect-row bypass toggle moved to the leading position, given
// a real filled/hollow circle "Activator" glyph, and put at visual distance from the destructive
// remove button (docs/phase-27-plan.md Stream EH; docs/research/72-ux-device-view.md §1.2 item 1,
// §2.2 item 6). Driven live against a REAL `beat daemon` through the REAL built frontend in
// headless Chromium, same harness/convention as ui/verify-phase26-stream-dc.mjs and
// ui/verify-phase26-stream-de.mjs.
//
// Fixture: a disposable temp-dir copy of examples/night-shift.beat (NEVER
// examples/night-shift-song.beat, the owner's own live project). night-shift.beat's "lead" track
// carries the default, on-disk-elided 4-entry chain (eq3, comp, distortion, bitcrush) — no
// `beat effect-add` needed to get real rows to test against.
//
// Four checks:
//
//   1  LEADING POSITION   The bypass toggle (`.effect-bypass` label wrapping
//      `[data-effect-bypass]`) is the FIRST element child of every `.effect-row`, both in DOM
//      order and in on-screen x-position (its bounding-box left edge is left of every other
//      control in the row — drag handle, type label, meter, move buttons, remove button).
//   2  REGRESSION: TOGGLE STILL EDITS THE FILE   Clicking the toggle still flips `enabled` through
//      the exact same postEffectEnabled path the old checkbox used — confirmed by reading the real
//      .beat file on disk (gains/loses the "bypassed" token) and the Zustand store, not just a DOM
//      checked property.
//   3  VISUAL STATE MATCHES `enabled`   The glyph (`.effect-bypass-dot`) renders FILLED (a real,
//      non-transparent background matching --accent) when enabled, and HOLLOW (transparent
//      background, dim border) when bypassed — read via getComputedStyle, both before and after
//      the check-2 toggle.
//   4  SPACING FROM THE REMOVE BUTTON   The toggle's bounding box and the remove button
//      (`[data-effect-remove]`)'s bounding box are not touching/adjacent — a meaningful horizontal
//      gap between them, on every row.
//
// Usage: node ui/verify-phase27-stream-eh.mjs

import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const DAEMON_PORT = 0 // let the OS assign a free port
const PREVIEW_PORT = 5947 // distinct from other verify scripts' ports so they can run concurrently

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
function beat(args) {
  return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 10000, everyMs = 40) {
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
const effectLinesFor = (text, trackHeader) => {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.startsWith(trackHeader))
  assert(start !== -1, `track header "${trackHeader}" not found in file`)
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (/^track /.test(lines[i])) break
    if (lines[i].trim().startsWith('effect ')) out.push(lines[i])
  }
  return out
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // ---- disposable fixture: a temp-dir COPY of examples/night-shift.beat -------------------------
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p27eh-'))
  const beatPath = join(proj, 'project.beat')
  copyFileSync(join(repoRoot, 'examples', 'night-shift.beat'), beatPath)
  // Round-trip through parse/serialize BEFORE git-tracking it, same convention as
  // verify-phase26-stream-dc.mjs — the daemon's own edits re-serialize the whole document into its
  // canonical on-disk form (e.g. drum `pattern` sugar -> explicit `hit` lines) the first time
  // anything changes, which would otherwise swamp check 2's file-diff assertion with unrelated
  // canonicalization noise on top of the real, single-token bypass edit under test.
  writeFileSync(beatPath, serialize(parse(readFileSync(beatPath, 'utf8'))))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline (copy of examples/night-shift.beat)')
  const readBeat = () => readFileSync(beatPath, 'utf8')
  console.log(`project at ${beatPath}`)
  console.log(`  lead track effect lines (pre-daemon, expect 0 — default chain elided): ${effectLinesFor(readBeat(), 'track lead').length}`)

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon up on :${daemon.port}`)

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
  const results = {}
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1440, height: 960 })
    const errors = []
    page.on('pageerror', (e) => {
      errors.push(String(e))
      console.log(`[pageerror] ${e}`)
    })
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') console.log(`[browser ${m.type()}] ${m.text()}`)
    })
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 15000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    await page.evaluate(() => window.__store.getState().setSelectedTrack('lead'))
    await page.click('[data-pane-tab="device"]')
    await page.waitForSelector('[data-testid="effect-chain"]', { timeout: 5000 })

    const rowIds = async () => page.$$eval('[data-effect-row]', (els) => els.map((el) => el.getAttribute('data-effect-row')))
    const baselineRows = await rowIds()
    assert(
      baselineRows.join(',') === 'eq3,comp,distortion,bitcrush',
      `expected the default chain on "lead", got: ${baselineRows.join(',')}`,
    )
    console.log(`setup: lead's Effect Chain shows the default rows: ${baselineRows.join(' -> ')}`)

    // ============================================================================================
    // CHECK 1 — LEADING POSITION: DOM order AND on-screen x-position, for every row
    // ============================================================================================
    {
      const perRow = await page.$$eval('[data-effect-row]', (rows) =>
        rows.map((row) => {
          const id = row.getAttribute('data-effect-row')
          const firstChild = row.firstElementChild
          const firstChildIsBypass = !!firstChild && firstChild.matches('label.effect-bypass') && !!firstChild.querySelector('[data-effect-bypass]')
          const rectOf = (sel) => {
            const el = row.querySelector(sel)
            return el ? el.getBoundingClientRect() : null
          }
          const bypassRect = rectOf('label.effect-bypass')
          const otherSelectors = ['.effect-drag-handle', '.effect-type', '.effect-meter', `[data-effect-move-up="${id}"]`, `[data-effect-move-down="${id}"]`, `[data-effect-remove="${id}"]`]
          const otherLefts = otherSelectors.map((sel) => rectOf(sel)?.left).filter((v) => v != null)
          return {
            id,
            firstChildIsBypass,
            bypassLeft: bypassRect?.left ?? null,
            minOtherLeft: otherLefts.length ? Math.min(...otherLefts) : null,
          }
        }),
      )
      console.log('[1] per-row leading-position data:', JSON.stringify(perRow))
      for (const r of perRow) {
        assert(r.firstChildIsBypass, `[1] row "${r.id}": bypass toggle is not the first element child of .effect-row`)
        assert(r.bypassLeft != null && r.minOtherLeft != null, `[1] row "${r.id}": could not measure bounding boxes`)
        assert(
          r.bypassLeft < r.minOtherLeft,
          `[1] row "${r.id}": bypass toggle (left=${r.bypassLeft}) is not left of every other control (min other left=${r.minOtherLeft})`,
        )
      }
      console.log(`[1] PASS: on all ${perRow.length} rows, the bypass toggle is the first DOM child AND the leftmost-positioned control in .effect-row`)
      results.leadingPosition = perRow
    }

    // ============================================================================================
    // CHECK 2 — REGRESSION: click still flips `enabled` through postEffectEnabled, visible in the
    // real .beat file and the store (not just a DOM property)
    // ============================================================================================
    let enabledColor, bypassedColor
    {
      const targetId = 'bitcrush' // last of the 4 default rows — proves it's independent of chain index
      const before = await page.$eval(`[data-effect-bypass="${targetId}"]`, (el) => el.checked)
      assert(before === true, `[2] expected "${targetId}" to start enabled`)
      assert(
        effectLinesFor(readBeat(), 'track lead').length === 0,
        '[2] expected the default chain to still be elided on disk before any edit',
      )

      enabledColor = await page.$eval(`[data-effect-bypass-dot="${targetId}"]`, (el) => getComputedStyle(el).backgroundColor)

      await page.click(`[data-effect-bypass="${targetId}"]`)
      await pollUntil(async () => (await page.$eval(`[data-effect-bypass="${targetId}"]`, (el) => el.checked)) === false, '[2] DOM checkbox to read unchecked')
      await pollUntil(
        () => effectLinesFor(readBeat(), 'track lead').some((l) => new RegExp(`^\\s*effect ${targetId} bitcrush bypassed\\s*$`).test(l)),
        '[2] .beat file to gain the "bypassed" token on the bitcrush line',
      )
      await pollUntil(async () => {
        const doc = await page.evaluate(() => window.__store.getState().doc)
        return doc.tracks.find((t) => t.id === 'lead').effects.find((e) => e.id === targetId).enabled === false
      }, '[2] store to reflect enabled=false')
      const diffAfterBypass = git(proj, 'diff', '--', 'project.beat')
      console.log(`[2] .beat diff after bypassing "${targetId}":\n${diffAfterBypass}`)
      const addedLines = diffAfterBypass.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      const removedLines = diffAfterBypass.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'))
      // The daemon's own save path materializes the default-chain elision into explicit `effect`
      // lines the first time ANYTHING on that track is edited (a pre-existing canonicalization
      // property of the edit path itself, unrelated to this stream's UI-only change — the OLD
      // checkbox would have produced the exact same materialization). The behavioral assertion that
      // actually matters here: exactly one line carries the new "bypassed" token, it's on the
      // targeted effect, the other three effect lines stay un-bypassed, and nothing outside the
      // effect-chain block (no note/hit lines) is touched by this edit.
      assert(removedLines.length === 0, `[2] expected no removed lines from a bypass toggle, got:\n${removedLines.join('\n')}`)
      const bypassedTokenLines = addedLines.filter((l) => / bypassed\s*$/.test(l))
      assert(bypassedTokenLines.length === 1 && new RegExp(`effect ${targetId} bitcrush bypassed`).test(bypassedTokenLines[0]), `[2] expected exactly one added line carrying the "bypassed" token, on "${targetId}", got:\n${addedLines.join('\n')}`)
      assert(!addedLines.some((l) => /^\+\s*(note|hit|pattern) /.test(l)), `[2] bypass toggle unexpectedly touched note/hit/pattern lines:\n${addedLines.join('\n')}`)
      console.log('[2] PASS (bypass): file, store, and DOM all agree the effect is now disabled — same edit path as before, just a new control shape')

      // The dot's background-color has a 0.1s CSS transition (styles.css's .effect-bypass-dot rule)
      // — Chromium's premultiplied-alpha color interpolation keeps the hue channel constant while
      // fading alpha, so reading mid-transition would show the SAME rgb triplet as "enabled" at a
      // partial alpha rather than truly transparent. Wait out the transition before snapshotting.
      await sleep(250)
      bypassedColor = await page.$eval(`[data-effect-bypass-dot="${targetId}"]`, (el) => getComputedStyle(el).backgroundColor)

      // Toggle back on: confirm the reverse edit works too, and leaves the file exactly as it started
      // (the default chain re-elides once every member is back to its default state).
      await page.click(`[data-effect-bypass="${targetId}"]`)
      await pollUntil(async () => (await page.$eval(`[data-effect-bypass="${targetId}"]`, (el) => el.checked)) === true, '[2] DOM checkbox to read checked again')
      await pollUntil(async () => {
        const doc = await page.evaluate(() => window.__store.getState().doc)
        return doc.tracks.find((t) => t.id === 'lead').effects.find((e) => e.id === targetId).enabled === true
      }, '[2] store to reflect enabled=true again')
      await pollUntil(
        () => !effectLinesFor(readBeat(), 'track lead').some((l) => / bypassed\s*$/.test(l)),
        '[2] file to lose the "bypassed" token again after re-enabling',
      )
      console.log('[2] PASS (re-enable): toggling back on cleanly reverses the edit')
      results.toggleRegression = { addedLines }
    }

    // ============================================================================================
    // CHECK 3 — VISUAL STATE: filled when enabled, hollow when bypassed
    // ============================================================================================
    {
      console.log(`[3] enabled glyph background: ${enabledColor}, bypassed glyph background: ${bypassedColor}`)
      assert(enabledColor !== bypassedColor, `[3] glyph background color did not change between enabled and bypassed states (both ${enabledColor})`)
      const isTransparentish = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent'
      assert(!isTransparentish(enabledColor), `[3] expected the ENABLED glyph to be filled (non-transparent), got ${enabledColor}`)
      assert(isTransparentish(bypassedColor), `[3] expected the BYPASSED glyph to be hollow (transparent fill), got ${bypassedColor}`)
      // Enabled fill should match the --accent custom property actually in force on the page.
      const accentRgb = await page.evaluate(() => {
        const probe = document.createElement('div')
        probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent')
        document.body.appendChild(probe)
        const c = getComputedStyle(probe).color
        probe.remove()
        return c
      })
      assert(enabledColor === accentRgb, `[3] expected the enabled glyph's fill to equal --accent (${accentRgb}), got ${enabledColor}`)
      console.log(`[3] PASS: filled (${enabledColor}, matches --accent) when enabled, hollow/transparent when bypassed`)
      results.visualState = { enabledColor, bypassedColor, accentRgb }
    }

    // ============================================================================================
    // CHECK 4 — SPACING FROM THE REMOVE BUTTON: bounding boxes are not touching/adjacent
    // ============================================================================================
    {
      const gaps = await page.$$eval('[data-effect-row]', (rows) =>
        rows.map((row) => {
          const id = row.getAttribute('data-effect-row')
          const bypass = row.querySelector('label.effect-bypass').getBoundingClientRect()
          const remove = row.querySelector(`[data-effect-remove="${id}"]`).getBoundingClientRect()
          // Positive gap = horizontal whitespace between the toggle's right edge and the remove
          // button's left edge (they're both vertically centered in the same row).
          return { id, gap: remove.left - bypass.right }
        }),
      )
      console.log('[4] per-row bypass<->remove horizontal gaps (px):', JSON.stringify(gaps))
      const MIN_GAP_PX = 30 // comfortably more than "adjacent" (old layout had ~one button-width, ~20px)
      for (const g of gaps) {
        assert(g.gap >= MIN_GAP_PX, `[4] row "${g.id}": bypass toggle and remove button are only ${g.gap}px apart (want >= ${MIN_GAP_PX}px)`)
      }
      console.log(`[4] PASS: on all ${gaps.length} rows, the bypass toggle and the remove button have real horizontal separation (min ${Math.min(...gaps.map((g) => g.gap)).toFixed(0)}px)`)
      results.removeSpacing = gaps
    }

    // ============================================================================================
    // BONUS — keyboard accessibility: Tab-focus the toggle and flip it with Space, not just a click
    // ============================================================================================
    {
      const targetId = 'eq3'
      const before = await page.$eval(`[data-effect-bypass="${targetId}"]`, (el) => el.checked)
      await page.focus(`[data-effect-bypass="${targetId}"]`)
      const focusedIsTarget = await page.evaluate((id) => document.activeElement === document.querySelector(`[data-effect-bypass="${id}"]`), targetId)
      assert(focusedIsTarget, '[bonus] the bypass input did not accept keyboard focus')
      await page.keyboard.press('Space')
      await pollUntil(async () => (await page.$eval(`[data-effect-bypass="${targetId}"]`, (el) => el.checked)) === !before, '[bonus] Space key to toggle the focused bypass control')
      console.log('[bonus] PASS: bypass toggle is keyboard-accessible (Tab to focus, Space to toggle)')
      // leave it exactly as it started
      await page.keyboard.press('Space')
      await pollUntil(async () => (await page.$eval(`[data-effect-bypass="${targetId}"]`, (el) => el.checked)) === before, '[bonus] Space key to toggle it back')
    }

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log('\n================ ALL PHASE 27 STREAM EH CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nPHASE 27 STREAM EH VERIFY FAILED:', err)
    process.exit(1)
  })
