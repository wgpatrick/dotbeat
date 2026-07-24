#!/usr/bin/env node
// Clip-automation render regression — the bug fixed in ui/src/audio/engine.ts (commit "fix(engine):
// clip automation lanes now win over static patch values on render"): applyParams() re-asserted the
// STATIC patch value for every automatable param on every 16th-note tick (from sync()), landing at
// or before the current time, while the tick's automation pass only ramped to the automated value by
// the NEXT step — so an automated param spent almost the whole step pinned back at the patch default.
// Empirically (prior investigation): a -60dB volume automation lane rendered at only ~-4.6dB of
// attenuation; an automated 150Hz cutoff measured ~10dB LOUDER than the identical static-150Hz
// control. Both live and offline render go through the same tick()/sync()/applyParams, so this drives
// the REAL engine (a real daemon, the real built ui/, real Tone.js audio recorded off the live graph
// via window.__engine.recordWav, measured with src/metrics's decodeWav) — the same evidence bar and
// setDoc()-driven recording harness as ui/verify-phase26-stream-da.mjs (the sibling automation-vs-LFO
// bug), reused directly.
//
// Fixtures are the committed test/fixtures/clip-automation/*.beat files, parsed through the real
// src/core parse() and pushed into the live engine via setDoc() — one source of truth shared with
// test/clip-automation-render.test.ts:
//   [VOLUME]  vol-auto.beat  = a synth drone whose clip automates volume, HELD at -60dB across the
//             whole loop, vs vol-static.beat = the identical drone at a static 0dB and no lane.
//             Held (not ramped) so full-buffer RMS measures whether the lane's value reaches the
//             graph at all, free of ramp-transient energy. The automated take must be ~silent and
//             tens of dB below the static control (pre-fix: only ~4.6dB below).
//   [CUTOFF]  cutoff-auto.beat = the drone whose clip automates cutoff, HELD at 150Hz, static patch
//             cutoff a wide-open 12kHz, vs cutoff-static.beat = the identical drone with a STATIC
//             150Hz patch cutoff and no lane. The two renders must measure within a few dB of each
//             other (pre-fix the automated take read ~10dB louder — the lane barely bit).
//
// Usage: node ui/verify-clip-automation-render.mjs

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const fixturesDir = join(repoRoot, 'test', 'fixtures', 'clip-automation')
const DAEMON_PORT = 48627
const PREVIEW_PORT = 45627

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
async function decodeBase64Wav(b64) {
  const { decodeWav } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const bytes = Buffer.from(b64, 'base64')
  return decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
}

