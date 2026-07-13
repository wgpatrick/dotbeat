#!/usr/bin/env node
// Phase 30 Stream JD verification — track/section management polish (docs/phase-30-plan.md's JD
// section, docs/research/87-usability-pilot-arrangement-view.md, docs/research/88-usability-pilot-
// clip-creation.md). Drives the REAL frontend headlessly against a REAL `beat daemon`, on disposable
// scratch projects (never examples/night-shift-song.beat), and checks the daemon's own live document
// (not just the screen) wherever a finding was originally confirmed that way.
//
//   T1  Track rename: typing a space into the inline rename field ("vox sample") still collapses to
//       "voxsample" (the format's real whitespace-tokenized grammar constraint — see
//       ArrangementView.tsx's TrackRow comment for why display name and id, though already separate
//       fields, can't diverge on this without a cross-cutting parser/serializer change), but now
//       shows a visible inline hint the instant it happens, instead of mangling the input in silence.
//   T2  "Instrument" track kind, disabled (no SoundFont registered yet): a proactive inline hint
//       renders under the disabled option pointing at the Content Browser's SoundFonts section — not
//       just a browser-native hover tooltip in CLI vocabulary.
//   T3  "Place in Arrangement" clicked in loop mode (no song section yet): no native dialog fires, a
//       real toast explains "add a song section first", and nothing is written to the document
//       (data-place-clip-state stays "unplaced"). (This turns out to already have been fixed by Phase
//       29 Stream GE's alert->toast sweep, landing before this stream's own work — re-verified here
//       as a real regression check, not assumed from reading the source.)
//       Also: the very next placement (first-ever + a same-scene re-update) fires NO confirm dialog —
//       the shared-clip warning from T5 below must not false-positive on the common single-section
//       case.
//   T4  Dragging a clip block across sections that forks a previously-SHARED scene now fires a toast
//       naming the section whose content just became independent — confirmed against the exact
//       before/after `GET /document` diff pilot 87 used (a source section with its own unique scene,
//       dragged onto a destination section that was sharing a scene with a third, untouched section).
//   T5  Clicking "Placed (clip ...) — update" when that clip is slotted into more than one song
//       section (dotbeat's deliberate "one clip per track, shared by reference" v1 architecture) now
//       confirms before the write lands, naming how many other sections share it: dismissing the
//       confirm makes the click a true no-op (clip unchanged), accepting it performs the update
//       exactly as before, and the clip stays a SINGLE shared object referenced by both scenes (this
//       stream doesn't touch that architecture, only adds the warning).
//   T6  (optional "if time allows" item) The Shortcuts panel now has an explicit "Arrangement"
//       section stating Delete/Cmd+D on a selected clip block don't do anything yet, instead of
//       leaving that silence looking like an undiscovered bug.
//
// Usage: node ui/verify-phase30-stream-jd.mjs

import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5930

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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

