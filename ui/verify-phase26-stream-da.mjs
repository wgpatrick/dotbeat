#!/usr/bin/env node
// Phase 26 Stream DA verification — two silent correctness bugs in ui/src/audio/engine.ts, both
// diagnosed in docs/research/69-ableton-comparison-master-synthesis.md §0 and docs/phase-26-plan.md:
//
//   BUG 1  reverb/delay sends were wired PRE-fader (tapped off `panner`, upstream of the track's
//          own `vol` node) in both buildSynthChain() and getDrumBus() — so riding a track's fader
//          never attenuated the wet signal reaching the shared reverb/delay buses. Fixed by moving
//          both `reverbSend`/`delaySend` taps downstream of `vol` (still downstream of `muteGain`).
//   BUG 2  clip automation and LFO modulation clobbered each other on every shared destination
//          except `cutoff` — a generic automation pass wrote the drawn curve's value, then
//          applyLfoAdditive() ran strictly later in the same tick and silently overwrote it with
//          `p.<field> + depth*lfo` (relative to the STATIC field value, not whatever automation just
//          wrote). `volume` was a third, opposite-order case (automation always beat the LFO).
//          Fixed by generalizing applyLfoAdditive() to compose against the automated value for that
//          tick when one exists (via a shared `autoVal()` lookup), else the static field value — the
//          same base/offset rule `cutoff` already proved, now applied uniformly (including `volume`).
//
// Both checks drive the REAL engine (no mocked assertions): a real `beat daemon`, the real built
// `ui/` frontend served via `vite preview`, real Tone.js audio recorded off the live graph
// (`window.__engine.recordWav`), and measured with src/metrics's own decodeWav()/analyze() — the
// same evidence bar as ui/verify-volume-fader-bugfix.mjs and ui/verify-phase18-lfo-depth.mjs, whose
// setDoc()-driven recording harness this script reuses directly (bypassing GUI pixel-drags, since
// both bugs live entirely in engine.ts's audio-graph wiring/tick logic, not in any GUI control).
//
//   [SEND-POST-FADER]  a synth track with sendReverb=1 plays one short, fast-decaying pluck (dry
//                       signal fully decayed within ~100ms) so everything audible from ~0.7s
//                       onward is PURELY the reverb tail (send-only, no dry bleed). Record that tail
//                       at volume=+6, -30, and -60dB and confirm its measured RMS tracks the fader
//                       (monotonic, wide margins) rather than staying constant regardless of volume.
//   [AUTOMATION-VS-LFO] a clip draws a pan automation ramp from -0.8 to +0.8 across the loop, with
//                       LFO2 ALSO targeting pan (small depth, a few Hz, unsynced) on the same clip.
//                       Measure the recorded stereo balance over time, boxcar-smooth out the LFO's
//                       fast wiggle, and confirm the smoothed trajectory still rises with the drawn
//                       ramp (tracks -0.8 -> +0.8) instead of flatlining around the static pan field
//                       (0) the way the pre-fix "LFO always wins" bug produced.
//
// Usage: node ui/verify-phase26-stream-da.mjs

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const beatCli = join(repoRoot, 'cli', 'beat.mjs')
const DAEMON_PORT = 48626
const PREVIEW_PORT = 45626

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function beat(args) {
  return execFileSync(process.execPath, [beatCli, ...args], { encoding: 'utf8' })
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
async function decodeBase64Wav(b64) {
  const { decodeWav } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const bytes = Buffer.from(b64, 'base64')
  return decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
}

// RMS (dBFS) of a specific time window across all channels — used to isolate the reverb TAIL (well
// after the dry pluck's envelope has fully died) from the dry attack/decay at the start.
function windowRmsDb(decoded, startSec, endSec) {
  const i0 = Math.max(0, Math.floor(startSec * decoded.sampleRate))
  const i1 = Math.min(decoded.channels[0].length, Math.floor(endSec * decoded.sampleRate))
  let sumSq = 0
  let count = 0
  for (const ch of decoded.channels) {
    for (let i = i0; i < i1; i++) {
      sumSq += ch[i] * ch[i]
      count++
    }
  }
  const rms = Math.sqrt(sumSq / Math.max(1, count))
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity
}

// Per-window left/right balance series ((Lrms-Rrms)/(Lrms+Rrms), -1..1), with window-center
// timestamps — the raw material for tracking a pan trajectory over time (mirrors
// verify-phase18-lfo-depth.mjs's panBalanceCV, but returns the full series instead of just its CV).
function panSeries(decoded, winSeconds) {
  const [L, R] = decoded.channels
  const win = Math.max(4, Math.round(decoded.sampleRate * winSeconds))
  const hop = Math.max(1, Math.round(win / 4))
  const values = []
  const times = []
  for (let i = 0; i + win <= L.length; i += hop) {
    let sl = 0
    let sr = 0
    for (let j = 0; j < win; j++) {
      sl += L[i + j] * L[i + j]
      sr += R[i + j] * R[i + j]
    }
    const l = Math.sqrt(sl / win)
    const r = Math.sqrt(sr / win)
    values.push(l + r > 1e-9 ? (l - r) / (l + r) : 0)
    times.push((i + win / 2) / decoded.sampleRate)
  }
  return { values, times, hopSeconds: hop / decoded.sampleRate }
}

// Boxcar-smooths a series over `smoothSeconds` — long enough to average out the LFO's fast wiggle
// while preserving the much slower automation ramp underneath it.
function boxcarSmooth(values, hopSeconds, smoothSeconds) {
  const k = Math.max(1, Math.round(smoothSeconds / hopSeconds))
  return values.map((_, i) => {
    const lo = Math.max(0, i - k)
    const hi = Math.min(values.length, i + k + 1)
    let s = 0
    for (let j = lo; j < hi; j++) s += values[j]
    return s / (hi - lo)
  })
}
function mean(a) {
  return a.reduce((x, y) => x + y, 0) / a.length
}
function corr(xs, ys) {
  const mx = mean(xs)
  const my = mean(ys)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  return sxy / Math.sqrt(sxx * syy || 1e-12)
}
function stdOfResidual(raw, smoothed) {
  const res = raw.map((v, i) => v - smoothed[i])
  const m = mean(res)
  return Math.sqrt(mean(res.map((v) => (v - m) ** 2)))
}

// A synth track holding one ~1s-long, loud note starting at step 0 (attack 10ms, decay 100ms,
// sustain 0.8, release 100ms — plenty of sustained energy to drive a clearly-measurable reverb
// tail, well above any DSP/dither noise floor, unlike a too-brief transient click) with a given
// `volume` and sendReverb=1/sendDelay=0, no clips/automation/LFO — isolates Bug 1 from Bug 2
// entirely. The note (and its release) is fully finished by ~1.1s, leaving a long, purely-wet
// reverb tail after that for the rest of the recording.
const sendTrack = (volume) => ({
  id: 't1', name: 't1', color: '#e06c75', kind: 'synth',
  synth: {
    osc: 'sawtooth', volume, cutoff: 8000, resonance: 0.5, filterType: 'lowpass',
    attack: 0.01, decay: 0.1, sustain: 0.8, release: 0.1, pan: 0,
    sendReverb: 1, sendDelay: 0,
    lfoRate: 4, lfoDepth: 0, lfoDest: 'off', lfoSync: false, lfoSyncRate: '1/4',
    lfo2Rate: 3, lfo2Depth: 0, lfo2Dest: 'off', lfo2Sync: false, lfo2SyncRate: '1/8',
  },
  // v0.10 note fields (chance/cent/ratchet*) are ALWAYS present in memory per BeatNote's own doc
  // comment — normally filled by addNote/parseNoteLine, but this script sets the document directly
  // via setDoc() (bypassing parse()), so they must be spelled out explicitly here; chanceFires()
  // has no `?? default` fallback and reads `undefined` as "never fires" (confirmed the hard way:
  // the pre-existing ui/verify-phase18-lfo-depth.mjs, which omits these fields, currently fails at
  // its very first check because its note never sounds — same root cause, unrelated to this stream).
  notes: [{ id: 'n1', pitch: 64, start: 0, duration: 8, velocity: 1, chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 }],
  clips: [], laneSamples: {}, hits: [],
})
const mkSendDoc = (volume) => ({
  formatVersion: '0.9', bpm: 120, loopBars: 2, selectedTrack: 't1', media: [], scenes: [], song: null,
  tracks: [sendTrack(volume)],
})

// A song-mode project: one scene, one section, one clip ("verse") holding a note that spans the
// whole 2-bar/32-step loop plus a `pan` automation lane ramping -0.8 -> +0.8 across those same 32
// steps. `lfo2Depth` is the only difference between the two takes below (0 for the ground-truth
// automation-only reference, >0 for the automation+LFO take under test).
const panDoc = (lfo2Depth) => ({
  formatVersion: '0.9', bpm: 120, loopBars: 2, selectedTrack: 't1', media: [],
  scenes: [{ id: 'main', slots: { t1: 'verse' } }],
  song: [{ scene: 'main', bars: 2 }],
  tracks: [{
    id: 't1', name: 't1', color: '#61afef', kind: 'synth',
    synth: {
      osc: 'sawtooth', volume: -6, cutoff: 9000, resonance: 0.5, filterType: 'lowpass',
      attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.1, pan: 0,
      sendReverb: 0, sendDelay: 0,
      lfoRate: 4, lfoDepth: 0, lfoDest: 'off', lfoSync: false, lfoSyncRate: '1/4',
      lfo2Rate: 2.5, lfo2Depth, lfo2Dest: 'pan', lfo2Sync: false, lfo2SyncRate: '1/8',
    },
    notes: [], hits: [], laneSamples: {},
    clips: [{
      id: 'verse',
      notes: [{ id: 'n1', pitch: 57, start: 0, duration: 32, velocity: 0.9, chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 }],
      hits: [],
      automation: [{ param: 'pan', points: [{ id: 'p1', time: 0, value: -0.8 }, { id: 'p2', time: 31, value: 0.8 }] }],
    }],
  }],
})

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  // A throwaway project just to get a daemon+file pair up (neither test edits the file — both
  // record via setDoc() straight into the live engine, same as verify-phase18-lfo-depth.mjs).
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p26-da-'))
  const beatPath = join(proj, 'song.beat')
  beat(['init', beatPath, '--bpm', '120', '--bars', '2'])
  console.log(`project at ${beatPath}`)

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const daemon = await startDaemon({ filePath: beatPath, port: DAEMON_PORT })
  console.log(`daemon on :${daemon.port}`)

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
  // A fresh page (fresh Tone.js context/engine graph) per recording for the send test — a reverb
  // tail from a LOUD prior take could otherwise bleed into the start of the next, quieter take's
  // recording (2.2s decay on the shared reverb bus vs. only a ~250ms settle wait between takes),
  // contaminating exactly the measurement this test depends on. One fresh page per pan-automation
  // take too, for the same "no bleed from the previous take" reasoning applied consistently.
  const freshPage = async () => {
    const page = await browser.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })
    return page
  }
  const recordDoc = (page) => async (doc, secs) => {
    const b64 = await page.evaluate(async ({ doc, secs }) => {
      window.__engine.stop()
      window.__store.getState().setDoc(doc)
      await window.__engine.play()
      await new Promise((r) => setTimeout(r, 250)) // let the graph settle before capture
      const blob = await window.__engine.recordWav(secs)
      window.__engine.stop()
      const buf = await blob.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      return btoa(bin)
    }, { doc, secs })
    return decodeBase64Wav(b64)
  }

  const results = {}
  try {
    // ============================== [SEND-POST-FADER] Bug 1 ==============================
    console.log('\n[SEND-POST-FADER] recording a sendReverb=1 pluck\'s reverb TAIL at three fader positions...')
    const tailWindow = [1.3, 3.7] // note (attack+decay+sustain+release) is fully finished by ~1.1s; everything after is send-only
    const volumes = [6, -30, -60]
    const tailDb = {}
    for (const v of volumes) {
      const page = await freshPage()
      const recordDocOn = recordDoc(page)
      const decoded = await recordDocOn(mkSendDoc(v), 3.9)
      await page.close()
      tailDb[v] = windowRmsDb(decoded, tailWindow[0], tailWindow[1])
      console.log(`  volume ${String(v).padStart(4)}dB -> reverb-tail RMS ${tailDb[v] === -Infinity ? '-Infinity' : tailDb[v].toFixed(1)}dBFS`)
    }
    results.tailDb = tailDb
    // Monotonic, wide margins: this is the direct measurement of "does the wet signal actually
    // respond to the fader." Pre-fix, all three would read roughly the SAME level (the send tap sat
    // upstream of `vol`, so `p.volume` never reached it) — these margins are wide enough that no
    // pre-fix run could pass them.
    if (!(tailDb[6] > tailDb[-30] + 15)) throw new Error(`[SEND-POST-FADER] +6dB tail (${tailDb[6].toFixed(1)}) should be >15dB louder than -30dB tail (${tailDb[-30].toFixed(1)})`)
    if (!(tailDb[-30] > tailDb[-60] + 15)) throw new Error(`[SEND-POST-FADER] -30dB tail (${tailDb[-30].toFixed(1)}) should be >15dB louder than -60dB tail (${tailDb[-60] === -Infinity ? '-Infinity' : tailDb[-60].toFixed(1)})`)
    if (!(tailDb[6] > tailDb[-60] + 50 || tailDb[-60] === -Infinity)) throw new Error(`[SEND-POST-FADER] +6dB and -60dB tails should differ by >50dB (measured ${tailDb[6].toFixed(1)} vs ${tailDb[-60] === -Infinity ? '-Infinity' : tailDb[-60].toFixed(1)})`)
    // -60dB floors to real silence internally (VOLUME_SILENCE_FLOOR_DB / applyVolumeFloor) — the
    // send now taps downstream of that floored `vol`, so the wet tail should be genuinely silent too.
    if (!(tailDb[-60] < -80)) throw new Error(`[SEND-POST-FADER] fader minimum's reverb tail is not genuinely silent — ${tailDb[-60] === -Infinity ? '-Infinity' : tailDb[-60].toFixed(1)}dBFS (expected < -80dBFS)`)
    console.log('  [SEND-POST-FADER] PASS: the reverb send\'s measured output tracks the fader (post-fader tap), not a constant level')

    // ============================== [AUTOMATION-VS-LFO] Bug 2 ==============================
    console.log('\n[AUTOMATION-VS-LFO] recording a pan automation ramp (-0.8 -> +0.8) alone, and again with LFO2 also targeting pan...')
    const winSeconds = 0.02
    const smoothSeconds = 1 / 2.5 // one LFO2 period at lfo2Rate=2.5Hz — enough to average its wiggle out
    const pageAuto = await freshPage()
    const decodedAutoOnly = await recordDoc(pageAuto)(panDoc(0), 3.7)
    await pageAuto.close()
    const pageLfo = await freshPage()
    const decodedAutoLfo = await recordDoc(pageLfo)(panDoc(0.8), 3.7)
    await pageLfo.close()

    const seriesAutoOnly = panSeries(decodedAutoOnly, winSeconds)
    const seriesAutoLfo = panSeries(decodedAutoLfo, winSeconds)
    const smoothedAutoLfo = boxcarSmooth(seriesAutoLfo.values, seriesAutoLfo.hopSeconds, smoothSeconds)

    // Trim the first/last 8% (attack/edge artifacts, smoothing edge effects) before scoring.
    const trim = (arr) => arr.slice(Math.floor(arr.length * 0.08), arr.length - Math.floor(arr.length * 0.08))
    const tTrim = trim(seriesAutoLfo.times)
    const smoothedTrim = trim(smoothedAutoLfo)
    const autoOnlyTrim = trim(seriesAutoOnly.values)

    // panSeries is (Lrms-Rrms)/(Lrms+Rrms) — POSITIVE means left-heavy. The automation ramp moves
    // `pan` from -0.8 (left) to +0.8 (right), so a correctly-tracking recording's balance should
    // FALL over time (start left/positive, end right/negative) — a strong NEGATIVE correlation with
    // time is the "tracks the drawn ramp" signature here, not a positive one.
    const rampCorr = corr(tTrim, smoothedTrim)
    const meanAbsDiff = mean(smoothedTrim.map((v, i) => Math.abs(v - autoOnlyTrim[i])))
    const earlyMean = mean(smoothedTrim.slice(0, Math.floor(smoothedTrim.length * 0.1)))
    const lateMean = mean(smoothedTrim.slice(-Math.floor(smoothedTrim.length * 0.1)))
    // A SEPARATE, longer smoothing pass (radius >> the LFO's own ~0.4s period) isolates "how much
    // wiggle is left after removing the slow ramp" — used only to confirm the LFO is genuinely
    // contributing (not that its depth/rate accidentally landed at a no-op), independent from the
    // shorter smoothSeconds pass above (tuned to preserve the ramp's shape for the tracking checks).
    const longSmoothSeconds = 1.0
    const longSmoothedAutoLfo = boxcarSmooth(seriesAutoLfo.values, seriesAutoLfo.hopSeconds, longSmoothSeconds)
    const longSmoothedAutoOnly = boxcarSmooth(seriesAutoOnly.values, seriesAutoOnly.hopSeconds, longSmoothSeconds)
    const lfoResidualStd = stdOfResidual(trim(seriesAutoLfo.values), trim(longSmoothedAutoLfo))
    const autoOnlyResidualStd = stdOfResidual(autoOnlyTrim, trim(longSmoothedAutoOnly))

    console.log(`  smoothed automation+LFO pan balance: early ${earlyMean.toFixed(2)} -> late ${lateMean.toFixed(2)} (left-panned/early should read positive, right-panned/late negative)`)
    console.log(`  time<->smoothed-pan correlation: ${rampCorr.toFixed(3)} (expected strongly negative: balance falls as the ramp moves pan from left to right)`)
    console.log(`  mean|smoothed(auto+LFO) - auto-only|: ${meanAbsDiff.toFixed(3)}`)
    console.log(`  LFO wiggle residual std (long-smoothed baseline): auto+LFO ${lfoResidualStd.toFixed(3)}  vs  auto-only ${autoOnlyResidualStd.toFixed(3)} (proves the LFO is genuinely active, not a no-op)`)
    results.automationVsLfo = { earlyMean, lateMean, rampCorr, meanAbsDiff, lfoResidualStd, autoOnlyResidualStd }

    // The decisive checks: under the pre-fix bug, applyLfoAdditive() composed against the STATIC
    // `p.pan` field (0), completely discarding the automation curve for any tick where the LFO also
    // targeted pan — so the smoothed trajectory would sit flat near 0 the whole time (rampCorr near
    // 0, earlyMean/lateMean both near 0, large meanAbsDiff against the real automation-only
    // reference curve). Post-fix, the smoothed trajectory should closely retrace that reference.
    if (!(rampCorr < -0.85)) throw new Error(`[AUTOMATION-VS-LFO] smoothed pan balance does not fall with time as the left->right automation ramp does (correlation ${rampCorr.toFixed(3)}, expected < -0.85)`)
    if (!(earlyMean > 0.15)) throw new Error(`[AUTOMATION-VS-LFO] early smoothed pan balance (${earlyMean.toFixed(2)}) should read left-heavy (positive), tracking the ramp's start, not flatline near the static field's balance (0)`)
    if (!(lateMean < -0.15)) throw new Error(`[AUTOMATION-VS-LFO] late smoothed pan balance (${lateMean.toFixed(2)}) should read right-heavy (negative), tracking the ramp's end, not flatline near the static field's balance (0)`)
    if (!(meanAbsDiff < 0.25)) throw new Error(`[AUTOMATION-VS-LFO] automation+LFO's smoothed curve diverges too far from the automation-only reference curve (mean|diff| ${meanAbsDiff.toFixed(3)}, expected < 0.25)`)
    if (!(lfoResidualStd > autoOnlyResidualStd * 1.3 && lfoResidualStd > 0.03)) throw new Error(`[AUTOMATION-VS-LFO] LFO does not appear to be genuinely contributing wiggle atop the ramp (residual std ${lfoResidualStd.toFixed(3)} vs auto-only floor ${autoOnlyResidualStd.toFixed(3)})`)
    console.log('  [AUTOMATION-VS-LFO] PASS: the automation+LFO take oscillates around the drawn automation curve, not around the static pan field')

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ PHASE 26 STREAM DA VERIFY PASSED ================')
    console.log(JSON.stringify(results, (_k, v) => (typeof v === 'number' ? (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v) : v), 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nPHASE 26 STREAM DA VERIFY FAILED:', err)
  process.exit(1)
})
