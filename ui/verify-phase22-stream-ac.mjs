#!/usr/bin/env node
// Phase 22 Stream AC verification — the four new extended-FX-arsenal inserts (research 17 §5):
// Ping Pong Delay, Beat Repeat, the exposed Chorus-Ensemble/Phaser-Flanger inserts, Saturator.
// Drives the REAL live GUI engine (ui/src/audio/engine.ts) over a headless-Chromium tab, same
// harness/convention as ui/verify-phase18-lfo-depth.mjs, but sets every param through the daemon's
// real HTTP /edit route rather than an in-page setDoc() — via window.__bridge.postEdit (the exact
// function every SynthPanel.tsx knob's onChange calls), so each edit is a real optimistic-update-
// then-POST-/edit round trip through the daemon, not a directly-injected document. (A raw Node
// fetch straight to /edit, bypassing the GUI, was tried first and doesn't work here: the daemon
// deliberately never SSE-echoes its own /edit writes back — see daemon.ts's "echo of our own
// write" guard — so a page that didn't itself originate the edit has no way to hear about it.)
// Measures the RECORDED AUDIO for each effect, not "the code path ran":
//
//   PING PONG DELAY   a single short blip on one synth track. Off (mix=0) vs on (mix=1,
//                      crossFeed=1, time=0.15s): confirm the "on" take's LEFT channel peaks near
//                      t=pingPongTime and the RIGHT channel's first peak arrives ~pingPongTime
//                      LATER than the left's — energy in both channels, offset in time, not
//                      simultaneous (which a plain non-alternating delay would produce instead).
//   BEAT REPEAT       a drum track with one kick hit captured just before a beatRepeatGate window
//                      at the end of a bar. Off (gate=0, one onset) vs on (grid=1, gate=4, one
//                      onset per 16th-step for 4 steps): confirm the "on" take has 5 onsets, each
//                      ~stepSeconds apart — the expected grid cadence.
//   CHORUS / PHASER    a held sawtooth note. Off vs on for each: confirm the recorded spectral
//                      centroid (src/metrics' analyze(), the same tool prior engine streams use)
//                      varies measurably MORE over time when the insert is on — the audible
//                      signature of a swept comb/all-pass filter.
//   SATURATOR          a held, quiet pure sine tone (minimal natural harmonic content). Low drive
//                      vs high drive: Goertzel-estimate the energy at the fundamental and at its
//                      2nd-5th harmonics; confirm the harmonic-to-fundamental ratio rises
//                      substantially with drive — real added harmonic content, not a level change.
//
// Usage: node ui/verify-phase22-stream-ac.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5931

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
  const { decodeWav } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const bytes = Buffer.from(b64, 'base64')
  return decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
}

// ---- shared measurement helpers -----------------------------------------------------------

// Short-window RMS envelope of ONE channel.
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

// The time (seconds) of an envelope's peak value, restricted to [fromSec, toSec).
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

// Onset detection: threshold-crossing marks each above-threshold REGION, then the onset time is
// the LOCAL PEAK within that region (not the crossing point) — closely-spaced repeats whose decay
// tails overlap the next hit's rising edge would otherwise smear the naive "first crossing" time
// by the width of that overlap; peak-picking within each region is far more stable for Beat
// Repeat's tightly-packed (one per 16th-step) transient trains.
function detectOnsets(samples, sampleRate, winSeconds, minGapSeconds) {
  const { env, hopSeconds } = envelope(samples, sampleRate, winSeconds)
  const peak = Math.max(...env, 1e-9)
  const threshold = peak * 0.25
  const onsets = []
  let wasAbove = false
  let regionStart = 0
  for (let i = 0; i <= env.length; i++) {
    const above = i < env.length && env[i] >= threshold
    if (above && !wasAbove) regionStart = i
    if (!above && wasAbove) {
      let bestI = regionStart
      for (let j = regionStart; j < i; j++) if (env[j] > env[bestI]) bestI = j
      const t = bestI * hopSeconds
      if (onsets.length === 0 || t - onsets[onsets.length - 1] >= minGapSeconds) onsets.push(t)
    }
    wasAbove = above
  }
  return onsets
}

