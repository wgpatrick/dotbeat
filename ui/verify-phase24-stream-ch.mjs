#!/usr/bin/env node
// Phase 24 Stream CH verification — "audition a clip in isolation" (docs/phase-24-stream-ch.md).
// Drives the REAL live GUI (ui/src/components/NoteView.tsx's new "Preview clip" button) over
// headless Chromium against a REAL `beat daemon`, same harness/convention as
// ui/verify-phase23-stream-bd.mjs (Goertzel single-bin measurement off a real engine.recordWav()
// capture) and ui/verify-phase22-stream-ag.mjs (song-mode fixture with scenes/sections).
//
// The bug this stream fixes: NoteView.tsx always edits a track's own TOP-LEVEL notes/hits (what
// the owner calls "the clip editor"), but engine.ts's contentOf() NEVER reads those in song mode —
// it resolves the active section's scene's CLIP instead. So editing a track's live content while
// the project is in song mode was completely inaudible, regardless of playback position. The fixture
// below reproduces that exactly: t1's own live notes (what's "open" in NoteView) hold a pitch that
// is NOT part of what t1's (unmapped) scene slot would play — t1 isn't slotted into the one scene at
// all, so normal song playback is silent for it, full stop.
//
//   T1  Baseline (bug reproduction): with the project in song mode and normal playback running,
//       t1's own live note is NOT audible (near-silence at its frequency) — confirming the fixture
//       actually reproduces "I put notes down, how do I hear it?" — while t2 (properly slotted into
//       the song's one scene) IS audible, so the fixture/measurement pipeline itself is sound.
//   T2  Selecting t1 shows a "Preview clip" button in NoteView's toolbar; clicking it starts an
//       audition — real, measured, non-silent audio at EXACTLY t1's own live note's frequency.
//   T3  Isolation: while t1 is auditioning, t2's normally-audible (in song mode) content is SILENT —
//       this is a solo-preview, not "start the song from this point."
//   T4  Clean stop: clicking the button again (now "■ Stop") stops the audition — the button reverts,
//       the store's auditioningTrackId clears, and the transport actually halts (currentStep resets).
//   T5  Mutual exclusion: starting an audition, then pressing the main transport's Play button, stops
//       the audition (button/state revert) and normal song playback takes over instead.
//
// Usage: node ui/verify-phase24-stream-ch.mjs

import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5951 // distinct from other verify scripts' ports so concurrent runs never collide

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function git(dir, ...cmd) {
  return execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' })
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
  const metrics = analyze(decoded.channels, decoded.sampleRate)
  return { decoded, metrics }
}

// Goertzel single-bin magnitude estimate — exact energy AT one frequency, without a full FFT. Same
// helper as verify-phase22-stream-ac.mjs / verify-phase23-stream-bd.mjs.
function goertzelMag(samples, sampleRate, freq) {
  const n = samples.length
  const k = Math.round((freq * n) / sampleRate)
  const w = (2 * Math.PI * k) / n
  const cosine = Math.cos(w)
  const coeff = 2 * cosine
  let q0 = 0, q1 = 0, q2 = 0
  for (let i = 0; i < n; i++) {
    q0 = coeff * q1 - q2 + samples[i]
    q2 = q1
    q1 = q0
  }
  const real = q1 - q2 * cosine
  const imag = q2 * Math.sin(w)
  return Math.sqrt(real * real + imag * imag) / (n / 2)
}

// A steady-state mono chunk, well past any note's attack, from a decoded recording.
function steadyChunk(decoded, startSec, lenSec) {
  const a = Math.round(startSec * decoded.sampleRate)
  const b = Math.round((startSec + lenSec) * decoded.sampleRate)
  const n = b - a
  const m = new Float64Array(n)
  for (const ch of decoded.channels) for (let i = 0; i < n; i++) m[i] += ch[a + i] / decoded.channels.length
  return m
}

// MIDI pitch -> Hz (A4 = pitch 69 = 440Hz).
function pitchHz(pitch) {
  return 440 * Math.pow(2, (pitch - 69) / 12)
}

