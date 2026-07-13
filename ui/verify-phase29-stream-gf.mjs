#!/usr/bin/env node
// Phase 29 Stream GF — layout/visual/small-correctness polish sweep (docs/phase-29-plan.md).
// Drives the REAL frontend headlessly against a REAL `beat daemon`, reading the actual .beat file
// on disk where the finding is a persistence bug, and real computed layout/DOM state where the
// finding is a visual/interaction one — never mocks. Ten items in the plan; T1-T7, T9, T10 below
// each independently verify one. Item 8 (a "setState during render" console warning pilot 84
// reported) was investigated extensively this session — static review of every zustand-setter call
// site in ArrangementView.tsx/NoteView.tsx, plus long, varied Playwright interaction sequences
// (track/clip clicks, tab switches, automation add/remove, playback, panel toggles, rapid-fire
// clicking) against a `vite dev` server (production builds strip this exact warning) — without
// reproducing it. No code change was made for item 8; T8 below is a general console-hygiene guard
// across this script's own interactions, not a targeted regression test for a bug that couldn't be
// isolated this session (see the phase report for the full methodology).
//
//   T1  Loading a project whose selected track's clip editor is already tall enough to need its own
//       vertical scrollbar (.bottom-pane-body) does NOT push document.body.scrollWidth past
//       window.innerWidth — the .arr-length-bar scrollWidth-measurement bug (item 1) is fixed.
//   T2  .arr-clip-block's computed border-width is >= 2px (was 1px) — real contrast, not just a
//       cosmetic tweak that could regress silently.
//   T3  Renaming a track updates the "selection: <name>" status-strip text live, without needing to
//       re-select anything — it re-derives from the CURRENT track name, not a stale id-shaped label.
//   T4  Setting an audio clip's loop start/end through ClipPropertiesPanel's numeric fields actually
//       persists to the raw .beat file for an audio-kind clip (was silently dropped).
//   T5  The audio clip warp <select>'s "complex" option's own visible label includes "(not yet
//       implemented)"; "off"/"repitch" don't.
//   T6  A freshly-added, empty automation lane, added while the arrangement pane is short (the
//       "isn't tall enough" trigger pilot 84 hit), is the TOPMOST element at its own on-screen
//       position (scrolled into view automatically) — not painted behind the bottom pane.
//   T7  Adding two automation lanes in a row does NOT reset the parameter picker back to the very
//       top of the list each time — the previously-picked param falling out of `available` lands on
//       a NEARBY option, not index 0.
//   T9  Content Browser: kit-lane rows (real audio) carry a `.lib-audio-badge`; drum PRESET rows
//       (including the genre-named 808-TRAP-style sections) do not.
//   T10 A synth/drums track's Device panel opens with the "Sends" accordion section already
//       expanded (`open` true) by default, no click required.
//
// Usage: node ui/verify-phase29-stream-gf.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8929
const PREVIEW_PORT = 5929

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 12000, everyMs = 60) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}

