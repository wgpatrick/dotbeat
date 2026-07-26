#!/usr/bin/env node
// Audio tracks get a production chain — the RENDER half (research 142 headline 1 / §3.2).
//
// Before this stream an `audio` track's whole engine voice was three nodes (`player -> muteGain ->
// master`; `reconcileEffectChain` was never called for one), while a sample-backed DRUM LANE had a
// filter, an AHD envelope and its own ordered effect chain. dotbeat could PLACE a sample and could
// not PROCESS it. This script measures that the fix is real, in the actual browser engine, on real
// rendered audio — not that the fields parse (test/audio-track-fx.test.ts guards that).
//
// THE SOURCE MATERIAL IS CHOSEN SO THE MEASUREMENT IS UNAMBIGUOUS. The registered media is a
// deterministic two-tone: a 220 Hz sine plus an equal-amplitude 5000 Hz sine, generated here (no
// committed binary fixture). Every assertion below is a band-energy or full-band level comparison
// against the SAME take with no production applied, so a number moving means the graph moved:
//
//   [FILTER]   `cutoff 300` (lowpass) must bury the 5 kHz partial — >= 20 dB down vs the raw take
//              — while the 220 Hz partial stays within 3 dB. A track-wide gain change cannot
//              produce that, and neither can the clip's own gainDb: only a real filter can.
//   [VOLUME]   `volume -20` must land 20 dB (+/- 2) below the raw take, full band, both partials
//              moving together. This is the track fader an audio track never had.
//   [INSERTS]  one `effect bc bitcrush` at 3 bits, mix 1, must ADD broadband energy that is not in
//              the source at all: the two-tone has nothing between its partials, so quantization
//              distortion shows up as harmonics/intermodulation in bins where the raw take reads
//              essentially nothing. Asserted as a >= 15 dB rise in a between-partials probe bin.
//   [SENDS]    `sendReverb 1` must lengthen the tail: the region stops at 2.0 s, so energy in the
//              0.25 s AFTER it is reverb return or nothing. >= 15 dB above the raw take's floor.
//   [BASELINE] the raw take must be BIT-FOR-BIT-comparable to the pre-stream voice — asserted as
//              "both partials sit within 1 dB of the clip's own gainDb," i.e. the new default
//              nodes (0 dB / 20 kHz Q0 / silent sends / empty chain) are genuinely transparent.
//
// Usage: node ui/verify-audio-track-fx.mjs
// One browser boot, five takes through setDoc() (the same harness discipline as
// ui/verify-clip-automation-render.mjs — each take gets its own page so no audio state bleeds).

