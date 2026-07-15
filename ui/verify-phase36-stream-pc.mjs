#!/usr/bin/env node
// Phase 36 Stream PC verification — multi-region audio placement SCHEDULING (v0.11, D16 Option A,
// docs/multi-region-audio-design.md). PA's core landed the format (BeatScene.slots holds
// BeatPlacement[] = {clip, at} lists, `at` in fractional 16th steps from the section start); this
// stream makes ui/src/audio/engine.ts actually SCHEDULE them: every placement in the active
// section starts its region at sectionStart + at (per-placement retrigger check replacing the old
// single contentStep === cycleStart one), the same clip placed twice plays twice, a back-to-back
// placement starts as the previous one ends (single Tone.Player per track: the new start restarts
// the player, truncating any previous tail at exactly the next placement's start), and a clip's
// gain lane evaluates PLACEMENT-RELATIVE (lane time 0 = the placement's own start, wherever it
// sits in the section). All of it proven off real rendered audio (window.__engine.recordWav — the
// same engine `beat render`/the live GUI use), never off stored params.
//
// Sections, all measured from real captures:
//   A  TWO PLACEMENTS, TWO REGIONS — one audio track, a 220Hz tone region placed at step 0 and a
//      1760Hz tone region placed at step 16 (mid-section: 2-bar section = 32 steps; @120bpm the
//      placements are 2.0s apart). Assert: a low-tone onset exists, a high-tone onset lands
//      2.0s (+/-0.15) after it, each window's SPECTRAL IDENTITY matches its placement (zero-
//      crossing frequency estimate ~220 vs ~1760 — spectrally unmistakable), and the gap between
//      the two regions is genuinely silent (>=20dB below the tones).
//   B  SAME CLIP PLACED TWICE PLAYS TWICE — the low clip at 0 AND at 16. Assert consecutive
//      low-tone onsets 2.0s apart (a song-wrap-only retrigger would space them 4.0s — the whole
//      section — so this discriminates cleanly).
//   C  BACK-TO-BACK — low at 0 (region exactly 4 steps long) and high at 4. Abutting regions
//      leave no silent gap, so the seam is found spectrally: assert the dominant frequency FLIPS
//      low->high 0.5s (+/-0.12) after the low onset, with no dropout across the seam, and that
//      0.55-0.95s is the HIGH tone (the single-player model starts the next region on time; any
//      previous-region tail would have been truncated at that start — placements are validated
//      non-overlapping so nothing is audibly lost here).
//   E  PLACEMENT-RELATIVE GAIN AUTOMATION — high clip placed at step 16 with a gain lane ramping
//      0dB -> -24dB over lane time 0..4 steps. Placement-relative evaluation makes the region
//      START loud and decay ~24dB across its 0.5s; the OLD absolute/clip-tiled lookup would read
//      the lane at steps 16..20 (flat -24dB, zero slope) — assert the early window is >=4dB
//      louder than the late one AND audibly loud in absolute terms. Both fail under the old rule.
//   D  SINGLE-PLACEMENT NO-REGRESSION — the pre-v0.11 shape (one placement at 0, kick.wav region,
//      1-bar section) renders with the same metrics as before this stream: audible onset,
//      retrigger period exactly one section pass (2.0s +/-0.1), kick fully decayed well before
//      the next pass, peak level in the established range. (The committed
//      ui/verify-phase22-audio-region.mjs suite — repitch/trim/split/gain — is the full
//      pre-change assertion set and must ALSO still pass; run it alongside this script.)
//
// Usage: CHROME_PATH=/opt/pw-browsers/chromium node ui/verify-phase36-stream-pc.mjs

