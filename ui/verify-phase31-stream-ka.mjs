#!/usr/bin/env node
// Phase 31 Stream KA — scene/section clip-targeting (docs/phase-31-plan.md's KA section; source
// research docs/research/90, 93). Drives the REAL frontend against a REAL `beat daemon`, reading the
// daemon's own live document via GET /document as ground truth (not just screen state) — the same
// discipline docs/research/93 itself used to catch bugs a screen-only check would have missed.
//
//   T1  Item 1 (verify-first, "Place in Arrangement" mistargeting): build content into a fresh
//       track (clip "X" in section 0 via the loop->song bootstrap), delete the duplicate-by-
//       reference section "+ section" produces, "+ insert scene" a genuinely EMPTY second section,
//       select it, build DIFFERENT content, click "Placed (clip 'X') -- update." Before the fix this
//       overwrote clip X and slotted the same (overwritten) clip into the new section too (pilot 90's
//       highest-impact finding); after the fix the new section gets its OWN clip and X is untouched.
//   T2  Item 2(a): loop mode's synthetic full-loop clip block, after the bottom pane is closed via
//       the real close button, reopens the editor on click AND sets selectedSectionIndex (routing
//       consistency with the populated-block path, even though the index is inert in loop mode).
//   T3  Item 2(b): a plain click on the BARE lane space over a freshly `+ insert scene`'d (genuinely
//       empty) section -- a track with no clip there yet renders no `.arr-clip-block` at all, by
//       design (Phase 24 Stream CC's marquee-select depends on silent sections staying block-free
//       DOM space) -- now resolves which section the click's bar position falls into and sets
//       selectedSectionIndex, the same as clicking a populated block does. Before the fix a click
//       there did nothing at all (only the section-name chip retargeted the editor).
//   T4  Item 3: `+ capture scene` now carries an existing audio-track clip's content into the newly
//       captured scene (media/warp/rate preserved, independent clip copy) instead of unconditionally
//       skipping every audio track. Also confirms the ORIGINAL guard's case (an audio track with NO
//       clip yet) still converts loop->song without a 500.
//   T5  Item 4: re-dropping a sample onto an audio track that already has a clip (with a non-default
//       warp/rate/gainDb) preserves those fields across the media swap, while still replacing the
//       media and resetting the trim (in/out) to the new sample's own length.
//
// Usage: node ui/verify-phase31-stream-ka.mjs

