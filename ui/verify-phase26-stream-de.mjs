#!/usr/bin/env node
// Phase 26 Stream DE verification — level metering: a peak segment on the mixer's per-track meter
// (MixerView.tsx's TrackMeter), plus a per-effect-chain-row meter (SynthPanel.tsx's EffectRow).
// Both close the same complaint from two independent research passes: research 61 ("dotbeat's
// TrackMeter is RMS-only... the crest-factor collapse docs/volume-fader-bugfix.md found is close
// to invisible on an RMS-only meter") and research 63 ("not clear if [an effect is] actually doing
// anything... a bypassed-but-present row and a live one currently render identically"). Driven live
// against a REAL `beat daemon` + built frontend in headless Chromium — same harness/convention as
// ui/verify-volume-fader-bugfix.mjs and ui/verify-phase22-stream-aa.mjs — and cross-checked against
// REAL recorded/analyzed audio (src/metrics' analyze()), not DOM-element-exists assertions.
//
//   T1 PEAK METER    A synth track holds one percussive note (fast attack, short decay) looping
//                    every bar. While it plays, poll the SAME data source TrackMeter's peak segment
//                    itself reads (engine.getTrackPeak) and, concurrently, record+analyze the real
//                    master output (src/metrics' analyze(), samplePeakDbfs). The two should agree
//                    closely (same tap, same signal, no limiter engagement at this level) — proving
//                    the GUI's peak reading isn't a fake/decorative number. Also confirms the peak
//                    reading sits measurably ABOVE the RMS reading (the crest-factor gap an
//                    RMS-only meter hides — the exact bug-relevance research 61 names).
//   T2 EFFECT METER  Dial the default chain's `distortion` insert to a hot, unambiguous setting
//                    (drive=0.9, mix=1 — waveshaping preserves signal level, unlike bit-crushing
//                    at very low bit depths, which can round a moderate-level signal to literal
//                    zero — a real DSP fact, not a fixture bug, ruled out by picking distortion
//                    instead), starting BYPASSED (real routing bypass, ui/src/audio/engine.ts's
//                    reconcileEffectChain — the node is disconnected from the graph entirely, not a
//                    wet-knob-at-zero illusion). Its per-effect meter should read true near-silence.
//                    Click the REAL bypass checkbox to enable it: the meter should now show
//                    non-trivial activity, comparable to the track's own signal. Toggle back off:
//                    back to near-silence. Same real-checkbox-click discipline as
//                    ui/verify-phase22-stream-aa.mjs's AA3.
//   T3 CLIP LED      Hand-edit the project file (a supported dotbeat workflow — the daemon's own
//                    file watcher exists for exactly this, src/daemon/daemon.ts) to push the track
//                    hot enough (+6dB fader, resonant filter ringing) to genuinely exceed 0dBFS
//                    pre-limiter. Confirm the sticky "went over 0dB" peak-hold LED lights (backed by
//                    a real polled getTrackPeak() > 0 reading, not just a CSS class), then click it
//                    and confirm it clears — the "resettable peak indicator" research 61 §1b item 1
//                    names as missing.
//
// Usage: node ui/verify-phase26-stream-de.mjs

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const DAEMON_PORT = 8626
const PREVIEW_PORT = 5626

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function beat(args) {
  return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
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
async function analyzeBase64Wav(b64) {
  const { decodeWav, analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const bytes = Buffer.from(b64, 'base64')
  const decoded = decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  return analyze(decoded.channels, decoded.sampleRate)
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  // One synth track ("lead"), one bar loop, one percussive note (fast attack / short decay, NOT
  // sustained) so RMS and peak genuinely diverge — the whole point of T1. volume=-8dB keeps the
  // transient comfortably under the master Limiter(-1)'s threshold so the recorded master and the
  // track's own post-fader tap read the same peak (no limiter-shaping to confound the comparison).
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p26de-'))
  const beatPath = join(proj, 'song.beat')
  beat(['init', beatPath, '--bpm', '100', '--bars', '1'])
  beat(['set', beatPath, 'lead.volume', '-8', 'lead.attack', '0.004', 'lead.decay', '0.18', 'lead.sustain', '0.5', 'lead.release', '0.15'])
  beat(['add-note', beatPath, 'lead', '57', '0', '8', '0.95'])
  // T2 reuses the LEGACY default chain's own "distortion" entry (every fresh synth track already
  // carries eq3/comp/distortion/bitcrush, all enabled, defaultEffectChain() — no effect-add
  // needed). Dial it to a hot, unambiguous setting (drive=0.9, full wet — waveshaping, so it
  // reshapes the waveform without collapsing its level, unlike an aggressive bitcrush on a
  // moderate-level signal) but start it BYPASSED (a real routing disconnect, ui/src/audio/
  // engine.ts's reconcileEffectChain) so it has zero effect on T1's clean transient.
  beat(['set', beatPath, 'lead.distortionAmount', '0.9', 'lead.distortionMix', '1'])
  beat(['effect-bypass', beatPath, 'lead', 'distortion', 'true'])
  console.log(`project at ${beatPath}`)

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon on :${daemon.port}`)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try { return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok } catch { return false }
  }, 'vite preview to serve', 20000)
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const results = {}
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1280, height: 900 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // Open the real mixer overlay (T1/T3 live there) via the real topbar button.
    await page.click('button[data-action="toggle-mixer"]')
    await page.waitForSelector('[data-testid="mixer-overlay"]', { timeout: 5000 })
    await page.waitForSelector('[data-track-meter="lead"]', { timeout: 5000 })
    await page.waitForSelector('[data-clip-indicator="lead"]', { timeout: 5000 })
    console.log('[setup] mixer strip renders both the peak-capable meter canvas and the clip-hold LED')

    // ================================ T1: PEAK METER vs. measured audio ================================
    console.log('\n[T1] starting playback, polling engine.getTrackPeak("lead") while recording the real master...')
    const t1 = await page.evaluate(async () => {
      const eng = window.__engine
      eng.stop()
      await eng.play()
      await sleep(250)
      function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
      let guiPeak = -Infinity
      let polling = true
      const pollLoop = (async () => {
        while (polling) {
          const v = eng.getTrackPeak('lead')
          if (typeof v === 'number' && Number.isFinite(v) && v > guiPeak) guiPeak = v
          await sleep(8)
        }
      })()
      const blob = await eng.recordWav(2.4) // >= 2 bar-loops at 100bpm/1-bar (2.4s each)
      polling = false
      await pollLoop
      eng.stop()
      const buf = await blob.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      return { guiPeak, wavB64: btoa(bin) }
    })
    const measured = await analyzeBase64Wav(t1.wavB64)
    console.log(`  GUI (engine.getTrackPeak, polled max): ${t1.guiPeak.toFixed(2)}dB`)
    console.log(`  measured (metrics.analyze, samplePeakDbfs): ${measured.samplePeakDbfs.toFixed(2)}dBFS   rmsDbfs: ${measured.rmsDbfs.toFixed(2)}dBFS   crestDb: ${measured.crestDb.toFixed(2)}dB`)
    results.t1 = { guiPeak: t1.guiPeak, measuredPeak: measured.samplePeakDbfs, measuredRms: measured.rmsDbfs, crestDb: measured.crestDb }

    const peakDelta = Math.abs(t1.guiPeak - measured.samplePeakDbfs)
    if (!(peakDelta < 3)) {
      throw new Error(`[T1] GUI peak reading diverges too far from the measured recording (GUI ${t1.guiPeak.toFixed(2)}dB vs measured ${measured.samplePeakDbfs.toFixed(2)}dBFS, delta ${peakDelta.toFixed(2)}dB) — the meter may not be reading real data`)
    }
    console.log(`  [T1a] PASS: GUI peak tracks the real measured peak (Δ${peakDelta.toFixed(2)}dB)`)
    if (!(measured.crestDb > 3)) {
      throw new Error(`[T1] test transient has too little crest factor (${measured.crestDb.toFixed(2)}dB) to meaningfully distinguish peak from RMS — fixture problem, not a product bug`)
    }
    if (!(t1.guiPeak > measured.rmsDbfs + 3)) {
      throw new Error(`[T1] GUI peak reading (${t1.guiPeak.toFixed(2)}dB) should sit measurably above the track's own RMS (${measured.rmsDbfs.toFixed(2)}dBFS) for a real transient — this is exactly the gap research 61 flagged an RMS-only meter as hiding`)
    }
    console.log(`  [T1b] PASS: peak reading (${t1.guiPeak.toFixed(2)}dB) sits ${(t1.guiPeak - measured.rmsDbfs).toFixed(2)}dB above RMS — the crest an RMS-only meter would have hidden is now visible`)

    // ================================ T2: PER-EFFECT METER ================================
    // Close the mixer overlay first — it's a `position: fixed; inset: 0` modal scrim (App.tsx's
    // `overlay-scrim`) that visually covers the ENTIRE viewport, including the topbar, while open
    // (z-index over everything, regardless of DOM order) — so the Device pane's tab underneath it
    // isn't clickable, and even the topbar's own "Mixer" toggle button is covered by the scrim
    // itself. Dismiss it via the overlay's own in-panel Close button instead.
    await page.click('button[data-action="close-mixer"]')
    await page.waitForSelector('[data-testid="mixer-overlay"]', { state: 'detached', timeout: 5000 })
    await page.click('[data-pane-tab="device"]')
    await page.waitForSelector('[data-testid="effect-chain"]', { timeout: 5000 })
    await page.waitForSelector('[data-effect-meter="distortion"]', { timeout: 5000 })
    const bypassedChecked0 = await page.$eval('[data-effect-bypass="distortion"]', (el) => el.checked)
    if (bypassedChecked0 !== false) throw new Error(`[T2] expected distortion to start bypassed (unchecked), got checked=${bypassedChecked0}`)
    console.log('\n[T2] effect row + meter render, distortion starts bypassed as set up')

    const pollEffectLevel = async (ms) => page.evaluate(async (ms) => {
      const eng = window.__engine
      eng.stop()
      await eng.play()
      await new Promise((r) => setTimeout(r, 250))
      let peak = -Infinity
      const t0 = performance.now()
      while (performance.now() - t0 < ms) {
        const v = eng.getEffectLevel('lead', 'distortion')
        if (typeof v === 'number' && Number.isFinite(v) && v > peak) peak = v
        await new Promise((r) => setTimeout(r, 15))
      }
      eng.stop()
      return peak
    }, ms)

    const bypassedLevel = await pollEffectLevel(1600)
    console.log(`  distortion BYPASSED — polled peak effect-level: ${bypassedLevel === -Infinity ? '-Infinity' : bypassedLevel.toFixed(2) + 'dB'}`)
    results.t2 = { bypassedLevel }
    if (!(bypassedLevel < -80)) {
      throw new Error(`[T2] bypassed effect should read near-true-silence at its own tap (real routing disconnect), got ${bypassedLevel.toFixed(2)}dB`)
    }
    console.log('  [T2a] PASS: bypassed effect meter reads true silence (node is disconnected from the graph, not just a checkbox)')

    console.log('  clicking the REAL bypass checkbox to enable distortion (drive=0.9, mix=1 — hot, unambiguous)...')
    await page.click('[data-effect-bypass="distortion"]')
    await pollUntil(async () => (await page.$eval('[data-effect-bypass="distortion"]', (el) => el.checked)) === true, 'checkbox to show checked')
    await pollUntil(async () => {
      const doc = await page.evaluate(() => window.__store.getState().doc)
      return doc.tracks.find((t) => t.id === 'lead').effects.find((e) => e.id === 'distortion').enabled === true
    }, 'store doc to reflect enabled before polling')

    const enabledLevel = await pollEffectLevel(1600)
    console.log(`  distortion ENABLED — polled peak effect-level: ${enabledLevel.toFixed(2)}dB`)
    results.t2.enabledLevel = enabledLevel
    if (!(enabledLevel > -40)) {
      throw new Error(`[T2] enabled, audibly-processing effect should show non-trivial activity, got ${enabledLevel.toFixed(2)}dB`)
    }
    // bypassedLevel is -Infinity (true digital silence) — report the gap descriptively rather than
    // as a literal "Δ-Infinity to +X = Infinity" arithmetic result.
    const t2Delta = enabledLevel - bypassedLevel
    if (!(t2Delta > 40)) {
      throw new Error(`[T2] expected a large gap between enabled and bypassed effect-meter readings, got only Δ${t2Delta.toFixed(2)}dB`)
    }
    console.log(`  [T2b] PASS: enabling the effect moves its meter from true silence (${bypassedLevel === -Infinity ? '-Infinity' : bypassedLevel.toFixed(2) + 'dB'}) to real activity (${enabledLevel.toFixed(2)}dB) — visually distinguishable, answers "is this effect doing anything"`)

    console.log('  clicking bypass again (back off)...')
    await page.click('[data-effect-bypass="distortion"]')
    await pollUntil(async () => (await page.$eval('[data-effect-bypass="distortion"]', (el) => el.checked)) === false, 'checkbox to show unchecked again')
    const rebypassedLevel = await pollEffectLevel(1200)
    console.log(`  distortion RE-BYPASSED — polled peak effect-level: ${rebypassedLevel === -Infinity ? '-Infinity' : rebypassedLevel.toFixed(2) + 'dB'}`)
    results.t2.rebypassedLevel = rebypassedLevel
    if (!(rebypassedLevel < -80)) {
      throw new Error(`[T2] re-bypassing should return the meter to near-true-silence, got ${rebypassedLevel.toFixed(2)}dB`)
    }
    console.log('  [T2c] PASS: toggling bypass back off returns the meter to true silence')

    // ================================ T3: STICKY "WENT OVER 0dB" LED ================================
    console.log('\n[T3] hand-editing the project file (a real, supported workflow — the daemon watches for exactly this) to force a genuine >0dBFS transient...')
    // Reopen the mixer overlay (closed above for T2) — the meter/clip-LED DOM only exists while it's open.
    await page.click('button[data-action="toggle-mixer"]')
    await page.waitForSelector('[data-testid="mixer-overlay"]', { timeout: 5000 })
    await page.waitForSelector('[data-clip-indicator="lead"]', { timeout: 5000 })
    const clipBefore = await page.$eval('[data-clip-indicator="lead"]', (el) => el.classList.contains('on'))
    if (clipBefore) throw new Error('[T3] clip LED should start OFF (fresh session, no over yet)')
    // Bypass distortion again first (already done above) so this is a clean synth signal; push the
    // fader to its documented max (+6dB) and ring a max-resonance lowpass filter (Q=20) planted
    // RIGHT ON the note's own fundamental (A3, 220Hz — where a sawtooth's energy concentrates most)
    // — a classic way to genuinely exceed 0dBFS pre-limiter (a resonant lowpass boosts hard at its
    // own cutoff, roughly 20*log10(Q) dB for a biquad), not a fake/forced value.
    beat(['set', beatPath, 'lead.volume', '6', 'lead.resonance', '20', 'lead.cutoff', '220'])
    await pollUntil(async () => {
      const doc = await page.evaluate(() => window.__store.getState().doc)
      const t = doc.tracks.find((t) => t.id === 'lead')
      return t.synth.volume >= 6 && t.synth.resonance >= 20
    }, 'hand-edited params to reach the live store via the daemon file watcher', 8000)
    console.log('  hand-edit landed in the live store (file watcher confirmed working)')

    const t3 = await page.evaluate(async () => {
      const eng = window.__engine
      eng.stop()
      await eng.play()
      let sawOverZero = false
      const t0 = performance.now()
      while (performance.now() - t0 < 2500) {
        const v = eng.getTrackPeak('lead')
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) sawOverZero = true
        await new Promise((r) => setTimeout(r, 15))
      }
      // Give the GUI's own rAF-driven TrackMeter a moment to observe the same over and latch its LED.
      await new Promise((r) => setTimeout(r, 300))
      eng.stop()
      return { sawOverZero }
    })
    console.log(`  engine-side confirmation of a real >0dBFS reading during playback: ${t3.sawOverZero}`)
    results.t3 = { sawOverZero: t3.sawOverZero }
    if (!t3.sawOverZero) {
      throw new Error('[T3] test fixture did not genuinely exceed 0dBFS — cannot validate the clip LED against a real over')
    }
    const clipAfter = await pollUntil(
      async () => (await page.$eval('[data-clip-indicator="lead"]', (el) => el.classList.contains('on'))) || false,
      'clip LED to latch on after a real >0dB reading',
      4000,
    )
    console.log(`  [T3a] PASS: clip LED latched ON (class="on") after a real, engine-confirmed >0dBFS transient`)
    results.t3.litAfterOver = clipAfter

    console.log('  clicking the clip LED to clear it...')
    await page.click('[data-clip-indicator="lead"]')
    const clipCleared = await pollUntil(
      async () => (await page.$eval('[data-clip-indicator="lead"]', (el) => !el.classList.contains('on'))) || false,
      'clip LED to clear on click',
      3000,
    )
    console.log('  [T3b] PASS: clicking the LED clears it — a real hardware-style resettable peak indicator')
    results.t3.clearedAfterClick = clipCleared

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))

    console.log('\n================ PHASE 26 STREAM DE VERIFY PASSED ================')
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nPHASE 26 STREAM DE VERIFY FAILED:', err)
  process.exit(1)
})
