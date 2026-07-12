#!/usr/bin/env node
// Phase 23 Stream BF verification — the three "meaningfully bigger lift" custom-DSP effects
// research 17 §5 deferred past Stream AC's build-next-four: Grain Delay, Vinyl Distortion,
// Resonators. Two parts, same conventions prior engine-verification streams established:
//
//   GUI CHECK   drives the REAL Effect Chain panel (SynthPanel.tsx) over headless Chromium against
//               a real `beat daemon`: confirms the add-effect dropdown lists all three new types,
//               adds "resonator" via the real dropdown+button click, confirms the file gains the
//               `effect resonator resonator` line and the DOM shows the new row — proving these are
//               genuine EffectType chain members reachable from the production GUI, not just
//               internal plumbing.
//
//   AUDIO       drives the real engine (window.__bridge.postEdit, the same production edit path
//               every SynthPanel.tsx knob's onChange calls) and records+analyzes real rendered
//               audio (src/metrics' analyze(), the tool every prior engine-verification stream
//               uses):
//     GRAIN DELAY       a short A3 (220Hz) blip, delay off vs on (time=0.3s, feedback=0, pitch=+7
//                       semitones, one isolated repeat). Confirms (a) a second energy peak appears
//                       ~grainDelayTime after the original — real repetition, not a no-op — AND
//                       (b) that repeat's spectral content is dominated by the pitch-shifted
//                       frequency (220*2^(7/12) ≈ 329.6Hz), not the original 220Hz — real granular
//                       pitch-shift character, not a plain unpitched echo.
//     VINYL DISTORTION  (a) NOISE FLOOR: a silent take (no note), vinylNoiseLevel=0 vs 0.8 — RMS
//                       measurably rises even with nothing "playing" (the noise bed is a
//                       continuous background layer, like real vinyl surface noise). (b) HARMONIC
//                       DISTORTION: a quiet held pure sine, drive=0 vs drive=1 — Goertzel harmonic-
//                       to-fundamental ratio (the same THD-style proxy Stream AC's Saturator test
//                       uses) rises measurably.
//     RESONATORS        broadband noise excitation (the synth's own noiseLevel=1 layer) through the
//                       bank, off vs on (resonatorFreq=220, chord=fifths, Q=40, mix=1). Confirms
//                       energy at the bank's 5 tuned frequencies rises sharply RELATIVE to energy
//                       at off-tuned control frequencies — real spectral energy concentration at
//                       the tuned frequencies, not just a level change.
//
// Usage: node ui/verify-phase23-stream-bf.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8623
const PREVIEW_PORT = 5941

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
const effectLines = (text) => text.split('\n').filter((l) => l.trim().startsWith('effect '))

async function analyzeBase64Wav(b64) {
  const { decodeWav } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const bytes = Buffer.from(b64, 'base64')
  return decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
}

// ---- shared measurement helpers (same techniques ui/verify-phase22-stream-ac.mjs established) ---

function envelope(samples, sampleRate, winSeconds) {
  const win = Math.max(4, Math.round(sampleRate * winSeconds))
  const hop = Math.max(1, Math.round(win / 4))
  const env = []
  for (let i = 0; i + win <= samples.length; i += hop) {
    let s = 0
    for (let j = 0; j < win; j++) s += samples[i + j] * samples[i + j]
    env.push(Math.sqrt(s / win))
  }
  return { env, hopSeconds: hop / sampleRate }
}
function peakTime(env, hopSeconds, fromSec, toSec) {
  const a = Math.max(0, Math.floor(fromSec / hopSeconds))
  const b = Math.min(env.length, Math.ceil(toSec / hopSeconds))
  let best = -1, bestT = 0
  for (let i = a; i < b; i++) {
    if (env[i] > best) {
      best = env[i]
      bestT = i * hopSeconds
    }
  }
  return { time: bestT, value: best }
}
// Goertzel single-bin magnitude estimate — exact energy AT one frequency, without a full FFT.
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
function harmonicRatio(samples, sampleRate, f0) {
  const m1 = goertzelMag(samples, sampleRate, f0)
  let sumSq = 0
  for (const h of [2, 3, 4, 5]) sumSq += goertzelMag(samples, sampleRate, f0 * h) ** 2
  return m1 > 1e-9 ? Math.sqrt(sumSq) / m1 : 0
}
function mono(decoded) {
  const n = decoded.channels[0].length
  const m = new Float64Array(n)
  for (const ch of decoded.channels) for (let i = 0; i < n; i++) m[i] += ch[i] / decoded.channels.length
  return m
}
function rmsOf(samples) {
  let s = 0
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i]
  return Math.sqrt(s / Math.max(1, samples.length))
}

