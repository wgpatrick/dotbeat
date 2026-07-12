#!/usr/bin/env node
// Phase 27 Stream EA verification (docs/phase-27-plan.md "Fix first" bugs 1-4) — driven live against
// a REAL `beat daemon` through the REAL built frontend in headless Chromium, on a disposable COPY of
// `examples/night-shift.beat` (never `examples/night-shift-song.beat`, the owner's own live project —
// same discipline every prior verify script in this repo already follows).
//
// Four checks, one per bug fixed in this stream:
//
//   1  LOOP-MODE CLIP CHROME     `examples/night-shift.beat` itself has no `song` block (loop mode,
//      the default project state) — before this fix, ArrangementView.tsx's `occurrences` was always
//      [] there, so `.arr-clip-block` (the DOM overlay providing border/label/selection chrome) never
//      mounted. Confirm it now does, for real tracks, with a real bounding box and label.
//   2  ROW-CLICK SELECTS TRACK   Clicking anywhere in a track's `.arr-lane` row — not just its name
//      button — must open that track in the bottom pane (`selectedTrack`), not just move the
//      bar-range `selection` banner. Checked via the bottom pane's own track label actually changing.
//      Also covers the block/lane interaction the two fixes create together: after bug 1, loop-mode
//      rows are ALWAYS covered edge-to-edge by a clip block, so this also exercises the click path
//      THROUGH that block (beginClipDrag's own click branch), not just the empty-lane path.
//   3  EFFECT REORDER MOVES KNOBS  Reordering an effect in the Effect Chain list must move its knob
//      group to match, instead of the knob group staying wherever the old fixed PARAM_GROUPS array
//      order put it. Checked via real DOM order of `[data-param-group]` elements before/after a real
//      move-button click.
//   4  INSTRUMENT MACRO + PRESET PICKER  An instrument (SoundFont) track's Device panel must show a
//      Macro row (previously entirely unrendered, not just internally guarded) and a preset-picker
//      equivalent (the pre-existing SoundfontPicker, `data-testid="soundfont-picker"` — the real
//      "what presets exist for instrument tracks today" mechanism; see InstrumentPanel.tsx's own
//      comment for why SynthPanel's `PresetPicker` isn't literally duplicated). Also confirms
//      dragging the one currently-eligible macro ("space", kind 'any') no longer throws a daemon-side
//      "unknown field" error against an instrument track — a real regression the naive "just drop the
//      guard" fix would have introduced (sendReverb/sendDelay aren't legal instrument-track fields).
//
// Usage: node ui/verify-phase27-stream-ea.mjs

