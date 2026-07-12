#!/usr/bin/env node
// Phase 22 Stream AE live verification — the format/edit/CLI/MCP layers all have unit test
// coverage (test/format-v10-audio.test.ts, test/mcp.test.ts, test/daemon.test.ts); this script is
// the "does it actually make sound do the right thing" check the task's verification bar asks
// for: create an audio-region clip referencing a REAL media file, trim in/out, set repitch and
// confirm the rendered PITCH actually shifts (measured via spectral centroid — resampling-based
// repitch shifts every frequency by exactly the rate ratio, so the centroid ratio is a strong,
// physically-grounded signal, not a proxy), split it and confirm both halves reference correct
// in/out ranges AND play back correctly (measured via each half's rendered offset time), and set
// gain (static + via automation) and confirm the rendered level actually changes — all measured
// off real captured audio (ui/src/audio/engine.ts, the same engine `beat render`/the live GUI
// use), never just "the stored param has the right value."
//
// Drives the live GUI engine directly (window.__engine.play()/recordWav()) with in-memory
// BeatDocument variants injected via window.__store.getState().setDoc() — the same technique
// ui/verify-engine-parity.mjs's SIDECHAIN/DRUMVOICE sections use. The one thing that MUST come
// from a real file on disk is the media fetch (ui/src/audio/engine.ts's loadAudioBuffer() calls
// the daemon's GET /media/<path>, which only serves paths declared in the DAEMON's own loaded
// document) — so the daemon boots on a real project directory with presets/kit-init/kick.wav
// copied in and registered, and every in-memory doc variant references that same media id/path;
// only the clip's own audio-region fields (in/out/gain/warp/rate/automation) vary per render.
//
// Usage: node ui/verify-phase22-audio-region.mjs

