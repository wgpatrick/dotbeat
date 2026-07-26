#!/usr/bin/env node
// Per-lane polyphony — the RENDER half (research 142 D6, build item 4).
//
// THE BUG, verified at the library level in 142 and measured here for the first time: a
// sample-backed lane is ONE `Tone.Player`, and `Source.start()` on an already-started source calls
// `restart()`, which stops the most recently created source. So a second hit on one lane, arriving
// while the first is still ringing, KILLS the first — the lane cuts its own tail. There is no
// legato and no overlap. On a keymap's decaying bells and plucks that is a chopped, mechanical
// line, and it was part of the 38% pairwise nobody had attributed.
//
// THE MEASUREMENT. One drums track, one sample lane, one long decaying sample (a 1.5 s exponential
// bell). Three takes of the SAME two hits a quarter note apart:
//
//   [ONE]   only the first hit          -> the tail energy after hit 2's position is hit 1's decay
//   [MONO]  both hits, `voices 1`       -> hit 2 RESTARTS the player; hit 1's tail is destroyed
//   [POLY]  both hits, `voices 4`       -> hit 2 rings OVER hit 1's tail
//
// The assertion that matters is not "poly is louder" in general — a second hit adds energy either
// way. It is specifically that the FIRST hit's tail SURVIVES. So the window measured is the slice
// just before hit 2, plus a total-energy comparison, plus the decisive one: MONO's energy in the
// overlap region must be close to a single fresh hit's (because hit 1 was cut), while POLY's must
// be measurably above it (because both are sounding).
//
// Usage: node ui/verify-lane-polyphony.mjs

import { join } from 'node:path'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { bootGui, buildAll, check, importDist, run as runVerify, scratchProject } from './verify-lib.mjs'

const DAEMON_PORT = 48633
const PREVIEW_PORT = 45633
const SR = 44100
const BPM = 120
const STEP_SECONDS = 60 / BPM / 4 // one 16th at 120 bpm = 0.125 s
const HIT2_STEP = 4 // the document's two hits, a quarter note apart, well inside the 1.5 s decay
const GAP_MS = 500 // ...and the same gap, in wall time, for the trigger-driven takes below
// The second hit is deliberately QUIET (research 142 D6). At equal velocity the fresh hit is ~10 dB
// above the first hit's remaining tail, so whether the tail survived moves the total by well under
// a dB — a real difference the measurement could not see. A quiet second hit inverts that: it is
// far below the tail, so "the tail survived" becomes the dominant term, and the BUG becomes
// undeniable rather than marginal — with voices 1, adding a quiet second note makes the lane
// QUIETER than not hitting it at all, because the loud ringing note was destroyed to play it.
// Musically this is the exact case that matters: a soft repeat must not kill a ringing note.
const HIT2_VELOCITY = 0.15
const RENDER_SECONDS = 2.2

/** A 1.5 s exponentially decaying 440 Hz tone: long enough that hit 2 lands deep inside hit 1's
 * tail, which is exactly the situation the monophonic path destroys. */
async function writeBellWav(path) {
  const { encodeWav16 } = await importDist('src/analysis/gen-trim.js')
  const frames = Math.round(1.5 * SR)
  const ch = new Float64Array(frames)
  for (let i = 0; i < frames; i++) {
    const t = i / SR
    ch[i] = 0.5 * Math.exp(-t * 2.2) * Math.sin(2 * Math.PI * 440 * t)
  }
  writeFileSync(path, encodeWav16([ch, Float64Array.from(ch)], SR))
}

/** Build the take's document through the REAL core API rather than hand-written text — a drums
 * track needs its full synth block (the drum BUS's own filter lives there, and a hand-written
 * track without one parses to a cutoff of 0, i.e. silence; that is how this script first failed).
 * addTrack's drums branch supplies the right bus defaults. */
function buildDoc(core, sha256, { voices, twoHits }) {
  const { addHit, addTrack, defaultDrumKitLanes, initDocument, setLaneParam, setLaneSample, setMediaSample } = core
  let doc = initDocument({ trackId: 'lead', bpm: BPM, loopBars: 1 })
  doc = addTrack(doc, { id: 'kit', kind: 'drums', lanes: defaultDrumKitLanes() }).doc
  doc = setMediaSample(doc, 'bell', sha256, 'media/bell.wav')
  doc = setLaneSample(doc, 'kit', 'kick', { sample: 'bell', gainDb: 0, tune: 0 })
  if (voices > 1) doc = setLaneParam(doc, 'kit', 'kick', 'voices', voices).doc
  doc = addHit(doc, 'kit', { lane: 'kick', start: 0, velocity: 1 }).doc
  if (twoHits) doc = addHit(doc, 'kit', { lane: 'kick', start: HIT2_STEP, velocity: HIT2_VELOCITY }).doc
  return doc
}