import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8991
const PREVIEW_PORT = 5991

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function pollUntil(fn, what, timeoutMs = 12000, everyMs = 50) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { initDocument, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // A fresh, disposable project (NOT examples/night-shift-song.beat) — loop mode, one synth track
  // "lead", matching pilot 90/93's own starting state exactly.
  const doc = initDocument({ trackId: 'lead' })
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p31ka-'))
  const beatPath = join(proj, 'song.beat')
  writeFileSync(beatPath, serialize(doc))
  console.log(`[setup] fresh loop-mode project at ${beatPath}`)

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
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const results = {}
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1600, height: 1000 })
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    const alerts = []
    page.on('dialog', async (d) => {
      alerts.push(d.message())
      await d.accept() // T1 deliberately clicks "update" on a clip that starts out shared -- accept its own confirm()
    })

    const daemonDocNow = async () => (await fetch(`http://localhost:${daemon.port}/document`)).json()
    const docNow = () => page.evaluate(() => window.__store.getState().doc)

    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    console.log('app ready\n')

    // Helper: tap-add a synth note at a given (bar-relative step, row) inside the currently open
    // note grid -- same tap-to-add gesture onGridPointerUp implements.
    async function addNoteAt(step, row) {
      await page.$eval('.bottom-pane-body', (el) => {
        el.scrollTop = 0
        el.scrollLeft = 0
      })
      await sleep(60)
      const gridBox = await page.locator('.noteview-grid').boundingBox()
      const loopBars = (await docNow()).loopBars
      const stepW = gridBox.width / (loopBars * 16)
      await page.mouse.click(gridBox.x + step * stepW + stepW / 2, gridBox.y + row * 12 + 6)
    }

    // ================= T1: "Place in Arrangement" ignores the selected section =================
    console.log('--- T1: Place in Arrangement + a newly-inserted empty section ---')
    await page.click('.arr-track-select:has(.arr-track-name:text-is("lead"))')
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })

    // Build "Part A" -- a few real notes -- in loop mode.
    await addNoteAt(0, 2)
    await addNoteAt(4, 4)
    await pollUntil(async () => (await docNow()).tracks.find((t) => t.id === 'lead').notes.length === 2, '[T1] Part A notes to land')
    const partANotesSnapshot = (await docNow()).tracks.find((t) => t.id === 'lead').notes.map((n) => `${n.pitch}:${n.start}`).sort()

    // "+ section": loop -> song bootstrap. This mints clip X (id === the new scene id) in section 0,
    // per songAppend's own doc comment, and duplicates it BY REFERENCE into section 1.
    await page.click('[data-add-section="1"]')
    await pollUntil(async () => !!(await daemonDocNow()).song, '[T1] project to enter song mode')
    let d = await daemonDocNow()
    if (d.song.length !== 2) throw new Error(`[T1] setup: expected 2 sections after "+ section", got ${d.song.length}`)
    const clipXId = d.scenes.find((s) => s.id === d.song[0].scene).slots.lead
    console.log(`[T1] section 0/1 share clip "${clipXId}" (duplicate-by-reference, as documented)`)

    // Delete the duplicate (index 1), then "+ insert scene" a genuinely INDEPENDENT, EMPTY section.
    await page.click('[data-section-delete="1"]')
    await pollUntil(async () => (await daemonDocNow()).song.length === 1, '[T1] the duplicate section to be deleted')
    await page.click('[data-insert-scene="1"]')
    await pollUntil(async () => (await daemonDocNow()).song.length === 2, '[T1] "+ insert scene" to add a second section')
    d = await daemonDocNow()
    const newSceneId = d.song[1].scene
    if (Object.keys(d.scenes.find((s) => s.id === newSceneId).slots).length !== 0) {
      throw new Error(`[T1] setup: expected the inserted scene "${newSceneId}" to start with EMPTY slots, got ${JSON.stringify(d.scenes.find((s) => s.id === newSceneId).slots)}`)
    }
    console.log(`[T1] inserted a genuinely empty section 1 (scene "${newSceneId}", slots {})`)

    // Select the new (empty) section via its chip -- the known-working gesture (item 2(b) also adds
    // a real clip-block target for this, checked separately in T3).
    await page.click('[data-section-select="1"]')
    await pollUntil(async () => (await page.evaluate(() => window.__store.getState().selectedSectionIndex)) === 1, '[T1] selectedSectionIndex to become 1')

    // Build DIFFERENT content -- pilot 90's exact repro. The live buffer still shows clip X's old
    // notes (the sync effect deliberately leaves it alone when the selected section has no clip of
    // its own -- see NoteView.tsx's own comment), so these two new notes land ON TOP of the existing
    // two, diverging the live buffer from clip X.
    await addNoteAt(8, 6)
    await addNoteAt(12, 8)
    await pollUntil(async () => (await docNow()).tracks.find((t) => t.id === 'lead').notes.length === 4, '[T1] Part B notes to land in the live buffer')
    const liveNotesAtPlaceTime = (await docNow()).tracks.find((t) => t.id === 'lead').notes.map((n) => `${n.pitch}:${n.start}`).sort()

    // With the fix applied, the button must read the UNPLACED state ("Place in Arrangement," not
    // "Placed (clip 's1') — update") -- the whole point of the fix is that the newly-selected,
    // still-empty section no longer silently inherits clip X's identity. Before the fix, this label
    // itself was already wrong (it read "Placed (clip 's1') — update" here, priming the user to
    // believe THIS section already has X's content, when it actually has none).
    const placeLabelBefore = await page.locator('[data-place-clip="lead"]').textContent()
    console.log(`[T1] "Place in Arrangement" button reads: "${placeLabelBefore.trim()}"`)
    if (placeLabelBefore.includes(clipXId)) {
      throw new Error(`[T1] FAIL: expected the button to read the UNPLACED state for this genuinely-empty section, got "${placeLabelBefore}" (still referencing stale clip "${clipXId}" via primaryClipFor's fallback -- the bug the fix targets)`)
    }
    const placeState = await page.locator('[data-place-clip="lead"]').getAttribute('data-place-clip-state')
    if (placeState !== 'unplaced') throw new Error(`[T1] FAIL: expected data-place-clip-state="unplaced", got "${placeState}"`)

    await page.click('[data-place-clip="lead"]')
    await pollUntil(async () => {
      const dd = await daemonDocNow()
      const scene1 = dd.scenes.find((s) => s.id === newSceneId)
      return !!scene1.slots.lead
    }, '[T1] the newly-selected section to get its own clip slot after clicking Place')

    const docAfterPlace = await daemonDocNow()
    const scene0 = docAfterPlace.scenes.find((s) => s.id === docAfterPlace.song[0].scene)
    const scene1 = docAfterPlace.scenes.find((s) => s.id === newSceneId)
    const clipXNow = docAfterPlace.tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === clipXId)
    const clipXNotesNow = clipXNow.notes.map((n) => `${n.pitch}:${n.start}`).sort()

    if (scene0.slots.lead !== clipXId) throw new Error(`[T1] FAIL: section 0's scene lost its slot for "lead" (now "${scene0.slots.lead}")`)
    if (JSON.stringify(clipXNotesNow) !== JSON.stringify(partANotesSnapshot)) {
      throw new Error(`[T1] FAIL: clip "${clipXId}" (section 0's own clip) was overwritten -- expected Part A's original notes ${JSON.stringify(partANotesSnapshot)}, got ${JSON.stringify(clipXNotesNow)} (pilot 90's exact bug: the newly-selected section's write clobbered the OTHER section's clip)`)
    }
    if (scene1.slots.lead === clipXId) {
      throw new Error(`[T1] FAIL: the newly-selected section still points at clip "${clipXId}" (Part A's clip) instead of getting a clip of its own`)
    }
    const newClip = docAfterPlace.tracks.find((t) => t.id === 'lead').clips.find((c) => c.id === scene1.slots.lead)
    const newClipNotes = newClip.notes.map((n) => `${n.pitch}:${n.start}`).sort()
    if (JSON.stringify(newClipNotes) !== JSON.stringify(liveNotesAtPlaceTime)) {
      throw new Error(`[T1] FAIL: the new section's own clip "${newClip.id}" doesn't carry the live buffer's content -- expected ${JSON.stringify(liveNotesAtPlaceTime)}, got ${JSON.stringify(newClipNotes)}`)
    }
    console.log(`[T1] PASS: clip "${clipXId}" (section 0) untouched with its original 2 notes; section 1 got its OWN new clip "${newClip.id}" with the 4-note live buffer`)
    results.t1 = { clipXId, newSectionClipId: newClip.id }

    // Full-reload sanity check -- the fix must be a real document write, not a client-only illusion.
    await page.reload({ waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    const docAfterReload = await daemonDocNow()
    const scene0AfterReload = docAfterReload.scenes.find((s) => s.id === docAfterReload.song[0].scene)
    const scene1AfterReload = docAfterReload.scenes.find((s) => s.id === newSceneId)
    if (scene0AfterReload.slots.lead !== clipXId || scene1AfterReload.slots.lead === clipXId) {
      throw new Error('[T1] FAIL: the corrected targeting did not survive a full page reload')
    }
    console.log('[T1] PASS: survives a full page reload (real daemon-side document write, not client-only)\n')

    // ================= T2: item 2(a) — loop-mode clip block (fresh project, own daemon) =================
    console.log('--- T2: loop-mode synthetic clip-block click ---')
    const proj2 = mkdtempSync(join(tmpdir(), 'dotbeat-p31ka-t2-'))
    const beatPath2 = join(proj2, 'song.beat')
    const { initDocument: initDocument2, serialize: serialize2 } = await import(join(repoRoot, 'dist/src/core/index.js'))
    writeFileSync(beatPath2, serialize2(initDocument2({ trackId: 'lead' })))
    const PORT2 = 8992
    const daemon2 = await startDaemon({ filePath: beatPath2, port: PORT2 })
    const page2 = await browser.newPage()
    await page2.setViewportSize({ width: 1600, height: 1000 })
    await page2.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon2.port}`, { waitUntil: 'load' })
    await page2.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page2.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    await page2.waitForSelector('.noteview-grid', { timeout: 5000 })

    await page2.click('[data-action="collapse-pane"]')
    await pollUntil(async () => !(await page2.evaluate(() => window.__store.getState().bottomPaneOpen)), '[T2] the bottom pane to close')
    const loopBlock = page2.locator('[data-clip-block="lead::0"]')
    await pollUntil(async () => (await loopBlock.count()) === 1, '[T2] the loop-mode synthetic clip block to render')
    const lbox = await loopBlock.boundingBox()
    await page2.mouse.click(lbox.x + lbox.width / 2, lbox.y + lbox.height / 2)
    await pollUntil(async () => await page2.evaluate(() => window.__store.getState().bottomPaneOpen), '[T2] clicking the loop-mode block to reopen the bottom pane')
    const selSectionAfterLoopClick = await page2.evaluate(() => window.__store.getState().selectedSectionIndex)
    if (selSectionAfterLoopClick !== 0) throw new Error(`[T2] FAIL: expected selectedSectionIndex to become 0 after clicking the loop-mode block, got ${selSectionAfterLoopClick}`)
    console.log('[T2] PASS: closing the pane then clicking the loop-mode clip block reopens the editor AND sets selectedSectionIndex (routing now matches the populated-block path)\n')
    results.t2 = { ok: true }
    await page2.close()
    await daemon2.close()

    // ================= T3: item 2(b) — bare lane space over an empty new section =================
    console.log('--- T3: freshly-inserted empty section — bare-lane click ---')
    // Reuse the T1 daemon/page: after T1, section index 1 already has its own real clip now, so
    // insert ANOTHER genuinely empty section (index 2) for a clean "no clip yet" case.
    await page.click('[data-insert-scene="1"]')
    await pollUntil(async () => (await daemonDocNow()).song.length === 3, '[T3] a third, empty section to be inserted')
    const emptyIdx = 2
    const emptyBlock = page.locator(`[data-clip-block="lead::${emptyIdx}"]`)
    if ((await emptyBlock.count()) !== 0) {
      throw new Error('[T3] setup invalid: expected NO .arr-clip-block for the empty section (Phase 24 Stream CC\'s deliberate "silent section stays block-free" design) — a placeholder block would break marquee-select-from-empty-space')
    }
    console.log('[T3] confirmed: no .arr-clip-block renders for the empty section (silent sections stay genuinely block-free, per Phase 24 Stream CC)')

    // Deselect first (select section 0), THEN click BARE LANE SPACE over the empty section — not a
    // block (there isn't one) and not the chip.
    await page.click('[data-section-select="0"]')
    await pollUntil(async () => (await page.evaluate(() => window.__store.getState().selectedSectionIndex)) === 0, '[T3] selection reset to section 0')
    const docForT3 = await daemonDocNow()
    let startBarOfEmpty = 0
    for (let i = 0; i < emptyIdx; i++) startBarOfEmpty += docForT3.song[i].bars
    const totalBarsForT3 = docForT3.song.reduce((n, s) => n + s.bars, 0)
    const leadLaneBox = await page.locator('.arr-lane[data-track="lead"]').boundingBox()
    const pxPerBarApprox = leadLaneBox.width / totalBarsForT3
    const clickX = leadLaneBox.x + (startBarOfEmpty + 0.5) * pxPerBarApprox
    const clickY = leadLaneBox.y + leadLaneBox.height / 2
    await page.mouse.click(clickX, clickY)
    await pollUntil(async () => (await page.evaluate(() => window.__store.getState().selectedSectionIndex)) === emptyIdx, '[T3] clicking bare lane space over the empty section to retarget selectedSectionIndex')
    console.log(`[T3] PASS: clicking bare lane space over the empty section (no block, no chip) retargeted selectedSectionIndex to ${emptyIdx}\n`)
    results.t3 = { ok: true }

    // ================= T4: item 3 — "+ capture scene" carries over an audio track's clip =================
    console.log('--- T4: capture scene + an audio track with an existing clip ---')
    await page.click('[data-action="add-track"]')
    await page.click('[data-add-kind="audio"]')
    let audioTrackId
    await pollUntil(async () => {
      const found = (await daemonDocNow()).tracks.find((t) => t.kind === 'audio')
      if (found) audioTrackId = found.id
      return !!found
    }, '[T4] a new audio track to appear')
    console.log(`[T4] new audio track: "${audioTrackId}"`)

    async function dropKitLane(trackId, lane) {
      const header = await page.locator(`.arr-row:has(.arr-track-name:text-is("${trackId}")) [data-drop-target="track-header"]`).elementHandle()
      await page.evaluate(
        ({ header, mime, lane }) => {
          const dt = new DataTransfer()
          dt.setData(mime, JSON.stringify({ type: 'kit-lane', kit: 'kit-audiophob', lane }))
          header.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
          header.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
        },
        { header, mime: 'application/x-dotbeat-library-item', lane },
      )
    }
    await dropKitLane(audioTrackId, 'kick')
    let audioClipId
    await pollUntil(async () => {
      const t = (await daemonDocNow()).tracks.find((x) => x.id === audioTrackId)
      const c = t?.clips.find((cc) => cc.audio)
      if (c) audioClipId = c.id
      return !!c
    }, '[T4] the dropped kick sample to create a real audio clip')
    console.log(`[T4] audio clip "${audioClipId}" created from kit-audiophob/kick`)

    // Set a non-default warp/rate on it, same as pilot 93 did, so T4's carry-over check is real.
    await page.click(`.arr-track-select:has(.arr-track-name:text-is("${audioTrackId}"))`)
    await pollUntil(async () => await page.locator(`[data-audio-warp="${audioClipId}"]`).isVisible().catch(() => false), '[T4] the audio clip inspector to render')
    await page.locator(`[data-audio-warp="${audioClipId}"]`).selectOption('repitch')
    await pollUntil(async () => (await daemonDocNow()).tracks.find((t) => t.id === audioTrackId).clips.find((c) => c.id === audioClipId).audio.warp === 'repitch', '[T4] warp=repitch to persist')
    // The rate field only renders once the CLIENT's own store reflects warp=repitch (conditional on
    // `region.warp === 'repitch'` in AudioClipEditor.tsx) -- the daemon poll above can resolve
    // slightly before the client's own doc round-trips back, so wait for the field itself too.
    await pollUntil(async () => await page.locator(`[data-audio-rate="${audioClipId}"]`).isVisible().catch(() => false), '[T4] the rate field to render')
    // The in/out/gain/rate fields commit on onBlur, not onChange (AudioClipEditor.tsx) -- a real
    // blur (not a synthetic 'change' event) is required to fire the handler.
    await page.locator(`[data-audio-rate="${audioClipId}"]`).fill('1.6')
    await page.locator(`[data-audio-rate="${audioClipId}"]`).blur()
    await pollUntil(async () => (await daemonDocNow()).tracks.find((t) => t.id === audioTrackId).clips.find((c) => c.id === audioClipId).audio.rate === 1.6, '[T4] rate=1.6 to persist')
    const audioBefore = (await daemonDocNow()).tracks.find((t) => t.id === audioTrackId).clips.find((c) => c.id === audioClipId).audio
    console.log(`[T4] audio clip's region before capture: ${JSON.stringify(audioBefore)}`)

    const songLenBeforeCapture = (await daemonDocNow()).song.length
    await page.click('[data-capture-insert-scene="1"]')
    await pollUntil(async () => (await daemonDocNow()).song.length === songLenBeforeCapture + 1, '[T4] "+ capture scene" to add a section')
    const docAfterCapture = await daemonDocNow()
    const capturedSceneId = docAfterCapture.song[docAfterCapture.song.length - 1].scene
    const capturedSlots = docAfterCapture.scenes.find((s) => s.id === capturedSceneId).slots
    console.log(`[T4] captured scene "${capturedSceneId}" slots: ${JSON.stringify(capturedSlots)}`)
    if (!capturedSlots[audioTrackId]) {
      throw new Error(`[T4] FAIL: the captured scene's slots do not include the audio track "${audioTrackId}" at all (pilot 93's exact bug — audio unconditionally skipped)`)
    }
    const capturedClipId = capturedSlots[audioTrackId]
    const capturedClip = docAfterCapture.tracks.find((t) => t.id === audioTrackId).clips.find((c) => c.id === capturedClipId)
    if (!capturedClip?.audio) throw new Error(`[T4] FAIL: the captured slot's clip "${capturedClipId}" has no audio region at all`)
    if (capturedClip.audio.media !== audioBefore.media || capturedClip.audio.warp !== audioBefore.warp || capturedClip.audio.rate !== audioBefore.rate) {
      throw new Error(`[T4] FAIL: the captured clip's audio region doesn't match the source clip -- expected ${JSON.stringify(audioBefore)}, got ${JSON.stringify(capturedClip.audio)}`)
    }
    console.log(`[T4] PASS: captured scene includes the audio track, with its clip's media/warp/rate carried over into a real clip "${capturedClipId}"`)
    results.t4a = { capturedClipId, audio: capturedClip.audio }

    // Original guard's own case: an audio track with NO clip yet must still convert loop->song
    // without a 500 (the reason the guard existed in the first place).
    const proj3 = mkdtempSync(join(tmpdir(), 'dotbeat-p31ka-t4b-'))
    const beatPath3 = join(proj3, 'song.beat')
    const { addTrack } = await import(join(repoRoot, 'dist/src/core/index.js'))
    let docNoClip = initDocument2({ trackId: 'lead' })
    docNoClip = addTrack(docNoClip, { id: 'atrk', kind: 'audio' }).doc
    writeFileSync(beatPath3, serialize2(docNoClip))
    const PORT3 = 8993
    const daemon3 = await startDaemon({ filePath: beatPath3, port: PORT3 })
    const res = await fetch(`http://localhost:${daemon3.port}/song`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ op: 'append', bars: 4 }),
    })
    if (res.status !== 200) {
      const body = await res.text()
      throw new Error(`[T4] FAIL: loop->song conversion with an EMPTY audio track present returned HTTP ${res.status} (regression in the original 500-avoidance guard): ${body}`)
    }
    const docAfterAppend = await (await fetch(`http://localhost:${daemon3.port}/document`)).json()
    if (docAfterAppend.scenes[0].slots.atrk) {
      throw new Error(`[T4] FAIL: the empty audio track unexpectedly got a slot after loop->song conversion: ${JSON.stringify(docAfterAppend.scenes[0].slots)}`)
    }
    console.log('[T4] PASS: loop->song conversion with an audio track that has NO clip yet still succeeds (200, unmapped), the original guard case is intact\n')
    results.t4b = { ok: true }
    await daemon3.close()

    // ================= T5: item 4 — re-drop preserves warp/rate/gainDb =================
    console.log('--- T5: re-dropping a sample onto an already-populated audio track ---')
    // Also set a non-default gain, so all three fields are exercised together.
    await page.locator(`[data-audio-gain="${audioClipId}"]`).fill('-7.5')
    await page.locator(`[data-audio-gain="${audioClipId}"]`).blur()
    await pollUntil(async () => (await daemonDocNow()).tracks.find((t) => t.id === audioTrackId).clips.find((c) => c.id === audioClipId).audio.gainDb === -7.5, '[T5] gainDb=-7.5 to persist')
    const beforeRedrop = (await daemonDocNow()).tracks.find((t) => t.id === audioTrackId).clips.find((c) => c.id === audioClipId).audio
    console.log(`[T5] before re-drop: ${JSON.stringify(beforeRedrop)}`)

    // Re-drop a DIFFERENT sample (snare, not kick) onto the SAME track's header -- same clip id gets
    // upserted (per handleLibraryDrop's existingClipId reuse), proving media really does change while
    // warp/rate/gainDb survive.
    await dropKitLane(audioTrackId, 'snare')
    await pollUntil(async () => {
      const c = (await daemonDocNow()).tracks.find((t) => t.id === audioTrackId).clips.find((cc) => cc.id === audioClipId)
      return c?.audio?.media !== beforeRedrop.media
    }, '[T5] the re-drop to replace the clip\'s media')
    const afterRedrop = (await daemonDocNow()).tracks.find((t) => t.id === audioTrackId).clips.find((c) => c.id === audioClipId).audio
    console.log(`[T5] after re-drop: ${JSON.stringify(afterRedrop)}`)

    if (afterRedrop.media === beforeRedrop.media) throw new Error('[T5] setup invalid -- media did not actually change on re-drop')
    if (afterRedrop.warp !== beforeRedrop.warp) throw new Error(`[T5] FAIL: warp was NOT preserved across the media swap -- expected "${beforeRedrop.warp}", got "${afterRedrop.warp}"`)
    if (afterRedrop.rate !== beforeRedrop.rate) throw new Error(`[T5] FAIL: rate was NOT preserved across the media swap -- expected ${beforeRedrop.rate}, got ${afterRedrop.rate}`)
    if (afterRedrop.gainDb !== beforeRedrop.gainDb) throw new Error(`[T5] FAIL: gainDb was NOT preserved across the media swap -- expected ${beforeRedrop.gainDb}, got ${afterRedrop.gainDb}`)
    console.log('[T5] PASS: media changed (kick -> snare) but warp/rate/gainDb all survived the re-drop')

    // Full-reload sanity check.
    await page.reload({ waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    const afterReloadRegion = (await daemonDocNow()).tracks.find((t) => t.id === audioTrackId).clips.find((c) => c.id === audioClipId).audio
    if (afterReloadRegion.warp !== beforeRedrop.warp || afterReloadRegion.rate !== beforeRedrop.rate || afterReloadRegion.gainDb !== beforeRedrop.gainDb) {
      throw new Error('[T5] FAIL: the preserved fields did not survive a full page reload')
    }
    console.log('[T5] PASS: survives a full page reload (real daemon-side document write)\n')
    results.t5 = { before: beforeRedrop, after: afterRedrop }

    if (alerts.length) console.log(`(native dialog(s) seen, expected for T1's shared-clip confirm): ${JSON.stringify(alerts)}`)
    if (pageErrors.length) console.log('\n(page errors, non-fatal):\n' + pageErrors.join('\n'))
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
