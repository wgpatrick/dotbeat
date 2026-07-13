#!/usr/bin/env node
// Phase 31 Stream KB — verify-first: the display/document persistence desync bug pilot 93 reported
// (docs/phase-31-plan.md's "KB" section, docs/research/93-usability-pilot-tutorial-abletonlessons.md).
//
// Pilot 93's two independent repros:
//   1. After switching to a freshly `+ capture scene`d drum clip, several grid clicks (crash accent,
//      syncopated kick, two rimshot fills) showed dots on screen but `GET /document` never changed —
//      survived even a hard reload with zero intervening clicks.
//   2. Typing a negative `rate` (-1) on an audio clip's warp field visibly updated the input and the
//      clip's on-screen label, but `GET /document` never changed from the prior value, and reloading
//      reverted the display too.
//
// This script drives the REAL frontend + a REAL `beat daemon` (not mocks) through both scenarios,
// checking the daemon's own `GET /document` (ground truth) after every edit and after a hard reload.
//
//   KB1 drum-grid case: add a fresh 12-lane Drums track (matching pilot 93's own setup), build a
//       little content, convert to song mode, `+ capture scene`, switch to the new clip via the
//       section-name chip (the documented workaround for KA's item 2, not yet guaranteed merged),
//       then click 4 NEW hits at a deliberate ~1.3s human pace — GD's rapid-burst fix already covers
//       sub-100ms bursts, so pacing here isolates whether this is a genuinely different bug. Checks
//       the daemon's GET /document after EACH click, then after a hard reload.
//   KB2 audio-rate case: add an Audio track, drag a real sample onto its header, set warp=repitch,
//       set a valid rate (1.5), confirm it persists, then type an out-of-range NEGATIVE rate (-1) —
//       core's validateAudioRegionFields (src/core/edit.ts) rejects rate outside [0.1, 8] — and check
//       whether the daemon's document silently diverges from what's optimistically shown on screen,
//       and what happens across a hard reload.
//
// Root cause found (see this stream's summary): bridge.ts's postEdit() applies every edit
// OPTIMISTICALLY to the local store (applyLocalEdit has no validation — it mirrors core's setValue
// grammar, not core's validation), then fires POST /edit. When the daemon REJECTS that edit (4xx —
// e.g. an out-of-range rate), enqueueEditPost only console.warn'd; it never reconciled the client's
// now-wrong optimistic mirror back to the server's actual (unchanged) document. The fix re-pulls
// GET /document whenever /edit comes back non-ok, snapping the client back to ground truth instead of
// silently keeping a value the server never actually wrote.
//
// Usage: node ui/verify-phase31-stream-kb.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT1 = 9310
const PREVIEW_PORT1 = 6310
const PORT2 = 9311
const PREVIEW_PORT2 = 6311

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
}
async function pollUntil(fn, what, timeoutMs = 9000, everyMs = 40) {
  const t0 = Date.now()
  let last
  for (;;) {
    last = await fn()
    if (last) return last
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}
async function servePreview(port) {
  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(port), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview:${port}] ${d}`))
  await pollUntil(
    async () => {
      try {
        return (await fetch(`http://localhost:${port}/`)).ok
      } catch {
        return false
      }
    },
    `vite preview to serve on :${port}`,
    15000,
  )
  return preview
}
async function launchBrowser() {
  return chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { initDocument, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const results = {}

  // ================================================================================================
  // KB1: drum-grid desync after `+ capture scene`, human-paced clicks
  // ================================================================================================
  {
    const proj = mkdtempSync(join(tmpdir(), 'dotbeat-verify-kb1-'))
    const beatPath = join(proj, 'song.beat')
    writeFileSync(beatPath, serialize(initDocument({ bpm: 120 })))

    const daemon = await startDaemon({ filePath: beatPath, port: PORT1 })
    const daemonDoc = () => fetch(`http://localhost:${daemon.port}/document`).then((r) => r.json())
    console.log(`[KB1] daemon up on :${daemon.port}, project ${beatPath}`)

    const preview = await servePreview(PREVIEW_PORT1)
    console.log(`[KB1] ui served on :${PREVIEW_PORT1}`)
    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()
      await page.setViewportSize({ width: 1600, height: 980 })
      const pageErrors = []
      page.on('pageerror', (e) => pageErrors.push(String(e)))
      page.on('dialog', (d) => d.dismiss())
      page.on('console', (msg) => {
        if (msg.type() === 'warning' || msg.type() === 'error') console.log(`  [KB1 page console.${msg.type()}] ${msg.text()}`)
      })

      await page.goto(`http://localhost:${PREVIEW_PORT1}/?daw=${daemon.port}`, { waitUntil: 'load' })
      await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

      // ---- Steps 1-2: "+ track" -> Drums (pilot 93's own setup: a fresh 12-lane kit) ----
      await page.click('[data-action="add-track"]')
      await page.click('[data-add-kind="drums"]')
      await pollUntil(() => page.evaluate(() => window.__store.getState().doc.tracks.some((t) => t.kind === 'drums')), 'a fresh drums track to appear')
      const drumsId = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.kind === 'drums').id)
      await pollUntil(() => page.evaluate((id) => window.__store.getState().selectedTrackId === id, drumsId), 'the new drums track to auto-select')
      await page.waitForSelector('.noteview-grid', { timeout: 5000 })
      // A fresh 12-lane kit's "Lanes (12)" management panel pushes the grid down, often below the
      // fold — scroll it into view first (same precaution verify-phase30-stream-ja.mjs's T6 uses).
      await page.locator('.noteview-grid').scrollIntoViewIfNeeded()
      await page.$eval('.bottom-pane-body', (el) => {
        el.scrollLeft = 0
      })
      await sleep(150)

      const doc0 = await daemonDoc()
      const loopBars0 = doc0.loopBars
      const totalSteps0 = loopBars0 * 16
      const lanes = doc0.tracks.find((t) => t.id === drumsId).lanes.map((l) => l.name)
      assert(lanes.length === 12, `KB1 setup: expected the 12-lane default kit, got ${JSON.stringify(lanes)}`)
      const rowOf = (lane) => lanes.indexOf(lane)

      async function clickCell(lane, step) {
        const gridBox = await page.locator('.noteview-grid').boundingBox()
        const stepW = gridBox.width / totalSteps0
        const x = gridBox.x + (step + 0.15) * stepW
        const y = gridBox.y + rowOf(lane) * 12 + 6
        await page.mouse.click(x, y)
      }

      // ---- Steps 3-4: build a little base content (kick/snare) — not the pace-sensitive part ----
      for (const step of [0, 4, 8, 12]) {
        await clickCell('kick', step)
        await sleep(150)
      }
      for (const step of [4, 12]) {
        await clickCell('snare', step)
        await sleep(150)
      }
      const docBase = await pollUntil(
        async () => {
          const d = await daemonDoc()
          const hits = d.tracks.find((t) => t.id === drumsId).hits
          if (hits.length !== 6) console.log(`  [KB1 debug] currently ${hits.length}/6 base hits: ${JSON.stringify(hits.map((h) => `${h.lane}@${h.start}`))}`)
          return hits.length === 6 ? d : null
        },
        'daemon to register 6 base hits',
        15000,
      )
      const baseHitCount = docBase.tracks.find((t) => t.id === drumsId).hits.length
      console.log(`[KB1] base content: ${baseHitCount} hits on "${drumsId}"`)

      // ---- Step: "+ section" -> song mode ----
      await page.click('[data-add-section="1"]')
      await pollUntil(() => page.evaluate(() => (window.__store.getState().doc.song?.length ?? 0) >= 1), 'song mode with >=1 section')

      // ---- Step: "+ capture scene" -> a genuinely new, independent scene/section ----
      const songLenBefore = await page.evaluate(() => window.__store.getState().doc.song.length)
      await page.click('[data-capture-insert-scene="1"]')
      await pollUntil(() => page.evaluate((n) => window.__store.getState().doc.song.length > n, songLenBefore), '+ capture scene to add a new section')
      const newSectionIndex = (await page.evaluate(() => window.__store.getState().doc.song.length)) - 1
      const capturedDoc = await daemonDoc()
      const capturedSceneId = capturedDoc.song[newSectionIndex].scene
      const capturedClipId = capturedDoc.scenes.find((s) => s.id === capturedSceneId).slots[drumsId]
      const capturedHitCount = capturedDoc.tracks.find((t) => t.id === drumsId).clips.find((c) => c.id === capturedClipId).hits.length
      assert(capturedHitCount === baseHitCount, `KB1: captured clip should snapshot exactly the ${baseHitCount} base hits, got ${capturedHitCount}`)
      console.log(`[KB1] "+ capture scene" created section ${newSectionIndex} / scene "${capturedSceneId}" / clip "${capturedClipId}" with ${capturedHitCount} hits`)

      // ---- Step: switch the editor to the newly-captured clip via the SECTION-NAME CHIP (pilot 93's
      // own documented workaround — the clip BLOCK itself doesn't reopen the editor, that's KA item 2) ----
      const chipSel = `[data-section-select="${newSectionIndex}"]`
      await page.waitForSelector(chipSel, { timeout: 5000 })
      await page.click(chipSel)
      await pollUntil(() => page.evaluate((i) => window.__store.getState().selectedSectionIndex === i, newSectionIndex), 'selectedSectionIndex to switch to the captured section')
      // Wait for NoteView's live-buffer sync (postLoadClip) to actually settle — both the DAEMON's
      // document and the client's own store must show the track's live hits matching the captured
      // clip's hits before we start the pace-sensitive part of the repro.
      await pollUntil(
        async () => {
          const d = await daemonDoc()
          return d.tracks.find((t) => t.id === drumsId).hits.length === capturedHitCount ? d : null
        },
        'daemon track live buffer to finish loading the captured clip',
      )
      await pollUntil(
        () =>
          page.evaluate(
            ([id, n]) => window.__store.getState().doc.tracks.find((t) => t.id === id).hits.length === n,
            [drumsId, capturedHitCount],
          ),
        "client store's live buffer to finish loading the captured clip",
      )
      console.log(`[KB1] switched to captured clip via section-name chip; live buffer settled at ${capturedHitCount} hits`)

      // ---- The pace-sensitive part: 4 NEW hits at a deliberate ~1.3s human pace, GET /document
      // checked after EACH one (ground truth, not window.__store) ----
      const newClicks = [
        { lane: 'crash', step: 2, label: 'crash accent' },
        { lane: 'kick', step: 6, label: 'syncopated kick' },
        { lane: 'rimshot', step: 1, label: 'rimshot fill 1' },
        { lane: 'rimshot', step: 3, label: 'rimshot fill 2' },
      ]
      const kb1Log = []
      let expectedCount = capturedHitCount
      for (const { lane, step, label } of newClicks) {
        await clickCell(lane, step)
        expectedCount += 1
        await sleep(1300) // deliberate, human-scale pacing — well clear of any debounce window
        const d = await daemonDoc()
        const actualCount = d.tracks.find((t) => t.id === drumsId).hits.length
        const clientCount = await page.evaluate((id) => window.__store.getState().doc.tracks.find((t) => t.id === id).hits.length, drumsId)
        const entry = { label, lane, step, expectedCount, daemonCount: actualCount, clientCount }
        kb1Log.push(entry)
        console.log(`  [KB1] after "${label}": expected=${expectedCount} daemon=${actualCount} client=${clientCount}`)
      }

      // ---- Hard reload with ZERO intervening clicks — pilot 93's most damning repro ----
      await page.reload({ waitUntil: 'load' })
      await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
      await sleep(300)
      const afterReloadDaemon = await daemonDoc()
      const afterReloadDaemonCount = afterReloadDaemon.tracks.find((t) => t.id === drumsId).hits.length
      const afterReloadClientCount = await page.evaluate((id) => window.__store.getState().doc.tracks.find((t) => t.id === id).hits.length, drumsId)
      console.log(`[KB1] after hard reload: expected=${expectedCount} daemon=${afterReloadDaemonCount} client=${afterReloadClientCount}`)

      const anyMismatch = kb1Log.some((e) => e.daemonCount !== e.expectedCount || e.clientCount !== e.expectedCount) || afterReloadDaemonCount !== expectedCount || afterReloadClientCount !== expectedCount
      results.kb1 = { reproduced: anyMismatch, baseHitCount, capturedHitCount, log: kb1Log, afterReloadDaemonCount, afterReloadClientCount, expectedFinal: expectedCount }
      if (anyMismatch) {
        console.log('[KB1] REPRODUCED: drum-grid hits taken at human pace after switching to a captured clip diverged from the daemon and/or survived-wrong across reload.')
      } else {
        console.log('[KB1] DID NOT REPRODUCE: every human-paced hit landed on the daemon immediately and survived a hard reload.')
        assert(afterReloadDaemonCount === expectedCount, `KB1 regression guard: expected ${expectedCount} hits to survive reload, got ${afterReloadDaemonCount}`)
      }
      if (pageErrors.length) console.log(`[KB1] (page errors, non-fatal): ${pageErrors.join('; ')}`)
    } finally {
      await browser.close()
      preview.kill('SIGTERM')
      await daemon.close()
    }
  }

  // ================================================================================================
  // KB2: audio clip `rate` field desync on an out-of-range (negative) value
  // ================================================================================================
  {
    const proj = mkdtempSync(join(tmpdir(), 'dotbeat-verify-kb2-'))
    const beatPath = join(proj, 'song.beat')
    writeFileSync(beatPath, serialize(initDocument({ bpm: 120 })))

    const daemon = await startDaemon({ filePath: beatPath, port: PORT2 })
    const daemonDoc = () => fetch(`http://localhost:${daemon.port}/document`).then((r) => r.json())
    console.log(`[KB2] daemon up on :${daemon.port}, project ${beatPath}`)

    const preview = await servePreview(PREVIEW_PORT2)
    console.log(`[KB2] ui served on :${PREVIEW_PORT2}`)
    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()
      await page.setViewportSize({ width: 1600, height: 980 })
      const pageErrors = []
      page.on('pageerror', (e) => pageErrors.push(String(e)))
      page.on('dialog', (d) => d.dismiss())
      const warnings = []
      page.on('console', (msg) => {
        if (msg.type() === 'warning' || msg.type() === 'error') {
          warnings.push(msg.text())
          console.log(`  [KB2 page console.${msg.type()}] ${msg.text()}`)
        }
      })

      await page.goto(`http://localhost:${PREVIEW_PORT2}/?daw=${daemon.port}`, { waitUntil: 'load' })
      await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
      await page.click('[data-action="toggle-library"]')
      await page.waitForSelector('[data-testid="content-browser"]', { timeout: 5000 })
      await pollUntil(async () => (await page.evaluate(() => document.querySelectorAll('.lib-row').length)) > 0, 'library catalog to load rows')

      // ---- Add an Audio track, enter song mode, drop a real sample onto its header ----
      await page.click('[data-action="add-track"]')
      await page.click('[data-add-kind="audio"]')
      await pollUntil(() => page.evaluate(() => window.__store.getState().doc.tracks.some((t) => t.kind === 'audio')), 'a fresh audio track to appear')
      const audioId = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.kind === 'audio').id)
      await pollUntil(() => page.evaluate((id) => window.__store.getState().selectedTrackId === id, audioId), 'the new audio track to auto-select')

      await page.click('[data-add-section="1"]')
      await pollUntil(() => page.evaluate(() => (window.__store.getState().doc.song?.length ?? 0) >= 1), 'song mode with >=1 section')

      const trackHeaderSel = `.arr-row:has(.arr-track-name:text-is("${audioId}")) [data-drop-target="track-header"]`
      await page.dragAndDrop('[data-kit="kit-init"][data-lane="kick"]', trackHeaderSel)
      await pollUntil(
        () =>
          page.evaluate((id) => {
            const t = window.__store.getState().doc.tracks.find((tr) => tr.id === id)
            return t.clips.some((c) => c.audio?.media === 'kit-init-kick')
          }, audioId),
        'the audio track to pick up a kit-init-kick region',
      )
      const clipId = await page.evaluate((id) => {
        const t = window.__store.getState().doc.tracks.find((tr) => tr.id === id)
        return t.clips.find((c) => c.audio?.media === 'kit-init-kick').id
      }, audioId)
      console.log(`[KB2] audio clip "${clipId}" placed on track "${audioId}"`)

      // ---- warp: repitch (unlocks the rate field) ----
      const warpSel = `[data-audio-warp="${clipId}"]`
      await page.waitForSelector(warpSel, { timeout: 5000 })
      await page.selectOption(warpSel, 'repitch')
      await pollUntil(
        async () => {
          const d = await daemonDoc()
          return d.tracks.find((t) => t.id === audioId).clips.find((c) => c.id === clipId).audio.warp === 'repitch'
        },
        'daemon to register warp=repitch',
      )

      // ---- set a VALID rate (1.5) and confirm it persists ----
      const rateSel = `[data-audio-rate="${clipId}"]`
      await page.waitForSelector(rateSel, { timeout: 5000 })
      await page.fill(rateSel, '1.5')
      await page.locator(rateSel).blur()
      const validDoc = await pollUntil(
        async () => {
          const d = await daemonDoc()
          const rate = d.tracks.find((t) => t.id === audioId).clips.find((c) => c.id === clipId).audio.rate
          return rate === 1.5 ? d : null
        },
        'daemon to persist rate=1.5',
      )
      console.log('[KB2] valid rate=1.5 persisted to the daemon correctly')
      results.kb2ValidRate = validDoc.tracks.find((t) => t.id === audioId).clips.find((c) => c.id === clipId).audio.rate

      // ---- set an OUT-OF-RANGE rate (-1), matching pilot 93's exact repro ----
      await page.fill(rateSel, '-1')
      await page.locator(rateSel).blur()
      await sleep(700) // let the (fire-and-forget) POST /edit round-trip settle
      const afterNegDaemon = await daemonDoc()
      const afterNegDaemonRate = afterNegDaemon.tracks.find((t) => t.id === audioId).clips.find((c) => c.id === clipId).audio.rate
      const afterNegClientRate = await page.evaluate(
        (args) => {
          const [id, cid] = args
          const t = window.__store.getState().doc.tracks.find((tr) => tr.id === id)
          return t.clips.find((c) => c.id === cid).audio.rate
        },
        [audioId, clipId],
      )
      const afterNegInputValue = await page.locator(rateSel).inputValue()
      console.log(`[KB2] after typing rate=-1: daemon=${afterNegDaemonRate} client-store=${afterNegClientRate} input-shows="${afterNegInputValue}"`)

      // ---- hard reload — pilot 93's report: the display reverted, matching the daemon ----
      await page.reload({ waitUntil: 'load' })
      await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
      await sleep(300)
      const afterReloadDaemon = await daemonDoc()
      const afterReloadDaemonRate = afterReloadDaemon.tracks.find((t) => t.id === audioId).clips.find((c) => c.id === clipId).audio.rate
      const afterReloadClientRate = await page.evaluate(
        (args) => {
          const [id, cid] = args
          const t = window.__store.getState().doc.tracks.find((tr) => tr.id === id)
          return t.clips.find((c) => c.id === cid).audio.rate
        },
        [audioId, clipId],
      )
      console.log(`[KB2] after hard reload: daemon=${afterReloadDaemonRate} client-store=${afterReloadClientRate}`)

      // The bug: the daemon (ground truth) never accepted -1 (out of [0.1, 8]) yet the CLIENT STORE
      // kept showing -1 until reload — i.e. GET /document and the app's own in-memory state disagreed
      // for as long as the page stayed open. A fixed client reconciles immediately on the /edit
      // rejection, so client-store should already equal 1.5 well before any reload.
      const desyncedBeforeReload = afterNegDaemonRate === 1.5 && afterNegClientRate === -1
      results.kb2 = {
        reproduced: desyncedBeforeReload,
        validRatePersisted: results.kb2ValidRate,
        afterNegDaemonRate,
        afterNegClientRate,
        afterNegInputValue,
        afterReloadDaemonRate,
        afterReloadClientRate,
      }
      if (desyncedBeforeReload) {
        console.log('[KB2] REPRODUCED: an out-of-range rate showed on screen (client store + input) while GET /document silently kept the old value.')
      } else {
        console.log('[KB2] DID NOT REPRODUCE as pilot 93 described (client store already matched the daemon before reload).')
        // Regression guard once fixed: the store AND the input's own displayed value should already
        // be back to the last valid rate (1.5) well before any reload — no lingering rejected value.
        assert(afterNegClientRate === 1.5, `KB2 regression guard: client store should already read back the daemon's real rate (1.5) after a rejected edit, got ${afterNegClientRate}`)
        assert(afterNegInputValue === '1.5', `KB2 regression guard: the rate <input> itself should also revert to "1.5" without needing a reload, got "${afterNegInputValue}"`)
      }
      assert(afterReloadDaemonRate === 1.5, `KB2: daemon rate should still be the last VALID value (1.5) after reload, got ${afterReloadDaemonRate}`)
      assert(afterReloadClientRate === 1.5, `KB2: client store should match the daemon (1.5) after reload, got ${afterReloadClientRate}`)
      if (pageErrors.length) console.log(`[KB2] (page errors, non-fatal): ${pageErrors.join('; ')}`)
    } finally {
      await browser.close()
      preview.kill('SIGTERM')
      await daemon.close()
    }
  }

  console.log('\n================ SUMMARY ================')
  console.log(JSON.stringify(results, null, 2))
}

main().catch((err) => {
  console.error('\nVERIFY FAILED:', err)
  process.exit(1)
})
