#!/usr/bin/env node
// Phase 5 exit test (docs/phase-5-plan.md §5.6): the Night Shift v3 sound — originally only
// reachable by patching ~50 store-level params on top of a v0.2 file — must be reproducible
// from PURE .beat v0.3 TEXT (examples/night-shift.beat).
//
// Two checks, split by what can be exact:
//
// 1. STATE EQUIVALENCE (exact). Build beatlab's store state two ways: (a) the legacy pathway —
//    core-9-only partials + the literal setSynth overlay from the original v3 A/B experiment;
//    (b) the v0.3 pathway — one applyDawState from the parsed file. Every track's full
//    SynthParams must be deep-equal. This is the real claim: the file carries the whole sound.
//
// 2. AUDIO SANITY (tolerant). One offline render of the file, metrics vs the archived v3
//    reference numbers. Tolerances are wider than the phase plan's original ±0.5 LU / ±3 pt /
//    ±2 dB because the offline renderer is measurably nondeterministic run-to-run (JS event
//    loop vs render thread quantizes Tone's event times differently each run — see
//    docs/phase-5-plan.md "Result"): observed same-file spread is ~0.4 LU, ~4 band points,
//    ~2 dB width. Bounds here are ~1.5x that envelope.
//
// Usage: node scripts/verify-phase5.mjs   (run npm run build first; needs the patched
//        node-web-audio-api build for faithful hats — see scripts/build-patched-webaudio.sh)

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const core = await import(pathToFileURL(join(root, 'dist/src/core/index.js')).href)
const beatFile = join(root, 'examples/night-shift.beat')

// The literal overlay from the original v3 A/B experiment (session 2026-07-10) — the sound the
// format was extended to carry. Kept verbatim: if a preset or the file drifts, this fails.
const V3_OVERLAY = {
  drums: { kickPunch: 0.08, kickDecay: 0.5, hatTone: 6500, hatDecay: 0.04, openHatDecay: 0.3,
    compMix: 0.5, distortionAmount: 0.15, distortionMix: 0.2, eqHigh: 2, eqLow: 1 },
  bass: { subLevel: 0.6, osc2Type: 'square', osc2Level: 0.25, osc2Detune: 1203,
    filterEnvAmount: 0.35, filterEnvDecay: 0.18, filterEnvSustain: 0.15, compMix: 0.5,
    distortionAmount: 0.15, distortionMix: 0.2, duckSource: 'drums', duckAmount: 0.45, glide: 0.02, eqLow: 1.5 },
  pad: { osc: 'sawtooth', unisonVoices: 5, unisonWidth: 0.8, osc2Type: 'sawtooth',
    osc2Level: 0.5, osc2Detune: 9, cutoff: 2600, sendReverb: 0.55, sendDelay: 0.15,
    lfoDest: 'cutoff', lfoRate: 0.25, lfoDepth: 0.2, duckSource: 'drums', duckAmount: 0.3,
    eqMid: -1, attack: 0.4, release: 1.2 },
  lead: { osc2Type: 'sawtooth', osc2Level: 0.45, osc2Detune: 14, unisonVoices: 3,
    unisonWidth: 0.5, sendDelay: 0.4, sendReverb: 0.25, cutoff: 5200, resonance: 1.1,
    filterEnvAmount: 0.3, filterEnvDecay: 0.2, eqHigh: 1.5 },
}

// Metrics of the archived night-shift-v3.wav (the reference render the user approved).
const V3_REF = {
  integratedLufs: -17.02,
  bandsPct: { sub: 26.3, bass: 46.8, mids: 25.0, presence: 1.3, air: 0.5 },
  widthDb: -10.8,
}
const TOL = { lufs: 0.75, bandPts: 6, widthDb: 4 }

let failures = 0
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

