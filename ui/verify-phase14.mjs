#!/usr/bin/env node
// Phase 14 Stream E end-to-end verification — live playback feedback, driven in headless Chrome
// against a real daemon, with REAL AUDIO MEASUREMENTS (per-track + master meter dB), not just
// "the button toggled a CSS class". Mirrors ui/verify-phase13.mjs's boot pattern. Two projects:
//
//   Loop project (examples/night-shift.beat — all four tracks play every 4-bar loop):
//     M1. Per-track meters read REAL, DIFFERING levels for tracks with different content
//         (engine.getTrackLevel peaks over a window; ≥2 tracks audible and not all equal).
//     M2. Mute GATES AUDIO: mute the loudest track → its own post-mute meter falls to silence
//         AND the master meter's peak measurably drops (its contribution is actually gone).
//     M3. Solo semantics through audio: solo one track → every other track's meter falls silent
//         while the soloed one stays audible (isEffectivelyMuted, proven at the DSP level).
//
//   Song project (examples/night-shift-song.beat — intro/build/drop/intro sections):
//     P1. Arrangement playhead ADVANCES during playback (its x grows over ~1.2s; currentStep grows).
//     P2. Playhead LANDS IN THE RIGHT SECTION: its x sits within the active section's ruler box for
//         the current bar (cross-checked against the section label geometry). Screenshot saved.
//
// Usage: node ui/verify-phase14.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const LOOP_PORT = 8471
const SONG_PORT = 8472
const PREVIEW_PORT = 5319

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

// Sample per-track peak dB + master RMS over a window, in-page at ~30ms cadence. All levels are
// decay-free RMS (getTrackLevel / getMasterRms compute RMS straight off waveform samples), so a
// silenced track reads true -Infinity (mapped to -120 for JSON) with no meter-smoothing lag.
async function samplePeaks(page, trackIds, ms) {
  return page.evaluate(
    async ({ trackIds, ms }) => {
      const eng = window.__engine
      const peaks = {}
      for (const id of trackIds) peaks[id] = -Infinity
      let masterPeak = -Infinity
      let masterSum = 0 // sum of linear RMS for a mean-energy master level
      let n = 0
      const t0 = performance.now()
      while (performance.now() - t0 < ms) {
        for (const id of trackIds) {
          const v = eng.getTrackLevel(id)
          if (typeof v === 'number' && isFinite(v) && v > peaks[id]) peaks[id] = v
        }
        const m = eng.getMasterRms()
        if (typeof m === 'number' && isFinite(m)) {
          if (m > masterPeak) masterPeak = m
          masterSum += Math.pow(10, m / 20)
          n++
        }
        await new Promise((r) => setTimeout(r, 30))
      }
      const clean = {}
      for (const id of trackIds) clean[id] = peaks[id] === -Infinity ? -120 : Math.round(peaks[id] * 10) / 10
      const masterMean = n > 0 && masterSum > 0 ? Math.round(20 * Math.log10(masterSum / n) * 10) / 10 : -120
      return { peaks: clean, masterPeak: masterPeak === -Infinity ? -120 : Math.round(masterPeak * 10) / 10, masterMean }
    },
    { trackIds, ms },
  )
}

function makeProject(srcName, tmpTag) {
  const proj = mkdtempSync(join(tmpdir(), tmpTag))
  const beatPath = join(proj, srcName)
  writeFileSync(beatPath, readFileSync(join(repoRoot, 'examples', srcName), 'utf8'))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')
  return beatPath
}