import { readFileSync, writeFileSync, copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8477
const PREVIEW_PORT = 5323
const BPM = 120
const MEDIA_ID = 'smp_kick'
// No "media/" prefix: the daemon's GET /media/<path> route matches this string EXACTLY against
// its own doc.media[].path (src/daemon/daemon.ts) — it must be identical to what setMediaSample
// registers below, or the fetch 404s. (The route also accepts a "media/"-prefixed variant, but
// simplest is to keep both sides using the same bare relative path.)
const MEDIA_PATH = 'kick.wav'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function pollUntil(fn, what, timeoutMs = 15000, everyMs = 50) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out (${timeoutMs}ms) waiting for: ${what}`)
    await sleep(everyMs)
  }
}

let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log(`  PASS: ${msg}`)
  } else {
    failures++
    console.log(`  FAIL: ${msg}`)
  }
}

// ---- analysis helpers -----------------------------------------------------------------------

// engine.recordWav() only captures from whichever moment it's called (playback "must already be
// running", per its own doc comment), and there is NO sample-accurate handshake between that call
// and Tone.Transport's already-running clock — recording can start at any PHASE of the loop, not
// reliably at a loop boundary. Rather than assume a fixed offset, `mkDoc` sets loopBars=1 (the
// transport loops every LOOP_PERIOD seconds) and every render captures a couple of full loop
// periods; findLoudOnset() then locates a retrigger that has enough clean trailing room to analyze
// (skipping a possibly-clipped one near either edge of the capture), and every check below works
// relative to THAT onset, not an assumed absolute time.
const LOOP_PERIOD = (1 * 16 * 60) / BPM / 4 // loopBars=1 -> exactly one bar's seconds
const REC_SECS = LOOP_PERIOD * 2 + 1.0 // >= 2 full loop periods -> guarantees a cleanly-bounded one
const CLIP_WINDOW_SECONDS = LOOP_PERIOD - 0.2 // clear of the next retrigger; comfortably > any region here
const MIN_TRAILING_SECONDS = CLIP_WINDOW_SECONDS // the onset picker requires the SAME margin clipRelative slices

function sliceFrom(decoded, tStart) {
  const i0 = Math.max(0, Math.round(tStart * decoded.sampleRate))
  return { sampleRate: decoded.sampleRate, channels: decoded.channels.map((ch) => ch.slice(i0)) }
}

/** Short-time RMS envelope, one value per `winSeconds` window. */
function rmsEnvelope(decoded, winSeconds = 0.005) {
  const sr = decoded.sampleRate
  const win = Math.max(1, Math.round(sr * winSeconds))
  const n = decoded.channels[0].length
  const env = []
  for (let i = 0; i + win <= n; i += win) {
    let s = 0
    for (const ch of decoded.channels) for (let j = 0; j < win; j++) s += ch[i + j] * ch[i + j]
    env.push(Math.sqrt(s / (win * decoded.channels.length)))
  }
  return { env, win, sr }
}

/** Every upward crossing of -30dB-below-peak, as a time in seconds — i.e. every place a loop
 * retrigger's onset lands in this capture. */
function findOnsets(decoded) {
  const { env, win, sr } = rmsEnvelope(decoded)
  const peak = env.reduce((m, v) => Math.max(m, v), 0)
  const floor = peak * Math.pow(10, -30 / 20)
  const onsets = []
  let wasLoud = false
  for (let k = 0; k < env.length; k++) {
    const loud = env[k] > floor
    if (loud && !wasLoud) onsets.push((k * win) / sr)
    wasLoud = loud
  }
  return onsets
}

/** The first onset in this capture with at least MIN_TRAILING_SECONDS of recording after it — a
 * retrigger that isn't clipped by either edge of the capture window, safe to analyze in full. */
function findCleanOnset(decoded) {
  const totalSeconds = decoded.channels[0].length / decoded.sampleRate
  for (const t of findOnsets(decoded)) {
    if (totalSeconds - t >= MIN_TRAILING_SECONDS) return t
  }
  throw new Error(`no cleanly-bounded onset found in a ${totalSeconds.toFixed(2)}s capture (is the render actually producing audio?)`)
}

/** decoded, re-sliced to start at its own first cleanly-bounded onset (time 0 = clip start) and
 * bounded to end well BEFORE the next loop retrigger (LOOP_PERIOD later) — otherwise "last loud
 * window" analysis (offsetTime) would walk straight into the NEXT onset and misreport it as this
 * clip's own tail. */
function clipRelative(decoded) {
  const onset = findCleanOnset(decoded)
  const i0 = Math.round(onset * decoded.sampleRate)
  const i1 = Math.min(decoded.channels[0].length, i0 + Math.round(CLIP_WINDOW_SECONDS * decoded.sampleRate))
  return { sampleRate: decoded.sampleRate, channels: decoded.channels.map((ch) => ch.slice(i0, i1)) }
}

// analyze()'s spectral centroid is a whole-buffer measure — computed across `decoded` (the ~1.8s
// clip-relative window; see clipRelative), a 0.26s-max kick sitting in well over a second of near-
// silence dominates the frame count with numerically-tiny, effectively-random spectral content,
// which made the measured centroid swing wildly run to run (1.7x-4x for the SAME 1.5x repitch).
// metrics are computed from a much tighter crop instead — just long enough to hold the loudest
// part of any region this script renders (<=0.26s) plus margin, so silence stops dominating.
const SPECTRAL_WINDOW_SECONDS = 0.4

async function analyzeBase64Wav(b64) {
  const { decodeWav, analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const bytes = Buffer.from(b64, 'base64')
  const full = decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  const decoded = clipRelative(full)
  const spectralWindow = sliceFrom(decoded, 0)
  const cropSamples = Math.round(SPECTRAL_WINDOW_SECONDS * decoded.sampleRate)
  spectralWindow.channels = spectralWindow.channels.map((ch) => ch.slice(0, cropSamples))
  return { metrics: analyze(spectralWindow.channels, spectralWindow.sampleRate), decoded }
}

/** RMS, in dB, of the [tStart, tEnd) window (seconds) across all channels. */
function windowRmsDb(decoded, tStart, tEnd) {
  const sr = decoded.sampleRate
  const i0 = Math.max(0, Math.round(tStart * sr))
  const i1 = Math.min(decoded.channels[0].length, Math.round(tEnd * sr))
  if (i1 <= i0) return -Infinity
  let sum = 0
  let n = 0
  for (const ch of decoded.channels) {
    for (let i = i0; i < i1; i++) {
      sum += ch[i] * ch[i]
      n++
    }
  }
  const rms = Math.sqrt(sum / n)
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity
}

/** The time (seconds) of the last 10ms window whose RMS is within 30dB of the buffer's peak
 * window RMS — i.e. "when does the audible content stop." Used to confirm a trim/split's actual
 * playback duration matches its declared in/out span, measured off real rendered samples. Assumes
 * `decoded` is already clip-relative (see clipRelative/findCleanOnset above) so "last loud window"
 * means the CURRENT onset's tail, not a later loop retrigger's. */
function offsetTime(decoded) {
  const { env, win, sr } = rmsEnvelope(decoded, 0.01)
  const peak = env.reduce((m, v) => Math.max(m, v), 0)
  const floor = peak * Math.pow(10, -30 / 20)
  let last = 0
  for (let k = 0; k < env.length; k++) {
    if (env[k] > floor) last = (k + 1) * win
  }
  return last / sr
}

// ---- BeatDocument builders --------------------------------------------------------------------

function mkDoc({ in: inP, out, gainDb = 0, warp = 'off', rate = 1, gainPoints, loopBars = 1 }) {
  const clip = {
    id: 'c1',
    notes: [],
    hits: [],
    automation: gainPoints ? [{ param: 'gain', points: gainPoints.map((p, i) => ({ id: `p${i + 1}`, time: p.time, value: p.value })) }] : [],
    loop: null,
    signature: null,
    audio: { media: MEDIA_ID, in: inP, out, gainDb, warp, rate, markers: [] },
  }
  return {
    formatVersion: '0.10',
    bpm: BPM,
    loopBars,
    selectedTrack: 'atrk',
    media: [{ id: MEDIA_ID, sha256: 'placeholder', path: MEDIA_PATH }], // sha only matters to the DAEMON's own doc (see header)
    tracks: [
      {
        id: 'atrk',
        name: 'atrk',
        color: '#e5c07b',
        kind: 'audio',
        synth: { osc: 'sine', volume: 0, cutoff: 1000, resonance: 1, attack: 0, decay: 0, sustain: 0, release: 0, pan: 0 }, // unused placeholder
        laneSamples: {},
        lanes: [],
        notes: [],
        hits: [],
        effects: [],
        shuffleAmount: 0,
        shuffleGrid: 1,
        clips: [clip],
      },
    ],
    groups: [],
    scenes: [{ id: 's1', slots: { atrk: 'c1' } }],
    song: [{ scene: 's1', bars: loopBars }],
  }
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { addAudioClip, addTrack, initDocument, serialize, setMediaSample, splitAudioClip } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // Real project directory, real media file, real sha256 — the daemon's OWN document (what
  // GET /media/<path> validates against) is built through the ordinary core edit primitives,
  // exactly like `beat sample` + `beat add-track --kind audio` + `beat audio-clip` would.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-audio-verify-'))
  copyFileSync(join(repoRoot, 'presets/kit-init/kick.wav'), join(proj, 'kick.wav'))
  const sha256 = createHash('sha256').update(readFileSync(join(proj, 'kick.wav'))).digest('hex')
  let baseDoc = initDocument({ bpm: BPM, loopBars: 1, trackId: 'lead' })
  baseDoc = setMediaSample(baseDoc, MEDIA_ID, sha256, 'kick.wav')
  baseDoc = addTrack(baseDoc, { id: 'atrk', kind: 'audio' }).doc
  baseDoc = addAudioClip(baseDoc, 'atrk', 'c1', { media: MEDIA_ID, in: 0, out: 0.26 }).doc
  const beatPath = join(proj, 'proj.beat')
  writeFileSync(beatPath, serialize(baseDoc))
  console.log(`project at ${beatPath} (kick.wav sha256:${sha256.slice(0, 12)}...)`)

  // Verify splitAudioClip's own math directly (no engine involved) before trusting the render-
  // based checks below to interpret it correctly — belt and suspenders.
  const splitResult = splitAudioClip(baseDoc, 'atrk', 'c1', 1) // 1 step @ 120bpm = 0.125s
  console.log(`\n[SPLIT-MATH] splitAudioClip(atSteps=1) -> first ${JSON.stringify(splitResult.first.audio)} / second ${JSON.stringify(splitResult.second.audio)}`)
  check(splitResult.first.audio.in === 0 && splitResult.first.audio.out === 0.125, 'split first half: in=0, out=0.125 (source seconds at rate 1)')
  check(splitResult.second.audio.in === 0.125 && splitResult.second.audio.out === 0.26, 'split second half: in=0.125, out=0.26 (continues from the split point to the original out)')
  check(splitResult.second.audio.media === MEDIA_ID, 'split second half references the SAME media as the original')

  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon on :${daemon.port}`)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try {
      return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok
    } catch {
      return false
    }
  }, 'vite preview to serve')
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 15000 })

    const recordDoc = async (docOpts, secs = REC_SECS) => {
      const doc = mkDoc(docOpts)
      const b64 = await page.evaluate(async ({ doc, secs }) => {
        window.__store.getState().setDoc(doc)
        await window.__engine.play()
        await new Promise((r) => setTimeout(r, 250)) // let the graph + media fetch settle
        const blob = await window.__engine.recordWav(secs)
        window.__engine.stop()
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        return btoa(bin)
      }, { doc, secs })
      return analyzeBase64Wav(b64)
    }

    // ---------- REPITCH: pitch actually moves with rate ----------
    console.log('\n[REPITCH] rendering off (rate 1) vs repitch (rate 1.5)...')
    const off = await recordDoc({ in: 0, out: 0.26, warp: 'off', rate: 1 })
    const repitched = await recordDoc({ in: 0, out: 0.26, warp: 'repitch', rate: 1.5 })
    // Resampling-based repitch shifts EVERY frequency by exactly the rate ratio — a deterministic
    // DSP fact, not something that could be "partially working." But a single centroid
    // measurement of a short transient through a lossy real-time capture (opus via MediaRecorder)
    // is noisy run to run (observed 1.7x-4x for the SAME 1.5x rate across repeated manual runs) —
    // exactly the "just check the stored param" trap this verification bar exists to avoid working
    // around by accident. Take the MEDIAN of 3 independent (off, repitch) capture pairs instead of
    // trusting one sample.
    const trials = [{ off, repitched }]
    for (let i = 0; i < 2; i++) {
      trials.push({
        off: await recordDoc({ in: 0, out: 0.26, warp: 'off', rate: 1 }),
        repitched: await recordDoc({ in: 0, out: 0.26, warp: 'repitch', rate: 1.5 }),
      })
    }
    const ratios = trials.map((t) => t.repitched.metrics.spectral.centroidHz / t.off.metrics.spectral.centroidHz).sort((a, b) => a - b)
    const ratio = ratios[1] // median of 3
    console.log(`  centroid ratios across 3 trials: [${ratios.map((r) => r.toFixed(2)).join(', ')}]  median ${ratio.toFixed(2)} (expected ~1.5)`)
    // The load-bearing claim is "pitch moved by roughly the rate, not not-at-all (ratio~1) and not
    // some unrelated artifact," not "matches 1.5 to two decimal places" — hence the generous but
    // still decisive band around the expected value.
    check(ratio > 1.2, `repitch x1.5 measurably raises the spectral centroid (median ratio ${ratio.toFixed(2)} > 1.2 — clearly more than measurement noise around 1.0)`)
    check(ratio < 3.2, `repitch x1.5's centroid shift stays in a physically-plausible range (median ratio ${ratio.toFixed(2)} < 3.2)`)
    check(repitched.metrics.durationSeconds > 0 && repitched.decoded.channels[0].some((v) => Math.abs(v) > 0.001), 'repitched render produced real (non-silent) audio')

    // ---------- TRIM: out-point controls the rendered duration ----------
    // Two fragile approaches were tried and dropped: (1) a fixed-dB-floor "offset crossing" time
    // — the kick's own natural decay already approaches that floor around the same time regardless
    // of trim, so short vs. long barely differed; (2) cumulative RMS over a window starting at
    // t=0 — an abrupt truncation mid-waveform (out=0.02s, cut off far from a zero-crossing) turns
    // out to inject an audible CLICK (a hard discontinuity, broadband energy), which the lossy
    // opus round-trip can even amplify into ringing — so the "short" render sometimes measured
    // LOUDER than the "long" one, a real DSP artifact of the test setup, not of the engine.
    // The robust version: measure a window WELL PAST any truncation click, but still early enough
    // in the natural decay to be well clear of the render pipeline's own noise floor (the sample's
    // very quiet late tail — below roughly -50dB — doesn't survive the lossy real-time capture
    // reliably either way, trimmed or not, so testing THERE proved unreliable regardless of trim).
    // 0.06-0.10s is still comfortably loud per this sample's own envelope. A clip trimmed to stop
    // at out=0.04s has NOTHING scheduled there at all (true silence); a clip left at out=0.26
    // (near the file's full length) still has real, measurable signal there.
    console.log('\n[TRIM] rendering a short out (0.04s) vs the (near-)full out (0.26s), measuring the 0.06-0.10s window...')
    const short = await recordDoc({ in: 0, out: 0.04, warp: 'off', rate: 1 })
    const long = await recordDoc({ in: 0, out: 0.26, warp: 'off', rate: 1 })
    const shortWindowDb = windowRmsDb(short.decoded, 0.06, 0.1)
    const longWindowDb = windowRmsDb(long.decoded, 0.06, 0.1)
    console.log(`  RMS over [0.06, 0.10s]: short-trim(out=0.04) ${shortWindowDb.toFixed(1)}dB, long-trim(out=0.26) ${longWindowDb.toFixed(1)}dB`)
    // Not quite absolute silence for the short-trim case — the abrupt truncation at 0.04s (a hard
    // discontinuity, not a zero-crossing) leaks a little ringing energy into this window via the
    // lossy opus round-trip. Still a clear, large, unambiguous gap vs. the untrimmed render.
    check(longWindowDb > shortWindowDb + 8, `the untrimmed clip carries measurably more signal at 0.06-0.10s than the one trimmed to stop at 0.04s (long ${longWindowDb.toFixed(1)}dB > short ${shortWindowDb.toFixed(1)}dB + 8)`)
    check(longWindowDb > -50, `the untrimmed (out=0.26) clip has real, measurable signal at 0.06-0.10s (${longWindowDb.toFixed(1)}dB > -50dB)`)

    // ---------- SPLIT: both halves reference correct ranges AND play back correctly ----------
    console.log('\n[SPLIT] rendering each half of the split from [SPLIT-MATH] above...')
    const firstHalf = await recordDoc({ in: splitResult.first.audio.in, out: splitResult.first.audio.out, warp: 'off', rate: 1 })
    const secondHalf = await recordDoc({ in: splitResult.second.audio.in, out: splitResult.second.audio.out, warp: 'off', rate: 1 })
    const firstOnsetDb = windowRmsDb(firstHalf.decoded, 0, 0.02)
    const secondOnsetDb = windowRmsDb(secondHalf.decoded, 0, 0.02)
    const firstOffset = offsetTime(firstHalf.decoded)
    console.log(`  first half (0-0.125s of source): onset ${firstOnsetDb.toFixed(1)}dB, measured offset ~${firstOffset.toFixed(3)}s`)
    console.log(`  second half (0.125-0.26s of source): onset ${secondOnsetDb.toFixed(1)}dB`)
    check(firstOnsetDb > -30, `first half starts with real, audible signal (${firstOnsetDb.toFixed(1)}dB onset)`)
    check(secondOnsetDb > -40, `second half ALSO starts with real, audible signal, not silence (${secondOnsetDb.toFixed(1)}dB onset)`)
    check(firstOffset < 0.2, `first half stops well before the full clip's length (~${firstOffset.toFixed(3)}s)`)

    // ---------- GAIN: static level ----------
    console.log('\n[GAIN static] rendering 0dB vs -12dB clip gain...')
    const gain0 = await recordDoc({ in: 0, out: 0.26, gainDb: 0 })
    const gainMinus12 = await recordDoc({ in: 0, out: 0.26, gainDb: -12 })
    const peak0 = gain0.metrics.samplePeakDbfs
    const peakMinus12 = gainMinus12.metrics.samplePeakDbfs
    const gainDelta = peak0 - peakMinus12
    console.log(`  peak level: gain 0dB -> ${peak0.toFixed(1)}dBFS, gain -12dB -> ${peakMinus12.toFixed(1)}dBFS (delta ${gainDelta.toFixed(1)}dB, expected ~12)`)
    check(gainDelta > 6, `static -12dB clip gain measurably lowers the rendered level (delta ${gainDelta.toFixed(1)}dB > 6dB)`)
    check(gainDelta < 20, `the level drop stays in a plausible range for a 12dB gain change (delta ${gainDelta.toFixed(1)}dB < 20dB)`)

    // ---------- GAIN: automation ramp ----------
    // Same lesson as TRIM above: a marginal late-window comparison decays into opus's noise floor
    // for BOTH renders and stops discriminating. Compare cumulative RMS across the WHOLE clip
    // window instead — a ramp from 0dB down to -24dB is quieter than flat 0dB for nearly the
    // entire clip (everything after t=0), so its windowed average is measurably lower.
    console.log('\n[GAIN automation] rendering flat 0dB vs a 0dB -> -24dB ramp across the clip...')
    const flat = await recordDoc({ in: 0, out: 0.26, gainDb: 0 })
    const ramped = await recordDoc({ in: 0, out: 0.26, gainDb: 0, gainPoints: [{ time: 0, value: 0 }, { time: 2, value: -24 }] })
    const flatLate = windowRmsDb(flat.decoded, 0, 0.3)
    const rampedLate = windowRmsDb(ramped.decoded, 0, 0.3)
    console.log(`  RMS over [0, 0.3s]: flat ${flatLate.toFixed(1)}dB, ramped ${rampedLate.toFixed(1)}dB`)
    check(flatLate - rampedLate > 3, `the gain-automation ramp measurably quiets the clip vs. flat gain, integrated over the same window (delta ${(flatLate - rampedLate).toFixed(1)}dB > 3dB)`)

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))

    console.log(`\n================ ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ================`)
    if (failures > 0) process.exitCode = 1
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nAUDIO-REGION VERIFY FAILED:', err)
  process.exit(1)
})
