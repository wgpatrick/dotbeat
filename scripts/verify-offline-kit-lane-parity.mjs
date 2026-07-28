#!/usr/bin/env node
// Every synth-backed kit lane must render NON-SILENT through `beat render --offline`, and within a
// stated tolerance of the live-capture render of the SAME document — `--offline` is advertised as
// "exact, same engine", so a lane that live capture plays and offline drops is the offline path
// lying about what the document sounds like.
//
// Found 2026-07-26 (owner: "i can't hear any claps" about board clips, all rendered offline): D20's
// SeededNoiseSynth disposes each per-trigger ToneBufferSource in its own `onended` callback. In a
// realtime context onended fires after the audio has PLAYED, so that dispose is safe GC. In an
// offline context, Tone fires context.setTimeout callbacks during the SCHEDULING clock pass, which
// the windowed offline driver (ui/src/audio/offline.ts) deliberately runs ahead of the native
// render frontier — so the source was disposed before its audio was rendered, and every noise-voice
// hit (kit snare/rimshot/clap lanes, the synth-track noiseLevel layer) rendered as silence.
// Measured on the repro doc: clap-only kit-909, offline −Infinity dBFS vs live −27.9 LUFS. Tone's
// own OneShotSource._onended skips dispose for offline contexts for exactly this reason; the
// windowed driver owns offline disposal (behind the render frontier).
//
// Why the pre-existing gate (verify-offline-noise-reproducible.mjs) missed it: its energy guard
// (`peak > 1000`) was satisfied by the LAST hit of its 2-bar pattern, which stops close enough to
// the end of the first render window that its dispose fired after part of its audio had already
// been rendered. Determinism held (silence reproduces perfectly); audibility per lane was never
// asserted. This script asserts it, lane by lane, for every synth-backed lane of every factory
// synth kit — and against live capture, so "offline and live are both silent" cannot pass either.
//
// Method: for each kit, ONE document with one hit per lane, each lane alone in its own 2-second
// bar (120 bpm), so a lane's audibility is measured in its own time slot with no overlap. The doc
// is rendered through BOTH paths and per-slot RMS compared.
//
//   node scripts/verify-offline-kit-lane-parity.mjs
//
// This gate cannot silently skip: missing kits, a kit with no synth lanes, an unparseable WAV, or
// a render that dies all throw.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const beat = join(repoRoot, 'cli', 'beat.mjs')

// The two synth-backed factory kits. kit-acoustic is SoundFont-backed, which --offline REFUSES by
// design (worklet needs a realtime context) — a refusal is honest, silence is not, so it is out of
// scope here. If a kit disappears from the factory library this throws (no silent skip).
const KITS = ['kit-808', 'kit-909']
const BPM = 120
const SLOT_SECONDS = 2 // one 4/4 bar at 120 bpm; longest factory decay (ride 1.1s) fits inside
const STEPS_PER_BAR = 16
const HIT_VELOCITY = 0.8

// Offline must never be silent where live is audible. −60 dBFS slot RMS is far under any real
// drum hit (calibration 2026-07-26, post-fix: quietest lane slot across both kits was rimshot at
// −45.3 dBFS RMS) and far above true silence / the opus noise floor.
const SILENCE_FLOOR_DBFS = -60
// Offline-vs-live tolerance. Live capture is MediaRecorder→opus→decode (lossy) so byte parity is
// impossible; calibration 2026-07-26, post-fix: max |delta| across all 24 lanes was 0.4 dB
// (pre-fix, the broken noise lanes were −inf/−18.4 dB off). 3 dB catches a voice halved in power
// while never flaking on codec loss.
const PARITY_TOLERANCE_DB = 3

const dir = mkdtempSync(join(tmpdir(), 'beat-offline-lane-parity-'))
const run = (...args) => execFileSync(process.execPath, [beat, ...args], { encoding: 'utf8', cwd: dir })

/** Int16 PCM samples out of the canonical 16-bit WAV `beat render` writes. */
function pcm(path) {
  const b = readFileSync(path)
  let o = 12
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4)
    const size = b.readUInt32LE(o + 4)
    if (id === 'data') {
      const data = b.subarray(o + 8, o + 8 + size)
      return new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2))
    }
    o += 8 + size + (size % 2)
  }
  throw new Error(`no data chunk in ${path}`)
}

/** Stereo-interleaved slot RMS in dBFS (−Infinity for digital silence). */
function slotRmsDb(samples, sampleRate, channels, startSec, lenSec) {
  const from = Math.floor(startSec * sampleRate) * channels
  const to = Math.min(samples.length, Math.floor((startSec + lenSec) * sampleRate) * channels)
  assert.ok(to > from, `slot ${startSec}s..+${lenSec}s is outside the render (${samples.length / channels / sampleRate}s)`)
  let sum = 0
  for (let i = from; i < to; i++) sum += samples[i] * samples[i]
  const rms = Math.sqrt(sum / (to - from))
  return rms < 1 ? -Infinity : 20 * Math.log10(rms / 32767)
}

