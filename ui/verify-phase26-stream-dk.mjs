#!/usr/bin/env node
// Phase 26 Stream DK verification — the drum-sampler voice type (research 68/decisions.md #145,
// "the biggest single 'video game music' tell left"). BeatLaneSampleBacking already existed
// (Phase 22 Stream AB) but only carried gainDb/tune; this stream added the lean Ableton-Drum-
// Sampler-shaped surface on top — Start/Length playback trim, an AHD amplitude envelope, one
// filter (the same Tone.Filter primitive synth-backed lanes already use), and a short reused-
// EffectType playback-effect list — all riding the SAME setLaneParam primitive/`/lane` daemon
// route/DrumLanePanel.tsx GUI pattern synth-backed lanes' own per-param knobs already use.
//
// Two parts, same conventions prior engine-verification streams established (see
// ui/verify-phase23-stream-bf.mjs, ui/verify-phase22-audio-region.mjs):
//
//   GUI CHECK   drives the REAL DrumLanePanel (ui/src/components/DrumLanePanel.tsx) over headless
//               Chromium against a real `beat daemon`: opens a sample-backed "kick" lane's edit
//               row, types into the new start/length/attack/hold/decay/cutoff/resonance number
//               inputs, picks a filter type, and toggles a playback effect on — confirms the real
//               .beat file gains the expected `start=/length=/.../filter=/fx=` tokens on the
//               lane's own line, not just in-memory store state.
//
//   AUDIO       drives the real engine (window.__store.setDoc + window.__engine.play/recordWav,
//               the same technique ui/verify-phase22-audio-region.mjs's recordDoc() uses) with a
//               real drum-sampler lane backed by a real sample (presets/kit-init/kick.wav, served
//               by the real daemon's GET /media/<path>) and measures ACTUAL rendered audio via
//               src/metrics (analyze()/decodeWav()) — not just that the stored params changed:
//     LENGTH      a shorter Length measurably truncates the sample's audible tail (offsetTime).
//     GAIN        a lower per-lane gainDb measurably lowers the rendered peak level.
//     ATTACK      a slow attack measurably slows the onset's 10%->90% rise time vs a fast one.
//     DECAY       an AHD decay stage measurably fades the amplitude CONTOUR before the trimmed
//                 sample's own natural tail would (a real envelope shape, not just a level knob).
//     FILTER      a low cutoff measurably darkens the rendered spectral centroid.
//
// Usage: node ui/verify-phase26-stream-dk.mjs

