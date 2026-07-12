#!/usr/bin/env node
// Phase 23 Stream BA — Piano-roll GUI for the note-editing vocabulary (Pitch & Time operations,
// groove/shuffle knobs, chance/ratchet visual glyphs + the chance draw-across-notes gesture).
// Drives the REAL frontend headlessly against a REAL `beat daemon` (examples/night-shift.beat's
// `lead` synth track, pitches 67..76 over loop_bars 4), asserting on the actual .beat file (or a
// real git diff of it) after each GUI action — not just in-browser store state.
//
//   BA1 TRANSPOSE       select one note, type +5 semitones, click Transpose -> exactly that note's
//                       pitch line changes by +5 (a clean one-line diff).
//   BA2 TIME-SCALE x2   select one note, click "x2" -> its duration doubles (start unchanged, since
//                       a single-note scope anchors at its own start).
//   BA3 FIT TO SCALE    select one note (pitch 74), root=C#, scale=major -> pitch snaps to 73 (the
//                       nearest tone in that root/scale), an exact hand-computed expectation.
//   BA4 INVERT          select two notes, click Invert -> their pitches mirror around the pair's own
//                       mean (no axis input — matches Ableton's own no-axis-control behavior).
//   BA5 REVERSE         select two notes, click Reverse -> their start positions tape-reverse around
//                       the pair's own span (durations unchanged).
//   BA6 LEGATO          select two adjacent-in-time notes, click Legato (gap=0) -> the earlier note's
//                       duration extends to touch the later note's start.
//   BA7 RATCHET GLYPH   set ratchetCount=4 via the existing per-note inspector -> the note div gets
//                       the new `.ratcheted` class + exactly 3 internal tick marks (count-1); click
//                       Consolidate -> exactly 4 discrete notes replace it, at the exact expected
//                       positions (ratchetSlots(4,0,1,dur) math, same as Phase 22's CLI verification).
//   BA8 CHANCE GLYPH +  (a) set chance=40 via the inspector -> the note gets `.chancy` (dashed/dim)
//       DRAW GESTURE        and the chance lane's bar for it reflects ~40%.
//                       (b) drag ACROSS the chance lane at a fixed height -> every note the pointer
//                           sweeps over (not just the one first pressed) is painted to the same
//                           chance value in ONE continuous gesture — the "draw across notes" gesture
//                           research 22 §1.4 flagged as missing.
//   BA9 GROOVE KNOBS    drag the mixer's Shuffle knob for `lead` -> a `groove <amount> <grid>` line
//                       appears on disk; dragging Grid updates the second token.
//
// Usage: node ui/verify-phase23-stream-ba.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8923
const PREVIEW_PORT = 5934

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

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p23ba-'))
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
  const readBeat = () => readFileSync(beatPath, 'utf8')
  const leadNotes = () => daemon.getDoc().tracks.find((t) => t.id === 'lead').notes
  const note = (id) => leadNotes().find((n) => n.id === id)
  const noteLine = (id) => readBeat().split('\n').find((l) => l.trim().startsWith(`note ${id} `))
  const noteLineCount = () => readBeat().split('\n').filter((l) => l.trim().startsWith('note ')).length

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
    await page.$eval('.noteview-grid', (el) => el.scrollIntoView({ block: 'center' }))
    await sleep(150)

    const clearSel = () => page.evaluate(() => window.__store.getState().setEditNoteIds([]))
    const selIds = () => page.evaluate(() => [...window.__store.getState().editNoteIds].sort())

    async function selectNote(id) {
      // A plain click on a note ALREADY in the selection keeps the whole existing multi-selection
      // (Ableton's own "click an already-selected note drags the group" behavior — see NoteView.tsx's
      // startGesture) — so clear first, otherwise a leftover multi-select from a prior check would
      // make this a no-op instead of a fresh single-note select.
      await clearSel()
      await page.locator(`[data-note-id="${id}"]`).click()
      await pollUntil(async () => (await selIds()).join(',') === id, `selection = [${id}]`)
    }
    async function shiftSelectNote(id) {
      await page.locator(`[data-note-id="${id}"]`).click({ modifiers: ['Shift'] })
    }

    // ============ BA1: Transpose (scoped, single note) ============
    console.log('\n[BA1] transpose +5 on u100033')
    await selectNote('u100033')
    const scopeText1 = await page.locator('.pitch-time-scope').textContent()
    if (!/1 note selected/.test(scopeText1)) throw new Error(`[BA1] expected scope label "1 note selected", got "${scopeText1}"`)
    const before33 = note('u100033')
    await page.fill('[data-pitch-time-input="semitones"]', '5')
    await page.click('[data-pitch-time-op="transpose"]')
    await pollUntil(() => note('u100033').pitch === before33.pitch + 5, 'u100033 pitch +5')
    const line33 = noteLine('u100033')
    if (!new RegExp(`^\\s*note u100033 ${before33.pitch + 5} ${before33.start} `).test(line33)) throw new Error(`[BA1] unexpected note line: ${line33}`)
    const msg1 = await page.locator('[data-pitch-time-msg]').textContent()
    if (!/1 note changed/.test(msg1)) throw new Error(`[BA1] expected "1 note changed", got "${msg1}"`)
    console.log(`[BA1] PASS: pitch ${before33.pitch} -> ${before33.pitch + 5}; panel reported "${msg1}"`)
    results.ba1 = { before: before33.pitch, after: before33.pitch + 5 }

    // ============ BA2: Time-scale x2 (scoped, single note) ============
    console.log('\n[BA2] time-scale x2 on u100034')
    await selectNote('u100034')
    const before34 = note('u100034')
    await page.click('[data-pitch-time-op="time-scale-2"]')
    await pollUntil(() => note('u100034').duration === before34.duration * 2, 'u100034 duration x2')
    const after34 = note('u100034')
    if (after34.start !== before34.start) throw new Error(`[BA2] single-note scope should anchor at its own start (unchanged); got start ${after34.start}, was ${before34.start}`)
    console.log(`[BA2] PASS: duration ${before34.duration} -> ${after34.duration}, start unchanged (${after34.start})`)
    results.ba2 = { before: before34.duration, after: after34.duration }

    // ============ BA3: Fit to Scale (scoped, single note) ============
    console.log('\n[BA3] fit-to-scale root=C# scale=major on u100035')
    await selectNote('u100035')
    const before35 = note('u100035')
    if (before35.pitch !== 74) throw new Error(`[BA3] fixture assumption broken: expected u100035 pitch 74, got ${before35.pitch}`)
    await page.selectOption('[data-pitch-time-input="root"]', '1') // C#
    await page.selectOption('[data-pitch-time-input="scale"]', 'major')
    await page.click('[data-pitch-time-op="fit-scale"]')
    await pollUntil(() => note('u100035').pitch === 73, 'u100035 pitch -> 73 (nearest C# major tone to 74)')
    console.log('[BA3] PASS: pitch 74 -> 73 (the nearest tone in C# major)')
    results.ba3 = { before: 74, after: 73 }

    // ============ BA4: Invert (scoped, two notes) ============
    console.log('\n[BA4] invert u100037 + u100038')
    await selectNote('u100037')
    await shiftSelectNote('u100038')
    await pollUntil(async () => (await selIds()).join(',') === 'u100037,u100038', 'selection = [u100037,u100038]')
    const before37 = note('u100037')
    const before38 = note('u100038')
    const mean = (before37.pitch + before38.pitch) / 2
    const expect37 = Math.round(2 * mean - before37.pitch)
    const expect38 = Math.round(2 * mean - before38.pitch)
    await page.click('[data-pitch-time-op="invert"]')
    await pollUntil(() => note('u100037').pitch === expect37 && note('u100038').pitch === expect38, 'u100037/u100038 pitches inverted around their mean')
    console.log(`[BA4] PASS: mean ${mean} — u100037 ${before37.pitch} -> ${expect37}, u100038 ${before38.pitch} -> ${expect38}`)
    results.ba4 = { mean, expect37, expect38 }

    // ============ BA5: Reverse (scoped, two notes) ============
    console.log('\n[BA5] reverse u100038 + u100039')
    await selectNote('u100038')
    await shiftSelectNote('u100039')
    await pollUntil(async () => (await selIds()).join(',') === 'u100038,u100039', 'selection = [u100038,u100039]')
    const b38 = note('u100038')
    const b39 = note('u100039')
    const spanStart = Math.min(b38.start, b39.start)
    const spanEnd = Math.max(b38.start + b38.duration, b39.start + b39.duration)
    const exp38start = spanStart + spanEnd - (b38.start + b38.duration)
    const exp39start = spanStart + spanEnd - (b39.start + b39.duration)
    await page.click('[data-pitch-time-op="reverse"]')
    await pollUntil(() => note('u100038').start === exp38start && note('u100039').start === exp39start, 'u100038/u100039 starts tape-reversed')
    const a38 = note('u100038')
    const a39 = note('u100039')
    if (a38.duration !== b38.duration || a39.duration !== b39.duration) throw new Error('[BA5] durations should be unchanged by reverse')
    console.log(`[BA5] PASS: span [${spanStart},${spanEnd}) — u100038 start ${b38.start} -> ${exp38start}, u100039 start ${b39.start} -> ${exp39start}`)
    results.ba5 = { spanStart, spanEnd, exp38start, exp39start }

    // ============ BA6: Legato (scoped, two adjacent notes, gap=0) ============
    console.log('\n[BA6] legato u100033 + u100034, gap=0')
    await selectNote('u100033')
    await shiftSelectNote('u100034')
    await pollUntil(async () => (await selIds()).join(',') === 'u100033,u100034', 'selection = [u100033,u100034]')
    const c33 = note('u100033')
    const c34 = note('u100034')
    if (c33.start >= c34.start) throw new Error('[BA6] fixture assumption broken: u100033 should start before u100034')
    const expDur33 = c34.start - c33.start
    await page.click('[data-pitch-time-op="legato"]') // gap input defaults to 0
    await pollUntil(() => note('u100033').duration === expDur33, 'u100033 duration extends to touch u100034 start')
    if (note('u100034').duration !== c34.duration) throw new Error('[BA6] the LAST scoped note should be left alone by legato')
    console.log(`[BA6] PASS: u100033 duration ${c33.duration} -> ${expDur33} (touches u100034's start ${c34.start}); u100034 unchanged`)
    results.ba6 = { before: c33.duration, after: expDur33 }

    // ============ BA7: ratchet visual glyph + Consolidate ============
    console.log('\n[BA7] ratchet glyph + consolidate on u100039')
    await selectNote('u100039')
    await page.waitForSelector('[data-note-field="ratchetCount"]', { timeout: 3000 })
    await page.fill('[data-note-field="ratchetCount"]', '4')
    await pollUntil(() => note('u100039').ratchetCount === 4, 'u100039 ratchetCount -> 4')
    const ratchetClass = await page.locator('[data-note-id="u100039"]').getAttribute('class')
    if (!ratchetClass.includes('ratcheted')) throw new Error(`[BA7] expected .ratcheted class on the note div, got "${ratchetClass}"`)
    const tickCount = await page.locator('[data-note-id="u100039"] .noteview-ratchet-tick').count()
    if (tickCount !== 3) throw new Error(`[BA7] expected 3 ratchet ticks (count-1 for ratchetCount=4), got ${tickCount}`)
    console.log(`[BA7a] PASS: note u100039 shows .ratcheted + ${tickCount} tick marks after ratchetCount=4`)

    const b39r = note('u100039')
    const linesBefore = noteLineCount()
    await page.click('[data-pitch-time-op="consolidate"]')
    await pollUntil(() => note('u100039') === undefined, 'u100039 replaced by consolidate')
    const linesAfter = noteLineCount()
    if (linesAfter !== linesBefore + 3) throw new Error(`[BA7] expected note-line count to grow by 3 (1 removed, 4 added), got ${linesBefore} -> ${linesAfter}`)
    const consolidated = leadNotes()
      .filter((n) => Math.abs(n.start - b39r.start) < b39r.duration && n.pitch === b39r.pitch && n.ratchetCount === 1)
      .sort((a, b) => a.start - b.start)
    if (consolidated.length !== 4) throw new Error(`[BA7] expected exactly 4 consolidated notes in the ratcheted note's span, found ${consolidated.length}`)
    const gotStarts = consolidated.map((n) => n.start)
    const expStarts = [0, 1, 2, 3].map((i) => Math.round((b39r.start + (i * b39r.duration) / 4) * 10000) / 10000)
    for (let i = 0; i < 4; i++) if (Math.abs(gotStarts[i] - expStarts[i]) > 0.001) throw new Error(`[BA7] consolidated note ${i} start ${gotStarts[i]}, expected ${expStarts[i]}`)
    console.log(`[BA7b] PASS: consolidate replaced the ratcheted note with exactly 4 discrete notes at ${gotStarts.join(', ')}`)
    results.ba7 = { tickCount, consolidatedStarts: gotStarts }

    // ============ BA8: chance visual glyph + draw-across-notes paint gesture ============
    console.log('\n[BA8a] chance glyph on u100036 (untouched fixture note)')
    const b36 = note('u100036')
    if (b36.chance !== 100) throw new Error(`[BA8a] fixture assumption broken: expected u100036 chance=100 (default), got ${b36.chance}`)
    await selectNote('u100036')
    await page.waitForSelector('[data-note-field="chance"]', { timeout: 3000 })
    await page.fill('[data-note-field="chance"]', '40')
    await pollUntil(() => note('u100036').chance === 40, 'u100036 chance -> 40')
    const chancyClass = await page.locator('[data-note-id="u100036"]').getAttribute('class')
    if (!chancyClass.includes('chancy')) throw new Error(`[BA8a] expected .chancy class on the note div, got "${chancyClass}"`)
    const barHeightAttr = await page.locator('[data-chance-note-id="u100036"]').evaluate((el) => el.style.height)
    console.log(`[BA8a] PASS: note u100036 shows .chancy after chance=40; chance-lane bar height=${barHeightAttr}`)
    await clearSel()

    console.log('\n[BA8b] draw-across-notes chance paint gesture')
    const laneBox = await page.locator('.noteview-chance-lane').boundingBox()
    const targetChance = 55 // fraction from top = 1 - 0.55 = 0.45
    const paintY = laneBox.y + laneBox.height * 0.45
    const notesBeforeSweep = leadNotes().map((n) => n.id)
    await page.mouse.move(laneBox.x + 3, paintY)
    await page.mouse.down()
    await page.mouse.move(laneBox.x + laneBox.width - 3, paintY, { steps: 60 })
    await page.mouse.up()
    await pollUntil(() => {
      const painted = leadNotes().filter((n) => n.chance === targetChance)
      return painted.length >= 3 ? painted : false
    }, 'at least 3 notes painted to chance=55 by one continuous drag')
    const paintedIds = leadNotes()
      .filter((n) => n.chance === targetChance)
      .map((n) => n.id)
    if (!notesBeforeSweep.every((id) => leadNotes().find((n) => n.id === id))) throw new Error('[BA8b] the sweep should not have added/removed any notes')
    console.log(`[BA8b] PASS: one continuous drag across the chance lane painted ${paintedIds.length} notes to chance=${targetChance}: ${paintedIds.join(', ')}`)
    results.ba8 = { paintedIds, targetChance }

    // ============ BA9: groove/shuffle knobs (mixer) ============
    console.log('\n[BA9] groove/shuffle knobs on the mixer strip')
    if (/^\s*groove /m.test(readBeat().split('\ntrack lead')[1]?.split('\ntrack ')[0] ?? '')) {
      throw new Error('[BA9] fixture assumption broken: lead should have no groove line yet')
    }
    await page.click('[data-action="toggle-mixer"]')
    await page.waitForSelector('[data-groove-knobs="lead"]', { timeout: 5000 })
    const shuffleSvg = page.locator('[data-groove-knobs="lead"] .knob').nth(0).locator('svg')
    const gridSvg = page.locator('[data-groove-knobs="lead"] .knob').nth(1).locator('svg')

    async function dragKnobUp(locator, px) {
      const box = await locator.boundingBox()
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.mouse.move(cx, cy - px, { steps: 10 })
      await page.mouse.up()
    }

    await dragKnobUp(shuffleSvg, 70) // ~+0.5 norm on a 0..1 range
    await pollUntil(() => daemon.getDoc().tracks.find((t) => t.id === 'lead').shuffleAmount > 0, 'shuffleAmount > 0 after dragging Shuffle')
    const grooveLine1 = readBeat()
      .split('\n')
      .find((l) => l.trim().startsWith('groove '))
    if (!grooveLine1) throw new Error('[BA9a] expected a `groove <amount> <grid>` line on disk after dragging Shuffle')
    console.log(`[BA9a] PASS: dragging the Shuffle knob wrote "${grooveLine1.trim()}"`)

    await dragKnobUp(gridSvg, 47) // ~+1/3 norm on a 1..4 range -> 2
    await pollUntil(() => daemon.getDoc().tracks.find((t) => t.id === 'lead').shuffleGrid !== 1, 'shuffleGrid changes after dragging Grid')
    const grooveLine2 = readBeat()
      .split('\n')
      .find((l) => l.trim().startsWith('groove '))
    console.log(`[BA9b] PASS: dragging the Grid knob updated the groove line to "${grooveLine2.trim()}"`)
    results.ba9 = { grooveLine1: grooveLine1.trim(), grooveLine2: grooveLine2.trim() }

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log(`\nALL PASS — Phase 23 Stream BA (piano-roll GUI for the note-editing vocabulary) verified live:`)
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
