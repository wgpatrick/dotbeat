#!/usr/bin/env node
// Phase 32 Stream LB verification — section/scene naming (docs/phase-32-plan.md's LB section,
// docs/research/90-usability-pilot-dnb-song.md, "scene vs section" comparison in docs/research/
// 93-usability-pilot-tutorial-abletonlessons.md). Drives the REAL frontend headlessly against a
// REAL `beat daemon`, on a disposable scratch project copied from examples/night-shift.beat
// (never examples/night-shift-song.beat, never mutated in place).
//
//   T1  A fresh song-mode section, before any name is set, shows the raw scene id on its chip (the
//       existing "section chips show something" contract, unconditional).
//   T2  ONE double-click on the chip, starting from an UNSELECTED section, both selects the section
//       AND opens the rename field (matching the Phase 31 Stream KE track-rename convention — no
//       second double-click needed).
//   T3  Typing a name and pressing Enter commits it: the chip now shows the name (underscores
//       rendered as spaces), the live document's scene carries the name, and it persists to the
//       .beat file as a `name <token>` line inside the scene block.
//   T4  The SAME scene reused by a second section (dotbeat's "+section" duplicate-by-reference
//       behavior) shows the SAME name on both chips — proving the name is scene-level, not
//       section-level, per this stream's design decision.
//   T5  Escape cancels an in-progress rename without committing anything.
//   T6  Clearing the name (committing an empty draft) removes the `name` line entirely from the
//       file and the chip falls back to displaying the raw scene id again.
//   T7  Core round-trip sanity via the CLI: `beat scene-set --name`/`--clear-name` produce the same
//       on-disk shape the GUI flow does (belt-and-suspenders on top of the dedicated unit tests in
//       test/format-v10-scene-name.test.ts).
//
// Usage: node ui/verify-phase32-stream-lb.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 9232 // distinct from other verify scripts' ports so concurrent runs never collide
const PREVIEW_PORT = 6232

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 9000, everyMs = 30) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg)
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))

  // Disposable scratch project — a copy of examples/night-shift.beat (NOT night-shift-song.beat,
  // which must never be touched), written into /tmp so this run never dirties the real repo file.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p32lb-'))
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
    await page.setViewportSize({ width: 1600, height: 1000 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // ============ setup: loop -> song mode ============
    // "+ section" from loop mode mints ONE scene shared by TWO sections (songAppend's own
    // documented behavior: the first section gets the existing loop content, the second is a
    // duplicate-by-reference of it) — exactly the "same scene, two sections" shape T4 needs, for
    // free, with no extra setup.
    await page.click('[data-add-section="1"]')
    await pollUntil(() => page.evaluate(() => (window.__store.getState().doc.song?.length ?? 0) === 2), 'song mode with 2 sections sharing one scene')
    const sceneId = await page.evaluate(() => window.__store.getState().doc.song[0].scene)
    const bothShareScene = await page.evaluate((sid) => window.__store.getState().doc.song.every((s) => s.scene === sid), sceneId)
    assert(bothShareScene, `[setup] expected both sections to share scene "${sceneId}" (songAppend's documented duplicate-by-reference behavior)`)
    console.log(`[setup] PASS: song mode has 2 sections sharing scene "${sceneId}"`)

    // ============ T1: before any name, the chip shows the raw scene id ============
    const chip0NameBefore = (await page.locator('[data-section-select="0"]').textContent()).trim()
    assert(chip0NameBefore === sceneId, `[T1] expected the unnamed chip to fall back to the raw scene id "${sceneId}", got "${chip0NameBefore}"`)
    console.log(`[T1] PASS: unnamed section chip shows the raw scene id "${sceneId}"`)

    // ============ T2: ONE double-click, starting UNSELECTED, both selects AND opens rename ============
    const preSelected = await page.evaluate(() => window.__store.getState().selectedSectionIndex)
    assert(preSelected !== 0, `[T2] setup: expected section 0 to start unselected, got selectedSectionIndex=${preSelected}`)
    assert((await page.locator(`[data-rename-scene="${sceneId}"]`).count()) === 0, '[T2] setup: no rename field should be open yet')

    await page.locator('[data-section-select="0"]').dblclick()
    await pollUntil(() => page.evaluate(() => window.__store.getState().selectedSectionIndex === 0), '[T2] the double-click to select section 0')
    await pollUntil(async () => (await page.locator(`[data-rename-scene="${sceneId}"]`).count()) > 0, '[T2] the rename field to open from the SAME double-click that selected the section', 1500)
    console.log('[T2] PASS: one double-click on an unselected section chip both selected it AND opened the rename field')

    // ============ T3: typing a name + Enter commits it, persists to disk, renders with underscore->space ============
    await page.locator(`[data-rename-scene="${sceneId}"]`).fill('part_a')
    await page.keyboard.press('Enter')
    await pollUntil(() => page.evaluate((sid) => window.__store.getState().doc.scenes.find((s) => s.id === sid)?.name === 'part_a', sceneId), '[T3] the live document to carry the new scene name')
    await pollUntil(() => readFileSync(beatPath, 'utf8').includes('  name part_a\n'), '[T3] the name to persist to the .beat file as a nested `name` line')
    const chip0NameAfter = (await page.locator('[data-section-select="0"]').textContent()).trim()
    assert(chip0NameAfter === 'part a', `[T3] chip should render the underscore as a space for display, got "${chip0NameAfter}"`)
    console.log('[T3] PASS: renamed the scene to "part_a", persisted to disk, chip renders "part a"')
    results.t3 = { sceneId, beatFileHasNameLine: true, chipDisplay: chip0NameAfter }

    // ============ T4: the OTHER section, sharing the same scene, shows the SAME name ============
    const chip1Name = (await page.locator('[data-section-select="1"]').textContent()).trim()
    assert(chip1Name === 'part a', `[T4] the second section (same scene "${sceneId}") should show the SAME name, got "${chip1Name}"`)
    console.log('[T4] PASS: a scene reused across two sections shows one name in both places (scene-level, not section-level)')

    // ============ T5: Escape cancels without committing ============
    await page.locator('[data-section-select="1"]').dblclick()
    await pollUntil(async () => (await page.locator(`[data-rename-scene="${sceneId}"]`).count()) > 0, '[T5] rename field opens again via section 1\'s chip (same scene)')
    await page.locator(`[data-rename-scene="${sceneId}"]`).fill('should_not_stick')
    await page.keyboard.press('Escape')
    await pollUntil(async () => (await page.locator(`[data-rename-scene="${sceneId}"]`).count()) === 0, '[T5] the rename field to close on Escape')
    const nameAfterEscape = await page.evaluate((sid) => window.__store.getState().doc.scenes.find((s) => s.id === sid)?.name, sceneId)
    assert(nameAfterEscape === 'part_a', `[T5] Escape should leave the previous name untouched, got "${nameAfterEscape}"`)
    console.log('[T5] PASS: Escape cancels an in-progress rename without committing')

    // ============ T6: clearing the name (empty draft) removes the name line, falls back to the id ============
    await page.locator('[data-section-select="0"]').dblclick()
    await pollUntil(async () => (await page.locator(`[data-rename-scene="${sceneId}"]`).count()) > 0, '[T6] rename field opens')
    await page.locator(`[data-rename-scene="${sceneId}"]`).fill('')
    await page.keyboard.press('Enter')
    await pollUntil(() => page.evaluate((sid) => window.__store.getState().doc.scenes.find((s) => s.id === sid)?.name === undefined, sceneId), '[T6] the live document to drop the scene name')
    await pollUntil(() => !readFileSync(beatPath, 'utf8').includes('name part_a'), '[T6] the name line to disappear from the .beat file entirely')
    const chip0NameCleared = (await page.locator('[data-section-select="0"]').textContent()).trim()
    assert(chip0NameCleared === sceneId, `[T6] the chip should fall back to the raw scene id once cleared, got "${chip0NameCleared}"`)
    console.log('[T6] PASS: clearing the name removes the name line from disk and the chip falls back to the id')

    if (errors.length) throw new Error(`[FAIL] uncaught page errors during the run:\n${errors.join('\n')}`)

    console.log('\nGUI checks ALL PASS (T1-T6) — Phase 32 Stream LB scene naming: display fallback, one-double-click rename, scene-level (not section-level) naming, Escape-cancels, and clear-name all verified against the real daemon.')
  } finally {
    await browser.close()
    preview.kill()
    await daemon.close()
  }

  // ============ T7: CLI round-trip sanity, independent of the GUI, on a fresh scratch project ============
  const cliProj = mkdtempSync(join(tmpdir(), 'dotbeat-p32lb-cli-'))
  const cliBeatPath = join(cliProj, 'song.beat')
  execFileSync('node', [join(repoRoot, 'cli/beat.mjs'), 'init', cliBeatPath], { stdio: 'pipe' })
  // `beat song` needs sections to reference an EXISTING scene — mint one via `beat clip` (snapshot
  // the starter track's live, empty content) then `beat scene` (wire it into a slot map) before
  // wiring it into the arrangement timeline.
  execFileSync('node', [join(repoRoot, 'cli/beat.mjs'), 'clip', cliBeatPath, 'lead', 'c1'], { stdio: 'pipe' })
  execFileSync('node', [join(repoRoot, 'cli/beat.mjs'), 'scene', cliBeatPath, 's1', 'lead=c1'], { stdio: 'pipe' })
  execFileSync('node', [join(repoRoot, 'cli/beat.mjs'), 'song', cliBeatPath, 's1', '2'], { stdio: 'pipe' })
  let cliDocText = readFileSync(cliBeatPath, 'utf8')
  assert(cliDocText.includes('scene s1'), '[T7] setup: expected scene "s1" to exist before scene-set')

  execFileSync('node', [join(repoRoot, 'cli/beat.mjs'), 'scene-set', cliBeatPath, 's1', '--name', 'introA'], { stdio: 'pipe' })
  cliDocText = readFileSync(cliBeatPath, 'utf8')
  assert(cliDocText.includes('  name introA\n'), `[T7] expected 'beat scene-set --name' to write a name line, file:\n${cliDocText}`)
  console.log('[T7a] PASS: `beat scene-set <file> s1 --name introA` writes the expected `name` line')

  execFileSync('node', [join(repoRoot, 'cli/beat.mjs'), 'scene-set', cliBeatPath, 's1', '--clear-name'], { stdio: 'pipe' })
  cliDocText = readFileSync(cliBeatPath, 'utf8')
  assert(!cliDocText.includes('name introA'), `[T7] expected 'beat scene-set --clear-name' to remove the name line, file:\n${cliDocText}`)
  console.log('[T7b] PASS: `beat scene-set <file> s1 --clear-name` removes the name line again')
  results.t7 = { cliBeatPath }

  console.log('\nALL PASS — Phase 32 Stream LB: GUI rename flow (T1-T6) and CLI round-trip (T7) both verified.')
  console.log(JSON.stringify(results, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
