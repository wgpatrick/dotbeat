#!/usr/bin/env node
// Phase 17 Stream M — Ableton-standard multi-note editing controls in the piano roll (NoteView.tsx).
// Drives the REAL frontend headlessly against a REAL `beat daemon` and asserts both the resulting
// in-memory state AND the on-disk git diff for each group operation (the diff is the product: a
// group op must be a clean per-note multi-line diff, never a document rewrite).
//
//   M1 marquee-select      drag a rubber-band over 3 notes -> exactly those 3 become selected
//   M2 group move          drag one selected note +4 steps -> all 3 move +4 (relative offsets kept),
//                          diff = exactly 3 changed note lines (one per note), nothing else
//   M3 shift-click + delete build a 3-note selection by shift-clicking, press Delete ->
//                          exactly those 3 notes gone, diff = 3 removed lines
//   M4 group resize        select 2 notes of DIFFERENT durations, drag one's edge +2 ->
//                          BOTH durations grow by +2 (uniform delta, the Ableton convention —
//                          NOT proportional scaling), diff = 2 changed duration lines
//   M5 select-all + nudge  Cmd/Ctrl-A selects all remaining notes; ArrowRight nudges them all +1 step
//
// Screenshots: the live marquee rectangle (M1) and the post-group-move state (M2).
//
// Usage: node ui/verify-phase17-arrangement.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir, platform } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8497
const PREVIEW_PORT = 5327
const MOD = platform() === 'darwin' ? 'Meta' : 'Control'

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

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p17-arr-'))
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
    await page.setViewportSize({ width: 1400, height: 900 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    await page.click('.track-row:has(.track-name:text-is("lead"))')
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    await pollUntil(() => daemon.getDoc().selectedTrack === 'lead', 'lead selection to record')
    await page.$eval('.noteview-grid', (el) => el.scrollIntoView({ block: 'center' }))
    await sleep(150)

    const selIds = () => page.evaluate(() => [...window.__store.getState().editNoteIds].sort())
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
    const box = async (id) => page.locator(`[data-note-id="${id}"]`).boundingBox()

    // ============ M1: marquee-select 3 notes ============
    // u100033 (start20,p76), u100034 (start24,p72), u100035 (start28,p74) sit together near the top;
    // the next note (u100036, start40) is far to the right, so a tight rectangle catches exactly 3.
    const b33 = await box('u100033')
    const b34 = await box('u100034')
    const b35 = await box('u100035')
    const left = Math.min(b33.x, b34.x, b35.x)
    const right = Math.max(b33.x + b33.width, b34.x + b34.width, b35.x + b35.width)
    const top = Math.min(b33.y, b34.y, b35.y)
    const bot = Math.max(b33.y + b33.height, b34.y + b34.height, b35.y + b35.height)
    const startX = left - 8 // empty grid just left/above the cluster
    const startY = top - 8
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move((startX + right) / 2, (startY + bot) / 2, { steps: 6 })
    await page.screenshot({ path: join(uiDir, 'verify-p17-marquee.png') }) // rubber-band mid-drag
    await page.mouse.move(right + 8, bot + 8, { steps: 6 })
    await page.mouse.up()
    const m1 = await pollUntil(async () => {
      const s = await selIds()
      return s.length === 3 ? s : null
    }, 'marquee to select exactly 3 notes')
    const want1 = ['u100033', 'u100034', 'u100035']
    if (JSON.stringify(m1) !== JSON.stringify(want1)) throw new Error(`[M1] marquee selected ${JSON.stringify(m1)}, expected ${JSON.stringify(want1)}`)
    console.log(`[M1] PASS: marquee rubber-band selected exactly ${JSON.stringify(m1)} (screenshot -> ui/verify-p17-marquee.png)`)
    results.m1 = m1

    // ============ M2: group move — drag one selected note +4 steps, all 3 follow ============
    const before2 = { u100033: note('u100033').start, u100034: note('u100034').start, u100035: note('u100035').start }
    const stepW = b34.width / note('u100034').duration // px per step, from a known-duration note
    const gx = b34.x + 3 // grab body (left of the right-edge resize handle)
    const gy = b34.y + b34.height / 2
    await page.mouse.move(gx, gy)
    await page.mouse.down()
    await page.mouse.move(gx + 4 * stepW, gy, { steps: 6 })
    await page.mouse.up()
    await pollUntil(() => note('u100034').start === before2.u100034 + 4, 'the dragged note to move +4')
    await sleep(150)
    for (const id of want1) {
      const got = note(id).start
      const exp = before2[id] + 4
      if (got !== exp) throw new Error(`[M2] ${id} start ${got}, expected ${exp} (group did not move in lockstep)`)
    }
    await page.screenshot({ path: join(uiDir, 'verify-p17-group-move.png') })
    const d2 = diffLines()
    console.log(`\n[M2] group-move diff (unified=0):\n${d2.diff}`)
    if (d2.added.length !== 3 || d2.removed.length !== 3) throw new Error(`[M2] expected 3 changed note lines (3+/3-), got +${d2.added.length} -${d2.removed.length}`)
    if (!want1.every((id) => d2.added.some((l) => l.includes(`note ${id} `)))) throw new Error(`[M2] the 3 changed lines are not the 3 selected notes: ${JSON.stringify(d2.added)}`)
    console.log(`[M2] PASS: all 3 notes moved +4 in lockstep; diff is exactly 3 changed note lines (screenshot -> ui/verify-p17-group-move.png)`)
    results.m2 = { before: before2, diff: d2.diff }
    commit('gui: group move')

    // ============ M3: shift-click multi-select, then Delete ============
    await page.locator('[data-note-id="u100036"]').click() // plain click selects just this one
    await page.locator('[data-note-id="u100037"]').click({ modifiers: ['Shift'] })
    await page.locator('[data-note-id="u100038"]').click({ modifiers: ['Shift'] })
    const m3sel = await pollUntil(async () => {
      const s = await selIds()
      return s.length === 3 ? s : null
    }, 'shift-click to build a 3-note selection')
    const want3 = ['u100036', 'u100037', 'u100038']
    if (JSON.stringify(m3sel) !== JSON.stringify(want3)) throw new Error(`[M3] shift-click selection ${JSON.stringify(m3sel)}, expected ${JSON.stringify(want3)}`)
    await page.keyboard.press('Delete')
    await pollUntil(() => want3.every((id) => !note(id)), 'Delete to remove all 3 selected notes')
    await sleep(150)
    if (leadNotes().length !== 4) throw new Error(`[M3] expected 4 notes remaining, got ${leadNotes().length}`)
    const d3 = diffLines()
    console.log(`\n[M3] group-delete diff (unified=0):\n${d3.diff}`)
    if (d3.removed.length !== 3 || d3.added.length !== 0) throw new Error(`[M3] expected 3 removed / 0 added, got +${d3.added.length} -${d3.removed.length}`)
    if (!want3.every((id) => d3.removed.some((l) => l.includes(`note ${id} `)))) throw new Error(`[M3] removed lines are not the 3 selected notes: ${JSON.stringify(d3.removed)}`)
    console.log(`[M3] PASS: shift-click built a 3-note selection; Delete removed exactly those 3 (diff = 3 removed lines)`)
    results.m3 = { deleted: want3, diff: d3.diff }
    commit('gui: group delete')

    // ============ M4: group resize is UNIFORM DELTA, not proportional ============
    // Select two notes of DIFFERENT durations: u100033 (dur 2) and u100035 (dur 3), both with room
    // to grow inside the loop. Drag u100035's right edge +2 steps -> BOTH grow by exactly +2
    // (2->4 and 3->5). Proportional scaling would grow them by different amounts; uniform delta
    // grows both by the same +2 (the Ableton convention this test pins down).
    const d33 = note('u100033').duration
    const d35 = note('u100035').duration
    if (d33 === d35) throw new Error(`[M4] test needs two DIFFERENT durations; both are ${d33}`)
    await page.locator('[data-note-id="u100033"]').click()
    await page.locator('[data-note-id="u100035"]').click({ modifiers: ['Shift'] })
    await pollUntil(async () => (await selIds()).length === 2, 'a 2-note selection for resize')
    const b35b = await box('u100035')
    const stepW35 = b35b.width / d35
    const ex = b35b.x + b35b.width - 2 // on the right-edge resize handle
    const ey = b35b.y + b35b.height / 2
    await page.mouse.move(ex, ey)
    await page.mouse.down()
    await page.mouse.move(ex + 2 * stepW35, ey, { steps: 6 })
    await page.mouse.up()
    await pollUntil(() => note('u100035').duration === d35 + 2, 'the dragged note to grow +2')
    await sleep(150)
    if (note('u100033').duration !== d33 + 2) {
      throw new Error(`[M4] u100033 duration ${note('u100033').duration}, expected ${d33 + 2} (uniform delta) — group resize is not uniform-delta`)
    }
    const d4 = diffLines()
    console.log(`\n[M4] group-resize diff (unified=0):\n${d4.diff}`)
    if (d4.added.length !== 2 || d4.removed.length !== 2) throw new Error(`[M4] expected 2 changed note lines (2+/2-), got +${d4.added.length} -${d4.removed.length}`)
    console.log(`[M4] PASS: uniform-delta resize — u100033 ${d33}->${d33 + 2}, u100035 ${d35}->${d35 + 2} (both +2, not proportional); diff = 2 changed lines`)
    results.m4 = { u100033: [d33, d33 + 2], u100035: [d35, d35 + 2], diff: d4.diff }
    commit('gui: group resize')

    // ============ M5: select-all + keyboard nudge ============
    await page.keyboard.press(`${MOD}+a`)
    const all = await pollUntil(async () => {
      const s = await selIds()
      return s.length === leadNotes().length ? s : null
    }, 'Cmd/Ctrl-A to select all notes')
    if (all.length !== 4) throw new Error(`[M5] select-all got ${all.length} notes, expected 4`)
    const startsBefore = Object.fromEntries(leadNotes().map((n) => [n.id, n.start]))
    await page.keyboard.press('ArrowRight')
    await pollUntil(() => leadNotes().every((n) => n.start === startsBefore[n.id] + 1), 'ArrowRight to nudge all notes +1 step')
    await sleep(150)
    const d5 = diffLines()
    if (d5.added.length !== 4 || d5.removed.length !== 4) throw new Error(`[M5] expected 4 changed lines from nudging 4 notes, got +${d5.added.length} -${d5.removed.length}`)
    console.log(`[M5] PASS: Cmd/Ctrl-A selected all 4 notes; ArrowRight nudged every one +1 step (diff = 4 changed lines)`)
    results.m5 = { selectedAll: all.length, diff: d5.diff }
    commit('gui: select-all + nudge')

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nVERIFY FAILED:', err)
  process.exit(1)
})
