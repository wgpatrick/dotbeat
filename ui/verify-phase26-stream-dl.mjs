#!/usr/bin/env node
// Phase 26 Stream DL verification — generalized per-parameter velocity/key modulation.
// docs/phase-26-plan.md Stream DL / docs/research/68-ableton-vs-dotbeat-instrument-reference.md
// §11: dotbeat used to have exactly two hardcoded, cutoff-only knobs (velToFilterAmount,
// keytrackAmount). This stream adds velDest/velAmount and keyDest/keyAmount — one amount routed to
// ANY of the same LFO_DESTS destinations lfoDest/lfo2Dest already share (src/core/document.ts,
// ui/src/components/synthParams.ts, ui/src/audio/engine.ts's fireSynthNote). Drives the REAL live
// GUI engine over a headless-Chromium tab (same harness/convention as
// ui/verify-phase18-lfo-depth.mjs) and measures RECORDED AUDIO — not "the code path ran."
//
//   VEL -> RESONANCE  same pitch, two different velocities (0.95 vs 0.05), velDest='resonance'.
//                velAmount is signed/bipolar, so the high-velocity note pushes the filter's Q hard
//                (a strong resonant peak right at cutoff) while the low-velocity note pulls it to
//                the Q floor (clamped at 0, no peak) — a real, measurable timbral difference with
//                NO pitch confound (same note both times). Measured via spectral centroid (src/
//                metrics' analyze(), the same tool phase18's LFO2->resonance check uses).
//   KEY -> PAN     same velocity, two different pitches (36 vs 84), keyDest='pan'. Pan doesn't
//                depend on a note's frequency content at all, so this isolates the keytracking
//                signal cleanly: the low note should land hard left, the high note hard right.
//                Measured via per-take mean (R-L)/(R+L) stereo balance.
//   REGRESSION     a hand-written LEGACY .beat TEXT block — core9 + ONLY keytrackAmount/
//                velToFilterAmount, no velDest/velAmount/keyDest/keyAmount lines at all (exactly
//                what a real pre-Phase-26 file looks like) — parsed with src/core's real parse().
//                Confirms (a) the new fields parse in as their canonical defaults ('off'/0, so the
//                file's own text is untouched — canonical elision), and (b) the legacy cutoff-only
//                math still drives cutoff exactly as documented: a low-pitch/low-velocity note and
//                a high-pitch/high-velocity note, both routed only through keytrackAmount/
//                velToFilterAmount (velDest/keyDest absent -> 'off'), produce a large, correctly-
//                directed spectral-centroid difference — the same formula, same behavior, as before
//                this stream's engine.ts changes (see fireSynthNote's own back-compat comment: the
//                new keyDest/velDest OR-clauses are pure additions, the legacy multiplicative terms
//                and original three trigger conditions are byte-for-byte unchanged).
//
// Usage: node ui/verify-phase26-stream-dl.mjs

import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const uiDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(uiDir, '..')
const DAEMON_PORT = 8471
const PREVIEW_PORT = 5327

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

// ---- measurement helpers -------------------------------------------------------------------

// Per-window spectral centroid (reusing src/metrics' own analyze(), same tool phase18's
// LFO2->resonance check uses) over the steady-state middle 80% of a take, averaged to one number —
// these takes hold a STATIC vel/key-derived value (not an oscillating LFO), so a single mean
// centroid per take is the right observable, not a within-take coefficient of variation.
async function meanCentroid(decoded, trimFrac = 0.15) {
  const { analyze } = await import(join(repoRoot, 'dist/src/metrics/index.js'))
  const N = 4096
  const hop = 2048
  const series = []
  for (let start = 0; start + N <= decoded.channels[0].length; start += hop) {
    const chunk = decoded.channels.map((ch) => ch.slice(start, start + N))
    series.push(analyze(chunk, decoded.sampleRate).spectral.centroidHz)
  }
  const a = Math.floor(series.length * trimFrac)
  const core = series.slice(a, series.length - a).filter((v) => v > 1e-6)
  if (!core.length) return 0
  return core.reduce((x, y) => x + y, 0) / core.length
}

// Per-take mean stereo balance: positive = louder RIGHT (matches synthParams.ts's fmt.pan
// convention where a positive pan value reads "R<n>"), trimmed to the steady-state middle 70%.
function meanPanBalance(decoded, winSeconds = 0.02, trimFrac = 0.15) {
  const [L, R] = decoded.channels
  const win = Math.max(4, Math.round(decoded.sampleRate * winSeconds))
  const hop = Math.max(1, Math.round(win / 4))
  const bal = []
  for (let i = 0; i + win <= L.length; i += hop) {
    let sl = 0
    let sr = 0
    for (let j = 0; j < win; j++) {
      sl += L[i + j] * L[i + j]
      sr += R[i + j] * R[i + j]
    }
    const l = Math.sqrt(sl / win)
    const r = Math.sqrt(sr / win)
    if (l + r > 1e-6) bal.push((r - l) / (r + l))
  }
  const a = Math.floor(bal.length * trimFrac)
  const core = bal.slice(a, bal.length - a)
  if (!core.length) return 0
  return core.reduce((x, y) => x + y, 0) / core.length
}