import { readFileSync, writeFileSync, copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8479
const PREVIEW_PORT = 5327
const BPM = 120
const STEP_SECONDS = 60 / BPM / 4 // 0.125s per 16th
const SECTION_BARS = 2 // 32 steps = 4.0s per section pass
const SECTION_SECONDS = SECTION_BARS * 16 * STEP_SECONDS
const TONE_SECONDS = 0.5 // region length: exactly 4 steps @120bpm — back-to-back at `at 4` is legal
const LOW_HZ = 220
const HIGH_HZ = 1760

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

// ---- tone synthesis ---------------------------------------------------------------------------

/** Mono 16-bit PCM WAV of a sine at `hz`: 5ms fade-in (so onset detection sees a clean rise) and a
 * 30ms fade-out at the file's end. The file is slightly LONGER than the region (out=0.5) so the
 * region end is a real engine-side truncation, same as any user trim. */
function sineWav(hz, seconds = TONE_SECONDS + 0.1, sampleRate = 44100, amp = 0.8) {
  const n = Math.round(seconds * sampleRate)
  const fadeIn = Math.round(0.005 * sampleRate)
  const fadeOut = Math.round(0.03 * sampleRate)
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    let a = amp
    if (i < fadeIn) a *= i / fadeIn
    if (i >= n - fadeOut) a *= (n - i) / fadeOut
    pcm[i] = Math.round(32767 * a * Math.sin((2 * Math.PI * hz * i) / sampleRate))
  }
  const data = Buffer.from(pcm.buffer)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

// ---- analysis helpers (same envelope/onset approach as verify-phase22-audio-region.mjs) --------

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

/** Every upward crossing of -30dB-below-peak, as a time in seconds. */
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

/** Zero-crossing frequency estimate over [tStart, tEnd): sign changes / (2 * seconds). For a clean
 * sine this IS the frequency (a few % off through the lossy opus capture — far tighter than the
 * 8x gap between the two test tones), which makes it a direct per-window SPECTRAL IDENTITY check:
 * ~220 means the low region is sounding there, ~1760 the high one. */
function zcFreq(decoded, tStart, tEnd) {
  const sr = decoded.sampleRate
  const ch = decoded.channels[0]
  const i0 = Math.max(0, Math.round(tStart * sr))
  const i1 = Math.min(ch.length, Math.round(tEnd * sr))
  if (i1 - i0 < 2) return 0
  let crossings = 0
  for (let i = i0 + 1; i < i1; i++) {
    if ((ch[i - 1] < 0 && ch[i] >= 0) || (ch[i - 1] >= 0 && ch[i] < 0)) crossings++
  }
  return crossings / (2 * ((i1 - i0) / sr))
}

const isLow = (f) => f > LOW_HZ * 0.75 && f < LOW_HZ * 1.35
const isHigh = (f) => f > HIGH_HZ * 0.72 && f < HIGH_HZ * 1.35

/** Onsets, each classified by the zero-crossing frequency of its first 0.3s. `edge` marks an
 * onset in the capture's first 0.3s: the recording starts at an arbitrary phase of the loop, so
 * such an onset may be a PARTIAL region (capture began mid-tone) — never use one as the timing
 * reference an assertion measures offsets from. */
function classifiedOnsets(decoded) {
  return findOnsets(decoded).map((t) => {
    const freq = zcFreq(decoded, t + 0.03, t + 0.33)
    return { t, freq, kind: isLow(freq) ? 'low' : isHigh(freq) ? 'high' : 'other', edge: t < 0.3 }
  })
}

// ---- BeatDocument builder -----------------------------------------------------------------------

const MEDIA = {
  low: { id: 'smp_low', path: 'tone-low.wav' },
  high: { id: 'smp_high', path: 'tone-high.wav' },
  kick: { id: 'smp_kick', path: 'kick.wav' },
}

/** In-memory doc in the shape the ENGINE reads (ui/src/types.ts): one audio track whose clips are
 * the low/high tone regions (+ the kick region for the no-regression doc), one scene whose slot
 * for the track is the given PLACEMENT LIST. Media ids/paths match the daemon's own document so
 * the engine's media fetches resolve. */
function mkDoc({ placements, gainPointsByClip = {}, loopBars = SECTION_BARS, sectionBars = SECTION_BARS }) {
  const clip = (id, mediaId, out) => ({
    id,
    notes: [],
    hits: [],
    automation: gainPointsByClip[id] ? [{ param: 'gain', points: gainPointsByClip[id].map((p, i) => ({ id: `p${i + 1}`, time: p.time, value: p.value })) }] : [],
    loop: null,
    signature: null,
    audio: { media: mediaId, in: 0, out, gainDb: 0, warp: 'off', rate: 1, markers: [] },
  })
  return {
    formatVersion: '0.11',
    bpm: BPM,
    loopBars,
    selectedTrack: 'atrk',
    media: Object.values(MEDIA).map((m) => ({ id: m.id, sha256: 'placeholder', path: m.path })),
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
        clips: [clip('clow', MEDIA.low.id, TONE_SECONDS), clip('chigh', MEDIA.high.id, TONE_SECONDS), clip('ckick', MEDIA.kick.id, 0.26)],
      },
    ],
    groups: [],
    scenes: [{ id: 's1', slots: { atrk: placements } }],
    song: [{ scene: 's1', bars: sectionBars }],
  }
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { decodeWav } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { addAudioClip, addTrack, initDocument, placeClip, serialize, setMediaSample, setScene } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // Real project directory + real media files. The daemon's OWN document is what GET /media/<path>
  // validates against, and it's built through ordinary core primitives — including the v0.11 ones
  // this phase added (setScene with a placement list + placeClip), so the placements the engine
  // schedules here ALSO round-trip through core validation (non-overlap, audio-only) on the way in.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-pc-verify-'))
  writeFileSync(join(proj, MEDIA.low.path), sineWav(LOW_HZ))
  writeFileSync(join(proj, MEDIA.high.path), sineWav(HIGH_HZ))
  copyFileSync(join(repoRoot, 'presets/kit-init/kick.wav'), join(proj, MEDIA.kick.path))
  const sha = (p) => createHash('sha256').update(readFileSync(join(proj, p))).digest('hex')
  let daemonDoc = initDocument({ bpm: BPM, loopBars: SECTION_BARS, trackId: 'lead' })
  for (const m of Object.values(MEDIA)) daemonDoc = setMediaSample(daemonDoc, m.id, sha(m.path), m.path)
  daemonDoc = addTrack(daemonDoc, { id: 'atrk', kind: 'audio' }).doc
  daemonDoc = addAudioClip(daemonDoc, 'atrk', 'clow', { media: MEDIA.low.id, in: 0, out: TONE_SECONDS }).doc
  daemonDoc = addAudioClip(daemonDoc, 'atrk', 'chigh', { media: MEDIA.high.id, in: 0, out: TONE_SECONDS }).doc
  daemonDoc = setScene(daemonDoc, 's1', { atrk: [{ clip: 'clow', at: 0 }] })
  daemonDoc = placeClip(daemonDoc, 's1', 'atrk', 'chigh', 16).doc // core-validated two-placement scene
  const beatPath = join(proj, 'proj.beat')
  writeFileSync(beatPath, serialize(daemonDoc))
  console.log(`project at ${beatPath}`)

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

    // Capture >= 2 full section passes so at least one placement-0 onset has a full pass of clean
    // trailing room regardless of what phase the (unsynchronized) recording starts at — the same
    // "don't assume an absolute offset, work relative to a found onset" discipline as
    // verify-phase22-audio-region.mjs.
    const recordDoc = async (docOpts, secs = SECTION_SECONDS * 2 + 1) => {
      const doc = mkDoc(docOpts)
      const b64 = await page.evaluate(async ({ doc, secs }) => {
        window.__store.getState().setDoc(doc)
        await window.__engine.play()
        await new Promise((r) => setTimeout(r, 250)) // let the graph + media fetches settle
        const blob = await window.__engine.recordWav(secs)
        window.__engine.stop()
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        return btoa(bin)
      }, { doc, secs })
      const bytes = Buffer.from(b64, 'base64')
      return decodeWav(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    }

    const fmtOnsets = (ons) => ons.map((o) => `${o.kind}@${o.t.toFixed(2)}s(${Math.round(o.freq)}Hz)`).join(' ')

    // ---------- A: two placements of two spectrally-distinct regions ----------
    console.log('\n[A] low tone placed at step 0, high tone at step 16 (mid-section: +2.0s)...')
    const a = await recordDoc({ placements: [{ clip: 'clow', at: 0 }, { clip: 'chigh', at: 16 }] })
    const aOns = classifiedOnsets(a)
    console.log(`  onsets: ${fmtOnsets(aOns)}`)
    const totalA = a.channels[0].length / a.sampleRate
    const aLow = aOns.find((o) => o.kind === 'low' && !o.edge && totalA - o.t >= 3.0)
    check(!!aLow, `a LOW-tone onset with a full trailing pass exists (${aLow ? `${aLow.t.toFixed(2)}s, ${Math.round(aLow.freq)}Hz` : 'none found'})`)
    if (aLow) {
      const aHigh = aOns.find((o) => o.kind === 'high' && Math.abs(o.t - (aLow.t + 2.0)) <= 0.15)
      check(!!aHigh, `a HIGH-tone onset lands 2.0s (+/-0.15) after it — the at-16 placement sounds at sectionStart + 16 steps${aHigh ? ` (measured +${(aHigh.t - aLow.t).toFixed(3)}s, ${Math.round(aHigh.freq)}Hz)` : ''}`)
      const lowWinDb = windowRmsDb(a, aLow.t + 0.05, aLow.t + 0.45)
      const gapDb = windowRmsDb(a, aLow.t + 0.7, aLow.t + 1.9)
      console.log(`  low-tone window ${lowWinDb.toFixed(1)}dB, inter-placement gap ${gapDb.toFixed(1)}dB`)
      check(lowWinDb - gapDb >= 20, `the gap between the two regions is genuinely silent (${gapDb.toFixed(1)}dB, >=20dB below the tone's ${lowWinDb.toFixed(1)}dB)`)
      const lowIdFreq = zcFreq(a, aLow.t + 0.05, aLow.t + 0.45)
      check(isLow(lowIdFreq), `spectral identity at the 0-step placement is the LOW region (~${Math.round(lowIdFreq)}Hz vs expected ${LOW_HZ})`)
      const highIdFreq = zcFreq(a, aLow.t + 2.0 + 0.05, aLow.t + 2.0 + 0.45)
      check(isHigh(highIdFreq), `spectral identity at the mid-section placement is the HIGH region (~${Math.round(highIdFreq)}Hz vs expected ${HIGH_HZ})`)
    }

    // ---------- B: the same clip placed twice plays twice ----------
    console.log('\n[B] the SAME low clip placed at step 0 AND step 16...')
    const b = await recordDoc({ placements: [{ clip: 'clow', at: 0 }, { clip: 'clow', at: 16 }] })
    const bOns = classifiedOnsets(b).filter((o) => o.kind === 'low')
    console.log(`  low onsets: ${bOns.map((o) => o.t.toFixed(2) + 's').join(' ')}`)
    const bPair = bOns.find((o, i) => i + 1 < bOns.length && Math.abs(bOns[i + 1].t - o.t - 2.0) <= 0.15)
    check(!!bPair, `consecutive LOW onsets 2.0s (+/-0.15) apart — one shared decoded buffer, two independent triggers per section pass (wrap-only retriggering would space them ${SECTION_SECONDS.toFixed(1)}s)`)

    // ---------- C: back-to-back placements ----------
    // Two abutting regions have NO silent gap between them, so the envelope-threshold onset
    // detector (an upward crossing out of silence) structurally cannot see the second region's
    // start — the seam is measured by SPECTRAL IDENTITY over time instead: scan short windows and
    // find where the dominant frequency flips from ~220 to ~1760. That flip time IS the second
    // placement's audible start.
    console.log('\n[C] back-to-back: low at 0 (region is exactly 4 steps) and high at 4...')
    const c = await recordDoc({ placements: [{ clip: 'clow', at: 0 }, { clip: 'chigh', at: 4 }] })
    const cOns = classifiedOnsets(c)
    console.log(`  onsets: ${fmtOnsets(cOns)}`)
    const totalC = c.channels[0].length / c.sampleRate
    const cLow = cOns.find((o) => o.kind === 'low' && !o.edge && totalC - o.t >= 1.2)
    check(!!cLow, `a LOW-tone onset with trailing room exists (${cLow ? cLow.t.toFixed(2) + 's' : 'none found'})`)
    if (cLow) {
      let flipAt = null
      for (let t = cLow.t + 0.2; t <= cLow.t + 0.85; t += 0.01) {
        const f = zcFreq(c, t, t + 0.04)
        if (isHigh(f) && windowRmsDb(c, t, t + 0.04) > -35) {
          flipAt = t + 0.02 // window center
          break
        }
      }
      check(flipAt !== null && Math.abs(flipAt - (cLow.t + 0.5)) <= 0.12, `the tone flips low->high 0.5s (+/-0.12) after the low onset — start-while-previous-finishes works on the single shared player${flipAt !== null ? ` (flip at +${(flipAt - cLow.t).toFixed(3)}s)` : ' (no flip found)'}`)
      const seamDb = windowRmsDb(c, cLow.t + 0.4, cLow.t + 0.6)
      check(seamDb > -30, `no dropout at the seam — the handoff is continuous (${seamDb.toFixed(1)}dB RMS across 0.4-0.6s)`)
      const afterFreq = zcFreq(c, cLow.t + 0.55, cLow.t + 0.95)
      const afterDb = windowRmsDb(c, cLow.t + 0.55, cLow.t + 0.95)
      check(isHigh(afterFreq) && afterDb > -35, `0.55-0.95s after the low onset it's the HIGH tone that is sounding (~${Math.round(afterFreq)}Hz at ${afterDb.toFixed(1)}dB) — the second region owns the player from its own start`)
    }

    // ---------- E: placement-relative gain automation ----------
    console.log('\n[E] high clip at step 16 with a gain lane 0dB -> -24dB over lane steps 0..4...')
    const e = await recordDoc({ placements: [{ clip: 'chigh', at: 16 }], gainPointsByClip: { chigh: [{ time: 0, value: 0 }, { time: 4, value: -24 }] } })
    const eOns = classifiedOnsets(e)
    const totalE = e.channels[0].length / e.sampleRate
    const eHigh = eOns.find((o) => o.kind === 'high' && !o.edge && totalE - o.t >= 0.6)
    check(!!eHigh, `the at-16 placement's HIGH onset exists (${eHigh ? eHigh.t.toFixed(2) + 's' : 'none found'})`)
    if (eHigh) {
      const early = windowRmsDb(e, eHigh.t + 0.03, eHigh.t + 0.15)
      const late = windowRmsDb(e, eHigh.t + 0.3, eHigh.t + 0.45)
      console.log(`  early window ${early.toFixed(1)}dB, late window ${late.toFixed(1)}dB (delta ${(early - late).toFixed(1)}dB)`)
      check(early > -35, `the region STARTS loud — lane time 0 is the placement's own start (${early.toFixed(1)}dB; an absolute-step lookup would read the lane at step 16+, flat -24dB)`)
      check(early - late >= 4, `the ramp is placement-relative: level falls across the region (delta ${(early - late).toFixed(1)}dB >= 4; flat evaluation would show ~0)`)
    }

    // ---------- D: single-placement no-regression ----------
    // The kick's own envelope wobbles around the -30dB onset floor (its transient re-crosses the
    // threshold a few times inside one hit), so raw crossings come in CLUSTERS — debounce them to
    // one onset per hit (min 0.5s apart; a kick is <=0.3s) before measuring the period. The FIRST
    // debounced onset is dropped when it sits at the very edge of the capture (recording starts
    // at an arbitrary phase, possibly mid-kick — a partial hit, not a trigger time).
    console.log('\n[D] pre-v0.11 shape: kick region, one placement at 0, 1-bar section (2.0s period)...')
    const d = await recordDoc({ placements: [{ clip: 'ckick', at: 0 }], loopBars: 1, sectionBars: 1 }, 5)
    const dRaw = findOnsets(d)
    const dOnsets = []
    for (const t of dRaw) if (dOnsets.length === 0 || t - dOnsets[dOnsets.length - 1] >= 0.5) dOnsets.push(t)
    if (dOnsets.length && dOnsets[0] < 0.3) dOnsets.shift()
    console.log(`  raw crossings: ${dRaw.map((t) => t.toFixed(2) + 's').join(' ')} -> debounced hits: ${dOnsets.map((t) => t.toFixed(2) + 's').join(' ')}`)
    const dPeriods = dOnsets.slice(1).map((t, i) => t - dOnsets[i])
    check(dPeriods.length >= 1 && dPeriods.every((p) => Math.abs(p - 2.0) <= 0.15), `retrigger period is one section pass (deltas [${dPeriods.map((p) => p.toFixed(3)).join(', ')}]s vs 2.0 +/-0.15) — same trigger times as the old cycleStart rule`)
    const dRef = dOnsets.find((t) => d.channels[0].length / d.sampleRate - t >= 1.6)
    if (dRef !== undefined) {
      // Loudest 50ms sub-window in the hit's first 0.35s — robust to exactly where in the
      // transient the threshold crossing landed.
      let dOnsetDb = -Infinity
      for (let t = dRef; t <= dRef + 0.3; t += 0.05) dOnsetDb = Math.max(dOnsetDb, windowRmsDb(d, t, t + 0.05))
      const dTailDb = windowRmsDb(d, dRef + 0.5, dRef + 1.5)
      let dPeak = 0
      for (const ch of d.channels) for (let i = 0; i < ch.length; i++) dPeak = Math.max(dPeak, Math.abs(ch[i]))
      const dPeakDb = dPeak > 0 ? 20 * Math.log10(dPeak) : -Infinity
      console.log(`  hit level ${dOnsetDb.toFixed(1)}dB, post-decay tail ${dTailDb.toFixed(1)}dB, capture peak ${dPeakDb.toFixed(1)}dBFS`)
      check(dOnsetDb > -30, `kick hit is audible (${dOnsetDb.toFixed(1)}dB > -30)`)
      check(dOnsetDb - dTailDb >= 10, `region still truncates/decays inside the section (hit ${dOnsetDb.toFixed(1)}dB vs tail ${dTailDb.toFixed(1)}dB)`)
      check(dPeakDb > -30 && dPeakDb <= 0, `peak level in the established range (${dPeakDb.toFixed(1)}dBFS)`)
    } else {
      check(false, 'a kick hit with trailing room exists')
    }

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
  console.error('\nPHASE 36 STREAM PC VERIFY FAILED:', err)
  process.exit(1)
})