async function startPreview() {
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
  return preview
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { initDocument, addNote, saveClip, setScene, setSong, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const preview = await startPreview()
  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const results = {}
  let daemon

  try {
    // ================================================================================================
    // DOC A — a fresh loop-mode project, one synth track ("lead"), NO registered media. Covers
    // T1 (rename), T2 (Instrument disabled hint), T3 (place-in-arrangement no-op + single-section
    // update sanity check).
    // ================================================================================================
    const docA = initDocument({ trackId: 'lead' })
    const projA = mkdtempSync(join(tmpdir(), 'dotbeat-p30jd-a-'))
    const beatPathA = join(projA, 'song.beat')
    writeFileSync(beatPathA, serialize(docA))
    daemon = await startDaemon({ filePath: beatPathA, port: 8930 })
    console.log(`\n[doc A] daemon up on :${daemon.port}`)

    const page = await browser.newPage()
    await page.setViewportSize({ width: 1600, height: 1000 })
    const alertsA = []
    page.on('dialog', async (d) => {
      alertsA.push(d.message())
      await d.dismiss()
    })
    const daemonDocNow = async () => (await fetch(`http://localhost:${daemon.port}/document`)).json()

    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })

    // ==================== T1: rename hint ====================
    // A plain click first (selecting the track, settling the layout the click opens — the bottom
    // pane) before the double-click, matching verify-phase29-stream-gf.mjs's own working sequence:
    // without it, the dblclick's own first click can shift layout under the second one.
    await page.locator('.arr-track-select:has(.arr-track-name:text-is("lead"))').click()
    await sleep(150)
    await page.locator('.arr-track-select:has(.arr-track-name:text-is("lead"))').dblclick()
    await page.waitForSelector('[data-rename="lead"]', { timeout: 3000 })
    await page.locator('[data-rename="lead"]').fill('vox sample')
    await pollUntil(async () => (await page.locator('[data-rename="lead"]').inputValue()) === 'voxsample', 'the rename field to strip the space as typed')
    await pollUntil(async () => (await page.locator('[data-rename-hint="lead"]').count()) === 1, 'an inline "spaces aren\'t allowed" hint to appear')
    const hintText = await page.locator('[data-rename-hint="lead"]').textContent()
    assert(/space/i.test(hintText) && /not allowed|removed/i.test(hintText), `[T1] hint text should explain spaces aren't allowed, got "${hintText}"`)
    console.log(`[T1] PASS: rename field stripped "vox sample" -> "voxsample" AND surfaced an inline hint: "${hintText.trim()}"`)
    await page.keyboard.press('Enter')
    await pollUntil(async () => (await daemonDocNow()).tracks[0].name === 'voxsample', 'the daemon document to reflect the renamed (space-stripped) track name')
    await pollUntil(async () => (await page.locator('[data-rename-hint="lead"]').count()) === 0, 'the hint to disappear once renaming is committed')
    console.log('[T1] PASS: committed name "voxsample" landed in the real document; hint cleared on commit')
    results.t1 = { hintText: hintText.trim() }

    // ==================== T2: Instrument disabled-option inline hint ====================
    await page.click('[data-action="add-track"]')
    await page.waitForSelector('.arr-addtrack-menu', { timeout: 3000 })
    const instrumentDisabled = await page.locator('[data-add-kind="instrument"]').isDisabled()
    assert(instrumentDisabled, '[T2] expected "Instrument" to still be disabled with no registered media')
    await pollUntil(async () => (await page.locator('[data-add-kind-hint="instrument"]').count()) === 1, 'an inline hint under the disabled Instrument option')
    const instrumentHint = await page.locator('[data-add-kind-hint="instrument"]').textContent()
    assert(/soundfont/i.test(instrumentHint) && /browser/i.test(instrumentHint), `[T2] hint should point at the Browser's SoundFonts section, got "${instrumentHint}"`)
    assert(!/beat sample/i.test(instrumentHint), `[T2] hint should NOT use CLI vocabulary ("beat sample"), got "${instrumentHint}"`)
    console.log(`[T2] PASS: disabled "Instrument" option carries a proactive inline hint (not just a hover tooltip): "${instrumentHint.trim()}"`)
    results.t2 = { instrumentHint: instrumentHint.trim() }
    await page.click('[data-action="add-track"]') // close the menu

    // ==================== T3: Place in Arrangement no-op in loop mode ====================
    const beforeT3 = await daemonDocNow()
    assert(!beforeT3.song, '[T3] fixture must still be in loop mode (no song block) at this point')
    await page.click('[data-place-clip="lead"]')
    await pollUntil(async () => (await page.locator('.toast').count()) > 0, 'a toast to appear after clicking Place in Arrangement in loop mode')
    const toastMsg = await page.locator('.toast-message').first().textContent()
    assert(/song section/i.test(toastMsg) && /section/i.test(toastMsg), `[T3] toast should explain adding a song section, got "${toastMsg}"`)
    const afterT3 = await daemonDocNow()
    assert(!afterT3.song, '[T3] loop-mode Place-in-Arrangement click must still write nothing to the document')
    const stateAttr = await page.locator('[data-place-clip="lead"]').getAttribute('data-place-clip-state')
    assert(stateAttr === 'unplaced', `[T3] button state should stay "unplaced", got "${stateAttr}"`)
    assert(alertsA.length === 0, `[T3] expected zero native dialogs, got ${JSON.stringify(alertsA)}`)
    console.log(`[T3] PASS: loop-mode click was a real no-op (nothing written, state stays "unplaced") AND surfaced a toast: "${toastMsg.trim()}"`)
    results.t3 = { toastMsg: toastMsg.trim() }
    // dismiss the toast so it doesn't linger over later screenshots/selectors
    await page.locator('.toast-close').first().click()
    await pollUntil(async () => (await page.locator('.toast').count()) === 0, 'the toast to dismiss')

    // ==================== T3 regression: single-section place/update never confirms ====================
    // songAppend's loop->song bootstrap (daemon.ts) always creates TWO sections sharing ONE scene
    // (section 0 = the existing loop content, section 1 = the new one, same scene id — documented,
    // pre-existing behavior, not something this stream changes). That means right after "+ section"
    // there ARE 2 sections sharing a clip, which is exactly the case T5's new warning should (and, if
    // tested here, does) catch — deliberately prune back to a single, genuinely independent section
    // first so this block tests the true negative-control case (one section, one clip, no sharing).
    await page.click('[data-add-section="1"]') // loop -> song: 2 sections sharing 1 scene
    await pollUntil(async () => (await daemonDocNow()).song?.length === 2, 'loop mode to convert to song mode with 2 (scene-sharing) sections')
    await page.click('[data-section-delete="1"]')
    await pollUntil(async () => (await daemonDocNow()).song?.length === 1, 'pruning back to a single, independent section')
    // author one note so the first placement is a real, observable snapshot
    await page.$eval('.bottom-pane-body', (el) => {
      el.scrollTop = 0
      el.scrollLeft = 0
    })
    await sleep(120)
    const gridBox1 = await page.locator('.noteview-grid').boundingBox()
    await page.mouse.click(gridBox1.x + 40, gridBox1.y + 80)
    await pollUntil(async () => (await daemonDocNow()).tracks[0].notes.length === 1, 'the authored note to land server-side')
    await page.click('[data-place-clip="lead"]')
    await pollUntil(async () => {
      const d = await daemonDocNow()
      return d.tracks[0].clips.length === 1
    }, 'the first placement to create a clip')
    assert(alertsA.length === 0, `[T3 regression] first-ever placement (existing == null) must never confirm, got ${JSON.stringify(alertsA)}`)
    // author a second note, then click "update" — still only ONE section uses this clip, so no confirm
    await page.mouse.click(gridBox1.x + 90, gridBox1.y + 120)
    await pollUntil(async () => (await daemonDocNow()).tracks[0].notes.length === 2, 'the second authored note to land server-side')
    await page.click('[data-place-clip="lead"]')
    await pollUntil(async () => {
      const d = await daemonDocNow()
      return d.tracks[0].clips[0].notes.length === 2
    }, 'the update to re-save both notes into the one, non-shared clip')
    assert(alertsA.length === 0, '[T3 regression] updating a clip used by exactly ONE section must never confirm (T5\'s gate must not false-positive)')
    console.log('[T3] PASS (regression): first placement and a single-section update both proceed with zero confirm dialogs')

    // ==================== T6 (optional, "if time allows"): Shortcuts panel documents the gap ====================
    await page.click('[data-action="toggle-shortcuts"]')
    await page.waitForSelector('[data-testid="shortcut-help-panel"]', { timeout: 3000 })
    const groupTitles = await page.locator('.shortcut-group-title').allTextContents()
    assert(groupTitles.some((t) => /arrangement/i.test(t)), `[T6] expected an "Arrangement" shortcuts group, got groups: ${JSON.stringify(groupTitles)}`)
    const panelText = await page.locator('[data-testid="shortcut-help-panel"]').textContent()
    assert(/does nothing/i.test(panelText) && /Delete/.test(panelText), `[T6] Arrangement group should explicitly say Delete/Cmd+D on a clip block does nothing yet`)
    console.log('[T6] PASS (optional): Shortcuts panel now has an explicit "Arrangement" section documenting that Delete/Cmd+D on a clip block are no-ops, not silently missing')
    results.t6 = { groupTitles }
    await page.click('[data-action="close-shortcuts"]')

    await page.close()
    await daemon.close()

    // ================================================================================================
    // DOC B — song mode, one synth track ("lead"), 3 sections: 0 and 1 SHARE scene "s1"
    // (slots lead->clipA); 2 has its own independent scene "s2" (slots lead->clipB). Covers T4: drag
    // section 2's clip onto section 1 — section 1's shared scene must fork into an independent one,
    // and that (and only that) is what the toast should call out.
    // ================================================================================================
    let docB = initDocument({ trackId: 'lead' })
    docB = addNote(docB, 'lead', { pitch: 60, start: 0, duration: 4, velocity: 0.8 }).doc
    docB = saveClip(docB, 'lead', 'clipA').doc
    docB = setScene(docB, 's1', { lead: 'clipA' })
    let buildingB = { ...docB, tracks: docB.tracks.map((t) => (t.id === 'lead' ? { ...t, notes: [] } : t)) }
    buildingB = addNote(buildingB, 'lead', { pitch: 64, start: 0, duration: 4, velocity: 0.8 }).doc
    buildingB = saveClip(buildingB, 'lead', 'clipB').doc
    buildingB = setScene(buildingB, 's2', { lead: 'clipB' })
    const clipBClip = buildingB.tracks[0].clips.find((c) => c.id === 'clipB')
    docB = {
      ...docB,
      tracks: docB.tracks.map((t) => (t.id === 'lead' ? { ...t, clips: [...t.clips, clipBClip] } : t)),
      scenes: [...docB.scenes, buildingB.scenes.find((s) => s.id === 's2')],
    }
    docB = setSong(docB, [
      { scene: 's1', bars: 4 },
      { scene: 's1', bars: 4 },
      { scene: 's2', bars: 4 },
    ])
    const projB = mkdtempSync(join(tmpdir(), 'dotbeat-p30jd-b-'))
    const beatPathB = join(projB, 'song.beat')
    writeFileSync(beatPathB, serialize(docB))
    daemon = await startDaemon({ filePath: beatPathB, port: 8931 })
    console.log(`\n[doc B] daemon up on :${daemon.port} — song: ${docB.song.map((s) => s.scene).join(', ')}`)

    const pageB = await browser.newPage()
    await pageB.setViewportSize({ width: 1600, height: 1000 })
    const alertsB = []
    pageB.on('dialog', async (d) => {
      alertsB.push(d.message())
      await d.dismiss()
    })
    const daemonDocNowB = async () => (await fetch(`http://localhost:${daemon.port}/document`)).json()

    await pageB.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await pageB.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await pageB.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    await pageB.waitForSelector('[data-clip-block="lead::2"]', { timeout: 5000 })
    await sleep(300) // let ResizeObserver settle lane widths, matching CC's own verify script

    const preMoveDoc = await daemonDocNowB()
    assert(preMoveDoc.song[0].scene === 's1' && preMoveDoc.song[1].scene === 's1', '[T4 setup] sections 0/1 must start sharing scene "s1"')
    assert(preMoveDoc.song[2].scene === 's2', '[T4 setup] section 2 must start on its own independent scene "s2"')

    const block2 = await pageB.$('[data-clip-block="lead::2"]')
    const hb = await block2.boundingBox()
    const startX = hb.x + hb.width / 2
    const startY = hb.y + hb.height / 2
    const dx = -hb.width // one section's worth of bars to the left (all 3 sections are 4 bars wide)
    await pageB.mouse.move(startX, startY)
    await pageB.mouse.down()
    await pageB.mouse.move(startX + dx / 2, startY, { steps: 8 })
    await pageB.mouse.move(startX + dx, startY, { steps: 10 })
    await pageB.mouse.up()

    await pollUntil(async () => (await pageB.locator('.toast').count()) > 0, 'a toast to appear after the clip-drag forks a shared scene')
    const forkToastMsg = await pageB.locator('.toast-message').first().textContent()
    assert(/section 2/i.test(forkToastMsg), `[T4] toast should name section 2 (1-based), got "${forkToastMsg}"`)
    assert(/independent/i.test(forkToastMsg), `[T4] toast should explain the section is now independent, got "${forkToastMsg}"`)
    console.log(`[T4] PASS: clip-drag scene fork surfaced a toast: "${forkToastMsg.trim()}"`)

    const postMoveDoc = await pollUntil(async () => {
      const d = await daemonDocNowB()
      return d.song[1].scene !== 's1' ? d : null
    }, 'section 1\'s scene to fork away from the shared "s1"')
    assert(postMoveDoc.song[0].scene === 's1', '[T4] section 0 (not touched by the move) must keep scene "s1" unchanged')
    const scene0 = postMoveDoc.scenes.find((s) => s.id === 's1')
    assert(scene0.slots.lead === 'clipA', '[T4] the untouched original scene "s1" must still slot lead->clipA (not corrupted by the fork)')
    const scene1 = postMoveDoc.scenes.find((s) => s.id === postMoveDoc.song[1].scene)
    assert(scene1.slots.lead === 'clipB', '[T4] section 1 should now play the moved clipB')
    const scene2 = postMoveDoc.scenes.find((s) => s.id === postMoveDoc.song[2].scene)
    assert(scene2.slots.lead === undefined, '[T4] section 2 (the drag origin) should have lead un-slotted')
    console.log('[T4] PASS: document confirms a real, correct fork — section 0 untouched, section 1 now independently plays clipB, section 2 lost its lead slot')
    results.t4 = { forkToastMsg: forkToastMsg.trim() }

    await pageB.close()
    await daemon.close()

    // ================================================================================================
    // DOC C — song mode, one synth track ("bass"), 2 sections on DIFFERENT scenes that both slot the
    // SAME clip id ("clipX") — the real "one clip per track, shared by reference" architecture (not a
    // shared SCENE this time, a shared CLIP referenced from two independent scenes, matching pilot
    // 88's exact repro). Covers T5: updating that clip must warn before it lands.
    // ================================================================================================
    let docC = initDocument({ trackId: 'bass' })
    docC = addNote(docC, 'bass', { pitch: 40, start: 0, duration: 4, velocity: 0.8 }).doc
    docC = saveClip(docC, 'bass', 'clipX').doc
    docC = setScene(docC, 't1', { bass: 'clipX' })
    docC = setScene(docC, 't2', { bass: 'clipX' })
    docC = setSong(docC, [
      { scene: 't1', bars: 4 },
      { scene: 't2', bars: 4 },
    ])
    const projC = mkdtempSync(join(tmpdir(), 'dotbeat-p30jd-c-'))
    const beatPathC = join(projC, 'song.beat')
    writeFileSync(beatPathC, serialize(docC))
    daemon = await startDaemon({ filePath: beatPathC, port: 8932 })
    console.log(`\n[doc C] daemon up on :${daemon.port} — clipX shared by scenes t1+t2, both in song`)

    const pageC = await browser.newPage()
    await pageC.setViewportSize({ width: 1600, height: 1000 })
    const dialogsC = []
    let dialogAction = 'dismiss'
    pageC.on('dialog', async (d) => {
      dialogsC.push(d.message())
      if (dialogAction === 'accept') await d.accept()
      else await d.dismiss()
    })
    const daemonDocNowC = async () => (await fetch(`http://localhost:${daemon.port}/document`)).json()

    await pageC.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await pageC.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await pageC.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    await pageC.waitForSelector('.noteview-grid', { timeout: 5000 })
    await pollUntil(async () => (await pageC.locator('[data-place-clip="bass"]').getAttribute('data-place-clip-state')) === 'placed', 'the Place button to recognize bass already has a placed clip')

    // author one more note so the update is observable
    await pageC.$eval('.bottom-pane-body', (el) => {
      el.scrollTop = 0
      el.scrollLeft = 0
    })
    await sleep(120)
    const gridBoxC = await pageC.locator('.noteview-grid').boundingBox()
    await pageC.mouse.click(gridBoxC.x + 40, gridBoxC.y + 80)
    await pollUntil(async () => (await daemonDocNowC()).tracks[0].notes.length === 2, 'the extra authored note to land server-side')

    // ---- dismiss branch: cancelling the confirm must be a true no-op ----
    dialogAction = 'dismiss'
    await pageC.click('[data-place-clip="bass"]')
    await pollUntil(async () => dialogsC.length > 0, 'a confirm dialog to fire on updating a clip shared by 2 sections')
    assert(/1 other section/.test(dialogsC[0]), `[T5] confirm should name 1 other section sharing the clip, got "${dialogsC[0]}"`)
    await sleep(300) // let any (incorrect) write settle before asserting it didn't happen
    const afterDismiss = await daemonDocNowC()
    assert(afterDismiss.tracks[0].clips[0].notes.length === 1, '[T5] dismissing the confirm must leave the shared clip UNCHANGED')
    console.log(`[T5] PASS: dismiss branch — confirm fired ("${dialogsC[0].trim()}"), and the shared clip was left untouched`)

    // ---- accept branch: confirming performs the update, and the clip stays ONE shared object ----
    dialogAction = 'accept'
    dialogsC.length = 0
    await pageC.click('[data-place-clip="bass"]')
    await pollUntil(async () => dialogsC.length > 0, 'a second confirm dialog to fire')
    await pollUntil(async () => {
      const d = await daemonDocNowC()
      return d.tracks[0].clips[0].notes.length === 2
    }, 'accepting the confirm to actually perform the update')
    const afterAccept = await daemonDocNowC()
    assert(afterAccept.tracks[0].clips.length === 1, '[T5] the update must still land in the SAME single clip object (architecture unchanged), not fork a second one')
    assert(afterAccept.scenes.find((s) => s.id === 't1').slots.bass === 'clipX', '[T5] scene t1 must still reference clipX')
    assert(afterAccept.scenes.find((s) => s.id === 't2').slots.bass === 'clipX', '[T5] scene t2 must still reference clipX — both sections keep sharing the one updated clip')
    console.log('[T5] PASS: accept branch — update landed in the one shared clip object; both sections still reference it (architecture untouched, as required)')
    results.t5 = { confirmMsg: dialogsC[0].trim() }

    await pageC.close()
    await daemon.close()
    daemon = null

    console.log('\n================ ALL CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    if (daemon) await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nVERIFY FAILED:', err)
  process.exit(1)
})