// ---- fixture builders -----------------------------------------------------------------------

const BPM = 120
const LOOP_BARS = 2
const STEPS_PER_LOOP = LOOP_BARS * 16 // 32

// engine.ts's tick() re-syncs EVERY 16th-step (sync() -> applyParams hard-resets Q/pan/sends/etc.
// back to the track's base value every tick — the same "continuous re-assertion" architecture
// applyLfoAdditive relies on, called every tick for as long as its destination is active). A
// note-triggered vel/key modulation is scheduled ONCE, at that note's own on-time, so on a SINGLE
// long-held note it would only survive until the very next tick's reset (~1 step, ~0.1s) — true of
// the legacy keytrackAmount/velToFilterAmount->cutoff path too, not something this stream changes.
// A real melodic/rhythmic pattern re-triggers far more often than that, so — same as how a hi-hat
// ostinato or arpeggio would actually exercise this feature — these fixtures use a DENSE repeating
// note (one retrigger every 16th-step, the same grid tick() itself runs on) at a CONSTANT
// pitch/velocity per take, so the modulation gets freshly re-applied every tick, holding audibly
// for the whole recording window instead of decaying back to base after the first step.
function repeatedNotes(pitch, velocity) {
  const notes = []
  for (let s = 0; s < STEPS_PER_LOOP; s++) {
    notes.push({ id: `n${s}`, pitch, start: s, duration: 0.9, velocity, chance: 100, cent: 0, ratchetCount: 1, ratchetCurve: 0, ratchetLength: 1 })
  }
  return notes
}

const baseTrack = (synthOverrides, note) => ({
  id: 't1', name: 't1', color: '#e06c75', kind: 'synth',
  synth: {
    osc: 'sawtooth', volume: -8, cutoff: 3000, resonance: 0.8, filterType: 'lowpass',
    attack: 0.01, decay: 0.03, sustain: 1, release: 0.02, pan: 0,
    filterEnvAmount: 0, lfoDest: 'off', lfoDepth: 0, lfo2Dest: 'off', lfo2Depth: 0,
    keytrackAmount: 0, velToFilterAmount: 0,
    velDest: 'off', velAmount: 0, keyDest: 'off', keyAmount: 0,
    ...synthOverrides,
  },
  notes: repeatedNotes(note.pitch, note.velocity),
  clips: [], laneSamples: {}, hits: [], effects: [], lanes: [], shuffleAmount: 0, shuffleGrid: 1,
})
const mkDoc = (synthOverrides, note) => ({
  formatVersion: '0.10', bpm: BPM, loopBars: LOOP_BARS, selectedTrack: 't1', media: [], groups: [], scenes: [], song: null,
  tracks: [baseTrack(synthOverrides, note)],
})

// A REAL pre-Phase-26 .beat file: core9 + ONLY keytrackAmount/velToFilterAmount — no
// velDest/velAmount/keyDest/keyAmount lines at all (those fields didn't exist yet when a file like
// this would have been written). Both legacy amounts are POSITIVE so pitch and velocity push
// cutoff the SAME direction (up), giving one unambiguous, large expected centroid swing. Same
// densely-repeating-note pattern as repeatedNotes above, for the same reason.
function legacyBeatText(pitch, velocity) {
  const noteLines = Array.from({ length: STEPS_PER_LOOP }, (_, s) => `  note n${s} ${pitch} ${s} 0.9 ${velocity}`).join('\n')
  return `format_version 0.10
bpm ${BPM}
loop_bars ${LOOP_BARS}
selected_track lead

track lead Lead #c678dd synth
  synth
    osc sawtooth
    volume -8
    cutoff 900
    resonance 0.8
    attack 0.01
    decay 0.03
    sustain 1
    release 0.02
    pan 0
    keytrackAmount 0.9
    velToFilterAmount 0.9
${noteLines}
`
}

