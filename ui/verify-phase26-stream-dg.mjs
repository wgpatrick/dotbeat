#!/usr/bin/env node
// Phase 26 Stream DG — copy/duplicate notes + a basic clipboard (docs/phase-26-plan.md,
// docs/research/57-ableton-vs-dotbeat-editing-midi.md item #2: "no duplicate-in-place or
// clipboard concept anywhere" in edit.ts/NoteView.tsx before this stream). Drives the REAL
// frontend headlessly against a REAL `beat daemon` (examples/night-shift.beat's `lead` synth
// track, pitches 67..76 over loop_bars 4), asserting on the daemon's own live document AND the
// on-disk git diff after each action — not just in-browser store state.
//
//   DG1 ALT-DRAG DUPLICATE (lateral)   select one note, hold Alt only at the moment the drag
//                       STARTS (then release it, so the rest of the drag is grid-snapped, proving
//                       the modifier is read ONCE at gesture-start, not continuously like the
//                       existing freehand-snap-bypass check) and drag it +6 steps -> the ORIGINAL
//                       note is untouched, a NEW note with a fresh id appears at the dropped
//                       position with the same pitch/duration/velocity; diff = exactly 1 added
//                       note line, 0 removed/changed.
//   DG2 ALT-DRAG DUPLICATE (diagonal)  same gesture, but the drop point also changes pitch (+4
//                       steps, -3 rows/semitones) -> the new copy's start AND pitch both shift by
//                       the exact drag delta; original untouched.
//   DG3 PLAIN DRAG REGRESSION          the SAME drag gesture with NO Alt held -> ordinary move
//                       (commitMove), NOT a duplicate: note count unchanged, the dragged note's
//                       own position moves.
//   DG4 CMD/CTRL+C / CMD/CTRL+V        select 3 notes, copy, move the (stopped) transport's
//                       currentStep to a known step, paste -> 3 new notes appear with fresh ids,
//                       each offset by (playhead - copied selection's own earliest start), same
//                       pitch/duration/velocity as their source; the 3 ORIGINALS are byte-for-byte
//                       unchanged; the post-paste selection is exactly the 3 new ids.
//
// Usage: node ui/verify-phase26-stream-dg.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir, platform } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8926
const PREVIEW_PORT = 5936
const MOD = platform() === 'darwin' ? 'Meta' : 'Control'
const ROW_H = 12 // px — must match NoteView.tsx's own ROW_H

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

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p26dg-'))
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
  const leadNotes = () => daemon.getDoc().tracks.find((t) => t.id === 'lead').notes
  const note = (id) => leadNotes().find((n) => n.id === id)
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

    await page.click('.arr-track-select:has(.arr-track-name:text-is("lead"))')
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    await pollUntil(() => daemon.getDoc().selectedTrack === 'lead', 'lead selection to record')
    await page.$eval('.noteview-grid', (el) => el.scrollIntoView({ block: 'center' }))
    await sleep(150)

    const clearSel = () => page.evaluate(() => window.__store.getState().setEditNoteIds([]))
    const selIds = () => page.evaluate(() => [...window.__store.getState().editNoteIds].sort())
    const box = async (id) => page.locator(`[data-note-id="${id}"]`).boundingBox()

    async function selectNote(id) {
      await clearSel()
      await page.locator(`[data-note-id="${id}"]`).click()
      await pollUntil(async () => (await selIds()).join(',') === id, `selection = [${id}]`)
    }
    async function shiftSelectNote(id) {
      await page.locator(`[data-note-id="${id}"]`).click({ modifiers: ['Shift'] })
    }

    // Drags the note at `id`'s body by (dxSteps, dRows) — px-precise, using the note's OWN
    // rendered width/duration to derive step width (same technique proven in verify-phase17/23).
    // `altAtStart`: hold Alt only through pointerdown (then release before moving) — this is the
    // exact gesture the task spec describes ("holding Alt at the START of a note-drag"), and
    // releasing it before the move keeps the rest of the drag grid-snapped so the resulting
    // position is an exact integer, not a freehand-bypassed fraction.
    async function dragNote(id, dxSteps, dRows, altAtStart) {
      const b = await box(id)
      const stepW = b.width / note(id).duration
      const gx = b.x + 3
      // Note elements render at height ROW_H-1 (a 1px gap between rows — see NoteView.tsx's own
      // `height: ROW_H - 1`), so b.height/2 is NOT the row's true center; use the constant ROW_H
      // instead (b.y IS exactly the row's top: `top: row * ROW_H`) to match onPointerMove's own
      // row math exactly. Deliberately NOT exactly ROW_H/2 (the row's midpoint): b.y is already
      // exactly `rect.top + origRow*ROW_H`, so the app's dRowsRaw would compute EXACTLY 0.5 there
      // and JS's Math.round(0.5) rounds UP — a real off-by-one-row bug in a "lateral-only" drag.
      // A few px off-center keeps the raw ratio safely away from any row-boundary tie.
      const gy = b.y + ROW_H / 2 - 3
      if (altAtStart) await page.keyboard.down('Alt')
      await page.mouse.move(gx, gy)
      await page.mouse.down()
      if (altAtStart) await page.keyboard.up('Alt')
      await page.mouse.move(gx + dxSteps * stepW, gy + dRows * ROW_H, { steps: 8 })
      await page.mouse.up()
    }

    // ============ DG1: Alt-drag duplicate (lateral) ============
    console.log('\n[DG1] Alt-drag u100036 +6 steps -> duplicate, original untouched')
    const idsBefore1 = new Set(leadNotes().map((n) => n.id))
    const src36 = { ...note('u100036') } // pitch 69, start 40, duration 2, velocity 0.6
    await selectNote('u100036')
    await dragNote('u100036', 6, 0, true)
    await pollUntil(() => leadNotes().length === idsBefore1.size + 1, 'exactly one new note to appear')
    await sleep(150)
    if (note('u100036').start !== src36.start || note('u100036').pitch !== src36.pitch) {
      throw new Error(`[DG1] original u100036 changed: ${JSON.stringify(note('u100036'))}, expected unchanged from ${JSON.stringify(src36)}`)
    }
    const added1 = leadNotes().filter((n) => !idsBefore1.has(n.id))
    if (added1.length !== 1) throw new Error(`[DG1] expected exactly 1 new note, got ${added1.length}: ${JSON.stringify(added1)}`)
    const copy1 = added1[0]
    if (copy1.start !== src36.start + 6) throw new Error(`[DG1] copy start ${copy1.start}, expected ${src36.start + 6}`)
    if (copy1.pitch !== src36.pitch) throw new Error(`[DG1] copy pitch ${copy1.pitch}, expected ${src36.pitch} (lateral drag only)`)
    if (copy1.duration !== src36.duration || copy1.velocity !== src36.velocity) throw new Error(`[DG1] copy duration/velocity mismatch: ${JSON.stringify(copy1)}`)
    if (copy1.id === src36.id) throw new Error(`[DG1] copy id ${copy1.id} collides with the original`)
    const d1 = diffLines()
    console.log(`\n[DG1] diff (unified=0):\n${d1.diff}`)
    if (d1.added.length !== 1 || d1.removed.length !== 0) throw new Error(`[DG1] expected exactly 1 added / 0 removed line, got +${d1.added.length} -${d1.removed.length}`)
    const selAfter1 = await selIds()
    if (JSON.stringify(selAfter1) !== JSON.stringify([copy1.id])) throw new Error(`[DG1] post-drag selection ${JSON.stringify(selAfter1)}, expected the new copy [${copy1.id}]`)
    console.log(`[DG1] PASS: original u100036 unchanged at (${src36.pitch},${src36.start}); new note ${copy1.id} at (${copy1.pitch},${copy1.start}); diff = 1 added line; selection follows the copy`)
    results.dg1 = { original: src36, copy: copy1, diff: d1.diff }
    commit('gui: alt-drag duplicate (lateral)')

    // ============ DG2: Alt-drag duplicate (diagonal — start AND pitch both shift) ============
    console.log('\n[DG2] Alt-drag u100037 +4 steps / -3 rows -> duplicate with pitch shift')
    const idsBefore2 = new Set(leadNotes().map((n) => n.id))
    const src37 = { ...note('u100037') } // pitch 67, start 52, duration 2, velocity 0.6
    await selectNote('u100037')
    await dragNote('u100037', 4, -3, true) // -3 rows (up) = +3 semitones (buildPitchAxis: pitch = hi - row)
    await pollUntil(() => leadNotes().length === idsBefore2.size + 1, 'exactly one new note to appear')
    await sleep(150)
    if (note('u100037').start !== src37.start || note('u100037').pitch !== src37.pitch) {
      throw new Error(`[DG2] original u100037 changed: ${JSON.stringify(note('u100037'))}, expected unchanged from ${JSON.stringify(src37)}`)
    }
    const added2 = leadNotes().filter((n) => !idsBefore2.has(n.id))
    if (added2.length !== 1) throw new Error(`[DG2] expected exactly 1 new note, got ${added2.length}: ${JSON.stringify(added2)}`)
    const copy2 = added2[0]
    if (copy2.start !== src37.start + 4) throw new Error(`[DG2] copy start ${copy2.start}, expected ${src37.start + 4}`)
    if (copy2.pitch !== src37.pitch + 3) throw new Error(`[DG2] copy pitch ${copy2.pitch}, expected ${src37.pitch + 3}`)
    const d2 = diffLines()
    if (d2.added.length !== 1 || d2.removed.length !== 0) throw new Error(`[DG2] expected exactly 1 added / 0 removed line, got +${d2.added.length} -${d2.removed.length}`)
    console.log(`[DG2] PASS: original u100037 unchanged at (${src37.pitch},${src37.start}); new note ${copy2.id} at (${copy2.pitch},${copy2.start}) — start +4, pitch +3; diff = 1 added line`)
    results.dg2 = { original: src37, copy: copy2, diff: d2.diff }
    commit('gui: alt-drag duplicate (diagonal)')

    // ============ DG3: plain drag (no Alt) is still an ordinary move — regression ============
    console.log('\n[DG3] plain drag u100038 +2 steps, no Alt -> ordinary move, no duplicate')
    const countBefore3 = leadNotes().length
    const src38 = { ...note('u100038') } // pitch 69, start 56, duration 4, velocity 0.65
    await selectNote('u100038')
    await dragNote('u100038', 2, 0, false)
    await pollUntil(() => note('u100038').start === src38.start + 2, 'u100038 to move +2 (ordinary move)')
    await sleep(150)
    if (leadNotes().length !== countBefore3) throw new Error(`[DG3] note count changed (${countBefore3} -> ${leadNotes().length}) — a plain drag must NOT duplicate`)
    if (note('u100038').pitch !== src38.pitch) throw new Error(`[DG3] pitch changed unexpectedly: ${note('u100038').pitch}`)
    console.log(`[DG3] PASS: no Alt held -> u100038 moved in place (${src38.start} -> ${note('u100038').start}), no new note, count stayed ${countBefore3}`)
    results.dg3 = { before: src38.start, after: note('u100038').start, count: countBefore3 }
    commit('gui: plain drag (regression, no duplicate)')

    // ============ DG4: Cmd/Ctrl+C / Cmd/Ctrl+V — multi-select clipboard paste at the playhead ============
    console.log('\n[DG4] copy u100033/u100034/u100035, move playhead, paste')
    const src33 = { ...note('u100033') } // pitch 76, start 20, duration 2, velocity 0.7
    const src34 = { ...note('u100034') } // pitch 72, start 24, duration 2, velocity 0.65
    const src35 = { ...note('u100035') } // pitch 74, start 28, duration 3, velocity 0.6
    const anchorStart = Math.min(src33.start, src34.start, src35.start) // 20
    await selectNote('u100033')
    await shiftSelectNote('u100034')
    await shiftSelectNote('u100035')
    await pollUntil(async () => (await selIds()).join(',') === 'u100033,u100034,u100035', 'selection = [u100033,u100034,u100035]')
    await page.keyboard.press(`${MOD}+c`)
    await sleep(100) // Copy is synchronous local state (no daemon round-trip) — just let the event settle

    const PASTE_STEP = 30
    const expectedOffset = PASTE_STEP - anchorStart // 10
    await page.evaluate((step) => window.__store.setState({ currentStep: step }), PASTE_STEP)
    const idsBefore4 = new Set(leadNotes().map((n) => n.id))
    await page.keyboard.press(`${MOD}+v`)
    await pollUntil(() => leadNotes().length === idsBefore4.size + 3, 'exactly 3 new notes to appear after paste')
    await sleep(150)

    // originals byte-for-byte unchanged
    for (const [id, src] of [['u100033', src33], ['u100034', src34], ['u100035', src35]]) {
      const now = note(id)
      if (now.start !== src.start || now.pitch !== src.pitch || now.duration !== src.duration || now.velocity !== src.velocity) {
        throw new Error(`[DG4] original ${id} changed: ${JSON.stringify(now)}, expected unchanged from ${JSON.stringify(src)}`)
      }
    }
    const pasted = leadNotes().filter((n) => !idsBefore4.has(n.id))
    if (pasted.length !== 3) throw new Error(`[DG4] expected exactly 3 pasted notes, got ${pasted.length}: ${JSON.stringify(pasted)}`)
    const bySrcStart = Object.fromEntries([src33, src34, src35].map((s) => [s.start, s]))
    for (const p of pasted) {
      const src = bySrcStart[p.start - expectedOffset]
      if (!src) throw new Error(`[DG4] pasted note at start ${p.start} does not correspond to any source note (offset ${expectedOffset})`)
      if (p.pitch !== src.pitch || p.duration !== src.duration || p.velocity !== src.velocity) {
        throw new Error(`[DG4] pasted note ${JSON.stringify(p)} does not match its source ${JSON.stringify(src)} (pitch/duration/velocity should be preserved)`)
      }
    }
    const selAfter4 = await selIds()
    if (JSON.stringify(selAfter4) !== JSON.stringify([...pasted.map((p) => p.id)].sort())) {
      throw new Error(`[DG4] post-paste selection ${JSON.stringify(selAfter4)} != the 3 pasted ids ${JSON.stringify(pasted.map((p) => p.id))}`)
    }
    const d4 = diffLines()
    console.log(`\n[DG4] diff (unified=0):\n${d4.diff}`)
    if (d4.added.length !== 3 || d4.removed.length !== 0) throw new Error(`[DG4] expected exactly 3 added / 0 removed lines, got +${d4.added.length} -${d4.removed.length}`)
    console.log(
      `[DG4] PASS: copied 3 notes (anchor start ${anchorStart}), pasted at playhead step ${PASTE_STEP} (offset +${expectedOffset}) -> ` +
        `3 fresh-id notes at starts ${pasted.map((p) => p.start).sort((a, b) => a - b).join(',')}; originals unchanged; selection follows the paste; diff = 3 added lines`,
    )
    results.dg4 = { anchorStart, pasteStep: PASTE_STEP, offset: expectedOffset, pasted: pasted.map((p) => ({ id: p.id, start: p.start, pitch: p.pitch })) }
    commit('gui: clipboard copy/paste')

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log(`\nALL PASS — Phase 26 Stream DG (copy/duplicate notes + clipboard) verified live:`)
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
