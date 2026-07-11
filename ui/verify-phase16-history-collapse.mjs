#!/usr/bin/env node
// Phase 16 Stream J, item 2 — the collapsed history view. Closes Phase 15 Stream H's own deferred
// item: `collapsedHistory()` (src/history/history.ts) already folds unnamed checkpoint runs between
// named pins server-side (and has since Phase 15, exposed via `beat history --collapsed` /
// `beat_history{collapsed:true}`), but HistoryPanel.tsx only ever rendered the flat list. This
// stream (a) adds `GET /history?collapsed=true` to the daemon (additive — `?limit=N` still works,
// `{entries}` stays the default shape, `{rows}` only when `collapsed=true` is passed) and (b) wires
// a flat/collapsed toggle into the panel (collapsed is the default per product-spec-desktop.md §4:
// "a long timeline still skims").
//
// Builds a REAL project with 8 real checkpoints (via the actual `beat` CLI, the same codepath the
// daemon reuses) and pins two of them, so there's a genuine leading run, an interior run, AND a
// trailing run of unnamed checkpoints to fold — not a contrived one-pin case.
//
//   C1. Collapsed is the default view: the panel renders exactly 5 rows (3 "N more checkpoints"
//       summary rows + the 2 pinned checkpoint rows) — matching `beat history --collapsed`'s own
//       output 1:1, not just "fewer rows than 8".
//   C2. Toggling to "Show all" re-fetches the flat list: exactly 8 rows, refs matching
//       `beat history` (no --collapsed) 1:1 in order — the same real checkpoints, not placeholders.
//   C3. Toggling back to collapsed reproduces C1's exact 5-row shape again (round-trips cleanly).
//
// Usage: node ui/verify-phase16-history-collapse.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8492
const PREVIEW_PORT = 5322
const cli = join(repoRoot, 'cli', 'beat.mjs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function beat(...args) {
  return execFileSync('node', [cli, ...args], { encoding: 'utf8', cwd: repoRoot })
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
// Parse "beat history"/"beat history --collapsed" plaintext output into structured rows.
function parseHistoryLines(text) {
  return text
    .trim()
    .split('\n')
    .map((line) => {
      const collapsedMatch = line.match(/^\s*\.\.\.\s*(\d+)\s*more checkpoint/)
      if (collapsedMatch) return { kind: 'collapsed', count: Number(collapsedMatch[1]) }
      const [ref] = line.trim().split(/\s{2,}/)
      const pin = /\[pin: ([^\]]+)]/.exec(line)?.[1] ?? null
      return { kind: 'checkpoint', ref: ref.trim(), pin }
    })
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p16-histcollapse-'))
  const beatPath = join(proj, 'night-shift.beat')
  writeFileSync(beatPath, readFileSync(join(repoRoot, 'examples', 'night-shift.beat'), 'utf8'))
  execFileSync('git', ['-C', proj, 'init', '-q'])

  console.log('\nmaking 8 real checkpoints via `beat`...')
  beat('checkpoint', beatPath) // c0 baseline
  for (let bpm = 125; bpm <= 131; bpm++) {
    beat('set', beatPath, 'bpm', String(bpm))
    beat('checkpoint', beatPath)
  }

  const flatCli = parseHistoryLines(beat('history', beatPath)) // newest first, 8 entries
  console.log(`\n\`beat history\` (${flatCli.length} checkpoints, newest first):\n` + beat('history', beatPath))
  if (flatCli.length !== 8) throw new Error(`expected 8 checkpoints, got ${flatCli.length}`)

  // Pin index 2 (interior, newer group) and index 5 (interior, older group) — leaves a leading run
  // of 2 (index 0,1), an interior run of 2 (index 3,4), and a trailing run of 2 (index 6,7).
  const chorusRef = flatCli[2].ref
  const verseRef = flatCli[5].ref
  beat('pin', beatPath, chorusRef, 'chorus')
  beat('pin', beatPath, verseRef, 'verse')
  console.log(`pinned ${chorusRef} as "chorus", ${verseRef} as "verse"`)

  const collapsedCli = parseHistoryLines(beat('history', beatPath, '--collapsed'))
  console.log(`\n\`beat history --collapsed\` (${collapsedCli.length} rows):\n` + beat('history', beatPath, '--collapsed'))
  // Expect: [collapsed(2), checkpoint(chorus), collapsed(2), checkpoint(verse), collapsed(2)]
  if (collapsedCli.length !== 5) throw new Error(`expected 5 collapsed rows from the CLI ground truth, got ${collapsedCli.length}`)

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const daemon = await startDaemon({ filePath: beatPath, port: PORT })
  console.log(`\ndaemon up on :${daemon.port}`)

  // Cross-check the new daemon route directly too, before even touching the GUI.
  const collapsedRes = await (await fetch(`http://localhost:${daemon.port}/history?collapsed=true`)).json()
  console.log(`GET /history?collapsed=true -> ${collapsedRes.rows.length} rows: ${JSON.stringify(collapsedRes.rows.map((r) => (r.kind === 'collapsed' ? `collapsed(${r.count})` : `checkpoint(${r.ref}${r.pin ? `,pin:${r.pin}` : ''})`)))}`)
  if (collapsedRes.rows.length !== 5) throw new Error(`[route] GET /history?collapsed=true returned ${collapsedRes.rows.length} rows, expected 5`)
  const flatRes = await (await fetch(`http://localhost:${daemon.port}/history`)).json()
  if (!Array.isArray(flatRes.entries) || flatRes.entries.length !== 8) throw new Error(`[route] plain GET /history regressed: expected {entries: [...8]}, got ${JSON.stringify(flatRes).slice(0, 200)}`)
  console.log('[route] PASS: GET /history (no param) still returns {entries:[...8]} unchanged; ?collapsed=true additively returns {rows:[...5]}')

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
  })
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1280, height: 800 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    await page.click('.view-tab[data-view="history"]')
    await page.waitForSelector('[data-testid="history-panel"]', { timeout: 5000 })
    await page.waitForSelector('.history-row', { timeout: 5000 })

    async function readPanelRows() {
      return page.evaluate(() =>
        [...document.querySelectorAll('.history-row')].map((el) => ({
          collapsed: el.classList.contains('history-row-collapsed'),
          ref: el.getAttribute('data-ref'),
          label: el.querySelector('.history-label')?.textContent ?? '',
          pin: el.querySelector('.history-pin')?.textContent?.trim() ?? null,
          text: el.textContent.trim(),
        })),
      )
    }

    // ---- C1: collapsed is the default view ----
    const c1 = await pollUntil(async () => {
      const rows = await readPanelRows()
      return rows.length === 5 ? rows : null
    }, 'collapsed panel to settle at 5 rows')
    console.log(`\n[C1] default (collapsed) panel rows (${c1.length}):\n` + c1.map((r) => `  ${r.collapsed ? '[collapsed] ' + r.text : r.ref}`).join('\n'))
    const collapsedRows = c1.filter((r) => r.collapsed)
    const checkpointRows = c1.filter((r) => !r.collapsed)
    if (collapsedRows.length !== 3) throw new Error(`[C1] expected 3 "N more checkpoints" summary rows, got ${collapsedRows.length}`)
    if (checkpointRows.length !== 2) throw new Error(`[C1] expected 2 real checkpoint rows (the pins), got ${checkpointRows.length}`)
    if (!checkpointRows.some((r) => r.pin?.includes('chorus'))) throw new Error('[C1] "chorus" pin not shown')
    if (!checkpointRows.some((r) => r.pin?.includes('verse'))) throw new Error('[C1] "verse" pin not shown')
    if (!collapsedRows.every((r) => /2 more checkpoints/.test(r.text))) throw new Error(`[C1] collapsed row text wrong: ${JSON.stringify(collapsedRows)}`)
    console.log('[C1] PASS: default view is collapsed — 3 "2 more checkpoints" folds + the 2 pinned rows (chorus, verse), matching `beat history --collapsed`')

    // ---- C2: toggle to flat "Show all" -> exactly the 8 real checkpoints, ref-matching the CLI ----
    await page.click('[data-action="toggle-collapsed"]')
    const c2 = await pollUntil(async () => {
      const rows = await readPanelRows()
      return rows.length === 8 ? rows : null
    }, 'flat panel to show all 8 checkpoints')
    console.log(`\n[C2] flat ("Show all") panel rows (${c2.length}):\n` + c2.map((r) => `  ${r.ref}${r.pin ? ` [${r.pin}]` : ''}`).join('\n'))
    for (let i = 0; i < 8; i++) {
      if (c2[i].ref !== flatCli[i].ref) throw new Error(`[C2] row ${i} ref ${c2[i].ref} != CLI ${flatCli[i].ref}`)
    }
    console.log('[C2] PASS: flat view shows all 8 real checkpoints, ref-matching `beat history` 1:1 in order')

    // ---- C3: toggle back to collapsed -> reproduces the same 5-row shape ----
    await page.click('[data-action="toggle-collapsed"]')
    const c3 = await pollUntil(async () => {
      const rows = await readPanelRows()
      return rows.length === 5 ? rows : null
    }, 'panel to collapse again')
    const c3Collapsed = c3.filter((r) => r.collapsed).map((r) => r.text)
    const c3Checkpoints = c3.filter((r) => !r.collapsed).map((r) => r.ref)
    console.log(`\n[C3] re-collapsed panel: ${c3Collapsed.length} folds, checkpoints ${JSON.stringify(c3Checkpoints)}`)
    if (JSON.stringify(c3Checkpoints.sort()) !== JSON.stringify(checkpointRows.map((r) => r.ref).sort())) throw new Error('[C3] re-collapsed checkpoint refs differ from the first collapsed render')
    console.log('[C3] PASS: toggling back to collapsed reproduces the same fold shape')

    await page.screenshot({ path: join(uiDir, 'verify-p16-history-collapse.png') })
    console.log('screenshot -> ui/verify-p16-history-collapse.png')

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
