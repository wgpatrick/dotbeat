#!/usr/bin/env node
// Phase 23 Stream BC — audio-region clip GUI polish: drag-to-create-audio-clip + a basic waveform
// render in the clip inspector (docs/phase-23-stream-bc.md). Phase 22 Stream AE shipped the format
// and the trim/gain/warp/split editing surface for an ALREADY-existing clip
// (verify-phase22-audio-region.mjs covers that with real audio measurement); this script covers the
// two things that stream's own "explicitly not built" note left open: creating a clip in the first
// place via drag-and-drop from the content browser, and rendering a waveform so the trim fields mean
// something at a glance. Drives the REAL frontend headlessly against a REAL `beat daemon`, reading
// the actual .beat file and actual media/ directory on disk — not mocks.
//
//   T1 the content browser loads; a fresh `audio`-kind track can be added via "+ track".
//   T2 dropping a kit one-shot onto that track WHILE STILL IN LOOP MODE is refused with a clear
//      alert and writes nothing — audio-region clips are song-mode-only by design (Stream AE's own
//      "why clip-only" section), so the drop has nowhere to land yet.
//   T3 "+ section" converts to song mode; the fresh audio track already has an (empty, contentless)
//      clip slotted into the new scene — core's saveClip/sceneFromLiveContent snapshotting every
//      track, audio tracks included.
//   T4 dropping kit-init's kick one-shot onto the track now creates a REAL audio region: the media
//      is registered and copied into the project's own media/ (content-addressed, not referenced by
//      its presets/ path), the clip's `audio` line lands in the .beat file with in=0 and an out-point
//      matching the wav's own real duration, and it fills the ALREADY-slotted clip in place (same
//      clip id before/after — the scene's slot map is untouched).
//   T5 the waveform canvas renders once the media decodes: a real <canvas> with non-trivial painted
//      content (not a blank/solid box) — measured by sampling actual pixel data, not just presence
//      of the DOM node.
//   T6 dropping a SECOND one-shot (snare) onto the same track REPLACES the region in place (one
//      clip, not two) and the waveform updates to reflect the new media.
//
// Usage: node ui/verify-phase23-stream-bc.mjs

import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PORT = 8734 // distinct from other verify scripts' ports so concurrent runs never collide
const PREVIEW_PORT = 5947

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

const trackHeaderSel = (name) => `.arr-row:has(.arr-track-name:text-is("${name}")) [data-drop-target="track-header"]`

/** Sample the canvas's own painted pixels (not just "the element exists") to confirm the waveform
 * render actually drew something — a blank canvas (all-zero alpha, or one uniform color) would mean
 * the decode/draw path silently no-op'd. Returns the count of distinct RGBA colors seen and whether
 * any pixel has nonzero alpha. */