// ---- doc builders ---------------------------------------------------------------------------

let BASE_SYNTH
let DEFAULT_EFFECT_CHAIN
async function baseSynth() {
  if (!BASE_SYNTH) {
    const { INIT_SYNTH, defaultEffectChain } = await import(join(repoRoot, 'dist/src/core/index.js'))
    BASE_SYNTH = { ...INIT_SYNTH, osc: 'sine', volume: -8, cutoff: 8000, resonance: 0.7, attack: 0.001, decay: 0.05, sustain: 0, release: 0.05, pan: 0 }
    DEFAULT_EFFECT_CHAIN = defaultEffectChain()
  }
  return BASE_SYNTH
}

// GRAIN DELAY: a short blip late in a long loop (record()'s ~250ms settle wait means t=0 content
// can't be captured reliably — same reasoning as AC's ping-pong doc), grainDelay already present
// in the chain (mix starts at 0 = bypassed; the OFF/ON comparison toggles the params, not the
// chain membership, matching how every other insert test in this repo works).
async function grainDelayDoc() {
  const base = await baseSynth()
  return {
    formatVersion: '0.9', bpm: 120, loopBars: 4, selectedTrack: 't1', media: [], scenes: [], song: null, groups: [],
    tracks: [{
      id: 't1', name: 't1', color: '#e06c75', kind: 'synth',
      // Fast attack/decay, zero sustain: a short "blip" so the delay's isolated repeat is clearly
      // separated in time from the original's own decay tail.
      synth: { ...base, attack: 0.002, decay: 0.06, sustain: 0, release: 0.05 },
      notes: [{ id: 'n1', pitch: 57, start: 8, duration: 1, velocity: 0.95, chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 }], // A3 = 220Hz, at t=1.0s
      clips: [], laneSamples: {}, hits: [],
      effects: [...DEFAULT_EFFECT_CHAIN, { id: 'grd', type: 'grainDelay', enabled: true }],
      lanes: [], shuffleAmount: 0, shuffleGrid: 1,
    }],
  }
}

// VINYL DISTORTION — noise-floor half: NO note at all (pure silence upstream), vinylMix=1 so the
// noise bed's own continuous output reaches the master bus regardless of what's "playing".
async function vinylNoiseDoc() {
  const base = await baseSynth()
  return {
    formatVersion: '0.9', bpm: 120, loopBars: 2, selectedTrack: 't1', media: [], scenes: [], song: null, groups: [],
    tracks: [{
      id: 't1', name: 't1', color: '#98c379', kind: 'synth',
      synth: { ...base, vinylDrive: 0, vinylMix: 1 },
      notes: [], clips: [], laneSamples: {}, hits: [],
      effects: [...DEFAULT_EFFECT_CHAIN, { id: 'vny', type: 'vinylDistortion', enabled: true }],
      lanes: [], shuffleAmount: 0, shuffleGrid: 1,
    }],
  }
}

// VINYL DISTORTION — harmonic-distortion half: same quiet-held-pure-sine methodology as Stream
// AC's Saturator test (minimal natural harmonic content, so any harmonic energy the high-drive
// take shows is genuinely the shaper's added nonlinearity).
async function vinylDriveDoc() {
  const base = await baseSynth()
  return {
    formatVersion: '0.9', bpm: 120, loopBars: 4, selectedTrack: 't1', media: [], scenes: [], song: null, groups: [],
    tracks: [{
      id: 't1', name: 't1', color: '#c678dd', kind: 'synth',
      synth: { ...base, osc: 'sine', volume: -34, cutoff: 18000, resonance: 0.1, attack: 0.02, decay: 0.05, sustain: 1, release: 0.1, vinylNoiseLevel: 0, vinylMix: 1 },
      notes: [{ id: 'n1', pitch: 57, start: 0, duration: 62, velocity: 0.6, chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 }],
      clips: [], laneSamples: {}, hits: [],
      effects: [...DEFAULT_EFFECT_CHAIN, { id: 'vny', type: 'vinylDistortion', enabled: true }],
      lanes: [], shuffleAmount: 0, shuffleGrid: 1,
    }],
  }
}

