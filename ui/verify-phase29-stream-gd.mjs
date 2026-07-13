#!/usr/bin/env node
// Phase 29 Stream GD — data integrity & daemon resilience (docs/phase-29-plan.md's "GD" section,
// root cause research/82). This script verifies bug #1 (rapid successive grid edits silently lose
// data) against a REAL running daemon + REAL frontend, not mocks.
//
// Root cause (confirmed by reading ui/src/daemon/bridge.ts's postEdit and daemon.ts's /edit
// route): the bare `<track>.note` / `<track>.hit` ADD grammar (no id yet — every call mints a
// brand-new entity) shared the EXACT SAME literal path string across every add on a track. postEdit
// debounced/coalesced the network POST per PATH — appropriate for a knob drag (many deltas, only
// the LAST value matters) but wrong for an ADD, where every call is an independent, non-collapsible
// write. Two adds landing within the 60ms debounce window meant the earlier one's pending
// setTimeout got clearTimeout()'d by the later one, so its POST /edit NEVER FIRED — the hit/note
// silently never reached the daemon, even though the client's own optimistic mirror (a separate,
// synchronous code path) rendered it correctly forever. verify-phase24-stream-ci.mjs's T3 comment
// independently documents hitting this exact collision and worked around it by polling the daemon
// after every single click before firing the next — this script deliberately does NOT do that, to
// exercise the real, unworked-around failure mode research/82 hit.
//
// Fix (ui/src/daemon/bridge.ts's postEdit): the append-grammar paths (`.note` / `.hit`, no id
// suffix) now skip the debounce entirely and enqueue immediately — still serialized through the
// same shared `sendQueue` so the daemon never sees two /edit requests in flight at once (its id-
// minting depends on strict arrival order), but never dropped.
//
//   GD1  RAPID BURST (tight loop, ~25ms between clicks, no confirmation polling in between — the
//        harshest case, well inside the old 60ms collision window): 18 grid clicks adding 18
//        distinct drum hits on the "snare" lane (zero pre-existing hits on that lane in the
//        fixture). Polls the DAEMON's own /document (ground truth, matching research/82's own
//        verification method — GET /doc, not just the client's optimistic store) until settled,
//        then asserts ALL 18 landed at the intended steps.
//   GD2  PACED BURST (~350ms between clicks, matching research/82's literal reported repro pace),
//        no confirmation polling: 15 distinct hits on the "hat" lane. Asserts all 15 land.
//   GD3  REGRESSION — NORMAL HUMAN PACE (~1.5s between clicks, research/82's own confirmed-good
//        control): 3 distinct hits on the "openhat" lane, confirming the happy path still works
//        with no regression.
//
// Usage: node ui/verify-phase29-stream-gd.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8961
const PREVIEW_PORT = 5971

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function pollUntil(fn, what, timeoutMs = 12000, everyMs = 60) {
  const t0 = Date.now()
  let last
  for (;;) {
    last = await fn()
    if (last) return last
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}

function initProject() {
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-verify-gd-'))
  const beatPath = join(proj, 'song.beat')
  writeFileSync(beatPath, readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))
  return { proj, beatPath }
}

/** Fire N grid clicks on the drums track's `lane` at distinct `steps`, waiting only `gapMs`
 * between dispatches (NOT waiting for the daemon, or even the client store, to confirm each one —
 * that confirmation-polling is exactly what verify-phase24-stream-ci.mjs's T3 had to add as a
 * workaround for this same bug; skipping it here is the point). Returns nothing; the caller polls
 * the daemon afterward. */