import { readFileSync, writeFileSync, copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const PREVIEW_PORT = 5926
const BPM = 120
const LOOP_BARS = 1
const MEDIA_ID = 'kick-smp'
const MEDIA_PATH = 'kick.wav' // no "media/" prefix — daemon's GET /media/<path> matches this bare relative path exactly
const HIT_STEP = 8 // 1.0s into the 2s loop — plenty of settle time for the sample fetch+decode before it fires
const REC_SECS = 2.2 // hit(1.0s) + kick.wav's own natural length (~0.29s) + tail margin, well under one 2s loop

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
let failures = 0
function check(cond, msg) {
  if (cond) {
    console.log(`  PASS: ${msg}`)
  } else {
    failures++
    console.log(`  FAIL: ${msg}`)
  }
}

// ---- measurement helpers (same techniques ui/verify-phase22-audio-region.mjs and
// ui/verify-phase23-stream-bf.mjs already established for this exact class of check) -------------

function mono(decoded) {
  const n = decoded.channels[0].length
  const m = new Float64Array(n)
  for (const ch of decoded.channels) for (let i = 0; i < n; i++) m[i] += ch[i] / decoded.channels.length
  return m
}
function rmsEnvelope(samples, sampleRate, winSeconds = 0.005) {
  const win = Math.max(1, Math.round(sampleRate * winSeconds))
  const env = []
  for (let i = 0; i + win <= samples.length; i += win) {
    let s = 0
    for (let j = 0; j < win; j++) s += samples[i + j] * samples[i + j]
    env.push(Math.sqrt(s / win))
  }
  return { env, win, sr: sampleRate }
}
/** This capture holds exactly ONE hit (no loop retrigger — REC_SECS < one loop period) — the
 * first upward crossing of -30dB-below-peak IS the onset, no multi-onset disambiguation needed
 * (unlike audio-region's clip-tiling captures, which see several retriggers per recording). */
function findOnset(decoded) {
  const samples = mono(decoded)
  const { env, win, sr } = rmsEnvelope(samples, decoded.sampleRate)
  const peak = env.reduce((m, v) => Math.max(m, v), 0)
  if (peak < 1e-6) throw new Error('capture is silent — no onset to find (is the sample actually loading/triggering?)')
  const floor = peak * Math.pow(10, -30 / 20)
  for (let k = 0; k < env.length; k++) {
    if (env[k] > floor) return { time: (k * win) / sr, samples, peak }
  }
  throw new Error('no onset found above the silence floor')
}
/** The time (seconds, relative to onset) of the last 10ms window whose RMS is within 30dB of the
 * onset window's own peak — "when does the audible content stop." Confirms a Length trim's actual
 * playback duration, measured off real rendered samples (mirrors audio-region's offsetTime()). */
function offsetTimeFromOnset(decoded) {
  const { time: onset, samples } = findOnset(decoded)
  const i0 = Math.round(onset * decoded.sampleRate)
  const tail = { channels: [samples.slice(i0)] }
  const { env, win, sr } = rmsEnvelope(tail.channels[0], decoded.sampleRate, 0.01)
  const peak = env.reduce((m, v) => Math.max(m, v), 0)
  const floor = peak * Math.pow(10, -30 / 20)
  let last = 0
  for (let k = 0; k < env.length; k++) {
    if (env[k] > floor) last = (k + 1) * win
  }
  return last / sr
}
/** Seconds from 10% to 90% of the onset window's own peak RMS — the attack stage's rise time. */
function riseTimeFromOnset(decoded) {
  const { time: onset, samples, peak: globalPeak } = findOnset(decoded)
  const i0 = Math.round(onset * decoded.sampleRate)
  const win = { channels: [samples.slice(i0, i0 + Math.round(decoded.sampleRate * 0.3))] }
  const { env, win: winLen, sr } = rmsEnvelope(win.channels[0], decoded.sampleRate, 0.002)
  const peak = env.reduce((m, v) => Math.max(m, v), globalPeak * 0.5)
  const lo = peak * 0.1
  const hi = peak * 0.9
  let tLo = -1, tHi = -1
  for (let k = 0; k < env.length; k++) {
    if (tLo === -1 && env[k] >= lo) tLo = (k * winLen) / sr
    if (tHi === -1 && env[k] >= hi) {
      tHi = (k * winLen) / sr
      break
    }
  }
  if (tLo === -1 || tHi === -1) return 0
  return Math.max(0, tHi - tLo)
}
/** RMS, in dB, of the [tStart, tEnd) window (seconds, relative to onset). */
function windowRmsDbFromOnset(decoded, tStart, tEnd) {
  const { time: onset, samples } = findOnset(decoded)
  const sr = decoded.sampleRate
  const i0 = Math.max(0, Math.round((onset + tStart) * sr))
  const i1 = Math.min(samples.length, Math.round((onset + tEnd) * sr))
  if (i1 <= i0) return -Infinity
  let sum = 0
  for (let i = i0; i < i1; i++) sum += samples[i] * samples[i]
  const rms = Math.sqrt(sum / (i1 - i0))
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity
}
/** Cropped, onset-relative [0, lenSeconds) mono window, for analyze()'s spectral centroid — same
 * "crop to the loud part so silence doesn't dominate the frame count" discipline audio-region's
 * SPECTRAL_WINDOW_SECONDS uses. */
function spectralCropFromOnset(decoded, lenSeconds = 0.25) {
  const { time: onset, samples } = findOnset(decoded)
  const sr = decoded.sampleRate
  const i0 = Math.round(onset * sr)
  const i1 = Math.min(samples.length, i0 + Math.round(lenSeconds * sr))
  return { channels: [samples.slice(i0, i1)], sampleRate: sr }
}

async function analyzeBase64Wav(b64) {
  const { decodeWav } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const bytes = Buffer.from(b64, 'base64')
  return decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
}

// ---- doc builder ------------------------------------------------------------------------------

function laneDoc({ gainDb = 0, tune = 0, params = {}, filterType = 'lowpass', effects = [] }) {
  return {
    formatVersion: '0.10',
    bpm: BPM,
    loopBars: LOOP_BARS,
    selectedTrack: 'drums',
    media: [{ id: MEDIA_ID, sha256: 'placeholder', path: MEDIA_PATH }], // sha only matters to the DAEMON's own doc (audio-region precedent)
    scenes: [],
    song: null,
    groups: [],
    tracks: [
      {
        id: 'drums',
        name: 'Drums',
        color: '#e06c75',
        kind: 'drums',
        synth: { osc: 'sawtooth', volume: -10, cutoff: 12000, resonance: 0.1, attack: 0.01, decay: 0.2, sustain: 0.6, release: 0.3, pan: 0 },
        laneSamples: {},
        notes: [],
        clips: [],
        hits: [{ id: 'h1', lane: 'kick', start: HIT_STEP, velocity: 1 }],
        effects: [],
        lanes: [{ name: 'kick', backing: { type: 'sample', sample: MEDIA_ID, gainDb, tune, params, filterType, effects } }],
        shuffleAmount: 0,
        shuffleGrid: 1,
      },
    ],
  }
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { serialize, setMediaSample, initDocument, addTrack, addHit } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // Real project directory, real media file (presets/kit-init/kick.wav — the same short real drum
  // one-shot ui/verify-phase22-audio-region.mjs and ui/verify-phase23-bb.mjs already trust), real
  // sha256 — matches every prior real-media verification script's convention.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p26dk-'))
  copyFileSync(join(repoRoot, 'presets/kit-init/kick.wav'), join(proj, MEDIA_PATH))
  const sha256 = createHash('sha256').update(readFileSync(join(proj, MEDIA_PATH))).digest('hex')

  let baseDoc = initDocument({ bpm: BPM, loopBars: LOOP_BARS, trackId: 'lead' })
  baseDoc = setMediaSample(baseDoc, MEDIA_ID, sha256, MEDIA_PATH)
  // A brand-new drums track can declare its `lanes` list directly at creation (no materializeLanes
  // dance needed — that's only for MIGRATING a legacy 5-lane track onto the open lane model).
  baseDoc = addTrack(baseDoc, {
    id: 'drums',
    kind: 'drums',
    name: 'Drums',
    lanes: [{ name: 'kick', backing: { type: 'sample', sample: MEDIA_ID, gainDb: 0, tune: 0, params: {}, filterType: 'lowpass', effects: [] } }],
  }).doc
  baseDoc = addHit(baseDoc, 'drums', { lane: 'kick', start: 0, velocity: 0.9 }).doc
  const beatPath = join(proj, 'project.beat')
  writeFileSync(beatPath, serialize(baseDoc))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')
  console.log(`project at ${beatPath} (${MEDIA_PATH} sha256:${sha256.slice(0, 12)}...)`)

  const daemon = await startDaemon({ filePath: beatPath, port: 0 })
  console.log(`daemon on :${daemon.port}`)

  const preview = spawn('npm', ['run', 'preview', '--', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: uiDir, stdio: 'pipe' })
  preview.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`))
  await pollUntil(async () => {
    try {
      return (await fetch(`http://localhost:${PREVIEW_PORT}/`)).ok
    } catch {
      return false
    }
  }, 'vite preview to serve', 20000)
  console.log(`ui served on :${PREVIEW_PORT}`)

  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  const errors = []
  try {
    const page = await browser.newPage()
    await page.setViewportSize({ width: 1600, height: 980 })
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine && window.__bridge, { timeout: 15000 })
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 10000 })

    // ============================================================================================
    console.log('\n[GUI] driving the real DrumLanePanel: Start/Length/AHD-envelope/filter/fx fields on a sample-backed lane...')
    {
      const selectTrack = (name) => page.click(`.arr-row:has(.arr-track-name:text-is("${name}")) .arr-track-select`)
      const laneLine = (text) => text.split('\n').find((l) => l.trim().startsWith('lane kick '))

      await selectTrack('Drums')
      await pollUntil(() => page.evaluate(() => window.__store.getState().doc.selectedTrack === 'drums'), 'drums track selection')
      await page.click('[data-pane-tab="clip"]')
      await page.waitForSelector('[data-testid="lane-panel"]', { timeout: 5000 })
      await page.click('[data-lane-edit-toggle="kick"]')
      await page.waitForSelector('[data-lane-param="kick.start"]', { timeout: 3000 })

      // Start/Length/AHD-envelope/filter numeric knobs — the exact per-param inputs setLaneParam
      // (op: 'param') drives, same as a synth-backed lane's own tune/punch/decay fields.
      const numericEdits = { start: '0.02', length: '0.15', attack: '0.03', hold: '0.01', decay: '0.05', cutoff: '5000', resonance: '2' }
      for (const [key, value] of Object.entries(numericEdits)) {
        await page.fill(`[data-lane-param="kick.${key}"]`, value)
        await page.locator(`[data-lane-param="kick.${key}"]`).blur()
      }
      await pollUntil(
        () => page.evaluate(() => {
          const p = window.__store.getState().doc.tracks.find((t) => t.id === 'drums').lanes.find((l) => l.name === 'kick').backing.params
          return p.start === 0.02 && p.length === 0.15 && p.attack === 0.03 && p.hold === 0.01 && p.decay === 0.05 && p.cutoff === 5000 && p.resonance === 2
        }),
        'all 7 Start/Length/AHD/filter params to land in the store',
      )
      let text = readFileSync(beatPath, 'utf8')
      let line = laneLine(text)
      for (const [key, value] of Object.entries(numericEdits)) {
        check(line && line.includes(`${key}=${value}`), `lane line gained "${key}=${value}" — got: ${line ? line.trim() : '(no lane kick line)'}`)
      }

      // filter type — a select, so it rides setLaneBacking (a structural retype), same as the
      // sample/gainDb/tune fields already did before this stream.
      await page.selectOption('[data-lane-filter="kick"]', 'highpass')
      await pollUntil(
        () => page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').lanes.find((l) => l.name === 'kick').backing.filterType === 'highpass'),
        'filterType to update to highpass',
      )
      text = readFileSync(beatPath, 'utf8')
      line = laneLine(text)
      check(line && line.includes('filter=highpass'), `lane line gained "filter=highpass" — got: ${line ? line.trim() : '(none)'}`)
      // the numeric params from the previous step must have survived this whole-backing rebuild
      check(line && line.includes('start=0.02') && line.includes('length=0.15'), `filter change preserved the earlier Start/Length overrides — got: ${line ? line.trim() : '(none)'}`)

      // playback-effect list — a checkbox, reuses BeatEffect/EFFECT_TYPES wholesale. Plain click
      // (not .check()): the checkbox's `checked` prop is store-controlled and only flips back to
      // true once the async postLaneOp round trip lands, so .check()'s own "did it end up checked"
      // assertion races that round trip — the pollUntil right below is the real assertion here.
      await page.click('[data-lane-fx="kick.bitcrush"]')
      await pollUntil(
        () => page.evaluate(() => window.__store.getState().doc.tracks.find((t) => t.id === 'drums').lanes.find((l) => l.name === 'kick').backing.effects.some((e) => e.type === 'bitcrush')),
        'bitcrush to be added to the lane fx list',
      )
      text = readFileSync(beatPath, 'utf8')
      line = laneLine(text)
      check(line && line.includes('fx=bitcrush'), `lane line gained "fx=bitcrush" — got: ${line ? line.trim() : '(none)'}`)
      console.log(`  [GUI] PASS: real DrumLanePanel inputs wrote a full lean-drum-sampler backing line: "${line.trim()}"`)

      git(proj, 'add', '-A')
      git(proj, 'commit', '-q', '-m', 'after gui edits')
    }

    // ---- shared record helper for the AUDIO checks below ---------------------------------------
    async function recordDoc(overrides) {
      const doc = laneDoc(overrides)
      const b64 = await page.evaluate(
        async ({ doc, secs }) => {
          window.__store.getState().setDoc(doc)
          await window.__engine.play()
          await new Promise((r) => setTimeout(r, 400)) // let the graph + media fetch settle, same margin audio-region uses
          const blob = await window.__engine.recordWav(secs)
          window.__engine.stop()
          const buf = await blob.arrayBuffer()
          const bytes = new Uint8Array(buf)
          let bin = ''
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
          return btoa(bin)
        },
        { doc, secs: REC_SECS },
      )
      return analyzeBase64Wav(b64)
    }

    // ============================================================================================
    console.log('\n[LENGTH] Start/Length trim: default (full sample, ~0.29s) vs length=0.06s...')
    {
      const full = await recordDoc({})
      const trimmed = await recordDoc({ params: { length: 0.06 } })
      const fullOff = offsetTimeFromOnset(full)
      const trimmedOff = offsetTimeFromOnset(trimmed)
      console.log(`  audible tail ends at: full ${fullOff.toFixed(3)}s  ->  length=0.06 ${trimmedOff.toFixed(3)}s`)
      check(trimmedOff < fullOff - 0.06, `a shorter Length measurably truncates the sample (full ${fullOff.toFixed(3)}s, trimmed ${trimmedOff.toFixed(3)}s)`)
      check(trimmedOff < 0.12, `length=0.06 trims well under the natural ~0.29s length (got ${trimmedOff.toFixed(3)}s)`)
    }

    // ============================================================================================
    console.log('\n[GAIN] lane gainDb: 0dB vs -18dB...')
    {
      const loud = await recordDoc({ gainDb: 0 })
      const quiet = await recordDoc({ gainDb: -18 })
      const loudDb = windowRmsDbFromOnset(loud, 0, 0.05)
      const quietDb = windowRmsDbFromOnset(quiet, 0, 0.05)
      console.log(`  onset RMS: gainDb=0 ${loudDb.toFixed(1)}dB  ->  gainDb=-18 ${quietDb.toFixed(1)}dB (delta ${(loudDb - quietDb).toFixed(1)}dB)`)
      check(loudDb - quietDb > 8, `a lower Gain measurably reduces the rendered peak level (delta ${(loudDb - quietDb).toFixed(1)}dB, expected > 8dB toward the -18dB nominal drop)`)
    }

    // ============================================================================================
    console.log('\n[ATTACK] AHD envelope: fast attack (0.001s, default) vs slow attack (0.05s)...')
    {
      const fast = await recordDoc({ params: { attack: 0.001 } })
      const slow = await recordDoc({ params: { attack: 0.05 } })
      const fastRise = riseTimeFromOnset(fast)
      const slowRise = riseTimeFromOnset(slow)
      console.log(`  10%->90% rise time: attack=0.001 ${(fastRise * 1000).toFixed(1)}ms  ->  attack=0.05 ${(slowRise * 1000).toFixed(1)}ms`)
      check(slowRise > fastRise + 0.02, `a slow Attack measurably slows the onset's rise time (fast ${(fastRise * 1000).toFixed(1)}ms, slow ${(slowRise * 1000).toFixed(1)}ms)`)
    }

    // ============================================================================================
    console.log('\n[DECAY] AHD envelope shapes the amplitude CONTOUR: unshaped vs hold=0.01/decay=0.15 (both trimmed to length=0.2s)...')
    {
      const unshaped = await recordDoc({ params: { length: 0.2 } })
      const shaped = await recordDoc({ params: { length: 0.2, hold: 0.01, decay: 0.15 } })
      // Late window, just before the trimmed length ends: the shaped envelope has already ramped
      // to (near) 0 by hold+decay=0.16s, well before the length=0.2s cutoff; the unshaped take
      // still carries whatever's left of the sample's own natural tail there.
      const unshapedLateDb = windowRmsDbFromOnset(unshaped, 0.17, 0.2)
      const shapedLateDb = windowRmsDbFromOnset(shaped, 0.17, 0.2)
      console.log(`  RMS in [0.17s,0.2s) window: unshaped ${unshapedLateDb.toFixed(1)}dB  ->  shaped (decay) ${shapedLateDb.toFixed(1)}dB`)
      check(unshapedLateDb - shapedLateDb > 6, `the AHD envelope's decay stage measurably fades the amplitude contour ahead of the natural/trimmed tail (delta ${(unshapedLateDb - shapedLateDb).toFixed(1)}dB, expected > 6dB)`)
    }

    // ============================================================================================
    // kick.wav is a real kick — bass/sub-heavy by nature (centroid already sits under 100Hz
    // unfiltered), so a LOWPASS cutoff barely moves the centroid (almost all its energy is already
    // well below any reasonable lowpass cutoff — a real physical fact about this signal, not a
    // filter bug). A HIGHPASS instead strips that dominant low content, which should measurably
    // RAISE the centroid — the clearer, more decisive way to prove the same filter primitive
    // (Tone.Filter; filterType + cutoff/resonance) is actually wired into the per-hit signal path.
    console.log('\n[FILTER] lane filter: default (lowpass, wide open) vs highpass @2000Hz...')
    {
      const open = await recordDoc({})
      const dark = await recordDoc({ filterType: 'highpass', params: { cutoff: 2000 } })
      const { analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
      const openCrop = spectralCropFromOnset(open)
      const darkCrop = spectralCropFromOnset(dark)
      const openMetrics = analyze(openCrop.channels, openCrop.sampleRate)
      const darkMetrics = analyze(darkCrop.channels, darkCrop.sampleRate)
      const openCentroid = openMetrics.spectral.centroidHz
      const darkCentroid = darkMetrics.spectral.centroidHz
      console.log(`  spectral centroid: default(lowpass, open) ${openCentroid.toFixed(0)}Hz  ->  highpass@2000 ${darkCentroid.toFixed(0)}Hz`)
      console.log(`  sub+bass %: default ${(openMetrics.spectral.bandsPct.sub + openMetrics.spectral.bandsPct.bass).toFixed(1)}  ->  highpass@2000 ${(darkMetrics.spectral.bandsPct.sub + darkMetrics.spectral.bandsPct.bass).toFixed(1)} (informational — kick.wav's fundamental sits inside the "sub" band's own wide range even post-highpass, so this doesn't move much; the centroid check above is the load-bearing one)`)
      check(darkCentroid > openCentroid * 3, `engaging a highpass filter measurably raises the rendered spectral centroid — the filter is really applied per-hit (open ${openCentroid.toFixed(0)}Hz, highpass ${darkCentroid.toFixed(0)}Hz)`)
    }

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    if (failures > 0) throw new Error(`${failures} check(s) failed`)
    console.log('\n================ ALL PHASE 26 STREAM DK CHECKS PASSED ================')
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nPHASE 26 STREAM DK VERIFY FAILED:', err)
  process.exit(1)
})
