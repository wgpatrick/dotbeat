#!/usr/bin/env node
// Head-to-head: does the REAL postEdit path deliver osc2Level as strongly as a direct setDoc?
// If postEdit is broken, its measured audio will differ from setDoc's for the same target value.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8474
const PREVIEW_PORT = 5330
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(d, ...c) { return execFileSync('git', ['-C', d, ...c], { encoding: 'utf8' }) }
async function pollUntil(fn, w, t = 25000) { const t0 = Date.now(); for (;;) { if (await fn()) return; if (Date.now() - t0 > t) throw new Error('timeout ' + w); await sleep(40) } }

// Seed file: osc2 present (saw, +2oct) but OFF (osc2Level 0), one sustained note.
const BEAT = `format_version 0.4
bpm 120
loop_bars 1
selected_track lead

track lead lead #e06c75 synth
  synth
    osc sine
    volume -6
    cutoff 18000
    resonance 0.7
    attack 0.005
    decay 0.2
    sustain 1
    release 0.1
    pan 0
    osc2Type sawtooth
    osc2Level 0
    osc2Detune 2400
  note u1 45 0 16 0.9
`

async function main() {
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { decodeWav, analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-probec-'))
  const beatPath = join(proj, 'lead.beat')
  writeFileSync(beatPath, serialize(parse(BEAT)))
  git(proj, 'init', '-q'); git(proj, 'config', 'user.email', 'v@v'); git(proj, 'config', 'user.name', 'v'); git(proj, 'add', '-A'); git(proj, 'commit', '-q', '-m', 'b')
  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  await pollUntil(async () => { try { return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok } catch { return false } }, 'preview')
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
  try {
    const page = await browser.newPage()
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine && window.__bridge, { timeout: 15000 })
    const ana = (b64) => { const bytes = Buffer.from(b64, 'base64'); const dec = decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)); const m = analyze(dec.channels, dec.sampleRate); return { lufs: m.integratedLufs, centroid: m.spectral.centroidHz, storeVal: undefined } }
    const record = async () => page.evaluate(async () => {
      await window.__engine.play(); await new Promise((r) => setTimeout(r, 300))
      const blob = await window.__engine.recordWav(1.2); window.__engine.stop()
      const buf = await blob.arrayBuffer(); const bytes = new Uint8Array(buf); let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin)
    })
    const storeOsc2 = () => page.evaluate(() => window.__store.getState().doc.tracks.find(t => t.id === 'lead').synth.osc2Level)

    // 0) baseline from the daemon-loaded file (osc2Level 0)
    const base = ana(await record()); base.store = await storeOsc2()

    // 1) postEdit path: the REAL GUI edit
    await page.evaluate(() => window.__bridge.postEdit('lead.osc2Level', '1'))
    await page.waitForFunction(() => Math.abs(Number(window.__store.getState().doc.tracks.find(t => t.id === 'lead').synth.osc2Level) - 1) < 1e-6, { timeout: 5000 })
    await sleep(400) // let the SSE re-pull settle too
    const viaPost = ana(await record()); viaPost.store = await storeOsc2()

    // 2) setDoc path: force osc2Level 0 then 1 directly (bypassing daemon), same target
    await page.evaluate(() => { const d = window.__store.getState().doc; const nd = JSON.parse(JSON.stringify(d)); nd.tracks.find(t => t.id === 'lead').synth.osc2Level = 0; window.__store.getState().setDoc(nd) })
    const base2 = ana(await record())
    await page.evaluate(() => { const d = window.__store.getState().doc; const nd = JSON.parse(JSON.stringify(d)); nd.tracks.find(t => t.id === 'lead').synth.osc2Level = 1; window.__store.getState().setDoc(nd) })
    const viaSet = ana(await record()); viaSet.store = await storeOsc2()

    console.log('\n=== postEdit vs setDoc, osc2Level 0 -> 1 (base sine + osc2 saw +2oct) ===')
    console.log(`  baseline(file osc2Level 0)  store=${base.store}  LUFS ${base.lufs.toFixed(1)}  centroid ${base.centroid.toFixed(0)}Hz`)
    console.log(`  via postEdit -> 1           store=${viaPost.store}  LUFS ${viaPost.lufs.toFixed(1)}  centroid ${viaPost.centroid.toFixed(0)}Hz   (dCentroid ${(viaPost.centroid - base.lufs*0 - base.centroid).toFixed(0)}Hz, dLUFS ${(viaPost.lufs - base.lufs).toFixed(1)})`)
    console.log(`  via setDoc   -> 1           store=${viaSet.store}  LUFS ${viaSet.lufs.toFixed(1)}  centroid ${viaSet.centroid.toFixed(0)}Hz`)
    const matchC = Math.abs(viaPost.centroid - viaSet.centroid)
    const matchL = Math.abs(viaPost.lufs - viaSet.lufs)
    console.log(`\n  postEdit vs setDoc delta: centroid ${matchC.toFixed(0)}Hz, LUFS ${matchL.toFixed(2)}`)
    console.log(matchC < 40 && matchL < 0.8 ? '  => postEdit path delivers osc2 IDENTICALLY to setDoc (no GUI-path bug)' : '  => MISMATCH: postEdit path differs from setDoc -> GUI-path bug')
  } finally { await browser.close(); preview.kill('SIGTERM'); await daemon.close() }
}
main().catch((e) => { console.error(e); process.exit(1) })