/** RMS (dBFS) over a window, all channels. */
function rmsDb(decoded, fromSec, toSec) {
  const i0 = Math.max(0, Math.floor(fromSec * decoded.sampleRate))
  const i1 = Math.min(decoded.channels[0].length, Math.floor(toSec * decoded.sampleRate))
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

async function main() {
  buildAll()
  const core = await importDist('src/core/index.js')

  const { dir, file } = scratchProject({ prefix: 'dotbeat-polyphony-', text: 'placeholder' })
  mkdirSync(join(dir, 'media'), { recursive: true })
  const wavPath = join(dir, 'media', 'bell.wav')
  await writeBellWav(wavPath)
  const sha256 = createHash('sha256').update(readFileSync(wavPath)).digest('hex')
  writeFileSync(file, core.serialize(buildDoc(core, sha256, { voices: 1, twoHits: false })))

  const gui = await bootGui({ file, daemonPort: DAEMON_PORT, previewPort: PREVIEW_PORT, waitAppReady: false })
  const { browser, errors, previewPort, daemon } = gui

  // Triggers, NOT transport. The first version of this script played the loop and measured
  // absolute times, and every window was wrong: recordWav() settles for 250 ms before it starts,
  // so the recording began part-way through the loop and hit 1 had already passed. Driving
  // `previewDrum` (the same triggerDrum path the scheduler uses) inside an already-running
  // recorder makes the measurement independent of transport phase; the onset is then located in
  // the captured audio itself.
  const takeOn = async (opts) => {
    const doc = JSON.parse(JSON.stringify(buildDoc(core, sha256, opts)))
    const page = await browser.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${previewPort}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => typeof window.__engine?.recordWav === 'function', { timeout: 20000 })
    await page.evaluate((d) => window.__store.getState().setDoc(d), doc)
    // Lane samples load into the lane voice, NOT the shared audioBuffers cache, so
    // pendingMediaCount does not track them — settle on wall time, then assert audibility, which
    // is the honest check anyway (a silent take fails the [BASELINE] check loudly).
    await page.waitForTimeout(1500)
    const b64 = await page.evaluate(
      async ({ secs, twoHits, gapMs, vel2 }) => {
        // A silent warm-up trigger: starts the audio context and forces the drum state/lane voice
        // to exist before the recorder opens (previewDrum does both), at velocity 0 so it adds
        // nothing to the take.
        await window.__engine.previewDrum('kit', 'kick', 0)
        await new Promise((r) => setTimeout(r, 300))
        const rec = window.__engine.recordWav(secs)
        await new Promise((r) => setTimeout(r, 200))
        await window.__engine.previewDrum('kit', 'kick', 1)
        if (twoHits) {
          await new Promise((r) => setTimeout(r, gapMs))
          await window.__engine.previewDrum('kit', 'kick', vel2)
        }
        const blob = await rec
        const bytes = new Uint8Array(await blob.arrayBuffer())
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        return btoa(bin)
      },
      { secs: RENDER_SECONDS, twoHits: opts.twoHits, gapMs: GAP_MS, vel2: HIT2_VELOCITY },
    )
    await page.close()
    const { decodeWav } = await importDist('src/metrics/index.js')
    const bytes = Buffer.from(b64, 'base64')
    return decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  }

  /** Seconds at which the take's FIRST hit begins — the first sample clearing a third of the
   * take's own peak. Every window below is measured relative to this, so setTimeout jitter in the
   * page and recorder spin-up cannot move the comparison. */
  function onsetSeconds(decoded) {
    let peak = 0
    for (const ch of decoded.channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]))
    const threshold = peak / 3
    for (let i = 0; i < decoded.channels[0].length; i++) {
      for (const ch of decoded.channels) {
        if (Math.abs(ch[i]) >= threshold) return i / decoded.sampleRate
      }
    }
    return 0
  }

  try {
    const one = await takeOn({ voices: 1, twoHits: false })
    const mono = await takeOn({ voices: 1, twoHits: true })
    const poly = await takeOn({ voices: 4, twoHits: true })

    // The overlap window, measured from EACH take's own first onset: 100 ms after hit 2 lands
    // (skipping hit 2's own attack transient, which is identical in all three takes and would
    // dilute the comparison) through 400 ms after it.
    const gap = GAP_MS / 1000
    const win = (take) => {
      const t0 = onsetSeconds(take) + gap
      return rmsDb(take, t0 + 0.1, t0 + 0.4)
    }
    const oneDb = win(one)
    const monoDb = win(mono)
    const polyDb = win(poly)
    console.log(`[onsets] one ${onsetSeconds(one).toFixed(3)}s  mono ${onsetSeconds(mono).toFixed(3)}s  poly ${onsetSeconds(poly).toFixed(3)}s`)
    console.log(`[overlap window]  one-hit ${oneDb.toFixed(2)} dB   mono ${monoDb.toFixed(2)} dB   poly ${polyDb.toFixed(2)} dB`)

    check(oneDb > -60, `[BASELINE] the single-hit take is audible in the overlap window (${oneDb.toFixed(2)} dB) — the sample really is still decaying there`)

    // THE BUG, measured for the first time. With voices 1 a QUIET second hit restarts the one
    // player, so the take with two hits is QUIETER in this window than the take with one: adding a
    // note made the lane lose more than it gained, because the loud ringing note was destroyed to
    // play a soft one. That is the chopped, mechanical keymap line, in numbers.
    check(oneDb - monoDb >= 3, `[MONO — the bug] voices 1: adding a quiet second hit made the lane ${(oneDb - monoDb).toFixed(2)} dB QUIETER than not hitting it at all (>= 3) — hit 1's tail was destroyed`)

    // THE FIX. With a pool, the first hit's tail is still there (plus the quiet second hit on top).
    check(polyDb >= oneDb - 1, `[POLY — the fix] voices 4: the tail survives — ${polyDb.toFixed(2)} dB vs the single hit's own ${oneDb.toFixed(2)} dB (within 1 dB, or louder)`)
    check(polyDb - monoDb >= 5, `[POLY vs MONO] two overlapping notes on one lane now produce ${(polyDb - monoDb).toFixed(2)} dB MORE energy than the monophonic lane at identical hits (>= 5)`)

    check(errors.length === 0, `no page errors (${errors.length})`)
  } finally {
    await gui.close()
  }
}

runVerify('sample-lane polyphony (research 142 D6)', main)
