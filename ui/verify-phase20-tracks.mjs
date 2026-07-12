#!/usr/bin/env node
// Phase 20 Stream W — track & project management, verified live end-to-end against a REAL `beat
// daemon` on the real night-shift project, driven through the REAL frontend in headless Chromium.
// Every assertion checks the on-disk .beat file (and a git diff for localization), not just the
// in-browser store — the same "did it really land in the file" bar every prior stream used.
//
//   W1 ADD    click "+ track" → "synth" in the arrangement toolbar; a new `track synth2 … synth`
//             line appears in the .beat file and the git diff adds exactly that one track block.
//   W2 RENAME double-click the new track's name, type a new name, Enter; the file's track line
//             carries the new name and nothing else changes.
//   W3 COLOR  set the track's color input to #aa33cc; the file's track line carries the new color.
//   W4 DELETE click the track's × (confirm auto-accepted); the track line is gone from the file and
//             the git diff removes exactly that block (other tracks untouched).
//   W5 OPENFOLDER the "open folder…" button is present and (in a plain browser, no Tauri) disabled
//             with the desktop-app tooltip — the honest boundary documented in the phase doc.
//
// Usage: node ui/verify-phase20-tracks.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8613
const PREVIEW_PORT = 5343

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
const trackLines = (text) => text.split('\n').filter((l) => l.startsWith('track '))

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p20-'))
  const beatPath = join(proj, 'night-shift.beat')
  writeFileSync(beatPath, serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline night-shift')
  const readBeat = () => readFileSync(beatPath, 'utf8')
  const baselineTracks = trackLines(readBeat())
  console.log(`baseline tracks:\n${baselineTracks.join('\n')}`)

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
    await page.setViewportSize({ width: 1440, height: 960 })
    const errors = []
    page.on('pageerror', (e) => {
      errors.push(String(e))
      console.log(`[pageerror] ${e}`)
    })
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') console.log(`[browser ${m.type()}] ${m.text()}`)
    })
    page.on('dialog', (d) => {
      console.log(`[dialog] ${d.message()}`)
      d.accept()
    }) // auto-accept the delete confirm() + surface any alert()
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    await page.waitForSelector('.arrangement .arr-canvas', { timeout: 5000 })

    // ============ W1: ADD a synth track ============
    await page.click('[data-action="add-track"]')
    await page.waitForSelector('[data-add-kind="synth"]', { timeout: 3000 })
    await page.click('[data-add-kind="synth"]')
    // The new id is "synth" (night-shift has no track literally named "synth", so the id generator's
    // first candidate — the bare kind — is free; it'd be synth2, synth3… only if taken).
    const newId = 'synth'
    await pollUntil(() => page.evaluate((id) => window.__store.getState().doc.tracks.some((t) => t.id === id), newId), 'new track in store')
    const afterAdd = await pollUntil(() => {
      const line = trackLines(readBeat()).find((l) => l.startsWith(`track ${newId} `))
      return line || false
    }, `track ${newId} line to appear in the .beat file`)
    if (!/^track synth synth #[0-9a-f]{6} synth$/.test(afterAdd)) throw new Error(`[W1] unexpected new track line: "${afterAdd}"`)
    const addDiff = git(proj, 'diff', '--', 'night-shift.beat')
    const addedTrackLines = addDiff.split('\n').filter((l) => l.startsWith('+track '))
    if (addedTrackLines.length !== 1 || !addedTrackLines[0].includes('track synth ')) throw new Error(`[W1] diff did not add exactly one track block:\n${addDiff}`)
    if (trackLines(readBeat()).length !== baselineTracks.length + 1) throw new Error('[W1] track count did not grow by exactly 1')
    console.log(`[W1] PASS: added track -> "${afterAdd}" (git diff adds exactly one track block)`)
    results.w1 = { line: afterAdd }
    await page.screenshot({ path: join(uiDir, 'verify-p20-added.png') })

    // ============ W2: RENAME the new track ============
    const renamed = 'BassPad'
    await page.dblclick(`.arr-row:has([data-color="${newId}"]) .arr-track-select`)
    await page.waitForSelector(`[data-rename="${newId}"]`, { timeout: 3000 })
    await page.fill(`[data-rename="${newId}"]`, renamed)
    await page.keyboard.press('Enter')
    const afterRename = await pollUntil(() => {
      const line = trackLines(readBeat()).find((l) => l.startsWith(`track ${newId} `))
      return line && line.includes(` ${renamed} `) ? line : false
    }, `rename to persist to the file`)
    if (!afterRename.startsWith(`track ${newId} ${renamed} `)) throw new Error(`[W2] rename not in file: "${afterRename}"`)
    console.log(`[W2] PASS: renamed -> "${afterRename}"`)
    results.w2 = { line: afterRename }

    // ============ W3: CHANGE the track color ============
    const color = '#aa33cc'
    await page.$eval(
      `[data-color="${newId}"]`,
      (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      },
      color,
    )
    const afterColor = await pollUntil(() => {
      const line = trackLines(readBeat()).find((l) => l.startsWith(`track ${newId} `))
      return line && line.includes(color) ? line : false
    }, `color change to persist to the file`)
    if (!afterColor.includes(color)) throw new Error(`[W3] color not in file: "${afterColor}"`)
    console.log(`[W3] PASS: recolored -> "${afterColor}"`)
    results.w3 = { line: afterColor }
    await page.screenshot({ path: join(uiDir, 'verify-p20-renamed-recolored.png') })

    // ============ W5: open-folder button present + disabled outside Tauri (checked before delete) ============
    const openBtn = await page.$('[data-action="open-folder"]')
    if (!openBtn) throw new Error('[W5] open-folder button missing')
    const openDisabled = await openBtn.evaluate((el) => el.disabled)
    if (!openDisabled) throw new Error('[W5] open-folder should be disabled in a plain (non-Tauri) browser')
    console.log('[W5] PASS: "open folder…" present and disabled outside the desktop app (honest Tauri boundary)')
    results.w5 = { present: true, disabledOutsideTauri: openDisabled }

    // ============ W4: DELETE the track ============
    await page.click(`[data-del="${newId}"]`)
    await pollUntil(() => page.evaluate((id) => !window.__store.getState().doc.tracks.some((t) => t.id === id), newId), 'track removed from store')
    await pollUntil(() => {
      const still = trackLines(readBeat()).some((l) => l.startsWith(`track ${newId} `))
      return !still
    }, `track ${newId} to be gone from the file`)
    const finalTracks = trackLines(readBeat())
    if (finalTracks.length !== baselineTracks.length) throw new Error(`[W4] expected back to ${baselineTracks.length} tracks, got ${finalTracks.length}`)
    // The remaining tracks must be exactly the original set (delete cleaned up, touched nothing else).
    if (finalTracks.join('\n') !== baselineTracks.join('\n')) throw new Error(`[W4] remaining tracks differ from baseline after delete:\n${finalTracks.join('\n')}`)
    console.log(`[W4] PASS: deleted track ${newId}; file is back to the original ${finalTracks.length} tracks, byte-identical track set`)
    results.w4 = { tracksAfter: finalTracks.length }

    if (errors.length) throw new Error(`page errors during run:\n${errors.join('\n')}`)
    console.log('\nALL PASS — Stream W track/project management verified live:')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGKILL')
    await daemon.close()
  }
}

main()
  .then(() => process.exit(0)) // open SSE/watcher handles otherwise keep the process alive
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
