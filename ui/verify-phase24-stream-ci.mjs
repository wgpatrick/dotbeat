#!/usr/bin/env node
// Phase 24 Stream CI — "place a clip into the arrangement for the first time" (docs/phase-24-stream-ci.md).
// The owner's own framing: "I can't drag it into the arrangement." Phase 23 Stream BC already solved
// this for AUDIO clips (drag a sample from the content browser onto a track header); this stream
// generalizes it to synth/drum clips authored right in NoteView.tsx — a "Place in Arrangement" button
// that snapshots the track's live content into a clip (core's saveClip) and slots it into the first
// song section's scene (core's setScene), reusing an existing occurrence in place if the track
// already has one, exactly BC's own precedent. Drives the REAL frontend headlessly against a REAL
// `beat daemon`, reading the actual .beat file on disk — not mocks.
//
//   T1  LOOP MODE REFUSAL: clicking "Place in Arrangement" on a track with real content, while the
//       project has no `song` block at all, is refused with a clear alert and writes nothing —
//       matching BC's own "Add a song section first" precedent exactly.
//   T2  A freshly-added synth track (added AFTER a project already entered song mode, so it's in
//       ZERO scenes — the genuine "first placement" state) shows the button in its "unplaced" state.
//   T3  Authoring 3 real notes via real grid clicks in NoteView (not injected), then muting every
//       OTHER track (session-only, gates real audio) and rendering the song's first section BEFORE
//       placing: the new track contributes nothing anywhere yet, so the solo-muted render is silent.
//   T4  Click "Place in Arrangement": the .beat file gains a real clip (matching the authored notes)
//       AND the first song section's scene now slots this track to that clip id — resolved document
//       state, not just a DOM change.
//   T5  AUDIO: re-rendering the same solo-muted section AFTER placing now has real, audible energy —
//       proving the placed clip is genuinely part of what plays (engine.ts's contentOf resolution),
//       not just a file fact.
//   T6  Clicking the button AGAIN (now in "placed" state) re-saves the SAME clip id in place (BC's
//       "reuse an existing occurrence" precedent) rather than minting a second, orphaned clip.
//
// Usage: node ui/verify-phase24-stream-ci.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT_A = 8951 // loop-mode project (T1)
const PORT_B = 8952 // song-mode project (T2-T6)
const PREVIEW_PORT = 5961

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 12000, everyMs = 40) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}

function initProject(srcFixture, dirPrefix) {
  const proj = mkdtempSync(join(tmpdir(), dirPrefix))
  const beatPath = join(proj, 'song.beat')
  writeFileSync(beatPath, readFileSync(join(repoRoot, srcFixture), 'utf8'))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')
  return { proj, beatPath }
}

/** Records `seconds` of audio through the page's own live engine (same technique cli/render.mjs
 * uses, inlined here rather than shelled out to, because T3/T5 need custom mute state set on the
 * running page FIRST — cli/render.mjs always renders a fresh, unmuted load). Returns metrics via
 * the compiled metrics module (dB-true RMS, not just a DOM/file assertion). */
