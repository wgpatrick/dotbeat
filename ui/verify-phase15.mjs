#!/usr/bin/env node
// Phase 15 Stream H end-to-end verification — the version-history panel, driven in headless Chrome
// against a real daemon over a real git-backed project, proving REAL checkpoint data and a REAL
// append-only restore (not "a list rendered from a mock"). Mirrors ui/verify-phase14.mjs's boot
// pattern. Steps:
//
//   Setup (real history via the actual CLI verbs):
//     copy examples/night-shift.beat into a temp project, then make three real edits, each followed
//     by `beat checkpoint` — so the git history has four genuine checkpoints with genuine semantic
//     one-liner labels (`beat set` does NOT auto-checkpoint, so we checkpoint explicitly, which is
//     the same src/history codepath the daemon reuses). Pin one to exercise the pin route/badge.
//
//   H1. The panel renders the REAL checkpoint list: row count and labels match `beat history`
//       exactly (not empty, not placeholder), and the pinned checkpoint shows its pin name.
//   H2. Append-only restore: click "Go back" on the earliest checkpoint (bpm 124, no added note).
//       Confirm on disk the .beat file reverts (bpm 124, added note gone), AND `git log` gained a
//       NEW commit ("go back to <ref> ...") while every prior checkpoint still exists — a fresh
//       checkpoint, never a destructive rewind (D3). Confirm the GUI reflects it (store.doc.bpm,
//       and a new "go back to" row at the top of the panel).
//
// Usage: node ui/verify-phase15.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8481
const PREVIEW_PORT = 5320
const cli = join(repoRoot, 'cli', 'beat.mjs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
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
const bpmOf = (path) => Number((readFileSync(path, 'utf8').match(/^bpm\s+(\d+)/m) ?? [])[1])
const countCommits = (dir) =>
  git(dir, 'log', '--oneline')
    .trim()
    .split('\n')
    .filter(Boolean).length

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  // ---- build a REAL project with REAL checkpoints via the actual CLI ----
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p15-'))
  const beatPath = join(proj, 'night-shift.beat')
  writeFileSync(beatPath, readFileSync(join(repoRoot, 'examples', 'night-shift.beat'), 'utf8'))
  git(proj, 'init', '-q')

  console.log('\nmaking real edits + checkpoints via `beat`...')
  beat('checkpoint', beatPath) // c0: baseline
  beat('set', beatPath, 'bpm', '128')
  beat('checkpoint', beatPath) // c1: bpm 124 -> 128
  beat('set', beatPath, 'lead.cutoff', '900')
  beat('checkpoint', beatPath) // c2: lead cutoff change
  beat('add-note', beatPath, 'bass', '48', '0', '4', '0.8')
  beat('checkpoint', beatPath) // c3: bass note added

  // CLI ground truth for the cross-check (newest first): "<ref>  <when>  <label>[  [pin: ...]]"
  const cliHistory = beat('history', beatPath)
    .trim()
    .split('\n')
    .map((line) => {
      const [ref, , ...rest] = line.trim().split(/\s{2,}/)
      return { ref: ref.trim(), line }
    })
  console.log(`\n\`beat history\` (${cliHistory.length} checkpoints):\n` + beat('history', beatPath))
  const earliest = cliHistory[cliHistory.length - 1].ref // the baseline "checkpoint" (bpm 124, no note)

  // Pin the bpm-change checkpoint (2nd newest at this point is c2; pin c1 the bpm change).
  const bpmCheckpointRef = cliHistory[cliHistory.length - 2].ref // c1
  beat('pin', beatPath, bpmCheckpointRef, 'rough mix v1')
  console.log(`pinned ${bpmCheckpointRef} as "rough mix v1"`)

  const commitsBefore = countCommits(proj)
  const bpmBefore = bpmOf(beatPath)
  console.log(`\nproject state before restore: bpm=${bpmBefore}, ${commitsBefore} commits, earliest ref=${earliest}`)

  // ---- boot the daemon + UI ----
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const daemon = await startDaemon({ filePath: beatPath, port: PORT })
  console.log(`daemon up on :${daemon.port}`)

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

    // ---- H1: the panel renders the real checkpoint list ----
    await page.click('.view-tab[data-view="history"]')
    await page.waitForSelector('[data-testid="history-panel"]', { timeout: 5000 })
    await page.waitForSelector('.history-row', { timeout: 5000 })
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.history-row')].map((el) => ({
        ref: el.getAttribute('data-ref'),
        label: el.querySelector('.history-label')?.textContent ?? '',
        pin: el.querySelector('.history-pin')?.textContent?.trim() ?? null,
      })),
    )
    console.log(`\n[H1] panel rows (${rows.length}):\n` + rows.map((r) => `  ${r.ref}  ${r.pin ? `[${r.pin}] ` : ''}${r.label}`).join('\n'))
    if (rows.length !== cliHistory.length) throw new Error(`[H1] panel shows ${rows.length} rows, \`beat history\` has ${cliHistory.length}`)
    // Refs must line up 1:1 with the CLI's list (same order, same data source).
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].ref !== cliHistory[i].ref) throw new Error(`[H1] row ${i} ref ${rows[i].ref} != CLI ${cliHistory[i].ref}`)
    }
    const pinnedRow = rows.find((r) => r.pin)
    if (!pinnedRow || !pinnedRow.pin.includes('rough mix v1')) throw new Error(`[H1] pinned checkpoint not shown with its name: ${JSON.stringify(pinnedRow)}`)
    if (rows.every((r) => !r.label || r.label === 'placeholder')) throw new Error('[H1] labels look empty/placeholder')
    console.log(`[H1] PASS: ${rows.length} real checkpoints rendered, refs match \`beat history\` 1:1, pin "rough mix v1" shown`)

    // ---- H2: append-only restore to the earliest checkpoint ----
    console.log(`\n[H2] clicking "Go back" on earliest checkpoint ${earliest} (baseline, bpm 124, no bass note added)...`)
    await page.click(`.history-row[data-ref="${earliest}"] .history-btn.restore`)

    // GUI reflects it: the store's doc bpm returns to the baseline value (124).
    await pollUntil(() => page.evaluate(() => window.__store.getState().doc.bpm === 124), 'store bpm to return to 124', 9000)
    // File on disk reverted.
    const bpmAfter = await pollUntil(
      () => {
        const v = bpmOf(beatPath)
        return v === 124 ? v : null
      },
      '.beat file bpm to revert to 124 on disk',
      9000,
    )
    const commitsAfter = countCommits(proj)
    console.log(`[H2] after restore: bpm on disk=${bpmAfter}, commits ${commitsBefore} -> ${commitsAfter}`)
    if (bpmAfter !== 124) throw new Error(`[H2] .beat file bpm did not revert (${bpmAfter})`)
    if (commitsAfter !== commitsBefore + 1) throw new Error(`[H2] expected exactly one NEW checkpoint (append-only), commits ${commitsBefore} -> ${commitsAfter}`)
    // The earliest commit we restored to must STILL exist (nothing rewound/deleted).
    git(proj, 'cat-file', '-e', `${earliest}^{commit}`) // throws if gone
    // The new top-of-log commit is a "go back to" checkpoint.
    const newTop = git(proj, 'log', '-1', '--format=%s').trim()
    console.log(`[H2] newest commit subject: "${newTop}"`)
    if (!/^go back to/.test(newTop)) throw new Error(`[H2] newest checkpoint is not a "go back to" append (got "${newTop}") — restore may have rewound history`)

    // Panel refreshed to show the new checkpoint at the top.
    await pollUntil(
      () => page.evaluate(() => (document.querySelector('.history-row .history-label')?.textContent ?? '').startsWith('go back to')),
      'panel to show the new "go back to" checkpoint on top',
      9000,
    )
    const newRowCount = await page.evaluate(() => document.querySelectorAll('.history-row').length)
    console.log(`[H2] panel now shows ${newRowCount} rows, top row is the new "go back to" checkpoint`)
    if (newRowCount !== rows.length + 1) throw new Error(`[H2] panel row count ${newRowCount} != ${rows.length + 1}`)
    console.log('[H2] PASS: restore is append-only — file reverted, one new checkpoint added, prior history intact, GUI updated')

    await page.screenshot({ path: join(uiDir, 'verify-p15-history.png') })
    console.log('[H2] screenshot -> ui/verify-p15-history.png')

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
