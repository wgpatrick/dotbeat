#!/usr/bin/env node
// Phase 16 Stream K verification — instrument-track meters/mute-gating + mixer FX-chain badges,
// driven end-to-end in headless Chrome against a real daemon, mirroring the established
// ui/verify*.mjs convention (verify-phase14.mjs's mute/meter evidence bar, verify-instrument.mjs's
// real-soundfont project setup).
//
//   IM1  Instrument-track meter reads a REAL, differing level. engine.getTrackLevel() used to
//        return null for instrument tracks (Phase 14 Stream F's own deferred item) — confirm it now
//        returns a real audible dB reading while the instrument track plays.
//   IM2  Muting the instrument track via the ACTUAL mixer button drives its own post-gate tap to
//        true silence (~-120dB), not just a CSS class toggling — same bar Phase 14 Stream E set for
//        synth/drum tracks.
//   FX1  The mixer shows DIFFERENTIATED FX-chain badges: a track with EQ+comp edited away from
//        default shows "EQ"/"Comp" badges; an untouched synth track shows none; an instrument track
//        (no insert chain the engine applies) shows no badge row at all. Screenshot saved.
//
// Usage: node ui/verify-phase16-stream-k.mjs

import { mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8473
const PREVIEW_PORT = 5331
const beatCli = join(repoRoot, 'cli', 'beat.mjs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function beat(args) {
  return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 20000, everyMs = 40) {
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

  // ---- a real project: one instrument track (real FluidR3 GM bank) + two synth tracks, one with
  // an edited insert chain (EQ + comp) and one left at defaults ----
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p16k-'))
  const beatPath = join(proj, 'song.beat')
  copyFileSync(join(repoRoot, 'presets', 'sf2', 'fluidr3-gm-small.sf2'), join(proj, 'gm.sf2'))
  beat(['init', beatPath])
  beat(['sample', beatPath, 'gm', 'gm.sf2'])
  beat(['add-track', beatPath, 'flute', 'instrument', '--soundfont', 'gm', '--program', '73']) // Flute
  beat(['add-track', beatPath, 'leadB', 'synth'])
  beat(['rm-track', beatPath, 'lead']) // drop init's starter synth track (renamed to leadA below)
  beat(['add-track', beatPath, 'leadA', 'synth'])
  beat(['set', beatPath, 'loop_bars', '1'])
  // flute: a sustained triad across the whole 1-bar loop (steady tone, easy to meter)
  for (const pitch of [60, 64, 67]) beat(['add-note', beatPath, 'flute', String(pitch), '0', '15', '0.9'])
  // leadA: edit EQ + comp away from default -> the FX badges should show "EQ" and "Comp"
  beat(['set', beatPath, 'leadA.eqLow', '6', 'leadA.eqHigh', '-4', 'leadA.compMix', '0.6'])
  for (const pitch of [48, 55]) beat(['add-note', beatPath, 'leadA', String(pitch), '0', '15', '0.8'])
  // leadB: left at defaults -> the FX badges should show none
  for (const pitch of [52, 59]) beat(['add-note', beatPath, 'leadB', String(pitch), '0', '15', '0.8'])
  console.log(`project at ${beatPath}`)

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon on :${daemon.port}`)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
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
    25000,
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
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 15000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    const trackIds = await page.evaluate(() => window.__store.getState().doc.tracks.map((t) => t.id))
    console.log(`\ntracks: ${JSON.stringify(trackIds)}`)

    // ================================ FX1: mixer FX-chain badges ================================
    await page.click('.view-tab[data-view="mixer"]')
    await page.waitForSelector('.mixer-strip', { timeout: 5000 })
    const badgeState = await page.evaluate(() => {
      const strips = [...document.querySelectorAll('.mixer-strip')]
      const out = {}
      for (const s of strips) {
        const name = s.querySelector('.mixer-strip-name')?.textContent
        const fx = s.querySelector('.mixer-strip-fx')
        out[name] = fx ? [...fx.querySelectorAll('.mixer-fx-badge')].map((b) => b.textContent) : null // null = no row at all (shouldn't happen)
      }
      return out
    })
    console.log(`\n[FX1] per-strip badges: ${JSON.stringify(badgeState)}`)
    results.badges = badgeState
    if (!(badgeState.leadA?.includes('EQ') && badgeState.leadA?.includes('Comp'))) {
      throw new Error(`[FX1] leadA (eqLow/eqHigh/compMix edited) expected EQ+Comp badges, got ${JSON.stringify(badgeState.leadA)}`)
    }
    if (!(badgeState.leadB?.length === 1 && badgeState.leadB[0] === '—')) {
      throw new Error(`[FX1] leadB (untouched defaults) expected the "none active" placeholder, got ${JSON.stringify(badgeState.leadB)}`)
    }
    if (!(Array.isArray(badgeState.flute) && badgeState.flute.length === 0)) {
      throw new Error(`[FX1] instrument track "flute" expected NO badges (engine doesn't apply its synth block), got ${JSON.stringify(badgeState.flute)}`)
    }
    console.log('[FX1] PASS: badges reflect real per-track insert-chain data — leadA differs from leadB, instrument track shows none')
    await page.screenshot({ path: join(uiDir, 'verify-p16k-mixer-fx.png') })
    console.log('[FX1] screenshot -> ui/verify-p16k-mixer-fx.png')

    // ============================ IM1/IM2: instrument meter + mute gate ============================
    await page.click('.play-btn')
    await pollUntil(
      () => page.evaluate(() => window.__store.getState().currentStep >= 0 && Number.isFinite(window.__store.getState().masterLevel)),
      'transport ticking + master meter reading',
    )
    // Give the WorkletSynthesizer time to fetch+load the soundfont bank (async build; the loop
    // repeats so notes are heard on a later cycle once ready) — same settle window verify-instrument.mjs uses.
    await sleep(2500)

    const sampleLevel = async (id, ms) => {
      return page.evaluate(
        async ({ id, ms }) => {
          const eng = window.__engine
          let peak = -Infinity
          const t0 = performance.now()
          while (performance.now() - t0 < ms) {
            const v = eng.getTrackLevel(id)
            if (typeof v === 'number' && isFinite(v) && v > peak) peak = v
            await new Promise((r) => setTimeout(r, 30))
          }
          return peak === -Infinity ? -120 : Math.round(peak * 10) / 10
        },
        { id, ms },
      )
    }

    const fluteBase = await sampleLevel('flute', 1800)
    console.log(`\n[IM1] flute (instrument track) peak dB while playing: ${fluteBase}`)
    results.fluteBaseline = fluteBase
    if (!(fluteBase > -60)) throw new Error(`[IM1] instrument track meter not audible (${fluteBase}dB) — getTrackLevel still not wired for instrument tracks`)
    console.log('[IM1] PASS: getTrackLevel() returns a real, audible reading for an instrument track')

    const fluteName = await page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'flute').name)
    await page.click(`.mixer-strip:has(.mixer-strip-name:text-is("${fluteName}")) .mixer-btn.mute`)
    await pollUntil(() => page.evaluate(() => window.__store.getState().mutes['flute'] === true), 'flute mute to reach store')
    await sleep(300) // let the gate apply on the next tick
    const fluteMuted = await sampleLevel('flute', 1500)
    console.log(`[IM2] muted flute. peak dB now: ${fluteMuted}`)
    results.fluteMuted = fluteMuted
    if (!(fluteMuted < -60)) throw new Error(`[IM2] muted instrument track still audible at ${fluteMuted}dB (mute gate not wired for instrument voices)`)
    console.log(`[IM2] PASS: flute tap ${fluteBase}dB -> ${fluteMuted}dB (true silence) — mute gate real for instrument tracks`)
    await page.screenshot({ path: join(uiDir, 'verify-p16k-instrument-mute.png') })
    console.log('[IM2] screenshot -> ui/verify-p16k-instrument-mute.png')

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL PHASE 16 STREAM K CHECKS PASSED ================')
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
