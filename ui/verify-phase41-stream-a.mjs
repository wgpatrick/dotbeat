#!/usr/bin/env node
// Phase 41 Stream A verification — AN AUDIO REGION SOUNDS FROM ITS VERY FIRST DOWNBEAT.
//
// The bug this exists to prevent from coming back: audio-region media is fetched+decoded by the
// engine's syncAudioTracks(), which only runs from sync(), which only runs from play() and
// tick(). So play() used to kick the decodes and start the transport in the SAME turn, and
// tick()'s per-placement trigger test (`floor(startStep) === step`, true for exactly one step per
// pass of the playhead) came round while the buffer was still decoding and hit `if (!buf)
// continue`. The miss did not retry — the region stayed silent until the whole song looped. On a
// 4-bar/120bpm project that is 8 seconds of silence, i.e. the entire first pass.
//
// WHY THE EXISTING FLEET COULD NOT CATCH IT, and why this script is shaped the way it is:
// verify-lib's recordWav() defaults to `play: true, settleMs: 250` — it PLAYS FIRST, waits 250ms,
// and only then arms the recorder. Every audio-region script in the fleet therefore measures the
// second pass onward and structurally cannot see a missed downbeat. cli/render.mjs does the
// opposite (arm the recorder, then play, precisely so the downbeat lands on tape), which is why
// `beat render` was the only surface where this was visible. So this script deliberately uses
// RENDER'S order, not the fleet's default.
//
// Sections:
//   A  READINESS GATE IS NOT VACUOUS — before Phase 41, cli/render.mjs polled
//      engine.pendingMediaCount() to zero before playing, but nothing had kicked any load yet, so
//      it read 0 instantly and passed against a graph with no decoded audio at all. Assert that a
//      freshly-loaded page has 0 decoded audio buffers, that warmMediaLoads() makes
//      pendingMediaCount() meaningful, and that after it resolves the buffer IS decoded — all
//      without the transport ever starting.
//   B  THE DOWNBEAT IS ON TAPE — recorder armed BEFORE play (render's order), capture the first
//      2.0s of a 4-bar song whose only content is one 8-second 440Hz tone region placed at step 0.
//      Assert the first 250ms is already at full level and the whole 2s window is continuously
//      audible. Under the old behaviour this window is silence: the region did not start until
//      the song wrapped at 8.0s.
//   C  IT IS THE RIGHT AUDIO, NOT A CLICK — the captured window's dominant frequency is ~440Hz
//      (zero-crossing estimate), so section B cannot be satisfied by a transient or by noise.
//
// Usage: CHROME_PATH=/opt/pw-browsers/chromium node ui/verify-phase41-stream-a.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { beat, bootGui, buildAll, check, run, scratchProject, importDist } from './verify-lib.mjs'

buildAll()

const BPM = 120
const SONG_BARS = 4
const SONG_SECONDS = (SONG_BARS * 16 * 60) / BPM / 4 // 8.0s — one full pass
const TONE_HZ = 440
const TONE_SECONDS = 8
const CAPTURE_SECONDS = 2.0 // well inside the first pass; a wrap-only retrigger cannot reach it

/** A mono 16-bit PCM WAV of a steady sine — the same shape the repro that found this bug used. */
function writeToneWav(path, hz, seconds, sampleRate = 44100) {
  const n = Math.round(seconds * sampleRate)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * hz * i) / sampleRate)), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([header, data]))
}

/** RMS in dBFS over [from, to) seconds of channel 0. */
function rmsDb(channels, sampleRate, from, to) {
  const ch = channels[0]
  const a = Math.max(0, Math.round(from * sampleRate))
  const b = Math.min(ch.length, Math.round(to * sampleRate))
  if (b <= a) return -Infinity
  let sum = 0
  for (let i = a; i < b; i++) sum += ch[i] * ch[i]
  const rms = Math.sqrt(sum / (b - a))
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity
}

