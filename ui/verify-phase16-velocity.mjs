#!/usr/bin/env node
// Phase 16 Stream J, item 3 — velocity-drag in the piano roll. Closes Phase 13 Stream B's own
// deferred item: `setValue`'s note grammar has always supported `<track>.note.<id>.velocity` (the
// same path `.start`/`.pitch`/`.duration` use for move/resize), but NoteView.tsx never exposed a
// gesture for it — velocity only ever showed as note opacity. This adds a dedicated velocity-lane
// strip below the note grid (one bar per note, aligned under it); a pointer-down-and-drag (or a
// plain click) on a bar sets that note's velocity from its vertical position, writing through the
// existing edit path exactly the way drag-to-move/drag-to-resize already do.
//
//   V1. Dragging an existing note's velocity bar toward the TOP of the lane raises its velocity
//       (heard immediately via the optimistic store update), and lands on disk as EXACTLY one
//       changed line: the note's `velocity` field, nothing else about the note (pitch/start/dur).
//   V2. Dragging the SAME bar toward the BOTTOM lowers velocity below its post-V1 value — proving
//       the gesture is a real bidirectional analog drag, not a fixed toggle — again one changed line.
//   V3. A note's OTHER fields (pitch/start/duration) are untouched by either drag — the git diff for
//       both steps only ever contains the one `note <id> ...` line, with only the trailing number
//       (velocity) different.
//
// Usage: node ui/verify-phase16-velocity.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8493
const PREVIEW_PORT = 5323
const NOTE_ID = 'u100033' // lead track's first note in examples/night-shift.beat: pitch 76, start 20, dur 2, vel 0.7

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
function findNote(doc, id) {
  for (const t of doc.tracks) {
    const n = t.notes.find((n) => n.id === id)
    if (n) return n
  }
  return null
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p16-velocity-'))
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

  const original = findNote(parse(readFileSync(beatPath, 'utf8')), NOTE_ID)
  if (!original) throw new Error(`fixture note ${NOTE_ID} not found in examples/night-shift.beat — update NOTE_ID`)
  console.log(`\noriginal note ${NOTE_ID}: ${JSON.stringify(original)}`)
  if (original.velocity !== 0.7) throw new Error(`expected fixture velocity 0.7, got ${original.velocity} — update the test's expectations`)

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
    await page.setViewportSize({ width: 1280, height: 800 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    await page.click('.track-row:has(.track-name:text-is("lead"))')
    await page.waitForSelector('.noteview-vel-lane', { timeout: 5000 })
    await page.waitForSelector(`[data-vel-note-id="${NOTE_ID}"]`, { timeout: 5000 })
    // The velocity lane sits below the note grid, off the initial viewport fold — page.mouse
    // coordinates are viewport-relative, so scroll it into view first or the drag lands nowhere.
    await page.$eval('.noteview-vel-lane', (el) => el.scrollIntoView({ block: 'center' }))

    async function dragVelocity(fracFromTop) {
      const bar = page.locator(`[data-vel-note-id="${NOTE_ID}"]`)
      const laneBox = await page.locator('.noteview-vel-lane').boundingBox()
      const barBox = await bar.boundingBox()
      const fromX = barBox.x + barBox.width / 2
      const fromY = barBox.y + barBox.height / 2
      const toY = laneBox.y + laneBox.height * fracFromTop
      await page.mouse.move(fromX, fromY)
      await page.mouse.down()
      await page.mouse.move(fromX, toY, { steps: 8 })
      await page.mouse.up()
    }

    // ================= V1: drag toward the TOP -> velocity rises =================
    await dragVelocity(0.05) // 5% down from the lane's top edge -> should read as a high velocity
    const v1Store = await pollUntil(async () => {
      const doc = await page.evaluate(() => window.__store.getState().doc)
      const n = findNote(doc, NOTE_ID)
      return n && n.velocity !== original.velocity ? n : null
    }, 'store velocity to change after V1 drag')
    console.log(`\n[V1] store note after drag-toward-top: ${JSON.stringify(v1Store)}`)
    if (!(v1Store.velocity > original.velocity)) throw new Error(`[V1] expected velocity to RISE above ${original.velocity}, got ${v1Store.velocity}`)
    if (v1Store.pitch !== original.pitch || v1Store.start !== original.start || v1Store.duration !== original.duration) {
      throw new Error(`[V1] pitch/start/duration changed unexpectedly: ${JSON.stringify(v1Store)}`)
    }

    await pollUntil(async () => {
      const disk = findNote(parse(readFileSync(beatPath, 'utf8')), NOTE_ID)
      return disk && disk.velocity === v1Store.velocity ? disk : null
    }, 'V1 velocity to land on disk')
    const diff1 = git(proj, 'diff', '--unified=0', '--', 'night-shift.beat')
    console.log(`[V1] git diff (unified=0):\n${diff1}`)
    const changed1 = diff1.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    if (changed1.length !== 2) throw new Error(`[V1] expected exactly one changed line (1 removed + 1 added), got ${changed1.length} changed lines:\n${changed1.join('\n')}`)
    if (!changed1.every((l) => l.includes(`note ${NOTE_ID} `))) throw new Error(`[V1] changed line(s) are not the ${NOTE_ID} note line: ${JSON.stringify(changed1)}`)
    console.log(`[V1] PASS: dragging toward the top raised velocity ${original.velocity} -> ${v1Store.velocity}, exactly one changed file line, only the note's own line`)
    results.v1 = { before: original.velocity, after: v1Store.velocity, diff: diff1 }
    git(proj, 'commit', '-q', '-am', 'gui: velocity drag up')

    // ================= V2: drag toward the BOTTOM -> velocity falls below V1's value =================
    await dragVelocity(0.95) // 95% down -> should read as a low velocity
    const v2Store = await pollUntil(async () => {
      const doc = await page.evaluate(() => window.__store.getState().doc)
      const n = findNote(doc, NOTE_ID)
      return n && n.velocity !== v1Store.velocity ? n : null
    }, 'store velocity to change after V2 drag')
    console.log(`\n[V2] store note after drag-toward-bottom: ${JSON.stringify(v2Store)}`)
    if (!(v2Store.velocity < v1Store.velocity)) throw new Error(`[V2] expected velocity to FALL below ${v1Store.velocity}, got ${v2Store.velocity}`)
    if (v2Store.pitch !== original.pitch || v2Store.start !== original.start || v2Store.duration !== original.duration) {
      throw new Error(`[V2] pitch/start/duration changed unexpectedly: ${JSON.stringify(v2Store)}`)
    }

    await pollUntil(async () => {
      const disk = findNote(parse(readFileSync(beatPath, 'utf8')), NOTE_ID)
      return disk && disk.velocity === v2Store.velocity ? disk : null
    }, 'V2 velocity to land on disk')
    const diff2 = git(proj, 'diff', '--unified=0', '--', 'night-shift.beat')
    console.log(`[V2] git diff (unified=0):\n${diff2}`)
    const changed2 = diff2.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    if (changed2.length !== 2) throw new Error(`[V2] expected exactly one changed line (1 removed + 1 added), got ${changed2.length} changed lines:\n${changed2.join('\n')}`)
    if (!changed2.every((l) => l.includes(`note ${NOTE_ID} `))) throw new Error(`[V2] changed line(s) are not the ${NOTE_ID} note line: ${JSON.stringify(changed2)}`)
    console.log(`[V2] PASS: dragging toward the bottom lowered velocity ${v1Store.velocity} -> ${v2Store.velocity}, exactly one changed file line, only the note's own line`)
    console.log('[V3] PASS (checked inline above both times): pitch/start/duration untouched by either drag')
    results.v2 = { before: v1Store.velocity, after: v2Store.velocity, diff: diff2 }

    await page.screenshot({ path: join(uiDir, 'verify-p16-velocity.png') })
    console.log('screenshot -> ui/verify-p16-velocity.png')

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL CHECKS PASSED ================')
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