function initProject() {
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p29gf-'))
  const beatPath = join(proj, 'song.beat')
  writeFileSync(beatPath, readFileSync(join(repoRoot, 'examples/night-shift-song.beat'), 'utf8'))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')
  return { proj, beatPath }
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { beatPath } = initProject()
  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon up on :${daemon.port}, project ${beatPath}`)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try {
      return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok
    } catch {
      return false
    }
  }, 'vite preview to serve', 15000)
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const results = {}
  const consoleWarnings = []

  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    const alerts = []
    page.on('dialog', async (d) => {
      alerts.push(d.message())
      await d.dismiss()
    })
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /cannot update a component|while rendering a different component/i.test(msg.text())) {
        consoleWarnings.push(msg.text())
      }
    })

    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await pollUntil(async () => await page.locator('.arr-clip-block').first().isVisible().catch(() => false), 'arrangement loaded')
    await sleep(300)

    // ============ T1: horizontal overflow ============
    // night-shift-song.beat opens with "lead" selected and its clip editor already tall enough
    // (real content + the inspector row) to need .bottom-pane-body's own vertical scrollbar —
    // reproduces the bug on a bare fresh load, no interaction required (pilot 81's own finding).
    const overflow = await page.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
      bottomPaneNeedsScroll: (() => {
        const el = document.querySelector('.bottom-pane-body')
        return el ? el.scrollHeight > el.clientHeight : false
      })(),
    }))
    if (!overflow.bottomPaneNeedsScroll) throw new Error(`[T1] setup invalid — .bottom-pane-body doesn't need a vertical scrollbar in this fixture, so this isn't exercising the bug at all: ${JSON.stringify(overflow)}`)
    if (overflow.bodyScrollWidth > overflow.innerWidth) {
      throw new Error(`[T1] FAIL: document.body.scrollWidth (${overflow.bodyScrollWidth}) exceeds window.innerWidth (${overflow.innerWidth}) — the horizontal overflow bug is still present`)
    }
    console.log(`[T1] PASS: body.scrollWidth (${overflow.bodyScrollWidth}) === innerWidth (${overflow.innerWidth}) even though the bottom pane needs its own vertical scrollbar`)
    results.t1 = overflow

    // ============ T2: clip block border contrast ============
    const borderWidth = await page.$eval('.arr-clip-block', (el) => parseFloat(getComputedStyle(el).borderTopWidth))
    if (!(borderWidth >= 2)) throw new Error(`[T2] FAIL: .arr-clip-block border-width is ${borderWidth}px, expected >= 2px`)
    console.log(`[T2] PASS: .arr-clip-block border-width is ${borderWidth}px (>= 2px)`)
    results.t2 = { borderWidth }

    // ============ T3: stale "selection: X" label after rename ============
    await page.locator('.arr-track-select:has(.arr-track-name:text-is("bass"))').click()
    await pollUntil(async () => (await page.locator('.vary-scope-hint').textContent())?.includes('bass'), '[T3] selection hint to show "bass" pre-rename')
    // Double-click the track name to enter rename mode, retype, commit with Enter — the exact
    // gesture the arrangement's own hint text advertises.
    await page.locator('.arr-track-select:has(.arr-track-name:text-is("bass"))').dblclick()
    const renameInput = page.locator('input[data-rename="bass"]')
    await renameInput.fill('bassline')
    await renameInput.press('Enter')
    await pollUntil(async () => (await readFileSync(beatPath, 'utf8')).includes('bassline'), '[T3] the rename to actually persist to the .beat file')
    const hintAfterRename = await page.locator('.vary-scope-hint').textContent()
    if (!hintAfterRename.includes('bassline')) throw new Error(`[T3] FAIL: selection hint still reads "${hintAfterRename}" after renaming "bass" -> "bassline" — did not re-derive from the current name`)
    if (hintAfterRename.includes('selection: bass ') || hintAfterRename.trim() === 'selection: bass') throw new Error(`[T3] FAIL: selection hint still shows the stale pre-rename name: "${hintAfterRename}"`)
    console.log(`[T3] PASS: selection hint updated live to "${hintAfterRename.trim()}" with no re-selection needed`)
    results.t3 = { hintAfterRename: hintAfterRename.trim() }

    // ============ T4 + T5: audio clip loop persistence + warp:complex annotation ============
    // Add a fresh audio track, drag a real kit-lane sample onto its header (song mode already
    // active in this fixture) to create a clip, then drive ClipPropertiesPanel's loop fields and
    // the warp <select> exactly as a user would.
    const idsBefore = new Set(await page.evaluate(() => window.__store.getState().doc.tracks.map((t) => t.id)))
    await page.locator('[data-action="add-track"]').click()
    await page.locator('[data-add-kind="audio"]').click()
    let audioTrackId
    await pollUntil(async () => {
      const found = (await page.evaluate(() => window.__store.getState().doc.tracks.map((t) => t.id))).find((id) => !idsBefore.has(id))
      if (found) audioTrackId = found
      return !!found
    }, '[T4] a new audio track to appear')
    console.log(`[T4] new audio track: "${audioTrackId}"`)

    const audioHeader = await page.locator(`.arr-row:has(.arr-track-name:text-is("${audioTrackId}")) [data-drop-target="track-header"]`).elementHandle()
    if (!audioHeader) throw new Error('[T4] could not find the new audio track header to drop onto')
    await page.evaluate(
      ({ header, mime }) => {
        const dt = new DataTransfer()
        dt.setData(mime, JSON.stringify({ type: 'kit-lane', kit: 'kit-audiophob', lane: 'kick' }))
        header.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
        header.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      },
      { header: audioHeader, mime: 'application/x-dotbeat-library-item' },
    )
    let audioClipId
    await pollUntil(async () => {
      const doc = await page.evaluate(() => window.__store.getState().doc)
      const t = doc.tracks.find((x) => x.id === audioTrackId)
      const c = t?.clips.find((cc) => cc.audio)
      if (c) audioClipId = c.id
      return !!c
    }, '[T4] the dropped sample to create a real audio-region clip')
    console.log(`[T4] audio clip created: "${audioClipId}"`)

    // Select the audio track so ClipPropertiesPanel/AudioClipInspector are on screen.
    await page.locator(`.arr-track-select:has(.arr-track-name:text-is("${audioTrackId}"))`).click()
    await pollUntil(async () => await page.locator(`[data-clip-loop-start="${audioClipId}"]`).isVisible().catch(() => false), '[T4] the loop-start field for the new audio clip')

    const beforeLoopEdit = readFileSync(beatPath, 'utf8')
    if (/\bloop \d/.test(beforeLoopEdit.split(`clip ${audioClipId}`)[1]?.split(/\n\s*\n|\ntrack |\nscene /)[0] ?? '')) {
      throw new Error('[T4] setup invalid — the fresh clip already has a loop line before any edit')
    }
    await page.locator(`[data-clip-loop-start="${audioClipId}"]`).fill('0')
    await page.locator(`[data-clip-loop-start="${audioClipId}"]`).dispatchEvent('change')
    await pollUntil(async () => await page.locator(`[data-clip-loop-end="${audioClipId}"]`).isEnabled().catch(() => false), '[T4] the loop-end field to enable once loop.start is set')
    await page.locator(`[data-clip-loop-end="${audioClipId}"]`).fill('1')
    await page.locator(`[data-clip-loop-end="${audioClipId}"]`).dispatchEvent('change')

    await pollUntil(async () => {
      const clip = (await page.evaluate((tid) => window.__store.getState().doc.tracks.find((t) => t.id === tid), audioTrackId)).clips.find((c) => c.id === audioClipId)
      return !!clip?.loop
    }, '[T4] the client-side doc to reflect the loop edit optimistically')

    await pollUntil(() => {
      const raw = readFileSync(beatPath, 'utf8')
      const clipBlock = raw.split(`clip ${audioClipId}`)[1]?.split(/\ntrack |\nscene |\nsong/)[0] ?? ''
      return /\n\s*loop 0 1\b/.test(clipBlock)
    }, '[T4] the loop range to actually persist as a real "loop 0 1" line in the .beat file', 8000)
    console.log('[T4] PASS: audio clip loop range persisted to the raw .beat file (was silently dropped before this fix)')
    results.t4 = { audioTrackId, audioClipId }

    // T5: the warp <select>'s "complex" option is annotated.
    const warpOptionsText = await page.$$eval(`select[data-audio-warp="${audioClipId}"] option`, (opts) => opts.map((o) => ({ value: o.value, text: o.textContent })))
    const complexOpt = warpOptionsText.find((o) => o.value === 'complex')
    const offOpt = warpOptionsText.find((o) => o.value === 'off')
    if (!complexOpt || !/not yet implemented/i.test(complexOpt.text)) throw new Error(`[T5] FAIL: "complex" option text is "${complexOpt?.text}", expected it to mention "not yet implemented"`)
    if (offOpt && /not yet implemented/i.test(offOpt.text)) throw new Error(`[T5] FAIL: "off" (a real, working mode) is also annotated as unimplemented: "${offOpt.text}"`)
    console.log(`[T5] PASS: warp option labels are ${JSON.stringify(warpOptionsText)}`)
    results.t5 = { warpOptionsText }

    // ============ T6: automation lane visibility when the arrangement pane is short ============
    await page.evaluate(() => window.__store.getState().setBottomPaneHeight(550))
    await sleep(200)
    await page.locator('.arr-auto-toggle[data-auto-toggle="lead"]').click()
    await sleep(150)
    await page.locator('.arr-auto-add').first().click()
    await sleep(400)
    const laneInfo = await page.evaluate(() => {
      const lanes = document.querySelectorAll('.arr-auto-lane[data-auto-track="lead"]')
      const lane = lanes[lanes.length - 1]
      if (!lane) return null
      const r = lane.getBoundingClientRect()
      const stack = document.elementsFromPoint(r.left + Math.min(30, r.width / 2), r.top + r.height / 2)
      const topEl = stack[0]
      return { found: true, topIsLaneOrDescendant: topEl === lane || lane.contains(topEl), topElTag: topEl?.tagName, topElCls: (topEl?.className || '').toString().slice(0, 60) }
    })
    if (!laneInfo?.found) throw new Error('[T6] FAIL: no automation lane found for "lead" after adding one')
    if (!laneInfo.topIsLaneOrDescendant) throw new Error(`[T6] FAIL: the newly-added lane is not the topmost element at its own position — painted behind something (top element: ${laneInfo.topElTag}.${laneInfo.topElCls})`)
    console.log('[T6] PASS: a newly-added automation lane, added while the arrangement pane is short, scrolls into view and is genuinely hit-testable (not painted behind the bottom pane)')
    results.t6 = laneInfo
    await page.evaluate(() => window.__store.getState().setBottomPaneHeight(null)) // restore default for later steps
    await sleep(150)

    // ============ T7: automation param picker doesn't reset to the top on every add ============
    // "lead" already has one lane open from T6 — reuse it (its own automation toggle stays open).
    const optionKeys = await page.$$eval('.arr-auto-select[data-auto-select="lead"] option', (opts) => opts.map((o) => o.value))
    if (optionKeys.length < 6) throw new Error(`[T7] setup invalid — only ${optionKeys.length} automatable params offered, need several to test "not at the top"`)
    const midIdx = Math.floor(optionKeys.length / 2)
    const midKey = optionKeys[midIdx]
    await page.locator('.arr-auto-select[data-auto-select="lead"]').selectOption(midKey)
    await page.locator('.arr-auto-add').first().click() // adds `midKey` as a second lane, removing it from `available`
    await sleep(250)
    const selectedAfterAdd = await page.$eval('.arr-auto-select[data-auto-select="lead"]', (el) => el.value)
    const optionsAfterAdd = await page.$$eval('.arr-auto-select[data-auto-select="lead"] option', (opts) => opts.map((o) => o.value))
    const idxAfterAdd = optionsAfterAdd.indexOf(selectedAfterAdd)
    // The fix's whole point: land at roughly the SAME INDEX POSITION the just-added param used to
    // occupy (~midIdx, give or take the one slot that just disappeared) — NOT reset to the top
    // (index 0) of the ~100-option list, which is what the old `available[0]` fallback always did.
    if (selectedAfterAdd === optionKeys[0]) throw new Error(`[T7] FAIL: picking "${midKey}" (index ${midIdx}) then adding it snapped the picker back to the very first option ("${optionKeys[0]}") instead of landing nearby`)
    if (Math.abs(idxAfterAdd - midIdx) > 2) {
      throw new Error(`[T7] FAIL: picked "${midKey}" at index ${midIdx}; after adding it, the picker landed on "${selectedAfterAdd}" at index ${idxAfterAdd} of the shrunk list — expected it to stay within ~2 of index ${midIdx}, not drift (and definitely not reset to 0)`)
    }
    console.log(`[T7] PASS: picked "${midKey}" at index ${midIdx}, added it, picker now shows "${selectedAfterAdd}" at index ${idxAfterAdd} of the shrunk list — stayed in the same neighborhood, not reset to the top`)
    results.t7 = { midKey, midIdx, selectedAfterAdd, idxAfterAdd }

    // ============ T8: console-hygiene guard (see header comment — not a targeted regression test) ============
    console.log(`[T8] ${consoleWarnings.length} "cannot update a component" warning(s) observed across this script's own interactions so far (informational only — item 8 not reproduced/fixed this session)`)
    results.t8 = { consoleWarnings: consoleWarnings.length }

    // ============ T9: Content Browser audio badge ============
    await page.locator('[data-action="toggle-library"]').click()
    await pollUntil(async () => await page.locator('[data-testid="content-browser"]').isVisible().catch(() => false), '[T9] content browser to open')
    await pollUntil(async () => (await page.locator('.lib-kit-lane').count()) > 0, '[T9] kit lane rows to render')
    const kitLaneHasBadge = await page.$eval('.lib-kit-lane', (el) => !!el.querySelector('.lib-audio-badge'))
    if (!kitLaneHasBadge) throw new Error('[T9] FAIL: a real kit-lane (audio) row has no .lib-audio-badge')
    const drumPresetRows = await page.$$('.lib-row:not(.lib-kit-lane):not(.lib-kit-head)')
    let presetWithBadge = 0
    for (const row of drumPresetRows) {
      if (await row.$('.lib-audio-badge')) presetWithBadge++
    }
    if (presetWithBadge > 0) throw new Error(`[T9] FAIL: ${presetWithBadge} preset row(s) (synthesized, not real audio) incorrectly carry .lib-audio-badge`)
    console.log(`[T9] PASS: kit-lane rows carry .lib-audio-badge; all ${drumPresetRows.length} preset rows (synth + drum, including genre-named sections) do not`)
    results.t9 = { presetRowCount: drumPresetRows.length }
    await page.locator('[data-action="close-library"]').click()

    // ============ T10: Sends defaults to expanded ============
    await page.locator('.arr-track-select:has(.arr-track-name:text-is("lead"))').click()
    await page.locator('[data-pane-tab="device"]').click()
    await pollUntil(async () => await page.locator('[data-param-group="sends"]').isVisible().catch(() => false), '[T10] the Sends accordion section to render')
    const sendsOpen = await page.$eval('[data-param-group="sends"]', (el) => el.open)
    if (!sendsOpen) throw new Error('[T10] FAIL: the Sends <details> section is not open by default')
    console.log('[T10] PASS: Sends is expanded by default, no click required')
    results.t10 = { sendsOpen }

    console.log('\n=== ALL CHECKS PASSED ===')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill()
    daemon.close?.()
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('\nFAIL:', err.message)
  process.exit(1)
})