// Full-buffer RMS (dBFS) across all channels, skipping the first `skipSec` (engine/graph settle +
// note attack) so the measurement sits on the steady drone.
function rmsDb(decoded, skipSec = 0.4) {
  const i0 = Math.min(decoded.channels[0].length, Math.floor(skipSec * decoded.sampleRate))
  let sumSq = 0
  let count = 0
  for (const ch of decoded.channels) {
    for (let i = i0; i < ch.length; i++) {
      sumSq += ch[i] * ch[i]
      count++
    }
  }
  const rms = Math.sqrt(sumSq / Math.max(1, count))
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { parse } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const loadDoc = (name) => JSON.parse(JSON.stringify(parse(readFileSync(join(fixturesDir, `${name}.beat`), 'utf8'))))

  // A throwaway project just to get a daemon+page pair up; every take records via setDoc() straight
  // into the live engine (same as verify-phase26-stream-da.mjs), so the daemon file is never read.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-clipauto-'))
  const beatPath = join(proj, 'song.beat')
  beat(['init', beatPath, '--bpm', '120', '--bars', '1'])

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon on :${daemon.port}`)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try { return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok } catch { return false }
  }, 'vite preview to serve')
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const errors = []
  const freshPage = async () => {
    const page = await browser.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })
    return page
  }
  // Record `secs` of the live master for a given doc, on a fresh page (fresh Tone context — no bleed
  // between takes). setDoc() bypasses parse(), but the docs come FROM parse() above, so every field
  // (incl. v0.10 note chance/cent/ratchet) is already present.
  const recordDoc = async (doc, secs) => {
    const page = await freshPage()
    const b64 = await page.evaluate(async ({ doc, secs }) => {
      window.__engine.stop()
      window.__store.getState().setDoc(doc)
      await window.__engine.play()
      await new Promise((r) => setTimeout(r, 250))
      const blob = await window.__engine.recordWav(secs)
      window.__engine.stop()
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      return btoa(bin)
    }, { doc, secs })
    await page.close()
    return decodeBase64Wav(b64)
  }

  const results = {}
  let failed = false
  try {
    const SECS = 2.4
    // ============================== [VOLUME] ==============================
    console.log('\n[VOLUME] recording an automated -60dB volume lane vs a static 0dB control...')
    const volAutoDb = rmsDb(await recordDoc(loadDoc('vol-auto'), SECS))
    const volStaticDb = rmsDb(await recordDoc(loadDoc('vol-static'), SECS))
    results.volume = { autoDb: volAutoDb, staticDb: volStaticDb, deltaDb: volStaticDb - volAutoDb }
    console.log(`  automated -60dB lane RMS: ${volAutoDb === -Infinity ? '-Infinity' : volAutoDb.toFixed(1)}dBFS`)
    console.log(`  static  0dB control RMS: ${volStaticDb.toFixed(1)}dBFS`)
    console.log(`  attenuation the lane actually achieved: ${(volStaticDb - volAutoDb).toFixed(1)}dB (pre-fix this was ~4.6dB)`)
    if (!(volStaticDb - volAutoDb > 40)) { failed = true; console.error(`  [VOLUME] FAIL: automated -60dB lane only attenuated ${(volStaticDb - volAutoDb).toFixed(1)}dB below the static control (expected > 40dB)`) }
    else if (!(volAutoDb < -50)) { failed = true; console.error(`  [VOLUME] FAIL: automated -60dB lane render is not near-silent (${volAutoDb.toFixed(1)}dBFS, expected < -50dBFS)`) }
    else console.log('  [VOLUME] PASS: the -60dB volume lane renders near-silent')

    // ============================== [CUTOFF] ==============================
    console.log('\n[CUTOFF] recording an automated 150Hz cutoff lane vs an identical static-150Hz-cutoff control...')
    const cutAutoDb = rmsDb(await recordDoc(loadDoc('cutoff-auto'), SECS))
    const cutStaticDb = rmsDb(await recordDoc(loadDoc('cutoff-static'), SECS))
    results.cutoff = { autoDb: cutAutoDb, staticDb: cutStaticDb, deltaDb: cutAutoDb - cutStaticDb }
    console.log(`  automated 150Hz-cutoff lane RMS: ${cutAutoDb.toFixed(1)}dBFS`)
    console.log(`  static  150Hz-cutoff control RMS: ${cutStaticDb.toFixed(1)}dBFS`)
    console.log(`  gap between automated and static 150Hz cutoff: ${(cutAutoDb - cutStaticDb).toFixed(1)}dB (pre-fix ~+10dB — lane barely bit)`)
    if (!(Math.abs(cutAutoDb - cutStaticDb) < 4)) { failed = true; console.error(`  [CUTOFF] FAIL: automated 150Hz cutoff render is ${(cutAutoDb - cutStaticDb).toFixed(1)}dB from the static control (expected within 4dB)`) }
    else console.log('  [CUTOFF] PASS: the automated 150Hz cutoff renders within tolerance of the static 150Hz control')
  } finally {
    await browser.close()
    preview.kill()
    await daemon.stop?.()
  }
  if (errors.length) console.error('page errors:', errors)
  console.log('\nRESULTS', JSON.stringify(results, null, 2))
  if (failed) { console.error('\nFAIL'); process.exit(1) }
  console.log('\nALL CHECKS PASS')
}

main().catch((e) => { console.error(e); process.exit(1) })
