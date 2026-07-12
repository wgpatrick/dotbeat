#!/usr/bin/env node
// Phase 24 Stream CG end-to-end verification — driven live against a real `beat daemon` in headless
// Chrome, on a real multi-section song project (examples/night-shift-song.beat, 6 sections: intro(4)
// build(4) drop(13) intro(4) intro(4) intro(4) = 33 bars, bpm 124, loop_bars 4). Mirrors ui/verify-
// phase20-automation.mjs's `.play-btn` + `window.__store`/`window.__engine` polling pattern for live
// playback checks.
//
// The bug (docs/phase-24-plan.md Stream CG): NoteView.tsx's clip-view playhead rendered directly
// against the ABSOLUTE song-timeline `currentStep`, gated on `currentStep < loopBars*16` — so in song
// mode the line only ever showed for the first few bars of the WHOLE song, never tracking the clip
// actually open in the editor. The fix mirrors engine.ts's own `contentOf` resolution: find which
// section is playing right now, check whether its scene maps this track to the SAME clip NoteView is
// displaying (the "primary clip" — the first song-section's scene mapping this track to a real clip,
// same rule ClipPropertiesPanel.tsx already established), and if so convert the absolute step to a
// clip-relative, tiled position with the exact modulo math `contentOf` uses.
//
// This song's scenes: "intro" maps only pad -> groove; "build" maps drums/bass/pad -> groove (NOT
// lead); "drop" maps all four tracks (lead -> hook, drums/bass/pad -> groove). So:
//   [A] While playing the "build" section (bars 4-7, steps 64-127): the LEAD track's primary clip is
//       "hook" (found via "drop", the first section that maps lead), but "build"'s scene doesn't map
//       lead at all -> lead is silent this section -> NO playhead should render for lead, even though
//       playback IS running and lead's NoteView IS open.
//   [B] Switching to the DRUMS track while playing the "drop" section (bars 8-20, steps 128-335, 13
//       bars = 3.25 loops of the 4-bar "groove" clip): drums IS mapped to "groove" in "drop", the
//       same clip that's drums' primary clip -> a playhead SHOULD render, at the clip-relative,
//       TILED position — cross-checked against the exact contentOf formula computed independently in
//       this script from the known song structure, and shown to WRAP (drop back toward 0) partway
//       through the section rather than running off past 64.
//
// bpm is bumped way up live (via the GUI's own BPM field, the same path a user would use) purely to
// make the real-time wait for "reach bar 8, then wrap once" practical in a test — the fix itself is
// tempo-independent.
//
// Usage: node ui/verify-phase24-stream-cg.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8481
const PREVIEW_PORT = 5348

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 8000, everyMs = 20) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}
const selectTrack = (page, name) => page.click(`.arr-row:has(.arr-track-name:text-is("${name}")) .arr-track-select`)

/** Read the live store's currentStep AND (if present) the rendered noteview-playhead's step,
 * atomically in one page.evaluate call so the two numbers describe the same instant. */