/** Zero-crossing frequency estimate over a window — enough to tell 440Hz from a click or noise. */
function dominantHz(channels, sampleRate, from, to) {
  const ch = channels[0]
  const a = Math.max(0, Math.round(from * sampleRate))
  const b = Math.min(ch.length, Math.round(to * sampleRate))
  let crossings = 0
  for (let i = a + 1; i < b; i++) if (ch[i - 1] < 0 && ch[i] >= 0) crossings++
  return (crossings * sampleRate) / Math.max(1, b - a)
}

await run('phase41-stream-a', async () => {
  const { dir, file } = scratchProject({ prefix: 'dotbeat-p41a-', bpm: BPM, bars: SONG_BARS })
  mkdirSync(join(dir, 'media'), { recursive: true })
  writeToneWav(join(dir, 'media', 'tone.wav'), TONE_HZ, TONE_SECONDS)

  beat(['add-track', file, 'tone', 'audio'])
  beat(['rm-track', file, 'lead'])
  beat(['sample', file, 'tone', 'media/tone.wav'])
  beat(['audio-clip', file, 'tone', 'c1', 'tone', '0', String(TONE_SECONDS)])
  beat(['scene', file, 's1', 'tone=c1'])
  beat(['song', file, 's1', String(SONG_BARS)])

  const gui = await bootGui({ file })
  try {
    // ---- A: the readiness gate is not vacuous ------------------------------------------------
    const gate = await gui.page.evaluate(async () => {
      const e = window.__engine
      const before = { pending: e.pendingMediaCount(), buffers: e.exportAudioBuffers().size }
      // warmMediaLoads() resolves once the loads are KICKED, not once they land — so the moment
      // it returns, the region's media must be ACCOUNTED FOR: either in flight (pending) or
      // already decoded. The pre-Phase-41 gate had it in neither, which is exactly what made
      // "pendingMediaCount() === 0" mean "nothing has started" rather than "everything is ready".
      await e.warmMediaLoads()
      const kicked = { pending: e.pendingMediaCount(), buffers: e.exportAudioBuffers().size }
      // Drain them the way render.mjs polls.
      const deadline = performance.now() + 10000
      while (e.pendingMediaCount() > 0 && performance.now() < deadline) await new Promise((r) => setTimeout(r, 20))
      return {
        before,
        kicked,
        after: { pending: e.pendingMediaCount(), buffers: e.exportAudioBuffers().size },
        playing: window.__store.getState().playing,
      }
    })
    check(gate.before.buffers === 0, `[GATE] a freshly-loaded page has no decoded audio buffers (got ${gate.before.buffers})`)
    check(
      gate.kicked.pending + gate.kicked.buffers >= 1,
      `[GATE] warmMediaLoads() accounts for the region's media without playing — in flight or decoded (pending ${gate.kicked.pending} + decoded ${gate.kicked.buffers}; both 0 is the vacuous gate this stream fixed)`,
    )
    check(gate.after.pending === 0, `[GATE] the enqueued load drains to 0 pending (got ${gate.after.pending})`)
    check(gate.after.buffers === 1, `[GATE] the region's buffer is decoded WITHOUT the transport ever starting (got ${gate.after.buffers} buffer(s))`)
    check(gate.playing === false, `[GATE] warming media does not start playback (playing=${gate.playing})`)

    // ---- B: play() does not start the transport ahead of its own audio ------------------------
    // THE DETERMINISTIC GATE. The audible symptom (section C) is a RACE — decode-vs-first-tick —
    // and a fast machine on a small file can win it: measured 36ms to decode one 8-second tone
    // against roughly 30ms to the first tick, so the tone repro passed on the BROKEN engine here
    // while a 30-chop reference track (78ms to its first buffer) failed every time. An assertion
    // that only listens is therefore not a gate at all. This one asserts the invariant instead:
    // the instant play() RETURNS, the media its own sync() just kicked is already decoded.
    // Pre-Phase-41 that is impossible by construction — play() had no await after sync(), so it
    // returned with the fetch still in flight (pending 1, decoded 0) and the transport already
    // running. Post-fix play() waits, so it returns with pending 0 and the buffer in hand.
    await gui.page.reload({ waitUntil: 'load' })
    await gui.page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 15000 })
    const atStart = await gui.page.evaluate(async () => {
      const e = window.__engine
      await e.play() // no warmMediaLoads first — the cold first-press-of-Play path
      const snapshot = { pending: e.pendingMediaCount(), buffers: e.exportAudioBuffers().size }
      e.stop()
      return snapshot
    })
    check(atStart.pending === 0, `[COLD PLAY] play() returns with no audio-region media still in flight (pending ${atStart.pending}; pre-fix this was the region's undecoded buffer, and the transport was already running)`)
    check(atStart.buffers === 1, `[COLD PLAY] play() returns with the region's buffer decoded and ready to trigger (decoded ${atStart.buffers}, want 1)`)

    // ---- C: the downbeat is on tape ---------------------------------------------------------
    // Render's order: arm the recorder, THEN play. A fresh page (no warmMediaLoads) so this
    // measures the real cold-start path a musician hits on their first press of Play.
    await gui.page.reload({ waitUntil: 'load' })
    await gui.page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 15000 })
    const b64 = await gui.page.evaluate(async (secs) => {
      const e = window.__engine
      await e.ensureStarted()
      const recording = e.recordWav(secs)
      await new Promise((r) => setTimeout(r, 200)) // recorder rolling before the downbeat
      await e.play()
      const blob = await recording
      e.stop()
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      return btoa(bin)
    }, CAPTURE_SECONDS + 0.4)
    const { decodeWav } = await importDist('src/metrics/index.js')
    const raw = Buffer.from(b64, 'base64')
    const { channels, sampleRate } = decodeWav(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength))

    // Find the onset, then measure relative to it — MediaRecorder spin-up is wall-clock jittery
    // (300-800ms, cli/render.mjs's own note), so an absolute offset would be measuring the
    // recorder, not the engine. What matters is that an onset exists AT ALL inside a window the
    // old wrap-only retrigger could never reach.
    const ch = channels[0]
    let onset = -1
    for (let i = 0; i < ch.length; i++) {
      if (Math.abs(ch[i]) > 0.01) {
        onset = i / sampleRate
        break
      }
    }
    check(onset >= 0, `[DOWNBEAT] the region sounds at all within ${(CAPTURE_SECONDS + 0.4).toFixed(1)}s of pressing Play (old behaviour: first sound at ${SONG_SECONDS.toFixed(1)}s, when the song wrapped)`)
    check(onset >= 0 && onset < 1.0, `[DOWNBEAT] the onset is at the downbeat, not a song-wrap away (onset ${onset.toFixed(3)}s, must be < 1.0s; a wrap-only retrigger lands at ${SONG_SECONDS.toFixed(1)}s)`)

    const head = rmsDb(channels, sampleRate, onset + 0.02, onset + 0.25)
    check(head > -20, `[DOWNBEAT] the first 250ms after the onset is at full level, not a click or a fade-in (${head.toFixed(1)} dB, must be > -20)`)

    const body = rmsDb(channels, sampleRate, onset + 0.25, onset + 1.5)
    check(body > -20, `[DOWNBEAT] the region keeps sounding through the window (${body.toFixed(1)} dB over onset+0.25..1.5s, must be > -20)`)
    check(Math.abs(body - head) < 6, `[DOWNBEAT] level is continuous across the window — no dropout (head ${head.toFixed(1)} dB vs body ${body.toFixed(1)} dB, must differ by < 6)`)

    const hz = dominantHz(channels, sampleRate, onset + 0.1, onset + 1.0)
    check(Math.abs(hz - TONE_HZ) < 40, `[IDENTITY] the captured audio IS the region's ${TONE_HZ}Hz tone, not a transient (zero-crossing estimate ${hz.toFixed(0)}Hz, must be within 40Hz)`)

    check(gui.errors.length === 0, `[PAGE] no page errors (${gui.errors.join(' | ')})`)
  } finally {
    await gui.close()
  }
})