// RESONATORS: broadband excitation via the synth's own noise layer (noiseLevel=1), held the whole
// loop, so the tuned bank has energy across the spectrum to selectively concentrate.
async function resonatorDoc() {
  const base = await baseSynth()
  return {
    formatVersion: '0.9', bpm: 120, loopBars: 4, selectedTrack: 't1', media: [], scenes: [], song: null, groups: [],
    tracks: [{
      id: 't1', name: 't1', color: '#61afef', kind: 'synth',
      synth: { ...base, volume: -18, noiseLevel: 1, sustain: 1, decay: 0.05, release: 0.1, resonatorFreq: 220, resonatorChord: 'fifths', resonatorQ: 40, resonatorMix: 0 },
      notes: [{ id: 'n1', pitch: 57, start: 0, duration: 62, velocity: 0.9, chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 }],
      clips: [], laneSamples: {}, hits: [],
      effects: [...DEFAULT_EFFECT_CHAIN, { id: 'rez', type: 'resonator', enabled: true }],
      lanes: [], shuffleAmount: 0, shuffleGrid: 1,
    }],
  }
}

// GUI check's simple starting project (default 4-entry chain, elided — same fixture shape as
// verify-phase22-stream-aa.mjs's PROJECT_TEXT).
const GUI_PROJECT_TEXT = `format_version 0.10
bpm 120
loop_bars 4
selected_track lead

track lead Lead #c678dd synth
  synth
    osc sawtooth
    volume -8
    cutoff 3000
    resonance 0.8
    attack 0.01
    decay 0.05
    sustain 1
    release 0.1
    pan 0
  note n1 45 0 8 0.9
`

// ---- daemon/browser plumbing ------------------------------------------------------------------

