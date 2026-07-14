#!/usr/bin/env node
// Phase 32 Stream LA verification — right-click context menus for notes/hits (NoteView.tsx) and
// arrangement clip blocks (ArrangementView.tsx). Before this stream, right-click did NOTHING
// anywhere in the app (docs/research/81, 87, 92, 93 — four separate pilots independently tried it
// and found no menu, no browser default menu either). Drives the REAL frontend headlessly against a
// REAL `beat daemon`, on a disposable scratch project copied from examples/night-shift.beat (NEVER
// examples/night-shift-song.beat, the owner's own live project).
//
// What this checks, and why it's not just "does a menu element appear":
//
//   NOTE MENU (NoteView.tsx)
//   N1  Right-click a note opens `.ctx-menu` with Delete/Duplicate/Quantize, and narrows the
//       selection to just that note (the "wasn't already selected" branch).
//   N2  Escape dismisses the menu with ZERO side effects — no note added/removed/changed.
//   N3  Duplicate does the real thing: `postDuplicateNotes`'s own offset (DEFAULT_DUR steps, no
//       pitch shift), verified against the daemon's document (note count +1, new note's start is
//       exactly the original + 2 steps, original note untouched), and the fresh copy becomes the
//       new selection.
//   N4  Quantize does the real thing against a genuinely off-grid note added via a raw /edit call:
//       snaps to the nearest whole step (grid=1, amount=1 daemon defaults), duration unchanged
//       (ends=false default).
//   N5  Delete does the real thing: the note is gone from the daemon's document, selection clears.
//   N6  Multi-select: right-clicking a note ALREADY in a multi-selection acts on the WHOLE
//       selection (both notes deleted), as ONE coalesced undo step (shared gestureId — Phase 30
//       Stream JB's own discipline, extended to this menu).
//   N7  A drum-hit track's context menu has Delete + Quantize but NO Duplicate item (drum hits have
//       no duplicateNotes equivalent — same scope Alt-drag-duplicate already has).
//   N8  Outside-click (clicking the topbar brand logo, nothing to do with the note grid) dismisses
//       the menu too, not just Escape — the automation popup's own Phase 29 Stream GE fix, built in
//       from the start here instead of needing a follow-up.
//
//   CLIP-BLOCK MENU (ArrangementView.tsx)
//   C1  Right-click a clip block opens `.ctx-menu` with exactly Delete + Duplicate (no "Rename
//       section" — Stream LB hadn't merged as of this run).
//   C2  Delete does the real thing: removeClipFromSection's fork-on-touch discipline — the touched
//       section's scene loses the track's slot, a SIBLING section still sharing the ORIGINAL scene
//       id is completely untouched (still has the track's original clip), and the clip block
//       disappears from that section's row.
//   C3  Duplicate does the real thing: a new song section is inserted immediately after, playing a
//       brand-new scene whose clip for this track is a genuinely independent copy (different clip
//       id, identical note content) — the section being duplicated FROM is completely untouched.
//   C4  A real pre-existing bug (docs/research/87: "right-click retargets the clip editor... left-
//       click doesn't... genuinely strange, undiscovered asymmetry") is fixed as a side effect of
//       wiring the menu correctly: right-clicking a clip block to OPEN the menu no longer silently
//       changes `selectedTrackId`/`selectedSectionIndex` the way its old ungated pointerdown handler
//       did.
//   C5  Escape dismisses the clip-block menu with zero side effects (doc.song untouched, no
//       retarget).
//   C6  Outside-click (the topbar brand logo) dismisses the clip-block menu too.
//
// Usage: node ui/verify-phase32-stream-la.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 6232 // distinct from other verify scripts' ports so concurrent runs never collide

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

