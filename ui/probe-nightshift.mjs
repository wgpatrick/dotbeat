#!/usr/bin/env node
// Faithful reproduction of the reported scenario: real night-shift.beat, lead track,
// postEdit lead.osc2Level 0.45 -> 1.0, measuring BOTH spectral centroid AND loudness.
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8475
const PREVIEW_PORT = 5331
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(d, ...c) { return execFileSync('git', ['-C', d, ...c], { encoding: 'utf8' }) }
async function pollUntil(fn, w, t = 25000) { const t0 = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t0 > t) throw new Error('timeout ' + w); await sleep(40) } }

async function main() {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { decodeWav, analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-ns-'))
  const beatPath = join(proj, 'night-shift.beat')
  writeFileSync(beatPath, serialize(parse(readFileSync(join(repoRoot, 'examples/night-shift.beat'), 'utf8'))))
  git(proj, 'init', '-q'); git(proj, 'config', 'user.email', 'v@v'); git(proj, 'config', 'user.name', 'v'); git(proj, 'add', '-A'); git(proj, 'commit', '-q', '-m', 'b')
  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  await pollUntil(async () => { try { return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok } catch { return false } }, 'preview')
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
  try {
    const page = await browser.newPage()
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine && window.__bridge, { timeout: 15000 })
    const ana = (b64) => { const bytes = Buffer.from(b64, 'base64'); const dec = decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)); const m = analyze(dec.channels, dec.sampleRate); return { lufs: m.integratedLufs, centroid: m.spectral.centroidHz, peak: m.samplePeakDbfs } }
    // Solo lead so we measure the lead's osc2 change, not the whole mix.
    await page.evaluate(() => window.__store.getState().toggleSolo('lead'))
    // Record the WHOLE 4-bar loop (@124bpm ~= 7.74s) so the lead's notes (which start at step 20)
    // are captured, not just the silent lead-in.
    const record = async () => page.evaluate(async () => {
      await window.__engine.play(); await new Promise((r) => setTimeout(r, 300))
      const blob = await window.__engine.recordWav(8.0); window.__engine.stop()
      const buf = await blob.arrayBuffer(); const bytes = new Uint8Array(buf); let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin)
    })
    const storeVal = () => page.evaluate(() => window.__store.getState().doc.tracks.find(t => t.id === 'lead').synth.osc2Level)

    const before = ana(await record()); const bStore = await storeVal()
    await page.evaluate(() => window.__bridge.postEdit('lead.osc2Level', '1.0'))
    await page.waitForFunction(() => Math.abs(Number(window.__store.getState().doc.tracks.find(t => t.id === 'lead').synth.osc2Level) - 1) < 1e-6, { timeout: 5000 })
    await sleep(400)
    const after = ana(await record()); const aStore = await storeVal()

    console.log('\n=== night-shift lead, postEdit osc2Level 0.45 -> 1.0 (lead soloed) ===')
    console.log(`  BEFORE  store=${bStore}  LUFS ${before.lufs.toFixed(1)}  centroid ${before.centroid.toFixed(0)}Hz  peak ${before.peak.toFixed(1)}`)
    console.log(`  AFTER   store=${aStore}  LUFS ${after.lufs.toFixed(1)}  centroid ${after.centroid.toFixed(0)}Hz  peak ${after.peak.toFixed(1)}`)
    console.log(`  DELTA   store ${bStore} -> ${aStore}   dLUFS ${(after.lufs - before.lufs).toFixed(2)}   dCentroid ${(after.centroid - before.centroid).toFixed(0)}Hz   dPeak ${(after.peak - before.peak).toFixed(2)}`)
    console.log('  (osc2Detune=14c in night-shift => osc2 is a near-unison layer: raising its level changes LOUDNESS, not brightness)')
  } finally { await browser.close(); preview.kill('SIGTERM'); await daemon.close() }
}
main().catch((e) => { console.error(e); process.exit(1) })
