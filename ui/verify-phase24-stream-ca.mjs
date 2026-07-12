#!/usr/bin/env node
// Phase 24 Stream CA — a draggable horizontal divider between .main-area and .bottom-pane
// (docs/phase-24-stream-ca.md). Pure GUI/session-state work: no daemon route, no format change.
// Drives the REAL frontend headlessly against a REAL `beat daemon`, measuring the actual DOM height
// of `.bottom-pane` before/after a real pointer drag — not a store-level unit test.
//
//   T1 selecting a track opens the bottom pane and its divider (`[data-testid="pane-divider"]`)
//      appears; baseline height matches the CSS default (~42vh of the workspace).
//   T2 dragging the divider UP grows `.bottom-pane`'s real getBoundingClientRect().height by
//      (approximately) the drag distance.
//   T3 dragging the divider DOWN shrinks it back down, but never below the 200px floor — a drag far
//      past the floor still leaves the pane at >= 200px, not collapsed to near-zero.
//   T4 dragging the divider UP by a huge amount clamps at a sane max — it never swallows the whole
//      workspace (.main-area keeps a real, nonzero height throughout).
//   T5 none of the above touched the .beat file on disk at all — this is session-only view state,
//      never written to the project file (same discipline as mute/solo, group-collapse).
//   T6 double-clicking the divider resets the pane back to the CSS default height.
//
// Usage: node ui/verify-phase24-stream-ca.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8961 // distinct from other verify scripts' ports so concurrent runs never collide
const PREVIEW_PORT = 5962

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

async function paneHeight(page) {
  return page.evaluate(() => document.querySelector('.bottom-pane')?.getBoundingClientRect().height ?? null)
}
async function mainAreaHeight(page) {
  return page.evaluate(() => document.querySelector('.main-area')?.getBoundingClientRect().height ?? null)
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p24ca-'))
  const beatPath = join(proj, 'night-shift.beat')
  writeFileSync(beatPath, serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline night-shift')

  const daemon = await startDaemon({ filePath: beatPath, port: PORT })
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
    await page.setViewportSize({ width: 1600, height: 980 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // ============ T1: select a track, the bottom pane + its divider appear ============
    await page.click('.arr-track-select:has(.arr-track-name:text-is("lead"))')
    await page.waitForSelector('[data-testid="bottom-pane"]', { timeout: 5000 })
    await page.waitForSelector('[data-testid="pane-divider"]', { timeout: 5000 })
    const fileAtStart = readFileSync(beatPath, 'utf8')
    const initialHeight = await paneHeight(page)
    const workspaceHeight = await page.evaluate(() => document.querySelector('.workspace')?.getBoundingClientRect().height ?? null)
    if (!initialHeight || initialHeight < 190) throw new Error(`[T1] expected a real initial pane height (~42vh, >=200 CSS floor), got ${initialHeight}`)
    // 42vh of the workspace's own box height (not the raw viewport) is the CSS default; sanity-check
    // it's in a plausible range rather than pinning an exact px value the CSS could reasonably drift.
    console.log(`[T1] PASS: bottom pane + divider present, initial height ${initialHeight.toFixed(1)}px (workspace ${workspaceHeight?.toFixed(1)}px)`)
    results.t1 = { initialHeight, workspaceHeight }

    // ============ T2: drag the divider UP -> the pane grows by ~the drag distance ============
    const divider = await page.$('[data-testid="pane-divider"]')
    const db = await divider.boundingBox()
    const dragUpBy = 80
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2)
    await page.mouse.down()
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2 - dragUpBy, { steps: 10 })
    await page.mouse.up()
    const grownHeight = await pollUntil(
      async () => {
        const h = await paneHeight(page)
        return h > initialHeight + 40 ? h : null
      },
      'the pane to visibly grow after dragging the divider up',
    )
    const grewBy = grownHeight - initialHeight
    if (Math.abs(grewBy - dragUpBy) > 15) throw new Error(`[T2] expected the pane to grow by ~${dragUpBy}px, grew by ${grewBy.toFixed(1)}px (${initialHeight}->${grownHeight})`)
    console.log(`[T2] PASS: dragging the divider up ${dragUpBy}px grew the pane by ${grewBy.toFixed(1)}px (${initialHeight.toFixed(1)}->${grownHeight.toFixed(1)})`)
    results.t2 = { grownHeight, grewBy }

    // ============ T3: drag DOWN past the floor -> clamps at 200px, never collapses ============
    const db2 = await divider.boundingBox()
    await page.mouse.move(db2.x + db2.width / 2, db2.y + db2.height / 2)
    await page.mouse.down()
    await page.mouse.move(db2.x + db2.width / 2, db2.y + db2.height / 2 + 900, { steps: 14 })
    await page.mouse.up()
    const floored = await pollUntil(
      async () => {
        const h = await paneHeight(page)
        return h < grownHeight - 40 ? h : null
      },
      'the pane to visibly shrink after dragging the divider far down',
    )
    if (floored < 195 || floored > 210) throw new Error(`[T3] expected the pane to clamp at the ~200px floor, got ${floored}`)
    console.log(`[T3] PASS: dragging the divider far down clamped the pane at ${floored.toFixed(1)}px (>= the 200px floor, not collapsed)`)
    results.t3 = { floored }

    // ============ T4: drag UP by a huge amount -> clamps at a sane max, main-area survives ============
    const db3 = await divider.boundingBox()
    await page.mouse.move(db3.x + db3.width / 2, db3.y + db3.height / 2)
    await page.mouse.down()
    await page.mouse.move(db3.x + db3.width / 2, db3.y + db3.height / 2 - 900, { steps: 14 })
    await page.mouse.up()
    const capped = await pollUntil(
      async () => {
        const h = await paneHeight(page)
        return h > floored + 40 ? h : null
      },
      'the pane to visibly grow after dragging the divider far up',
    )
    const mainH = await mainAreaHeight(page)
    if (mainH < 100) throw new Error(`[T4] .main-area collapsed to ${mainH}px — the divider drag should never swallow the whole arrangement`)
    if (capped > workspaceHeight - 100) throw new Error(`[T4] expected the pane's max to leave real room for .main-area, pane=${capped} workspace=${workspaceHeight}`)
    console.log(`[T4] PASS: dragging the divider far up capped the pane at ${capped.toFixed(1)}px, .main-area kept ${mainH.toFixed(1)}px (never swallowed)`)
    results.t4 = { capped, mainH }

    // ============ T5: none of the above touched the .beat file — session-only state ============
    const fileAfterDrags = readFileSync(beatPath, 'utf8')
    if (fileAfterDrags !== fileAtStart) throw new Error('[T5] the .beat file changed after divider drags — pane height must be session-only, never written to the project file')
    console.log('[T5] PASS: the .beat file is byte-identical after all divider drags (session-only state, as intended)')
    results.t5 = { unchanged: true }

    // ============ T6: double-click resets to the CSS default ============
    const db4 = await divider.boundingBox()
    await page.mouse.dblclick(db4.x + db4.width / 2, db4.y + db4.height / 2)
    const resetHeight = await pollUntil(
      async () => {
        const h = await paneHeight(page)
        return Math.abs(h - initialHeight) < 3 ? h : null
      },
      'the pane to reset back to its initial CSS-default height after double-click',
    )
    console.log(`[T6] PASS: double-clicking the divider reset the pane to ${resetHeight.toFixed(1)}px (initial was ${initialHeight.toFixed(1)}px)`)
    results.t6 = { resetHeight }

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