async function startProject(doc) {
  const { serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p23bf-'))
  const beatPath = join(proj, 'project.beat')
  writeFileSync(beatPath, serialize(doc))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')
  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  return { daemon, proj, beatPath }
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })
  await baseSynth()

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

  async function withGroup(doc, run) {
    const { daemon, proj, beatPath } = await startProject(doc)
    const page = await browser.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine && window.__bridge, { timeout: 12000 })
    try {
      await run(page, proj, beatPath)
    } finally {
      await page.close()
      await daemon.close()
    }
  }

  async function setParam(page, path, value) {
    await page.evaluate(({ path, value }) => window.__bridge.postEdit(path, value), { path, value })
    await page.waitForFunction(
      ({ path, value }) => {
        const doc = window.__store.getState().doc
        if (!doc) return false
        const [trackId, key] = path.split('.')
        const t = doc.tracks.find((t) => t.id === trackId)
        return t && String(t.synth[key]) === String(value)
      },
      { path, value },
      { timeout: 8000 },
    )
    await sleep(150)
  }

  async function record(page, secs) {
    const b64 = await page.evaluate(async (secs) => {
      window.__engine.stop()
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
    return analyzeBase64Wav(b64)
  }

  try {
    // ============================================================================================
    console.log('\n[GUI] add-effect dropdown lists all three new types; adding "resonator" via the real Effect Chain panel...')
    {
      const { parse } = await import(join(repoRoot, 'dist/src/core/index.js'))
      const guiDoc = parse(GUI_PROJECT_TEXT)
      await withGroup(guiDoc, async (page, proj, beatPath) => {
        await page.setViewportSize({ width: 1440, height: 960 })
        await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })
        await page.click('[data-pane-tab="device"]')
        await page.waitForSelector('[data-testid="effect-chain"]', { timeout: 5000 })

        const optionValues = await page.$$eval('[data-effect-add-type] option', (els) => els.map((el) => el.value))
        for (const t of ['grainDelay', 'vinylDistortion', 'resonator']) {
          if (!optionValues.includes(t)) throw new Error(`[GUI] add-effect dropdown is missing "${t}" — got: ${optionValues.join(',')}`)
        }
        console.log(`  [GUI] add-effect dropdown options: ${optionValues.join(', ')}`)

        await page.selectOption('[data-effect-add-type]', 'resonator')
        await page.click('[data-effect-add]')
        await pollUntil(async () => effectLines(readFileSync(beatPath, 'utf8')).length === 5, 'file to grow to 5 effect lines after add')
        const lines = effectLines(readFileSync(beatPath, 'utf8'))
        if (!lines[4].startsWith('  effect resonator resonator')) throw new Error(`[GUI] expected the 5th line to be the new resonator instance, got: ${lines[4]}`)
        const rowType = await pollUntil(async () => {
          const val = await page.$eval('[data-effect-row="resonator"]', (el) => el.getAttribute('data-effect-type')).catch(() => null)
          return val === 'resonator' ? val : false
        }, 'GUI row to show the new resonator instance')
        console.log(`  [GUI] PASS: added "resonator" via the real dropdown+button — file gained "effect resonator resonator", DOM row data-effect-type="${rowType}"`)
        git(proj, 'add', '-A')
        git(proj, 'commit', '-q', '-m', 'after gui add')
      })
    }

    // ============================================================================================
    console.log('\n[GRAIN DELAY] one A3 blip, off vs on (time=0.3s, feedback=0, pitch=+7 semitones)...')
    await withGroup(await grainDelayDoc(), async (page) => {
      const off = await record(page, 2.6)
      await setParam(page, 't1.grainDelayTime', '0.3')
      await setParam(page, 't1.grainDelayFeedback', '0')
      await setParam(page, 't1.grainDelaySize', '0.05')
      await setParam(page, 't1.grainDelayPitch', '7')
      await setParam(page, 't1.grainDelayMix', '1')
      const on = await record(page, 2.6)

      const winSec = 0.006
      const off1 = mono(off)
      const on1 = mono(on)
      const eOff = envelope(off1, off.sampleRate, winSec)
      const eOn = envelope(on1, on.sampleRate, winSec)

      // Empirically find the blip's actual onset in the (delay-bypassed) OFF take.
      const offOnset = peakTime(eOff.env, eOff.hopSeconds, 0, 2.6)
      const tNote = offOnset.time
      console.log(`  off-take note onset (empirical): t=${tNote.toFixed(3)}s`)
      const offFloor = Math.max(peakTime(eOff.env, eOff.hopSeconds, 0, Math.max(0.05, tNote - 0.15)).value, 1e-9)

      // Search for the repeat peak after the original has had time to decay, around tNote +
      // grainDelayTime. (The ORIGINAL blip's own reference measurement below reads from the OFF
      // take at tNote instead of re-locating it inside the ON take — the ON/OFF takes are two
      // SEPARATE recordWav() calls, and real scheduling/async jitter between them (same subtlety
      // ui/verify-phase22-stream-ac.mjs's own comments flag) can shift the ON take's blip by tens
      // of ms relative to the OFF take's; re-detecting it in a narrow ON-take window is fragile.
      // The OFF take has no such problem — delay is fully bypassed there, so its own onset IS the
      // clean, undelayed reference.)
      const repeat = peakTime(eOn.env, eOn.hopSeconds, tNote + 0.2, tNote + 2.4)
      console.log(`  repeat@${repeat.time.toFixed(3)}s (${repeat.value.toExponential(2)})  (expected ~${(tNote + 0.3).toFixed(3)}s, grainDelayTime=0.3s)`)
      if (!(repeat.value > offFloor * 6)) throw new Error(`[GRAIN DELAY] repeat peak (${repeat.value.toExponential(2)}) is not well above the silence floor (${offFloor.toExponential(2)}) — no real repetition detected`)
      const offsetSec = repeat.time - tNote
      if (!(offsetSec > 0.2 && offsetSec < 0.5)) throw new Error(`[GRAIN DELAY] repeat offset ${offsetSec.toFixed(3)}s is not close to grainDelayTime (0.3s)`)

      // Pitch-shift character: Goertzel-measure a ~60ms window around the repeat's peak (ON take)
      // and compare energy at 220Hz (original pitch) vs 220*2^(7/12)≈329.6Hz (grainDelayPitch=+7
      // semitones) — should be dominated by the SHIFTED frequency. Compared against the SAME
      // measurement on the clean, undelayed blip's own window in the OFF take (a pure A3 should
      // show almost no energy at 329.6Hz there).
      const chunkAround = (samples, sr, centerSec, lenSec) => {
        const a = Math.max(0, Math.round((centerSec - lenSec / 2) * sr))
        const b = Math.min(samples.length, a + Math.round(lenSec * sr))
        return samples.slice(a, b)
      }
      const f0 = 220 // A3
      const shifted = f0 * Math.pow(2, 7 / 12) // ≈329.63Hz
      const origChunk = chunkAround(off1, off.sampleRate, tNote, 0.06)
      const repeatChunk = chunkAround(on1, on.sampleRate, repeat.time, 0.06)
      const origFund = goertzelMag(origChunk, off.sampleRate, f0)
      const origRatio = goertzelMag(origChunk, off.sampleRate, shifted) / Math.max(1e-9, origFund)
      const repeatRatio = goertzelMag(repeatChunk, on.sampleRate, shifted) / Math.max(1e-9, goertzelMag(repeatChunk, on.sampleRate, f0))
      console.log(`  shifted(329.6Hz)/fundamental(220Hz) energy ratio: original ${origRatio.toFixed(3)}  ->  repeat ${repeatRatio.toFixed(3)}`)
      if (!(origFund > offFloor * 3)) throw new Error(`[GRAIN DELAY] the "original" reference window (OFF take @ t=${tNote.toFixed(3)}s) doesn't look like it captured real signal (fundamental magnitude ${origFund.toExponential(2)} vs silence floor ${offFloor.toExponential(2)}) — the onset/window logic needs revisiting`)
      if (!(repeatRatio > origRatio * 2 && repeatRatio > 0.3)) throw new Error(`[GRAIN DELAY] the repeat's spectral content is not measurably dominated by the pitch-shifted frequency (original ratio ${origRatio.toFixed(3)}, repeat ratio ${repeatRatio.toFixed(3)})`)
      console.log(`  [GRAIN DELAY] PASS: a real repeat lands ${offsetSec.toFixed(3)}s after the original (~grainDelayTime), carrying real pitch-shifted content (not a plain unpitched echo)`)
    })

    // ============================================================================================
    console.log('\n[VINYL DISTORTION — noise floor] silence (no note), noiseLevel=0 vs 0.8...')
    await withGroup(await vinylNoiseDoc(), async (page) => {
      await setParam(page, 't1.vinylNoiseLevel', '0')
      const off = await record(page, 2.0)
      await setParam(page, 't1.vinylNoiseLevel', '0.8')
      const on = await record(page, 2.0)
      const rmsOff = rmsOf(mono(off))
      const rmsOn = rmsOf(mono(on))
      console.log(`  RMS (silence, no note playing): noiseLevel=0 ${rmsOff.toExponential(3)}  ->  noiseLevel=0.8 ${rmsOn.toExponential(3)}`)
      if (!(rmsOn > rmsOff * 4 && rmsOn > 1e-4)) throw new Error(`[VINYL DISTORTION] noise floor did not measurably rise with vinylNoiseLevel (off ${rmsOff.toExponential(3)}, on ${rmsOn.toExponential(3)})`)
      console.log('  [VINYL DISTORTION — noise floor] PASS: a real, continuous noise bed is added even with nothing else playing')
    })

    // ============================================================================================
    console.log('\n[VINYL DISTORTION — harmonic distortion] quiet held sine (A3, 220Hz), drive=0 vs drive=1...')
    await withGroup(await vinylDriveDoc(), async (page) => {
      await setParam(page, 't1.vinylDrive', '0')
      const lowDrive = await record(page, 2.5)
      await setParam(page, 't1.vinylDrive', '1')
      const highDrive = await record(page, 2.5)
      const chunk = (decoded) => {
        const startSec = 1.0, lenSec = 0.8
        const a = Math.round(startSec * decoded.sampleRate)
        const b = Math.round((startSec + lenSec) * decoded.sampleRate)
        return mono(decoded).slice(a, b)
      }
      const f0 = 220
      const ratioLow = harmonicRatio(chunk(lowDrive), lowDrive.sampleRate, f0)
      const ratioHigh = harmonicRatio(chunk(highDrive), highDrive.sampleRate, f0)
      console.log(`  harmonic/fundamental ratio: drive=0 ${ratioLow.toFixed(4)}  ->  drive=1 ${ratioHigh.toFixed(4)}`)
      if (!(ratioHigh > ratioLow * 2 && ratioHigh - ratioLow > 0.02)) throw new Error(`[VINYL DISTORTION] harmonic content did not measurably increase with drive (low ${ratioLow.toFixed(4)}, high ${ratioHigh.toFixed(4)})`)
      console.log('  [VINYL DISTORTION — harmonic distortion] PASS: driving the shaper harder measurably adds harmonic content')
    })

    // ============================================================================================
    console.log('\n[RESONATORS] broadband noise excitation, off vs on (freq=220, chord=fifths, Q=40, mix=1)...')
    await withGroup(await resonatorDoc(), async (page) => {
      await setParam(page, 't1.resonatorMix', '0')
      const off = await record(page, 2.5)
      await setParam(page, 't1.resonatorFreq', '220')
      await setParam(page, 't1.resonatorChord', 'fifths')
      await setParam(page, 't1.resonatorQ', '40')
      await setParam(page, 't1.resonatorMix', '1')
      const on = await record(page, 2.5)

      const chunk = (decoded) => {
        const startSec = 1.0, lenSec = 1.2
        const a = Math.round(startSec * decoded.sampleRate)
        const b = Math.round((startSec + lenSec) * decoded.sampleRate)
        return mono(decoded).slice(a, b)
      }
      // fifths offsets [0,7,12,19,24] around 220Hz.
      const tuned = [0, 7, 12, 19, 24].map((semi) => 220 * Math.pow(2, semi / 12))
      // Off-tuned control frequencies: geometric midpoints between consecutive tuned frequencies.
      const control = []
      for (let i = 0; i < tuned.length - 1; i++) control.push(Math.sqrt(tuned[i] * tuned[i + 1]))

      const energyAt = (samples, sr, freqs) => freqs.reduce((sum, f) => sum + goertzelMag(samples, sr, f), 0) / freqs.length
      const offChunk = chunk(off)
      const onChunk = chunk(on)
      const tunedOff = energyAt(offChunk, off.sampleRate, tuned)
      const controlOff = energyAt(offChunk, off.sampleRate, control)
      const tunedOn = energyAt(onChunk, on.sampleRate, tuned)
      const controlOn = energyAt(onChunk, on.sampleRate, control)
      const ratioOff = tunedOff / Math.max(1e-9, controlOff)
      const ratioOn = tunedOn / Math.max(1e-9, controlOn)
      console.log(`  tuned/control energy ratio: off ${ratioOff.toFixed(3)}  ->  on ${ratioOn.toFixed(3)}`)
      console.log(`  tuned freqs (Hz): ${tuned.map((f) => f.toFixed(1)).join(', ')}`)
      if (!(ratioOn > ratioOff * 2)) throw new Error(`[RESONATORS] energy did not measurably concentrate at the tuned frequencies (off ratio ${ratioOff.toFixed(3)}, on ratio ${ratioOn.toFixed(3)})`)
      console.log('  [RESONATORS] PASS: engaging the bank measurably concentrates energy at the tuned frequencies relative to off-tuned control frequencies')
    })

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL PHASE 23 STREAM BF CHECKS PASSED ================')
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error('\nPHASE 23 STREAM BF VERIFY FAILED:', err)
  process.exit(1)
})
