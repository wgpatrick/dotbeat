#!/usr/bin/env node
// Phase 29 Stream GB verification (docs/phase-29-plan.md "GB — Macro/preset display desync",
// docs/research/81-usability-pilot-existing-song.md, docs/research/86-usability-pilot-song-
// structure-mix.md). Driven live against a REAL `beat daemon` through the REAL built frontend in
// headless Chromium, on a disposable COPY of `examples/night-shift.beat` (never
// `examples/night-shift-song.beat`, the owner's own live project) — same discipline every prior
// verify script in this repo follows.
//
// THE BUG: MacroKnob (SynthPanel.tsx) used to re-derive its displayed knob position only on
// `useEffect(..., [track.id])` — switching TRACKS re-synced it, but switching a track's PRESET
// (which changes the underlying synth params just as drastically) did not. Pilot 81: all 6 macro
// knobs showed IDENTICAL numbers before/after a preset swap. Pilot 86: worse under reload — the
// preset LABEL itself could revert to the wrong name while the (correct) params sat underneath,
// and the macro knobs then showed a THIRD, unrelated set of numbers. Root cause: neither "current
// preset" nor "macro dial position" is a real field in the .beat document — both are inferred
// client-side, and that inference never fired on a preset switch, only a track switch.
//
// THE FIX: state/store.ts's new `presetEpoch` (bumped once, in exactly one place —
// daemon/library.ts's applyPresetToTrack) is now also a MacroKnob dependency, and drives
// PresetPicker's own cursor via a reverse-match against the preset catalog (findMatchingPresetIndex)
// instead of an arbitrary index-0 default.
//
// CHECK 1  Apply preset A (driving-kit) to the drums track via PresetPicker's own dropdown, read
//          the "punch" macro's on-screen value; switch to preset B (808-trap-kit, deliberately
//          chosen for a large kickPunch delta) via the SAME dropdown (no track switch); confirm
//          the macro knob updates IMMEDIATELY to reflect B's real params — the exact pilot 81 bug.
// CHECK 2  PresetPicker's own <select> shows preset B's real name right after the swap (not stuck
//          on A, not reset to some unrelated catalog entry).
// CHECK 3  A page reload after applying B: confirm the preset <select> still shows "808-trap-kit"
//          (reverse-matched from live params, not defaulted to whatever sorts first) AND the
//          "punch" macro knob shows a value consistent with B's real params — pilot 86's reload
//          regression, fixed on both fronts at once.
// CHECK 4  Regression: a user's own in-progress knob drag is NOT clobbered by an unrelated,
//          ordinary param edit elsewhere on the panel (presetEpoch must NOT advance on a plain
//          /edit — only on an actual preset apply) — the exact tradeoff the original `[track.id]`-
//          only dependency existed to protect, and the whole reason `presetEpoch` isn't just
//          "any param changed."
// CHECK 5  "Also in scope": dragging a preset from the Content Browser onto a track header (while
//          the Clip tab, not Device, is showing) flashes the Device tab button — the lightweight
//          confirmation pilot 80 found missing entirely.
//
// Usage: node ui/verify-phase29-stream-gb.mjs

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5992 // distinct from other verify scripts' ports so concurrent runs never collide

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
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
const trackHeaderSel = (name) => `.arr-row:has(.arr-track-name:text-is("${name}")) [data-drop-target="track-header"]`

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // ---- disposable fixture: a COPY of examples/night-shift.beat (never night-shift-song.beat) ----
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p29gb-'))
  const beatPath = join(proj, 'project.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  console.log(`fixture copied to ${beatPath} (tracks: lead/drums/bass/pad)`)

  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline (night-shift copy)')

  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
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
    await page.setViewportSize({ width: 1600, height: 980 })
    const errors = []
    page.on('pageerror', (e) => {
      errors.push(String(e))
      console.log(`[pageerror] ${e}`)
    })
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 15000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    const readPunchKnob = async () => {
      const text = await page.$eval('[data-macro-knob="punch"] .knob-value-display', (el) => el.textContent)
      return Number(text)
    }
    const readPresetSelect = async () => page.$eval('[data-preset-select]', (el) => el.value)

    // ============================================================================================
    // CHECK 1 & 2 — preset switch (NO track switch) immediately re-syncs the macro row + the label
    // ============================================================================================
    {
      await page.evaluate(() => window.__store.getState().setSelectedTrack('drums'))
      await page.click('[data-pane-tab="device"]')
      await page.waitForSelector('[data-testid="preset-picker"]', { timeout: 5000 })
      await page.waitForSelector('[data-testid="macro-row"]', { timeout: 5000 })
      await page.waitForSelector('[data-macro-knob="punch"]', { timeout: 5000 })

      // Preset A: driving-kit (kickPunch 0.08 -> punch knob ~46 per macros.json's [0.02, 0.15] range)
      await page.selectOption('[data-preset-select]', { label: 'driving-kit — house' })
      await pollUntil(async () => (await readPresetSelect()) === 'driving-kit', '[1] select to settle on driving-kit')
      await pollUntil(async () => {
        const f = readFileSync(beatPath, 'utf8')
        const section = f.slice(f.indexOf('track drums')).split(/\ntrack /)[0]
        return /kickPunch 0\.08/.test(section)
      }, '[1] driving-kit\'s kickPunch to land in the .beat file')
      const punchAfterA = await readPunchKnob()
      console.log(`[1] preset A "driving-kit" applied — punch knob reads ${punchAfterA}`)
      assert(punchAfterA >= 40 && punchAfterA <= 52, `[1] expected punch knob ~46 for driving-kit's kickPunch=0.08, got ${punchAfterA}`)

      // Preset B: 808-trap-kit (kickPunch 0.2 -> clamped to knob 100, well outside A's range) — via
      // the SAME dropdown, no track switch in between. THIS is the exact pilot 81 repro.
      await page.selectOption('[data-preset-select]', { label: '808-trap-kit — 808-trap' })
      await pollUntil(async () => (await readPresetSelect()) === '808-trap-kit', '[1] select to settle on 808-trap-kit')
      await pollUntil(async () => {
        const f = readFileSync(beatPath, 'utf8')
        const section = f.slice(f.indexOf('track drums')).split(/\ntrack /)[0]
        return /kickPunch 0\.2\b/.test(section)
      }, '[1] 808-trap-kit\'s kickPunch to land in the .beat file')

      const punchAfterB = await readPunchKnob()
      console.log(`[1] preset B "808-trap-kit" applied (no track switch) — punch knob reads ${punchAfterB}`)
      assert(punchAfterB !== punchAfterA, `[1] BUG: punch knob still reads ${punchAfterB}, identical to preset A's ${punchAfterA} — macro row did not re-sync on a bare preset switch (pilot 81)`)
      assert(punchAfterB >= 95, `[1] expected punch knob ~100 for 808-trap-kit's kickPunch=0.2 (clamped past the [0.02,0.15] range), got ${punchAfterB}`)
      console.log(`[1] PASS: macro row re-synced from ${punchAfterA} -> ${punchAfterB} on a bare preset switch, no track switch needed`)

      const label = await readPresetSelect()
      assert(label === '808-trap-kit', `[2] expected the preset <select> to show "808-trap-kit" right after the swap, got "${label}"`)
      console.log(`[2] PASS: preset label correctly shows "${label}" immediately after the swap`)
      results.check1 = { pass: true, punchAfterA, punchAfterB }
      results.check2 = { pass: true, label }
    }

    // ============================================================================================
    // CHECK 3 — page reload: label AND macro knob both stay consistent with the real params
    // ============================================================================================
    {
      await page.reload({ waitUntil: 'load' })
      await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 15000 })
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
      await page.evaluate(() => window.__store.getState().setSelectedTrack('drums'))
      await page.click('[data-pane-tab="device"]')
      await page.waitForSelector('[data-testid="preset-picker"]', { timeout: 5000 })
      await page.waitForSelector('[data-macro-knob="punch"]', { timeout: 5000 })

      const labelAfterReload = await readPresetSelect()
      console.log(`[3] after reload: preset <select> shows "${labelAfterReload}"`)
      assert(
        labelAfterReload === '808-trap-kit',
        `[3] BUG (pilot 86): expected the reverse-matched preset label to still read "808-trap-kit" after reload, got "${labelAfterReload}" — this is exactly the "label reverts to the wrong kit name" regression`,
      )

      const punchAfterReload = await readPunchKnob()
      console.log(`[3] after reload: punch knob reads ${punchAfterReload}`)
      assert(
        punchAfterReload >= 95,
        `[3] BUG (pilot 86): expected the punch knob to still read ~100 (808-trap-kit's real kickPunch=0.2) after reload, got ${punchAfterReload} — a "third, unrelated set of numbers"`,
      )
      // Also confirm they're mutually consistent with EACH OTHER, not just each individually
      // plausible — the label and the knob must agree on which preset is actually live.
      assert(labelAfterReload === '808-trap-kit' && punchAfterReload >= 95, '[3] label and macro knob must both point at the same (correct) preset after reload')
      console.log('[3] PASS: preset label and macro knob both survive a reload consistent with each other and the real underlying params')
      results.check3 = { pass: true, labelAfterReload, punchAfterReload }
    }

    // ============================================================================================
    // CHECK 4 — regression: an ordinary param edit elsewhere must NOT clobber a user's own
    //           in-progress macro drag (presetEpoch only advances on a real preset apply)
    // ============================================================================================
    {
      // Start a drag on "punch" (mousedown, partial move — do NOT release yet). The knob currently
      // sits at ~100 (808-trap-kit's kickPunch, still selected/applied from checks 1-3) — drag it
      // WAY down toward ~30, deliberately far from what a (buggy) re-derivation-from-live-params
      // would land on. If an ordinary edit wrongly re-triggers the same re-sync effect a preset
      // apply does, this drag would get silently snapped back toward ~100 — a value FAR from ~30,
      // so any regression is unambiguous rather than a coincidental match (the drag target
      // deliberately does NOT reuse the pre-drag ~100 value this knob already sat at).
      const knobBox = await page.$eval('[data-macro-knob="punch"] svg', (el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })
      await page.mouse.move(knobBox.x, knobBox.y)
      await page.mouse.down()
      await page.mouse.move(knobBox.x, knobBox.y + 100, { steps: 8 }) // drag down = decrease
      await sleep(150)
      const midDrag = await readPunchKnob()
      assert(midDrag <= 40, `[4] test setup: expected the drag to land well below the pre-drag ~100 (e.g. ~30) so a regression is unambiguous, got ${midDrag}`)

      // While mid-drag, fire an ORDINARY param edit on a totally different field through the same
      // real GUI edit path every other control uses (window.__bridge.postEdit, exposed by main.tsx
      // for exactly this kind of harness — see its own comment) — simulates "some other knob
      // ticked" without touching this drag. Must NOT be mistaken for a preset apply and must NOT
      // reset this knob's local drag state.
      await page.evaluate(() => window.__bridge.postEdit('drums.hatDecay', '0.05'))
      await sleep(300)

      const stillDragging = await readPunchKnob()
      await page.mouse.up()
      await sleep(200)

      console.log(`[4] mid-drag punch=${midDrag}, after an unrelated ordinary edit punch=${stillDragging}`)
      assert(
        Math.abs(stillDragging - midDrag) <= 1,
        `[4] REGRESSION: an unrelated ordinary /edit reset the user's own in-progress macro drag (${midDrag} -> ${stillDragging}) — presetEpoch must only advance on an actual preset apply, not a plain edit`,
      )
      console.log('[4] PASS: an ordinary param edit elsewhere did not clobber the in-progress drag')
      results.check4 = { pass: true, midDrag, stillDragging }
    }

    // ============================================================================================
    // CHECK 5 — "Also in scope": drag-applying a preset flashes the Device tab in the default
    //           (Clip-tab) view (pilot 80: no confirmation existed anywhere outside Device tab)
    // ============================================================================================
    {
      await page.evaluate(() => window.__store.getState().setSelectedTrack('drums'))
      await page.click('[data-pane-tab="clip"]')
      await page.waitForSelector('[data-pane-tab="clip"].active', { timeout: 5000 })
      const deviceTabBefore = await page.getAttribute('[data-pane-tab="device"]', 'data-preset-flash')
      assert(deviceTabBefore === 'false', `[5] expected the Device tab to start un-flashed, got data-preset-flash="${deviceTabBefore}"`)

      await page.click('[data-action="toggle-library"]')
      await page.waitForSelector('[data-testid="content-browser"]', { timeout: 5000 })
      await page.waitForSelector('[data-preset="techno-kit"]', { timeout: 5000 })
      await page.dragAndDrop('[data-preset="techno-kit"]', trackHeaderSel('drums'))

      await pollUntil(async () => {
        const f = readFileSync(beatPath, 'utf8')
        const section = f.slice(f.indexOf('track drums')).split(/\ntrack /)[0]
        // kickTune=50 is techno-kit's own value, distinct from 808-trap-kit's kickTune=34 (already
        // applied earlier in CHECK 1) — confirms THIS drag actually landed, not a stale match.
        return /kickTune 50\b/.test(section)
      }, '[5] techno-kit drag-apply to land in the .beat file (distinct kickTune=50, not 808-trap-kit\'s 34)')

      const flashed = await pollUntil(
        async () => (await page.getAttribute('[data-pane-tab="device"]', 'data-preset-flash')) === 'true',
        '[5] the Device tab to flash (data-preset-flash="true") right after a drag-applied preset lands',
        3000,
      )
      assert(flashed, '[5] BUG: no confirmation appeared on the Device tab after a drag-applied preset landed while the Clip tab was showing (pilot 80)')
      const stillOnClip = await page.getAttribute('[data-pane-tab="clip"]', 'aria-selected')
      assert(stillOnClip === 'true', '[5] the flash should be visible WITHOUT switching away from the Clip tab — that\'s the whole point')
      console.log('[5] PASS: Device tab flashes on a drag-applied preset, visible without leaving the default Clip-tab view')

      // And it clears itself again (transient, not a permanent badge).
      await pollUntil(
        async () => (await page.getAttribute('[data-pane-tab="device"]', 'data-preset-flash')) === 'false',
        '[5] the flash to clear itself after its timeout',
        3000,
      )
      console.log('[5] PASS: flash is transient, clears itself')
      results.check5 = { pass: true }
    }

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log('\n================ ALL PHASE 29 STREAM GB CHECKS PASSED ================')
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
    console.error('\nPHASE 29 STREAM GB VERIFY FAILED:', err)
    process.exit(1)
  })