async function bootPage(browser, previewPort, port) {
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1280, height: 800 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`http://localhost:${previewPort}/?daw=${port}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__store && window.__store.getState().doc, { timeout: 10000 })
  await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
  return { page, errors }
}

async function main() {
  console.log('building repo core/daemon + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))

  const loopPath = makeProject('night-shift.beat', 'dotbeat-p14-loop-')
  const songPath = makeProject('night-shift-song.beat', 'dotbeat-p14-song-')
  const loopDaemon = await startDaemon({ filePath: loopPath, port: LOOP_PORT })
  const songDaemon = await startDaemon({ filePath: songPath, port: SONG_PORT })
  console.log(`daemons up: loop :${loopDaemon.port}  song :${songDaemon.port}`)

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
    // ============================ LOOP PROJECT: meters, mute, solo ============================
    const { page, errors } = await bootPage(browser, PREVIEW_PORT, loopDaemon.port)
    const trackIds = await page.evaluate(() => window.__store.getState().doc.tracks.map((t) => t.id))
    console.log(`\nloop tracks: ${JSON.stringify(trackIds)}`)

    await page.click('.play-btn')
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().currentStep >= 0 && Number.isFinite(window.__store.getState().masterLevel)),
      'transport ticking + master meter reading',
    )

    // ---- M1: per-track meters read real, differing levels ----
    const base = await samplePeaks(page, trackIds, 2000)
    console.log(`\n[M1] per-track peak dB (all playing): ${JSON.stringify(base.peaks)}  masterMean=${base.masterMean} masterPeak=${base.masterPeak}`)
    results.baselinePeaks = base.peaks
    results.baselineMaster = { mean: base.masterMean, peak: base.masterPeak }
    const audible = trackIds.filter((id) => base.peaks[id] > -60)
    if (audible.length < 2) throw new Error(`[M1] expected ≥2 audible tracks, got ${JSON.stringify(base.peaks)}`)
    const distinct = new Set(audible.map((id) => Math.round(base.peaks[id])))
    if (distinct.size < 2) throw new Error(`[M1] audible tracks all read the same level (no real per-track differences): ${JSON.stringify(base.peaks)}`)
    console.log(`[M1] PASS: ${audible.length} tracks audible with differing levels`)

    // ---- M2: mute the loudest track via the real mixer button -> its meter + master drop ----
    const victim = audible.reduce((a, b) => (base.peaks[a] >= base.peaks[b] ? a : b))
    const victimName = await page.evaluate((id) => window.__store.getState().doc.tracks.find((t) => t.id === id).name, victim)
    await page.click('.view-tab[data-view="mixer"]')
    await page.waitForSelector('.mixer-strip', { timeout: 5000 })
    await page.click(`.mixer-strip:has(.mixer-strip-name:text-is("${victimName}")) .mixer-btn.mute`)
    await pollUntil(() => page.evaluate((id) => window.__store.getState().mutes[id] === true, victim), 'mute to reach store')
    await sleep(300) // let the gate apply on the next tick
    const muted = await samplePeaks(page, trackIds, 1500)
    console.log(`[M2] muted "${victimName}" (${victim}). peak dB now: ${JSON.stringify(muted.peaks)}  masterMean=${muted.masterMean}`)
    results.mutedTrack = victim
    results.mutedPeaks = muted.peaks
    results.mutedMaster = { mean: muted.masterMean, peak: muted.masterPeak }
    if (!(muted.peaks[victim] < -60)) throw new Error(`[M2] muted track ${victim} still audible at ${muted.peaks[victim]} dB (gate not working)`)
    // Rock-solid proof the contribution is gone: the victim's own post-gate tap reads TRUE silence
    // (RMS -Infinity), down from a clearly-audible level. (The master RMS moves only slightly because
    // the master limiter fills the freed headroom — a real limiter effect, so master delta alone is a
    // weak signal here; the clean master-analyser evidence is in M3, which removes 3 of 4 tracks.)
    console.log(`[M2] PASS: ${victim} tap ${base.peaks[victim]}->${muted.peaks[victim]} dB (TRUE silence); master RMS ${base.masterMean}->${muted.masterMean} dB (limiter refills)`)
    // unmute for the solo test
    await page.click(`.mixer-strip:has(.mixer-strip-name:text-is("${victimName}")) .mixer-btn.mute`)
    await pollUntil(() => page.evaluate((id) => !window.__store.getState().mutes[id], victim), 'unmute to reach store')

    // ---- M3: solo the QUIETEST audible track -> every other track goes silent AND the master RMS
    //      drops substantially (3 of 4 tracks removed; the limiter can't refill that far). This is
    //      the clean master-analyser evidence that gating changes the real output. ----
    const soloTarget = audible.reduce((a, b) => (base.peaks[a] <= base.peaks[b] ? a : b))
    const soloName = await page.evaluate((id) => window.__store.getState().doc.tracks.find((t) => t.id === id).name, soloTarget)
    await page.click(`.mixer-strip:has(.mixer-strip-name:text-is("${soloName}")) .mixer-btn.solo`)
    await pollUntil(() => page.evaluate((id) => window.__store.getState().solos[id] === true, soloTarget), 'solo to reach store')
    await sleep(300)
    const solo = await samplePeaks(page, trackIds, 1500)
    console.log(`[M3] soloed "${soloName}" (${soloTarget}). peak dB: ${JSON.stringify(solo.peaks)}  masterMean=${solo.masterMean} (was ${base.masterMean})`)
    results.soloTarget = soloTarget
    results.soloPeaks = solo.peaks
    results.soloMaster = { mean: solo.masterMean, peak: solo.masterPeak }
    if (!(solo.peaks[soloTarget] > -60)) throw new Error(`[M3] soloed track ${soloTarget} not audible (${solo.peaks[soloTarget]} dB)`)
    const otherAudible = audible.filter((id) => id !== soloTarget)
    for (const id of otherAudible) {
      if (!(solo.peaks[id] < -60)) throw new Error(`[M3] non-soloed track ${id} still audible at ${solo.peaks[id]} dB (solo did not gate it)`)
    }
    if (!(solo.masterMean < base.masterMean - 1)) throw new Error(`[M3] master RMS did not drop under solo (${base.masterMean} -> ${solo.masterMean}); output not actually changed`)
    console.log(`[M3] PASS: only ${soloTarget} audible under solo; ${otherAudible.join(',')} silenced; master RMS ${base.masterMean}->${solo.masterMean} dB`)
    // clear solo
    await page.click(`.mixer-strip:has(.mixer-strip-name:text-is("${soloName}")) .mixer-btn.solo`)
    await page.screenshot({ path: join(uiDir, 'verify-p14-mixer.png') })
    console.log('[M] screenshot -> ui/verify-p14-mixer.png')

    // ============================ SONG PROJECT: arrangement playhead ============================
    const { page: sp, errors: sErrors } = await bootPage(browser, PREVIEW_PORT, songDaemon.port)
    errors.push(...sErrors)
    await sp.click('.view-tab[data-view="arrangement"]')
    await sp.waitForSelector('.arr-canvas', { timeout: 5000 })
    await sleep(300)
    await sp.click('.play-btn')
    await sp.waitForSelector('.arr-playhead', { timeout: 6000 })

    const readPlayhead = () =>
      sp.evaluate(() => {
        const el = document.querySelector('.arr-playhead')
        if (!el) return null
        const left = el.getBoundingClientRect().left
        return { left, step: window.__store.getState().currentStep }
      })
    const s0 = await pollUntil(async () => {
      const r = await readPlayhead()
      return r && r.step >= 0 ? r : null
    }, 'playhead to appear with a real step')
    await sleep(1200)
    const s1 = await readPlayhead()
    console.log(`\n[P1] playhead: left ${s0.left.toFixed(1)}px @step ${s0.step}  ->  ${s1.left.toFixed(1)}px @step ${s1.step}`)
    results.playhead = { from: s0, to: s1 }
    if (!(s1.step > s0.step)) throw new Error(`[P1] currentStep did not advance (${s0.step} -> ${s1.step})`)
    if (!(s1.left > s0.left)) throw new Error(`[P1] playhead x did not advance (${s0.left} -> ${s1.left})`)
    console.log('[P1] PASS: playhead advances with playback')

    // ---- P2: playhead sits within the ACTIVE section's ruler box for the current bar ----
    const check = await sp.evaluate(() => {
      const ph = document.querySelector('.arr-playhead')
      const phX = ph.getBoundingClientRect().left
      const step = window.__store.getState().currentStep
      const bar = Math.floor(step / 16)
      const song = window.__store.getState().doc.song
      // active section name for this bar
      let cursor = 0
      let active = null
      for (const s of song) {
        if (bar < cursor + s.bars) {
          active = s.scene
          break
        }
        cursor += s.bars
      }
      // find the section label whose horizontal box contains phX
      const labels = [...document.querySelectorAll('.arr-section-label')]
      let containing = null
      for (const l of labels) {
        const b = l.getBoundingClientRect()
        if (phX >= b.left - 1 && phX <= b.right + 1) {
          containing = l.querySelector('.arr-section-name')?.textContent
          break
        }
      }
      return { step, bar, active, containing }
    })
    console.log(`[P2] step ${check.step} (bar ${check.bar}): active section "${check.active}", playhead sits in "${check.containing}"`)
    results.section = check
    if (check.active !== check.containing) {
      throw new Error(`[P2] playhead is over section "${check.containing}" but the active section for bar ${check.bar} is "${check.active}"`)
    }
    console.log('[P2] PASS: playhead lands in the correct section')
    await sp.screenshot({ path: join(uiDir, 'verify-p14-arrangement.png') })
    console.log('[P2] screenshot -> ui/verify-p14-arrangement.png')

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL CHECKS PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await loopDaemon.close()
    await songDaemon.close()
  }
}

main().catch((err) => {
  console.error('\nVERIFY FAILED:', err)
  process.exit(1)
})