// ---- 1. state equivalence --------------------------------------------------------------------
{
  const doc = core.parse(readFileSync(beatFile, 'utf8'))
  const full = core.beatDocumentToPartialTracks(doc)

  // legacy pathway: strip partials down to the core 9, as a v0.2 parse would have produced
  const CORE9 = ['osc', 'volume', 'cutoff', 'resonance', 'attack', 'decay', 'sustain', 'release', 'pan']
  const legacy = {
    ...full,
    tracks: full.tracks.map((t) => ({ ...t, synth: Object.fromEntries(CORE9.map((k) => [k, t.synth[k]])) })),
  }

  // drive the real store both ways. applyDawState/setSynth build real audio chains as a side
  // effect, so the web-audio polyfill must be up (importing render-offline.mjs installs it) and
  // Tone needs an offline context to build against.
  await import(pathToFileURL(join(root, 'cli/render-offline.mjs')).href)
  const Tone = await import('tone')
  Tone.setContext(new Tone.OfflineContext(2, 1, 44100))
  const bundle = await import(pathToFileURL(join(root, 'dist-headless/engine.mjs')).href)
  const { useStore } = bundle

  useStore.setState({ mode: 'sandbox', tracks: [] })
  useStore.getState().applyDawState(legacy)
  for (const [trackId, patch] of Object.entries(V3_OVERLAY)) useStore.getState().setSynth(trackId, patch)
  const legacyTracks = useStore.getState().tracks.map((t) => ({ id: t.id, synth: { ...t.synth } }))

  useStore.setState({ mode: 'sandbox', tracks: [] })
  useStore.getState().applyDawState(full)
  const v03Tracks = useStore.getState().tracks.map((t) => ({ id: t.id, synth: { ...t.synth } }))

  check(legacyTracks.length === v03Tracks.length, 'state: same track count')
  for (const legacyTrack of legacyTracks) {
    const v03Track = v03Tracks.find((t) => t.id === legacyTrack.id)
    const diffs = []
    for (const key of Object.keys(legacyTrack.synth)) {
      const a = legacyTrack.synth[key]
      const b = v03Track?.synth[key]
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${key}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
    }
    check(diffs.length === 0, `state: ${legacyTrack.id} SynthParams identical via legacy-setSynth vs pure-v0.3 pathway`, diffs.slice(0, 3).join('; '))
  }
}

// ---- 2. audio sanity -------------------------------------------------------------------------
{
  const out = join(tmpdir(), `verify-phase5-${process.pid}.wav`)
  console.log('rendering (offline, ~20s)...')
  execFileSync(process.execPath, [join(root, 'cli/render-offline.mjs'), beatFile, '-o', out], { stdio: ['ignore', 'ignore', 'inherit'] })
  const { decodeWav, analyze } = await import(pathToFileURL(join(root, 'dist/src/metrics/index.js')).href)
  const { channels, sampleRate } = decodeWav(readFileSync(out))
  const m = analyze(channels, sampleRate)

  check(Math.abs(m.integratedLufs - V3_REF.integratedLufs) <= TOL.lufs, 'audio: integrated LUFS within tolerance of v3 reference', `${m.integratedLufs.toFixed(2)} vs ${V3_REF.integratedLufs} (±${TOL.lufs})`)
  for (const band of Object.keys(V3_REF.bandsPct)) {
    const got = m.spectral.bandsPct[band]
    check(Math.abs(got - V3_REF.bandsPct[band]) <= TOL.bandPts, `audio: ${band} band within tolerance`, `${got.toFixed(1)}% vs ${V3_REF.bandsPct[band]}% (±${TOL.bandPts})`)
  }
  check(Math.abs(m.stereo.widthDb - V3_REF.widthDb) <= TOL.widthDb, 'audio: stereo width within tolerance', `${m.stereo.widthDb.toFixed(1)} vs ${V3_REF.widthDb} dB (±${TOL.widthDb})`)
}

console.log(failures === 0 ? '\nphase 5 exit test: ALL CHECKS PASSED' : `\nphase 5 exit test: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
