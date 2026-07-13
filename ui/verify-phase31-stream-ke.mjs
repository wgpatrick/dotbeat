#!/usr/bin/env node
// Phase 31 Stream KE verification — small copy/interaction fixes (docs/phase-31-plan.md's KE
// section, docs/research/90-usability-pilot-dnb-song.md, docs/research/92-usability-pilot-tutorial-
// pushpatterns.md, docs/research/93-usability-pilot-tutorial-abletonlessons.md). Drives the REAL
// frontend headlessly against a REAL `beat daemon`, on a disposable scratch project copied from
// examples/night-shift.beat (never examples/night-shift-song.beat, never mutated in place).
//
//   T1  Track rename now takes ONE double-click, not two, even on a currently-UNSELECTED track (pilot
//       90's exact repro: the first click of that double-click selects the track, which surfaces the
//       VaryAffordance contextual toolbar as a sibling ABOVE the arrangement — shifting this row's
//       layout mid-gesture, which is exactly what broke the native `dblclick` event before this fix).
//       Asserts both the selection AND the rename field land from a single `page.dblclick()` call on
//       a track that starts unselected, and that the toolbar's layout shift genuinely occurs during
//       the test (so this isn't accidentally testing the easy, already-selected case).
//   T2  The audio clip's `rate` field (under `warp: repitch`) now carries a visible, hoverless label
//       connecting it to "transpose" — not just a bare "rate" nested inside a "warp" dropdown, and not
//       just a hover-only tooltip. The underlying mechanism (a playback-rate multiplier) is confirmed
//       unchanged: the value still round-trips through `data-audio-rate` and persists to disk exactly
//       as before.
//   T3  The "new project…" toast, in plain-browser (non-Tauri) mode, no longer tells a GUI-only user
//       to "point a beat daemon" at anything (CLI vocabulary) — it now explains the same constraint
//       "open folder…"'s own disabled-state tooltip already uses (desktop app / CLI can switch the
//       daemon; this browser tab can't retarget itself).
//   T4  The three "+X" scene-creation buttons now spell out "shares content" vs. "independent
//       (empty|copy)" directly in their VISIBLE label text (not just the hover tooltip), and the two
//       independent-copy buttons carry a distinct visual treatment (color) from the shares-content
//       one. All three `data-*` selectors and their underlying behavior are unchanged — confirmed by
//       actually clicking "+ insert scene" and checking the resulting section gets a scene id no
//       other section shares.
//
// Usage: node ui/verify-phase31-stream-ke.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 9231 // distinct from other verify scripts' ports so concurrent runs never collide
const PREVIEW_PORT = 6231

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