const T1_LIVE_PITCH = 69 // A4, 440Hz — t1's own top-level notes (what NoteView "has open")
const T2_CLIP_PITCH = 48 // C3, ~130.8Hz — t2's scene-mapped clip content (what song mode plays)
const T1_FREQ = pitchHz(T1_LIVE_PITCH)
const T2_FREQ = pitchHz(T2_CLIP_PITCH)

// ---- fixture: a 2-bar song-mode project where t1's live content is orphaned ---------------------
// t1 has its own live/top-level note (T1_LIVE_PITCH, held the whole loop) — exactly what NoteView.tsx
// edits — but t1 is NOT slotted into the song's one scene at all, so contentOf() returns null for it
// every tick: normal playback is silent for t1, unconditionally, matching the owner's exact
// complaint ("not yet placed in any scene at all"). t2 IS slotted (via a real clip in t2.clips,
// distinct from t2's own live notes) so normal song playback has something audible to sanity-check
// the measurement pipeline against, and so Stream CH's "isolation" claim (audition silences every
// OTHER track) has something real to prove silent.
//
// Note duration is deliberately SHORT (6 steps, ~0.7s of actual sound incl. release) rather than
// held the whole loop: Tone.js schedules a PolySynth's attack/release as real AudioContext-time
// automation at trigger time — Tone.Transport.stop() (what engine.ts's stop()/stopAudition() call)
// does not retroactively cancel an already-scheduled release, so a long-held note keeps ringing out
// on its own clock regardless of transport state. A short note means every phase's own trigger has
// fully decayed well before the next phase's measurement, so cross-phase measurements can't pick up
// a previous phase's leftover tail — this is a test-fixture concern, not an engine bug (the SAME
// characteristic applies to normal engine.stop(), unrelated to this stream).
async function buildDoc() {
  const { INIT_SYNTH, defaultEffectChain } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const synth = { ...INIT_SYNTH, osc: 'sine', volume: -12, cutoff: 18000, resonance: 0.1, attack: 0.01, decay: 0.05, sustain: 1, release: 0.1 }
  const chain = defaultEffectChain()
  const heldNote = (id, pitch) => ({ id, pitch, start: 0, duration: 6, velocity: 0.8, chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 })
  return {
    formatVersion: '0.10', bpm: 120, loopBars: 2, selectedTrack: 't1', media: [], groups: [],
    tracks: [
      {
        id: 't1', name: 't1', color: '#61afef', kind: 'synth', synth: { ...synth },
        notes: [heldNote('t1n1', T1_LIVE_PITCH)], // t1's OWN live content — "the clip open in NoteView"
        clips: [], hits: [], laneSamples: {}, effects: [...chain], lanes: [], shuffleAmount: 0, shuffleGrid: 1,
      },
      {
        id: 't2', name: 't2', color: '#e5c07b', kind: 'synth', synth: { ...synth },
        notes: [], // t2's live content is deliberately empty — everything it plays comes from its clip
        clips: [{ id: 'c2', notes: [heldNote('t2n1', T2_CLIP_PITCH)], hits: [], automation: [], loop: null, signature: null }],
        hits: [], laneSamples: {}, effects: [...chain], lanes: [], shuffleAmount: 0, shuffleGrid: 1,
      },
    ],
    scenes: [{ id: 'sceneA', slots: { t2: 'c2' } }], // t1 is NOT slotted — unmapped, per the bug scenario
    song: [{ scene: 'sceneA', bars: 2 }],
  }
}