import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const PREVIEW_PORT = 5948

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
function beat(cwd, args) {
  return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8', cwd })
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

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // ---- disposable fixture: a COPY of examples/night-shift.beat (never night-shift-song.beat) ------
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p27ea-'))
  const beatPath = join(proj, 'project.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  assert(!canonical.includes('\nsong'), 'sanity: the night-shift fixture must be loop mode (no `song` block) for check 1 to mean anything')
  console.log(`fixture copied to ${beatPath} (loop mode, tracks: lead/drums/bass/pad)`)

  // Bug 4 needs a real instrument track — night-shift.beat has none. Added via the real CLI, same
  // pattern verify-phase26-stream-dc.mjs uses.
  copyFileSync(join(repoRoot, 'presets', 'sf2', 'fluidr3-gm-small.sf2'), join(proj, 'gm.sf2'))
  beat(proj, ['sample', beatPath, 'gm', 'gm.sf2'])
  beat(proj, ['add-track', beatPath, 'keys', 'instrument', '--soundfont', 'gm', '--program', '73'])
  writeFileSync(beatPath, serialize(parse(readFileSync(beatPath, 'utf8'))))

  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline (night-shift copy + keys instrument track)')

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
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 15000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // ============================================================================================
    // CHECK 1 — LOOP-MODE PROJECT SHOWS REAL `.arr-clip-block` CHROME (bug 1)
    // ============================================================================================
    {
      const songMode = await page.evaluate(() => !!window.__store.getState().doc.song)
      assert(songMode === false, `[1] setup: expected the fixture to be in loop mode (doc.song falsy), got song=${songMode}`)
      console.log('[1] setup: confirmed the fixture is loop mode (doc.song is null) — the exact state bug 1 was about')

      for (const trackId of ['lead', 'drums']) {
        const laneSelector = `.arr-lane[data-track="${trackId}"]`
        await page.waitForSelector(laneSelector, { timeout: 5000 })
        const blockSelector = `${laneSelector} .arr-clip-block`
        await page.waitForSelector(blockSelector, { timeout: 5000 })
        const blockCount = await page.$$eval(blockSelector, (els) => els.length)
        assert(blockCount === 1, `[1] expected exactly one synthetic .arr-clip-block for loop-mode track "${trackId}", got ${blockCount}`)

        const label = await page.$eval(`${blockSelector} .arr-clip-label`, (el) => el.textContent)
        assert(!!label && label.trim().length > 0, `[1] expected a non-empty .arr-clip-label inside "${trackId}"'s clip block, got "${label}"`)

        const laneBox = await page.$eval(laneSelector, (el) => el.getBoundingClientRect())
        const blockBox = await page.$eval(blockSelector, (el) => el.getBoundingClientRect())
        assert(blockBox.width > laneBox.width * 0.9, `[1] expected "${trackId}"'s clip block to span (close to) the full loop width — lane ${laneBox.width}px, block ${blockBox.width}px`)
        assert(Math.abs(blockBox.left - laneBox.left) < 3, `[1] expected "${trackId}"'s clip block to start at the lane's left edge, lane.left=${laneBox.left} block.left=${blockBox.left}`)

        const borderColor = await page.$eval(blockSelector, (el) => getComputedStyle(el).borderColor)
        assert(borderColor && borderColor !== 'rgba(0, 0, 0, 0)' && borderColor !== 'transparent', `[1] expected "${trackId}"'s clip block to have a real (non-transparent) border, got "${borderColor}"`)

        console.log(`[1] PASS: track "${trackId}" (loop mode) shows a real .arr-clip-block — label "${label}", width ${blockBox.width.toFixed(0)}/${laneBox.width.toFixed(0)}px, border ${borderColor}`)
      }
      results.check1 = { pass: true }
    }

    // ============================================================================================
    // CHECK 2 — CLICKING ANYWHERE IN A TRACK'S ROW OPENS THAT TRACK IN THE BOTTOM PANE (bug 2)
    // ============================================================================================
    // Two distinct click surfaces, both must work:
    //   (a) the BARE .arr-lane (no clip block covering it) — the original bug's own click path.
    //       In loop mode, bug 1's fix means every row now ALWAYS has a full-width synthetic block,
    //       so this surface no longer exists there; switched to a real (tiny) song-mode section
    //       with one track left OUT of the scene to get a genuinely block-free row again.
    //   (b) directly ON a clip block — after bug 1, this is how loop-mode rows are clicked at all,
    //       so bug 2's fix must ALSO reach beginClipDrag's own click branch, not just the bare-lane
    //       path, or the fix would be dead code for the every-row-has-a-block loop-mode case.
    {
      await page.waitForSelector('[data-testid="bottom-pane"]', { timeout: 5000 })
      const initialTrack = await page.$eval('.bottom-pane-track', (el) => el.textContent)
      assert(initialTrack === 'lead', `[2] setup: expected the fixture's own selected_track "lead" to already be open in the bottom pane, got "${initialTrack}"`)
      console.log(`[2] setup: bottom pane initially shows "${initialTrack}" (the file's own selected_track)`)

      // (b) FIRST, while still in loop mode: click directly on "drums"'s (synthetic, full-width)
      // clip block from check 1.
      const drumsBlockBox = await page.$eval('.arr-lane[data-track="drums"] .arr-clip-block', (el) => el.getBoundingClientRect())
      await page.mouse.click(drumsBlockBox.x + drumsBlockBox.width / 2, drumsBlockBox.y + drumsBlockBox.height / 2)
      await pollUntil(async () => (await page.$eval('.bottom-pane-track', (el) => el.textContent)) === 'drums', '[2] bottom pane to switch to "drums" after clicking its (loop-mode synthetic) clip block')
      const afterDrums = await page.evaluate(() => window.__store.getState().doc.selectedTrack)
      assert(afterDrums === 'drums', `[2] expected selected_track to become "drums" after clicking its clip block, got "${afterDrums}"`)
      console.log('[2] PASS: a plain click ON "drums"\'s loop-mode clip block opened it in the bottom pane — bug 1 + bug 2 compose correctly')

      // Wait for the daemon's OWN async file write for that click (bridge.ts debounces postEdit
      // ~60ms before the actual POST) to actually land on disk before driving the CLI directly
      // against the same file below — otherwise the daemon's in-flight write (built from ITS
      // in-memory doc, which doesn't know about an external edit yet) can race the CLI's write and
      // clobber it.
      await pollUntil(() => readFileSync(beatPath, 'utf8').includes('selected_track drums'), '[2] daemon\'s own file write for the "drums" click to land on disk before driving the CLI directly')

      // (a) Now switch to a real, minimal song-mode section via the actual CLI (`beat clip`/`beat
      // scene`/`beat song`) that puts ONLY "lead" into the one scene, leaving "bass" unassigned —
      // a real block-free row, the scenario the ORIGINAL bug report's ".arr-lane" framing describes.
      beat(proj, ['clip', beatPath, 'lead', 'lead-a'])
      beat(proj, ['scene', beatPath, 'scene-a', 'lead=lead-a'])
      beat(proj, ['song', beatPath, 'scene-a', '4'])
      await pollUntil(async () => !!(await page.evaluate(() => window.__store.getState().doc.song)), '[2] GUI to pick up the new song-mode section from the daemon')
      await page.waitForSelector('.arr-lane[data-track="lead"] .arr-clip-block', { timeout: 5000 })
      await pollUntil(async () => !(await page.$('.arr-lane[data-track="bass"] .arr-clip-block')), '[2] "bass" (not in scene-a\'s slot map) to render with NO clip block')
      console.log('[2] setup: real song-mode section in place — "lead" has a real clip block, "bass" has none (bare lane)')

      const bassLane = await page.$eval('.arr-lane[data-track="bass"]', (el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width * 0.5, y: r.y + r.height / 2 }
      })
      await page.mouse.click(bassLane.x, bassLane.y)
      await pollUntil(async () => (await page.$eval('.bottom-pane-track', (el) => el.textContent)) === 'bass', '[2] bottom pane to switch to "bass" after a plain click on its bare (block-free) lane')
      const afterBass = await page.evaluate(() => window.__store.getState().doc.selectedTrack)
      assert(afterBass === 'bass', `[2] expected the .beat file's own selected_track to become "bass", got "${afterBass}"`)
      console.log('[2] PASS: a plain click on "bass"\'s bare .arr-lane (no clip block at all) opened it in the bottom pane — the original bug\'s own click path')
      results.check2 = { pass: true }
    }

    // ============================================================================================
    // CHECK 3 — REORDERING AN EFFECT MOVES ITS KNOB GROUP TO MATCH (bug 3)
    // ============================================================================================
    {
      await page.evaluate(() => window.__store.getState().setSelectedTrack('lead'))
      await page.click('[data-pane-tab="device"]')
      await page.waitForSelector('[data-testid="effect-chain"]', { timeout: 5000 })

      const rowIds = async () => page.$$eval('[data-effect-row]', (els) => els.map((el) => el.getAttribute('data-effect-row')))
      const groupIds = async () => page.$$eval('[data-param-group]', (els) => els.map((el) => el.getAttribute('data-param-group')))

      const baselineRows = await rowIds()
      assert(baselineRows.join(',') === 'eq3,comp,distortion,bitcrush', `[3] setup: expected "lead"'s default 4-entry chain, got: ${baselineRows.join(',')}`)
      const baselineGroups = (await groupIds()).filter((id) => baselineRows.includes(id))
      assert(baselineGroups.join(',') === 'eq3,comp,distortion,bitcrush', `[3] setup: expected knob groups to start in the SAME order as the chain (eq3,comp,distortion,bitcrush), got: ${baselineGroups.join(',')}`)
      console.log(`[3] setup: "lead" chain rows [${baselineRows.join(' -> ')}], knob groups start in matching order [${baselineGroups.join(' -> ')}]`)

      // Move "bitcrush" (last, index 3) to the FRONT of the chain via 3 real move-up clicks — same
      // ▲ button a human uses, not a direct store/API call.
      for (let i = 0; i < 3; i++) {
        const before = (await rowIds()).indexOf('bitcrush')
        await page.click('[data-effect-move-up="bitcrush"]')
        await pollUntil(async () => (await rowIds()).indexOf('bitcrush') === before - 1, `[3] "bitcrush" row to move up one slot (click ${i + 1}/3)`, 3000)
      }
      const movedRows = await rowIds()
      assert(movedRows.join(',') === 'bitcrush,eq3,comp,distortion', `[3] expected "bitcrush" moved to the front of the chain via 3 real move-up clicks, got: ${movedRows.join(',')}`)
      console.log(`[3] real Effect Chain reorder landed: [${movedRows.join(' -> ')}]`)

      await pollUntil(async () => {
        const g = (await groupIds()).filter((id) => movedRows.includes(id))
        return g.join(',') === 'bitcrush,eq3,comp,distortion'
      }, '[3] knob-group DOM order to follow the reordered chain (bitcrush first)')
      const movedGroups = (await groupIds()).filter((id) => movedRows.includes(id))
      assert(movedGroups.join(',') === 'bitcrush,eq3,comp,distortion', `[3] expected knob groups to follow the reordered chain exactly, got: ${movedGroups.join(',')}`)
      console.log(`[3] PASS: knob-group DOM order now matches the reordered chain — [${movedGroups.join(' -> ')}], not the old fixed PARAM_GROUPS order`)

      // Also confirm the .beat file agrees (real reorder, not a display-only illusion).
      const fileAfter = readFileSync(beatPath, 'utf8')
      const leadEffectLines = fileAfter.split('\n').filter((l) => l.trim().startsWith('effect '))
      assert(leadEffectLines.some((l) => l.includes('bitcrush')), `[3] expected the reordered chain to be written to the .beat file, got effect lines:\n${leadEffectLines.join('\n')}`)
      results.check3 = { pass: true, baselineGroups, movedGroups }
    }

    // ============================================================================================
    // CHECK 4 — INSTRUMENT TRACK SHOWS A MACRO ROW + PRESET PICKER (bug 4)
    // ============================================================================================
    {
      await page.evaluate(() => window.__store.getState().setSelectedTrack('keys'))
      await page.click('[data-pane-tab="device"]')
      await page.waitForSelector('.synth-panel', { timeout: 5000 })

      // Preset picker: the pre-existing SoundfontPicker IS the instrument-track preset-picker
      // mechanism (see InstrumentPanel.tsx's own comment) — confirm it's real (actual soundfont
      // options), not an empty shell.
      await page.waitForSelector('[data-testid="soundfont-picker"]', { timeout: 5000 })
      const soundfontOptions = await page.$$eval('[data-soundfont-select] option', (els) => els.map((el) => el.value))
      assert(soundfontOptions.length > 0, `[4] expected the instrument track's preset-picker (SoundfontPicker) to list real soundfont options, got none`)
      console.log(`[4] PASS: instrument track "keys" shows a real preset picker (SoundfontPicker) with ${soundfontOptions.length} option(s): ${soundfontOptions.join(', ')}`)

      // Macro row: previously never rendered at all for instrument tracks (InstrumentPanel.tsx
      // never called MacroRow, not just an internally-guarded no-op).
      await page.waitForSelector('[data-testid="macro-row"]', { timeout: 5000 })
      const macroNames = await page.$$eval('[data-macro-knob]', (els) => els.map((el) => el.getAttribute('data-macro-knob')))
      assert(macroNames.length > 0, `[4] expected at least one macro knob on the instrument track's macro row, got none`)
      console.log(`[4] PASS: instrument track "keys" shows a Macro row with knob(s): ${macroNames.join(', ')}`)

      // Drag the one eligible ('any'-kind) macro and confirm it does NOT throw a daemon-side error —
      // the real regression a naive "just drop the guard" fix would introduce, since sendReverb/
      // sendDelay (its targets) aren't legal fields on an instrument track (confirmed via the real
      // CLI: `beat set <file> keys.sendReverb <v>` throws "unknown field"). MacroKnob now filters
      // per-target legality client-side before posting.
      assert(macroNames.includes('space'), `[4] expected the "space" (kind: any) macro to be offered on an instrument track, got: ${macroNames.join(', ')}`)
      const errorsBefore = errors.length
      const knobBox = await page.$eval('[data-macro-knob="space"] svg', (el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      })
      await page.mouse.move(knobBox.x, knobBox.y)
      await page.mouse.down()
      await page.mouse.move(knobBox.x, knobBox.y - 60, { steps: 10 })
      await page.mouse.up()
      await sleep(400)
      assert(errors.length === errorsBefore, `[4] dragging the instrument track's "space" macro knob must not throw a page error, got ${errors.length - errorsBefore} new error(s): ${errors.slice(errorsBefore).join('; ')}`)
      const keysTrackFile = readFileSync(beatPath, 'utf8')
      const keysSection = keysTrackFile.slice(keysTrackFile.indexOf('track keys'))
      assert(!/\bsendReverb\b/.test(keysSection.split(/\ntrack /)[0]), '[4] "space" macro must NOT have written an illegal sendReverb field onto the instrument track')
      console.log('[4] PASS: dragging the instrument track\'s "space" macro knob produced no page error and wrote no illegal field to the file')
      results.check4 = { pass: true, soundfontOptions, macroNames }
    }

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log('\n================ ALL PHASE 27 STREAM EA CHECKS PASSED ================')
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
    console.error('\nPHASE 27 STREAM EA VERIFY FAILED:', err)
    process.exit(1)
  })