/** Right-clicks the center of the element `selector` resolves to (a real mouse event sequence
 * through the browser's input pipeline — the same `page.mouse.click(x, y, {button:'right'})` idiom
 * verify-phase29-stream-ge.mjs's GE3 already proved works against this app's PointerEvent-based
 * handlers). Scrolls the target into view first — the same `scrollIntoViewIfNeeded()` every other
 * note-interacting verify script in this repo already does (phase17/19/22/24/26-db/27-eb/28-fb/
 * 28-fd/29-gc/30-jb/31-kc) before touching a note. This one originally skipped it, which was the
 * real, live-confirmed cause of N1's failure: at the 1600x1000 viewport used below, the lead
 * track's notes render below the fold of `.bottom-pane-body`'s own internal scroll (it's shorter
 * than its content), so `boundingBox()` returned coordinates entirely outside the visible/hit-
 * testable area — `document.elementFromPoint` at that spot returned null and the click landed on
 * `<html>` instead of the note, so `onContextMenu` never fired. Confirmed live: the note's own
 * onContextMenu/setCtxMenu/ContextMenu.tsx mount logic is completely correct — right-clicking the
 * SAME note after a manual `scrollIntoView` opens the menu with the correct 3 items immediately. */
async function rightClickCenter(page, selector) {
  const loc = page.locator(selector)
  await loc.waitFor({ state: 'visible', timeout: 5000 })
  await loc.scrollIntoViewIfNeeded()
  const box = await loc.boundingBox()
  if (!box) throw new Error(`no bounding box for ${selector}`)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.click(x, y, { button: 'right' })
  return { x, y }
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))

  // Disposable scratch project — a copy of examples/night-shift.beat (NOT night-shift-song.beat,
  // which must never be touched), written into /tmp so this run never dirties the real repo file.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p32la-'))
  const beatPath = join(proj, 'night-shift.beat')
  writeFileSync(beatPath, serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline night-shift')

  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  console.log(`daemon up on :${daemon.port}, project ${beatPath}`)

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
    await page.setViewportSize({ width: 1600, height: 1000 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('dialog', (d) => {
      // A native dialog anywhere in this run is unexpected — every op here is menu-driven, not
      // window.confirm-gated.
      errors.push(`unexpected native dialog: "${d.message()}"`)
      d.dismiss().catch(() => {})
    })

    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // ================================================================================================
    // N1 — right-click a note opens the menu with Delete/Duplicate/Quantize, narrows the selection
    // ================================================================================================
    console.log('\n[N1] right-click a note -> menu opens with Delete/Duplicate/Quantize, selection narrows')
    assert(daemon.getDoc().selectedTrack === 'lead', 'fixture sanity: expected "lead" selected by default')
    await rightClickCenter(page, '[data-note-id="u100033"]')
    const noteMenu = page.locator('[data-ctx-menu="lead.note"]')
    await noteMenu.waitFor({ state: 'visible', timeout: 4000 })
    const noteItems = await noteMenu.locator('.ctx-menu-item').allTextContents()
    console.log(`  menu items: ${JSON.stringify(noteItems.map((s) => s.trim()))}`)
    assert(await noteMenu.locator('[data-ctx-item="delete"]').count(), 'note menu missing Delete')
    assert(await noteMenu.locator('[data-ctx-item="duplicate"]').count(), 'note menu missing Duplicate')
    assert(await noteMenu.locator('[data-ctx-item="quantize"]').count(), 'note menu missing Quantize')
    await pollUntil(
      async () => JSON.stringify(await page.evaluate(() => window.__store.getState().editNoteIds)) === JSON.stringify(['u100033']),
      'right-click to narrow selection to just u100033',
      3000,
    )
    console.log('  [N1] PASS: menu opened with all 3 items, selection narrowed to the right-clicked note')

    // ================================================================================================
    // N2 — Escape dismisses with zero side effects
    // ================================================================================================
    console.log('\n[N2] Escape dismisses the note menu; nothing changed')
    const notesBeforeEscape = daemon.getDoc().tracks.find((t) => t.id === 'lead').notes.length
    await page.keyboard.press('Escape')
    await pollUntil(async () => (await noteMenu.count()) === 0, '[N2] menu to unmount on Escape', 3000)
    await sleep(150)
    assert(daemon.getDoc().tracks.find((t) => t.id === 'lead').notes.length === notesBeforeEscape, '[N2] Escape must not have mutated the document')
    console.log('  [N2] PASS: Escape closed the menu, note count unchanged')

    // ================================================================================================
    // N3 — Duplicate does the real thing
    // ================================================================================================
    console.log('\n[N3] Duplicate a note via the menu -> a real, offset, independent copy')
    const idsBefore = new Set(daemon.getDoc().tracks.find((t) => t.id === 'lead').notes.map((n) => n.id))
    const original = daemon.getDoc().tracks.find((t) => t.id === 'lead').notes.find((n) => n.id === 'u100033')
    await rightClickCenter(page, '[data-note-id="u100033"]')
    await noteMenu.waitFor({ state: 'visible', timeout: 4000 })
    await noteMenu.locator('[data-ctx-item="duplicate"]').click()
    await pollUntil(() => daemon.getDoc().tracks.find((t) => t.id === 'lead').notes.length === idsBefore.size + 1, '[N3] a new note to land after Duplicate', 4000)
    const afterDup = daemon.getDoc().tracks.find((t) => t.id === 'lead').notes
    const added = afterDup.find((n) => !idsBefore.has(n.id))
    assert(added, '[N3] could not find the newly-added note')
    assert(added.start === original.start + 2, `[N3] expected the duplicate's start to be original+2 (DEFAULT_DUR), got ${added.start} (original ${original.start})`)
    assert(added.pitch === original.pitch, `[N3] expected the duplicate's pitch unchanged, got ${added.pitch} vs original ${original.pitch}`)
    const stillOriginal = afterDup.find((n) => n.id === 'u100033')
    assert(stillOriginal && stillOriginal.start === original.start, '[N3] the ORIGINAL note must be untouched by Duplicate')
    console.log(`  [N3] PASS: duplicate note "${added.id}" landed at start ${added.start} (original "${original.id}" untouched at ${stillOriginal.start})`)
    results.n3 = { addedId: added.id, addedStart: added.start }

    // ================================================================================================
    // N4 — Quantize does the real thing on a genuinely off-grid note
    // ================================================================================================
    console.log('\n[N4] Quantize snaps a real off-grid note to the grid')
    await page.evaluate(
      async ({ base }) => {
        await fetch(`${base}/edit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'lead.note', value: '60 10.37 2 0.8' }) })
      },
      { base: `http://localhost:${daemon.port}` },
    )
    await pollUntil(() => daemon.getDoc().tracks.find((t) => t.id === 'lead').notes.some((n) => n.start === 10.37), '[N4] the off-grid note to land')
    const offGridId = daemon.getDoc().tracks.find((t) => t.id === 'lead').notes.find((n) => n.start === 10.37).id
    // The raw /edit POST above is a real daemon-side document write, but it bypasses the app's own
    // postEdit() (bridge.ts) entirely — that's the ONLY thing that applies an edit's optimistic
    // local mirror into `window.__store`, and the daemon deliberately does NOT re-broadcast a `doc`
    // SSE event for its own /edit writes (writeIfChanged marks the file as already-seen so its own
    // watcher echo is suppressed — see daemon.ts's writeIfChanged/onFileMaybeChanged). So without a
    // reload here the frontend would never learn this note exists at all. Same "real daemon-side
    // write, not a client-only illusion" full-reload idiom verify-phase31-stream-ka.mjs's T1/T5 and
    // several other verify scripts already use for exactly this class of out-of-band daemon write.
    await page.reload({ waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    await rightClickCenter(page, `[data-note-id="${offGridId}"]`)
    await noteMenu.waitFor({ state: 'visible', timeout: 4000 })
    await noteMenu.locator('[data-ctx-item="quantize"]').click()
    await pollUntil(() => {
      const n = daemon.getDoc().tracks.find((t) => t.id === 'lead').notes.find((nn) => nn.id === offGridId)
      return n && n.start === 10
    }, '[N4] the note to snap to start=10 (grid=1, amount=1 daemon defaults)', 4000)
    const quantized = daemon.getDoc().tracks.find((t) => t.id === 'lead').notes.find((n) => n.id === offGridId)
    assert(quantized.duration === 2, `[N4] expected duration unchanged (ends=false default), got ${quantized.duration}`)
    console.log(`  [N4] PASS: note "${offGridId}" snapped from 10.37 -> ${quantized.start}, duration unchanged (${quantized.duration})`)

    // ================================================================================================
    // N5 — Delete does the real thing
    // ================================================================================================
    console.log('\n[N5] Delete a note via the menu -> gone from the document')
    await rightClickCenter(page, '[data-note-id="u100034"]')
    await noteMenu.waitFor({ state: 'visible', timeout: 4000 })
    await noteMenu.locator('[data-ctx-item="delete"]').click()
    await pollUntil(() => !daemon.getDoc().tracks.find((t) => t.id === 'lead').notes.some((n) => n.id === 'u100034'), '[N5] u100034 to be gone from the document', 4000)
    await pollUntil(async () => (await page.evaluate(() => window.__store.getState().editNoteIds.length)) === 0, '[N5] selection to clear after delete', 3000)
    console.log('  [N5] PASS: "u100034" deleted, selection cleared')

    // ================================================================================================
    // N6 — multi-select: right-click a note already in a selection acts on the WHOLE selection, one
    // coalesced undo step
    // ================================================================================================
    console.log('\n[N6] right-click a note inside a multi-selection deletes the WHOLE selection as one undo step')
    await page.click('[data-note-id="u100035"]')
    await pollUntil(async () => JSON.stringify(await page.evaluate(() => window.__store.getState().editNoteIds)) === JSON.stringify(['u100035']), '[N6] setup: u100035 selected alone')
    await page.keyboard.down('Shift')
    await page.click('[data-note-id="u100036"]')
    await page.keyboard.up('Shift')
    await pollUntil(async () => {
      const sel = await page.evaluate(() => window.__store.getState().editNoteIds)
      return sel.length === 2 && sel.includes('u100035') && sel.includes('u100036')
    }, '[N6] setup: both notes multi-selected')
    const undoDepthBefore = daemon.getUndoDepth()
    await rightClickCenter(page, '[data-note-id="u100036"]') // already selected -> should act on BOTH
    await noteMenu.waitFor({ state: 'visible', timeout: 4000 })
    await noteMenu.locator('[data-ctx-item="delete"]').click()
    await pollUntil(() => {
      const notes = daemon.getDoc().tracks.find((t) => t.id === 'lead').notes
      return !notes.some((n) => n.id === 'u100035') && !notes.some((n) => n.id === 'u100036')
    }, '[N6] both u100035 and u100036 to be gone', 4000)
    await pollUntil(() => daemon.getUndoDepth() === undoDepthBefore + 1, '[N6] the two-note delete to land as exactly ONE undo step (shared gestureId)', 3000)
    console.log(`  [N6] PASS: both notes deleted, undo depth went ${undoDepthBefore} -> ${daemon.getUndoDepth()} (one coalesced step, not two)`)
    results.n6 = { undoDepthBefore, undoDepthAfter: daemon.getUndoDepth() }

    // ================================================================================================
    // N7 — a drum-hit's menu has Delete + Quantize but NO Duplicate
    // ================================================================================================
    console.log('\n[N7] a drum hit\'s context menu has no Duplicate item')
    await page.click(trackSelectSel('drums'))
    await pollUntil(async () => (await page.evaluate(() => window.__store.getState().selectedTrackId)) === 'drums', '[N7] setup: drums track selected')
    const firstHitId = daemon.getDoc().tracks.find((t) => t.id === 'drums').hits[0].id
    await rightClickCenter(page, `[data-note-id="${firstHitId}"]`)
    const hitMenu = page.locator('[data-ctx-menu="drums.hit"]')
    await hitMenu.waitFor({ state: 'visible', timeout: 4000 })
    assert(await hitMenu.locator('[data-ctx-item="delete"]').count(), '[N7] hit menu missing Delete')
    assert(await hitMenu.locator('[data-ctx-item="quantize"]').count(), '[N7] hit menu missing Quantize')
    assert((await hitMenu.locator('[data-ctx-item="duplicate"]').count()) === 0, '[N7] hit menu should NOT have Duplicate (drum hits have no duplicateNotes equivalent)')
    console.log('  [N7] PASS: drum-hit menu has Delete + Quantize, no Duplicate')
    await page.keyboard.press('Escape')
    await pollUntil(async () => (await hitMenu.count()) === 0, '[N7] hit menu to close')

    // ================================================================================================
    // N8 — outside click (topbar brand logo) dismisses the note menu
    // ================================================================================================
    console.log('\n[N8] clicking entirely outside (the topbar brand) dismisses the note menu')
    await page.click(trackSelectSel('lead'))
    await pollUntil(async () => (await page.evaluate(() => window.__store.getState().selectedTrackId)) === 'lead', '[N8] setup: lead selected again')
    const remainingLeadNote = daemon.getDoc().tracks.find((t) => t.id === 'lead').notes[0].id
    await rightClickCenter(page, `[data-note-id="${remainingLeadNote}"]`)
    await noteMenu.waitFor({ state: 'visible', timeout: 4000 })
    const leadNotesBeforeOutside = daemon.getDoc().tracks.find((t) => t.id === 'lead').notes.length
    await page.click('.brand')
    await pollUntil(async () => (await noteMenu.count()) === 0, '[N8] note menu to unmount after an outside click', 3000)
    await sleep(150)
    assert(daemon.getDoc().tracks.find((t) => t.id === 'lead').notes.length === leadNotesBeforeOutside, '[N8] outside-click dismiss must not have mutated the document')
    console.log('  [N8] PASS: outside click dismissed the note menu, document unchanged')

    // ================================================================================================
    // C1 — right-click a clip block opens the menu with exactly Delete + Duplicate (no LB "Rename")
    // ================================================================================================
    console.log('\n[C1] enter song mode (2 sections sharing one scene), right-click a clip block')
    assert(daemon.getDoc().song === null, 'fixture sanity: expected loop mode before entering song mode')
    await page.click('[data-add-section="1"]')
    await pollUntil(() => daemon.getDoc().song && daemon.getDoc().song.length === 2, '[C1] setup: 2 sections after one "+ section" click', 4000)
    const sharedSceneId = daemon.getDoc().song[0].scene
    assert(daemon.getDoc().song[1].scene === sharedSceneId, '[C1] setup: both sections should share the SAME scene (songAppend\'s loop-bootstrap behavior)')
    console.log(`  setup: sections 0 and 1 both play scene "${sharedSceneId}"`)

    await rightClickCenter(page, '[data-clip-block="lead::0"]')
    const clipMenu0 = page.locator('[data-ctx-menu="lead.clip.0"]')
    await clipMenu0.waitFor({ state: 'visible', timeout: 4000 })
    const clipItems = await clipMenu0.locator('.ctx-menu-item').allTextContents()
    console.log(`  menu items: ${JSON.stringify(clipItems.map((s) => s.trim()))}`)
    assert(clipItems.length === 2, `[C1] expected exactly 2 items (no LB "Rename section" — not merged this run), got ${clipItems.length}: ${JSON.stringify(clipItems)}`)
    assert(await clipMenu0.locator('[data-ctx-item="delete"]').count(), '[C1] clip menu missing Delete')
    assert(await clipMenu0.locator('[data-ctx-item="duplicate"]').count(), '[C1] clip menu missing Duplicate')
    console.log('  [C1] PASS: clip-block menu opened with exactly Delete + Duplicate')

    // ================================================================================================
    // C2 — Delete forks just the touched section's scene; the sibling section is untouched
    // ================================================================================================
    console.log('\n[C2] Delete on section 0\'s clip block -> forks scene, section 1 (sibling) untouched')
    await clipMenu0.locator('[data-ctx-item="delete"]').click()
    await pollUntil(() => daemon.getDoc().song[0].scene !== sharedSceneId, '[C2] section 0 to get a freshly-forked scene', 4000)
    const doc2 = daemon.getDoc()
    assert(doc2.song[1].scene === sharedSceneId, `[C2] section 1 (sibling) must still point at the original shared scene "${sharedSceneId}", got "${doc2.song[1].scene}"`)
    const forkedScene = doc2.scenes.find((s) => s.id === doc2.song[0].scene)
    assert(!('lead' in forkedScene.slots), '[C2] the forked scene (section 0) must have NO "lead" slot after Delete')
    const siblingScene = doc2.scenes.find((s) => s.id === sharedSceneId)
    assert(siblingScene && siblingScene.slots.lead, '[C2] the sibling scene (still section 1\'s) must STILL have its "lead" slot')
    await pollUntil(async () => (await page.locator('[data-clip-block="lead::0"]').count()) === 0, '[C2] the deleted clip block to disappear from the GUI', 4000)
    assert((await page.locator('[data-clip-block="lead::1"]').count()) === 1, '[C2] the sibling clip block (section 1) must still be showing')
    console.log(`  [C2] PASS: section 0 forked to scene "${doc2.song[0].scene}" (no lead slot), section 1 still plays "${sharedSceneId}" (lead slot intact)`)
    results.c2 = { forkedSceneId: doc2.song[0].scene, siblingSceneId: sharedSceneId }

    // ================================================================================================
    // C3 — Duplicate creates a genuinely independent copy in a new section right after
    // ================================================================================================
    console.log('\n[C3] Duplicate on section 1\'s clip block -> independent copy in a new section')
    // v0.11 (Phase 36): a slot is a PLACEMENT LIST now, not a bare clip id — this single-placement
    // fixture's clip is its one placement's. (Phase 36 Stream PD fixed this read; the script had
    // been crashing here since Stream PA's format change, before ever exercising Duplicate.)
    const originalClipId = daemon.getDoc().scenes.find((s) => s.id === sharedSceneId).slots.lead[0].clip
    const originalClipNotes = JSON.stringify(daemon.getDoc().tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === originalClipId).notes)
    await rightClickCenter(page, '[data-clip-block="lead::1"]')
    const clipMenu1 = page.locator('[data-ctx-menu="lead.clip.1"]')
    await clipMenu1.waitFor({ state: 'visible', timeout: 4000 })
    await clipMenu1.locator('[data-ctx-item="duplicate"]').click()
    await pollUntil(() => daemon.getDoc().song.length === 3, '[C3] a new (3rd) section to be inserted', 4000)
    const doc3 = daemon.getDoc()
    assert(doc3.song[1].scene === sharedSceneId, '[C3] the section being duplicated FROM must be untouched')
    const newSection = doc3.song[2]
    const newScene = doc3.scenes.find((s) => s.id === newSection.scene)
    assert(newScene && newScene.slots.lead, '[C3] the new section\'s scene must have a "lead" slot')
    const newClipId = newScene.slots.lead[0].clip // v0.11 placement list, same read as originalClipId above
    assert(newClipId !== originalClipId, `[C3] the duplicated clip must have a DIFFERENT id than the original, got the same ("${newClipId}")`)
    const newClipNotes = JSON.stringify(doc3.tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === newClipId).notes)
    assert(newClipNotes === originalClipNotes, '[C3] the duplicated clip\'s notes must be an exact content copy of the original')
    const stillOriginalClip = doc3.tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === originalClipId)
    assert(stillOriginalClip, '[C3] the ORIGINAL clip must still exist, untouched')
    await pollUntil(async () => (await page.locator('[data-clip-block="lead::2"]').count()) === 1, '[C3] the new clip block to appear in the GUI', 4000)
    await pollUntil(async () => (await page.evaluate(() => window.__store.getState().selectedSectionIndex)) === 2, '[C3] the new section to become the selected one (same feedback a plain click gives)', 3000)
    console.log(`  [C3] PASS: new clip "${newClipId}" (identical content, different id from "${originalClipId}") landed in a new section 3, original section 2 untouched`)
    results.c3 = { originalClipId, newClipId }

    // ================================================================================================
    // C4/C5 — right-click to OPEN the menu does NOT retarget selection (research/87's asymmetry bug,
    // fixed as part of this stream); Escape dismisses with zero side effects
    // ================================================================================================
    console.log('\n[C4/C5] right-click no longer silently retargets selection; Escape dismisses cleanly')
    await page.click(trackSelectSel('bass'))
    await pollUntil(async () => (await page.evaluate(() => window.__store.getState().selectedTrackId)) === 'bass', '[C4] setup: "bass" selected')
    const trackBeforeRightClick = await page.evaluate(() => window.__store.getState().selectedTrackId)
    const sectionBeforeRightClick = await page.evaluate(() => window.__store.getState().selectedSectionIndex)
    const songBeforeRightClick = JSON.stringify(daemon.getDoc().song)

    await rightClickCenter(page, '[data-clip-block="lead::1"]')
    const clipMenu1b = page.locator('[data-ctx-menu="lead.clip.1"]')
    await clipMenu1b.waitFor({ state: 'visible', timeout: 4000 })
    const trackDuringMenu = await page.evaluate(() => window.__store.getState().selectedTrackId)
    const sectionDuringMenu = await page.evaluate(() => window.__store.getState().selectedSectionIndex)
    assert(trackDuringMenu === trackBeforeRightClick, `[C4] right-click must NOT retarget selectedTrackId (research/87's bug) — was "${trackBeforeRightClick}", now "${trackDuringMenu}"`)
    assert(sectionDuringMenu === sectionBeforeRightClick, `[C4] right-click must NOT retarget selectedSectionIndex — was ${sectionBeforeRightClick}, now ${sectionDuringMenu}`)
    console.log(`  [C4] PASS: right-clicking "lead" section 1's block while "bass" was selected left selection at "${trackDuringMenu}"/${sectionDuringMenu} (unchanged) — the old asymmetry bug is gone`)

    await page.keyboard.press('Escape')
    await pollUntil(async () => (await clipMenu1b.count()) === 0, '[C5] menu to unmount on Escape', 3000)
    assert(JSON.stringify(daemon.getDoc().song) === songBeforeRightClick, '[C5] Escape must not have mutated doc.song')
    assert((await page.evaluate(() => window.__store.getState().selectedTrackId)) === trackBeforeRightClick, '[C5] selection must still be unchanged after Escape')
    console.log('  [C5] PASS: Escape closed the clip menu, doc.song and selection both unchanged')

    // ================================================================================================
    // C6 — outside click (topbar brand logo) dismisses the clip-block menu
    // ================================================================================================
    console.log('\n[C6] clicking entirely outside (the topbar brand) dismisses the clip-block menu')
    await rightClickCenter(page, '[data-clip-block="lead::1"]')
    await clipMenu1b.waitFor({ state: 'visible', timeout: 4000 })
    const songBeforeOutside = JSON.stringify(daemon.getDoc().song)
    await page.click('.brand')
    await pollUntil(async () => (await clipMenu1b.count()) === 0, '[C6] clip menu to unmount after an outside click', 3000)
    await sleep(150)
    assert(JSON.stringify(daemon.getDoc().song) === songBeforeOutside, '[C6] outside-click dismiss must not have mutated doc.song')
    console.log('  [C6] PASS: outside click dismissed the clip-block menu, doc.song unchanged')

    if (errors.length) throw new Error(`[FAIL] uncaught page errors / unexpected dialogs during the run:\n${errors.join('\n')}`)

    console.log('\nALL PASS — Phase 32 Stream LA: note/hit and clip-block right-click context menus verified end-to-end.')
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