async function fireBurst(page, lane, steps, gapMs, totalSteps) {
  const rowIndex = { kick: 0, snare: 1, clap: 2, hat: 3, openhat: 4 }[lane]
  for (const step of steps) {
    const gridBox = await page.locator('.noteview-grid').boundingBox()
    const stepW = gridBox.width / totalSteps
    // NoteView's click-to-add math is `Math.round((clientX-rectLeft)/stepW)` (GC stream territory,
    // a separate off-by-one bug tracked there) — aim 10% into the cell, not its center, so this
    // GD-scoped script's step assertions don't depend on whether GC's fix has landed yet.
    const x = gridBox.x + (step + 0.1) * stepW
    const y = gridBox.y + rowIndex * 12 + 6 // ROW_H=12 (NoteView.tsx)
    await page.mouse.click(x, y)
    if (gapMs > 0) await sleep(gapMs)
  }
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const proj = initProject()
  const daemon = await startDaemon({ filePath: proj.beatPath, port: PORT })
  console.log(`daemon up on :${daemon.port}, project ${proj.beatPath}`)

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
    await page.setViewportSize({ width: 1600, height: 980 })
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    page.on('dialog', async (d) => d.dismiss())
    page.on('console', (msg) => {
      // bridge.ts's postEdit warns on a non-ok /edit response or a network failure — surfacing
      // those here means a real send failure shows up as visible script output, not just a missing
      // hit the assertions below have to infer the cause of.
      if (msg.type() === 'warning' || msg.type() === 'error') console.log(`  [page console.${msg.type()}] ${msg.text()}`)
    })

    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    await page.click('.arr-track-select:has(.arr-track-name:text-is("drums"))')
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    await page.$eval('.bottom-pane-body', (el) => {
      el.scrollTop = 0
      el.scrollLeft = 0
    })
    await sleep(150)

    const doc0 = await (await fetch(`http://localhost:${PORT}/document`)).json()
    const drums = doc0.tracks.find((t) => t.id === 'drums')
    if (!drums) throw new Error('fixture has no "drums" track')
    const totalSteps = doc0.loopBars * 16
    const newHitIdsOnLane = (doc, lane) => doc.tracks.find((t) => t.id === 'drums').hits.filter((h) => h.lane === lane && /^h\d+$/.test(h.id))
    const daemonDoc = () => fetch(`http://localhost:${PORT}/document`).then((r) => r.json())

    // All three sub-tests click on "snare" — the one lane the fixture's legacy `pattern` line left
    // completely empty (`pattern snare 0 0 0 ... 0`) — using disjoint step ranges, so a click can
    // never accidentally land ON an existing hit marker (which would grab/select it instead of
    // adding a new one — a test-harness pitfall, not a product bug, caught while writing this).
    async function runBurst(label, steps, gapMs, describePace) {
      console.log(`[${label}] firing ${steps.length} clicks on "snare" ${describePace}, no inter-click confirmation...`)
      await fireBurst(page, 'snare', steps, gapMs, totalSteps)
      const doc = await pollUntil(
        async () => {
          const d = await daemonDoc()
          const landed = newHitIdsOnLane(d, 'snare').filter((h) => steps.includes(h.start))
          if (landed.length !== steps.length) {
            console.log(`  [${label}] ...currently ${landed.length}/${steps.length} landed: ${JSON.stringify(landed.map((h) => h.start).sort((a, b) => a - b))}`)
          }
          return landed.length === steps.length ? d : null
        },
        `all ${steps.length} "${label}" hits to land on the DAEMON's document`,
        8000,
      )
      const landed = newHitIdsOnLane(doc, 'snare')
        .filter((h) => steps.includes(h.start))
        .map((h) => h.start)
        .sort((a, b) => a - b)
      const expected = [...steps].sort((a, b) => a - b)
      if (JSON.stringify(landed) !== JSON.stringify(expected)) {
        throw new Error(`[${label}] FAIL: expected steps ${JSON.stringify(expected)}, daemon document has ${JSON.stringify(landed)}`)
      }
      console.log(`[${label}] PASS: all ${steps.length} hits persisted to the daemon's document at the intended steps`)
      return { fired: steps.length, landed: landed.length }
    }

    const gd1Steps = Array.from({ length: 18 }, (_, i) => i) // steps 0-17
    results.gd1 = await runBurst('GD1', gd1Steps, 25, '~25ms apart (rapid burst, well inside the old 60ms debounce-collision window)')

    // ============ GD2: paced burst, ~350ms apart (research/82's literal reported pace) ============
    const gd2Steps = Array.from({ length: 15 }, (_, i) => 20 + i) // steps 20-34
    results.gd2 = await runBurst('GD2', gd2Steps, 350, "~350ms apart (research/82's reported pace)")

    // ============ GD3: regression check — normal human pace (~1.5s, research/82's own control) ============
    const gd3Steps = [40, 45, 50]
    results.gd3 = await runBurst('GD3', gd3Steps, 1500, '~1.5s apart (normal-pace regression check)')

    if (pageErrors.length) console.log('\n(page errors, non-fatal):\n' + pageErrors.join('\n'))
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
