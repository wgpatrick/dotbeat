#!/usr/bin/env node
// Volume-fader bugfix verification — the owner reported, while listening to the live app: "Volume
// controls don't seem to work... at -inf I can still hear the music very clearly... at high
// volumes, it sounds like I'm blowing out the audio and its coming in weirdly." Investigation
// (docs/volume-fader-bugfix.md) found two real, independent bugs in ui/src/audio/engine.ts:
//
//   1. The mixer fader's minimum (MixerView.tsx VOL_MIN = -60dB, labeled "-∞") only ever WROTE
//      -60dB, and the engine applied that -60dB literally — quiet, but not silent, and audible on
//      a loud patch/system. Fixed: the engine now floors any volume at/below -60dB to real silence
//      (-Infinity dB / exact zero gain) at the point it's applied to the live audio graph.
//   2. The synth voice bank (synth + osc2/osc3 + unison pairs + sub + noise + fm) summed into its
//      filter at raw unity gain, so even a single plain voice had almost no headroom before the
//      master limiter — pushing the fader toward its documented +6dB ceiling (or even just to
//      0dB) drove the limiter hard enough to collapse the crest factor and produce audibly
//      squashed/pumping distortion well within normal fader travel. Fixed: a fixed -9dB headroom
//      trim on the additive voice sum (buildSynthChain's `headroom` node).
//
// This script drives the REAL fader control in the REAL GUI (Playwright pointer drag on the
// mixer's actual .mixer-fader element — not window.__store.setDoc()), lets the resulting postEdit
// round-trip through the real daemon exactly like a human drag would, and records/measures real
// audio off the engine — the same evidence bar every ui/verify-*.mjs script in this repo uses.
//
// Usage: node ui/verify-volume-fader-bugfix.mjs

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const DAEMON_PORT = 8619
const PREVIEW_PORT = 5619

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

  // A single synth track ("lead") holding one note across the WHOLE 2-bar loop (sustain=1) — a
  // steady tone that's trivial to meter accurately regardless of exactly when the recording window
  // starts, same discipline verify-phase18-lfo-depth.mjs's baseTrack uses.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-volfader-'))
  const beatPath = join(proj, 'song.beat')
  beat(['init', beatPath, '--bpm', '120', '--bars', '2'])
  beat(['set', beatPath, 'lead.sustain', '1'])
  beat(['add-note', beatPath, 'lead', '57', '0', '32', '0.9'])
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
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1280, height: 900 })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // Open the real mixer overlay via the real topbar button (App.tsx: mixerOpen is an on-demand
    // overlay, not a peer tab — research 18 Q3).
    await page.click('button[data-action="toggle-mixer"]')
    await page.waitForSelector('[data-testid="mixer-overlay"]', { timeout: 5000 })
    const fader = page.locator('.mixer-strip:has(.mixer-strip-name:text-is("lead")) .mixer-fader')
    await fader.waitFor({ timeout: 5000 })

    // Real playback, real engine — start it once and leave it running for every recording below
    // (a synth track re-syncs from the live doc every tick, so a fader drag mid-playback is heard
    // on the very next 16th-note step, same as a human dragging it live).
    await page.evaluate(async () => {
      await window.__engine.play()
    })
    await sleep(300) // let the graph settle before the first capture

    // Drags a big, clamped delta so the result is exactly norm=0 or norm=1 regardless of where the
    // fader currently sits — mirrors a user yanking the fader all the way to one end. `deltaY` is
    // in CSS px; the Fader component's own onPointerMove divides px by 160 (MixerView.tsx), so
    // +/-2000px overshoots the 0..1 range by >12x on purpose, guaranteeing the clamp bites.
    async function dragFaderBy(deltaY) {
      const box = await fader.boundingBox()
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.mouse.move(cx, cy + deltaY, { steps: 8 })
      await page.mouse.up()
    }
    async function currentVolume() {
      return page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'lead').synth.volume)
    }
    async function recordSeconds(secs) {
      const b64 = await page.evaluate(async (secs) => {
        const blob = await window.__engine.recordWav(secs)
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        return btoa(bin)
      }, secs)
      return analyzeBase64Wav(b64)
    }

    // ============================== (a) DRAG TO THE BOTTOM: real silence ==============================
    console.log('\n[MIN] dragging the real fader all the way down...')
    await dragFaderBy(2000) // downward = toward VOL_MIN (Fader's dy = startY - clientY, so +deltaY lowers norm)
    await pollUntil(async () => (await currentVolume()) <= -60, 'postEdit round-trip to land volume<=-60', 6000)
    const volAtBottom = await currentVolume()
    const labelAtBottom = await page.locator('.mixer-strip:has(.mixer-strip-name:text-is("lead")) .mixer-strip-db').textContent()
    console.log(`  document volume after drag: ${volAtBottom}dB, displayed label: "${labelAtBottom}"`)
    if (labelAtBottom.trim() !== '-∞') throw new Error(`[MIN] label should read "-∞" at the fader's minimum, got "${labelAtBottom}"`)
    // The DOCUMENT (the store polled above) updates the instant postEdit's HTTP round-trip lands,
    // but the ENGINE only re-syncs its live audio graph from the document once per 16th-note tick
    // (tick()'s own header comment: "Re-sync each tick so live knob/step edits are heard on the
    // next step — BeatLab does the same"), i.e. up to ~125ms of latency at 120bpm. Recording
    // immediately after the document-level poll can catch that intentional, documented catch-up
    // window and capture a slice of the OLD (pre-drag) level — not a bug, just measuring before the
    // engine has had its next scheduled tick. Give it a couple of ticks' margin, same as a real
    // listener wouldn't judge "is it silent yet" from the exact millisecond they released the mouse.
    await sleep(300)
    const silent = await recordSeconds(4.2) // >= one full 2-bar/120bpm loop (4.0s)
    console.log(`  recorded: peak=${silent.samplePeakDbfs.toFixed(1)}dBFS  rms=${silent.rmsDbfs.toFixed(1)}dBFS  truePeak=${silent.truePeakDbtp.toFixed(1)}dBTP`)
    // The real, measured bug: pre-fix this read ~-60.5dBFS (quiet, but genuinely audible on a loud
    // system) despite the label already promising "-∞". Post-fix it should be true digital silence
    // (measured exactly -Infinity dBFS in the fix's own investigation — see docs/volume-fader-
    // bugfix.md); allow a wide margin below the OLD buggy -60dBFS floor so this genuinely proves
    // the fix rather than merely "quieter than before".
    if (!(silent.samplePeakDbfs < -90)) {
      throw new Error(`[MIN] fader minimum is not genuinely silent — peak ${silent.samplePeakDbfs.toFixed(1)}dBFS (pre-fix bug measured ~-60.5dBFS; expected < -90dBFS, ideally -Infinity)`)
    }
    console.log('  [MIN] PASS: the fader\'s minimum position is now REAL measured silence, matching what the "-∞" label promises')

    // ============================== (b) DRAG TO THE MIDDLE: a reference point ==============================
    console.log('\n[MID] dragging the real fader to its middle (norm=0.5, from the current bottom)...')
    await dragFaderBy(-80) // from norm=0 (just landed), +80px up = +0.5 norm (Fader divides px by 160)
    await pollUntil(async () => {
      const v = await currentVolume()
      return v > -40 && v < -10 // -27dB expected at norm=0.5 (VOL_MIN + 0.5*range)
    }, 'postEdit round-trip to land volume near -27', 6000)
    const volAtMid = await currentVolume()
    console.log(`  document volume after drag: ${volAtMid.toFixed(1)}dB`)
    await sleep(300) // same tick-catch-up margin as [MIN] above
    const mid = await recordSeconds(4.2)
    console.log(`  recorded: peak=${mid.samplePeakDbfs.toFixed(1)}dBFS  rms=${mid.rmsDbfs.toFixed(1)}dBFS  crest=${mid.crestDb.toFixed(1)}dB`)

    // ============================== (c) DRAG TO THE TOP: loud, not blown out ==============================
    console.log('\n[MAX] dragging the real fader all the way up...')
    await dragFaderBy(-2000) // upward = toward VOL_MAX
    await pollUntil(async () => (await currentVolume()) >= 6, 'postEdit round-trip to land volume>=6', 6000)
    const volAtTop = await currentVolume()
    const labelAtTop = await page.locator('.mixer-strip:has(.mixer-strip-name:text-is("lead")) .mixer-strip-db').textContent()
    console.log(`  document volume after drag: ${volAtTop}dB, displayed label: "${labelAtTop}"`)
    if (labelAtTop.trim() !== '+6.0') throw new Error(`[MAX] label should read "+6.0" at the fader's maximum, got "${labelAtTop}"`)

    await sleep(300) // same tick-catch-up margin as [MIN] above
    const loud = await recordSeconds(4.2)
    console.log(`  recorded: peak=${loud.samplePeakDbfs.toFixed(1)}dBFS  truePeak=${loud.truePeakDbtp.toFixed(1)}dBTP  crest=${loud.crestDb.toFixed(1)}dB  rms=${loud.rmsDbfs.toFixed(1)}dBFS`)

    await page.evaluate(() => window.__engine.stop())
    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))

    // ---- monotonic increase: silent < mid < loud, by a wide, unambiguous margin ----
    console.log('\n[MONOTONIC] checking rms strictly increases bottom -> middle -> top...')
    console.log(`  rms:  bottom ${silent.rmsDbfs.toFixed(1)}dBFS  ->  middle ${mid.rmsDbfs.toFixed(1)}dBFS  ->  top ${loud.rmsDbfs.toFixed(1)}dBFS`)
    if (!(mid.rmsDbfs > silent.rmsDbfs + 40)) throw new Error(`[MONOTONIC] middle should be far louder than genuine silence (mid ${mid.rmsDbfs.toFixed(1)} vs bottom ${silent.rmsDbfs.toFixed(1)})`)
    if (!(loud.rmsDbfs > mid.rmsDbfs + 3)) throw new Error(`[MONOTONIC] top should be measurably louder than the middle (top ${loud.rmsDbfs.toFixed(1)} vs mid ${mid.rmsDbfs.toFixed(1)})`)
    console.log('  [MONOTONIC] PASS: real, measured, monotonic level increase across the fader\'s range')

    // ---- top-of-range distortion check: some limiting at the extreme +6dB ceiling is an accepted
    // design tradeoff (a real master Limiter(-1) sits on the bus, same as a hardware/DAW limiter
    // catching a hot channel) — but it must stay CLEAN (a few dB of gentle gain reduction), not the
    // pre-fix collapse into a near-flat, heavily pumping waveform. crestDb (peak - RMS) is the
    // right observable: pre-fix this collapsed to ~1.3dB at the same +6dB position (severe,
    // audible squashing); post-fix it should retain real dynamics.
    console.log('\n[CLEAN-CEILING] checking the top of the fader range is loud-but-clean, not brick-walled...')
    console.log(`  crest at +6dB: ${loud.crestDb.toFixed(1)}dB   truePeak: ${loud.truePeakDbtp.toFixed(1)}dBTP`)
    if (!(loud.crestDb > 4)) {
      throw new Error(`[CLEAN-CEILING] crest factor collapsed to ${loud.crestDb.toFixed(1)}dB at the fader's max — sounds like the pre-fix "blown out/weird" squashing, not clean headroom-limited loudness`)
    }
    if (!(loud.truePeakDbtp < 3)) {
      throw new Error(`[CLEAN-CEILING] true peak ${loud.truePeakDbtp.toFixed(1)}dBTP at the fader's max is far past the master Limiter(-1) threshold — real uncontrolled overs, not gentle catch-limiting`)
    }
    console.log('  [CLEAN-CEILING] PASS: the fader\'s maximum is loud and pushes into the master limiter (expected, by design — a real +6dB boost on a hot voice) but stays measurably clean (healthy crest factor, no wild true-peak overs), not the pre-fix pumping/distortion character')

    console.log('\n================ VOLUME FADER BUGFIX VERIFY PASSED ================')
    console.log(JSON.stringify({
      volAtBottom, volAtMid: Math.round(volAtMid * 10) / 10, volAtTop,
      silent: { peak: silent.samplePeakDbfs, rms: silent.rmsDbfs },
      mid: { peak: mid.samplePeakDbfs, rms: mid.rmsDbfs, crest: mid.crestDb },
      loud: { peak: loud.samplePeakDbfs, truePeak: loud.truePeakDbtp, crest: loud.crestDb, rms: loud.rmsDbfs },
    }, null, 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nVOLUME FADER BUGFIX VERIFY FAILED:', err)
  process.exit(1)
})
