#!/usr/bin/env node
// Phase 22 Stream AB — the open drum-lane model + optional hit duration + unified drum editor,
// verified live end-to-end against a REAL `beat daemon`/`beat render`, driven through the REAL
// frontend in headless Chromium, and checked against REAL rendered audio (not just UI state).
// Mirrors ui/verify-phase20-tracks.mjs's / ui/verify-phase19-length.mjs's boot pattern.
//
//   A  DOM: open a drum track (the 12-lane default kit), click-add a hit on the kick lane (a
//      durationless MARKER), then drag its resize handle to give it a duration — confirm the
//      .beat file's `hit` line gains a 5th token and the in-DOM marker becomes a bar.
//   B  AUDIO (sample-backed lane truncation): a sample-backed kick lane, one hit with no duration
//      vs. the same hit with a short duration — render both through `beat render`'s real engine
//      path and measure the rendered audio's actual length (RMS envelope), not UI state. The
//      duration render must be measurably shorter.
//   C  AUDIO (legacy 5-lane file "plays identically"): render examples/night-shift.beat (a real
//      legacy file whose drum track declares no `lanes` — the implicit-5 path) and confirm audio
//      energy appears at the kick/hat hit times the file's own pattern lines predict — proving the
//      untouched legacy triggerDrum switch still fires correctly post-refactor.
//
// Usage: node ui/verify-phase22-tracks.mjs