async function samplePlayhead(page) {
  return page.evaluate(() => {
    const currentStep = window.__store.getState().currentStep
    const el = document.querySelector('.noteview-playhead')
    if (!el) return { currentStep, playheadStep: null }
    const left = parseFloat(getComputedStyle(el).left)
    return { currentStep, playheadStep: Math.round(left / 14) }
  })
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p24cg-verify-'))
  const beatPath = join(proj, 'night-shift-song.beat')
  const canonical = serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift-song.beat'), 'utf8')))
  writeFileSync(beatPath, canonical)
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'canonical night-shift-song baseline')

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  const doc0 = daemon.getDoc()
  console.log(`daemon on :${daemon.port} — bpm ${doc0.bpm}, loop_bars ${doc0.loopBars}, ${doc0.song.length} sections: ${doc0.song.map((s) => `${s.scene}(${s.bars})`).join(' ')}`)
  assert(doc0.song.length === 6, `expected the 6-section night-shift-song fixture, got ${doc0.song.length} sections`)

  // Ground truth, computed from the fixture's own known structure (same numbers a human would read
  // off the file) — NOT imported from engine.ts, so this is an independent check of the SAME formula,
  // not a tautology.
  const sectionStartBar = { intro1: 0, build: 4, drop: 8, intro2: 21, intro3: 25 }
  const dropStartStep = sectionStartBar.drop * 16 // 128
  const buildStartStep = sectionStartBar.build * 16 // 64
  const loopSteps = doc0.loopBars * 16 // 64
  const expectedContentStep = (absStep) => ((absStep - dropStartStep) % loopSteps + loopSteps) % loopSteps

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
    await page.setViewportSize({ width: 1280, height: 800 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
    await page.waitForSelector('.arr-canvas', { timeout: 5000 })
    await sleep(300) // let ResizeObserver settle the lane/ruler widths

    // Bump bpm way up via the GUI's own BPM field — same path a user would use, just fast — so the
    // real-time wait to reach bar 8 and then wrap once inside "drop" is a few seconds, not tens.
    const FAST_BPM = 960
    await page.fill('.transport input[type="number"]', String(FAST_BPM))
    await page.dispatchEvent('.transport input[type="number"]', 'change')
    await pollUntil(() => daemon.getDoc().bpm === FAST_BPM, 'bpm to commit to disk')
    console.log(`\nbumped bpm ${doc0.bpm} -> ${FAST_BPM} (${(FAST_BPM / doc0.bpm).toFixed(1)}x realtime, tempo-independent fix)`)

    // ==================== A: a track NOT in the current section's scene shows no playhead ====================
    await selectTrack(page, 'lead')
    await page.waitForSelector('[data-testid="bottom-pane"]', { timeout: 5000 })
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    // lead's "primary clip" (ClipPropertiesPanel's rule: first song-section scene mapping this
    // track) is "hook", found via "drop" — but we haven't started playback yet, so currentStep is -1
    // and no playhead should render regardless.
    let s = await samplePlayhead(page)
    assert(s.playheadStep === null, `[pre] expected no playhead before playback starts, got step ${s.playheadStep}`)
    console.log('[pre] PASS: no playhead while stopped (currentStep -1)')

    await page.click('.play-btn')
    await pollUntil(async () => (await page.evaluate(() => window.__store.getState().playing)), 'playback to start')
    console.log('\n[A] playback started, lead track open (NoteView), waiting to enter the "build" section (bars 4-7)...')

    // Sample repeatedly while currentStep is inside "build" (steps 64-127) — build's scene maps
    // drums/bass/pad but NOT lead, so lead is silent this section and must show NO playhead the
    // entire time, even though lead's own primary clip ("hook") exists and playback is running.
    const buildSamples = []
    await pollUntil(async () => {
      const cur = await page.evaluate(() => window.__store.getState().currentStep)
      return cur >= buildStartStep + 8 // safely inside "build", clear of the intro->build boundary
    }, 'currentStep to enter the "build" section', 6000, 10)
    for (let i = 0; i < 15; i++) {
      const cur = await page.evaluate(() => window.__store.getState().currentStep)
      if (cur >= buildStartStep + 60) break // stop sampling before "build" ends (don't run into "drop")
      buildSamples.push(await samplePlayhead(page))
      await sleep(15)
    }
    assert(buildSamples.length > 0, '[A] never got a sample inside the "build" section — timing too tight')
    const stray = buildSamples.filter((x) => x.playheadStep !== null)
    console.log(`[A] sampled ${buildSamples.length}x while lead's NoteView was open during "build" (steps ${buildSamples[0].currentStep}..${buildSamples[buildSamples.length - 1].currentStep}); playhead rendered ${stray.length}x`)
    assert(stray.length === 0, `[A] FAIL: lead showed a playhead during "build" (not in build's scene) at steps ${stray.map((x) => x.currentStep).join(',')}`)
    results.notPlayingCase = { track: 'lead', section: 'build', samples: buildSamples.length, strayPlayheads: stray.length }
    console.log('[A] PASS: lead (open in NoteView, but silent this section) shows no playhead — no line is better than a nonsensical one')

    // ==================== B: the track that IS playing shows a correctly wrapping, clip-relative playhead ====================
    // Switch to drums (mapped to "groove" in "drop", drums' own primary clip too) while still
    // playing, and wait to enter "drop" (steps 128-335) — 13 bars = 3.25 loops of the 4-bar clip.
    await pollUntil(async () => (await page.evaluate(() => window.__store.getState().currentStep)) >= dropStartStep + 4, 'currentStep to enter "drop"', 6000, 10)
    await selectTrack(page, 'drums')
    await page.waitForSelector('.noteview-grid', { timeout: 5000 })
    console.log('\n[B] switched to drums mid-playback, now inside "drop" (drums IS mapped to "groove" here)')

    s = await samplePlayhead(page)
    assert(s.playheadStep !== null, `[B] expected a playhead for drums inside "drop", got none (currentStep=${s.currentStep})`)
    assert(s.playheadStep === expectedContentStep(s.currentStep), `[B] playhead step ${s.playheadStep} != expected ${expectedContentStep(s.currentStep)} (currentStep ${s.currentStep})`)
    console.log(`[B] first drums sample: currentStep ${s.currentStep} -> playhead step ${s.playheadStep} (expected ${expectedContentStep(s.currentStep)}) — MATCH`)

    // Cross-check the exact contentOf formula across many samples spanning the section, and prove a
    // real WRAP happens (the rendered step must go DOWN at some point even though currentStep only
    // ever goes up — that's the "tiles" behavior the old absolute-step bug could never produce).
    const dropSamples = []
    const tDeadline = Date.now() + 5000
    while (Date.now() < tDeadline) {
      const x = await samplePlayhead(page)
      if (x.currentStep >= dropStartStep + 208) break // "drop" ended, stop sampling
      if (x.currentStep >= dropStartStep) dropSamples.push(x)
      if (dropSamples.length >= 3 && dropSamples.some((y) => y.playheadStep !== null && y.playheadStep < 20) && dropSamples.some((y) => y.playheadStep !== null && y.playheadStep >= 55)) {
        // Already have samples both near a wrap boundary and just after one — enough to prove it;
        // keep going a little more for a denser cross-check set, then stop.
        if (dropSamples.length >= 40) break
      }
      await sleep(15)
    }
    assert(dropSamples.length >= 10, `[B] too few "drop"-section samples to check (${dropSamples.length}) — timing too tight`)
    const rendered = dropSamples.filter((x) => x.playheadStep !== null)
    assert(rendered.length === dropSamples.length, `[B] drums should show a playhead for every sample inside "drop" (drums is in drop's scene the whole section), missing ${dropSamples.length - rendered.length}`)
    const mismatches = rendered.filter((x) => x.playheadStep !== expectedContentStep(x.currentStep))
    console.log(`[B] cross-checked ${rendered.length} samples against contentOf's own formula (rel = step - ${dropStartStep}, tiled every ${loopSteps} steps): ${mismatches.length} mismatches`)
    assert(mismatches.length === 0, `[B] FAIL: ${mismatches.length}/${rendered.length} samples didn't match the expected clip-relative tiled step, e.g. ${JSON.stringify(mismatches[0])} expected ${expectedContentStep(mismatches[0]?.currentStep)}`)

    // Direct wrap proof: find two consecutive-in-time samples where playheadStep goes DOWN even
    // though currentStep went up — the unambiguous signature of tiling/wraparound.
    let wrapFound = null
    for (let i = 1; i < rendered.length; i++) {
      if (rendered[i].currentStep > rendered[i - 1].currentStep && rendered[i].playheadStep < rendered[i - 1].playheadStep) {
        wrapFound = { before: rendered[i - 1], after: rendered[i] }
        break
      }
    }
    assert(wrapFound, `[B] FAIL: never observed the playhead wrap back down across ${rendered.length} samples spanning currentStep ${rendered[0].currentStep}..${rendered[rendered.length - 1].currentStep} — the clip-relative tiling isn't visibly happening`)
    console.log(`[B] WRAP observed: currentStep ${wrapFound.before.currentStep}->${wrapFound.after.currentStep} (absolute, still climbing) but playhead step ${wrapFound.before.playheadStep}->${wrapFound.after.playheadStep} (dropped — the clip retriggered from its own start)`)
    results.playingCase = {
      track: 'drums',
      section: 'drop',
      samples: dropSamples.length,
      mismatches: mismatches.length,
      wrap: { beforeStep: wrapFound.before.currentStep, afterStep: wrapFound.after.currentStep, beforePlayhead: wrapFound.before.playheadStep, afterPlayhead: wrapFound.after.playheadStep },
    }
    console.log('[B] PASS: drums (playing "groove" in "drop") shows a playhead at the correct clip-relative, tiled position, and it visibly wraps as the 4-bar clip retriggers inside the 13-bar section')

    await page.click('.play-btn') // stop
    await page.screenshot({ path: join(uiDir, 'verify-p24cg-playhead.png') })

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