async function startProject(doc) {
  const { serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p24ch-'))
  const beatPath = join(proj, 'project.beat')
  writeFileSync(beatPath, serialize(doc))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')
  return startDaemon({ filePath: beatPath, port: 0 })
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

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
  const errors = []
  const results = []
  const check = (name, cond, detail) => {
    results.push({ name, pass: !!cond, detail })
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
  }

  const doc = await buildDoc()
  const daemon = await startProject(doc)
  const page = await browser.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))

  try {
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, undefined, { timeout: 12000 })

    // Record `secs` seconds of the live master output, decode, and hand back both the raw decode
    // (for Goertzel) and the metrics.analyze() summary (broad RMS/spectral sanity, reusing the same
    // deterministic-metrics infra the CLI's `beat lint`/parity harness use).
    async function record(secs) {
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

    // Notes are short (see buildDoc's comment) so each phase's own trigger has fully decayed
    // before the next phase measures — `settle` gives real wall-clock time for that natural decay
    // (well past attack+decay+sustain+release, ~0.7s total) between phases, independent of
    // whatever DOM/network overhead already elapsed.
    const settle = () => sleep(900)

    // ==========================================================================================
    // T1 — baseline: normal song playback is silent for t1 (the bug), audible for t2 (sanity check)
    console.log('\n[T1] baseline: normal song playback — t1 (unmapped) silent, t2 (slotted) audible...')
    await page.evaluate(() => window.__engine.play())
    await sleep(200)
    const baseline = await record(0.5)
    await page.evaluate(() => window.__engine.stop())
    const baseT1Mag = goertzelMag(steadyChunk(baseline.decoded, 0.1, 0.25), baseline.decoded.sampleRate, T1_FREQ)
    const baseT2Mag = goertzelMag(steadyChunk(baseline.decoded, 0.1, 0.25), baseline.decoded.sampleRate, T2_FREQ)
    console.log(`  rmsDbfs=${baseline.metrics.rmsDbfs.toFixed(1)}  t1@${T1_FREQ.toFixed(1)}Hz mag=${baseT1Mag.toFixed(4)}  t2@${T2_FREQ.toFixed(1)}Hz mag=${baseT2Mag.toFixed(4)}`)
    check('T1a: t1 live content is inaudible during normal song playback (the bug)', baseT1Mag < 0.02, `mag=${baseT1Mag.toFixed(4)}`)
    check('T1b: t2 (properly slotted) IS audible during normal song playback (fixture sanity)', baseT2Mag > 0.05, `mag=${baseT2Mag.toFixed(4)}`)
    await settle()

    // ==========================================================================================
    // T2 — select t1, click "Preview clip", confirm real measured audio at t1's own frequency
    console.log('\n[T2] select t1, click "Preview clip"...')
    await page.click('.arr-row:has(.arr-track-name:text-is("t1")) .arr-track-select')
    await page.waitForFunction(() => window.__store.getState().selectedTrackId === 't1', undefined, { timeout: 5000 })
    const btnSel = '[data-action="audition-clip"]'
    await page.waitForSelector(btnSel, { timeout: 5000 })
    const initialLabel = await page.textContent(btnSel)
    check('T2a: "Preview clip" button is present and shows the idle label', initialLabel.includes('Preview clip'), `label="${initialLabel}"`)

    await page.click(btnSel)
    await page.waitForFunction(() => window.__store.getState().auditioningTrackId === 't1', undefined, { timeout: 5000 })
    await sleep(200)
    const auditionRecording = await record(0.5)
    const audT1Mag = goertzelMag(steadyChunk(auditionRecording.decoded, 0.1, 0.25), auditionRecording.decoded.sampleRate, T1_FREQ)
    const audT2Mag = goertzelMag(steadyChunk(auditionRecording.decoded, 0.1, 0.25), auditionRecording.decoded.sampleRate, T2_FREQ)
    console.log(`  rmsDbfs=${auditionRecording.metrics.rmsDbfs.toFixed(1)}  t1@${T1_FREQ.toFixed(1)}Hz mag=${audT1Mag.toFixed(4)}  t2@${T2_FREQ.toFixed(1)}Hz mag=${audT2Mag.toFixed(4)}`)
    check('T2b: auditioning t1 produces real audible output at t1\'s own note frequency', audT1Mag > 0.03, `mag=${audT1Mag.toFixed(4)} (baseline was ${baseT1Mag.toFixed(4)})`)
    check('T2c: auditioning is a clear step up from the (silent) baseline, not noise', audT1Mag > baseT1Mag * 5, `audition=${audT1Mag.toFixed(4)} baseline=${baseT1Mag.toFixed(4)}`)

    // ==========================================================================================
    // T3 — isolation: t2's normally-audible content is silent while t1 is being auditioned
    check('T3: t2 (normally audible in song mode) is SILENT while t1 auditions — real isolation', audT2Mag < 0.02, `mag=${audT2Mag.toFixed(4)} (was ${baseT2Mag.toFixed(4)} in normal playback)`)
    await settle()

    // ==========================================================================================
    // T4 — clean stop: click again, confirm state + transport actually stop
    console.log('\n[T4] click "Preview clip" again to stop...')
    // T2's audition never stopped — it's a LOOPING transport (t.loop=true), so it's still cycling
    // through t1's note every doc.loopBars bars this whole time; `settle()` only slept the TEST
    // process, it didn't pause playback. auditioningTrackId is therefore still 't1' and the button
    // still reads "Stop" — clicking it here is a real, live stop of an in-progress audition, not a
    // "nothing was playing anyway" no-op. (A prior version of this script re-clicked to "re-trigger"
    // first, which actually TOGGLED THE AUDITION OFF — since it was already on — and then hung
    // waiting for a state transition that could never happen.)
    const activeLabel = await page.textContent(btnSel)
    check('T4a: button shows the active/stop label while auditioning', activeLabel.includes('Stop'), `label="${activeLabel}"`)
    await page.click(btnSel)
    await page.waitForFunction(() => window.__store.getState().auditioningTrackId === null, undefined, { timeout: 5000 })
    await page.waitForFunction(() => window.__store.getState().currentStep === -1, undefined, { timeout: 5000 })
    const stoppedLabel = await page.textContent(btnSel)
    check('T4b: button reverts to the idle label after stopping', stoppedLabel.includes('Preview clip'), `label="${stoppedLabel}"`)
    // Wait past the just-stopped note's own natural decay (~0.7s — see buildDoc's comment: a
    // scheduled release isn't retroactively cancelled by Transport.stop(), same as normal
    // engine.stop() for any synth-kind track) before confirming silence — a fair test of "stop
    // leaves it quiet," not a demand for an instantaneous hard cut nothing in this codebase does.
    await sleep(900)
    const stopped = await record(0.4)
    const stoppedMag = goertzelMag(steadyChunk(stopped.decoded, 0.05, 0.25), stopped.decoded.sampleRate, T1_FREQ)
    check('T4c: no audio plays well after a clean stop (no retrigger on the next would-be loop pass)', stoppedMag < 0.02, `mag=${stoppedMag.toFixed(4)}`)
    await settle()

    // ==========================================================================================
    // T5 — mutual exclusion: starting normal playback stops an in-progress audition
    console.log('\n[T5] start audition, then press the main transport Play button...')
    await page.click(btnSel)
    await page.waitForFunction(() => window.__store.getState().auditioningTrackId === 't1', undefined, { timeout: 5000 })
    await page.click('.play-btn')
    await page.waitForFunction(() => window.__store.getState().playing === true, undefined, { timeout: 5000 })
    const auditioningAfterPlay = await page.evaluate(() => window.__store.getState().auditioningTrackId)
    check('T5a: pressing the main Play button clears an in-progress audition', auditioningAfterPlay === null, `auditioningTrackId=${auditioningAfterPlay}`)
    const buttonAfterPlay = await page.textContent(btnSel)
    check('T5b: the clip button reverts to idle once normal playback wins', buttonAfterPlay.includes('Preview clip'), `label="${buttonAfterPlay}"`)
    await page.evaluate(() => window.__engine.stop())

    if (errors.length) check('no page errors during the whole run', false, errors.join(' | '))
    else check('no page errors during the whole run', true)
  } finally {
    await page.close()
    await daemon.close()
    preview.kill()
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`)
  if (failed.length) {
    console.log('FAILED:')
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ' — ' + f.detail : ''}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