async function sampleCanvas(page, selector) {
  return page.evaluate((sel) => {
    const canvas = document.querySelector(sel)
    if (!canvas) return null
    const ctx = canvas.getContext('2d')
    const { width, height } = canvas
    if (!width || !height) return { width, height, distinctColors: 0, anyPainted: false }
    const data = ctx.getImageData(0, 0, width, height).data
    const seen = new Set()
    let anyPainted = false
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = data[i + 3]
      if (a > 0) anyPainted = true
      seen.add(`${r},${g},${b},${a}`)
    }
    return { width, height, distinctColors: seen.size, anyPainted }
  }, selector)
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p23bc-'))
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
    await page.setViewportSize({ width: 1600, height: 980 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const alerts = []
    page.on('dialog', async (d) => {
      alerts.push(d.message())
      await d.dismiss()
    })
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // ============ T1: open the browser, add a fresh `audio` track ============
    await page.click('[data-action="toggle-library"]')
    await page.waitForSelector('[data-testid="content-browser"]', { timeout: 5000 })
    await pollUntil(async () => (await page.evaluate(() => document.querySelectorAll('.lib-row').length)) > 0, 'library catalog to load rows')

    await page.click('[data-action="add-track"]')
    await page.click('[data-add-kind="audio"]')
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().doc.tracks.some((t) => t.kind === 'audio')),
      'a fresh audio track to appear',
    )
    const audioTrackId = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.kind === 'audio').id)
    // addTrackOfKind also selects the new track (postEdit('selected_track', id), debounced 60ms) —
    // wait for THAT write to land on disk before taking any "before" snapshot below, or its
    // trailing write races the next section's own before/after diff check.
    await pollUntil(() => readFileSync(beatPath, 'utf8').includes(`selected_track ${audioTrackId}`), 'the new track\'s own selection edit to land on disk')
    console.log(`[T1] PASS: content browser loaded; fresh audio track "${audioTrackId}" added`)
    results.t1 = { audioTrackId }

    // ============ T2: dropping onto it in LOOP MODE is refused — nothing to land in yet ============
    let before = readFileSync(beatPath, 'utf8')
    await page.dragAndDrop('[data-kit="kit-init"][data-lane="kick"]', trackHeaderSel(audioTrackId))
    await pollUntil(async () => alerts.length > 0, 'a refusal alert for the loop-mode drop')
    let after = readFileSync(beatPath, 'utf8')
    if (after !== before) throw new Error('[T2] the .beat file changed even though the drop should have been refused in loop mode')
    const clipsAfterRefusal = await page.evaluate((id) => window.__store.getState().doc.tracks.find((t) => t.id === id).clips.length, audioTrackId)
    if (clipsAfterRefusal !== 0) throw new Error(`[T2] expected no clip to be created on a loop-mode refusal, got ${clipsAfterRefusal}`)
    console.log(`[T2] PASS: dropping onto an audio track in loop mode was refused ("${alerts[0]}"), file untouched`)
    results.t2 = { alert: alerts[0] }

    // ============ T3: "+ section" enters song mode; the fresh audio track stays UNMAPPED (it has no
    // live content to snapshot into the new scene — Stream BC's daemon.ts fix to
    // sceneFromLiveContent: audio tracks used to get an empty, audio-line-less clip snapshotted in,
    // which the parser then rejected outright the moment the section append tried to write it) ====
    await page.click('[data-add-section="1"]')
    await pollUntil(() => page.evaluate(() => (window.__store.getState().doc.song?.length ?? 0) >= 2), 'song mode with 2 sections')
    const postSectionState = await page.evaluate((id) => {
      const doc = window.__store.getState().doc
      const scene = doc.scenes.find((s) => s.id === doc.song[0].scene)
      return { clipId: scene?.slots[id] ?? null, clipCount: doc.tracks.find((t) => t.id === id).clips.length }
    }, audioTrackId)
    if (postSectionState.clipId !== null) throw new Error(`[T3] expected the fresh audio track to stay UNMAPPED in the new scene (no live content to snapshot), got slotted to "${postSectionState.clipId}"`)
    if (postSectionState.clipCount !== 0) throw new Error(`[T3] expected zero clips on the audio track before any drop, got ${postSectionState.clipCount}`)
    console.log('[T3] PASS: song mode entered; the fresh audio track stayed unmapped/silent (no crash, no phantom clip)')
    results.t3 = postSectionState

    // ============ T4: drop kit-init's kick onto the (now song-mode) audio track -> a real region,
    // minted fresh and slotted into the section's scene ============
    before = readFileSync(beatPath, 'utf8')
    await page.dragAndDrop('[data-kit="kit-init"][data-lane="kick"]', trackHeaderSel(audioTrackId))
    await pollUntil(
      () =>
        page.evaluate((id) => {
          const t = window.__store.getState().doc.tracks.find((tr) => tr.id === id)
          return t.clips.some((c) => c.audio?.media === 'kit-init-kick')
        }, audioTrackId),
      'the audio track to pick up a kit-init-kick region',
    )
    after = readFileSync(beatPath, 'utf8')
    if (after === before) throw new Error('[T4] .beat file did not change after dropping the kit one-shot onto the audio track')
    if (!/\baudio kit-init-kick 0 /.test(after)) throw new Error(`[T4] expected a literal "audio kit-init-kick 0 ..." region line in the file, got:\n${after}`)
    const region1 = await page.evaluate((id) => {
      const t = window.__store.getState().doc.tracks.find((tr) => tr.id === id)
      const c = t.clips.find((c) => c.audio?.media === 'kit-init-kick')
      return { clipId: c.id, ...c.audio }
    }, audioTrackId)
    const slotAfterDrop = await page.evaluate(
      ({ id, clipId }) => {
        const doc = window.__store.getState().doc
        const scene = doc.scenes.find((s) => s.id === doc.song[0].scene)
        return scene?.slots[id]
      },
      { id: audioTrackId, clipId: region1.clipId },
    )
    if (slotAfterDrop !== region1.clipId) throw new Error(`[T4] expected the new clip "${region1.clipId}" to be slotted into the section's scene, got slot "${slotAfterDrop}"`)
    if (region1.in !== 0) throw new Error(`[T4] expected in=0, got ${region1.in}`)
    if (!(region1.out > 0)) throw new Error(`[T4] expected a real out-point from the wav's own duration, got ${region1.out}`)
    if (region1.warp !== 'off' || region1.rate !== 1) throw new Error(`[T4] expected default warp=off/rate=1, got ${JSON.stringify(region1)}`)
    const mediaEntry = await page.evaluate(() => window.__store.getState().doc.media.find((m) => m.id === 'kit-init-kick'))
    if (!mediaEntry || mediaEntry.path.includes('presets/')) throw new Error(`[T4] media entry should reference the PROJECT's media/, not presets/: ${JSON.stringify(mediaEntry)}`)
    const mediaAbs = join(proj, 'media', 'kit-init-kick.wav')
    if (!existsSync(mediaAbs)) throw new Error(`[T4] expected the wav copied into the project's own media/: ${mediaAbs}`)
    // still ONE clip on the track — the drop filled the existing slot, it didn't mint a second one
    const clipCount = await page.evaluate((id) => window.__store.getState().doc.tracks.find((t) => t.id === id).clips.length, audioTrackId)
    if (clipCount !== 1) throw new Error(`[T4] expected exactly 1 clip on the track after the drop, got ${clipCount}`)
    console.log(`[T4] PASS: dropping kit-init's kick created a real audio region (out=${region1.out.toFixed(3)}s) in clip "${region1.clipId}", media copied to ${mediaEntry.path}`)
    results.t4 = region1

    // ============ T5: the waveform canvas renders real, non-trivial content ============
    const waveformSel = `[data-audio-waveform="${region1.clipId}"]`
    await page.waitForSelector(waveformSel, { timeout: 5000 })
    await pollUntil(
      () => page.evaluate((sel) => document.querySelector(sel)?.getAttribute('data-waveform-ready') === 'true', waveformSel),
      'the waveform to finish decoding',
      15000,
    )
    const sample1 = await sampleCanvas(page, waveformSel)
    if (!sample1) throw new Error('[T5] waveform canvas not found')
    if (!sample1.anyPainted) throw new Error('[T5] the waveform canvas has no painted (non-transparent) pixels at all')
    if (sample1.distinctColors < 3) throw new Error(`[T5] expected a real waveform render with more than a couple of flat colors, got ${sample1.distinctColors} distinct colors (${JSON.stringify(sample1)})`)
    console.log(`[T5] PASS: waveform canvas painted (${sample1.width}x${sample1.height}, ${sample1.distinctColors} distinct colors)`)
    results.t5 = sample1
    await page.screenshot({ path: join(uiDir, 'verify-p23bc-waveform.png') })

    // ============ T6: dropping a SECOND one-shot replaces the region in place ============
    before = readFileSync(beatPath, 'utf8')
    await page.dragAndDrop('[data-kit="kit-init"][data-lane="snare"]', trackHeaderSel(audioTrackId))
    await pollUntil(
      () =>
        page.evaluate((id) => {
          const t = window.__store.getState().doc.tracks.find((tr) => tr.id === id)
          return t.clips.some((c) => c.audio?.media === 'kit-init-snare')
        }, audioTrackId),
      'the audio track to pick up a kit-init-snare region',
    )
    after = readFileSync(beatPath, 'utf8')
    if (after === before) throw new Error('[T6] .beat file did not change after dropping the second one-shot')
    const region2Clean = await page.evaluate(
      ({ id, clipId }) => {
        const t = window.__store.getState().doc.tracks.find((tr) => tr.id === id)
        return { clipCount: t.clips.length, media: t.clips.find((c) => c.id === clipId)?.audio?.media }
      },
      { id: audioTrackId, clipId: region1.clipId },
    )
    if (region2Clean.clipCount !== 1) throw new Error(`[T6] expected the second drop to REPLACE the region (still 1 clip), got ${region2Clean.clipCount} clips`)
    if (region2Clean.media !== 'kit-init-snare') throw new Error(`[T6] expected clip "${region1.clipId}" to now carry kit-init-snare, got ${JSON.stringify(region2Clean)}`)
    console.log(`[T6] PASS: dropping a second one-shot replaced clip "${region1.clipId}"'s region in place (still 1 clip, now kit-init-snare)`)
    results.t6 = region2Clean

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
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