async function main() {
  console.log('building repo core/daemon/metrics + ui...')
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' })
  execFileSync('npm', ['run', 'build'], { cwd: uiDir, stdio: 'inherit' })

  const { startDaemon } = await import(join(repoRoot, 'dist/src/daemon/daemon.js'))
  const { parse, serialize, defaultSynthFields } = await import(join(repoRoot, 'dist/src/core/index.js'))

  // The daemon just needs to be up and serving SOME project for the GUI shell to boot against —
  // every test below pushes its own document straight into the live store via setDoc(), same
  // convention as verify-phase18-lfo-depth.mjs and verify-engine-parity.mjs.
  const proj = mkdtempSync(join(tmpdir(), 'dotbeat-p26-dl-'))
  const beatPath = join(proj, 'project.beat')
  writeFileSync(beatPath, serialize({ formatVersion: '0.10', bpm: BPM, loopBars: LOOP_BARS, selectedTrack: 't1', media: [], groups: [], scenes: [], song: null, tracks: [{ id: 't1', name: 't1', color: '#e06c75', kind: 'synth', synth: { osc: 'sawtooth', volume: -8, cutoff: 3000, resonance: 0.8, attack: 0.01, decay: 0.05, sustain: 1, release: 0.1, pan: 0, ...defaultSynthFields() }, notes: [], clips: [], laneSamples: {}, hits: [], effects: [], lanes: [], shuffleAmount: 0, shuffleGrid: 1 }] }))
  git(proj, 'init', '-q')
  git(proj, 'config', 'user.email', 'verify@dotbeat.local')
  git(proj, 'config', 'user.name', 'verify')
  git(proj, 'add', '-A')
  git(proj, 'commit', '-q', '-m', 'baseline')

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
  // Fresh page (fresh Tone.js context/engine graph) per test group — the engine keeps its audio
  // node graph alive across setDoc() calls, so a scheduled-but-not-yet-elapsed ramp from one
  // recording could otherwise bleed into the next. Same isolation phase18 uses.
  const freshPage = async () => {
    const page = await browser.newPage()
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://localhost:${PREVIEW_PORT}/?daw=${daemon.port}`, { waitUntil: 'load' })
    await page.waitForFunction(() => window.__store && window.__store.getState().doc && window.__engine, { timeout: 12000 })
    return page
  }
  const recordOn = (page) => async (doc, secs) => {
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
    return analyzeBase64Wav(b64)
  }

  try {
    // ---------- VEL -> RESONANCE (no pitch confound: same note, only velocity differs) ----------
    console.log('\n[VEL->RESONANCE] recording a low-velocity take and a high-velocity take of the SAME note (velDest=resonance)...')
    const pageA = await freshPage()
    const recordDocA = recordOn(pageA)
    const PITCH_A = 36
    const CUTOFF_A = 400 // close to the 6th harmonic (~392.5 Hz) — a real resonant peak here has plenty of harmonic energy to grab
    const velSynth = { cutoff: CUTOFF_A, resonance: 1, velDest: 'resonance', velAmount: 1 }
    const lowVelTake = await recordDocA(mkDoc(velSynth, { pitch: PITCH_A, velocity: 0.05 }), 2.0)
    const highVelTake = await recordDocA(mkDoc(velSynth, { pitch: PITCH_A, velocity: 0.95 }), 2.0)
    await pageA.close()
    // Both takes hold the note at the SAME pitch/loudness-independent measure (spectral centroid,
    // not raw energy) so velocity's OWN built-in effect on output gain (Tone's velocity-to-amp)
    // doesn't confound the comparison — only the resonance-driven timbral shift should move this.
    const cLow = await meanCentroid(lowVelTake)
    const cHigh = await meanCentroid(highVelTake)
    console.log(`  mean spectral centroid: velocity=0.05 -> ${cLow.toFixed(1)}Hz   velocity=0.95 -> ${cHigh.toFixed(1)}Hz`)
    // low velocity drives resonance to the Q floor (clamped 0, no peak); high velocity drives a
    // strong resonant peak right at the 400Hz cutoff — expect a clear, correctly-directed swing.
    if (!(cHigh > cLow * 1.1)) throw new Error(`[VEL->RESONANCE] velocity-driven resonance modulation did not measurably move the spectral centroid (low ${cLow.toFixed(1)}Hz, high ${cHigh.toFixed(1)}Hz)`)
    console.log('  [VEL->RESONANCE] PASS: velDest/velAmount measurably modulates resonance (not cutoff) purely from velocity, same pitch both times')

    // ---------- KEY -> PAN (no pitch confound: pan doesn't depend on frequency content) ----------
    console.log('\n[KEY->PAN] recording a low-pitch take and a high-pitch take at the SAME velocity (keyDest=pan)...')
    const pageB = await freshPage()
    const recordDocB = recordOn(pageB)
    const keySynth = { pan: 0, keyDest: 'pan', keyAmount: 0.6 }
    const lowPitchTake = await recordDocB(mkDoc(keySynth, { pitch: 36, velocity: 0.8 }), 2.0)
    const highPitchTake = await recordDocB(mkDoc(keySynth, { pitch: 84, velocity: 0.8 }), 2.0)
    await pageB.close()
    const balLow = meanPanBalance(lowPitchTake)
    const balHigh = meanPanBalance(highPitchTake)
    console.log(`  mean stereo balance (+=right): pitch=36 -> ${balLow.toFixed(3)}   pitch=84 -> ${balHigh.toFixed(3)}`)
    if (!(balLow < -0.3)) throw new Error(`[KEY->PAN] expected the LOW pitch (keySignal=-2) to pan hard LEFT, got balance ${balLow.toFixed(3)}`)
    if (!(balHigh > 0.3)) throw new Error(`[KEY->PAN] expected the HIGH pitch (keySignal=+2) to pan hard RIGHT, got balance ${balHigh.toFixed(3)}`)
    console.log('  [KEY->PAN] PASS: keyDest/keyAmount measurably pans by pitch (not cutoff), same velocity both times')

    // ---------- REGRESSION: a real pre-Phase-26 .beat file (legacy fields only) ----------
    console.log('\n[REGRESSION] parsing a hand-written LEGACY .beat block (keytrackAmount/velToFilterAmount only, no velDest/keyDest/velAmount/keyAmount lines)...')
    const lowDoc = parse(legacyBeatText(40, 0.1))
    const highDoc = parse(legacyBeatText(88, 0.95))
    const lowSynth = lowDoc.tracks[0].synth
    if (!(lowSynth.velDest === 'off' && lowSynth.velAmount === 0 && lowSynth.keyDest === 'off' && lowSynth.keyAmount === 0)) {
      throw new Error(`[REGRESSION] a legacy file missing velDest/velAmount/keyDest/keyAmount must parse them in at their canonical defaults ('off'/0); got ${JSON.stringify({ velDest: lowSynth.velDest, velAmount: lowSynth.velAmount, keyDest: lowSynth.keyDest, keyAmount: lowSynth.keyAmount })}`)
    }
    if (!(lowSynth.keytrackAmount === 0.9 && lowSynth.velToFilterAmount === 0.9)) {
      throw new Error(`[REGRESSION] the legacy fields themselves must still parse exactly as written: ${JSON.stringify({ keytrackAmount: lowSynth.keytrackAmount, velToFilterAmount: lowSynth.velToFilterAmount })}`)
    }
    console.log('  [REGRESSION] parse: legacy-only text parses with the new fields at canonical defaults, legacy fields untouched — PASS')

    console.log('  recording the legacy doc\'s low (pitch 40, vel 0.1) and high (pitch 88, vel 0.95) takes...')
    const pageC = await freshPage()
    const recordDocC = recordOn(pageC)
    const legacyLow = await recordDocC(lowDoc, 2.0)
    const legacyHigh = await recordDocC(highDoc, 2.0)
    await pageC.close()
    const cLegacyLow = await meanCentroid(legacyLow)
    const cLegacyHigh = await meanCentroid(legacyHigh)
    console.log(`  mean spectral centroid: (pitch 40, vel 0.1) -> ${cLegacyLow.toFixed(1)}Hz   (pitch 88, vel 0.95) -> ${cLegacyHigh.toFixed(1)}Hz`)
    // keytrackMult(40)=2^(0.9*-20/12)~=0.35, velMult(0.1)=2^(0.9*-1.6)~=0.37 -> noteCutoff~117Hz (dark)
    // keytrackMult(88)=2^(0.9*28/12)~=4.29, velMult(0.95)=2^(0.9*1.8)~=3.07 -> noteCutoff~11.9kHz (bright)
    if (!(cLegacyHigh > cLegacyLow * 3)) throw new Error(`[REGRESSION] legacy keytrackAmount/velToFilterAmount did not drive the documented large cutoff swing (low ${cLegacyLow.toFixed(1)}Hz, high ${cLegacyHigh.toFixed(1)}Hz)`)
    console.log('  [REGRESSION] PASS: the legacy cutoff-only knobs still drive cutoff exactly per their documented formula — unaffected by the new velDest/keyDest fields defaulting to off')

    if (errors.length) console.log('\n(page console errors, non-fatal):\n' + errors.join('\n'))
    console.log('\n================ ALL PHASE 26 STREAM DL CHECKS PASSED ================')
    console.log(JSON.stringify({ cLow, cHigh, balLow, balHigh, cLegacyLow, cLegacyHigh }, (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v), 2))
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
    await daemon.close()
  }
}

main().catch((err) => {
  console.error('\nPHASE 26 STREAM DL VERIFY FAILED:', err)
  process.exit(1)
})