const trackSelectSel = (name) => `.arr-track-select:has(.arr-track-name:text-is("${name}"))`
const trackHeaderSel = (name) => `.arr-row:has(.arr-track-name:text-is("${name}")) [data-drop-target="track-header"]`

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))

  // Disposable scratch project — a copy of examples/night-shift.beat (NOT night-shift-song.beat,
  // which must never be touched), written into /tmp so this run never dirties the real repo file.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p31ke-'))
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
    const nativeDialogs = []

    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // ============ T1: rename via ONE double-click on an UNSELECTED track ============
    // "lead" is the persisted `selected_track` in the fixture (examples/night-shift.beat); "drums"
    // starts genuinely unselected — the exact starting condition pilot 90 hit.
    // Note: `store.selectedTrackId` is the local CLICK override (null until a click sets it) — the
    // fixture's persisted `selected_track lead` line lands in `doc.selectedTrack` instead, and the
    // derived `selectedTrackId(state)` selector falls back to it. Read the raw override here
    // specifically to confirm it's still unset — the exact "genuinely unselected" starting condition
    // the double-click needs to prove itself against (the `.selected`/vary-toolbar chrome that
    // `postSelection` drives is likewise untouched until the very first click on any track).
    const preSelectedOverride = await page.evaluate(() => window.__store.getState().selectedTrackId)
    const preSelectedDoc = await page.evaluate(() => window.__store.getState().doc.selectedTrack)
    assert(preSelectedOverride === null, `[T1] setup: expected no local track-selection override yet, got "${preSelectedOverride}"`)
    assert(preSelectedDoc === 'lead', `[T1] setup: expected the fixture's persisted selected_track to be "lead", got "${preSelectedDoc}"`)
    assert(!(await page.locator('.vary-bar').count()), '[T1] setup: no selection-driven vary toolbar should be showing yet')

    await page.locator(trackSelectSel('drums')).dblclick()

    // The selection half of the gesture: "drums" is now the selected track (also proves the
    // VaryAffordance toolbar's appearance — the layout-shift trigger — actually happened here, not a
    // no-op scenario).
    await pollUntil(() => page.evaluate(() => window.__store.getState().selectedTrackId === 'drums'), '[T1] the double-click to select "drums"')
    await pollUntil(async () => (await page.locator('.vary-bar').count()) > 0, '[T1] the contextual vary toolbar to appear now that a track is selected (confirms the layout-shift condition was live)')

    // The rename half of the gesture: the SAME double-click also opened the rename field — no second
    // double-click needed.
    await pollUntil(async () => (await page.locator('[data-rename="drums"]').count()) > 0, '[T1] the rename field to open from the SAME double-click that selected the track', 1500)
    console.log('[T1a] PASS: one double-click on an unselected track both selected it AND opened the rename field')

    await page.locator('[data-rename="drums"]').fill('Percussion')
    await page.keyboard.press('Enter')
    await pollUntil(() => readFileSync(beatPath, 'utf8').includes('track drums Percussion '), '[T1] the rename to persist to the .beat file')
    console.log('[T1b] PASS: renamed "drums" -> "Percussion", persisted to disk')
    results.t1 = { preSelectedDoc }

    // ============ T1c: false-positive guard — selecting a track then quickly clicking mute must NOT
    // open rename (the list-level double-click coordinator explicitly excludes real <button> controls
    // so this can't be misread as the second half of a rename gesture) ============
    await page.locator(trackSelectSel('bass')).click()
    await pollUntil(() => page.evaluate(() => window.__store.getState().selectedTrackId === 'bass'), '[T1c] select "bass"')
    await page.locator('[data-mute="bass"]').click() // deliberately fast-follow, well within the 400ms pairing window
    await sleep(150)
    assert((await page.locator('[data-rename="bass"]').count()) === 0, '[T1c] clicking mute right after selecting a track must not open its rename field')
    assert(await page.evaluate(() => window.__store.getState().mutes['bass'] === true), '[T1c] the mute click itself should still have taken effect normally')
    console.log('[T1c] PASS: selecting a track then quickly clicking mute does not falsely open rename')

    // ============ T2: audio clip's "rate" field is discoverably labeled as the transpose control ============
    // Song mode first: dropping a sample onto an EMPTY audio track's header slots the new clip into
    // the first song section's scene (ArrangementView.tsx's handleLibraryDrop) — in loop mode there's
    // no scene to slot into yet, and the drop is refused with a toast, not a clip. Matches
    // verify-phase30-stream-je.mjs's own T3-before-T4 ordering.
    await page.click('[data-add-section="1"]') // loop -> song mode
    await pollUntil(() => page.evaluate(() => (window.__store.getState().doc.song?.length ?? 0) >= 1), 'song mode with at least 1 section')

    await page.click('[data-action="toggle-library"]')
    await page.waitForSelector('[data-testid="content-browser"]', { timeout: 5000 })
    await pollUntil(async () => (await page.evaluate(() => document.querySelectorAll('.lib-row').length)) > 0, 'library catalog to load rows')

    await page.click('[data-action="add-track"]')
    await page.click('[data-add-kind="audio"]')
    await pollUntil(() => page.evaluate(() => window.__store.getState().doc.tracks.some((t) => t.kind === 'audio')), 'a fresh audio track to appear')
    const audioTrackId = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.kind === 'audio').id)
    await pollUntil(() => page.evaluate((id) => window.__store.getState().selectedTrackId === id, audioTrackId), 'the new audio track to auto-select')

    await page.dragAndDrop('[data-kit="kit-init"][data-lane="kick"]', trackHeaderSel(audioTrackId))
    await pollUntil(
      () =>
        page.evaluate((id) => {
          const t = window.__store.getState().doc.tracks.find((tr) => tr.id === id)
          return t.clips.some((c) => c.audio?.media === 'kit-init-kick')
        }, audioTrackId),
      'the audio track to pick up a kit-init-kick region',
    )
    const audioClipId = await page.evaluate((id) => {
      const t = window.__store.getState().doc.tracks.find((tr) => tr.id === id)
      return t.clips.find((c) => c.audio?.media === 'kit-init-kick').id
    }, audioTrackId)

    await page.waitForSelector(`[data-audio-warp="${audioClipId}"]`, { timeout: 5000 })
    await page.selectOption(`[data-audio-warp="${audioClipId}"]`, 'repitch')
    await page.waitForSelector(`[data-audio-rate="${audioClipId}"]`, { timeout: 3000 })

    const rateLabelText = await page.evaluate((clipId) => {
      const input = document.querySelector(`[data-audio-rate="${clipId}"]`)
      return input?.closest('label')?.textContent ?? ''
    }, audioClipId)
    assert(/rate/i.test(rateLabelText), `[T2] rate field's own label should still say "rate", got "${rateLabelText}"`)
    assert(/transpose/i.test(rateLabelText), `[T2] rate field's VISIBLE label should connect it to "transpose" without requiring a hover, got "${rateLabelText}"`)
    console.log(`[T2a] PASS: the rate field's visible label reads "${rateLabelText.trim()}"`)

    // Mechanism unchanged: still a plain playback-rate multiplier that persists via data-audio-rate.
    await page.locator(`[data-audio-rate="${audioClipId}"]`).fill('1.5')
    await page.locator(`[data-audio-rate="${audioClipId}"]`).blur()
    await pollUntil(
      () =>
        page.evaluate((id) => {
          const t = window.__store.getState().doc.tracks.find((tr) => tr.id === id)
          return t?.clips?.some((c) => c.audio?.rate === 1.5)
        }, audioTrackId),
      '[T2] the rate value to persist as a plain multiplier (1.5), not a semitone reinterpretation',
    )
    console.log('[T2b] PASS: rate still functions as a playback-rate multiplier (set to 1.5, persisted)')
    results.t2 = { audioTrackId, audioClipId, rateLabelText: rateLabelText.trim() }

    // ============ T3: "new project…" toast wording matches "open folder…"'s honest style ============
    const openFolderTitle = await page.locator('[data-action="open-folder"]').getAttribute('title')
    assert(/desktop app/i.test(openFolderTitle), `[T3] setup: expected "open folder…" tooltip to reference the desktop app, got "${openFolderTitle}"`)

    const newProjPath = join(mkdtempSync(join(tmpdir(), 'dotbeat-p31ke-np-')), 'new-song.beat')
    page.once('dialog', async (d) => {
      assert(/destination folder/i.test(d.message()), `[T3] unexpected prompt: "${d.message()}"`)
      await d.accept(newProjPath)
    })
    await page.click('[data-action="new-project"]')
    await pollUntil(async () => (await page.locator('[data-testid="toast-host"] .toast').count()) > 0, '[T3] a toast to appear after creating the new project')
    const newProjectToast = await page.locator('[data-testid="toast-host"] .toast-message').first().textContent()
    assert(!/point a beat daemon/i.test(newProjectToast), `[T3] toast should no longer use the CLI-only "point a beat daemon" phrasing, got "${newProjectToast}"`)
    assert(/desktop app/i.test(newProjectToast) && /cli/i.test(newProjectToast), `[T3] toast should explain the same desktop-app/CLI constraint "open folder…" uses, got "${newProjectToast}"`)
    console.log(`[T3] PASS: "new project…" toast now reads "${newProjectToast.trim()}"`)
    results.t3 = { openFolderTitle, newProjectToast: newProjectToast.trim() }
    await page.locator('[data-testid="toast-host"] .toast-close').first().click().catch(() => {})

    // ============ T4: "+X" scene-creation button prominence/labels ============
    // Already in song mode since T2's setup — the trio of buttons under test is already rendered.
    const addSectionText = (await page.locator('[data-add-section="1"]').textContent()).trim()
    const insertSceneText = (await page.locator('[data-insert-scene="1"]').textContent()).trim()
    const captureSceneText = (await page.locator('[data-capture-insert-scene="1"]').textContent()).trim()
    assert(/shares content/i.test(addSectionText), `[T4] "+ section" visible label should spell out "shares content", got "${addSectionText}"`)
    assert(/independent/i.test(insertSceneText), `[T4] "+ insert scene" visible label should spell out "independent", got "${insertSceneText}"`)
    assert(/independent/i.test(captureSceneText), `[T4] "+ capture scene" visible label should spell out "independent", got "${captureSceneText}"`)
    console.log(`[T4a] PASS: visible labels now read "${addSectionText}" / "${insertSceneText}" / "${captureSceneText}"`)

    // Tooltips (already accurate per pilot 87) are untouched.
    const addSectionTitle = await page.locator('[data-add-section="1"]').getAttribute('title')
    const captureSceneTitle = await page.locator('[data-capture-insert-scene="1"]').getAttribute('title')
    assert(/duplicates/i.test(addSectionTitle), `[T4] "+ section" tooltip should still explain the duplication, got "${addSectionTitle}"`)
    assert(/snapshot/i.test(captureSceneTitle), `[T4] "+ capture scene" tooltip should still explain the snapshot, got "${captureSceneTitle}"`)

    // Visual distinction: the shares-content button and the two independent-copy buttons render with
    // different colors, not three visually-identical buttons.
    const [sharedColor, insertColor, captureColor] = await Promise.all(
      ['[data-add-section="1"]', '[data-insert-scene="1"]', '[data-capture-insert-scene="1"]'].map((sel) => page.$eval(sel, (el) => getComputedStyle(el).borderColor)),
    )
    assert(insertColor === captureColor, `[T4] the two independent-copy buttons should share a visual treatment, got "${insertColor}" vs "${captureColor}"`)
    assert(sharedColor !== insertColor, `[T4] the shares-content button should look visually distinct from the independent-copy buttons, both rendered "${sharedColor}"`)
    console.log(`[T4b] PASS: shares-content border "${sharedColor}" differs from the independent-copy border "${insertColor}"`)

    // Functional regression: "+ insert scene" still creates a genuinely independent scene (not shared
    // with any existing section) — the labeling change didn't touch the underlying behavior.
    const scenesBefore = await page.evaluate(() => window.__store.getState().doc.song.map((s) => s.scene))
    await page.click('[data-insert-scene="1"]')
    await pollUntil(() => page.evaluate((n) => window.__store.getState().doc.song.length === n, scenesBefore.length + 1), '[T4] "+ insert scene" to add one more section')
    const scenesAfter = await page.evaluate(() => window.__store.getState().doc.song.map((s) => s.scene))
    const newScene = scenesAfter[scenesAfter.length - 1]
    assert(!scenesBefore.includes(newScene), `[T4] the newly-inserted scene ("${newScene}") should not be shared with any pre-existing section (${JSON.stringify(scenesBefore)})`)
    console.log(`[T4c] PASS: "+ insert scene" still creates a genuinely independent scene ("${newScene}"), unaffected by the label/color change`)
    results.t4 = { addSectionText, insertSceneText, captureSceneText, sharedColor, insertColor }

    if (errors.length) throw new Error(`[FAIL] uncaught page errors during the run:\n${errors.join('\n')}`)
    if (nativeDialogs.length) throw new Error(`[FAIL] unexpected native dialogs: ${JSON.stringify(nativeDialogs)}`)

    console.log('\nALL PASS — Phase 31 Stream KE: track-rename double-click, audio rate labeling, new-project toast wording, and scene-button prominence all verified.')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill()
    await daemon.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
