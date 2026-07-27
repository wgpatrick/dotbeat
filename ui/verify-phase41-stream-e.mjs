#!/usr/bin/env node
// Phase 41 Stream E — Scale Mode, note deactivate, and the velocity Ramp/Randomize toolbar.
// Drives the REAL frontend headlessly against a REAL `beat daemon`, asserting on the actual .beat
// file after each GUI action — not just in-browser store state. Same shape as
// ui/verify-phase23-stream-ba.mjs, which covers the Pitch & Time panel this stream sits beside.
//
// The scale checks deliberately use C# with a THIRD-LESS scale, because that is the case the whole
// row exists for and it is the one no pre-v0.12 scale could express. Every named scale dotbeat had
// contains a 3 or a 4, i.e. commits a melody to major or minor; suspended/modal music does not, and
// against that harmony both thirds are wrong notes. E is the minor third of C#, so "the lock stops
// you writing an E" is the single assertion that proves the feature works at all.
//
//   E1 SCALE DECLARED     pick root C# + susPentatonic in the Scale panel -> a `scale 1
//                         susPentatonic` line appears on disk, and the panel badges it "no third".
//   E2 ROW SHADING        exactly the in-scale rows carry `.noteview-scalerow`, the root rows are
//                         marked, and NO row for E or F (the two thirds) is shaded — checked
//                         against a hand-computed pitch set, not against the app's own opinion.
//   E3 LOCK STOPS AN E    with the lock on, click the E row -> the note that lands is NOT an E; it
//                         is the nearest in-scale pitch, and a toast says so.
//   E4 LOCK OFF           uncheck the lock, click the same E row -> an E lands. The lock is doing
//                         the work, not the scale declaration on its own.
//   E5 CUSTOM SCALE       switch to `custom` with 0,5,7,10 -> the file carries the explicit set and
//                         the shading narrows to match (D#, in scale before, is now out).
//   E6 MUTE VIA `0`       select a note, press 0 -> `active=0` on its line, the note div gains
//                         `.muted`, the note is NOT deleted, and every other field survives.
//   E7 UNMUTE + MIXED     press 0 again -> the token is gone. With a mixed selection, one press
//                         mutes ALL (rather than inverting each), which is the only behavior that
//                         doesn't read as the key being broken.
//   E8 VELOCITY RAMP      select 3 notes, Ramp 0.2 -> 0.8 -> their velocities are exactly
//                         0.2/0.5/0.8 in START-TIME order, matching core's rampVelocityAt.
//   E9 RAMP FLIP          click the ⇄ button -> the same three velocities run the other way.
//  E10 RANDOMIZE          click Randomize -> every velocity moved, all stayed inside 0..1 and
//                         within the stated ± amount.
//  E11 HUMANIZE BUTTON    click "Humanize track" -> note starts actually move on disk (the button
//                         is wired, not decorative).
//
// Usage: node ui/verify-phase41-stream-e.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8941
const PREVIEW_PORT = 5941

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
const failures = []
function ok(label) {
  checks++
  console.log(`  ok — ${label}`)
}
function check(cond, label, detail) {
  if (cond) return ok(label)
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
  console.log(`  FAIL — ${label}${detail ? ` — ${detail}` : ''}`)
}

