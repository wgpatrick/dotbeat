#!/usr/bin/env node
// Phase 20 Stream Y — reproduce + verify the Osc2 GUI-apply bug.
//
// Drives the REAL GUI edit path (window.__bridge.postEdit — the exact function a knob fires) against
// a real daemon, and measures BOTH: (1) does the in-browser store reflect the new value, and
// (2) does a real audio measurement (spectral centroid + RMS of the live master) actually change.
//
// The test doc is engineered to maximize the osc2 signal: a sine base oscillator (low centroid) plus
// an osc2 sawtooth one octave up. Raising osc2Level should audibly add a bright layer -> centroid and
// RMS both rise. If the GUI-apply chain drops the edit, the store keeps the old value and the audio
// does not move.
//
// It sweeps every field in FIELDS (osc2 + neighbors: osc3/unison, sub, noise) with the same method,
// so the same bug class elsewhere is caught, not just asserted absent.
//
// Usage: node ui/verify-osc2-fix.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8471
const PREVIEW_PORT = 5327

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
}
async function pollUntil(fn, what, timeoutMs = 15000, everyMs = 40) {
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

// A synth track holding one sustained note across the whole 1-bar loop, cutoff wide open so osc2's
// octave-up sawtooth harmonics are audible. Each field-under-test starts at its "off/low" value.
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
    osc2Level 0.05
    osc2Detune 1200
    subLevel 0
    noiseLevel 0
    unisonVoices 1
    unisonWidth 0
  note u100001 45 0 16 0.9
  note u100002 52 0 16 0.9
`

// Each: post <lo> then measure, post <hi> then measure. `needsOsc2Level` fields (osc3/unison) only
// sound when osc2Level>0, so those docs raise osc2Level first via a separate setup edit.
const FIELDS = [
  { key: 'osc2Level', lo: '0.05', hi: '1.0' },
  { key: 'osc2Detune', lo: '0', hi: '1200', setup: [['osc2Level', '0.8']] },
  { key: 'subLevel', lo: '0', hi: '1.0' },
  { key: 'noiseLevel', lo: '0', hi: '1.0' },
  { key: 'unisonVoices', lo: '1', hi: '7', setup: [['osc2Level', '0.8'], ['unisonWidth', '1']] },
]

async function main() {
  console.log('building repo (core/daemon/metrics) + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))

  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-osc2-'))
  const beatPath = join(proj, 'lead.beat')
  writeFileSync(beatPath, serialize(parse(BEAT)))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon on :${daemon.port}`)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try { return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok } catch { return false }
  }, 'vite preview to serve', 25000)
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })

  const rows = []
  let failures = 0
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine && window.__bridge, { timeout: 15000 })

    // Post one edit through the REAL GUI path and wait until the store's synth block shows it
    // (either the optimistic mirror, or the authoritative SSE re-pull — both must agree).
    const postAndConfirm = async (key, value) => {
      return await page.evaluate(async ({ key, value }) => {
        const before = window.__store.getState().doc.tracks.find((t) => t.id === 'lead').synth[key]
        window.__bridge.postEdit('lead.' + key, value)
        // Wait for the store to reflect it (optimistic is synchronous, but give the SSE re-pull time
        // to land too so we assert on the reconciled value, not a transient).
        const target = Number(value)
        const t0 = Date.now()
        for (;;) {
          const cur = Number(window.__store.getState().doc.tracks.find((t) => t.id === 'lead').synth[key])
          if (Math.abs(cur - target) < 1e-6) return { before, after: cur, ok: true }
          if (Date.now() - t0 > 4000) return { before, after: cur, ok: false }
          await new Promise((r) => setTimeout(r, 25))
        }
      }, { key, value })
    }

    const measure = async (secs = 1.2) => {
      const b64 = await page.evaluate(async (secs) => {
        await window.__engine.play()
        await new Promise((r) => setTimeout(r, 250))
        const blob = await window.__engine.recordWav(secs)
        window.__engine.stop()
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        return btoa(bin)
      }, secs)
      const m = await analyzeBase64Wav(b64)
      return { centroid: m.spectral.centroidHz, rms: m.samplePeakDbfs, lufs: m.integratedLufs }
    }

    for (const f of FIELDS) {
      // Reset any setup fields + the field itself to the lo value.
      for (const [k, v] of f.setup ?? []) await postAndConfirm(k, v)
      const lo = await postAndConfirm(f.key, f.lo)
      const mLo = await measure()
      const hi = await postAndConfirm(f.key, f.hi)
      const mHi = await measure()
      // Undo setup so the next field starts clean.
      for (const [k, v] of (f.setup ?? []).slice().reverse()) await postAndConfirm(k, v === '0.8' ? '0' : v === '1' ? '0' : v)
      await postAndConfirm(f.key, f.lo)

      const storeOk = lo.ok && hi.ok
      // "Audio moved" = centroid shifted meaningfully OR loudness shifted meaningfully.
      const dCentroid = mHi.centroid - mLo.centroid
      const dLufs = mHi.lufs - mLo.lufs
      const audioMoved = Math.abs(dCentroid) > 150 || Math.abs(dLufs) > 1.5
      const pass = storeOk && audioMoved
      if (!pass) failures++
      rows.push({ key: f.key, storeOk, storeAfter: hi.after, mLo, mHi, dCentroid, dLufs, audioMoved, pass })
      console.log(
        `\n[${f.key}] ${f.lo} -> ${f.hi}\n` +
        `  store: reflected=${storeOk} (after=${hi.after})\n` +
        `  centroid: ${mLo.centroid.toFixed(0)}Hz -> ${mHi.centroid.toFixed(0)}Hz  (${dCentroid >= 0 ? '+' : ''}${dCentroid.toFixed(0)}Hz)\n` +
        `  LUFS:     ${mLo.lufs.toFixed(1)} -> ${mHi.lufs.toFixed(1)}  (${dLufs >= 0 ? '+' : ''}${dLufs.toFixed(1)})\n` +
        `  => ${pass ? 'PASS (store updated AND audio moved)' : 'FAIL' + (!storeOk ? ' [store did NOT update]' : '') + (!audioMoved ? ' [audio did NOT move]' : '')}`,
      )
    }

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ SUMMARY ================')
    for (const r of rows) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.key.padEnd(12)} storeOk=${r.storeOk} dCentroid=${r.dCentroid.toFixed(0)}Hz dLUFS=${r.dLufs.toFixed(1)}`)
    console.log(failures === 0 ? '\nALL FIELDS PASS' : `\n${failures} FIELD(S) FAILED`)
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nOSC2 VERIFY FAILED:', err)
  process.exit(1)
})