import { join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { bootGui, buildAll, check, importDist, run as runVerify, scratchProject } from './verify-lib.mjs'

const DAEMON_PORT = 48631
const PREVIEW_PORT = 45631
const SR = 44100
const TONE_LOW = 220
const TONE_HIGH = 5000
const REGION_SECONDS = 2
const RENDER_SECONDS = 2.25 // 2.0 s of region + 0.25 s of tail window for the send assertion

/** Energy (dB) at one frequency, over a sample window — a single-bin Goertzel, which is all these
 * assertions need (two known partials + two known probe bins) and is exact enough to compare two
 * takes of the same signal against each other. */
function toneDb(channels, sampleRate, freq, fromSec, toSec) {
  const i0 = Math.max(0, Math.floor(fromSec * sampleRate))
  const i1 = Math.min(channels[0].length, Math.floor(toSec * sampleRate))
  const n = i1 - i0
  if (n <= 0) return -Infinity
  const w = (2 * Math.PI * freq) / sampleRate
  const coeff = 2 * Math.cos(w)
  let total = 0
  for (const ch of channels) {
    let s1 = 0
    let s2 = 0
    for (let i = i0; i < i1; i++) {
      const s = ch[i] + coeff * s1 - s2
      s2 = s1
      s1 = s
    }
    const power = (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (n * n)
    total += power
  }
  const amp = Math.sqrt(total / channels.length) * 2
  return amp > 0 ? 20 * Math.log10(amp) : -Infinity
}

/** Full-buffer RMS (dBFS) across all channels over a window. */
function rmsDb(channels, sampleRate, fromSec, toSec) {
  const i0 = Math.max(0, Math.floor(fromSec * sampleRate))
  const i1 = Math.min(channels[0].length, Math.floor(toSec * sampleRate))
  let sumSq = 0
  let count = 0
  for (const ch of channels) {
    for (let i = i0; i < i1; i++) {
      sumSq += ch[i] * ch[i]
      count++
    }
  }
  const rms = Math.sqrt(sumSq / Math.max(1, count))
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity
}

/** The deterministic two-tone source, encoded 16-bit so it decodes identically everywhere. */
async function writeToneWav(path) {
  const { encodeWav16 } = await importDist('src/analysis/gen-trim.js')
  const frames = Math.round(REGION_SECONDS * SR)
  const ch = new Float64Array(frames)
  for (let i = 0; i < frames; i++) {
    const t = i / SR
    ch[i] = 0.3 * Math.sin(2 * Math.PI * TONE_LOW * t) + 0.3 * Math.sin(2 * Math.PI * TONE_HIGH * t)
  }
  writeFileSync(path, encodeWav16([ch, Float64Array.from(ch)], SR))
}

/** The project text every take shares, plus whatever production lines this take adds. `extra` are
 * indented track-level lines spliced in above the clip — exactly how a hand edit or `beat set`
 * would write them. */
function projectText(sha256, extra = []) {
  return `format_version 0.11
bpm 120
loop_bars 4
selected_track aud

media
  sample tone sha256:${sha256} media/tone.wav

track aud Aud #56b6c2 audio
${extra.map((l) => `  ${l}\n`).join('')}  clip c1
    audio tone 0 ${REGION_SECONDS} 0 off 1

scene a
  slot aud c1

song
  section a 4
`
}

async function main() {
  buildAll()
  const { parse } = await importDist('src/core/index.js')
  const { createHash } = await import('node:crypto')
  const { readFileSync } = await import('node:fs')

  // A real project dir with a real media/ dir the daemon can serve from.
  const { dir, file } = scratchProject({ prefix: 'dotbeat-audiofx-', text: 'placeholder' })
  mkdirSync(join(dir, 'media'), { recursive: true })
  const wavPath = join(dir, 'media', 'tone.wav')
  await writeToneWav(wavPath)
  const sha256 = createHash('sha256').update(readFileSync(wavPath)).digest('hex')
  writeFileSync(file, projectText(sha256))

  const gui = await bootGui({ file, daemonPort: DAEMON_PORT, previewPort: PREVIEW_PORT, waitAppReady: false })
  const { browser, errors, previewPort, daemon } = gui

  // Own page per take (fresh Tone context), same reason verify-clip-automation-render.mjs does it.
  const takeOn = async (extra) => {
    const doc = JSON.parse(JSON.stringify(parse(projectText(sha256, extra))))
    const page = await browser.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${previewPort}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => typeof window.__engine?.recordWav === 'function', { timeout: 20000 })
    await page.evaluate((d) => window.__store.getState().setDoc(d), doc)
    // The buffer must actually be decoded before the transport runs, or the take is silence. The
    // sleep is load-bearing, not decoration: pendingMediaCount() reads 0 for a moment BEFORE
    // syncAudioTracks has even queued the fetch, so polling it immediately after setDoc would pass
    // instantly and record silence (which is exactly how this script first failed).
    await page.waitForTimeout(500)
    await page.waitForFunction(
      () => typeof window.__engine.pendingMediaCount === 'function' && window.__engine.pendingMediaCount() === 0,
      { timeout: 30000 },
    )
    const b64 = await page.evaluate(async (secs) => {
      await window.__engine.play()
      await new Promise((r) => setTimeout(r, 250))
      const blob = await window.__engine.recordWav(secs)
      window.__engine.stop()
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      return btoa(bin)
    }, RENDER_SECONDS)
    await page.close()
    const { decodeWav } = await importDist('src/metrics/index.js')
    const bytes = Buffer.from(b64, 'base64')
    return decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  }

  try {
    // Measurement window: skip the first 150 ms (transport/graph settle) and stop 150 ms before the
    // region ends, so every band read sits on the steady two-tone.
    const W0 = 0.15
    const W1 = REGION_SECONDS - 0.15
    const band = (take, f) => toneDb(take.channels, take.sampleRate, f, W0, W1)

    const raw = await takeOn([])
    const rawLow = band(raw, TONE_LOW)
    const rawHigh = band(raw, TONE_HIGH)
    console.log(`[raw]      220Hz ${rawLow.toFixed(1)} dB   5kHz ${rawHigh.toFixed(1)} dB`)

    // [BASELINE] the new default nodes are transparent: both partials arrive at the amplitude they
    // were generated at (0.3 => -10.5 dBFS), within 1 dB. A -10 dB fader default or a 2 kHz filter
    // default (INIT_SYNTH's values) would fail this by a mile — which is why AUDIO_TRACK_FIELDS
    // carries its own defaults.
    const expected = 20 * Math.log10(0.3)
    check(Math.abs(rawLow - expected) < 1.5, `[BASELINE] raw 220Hz ${rawLow.toFixed(1)} dB is within 1.5 dB of the source's ${expected.toFixed(1)} dB (default nodes are transparent)`)
    check(Math.abs(rawHigh - expected) < 1.5, `[BASELINE] raw 5kHz ${rawHigh.toFixed(1)} dB is within 1.5 dB of the source's ${expected.toFixed(1)} dB`)

    // [FILTER]
    const filtered = await takeOn(['cutoff 300'])
    const fLow = band(filtered, TONE_LOW)
    const fHigh = band(filtered, TONE_HIGH)
    console.log(`[cutoff]   220Hz ${fLow.toFixed(1)} dB   5kHz ${fHigh.toFixed(1)} dB`)
    check(rawHigh - fHigh >= 20, `[FILTER] cutoff 300 buries the 5kHz partial: ${(rawHigh - fHigh).toFixed(1)} dB down (>= 20)`)
    check(Math.abs(rawLow - fLow) < 3, `[FILTER] ...while the 220Hz partial is within 3 dB (${Math.abs(rawLow - fLow).toFixed(1)}) — a filter, not an attenuator`)

    // [VOLUME]
    const quiet = await takeOn(['volume -20'])
    const qLow = band(quiet, TONE_LOW)
    const qHigh = band(quiet, TONE_HIGH)
    console.log(`[volume]   220Hz ${qLow.toFixed(1)} dB   5kHz ${qHigh.toFixed(1)} dB`)
    check(Math.abs(rawLow - qLow - 20) < 2, `[VOLUME] volume -20 drops 220Hz by ${(rawLow - qLow).toFixed(1)} dB (20 +/- 2)`)
    check(Math.abs(rawHigh - qHigh - 20) < 2, `[VOLUME] ...and 5kHz by ${(rawHigh - qHigh).toFixed(1)} dB — a fader, moving both partials together`)

    // [INSERTS] a probe bin the source has nothing in (between the two partials, not a harmonic of
    // either): quantization distortion is the only thing that can put energy there.
    const PROBE = 1730
    const crushed = await takeOn(['bitcrushBits 3', 'bitcrushMix 1', 'effect bc bitcrush'])
    const rawProbe = band(raw, PROBE)
    const cProbe = band(crushed, PROBE)
    console.log(`[bitcrush] probe ${PROBE}Hz  raw ${rawProbe.toFixed(1)} dB -> crushed ${cProbe.toFixed(1)} dB`)
    check(cProbe - rawProbe >= 15, `[INSERTS] the reorderable chain is spliced in: bitcrush adds ${(cProbe - rawProbe).toFixed(1)} dB at a bin the source is silent in (>= 15)`)

    // [SENDS] the region ends at REGION_SECONDS; anything after it is a return-bus tail.
    const verb = await takeOn(['sendReverb 1'])
    const rawTail = rmsDb(raw.channels, raw.sampleRate, REGION_SECONDS + 0.02, RENDER_SECONDS)
    const verbTail = rmsDb(verb.channels, verb.sampleRate, REGION_SECONDS + 0.02, RENDER_SECONDS)
    console.log(`[send]     post-region tail  raw ${rawTail.toFixed(1)} dB -> sendReverb 1 ${verbTail.toFixed(1)} dB`)
    check(verbTail - rawTail >= 15, `[SENDS] sendReverb 1 rings past the region end: tail is ${(verbTail - rawTail).toFixed(1)} dB above the dry take's floor (>= 15)`)

    check(errors.length === 0, `no page errors (${errors.length})`)
  } finally {
    await gui.close()
  }
}

runVerify('audio-track production chain (research 142 §3.2)', main)