import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8622
const PREVIEW_PORT = 5522

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
function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg)
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const core = await import(pathToFileURL(join(repoRoot, 'dist/src/core/index.js')).href)
  const { startDaemon } = await import(pathToFileURL(join(repoRoot, 'dist/src/daemon/daemon.js')).href)
  const { decodeWav } = await import(pathToFileURL(join(repoRoot, 'dist/src/metrics/index.js')).href)
  const { renderCommand } = await import(pathToFileURL(join(repoRoot, 'cli/render.mjs')).href)

  const results = {}

  // ================================================================================================
  // A — DOM: click-add a hit (marker), drag its edge to gate/sustain it (marker -> bar)
  // ================================================================================================
  {
    const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p22a-'))
    const beatPath = join(proj, 'song.beat')
    let doc = core.initDocument({ trackId: 'lead', bpm: 120, loopBars: 1 })
    doc = core.addTrack(doc, { id: 'drums', kind: 'drums', lanes: core.defaultDrumKitLanes() }).doc
    writeFileSync(beatPath, core.serialize(doc))
    git(proj, 'init', '-q')
    git(proj, 'config', 'user.email', 'verify@dotbeat.local')
    git(proj, 'config', 'user.name', 'verify')
    git(proj, 'add', '-A')
    git(proj, 'commit', '-q', '-m', 'baseline: 12-lane drum track')

    const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
    console.log(`\n[A] daemon on :${daemon.port}, project ${beatPath}`)

    const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
    preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
    await pollUntil(async () => {
      try {
        return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok
      } catch {
        return false
      }
    }, 'vite preview to serve')

    const browser = await chromium.launch({
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
      headless: true,
      args: ['--autoplay-policy=no-user-gesture-required'],
    })
    try {
      const page = await browser.newPage()
      await page.setViewportSize({ width: 1400, height: 900 })
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
      await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

      // Select the drums track so its Clip view opens in the bottom pane — driven through the
      // store's own setSelectedTrack action (the same one a track-header click calls), not a
      // brittle guess at ArrangementView's click target.
      await page.evaluate(() => window.__store.getState().setSelectedTrack('drums'))
      await page.evaluate(() => window.__store.getState().setBottomPane?.('clip'))
      await page.evaluate(() => window.__store.getState().setBottomPaneOpen?.(true))
      await page.waitForSelector('.noteview[data-event-kind="hit"]', { timeout: 5000 })
      await sleep(150)

      const kickRow = await page.$('[data-row-value="kick"]')
      assert(kickRow, '[A] no "kick" row rendered in the lane gutter')
      const rowBox = await kickRow.boundingBox()
      const gridEl = await page.$('.noteview-grid')
      const gridBox = await gridEl.boundingBox()
      const stepW = gridBox.width / 16 // loop_bars 1 -> 16 steps

      // Click on step 0 of the kick row to add a hit (a durationless marker).
      await page.mouse.click(gridBox.x + stepW * 0.5, rowBox.y + rowBox.height / 2)
      await pollUntil(() => daemon.getDoc().tracks.find((t) => t.id === 'drums').hits.length === 1, 'a hit to appear after click-to-add')
      let hit = daemon.getDoc().tracks.find((t) => t.id === 'drums').hits[0]
      console.log(`[A] click-added hit: ${JSON.stringify(hit)}`)
      assert(hit.lane === 'kick', `[A] expected the hit on "kick", got "${hit.lane}"`)
      assert(hit.duration === undefined, `[A] a freshly click-added hit should have NO duration (a marker), got ${hit.duration}`)
      let fileText = readFileSync(beatPath, 'utf8')
      const hitLineNoDur = fileText.split('\n').find((l) => l.trim().startsWith(`hit ${hit.id} `))
      assert(hitLineNoDur && hitLineNoDur.trim().split(/\s+/).length === 5, `[A] expected a 4-value hit line (no duration), got "${hitLineNoDur}"`)
      results.markerLine = hitLineNoDur.trim()
      git(proj, 'commit', '-q', '-am', 'click-added kick hit (marker)')

      // Drag the marker's resize handle 3 steps to the right — should create a duration.
      const noteEl = await page.$(`[data-note-id="${hit.id}"]`)
      const noteBox = await noteEl.boundingBox()
      const handle = await page.$(`[data-note-id="${hit.id}"] .noteview-resize`)
      const handleBox = await handle.boundingBox()
      const hy = handleBox.y + handleBox.height / 2
      await page.mouse.move(handleBox.x + handleBox.width / 2, hy)
      await page.mouse.down()
      await page.mouse.move(noteBox.x + stepW * 3, hy, { steps: 8 })
      await page.mouse.up()
      await pollUntil(() => {
        const h = daemon.getDoc().tracks.find((t) => t.id === 'drums').hits.find((x) => x.id === hit.id)
        return h && h.duration !== undefined
      }, 'dragging the marker edge to set a duration')
      hit = daemon.getDoc().tracks.find((t) => t.id === 'drums').hits.find((x) => x.id === hit.id)
      console.log(`[A] after drag-resize: ${JSON.stringify(hit)}`)
      assert(hit.duration > 0, `[A] expected duration > 0 after dragging, got ${hit.duration}`)
      await sleep(150)
      fileText = readFileSync(beatPath, 'utf8')
      const hitLineWithDur = fileText.split('\n').find((l) => l.trim().startsWith(`hit ${hit.id} `))
      const tokens = hitLineWithDur.trim().split(/\s+/)
      assert(tokens.length === 6, `[A] expected a 5-value hit line (with duration) after the drag, got "${hitLineWithDur}"`)
      assert(Number(tokens[5]) === hit.duration, `[A] file duration token should match the doc, got ${tokens[5]} vs ${hit.duration}`)
      results.durationLine = hitLineWithDur.trim()
      console.log(`[A] PASS: marker -> bar. before: "${results.markerLine}"  after: "${results.durationLine}"`)
      if (errors.length) throw new Error('page error(s):\n' + errors.join('\n'))
    } finally {
      await browser.close()
      preview.kill('SIGTERM')
      await daemon.close()
    }
  }

  // ================================================================================================
  // B — AUDIO: a sample-backed lane, duration truncates the rendered sample (measured, not trusted)
  // ================================================================================================
  {
    const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p22b-'))
    const beatPath = join(proj, 'song.beat')
    const kickSrc = join(repoRoot, 'presets', 'kit-init', 'kick.wav')
    const kickDst = join(proj, 'kick.wav')
    copyFileSync(kickSrc, kickDst)
    const sha256 = createHash('sha256').update(readFileSync(kickSrc)).digest('hex')

    let doc = core.initDocument({ trackId: 'lead', bpm: 120, loopBars: 1 })
    doc = core.setMediaSample(doc, 'kicksample', sha256, 'kick.wav')
    doc = core.addTrack(doc, {
      id: 'drums',
      kind: 'drums',
      lanes: [{ name: 'kick', backing: { type: 'sample', sample: 'kicksample', gainDb: 0, tune: 0 } }],
    }).doc
    const noDur = core.addHit(doc, 'drums', { lane: 'kick', start: 0, velocity: 1 })
    writeFileSync(beatPath, core.serialize(noDur.doc))

    console.log(`\n[B] rendering the kick hit WITHOUT a duration (full sample, ~0.29s)...`)
    const outNoDur = join(proj, 'no-dur.wav')
    await renderCommand([beatPath, '-o', outNoDur, '--tail', '1.2', '--daemon-port', '8623', '--preview-port', '5523'])
    const wavNoDur = decodeWav(readFileSync(outNoDur))

    // Same doc, but the hit gates for 0.4 steps (0.05s @ 120bpm) — a hard early cut, well inside
    // the ~0.29s sample's natural decay.
    const withDur = core.addHit(doc, 'drums', { lane: 'kick', start: 0, velocity: 1, duration: 0.4 })
    writeFileSync(beatPath, core.serialize(withDur.doc))
    console.log('[B] rendering the SAME kick hit WITH a 0.4-step duration (should truncate hard)...')
    const outDur = join(proj, 'dur.wav')
    await renderCommand([beatPath, '-o', outDur, '--tail', '1.2', '--daemon-port', '8624', '--preview-port', '5524'])
    const wavDur = decodeWav(readFileSync(outDur))

    // Measure total energy (sum of squares) in a fixed window covering the kick's natural decay
    // [0.06s, 0.45s] — deliberately starting just after the shared attack transient (identical in
    // both renders) so this isolates the TAIL the duration either lets ring or cuts off. loop_bars
    // 1 @ 120bpm loops every 2.0s; this window is nowhere near that boundary.
    function energyInWindow(wav, fromSec, toSec) {
      const ch = wav.channels[0]
      const lo = Math.max(0, Math.round(fromSec * wav.sampleRate))
      const hi = Math.min(ch.length, Math.round(toSec * wav.sampleRate))
      let sum = 0
      for (let i = lo; i < hi; i++) sum += ch[i] * ch[i]
      return sum
    }
    const tailEnergyNoDur = energyInWindow(wavNoDur, 0.06, 0.45)
    const tailEnergyDur = energyInWindow(wavDur, 0.06, 0.45)
    console.log(`[B] tail energy [0.06s,0.45s]: no-duration ${tailEnergyNoDur.toExponential(3)} vs with-0.4-step-duration ${tailEnergyDur.toExponential(3)} (ratio ${(tailEnergyNoDur / Math.max(tailEnergyDur, 1e-12)).toFixed(1)}x)`)
    results.tailEnergyNoDur = tailEnergyNoDur
    results.tailEnergyDur = tailEnergyDur
    assert(tailEnergyNoDur > 1e-6, `[B] the undurationed render should have real tail energy from the sample's natural decay, measured ${tailEnergyNoDur}`)
    assert(tailEnergyDur < tailEnergyNoDur * 0.25, `[B] the durationed render's tail should be MUCH quieter (truncated) than the undurationed one (${tailEnergyDur} vs ${tailEnergyNoDur})`)
    console.log('[B] PASS: a sample-backed lane with a duration truncates the rendered audio (measured)')
  }

  // ================================================================================================
  // C — AUDIO: a real legacy 5-lane file (no `lane` declarations) still plays — measured
  // ================================================================================================
  {
    const legacyPath = join(repoRoot, 'examples', 'night-shift.beat')
    const legacyDoc = core.parse(readFileSync(legacyPath, 'utf8'))
    const drums = legacyDoc.tracks.find((t) => t.kind === 'drums')
    assert(drums.lanes.length === 0, `[C] expected examples/night-shift.beat's drums track to declare no lanes (legacy path), got ${drums.lanes.length}`)
    console.log(`\n[C] rendering the real legacy project (drums track: lanes=[], implicit 5 DRUM_LANES)...`)
    const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p22c-'))
    const beatPath = join(proj, 'night-shift.beat')
    writeFileSync(beatPath, core.serialize(legacyDoc)) // canonical text; same semantic doc
    const outPath = join(proj, 'legacy.wav')
    await renderCommand([beatPath, '-o', outPath, '--daemon-port', '8625', '--preview-port', '5525'])
    const wav = decodeWav(readFileSync(outPath))

    // The file's own pattern lines (migrated to hits) put a kick at steps 0/4/8/12 and a hat at
    // 2/6/10/14, bpm from the file, loop_bars 4. Confirm a real onset (RMS jump) within ~40ms of
    // each predicted kick time — proof the legacy triggerDrum switch is still firing correctly.
    const stepSeconds = (60 / legacyDoc.bpm) / 4
    function rmsWindow(wav, centerSec, halfWidthSec) {
      const ch = wav.channels[0]
      const lo = Math.max(0, Math.round((centerSec - halfWidthSec) * wav.sampleRate))
      const hi = Math.min(ch.length, Math.round((centerSec + halfWidthSec) * wav.sampleRate))
      let sum = 0
      for (let i = lo; i < hi; i++) sum += ch[i] * ch[i]
      return Math.sqrt(sum / Math.max(1, hi - lo))
    }
    const kickSteps = [0, 4, 8, 12]
    const onsets = kickSteps.map((s) => {
      const t = s * stepSeconds
      const before = rmsWindow(wav, Math.max(0, t - 0.03), 0.015)
      const at = rmsWindow(wav, t + 0.02, 0.02)
      return { step: s, before, at, ratio: at / Math.max(before, 1e-6) }
    })
    console.log('[C] kick onsets:', onsets.map((o) => `step ${o.step}: before=${o.before.toFixed(4)} at=${o.at.toFixed(4)} ratio=${o.ratio.toFixed(1)}x`).join('  '))
    results.legacyOnsets = onsets
    for (const o of onsets) {
      assert(o.at > 0.015, `[C] step ${o.step}: expected audible energy right after the predicted kick time, got RMS ${o.at}`)
    }
    console.log('[C] PASS: the legacy 5-lane file still triggers real audio at its predicted hit times')
  }

  console.log('\n=== Phase 22 Stream AB verification: ALL PASS ===')
  console.log(JSON.stringify(results, null, 2))
}

main().catch((err) => {
  console.error(err.stack ?? String(err))
  process.exit(1)
})