async function centroidSeries(decoded) {
  const { analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const N = 4096
  const hop = 2048
  const series = []
  for (let start = 0; start + N <= decoded.channels[0].length; start += hop) {
    const chunk = decoded.channels.map((ch) => ch.slice(start, start + N))
    series.push(analyze(chunk, decoded.sampleRate).spectral.centroidHz)
  }
  return series
}
function seriesCV(series, trimFrac = 0.1) {
  const a = Math.floor(series.length * trimFrac)
  const core = series.slice(a, series.length - a).filter((v) => v > 1e-6)
  if (core.length < 4) return 0
  const mean = core.reduce((x, y) => x + y, 0) / core.length
  const varr = core.reduce((x, y) => x + (y - mean) * (y - mean), 0) / core.length
  return Math.sqrt(varr) / mean
}

// Goertzel single-bin magnitude estimate — exact energy AT one frequency, without a full FFT.
// `n` should span an integer-ish number of cycles of the frequencies under test to minimize
// spectral leakage (callers pick windows sized for the fundamental under test).
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
// Harmonic-to-fundamental energy ratio (a THD-style proxy): sqrt(sum(2nd..5th harmonic mags^2)) /
// fundamental mag, over a steady-state chunk of samples.
function harmonicRatio(samples, sampleRate, f0) {
  const m1 = goertzelMag(samples, sampleRate, f0)
  let sumSq = 0
  for (const h of [2, 3, 4, 5]) sumSq += goertzelMag(samples, sampleRate, f0 * h) ** 2
  return m1 > 1e-9 ? Math.sqrt(sumSq) / m1 : 0
}

// ---- doc builders ---------------------------------------------------------------------------

// Real core defaults (INIT_SYNTH) as the base, so every SYNTH_FIELDS key is present — spreading a
// hand-picked subset would leave the rest `undefined` and fail to serialize/parse.
let BASE_SYNTH
let DEFAULT_EFFECT_CHAIN

// Phase 22 Stream AA landed after this script was first written: every BeatTrack now needs an
// `effects` field, and `[]` means "explicitly emptied" (isDefaultEffectChain), NOT "use the
// default eq3/comp/distortion/bitcrush chain" — these fixtures want the latter, so every track
// below calls this (populated lazily by baseSynth(), which every fixture already awaits first)
// rather than a bare `[]`.
function defaultEffectChain() {
  return DEFAULT_EFFECT_CHAIN
}
async function baseSynth() {
  if (!BASE_SYNTH) {
    const { INIT_SYNTH, defaultEffectChain: coreDefaultEffectChain } = await import(join(repoRoot, 'dist/src/core/index.js'))
    BASE_SYNTH = { ...INIT_SYNTH, osc: 'sine', volume: -8, cutoff: 8000, resonance: 0.7, attack: 0.001, decay: 0.05, sustain: 0, release: 0.05, pan: 0 }
    DEFAULT_EFFECT_CHAIN = coreDefaultEffectChain()
  }
  return BASE_SYNTH
}

async function pingPongDoc() {
  const base = await baseSynth()
  return {
    // loopBars=4 (8s loop) with the note starting at step 8 (1.0s in) — record()'s ~250ms
    // play()->recordWav() settle wait means capture only starts ~0.25s into the transport, so a
    // note at step 0 would already be over (and any ping-pong echoes it triggers already decayed)
    // before the recording begins; starting the note 1s in gives comfortable margin, and the long
    // loop guarantees no loop-around repeat confuses the single-blip measurement below.
    formatVersion: '0.9', bpm: 120, loopBars: 4, selectedTrack: 't1', media: [], scenes: [], song: null, groups: [],
    tracks: [{
      id: 't1', name: 't1', color: '#e06c75', kind: 'synth',
      synth: { ...base },
      notes: [{ id: 'n1', pitch: 69, start: 8, duration: 1, velocity: 0.95, chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 }],
      clips: [], laneSamples: {}, hits: [], effects: defaultEffectChain(), lanes: [], shuffleAmount: 0, shuffleGrid: 1,
    }],
  }
}

async function beatRepeatDoc() {
  const base = await baseSynth()
  return {
    formatVersion: '0.9', bpm: 120, loopBars: 1, selectedTrack: 'drums', media: [], scenes: [], song: null, groups: [],
    tracks: [{
      id: 'drums', name: 'drums', color: '#e35d5d', kind: 'drums',
      // kickDecay well UNDER one 16th-step (0.125s @ 120bpm) so five consecutive-16th-step kicks
      // (the repeat cadence below) each fully decay to silence before the next one fires —
      // otherwise overlapping decay tails make onset-counting from the recorded audio ambiguous.
      synth: { ...base, kickTune: 55, kickPunch: 0.1, kickDecay: 0.05 },
      // ONE kick hit at step 11 — the last 16th-step BEFORE the 4-step gate window (steps 12-15)
      // that beatRepeatGate=4 opens at the end of the bar (see resolveBeatRepeat's doc comment in
      // engine.ts: gate window = the last `gate` steps of the bar). Captured slice = [11,12).
      hits: [{ id: 'h1', lane: 'kick', start: 11, velocity: 0.95 }],
      clips: [], laneSamples: {}, notes: [], effects: defaultEffectChain(), lanes: [], shuffleAmount: 0, shuffleGrid: 1,
    }],
  }
}

async function modDoc() {
  const base = await baseSynth()
  return {
    formatVersion: '0.9', bpm: 120, loopBars: 4, selectedTrack: 't1', media: [], scenes: [], song: null, groups: [],
    tracks: [{
      id: 't1', name: 't1', color: '#61afef', kind: 'synth',
      synth: { ...base, osc: 'sawtooth', volume: -6, cutoff: 6000, attack: 0.01, decay: 0.05, sustain: 1, release: 0.1 },
      notes: [{ id: 'n1', pitch: 57, start: 0, duration: 62, velocity: 0.85, chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 }], // holds the whole 4-bar loop
      clips: [], laneSamples: {}, hits: [], effects: defaultEffectChain(), lanes: [], shuffleAmount: 0, shuffleGrid: 1,
    }],
  }
}

async function saturatorDoc() {
  const base = await baseSynth()
  return {
    formatVersion: '0.9', bpm: 120, loopBars: 4, selectedTrack: 't1', media: [], scenes: [], song: null, groups: [],
    tracks: [{
      id: 't1', name: 't1', color: '#c678dd', kind: 'synth',
      // Quiet pure sine, held the whole loop, at a low enough amplitude that drive=0 (preGain=1
      // into the WaveShaper) sits deep in the analog curve's near-linear region — minimal natural
      // harmonic content — so any harmonic energy the high-drive take shows is genuinely the
      // saturator's added nonlinearity, not the oscillator's or a level difference.
      synth: { ...base, osc: 'sine', volume: -34, cutoff: 18000, resonance: 0.1, attack: 0.02, decay: 0.05, sustain: 1, release: 0.1, saturatorCurve: 'analog', saturatorMix: 1 },
      notes: [{ id: 'n1', pitch: 57, start: 0, duration: 62, velocity: 0.6, chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 }], // A3 = 220 Hz
      clips: [], laneSamples: {}, hits: [], effects: defaultEffectChain(), lanes: [], shuffleAmount: 0, shuffleGrid: 1,
    }],
  }
}

// ---- daemon/browser plumbing ------------------------------------------------------------------

async function startProject(doc) {
  const { serialize } = await import(join(repoRoot, 'dist/src/core/index.js'))
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p22ac-'))
  const beatPath = join(proj, 'project.beat')
  writeFileSync(beatPath, serialize(doc))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')
  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  return daemon
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

  // One daemon (+ one fresh page/engine) per test group — isolates each group's document/params
  // from the others and avoids a scheduled-but-not-yet-elapsed automation ramp from one recording
  // bleeding into the next (same reasoning ui/verify-phase18-lfo-depth.mjs documents).
  async function withGroup(doc, run) {
    const daemon = await startProject(doc)
    const page = await browser.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine && window.__bridge, { timeout: 12000 })
    try {
      await run(page)
    } finally {
      await page.close()
      await daemon.close()
    }
  }

  // Sets one field through the REAL GUI edit path (window.__bridge.postEdit — the exact function
  // every Knob/Control's onChange in SynthPanel.tsx calls): applies optimistically to the store,
  // then debounces a real POST to the daemon's /edit route. This is the "set params via the daemon
  // /edit route" the whole verification is anchored on — driven through the actual production
  // code path rather than a raw curl the GUI itself never issues (a raw curl also wouldn't work
  // here: the daemon deliberately does NOT SSE-broadcast its own /edit writes back to a page that
  // didn't initiate them — see daemon.ts's "echo of our own write" guard — so a page that didn't
  // originate the edit would simply never hear about it).
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
    await sleep(150) // let postEdit's 60ms debounce actually flush the POST /edit to the daemon
  }

  async function record(page, secs) {
    const b64 = await page.evaluate(async (secs) => {
      window.__engine.stop()
      await window.__engine.play()
      await new Promise((r) => setTimeout(r, 250)) // let the graph settle before capture
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
    // The note in pingPongDoc() starts at t=1.0s of transport time (not t=0) specifically so
    // record()'s ~250ms play()->recordWav() settle wait (recordWav() only captures from the
    // moment it's called, not from note-trigger) can't clip the blip or its echoes — see
    // pingPongDoc()'s comment. The EXACT recording-relative time the note lands at still isn't
    // pinned down precisely (real scheduling/async jitter on top of that 250ms), so rather than
    // hardcode an assumed offset, the "off" take is used to empirically FIND the note's actual
    // onset first, and every other window below is defined relative to that measured value.
    console.log('\n[PING PONG DELAY] one blip, off (mix=0) vs on (mix=1, crossFeed=1, time=0.3s)...')
    await withGroup(await pingPongDoc(), async (page) => {
      const off = await record(page, 2.6)
      await setParam(page, 't1.pingPongTime', '0.3')
      await setParam(page, 't1.pingPongFeedback', '0.5')
      await setParam(page, 't1.pingPongCrossFeed', '1')
      await setParam(page, 't1.pingPongMix', '1')
      const on = await record(page, 2.6)

      const winSec = 0.006
      const [L_off, R_off] = off.channels
      const [L_on, R_on] = on.channels
      const eL_off = envelope(L_off, off.sampleRate, winSec)
      const eR_off = envelope(R_off, off.sampleRate, winSec)
      const eL_on = envelope(L_on, on.sampleRate, winSec)
      const eR_on = envelope(R_on, on.sampleRate, winSec)

      // Find the note's actual onset in the (ping-pong-bypassed) OFF take: the single loudest
      // moment anywhere in the recording, searched broadly since the exact scheduling latency
      // isn't pinned down.
      const offOnset = peakTime(eL_off.env, eL_off.hopSeconds, 0, 2.6)
      const tNote = offOnset.time
      console.log(`  off-take note onset (empirical): t=${tNote.toFixed(3)}s`)

      // "Silence floor" reference: the OFF take's own peak well BEFORE that onset — whatever's
      // there is measurement/codec noise, not signal. Comparing the ON take's post-note peaks
      // against this pre-note floor (rather than across two separately-opus-encoded takes'
      // absolute noise floors, which can differ for encoder reasons unrelated to the effect) is
      // the robust comparison.
      const offFloor = Math.max(peakTime(eL_off.env, eL_off.hopSeconds, 0, Math.max(0.05, tNote - 0.15)).value, peakTime(eR_off.env, eR_off.hopSeconds, 0, Math.max(0.05, tNote - 0.15)).value, 1e-9)

      // The classic ping-pong signature: L's first strong peak (the direct tap — input feeds
      // delayL only), then R's first strong peak ~pingPongTime LATER (R only ever sounds via
      // cross-feedback from L). Search from just before the empirical onset onward.
      const searchFrom = Math.max(0, tNote - 0.1)
      const pL = peakTime(eL_on.env, eL_on.hopSeconds, searchFrom, 2.6)
      const pR = peakTime(eR_on.env, eR_on.hopSeconds, searchFrom, 2.6)
      console.log(`  off-take silence floor: ${offFloor.toExponential(2)}`)
      console.log(`  on-take peaks: L@${pL.time.toFixed(3)}s (${pL.value.toExponential(2)})  R@${pR.time.toFixed(3)}s (${pR.value.toExponential(2)})  (expected R ~${(pL.time + 0.3).toFixed(3)}s, pingPongTime=0.3s)`)
      if (!(pL.value > offFloor * 8 && pR.value > offFloor * 8)) throw new Error(`[PING PONG DELAY] both channels' peaks (L=${pL.value.toExponential(2)}, R=${pR.value.toExponential(2)}) must be well above the silence floor (${offFloor.toExponential(2)}) — this isn't real energy in both channels`)
      const offsetSec = pR.time - pL.time
      if (!(offsetSec > 0.18 && offsetSec < 0.45)) throw new Error(`[PING PONG DELAY] L/R peak offset ${offsetSec.toFixed(3)}s is not close to pingPongTime (0.3s) — channels are not alternating in time as expected`)
      console.log(`  [PING PONG DELAY] PASS: both channels carry real energy (well above the silence floor), R trails L by ${offsetSec.toFixed(3)}s (~pingPongTime) — a real alternating stereo bounce, not simultaneous L+R`)
    })

    // ============================================================================================
    console.log('\n[BEAT REPEAT] one kick hit, off (gate=0) vs on (grid=1, gate=4) — expect 1 vs 5 onsets at grid cadence...')
    await withGroup(await beatRepeatDoc(), async (page) => {
      const off = await record(page, 2.4)
      await setParam(page, 'drums.beatRepeatGrid', '1')
      await setParam(page, 'drums.beatRepeatGate', '4')
      await setParam(page, 'drums.beatRepeatChance', '1')
      await setParam(page, 'drums.beatRepeatMode', 'mix')
      const on = await record(page, 2.4)

      const mono = (decoded) => {
        const n = decoded.channels[0].length
        const m = new Float64Array(n)
        for (const ch of decoded.channels) for (let i = 0; i < n; i++) m[i] += ch[i] / decoded.channels.length
        return m
      }
      const onsetsOff = detectOnsets(mono(off), off.sampleRate, 0.008, 0.05)
      const onsetsOn = detectOnsets(mono(on), on.sampleRate, 0.008, 0.05)
      console.log(`  off onsets (${onsetsOff.length}): ${onsetsOff.map((t) => t.toFixed(3)).join(', ')}`)
      console.log(`  on  onsets (${onsetsOn.length}): ${onsetsOn.map((t) => t.toFixed(3)).join(', ')}`)
      if (onsetsOff.length !== 1) throw new Error(`[BEAT REPEAT] baseline (gate=0) should show exactly 1 onset, got ${onsetsOff.length}`)
      if (onsetsOn.length !== 5) throw new Error(`[BEAT REPEAT] engaged (grid=1, gate=4) should show exactly 5 onsets (1 original + 4 repeats), got ${onsetsOn.length}`)

      const stepSeconds = (60 / 120 / 4) // 16th note at 120bpm
      const gaps = []
      for (let i = 1; i < onsetsOn.length; i++) gaps.push(onsetsOn[i] - onsetsOn[i - 1])
      console.log(`  inter-onset gaps: ${gaps.map((g) => g.toFixed(3)).join(', ')}s (expected ~${stepSeconds.toFixed(3)}s, the 16th-step grid)`)
      for (const g of gaps) {
        if (Math.abs(g - stepSeconds) > 0.02) throw new Error(`[BEAT REPEAT] repeat spacing ${g.toFixed(3)}s is not close to the expected grid cadence ${stepSeconds.toFixed(3)}s`)
      }
      console.log('  [BEAT REPEAT] PASS: engaging the effect adds exactly the expected repeated transients, evenly spaced at the configured grid cadence')
    })

    // ============================================================================================
    console.log('\n[CHORUS] held sawtooth, off vs chorusMode=chorus/chorusMix=1 — expect measurably more spectral-centroid movement...')
    await withGroup(await modDoc(), async (page) => {
      const off = await record(page, 2.5)
      await setParam(page, 't1.chorusMode', 'chorus')
      await setParam(page, 't1.chorusRate', '3')
      await setParam(page, 't1.chorusDepth', '1')
      await setParam(page, 't1.chorusMix', '1')
      const on = await record(page, 2.5)
      const cvOff = seriesCV(await centroidSeries(off))
      const cvOn = seriesCV(await centroidSeries(on))
      console.log(`  spectral-centroid CV: off ${cvOff.toFixed(4)}  ->  chorus-on ${cvOn.toFixed(4)}`)
      if (!(cvOn > cvOff * 1.5 && cvOn - cvOff > 0.005)) throw new Error(`[CHORUS] chorus insert did not measurably increase spectral-centroid movement (off ${cvOff.toFixed(4)}, on ${cvOn.toFixed(4)})`)
      console.log('  [CHORUS] PASS: the per-track chorus insert measurably increases spectral modulation over the static take')
    })

    // ============================================================================================
    console.log('\n[PHASER] held sawtooth, off vs phaserMix=1 — expect measurably more spectral-centroid movement...')
    await withGroup(await modDoc(), async (page) => {
      const off = await record(page, 2.5)
      await setParam(page, 't1.phaserRate', '1.2')
      await setParam(page, 't1.phaserDepth', '5')
      await setParam(page, 't1.phaserMix', '1')
      const on = await record(page, 2.5)
      const cvOff = seriesCV(await centroidSeries(off))
      const cvOn = seriesCV(await centroidSeries(on))
      console.log(`  spectral-centroid CV: off ${cvOff.toFixed(4)}  ->  phaser-on ${cvOn.toFixed(4)}`)
      if (!(cvOn > cvOff * 1.5 && cvOn - cvOff > 0.005)) throw new Error(`[PHASER] phaser insert did not measurably increase spectral-centroid movement (off ${cvOff.toFixed(4)}, on ${cvOn.toFixed(4)})`)
      console.log('  [PHASER] PASS: the per-track phaser insert measurably increases spectral modulation over the static take')
    })

    // ============================================================================================
    console.log('\n[SATURATOR] quiet held sine (A3, 220Hz), low drive vs high drive — expect harmonic content to rise...')
    await withGroup(await saturatorDoc(), async (page) => {
      await setParam(page, 't1.saturatorDrive', '0')
      const lowDrive = await record(page, 2.5)
      await setParam(page, 't1.saturatorDrive', '1')
      const highDrive = await record(page, 2.5)

      // Analyze a steady-state 0.8s chunk (well past the attack) from the mono sum.
      const chunk = (decoded) => {
        const startSec = 1.0, lenSec = 0.8
        const a = Math.round(startSec * decoded.sampleRate)
        const b = Math.round((startSec + lenSec) * decoded.sampleRate)
        const n = b - a
        const m = new Float64Array(n)
        for (const ch of decoded.channels) for (let i = 0; i < n; i++) m[i] += ch[a + i] / decoded.channels.length
        return m
      }
      const f0 = 220 // A3
      const ratioLow = harmonicRatio(chunk(lowDrive), lowDrive.sampleRate, f0)
      const ratioHigh = harmonicRatio(chunk(highDrive), highDrive.sampleRate, f0)
      console.log(`  harmonic/fundamental ratio: drive=0 ${ratioLow.toFixed(4)}  ->  drive=1 ${ratioHigh.toFixed(4)}`)
      if (!(ratioHigh > ratioLow * 3 && ratioHigh - ratioLow > 0.02)) throw new Error(`[SATURATOR] harmonic content did not measurably increase with drive (low ${ratioLow.toFixed(4)}, high ${ratioHigh.toFixed(4)})`)
      console.log('  [SATURATOR] PASS: driving the saturator harder measurably adds harmonic content to a pure sine, not just level')
    })

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL PHASE 22 STREAM AC CHECKS PASSED ================')
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error('\nPHASE 22 STREAM AC VERIFY FAILED:', err)
  process.exit(1)
})