// C# = pitch class 1. susPentatonic = 0,2,5,7,10 root-relative -> absolute pitch classes
// 1 (C#), 3 (D#), 6 (F#), 8 (G#), 11 (B). The two thirds — E (4) and F (5) — are OUT.
const CSHARP = 1
const SUS_PENT_PCS = [1, 3, 6, 8, 11]
const pcOf = (p) => ((p % 12) + 12) % 12

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p41e-'))
  const beatPath = join(proj, 'night-shift.beat')
  writeFileSync(beatPath, serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))))

  const daemon = await startDaemon({ filePath: beatPath, port: PORT })
  console.log(`daemon up on :${daemon.port}, project ${beatPath}`)
  const readBeat = () => readFileSync(beatPath, 'utf8')
  const leadNotes = () => daemon.getDoc().tracks.find((t) => t.id === 'lead').notes
  const leadTrack = () => daemon.getDoc().tracks.find((t) => t.id === 'lead')
  const noteLine = (id) => readBeat().split('\n').find((l) => l.trim().startsWith(`note ${id} `))
  const noteCount = () => leadNotes().length

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
    20000,
  )
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1600, height: 1100 })
    const errors = []
    page.on('pageerror', (e) => {
      errors.push(String(e))
      console.log(`[pageerror] ${e}`)
    })
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 15000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })

    await page.click('.arr-track-select:has(.arr-track-name:text-is("lead"))')
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    await page.waitForSelector('[data-testid="scale-panel"]', { timeout: 5000 })
    await pollUntil(() => daemon.getDoc().selectedTrack === 'lead', 'lead selection to record')
    await page.$eval('.noteview-grid', (el) => el.scrollIntoView({ block: 'center' }))
    await sleep(200)

    const clearSel = () => page.evaluate(() => window.__store.getState().setEditNoteIds([]))
    const selIds = () => page.evaluate(() => [...window.__store.getState().editNoteIds].sort())
    async function selectNote(id) {
      await clearSel()
      await page.locator(`[data-note-id="${id}"]`).click()
      await pollUntil(async () => (await selIds()).join(',') === id, `selection = [${id}]`)
    }

    // ============ E1: declare C# susPentatonic ============
    console.log('\nE1 — declare a third-less scale (C# susPentatonic)')
    await page.selectOption('[data-scale-input="root"]', String(CSHARP))
    await page.selectOption('[data-scale-input="name"]', 'susPentatonic')
    await pollUntil(() => leadTrack().scale !== null, 'scale to reach the daemon')
    check(/^ {2}scale 1 susPentatonic$/m.test(readBeat()), 'E1 the .beat file carries `scale 1 susPentatonic`', readBeat().split('\n').filter((l) => l.includes('scale')).join(' | '))
    const noThird = await page.locator('[data-scale-no-third]').count()
    check(noThird === 1, 'E1 the panel badges the scale as having no third')

    // ============ E2: row shading matches a hand-computed pitch set ============
    console.log('\nE2 — in-scale row shading')
    const shaded = await page.$$eval('[data-scale-row]', (els) => els.map((e) => Number(e.getAttribute('data-scale-row'))))
    check(shaded.length > 0, 'E2 some rows are shaded at all', `${shaded.length} shaded`)
    const wrongShaded = shaded.filter((p) => !SUS_PENT_PCS.includes(pcOf(p)))
    check(wrongShaded.length === 0, 'E2 every shaded row is genuinely in C# susPentatonic', `out-of-scale rows shaded: ${wrongShaded.join(',')}`)
    const anyE = shaded.filter((p) => pcOf(p) === 4)
    const anyF = shaded.filter((p) => pcOf(p) === 5)
    check(anyE.length === 0 && anyF.length === 0, 'E2 NO E row and NO F row is shaded (the two thirds are excluded)', `E:${anyE.join(',')} F:${anyF.join(',')}`)
    const roots = await page.$$eval('[data-scale-root="true"]', (els) => els.map((e) => Number(e.getAttribute('data-scale-row'))))
    check(roots.length > 0 && roots.every((p) => pcOf(p) === CSHARP), 'E2 the marked root rows are all C#', roots.join(','))

    // ============ E3: the lock stops you writing an E ============
    console.log('\nE3 — scale lock refuses an out-of-key note')
    await page.check('[data-scale-input="lock"]')
    await pollUntil(async () => (await page.locator('[data-scale-locked="true"]').count()) === 1, 'lock to engage')
    // Geometry off the REAL rendered shaded rows rather than recomputed from scratch: each
    // `[data-scale-row]` div is one row of the axis at a known pitch, so one of their bounding
    // boxes plus the fixed row height gives any other row's y without trusting a second copy of the
    // axis math. Rows ascend upward (row 0 is the window's top pitch), hence the sign.
    const ROW_H = 12
    const rowPitches = (await page.$$eval('[data-scale-row]', (els) => els.map((e) => Number(e.getAttribute('data-scale-row'))))).sort((a, b) => a - b)
    const refPitch = rowPitches[Math.floor(rowPitches.length / 2)]
    const refBox = await page.locator(`[data-scale-row="${refPitch}"]`).boundingBox()
    const gridBox = await page.locator('.noteview-grid').boundingBox()
    const stepW = gridBox.width / (daemon.getDoc().loopBars * 16)
    const xForStep = (st) => gridBox.x + (st + 0.5) * stepW
    const yForPitch = (p) => refBox.y + (refPitch - p) * ROW_H + ROW_H / 2

    /** Steps currently covered by a note (plus a step of slack either side), so a tap-to-add is
     * never turned into a select-and-drag on an existing note. */
    function usedStepsNow() {
      const out = new Set()
      for (const n of leadNotes()) {
        for (let st = Math.floor(n.start) - 1; st <= Math.ceil(n.start + n.duration); st++) out.add(st)
      }
      return out
    }

    /** Finds a (pitch, step) pair whose screen point genuinely LANDS on the note grid, by asking
     * the page rather than trusting arithmetic. Three separate things swallowed clicks here while
     * this script was being written, and none of them are visible in a bounding box: the piano-key
     * gutter is sticky and overhangs the grid's own left edge; the grid is taller than its scroll
     * container, so `boundingBox()` reports coordinates that are clipped by an ancestor and resolve
     * to that ancestor instead; and the arrangement pane above overlaps part of the grid's box
     * depending on where the pane divider sits, which moves as soon as this stream's own panels
     * render. So: SCAN for rows that actually hit `.noteview-grid`, derive their pitch from the
     * row geometry, and choose among those. A harness that clicks into furniture reports a feature
     * failure that isn't one, which is the exact class of false result these scripts exist to
     * avoid. `wantPc` picks the pitch class to aim at (4 = E, the minor third of C#). */
    async function findClickablePoint(wantPc, fromStep) {
      const used = usedStepsNow()
      const steps = daemon.getDoc().loopBars * 16
      // Candidate x values first: the leftmost few steps sit under the sticky key gutter.
      const xCandidates = []
      for (let st = fromStep; st < steps; st++) {
        if (used.has(st)) continue
        xCandidates.push({ step: st, x: xForStep(st) })
      }
      if (xCandidates.length === 0) throw new Error('every step on the grid already has a note under it')
      // Walk every row of the axis, keep the ones that genuinely hit the grid, and convert each
      // back to its pitch through the SAME mapping the shading rows gave us.
      const rowsToTry = []
      for (let y = gridBox.y + ROW_H / 2; y < gridBox.y + gridBox.height; y += ROW_H) {
        const pitch = Math.round(refPitch - (y - refBox.y - ROW_H / 2) / ROW_H)
        if (pcOf(pitch) !== wantPc) continue
        rowsToTry.push({ pitch, y })
      }
      for (const row of rowsToTry) {
        for (const cand of xCandidates) {
          const hit = await page.evaluate(
            ({ x, y }) => {
              const el = document.elementFromPoint(x, y)
              return !!el && el.classList.contains('noteview-grid')
            },
            { x: cand.x, y: row.y },
          )
          if (hit) return { pitch: row.pitch, step: cand.step, x: cand.x, y: row.y }
        }
      }
      throw new Error(
        `no clickable empty grid point found for pitch class ${wantPc}; refPitch=${refPitch} refBox.y=${refBox.y} gridBox=${JSON.stringify(gridBox)} rowsTried=${rowsToTry.map((r) => r.pitch).join(',')} xTried=${xCandidates.length}`,
      )
    }

    const spotE = await findClickablePoint(4, 0)
    const targetE = spotE.pitch
    const freeStep = spotE.step

    // Identify the new note by DIFFING id sets, never by "the last element". The daemon re-parses
    // its own canonical serialization, which sorts notes by (start, pitch, id) — so the array's tail
    // is the latest-starting note, not the one just added. Taking the tail made this check report
    // an unrelated pre-existing note's pitch and read as a feature failure.
    const idsBefore3 = new Set(leadNotes().map((n) => n.id))
    const before3 = noteCount()
    await page.mouse.click(spotE.x, spotE.y)
    await pollUntil(() => noteCount() === before3 + 1, `a note to be added at step ${freeStep}, pitch ${targetE}`)
    const added3 = leadNotes().find((n) => !idsBefore3.has(n.id))
    check(pcOf(added3.pitch) !== 4, 'E3 clicking the E row under lock did NOT produce an E', `landed on pitch ${added3.pitch} (pc ${pcOf(added3.pitch)}), aimed at ${targetE}`)
    check(SUS_PENT_PCS.includes(pcOf(added3.pitch)), 'E3 the note that landed IS in the declared scale', `pc ${pcOf(added3.pitch)}`)
    check(Math.abs(added3.pitch - targetE) <= 2, 'E3 it snapped to a NEARBY in-scale row, not somewhere arbitrary', `aimed ${targetE}, got ${added3.pitch}`)
    check(added3.start === freeStep, 'E3 the snap moved the PITCH only — the time the user clicked is respected', `clicked step ${freeStep}, got ${added3.start}`)
    const toastText = await page
      .locator('.toast, [data-testid="toast"]')
      .first()
      .textContent()
      .catch(() => null)
    check(!!toastText && /not in/i.test(toastText), 'E3 a toast explains why the note moved', toastText ?? '(no toast found)')

    // ============ E4: with the lock off, the same click DOES write an E ============
    console.log('\nE4 — lock off: the same click writes the E')
    await page.uncheck('[data-scale-input="lock"]')
    await sleep(150)
    const spotE4 = await findClickablePoint(4, freeStep + 2)
    const idsBefore4 = new Set(leadNotes().map((n) => n.id))
    const before4 = noteCount()
    await page.mouse.click(spotE4.x, spotE4.y)
    await pollUntil(() => noteCount() === before4 + 1, 'a second note to be added')
    const added4 = leadNotes().find((n) => !idsBefore4.has(n.id))
    check(pcOf(added4.pitch) === 4, 'E4 with the lock off an E lands — the LOCK is what refused, not the declaration', `pitch ${added4.pitch}, aimed ${spotE4.pitch}`)
    check(added4.pitch === spotE4.pitch, 'E4 the note landed on exactly the row aimed at (so the harness geometry is trustworthy)', `aimed ${spotE4.pitch}, got ${added4.pitch}`)

    // ============ E5: a custom pitch-class set ============
    console.log('\nE5 — custom pitch-class set')
    await page.selectOption('[data-scale-input="name"]', 'custom')
    await page.waitForSelector('[data-scale-input="custom"]', { timeout: 4000 })
    await page.fill('[data-scale-input="custom"]', '0,5,7,10')
    await page.press('[data-scale-input="custom"]', 'Enter')
    await pollUntil(() => /scale 1 custom 0,5,7,10/.test(readBeat()), 'the custom scale to land on disk')
    ok('E5 the .beat file carries `scale 1 custom 0,5,7,10`')
    const shaded5 = await page.$$eval('[data-scale-row]', (els) => els.map((e) => Number(e.getAttribute('data-scale-row'))))
    const CUSTOM_PCS = [1, 6, 8, 11] // root-relative 0,5,7,10 from C#
    check(
      shaded5.every((p) => CUSTOM_PCS.includes(pcOf(p))),
      'E5 shading narrowed to the custom set (D#, in scale a moment ago, is now out)',
      shaded5.filter((p) => !CUSTOM_PCS.includes(pcOf(p))).join(','),
    )
    // put susPentatonic back for the remaining checks
    await page.selectOption('[data-scale-input="name"]', 'susPentatonic')
    await pollUntil(() => /scale 1 susPentatonic/.test(readBeat()), 'susPentatonic to be restored')

    // ============ E6: mute via the `0` key ============
    console.log('\nE6 — mute a note in place with `0`')
    const victim = leadNotes()[0]
    await selectNote(victim.id)
    const countBefore = noteCount()
    await page.locator('.noteview-grid').focus()
    await page.keyboard.press('0')
    await pollUntil(() => /active=0/.test(noteLine(victim.id) ?? ''), 'active=0 to land on disk')
    ok('E6 the note line gains `active=0`')
    check(noteCount() === countBefore, 'E6 muting did NOT delete the note', `${countBefore} -> ${noteCount()}`)
    const after6 = leadNotes().find((n) => n.id === victim.id)
    check(
      after6.pitch === victim.pitch && after6.start === victim.start && after6.duration === victim.duration && after6.velocity === victim.velocity,
      'E6 every other field survived the mute',
      JSON.stringify({ before: victim, after: after6 }),
    )
    await pollUntil(async () => (await page.locator(`[data-note-id="${victim.id}"][data-note-muted="true"]`).count()) === 1, 'the note div to render as muted')
    ok('E6 the note renders with the muted treatment')
    check((await selIds()).includes(victim.id), 'E6 the selection is KEPT after a mute (so you can A/B it)')

    // ============ E7: unmute, and a mixed selection mutes all ============
    console.log('\nE7 — unmute, and mixed-selection behavior')
    await page.keyboard.press('0')
    await pollUntil(() => !/active=0/.test(noteLine(victim.id) ?? ''), 'active=0 to be removed')
    ok('E7 pressing 0 again unmutes (the token disappears — canonical elision)')
    // Mute ONE, then select two, then press 0: both should end muted.
    await selectNote(victim.id)
    await page.keyboard.press('0')
    await pollUntil(() => /active=0/.test(noteLine(victim.id) ?? ''), 're-mute the first note')
    const second = leadNotes().find((n) => n.id !== victim.id && n.active !== false)
    await page.locator(`[data-note-id="${second.id}"]`).click({ modifiers: ['Shift'] })
    await sleep(120)
    await page.keyboard.press('0')
    await pollUntil(() => /active=0/.test(noteLine(second.id) ?? ''), 'the mixed selection to mute all')
    check(
      /active=0/.test(noteLine(victim.id) ?? '') && /active=0/.test(noteLine(second.id) ?? ''),
      'E7 one press over a mixed selection mutes ALL of it (never inverts each note)',
    )
    // clean up: unmute both
    await page.keyboard.press('0')
    await pollUntil(() => !/active=0/.test(noteLine(second.id) ?? ''), 'cleanup unmute')

    // ============ E8: velocity ramp ============
    console.log('\nE8 — velocity ramp across a selection')
    const three = leadNotes()
      .slice()
      .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
      .slice(0, 3)
    await clearSel()
    await page.evaluate((ids) => window.__store.getState().setEditNoteIds(ids), three.map((n) => n.id))
    await sleep(120)
    await page.fill('[data-velocity-input="from"]', '0.2')
    await page.fill('[data-velocity-input="to"]', '0.8')
    await page.click('[data-velocity-op="ramp"]')
    await pollUntil(() => {
      const now = leadNotes()
      return three.every((n) => now.find((x) => x.id === n.id)) && Math.abs(leadNotes().find((x) => x.id === three[0].id).velocity - 0.2) < 1e-6
    }, 'the ramp to land')
    const got8 = three.map((n) => leadNotes().find((x) => x.id === n.id).velocity)
    check(
      Math.abs(got8[0] - 0.2) < 1e-6 && Math.abs(got8[1] - 0.5) < 1e-6 && Math.abs(got8[2] - 0.8) < 1e-6,
      'E8 velocities ramp exactly 0.2 / 0.5 / 0.8 in start-time order',
      got8.join(', '),
    )

    // ============ E9: flip the ramp ============
    console.log('\nE9 — flip the ramp')
    await page.click('[data-velocity-op="ramp-flip"]')
    await pollUntil(() => Math.abs(leadNotes().find((x) => x.id === three[0].id).velocity - 0.8) < 1e-6, 'the flipped ramp to land')
    const got9 = three.map((n) => leadNotes().find((x) => x.id === n.id).velocity)
    check(
      Math.abs(got9[0] - 0.8) < 1e-6 && Math.abs(got9[1] - 0.5) < 1e-6 && Math.abs(got9[2] - 0.2) < 1e-6,
      'E9 the same three velocities now run the other way',
      got9.join(', '),
    )

    // ============ E10: randomize ============
    console.log('\nE10 — randomize velocities')
    await page.fill('[data-velocity-input="amount"]', '0.15')
    await page.click('[data-velocity-op="randomize"]')
    await sleep(500)
    const got10 = three.map((n) => leadNotes().find((x) => x.id === n.id).velocity)
    check(got10.some((v, i) => Math.abs(v - got9[i]) > 1e-6), 'E10 randomize actually moved velocities', `${got9.join(',')} -> ${got10.join(',')}`)
    check(got10.every((v) => v >= 0 && v <= 1), 'E10 every velocity stayed inside 0..1', got10.join(','))
    check(got10.every((v, i) => Math.abs(v - got9[i]) <= 0.15 + 1e-6), 'E10 no velocity moved further than the stated ± amount', got10.join(','))

    // ============ E11: the Humanize button is wired ============
    console.log('\nE11 — the Humanize button actually humanizes')
    const startsBefore = leadNotes().map((n) => `${n.id}:${n.start}`).join(',')
    await page.click('[data-pitch-time-op="humanize"]')
    await pollUntil(() => leadNotes().map((n) => `${n.id}:${n.start}`).join(',') !== startsBefore, 'note starts to move', 12000)
    ok('E11 clicking "Humanize track" moved note starts on disk (the button is wired, not decorative)')

    check(errors.length === 0, 'no uncaught page errors during the run', errors.join(' | '))
  } finally {
    await browser.close()
    preview.kill()
    await daemon.close?.()
  }

  console.log(`\n${checks} checks passed, ${failures.length} failed`)
  if (failures.length) {
    for (const f of failures) console.log(`  FAILED: ${f}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