const fmt = (db) => (db === -Infinity ? '  -inf' : db.toFixed(1).padStart(6))

try {
  const kitLib = JSON.parse(run('drum-kits', '--json'))
  const failures = []
  console.log('lane audit — slot RMS dBFS (offline vs live capture, same document):')
  for (const kitName of KITS) {
    const kit = kitLib.find((k) => k.name === kitName)
    assert.ok(kit, `factory kit "${kitName}" not found — the kit library changed under this gate`)
    const lanes = kit.lanes.filter((l) => l.backing?.type === 'synth')
    assert.ok(lanes.length >= 10, `${kitName}: expected the full synth lane table, found ${lanes.length}`)

    const file = join(dir, `${kitName}.beat`)
    run('init', file, '--bpm', String(BPM), '--bars', String(lanes.length + 1))
    run('add-track', file, 'kit', 'drums')
    run('drum-kit', file, 'kit', kitName)
    // Bar 0 is an ANCHOR: live capture aligns its start to the first ONSET (cli/render.mjs
    // trimLeadingSilence — recorder-spin-up trim), while offline preserves the true timeline. A
    // kick at t=0 pins the live trim to doc time 0 so both renders share one clock; it is never
    // measured. Without it, the first measured hit's own offset gets trimmed away and every live
    // slot reads ~0.25s early (measured 2026-07-26: 4–7 dB phantom deltas, hat read −inf live).
    run('add-hit', file, 'kit', lanes[0].name, '0', String(HIT_VELOCITY))
    // Each measured hit sits 2 steps (0.25s) INTO its own slot: the measurement window opens
    // 0.05s after the slot boundary (alignment-jitter guard, below), and the shortest factory
    // decay (hat, 0.03s) fits entirely inside that guard if the hit sits exactly on the boundary —
    // measured doing exactly that on 2026-07-26: hat read −inf in BOTH paths while a hat-only
    // render was audible.
    lanes.forEach((lane, i) => run('add-hit', file, 'kit', lane.name, String((i + 1) * STEPS_PER_BAR + 2), String(HIT_VELOCITY)))

    const offWav = join(dir, `${kitName}-off.wav`)
    const liveWav = join(dir, `${kitName}-live.wav`)
    run('render', file, '--offline', '-o', offWav)
    run('render', file, '-o', liveWav)
    const off = pcm(offWav)
    const live = pcm(liveWav)

    console.log(`  ${kitName}: ${'lane'.padEnd(8)} voice     offline    live   delta`)
    lanes.forEach((lane, i) => {
      // Slot i+1 (bar 0 is the anchor). 0.05s in from the slot edge so a few ms of capture-start
      // alignment jitter in the live path can never move a transient across the measurement
      // boundary; the hit itself sits 0.25s in, clear of the guard.
      const offDb = slotRmsDb(off, 44100, 2, (i + 1) * SLOT_SECONDS + 0.05, SLOT_SECONDS - 0.1)
      const liveDb = slotRmsDb(live, 44100, 2, (i + 1) * SLOT_SECONDS + 0.05, SLOT_SECONDS - 0.1)
      const delta = offDb - liveDb
      const deltaStr = Number.isFinite(delta) ? delta.toFixed(1).padStart(6) : '   n/a'
      console.log(`  ${kitName}: ${lane.name.padEnd(8)} ${lane.backing.voice.padEnd(8)} ${fmt(offDb)}  ${fmt(liveDb)}  ${deltaStr}`)
      if (offDb <= SILENCE_FLOOR_DBFS) {
        failures.push(`${kitName}.${lane.name} (${lane.backing.voice}): offline slot RMS ${fmt(offDb).trim()} dBFS — silent/near-silent offline (live: ${fmt(liveDb).trim()} dBFS)`)
      } else if (!Number.isFinite(delta) || Math.abs(delta) > PARITY_TOLERANCE_DB) {
        failures.push(`${kitName}.${lane.name} (${lane.backing.voice}): offline−live delta ${deltaStr.trim()} dB exceeds ±${PARITY_TOLERANCE_DB} dB (offline ${fmt(offDb).trim()}, live ${fmt(liveDb).trim()})`)
      }
    })
  }
  if (failures.length) {
    console.error(`\n[offline-lane-parity] FAIL — ${failures.length} lane(s):`)
    for (const f of failures) console.error(`  ${f}`)
    console.error('\nAn offline-silent lane means per-trigger sources are being disposed before the')
    console.error('offline render frontier reaches them — see SeededNoiseSynth.triggerAttackRelease')
    console.error('(ui/src/audio/engine.ts): dispose is the LIVE path’s GC; offline disposal belongs')
    console.error('to the windowed driver in ui/src/audio/offline.ts (dispose-behind-the-frontier).')
    process.exit(1)
  }
  console.log(`[offline-lane-parity] PASS — every synth lane of ${KITS.join(', ')} audible offline, within ±${PARITY_TOLERANCE_DB} dB of live`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