async function recordAndAnalyze(page, seconds) {
  const base64 = await page.evaluate(async (secs) => {
    await window.__engine.play()
    await new Promise((r) => setTimeout(r, 250)) // let the graph settle before capture
    const blob = await window.__engine.recordWav(secs)
    window.__engine.stop()
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }, seconds)
  const { decodeWav, analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const wavBytes = Buffer.from(base64, 'base64')
  const decoded = decodeWav(new Uint8Array(wavBytes.buffer, wavBytes.byteOffset, wavBytes.byteLength))
  return analyze(decoded.channels, decoded.sampleRate)
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))

  const loopProj = initProject('examples/night-shift.beat', 'dotbeat-p24ci-loop-')
  const songProj = initProject('examples/night-shift-song.beat', 'dotbeat-p24ci-song-')

  let daemonA = await startDaemon({ filePath: loopProj.beatPath, port: PORT_A })
  console.log(`daemon A (loop mode) up on :${daemonA.port}, project ${loopProj.beatPath}`)

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
  let daemonB
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1600, height: 980 })
    const alerts = []
    page.on('dialog', async (d) => {
      alerts.push(d.message())
      await d.dismiss()
    })
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))

    // ============ T1: loop-mode refusal ============
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemonA.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    if (await page.evaluate(() => !!window.__store.getState().doc.song)) throw new Error('[T1] expected the loop-mode fixture to have NO song block')

    await page.click('.arr-track-select:has(.arr-track-name:text-is("lead"))')
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    const placeBtnSel = (id) => `[data-place-clip="${id}"]`
    await page.waitForSelector(placeBtnSel('lead'), { timeout: 5000 })
    if ((await page.getAttribute(placeBtnSel('lead'), 'data-place-clip-state')) !== 'unplaced') {
      throw new Error('[T1] expected the button to read "unplaced" for a loop-mode track (no scene exists at all)')
    }

    const beforeT1 = readFileSync(loopProj.beatPath, 'utf8')
    await page.click(placeBtnSel('lead'))
    await pollUntil(async () => alerts.length > 0, 'a refusal alert for the loop-mode click')
    await sleep(150)
    const afterT1 = readFileSync(loopProj.beatPath, 'utf8')
    if (afterT1 !== beforeT1) throw new Error('[T1] the .beat file changed even though placement should have been refused in loop mode')
    if (!/song section/i.test(alerts[0])) throw new Error(`[T1] expected a "add a song section first" style refusal, got: "${alerts[0]}"`)
    console.log(`[T1] PASS: loop-mode click refused ("${alerts[0]}"), file untouched`)
    results.t1 = { alert: alerts[0] }
    await daemonA.close()
    daemonA = null

    // ============ T2-T6: song-mode project, a fresh track with zero occurrences ============
    daemonB = await startDaemon({ filePath: songProj.beatPath, port: PORT_B })
    console.log(`daemon B (song mode) up on :${daemonB.port}, project ${songProj.beatPath}`)
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemonB.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    const docNow = () => page.evaluate(() => window.__store.getState().doc)
    // postEdit mirrors an edit into the CLIENT's store optimistically/instantly, then sends the
    // real write to the daemon on a separate 60ms-debounced timer (bridge.ts) — so `docNow()` can
    // race ahead of what's actually landed server-side. Anything that's about to trigger a
    // DAEMON-side read (like clicking "Place in Arrangement", which snapshots the server's OWN
    // doc.tracks[].notes) must wait on the AUTHORITATIVE server document instead, or it can
    // snapshot stale content that hasn't been written yet.
    const daemonDocNow = async () => (await fetch(`http://localhost:${daemonB.port}/document`)).json()
    let doc = await docNow()
    if (!doc.song || doc.song.length === 0) throw new Error('[T2] expected the song-mode fixture to already have a song block')
    const firstSceneId = doc.song[0].scene
    console.log(`[setup] song mode confirmed, first section's scene = "${firstSceneId}"`)

    await page.click('[data-action="add-track"]')
    await page.click('[data-add-kind="synth"]')
    await pollUntil(async () => (await docNow()).tracks.some((t) => t.id === 'synth'), 'a fresh "synth" track to appear')
    const trackId = 'synth'
    // addTrackOfKind's own selection-edit write (debounced) must land before the next before/after
    // file diff, same discipline verify-phase23-stream-bc.mjs uses for its own fresh-track step.
    await pollUntil(() => readFileSync(songProj.beatPath, 'utf8').includes(`selected_track ${trackId}`), "the new track's own selection edit to land on disk")

    doc = await docNow()
    const newTrack = doc.tracks.find((t) => t.id === trackId)
    if (newTrack.clips.length !== 0) throw new Error(`[T2] expected zero clips on a freshly-added track, got ${newTrack.clips.length}`)
    const occursAnywhere = doc.scenes.some((sc) => sc.slots[trackId])
    if (occursAnywhere) throw new Error(`[T2] expected the fresh track to occur in ZERO scenes, but found one: ${JSON.stringify(doc.scenes)}`)
    console.log(`[T2] PASS: fresh track "${trackId}" added post-song-mode with 0 clips, 0 scene occurrences (genuine "first placement" state)`)
    results.t2 = { trackId }

    // Select it (reopens the bottom pane on it, Ableton's "selection drives the bottom pane" idiom).
    await page.click(`.arr-track-select:has(.arr-track-name:text-is("${trackId}"))`)
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    await page.waitForSelector(placeBtnSel(trackId), { timeout: 5000 })
    if ((await page.getAttribute(placeBtnSel(trackId), 'data-place-clip-state')) !== 'unplaced') {
      throw new Error(`[T2] expected the button to read "unplaced" for a track with no occurrence yet`)
    }

    // ============ T3: author 3 real notes via real grid clicks, then a solo-muted BEFORE render ============
    // The grid (rowCount * ROW_H, easily 500+px for a fresh track's padded pitch window) is taller
    // than the bottom pane's own visible viewport (`.bottom-pane-body`, the real vertically-
    // scrollable clipping container — `.noteview-scroll` only scrolls horizontally). Scroll that
    // viewport to its top first so row 0 (and a few rows below it) are GENUINELY on-screen, rather
    // than trusting scrollIntoView on the oversized grid element itself (which centers the element's
    // full bounding box, landing rows near the top well above the pane's actual clipped viewport).
    await page.$eval('.bottom-pane-body', (el) => {
      el.scrollTop = 0
      el.scrollLeft = 0
    })
    await sleep(150)
    const gridBox = await page.locator('.noteview-grid').boundingBox()
    const loopBars = doc.loopBars
    const stepW = gridBox.width / (loopBars * 16)
    const clickSteps = [4, 20, 40]
    for (const step of clickSteps) {
      const x = gridBox.x + step * stepW + stepW / 2
      const y = gridBox.y + 2 * 12 + 6 // ROW_H=12, row 2 — a couple of rows down from the grid's own top, well inside the visible pane after scrollTop=0
      await page.mouse.click(x, y)
      await sleep(80)
    }
    await pollUntil(async () => (await docNow()).tracks.find((t) => t.id === trackId).notes.length === clickSteps.length, `${clickSteps.length} authored notes to land (client)`)
    // Wait for the DAEMON's own copy too (see daemonDocNow's note above) — "Place in Arrangement"
    // reads the server's document, not the client's optimistic mirror.
    await pollUntil(async () => (await daemonDocNow()).tracks.find((t) => t.id === trackId).notes.length === clickSteps.length, `${clickSteps.length} authored notes to land (daemon)`)
    doc = await docNow()
    const authoredNotes = doc.tracks.find((t) => t.id === trackId).notes.map((n) => ({ pitch: n.pitch, start: n.start }))
    console.log(`[T3] authored ${authoredNotes.length} real notes via grid clicks: ${JSON.stringify(authoredNotes)}`)

    // Solo the new track for the render: mute every OTHER track (session-only, real audio gate —
    // Phase 14 Stream E's isEffectivelyMuted, exactly what engine.ts reads per-tick).
    const otherTrackIds = doc.tracks.map((t) => t.id).filter((id) => id !== trackId)
    for (const id of otherTrackIds) await page.click(`[data-mute="${id}"]`)
    await pollUntil(
      async () => page.evaluate((ids) => ids.every((tid) => !!window.__store.getState().mutes[tid]), otherTrackIds),
      'every other track to be muted',
    )

    // Section 0 ("intro" scene) length in seconds, from the fixture's own bpm/bars.
    const bpm = doc.bpm
    const section0Bars = doc.song[0].bars
    const section0Seconds = (section0Bars * 16 * 60) / bpm / 4
    const renderSeconds = Math.min(section0Seconds + 0.3, 10) // a small tail, capped so the script stays fast

    const beforeMetrics = await recordAndAnalyze(page, renderSeconds)
    console.log(`[T3] BEFORE placement, solo-muted render: rmsDbfs=${beforeMetrics.rmsDbfs.toFixed(1)} peak=${beforeMetrics.samplePeakDbfs.toFixed(1)}`)
    if (beforeMetrics.samplePeakDbfs > -50) {
      throw new Error(`[T3] expected near-silence before placement (the track has 0 occurrences anywhere), got peak ${beforeMetrics.samplePeakDbfs.toFixed(1)} dBFS`)
    }
    console.log('[T3] PASS: authored real notes via grid clicks; solo-muted BEFORE render is silent (track not yet part of what plays)')
    results.t3 = { authoredNotes, beforeMetrics: { rmsDbfs: beforeMetrics.rmsDbfs, peak: beforeMetrics.samplePeakDbfs } }

    // ============ T4: click "Place in Arrangement" -> resolved document state ============
    const beforeFile = readFileSync(songProj.beatPath, 'utf8')
    await page.click(placeBtnSel(trackId))
    await pollUntil(
      async () => {
        const d = await docNow()
        const scene = d.scenes.find((s) => s.id === firstSceneId)
        return !!scene?.slots?.[trackId]
      },
      'the first section\'s scene to slot the new track to a clip',
    )
    doc = await docNow()
    const scene0 = doc.scenes.find((s) => s.id === firstSceneId)
    const placedClipId = scene0.slots[trackId]
    const placedClip = doc.tracks.find((t) => t.id === trackId).clips.find((c) => c.id === placedClipId)
    if (!placedClip) throw new Error(`[T4] scene "${firstSceneId}" slots "${trackId}" to clip "${placedClipId}", but no such clip exists on the track`)
    const placedNotes = placedClip.notes.map((n) => ({ pitch: n.pitch, start: n.start }))
    const sortKey = (n) => `${n.pitch}:${n.start}`
    if (JSON.stringify(placedNotes.map(sortKey).sort()) !== JSON.stringify(authoredNotes.map(sortKey).sort())) {
      throw new Error(`[T4] placed clip's notes don't match what was authored: ${JSON.stringify(placedNotes)} vs ${JSON.stringify(authoredNotes)}`)
    }
    const afterFile = readFileSync(songProj.beatPath, 'utf8')
    if (afterFile === beforeFile) throw new Error('[T4] .beat file did not change after placing the clip')
    if (!afterFile.includes(`slot ${trackId} ${placedClipId}`)) throw new Error(`[T4] expected a literal "slot ${trackId} ${placedClipId}" line in scene "${firstSceneId}"`)
    if ((await page.getAttribute(placeBtnSel(trackId), 'data-place-clip-state')) !== 'placed') throw new Error('[T4] expected the button to flip to "placed" state')
    console.log(`[T4] PASS: clip "${placedClipId}" created with the authored notes, scene "${firstSceneId}" now slots "${trackId}" -> "${placedClipId}"`)
    results.t4 = { placedClipId, sceneId: firstSceneId }

    // ============ T5: AUDIO — the same solo-muted render now has real content ============
    const afterMetrics = await recordAndAnalyze(page, renderSeconds)
    console.log(`[T5] AFTER placement, solo-muted render: rmsDbfs=${afterMetrics.rmsDbfs.toFixed(1)} peak=${afterMetrics.samplePeakDbfs.toFixed(1)}`)
    if (afterMetrics.samplePeakDbfs <= -50) {
      throw new Error(`[T5] expected real audible energy after placement, got peak ${afterMetrics.samplePeakDbfs.toFixed(1)} dBFS (still silent)`)
    }
    if (afterMetrics.samplePeakDbfs < beforeMetrics.samplePeakDbfs + 10) {
      throw new Error(`[T5] expected a clear jump in peak level (before ${beforeMetrics.samplePeakDbfs.toFixed(1)} -> after ${afterMetrics.samplePeakDbfs.toFixed(1)} dBFS)`)
    }
    console.log(`[T5] PASS: solo-muted render peak jumped ${beforeMetrics.samplePeakDbfs.toFixed(1)} -> ${afterMetrics.samplePeakDbfs.toFixed(1)} dBFS — the placed clip is genuinely part of what plays`)
    results.t5 = { before: beforeMetrics.samplePeakDbfs, after: afterMetrics.samplePeakDbfs }

    // ============ T6: clicking again REUSES the same clip id (BC's "reuse an existing occurrence") ============
    // Add one more note first, so re-saving is a real, observable content change, not a no-op.
    {
      const x = gridBox.x + 56 * stepW + stepW / 2
      const y = gridBox.y + 8 * 12 + 6
      await page.mouse.click(x, y)
    }
    await pollUntil(async () => (await docNow()).tracks.find((t) => t.id === trackId).notes.length === clickSteps.length + 1, 'a 4th authored note to land (client)')
    await pollUntil(async () => (await daemonDocNow()).tracks.find((t) => t.id === trackId).notes.length === clickSteps.length + 1, 'a 4th authored note to land (daemon)')
    const clipCountBefore = (await docNow()).tracks.find((t) => t.id === trackId).clips.length
    await page.click(placeBtnSel(trackId))
    await pollUntil(async () => {
      const d = await docNow()
      const clip = d.tracks.find((t) => t.id === trackId).clips.find((c) => c.id === placedClipId)
      return clip && clip.notes.length === clickSteps.length + 1
    }, 're-placing to pick up the 4th note in the SAME clip')
    doc = await docNow()
    const clipCountAfter = doc.tracks.find((t) => t.id === trackId).clips.length
    if (clipCountAfter !== clipCountBefore) throw new Error(`[T6] expected re-placing to update the SAME clip (still ${clipCountBefore} clips), got ${clipCountAfter}`)
    const sceneStill = doc.scenes.find((s) => s.id === firstSceneId)
    if (sceneStill.slots[trackId] !== placedClipId) throw new Error(`[T6] expected the scene to still slot "${trackId}" -> "${placedClipId}", got "${sceneStill.slots[trackId]}"`)
    console.log(`[T6] PASS: re-clicking "Place in Arrangement" updated clip "${placedClipId}" in place (still ${clipCountAfter} clip on the track) — no duplicate/orphan minted`)
    results.t6 = { clipCount: clipCountAfter }

    if (pageErrors.length) console.log('\n(page errors, non-fatal):\n' + pageErrors.join('\n'))
    console.log('\n================ ALL CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    if (daemonA) await daemonA.close()
    if (daemonB) await daemonB.close()
  }
}

main().catch((err) => {
  console.error('\nVERIFY FAILED:', err)
  process.exit(1)
})
